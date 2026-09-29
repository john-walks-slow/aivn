/**
 * 谱系数据模型 —— 行级事件日志是唯一真相源（计划 D7/D10）。
 *
 * - 事件 append-only：行级演出事件按序持久化（JSONL），parentId 构成分支树；
 * - 原地编辑 = 追加 edit 事件（editTargetId + 新文本），物化时覆盖目标行——日志永不改写；
 * - 分岔/重写由树结构表达：forkAt 把挂载点移到目标节点，后续事件成为新分支；
 * - 谱系快照随分支走：恢复 = 当前路径上最近的快照。
 */

export type LineageEventKind =
  | "scene"
  | "actor"
  | "say"
  | "narrate"
  | "thought"
  | "sfx"
  | "preload"
  | "cg"
  | "stop"
  | "player"
  | "ooc"
  | "beat_end"
  | "edit"
  | "rewrite";

/** 行级事件的载荷（编排器按 kind 填充）。 */
export interface LineagePayload {
  /** 演出指令属性（scene bg/bgm、actor pos/expression 等）。 */
  attrs?: Record<string, string>;
  /** 玩家表态 / OOC 指令原文。 */
  input?: string;
  /** 选项选择记录。 */
  choice?: { index: number; text: string; value?: string };
  /** 重写的 instruction（可选）。 */
  instruction?: string;
  /** 重写粒度。 */
  granularity?: "line" | "beat";
  [key: string]: unknown;
}

export interface LineageEvent {
  id: string;
  parentId: string | null;
  kind: LineageEventKind;
  /** 分支深度（时序水位；跨分支比较用深度而非全局计数，防 turn 碰撞）。 */
  turn: number;
  /** say/narrate/thought 的完整行文本；edit 事件中为覆盖目标的新文本。 */
  text?: string;
  payload?: LineagePayload;
  createdAt: number;
  /** 原地编辑的目标事件 id（仅 kind=edit）。 */
  editTargetId?: string;
}

export interface EngineStateSnapshot {
  turn: number;
  affinity: Record<string, number>;
  flags: Record<string, string | number | boolean>;
}

export interface MemorySnapshot {
  /** always/state 层内容（小，直接内联）。 */
  state: Record<string, string>;
  /** arcs 摘要 id 列表（引用，内容在剧目记忆目录）。 */
  arcs: string[];
}

export interface LineageSnapshot {
  id: string;
  nodeId: string;
  turn: number;
  engine: EngineStateSnapshot;
  memory: MemorySnapshot;
  createdAt: number;
}

export interface Bookmark {
  id: string;
  nodeId: string;
  name: string;
  createdAt: number;
}

/** 路线树视图（前端渲染用）：事件全集投影 + 路径标记，替代存读档的「历史即存档」。 */
export interface LineageNodeView {
  id: string;
  parentId: string | null;
  kind: LineageEventKind;
  turn: number;
  text: string;
  attrs: Record<string, string>;
  createdAt: number;
  /** 在当前分支路径上（主链路 = true，废弃分支 = false）。 */
  onPath: boolean;
  /** 子节点数：>1 即分叉点（多个历史版本从这里长出）。 */
  children: number;
  /** edit 事件专有：被改写的台词行 id。 */
  editTargetId: string | undefined;
  /** rewrite 事件专有：重写粒度标注（line/beat）。 */
  granularity: string | undefined;
}

export interface LineageView {
  nodes: LineageNodeView[];
  leafId: string | null;
  /** 当前分支的节点 id 链（root → leaf，序即演出顺序）：剧本视图直接照此渲染。 */
  pathIds: string[];
  bookmarks: Bookmark[];
}

const EDITABLE_KINDS: ReadonlySet<string> = new Set(["say", "narrate", "thought"]);

/** 持久化结构：事件日志（真相源）+ 会话运行态（leafId）+ 用户存档事实（快照/书签）。 */
export interface LineageStore {
  events: LineageEvent[];
  leafId: string | null;
  snapshots: LineageSnapshot[];
  bookmarks: Bookmark[];
}

let nextIdCounter = 0;
function nextId(): string {
  nextIdCounter += 1;
  return `e${Date.now().toString(36)}-${nextIdCounter.toString(36)}`;
}

/** 重启后从既有 id 播种计数器，防同毫秒计数碰撞。 */
function seedNextId(ids: string[]): void {
  for (const id of ids) {
    const dash = id.indexOf("-");
    if (dash === -1) continue;
    const counter = Number.parseInt(id.slice(dash + 1), 36);
    if (Number.isFinite(counter) && counter > nextIdCounter) nextIdCounter = counter;
  }
}

/**
 * 谱系树：内存态（持久化 = 事件流 JSONL，回放 load() 重建）。
 */
