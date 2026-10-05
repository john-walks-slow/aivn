# AIVN 架构事实报告（面向「改造成 DSH 插件」的可行性评估）

> 目标仓库：`/root/projects/stage-ai`（package name `aivn`，版本 0.2.0，分支 `main`）
> 本文只做**忠实记录**，不做改造设计。所有结论均附 `path:line`。
> 记录时间：2026-10-05。

---

## 0. 全局地图

### 0.1 仓库形态

- pnpm workspace：`packages/*` + `apps/*`（`pnpm-workspace.yaml:1-3`）。
- 根 `package.json` 是私有聚合包 `aivn`（`package.json:2-3`），脚本 7 个：`build` = `pnpm -r build`、`typecheck`、`test`、`soak`、`exe`、`desktop`、`icon`（`package.json:30-38`）。
- 根运行时依赖极少：`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`、`markdown-to-jsx`（`package.json:39-43`）。
- 构建工具（devDependencies）：`@yao-pkg/pkg`、`esbuild`、`fflate`（`package.json:44-48`）；TypeScript `tsc -b`（core/server），Vite 7（web）（`apps/server/package.json:9`、`apps/web/package.json:8`）。
- Node 引擎要求 `>=22.19.0`（`package.json:27-29`）。
- 四个包：
  | 包 | 路径 | 私有 | 说明 |
  |---|---|---|---|
  | `@aivn/core` | `packages/core` | 否 | 纯 TS 规范 + 解析器 + IR + WS 协议 + 数据模型 |
  | `@aivn/server` | `apps/server` | 是 | REST + WS + 编排 + 工坊 + 素材 |
  | `@aivn/web` | `apps/web` | 是 | 舞台渲染层 + 工坊 UI |
  | `@aivn/desktop` | `apps/desktop` | 是 | Tauri 2 壳（约 300 行 Rust，只拉 sidecar） |

### 0.2 构建产物与运行入口

- 服务端入口 `main()`：`apps/server/src/index.ts:21`，用 `node --env-file=../../.env dist/index.js` 启动（`apps/server/package.json:8-9`）。
- **单端口整站**：`createServer` 先过 `WebGate` 密码闸门（`apps/server/src/index.ts:54-59`），再由 `serveWebBundle` 挂 `apps/web/dist`（`index.ts:61`、`apps/server/src/webStatic.ts:40`），最后落 `handleHttp`（`index.ts:62`）。`/ws` 升级走同一个闸门（`index.ts:68-82`）。开发态才分两个端口（vite `:5180` 代理到 `:8787`，`apps/web/vite.config.ts:22-36`）。
- 静态路由前缀白名单：`API_PREFIXES = ["api","plays","library"]` 不碰前端目录，其余回退 `index.html`（`apps/server/src/webStatic.ts:27`、`webStatic.ts:51-60`）。
- 数据根：开发态 = 仓库根，打包态 = exe 同级 `data/`（`apps/server/src/paths.ts:29`；AGENTS.md 亦载）。

### 0.3 包间依赖图（要点：无环，core 是唯一共享层）

```
@aivn/core  ←── @aivn/server (workspace:*, apps/server/package.json:16)
@aivn/core  ←── @aivn/web    (workspace:*, apps/web/package.json:14)
@aivn/desktop ──(spawn exe sidecar，无 JS 依赖，apps/desktop/package.json)
```

- **core 不依赖任何 workspace 包**（`packages/core/package.json` 只有 devDeps typescript + vitest）。
- web 从 core 引入 40+ 处（`apps/web/src/**`，如 `stage/script.ts:1`、`workshop/useWorkshop.ts:2`、`api.ts:11`）；server 有 27 个文件引入 core。
- core 是 web 与 server 的**类型与纯函数共享层**：DSL/IR/协议类型、`LineageTree`、立绘落位预设、卡片解析、WS 工坊段落拼装函数都从 core 取。
- ⚠️ core 是走 `dist` 的：`tsc -b` 产物 + `main: ./dist/index.js`（`packages/core/package.json:5-6`），改 core 后必须 `pnpm -r build`（`AGENTS.md` 开发与调试一节）。

---

## 1. packages/core

### 1.1 Stage DSL 规范

**规范文件**：`packages/core/src/dsl/spec.ts`（131 行，头部注释 `spec.ts:1-18` 写明 v1 冻结规范与 v1.1 收缩）。

**标签白名单（8 个）**：`DSL_TAGS = ["scene","actor","say","narrate","thought","sfx","cg","comment"]`（`spec.ts:20-30`）。

**自闭合指令标签（void）**：`VOID_TAGS = {scene, actor, sfx, cg}`（`spec.ts:33`）。

**注释标签**：`COMMENT_TAG = "comment"`，不产出任何 IR 事件，正文被解析器吞掉（`spec.ts:44`；注释动机见 `spec.ts:36-43`）。

**已迁出 DSL 的旧标签（静默降级）**：`LEGACY_TAGS = {stop, option, preload_asset}`（`spec.ts:54`）；命中即整条丢弃 + 一条 `legacy_tag` warning（`parser.ts:201-204`）。

**语法五条规则**（`spec.ts:4-9`）：
1. 标签式 `<tag attr="...">正文</tag>` 或自闭合 `<tag attr="..."/>`；
2. 指令先于台词；
3. 台词正文为原生文本、零转义；
4. 消息边界自动闭合；
5. 每条 assistant 消息独立解析，工具调用轮次对播放透明。

**属性契约（按标签）**：
- `SceneAttrs`：`bg` / `bgm` / `ambient` / `bgm_volume` / `ambient_volume` / `transition`（`spec.ts:62-73`）。音频属性缺省 = 保持当前，`bgm="none"` = 停止（`spec.ts:56-61`）。
- 运镜档位 `ACTOR_SHOTS = ["wide","normal","close","extreme"]`（`spec.ts:76-81`）。
- 对齐基准 `ACTOR_ANCHORS = ["bottom","center","top"]`（`spec.ts:84-89`）。
- `ActorAttrs`：`id`（必填）/ `pos` / `variant` / `shot` / `anchor` / `action` / `leave`（`spec.ts:91-113`）。
- `SfxAttrs`：`src`（必填）/ `volume`（`spec.ts:115-118`）。
- `SayAttrs`：`id`（必填）/ `name`（仅覆盖本句名牌）/ `mood`（`spec.ts:121-126`）。
- `CgAttrs`：`id`（必填）/ `caption`（`spec.ts:128-131`）。

**行为词（action）**：**规范层只定义为 `string`**（`spec.ts:110`），真正的白名单词表在 `packages/core/src/play/spriteAction.ts:18` `ACTOR_ACTIONS`，含 8 词 + 旧别名，映射见 `ACTION_LABELS`（`spriteAction.ts:43`）与 `actionAnimation()`（`spriteAction.ts:59`）。面向模型的八词表另写在剧作家提示词里（`apps/server/src/prompt.ts:172-185`）：nudge / stagger / jump / nod / bow / turn / shake / sway。

**旧属性别名（兼容，但契约只写 variant）**：`actor` 的 `expression` / `state` 仍被解析器当 `variant` 别名收下（`parser.ts:243-245`）。

### 1.2 解析器与 IR 产出

**文件**：`packages/core/src/dsl/parser.ts`（379 行）。**类**：`StageDslParser`（`parser.ts:62`）。

- 构造入参是事件回调 `onEvent: (event: StageEvent) => void`（`parser.ts:69`）——**解析器直接产出 `StageEvent` IR，没有中间 AST**。
- `feed(chunk)` 增量喂 token，chunk 可在任意位置撕裂（`parser.ts:71-74`）。
- `endMessage()` 消息边界：未完成标签丢弃、未闭合包裹标签自动闭合、注释强制结束（`parser.ts:76-96`）。
- `resetBeat()` 复位解析状态（`parser.ts:98-102`）。
- `takeWarnings()` 取走并清空告警，一次性投递（`parser.ts:110-112`）。
- 告警类型 7 种：`orphan_text` / `unknown_tag` / `malformed_tag` / `mismatched_close` / `auto_closed` / `nested_wrap` / `legacy_tag`（`parser.ts:11-18`），最多留 200 条（`parser.ts:32`）。
- 分发逻辑：`run()`（`parser.ts:114`）→ `consumeOpenTag()`（`parser.ts:181`）→ `handleTag()`（`parser.ts:199`）；`consumeCloseTag()`（`parser.ts:152`）。
- 未知标签**按字面文本输出**（不丢用户可见内容，`parser.ts:140-144`、`parser.ts:162-167`）。
- 已知缺陷（官方承认）：属性值含 `>` 会提前截断标签头（`spec.ts:16-17`）。

