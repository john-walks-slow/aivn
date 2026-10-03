# 路线视图跳转/分岔与阅读位置 小结

## 改了什么

**协议（`packages/core`）**

- `ReadPos` 从「事件序号」换成 `{ nodeId, offset, seq?, len? }`——**主键是稳定 nodeId**，`seq`/`len` 只留给老档；
- `rebase` 消息增 `playFrom?: "start" | "end"` 与 `resumeAt?: ReadPos`；`jump` 带 `playFrom`；`read` 带 nodeId + offset；
- `say_start`/`narrate_start`/`thought_start` 增可选 `nodeId`；`lineageToEvents` 重放时把节点 id 发出去；
- `LineageTree.append` 收 `opts.id`——服务端为缺 id 的台词先生成 nodeId，谱系节点与事件用同一个 id。

**服务端（`apps/server`）**

- `jumpTo(nodeId, { playFrom })` → `rebaseAt`：`start` 把播放头放回本轮第一句，`end` 放到目标节点，**都不生成一个字**；
- 删掉「停在 `beat_end` 上却合成 `pause` 停止点」那条误触发的路径（它现在只在真的停在轮中时出现）；
- 阅读位置去重按 nodeId + offset 比较，不再拿 seq 认同一行。

**前端（`apps/web`）**

- `beats.ts` 重写：`BeatCard` 带 `startNodeId` / `endNodeId` / `forkFromId`，`buildBeats` 沿真实树拓扑（`childrenOf` 父表 + `traceBeat`）切轮，线性扫描与 `atFork` 启发式整段删除；
- `director.ts`：`resolveResumeSeek` 是「刷新后回到哪一个字」的唯一解算点；`usePlayback` 按它 seek 而不是快进到末尾；
- `StageScreen.tsx`：阅读位置上报行首立即、行内 1s 节流，`beforeunload`/`pagehide`/卸载各 flush 一次；
- `RouteCanvas.tsx`：卡片右下角三个带字样动词——「回到选项」/「从头重读」/「重演本轮」，分别落 `endNodeId`（end）、`endNodeId`（start）、`forkFromId`（resume）。

## 为什么

原实现把三件互不相干的事绑在同一个锚点上：

1. **卡片 id = 该轮第一个事件**，于是「回到这里」跳的是轮首 → 世界线被截在整轮中间 → `restoreStopPoint` 走兜底分支合成 `pause` → 客户端一按「继续」就叫剧作家，新内容 append 到当时的叶子；
2. **`buildBeats` 按 `createdAt` 线性扫 + `node.parentId !== prevInChain` 猜分岔**，而分岔恰恰是「父节点是历史里某个非当前节点」——猜不中时兜底挂到当前轮，卡片于是落到旧叶子；
3. **阅读位置以 seq 为键**，而 seq 每次 rebase/重生成都重新分配，刷新后要么映射失败（进度丢失）要么粗暴快进到末尾。

现在三者解耦：**世界线锚点**（leafId）只由 jump/fork 改；**播放头**（readPos = nodeId + offset）由播放层推进并上报；**回看游标**只读，不落任何持久状态。

## 验证

- `packages/core`：131 例通过（9 文件）。
- `apps/server`：`orchestrator` 47（含本次新增 3 例）、`history` 10、`lineage-ops` 21，共 78 通过。
- `apps/web`：`beats` 14、`routeTree` 6、`resumeSeek` 11（含本次新增 5 例）、其余 `src/stage/*` 与 `test/*` 共 115 通过。
- `npx tsc --noEmit`：`apps/web`、`apps/server` 均干净。
- 真机/浏览器：dev 实例（vite + server，端口经 acquire-port 动态分配）上开路线视图，7 张卡片、每张右下角三个带字样动词、张张有台词正文（**没有「无台词」空卡**），连线与排布正常。截图见 `route-three-verbs.png`。

## 已知限制

- **旧的谱系存档**里没有 `nodeId`（nodeId 是这次才落到事件上的），这类老档的阅读位置只能退回 seq 寻址——`resolveResumeSeek` 里保留了这条兼容分支，等老档自然淘汰后可以删。
- `apps/web/test/settingsPaneCards.test.tsx` 3 例失败（api mock 缺 `voiceCatalog`），在 `main` 的 `3ac575c` 上原样复现，与本次改动无关，未动。
