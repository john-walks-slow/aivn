import { createProvider, type ApiKeyAuth, type Model, type Provider } from "@earendil-works/pi-ai";
import { getBuiltinModels, getBuiltinProviders, type BuiltinProvider } from "@earendil-works/pi-ai/providers/all";
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
    // 只继承上下文/思考档位这类与调用协议无关的元数据：api 必须钉死在 OpenAI 兼容面。
    // 内置目录里 gemini-* 的 api 是 google-generative-ai，跟着继承会让 cpa provider 直接报
    //「no API implementation」，模型下拉里可选的任何非 OpenAI 内置模型都选不动。
    api: "openai-completions",
    id: config.modelId,
    name: `${config.modelId} (cpa)`,
    provider: CPA_PROVIDER_ID,
    baseUrl: config.baseUrl,
    // 捐赠元数据的输出上限与网关路由无关（deepseek-flash 捐 384k，超 glm 网关 [1,131072] 上限）：
    // streamSimple 在调用方不传 maxTokens 时会以 model.maxTokens 填充发出，虚值即 400 空轮。钳为 STAGE_MAX_TOKENS。
    maxTokens: config.maxTokens,
  };

  const provider = createProvider({
    id: CPA_PROVIDER_ID,
    name: "cli-proxy-api",
    baseUrl: config.baseUrl,
    auth: { apiKey: settingsApiKeyAuth(config) },
    models: [model],
    api: { "openai-completions": openAICompletionsApi() },
  });

  return { provider, model };
}

/**
 * 网关密钥取自**设置**（设置页里那一栏），不是环境变量。
 *
 * 这里原本挂的是 `envApiKeyAuth("cpa", ["STAGE_API_KEY"])`：设置页把 key 写进 `.env` 之后，
 * 这张快照读的仍然是启动时的进程环境，于是界面上改 key 完全不起作用——用户看到「保存成功」，
 * 请求照旧 401。密钥只有一份真相源：`settings.json`，且它的改动会重建 provider（见 playhouse）。
 */
function settingsApiKeyAuth(config: ServerConfig): ApiKeyAuth {
  return {
    name: "网关密钥",
    resolve: async ({ signal }) => {
      signal.throwIfAborted();
      const key = config.apiKey.trim();
      return key === "" ? undefined : { auth: { apiKey: key }, source: "settings.json" };
    },
  };
}

/**
 * 按剧目配置解析实际使用的模型（工坊「Agent」页签的模型下拉落在这里）。
 *
 * 换模型不只是换 id：思考档位依赖模型元数据里的 `reasoning`/`thinkingLevelMap`，
 * 所以要**克隆**对应模型的元数据再改 id 与 baseUrl，而不是在默认模型上改个 id。
 *
 * 网关上的 id 未必在 pi-ai 内置目录里（网关路由到哪台机器、用什么命名，我们不知道）：
 * 查不到就沿用默认模型的元数据、只换 id，并告警一次——真发不出去时网关会报错，
 * 那比在这里静默换回默认模型更早暴露问题。
 */
export function resolveCpaModel(
  config: ServerConfig,
  modelId: string | undefined,
): Model<"openai-completions"> {
  const id = modelId?.trim();
  if (!id || id === config.modelId) return buildModel(config, config.modelId, baseModelOf(config));
  const [base] = id.includes("/") ? [id.slice(0, id.lastIndexOf("/"))] : [""];
  const builtin = findBuiltin(id) ?? (base ? findBuiltin(base) : undefined);
  if (builtin) return buildModel(config, id, builtin);
  console.warn(
    `[stage-ai] 模型「${id}」不在 pi-ai 内置目录：沿用 ${config.modelId} 的元数据（思考档位与输出上限可能不准）`,
  );
  return buildModel(config, id, baseModelOf(config));
}

/** 内置目录里的原模型：继承 api/contextWindow/cost/reasoning 等元数据。 */
function baseModelOf(config: ServerConfig): Model<"openai-completions"> {
  const [providerName, baseModelId] = config.modelBase.split("/");
  if (!providerName || !baseModelId) throw new Error(`modelBase 须为 provider/modelId: ${config.modelBase}`);
  const builtin = getBuiltinModels(providerName as BuiltinProvider).find((m) => m.id === baseModelId);
  if (!builtin) throw new Error(`pi-ai 内置模型不存在: ${config.modelBase}`);
  return builtin as Model<"openai-completions">;
}

