# 检视报告

## 概要

本次检视覆盖 `packages/core`、`packages/stage`、`packages/agent`、`apps/server`、`apps/web`，并对照需求、计划、调研报告及 DSH 跨宿主约束，重点检查玩家可见文本、`stripToneTags` 边界、`mood` 退役和提示词正文。核心演出链路的 `raw/text` 分层设计基本成立，但仍有玩家可见的原文泄漏，以及 DSH 侧语音行为未同步的问题，当前不建议准入。

## 需求对齐

主体设计符合需求：标记保留在谱系/TTS 原文中，仅在玩家演出文本层剥离；`ScriptBuilder`、`transcript.fromView`、打字机/标点节奏、改写框初值、翻译和生图上下文均有对应处理；`mood` 已从 DSL 事件、重放和客户端行模型中移除；`TONE_RULES` 采用共享常量，规模符合“简化版”要求。

但“对用户隐藏”并未覆盖所有玩家可见入口：路线树的废弃/兄弟分支卡和语音排队面板仍可显示原文标签。另有 DSH 发行线的本地语音副本未同步标记-only 判定，提示词虽已接入共享规则，但双宿主行为仍会漂移。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B1 | [apps/web/src/stage/beats.ts:377-381](../../apps/web/src/stage/beats.ts:377)；[apps/web/src/stage/RouteCanvas.tsx:568](../../apps/web/src/stage/RouteCanvas.tsx:568) | 路线树卡片的摘要在 `collect()` 中直接使用 `LineageNodeView.text`。当前路径卡随后会被 `beatPreviews()` 用 `ScriptLine.text` 覆盖，但废弃/兄弟分支不在当前缓冲中，会保留谱系原文。因此路线视图打开后，`[whispering]`、`[sigh]` 等会出现在玩家可见卡片上。该路径并非由 `script.ts`/`transcript.ts` 派生，现有浏览器 E2E 只验证演出屏幕，未覆盖它。 | 路线树摘要的谱系回退也必须经过 `stripToneTags`，例如在 `setPreview` 的谱系文本入口剥离；同时为当前路径和废弃分支各补一个路线视图断言，确保整棵树的可见摘要均无方括号。不要只依赖缓冲覆盖，因为兄弟分支天然没有对应 `ScriptLine`。 |
| B2 | [apps/server/src/voice.ts:280-284](../../apps/server/src/voice.ts:280)；[apps/server/src/voice.ts:324-327](../../apps/server/src/voice.ts:324)；[packages/stage/src/PromptQueuePanel.tsx](../../packages/stage/src/PromptQueuePanel.tsx) | pending job 的 `label` 由 `snippet(job.text)` 生成，而 `job.text` 是送 TTS 的原文。舞台排队面板随后直接渲染 `job.label`，所以以标记开头的行会在玩家打开排队面板时显示 `[whispering] 别出声…`。这是一个独立于演出对话框/回顾的玩家可见路径。 | 记账 label 使用 `snippet(stripToneTags(job.text))`，或在统一的 pending-job 显示层按 job 类型剥离。建议保留原文仅用于 TTS、缓存和作者编辑面，不要把原文作为舞台状态文案。应补充“打开语音排队面板期间可见文本不含方括号”的测试。 |
| B3 | [root/projects/dsh-aivn/src/voice/voice.ts:146-150](../../../../dsh-aivn/src/voice/voice.ts:146)；[root/projects/dsh-aivn/src/playwriter/prompt.ts:16-67](../../../../dsh-aivn/src/playwriter/prompt.ts:16) | DSH 侧已接入 `TONE_RULES`，但其独立复制的 `speakable()` 仍只在原文上用字母/数字判定，没有 `stripToneTags`。因此独立版对纯 `[sigh]` 行不合成，DSH 会把它当作可读文本送 TTS，行为与共享需求不一致。若 DSH 的 `lib/` 尚未用本次共享包重建，DSH 舞台端还可能继续运行旧的 `ScriptBuilder`。 | 在 DSH 侧同步 `speakable()` 的标记剥离判定，并用当前 core/stage 重新构建 `lib/`；按跨宿主矩阵运行 DSH build/check 及 stage/voice 单点验证。若本次交付范围只承诺独立版，应明确把 DSH 改动从本功能发布范围移出，否则不能宣称两条发行线一致。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| R1 | [packages/agent/src/prompt/stage-dsl.ts:53-63](../../packages/agent/src/prompt/stage-dsl.ts:53) | `[breathy]`、`[voice breaking]` 主要来自调研中标注为第三方/社区汇总的词条，而不是同等强度的官方锚点；这不违反开放域设计，但当前提示词没有区分“官方常用”与“社区常见”，容易让作者误以为它们与 `[sigh]`、`[whispering]` 具有同等确定性。另，“`（小声）`、`(whisper)` 会被念出来”比调研证据更绝对：调研对半角 `(sad)` 的实测是未被念出但不生效，且全角圆括号未充分验证。 | 保持简化结构，但将圆括号规则改为“Fish S2.1 不认圆括号，不能作为语气标记，可能被当普通台词处理”；必要时把第三方锚点标成“常见但效果不稳定”，或替换为调研中官方表格/官方博客直接出现的词。这样既能阻止错误语法，也不把不确定行为写成确定事实。 |
| R2 | [packages/agent/src/prompt/stage-dsl.ts:48](../../packages/agent/src/prompt/stage-dsl.ts:48) | `DIALOGUE_TAGS` 只写“句首可以用语气标记”，而下方规则明确允许句中 `[gasp]`/`[pause]`。这会给模型一个轻微的“只放句首”的先入约束，与需求强调的位置语义不完全一致。 | 改成“正文中可以用语气标记；句首控制整句，句中从该处生效”，把位置规则集中到 `TONE_RULES`。 |
| R3 | [packages/core/src/speech/text.ts:7-20](../../packages/core/src/speech/text.ts:7) | 80 字形状上限是工程折中，但它不是 Fish 的官方上限。超过 80 字的开放域描述会被当作普通文本保留；若模型生成了超长标签，玩家可能看到方括号。另一个有意但需明确的副作用是函数对 `say`、`narrate`、`thought`、`title` 一视同仁，非配音文本里的合法方括号引用也会被剥。 | 在提示词/契约或函数注释中明确这是“上屏安全启发式”而非 Fish 语法验证；若产品要求更严格的隐藏保证，应改为更宽的上限或针对行内标记的状态机，并增加超长/换行/普通方括号引用的验收用例。当前上限本身可接受，不建议仅为理论风险放弃形状判据。 |
| R4 | [apps/server/test/helpers.ts:104-116](../../apps/server/test/helpers.ts:104)；[apps/server/test/voice.test.ts:121](../../apps/server/test/voice.test.ts:121)；[apps/server/test/orchestrator.test.ts:112](../../apps/server/test/orchestrator.test.ts:112)；[apps/server/test/lineage-ops.test.ts:383](../../apps/server/test/lineage-ops.test.ts:383)；[packages/core/test/parser.golden.test.ts:145](../../packages/core/test/parser.golden.test.ts:145) | 多个测试夹具仍写 `<say mood="…">`。解析器会静默忽略未知属性，功能测试仍能通过，但这些夹具继续把已退役属性作为示例，降低了“mood 已完全下线”的可读性，也会误导后续维护者。 | 将仅用于普通台词的夹具改为无 `mood`；另加一个明确的兼容测试，说明旧剧本的 `mood` 被忽略且不进入事件/重放，而不是让所有夹具继续依赖旧写法。 |
| R5 | [apps/web/test/directorTargets.test.ts:66-117](../../apps/web/test/directorTargets.test.ts:66) | 测试数据仍带 `mood: null`，虽然当前类型检查未因此失败，但与 `ScriptLine` 已移除该字段不一致，属于死字段残留。 | 清理测试 fixture 中的 `mood` 字段，并统一给 `ScriptLine` 测试对象补 `raw`，减少靠类型断言掩盖模型漂移。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | [packages/stage/src/transcript.ts:142-150](../../packages/stage/src/transcript.ts:142) | 谱系 `prompt` 输入分支没有填 `raw`，而 `fromView` 的台词分支会填 `raw`。当前玩家输入不可编辑，因此不影响功能；但 `TranscriptEntry.raw` 的“作者原文”语义不完全统一。 | 若希望模型一致，可将命中的 `line?.raw` 传入；否则在类型注释中明确 input 不提供 raw，因为它不开放改写。 |
| N2 | [packages/stage/src/transcript.ts:58](../../packages/stage/src/transcript.ts:58)；[packages/stage/src/transcript.ts:159-164](../../packages/stage/src/transcript.ts:159) | 纯标记台词（如 `[sigh]`）剥离后为空：直接从缓冲构建时被过滤；谱系已追上后则可能出现只有角色名、正文为空的回顾条目。两条路径的呈现略不一致。 | 明确纯非语言标记行的产品语义：完全隐藏，或显示为无正文的非语言事件；并为“未追谱系/已追谱系”统一处理。 |
| N3 | [packages/core/src/speech/text.ts:16-20](../../packages/core/src/speech/text.ts:16) | 未闭合 `[` 的处理会隐藏最后一个未闭合标记之后的全部文本，这是流式防泄漏所要求的行为；代价是模型最终忘记闭合时可能出现屏幕与语音对剩余文本的不同步。 | 保留当前策略，但在验收文档中明确这是“安全优先”的流式降级；若后续出现频繁漏闭合，再考虑在消息收束时给出修复/告警。 |
| N4 | [apps/server/src/rebuild.ts:125](../../apps/server/src/rebuild.ts:125)；[apps/server/src/orchestrator.ts:1485](../../apps/server/src/orchestrator.ts:1485) | `lineageToBeats` 保留原文是为了继续喂回剧作家，`recentScript` 剥离是为了生图上下文，这两个方向目前语义正确；但“模型上下文”和“玩家可见重建文本”共用谱系原文时，未来新增显示投影容易重复漏剥。 | 继续维持作者面/玩家面边界，并考虑把玩家摘要投影统一收进共享的 `stripToneTags` helper，避免新增 UI 直接读取 `LineageNodeView.text`。 |

## 准入结论

**结论**：`不准入`

**说明**：核心流式文本分层和 `mood` 退役方向正确，但路线树废弃分支与语音排队面板仍能把标记显示给玩家，直接违反“对用户隐藏”；同时 DSH 的本地语音判定尚未同步，双宿主交付存在确定的行为差异。修复 B1/B2，并完成或明确排除 B3 后重新检视。