export class LineageTree {
  private readonly events = new Map<string, LineageEvent>();
  private leaf: string | null = null;
  /** nodeId → 最近快照（一个节点保留一份，后存覆盖）。 */
  private readonly snapshotsByNode = new Map<string, LineageSnapshot>();
  private readonly bookmarks = new Map<string, Bookmark>();

  get leafId(): string | null {
    return this.leaf;
  }

  append(kind: LineageEventKind, opts: { text?: string; payload?: LineagePayload } = {}): LineageEvent {
    return this.attach({
      id: nextId(),
      parentId: this.leaf,
      kind,
      turn: this.nextTurn(),
      text: opts.text,
      payload: opts.payload,
      createdAt: Date.now(),
    });
  }

  /** 从任意节点开新分支：挂载点移到该节点，后续 append 成为新分支。 */
  forkAt(nodeId: string): LineageEvent {
    const node = this.requireNode(nodeId);
    this.leaf = node.id;
    return node;
  }

  /** 原地编辑：追加 edit 事件覆盖目标行文本（当前分支，不产生新分支）。 */
  editInPlace(nodeId: string, newText: string): LineageEvent {
    const target = this.requireNode(nodeId);
    if (!EDITABLE_KINDS.has(target.kind)) {
      throw new Error(`只有台词行可编辑，${nodeId} 是 ${target.kind}`);
    }
    return this.attach({
      id: nextId(),
      parentId: this.leaf,
      kind: "edit",
      turn: this.nextTurn(),
      text: newText,
      editTargetId: target.id,
      createdAt: Date.now(),
    });
  }

  /**
   * 重写标注（分岔 + 重生成）：回退到目标**之前**（挂载点移到其父节点，目标行留在废弃分支）。
   *
   * 粒度契约：granularity 仅记录意图与 UI 标注；**beat 边界解析归编排器**——
   * "beat" 重写时编排器须先解析节拍边界（beat_end/stop 之后的第一个事件）并把 nodeId 传节拍首行。
   * core 不事后推算节拍（beat 生命周期由编排器拥有）。
   */
  recordRewrite(nodeId: string, granularity: "line" | "beat", instruction?: string): LineageEvent {
    const target = this.requireNode(nodeId);
    this.leaf = target.parentId;
    return this.append("rewrite", { payload: { granularity, instruction } });
  }

  /** 物化分支剧本（root→leaf 重放；edit 覆盖目标行文本，edit/rewrite 自身不占行）。 */
  materialize(fromLeaf: string | null = this.leaf): LineageEvent[] {
    const chain = this.ancestorChain(fromLeaf);
    const textOverride = new Map<string, string>();
    const script: LineageEvent[] = [];
    for (const id of chain) {
      const event = this.events.get(id)!;
      if (event.kind === "edit") {
        if (event.editTargetId) textOverride.set(event.editTargetId, event.text ?? "");
        continue;
      }
      if (event.kind === "rewrite") continue;
      script.push(event);
    }
    if (textOverride.size === 0) return script;
    return script.map((event) =>
      textOverride.has(event.id) ? { ...event, text: textOverride.get(event.id) } : event,
    );
  }

  /** 祖先链（root → node，含自身）。 */
  ancestorChain(nodeId: string | null): string[] {
    const chain: string[] = [];
    let cursor = nodeId;
    while (cursor !== null) {
      const event = this.events.get(cursor);
      if (!event) throw new Error(`谱系节点不存在: ${cursor}`);
      chain.push(cursor);
      cursor = event.parentId;
    }
    return chain.reverse();
  }

  /** 祖先链上的事件对象（root → node，含自身）；上下文重建的输入形态。 */
  chainEvents(nodeId: string | null): LineageEvent[] {
    return this.ancestorChain(nodeId).map((id) => this.events.get(id)!);
  }

  isAncestor(candidateId: string, nodeId: string): boolean {
    return candidateId !== nodeId && this.ancestorChain(nodeId).includes(candidateId);
  }

  /** 保存谱系快照（分岔/书签时）。 */
  saveSnapshot(engine: EngineStateSnapshot, memory: MemorySnapshot): LineageSnapshot {
    if (this.leaf === null) throw new Error("空树不能保存快照");
    const snapshot: LineageSnapshot = {
      id: nextId(),
      nodeId: this.leaf,
      turn: this.events.get(this.leaf)?.turn ?? 0,
      engine,
      memory,
      createdAt: Date.now(),
    };
    this.snapshotsByNode.set(snapshot.nodeId, snapshot);
    return snapshot;
  }

