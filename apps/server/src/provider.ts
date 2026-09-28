import { createProvider, envApiKeyAuth, type Model, type Provider } from "@earendil-works/pi-ai";
import { getBuiltinModels, type BuiltinProvider } from "@earendil-works/pi-ai/providers/all";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ServerConfig } from "./config.js";

export const CPA_PROVIDER_ID = "cpa";

/**
 * 构造指向 OpenAI 兼容网关（cli-proxy-api）的 provider 与模型。
 * 模型克隆自 pi-ai 内置目录（继承 api/contextWindow/cost 元数据），改 id/baseUrl 指向网关。
 */
export function createCpaProvider(config: ServerConfig): {
  provider: Provider<"openai-completions">;
  model: Model<"openai-completions">;
} {
  const [providerName, baseModelId] = config.modelBase.split("/");
  if (!providerName || !baseModelId) throw new Error(`modelBase 须为 provider/modelId: ${config.modelBase}`);
  const builtin = getBuiltinModels(providerName as BuiltinProvider).find((m) => m.id === baseModelId);
  if (!builtin) throw new Error(`pi-ai 内置模型不存在: ${config.modelBase}`);

  const model: Model<"openai-completions"> = {
    ...builtin,
    id: config.modelId,
    name: `${config.modelId} (cpa)`,
    provider: CPA_PROVIDER_ID,
    baseUrl: config.baseUrl,
    // 捐赠元数据的输出上限与网关路由无关（deepseek-flash 捐 384k，超 glm 网关 [1,131072] 上限）：
    // streamSimple 在调用方不传 maxTokens 时会以 model.maxTokens 填充发出，虚值即 400 空拍。钳为 STAGE_MAX_TOKENS。
    maxTokens: config.maxTokens,
  };

  const provider = createProvider({
    id: CPA_PROVIDER_ID,
    name: "cli-proxy-api",
    baseUrl: config.baseUrl,
    auth: { apiKey: envApiKeyAuth("cpa", ["STAGE_API_KEY"]) },
    models: [model],
    api: { "openai-completions": openAICompletionsApi() },
  });

  return { provider, model };
}
