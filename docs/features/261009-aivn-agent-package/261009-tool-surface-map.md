# AIVN 双宿主工具面并集表（跨仓重构设计输入）

> 逐项实读代码产出，**不含推测**。两份工作树固定到：
>
> | 宿主 | worktree | HEAD | 工具实现位置 | 装配面 |
> | --- | --- | --- | --- | --- |
> | 独立版服务端 | `/root/projects/stage-ai-shared` | `c8595bb9` (`feat/shared-aivn-core`) | `apps/server/src/agentkit/*Tool.ts` | `kit.ts`（`TOOL_CATALOG` / `CAPABILITY_CATALOG`）、依赖面 `deps.ts`、跨宿主矩阵 `contract.ts` |
> | DSH 插件 | `/root/projects/dsh-aivn-shared` | `e832b35` (`feat/shared-aivn-core`) | `src/tools/*.ts`（9 个） | `src/tool-catalog.ts`（9 项单一真相源）、`src/preset-tools.ts` |
>
> 本报告只读，未修改上述任何文件。

---

## 0. 读数摘要（先看这个）

- 服务端工具面 **24 个**（`kit.ts` 的 `TOOL_CATALOG`，另 `BASE_TOOLS=["read"]`），能力目录 **15 行**（`CAPABILITY_CATALOG`），角色 2 个（`playwriter` / `workshop`）。
- 插件工具面 **9 个**（`tool-catalog.ts`），**两个预设默认装同一套**，差异只走插件配置的按预设禁用集；门控 4 档（`none` / `image` / `music` / `tts` / `search`）。
- 两边**同名 5 个**：`generate_image` / `import_asset` / `generate_bgm` / `list_voices` / `web_search`。
- **严格同构（参数面 + 语义都一致，可共用一份定义）的只有 1 个：`web_search`。**
- **同名不同义 2 个（必须重命名）：`import_asset`、`generate_image`。**
- 同域不同面（名字同或近，参数面/生命周期不同）：`generate_bgm`、`list_voices`、`cut`↔`recut_sprite`、`validate_play`↔`get_readiness`。
- 已登记矩阵里的**误记 4 处**：`import_asset`（tool-audit 记为"语义一致"）、`cut`（tool-audit 记为"同名"，服务端根本没有这个名）、`music` 行（`contract.ts` 说 DSH 走"插件媒体任务管线"，实为同步等待）、`view` 行（`contract.ts` 说 DSH 用宿主看图能力，插件仓内无任何实现可查）。

---

## 1. 服务端工具面全表

### 1.1 装配模型（`kit.ts`）

```
装上的工具 = BASE_TOOLS(read) ∪ 开着的能力授权的工具（∩ TOOL_CATALOG.roles ∩ 依赖面真装得出来的）
can 位 = 能力开着 且 它授权的工具都装上了
```

- 能力目录 15 行（`CATALOG_ROWS`，kit.ts:94-229）：`stage`(locked) / `nsfw` / `characters`(defaultOff) / `voice` / `memory` / `files` / `image` / `music` / `library` / `search` / `lineage` / `skill` / `view` / `readiness` / `shell`(defaultOff)。
- 默认启用集（`defaultCapabilitiesFor`，kit.ts:337）：剧作家 = `nsfw, memory, image, library, search`；工坊 = `voice, files, image, music, library, search, lineage, skill, view, readiness`（全减 `shell`）。
- 依赖面缺席即不注册（工厂直接返回 `[]`）：`list_voices`（无 `voices`）、`list_library`/`import_asset`（无 `assetLibrary`）、`generate_bgm`（无 `playMusic`）、`web_search`（无 `exa`）。`generate_image` / `commit_asset` / `recut_sprite` **恒注册**，`playAssets` 缺席时在 `execute` 里回"生图未启用"（imageTool.ts:217-224）。

### 1.2 工具逐项

> 参数写法：`名字: 类型(约束) [必填?]`。服务端参数由 TypeBox 定义，约束是 **pi 运行时硬校验**。

#### A 组 · 演出回路（仅 `playwriter`）

| 工具 id | 能力 | 参数（逐条） | 实际调用的领域能力 | 产品语义 |
| --- | --- | --- | --- | --- |
| `beat_done` | `stage`（locked，恒装） | `options?: string[]`（每项 1–200 字，minItems 2 / maxItems 8）· `placeholder?: string`（≤200） | `deps.emitStop(ModelStop)` → 加 seq → 广播 → 落谱系（与解析器产出的 IR 同管道）；`renderBeatDone()` 供纪元压缩 | 本轮写完时交出停止点（选项面板 / 自由输入 / 自然演完），`terminate:true` 收束该轮 |
| `update_state` | `stage`（locked） | `affinity?: Record<string,number>`（须为本剧角色、整数、\|Δ\|≤5，结果 clamp 0–100）· `flags?: Record<string,string\|number\|boolean>` · `scene?: string`（≤2000）· `threads?: string`（≤2000） | 直接改 `deps.engine`（`EngineStateSnapshot`）与 `deps.stateFiles`（谱系级、随快照回滚） | 提议本轮世界状态更新（好感度是增量、旗标是目标值） |
| `enter_nsfw` | `nsfw` | `reason?: string`（≤500） | `deps.onEnterNsfw()` → 编排器切限制级通道 + 谱系标记；`deps.isNsfw()` 幂等守卫 | 请求进入限制级剧情通道 |
| `exit_nsfw` | `nsfw` | `summary?: string`（≤500） | `deps.onExitNsfw()` → 收束时生成 SFW 摘要并切回主模型 | 请求退出限制级通道 |

