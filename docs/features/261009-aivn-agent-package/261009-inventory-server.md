# AIVN 跨仓重构 · 独立服务端代码盘点（只读）

- 盘点目标：`/root/projects/stage-ai-shared`（worktree，内容与 main 一致，当前分支 `feat/shared-aivn-core`，HEAD `c8595bb9`）
- 盘点范围：`apps/server/src/`（78 个 `.ts`，19122 行）、`packages/core/src/`（21 个 `.ts`，4198 行）、`skills/` 与 `apps/server/skills/`
- 结论口径：本报告是**只读盘点**，未修改任何被盘点文件；除本文件外没有写入任何仓库文件。
- **前提更正**：任务书写的「Express + ws + pi-agent-core」不成立。服务端**没有 express 依赖**（`apps/server/package.json` 里没有，源码里也没有 import）。HTTP 面是 `node:http` 手写路由（`index.ts` 起 `createServer`，`http.ts` 手写分发），WS 面是 `ws` 包 + `transport.ts` 手写会话层。

---

## 0. 一句话总览

| 层 | 规模 | 外部依赖 | 定位 |
| --- | --- | --- | --- |
| `packages/core` | 4198 行 / 21 文件 | **零外部依赖**（无 node 内置、无 npm 包） | 纯领域：DSL 规范+解析器、IR 事件、WS 协议、谱系模型、剧目/角色/素材/写作参数契约、语音分句 |
| `packages/stage` | 7258 行（29 ts/tsx 5197 + 1 css 2061） | react / react-dom / lucide-react / @aivn/core | 浏览器舞台渲染（宿主无关） |
| `apps/server/src` | 19122 行 / 78 文件 | node 内置 + pi-agent-core + pi-ai + ws + sharp + minisearch + undici + fflate | 独立宿主：编排器、HTTP/WS 传输、配置、路径、媒体后端、工具装配 |

**已经存在的边界非常干净**：`@aivn/core` 是零依赖纯 TS，`packages/` 下没有一个包碰 node 内置或 npm 包。要用「抽包」把它们拆开，先看清楚现在**没在 core 里**的那一大堆「看起来像领域、实际长在宿主上」的东西。

一个必须先知道的历史事实：仓库里有一份**明确的架构决策记录**——`docs/features/261008-aivn-dual-host/261008-aivn-dual-host.shared-package.adr.md`（提交 `75e8d74d`，2026-10-09），结论是**不抽共享 Agent 包**，理由是「共享的是领域，不是 Agent 装配」。本次任务的抽包方向与那份 ADR 相反，开工前应先决定是推翻它还是修订它（见 §6）。

---

## 1. 逐文件盘点

分类口径：
- **纯领域**：无 node 内置 / 无 npm / 无宿主 API、无环境变量、无 fs。可原样进共享包。
- **薄适配**：逻辑本身宿主无关，但 import 了宿主的类型（`ServerConfig` / `PlayStore` / `AgentCapabilities` 等）或直接读 `process.env`；抽包时要先摘接缝。
- **宿主专有**：直接 import 传输/配置/路径/编排器/队列，或本身就在描述这台宿主的运行形态。

### 1.1 图像管线（imageBackend / 三家后端 / 抠底 / MIME）

| 文件 | 行数 | 导出 | 外部依赖 | 宿主耦合点 | 归类 |
| --- | --- | --- | --- | --- | --- |
| `imageBackend.ts` | 168 | `IMAGE_ASPECTS` `ImageAspect` `IMAGE_SIZES` `ImageSize` `ImageSizeSpec` `ImageRequest` `GeneratedImage` `ImageBackend` `parseImageSize` `imageSizeText` `tierArea` `higherTier` `extOf` `sizeOfImage` `aspectMatches` | **无** | 无 | **纯领域** |
| `imageMime.ts` | 27 | `IMAGE_EXTS` `sniffImageMime` `mimeForExt` | **无**（用 Buffer 类型） | 无 | **纯领域** |
| `geminiImage.ts` | 167 | `GeminiImageOptions` `GeminiImageGen` | `undici` + `imageBackend` | 配置经构造参数注入，不读 env | **纯领域**（网络适配器） |
| `openaiImage.ts` | 154 | `OpenAiImageOptions` `OpenAiImageGen` `canvasFor` | `undici` + `imageBackend` | 同上 | **纯领域** |
| `modelslabImage.ts` | 194 | `ModelsLabImageOptions` `ModelsLabImageGen` `canvasFor` | `undici` + `imageBackend` | 同上 | **纯领域** |
| `imageFactory.ts` | 24 | `createImageBackend` | `config`(type) + 三家后端 | **`import type { ServerConfig }`**——工厂签名直接吃宿主配置对象 | **薄适配** |
| `cutout.ts` | 598 | `CutoutResult` `CutoutOptions` `CutoutTuning` `defaultTuning` `resolveTuning` `cutout` | **`sharp`**（原生扩展） | `resolveTuning()` 直接 `process.env.STAGE_CUTOUT_TOLERANCE / KEY_SMOOTH / EDGE_BAND / SPILL / SOLID_RESIDUAL` | **薄适配**（算法纯，但 sharp + env 是包重量） |
| `imagePrompt.ts` | 144 | `MIN_IMAGE_PROMPT_WORDS` `CG_PROMPT_SYSTEM` `BG_PROMPT_SYSTEM` `SPRITE_PROMPT_SYSTEM` `ImagePromptDeps` `ImagePromptContext` `ImagePromptKind` `composeImagePrompt` | `@earendil-works/pi-agent-core`(type `StreamFn`) + `@earendil-works/pi-ai`(type) + `./llm.js` | 依赖宿主的 `completeText`（走宿主模型） | **薄适配** |

要点：**画幅/档位/画布数学这一段是干净可共享的**（`imageBackend` 零依赖 + 三后端只认 undici）。真正拖重的是 `cutout.ts`（sharp 原生二进制）和 `imagePrompt.ts`（绑定 pi 的 `StreamFn` 与宿主 LLM 完成函数）。

### 1.2 素材 / 剧目文件 / 资源库 / 台账

