# AIVN 工坊 → DSH 插件移植调研（内容 / 台账 / 搭台辅助半边）

调研对象：`/root/projects/stage-ai`（AIVN 源码，只读）。
目标读者：负责「把工坊能力搬进 dsh-aivn 插件」的后续实施者。

**本文覆盖的范围**（题面指定）：

- `apps/server/src/agentkit/`：`memoryTool.ts`、`libraryTool.ts`、`lineageTool.ts`、`skillTool.ts`、`viewTool.ts`、`craftTool.ts`、`readiness.ts`、`readinessTool.ts`、`voiceTool.ts`、`searchTool.ts`、`nsfwTool.ts`、`beatTool.ts`、`deps.ts`、`playEnv.ts`（另读 `piTools.ts`、`result.ts`、`kit.ts` 作为装配语境）
- `apps/server/src/`：`memory.ts`、`library.ts`、`history.ts`、`craftParams.ts`、`compaction.ts`、`workshop.ts`（整份）、`skills.ts`、`playFiles.ts`（写面定义所在）、`assetImport.ts`、`generatedLedger.ts`、`saves.ts`、`store.ts`（按需片段）、`exa.ts`、`paths.ts`
- `apps/server/skills/` 四份 `SKILL.md`
- `packages/core/src/` 的数据模型：`play/config.ts`、`play/assets.ts`、`play/characterCard.ts`、`lineage/model.ts`、`ws/protocol.ts`（按需片段）

**不在本文详述**（属于姊妹半边，只在总表与本报告末尾点到为止）：`imageTool.ts`、`commitTool.ts`、`recutTool.ts`、`musicTool.ts`，以及 `playAssets.ts` / `playMusic.ts` 的出图与入库实现。

**现状基线**：`/root/projects/dsh-aivn` 里搭台助手（`aivn-stagehand` 预设）目前只有 `create_play` + DSH 的 fs 工具（`read`/`write`/`edit`/`glob`/`grep`），没有命令行、没有素材/记忆/故事树/技能/看图/就绪工具，也没有工坊 persona（只有 `src/playwriter/` 一个预设目录，搭台只有一段 30 行的 `STAGEHAND_PROMPT`，见 `src/playwriter/prompt.ts:230-263`）。装配点在 `src/preset-tools.ts:118-124`。本报告只摆 AIVN 侧事实。

---

## 1. 总表

「属于哪个能力」列的能力名与 id 取自 `kit.ts` 的 `CATALOG_ROWS`（`apps/server/src/agentkit/kit.ts:93-228`）；`基座` = `BASE_TOOLS`（`kit.ts:311`）。

| 工具 id | 参数 | 调用后会发生什么（一句） | 依赖 | 读写落点（剧目内相对路径） | 属于哪个能力 |
| --- | --- | --- | --- | --- | --- |
| `read` | `path`（pi 内建） | 从剧目读一份文本文件返回 | `PlayEnv.absolutePath` → `PlayFiles.pathOf(…,"read")` | 读：`play.json`、`theme.css`、`memory/**`、`characters/**`、`assets/**`（非文本拒） | 基座（两角色恒装） |
| `write` | `path`、`content`（pi 内建） | 落盘一份文本，触发 `onWrite` 刷新/重建 | `PlayEnv.writeFile` → `PlayFiles.write`（含 play.json 结构校验） | 写面由 `writeScopes` 决定（见 §5） | 工坊「改剧目文件」；剧作家「管理角色」「记忆」 |
| `edit` | `path`、`oldText`、`newText`（pi 内建） | 定点替换后落盘，触发 `onWrite` | 同 `write` | 同 `write` | 同 `write` |
| `bash` | `command`（pi 内建） | 以服务进程权限跑命令（cwd = 剧目根），**绕过白名单** | `NodeExecutionEnv.exec` | 进程可达的一切 | 「命令行」（仅工坊，`defaultOff`） |
| `update_state` | `affinity`（增量）、`flags`、`scene`、`threads` | 改引擎内存态与 state 文件，剧作家下轮【状态】区生效 | `engine` / `stateFiles` / `characterIds` | 不直接下盘；随谱系快照进 `saves/<id>/session.json` | 「轮与状态」（剧作家，常开 `locked`） |
| `read_memory_detail` | `name` | 返回一张记忆卡全文 | `PlayMemory.readCard` | 读 `memory/index/**.md`；arcs 卡按 `arcIds` 过滤 | 「记忆」（仅剧作家） |
| `search_archive` | `query`(≤200)、`limit` | MiniSearch 全文检索本分支历史切片 | `PlayMemory.searchArchive` + `tree.pathSet()` | 读 `memory/archive/events.jsonl`（内存索引） | 「记忆」（仅剧作家） |
| `beat_done` | `options`(2–8) / `placeholder` | 交出停止点，`emitStop` → IR 事件 | `emitStop` | 经事件管道落 `saves/<id>/lineage.jsonl` + `session.json` | 「轮与状态」（剧作家，常开） |
| `enter_nsfw` | `reason?` | 请求进入限制级通道（内存态） | `onEnterNsfw` / `isNsfw` | 无文件 | 「限制级通道」（剧作家） |
| `exit_nsfw` | `summary?` | 请求退出限制级通道，段末生成 SFW 摘要 | `onExitNsfw` / `isNsfw` | 无文件（摘要落谱系与 archive） | 「限制级通道」（剧作家） |
| `get_readiness` | 无 | 返回 premise / 立绘 / 背景 / 周目数四项 | `store.readiness()` | 读 `play.json`、`memory/always/premise.md`、`assets/sprites/**`、`assets/backgrounds/**`、`saves/` | 「检查开演条件」（仅工坊） |
| `view_image` | `source`（剧目内路径 或 http(s)） | 把图作为 image 附件读回来给模型看 | `files.pathOf(…,"read")` + `webImage` + `imageMime` | 读 `assets/**` 等白名单内图片；网图缓存落 `media-cache/web-images/`（不进 git） | 「看图」（仅工坊） |
| `list_library` | `kind?`、`query?` | 列应用级资源库条目（最多 40 条） | `AssetLibrary` | 读 `<dataRoot>/library/**`，不落剧目 | 「素材资源库」（两角色） |
| `import_asset` | `kind`、`entryId`（单值或数组 ≤40）、`variants?`(≤24)、`target?=protagonist` | 把库条目复制进剧目并补素材表 / 角色卡 | `importFromLibrary` + `withPlayConfigLock` | 写 `assets/<kind>/<id>.*`、`assets/sprites/<id>/<variant>.*`、`assets/manifest.json`、`characters/<id>.md` | 「素材资源库」（仅工坊） |
| `read_skill` | `name`(≤64) | 返回一份 `SKILL.md` 全文 | `skills.ts`（模块级缓存 + `loadSkills`） | 读 `apps/server/skills/<name>/SKILL.md`（仓库内，非剧目） | 「技能库」（仅工坊） |
| `list_saves` | 无 | 列出各周目 id / 名 / 轮数 / 最后一句 | `PlaySaves.list` | 读 `saves/*/meta.json` + `active.json` | 「故事树」（仅工坊） |
| `read_lineage` | `saveId`、`offset?`、`limit?`(≤200)、`allBranches?` | 只读渲染某个周目的行级故事树 | `PlayStore(saveId).loadSession()` + `LineageTree.describe()` | 读 `saves/<id>/session.json` | 「故事树」（仅工坊） |
| `set_craft` | `beatLength` / `stopOptions` / `assets`（三态） | 改 `play.json` 的 `craft` 段，立刻生效 | `craftParams.mergeCraftParams` + `withPlayConfigLock` | 写 `play.json` | 「改剧目文件」（仅工坊） |
| `web_search` | `query`(≤400)、`numResults`(1–10) | Exa 语义检索，一次拿回结果与正文 | `Exa`（多 key 轮询 + 代理） | 不落剧目文件 | 「联网检索」（两角色） |
| `list_voices` | `query`(≤60)、`language`(≤8)、`gender`、`tags`(≤4) | 查 Fish 音色窗口，列出最多 25 条候选音色 | `VoiceCatalogService.list`（磁盘快照 + 内存窗口 LRU） | 不落剧目文件（音色是全局的） | 「音色库」（仅工坊，`needs: voice`） |
| `generate_image` | `kind`、`name`/`spriteId`、`variant`、`references`(≤6)、`framing`、`stature`、`title`、`style`、`prompt`(≤4000) | 工坊同步出一张**草稿**并回 `draftId` + 预览 | `PlayAssets.draft`（姊妹半边） | 落 `media-cache/drafts/<draftId>/`，**不进 `assets/`** | 「生图」（两角色，`needs: image`） |
| `commit_asset` | `draftId` | 把挑中的草稿提升为正式素材 | `PlayAssets.commit`（姊妹半边） | 写 `assets/**`、`assets/manifest.json`、`assets/generated.json`、`media-cache/sprite-sources/` | 「生图」（仅工坊） |
| `recut_sprite` | 见 `recutTool.ts` | 拿留底原片就地重抠，覆盖已入库 PNG | `PlayAssets.recut`（姊妹半边） | 写 `assets/sprites/<id>/*.png` | 「生图」（仅工坊） |
| `generate_bgm` | 见 `musicTool.ts` | **发起即返回**，后台排产一首 BGM，到货广播 | `playMusic` + `queueMusic`（姊妹半边） | 落 `assets/bgm/`，补 `assets/manifest.json` 若干键 | 「生成 BGM」（仅工坊，`needs: music`） |

