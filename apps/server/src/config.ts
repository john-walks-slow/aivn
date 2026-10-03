import { resolve } from "node:path";
import { parseImageSize, imageSizeText } from "./imageBackend.js";
import { DEFAULT_MAX_QUEUE } from "./limiter.js";

/** 服务端配置：环境变量驱动（cpa 网关 + 模型 + 剧目库根目录 + fish-audio TTS）。 */
export interface ServerConfig {
  port: number;
  /**
   * 公网入口的访问密码（`STAGE_PASSWORD`，HTTP Basic）。空 = 不设防（本机直连的开发场景）；
   * 挂到公网隧道上就该设，否则任何人都能开剧目、改剧目、烧生图额度。
   */
  password: string;
  /** 剧目库根目录（多剧目，每子目录一剧目）。 */
  playsRoot: string;
  /** 应用级素材资源库根目录（每子目录一素材条目，用户在本地目录里增删改，服务端只读）。 */
  libraryRoot: string;
  modelId: string;
  modelBase: string; // pi-ai 内置基础模型（继承 api/cost/contextWindow 等元数据）
  /**
   * 这台部署支持哪些模型（`STAGE_MODELS`）：剧目「Agent」页的模型下拉只给这些。
   * 空 = 不限制，沿用「网关 `/v1/models` 有什么给什么」。顺序按配置里写的来。
   */
  models: string[];
  /** 限制级（NSFW）专用模型 id（`STAGE_NSFW_MODEL_ID`）。缺省为空，回退到 modelId。 */
  nsfwModelId?: string;
  /** 限制级（NSFW）专属系统提示词扩展（`STAGE_NSFW_PROMPT`）。 */
  nsfwPrompt?: string;
  baseUrl: string;
  apiKey: string;
  /** 单请求输出上限（max_tokens）：钳住捐赠元数据的虚高 maxTokens——streamSimple 不传时以 model.maxTokens 填充发出，超网关限制即 400。 */
  maxTokens: number;
  /** 纪元压缩（P4b）：模型上下文窗口真实值——捐赠元数据不可信，须由部署方按实际网关限制定。 */
  contextWindow: number;
  /** 纪元压缩触发阈值（占窗口比例）：对话体到预算即压缩成 arcs 摘要。 */
  compactRatio: number;
  /** 纪元压缩保留的最近上下文（token 估算）：切尾点之后的原文留在对话体。 */
  keepRecentTokens: number;
  /**
   * 工坊线程压缩的同一组参数，单独一套 env（`STAGE_WORKSHOP_*`），不设即沿用上面三项。
   * 工坊模型可以和剧作家不同（play.json 的 agents.workshop.model），窗口不等时压错阈值会误判。
   */
  workshopContext: {
    contextWindow: number;
    compactRatio: number;
    keepRecentTokens: number;
  };
  /** 单轮超时（毫秒）：网关挂住时 provider 既不报错也不收流，到点 abort 这一轮。 */
  beatTimeoutMs: number;
  /** 生图管线（D6）：出图后端 + 预发射 + 媒体缓存。 */
  image: {
    enabled: boolean;
    /**
     * 接口格式，不是产品名：
     * - `gemini` = `POST {base}/v1beta/models/{model}:generateContent`（图片在 inlineData，**支持垫图**）；
     * - `openai` = `POST {base}/v1/images/generations`（b64_json / url，**没有参考图入参**）。
     * 接的是官方 API、本机 flow2api 还是 cpa，由 baseUrl 决定。
     */
    format: "gemini" | "openai";
    /** 生图服务根地址（不要再带 `/v1` 或 `/v1beta`，版本段由格式自己拼）。 */
    baseUrl: string;
    apiKey: string;
    /** 出图模型名，按所选格式填（flow2api 那条路要把画幅档位写进别名，否则 imageConfig 被忽略）。 */
    model: string;
    /**
     * 出图档位或字面像素（`STAGE_IMAGE_SIZE`，构造期已归一化）：`1K` / `2K` / `4K`，或 `1536x1024`。
     * gemini 只认档位（原样交给 `imageConfig.imageSize`），openai 只认像素（档位由 `canvasFor` 换算）。
     */
    size: string;
    /** 并发出图上限（每图 15–140s，串行会把预发射窗口拖穿）。 */
    concurrency: number;
    /** 单图超时（毫秒）：超时按失败降级，占位骨架不留死。 */
    timeoutMs: number;
    /** 垫图策略：neutral = 派生立绘差分时用该角色的 neutral 定妆照垫图（默认）；none = 纯文生图。仅 gemini 格式有效。 */
    reference: "none" | "neutral";
  };
  /** 语音管线（D5）：fish-audio keys / 代理 / 并发。 */
  tts: {
    enabled: boolean;
    /** 多把 key 轮询（`STAGE_TTS_KEYS`，逗号分隔）。 */
    keys: string[];
    proxy: string;
    baseUrl: string;
    concurrency: number;
  };
  /** 工坊联网检索（Exa）：工坊 agent 唯一的联网口子，一次调用同时搜索并取回正文。 */
  exa: {
    enabled: boolean;
    /** 多把 key 轮询（`STAGE_EXA_KEYS`，逗号分隔）；Exa 的免费额度按 key 给。 */
    keys: string[];
    baseUrl: string;
    proxy: string;
    timeoutMs: number;
  };
}

