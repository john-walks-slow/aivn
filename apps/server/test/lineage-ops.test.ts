import { describe, expect, it } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { LineageTree, type LineageEvent, type ServerMessage } from "@aivn/core";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import { PlayMemory } from "../src/memory.js";
import { lineageToBeats, lineageToEvents, nsfwTransitionBeat, stopFromEvent } from "../src/rebuild.js";
import { BEAT_1, BEAT_1_STOP, BEAT_2, CARD, PLAY, createFakeStreamFn, type FakeResponse } from "./helpers.js";

function setup(
  responses: FakeResponse[],
  opts: { contexts?: { messages: { role: string; content?: unknown }[] }[] } = {},
): {
  orchestrator: PlaywrightOrchestrator;
  messages: ServerMessage[];
  tree: LineageTree;
  contexts: { messages: { role: string; content?: unknown }[] }[];
  /** 落盘那份 JSONL 收到的事件序列（等于 onLineageEvent 的入参顺序）。 */
  logged: LineageEvent[];
} {
  const messages: ServerMessage[] = [];
  const tree = new LineageTree();
  const contexts = opts.contexts ?? [];
  const logged: LineageEvent[] = [];
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
    store: { dir: "/tmp/stage-lineage-ops-test" } as never,
    memory: new PlayMemory({ cards: [CARD] }),
    tree,
    engine: { ...PLAY.initialState },
    scene: PLAY.initialScene,
    onServerMessage: (msg) => messages.push(msg),
    onLineageEvent: (event) => logged.push(event),
    persist: () => {},
  });
  return { orchestrator, messages, tree, contexts, logged };
}

