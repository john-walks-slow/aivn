import type { EngineStateSnapshot } from "../lineage/model.js";
import { framingOf, isSpriteFraming, type SpriteFraming } from "./framing.js";

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
  /**
   * 人设正文。真相源是角色卡 `memory/always/characters/<id>.md` 的正文，
   * 这份是存量数据的兜底——工坊存过卡之后就不再写这里。
   */
  persona?: string;
  /** 台词风格描述（playwriter 提示词用：口癖/句长/语速）。真相源同样是角色卡。 */
  voice?: string;
  /**
   * TTS 音色 id（fish-audio reference_id，32 位 hex；从 Fish 公共音色库选取，目录见 /api/voices）。
   * 真相源是角色卡的 frontmatter `voiceId`——工坊改不写 play.json 的单个字段，
   * 这份是存量兜底（导入资源库建的角色一度只有它）。
   */
  voiceId?: string;
  /** 立绘差分映射：expression id → assets/sprites/<char>/ 文件名（P2 演出层用）。 */
  sprites?: Record<string, string>;
  /** 立绘取景（full/half/square）：出图画幅与舞台摆位都跟着它走，缺省 = 全身（见 play/framing.ts）。 */
  framing?: SpriteFraming;
  /**
   * 逐差分的取景覆盖：expression id → 取景。同一角色里混入不同画幅的差分时用
   * （如 shout = full、sigh = half）。bust 已废，写了会降级到 half。
   */
  spriteFraming?: Record<string, SpriteFraming>;
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
  /**
   * 追加到系统提示词末尾的自定义段（**只有工坊装它**）。
   *
   * 引擎自带的提示词不可编辑也不该可编辑——它写的是引擎契约与能力边界，改了必然漂。
   * 用户真正想逐剧目调的是「这个剧目的搭台助手该怎么做事」，落在这里。
   * 存原文，注入时原样拼在固定提示词之后。
   */
  prompt?: string;
  /**
   * 显式启用的工具名（工具目录见 `GET /api/agents/tools`）。缺省 = 该角色的默认集。
   *
   * 存的是**启用集**而不是禁用集：默认禁用的那几个（剧作家的生图与资源库）
   * 写成黑名单时，「用户打开了它」与「它本来就开着」在文件里长得一样，
   * 下次改默认值就会把用户的显式选择一起吞掉。
   */
  tools?: string[];
}

/**
 * 剧目封面：指向剧目自己的一张图（背景或插图）。
 *
 * 只有这两个目录——封面本来就是「剧目里已经有的那张画」，不该另存一份文件，
 * 换了图也不该有两份要同步。缺省时回落取第一张背景、没有则第一张插图。
 */
export interface PlayCover {
  kind: "backgrounds" | "cg";
  /** 素材文件名（不是 stem）；静态服务按原名取。 */
  id: string;
}

export interface PlayConfig {
  id: string;
  title: string;
  /**
   * 角色清单——**纯元数据，没有任何运行时逻辑读它**。
   *
   * 角色的真相源是 `memory/always/characters/<id>.md`（见 play/characterCard.ts）：
   * 名字、人设、音色、voiceId、立绘差分映射与取景全在那里。角色表就是那个目录的
   * 文件列表。这份留着是因为它读着像「主要角色表」，删了会让 play.json 的角色部分
   * 对用户完全隐形，而它本来也不影响任何东西。
   */
  characters?: CharacterCard[];
  /** 剧目卡与标题画面的封面图。缺省按「第一张背景 → 第一张插图」自动取。 */
  cover?: PlayCover;
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
  if (!data.id || !data.title) {
    throw new Error("play.json 缺少必填字段（id/title）");
  }
  const protagonist =
    data.protagonist && (data.protagonist.name.trim() !== "" || data.protagonist.persona.trim() !== "")
      ? { name: data.protagonist.name.trim(), persona: data.protagonist.persona.trim() }
      : undefined;
  // 封面：只认剧目自己已有的两张图，指错了就当没设（自动取第一张），不该让剧目打不开
  const coverRaw = (data as { cover?: unknown }).cover as
    | { kind?: unknown; id?: unknown }
    | undefined;
  const cover: PlayCover | undefined =
    coverRaw?.kind === "backgrounds" || coverRaw?.kind === "cg"
      ? typeof coverRaw.id === "string" && coverRaw.id.trim() !== ""
        ? { kind: coverRaw.kind, id: coverRaw.id.trim() }
        : undefined
      : undefined;
  const agents = parseAgentConfig(data.agents);
  return {
    id: data.id,
    title: data.title,
    characters: Array.isArray(data.characters) ? data.characters.map(parseCharacter) : undefined,
    ...(cover ? { cover } : {}),
    ...(protagonist ? { protagonist } : {}),
    ...(data.voiceLanguage?.trim() ? { voiceLanguage: data.voiceLanguage.trim() } : {}),
    opening: data.opening ?? "（游戏开始，请演出第一轮）",
    initialState: data.initialState ?? { turn: 0, affinity: {}, flags: {} },
    initialScene: data.initialScene ?? "未定",
    ...(agents ? { agents } : {}),
  };
}

/**
 * 角色卡归一化：取景逐字段校验后丢弃非法值，其余字段原样透传。
 *
 * 取景是**声明**出来的（见 play/framing.ts），手滑写个 "半身" 只能当没写：
 * 让它掉回缺省全身，远好过在舞台上按一个查不到的档位去找 CSS 类。
 *
 * 逐差分那圈也走 `framingOf` 而不是 `isSpriteFraming`，跟条目级对齐：已下线的
 * `bust` 在两条路径上都要降级成 `half`（见 framing.ts 的 LEGACY_SPRITE_FRAMING）。
 * 两边规则不一样的话，同一份存量数据在角色卡上被丢掉、在资源库上被降级，
 * 用户看到的现象是「从库里导入之后站位变了」，而两边的代码都「正确」。
 */
function parseCharacter(card: CharacterCard): CharacterCard {
  const framing = framingOf(card.framing);
  const overrides: Record<string, SpriteFraming> = {};
  for (const [expression, value] of Object.entries(card.spriteFraming ?? {})) {
    if (expression.trim() === "") continue;
    const framing = framingOf(value);
    if (framing) overrides[expression] = framing;
  }
  const out: CharacterCard = { ...card };
  if (framing) out.framing = framing;
  else delete out.framing;
  if (Object.keys(overrides).length > 0) out.spriteFraming = overrides;
  else delete out.spriteFraming;
  return out;
}

/**
 * agents 段归一化：整段是可选的，逐字段丢弃非法值而不是让整份 play.json 读不出来。
 * 一条手滑的 thinking 档位不该让整部剧目打不开——那比退回默认值糟得多。
 *
 * `prompt` 只给工坊留：剧作家那边读了也没人用，留着只会让手写 play.json 的人
 * 以为「这段生效了」。剧作家要怎么写走 `memory/always/craft.md`。
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
    if (role === "workshop" && typeof source.prompt === "string" && source.prompt.trim() !== "") {
      settings.prompt = source.prompt;
    }
    if (Array.isArray(source.tools)) {
      const names = source.tools.filter((n): n is string => typeof n === "string" && n.trim() !== "");
      // 空数组是「一个都不开」的显式选择，与「没写、走默认集」不同义，所以保留。
      settings.tools = [...new Set(names)];
    }
    if (Object.keys(settings).length > 0) out[role] = settings;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
