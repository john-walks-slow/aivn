import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { LineageTree } from "@aivn/core";
import {
  calibrateTokenScale,
  capDigest,
  compactionText,
  estimateThreadTokens,
  measureContext,
  pickThreadCutIndex,
  renderTranscript,
  renderTranscriptAs,
  splitSummary,
  withSeed,
  type ThreadTurn,
} from "../src/compaction.js";
import { PlayMemory } from "../src/memory.js";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import type { ServerMessage } from "@aivn/core";
import { createFakeStreamFn, PLAY, BEAT_1, BEAT_2, type FakeResponse } from "./helpers.js";

function user(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: 0 };
}
function assistant(text: string, totalTokens = 0): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "fake",
    model: "fake-test",
    usage: {
      input: totalTokens,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}
function toolResult(name: string, text: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: "c1",
    toolName: name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 0,
  };
}

describe("纪元压缩：计量与转录", () => {
  it("计量：有 usage 按实测标定；没有 usage 用 CJK 加权兜底（不是 chars/4）", () => {
    // 八条 120 字消息：CJK 加权各 120 token；最后一条 assistant 报 usage 480（前缀实测）
    const beat: AgentMessage[] = [];
    for (let i = 0; i < 4; i += 1) {
      beat.push(user("一".repeat(120)), assistant("二".repeat(120), 480));
    }
    const { tokens, scale } = measureContext(beat);
    // 480 / 960：本地 CJK 估算比 provider 报的还高一倍，标定系数把它压回来
    expect(scale).toBe(0.5);
    expect(tokens).toBe(480);

    // 冷启动 / 从树上重放出来的对话体没有 usage：兜底必须按 CJK 加权给下限。
    // 退回 pi 的 chars/4 会把 240 token 算成 60——中文下压缩线永远够不到，长会话涨到模型报错。
    const cold = measureContext([user("一".repeat(120)), assistant("二".repeat(120))]);
    expect(cold.scale).toBe(1);
    expect(cold.tokens).toBe(240);
  });

  it("转录：三类消息各取其文，超长单条截断", () => {
    const text = renderTranscript([
      user("【玩家表态】我到了"),
      assistant('<say id="mio">……太慢了！</say>[调用 write]'),
      toolResult("search_archive", "【第 1 轮】澪在走廊提到了旧约定"),
    ]);
    expect(text).toContain("【玩家/导演】【玩家表态】我到了");
    expect(text).toContain("……太慢了！");
    expect(text).toContain("[调用 write]");
    expect(text).toContain("【记忆工具 search_archive】");

    const long = renderTranscript([user("啊".repeat(5000))]);
    expect(long.length).toBeLessThan(5000);
    expect(long).toContain("（略）");
  });

  it("摘要拆分：首行一句话 + 其余正文；单行时正文回退", () => {
    const parsed = splitSummary("走廊上澪甩开了主角的手。\n\n## 剧情进展\n两人走到旧校舍。\n");
    expect(parsed.oneLiner).toBe("走廊上澪甩开了主角的手。");
    expect(parsed.body).toBe("## 剧情进展\n两人走到旧校舍。");

    const single = splitSummary("只有一句摘要");
    expect(single).toEqual({ oneLiner: "只有一句摘要", body: "只有一句摘要" });

    const withHeading = splitSummary("## 概览\n澪生气地走了。\n");
    // 通用标题不是摘要本身：跳过它再取第一行正文
    expect(withHeading.oneLiner).toBe("澪生气地走了。");
    expect(splitSummary("# 前情提要\n\n澪走了。").oneLiner).toBe("澪走了。");
    expect(splitSummary("## 前情提要\n## 剧情进展").oneLiner).toBe("剧情进展");

    // 压缩记录里的正文：通用标题剥掉，一行摘要与正文合成一份（模型看到的就是它）
    expect(compactionText("## 概览\n澪生气地走了。\n\n## 剧情进展\n两人走到旧校舍。")).toBe(
      "澪生气地走了。\n\n## 剧情进展\n两人走到旧校舍。",
    );
    expect(compactionText("只有一句")).toBe("只有一句");
  });

  it("withSeed：并入保留段首条 user，不产生相邻同角色消息", () => {
    const tail = [user("【状态】\n场景：走廊\n\n【玩家表态】\n（继续）"), assistant("剧本")];
    const merged = withSeed(tail, "【前情提要】");
    expect(merged).toHaveLength(2);
    expect(merged[0]!.role).toBe("user");
    expect(JSON.stringify(merged[0]!.content)).toContain("【前情提要】");
    expect(JSON.stringify(merged[0]!.content)).toContain("【玩家表态】");

    // 保留段首条不是 user（理论上不会发生）时退化为独立 seed 消息
    const odd = withSeed([assistant("剧本")], "【前情提要】");
    expect(odd[0]!.role).toBe("user");
  });
});

