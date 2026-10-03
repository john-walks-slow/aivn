# 回看时舞台画面跟着回退 小结

## 做了什么

滚轮/方向键/回顾面板回看历史台词时，舞台画面（背景、CG、立绘及其站位、表情、在场与否）
跟着回到**那一句刚开始**的那一刻；滚回播放头无缝回现场。音频与骨架占位不参与回退
（音乐是当下氛围、骨架是「图还在路上」），回看中舞台挂 `.rewinding` 关掉过渡动画。

## 改动面

- `apps/web/src/stage/director.ts`：抽出 `applyVisualCue` / `applyCue` 两个纯函数，
  新增 `visualAt`（画面折回）与 `cueWatermarkForEntry`（会话记录下标 → cue 水位线），
  `usePlayback` 的 `visual` 在回看中换成折出来的画面。
- `apps/web/src/stage/StageTheater.tsx`：回看中给舞台根节点挂 `.rewinding`。
- `apps/web/src/app.css`：`.theater-stage.rewinding` 下关掉背景淡入/立绘登场/行为词/补间。
- 测试：`apps/web/test/rewindVisual.test.ts`（13 例）、`apps/web/test/directorRewind.test.tsx`（2 例）。
- 协议、服务端、持久状态零改动；回看仍然不改世界线、不改播放头、不写阅读位置。

## 关键约束（后续改动别踩）

- **现场 `visual` state 不许被回看写**：回看只是渲染层换一张派生画面，所以回现场不需要
  任何还原逻辑。谁要是把回看折出来的结果写回 state，「回到现场」就会变成一处还原 bug。
- **水位线找不到就整段退回现场**（返回 null），不要退回「折到末尾」或「折到 0」——那会把
  舞台显示成另一个时刻，比不回退更糟。
- 退场中的立绘在**现场**必须留在表里（要播淡出），只在**回看画面**里剔掉。
- 音频属性故意不参与画面折叠；要改成跟随回退，得同时给 LoopChannel 加防抖。

## 验证

用例 + 实机截图见同目录 `261004-rewind-visual.troubleshoot.md` 与
`261004-rewind-visual.validation.md`（左＝现场，右＝回看后）。既有失败
`settingsPaneCards.test.tsx` 3 例与本次无关。
