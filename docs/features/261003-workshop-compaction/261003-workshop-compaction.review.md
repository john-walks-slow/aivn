# 检视报告

## 概要

本次检视覆盖「工坊线程上下文自动压缩」全链路实现，包括：服务端计量/切点/标定纯函数（`compaction.ts`）、摘要生成与 A 区提示词注入（`workshop.ts`）、线程元数据持久化（`workshopThreads.ts`）、会话并发保护与压缩执行（`workshopSession.ts`）、多模型独立环境变量与校验（`config.ts`、`playhouse.ts`）、WS 协议（`protocol.ts`）、前端状态机与对话流折叠分隔栏（`useWorkshop.ts`、`WorkshopPane.tsx`、`app.css`）以及全套单元与端到端测试。整体评价：架构设计合理，遵循单一职责与实用主义，测试覆盖严密，代码整洁健壮。

## 需求对齐

完全对齐计划文档（`261003-workshop-compaction.plan.md`）的核心指标与业务约束：

1. **历史完整性**：消息原文一条未删，压缩仅推进线程元数据的 `cutAt`，用户端历史可见性完全保留。
2. **状态隔离**：摘要作为搭台过程事实仅落盘于 `threads.json`，并通过 A 区直接注入，未污染剧作家专用的 `memory/arcs` 剧情记忆。
3. **计量同尺**：复用了 provider 实测 usage 对本地字符估算系数的 scale 标定，解决了中文下 chars/4 严重低估的问题。
4. **独立配置**：支持 `STAGE_WORKSHOP_*` 环境变量与工坊独立模型窗口取小，并在启动时进行了越界交叉校验。
5. **故障降级**：摘要请求失败时告警跳过、不切上下文、不中断本轮对话，符合优化不阻塞主链路原则。
6. **方案演化说明**：计划文档初稿提及的 `mergeDigest(prev, next)` 在实现中优化为 `capDigest(digest.body)`，原因是新一轮摘要是由模型基于「旧定稿 + 新增转录」重写成完整定稿而非物理累加拼接，避免了历史噪音膨胀，调整符合设计意图。

## 阻塞问题

无

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-01 | `apps/web/src/workshop/WorkshopPane.tsx:234`<br>`apps/web/src/app.css:2576` | `.chat-divider` 的摘要 `<span>` 未设置文本溢出截断（ellipsis）。模型输出的一句话摘要最长可达 60 字，在工坊面板被拖窄或移动端/窄屏抽屉视图下，中间长文本会将两端的 `::before`/`::after` 分隔线挤占至 0 甚至换行溢出，破坏居中分隔线的视觉效果。 | 建议在 `app.css` 中为 `.chat-divider span` 增加单行省略样式，如 `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;`。 |
| SUG-02 | `apps/web/src/workshop/WorkshopPane.tsx:64` | `digestOpen`（展开/折叠摘要正文）为组件级状态，切换活动线程（`activeId` 变更）时未复位。若用户在线程 A 展开查看了详细摘要，切换到已有压缩记录的线程 B 时将默认处于展开态，影响阅读体验。 | 建议在 `activeId` 或 `threadId` 变化时（如在对应的 `useEffect` 或切换处理函数中）执行 `setDigestOpen(false)`。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| ADV-01 | `apps/web/src/workshop/WorkshopPane.tsx:231` | 计划文档中建议的分隔按钮结构包含 `<Icon name="archive" size={12} />` 图标，实际代码中仅渲染了纯文本，视觉层级稍弱，且与全站统一使用 `Icon.tsx` 的规范略有脱节。 | 备忘：后续 UI 润色时可补齐 `archive` 图标。 |
| ADV-02 | `apps/server/src/workshopSession.ts:190` | `chat()` 收束更新 `turn.scale` 时，执行了 `await this.threads.update(active.id, { tokenScale: turn.scale })`，但未同步更新内存中的 `active.tokenScale` 属性。由于 `chat()` 内部此后未再读取该局部对象，且后续调用会重新读索引，功能上无影响，但保持内存与存储一致更符合直觉。 | 备忘：可在 `update` 处顺手赋上 `active.tokenScale = turn.scale`。 |
| ADV-03 | `apps/server/src/compaction.ts:322` | `DIGEST_MAX_CHARS = 6000` 约折合 1500~2000 token。当前主流模型（128k 窗口）下完全安全；但若未来工坊挂载超小窗口模型（如 8k/16k）时，固定的 6000 字回注可能占比较高。 | 备忘：目前约束与环境完备，无需过度设计；后续如有超紧凑模型支持需求，可考虑上限与 `contextWindow` 挂钩。 |

## 准入结论

**结论**：`条件准入`

**说明**：实现完整满足设计要求，计量与切点算法严密，并发保护及异常降级处理到位，测试用例详实，文档已同步。无阻塞性问题，建议在合并前或后续小迭代中补充前端窄屏文字截断与折叠状态复位。
