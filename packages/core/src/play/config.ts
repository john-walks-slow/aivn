import type { EngineStateSnapshot } from "../lineage/model.js";

/**
 * 剧目配置（plays/<id>/play.json）——server 与 web 共享的跨端契约。
 *
 * 这里只放引擎要读的结构。**世界观前提不在这里**：它在 `memory/always/premise.md`，
 * 是纯内容、与 craft.md 同层，且由用户和工坊反复改（放这里就得读改写 play.json，
 * 与那两处 config 写入方抢锁）。就绪门与 A 区注入都只认那个文件。
 */
export interface CharacterCard {
  id: string;
  name: string;
  persona: string;
  /** 台词风格描述（playwriter 提示词用：口癖/句长/语速）。 */
  voice?: string;
  /** TTS 音色 id（fish-audio reference_id，32 位 hex；从 Fish 公共音色库选取，目录见 /api/voices）。 */
  voiceId?: string;
  /** 立绘差分映射：expression id → assets/sprites/<char>/ 文件名（P2 演出层用）。 */
  sprites?: Record<string, string>;
}

/** 主角（玩家）角色卡：输入润色的口吻依据（工坊/素材配置页设置）。 */
export interface ProtagonistCard {
  name: string;
  persona: string;
}

export interface PlayConfig {
  id: string;
  title: string;
  characters: CharacterCard[];
  /** 主角（玩家）角色卡：无则输入润色走通用模式。 */
  protagonist?: ProtagonistCard;
  /** 语音语言（ISO 639-1，如 "ja"）：与剧本语言不同时 say 文本先译成该语言再送 TTS；缺省跟随剧本语言。 */
  voiceLanguage?: string;
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
  const protagonist =
    data.protagonist && (data.protagonist.name.trim() !== "" || data.protagonist.persona.trim() !== "")
      ? { name: data.protagonist.name.trim(), persona: data.protagonist.persona.trim() }
      : undefined;
  return {
    id: data.id,
    title: data.title,
    characters: data.characters,
    ...(protagonist ? { protagonist } : {}),
    ...(data.voiceLanguage?.trim() ? { voiceLanguage: data.voiceLanguage.trim() } : {}),
    opening: data.opening ?? "（游戏开始，请演出第一轮）",
    initialState: data.initialState ?? { turn: 0, affinity: {}, flags: {} },
    initialScene: data.initialScene ?? "未定",
  };
}
