# 从选项分叉后台词条落在「（点击开始）」——修复小结

> 日期：2026-10-09 · 仓库：`dsh-aivn`（分支 `task/15`）
> 诊断见同目录 `261009-dsh-branch-stage-empty.troubleshoot.md`。

## 问题

从上一个选项分叉出新对话 → 进 AIVN tab：**停止点选项显示正常，但选项背后的台词条写着
「（点击开始）」**——那是空舞台的占位，不是重投影出来的正文。

## 根因

`usePlayback` 换代后会把播放游标快进到新内容的末尾，但**要不要把末尾那句摆上台词条**取决于
`resumeAfterReset`；插件从未传过它（恒 `false`），于是重建完的状态是「游标在末尾、屏上一行都没有」
（`current === null`）。这个状态同时解释了两个现象：

- `exhausted` 成立 → `panelReady` 成立 → **停止点照常摆出**；
- `view` 为 null 且 `live` 为 false（分叉会话没有 `beat/start` 帧）→ `emptyDialogHint(false)`
  → **「（点击开始）」**。

改写 / 重写那条路上紧接着有一轮在跑（`live === true`），台词条显示「剧作家正在落笔…」，
把 `current === null` 掩盖了——所以既有判据一直没抓到。

## 改动

| 层 | 文件 | 改动 |
|---|---|---|
| 宿主 | `src/hub.ts` | `reset(sessionId, running)`：重置帧带上「这条分支还在不在写」 |
| 宿主 | `src/stage/stage-log.ts` | 重建时把 `running` 传给 `reset`（这个值本来就在手上，此前只用给末帧的 `beat` 状态） |
| 客户端 | `src/client/stage-view.tsx` | 新增 `resumeAfterReset` + 落地口 `rebase(running)`；`reset` 帧按 `!running` 定夺；`beat/start` 时若画面还停在重建摆出的末句，再换代一次把它撤下来（不撤的话 `shouldAutoStart` 不成立，新一轮第一句要玩家点一下才上来） |

判据与 AIVN app 本体对齐（`apps/web/src/views/StageScreen.tsx` 的 `resumeAfterReset: rebase.resume`，
`resume = !streaming`）：**空闲就显示末行，还在写就不显示**。

## 验证

| 套件 | 结果 |
|---|---|
| `npm run e2e:director`（真 LLM：三拍 + 一次原生分叉） | **19/19 通过**，含新增 D18 |
| 负向对照：把 `setResumeAfterReset(!running)` 改回恒 `false` 重跑 | **D18 变红**，台词条上就是「（点击开始）」，选项照常——现象逐字复现 |
| `e2e/verify-rebuild`（离线，不需要实例） | 14/14，含新增 R1b（重置帧带 `running`） |
| `e2e/verify-ending`（离线） | 8/8 |
| `npm run typecheck` | 全绿 |
| `node build.mjs --check` | 产物与源码一致 |

关键截图：`e2e-artifacts/director-branch.png` —— 分叉出来的会话里，选项照常摆着，
台词条是重投影出来的正文「尽头响了一声。」。

> **D16 是条 flaky 判据**：它用页面里自挂的 SSE 探针数帧（`childFrames > 3`）。同一份代码跑三遍，
> 收到过 62 / 67 / 71 帧，也有一次 **0 帧**（那次 D18 却照常绿——舞台确实重建出来了，
> 只是探针没收到）。根因未定，倾向是这台 8GB 机器上 Chromium/EventSource 在内存压力下的抖动，
> 但**没有证据**，先记在这里。要让分叉这条链稳定，应把「重投影是否发生」并到 D18 那种
> **看舞台实际内容**的判据上，而不是数探针帧数。

D18 是这次补上的回归判据：既有 D16 只数帧数（帧到了就过），没验过**舞台**是不是真把那句摆出来了。

## 顺带修的（同一批提交里）

1. **e2e home 的模型 provider 没配上**（环境侧，非本仓）：`settings.yaml` 走 dsh-settings 的
   legacy 导入时表里没有 `llm-pi-ai` 的落点，整段被丢，`llm-pi-ai` 插件因此休眠，
   所有真 LLM 用例都卡在「第一拍超时」而**页面毫无报错**（会话日志里才有
   `no adapter registered for provider "cpa"`）。手工把该段补进
   `<home>/profiles/web/cordis.patch.yml` 后恢复。已建议回灌 `dsh-e2e` 技能骨架。
2. **`e2e/lib/boot.mjs` 的 `dismissOnboarding`**：只认「添加 API key」那扇门，新冒出来的
   **Preview Notice**（按钮是 `Continue`）会遮住输入框，症状是 `sendMessage` 的
   `editor.click()` 超时并报一串 `intercepts pointer events` 噪声。改成逐扇关门，
   且返回「输入框中心点最顶层的元素就是输入框吗」——直接测遮罩还挡不挡事，比数弹窗个数可靠。

## 无用户验证项

现象已由 D18 + 负向对照完整锁住（负向对照复现出的就是用户报的原话），无需实机复核。
