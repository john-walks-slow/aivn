import type { AssistantMessage } from "@earendil-works/pi-ai";

/**
 * 剧作家 session 历史快照：只读历史视图的数据模型（REST `/api/plays/:id/history` 的响应形状即此）。
 *
 * 与谱系事件日志的分工：谱系记「演出发生了什么」（行级、已解析、可回看可分岔），
 * 这里记「剧作家是怎么写出来的」——注入的 user 原文、思考、**未经解析的原始 DSL**、工具调用。
 * 数据由编排器的 agent 事件流边跑边累积，不在事后遍历 `agent.state.messages`（那会被纪元压缩切掉）。
 */

/** 带正文的条目（注入文本 / 思考 / 模型原始输出）。 */
export interface HistoryTextEntry {
  /** 拍号：与 `runtime.beatNo` 同尺。 */
  beat: number;
  /** 拍内自增序号（从 1 起）：稳定排序与去重的锚。 */
  seq: number;
  role: "user" | "thinking" | "assistant";
  /** 原文。不解析、不裁剪、不转义——「模型到底吐了什么」是这层的唯一职责。 */
  text: string;
}

/** 工具调用条目：工具名 + 参数原样。 */
export interface HistoryToolCallEntry {
  beat: number;
  seq: number;
  role: "toolCall";
  name: string;
  args: Record<string, unknown>;
}

export type HistoryEntry = HistoryTextEntry | HistoryToolCallEntry;

/** 一拍的历史。 */
export interface HistoryBeat {
  /** 拍号（与 entries[].beat 冗余一份，客户端按拍分组时不必回扫）。 */
  turn: number;
  /** 按 seq 升序。 */
  entries: HistoryEntry[];
}

/**
 * 落盘保留拍数。
 * 历史体积随拍数线性涨，而单拍原文常带长思考 + 未裁剪 DSL（比落谱系的行级文本大一个量级），
 * session.json 每次拍收束都全量重写，无上限攒下去会既胀又慢。20 拍足够回看「最近这一段怎么写的」，
 * 更早的内容在 archive 与纪元摘要里另有去处。
 */
export const HISTORY_BEATS_KEPT = 20;

/** 内部累加组：多带一个「本拍首条记录时的谱系叶」，分岔/跳转后据此判断这一拍还在不在当前分支上。 */
interface HistoryGroup extends HistoryBeat {
  leafId: string | null;
}

type HistoryPayload =
  | { role: HistoryTextEntry["role"]; text: string }
  | { role: "toolCall"; name: string; args: Record<string, unknown> };

/**
 * 历史累积器（编排器私有状态，进程内一份）。
 * 只保留最近 {@link HISTORY_BEATS_KEPT} 拍——落盘与对外快照走的是同一份截断结果，两边不会打架。
 */
export class HistoryRecorder {
  private readonly groups: HistoryGroup[] = [];

  /** seed = 恢复会话时从 session.json 读回的既有历史（重启不该把历史清零）。 */
  constructor(seed: readonly HistoryBeat[] = []) {
    for (const beat of seed) {
      this.groups.push({ turn: beat.turn, entries: beat.entries.map((e) => ({ ...e })), leafId: null });
    }
    this.trim();
  }

  /** 对外只读快照（深拷贝：调用方改了也污染不到现场）。 */
  snapshot(): HistoryBeat[] {
    return this.groups.map(({ turn, entries }) => ({
      turn,
      entries: entries.map((e) => ({ ...e })),
    }));
  }

  /** 注入的 user 原文（B 区拼出的状态区 / 导演注 / 玩家表态）。beat 传「将要开的那一拍」。 */
  addUser(beat: number, text: string, leafId: string | null): void {
    this.push(beat, leafId, { role: "user", text });
  }

  /** 一条 assistant 消息 → 条目，顺序即消息 content 块的顺序（思考与 DSL 谁先谁后如实保留）。 */
  addAssistantMessage(beat: number, message: AssistantMessage, leafId: string | null): void {
    for (const block of message.content) {
      if (block.type === "text") this.push(beat, leafId, { role: "assistant", text: block.text });
      else if (block.type === "thinking") this.push(beat, leafId, { role: "thinking", text: block.thinking });
      else this.push(beat, leafId, { role: "toolCall", name: block.name, args: block.arguments });
    }
  }

  /**
   * 上下文重建后回退：只留下挂载点路径上、且已演完的拍。
   * 两条判据缺一不可——`onPath` 滤掉兄弟与废弃分支；`completedBeat` 滤掉被拍中截断砍掉后半的那一拍
   * （它在旧分支上不成立，新分支要重新演一遍，混着看等于把两个世界的同一拍拼到一起）。
   */
  rebaseTo(onPath: ReadonlySet<string>, completedBeat: number): void {
    for (let i = this.groups.length - 1; i >= 0; i -= 1) {
      const group = this.groups[i]!;
      // leafId 为 null = 恢复会话时从磁盘回灌，来路已在当前分支上（分岔前的历史都在路径里）
      const offBranch = group.leafId !== null && !onPath.has(group.leafId);
      if (offBranch || group.turn > completedBeat) this.groups.splice(i, 1);
    }
  }

  private push(beat: number, leafId: string | null, payload: HistoryPayload): void {
    let group = this.groups.find((g) => g.turn === beat);
    if (!group) {
      // 拍号在回跳后会变小（跳转回旧节点），新组按拍号插回原位而不是挂在末尾
      const at = this.groups.findIndex((g) => g.turn > beat);
      group = { turn: beat, entries: [], leafId };
      this.groups.splice(at === -1 ? this.groups.length : at, 0, group);
      this.trim();
    }
    const seq = group.entries.length + 1;
    if (payload.role === "toolCall") {
      group.entries.push({ beat, seq, role: "toolCall", name: payload.name, args: payload.args });
      return;
    }
    // 空白块不记：它不携带任何信息，却会在历史里占一个 seq（过滤只看 trim，存的仍是原样）
    if (!payload.text.trim()) return;
    group.entries.push({ beat, seq, role: payload.role, text: payload.text });
  }

  private trim(): void {
    if (this.groups.length > HISTORY_BEATS_KEPT) {
      this.groups.splice(0, this.groups.length - HISTORY_BEATS_KEPT);
    }
  }
}

/** session.json 的 history 键 → 结构化历史。缺/坏/非数组一律空表：历史是只读视图，不该把读接口拖挂。 */
export function parseHistory(raw: unknown): HistoryBeat[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryBeat[] = [];
  for (const item of raw) {
    const beat = parseBeat(item);
    if (beat) out.push(beat);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEntry(value: unknown): HistoryEntry | null {
  if (!isRecord(value)) return null;
  const { beat, seq } = value;
  if (typeof beat !== "number" || typeof seq !== "number") return null;
  if (value.role === "toolCall") {
    if (typeof value.name !== "string") return null;
    return { beat, seq, role: "toolCall", name: value.name, args: isRecord(value.args) ? value.args : {} };
  }
  if (value.role !== "user" && value.role !== "thinking" && value.role !== "assistant") return null;
  if (typeof value.text !== "string") return null;
  return { beat, seq, role: value.role, text: value.text };
}

function parseBeat(value: unknown): HistoryBeat | null {
  if (!isRecord(value) || typeof value.turn !== "number" || !Array.isArray(value.entries)) return null;
  const entries: HistoryEntry[] = [];
  for (const item of value.entries) {
    const entry = parseEntry(item);
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return null;
  entries.sort((a, b) => a.seq - b.seq);
  return { turn: value.turn, entries };
}
