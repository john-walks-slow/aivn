import { describe, expect, it, vi } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { LineageTree, type ServerMessage } from "@stage-ai/core";
import { PlaywrightOrchestrator, type OrchestratorRuntimeState } from "../src/orchestrator.js";
import { createMemoryTools } from "../src/agentkit/memoryTool.js";
import { PlayMemory } from "../src/memory.js";
import { BEAT_1, BEAT_1_STOP, BEAT_2, CARD, PLAY, createFakeStreamFn, type FakeResponse } from "./helpers.js";

function setup(
  responses: FakeResponse[],
  opts: {
    contexts?: unknown[];
    memory?: PlayMemory;
    beatTimeoutMs?: number;
    streamFn?: StreamFn;
    restored?: OrchestratorRuntimeState;
  } = {},
): {
  orchestrator: PlaywrightOrchestrator;
  messages: ServerMessage[];
  tree: LineageTree;
} {
  const messages: ServerMessage[] = [];
  const tree = new LineageTree();
  const base = createFakeStreamFn(responses);
  const streamFn: StreamFn =
    opts.streamFn ??
    (opts.contexts
      ? (model, context, options) => {
          opts.contexts!.push(context);
          return base(model, context, options);
        }
      : base);
  const orchestrator = new PlaywrightOrchestrator({
    streamFn,
    model: {} as never,
    getApiKey: () => "test-key",
    play: PLAY,
    memory: opts.memory ?? new PlayMemory({ cards: [CARD] }),
    tree,
    engine: { ...PLAY.initialState },
    scene: PLAY.initialScene,
    ...(opts.beatTimeoutMs !== undefined ? { beatTimeoutMs: opts.beatTimeoutMs } : {}),
    ...(opts.restored ? { restored: opts.restored } : {}),
    onServerMessage: (msg) => messages.push(msg),
    persist: () => {},
  });
  return { orchestrator, messages, tree };
}

/** beat_end 之后还有 beat_settled（编排器真正空闲的信号），断言只认收束本身。 */
function lastBeatEnd(messages: readonly { type: string }[]): { type: string } {
  return messages.filter((m) => m.type === "beat_end").at(-1)!;
}

