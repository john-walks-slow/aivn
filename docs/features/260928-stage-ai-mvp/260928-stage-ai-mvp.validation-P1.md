# stage-ai MVP 用户验证（P1：核心闭环）

## 验证说明

- 验证对象：P1 交付——pi-agent-core playwriter 编排器（apps/server）+ 最小舞台文字直播（apps/web）+ 样例剧目《黄昏的走廊》（plays/demo）
- 环境/前置条件：`.env` 配置 cpa 网关（STAGE_BASE_URL/STAGE_API_KEY/STAGE_MODEL_ID）；`pnpm --filter @stage-ai/server start` + `pnpm --filter @stage-ai/web dev`
- 说明：Agent 已用真实 LLM（DeepSeek-V4.1-Flash via cpa）+ 浏览器完成全链路初筛（七条路径，见 summary）；下表为用户抽查复验项。

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- |
| 起 server + web，浏览器开 `http://127.0.0.1:5180` | 首拍自动开演：场景条→旁白→台词逐字流出（打字机感），顶栏「演出中」 | | 待验证 | Agent 初筛：首拍 ~9s 出全 |
| 等 choice 停止点，点一个选项 | 顶栏变「等待你的回应」，选项按钮可点；点击后新拍开演 | | 待验证 | 初筛 3 选项形态 |
| 点「导演备注」输入即时指令（如「下一拍让角色提到天文社」）发送 | OOC 注入，下一拍体现指令意图 | | 待验证 | 初筛两次 OOC 均生效 |
| free 停止点输入自由回应回车 | 玩家台词并入剧本，续演 | | 待验证 | |
| 演出中刷新页面（F5） | 台词流与停止点面板完整恢复（全量 resume 重放） | | 待验证 | 初筛 95 行 + choice 面板恢复 |
| 视觉风格 | plain / clean / 浅色 / 实用：白底黑字灰层级、系统字体、无花哨动画 | | 待验证 | 用户指定风格 |

## 验证结论

待验证。

## 待跟进

无。