#### B 组 · 记忆（仅 `playwriter`）

| 工具 id | 能力 | 参数 | 领域能力 | 产品语义 |
| --- | --- | --- | --- | --- |
| `read_memory_detail` | `memory` | `name: string` [必填]（记忆索引名或 `[分类] 后的相对路径`） | `PlayMemory.readCard(name)` + `visibleContext()`（分支过滤） | 读某张记忆卡的全文 |
| `search_archive` | `memory` | `query: string`（≤200）[必填] · `limit?: number`（代码 clamp 1–10，默认 5） | `PlayMemory.searchArchive(query, tree.pathSet(), {limit, nsfw})` | 全文检索**本分支**历史演出，不召回别条世界线 |

#### C 组 · 剧目文件（两角色，实现同一份）

| 工具 id | 能力 | 参数 | 领域能力 | 产品语义 |
| --- | --- | --- | --- | --- |
| `read` | `BASE_TOOLS`（恒装；`characters`/`memory`/`files` 行也引用它） | pi `createReadTool()` 原生参数（本仓不覆写） | `PlayEnv`（路径白名单；`readGenerated` 只对工坊开） | 读剧目文件 |
| `write` | 剧作家：`characters`(defaultOff) / `memory`；工坊：`files` | pi `createWriteTool()` 原生参数 | `PlayEnv.writeFile` + `writeScopesFor` 白名单 + `onWrite`（角色卡登记 / 轮边界重建） | 写剧目文件（角色卡、记忆卡、play.json……） |
| `edit` | 同 `write` | pi `createEditTool()` 原生参数 | 同上 | 改剧目文件 |
| `bash` | `shell`（defaultOff，仅工坊） | pi `createBashTool()` 原生参数 | `PlayEnv.cwd`；**不过白名单**（playEnv.ts 明说） | 以服务进程权限跑命令（高权限） |

#### D 组 · 素材与图像

| 工具 id | 角色 / 能力 | 参数 | 领域能力 | 产品语义 |
| --- | --- | --- | --- | --- |
| `generate_image` | 两角色 / `image`(needs `image`) | `kind:` `"background"\|"cg"\|"sprite"` [必填] · `name?:`≤40 · `spriteId?:`≤40 · `variant?:`≤40 · `references?: string[]`（每项 1–2000，1–6 张） · `referenceCharacters?: string[]`（每项≤40，1–6，兼容别名，代码里与 references 合并去重封顶 6） · `framing?:` `full\|half\|square` · `stature?:` `small\|normal\|large\|huge` · `title?:`≤40 · `style?:`≤200 · `prompt:`（1–4000）[必填] | 工坊(sync)：`PlayAssets.draft()` → 草稿区 + `onAsset` 气泡；剧作家(queued)：`existingAssetUrl` 去重 → `emitPreload` 骨架占位 → `kick`/`kickSprite` 后台排产，宿主到货广播并直落 `assets/` | 出剧目素材（**同一 schema 两种生命周期**：工坊只产草稿 `draftId`，剧作家一次声明最终 id 直落素材） |
| `commit_asset` | 仅工坊 / `image` | `draftId: string`（1–64）[必填] | `PlayAssets.commit(draftId, {notify:"workshop"})` + `onAsset` | 把草稿正式入库（写 `assets/`、补素材表、记台账、搬留底原片） |
| `recut_sprite` | 仅工坊 / `image` | `spriteId:`（1–40）[必填] · `variant?:`≤40 · `cutout?: { tolerance?: int 0–128; keySmooth?: num 0–8; edgeBand?: int 1–32; spill?: int 0–255; solidResidual?: int 0–255 }` | `PlayAssets.recut({kind:"sprite",spriteId,variant}, cutout)` —— 用**引擎持有的留底原片**（`media-cache/sprite-sources/`）本地重跑抠底 | 立绘原地重抠（画面零变化、不烧配额） |

#### E 组 · 素材资源库（应用级只读目录）

| 工具 id | 角色 / 能力 | 参数 | 领域能力 | 产品语义 |
| --- | --- | --- | --- | --- |
| `list_library` | 两角色 / `library` | `kind?:` `backgrounds\|cg\|sprites\|characters\|bgm\|sfx` · `query?:`≤100 | `AssetLibrary.list()` + `libraryEntryMatches`（截断 `LIST_LIMIT=40`） | 浏览应用级素材资源库（`STAGE_LIBRARY_ROOT`，用户本地维护的**跨剧目**目录） |
| `import_asset` | **仅工坊**（剧作家侧传 `importAsset:false`）/ `library` | `kind:` 同上 [必填] · `entryId:` `string(≤64)` \| `string[](1–40, 每项≤64)` [必填] · `variants?: string[]`（≤24 项，每项≤40） · `target?: "protagonist"` | `importFromLibrary(library, store, {kind, entryId, variants, target})` —— 把**资源库条目**复制进本剧目 `assets/`、可写角色卡、补素材表；`onWrite`/`onAsset` 推撤销与刷新 | 从**应用级资源库**把条目复制进本剧目（批量、可只导部分差分、可落主角卡） |

#### F 组 · 音乐 / 音色 / 检索 / 技能 / 看图 / 就绪 / 故事树（仅工坊，除检索）

