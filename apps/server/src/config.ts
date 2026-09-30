import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { IMAGE_SIZES, type ImageSize } from "./imageBackend.js";

/** 服务端配置：环境变量驱动（cpa 网关 + 模型 + 剧目库根目录 + fish-audio TTS）。 */
export interface ServerConfig {
  port: number;
  /** 剧目库根目录（多剧目，每子目录一剧目）。 */
  playsRoot: string;
  /** 应用级素材资源库根目录（每子目录一素材条目，用户在本地目录里增删改，服务端只读）。 */
  libraryRoot: string;
  modelId: string;
  modelBase: string; // pi-ai 内置基础模型（继承 api/cost/contextWindow 等元数据）
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
  /** 单拍超时（毫秒）：网关挂住时 provider 既不报错也不收流，到点 abort 这一拍。 */
  beatTimeoutMs: number;
  /** 生图管线（D6）：出图后端 + 预发射 + 媒体缓存。 */
  image: {
    enabled: boolean;
    /** 后端实现：cpa（默认，本项目自配网关）| flow2api（本机 Flow 逆向网关，支持垫图与画幅）。 */
    backend: "cpa" | "flow2api";
    /** cpa 出图模型：gpt-image-2（images/generations）| gemini-3.1-flash-image（流式出图）。 */
    model: string;
    /** cpa 出图尺寸（WxH）。换 seedream-5.0-lite 需 ≥3686400 像素（如 2560x1440），否则 400。 */
    size: string;
    /** 并发出图上限（每图 15–30s，串行会把预发射窗口拖穿）。 */
    concurrency: number;
    /** 单图超时（毫秒）：超时按失败降级，占位骨架不留死。 */
    timeoutMs: number;
  };
  /** flow2api 后端（`image.backend=flow2api` 时生效）。 */
  flow: {
    baseUrl: string;
    apiKey: string;
    /** 别名模型名，传完整名会让 flow2api 忽略 imageConfig。 */
    model: string;
    size: ImageSize;
    timeoutMs: number;
  };
  /** 语音管线（D5）：fish-audio keys / 代理 / 并发。 */
  tts: {
    enabled: boolean;
    keysPath: string;
    proxy: string;
    baseUrl: string;
    concurrency: number;
  };
  /** 工坊联网检索（Exa）：工坊 agent 唯一的联网口子，一次调用同时搜索并取回正文。 */
  exa: {
    enabled: boolean;
    keysPath: string;
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

/** (0,1] 比例解析：越界阈值会让纪元压缩永不触发或每拍都触发，非法值回退默认并告警。 */
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

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
): ServerConfig {
  const config: ServerConfig = {
    port: Number(env.STAGE_PORT ?? "8787"),
    playsRoot: resolve(repoRoot, env.STAGE_PLAYS_ROOT ?? "plays"),
    libraryRoot: resolve(repoRoot, env.STAGE_LIBRARY_ROOT ?? "library"),
    modelId: env.STAGE_MODEL_ID ?? "ms/deepseek-ai/DeepSeek-V4.1-Flash",
    modelBase: env.STAGE_MODEL_BASE ?? "deepseek/deepseek-flash",
    baseUrl: env.STAGE_BASE_URL ?? "http://127.0.0.1:9999/v1",
    apiKey: env.STAGE_API_KEY ?? "sk-1234",
    maxTokens: parsePositiveInt("STAGE_MAX_TOKENS", env.STAGE_MAX_TOKENS, 32768),
    contextWindow: parsePositiveInt("STAGE_CONTEXT_WINDOW", env.STAGE_CONTEXT_WINDOW, 131072),
    compactRatio: parseRatio("STAGE_COMPACT_RATIO", env.STAGE_COMPACT_RATIO, 0.6),
    keepRecentTokens: parsePositiveInt(
      "STAGE_KEEP_RECENT_TOKENS",
      env.STAGE_KEEP_RECENT_TOKENS,
      20000,
    ),
    // 一拍 240s：一拍里有生图预发射和多轮记忆工具调用，60s 不够；再久就是网关挂了。
    // 到点 abort 这一拍，按拍失败收束（空拍护栏给玩家重试入口），不是无声卡死。
    beatTimeoutMs: parsePositiveInt("STAGE_BEAT_TIMEOUT_MS", env.STAGE_BEAT_TIMEOUT_MS, 240_000),
    image: {
      enabled: env.STAGE_IMAGE_ENABLED !== "false",
      backend: parseEnum("STAGE_IMAGE_BACKEND", env.STAGE_IMAGE_BACKEND, ["cpa", "flow2api"] as const, "cpa"),
      model: env.STAGE_IMAGE_MODEL ?? "gpt-image-2",
      size: env.STAGE_IMAGE_SIZE ?? "1536x1024",
      // 6 是按 flow2api 定的：本地网关单价近乎免费，工坊一次要出几个差分，
      // 串行等 6×100s 用户受不了。改用 cpa 计费后端时按钱包调小。
      concurrency: parsePositiveInt("STAGE_IMAGE_CONCURRENCY", env.STAGE_IMAGE_CONCURRENCY, 6),
      timeoutMs: parsePositiveInt("STAGE_IMAGE_TIMEOUT_MS", env.STAGE_IMAGE_TIMEOUT_MS, 150_000),
    },
    flow: {
      baseUrl: env.STAGE_FLOW_BASE_URL ?? "http://127.0.0.1:38000",
      apiKey: env.STAGE_FLOW_API_KEY ?? "",
      model: env.STAGE_FLOW_MODEL ?? "gemini-3.1-flash-image",
      size: parseEnum("STAGE_FLOW_SIZE", env.STAGE_FLOW_SIZE, IMAGE_SIZES, "2k"),
      timeoutMs: parsePositiveInt("STAGE_FLOW_TIMEOUT_MS", env.STAGE_FLOW_TIMEOUT_MS, 180_000),
    },
    tts: {
      enabled: env.STAGE_TTS_ENABLED !== "false",
      keysPath: resolve(
        repoRoot,
        env.STAGE_TTS_KEYS ?? join(homedir(), ".config/fish-audio/keys.json"),
      ),
      proxy: env.STAGE_TTS_PROXY ?? "http://127.0.0.1:7890",
      baseUrl: env.STAGE_TTS_BASE_URL ?? "https://api.fish.audio",
      concurrency: parsePositiveInt("STAGE_TTS_CONCURRENCY", env.STAGE_TTS_CONCURRENCY, 2),
    },
    exa: {
      enabled: env.STAGE_EXA_ENABLED !== "false",
      keysPath: resolve(repoRoot, env.STAGE_EXA_KEYS ?? join(homedir(), ".config/exa/keys.json")),
      baseUrl: env.STAGE_EXA_BASE_URL ?? "https://api.exa.ai",
      proxy: env.STAGE_EXA_PROXY ?? "http://127.0.0.1:7890",
      timeoutMs: parsePositiveInt("STAGE_EXA_TIMEOUT_MS", env.STAGE_EXA_TIMEOUT_MS, 20_000),
    },
  };
  // 保留预算 ≥ 触发阈值：每拍都判定超标却永远切不出可压段，纪元压缩静默失效
  if (config.keepRecentTokens >= config.contextWindow * config.compactRatio) {
    console.warn(
      `[stage-ai] STAGE_KEEP_RECENT_TOKENS（${config.keepRecentTokens}）≥ 触发阈值（${Math.floor(
        config.contextWindow * config.compactRatio,
      )}），纪元压缩将无法切出可压段`,
    );
  }
  return config;
}

/** 多 key 凭据文件：接受 `["k1","k2"]` 或 `{"keys": [...]}`，缺失/坏文件按空表处理。 */
export function readKeysFile(path: string): string[] {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const list = Array.isArray(raw) ? raw : (raw as { keys?: unknown })?.keys;
    if (!Array.isArray(list)) return [];
    return list.filter((k): k is string => typeof k === "string" && k.trim() !== "");
  } catch {
    return [];
  }
}