**包裹类标签三段式**：`say` / `narrate` / `thought` 被拆成 `*_start` / `*_text`(delta) / `*_end`（`parser.ts:284-286`、`parser.ts:325-327`、`parser.ts:333-340`）。

### 1.3 IR 事件形状

**文件**：`packages/core/src/dsl/events.ts`（52 行）。

- `PreloadAssetAttrs`：`{type:"bg"|"cg"|"sprite", prompt, id}`（`events.ts:8-17`）。
- **`StageEvent` 判别联合**（`events.ts:30-46`），共 17 个成员：
  - `scene` & SceneAttrs；`actor` & ActorAttrs；
  - `say_start {nodeId?} & SayAttrs`、`say_text {delta}`、`say_end`；
  - `narrate_start {nodeId?}`、`narrate_text {delta}`、`narrate_end`；
  - `thought_start {id, nodeId?}`、`thought_text {delta}`、`thought_end`；
  - `sfx` & SfxAttrs；`cg` & CgAttrs；
  - `preload_asset` & PreloadAssetAttrs；
  - `stop {stopType, options?, placeholder?}`；
  - `player_input {text}`。
- `SequencedEvent = {seq:number, event:StageEvent}`，线上格式，重连凭 seq 重放（`events.ts:49-52`）。
- 关键设计：`preload_asset` / `stop` **不再来自文本解析**，而由工具（`generate_image` / `beat_done`）产出，但走同一条 IR 管道与客户端不感知（`events.ts:4-7`、`events.ts:22-25`）。

### 1.4 WS 协议

**文件**：`packages/core/src/ws/protocol.ts`（400 行）。**这是客户端↔服务端的唯一契约**，server 与 web 共用同一份类型。

**连接/频道**：
- 路径 `/ws?play=<playId>`；工坊面板单独连接加 `&workshop=1`（`apps/server/src/transport.ts:13-22`）。**演出与工坊共用同一条 WS 连接**，服务端按 `type` 分流（`protocol.ts:390`）。
- 连接建立后服务端首帧 `hello`，重连用 `ClientMessage.resume` 增量重放（`transport.ts:118-123`、`transport.ts:134-138`）。

**服务端 → 客户端 `ServerMessage`**（`protocol.ts:170-329`），共 30+ 个变体：
- `hello`（`protocol.ts:171-206`）：`sessionId / lastSeq / fresh / cast / voice / assets / pendingJobs / assetsTtlMs / epoch / idle / saveId / saveName / readPos / nsfw`。
- 节奏类：`beat_start`（:207）、`events`（:208）、`beat_end` = `BeatEndPayload`（:209）、`beat_settled`（:211）。
- 语音：`audio_ready {seq, phrase, url}`（:213）、`audio_pending`（:218）。
- 素材：`asset_ready {asset: GeneratedAsset}`（:220）、`asset_failed`（:222）。
- 谱系/结构：`lineage`（:223）、`rebase`（:228-254，携带 `epoch/leafId/events/stop/reason/resuming/note/playFrom/resumeAt/keepView`）、`line_edited`（:256）、`cg_attached`（:263）。
- 通道：`nsfw`（:261）、`prompt_queue`（:265）、`pending_jobs`（:270）、`error`（:329）。
- 工坊（D9，全部带 `threadId`）：`workshop_threads`（:272）、`workshop_history`（:273）、`workshop_chunk`（:281）、`workshop_thinking`（:283）、`workshop_tool_start`（:285）、`workshop_tool_end`（:287）、`workshop_write`（:296）、`workshop_asset`（:298）、`workshop_done`（:307）、`workshop_error`（:308）。
- 手动生图：`image_result`（成功 :316 / 失败 :323）。

**客户端 → 服务端 `ClientMessage`**（`protocol.ts:331-398`），共 20 个变体：
`resume` / `start` / `player_choice` / `player_free` / `continue` / `prompt` / `prompt_edit` / `prompt_delete` / `pending_dismiss` / `tts_control` / `fork` / `delete_branch` / `edit` / `generate_cg` / `jump` / `read` / `workshop_open` / `workshop_activate` / `workshop_chat` / `workshop_archive` / `workshop_delete`。

**协议级子类型（同文件）**：
- 停止点：`STOP_TYPES = ["choice","free"]`（`protocol.ts:12`，`pause` 只由编排器自造，`protocol.ts:28`）；`StopOption {text, value?}`（:16）；`StopPayload {stopType|"pause", options?, placeholder?}`（:22）；`BeatEndPayload {beatId, reason:"stop"|"no_stop", stop?}`（:33）。
- `PromptQueueItem`（:41）、`PendingJob {id, kind, label, prompt?, startedAt, state, error?}`（:53-71，kind ∈ beat/bg/cg/sprite/voice/bgm）。
- 工坊：`WorkshopThreadInfo`（:74）、`WorkshopAssetView {kind, path, url}`（:83）、`WorkshopToolPart`（:93）、`WorkshopPart` = text|thinking|tool 联合（:111）、`WorkshopChatMessage`（:117）、`WorkshopCompactionView`（:132）。
- `GeneratedAsset {id, url, type}`（:142）、`ReadPos {nodeId, offset, seq?, len?}`（:159）。

**工坊段落拼装纯函数**：`packages/core/src/ws/workshopParts.ts`（65 行）——`appendText`（:11）/`appendThinking`（:18）/`startTool`（:27）/`endTool`（:35）/`attachToolAssets`（:45）/`normalizeParts`（:62）。服务端与前端**共用同一份实现**（`workshopParts.ts:4-8`）。

### 1.5 谱系 / 数据模型

**谱系模型**：`packages/core/src/lineage/model.ts`（551 行），头部注释即设计说明（`model.ts:1-13`）。

- `LineageEventKind`（13 种）：`scene|actor|say|narrate|thought|sfx|preload|cg|stop|prompt|beat_end|edit|fork`（`model.ts:18-31`）。
- `LineagePayload`：`attrs? / input? / choice? / origin? / nsfw? / nsfwSummary?` + 索引签名（`model.ts:34-48`）。
- `LineageEvent`：`id / parentId / kind / turn / text? / payload? / createdAt / editTargetId? / cgTargetId?`（`model.ts:50-64`）。
- `EngineStateSnapshot {turn, affinity, flags}`（`model.ts:66-70`）；`MemorySnapshot {state, arcs, nsfw?}`（`model.ts:72-79`）；`LineageSnapshot`（`model.ts:81-88`）。
- `LineageNodeView`（前端路线树用，含 `onPath/children/editedText/editCount/seq/stopType/stopOptions/cgs`，`model.ts:91-120`）；`LineageView {nodes, leafId, pathIds}`（`model.ts:122-127`）。
- `LineageStore {events, leafId, snapshots}`（持久化结构，`model.ts:151-155`）。
- **`LineageTree` 类**（`model.ts:176`）：内存树，append-only 事件日志 + 分叉树。核心方法：
  - `append()`（:192）、`jumpTo()`（:212，只移游标）、`recordFork()`（:224，落 fork 标记）、`removeSubtree()`（:239，剪枝 + 上溯清空壳）、`childrenOf()`（:285）、`beatEndFrom()`（:303）、`recordEdit()`（:326，旁注不入树）、`recordCg()`（:354，旁注）、`materialize()`（:373，物化分支剧本）、`ancestorChain()`（:390）、`chainEvents()`（:403）、`saveSnapshot()`（:412）、`latestSnapshotOnPath()`（:442）、`pathSet()`（:452）、`describe()`（:457，路线树视图）、`export()`（:494）、`load()`（:505）。
  - 三类旁注（edit / cg）统一放在 `notes` 表，落盘排在树事件之后、读回时分流（`model.ts:183`、`model.ts:494-502`、`model.ts:505-531`）。
- **重放**：`packages/core/src/lineage/replay.ts`（220 行）——`toNodeView(event)`（:15）、`lineageToEvents(chain)`（:62，谱系链 → `SequencedEvent[]`）、`stopFromNode(node)`（:168）。

