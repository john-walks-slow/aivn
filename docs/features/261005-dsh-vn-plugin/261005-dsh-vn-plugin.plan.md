# AIVN 引擎做成 DSH 插件 · 计划

调研证据两份：`aivn-architecture.research.md`（AIVN 侧，556 行）、`dsh-plugin-capability.research.md`（DSH 侧，458 行）。

## 结论

**可行性成立**，三条硬证据：

1. 「对话页切到 VN 渲染」在 DSH 里是一等能力，不是 hack。往 `conversation.view` 槽注册一条即得一个会话 tab，选中时整块对话主区渲染插件组件（`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:183-188`）。已有四个先例，其中两个是纯第三方插件：`dsh-proactive`、`dsh-live-mode`（Live2D 整屏，与本需求同构）。
2. 一个插件包可以同时带**宿主半边**（引擎、工具、HTTP 路由）、**客户端半边**（VN 视图）与**若干个 agent 预设**（bundle patch 里插 `@deepseek-ai/dsh-agent-preset` 行）。三件事都在一个包里，不需要改 DSH 本体。
3. `@aivn/core` 是零运行时依赖、零 Node/DOM API 的纯 TS 库（`packages/core/src/index.ts:1-17`），可直接被插件宿主半边 import。

**工作量**：约 **10,550–15,200 行**新写/改造。其中「能演起来、素材先手工放」的版本约 **6,900–9,700 行**。

**最大的一块不是引擎，是舞台渲染层的搬运**（2,500–3,500 行）；引擎侧真正的重写只有编排与路由两处（约 1,000 行），其余是搬运加接线。

---

## 一、目标与边界

### 做

- 一个 DSH 插件包（暂名 `dsh-aivn`）：
  - 会话位置多两个 agent 预设：**剧作家（playwriter）** 与 **搭台助手（workshop）**；
  - 对话页多一个「舞台」tab，切过去就是 VN 演出；
  - 演出所需的一切（DSL 解析、IR 流、停止点、素材、语音）由插件宿主半边提供，不依赖外部进程。

### 不做

| 不做 | 理由 |
|---|---|
| 分支 / 跳转 / 重写 / 删除（谱系原语） | 用户决定。DSH 会话 append-only、只支持 fork，没有就地截断；这块原本也是风险最高的一段 |
| 路线树 / 回顾（backlog、历史重看、轮卡片） | 用户决定。演出是线性的，重看交给 DSH 会话本身 |
| 舞台的导演工作栏、导航侧边栏 | 用户决定。舞台只留画面 + 台词条 + 停止点，其余交给 DSH 的既有外壳 |
| 工坊素材管理界面（素材页、CG 台账、立绘声明编辑、上传导入） | DSH 文件侧栏 + 素材目录本身就是管理面；生成与引用照旧有工具 |
| 工坊会话线程（threads.json、历史、纪元压缩） | DSH 会话代替「工坊线程」 |
| 周目（saves/）、判废回滚、纪元压缩与 A 区冻结 | 都依附于分支语义 |
| pending panel（生成中任务浮层） | 改用 DSH 原生后台任务（见 3.5） |
| 剧目库页 / 标题页 / 封面管理 / 独立设置页 | DSH 的会话列表、工作区选单、设置页覆盖 |
| 替换 AIVN 独立应用 | 两者并存；抽出来的公共包对 AIVN 自己也是净收益 |

---

## 二、用户视角

1. 新建会话 → 预设选「剧作家」，工作区选一个**剧目目录**（或先用 `/新剧目` 生成一个空的）。
2. 先用「搭台助手」预设开一个会话把前提、角色、画风对齐。
3. 回到剧作家会话，头部多一个「舞台」tab，切过去；底部台词条选一条或自由输入 → 边生成边演。
4. 素材不够时，搭台会话里 `generate_image` / `generate_bgm` / `list_library` 照常调；产物落在同一工作区，舞台自动到货淡入。
5. 生成中的任务在 DSH 会话自带的头部任务列表里看进度。
6. Chat tab 里仍是原始 Stage DSL 文本（见「未决」第 3 条），舞台 tab 里是画面。

