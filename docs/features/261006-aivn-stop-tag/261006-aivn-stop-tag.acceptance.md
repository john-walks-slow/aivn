# 261006-aivn-stop-tag 端到端测试报告

## 测试环境
- 环境/前置：Worktree `/root/projects/dsh-aivn/.worktrees/accept-stop-tag` (commit `2798292`)，E2E 实例 `http://127.0.0.1:41330/?token=e2etest`（Chromium Headless，预设「剧作家」）。

## 程序化 DOM 读数与会话证据

### 1. 分支键程序化 DOM 读数（场景 1）
- **选中按钮 `aria-label`**：`"Branch into a new conversation"`
- **`aria-disabled` 属性返回值**：`null`（非 `'true'`，处于正常激活可用状态）
- **`disabled` 属性**：`false`
- **点击触发分支后新开子会话**：在侧边栏成功开出子会话，标题为 `（游戏开始，请演出第一轮） (1)`
- **新会话 AIVN 面板中读取的选项**：`["前进", "后退", "自由输入"]`（完整继承停止点与画面位置）

### 2. 自然收尾助手消息尾部原文证据（场景 3）
- **日志源文件**：`.dsh-e2e-home/sessions/--root-projects-dsh-aivn-.worktrees-accept-stop-tag--/session-e2547f0a-208b-4611-86bb-ee05bbb07d65/session.v4.jsonl.zstd` (seq:46)
- **剧作家输出消息正文解压尾部原文**：
  ```xml
  <say id="lin">你上去，还是我上去。</say>
  <narrate>水还在涨。裂口里的那卷袖子，一端已经松了。</narrate>

  <stop/>
  ```
  *证据说明：模型生成的内容末尾精确包含且仅包含自闭合标签 `<stop/>`，确凿证明为纯粹的自然收尾，未携带选项或输入框属性。*

---

## 功能类测试项

| # | 测试步骤 | 预期 | 实际 | 状态 | 证据 |
|---|----------|------|------|------|------|
| 1 | 开剧作家会话，第一拍演完（轮尾带停止点），切到 Chat 视图，鼠标移至轮尾消息，检查动作条上的「在新对话中分支」键 | 分支键 `aria-disabled` 不为 true 且可点击；点击后成功开出新子会话，且新子会话切至 AIVN tab 时画面停在相同位置、停止点选项面板在 | 找到分支按钮 `aria-label="Branch into a new conversation"`，DOM 读数 `aria-disabled` 为 `null` (可点)；点击后开出子会话 `(1)`，切至 AIVN 视图画面停在同一位置且完好保留「前进/后退/自由输入」选项面板 | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/accept-stop-tag/01-branch-button.png` |
| 2 | 在 AIVN tab 中展示选项面板，点击其中一条选项（「前进」） | 点选的选项原文作为玩家消息回到剧作家，舞台时间线上多出一行回执，剧情继续向下演绎 | 点击「前进」选项后，该选项作为玩家消息投递成功，画面底部出现玩家「前进」回执，随后成功触发下一拍的剧情演算 | 通过 | ![停止点面板点击与回执](</root/projects/dsh-aivn/e2e-artifacts/accept-stop-tag/02-stop-panel-receipt.png>) |

## 体验类测试项

| # | 体验场景 | 关注点 | 观察 | 建议/问题 |
|---|----------|--------|------|-----------|
| 1 | 自然收尾（剧作家演完带 `<stop/>` 无选项） | 选项面板 vs 继续卡、台词渲染、标签泄漏 | 界面展现为标准的普通「点击舞台继续生成」卡，而非多选项面板。台词与字幕正常逐行呈现，已校验日志 `seq:46` 确认模型输出为裸 `<stop/>`，标签被前端正确解析过滤，没有裸露到台词文本中，出现时机自然顺畅 | 无 |

## 证据图

![分支键可点与 DOM 程序读数水印](</root/projects/dsh-aivn/e2e-artifacts/accept-stop-tag/01-branch-button.png>)

![停止点面板点击与回执](</root/projects/dsh-aivn/e2e-artifacts/accept-stop-tag/02-stop-panel-receipt.png>)

![自然收尾普通继续卡与标签过滤](</root/projects/dsh-aivn/e2e-artifacts/accept-stop-tag/03-natural-finish.png>)

## 结论
- 功能：通过 2 · 不通过 0 · 受阻 0
- 体验：1 项观察，关键问题 0
- 总体：通过

## 待跟进
- 无