**剧目级数据契约**：`packages/core/src/play/config.ts`（384 行）。
- `PlayConfig`（`config.ts:192-234`）：`id` / `title`（必填）、`characters?` / `cover?` / `voiceLanguage?` / `scriptLanguage?` / `defaultVoiceId?` / `opening` / `initialState` / `initialScene` / `craft?` / `image?` / `agents?`。
- `CharacterCard`（`config.ts:10-26`，仅元数据，无运行时逻辑读它，`config.ts:196-202`）。
- `CraftParams`（`config.ts:39-43`）+ 三组枚举：`CRAFT_BEAT_LENGTHS`（:46）/`CRAFT_STOP_OPTIONS`（:50）/素材来源四类（:60-67）；`EffectiveCraft`（:78）、`DEFAULT_CRAFT`（:96-100）、`resolveCraft()`（:103）。
- `AgentSettings`（`config.ts:127-161`）：`model` / `thinking` / `prompt`（仅工坊）/ `capabilities`（启用集白名单）/ `nsfwModel` / `nsfwThinking` / `nsfwPrompt` / `imageApproval`。`AgentConfig {playwriter?, workshop?}`（`config.ts:237-240`）。
- `PlayCover`（:186）、`PlayImageConfig`（:174）、`PlayConfig.parsePlayConfig()`（:242-277）+ 逐字段归一化（`parseCraft` :287、`parseAgentConfig` :345）。

**角色卡模型**：`packages/core/src/play/characterCard.ts`（192 行）——`CHARACTER_DIR="characters"`（:36）、`PROTAGONIST_ID="protagonist"`（:46）、`characterCardPath(id)`（:49）、`characterIdOfPath(rel)`（:59）、`isProtagonist`（:67）、`CharacterHead {id,name,sprite,voice,voiceId}`（:72）、`spriteIdOf(id, head)`（:104，立绘目录解析唯一入口）、`characterOfSprite`（:116）、`parseCharacterCard`（:133）、`serializeCharacterCard`（:145）。

**素材/立绘模型**：`packages/core/src/play/assets.ts`（306 行）——`ASSET_KINDS = backgrounds|cg|sprites|characters|bgm|sfx`（:19）、`AssetMeta`（:50）、`LibraryEntry`（:111）、`parseAssetMeta`（:145）、`parsePlayAssetManifest`（:208）、`SpriteDeclaration`（:221）、`spriteDeclarationOf`（:237）、`spriteTitlesOf`（:263）、`describeAsset`（:277）、`libraryEntryMatches`（:292）。
- 立绘取景/体量：`play/framing.ts`——`SPRITE_FRAMINGS = full|half|square`（:23）、`SPRITE_FRAMING_ASPECT`（:58）、`SPRITE_FRAMING_SHOT`（:65）、`SPRITE_STATURES = small|normal|large|huge`（:106）、`LEGACY_SPRITE_FRAMING` 降级表（:89）。
- 落位预设：`play/spriteStage.ts` 的 `spriteStagePreset(framing, stature, anchor)`（:81）是舞台上立绘位置的唯一真相源；`play/spriteLayout.ts` 的 `POSITIONS`（:18）与 `layoutSprites()`（:91）是按在场人数自动排布。
- `play/spriteVariants.ts`：`COMMON_SPRITE_VARIANTS`（:13）、`spriteVariantChoices`（:40）。

**语音纯函数**：`speech/chunker.ts`（165 行，`PhraseChunker` 类 :86、`normalizeForTts` :40、`speechLength` :19）、`speech/voices.ts`（93 行，`VoiceEntry` :9、`LANGUAGE_LABELS` :36、`languageLabel` :75、`isVoiceId` :91）。

### 1.6 能否独立在浏览器跑？导出面？

**可独立在浏览器跑 —— 已用静态事实核实**：
- core 的 `src/` 中**没有任何 Node 或浏览器全局依赖**：无 `from "node:*"`、无 `require()`、无 `process.`/`Buffer`/`__dirname`、无 `document.`/`window.`/`localStorage`（全量 grep 结果为空）。
- 全部 import 都是**相对路径 + `import type`**（`grep '^import' src/` 的非相对导入为 0）。
- 运行时零依赖：`packages/core/package.json` 只有 devDependencies（typescript + vitest），无 `dependencies`。
- tsconfig 用 `NodeNext` 模块解析（`packages/core/tsconfig.json` 继承 `tsconfig.base.json` 的 `module: NodeNext`），但源码本身不触碰 Node API；web 侧以 `module: ESNext` + `moduleResolution: bundler` 消费其 `dist`（`apps/web/tsconfig.json:7-8`）。

**导出面**：
- `main: ./dist/index.js`（:6）、`types: ./dist/index.d.ts`（:7）、`exports["."]` 单一入口（:8-13），`files: ["dist"]`（:14）。
- 唯一 barrel：`packages/core/src/index.ts:1-17`，`export *` 17 个模块：dsl/spec、dsl/events、dsl/parser、ws/protocol、ws/workshopParts、lineage/model、lineage/replay、play/config、play/framing、play/spriteLayout、play/spriteStage、play/spriteAction、play/spriteVariants、play/assets、play/characterCard、speech/chunker、speech/voices。
- **没有子路径导出**（无 `exports["./dsl"]` 之类）；也没有 CJS 产物（`"type": "module"`）。
- 包**未标 `private`**，理论上可发布 npm；`files` 只含 dist。

---

## 2. apps/server

### 2.1 服务端如何跑一场演出

**编排核心**：`apps/server/src/orchestrator.ts`（2394 行），类 `PlaywrightOrchestrator`（`orchestrator.ts:340`）。它同时是「LLM agent 宿主 + DSL 解析消费者 + 谱系写入者 + WS 广播者」。

**运行态基座**（关键字段，`orchestrator.ts:341-448`）：
- `agent: Agent`（:341）、`parser: StageDslParser`（:342）
- `events: SequencedEvent[]` + `seq`（:344-345）——事件缓冲
- `beatNo`（:346）、`busy`（:347）、`beatPending`（:355，开门中）、`beatToken`（:357，腰斩代号）
- `autostarted`（:352）、`disposed`（:353）
- 轮内：`beatError`（:367）、`beatTimedOut`（:369）、`beatLines`（:371）、`beatAttempt`（:373）、`beatAnchorId`（:375）、`beatTailId`（:377）、`beatVerdict`（:381）、`beatSteers`（:383）、`beatWarnings`（:385）、`beatClosed`（:387）、`beatToolActivity`（:390）
- 谱系级：`stateFiles`（:392）、`arcIds`（:394）、`readPos`（:406）、`prevLeafId`（:409）、`loggedIds`（:419）
- NSFW 状态机：`nsfwActive`（:425）、`nsfwPendingEnter`（:428）、`nsfwPendingExit`（:430）、`beatNsfw`（:444）、`beatClosing`（:446）

**状态机语义（三个正交位）**：
| 位 | 含义 | 证据 |
|---|---|---|
| `busy` | 轮窗口开着（模型这一轮在跑） | `startBeatWindow()` 置 true（:1918） |
| `beatPending` | `beginBeat` 已进、前置（压缩/注入）未完 | :1687、:1725 |
| `engaged` | 对外「忙不忙」= `busy \|\| beatPending` 派生 | getter 在 :798 |
| `settled` | 编排器真正空闲 → 发 `beat_settled` | `onBeatSettled()` :1066 |

另有 `beatClosing`（:446）：退出 NSFW 那一拍在等 SFW 摘要时 `busy` 保持占用，防重复收束（`finishBeat` 入口闸门 :1977）。

