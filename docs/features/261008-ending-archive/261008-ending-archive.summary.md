# `<ending>` 退化为纯归档标签 实施小结

日期：2026-10-08 ｜ 仓库：`stage-ai` ｜ 分支：`task/16`

## 需求

产品口径重新对齐：**`<ending/>` 退化为纯归档标签**——末行一写就是「这个故事到此为止」的账目，
**不再自带任何画面**。终幕画面由剧作家用现成的 `<scene>` / `<title>` / `<narrate>` 自己搭
（每部戏想要的终幕本来就不一样）。引擎侧只剩三件事：落账、拒绝继续、别让「点舞台继续」冒出来。

`<epilogue>` 标签与整个「收束轮次」一并删除，收束散文改成 `<ending>` 自己的属性 `summary`，
**只用于归档，不上屏**。

本任务只负责 stage-ai 这一半（`packages/core` 语法/IR + `packages/stage` 渲染）；dsh-aivn 侧的跟进
是另一个任务，以前置依赖本任务。

设计与检视见同目录 `261008-ending-archive.plan.md` / `261008-ending-archive.review.md`。

## 做了什么

| 层 | 文件 | 变更 |
|---|---|---|
| core | `dsl/spec.ts` | `EndingAttrs`：`title` → `name`、新增 `summary?`、保留 `id`（必填）/`subtitle?`，字段语义写进注释（**四个字段全部只用于归档，一条都不上屏**）；删 `EPILOGUE_TAG`；`DSL_TAGS` 去 `"epilogue"`、`LEGACY_TAGS` 收它；`ENDING_TAG` 注释重写（取代那一轮的 `<stop>`、**不产生任何画面**、终幕画面自搭）；文件头把「属性值含 `>` 会截断」的已知限制换成引号感知定界 + 单引号出口的口径 |
| core | `dsl/events.ts` | 删 `epilogue_start` / `epilogue_text` / `epilogue_end`；`ending` 事件携带更新后的 `EndingAttrs` |
| core | `dsl/parser.ts` | 删 epilogue 包裹标签处理（`OpenWrap.tag`、`emitText`、`closeWrap` 分支）；`ending` case 改读 `name`/`subtitle`/`summary` 并对旧字段 `title=` 挂改名告警；**新增 `findTagEnd()` 引号感知定界**（取代 `indexOf(">")`）；新增 `legacyWrap` 状态吞掉作废包裹标签的正文 |
| core | `test/parser.golden.test.ts` | 删「收束散文」整块；ending 用例扩到四字段；新增「属性值里的 `<` 与 `>`」8 条 + 「改名与旧标签降级」3 条 |
| stage | `src/EndingCard.tsx` | **删除** |
| stage | `src/index.ts` | 去掉 `EndingCard` / `EndingCardData` 导出 |
| stage | `src/stage.css` | 删 `.ending-*` 全部 7 条规则（58 行） |
| stage | `src/script.ts` | 去掉三个 epilogue case；`ending` 注释改为「纯归档标签，不产生画面」 |
| stage | `src/StageTheater.tsx` | `ended` 入参注释不再指向已删的结局卡（检视 A1/N3） |
| web | `test/endingCard.test.tsx` | **删除**（AIVN 本体从没接过 `EndingCard`，全仓 grep 确认无其他引用点） |

`playbackState.ts` 的 `ended` 闸与 `StageTheater` 的 `ended` 入参**保留**——那是「终局态不给出口」，
与新口径一致。

### 两个技术要点

**1. 引号感知定界（本次的关键修复）**

`consumeOpenTag` 原来用 `buffer.indexOf(">")` 定界，不感知引号。字数小的时候无感，把几百字的收束散文
放进属性后就开始咬人——属性值里一个 `>` 就让标签头提前截断，**整条标签被丢弃**。对 `<ending>` 而言这是
最糟的失败形态：结局没了 → 终局态丢失 → 账本不记账 → 那一轮没有停止点，于是舞台摆出「继续」，
**游戏静默地走过了结局**。

改成从 `<tag` 之后找第一个**不在引号内**的 `>`（`findTagEnd`），不引入新的转义语法。流式正确性：
引号未闭合时返回「等待更多数据」而不是提前消费。顺带收益是 `generate_image` 的生图 prompt 这类
自由文本字段（旧限制的注释里点名了它）。

**2. 作废包裹标签的吞噬语义**

`epilogue` 从白名单移除后，若只当作「不在白名单」就会走未知标签分支——那条分支的口径是「按字面文本
输出」。实测：**独立出现**时正文落成 `orphan_text` 被丢弃（但告警说不明白）；**写在包裹标签里**时正文会
**漏进外层台词被念出来**。所以 `epilogue` 进 `LEGACY_TAGS`；又因为它是包裹型的，单元级的「整条丢弃」
管不住正文，另加 `legacyWrap` 状态把正文吞到它自己的闭合标签（或本条消息结束），与 `<comment>` 同一条
口径；期间其它标签一律不开工，免得摆出空台词行。