---

## 三、架构

### 3.1 三块代码

```
@aivn/core        已有，不动。DSL 规范 / 流式解析器 / IR / 协议类型 / 立绘与落位纯函数
@aivn/stage       新抽，从 apps/web/src/stage 出。舞台 React 渲染层 + StageTransport 接口
dsh-aivn          新仓库，DSH 插件。宿主半边 + 客户端半边 + 两个预设
```

今天 `apps/web/src/stage`（6,567 行）是道具驱动的（`StageTheater` 的 props 面在 `apps/web/src/stage/StageTheater.tsx:25-74`），但**父级数据管道**硬编了同源 WS（`stage/useStageSocket.ts:168` 用 `location.host`）与相对路径 REST（`api.ts:219`）。抽一个 `StageTransport` 接口（`send` / `subscribe` / `loadDetail` / `assetUrl`），AIVN 侧实现成 WS，插件侧实现成「宿主路由 + SSE」，两边共用同一份渲染层。`ScriptBuilder`（`stage/script.ts:79`）与 `buildAssetIndex`（`stage/assets.ts:64`）本来就是纯函数。

抽取时同时裁掉：`RouteCanvas`(548) / `routeTree`(144) / `LineagePanel`(98) / `beats`(337+369) / `CgView`(87) / `PromptQueuePanel`(279) / `transcript`(142+166) / 回顾视图，`StageShell` 的五视图外壳（252）收成单视图的演出外壳。

### 3.2 AIVN → DSH 映射

| AIVN | DSH | 处置 |
|---|---|---|
| pi `Agent` + `orchestrator.onAgentEvent`（`orchestrator.ts:1943`） | `agent/assistant-stream`（`dsh-agent/lib/types/runtime-types.d.ts:366`，frame = start/chunk/end） | **重写**编排，只留演出部分 |
| `createAgentKit` / `TOOL_CATALOG`（`agentkit/kit.ts:410`） | `defineTool` + `agent.ctx.tools.register`（先例 `dsh-live-mode/src/camera-tool.ts:75`） | **改造**：schema 与描述原样搬 |
| role `playwriter` / `workshop`（`agentkit/role.ts:12`） | 两个 `@deepseek-ai/dsh-agent-preset` 行 | **改造** |
| `prompt.ts`(524) / `workshop.ts`(574) 提示词正文 | 预设里的 `dsh-persona` / `systemPrompt.section()` | **正文原样搬**，只换工具名 |
| `PlayEnv` 路径白名单 + 撤销条 | DSH fs 沙箱 + `tools/pre-execute` 守卫 | **简化**：只保留剧目不变量（`memory/arcs`、`memory/archive` 只读；写面按能力位收） |
| `LineageTree`（`core/lineage/model.ts`） | 不用。舞台状态从**会话日志重建**（见 3.3） | **删除** |
| `workshopSession.ts`(557) + `workshopThreads.ts` + `compaction.ts`(346) | DSH session + compaction | **删除**，用会话代替 |
| `saves/` 周目 | DSH session | **删除**概念 |
| `pendingJobs.ts` + 排队浮层 | `ctx.jobs` + `dsh-client-ui-jobs` | **替换**（见 3.5） |
| `/ws?play=<id>`（`core/ws/protocol.ts`） | 宿主 HTTP 路由 + SSE（先例 `dsh-live-mode/src/routes.ts`） | **改造**：协议类型不变，传输面换 SSE |
| `plays/<id>/` 目录（`store.ts`） | 会话工作区目录 | **改造**：数据契约不变 |
| `library/`（跨剧目素材库） | 插件配置的 `libraryDir` | **原样搬** |
| `settings.json` + 设置页 | 插件 `Config` + `settings.section` 槽 | **改造**成 DSH 设置分区 |

