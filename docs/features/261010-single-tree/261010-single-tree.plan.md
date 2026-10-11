# 单树模型：去掉周目用户层

日期：2026-10-10
状态：待用户对齐，暂不实施。

## 目标

把产品模型收敛为：

- 一个剧目一棵谱系树。
- 路线树是唯一的历史与分支入口。
- 「从头重开」是在根节点创建一条新的运行枝，不再进入周目页。
- 剧目设定、分支事实、引擎工作态、可检索历史各自有明确 scope。

本计划不把普通的“从旧点继续”改成重新生成。旧路径复用仍保留；只有用户明确执行“从头重开”时才绕过 `revisitOldPath`。

## 用户路径

### 第一次进入剧目

1. 标题页显示「开始」。
2. 进入舞台后创建根节点下的第一条运行枝。
3. 之后路线树显示开端、当前拍和已产生的分支。

### 已有历史

1. 标题页显示「继续」。
2. 继续当前活动路径，不弹出周目列表。
3. 从路线树选择旧拍，可回看或从该拍重写。

### 从头重开

1. 在舞台或路线树的根节点提供「从头重开」。
2. 引擎创建新的根分支/运行标记。
3. 新枝从 `play.initialState`、`play.initialScene` 和默认 NSFW/压缩状态开始。
4. 新枝不走普通 `revisitOldPath`，即使新运行的第一步输入与旧枝相同，也要按“新运行”语义处理。
5. 旧枝继续留在路线树中，可回看、重写或删除。

### 清理历史

1. 路线树保留现有的删除子树操作。
2. 删除整次重开运行时，用户选中根下对应运行枝，确认影响范围后删除。
3. 不新增一套独立“删周目”入口。

## 数据设计

### 保留

- `LineageTree`、`LineageSnapshot`、`LineageView`。
- `jump`、`fork`、`delete_branch`、行级 edit 等谱系原语。
- `LineageSnapshot.stateFiles`、`compaction`、`nsfw` 的分支状态设计。
- `memory/archive` 的当前路径检索过滤。

### 删除或收敛

- `saves/<saveId>/`、`active.json`、`SaveMeta`、`PlaySaves`。
- `PlayStore` 的 saveId 作用域，恢复为每个剧目一份 session/lineage 存储。
- `PlayHouse` 的 `ensureSave`、`createSave`、`switchSave`、`deleteSave` 及由此产生的 runtime 切换状态。
- `SavesView`、周目页路由、标题页的周目分支、侧栏周目切换入口。
- `hello.saveId`、`saveName` 以及前端换档同步逻辑。
- 工坊面向 `saves/` 的只读说明，改为读取单棵剧目谱系。
- readiness 中的 saves 计数，改为“是否已有演出历史”的单一布尔语义。

`packages/core` 与 WS 类型有共享消费者。删除可选的 `hello.saveId` 前必须按 `docs/references/261009-cross-host-verification.md` 完成独立版和 DSH 的构建/契约检查。

### 新运行原语

不要把“根节点普通继续”改成特殊旁路。新增一个明确的内部语义，例如 `new_run` 或 `restart_from_root`，满足：

- 目标只能是根节点或运行边界。
- 绕过 `revisitOldPath`。
- 从 `play.initialState` / `play.initialScene` 开始。
- 清空旧枝的 `prevLeafId` 偏好，不让旧枝选择影响新运行。
- 仍使用同一套谱系事件、快照、重放、archive 过滤和路线树投影。
- 新运行创建后，后续普通 `continue` 仍可复用这条新枝已有的下一拍。

先在 `packages/core` 协议/模型、`apps/server/src/orchestrator.ts`、`apps/server/src/playhouse.ts` 和前端路线操作中定义契约，再移除 saves 层，避免先删存档后补不清楚的重开语义。

## 记忆 scope 契约

### 剧目级

继续保留：

- `memory/always/premise.md`：作者设定。
- `memory/always/craft.md`：文风、禁忌、称呼、视角等创作口径。
- `memory/index/**`：作者正典卡。

