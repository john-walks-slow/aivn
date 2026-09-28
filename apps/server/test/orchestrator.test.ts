import { describe, expect, it } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Message } from "@earendil-works/pi-ai";
import { LineageTree, type ServerMessage } from "@stage-ai/core";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import type { PlayConfig } from "../src/play.js";

interface FakeResponse {
  /** 剧本 DSL 原文（流式输出的 assistant 文本）。 */
  text: string;
  /** 是否附带 beat_done 工具调用。 */
  beatDone?: boolean;
}

const PLAY: PlayConfig = {
  id: "test",
  title: "测试剧目",
  premise: "测试 premise",
  characters: [{ id: "mio", name: "澪", persona: "测试角色" }],
  opening: "（游戏开始）",
  initialState: { turn: 0, affinity: { mio: 10 }, flags: {} },
  initialScene: "走廊",
};

/** 假 LLM 流：按调用序号回放脚本，完整模拟 text 流 + tool_call + done。 */
function createFakeStreamFn(responses: FakeResponse[]): StreamFn {
  let call = 0;
  return () => {
    const response = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    const stream = createAssistantMessageEventStream();
    const partial = { role: "assistant", content: [] } as AssistantMessage;

    queueMicrotask(() => {
      stream.push({ type: "start", partial });
      stream.push({ type: "text_start", contentIndex: 0, partial });
      for (const delta of response.text.match(/[\s\S]{1,7}/g) ?? []) {
        stream.push({ type: "text_delta", contentIndex: 0, delta, partial });
      }
      stream.push({ type: "text_end", contentIndex: 0, content: response.text, partial });

      const content: Message[] = [];
      const finalMessage: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: response.text }],
        api: "openai-completions",
        provider: "fake",
        model: "fake-test",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      if (response.beatDone) {
        finalMessage.content.push({ type: "toolCall", id: "call-1", name: "beat_done", arguments: {} });
        finalMessage.stopReason = "toolUse";
        void content;
      }
      stream.push({ type: "done", message: finalMessage });
      stream.end(finalMessage);
    });
    return stream;
  };
}

const BEAT_1 = [
  '<scene bg="corridor_dusk" bgm="melancholy" transition="fade"/>',
  '<actor id="mio" pos="center" expression="pout" action="enter"/>',
  "<narrate>放学后的走廊空无一人。</narrate>",
  '<say id="mio" mood="annoyed">……太慢了！</say>',
  '<stop type="choice"><option value="a">道歉</option><option>装傻</option></stop>',
].join("\n");

const BEAT_2 = ['<say id="mio" mood="soft">……算了。</say>', "<narrate>风停了。</narrate>"].join("\n");

function setup(responses: FakeResponse[]): {
  orchestrator: PlaywrightOrchestrator;
  messages: ServerMessage[];
  tree: LineageTree;
} {
  const messages: ServerMessage[] = [];
  const tree = new LineageTree();
  const orchestrator = new PlaywrightOrchestrator({
    streamFn: createFakeStreamFn(responses),
    model: {} as never,
    getApiKey: () => "test-key",
    play: PLAY,
    tree,
    engine: { ...PLAY.initialState },
    scene: PLAY.initialScene,
    onServerMessage: (msg) => messages.push(msg),
    persist: () => {},
  });
  return { orchestrator, messages, tree };
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

    const beatEnd = messages.at(-1)!;
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

  it("OOC 走【导演注】区且谱系记录 ooc 行", async () => {
    const { orchestrator, messages, tree } = setup([
      { text: BEAT_1, beatDone: true },
      { text: BEAT_2, beatDone: true },
    ]);
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await orchestrator.playerAction({ kind: "ooc", text: "下一拍让澪提到天文社" });

    expect(tree.materialize().some((e) => e.kind === "ooc")).toBe(true);
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(2);
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
      { text: '<narrate>她看了看表。</narrate><stop type="choice"></stop>', beatDone: true },
    ]);
    await orchestrator.playerAction({ kind: "free", text: "开局" });

    const beatEnd = messages.at(-1)!;
    expect(beatEnd.type).toBe("beat_end");
    if (beatEnd.type === "beat_end") {
      expect(beatEnd.reason).toBe("stop");
      expect(beatEnd.stop?.stopType).toBe("free");
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

function fullText(events: { event: { kind: string } & Record<string, unknown> }[], kind: string): string {
  return events
    .filter((e) => e.event.kind === kind)
    .map((e) => String(e.event.delta ?? ""))
    .join("");
}
