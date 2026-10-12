# 检视报告

## 概要

本次复检覆盖一行一条 TTS 的服务端 `VoicePipeline`、客户端 `VoiceDirector`、WS 协议消费、交班路径及跨宿主影响。上一轮 B1、S1、S3 的修复方向成立，但 B2 在真实 `PlayHouse` 交班入口仍有状态丢失边界；同时共享包对 `dsh-aivn` 的破坏性签名变更尚未完成跨线适配，因此当前不能准入。

## 需求对齐

主仓的一行一请求语义已基本落实：服务端在 `say_end` 整句入队，协议和客户端按 `seq` 关联单个音频文件，失败会显式通知，背压缩小路径也补了恢复检查。给出的主仓构建、类型检查、单测和真机/浏览器 E2E 证据与本次目标一致。

但跨宿主约束没有满足。项目跨线验证规范明确规定共享 `@aivn/stage` 改动必须重建并验证 DSH；当前 `dsh-aivn` 仍保留旧的 `phrase` 协议及旧 `handleAudio/markPending` 调用，属于编译级破坏。另有一个新增 `enabled/paused` 状态修复只覆盖了直接 `VoicePipeline.handover()` 测试，没有覆盖 `PlayHouse.handOverVoice()` 的空 backlog 判定。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B1 | [`apps/server/src/orchestrator.ts:614-619`](../../../../.worktrees/replay-complete-line/apps/server/src/orchestrator.ts:614) | `takeVoiceBacklog()` 判断空 backlog 只检查 `queue`、`deferred` 和 `audience`，忽略 `enabled` 与 `paused`。因此用户关闭语音且当前没有排队任务时，`handover()` 虽返回 `{enabled:false}`，这里却直接转成 `null`；`playhouse.handOverVoice()` 不会调用 `adoptVoiceBacklog()`，新建的 `VoicePipeline` 默认 `enabled=true`，后续台词会偷偷开始合成。`paused:true` 且暂时无任务时也会丢失暂停状态。新增的「交班带走开关状态」用例直接调用 `adopt()`，没有覆盖这个真实编排入口。 | 空 backlog 的判定应把交班状态纳入：至少在 `enabled !== true` 或 `paused !== false` 时保留 backlog；或者不把状态型 backlog 转成 `null`，让 `adopt()` 始终恢复 `enabled/paused/audience`。补一个经 `takeVoiceBacklog → dispose → adopt` 的集成级用例，分别覆盖 `enabled=false`、`paused=true` 且队列为空。 |
| B2 | [`packages/stage/src/audio.ts:220-235`](../../../../.worktrees/replay-complete-line/packages/stage/src/audio.ts:220)、[`packages/stage/src/audio.ts:290-318`](../../../../.worktrees/replay-complete-line/packages/stage/src/audio.ts:290)；兄弟仓 [`dsh-aivn/src/client/stage-view.tsx:379-383`](../../../../dsh-aivn/src/client/stage-view.tsx:379)；[`dsh-aivn/src/voice/voice.ts:15-20`](../../../../dsh-aivn/src/voice/voice.ts:15) | 共享 `@aivn/stage` 已移除 `phrase`，并将 `handleAudio/markPending/audioFailed` 改为行级签名，但 `dsh-aivn` 仍定义并传播 `{lineSeq, phrase}`，调用 `director.handleAudio({seq, phrase, url})` 与 `director.markPending(lineSeq, phrase)`，且其宿主仍按短语切分。按项目跨宿主规范，这不是可忽略的遗留：重建 DSH `lib/` 时会在类型/构建阶段失败，若只发布主仓则 DSH 线得到破坏性共享包。 | 必须在合并/发布门槛前完成 DSH 适配并重建 `lib/`，至少删除 `PhraseChunker/chunkLine` 及 phrase 字段，让 `voice-host`、hub、stage view 按一行一文件调用共享播放器，并执行 DSH 的 `typecheck`、`build`、`build.mjs --check` 及受影响离线/单点验证。若因对方工作区 dirty 不能立即改，应将本仓变更暂缓，或先在 DSH 建立可回退的独立工作分支/提交其现有 dirty 改动后做适配，不能以“当前本来就红”作为跨线契约破坏可接受的理由。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | [`apps/server/src/voice.ts:151-176`](../../../../.worktrees/replay-complete-line/apps/server/src/voice.ts:151) | `VoiceBacklog` 的状态恢复实现本身正确，但 `takeVoiceBacklog` 的 `null` 优化使其只在有任务时生效，状态语义与接口注释不一致，容易被后续维护者再次误判为空。 | 将“是否需要交班”抽成带明确语义的判断函数，注释说明状态型 backlog 也必须传递；为 `audience=false`、`enabled=false`、`paused=true` 的空队列分别保留回归用例。 |
| S2 | [`docs/issues/261012-voice-line-level/261012-voice-line-level.summary.md:33-35`](../../../../.worktrees/replay-complete-line/docs/issues/261012-voice-line-level/261012-voice-line-level.summary.md:33) | DSH 遗留已记录，但当前仍是开放的破坏性变更，没有明确“主仓合并前阻断”及完成条件；跨线矩阵也要求共享包变更后重建 DSH。 | 将 DSH 适配与验证命令写成明确的合并前执行项，并在完成后补回验证结果，而不是只作为后续遗留说明。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | [`apps/server/src/voice.ts:312-315`](../../../../.worktrees/replay-complete-line/apps/server/src/voice.ts:312) | `speakable()` 用 Unicode `L/N` 判断可读字符，中文、拉丁字母和数字覆盖合理，但完全由符号构成的台词会静默不发起请求；这与当前“纯标点不合成”的设计一致，不过应确保产品文案和排障文档明确该行为。 | 在语音契约或测试名称中固定“纯标点/省略号不合成”的预期，避免把它误报为 TTS 丢帧。 |
| N2 | [`apps/server/src/voice.ts:319-321`](../../../../.worktrees/replay-complete-line/apps/server/src/voice.ts:319) | pending 面板标题使用前 14 个 JS 字符截断，中文按 code point 通常可接受，但包含组合字符或 emoji 时视觉宽度不稳定；不影响协议和播放正确性。 | 后续如出现面板标题溢出，再改为按显示宽度截断；当前不阻断。 |

## 准入结论

**结论**：`不准入`

**说明**：主仓的一行级语音重构主体与 B1/S1/S3 修复方向成立，但真实交班路径仍会在关闭语音或暂停状态下丢失状态，且 DSH 共享宿主仍是编译级不兼容。修复 B1 并完成 DSH 适配与跨线验证后再复检。
