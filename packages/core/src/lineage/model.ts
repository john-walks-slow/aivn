/**
 * 谱系数据模型 —— 行级事件日志是唯一真相源（计划 D7/D10）。
 *
 * - 事件 append-only：行级演出事件按序持久化（JSONL），parentId 构成分支树；
 * - 原地编辑 = 追加 edit 事件覆盖目标行文本（edit 是挂在目标旁边的旁注，不入树），日志永不改写；
 * - **跳转 vs 分岔**（两个正交原语，边界在本文件里定死）：
 *   跳转 `jumpTo` 只移挂载点、不追加事件，不生成任何内容；活节点上是往前走，
 *   已废弃的节点上是回到那条岔掉的线。分岔 `recordFork` 把挂载点移到目标**并追加一条
 *   fork 标记事件**，于是目标之后原有的内容整段转为兄弟分支。分岔本身不重新生成——
 *   「重演」只是分岔之后接的一拍（`fork { resume: true }`）。
 *   前者改「现在在哪」，后者改「接下来是什么」。
 * - 谱系快照随分支走：恢复 = 当前路径上最近的快照。
 */

import type { OptionAttrs, StopType } from "../dsl/spec.js";
import { toNodeView } from "./replay.js";

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
  | "prompt"
  | "beat_end"
  | "edit"
  | "fork";

/** 行级事件的载荷（编排器按 kind 填充）。 */
export interface LineagePayload {
  /** 演出指令属性（scene bg/bgm、actor pos/expression 等）。 */
  attrs?: Record<string, string>;
  /** 玩家输入原文（选项选择 / 自由输入 / 插一句，含 OOC 意图）。 */
  input?: string;
  /** 选项选择记录。 */
  choice?: { index: number; text: string; value?: string };
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
  /** 被原地改过的行：最新改写文本（未改过则 null）。 */
  editedText: string | null;
  /** 改写次数（同句反复改就是多次）。 */
  editCount: number;
  /** 最近一次改写时刻。 */
  editedAt: number | undefined;
  /** 剧本事件的 seq（say_start/narrate_start/scene/… 的序号）：与客户端 ScriptLine.seq 同尺，
   *  路线树据此把谱系卡片精确对到剧本行上。prompt/fork/edit 无 seq。 */
  seq: number | undefined;
  /** stop 事件专有：停止点类型/选项/占位文案。attrs 里那个 stopType 只是给旧客户端兜底的，
   *  客户端只读回看要按原样重建停止点，选项必须留在投影里。 */
  stopType?: StopType;
  stopOptions?: OptionAttrs[];
  stopPlaceholder?: string;
}

export interface LineageView {
  nodes: LineageNodeView[];
  leafId: string | null;
  /** 当前分支的节点 id 链（root → leaf，序即演出顺序）：剧本视图直接照此渲染。 */
  pathIds: string[];
}

const EDITABLE_KINDS: ReadonlySet<string> = new Set(["say", "narrate", "thought"]);

/** 持久化结构：事件日志（真相源）+ 会话运行态（leafId）+ 分岔事实快照。 */
export interface LineageStore {
  events: LineageEvent[];
  leafId: string | null;
  snapshots: LineageSnapshot[];
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
  /** 目标行 id → 该行历次改写（旁注，不进树也不动挂载点：纯原地）。 */
  private readonly edits = new Map<string, LineageEvent[]>();
  private leaf: string | null = null;
  /** nodeId → 最近快照（一个节点保留一份，后存覆盖）。 */
  private readonly snapshotsByNode = new Map<string, LineageSnapshot>();

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

  /**
   * 跳转：把挂载点移到该节点，后续 append 成为新世界线。
   *
   * 这只是移动游标，不追加任何事件——「跳转」与「分岔」的分野就在这里。
   * 目标节点在不在当前路径上都能跳：活的跳上去是往前走，跳到已废弃的节点上
   * 是回到那条岔掉的线（该节点之后的原剧情转为废弃分支，历史一条不删）。
   * 想真的开出新内容，是分岔（`recordFork`）的事，不是这里。
   */
  jumpTo(nodeId: string): LineageEvent {
    const node = this.requireNode(nodeId);
    this.leaf = node.id;
    return node;
  }

  /**
   * 分岔：挂载点移到目标节点，并落一个 fork 标记事件。
   *
   * 目标节点之后原有的内容整段转为兄弟分支（拍中分岔即截断）。fork 事件自身不产内容，
   * 它的存在只为让「这条线是从哪儿岔出来的」在日志里可查——分岔不留痕等于没发生。
   */
  recordFork(nodeId: string): LineageEvent {
    this.jumpTo(nodeId);
    return this.append("fork");
  }

