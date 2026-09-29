import { describe, expect, it } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { LineageTree, type ServerMessage } from "@stage-ai/core";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import { PlayMemory } from "../src/memory.js";
import { lineageToBeats, lineageToEvents, stopFromEvent } from "../src/rebuild.js";
import { BEAT_1, BEAT_2, CARD, PLAY, createFakeStreamFn, type FakeResponse } from "./helpers.js";

function setup(
  responses: FakeResponse[],
  opts: { contexts?: { messages: { role: string; content?: unknown }[] }[] } = {},
): {
  orchestrator: PlaywrightOrchestrator;
  messages: ServerMessage[];
  tree: LineageTree;
  contexts: { messages: { role: string; content?: unknown }[] }[];
} {
  const messages: ServerMessage[] = [];
  const tree = new LineageTree();
  const contexts = opts.contexts ?? [];
  const base = createFakeStreamFn(responses);
  const streamFn: StreamFn = (model, context, options) => {
    contexts.push(context as { messages: { role: string; content?: unknown }[] });
    return base(model, context, options);
  };
  const orchestrator = new PlaywrightOrchestrator({
    streamFn,
    model: {} as never,
    getApiKey: () => "test-key",
    play: PLAY,
    memory: new PlayMemory({ cards: [CARD] }),
    tree,
    engine: { ...PLAY.initialState },
    scene: PLAY.initialScene,
    onServerMessage: (msg) => messages.push(msg),
    persist: () => {},
  });
  return { orchestrator, messages, tree, contexts };
}

/** 跑出两拍空闲的现场：拍一有 choice 停止点，拍二 act_end 收束。 */
async function playedTwoBeats(): Promise<ReturnType<typeof setup>> {
  const s = setup([
    { text: BEAT_1, beatDone: true },
    { text: BEAT_2, beatDone: true },
  ]);
  await s.orchestrator.playerAction({ kind: "free", text: "我到了" });
  await s.orchestrator.playerAction({ kind: "choice", optionIndex: 0 });
  return s;
}

function firstNodeOf(tree: LineageTree, kind: string): string {
  const row = tree.materialize().find((e) => e.kind === kind);
  if (!row) throw new Error(`谱系里没有 ${kind} 行`);
  return row.id;
}

/** 最近一次请求的**最后一条** user 消息正文（兼容 string 与多模态 content 块两种形态）。 */
function lastUserMessage(contexts: { messages: { role: string; content?: unknown }[] }[]): string {
  const users = (contexts.at(-1)?.messages ?? []).filter((m) => m.role === "user");
  const content = users.at(-1)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === "string" ? block : String((block as { text?: string }).text ?? "")))
      .join("\n");
  }
  return JSON.stringify(content ?? "");
}

function lastUserText(contexts: { messages: { role: string; content?: unknown }[] }[]): string {
  const messages = contexts.at(-1)?.messages ?? [];
  return messages
    .filter((m) => m.role === "user")
    .map((m) => JSON.stringify(m))
    .join("\n");
}