| 文件 | 行数 | 导出 | 外部依赖 | 宿主耦合点 | 归类 |
| --- | --- | --- | --- | --- | --- |
| `playFiles.ts` | 290 | `PlayFileKind` `PlayFile` `WriteScope` `WRITE_SCOPE_LABELS` `writeScopeOf` `inWriteScopes` `isGenerated` `PlayFiles` | node:fs/path + `@aivn/core` | `import type { PlayStore }`；白名单是领域，落盘口是宿主 | **薄适配** |
| `memory.ts` | 283 | `PlayMemory` `IndexCard` `ArchiveSlice` `loadCharacterCards` `cjkBigrams` | node:fs/path + **`minisearch`**(npm) + `@aivn/core` | `import type { PlayStore }`；`memory/index` 布局约定 | **薄适配** |
| `library.ts` | 152 | `assertEntryId` `AssetLibrary` | node:fs/path + `@aivn/core` | 目录布局约定（`library/<kind>/<id>/`，文档提及 `STAGE_LIBRARY_ROOT`，实际由 `index.ts` 传 `join(dataRoot,"library")`） | **薄适配** |
| `assetImport.ts` | 259 | `ImportRequest` `ImportResult` `importFromLibrary` | node:fs/path + `@aivn/core` | `library` + `playFiles` + `store.withPlayConfigLock` + `workshop.ts` 的 `PlayFileWrite` 类型 | **宿主专有**（跨模块事务编排） |
| `assetRef.ts` | 188 | `AssetRef` `AssetRefResolverDeps` `AssetRefResolver` `refsFromScene` `refFromCg` `refFromActor` `refFromSfx` `characterIdsOf` | `@aivn/core` + `library` + `assetImport` + `memory` | `import type { PlayStore }`；「引用即导入」是引擎运行形态 | **宿主专有** |
| `generatedLedger.ts` | 32 | `GeneratedLedgerEntry` `readPlayLedgerEntries` | node:fs/path + `@aivn/core`(type) | `import type { PlayStore }`；URL 前缀 `/plays/<id>/…` 是这台宿主的静态路由约定 | **薄适配** |
| `playAssets.ts` | **1250** | `assertAssetStem` `assertSpriteId` `AssetNotify` `AssetKind` `AssetTarget` `GenerateOptions` `GeneratedPlayAsset` `DraftedAsset` `CommitOptions` `ResolvedReference` `PlayAssetsDeps` `PlayAssets` | node:crypto/fs/path + `@aivn/core` + `imageBackend` + `cutout` + `imageMime` + `limiter` + `memory` + `pendingJobs` + `playFiles` + `store` + `webImage` + `agentkit/deps`(type) | 草稿/入库/留底四条生命周期 + `media-cache/` 布局 + `PendingJobs` 记账 + `WebImageFetcher` | **宿主专有**（服务端最大的媒体领域文件；但资产生命周期契约已在 core） |

要点：`playAssets.ts`（1250 行）是「独立版最像领域、实际最像宿主」的典型——它同时持有**资产语义**（core 里的 `assetLifecycle` 已经收了一份）与**宿主运行形态**（draft 目录、留底原片、队列、URL 前缀）。抽包时这里必须按语义/形态劈开，不能整文件搬。

### 1.3 提示词与参数渲染

| 文件 | 行数 | 导出 | 外部依赖 | 宿主耦合点 | 归类 |
| --- | --- | --- | --- | --- | --- |
| `craftParams.ts` | 239 | `renderCraftParams` `describeCraftParams` `CraftPatch` `mergeCraftParams` `CRAFT_ENUMS` `resolveCraft`(re-export) | `@aivn/core`（全套 `CRAFT_*`）+ `agentkit/kit`(type `AgentCapabilities`) | 只为一个类型 import 了装配层——**这是可以摘掉的接缝** | **薄适配**（近乎纯领域） |
| `prompt.ts` | 562 | `AssetManifest` `AssetNotes` `GeneratedNote` `PromptContext` `CAST_GRADING_MIN_SIZE` `CAST_SUMMARY_CHARS` `CAST_SCAN_EVENTS` `buildSystemPrompt` `renderStateSection` | `@aivn/core` + `craftParams` + `agentkit/kit`(type) + `agentkit/searchTool`(`SEARCH_GUIDE` 文本) + `memory`(type `PlayMemory`) | 剧作家 persona 正文硬编码在此；依赖 `PlayMemory` 实例、`AgentCapabilities` | **薄适配**（内容层领域，接缝是类型） |
| `workshop.ts` | 574 | `buildWorkshopPrompt` `summarizeThread` `HistoryToMessages` `runWorkshopTurn` `deriveThreadTitle` `WorkshopPromptContext` 等 | `@earendil-works/pi-agent-core` + `pi-ai` + `@aivn/core` + `skills.ts` | 工坊 persona 正文硬编码在此；跑一轮真 Agent（`PiAgent`） | **宿主专有**（含提示词正文 + Agent 执行） |

### 1.4 宿主接线：路径 / 配置 / 编排 / 传输

| 文件 | 行数 | 导出 | 外部依赖 | 宿主耦合点 | 归类 |
| --- | --- | --- | --- | --- | --- |
| `paths.ts` | 69 | `isPackaged` `resourceRootOf` `defaultDataRoot` `envFileDir` `workshopSkillsDirOf` `loadEnvFile` | node:fs/path/url | `process.pkg`（pkg 单文件形态）、仓库相对路径、`.env` 位置 | **宿主专有** |
| `config.ts` | 495 | `BootstrapConfig` `ServerConfig` `freshSettings` `settingsFromEnv` `loadBootstrap` `SettingsPatch` `applyPatch` `parseModelList` `parseKeyList` `imagePendingTtlMs` `musicConnectionOf` | `node:path` + `imageBackend` + `limiter` | **全部 `STAGE_*` 环境变量**、`settings.json` 语义、`<dataRoot>` 布局 | **宿主专有** |
| `configApi.ts` | 211 | `KeyListView` `SettingsView` `SettingsViewPatch` `SettingsApi` `mask` | `config` + `lanAccess` + `startup` | 设置页 API、局域网地址、`SettingsStore` 实例 | **宿主专有** |
| `orchestrator.ts` | **2460** | `NSFW_PRE_TURNS` `PlayerAction` `ResolvedAction` `OrchestratorOptions` `CarryOver` `OrchestratorRuntimeState` `PlaywrightOrchestrator` | `@earendil-works/pi-agent-core`（含 `Agent` 实体）+ `pi-ai` + `@aivn/core`（4 条 import 语句，重）+ `agentkit/kit` + `playFiles` + `assetRef` + `prompt` + `rebuild` + `compaction` + `llm` + `history` + `memory` + `voice` + `pendingJobs` | 整条演出循环：Agent 生命周期、A/B/D 区、轮边界、NSFW 通道、谱系重放、token 压缩 | **宿主专有** |
| `index.ts` | 174 | `main` | `node:http` + **`ws`** + `config` + `cli` + `settingsStore` + `configApi` + `lanAccess` + `paths` + `selftest` + `startup` + `store` + `library` + `playhouse` + `http` + `voiceCatalog` + `transport` + `webAuth` + `webStatic` | 进程入口：端口/数据目录/设置迁移/静态资源/防火墙 | **宿主专有** |
| `http.ts` | 629 | `handleHttp` | `node:http`/fs/path + `@aivn/core`(9 个符号) + `store` + `library` + `assetImport` + `generatedLedger` + `playhouse`(type) + `configApi`(type) + `memory` + `voiceCatalog` + `lanAccess` | `/plays/...` 路由树、Basic 认证、静态素材服务、`withPlayConfigLock` | **宿主专有** |
| `playhouse.ts` | **1420** | `PlayRuntime` `helloPayload` `PlayHouse` | **39 条 import**：`@aivn/core`(3 语句) + `store` + `library` + `assetRef` + `orchestrator` + `config` + `settingsStore` + `provider` + `tts` + `imageFactory` + `musicFactory` + `exa` + `webImage` + `generatedLedger` + `playAssets` + `playMusic` + `pendingJobs` + `playFiles` + `agentkit/kit` + `agentkit/role` + `limiter` + `translate` + `memory` + `workshopSession` + `llm` + `imagePrompt` + `pi-*` | 多剧目运行时总装配：runtime 地图、WS 客户端广播、pendingJobs、限流、设置热重建、素材预发射 | **宿主专有** |
| `transport.ts` | — | `attachTransport` | **`ws`** + `@aivn/core`(`ClientMessage`/`ServerMessage`) + `playhouse` | `/ws?play=<id>` 路由、连接数当语音存活依据、resume 重放 | **宿主专有** |