type CapturedContext = { messages: { role: string; content?: { type: string; text?: string }[] }[] };
/** 最后一条 user 消息的正文（JSON.stringify 会把换行转义掉，比对正文才看得清）。 */
function lastUserText(contexts: CapturedContext[]): string {
  const message = contexts.at(-1)!.messages.filter((m) => m.role === "user").at(-1)!;
  return (message.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("\n");
}

describe("导演生图", () => {
  /** 走完一拍，让树上有台词、有停止点——这才是「演到哪儿了」的样子。 */
  async function staged() {
    const built = setup([{ text: BEAT_1, beatDone: BEAT_1_STOP }]);
    await built.orchestrator.playerAction({ kind: "free", text: "我到了" });
    return built;
  }

  it("directorCg 把位置钉在点下这一刻：节点挂在当前世界线末尾并广播", async () => {
    const { orchestrator, messages, tree } = await staged();
    orchestrator.directorCg("cg_demo");

    const chain = tree.materialize();
    expect(chain.at(-1)?.kind).toBe("cg");
    expect(chain.at(-1)?.payload?.attrs?.id).toBe("cg_demo");

    const sent = messages
      .flatMap((m) => (m.type === "events" ? m.events : []))
      .map((e) => e.event);
    const cg = sent.findLast((e) => e.kind === "cg");
    expect(cg).toMatchObject({ kind: "cg", id: "cg_demo" });
  });

  it("recentScript 取当前世界线最近几句台词，最新在最后", async () => {
    const { orchestrator } = await staged();
    expect(orchestrator.recentScript()).toEqual({
      lines: ["放学后的走廊空无一人。", "……太慢了！"],
      scene: "corridor_dusk",
    });
  });

  it("空树：没有台词也没有场景可照", () => {
    const { orchestrator } = setup([]);
    expect(orchestrator.recentScript()).toEqual({ lines: [], scene: PLAY.initialScene });
  });
});

describe("重连恢复（停止点补发）", () => {
  const restored = (beatNo: number): OrchestratorRuntimeState => ({
    events: [],
    beatNo,
    lastStop: { stopType: "pause" },
    epoch: 3,
  });

  it("挂载点落在第 0 拍内（引擎 turn 回落 0）也要补发停止点", () => {
    const { orchestrator } = setup([], { restored: restored(0) });
    expect(orchestrator.stoppedReplay).toEqual({
      type: "beat_end",
      beatId: "beat-0",
      reason: "stop",
      stop: { stopType: "pause" },
    });
  });

  it("还没开演过的不补发（空树上没有停止点可补）", () => {
    const { orchestrator } = setup([]);
    expect(orchestrator.fresh).toBe(true);
    expect(orchestrator.stoppedReplay).toBeNull();
  });
});

describe("空树的第一轮", () => {
  it("不自己开局：fresh 为真，start() 之后才落第一拍", async () => {
    const { orchestrator, messages } = setup([{ text: BEAT_1, beatDone: true }]);

    expect(orchestrator.fresh).toBe(true);
    orchestrator.start();
    expect(orchestrator.fresh).toBe(false);
    await vi.waitFor(() => expect(lastBeatEnd(messages)).toBeTruthy());
  });

  it("start() 只认第一次：再按不会开出第二轮", async () => {
    const { orchestrator, messages } = setup([
      { text: BEAT_1, beatDone: true },
      { text: BEAT_2, beatDone: true },
    ]);

    orchestrator.start();
    await vi.waitFor(() => expect(lastBeatEnd(messages)).toBeTruthy());
    const beats = messages.filter((m) => m.type === "beat_end").length;
    orchestrator.start();
    expect(messages.filter((m) => m.type === "beat_end").length).toBe(beats);
  });
});

describe("PlaywrightOrchestrator 闭环", () => {
  it("开局 → 流式事件 → stop 交互 → beat_end(stop)", async () => {
    const { orchestrator, messages } = setup([{ text: BEAT_1, beatDone: BEAT_1_STOP }]);

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
      expect(beatEnd.stop?.options).toEqual([{ text: "道歉" }, { text: "装傻" }]);
    }
  });

  it("玩家 choice → 第二轮 no_stop（无 stop）", async () => {
    const { orchestrator, messages, tree } = setup([
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
    ]);

    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    const seqAfterBeat1 = orchestrator.lastSeq;
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });

    const beatEnds = messages.filter((m) => m.type === "beat_end");
    expect(beatEnds).toHaveLength(2);
    const second = beatEnds[1]!;
    if (second.type === "beat_end") {
      expect(second.reason).toBe("no_stop");
      expect(second.stop).toBeUndefined();
    }
    // 第二轮事件 seq 续接
    const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
    expect(events.every((e) => e.seq > 0)).toBe(true);
    expect(orchestrator.lastSeq).toBeGreaterThan(seqAfterBeat1);

    // 谱系：完整行级序列（输入行 + 台词行 + stop + beat_end × 2）
    const script = tree.materialize();
    expect(script.map((e) => e.kind)).toEqual([
      "prompt",
      "scene",
      "actor",
      "narrate",
      "say",
      "stop",
      "beat_end",
      "prompt",
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

  it("无效选项索引 → error 且不开新轮", async () => {
    const { orchestrator, messages } = setup([{ text: BEAT_1, beatDone: true }]);
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    const beatStartsBefore = messages.filter((m) => m.type === "beat_start").length;

    await orchestrator.playerAction({ kind: "choice", optionIndex: 99 });

    expect(messages.filter((m) => m.type === "error")).toHaveLength(1);
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(beatStartsBefore);
  });

  it("插一句走【用户输入】区且谱系记录 prompt 行；越过停止点时明示玩家未作回应", async () => {
    const contexts: { messages: { role: string }[] }[] = [];
    const { orchestrator, messages, tree } = setup(
      [
        { text: BEAT_1, beatDone: BEAT_1_STOP },
        { text: BEAT_2, beatDone: true },
      ],
      { contexts },
    );
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    // 停在 choice 停止点（空闲态）：插一句直接开新轮，并声明玩家未作回应
    await orchestrator.playerAction({
      kind: "prompt",
      text: "下一轮让澪提到天文社",
    });

    expect(tree.materialize().findLast((e) => e.kind === "prompt")?.payload?.input)
      .toBe("下一轮让澪提到天文社");
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(2);
    expect(lastUserText(contexts)).toContain("【用户输入】\n下一轮让澪提到天文社");
    expect(lastUserText(contexts)).toContain("未作回应");
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

  it("beat_done 参数校验：单项选项被 schema 拒绝，这一轮不产生停止点（护栏从编排器移进 schema）", async () => {
    // options 的 minItems=2 由 pi 的参数校验兜住：只写一条会拿到校验错误回执，模型重来一次。
    // 编排器那条「choice 无选项 → 降级 free」的护栏随之删除，不再有"降级"这条路。
    const base = createFakeStreamFn([
      { text: '<narrate>她看了看表。</narrate>', beatDone: { options: ["走吧"] } },
      { text: '<narrate>她还在等。</narrate>', beatDone: true },
    ]);
    let calls = 0;
    const { orchestrator, messages } = setup([], {
      streamFn: (model, context, options) => {
        calls += 1;
        return base(model, context, options);
      },
    });
    await orchestrator.playerAction({ kind: "free", text: "开局" });

    expect(calls).toBe(2);
    const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
    expect(events.some((e) => e.kind === "stop")).toBe(false);
    const beatEnd = lastBeatEnd(messages);
    expect(beatEnd.type).toBe("beat_end");
    if (beatEnd.type === "beat_end") expect(beatEnd.reason).toBe("no_stop");
  });

  it("空轮护栏：零产出 → 显式 error + pause 重试入口，不静默伪装 no_stop（P0）", async () => {
    const { orchestrator, messages } = setup([{ text: "", beatDone: true }]);
    await orchestrator.playerAction({ kind: "free", text: "开局" });

    const error = messages.find((m) => m.type === "error");
    expect(error?.type).toBe("error");
    if (error?.type === "error") expect(error.message).toContain("生成失败");
    const beatEnd = lastBeatEnd(messages);
    expect(beatEnd.type).toBe("beat_end");
    if (beatEnd.type === "beat_end") {
      // 这一轮没有自然收尾，不能拿幕末的「下一幕」冒充正常结束
      expect(beatEnd.reason).toBe("stop");
      expect(beatEnd.stop?.stopType).toBe("pause");
    }
  });

  it("空轮护栏：provider 抛错（网关 429/断网）→ error 携带原因 + pause 可重试", async () => {
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
    // 玩家可经「继续」重开一轮
    expect(orchestrator.isBusy).toBe(false);
  });

  it("运行态恢复：不重开开场、重放完整、stoppedReplay 可续演（服务器重启续演）", async () => {
    const first = setup([{ text: BEAT_1, beatDone: BEAT_1_STOP }]);
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
    // 续演走第二轮而非 opening（beat_start 仅直播；事件缓冲见第二轮舞台事件）
    await restored.playerAction({ kind: "continue" });
    const seqAfter = restored.eventsAfter(total);
    expect(seqAfter.length).toBeGreaterThan(0);
    expect(seqAfter.some((e) => e.event.kind === "say_start")).toBe(true);
  });

  it("幕末恢复：上一轮的停止点不复活（停在 no_stop 就是黑场 + 下一幕）", async () => {
    const first = setup([{ text: BEAT_1, beatDone: true }, { text: BEAT_2, beatDone: true }]);
    await first.orchestrator.playerAction({ kind: "free", text: "我到了" });
    // 第一轮 choice 停止点 → 第二轮 no_stop（无 stop）
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
      expect(replay.reason).toBe("no_stop");
      expect(replay.stop).toBeUndefined();
    }
  });

  it("网关挂住不把舞台拖死：到点中断这一轮，报错并交还空闲", async () => {
    // 网关挂住的真实形态是「连接还在、流不来了」——provider 既不抛错也不收流，
    // 舞台会一直停在「剧作家正在落笔…」。这里用一个只在 abort 时才收束的流复现：
    // abort 之后真实 fetch 以 AbortError 结束，对外表现为一条带 errorMessage 的
    // assistant 消息、零剧本产出——正是下面断言的那个形状。
    const hung: StreamFn = (_model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      const partial = { role: "assistant", content: [] } as AssistantMessage;
      queueMicrotask(() => {
        stream.push({ type: "start", partial });
        options?.signal?.addEventListener("abort", () => {
          const message: AssistantMessage = {
            role: "assistant",
            content: [],
            api: "openai-completions",
            provider: "fake",
            model: "fake-test",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
            stopReason: "error",
            errorMessage: "AbortError: The operation was aborted",
            timestamp: Date.now(),
          };
          stream.push({ type: "done", message });
          stream.end(message);
        });
      });
      return stream;
    };
    const { orchestrator, messages } = setup([{ text: BEAT_1 }], { streamFn: hung, beatTimeoutMs: 40 });

    await orchestrator.playerAction({ kind: "free", text: "我到了" });

    const errors = messages.filter((m) => m.type === "error");
    expect(errors).toHaveLength(1);
    // 我们主动 abort 的，报错要说人话而不是把 AbortError 原样丢给玩家
    expect((errors[0] as { message: string }).message).toContain("没有动静");
    // 收束后必须回到空闲：下一轮还能开，否则是卡死而不是超时
    expect(orchestrator.runtimeState.beatNo).toBe(1);
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
    expect(textOf(hit)).toContain("第 1 轮");
    expect(textOf(hit)).toContain("澪在走廊提到了旧约定");
    const miss = await search.execute("t2", { query: "完全无关的词" });
    expect(textOf(miss)).toContain("无命中");
  });
});

describe("长会话装配", () => {
  it("30 轮稳态装配：A 区逐字节冻结、B 区纯追加（零重装配）、状态块在轮尾", async () => {
    const contexts: { messages: { role: string }[] }[] = [];
    const { orchestrator, messages } = setup([{ text: BEAT_2, beatDone: true }], { contexts });

    for (let i = 0; i < 30; i += 1) {
      await orchestrator.playerAction({ kind: "free", text: `我第 ${i + 1} 次开口` });
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
    // 轮尾 C 区：最新 user 消息含【状态】与【用户输入】
    expect(lastUserText(contexts)).toContain("【状态】");
    expect(lastUserText(contexts)).toContain("【用户输入】\n我第 30 次开口");
    // 30 轮全部正常收束（无空轮护栏触发）
    expect(messages.filter((m) => m.type === "beat_end")).toHaveLength(30);
    expect(messages.filter((m) => m.type === "error")).toEqual([]);
  });

  it("演出中插一句：当前轮收敛 → 队列兑现 → 立即续写下一轮", async () => {
    // 第一轮流挂起直到插一句到达：模拟「玩家在演出进行中插话」的真实时序
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
              arguments: turn === 1 ? { options: ["道歉", "装傻"] } : {},
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
    while (call === 0) await new Promise((resolve) => setTimeout(resolve, 0)); // 等第一轮开流
    await orchestrator.playerAction({ kind: "prompt", text: "节奏加快一点" }); // busy → 进队列
    const queued = messages.filter((m) => m.type === "prompt_queue").at(-1);
    expect(queued?.type === "prompt_queue" && queued.items[0]).toMatchObject({
      text: "节奏加快一点",
      status: "pending",
    });
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(1); // 还没兑现

    releaseFirst();
    await first; // 轮 1 收敛
    await orchestrator.whenIdle(); // 队列在收束后异步兑现，等它开完轮

    expect(messages.filter((m) => m.type === "error")).toEqual([]);
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(2);
    expect(call).toBe(2);
    expect(lastUserText(contexts)).toContain("【用户输入】\n节奏加快一点");
    // 插话时轮一还在演，等到它落幕才呈现出一个选择点：玩家没点选项就说了别的，按未作回应处理
    expect(lastUserText(contexts)).toContain("未作回应");
    // 兑现完就把队列清空：面板标题写的是「接下来要说的话」，没有下一句就不该还挂着
    const settledQueue = messages.filter((m) => m.type === "prompt_queue").at(-1);
    expect(settledQueue?.type === "prompt_queue" && settledQueue.items).toEqual([]);
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

  it("记忆工具轮次不撕裂轮：先查记忆→再写剧本→beat_done 仍是同一轮", async () => {
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
        { text: BEAT_1, beatDone: BEAT_1_STOP },
      ],
      { memory: new PlayMemory({ cards: [CARD] }) },
    );

    await orchestrator.playerAction({ kind: "free", text: "我到了" });

    // 三个 turn 仍属于一轮：只开一次轮、只收一次束、无空轮护栏
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(1);
    expect(messages.filter((m) => m.type === "beat_end")).toHaveLength(1);
    expect(messages.filter((m) => m.type === "error")).toEqual([]);
    const beatEnd = lastBeatEnd(messages);
    if (beatEnd.type === "beat_end") expect(beatEnd.stop?.stopType).toBe("choice");
  });

  it("只调记忆工具就结束（零剧本产出）→ 空轮护栏显式报错、给 pause 重试入口", async () => {
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

    // 只演出一轮：同批调用没有让轮继续空转
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

describe("音频属性进谱系（缺省/停止/音量在重放时要还原得出来）", () => {
  const BEAT_AUDIO = [
    '<scene bg="corridor" bgm="piano" bgm_volume="0.4" ambient="rain" ambient_volume="0.2"/>',
    '<sfx src="door" volume="0.35"/>',
    "<narrate>门在响。</narrate>",
  ].join("\n");

  /** 谱系里 scene 节点的 attrs（重放读的就是它）。 */
  function sceneAttrs(tree: LineageTree): Record<string, string>[] {
    return tree
      .materialize()
      .filter((e) => e.kind === "scene")
      .map((e) => (e.payload?.attrs ?? {}) as Record<string, string>);
  }

  it("音量与音效音量都要进谱系", async () => {
    const { orchestrator, tree } = setup([{ text: BEAT_AUDIO, beatDone: true }]);
    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    expect(sceneAttrs(tree)[0]).toMatchObject({
      bg: "corridor",
      bgm: "piano",
      bgm_volume: "0.4",
      ambient: "rain",
      ambient_volume: "0.2",
    });
    const sfx = tree.materialize().find((e) => e.kind === "sfx");
    expect((sfx?.payload?.attrs ?? {}) as Record<string, string>).toMatchObject({ src: "door", volume: "0.35" });
  });

  it("空串的 bgm/ambient 归一化成 none：显式停止在谱系里不能变成 undefined", async () => {
    const { orchestrator, tree } = setup([
      { text: '<scene bg="corridor" bgm=""/><narrate>静了。</narrate>', beatDone: true },
    ]);
    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    expect(sceneAttrs(tree)[0]).toMatchObject({ bg: "corridor", bgm: "none" });
  });

  it("没写 bgm 就是没写：谱系里不能凭空多出 none（否则每场换景都停乐）", async () => {
    const { orchestrator, tree } = setup([
      { text: '<scene bg="classroom"/><narrate>教室里没人。</narrate>', beatDone: true },
    ]);
    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    expect("bgm" in sceneAttrs(tree)[0]!).toBe(false);
  });
});

describe("DSL 出错回灌（#9：模型得知道自己上一轮哪里被丢了）", () => {
  // 散文混在合法 DSL 之间：这一轮照样演出成功，但多出来的散文被丢了，得回灌给它。
  // 停止点不在正文里，由 beat_done 的工具参数交出（见 helpers.ts 的 beatDone 约定）。
  const BEAT_WITH_PROSE = ["<narrate>她笑了笑。</narrate>", "总之这里应该再细腻一点，氛围也要写出来。"].join("\n");
  const BEAT_WITH_PROSE_DONE = { options: ["道歉", "装没听见"] };

  it("模型夹带散文 → 下一轮 user 消息带【上一轮输出的问题】并讲明只输出 DSL", async () => {
    const contexts: unknown[] = [];
    const { orchestrator } = setup(
      [{ text: BEAT_WITH_PROSE, beatDone: BEAT_WITH_PROSE_DONE }, { text: BEAT_2, beatDone: true }],
      { contexts },
    );

    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });

    const text = lastUserText(contexts as CapturedContext[]);
    expect(text).toContain("【上一轮输出的问题】");
    expect(text).toContain("DSL 之外的散文");
    expect(text).toContain("不要输出 DSL 之外的散文");
  });

  it("干净的一轮不发回灌块（上下文不塞无用的话）", async () => {
    const contexts: unknown[] = [];
    const { orchestrator } = setup([{ text: BEAT_1, beatDone: true }, { text: BEAT_2, beatDone: true }], {
      contexts,
    });

    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });

    expect(lastUserText(contexts as CapturedContext[])).not.toContain("【上一轮输出的问题】");
  });

  it("回灌只发一次：第三轮不该还在念上一轮的问题", async () => {
    const contexts: unknown[] = [];
    const { orchestrator } = setup(
      [
        { text: BEAT_WITH_PROSE, beatDone: BEAT_WITH_PROSE_DONE },
        { text: BEAT_2, beatDone: true },
        { text: BEAT_2, beatDone: true },
      ],
      { contexts },
    );

    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });
    await orchestrator.playerAction({ kind: "continue" });

    const texts = (contexts as CapturedContext[]).map((c) => lastUserText([c]));
    expect(texts.filter((t) => t.includes("【上一轮输出的问题】"))).toHaveLength(1);
  });

  it("回灌限量 8 条：错得再多也别把上下文塞满", async () => {
    const contexts: unknown[] = [];
    const noisy = Array.from({ length: 12 }, (_, i) => `第 ${i} 处多余的散文`).join("\n");
    const { orchestrator } = setup(
      [
        { text: noisy, beatDone: BEAT_WITH_PROSE_DONE },
        { text: BEAT_2, beatDone: true },
      ],
      { contexts },
    );

    await orchestrator.playerAction({ kind: "free", text: "我到了" });
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });

    const bullets = lastUserText(contexts as CapturedContext[])
      .split("\n")
      .filter((l) => l.startsWith("- DSL 之外的散文"));
    expect(bullets).toHaveLength(8);
  });
});