describe("P6 导演操作 · 编排器", () => {
  it("原地编辑：不开新分支，谱系文本换成新台词并追加 edit 事件", async () => {
    const { orchestrator, tree } = await playedTwoBeats();
    const sayId = firstNodeOf(tree, "say");
    const playerId = firstNodeOf(tree, "player");

    await orchestrator.editLine(sayId, "……算了，进来吧。");

    // edit 是原地事件：目标行不变，叶子长出一条 edit 覆盖它（同一条链，不开新分支）
    expect(tree.isAncestor(playerId, tree.leafId!)).toBe(true);
    const chain = tree.chainEvents(tree.leafId);
    expect(chain.at(-1)?.kind).toBe("edit");
    expect(chain.at(-1)?.editTargetId).toBe(sayId);
    const target = chain.find((e) => e.id === sayId);
    expect(target?.text).toBe("……太慢了！");
    // 物化与重放都看到新台词（同刻铁律）
    expect(tree.materialize().find((e) => e.id === sayId)?.text).toBe("……算了，进来吧。");
    const replayed = lineageToEvents(chain).find(
      (e) => e.event.kind === "say_text" && "delta" in e.event,
    );
    expect(replayed?.event.kind === "say_text" && replayed.event.delta).toBe("……算了，进来吧。");
    expect(orchestrator.currentEpoch).toBe(1);
  });

  it("分岔：旧分支留树内，当前分支事件缓冲只到分岔点（兄弟分支不可见）", async () => {
    const { orchestrator, messages, tree } = await playedTwoBeats();
    const sayId = firstNodeOf(tree, "say");
    const eventsBefore = orchestrator.runtimeState.events.length;

    await orchestrator.forkTo(sayId);

    expect(tree.leafId).toBe(sayId); // 挂载点移到分岔点
    expect(tree.isAncestor(firstNodeOf(tree, "player"), sayId)).toBe(true);
    const buffered = orchestrator.runtimeState.events;
    expect(buffered.length).toBeLessThan(eventsBefore);
    expect(buffered.every((e) => e.event.kind !== "beat_end")).toBe(true);
    const rebase = messages.filter((m) => m.type === "rebase");
    expect(rebase).toHaveLength(1);
    expect(rebase[0]?.type === "rebase" && rebase[0].note).toContain("新分支");
    // 旧分支的行仍在树上（可回跳），但不在当前路径
    const view = orchestrator.lineageView();
    expect(view.nodes.filter((n) => n.kind === "say").length).toBeGreaterThanOrEqual(2);
    expect(view.pathIds.at(-1)).toBe(sayId);
  });

  it("停止点跨分岔后还原成原来那个：choice 不退化成 pause", async () => {
    const { orchestrator, tree } = await playedTwoBeats(); // 拍一有 choice 停止点
    const choiceNode = tree.chainEvents(tree.leafId!).findLast((e) => e.kind === "stop");
    expect(choiceNode?.payload?.stopType).toBe("choice");

    await orchestrator.forkTo(choiceNode!.id); // 就分岔在停止点上

    const stop = orchestrator.runtimeState.lastStop;
    expect(stop?.stopType).toBe("choice");
    expect(stop?.options?.[0]?.text).toBeTruthy();
  });

  it("句级重写：隐式分岔 + 立即重生成，新分支带 rewrite 标注", async () => {
    const { orchestrator, tree, contexts } = await playedTwoBeats();
    const sayId = firstNodeOf(tree, "say");

    await orchestrator.rewrite(sayId, "line", "让她更小声一点");

    const view = orchestrator.lineageView();
    const rewrites = view.nodes.filter((n) => n.kind === "rewrite");
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0]?.granularity).toBe("line");
    // 旧版留在树上作废弃分支：旧 say 节点仍可回跳
    expect(view.nodes.filter((n) => n.kind === "say").length).toBeGreaterThanOrEqual(2);
    expect(lastUserText(contexts)).toContain("让她更小声一点");
  });

  it("幕级重写：锚点落到本幕首个内容行，玩家输入折成前情", async () => {
    const { orchestrator, tree, contexts } = await playedTwoBeats();
    const say2 = tree.materialize().filter((e) => e.kind === "say").at(-1)!;

    await orchestrator.rewrite(say2.id, "beat");

    const view = orchestrator.lineageView();
    const rewrite = view.nodes.find((n) => n.kind === "rewrite");
    expect(rewrite?.granularity).toBe("beat");
    // 锚点是本幕首个内容行：本幕玩家的选择折成回灌表态，开场那次的自由输入已成历史
    const lastUser = lastUserMessage(contexts);
    expect(lastUser).toContain("【玩家表态】");
    expect(lastUser).toContain("道歉"); // 本幕玩家选择回灌成表态
    expect(lastUser).toContain("重写");
    expect(lastUser).not.toContain("我到了"); // 开场那次的输入已成历史轮次
  });

  it("分岔后 OOC：先挂载到目标节点再注入导演注开拍", async () => {
    const { orchestrator, tree, contexts } = await playedTwoBeats();
    const sayId = firstNodeOf(tree, "say");
    const bufferedBefore = orchestrator.runtimeState.events.length;

    await orchestrator.oocAt(sayId, "让澪先开口道歉");

    expect(orchestrator.runtimeState.events.length).toBeLessThan(bufferedBefore + 100);
    expect(lastUserText(contexts)).toContain("让澪先开口道歉");
    // 分岔后立即开拍：叶子上多出本拍新行
    expect(orchestrator.lineageView().pathIds.at(-1)).not.toBe(sayId);
  });

  it("演出进行中拒绝结构操作（不打断当前节拍）", async () => {
    const { orchestrator, tree } = await playedTwoBeats();
    const sayId = firstNodeOf(tree, "say");
    const busy = orchestrator.playerAction({ kind: "free", text: "抢跑" });
    await expect(orchestrator.editLine(sayId, "x")).rejects.toThrow(/演出进行中/);
    await expect(orchestrator.forkTo(sayId)).rejects.toThrow(/演出进行中/);
    await busy;
  });
});