被 DSH 顶掉的基础设施是这次能收敛的主要原因：会话、历史、压缩、标题、模型选择、设置存储、文件工具、沙箱、审批、技能库、后台任务，DSH 都已经有了。

### 3.3 舞台状态不再自持：从会话日志重建

砍掉分支之后，演出是线性的，于是**舞台的全部状态都可以从 DSH 会话日志推出来**：

- 台词、旁白、场景、立绘、音效、CG = 重新解析该会话的 assistant 消息（DSL 是确定性文本）；
- 停止点 = `beat_done` 工具调用的参数（也在会话日志里）；
- 玩家输入 = user 消息；
- 素材到货 = 文件系统现状 + 工具调用记录。

于是插件不需要自持事件库、不需要落盘 `lineage.jsonl`、不需要构建期重建——这正是 DSH 的第一原则「会话日志是唯一真相源」。**内存里只留一个live SSE 广播 hub**（正在流的那一轮）。

### 3.4 演出数据流

```
VN 视图（客户端半边）
   │ ① 玩家选一项 / 自由输入
   ▼
POST /aivn/session/<sessionId>/input  ──►  插件宿主半边
   │                                           │ ② 投用户消息给该会话
   │                                           ▼
   │                                    剧作家 agent 跑这一轮
   │                                           │ ③ 流式输出 Stage DSL 文本
   │                                           ▼
   │                                    StageDslParser.feed(delta)   ← @aivn/core
   │                                           │ ④ 产出 StageEvent IR
   │                                           │    加 seq → SSE hub（每会话一条）
   │ ⑤ EventSource 订阅                        │
   ◄───────────────────────────────────────────┘
   │ ⑥ ScriptBuilder.apply(event, seq) → 行 + cue，边生成边演
```

- 工具产出的 IR（`beat_done` → `stop`、`generate_image` → `preload_asset`）走同一条 SSE（对应 AIVN 的 `emitStageEvent`）。
- 轮边界：宿主订阅会话的 `turn/end`（durable）广播 `beat_end`；重连时客户端凭 seq 补推，或直接整段重放。
- 素材：静态资源由宿主前缀路由提供（`/aivn/assets/...`、`/aivn/library/...`），与 AIVN 的 `GET /plays/:id/assets/...` 同一套。

### 3.5 生成中的任务走 DSH 原生后台任务

`ctx.jobs`（`dsh-jobs/lib/types/index.d.ts`）已有完整契约：`start(spec)` 返回 `<kind>-N` id、按会话归属、有生命周期状态、每条任务一个输出环、有事件流。`dsh-client-ui-jobs` 把这些渲染成**会话头部的任务列表**——运行中的行带计时与进度、可展开输出面板、带两段式停止按钮；一个任务都没有时这个控件根本不出现。

对插件的意思：生成类工具（出图 / 抠底 / BGM / 语音）不再自己记账和画浮层，改成 `ctx.jobs.start(...)`，进度写进 job 的 progress 行，产物到货照旧走 SSE 广播 `asset_ready`。

需要自己留的只剩舞台上的**骨架占位与到货淡入**（`stage/generatedAssets.ts`，68 行）——那是画面的事，不是任务列表的事。

一条要注意的行为差异：DSH 的任务结算会给**模型**发一条完成通知（"任务已完成"），而 AIVN 的 queued 出图是静默到货。这会往对话里多插一条通知、可能唤醒 agent。属于要实测确认的小项（见「风险」）。

### 3.6 绑定：一个会话 = 一出戏

**会话工作区目录 = 剧目目录**（目录里有 `play.json`）。

- 剧作家与搭台助手天然是「同一剧目的两个会话」，DSH 的工作区就是这层归属；
- DSH 的 fs 沙箱、文件侧栏、`dsh-workspace-changes` 撤销面立刻可用，`PlayEnv` 大半不需要搬；
- 不再需要「剧目库」这一层 UI。

代价与对策：

