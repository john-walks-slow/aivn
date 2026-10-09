# dsh-aivn 插件侧代码盘点（跨仓共享面抽取前期调研）

- **被盘点仓库**：`/root/projects/dsh-aivn-shared`（worktree，内容 = 主检出 master 同源）
- **分支 / HEAD**：`feat/shared-aivn-core` @ `e832b35`
- **盘点范围**：`src/media/`、`src/tools/`、`src/tool-catalog.ts`、`src/preset-tools.ts`、`src/play/`、`src/playwriter/`、`src/stagehand/`、`skills/`、`src/style/`、`src/voice/`
- **只读**：未修改任何被盘点文件；`scripts/`（未跟踪）为 worktree 辅助脚本，与本任务无关。
- **范围体量**：56 个文件、约 8165 行（含 skills 425 行 markdown）。

> 术语：**宿主** = DSH（cordis / dsh-tools / dsh-llm / dsh-system-prompt / dsh-agent-preset-registry）。
> **领域** = AIVN 视觉小说语义（剧目、素材、Stage DSL、提示词）。
> 归类三档：`纯领域`（不碰宿主 API，可直接进包）/ `薄适配`（主体领域，一两处宿主接线）/ `宿主专有`（就是 DSH 接线）。

---

## 0. 依赖面总览

### 0.1 外部依赖种类（全范围）

| 类别 | 出现在 | 说明 |
|---|---|---|
| node 内置 | `node:fs` `node:fs/promises` `node:path` `node:crypto` `node:dns/promises` `node:net` `node:url` | 落盘、路径、UUID、下载前的 SSRF 校验 |
| npm | **`sharp`**（仅 `src/media/cutout.ts`） | 抠底的唯一图像处理依赖 |
| `@aivn/*` | **`@aivn/core`**（14 个文件，见下） | 契约与解析器（`parsePlayConfig` / `parseCharacterCard` / `spriteIdOf` / `describeAsset` / `languageLabel` / `CRAFT_*` / `resolveCraft` / `ASSET_DRAFT_RETENTION_DAYS` / `COMMON_SPRITE_VARIANTS` / `DEFAULT_SPRITE_FRAMING` / `SPRITE_FRAMING_ASPECT` / `PhraseChunker` / `EndingAttrs` 等） |
| `@aivn/stage` | **本范围内无** | 只被浏览器半边 `src/client/` 用（构建期） |
| `@deepseek-ai/*` | **13 个文件**（见 0.2） | 宿主 API |

`@aivn/core` 的 14 个导入点：`media/{types,prompts,target,generate,generate-tool,draft-store,catalog}.ts`、`play/{play,play-context,ledger,craft,assets}.ts`、`stagehand/context.ts`、`voice/voice.ts`。

### 0.2 直接 import DSH 宿主 API 的文件（重点标记）

| 文件 | 导入的宿主包 | 用到的宿主面 | 性质 |
|---|---|---|---|
| `src/tools/*.ts`（9 个） | `dsh-tools`（`defineTool`）、部分 `dsh-llm`（`ContentBlock` 类型） | 工具定义工厂 + 输出 render 契约 | **薄适配** |
| `src/media/generate-tool.ts` | `dsh-llm`（`ContentBlock` 类型） | `textOutput` / `render` 返回 `ContentBlock[]` | 薄（类型+输出形状） |
| `src/play/play-context.ts` | `cordis`（`Context` 类型）、`dsh-system-prompt`（空类型导入） | `systemPrompt.section()` / `.context()` 注册动态段 | **薄适配**（主体 400 行是纯文本渲染） |
| `src/playwriter/preset.ts` | `cordis`、`dsh-agent-preset-registry` | `ctx.agentPresets.register()` + 预设行集（点名 `dsh-persona` / `dsh-tool-fs` / `dsh-skill` 等宿主插件） | **宿主专有** |
| `src/stagehand/context.ts` | `cordis`（`Context` 类型） | `systemPrompt.section()` | **薄适配** |
| `src/preset-tools.ts` | `cordis`、`dsh-agent`、`dsh-agent-preset-registry`、`dsh-session`、`dsh-tools` | `ctx.on('agent/created')` / `agentPresets.composedPreset` / `agent.ctx.tools.register` / `systemPrompt.section` | **宿主专有** |