| 工具 id | 能力 | 参数 | 领域能力 | 产品语义 |
| --- | --- | --- | --- | --- |
| `generate_bgm` | `music`(needs `music`；无则不注册) | `name:`（1–40）[必填] · `prompt:`（1–2000）[必填] · `title?:`≤40 · `description?:`≤300 · `tags?: string[]`（≤8 项，每项≤24） · `mood?: string[]`（≤8，≤16） · `scene?: string[]`（≤8，≤16） · `loop?: boolean` · `volume?: number`（0–1） · `overwrite?: boolean` | `deps.music.existingUrl(name)` 去重 → `deps.kick(req, toolCallId)` → 宿主 `queueMusic` / `pendingJobs` / 到货 `asset_ready` 广播（**工具不 await**） | 后台排产一首 BGM 落 `assets/bgm/`，元数据进素材表供剧作家选曲 |
| `list_voices` | `voice`(needs `voice`) | `query?:`≤60 · `language?:`≤8 · `gender?:` `male\|female` · `tags?: string[]`（1–4 项，每项≤40） | `VoiceCatalogService.list({language,tags,title})` → 本地 `gender` 筛 → `likes` 降序 → 只列前 `LIST_LIMIT=25` | 查 Fish 公共音色库给角色卡填 `voiceId`（id 猜不出来，填错静默没声） |
| `web_search` | 两角色 / `search`(needs `search`) | `query:`（1–400）[必填] · `numResults?: int`（1–10） | `Exa.search(query, numResults ?? 5)`；`renderSearchResults` 渲染标题/URL/日期/正文 | 联网检索，一次拿回结果与正文（只查剧目之外的事实） |
| `read_skill` | `skill` | `name: string`（≤64）[必填] | `readSkill(name)` 读 `apps/server/skills/`（服务端只读目录，不在剧目文件白名单内） | 读跨剧目通用做法的技能全文（渐进披露） |
| `view_image` | `view` | `source: string`（1–2000）[必填]（剧目内相对路径 或 http(s)） | `PlayFiles.pathOf` 白名单 + `WebImageFetcher`（SSRF 防护、`.part` 原子落缓存）+ 返回 image 内容块（上限 `MAX_WEB_IMAGE_BYTES`） | 把图读进模型上下文（本地或外链缓存） |
| `get_readiness` | `readiness` | 无（空对象，`additionalProperties:false`） | `PlayStore.readiness()` + `renderReadiness()`（premise / 立绘 / 背景三项） | 检查开演条件（**无硬门槛**） |
| `list_saves` | `lineage` | 无 | `PlaySaves.list()` | 列出周目（存档）及 id/名称/轮数/末句 |
| `read_lineage` | `lineage` | `saveId:`（≤64）[必填] · `offset?: number` · `limit?: number`（代码 clamp 1–200，默认 60） · `allBranches?: boolean` | `assertSaveId` + `saveStore(saveId).loadSession()` + `LineageTree.describe()`（只读） | 只读某周目的故事树（行级事件日志，分页、当前分支/全量两态） |

#### G 组 · 写作参数（仅工坊）

| 工具 id | 能力 | 参数 | 领域能力 | 产品语义 |
| --- | --- | --- | --- | --- |
| `set_craft` | `files` | `beatLength?:` `short\|medium\|long\|null` · `stopOptions?:` `two\|three\|four\|free\|null` · `assets?: { background?:` `library-first\|library\|generate\|null`; `cg?:` `library\|generate\|off\|null`; `sprite?:` `generate\|off\|null`; `audio?:` `library\|off\|null` } \| `null` | `withPlayConfigLock(store.dir, …)` → `parsePlayConfig` → `mergeCraftParams` → `PlayFiles.write("play.json")` + `onWrite`（**只换 craft 一个键，其余字节不动**） | 改 `play.json` 的 `craft` 段（每轮篇幅 / 停止点选项数 / 素材来源），三态：省略=不动、null=恢复默认 |

---

## 2. 插件工具面全表

### 2.1 装配模型（`preset-tools.ts`）

- 单一真相源 `TOOL_CATALOG`（9 项，`tool-catalog.ts`）；装配 = `TOOL_CATALOG.filter(gateSatisfied && !disabled)`（preset-tools.ts:243）。
- **两个预设默认完全一致**，差异只走 `playwriterDisabledTools` / `stagehandDisabledTools` 配置。
- 门控 `gate`：`none` / `image` / `music` / `tts`（Fish key，TTS 与音色库共用）/ `search`（Exa key）。
- 并发：`concurrent` 由 `withConcurrency` 落成 `isConcurrencySafe`；只有 `set_stage_style` 声明独占。
- 挂点：`agent/created` 与 `agent-preset/selected`，判断读**活的** `agentPresets.composedPreset`。

### 2.2 工具逐项

> 参数写自各 `src/tools/*.ts` 的 `parameters`。插件 schema 是 **JSON-Schema 子集**：本仓的实际约束表达习惯是 `required` / `enum` / `items` / `default`，**没有** `minLength` / `maximum` / `pattern` / 根级 `additionalProperties:false`。