- 新建剧目要先有目录：给一个 `/新剧目` 命令（或设置面板里一个按钮）跑 `createEmpty()`（`store.ts:509`）的等价物。
- 跨剧目的素材库在插件配置里给 `libraryDir`，默认 `<DSH_HOME>/aivn/library`。
- 从既有 AIVN 迁移：把 `plays/<id>/` 整个拷成一个工作区目录，库存格式不变。

### 3.7 两个预设

**剧作家**（演出会话）
- 提示词：`ROLE_INTRO` / `HOW_I_WORK` / `FORMAT_RULES` / `CONTRACT_RULES` + `renderCraftParams()`（写作参数每轮必注）。
- 工具：`beat_done`、`update_state`、`generate_image`（queued）、`list_library`，加 DSH 的 `read` / `write` / `edit`（写面按能力位收）。不装 `bash`。

**搭台助手**（制作会话）
- 提示词：`RESPONSIBILITY_RULES` / `TALK_RULES` / `IMAGE_BASICS` / `setupFlow` / `writingPoints`。
- 工具：`generate_image`（sync）、`recut_sprite`、`generate_bgm`、`list_library`、`import_asset`、`list_voices`、`view_image`、`web_search`、`read_skill`、`set_craft`、`get_readiness`，加 `read` / `write` / `edit`；`bash` 默认关。
- 技能库沿用 `apps/server/skills/`，随插件包发布。

### 3.8 舞台事件类型（协议面不变）

`core/ws/protocol.ts` 的 30+ 下行消息里，插件只用到演出相关的那一束：`hello`、`events`、`beat_start` / `beat_end`、`audio_ready` / `audio_pending`、`asset_ready` / `asset_failed`、`pending_jobs`（改为读 jobs）、`error`。工坊那一束（`workshop_*`）随工坊线程一起删除。

---

## 四、分阶段

### 阶段 0 · 管道验证（1–2 天，不可省）

**已完成（2026-10-05）**：`/root/projects/dsh-aivn` 建库，宿主半边装 `/aivn` 路由（SSE 推 IR、POST 收输入），客户端半边注册 `conversation.view` 的「舞台」tab；`e2e/verify-stage.mjs` 12 项全绿——tab 出现（Chat / Trajectory / 舞台）、切过去视图挂载、SSE 在线、台词逐字增长、立绘位与停止点渲染、输入回执回到画面、全程无页面报错。

- `dsh-aivn` 骨架：`package.json`（`exports["./client"]` + `dsh.bundle.patch` + `dsh.client{platform:"web"}`）、`cordis.patch.yml`、`build.mjs`（esbuild → `window.__ModuleLoader__.load` 包装）。
- 宿主半边：一条 SSE 路由，定时推假 IR。
- 客户端半边：注册 `conversation.view` tab「舞台」，渲染静态画面 + 逐字出现的台词。
- 验收：在真实 DSH web GUI 里切到该 tab。DSH 的 client bundle 有一串已知坑（缺 `lib/client.js` 整页 Failed to load plugins；`load id` 必须等于包名；漏写 `inject` 运行时抛错）。

### 阶段 1 · 演出闭环（线性 MVP，素材手工放）

- 宿主：剧目数据层、剧作家提示词、DSL 管线 + SSE、线性轮状态机、核心工具（`beat_done`/`update_state`/`list_library`/`set_craft`/`get_readiness`/`read_skill`）、静态资源路由、最小设置项、`/新剧目` 命令。
- 客户端：抽 `@aivn/stage` + `StageTransport`（AIVN 侧改造成 WS 实现并跑通不回归）、VN 视图接线（舞台 + 停止点面板 + 打字机 + 回顾）。
- 验收：用一套手工放的素材，剧作家预设能真的开演、能选、能推进、能重连。

#### 阶段 1 完成（2026-10-05）

