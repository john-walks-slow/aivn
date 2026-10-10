import { resolve } from "node:path";
import {
  IMAGE_FORMATS,
  IMAGE_KINDS,
  IMAGE_REFERENCES,
  imageSizeText,
  parseImageSize,
  type ImageFormat,
  type ImageKind,
  type ImageReference,
} from "./imageBackend.js";
import { DEFAULT_MAX_QUEUE } from "./limiter.js";

/**
 * 逐类目的生图覆盖：**只写与基础那份不同的字段**，缺省 / 空串 = 跟随基础。
 *
 * 场景是三类素材的现实诉求不一样：立绘要 flow2api 的裸别名模型与更高的档位，
 * 背景与 CG 可以走别家、更便宜的模型。回落发生在 {@link imageConfigFor} 一处。
 * **档位只是配置**：引擎不做任何「按类目自动抬档」——立绘那条 2K 下限 2026-10-10 去掉了。
 */
export interface ImageKindOverride {
  format?: ImageFormat;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  size?: string;
  reference?: ImageReference;
  timeoutMs?: number;
}

/**
 * 逐类目覆盖的**提交形态**（设置页送来的）：
 * 字段缺席 = 不改这一项；空串 / `null` = 清空这一项，回到跟随基础。
 */
export interface ImageKindPatch {
  format?: ImageFormat | "" | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  model?: string | null;
  size?: string | null;
  reference?: ImageReference | "" | null;
  /** 数字或数字串都收（输入框天然给字符串）；空 = 清空。 */
  timeoutMs?: number | string | null;
}

/** 生图配置块的提交形态：类目覆盖单独放宽（见 {@link ImageKindPatch}）。 */
export interface ImageSettingsPatch {
  enabled?: boolean;
  format?: ImageFormat;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  size?: string;
  concurrency?: number;
  timeoutMs?: number;
  reference?: ImageReference;
  kinds?: Partial<Record<ImageKind, ImageKindPatch>>;
}

/**
 * 启动期参数：进程起来时读一次，改了要重启。只有这三项留在环境变量里——
 * 端口与数据目录属于「装在哪、怎么起」，不属于用户在设置页里调的偏好。
 */
export interface BootstrapConfig {
  port: number;
  /**
   * 显式指定的监听地址（`--host` / `STAGE_HOST`）；没给就是 `undefined`。
   *
   * 三态：显式给了就听它，没给则交给设置页的 `lanAccess` 决定（见 `lanAccess.ts` 的 `resolveHost`）。
   */
  host: string | undefined;
  /** 数据根目录：`plays/`、`library/`、`media-cache/`、`settings.json` 都在它下面。 */
  dataRoot: string;
}

/**
 * 运行期设置（`ServerConfig`）：**唯一真相源是 `<dataRoot>/settings.json`**，
 * 由 `SettingsStore` 持有一份可变实例并对外只暴露 `get()`。
 *
 * 现场语义：持有者应通过 store 在**每次使用时**取当前值（见 `playhouse.ts` 的
 * `get config()`），不要在构造时把字段拷进局部变量——那正是「改完要重启」的来源。
 */