| 工具 id | 门控 | 参数（逐条） | 实际调用的领域能力 | 产品语义 |
| --- | --- | --- | --- | --- |
| `validate_play` | `none`（恒装） | **无参数**（`parameters: {}`） | `readPlayReadiness(ctx.playDir())` + `renderReadiness()`（`play/readiness.ts`：play.json 可读性、craft 非法取值、世界状态可读性、premise、角色卡张数、立绘、背景、素材清单条目数、**台账悬空条目对账**） | 报告剧目健康（含"写坏了哪一行"），**没有硬门槛** |
| `set_stage_style` | `none` | **17 个**（全部 `oneOf[string, null]`，可选，省略=保持、null=恢复默认）：`dialog_bg` / `dialog_line` / `dialog_ink` / `dialog_ink_soft` / `dialog_ink_thought` / `dialog_ink_faint` / `dialog_shadow` / `stage_bg` / `stage_radius`（0–24px，描述里写）/ `sprite_dim`（0.2–1，描述里写）/ `choice_bg` / `choice_line` / `choice_ink` / `font_ui` / `accent` / `accent_ink` / `accent_soft` | `validateThemePatch`（`style-tokens.ts` 白名单 + 格式校验，整次事务）→ 写/删 `theme.json` → `ctx.broadcastStyle()` 推给**同剧目所有已打开舞台** | 改舞台皮肤（写 `theme.json` 并即时推给已打开的舞台） |
| `generate_image` | `image` | `prompt:` [必填] · `references?: string[]`（每项"主体 id / 剧目内相对路径 / http(s) 网址"，描述写"最多 6 张"，**schema 无 maxItems**） · `aspectRatio?:` `16:9\|3:4\|1:1\|9:16\|4:3` · `style?: string` | `PlayAssets.createGeneric(prompt, {references, aspectRatio})` → `media/generate.ts`（**不绑剧目目标**）+ `genericResult` 回执 | 生成一张候选图（`style` 拼在 prompt 前）；落成素材另走 `cut` / `import_asset` |
| `cut` | `none` | `source:` [必填]（剧目内相对路径） · `output?: string`（不给落候选区） · `tolerance?: number`（0–128，默认 48） · `keySmooth?: number`（0–8，默认 0.8） · `edgeBand?: number`（1–32，默认 4） · `spill?: number`（0–255，默认 20） · `solidResidual?: number`（0–255，默认 48） | `PlayAssets.cutFile(source, output, tuning)`（**任意源图**，只写输出不改源图；色键底色体检、覆盖率体检） | 抠底：纯色底图 → 透明 PNG |
| `import_asset` | `none` | `source:` [必填]（剧目内相对路径 / http(s) 网址） · `kind:` `background\|cg\|sprite` [必填] · `name?:` · `spriteId?:` · `variant?:` · `framing?:` `full\|half\|square` · `stature?:` `small\|normal\|large\|huge` · `title?:` · `description?:` · `prompt?:` · `original?:`（抠底前原片，留底到 `media-cache/sprite-sources/`） | `PlayAssets.register(source, target, {description, prompt, original})` → 写 `assets/`、补素材表（呈现声明 + 描述）、记台账（`assets/generated.json`）、可选留底原片 | **把一张图登记成剧目素材**（本地路径或外链；不抠底） |
| `generate_asset` | `image` | `IMAGE_PARAMETERS`（11）+ `description?`：`kind:` `background\|cg\|sprite` [必填] · `name?` · `spriteId?` · `variant?` · `references?: string[]` · `framing?` · `stature?` · `keyColor?:` `green\|magenta` · `title?` · `style?` · `prompt:` [必填] · `description?` | `PlayAssets.exists(target)` 去重 → `PlayAssets.generate(target, prompt, {description})`（生成 + 立绘自动抠底 + 登记一步） | 一键：生成 +（立绘）抠底 + 登记；同名已有则跳过 |
| `generate_bgm` | `music` | `name:` [必填]（脚本 `<scene bgm="…">` 的 id） · `prompt:` [必填] · `model?: string` | `PlayAssets.generateBgm(name, prompt, {model})` → 落 `assets/bgm/<name>.m4a` + 素材表记录；**同步等待**（约 84s） | 生成一首 BGM 并落库 |
| `list_voices` | `tts` | `query?: string` · `language?: string` · `gender?:` `male\|female` · `tags?: string[]`（描述：并集，**schema 无 maxItems**） · `page?: integer`（`default: 1`） | `VoiceCatalog.list({language,tags,title})` → 本地 gender 筛 → likes 降序 → 每页 25 条、可翻页 | 查 Fish 音色库挑音色 |
| `web_search` | `search` | `query:` [必填] · `numResults?: number`（代码 clamp 1–10，默认 5） | `Exa.search(query, count)`（`src/exa.ts`） | 联网检索（结果与正文一次拿回） |

---

## 3. 并集判定表（按**领域动作**对齐，不按名字）

判定口径：`同构` = 参数面与语义一致，可共用一份定义；`同域不同面` = 领域动作相同、参数面不同（注明差在哪、原因、统一会破坏什么）；`单宿主` = 只有一边有（注明依赖的宿主专有状态/服务）。