**推进一个 step（一拍/一轮）的完整链路**：
1. `start()`（:836）只对空树生效，用 `opening` 起第一轮。
2. `playerAction(action)`（:843）是唯一入口：`prompt`（插一句）只入队不入拍（:848-859）；engaged 时拒绝（:860-867）；`continue`/`choice`/`free` 解析成 `ResolvedAction`（:870-895）。
3. **回到旧轮走原路**：`revisitOldPath()`（:936）按 `originOfBeat` 找同来源的现成下一拍，命中就 `rebaseAt(endId, ..., {mark:false, playFrom:"start"})` 不生成（:953）；否则 `deliverPrompts()`（:1038）→ `beginBeat(userText)`。
4. `beginBeat(userText)`（:1685）：取 token → 循环 `runBeatTurn`（:1699）→ 消费判废结论 `beatVerdict`（:1701-1719）→ finally 清 `beatPending` 并在空闲时 `onBeatSettled()`（:1721-1727）。
5. `runBeatTurn(userText, token)`（:1731）：装**超时闸门**（`beatTimeoutMs`，到点 `agent.abort()`，:1734-1742）→ 等 `pendingSfwSwitch`（:1744）→ 兑现 `nsfwPendingEnter`（:1748-1756）→ `maybeCompactEpoch()` 纪元压缩（:1758）→ 记历史（:1761）→ `startBeatWindow()`（:1762）→ `await agent.prompt(userText)`（:1763）→ `await agent.waitForIdle()`（:1764）。
6. `startBeatWindow()`（:1917）：置 `busy`、`beatNo++`、重置轮内标记、`engine.turn = beatNo`（:1927）、开 `PendingJob`（:1930）、广播 `beat_start` + `lineage`（:1935-1940）。
7. **流事件消费** `onAgentEvent()`（:1943）：`message_update/text_delta` → `parser.feed(delta)`（:1946-1947）；`message_end` → 捕获 `errorMessage`、记副作用工具、`parser.endMessage()`（:1948-1960）；`turn_start` 重开轮窗（:1961-1963）；`turn_end` 且 `beatClosed` → `finishBeat()`（:1964-1966）；`agent_end` → 兜底 `finishBeat()`（:1967-1969）。
8. 解析器每个事件经 `onStageEvent()`（:2214）：补 `nodeId`（:2215-2220）→ `seq += 1` → push 缓冲 + 广播 `events`（:2222-2224）→ `accumulateLineage()`（:2225，IR → 行级谱系事件）→ `feedVoice()`（:2226，语音预取）。
9. 工具产出的停止点：`emitStop()`（:2236）→ `onStageEvent({kind:"stop"})`，与解析器事件完全同构。
10. `finishBeat()`（:1973）：取走告警 → `parser.resetBeat()` → **判废三无检查**（无 stop、无台词、无副作用工具 → 判废，:1988-1996）→ 若 `nsfwPendingExit` 走 `closeNsfwBeat()`（:2012-2021）→ 否则 `closeBeat(stop)`。
11. `closeBeat(stop, nsfwSummary?)`（:2043）：落 `beat_end`（带 `reason`/`seq`，:2044-2051）→ `tree.saveSnapshot()`（:2060）→ 写 `memory/archive` 逐轮切片（:2071-2084）→ 广播 `beat_end`（:2090-2095）→ `persist()`（:2096）。

**超时**：默认来自设置 `beatTimeoutMs`（`apps/server/src/config.ts:62` 附近）。工坊单轮超时独立，`TURN_TIMEOUT_MS = 420_000`（`apps/server/src/workshop.ts:340`）。

**判废回滚**：`rewindFailedBeat()`（:1791）复用上下文重建，但**不落 fork 标记**（:1797-1803）；判废源是 `beatVerdict`（`finishBeat` :1989）。

**上下文重建 / 腰斩**：`rebuildBranchAt()`（:1449）、`rebaseAt()`（:1411）、`restoreBranchState()`（:1548）、`restoreStopPoint()`（:1577）、`rebuildBeats()`（:1599）、`renderBeats()`（:1611）、`cancelBeat()`（:1287，busy 先清零再自增 beatToken）。

**玩家输入是一等事件**：`playerAction` 先广播 `player_input` 再 `beginBeat`（:903-904 与 :907）——时序被显式注释为契约（`apps/server/AGENTS.md` 的「玩家输入也是这条管道的一等事件」）。

**每剧目 runtime 宿主**：`apps/server/src/playhouse.ts`（1418 行）。
- `PlayRuntime` 结构：`{orchestrator, workshop, store, save, cast, voice, synth?, generated, pending, assetsTtlMs}`（`playhouse.ts:51-70`）。
- `PlayHouse` 类（:158）：`runtimes` 懒加载缓存（:159）、`building` 在飞去重（:161）、`clientsByPlay` WS 发送器集合（:167，与 runtime 生命周期解耦）、`playAssets`/`playMusic`/`pendingJobs`/`limiters` 都挂在 PlayHouse 而非 runtime（:192-202，理由见注释）。
- 关键方法：`get()`（:275，懒加载）、`begin()`（:303，「开演」才建周目）、`clientsFor()`（:388）、`reload()`（:518）、`announce()`（:531）、`createSave/renameSave/deleteSave/switchSave`（:676-705）、`deletePlay()`（:724）、`broadcast()`（:883）、`requestCg()`（:965，舞台导演生图）、`generateImage()`（:1069，工坊手动生图）、`declareSpriteMeta()`（:1237）、`capabilities()`（:859）、`gatewayModels()`（:840）。
- 设置改动**就地生效**：`settings.subscribe(() => applySettings())`（:231），`applySettings()` 重建进程级客户端 + 对已加载剧目排轮边界重建（:255-265）。

**LLM 运行库**：基于 `@earendil-works/pi-agent-core` 的 `Agent` 与 `@earendil-works/pi-ai` 的 `Model`/`Type`。
- provider 只在 `apps/server/src/provider.ts`：`createCpaProvider()`（:12）、`resolveCpaModel()`（:76）、`supportedModels()`（:142）、`fetchGatewayModels()`（:158）；API 形状固定 `openai-completions`（`provider.ts:26`、:42）。
- agent 构建：`buildAgent()`（`orchestrator.ts:594`），其 `finishTurn` 钩子在 :627。

**持久化（store.ts，546 行）**：
- `PlayStore`（`store.ts:86`）：`loadPlay()`（:104）、`loadSession()`（:109）、`loadHistory()`（:133）、`appendEvent()`（:144，追加 `lineage.jsonl`）、`saveSession()`（:159，tmp+rename 原子写）、`readiness()`（:211）、`createEmpty()`（:509）、`remove()`（:542）。
- 会话隔离在 `saves/<saveId>/`（`store.ts:85` 注释、`store.ts:99-102`）。

### 2.2 play.json 与剧目目录

**Schema 定义在 core**：`packages/core/src/play/config.ts:192`（`PlayConfig`），解析入口 `parsePlayConfig()`（:242）。

**磁盘布局（README 权威版 + 实盘核对）**：`README.md:1092-1110`
```
plays/<id>/
├── play.json          # id/title/opening/initialState/initialScene + 可选 craft/image/agents/cover/语音语言
├── characters/        # <id>.md（frontmatter + 正文），主角固定 protagonist.md
├── assets/            # backgrounds/ cg/ sfx/ bgm/ sprites/<主体id>/
│                      #   manifest.json（素材表 + 立绘呈现声明）/ generated.json（出图 prompt 台账）
├── memory/            # always/{premise.md, craft.md} + index/<分类>/<名字>.md + arcs/ + archive/（引擎产物）
├── media-cache/       # TTS / 立绘留底 / 网图缓存（可重建，不进 git）
├── workshop/          # threads.json + <threadId>.json
├── saves/<saveId>/    # meta.json / session.json / lineage.jsonl
└── active.json        # 当前周目指针
```
实盘佐证：`plays/mh/`（有 characters/memory/assets/workshop/saves）、`plays/mh/active.json` = `{"saveId":"smutiarw5"}`、`plays/mh/saves/smutiarw5/{meta.json,session.json,lineage.jsonl}`。

**新剧目脚手架**：`createEmpty()`（`store.ts:509-539`）建 `assets/backgrounds`、`assets/sprites`、`memory/always`、`characters/`，写一张最小主角卡（`store.ts:518-521`）、最小 `play.json`（:522-536）、**空的 premise.md 与 craft.md**（:537-538，空文件是刻意的）。

**常驻设定路径常量**：`memory/always/craft.md` / `memory/always/premise.md`（`store.ts:408-409`、`http.ts:30,32`）。

**可写面白名单**：`apps/server/src/playFiles.ts`——`DIR_ROOTS = ["memory","assets", characters]`（:21）、`READONLY_PREFIXES=["assets/"]`（:17）、`GENERATED_PREFIXES=["memory/arcs/","memory/archive/"]`（:90）、`WriteScope = "characters"|"memory"|"config"`（:112）+ `SCOPE_PREFIXES`（:115）、`writeScopeOf()`（:129）、`inWriteScopes()`（:142）。