补充：`create_play` 是 DSH 插件自有的起剧目工具，AIVN 侧对应的是 `PlayStore.createEmpty`（`store.ts:524-554`），不是 agent 工具。

---

## 2. 每个工具一节

### 2.1 `read` / `write` / `edit`（pi 内建，经 `PlayEnv` 收口）

- 实现：直接取 pi 的 `createReadTool` / `createWriteTool` / `createEditTool`，适配层只补三个 harness 参数（`piTools.ts:29-45`、`57-59`）。**不 fork、不覆写描述**，三个工具在模型侧是英文描述。
- 路径入口只有一个：`resolveToolPath` → `PlayEnv.absolutePath`（`playEnv.ts:55-60`）。读面与写面共用同一个 `denial()`（`playEnv.ts:97-130`），只是 `mode` 不同。
- `write`/`edit` 落盘一律走 `PlayFiles.write`（`playEnv.ts:76`），因此 `play.json` 的结构校验（`playFiles.ts:73-82`）与「可写面 + 能力面」两道拒绝都在同一个收口上。
- 失败怎么报：`writeFile` 把异常转成 `FileError`，`play.json` 校验失败给 code `invalid`、其余给 `permission_denied`（`playEnv.ts:82-83`）。注释明确：只有走 `write` 才原样回给模型，pi 的 `edit` 会包成「Could not edit file: …. Error code: invalid.」，原因只留在 cause 上（`playEnv.ts:78-81`）。
- 上限/排序：`PlayFiles.list()` 走 `readdir` 后 `localeCompare` 排序（`playFiles.ts:199`），可见文件清单就是工坊提示词「当前状态」里那份（`workshopSession.ts:526-528`）。
- 白名单：`normalizePath` 拒绝对路径、`..`、空段、反斜杠（`playFiles.ts:54-60`）；`pathOf` 再要求 `resolve` 后落在剧目根内（`playFiles.ts:177-185`）。
- 引擎产物：`read` 也会先过 `absolutePath`，所以对工坊而言 `memory/arcs/`、`memory/archive/` 读得到（`readGenerated: true`，`kit.ts:433`）；对剧作家则被拒（`playEnv.ts:107-119`）。
- 非文本：`PlayFiles.read` 明确拒绝非 `text` kind（`playFiles.ts:224`），二进制走静态 URL 或 `view_image`。

### 2.2 `bash`

- 唯一装配在工坊（`kit.ts:483`），`TOOL_CATALOG` 标 `roles: ["workshop"]`（`kit.ts:294`），能力「命令行」`defaultOff`（`kit.ts:220-227`）。
- **不走 `PlayEnv` 的任一覆写**：它用 `NodeExecutionEnv.exec`，cwd = `files.root`（`playEnv.ts:42-44`、`52`）。所以它是一个真实的逃逸口，代码里不假装是进程边界。
- 上限：单轮 7 分钟超时经 abort signal 传到 pi（`piTools.ts:35-43`、`workshop.ts:344` 的 `TURN_TIMEOUT_MS = 420_000`）。
- 宿主侧只需知道「跑过 bash 就置脏」：`workshopSession` 订阅 `tool_execution_end`（见 `apps/server/AGENTS.md`；本轮未逐行读该文件）。

### 2.3 `get_readiness`

- 参数为空对象（`readinessTool.ts:7`）。回执是 `renderReadiness(await deps.store.readiness())`（`readinessTool.ts:19`）。
- `readiness()` 的四项判定（`store.ts:211-233`）：`readiness()` 读不出 play.json 时全部 false；立绘 = `assets/sprites/<任一目录>/` 里有图；背景 = `assets/backgrounds/` 里有图；`saves` = 周目目录数；`premise` = `memory/always/premise.md` 去空白后非空。
- 文本来源是共享的 `renderReadiness`（`readiness.ts:4-12`），工坊提示词的「当前状态」章也用它（`workshop.ts:162`）。口径明写「**没有硬门槛**」。
- 与 UI 的关系：真正的「就绪门」是前端文案（`apps/web/src/api.ts:43-50` 把 premise 列为 missing、立绘/背景列为 advice；`TitleView.tsx` 消费），服务端不存在一个拒绝开演的硬校验（grep 到的只有 REST 读口 `http.ts:405-406`）。「premise 空着开不了演」是界面层的说法。

### 2.4 `view_image`

- 参数只有一个 `source`（1–2000 字），描述里明写「剧目内相对路径 或 http(s) 网址」（`viewTool.ts:25-36`）。
- 分派：`/^https?:\/\//i` 走 `viewRemote`，否则 `viewLocal`（`viewTool.ts:63`）；两者共用一个 `try/catch`，失败一律 `读图失败：${reason}`（`viewTool.ts:64-66`）。
- 本地分支：`deps.pathOf(source)` 就是 `PlayFiles.pathOf(…,"read")`（`kit.ts:487`），越界直接抛。再做 20MB 上限（`MAX_WEB_IMAGE_BYTES`，`webImage.ts:19`）与 magic-number 嗅探，只认 png/jpeg/webp/gif（`viewTool.ts:92-99`）。
- 网络分支：先查 `media-cache/web-images/<url摘要>.<ext>` 缓存命中即读（`viewTool.ts:74-78`）；未命中才 `deps.fetchImage(url)`，写 `.part` 再 rename（`viewTool.ts:80-85`）。**没配下载器时返回「看网络图未启用…」，工具仍然注册**（`viewTool.ts:73`；装配注释见 `kit.ts:485-486`）。
- 回执是 text + image 两个 content block，base64 内联（`viewTool.ts:102-110`）。
- **未验证的边界**：`generate_image`（工坊）回执给的是草稿 URL `/plays/<id>/drafts/<draftId>/…`（`imageTool.ts` 的 `runSync`）。该串既不是 `http(s)`（不会走网络分支），也不是合法剧目相对路径（前导 `/` 会被 `normalizePath` 拒），而 `media-cache/` 又不在读白名单内——**按代码推断工坊无法用 `view_image` 看自己刚出的草稿**。我没找到绕开路径（例如草稿是否另有 `assets/` 镜像）。见 §7。

### 2.5 `list_library`

- 参数 `kind?`（六选一）+ `query?`（≤100）（`libraryTool.ts:37-44`）。
- 行为：`await library.list()` 全量扫描 → 按 `kind` 与 `libraryEntryMatches` 过滤 → 截断 `LIST_LIMIT = 40`（`libraryTool.ts:22`、`106-119`）。空库与「无匹配」是两句不同的话（`libraryTool.ts:112-118`），超限时补一句「共 N 条」提示收窄（`libraryTool.ts:130-132`）。
- 每行格式：`id | kind | title | describeAsset(meta)` + 立绘类目附差分名 + 角色包标「主角」+ 警告（`libraryTool.ts:120-129`）。
- `AssetLibrary.list()` 本身：按 `ASSET_KINDS` 声明顺序、目录名 `localeCompare` 排序；目录不存在 = 空库不报错；扫到坏 `meta.json` 只记 `warnings`（`library.ts:69-84`、`119-133`）。`entry()` 对「单文件类别放了多个文件」只取第一个并记警告；立绘类目校验 `variants` 指向的文件是否存在（`library.ts:86-117`）。
- 匹配是 id/标题/描述/标签/mood/scene 的大小写不敏感子串（`packages/core/src/play/assets.ts:292-306`）。
- **只读**：`AssetLibrary` 没有任何写接口（`library.ts:13-26` 的类注释把这点说成产品决定）。

