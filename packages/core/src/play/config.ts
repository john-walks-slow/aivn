import type { EngineStateSnapshot } from "../lineage/model.js";

/** 剧目配置（plays/<id>/play.json）——server 与 web 共享的跨端契约。 */
export interface CharacterCard {
  id: string;
  name: string;
  persona: string;
  /** 台词风格描述（playwriter 提示词用：口癖/句长/语速）。 */
  voice?: string;
  /** TTS 音色 id（fish-audio reference_id，P3 语音管线用；预置库见 VOICE_PRESETS）。 */
  voiceId?: string;
  /** 立绘差分映射：expression id → assets/sprites/<char>/ 文件名（P2 演出层用）。 */
  sprites?: Record<string, string>;
}

export interface PlayConfig {
  id: string;
  title: string;
  premise: string;
  characters: CharacterCard[];
  /** 开局 user 消息中的起始指令。 */
  opening: string;
  initialState: EngineStateSnapshot;
  initialScene: string;
}

export function parsePlayConfig(raw: unknown): PlayConfig {
  const data = raw as Partial<PlayConfig>;
  if (!data.id || !data.title || !Array.isArray(data.characters)) {
    throw new Error("play.json 缺少必填字段（id/title/characters）");
  }
  return {
    id: data.id,
    title: data.title,
    // premise 允许为空（新建脚手架）：由就绪门（D13）负责提示补全，不在此处校验
    premise: data.premise ?? "",
    characters: data.characters,
    opening: data.opening ?? "（游戏开始，请演出第一幕的开幕）",
    initialState: data.initialState ?? { turn: 0, affinity: {}, flags: {} },
    initialScene: data.initialScene ?? "未定",
  };
}
