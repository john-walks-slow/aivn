# apps/server AGENTS.md

## 职责

- `apps/server` —— 后端：REST + WS 舞台广播 + 演出编排（`orchestrator.ts`）+ 工坊会话（`workshopSession.ts`）+ `playhouse.ts`（按剧目缓存 runtime / PlayAssets / 模型）。

## agentkit：两个 agent 的共用基座

- **两个 agent 共用一套基座**：`src/agentkit/` 是唯一工具实现面（`kit.ts` 按 `role: "playwriter" | "workshop"` 装配，`deps.ts` 用判别联合收窄依赖），同一工具**同一份 schema 与实现，只有 description + 等待策略 + 注入依赖不同**（`generate_image`：工坊 sync 等图并回 markdown 图片、剧作家 queued 后台排产只占时间线位置）。
- **两套目录，一份语汇**：`kit.ts` 的 `CAPABILITY_CATALOG` 是**用户语汇的唯一真相源**（一行写清：界面名字、一句后果、分组、给哪些角色、授权哪些工具 id、开出来能动哪几类文件、常开还是默认关）——Agent 页、`play.json`、`kit.can`、提示词章节一律说能力。`TOOL_CATALOG`（id + 中文名 + 谁装得上）留在工具层当**角色可见性的真相源**，能力只**引用**工具 id；装一个没登记的 id 或加一个谁都够不到的工具，用例当场红。play.json 的 `agents.<role>.capabilities` 存**启用集**（白名单，不是禁用集），缺省走 `defaultCapabilitiesFor(role)`（搭台 = 目录里属于它的能力减 `shell`——新增能力不会静默漏装；剧作家 = 常开的 `stage` 加 `memory`/`image`/`library`/`search`/`nsfw`，**`characters` 默认关**：角色卡是制作资产、记忆卡是剧情事实）。
- **两条推导都在 `createAgentKit` 一处**：装上的工具 = 基座 `read` ∪ 开着的能力授权的工具（再按 `TOOL_CATALOG.roles` 与我方依赖面收一道，没配 Exa / TTS / 生图就装不出来）；`can` 位 = **该能力开着且它授权的工具都装上了**（键就是能力 id）——能力声明了一个装不出来的工具，这一位就是假，提示词不会教模型去调它没有的东西。同一个能力在两个角色上授权的口可以不同（`image`：剧作家只要 `generate_image`，工坊还要 `recut_sprite`；`library`：工坊多一个 `import_asset`，实现上是 `libraryTool` 的 `importAsset: false`）。
- `generate_image` 的两个角色**同一份 schema**（`spriteId`/`variant`/`title` 与 `references` 都拿得到——垫图读 `assets/sprites/`，与谁调的无关），只差 description 与等待策略。**垫图入口只有一个 `references`**（每项可以是主体 id、剧目内相对路径或 http(s) 网址，1–6 张；`referenceCharacters` 保留为只吃主体 id 的兼容别名，两者在工具层合并去重）。**`neutral` 定妆照可以垫外部参考图**（用户拿一张既有角色图来定妆走的就是这条），background/CG 也按它垫图；**非 neutral 的立绘差分不吃 `references`**——身份基准恒为该主体的 `neutral` 定妆照（传了直接报错，因为换基准会与既有差分不是同一个人）。
- **卡是可选的，出图也不替谁建卡**：`generate_image` 只按 `spriteId`（主体 id）往 `assets/sprites/<id>/` 落文件——机甲、道具、猫本来就没有卡。名字从哪来：卡 `name` → `<say name>` → 素材表 `title`（`generate_image` 的 `title` 参数就是给无卡主体落名牌用的）→ id；无卡主体的 TTS 走剧目级 `defaultVoiceId`。
- **出图顺手写呈现声明**：`playAssets.declareSprite` 把 `framing` / `stature` / `title` 写进 `assets/manifest.json`（neutral 那一次立立绘级，`variant` 与立绘级取景不同才写一条 `<id>/<variant>` 覆盖），与卡无关——卡只管人设与音色，立绘声明归素材表。
- **同名工具调用并发**：写角色卡的落盘与 generate_image 的成员校验原本实时读盘，同批发出时谁先完成不定，会偶发扑空。
- `playhouse.writeCharacter` 在落盘**之后**把 id 登记进 `knownCharacters`（WeakMap<PlayStore>），`characterIdsOf` 那个回调读实时盘 ∪ 它，竞态就没了；顺序反了会在写失败时留下一个并不存在的 id。
- 剧作家走通用 `write` 时，同一步（`orchestrator.onPlayFileWritten` → `playhouse.onPlayFileWritten`）按 `characterIdOfPath(write.path)` 认角色卡并登记，两条路汇到同一处。
- **无名角色音色**：`<say id="passerby" name="路人甲">` 这种一次性角色没有角色卡、而音色挂在角色卡的 voiceId 上，于是永远没声音。
- 两处兜底都在 `orchestrator`：`voiceOf` 取卡的 voiceId、没有卡就落剧目级 `defaultVoiceId`（工坊「剧目」页挑）；名字取卡的 `name` → `<say name>` → 素材表 `title`（素材页的「名牌」）→ id。
- **抠底参数不在它上面**（填参数得先看过成图，出图那一刻没人看过），改抠底走工坊专有的 `recut_sprite`——立绘落盘前把抠底前的原片留一份到 `media-cache/sprite-sources/<主体 id>/`（跑批产物不进 git），重抠拿它本地重跑一遍 `cutout.ts` 覆盖 assets/ 里那张 PNG：画面一个像素不变、不烧配额、几秒出结果。
- 没有留底的（更早出的图、用户上传的）直接报错，只能重新出图。
- `import_asset` 现在**只装给工坊**（`TOOL_CATALOG` 的 `roles` 只留 `workshop`）——剧作家的默认导入路径是引用即导入（见下），给它留一个自己搬素材的口是重复路径，只是多一个谁都够不到的工具。工坊那边它挂在「素材资源库」能力下（`libraryTool` 的 `importAsset` 开关，剧作家侧传 `false`）。

## DSL、轮收束与 IR 事件

- **DSL 是时间线、工具是副作用**：`beat_done`（轮收束 + 停止点载荷，`options` 若干条 / `placeholder` / 都不给；schema 只兜「至少两条非空」这个无效载荷，**给几条、何时给归剧目的写作参数**，见下）与 `generate_image` 产出 `stop` / `preload_asset` 两个 IR 事件，经 `emitStageEvent` 与解析器产出的事件走同一条路（加 seq → 广播 → 落谱系），client 侧一行不用改。
- **玩家输入也是这条管道的一等事件**（2026-10-04 回声层拆除）：`playerAction` 的选项/自由输入经 `onStageEvent({ kind: "player_input", text })` 广播，**先于 autostart 的 `beat_start`**——客户端「选完立刻见回执」靠这个时序，别改成先开拍再补发；`accumulateLineage` 把它落成带 `payload.seq` 的 prompt 节点（core 的 `lineageToEvents` 重放时还原成 `player_input` 事件）。NSFW 打标不变：`noteBeatInputs` 在事件发出前定，prompt 落谱系照走原路径。升级前的老档 prompt 节点没有 seq，客户端按路径顺序+同文本认回。
- **判废只认「三无」轮**：无台词、无停止点、且没调用过带副作用的工具（`beat_done` 只是收束记账，不算）才判废回滚。纯工具轮——只调 `enter_nsfw` 交棒、只发起生图、只写记忆/角色卡——按 no_stop 正常收束：副作用已经发生，回滚会吞掉它们（`enter_nsfw` 的 pending 会被重置回日常模型）。DSL 控制指令（scene/actor）仍不算内容。
- 文本形式的 `<stop>`/`<option>`/`<preload_asset>` 已从 DSL 摘除，遇到只静默降级并记 `legacy_tag` 警告（照读会把标签念到舞台上）。
- **一个槽位叫 `variant`**：`<actor id="mio" variant="smile">`。`expression`（人写表情）与 `state`（非人的状态）是 261004 之前的两个旧名，解析器与谱系重放仍当别名收下，所以存量剧本与存档照常演出；但写给模型看的契约只有 `variant`。同一个 id 的立绘声明、差分、垫图基准都按它解析。

