import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { LineageTree } from "@stage-ai/core";
import {
  measureContext,
  pickCutIndex,
  renderSeed,
  renderTranscript,
  splitSummary,
  withSeed,
} from "../src/compaction.js";
import { PlayMemory } from "../src/memory.js";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import { buildSystemPrompt } from "../src/prompt.js";
import type { ServerMessage } from "@stage-ai/core";
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

describe("纪元压缩：切尾点与转录", () => {
  it("切点落在 user 消息上（工具调用对不被劈开）", () => {
    const messages: AgentMessage[] = [
      assistant("A 区不算"),
      user("第一轮".repeat(50)),
      assistant("剧本一".repeat(50)),
      user("第二轮".repeat(50)),
      assistant("剧本二".repeat(50)),
      user("第三轮".repeat(50)),
      assistant("剧本三".repeat(50)),
    ];
    // 保留预算只够最后一条 user + 它的回复：切点必须正好是那条 user
    expect(pickCutIndex(messages, 60)).toBe(5);
    // 预算大到覆盖全部对话体 → 无可压段
    expect(pickCutIndex(messages, 100_000)).toBe(0);
    // 预算落在 toolResult 上：向前退到那一条 user（工具调用对不被劈开），退无可退判无可压
    const withTool: AgentMessage[] = [
      user("轮".repeat(400)),
      assistant("回".repeat(400)),
      toolResult("search_archive", "命中"),
    ];
    expect(pickCutIndex(withTool, 1)).toBe(0);
    // 尾巴上挂着 beat_done 的 toolResult 是常态：预算落在那条 assistant 上时，
    // 顺延会越界（toolResult 之后没有 user），必须能退回本轮的 user
    const stranded: AgentMessage[] = [
      user("一".repeat(400)),
      assistant("二".repeat(400)),
      toolResult("beat_done", "命中"),
      user("三".repeat(400)),
      assistant("四".repeat(400)),
      toolResult("beat_done", "命中"),
    ];
    expect(pickCutIndex(stranded, 60)).toBe(3);
    // 边缘：只有一条超长 user（没有第二轮可切）→ 顺延越界，判为无可压段
    expect(pickCutIndex([user("长".repeat(4000)), assistant("回")], 1)).toBe(0);
    expect(pickCutIndex([], 1)).toBe(0);
  });

  it("计量标定：provider usage 与本地估算不同尺时，触发与切尾同尺（中文 chars/4 低估防线）", () => {
    // 八条 120 字消息：本地估算各 30 token，assistant 报 usage 480 → 标定系数 2（≈1 token/汉字）
    const beat: AgentMessage[] = [];
    for (let i = 0; i < 4; i += 1) {
      beat.push(user("一".repeat(120)), assistant("二".repeat(120), 480));
    }
    const { tokens, scale } = measureContext(beat);
    expect(scale).toBe(2);
    expect(tokens).toBe(480);
    // 同一把尺子：保留 180 真实 token 落两条消息；不标定就会按 180 估算 token 落下六条
    expect(pickCutIndex(beat, 180, scale)).toBe(6);
    expect(pickCutIndex(beat, 180)).toBe(2);
    // usage 漏报时退回系数 1，不产生天文数字的保留段
    expect(measureContext([user("一".repeat(120)), assistant("二".repeat(120))]).scale).toBe(1);
  });

  it("转录：三类消息各取其文，超长单条截断", () => {
    const text = renderTranscript([
      user("【玩家表态】我到了"),
      assistant('<say id="mio">……太慢了！</say>[调用 write_memory]'),
      toolResult("search_archive", "【第 1 轮】澪在走廊提到了旧约定"),
    ]);
    expect(text).toContain("【玩家/导演】【玩家表态】我到了");
    expect(text).toContain("……太慢了！");
    expect(text).toContain("[调用 write_memory]");
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
  });

  it("seed 消息带纪元与轮号，正文原样嵌入", () => {
    const seed = renderSeed(2, 24, "## 剧情进展\n两人走到旧校舍。");
    expect(seed).toContain("【前情提要·纪元 2】（截至第 24 轮");
    expect(seed).toContain("## 剧情进展\n两人走到旧校舍。");
    expect(seed).toContain("不要重演");
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

describe("PlayMemory 纪元卡", () => {
  it("appendArc 落盘 + 即时进 cards；visibleCards 按分支过滤", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stage-arc-"));
    const memory = new PlayMemory({
      arcsDir: join(dir, "memory", "arcs"),
    });

    await memory.appendArc({
      id: "epoch-e1-1",
      title: "纪元 1｜截至第 12 轮",
      summary: "澪甩开了主角。",
      detail: "## 剧情进展\n旧校舍。",
    });

    expect(memory.cards).toHaveLength(1);
    expect(memory.readCard("epoch-e1-1", ["epoch-e1-1"])).toContain("旧校舍");
    const onDisk = await readFile(join(dir, "memory", "arcs", "epoch-e1-1.md"), "utf8");
    expect(onDisk).toContain("# 纪元 1｜截至第 12 轮");
    expect(onDisk).toContain("澪甩开了主角。");

    // 谱系级过滤：别的分支不得读到这条纪元
    expect(memory.visibleCards([])).toHaveLength(0);
    expect(memory.visibleCards(["epoch-e1-1"])).toHaveLength(1);
    expect(memory.readCard("epoch-e1-1", [])).toBeNull();
    expect(memory.readCard("epoch-e1-1", ["epoch-e1-1"])).toContain("旧校舍");

    // 同 id 重复写入幂等
    await memory.appendArc({
      id: "epoch-e1-1",
      title: "重复",
      summary: "x",
      detail: "y",
    });
    expect(memory.cards).toHaveLength(1);
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

  // 两轮对话体约 90 token 估算：预算 84 触发；保留 20 token 恰好留下第二轮的 user + 剧本
  const TIGHT = { contextWindow: 140, triggerRatio: 0.6, keepRecentTokens: 20 };
  const ROOMY = {
    contextWindow: 1_000_000,
    triggerRatio: 0.6,
    keepRecentTokens: 20,
  };

  it("超阈值：压成 arcs 卡 + 重建 Agent（seed 落对话体头）", async () => {
    const memory = new PlayMemory({
      arcsDir: join(await mkdtemp(join(tmpdir(), "stage-arc-")), "memory", "arcs"),
    });
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
    expect(memory.cards).toHaveLength(0);

    // 第三轮开轮前跨过纪元边界
    await orchestrator.playerAction({ kind: "continue" });

    const arcs = memory.cards.filter((c) => c.layer === "arcs");
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.summary).toBe("澪甩开了主角的手，两人走到旧校舍。");
    expect(arcs[0]!.detail).toContain("旧校舍即将拆除。");

    // 重建后的 A 区带上了这条纪元（纪元内冻结）
    const systems = (contexts.at(-1) as { messages: { role: string }[] }).messages;
    expect(JSON.stringify(systems[0])).toContain("澪甩开了主角的手");
    expect(buildSystemPrompt({ play: PLAY, assets: {}, memory, arcIds: [arcs[0]!.file] })).toContain(
      "澪甩开了主角的手",
    );
    // 对话体：seed 摘要打头 + 保留的最近轮次（第一轮原文已不在）
    const rendered = JSON.stringify(systems);
    expect(rendered).toContain("【前情提要·纪元 1】");
    expect(rendered).not.toContain("放学后的走廊空无一人");

    // 谱系快照记录 arc 引用
    expect(tree.latestSnapshotOnPath(tree.leafId)?.memory.arcs).toEqual([arcs[0]!.file]);
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

  it("摘要生成失败：只告警不压缩，对话体保持原样", async () => {
    const memory = new PlayMemory();
    const { orchestrator, contexts } = setup(
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

    expect(memory.cards).toHaveLength(0);
    // 压缩补全确实发出去了（第三个上下文即摘要请求），只是模型给了空文本；对话体未重建
    expect(contexts).toHaveLength(4);
    expect(JSON.stringify((contexts.at(-1) as { messages: unknown[] }).messages[0])).not.toContain(
      "前情提要",
    );
  });

  it("压缩请求在飞时 dispose：不落卡、不重建 Agent、不再开轮", async () => {
    const memory = new PlayMemory({
      arcsDir: join(await mkdtemp(join(tmpdir(), "stage-arc-")), "memory", "arcs"),
    });
    const { orchestrator, messages } = setup(
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

    expect(memory.cards).toHaveLength(0);
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(2);
  });
});
