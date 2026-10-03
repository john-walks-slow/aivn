import {
  CRAFT_BEAT_LENGTHS,
  CRAFT_BACKGROUND_SOURCES,
  CRAFT_CG_SOURCES,
  CRAFT_SPRITE_SOURCES,
  CRAFT_AUDIO_SOURCES,
  CRAFT_STOP_OPTIONS,
  DEFAULT_CRAFT,
  resolveCraft,
  type CraftAssetSources,
  type CraftAudioSource,
  type CraftBackgroundSource,
  type CraftBeatLength,
  type CraftCgSource,
  type CraftParams,
  type CraftSpriteSource,
  type CraftStopOptions,
  type EffectiveCraft,
} from "@stage-ai/core";
import type { AgentCapabilities } from "./agentkit/kit.js";

export { resolveCraft };

/** 这两项能力位决定素材来源怎么写——没有生图就不能说「自己出图」，没有库就不能说「用清单里的」。 */
type AssetCapabilities = Pick<AgentCapabilities, "image" | "library">;

/** 篇幅的措辞：给剧作家的是「写多长」，给用户/工坊的是「多长」这个值本身。 */
const BEAT_LENGTH_LABEL: Record<CraftBeatLength, string> = {
  short: "短",
  medium: "中等",
  long: "长",
};

const BEAT_LENGTH_DIRECTIVE: Record<CraftBeatLength, string> = {
  short: "一轮 3~6 句台词/旁白，一个来回或一次行动就收，别铺新场景。",
  medium: "一轮 8~15 句台词/旁白，演完一小段对话或一次行动就收。",
  long: "一轮 20~30 句台词/旁白，可以演完一整场戏，允许换场景。",
};

/**
 * 停止点的措辞。
 *
 * 「**有**停止点时给几条」而不是「每次给几条」：什么时候交还主导权归剧作家自己判断（那是创作口径），
 * 这一条只定「给了就是几条」。写成「每次给」会让它每轮都硬塞一组选项，narrative 再也收不了尾。
 */
const STOP_OPTIONS_DIRECTIVE: Record<CraftStopOptions, string> = {
  two: '有停止点时给 2 条互斥选项：beat_done(options=["…", "…"])。',
  three: '有停止点时给 3 条互斥选项：beat_done(options=["…", "…", "…"])。',
  four: '有停止点时给 4 条互斥选项：beat_done(options=["…", "…", "…", "…"])。',
  free: '固定停在自由输入框：beat_done(placeholder="…")，不给 options。',
};

const STOP_OPTIONS_LABEL: Record<CraftStopOptions, string> = {
  two: "每次 2 条",
  three: "每次 3 条",
  four: "每次 4 条",
  free: "固定自由输入",
};

const BACKGROUND_LABEL: Record<CraftBackgroundSource, string> = {
  "library-first": "资源库优先，没有再出图",
  library: "只用资源库里现成的",
  generate: "直接出图",
};

const CG_LABEL: Record<CraftCgSource, string> = {
  library: "只用资源库里现成的",
  generate: "直接出图",
  off: "不用插图",
};

const SPRITE_LABEL: Record<CraftSpriteSource, string> = {
  generate: "出图",
  off: "不出立绘",
};

const AUDIO_LABEL: Record<CraftAudioSource, string> = {
  library: "只用资源库里现成的",
  off: "不用音乐音效",
};

/**
 * 剧作家提示词里的「写作参数」段。
 *
 * **永远注入**（包括全默认值时）：缺省口径也得说出来，否则模型面对的是「没人告诉它一轮写多长」——
 * 而它每一轮都在做这个决定，做出来的东西和用户以为的默认值对不上时，用户改哪个开关都没用。
 *
 * 注入位置紧挨 `memory/always/craft.md` 之前：先给确定的三条参数（多长、几个选项、素材从哪来），
 * 再读那份散文口径（文风、禁忌、称呼），读完正好开写。
 */