> `src/tool-catalog.ts` 只 `import type { ToolDefinition }`（类型擦除，运行时零依赖），但 `withConcurrency()` 写 `isConcurrencySafe` 是 DSH 调度契约 → 归薄适配。

### 0.3 环境变量

| 变量 | 位置 | 语义 |
|---|---|---|
| `DSH_AIVN_CUTOUT_TOLERANCE` / `_KEY_SMOOTH` / `_EDGE_BAND` / `_SPILL` / `_SOLID_RESIDUAL` | `src/media/cutout.ts:123–137` | 五个抠底调参的进程级兜底（**唯一在范围内的 env 读取点**） |
| `DSH_AIVN_TTS_KEYS`、`DSH_AIVN_EXA_KEYS` | `src/index.ts:46,56`（范围外，但决定 `list_voices`/`web_search` 门控） | 逗号分隔，配置优先、env 兜底 |

### 0.4 网络调用点（范围内）

| 文件 | 调用 |
|---|---|
| `src/media/gemini-image.ts:79` | `fetch` Gemini `:generateContent` |
| `src/media/openai-image.ts:61,121` | `fetch` `/v1/images/generations` + 下载远端 url |
| `src/media/modelslab-image.ts:133,159` | `fetch` text2img/img2img + `base64_to_url` + 下载 |
| `src/media/music.ts:66` | `fetch` Gemini 音频 |
| `src/media/web-image.ts:36` | `fetch` 参考图（带 DNS/私网地址校验） |
| `src/voice/tts.ts:104` | `fetch` Fish `/v1/tts` |
| `src/voice/voice-catalog.ts:130` | `fetch` Fish 音色库 |

全部走全局 `fetch`（DSH 进程带环境代理），**没有** `node:http` / axios / WebSocket。

### 0.5 落盘路径约定（领域常量，跨仓必须一致）

`play.json` · `theme.json` · `endings.json` · `assets/{backgrounds,cg,sprites/<id>,bgm,sfx}/` · `assets/manifest.json` · `assets/generated.json`（台账）· `media-cache/drafts/<uuid>/` · `media-cache/sprite-sources/<id>/` · `media-cache/tts/` · `memory/always/{premise.md,craft.md,state/}` · `memory/index/<层>/` · `characters/<id>.md`。

---

## 1. `src/media/` —— 抠底、生图后端与协议、提示词后缀、素材落库（22 文件 / 3257 行）

