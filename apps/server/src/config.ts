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
  /** 语音管线（D5）：fish-audio keys / 代理 / 并发。 */
  tts: {
    enabled: boolean;
    keysPath: string;
    proxy: string;
    baseUrl: string;
    concurrency: number;
  };
}

/** 正整数环境变量解析（N3）：非法值回退默认并告警——NaN/0 会让预取泵静默失效。 */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    if (raw !== undefined && raw !== "") {
      console.warn(`[stage-ai] STAGE_TTS_CONCURRENCY 非法（${raw}），回退默认 ${fallback}`);
    }
    return fallback;
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd()): ServerConfig {
  return {
    port: Number(env.STAGE_PORT ?? "8787"),
    playsRoot: resolve(repoRoot, env.STAGE_PLAYS_ROOT ?? "plays"),
    modelId: env.STAGE_MODEL_ID ?? "ms/deepseek-ai/DeepSeek-V4.1-Flash",
    modelBase: env.STAGE_MODEL_BASE ?? "deepseek/deepseek-flash",
    baseUrl: env.STAGE_BASE_URL ?? "http://127.0.0.1:9999/v1",
    apiKey: env.STAGE_API_KEY ?? "sk-1234",
    tts: {
      enabled: env.STAGE_TTS_ENABLED !== "false",
      keysPath: resolve(repoRoot, env.STAGE_TTS_KEYS ?? join(homedir(), ".config/fish-audio/keys.json")),
      proxy: env.STAGE_TTS_PROXY ?? "http://127.0.0.1:7890",
      baseUrl: env.STAGE_TTS_BASE_URL ?? "https://api.fish.audio",
      concurrency: parsePositiveInt(env.STAGE_TTS_CONCURRENCY, 2),
    },
  };
}
