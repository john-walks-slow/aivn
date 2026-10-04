import { resolve } from "node:path";
import { parseImageSize, imageSizeText } from "./imageBackend.js";
import { DEFAULT_MAX_QUEUE } from "./limiter.js";

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
    format: "gemini" | "openai";
    baseUrl: string;
    apiKey: string;
    model: string;
    size: string;
    concurrency: number;
    timeoutMs: number;
    reference: "none" | "neutral";
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
      concurrency: 6,
      timeoutMs: 180_000,
      reference: "neutral",
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
      format: parseEnum("STAGE_IMAGE_FORMAT", env.STAGE_IMAGE_FORMAT, ["gemini", "openai"] as const, "openai"),
      baseUrl: env.STAGE_IMAGE_BASE_URL ?? "http://127.0.0.1:9999",
      apiKey: env.STAGE_IMAGE_API_KEY ?? "",
      model: env.STAGE_IMAGE_MODEL ?? "gpt-image-2",
      size: imageSizeText(parseImageSize(env.STAGE_IMAGE_SIZE ?? "1K")),
      concurrency: parsePositiveInt("STAGE_IMAGE_CONCURRENCY", env.STAGE_IMAGE_CONCURRENCY, 6),
      timeoutMs: parsePositiveInt("STAGE_IMAGE_TIMEOUT_MS", env.STAGE_IMAGE_TIMEOUT_MS, 180_000),
      reference: parseEnum("STAGE_IMAGE_REFERENCE", env.STAGE_IMAGE_REFERENCE, ["none", "neutral"] as const, "neutral"),
    },
    tts: {
      enabled: env.STAGE_TTS_ENABLED !== "false",
      keys: parseKeyList(env.STAGE_TTS_KEYS),
      proxy: env.STAGE_TTS_PROXY ?? "http://127.0.0.1:7890",
      baseUrl: env.STAGE_TTS_BASE_URL ?? "https://api.fish.audio",
      concurrency: parsePositiveInt("STAGE_TTS_CONCURRENCY", env.STAGE_TTS_CONCURRENCY, 2),
    },
    exa: {
      enabled: env.STAGE_EXA_ENABLED !== "false",
      keys: parseKeyList(env.STAGE_EXA_KEYS),
      baseUrl: env.STAGE_EXA_BASE_URL ?? "https://api.exa.ai",
      proxy: env.STAGE_EXA_PROXY ?? "http://127.0.0.1:7890",
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
  image?: Partial<ServerConfig["image"]>;
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
    tts: { ...base.tts },
    exa: { ...base.exa },
  };
  const put = <K extends keyof ServerConfig>(key: K, value: ServerConfig[K]): void => {
    if (base[key] === value) return;
    next[key] = value;
    changed.push(key);
  };
  const putIn = <K extends "image" | "tts" | "exa">(
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
      putIn("image", "format", parseEnum("生图接口格式", image.format, ["gemini", "openai"] as const, "gemini"));
    }
    if (image.baseUrl !== undefined) putIn("image", "baseUrl", image.baseUrl.trim().replace(/\/$/, ""));
    if (image.apiKey !== undefined) putIn("image", "apiKey", image.apiKey.trim());
    if (image.model !== undefined) putIn("image", "model", image.model.trim());
    if (image.size !== undefined) putIn("image", "size", imageSizeText(parseImageSize(image.size)));
    if (image.concurrency !== undefined) putIn("image", "concurrency", positiveInt("出图并发", image.concurrency));
    if (image.timeoutMs !== undefined) putIn("image", "timeoutMs", positiveInt("出图超时", image.timeoutMs));
    if (image.reference !== undefined) {
      putIn("image", "reference", parseEnum("垫图策略", image.reference, ["none", "neutral"] as const, "neutral"));
    }
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
 * 一次预发射真正可能花多久（毫秒）：客户端拿它当「通知永远不来」的兜底上界，
 * 随 hello 下发（见 `ws/protocol.ts` 的 assetsTtlMs）。写死 45s 时的后果是
 * 正在生成的骨架被自己撤掉——生图默认 150s 才超时，骨架从来活不到图到货。
 *
 * 最坏情况 = 自己一次超时 + 排在并发闸门队尾的时间（队列上限 12，按并发折成几批）。
 * 这只是兜底上界：正常的图一两分钟就到，届时 asset_ready 已经把占位摘了。
 */
export function imagePendingTtlMs(image: ServerConfig["image"]): number {
  const batches = Math.ceil(DEFAULT_MAX_QUEUE / Math.max(1, image.concurrency));
  return image.timeoutMs * (1 + batches);
}