### 2.6 `import_asset`

- 参数见总表（`libraryTool.ts:46-63`）；`entryId` 支持单值或同类别数组（≤40），`variants` ≤24，`target` 只认字面量 `protagonist`。
- 三条前置校验：批量 + `target` 直接回一句拒绝（`libraryTool.ts:153-155`）；批量 + `variants` 同样拒绝（`libraryTool.ts:156-158`）；理由写在代码注释里（主角卡只有一张 / 差分清单是逐条目的）。
- 逐条 `importFromLibrary`，**一条失败不影响其余**，失败的 id 与原因汇总在回执末尾（`libraryTool.ts:159-186`）。
- `importFromLibrary` 的真实行为（`assetImport.ts:147-230`）：先 `library.entry(kind,id)`，不存在即抛「资源库里没有 kind/id」；立绘类目落 `assets/sprites/<spriteId>/<variant><ext>`，非立绘落 `assets/<kind>/<id><ext>`；同名其它扩展名会先删（`removeStaleSiblings`，`assetImport.ts:90-97`）；**文件复制在锁外**，`assets/manifest.json` 与角色卡的读改写包在 `withPlayConfigLock` 里（`assetImport.ts:169`、`206-228`）。
- 素材表用 `mergeMeta` 合并（库里有值才覆盖，`assetImport.ts:71-77`）；角色卡只在条目带 `meta.character` 时写，且只覆盖库里真给了的字段，人设取 `persona` 落到卡片正文（`assetImport.ts:239-259`）。
- 回执按类别分两种渲染：单文件类别整批说一次引用写法（`libraryTool.ts:214-229`），立绘类目逐条说清落了图还是落了卡（`libraryTool.ts:236-254`）。方法注释明写「只声明了图的条目**不建空壳卡**」。
- 排序/上限：扫描顺序即库顺序；`import_asset` 无自身缓存，每次真读盘。

### 2.7 `read_skill`

- 参数 `name`（≤64）（`skillTool.ts:16`）。实现是 `await readSkill(name)`，返回 `skill.content` 全文（`skillTool.ts:27-34`）。
- 失败即 `读取失败：${reason}`，错误消息里带可选清单——名字不在清单里就在错误里列出全部可选技能（`skills.ts:44-46`）。
- 技能库加载：`skills.ts:18-32`。目录由 `workshopSkillsDirOf(import.meta.url)` 反推（`paths.ts:44-48`），`loadSkills` 走 `NodeExecutionEnv`，**模块级 `cache` 只加载一次**（进程内），诊断信息 `console.warn` 出但不抛。
- 装配：`TOOL_CATALOG` 标 workshop（`kit.ts:287`），能力「技能库」（`kit.ts:196-202`）。提示词侧由 `skillsPrompt()` 输出清单块（`workshop.ts:136`，实现 `skills.ts:35-38`）。
- 边界：类注释明写技能库是**服务端自己的目录**，模型只能经本工具读，不放开剧目文件白名单（`skills.ts:14-15`）。

### 2.8 `list_saves`

- 空参数（`lineageTool.ts:16`）。回执：每行 `id \t 名称（当前活动档）\t N 轮 \t 最后：preview`；无周目时回「（还没有任何周目）」（`lineageTool.ts:37-46`）。
- 后端 `PlaySaves.list()`：只扫 `saves/` 下的目录（id 过 `^[\w-]+$`），元信息缺失回落占位档；**按 `updatedAt` 倒序、再按 `createdAt` 倒序**（`saves.ts:118-139`）。`current` 由 `active.json` 判定（`saves.ts:107-115`）。
- 它读的是 `meta.json` 而不是动辄数 MB 的 `session.json`（`saves.ts:13` 的注释）。

### 2.9 `read_lineage`

- 参数 `saveId`(≤64)、`offset`、`limit`、`allBranches`（`lineageTool.ts:17-27`）。
- 校验顺序刻意「先验 id 格式再验存在」：`assertSaveId` 抛错与「周目不存在」是两句不同的回执（`lineageTool.ts:56-60`）；`session.json` 读不出时回「还没有演出版本」（`lineageTool.ts:61-62`）。
- 渲染（`lineageTool.ts:109-132`）：走 `new LineageTree().load(store).describe()` 而不是自己算路径（注释：`onPath` 只有它算得对，`lineageTool.ts:114`）；`allBranches !== true` 时只留 `onPath` 节点；`offset` 下限 0、`limit` 钳在 1–200（默认 60）；页头报总数、叶节点、快照数、本页序号区间。
- 行格式 `id \t 中文类型标签 \t 台词截断(60)`，废弃分支标「（废弃分支）」、带 `seq` 与「改写 <id>」（`lineageTool.ts:74-106`）。
- **只读是硬边界**：类注释明写分岔/编辑/重写是玩家的四个动词，不该由 agent 在背后动（`lineageTool.ts:12-13`），工具描述里也这么告诉模型（`lineageTool.ts:52`）。
- 它绕过了 `PlayFiles` 白名单，直接 `saveStore(saveId).loadSession()`（`lineageTool.ts:61`）——`saves/` 对文件工具是不可见的。

### 2.10 `set_craft`

- 参数三态（省略/给值/`null`），字段是 `beatLength`、`stopOptions`、`assets.{background,cg,sprite,audio}`；枚举取自 `CRAFT_ENUMS`（`craftTool.ts:22-96`，枚举源头 `craftParams.ts:232-239`）。
- 行为：先把参数收成 `CraftPatch`；**一个字段都没给时**不写盘，只回报当前生效值（`craftTool.ts:121-125`）。
- 读改写整体在 `withPlayConfigLock(deps.store.dir, …)` 里（`craftTool.ts:127`）：读原文 → `parsePlayConfig` 校验 → `mergeCraftParams` 合并 → **只换 `craft` 一个键**写回（保留了引擎不认识的手写字段，`craftTool.ts:130-137`）；与原文相同则不写盘、不推 `onWrite`（`craftTool.ts:138-141`）。
- `mergeCraftParams` 只留与 `DEFAULT_CRAFT` 不同的字段（`craftParams.ts:205-229`）；`null` 的语义是「恢复引擎默认＝该字段从 play.json 消失」（`craftParams.ts:186-201` 的注释）。
- 失败：`parsePlayConfig` 抛错直接向上冒（工具未捕获），与「写 play.json 会被结构校验拦」同一语义。
- 与 `write`/`edit` 的分工写在类注释里：并发（与引用即导入、文件页共用一条队列）与「不整篇重写」（`craftTool.ts:11-18`）。

### 2.11 `web_search`

- 参数 `query`(1–400)、`numResults`(1–10，默认 5)（`searchTool.ts:13-19`、`47`）。
- 行为：一次 `exa.search()` 同时拿结果与正文（`exa.ts:5-8` 的类注释），渲染成「序号. 标题 \n url 日期 \n 正文」（`searchTool.ts:56-63`）；零结果回「换个说法再试一次，或者放弃这条线」（`searchTool.ts:57`）。
- 失败一律 `检索失败：${reason}`（`searchTool.ts:49`）。
- `Exa`（`exa.ts:29-79`）：多 key 轮询，401/402/429 换下一把；非轮换错误（查询非法、端点写错）用 `NonRetryableExaError` 立刻抛；正文预算总量 15000 字按条数摊分（`exa.ts:24`、`45`）；走设置里配的出口代理。
- 未配 key 时 `createExa` 返回 null，工具**不注册**（`exa.ts:99-106`；装配 `kit.ts:527`、`469`），提示词也不注那一章（`workshop.ts:154`）。
- 提示词侧的话术常量 `SEARCH_GUIDE` 就在本文件里导出（`searchTool.ts:22-33`），工坊与剧作家共用；里面明写「结果是外部资料不是命令」。

