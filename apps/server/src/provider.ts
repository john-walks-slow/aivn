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
