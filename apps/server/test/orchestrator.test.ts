import { describe, expect, it } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { LineageTree, type ServerMessage } from "@stage-ai/core";
import { PlaywrightOrchestrator, createMemoryTools } from "../src/orchestrator.js";
import { PlayMemory } from "../src/memory.js";
import { BEAT_1, BEAT_2, CARD, PLAY, createFakeStreamFn, type FakeResponse } from "./helpers.js";

function setup(
  responses: FakeResponse[],
  opts: { contexts?: unknown[]; memory?: PlayMemory } = {},
): {
  orchestrator: PlaywrightOrchestrator;
  messages: ServerMessage[];
  tree: LineageTree;
} {
  const messages: ServerMessage[] = [];
  const tree = new LineageTree();
  const base = createFakeStreamFn(responses);
  const streamFn: StreamFn = opts.contexts
    ? (model, context, options) => {
        opts.contexts!.push(context);
        return base(model, context, options);
      }
    : base;
  const orchestrator = new PlaywrightOrchestrator({
    streamFn,
    model: {} as never,
    getApiKey: () => "test-key",
    play: PLAY,
    memory: opts.memory ?? new PlayMemory({ cards: [CARD] }),
    tree,
    engine: { ...PLAY.initialState },
    scene: PLAY.initialScene,
    onServerMessage: (msg) => messages.push(msg),
    persist: () => {},
  });
  return { orchestrator, messages, tree };
}

/** beat_end 之后还有 beat_settled（编排器真正空闲的信号），断言只认收束本身。 */
function lastBeatEnd(messages: readonly { type: string }[]): { type: string } {
  return messages.filter((m) => m.type === "beat_end").at(-1)!;
}

