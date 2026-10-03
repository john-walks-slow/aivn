# 剧作家主动进入/退出限制级（NSFW）剧情分支 验证指南

## 验证目的

验证剧作家主动调用 `enter_nsfw` 进入限制级通道、调用 `exit_nsfw`（支持与 `beat_done` 同批发出）退出通道、专用模型与思考档位切换、前置合规轮次（above 20 声明）注入、以及退出时全年龄 SFW 摘要生成与主模型上下文隔离净化等功能。

---

## 自动化测试覆盖

以下核心场景已通过自动化单元测试覆盖（耗时约 4 秒）：

```bash
pnpm --filter @stage-ai/core test
pnpm --filter @stage-ai/server test test/agentkit.test.ts test/nsfwTool.test.ts test/orchestrator.test.ts test/config.test.ts test/prompt.test.ts
```

- **工具注册与可用性**（`test/agentkit.test.ts`）：验证剧作家角色工具目录及默认启用集中包含 `enter_nsfw` 与 `exit_nsfw`，搭台助手（workshop）不可用。
- **工具行为契约**（`test/nsfwTool.test.ts`）：
  - 验证 `enter_nsfw` 与 `exit_nsfw` 的调用参数与重复调用保护；
  - 验证 `NSFW_PRE_TURNS` 合规前置轮次的声明文本与角色确认。
- **端到端流程与上下文净化**（`test/orchestrator.test.ts`）：
  - 模拟剧作家调用 `enter_nsfw`，下一轮自动注入限制级系统提示词与合规前置轮次；
  - 模拟限制级描写完结时同批调用 `exit_nsfw` + `beat_done`；
  - 验证切回主模型后，主模型上下文中彻底清除了露骨台词，并在历史末尾正序追加了 SFW 全年龄含蓄摘要过渡轮次；
  - 验证从限制级分支跳转或分岔回普通日常节点时，NSFW 状态彻底复位为 `false`，不出现跨分支状态污染。

---

## 用户实机验收场景

### 场景 1：工坊 Agent 设置页配置限制级专用模型
1. 启动服务并在浏览器访问工坊（例如打开任一剧目，进入「工坊 → Agent」标签页）。
2. 在「剧作家」卡片中，查看是否显示「限制级（NSFW）专用模型」与「限制级（NSFW）思考档位」选择器。
3. 选择一个可用模型（或保持空值跟随主模型），选择思考档位，点击保存。
4. 检查剧目 `play.json` 的 `agents.playwriter` 段已正确持久化 `nsfwModel` 与 `nsfwThinking`。

### 场景 2：全局设置页配置默认限制级专用模型
1. 在网页端进入全局「设置」页面（点击侧边栏或主界面设置按钮）。
2. 在「模型网关」区域，查看是否出现「限制级（NSFW）专用模型」下拉选择器。
3. 选择一个模型并保存，检查 `.env` 文件中已正确写入 `STAGE_NSFW_MODEL_ID`。

### 场景 3：演出中模式自动流转与 SFW 摘要切回
1. 在剧目演出中引导角色进入亲密情节（或通过剧作家提示词/剧本触发 `enter_nsfw`）。
2. 观察限制级期间剧情描写细腻展开，台词与立绘表情正常流转演出。
3. 亲密情节完结时，模型调用 `exit_nsfw` 并收束本轮。
4. 观察下一轮日常无缝接续，主模型正常创作后续日常剧情，未发生审核拒答或上下文崩坏。