export function renderCraftParams(craft: EffectiveCraft, can: AssetCapabilities): string {
  const { assets } = craft;
  const lines = [
    `- 一轮篇幅：${BEAT_LENGTH_LABEL[craft.beatLength]}——${BEAT_LENGTH_DIRECTIVE[craft.beatLength]}`,
    `- 停止点：${STOP_OPTIONS_DIRECTIVE[craft.stopOptions]}`,
    "- 素材来源：",
    `  - 背景：${backgroundDirective(assets.background, can)}`,
    `  - 插图（cg）：${cgDirective(assets.cg, can)}`,
    `  - 立绘：${spriteDirective(assets.sprite, can)}`,
    `  - 音乐与音效：${audioDirective(assets.audio, can)}`,
  ];
  return `\n# 写作参数（本剧目设定，照它写）\n\n${lines.join("\n")}\n`;
}

/**
 * 没有生图能力时，「出图」这条路说不了——换成它真能做到的那件事。
 *
 * 「素材清单」是 A 区里那份剧目自己的素材（含用户上传的），「素材资源库」是应用级的 `library/`：
 * 没配库时不能指向它，否则等于教模型去找一个不存在的东西。
 */
function noImage(kind: "background" | "cg" | "sprite", can: AssetCapabilities): string {
  // 立绘差分依附角色卡，库里没有「单张差分」这种东西——只能劝它别出新差分
  if (kind === "sprite") {
    return "本剧目没开生图：不要给角色出新立绘差分，角色表里已有的差分照常用；缺立绘就用旁白交代。";
  }
  const what = kind === "background" ? "背景" : "插图";
  const pool = can.library ? "素材资源库里现成的" : "素材清单里已有的";
  return `本剧目没开生图：需要新${what}时用${pool}，或换一段能演的戏、用旁白交代。`;
}

/**
 * 素材来源那四行的措辞。
 *
 * 「素材资源库」是那个应用级的 `library/`（引用即导入的源头），不是 A 区里那份剧目素材清单——
 * 两者都叫「库/清单」很容易写混，所以这里一律写全「素材资源库」。
 */
function backgroundDirective(source: CraftBackgroundSource, can: AssetCapabilities): string {
  if (!can.image) return noImage("background", can);
  switch (source) {
    case "library-first":
      return can.library
        ? "优先用素材资源库里现成的；库里没有合适的再 generate_image 出一张。"
        : "直接 generate_image 出（本剧目没配素材资源库）。";
    case "library":
      return can.library
        ? "只用素材资源库里现成的；缺了就换一处能演的场景，不要出图。"
        : "本剧目没配素材资源库：多用旁白交代场景，不要出图。";
    case "generate":
      return "自己 generate_image 出，不用去库里找。";
  }
}

function cgDirective(source: CraftCgSource, can: AssetCapabilities): string {
  if (source === "off") return "不要写 <cg>——本剧目不出插图，要停顿就写旁白或收束本轮。";
  if (!can.image) return noImage("cg", can);
  switch (source) {
    case "library":
      return can.library
        ? "优先用素材资源库里现成的插图；没有就改用旁白交代，不要出图。"
        : "本剧目没配素材资源库：不要写 <cg>，用旁白交代。";
    case "generate":
      return "自己 generate_image 出。";
    default:
      return "";
  }
}

function spriteDirective(source: CraftSpriteSource, can: AssetCapabilities): string {
  if (source === "off") return "不要给角色出立绘；角色表里已有的差分照常用。";
  if (!can.image) return noImage("sprite", can);
  return '自己 generate_image（kind="sprite"）出。';
}

function audioDirective(source: CraftAudioSource, can: AssetCapabilities): string {
  if (source === "off") return "不要写 bgm/ambient/sfx——本剧目不用音乐音效。";
  return can.library
    ? "只用素材资源库里现成的 bgm/sfx。"
    : "只用素材清单里已有的 bgm/sfx；没有合适的宁可不给。";
}

/**
 * 工坊侧看到的现状清单：一行一项，念给用户听或写进工坊提示词都用它。
 *
 * 与 `renderCraftParams` 的分工是读者不同——那份写给剧作家（该怎么写），这份写给工坊与用户
 * （现在是什么），所以不带祈使句、只报值。
 */
