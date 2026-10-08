# 检视报告

## 概要

检视范围：`packages/core`（spec / events / parser / 测试）与 `packages/stage`（EndingCard / index / script / css）两个包，外加 `apps/web` 的一个被删测试。整体实现干净利落：改名彻底、删除无悬空引用、`findTagEnd` 的引号感知定界正确且流式安全，测试覆盖与设计文档 §6 逐条对上。未发现阻塞问题；有 4 项建议修改，其中「`epilogue` 落入未知标签分支`」与「`ended` 闸接线缺失」值得在合并前处理或明确交接。

## 需求对齐

与 `261008-ending-archive.plan.md` 完全一致：

- `EndingAttrs` 由 `id/title?/subtitle?` 改为 `id/name?/subtitle?/summary?`，字段语义写进注释（`spec.ts:85-94`）。
- `<epilogue>`、`EPILOGUE_TAG`、三个 `epilogue_*` IR 事件、`OpenWrap.tag` 的 `epilogue`、`emitText`/`closeWrap` 分支、stage 的渲染与 CSS、web 测试全部删除，无残留（全仓 grep，除 `docs/features/261007-dsl-endings/` 历史记录）。
- `findTagEnd` 引号感知定界接入 `run()`，淘汰原 `indexOf(">")` 限制并在 `spec.ts` 文件头重写口径。语义只放宽、不收紧（见下）。
- 计划 §5 改动清单逐条落实；`playbackState.ts` 的 `ended` 闸与 `StageTheater` 的 `ended` 入参按计划保留。

计划外无过度设计、无明显偏离。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| A1 | `packages/stage/src/StageTheater.tsx:71-75` | `ended` 入参的文档注释仍写着「**结局卡由宿主经 `overlay` 摆出**」，而结局卡已被本次删除；且全仓没有任何调用点给 `ended` 传 `true`（`apps/web/src/views/StageScreen.tsx:612` 未传），这道计划 §4 明确指定的「终局态兜底」实际上是死闸——新口径下的「不让点舞台继续」无人接住。 | 二选一：(a) 若按计划由 dsh-aivn 侧接线，把注释里的「结局卡由宿主摆出」删掉、写明「本任务的终局态出口由 dsh-aivn 侧接线」并留 TODO；(b) 若该接线属本次 stage-ai 范围，由宿主从 `ending` 事件推出终局态并传入。至少不要让注释继续指向已删的 `EndingCard`。**注**：`ended` 是否该在 stage-ai 半侧接线，需与 dsh-aivn 任务边界确认——本报告不臆断归属。 |
| A2 | `packages/core/src/dsl/parser.ts:207-211`（`isKnownTag`） | `epilogue` 从 `DSL_TAGS` 移除且未进 `LEGACY_TAGS`（`spec.ts:115`），于是旧提示词 / 存量剧本里的 `<epilogue>…</epilogue>` 落入「未知标签按字面文本输出」分支，会被**当台词原样演给玩家看**（`parser.golden.test.ts:343` 证明了该行为）。这恰是 `LEGACY_TAGS` 创立的动机（见 `spec.ts:107-114`）。 | 若 dsh-aivn 侧的提示词尚未在本任务窗口同步移除 `epilogue`，把 `"epilogue"` 加入 `LEGACY_TAGS`（静默丢弃 + 一条 legacy warning）。若已确认同步移除，则本项可关闭，但请在计划或 summary 里明确记录「不回喂自修正」的取舍。 |
| A3 | `packages/core/src/dsl/spec.ts:17-20`、`packages/core/test/parser.golden.test.ts:626-687` | 两处：①文件头称「要写含 `"` 的正文请改用单引号（`summary='他说"走吧"'`）」，但未点明**上屏属性**（`scene bg`、`actor id`、`say id` 等由宿主渲染/键控的字段）不能走单引号出口——单引号声明可含 `"`，若模型误用到 id 类字段会把引号带进键值。②新增用例只覆盖 `<ending>` 的属性值，未覆盖已知标签（`scene`/`say`/`fx` 等）在引号感知定界下的回归。 | ①在文件头补一句「单引号出口只适用于自由文本，机器读的属性（id/bg/…）仍应是双引号 + 无 `"` 的值」。②补 1-2 个既有标签带引号 / 带 `>` 的 golden 用例（如 `<scene bg="a>b"/>`、`<say id='m"io'>` 的预期），把计划 §7 风险表里「不引入转义，语义只放宽不收紧」的承诺钉在测试上。 |
| A4 | `packages/core/src/dsl/parser.ts:373-384` | 存量剧本写 `title=` 会静默失效（`parseAttrs` 收下未识别属性，`ending` case 只读 `name`），计划 §7 只把它记为「dsh-aivn 侧任务去改」。对模型/作者而言这是一次无提示的字段丢失。 | 在 `ending` case 里对已保留但不再识别的键（至少 `title`）挂一条 `malformed_tag` warning（「`title` 已更名为 `name`」），复用既有的回喂自修正通道。低成本、与 `isKnownTag` 的容错哲学一致。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `packages/core/test/parser.golden.test.ts:639-641` | `it("summary 含 "<" 与中文引号「」照常")` 的测试名里用了 ASCII 直引号包裹 `<`，读起来像拼接错误，也削弱了「中文引号不参与定界」这一意图的可读性。 | 改为 `summary 含「<」与中文引号照常` 之类，避免测试名内部再出现未转义直引号。 |
| N2 | `packages/core/src/dsl/parser.ts:77-89` | `findTagEnd` 对「未闭合引号 + 其后有 `>`」的畸形输入会返回 `-1` 一直等到消息边界才丢弃，而旧 `indexOf(">")` 会当场丢弃。两者对错误输入的最终处理相同（都是丢标签 + warning），仅丢弃时机不同，无用户可见差异。 | 无需改动；仅在注释里点一句「畸形未闭合引号会推迟到消息边界处理」，便于后人理解流式等待语义。 |
| N3 | `packages/stage/src/StageTheater.tsx:71-75` | 同 A1 的注释问题；`overlay` 里已无结局卡，`StageScreen` 的 overlay 分支只剩「开演 / StopPanel」。 | 随 A1 一并处理。 |

