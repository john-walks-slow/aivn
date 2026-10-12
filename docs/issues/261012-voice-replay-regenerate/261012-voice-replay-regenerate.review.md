# 检视报告

## 概要

本轮仅复检 B-4：`VoiceDirector` 换行请求时旧 `wantReplay` 计时器可能提前清除新行等待记号的竞态。复核了 `packages/stage/src/audio.ts` 的最终实现及 `voiceReplay.test.ts` 新增计时用例；修复逻辑完整，未发现 B-4 遗留阻塞问题。

## 需求对齐

已满足 B-4 修复要求：

- `requestReplay()` 在切换到新行前调用 `clearWantReplay()`，同时清除旧 timer、释放旧行等待状态并使旧 token 失效。
- 新等待建立后捕获当前 `wantReplayToken`；timer 回调只有在 token 仍匹配时才执行清理。因此即使旧回调已经被事件循环排队，仍无法清除新行的等待记号。
- `setEnabled(false)`、`beatStarted()`、`dispose()`、`forgetLine()` 和正常收束路径均复用同一清理逻辑，旧 timer 不会遗留影响后续请求。
- 新增 fake-timer 用例覆盖：换行后跨过旧行 20s 上界时新行仍只请求一次，以及无回执达到 20s 后同一行允许再次请求。

未运行测试或编译；测试结果依据用户提供的验证信息，代码检视基于工作区最终文件。

## 阻塞问题

无。

## 建议修改

无。

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-1 | [packages/stage/src/voiceReplay.test.ts:62-75](../../../../packages/stage/src/voiceReplay.test.ts#L62-L75) | 当前测试能直接验证 `clearTimeout()` 阻止旧 timer 执行，但无法在 fake timers 中真实模拟“旧回调已经排入事件循环、`clearTimeout()` 已无法拦截”的竞态分支，因此 `wantReplayToken` 的防御性校验主要由代码推理覆盖。该限制不影响本次 B-4 结论。 | 如后续希望提高回归保护，可将 timer 调度抽象为可注入调度器，或补充针对回调代号校验的单元测试；无需作为本次合并前置条件。 |

## 准入结论

**结论**：`准入`

**说明**：B-4 的旧 timer 清理与 token 隔离均已落实，跨行等待窗口和无回执超时重试也有对应回归用例；未发现必须修复后才能进入下一阶段的问题。