/** 正整数环境变量解析（N3）：非法值回退默认并告警——NaN/0 会让下游静默失效。 */
function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    if (raw !== undefined && raw !== "") {
      console.warn(`[stage-ai] ${name} 非法（${raw}），回退默认 ${fallback}`);
    }
    return fallback;
  }
  return n;
}

/** (0,1] 比例解析：越界阈值会让纪元压缩永不触发或每轮都触发，非法值回退默认并告警。 */
function parseRatio(name: string, raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1) {
    if (raw !== undefined && raw !== "") {
      console.warn(`[stage-ai] ${name} 非法（${raw}），回退默认 ${fallback}`);
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
  const out: string[] = [];
  for (const part of (raw ?? "").split(/[,\s]+/)) {
    const id = part.trim();
    if (id !== "" && !out.includes(id)) out.push(id);
  }
  return out;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
): ServerConfig {
  // 纪元压缩的三个全局值先落局部：工坊那组要拿它们当缺省。
  // 256K：两个 agent 的默认窗口。低于它的部署要显式写小，否则触发阈值会高过网关真实上限。
  const contextWindow = parsePositiveInt("STAGE_CONTEXT_WINDOW", env.STAGE_CONTEXT_WINDOW, 262144);
  const compactRatio = parseRatio("STAGE_COMPACT_RATIO", env.STAGE_COMPACT_RATIO, 0.6);
  const keepRecentTokens = parsePositiveInt(
    "STAGE_KEEP_RECENT_TOKENS",
    env.STAGE_KEEP_RECENT_TOKENS,
    20000,
  );
  const config: ServerConfig = {
    port: Number(env.STAGE_PORT ?? "8787"),
    password: env.STAGE_PASSWORD ?? "",
    playsRoot: resolve(repoRoot, env.STAGE_PLAYS_ROOT ?? "plays"),
    libraryRoot: resolve(repoRoot, env.STAGE_LIBRARY_ROOT ?? "library"),
    modelId: env.STAGE_MODEL_ID ?? "ms/deepseek-ai/DeepSeek-V4.1-Flash",
    modelBase: env.STAGE_MODEL_BASE ?? "deepseek/deepseek-flash",
    models: parseModelList(env.STAGE_MODELS),
    nsfwModelId: env.STAGE_NSFW_MODEL_ID?.trim() || undefined,
    nsfwPrompt: env.STAGE_NSFW_PROMPT?.trim() || undefined,
    baseUrl: env.STAGE_BASE_URL ?? "http://127.0.0.1:9999/v1",
    apiKey: env.STAGE_API_KEY ?? "sk-1234",
    maxTokens: parsePositiveInt("STAGE_MAX_TOKENS", env.STAGE_MAX_TOKENS, 32768),
    contextWindow,
    compactRatio,
    keepRecentTokens,
    // 工坊侧同一组参数：缺省逐项沿用全局，写了就以工坊自己的为准。
    workshopContext: {
      contextWindow: parsePositiveInt(
        "STAGE_WORKSHOP_CONTEXT_WINDOW",
        env.STAGE_WORKSHOP_CONTEXT_WINDOW,
        contextWindow,
      ),
      compactRatio: parseRatio(
        "STAGE_WORKSHOP_COMPACT_RATIO",
        env.STAGE_WORKSHOP_COMPACT_RATIO,
        compactRatio,
      ),
      keepRecentTokens: parsePositiveInt(
        "STAGE_WORKSHOP_KEEP_RECENT_TOKENS",
        env.STAGE_WORKSHOP_KEEP_RECENT_TOKENS,
        keepRecentTokens,
      ),
    },
    // 一轮 240s：一轮里有生图预发射和多轮记忆工具调用，60s 不够；再久就是网关挂了。
    // 到点 abort 这一轮，按轮失败收束（空轮护栏给玩家重试入口），不是无声卡死。
    beatTimeoutMs: parsePositiveInt("STAGE_BEAT_TIMEOUT_MS", env.STAGE_BEAT_TIMEOUT_MS, 240_000),
    image: {
      enabled: env.STAGE_IMAGE_ENABLED !== "false",
      format: parseEnum("STAGE_IMAGE_FORMAT", env.STAGE_IMAGE_FORMAT, ["gemini", "openai"] as const, "openai"),
      baseUrl: env.STAGE_IMAGE_BASE_URL ?? "http://127.0.0.1:9999",
      apiKey: env.STAGE_IMAGE_API_KEY ?? "",
      model: env.STAGE_IMAGE_MODEL ?? "gpt-image-2",
      // 启动即校验并归一化（配置里写 1k 也认，发出去的一律是官方的大写 1K）。
      size: imageSizeText(parseImageSize(env.STAGE_IMAGE_SIZE ?? "1K")),
      // 6 是按本地网关定的：单价近乎免费，工坊一次要出几个差分，
      // 串行等 6×100s 用户受不了。换成计费网关时按钱包调小。
      concurrency: parsePositiveInt("STAGE_IMAGE_CONCURRENCY", env.STAGE_IMAGE_CONCURRENCY, 6),
      // 出图最慢的是带垫图的差分（实测 138s），180s 留够余量。
      timeoutMs: parsePositiveInt("STAGE_IMAGE_TIMEOUT_MS", env.STAGE_IMAGE_TIMEOUT_MS, 180_000),
      // 垫图（参考图）策略：neutral = 派生立绘差分时拿该角色的 neutral 定妆照垫图（保角色一致性）；
      // none = 全走文生图，差分与其它表情就不是同一个人了。
      // 默认 neutral：垫图让单张耗时翻倍（实测 9:16 69s → 138s）而像素一模一样，
      // 但一致性是演出观感的事；差分只由工坊（用户眼前）生成，剧作家在参数层就拿不到 expression。
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
  // 保留预算 ≥ 触发阈值：每轮都判定超标却永远切不出可压段，纪元压缩静默失效
  for (const [name, block] of [
    ["STAGE", config],
    ["STAGE_WORKSHOP", config.workshopContext],
  ] as const) {
    if (block.keepRecentTokens >= block.contextWindow * block.compactRatio) {
      console.warn(
        `[stage-ai] ${name}_KEEP_RECENT_TOKENS（${block.keepRecentTokens}）≥ 触发阈值（${Math.floor(
          block.contextWindow * block.compactRatio,
        )}），纪元压缩将无法切出可压段`,
      );
    }
  }
  return config;
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

/** 多 key 凭据（`STAGE_TTS_KEYS` / `STAGE_EXA_KEYS`）：逗号或换行分隔，保序去重。 */
export function parseKeyList(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(/[,\s]+/)) {
    const key = part.trim();
    if (key !== "" && !out.includes(key)) out.push(key);
  }
  return out;
}