## 谱系原语（跳转 / 分岔 / 重写 / 删除）

- **回到旧轮走原路**：`playerAction` 在生成之前先查树上有没有现成的下一拍——挂载点必须停在 `beat_end`（轮中锚定不认），本次动作的**来源标签**（`originOfBeat`：prompt 是那次输入原话、fork 继承被顶掉那一拍的来源、其余是 `continue`）与 `leafId` 某个子节点相同就走进去，`beatEndFrom` 取那一拍的末节点后 `rebaseAt(endId, …, {mark:false, playFrom:"start"})`，**一拍拍接**：跨轮的停止点重新摆出来，玩家随时能改选别的选项就地分岔。候选必须是「有内容的一拍」（`beatEndFrom` 解得出来），排队里有待注入的引导时不认旧路。
- **`prevLeafId` 是复用规则的唯一偏好依据**，字面定义是「上一次显式结构操作（`jumpTo` / `forkTo` / `deleteBranch`）之前世界线所在的那个节点」——够用的前提是「想回到旧轮就必先做一次结构操作」。只在动词进入时写一次，`rebuildBranchAt` 里**不写**（逐拍回退会把它冲掉）；删除时悬空要回落，读档时缺字段或指向已删节点一律按「无偏好」。
- **重写的来源继承**：新 fork 标记必须带上被顶掉那一拍的 `origin`，否则玩家回到同一锚点重选同一选项时认不出这条重写枝。优先取客户端点名的 `replaced`（本轮首节点），其次取「世界线在锚点之下」时路径上的那个孩子。锚点由客户端算（`BeatCard.forkFromId`）＝**本轮之前的那一点**（首节点的父；第一轮没有前驱就退回首节点自身），整轮连内容一起重来。本轮由玩家的一句话开头时，那句话由客户端作为 `replaced` 一起点名、服务端 `replacedInput` 取回原话带进新枝（见下条）——**不要把锚点改到那个输入节点上**：`LineageTree.beatEndFrom` 见分叉点（输入节点有 2 个孩子）就返回它自己，玩家回到锚点重选同一选项时会落在那句输入上而不是走回刚重写的那条枝（2026-10-04 实测）。两条重写入口（路线卡片 / 舞台导演栏）走同一套口径。
- **重写/分岔带的交代跟着这一岔一起发**（`fork.instruction` → `forkTo` 的 `deliverForkInputs`）：它是新枝**这一轮**的输入——与「插一句」同一条入账路径（`deliverPrompts`：落一个 prompt 节点 + 广播 `player_input` + `beginBeat` 的 `【用户输入】`），不是排进 `pending` 等下一轮兑现。分岔不 resume 时带上它 = 新分支立刻照这句开演。判废退回时它照常回到队列（`returnBeatSteers`）。
- **被顶掉那一拍的原话也带进新枝**（`replaced` 是 prompt 节点时由 `replacedInput` 取回）：新枝只带【状态】的话剧作家不知道自己当初在回应什么、只能凭空接话。它与交代的差别只在判废退回——原话是旧枝上那句话的副本，旧枝上本来就在，所以它只落节点、进 `trailingInputs`，**不当引导**（再排一次等于同一句话进两次谱系）；交代是待兑现的引导，照旧还回队列。
- **删除是剪整条子树**（协议 `delete_branch`，`nodeId` = 该段首节点）：`removeSubtree` 删节点与后代、清快照与改写旁注、**上溯清空壳 fork 标记**（fork 是卡片首节点的父、不进卡片，只删卡片会留下一个带来源标签的空节点）。世界线本来就不在这条枝上时它不会被动，重建因此是幂等的。`rebase` 消息带 `keepView`，删除后客户端留在路线视图。
- **回看里的插图是旁注，不是节点**（`LineageTree.recordCg` / `orchestrator.attachCg`，与原地改写同一套）：图挂在「玩家正看的那一行」上，**不入树、不动挂载点、不分叉**——链上每个节点只有一个孩子，往链里插一个节点必然要么挪走它原来的下一个（=分叉）要么掰链改结构。协议上 `generate_cg` 的 `anchorNodeId` 是三态：不给 = 现场（末尾落 `cg` 节点，`directorCg`）、给 id = 挂那一行、`null` = 在回看但这一行还没进谱系（**明确拒绝**，退成末尾生图会往世界线上多落一个节点）。两类旁注（改写 / 插图）统一在 `notes` 一张表里，`export()` 排在树事件之后、`load()` 分流回来、剪枝时连旁注一起清。
- **`flushLineageLog` 按「已推事件 id」补推，别用条数当游标**：事件流是「树事件 + 恒排末尾的旁注」两段拼接，分叉标记（`recordFork`）会插在旁注**前面**——用已推条数切片时，有旁注之后新标记漏落盘、旧旁注被重复落盘（2026-10-04 实测修掉）。
- **`lineage.jsonl` 只增不改**，读档只读 `session.json`——删除的持久性靠它。已知边界：若将来改成从 `lineage.jsonl` 重建，已删内容会复活。

## 工坊线程（压缩、消息文件与文件工具）

