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
  /**
   * 人设正文。真相源是角色卡 `characters/<id>.md` 的正文，
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
}

/**
 * 创作口径的**可调参数**（play.json 的 `craft` 段）。
 *
 * 与 `memory/always/craft.md` 的分工：craft.md 写「这个剧目是什么味儿」——文风、禁忌、
 * 称呼习惯，诸如此类只能拿自然语言描述的东西；这里写「每轮多长、给几个选项、素材从哪来」
 * 这三件**有确定取值**的事。前者是散文，后者是配置：模型的自由度在散文里，引擎的确定性
 * 在配置里，混在一份 md 里两头都做不好。
 *
 * 三个字段全部可选，缺省走 `DEFAULT_CRAFT`（引擎自带的口径，见下）。写盘时只写与默认
 * 不同的字段——`DEFAULT_CRAFT` 改了，没显式写过的剧目跟着一起改，这才是「默认」的意思。
 */
export interface CraftParams {
  beatLength?: CraftBeatLength;
  stopOptions?: CraftStopOptions;
  assets?: CraftAssetSources;
}

/** 每轮篇幅：一轮 = 两个停止点之间的一段戏。 */
export const CRAFT_BEAT_LENGTHS = ["short", "medium", "long"] as const;
export type CraftBeatLength = (typeof CRAFT_BEAT_LENGTHS)[number];

/** 停止点给几条选项。`free` = 固定停在自由输入框（不给选项面板）。 */
export const CRAFT_STOP_OPTIONS = ["two", "three", "four", "free"] as const;
export type CraftStopOptions = (typeof CRAFT_STOP_OPTIONS)[number];

/**
 * 素材来源逐类声明，不做全集枚举。
 *
 * 背景 / CG / 立绘 / 音频四类的现实选择并不一样：背景常常「库里有就用、没有才画」，
 * CG 几乎总是现画，立绘只能画（库里没有可用的差分），音频只能取库（引擎不生音频）。
 * 一套 `library-first` / `generate-all` 的全局口径表达不了「背景先用库、CG 直接画」。
 */
export const CRAFT_BACKGROUND_SOURCES = ["library-first", "library", "generate"] as const;
export const CRAFT_CG_SOURCES = ["library", "generate", "off"] as const;
export const CRAFT_SPRITE_SOURCES = ["generate", "off"] as const;
export const CRAFT_AUDIO_SOURCES = ["library", "off"] as const;
export type CraftBackgroundSource = (typeof CRAFT_BACKGROUND_SOURCES)[number];
export type CraftCgSource = (typeof CRAFT_CG_SOURCES)[number];
export type CraftSpriteSource = (typeof CRAFT_SPRITE_SOURCES)[number];
export type CraftAudioSource = (typeof CRAFT_AUDIO_SOURCES)[number];

export interface CraftAssetSources {
  /** 库里有就用库里的，没有才出图（缺省）。 */
  background?: CraftBackgroundSource;
  cg?: CraftCgSource;
  sprite?: CraftSpriteSource;
  audio?: CraftAudioSource;
}

/** 与默认值合成之后的创作口径：逐字段都有值，渲染与判分支只读它。 */
export interface EffectiveCraft {
  beatLength: CraftBeatLength;
  stopOptions: CraftStopOptions;
  assets: {
    background: CraftBackgroundSource;
    cg: CraftCgSource;
    sprite: CraftSpriteSource;
    audio: CraftAudioSource;
  };
}

/**
 * 引擎默认口径：不写 `craft` 的剧目按这一份走。
 *
 * 2026-10-03 定过一条「引擎不自带任何创作口径，一律由 craft.md 定义」，2026-10-04 推翻：
 * 用户开一部新剧时看不到也改不动任何东西（craft.md 是句自然语言，工坊写它、引擎不解释它），
 * 而「每轮多长」这种问题本来就该有个能一眼看见、能直接改的答案。craft.md 保留文风与禁忌。
 */
export const DEFAULT_CRAFT: EffectiveCraft = {
  beatLength: "medium",
  stopOptions: "three",
  assets: { background: "library-first", cg: "generate", sprite: "generate", audio: "library" },
};