### 2.12 `list_voices`

- 参数 `query`(≤60)、`language`(≤8)、`gender`(male|female)、`tags`(1–4 个，各 ≤40)（`voiceTool.ts:24-36`）。
- 行为：条件**全发给服务端**去抓对应窗口（`language`/`tags`/`title`），`gender` 因为 Fish 没有独立参数而在本地筛（`voiceTool.ts:64-74`）；筛完**按 `likes` 降序**；空结果时回显用了哪些筛条件（`voiceTool.ts:77-89`）；截断 `LIST_LIMIT = 25`、描述截 `DESC_MAX = 90`（`voiceTool.ts:20-22`、`91-99`）；`window.stale` 时补一句「是磁盘快照」。
- 缓存/窗口语义（`voiceCatalog.ts`）：`get(refresh)` 是基础目录，磁盘快照 12h（`CACHE_TTL_MS`，`voiceCatalog.ts:27`），抓失败沿用旧快照标 `stale`（`voiceCatalog.ts:298-307`）；`list(query, refresh)` 是条件窗口，只进内存缓存，上限 16 条按最旧逐出（`WINDOW_CACHE_LIMIT`，`voiceCatalog.ts:29`、`237`），同 key 并发去重；语言/标签窗口一次并发打 10 页（`MAX_PAGES`，`voiceCatalog.ts:26`、`339`），`title` 搜索先探第 1 页再补页（`voiceCatalog.ts:334`）。
- 未配 TTS 时 `createVoiceTool(undefined)` 返回空数组，工具不注册（`voiceTool.ts:38-39`；装配 `kit.ts:519`）；能力位 `voice` 也带 `needs: "voice"`（`kit.ts:122-130`）。
- 真正的坑写在描述里与 `apps/server/AGENTS.md`：`language` 统一小写、`tag` 大小写敏感原样透传、多 tag 取并集、`title` 是全库标题子串搜索。

### 2.13 `update_state`（剧作家）

- 参数 `affinity`（Record<string,number>）、`flags`（string|number|boolean）、`scene`(≤2000)、`threads`(≤2000)（`memoryTool.ts:10-22`）。
- 校验：`affinity` 的 key 必须是 `deps.characterIds` 成员，否则进 `rejected`；增量必须整数且 `|Δ| ≤ 5`（`AFFINITY_DELTA_CAP`）；结果钳到 0–100（`memoryTool.ts:7-8`、`62-75`）。
- 回执把「已生效」与「被拒绝（请修正后重试）」分两段列出（`memoryTool.ts:85-93`）；什么都没给回「未提供任何更新。」。
- **不落盘**：`scene`/`threads` 只写进 `deps.stateFiles`（内存态，随谱系快照走），注释明写「引擎拥有状态真值，工具只改传进来的对象」（`memoryTool.ts:34-39`）。

### 2.14 `read_memory_detail`（剧作家）

- 参数 `name`（`memoryTool.ts:24`）。
- 匹配：`PlayMemory.readCard` 同时接受标题、相对路径（去 `.md`）、文件名主体；再按 `arcIds` 过滤 arcs 卡（`memory.ts:117-126`）。
- 未命中时回「未找到『X』。可用条目：…」（`memoryTool.ts:109-113`），把清单摆出来。
- 卡解析：首行 `# 标题`、标题后首个非空行是摘要、其余是详情；没写标题就用文件名（`memory.ts:284-292`）。

### 2.15 `search_archive`（剧作家）

- 参数 `query`(≤200)、`limit`（`memoryTool.ts:26-32`）。`limit` 钳在 1–10、默认 5（`memoryTool.ts:126`）。
- `PlayMemory.searchArchive(query, tree.pathSet(), {limit, nsfw})`（`memoryTool.ts:125-128`）：MiniSearch 索引 `summary` 字段，自定义 CJK bigram 分词（`memory.ts:339-349`），索引**懒建一次**（`memory.ts:141-149`）；命中再按 `allowed.has(slice.entryId)` 与 `nsfw` 过滤（`memory.ts:153-159`）。
- 回执「【第 N 轮】\n摘要」逐条拼；零命中回一句固定文案（`memoryTool.ts:129-130`）。
- 数据来源：`memory/archive/events.jsonl`（追加式 JSONL，跳过残行，`memory.ts:294-307`）。

### 2.16 `beat_done`（剧作家）

- 参数 `options`（2–8 条、每条 1–200 字）、`placeholder`(≤200)（`beatTool.ts:18-28`）。
- 行为：trim 后过滤空串；`options` 与 `placeholder` 同给时按 `options` 走，但回执明说 placeholder 本轮不生效，不静默丢弃（`beatTool.ts:45-58`、`59-70`）。
- 一层额外校验：schema 的 `minItems=2` 拦不住 `["  ","x"]`（trim 后不足两条），此时 `throw`（`beatTool.ts:50-54`）。这是本报告范围内**唯一**主动抛错的工具。
- `emitStop({stopType:"choice"|"free"})` → IR 事件，与解析器产出的事件同构（`beatTool.ts:55-58`）；`terminate: true` 声明收束语义（`beatTool.ts:76`）。
- `renderBeatDone`（`beatTool.ts:83-88`）给纪元压缩用，把参数渲染成一句人话（被 `compaction.ts:193` 调用）。

### 2.17 `enter_nsfw` / `exit_nsfw`（剧作家）

- 参数各一个可选字符串（≤500）（`nsfwTool.ts:5-19`）。
- 幂等守卫：已在通道里再 `enter` 回一句「无需重复调用」；不在通道里 `exit` 同理（`nsfwTool.ts:38-40`、`58-60`）。守卫只改回执，不抛错。
- 真正的状态迁移不在工具里：`onEnterNsfw` / `onExitNsfw` 由编排器处理（`nsfwTool.ts:21-25`）。

### 2.18 边界外的四个工具（只记事实）

`generate_image`（两角色同一 schema 与实现，只有 description 与等待策略不同：工坊 `mode: "sync"`、剧作家 `mode: "queued"`，`kit.ts:491-497`、`453-460`）与工坊专有的 `commit_asset` / `recut_sprite` / `generate_bgm` 归姊妹半边详述。与本半边的接点只有两处：

- `generate_image` 工坊侧同步等待，回执是「草稿已出 + markdown 预览 + draftId」；`onAsset` 推气泡（`imageTool.ts` 的 `runSync`）。
- 工坊提示词的「出图要点」章（§3）是这些工具的行为说明，能力门控在 `can.image`。

---

## 3. 搭台助手的 persona 逐章清单

装配函数 `buildWorkshopPrompt`（`workshop.ts:135-163`），输入 `WorkshopPromptContext`（`workshop.ts:26-51`）。拼装顺序即下表顺序。**「能力门控」列标★的章，能力关掉时该章整段消失或换成 fallback。**