- **工坊线程也有纪元压缩**：`workshopSession.ts` 的 `maybeCompact` 每轮开跑前判定（与演出侧同一时刻、同一套 `compaction.ts` 计量与切点），但产物落线程的 `compaction` 字段而不是 `memory/arcs`——工坊会话是搭台过程、不是剧目事实，进 arcs 会污染剧作家每轮注入的 A 区。
- **消息文件一条不删**：只有前 `cutAt` 条移出 agent 上下文，面板照常显示（旧对话照常在，只是中间多一条可点开的分隔）。
- **助手回复落成段落流**（2026-10-04）：`WorkshopChatMessage.parts` 是 text / thinking / tool 的有序数组，拼装规则在 core 的 `ws/workshopParts.ts`，**服务端与前端共用同一份纯函数**——各写一遍的症状是「流式时看着对，收束后换了样」。WS 上 `workshop_tool` 因此拆成 `workshop_tool_start` / `workshop_tool_end`（`end` 带 `result` / `isError` / `ms`，`ms` 由会话里一张 `startedAt` 表算），新增 `workshop_thinking`；`workshop_done` 与 `workshop_error` 都带权威 `parts`，前端收束时用它整段替换流式期间自己拼的那份。工具结果截到 `RESULT_MAX_CHARS`（8000 字，图片块记 `[图片]` 不搬 base64），**思考不截断**——截了前端的流式版本就与服务端那份对不上。
- 工坊模型可以和剧作家不同，阈值因此另有一套（`settings.json` 的 `workshopContext`，缺省逐项沿用全局），生效值再与模型自带窗口取 min。
- 摘要回注 A 区（工坊 A 区本就每轮重建，没有前缀缓存约束），多轮是**拿旧定稿重写成一份完整文档**而不是叠加（`capDigest` 封顶 6000 字）。
- read / write / edit / bash 全部是 **pi 的内建工具**（`agentkit/piTools.ts` 只做 `AgentHarnessTool → AgentTool` 的适配，把 `onUpdate`/`toolContext`/`invocation`/`context` 补齐，`context` 用 `withAbortSignal(signal, BACKGROUND_CONTEXT)` 把工坊单轮的 7 分钟超时传下去）。**前三个两个角色都装**，`bash` 只装工坊。
- 路径白名单与 `play.json` 结构校验收在 `playFiles.ts` 的 `PlayFiles` 上——它是**所有文本写口的收口**（两个 agent 的 write / edit、文件页、角色卡都从 `write` 过；可写目录是 `memory/**` 与 `characters/**`），校验不过就不落盘、盘上那份一个字节不动。**白名单不分角色**：两个 agent 写的是同一批文件（角色卡、记忆卡），再分一份只会多一处要同步的地方。
- `memory/arcs/`（纪元压缩产物）与 `memory/archive/`（逐轮切片）是引擎产物且跟分支走，**看得见、改不动**（`GENERATED_PREFIXES`）：手改手建会绕过 arcs 按 arcIds、archive 按 pathSet 的防剧透过滤。这两条从前由 `write_memory` 的路径守卫兜着，收掉专用工具之后改由文件层兜。
- **写面收在 `PlayEnv`，不在 `PlayFiles`**：能力声明的 `writeScopes`（`characters` / `memory` / `config`，路径知识只在 `playFiles.ts` 的 `SCOPE_PREFIXES` / `writeScopeOf` / `inWriteScopes` 里）随 `PlayEnvPolicy` 传进 `PlayEnv`，早拒时给两句不同的话——「不在剧目可写面」与「本剧目没给这个角色开改<角色卡|记忆卡|剧目文件>的能力」。挂到 `PlayFiles` 上会连带打断文件页、craft/premise 写口与 `applyChanges` 的读盘检查（工坊只有一个 `PlayFiles` 实例，它同时是这四处的口）。
- **读面按角色给**：`PlayEnvPolicy.readGenerated` 只在工坊为真——剧作家按路径读不到 `memory/arcs/` 与 `memory/archive/`（那两个目录跟分支走、按 arcIds / pathSet 过滤，而文件是剧目级、不随回滚消失，通用 `read` 直接翻等于把别的世界线摊开），要看往事只能走 `read_memory_detail` / `search_archive`。题面是 `absolutePath`（read/write/edit 共同的路径入口），所以这三个动作用引擎产物路径时都会先撞上这条读面拒绝。
- 撤销条在 `agentkit/playEnv.ts` 的 `PlayEnv extends NodeExecutionEnv` 里——**装饰不是重写**，只覆写两个口子：`absolutePath`（读面，read/write/edit 唯一的路径入口）与 `writeFile`（写面，早拒白名单与写面能力 + 记撤销条，落盘委派 `PlayFiles.write`）。
- pi 的 `withFileMutationQueue` 顶掉了原来的 `fileLocks`（WeakMap<env> + canonicalPath，同一 `PlayEnv` 实例内自动串行）。
- **bash 不走这一层**：它继承 `NodeExecutionEnv.exec`，cwd 就是剧目目录，以服务进程的权限跑、改文件不进撤销条，所以「命令行」这一能力**默认关**，`can.shell` 决定提示词注不注「命令行」那章（讲的是边界与后果，不是用法——cwd/截断/超时都在 pi 的 bash 描述里）。
- `workshopSession` 订阅 `tool_execution_end`，跑过 bash 就置脏。**置脏只有 `markChanged()` 一个入口**（agent 写盘、素材到货、bash、文件页手改四条路都从这儿过），**收束只有 `applyChanges()` 一个出口**：真有改动才重建——回合内攒着、收束时重建一次，文件页保存没有收束可等、就地兑现。
- bash 绕开了 `PlayFiles` 的结构校验，所以 `applyChanges` 在重建前补一次读盘检查：`play.json` 已解析不了就**跳过这次 runtime 重建并广播 `workshop_error`**（带着坏配置去 rebuild 只会抛在 `void` 的 promise 里，用户看到的是「面板不刷新了」而不是「哪里坏了」）。
- play.json 校验失败的消息只有走 `write` 才原样回给模型——pi 的 `edit` 把它包成「Could not edit file: …. Error code: invalid.」，原因只留在 cause 上，不为消息粒度再造第二套错误面。

## 素材、出图与台账

- 出图**只有一层**：`PlayAssets` 落 `assets/`，工坊与剧作家共用一个实例，同一张图在飞去重只烧一次配额。
- `ImageAssets`（media-cache 里的 bg/cg 内容寻址缓存）已删——`media-cache/` 现在只剩 TTS 音频、立绘留底原片（sprite-sources/）与 `view_image` 下载的网图（web-images/）——全是可重建的中间物。
- 代价是内容寻址去重没了：同一句提示词生成两次会真出两张图，剧作家侧改由工具自己判「剧目里已有同名素材就跳过」（`playAssets.existingUrl()`）。
- CG 页的生成台账只有 `assets/generated.json` 一份（`generatedLedger.ts` 的 `readPlayLedgerEntries`）。
- **一张表一个写者**：`assets/manifest.json`（素材描述）归工坊与用户，`assets/generated.json`（站内出图这次用的 prompt 记录，进 git、只读）归引擎——两边都动一张表时，工坊补一条中文描述就能把引擎记的 prompt 整条替换掉（2026-10-01 实测）。
- **`manifest.json` 现在有两个写者，好在键位不重叠**：`title`/`description`/`tags` 这些描述归工坊与用户，呈现声明（`framing`/`stature`/`anchor`/`title`）与差分键归引擎出图与素材页；两边都是「读-改-写整表」，所以一律走 `PlayAssets.withManifest` 那把锁（同一剧目串行），不许各自读一遍再整表覆盖。
- **音乐生成是第三个写者，但键仍不重叠**：`playMusic.ts` 的 `PlayMusic` 落 `assets/bgm/`，只补它确知的那几格（`title`/`mood`/`scene`/`loop`/`volume`/`source`），同样走 `withPlayConfigLock`；`description` 不动（归工坊与用户）。它**刻意不并进 `PlayAssets`**——那个类的垫图、抠底、画幅档位、立绘差分基准全是给图准备的，音乐一条都用不上，硬塞会让一个类同时管两件不相干的事。
- **音乐只装工坊**（`generate_bgm`，能力「生成 BGM」，`roles: ["workshop"]`）：一首 ~175s 的曲子实测要 84s，剧作家一轮 240s，塞进演出回路等于整轮都在等一首歌落盘。**产物是 M4A（AAC 48kHz 立体声），落盘扩展名跟着上游返回的 mime 走**（`audio/mp4` → `.m4a`）——写死 `.mp3` 会让浏览器按错的 codec 播，而 `.m4a` 这条链路（`http.ts` 的 MIME、`store.listAssets` 的过滤、素材页的 `<audio>`、`stemMap`）本来就通。提示词的最佳实践在技能库 `galgame-bgm`，工具描述只留契约，与出图那条渐进披露同一套规矩。

