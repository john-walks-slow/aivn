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

**代码在另一个仓库**：`/root/projects/dsh-aivn`（分支 `master`，本次提交 `ce954b3`，前置 `8b9df9c`）。
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

### 阶段 2 · 上下文注入 + 语音生成（2026-10-05 用户重新定范围）

> 用户原话：「上下文的注入和组装肯定要有啊」「语音生成是基础中的基础是必须要有的」。
> 其余独立版能力（生图、抠底、资源库导入、回顾/路线树/存档、改写分岔重演、润色、
> 设置页、工坊界面）本阶段**不做**；将来若要，按外挂形态的独立插件做。

#### 2a 上下文注入与组装 ✅（2026-10-05 完成，`dsh-aivn` 76a190a）

阶段 1 把「引擎每轮替你注入」的内容一律改写成「去哪儿读文件」，这不是终态，是当时没有注入点的权宜。
DSH 提供了正规的注入点（`@deepseek-ai/dsh-system-prompt`）：

- `ctx.systemPrompt.section({ name, order, text: (assemblyCtx) => string })` —— **动态系统提示段**，
  每次组装时求值。AIVN 的「A 区」（前提、角色表、素材清单、写作参数、记忆索引）走这里。
- `ctx.systemPrompt.context({ name, order, text })` —— **物化成 user 角色快照的动态上下文**，
  正是 AIVN 每轮那条 `【状态】` 区（场景 / 剧情线 / 好感度 / 旗标）。
- 注册在 **agent scope**（`agent.ctx.effect(...)`，与 `preset-tools` 同址）：只有剧作家的会话吃这套注入。

段落与顺序（对齐 `apps/server/src/prompt.ts` 的 A 区拼装顺序）：

| 段 | 内容 | 来源 |
|---|---|---|
| `aivn:play-premise` | 世界观前提 | `memory/always/premise.md` |
| `aivn:play-cast` | 角色表（卡全文 + 音色 + 立绘差分；只有立绘没有卡的主体单列） | `characters/*.md` + `assets/sprites/*` |
| `aivn:play-assets` | 背景 / BGM / SFX / 插图清单（带 `manifest.json` 描述）+ 配乐编排规则 | `assets/` + `assets/manifest.json` |
| `aivn:play-craft` | 写作参数 + 创作口径散文 | `play.json` 的 `craft` + `memory/always/craft.md` |
| `aivn:play-language` | 剧本语言 | `play.json` 的 `scriptLanguage` |
| `aivn:play-memory-index` | 记忆索引（每条一行：`[分类] 名称（路径）：摘要`） | `memory/index/**` |
| `context: aivn:state` | 状态区（场景 / 剧情线 / 好感度 / 旗标） | `memory/always/state/*` |

刷新时机：**轮边界**（`agent/status → running`）重读一次并缓存，段求值时用缓存——AIVN 的
「A 区在纪元内冻结」就是这个语义，一个 turn 里多个 step 不该读到半截文件。

提示词正文同步改回来：`WHERE_THE_PLAY_IS` 那一段「这些不在这份提示词里，得你自己去读」删掉，
换成「下面这些是引擎每轮注入的，直接用」；保留「缺什么看 `get_readiness`」与写文件那部分。

角色表分级（AIVN 的 activeCast：在场全卡、不在场只注一行）在插件里没有编排器给「在场」，
2a 先**全卡注入**（剧目角色通常个位数），等实测有 token 压力再加按最近出场推的分级。

#### 2b 语音生成（宿主半边）✅（2026-10-05 完成，`dsh-aivn` 1958794）

- `src/tts.ts` —— Fish Audio 客户端（多 Key 轮询、内容寻址缓存 `sha1(voiceId+text)`、
  写临时文件后 rename、代理）。从 `apps/server/src/tts.ts`（163 行）搬。
- `src/voice.ts` —— 语音预取管线：`PhraseChunker`（`@aivn/core` 已有）分句 → 并发（默认 2）
  → 门控（`enabled` 总开关 / `paused` 客户端背压）。从 `apps/server/src/voice.ts`（133 行）搬。
- 接进 `stage-tap` 的 say 流：`say_start` → `lineStart(seq, charId)`、文本增量 → `feedText`、
  `say_end` → `lineEnd()`。`seq` 用中枢分配的帧号（客户端就是按它关联当前行的）。
- 路由：`GET /aivn/audio?session=&seq=&phrase=`（回音频字节，带缓存）、
  `POST /aivn/voice { session, enabled?, paused? }`（总开关与背压）。
- 中枢新增一种帧：`{ kind: 'voice', lineSeq, phrase, state: 'started' | 'ready', url? }`。
- `voiceOf(charId)`：角色卡的音色字段（`voice` 是显示名、`voiceId` 是 Fish 音色 id），
  没有音色声明的角色（含旁白）不合成。
- 插件 `Config` 加语音段（keys / baseUrl / model / proxy），环境变量兜底；README 写进配置总表。

#### 2c 语音生成（客户端接线）✅（同上；`67730fb` 检视收口、`ba1fe17` 节奏收口）

`apps/web/src/stage/audio.ts` 的 `VoiceDirector`（436 行，纯 Web Audio、**零 import**）是又一个
「属于舞台层却留在 app 里」的模块（与这次补的 `.choice*` 样式同一类漏搬）：

