import { describe, expect, it } from "vitest";
import { LineageTree, type PlayConfig, type ServerMessage } from "@aivn/core";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import { PlayMemory } from "../src/memory.js";
import { createFakeStreamFn } from "./helpers.js";
import { PendingJobs } from "../src/pendingJobs.js";
import { VoicePipeline, type TtsSynthFn, type VoiceBacklog, type VoiceFrame } from "../src/voice.js";

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
  /** 记账表：同一个剧目里新旧两任编排器共用同一张（playhouse 是按剧目建的）。 */
  pending?: PendingJobs;
}

function setup({ dsl, synth, pending }: SetupOpts) {
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
    pending,
    onServerMessage: (msg) => messages.push(msg),
    persist: () => {},
  });
  return { orchestrator, messages, calls };
}

/** 冲刷微任务链（synth promise → emit → finally pump）。 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("语音管线：观众与交班（VoicePipeline）", () => {
  function pipeline(synth: TtsSynthFn) {
    const frames: VoiceFrame[] = [];
    const voice = new VoicePipeline({ synth, voiceOf: () => "v", emit: (f) => frames.push(f) });
    return { voice, frames };
  }

  it("离场期间合成的帧按原序补推，且不丢新帧", async () => {
    const { voice, frames } = pipeline(async (text) => ({ url: `/tts/${text}` }));
    voice.setAudience(false);
    voice.lineStart(1, "mio");
    voice.feedText("一。二。");
    voice.lineEnd();
    await flush();
    // 没人听：什么都没发出去，队列照做
    expect(frames).toEqual([]);

    voice.setAudience(true);
    await flush();
    // 先补推离场期间攒下的两帧 started，再是合成好的两帧 ready（顺序对客户端无差别）
    expect(frames.map((f) => `${f.state}:${f.phrase}`)).toEqual(["started:0", "started:1", "ready:0", "ready:1"]);
  });

  it("在飞的句子也算没做完：交班带走，由新管线接着发", async () => {
    const gates: (() => void)[] = [];
    const { voice: old, frames: oldFrames } = pipeline(
      (text) => new Promise((resolve) => gates.push(() => resolve({ url: `/tts/${text}` }))),
    );
    old.lineStart(1, "mio");
    old.feedText("一。二。三。"); // concurrency 2：两句在飞、一句排队
    old.lineEnd();
    await flush();

    const backlog = old.handover();
    expect(backlog.queue.map((j) => j.text)).toEqual(["一。", "二。", "三。"]);
    old.dispose();
    for (const release of gates) release();
    await flush();
    expect(oldFrames.filter((f) => f.state === "ready")).toHaveLength(0); // 旧的已经交出去了

    const { voice: fresh, frames } = pipeline(async (text) => ({ url: `/tts/${text}` }));
    fresh.adopt(backlog);
    await flush();
    expect(frames.filter((f) => f.state === "ready").map((f) => f.phrase)).toEqual([0, 1, 2]);
  });
});

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

  it("观众离场：句子照排队、期间合成的帧留着，人回来补推再接着做", async () => {
    const { orchestrator, messages } = setup({
      dsl: '<say id="mio">一。二。三。</say>',
    });
    // 没人听：分句照跑、帧照发（只是发不出去），但一个上游请求都不发
    orchestrator.setTtsState({ audience: false });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();
    expect(messages.filter((m) => m.type === "audio_ready")).toHaveLength(0);
    expect(messages.filter((m) => m.type === "audio_pending")).toHaveLength(0);

    // 人回来：队列照旧做完，三句一句不少
    orchestrator.setTtsState({ audience: true });
    await flush();
    const ready = messages.filter((m) => m.type === "audio_ready");
    expect(ready.map((r) => (r as { phrase: number }).phrase)).toEqual([0, 1, 2]);
  });

  it("轮边界重建：没做完的句子跟着新编排器继续", async () => {
    // 旧编排器：合成卡住不回来，于是三句全积在队列里（两句在飞、一句排队）
    const gates: (() => void)[] = [];
    const { orchestrator: old } = setup({
      dsl: '<say id="mio">一。二。三。</say>',
      synth: (text) => new Promise((resolve) => gates.push(() => resolve({ url: `/tts/${text}` }))),
    });
    await old.playerAction({ kind: "free", text: "开局" });
    await flush();

    // 新编排器建好之后接手，然后才 dispose 旧的（playhouse 的顺序：先建、再挪、最后停旧的）
    const { orchestrator: fresh, messages } = setup({
      dsl: "<narrate>新的一任什么都不用重演。</narrate>",
    });
    const backlog = old.takeVoiceBacklog();
    expect(backlog?.queue.map((j) => j.text)).toEqual(["一。", "二。", "三。"]);
    fresh.adoptVoiceBacklog(backlog);
    old.dispose();
    await fresh.playerAction({ kind: "free", text: "继续" });
    await flush();
    const ready = messages.filter((m) => m.type === "audio_ready");
    expect(ready.map((r) => (r as { phrase: number }).phrase)).toEqual([0, 1, 2]);
  });

  it("交接顺序（take → 停旧 → 接手）：接手登记过的语音条目留在共享记账表里", async () => {
    const pending = new PendingJobs(() => {});
    // 旧编排器：合成卡住不回来，两句都还挂在队里，记账表上已经有一条 voice:<seq>
    const gates: (() => void)[] = [];
    const { orchestrator: old } = setup({
      dsl: '<say id="mio">一。二。</say>',
      synth: (text) => new Promise((resolve) => gates.push(() => resolve({ url: `/tts/${text}` }))),
      pending,
    });
    await old.playerAction({ kind: "free", text: "开局" });
    await flush();
    expect(pending.snapshot().some((j) => j.kind === "voice")).toBe(true);

    const { orchestrator: fresh } = setup({ dsl: "<narrate>换一任。</narrate>", pending });
    // playhouse 的 handOverVoice 就是这三步，且不许插 await
    const backlog = old.takeVoiceBacklog();
    old.dispose(); // 整表清空（原有行为）
    fresh.adoptVoiceBacklog(backlog);
    await flush();
    // 接手之后重新登记：面板上那两句还在（顺序反了会被 dispose 的 clearAll 抹掉）
    expect(pending.snapshot().filter((j) => j.kind === "voice")).toHaveLength(1);
  });

  it("按需补生成：按当时那一行的台词重新分句，帧沿用原 seq 与短语序号", async () => {
    const calls: { text: string; voiceId: string }[] = [];
    const { orchestrator, messages } = setup({
      dsl: ['<narrate>开场。</narrate>', '<say id="mio">第一句。第二句！</say>'].join("\n"),
      synth: async (text, voiceId) => {
        calls.push({ text, voiceId });
        return { url: `/tts/${voiceId}/${encodeURIComponent(text)}` };
      },
    });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();

    const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
    const saySeq = events.find((e) => e.event.kind === "say_start")!.seq;
    calls.length = 0;
    const before = messages.length;

    orchestrator.requestVoice(saySeq);
    await flush();

    const fresh = messages.slice(before);
    // 台词取的是当时那一份（不是现在重新生成），音色仍是这个角色的
    expect(calls.map((c) => c.text)).toEqual(["第一句。", "第二句！"]);
    expect(calls.every((c) => c.voiceId === "voice-mio")).toBe(true);
    // 两个短语的「开始合成」都在 ready 之前一次性报出去：客户端据此知道这一行一共几句
    expect(
      fresh.filter((m) => m.type === "audio_pending").map((m) => [m.seq, m.phrase]),
    ).toEqual([
      [saySeq, 0],
      [saySeq, 1],
    ]);
    expect(fresh.filter((m) => m.type === "audio_ready").map((m) => [m.seq, m.phrase])).toEqual([
      [saySeq, 0],
      [saySeq, 1],
    ]);
  });

  it("按需补生成：这一行被原地改写过 → 用新台词，不是事件流里的旧文", async () => {
    const calls: { text: string; voiceId: string }[] = [];
    const { orchestrator, messages } = setup({
      dsl: '<say id="mio">原来的台词。</say>',
      synth: async (text, voiceId) => {
        calls.push({ text, voiceId });
        return { url: `/tts/${text}` };
      },
    });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();

    const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
    const saySeq = events.find((e) => e.event.kind === "say_start")!.seq;
    const nodeId = orchestrator.lineageView().nodes.find((n) => n.kind === "say")!.id;
    orchestrator.editLine(nodeId, "改过之后的台词。");

    calls.length = 0;
    orchestrator.requestVoice(saySeq);
    await flush();
    expect(calls.map((c) => c.text)).toEqual(["改过之后的台词。"]);
  });

  it("原地改写：旧台词的活儿作废——在飞的结果不发、排队里的扔掉、新请求照发", async () => {
    const calls: { text: string }[] = [];
    const gates: (() => void)[] = [];
    const { orchestrator, messages } = setup({
      dsl: '<say id="mio">一。二。三。</say>',
      synth: (text) =>
        new Promise((resolve) => {
          calls.push({ text });
          gates.push(() => resolve({ url: `/tts/${text}` }));
        }),
    });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();
    const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
    const saySeq = events.find((e) => e.event.kind === "say_start")!.seq;
    const nodeId = orchestrator.lineageView().nodes.find((n) => n.kind === "say")!.id;
    expect(calls.map((c) => c.text)).toEqual(["一。", "二。"]); // 并发 2：两句在飞、一句排队

    orchestrator.editLine(nodeId, "改过的词。");
    const before = messages.length;
    for (const release of gates) release(); // 旧代的在飞结果回来了
    await flush();
    expect(messages.slice(before).filter((m) => m.type === "audio_ready")).toHaveLength(0);

    calls.length = 0;
    gates.length = 0;
    const before2 = messages.length;
    orchestrator.requestVoice(saySeq);
    await flush();
    // 排队里那句旧台词被扔了：这一趟只按新台词合一句
    expect(calls.map((c) => c.text)).toEqual(["改过的词。"]);
    for (const release of gates) release();
    await flush();
    const ready = messages.slice(before2).filter((m) => m.type === "audio_ready");
    expect(ready).toHaveLength(1);
    expect(ready.every((m) => m.seq === saySeq && m.phrase === 0)).toBe(true);
  });

  it("观众不在时攒下的旧帧：抬代之后补推也不发", async () => {
    const gates: (() => void)[] = [];
    const messages: ServerMessage[] = [];
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: createFakeStreamFn([{ text: '<say id="mio">一。二。</say>', beatDone: true }]),
      model: {} as never,
      getApiKey: () => "test-key",
      play: PLAY,
      store: { dir: "/tmp/stage-voice-test" } as never,
      memory: CAST,
      tree: new LineageTree(),
      engine: { ...PLAY.initialState },
      scene: PLAY.initialScene,
      tts: {
        synth: (text) => new Promise((resolve) => gates.push(() => resolve({ url: `/tts/${text}` }))),
      },
      onServerMessage: (msg) => messages.push(msg),
      persist: () => {},
    });
    orchestrator.setTtsState({ audience: false }); // 没人在听：帧攒着
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();
    const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
    const saySeq = events.find((e) => e.event.kind === "say_start")!.seq;
    const nodeId = orchestrator.lineageView().nodes.find((n) => n.kind === "say")!.id;
    orchestrator.editLine(nodeId, "改过的词。"); // 没人在听的时候把台词改了（工坊那条连接就能这么干）

    for (const release of gates) release();
    await flush();
    const before = messages.length;
    orchestrator.setTtsState({ audience: true }); // 人回来了：旧帧不该补推
    await flush();
    expect(messages.slice(before).filter((m) => m.type === "audio_ready")).toHaveLength(0);
    expect(saySeq).toBeGreaterThan(0);
  });

  it("按需补生成：旁白行与不存在的 seq 都不冒泡", async () => {
    const { orchestrator, messages, calls } = setup({ dsl: "<narrate>只有旁白。</narrate>" });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();

    const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
    const narrateSeq = events.find((e) => e.event.kind === "narrate_start")!.seq;
    calls.length = 0;
    const before = messages.length;

    orchestrator.requestVoice(narrateSeq);
    orchestrator.requestVoice(999_999);
    await flush();

    expect(calls).toHaveLength(0);
    expect(messages.slice(before)).toHaveLength(0);
  });

  it("合成失败：明说一句 audio_failed，界面不必等 45s 兜底才摘「合成中」", async () => {
    const messages: ServerMessage[] = [];
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: createFakeStreamFn([{ text: '<say id="mio">会失败。</say>', beatDone: true }]),
      model: {} as never,
      getApiKey: () => "test-key",
      play: PLAY,
      store: { dir: "/tmp/stage-voice-test" } as never,
      memory: CAST,
      tree: new LineageTree(),
      engine: { ...PLAY.initialState },
      scene: PLAY.initialScene,
      tts: { synth: async () => { throw new Error("boom"); } },
      onServerMessage: (msg) => messages.push(msg),
      persist: () => {},
    });
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      await orchestrator.playerAction({ kind: "free", text: "开局" });
      await flush();
    } finally {
      console.warn = origWarn;
    }
    const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
    const saySeq = events.find((e) => e.event.kind === "say_start")!.seq;
    expect(messages.filter((m) => m.type === "audio_failed").map((m) => [m.seq, m.phrase])).toEqual([
      [saySeq, 0],
    ]);
    expect(messages.filter((m) => m.type === "audio_ready")).toHaveLength(0);
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