## 立绘：后缀、景别与画幅

- **呈现声明只住 `assets/manifest.json`**：键 `<id>`（立绘级）与 `<id>/<variant>`（差分覆盖），字段 `framing` / `stature` / `anchor` / `title`；卡上的 `framing` / `spriteFraming` 与 `sprites` 映射表一并下线——variant 就是文件名主体，中间不再有映射这一层。`play/spriteStage.ts` 按 取景 × 体量 × 锚点 出落位预设（`spriteStagePreset()` 给横竖屏两套 `{top,height,origin}`），**改预设表等于动所有剧目的摆位**：表里的 `top` 是头顶留白，2026-10-04 统一下移过 8（normal 档横屏 10→18、竖屏 8→16），此前「缺省逐个数字与 261004 之前一致」那条约束已作废，别再拿它当不动表的理由。
- 立绘的自动后缀只规定抠底要的构图（**单一纯色底**，且这个色键色不许出现在角色身上；手臂与躯干之间别夹窄缝），不描述任何人物特征：那里曾写着「twin tails」，等于给所有角色定了个双马尾，prompt 里明写 long straight hair 也救不回来。
- **抠底是纯色键，底色由出图那一步负责选对**（`src/cutout.ts` ↔ `playAssets.ts` 的 `KEY_BACKGROUND`）：底色取整圈边框的逐通道中位数，离它不超过 `tolerance` 的像素**一律**算背景——不分内外、不看连通性、没有面积阈值。所以「白底 + 白袜子」那类撞色会被照抠不误，2026-10-04 之前为此堆的滞回阈值/连通域筛内外/面积阈值整套已删；嫌抠不干净只有两条路：调 `tolerance`，或者出图时换一个不撞色的底。
- **立绘景别与画幅跟着 `framing` 走**（`play/framing.ts` 是唯一真相源：**三档** full 9:16 / half 3:4 / square 1:1，出图画幅取 `SPRITE_FRAMING_ASPECT`、提示词里的景别措辞取 `SPRITE_FRAMING_SHOT`；写死 9:16 全身时半身角色照样会被画成全身，出图与舞台声明对不上）。
- **没有 bust 档**——胸像的价值已被 `shot` 运镜吃掉，留着只是多一个让模型选错的出口。
- 存量声明按 `LEGACY_SPRITE_FRAMING` **降级到 half 而不是丢弃**：丢掉等于让一张胸像按全身摆位，错一个躯干量级且用户看不出来。
- `square` 是**给非人 sprite** 的：猫、道具没有头肩腰之分，全身/半身这套人形术语套上去语义不通，正方形让这类主体占满画布又不浪费左右空间。
- 画幅必须落在**上游真正支持的取值**内——走 flow2api 时 Google Flow 只有 1:1 / 9:16 / 16:9 / 4:3 / 3:4 五档，原先 half 用的 2:3 发过去不报错、静默退回 16:9，出图直接变成一张横的，重试也没用。
- **3:4 / 4:3 两档的枚举也曾被该网关接反**（2026-09-29 那次实测因此被误读成「上游不认 3:4」），2026-10-04 已在本机网关的出口换算里修正并真实出图复通——所以 `half` 就写 3:4，别为了绕开它改成 4:3。

## 生图后端

- 生图后端本机默认走 flow2api（「生图地址」填 `http://127.0.0.1:38000`，账号 credits 计费、额度 988 起）：cpa 网关的 `gemini-3.1-flash-image` 几分钟就撞一次 429 额度耗尽，做不了连续出图与对照实验。
- 两套后端的协议形状一样，换回去只改设置页里那几项。

## 音色库（Fish 窗口语义）

- **Fish 免费档是按查询给窗口，不是给全库**：每个语言/标签组合各有一个 **1000 条窗口**（`total` 恒回 1000，是窗口大小不是库容量）。全局热度窗口里日语只有 52 条，而 `language=ja` 另有 1000 条（329 条 `anime`）；所以**筛选条件必须发给上游**，在本地那 1000 条里筛是筛不出来的。
- `voiceCatalog.ts` 的两个入口：`get(refresh)` 是**基础目录**（无条件那一个窗口，磁盘快照 12h + 失败沿用旧快照标 `stale` + 5 分钟静默期）；`list(query, refresh)` 是**条件窗口**（只进内存缓存：TTL 12h、上限 16 条按最旧逐出、同 key 并发去重；不落盘）。`query` 为空时 `list` 直接转给 `get`，所以「语言下拉的语种来源」与「目录外 voiceId 的名字解析」仍然只认基础目录。
- **三个参数各有各的坑**：`language` 与 `tag` 都是**大小写敏感**（`language=JA` 回 0 条、`tag=ANIME` 只有 3 条），所以 `language` 统一转小写、**`tag` 原样透传**（前端 chips 也必须用数据里的原始大小写）；多个 `tag` 是**并集**（不是交集）；`title` 是**全库标题子串搜索**（不分大小写、够得到窗口外的音色，但只能搜标题——描述与标签搜不到）。转小写后的 `title` 兼作缓存键。
- **抓取策略按查询种类分**（实测定的）：`title` 搜索先探第 1 页、满页才补 2–10 页（搜「雷姆」1 个请求 0.6s）；语言/标签窗口 10 页一次并发打完（探路多花一轮，而这类窗口基本都拉满 1000 条）。首次 4–12 秒是上游按 tag 过滤的页本身就慢，不是本机；
- **窗口查空不是错误**（标题搜不到是正常答案），只有基础目录沿用「空目录 = 上游坏了」的旧约定；窗口失败一律如实抛给调用方，不做静默降级。
- `GET /api/voices` 收 `language` / 可重复 `tag`（≤4，各 ≤40 字）/ `q`（≤60 字），越界 400 不放行到上游；`list_voices` 工具是同一查询面的第一等消费者（`tags` 并集 + `title` 全库搜索 + `gender` 在窗口内本地筛，因为 Fish 没有性别参数）。
- **标签是作者手打的，词表要从真实窗口统计、不能想当然**：`list_voices` 的描述里写着照抄用的常用词表（性别年龄 / 语气 / 质感 / 用途 / 画风五组），它是拿全局与日语两个 1000 条窗口现数出来的——曾经写的 `cute` 在两个窗口都是 0 条。语言词别当 tag 传（`Japanese` / `Mandarin` 是作者顺手打的，语言维度走 `language`）；模型自己造词的代价是那一轮查询空转。

## 提示词装配