/** 逐字段与默认值合成。`craft` 里被 parse 丢掉过的非法值到不了这里。 */
export function resolveCraft(craft?: CraftParams): EffectiveCraft {
  const assets = craft?.assets;
  return {
    beatLength: craft?.beatLength ?? DEFAULT_CRAFT.beatLength,
    stopOptions: craft?.stopOptions ?? DEFAULT_CRAFT.stopOptions,
    assets: {
      background: assets?.background ?? DEFAULT_CRAFT.assets.background,
      cg: assets?.cg ?? DEFAULT_CRAFT.assets.cg,
      sprite: assets?.sprite ?? DEFAULT_CRAFT.assets.sprite,
      audio: assets?.audio ?? DEFAULT_CRAFT.assets.audio,
    },
  };
}
/** 思考档位（pi 的 thinkingLevel）。剧作家与工坊各自独立。 */
export const THINKING_LEVELS = ["off", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * 单个 agent 的运行设置（工坊「Agent」页签编辑，落在 play.json）。
 *
 * 缺字段即默认：模型回落到服务端配置的默认模型，思考档位 off，能力走该角色的默认集。
 * 这三项都是**逐剧目**的——按量计费时工坊跑便宜模型、剧作家跑强模型是常态，
 * 而某部剧目不想让 agent 自己花钱生图时只关这一个剧目的「生图」能力即可。
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
   * 显式启用的能力 id（能力目录见 `GET /api/agents/capabilities`）。缺省 = 该角色的默认集。
   *
   * 存的是**启用集**而不是禁用集：默认关的那几个（剧作家的「管理角色」）写成黑名单时，
   * 「用户打开了它」与「它本来就开着」在文件里长得一样，下次改默认值就会把用户的显式选择
   * 一起吞掉。常开与基座（`stage`、`read`）不写在这里，写了也忽略。
   */
  capabilities?: string[];
  /** 限制级（NSFW）剧情通道专用模型 id（仅剧作家用）。缺省回退到 STAGE_NSFW_MODEL_ID 或 model。 */
  nsfwModel?: string;
  /** 限制级（NSFW）剧情通道专用思考档位（仅剧作家用）。缺省回退到 thinking。 */
  nsfwThinking?: ThinkingLevel;
  /** 限制级（NSFW）剧情通道专属系统提示词扩展。 */
  nsfwPrompt?: string;
  /**
   * 出图要不要先问过玩家（**只有工坊装它**，缺省 `ask`）。
   *
   * 问的是「这张图要不要花钱」：工坊一次对话可能连着出四五张，玩家离开一会儿回来发现
   * 账单上是自己没点过头的图，比多问一句烦人得多。改成 `auto` 就是「这个剧目的图我放心，
   * 别拦着」。剧作家那条线不走这里——它出的图进预发射缓存，玩家看不见也拦不住。
   */
  imageApproval?: ImageApproval;
}

/** 工坊出图审批：`ask` 每次出图前等玩家点头，`auto` 直接出。 */
export const IMAGE_APPROVALS = ["ask", "auto"] as const;
export type ImageApproval = (typeof IMAGE_APPROVALS)[number];

/**
 * 逐剧目的生图设置：覆盖服务端全局的出图模型与档位（`STAGE_IMAGE_MODEL` / `STAGE_IMAGE_SIZE`）。
 *
 * 全局配置是「这台机器默认怎么出图」，但一部剧的立绘要 2K 抠底、另一部的小剧场插图
 * 1K 就够，或者一部用 flow2api 的别名模型、另一部走官方——这些是剧目自己的事。
 * 留空即跟随全局；两个字段都只覆盖自己那一个，不整份替换。
 */
export interface PlayImageConfig {
  model?: string;
  /** `1K` / `2K` / `4K`，或字面像素 `1536x1024`（openai 格式）；合法性由生图层在用时判定。 */
  size?: string;
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
   * 角色的真相源是 `characters/<id>.md`（见 play/characterCard.ts）：
   * 名字、人设、音色、voiceId、立绘差分映射与取景全在那里。角色表就是那个目录的
   * 文件列表。这份留着是因为它读着像「主要角色表」，删了会让 play.json 的角色部分
   * 对用户完全隐形，而它本来也不影响任何东西。
   */
  characters?: CharacterCard[];
  /** 剧目卡与标题画面的封面图。缺省按「第一张背景 → 第一张插图」自动取。 */
  cover?: PlayCover;
  /** 语音语言（ISO 639-1，如 "ja"）：与剧本语言不同时 say 文本先译成该语言再送 TTS；缺省跟随剧本语言。 */
  voiceLanguage?: string;
  /**
   * 剧本语言（ISO 639-1，如 "zh" / "ja"）：正文、选项与旁白用什么语言写。
   *
   * 缺省跟随玩家输入——玩家用中文说话，剧本就用中文。显式写死是为了两类剧目：
   * 玩家用什么语言提问都要求日语原文演出的（训练/翻译类），以及正文语言与
   * `voiceLanguage` 不同（写中文剧本、配日语语音）的那一类。
   */
  scriptLanguage?: string;
  /**
   * 没有角色卡的角色用哪个音色（剧目级兜底）。
   *
   * 一次性路人走 `<say id="passerby" name="路人甲">`——不建卡就不在角色表里，
   * 而音色挂在角色卡的 voiceId 上，于是这类角色永远没声音。给剧目兜一个，
   * 路人就有声音了，而每个有名有姓的角色仍然各用各的音色。
   */
  defaultVoiceId?: string;
  /** 开局 user 消息中的起始指令。 */
  opening: string;
  initialState: EngineStateSnapshot;
  initialScene: string;
  /** 每轮篇幅、停止点选项数、素材来源。整个对象可缺省（缺省 = `DEFAULT_CRAFT`）。 */
  craft?: CraftParams;
  /** 逐剧目的生图模型与档位覆盖，缺省 = 服务端全局配置。 */
  image?: PlayImageConfig;
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
  const craft = parseCraft(data.craft);
  const image = parseImageConfig(data.image);
  return {
    id: data.id,
    title: data.title,
    characters: Array.isArray(data.characters) ? data.characters.map(parseCharacter) : undefined,
    ...(cover ? { cover } : {}),
    ...(data.voiceLanguage?.trim() ? { voiceLanguage: data.voiceLanguage.trim() } : {}),
    ...(data.scriptLanguage?.trim() ? { scriptLanguage: data.scriptLanguage.trim() } : {}),
    ...(typeof data.defaultVoiceId === "string" && /^[0-9a-f]{32}$/i.test(data.defaultVoiceId.trim())
      ? { defaultVoiceId: data.defaultVoiceId.trim() }
      : {}),
    opening: data.opening ?? "（游戏开始，请演出第一轮）",
    initialState: data.initialState ?? { turn: 0, affinity: {}, flags: {} },
    initialScene: data.initialScene ?? "未定",
    ...(craft ? { craft } : {}),
    ...(image ? { image } : {}),
    ...(agents ? { agents } : {}),
  };
}