- 移进 `@aivn/stage`（`packages/stage/src/audio.ts`）并 re-export；AIVN app 改为从包 import。
- 插件里：`new VoiceDirector()`，接 `usePlayback` 的 `onLineStart` / `onFastForward` /
  `hold: director.holdsLine()`；`voiceState(seq)` / `onReplay(seq)` / `onUnlock()`；
  `onControl → POST /aivn/voice`（背压）；`voiceAvailable={true}`、`voiceOn` 持久化到 localStorage。
- 未解锁时舞台上的「点击开始」手势遮罩由 `onUnlock` 驱动（移动端 AudioContext 铁律）。

#### 验收

- 注入 ✅：`e2e/verify-injection.mjs` 从**会话日志**（`system/message` 事件记了完整系统提示词）
  断言各段在场、带的是 `premise.md` / 角色卡的正文与 `assets/` 里真实的素材 id、
  且阶段 1 那句「得你自己去读」已消失——11/11。`verify-stage` 14/14 仍绿。
  **实测探路开销**：首轮 step 6.5 → 4、工具调用 ~14 → ~6，`glob` / `bash` 那圈探路消失。
- 语音 ✅（`e2e/verify-voice.mjs` **16/16**，真打 Fish Audio）：voice 帧到达、音频能取回且是
  真 MP3、**浏览器把 MP3 解成了 PCM 并真的有音源起播**（页面里给 `AudioContext` /
  `decodeAudioData` / `AudioBufferSourceNode.start` 挂钩子——只断言「帧到了、URL 能取回」
  说明不了出声，导演没解锁 / 解码失败 / 音频晚于该行结束这三种都不报错）、语音总开关确实
  传到了宿主（抓客户端真实请求体，V14/V15）。
- **语音节奏的结论**（检视 B3，`ba1fe17`）：舞台是**手动推进**的，没点之前播放头不落在任何
  一行上；一行成为当前行后会一直停着等玩家点，停够 2–5 秒（Fish 免费模型的实测合成时间）就
  听得到，点太快那一句按引擎本来的设计被丢弃。自动模式下额外把「这一行还在合成」也算作 hold
  （封顶 8 秒，TTS 挂掉时不会把演出卡死）。

#### 实现记录（2a）

- `src/play-context.ts` —— 快照读取 + 段注册。`systemPrompt.section()` 挂 A 区六段
  （语言 / 前提 / 角色表 / 素材 / 写作参数 / 记忆索引）与静态尾段；
  `systemPrompt.context()` 挂【状态】。注册在 agent scope，只有剧作家的会话吃。
- 提示词拆两段：`PLAYWRITER_PROMPT`（persona prefix）与 `PLAYWRITER_TAIL`（order 200 的段）。
  `persona` 那一格只装得下一段静态文本，A 区只能由插件插在中间。
- 读盘改同步：段 provider 的签名就是同步的，而读的是本机小文件。`assets.ts` 的
  `listAssets` / `readManifest` 与 `play.ts` 的 `loadPlaySync` 都改/加成同步，
  解析与报错与异步版共用一份——不为同步再抄一遍素材表口径。
- 角色表这一版**全卡注入**（AIVN 的在场/折叠分级没有编排器给「在场」，等有 token 压力再加）。
- 记忆索引按 AIVN 的 `parseCard` 口径解析（首个 `# 标题` 是名字、其后首个非空行是摘要），
  每行带路径。

### 阶段 3 · 发布

进行中（2026-10-05）。**不依赖用户决策的部分已经做完**：

- ✅ 双语 README：`README.md`（中文主体）+ `README.en.md`，顶部语言切换；两份结构核对一致
  （10 个 `##` / 6 个 `###` / 24 个代码块 / 58 行表格）。README 四件套齐：一行价值、可复制安装
  命令（`dsh plugin --profile web add dsh-aivn`，dsh-plugin.org 的收录硬要求）、舞台实拍图、
  「权限与兼容」声明。
- ✅ 发布元数据：双语 description、中英混排 keywords（含 `dsh-plugin`）、author / repository /
  homepage / bugs、`files` 与产物核对、`prepublishOnly`（重建 + 类型检查）、版本 0.1.0。
- ✅ 依赖面：`@aivn/core` / `@aivn/stage` 移进 `devDependencies`（esbuild 已把它们打进 `lib/`，
  运行时不依赖，留在 `dependencies` 只会让消费者解析一条本机路径）。
- ✅ `screenshots/screenshot-1.png` + `screenshots.json`（市场详情页）。
- ✅ 隔离验证：`npm pack` → `dsh plugin --profile scratch-aivn add ./dsh-aivn-0.1.0.tgz` →
  `--dump-config` 出现该层 → profile 目录内 `import('dsh-aivn')` 得到 `apply/name/inject` ✓，
  验完删除 scratch profile。
- ✅ 发布前检查（`before-publish-repo` 阶段 A）：全历史扫描抓到本地施工单（绝对路径 + 私有仓库
  引用）与宿主环境叙述（本地服务配置路径、provider 名称、某个模型的地区限制）→ 施工单迁到本
  需求记录、其余改写成通用说法 → **历史重写**（21 个提交，含提交者身份统一）→ 复扫归零。
  `HEAD^{tree}` 前后一致：重写没有动任何一次提交的内容。
- ⏳ **等用户点头**：npm 发布（对外动作）与 GitHub 建仓公开。
- ⏳ 发布后：仓库打 topic `dsh-plugin`（自动市场靠它收录）、隔天提 awesome PR
  （`data/plugins/john-walks-slow__dsh-aivn.yml`，描述会被对着代码核）。

线上 profile 保持 `link:` 本地目录；发布验证走 scratch profile。

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
