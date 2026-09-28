import type { ActorAttrs, CgAttrs, OptionAttrs, PreloadAssetAttrs, SceneAttrs, SfxAttrs, StopType } from "./spec.js";

/**
 * StageEvent —— 解析器产出的语义事件（编排器加 seq 后即为发往客户端的 IR 事件）。
 * say/narrate/thought 拆为 start/text(delta)/end 三段，支撑流式打字机与语音句级预取。
 */
export type StageEvent =
  | ({ kind: "scene" } & SceneAttrs)
  | ({ kind: "actor" } & ActorAttrs)
  | ({ kind: "say_start"; id: string; mood?: string })
  | { kind: "say_text"; delta: string }
  | { kind: "say_end" }
  | { kind: "narrate_start" }
  | { kind: "narrate_text"; delta: string }
  | { kind: "narrate_end" }
  | ({ kind: "thought_start"; id: string })
  | { kind: "thought_text"; delta: string }
  | { kind: "thought_end" }
  | ({ kind: "sfx" } & SfxAttrs)
  | ({ kind: "preload_asset" } & PreloadAssetAttrs)
  | ({ kind: "cg" } & CgAttrs)
  | ({ kind: "stop"; stopType: StopType; options?: OptionAttrs[]; placeholder?: string });

/** 线上格式：编排器为事件标序后经 WS 下发，重连凭 seq 重放。 */
export interface SequencedEvent {
  seq: number;
  event: StageEvent;
}
