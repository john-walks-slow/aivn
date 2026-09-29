# 路线树收尾计划（路线画布 5 轮之后的遗留清理）

分支 `feat/lbranch`，已快进合入 main 一次（`909a9fb`）。本计划处理合入后自查出的遗留。

## 背景

路线画布共 5 轮改动已全部落地并合并：删横条、去 beat 计数、去主线支线标签、删活死之分、删叉回只留跳转与分岔、去检视栏改卡片自带工具栏。
其中「只读回看」架构（跳过去在客户端本地物化、不动世界线）被用户明确否决并整套删除，但删除不彻底，代码里还留着它的残骸。

## 待办

### A. 死代码（只读回看架构残留）

| # | 文件 | 处理 | 依据 |
|---|---|---|---|
| A1 | `packages/core/src/lineage/replay.ts:57-74` | 删 `chainToNodes` | 全仓 0 消费者，只为客户端本地拼任意分支链而写 |
| A2 | `packages/core/src/lineage/replay.ts:6-12` | 重写文件头注释 | 现注释仍写「客户端『跳过去看』…不发任何 WS、不动物理分支」，是被否决的架构 |
| A3 | `packages/core/src/lineage/replay.ts:206` | 修格式坏点 `{  return {` | 上轮字符串手术遗留 |
| A4 | `apps/web/src/stage/beats.ts:90` | `beatAnchors` 摘 `export` 改模块私有 | 无外部消费者（`buildBeats` 在同文件 `:80` 调用它，函数本身活着，只是不该对外暴露） |

保留不动：`toNodeView`（`model.ts` 用）、`lineageToEvents`（`apps/server/src/rebuild.ts` 用）、`stopFromNode`、`firstLineOf`（3 处调用）、`Icon` 的 `rewrite`（14 处用）、`StageTheater.onReplay`（是 VoiceDirector 重念台词，与谱系回看无关）。

### B. 文档一致性

| # | 位置 | 处理 |
|---|---|---|
| B1 | `AGENTS.md:11` | core 地图行写「五动词」，与目标段、规范段的「四动词」矛盾 → 改四 |

`AGENTS.md` 已无「检视栏」「点节点」等旧概念残留（已 grep 确认）。

## 不做（已确认无需处理）

- `editInPlace` 注释与行为一致性：注释已写明「其后的剧情整段转为废弃分支」，与实现相符，无需改。
- 路线视图分岔不传 `instruction`：`instruction` 在导演栏 `onRewrite={branch}` 上真实使用，不是死参数。
- `packages/core/src/lineage/replay.ts` 整个文件不删——`toNodeView` 是谱系投影的唯一实现。

## 验证

1. `pnpm --filter @stage-ai/core build`（A1 动了 core 导出面，必须重建 dist）
2. `pnpm --filter @stage-ai/core exec vitest run`
3. `pnpm --filter @stage-ai/web exec tsc --noEmit`
4. `pnpm --filter @stage-ai/web exec vitest run`
5. `pnpm --filter @stage-ai/server exec vitest run`

步骤 5 若 `image.test.ts` 偶发失败**不追、不误判为本次改坏**——其根因（`setTimeout(10)` 短于 manifest debounce 落盘）早已在 `cfde0c2` 修掉，两处都换成了 `await assets.flush()`，且该 commit 已在 main 里。见下方 Q2。

e2e 另案：本轮改的是无外部消费者的死代码导出、注释和一个格式坏点，无用户可见路径变化，`pnpm typecheck` 覆盖三个包已足够。**但路线画布前 5 轮的累积用户可见改动从未做过独立端到端验收**（历次只由开发者本人目视），故按 `/full-auto` 的规则把「用户验证」替换为 `e2e-tester` 子代理，单独跑一轮，报告落 `260930-route-canvas.e2e.md`。

历史文档（`260928-stage-ai-mvp.plan.md`、`validation-P6.md` 等）里仍留有「五动词」「检视栏」字样，**刻意保留原貌**——那是需求当时的真实记录，改它等于伪造历史，不得当成残留清理。

## 待定（交 auto_human 裁决）

- **Q1**：路线视图的分岔目前是无指令分岔，「导演意图」输入框在检视栏被一并删了。是否需要把带指令的分岔放回路线视图？
- **Q2**：范围是否扩到 `apps/server/test/image.test.ts` 的并发 flake（已知修法：`await assets.flush()` 替掉 `setTimeout(10)`）？它与路线树无关，是另一条记录在案的遗留。

## 裁决（auto-human，2026-09-30）

- **Q1 不放回**：常驻输入框等于把刚拆掉的检视栏以更重的形式请回来，21 张卡的树上全是输入框比检视栏更糟。带意图的分岔在导演栏已可发起。路线视图定位是结构操作，意图是创作输入，别混。真要加也该是点分岔后弹一次性 popover，但现无此需求，不预支。
- **Q2 不扩范围**：混入生图测试修复会让 commit 不好回溯，且它 flake 时容易被误判为本次改坏。
- 另裁定：历史 P6 文档保留原貌，并显式声明理由。

**Q2 事后更正（2026-09-30，收尾时查证）**：Q2 这个待办本身是**记错了**。`image.test.ts` 的 manifest 等待早已在 `cfde0c2`「test(image): manifest 等待改用 flush() 而非猜时长」里改成 `await assets.flush()`，该 commit 已在 main 中；文件里现存的 `setTimeout` 只剩两处且都合理——`fakeGen(delayMs)` 的可选时延、以及并发闸门用例里假生图器持有的 20ms（不放慢就量不到 peak）。即**没有可复现的 flake，也就没有要修的**。教训：遗留项要带 commit 依据，否则会像这样被一代代传下去。

## 收尾（full-auto，2026-09-30）

- **卡死修复单独一笔 `048cbd4`**：刷新到一个已收束的现场时四动词按钮全部禁用，根因是 `useStageSocket` 的 hello 分支同步读了渲染期才赋值的 `stateRef`，解锁条件永不成立。按 `hello.idle` 一次落定，不动演出中的状态迁移。
- **端到端验收**：`260930-route-canvas.e2e.md`，功能 5 通过 / 0 不通过 / 1 受阻（真实分岔烧外部 API，按测试纪律不跑），体验 3 项观察无关键问题，另附收尾复验 4 项。
- **已知限制（显式记录，本轮不修）**：挂载点落在第 0 拍内时刷新，客户端进 `stopped` 却收不到停止点载荷（`stoppedReplay` 的 `beatNo === 0` 守卫把「还没开演」误判成「第 0 拍」，既有缺陷，源自 P1 `7da9227`）。此时**四动词仍可用**，但没有停止点面板；若丢的是 `choice`，那个选择点会被跳过。见 `docs/issues/260930-refresh-loses-stop/`。
- **路线画布改动最终形态**：一张卡 = 谱系一个节点，卡下自带「跳到这里」/「分岔」，无检视栏、卡面不可点，`NODE_BLOCK_H` 是布局唯一真相源。