describe("P6 rebuild · 谱系 → IR", () => {
  it("preload / asset_ready 不进缓冲（瞬态），玩家与元信息行也不重放", () => {
    const tree = new LineageTree();
    tree.append("say", { text: "……太慢了！", payload: { attrs: { id: "mio", mood: "annoyed" } } });
    tree.append("preload", { payload: { attrs: { id: "bg_x", prompt: "corridor" } } });
    tree.append("asset_ready", { payload: { attrs: { id: "bg_x" } } });
    tree.append("player", { payload: { input: "我到了" } });
    tree.append("narrate", { text: "风停了。" });
    tree.append("beat_end", { payload: { reason: "act_end" } });

    const events = lineageToEvents(tree.chainEvents(tree.leafId!));
    expect(events.map((e) => e.event.kind)).toEqual([
      "say_start",
      "say_text",
      "say_end",
      "narrate_start",
      "narrate_text",
      "narrate_end",
    ]);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("重放沿用节点原 seq（路线树锚点跨分岔不漂）", () => {
    const tree = new LineageTree();
    // 现场一行台词会占 3+ 个 seq（start + 多段文本 + end），锚点间距稀疏
    tree.append("say", { text: "第一句", payload: { attrs: { id: "mio" }, seq: 5 } });
    tree.append("say", { text: "第二句", payload: { attrs: { id: "koharu" }, seq: 20 } });

    expect(lineageToEvents(tree.chainEvents(tree.leafId!)).map((e) => e.seq)).toEqual([5, 6, 7, 20, 21, 22]);
  });

  it("空台词只占 2 个 seq：重放不挤掉下一行的锚点", () => {
    const tree = new LineageTree();
    tree.append("say", { text: "", payload: { seq: 1, attrs: { id: "mio" } } });
    tree.append("say", { text: "满的那句", payload: { seq: 3, attrs: { id: "mio" } } });
    const events = lineageToEvents(tree.chainEvents(tree.leafId!));
    expect(events.map((e) => e.event.kind)).toEqual([
      "say_start", "say_end", "say_start", "say_text", "say_end",
    ]);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("重放不倒退：老节点无 seq 时按顺序补号", () => {
    const tree = new LineageTree();
    tree.append("say", { text: "有锚点", payload: { attrs: { id: "mio" }, seq: 8 } });
    tree.append("say", { text: "无锚点", payload: { attrs: { id: "mio" } } });

    expect(lineageToEvents(tree.chainEvents(tree.leafId!)).map((e) => e.seq)).toEqual([8, 9, 10, 11, 12, 13]);
  });

  it("edit 事件在重放时改写目标行文本", () => {
    const tree = new LineageTree();
    const say = tree.append("say", { text: "原台词", payload: { attrs: { id: "mio" } } });
    tree.editInPlace(say.id, "改过的台词");

    const events = lineageToEvents(tree.chainEvents(tree.leafId!));
    const text = events.find((e) => e.event.kind === "say_text");
    expect(text?.event.kind === "say_text" && text.event.delta).toBe("改过的台词");
  });

  it("幕划分 = 两个 beat_end 之间；未收束的半拍也算一幕", () => {
    const tree = new LineageTree();
    tree.append("player", { payload: { input: "我到了" } });
    tree.append("say", { text: "第一幕台词", payload: { attrs: { id: "mio" } } });
    tree.append("stop", { payload: { stopType: "choice", options: [{ text: "道歉" }] } });
    tree.append("beat_end", { payload: { reason: "stop" } });
    tree.append("say", { text: "第二幕台词", payload: { attrs: { id: "mio" } } });
    tree.append("beat_end", { payload: { reason: "act_end" } });
    tree.append("say", { text: "半拍台词", payload: { attrs: { id: "mio" } } });

    const beats = lineageToBeats(tree.chainEvents(tree.leafId!), { mio: "澪" }, "（游戏开始）");
    expect(beats).toHaveLength(3);
    expect(beats[0]?.user).toContain("我到了");
    expect(beats[0]?.assistant).toContain("澪：第一幕台词");
    expect(beats[0]?.assistant).toContain("等待玩家选择：道歉");
    expect(beats[1]?.user).toBe("【开场】\n（游戏开始）");
    expect(beats[1]?.assistant).toContain("第二幕台词");
    expect(beats[2]?.assistant).toContain("半拍台词");
  });

  it("stop 事件 → 停止点载荷（choice/free）；beat_end 不产出停止点事件", () => {
    const tree = new LineageTree();
    tree.append("stop", { payload: { stopType: "choice", options: [{ text: "道歉" }] } });
    tree.append("beat_end", { payload: { reason: "act_end" } });

    const chain = tree.chainEvents(tree.leafId!);
    expect(stopFromEvent(chain[0]!)).toEqual({
      stopType: "choice",
      options: [{ text: "道歉" }],
    });
    expect(lineageToEvents(chain).map((e) => e.event.kind)).toEqual(["stop"]);
  });

  it("旧的 pause 停止点不再还原成停止点（幕末走「下一幕」）", () => {
    const tree = new LineageTree();
    tree.append("stop", { payload: { stopType: "pause" } });
    const chain = tree.chainEvents(tree.leafId!);
    expect(stopFromEvent(chain[0]!)).toBeNull();
    expect(lineageToEvents(chain).map((e) => e.event.kind)).toEqual([]);
  });
});