**剧目包导入导出**：`library.importZip()` / `library.exportZip()`，zip 只含 `play.json + assets`，saves/active.json 排除（`store.ts:494-496`、`http.ts:600-609`）。

### 2.3 「工坊」（workshop）是什么

**定义**：与演出**并行的一条独立 agent 通道**，管剧目文件的创建与维护（搭台），不参与演出（`packages/core/src/ws/protocol.ts:271`、`apps/server/src/playhouse.ts:53-54`）。

**代码位置与职责**：
| 文件 | 职责 |
|---|---|
| `apps/server/src/workshopSession.ts`（557 行） | 会话主体：`WorkshopSession` 类（:99），线程快照/激活/归档/删除（:139-166）、`chat()`（:169）、`markChanged()`（:319）、`writeFile()`（:360）、`removeFile()`（:367）、`pushWrite()`（:388）、`pushAsset()`（:398）、`settleAssets()`（:421） |
| `apps/server/src/workshop.ts`（574 行） | 提示词装配 + 单轮执行：`buildWorkshopPrompt()`（:135）、`runWorkshopTurn()`（:472）、`summarizeThread()`（:369）、`historyToMessages()`（:531）、`deriveThreadTitle()`（:571） |
| `apps/server/src/workshopThreads.ts`（145 行） | 线程持久化：`WorkshopThread`（:12）、`ThreadCompaction`（:27）、`WorkshopThreads` 类（:42），落 `<play>/workshop/threads.json`（:40）与 `<threadId>.json` |
| `apps/server/src/agentkit/playEnv.ts` | 文件读写政策（白名单 + 撤销条），`PlayEnv extends NodeExecutionEnv` |
| `apps/server/src/agentkit/piTools.ts` | pi 内建 read/write/edit/bash 的适配（:57-62） |

**存储布局**：`plays/<playId>/workshop/threads.json` + `plays/<playId>/workshop/<threadId>.json`（`workshopThreads.ts:40,46`；实盘 `plays/mh/workshop/{threads.json,tmur6s1w0sx.json}`）。

**工坊 API / 会话面**：
- WS 侧（同一条连接）：`workshop_open` / `workshop_activate` / `workshop_chat` / `workshop_archive` / `workshop_delete`（`transport.ts:216-230`），每条都调用 `runtime.workshop.*`。
- REST 侧：文件树 `GET/PUT/DELETE /api/plays/:id/files`（`http.ts:404-423`）、craft `GET/PUT /api/plays/:id/craft`（:425-437）、premise `GET/PUT /api/plays/:id/premise`（:439-450）、手动生图 `POST /api/plays/:id/images`（:562-591）、润色 `POST /api/plays/:id/polish`（:592-599）、TTS 试听 `POST /api/plays/:id/tts-preview`（:556-561）。
- 与 runtime 的关系：`PlayRuntime.workshop` 挂在 runtime 上，但 `reload` 只换编排器、**复用同一个 WorkshopSession**（`playhouse.ts:189-190`）。

### 2.4 「playwriter」在代码里是否存在

**存在，且是一等角色（role）**。

1. **角色枚举**：`AGENT_ROLES = ["playwriter","workshop"]`（`apps/server/src/agentkit/role.ts:12`），类型 `AgentRole`（:13）。
2. **角色元数据（UI 文案）**：`ROLE_META.playwriter = { label: "剧作家", blurb: ... }`（`role.ts:16-25`）。
3. **角色 prompt**：`apps/server/src/prompt.ts` 的 `buildSystemPrompt()`（:311）构造剧作家系统提示词。模块常量：`ROLE_INTRO`（:109，首句即「你是一部视觉小说的剧作家（playwriter）」）、`HOW_I_WORK`（:114）、`FORMAT_RULES`（:140）、`newCharacterRules()`（:219）、`MEMORY_RULES`（:280）、`CONTRACT_RULES`（:295）。
4. **角色 tool 列表**：`TOOL_CATALOG` 每项的 `roles` 数组（`apps/server/src/agentkit/kit.ts:273-299`）；`playwriterTools()`（`kit.ts:443-468`）是剧作家的装配面。
5. **角色配置（play.json）**：`AgentConfig.playwriter: AgentSettings`（`packages/core/src/play/config.ts:237-240`）；归一化只对 playwriter 放行 `nsfwModel/nsfwThinking/nsfwPrompt`（`config.ts:361-371`）。实盘 `plays/mh/play.json` 的 `agents.playwriter.model = "gemini-3.8-flash-high"`。
6. **注释证据**：`apps/server/AGENTS.md` 的「agentkit：两个 agent 的共用基座」整节以 playwriter/workshop 对照描述。

**装配**：`createAgentKit(deps)`（`kit.ts:410`）→ `roleTools(deps)`（:406）→ 按 `enabledToolsFor` 过滤（:412-413）+ `capabilitiesOf`（:417）。

### 2.5 Agent 工具接口

**三层目录，真相源各一**：

**(a) `CAPABILITY_CATALOG`（用户语汇的唯一真相源）**：`kit.ts:230`，行定义在 `CATALOG_ROWS`（`kit.ts:92-227`）。分组 `CAPABILITY_GROUPS`（`kit.ts:40-48`）：演出/角色/写作/素材/查资料/搭台辅助/进阶。

| 能力 id | label | 角色 | 授权工具 | writeScopes | 默认 |
|---|---|---|---|---|---|
| `stage` | 轮与状态 | playwriter | `beat_done`, `update_state` | — | locked（常开）`kit.ts:98-101` |
| `nsfw` | 限制级通道 | playwriter | `enter_nsfw`, `exit_nsfw` | — | `:103-109` |
| `characters` | 管理角色 | playwriter | `write`, `edit` | characters | **defaultOff** `:111-119` |
| `voice` | 音色库 | workshop | `list_voices` | — | needs voice `:121-129` |
| `memory` | 记忆 | playwriter | `write`, `edit`, `read_memory_detail`, `search_archive` | memory | `:131-138` |
| `files` | 改剧目文件 | workshop | `write`, `edit`, `set_craft` | characters, memory, config | `:140-147` |
| `image` | 生图 | 两者 | `generate_image`, `recut_sprite` | — | needs image `:149-157` |
| `music` | 生成 BGM | workshop | `generate_bgm` | — | needs music `:159-167` |
| `library` | 素材资源库 | 两者 | `list_library`, `import_asset` | — | `:169-175` |
| `search` | 联网检索 | 两者 | `web_search` | — | needs search `:177-185` |
| `lineage` | 故事树 | workshop | `list_saves`, `read_lineage` | — | `:187-193` |
| `skill` | 技能库 | workshop | `read_skill` | — | `:195-201` |
| `view` | 看图 | workshop | `view_image` | — | `:203-209` |
| `readiness` | 检查开演条件 | workshop | `get_readiness` | — | `:211-217` |
| `shell` | 命令行 | workshop | `bash` | — | **defaultOff** `:219-226` |

**(b) `TOOL_CATALOG`（工具层角色可见性真相源）**：`kit.ts:273-299`，24 项：
`beat_done` / `enter_nsfw` / `exit_nsfw` / `update_state` / `read_memory_detail` / `search_archive`（playwriter）；`generate_image` / `web_search` / `read` / `write` / `edit` / `list_library`（两者）；`generate_bgm` / `recut_sprite` / `read_skill` / `set_craft` / `list_voices` / `bash` / `get_readiness` / `view_image` / `import_asset` / `list_saves` / `read_lineage`（workshop）。

**(c) 基座与默认集**：`BASE_TOOLS = ["read"]`（`kit.ts:308`）；`defaultCapabilitiesFor(role)`（:333-337）= 该角色能力 − locked − defaultOff；`enabledCapabilitiesFor()`（:340）；`enabledToolsFor()`（:352）；`writeScopesFor()`（:362）；`capabilitiesOf()`（:377，`can` 键 = 能力 id）。

**工具入参形状（重点）**：