- **工具知识只写在工具描述里，系统提示词不复述**（同一规则写两处必然漂移——生图那几条已经漂移过一次）。**一处明确例外**：pi 的内建 read / write / edit 没有描述覆写入口，角色卡 frontmatter 与记忆卡格式只能落在 A 区（`prompt.ts` 的 `newCharacterRules(can.characters)` / `MEMORY_RULES`）——它们同时要求模型「先 read 再 edit」，格式本身以 `parseCharacterCard` 的解析结果为准。两句**各归各的能力位**：`can.characters`（= 剧作家开着「管理角色」）为假时建档章换成「本剧目没给你改卡的口，新角色直接上台」，`can.memory` 为假时记忆章与 `read_memory_detail` / `search_archive` 的教法一起收走。
- **A 区把可写文件的路径给全**（2026-10-04）：角色表每张卡带 `characters/<id>.md`（`characterCardPath`）、记忆索引每行带 `memory/index/<相对路径>.md`（`PlayMemory.visibleContext` 的 `path`）——通用 read / write / edit 上手，模型不该为了改一张卡去推路径。记忆卡尤其必须：行首是 `# 标题`（`parseCard`），**与文件名可以不一样**，路径推不出来；arcs 卡是引擎产物、写不进去，`path` 恒为 null。
- **`can` 的键就是能力 id**（`characters` / `memory` / `image` / `library` / `search` / `lineage` / `skill` / `view` / `readiness` / `voice` / `files` / `shell` / `nsfw` / `stage`，非适用角色的位恒为 false）——两个角色的提示词读 `createAgentKit` 现算的同一个对象，不会各算各的。工坊侧同样逐处收条件（`workshop.ts` 的 `responsibilityRules(can.files)` / `talkRules` / `lineageGuide` / `writingPoints` / `setupFlow` / `skillsPrompt`），关掉一项就没有教它调不存在工具的章节。
- `prompt.ts` 的 `imageChapter` 只留工具本身与后果（发起即返回、这一轮就引用到它则先上骨架占位），调用写法（走函数调用不是文本标签、id 命名、prompt 后缀串）全在 `QUEUED_DESCRIPTION`。
- **什么时候该画一张不再由引擎决定**——早先那句「清单里没有就自己画一张背景」替所有剧目做了同一个决定，已撤掉，改成指向写作参数的素材来源（`renderCraftParams` 按 `can.image` / `can.library` 渲染那几行）。
- 原先那句「提前 3–5 句发起」已删——流式播放下 3–5 句只给图 3–5 秒的头，而真图要一分多钟，这个数推导不出来。
- 现在只留事实：这一轮就引用到它，舞台先上骨架占位、到货后淡入。
- `workshop.ts` 的资源库章节整段删掉，内容进了 `list_library` 的描述。
- 反过来也有搬不动的两类：DSL 渲染契约（`action` 八词、`shot` 四档、anchor 三档）是引擎认的字符串，工具描述里没有位置放。
- 「按描述选素材」这类引用 A 区清单的规则，工具描述里也没有「清单」可指。
- 工坊提示词里每个工具名出现的地方都按 `can.library` 收了条件——工具没注册就别在提示词里教它调。
- 挑音色的语言跟着剧目的 `voiceLanguage` 走（`WorkshopPromptContext.voiceLanguage` 现读注入；未设 = 台词按剧本原文配音，按剧本语言筛），不匹配的后果写在 `list_voices` 的描述里。
- **`play.json` 的字段表写在工坊 `writingPoints`**：除 `id`/`title` 外全是可选字段，缺省字段不在文件里、read 也读不出来，字段名猜错会被 `parsePlayConfig` 静默丢弃——所以 schema 必须写进提示词，并要求定点 `edit` 而不是整篇覆盖。
- 工具的可见性错配要当 bug 治：`list_voices` 只装给工坊、`read_lineage` 只装给工坊，提示词与工具描述里不能提对方才有的工具（2026-10-04 修：曾教剧作家去调它没有的 `list_voices`）。
- 两份提示词的正文按章抽成模块常量（剧作家 `ROLE_INTRO` / `HOW_I_WORK` / `FORMAT_RULES` / `MEMORY_RULES` / `newCharacterRules()` / `CONTRACT_RULES`，搭台 `RESPONSIBILITY_RULES` / `TALK_RULES` / `IMAGE_BASICS` / `NO_IMAGE_GUIDE` / `LINEAGE_GUIDE`），带能力位的章走 `imageChapter` / `setupFlow` / `writingPoints`，装配模板只留顺序与开关——改一章不必在几百行里找位置。
- 写作参数段（`renderCraftParams`）在 A 区里紧挨 `craftSection` **之前**、且**永远注入**（全默认值时也注入）：缺省口径不说出来，模型面对的就是「没人告诉它一轮写多长」，而它每轮都在做这个决定。
- `beat_done` 的三种停法只在「## 结束轮」与 `beatTool.ts` 的 `BEAT_DONE_DESCRIPTION` 各写一遍（契约 vs 工具说明），`# 你怎么工作` 不再复述第三遍。
- 搭台提示词里**不写死 UI 入口清单**（曾列出「玩家能打字的五处界面」，界面一改即成假信息），只说清要改什么、让用户自己找入口。

## 看图（view_image）

- **看图是一个能力不是一道流程**：`view_image`（只装给工坊，能力页上的「看图」一行，分组「搭台辅助」）把图读成 image attachment，`source` 吃两种来源——剧目内路径（PlayFiles 白名单）或图片网址（`webImage.ts` 下载，按 URL 摘要缓存到 `media-cache/web-images/`，不进 git）。
- **系统提示词里不写「出完图看一遍」**——每张都看只是白烧一轮，看不看得由模型自己判断。
- 网址分支的地址是模型给的，所以 `webImage.ts` 在下载前解析域名并拒掉回环/私网/链路本地/云元数据、每跳重定向重判、非 http(s) 直接拒。
- 出口代理读标准的 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量（取第一个非空的），不另开配置项——代理本来就是环境的事。

## 引用即导入（资源库）

- **引用即导入**（`assetRef.ts` 的 `AssetRefResolver`）：剧本里写了剧目没有的 id，宿主就去库里找同名条目导入（`scene bg`→backgrounds、`cg id`→cg、`actor id`→characters 与/或 sprites、`scene bgm`→bgm、`ambient`→sfx 再 bgm、`sfx src`→sfx）。
- **一个主体可以有两张附件，也可以只有一张**：`actor id` 先看剧目里有没有同名卡、有没有同名立绘目录，缺哪张补哪张——库里是 `characters/<id>`（卡，可零媒体）与 `sprites/<id>`（立绘包）两个独立 kind，两张都缺才算库里没有。
- 解析管道不 await，事件先广播按缺素材降级，到货后广播 `asset_ready` 复用现有的到货淡入。
- 角色导入写角色卡 `characters/<id>.md`（不再动 `play.json`）走 `rebuildAtBeatBoundary`（与剧作家给临时角色生立绘同一条延迟重建）。
- 库里没有就静默降级**不回话给模型**。
- 这条链路是剧作家的**默认**导入路径，不需要开任何工具——但**剧作家提示词里要写这条契约**（`prompt.ts` 的 `LIBRARY_REF`，按 `can.library` 注入）：不告诉它，它就只剩「缺素材就自己画」这一条路，把本该从库里拿的背景全烧成配额。
- 库里也没有的那一段尤其要写明「静默降级、不回话给模型」，否则它会换个 id 反复重写同一个引用。
- 垫图让单张从 69s 变 138s 而像素一样（「垫图策略」设 `none` 可掐掉，默认保一致性）。

## 出图内核与手动生图

- **出图提示词的内核只有一份**：`src/imagePrompt.ts` 的 `composeImagePrompt(deps, kind, ctx)` 按 sprite/background/cg 选系统提示词并拼上下文（指令 + 创作口径 + 角色卡 + 剧情/场景 + 参考图编号），舞台 `requestCg` 与手动入口都走它。
- **手动生图是「REST 同步发起 + WS 异步回报」**：`POST /api/plays/:id/images` 只做校验与提示词组装就返回 `{target, path, prompt}`——CF 隧道 100s 无字节即断，出图 70–140s 绝不能压在 HTTP 连接上。
- 出图在后台跑，完成或失败一律广播 `image_result`（成功 `{target, ok:true, url, path}`、失败 `{target, ok:false, message}`），客户端对话框按 `target` 匹配自己的那一张。
- `AssetNotify` 的第三个值 `"manual"` 就是给它留的：刷新素材列表，但不产工坊气泡、不进撤销条、不自动重建。
- 素材名/差分名的白名单收在 `assertAssetStem`，立绘 id 另走 `assertSpriteId`（只挡路径分隔符、前导点与控制字符——id 就是目录名，大写字母合法），REST 入口与出图前各判一次——入口不判就会先返回一个非法 path，用户等一分多钟才在 WS 上收到失败。
- 舞台那一路的参考立绘必须在**落时间线节点之前**校验（`assertReferences`），否则会留下一个永远填不上的骨架。

