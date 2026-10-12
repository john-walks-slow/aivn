# 检视报告

## 概要

检视了当前全部未提交改动：`StageTheater` 插槽、`PromptQueuePanel` 两种呈现、`StageScreen` 宿主接线、相关样式/测试、模块指引及本功能计划和小结。上一轮两条阻塞均已按预期修复；需求与宽屏/手机落点裁决一致，未发现新的准入阻塞。

## 需求对齐

满足“将 pending panel 指示符和触发器移入台词条原 spinner 槽位，并通过点击该处展开”的要求：宿主仅在队列或任务有内容时传入 dialog 组件；`StageTheater` 的 `null` 回退到 spinner；展开内容 portal 到 body 并按芯片实测位置定位。工坊仍走 dock 变体。宽屏保留原 spinner 左侧位置、手机随底缘布局落右侧，符合计划记载的裁决。

B1 已修复：`hasPendingWork(items, jobs)` 由宿主用于决定是否传组件，且舞台层 `dialogStatus ?? spinner` 保留 null 回退；新增了空任务不渲染及 spinner 回退测试。B2 已修复：portal 面板根统一停止 click/touch 事件，测试覆盖面板空白、详情和清除操作；触发芯片也阻止舞台事件。计划中所述“展开时芯片保留、摘要重复及面板覆盖部分台词”属于明确记录的设计取舍，不作为缺陷。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | [PromptQueuePanel.tsx:102](/root/projects/stage-ai/.worktrees/pending-in-dialog/apps/web/src/stage/PromptQueuePanel.tsx:102), [pendingPanel.test.tsx:170](/root/projects/stage-ai/.worktrees/pending-in-dialog/apps/web/test/pendingPanel.test.tsx:170) | 现有测试确认了 portal 落在 body、收起后移除，但没有覆盖锚点坐标的计算、窗口边缘避让和滚动/resize 后重定位。定位属于这次新增的核心交互，若 CSS 变量方向或视口坐标换算被改坏，当前单测仍会通过。 | 为芯片提供可控的 `getBoundingClientRect()`，断言 `--chip-x`/`--chip-y`；再覆盖一次滚动或 resize 后坐标更新，并断言靠右芯片时面板左边界受视口宽度约束。 |
| S2 | [PromptQueuePanel.tsx:136](/root/projects/stage-ai/.worktrees/pending-in-dialog/apps/web/src/stage/PromptQueuePanel.tsx:136), [app.css:5719](/root/projects/stage-ai/.worktrees/pending-in-dialog/apps/web/src/app.css:5719) | 收起芯片是主要键盘入口，但样式没有在该按钮上显式给出 `:focus-visible` 焦点反馈；如果全局 button 样式重置浏览器 outline，键盘用户可能无法辨认当前焦点。测试也未覆盖键盘焦点。 | 确认全局样式保留可见焦点环；若无统一规则，为芯片补主题一致的 `:focus-visible` 样式，并加一条焦点反馈回归断言。 |

## 非阻塞问题

无。

## 准入结论

**结论**：`条件准入`

**说明**：原有 spinner 回退与 portal 冒泡两项阻塞已消除，功能路径和既定落点符合需求，可进入合并/交付阶段。建议补齐锚点定位自动化覆盖，并确认触发芯片的键盘焦点样式由全局规则可靠提供。
