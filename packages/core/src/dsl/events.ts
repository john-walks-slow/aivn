import type { ActorAttrs, CgAttrs, EndingAttrs, SceneAttrs, SayAttrs, SfxAttrs, TitleAlign, TitleMode } from "./spec.js";
import type { FxAttrs } from "./effects.js";
import type { StopOption, StopType } from "../ws/protocol.js";

/**
 * 生图预发射（`generate_image` 工具的投影）：不再是 DSL 标签，但仍是**时间线上的一帧**——
 * 客户端在该位置摆骨架占位，图到货后 crossfade 替换（web `script.ts` 的 preload cue）。
 */
export interface PreloadAssetAttrs {
  type: "bg" | "cg" | "sprite";
  prompt: string;
  /**
   * 资产 id。
   * - bg/cg：直接是素材 id。
   * - sprite：`<spriteId>` 或 `<spriteId>:<variant>`；省略 variant 时默认 `neutral`。
   */
  id: string;
}

/**
 * StageEvent —— 舞台 IR 事件（编排器加 seq 后即为发往客户端的事件流）。
 * say/narrate/thought 拆为 start/text(delta)/end 三段，支撑流式打字机与语音句级预取。
 *
 * `stop` 由剧本里的 `<stop …/>` 标签产出（2026-10-06；AIVN 本体仍走 `beat_done` 工具参数），
 * `preload_asset` 由 `generate_image` 工具产出——两者产出的 IR 完全同构，都走同一条管道：
 * 加 seq → 广播 → 落谱系。
 *
 * `player_input` 由编排器在**接受**玩家动作（选项/自由输入/排队的引导兑现）那一刻产出：
 * 它是「玩家说了什么」在时间线上的一帧，客户端的回执、回看与回顾都靠它，
 * 不再各自从谱系轮询或本地乐观状态里补。
 */
export type StageEvent =
  | ({ kind: "scene" } & SceneAttrs)
  | ({ kind: "actor" } & ActorAttrs)
  | ({ kind: "say_start"; nodeId?: string } & SayAttrs)
  | { kind: "say_text"; delta: string }
  | { kind: "say_end" }
  | { kind: "narrate_start"; nodeId?: string }
  | { kind: "narrate_text"; delta: string }
  | { kind: "narrate_end" }
  | ({ kind: "thought_start"; id: string; nodeId?: string })
  | { kind: "thought_text"; delta: string }
  | { kind: "thought_end" }
  | { kind: "title_start"; align: TitleAlign; mode: TitleMode; nodeId?: string }
  | { kind: "title_text"; delta: string }
  | { kind: "title_end" }
  | ({ kind: "fx" } & FxAttrs)
  | ({ kind: "sfx" } & SfxAttrs)
  | ({ kind: "preload_asset" } & PreloadAssetAttrs)
  | ({ kind: "cg" } & CgAttrs)
  | { kind: "stop"; stopType: StopType; options?: StopOption[]; placeholder?: string }
  /**
   * 结局：整部故事 / 这一条路线的终点（`<ending …/>`，剧本末行）。**不产生任何画面**——
   * 引擎据此落账、拒绝继续、收掉「点舞台继续」；终幕画面由剧作家自己用 `<scene>` / `<title>`
   * 搭。属性全部只用于归档，见 `EndingAttrs`。
   */
  | ({ kind: "ending" } & EndingAttrs)
  | { kind: "player_input"; text: string };

/** 线上格式：编排器为事件标序后经 WS 下发，重连凭 seq 重放。 */
export interface SequencedEvent {
  seq: number;
  event: StageEvent;
}