| 文件 | 行 | 导出 | 外部依赖 | 宿主耦合点 | 归类 |
|---|---|---|---|---|---|
| `cutout.ts` | 613 | `cutout`、`resolveTuning`、`defaultTuning`、`CutoutResult/CutoutOptions/CutoutTuning` | **`sharp`**；无 node/宿主导入 | 读 `DSH_AIVN_CUTOUT_*` 五个 env（仅此处）；纯图像处理；注释注明「以上游为准重抄」 | **纯领域** |
| `image.ts` | 178 | `IMAGE_ASPECTS/SIZES`、`parseImageSize`、`imageSizeText`、`tierArea`、`higherTier`、`extOf`、`sniffImageMime`、`sizeOfImage`、`aspectMatches`、`ImageRequest/GeneratedImage/ImageBackend/ImageSizeSpec` | 无 | 无（注释说明配置键改名 `image.*`、走全局 fetch） | **纯领域** |
| `gemini-image.ts` | 156 | `GeminiImageGen`、`GeminiImageOptions` | `node:fetch` | 网络；构造入参 `{baseUrl,apiKey,model,size,timeoutMs}` 由 `backends.ts` 注入 | **纯领域** |
| `openai-image.ts` | 137 | `OpenAiImageGen`、`OpenAiImageOptions` | 同上 | 同上 | **纯领域** |
| `modelslab-image.ts` | 180 | `ModelsLabImageGen`、`ModelsLabImageOptions` | 同上 | 同上 | **纯领域** |
| `music.ts` | 106 | `GeminiMusicGen`、`MusicRequest/GeneratedMusic/MusicBackend/GeminiMusicOptions` | 无 | 网络 | **纯领域** |
| `backends.ts` | 105 | `createMediaBackends`、`createImageBackend`、`requireImageBackend`、`requireMusicBackend`、`IMAGE_FORMATS`、`ImageConfigShape`、`MusicConfigShape`、`MediaBackends` | `./*` 后端 | 配置来源 = 插件配置（由 `index.ts` 组装后传入）；「配全才算有」的判定 | **纯领域**（纯工厂，可整搬） |
| `types.ts` | 153 | `AssetKind/LedgerKind/KeyBackgroundColor/AssetTarget/DraftedAsset/GeneratedAsset/LedgerEntry/AssetSpec/ResolvedReference/DraftRecord/PlayAssetsOptions` | `@aivn/core`（type） | 无 | **纯领域** |
| `prompts.ts` | 193 | `KEY_BACKGROUND_COLORS`、`DEFAULT_KEY_COLOR`、`isKeyBackgroundColor`、`NEUTRAL_LEAD`、`suffixFor`、`genericReferenceSuffix` | `@aivn/core` | 无（提示词后缀纯函数） | **纯领域** |
| `target.ts` | 215 | `NEUTRAL`、`MAX_REFERENCES`、`assertStem`、`resolve`、`references`、`referencesGeneric`、`intentOf`、`spriteStems`、`existingAsset`、`mimeOfBuffer` | `node:fs` `node:path`、`@aivn/core`、`../play/assets`、`./web-image` | 读盘（existsSync/readdir）、读 `characters/` 与 `assets/manifest.json`、网络（垫图网址） | **纯领域** |
| `storage.ts` | 72 | `withFileLock`、`writeAtomic`、`readJson`、`writeJsonLocked` | `node:crypto/fs/path` | 无；**模块级按路径的文件锁**（并发契约，搬包时须保留语义） | **纯领域** |
| `draft-store.ts` | 122 | `DRAFT_TTL_MS`、`draftDir`、`newDraftId`、`writeDraft`、`readDraftImage/readDraftSource`、`loadDraft`、`markCommitted`、`pruneDrafts`、`DraftPlan/DraftFiles` | `node:crypto/fs/path`、`@aivn/core` | 草稿区 `media-cache/drafts/` 落盘 | **纯领域** |
| `catalog.ts` | 113 | `persist`、`keepSource`、`declareSprite`、`declareDescription`、`declareBgmSource`、`recordPrompt`、`recordLedger`、`withManifest` | `node:crypto/fs/path`、`@aivn/core`、`../play/assets`、`./storage` | 写 `assets/`、`manifest.json`、`generated.json`、`sprite-sources/` | **纯领域** |
| `generate-image.ts` | 142 | `draft`、`createGeneric`、`DraftOptions` | `@aivn/core`、`../play/play` | 写草稿区；**读 `play.json` 的 `image` 段**决定 model/size | **纯领域** |
| `generate.ts` | 105 | `generate`、`ensureNeutral`、`exists` | `@aivn/core` | 模块级 `generationInflight` 去重表；读盘/落盘 | **纯领域** |
| `commit.ts` | 41 | `commit` | 无 node 直接导入 | 走 catalog/draft-store 落盘 | **纯领域** |
| `import.ts` | 58 | `register` | `node:fs` `@aivn/core` | 落盘 + 网络（网页图） | **纯领域** |
| `cut.ts` | 50 | `cutFile`、`CutResult` | `node:fs/path`、`../play/assets`、`./cutout` | 落盘（`writeAtomic`） | **纯领域** |
| `bgm.ts` | 40 | `generateBgm` | `node:fs/path` | 落盘 `assets/bgm/`；网络由后端 | **纯领域** |
| `web-image.ts` | 155 | `fetchWebImage`、`WebImage` | `node:dns/promises` `node:net` | 网络（含 SSRF 私网地址拦截、重定向上限） | **纯领域** |
| `assets.ts` | 110 | `PlayAssets`（类）、`playAssetsOf`、重导出 `AssetKind/AssetTarget/DraftedAsset/GeneratedAsset/KeyBackgroundColor/LedgerEntry/LedgerKind/PlayAssetsOptions` | 无宿主 | **use-case 装配层**：`dir + 后端 + 调参` 现建实例，无全局态 | **纯领域** |
| `generate-tool.ts` | 213 | `IMAGE_PARAMETERS`、`PROMPT_RULES`、`REFERENCE_RULE`、`textOutput`、`ImageArgs`、`toTarget`、`genericResult`、`generatedResult`、`existingNote` | `@aivn/core`、`dsh-llm`（`ContentBlock` 类型） | 仅 `textOutput.render` 返回 DSH 输出契约 | **薄适配** |