### 1.5 `agentkit/`（整目录，23 文件，3066 行）

| 文件 | 行数 | 导出 | 外部依赖 | 归类 |
| --- | --- | --- | --- | --- |
| `kit.ts` | 537 | `CAPABILITY_GROUPS` `CapabilityGroup` `CapabilityEnv` `CAPABILITY_CATALOG` `CapabilityId` `AgentCapabilityEntry` `capabilityCatalog` `BASE_TOOLS` `installableTools` `capabilityTools` `defaultCapabilitiesFor` `enabledCapabilitiesFor` `enabledToolsFor` `writeScopesFor` `AgentCapabilities` `capabilitiesOf` `AgentKit` `roleTools` `createAgentKit` `ROLES` | `pi-agent-core`(type) + `@aivn/core`(type) + 全部工具工厂 + `contract` | **宿主专有** |
| `contract.ts` | 351 | `CapabilityProfile` `CapabilityEquivalence` `CapabilityHostContract` `CrossHostCapabilityContract` `CAPABILITY_MATRIX` `CapabilityMatrixId` `CAPABILITY_MATRIX_BY_ID` `ToolSideEffectMetadata` `AgentToolWithContract` `TOOL_SIDE_EFFECT_CATALOG` `sideEffectsForTool` `attachToolContract` `assertToolContracts` | **仅 `./role.js`** ——这是全目录里**唯一零 pi 依赖**的文件，且内容就是跨宿主契约 | **纯领域**（跨宿主契约，非工具实现） |
| `deps.ts` | 128 | `ModelStop` `PlayFileWrite` `KitCommonDeps` `PlaywriterKitDeps` `WorkshopKitDeps` `AgentKitDeps` | `@aivn/core`(type) + 11 个宿主服务 type + `role` | **宿主专有**（DI 接缝，是「工具需要宿主提供什么」的完整清单） |
| `role.ts` | 27 | `AGENT_ROLES` `AgentRole` `ROLE_META` `isAgentRole` | **无** | **纯领域** |
| `result.ts` | 16 | `textResult` `linesResult` `reason` | `pi-agent-core`(type `AgentToolResult`) | **薄适配** |
| `playEnv.ts` | 131 | `PlayEnvPolicy` `PlayEnv` | node:path + `pi-agent-core`（含 `NodeExecutionEnv` 子路径）+ `playFiles` + `deps` | **宿主专有** |
| `piTools.ts` | 64 | `createPiFileTools` `createPiBashTool` | `pi-agent-core` 的 `createReadTool/createWriteTool/createEditTool/createBashTool/BACKGROUND_CONTEXT` | **宿主专有**（pi 内建工具接线） |
| `beatTool.ts` | 92 | `createBeatDoneTool` `renderBeatDone` | `pi-agent-core` + `pi-ai` + `deps` | **薄适配** |
| `nsfwTool.ts` | 69 | `createNsfwTools` | `pi-agent-core` + `pi-ai` | **薄适配** |
| `memoryTool.ts` | 134 | `createMemoryTools` | `pi-agent-core` + `pi-ai` + `deps` | **薄适配** |
| `craftTool.ts` | 157 | `createSetCraftTool` | `pi-ai` + `@aivn/core` + `craftParams` + `store` + `deps` | **宿主专有**（`withPlayConfigLock`） |
| `imageTool.ts` | 327 | `SyncImageDeps` `QueuedImageDeps` `ImageToolDeps` `createGenerateImageTool` | `pi-agent-core` + `pi-ai` + `@aivn/core` + `playAssets` + `result` | **宿主专有** |
| `commitTool.ts` | 64 | `CommitAssetDeps` `createCommitAssetTool` | `pi-*` + `playAssets` + `result` | **宿主专有** |
| `recutTool.ts` | 99 | `RecutDeps` `createRecutSpriteTool` | `pi-*` + `playAssets` + `result` | **宿主专有** |
| `libraryTool.ts` | 255 | `LibraryToolDeps` `createLibraryTools` | `pi-*` + `@aivn/core` + `library` + `assetImport` + `store` + `deps` | **宿主专有** |
| `musicTool.ts` | 133 | `MusicToolDeps` `createGenerateMusicTool` | `pi-*` + `playMusic` + `result` | **宿主专有** |
| `voiceTool.ts` | 106 | `createVoiceTool` | `pi-*` + `voiceCatalog` + `result` | **宿主专有** |
| `searchTool.ts` | 64 | `SEARCH_GUIDE` `createWebSearchTool` `renderSearchResults` | `pi-*` + `exa` + `result` | **薄适配**（`SEARCH_GUIDE` 是可共享的提示词文本） |
| `viewTool.ts` | 109 | `ViewImageDeps` `createViewImageTool` | node:fs/path + `pi-*` + `imageBackend` + `imageMime` + `webImage` + `result` | **宿主专有** |
| `skillTool.ts` | 36 | `createReadSkillTool` | `pi-*` + `skills.ts` | **宿主专有** |
| `lineageTool.ts` | 134 | `createLineageTools` | `pi-*` + `@aivn/core` + `saves` + `deps` | **宿主专有** |
| `readinessTool.ts` | 21 | `createReadinessTool` | `pi-*` + `deps` + `readiness` + `result` | **薄适配** |
| `readiness.ts` | 12 | `renderReadiness` | `store`(type `Readiness`) | **薄适配** |