function findBuiltin(id: string): Model<"openai-completions"> | undefined {
  for (const provider of getBuiltinProviders()) {
    const hit = getBuiltinModels(provider).find((m) => m.id === id);
    if (hit) return hit as Model<"openai-completions">;
  }
  return undefined;
}

function buildModel(
  config: ServerConfig,
  id: string,
  base: Model<"openai-completions">,
): Model<"openai-completions"> {
  return {
    ...base,
    api: "openai-completions",
    id,
    name: `${id} (cpa)`,
    provider: CPA_PROVIDER_ID,
    baseUrl: config.baseUrl,
    // 捐赠元数据的输出上限与网关路由无关（deepseek-flash 捐 384k，超 glm 网关 [1,131072] 上限）：
    // streamSimple 在调用方不传 maxTokens 时会以 model.maxTokens 填充发出，虚值即 400 空轮。钳为 STAGE_MAX_TOKENS。
    maxTokens: config.maxTokens,
  };
}

/** 网关上可用的模型（Agent 设置页的模型下拉数据源）。 */
export interface GatewayModel {
  id: string;
  name: string;
}

/**
 * 按 `STAGE_MODELS` 收窄网关清单（剧目「Agent」页模型下拉的数据源）。
 *
 * 清单**收窄**网关，不取代它：网关 `/v1/models` 仍是「哪些模型真能发出去」的真相，
 * `STAGE_MODELS` 只决定给用户看哪几个（本机 cpa 网关有 143 个 id，多半余额耗尽，
 * 在里面翻出两个 agent 各跑哪个并不现实）。
 *
 * 清单里的 id 网关没有就报错点名，不静默丢掉：下拉里摆一个发不出去的模型比整个下拉挂掉
 * 更让人误会——选之前看不出来，选完才在剧目里 400。顺序按清单写的来（保序即「便宜→贵」的排法）。
 */
export function supportedModels(gateway: GatewayModel[], allow: string[]): GatewayModel[] {
  if (allow.length === 0) return gateway;
  const byId = new Map(gateway.map((m) => [m.id, m]));
  const missing = allow.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`STAGE_MODELS 里的模型网关没有：${missing.join("、")}`);
  }
  return allow.map((id) => byId.get(id)!);
}

/**
 * 读网关的模型清单（`GET {baseUrl}/models`）。
 *
 * 读不到就抛错：模型下拉是「这个 agent 到底在用什么模型」的唯一真相，
 * 静默退化成默认模型的话，用户在页面上看到的和实际计费的对不上。
 */
export async function fetchGatewayModels(
  config: ServerConfig,
  signal?: AbortSignal,
): Promise<GatewayModel[]> {
  // 新装默认没有网关：这里必须点名怎么说人话，不然用户看到的是 fetch 的 "Failed to parse URL"
  if (config.baseUrl === "") throw new Error('还没有配置模型网关，请到「设置 → 模型网关」里填网关地址与 API Key');
  const url = `${config.baseUrl.replace(/\/$/, "")}/models`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${config.apiKey}` },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    throw new Error(`读取网关模型清单失败（${url}）：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) throw new Error(`读取网关模型清单失败：${res.status} ${await res.text()}`);
  const body = (await res.json()) as { data?: unknown };
  const list = Array.isArray(body.data) ? body.data : [];
  const models = list
    .map((entry): GatewayModel | null => {
      const item = entry as { id?: unknown; name?: unknown };
      if (typeof item.id !== "string" || item.id.trim() === "") return null;
      return { id: item.id, name: typeof item.name === "string" && item.name !== "" ? item.name : item.id };
    })
    .filter((m): m is GatewayModel => m !== null);
  if (models.length === 0) throw new Error(`网关没有返回任何模型（${url}）`);
  return models.sort((a, b) => a.id.localeCompare(b.id));
}