**媒体层结论**：除 `generate-tool.ts` 一处 `ContentBlock` 类型/输出形状外，整层与宿主零耦合。出图/音乐后端的配置面是**构造入参**（`{baseUrl,apiKey,model,size,timeoutMs}`），与插件配置解耦——搬包时保持这个形状即可。

---

## 2. `src/tools/`（9 工具 + context）+ `tool-catalog.ts` + `preset-tools.ts`

### 2.1 九个工具的构成拆解（schema + 描述文本 + use-case 编排 vs `defineTool` 接线）

每个工具都是同一形状：`const DESCRIPTION = [...]` 字面量 → `createXxxTool(ctx, deps)` → `defineTool({ name, description, parameters, output, execute })`。

| 文件 | 行 | 描述文本区 | 参数 schema 区 | `execute` 编排 | **DSH 专有行** |
|---|---|---|---|---|---|
| `generate-image.ts` | 56 | 16–22（7） | 28–46（19） | 48–54（7）：`playAssetsOf` → `createGeneric` → `genericResult` | import×1 + 包裹×2 + `output: textOutput`×1 ≈ **4** |
| `generate-asset.ts` | 54 | 23–32（10） | 38–41（4） | 43–52（10）：`toTarget` → `exists`／`generate` | ≈ **4** |
| `generate-bgm.ts` | 51 | 16–23（8） | 29–37（9） | 39–48（10）：`generateBgm` → 回执 | ≈ **4** |
| `cut.ts` | 76 | 14–27（14） | 33–48（16） | 50–74（25）：`cutFile` → 体检文案 | ≈ **4** |
| `import-asset.ts` | 92 | 16–24（9） | 47–79（33） | 81–90（10）：`register`；另有纯函数 `targetFromArgs` 26–41 | ≈ **4** |
| `list-voices.ts` | 129 | 23–31（9） | 42–63（22） | 65–115（51）：`catalog.list` 本地筛/排序/分页；`render()` 119–128 纯函数 | ≈ **6** |
| `set-stage-style.ts` | 111 | 23–45（23） | 66 引用 `PARAMETERS`（58–60 由 `STYLE_TOKENS` 生成） | 71–109（39）：校验 → 写 `theme.json` → `ctx.broadcastStyle` | ≈ **6**（含 `ParameterPropertySpec/SchemaSpec` 类型） |
| `validate-play.ts` | 35 | 16–20（5） | `{}` | 31–33（3）：`readPlayReadiness` → `renderReadiness` | ≈ **6**（import×2 + 内联 output 4） |
| `web-search.ts` | 54 | 14–20（7） | 31–38（8） | 40–52（13）：`exa.search` → 拼文本 | ≈ **6** |