| # | 章节 | 何时拼入 | 讲了什么（一句话） | 能力门控 |
| --- | --- | --- | --- | --- |
| 0 | 身份句「你是这部剧目《标题》的**搭台者**」 | 恒 | 负责设定/角色卡/视觉素材，不写剧本、不参与演出（`workshop.ts:137`） | 否 |
| 1 | 剧本语言提示 `playLanguageNote` | `scriptLanguage` 非空时 | 给演出看的内容（premise/角色卡/记忆卡）用剧本语言写，与用户对话仍是中文（`workshop.ts:171-174`） | 否（值门控） |
| 2 | `# 职责边界` `responsibilityRules(can.files)` | 恒（两分支） | 产出物清单、不做的事、必须真调 write/edit 或 generate_image、故事树只读、「路线」视图没有输入框（`workshop.ts:59-76`） | ★ `files`（换 fallback） |
| 3 | `# 对话风格` `talkRules` | `can.files` 为真才拼 | 先读后写、edit 优先于 write、写盘前说明、**只准汇报真写过的文件**、中文简洁；`can.shell` 为真时多一句 grep/jq 更快（`workshop.ts:84-96`） | ★ `files`（整章消失） |
| 4 | `# 设定流程（这是你的工作方式）` `setupFlow` | 恒（内部按值/能力分叉） | 四步不跳步：先问 3~5 个带默认提案的问题 → 摆完整提案等批准 → 列图单（`can.library` 时要求先查库）+ 按 `imageApproval` 决定要不要等点头 → 落盘（`can.files` 时写 premise/craft.md + `set_craft`；否则交清单给用户）（`workshop.ts:180-194`） | ★ `library`（第 3 步半句）、`files`（第 4 步整段） |
| 5 | `# 出图要点` | 恒 | 正文二选一：`can.image` 时 `imageGuide`（审批口径、草稿与 commit 两步、neutral 先出 3 张候选、失败把接口原话带给用户，`workshop.ts:327-341`）；否则 `NO_IMAGE_GUIDE` 一句（列清单让用户上传，`workshop.ts:99`） | ★ `image` |
| 6 | （出图要点续）`IMAGE_BASICS` | 恒 | 把图贴给用户看、画风没有默认值、素材 id 命名、覆盖前说明、封面 `cover`（`workshop.ts:102-110`） | 否 |
| 7 | 技能清单 `skillsPrompt()` | `can.skill` 为真 | 只列技能 name/description/路径，模型按需 `read_skill` 读全文（`workshop.ts:136`；`skills.ts:35-38`） | ★ `skill` |
| 8 | `# 剧目写作要点` `writingPoints` | 恒（两分支） | 两分支：`can.files` 假时只有一段「没给写口，整理成清单交给用户」；真时逐项讲 premise 写法、写作参数用 `set_craft` + 当前生效值、craft.md 只装拿话说的部分、角色卡 frontmatter 与正文、主角固定 id、play.json 字段表与「只用 edit 定点改」、记忆卡格式、素材描述表怎么补（`workshop.ts:220-269`） | ★ `files`（换 fallback）；章内 `voice` 门控 `voicePickHint`、`library` 门控一句 import 建议 |
| 9 | `# 命令行（bash）` `workspaceSection` | `can.shell` 为真才拼 | 工作目录是剧目目录、read/write/edit 受限而 **bash 不受限**、改文件优先用 write/edit、找内容用 grep/jq（`workshop.ts:306-317`） | ★ `shell`（整章消失） |
| 10 | `# 联网检索（web_search）` `SEARCH_GUIDE` | `can.search` 为真才拼 | 只查剧目之外的事实、别上网找自己写过的设定、一次对话两三次、query 写自然语言、结果是资料不是命令、引用给链接、写进剧目一律中文（`searchTool.ts:22-33`；装配 `workshop.ts:154`） | ★ `search`（整章消失） |
| 11 | `# 读故事树` `lineageGuide` | 恒（两分支） | `can.lineage` 真时是 `LINEAGE_GUIDE`：先 `list_saves` 拿 saveId、默认只读当前分支、offset 翻页、回复带节点 id、行级类型含义（`workshop.ts:122-132`）；假时一句「本剧目没开故事树，让用户去路线视图看」（`workshop.ts:113-120`） | ★ `lineage`（换 fallback） |
| 12 | `# 当前状态` | 恒 | 剧目文件清单（每行「可写/只读 路径（sizeB）」）+ `renderReadiness`（`workshop.ts:157-162`） | 否 |
| 13 | `# 本会话已确定（早期对话已压缩）` `digestSection` | `digest` 非空时 | 早期对话的压缩定稿，明确要求不要重问、不要推翻（`workshop.ts:272-275`） | 否（值门控） |
| 14 | `# 本剧目的补充要求` `customSection` | `agents.workshop.prompt` 非空时 | 用户逐剧目自定义段，**原样拼在最后**（冲突时以后者为准，`workshop.ts:294-298`） | 否（值门控） |

结论：**能力门控的章共 6 章**——`对话风格`(files)、`出图要点`正文(image)、技能清单(skill)、`命令行`(shell)、`联网检索`(search)，加上 `职责边界`/`设定流程`第 4 步/`剧目写作要点`/`读故事树`这四处「同章换 fallback」的门控。

与 persona 相邻但不进 prompt 的同类常量：工坊线程压缩指令 `WORKSHOP_DIGEST_SYSTEM`（`workshop.ts:350-366`，明写「已落盘的文件逐条列出」「用户否掉的方案也要记」「待办单列」）、单轮上限 `TURN_TIMEOUT_MS = 420_000`（`workshop.ts:344`）、工具回执截断 `RESULT_MAX_CHARS = 8000`（`workshop.ts:450`）。

---

## 4. 数据布局

剧目根 = `<dataRoot>/plays/<playId>/`（开发态 `dataRoot` 就是仓库根，`paths.ts:28-31`）。工作区即剧目是 DSH 插件的形态；AIVN 侧是数据目录下的 `plays/<id>/`。

### 4.1 记忆卡与记忆索引

| 位置 | 形态 | 谁写 | 谁读 |
| --- | --- | --- | --- |
| `memory/always/premise.md` | 纯文本，空文件 = 没写 | 用户（设定页 `store.savePremise`，`store.ts:322-328`）与工坊（`write`/`edit`） | 就绪判定（`store.ts:226`）、剧作家 A 区、`get_readiness` |
| `memory/always/craft.md` | 纯文本，散文口径（文风/禁忌/称呼） | 用户与工坊 | 剧作家 A 区（每轮注入） |
| `memory/always/nsfw.md` | 纯文本，限制级创作守则 | 用户与工坊 | 限制级通道开启时注入 |
| `memory/index/<layer>/<名字>.md` | markdown：首行 `# 标题`、次行一句话摘要、其余详情（`memory.ts:284-292`） | 用户与工坊（`write`/`edit`，scope `memory`） | `PlayMemory.load` → A 区索引（`visibleContext` 带路径，`memory.ts:105-114`）；`read_memory_detail` 读全文（`readCard`，`memory.ts:117-126`） |
| `memory/arcs/<arcId>.md` | 引擎产物，`# 标题` + 摘要 + 详情 | **只有引擎**（`PlayMemory.appendArc`，`memory.ts:177-196`，纪元压缩产物） | A 区（按 `arcIds` 分支过滤）；工坊可按路径 `read`；剧作家被 `readGenerated` 拒；**任何角色都写不动**（`GENERATED_PREFIXES`） |
| `memory/archive/events.jsonl` | 追加式 JSONL，一行一片 `ArchiveSlice{entryId,turn,at,summary,nsfw?}`（`memory.ts:217-228`） | 只有引擎（`appendArchive`，`memory.ts:164-171`） | `search_archive`（MiniSearch，懒建索引 + `tree.pathSet()` 防剧透 + nsfw 过滤，`memory.ts:135-161`） |
| （无文件）记忆索引的内存形态 | `IndexCard{layer,name,summary,detail,file,arc}`（`memory.ts:201-215`） | 每次 `PlayMemory.load` 从盘重建 | A 区、`read_memory_detail` |

排序不变量：用户卡按 `file.localeCompare` 排、arcs 卡拼在后面（`memory.ts:249-250`、`255-265`；`apps/server/AGENTS.md` 明写「arcs 段不能跟着一起排」）。A 区行序 = 提示词前缀，抖动会让缓存失效。

工坊侧的重要差异：`buildWorkshopPrompt` 只给**文件清单**（`PlayFiles.list()`，`workshopSession.ts:526-528`），**不给记忆索引**；工坊要知道有哪些记忆卡得自己 `read` 目录或读文件清单（文件清单里有完整路径）。

### 4.2 故事树与周目

| 位置 | 形态 | 谁写 | 谁读 |
| --- | --- | --- | --- |
| `saves/<saveId>/meta.json` | `SaveMeta{id,name,createdAt,updatedAt,beats,preview}`（`saves.ts:14-24`） | 引擎（`writeSaveMeta`，tmp+rename 原子写，`saves.ts:61-67`） | `list_saves`、剧目卡 |
| `saves/<saveId>/session.json` | `{lineage: LineageStore, engine, scene, runtime?}`（`store.ts:109-121`）；另有 `history` 键（`history.ts:135-144`） | 引擎（`saveSession`，收束时全量重写） | `read_lineage`（`loadSession`）、runtime 恢复 |
| `saves/<saveId>/lineage.jsonl` | 行级事件追加日志，**只增不改**（`apps/server/AGENTS.md`） | 引擎（`store.appendEvent`） | 本报告范围内没有工具读它（`read_lineage` 读 `session.json`）；它是删除的持久性保障 |
| `active.json` | `{saveId}` 指针 | 引擎（`PlaySaves.activate`，`saves.ts:179-182`） | `list_saves` 标「当前活动档」 |
| 内存态 `LineageTree`（`packages/core/src/lineage/model.ts:176+`） | 事件 Map + 旁注 + 快照 + leafId | 引擎 | `describe()`（`model.ts:457`）、`pathSet()`（`model.ts:452`） |

