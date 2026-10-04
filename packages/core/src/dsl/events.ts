import type { ActorAttrs, CgAttrs, SceneAttrs, SayAttrs, SfxAttrs } from "./spec.js";
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
 * `preload_asset` 与 `stop` 由工具产出而非文本解析（`260930-agent-kit` 计划 §2），
 * 但仍走同一条 IR 管道：加 seq → 广播 → 落谱系。
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
  | ({ kind: "sfx" } & SfxAttrs)
  | ({ kind: "preload_asset" } & PreloadAssetAttrs)
  | ({ kind: "cg" } & CgAttrs)
  | { kind: "stop"; stopType: StopType; options?: StopOption[]; placeholder?: string };

/** 线上格式：编排器为事件标序后经 WS 下发，重连凭 seq 重放。 */
export interface SequencedEvent {
  seq: number;
  event: StageEvent;
}