## 验证说明

未执行测试（检视职责边界）。作者报告 `pnpm -r typecheck` 全绿、core 236 / stage 53 全绿、apps/web 5 条既有失败与本次无关（已在主干 `2f70dee1` 复现）。关于 `findTagEnd` 的行内推理，我从代码路径独立确认：`run()` 逐字符判标签名后调用 `findTagEnd`，未闭合引号返回 `-1` 会 `return` 等待下一 chunk，`endMessage()` 时 `buffer` 以 `<ending…` 开头（匹配 `/^<\/?[a-z_]/`）走 `malformed_tag`，不挂死；`content_after_ending` / `endedInMessage` 复位逻辑（`endMessage:160`、`resetBeat:167`）未受影响。

## 准入结论

**结论**：`条件准入`

**说明**：无阻塞问题，改名与删除干净、`findTagEnd` 正确且流式安全、测试与设计文档逐条对应，可进入下一阶段；建议在合并前或紧随的 dsh-aivn 任务中处理 A1（`ended` 闸接线与悬空注释）与 A2（`epilogue` 落入未知标签分支的回退），它们在「不让点舞台继续」与「旧提示词残留」两条链路上有实际用户可见影响，且均依赖跨任务边界确认。

---

## 作者回应（2026-10-08）

准入结论 `条件准入`，无阻塞。四项建议的处理：

| ID | 处置 | 说明 |
| --- | --- | --- |
| A1 / N3 | **已改**（注释）；归属已确认属 dsh-aivn | `StageTheater.tsx` 的 `ended` 注释不再提结局卡，改为「终幕画面由剧作家自己写进剧本，引擎不摆任何结局卡」。接线归属已查实：dsh-aivn 的 `src/client/stage-view.tsx:654` 已有 `ended={ending !== null}`，但它同时把 `EndingCard` 挂进 `overlay`——两者一起来自 dsh-aivn 侧改造，随 dsh-aivn 任务一并处理。stage-ai 侧的 `ended` 闸按计划§5 保留。 |
| A2 | **已改**，且比建议更进一步 | `"epilogue"` 进 `LEGACY_TAGS`。检视报告说它会被「当台词原样演出」——实测更细：**独立出现**时它走 `orphan_text`（丢弃，但告警说不明白）；**写在包裹标签里**时正文会漏进外层台词被念出来。所以只加 `LEGACY_TAGS` 不够，另加 `legacyWrap` 状态把正文一并吞掉（与 `<comment>` 同一条口径），并让作废标签内的其它标签不开工（否则会摆出空台词行）。三条用例覆盖：独立、嵌在 `<say>` 内、内含游离 `<say>`。 |
| A3 | **已改** | ①文件头补「单引号出口只给自由文本，`id`/`bg`/`src` 等宿主键控属性仍应双引号 + 不含 `"`」。②补两个既有标签回归用例：`<scene bg="school > gate">`（引号内 `>` 不截断）与 `<scene>`+`<say>` 的撕裂喂入等价。 |
| A4 | **已改** | `ending` case 见到保留的 `title=` 时挂 `malformed_tag`：「ending 的 title 已更名为 name，本轮的 title 被忽略」，复用既有的回喂自修正通道。 |
| N1 | **已改** | 测试名改为 `summary 含「<」与中文引号照常`。 |
| N2 | **已改（注释）** | `StageDslParser` 的类注释说明作废包裹标签的吞噬语义；畸形未闭合引号推迟到消息边界这一点未单列注释——它与既有 `endMessage()` 的「未完成标签丢弃」是同一条路径，再说一遍反而噪音。 |

**复审验证**：`pnpm -r typecheck` 全绿；core **241** test 全绿（较改前 +5）；stage 53 全绿；apps/web 仍是那 5 条既有失败（主干 `2f70dee1` 已复现，与本次无关）。改后又跑了一遍探针，逐字撕裂喂入：独立/嵌套/含游离标签的旧 `<epilogue>` 全部只剩一条 `legacy_tag`、零台词泄漏；`title=` 告警到位；`<ending name summary="a > b">` 正常。

**结论**：`准入`。
