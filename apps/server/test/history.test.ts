import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { LineageTree } from "@stage-ai/core";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import { PlayMemory } from "../src/memory.js";
import { PlayLibrary } from "../src/store.js";
import { handleHttp } from "../src/http.js";
import type { PlayHouse } from "../src/playhouse.js";
import { HISTORY_BEATS_KEPT } from "../src/history.js";
import { BEAT_2, CARD, PLAY, createFakeStreamFn, type FakeResponse } from "./helpers.js";

function setup(responses: FakeResponse[]): PlaywrightOrchestrator {
  const tree = new LineageTree();
  const streamFn: StreamFn = createFakeStreamFn(responses);
  return new PlaywrightOrchestrator({
    streamFn,
    model: {} as never,
    getApiKey: () => "test-key",
    play: PLAY,
    memory: new PlayMemory({ cards: [CARD] }),
    tree,
    engine: { ...PLAY.initialState },
    scene: PLAY.initialScene,
    onServerMessage: () => {},
    persist: () => {},
  });
}

const PLAY_JSON = JSON.stringify({
  id: "p1",
  title: "T",
  premise: "x",
  characters: [],
  opening: "（开始）",
  initialScene: "s",
});
const engine = { flags: {}, sceneDetails: {}, activeThreads: [] };

/** 只认 writeHead/end 的最小 res：REST 用例只断言状态码与 JSON 载荷。 */
class FakeRes {
  statusCode = 0;
  payload = "";
  writeHead(code: number): this {
    this.statusCode = code;
    return this;
  }
  end(data?: string | Buffer): this {
    this.payload = data ? data.toString() : "";
    return this;
  }
}

async function callApi(library: PlayLibrary, url: string, method = "GET"): Promise<FakeRes> {
  const res = new FakeRes();
  await handleHttp(
    { url, method } as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    library,
    {} as PlayHouse, // 历史端点只读盘面，不触 runtime
  );
  return res;
}

