import { join, resolve } from "node:path";
import { homedir } from "node:os";

/** 服务端配置：环境变量驱动（cpa 网关 + 模型 + 剧目库根目录 + fish-audio TTS）。 */
export interface ServerConfig {
  port: number;
  /** 剧目库根目录（多剧目，每子目录一剧目）。 */
  playsRoot: string;
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
  /** 语音管线（D5）：fish-audio keys / 代理 / 并发。 */
  tts: {
    enabled: boolean;
    keysPath: string;
    proxy: string;
    baseUrl: string;
    concurrency: number;
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

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
): ServerConfig {
  const config: ServerConfig = {
    port: Number(env.STAGE_PORT ?? "8787"),
    playsRoot: resolve(repoRoot, env.STAGE_PLAYS_ROOT ?? "plays"),
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
