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

/** 事件流里第 n 行 say 的 say_start seq。 */
function saySeqs(messages: ServerMessage[]): number[] {
  const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
  return events.filter((e) => e.event.kind === "say_start").map((e) => e.seq);
}

describe("语音管线：观众与交班（VoicePipeline）", () => {
  function pipeline(synth: TtsSynthFn) {
    const frames: VoiceFrame[] = [];
    const voice = new VoicePipeline({ synth, voiceOf: () => "v", emit: (f) => frames.push(f) });
    return { voice, frames };
  }

  it("离场期间合成好的帧按原序补推，且不丢新帧", async () => {
    const { voice, frames } = pipeline(async (text) => ({ url: `/tts/${text}` }));
    voice.setAudience(false);
    voice.lineStart(1, "mio");
    voice.feedText("一句话，写完才送。");
    voice.lineEnd();
    await flush();
    // 没人听：什么都没发出去，活儿照做
    expect(frames).toEqual([]);

    voice.setAudience(true);
    await flush();
    expect(frames.map((f) => f.state)).toEqual(["started", "ready"]);
  });

  it("在飞的那一行也算没做完：交班带走，由新管线接着发", async () => {
    const gates: (() => void)[] = [];
    const { voice: old, frames: oldFrames } = pipeline(
      (text) => new Promise((resolve) => gates.push(() => resolve({ url: `/tts/${text}` }))),
    );
    old.lineStart(1, "mio");
    old.feedText("整句一起送。");
    old.lineEnd();
    await flush();

    const backlog = old.handover();
    expect(backlog.queue.map((j) => j.text)).toEqual(["整句一起送。"]);
    old.dispose();
    for (const release of gates) release();
    await flush();
    expect(oldFrames.filter((f) => f.state === "ready")).toHaveLength(0); // 旧的已经交出去了

    const { voice: fresh, frames } = pipeline(async (text) => ({ url: `/tts/${text}` }));
    fresh.adopt(backlog);
    await flush();
    expect(frames.filter((f) => f.state === "ready").map((f) => f.seq)).toEqual([1]);
  });
});

