import type { StageEvent } from "@stage-ai/core";

/** 前端剧本行模型：StageEvent 流 → 渲染行（log 视图与舞台台词共用）。 */
export interface ScriptLine {
  key: string;
  type: "say" | "narrate" | "thought" | "scene" | "sfx" | "cg";
  actorId?: string;
  mood?: string;
  text: string;
  /** say/narrate/thought 行起始事件的 seq（audio_ready 语音关联键）。 */
  seq?: number;
}

/** 舞台演出提示：视觉指令即时应用，行提示走打字机队列（本地节奏重整）。 */
export type Cue =
  | { key: string; kind: "scene"; bg?: string; bgm?: string; transition?: string }
  | { key: string; kind: "actor"; id: string; pos?: string; expression?: string; action?: string }
  | { key: string; kind: "sfx"; src: string; volume?: number }
  | { key: string; kind: "cg"; id: string; caption?: string }
  /** 生图预发射（D6）：只记「id 正在生成」，用于未就绪时的骨架占位。 */
  | { key: string; kind: "preload"; id: string; type: "bg" | "cg" | "sprite" }
  | { key: string; kind: "line"; lineKey: string };

let lineSeq = 0;

export class ScriptBuilder {
  readonly lines: ScriptLine[] = [];
  readonly cues: Cue[] = [];
  private openKey: string | null = null;
  scene = "";

  /** 清空（「开始游戏」fresh start 重建脚本）。 */
  reset(): void {
    this.lines.length = 0;
    this.cues.length = 0;
    this.openKey = null;
    this.scene = "";
  }

  apply(event: StageEvent, seq?: number): void {
    const key = (): string => `l${(lineSeq += 1)}`;
    switch (event.kind) {
      case "scene": {
        this.openKey = null;
        this.scene = event.bg ?? this.scene;
        this.lines.push({
          key: key(),
          type: "scene",
          seq,
          text: [event.bg, event.bgm].filter(Boolean).join(" · "),
        });
        this.cues.push({ key: key(), kind: "scene", bg: event.bg, bgm: event.bgm, transition: event.transition });
        return;
      }
      case "sfx":
        this.cues.push({ key: key(), kind: "sfx", src: event.src, volume: event.volume });
        return;
      case "cg":
        this.cues.push({ key: key(), kind: "cg", id: event.id, caption: event.caption });
        return;
      case "actor":
        this.cues.push({ key: key(), kind: "actor", id: event.id, pos: event.pos, expression: event.expression, action: event.action });
        return;
      case "preload_asset":
        this.cues.push({ key: key(), kind: "preload", id: event.id, type: event.type });
        return;
      case "say_start": {
        const line: ScriptLine = {
          key: key(),
          type: "say",
          actorId: event.id,
          mood: event.mood,
          seq,
          text: "",
        };
        this.lines.push(line);
        this.cues.push({ key: key(), kind: "line", lineKey: line.key });
        this.openKey = line.key;
        return;
      }
      case "narrate_start": {
        const line: ScriptLine = { key: key(), type: "narrate", seq, text: "" };
        this.lines.push(line);
        this.cues.push({ key: key(), kind: "line", lineKey: line.key });
        this.openKey = line.key;
        return;
      }
      case "thought_start": {
        const line: ScriptLine = {
          key: key(),
          type: "thought",
          actorId: event.id,
          seq,
          text: "",
        };
        this.lines.push(line);
        this.cues.push({ key: key(), kind: "line", lineKey: line.key });
        this.openKey = line.key;
        return;
      }
      case "say_text":
      case "narrate_text":
      case "thought_text": {
        const line = this.lines.at(-1);
        if (line && line.key === this.openKey) line.text += event.delta;
        return;
      }
      case "say_end":
      case "narrate_end":
      case "thought_end":
        this.openKey = null;
        return;
      case "stop":
        return; // 停止点由 StopPanel 渲染
    }
  }
}

/** 角色显示名：配置里没有就用内置别名（玩家的红线不出现在树上）。 */
export function actorName(names: Readonly<Record<string, string>>, id: string | null | undefined): string {
  if (!id) return "";
  return names[id] ?? (id === "player" ? "你" : id);
}