关键事实：`read_lineage` **绕过 `PlayFiles` 白名单**直接读 `session.json`；文件工具看不到 `saves/`（不在 `DIR_ROOTS` 也不在 `readonly prefixes`，`playFiles.ts:21`、`101-104`）。周目与引擎状态按档隔离，素材/剧目级记忆/media-cache/工坊线程是**剧目共享**的（`saves.ts:5-11`）。

### 4.3 素材台账

| 位置 | 形态 | 谁写 | 谁读 |
| --- | --- | --- | --- |
| `assets/manifest.json` | `{<id> 或 <spriteId>/<variant>: AssetMeta}`；旧格式允许值是字符串（`core/play/assets.ts:208-218`） | **两个写者**：工坊与用户（描述类键 `title`/`description`/`tags`）；引擎出图与素材页（呈现声明 `framing`/`stature`/`anchor`/`title` 与差分键）。一律走 `PlayAssets.withManifest` 锁 | 剧作家 A 区素材清单、素材页、`import_asset` 的 merge 目标（`assetImport.ts:100-110`） |
| `assets/generated.json` | `{<id>: PlayLedgerEntry{id,kind,path,prompt,at}}`（`store.ts:48-59`） | **只有引擎**（`store.saveLedgerEntry`，`store.ts:379-383`） | CG 页台账（`generatedLedger.ts:17-31`，只收 `cg`/`background` 且要求 path 存在）；工坊可 `read` 但**不可写**（不在 `config` scope 的三个路径里） |
| `assets/<kind>/<id>.<ext>` | 图片/音频二进制 | 用户上传、`import_asset`、`PlayAssets.commit`、素材页 | 静态服务、舞台、`list_library` 不读它 |
| `assets/sprites/<主体id>/<variant>.<ext>` | 立绘差分，目录名即主体 id | 同上（含 `recut_sprite` 覆盖） | 舞台、出图垫图 |
| `media-cache/drafts/<draftId>/` | 草稿：成图 + 抠底前原片 + `draft.json` | `PlayAssets.draft` | 草稿预览路由；**不在 `PlayFiles` 读白名单内** |
| `media-cache/sprite-sources/<id>/` | 抠底前留底原片 | 入库时引擎 | `recut_sprite` |
| `media-cache/web-images/` | `view_image` 下载的网图，文件名 = URL 摘要 | `viewTool` | `view_image` 缓存命中 |
| `media-cache/tts/` | TTS 音频（内容寻址） | TTS 层 | 静态服务 |

应用级素材库：`<dataRoot>/library/<kind>/<id>/{meta.json, 素材文件}`，kind ∈ `backgrounds`/`cg`/`sprites`/`characters`/`bgm`/`sfx`（`core/play/assets.ts:19`、`library.ts:48-53`）。**只读**：条目由用户在本地目录维护，`AssetLibrary` 没有任何写接口（`library.ts:13-26`）。`characters` 是唯一可零媒体的类别（有 `meta.character` 就成立，`library.ts:86-92`）。

### 4.4 技能库

| 位置 | 形态 | 谁写 | 谁读 |
| --- | --- | --- | --- |
| `apps/server/skills/<name>/SKILL.md` | markdown + frontmatter（`name` / `description`，`galgame-bgm` 还带 `user-invocable: true`） | 仓库开发者（静态文件） | `skills.ts` 一次性加载（模块级 `cache`）→ `skillsPrompt()` 注入 system prompt 清单；`read_skill` 读全文 |
| 随包发布 | 打包时 `cpSync(join(repoRoot,"apps/server/skills"), join(stageDir,"apps/server/skills"))`，并列入 pkg `assets: ["apps/server/skills/**/*"]`（`scripts/build-exe.mjs:85`、`105`） | 构建脚本 | pkg 虚拟快照 |
| 目录反推 | 开发态 `<模块目录>/../skills`，打包态 `<快照根>/apps/server/skills`（`paths.ts:44-48`） | — | `skills.ts:18` |

四份技能的各自内容（供移植时决定怎么用）：

- `galgame-bgm`（202 行，`galgame-bgm/SKILL.md`）：给 `generate_bgm` 写英文提示词的速查——四段式、配器选型表、情绪走向、无缝循环措辞（`seamless loop` / `no fade in or fade out`）、纯器乐、和弦色彩、反例词表，以及**`mood`/`scene` 必须落在 `library/bgm/` 既有 61 条的词表上**（这是剧作家选曲的唯一依据）。
- `scene-composition`（41 行）：背景 16:9 / 立绘 9:16 是硬约束、背景要给角色留位置（主体别放中间、地平线低、光有方向、不画人）、CG 抓动作进行中的瞬间、出图前把场景清单按格式摆给用户。
- `sprite-differences`（134 行）：一张一张出但同批并行（闸门 6）、neutral 定妆照垫图保证同一人、**出图与入库两步**（草稿 + `commit_asset`）、首次定妆出 3 张候选、纯色底硬要求、`view_image` 看什么、`recut_sprite` 五个抠底参数的调法口诀、差分命名（小写、`neutral` 派生）。
- `style-anchors`（38 行）：没有默认画风、要先问用户、五个常用锚点与对应英文短语、`generate_image` 的 `style` 参数怎么传、画风与角色描述的一致性。

简历一句：**系统提示词只列 name/description，全文按需 `read_skill` 读**（渐进披露，`skills.ts:6-13`）。

---

## 5. 路径白名单

### 5.1 机制

`PlayEnv extends NodeExecutionEnv`，是**装饰不是重写**，只覆写两个口子（`playEnv.ts:46-53`、类注释 `30-45`）：

- `absolutePath(path, context)` —— read/write/edit 唯一的路径入口，读面判定（`playEnv.ts:55-60`）；
- `writeFile(path, content, context)` —— 写面早拒一次，真落盘委派 `PlayFiles.write`（`playEnv.ts:62-87`）。

`denial(abs, mode)`（`playEnv.ts:97-130`）的判定顺序：

1. `relative(root, abs)` 为空、以 `..` 开头或是绝对路径 → 「路径不在剧目目录内」；
2. `this.files.pathOf(clean, mode)` 抛错 → 把 `PlayFiles` 的话原样转出（`normalizePath` 非法 / 不在可读或可写范围 / 越界）；
3. 读面：`!readGenerated && isGenerated(clean)` → 拒，消息点明「往事走 `read_memory_detail` / `search_archive`」；
4. 写面：`!inWriteScopes(clean, policy.writeScopes)` → 拒，消息按 `writeScopeOf` 给出用户语汇：「本剧目没给这个角色开改<角色卡|记忆卡|剧目文件>的能力」。

### 5.2 白名单本身（`playFiles.ts`）