**统计**：`pi-agent-core` 在 19/23 个 agentkit 文件里出现，`pi-ai` 在 **15/23** 个里出现。工具层与 pi 的耦合是**面**而不是点。

---

## 2. `packages/core` 现在收了什么、边界怎么画的

**没有 README**。边界的事实来源有三处：`package.json` 的 description、`src/index.ts` 的再导出清单、以及每个模块头部的中文注释。

`package.json`：
> `@aivn/core` — Stage DSL spec, streaming parser, IR events, WS protocol, lineage data model

`src/index.ts`（20 个再导出，即 5 个分区）：

| 分区 | 文件（行数） | 内容 |
| --- | --- | --- |
| `dsl/` | `spec.ts` 232、`parser.ts` 634、`events.ts` 64、`effects.ts` 92、`sceneBg.ts` 37 | Stage DSL v1 冻结规范、流式解析器、IR 事件、舞台效果、纯色场 |
| `ws/` | `protocol.ts` 406、`workshopParts.ts` 90 | 客户端↔服务端消息协议、工坊消息分片 |
| `lineage/` | `model.ts` 609、`replay.ts` 254 | 行级事件日志（唯一真相源）、分支树、重放 |
| `play/` | `config.ts` 405、`assets.ts` 306、`characterCard.ts` 192、`spriteLayout.ts` 129、`framing.ts` 125、`assetLifecycle.ts` 127、`spriteStage.ts` 100、`spriteAction.ts` 63、`spriteVariants.ts` 55 | `play.json` 契约、素材表/元数据、角色卡、立绘取景/体量/排布/差分/行为词、**素材生命周期状态机** |
| `speech/` | `chunker.ts` 165、`voices.ts` 93 | 语音分句（TTS 提交单元）、音色相关 |

**边界的事实判据（比文档更硬）**：

1. `@aivn/core` **零外部 import**——`grep 'from "..."'` 在 `packages/core/src` 下**一个非相对路径都没有**，`package.json` 里**没有 `dependencies` 字段**。它连 `node:fs` 都不碰。
2. 数据进、数据出：core 里是**类型 + 纯函数 + 状态机 + 解析器**，没有实例化的 IO 服务。
3. 判据来自注释本身：`play/config.ts` 写「server 与 web 共享的跨端契约」；`play/assetLifecycle.ts` 是被 `scripts/check-agent-contract.mjs` **从源码现读状态词**的那份契约，也是 DSH 侧已经在消费的域策略。

**结论**：`core` 的边界画法是「**冻结的跨端契约 + 纯领域算法**，零依赖、零 IO」。它已经收的领域是 DSL/IR/谱系/剧目配置/素材生命周期/角色卡/语音分句；它**有意不收**的是任何需要 IO、配置、Agent 装配、传输形态的东西。

`index.ts` 是**扁平 barrel**（20 条 `export *`），没有分组命名。抽新包时如果沿用同一风格，消费者会拿到一个巨大的平权命名空间——这是可选项，不是约束。

---

## 3. 服务端的工具定义在哪、长什么样

**位置**：`apps/server/src/agentkit/`，一个工具一个文件（`*Tool.ts`），23 文件 3066 行。

**结构**（以 `imageTool.ts` 为例，327 行，全目录最大）：

```ts
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
// ↑ schema 用 pi-ai 的 TypeBox 方言（Type.Object / Type.Union / Type.Optional …）

const generateImageParams = Type.Object({ ... }, { additionalProperties: false });
// ↑ 每个字段的 description 是**字段级中文散文**（含取值表、常见差分名、用途说明）

export function createGenerateImageTool(deps): AgentTool<typeof generateImageParams> {
  return {
    name: "generate_image",
    label: "出图",
    description: "...",   // ← 工具级 DESCRIPTION，机制说明（怎么调、参数形状、同步/异步）
    parameters: generateImageParams,
    execute: async (toolCallId, params) => { /* 领域逻辑：落草稿/入库/预发射 */ },
  };
}
```

**关键事实**：

1. **schema 与描述文本都在工具文件里**，用 TypeBox 内联构造，**没有独立的 schema 注册表、没有 markdown、没有 JSON 文件**。
2. **提示词正文的分配是有纪律的**（见 `AGENTS.md`《提示词地图》与 `check-agent-contract.mjs`）：
   - **机制**（参数细节、默认值、会不会覆盖、等多久）→ 工具的 `description` + 字段 `description`；
   - **食谱**（步骤、选源、配方）→ 按需加载的 skill（`apps/server/skills/*/SKILL.md`）；
   - **身份/职责/每轮契约** → persona（`prompt.ts` / `workshop.ts`）。
   `scripts/check-agent-contract.mjs` 会**硬拦**「同一份机制同时写在 persona 与 DESCRIPTION 两处」以及「persona 里出现参数词汇（`additionalProperties`/`minLength`/`spriteId`/`Type.Object` 等）」。
3. **描述文本与领域逻辑确实是混在一个文件里的**：同一个 `*Tool.ts` 里既有中文产品散文（`description`、字段说明、文件头 30–60 行注释），也有 `execute` 里的领域调用（`playAssets.draft()` / `importFromLibrary()` / `withPlayConfigLock()`）。**没有把「文本」与「逻辑」分文件**。
4. **角色分化靠依赖联合，不靠复制**：`deps.ts` 定义 `PlaywriterKitDeps | WorkshopKitDeps` 判别联合，同一个工具在两个角色下**共用实现与 schema**，差别只有描述、等待策略、传进来的依赖。`kit.ts` 的 `createAgentKit(deps)` 是两个角色唯一的装配入口。
5. **装配面与能力面是两套目录**，都在 `kit.ts`：`CAPABILITY_CATALOG`（用户语汇的开关，一行写清 label/desc/roles/tools/writeScopes/needs）与 `TOOL_CATALOG`（工具 id → label/roles）。`kit.ts` 头部明确写了两条推导：装上的工具 = 基座工具 ∪ 开着的能力授权的工具；`can` 位 = 能力开着且它授权的工具都装得上。
6. **跨宿主契约在 `contract.ts`（351 行，零 pi 依赖）**：`CAPABILITY_MATRIX` 逐能力登记 stage-ai / dsh-aivn 两边的实现、后端依赖、**有意差异**；`TOOL_SIDE_EFFECT_CATALOG` 登记每个工具的副作用元数据（结构化布尔位）。这是**唯一一份已经在做「跨宿主共享声明」的产物**，也是抽包时最值得先读的文件。