需要把提示词和写面规则收紧：`memory/index/**` 只能记录跨路线稳定的作者设定，不记录“某条剧情路线刚刚发生的事实”。剧情事实进入谱系快照、压缩投影和当前路径 archive。

### 路线/运行级

- `LineageSnapshot.stateFiles`：分支状态真相源。
- `LineageSnapshot.compaction`：该路径的上下文压缩记录。
- `memory/archive`：当前谱系节点的历史切片，仅由 `search_archive` 按当前路径和 NSFW 规则召回。

### state 工作文件

`memory/always/state/*` 不是普通记忆卡。应选择一个明确方案：

1. 通用 `write`/`edit` 不可写，只有引擎的状态更新路径和快照回写可以改；或
2. 继续允许人工编辑，但界面和提示词明确它是当前工作态，且写入必须进入快照/重建流程，不能被下一次切换静默覆盖。

倾向方案 1。实现前先确认当前状态更新是否完全走引擎路径，避免挡掉合法能力。

### archive 回收

保留 append-only 写入作为运行时路径，但增加物理清理：

- 加载树后识别仍存在的节点 id。
- 删除分支后，丢弃 `entryId` 已不在树中的 archive 切片。
- 以临时文件 + rename 重写 archive，避免写到一半损坏。
- MiniSearch 只索引仍存在的切片。

这项与是否删除周目都有关，单树后更容易定义，但不能因为删掉周目就跳过。

## 实施顺序

### Phase 1：先修独立 bug 和 scope 边界

1. `deleteSave` 等待 runtime idle、阻止删除后的异步持久化复活目录；即使最终删除 saves，也先修当前行为或在删除重构中覆盖它。
2. 收紧 `memory/always/state/*` 的通用写面。
3. 为 archive 增加死节点物理回收和原子重写。
4. 增加测试：切换/重建时 state 不串、删除/剪枝后 archive 不再被索引、删除期间不会复活存档。

### Phase 2：落地新运行原语

1. 写 core/WS 契约和 server 侧状态初始化规则。
2. 增加“根节点新运行”服务端测试：相同输入不复用旧枝；状态从初始值开始；旧枝仍可回看。
3. 增加路线树操作测试：根节点入口、确认范围、当前路径切换和空树。
4. 增加 Agent 只读谱系说明，确保它理解“新运行”与“旧枝重写”的差异。

### Phase 3：移除周目用户层和存档层

1. 先迁移 `PlayStore`、`PlayHouse`、HTTP/WS 到单树作用域。
2. 再移除 `SavesView`、标题页周目分支、StageShell 周目入口和 readiness saves 字段。
3. 更新工坊文件面、README、CHANGELOG 和相关测试。
4. 清理 `saves/`、`active.json`、周目专用类型和死 API。
5. 按跨宿主矩阵重建共享包并验证 DSH。

### Phase 4：长树体验

根据真实使用再决定是否加入：

- 根下运行枝的折叠/展开。
- 只看当前运行的路线过滤。
- 长树虚拟化和按子树删除。
- 路线树规模/归档统计。

不在第一阶段为了假设中的规模问题重做布局。

## 验证范围

实现时只跑受影响的验证：

- core：lineage、WS 协议、新运行原语。
- server：store、orchestrator、memory、playhouse、HTTP/Agent contract。
- web：title entry、route controls、stage fresh、route tree。
- shared package：`pnpm -r build`，并按跨宿主矩阵重建 DSH `lib/`、运行 `node build.mjs --check` 和离线相关套件。

不跑真实 LLM、TTS、生图；使用假流和转写覆盖状态重建与分支行为。

## 需要产品确认的事项

1. 是否不需要同一剧目下保留多份独立、可分别删除的运行历史？当前实现不能并行运行，只能顺序切换。
2. 「从头重开」是否必须强制重新生成，即使开场输入与旧枝相同？本计划按“必须新运行、不得复用”处理。
3. `memory/index/**` 是否正式定为作者正典，不允许剧作家把路线剧情事实写进去？本计划按“是”处理。

在这三点没有对齐前，不实施 saves 层删除。