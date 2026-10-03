# 剧作家主动进入/退出限制级（NSFW）剧情分支 实施总结

## 需求背景与交付目标

为了让视觉小说演出在推进到成人/亲密接触剧情时拥有高质量、细腻的情感与感官描写，同时避免日常商用主模型遭遇安全审核拒答或上下文污染，新增了剧作家主动进入/退出限制级（NSFW）剧情的工具与整套上下文隔离机制。

---

## 核心实现与架构设计

1. **双工具契约与装配（`enter_nsfw` / `exit_nsfw`）**：
   - 剧作家主动决策何时进入与退出，`exit_nsfw` 明确支持并推荐与 `beat_done` 在同一批次工具调用中一同发出；
   - 注册于 `apps/server/src/agentkit/nsfwTool.ts`，归属 `beat` 工具组，剧作家默认启用，搭台助手不装配。

2. **限制级专用模型与提示词**：
   - 全局支持 `STAGE_NSFW_MODEL_ID` 与 `STAGE_NSFW_PROMPT`（`.env`）；
   - 剧目级支持 `play.json` 的 `agents.playwriter.nsfwModel`、`nsfwThinking` 与 `nsfwPrompt`；
   - 提示词动态注入限制级创作指南与剧目 `memory/always/nsfw.md`；
   - 构建限制级 Agent 时，向消息历史前置注入虚拟合规轮次（`NSFW_PRE_TURNS`），声明所有角色实际生理与心理年龄均在 20 岁以上（above 20），具备完全民事行为能力与知情同意。

3. **SFW 摘要生成与主模型上下文隔离**：
   - 退出限制级通道时，自动汇总期间的全部台词切片，调用轻量补全任务提取 1-3 句含蓄、高雅、纯全年龄（SFW）的剧情进展摘要；
   - 切回主模型时，从主模型上下文消息历史中彻底剥离所有限制级露骨台词，并在进入限制级前的历史末尾正序追加 SFW 摘要过渡轮次（user 提要 + assistant 确认接续），保持严谨连贯的时间线；
   - 主模型后续只接触全年龄摘要，彻底消除模型拒绝与审核拦截风险；前台演出与谱系完整记录所有台词与事件。

4. **生命周期与并发安全**：
   - 谱系快照（`MemorySnapshot`）记录节点 `nsfw` 状态；故事树跳转（`jumpTo`）或分岔（`forkTo`）时自动依据目标节点快照复位 `nsfwActive`，重置 pending 与切片缓存，杜绝跨分支状态滞留；
   - 编排器空闲判断 `engaged` 正式纳入异步 SFW 摘要切换任务，并在切换完成时及时触发 `flushIdleWaiters`，彻底消除异步微任务覆盖 Agent 实例的竞态风险。

5. **前后端设置面板**：
   - 工坊「Agent」设置页（`AgentPane.tsx`）剧作家卡片提供限制级专属模型与思考档位配置；
   - 全局「设置」页（`SettingsScreen.tsx`）模型网关区域提供全局默认限制级专用模型选择器。

---

## 验证与评审结果

- **测试用例**：
  - 核心模块全量单元测试（`test/agentkit.test.ts`、`test/nsfwTool.test.ts`、`test/orchestrator.test.ts`、`test/config.test.ts`、`test/prompt.test.ts` 等）102/102 全部通过。
- **代码审查**：
  - 由 `reviewer` 专家子代理进行全面检视，两轮修复后结论为**准入**。

---

## 变更文件列表

- `packages/core/src/play/config.ts`：AgentSettings 新增 `nsfwModel`/`nsfwThinking`/`nsfwPrompt` 字段及针对剧作家的守卫解析
- `packages/core/src/lineage/model.ts`：MemorySnapshot 新增 `nsfw?: boolean` 字段
- `apps/server/src/config.ts`：ServerConfig 新增 `nsfwModelId`/`nsfwPrompt` 解析
- `apps/server/src/configApi.ts`：SettingsFile 读写支持 `STAGE_NSFW_MODEL_ID`/`STAGE_NSFW_PROMPT`
- `apps/server/src/memory.ts`：PlayMemory 新增 `nsfw` 属性读取 `memory/always/nsfw.md`
- `apps/server/src/agentkit/nsfwTool.ts`：新增 `enter_nsfw` 与 `exit_nsfw` 工具实现
- `apps/server/src/agentkit/deps.ts`：PlaywriterKitDeps 增加 NSFW 回调与状态判定接口
- `apps/server/src/agentkit/role.ts`：剧作家角色工具安装清单中增加 `enter_nsfw`/`exit_nsfw`
- `apps/server/src/agentkit/kit.ts`：工具目录注册与剧作家默认集启用 `enter_nsfw`/`exit_nsfw` 并装配
- `apps/server/src/prompt.ts`：buildSystemPrompt 增加限制级指引、合规口径注入与同批调用规则对齐
- `apps/server/src/orchestrator.ts`：编排器 NSFW 状态管理、合规前置轮次注入、SFW 摘要生成与时间线正序拼接、分支跳转快照复位、`engaged` 竞态闭环
- `apps/server/src/playhouse.ts`：创建编排器时解析注入 `nsfwModel`/`nsfwThinking`/`nsfwPrompt`
- `apps/web/src/api.ts`：Settings 声明补齐 `nsfwModelId`/`nsfwPrompt`
- `apps/web/src/views/SettingsScreen.tsx`：全局设置页模型网关区域增加 NSFW 专用模型选择器
- `apps/web/src/workshop/AgentPane.tsx`：剧作家设置卡片增加限制级专用模型与思考档位配置
- `apps/server/test/nsfwTool.test.ts`：新增限制级工具契约与合规轮次单元测试
- `apps/server/test/agentkit.test.ts`：更新剧作家工具暴露面断言
- `apps/server/test/orchestrator.test.ts`：新增限制级模式流转、SFW 摘要切回与分支跳转状态复位测试