describe("编排器纪元压缩", () => {
  function setup(
    responses: FakeResponse[],
    compaction: {
      contextWindow: number;
      triggerRatio: number;
      keepRecentTokens: number;
    },
    memory: PlayMemory,
  ) {
    const tree = new LineageTree();
    const contexts: unknown[] = [];
    const messages: ServerMessage[] = [];
    const base = createFakeStreamFn(responses);
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: (model, context, options) => {
        contexts.push(context);
        return base(model, context, options);
      },
      model: {} as never,
      getApiKey: () => "test-key",
      play: PLAY,
      store: { dir: "/tmp/stage-compaction-test" } as never,
      memory,
      tree,
      engine: { ...PLAY.initialState },
      scene: PLAY.initialScene,
      onServerMessage: (msg) => messages.push(msg),
      persist: () => {},
      compaction,
    });
    return { orchestrator, tree, contexts, messages };
  }

  // A 区本身就远超 84 token 的预算，所以只要有一拍可压就会触发；
  // 保留 40 token 恰好够留下最后一拍（更早的拍装不下）
  const TIGHT = { contextWindow: 140, triggerRatio: 0.6, keepRecentTokens: 40 };
  const ROOMY = {
    contextWindow: 1_000_000,
    triggerRatio: 0.6,
    keepRecentTokens: 40,
  };

  it("超阈值：早期轮次换成摘要（落谱系快照）+ 重建 Agent", async () => {
    const memory = new PlayMemory();
    const { orchestrator, tree, contexts } = setup(
      [
        { text: BEAT_1, beatDone: true },
        { text: BEAT_2, beatDone: true },
        {
          text: "澪甩开了主角的手，两人走到旧校舍。\n\n## 剧情进展\n旧校舍即将拆除。",
        },
        { text: BEAT_2, beatDone: true },
      ],
      TIGHT,
      memory,
    );

    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    await orchestrator.playerAction({ kind: "continue" });
    // 只有一拍时无可压段：压缩记录还不该出现
    expect(tree.latestSnapshotOnPath(tree.leafId)?.compaction).toBeUndefined();

    // 第三轮开轮前跨过纪元边界
    await orchestrator.playerAction({ kind: "continue" });

    const record = tree.latestSnapshotOnPath(tree.leafId)?.compaction;
    expect(record?.summary).toContain("澪甩开了主角的手，两人走到旧校舍。");
    expect(record?.summary).toContain("旧校舍即将拆除。");
    expect(record?.tokensBefore).toBeGreaterThan(84);
    // 切点必须是链上的一个轮边界（第一拍的 beat_end），否则投影对不上原文
    expect(tree.get(record!.cutNodeId)?.kind).toBe("beat_end");
    // 压缩只改对话体：没有多余的卡落到剧目文件层
    expect(memory.cards).toHaveLength(0);

    // 重建后的对话体：摘要打头并进保留段首拍的 user，第一轮原文已不在
    const rendered = JSON.stringify((contexts.at(-1) as { messages: unknown[] }).messages);
    expect(rendered).toContain("【前情提要】");
    expect(rendered).toContain("澪甩开了主角的手");
    expect(rendered).not.toContain("放学后的走廊空无一人");

    // 摘要不进 A 区（它只活在对话体里，不再是一张记忆卡）
    expect(JSON.stringify((contexts.at(-1) as { messages: unknown[] }).messages[0])).not.toContain(
      "澪甩开了主角的手",
    );
  });

  it("未超阈值：不压缩、不重建", async () => {
    const memory = new PlayMemory();
    const { orchestrator, contexts } = setup(
      [
        { text: BEAT_1, beatDone: true },
        { text: BEAT_2, beatDone: true },
        { text: BEAT_2, beatDone: true },
      ],
      ROOMY,
      memory,
    );

    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    await orchestrator.playerAction({ kind: "continue" });
    await orchestrator.playerAction({ kind: "continue" });

    expect(memory.cards).toHaveLength(0);
    expect(contexts).toHaveLength(3);
  });

  it("限制级段落期间不压缩：压缩器看不到原文，摘要里留不下限制级内容", async () => {
    // 段落里每一拍都写得足够长：到第三轮时上下文一定越过 TIGHT 预算（见下面的非空断言）
    const explicit = `<say id="mio">${"露骨原文".repeat(400)}</say>`;
    const memory = new PlayMemory();
    const { orchestrator, tree, contexts } = setup(
      [
        // 第 1 轮：日常，同批请求进入限制级
        { text: BEAT_1, beatDone: true, toolCalls: [{ name: "enter_nsfw", args: {} }] },
        // 第 2 轮：限制级
        { text: explicit, beatDone: true },
        // 第 3 轮：限制级收尾，同批退出
        { text: explicit, beatDone: true, toolCalls: [{ name: "exit_nsfw", args: {} }] },
        // SFW 摘要
        { text: "两人互诉心意，关系有了突破。" },
        // 第 4 轮：日常
        { text: BEAT_2, beatDone: true },
      ],
      TIGHT,
      memory,
    );

    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    await orchestrator.playerAction({ kind: "continue" });
    await orchestrator.playerAction({ kind: "continue" });
    await orchestrator.whenIdle();

    // 一次都没压：没有压缩记录，也没有多出来那一次摘要补全（4 = 三拍 + SFW 摘要）
    expect(tree.latestSnapshotOnPath(tree.leafId)?.compaction).toBeUndefined();
    expect(contexts).toHaveLength(4);
    // 非空证明：第 3 轮开轮前那段对话体确实远超预算（真压了的话 agent 会被重建，
    // 这里量到的就是重建后的种子，也就不会超）——所以「没压」是早退的结果，不是没到阈值
    const beforeBeat3 = (contexts[2] as { messages: AgentMessage[] }).messages;
    expect(measureContext(beforeBeat3).tokens).toBeGreaterThan(
      TIGHT.contextWindow * TIGHT.triggerRatio,
    );
  });

  it("摘要生成失败：只告警不压缩，对话体保持原样", async () => {
    const memory = new PlayMemory();
    const { orchestrator, tree, contexts } = setup(
      [
        { text: BEAT_1, beatDone: true },
        { text: BEAT_2, beatDone: true },
        { text: "   " },
        { text: BEAT_2, beatDone: true },
      ],
      TIGHT,
      memory,
    );

    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    await orchestrator.playerAction({ kind: "continue" });
    await orchestrator.playerAction({ kind: "continue" });

    // 压缩补全确实发出去了（第三个上下文即摘要请求），只是模型给了空文本；对话体未重建
    expect(contexts).toHaveLength(4);
    expect(tree.latestSnapshotOnPath(tree.leafId)?.compaction).toBeUndefined();
    expect(JSON.stringify((contexts.at(-1) as { messages: unknown[] }).messages[0])).not.toContain(
      "前情提要",
    );
  });

  it("压缩请求在飞时 dispose：不落摘要、不重建 Agent、不再开轮", async () => {
    const memory = new PlayMemory();
    const { orchestrator, tree, messages } = setup(
      [
        { text: BEAT_1, beatDone: true },
        { text: BEAT_2, beatDone: true },
        { text: "摘要不该被采用" },
        { text: BEAT_2, beatDone: true },
      ],
      TIGHT,
      memory,
    );
    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    await orchestrator.playerAction({ kind: "continue" });

    // 摘要补全在飞（await 未落定）时编排器被回收：不得僵尸复活
    const pending = orchestrator.playerAction({ kind: "continue" });
    orchestrator.dispose();
    await pending;

    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(2);
    expect(tree.latestSnapshotOnPath(tree.leafId)?.compaction).toBeUndefined();
  });
});

