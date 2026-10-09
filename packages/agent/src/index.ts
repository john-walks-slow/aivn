/**
 * `@aivn/agent` —— AIVN 的共享 agent 面。
 *
 * 边界（详见 `stage-ai/docs/features/261009-aivn-agent-package/`）：
 *
 * - **进这个包**：能力（参数规格 + 文档 + 副作用 + 实现）、use case、提示词与技能正文、
 *   中立 schema IR；任何**两个宿主都有第二份拷贝**的东西。
 * - **不进这个包**：工具名/角色/能力位/同步还是排产（那是宿主的 face）、会话与权限与队列、
 *   任何宿主 SDK 的类型（`ContentBlock` / TypeBox / `defineTool`）。
 */
export type { Field, FieldMap, HostField, HostFieldMap, HostTightening, InferArgs, InferValue, SchemaNode } from "./schema/ir.js";
export { assertCommonSubset, pick, tighten } from "./schema/ir.js";

export type { Capability } from "./capabilities/capability.js";
export type { CapabilityEntry } from "./capabilities/index.js";
export { CAPABILITIES } from "./capabilities/index.js";
export type { SearchDeps } from "./capabilities/web/search.js";
export { DEFAULT_RESULT_COUNT, renderSearchResults, webSearch, WEB_SEARCH_DOC, webSearchFields } from "./capabilities/web/search.js";

export type { ExaOptions, FetchInitLike, FetchLike, FetchResponseLike, SearchResult } from "./search/exa.js";
export { Exa } from "./search/exa.js";