**结论（关键）**：九个工具里 **DSH 专有代码恒为 4–6 行**（两行 import、`return defineTool({` / `});`、一处 `output` render 块）。其余全部是：
- **描述文本**（约 20–45%）——纯字符串，是提示词层的一部分，与宿主无关；
- **参数 schema**（约 10–55%）——纯数据对象，只依赖 `dsh-tools` 的**参数形状约定**（`{type, required, enum, description}`），不是 API 调用；
- **`execute` 编排**（约 10–40%）——调用领域服务（`PlayAssets` / `readPlayReadiness` / `style-tokens` / `VoiceCatalog` / `Exa`）并拼回执文本。

也就是说：工具的**语义 100% 是领域**，宿主接线只剩一个 `defineTool` 壳。抽包的可行做法是「把 `DESCRIPTION` + `parameters` + 编排函数搬进包，插件侧只保留一个 `defineTool` 适配器」。

### 2.2 `src/tools/context.ts`（26 行）

- 导出：`PlayContext`（接口）。
- 依赖：`import type { StageHub } from '../hub'`。
- 耦合：`hub`（舞台事件中枢）、`sessionId`、`playDir()`（会话工作目录）、`broadcastStyle()`（向同剧目所有舞台会话广播）。**每一条都是宿主运行期概念**。
- 归类：**宿主专有**。（但注意：工具 `execute` 只用到 `ctx.playDir()`；`hub`/`sessionId`/`broadcastStyle` 仅 `set-stage-style` 用其一。）

### 2.3 `src/tool-catalog.ts`（153 行）

- 导出：`TOOL_CATALOG`、`TOOL_IDS`、`ToolGate`、`ToolSpec`、`withConcurrency`、`gateSatisfied`。
- 依赖：`import type { ToolDefinition } from '@deepseek-ai/dsh-tools'`（类型）。
- 耦合：`ToolSpec.concurrent` → `withConcurrency()` 写 `isConcurrencySafe`（DSH 并行池契约）；`gateSatisfied` 的入参 `{image,music,tts,search}` 来自插件能力位。
- 归类：**薄适配**。表数据（id / job / sideEffects / concurrent / gate）是**跨仓共享的单一真相源**，应进包；`withConcurrency` 这个「声明→DSH 定义」的一步留在插件。

### 2.4 `src/preset-tools.ts`（286 行）

- 导出：`installPresetTools`、`ToolDeps`、`ToolRuntime`、`PresetToolsHost`、`DisabledTools`。
- 依赖：`cordis`、`dsh-agent`、`dsh-agent-preset-registry`、`dsh-session`、`dsh-tools`（多为类型），以及 `hub` / `session` / `capabilities` / `exa` / `voice-catalog`。
- 耦合：`ctx.on('agent/created')`、`ctx.on('agent-preset/selected')`、`ctx.agents.list/get`、`agent.ctx.tools.register`、`agent.ctx.effect`、`agent.ctx.systemPrompt.section`、`agent.session.header.cwd`；工具 builders 表（`buildTool` switch）。
- 归类：**宿主专有**。它是「AIVN 工具面 ↔ DSH 工具注册」的唯一接缝，抽包后应保留为薄装配（只 retain `buildTool` 表 + `defineTool` 适配）。

---

## 3. `src/play/` —— 剧目数据层与 A 区注入（9 文件 / 1491 行）