export interface ServerConfig {
  /** 公网入口的访问密码（HTTP Basic）。空 = 不设防。 */
  password: string;
  /**
   * 允许局域网访问：开着监听 `0.0.0.0`，关着只听 `127.0.0.1`。
   * 显式写了 `--host` / `STAGE_HOST` 时以那个为准（见 `lanAccess.ts` 的 `resolveHost`）。
   */
  lanAccess: boolean;
  /** 默认模型 id（经网关路由的完整 id）。 */
  modelId: string;
  /** pi-ai 内置基础模型（继承 api/cost/contextWindow 等元数据）。 */
  modelBase: string;
  /** 这台部署支持哪些模型；空 = 网关有什么给什么。 */
  models: string[];
  /** 限制级（NSFW）专用模型 id。空 = 回退到 modelId。 */
  nsfwModelId: string;
  /** 限制级（NSFW）专属系统提示词扩展。 */
  nsfwPrompt: string;
  /** OpenAI 兼容网关地址（`…/v1`）。 */
  baseUrl: string;
  apiKey: string;
  /** 单请求输出上限（max_tokens）。 */
  maxTokens: number;
  /** 模型上下文窗口真实值。 */
  contextWindow: number;
  compactRatio: number;
  keepRecentTokens: number;
  /** 工坊线程压缩的同一组参数（工坊模型可与剧作家不同）。 */
  workshopContext: {
    contextWindow: number;
    compactRatio: number;
    keepRecentTokens: number;
  };
  /** 单轮超时（毫秒）。 */
  beatTimeoutMs: number;
  image: {
    enabled: boolean;
    format: ImageFormat;
    baseUrl: string;
    apiKey: string;
    model: string;
    size: string;
    concurrency: number;
    timeoutMs: number;
    reference: ImageReference;
    /** 逐类目覆盖（背景 / CG / 立绘）：空对象 = 三类都用上面这份基础配置。 */
    kinds: Record<ImageKind, ImageKindOverride>;
  };
  /**
   * 音乐生成（BGM）。
   *
   * **地址与 key 留空时回落到生图那一份**：音乐与生图在本机走同一个网关
   * （flow2api 同时挂着图片与 `flow-music-*` 音频模型），填两遍是重复劳动。
   * 换网关（比如音乐单独走别家）时这两项才需要单独填。
   */
  music: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    /** 音频模型名（flow2api：`flow-music-lyria-3.5` / `flow-music-lyria-3-pro` / `musicfx`）。 */
    model: string;
    timeoutMs: number;
  };
  tts: {
    enabled: boolean;
    keys: string[];
    proxy: string;
    baseUrl: string;
    concurrency: number;
  };
  exa: {
    enabled: boolean;
    keys: string[];
    baseUrl: string;
    proxy: string;
    timeoutMs: number;
  };
}

/**
 * 出图并发上限的缺省值（`image.concurrency`）。
 *
 * 一处定义、三处引用：`freshSettings` 的缺省、`STAGE_IMAGE_CONCURRENCY` 的回落，
 * 以及 `generate_image` 描述里报给模型的「同时最多跑几张」——各写一个字面量必然漂。
 */
export const DEFAULT_IMAGE_CONCURRENCY = 6;

/**
 * 新装默认值：网关留空（第一次打开要自己在设置页填），
 * 生图/语音/联网**一律关着**——默认对着 `127.0.0.1:9999` 打请求只会让人以为坏了。
 */
export function freshSettings(): ServerConfig {
  return {
    password: "",
    lanAccess: false,
    modelId: "",
    modelBase: "deepseek/deepseek-flash",
    models: [],
    nsfwModelId: "",
    nsfwPrompt: "",
    baseUrl: "",
    apiKey: "",
    maxTokens: 32768,
    contextWindow: 262144,
    compactRatio: 0.6,
    keepRecentTokens: 20000,
    workshopContext: { contextWindow: 262144, compactRatio: 0.6, keepRecentTokens: 20000 },
    beatTimeoutMs: 240_000,
    image: {
      enabled: false,
      format: "gemini",
      baseUrl: "",
      apiKey: "",
      model: "",
      size: "1K",
      concurrency: DEFAULT_IMAGE_CONCURRENCY,
      timeoutMs: 180_000,
      reference: "neutral",
      kinds: { background: {}, cg: {}, sprite: {} },
    },
    music: {
      enabled: false,
      // 留空 = 跟生图同一个网关（musicBaseUrl/musicApiKey 在读侧回落，见 musicConfigOf）
      baseUrl: "",
      apiKey: "",
      model: "flow-music-lyria-3.5",
      // 实测一首 ~175s 的曲子要走 84s，比出图慢一档，超时给得比出图宽
      timeoutMs: 300_000,
    },
    tts: { enabled: false, keys: [], proxy: "", baseUrl: "https://api.fish.audio", concurrency: 2 },
    exa: { enabled: false, keys: [], baseUrl: "https://api.exa.ai", proxy: "", timeoutMs: 20_000 },
  };
}

/**
 * 从环境变量解析出**旧版语义**的设置（`.env` 一次性迁移用）。
 *
 * 与 `freshSettings` 的差别只在默认值：这里是过去 `loadConfig` 的那套默认
 * （生图/语音/联网默认开、指向本机网关），迁移过来的部署行为逐字不变。
 */