## 生图配置（接口格式、画幅与尺寸）

- **生图配置按接口格式而不是按产品名**：`image.format` 选 `gemini|modelslab|openai` 三种协议形状（`geminiImage.ts` = `/v1beta/models/{model}:generateContent`，垫图走 `inlineData`；`modelslabImage.ts` = `/images/text2img` 与 `/images/img2img`，垫图先传 `base64_to_url` 换托管链接；`openaiImage.ts` = `/v1/images/generations`，接口没有参考图入参、带垫图直接报错），地址/模型/尺寸统一读 `image.baseUrl` / `image.model` / `image.size`——后者说的是两种官方词汇：`1K`/`2K`/`4K` 是 Gemini `imageConfig.imageSize` 的原词（**K 必须大写，官方拒小写**；语义是总像素量级 1K≈1024²），gemini 侧原样透传。
- openai 侧的 `size` 是字面 `WxH`，所以档位由 `canvasFor` 按画幅换算（16:9 的 `1K` → `1360x768`），也可以直接写字面尺寸 `1536x1024` 喂只认标准尺寸的老模型。
- **modelslab 侧三条自带的口子**（`modelslabImage.ts`，别把它当「换个 baseUrl 的 openai」）：
  - 垫图走**两步**——本地字节只能当 base64 data URI 发给 `/image_editing/base64_to_url` 换一条临时托管链接（官方 `upload_image` 要自备 S3，免 S3 的路子只有这一条），再把链接塞进 `init_image`。所以每次带垫图的出图是两次 HTTP。
  - **只吃一张垫图**（`init_image` 是单值，只有 Flux Klein 独立端点收数组）；给多张直接报错，不静默取第一张——少垫一张不会报错、只会画错人。**出图画幅随垫图走**（官方原文「生成尺寸与 init_image 相同」），所以这条路不发 `width`/`height`，画幅对不上的兜底仍是 `PlayAssets.assertCanvas`。
  - **单边上限 1024**（宽高都要被 8 整除），档位对它没有意义，一律按「长边顶到 1024」落地——**立绘要的 `minTier: 2K` 在这个服务上拿不到**，1K 档算出来的长边本来就超上限。字面像素照发但越界即报错（与 openai 格式同一口径）。
  - `enhance_prompt` 与 `safety_checker` 两条显式写死 `false`：前者默认 true 会重写提示词，而我们的是 tag 结构（`masterpiece, best quality, 1girl, …`），改写会打散它。
  - `status: processing`（异步队列）本层不接轮询与 webhook，直接报错让部署方换端点——同 `imageFactory` 那条「不为异常做失败降级」的规矩。
- **逐剧目覆盖**：`play.json` 的 `image`（`model` / `size`）覆盖部署级的 `STAGE_IMAGE_MODEL` / `STAGE_IMAGE_SIZE`。`ImageRequest` 带可选的 `model?` / `size?`，三个实现取 `req.x ?? this.x`；`PlayAssets` **每次出图现读 play.json**（不是构造时取快照——`PlayAssets` 按剧目缓存、进程内不重建，快照会让「设置页改了模型，出图还是老模型」）。格式不认这个值就直接报错，不静默退回全局。
- 画幅白名单取三款接口的交集（Gemini 官方 14 个取值，减去 OpenAI 不收的 1:4/4:1/1:8/8:1）——换一家 Gemini 或 OpenAI 生图只改地址与模型名，不动代码。

## 服务入口、端点与记账

- **公网入口是同端口的**：`index.ts` 先过 `webAuth.ts` 的密码闸门（`settings.json` 的 `password`，HTTP Basic，HTTP 与 `/ws` 升级同一个判断——只挡 HTTP 等于没挡），再由 `webStatic.ts` 把 `apps/web/dist` 挂上，API 路径（`api`/`plays`/`library`）不碰前端目录，其余路径按 hash 路由回 index.html。
- 所以 `pnpm -r build` 之后一个端口就是整站，公网部署只指向这一个。
- 开发时仍是 vite + server 两个端口。
- 在生成的事由 `pendingJobs.ts` 统一记账（剧作家的轮次 / 背景 / CG / 立绘 / 语音），一改整表广播 `pending_jobs`，与排队面板共用一块浮层，重连时随 hello 的 `pendingJobs` 恢复。
- 新增端点：`GET /api/agents/models`（网关 `/v1/models` 清单 ∩ 设置里「支持的模型」清单，收窄在 `provider.ts` 的 `supportedModels`：按配置顺序排、清单里的 id 网关没有即报错点名；读不到网关即 400 不降级）、`GET /api/agents/capabilities`（`playhouse.capabilities()`：每个角色的能力目录——id / 名字 / 一句后果 / 分组与分组名 / `locked` / `available` 与 `unavailableNote`，外加每个角色的默认集；`locked` 的那行界面不给开关，`available: false` 指服务端没配 Exa / TTS / 生图后端）、`PUT /api/plays/:id/assets/sprite`（素材页写立绘呈现声明：body `{spriteId, variant?, framing?|null, stature?|null, anchor?|null, title?|null}`，null 或空串 = 删掉那一格回到缺省，写完 `playhouse.declareSpriteMeta` 即时生效——内部与素材上传同一条路（写盘后 `reload`），不像角色卡那样等轮边界）。`GET /api/plays/:id` 的详情多回一份 `manifest`：舞台靠它摆位。

## 技能库与新剧目初始状态

- 技能库（**`apps/server/skills/<name>/SKILL.md`** + frontmatter）只装**跨剧目的通用做法速查**，只给工坊（`read_skill`，角色标记 `workshop`）——这部剧自己的画风锚点与创作口径一律留在剧目记忆里（`memory/always/craft.md` 与设定卡，每轮本来就注入），不给剧作家开技能通道：教模型调一个装不进去的工具，它只会反复空转烧 token。
- **技能只认 `apps/server/skills/`**：目录由 `paths.ts` 的 `workshopSkillsDirOf` 从模块位置反推，打包时按 `apps/server/skills` 这条仓库相对路径进快照（`scripts/build-exe.mjs` 的随包资源清单）。**仓库根那个 `skills/` 不参与打包、`read_skill` 也读不到**（根目录那份 `galgame-audio` 是选题与授权调研记录，写给人看的，不是技能文件）——新技能放错目录的症状很安静：不报错，`skillsPrompt()` 就是不列它。
- **新剧目的 premise 与 craft 落盘就是空文件**（`createEmpty` 不再写模板）：premise 空着开不了演（就绪门），craft.md 空着只是少一层口径（节奏与素材来源走 `DEFAULT_CRAFT`）。引导文案只放在前端输入框 placeholder 里——模板正文写进文件会让人以为「已经填过了」，还会让就绪门把一份空模板判成前提已就位。