**代码在另一个仓库**：`/root/projects/dsh-aivn`（分支 `master`，本次提交 `8b58660`，前置 `366c8fe`）。
本仓库只放需求记录；插件代码与它的用户手册（`README.md`）、项目指引（`AGENTS.md`）在那边。

**宿主半边**

- `src/play.ts` —— **会话工作区即剧目**：目录里有 `play.json` 才算一座剧目，没有给空态，文件坏了直接报错不吞。
- `src/hub.ts` —— 每会话一条带 `seq` 的帧流，缓冲 4000 帧。帧分 `ir`（舞台事件）与 `beat`（轮边界）两种，
  `beat` 是 `no_stop` 轮唯一的信号；视图重连先补推缓冲，刷新页面不丢已演过的部分。
- `src/stage-tap.ts` —— 只接 `aivn-playwriter` 预设的会话：助手流的 `text-delta` 喂进 `@aivn/core` 的
  `StageDslParser`，attempt 收束时 `endMessage()` 封口。玩家输入的落点只有 `agent/inbox/inserted` 一处。
- `src/session.ts` —— `sessionPreset` 读**活的预设组合**（`agentPresets.composedPreset`），会话头只当兜底。
- `src/assets.ts` + 路由 —— `listAssets` 口径与 AIVN `store.ts` 一致（立绘按主体拆、排序固定），
  `/aivn/asset` 取件，`resolveInPlay` 挡越界路径。
- `src/playwriter/` —— 两个预设（剧作家 / 搭台助手）、两份提示词、剧作家专属的五个工具
  （`beat_done` / `update_state` / `get_readiness` / `list_library` / `set_craft`）。
- `src/beat-guard.ts` —— 漏调 `beat_done` 的同轮追收束（见下）。
- `src/scaffold.ts` + `src/tools/create-play.ts` + `src/commands.ts` —— 起剧目的两条入口，共用一份脚手架。
- `src/preset-tools.ts` —— 工具跟着预设装、跟着预设卸。
- `src/client/stage-view.tsx` —— 整块由 `@aivn/stage` 渲染（`directorBar={false}`，导演工作栏不渲染）。

**与计划的偏差**

| 计划 | 实际 | 为什么 |
|---|---|---|
| `read_skill` 工具 | 没做 | 那是 AIVN 跨剧目技能库的能力；DSH 侧已有技能机制，重复一套没有意义 |
| 搭台助手带生成工具 | 本阶段只有 `create_play` + 文件工具 | 生成工具是阶段 2；先把身份立住，免得上台才发现工具名全是空的 |
| `RefCharacterPicker` 留在 AIVN | 随 `@aivn/stage` 一并移入包并 re-export | 搬走的 `StageTheater` 生图面板要用它，不搬包就编不过 |
| §3.7 剧作家「不装 `bash`」 | 初版误跟了规格（装了），检视后**收掉** | 计划是对的：剧作家只写戏、读文件，没有要 shell 做的事。搭台助手留一行但标 `disabled`（默认关，用户要开自己开） |
| `list_library` 查跨剧目资源库 | 查**剧目自己**的 `assets/` | 资源库导入是阶段 2；本阶段先答「你手上有什么」，工具名沿用 AIVN 口径 |
| 剧中素材描述表键形 | 按引擎口径：`<stem>` / `<spriteId>` / `<spriteId>/<variant>` | 初版 README 与 e2e 夹具写成了路径键（`sprites/lin/normal.png`），引擎永远匹配不上——检视 S1 修掉 |

**两条实测逼出来的坑**（都已修，细节见 `dsh-aivn/AGENTS.md`，别再回退）

1. **`session.header.agentPreset` 是过期的**：实测会话记录里写 `"agentPreset":"standard"`，
   而玩家是在新会话界面的座位 chip 上选「剧作家」的——那条路只记 `agent-preset/selected` 事件、不改头。
   只读头会把所有「先建会话、再选预设」的会话整条丢掉，舞台一帧都收不到。