export function settingsFromEnv(env: NodeJS.ProcessEnv): ServerConfig {
  const contextWindow = parsePositiveInt("STAGE_CONTEXT_WINDOW", env.STAGE_CONTEXT_WINDOW, 262144);
  const compactRatio = parseRatio("STAGE_COMPACT_RATIO", env.STAGE_COMPACT_RATIO, 0.6);
  const keepRecentTokens = parsePositiveInt(
    "STAGE_KEEP_RECENT_TOKENS",
    env.STAGE_KEEP_RECENT_TOKENS,
    20000,
  );
  return {
    ...freshSettings(),
    password: env.STAGE_PASSWORD ?? "",
    modelId: env.STAGE_MODEL_ID ?? "ms/deepseek-ai/DeepSeek-V4.1-Flash",
    modelBase: env.STAGE_MODEL_BASE ?? "deepseek/deepseek-flash",
    models: parseModelList(env.STAGE_MODELS),
    nsfwModelId: env.STAGE_NSFW_MODEL_ID?.trim() ?? "",
    nsfwPrompt: env.STAGE_NSFW_PROMPT?.trim() ?? "",
    baseUrl: env.STAGE_BASE_URL ?? "http://127.0.0.1:9999/v1",
    apiKey: env.STAGE_API_KEY ?? "sk-1234",
    maxTokens: parsePositiveInt("STAGE_MAX_TOKENS", env.STAGE_MAX_TOKENS, 32768),
    contextWindow,
    compactRatio,
    keepRecentTokens,
    workshopContext: {
      contextWindow: parsePositiveInt(
        "STAGE_WORKSHOP_CONTEXT_WINDOW",
        env.STAGE_WORKSHOP_CONTEXT_WINDOW,
        contextWindow,
      ),
      compactRatio: parseRatio("STAGE_WORKSHOP_COMPACT_RATIO", env.STAGE_WORKSHOP_COMPACT_RATIO, compactRatio),
      keepRecentTokens: parsePositiveInt(
        "STAGE_WORKSHOP_KEEP_RECENT_TOKENS",
        env.STAGE_WORKSHOP_KEEP_RECENT_TOKENS,
        keepRecentTokens,
      ),
    },
    beatTimeoutMs: parsePositiveInt("STAGE_BEAT_TIMEOUT_MS", env.STAGE_BEAT_TIMEOUT_MS, 240_000),
    image: {
      enabled: env.STAGE_IMAGE_ENABLED !== "false",
      format: parseEnum("STAGE_IMAGE_FORMAT", env.STAGE_IMAGE_FORMAT, IMAGE_FORMATS, "gemini"),
      baseUrl: env.STAGE_IMAGE_BASE_URL ?? "http://127.0.0.1:9999",
      apiKey: env.STAGE_IMAGE_API_KEY ?? "",
      model: env.STAGE_IMAGE_MODEL ?? "gemini-3.0-pro-image",
      size: imageSizeText(parseImageSize(env.STAGE_IMAGE_SIZE ?? "1K")),
      concurrency: parsePositiveInt("STAGE_IMAGE_CONCURRENCY", env.STAGE_IMAGE_CONCURRENCY, DEFAULT_IMAGE_CONCURRENCY),
      timeoutMs: parsePositiveInt("STAGE_IMAGE_TIMEOUT_MS", env.STAGE_IMAGE_TIMEOUT_MS, 180_000),
      reference: parseEnum("STAGE_IMAGE_REFERENCE", env.STAGE_IMAGE_REFERENCE, IMAGE_REFERENCES, "neutral"),
      // 旧 .env 面没有逐类目这一说：迁过来的部署一律走上面这份基础配置
      kinds: { background: {}, cg: {}, sprite: {} },
    },
    tts: {
      enabled: env.STAGE_TTS_ENABLED !== "false",
      keys: parseKeyList(env.STAGE_TTS_KEYS),
      proxy: env.STAGE_TTS_PROXY ?? "",
      baseUrl: env.STAGE_TTS_BASE_URL ?? "https://api.fish.audio",
      concurrency: parsePositiveInt("STAGE_TTS_CONCURRENCY", env.STAGE_TTS_CONCURRENCY, 2),
    },
    music: {
      enabled: env.STAGE_MUSIC_ENABLED !== "false",
      baseUrl: env.STAGE_MUSIC_BASE_URL ?? "",
      apiKey: env.STAGE_MUSIC_API_KEY ?? "",
      model: env.STAGE_MUSIC_MODEL ?? "flow-music-lyria-3.5",
      timeoutMs: parsePositiveInt("STAGE_MUSIC_TIMEOUT_MS", env.STAGE_MUSIC_TIMEOUT_MS, 300_000),
    },
    exa: {
      enabled: env.STAGE_EXA_ENABLED !== "false",
      keys: parseKeyList(env.STAGE_EXA_KEYS),
      baseUrl: env.STAGE_EXA_BASE_URL ?? "https://api.exa.ai",
      proxy: env.STAGE_EXA_PROXY ?? "",
      timeoutMs: parsePositiveInt("STAGE_EXA_TIMEOUT_MS", env.STAGE_EXA_TIMEOUT_MS, 20_000),
    },
  };
}

