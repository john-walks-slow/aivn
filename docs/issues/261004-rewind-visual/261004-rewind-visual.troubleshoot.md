# 回看时舞台画面不回退 排障记录

## 现象

用滚轮（或 ↑↓ / 左右滑 / 回顾面板点一句）回看历史台词时，只有对话框里的字在往回翻：
背景、CG、立绘（含站位、表情、在场与否）全都停在**回看前那一刻**。立绘尤其刺眼——翻到
某支角色还没登场的那一句，她照样站在台上；翻过退场那一句，人也还在。

## 根因

舞台画面是一个**累积状态**：`director.ts` 的 `visual` 由播放头每消费一条 cue 调一次
`applyVisual(cue)` 叠出来（换景、CG、立绘在场表都在里面）。回看游标 `scrubIndex` 走的是
**会话记录**（台词 + 玩家输入），它只决定对话框显示哪一句，从不碰 `visual`——所以画面
永远停在「回看前那一刻」。这是当初写死的行为，源码注释就写着「非 null 时只回看台词，
舞台视觉不动」。

而「折出某一刻的画面」这件事代码里本来就有：刷新恢复走 `resolveResumeSeek` 找到目标行
之后，是从 `cues[0]` 开始 `applyVisual` 折到那一行（只补到那一句的布景，后面的换景提前
生效等于剧透）。只是这条路只接了 seek，没接回看游标。

## 修法（`apps/web`，零协议改动）

1. `applyVisual` 里那套 switch 抽成纯函数：`applyVisualCue`（只算画面：背景/CG/立绘）
   与 `applyCue`（画面 + 音频 + 骨架占位）。live 播放头与回看重算共用同一份判定，
   不会两套逻辑各自漂移。
2. `visualAt(cues, upto)`：从空场折 `cues[0..upto)`，只吃画面类 cue。一次性音效不重放
   （回看时响音效像在倒带），骨架占位不重现（那讲的是「图还在路上」，不是历史画面）。
   折完剔掉退场中的立绘——他们留在表里只是把淡出播完，留着会在回看里挂一个半透明幽灵。
3. `cueWatermarkForEntry(cues, transcript, index)`：会话记录下标 → cue 水位线。台词条目
   落到它自己那条 cue（折到它之前 = 这一句刚开始）；玩家输入没有 cue，落到下一条台词
   之前（上一句演完时的画面）；找不到返回 null——谱系比缓冲快或换过分支时，宁可不回退
   画面，也不能拿一个错的水位线把舞台折成另一个时刻。
4. `usePlayback` 返回的 `visual` 在回看中换成折出来的画面；音频与骨架占位仍取自现场
   （音乐是此刻的氛围，不随回看倒退——否则滚轮就成了打碟机）。**现场那个 state 一个
   字节都不动**，滚回播放头即无缝回现场，不需要任何「还原」逻辑。
5. 回看中舞台根节点挂 `.rewinding`，CSS 关掉换景淡入 / 立绘登场 / 行为词重演 / 站位补间
   ——否则滚轮每翻一句就是一次全场闪烁。

## 验证

- 用例：`apps/web/test/rewindVisual.test.ts`（13 例，纯函数与水位线）、
  `apps/web/test/directorRewind.test.tsx`（2 例，走 usePlayback 真实游标，钉住
  「回看画面随游标变、松手回现场且现场未被污染」）。
- 实机（mock 谱系 + demo 素材，1280×720）：滚轮回看 5 格后背景
  `bg_heroine_bedroom` → `bg_classroom_sunset`、立绘 `pos-left` → `pos-center`、台词回到
  本轮第一句；滚回播放头三者全部复原、`.rewinding` 撤掉、`animation` 恢复 `sprite-in`。
- 回看中的计算样式：立绘 `animation-name: none`、`transition-duration: 0s`，
  背景 `animation-name: none`（即「直接切、不闪」）。
- 回归：`pnpm --filter @stage-ai/web test src/stage/ test/` 133 通过；
  仅 `settingsPaneCards.test.tsx` 3 例既有失败（`api.voiceCatalog is not a function`，
  与本次改动无关，main 上同样复现）。`tsc --noEmit` 干净。
