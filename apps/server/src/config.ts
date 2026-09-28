import { resolve } from "node:path";

/** 服务端配置：环境变量驱动（cpa 网关 + 模型 + 剧目路径）。 */
export interface ServerConfig {
  port: number;
  playDir: string;
  modelId: string;
  modelBase: string; // pi-ai 内置基础模型（继承 api/cost/contextWindow 等元数据）
  baseUrl: string;
  apiKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd()): ServerConfig {
  return {
    port: Number(env.STAGE_PORT ?? "8787"),
    playDir: resolve(repoRoot, env.STAGE_PLAY_DIR ?? "plays/demo"),
    modelId: env.STAGE_MODEL_ID ?? "ms/deepseek-ai/DeepSeek-V4.1-Flash",
    modelBase: env.STAGE_MODEL_BASE ?? "deepseek/deepseek-flash",
    baseUrl: env.STAGE_BASE_URL ?? "http://127.0.0.1:9999/v1",
    apiKey: env.STAGE_API_KEY ?? "sk-1234",
  };
}