describe("阅读位置落盘（#3：刷新回到读到的那一句）", () => {
  it("setReadPos 进 runtimeState，重启后 readingPos 原样回来", () => {
    const { orchestrator } = setup([{ text: BEAT_1, beatDone: true }]);
    expect(orchestrator.readingPos).toBeNull();

    orchestrator.setReadPos({ seq: 42, len: 7 });
    expect(orchestrator.readingPos).toEqual({ seq: 42, len: 7 });
    expect(orchestrator.runtimeState.readPos).toEqual({ seq: 42, len: 7 });
  });

  it("重复上报同一位置不排第二次落盘（打字机逐字报位置会打爆 session.json）", async () => {
    let persists = 0;
    const { orchestrator } = setup([{ text: BEAT_1, beatDone: true }]);
    (orchestrator as unknown as { opts: { persist: () => void } }).opts.persist = () => {
      persists += 1;
    };

    orchestrator.setReadPos({ seq: 1, len: 1 });
    orchestrator.setReadPos({ seq: 1, len: 1 });
    orchestrator.setReadPos({ seq: 1, len: 2 });
    orchestrator.setReadPos({ seq: 1, len: 2 });
    expect(persists).toBe(0); // 只排队，定时器未到
  });

  it("老档没有 readPos 字段时恢复成 null，客户端退回「快进到末尾」", () => {
    const first = setup([{ text: BEAT_1, beatDone: true }]);
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
      restored: { ...first.orchestrator.runtimeState, readPos: undefined },
    });
    expect(restored.readingPos).toBeNull();
  });
});