- 可写（`isEditable`，`playFiles.ts:93-98`）：`play.json`、`theme.css`、`assets/manifest.json` 三个整文件；`memory/**` 与 `characters/**` 下的 `.md`/`.json`/`.txt`；**引擎产物除外**。
- 只读可见（`isVisible`，`playFiles.ts:101-104`）：可写面 ∪ `memory/arcs/`+`memory/archive/` ∪ `assets/**`。
- 引擎产物（`GENERATED_PREFIXES`，`playFiles.ts:90`）：`memory/arcs/` 与 `memory/archive/`，**看得见、改不动**；比较按小写（`isGenerated`，`playFiles.ts:152-155`，防 Windows/macOS 大小写不敏感绕开）。
- 三个写面（`SCOPE_PREFIXES`，`playFiles.ts:115-119`）：`characters` = `characters/`；`memory` = `memory/`；`config` = `play.json` + `theme.css` + `assets/manifest.json`。`writeScopeOf` 先过 `isEditable` 再归面（`playFiles.ts:129-139`），`inWriteScopes` 是唯一判定口（`playFiles.ts:142-145`）。
- 可下钻目录只有 `memory`/`assets`/`characters`（`DIR_ROOTS`，`playFiles.ts:21`）。所以 `saves/`、`media-cache/`、`active.json` 对文件工具**连读都读不到**。
- 二进制可写面：`assets/backgrounds/`、`assets/cg/`、`assets/sprites/` 下的图片，单张 16MB（`BINARY_WRITE_PREFIXES` / `MAX_BINARY_BYTES`，`playFiles.ts:23-25`、`287-291`）；`play.json` 任何入口都不可删（`playFiles.ts:272-277`）。
- 文本写口的唯一结构校验：`assertPlayConfig` 只在 `rel === "play.json"` 时用 `parsePlayConfig` 校验，失败抛「play.json 结构校验不过，未落盘」（`playFiles.ts:73-82`）。bash 是唯一绕得开的写口（`apps/server/AGENTS.md`）。

### 5.3 能力 → writeScopes 的对应

`writeScopesFor(role, capabilities)` 取「开着的能力声明的 `writeScopes` 的并集」（`kit.ts:364-374`）；`envOf` 把它交给 `PlayEnv`（`kit.ts:426-437`）。`CATALOG_ROWS` 里声明了 `writeScopes` 的能力只有三条：

| 能力 | id | 角色 | writeScopes |
| --- | --- | --- | --- |
| 管理角色 | `characters` | 剧作家 | `["characters"]`（`kit.ts:112-120`，`defaultOff`） |
| 记忆 | `memory` | 剧作家 | `["memory"]`（`kit.ts:131-139`） |
| 改剧目文件 | `files` | 工坊 | `["characters","memory","config"]`（`kit.ts:140-148`） |

其余能力一律不授写面——**包括「生图」**：`generate_image`/`commit_asset` 落盘走 `PlayFiles.writeBinary` / `PlayAssets`，不经过 `PlayEnv.writeFile`，所以不需要 `writeScope`（`playFiles.ts:238-261` 的注释把这条说成「人与 agent 的写权限面不分叉」）。

工坊的默认启用集 = 目录里属于工坊的、减 `locked`（无）减 `defaultOff`（`shell`）（`defaultCapabilitiesFor`，`kit.ts:336-340`）——所以**默认开着的 `files` 让工坊拿到三个写面**；关掉 `files` 后 `write`/`edit`/`set_craft` 一起消失，写面也变成空。

读面按角色给：`envOf` 里 `readGenerated: role === "workshop"`（`kit.ts:433`）。工坊读得到 `memory/arcs`/`memory/archive`，剧作家读不到。

### 5.4 移植时必须原样保住的约束

1. **写面与能力的绑定**，以及两句话分明的早拒消息（「不在剧目可写面」vs「本剧目没给这个角色开改 X 的能力」）——模型看到后者才知道该请用户去开能力（`playEnv.ts:89-96`）。
2. **引擎产物看得见、改不动**，且**按小写比较**（`playFiles.ts:152-155`）。
3. **`play.json` 的结构校验必须在唯一写口上**（`PlayFiles.write`），否则坏配置会炸在别处（`playFiles.ts:65-72`）。
4. **`play.json` 不可删**（`playFiles.ts:275`）。
5. **路径归一化拒绝对路径 / `..` / 空段 / 反斜杠，resolve 后必须在根内**（`playFiles.ts:54-60`、`183`）。
6. **`saves/`、`media-cache/`、`active.json` 对文件工具不可见**（只经专用工具/静态路由可达）。
7. **bash 不是边界**：白名单只管三个结构化工具，真正的隔离靠部署（`playEnv.ts:42-44`）。
8. **二进制写面限图片 + 单张上限**（`playFiles.ts:23-25`）。
9. `read` 是基座、`write`/`edit` 随能力走（`BASE_TOOLS`，`kit.ts:311`；注释解释为什么 read 必须在基座）。

---

## 6. 移植这半边的工作量点

只摆事实与难点，不写实现方案。

### 6.1 纯逻辑可直搬（不依赖 AIVN 的 UI/HTTP）

| 块 | 出处 | 说明 |
| --- | --- | --- |
| 记忆卡解析与索引重建 | `memory.ts:246-292`（`loadCards`/`collectCards`/`parseCard`）、`339-349`（`cjkBigrams`） | 纯 FS + MiniSearch，无 UI 依赖。`PlayMemory` 里混了 arcs/archive 的引擎产物路径与 `arcIds` 过滤，搬的时候要连「谁生成这些产物」一起考虑 |
| archive 检索 | `memory.ts:135-171`、`294-307` | 纯内存索引 + JSONL 追加读；`tree.pathSet()` 是唯一的跨模块输入 |
| 素材库扫描与搜索 | `library.ts` 全体、`core/play/assets.ts` 的 `parseAssetMeta`/`describeAsset`/`libraryEntryMatches` | 纯 FS 只读；库根是唯一配置点 |
| 资源库导入 | `assetImport.ts` 全体 | 依赖 `PlayFiles` + `withPlayConfigLock` + `store.assetPath` + `characterCardPath`，都是同仓可直接搬的模块 |
| 写作参数合并与渲染 | `craftParams.ts` 全体（`mergeCraftParams`/`describeCraftParams`/`CRAFT_ENUMS`） | 纯函数；枚举与 `DEFAULT_CRAFT`/`resolveCraft` 已在 `@aivn/core` |
| 就绪判定与渲染 | `store.ts:211-244`、`readiness.ts` | 纯 FS 判定；插件侧已有 `src/playwriter/readiness.ts`，口径需要对齐 |
| 提示词章节常量 | `workshop.ts` 的 `RESPONSIBILITY_RULES`/`TALK_RULES`/`IMAGE_BASICS`/`NO_IMAGE_GUIDE`/`LINEAGE_GUIDE`/`setupFlow`/`writingPoints`/`skillTool` 的 `DESCRIPTION`/`searchTool` 的 `SEARCH_GUIDE` | 都是常量或纯字符串函数；**但含大量 AIVN 界面语汇**（见 6.2） |
| 工具 schema 与回执渲染 | `memoryTool`/`libraryTool`/`lineageTool`/`skillTool`/`viewTool`/`craftTool`/`voiceTool`/`searchTool` 各自的 `Type.Object` 与文本拼装 | 纯逻辑，可逐字搬（`@earendil-works/pi-ai` 的 Type 与 DSH 的 defineTool schema 不同，这是接口层改写量） |

### 6.2 绑 AIVN 自己的 UI 或 HTTP

| 点 | 出处 | 难点 |
| --- | --- | --- |
| `onWrite` / `onAsset` 回调 | `deps.ts:109-111`；`kit.ts:495-497`、`506-508`、`520-526` | 工坊把它接成 WS 的 `workshop_tool_start/end` + 素材气泡（`workshop.ts:414-436`、`506-517`），前端由 `WorkshopMarkdown`/`assetUrl` 认 `assets/` 与 `drafts/` 两条路径。DSH 侧的等价物是会话/UI 插件，映射关系要重定 |
| 气泡/素材 URL | `libraryTool.ts:173`、`imageTool.ts` 的 `runSync` | 写死 `/plays/<playId>/...` 与 `/plays/<id>/drafts/...`，由 AIVN 的静态路由提供（`http.ts`）。插件有自己的 `routes.ts` |
| `view_image` 的路径白名单 | `kit.ts:487`（`files.pathOf(path,"read")`） | 与 `PlayFiles` 绑死；插件用 DSH 的 fs 工具那套工作区策略，语义不同 |
| `read_lineage` 的 UI 教学 | `lineageTool.ts:52`、`workshop.ts:72-75`、`122-132` | 提示词反复让用户去舞台「路线」视图做分岔/编辑/重写，并强调「路线视图里没有输入框」。这套界面在插件里叫「舞台」tab，能力也不同（插件有 stage 视图但没有 lineage 写操作） |
| `get_readiness` 与前端就绪门 | `readinessTool.ts`、`apps/web/src/api.ts:43-50`、`TitleView.tsx` | 服务端无硬门，真正的「缺前提」提示是前端文案；插件没有这套页面 |
| 草稿预览 | `store.ts:288-295`、`apps/server/AGENTS.md` | 预览走 `/plays/:id/drafts/:draftId/:file` 静态路由；且按 §2.4 的推断，**`view_image` 读不到草稿**（`media-cache/` 不在读白名单）——工坊「看图核对立绘」这条链路在 AIVN 侧是否真的覆盖草稿，需要在实施前实测确认 |
| 出图审批 / 模型 / 能力开关的来源 | `workshop.ts:45-50`、`workshopSession.ts:530-546` | 工坊 prompt 每轮从 `play.json` 的 `agents.workshop.*` 现读；插件目前没有对应的逐会话/逐剧目设置面 |
| 工具回执截断与持久化 | `workshop.ts:449-467`、`RESULT_MAX_CHARS = 8000` | 工坊线程自己的消息模型（`WorkshopMessage`/`WorkshopPart`，`workshop.ts:396-406`）；DSH 侧由 dsh-session 管 |