/**
 * 启动期参数：端口、监听地址、数据目录。
 *
 * 数据目录没在环境里给就从 `fallbackDataRoot` 取（开发时是仓库根，打包后是 exe 同级的 `data/`）。
 * `overrides` 是命令行给的，优先级最高：双击 exe 的人改不了环境变量，但可以带参数启动。
 */
export function loadBootstrap(
  env: NodeJS.ProcessEnv,
  fallbackDataRoot: string,
  overrides: { port?: number; host?: string; dataRoot?: string } = {},
): BootstrapConfig {
  return {
    port: overrides.port ?? parsePositiveInt("STAGE_PORT", env.STAGE_PORT, 8787),
    // 不给默认值：监听地址的三态由 resolveHost 收口，默认「只听本机」是设置项而不是启动参数
    host: overrides.host?.trim() || env.STAGE_HOST?.trim() || undefined,
    dataRoot: resolve(overrides.dataRoot?.trim() || env.STAGE_DATA_DIR?.trim() || fallbackDataRoot),
  };
}

/** 设置补丁：只带要改的字段（设置页提交的形态）。 */
export interface SettingsPatch {
  password?: string;
  lanAccess?: boolean;
  modelId?: string;
  modelBase?: string;
  models?: string[];
  nsfwModelId?: string;
  nsfwPrompt?: string;
  baseUrl?: string;
  apiKey?: string;
  maxTokens?: number;
  contextWindow?: number;
  compactRatio?: number;
  keepRecentTokens?: number;
  workshopContext?: Partial<ServerConfig["workshopContext"]>;
  beatTimeoutMs?: number;
  image?: ImageSettingsPatch;
  music?: Partial<ServerConfig["music"]>;
  tts?: Partial<ServerConfig["tts"]>;
  exa?: Partial<ServerConfig["exa"]>;
}

/**
 * 把补丁合并到当前设置上：逐字段校验，任何一个不合法就整体抛错（不写半份配置）。
 *
 * 返回值同时给出「哪些字段真的变了」——设置页据此提示，也避免无改动的保存触发重建。
 */
