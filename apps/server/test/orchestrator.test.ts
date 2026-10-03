import { describe, expect, it, vi } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { LineageTree, type ServerMessage } from "@aivn/core";
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

  it("插一句（引导）走【用户输入】区且谱系记 prompt 行；停在停止点时只排队，不吞停止点", async () => {
    const contexts: { messages: { role: string }[] }[] = [];
    const { orchestrator, messages, tree } = setup(
      [
        { text: BEAT_1, beatDone: BEAT_1_STOP },
        { text: BEAT_2, beatDone: true },
      ],
      { contexts },
    );
    await orchestrator.playerAction({ kind: "free", text: "开局" });

    // 停在 choice 停止点（空闲态）：引导只入队，选项照旧摆着，自己不开新一轮
    await orchestrator.playerAction({ kind: "prompt", text: "让她先别说话" });
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(1);
    expect(
      tree.materialize().some((e) => e.kind === "prompt" && e.payload?.input === "让她先别说话"),
    ).toBe(false);

    // 玩家点了选项：引导与选项合成同一个用户轮
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(2);
    const userText = lastUserText(contexts);
    expect(userText).toContain("【用户输入】\n让她先别说话");
    expect(userText).toContain("（选择了：道歉）");
    expect(
      tree.materialize()
        .filter((e) => e.kind === "prompt")
        .map((e) => e.payload?.input),
    ).toEqual(["开局", "让她先别说话", "（选择了：道歉）"]);
    // 玩家作过回应，这一轮不用再声明「未作回应」
    expect(userText).not.toContain("未作回应");
  });

  it("引导排队中碰上无停止点的收尾：本轮收完直接兑现（那里没有选项可等）", async () => {
    const contexts: { messages: { role: string }[] }[] = [];
    // 第二轮闸门押后：模拟「玩家在这一轮还在演的时候插了一句」
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { orchestrator, messages } = setup(
      [
        { text: BEAT_1, beatDone: BEAT_1_STOP },
        { text: BEAT_2, beatDone: true, gate },
        { text: BEAT_2, beatDone: true },
      ],
      { contexts },
    );
    await orchestrator.playerAction({ kind: "free", text: "开局" });

    // 玩家点选项 → 第二轮开跑（卡在闸门里）
    const second = orchestrator.playerAction({ kind: "choice", optionIndex: 0 });
    await vi.waitFor(() => {
      expect(orchestrator.isBusy).toBe(true);
    });
    await orchestrator.playerAction({ kind: "prompt", text: "下一轮让澪提到天文社" });
    release();
    await second;

    // 第二轮演完没有停止点 → 排队的引导自己兑现，第三轮
    await vi.waitFor(() => {
      expect(contexts.length).toBe(3);
    });
    expect(lastUserText(contexts)).toContain("【用户输入】\n下一轮让澪提到天文社");
  });

  it("轮内分岔 = 腰斩克隆：被掐断的那轮不写 beat_end，新分支从那一行接上", async () => {
    // 正文先流、收尾押后，等于「剧作家正在写这一轮」；收到 abort 信号才收流，
    // 与真实 provider 的行为同形（默认假流不认 abort，被 abort 后会空转到天荒地老）
    const midBeat: StreamFn = (_model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      const partial = { role: "assistant", content: [] } as AssistantMessage;
      queueMicrotask(() => {
        stream.push({ type: "start", partial });
        stream.push({ type: "text_start", contentIndex: 0, partial });
        for (const delta of BEAT_1.match(/[\s\S]{1,7}/g) ?? []) {
          stream.push({ type: "text_delta", contentIndex: 0, delta, partial });
        }
        stream.push({ type: "text_end", contentIndex: 0, content: BEAT_1, partial });
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
    const { orchestrator, messages, tree } = setup([{ text: BEAT_1 }], { streamFn: midBeat });

    const running = orchestrator.playerAction({ kind: "free", text: "我到了" });
    // 台词行已落树（这一轮还在演）
    await vi.waitFor(() => {
      expect(tree.materialize().some((e) => e.kind === "say")).toBe(true);
    });
    const sayNode = tree.materialize().find((e) => e.kind === "say")!;
    expect(orchestrator.isBusy).toBe(true);

    // 轮中分岔：不等这一轮演完
    await orchestrator.forkTo(sayNode.id);
    await running;

    expect(messages.filter((m) => m.type === "beat_end")).toHaveLength(0);
    expect(messages.some((m) => m.type === "rebase")).toBe(true);
    expect(orchestrator.isBusy).toBe(false);
    // 落点之后的原内容整段转兄弟分支，新分支停在那一行上等玩家开口
    expect(tree.materialize().at(-1)).toMatchObject({ kind: "say", text: "……太慢了！" });
    expect(tree.export().events.some((e) => e.kind === "fork")).toBe(true);
  });

  it("nodeIdAtSeq：舞台只给 seq，落点取该行（行未落树时取它前面那个节点）", async () => {
    const { orchestrator, tree } = setup([{ text: BEAT_1, beatDone: BEAT_1_STOP }]);
    await orchestrator.playerAction({ kind: "free", text: "我到了" });

    const sayNode = tree.materialize().find((e) => e.kind === "say")!;
    // 落点按 seq 解析：台词行取它自己
    expect(orchestrator.nodeIdAtSeq(sayNode.payload?.seq)).toBe(sayNode.id);
    // 没有 seq（没在演任何东西）就没有落点
    expect(orchestrator.nodeIdAtSeq(undefined)).toBeNull();
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

  it("判废：零产出 → 回滚并原样重演一次，仍写不出来就退回输入之前报错（不静默伪装 no_stop，P0）", async () => {
    const contexts: unknown[] = [];
    const { orchestrator, messages } = setup([{ text: "", beatDone: true }], { contexts });

    await orchestrator.playerAction({ kind: "free", text: "开局" });

    // 两跑：首跑判废 → 回滚 → 同一段输入原样重演（发出去的是那段原文，不是缩水的【状态】轮）
    expect(contexts).toHaveLength(2);
    expect(lastUserText(contexts as CapturedContext[])).toContain("开局");
    const rebases = messages.filter((m) => m.type === "rebase");
    expect(rebases).toHaveLength(2);
    // 重演那一跑：客户端进等待态，不该把旧台词摆成终局；舞台整段倒回去重放，得给个说法
    expect(rebases[0]).toMatchObject({ resuming: true });
    if (rebases[0].type === "rebase") expect(rebases[0].note).toContain("原样重演");
    // 第二跑还是零产出：退回「这段输入还没发出去」的那一刻，给玩家一个 pause 出口
    expect(rebases[1]).toMatchObject({ reason: "stop", stop: { stopType: "pause" } });
    // 判废的轮不落 beat_end：它没有产出，不该在谱系里留下一拍
    expect(messages.some((m) => m.type === "beat_end")).toBe(false);
    const errors = messages.filter((m) => m.type === "error");
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toContain("生成失败");
    expect(orchestrator.isBusy).toBe(false);
  });

  it("判废：provider 抛错（网关 429/断网）→ 也重演一次，仍失败就连原因一起报出来", async () => {
    const messages: ServerMessage[] = [];
    let calls = 0;
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: () => {
        calls += 1;
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

    // 一次性的硬故障值得再试一次（超时那一类才不试，见下一条）
    expect(calls).toBe(2);
    const error = messages.find((m) => m.type === "error");
    expect(error?.type).toBe("error");
    if (error?.type === "error") {
      expect(error.message).toContain("insufficient balance");
      expect(error.message).toContain("已自动重演一次");
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
    // 恢复出来的停止点摆着选项，玩家只能答选项——「继续」在这里不成立（见下一个用例）
    await restored.playerAction({ kind: "choice", optionIndex: 0 });
    const seqAfter = restored.eventsAfter(total);
    expect(seqAfter.length).toBeGreaterThan(0);
    expect(seqAfter.some((e) => e.event.kind === "say_start")).toBe(true);
  });

  it("停止点还没作答时拒收「继续」：不许替玩家把选项跳过去", async () => {
    const { orchestrator, messages } = setup([
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
    ]);
    await orchestrator.playerAction({ kind: "free", text: "开局" });

    await orchestrator.playerAction({ kind: "continue" });

    expect(messages.filter((m) => m.type === "error").map((m) => (m as { message: string }).message))
      .toContain("还有选择没作答");
    // 没有新一轮：选项还摆着
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(1);
    // pause 是编排器自造的重试口，不算没答完的停止点，照常放行
    const forked = setup([
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
    ]);
    await forked.orchestrator.playerAction({ kind: "free", text: "开局" });
    await forked.orchestrator.forkTo(forked.tree.materialize().find((e) => e.kind === "say")!.id);
    expect(forked.orchestrator.runtimeState.lastStop?.stopType).toBe("pause");
    await forked.orchestrator.playerAction({ kind: "continue" });
    expect(forked.messages.filter((m) => m.type === "beat_start")).toHaveLength(2);
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
    let calls = 0;
    const hung: StreamFn = (_model, _context, options) => {
      calls += 1;
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
    // 超时不重演：网关挂住是「路不通」，再来一次只是让玩家再等一个超时
    expect(calls).toBe(1);
    // 判废退回输入之前：没有产出的轮不该在档里留下一拍，轮号也跟着退回去
    expect(orchestrator.runtimeState.beatNo).toBe(0);
    // 收束后必须回到空闲：下一轮还能开，否则是卡死而不是超时
    expect(orchestrator.isBusy).toBe(false);
  });
});

/** 先流出一句台词、再以 provider 故障收束的一轮：内容已经出去了，故障是后话。 */
function lineThenError(text: string, errorMessage: string): StreamFn {
  return () => {
    const stream = createAssistantMessageEventStream();
    const partial = { role: "assistant", content: [] } as AssistantMessage;
    queueMicrotask(() => {
      stream.push({ type: "start", partial });
      stream.push({ type: "text_start", contentIndex: 0, partial });
      stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial });
      stream.push({ type: "text_end", contentIndex: 0, content: text, partial });
      const message: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text }],
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
        errorMessage,
        timestamp: Date.now(),
      };
      stream.push({ type: "done", message });
      stream.end(message);
    });
    return stream;
  };
}

describe("判废与重演（零台词的轮当没发生过）", () => {
  it("判据只看台词：换了场景但一句台词没写出来，一样判废重演", async () => {
    const contexts: unknown[] = [];
    const { orchestrator, messages, tree } = setup(
      [
        // 首跑：改了背景 + 一段被解析器丢弃的裸散文 → 有事件、零台词
        { text: '<scene bg="rooftop_dusk" bgm="melancholy" transition="fade"/>\n抱歉，我无法继续这个场景。' },
        { text: BEAT_2, beatDone: true },
      ],
      { contexts },
    );

    await orchestrator.playerAction({ kind: "free", text: "开局" });

    expect(contexts).toHaveLength(2);
    // 首跑那一整段进了废弃分支（谱系留痕、但不在当前世界线上）：
    // 当前路径上没有它的场景指令，「改了一半的背景」也一起退回去了
    const kinds = tree.materialize(tree.leafId).map((node) => node.kind);
    expect(kinds.filter((kind) => kind === "scene")).toHaveLength(0);
    expect(tree.export().events.some((event) => event.kind === "scene")).toBe(true);
    expect(orchestrator.currentScene).toBe(PLAY.initialScene);
    // 胜出的是重演那一跑：一次 resuming 重建 + 一次正常收束，中间不报错
    expect(messages.filter((m) => m.type === "rebase")).toHaveLength(1);
    expect(messages.filter((m) => m.type === "error")).toHaveLength(0);
    expect(lastBeatEnd(messages)).toMatchObject({ reason: "no_stop" });
    // 拒答原文不进剧作家历史：作废那一轮的记录随回滚一起退掉
    const history = JSON.stringify(orchestrator.history);
    expect(history).toContain("风停了");
    expect(history).not.toContain("抱歉");
  });

  it("有台词就是有产出：中途报错的轮不回滚、不重演", async () => {
    let calls = 0;
    const base = lineThenError('<say id="mio" mood="annoyed">……太慢了！</say>', "gateway exploded");
    const { orchestrator, messages } = setup([], {
      streamFn: (model, context, options) => {
        calls += 1;
        return base(model, context, options);
      },
    });

    await orchestrator.playerAction({ kind: "free", text: "开局" });

    // 玩家已经看见的内容不抽走：报错归报错，这一轮照常收束
    expect(calls).toBe(1);
    expect(messages.filter((m) => m.type === "rebase")).toHaveLength(0);
    const error = messages.find((m) => m.type === "error");
    if (error?.type === "error") expect(error.message).toContain("gateway exploded");
    expect(lastBeatEnd(messages)).toMatchObject({ reason: "no_stop" });
    expect(orchestrator.history.length).toBe(1);
  });

  it("交出停止点就是有产出：纯选择轮（零台词）不判废", async () => {
    const { orchestrator, messages } = setup([
      { text: '<scene bg="rooftop_dusk"/>', beatDone: { options: ["下去看看", "留在天台"] } },
    ]);

    await orchestrator.playerAction({ kind: "free", text: "开局" });

    expect(messages.filter((m) => m.type === "rebase")).toHaveLength(0);
    expect(messages.filter((m) => m.type === "error")).toHaveLength(0);
    const beatEnd = lastBeatEnd(messages);
    expect(beatEnd).toMatchObject({ reason: "stop" });
    if (beatEnd.type === "beat_end") expect(beatEnd.stop?.options).toHaveLength(2);
  });

  it("重演也用完：退回上一处——选项复原、引导回队列、错误在重建之后发出", async () => {
    const { orchestrator, messages } = setup([
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: "" },
      { text: "" },
    ]);

    // 开局停在选项上
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    expect(lastBeatEnd(messages)).toMatchObject({ reason: "stop" });
    // 排队一句引导，再选一个选项：两句合成同一轮（这一轮连写两跑都写不出来）
    await orchestrator.playerAction({ kind: "prompt", text: "别太凶" });
    const before = messages.length;
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });

    const since = messages.slice(before);
    expect(since.filter((m) => m.type === "beat_end")).toHaveLength(0);
    const rebase = since.filter((m) => m.type === "rebase").at(-1);
    // 上一轮的停止点原样回到面板：选项还是那两条
    expect(rebase).toMatchObject({ reason: "stop", stop: { stopType: "choice" } });
    if (rebase?.type === "rebase") expect(rebase.stop?.options?.map((o) => o.text)).toEqual(["道歉", "装傻"]);
    // 没兑现的那句引导还给玩家：还在队列里，可改可撤
    const queue = since.filter((m) => m.type === "prompt_queue").at(-1);
    if (queue?.type === "prompt_queue") {
      expect(queue.items.filter((item) => item.status === "pending")).toMatchObject([
        { text: "别太凶" },
      ]);
    }
    // 报错在重建之后：客户端的 rebase 处理会把已有的 error 状态清空
    expect(since.map((m) => m.type).indexOf("error")).toBeGreaterThan(
      since.map((m) => m.type).lastIndexOf("rebase"),
    );
    // 这一轮整个退掉了：轮号、谱系、停止点都回到选完之前
    expect(orchestrator.runtimeState.beatNo).toBe(1);
    expect(orchestrator.stoppedReplay?.stop?.options?.map((o) => o.text)).toEqual(["道歉", "装傻"]);
  });

  it("退回上一处没有停止点时补一个 pause 出口：退回来的引导不会把引擎拖进无限循环", async () => {
    let calls = 0;
    const base = createFakeStreamFn([{ text: BEAT_2, beatDone: true }, { text: "" }]);
    const { orchestrator, messages } = setup([], {
      streamFn: (model, context, options) => {
        calls += 1;
        return base(model, context, options);
      },
    });

    // 第一轮正常演完，但**没有**交出停止点（自然演完那种收尾）
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await orchestrator.playerAction({ kind: "prompt", text: "别太凶" });
    expect(calls).toBe(1);
    const before = messages.length;
    await orchestrator.playerAction({ kind: "continue" });

    // 连写两跑都写不出来 → 退回「这句引导还没发出去」的那一刻
    const since = messages.slice(before);
    const rebase = since.filter((m) => m.type === "rebase").at(-1);
    // 上一处本来没有停止点，退回时必须补一个 pause 出口：没有出口时 onBeatSettled
    // 会立刻把刚退回来的引导合成下一轮，于是失败自我循环（真机验证时实测到的）
    expect(rebase).toMatchObject({ reason: "stop", stop: { stopType: "pause" } });
    expect(since.filter((m) => m.type === "error")).toHaveLength(1);

    // 收束之后不许自己再开一轮：这一轮就是「首跑 + 重演」两跑（共 3 次流），
    // 再往下多出来的每一次都是引擎自己接上的下一次失败
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toBe(3);
    expect(orchestrator.isBusy).toBe(false);
    const queue = since.filter((m) => m.type === "prompt_queue").at(-1);
    if (queue?.type === "prompt_queue") {
      expect(queue.items.filter((item) => item.status === "pending")).toMatchObject([
        { text: "别太凶" },
      ]);
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

  it("update_state 写 stateFiles；read_memory_detail 命中与未命中", async () => {
    const engine = { turn: 1, affinity: {}, flags: {} };
    const { tools, stateFiles } = makeTools(engine);
    const write = tools.find((t) => t.name === "update_state")!;
    const read = tools.find((t) => t.name === "read_memory_detail")!;

    await write.execute("t1", {
      threads: "伏笔：旧约定未兑现",
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

  it("create_character 不教剧作家调它没有的工具：音色归搭台助手", () => {
    const { tools } = makeTools({ turn: 1, affinity: {}, flags: {} });
    const create = tools.find((t) => t.name === "create_character")!;
    // list_voices 只装给工坊（kit.ts 的 roles）；剧作家照抄这句只会去猜一个 32 位 hex
    expect(create.description).not.toContain("list_voices");
    expect(create.description).toContain("搭台助手");
  });

  it("write_memory：路径守卫 + 即时进 cards", async () => {
    const { tools, memory } = makeTools({ turn: 1, affinity: {}, flags: {} });
    const written: [string, string][] = [];
    // makeTools 没传 writeMemoryCard 时工具只回提示；这里补一条验证写链路
    const toolsWithWrite = createMemoryTools({
      engine: { turn: 1, affinity: {}, flags: {} },
      characterIds: new Set(["mio"]),
      memory,
      tree: new LineageTree(),
      stateFiles: {},
      arcIds: () => [],
      writeMemoryCard: async (rel, content) => {
        written.push([rel, content]);
        await memory.appendCard(rel, content);
      },
    });
    const write = toolsWithWrite.find((t) => t.name === "write_memory")!;

    const ok = await write.execute("t1", {
      file: "lore/新设定",
      content: "# 新设定\n一句话摘要。\n",
    });
    expect(textOf(ok)).toContain("lore/新设定.md");
    expect(written).toHaveLength(1);
    expect(memory.readCard("新设定")).toContain("一句话摘要");

    // 路径守卫：always/arcs/archive 与 .. 一律拒绝，不碰 deps
    for (const bad of ["always/craft", "arcs/e1", "archive/x", "../escape", "/abs", ".hidden"]) {
      const rejected = await write.execute("t-bad", { file: bad, content: "x" });
      expect(textOf(rejected)).toContain("路径非法");
    }
    expect(written).toHaveLength(1);

    // 没传 writeMemoryCard 时只回提示
    const noWrite = tools.find((t) => t.name === "write_memory")!;
    expect(textOf(await noWrite.execute("t2", { file: "lore/x", content: "x" }))).toContain("工坊");
  });

  it("同轮 create_character 建卡后，update_state 可写新角色好感（liveCharacterIds 即 add）", async () => {
    // 编排器把构造时快照换成了可变集：建卡回调包一层 add。这里直接验证工具层语义——
    // 同一个 characterIds Set 在建卡后 add，新角色即放行。
    const ids = new Set(["mio"]);
    const engine = { turn: 1, affinity: {}, flags: {} };
    const tree = new LineageTree();
    const stateFiles: Record<string, string> = {};
    const memory = new PlayMemory({ cards: [] });
    const tools = createMemoryTools({
      engine,
      characterIds: ids,
      memory,
      tree,
      stateFiles,
      arcIds: () => [],
    });
    const update = tools.find((t) => t.name === "update_state")!;
    const before = await update.execute("t1", { affinity: { newcomer: 2 } });
    expect(textOf(before)).toContain("不是本剧角色");
    ids.add("newcomer"); // = 编排器 liveCharacterIds 包的那层 add
    const after = await update.execute("t2", { affinity: { newcomer: 2 } });
    expect(textOf(after)).toContain("newcomer +2");
    expect(engine.affinity.newcomer).toBe(2);
  });
});

describe("A 区角色分级：冷启动与热启动一致", () => {
  const bigCast = new Map<string, CharacterDocument>([
    ["protagonist", { id: "protagonist", name: "你", body: "主角人设。" }],
    ["mio", { id: "mio", name: "澪", body: "澪的完整人设，天文社社长。" }],
    ["koharu", { id: "koharu", name: "小春", body: "小春的完整人设，后辈。" }],
    ["rin", { id: "rin", name: "凛", body: "凛的完整人设，老师。" }],
    ["sora", { id: "sora", name: "空", body: "空的完整人设，转学生。" }],
    ["yuki", { id: "yuki", name: "雪", body: "雪的完整人设，神秘少女。" }],
  ]);

  it("从存档恢复：事件缓冲先回填，重建出的 A 区已按在场角色分级", async () => {
    const contexts: { messages: { role: string }[] }[] = [];
    // 先跑一轮热启动拿到真实事件缓冲与 seq
    const warm = setup([{ text: BEAT_1, beatDone: BEAT_1_STOP }], {
      contexts,
      memory: new PlayMemory({ characters: bigCast, cards: [] }),
    });
    await warm.orchestrator.playerAction({ kind: "free", text: "开局" });
    const runtimeState = warm.orchestrator.runtimeState;
    expect(runtimeState.events.length).toBeGreaterThan(0);

    // 用它冷启动（服务器重启续演）：A 区必须和热启动一样认出澪在场
    const coldContexts: { messages: { role: string }[] }[] = [];
    const cold = setup([{ text: BEAT_2, beatDone: true }], {
      contexts: coldContexts,
      memory: new PlayMemory({ characters: bigCast, cards: [] }),
      restored: runtimeState,
    });
    await cold.orchestrator.playerAction({ kind: "choice", optionIndex: 0 });

    const coldSystem = JSON.stringify(coldContexts.at(-1)?.messages[0]);
    // 澪在第一轮说过话 → 在场 → 全卡人设必须在
    expect(coldSystem).toContain("澪的完整人设");
    // 从未出场的角色折叠成一行（没有 ### 全卡头）
    expect(coldSystem).not.toContain("### 雪（id: yuki）");
    expect(coldSystem).toContain("- 雪（id: yuki）：");
    expect(coldSystem).toContain("上面最后几行是最近没出场的人物");
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
    await orchestrator.whenIdle();

    // 轮 1 收在选择点上：引导不抢在选项前头兑现，它等玩家先表态
    expect(messages.filter((m) => m.type === "error")).toEqual([]);
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(1);
    expect(call).toBe(1);
    const heldQueue = messages.filter((m) => m.type === "prompt_queue").at(-1);
    expect(heldQueue?.type === "prompt_queue" && heldQueue.items).toHaveLength(1);

    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });
    await orchestrator.whenIdle();

    // 玩家点了选项 → 引导与选项同一轮发出去
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(2);
    expect(call).toBe(2);
    expect(lastUserText(contexts)).toContain("【用户输入】\n节奏加快一点");
    expect(lastUserText(contexts)).toContain("（选择了：道歉）");
    // 玩家作过回应，这一轮不用再声明「未作回应」
    expect(lastUserText(contexts)).not.toContain("未作回应");
    // 兑现完就把队列清空：面板标题写的是「接下来要说的话」，没有下一句就不该还挂着
    const settledQueue = messages.filter((m) => m.type === "prompt_queue").at(-1);
    expect(settledQueue?.type === "prompt_queue" && settledQueue.items).toEqual([]);
  });

  it("update_state 落谱系快照 → 恢复后注入【状态】（服务器重启续演）", async () => {
    // 记忆工具与 beat_done 分处两个 turn（beat_done 必须独占批次，否则 terminate 被吞）
    const first = setup([
      {
        text: BEAT_1,
        toolCalls: [
          {
            name: "update_state",
            args: { scene: "黄昏，教室只剩两人" },
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

  it("只调记忆工具就结束（零剧本产出）→ 判废退回输入之前，报错并给 pause 重试入口", async () => {
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
    // 控制指令与工具调用都不算「写出了东西」：退回输入之前，一轮都没留下
    expect(messages.filter((m) => m.type === "beat_end")).toHaveLength(0);
    const rebase = messages.filter((m) => m.type === "rebase").at(-1);
    expect(rebase).toMatchObject({ reason: "stop", stop: { stopType: "pause" } });
  });

  it("beat_done 与记忆工具同批 → finishTurn 兜底收束（terminate 不被 batch 吞掉）", async () => {
    const { orchestrator, messages } = setup([
      {
        text: BEAT_1,
        beatDone: true,
        toolCalls: [
          {
            name: "update_state",
            args: { threads: "伏笔：旧约定" },
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

    orchestrator.setReadPos({ nodeId: "n_42", offset: 7, seq: 42, len: 7 });
    expect(orchestrator.readingPos).toEqual({ nodeId: "n_42", offset: 7, seq: 42, len: 7 });
    expect(orchestrator.runtimeState.readPos).toEqual({ nodeId: "n_42", offset: 7, seq: 42, len: 7 });
  });

  it("重复上报同一位置不排第二次落盘（打字机逐字报位置会打爆 session.json）", async () => {
    let persists = 0;
    const { orchestrator } = setup([{ text: BEAT_1, beatDone: true }]);
    (orchestrator as unknown as { opts: { persist: () => void } }).opts.persist = () => {
      persists += 1;
    };

    orchestrator.setReadPos({ nodeId: "n_1", offset: 1 });
    orchestrator.setReadPos({ nodeId: "n_1", offset: 1 });
    orchestrator.setReadPos({ nodeId: "n_1", offset: 2 });
    orchestrator.setReadPos({ nodeId: "n_1", offset: 2 });
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

describe("跳转的播放头语义（playFrom）", () => {
  /** 走完两拍：第一拍停在选项上，选了第一条把第二拍演完（无停止点收尾）。 */
  async function twoBeats() {
    let calls = 0;
    const base = createFakeStreamFn([
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
    ]);
    const built = setup([], {
      streamFn: (model, context, options) => {
        calls += 1;
        return base(model, context, options);
      },
    });
    await built.orchestrator.playerAction({ kind: "free", text: "我到了" });
    await built.orchestrator.playerAction({ kind: "choice", optionIndex: 0 });
    return { ...built, callCount: () => calls };
  }

  it("回到选项：playFrom=end 把播放头放在这一轮末尾，不再合成 pause 去叫剧作家", async () => {
    const { orchestrator, messages, tree, callCount } = await twoBeats();
    const target = tree.materialize().at(-1)!;
    expect(target.kind).toBe("beat_end");
    const callsBefore = callCount();

    messages.length = 0;
    await orchestrator.jumpTo(target.id, { playFrom: "end" });

    expect(callCount()).toBe(callsBefore);
    const rebase = messages.at(-1)!;
    expect(rebase.type).toBe("rebase");
    if (rebase.type !== "rebase") return;
    expect(rebase.playFrom).toBe("end");
    expect(rebase.resumeAt).toEqual({ nodeId: target.id, offset: 0 });
    // 这一轮本来就没有停止点 → 重建后是一个普通的「继续」，不是自造的 pause
    expect(rebase.reason).toBe("no_stop");
    expect(rebase.stop).toBeUndefined();
  });

  it("从头重读：playFrom=start 不产出一个字，播放头落在本轮第一句", async () => {
    const { orchestrator, messages, tree, callCount } = await twoBeats();
    const chain = tree.materialize();
    const target = chain.at(-1)!;
    const firstLine = chain.find((e) => e.text === "……算了。")!;
    const callsBefore = callCount();

    messages.length = 0;
    await orchestrator.jumpTo(target.id, { playFrom: "start" });

    expect(callCount()).toBe(callsBefore); // 一个字都没生成
    expect(orchestrator.isBusy).toBe(false);
    expect(messages.some((m) => m.type === "beat_end")).toBe(false);
    const rebase = messages.at(-1)!;
    if (rebase.type !== "rebase") throw new Error("跳转必须广播 rebase");
    expect(rebase.playFrom).toBe("start");
    // 轮首的换景/立绘不算「第一句」，播放头落在第一句台词上
    expect(rebase.resumeAt).toEqual({ nodeId: firstLine.id, offset: 0 });
    expect(orchestrator.readingPos).toEqual({ nodeId: firstLine.id, offset: 0 });
  });

  it("回到旧轮末尾选另一个选项：新内容挂在那个轮末，旧分支整段留成兄弟", async () => {
    const { orchestrator, messages, tree } = await twoBeats();
    const beatEnds = tree.materialize().filter((e) => e.kind === "beat_end");
    expect(beatEnds).toHaveLength(2);
    const firstBeatEnd = beatEnds[0]!;
    const oldBranchSay = tree.materialize().find((e) => e.text === "……算了。")!;
    const oldBranchNarrate = tree.materialize().find((e) => e.text === "风停了。")!;

    messages.length = 0;
    await orchestrator.jumpTo(firstBeatEnd.id, { playFrom: "end" });

    // 跳回去之后选项原样回到面板上——玩家才可能改选
    const rebase = messages.at(-1)!;
    if (rebase.type !== "rebase") throw new Error("跳转必须广播 rebase");
    expect(rebase.stop).toMatchObject({ stopType: "choice", options: [{ text: "道歉" }, { text: "装傻" }] });

    await orchestrator.playerAction({ kind: "choice", optionIndex: 1 });

    // 新分支的第一条节点（这次选择的输入）认分岔源为父——绝不能挂到旧叶子上
    const prompt = tree.materialize().find((e) => e.payload?.input === "（选择了：装傻）")!;
    expect(tree.get(prompt.id)?.parentId).toBe(firstBeatEnd.id);
    const newSay = tree.materialize().find((e) => e.text === "……算了。")!;
    expect(newSay.id).not.toBe(oldBranchSay.id);
    expect(tree.get(newSay.id)?.parentId).toBe(prompt.id);

    // 旧分支没被改写也没被删：它退成兄弟，仍在树里，但不在当前世界线上
    expect(tree.get(oldBranchSay.id)).toBeTruthy();
    expect(tree.get(oldBranchNarrate.id)).toBeTruthy();
    expect(tree.materialize().some((e) => e.id === oldBranchNarrate.id)).toBe(false);
    // 新分支确实把这一轮演完了
    const newNarrate = tree.materialize().find((e) => e.text === "风停了。")!;
    expect(newNarrate.id).not.toBe(oldBranchNarrate.id);
    expect(tree.materialize().at(-1)?.kind).toBe("beat_end");
  });
});

describe("限制级（NSFW）模式切换与上下文隔离", () => {
  it("调用 enter_nsfw 后下一轮注入 NSFW 前置合规轮次，调用 exit_nsfw 后切回 SFW 摘要", async () => {
    const contexts: CapturedContext[] = [];
    const responses: FakeResponse[] = [
      // 第 1 轮：日常铺垫，并在本轮调用 enter_nsfw
      {
        text: '<say id="mio">来我房间吧……</say>',
        beatDone: true,
        toolCalls: [{ name: "enter_nsfw", args: { reason: "进入房间亲密接触" } }],
      },
      // 第 2 轮：限制级描写，并在本轮同时调用 exit_nsfw + beat_done
      {
        text: '<say id="mio">笨蛋……轻一点……</say>',
        beatDone: true,
        toolCalls: [{ name: "exit_nsfw", args: { summary: "两人在房间内度过了温存亲密的一夜。" } }],
      },
      // 摘要生成阶段的 LLM 补全响应
      {
        text: "两人在房间内互诉心意，度过了温存亲密的一夜，彼此关系有了重大突破。",
      },
      // 第 3 轮：切回主模型日常
      {
        text: '<scene bg="morning_room"/><say id="mio">早啊……昨晚睡得好吗？</say>',
        beatDone: true,
      },
    ];

    const { orchestrator } = setup(responses, { contexts });
    orchestrator.start();
    await orchestrator.whenIdle();

    // 第 1 轮演完，已请求 enter_nsfw
    expect(orchestrator.runtimeState.beatNo).toBe(1);

    // 触发第 2 轮（进入 NSFW 模式）
    await orchestrator.playerAction({ kind: "continue" });
    await orchestrator.whenIdle();

    // 验证第 2 轮的上下文中包含了 NSFW 前置合规轮次
    const nsfwContext = contexts[1]!;
    const hasPreTurn = nsfwContext.messages.some(
      (m) => typeof m.content === "string" && m.content.includes("20 周岁以上"),
    );
    expect(hasPreTurn).toBe(true);

    // 触发第 3 轮（已切回 SFW 主模型）
    await orchestrator.playerAction({ kind: "continue" });
    await orchestrator.whenIdle();

    expect(orchestrator.runtimeState.beatNo).toBe(3);
    // 验证第 3 轮上下文：NSFW 前置合规轮次已被剥离，且包含了 SFW 摘要前情提要
    const sfwContext = contexts[3]!;
    const stillHasPreTurn = sfwContext.messages.some(
      (m) => typeof m.content === "string" && m.content.includes("20 周岁以上"),
    );
    expect(stillHasPreTurn).toBe(false);

    // 验证第 3 轮的 user 消息中包含了 SFW 摘要内容
    const userMessages = sfwContext.messages.filter((m) => m.role === "user");
    const combinedUserText = userMessages.map((m) => String(m.content)).join("\n");
    expect(combinedUserText).toContain("【前情提要·日常接续】");
    expect(combinedUserText).toContain("温存亲密的一夜");
    // 露骨台词不应在主模型消息中出现
    expect(combinedUserText).not.toContain("轻一点");
  });

  it("从限制级分支跳转或分岔回日常节点时，NSFW 状态重置为 false，不会滞留限制级模式", async () => {
    const contexts: CapturedContext[] = [];
    const responses: FakeResponse[] = [
      // 第 1 轮：日常
      {
        text: '<say id="mio">今天天气真好。</say>',
        beatDone: true,
      },
      // 第 2 轮：进入限制级
      {
        text: '<say id="mio">来吧……</say>',
        beatDone: true,
        toolCalls: [{ name: "enter_nsfw", args: {} }],
      },
      // 第 3 轮：限制级
      {
        text: '<say id="mio">亲爱的……</say>',
        beatDone: true,
      },
    ];

    const { orchestrator, tree } = setup(responses, { contexts });
    orchestrator.start();
    await orchestrator.whenIdle();
    const beat1NodeId = tree.leafId!;

    // 演第 2 轮
    await orchestrator.playerAction({ kind: "continue" });
    await orchestrator.whenIdle();

    // 演第 3 轮（NSFW 中）
    await orchestrator.playerAction({ kind: "continue" });
    await orchestrator.whenIdle();
    expect(orchestrator.runtimeState.nsfw?.active).toBe(true);

    // 跳转回第 1 轮节点
    await orchestrator.jumpTo(beat1NodeId);
    expect(orchestrator.runtimeState.nsfw?.active).toBe(false);

    // 验证当前 agent messages 中无 NSFW 前置合规轮次
    const currentAgentMessages = (orchestrator as unknown as { agent: { state: { messages: unknown[] } } })
      .agent.state.messages;
    const hasPreTurn = currentAgentMessages.some(
      (m: unknown) => typeof (m as { content?: string }).content === "string" && (m as { content: string }).content.includes("20 周岁以上"),
    );
    expect(hasPreTurn).toBe(false);
  });
});

/** 数模型调用次数：走回旧路的核心判据就是「这一拍没有让剧作家再写一遍」。 */
function countingSetup(responses: FakeResponse[]): {
  orchestrator: PlaywrightOrchestrator;
  messages: ServerMessage[];
  tree: LineageTree;
  calls: { n: number };
} {
  const calls = { n: 0 };
  const base = createFakeStreamFn(responses);
  const streamFn: StreamFn = (model, context, options) => {
    calls.n += 1;
    return base(model, context, options);
  };
  return { ...setup(responses, { streamFn }), calls };
}

/** 演两拍：开场（停在选项）→ 选「道歉」演第二拍。返回两拍的 beat_end 与第二拍的输入节点。 */
async function playTwoBeats(
  orchestrator: PlaywrightOrchestrator,
  tree: LineageTree,
): Promise<{ beat1End: string; beat2End: string; beat2Prompt: string }> {
  orchestrator.start();
  await orchestrator.whenIdle();
  await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });
  await orchestrator.whenIdle();
  const chain = tree.ancestorChain(tree.leafId).map((id) => tree.get(id)!);
  const ends = chain.filter((e) => e.kind === "beat_end");
  return {
    beat1End: ends[0]!.id,
    beat2End: ends[1]!.id,
    beat2Prompt: chain.find((e) => e.kind === "prompt")!.id,
  };
}

/** 最近一条 rebase 消息的说明与播放头朝向。 */
function lastRebase(messages: readonly ServerMessage[]): { note?: string; playFrom?: string; keepView?: boolean } {
  return messages.filter((m) => m.type === "rebase").at(-1) as {
    note?: string;
    playFrom?: string;
    keepView?: boolean;
  };
}

describe("回到旧轮走原路（同一个动作不重写一遍）", () => {
  it("重选同一个选项：不调模型，世界线接回旧那一拍", async () => {
    const responses: FakeResponse[] = [
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
      { text: BEAT_2, beatDone: true },
    ];
    const { orchestrator, messages, tree, calls } = countingSetup(responses);
    const { beat1End, beat2End } = await playTwoBeats(orchestrator, tree);
    const called = calls.n;

    await orchestrator.jumpTo(beat1End, { playFrom: "start" });
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });

    expect(calls.n).toBe(called);
    expect(tree.leafId).toBe(beat2End);
    expect(lastRebase(messages).note).toBe("顺着原路继续");
    // 从头重读这一拍：播放头钉在这一拍的开头，不是直接摊开末尾
    expect(lastRebase(messages).playFrom).toBe("start");
    // 旧枝没有被复制出一条：锚点之下仍然只有那一拍
    expect(tree.childrenOf(beat1End)).toHaveLength(1);
  });

  it("改选别的选项：照旧生成新枝", async () => {
    const responses: FakeResponse[] = [
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
      { text: '<say id="mio">……也行。</say>', beatDone: true },
    ];
    const { orchestrator, tree, calls } = countingSetup(responses);
    const { beat1End, beat2End, beat2Prompt } = await playTwoBeats(orchestrator, tree);
    const called = calls.n;

    await orchestrator.jumpTo(beat1End, { playFrom: "start" });
    await orchestrator.playerAction({ kind: "choice", optionIndex: 1 });
    await orchestrator.whenIdle();

    expect(calls.n).toBe(called + 1);
    expect(tree.childrenOf(beat1End).map((e) => e.payload?.input)).toEqual([
      "（选择了：道歉）",
      "（选择了：装傻）",
    ]);
    expect(tree.get(beat2Prompt)).toBeDefined();
    expect(tree.get(beat2End)).toBeDefined();
  });

  it("排了引导就不认旧路：玩家排了话就是要新的走向", async () => {
    const responses: FakeResponse[] = [
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
      { text: '<say id="mio">……换个说法。</say>', beatDone: true },
    ];
    const { orchestrator, tree, calls } = countingSetup(responses);
    const { beat1End, beat2End } = await playTwoBeats(orchestrator, tree);
    const called = calls.n;

    await orchestrator.jumpTo(beat1End, { playFrom: "start" });
    await orchestrator.playerAction({ kind: "prompt", text: "让气氛冷一点" });
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });
    await orchestrator.whenIdle();

    expect(calls.n).toBe(called + 1);
    expect(tree.leafId).not.toBe(beat2End);
  });

  it("轮中被锚定时「继续」不认旧路：子节点是本轮的下一句，接回去等于接回自己后半截", async () => {
    const responses: FakeResponse[] = [
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
    ];
    const { orchestrator, tree, calls } = countingSetup(responses);
    orchestrator.start();
    await orchestrator.whenIdle();
    const spoken = tree
      .ancestorChain(tree.leafId)
      .map((id) => tree.get(id)!)
      .find((e) => e.kind === "say")!;

    await orchestrator.jumpTo(spoken.id, { playFrom: "start" });
    const called = calls.n;
    await orchestrator.playerAction({ kind: "continue" });
    await orchestrator.whenIdle();

    expect(calls.n).toBe(called + 1);
  });

  it("子树被剪空的 fork 不参选：不把世界线接进一片空白", async () => {
    const responses: FakeResponse[] = [
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
      { text: BEAT_2, beatDone: true },
    ];
    const { orchestrator, tree, calls } = countingSetup(responses);
    const { beat1End, beat2End } = await playTwoBeats(orchestrator, tree);
    // 一个来源标签相同、却没有孩子的空壳（删枝之后可能剩下的那种）
    tree.recordFork(beat1End, { origin: "input:（选择了：道歉）" });

    await orchestrator.jumpTo(beat1End, { playFrom: "start" });
    const called = calls.n;
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });

    expect(calls.n).toBe(called);
    expect(tree.leafId).toBe(beat2End);
  });
});

describe("重写继承来源（同选项认得出刚重写的那条枝）", () => {
  const rewritten = '<say id="mio">……算了，走吧。</say>';

  it("路线卡片点名 replaced：新枝带同样的来源标签，回同一锚点重选走重写那条", async () => {
    const responses: FakeResponse[] = [
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
      { text: rewritten, beatDone: true },
    ];
    const { orchestrator, tree, calls } = countingSetup(responses);
    const { beat1End, beat2End, beat2Prompt } = await playTwoBeats(orchestrator, tree);

    await orchestrator.forkTo(beat1End, { resume: true, replaced: beat2Prompt });
    await orchestrator.whenIdle();
    const rewrittenEnd = tree.leafId!;
    expect(rewrittenEnd).not.toBe(beat2End);

    await orchestrator.jumpTo(beat1End, { playFrom: "start" });
    const called = calls.n;
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });

    expect(calls.n).toBe(called);
    // 「最后去过的那条枝」= 刚重写出来的那条，而不是原来那条
    expect(tree.leafId).toBe(rewrittenEnd);
  });

  it("没点名 replaced 时看世界线落在哪：舞台导演栏的重写走这条", async () => {
    const responses: FakeResponse[] = [
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
      { text: rewritten, beatDone: true },
    ];
    const { orchestrator, tree, calls } = countingSetup(responses);
    const { beat1End } = await playTwoBeats(orchestrator, tree);

    // 世界线还在第二拍末梢：锚点之下路径上的那个孩子就是被顶掉的那一拍
    await orchestrator.forkTo(beat1End, { resume: true });
    await orchestrator.whenIdle();
    const rewrittenEnd = tree.leafId!;

    await orchestrator.jumpTo(beat1End, { playFrom: "start" });
    const called = calls.n;
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });

    expect(calls.n).toBe(called);
    expect(tree.leafId).toBe(rewrittenEnd);
  });

  it("prevLeafId 记的是结构操作之前世界线所在的位置；旧档缺字段或悬空都按无偏好", async () => {
    const { orchestrator, tree } = countingSetup([
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
    ]);
    const { beat1End, beat2End } = await playTwoBeats(orchestrator, tree);

    await orchestrator.jumpTo(beat1End);
    expect(orchestrator.runtimeState.prevLeafId).toBe(beat2End);

    const base: OrchestratorRuntimeState = { events: [], beatNo: 0, lastStop: null, epoch: 0 };
    expect(setup([], { restored: base }).orchestrator.runtimeState.prevLeafId).toBeNull();
    expect(
      setup([], { restored: { ...base, prevLeafId: "e-nope" } }).orchestrator.runtimeState.prevLeafId,
    ).toBeNull();
  });
});

describe("删除一段及其后代", () => {
  it("剪掉这一段：节点与后代消失、世界线回到上一轮末尾、客户端留在路线视图", async () => {
    const { orchestrator, messages, tree } = countingSetup([
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
    ]);
    const { beat1End, beat2End, beat2Prompt } = await playTwoBeats(orchestrator, tree);

    orchestrator.deleteBranch(beat2Prompt);

    expect(tree.get(beat2Prompt)).toBeUndefined();
    expect(tree.get(beat2End)).toBeUndefined();
    expect(tree.leafId).toBe(beat1End);
    expect(lastRebase(messages).note).toBe("剪掉这一段");
    expect(lastRebase(messages).keepView).toBe(true);
    expect(orchestrator.runtimeState.prevLeafId).toBe(beat1End);
  });

  it("开场那一轮不能删", async () => {
    const { orchestrator, tree } = countingSetup([{ text: BEAT_1, beatDone: BEAT_1_STOP }]);
    orchestrator.start();
    await orchestrator.whenIdle();
    const root = tree.ancestorChain(tree.leafId)[0]!;

    expect(() => orchestrator.deleteBranch(root)).toThrow(/开场那一轮不能删/);
    expect(tree.get(root)).toBeDefined();
  });

  it("删别的枝不动世界线：玩家在另一条枝上的位置不被这一剪拽走", async () => {
    const { orchestrator, tree } = countingSetup([
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
      { text: '<say id="mio">……也行。</say>', beatDone: true },
    ]);
    const { beat1End, beat2Prompt } = await playTwoBeats(orchestrator, tree);
    await orchestrator.jumpTo(beat1End, { playFrom: "start" });
    await orchestrator.playerAction({ kind: "choice", optionIndex: 1 });
    await orchestrator.whenIdle();
    const other = tree.leafId!;

    orchestrator.deleteBranch(beat2Prompt);

    expect(tree.get(beat2Prompt)).toBeUndefined();
    expect(tree.leafId).toBe(other);
  });
});