2. **漏调 `beat_done` 是常态**：实测快模型把收束写成了正文里的一行 `<beat_done options=[…]/>`，
   引擎不认这个标签，于是没有停止点、玩家没有可点的东西。AIVN 那边同样为此加过
   `fix(server): 漏调 beat_done 同轮追收束一次`（`836be2b4`）；插件侧移植成 `src/beat-guard.ts`
   （挂 `agent/turn-stopping`，steer 一句把停止点要回来，只追一次），并把提示词《结束轮》一节
   改写清楚「这是工具调用，不是标签」——两层都留着。

**检视结论与修复**（检视报告：`261005-dsh-vn-plugin.review.md`，结论「条件准入」）

三个阻塞项都落在「用户真会走到的路径」上，修完才提交。修复要点：

1. **B1 三条读取路径能杀掉整台 DSH**：DSH 启动时挂了进程级 `unhandledRejection → process.exit(1)`，
   而 `/aivn/*` 的 handler 是 `void handle(...)`，异步 rejection 全被吞成未处理拒绝。
   本事：坏掉的 `play.json`、坏掉的 `assets/manifest.json`、`/aivn/asset?path=assets`（目录 → EISDIR）
   都能让整台 DSH 掉线。修法：handler 外层 `.catch` 统一转 500，`sendAsset` 单独拦 `EISDIR` 回 400，
   两处 JSON 解析各自抛出带文件名的可读错误。
2. **B2 一次断线把整部戏演两遍**：`EventSource` 自带重连，而中枢每次连接都整段补推历史，
   客户端既不去重也不重置。修法：按 `seq` 去重；**只在 seq 断档**（断线期间滚出 4000 帧缓冲）时
   `builder.reset()` + 递增 `resetToken` 整段重放。顺带把「切会话」也接进同一条重置路径——
   视图实例被复用时 `builder` 与 `seq` 都是上一部戏的。
3. **B3「继续」发的是开局指令**：AIVN 的 continue 不注入任何文本，初版却把
   `playConfig.opening`（「游戏开始」）当玩家输入再投一次；而 `no_stop` 的轮默认可点击继续，
   于是自然演完的每一轮点一下都发一句，还落成一行玩家台词。修法：继续改投中性的
   `（继续）` 并在宿主侧标 `silent`（仍是 user 消息，但不摆上玩家时间线），加 `continued` 连点闸。

建议项一并收口：`manifest.json` 键形与 `list_library` 文档按引擎口径改（S1/S2）、
id 缺省从目录名规范化派生（S3，`My Plays` 这类目录名不再当场报错）、
追收束的摘除判据从「正文全等」换成 `message.id`（S4，新增 `src/injected.ts` 统一登记
引擎自投的消息）、`POST /aivn/input` 加同源与 `content-type` 校验（S5）、
`BODY_LIMIT` 改按字节（N9）、SSE 事件名统一成 `frame`（N1）、角色卡 YAML 名称转义（N5）、
素材清单排序固定（N6）、`StageHub.dispose()`（N4）、删掉恒 false 的继续卡片分支（N8）。
`e2e` 里未定义的 `KNOWN_IDS` 也补上了（S7）——那条分支恰恰是「舞台没挂载」的失败路径，
一进去就 `ReferenceError`，等于唯一的验证资产在关键时刻失效。

**本阶段不做、留作待办**：S6（`@aivn/stage` 的 `stage.css` 没有搬 AIVN 的移动端小节，
台词条安全区与选肢卡尺寸需真机确认）、N7（`@aivn/core` / `@aivn/stage` 的 `file:` 依赖，
发布前换版本号，被 stage-ai 未合并/未发布阻塞）。

**已知限制**

- DSH 重启后中枢缓冲为空，舞台要等下一轮才重新长出来（会话日志重放留待阶段 2）。
- `buildAssetIndex` 的 cast 只吃 `play.json` 的 `characters`，没读角色卡的 `sprite:` 绑定，
  立绘路由到不了（v1 限制，宿主侧 `/aivn/play` 带上 cast 即可解决）。