export function applyPatch(base: ServerConfig, patch: SettingsPatch): { next: ServerConfig; changed: string[] } {
  const changed: string[] = [];
  const next: ServerConfig = {
    ...base,
    workshopContext: { ...base.workshopContext },
    image: { ...base.image },
    music: { ...base.music },
    tts: { ...base.tts },
    exa: { ...base.exa },
  };
  const put = <K extends keyof ServerConfig>(key: K, value: ServerConfig[K]): void => {
    if (base[key] === value) return;
    next[key] = value;
    changed.push(key);
  };
  const putIn = <K extends "image" | "music" | "tts" | "exa">(
    block: K,
    key: keyof ServerConfig[K],
    value: ServerConfig[K][keyof ServerConfig[K]],
  ): void => {
    if (base[block][key] === value) return;
    (next[block] as Record<string, unknown>)[key as string] = value;
    changed.push(`${block}.${String(key)}`);
  };

  if (patch.password !== undefined) put("password", patch.password.trim());
  // 手写的 settings.json 里给了非布尔值时按关处理（默认值），与其它标志位同一套口径
  if (patch.lanAccess !== undefined) put("lanAccess", patch.lanAccess === true);
  if (patch.modelId !== undefined) put("modelId", patch.modelId.trim());
  if (patch.modelBase !== undefined) put("modelBase", assertModelBase(patch.modelBase));
  if (patch.models !== undefined) put("models", parseModelList(patch.models.join(",")));
  if (patch.nsfwModelId !== undefined) put("nsfwModelId", patch.nsfwModelId.trim());
  if (patch.nsfwPrompt !== undefined) put("nsfwPrompt", patch.nsfwPrompt.trim());
  if (patch.baseUrl !== undefined) put("baseUrl", patch.baseUrl.trim().replace(/\/$/, ""));
  if (patch.apiKey !== undefined) put("apiKey", patch.apiKey.trim());
  if (patch.maxTokens !== undefined) put("maxTokens", positiveInt("输出上限", patch.maxTokens));
  if (patch.contextWindow !== undefined) put("contextWindow", positiveInt("上下文窗口", patch.contextWindow));
  if (patch.compactRatio !== undefined) put("compactRatio", ratio("压缩阈值", patch.compactRatio));
  if (patch.keepRecentTokens !== undefined) {
    put("keepRecentTokens", positiveInt("保留上下文", patch.keepRecentTokens));
  }
  if (patch.beatTimeoutMs !== undefined) put("beatTimeoutMs", positiveInt("单轮超时", patch.beatTimeoutMs));

  const workshop = patch.workshopContext;
  if (workshop) {
    const merged = { ...next.workshopContext };
    if (workshop.contextWindow !== undefined) {
      merged.contextWindow = positiveInt("工坊上下文窗口", workshop.contextWindow);
    }
    if (workshop.compactRatio !== undefined) merged.compactRatio = ratio("工坊压缩阈值", workshop.compactRatio);
    if (workshop.keepRecentTokens !== undefined) {
      merged.keepRecentTokens = positiveInt("工坊保留上下文", workshop.keepRecentTokens);
    }
    if (JSON.stringify(merged) !== JSON.stringify(base.workshopContext)) {
      next.workshopContext = merged;
      changed.push("workshopContext");
    }
  }

  const image = patch.image;
  if (image) {
    if (image.enabled !== undefined) putIn("image", "enabled", image.enabled);
    if (image.format !== undefined) {
      putIn("image", "format", parseEnum("生图接口格式", image.format, IMAGE_FORMATS, "gemini"));
    }
    if (image.baseUrl !== undefined) putIn("image", "baseUrl", image.baseUrl.trim().replace(/\/$/, ""));
    if (image.apiKey !== undefined) putIn("image", "apiKey", image.apiKey.trim());
    if (image.model !== undefined) putIn("image", "model", image.model.trim());
    if (image.size !== undefined) putIn("image", "size", imageSizeText(parseImageSize(image.size)));
    if (image.concurrency !== undefined) putIn("image", "concurrency", positiveInt("出图并发", image.concurrency));
    if (image.timeoutMs !== undefined) putIn("image", "timeoutMs", positiveInt("出图超时", image.timeoutMs));
    if (image.reference !== undefined) {
      putIn("image", "reference", parseEnum("垫图策略", image.reference, IMAGE_REFERENCES, "neutral"));
    }
    if (image.kinds) {
      // 深拷一层再改：`next.image` 只是浅拷贝，直接改它的 kinds 会把 base 那份一起写掉
      const kinds = Object.fromEntries(
        IMAGE_KINDS.map((kind) => [kind, { ...base.image.kinds[kind] }]),
      ) as Record<ImageKind, ImageKindOverride>;
      for (const kind of IMAGE_KINDS) {
        const incoming = image.kinds[kind];
        if (!incoming) continue;
        const merged = mergeKindOverride(kinds[kind], incoming);
        if (JSON.stringify(merged) === JSON.stringify(base.image.kinds[kind])) continue;
        kinds[kind] = merged;
        changed.push(`image.kinds.${kind}`);
      }
      next.image.kinds = kinds;
    }
  }

  const music = patch.music;
  if (music) {
    if (music.enabled !== undefined) putIn("music", "enabled", music.enabled);
    if (music.baseUrl !== undefined) putIn("music", "baseUrl", music.baseUrl.trim().replace(/\/$/, ""));
    if (music.apiKey !== undefined) putIn("music", "apiKey", music.apiKey.trim());
    if (music.model !== undefined) putIn("music", "model", music.model.trim());
    if (music.timeoutMs !== undefined) putIn("music", "timeoutMs", positiveInt("音乐生成超时", music.timeoutMs));
  }

  const tts = patch.tts;
  if (tts) {
    if (tts.enabled !== undefined) putIn("tts", "enabled", tts.enabled);
    if (tts.keys !== undefined) putIn("tts", "keys", dedupe(tts.keys));
    if (tts.proxy !== undefined) putIn("tts", "proxy", tts.proxy.trim());
    if (tts.baseUrl !== undefined) putIn("tts", "baseUrl", tts.baseUrl.trim().replace(/\/$/, ""));
    if (tts.concurrency !== undefined) putIn("tts", "concurrency", positiveInt("语音并发", tts.concurrency));
  }

  const exa = patch.exa;
  if (exa) {
    if (exa.enabled !== undefined) putIn("exa", "enabled", exa.enabled);
    if (exa.keys !== undefined) putIn("exa", "keys", dedupe(exa.keys));
    if (exa.baseUrl !== undefined) putIn("exa", "baseUrl", exa.baseUrl.trim().replace(/\/$/, ""));
    if (exa.proxy !== undefined) putIn("exa", "proxy", exa.proxy.trim());
    if (exa.timeoutMs !== undefined) putIn("exa", "timeoutMs", positiveInt("检索超时", exa.timeoutMs));
  }

  // 保留预算 ≥ 触发阈值：每轮都判定超标却永远切不出可压段，纪元压缩会静默失效
  for (const [name, block] of [
    ["", next],
    ["工坊", next.workshopContext],
  ] as const) {
    if (block.keepRecentTokens >= block.contextWindow * block.compactRatio) {
      console.warn(
        `[aivn] ${name}保留上下文（${block.keepRecentTokens}）≥ 触发阈值（${Math.floor(
          block.contextWindow * block.compactRatio,
        )}），纪元压缩将无法切出可压段`,
      );
    }
  }
  return { next, changed };
}