| 工具 | 角色 | 参数 schema（源码位置） |
|---|---|---|
| `beat_done` | playwriter | `{options?: string[2..8] 每条≤200, placeholder?: string≤200}`，`additionalProperties:false`（`agentkit/beatTool.ts:18-28`）；execute 校验「去空白后 <2 条」抛错（:52-54）；`terminate: true`（:76） |
| `update_state` | playwriter | `{affinity?: Record<string,number>, flags?: Record<string,string\|number\|boolean>, scene?: string≤2000, threads?: string≤2000}`（`agentkit/memoryTool.ts:9-20`）；增量上限 5、值域 0-100（`memoryTool.ts:6-7`） |
| `read_memory_detail` | playwriter | `{name: string}`（`memoryTool.ts:22`） |
| `search_archive` | playwriter | `{query: string≤200, limit?: number}`（`memoryTool.ts:24-30`） |
| `enter_nsfw` | playwriter | `{reason?: string≤500}`（`agentkit/nsfwTool.ts:5-11`） |
| `exit_nsfw` | playwriter | `{summary?: string≤500}`（`nsfwTool.ts:13-19`） |
| `generate_image` | 两者（同 schema，description 与等待策略不同） | `{kind:"background"\|"cg"\|"sprite", name?≤40, spriteId?≤40, variant?≤40, references?: string[1..6] 每条≤2000, referenceCharacters?: string[1..6]≤40, framing?:"full"\|"half"\|"square", stature?:"small"\|"normal"\|"large"\|"huge", title?≤40, style?≤200, prompt: string[1..4000]}`（`agentkit/imageTool.ts:26-88`）；`mode:"sync"`(工坊) / `"queued"`(剧作家)（`imageTool.ts:189-194`） |
| `recut_sprite` | workshop | `{spriteId: string≤40, variant?≤40, cutout?: {tolerance?: int 0-128, keySmooth?: num 0-8, edgeBand?: int 1-32}}`（`agentkit/recutTool.ts:20-47`） |
| `generate_bgm` | workshop | `{name≤40, prompt≤2000, title?≤40, description?≤300, tags?≤8×24, mood?≤8×16, scene?≤8×16, loop?, volume? 0-1, overwrite?}`（`agentkit/musicTool.ts:24-54`） |
| `set_craft` | workshop | `{beatLength?: enum\|null, stopOptions?: enum\|null, assets?: {...四类}\|null}`，null = 恢复默认（`agentkit/craftTool.ts:20-96`） |
| `list_library` | 两者 | `{kind?: enum 6 类, query?≤100}`（`agentkit/libraryTool.ts:41-52`） |
| `import_asset` | workshop（`importAsset:false` 时不给剧作家） | `{kind, entryId: string\|string[1..40]≤64, variants?≤24×40, target?:"protagonist"}`（`libraryTool.ts:54-77`） |
| `list_saves` | workshop | `{}`（`agentkit/lineageTool.ts:17`） |
| `read_lineage` | workshop | `{saveId≤64, offset?, limit?, allBranches?}`（`lineageTool.ts:18-27`） |
| `view_image` | workshop | `{source: string[1..2000]}`（剧目内路径或 http(s)）（`agentkit/viewTool.ts:28-39`） |
| `list_voices` | workshop | `{query?≤60, language?≤8, gender?:"male"\|"female", tags?: string[1..4]≤40}`（`agentkit/voiceTool.ts:29-42`） |
| `web_search` | 两者 | `{query: string[1..400], numResults?: int 1-10}`（`agentkit/searchTool.ts:13-20`） |
| `read_skill` | workshop | `{name: string≤64}`（`agentkit/skillTool.ts:17`） |
| `get_readiness` | workshop | `{}`（`agentkit/readinessTool.ts:13`） |
| `read`/`write`/`edit`/`bash` | 见 TOOL_CATALOG | **pi 内建工具**，无描述覆写入口，通过 `createPiFileTools(env)` / `createPiBashTool(env)` 适配（`agentkit/piTools.ts:57-62`）；路径政策在 `PlayEnv` |

**与「写剧本 / 推进演出 / 生成素材」直接相关的工具**：
- 写剧本：**没有专用工具**——剧作家靠**纯文本输出 Stage DSL**（`prompt.ts:140` FORMAT_RULES），解析器流式消费。
- 推进演出：`beat_done`（收束 + 停止点载荷，`beatTool.ts:38`）；`update_state`（状态，`memoryTool.ts:48`）；`enter_nsfw`/`exit_nsfw`。
- 生成素材：`generate_image`（`imageTool.ts:189`）、`generate_bgm`（`musicTool.ts:88`）、`recut_sprite`（`recutTool.ts:68`）、`import_asset`（`libraryTool.ts:138`）、`list_library`（`libraryTool.ts:88`）。
- 壳侧对 `emitStop` / `emitPreload` 的接线：`orchestrator.ts:554-555`，与 `players` 事件同管道。

### 2.6 REST / WS 端点清单

**WS**：仅一个路径 `/ws?play=<id>[&workshop=1]`（`apps/server/src/transport.ts:13-22`）；消息体见 §1.4。

**REST（全部在 `apps/server/src/http.ts` 的 `handleHttp`，:138）**：

| Method + Path | 作用 | 行号 |
|---|---|---|
| `GET /plays/:id/media/tts/:file` | TTS 音频静态服务（仅 `*.mp3`） | :153-161 |
| `GET /plays/:id/assets/<kind>/<...>` | 剧目素材静态服务（no-cache） | :164-175 |
| `GET /library/<kind>/<id>/<file>` | 资源库素材静态服务（只读） | :178-193 |
| `GET /api/library?kind=&q=` | 资源库清单 + 分类计数 | :196-209 |
| `GET /api/health` | RSS/heap/uptime/livePlayCount | :212-222 |
| `GET /api/voices?language=&tag=&q=&refresh=` | 音色库窗口查询（tag ≤4、q ≤60） | :225-243 |
| `GET /api/voices/:id` | 单条音色解析（id 须 32 hex） | :244-248 |
| `GET /api/agents/models?refresh=` | 网关模型清单 ∩ 支持清单 | :253-258 |
| `GET /api/agents/capabilities` | 角色能力目录 | :259 |
| `GET /api/config` | 读设置（凭据只回掩码） | :267 |
| `PUT /api/config` | 写设置（唯一保存入口，立即生效） | :268-272 |
| `POST /api/lan/open-firewall` | 一键放行 Windows 防火墙（仅 loopback） | :277-286 |
| `GET /api/plays` | 剧目列表 | :292 |
| `POST /api/plays/import` | 导入剧目 zip | :295-299 |
| `POST /api/plays/create` | 新建空剧目 `{id,title}` | :300-306 |
| `GET /api/plays/:id` | 详情：`{play, premise, readiness, cast, manifest}` | :314-330 |
| `DELETE /api/plays/:id` | 删除剧目 | :331-334 |
| `GET /api/plays/:id/history` | 剧作家历史快照（只读） | :338-344 |
| `GET /api/plays/:id/lineage` | 路线树（会建 runtime） | :345-350 |
| `GET /api/plays/:id/saves` | 周目列表 | :354 |
| `POST /api/plays/:id/saves` | 新建周目 `{name?}` | :355-359 |
| `PATCH /api/plays/:id/saves/:saveId` | 重命名周目 | :364-368 |
| `DELETE /api/plays/:id/saves/:saveId` | 删除周目 | :369-372 |
| `PUT /api/plays/:id/active` | 切档 `{saveId}` | :375-381 |
| `PUT /api/plays/:id/play` | 保存 play.json（重载 runtime） | :383-390 |
| `GET /api/plays/:id/readiness` | 就绪门 | :391-394 |
| `GET /api/plays/:id/theme.css` | 剧目主题层（不存在 404） | :396-402 |
| `GET/PUT/DELETE /api/plays/:id/files?path=` | 工坊文件树/读写 | :404-423 |
| `GET/PUT /api/plays/:id/craft` | 创作口径 craft.md | :425-437 |
| `GET/PUT /api/plays/:id/premise` | 世界观前提 premise.md | :439-450 |
| `GET/POST/DELETE /api/plays/:id/assets` | 素材列表/上传（`?kind=&name=`）/删除 | :451-471 |
| `POST /api/plays/:id/assets/import` | 从资源库导入 | :472-499 |
| `GET /api/plays/:id/assets/meta` | 素材元数据表 | :500-504 |
| `PUT /api/plays/:id/assets/sprite` | 写立绘呈现声明（framing/stature/anchor/title） | :505-543 |
| `GET /api/plays/:id/cg` | CG 台账（静态 + 生成） | :544-555 |
| `POST /api/plays/:id/tts-preview` | 音色试听 | :556-561 |
| `POST /api/plays/:id/images` | 工坊手动生图（同步发起，WS 回报） | :562-591 |
| `POST /api/plays/:id/polish` | 文本润色（≤2000 字） | :592-599 |
| `GET /api/plays/:id/export` | 导出剧目 zip | :600-609 |