- `@aivn/stage` 仍以 `file:` 指向 `stage-ai/.worktrees/dsh-vn-stage` 的包，发布前换版本依赖。

### 阶段 2 · 搭台助手与生成

- 预设与提示词；`generate_image` 三后端、抠底、`generate_bgm`、`list_voices` + TTS、`view_image`、`web_search`、`import_asset`；生成任务接 `ctx.jobs`；设置分区补齐（网关 / 生图 / 语音 / 检索）。

### 阶段 3 · 发布

- npm 发布 + GitHub 仓库 + 双语 README（安装、配置项总表、权限声明）+ 市场收录材料。
- 线上 profile 保持 `link:` 本地目录；发布验证走 scratch profile。

---

## 五、工作量估算

行数口径：插件里最终要写出来的代码（新写 + 由 AIVN 代码改造而来）。

| 层 | 模块 | AIVN 现有 | 处置 | 估计 |
|---|---|---|---|---|
| **A 演出内核** | 剧目数据层（play.json / characters / memory / assets 清单 / 脚手架） | `store`546 + `playFiles`290 + `memory`350 | 改造 | 700–1,000 |
| | 剧作家提示词 | `prompt` 524 | 正文原样搬 | 550–750 |
| | 搭台提示词 | `workshop` 574 | 正文原样搬 | 400–550 |
| | DSL 管线（tap → IR → SSE；日志重建） | — | 新写 | 400–600 |
| | 线性轮状态机 | `orchestrator` 2,394（只取演出部分） | 重写 | 400–600 |
| | 核心工具 | `agentkit` 2,617 | schema/描述原样搬 | 700–1,000 |
| | 资源与事件路由 | `http` 615 + `transport` 234 | 重写 | 350–500 |
| | 设置分区 | `config`+`configApi`+`settingsStore` ≈900 | 改造 | 400–550 |
| | 后台任务接 `ctx.jobs` | `pendingJobs` | 新写（薄） | 150–250 |
| | **小计** | | | **4,050–5,800** |
| **B 舞台视图** | `@aivn/stage` 抽取（裁掉路线树/回顾/CG 台账/队列面板/五视图外壳/导演栏/导航侧边栏 + transport 缝） | `stage` 6,567 + `StageScreen` 750 | 改造 | 1,700–2,400 |
| | VN 视图接线（tab / SSE 消费 / 输入 / 模式浮层 / 骨架占位） | `generatedAssets` 68 + 部分 `StageModes` | 新写 | 250–400 |
| | 设置分区 UI | `SettingsScreen` 759 | 改造 | 300–400 |
| | **小计** | | | **2,250–3,200** |
| **C 生成与语音** | 生图后端（只做 `gemini` 与 `openai` 两种形状；`modelslab` 那一套两步垫图与 1024 上限是特定部署的怪癖，不做） | ≈600 | 原样搬 | 600–900 |
| | 素材落盘 / 抠底 / 立绘声明 | `playAssets` 1,022 + `cutout` 534 | 原样搬 | 1,300–1,800 |
| | BGM 生成 | `playMusic` 180 | 原样搬 | 250–400 |
| | 看图 + 联网检索 | `webImage` 187 + `searchTool` | 原样搬 | 250–400 |
| | TTS + 分句预取 | `tts`+`chunker` ≈600 | 原样搬 | 500–700 |
| | 音色库（Fish 窗口） | `voiceCatalog` 421 | 原样搬 | 350–500 |
| | 生成类工具接装 | 部分 `agentkit` | 改造 | 700–1,000 |
| | **小计** | | | **3,950–5,700** |
| **D 打包** | 预设声明 / 构建脚本 / README / 市场材料 | — | 新写 | 300–500 |
| | **合计** | | | **10,550–15,200** |

生成类工具本身确实只是「几个工具壳」（每个 100–200 行：schema + 描述 + 落盘 + 广播），体量在后面那一层——生图后端、抠底、素材清单与立绘声明，这部分是搬运，风险低但行数实在。

