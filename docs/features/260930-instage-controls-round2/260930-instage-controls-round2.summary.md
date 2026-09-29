# 260930 舞台交互第二轮修订

用户口述 6 条交互修订，落到 `feat/instage-controls`（延续 47d806a）。

## 改了什么

1. **顶栏窄屏只剩图标** —— 断点 420px → 480px，`.gui-label { display: none }`，周目芯片另给 `.gui-save-label` 92px 截断，省得把按钮挤没。
2. **台词条改成浮起圆角卡片** —— `.theater-dialog` 从贴边通栏变 `left/right: 10px; max-width: 1120px; margin: 0 auto; border-radius: 16px`；`.dialog-text` 的 `min-height` 从 3.6em 提到 **5.4em**（预留 3 行），短台词不再让卡片忽高忽低。`.dialog-name` 随卡片上沿从 `top: -15px` 微调到 `-14px`。
3. **右下角导演按钮放大** —— `.dir-btn` 34×34 → 46×46，图标 19 → 24；顺带删掉一条误命中 `.bl-tool` 的 `.backlog-list button` 覆盖（它把工具键压回 30×26），`.bl-tool` 本身提到 38×34。`.dir-dot` 重新定位到 `top/right: 6px`。
4. **回顾里加「原始历史」开关** —— `GET /api/plays/:id/history` 读落盘的 playwriter 会话历史，返回最近 20 拍的 user / thinking / assistant DSL / toolCall 四类条目。走**只读快照**，不加 WS 流式消息。实现与已知限制见 `docs/freeform/260930-playwriter-history-snapshot.md`。
5. **三个浮层压过顶栏，各自带关闭** —— `.backlog-screen` / `.route-screen` 改成 `position: fixed; inset: 0; z-index: 40`（顶栏 `.gui-bar` 是 30），统一用新的 `.panel-bar` 标题条，右侧「刷新 / 切视图 / ✕」；`Esc` 也能关。工坊原本就是 `z-index: 40` 且自带关闭键，未动。
6. **取消独立的「继续」按钮** —— `StopPanel` 的 pause 分支不再出按钮；等新内容时（`stopType === "pause"`）点舞台即开新拍，生成中沿用同一套 pending 反馈。`canContinue` 的判定与原按钮的出现条件等价（`panelReady && stopType === "pause"`），`StageScreen` 用 `useRef` latch 防连点双发。

## 验证

`pnpm --filter @stage-ai/core build && pnpm --filter web typecheck && pnpm --filter web test && pnpm --filter web build` 全绿；server 15 文件 141 例全绿（含新增 `test/history.test.ts` 10 例）。

真机 393×851 实测（`scripts/dev-worktree.sh`）：

| 项 | 实测 |
| --- | --- |
| 台词条 | 373px 宽 / 左右各 10px / `border-radius: 16px` / 底部留白 6px |
| 台词高度 | 42 字与 108 字两种台词，`.dialog-text` 均为 84px（min-height 生效），卡片不跳 |
| 导演按钮 | 46×46 |
| 窄屏顶栏 | `.gui-label` 计算值 `display: none` |
| 回顾 / 路线 | `position: fixed` + `z-index: 40`，顶栏坐标处 `elementFromPoint` 命中的是 `.panel-bar` 而非 `.gui-bar` |
| 历史开关 | 切过去能读到「第 1 拍 · 注入上下文 + 原始 DSL（未解析）」 |
| 继续按钮 | 全站 `.continue-box` 节点数 0 |

## 已知限制

- 读盘的历史落后当前拍一拍（`saveSnapshot` 写盘时机），历史视图的「刷新」按钮是为此准备的。
- pause 停止点在演示剧目里走不到（只有编排器自己造：拍中截断 / 空拍报错），第 6 条的运行时表现是按代码路径 + DOM 断言核的，没有跑出一张 pause 的真机截图。
