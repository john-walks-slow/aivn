# 检视报告

## 概要

本次第二次复检聚焦上一轮阻塞项：runtime 交接期间，旧 orchestrator 的 `dispose()` 清空共享 `PendingJobs`，导致新管线登记的语音任务被抹除。交接现已同步调整为 `take → dispose → adopt`，新增共享记账表回归断言覆盖了原问题；未发现本次改动范围内仍需阻塞准入的问题。

## 需求对齐

- 上一轮 B1 已闭环：[`apps/server/src/playhouse.ts:166`](../../../../apps/server/src/playhouse.ts:166) 的 `handOverVoice()` 先从旧管线取 backlog，再 dispose 旧实例，最后由新实例 adopt。由于 `adopt()` 会立即 pump 并调用 `pending.begin()`，新语音条目现在在旧实例的 `clearAll()` 之后登记，不会再被旧清理删除。
- 三步处于同一同步函数内，没有 `await` 窗口；runtime 构建仍在调用交接之前完成，因此构建失败时不会取走 backlog 或销毁旧 runtime。
- [`apps/server/test/voice.test.ts:263`](../../../../apps/server/test/voice.test.ts:263) 新增测试将同一 `PendingJobs` 注入新旧 orchestrator，并按生产顺序执行交接，验证接手后语音条目仍存在。该测试对原顺序有针对性，覆盖上一轮指出的核心回归。
- `dispose()` 的 `clearAll()` 仍可能清除共享表内的非语音任务；但这是既有 runtime dispose 行为，改动前旧 runtime 同样在重建时 dispose，不能归因于本次交接修复。建议作为 PendingJobs 所有权/生命周期的独立工作处理，不要求本次顺手扩大范围。
- 报告保留上一轮的非阻塞建议：in-flight TTS 交接依赖合成层去重；失败回滚测试尚未直接验证旧管线继续服务；浏览器动画和连接重建并发缺少自动化时序回归。根据用户提供的本轮验证结果，相关构建、类型检查、受影响服务端用例及假网关场景均已通过；本检视未自行运行测试。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | [`apps/server/src/voice.ts:247`](../../../../apps/server/src/voice.ts:247)；[`apps/server/test/voice.test.ts:501`](../../../../apps/server/test/voice.test.ts:501) | handover 会把仍在飞的 TTS 任务重新排入新管线，避免丢句依赖同一 Fish 客户端对相同请求去重。当前依赖由注释说明，但 `VoiceBacklog` 契约没有保证客户端/缓存键不变；未来替换合成后端或配置时，可能重复请求乃至重复计费。 | 后续将去重要求明确成 TTS 层契约，或设计可移交的 in-flight promise/结果；至少增加交接前后任务完成时序覆盖，确认不会漏广播、重复广播或重复计费。 |
| S2 | [`apps/server/test/playhouse.test.ts:78`](../../../../apps/server/test/playhouse.test.ts:78) | 构建失败回滚用例验证旧 runtime 身份保留，但未直接证明失败后旧语音管线仍可继续处理任务。静态路径显示失败发生在 backlog take / dispose 之前，且用户报告的故障场景实测通过，现不构成准入阻碍。 | 后续可在失败后继续向旧 runtime 投递语音任务，并断言旧实例产出及 pending 状态仍正常。 |
| S3 | [`apps/server/src/orchestrator.ts:766`](../../../../apps/server/src/orchestrator.ts:766)；[`apps/server/src/pendingJobs.ts:98`](../../../../apps/server/src/pendingJobs.ts:98) | orchestrator dispose 仍会清除整张剧目共享 PendingJobs 表，因此 runtime 重建期间可能移除正在运行的 image/BGM/beat 记账。该路径为已有行为，本轮仍按原逻辑调用 dispose，并未新增这一清理；本次修复仅保证接手后的语音记账在清理后重建。 | 将其作为独立生命周期改进：优先让 runtime dispose 只清理自己拥有的 job；若需要全清，则移到真正丢弃剧目或明确取消全部任务的生命周期。补测试时覆盖非语音 job 在重建中的预期，而不是把所有权设计混入本次 TTS 修复。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | [`packages/stage/src/StageTheater.tsx:310`](../../../../packages/stage/src/StageTheater.tsx:310) | 行为词收尾以固定 `560ms` 定时器清理 `.entering`，与 CSS 动画时长存在两处真相源；正常路径通常由动画结束事件先清理，不影响本次准入。 | 后续考虑以动画结束事件为主，或从同一 token 推导收尾时机，并覆盖 reduced-motion 场景。 |
| N2 | [`packages/stage/src/StageTheater.tsx:358`](../../../../packages/stage/src/StageTheater.tsx:358) | `onAnimationEnd` 未检查动画名称，当前元素任意动画结束都会清除一次性入场状态。现有交互路径下通常无害，但回调语义较宽。 | 后续可限定 `animationName === "sprite-in"`，或使用明确的入场完成回调。 |
| N3 | [`apps/server/src/transport.ts:104`](../../../../apps/server/src/transport.ts:104) | 连接注册后会设置 `audience=true` 并补推暂存语音帧；重连与 runtime 同时重建的端到端时序尚无浏览器级自动化覆盖。用户报告已有人工实测，非本次阻塞。 | 后续增加轻量时序回归，确认 deferred 帧只补推一次，且发生在 sender 注册之后。 |

## 准入结论

**结论**：`条件准入`

**说明**：上一轮阻塞项已由正确的交接顺序和共享 PendingJobs 回归测试闭环；非语音任务在 runtime dispose 时被整表清理属于既有生命周期行为，不应要求本次 TTS 修复一并引入所有权/代际设计。其余事项是建议后续跟进的可靠性与自动化覆盖，不阻碍当前修复进入下一阶段。