/**
 * 合并一类目的覆盖补丁：缺席 = 不改，空串 / null = 清掉这一格（回到跟随基础）。
 *
 * 空串走「清掉」而不是「写一个空值」：设置页把一个输入框清空，想表达的就是「跟随基础」，
 * 与 `music.baseUrl` / `music.apiKey` 留空回落同一条口径。
 */
function mergeKindOverride(current: ImageKindOverride, patch: ImageKindPatch): ImageKindOverride {
  const next: ImageKindOverride = { ...current };

  if (patch.format !== undefined) {
    if (patch.format === "" || patch.format === null) delete next.format;
    else next.format = parseEnum("生图接口格式", patch.format, IMAGE_FORMATS, "gemini");
  }
  if (patch.reference !== undefined) {
    if (patch.reference === "" || patch.reference === null) delete next.reference;
    else next.reference = parseEnum("垫图策略", patch.reference, IMAGE_REFERENCES, "neutral");
  }
  if (patch.baseUrl !== undefined) {
    const url = patch.baseUrl?.trim().replace(/\/$/, "") ?? "";
    if (url === "") delete next.baseUrl;
    else next.baseUrl = url;
  }
  if (patch.apiKey !== undefined) {
    const key = patch.apiKey?.trim() ?? "";
    if (key === "") delete next.apiKey;
    else next.apiKey = key;
  }
  if (patch.model !== undefined) {
    const model = patch.model?.trim() ?? "";
    if (model === "") delete next.model;
    else next.model = model;
  }
  if (patch.size !== undefined) {
    const raw = patch.size?.trim() ?? "";
    if (raw === "") delete next.size;
    else next.size = imageSizeText(parseImageSize(raw));
  }
  if (patch.timeoutMs !== undefined) {
    const raw = patch.timeoutMs === null ? "" : String(patch.timeoutMs).trim();
    if (raw === "") delete next.timeoutMs;
    else next.timeoutMs = positiveInt("出图超时", Number(raw));
  }
  return next;
}

/** `provider/modelId` 形态校验：pi-ai 内置目录里查不到的具体名字由 provider 构造时点名。 */
function assertModelBase(raw: string): string {
  const value = raw.trim();
  if (!value.includes("/")) throw new Error(`基础模型须为 provider/modelId 形式：${raw}`);
  return value;
}

