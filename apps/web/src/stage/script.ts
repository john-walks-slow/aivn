import type { StageEvent } from "@stage-ai/core";

/** 前端剧本行模型：StageEvent 流 → 渲染行。 */
export interface ScriptLine {
  key: string;
  type: "say" | "narrate" | "thought" | "scene" | "sfx" | "cg";
  actorId?: string;
  mood?: string;
  text: string;
}

let lineSeq = 0;

export class ScriptBuilder {
  readonly lines: ScriptLine[] = [];
  private openKey: string | null = null;
  scene = "";

  apply(event: StageEvent): void {
    switch (event.kind) {
      case "scene": {
        this.openKey = null;
        this.scene = event.bg ?? this.scene;
        this.lines.push({
          key: `l${(lineSeq += 1)}`,
          type: "scene",
          text: [event.bg, event.bgm].filter(Boolean).join(" · "),
        });
        return;
      }
      case "sfx":
      case "cg":
        return; // P1 不渲染（P2 演出层）
      case "actor":
      case "preload_asset":
        return;
      case "say_start": {
        const line: ScriptLine = {
          key: `l${(lineSeq += 1)}`,
          type: "say",
          actorId: event.id,
          mood: event.mood,
          text: "",
        };
        this.lines.push(line);
        this.openKey = line.key;
        return;
      }
      case "narrate_start": {
        const line: ScriptLine = { key: `l${(lineSeq += 1)}`, type: "narrate", text: "" };
        this.lines.push(line);
        this.openKey = line.key;
        return;
      }
      case "thought_start": {
        const line: ScriptLine = {
          key: `l${(lineSeq += 1)}`,
          type: "thought",
          actorId: event.id,
          text: "",
        };
        this.lines.push(line);
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
