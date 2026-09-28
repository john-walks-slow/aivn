# stage-ai AGENTS.md

## 目标

AI galgame 引擎：LLM 剧作家（playwriter）流式输出 Stage DSL（XML 标签式）增量剧本，服务端解析为 IR 事件经 WS 下发，前端像流式视频一样边生成边演出。玩家兼具演员（入戏表态）与导演（OOC/编辑/分岔/重写四正交原语）双重身份。路线树 + 书签完全替代存读档。

需求计划与阶段（P0–P7）见 `docs/features/260928-stage-ai-mvp/260928-stage-ai-mvp.plan.md`——动手前必读对应章节。

## 地图

- `packages/core` —— 语言与契约层（P0 已落地）：DSL v1 冻结规范（`src/dsl/spec.ts`）、流式解析器（`src/dsl/parser.ts`）、StageEvent/SequencedEvent IR（`src/dsl/events.ts`）、WS 协议类型（`src/ws/protocol.ts`）、谱系数据模型（`src/lineage/model.ts`：行级事件日志唯一真相源、四原语、快照随分支走、export/load 持久化）
- `apps/`（P1+）—— server（pi-agent-core playwriter 编排器）与 web（React 19 渲染层）

## 开发与调试

- Node ≥ 22.19（pi-agent-core engines 要求），pnpm workspace，TypeScript project references
- `pnpm test` —— vitest（解析器 golden 用例 + 谱系模型用例，测试范围按改动模块控制）
- `pnpm typecheck` / `pnpm build`
- 解析器改动必须保持撕裂等价性测试（chunk=1/2/3/5/7）与消息边界自动闭合用例全绿——这是 P0 冻结契约的回归线

## 规范

- **DSL v1 已冻结**（9 标签白名单 + stop 三类型）：改标签集 = 改计划文档先行，同步更新 spec.ts 与 golden 用例
- **谱系事件日志 append-only**：一切结构操作（分岔/编辑/重写）以追加事件表达，物化时重放；日志永不改写
- **四原语正交**（OOC/编辑/分岔/重写）：不隐式联动，组合权在用户；新增交互先对照计划 D10
- **beat 边界解析归编排器**（P1）：core 的 `recordRewrite` 只记粒度标注，`granularity="beat"` 时 nodeId 传节拍首行
- 运行时数据（`plays/`、`media-cache/`）不进 git