工具数量：独立版 **24 个**（含 pi 内建的 read/write/edit/bash）；与 DSH 同名 5 个（`generate_image`/`import_asset`/`generate_bgm`/`list_voices`/`web_search`）。

---

## 4. 服务端的提示词正文在哪

**全部是硬编码 TS 字符串 / 模板函数。没有任何 `.md` 提示词文件（persona 类）**。skill 是唯一以 markdown 落地的正文。

| 正文 | 载体 | 形态 | 注入点 |
| --- | --- | --- | --- |
| 剧作家 persona（身份 / 工作循环 / Stage DSL 格式 / 新角色规则 / 记忆卡 / 演出契约） | `apps/server/src/prompt.ts` 562 行 | **硬编码模板字符串常量**：`ROLE_INTRO`(108) `HOW_I_WORK`(113) `FORMAT_RULES`(139) `MEMORY_RULES`(318) `CONTRACT_RULES`(333) `AUDIO_RULES`(25) `LIBRARY_REF`(46)；另有模板函数 `scriptLanguageSection()` `newCharacterRules(can)` `imageChapter(can)` | `buildSystemPrompt(ctx)` → `orchestrator.ts:625` 装配成 `PiAgent` 的 `systemPrompt` |
| 剧作家每轮状态区（B 区） | 同上，`renderStateSection()` | 模板函数（读盘→文本） | `orchestrator.ts:1697` 以 user 消息 `【状态】…` 注入 |
| 工坊 persona（职责 / 对话规则 / 出图要点 / 故事树 / 语言 / 备料流程 / 音色 / 写作参数 / 工作区 / digest） | `apps/server/src/workshop.ts` 574 行 | **硬编码常量 + 11 个模板函数**：`responsibilityRules()` `talkRules()` `NO_IMAGE_GUIDE` `IMAGE_BASICS` `lineageGuide()` `LINEAGE_GUIDE` `playLanguageNote()` `setupFlow()` `voicePickHint()` `writingPoints()` `digestSection()` `craftNow()` `customSection()` `workspaceSection()` `imageGuide()` | `buildWorkshopPrompt(ctx)` → `workshopSession.ts:578` 每轮现读现拼 → `runWorkshopTurn` |
| 线程摘要（压缩）系统提示词 | `workshop.ts:337` (`WORKSHOP_DIGEST_SYSTEM`)、`compaction.ts` (`EPOCH_SUMMARY_SYSTEM`) | 硬编码字符串数组 | 压缩时喂给 `completeText` |
| 出图提示词（CG / 背景 / 立绘）系统文本 | `imagePrompt.ts` 144 行 | 硬编码常量 `CG_PROMPT_SYSTEM` `BG_PROMPT_SYSTEM` `SPRITE_PROMPT_SYSTEM` + `composeImagePrompt()` | `playhouse.ts` 调 `composeImagePrompt`（`MIN_IMAGE_PROMPT_WORDS` 校验） |
| 写作参数措辞 | `craftParams.ts` 239 行 | `renderCraftParams()` —— 由 `@aivn/core` 的 `resolveCraft` 值渲染 | `prompt.ts` 的 A 区 / `workshop.ts` 的 `craftNow()` |
| 联网检索章节 | `agentkit/searchTool.ts` | `export const SEARCH_GUIDE`（一段中文 markdown 字符串） | `prompt.ts` 导入后注入 |
| 技能正文 | **`apps/server/skills/*/SKILL.md`（markdown + frontmatter）** | 4 份：`galgame-audio` 141 行、`galgame-bgm` 202 行、`galgame-play-setup` 126 行、`galgame-visual-craft` 272 行 | `skills.ts` 用 `@earendil-works/pi-agent-core` 的 `loadSkills`/`formatSkillsForSystemPrompt`；system prompt 里只列 `name`+`description`，正文靠 `read_skill` 按需读 |

**技能目录的两处事实**：

1. `read_skill` **只读 `apps/server/skills/`**（`paths.ts` 的 `workshopSkillsDirOf`，开发态 `<repo>/apps/server/skills`，打包态 `<快照>/apps/server/skills`）。`apps/server/AGENTS.md`/`check-agent-contract.mjs` 明确把这一点当守卫。
2. 仓库根还有一个 **`skills/galgame-audio/SKILL.md`**——它**改了不生效**（不在 `read_skill` 的读取路径上），且内容与 `apps/server/skills/galgame-audio/SKILL.md` **已经漂了**（description 完全不同）。`check-agent-contract.mjs:279` 把它列在 `KNOWN_NON_SKILL` 白名单里放行。提交 `90c5dda8` 曾删掉这份副本，随后被 `93bf4580` revert 回来。**抽包时这是一处必须先决策的重复**：要么收编成一个真相源，要么明确它是给别处（比如打包/发布）用的。

---

## 5. 宿主耦合点总表

### 5.1 环境变量（全部 `STAGE_` 前缀，共 **44** 个）

读点：`config.ts`（`settingsFromEnv` / `loadBootstrap`，管理绝大部分）、`cutout.ts`（抠底调参 5 个）、`index.ts`（端口/数据目录经 `loadBootstrap`）。

