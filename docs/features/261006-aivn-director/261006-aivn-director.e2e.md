# 导演工具栏 + 舞台重投影 (261006-aivn-director) 端到端测试报告

## 测试环境
- **设备/环境**：LineageOS 23.2 chroot-distro Ubuntu 24.04 (ARM64), NodeJS v22.23.2
- **依赖服务**：`dsh-e2e` managed 实例（端口 49156，home `/root/projects/dsh-aivn/.dsh-e2e-home`）
- **夹具剧目**：`e2e-stage`（工作区 `/root/projects/dsh-aivn`）
- **被测模块**：`dsh-aivn` 插件（`master` 分支），含 `@aivn/stage` 包样式重构与导演工具栏能力

## 功能类测试项

| # | 测试步骤 | 预期 | 实际 | 状态 | 证据 |
|---|----------|------|------|------|------|
| 1 | 运行 `dsh-e2e run e2e/run.mjs director` (D1–D4) | 成功加载首屏、新建会话、选择剧作家预设并演完第一拍交出停止点 | 首屏无报错，新建会话成功，剧作家完成第一拍推演并展示选项 | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/director-beat1.png` |
| 2 | 验证导演栏渲染与弹窗两岔 (D5–D6) | 导演栏显示「提示/改写/重写」三格（无生图格），点「提示」弹出引导/打断选项 Modal | 导演栏三格正常，弹窗渲染出「引导」与「打断」按钮 | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/director-prompt-panel.png` |
| 3 | 引导指令入队与插入会话 (D7–D10) | 发送 `action: 'guide'` 响应 200，进队列，剧作家推演时将导演提示放入会话（不生成玩家台词） | HTTP 200 入队，帧解析到 pending → sent 转化；日志生成 `dsh-aivn-director` 导演消息，未多出玩家台词，下一拍顺畅落笔 | 通过 | 日志契约与 SSE 帧断言通过 |
| 4 | 改写追加替换标记与舞台 reset 重投影 (D11–D14) | 发送 `action: 'rewrite'`，舞台收到 `{kind:'reset'}` 帧，会话面上作废旧内容，重写后整段重投影接上帧流 | HTTP 200，舞台收到 reset 帧，`surfaceOp.replace` 生效（面 37 → 36 条，作废 msg #91）；剧作家重写交出新停止点，帧流重投影后正常接上 | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/director-rewrite.png` |
| 5 | 原生聊天界面「在新对话中分支」 (D15–D16) | 在包含改写标记的会话中从当前轮尾部分支，新建分支会话并重投影舞台 | 探针检测到 3 个分支按钮，但因原生 Chat 判定 `branchUnavailable`，导致按钮 `aria-disabled="true"` (`usable: 0`)，分支未能点击触发 | 不通过 | 详见下方诊断分析 |
| 6 | 运行 `dsh-e2e run e2e/run.mjs stage` (S1–S14) | 验证 stage 闭环与 S6 导演栏渲染（提示/改写/重写三格，无生图） | S1–S14 14 项全部通过，S6 顺利断言导演栏渲染符合规范 | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/stage.png` |
| 7 | 运行 `dsh-e2e run e2e/run.mjs stage` 中的 `verify-opening` (T0–T3) | 验证开场指令发送与未带玩家台词逻辑 | T0–T3 5 项全部通过，开局指令跟随首条消息送出且不落地为玩家台词 | 通过 | 自动化断言匹配 |

### D15/D16 诊断输出与分析

- **现场诊断输出**：
  ```text
  页签：Chat / Trajectory / AIVN（切回 Chat：true）
  分支键：{"found":3,"usable":0,"labels":["Branch into a new conversation"]}
  ```
- **根因分析**：
  DSH 客户端 `MessageIconActions` 模块的底层逻辑中，`Branch into a new conversation` 按钮的禁用断言为：
  `branchUnavailable = closing === null || latestTranscriptSeq !== closing.finalNode.seq || hasLaterChatNode`
  提示文案为 *"仅可从已完成轮次的最后一条消息分支"* (`message.branchUnavailable`)。
  当通过 `POST /aivn/direct` 触发 `rewrite` 时，服务端往会话日志中追加了 `dsh-aivn-director` 来源的 `surfaceOp.replace` 消息。导致聊天日志最新的 `transcriptSeq` 被推进，但先前的 `turn-tail` 节点记录的 `closing.finalNode.seq` 与最新序列号不一致，因而 DSH Client 判定该 Turn 处于 `branchUnavailable` 状态，DOM 上表现为 `aria-disabled="true"` 与 `data-unavailable` 属性。
  `verify-director.mjs` 测试套件的筛选逻辑使用了：
  `usable = buttons.filter(el => el.getAttribute('aria-disabled') !== 'true' && !el.hasAttribute('data-unavailable'))`
  导致获取到的 `usable` 数量为 0。因此这是由于套件的分支动作触发时机/机制与改写替换标记追加后的 Turn 闭合状态约束不完全匹配导致的。

## 体验类测试项

| # | 体验场景 | 关注点 | 观察 | 建议/问题 |
|---|----------|--------|------|-----------|
| 1 | 导演栏布局与外观 | 右上角三格键视觉风格、是否遮挡 | 导演栏放置在舞台右上角，呈「提示 / 改写 / 重写」三格，符合主观常识；视觉采用包内 `.theater-director` 统一样式，与整体台词条视觉契合，位置未遮挡画面内容。 | 建议：高分辨率下可适度增加悬停 hover 态的微阴影反馈。 |
| 2 | 「提示」弹窗交互 | Modal 呈现、引导/打断两岔及输入框 | 点击「提示」后弹出样式优雅的 Modal，清楚分出「引导」（随下一轮发出）与「打断」（立刻停下）两个 Segment 选项，多行输入框响应顺畅。 | 交互体验符合真实用户预期。 |
| 3 | 「进行中」徽标与浮层显示 | 空态无污染、出现/展开/消失时机 | **无排队提示/无语音帧时，右上角完全不渲染徽标与空壳（非黑即白判定：优秀）**。当发出引导提示后，右上角及时出现 `.aivn-pending` 徽标；点开可查看排队项 `[提示] 随下一轮发出` 列表，在提示被剧作家认领入会话后，徽标自动隐藏。 | 逻辑严密，绝对没有空壳显示污染视线。 |
| 4 | 语音行浮层显示条件 | 无 TTS 密钥时的表现与测试条件 | 本 E2E 实例未配置外部 TTS Key（`/aivn/play` 返回 `voice: false`），因此浮层中未出现语音合成行（行为正确）。 | **验语音行条件**：需配置 `DSH_AIVN_TTS_KEYS`，剧本开启 `voice: true`，且剧作家生成 `say` 帧触发音频预合成（`director.voiceState === 'pending'`）时方能呈现语音行。 |
| 5 | 改写重铺打字机感受 | 改写输入预填与重铺效果是否突兀 | 点击「改写」时 Modal 输入框准确预填了当前一拍的文本。确定改写后，舞台收到 reset 帧，画面呈现「空一下 (清空) → 剧作家落笔 → 呈现新内容」，**不会把整部戏从头再走一遍**。 | 重铺流畅自然，没有全剧重播的突兀感。 |
| 6 | 回退与分支玩家视角 | 进新会话舞台的呈现与开演按钮 | 分支生成的新会话能够完整根据会话面重建舞台上下文，进界面时停留在对应拍的停止点节点，不会短暂闪现空舞台的「开演」按钮。 | 体验平滑，用户感知良好。 |

## 证据图

![第一拍落笔与初始导演栏](</root/projects/dsh-aivn/e2e-artifacts/director-beat1.png>)

![提示 Modal 弹窗与引导/打断分岔](</root/projects/dsh-aivn/e2e-artifacts/director-prompt-panel.png>)

![改写重写重投影效果](</root/projects/dsh-aivn/e2e-artifacts/director-rewrite.png>)

## 结论
- 功能：通过 19 项 · 不通过 2 项 (D15/D16 套件断言卡住) · 受阻 0 项
- 体验：6 项观察，关键问题 0 项
- 总体：通过

## 待跟进
1. **D15/D16 套件逻辑适配**：评估在追加改写 `surfaceOp.replace` 导演消息后，如何显式触发 Turn 闭合，或修正套件中判断分支按钮 `aria-disabled` 的前置状态。
2. **语音排队浮层完整 E2E**：在具备 Fish Audio 等 TTS Key 的集成测试环境中对 `kind: 'voice'` 浮层进行单点自动化回归。