describe("PlaywrightOrchestrator 闭环", () => {
  it("开局 → 流式事件 → stop 交互 → beat_end(stop)", async () => {
    const { orchestrator, messages } = setup([{ text: BEAT_1, beatDone: true }]);

    await orchestrator.playerAction({ kind: "free", text: "我到了" });

    const kinds = messages.map((m) => m.type);
    expect(kinds[0]).toBe("beat_start");
    const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
    expect(mergedKinds(events)).toEqual([
      "scene",
      "actor",
      "narrate_start",
      "narrate_text",
      "narrate_end",
      "say_start",
      "say_text",
      "say_end",
      "stop",
    ]);
    expect(fullText(events, "say_text")).toBe("……太慢了！");
    expect(fullText(events, "narrate_text")).toBe("放学后的走廊空无一人。");
    // seq 单调
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    const beatEnd = lastBeatEnd(messages);
    expect(beatEnd.type).toBe("beat_end");
    if (beatEnd.type === "beat_end") {
      expect(beatEnd.reason).toBe("stop");
      expect(beatEnd.stop?.stopType).toBe("choice");
      expect(beatEnd.stop?.options).toEqual([
        { text: "道歉", value: "a" },
        { text: "装傻", value: undefined },
      ]);
    }
  });

  it("玩家 choice → 第二拍 act_end（无 stop）", async () => {
    const { orchestrator, messages, tree } = setup([
      { text: BEAT_1, beatDone: true },
      { text: BEAT_2, beatDone: true },
    ]);

    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    const seqAfterBeat1 = orchestrator.lastSeq;
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });

    const beatEnds = messages.filter((m) => m.type === "beat_end");
    expect(beatEnds).toHaveLength(2);
    const second = beatEnds[1]!;
    if (second.type === "beat_end") {
      expect(second.reason).toBe("act_end");
      expect(second.stop).toBeUndefined();
    }
    // 第二拍事件 seq 续接
    const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
    expect(events.every((e) => e.seq > 0)).toBe(true);
    expect(orchestrator.lastSeq).toBeGreaterThan(seqAfterBeat1);

    // 谱系：完整行级序列（玩家行 + 台词行 + stop + beat_end × 2）
    const script = tree.materialize();
    expect(script.map((e) => e.kind)).toEqual([
      "player",
      "scene",
      "actor",
      "narrate",
      "say",
      "stop",
      "beat_end",
      "player",
      "say",
      "narrate",
      "beat_end",
    ]);
    const say1 = script.find((e) => e.kind === "say")!;
    expect(say1.text).toBe("……太慢了！");
  });

  it("busy 中拒绝重复输入", async () => {
    const slowResponses: FakeResponse[] = [{ text: BEAT_1, beatDone: true }];
    const { orchestrator, messages } = setup(slowResponses);

    const first = orchestrator.playerAction({ kind: "free", text: "开局" });
    const busyError = orchestrator.playerAction({ kind: "free", text: "抢跑" });
    await Promise.all([first, busyError]);

    const errors = messages.filter((m) => m.type === "error");
    expect(errors).toHaveLength(1);
    expect(orchestrator.isBusy).toBe(false);
  });

  it("无效选项索引 → error 且不开新拍", async () => {
    const { orchestrator, messages } = setup([{ text: BEAT_1, beatDone: true }]);
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    const beatStartsBefore = messages.filter((m) => m.type === "beat_start").length;

    await orchestrator.playerAction({ kind: "choice", optionIndex: 99 });

    expect(messages.filter((m) => m.type === "error")).toHaveLength(1);
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(beatStartsBefore);
  });

  it("OOC 走【导演注】区且谱系记录 ooc 行；越过停止点时明示玩家未回应", async () => {
    const contexts: { messages: { role: string }[] }[] = [];
    const { orchestrator, messages, tree } = setup(
      [
        { text: BEAT_1, beatDone: true },
        { text: BEAT_2, beatDone: true },
      ],
      { contexts },
    );
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    // 停在 choice 停止点（空闲态）：OOC 直接开新拍，并声明玩家未回应
    await orchestrator.playerAction({
      kind: "ooc",
      text: "下一拍让澪提到天文社",
    });

    expect(tree.materialize().some((e) => e.kind === "ooc")).toBe(true);
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(2);
    const oocUser = contexts[1]!.messages
      .filter((m) => m.role === "user")
      .map((m) => JSON.stringify(m))
      .find((s) => s.includes("导演注"));
    expect(oocUser).toContain("下一拍让澪提到天文社");
    expect(oocUser).toContain("玩家本轮未作回应");
  });

  it("resume：seq 过滤重放", async () => {
    const { orchestrator } = setup([{ text: BEAT_1, beatDone: true }]);
    await orchestrator.playerAction({ kind: "free", text: "开局" });

    const total = orchestrator.lastSeq;
    expect(orchestrator.eventsAfter(0)).toHaveLength(total);
    const half = Math.floor(total / 2);
    expect(orchestrator.eventsAfter(half).every((e) => e.seq > half)).toBe(true);
    expect(orchestrator.eventsAfter(total)).toHaveLength(0);
  });

  it("choice 零选项 → 护栏降级 free stop（D3）", async () => {
    const { orchestrator, messages } = setup([
      {
        text: '<narrate>她看了看表。</narrate><stop type="choice"></stop>',
        beatDone: true,
      },
    ]);
    await orchestrator.playerAction({ kind: "free", text: "开局" });

    const beatEnd = lastBeatEnd(messages);
    expect(beatEnd.type).toBe("beat_end");
    if (beatEnd.type === "beat_end") {
      expect(beatEnd.reason).toBe("stop");
      expect(beatEnd.stop?.stopType).toBe("free");
    }
  });

  it("空拍护栏：零产出 → 显式 error + pause 重试入口，不静默伪装 act_end（P0）", async () => {
    const { orchestrator, messages } = setup([{ text: "", beatDone: true }]);
    await orchestrator.playerAction({ kind: "free", text: "开局" });

    const error = messages.find((m) => m.type === "error");
    expect(error?.type).toBe("error");
    if (error?.type === "error") expect(error.message).toContain("生成失败");
    const beatEnd = lastBeatEnd(messages);
    expect(beatEnd.type).toBe("beat_end");
    if (beatEnd.type === "beat_end") {
      // 这一拍没有自然收尾，不能拿幕末的「下一幕」冒充正常结束
      expect(beatEnd.reason).toBe("stop");
      expect(beatEnd.stop?.stopType).toBe("pause");
    }
  });

  it("空拍护栏：provider 抛错（网关 429/断网）→ error 携带原因 + pause 可重试", async () => {
    const messages: ServerMessage[] = [];
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: () => {
        throw new Error("insufficient balance");
      },
      model: {} as never,
      getApiKey: () => "test-key",
      play: PLAY,
      memory: new PlayMemory(),
      tree: new LineageTree(),
      engine: { ...PLAY.initialState },
      scene: PLAY.initialScene,
      onServerMessage: (msg) => messages.push(msg),
      persist: () => {},
    });
    await orchestrator.playerAction({ kind: "free", text: "开局" });

    const error = messages.find((m) => m.type === "error");
    expect(error?.type).toBe("error");
    if (error?.type === "error") expect(error.message).toContain("insufficient balance");
    const beatEnd = lastBeatEnd(messages);
    expect(beatEnd.type).toBe("beat_end");
    if (beatEnd.type === "beat_end") {
      expect(beatEnd.reason).toBe("stop");
      expect(beatEnd.stop?.stopType).toBe("pause");
    }
    // 玩家可经「继续」重开一拍
    expect(orchestrator.isBusy).toBe(false);
  });

  it("运行态恢复：不重开开场、重放完整、stoppedReplay 可续演（服务器重启续演）", async () => {
    const first = setup([{ text: BEAT_1, beatDone: true }]);
    await first.orchestrator.playerAction({ kind: "free", text: "开局" });
    const total = first.orchestrator.lastSeq;

    // 用 runtimeState 重建编排器（模拟 server 重启后 PlayHouse 恢复）
    const restored = new PlaywrightOrchestrator({
      streamFn: createFakeStreamFn([{ text: BEAT_2, beatDone: true }]),
      model: {} as never,
      getApiKey: () => "test-key",
      play: PLAY,
      memory: new PlayMemory({ cards: [CARD] }),
      tree: first.tree,
      engine: { ...PLAY.initialState },
      scene: PLAY.initialScene,
      onServerMessage: () => {},
      persist: () => {},
      restored: first.orchestrator.runtimeState,
    });

    // 恢复后不触发开场重演：lastSeq/事件缓冲完整
    expect(restored.lastSeq).toBe(total);
    expect(restored.eventsAfter(0)).toHaveLength(total);
    // stopped 态可恢复前端交互面板
    const replay = restored.stoppedReplay;
    expect(replay?.type).toBe("beat_end");
    expect(replay?.stop?.stopType).toBe("choice");
    // 续演走第二拍而非 opening（beat_start 仅直播；事件缓冲见第二拍舞台事件）
    await restored.playerAction({ kind: "continue" });
    const seqAfter = restored.eventsAfter(total);
    expect(seqAfter.length).toBeGreaterThan(0);
    expect(seqAfter.some((e) => e.event.kind === "say_start")).toBe(true);
  });

  it("幕末恢复：上一拍的停止点不复活（停在 act_end 就是黑场 + 下一幕）", async () => {
    const first = setup([{ text: BEAT_1, beatDone: true }, { text: BEAT_2, beatDone: true }]);
    await first.orchestrator.playerAction({ kind: "free", text: "我到了" });
    // 第一拍 choice 停止点 → 第二拍 act_end（无 stop）
    await first.orchestrator.playerAction({ kind: "choice", optionIndex: 0 });

    const restored = new PlaywrightOrchestrator({
      streamFn: createFakeStreamFn([{ text: BEAT_1, beatDone: true }]),
      model: {} as never,
      getApiKey: () => "test-key",
      play: PLAY,
      memory: new PlayMemory({ cards: [CARD] }),
      tree: first.tree,
      engine: { ...PLAY.initialState },
      scene: PLAY.initialScene,
      onServerMessage: () => {},
      persist: () => {},
      restored: first.orchestrator.runtimeState,
    });

    const replay = restored.stoppedReplay;
    expect(replay?.type).toBe("beat_end");
    if (replay?.type === "beat_end") {
      expect(replay.reason).toBe("act_end");
      expect(replay.stop).toBeUndefined();
    }
  });
});