| 文件 | 行 | 导出 | 外部依赖 | 宿主耦合点 | 归类 |
|---|---|---|---|---|---|
| `play.ts` | 63 | `PLAY_FILE`、`Play`、`loadPlay`、`loadPlaySync` | `node:fs/path`、`@aivn/core` | 无（读 `play.json`；错误信息带文件名的口径是领域契约） | **纯领域** |
| `play-context.ts` | 474 | `readPlaySnapshot`、`registerPlayContext`、`PlaySnapshot`、`readVoiceMap` | `node:fs/path`、`@aivn/core`、`cordis`(type)、`dsh-system-prompt`(type)、`../playwriter/prompt` | **`registerPlayContext` 用 `agentCtx.systemPrompt.section/context`**（含 `ORDER` 段序、`TTL_MS` 缓存、`CONTEXT_ORDER`）；`readPlaySnapshot` 及其下 ~400 行渲染为纯领域（含 `readVoiceMap` 12h 缓存） | **薄适配**（应按 `read*Snapshot` / `register*` 切两半） |
| `play-files.ts` | 79 | `PLAY_FILES`（纯文本常量，含 `{{cwd}}` 占位） | **无任何 import** | 无 | **纯领域** |
| `play-state.ts` | 27 | `PLAY_STATE_DIR`、`resetPlayState` | `node:fs/path` | 无（新周目重置 `memory/always/state/*`） | **纯领域** |
| `craft.ts` | 159 | `resolveCraft`（re-export）、`assetCapabilitiesOf`、`renderCraftParams`、`CRAFT_ENUMS`、`AssetCapabilities` | `@aivn/core` | 无（能力位由调用方传 `{image}` 布尔） | **纯领域** |
| `assets.ts` | 124 | `listAssets`、`readManifest`、`characterNames`、`resolveInPlay`、`contentTypeOf`、`AssetIndex` | `node:fs/path`、`@aivn/core` | 无（同步读盘，因提示词段同步求值） | **纯领域** |
| `ledger.ts` | 216 | `EndingsLedger`、`readLedger`、`ledgerPath`、`LEDGER_FILE`、`EndingRecord`、`EndingsLedgerData` | `node:crypto/fs/path`、`@aivn/core`（`EndingAttrs`） | 无（`endings.json` 原子写；告警出口是注入的 `onWarn` 回调，不是 logger 直连） | **纯领域** |
| `readiness.ts` | 201 | `readPlayReadiness`、`renderReadiness`、`PlayReadiness` | `node:fs/path`、`./assets`、`./craft`、`./play` | 无 | **纯领域** |
| `scaffold.ts` | 148 | `scaffoldPlay`、`PlaySpec`、`PlayCharacterSpec`、`ScaffoldResult` | `node:fs/promises`、`node:path` | 无（`/new-play` 命令用，但函数本身零宿主） | **纯领域** |

---

## 4. `src/playwriter/` 与 `src/stagehand/`（4 文件 / 748 行）

| 文件 | 行 | 导出 | 外部依赖 | 宿主耦合点 | 归类 |
|---|---|---|---|---|---|
| `playwriter/prompt.ts` | 295 | `PLAYWRITER_PROMPT`、`playwriterTail({image})` | `../play/play-files` | 无（纯提示词正文：身份 / 格式 / 结局 / 记忆卡 / 契约 / 缺图指针） | **纯领域** |
| `playwriter/preset.ts` | 152 | `registerPresets`、`PresetRegistry` | `node:path/url`、`cordis`(type)、`dsh-agent-preset-registry`(type)、`../session`、`../stagehand/prompt`、`./prompt` | **`ctx.agentPresets.register()`**；行集点名 `dsh-persona`/`dsh-tool-bash`/`dsh-tool-fs`/`dsh-tool-fs-search`/`dsh-skill`/`dsh-skill-filesystem`/`dsh-tool-skill`；`SKILLS_DIR = <pkg>/skills` 路径解析（`import.meta.url` 上退一层） | **宿主专有** |
| `stagehand/prompt.ts` | 173 | `stagehandStatic`、`stagehandGuide(can)`、`stagehandPrompt(can)` | `../play/play-files`、`../capabilities`(type) | 无（纯提示词正文；`can` 是普通对象） | **纯领域** |
| `stagehand/context.ts` | 128 | `readStagehandSnapshot`、`registerStagehandContext`、`StagehandSnapshot` | `node:fs/path`、`@aivn/core`、`cordis`(type)、`../play/*`、`../style/*` | **`registerStagehandContext` 用 `agentCtx.systemPrompt.section`**；`readStagehandSnapshot`（文件清单/主题/就绪）为纯领域 | **薄适配**（同 play-context，可切两半） |

---

## 5. `skills/`（3 份 markdown / 425 行）

