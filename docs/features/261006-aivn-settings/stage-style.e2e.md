# 剧目舞台皮肤（stage-style）端到端测试报告

## 测试环境
- **环境/前置**：
  - DSH 实例：`http://127.0.0.1:57411/?token=e2etest`（`DSH_HOME=/root/projects/dsh-aivn/.dsh-e2e-home`）
  - 工作区 / 剧目根：`/root/projects/dsh-aivn`（分支 master）
  - 浏览器：Playwright Headless Chromium（Viewport 1280x860, DPR 2.0）
  - LLM 模型：真外部模型（cpa / medium，真实多轮调用）

## 功能类测试项

| # | 测试步骤 | 预期 | 实际 | 状态 | 证据 |
|---|----------|------|------|------|------|
| 1 | **无 theme.json 时默认皮验证**：工作区无 `theme.json`，新建剧作家会话，发送开场指令并切换到 AIVN 舞台 Tab | 舞台正常挂载，0 控制台报错；不注入任何样式规则；计算样式与 stage.css 默认基线一致（台词字色 `#f2ebde`，圆角 `10px`，零像素变化） | 舞台成功挂载，控制台 0 报错；`style[data-aivn-theme]` 规则为空字符串；计算样式完全符合基线（字色 `rgb(242, 235, 222)`，圆角 `10px`） | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/1-default-skin.png` |
| 2 | **真实用户自然语言驱动换皮**：在搭台助手会话中用自然语言发消息（「把台词条底色改成深紫 rgb(35 15 45 / 0.9)，字色改浅粉淡色 #f8e8f8，舞台圆角改成 18px，强调主色改成亮粉紫 #d870e8」） | 助手解析意图并调用 `set_stage_style`，合法键落盘到剧目根 `theme.json` | 助手成功调用 `set_stage_style`，落盘 5 个键（含自动联动补充的 `accent_ink: #2a0f33`）；`theme.json` 真实写入磁盘 | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/2-stagehand-chat.png` |
| 3 | **跨会话免刷新实时换装**：观察先前已打开舞台的剧作家会话页面（全程不刷新） | SSE 接收全量样式快照，舞台作用域规则即时生效，文字与圆角实时变色更新 | 原剧作家页面在不刷新的情况下，1 秒内完成换装，台词字色更新为 `rgb(248, 232, 248)`，圆角变更为 `18px`，背景与字色对比分明、清晰可读 | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/2-live-updated-stage.png` |
| 4 | **工具三态语义（null 恢复默认）**：搭台助手会话中要求「把舞台圆角恢复默认，别的保持不变」 | 助手调用 `set_stage_style` 传入 `stage_radius: null`，`theme.json` 中该键被移除，舞台圆角实时恢复 10px | 助手成功将 `stage_radius` 传 `null`，`theme.json` 移除 `--stage-radius`（由 5 键变 4 键），舞台未刷新即时回退到默认圆角 `10px` | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/5-reset-null.png` |
| 5 | **非法值拒绝语义（全有或全无原子事务）**：要求助手「再把圆角设成 999px」 | 写闸拦截（`0–24px` 范围限制），整次调用抛错拒绝；`theme.json` 0 字节修改；助手在对话中解释失败原因 | 写闸抛出校验错误 `不是合法值（要求 <0–24>px）`，`theme.json` 保持 4 键无任何修改；助手在对话中明确解释了 999px 被拒原因并提供了合法选项建议 | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/5-rejected-illegal.png` |
| 6 | **手改坏文件的容错（读闸）**：手动在 `theme.json` 写入白名单外键（`--evil-key`）与非法格式值（`--dialog-ink: red`, `--stage-radius: 999px`）以及合法键（`--accent: #00ff00`），重新挂载舞台 | 读闸宽容处理：只丢坏键，合法键生效，剧目正常开演，不白屏、无未捕获异常 | 舞台正常挂载无崩溃，`--accent` 正常生效为 `#00ff00`；坏键被安全过滤丢弃，台词字色与圆角平滑回退默认基线 | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/4-fault-tolerance.png` |