  /**
   * 原地编辑：追加一条旁注覆盖目标行文本。
   *
   * edit **不挂到树上、不动挂载点**——改这一句只改这一句，剧情接着往下演，不产生隐藏分支。
   * 物化时按目标行取最后一条改写；目标不在当前分支上时改写不生效。
   */
  recordEdit(nodeId: string, newText: string): LineageEvent {
    const target = this.requireNode(nodeId);
    if (!EDITABLE_KINDS.has(target.kind)) {
      throw new Error(`只有台词行可编辑，${nodeId} 是 ${target.kind}`);
    }
    const event: LineageEvent = {
      id: nextId(),
      parentId: null,
      kind: "edit",
      turn: target.turn,
      text: newText,
      editTargetId: target.id,
      createdAt: Date.now(),
    };
    const list = this.edits.get(target.id);
    if (list) list.push(event);
    else this.edits.set(target.id, [event]);
    return event;
  }

  /** 物化分支剧本（root→leaf 重放；edit 覆盖目标行文本，fork 自身不占行）。 */
  materialize(fromLeaf: string | null = this.leaf): LineageEvent[] {
    const script: LineageEvent[] = [];
    for (const id of this.ancestorChain(fromLeaf)) {
      const event = this.events.get(id)!;
      if (event.kind === "fork") continue;
      const history = this.edits.get(id);
      if (history?.length) {
        const latest = history[history.length - 1]!;
        script.push({ ...event, text: latest.text });
        continue;
      }
      script.push(event);
    }
    return script;
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

  /** 保存谱系快照（分岔/重写时）。 */
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

  /** 路线树视图：全量节点（含废弃分支）+ 路径标记（父先于子）。 */
  describe(): LineageView {
    const onPath = this.pathSet();
    const childCount = new Map<string, number>();
    for (const event of this.events.values()) {
      if (event.parentId === null) continue;
      childCount.set(event.parentId, (childCount.get(event.parentId) ?? 0) + 1);
    }
    const nodes = [...this.events.values()]
      // 同一次工具批次的多个事件共用 createdAt，只按它排会随机抖动，路线树的分岔口
      // 因此忽左忽右；id 兜成第二稳定键，视图每次渲染的节点顺序完全一致。
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((event) => {
        const view = toNodeView(event);
        view.onPath = onPath.has(event.id);
        view.children = childCount.get(event.id) ?? 0;
        // edit 是挂在目标旁边的旁注，不在树上，所以要单独把这几条挂回投影里
        const history = this.edits.get(event.id) ?? [];
        const latest = history[history.length - 1];
        view.editedText = latest?.text ?? null;
        view.editCount = history.length;
        view.editedAt = latest?.createdAt;
        return view;
      });
    return {
      nodes,
      leafId: this.leaf,
      pathIds: this.ancestorChain(this.leaf),
    };
  }

  get(id: string): LineageEvent | undefined {
    return this.events.get(id);
  }

  /** 完整会话状态导出（事件真相源 + leaf 运行态 + 快照/书签存档事实），跨进程持久化用。 */
  export(): LineageStore {
    return {
      // 编辑旁注与树事件同流落盘（append-only 单日志），但排在末尾：读回时两者分流，
      // 顺序不影响任何语义。
      events: [...this.events.values(), ...[...this.edits.values()].flat()],
      leafId: this.leaf,
      snapshots: [...this.snapshotsByNode.values()],
    };
  }

  /** 从持久化会话状态重建（leaf 显式恢复，不用事件尾推断——裸分岔状态不丢）。 */
  load(store: LineageStore): void {
    for (const event of store.events) {
      // edit 是旁注：落进目标行的改写历史，不进树也不动挂载点。
      if (event.kind === "edit" && event.editTargetId) {
        const list = this.edits.get(event.editTargetId);
        if (list) list.push(event);
        else this.edits.set(event.editTargetId, [event]);
        continue;
      }
      this.attach(event);
    }
    // attach 已把 leaf 推到最后一个树事件；只在无 leafId 时拿它兜底。
    this.leaf = store.leafId ?? this.leaf;
    for (const snapshot of store.snapshots) this.snapshotsByNode.set(snapshot.nodeId, snapshot);
    seedNextId([
      ...store.events.map((e) => e.id),
      ...store.snapshots.map((s) => s.id),
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
