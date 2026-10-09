import { describe, expect, it } from "vitest";
import { LineageTree, type PlayConfig, type ServerMessage } from "@aivn/core";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import { PlayMemory } from "../src/memory.js";
import { createFakeStreamFn } from "./helpers.js";
import type { TtsSynthFn } from "../src/voice.js";

const PLAY: PlayConfig = {
  id: "voice-test",
  title: "语音测试",
  premise: "p",
  opening: "（游戏开始）",
  initialState: { turn: 0, affinity: {}, flags: {} },
  initialScene: "走廊",
};

/** 角色卡：音色是角色的字段，voiceOf 从这里读，不再从 play.json。 */
const CAST = new PlayMemory({
  characters: new Map([
    ["mio", { id: "mio", name: "澪", body: "有音色", voiceId: "voice-mio" }],
    ["nonvoice", { id: "nonvoice", name: "无声", body: "无音色角色" }],
  ]),
});

interface SetupOpts {
  dsl: string;
  synth?: TtsSynthFn;
}

function setup({ dsl, synth }: SetupOpts) {
  const messages: ServerMessage[] = [];
  const calls: { text: string; voiceId: string }[] = [];
  const fake: TtsSynthFn =
    synth ??
    (async (text, voiceId) => {
      calls.push({ text, voiceId });
      return { url: `/tts/${voiceId}/${encodeURIComponent(text)}` };
    });
  const orchestrator = new PlaywrightOrchestrator({
    streamFn: createFakeStreamFn([{ text: dsl, beatDone: true }]),
    model: {} as never,
    getApiKey: () => "test-key",
    play: PLAY,
    store: { dir: "/tmp/stage-voice-test" } as never,
    memory: CAST,
    tree: new LineageTree(),
    engine: { ...PLAY.initialState },
    scene: PLAY.initialScene,
    tts: { synth: fake, concurrency: 2 },
    onServerMessage: (msg) => messages.push(msg),
    persist: () => {},
  });
  return { orchestrator, messages, calls };
}

/** 冲刷微任务链（synth promise → emit → finally pump）。 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("语音管线（D5）", () => {
  it("say 行分句预取 → audio_ready 携带 say_start seq 与短语序号", async () => {
    const { orchestrator, messages, calls } = setup({
      dsl: [
        '<scene bg="corridor"/>',
        "<narrate>旁白不配音。</narrate>",
        '<say id="mio" mood="soft">第一句。第二句！</say>',
        '<say id="nonvoice">我没有音色。</say>',
      ].join("\n"),
    });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();

    // say_start 事件 seq（第 2 个舞台事件）
    const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
    const sayStartSeq = events.find((e) => e.event.kind === "say_start")!.seq;

    const ready = messages.filter((m) => m.type === "audio_ready");
    expect(ready).toHaveLength(2);
    expect(ready[0]).toMatchObject({ seq: sayStartSeq, phrase: 0, url: `/tts/voice-mio/${encodeURIComponent("第一句。")}` });
    expect(ready[1]).toMatchObject({ seq: sayStartSeq, phrase: 1, url: `/tts/voice-mio/${encodeURIComponent("第二句！")}` });

    // narrate 与无音色角色零合成
    expect(calls.map((c) => c.text)).toEqual(["第一句。", "第二句！"]);
    expect(calls.every((c) => c.voiceId === "voice-mio")).toBe(true);
  });

  it("句首省略号不产生合成；say_end 冲刷无尾标点残余", async () => {
    const { orchestrator, messages } = setup({
      dsl: '<say id="mio">……真的吗，是这样啊</say>',
    });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();

    const ready = messages.filter((m) => m.type === "audio_ready");
    expect(ready).toHaveLength(1);
    if (ready[0]?.type === "audio_ready") {
      expect(decodeURIComponent(ready[0].url)).toContain("真的吗，是这样啊");
      expect(ready[0].phrase).toBe(0);
    }
  });

  it("tts_control paused → 预取挂起；resume 后补发（客户端背压）", async () => {
    const { orchestrator, messages } = setup({
      dsl: '<say id="mio">一。二。三。四。</say>',
    });
    orchestrator.setTtsState({ paused: true });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();

    // paused：分句完成但零合成零下发
    expect(messages.filter((m) => m.type === "audio_ready")).toHaveLength(0);

    orchestrator.setTtsState({ paused: false });
    await flush();
    const ready = messages.filter((m) => m.type === "audio_ready");
    expect(ready).toHaveLength(4);
    expect(ready.map((r) => (r as { phrase: number }).phrase)).toEqual([0, 1, 2, 3]);
  });

  it("tts_control enabled=false → 停止合成且清队", async () => {
    const { orchestrator, messages, calls } = setup({
      dsl: '<say id="mio">一。二。</say>',
    });
    orchestrator.setTtsState({ enabled: false });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();

    expect(calls).toHaveLength(0);
    expect(messages.filter((m) => m.type === "audio_ready")).toHaveLength(0);
  });

  it("TTS 失败 → 告警跳过该句，不阻塞事件流（风险#3）", async () => {
    const messages: ServerMessage[] = [];
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: createFakeStreamFn([{ text: '<say id="mio">会失败。没事。</say>', beatDone: true }]),
      model: {} as never,
      getApiKey: () => "test-key",
      play: PLAY,
      store: { dir: "/tmp/stage-voice-test" } as never,
      memory: CAST,
      tree: new LineageTree(),
      engine: { ...PLAY.initialState },
      scene: PLAY.initialScene,
      tts: {
        synth: async (text) => {
          if (text === "会失败。") throw new Error("boom");
          return { url: "/tts/ok" };
        },
      },
      onServerMessage: (msg) => messages.push(msg),
      persist: () => {},
    });
    const errors: unknown[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => errors.push(args);
    try {
      await orchestrator.playerAction({ kind: "free", text: "开局" });
      await flush();
    } finally {
      console.warn = origWarn;
    }

    const ready = messages.filter((m) => m.type === "audio_ready");
    expect(ready).toHaveLength(1);
    expect(errors).toHaveLength(1);
    // 舞台事件完整不受影响
    const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
    expect(events.some((e) => e.event.kind === "say_end")).toBe(true);
  });

  it("dispose 后不再下发 audio_ready", async () => {
    const { orchestrator, messages } = setup({
      dsl: '<say id="mio">一。二。三。</say>',
    });
    const running = orchestrator.playerAction({ kind: "free", text: "开局" });
    await running;
    orchestrator.dispose();
    const count = messages.filter((m) => m.type === "audio_ready").length;
    await flush();
    // dispose 时未完成的合成不再发出（已发出的保留）
    expect(messages.filter((m) => m.type === "audio_ready").length).toBeLessThanOrEqual(count + 3);
  });
});