| # | 领域动作 | 服务端 | 插件 | 判定 | 差异明细 / 统一代价 |
| --- | --- | --- | --- | --- | --- |
| 1 | 轮收束、交出停止点 | `beat_done` | 无（剧本末行 `<stop …/>` 标签 + DSH 会话投影） | **单宿主** | 服务端依赖编排器 `emitStop` → 谱系/IR；插件依赖 `@aivn/core` 解析器 + 轮尾必须是助手消息（DSH 分支/重建只认这种轮尾）。载体不同，IR 同构 |
| 2 | 世界状态更新 | `update_state` | 无（宿主文件工具写 `memory/always/state/`） | **单宿主** | 服务端依赖 `EngineStateSnapshot` + 谱系快照回滚 + 好感度成员校验；插件无引擎状态真值 |
| 3 | 限制级通道切换 | `enter_nsfw` / `exit_nsfw` | 无 | **单宿主** | 服务端依赖编排器双模型通道 + SFW 摘要 + 谱系标记 |
| 4 | 记忆卡详情 / 历史检索 | `read_memory_detail` / `search_archive` | 无 | **单宿主** | 服务端依赖 `PlayMemory` + **分支过滤**（`tree.pathSet()`）；插件用宿主会话历史 |
| 5 | 剧目文件读写 | `read` / `write` / `edit`（pi 内建 + `PlayEnv` 白名单） | 宿主预设行 `read` / `write` / `edit` / `glob` / `grep` | **同域不同面** | 差在参数 schema（pi TypeBox vs DSH 子集）与守卫机制（`PlayEnv` writeScopes vs 宿主 workspace 权限）。**原因：宿主机制**。统一会破坏服务端的角色/能力级写面（`characters`/`memory`/`files` 三档） |
| 6 | 剧目自查就绪 | `get_readiness`（premise / 立绘 / 背景） | `validate_play`（play.json 可读性 + craft 取值 + 世界状态 + premise + 角色卡张数 + 立绘 + 背景 + 素材清单 + **台账悬空对账**） | **同域不同面** | 插件是**超集**，服务端缺 craft/台账/角色数三项；返回都是纯文本。**原因：产品流程**（插件要为"模型自己写文件"兜错）。统一会删掉插件侧的坏 JSON / 台账对账能力，或给服务端加它没有的数据源 |
| 7 | 联网检索 | `web_search` | `web_search` | **同构** ✅ | 参数面一致（`query` + `numResults` 1–10/默认 5）；仅约束表达不同（服务端 schema 硬校验 `maxLength 400`，插件写描述）。**这是唯一可原样共用一份定义的条目** |
| 8 | 音色库查询 | `list_voices` | `list_voices` | **同域不同面** | 差 **1 个参数**：插件多 `page`（每页 25、可翻页）；服务端 `LIST_LIMIT=25` 截断且不可翻，另加 `tags` 1–4 项 / `query` ≤60 的硬约束，插件无（`VoiceCatalog` 窗口缓存也不同：服务端 `stale` 快照标记 vs 插件 12h/16 窗缓存）。**原因：产品流程 + 窗口机制**。统一（去掉 page）会让插件在千条窗口里够不到第 26 条以后——直接烧一轮预算做多轮 query 收窄，与插件"翻页省预算"的设计相反 |
| 9 | 出**无目标**候选图 | **无**（`generate_image` 强制 `kind`） | `generate_image`（`aspectRatio`；无 target 概念） | **单宿主** | 插件依赖 `PlayAssets.createGeneric`；服务端的每个出图都必须落位（草稿也要 `kind`） |
| 10 | 出剧目素材图（一次声明最终 id 直落素材） | `generate_image`（剧作家 queued：`emitPreload` + `kick` + 到货广播） | `generate_asset`（同步：生成+抠底+登记） | **同域不同面** | 参数差：插件多 `keyColor`（显式声明色键底色，撞色时换品红）；服务端多 `referenceCharacters` 兼容别名，且**没有** `keyColor` 参数。生命周期差：后台排产/骨架占位/到货淡入 vs 同步等待 70–140s；服务端有 `autoNeutral` 兜底。**原因：产品流程（DSH 无回合外注入通道）+ 宿主机制**。统一参数面会破坏：给服务端塞 `keyColor` 要动它的 `imagePrompt` 后缀链；给插件塞排产语义则要求 DSH 提供轮外注入通道 |
| 11 | 草稿 → 素材的采用 | `commit_asset(draftId)` | 无（`generate_asset` 已一步到位；`import_asset` 是"文件→素材"） | **单宿主** | 服务端依赖 `PlayAssets.draft` 草稿区 + 采用生命周期（共享契约 `@aivn/core` 的 `draft→adopted`）；插件的 `draft` 概念只在 `generate_image` 候选区，**不可 commit** |
| 12 | 抠底（任意源图） | **无** | `cut(source, output, 5 调参)` | **单宿主** | 插件依赖 `PlayAssets.cutFile` + `media-cache` 候选区；服务端没有"抠任意图"的口 |
| 13 | 立绘原地重抠 | `recut_sprite(spriteId, variant, cutout{})` | 无（用 `cut` + `source=留底原片` + `output` 指回 `assets/sprites/…`） | **同域不同面** | 寻址方式根本不同：服务端按**已入库立绘**寻址、由引擎去 `sprite-sources/` 取原片；插件按**文件路径**寻址、由模型自己记住留底路径。调参位置也不同（`cutout` 对象 vs 5 个平铺参数 + `source`/`output`）。**原因：宿主机制（谁持有留底）**。统一会破坏服务端"重抠不需要模型知道任何路径"这条安全边界（`recut` 也顺带重写素材表声明） |
| 14 | **登记一张外部/候选图成素材** | **无独立工具**（剧作家的口是"引用即导入"；工坊靠 `generate_image` 直落） | `import_asset(source 路径/URL, kind, …, original)` | **单宿主**（但与服务端 `import_asset` **同名不同义**，见 #15） | 插件依赖 `PlayAssets.register` 写 `assets/` + 素材表 + 台账 + 留底 |
| 15 | **从应用级资源库导入素材** | `import_asset(kind, entryId, variants, target)` + `list_library` | **无** | **单宿主** | 服务端依赖 `AssetLibrary`（`STAGE_LIBRARY_ROOT`，跨剧目只读目录）+ `importFromLibrary`；插件无跨剧目库概念。⚠️ 这是本次要核准的**同名不同义**核心：同一个名字在两边指两个领域动作 |
| 16 | BGM 生成入库 | `generate_bgm`（10 参，后台排产） | `generate_bgm`（3 参，同步等待） | **同域不同面** | 差 **7 个参数**：服务端多 `title` / `description` / `tags` / `mood` / `scene` / `loop` / `volume` / `overwrite`（8 个），插件多 `model`；服务端有"同名跳过 + overwrite"守卫，插件靠 `replaced` 覆盖。生命周期：`pendingJobs` + `asset_ready` 广播 vs 同步等 84s。**原因：宿主机制（插件无回合外注入通道，见 generate-bgm.ts 头注）**。统一（塞满元数据）会逼迫插件把素材表语义补齐；统一（去掉元数据）会让服务端剧作家失去"按 mood/scene 选曲"的依据 |
| 17 | 技能库读取 | `read_skill(name≤64)` | 宿主预设行 `dsh-skill` / `skill-filesystem` / `tool-skill`（按需 `skill` 加载） | **同域不同面** | 差在技能通道与 name 约束（服务端显式工具 + 只读目录；插件走宿主 `available_skills` + realm 隔离）。**原因：宿主机制**。统一会破坏插件的 `isolate:{skills:true}` 隔离（见 dsh-aivn AGENTS.md） |
| 18 | 看图 | `view_image(source ≤2000)` → image 内容块 | **无**（登记为"宿主客户端能力"，插件仓内无实现） | **单宿主** | 服务端依赖 `WebImageFetcher`（SSRF 防护 + `.part` 原子缓存）与 `PlayFiles.pathOf` 白名单 |
| 19 | 故事树 / 周目 | `list_saves` / `read_lineage` | 无（DSH 会话历史与 fork；插件另有结局台账 `endings.json`，不暴露工具） | **单宿主** | 服务端依赖 `PlaySaves` / `saveStore` / `LineageTree` |
| 20 | 命令行 | `bash`（`shell`，defaultOff） | 宿主预设行 `tool-bash`（默认关） | **同域不同面** | 差在 cwd / 超时 / 审计归属。**原因：宿主机制** |
| 21 | 舞台皮肤 | **无** | `set_stage_style`（17 参） | **单宿主** | 插件依赖 `theme.json` + `style-tokens` 白名单 + `StageHub.appendStyle` 广播（**跨会话、按工作目录判同剧目**） |
| 22 | 写作参数 | `set_craft`（3 参，加锁） | 无（宿主文件工具写 `play.json`） | **单宿主** | 服务端依赖 `withPlayConfigLock`（与"引用即导入"/工坊文件页共用队列）+ `craftParams` 校验 |