| 组 | 变量 |
| --- | --- |
| 启动期（**留在 env**，不进 settings.json） | `STAGE_PORT` `STAGE_HOST` `STAGE_DATA_DIR` |
| 网关 / 模型 | `STAGE_BASE_URL` `STAGE_API_KEY` `STAGE_MODEL_ID` `STAGE_MODEL_BASE` `STAGE_MODELS` `STAGE_MAX_TOKENS` `STAGE_PASSWORD` |
| 上下文压缩 | `STAGE_CONTEXT_WINDOW` `STAGE_COMPACT_RATIO` `STAGE_KEEP_RECENT_TOKENS` `STAGE_BEAT_TIMEOUT_MS` |
| 工坊压缩 | `STAGE_WORKSHOP_CONTEXT_WINDOW` `STAGE_WORKSHOP_COMPACT_RATIO` `STAGE_WORKSHOP_KEEP_RECENT_TOKENS` |
| NSFW | `STAGE_NSFW_MODEL_ID` `STAGE_NSFW_PROMPT` |
| 生图 | `STAGE_IMAGE_ENABLED` `STAGE_IMAGE_FORMAT` `STAGE_IMAGE_BASE_URL` `STAGE_IMAGE_API_KEY` `STAGE_IMAGE_MODEL` `STAGE_IMAGE_SIZE` `STAGE_IMAGE_CONCURRENCY` `STAGE_IMAGE_TIMEOUT_MS` `STAGE_IMAGE_REFERENCE` |
| 音乐 | `STAGE_MUSIC_ENABLED` `STAGE_MUSIC_BASE_URL` `STAGE_MUSIC_API_KEY` `STAGE_MUSIC_MODEL` `STAGE_MUSIC_TIMEOUT_MS` |
| TTS | `STAGE_TTS_ENABLED` `STAGE_TTS_KEYS` `STAGE_TTS_PROXY` `STAGE_TTS_BASE_URL` `STAGE_TTS_CONCURRENCY` |
| Exa | `STAGE_EXA_ENABLED` `STAGE_EXA_KEYS` `STAGE_EXA_BASE_URL` `STAGE_EXA_PROXY` `STAGE_EXA_TIMEOUT_MS` |
| 抠底调参（**仅 cutout.ts 直接读**） | `STAGE_CUTOUT_TOLERANCE` `STAGE_CUTOUT_KEY_SMOOTH` `STAGE_CUTOUT_EDGE_BAND` `STAGE_CUTOUT_SPILL` `STAGE_CUTOUT_SOLID_RESIDUAL` |
| 文档提及但代码未直接读 | `STAGE_LIBRARY_ROOT`（`library.ts` 注释提及；实际路径由 `index.ts` 传 `join(dataRoot,"library")`） |

**注意语义**：除端口/监听/数据目录这三项外，env 只是**旧版 `.env` 的一次性迁移源**。运行期唯一真相源是 `<dataRoot>/settings.json`（`settingsStore.ts`，含手改热加载）。这是宿主专有语义，抽包不要带。

### 5.2 路径约定（`<dataRoot>` 下）

```
<dataRoot>/
  plays/<playId>/            play.json, characters/, memory/{always,index}, assets/{backgrounds,cg,sprites,sfx,bgm,manifest.json}, premise.md, craft.md
  library/<kind>/<id>/       应用级只读素材资源库（+ 可选 meta.json）
  media-cache/               drafts/, sprite-sources/, web-images/, voices.json（不进 git）
  settings.json              运行期设置唯一真相源
```
只读资源：`apps/web/dist`（前端构建产物）、`apps/server/skills`（技能库）。打包形态由 `paths.ts` 的 `process.pkg` 分支处理。

### 5.3 运行形态（队列 / pendingJobs / 广播）

- **`PlayHouse`（playhouse.ts）**：`runtimes: Map<playId, PlayRuntime>`、`clientsByPlay: Map<playId, Set<send>>`、`broadcast(playId, msg)` 是唯一的服务端推送口；WS 连接在 `transport.ts`，`playhouse` 只管集合。
- **`PendingJobs`（pendingJobs.ts，144 行）**：生图/BGM/语音三条队列的**统一记账**，`begin()` 返回收尾函数；完成态 4s 退场，**失败项不自动消失**（要面板手动 dismiss）。它是纯记账类（只依赖 core 的 `PendingJob` 类型 + 一个 `emit` 回调），**是全服务端最接近「可共享」的运行形态抽象**。
- **`Limiter`（limiter.ts，84 行）**、**`withPlayConfigLock`（store.ts）**：并发/写锁。
- **`orchestrator.ts`**：一个剧目一个 `PiAgent`；轮边界、`beat_done` → `emitStop` → IR → 广播 → 落谱系；`compaction.ts` 做 token 压缩。
- **`workshopSession.ts` + `workshop.ts`**：与演出平行的工坊会话，每轮新建 Agent（systemPrompt 现读）。

### 5.4 直接 import 了宿主专有 API 的文件（关键清单）

- `express`：**无**（前提更正）。
- `ws`：`index.ts`、`transport.ts`（2 个）。
- `node:http`：`index.ts`、`http.ts`、`startup.ts`、`webAuth.ts`、`webStatic.ts`（5 个）。
- `@earendil-works/pi-agent-core`：**28 个文件**（全部 19 个 `*Tool.ts` + `kit.ts`/`deps.ts`/`playEnv.ts`/`piTools.ts`/`result.ts` + `orchestrator.ts`/`playhouse.ts`/`workshop.ts`/`workshopSession.ts`/`compaction.ts`/`llm.ts`/`imagePrompt.ts`/`skills.ts`/`translate.ts`）。其中 **6 个文件在运行时 import 了 `Agent` 实体 / pi 内建工具工厂 / token 计数器**（不是 type-only）：`orchestrator.ts`(`Agent as PiAgent`)、`workshop.ts`(`Agent`)、`agentkit/piTools.ts`(`createReadTool/createWriteTool/createEditTool/createBashTool/BACKGROUND_CONTEXT`)、`agentkit/playEnv.ts`(`NodeExecutionEnv/err/ok/FileError`)、`skills.ts`(`loadSkills/formatSkillsForSystemPrompt/BACKGROUND_CONTEXT`)、`compaction.ts`(`calculateContextTokens/estimateContextTokens/estimateTokens`)。其余多数只是 `import type { StreamFn }` 这类纯类型依赖（`llm.ts`/`translate.ts`/`playhouse.ts`/`workshopSession.ts`/`imagePrompt.ts`）。
- `@earendil-works/pi-ai`：24 个文件（工具 schema 的 `Type`/`Static` + `Model`/`Api` 类型）。
- 直接 import `config.ts`：**10 个文件**；`paths.ts`：4 个；`orchestrator.ts`：2 个（`playhouse.ts`、`rebuild.ts`）；`playhouse.ts`：3 个（`index.ts`、`http.ts`、`transport.ts`）。

---

## 6. 判断：抽共用包时，哪些是真共享面、哪些是宿主专有

### 6.1 真共享面（按把握从高到低）