## 体验类测试项

| # | 体验场景 | 关注点 | 观察 | 建议/问题 |
|---|----------|--------|------|-----------|
| 1 | **换装后的视觉对比度与成套性** | 文字可读性、颜色搭配是否成套 | 实际换装后，浅粉文字（`#f8e8f8`）在深紫底色（`rgb(35 15 45 / 0.9)`）上对比鲜明，正文字迹非常清晰无发糊现象；且助手主动识别出亮粉紫主色需要在按钮/左尺上搭配深色字，自动联动设置了 `accent_ink: #2a0f33`，表现出极佳的审美与成套协调性。 | **观察良好**：助手还主动在回复中提醒用户注意 `accent_soft` 和选肢卡 `choice_*` 是否需要同步替换，避免跨层视觉割裂，体验非常细致。 |
| 2 | **圆角与几何视觉变化感** | 变化是否肉眼可见 | 默认 10px 到 18px 的变化肉眼非常明显，窗口和台词条从轻度圆角呈现出更现代的圆润风格；随后恢复默认后平滑缩小回 10px，视觉反馈真实确定。 | **观察良好**：18px 与 10px 区分度明确，无布局跑偏。 |
| 3 | **无样式任务时助手的克制性** | 助手是否自作主张美化皮肤 | 用户询问与样式无关的素材准备事项（「帮我看看现在剧目里缺什么素材，接下来需要准备什么？」），助手严格专注业务边界，调用 `read_skill`、`get_readiness` 梳理图单与设定，完全没有调用 `set_stage_style`，未触碰 `theme.json`。 | **体验极佳**：遵循了「用户没提样式时不自作主张修改」的克制原则。 |

## 证据图

### 1. 默认皮肤基线（零注入、无报错）
![默认皮肤舞台截图](</root/projects/dsh-aivn/e2e-artifacts/1-default-skin.png>)

### 2. 搭台助手自然语言换皮与成组建议
![搭台助手对话及成组联动建议](</root/projects/dsh-aivn/e2e-artifacts/2-stagehand-chat.png>)

### 3. 跨会话免刷新实时换装效果（深紫底 + 浅粉字 + 18px 圆角）
![跨会话实时换装效果](</root/projects/dsh-aivn/e2e-artifacts/2-live-updated-stage.png>)

### 4. 工具三态：null 恢复默认圆角
![恢复默认圆角](</root/projects/dsh-aivn/e2e-artifacts/5-reset-null.png>)

### 5. 工具拒绝语义：非法值 999px 被拦截且文件保持零变动
![非法值拒绝与解释](</root/projects/dsh-aivn/e2e-artifacts/5-rejected-illegal.png>)

### 6. 助手克制性：未提样式时专注素材规划
![未提样式时的克制回复](</root/projects/dsh-aivn/e2e-artifacts/6-unrelated-chat.png>)

### 7. 手改坏文件读闸容错（只丢坏键、剧目照常开演）
![坏文件读闸容错](</root/projects/dsh-aivn/e2e-artifacts/4-fault-tolerance.png>)

## 固化用例（如有）
- 无（本次运行模式为 `solidify_tests: false`，临时测试脚本已在测试完成后清理）。

## 结论
- **功能测试**：通过 6 · 不通过 0 · 受阻 0
- **体验测试**：3 项观察，关键问题 0（字底对比度清晰可读，成套性好，圆角视觉显著，助手克制性优秀）
- **发现的问题与严重度**：无阻断或严重缺陷。
- **总体结论**：**通过**
- **是否建议交付**：**强烈建议交付**。双闸校验、跨会话 SSE 广播机制、无刷新换装以及 Agent 交互表现均完全达到预期并具备高度健壮性。

## 待跟进
- 无阻塞项。工作区环境已复原，临时夹具已完全清理。