/** 跑出两轮空闲的现场：轮一有 choice 停止点，轮二 no_stop 收束。 */
async function playedTwoBeats(): Promise<ReturnType<typeof setup>> {
  const s = setup([
    { text: BEAT_1, beatDone: BEAT_1_STOP },
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

/** 轮二的轮首（第一个 beat_end 之后的第一个节点）——「重来」的锚点。 */
function beatTwoHead(tree: LineageTree): string {
  const chain = tree.materialize();
  const boundary = chain.findIndex((e) => e.kind === "beat_end");
  const head = chain.slice(boundary + 1).find((e) => e.kind !== "beat_end");
  if (!head) throw new Error("轮二没有内容节点");
  return head.id;
}

/** 两轮现场（与 playedTwoBeats 同形）但多备一次响应，供「重来」后的续演取用。 */
async function setupWithExtraBeat(): Promise<ReturnType<typeof setup>> {
  const s = setup([
    { text: BEAT_1, beatDone: BEAT_1_STOP },
    { text: BEAT_2, beatDone: true },
    { text: BEAT_2, beatDone: true },
  ]);
  await s.orchestrator.playerAction({ kind: "free", text: "我到了" });
  await s.orchestrator.playerAction({ kind: "choice", optionIndex: 0 });
  return s;
}

/** 一轮卡在演出中的现场：闸门没开，这一轮永不收束。 */
function busyStage(): {
  s: ReturnType<typeof setup>;
  open: () => void;
  done: Promise<void>;
} {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const s = setup([
    { text: BEAT_1, beatDone: BEAT_1_STOP, gate },
    { text: BEAT_2, beatDone: true },
    { text: BEAT_2, beatDone: true },
  ]);
  const done = s.orchestrator.playerAction({ kind: "free", text: "我到了" });
  return { s, open, done };
}

/** 最近一次 prompt_queue 广播里的条目。 */
function queuedItems(messages: ServerMessage[]): { id: string; text: string; status: string }[] {
  const last = messages.filter((m) => m.type === "prompt_queue").at(-1);
  if (last?.type !== "prompt_queue") throw new Error("还没有广播过 prompt_queue");
  return last.items;
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

describe("导演操作 · 编排器（分岔 / 编辑 / 插一句）", () => {
  it("原地编辑：叶子不动、不开分支、只换对话体那一行", async () => {
    const { orchestrator, messages, tree, contexts } = await playedTwoBeats();
    const sayId = firstNodeOf(tree, "say");
    const promptId = firstNodeOf(tree, "prompt");
    const leafBefore = tree.leafId;
    const eventsBefore = orchestrator.runtimeState.events.length;

    orchestrator.editLine(sayId, "……算了，进来吧。");

    // 纯原地：叶子、分支、事件缓冲、轮号全都一步没动，也没有 rebase 广播
    expect(tree.leafId).toBe(leafBefore);
    expect(tree.isAncestor(promptId, tree.leafId!)).toBe(true);
    expect(orchestrator.runtimeState.events).toHaveLength(eventsBefore);
    expect(orchestrator.currentEpoch).toBe(0);
    expect(messages.some((m) => m.type === "rebase")).toBe(false);
    // seq 带上是给客户端的：靠它就地换掉缓冲里那一行，不必整段重放
    expect(messages.at(-1)).toMatchObject({
      type: "line_edited",
      nodeId: sayId,
      text: "……算了，进来吧。",
      seq: expect.any(Number),
    });

    // 后续生成读到新台词（同刻铁律）：对话体重建时那一行已换
    expect(lastUserText(contexts)).not.toContain("……算了，进来吧。");
    const view = orchestrator.lineageView();
    const row = view.nodes.find((n) => n.id === sayId);
    expect(row?.editedText).toBe("……算了，进来吧。");
    expect(row?.editCount).toBe(1);
    // 编辑不进树：describe 的节点里没有 edit 行，剧本视图也不该多出一行
    expect(view.nodes.some((n) => n.kind === "edit")).toBe(false);
  });

  it("跳转：世界线挂到目标，当前分支事件缓冲只到目标点（兄弟分支不可见）", async () => {
    const { orchestrator, messages, tree } = await playedTwoBeats();
    const sayId = firstNodeOf(tree, "say");
    const promptId = tree.materialize().findLast((e) => e.kind === "prompt")!.id;
    const eventsBefore = orchestrator.runtimeState.events.length;

    await orchestrator.jumpTo(sayId);

    // 跳转不落任何标记：它只挪世界线，不宣称这条线岔过（落标记是 forkTo 的事）
    expect(tree.leafId).toBe(sayId);
    expect(tree.chainEvents(tree.leafId).at(-1)!.kind).toBe("say");
    expect(tree.isAncestor(sayId, promptId)).toBe(true);
    const buffered = orchestrator.runtimeState.events;
    expect(buffered.length).toBeLessThan(eventsBefore);
    expect(buffered.every((e) => e.event.kind !== "beat_end")).toBe(true);
    const rebase = messages.filter((m) => m.type === "rebase");
    expect(rebase).toHaveLength(1);
    expect(rebase[0]?.type === "rebase" && rebase[0].note).toBe("已跳到这里");
    // 旧分支的行仍在树上（可回跳），但不在当前路径
    const view = orchestrator.lineageView();
    expect(view.nodes.filter((n) => n.kind === "say").length).toBeGreaterThanOrEqual(2);
    expect(view.pathIds.at(-1)).toBe(sayId);
  });

  it("跳到废弃分支：世界线真的落到那条线，当前剧情作废但历史一条不少", async () => {
    const s = setup([
      { text: BEAT_1, beatDone: BEAT_1_STOP },
      { text: BEAT_2, beatDone: true },
      { text: BEAT_2, beatDone: true },
    ]);
    await s.orchestrator.playerAction({ kind: "free", text: "我到了" });
    await s.orchestrator.playerAction({ kind: "choice", optionIndex: 0 });
    const sayId = firstNodeOf(s.tree, "say");
    const originalLeaf = s.tree.leafId!;

    // 退回去改走另一条：原来那条从此不在世界线上
    await s.orchestrator.jumpTo(sayId);
    await s.orchestrator.playerAction({ kind: "choice", optionIndex: 0 });
    const logBefore = s.tree.export().events.length;
    expect(s.tree.pathSet().has(originalLeaf)).toBe(false);

    await s.orchestrator.jumpTo(originalLeaf);

    // 世界线真的落到那条废弃的线上了
    expect(s.tree.leafId).toBe(originalLeaf);
    expect(s.tree.pathSet().has(originalLeaf)).toBe(true);
    // 事件真相源 append-only：跳来跳去一条都不该少
    expect(s.tree.export().events.length).toBe(logBefore);
    // 缓冲同步收敛到新世界线，不夹带兄弟分支的往事
    expect(s.orchestrator.runtimeState.events.at(-1)?.event.kind).toBe("narrate_end");
  });

  it("跳转落在轮中 → 停止点降为 pause（这一轮被截断，只能按「继续」重开）", async () => {
    const { orchestrator, messages, tree } = await playedTwoBeats();
    const sayId = firstNodeOf(tree, "say"); // 轮中的台词节点

    await orchestrator.jumpTo(sayId);

    expect(orchestrator.runtimeState.lastStop).toEqual({ stopType: "pause" });
    const rebase = messages.find((m) => m.type === "rebase");
    expect(rebase?.type).toBe("rebase");
    if (rebase?.type !== "rebase") return;
    expect(rebase.reason).toBe("stop"); // 不是 no_stop：不给「下一幕」
    expect(rebase.stop?.stopType).toBe("pause");
  });

  it("停止点跨跳转后还原成原来那个：choice 不退化成 pause", async () => {
    const { orchestrator, tree } = await playedTwoBeats(); // 轮一有 choice 停止点
    const choiceNode = tree.chainEvents(tree.leafId!).findLast((e) => e.kind === "stop");
    expect(choiceNode?.payload?.stopType).toBe("choice");

    await orchestrator.jumpTo(choiceNode!.id); // 就分岔在停止点上

    const stop = orchestrator.runtimeState.lastStop;
    expect(stop?.stopType).toBe("choice");
    expect(stop?.options?.[0]?.text).toBeTruthy();
  });

  it("重来这一幕 = 分岔到轮首 + 立刻续演：一次调用走完，中间不设停止点", async () => {
    const { orchestrator, messages, tree, contexts } = await setupWithExtraBeat();
    const beatTwoFirst = beatTwoHead(tree);

    await orchestrator.forkTo(beatTwoFirst, { resume: true });

    // 零点击：不等玩家选，直接开新轮
    expect(orchestrator.runtimeState.lastStop).toBeNull();
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(3); // 轮一、轮二、重来后新轮
    expect(tree.chainEvents(tree.leafId).at(-1)?.kind).toBe("beat_end"); // 续演的一轮已跑完并收束
    // 玩家上一次的选择原样回灌给模型（作为本轮输入），不另造假轮次
    expect(lastUserMessage(contexts)).toContain("道歉");
  });

  it("带着意图重来 = 分岔 + 插一句（两原语正交组合）", async () => {
    const { orchestrator, tree, contexts } = await setupWithExtraBeat();
    const beatTwoFirst = beatTwoHead(tree);

    await orchestrator.forkTo(beatTwoFirst);
    // 分岔后舞台停在那一行等玩家开口，引导先排队（它不抢在玩家前头自己开跑）
    await orchestrator.playerAction({ kind: "prompt", text: "这次让她先笑出来" });
    expect(orchestrator.runtimeState.lastStop?.stopType).toBe("pause"); // 分岔后等玩家开口

    await orchestrator.playerAction({ kind: "continue" });

    const view = orchestrator.lineageView();
    expect(view.nodes.some((n) => n.kind === "fork")).toBe(true);
    const prompts = view.nodes.filter((n) => n.kind === "prompt");
    expect(prompts.at(-1)?.text).toBe("这次让她先笑出来");
    const lastUser = lastUserMessage(contexts);
    expect(lastUser).toContain("【用户输入】");
    expect(lastUser).toContain("这次让她先笑出来");
    expect(lastUser).toContain("道歉"); // 链尾悬空的那次表态并进了本轮
  });

  it("插一句：落一条 prompt 谱系节点，选项与自由输入走同一通道", async () => {
    const { orchestrator, tree, contexts } = await playedTwoBeats();
    const before = tree.materialize().filter((e) => e.kind === "prompt").length;

    await orchestrator.playerAction({ kind: "prompt", text: "直接拉她的手" });
    // 引导永远只排队：不落节点、不自己开新一轮
    expect(tree.materialize().filter((e) => e.kind === "prompt")).toHaveLength(before);

    // 玩家下一次开口（这里没有选项可点，敲一句自由输入）→ 引导与它同一轮发出去
    await orchestrator.playerAction({ kind: "free", text: "我追上去" });

    const prompts = tree.materialize().filter((e) => e.kind === "prompt");
    expect(prompts).toHaveLength(before + 2);
    expect(prompts.at(-2)?.payload?.input).toBe("直接拉她的手");
    const lastUser = lastUserMessage(contexts);
    expect(lastUser).toContain("【用户输入】\n直接拉她的手");
    expect(lastUser).toContain("我追上去");
    // 选中的选项与自由输入是同一种节点、同一种段标题
    expect(prompts[0]?.payload?.input).toBe("我到了");
    expect(prompts[1]?.payload?.input).toContain("选择了：道歉");
  });

  it("分岔标记当场写进谱系日志：不等下一次全量补推", async () => {
    const { orchestrator, tree, logged } = await playedTwoBeats();
    const before = logged.filter((e) => e.kind === "fork").length;

    await orchestrator.forkTo(firstNodeOf(tree, "say"));

    expect(logged.filter((e) => e.kind === "fork")).toHaveLength(before + 1);
    expect(logged.at(-1)?.kind).toBe("fork");
  });

  it("「继续」不落谱系节点也不进对话体：只有【状态】一段", async () => {
    const { orchestrator, tree, contexts } = await playedTwoBeats();
    const before = tree.materialize().length;

    await orchestrator.playerAction({ kind: "continue" });

    expect(tree.materialize().length).toBe(before + 3); // 只有新轮的三条剧本行，没有输入节点
    const lastUser = lastUserMessage(contexts);
    expect(lastUser).toContain("【状态】");
    expect(lastUser).not.toContain("【用户输入】");
    expect(lastUser).not.toContain("（继续）");
  });

  it("演出进行中：改写被挡回，插一句进队列；分岔则是腰斩克隆，不挡", async () => {
    const { s, open, done } = busyStage();
    const { orchestrator, tree, messages } = s;
    // 演出中的轮还没收束，谱系里只有上一轮的叶尖
    const anchor = tree.leafId!;

    await orchestrator.playerAction({ kind: "free", text: "抢跑" }); // 同样被挡
    expect(() => orchestrator.editLine(anchor, "x")).toThrow(/演出进行中/);
    expect(messages.filter((m) => m.type === "error").map((m) => (m as { message: string }).message))
      .toContain("演出进行中，请等待当前轮结束");

    // 插一句不挡：进队列，等玩家下一个动作一起发
    await orchestrator.playerAction({ kind: "prompt", text: "别急着道歉" });
    expect(queuedItems(messages)[0]).toMatchObject({ text: "别急着道歉", status: "pending" });
    expect(orchestrator.runtimeState.events.some((e) => e.type === "beat_end")).toBe(false);

    open();
    await done; // 轮 1 收在选择点上 → 引导继续等
    expect(queuedItems(messages).at(-1)).toMatchObject({ text: "别急着道歉", status: "pending" });
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(1);

    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 }); // 玩家点了选项
    expect(queuedItems(messages)).toEqual([]);
    // 落笔顺序与队列顺序一致：先排队的引导，再是这次点选项
    const prompts = tree.materialize().filter((e) => e.kind === "prompt");
    expect(prompts.at(-2)?.payload?.input).toBe("别急着道歉");
    expect(prompts.at(-1)?.payload?.input).toContain("选择了：道歉");
    expect(messages.filter((m) => m.type === "beat_start")).toHaveLength(2);
  });

  it("排队的输入可以改也可以撤，落笔之后就不再受理", async () => {
    const { s, open, done } = busyStage();
    const { orchestrator, messages } = s;

    await orchestrator.playerAction({ kind: "prompt", text: "先别开口" });
    const id = queuedItems(messages)[0]!.id;
    orchestrator.editPending(id, "改过的意思");
    expect(queuedItems(messages)[0]!.text).toBe("改过的意思");
    expect(() => orchestrator.editPending(id, "  ")).toThrow(/不能为空/);

    await orchestrator.playerAction({ kind: "prompt", text: "另一句" });
    orchestrator.deletePending(queuedItems(messages)[1]!.id);
    expect(queuedItems(messages).map((item) => item.text)).toEqual(["改过的意思"]);
    expect(() => orchestrator.deletePending("pq-没有")).toThrow(/不在队列里/);

    open();
    await done;
    // 收在选择点上：引导还在队列里等玩家表态，落笔之后才不可改
    expect(queuedItems(messages)[0]?.status).toBe("pending");
    orchestrator.editPending(id, "x");
    await orchestrator.playerAction({ kind: "choice", optionIndex: 0 });
    expect(queuedItems(messages)).toEqual([]);
    expect(() => orchestrator.editPending(id, "x")).toThrow(/不在队列里/);
    expect(() => orchestrator.deletePending(id)).toThrow(/不在队列里/);
  });
});

describe("P6 rebuild · 谱系 → IR", () => {
  it("preload / asset_ready 不进缓冲（瞬态），玩家输入按节点 seq 同规格重放", () => {
    const tree = new LineageTree();
    tree.append("say", { text: "……太慢了！", payload: { attrs: { id: "mio", mood: "annoyed" }, seq: 1 } });
    tree.append("preload", { payload: { attrs: { id: "bg_x", prompt: "corridor" } } });
    tree.append("asset_ready", { payload: { attrs: { id: "bg_x" } } });
    tree.append("prompt", { payload: { input: "我到了", seq: 4 } });
    tree.append("narrate", { text: "风停了。", payload: { seq: 5 } });
    tree.append("beat_end", { payload: { reason: "no_stop" } });

    const events = lineageToEvents(tree.chainEvents(tree.leafId!));
    expect(events.map((e) => e.event.kind)).toEqual([
      "say_start",
      "say_text",
      "say_end",
      "player_input",
      "narrate_start",
      "narrate_text",
      "narrate_end",
    ]);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const input = events.find((e) => e.event.kind === "player_input");
    expect(input?.event).toEqual({ kind: "player_input", text: "我到了" });
  });

  it("老档的 prompt（无 seq）也重放成 player_input，seq 顺序编号", () => {
    const tree = new LineageTree();
    tree.append("prompt", { payload: { input: "（选择了：道歉）" } });
    tree.append("narrate", { text: "风停了。", payload: { seq: 2 } });

    const events = lineageToEvents(tree.chainEvents(tree.leafId!));
    expect(events.map((e) => e.event.kind)).toEqual(["player_input", "narrate_start", "narrate_text", "narrate_end"]);
    expect(events[0]!.seq).toBe(1);
    expect(events[0]!.event).toEqual({ kind: "player_input", text: "（选择了：道歉）" });
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

  it("编辑在重放时就是新文本（edit 是旁注，不进树）", () => {
    const tree = new LineageTree();
    const say = tree.append("say", { text: "原台词", payload: { attrs: { id: "mio" } } });
    tree.recordEdit(say.id, "改过的台词");

    // 编辑不占树位：物化时直接是新文本，重放链上也不会多出 edit 行
    const events = lineageToEvents(tree.materialize());
    const text = events.find((e) => e.event.kind === "say_text");
    expect(text?.event.kind === "say_text" && text.event.delta).toBe("改过的台词");
  });

  it("全屏标题卡按三段重放，对齐/出法从 attrs 还原", () => {
    const tree = new LineageTree();
    tree.append("title", {
      text: "床前明月光\n疑是地上霜",
      payload: { attrs: { align: "center", mode: "lines" }, seq: 3 },
    });
    const events = lineageToEvents(tree.chainEvents(tree.leafId!));
    expect(events.map((e) => e.event.kind)).toEqual(["title_start", "title_text", "title_end"]);
    expect(events.map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(events[0]!.event).toMatchObject({ kind: "title_start", align: "center", mode: "lines" });
    expect(events[1]!.event).toEqual({ kind: "title_text", delta: "床前明月光\n疑是地上霜" });
  });

  it("标题卡写回助手脚本体：剧作家后续轮次看得到它", () => {
    const tree = new LineageTree();
    tree.append("title", { text: "第一章\n风起", payload: { attrs: { align: "center", mode: "block" } } });
    tree.append("say", { text: "……又是这里。", payload: { attrs: { id: "mio" } } });
    tree.append("beat_end", { payload: { reason: "no_stop" } });
    const { beats } = lineageToBeats(tree.materialize(), { mio: "澪" }, "（游戏开始）");
    expect(beats[0]?.assistant).toContain("（标题）第一章\n风起");
    expect(beats[0]?.assistant).toContain("澪：……又是这里。");
  });

  it("幕划分 = 两个 beat_end 之间；未收束的半轮也算一幕", () => {
    const tree = new LineageTree();
    tree.append("prompt", { payload: { input: "我到了" } });
    tree.append("say", { text: "第一幕台词", payload: { attrs: { id: "mio" } } });
    tree.append("stop", { payload: { stopType: "choice", options: [{ text: "道歉" }] } });
    tree.append("beat_end", { payload: { reason: "stop" } });
    tree.append("say", { text: "第二幕台词", payload: { attrs: { id: "mio" } } });
    tree.append("beat_end", { payload: { reason: "no_stop" } });
    tree.append("say", { text: "半轮台词", payload: { attrs: { id: "mio" } } });

    const { beats, trailingInputs } = lineageToBeats(tree.materialize(), { mio: "澪" }, "（游戏开始）");
    expect(beats).toHaveLength(3);
    expect(beats[0]?.user).toContain("我到了");
    expect(beats[0]?.assistant).toContain("澪：第一幕台词");
    expect(beats[0]?.assistant).toContain("等待玩家选择：道歉");
    expect(beats[1]?.user).toBe("【开场】\n（游戏开始）");
    expect(beats[1]?.assistant).toContain("第二幕台词");
    expect(beats[2]?.assistant).toContain("半轮台词");
    expect(trailingInputs).toEqual([]);
  });

  it("链尾悬空的一次表态不凑空轮次，原样退回给编排器并进下一轮", () => {
    const tree = new LineageTree();
    tree.append("prompt", { payload: { input: "我到了" } });
    tree.append("say", { text: "第一幕台词", payload: { attrs: { id: "mio" } } });
    tree.append("beat_end", { payload: { reason: "stop" } });
    tree.append("prompt", { payload: { input: "（选择了：道歉）" } });

    const { beats, trailingInputs } = lineageToBeats(tree.materialize(), { mio: "澪" }, "（游戏开始）");
    expect(beats).toHaveLength(1); // 没有第二条 assistant
    // 退的是原文，【用户输入】标签由并进下一轮的那一处（renderPromptTurn）补——这里先拼一遍就套两层了
    expect(trailingInputs).toEqual(["（选择了：道歉）"]);
    expect(beats[0]?.user).toBe("【用户输入】\n我到了");
  });

  it("stop 事件 → 停止点载荷（choice/free）；beat_end 不产出停止点事件", () => {
    const tree = new LineageTree();
    tree.append("stop", { payload: { stopType: "choice", options: [{ text: "道歉" }] } });
    tree.append("beat_end", { payload: { reason: "no_stop" } });

    const chain = tree.chainEvents(tree.leafId!).filter((e) => e.kind !== "root");
    expect(stopFromEvent(chain[0]!)).toEqual({
      stopType: "choice",
      options: [{ text: "道歉" }],
    });
    expect(lineageToEvents(chain).map((e) => e.event.kind)).toEqual(["stop"]);
  });

  it("旧的 pause 停止点不再还原成停止点（幕末走「下一幕」）", () => {
    const tree = new LineageTree();
    tree.append("stop", { payload: { stopType: "pause" } });
    const chain = tree.chainEvents(tree.leafId!).filter((e) => e.kind !== "root");
    expect(stopFromEvent(chain[0]!)).toBeNull();
    expect(lineageToEvents(chain).map((e) => e.event.kind)).toEqual([]);
  });
});

describe("限制级段落的按读者折叠", () => {
  /**
   * 三段式：日常 → 限制级（两拍，段末那一拍带摘要）→ 日常。
   * 段内每个节点都带 `nsfw` 标、段末 `beat_end` 带 `nsfwSummary`——这是折叠的唯一依据。
   */
  function nsfwChain(): LineageTree {
    const tree = new LineageTree();
    tree.append("prompt", { payload: { input: "我推开了门" } });
    tree.append("say", { text: "她抬起头。", payload: { attrs: { id: "mio" } } });
    tree.append("beat_end", { payload: { reason: "no_stop" } });
    tree.append("prompt", { payload: { input: "（选择了：走近她）", nsfw: true } });
    tree.append("say", { text: "赤裸的告白", payload: { attrs: { id: "mio" }, nsfw: true } });
    tree.append("beat_end", { payload: { reason: "no_stop", nsfw: true } });
    tree.append("prompt", { payload: { input: "（选择了：再近一些）", nsfw: true } });
    tree.append("say", { text: "更露骨的话", payload: { attrs: { id: "mio" }, nsfw: true } });
    tree.append("beat_end", {
      payload: { reason: "stop", nsfw: true, nsfwSummary: "两人互诉心意，关系有了突破。" },
    });
    tree.append("prompt", { payload: { input: "第二天早上" } });
    tree.append("say", { text: "早啊。", payload: { attrs: { id: "mio" } } });
    tree.append("beat_end", { payload: { reason: "no_stop" } });
    return tree;
  }

  const rebuild = (tree: LineageTree, nsfw: boolean) =>
    lineageToBeats(tree.materialize(), { mio: "澪" }, "（游戏开始）", { nsfw });

  it("SFW 侧：整段折叠成一条过渡轮，原文与段内玩家输入都不进消息", () => {
    const { beats, trailingInputs } = rebuild(nsfwChain(), false);

    expect(beats).toHaveLength(3);
    expect(beats[0]?.user).toContain("我推开了门");
    expect(beats[0]?.assistant).toContain("她抬起头。");
    // 折叠出来的那一条就是实时退出时注入的同一句话（nsfwTransitionBeat 一份措辞两处用）
    expect(beats[1]).toMatchObject(nsfwTransitionBeat("两人互诉心意，关系有了突破。"));
    expect(beats[2]?.user).toContain("第二天早上");
    expect(beats[2]?.assistant).toContain("早啊。");

    const all = beats.map((b) => `${b.user}\n${b.assistant}`).join("\n");
    expect(all).not.toContain("赤裸的告白");
    expect(all).not.toContain("更露骨的话");
    expect(all).not.toContain("走近她");
    expect(all).not.toContain("再近一些");
    expect(all).toContain("两人互诉心意");
    expect(trailingInputs).toEqual([]);
  });

  it("NSFW 侧：原文照渲，摘要不用（同一段不出两份）", () => {
    const { beats } = rebuild(nsfwChain(), true);

    expect(beats).toHaveLength(4);
    expect(beats[1]?.user).toContain("走近她");
    expect(beats[1]?.assistant).toContain("赤裸的告白");
    expect(beats[2]?.user).toContain("再近一些");
    expect(beats[2]?.assistant).toContain("更露骨的话");
    expect(beats[3]?.assistant).toContain("早啊。");

    const all = beats.map((b) => `${b.user}\n${b.assistant}`).join("\n");
    expect(all).not.toContain("两人互诉心意");
    expect(all).not.toContain("前情提要");
  });

  it("段外内容两种模式完全一致", () => {
    const tree = nsfwChain();
    const sfw = rebuild(tree, false);
    const raw = rebuild(tree, true);
    expect(sfw.beats[0]).toEqual(raw.beats[0]);
    expect(sfw.beats[2]).toEqual(raw.beats[3]);
  });

  it("没有标记的老档不受影响：两位读者渲出来的东西一样", () => {
    const tree = new LineageTree();
    tree.append("prompt", { payload: { input: "我到了" } });
    tree.append("say", { text: "旧档里的露骨台词", payload: { attrs: { id: "mio" } } });
    tree.append("beat_end", { payload: { reason: "no_stop" } });

    const sfw = rebuild(tree, false);
    const raw = rebuild(tree, true);
    expect(sfw.beats).toEqual(raw.beats);
    expect(sfw.beats[0]?.assistant).toContain("旧档里的露骨台词");
  });

  it("段落收束后链尾只剩摘要：段内事件一个都不漏", () => {
    const tree = nsfwChain();
    // 截到段末那一拍（带摘要的 beat_end）为止
    const chain = tree.chainEvents(tree.leafId!);
    const endIdx = chain.findIndex((e) => e.payload?.nsfwSummary !== undefined);
    const cut = chain.slice(0, endIdx + 1);

    const { beats, trailingInputs } = lineageToBeats(cut, { mio: "澪" }, "（游戏开始）", {
      nsfw: false,
    });
    expect(beats).toHaveLength(2);
    expect(beats[1]).toMatchObject(nsfwTransitionBeat("两人互诉心意，关系有了突破。"));
    expect(trailingInputs).toEqual([]);
  });
});

describe("纪元压缩投影", () => {
  /** 三拍链：每拍一句台词 + beat_end；返回每拍的 beat_end id。 */
  function threeBeats(): { tree: LineageTree; ends: string[] } {
    const tree = new LineageTree();
    const ends: string[] = [];
    for (const text of ["第一拍", "第二拍", "第三拍"]) {
      tree.append("say", { text, payload: { attrs: { id: "mio" } } });
      ends.push(tree.append("beat_end", { payload: { reason: "no_stop" } }).id);
    }
    return { tree, ends };
  }
  const rebuild = (tree: LineageTree, cutNodeId: string) =>
    lineageToBeats(tree.materialize(), { mio: "澪" }, "（游戏开始）", {
      compaction: { summary: "两人在走廊上定了约定。", cutNodeId, tokensBefore: 999 },
    });

  it("切点之前的拍折成摘要，并进保留段首拍（不新起一条 user）", () => {
    const { tree, ends } = threeBeats();
    const { beats } = rebuild(tree, ends[0]!);

    expect(beats).toHaveLength(2);
    expect(beats[0]!.user).toContain("【前情提要】");
    expect(beats[0]!.user).toContain("两人在走廊上定了约定。");
    expect(beats[0]!.user).toContain("【开场】"); // 摘要是并进首拍，不是替掉它
    expect(beats[0]!.assistant).toContain("第二拍");
    expect(beats.map((b) => b.assistant).join("\n")).not.toContain("第一拍");
    // 每拍都带自己前一个 beat_end：下一次压缩按它记切点
    expect(beats[0]!.boundaryId).toBe(ends[0]);
    expect(beats[1]!.boundaryId).toBe(ends[1]);
  });

  it("切点不在链上（记录是别的分支写的）：原文照渲", () => {
    const { tree } = threeBeats();
    const { beats } = rebuild(tree, "别的分支上的节点");

    expect(beats).toHaveLength(3);
    expect(beats[0]!.boundaryId).toBeNull();
    expect(JSON.stringify(beats)).not.toContain("前情提要");
    expect(beats[0]!.assistant).toContain("第一拍");
  });

  it("切点之后没有拍：摘要自己成一条，不至于一个字都不剩", () => {
    const { tree, ends } = threeBeats();
    const { beats } = rebuild(tree, ends[2]!);

    expect(beats).toHaveLength(1);
    expect(beats[0]!.user).toContain("前情提要");
    expect(beats[0]!.boundaryId).toBe(ends[2]);
  });
});