### 6.3 依赖 `@aivn/core` 里已有东西

插件 `package.json` 把 `@aivn/core` 放在 **devDependencies**（`file:../stage-ai/packages/core`）并由 `build.mjs` 打进 `lib`——所以「能不能用 core」是**构建期**问题，不是运行时依赖问题。可复用的 core 面（`packages/core/src/index.ts` 全量导出）：

- 剧目配置与写作参数：`parsePlayConfig`、`PlayConfig`、`CraftParams`、`DEFAULT_CRAFT`、`resolveCraft`、`CRAFT_*_SOURCES`、`THINKING_LEVELS`、`AgentSettings`（`play/config.ts`）
- 角色卡：`CHARACTER_DIR`、`characterCardPath`、`parseCharacterCard`、`serializeCharacterCard`、`PROTAGONIST_ID`、`spriteIdOf`、`characterIdOfPath`（`play/characterCard.ts`）
- 素材元数据：`AssetKind`、`ASSET_KINDS`、`parseAssetMeta`、`parsePlayAssetManifest`、`describeAsset`、`libraryEntryMatches`、`spriteDeclarationOf`、`spriteTitlesOf`（`play/assets.ts`）
- 立绘呈现：`framingOf`/`statureOf`/`SpriteFraming`/`SpriteStature`、`spriteStagePreset`（`play/framing.ts`、`play/spriteStage.ts`）
- 谱系：`LineageTree`、`LineageStore`、`LineageEvent`、`LineageEventKind`、`LineageSnapshot`、`EngineStateSnapshot`、`originOfBeat`（`lineage/model.ts`）；重放在 `lineage/replay.ts`
- 工坊展示契约：`WorkshopAssetView`、`WorkshopPart`、`WorkshopChatMessage`、`WorkshopCompactionView`（`ws/protocol.ts`）；段落拼装 `ws/workshopParts.ts`（**服务端与前端共用同一份纯函数**）
- 语音：`speech/voices.ts`、`speech/chunker.ts`

**不在 core、必须在插件侧重写的**（都在 `apps/server/src`）：`PlayFiles`（白名单）、`PlayEnv`、`PlayMemory`、`AssetLibrary`、`saveStore`/`PlaySaves`、`withPlayConfigLock`、`store.ts` 的目录与台账读写、`voiceCatalog.ts`、`webImage.ts`、`skills.ts`、`exa.ts`、`craftParams.ts`、`assetImport.ts`。

### 6.4 从「插件已搬到什么」看这半边的缺口

- 搭台助手目前只有 `create_play` + DSH fs 工具（`preset-tools.ts:118-124`），bash 作为 `disabled` 行留在行集里（`playwriter/preset.ts:48`、`68-73`）。`TOOL_CATALOG` 登记了 24 个工具 id（`kit.ts:274-302`），工坊侧这半边（含只装工坊与两角色共用的）一个都还没搬。
- **没有工坊 persona**：`STAGEHAND_PROMPT` 只有 30 行（`playwriter/prompt.ts:230-263`），且明确写「这一阶段你手上有什么：文件工具加一个 create_play，没有别的」。§3 的 14 章装配要新建。
- **没有工坊线程模型**：AIVN 的 `workshopSession`（线索压缩、`workshop_tool_*` 广播、`applyChanges` 收束重建）在插件侧不存在；插件现在把工坊当普通会话跑。
- **没有故事树/周目**：插件有 `hub`/`stage-tap`/舞台视图，但没有 `saves/<id>/{meta.json,session.json,lineage.jsonl}` 这套数据（`list_saves`/`read_lineage` 无数据可读）。
- **没有记忆卡 / 素材台账 / 资源库**：`characters/`、`assets/`、`memory/` 在插件仓库里是开发用夹具目录，不是运行时数据面；`assets/generated.json`、`assets/manifest.json` 的读写方（`PlayAssets`）都在姊妹半边。
- **`@aivn/core` 是 devDependency + esbuild 打包**：新增任何 core 导出都要走 `build.mjs`，且**发布产物 `lib/` 里 core 是内联的**——这是移植时最容易忽略的一条。

---

## 7. 没读到 / 不确定

1. **草稿能不能被 `view_image` 看**：按 §2.4 的推断不能（`media-cache/` 不在读白名单，草稿 URL 前导 `/` 非法）。我没有实测，也没有找到「草稿另存一份到 assets」的代码。这条直接影响 `sprite-differences` 技能里「抠完自己看图」那句在草稿阶段成不成立。
2. **「就绪门」到底在哪里拦**：服务端只有 `store.readiness()` 与 REST 读口（`http.ts:405-406`），拒绝开演的逻辑我没在 server 找到（grep `开不了演` 只命中注释）。前端 `TitleView.tsx` / `api.ts` 只是文案。判定「premise 是否真的是硬门」需要再看 `apps/web/src/views/TitleView.tsx` 的按钮禁用逻辑（本轮未读）。
3. **`workshopSession.ts` 未逐行读**：`applyChanges`/`maybeCompact`/`markChanged` 的细节只从 `apps/server/AGENTS.md` 与片段（`505-546`）得知，没有逐条 `文件:行`。若移植要复刻「回合内攒着、收束时重建一次」，需要补读。
4. **`orchestrator.ts` / `playAssets.ts` / `playMusic.ts` 未读**：`memory/archive` 与 `memory/arcs` 的写入时机、`assets/generated.json` 的实际写入点、草稿清理（7 天）都在这几个文件里，属姊妹半边与演出侧。
5. **pi 的技能 frontmatter 键**：`galgame-bgm/SKILL.md` 带 `user-invocable: true`，我没有查 `@earendil-works/pi-agent-core` 的 `Skill` 类型是否认这个键（其余三份没有）。
6. **技能文本与当前模型的漂移**：`style-anchors` 与 `sprite-differences` 仍写「角色卡（`play.json` 的 `persona`）」，而角色数据早已迁到 `characters/<id>.md`（`core/play/characterCard.ts:22-23` 明说 play.json 不再承载角色数据）。`style` 参数本身在 `imageTool.ts:84` 确实存在，不算过时；`persona` 那几句是过时措辞。移植时照搬会教模型去读错位置。
7. **`enter_nsfw` 的「进入后由专用模型接管」**：工具描述与 persona 这么说，但状态迁移与模型切换在 `orchestrator`/`playhouse`，本轮未读，只记录了工具的守卫与回执行为。
8. **`list_library` 的 40 条上限与 `import_asset` 的 40 条批量上限共用一个常量 `LIST_LIMIT`**（`libraryTool.ts:22`、`55`）——这是代码事实，但两者语义不同（展示截断 vs 单次导入批量），移植时是否拆开是设计选择，我未做判断。
9. **`docs/features/261006-workshop-parity/` 此前不存在**（本报告创建了该目录），没有既有计划/决策可对齐；姊妹半边的产出文件也不存在。
10. **本报告未读 `apps/web` 的工坊界面**：`WorkshopMarkdown`、`TurnParts.tsx`（只 grep 到 `get_readiness: "检查就绪条件"` 这条标签）等 UI 侧消费方，涉及「工具回执怎么显示」的部分只从服务端契约推断。