/** 聚合连续同类 text delta 后的事件类型序列（撕裂只影响切分粒度）。 */
function mergedKinds(events: { seq: number; event: { kind: string } }[]): string[] {
  const kinds: string[] = [];
  for (const { event } of events) {
    if (event.kind.endsWith("_text") && kinds.at(-1) === event.kind) continue;
    kinds.push(event.kind);
  }
  return kinds;
}

function fullText(
  events: { event: { kind: string } & Record<string, unknown> }[],
  kind: string,
): string {
  return events
    .filter((e) => e.event.kind === kind)
    .map((e) => String(e.event.delta ?? ""))
    .join("");
}

describe("记忆工具组（createMemoryTools，D7）", () => {
  function makeTools(
    engine: {
      turn: number;
      affinity: Record<string, number>;
      flags: Record<string, string | number | boolean>;
    },
    arcIds: readonly string[] = [],
  ) {
    const stateFiles: Record<string, string> = {};
    // 切片挂在当前分支叶子上：search_archive 以 pathSet() 过滤，脱离分支即不可见
    const tree = new LineageTree();
    const e1 = tree.append("scene", {
      payload: { attrs: { bg: "corridor_dusk" } },
    });
    const memory = new PlayMemory({
      cards: [CARD],
      slices: [{ entryId: e1.id, turn: 1, at: 0, summary: "澪在走廊提到了旧约定" }],
    });
    const tools = createMemoryTools({
      engine,
      characterIds: new Set(["mio"]),
      memory,
      tree,
      stateFiles,
      arcIds: () => arcIds,
    });
    return { tools, stateFiles, memory };
  }

  function textOf(result: { content: { type: string; text?: string }[] }): string {
    return result.content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("\n");
  }

  it("update_state：合法增量生效；非法增量/未知角色被拒；值域夹紧", async () => {
    const engine = { turn: 1, affinity: { mio: 10 }, flags: {} };
    const { tools } = makeTools(engine);
    const update = tools.find((t) => t.name === "update_state")!;

    const ok = await update.execute("t1", { affinity: { mio: 3 } });
    expect(engine.affinity.mio).toBe(13);
    expect(textOf(ok)).toContain("mio +3（10→13）");

    const mixed = await update.execute("t2", {
      affinity: { mio: -99, ghost: 1 },
      flags: { met: true },
    });
    expect(engine.affinity.mio).toBe(13); // -99 被拒，不生效
    expect(textOf(mixed)).toContain("被拒绝");
    expect(textOf(mixed)).toContain("ghost");
    expect(engine.flags.met).toBe(true);

    await update.execute("t3", { affinity: { mio: 5 } });
    await update.execute("t4", { affinity: { mio: 5 } });
    expect(engine.affinity.mio).toBe(23);
    await update.execute("t5", { affinity: { mio: 5 } }); // 23+5=28
    expect(engine.affinity.mio).toBe(28);
  });

  it("write_memory → stateFiles；read_memory_detail 命中与未命中", async () => {
    const engine = { turn: 1, affinity: {}, flags: {} };
    const { tools, stateFiles } = makeTools(engine);
    const write = tools.find((t) => t.name === "write_memory")!;
    const read = tools.find((t) => t.name === "read_memory_detail")!;

    await write.execute("t1", {
      file: "threads",
      content: "伏笔：旧约定未兑现",
    });
    expect(stateFiles.threads).toBe("伏笔：旧约定未兑现");

    const hit = await read.execute("t2", { name: "旧约定" });
    expect(textOf(hit)).toContain("文化祭");
    const miss = await read.execute("t3", { name: "不存在" });
    expect(textOf(miss)).toContain("未找到");
    expect(textOf(miss)).toContain("旧约定");
  });

  it("search_archive：命中格式化 + 防剧透过滤", async () => {
    const engine = { turn: 1, affinity: {}, flags: {} };
    const { tools } = makeTools(engine);
    const search = tools.find((t) => t.name === "search_archive")!;

    const hit = await search.execute("t1", { query: "旧约定" });
    expect(textOf(hit)).toContain("第 1 拍");
    expect(textOf(hit)).toContain("澪在走廊提到了旧约定");
    const miss = await search.execute("t2", { query: "完全无关的词" });
    expect(textOf(miss)).toContain("无命中");
  });
});