## 角色卡（characters/）

- **角色卡目录是剧目根下的顶层 `characters/`**（`packages/core/src/play/characterCard.ts` 的 `CHARACTER_DIR` / `characterCardPath(id)`）：**角色表就是这个目录的文件列表**，`play.json` 不再承载任何角色数据（`characters` 字段留着只是剧目元数据，没有运行时逻辑读它）。角色是剧目的一等公民、不是记忆的一层，所以不放在 `memory/` 下。
- **主角是一张普通卡**，id 固定 `protagonist`（`PROTAGONIST_ID = "protagonist"`）：`store.createEmpty` 建目录时就写一张（正文「（玩家扮演的角色。还没有写设定。）」——**空文件会被 `loadCharacters` 跳过**，只建目录不写卡的话角色表里根本没有主角）。它不靠 frontmatter 标记来认：`characters/` 的不变式「角色表 = 文件列表 + 固定文件名」天然排除两个主角或零个主角。
- 主角与别的卡**能力完全一致**（上台、立绘、音色、从资源库导入都照常），只有两处特殊：A 区角色表标注「，玩家扮演」（`prompt.ts` 读 `isProtagonist`）、工坊角色页不给删。是否上台、是否配音是**创作口径**（`memory/always/craft.md` 的事），引擎不预设。
- 路径一律从 `characterCardPath(id)` 拼，别各自抄字符串：`store.characterDir()` 供 `loadCharacters` / `loadCharacterCards` / `PlayFiles` 白名单（`DIR_ROOTS` 含 `characters`）与 `assetImport` 共用；`playhouse.writeCharacter`、`playhouse.polish`（读主角卡拼「主角设定：」）也走它。
- **卡上只剩人设与音色**（`CharacterHead` = `id` / `name` / `voice` / `voiceId`）：立绘取景、体量、锚点、差分这些呈现声明都归 `assets/manifest.json`，`parseCharacterCard` 认出旧字段也当噪声丢掉。收益是「一个 id 寻址一切」——机甲、道具、猫连卡都不需要。
- **卡与立绘目录同名即绑定，谁也不依赖谁**：只有卡 = 有名字与音色、还没有图；只有目录 = 有图，名字回落素材表 `title` 或 id；两张都有才是常驻角色。

## 创作口径与剧目记忆

- **写作参数与创作口径分开**（2026-10-04）：`play.json` 的 `craft` 段承载**有确定取值**的三件事——每轮篇幅（short/medium/long）、停止点选项数（two/three/four/free）、素材来源（背景/插图/立绘/音效逐类），类型与 `DEFAULT_CRAFT` 在 core 的 `play/config.ts`，渲染与合并全部收在 `apps/server/src/craftParams.ts`（`renderCraftParams` 给剧作家、`describeCraftParams` 给工坊与回执、`mergeCraftParams` 给工具）。`memory/always/craft.md` 只剩**只能拿话说的**（文风、禁忌、称呼、视角），每轮原样注入。
- 引擎**自带默认值**（`DEFAULT_CRAFT`：medium / 三条 / 背景库优先、插图与立绘出图、音效取库）。这推翻了 2026-10-03 的「引擎不自带任何创作口径」：新剧目看不到也改不动任何东西，而「每轮多长」本来就该有个能一眼看见的答案。`play.json` 只存与默认不同的字段——卡片里选「默认」= 那一行从文件里消失。
- `set_craft`（`agentkit/craftTool.ts`，只装工坊）改 `craft` 段：省略字段 = 不变、`null` = 恢复默认；读-合并-写整体包在 `withPlayConfigLock` 里（与引用即导入、文件页共用一条队列）。写回用**原始对象只换 `craft` 一个键**，不整篇 `parsePlayConfig` + 序列化（那会顺手丢掉引擎不认识的手写字段）。
- 素材来源的能力降级在 `craftParams.ts` 里做：`can.image` / `can.library` 决定那几行怎么写（没生图就说「用旁白交代」，没配库就不提清单），**工具没装时提示词不教它调**。文风与禁忌一律留在 `craft.md`，不参数化。
- 剧本语言 `scriptLanguage`（play.json）与语音语言 `voiceLanguage` 是两件事：前者决定正文/旁白/选项用什么语言写（不设 = 跟随玩家输入），后者是 TTS 的翻译目标。两份提示词都读它（剧作家那段在 `prompt.ts`，工坊那段在 `workshop.ts` 的 `playLanguageNote`）。
- `memory/always/craft.md` **空着剧作家就少一层口径可听**（写作参数照旧生效），所以工坊「设定流程」第 4 步仍硬性要求把对齐结果落盘——但落的是哪一份要看内容：文风进 craft.md，节奏与素材来源用 `set_craft`。
- **设定卡与角色卡都是普通剧目文件，走通用 `write` / `edit`**（2026-10-04 收掉了 `write_memory` / `create_character`：同一件事不必各来一份 schema 与守卫，通用工具还多给「先 read 再定点 edit」）。设定卡写 `memory/index/<分类>/<名字>.md`（首行 `# 标题`、次行一句话摘要），角色卡写 `characters/<id>.md`（frontmatter 机器字段 + 正文人设）。`always/` 是每轮注入层（可写），`arcs/` / `archive/` 是机器产物（只读，见上）。
- **写完排一次轮边界重建才进 A 区**：`PlayEnv.writeFile` 落盘后回调 `onPlayFilesChanged` → `playhouse.onPlayFileWritten` → `rebuildAtBeatBoundary`（与工坊写盘、引用即导入同一条延迟重建）。A 区在纪元内冻结，不排重建的话「下一轮进 A 区索引 / 角色表」就是空话。当轮想知道自己刚写了什么，直接 `read` 那个文件——内存里的 `cards` 不再有第二条写入口。
- **卡片行序即提示词前缀**：不变量是「用户卡在前、按 file localeCompare、arcs 卡在后」，由 `loadCards`（整段 sort）与 `loadArcs`（readdir 序）的拼接顺序建立，`PlayMemory.load` 每次重建都照它来。arcs 段**不能**跟着一起排：它是码位序（`epoch-x-10` 会排到 `epoch-x-2` 前）。
- **A 区角色分级（roster 一行制）**：角色数 ≥ `CAST_GRADING_MIN_SIZE`(5) 且给了 `activeCast` 时，在场角色全卡全文、最近没出场的只注一行摘要（截 `CAST_SUMMARY_CHARS`）。在场表来自 `orchestrator.recentCast()`——**按事件条数窗口倒扫**（`CAST_SCAN_EVENTS`），不是按去重后的角色数：后者在常驻角色少的剧目会一路扫穿全历史，等于全员标记在场、分级从不生效。不给 `activeCast` = 不分级（小剧目行序抖动伤缓存，不值）。
- **构造函数里 `restored` 的回填必须赶在 `buildAgent` 之前**（events/seq/beatNo/epoch/readPos/autostarted 整块）：A 区角色分级读 events 算在场，回填放在后面就是冷启动全员折叠——恢复出来的一轮比热启动少一整层设定。
- **轮边界重建同剧目只挂一个待办**（`pendingRebuilds` + `pendingRebuildNotes`）：一轮里建三张卡、出三张立绘是三次调用，全排下去就是连着重装三份 runtime；对话尾的 note 取首次触发的原因。
- **session.json 走 tmp+rename 原子写**（与 `saves.ts` 的 `writeSaveMeta` 同一写法）：崩在写一半上时旧档原样保住。临时名带 `randomUUID()`——同一剧目并发落盘不共用一个 tmp（共用会互相覆盖出坏 JSON）。`loadSession` 的 catch→null 语义不变：原子写已经让坏文件成了罕见情况，不叠第二层。