| 文件 | 行 | 内容 | 宿主耦合 | 归类 |
|---|---|---|---|---|
| `skills/aivn-play-setup/SKILL.md` | 94 | 起剧目四步流程、premise/craft/play.json 的 craft 段/角色卡/记忆卡/素材表写法、演出中引入新主体 | 无（frontmatter `name`+`description` 由 DSH 技能机制装载，但正文是纯领域 markdown） | **纯领域** |
| `skills/aivn-visual-craft/SKILL.md` | 196 | 画风锚点、外形锚定、差分布局、图单做法、出图/入库（点名 `generate_asset`/`generate_image`/`cut`/`import_asset`） | 无 | **纯领域** |
| `skills/aivn-audio/SKILL.md` | 135 | 免费 BGM/SFX 选源与授权速查、批量落库、`generate_bgm` 写法 | 无 | **纯领域** |

注：三份 skill 的 `description` 已按项目约定**能力中立**（不点名门控工具）；正文点名工具属条件化用法。它们已被 `package.json` 的 `files: ["skills"]` 打进包，抽包时随包走即可。

---

## 6. `src/style/` 与 `src/voice/`

### 6.1 `src/style/`（2 文件 / 514 行）—— **一句话：与 AIVN 领域有关**

`style-tokens.ts`（472 行，导出 `STYLE_TOKENS`/`validateThemePatch`/`sanitizeTheme`/`describeTheme`/`countTheme`/`DEFAULT_THEME` 等，零 import）与 `theme.ts`（42 行，`readPlayTheme`/`THEME_FILE`）定义的是**剧目舞台皮肤 `theme.json`** 的令牌白名单与校验——这是 AIVN 舞台外观规格（台词条、名牌、选项卡、主色），属 **AIVN 领域**，不是 DSH 通用主题，可整层进包（两者均 **纯领域**）。

### 6.2 `src/voice/`（4 文件 / 607 行）—— **一句话：与 AIVN 领域有关**

`tts.ts`（146，`FishTts`/`createTts`，Fish Audio HTTP 客户端 + 多 key 轮询 + 磁盘缓存）、`voice.ts`（151，`VoicePipeline`/`chunkLine`，用 `@aivn/core` 的 `PhraseChunker` 做分句预取）、`voice-catalog.ts`（196，`VoiceCatalog`/`createVoiceCatalog`，Fish 音色库窗口缓存 12h）——三者是**剧目台词语音管线**（AIVN 领域），均 **纯领域**；`voice-host.ts`（114，`VoiceHost`/`TTS_CACHE_DIR`）是**按会话接线**：持有 `StageHub`、读 `readVoiceMap(play-context)`、发 `VoicedLine` 到舞台流 → **薄适配**（host 面只有 hub 与 per-session 管线生命周期）。

---

## 7. 判断：抽「素材/媒体层 + 全部工具 + 提示词正文」共用包时，插件必须留什么、能进什么

### 7.1 必须留在插件本地（DSH 接线，搬不动）

| 文件 | 留的理由 |
|---|---|
| `src/preset-tools.ts` | 纯 DSH 装配：`ctx.on('agent/created'/'agent-preset/selected')`、`ctx.agents`、`agent.ctx.tools.register`/`effect`/`systemPrompt.section`。唯一保留的是 `buildTool` 的 id→builder 表（可薄到几十行） |
| `src/tools/context.ts` | `PlayContext` 三条都是运行期宿主概念：`hub`（舞台中枢）、`sessionId`、`playDir()`（会话工作目录）、`broadcastStyle()`（跨会话广播） |
| `src/playwriter/preset.ts` | `ctx.agentPresets.register()` + 点名宿主的行集（persona/tool-fs/dsh-skill/…）+ `import.meta.url` 定位包内 `skills/` |
| 每个工具的 `defineTool({...})` 外壳 | 含 `output.render → ContentBlock[]`（`dsh-llm`）与 `isConcurrencySafe`（`dsh-tools`）。建议插件侧保留一层「领域工具描述/编排 → defineTool」的适配器，而不是把 `defineTool` 搬进包（包不该依赖 dsh-tools） |
| 注入的**注册函数**半边：`registerPlayContext`（`play-context.ts`）、`registerStagehandContext`（`stagehand/context.ts`）、`stagehand-guide` 段的 `systemPrompt.section`（在 `preset-tools.ts`） | `systemPrompt.section/context` + `order`（100/110/…/130/200）+ TTL 缓存是 DSH 提示词组装机制；但其**文本渲染主体**（`readPlaySnapshot` / `readStagehandSnapshot` 及全部 `render*`）进包 |
| `src/voice/voice-host.ts` | 与 `StageHub`、舞台流、per-session 管线绑定 |
| `src/media/generate-tool.ts` 的 `textOutput` | 唯一 `dsh-llm` 触点；把 4 行 render 留在插件，其余（`IMAGE_PARAMETERS`/`PROMPT_RULES`/`REFERENCE_RULE`/`toTarget`/三种回执）进包 |
| `src/tool-catalog.ts` 的 `withConcurrency` | 写 `isConcurrencySafe` 是 DSH 调度契约；`TOOL_CATALOG` 表本身进包 |

