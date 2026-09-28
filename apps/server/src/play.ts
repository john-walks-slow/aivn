import type { EngineStateSnapshot } from "@stage-ai/core";

/** 剧目配置（plays/<id>/play.json）。 */
export interface CharacterCard {
  id: string;
  name: string;
  persona: string;
  /** 音色描述（P3 语音管线用）。 */
  voice?: string;
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
  if (!data.id || !data.title || !data.premise || !Array.isArray(data.characters)) {
    throw new Error("play.json 缺少必填字段（id/title/premise/characters）");
  }
  return {
    id: data.id,
    title: data.title,
    premise: data.premise,
    characters: data.characters,
    opening: data.opening ?? "（游戏开始，请演出第一幕的开幕）",
    initialState: data.initialState ?? { turn: 0, affinity: {}, flags: {} },
    initialScene: data.initialScene ?? "未定",
  };
}