## 设置面板与配置面

- **唯一真相源是 `<dataRoot>/settings.json`**：`settingsStore.ts` 持有内存镜像，`patch()` 校验 → 原子落盘（临时文件 + rename，0600）→ 通知订阅者。整份文件当补丁叠在 `freshSettings()` 上解析，所以手写的文件可以只写关心的几项，每项仍过同一套校验；`fs.watch` 盯**目录**（落盘是改名，盯文件本身的 watcher 第一次保存之后就收不到事件了）+ 200ms 去抖。
- **只有一个保存入口**：`GET/PUT /api/config` 一把梭（`configApi.ts` 的读视图/写映射，掩码回传 = 不改、清空 = 显式清除）。面板上任何凭据都不许有绕过它单独落盘的通道。
- 多把 key 不走独立文件也不走独立接口：`keystore` 存的是数组（`config.ts` 的 `parseKeyList` 负责文本形态），传输面统一是 `KeyListView {keys, masked, keyCount}`——读侧 `keys` 恒空、只给掩码，写侧留空 = 不改、填入 = 整组替换（`mergeKeyList`）。
- 2026-10-02 拆掉了 `PUT/GET /api/config/tts-keys` 与 `~/.config/fish-audio/keys.json` 这条旁路：密钥与其余配置走两条路，用户会只改一半然后发现没生效。
- 模型 ID 两处（全局设置、剧目「Agent」页）复用 `ui/ModelSelect.tsx` 的同一个下拉，清单取 `GET /api/agents/models`，读不到就显式报错给重试、绝不退化成文本框。
- **新增一个设置项要同时动四处**：`config.ts` 的 `ServerConfig` + `freshSettings` + 校验、`configApi.ts` 的读视图与写映射、设置页表单、README 的「设置页字段总表」。少任何一处，用户就会看见一个「有配置项但改不了」或「改不了又没写」的窟窿（2026-10-04 补：`nsfwPrompt` 与 `image.reference` 就曾长期只有接口没有入口）。

## 限制级（NSFW）通道

- **入口由能力开关控制**：`can.nsfw` 位（能力「限制级通道」授权 `enter_nsfw` / `exit_nsfw`）决定 `prompt.ts` 注不注那两段（进/退指引）。2026-10-04 之前它是**恒注入**的——用户在 Agent 页摘掉那两个工具，提示词还在教它去调，只有空转。关掉这一项 = 本剧目不要限制级通道。
- **限制级（NSFW）剧情通道**：剧作家主动调 `enter_nsfw` 开启限制级通道（切换至限制级专用模型、注入 20 岁以上虚拟合规轮次与 `memory/always/nsfw.md`），退出时调 `exit_nsfw`（推荐与 `beat_done` 同批发出）。
- **不变式：限制级内容对全年龄读者的唯一出口是它带出的 SFW 摘要。** 正文原文、段内玩家输入、段内每一拍的 `beat_end` 都只在限制级侧可见；前台舞台、`lineage.jsonl`、replay 一如既往保留全文（约束的是**模型读到的东西**，不是存档）。
- **打标在事件上，不在轮次上**：`LineagePayload.nsfw` 由 `orchestrator.beatNsfw` 写进段内每个节点，取值来自 `beatChannelNsfw()` = `nsfwActive || nsfwPendingEnter`。判断依据必须是这个快照而不是当下的 `nsfwActive`：退出那一拍的 `beat_end` 在 `nsfwActive` 已翻成 false 之后才封，但它承载的仍是限制级原文。
- **这一拍的通道在「注入这段输入时」就定**（`noteBeatInputs`，与 `startBeatWindow` 用同一个 `beatChannelNsfw()`）：prompt 节点落在开拍之前，而边界那一拍按「开拍时才知道的 `nsfwActive`」打标两头都错——进段的那句玩家输入会漏标（SFW 侧从树上重建时它作为普通输入回流），段后的第一句日常输入会误标（从树上重建时整句被吃掉）。所以不许读上一拍残留的 `beatNsfw`，也不许等 `runBeatTurn` 兑现 `nsfwPendingEnter` 之后再定。
- **快照另说**：`MemorySnapshot.nsfw` 记的是「从这里起世界线是日常还是限制级」，段末那一拍的快照是 `false`——从那里跳转/续演就该是日常。事件层的 `nsfw` 与快照层的 `nsfw` 故意不对称。
- **摘要在树上落成 `beat_end.payload.nsfwSummary`**，同时以**不带 nsfw 标**的独立切片写进 `memory/archive`（`entryId` = 段末叶子）：SFW 侧 `search_archive` 因此能搜到这一段，不留检索缺口；限制级侧两片都看得到。同一叶子同一轮的两片靠 `sliceId` 尾缀 `:nsfw` 区分，不能只按 `entryId:turn` 认（MiniSearch 会当同一篇）。
- **退出那一拍要等摘要生成完才算收束**：`finishBeat` 见 `nsfwPendingExit` 就走 `closeNsfwBeat`——`busy` 与新增的 `beatClosing` 一起占着（`beatClosing` 是必须的：`turn_end` 与 `agent_end` 会各唤醒一次 `finishBeat`，而这次 `busy` 不能像往常那样先落回 false），`beat_settled` 推后到摘要之后，玩家输入排队等着。等摘要期间被 `forkTo` 腰斩（`beatToken` 变了）或 `dispose` 就直接作废，不封拍也不拿净化后的上下文盖掉别人刚重建的现场。
- **重建按读者折叠**（`rebuild.ts` 的 `lineageToBeats(…, { nsfw })`）：SFW 侧把整段折成一条过渡轮（措辞的唯一出处是 `nsfwTransitionBeat`，实时退出与从树上重建共用同一份），段内原文与段内玩家输入一概不进消息；限制级侧照渲原文、不注摘要。没打标的老档两位读者渲出来一样——不做迁移、不叠第二层特判。
- **退出的净化上下文只从谱系链渲**（`switchBackToSfw` 就是 `renderBeats(rebuildBeats(materialize()))`，摘要早在 `closeBeat` 里落成段末那条过渡轮）：**不留内存基线**——「进入限制级前的消息快照」只在本次会话真的走过 `enter_nsfw` 那一刻才存在，跳进段内或读档续演到段内时它是空的，而那时的内存消息组里全是露骨原文，任何以它为底的兜底都是一次全量回流。代价与 `editLine` / `rebuildBranchAt` 同源：从树重放会把纪元压缩摊回原文（下一拍开跑前的 `maybeCompactEpoch` 会再收一次）。
- **限制级段落期间不压缩**：`maybeCompactEpoch` 开头 `if (this.nsfwActive) return;`。压缩器的输入是原文对话体，段没结束就还没有摘要，这一压等于把限制级原文固化进 `memory/arcs`（每轮注入 A 区）——那正是这条不变式要挡的事。
- `rebuildBranchAt` 必须**先** `restoreBranchState` 再 `rebuildBeats`：折叠模式取自恢复出来的快照，顺序反了就按上一个分支的读者渲染这一条链。
- 谱系快照（MemorySnapshot）存 nsfw 状态，分支跳转自动复位模式。