export function describeCraftParams(craft: EffectiveCraft): string {
  const { assets } = craft;
  return [
    `每轮篇幅：${BEAT_LENGTH_LABEL[craft.beatLength]}`,
    `停止点选项：${STOP_OPTIONS_LABEL[craft.stopOptions]}`,
    `素材来源：背景 ${BACKGROUND_LABEL[assets.background]}；插图 ${CG_LABEL[assets.cg]}；立绘 ${SPRITE_LABEL[assets.sprite]}；音效 ${AUDIO_LABEL[assets.audio]}`,
  ].join("\n");
}

/**
 * `set_craft` 的补丁：字段省略 = 保持现状，显式 `null` = 恢复默认。
 *
 * 三态是刻意的——「把篇幅设回中等」和「以后端默认值为准」是两件事：前者写进 play.json 变成
 * 一个固定值，后者让这个字段从文件里消失，日后引擎默认值改了它跟着改。
 */
export interface CraftPatch {
  beatLength?: CraftBeatLength | null;
  stopOptions?: CraftStopOptions | null;
  /** `null` = 素材来源四项一起恢复默认；对象里逐项 `null` = 只恢复那一项。 */
  assets?: {
    background?: CraftBackgroundSource | null;
    cg?: CraftCgSource | null;
    sprite?: CraftSpriteSource | null;
    audio?: CraftAudioSource | null;
  } | null;
}

/** 应用补丁，并只留下与默认值不同的字段——play.json 里「没写」就是「用默认」。 */
export function mergeCraftParams(current: CraftParams | undefined, patch: CraftPatch): CraftParams | undefined {
  const now = resolveCraft(current);
  const assetsPatch = patch.assets === null ? null : patch.assets;
  const pick = <T>(value: T | null | undefined, fallback: T, current: T): T =>
    value === undefined ? current : (value ?? fallback);
  const assets = {
    background: assetsPatch === null ? DEFAULT_CRAFT.assets.background : pick(assetsPatch?.background, DEFAULT_CRAFT.assets.background, now.assets.background),
    cg: assetsPatch === null ? DEFAULT_CRAFT.assets.cg : pick(assetsPatch?.cg, DEFAULT_CRAFT.assets.cg, now.assets.cg),
    sprite: assetsPatch === null ? DEFAULT_CRAFT.assets.sprite : pick(assetsPatch?.sprite, DEFAULT_CRAFT.assets.sprite, now.assets.sprite),
    audio: assetsPatch === null ? DEFAULT_CRAFT.assets.audio : pick(assetsPatch?.audio, DEFAULT_CRAFT.assets.audio, now.assets.audio),
  };
  const beatLength = pick(patch.beatLength, DEFAULT_CRAFT.beatLength, now.beatLength);
  const stopOptions = pick(patch.stopOptions, DEFAULT_CRAFT.stopOptions, now.stopOptions);

  const out: CraftParams = {};
  if (beatLength !== DEFAULT_CRAFT.beatLength) out.beatLength = beatLength;
  if (stopOptions !== DEFAULT_CRAFT.stopOptions) out.stopOptions = stopOptions;
  const assetOut: CraftAssetSources = {};
  if (assets.background !== DEFAULT_CRAFT.assets.background) assetOut.background = assets.background;
  if (assets.cg !== DEFAULT_CRAFT.assets.cg) assetOut.cg = assets.cg;
  if (assets.sprite !== DEFAULT_CRAFT.assets.sprite) assetOut.sprite = assets.sprite;
  if (assets.audio !== DEFAULT_CRAFT.assets.audio) assetOut.audio = assets.audio;
  if (Object.keys(assetOut).length > 0) out.assets = assetOut;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `set_craft` 的参数枚举取 core 的白名单，避免工具 schema 与解析器各写一份。 */
export const CRAFT_ENUMS = {
  beatLength: CRAFT_BEAT_LENGTHS,
  stopOptions: CRAFT_STOP_OPTIONS,
  background: CRAFT_BACKGROUND_SOURCES,
  cg: CRAFT_CG_SOURCES,
  sprite: CRAFT_SPRITE_SOURCES,
  audio: CRAFT_AUDIO_SOURCES,
} as const;
