# 是否抽取共享 AIVN Agent 包（P1-12 · 架构决策记录）

> 这是评估任务，**不修改业务代码**。前置：`261008-aivn-dual-host.plan.md`（两条线定位）、
> `261008-aivn-dual-host.tool-audit.md`（工具面审计）、
> `docs/references/261009-cross-host-verification.md`（验证矩阵）。

## 决策

**不抽取新的共享 Agent 包。** 现状的「`@aivn/core` + `@aivn/stage` 共享 + 各宿主自持 Agent 装配」
是对的，继续沿用。若将来要动，**先满足下面 §4 的触发条件**，且走 `vendor/` tarball 而非新建 npm 包。

## 1. 现状证据

| 事实 | 数值 |
| --- | --- |
| `@aivn/core` 规模 | 4176 行 |
| `@aivn/stage` 规模 | 4519 行 |
| DSH 实际消费 core 的导出 | **39 个**（`StageDslParser` / `StageEvent` / `parseCharacterCard` / `parsePlayConfig` / `spriteIdOf` / `PhraseChunker` / `resolveCraft` 与全套 `CRAFT_*` 取值 / `ASSET_DRAFT_RETENTION_DAYS` 等，含 type-only） |
| DSH 依赖方式 | `file:../stage-ai/packages/*`，**构建期** esbuild `bundle: true` 打进 `lib/`（宿主 323KB + 客户端 171KB） |
| 独立版工具面 | 24 个 |
| DSH 工具面 | 9 个 |
| **两边同名的工具** | `generate_image` / `import_asset` / `generate_bgm` / `list_voices` / `web_search`（5 个） |

两个关键观察：

1. **共享层已经在真干活**：DSH 用了 core 的 39 个导出，覆盖 DSL 解析、IR、角色/剧目配置、
   写作参数（全套 `CRAFT_*`）、立绘取景体量、语音分句、素材保留期。**共享的是领域，不是 Agent 装配。**
2. **工具面大部分不同名**：独立版 24 个里只有 5 个与 DSH 同名，其余是各自宿主专属
   （独立版有 `beat_done`/`update_state`/`lineage`/`readiness`/`nsfw` 等；DSH 有 `generate_asset`/`validate_play`/`set_stage_style`）。

## 2. 候选共享内容与判断

按任务书列的候选逐项评估：

| 候选 | 该不该共享 | 理由 |
| --- | --- | --- |
| capability schema | ❌ | 两边**不同构**：独立版是「能力白名单 → 授权工具 → 写面」三级推导（`CAPABILITY_CATALOG`）；DSH 是「预设 + 插件配置 + 按预设禁用」（`capabilities.ts` 只有 49 行）。强行统一会造出一个两边都要迁就的中间态 |
| tool metadata | ⚠️ 部分 | 独立版是**九个结构化布尔位**（`ToolSideEffectMetadata`），DSH 是**一句散文**（`sideEffects: '只读'`）。这不是「同一份东西的两种写法」，是两种不同成熟度的东西——把 DSH 拉上来是它的独立演进，不是共享的理由 |
| result types | ❌ | 独立版的结果管道在 `agentkit/result.ts`（`textResult`/`linesResult`/`reason`），DSH 在 `media/generate-tool.ts`（`textOutput`/`genericResult`/`generatedResult`）。两边形状不同、各自与自己的工具实现耦合 |
| domain policy | ✅ **已在 core** | 素材生命周期（`assetLifecycle.ts`，105 行）已经是共享的，且 DSH 已在消费 `ASSET_DRAFT_RETENTION_DAYS`。这条**不需要新包** |

**唯一有实质共享价值的 `domain policy` 已经在 `@aivn/core` 里了。**

## 3. 为什么新包会亏

1. **多一层构建**：现在改 core → 独立版 `pnpm -r build` + DSH `npm run build`（两个命令）。
   多一个包就是三处构建、三处版本，而 DSH 的 `lib/` 本就是**受跟踪构建产物**
   （`build.mjs --check` 硬判字节）——多一层输入就是多一处静默漂移的机会。
2. **共享的边界已经找对了**：真正会被两边用到吐血的（DSL、IR、素材/角色契约、舞台渲染）
   都在 `core`/`stage`。Agent 装配是**宿主接线**——它的形状由宿主的权限模型、会话模型、
   预设机制决定，不是领域知识。
3. **`AGENTS.md` 已经写明 DSH 的定位**：它「重新实现了剧目读写、提示词、工具、媒体、语音和事件投影，
   不能误称为薄适配器」，但这部分重复「主要来自两个不同的 Agent 宿主和持久化模型，
   不是简单把代码搬到共享包就能消除」。

## 4. 什么时候该重新评估（触发条件）

按当前判断，出现**任一条**时回来重做这个决策：

- **第三个宿主**出现（比如另一个 Agent 平台的适配线）。两个宿主是「各自适配」，三个就是「抽取抽象」——
  这是经典的 rule of three。
- DSH 的 tool metadata 演进到与独立版**同构**（结构化副作用位），且两边开始出现
  「同一份工具语义各改一遍」的实际 bug。
- 出现「要在没有兄弟仓的情况下从源码构建 DSH」的真实接收方——那时需要自包含，
  但解法是 `pnpm pack` + `vendor/` tarball（`AGENTS.md` 已写），**不是新建共享包**。

## 5. 若将来真要抽，边界在哪

明确**不该进**共享包（这些是宿主的，抽出去会造出迁就两边的中间态）：

- `PlayHouse` / `LineageTree` / saves（独立版产品能力）
- DSH session / workspace / projection（宿主会话模型）
- 独立版工坊线程、DSH 预设机制
- 传输（REST+WS vs host route+SSE）
- 完整媒体后端（只共享**目标、状态、错误语义**，队列与存储各随宿主）

该进的是**稳定、宿主无关的领域声明**：capability 的**语义**（不是它的授权机制）、
工具副作用的**分类**（不是它的执行策略）、结果与错误的**形状**。

## 6. 现状为什么不构成技术债

「两边各维护一份 Agent 装配」看起来像重复，但它是**有意的宿主适配**，且本轮已经用
**契约 + 守卫**把漂移面压住了：

| 手段 | 作用 |
| --- | --- |
| `CAPABILITY_MATRIX`（`agentkit/contract.ts`） | 逐能力登记两宿主实现与**有意差异**，差异变成设计而不是漏同步 |
| `assetLifecycle.ts`（core） | 素材状态与转换两边共用一套名字 |
| `check-agent-contract.mjs`（7 项） | 提示词/工具/能力位/skill 的漂移机器可查 |

**结论**：当前结构下，「减少无意分歧」已经由契约与守卫达成；「消灭所有分歧」既不可能也不该做。
