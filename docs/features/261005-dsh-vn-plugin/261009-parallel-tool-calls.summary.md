# 261009 并行工具调用：让「同一批并发」从提示词落成机制

**需求**：用户口述「要在合适的地方教：生成各种素材、调用工具都尽量并行」。

## 背景：一个被忽略的机制前提

DSH 的 agent loop 只在工具**自己声明**了 `isConcurrencySafe` 时才把它放进并行池；
不声明即 `exclusive`，在所属的一步里形成栅栏、逐个串行（`dsh-agent-loop` 的 `tool-calls`
调度器 + `dsh-tools` 的 `executionMode`，本机 `/usr/lib/node_modules/@deepseek-ai/dsh` 实测）。

而 dsh-aivn 的九个工具**一个都没声明**，于是在这次改动之前：

- 提示词/技能里写的「同一批里调 3 次（并行）」**不会真的并行**，等待照样叠加；
- 媒体层却是**按并发建的**——素材表与台账的读-改-写按路径加锁（`media/storage.ts`）、
  同一最终目标的出图按 inflight 去重（`media/generate.ts`，一批并发只补一次定妆照）、
  候选图落各自独立的随机 UUID 草稿目录，`e2e/verify-media.ts` 的 M22 还专门验「并发落库不互相覆盖」。
  README 早写着「一批并发只补一次」——设计意图一直是并发，只是开关没拨。

所以「教模型并行」这一步如果不补机制，教的就是一句假话（项目明令：别谎报能力）。

## 改了什么

**机制**（单一真相源在 `src/tool-catalog.ts`）：

- `ToolSpec` 新增**必填**字段 `concurrent`：逼每个工具显式做一次决定，不给默认值。
- 九项里八项 `true`；唯一 `false` 是 `set_stage_style`——它读-改-写 `theme.json` 且**没有锁**，
  并发会丢更新。
- `src/preset-tools.ts` 的装配把这一格落成工具定义上的 `isConcurrencySafe`
  （缺省即独占，所以独占的那个原样交回，不写恒 false 的分类器）。

**教学**（按「提示词地图」分层，每类知识只有一个家）：

| 层 | 位置 | 内容 |
| --- | --- | --- |
| persona（每轮契约） | `src/stagehand/prompt.ts`《对话风格》 | 「独立的工具调用放同一批」 |
| persona（每轮契约） | `src/playwriter/prompt.ts`《你怎么工作》 | 一轮开始前要读的几件事一次读回 |
| persona（指针章） | `src/playwriter/prompt.ts`《缺图怎么办》 | 真要补不止一张就同批发（原来只有「别连出好几张」） |
| skill（食谱） | `aivn-visual-craft` / `aivn-audio` / `aivn-play-setup` | 候选一批 3 张、几首曲子、构图单都写明「同一批」 |

**产物 / 文档**：`lib/` 重建；中英 README 的「Agent 工具」与「素材生成」各补一句；
`AGENTS.md` 的目录表补上 catalog 的并发职责。

## 证据

- `npm run typecheck` 通过。
- `npm run e2e:media`（离线、不占实例、无真 LLM）55/55：
  - **M45** 只有 `set_stage_style` 声明独占；
  - **M46** 搭台助手 persona 教「独立的工具调用放同一批」；
  - **M47** 剧作家前缀与尾段都教到；
  - **M48** 三份技能的素材食谱都写明「同一批」；
  - **M22**（既有）并发落库五首曲子后素材表与台账一条不少——机制侧的真并发耐受。

## 没做的 / 留给以后

- **没有每剧目生图并发闸门**：独立版 AIVN 有 `Limiter`（`STAGE_IMAGE_CONCURRENCY`，默认 6）。
  插件不搬它——DSH 自己的并行池上限是 10（`DEFAULT_MAX_PARALLEL_TOOL_CALLS`），
  且提示词已要求「张数克制」。真出现额度被一批打空的现场再加。
- **没跑实例套件**：改动不碰章标题与门控条件句，`verify-injection` / `verify-stagehand` 的既有锚点
  不受影响；跑它们要起第二个 dsh（本机内存紧张，当时另有一个 e2e 实例在跑），故只跑离线套件。
  装配那一行的风险由 typecheck 覆盖（未引入任何新 import）。