describe("长会话装配与原地 OOC（P4）", () => {
  it("30 轮稳态装配：A 区逐字节冻结、B 区纯追加（零重装配）、状态块在轮尾", async () => {
    const contexts: { messages: { role: string }[] }[] = [];
    const { orchestrator, messages } = setup([{ text: BEAT_2, beatDone: true }], { contexts });

    for (let i = 0; i < 30; i += 1) {
      await orchestrator.playerAction({ kind: "continue" });
    }

    expect(contexts).toHaveLength(30);
    // A 区（system）逐字节稳定：30 轮同一字符串，且记忆索引已注入
    const systems = contexts.map((c) => JSON.stringify(c.messages[0]));
    expect(new Set(systems).size).toBe(1);
    expect(systems[0]).toContain("记忆索引");
    expect(systems[0]).toContain("旧约定");
    // B 区 append-only：每轮消息序列是下一轮的前缀
    const serialized = contexts.map((c) => c.messages.map((m) => JSON.stringify(m)));
    for (let i = 1; i < serialized.length; i += 1) {
      expect(serialized[i]!.slice(0, serialized[i - 1]!.length)).toEqual(serialized[i - 1]!);
    }
    // 轮尾 C 区：最新 user 消息含【状态】与【玩家表态】
    const lastUser = contexts
      .at(-1)!
      .messages.filter((m) => m.role === "user")
      .at(-1)!;
    const rendered = JSON.stringify(lastUser);
    expect(rendered).toContain("【状态】");
    expect(rendered).toContain("【玩家表态】");
    // 30 拍全部正常收束（无空拍护栏触发）
    expect(messages.filter((m) => m.type === "beat_end")).toHaveLength(30);
    expect(messages.filter((m) => m.type === "error")).toEqual([]);
  });

  it("原地 OOC（演出中 steer）：当前拍收敛 → 注入导演注 → 立即续写下一拍", async () => {
    // 第一拍流挂起直到 OOC 到达：模拟「玩家在演出进行中发导演注」的真实时序
    let releaseFirst = (): void => {};
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const contexts: { messages: { role: string }[] }[] = [];
    let call = 0;
    const streamFn: StreamFn = (model, context, options) => {
      call += 1;
      contexts.push(context as { messages: { role: string }[] });
      const stream = createAssistantMessageEventStream();
      const partial = { role: "assistant", content: [] } as AssistantMessage;
      const turn = call === 1 ? 1 : 2;
      void (async () => {
        if (turn === 1) await gate;
        const text = turn === 1 ? BEAT_1 : BEAT_2;
        stream.push({ type: "start", partial });
        stream.push({ type: "text_start", contentIndex: 0, partial });
        for (const delta of text.match(/[\s\S]{1,7}/g) ?? []) {
          stream.push({ type: "text_delta", contentIndex: 0, delta, partial });
        }
        stream.push({
          type: "text_end",
          contentIndex: 0,
          content: text,
          partial,
        });
        const finalMessage: AssistantMessage = {
          role: "assistant",
          content: [
            { type: "text", text },
            {
              type: "toolCall",
              id: `call-${turn}`,
              name: "beat_done",
              arguments: {},
            },
          ],
          api: "openai-completions",
          provider: "fake",
          model: "fake-test",
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "toolUse",
          timestamp: Date.now(),
        };
        stream.push({ type: "done", message: finalMessage });
        stream.end(finalMessage);
      })();
      void model;
      void options;
      return stream;
    };

    const messages: ServerMessage[] = [];
    const orchestrator = new PlaywrightOrchestrator({
      streamFn,
      model: {} as never,
      getApiKey: () => "test-key",
      play: PLAY,
      memory: new PlayMemory({ cards: [CARD] }),
      tree: new LineageTree(),
      engine: { ...PLAY.initialState },
      scene: PLAY.initialScene,
      onServerMessage: (msg) => messages.push(msg),
      persist: () => {},
    });

    const first = orchestrator.playerAction({ kind: "free", text: "我到了" });
    while (call === 0) await new Promise((resolve) => setTimeout(resolve, 0)); // 等第一拍开流
    await orchestrator.playerAction({ kind: "ooc", text: "节奏加快一点" }); // busy → steer 入队
    expect(messages.some((m) => m.type === "ooc_ack")).toBe(true);
    releaseFirst();
    await first; // 拍 1 收敛 → 导演注注入 → 拍 2 续写（同一 run）

    expect(messages.filter((m) => m.type === "error")).toEqual([]);
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(2);
    expect(call).toBe(2);
    const steerUser = contexts[1]!.messages
      .filter((m) => m.role === "user")
      .map((m) => JSON.stringify(m))
      .find((s) => s.includes("导演注"));
    expect(steerUser).toContain("节奏加快一点");
    // 演出中注入：本拍自己的停止点尚未到，不需要「未作回应」声明
    expect(steerUser).not.toContain("玩家本轮未作回应");
  });

  it("write_memory 落谱系快照 → 恢复后注入【状态】（服务器重启续演）", async () => {
    // 记忆工具与 beat_done 分处两个 turn（beat_done 必须独占批次，否则 terminate 被吞）
    const first = setup([
      {
        text: BEAT_1,
        toolCalls: [
          {
            name: "write_memory",
            args: { file: "scene", content: "黄昏，教室只剩两人" },
          },
        ],
      },
      { text: "", beatDone: true },
    ]);
    await first.orchestrator.playerAction({ kind: "free", text: "开局" });

    const contexts: { messages: { role: string }[] }[] = [];
    const restored = new PlaywrightOrchestrator({
      streamFn: ((model: never, context: unknown, options: unknown) => {
        contexts.push(context as { messages: { role: string }[] });
        return createFakeStreamFn([{ text: BEAT_2, beatDone: true }])(model, context, options);
      }) as unknown as StreamFn,
      model: {} as never,
      getApiKey: () => "test-key",
      play: PLAY,
      memory: new PlayMemory({ cards: [CARD] }),
      tree: first.tree,
      engine: { ...PLAY.initialState },
      scene: PLAY.initialScene,
      onServerMessage: () => {},
      persist: () => {},
      restored: first.orchestrator.runtimeState,
    });

    await restored.playerAction({ kind: "continue" });

    const lastUser = contexts[0]!.messages.filter((m) => m.role === "user").at(-1)!;
    expect(JSON.stringify(lastUser)).toContain("场景细节：黄昏，教室只剩两人");
  });

  it("记忆工具轮次不撕裂节拍：先查记忆→再写剧本→beat_done 仍是同一拍", async () => {
    // 真实高频路径：模型先 read_memory_detail / search_archive 拿资料，再续写剧本
    const { orchestrator, messages } = setup(
      [
        {
          text: "",
          toolCalls: [{ name: "read_memory_detail", args: { name: "旧约定" } }],
        },
        {
          text: "",
          toolCalls: [{ name: "search_archive", args: { query: "旧约定" } }],
        },
        { text: BEAT_1, beatDone: true },
      ],
      { memory: new PlayMemory({ cards: [CARD] }) },
    );

    await orchestrator.playerAction({ kind: "free", text: "我到了" });

    // 三个 turn 仍属于一拍：只开一次拍、只收一次束、无空拍护栏
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(1);
    expect(messages.filter((m) => m.type === "beat_end")).toHaveLength(1);
    expect(messages.filter((m) => m.type === "error")).toEqual([]);
    const beatEnd = lastBeatEnd(messages);
    if (beatEnd.type === "beat_end") expect(beatEnd.stop?.stopType).toBe("choice");
  });

  it("只调记忆工具就结束（零剧本产出）→ 空拍护栏显式报错、给 pause 重试入口", async () => {
    const { orchestrator, messages } = setup(
      [
        {
          text: "",
          toolCalls: [{ name: "read_memory_detail", args: { name: "旧约定" } }],
        },
        { text: "", beatDone: true },
      ],
      { memory: new PlayMemory({ cards: [CARD] }) },
    );

    await orchestrator.playerAction({ kind: "free", text: "我到了" });

    expect(messages.filter((m) => m.type === "error")).toHaveLength(1);
    const beatEnd = lastBeatEnd(messages);
    if (beatEnd.type === "beat_end") {
      expect(beatEnd.reason).toBe("stop");
      expect(beatEnd.stop?.stopType).toBe("pause");
    }
  });

  it("beat_done 与记忆工具同批 → finishTurn 兜底收束（terminate 不被 batch 吞掉）", async () => {
    const { orchestrator, messages } = setup([
      {
        text: BEAT_1,
        beatDone: true,
        toolCalls: [
          {
            name: "write_memory",
            args: { file: "threads", content: "伏笔：旧约定" },
          },
        ],
      },
    ]);
    await orchestrator.playerAction({ kind: "free", text: "我到了" });

    // 只演出一拍：同批调用没有让节拍继续空转
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(1);
    expect(messages.filter((m) => m.type === "beat_end")).toHaveLength(1);
    expect(orchestrator.isBusy).toBe(false);
  });
});

describe("对话尾接力（工坊改设定后重建 runtime）", () => {
  it("carryOver 取最近一段对话尾并带上设定已更新的说明", async () => {
    const { orchestrator } = setup([{ text: BEAT_2, beatDone: true }]);
    for (let i = 0; i < 6; i += 1) await orchestrator.playerAction({ kind: "continue" });

    const seed = orchestrator.carryOver("【设定已更新】");
    expect(seed).not.toBeNull();
    expect(seed!.note).toBe("【设定已更新】");
    // 接力段非空，且从 user 消息起刀（不劈开 toolCall/toolResult 对）
    const roles = seed!.messages.map((m) => m.role);
    expect(roles.length).toBeGreaterThan(0);
    expect(roles[0]).toBe("user");
  });

  it("对话太短接不住就返回 null：新实例从零开始也没丢什么", () => {
    const { orchestrator } = setup([{ text: BEAT_2, beatDone: true }]);
    expect(orchestrator.carryOver("【设定已更新】")).toBeNull();
  });
});
