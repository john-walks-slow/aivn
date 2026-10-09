# P0 能力与工具契约

跨宿主能力矩阵和 AgentKit 工具副作用元数据的唯一记录在 `apps/server/src/agentkit/contract.ts`。
本文件是它在 `docs/` 的索引与判据说明；两边不要各写一份内容，改动以代码为准、此处只记「怎么判」。

- `CAPABILITY_MATRIX` 记录领域语义、shared/preset-specific、独立版与 DSH 实现、后端依赖和有意差异。
- `TOOL_SIDE_EFFECT_CATALOG` 覆盖每个 AgentKit 工具的 `read_only`、`workspace_write`、`external_request`、`asset_create`、`asset_adopt`、`background_job`、`requires_confirmation`、`reversible`、`idempotent`。
- `createAgentKit` 在实际工具装配后附加 `sideEffects`，并强制校验元数据完整性；这不会改变工具执行或宿主状态机。
- `sideEffectsForTool(name, role)` 是**按角色分化**的入口：同一个 `generate_image` 在剧作家侧是后台排产 + 直落 `assets/`，在工坊侧只产草稿——契约要表达的就是这个差别，不要为了"统一"把其中一侧抹平。
- `apps/server/test/agentkit.test.ts` 校验矩阵覆盖、实际装配消费、关键生图生命周期（含按角色的 `workspace_write`）和缺失字段失败。

新增能力时必须同时更新 `CAPABILITY_CATALOG` 与 `CAPABILITY_MATRIX`；新增 AgentKit 工具时必须更新 `TOOL_SIDE_EFFECT_CATALOG`。DSH 适配只登记在矩阵中，不复制独立版实现或状态机。