/** 白名单取值：不在表里的当没写（手滑写 "mediumm" 只能退回默认，不该让剧目打不开）。 */
function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** craft 段归一化：逐字段丢非法值，整段没剩东西就当没写。 */
function parseCraft(raw: CraftParams | undefined): CraftParams | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: CraftParams = {};
  const beatLength = oneOf(CRAFT_BEAT_LENGTHS, raw.beatLength);
  if (beatLength) out.beatLength = beatLength;
  const stopOptions = oneOf(CRAFT_STOP_OPTIONS, raw.stopOptions);
  if (stopOptions) out.stopOptions = stopOptions;
  const assets = parseAssetSources(raw.assets);
  if (assets) out.assets = assets;
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseAssetSources(raw: CraftAssetSources | undefined): CraftAssetSources | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: CraftAssetSources = {};
  const background = oneOf(CRAFT_BACKGROUND_SOURCES, raw.background);
  if (background) out.background = background;
  const cg = oneOf(CRAFT_CG_SOURCES, raw.cg);
  if (cg) out.cg = cg;
  const sprite = oneOf(CRAFT_SPRITE_SOURCES, raw.sprite);
  if (sprite) out.sprite = sprite;
  const audio = oneOf(CRAFT_AUDIO_SOURCES, raw.audio);
  if (audio) out.audio = audio;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * image 段归一化：只做非空字符串这一层，档位的合法性留给生图层。
 *
 * `1K` 与 `1536x1024` 两种写法分属两个后端，词表在 server 的 `imageBackend.ts` 里；
 * 在这里复刻一份只会有两个真相源，不如让它在真正用的时候报错——那时错误消息带着
 * 是哪部剧目、哪个字段，比解析期一句「非法」更好定位。
 */
function parseImageConfig(raw: PlayImageConfig | undefined): PlayImageConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: PlayImageConfig = {};
  if (typeof raw.model === "string" && raw.model.trim() !== "") out.model = raw.model.trim();
  if (typeof raw.size === "string" && raw.size.trim() !== "") out.size = raw.size.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 角色卡归一化：卡片字段原样透传。
 *
 * 立绘的取景与体量归素材表管（`assets/sprites/<id>/` + manifest），卡上不再有
 * `framing` / `sprites` / `spriteFraming`——这里不做任何筛，多余字段由读者忽略。
 */
function parseCharacter(card: CharacterCard): CharacterCard {
  return { ...card };
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
    const imageApproval = oneOf(IMAGE_APPROVALS, source.imageApproval);
    if (role === "workshop" && imageApproval) settings.imageApproval = imageApproval;
    if (role === "playwriter") {
      if (typeof source.nsfwModel === "string" && source.nsfwModel.trim() !== "") {
        settings.nsfwModel = source.nsfwModel.trim();
      }
      if (source.nsfwThinking && (THINKING_LEVELS as readonly string[]).includes(source.nsfwThinking)) {
        settings.nsfwThinking = source.nsfwThinking;
      }
      if (typeof source.nsfwPrompt === "string" && source.nsfwPrompt.trim() !== "") {
        settings.nsfwPrompt = source.nsfwPrompt.trim();
      }
    }
    if (Array.isArray(source.capabilities)) {
      const ids = source.capabilities
        .filter((n): n is string => typeof n === "string")
        .map((n) => n.trim())
        .filter((n) => n !== "");
      // 空数组是「一个都不开」的显式选择，与「没写、走默认集」不同义，所以保留。
      // 认不认得出这些 id 是能力目录的事，这一层只做形状（去空白、去重）。
      settings.capabilities = [...new Set(ids)];
    }
    if (Object.keys(settings).length > 0) out[role] = settings;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
