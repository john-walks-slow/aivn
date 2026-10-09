# 回到旧轮走原路：继续按钮的复用闸门太窄 修复记录

**状态：已修复、已自测、已检视（准入）；等用户实机确认后并回主分支。**
worktree `fix/revisit-old-path`，基线 `0da3c2aa`，提交 `ef7902bd`（修复）+ `b31959d6`（检视 S-01 + 文档）。

## 背景

用户报告：退回过去的节点/轮之后按「继续」，本该沿旧路走下去，实际又生成出一条新枝。

> 跳转到过去的节点，然后继续到那个 beat 结尾，就会变成再点一下又生成出新的分支。
> 预期是除非选了不同选项，应该继续走过去的分支的啊。

澄清后确认两个入口都会复现：点路线图「开端」卡的跳转再按继续；以及**不跳开端**、一路点继续走到某轮末尾再点继续
（且与「插一句」无关）。

## 根因

「回到旧轮走原路」只有一处实现 `orchestrator.revisitOldPath()`，它有三道过窄的闸门：

1. 挂载点必须是 `beat_end` —— 起点（`root`）与轮中锚点都被拒；
2. 「继续」也被当成需要逐字匹配的输入 —— 旧路下一拍以插一句 / 选项开头时认不出；
3. `LineageTree.beatEndFrom` 见岔口原地刹车 —— 落点停在拍中间，下一次按继续又撞上第 1 条。

三者都会落到「生成新的一拍」，玩家看到的就是「再点一下又分叉」。

## 修复

- `packages/core/src/lineage/model.ts`：`beatEndFrom(headId, prefer?)` 见岔口顺着这条世界线走
  （`prefer` = 上次结构操作前世界线所在的节点，落在谁子树里就走谁；否则优先 `beat_end` 孩子；
  再否则最早落笔的非 fork 孩子）。走到 `beat_end` 才算完；空壳 fork 仍返回 `null`。
  岔口的偏好一次算成祖先集合（`pathSet`），判定是查表。
- `apps/server/src/orchestrator.ts`：`revisitOldPath` 的锚点认轮边界（`beat_end` 或 `root`）；
  来源标签只对带输入的动作（选项 / 自由输入）逐字匹配，「继续」不再筛来源标签，
  多候选仍按 `lastVisited`（`prevLeafId` 偏好）挑；`prevLeafId` 作为 `prefer` 传进 `beatEndFrom`。
- `apps/server/AGENTS.md`：同步「回到旧轮走原路」与「重写的来源继承」两条模块约定。

轮中被锚定（jump 到某一句、轮内分叉的 pause 出口）仍然不认旧路——既有语义未动。

## 验证

- **用例**：`packages/core/test/lineage.test.ts`（39 条）、`apps/server/test/orchestrator.test.ts`（91 条，含新增 3 条：
  跳开端按继续、旧路下一拍以插一句开头、旧路在拍中岔过）与 `lineage-ops` / `history` 全绿；`pnpm typecheck` 通过。
  新增用例在修复前为红（复现），修复后转绿。
- **真实存档核算**：把 14 份存档（`plays/*/saves/*/session.json`）读进 core 的谱系树，逐拍复刻修复后的判据：
  修复前 3 份存档里共 5 处「按继续走不通」（`320000` 4 处插一句开头的下一拍、`testtest` 起点被拒、`test` 落点停在拍中），
  修复后**全部 0 处**。
- **检视**：reviewer 子代理结论 `准入`（无阻塞；1 条性能建议已改，见 `b31959d6`）。

## 未纳入本次修复

- 跳到「被轮中分叉切在半路」的卡片再按继续，仍然会就地新写一拍：轮中锚定不认旧路是既有语义，
  改它等于把「继续」重新定义成「把这一拍读完」，属产品语义变更，待用户单独确认。
- 跨宿主：本次动了共享包 `packages/core`，但兄弟仓 `dsh-aivn` 不调用 `beatEndFrom`（核对过 `src/**`），
  行为不受影响；它的 `lib/` 里那份 core 会在插件下次构建时自然更新。

## 相关文档

- 排查：`docs/issues/261010-revisit-old-path/261010-revisit-old-path.troubleshoot.md`
- 检视：`docs/issues/261010-revisit-old-path/261010-revisit-old-path.review.md`
- 用户验证：`docs/issues/261010-revisit-old-path/261010-revisit-old-path.validation.md`