describe("工坊线程压缩", () => {
  function turn(role: "user" | "assistant", text: string): ThreadTurn {
    return { role, text };
  }

  /** 3 轮交替；每条 40 个汉字 = 40 token 估算（CJK 加权，1 token/字），一轮 80。 */
  function turns(): ThreadTurn[] {
    return [
      turn("user", "用".repeat(40)),
      turn("assistant", "甲".repeat(40)),
      turn("user", "乙".repeat(40)),
      turn("assistant", "丙".repeat(40)),
      turn("user", "丁".repeat(40)),
      turn("assistant", "戊".repeat(40)),
    ];
  }

  it("切点只落在轮边界上，从尾部按预算保留", () => {
    // 保留 5：连最后一轮（80）都超预算，至少留它——一轮永远不被劈开，落点是它的 user（下标 4）
    expect(pickThreadCutIndex(turns(), 5)).toBe(4);
    // 保留 90：装得下最后一轮（80），再往前一轮就 160 了
    expect(pickThreadCutIndex(turns(), 90)).toBe(4);
    // 保留 170：装得下最后两轮（160）
    expect(pickThreadCutIndex(turns(), 170)).toBe(2);
    // 整段本来就装得下：无段可压
    expect(pickThreadCutIndex(turns(), 10_000)).toBe(0);
  });

  it("计量随标定系数线性放大（尺子是 CJK 加权，不是 chars/4）", () => {
    const system = "系".repeat(200); // 200 token（一个汉字一个）
    const messages: AgentMessage[] = [user("中".repeat(400))]; // 400
    expect(estimateThreadTokens(system, messages)).toBe(600);
    expect(estimateThreadTokens(system, messages, 4)).toBe(2400);
  });

  it("从 provider 实测 usage 标定系数；usage 缺失或越界一律不标", () => {
    const system = "系".repeat(200); // 200
    const base: AgentMessage[] = [
      { role: "system", content: system, timestamp: 0 },
      user("中".repeat(400)), // 400
      assistant("答".repeat(200), 600), // 200 → 前缀合计 800
    ];
    // provider 报 600，本地估 800 → 系数 0.75
    expect(calibrateTokenScale(system, base)).toBe(0.75);
    // 全零 usage（拿不到实测）：按 1 算
    expect(calibrateTokenScale(system, [base[0]!, base[1]!, assistant("答")])).toBeNull();
    // 系数离谱（网关漏报 usage）：不采信
    expect(calibrateTokenScale(system, [base[0]!, base[1]!, assistant("答".repeat(200), 99_999)])).toBeNull();
  });

  it("摘要正文封顶：丢最早的，标一句", () => {
    const body = "起".repeat(10_000);
    const capped = capDigest(body, 1000);
    expect(capped.startsWith("（更早的对话已不再保留）")).toBe(true);
    expect(capped.length).toBeLessThan(1100);
    expect(capDigest("短正文", 1000)).toBe("短正文");
  });

  it("转录说话人标签：工坊用「用户/搭台助手」，演出侧默认不变", () => {
    const messages: AgentMessage[] = [user("改一下世界观"), assistant("改好了")];
    expect(renderTranscript(messages)).toContain("【玩家/导演】改一下世界观");
    const workshop = renderTranscriptAs(messages, { user: "【用户】", assistant: "【搭台助手】" });
    expect(workshop).toContain("【用户】改一下世界观");
    expect(workshop).toContain("【搭台助手】改好了");
  });
});