## 验证

- `pnpm -r typecheck` **全绿**。
- 单测：core **241** 全绿（改前 236，+5）；stage 53 全绿；apps/web 除 `useWorkshopTurn.test.tsx` /
  `useWorkshopNewThread.test.tsx` 共 5 条外全绿——**那 5 条已在主干 `2f70dee1` 复现，是既有失败，
  与本次无关**。
- 逐字撕裂喂入的探针：独立/嵌套/含游离标签的旧 `<epilogue>` 全部只剩一条 `legacy_tag`、零台词泄漏；
  `title=` 告警到位；`<ending name summary="a > b">` 正常；`<scene bg="a>b">`、`<say>` 文本里的撇号、
  `<comment>` 吞噬、未知标签字面输出行为不变。
- 检视：`reviewer` 子代理，结论 **条件准入**（无阻塞，4 项建议 + 3 项非阻塞）。四项建议**全部处理**，
  复审结论 **准入**——详见 `261008-ending-archive.review.md` 的作者回应一节。
- 全仓 grep 已无 `epilogue` / `EndingCard` 活引用（`docs/features/261007-dsl-endings/` 历史记录除外；
  `packages/core` 的 `LEGACY_TAGS` 与相关注释是有意留下的旧标签入口）。
- **`packages/core` 与 `packages/stage` 的 `dist/` 已重建**（`dist/` 不进 git，但 dsh-aivn 吃的是它）。

## 遗留 / 交接到 dsh-aivn 任务

本任务**不改 dsh-aivn**，以下由那边跟进（以前置依赖本任务）：

1. **`title=` → `name=`**：dsh-aivn 的提示词与存量剧本里的 `<ending title=…>` 须一并改。
   parser 已挂改名告警走回喂自修正通道，但不改就一直是空 `name`。
2. **`<epilogue>` 的收束轮次整条删除**：`src/stage/stage-tap.ts` 的 `flow.epilogue` / `summaryAsked` /
   收束指令注入与 `recordSummary`、`src/playwriter/prompt.ts` 的《结局与多周目》章相应措辞。
   收束散文改走 `<ending summary=…>`。
3. **删除 `EndingCard` 接线并补上 `ended` 闸**：`src/client/stage-view.tsx:654` 已有
   `ended={ending !== null}`，但它同时把 `EndingCard` 挂进 `overlay`——两者一起来自 dsh-aivn 侧改造。
   注意 `EndingCard` 已从 `@aivn/stage` 导出面移除，那边不删就编译不过（这正是有意的信号）。
4. **账本 `summary` 的取值路径**：从「`epilogue` 落地时回填」改成「`ending` IR 上直接就有」。

> 本仓 `plays/` 不进 git，也没有样例剧目，所以 stage-ai 侧不存在需要迁移的存量剧本。

## 一个重要的边界发现

**`apps/web`（本仓的独立应用）从来没有接过 `ending`**：`git log -S'EndingCard' -- apps/web/src/`
无结果，`StageScreen.tsx` 从不传 `ended`，`apps/server/src/prompt.ts` 里**没有 `<ending>` 这一章**，
本地 `plays/` 里也没有任何结局脚本（已 grep）。

也就是说，`<ending>` 这条路到今天为止**只在 dsh-aivn 里是活的**；本仓这一半提供的是
「语法 + IR + 渲染层里那点共用件」，而不是一条能在本仓应用里走通的端到端链路。这对本次工作有两点影响：

1. `packages/stage` 侧删掉 `EndingCard` 是**安全**的——本仓应用根本没用它，而 dsh-aivn 侧的引用
   会在它自己的编译里暴露出来（这正是我们要的信号）。
2. **终局态（不摆停止点 / 不记第二遍账 / 分支冷开重建）在本仓应用里验证不了**，必须等 dsh-aivn
   侧任务落地后在插件实例上验。用户验证文档已按此调整，只留一条本仓可验的普通演出回归。

## 顺带发现（非本次引入，未修）

worktree 预览实例的 `scripts/init-worktree.sh` 把 `plays/*` **软链**进 worktree，而
`PlayLibrary.list()`（`apps/server/src/store.ts:448`）用 `Dirent.isDirectory()` 过滤——**软链的
`isDirectory()` 为 false**，于是软链剧目在「我的剧目」里一个都不显示，预览实例开箱即空。
本次验证时临时把 `plays/stub` 换成真实副本绕开。要长期可用应改那个脚本（`cp -r` 或让 `list()`
跟随软链），但那不在本任务范围，留作后续。
