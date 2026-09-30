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

/** 思考档位（pi 的 thinkingLevel）。剧作家与工坊各自独立。 */
export const THINKING_LEVELS = ["off", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * 单个 agent 的运行设置（工坊「Agent」页签编辑，落在 play.json）。
 *
 * 缺字段即默认：模型回落到服务端配置的默认模型，思考档位 off，工具全开。
 * 这三项都是**逐剧目**的——按量计费时工坊跑便宜模型、剧作家跑强模型是常态，
 * 而某部剧目不想让 agent 自己花钱生图时只关这一个剧目的工具即可。
 */
export interface AgentSettings {
  /** 网关上的模型 id（如 gemini-3.5-flash-lite）。缺省 = STAGE_MODEL_ID。 */
  model?: string;
  thinking?: ThinkingLevel;
  /** 关掉的工具名（工具目录见 `GET /api/agents/tools`）。缺省/空 = 全开。 */
  disabledTools?: string[];
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
  /** 两个 agent 的运行设置（工坊「Agent」页签）。整个对象可缺省。 */
  agents?: AgentConfig;
}

/** 剧目内两个 agent 的设置：剧作家（演出）与工坊（搭台）。 */
export interface AgentConfig {
  playwriter?: AgentSettings;
  workshop?: AgentSettings;
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
  const agents = parseAgentConfig(data.agents);
  return {
    id: data.id,
    title: data.title,
    characters: data.characters,
    ...(protagonist ? { protagonist } : {}),
    ...(data.voiceLanguage?.trim() ? { voiceLanguage: data.voiceLanguage.trim() } : {}),
    opening: data.opening ?? "（游戏开始，请演出第一轮）",
    initialState: data.initialState ?? { turn: 0, affinity: {}, flags: {} },
    initialScene: data.initialScene ?? "未定",
    ...(agents ? { agents } : {}),
  };
}

/**
 * agents 段归一化：整段是可选的，逐字段丢弃非法值而不是让整份 play.json 读不出来。
 * 一条手滑的 thinking 档位不该让整部剧目打不开——那比退回默认值糟得多。
 */
function parseAgentConfig(raw: AgentConfig | undefined): AgentConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: AgentConfig = {};
  for (const role of ["playwriter", "workshop"] as const) {
    const source = raw[role];
    if (!source || typeof source !== "object") continue;
    const settings: AgentSettings = {};
    if (typeof source.model === "string" && source.model.trim() !== "") settings.model = source.model.trim();
    if (source.thinking && (THINKING_LEVELS as readonly string[]).includes(source.thinking)) {
      settings.thinking = source.thinking;
    }
    if (Array.isArray(source.disabledTools)) {
      const names = source.disabledTools.filter((n): n is string => typeof n === "string" && n.trim() !== "");
      if (names.length > 0) settings.disabledTools = names;
    }
    if (Object.keys(settings).length > 0) out[role] = settings;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