| 候选 | 文件 | 理由 | 抽取动作 |
| --- | --- | --- | --- |
| **图像画幅/档位/画布数学** | `imageBackend.ts`(168) + `imageMime.ts`(27) | 零外部依赖、零宿主耦合；文件头自己写着「两条调用方共用它」 | **可原样搬** |
| **三家生图协议适配器** | `geminiImage.ts` + `openaiImage.ts` + `modelslabImage.ts`(515) | 只认 `undici` + `imageBackend`，配置由构造参数注入 | **可原样搬**（带 `undici` 依赖） |
| **跨宿主能力/副作用契约** | `agentkit/contract.ts`(351) + `agentkit/role.ts`(27) | 全 agentkit 里**唯一零 pi 依赖**的两个文件，内容就是两宿主契约 | **可原样搬**（它本来就是为这件事写的） |
| **写作参数渲染** | `craftParams.ts`(239) | 只 import core 的 `CRAFT_*`；唯一的宿主耦合是一个 `AgentCapabilities` **类型**（可改成参数化的 `can` 接口） | 摘掉类型接缝后搬 |
| **平台无关的提示词正文** | `prompt.ts` 的常量与模板函数 / `workshop.ts` 的提示词常量 / `agentkit/searchTool.ts` 的 `SEARCH_GUIDE` / `imagePrompt.ts` 的三个 `*_PROMPT_SYSTEM` | 正文是产品资产、两宿主会重复维护；但**同一文件里混着装配逻辑**（`buildSystemPrompt` 依赖 `PlayMemory` 实例） | **劈开**：文本进包，装配留宿主 |
| **技能正文** | `apps/server/skills/*/SKILL.md`（4 份 741 行） | 是纯 markdown，与宿主无关 | 可搬（但要先解决根目录那份重复副本） |
| **素材生命周期/元数据/立绘取景/角色卡/剧目配置** | 已在 `packages/core` | 已经在共享，不需要动 | — |
| **纯记账抽象（弱候选）** | `pendingJobs.ts`(144) | 只依赖 core 的 `PendingJob` 类型 + 一个 emit 回调，逻辑宿主无关 | 值得评估，但两边任务生命周期不同，优先级低 |
| **图像提示词系统文本（弱候选）** | `imagePrompt.ts` 的常量 | 文本可共享；`composeImagePrompt` 依赖宿主 `completeText` | 只搬常量 |

### 6.2 宿主专有（不该进共享包）

| 文件/组 | 理由 |
| --- | --- |
| `playhouse.ts`(1420)、`orchestrator.ts`(2460) | 运行时总装配：runtime 地图、WS 客户端集合、演出循环、NSFW 通道、设置热重建。ADR §5 已经点名 `PlayHouse`/`LineageTree`/saves 不该进包 |
| `index.ts`(174)、`http.ts`(629)、`transport.ts`、`configApi.ts`(211)、`webAuth.ts`、`webStatic.ts`、`lanAccess.ts`、`startup.ts`、`cli.ts` | 传输与进程形态（node:http + ws + Basic 认证 + 静态服务 + 防火墙）。**另一宿主是 host route + SSE，没有可共享面** |
| `paths.ts`(69)、`config.ts`(495)、`settingsStore.ts`(581)、`provider.ts`(186)、`llm.ts`(70) | 这台宿主的部署形态与凭据模型（`process.pkg`、`settings.json` 唯一真相源、`STAGE_*` 迁移语义） |
| `playAssets.ts`(1250)、`playMusic.ts`、`musicFactory.ts`、`musicBackend.ts`、`assetImport.ts`、`assetRef.ts`、`webImage.ts`、`limiter.ts`、`store.ts`(581)、`saves.ts`(205)、`voiceCatalog.ts`、`tts.ts`、`voice.ts`、`exa.ts`、`history.ts`、`compaction.ts`、`rebuild.ts`、`translate.ts`、`selftest.ts`、`workshop*.ts`、`skills.ts` | 完整媒体后端、队列与存储、会话/线程模型、宿主 IO 服务。ADR §5：「完整媒体后端」只共享**目标、状态、错误语义**，队列与存储各随宿主 |
| `agentkit/` 全部 `*Tool.ts` + `kit.ts` + `deps.ts` + `playEnv.ts` + `piTools.ts` + `result.ts` | 工具装配的形状由宿主的权限模型、会话模型、预设机制决定（ADR 的核心论断）。19/23 文件直接 import `pi-agent-core` |
| `cutout.ts`(598) | 算法本身可移植，但带 `sharp` 原生依赖 + 5 个 `STAGE_CUTOUT_*` 直接读 env；进共享包会把原生二进制与宿主命名约定一起带过去。**建议：先摘 env（改成参数），再按需决定** |
| `imageFactory.ts`(24)、`generatedLedger.ts`(32)、`library.ts`(152)、`playFiles.ts`(290)、`memory.ts`(283) | **边界态**：逻辑宿主无关，但签名吃 `ServerConfig`/`PlayStore` 类型，且绑定 `<dataRoot>` 目录布局与 URL 前缀。要共享必须先定义「宿主提供的存储接缝」接口 —— 这是本次抽包**真正的工作量所在** |

### 6.3 抽包会牵动的服务端调用点（import 数量级）

现状基线：`apps/server/src` 里 **`@aivn/core` 共 39 条 import 语句，分布在 28 个文件**（最重的 `orchestrator.ts` 4 条、`workshopSession.ts`/`playhouse.ts` 各 3 条）。

按候选包统计「改一个 import 路径要动多少处」：

| 若抽出… | 受影响的服务端 import 语句 | 受影响文件 |
| --- | --- | --- |
| 图像管线（`imageBackend`+三后端+`imageMime`+`cutout`+`imageFactory`） | **约 15 条**（`imageBackend` 8 文件、`imageMime` 3、`cutout` 2、`imageFactory`+三后端各 1） | 约 10 个 |
| 素材/剧目文件层（`library`+`playFiles`+`memory`+`assetImport`+`assetRef`+`generatedLedger`+`playAssets`） | **约 32 条**（`library` 9、`playFiles` 9、`playAssets` 8、`memory` 7、`assetImport` 3、`assetRef` 2、`generatedLedger` 2） | 约 20 个 |
| 提示词/写作参数（`prompt`+`craftParams`+`workshop`+`searchTool` 文本+`imagePrompt`） | **约 8 条**（`craftParams` 3、`prompt` 1、`imagePrompt` 1、`searchTool` 1、`workshop` 2） | 约 6 个 |
| 跨宿主契约（`contract`+`role`） | **约 3 条** | 2–3 个 |
| 配置/路径/传输/运行时（若也抽） | **40+ 条** | 25+ 个 |

**数量级结论**：
- 抽**图像管线 + 契约 + 提示词文本**：改动面 **≈25–30 条 import、≈15 个文件**，可控，且不触碰运行时核心。
- 抽**素材/剧目文件层**：改动面 **≈30 条 import**，但**真正成本不在改 import，而在为 `PlayStore`/`ServerConfig`/目录布局设计宿主接缝**——这一步会牵动 `store.ts`(581)、`playhouse.ts`(1420)、`orchestrator.ts`(2460) 的构造签名。
- 抽**配置/传输/运行时**：等于把宿主整个搬走，与 ADR §5 的「不该进」清单正面冲突。

### 6.4 与既有 ADR 的关系（务必先决策）

