/**
 * 剧目自查：这座剧目**读不读得出来**、还缺什么（agent 面那份）。
 *
 * **没有硬门槛**：缺什么都能开演。这份报告是给搭台助手与剧作家自己看的底数，不是闸门。
 * `play.json` 在但读不出来时**不抛**，把那句原因报出来（`problem`）：剧目文件是模型自己写的，
 * 「哪一行写坏了」必须回到它手上，而不是变成一个把整轮打断的异常。
 *
 * 读盘是同步的：系统提示词的段 provider 同步求值，工具与注入必须共用同一份判据——
 * 异步版只能给工具用，两版就会漂。
 *
 * 与「剧目卡/工坊面板」那份底数（`premise/sprites/background/saves`）不是一回事：
 * 那一份要周目数、前提还要认躺在 play.json 里的旧剧目，**判据里那几条共用**（立绘与背景），
 * 报告文本各写各的——读者不同（一个是 agent 自查，一个是面板与用户）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePlayConfig } from "@aivn/core";
import { CRAFT_ENUMS } from "../craft/params.js";
import { assetMetaKey, type AssetManifest } from "../media/catalog.js";
import { listPlayAssets } from "../media/asset-index.js";

const IMAGE = /\.(png|jpe?g|webp)$/i;
/** 剧本配置文件名（与 core 的 `PLAY_FILE` 一致，这里不引 core 的解析器）。 */
const PLAY_FILE = "play.json";

export interface PlayReadiness {
  /** `play.json` 在且能解析——不在或读不出来都不是一座能演的剧目。 */
  play: boolean;
  /** 在但读不出来时的原因（引擎报的那句话）；读得出来或压根不在时为 undefined。 */
  problem?: string;
  /** `craft` 段里引擎不认的取值（会被静默当没写）；空数组 = 都认。 */
  strayCraft: string[];
  /** 世界状态文件的问题；没问题时为 undefined。 */
  stateProblem?: string;
  /** `memory/always/premise.md` 有内容（世界观前提的唯一真相源）。 */
  premise: boolean;
  /** `characters/*.md` 的张数。 */
  characters: number;
  /** ≥1 个立绘目录（`assets/sprites/<主体id>/`）里有图。 */
  sprites: boolean;
  /** ≥1 背景图。 */
  background: boolean;
  /** 素材清单条目数（背景/插图/立绘/音乐/音效全算）。 */
  assets: number;
  /**
   * 出图台账（`assets/generated.json`）里**登记指向不存在的文件**的条目 id。
   * 这种状态说明素材被挪走/删掉、或台账被手改坏了；空数组 = 都对得上。
   */
  danglingAssets: string[];
  /**
   * **漏标**的素材：`assets/` 里有图、素材表里却没有一句话画面描述的（背景 / 插图 / 立绘 / BGM）。
   *
   * 描述是剧作家挑素材的唯一依据，而生成工具只负责产图、标注是显式的一步
   * （`annotate_asset`）——所以这条是**漏标的兜底**：不报的话，一张没描述的图在剧本里等于不存在。
   */
  undescribed: string[];
}