  /** 在指定节点挂快照（书签：标记历史位置，不动挂载点）。 */
  saveSnapshotAt(nodeId: string, engine: EngineStateSnapshot, memory: MemorySnapshot): LineageSnapshot {
    const node = this.requireNode(nodeId);
    const snapshot: LineageSnapshot = {
      id: nextId(),
      nodeId: node.id,
      turn: node.turn,
      engine,
      memory,
      createdAt: Date.now(),
    };
    this.snapshotsByNode.set(snapshot.nodeId, snapshot);
    return snapshot;
  }

  /** 当前路径上最近的快照（无则 null，调用方走冷启动装配）。 */
  latestSnapshotOnPath(nodeId: string | null = this.leaf): LineageSnapshot | null {
    const chain = this.ancestorChain(nodeId);
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const snapshot = this.snapshotsByNode.get(chain[i]!);
      if (snapshot) return snapshot;
    }
    return null;
  }

  /** 当前路径节点集合（一次性判定，供检索防剧透过滤：祖先链 ⊆ 当前分支路径）。 */
  pathSet(nodeId: string | null = this.leaf): Set<string> {
    return new Set(this.ancestorChain(nodeId));
  }

  /**
   * 书签：命名节点标记（= 传统存档）。注意书签本身不自动快照——
   * "谱系快照随书签保存"由编排器组合 addBookmark + saveSnapshot 完成；
   * 无快照的书签在续演时走冷启动装配。
   */
  addBookmark(nodeId: string, name: string): Bookmark {
    this.requireNode(nodeId);
    const bookmark: Bookmark = { id: nextId(), nodeId, name, createdAt: Date.now() };
    this.bookmarks.set(bookmark.id, bookmark);
    return bookmark;
  }

  listBookmarks(): Bookmark[] {
    return [...this.bookmarks.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  /** 摘除书签（只是标记，误删可再标；不动物理分支）。 */
  removeBookmark(bookmarkId: string): boolean {
    return this.bookmarks.delete(bookmarkId);
  }

  /** 路线树视图：全量节点（含废弃分支）+ 路径标记 + 书签（按 id 升序，父先于子）。 */
  describe(): LineageView {
    const onPath = this.pathSet();
    const childCount = new Map<string, number>();
    for (const event of this.events.values()) {
      if (event.parentId === null) continue;
      childCount.set(event.parentId, (childCount.get(event.parentId) ?? 0) + 1);
    }
    const nodes = [...this.events.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((event) => ({
        id: event.id,
        parentId: event.parentId,
        kind: event.kind,
        turn: event.turn,
        text: event.text ?? "",
        attrs: event.payload?.attrs ?? {},
        createdAt: event.createdAt,
        onPath: onPath.has(event.id),
        children: childCount.get(event.id) ?? 0,
        editTargetId: event.editTargetId,
        granularity: event.payload?.granularity,
      }));
    return {
      nodes,
      leafId: this.leaf,
      pathIds: this.ancestorChain(this.leaf),
      bookmarks: this.listBookmarks(),
    };
  }

  get(id: string): LineageEvent | undefined {
    return this.events.get(id);
  }

  /** 完整会话状态导出（事件真相源 + leaf 运行态 + 快照/书签存档事实），跨进程持久化用。 */
  export(): LineageStore {
    return {
      events: [...this.events.values()],
      leafId: this.leaf,
      snapshots: [...this.snapshotsByNode.values()],
      bookmarks: [...this.bookmarks.values()],
    };
  }

  /** 从持久化会话状态重建（leaf 显式恢复，不用事件尾推断——裸分岔状态不丢）。 */
  load(store: LineageStore): void {
    for (const event of store.events) this.attach(event);
    this.leaf = store.leafId ?? store.events.at(-1)?.id ?? null;
    for (const snapshot of store.snapshots) this.snapshotsByNode.set(snapshot.nodeId, snapshot);
    for (const bookmark of store.bookmarks) this.bookmarks.set(bookmark.id, bookmark);
    seedNextId([
      ...store.events.map((e) => e.id),
      ...store.snapshots.map((s) => s.id),
      ...store.bookmarks.map((b) => b.id),
    ]);
  }

  private nextTurn(): number {
    return this.leaf === null ? 0 : (this.events.get(this.leaf)?.turn ?? -1) + 1;
  }

  private attach(event: LineageEvent): LineageEvent {
    if (event.parentId !== null && !this.events.has(event.parentId)) {
      throw new Error(`父节点不存在: ${event.parentId}`);
    }
    this.events.set(event.id, event);
    this.leaf = event.id;
    return event;
  }

  private requireNode(nodeId: string): LineageEvent {
    const event = this.events.get(nodeId);
    if (!event) throw new Error(`谱系节点不存在: ${nodeId}`);
    return event;
  }
}
