# 检视报告

## 概要

本次检视覆盖 `feat/mode-badges` 分支（提交 `ff0c92b` 与 `2a80028`）关于舞台左上角常驻模式标识（限制级通道 / 静音 / 自动）的完整实现。整体架构清晰，服务端广播口径与事件打标严格同源，生命周期流转缜密；协议向后兼容；前端组件无冗余状态。无阻塞性问题，但在窄屏 CSS 避让策略与关键边缘分支的测试覆盖上存在优化空间，综合评估为条件准入。

## 需求对齐

本次变更完全满足需求原意并对齐了前期决策：
- 未侵入 pending 队列，独立作为舞台内容区左上角常驻标识（限制级通道 / 静音 / 自动）；
- 仅展示当前活跃模式，不承载操作开关；三者全关时不渲染任何 DOM，避免产生空 chrome；
- 纵向位置让开了左上角侧栏唤出键（`top: 60px` vs 唤出键 `8~46px`），宽屏下与右上角排队面板保持水平平齐。

---

## 阻塞问题

无。

---

## 建议修改

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| S-01 | [app.css:5070-5075](apps/web/src/app.css#L5070-L5075) | **窄屏避让策略导致无标识时的多余空洞，且收起态徽标过度下移**：<br>1. 当三种模式全关时（常规剧目的常见常态），`StageModes` 为空不渲染，但窄屏下排队面板与徽标仍被无条件推至 `top: 96px`，右上角留下 36px 突兀空白；<br>2. 收起态徽标 `.prompt-queue-badge` 宽度仅约 50~60px，即便左上角标识全开（约 175px），在 360px 屏宽下横向仍有 >100px 安全间距，根本不会重叠，下移破坏了紧凑性。 | 1. 窄屏媒体查询中移除 `.prompt-queue-badge` 的下移，仅针对展开态面板 `.prompt-queue`；<br>2. 建议通过父容器状态类（如舞台容器探测是否有模式激活）或兄弟选择器（`.stage-modes ~ .prompt-queue`），仅在「同时存在模式标识且展开面板」时下移。 |
| S-02 | [orchestrator.test.ts:1596](apps/server/test/orchestrator.test.ts#L1596) | **缺少 `cancelBeat`（腰斩）与回跳限制级节点的关键分支测试**：<br>代码在 `cancelBeat()` 与 `restoreBranchState()` 中特意补充了 `this.broadcastNsfw()` 防范状态滞留，但现有单测未覆盖：<br>1. 请求进入限制级后调用 `cancelBeat()`，断言是否收到 `{ type: "nsfw", active: false }`；<br>2. 从日常节点 jumpTo 回限制级节点，断言是否收到 `{ type: "nsfw", active: true }`。 | 在 `apps/server/test/orchestrator.test.ts` 中补充 `cancelBeat` 与逆向跳转的分支断言，巩固守卫核心不变式。 |
| S-03 | [stageModes.test.tsx](apps/web/test/stageModes.test.tsx) | **前端缺少 WebSocket 消息与连接状态的集成测试**：<br>当前仅有 `StageModes` 组件的纯 UI 渲染单元测试，缺少 `useStageSocket` 对 `hello.nsfw` 的初始化、增量 `{ type: "nsfw", active }` 的响应，以及换周目/重连时的刷新测试。 | 参考 `apps/web/test/stageFresh.test.tsx` 的 `FakeSocket`，补充针对 `useStageSocket` 中 `nsfw` 字段状态流转的单元测试。 |

---

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| N-01 | [app.css:5010](apps/web/src/app.css#L5010) | **横屏左侧安全区适配**：`.stage-modes` 的定位为固定 `left: 12px`，在横屏且左侧带刘海/打孔的设备上可能贴边或受遮挡。 | 可优化为 `left: max(12px, env(safe-area-inset-left, 0px))`，与项目其他横向安全区策略保持一致。 |
| N-02 | [app.css:5014](apps/web/src/app.css#L5014) | **多行换行重叠隐患备忘**：`.stage-modes` 设置了 `flex-wrap: wrap`。若后续扩展更多模式或用户开启大字号无障碍缩放，多行时总高度超过 96px 仍有与排队面板重叠风险。 | 长期来看，可考虑将顶栏 HUD 的左右两组浮层统合进统一的 Flex 容器排布，避免绝对定位硬编码像素偏移。 |

---

## 准入结论

**结论**：`条件准入`

**说明**：核心业务逻辑严密，状态广播口径与事件打标同源且生命周期处理周全，协议向后兼容；建议在合入前或后续迭代中优化窄屏排队面板的避让触发条件（消除无标识时的空洞与收起态徽标误下移），并补全 `cancelBeat` 等边缘场景的单测覆盖。