/** 读盘判据：一座剧目现在是什么样（同步，见文件头）。 */
export function readPlayReadiness(dir: string, playFile = PLAY_FILE): PlayReadiness {
  let play = false;
  let problem: string | undefined;
  try {
    play = parsePlay(dir, playFile) !== null;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
  const index = listPlayAssets(dir);
  const stateProblem = readStateProblem(dir);

  return {
    play,
    ...(problem === undefined ? {} : { problem }),
    strayCraft: strayCraftValues(dir, playFile),
    ...(stateProblem === undefined ? {} : { stateProblem }),
    premise: readText(join(dir, "memory", "always", "premise.md")).trim() !== "",
    characters: countCharacters(dir),
    sprites: hasAnySprite(join(dir, "assets", "sprites")),
    background: hasAnyImage(join(dir, "assets", "backgrounds")),
    assets: Object.values(index).reduce((total, files) => total + files.length, 0),
    danglingAssets: danglingAssets(dir),
    undescribed: undescribedAssets(dir),
  };
}

/** 开演条件渲染（工具回执与注入段共用一份，同一句话不许有两个版本）。 */
export function renderReadiness(r: PlayReadiness): string {
  return [
    "开演条件：没有硬门槛，缺什么都能开演。",
    `- 剧目：${r.play ? "✓" : r.problem ? `✗ 读不出来——${r.problem}` : "缺（play.json）——会话工作目录里没有它，这还不是一座剧目"}`,
    `- 故事前提：${r.premise ? "✓" : "缺（memory/always/premise.md）——不写也行，剧作家会自由发挥"}`,
    `- 角色卡：${r.characters > 0 ? `${r.characters} 张` : "缺（characters/<id>.md）"}——没有卡的角色只能用 <say name> 出声`,
    `- 立绘：${r.sprites ? "✓" : "缺（assets/sprites/<主体id>/）——没有立绘的主体不上台，改用旁白交代"}`,
    `- 背景图：${r.background ? "✓" : "缺（assets/backgrounds/）——没有背景就落氛围底色，照样能演"}`,
    `- 素材清单：${r.assets > 0 ? `${r.assets} 个文件` : "空"}——素材要放进 assets/`,
    r.strayCraft.length > 0 ? `- 写作参数：这些取值引擎不认、会被当没写——${r.strayCraft.join("；")}` : null,
    r.stateProblem ? `- 世界状态：${r.stateProblem}` : null,
    r.danglingAssets.length > 0
      ? `- 素材对账：台账里有登记但文件不在——${r.danglingAssets.join("、")}（重新登记那张图，或删掉台账那几条）`
      : null,
    r.undescribed.length > 0
      ? `- 素材描述：这些还没有一句话画面描述——${r.undescribed.join("、")}（剧作家挑素材靠它，用 annotate_asset 补上）`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * `play.json` 能解析就给配置对象，不在就给 null；坏掉就抛（由调用方转成 `problem`）。
 *
 * 这句 `读不出来：<原因>` 是刻意的：剧目文件是模型自己写的，「哪一行写坏了」要回到它手上。
 */
function parsePlay(dir: string, playFile: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(join(dir, playFile), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return parsePlayConfig(JSON.parse(raw) as unknown);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`${join(dir, playFile)} 读不出来：${why}`);
  }
}

/** 立绘目录里有没有图：每个主体一个目录，任一目录里有一张就算齐备。 */
function hasAnySprite(root: string): boolean {
  if (!existsSync(root)) return false;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (hasAnyImage(join(root, entry.name))) return true;
  }
  return false;
}

function hasAnyImage(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((name) => IMAGE.test(name));
}

/** 角色卡张数：`characters/*.md`。角色目录不在就不是错误，是「还没有角色」。 */
function countCharacters(dir: string): number {
  const root = join(dir, "characters");
  if (!existsSync(root)) return 0;
  return readdirSync(root).filter((name) => name.endsWith(".md")).length;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/**
 * `craft` 段里引擎不认的取值。
 *
 * 白名单外的值会被 `parsePlayConfig` **静默当没写**——以前这条路由 `set_craft` 的参数枚举挡着，
 * 现在参数是模型用 edit 写进去的，只能在这里报出来。
 */
function strayCraftValues(dir: string, playFile: string): string[] {
  const raw = readText(join(dir, playFile));
  if (!raw) return [];
  let craft: unknown;
  try {
    craft = (JSON.parse(raw) as { craft?: unknown }).craft;
  } catch {
    return []; // 文件坏掉由 `problem` 那一行说，这里不重复报
  }
  if (typeof craft !== "object" || craft === null) return [];

  const root = craft as Record<string, unknown>;
  const assets = (typeof root.assets === "object" && root.assets !== null ? root.assets : {}) as Record<string, unknown>;
  const slots: Array<[string, unknown, readonly string[]]> = [
    ["beatLength", root.beatLength, CRAFT_ENUMS.beatLength],
    ["stopOptions", root.stopOptions, CRAFT_ENUMS.stopOptions],
    ["assets.background", assets.background, CRAFT_ENUMS.background],
    ["assets.cg", assets.cg, CRAFT_ENUMS.cg],
    ["assets.sprite", assets.sprite, CRAFT_ENUMS.sprite],
    ["assets.audio", assets.audio, CRAFT_ENUMS.audio],
  ];
  return slots
    .filter(([, value, allowed]) => value !== undefined && value !== null && !allowed.includes(String(value)))
    .map(([path, value, allowed]) => `craft.${path} = ${JSON.stringify(value)}（只认 ${allowed.join(" / ")}）`);
}

/**
 * 素材表里的描述：值是元数据对象时看 `description`，旧格式直接写一句说明的字符串也算。
 * 立绘的差分可以只靠**立绘级**（`<主体id>`）那条描述兜住——差分通常只覆盖取景。
 */
function undescribedAssets(dir: string): string[] {
  const raw = readText(join(dir, "assets", "manifest.json"));
  if (raw.trim() === "") return [];
  let manifest: AssetManifest;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    manifest = parsed as AssetManifest;
  } catch {
    return []; // 素材表坏掉由别处说（登记时会重来），这里不重复报
  }
  const described = (key: string): boolean => {
    const meta = manifest[key];
    if (typeof meta === "string") return meta.trim() !== "";
    return typeof meta?.description === "string" && meta.description.trim() !== "";
  };

  const out: string[] = [];
  for (const [kind, files] of Object.entries(listPlayAssets(dir))) {
    // 音效表不在这份口径里：它没有描述这一格（也不是 annotate 认的 kind）。
    if (kind === "sfx") continue;
    const spriteId = kind.startsWith("sprites/") ? kind.slice("sprites/".length) : undefined;
    for (const file of files) {
      const stem = file.replace(/\.[^.]+$/, "");
      const key = assetMetaKey(stem, spriteId ? { spriteId, variant: stem } : undefined);
      if (described(key) || (spriteId && described(spriteId))) continue;
      out.push(key);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * 台账对账：`generated.json` 里每条登记都带一个剧目内 `path`，文件不在了就报出来。
 *
 * 只查「登记 → 文件」这一向（判据明确、不会误报）；反向的「文件在但没登记」有太多合法情形
 * （用户手工放进 `assets/` 还没登记、音效等非生图产物），不在这里报。
 */
function danglingAssets(dir: string): string[] {
  const raw = readText(join(dir, "assets", "generated.json"));
  if (raw.trim() === "") return [];
  let ledger: Record<string, { path?: unknown }>;
  try {
    ledger = JSON.parse(raw) as Record<string, { path?: unknown }>;
  } catch {
    return []; // 台账坏掉不在这里报，别和「文件不见」混为一谈
  }
  if (typeof ledger !== "object" || ledger === null) return [];
  return Object.entries(ledger)
    .filter(([, entry]) => {
      const path = entry?.path;
      return typeof path === "string" && path.trim() !== "" && !existsSync(join(dir, path));
    })
    .map(([id]) => id);
}

/**
 * 状态文件的问题：`state.json` 不是 JSON、或好感度不是 0~100 的整数。
 *
 * 状态文件由剧作家自己写，注入的【状态】区会照读、坏的那几行悄悄少掉——所以这里替它说出来。
 * 单次变化幅度（|Δ|≤5）没法从一份文件里看出来，那条只能靠提示词。
 */
export function readStateProblem(dir: string): string | undefined {
  const raw = readText(join(dir, "memory", "always", "state", "state.json"));
  if (raw.trim() === "") return undefined;
  let affinity: Record<string, unknown>;
  try {
    affinity = (JSON.parse(raw) as { affinity?: Record<string, unknown> }).affinity ?? {};
  } catch (error) {
    return `state.json 不是合法 JSON（${error instanceof Error ? error.message : String(error)}）——【状态】区会少几行`;
  }
  const bad = Object.entries(affinity).filter(
    ([, value]) => !Number.isInteger(value) || (value as number) < 0 || (value as number) > 100,
  );
  if (bad.length === 0) return undefined;
  return `好感度只认 0~100 的整数，这几个不是：${bad.map(([id, value]) => `${id}=${JSON.stringify(value)}`).join("、")}`;
}
