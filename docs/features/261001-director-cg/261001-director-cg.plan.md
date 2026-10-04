# 导演生图

需求：导演栏（舞台底下那排动词）加一个「生图」按钮，按**当前这一幕的剧情**生成 CG，
玩家可以附带一句指令；图落在**按下这一刻**在时间线上的位置，完成后出现在 CG 页。
排队面板里能看到这件事，完成后那一行再停一会儿才消失。

## 决定

### 提示词谁来写

客户端不写，服务端写一次。`playhouse.requestCg()` 收集「这条世界线上最近 12 句
说出口的话 + 当前场景 + 角色卡 + `memory/always/craft.md` + 玩家指令」，
交给**剧作家那个模型**做一次纯文本调用（`completeText`，与 `polish()` 同一套），
产出英文出图提示词。

- 客户端拿不到世界线，也拼不出「刚才演到哪儿」；提示词必须在有谱系的进程里合成。
- 用剧作家的模型而不是写死一个：出图 prompt 是**剧本语言**，同一剧目的画风锚点在
  `craft.md` 里，默认模型与该剧目脱节时最容易出戏。
- 一次调用、成本是一段短文本，比让玩家自己写提示词或让编排器多跑一轮便宜得多。

### 位置：现场 vs 回看

「图落在按下这一刻在时间线上的位置」有两种情况，落点不同：

- **世界线末尾**（没有回看）：`cg` 节点在**点下那一刻**就 append
  （`orchestrator.directorCg(id)`），提示词写好之后、发起生图之前。落点由
  `LineageTree.append` 取当时的 leaf 决定，与剧作家的 `preload_asset` 走同一条路——
  事后回填会让节点位置随剧情漂移。
- **回看中**（`scrubbed`，客户端带上 `anchorNodeId`）：图作为**行级旁注**挂在
  「你正看的那一行」上（`LineageTree.recordCg` / `orchestrator.attachCg`），
  **不入树、不动挂载点、不分叉**——与原地改写（`recordEdit`）同一套机制，
  客户端按 nodeId 认领，翻到那一行图就在画面上。

  提示词也要跟着锚点：`recentScript(12, anchorNodeId)` 取那一刻的链与那一刻的场景，
  否则「按此刻写词、把图挂回过去」对不上。链内插入这条路走不通——链上每个节点只有
  一个孩子，插在中间必须挪走它原来的下一个节点（挪成兄弟就是分叉，挪到图下面就是
  掰链改结构），所以回看这条走旁注。

写提示词失败就不落任何东西：不给时间线留一个等不到图的空节点。

### 图存哪

`assets/cg`（`PlayAssets`）。CG 页（`GET /api/plays/<id>/cg`）把 `assets/cg` 的静态素材
与站内生成图并排放、靠 `origin` 角标区分，导演生成的图在那里显示为「站内生成」，
生图用的 prompt 原文记在 `assets/generated.json`。

站点生成的图进 `assets/` 是 2026-10 定下的（`ImageAssets` 那层内容寻址缓存已删）：
出图只有 `PlayAssets` 一层，`assets/` 是剧目资产（`generated.json` 本来就进 git），
随手画的一张插图靠 `origin` 角标与真实素材区分。见 `docs/features/261001-cg-view/`。

### 排队面板的完成态

`PendingJob` 加必填 `state: "running" | "done"`。`PendingJobs` 的 `done()` 不再直接删行，
而是置成 `done` 并留 4 秒（`DONE_LINGER_MS`，构造参数可注入，测试里传 0）。

收尾即删的话那一行只能凭空蒸发——玩家看着「正在生成」闪一下就没了，
不知道是成功了还是根本没收到请求。留一会儿，这一行才有「它刚才完成了」这个意思。

### 生图按钮什么时候可点

`fresh`（空树、还没开演）时禁用，title 说明「还没有剧情可以入画」。
没有台词也没有指令时服务端也会拒（`requestCg` 的第二道守卫）——两道守卫都留着，
前端那层是为了不让玩家点出一个必然失败的按钮。

### 失败怎么报

不新增机制：沿用既有的 `{ type: "error", recoverable: true }` 帧（`dispatchSafe` 已在捕获），
以及 `asset_failed` 触发的骨架图移除。

## 改动

- `packages/core/src/ws/protocol.ts`：`PendingJob.state`；`ClientMessage` 新增
  `generate_cg`（`anchorNodeId` 可选）与 `ServerMessage` 的 `cg_attached`。
- `packages/core/src/lineage/model.ts`：`recordCg` / `LineageNodeView.cgs` /
  统一旁注表（改写与插图同流落盘，读回时分流）。
- `apps/server/src/pendingJobs.ts`：`done()` 改为完成态 + 定时清除（见上）。
- `apps/server/src/orchestrator.ts`：`directorCg(id)`、`recentScript(limit, from?)`、
  `attachCg(nodeId, id)`、`hasNode(nodeId)`。
- `apps/server/src/playhouse.ts`：`requestCg()` 的锚点分支 + 提示词合成。
- `apps/server/src/transport.ts`：`case "generate_cg"`（需要 `playhouse` 与 `playId`，故 `routeMessage` 签名跟着扩）。
- `apps/web/src/stage/director.ts`：`withAttachedCg`（行级插图覆盖）。
- `apps/web/src/stage/StageTheater.tsx`：导演栏「生图」按钮 + Modal 的一个分支（`action="cg"`）+
  回看时把「正看的那一行」带上。
- `apps/web/src/views/StageScreen.tsx`：把按钮接到 WS 的 `generate_cg`；`cgs` 汇成 `cgByNode`。
- `apps/web/src/stage/PromptQueuePanel.tsx`：完成态行；标题在「正在生成 / 刚刚完成」之间切。
- `apps/web/src/app.css`：完成态的那一行淡色。