`docs/features/261008-aivn-dual-host/261008-aivn-dual-host.shared-package.adr.md`（今天早些时候，`75e8d74d`）的结论是**不抽**，并给出三条重新评估的触发条件：① 出现第三个宿主；② DSH 的 tool metadata 演进到与独立版同构；③ 出现「要在没有兄弟仓的情况下构建 DSH」的真实接收方（那种情况解法是 `vendor/` tarball，**不是新包**）。

本次任务的目标（在 `stage-ai/packages/` 下抽共用包）**没有明说命中上述哪一条**。盘点得到的事实支持以下判断：

- 若抽的是**图像管线 + 跨宿主契约 + 提示词正文**：这与 ADR 的精神**不冲突**（ADR 反对的是抽「Agent 装配」，而这三块不是装配），可以推进。
- 若抽的是**工具层 / capability schema / 结果类型**：直接落在 ADR 逐项否掉的四个候选上，需要先修订 ADR 并说明触发条件变了。
- 无论抽哪一块，都有一道**新增的漂移风险**：DSH 的 `lib/` 是受跟踪构建产物（`build.mjs --check` 硬判字节），多一层包输入 = 多一处静默漂移。ADR 把这条列为「新包会亏」的第一条理由，本次抽包方案必须给出应对（例如把 `build.mjs --check` 的输入纳入版本指纹）。

### 6.5 抽包时应当保留的守卫

- `scripts/check-agent-contract.mjs`（7 项检查）当前**从 `packages/core/src/play/assetLifecycle.ts` 现读状态词**、扫 `prompt.ts`/`workshop.ts`/`craftParams.ts` 三份提示词、扫 `apps/server/skills`。**这些路径一旦移动，守卫会静默失准**——抽包必须同步改这个脚本的常量，否则它从「真的会拦人的关卡」退化成一份说明书。
- `agentkit/contract.ts` 的 `CAPABILITY_MATRIX` 与 `TOOL_SIDE_EFFECT_CATALOG` 是现有最完整的跨宿主边界声明，抽包时应作为**输入**而不是被取代。

---

## 7. 附录

### 7.1 依赖矩阵（谁 import 谁）

| 模块 | node 内置 | npm | `@aivn/core` | pi-agent-core / pi-ai | 宿主内部 |
| --- | --- | --- | --- | --- | --- |
| `imageBackend` `imageMime` `cutout`* | — / — / — | — / — / **sharp** | — | — | — |
| `geminiImage` `openaiImage` `modelslabImage` | — | **undici** | — | — | `imageBackend` |
| `imageFactory` | — | — | — | — | `config`(t) + 三后端 |
| `imagePrompt` | — | — | — | **两者(type)** | `llm` |
| `craftParams` | — | — | ✔ | — | `kit`(t) |
| `prompt` | — | — | ✔ | — | `craftParams` `kit`(t) `searchTool` `memory`(t) |
| `playFiles` `memory` `library` `generatedLedger` | ✔ fs/path(/crypto) | — / **minisearch** / — / — | ✔ | — | `store`(t) |
| `assetImport` `assetRef` | ✔ fs/path | — | ✔ | — | `library` `playFiles` `store` `workshop`(t) `memory` |
| `playAssets` | ✔ crypto/fs/path | — | ✔ | — | `imageBackend` `cutout` `imageMime` `limiter` `memory` `pendingJobs` `playFiles` `store` `webImage` `deps`(t) |
| `paths` `config` `configApi` | ✔ path(/fs) | — | — | — | `imageBackend` `limiter` / `lanAccess` `startup` `settingsStore` |
| `orchestrator` | — | — | ✔(4 条) | **两者(实体)** | 12 个内部模块 |
| `playhouse` | ✔ fs/path | — | ✔(3 条) | **两者(type)** | 20+ 个内部模块 |
| `index` `http` `transport` | ✔ http/fs/path/url | **ws** | ✔ | — | 10+ 个内部模块 |
| `agentkit/contract.ts` `role.ts` | — | — | — | **无** | `role` |
| `agentkit/*Tool.ts` (19 个) | 3 个用 fs/path | — | 5 个用 | **19/23 用 core，17/23 用 ai** | `deps`/`result`/宿主服务 |
| `packages/core`（全部 21 文件） | **无** | **无** | — | — | — |

### 7.2 文件行数速查（按任务书顺序）

```
imageBackend 168   imageMime 27    geminiImage 167  openaiImage 154  modelslabImage 194
cutout 598         imagePrompt 144  imageFactory 24
playAssets 1250    assetImport 259  assetRef 188     generatedLedger 32  library 152
craftParams 239    prompt 562       playFiles 290    memory 283
paths 69           config 495       configApi 211
orchestrator 2460  playhouse 1420   index 174        http 629
agentkit 3066 行 / 23 文件：kit 537  contract 351  deps 128  imageTool 327  libraryTool 255
          craftTool 157  lineageTool 134  memoryTool 134  musicTool 133  playEnv 131
          viewTool 109  voiceTool 106  recutTool 99  beatTool 92  nsfwTool 69
          piTools 64  searchTool 64  commitTool 64  skillTool 36  role 27
          readinessTool 21  result 16  readiness 12
（合计 78 文件 / 19122 行；另有 store 581 / workshop 574 / workshopSession 612 / compaction 406 / saves 205 等未在任务书列表内但被反复引用）
```

### 7.3 其他候选（未在任务书列表，但抽包时躲不开）

`store.ts`(581)、`saves.ts`(205)、`pendingJobs.ts`(144)、`limiter.ts`(84)、`workshop.ts`(574)、`workshopSession.ts`(612)、`workshopThreads.ts`、`compaction.ts`(406)、`rebuild.ts`、`history.ts`、`llm.ts`(70)、`provider.ts`(186)、`translate.ts`、`voice.ts`(133)、`tts.ts`(163)、`voiceCatalog.ts`、`musicBackend.ts`/`musicFactory.ts`/`playMusic.ts`、`exa.ts`(113)、`webImage.ts`(187)、`skills.ts`(48)、`settingsStore.ts`、`lanAccess.ts`、`startup.ts`、`webAuth.ts`、`webStatic.ts`、`cli.ts`/`cli-cutout.ts`、`selftest.ts`、`transport.ts`、`imageMime` 之外还有 `assetRef` 等。

---

*盘点方式：全量读 `packages/core/src` 与 `apps/server/src` 的 import/export 图谱、逐文件行数与头部契约注释、`agentkit` 全目录、`skills/` 与 `apps/server/skills/` 正文，并交叉核对 `docs/features/261008-aivn-dual-host/*`、`scripts/check-agent-contract.mjs`、`apps/server/AGENTS.md`。未修改任何被盘点文件。*