describe("语音管线（D5）", () => {
  it("一行一条请求：台词写完整句一起送，audio_ready 带这行的 say_start seq", async () => {
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

    const saySeq = saySeqs(messages)[0]!;
    const ready = messages.filter((m) => m.type === "audio_ready");
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({
      seq: saySeq,
      url: `/tts/voice-mio/${encodeURIComponent("第一句。第二句！")}`,
    });

    // 一次请求，文本是整行；narrate 与无音色角色零合成
    expect(calls.map((c) => c.text)).toEqual(["第一句。第二句！"]);
    expect(calls.every((c) => c.voiceId === "voice-mio")).toBe(true);
  });

  it("没有可读的字就不合成（纯省略号）；有字的行原样送", async () => {
    const silent = setup({ dsl: '<say id="mio">……</say>' });
    await silent.orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();
    expect(silent.calls).toHaveLength(0);
    expect(silent.messages.filter((m) => m.type === "audio_ready")).toHaveLength(0);

    const spoken = setup({ dsl: '<say id="mio">……真的吗，是这样啊</say>' });
    await spoken.orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();
    expect(spoken.calls.map((c) => c.text)).toEqual(["……真的吗，是这样啊"]);
  });

  it("tts_control paused → 预取挂起；resume 后补发（客户端背压）", async () => {
    const { orchestrator, messages } = setup({ dsl: '<say id="mio">一。二。三。四。</say>' });
    orchestrator.setTtsState({ paused: true });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();

    expect(messages.filter((m) => m.type === "audio_ready")).toHaveLength(0);

    orchestrator.setTtsState({ paused: false });
    await flush();
    const ready = messages.filter((m) => m.type === "audio_ready");
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ seq: saySeqs(messages)[0] });
  });

  it("tts_control enabled=false → 不合成", async () => {
    const { orchestrator, messages, calls } = setup({ dsl: '<say id="mio">一。二。</say>' });
    orchestrator.setTtsState({ enabled: false });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();

    expect(calls).toHaveLength(0);
    expect(messages.filter((m) => m.type === "audio_ready")).toHaveLength(0);
  });

  it("TTS 失败 → 告警跳过这一行，不阻塞事件流（风险#3）", async () => {
    const messages: ServerMessage[] = [];
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: createFakeStreamFn([{ text: '<say id="mio">会失败。</say><say id="mio">没事。</say>', beatDone: true }]),
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

    // 挂掉的那一行跳过，另一行照常出声
    expect(messages.filter((m) => m.type === "audio_ready")).toHaveLength(1);
    expect(errors).toHaveLength(1);
    const events = messages.flatMap((m) => (m.type === "events" ? m.events : []));
    expect(events.some((e) => e.event.kind === "say_end")).toBe(true);
  });

  it("观众离场：整行照排队、期间合成好的帧留着，人回来补推再接着做", async () => {
    const { orchestrator, messages } = setup({ dsl: '<say id="mio">一。二。三。</say>' });
    orchestrator.setTtsState({ audience: false });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();
    expect(messages.filter((m) => m.type === "audio_ready")).toHaveLength(0);
    expect(messages.filter((m) => m.type === "audio_pending")).toHaveLength(0);

    orchestrator.setTtsState({ audience: true });
    await flush();
    expect(messages.filter((m) => m.type === "audio_ready")).toHaveLength(1);
  });

  it("关着语音时重建：整条 take → 停旧 → 接手 的真路径也留得住开关状态", async () => {
    const gates: (() => void)[] = [];
    const { orchestrator: old } = setup({
      dsl: '<say id="mio">第一行。</say>',
      synth: (text) => new Promise((resolve) => gates.push(() => resolve({ url: `/tts/${text}` }))),
    });
    old.setTtsState({ enabled: false });
    await old.playerAction({ kind: "free", text: "开局" });
    await flush();

    // 队列是空的，但「关着」这件事本身要接过去——不然新管线会默认打开
    const backlog = old.takeVoiceBacklog();
    expect(backlog).not.toBeNull();
    expect(backlog?.enabled).toBe(false);

    const { orchestrator: fresh, messages: freshMessages, calls } = setup({
      dsl: '<say id="mio">重建之后的第二行。</say>',
    });
    fresh.adoptVoiceBacklog(backlog);
    old.dispose();
    await fresh.playerAction({ kind: "free", text: "继续" });
    await flush();
    expect(calls).toHaveLength(0);
    expect(freshMessages.filter((m) => m.type === "audio_ready")).toHaveLength(0);
  });

  it("交班带走开关状态：关着语音时重建，新管线不会偷偷开始合成", async () => {
    const synth: TtsSynthFn = async (text) => ({ url: `/tts/${text}` });
    const oldFrames: VoiceFrame[] = [];
    const old = new VoicePipeline({ synth, voiceOf: () => "v", emit: (f) => oldFrames.push(f) });
    old.setEnabled(false);
    const backlog = old.handover();
    old.dispose();

    const mine: VoiceFrame[] = [];
    const fresh = new VoicePipeline({ synth, voiceOf: () => "v", emit: (f) => mine.push(f) });
    fresh.adopt(backlog);
    fresh.lineStart(1, "mio");
    fresh.feedText("关着语音也不该合。");
    fresh.lineEnd();
    await flush();
    expect(mine).toEqual([]);
    expect(oldFrames).toEqual([]);
  });

  it("暂停状态也要接过去：paused 时重建不能把泵放跑", async () => {
    const { orchestrator: old } = setup({ dsl: '<say id="mio">第一行。</say>' });
    old.setTtsState({ paused: true });
    const backlog = old.takeVoiceBacklog();
    expect(backlog).not.toBeNull();
    expect(backlog?.paused).toBe(true);
  });

  it("轮边界重建：没做完的行跟着新编排器继续", async () => {
    const gates: (() => void)[] = [];
    const { orchestrator: old } = setup({
      dsl: '<say id="mio">一整句台词。</say>',
      synth: (text) => new Promise((resolve) => gates.push(() => resolve({ url: `/tts/${text}` }))),
    });
    await old.playerAction({ kind: "free", text: "开局" });
    await flush();

    const { orchestrator: fresh, messages } = setup({ dsl: "<narrate>新的一任什么都不用重演。</narrate>" });
    const backlog = old.takeVoiceBacklog();
    expect(backlog?.queue.map((j) => j.text)).toEqual(["一整句台词。"]);
    fresh.adoptVoiceBacklog(backlog);
    old.dispose();
    for (const release of gates) release();
    await fresh.playerAction({ kind: "free", text: "继续" });
    await flush();
    expect(messages.filter((m) => m.type === "audio_ready")).toHaveLength(1);
  });

  it("交接顺序（take → 停旧 → 接手）：接手登记过的语音条目留在共享记账表里", async () => {
    const pending = new PendingJobs(() => {});
    const gates: (() => void)[] = [];
    const { orchestrator: old } = setup({
      dsl: '<say id="mio">一整句台词。</say>',
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
    // 接手之后重新登记：面板上那一条还在（顺序反了会被 dispose 的 clearAll 抹掉）
    expect(pending.snapshot().filter((j) => j.kind === "voice")).toHaveLength(1);
  });

  it("按需补生成：整句一次请求，帧沿用原 seq", async () => {
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

    const saySeq = saySeqs(messages)[0]!;
    calls.length = 0;
    const before = messages.length;

    orchestrator.requestVoice(saySeq);
    await flush();

    const fresh = messages.slice(before);
    // 台词取的是当时那一份（不是现在重新生成），音色仍是这个角色的，一次请求
    expect(calls.map((c) => c.text)).toEqual(["第一句。第二句！"]);
    expect(calls.every((c) => c.voiceId === "voice-mio")).toBe(true);
    expect(fresh.filter((m) => m.type === "audio_pending").map((m) => m.seq)).toEqual([saySeq]);
    expect(fresh.filter((m) => m.type === "audio_ready").map((m) => m.seq)).toEqual([saySeq]);
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

    const nodeId = orchestrator.lineageView().nodes.find((n) => n.kind === "say")!.id;
    orchestrator.editLine(nodeId, "改过之后的台词。");

    calls.length = 0;
    orchestrator.requestVoice(saySeqs(messages)[0]!);
    await flush();
    expect(calls.map((c) => c.text)).toEqual(["改过之后的台词。"]);
  });

  it("原地改写：在飞的那一条结果不发", async () => {
    const gates: (() => void)[] = [];
    const { orchestrator, messages } = setup({
      dsl: '<say id="mio">一。</say><say id="mio">二。</say>',
      synth: (text) => new Promise((resolve) => gates.push(() => resolve({ url: `/tts/${text}` }))),
    });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();

    const edited = saySeqs(messages)[0]!;
    const nodeId = orchestrator.lineageView().nodes.find((n) => n.kind === "say")!.id;
    orchestrator.editLine(nodeId, "改过的词。");
    const before = messages.length;
    for (const release of gates) release();
    await flush();
    // 被改的那条不发；另一条照常出声
    const ready = messages.slice(before).filter((m) => m.type === "audio_ready");
    expect(ready.some((m) => m.seq === edited)).toBe(false);
    expect(ready).toHaveLength(1);
  });

  it("原地改写：排队里那条旧活儿被扔掉，重新点名只按新台词合一次", async () => {
    const calls: { text: string }[] = [];
    const gates: (() => void)[] = [];
    const { orchestrator, messages } = setup({
      dsl: '<say id="mio">一。</say><say id="mio">二。</say><say id="mio">三。</say>',
      synth: (text) =>
        new Promise((resolve) => {
          calls.push({ text });
          gates.push(() => resolve({ url: `/tts/${text}` }));
        }),
    });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();
    expect(calls.map((c) => c.text)).toEqual(["一。", "二。"]); // 并发 2：两条在飞、一条排队

    // 放掉前两条（它们没被改过），让泵空出来
    for (const release of gates) release();
    await flush();

    const third = orchestrator.lineageView().nodes.filter((n) => n.kind === "say")[2]!;
    orchestrator.editLine(third.id, "改过的第三条。");
    const seq = saySeqs(messages)[2]!;

    calls.length = 0;
    gates.length = 0;
    const before = messages.length;
    orchestrator.requestVoice(seq);
    await flush();
    // 排队里那句旧台词被扔了：这一趟只按新台词合一次
    expect(calls.map((c) => c.text)).toEqual(["改过的第三条。"]);
    for (const release of gates) release();
    await flush();
    const ready = messages.slice(before).filter((m) => m.type === "audio_ready");
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ seq });
  });

  it("观众不在时攒下的旧帧：抬代之后补推也不发", async () => {
    const gates: (() => void)[] = [];
    const { orchestrator, messages } = setup({
      dsl: '<say id="mio">一。</say><say id="mio">二。</say>',
      synth: (text) => new Promise((resolve) => gates.push(() => resolve({ url: `/tts/${text}` }))),
    });
    orchestrator.setTtsState({ audience: false }); // 没人在听：帧攒着
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    await flush();

    const nodeId = orchestrator.lineageView().nodes.find((n) => n.kind === "say")!.id;
    orchestrator.editLine(nodeId, "改过的词。"); // 没人在听的时候把台词改了（工坊那条连接就能这么干）

    for (const release of gates) release();
    await flush();
    const before = messages.length;
    orchestrator.setTtsState({ audience: true }); // 人回来了：旧帧不该补推
    await flush();
    expect(messages.slice(before).filter((m) => m.type === "audio_ready")).toHaveLength(0);
    expect(saySeqs(messages)[0]).toBeGreaterThan(0);
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
      tts: {
        synth: async () => {
          throw new Error("boom");
        },
      },
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
    expect(messages.filter((m) => m.type === "audio_failed").map((m) => m.seq)).toEqual([saySeqs(messages)[0]]);
    expect(messages.filter((m) => m.type === "audio_ready")).toHaveLength(0);
  });

  it("dispose 后不再下发 audio_ready", async () => {
    const { orchestrator, messages } = setup({ dsl: '<say id="mio">一。</say><say id="mio">二。</say>' });
    await orchestrator.playerAction({ kind: "free", text: "开局" });
    orchestrator.dispose();
    const count = messages.filter((m) => m.type === "audio_ready").length;
    await flush();
    expect(messages.filter((m) => m.type === "audio_ready")).toHaveLength(count);
  });
});