### 3.1 判定统计

| 判定 | 数量 | 条目 |
| --- | --- | --- |
| 同构（可共用一份定义） | **1** | `web_search` |
| 同域不同面 | **8** | #5 文件读写、#6 就绪自查、#8 音色库、#10 出素材图、#13 重抠、#16 BGM、#17 技能库、#20 命令行 |
| 单宿主 | **13** | 其余 |

---

## 4. 校验既有矩阵

### 4.1 `apps/server/src/agentkit/contract.ts` 的 `CAPABILITY_MATRIX`（15 行逐行）

| id | 登记的 equivalence | 代码事实核对 | 结论 |
| --- | --- | --- | --- |
| `stage` | semantic-only | `beat_done`/`update_state` 在 `TOOL_CATALOG`（roles 均 playwriter）；插件 9 项里无这两个，停止点确为剧本标签（preset-tools.ts:36-38、dsh-aivn AGENTS.md） | ✅ 一致 |
| `nsfw` | intentional-difference | `nsfwTool.ts` 造 `enter_nsfw`/`exit_nsfw`；插件 catalog 无 nsfw | ✅ 一致 |
| `characters` | semantic-only | 服务端 `characters` 能力授权 `write`/`edit` + `writeScopes:["characters"]`（kit.ts:113-121）；插件走宿主文件工具 | ✅ 一致（roles 只写 playwriter，对插件不完整：插件工坊的 `files` 写面也含 `characters`） |
| `voice` | **required** | 两边都有 `list_voices`、都查 Fish 音色库；但**参数面不同**（插件多 `page`，服务端 `tags` 1–4/`query` ≤60 硬约束且截断 25 条不可翻） | ⚠️ **"required" 与事实不符**：这是同域不同面，应记 `semantic-only` 并注明分面 |
| `memory` | semantic-only | 服务端 `memory` 授权 `read_memory_detail`/`search_archive`（带分支过滤）+ write/edit；插件无 | ✅ 一致（行内已登记"独立版有 archive 工具"的有意差异） |
| `files` | semantic-only | 服务端 `files` 仅 workshop（写面 characters/memory/config）；DSH 侧两个预设都拿宿主文件工具 | ⚠️ roles 对 DSH 不完整（不假，但会误导） |
| `image` | semantic-only | 服务端 `image` 授权 `generate_image`+`recut_sprite`+`commit_asset`（roles 按角色收：剧作家只有 generate_image）；插件 `generate_image`/`generate_asset`/`cut` | ⚠️ **半误记**：把两边 `generate_image` 并列，但二者同名不同义（服务端强制 `kind`、按角色分 sync/queued；插件无 target）。且未登记"插件没有 `commit_asset`/`recut_sprite` 的等价物"这一分面事实 |
| `music` | semantic-only | 服务端 `generate_bgm` = `deps.kick` → `queueMusic` → `pendingJobs` + `asset_ready`；插件 `generate_bgm` = **同步 await** `PlayAssets.generateBgm`（generate-bgm.ts 头注明说"插件没有回合之外的注入通道，改成同步等待"） | ❌ **误记**：行内 dshAivn 列写"使用宿主/插件媒体任务管线"——插件**没有**任务管线。另参数面 10 vs 3 |
| `library` | intentional-difference | 服务端 `AssetLibrary`（应用级只读目录）+ `list_library` + `import_asset(entryId)`；插件无库、无 `list_library` | ⚠️ **误导性遗漏**：dshAivn 列写"DSH 仅处理当前 workspace 的素材工具"，读起来像 DSH 没有 `import_asset`；实际插件**有一个同名不同义的 `import_asset`**（#14/#15）。此行的存在恰好是"同名不同义"未被登记的现场 |
| `search` | required | 两边 `web_search` 参数面一致、同查 Exa | ✅ 一致（本矩阵里唯一成立的 required） |
| `lineage` | intentional-difference | 服务端 `list_saves`/`read_lineage`；插件无 | ✅ 一致 |
| `skill` | semantic-only | 服务端 `read_skill` 只读 `apps/server/skills/`；插件走宿主技能行 | ⚠️ roles 只写 workshop，对 DSH 不完整（插件两个预设都装技能行） |
| `view` | semantic-only | 服务端 `view_image` 有本地 + 外链（SSRF 防护）两分支；插件 `src/tools/` 9 个里**没有任何看图工具**，仓内也查不到它依赖的"宿主 view 能力"实现 | ⚠️ **存疑/未落地**：按"逐项实读代码"的口径，dshAivn 侧这一格回溯不到代码；记 `semantic-only` 偏乐观（应 `intentional-difference` 或先查实 DSH 宿主能力） |
| `readiness` | semantic-only | 服务端 `get_readiness` 只报 premise/立绘/背景（readiness.ts）；插件 `validate_play` 报 play.json 可读性/craft/世界状态/premise/角色数/立绘/背景/素材清单/台账对账 | ⚠️ 半准：对象确实不同，但插件是**超集**（不止"检查 workspace 契约"），矩阵没点明"服务端缺 craft/台账对账" |

