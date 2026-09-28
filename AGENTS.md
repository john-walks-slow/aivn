# stage-ai AGENTS.md

## 目标

AI galgame 引擎：LLM 剧作家（playwriter）流式输出 Stage DSL（XML 标签式）增量剧本，服务端解析为 IR 事件经 WS 下发，前端像流式视频一样边生成边演出。玩家兼具演员（入戏表态）与导演（OOC/编辑/分岔/重写四正交原语）双重身份。路线树 + 书签完全替代存读档。

需求计划与阶段（P0–P7）见 `docs/features/260928-stage-ai-mvp/260928-stage-ai-mvp.plan.md`——动手前必读对应章节。

## 地图

- `packages/core` —— 语言与契约层（P0 已落地）：DSL v1 冻结规范（`src/dsl/spec.ts`）、流式解析器（`src/dsl/parser.ts`）、StageEvent/SequencedEvent IR（`src/dsl/events.ts`）、WS 协议类型（`src/ws/protocol.ts`，hello 带 cast 角色名映射）、谱系数据模型（`src/lineage/model.ts`：行级事件日志唯一真相源、四原语、快照随分支走、export/load 持久化）
- `apps/server` —— playwriter 编排器（P1 已落地）：beat 生命周期与玩家动作路由（`src/orchestrator.ts`）、cpa 网关 provider（`src/provider.ts`，pi-ai openai-completions）、提示词装配（`src/prompt.ts`）、WS hub（`src/transport.ts`：resume 重放 + 重连 stoppedReplay）、剧目/会话存储（`src/store.ts`）；测试用 fake StreamFn 注入真实 agent loop（`test/orchestrator.test.ts`）
- `apps/web` —— 最小舞台文字直播（P1 已落地）：React 19 + vite；`src/stage/script.ts`（ScriptBuilder 事件聚合）、`useStageSocket.ts`（WS hook，revision 驱动滚底）、`StageView.tsx` / `StopPanel.tsx`（四行型 + 四停止点 + OOC）
- `plays/demo` —— 样例剧目（play.json 进 git；session.json/lineage.jsonl 运行时不进）

## 开发与调试

- 启动：`pnpm --filter @stage-ai/server start`（需根目录 `.env`：cpa 网关 STAGE_BASE_URL/STAGE_API_KEY/STAGE_MODEL_ID 等）+ `pnpm --filter @stage-ai/web dev`（:5180，/ws 代理 :8787）
- Node ≥ 22.19（pi-agent-core engines 要求），pnpm workspace
- `pnpm test` —— vitest（core 45 + server 7，测试范围按改动模块控制）
- `pnpm typecheck` / `pnpm build`（改 core 后须 rebuild，web/server 走 workspace symlink 的 dist 类型）
- 解析器改动必须保持撕裂等价性测试（chunk=1/2/3/5/7）与消息边界自动闭合用例全绿——这是 P0 冻结契约的回归线

## 规范

- **DSL v1 已冻结**（9 标签白名单 + stop 三类型）：改标签集 = 改计划文档先行，同步更新 spec.ts 与 golden 用例
- **谱系事件日志 append-only**：一切结构操作（分岔/编辑/重写）以追加事件表达，物化时重放；日志永不改写
- **四原语正交**（OOC/编辑/分岔/重写）：不隐式联动，组合权在用户；新增交互先对照计划 D10
- **beat 边界解析归编排器**（P1）：core 的 `recordRewrite` 只记粒度标注，`granularity="beat"` 时 nodeId 传节拍首行
- 剧目运行时数据不进 git（`plays/*/session.json`、`plays/*/lineage.jsonl`、`media-cache/`）；`play.json` 剧目定义进 git