describe("编排器历史累积", () => {
  it("多轮累积：按轮分组，轮内 seq 自增，角色顺序与模型输出一致", async () => {
    const orchestrator = setup([
      { text: BEAT_2, thinking: "澪这次别再嘴硬了。", beatDone: true },
      { text: BEAT_2, beatDone: true },
    ]);

    await orchestrator.playerAction({ kind: "continue" });
    await orchestrator.playerAction({ kind: "continue" });

    const beats = orchestrator.history;
    expect(beats.map((b) => b.turn)).toEqual([1, 2]);
    // 思考块排在 content 数组最前：原样保留，不因「先文本后思考」的直觉重排
    expect(beats[0]!.entries.map((e) => e.role)).toEqual([
      "user",
      "thinking",
      "assistant",
      "toolCall",
    ]);
    // 注入的 user 原文入史，且落在它真正开启的那轮：首轮 = 开场词 + 状态区，其后每轮同形
    expect(beats[0]!.entries[0]).toMatchObject({ beat: 1, seq: 1, role: "user" });
    expect(beats[0]!.entries[0]!.text.startsWith(PLAY.opening)).toBe(true);
    expect(beats[0]!.entries[0]!.text).toContain("【状态】");
    // 「继续」不是一句话，不占【用户输入】段
    expect(beats[0]!.entries[0]!.text).not.toContain("【用户输入】");
    expect(beats[1]!.entries[0]!.text).toContain("【状态】");
    expect(beats[1]!.entries[0]!.text).not.toContain("【用户输入】");
    // 原始 DSL 不解析不裁剪
    expect(beats[0]!.entries[2]).toMatchObject({ role: "assistant", text: BEAT_2 });
    expect(beats[1]!.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("toolCall：name 与 args 原样落位", async () => {
    const orchestrator = setup([
      {
        text: BEAT_2,
        beatDone: true,
        toolCalls: [
          { name: "update_state", args: { affinity: { mio: 2 }, flags: { promised: true } } },
        ],
      },
    ]);

    await orchestrator.playerAction({ kind: "continue" });

    const calls = orchestrator.history.flatMap((b) => b.entries).filter((e) => e.role === "toolCall");
    expect(calls.map((c) => c.name)).toEqual(["beat_done", "update_state"]);
    expect(calls[1]).toMatchObject({
      role: "toolCall",
      name: "update_state",
      args: { affinity: { mio: 2 }, flags: { promised: true } },
    });
  });

  it("超出保留轮数：按轮截断，最早的整轮连同其条目一起丢", async () => {
    const orchestrator = setup([{ text: BEAT_2, beatDone: true }]);

    for (let i = 0; i < HISTORY_BEATS_KEPT + 1; i += 1) {
      await orchestrator.playerAction({ kind: "continue" });
    }

    const beats = orchestrator.history;
    expect(beats).toHaveLength(HISTORY_BEATS_KEPT);
    expect(beats[0]!.turn).toBe(2);
    expect(beats.at(-1)!.turn).toBe(HISTORY_BEATS_KEPT + 1);
    expect(beats.every((b) => b.entries.every((e) => e.beat === b.turn))).toBe(true);
  });

  it("轮中截断：在第 2 轮中途分岔，第 2 轮的历史不进新分支，第 1 轮原样保留", async () => {
    const orchestrator = setup([
      { text: BEAT_2, beatDone: true },
      { text: BEAT_2, beatDone: true },
    ]);
    await orchestrator.playerAction({ kind: "continue" });
    await orchestrator.playerAction({ kind: "continue" });
    expect(orchestrator.history.map((b) => b.turn)).toEqual([1, 2]);

    // 轮中分岔即截断：目标节点取第 1 轮幕末之后的行，第 2 轮演了一半的后半段一律不进新分支
    const view = orchestrator.lineageView();
    const kinds = new Map(view.nodes.map((n) => [n.id, n.kind]));
    const afterFirstBeat = view.pathIds.slice(
      view.pathIds.findIndex((id) => kinds.get(id) === "beat_end") + 1,
    );
    expect(afterFirstBeat.map((id) => kinds.get(id))).toContain("say");
    await orchestrator.jumpTo(afterFirstBeat[0]!);

    expect(orchestrator.history.map((b) => b.turn)).toEqual([1]);
  });

  it("分岔后重演：兄弟分支的历史被丢弃，新分支接着开轮", async () => {
    const orchestrator = setup([{ text: BEAT_2, beatDone: true }]);
    await orchestrator.playerAction({ kind: "continue" });
    // 从幕首分岔：第 1 轮只演了一半，也一并作废
    const say = orchestrator.lineageView().nodes.find((n) => n.kind === "say")!;
    await orchestrator.jumpTo(say.id!);
    expect(orchestrator.history).toEqual([]);

    await orchestrator.playerAction({ kind: "continue" });
    expect(orchestrator.history.map((b) => b.turn)).toEqual([1]);
    expect(orchestrator.history[0]!.entries[0]!.role).toBe("user");
  });
});

describe("PlayStore 历史读面", () => {
  let root: string;
  let library: PlayLibrary;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stageai-history-"));
    library = new PlayLibrary(root);
    await mkdir(join(root, "p1"), { recursive: true });
    await writeFile(join(root, "p1", "play.json"), PLAY_JSON);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("随 session 落盘并原样读回", async () => {
    const save = await library.saves("p1").create();
    const history = [
      {
        turn: 1,
        entries: [
          { beat: 1, seq: 1, role: "user", text: "我来了" },
          { beat: 1, seq: 2, role: "toolCall", name: "update_state", args: { flags: { a: 1 } } },
        ],
      },
    ] as const;
    await library
      .saveStore("p1", save.id)
      .saveSession(new LineageTree(), engine, "s", undefined, [...history]);

    expect(await library.saveStore("p1", save.id).loadHistory()).toEqual([...history]);
  });

  it("缺 session.json / JSON 坏了 / 字段不是数组 / 结构不对：都空表不抛错", async () => {
    const save = await library.saves("p1").create();
    const sessionPath = join(root, "p1", "saves", save.id, "session.json");

    expect(await library.saveStore("p1", save.id).loadHistory()).toEqual([]);

    await writeFile(sessionPath, "{ 半截 json");
    expect(await library.saveStore("p1", save.id).loadHistory()).toEqual([]);

    await writeFile(sessionPath, JSON.stringify({ history: "不是数组" }));
    expect(await library.saveStore("p1", save.id).loadHistory()).toEqual([]);

    // 坏条目被逐条丢弃，好条目仍读得到
    await writeFile(
      sessionPath,
      JSON.stringify({
        history: [
          { turn: 1, entries: [{ beat: 1, seq: 1, role: "assistant" }, { beat: 1, seq: 2, role: "x" }] },
          { turn: 2, entries: [{ beat: 2, seq: 1, role: "user", text: "还在" }] },
        ],
      }),
    );
    expect(await library.saveStore("p1", save.id).loadHistory()).toEqual([
      { turn: 2, entries: [{ beat: 2, seq: 1, role: "user", text: "还在" }] },
    ]);

    // 剧目级 store 没有存档作用域：会话面不存在，返回空表而不是抛错
    expect(await library.store("p1").loadHistory()).toEqual([]);
  });
});

describe("GET /api/plays/:id/history", () => {
  let root: string;
  let library: PlayLibrary;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stageai-history-api-"));
    library = new PlayLibrary(root);
    await mkdir(join(root, "p1"), { recursive: true });
    await writeFile(join(root, "p1", "play.json"), PLAY_JSON);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("读活动档：返回 { beats: [...] }，与 saveSession 写入的一致", async () => {
    const save = await library.saves("p1").create();
    const entries = [{ beat: 1, seq: 1, role: "user" as const, text: "我来了" }];
    await library.saveStore("p1", save.id).saveSession(new LineageTree(), engine, "s", undefined, [
      { turn: 1, entries },
    ]);

    const res = await callApi(library, "/api/plays/p1/history");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ beats: [{ turn: 1, entries }] });
  });

  it("非活动档的历史不串场：端点只读 active.json 指针那棵", async () => {
    const first = await library.saves("p1").create("甲");
    await library.saveStore("p1", first.id).saveSession(new LineageTree(), engine, "s", undefined, [
      { turn: 1, entries: [{ beat: 1, seq: 1, role: "user", text: "甲的场" }] },
    ]);
    const second = await library.saves("p1").create("乙");
    await library.saveStore("p1", second.id).saveSession(new LineageTree(), engine, "s", undefined, [
      { turn: 1, entries: [{ beat: 1, seq: 1, role: "user", text: "乙的场" }] },
    ]);

    expect(JSON.parse((await callApi(library, "/api/plays/p1/history")).payload)).toEqual({
      beats: [{ turn: 1, entries: [{ beat: 1, seq: 1, role: "user", text: "乙的场" }] }],
    });
  });

  it("无活动档 / session.json 损坏：仍 200 + 空数组", async () => {
    const none = await callApi(library, "/api/plays/p1/history");
    expect(none.statusCode).toBe(200);
    expect(JSON.parse(none.payload)).toEqual({ beats: [] });

    const save = await library.saves("p1").create();
    await writeFile(join(root, "p1", "saves", save.id, "session.json"), "崩了");
    const broken = await callApi(library, "/api/plays/p1/history");
    expect(broken.statusCode).toBe(200);
    expect(JSON.parse(broken.payload)).toEqual({ beats: [] });
  });
});