**矩阵缺失的行（应登记而没登记）**：

- `set_craft`（服务端独有，且理由与时 `files` 行不同：`withPlayConfigLock` + play.json 整体性）；
- `set_stage_style`（插件独有）；
- `commit_asset` / `recut_sprite` / `cut` 三者的交叉对应（目前只在 tool-audit 文档里，矩阵 `image` 行一笔带过）。

### 4.2 `docs/features/261008-aivn-dual-host/261008-aivn-dual-host.tool-audit.md` 的「DSH 侧对照」（第 76–82 行）

> 用户点名的"把 `import_asset` 记为语义一致"，实际出处是**这张表第 80 行**（`CAPABILITY_MATRIX` 里没有这句话）。

| 该表登记 | 代码事实 | 核准 |
| --- | --- | --- |
| `generate_image` ↔ 独立版 `generate_image`（工坊形态），"都是只产候选，采用另一步" | 插件 `generate_image` **无剧目目标**（`prompt`/`references`/`aspectRatio`/`style`）；服务端 `generate_image` **强制 `kind`**、且剧作家形态是后台**直落 `assets/`**（不是候选） | ❌ **误记**：只对服务端工坊那一半成立；服务端一名二义，与插件那种都对不上 |
| `generate_asset` ↔ `commit_asset` + 出图，"独立版是两步" | 插件 `generate_asset` = 生成+抠底+登记一步；服务端剧作家是 queued `generate_image`（draft+commit 由宿主一次做完），工坊才是 `generate_image`+`commit_asset` 两步 | 🟡 大致对，但漏了"服务端剧作家路径本身就是一步"与插件多 `keyColor` |
| `import_asset` / `cut` / `generate_bgm` / `list_voices` / `web_search` **同名，语义一致** | 见下逐条 | ❌ **四项误记，仅一项成立** |
| └ `import_asset` | 服务端 = 从**应用级资源库**按 `entryId` 导入；插件 = **本地路径/URL 登记入库** | ❌ **同名不同义**（用户点名的就是这条） |
| └ `cut` | 服务端**没有** `cut` 这个工具名（近亲 `recut_sprite`，且语义不同：已入库立绘原地重抠 vs 任意源图抠底） | ❌ **不是同名**（"同名"三字就错了） |
| └ `generate_bgm` | 服务端 10 参 + 后台排产；插件 3 参 + 同步等待 | ❌ 应记"同域不同面" |
| └ `list_voices` | 服务端 4 参（tags 1–4）截断 25 条；插件 5 参（多 `page`）可翻页 | ❌ 应记"同域不同面" |
| └ `web_search` | 两边参数面一致 | ✅ **唯一成立** |
| `validate_play` ↔ `get_readiness`，"检查的对象不同" | 成立，且插件是超集 | ✅ 一致（可补"超集"） |
| `set_stage_style` ↔ **无对应** | 插件独有，服务端 `TOOL_CATALOG` 里无皮肤工具 | ✅ 一致 |