/** 正整数校验：NaN/0/小数会让下游静默失效，直接挡在写入前。 */
function positiveInt(label: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label}必须是正整数`);
  return value;
}

/** (0,1] 比例校验。 */
function ratio(label: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) throw new Error(`${label}必须是 0 到 1 之间的小数`);
  return value;
}

/** 正整数环境变量解析（N3）：非法值回退默认并告警——NaN/0 会让下游静默失效。 */
function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    if (raw !== undefined && raw !== "") {
      console.warn(`[aivn] ${name} 非法（${raw}），回退默认 ${fallback}`);
    }
    return fallback;
  }
  return n;
}

/** (0,1] 比例解析：越界阈值会让纪元压缩永不触发或每轮都触发。 */
function parseRatio(name: string, raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1) {
    if (raw !== undefined && raw !== "") {
      console.warn(`[aivn] ${name} 非法（${raw}），回退默认 ${fallback}`);
    }
    return fallback;
  }
  return n;
}

/** 枚举型环境变量解析：值非法直接抛错，不静默回退——生图参数写错只会静默降级出一张废图。 */
function parseEnum<T extends string>(name: string, raw: string | undefined, allowed: readonly T[], fallback: T): T {
  const value = (raw ?? fallback) as T;
  if (!allowed.includes(value)) {
    throw new Error(`${name}（${raw}）非法，可用：${allowed.join(" / ")}`);
  }
  return value;
}

/**
 * `STAGE_MODELS`：这台部署支持哪些模型 id（逗号或空白分隔）。
 *
 * 空 = 不限制（网关有什么给什么）。保序去重——下拉的顺序就是配置里写的顺序，
 * 「便宜→贵」这种配法用字母序排出来等于没排。
 */
export function parseModelList(raw: string | undefined): string[] {
  return dedupe((raw ?? "").split(/[,\s]+/));
}

/** 多 key 凭据：逗号或换行分隔，保序去重。 */
export function parseKeyList(raw: string | undefined): string[] {
  return dedupe((raw ?? "").split(/[,\s]+/));
}

function dedupe(parts: readonly string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const item = part.trim();
    if (item !== "" && !out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * 一类目实际生效的生图连接参数：逐字段取该类目的覆盖，空 / 缺省回落到基础那份。
 *
 * **回落只在这一处发生**——`imageFactory` 按它装配三个后端实例，界面与配置文件里
 * 始终是「类目自己那几项」，不在别处再写一遍 `?? base`。
 */
export function imageConfigFor(config: ServerConfig, kind: ImageKind): {
  format: ImageFormat;
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
  reference: ImageReference;
  timeoutMs: number;
} {
  const base = config.image;
  const over = base.kinds[kind];
  return {
    format: over.format ?? base.format,
    baseUrl: over.baseUrl?.trim() || base.baseUrl,
    apiKey: over.apiKey?.trim() || base.apiKey,
    model: over.model?.trim() || base.model,
    size: over.size?.trim() || base.size,
    reference: over.reference ?? base.reference,
    timeoutMs: over.timeoutMs ?? base.timeoutMs,
  };
}

/**
 * 一次预发射真正可能花多久（毫秒）：客户端拿它当「通知永远不来」的兜底上界，
 * 随 hello 下发（见 `ws/protocol.ts` 的 assetsTtlMs）。写死 45s 时的后果是
 * 正在生成的骨架被自己撤掉——生图默认 150s 才超时，骨架从来活不到图到货。
 *
 * 最坏情况 = 最慢那一类的一次超时 + 排在并发闸门队尾的时间（队列上限 30，按并发折成几批）。
 * 超时取基础与三个类目里的最大值：立绘那一档常被单独调宽（档位更高更慢），
 * 只看基础那份会让骨架在立绘还没回来时就被撤掉。
 * 这只是兜底上界：正常的图一两分钟就到，届时 asset_ready 已经把占位摘了。
 */
export function imagePendingTtlMs(image: ServerConfig["image"]): number {
  const batches = Math.ceil(DEFAULT_MAX_QUEUE / Math.max(1, image.concurrency));
  const slowest = Math.max(image.timeoutMs, ...IMAGE_KINDS.map((kind) => image.kinds[kind].timeoutMs ?? 0));
  return slowest * (1 + batches);
}

/**
 * 音乐后端的连接参数：**自己的地址/key 留空就回落到生图那一份**。
 *
 * 本机 flow2api 一个进程同时挂着图片与 `flow-music-*` 音频模型，两边填两遍地址与 key
 * 是纯粹的重复劳动；换网关（音乐单独走别家）时单独填这两项即可。
 * 回落只在这一处发生，界面与配置文件里始终是「音乐自己那两项」。
 */
export function musicConnectionOf(config: ServerConfig): { baseUrl: string; apiKey: string } {
  return {
    baseUrl: config.music.baseUrl.trim() || config.image.baseUrl,
    apiKey: config.music.apiKey.trim() || config.image.apiKey,
  };
}