---

## 3. apps/web

### 3.1 舞台渲染层的组织

**入口与路由**：
- `apps/web/src/main.tsx:6-10`：`createRoot(#root).render(<StrictMode><App/></StrictMode>)`。
- `App.tsx:18-51`：hash 路由（`src/router.tsx:9-20` 的 `parse()`）。分派：`#/settings` → SettingsScreen；`#/play/:id/stage` → **StageScreen**（:42，`key = query`）；`#/play/:id/saves` → SavesView；`#/play/:id` → TitleView；默认 → LibraryView。
- 视图类型 `StageView = "stage"|"backlog"|"route"|"cg"|"workshop"`（`stage/view.ts:10`），工坊是**第四个视图而非独立路由**（`App.tsx:11-17` 注释）。

**组件树**（`views/StageScreen.tsx` 是舞台的根组件，750 行）：
```
StageScreen (views/StageScreen.tsx:44)
├─ StageShell          侧栏五视图外壳        (:598)
├─ StageTheater        舞台视觉层+打字机+导演栏 (:609)
│   └─ StopPanel       停止点面板            (:655)
├─ HistoryView / BacklogView  回顾（两种）    (:673 / :675)
├─ RouteTree           路线树                (:693)
├─ CgView              CG 台账               (:705)
├─ WorkshopPane        工坊八 tab            (:707)
├─ StageModes          模式浮层              (:728)
└─ PromptQueuePanel    排队/生成面板          (:738)
```

**状态来源（StageScreen 内）**：
- `useStageSocket(playId, ...)`（`stage/useStageSocket.ts:123`）——**所有演出状态的唯一来源**：`state/lines/cues/scene/names/stop/epoch/queue/pendingJobs/nsfw/saveName/readPos/...` 与全部 send 方法（`useStageSocket.ts:20-85`）。
- `usePlayback()`（`stage/director.ts`）——打字机、点击推进、自动模式、快进。
- `VoiceDirector`（`stage/audio.ts`）——语音播放。
- `useGeneratedAssets()`（`stage/generatedAssets.ts`）——生成资产台账 + 预解码。
- `useLineage(playId, nonce)`（`stage/LineagePanel.tsx`）——路线谱系（按需拉取，不随每轮广播）。
- `buildAssetIndex(playId, assets, generated, manifest, cast)`（`stage/assets.ts:64`）——素材寻址索引；`spriteDirOf` / `spriteName` 等。
- 其余为 REST 拉取的 `detail`（`PlayDetail`，含 play/premise/readiness/cast/manifest，`api.ts:79`）、本地 useState（view/tab/rebase/nonce）。

**渲染管线（IR → 画面）**：
- `stage/script.ts` 的 `ScriptBuilder.apply(event, seq)`（:79）把 `StageEvent` 流切成两类：
  - `ScriptLine[]`（:4-16）—— say/narrate/thought/input/scene/sfx/cg 的**行模型**；
  - `Cue[]`（:24-53）—— scene/actor/sfx/cg/preload/line 的**演出提示**，视觉指令即时应用、行提示走打字机队列。
- 玩家输入是**一等行**：`player_input` 直接落 type `"input"` 的一行、不开打字机（`script.ts:174-187`）。
- 路线树的轮切分与卡片逻辑在 `stage/beats.ts`（`buildBeats` / `beatAtLine` / `editableNodeAtLine`）与 `stage/transcript.ts`。

### 3.2 渲染一场演出需要哪些输入？是否强依赖 WS / 服务端 API

**强依赖，且是双向的**：
- **WS 是必需且是演出状态的唯一来源**：`useStageSocket` 用 `new WebSocket(`${ws|wss}://${location.host}/ws?play=<id>[&workshop=1]`)` 连**同源**服务端（`stage/useStageSocket.ts:168-173`）；连接后立刻发 `resume`（:183）。没有 WS 就没有 lines/cues/stop/pending。
- **REST 只补静态上下文**：`api.ts` 的 `request()` 用相对路径 `fetch`（`api.ts:219-224`），端点即 §2.6；舞台需要 `GET /api/plays/:id`（`PlayDetail`：play/premise/readiness/cast/manifest，`api.ts:79-96`）。
- **素材 URL 全是服务端相对路径**：`/plays/<id>/assets/<dir>/<file>`（`stage/assets.ts:75`）、`/plays/<playId>/media/img/<file>`（core `protocol.ts:147` 注释）、TTS `/plays/:id/media/tts/<hash>.mp3`。
- **StageTheater 的 props 面**（`stage/StageTheater.tsx:25-74`）：`visual / playback / live / fresh / names / index / voiceAvailable / voiceOn / onToggleVoice / busy / targets / onPrompt / onEdit / onFork / onGenerateCg / onReplay / voiceState / onUnlock / onView / canContinue / onContinue / onTurbo`。
  - 其中 `index: AssetIndex`、`names`、`visual` 是纯数据；回调 `onPrompt/onFork/onGenerateCg/...` 全部最终发 WS（`sendPrompt`/`sendFork`/`sendGenerateCg`）。
- **结论**：`StageTheater` 本身是受控组件（拿 props 渲染），但它的**所有父级数据管道都绑死在同源 WS + REST 上**；没有任何 demo/mock 输入层或独立数据源适配器（全仓 grep 未见）。
- 一个可分离的例外：`ScriptBuilder`（`script.ts`）与 `buildAssetIndex`（`assets.ts`）是**纯函数/纯类**，只吃 core 的 IR 类型。

### 3.3 构建产物形态

- `apps/web/vite.config.ts` 是**唯一的 web 构建配置**：`plugins: [react()]` + dev server proxy（`/ws`（ws:true）、`/api`、`/plays`、`/library`，:26-36）。
- **没有 `build.lib`**，没有任何库模式入口/`exports`/`rollupOptions` → 产物是**单页应用**，输出 `apps/web/dist/{index.html, assets/, favicon.ico}`（实盘核对）。
- `apps/web/package.json` 没有 `main`/`module`/`exports`/`files`，且 `private: true`（:3-4）→ **不可作为 npm 库消费**。
- `apps/web/tsconfig.json` 是 `noEmit` + `jsx: react-jsx` + `types: ["vite/client"]`（:3-9）。
- 构建命令 `tsc --noEmit && vite build`（`apps/web/package.json:10`）。
- **对外可复用的 React 组件边界：现状不存在**。可复用性只到「文件级」：`StageTheater` / `StageShell` / `ScriptBuilder` / `buildAssetIndex` / `ui/*` 都是普通模块，但没有任何 `index.ts` barrel、没有 props 之外的公共契约文档、没有独立打包。web 内部也不用 barrel，全部 `../stage/x.js` 直接引用。
- 服务端把该 dist 挂在**同端口**（`index.ts:52`、`webStatic.ts:40-60`），生产形态是「一个 exe 一个端口整站」。

### 3.4 「工坊」界面在 web 侧的位置与入口

**位置**：`apps/web/src/workshop/`（17 个文件），根组件 `workshop/WorkshopPane.tsx`（397 行）。

**入口（三条）**：
1. 舞台外壳的侧栏第四视图 `view === "workshop"`（`App.tsx:38-43` → `StageScreen` → `StageScreen.tsx:707`）；
2. URL query 直达：`#/play/:id/stage?view=workshop[&tab=…][&workshop=1]`，解析在 `stage/view.ts:31-56`（`stageViewFromQuery` / `stageTabFromQuery` / `workshopConnectionFromQuery`），构造 URL 在 `view.ts:58`（`workshopUrl`）；
3. `?workshop=1` 时 WS 连接带 `workshop=1`，服务端跳过 autostart（`transport.ts:20-21`）。

