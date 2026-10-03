# 路线视图第二轮（走原路 + 三动词）小结

## 改了什么

**返回旧轮走原路（本轮的核心）**

- `playerAction` 在生成之前先查树：挂载点停在 `beat_end`（轮中锚定不认）、本次动作的**来源标签**与某个子节点相同 → 不生成，`beatEndFrom` 取那一拍的末节点后 `rebaseAt(endId, "顺着原路继续", {mark:false, playFrom:"start"})`。**一拍拍接**：跨轮的停止点重新摆出来，玩家途中改选别的选项就地分岔。
- 来源标签（core 新增 `originOfBeat`）：`prompt` 节点是那次输入原话（选项就是「（选择了：X）」）；`fork` 节点继承被它顶掉那一拍的 `payload.origin`；其余是 `continue`。
- 候选必须**有内容**（`beatEndFrom` 解得出来）——空壳 fork 不参选。排队里压着待注入的引导时不认旧路。
- 同来源多条枝时按「最后去过」挑：`OrchestratorRuntimeState.prevLeafId`（随 `session.json` 落盘），只在 `jumpTo` / `forkTo` / `deleteBranch` 进入时写一次，`rebuildBranchAt` 里不写；读档时缺字段或指向已删节点一律当无偏好。

**三动词**

- 卡片只剩 **跳转 / 重写 / 删除**：「回到选项」按用户要求删掉；「从头重读」改名「跳转」；「重演本轮」改名「重写」并支持一句交代（走 `ui/Modal.tsx`，**可留空**）。
- 舞台导演栏的「重来」文案与 title 一并改「重写」，能力不变。指令的实际时序与舞台一致：**先分岔再排队**，那句话生效于重写之后的下一次开口（不是写进正在重写的那一轮）。
- 新增删除：协议 `delete_branch`，core `removeSubtree`（删自身与后代、清快照与改写旁注、**上溯清空壳 fork**、挂载点回落到第一个活着的祖先）；编排器 `deleteBranch` 幂等重建，`rebase` 消息带 `keepView` 让客户端**留在路线视图**。确认弹窗写明后果与量级（「将删除 N 轮 / M 个节点」）。

**看得清 + 能选中**

- `.route-edge` 加粗、`stroke-linecap: round`、废弃枝提亮、fork 支线换实描边；端点圆点从卡片中心挪到连线的子节点端。
- 点卡片即选中：同一次子树遍历标出**来路**（`.kin`）与**删掉会没掉的范围**（`.doomed`）；选中卡提 `z-index` 并恢复不透明（废弃枝上的卡本来半透明，不提起来「点了有反应」会被那层灰吃掉）；点画布空白取消，`Esc` 走 `ui/escape.ts` 的栈——选中时它占住栈顶，这一下只清选中，不会顺带把路线视图也关掉。

## 为什么

原来 `playerAction` 从不回头看树：动作一到就 `deliverPrompts → beginBeat`，**总是新生成一拍**。于是「回到旧轮重选同一个选项」得到的不是接着读，而是凭空多长一条枝、剧情被重写一遍。玩家要的是「除非选了不同选项，否则走同样的剧情」。

顺带被这轮暴露出来的两个交叉 bug：① 删除只删卡片节点会留下带来源标签的空壳 fork，下次复用正好命中它 → `removeSubtree` 上溯清理 + 候选要求有内容；② 重写出来的枝若不带 `origin`，玩家回到同一锚点重选同选项时认不出它 → `forkTo` 从被顶掉那一拍继承来源。

## 验证

- `packages/core`：145 例通过（新增 `originOfBeat` / `childrenOf` / `beatEndFrom` / 剪枝三组）。
- `apps/server`：`orchestrator` 65 例（新增旧路复用 6、重写继承来源 3、删除 3）、`history` + `lineage-ops` 31 例。
- `apps/web`：新增 `test/routeVerbs.test.tsx` 8 例；`src/stage/*` 与 `test/*` 共 137 通过（`settingsPaneCards` 3 例、`agentModelOptions` 2 例为既有环境相关失败，与本轮无关）。
- `npx tsc --noEmit`：`apps/web`、`apps/server` 均干净。
- 端到端（`e2e-tester`）：功能类 7 项全通过——含命门那条「真模型演到第二轮末尾 → 跳转回第一轮 → 重选同一选项：零模型调用、`session.json` 事件数 33 不变、`leafId` 一致，toast 报「顺着原路继续」，改选另一选项才增长到 48、旧枝转 dead」；体验类另发现 Esc 一次连关两层，已改用 `useEscape` 并窄复验 3/3 通过。详见 `e2e-report.md`；用户验收清单见 `261004-route-revisit-and-verbs.validation.md`。

## 已知边界

- `lineage.jsonl` 是只增不改的审计流，读档只读 `session.json`——删除因此是持久的；**将来若改成从 `lineage.jsonl` 重建，已删内容会复活**。
- 「回到选项」（秒到选项）被删掉，换来三动词的极简；代价是要回到某一段末尾只能从头重读一遍。它成立的前提是「同选项走原路」已经修好。