### 7.2 能进包（纯领域 / 薄适配的领域半边）

- **媒体层整层（21/22 文件）**：`cutout.ts`、`image.ts`、`gemini-image.ts`、`openai-image.ts`、`modelslab-image.ts`、`music.ts`、`backends.ts`、`types.ts`、`prompts.ts`、`target.ts`、`storage.ts`、`draft-store.ts`、`catalog.ts`、`generate-image.ts`、`generate.ts`、`commit.ts`、`import.ts`、`cut.ts`、`bgm.ts`、`web-image.ts`、`assets.ts`（`PlayAssets`/`playAssetsOf`）。
- **`src/play/` 的 8 个纯文件**：`play.ts`、`play-files.ts`、`play-state.ts`、`craft.ts`、`assets.ts`、`ledger.ts`、`readiness.ts`、`scaffold.ts`，外加 `play-context.ts` 的 `readPlaySnapshot` + 全部 `render*` / `readVoiceMap`。
- **提示词正文**：`playwriter/prompt.ts`（`PLAYWRITER_PROMPT`/`playwriterTail`）、`stagehand/prompt.ts`（`stagehandStatic`/`stagehandGuide`/`stagehandPrompt`）、`play-files.ts` 的 `PLAY_FILES`。
- **`skills/` 三份 markdown**（随包）。
- **`src/style/` 整层**：`style-tokens.ts`、`theme.ts`。
- **`src/voice/` 的 3 个领域文件**：`tts.ts`、`voice.ts`、`voice-catalog.ts`。
- **工具层可入包的部分**：9 个工具的 `DESCRIPTION` 文本、`parameters` schema 数据、`execute` 编排函数（改为接收 `{playDir, media, catalog, exa, readiness…}` 的**领域依赖对象**，不接 `PlayContext`），以及 `TOOL_CATALOG` 表数据与 `gateSatisfied`。

### 7.3 抽取风险点（供设计包接口时参考）

1. **`PlayAssets` 的构造形状已经是干净的注入面**（`{dir, image?, music?}`）——工具改接它而不是接 `PlayContext` 是最小改动路径。
2. **文件锁 `withFileLock` 是模块级 Map**（按绝对路径）：搬包后若两边各持一份包实例，锁不会跨实例生效；须确认包是单实例（或锁下沉到可注入的注册表）。
3. **`generationInflight`（`generate.ts`）同理**是模块级去重表。
4. **env 变量 `DSH_AIVN_CUTOUT_*`** 是插件命名空间：进包后建议改为显式 `tuning` 入参（`resolveTuning(override)` 已支持），env 读取留在插件侧包一层。
5. **`play.json` 的 `image` 段**（`generate-image.ts` 的 `imageConfig`）是剧目级配置，独立服务端 `stage-ai` 未必有同一字段——跨仓共享前需对齐。
6. **`textOutput` / `ContentBlock`** 是唯一 `dsh-llm` 依赖；包内回执函数应返回**纯文本**（现状已是），render 由插件侧包。