**八个 tab**（`stage/view.ts:22` 是顺序唯一真相源）：`chat | play | characters | memory | assets | files | agent | settings`；渲染分派在 `workshop/WorkshopPane.tsx:155-190`，tab 定义在 `:21`。
- `chat` → `AgentPane`? 实际：`chat` → 对话流（`TurnParts.tsx` 渲染 `WorkshopPart[]`），`agent` → `AgentPane`（模型/思考/能力开关/出图审批），`play` → `PlayPane`（play.json 字段 + 写作参数 + 封面），`characters` → `CharacterPane`，`memory` → `MemoryPane`，`assets` → `AssetsPanel`，`files` → `FileBrowser`，`settings` → `WorkshopSettings`。
- 状态机：`workshop/useWorkshop.ts`（238 行），从 `useStageSocket` 订阅 `workshop_*` 下行（`WorkshopInbound`，`useStageSocket.ts:13`），复用 core 的 `appendText/appendThinking/startTool/endTool/attachToolAssets`（`useWorkshop.ts:2`）。
- **工坊没有独立连接**：复用舞台那条 WS（`apps/web/AGENTS.md` 的「工坊恒全屏且复用舞台那条连接」；代码 `StageScreen.tsx:137-140` 的 handler 注册表）。

---

## 4. 其它：构建、依赖、嵌入迹象

### 4.1 根 scripts 与打包

- 根脚本（`package.json:24-32`）：`build`（`pnpm -r build`）/ `typecheck` / `test` / `soak`（`scripts/soak.mjs`）/ `exe`（`scripts/build-exe.mjs`）/ `desktop`（`scripts/build-desktop.mjs`）/ `icon`（`scripts/make-app-icon.mjs`）。
- `scripts/build-exe.mjs`：esbuild 先把 ESM 依赖图（含 workspace 包）收成一个 CJS 入口，再交给 `@yao-pkg/pkg` 打单文件 exe（`build-exe.mjs:1-14`）；快照内目录按仓库布局摆 `apps/web/dist`、`apps/server/skills`（`build-exe.mjs:9-11`）。**只能打宿主平台或 Windows target**（`build-exe.mjs:38-42`）。
- `apps/desktop/src-tauri/src/main.rs`：拉起随包 sidecar、读 stdout 等就绪地址、把窗口指过去、退出时收摊（`main.rs:1-26`、:174-195）；**桌面壳不做任何业务**（README 开发一节）。
- 发版走 `.github/workflows/release.yml`（windows-latest + tag）。

### 4.2 依赖图与外部依赖（对插件化最关键的三条）

1. **`@aivn/core` 是零运行时依赖的纯 TS 库**（§1.6），可被任意宿主以 ESM 引入 —— 但它**只导出规范/类型/纯函数**，不含渲染器与编排器。
2. **`@aivn/server` 重依赖 Node 生态**：`ws`、`sharp`（native）、`minisearch`、`undici`、`fflate`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`（`apps/server/package.json:13-22`）。其中：
   - `sharp` 是**原生模块**，exe 打包时是唯一动态加载的原生依赖（`build-exe.mjs:6-7` 注释）；
   - LLM 能力完全绑在 pi 的两个包上（`provider.ts:3` 引入 `pi-ai/api/openai-completions.lazy`；`orchestrator.ts` 用 pi 的 `Agent`/`AgentTool`/`StreamFn`）；
   - 有一个**进程级内存态**：`PlayHouse` 按剧目缓存 runtime/素材层/闸门（`playhouse.ts:159-214`），`settings.json` 通过 `SettingsStore` 持有内存镜像并 `fs.watch` 监听（`apps/server/src/settingsStore.ts`，由 `index.ts:43` 构造）。
3. **`@aivn/web` 只依赖 `@aivn/core` + react/react-dom/lucide-react**（`apps/web/package.json:13-18`，其中 core 在 :14）；但它是 SPA 构建、无库出口（§3.3），且数据管道同源绑定 WS/REST（§3.2）。

### 4.3 「嵌入到别处」的既有迹象

**已存在的集成形态只有一种半**：
1. **Tauri 桌面壳 sidecar**（完整）：`apps/desktop/`，Rust 约 300 行只做「spawn exe + 读 stdout + 指向窗口」（`apps/desktop/src-tauri/src/main.rs:1-26`）；这是**进程级**集成，不是代码级嵌入。
2. **服务端单端口挂 web dist**（半种）：`serveWebBundle` 把 `apps/web/dist` 挂上（`index.ts:52`、`webStatic.ts:40`），但这只是同仓产物托管，不是对外可复用接口。

**没有的东西（全仓核实）**：
- 仓库内**无任何 DSH / 插件宿主相关代码或文档**：无 plugin manifest、无 `inject`/`ctx`、无宿主注册点。
- `apps/web` **无库模式构建、无 barrel 导出、无 `exports`**，不能作为 npm 包被别处 `import`。
- core **无子路径导出**（只能 `import "@aivn/core"` 取全部）。
- 无 iFrame/Web Component/embed 脚本/`postMessage` 桥。
- web 侧无 WS/REST 的抽象层（无 `Transport` 接口、无 mock adapter）——数据源与同源 URL 硬编码在 `useStageSocket.ts:168` 与 `api.ts:219`。
- 文档里检索「嵌入/embed/插件/plugin/iframe/作为库」在 `docs/features/` 有命中，但都是**别的语境**（如引擎设计调研、浏览器插件无关讨论），没有「AIVN 作为可嵌入引擎」的方案记录。

### 4.4 一条安全观察（与插件化无关但影响发布）

- 仓库根存在 `.pi/mcp.json`，其中 `EXA_API_KEYS` 是**明文真实密钥**（`.pi/mcp.json:8`，此处不转载值）。`.mcp.json`（:6）用 `api-vault` 命令注入、未落明文，两者行为不一致。若本仓要对外发布需先处理（本报告不复制凭据）。

### 4.5 其它值得注意的运行时事实

- **单进程内存态是插件化的主要结构性障碍**：`PlayHouse` 的 `runtimes/playAssets/playMusic/pendingJobs/limiters` 都是进程内 Map（`playhouse.ts:159-214`），`LineageTree` 是纯内存树 + 落盘重建（`packages/core/src/lineage/model.ts:176-186`），`orchestrator` 的事件缓冲 `events[]` 亦在内存（`orchestrator.ts:344`）。
- **`orchestrator` 与 pi `Agent` 强耦合**：`agent.prompt()` / `agent.waitForIdle()` / `agent.abort()` / `agent.subscribe()` 是推进演出的四个动作（`orchestrator.ts:1763-1764`、:1740、:1943），`buildAgent()`（:594）把 `kit.tools` 与拼好的 systemPrompt 一起交给 pi。
- **模型/工具/提示词的装配只有一个入口**：`createAgentKit()`（`kit.ts:410`）+ `buildSystemPrompt()`（`prompt.ts:311`）+ `buildWorkshopPrompt()`（`workshop.ts:135`）——这三点是任何宿主迁移必须替换或适配的接缝。
- **skill 目录有两处且只有一处生效**：生效的是 `apps/server/skills/`（由 `paths.ts:44` 的 `workshopSkillsDirOf` 反推，`build-exe.mjs` 按 `apps/server/skills` 入快照）；仓库根的 `skills/` **不参与打包、`read_skill` 读不到**（`apps/server/AGENTS.md`「技能库与新剧目初始状态」一节）。

---

## 5. 附录：可用于后续评估的关键接缝一览

| 接缝 | 位置 | 现状 |
|---|---|---|
| DSL 规范与解析 | `packages/core/src/dsl/{spec,parser,events}.ts` | 纯 TS、零依赖、可直接复用 |
| IR 事件类型 | `packages/core/src/dsl/events.ts:30` | 可直接复用 |
| WS 协议 | `packages/core/src/ws/protocol.ts` | 可直接复用（客户端/服务端共用） |
| 谱系树 | `packages/core/src/lineage/model.ts:176` | 纯 TS 类，可复用 |
| 舞台渲染组件 | `apps/web/src/stage/StageTheater.tsx:25` | React 组件，但数据管道绑死同源 WS/REST |
| 演出编排 | `apps/server/src/orchestrator.ts:340` | 绑死 pi Agent + Node 进程内存 |
| 每剧目宿主 | `apps/server/src/playhouse.ts:158` | 进程内 Map 缓存，无外部注入点 |
| Agent 装配 | `apps/server/src/agentkit/kit.ts:410` | 目录驱动，能力/工具两套真相源 |
| LLM provider | `apps/server/src/provider.ts:12` | 固定 `openai-completions` API 形状 |
| 数据根 | `apps/server/src/paths.ts:29` | 环境变量 `STAGE_PORT/HOST/DATA_DIR` + `settings.json` |
| 现有集成样例 | `apps/desktop/src-tauri/src/main.rs` | 进程级 sidecar（唯一先例） |