**其它同类误记（除 `import_asset` 外）**小结：`cut`（空头"同名"）、`generate_image`（"都是只产候选"）、`generate_bgm`（"语义一致" = 漏了 10 vs 3 参与排产/同步之别）、`list_voices`（"语义一致" = 漏了 `page`）、以及 `contract.ts` 里 `music`（"插件媒体任务管线"）与 `view`（"宿主看图能力"无代码可查）两处。

---

## 5. 结论：一套工具定义，两个宿主各自编译出本机 schema

### 5.1 最小统一清单

**A. 可共用一份定义（1 个，可立即统一）**

| 工具 | 统一方式 |
| --- | --- |
| `web_search` | 一份 `{query(req), numResults(1–10, default 5)}` 语义 + 描述正文；宿主各自编译约束（服务端 `minLength/maxLength/minimum/maximum`，插件降级为描述） |

**B. 改一处小差异即可共用（1 个，需产品决策）**

| 工具 | 决策点 |
| --- | --- |
| `list_voices` | `page` 是否成为"宿主可选参数"：声明 `page?: integer`，服务端编译时忽略（或实现分页）；`tags` 上限同理（服务端 4 / 插件无） |

**C. 必须保持分面（8 类）**

`文件读写`、`就绪自查`（`get_readiness` vs `validate_play`）、`出素材图`（`generate_image` queued / `generate_asset`）、`重抠`（`recut_sprite` vs `cut`）、`BGM`（`generate_bgm` 10 vs 3）、`技能库`、`命令行`。
分面的**正确共享粒度**是：**一份领域实现 + 一份描述正文 + 一份参数规格声明**，各宿主编译自己能表达的子集与自己的生命周期（排产 / 同步），而不是强行抹平 schema。

**D. 必须重命名（同名不同义，2 个）**

| 名字 | 服务端含义 | 插件含义 | 建议 |
| --- | --- | --- | --- |
| `import_asset` | 从应用级资源库按 `entryId` 导入（可批量、可落主角卡） | 把本地路径/URL **登记**成剧目素材 | **两侧至少改一侧**：服务端 → `import_from_library`；插件保留 `import_asset`（或改 `register_asset`） |
| `generate_image` | 强制 `kind`，绑剧目目标；工坊产 `draftId`、剧作家后台直落素材 | 无目标纯生成候选（`aspectRatio`） | 拆名：插件纯生成 → `generate_candidate`；或服务端工坊形态 → `draft_image`（服务端剧作家形态并入 `generate_asset` 语义） |

**E. 必须保持单宿主（13 条）**：`beat_done`/`update_state`、`enter_nsfw`/`exit_nsfw`、`read_memory_detail`/`search_archive`、`list_saves`/`read_lineage`、`get_readiness`、`view_image`、`commit_asset`、`recut_sprite`、`list_library`、服务端 `import_asset`、`set_craft`、`bash`；插件侧 `set_stage_style`、`cut`、插件 `import_asset`、`generate_asset`。

### 5.2 「一套定义、两宿主编译」的硬约束（实读得出）

1. **服务端的约束是运行时硬校验，插件 schema 表达不了**：插件侧的 schema 表达是 `required` / `enum` / `items` / `default`（实读 `src/tools/*.ts`：`page` 只有 `default`、`tags` 无 `maxItems`、`query` 无 `maxLength`、根级没有 `additionalProperties:false`），而服务端 `generate_image` 的 `minItems/maxItems/maxLength/minimum/maximum` 是 pi 会拦下来的。所以"一份定义"只能是 **语义 + 参数规格（含约束）**，各宿主**按能表达的子集编译**，不可能是同一份可执行 schema。
2. **生命周期必须分面**：`generate_image` / `generate_bgm` 在服务端是后台排产 + 到货广播（`emitPreload`/`kick`/`pendingJobs`/`asset_ready`），插件是同步等待（无回合外注入通道）。这不是参数差异，是**装配口径**差异——共用定义时必须把"等待/交付策略"作为宿主侧的编译参数，而不是塞进参数面。
3. **副作用元数据要按角色分化**：服务端 `sideEffectsForTool(name, role)` 对同一个 `generate_image` 在剧作家/工坊给出不同 `workspace_write/background_job/asset_adopt`（contract.ts:316-325）；插件 `tool-catalog.ts` 只有一句散文 `sideEffects` + `concurrent` 布尔。统一时应以服务端的结构化 9 布尔为规格，插件的 `concurrent`（→ `isConcurrencySafe`）另作宿主专属字段。
4. **重命名是前提，不是收尾**：`import_asset` 与 `generate_image` 不先改名，任何"按名字对齐"的并集表都会把两个不同领域动作错并成一个——这正是 `261008-aivn-dual-host.tool-audit.md` 第 80 行出错的机制。

### 5.3 数字

- 服务端工具 24 / 能力行 15；插件工具 9；同名 5。
- **严格同构 1 个**（`web_search`）；**参数面可低成本统一 2 个**（`web_search` + `list_voices`）。
- **同名不同义 2 个**（`import_asset`、`generate_image`）→ 必须重命名。
- 同域不同面 8 类；单宿主 13 条。
- 已登记矩阵/对照表的**误记 6 处**：`import_asset`、`cut`、`generate_image`、`generate_bgm`、`list_voices`（tool-audit 第 78–80 行）+ `music` 行（`contract.ts` 的"任务管线"）+ `view` 行（"宿主看图能力"无代码）。