### 可选的减重

| 减什么 | 省 | 代价 |
|---|---|---|
| C 层后置（先手工放素材，只跑剧作家预设） | −3,950–5,700 | 阶段 1 结束就能演，落点 **7,000–10,000** |
| VN 视图先不做打字机，只做「当前一拍 + 选项」 | −500–700 | 演出体感损失最大的一块 |

**这次裁减实际省下的是约 3,000–4,000 行**（谱系 2,000–3,000、路线树/CG 台账/队列面板约 1,100、工坊线程与压缩约 700），并且把风险最高的一段整段去掉了。剩下的地板由「舞台渲染层搬运 + 剧目/提示词/素材管线」决定，压不到更低。

---

## 六、风险与未决

### 已识别的风险

| 风险 | 说明 | 对策 |
|---|---|---|
| 客户端 bundle 体积 | 舞台渲染层要进 `lib/client.js` | 阶段 0/1 量体积；按需引入，去掉 AIVN 的整站依赖 |
| jobs 完成通知进对话 | DSH 会把任务结算通知给模型，AIVN 的 queued 出图是静默到货 | 阶段 2 实测；必要时给 `generate_image` 用不结算成通知的通道，或接受这条通知 |
| 从会话日志重建的完整性 | 依赖 DSL 确定性重放；assistant 消息里若含非 DSL 内容需要容错 | 阶段 1 写一条「重开页面 = 重放」的验收用例 |
| 抽取 `@aivn/stage` 会动到 AIVN 主线 | `apps/web` 有 45 个活跃 worktree | 单独 worktree；插件仓库依赖已发布版本 |
| 本机 8GB 内存 | 引擎并入 DSH 进程会抬内存 | sharp 按需加载；跑一轮实测 RSS |
| 插件依赖未声明 → DSH 起不来 | `dev-dsh-plugin` 记的老坑 | 依赖写进 `package.json` 并本地 `npm install`；先在单独端口验证 |
| 换模型的 NSFW 通道 | 原方案靠切模型，本轮未定去留 | 见未决第 3 条 |

### 已定项

| 项 | 决定 |
|---|---|
| 范围 | A+B+C 一次做全 |
| 绑定口径 | 会话工作区 = 剧目 |
| 分支 / 路线树 / 回顾 | 不做 |
| 舞台的导演工作栏与导航侧边栏 | 不做 |
| 工坊素材管理界面 | 不做（生成与引用照旧有工具） |
| pending panel | 复用 DSH 原生后台任务（`ctx.jobs` + `dsh-client-ui-jobs`） |
| 生图后端 | 只做 `gemini` 与 `openai` 两种协议形状 |

### 代码落点

| 仓库 | 分支 / worktree | 内容 |
|---|---|---|
| `stage-ai`（已有） | `.worktrees/dsh-vn-stage`，分支 `feat/dsh-vn-stage` | 抽 `packages/stage`（`@aivn/stage`），`apps/web` 改成消费它并跑通不回归 |
| `dsh-aivn`（新建） | `/root/projects/dsh-aivn` | DSH 插件本体：宿主半边 + 客户端半边 + 两个预设 |

插件构建时用 esbuild 把 `@aivn/core` 与 `@aivn/stage` 一并打进 `lib/index.js` / `lib/client.js`，**运行期不依赖 stage-ai 的任何路径**——这样 DSH profile 的 `link:` 只指向 `/root/projects/dsh-aivn` 这个长期存在的目录，worktree 来去不会把 DSH 拖垮。

### 仍待实测确认

1. **NSFW 通道**要不要保（换模型需要 DSH 侧的会话级模型覆盖能力，阶段 2 第一个验证点）。
2. **Chat tab 里的原始 DSL**：阶段 1 先接受，后续再决定要不要注册 `conversation.chat.node` 渲染器把它折成可读行。
