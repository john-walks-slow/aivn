# 后台 / 异步「记忆整理 agent」调研报告

> 调研日期：2026-10-04
> 调研问题：长期运行的 AI agent 系统中，「后台或异步的记忆整理」（把写记忆卡从主循环里拿出来，交给演出之外的 agent 去做）这一模式，业界与学术界已有哪些成熟做法、踩过哪些坑、有没有实测数据。
> 调研方式：本地聚合搜索（degoog：Brave + DuckDuckGo + Google CSE + Wikipedia）+ 语义搜索（exa）+ 原文抓取。约 30 轮检索、约 30 篇原文抓取。多数材料为 2026 年（与今天同期），部分为 2025 年。
> 立场说明：本报告只做事实汇总与来源标注，不代替主线做取舍判断。凡是**没找到可靠材料**的地方，在文末 §10 明说，不用推测填充。
> 姊妹文档：`docs/freeform/261004-longform-memory-sota.research.md`（长篇 RP 记忆系统 SOTA，含 AI Dungeon / SillyTavern 世界书 / 三层记忆综述）。本报告**不重复**那份文档已覆盖的内容，只做交叉引用；重心放在「谁在后台写记忆」这一动作本身。

---

## 0. 术语对齐

| 术语 | 本报告中的含义 |
|---|---|
| **后台记忆整理 / background curation** | 演出（主对话循环）之外，由一个独立的 LLM 调用或 subagent 读取历史、产出或改写记忆的整个过程 |
| **sleep-time compute** | Letta/UC Berkeley 论文提出的概念：在与用户交互的**间隙**做推理，把结果写回上下文，降低 test-time 计算 |
| **dreaming / dream** | Anthropic（Claude Managed Agents、Claude Code AutoDream）与 OpenAI（ChatGPT Dreaming V3）对「后台记忆整理」的产品命名 |
| **consolidation** | 把新增信息与既有记忆合并、去重、解决冲突的过程；各家的关键分歧点在「是否重写既有条目」 |
| **curator（策展者）** | 学术用词，指那个做整理的 agent，与面向用户的 task agent 相对 |
| **append-only vs rewrite** | 只追加不修改 vs 允许重写/替换既有记忆条目，是两条路线最本质的分野 |
| **branch / rollback** | 一个世界存在多条互斥时间线时的分流与回退（分支、检查点、编辑重生成） |

---

## 1. 已知系统与做法逐家清单

### 1.1 Letta / MemGPT —— sleep-time agent（把「谁的上下文」讲得最清楚的样本）

**论文（arXiv 2504.13171, Sleep-time Compute: Beyond Inference Scaling at Test-time，Letta + UC Berkeley）**

- 动机：现有 test-time compute 假设问题是**无状态**的，相关查询对同一份 context 反复做冗余推理。现实中很多应用是**有状态的**（文档问答、编码 agent、对话助手）。
- 做法：在模型「空闲」时（用户两次输入之间），用模型对现有 context 生成一份**新的 context**（关于现状的推理结论），test-time 时直接把它塞进 prompt。
- 实测结果：
  - 在 Stateful GSM-Symbolic 与 Stateful AIME 上，**达到同等准确率所需的 test-time compute 减少约 5×**（"reducing the test-time compute needed to achieve the same accuracy by ~5×"）。
  - 通过扩大 sleep-time compute，准确率还能**再涨 13%（GSM-Symbolic）/ 18%（AIME）**。
  - 提出 Multi-Query GSM-Symbolic：对同一 context 的多个相关查询**摊销** sleep-time compute，降低平均每查询成本。
  - 关键发现：**sleep-time compute 的效果与「用户查询的可预测性」高度相关**（predictability of the user query well correlated with efficacy）。查询越难预测，收益越小。
  - 另做了一个真实 SWE agent 任务的案例研究。
- 来源：<https://arxiv.org/html/2504.13171v1>、<https://arxiv.org/pdf/2504.13171>、<https://github.com/letta-ai/sleep-time-compute>、<https://www.letta.com/blog/sleep-time-compute>

**工程实现细节（Letta）**

- Letta 建 sleep-time agent 时，底层**实际创建两个 agent**：primary（面向用户、有对话与检索工具，但**没有编辑自己 core memory 的工具**）与 sleep-time（**持有编辑 primary 上下文记忆的工具**）。
- 官方动机原文要点：MemGPT 把记忆管理、对话和其他任务捆在一个 agent 里，导致**更慢**（对话中要调记忆操作）也**更不可靠**；卸载到 sleep-time agent 后**整理可异步进行**，且「MemGPT 的记忆形成是增量的，时间久了会杂乱无章」，sleep-time agent 能持续产出干净、简洁、详细的记忆。
- **模型可不同**：primary 用快模型（如 gpt-4o-mini），sleep-time 用更强更慢的模型（gpt-4.1 / Sonnet 3.7），因为 sleep-time 不受延迟约束。
- **频率可配**：`sleeptime_agent_frequency` 控制多少条消息触发一次；**默认通常为 10**。官方文档原话：「frequency 越高，你的 agent 消耗的 token 越多，但 agent 有更多时间修正它学到的 context。」
- **触发条件是两个都要满足**：`interval_seconds` **与** `min_messages` 必须同时达成才触发。
- **已记录的坑（官方 gotchas 仓库）**：`sleeptime_agent_frequency` **必须嵌在 `manager_config` 里**；作为顶层参数传给 `groups.update()` 会被**静默忽略**（"No error - the change is silently ignored"）。这是「配置不生效且不报错」的典型事故。
  来源：<https://github.com/letta-ai/ezra/tree/main/examples/gotchas/07-sleeptime-frequency>
- **2026 的 MemFS + Dreaming 形态**（Letta docs「Memory & dreaming」）：
  - agent 用 **MemFS——一个 git-backed 的记忆文件系统**，记忆跨会话共享。
  - `/init` 引导初始化（会检查仓库、必要时问工作习惯，并**用 subagents 复盘既往编码会话**）；
  - `/remember` 显式教学；`/doctor` 审计**放置（placement）、重复（duplication）、system prompt token 占用**；
  - **Dreaming 用后台 subagent 复盘近期对话、合并有用经验、更新记忆，不打断正在进行的工作**；
  - 触发时机可选：「**每完成 N 个 agent step 后**」或「**当上下文窗口被压缩时**」（后者与 stage-ai 的**纪元压缩**是同一时机）；
  - 可选 **`Agent reviews before applying`**：用**第二个后台对话**先审阅和修订提议的记忆变更——**「这会消耗更多模型 token，并且不会请求你批准」**（原文：This uses more model tokens and does not ask you for approval）；
  - 大规模整理时「**先备份当前仓库**再拆分大文件、合并重复项、重构层级」。
  - 来源：<https://docs.letta.com/configuration/memory>、<https://deepwiki.com/letta-ai/letta-python/12.3-sleeptime-agents>

**Letta 深处的机制**：sleep-time agents 作为**后台线程运行，与 primary agent 共享记忆**（"background threads that share memory with primary agents"）——即**同一份记忆被两个执行体读写**，这是并发风险的结构性来源。DeepWiki 描述其处理 memory compaction、archive management 等维护操作。

---

### 1.2 Anthropic —— 三条独立的产品线（Dreams / AutoDream / Memory Stores）

#### (a) Claude Managed Agents「Dreams」（研究预览，beta header `dreaming-2026-04-21`）

这是**本调研里对「后台记忆整理」这个动作定义得最精确的官方文档**。

- 动机原文：agents 边工作边写 memory store，但**这些写入是本地的、增量的**；跨多次 session 后，「memory store 会积累重复项、矛盾项与过期条目」。
- 做法：**一个 dream 是一份异步 job**，输入恰好两类：
  1. 一个**既有的 memory store**（Claude 要校验、去重、重组的那份）；
  2. **1 到 100 个 session**（过去的完整 transcript，Claude 从中挖掘模式与洞见并折进输出）。
- 产出：**一份新的 output memory store**——「重复项合并、过期或被矛盾的条目用最新值替换、并浮现新的洞见」。
- **最值得注意的设计约束（非破坏性）**：
  - 「**输入 store 永不被修改**，所以你可以审阅输出，不喜欢就丢弃。」（"The input store is never modified, so you can review the output and discard it if you don't like the result."）
  - 更强表述：「**dream 本身永不删除或修改它的输入**。」
  - 失败语义：`failed` 或 `canceled` 的 dream，其 output store 会被……（原文此处被截断，但 memorylake 的解读指出：**取消/失败的 dream 会故意留下部分 output store 在原地**，需要你自己清理）。
- 模型可选：预览期支持 `claude-opus-5`、`claude-fable-5`、`claude-opus-4-8`、`claude-opus-4-7`、`claude-sonnet-5`、`claude-sonnet-4-6`。可传 `instructions` 给整理过程**加方向**（官方示例：「Focus on coding-style preferences; ignore one-off debugging notes.」）。
- 计时字段是公开的：dream 资源带 `status`（pending → running → …）、`created_at`、`ended_at`、`usage{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`、`error`。**即 token 消耗是可审计的。**
- 坑（memorylake 整理）：**任一 input store 或 session 失败会导致整个 dream 失败**；`running` 状态下 `outputs[]` 会有一小段时间是空的（要等 workflow 克隆完输入 store 才出现 output store id）；**精确编辑要用 Memory Stores API，dream 只做重塑不做精修**。
- 来源：<https://platform.claude.com/docs/en/managed-agents/dreams.md>、<https://www.memorylake.ai/en/blogs/claude-dreams-memory-store>、<https://claude.com/blog/new-in-claude-managed-agents>、<https://techsifted.com/posts/anthropic-dreaming-agents-may-2026/>

**官方给的「可控性」说法**（claude.com 博客）："You decide how much control you want: dreaming can update memory automatically, or you can review changes before they land."

#### (b) Claude Code「AutoDream」（后台 subagent，2026-03 起灰度）

- 一句话：**一个后台 sub-agent，在 session 之间整合 Claude Code 的记忆文件**。命名刻意对标生物记忆在 REM 睡眠期的整合。
- **触发**：**每 24 小时，且已累积 5 个以上 session**。
- **硬约束**：保持 `MEMORY.md` 索引 **在 200 行以内**（Claude Code 每 session 开头只加载前 200 行，超出被截断）。
- 四阶段（来源给定，非官方文档）：Orientation（扫现有记忆、建基线）→ Gather Signal（识别高价值数据：用户做的纠正、项目定下的决策、反复出现的模式）→ Consolidation（合并重复条目；移除被矛盾的条目；**把相对日期转成绝对日期**，"yesterday we decided to use Redis" → "On 2026-03-15 we decided to use Redis"）→ Prune and Index（把细节挪进单独文件，保持索引在 200 行内）。
- 一个问题画像（来源给的实证观察）：**10 个 session 后记忆文件常含约 30% 冗余条目；50 个 session 后会出现互相矛盾的事实堆积**（例如三周前从 Express 换到 Fastify，但「API uses Express」的旧笔记还在）。
- **成本说法**：AutoDream 作为 sub-agent **确实消耗算力**，但跑在 session 之间的空闲期，「与活跃编码 session 相比成本很小」——**注意这是定性说法，没有给出 token 数字**。
- 另一来源给出量级：某次整理**处理了 913 个 session，耗时 8–9 分钟**（单一二手来源，谨慎引用）。
- 来源：<https://zenvanriel.com/ai-engineer-blog/claude-code-autodream-memory-consolidation-guide>、<https://techsifted.com/posts/anthropic-dreaming-agents-may-2026/>、<https://zenvanriel.com/.../>、<https://supalaunch.com/blog/claude-code-dreams-auto-dream-memory-consolidation-guide>

#### (c) Claude Memory Stores / Memory Tool（非「整理」，但定义了并发与审计原语）

- memory store 是一个**挂在 session 沙箱里的目录**（`/mnt/memory/<store-slug>/`），agent 用普通文件工具读写；**每个 session 最多挂 8 个 store**；`access` 可设 `read_only`（**在文件系统层强制**）。
- **并发控制原语（对 stage-ai 直接相关）**：「为避免覆盖并发写入，传一个 `content_sha256` 前置条件。只有当存下来的内容哈希仍与你读到的一致时，update 才生效；不一致就重新读并针对新状态重试。」——这是 **optimistic concurrency（乐观并发）**，不是锁。
- **审计与回滚**：每次记忆变更产生一个不可变 **memory version**（`memver_...`）。版本属于 store 而非单条记忆，**记忆被删除后版本仍保留**；版本**保留 30 天**（活跃记忆的近期版本不受 30 天限制）。**没有专门的 restore 端点**——要回滚就取出版本内容再 `update()` 写回去。
- 来源：<https://platform.claude.com/docs/en/managed-agents/memory>

---

### 1.3 OpenAI —— ChatGPT「Dreaming V3」（消费级产品里规模最大的后台记忆整理）

- 时间线：**2026-06-04 起向美国 Plus / Pro 灰度**，随后扩展到更多国家与 Free / Go 层级。
- 架构变化：**用后台合成过程取代手动维护的 saved-memories 列表**——即从「用户可见的一条条保存条目」转向「后台合成的记忆」。
- **关键经济性数字**：Free 层级能上，是因为后台记忆合成过程的**计算成本下降了 5×**（"5x reduction in the compute cost of running the background memory synthesis process"）。这是本报告里少见的、把「后台整理的单位成本」当作产品决策变量的公开说法。
- **可控性**：给用户加了审阅控制（review controls）。
- 已知争议（与「用户可见性」直接相关）：**saved memories 是可审计的，reference chat history 不是**——「如果你想知道 ChatGPT 到底认为它知道什么，只有 saved-memories 列表是可观察的。chat-history 那一层是运行时从过往会话推断出来的，**从不以固定列表的形式展示**。」（第三方整理）——Dreaming V3 某种程度上**进一步减少了可审计性**，官方补了 review controls。
- 来源：<https://www.techtimes.com/articles/317840/20260605/chatgpt-memory-dreaming-update-openai-rewrites-personalization-engine-limits-audit-trail.htm>、<https://theroboticsmedia.com/article/openai-chatgpt-dreaming-v3-memory-free-users-5x-compute-june-2026>、<https://www.memorylake.ai/en/blogs/chatgpt-dreaming-memory>、<https://gptprompts.ai/chatgpt-memory-guide>、<https://help.openai.com/en/articles/8590148-memory-in-chatgpt>

---

### 1.4 Google —— Vertex/Gemini Memory Bank + ADK rewind + ChronoMem

**Gemini Enterprise Agent Platform「Memory Bank」**（官方文档，2026-10-01 版）

把后台整理拆成几个**可独立开启的能力**，这是命名最规范的一份：

- Memory generation：
  - **Memory extraction**：只抽取最有意义的信息。
  - **Memory consolidation**：「把新抽取的信息与**既有记忆**合并，让记忆随着新信息被摄入而演进」，也支持把**预先抽取好的记忆**（agent 或 human-in-the-loop 认为有意义的）与既有记忆合并。
  - **Asynchronous generation**：「在**后台**生成记忆，使你的 agent 不必等待记忆生成完成。」
  - **Continuous event ingestion**：「流式接收并管理对话事件，**按你配置的批处理规则（batching rules）自动触发记忆生成**。」
  - Customizable extraction：用 topics + few-shot 例子定义「什么算有意义」。支持多模态。
- 管理与检索：**按 identity 隔离**（consolidation 与 retrieval 都被隔离在特定 identity 内）；**Automatic expiration / TTL**（自动删除过期信息）；**Memory revisions**（自动创建并维护记忆修订，让你检视记忆如何随新信息变形）；IAM 条件限制读写 scope。
- 来源：<https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/memory-bank>

**ADK rewind 的边界（重要）**：ADK 的 rewind 是 session 作用域的，**明确不恢复 app/user 级别的资源，也不恢复外部依赖**。ChronoMem 论文把这条单列为挑战之一。来源：<https://arxiv.org/html/2607.27773v2> 脚注引 <https://google.github.io/adk-docs/sessions/session/rewind/>

---

### 1.5 AWS —— Bedrock AgentCore Memory（把「异步 consolidation 的代价」写得最直白的文档）

- 两种写入路径：**每次交互后立即写入**（延迟 **1–5 秒**）vs **异步 consolidation**（延迟 **20–40 秒**，最大约 **1 分钟**）。官方建议：实时体验用立即写入，离线批处理用异步。
- **短期与长期记忆分离，两个独立的异步流水线**；事件带时间戳以维持上下文连续性与**冲突解决**；**多个事件被批量处理**。
- **滚动 7 天窗口**：短期记忆自动过期，但**长期抽取出的记忆跨 session 持久**。
- 吞吐/配额数字（官方）：每账号每秒最多 **5,000 个事件**（跨所有 agent/session）；每个 memory 资源最多 **100 个 memory strategy**；**每个 actor 最多 500 条「self-managed」记忆**；抽取出的记录**最多约 1,000 字符**；每次 retrieve 最多返回 **100 条**。
- **策略可选**：semantic（事实）、summary（对话摘要）、user preference、**custom**（自定义抽取/consolidation 逻辑 + 自定义 consolidation 提示词）。
- **失败语义（对 stage-ai 直接相关）**：摄取/抽取失败时记录告警并**继续处理后续事件**；**如果 consolidation 失败，记忆仍然会被添加**——只是可能没和既有记忆去重。**换句话说：失败降级为「重复」而不是「丢失」。**
- 结构化过滤元数据可用于**自动冲突解决**；建议把直接 batch API 留给已知正确元数据的批量导入。
- 自管理策略文档明确要求：「实现去重逻辑，避免存储冗余或冲突的记忆记录，这能降低存储成本并提高检索准确率」。
- 来源：<https://aws.amazon.com/blogs/machine-learning/building-smarter-ai-agents-agentcore-long-term-memory-deep-dive>、<https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-self-managed-strategies.html>、<https://aws.amazon.com/blogs/machine-learning/structured-memory-filtering-with-metadata-in-agentcore-memory>

---

### 1.6 通用记忆层：Mem0 / Zep-Graphiti / Redis / LangMem / Hindsight

| 系统 | 后台整理的形态 | 关键事实 |
|---|---|---|
| **Mem0** | **add 默认异步**：官方原文「如果你在 2025-07-01 之后注册，你的 add 请求会**在后台工作并立即返回**」；`AsyncMemory` 提供非阻塞接口 | 四操作 **ADD/UPDATE/DELETE/NOOP**，官方优先级 `NOOP > DELETE > UPDATE > ADD`；**单遍抽取流水线（single-pass extraction）最小化 LLM 调用**；**LLM 响应无效或为空时，异步流水线「优雅地返回空列表并记录错误」**——即静默丢弃，这是一个值得注意的失败模式 |
| **Zep / Graphiti** | 每个 episode 抽取事实入图；**双时间模型**（`valid_at` / `invalid_at` / `created_at` / `expired_at`） | **不删边，用时间化失效**；LongMemEval 上 71.2% vs 全上下文 60.2%，**准确率最高 +18.5%，响应延迟降 90%**；是「冲突与版本管理」最完整的答案 |
| **Redis Agent Memory** | **明确两个写入者**：应用同步写 session 事件（快）；**后台流水线异步做两件事**：会话超过配置阈值后把旧事件**摘要**、并**抽取长期记忆（事实与偏好）写成独立可检索记录（带向量）** | **抽取读的是整个 session，不只是最新一条**，因此跨轮上下文可解析；抽取时会**把新记忆与既有记忆比对，用模型判断近似的两条是真重复还是「确有不同、值得都留」**；"Eventual consistency: both run asynchronously" |
| **LangMem `BackgroundMemoryManager`** | 后台记忆管理，会话结束后异步生成记忆并做 prompt 优化 | **实测 p50 检索延迟约 18 秒**（单一来源，二手）；「P50 latency is ~18s」「search latency only」 |
| **Hindsight** | 「Consolidation 是 LLM-bound 的后台工作」 | 明确承认 consolidation 的成本链：**N 条新记忆 → M 次 observation 更新 → K 次 mental model 刷新 → 每次刷新 K × 多次 LLM 调用**；「**consolidation 触发的刷新是异步的——它们作为后台任务运行，从不阻塞面向用户的操作**」 |
| **OpenJiuwen agent-memory** | 「记忆抽取在后台异步运行」 | 开源实现 |
| **Hermes（NousResearch）** | gateway 的 **memory flush agent**：在 **session 重置/过期**时复盘旧对话并写入记忆 | 见 §6.3 的**真实事故与修复 commit** |

来源：<https://docs.mem0.ai/open-source/features/async-memory>、<https://deepwiki.com/mem0ai/mem0/3.5-asynchronous-operations>、<https://github.com/mem0ai/mem0/blob/main/docs/_snippets/async-memory-add.mdx>、<https://arxiv.org/html/2501.13956v1>、<https://redis.io/docs/latest/develop/ai/context-engine/agent-memory/overview/>、<https://hindsight.vectorize.io/blog/2026/05/08/how-hindsight-scales>、<https://hindsight.vectorize.io/blog/2026/05/21/agent-memory-consolidation>、<https://github.com/openJiuwen-ai/agent-memory>

**Hindsight 提出的「四杠杆」框架**（是少见的把 consolidation 拆成可配置旋钮的整理）：**importance / merge / decay / eviction**，并逐家点评 Mem0、Zep、Letta、LangChain、Hindsight 各自处理或跳过了哪一杠杆。来源：<https://hindsight.vectorize.io/blog/2026/05/21/agent-memory-consolidation>

---

### 1.7 编码 agent 的产品化实现

**Cursor**（层次最多的一个，也是最清晰的「谁有权写」样本）：

- 三种记忆：① 从 chat 学到的 **Memories**（Cursor 1.2 起 GA）；② 你手写的 **rules**（`.cursor/rules` + Settings）；③ Cloud Agent 每次运行的 **per-automation notes**（默认文件名 `MEMORIES.md`，**存放在 agent 工作文件系统之外**）。
- **关键 UX 决策**：「当它发现一条值得记的，Cursor 会**提议**一条 memory。**Cursor 在后台生成的记忆被保存前会征求你的批准**，这是正确的默认值。」（localskills.sh）
- 官方警告（值得照抄的风险提示）：处理**不可信输入**的 automation 可能拾取「**误导性或恶意记忆**」并影响后续运行。
- 运维建议：**定期审查记忆文件**，保留一份已批准的副本（memorylake）。
- 来源：<https://www.past.dev/blog/cursor-memory>、<https://localskills.sh/blog/cursor-memories-guide>、<https://www.memorylake.ai/en/blogs/guard-cursor-automations-memories>

**Microsoft ——「环境探测式策展」（Environment-Probing Curation，可能是本报告里最贴近 stage-ai 需求的一篇）**

arXiv 2609.11060，作者来自 Microsoft，在 **GitHub Copilot (GHCP)** SDK 上做的类生产级实验。**这正是「post-task curator agent」路线，且直接给出了量化收益。**

- 问题定义原文：**「一个被限制在已完成轨迹上的 post-task curator agent，可能会保留错误、把局部证据过度一般化，或保留过期知识。」**（"may preserve errors, overgeneralize partial evidence, or retain stale knowledge"）
- 解法：给**既有的异步 curator agent** 加装**最小权限、只读的世界工具（read-only world tools）**，让它能**核对、限定范围、刷新**候选记忆。**不重新训练模型，不改动 task agent、检索器、记忆表示与生产写入权限。**
- 实测（CLBench 数据库探索 + 90 个改造过的 APEX 管理咨询任务）：
  - **pass rate 从 39% 提升到 73%**；
  - **pass-discounted reward 从 8.60 提升到 22.60**；
  - **每问查询数从 8.8 降到 4.7**；
  - **task-agent 成本从 $3.38 降到 $1.68**；
  - 在 6 个 APEX 世界里，**全部 18 个 memory-vs-baseline 的 mean reward 比较均为正**，task-agent 工具调用下降 **16–75%**；
  - 在 Sonnet 4.6 与 Opus 4.7 上都比 `GHCP + Mem` 取得更高的 mean reward，且**无 schema drift**。
- 引用的前置结论：CLBench 表明**记忆会在环境漂移下编码出虚假的泛化与过期信念**；Xiong et al. (2026) 指出了**错误传播与错位的经验回放**。
- 来源：<https://arxiv.org/html/2609.11060v1>（同样内容见 arXiv 摘要页）

---

### 1.8 角色扮演 / 叙事专属的现成实现（与本项目同场景，最该看）

#### (a) AI Dungeon「Memory System」—— 把整理节奏写成明文的商业产品

- 两个组件：**Auto Summarization** + **Memory Bank**。改编自其前作 Voyage，用到摘要模型、embedding、向量。
- **精确的整理节奏（原文）**：
  - 「**新开一个 adventure 时，我们会等到你深入到第 12 个 action**，然后把**最旧的 6 个 action**（第 1–6 个）摘要成你的**第一条 Memory**。」
  - 「然后再过 6 个 action（你到 18 了），我们再把**前面那 6 个**摘要成一条新 memory（第 6–12 个）。」
  - **「这个循环无限重复，每 6 个 action 产生一条新 memory。」**
  - 结果：**最近 6 个 action 永远不被摘要**——「你可以自由编辑或撤销最近 6 个 action 而不影响任何 memory」。
- **Memory 的定义**：一条 memory = 6 个 action（含 AI 回复）经**一个专门训练的摘要模型**产出的摘要；保留关键情节细节、去掉华丽文笔，因而**信息密度高于原文**。
- **Memory Bank 的数量与淘汰**：context 装不下全史时才开始检索；用 embedding 对「最近一个 action」做查询排序，把最相关的塞进 context（叫 "Used Memories"）；**memory bank 满了并产生新 memory 时，淘汰「最少被使用」的记忆**（"Forgotten Memories"）；「**很老的记忆如果被频繁用到，可能会永远留在 bank 里**」。
- **tier 硬上限**：Free 25 / Champion 100 / Legend 200 / Mythic 400 条。
- **用户可见性**：Context Viewer 里的 `Explore Memories` 按钮，有 **Timeline** 与 **Relevance** 两个视图看 Used / Stored Memories。
- 来源：<https://help.aidungeon.com/faq/the-memory-system>

#### (b) SillyTavern 自带 Summarize 扩展 —— 官方文档自己写明了幻觉风险

- 定位原话：「总结……*可以*被理解为长期记忆，但**这句话要打个折扣**。因为摘要由语言模型生成，**输出可能丢失重要细节或包含幻觉**，所以你**始终被建议跟踪摘要状态并在需要时手动纠正**。」
- **触发**：`Update every X messages` 与 `Update every X words` 双滑块，**任一先到即触发**；`0` = 关闭自动（仍可手动 "Summarize now"）。文档建议「理想情况下，你要让第一条摘要正好在消息开始从 prompt 里掉出去的时候生成」。
- **阻塞 vs 非阻塞**：「Raw, non-blocking：聊天生成在摘要生成期间**不会被阻塞**。**不是每个后端都支持并发请求**，所以摘要失败时就切回 blocking 模式。」——这是「后台整理与主循环争抢同一后端」的现实约束。
- **回滚与人工干预**：`Restore Previous`（**移除当前摘要，回滚到上一状态**，「如果摘要器某个点做得不好，这很有用」）、`Pause`（暂停自动更新）、`Current summary` 可直接编辑；**摘要嵌在生成它的那条消息的 chat 文件元数据里**，「删除或编辑一条带摘要的消息，状态会回退到最后一个有效摘要」。
- 来源：<https://docs.sillytavern.app/extensions/summarize>

#### (c) Smart Memory（SillyTavern 扩展）—— 本调研中最完整的「RP 专用后台记忆 agent」

第三方开源扩展，功能描述与 stage-ai 的设想高度重合。**这是本报告里唯一一个「跑在角色扮演里、且把嵌入整理、去重、更新、分支处理全写了文档」的样本。**

- **定位**：「静静地**在后台工作**，让 AI 在长篇故事里保持方向、知道本场发生了什么、并扎根于它**此前与该角色的每一次聊天**中学到的事实。」
- **模型隔离（关键工程决策）**：「Smart Memory 需要一个 LLM 来做它的工作——总结、抽事实、生成回顾。**它把这部分与你的主力扮演模型分开运行，这样两者不互相争抢。**」设置项叫 **Memory LLM**；有单独的「Recommended Local Models」推荐，说明推荐跑本地小模型。
- **审查修正机制（两层）**：
  1. **快模式检查**：在新记忆里找状态变更语言——"no longer"、"became"、"healed"、"left the"、"was captured" 等；
  2. 若两条记忆明显讲同一主题但**没命中模式短语**，**直接问 AI**：「这条新记忆是更新/替换旧的那条，还是两者同时仍然成立？**一个问题，一个词的答案。**」
  - **成本控制原话**：「只有发现可疑配对时才会有额外的模型调用——安静的 pass 不额外花钱。」
- **长期记忆退旧不并存**：「当一条新记忆描述的是变化——"Alex no longer distrusts Finn"、"she moved to the capital"、"the guild was disbanded"——**旧事实会被自动退役并替换，而不是与新真相并排留下形成矛盾。**」
- **打分裁剪**：超出 token 预算时按多维打分裁掉最低分的，维度包括：**记忆的永久性、抽取时的重要度评级、最近被回忆的时间、被使用的次数、系统对其仍然为真的置信度**。
- **context 预算**：简单模式默认 **3750 tokens**（全部 tier 之和）；**Auto-tune budgets**：每次注入后测量各 tier 实际需要多少 token，把预算设为**需求量 + 15% 余量**；**预算只会增长，永不降到默认值以下**；群聊时按**最耗记忆的那个角色**定预算。
- **不可逆的副作用（官方自曝的两个坑，直接对应 stage-ai 的分支/回滚问题）**：
  - **「编辑过去消息」**：「如果一条消息在 Smart Memory 已经从中抽取过记忆之后被编辑，**那些记忆不会被更新**。角色可能持有基于原文本形成的信念，而已与编辑后的版本不符。若编辑显著，请手工审阅并更正/删除相应记忆条目。」
  - **「隐藏过去消息」**：「隐藏一条已被处理的消息**不会移除**由它形成的记忆。」
  - **「检查点与分支」**：「SillyTavern 的 checkpoint 和 branch 功能把聊天在某一点另存为新文件。**Smart Memory 的长期记忆在同一个角色的所有聊天之间共享——切换到更早的 checkpoint 或 branch 时它们不会回滚。**」官方给的缓解是 **read-only 模式**。
- 另有第三方扩展 **SillyTavern-CheckpointSummarize** 处理类似问题：「当导入的 checkpoints 与当前 chat 的消息哈希不匹配时，它们被保留为 **memory-only 记录**。它们**仍可被注入，但不计入范围覆盖**。」
- 来源：<https://github.com/senjinthedragon/Smart-Memory>、<https://smartmemory.hatchling.org>、<https://smartmemory.hatchling.org/architecture.html>、<https://github.com/NovNovikov/SillyTavern-CheckpointSummarize>

#### (d) 叙事 / 长文创作专用的「记忆版本控制」样本

- **Memoria（matrixorigin/Memoria）**：对 AI agent 记忆做 **Git 级版本控制**——快照、分支、合并、时间旅行回滚，基于 MatrixOne 的 Copy-on-Write。特点：**「自维护——内置治理检测矛盾、隔离低置信度记忆」**；每次记忆变更都有 snapshot + 溯源链。**其目录里直接带一个「小说写作」用例**（branch/merge/rollback the story beats）。来源：<https://github.com/matrixorigin/Memoria>、<https://thememoria.ai>
- **Sverklo 的「双时间 + SHA 钉住」**：明确对比「分支快照」与「双时间」两种抽象，认为**分支会移动、SHA 不会**，因此 SHA 钉住（`valid_from_sha` / `valid_until_sha` / `superseded_by`）比 per-branch HEAD 指针更严谨；并指出 Memoir 的 `VersionedKvStore` **只支持 branch checkout，不支持 commit checkout**（源码注释原文），commit 级回滚是占位。来源：<https://sverklo.com/blog/we-already-shipped-git-for-agent-memory>
- **Memoir（context branching）**：把「分支」直接作为**探索 what-if 而不污染主线**的手段——「传统 agent 记忆系统在用户想探索假设情景时有一个根本问题：任何 'what if' 探索都会**永久改变 agent 的记忆，用推测性信息污染主时间线**。」做法：Git-like 分支，「主干（A–D）保持不变，替代探索（E–G）隔离在独立分支」，可即时在时间线间切换、事后切回 main 并保留分支。来源：<https://zhangfengcdt.github.io/memoir/examples/context_branching/>
- **Living Storybook（seehiong）**：一个把分叉做成**一等公民**的「叙事多元宇宙」引擎。值得直接抄的点：**temporal locking（时间锁）**——世界在 `13:45:00` 锁死，该时点的事件列表与**解析后的状态快照**变得不可变；分叉时对每个既有分叉依次尝试**就地覆写**，**只有所有时间线都被锁定时才创建新分叉**，并**取消**其余尝试；新分叉从锁定的父分叉继承，带 `parentUuid` + `forkedFrom[uuid, lockedAt]` 溯源链；「Segments 捕获**不可变的世界状态快照、叙事 DNA 和记忆**」；另有 Bookmark 机制把「经过验证的时间线」提升为 canonical 并重新合并进 Machine。来源：<https://seehiong.github.io/posts/2026/02/engineering-a-narrative-multiverse/>
- **SagaSmith Narrative MCP**：给 LLM 提供数据完整性层——**campaign（隔离顶层）、事务（原子性变更集）、修订（每变更全状态快照）、连续性账本（角色/地点/物品/时间线的结构化账本）**，外加显式快照与分支。来源：<https://site.financialmodelingprep.com/education/other/sagasmit... >（命中片段；建议以仓库为准）
- **Parallel Context Architecture（tokitai）**：面向**多分支对话**的显式设计——用基于 MCP 的目录感知 CLI 让 agent **fork / checkout / merge / abort**，用 **copy-on-write 符号链接**隔离文件系统层；实测 **fork/resume 与 merge/reconcile 任务成功率提升 42%**，token 消耗约 1.8×。来源：<https://try-tokitai.github.io/Parallel-Context-Architecture/>
- **MnesOS**：event-sourced 的 agentic RPG 引擎，「backend 不在网络轮次之间保留操作记忆，**采用树形事件溯源模型，原生支持分叉时间线**」。来源：<https://pypi.org/project/MnesOS/0.7.1/>

#### (e) Git Context Controller（一个「agent 自己决定不用记忆」的反例，见 §9）

arXiv 2508.00031。给 agent 一套 **COMMIT / BRANCH / MERGE / CONTEXT** 的 git 式上下文管理，`CONTEXT` 命令支持从全局概览到 token 级的多粒度检索。**最有价值的是其自发行为记录**：agent **自发做了分支**、**尝试引入基于检索器的记忆**，发现**「更慢的解决时间与更低的任务成功率」**，于是**放弃该方向**、回到更简单的压缩摘要表示，并**为后续留下"为什么放弃"的记录**。来源：<https://arxiv.org/html/2508.00031v3>

---

### 1.9 学术界的反思 / 摘要 / 整合机制

| 工作 | 机制 | 关键事实与数字 |
|---|---|---|
| **Generative Agents**（Park et al. 2023, arXiv 2304.03442） | **Reflection**：当累积重要度超过阈值时，把记忆综合成更高层的推论，**并把反思与计划写回 memory stream** | **阈值 = 150（importance 之和）**，实践中「**一天大约产生两三次反思**」；第一步是「先决定反思什么」（生成高层问题），再取最近 **100 条记忆**、对每个问题检索相关记忆、合成抽象洞见存为新记忆。消融实验证明 memory / reflection / planning 三者各自都显著贡献可信度。**批评（二手）**：memory stream 是**基于检索而非基于权重**的，「批评者认为这使它成为一种查找机制而非真正的记忆」 |
| **Reflexion**（arXiv 2303.11366） | 对任务反馈信号做**言语反思**，把反思文本存进**episodic memory buffer** | 见 §9 的反面证据 |
| **A-Mem**（arXiv 2502.12110，NeurIPS 2025） | **agentic memory**：按 Zettelkasten 方式**动态组织**记忆（自主建链、演化笔记结构） | 是被广泛引用的「让 agent 自己整理记忆结构」的代表 |
| **Self-Sum**（Findings of ACL 2026） | 把「摘要」建模为**一等内部认知动作**，与外部环境动作统一在多轮决策里；两阶段训练（cold-start SFT + 摘要感知 RL） | 明确批评规则式摘要（每几步摘一次 / 按长度阈值触发）**「不灵活、缺泛化，且常引入不可逆的信息损失」**；学到「在**有意义的时刻稀疏地**摘要」；在多个长程 benchmark 上优于 no-summarization 与 rule-based 基线 |
| **MRAgent**（arXiv 2606.06036） | 「**记忆是被重构的，不是被检索的**」：Cue-Tag-Content 关联记忆图 + 主动重构 | 批判纯检索范式 |
| **Agent Cognitive Compressor (ACC)**（arXiv 2601.11653） | 用**有界内部状态**替代 transcript replay；**把「产物召回」与「状态提交」分离**，「阻止未经验证的内容成为持久记忆」 | 见 §5；这是「不让未验证内容进记忆」的正面设计样本 |
| **Memory for Autonomous LLM Agents**（arXiv 2603.07670） | 综述 | 指出**「uncertainty-aware memory」是最大缺口**：「agent 必须不仅维护事实，还维护**置信度**，并随着新数据到来正确更新它们——**而大多数现有记忆系统对此处理得很差或完全不处理**」 |
| **From Storage to Experience**（arXiv 2605.06716，综述） | 把 agent 记忆演进分三阶段：**Storage（轨迹保存）→ Reflection（轨迹精炼）→ Experience（轨迹抽象）** | 是「反思/摘要」这条线最好的地图；还整理了各阶段的 benchmark（LOCOMO、LongMemEval、StreamBench、MemoryBench、Evo-Memory、LABench 等） |

来源：<https://arxiv.org/html/2304.03442v2>、<https://lgmoneda.github.io/org-roam/park2023generative.html>、<https://github.com/AlexKapadia/AutoFirm/blob/main/docs/research/A4-memory-and-learning-infra/04-generative-agents/SUMMARY.md>、<https://arxiv.org/html/2303.11366>、<https://arxiv.org/abs/2502.12110>、<https://aclanthology.org/2026.findings-acl.447.pdf>、<https://arxiv.org/abs/2606.06036>、<https://arxiv.org/html/2601.11653>、<https://arxiv.org/html/2603.07670v1>、<https://arxiv.org/html/2605.06716v1>

---

## 2. 触发时机与调度：已知的取值集合

把全部找到的调度方式拉平（**这一节是本报告里可直接拿来做设计决策的部分**）：

| 系统 | 触发时机 | 具体参数 | 是否阻塞主循环 |
|---|---|---|---|
| **Letta sleep-time** | 消息数 + 时间双门槛 | `sleeptime_agent_frequency`，**默认约 10 条消息**；`interval_seconds` 与 `min_messages` **必须同时满足** | 否（后台线程） |
| **Letta Dreaming** | 可选：每 N 个 agent step / **上下文窗口被压缩时** | 通过 `/sleeptime` 或 App 的 Dream settings 配置 | 否 |
| **Claude Dreams** | **手动/定时发起异步 job** | 输入 = 1 个 store + **1–100 个 session** | 否（异步 job） |
| **Claude Code AutoDream** | **定时 + 累积量** | **每 24 小时** 且**已累积 5+ session** | 否（session 之间的空闲期） |
| **OpenAI ChatGPT Dreaming V3** | 后台合成（细节未公开） | 未公开 | 否 |
| **Gemini Memory Bank** | **连续事件摄入 + 可配置的批处理规则** | "batching rules that you configure" | 否（"asynchronous generation"） |
| **AWS AgentCore** | 每次交互后立即写（部分）/ 事件批量处理（异步 consolidation） | 立即：1–5s；异步：**20–40s（最大约 1 分钟）** | 两种路径可选 |
| **Redis Agent Memory** | **会话超过配置阈值**后触发摘要；抽取持续跑 | 阈值可配 | 否 |
| **Mem0** | **每次 add 请求**（2025-07-01 后注册的默认后台） | — | 否（后台返回） |
| **Hermes gateway flush** | **session 重置 / 过期时** | — | 否 |
| **LangMem BackgroundMemoryManager** | **会话结束后** | — | 否 |
| **AI Dungeon** | **每 6 个 action**；首次在第 12 个 action 时对第 1–6 个 action 做摘要 | 每次摘要 6 个 action；**最近 6 个 action 永不摘要** | 否（独立摘要模型） |
| **SillyTavern Summarize** | **每 X 条消息 或 每 X 个词，先到即触发** | 双滑块；`0` = 关闭，仅手动 "Summarize now" | **可选**：`blocking`（默认有）或 `non-blocking`（"not every backend supports simultaneous requests"） |
| **Smart Memory** | **每一轮**（默认）：`Injection refresh period = 1`（最小 AI 消息间隔）；提高它可保护 prompt cache 命中 | 注：**角色与世界 profile 无视此设置、每个抽取 pass 都重注入**，所以高 refresh period 配 profiles 仍会打断 prompt 顶部缓存 | 否（独立 Memory LLM） |
| **Generative Agents reflection** | **事件驱动**：累积重要度 > 150 | 实测约「每天 2–3 次」 | 否 |
| **Self-Sum** | **学出来的**：由 agent 自己决定何时摘 | — | 视实现 |
| **CLI / 编码 agent 社区共识** | 「**固定间隔，每 N tick、每 session、或一个工作块结束时**」 | Agent Patterns Catalog 的观点：「记忆整合最有价值的恰恰是**当没什么事情显得重要的时候**：那些不起眼的重复才是信号」 | — |

来源：见上文各节链接；另 <https://www.agentpatternscatalog.org/trainings/agent-memory-consolidation>、<https://github.com/NirDiamant/Agent_Memory_Techniques/tree/main/all_techniques/14_memory_consolidation>、<https://inferensys.com/prompts/context-engineering-and-prompt-assembly/multi-turn-conversation-context-packing/memory-consolidation-prompt-for-long-term-session-state>

**一条明确的工程建议（来自 consolidator 提示词工程资料）**：记忆整合应「接到一个**计划性的 post-session 任务**、或一个**在对话窗口关闭时触发的 trigger** 上，**而不是做成每一轮用户输入上的实时拦截器**，因为整合这一步是为**已完成 transcript 的批处理**设计的」。来源：<https://inferensys.com/prompts/context-engineering-and-prompt-assembly/multi-turn-conversation-context-packing/memory-consolidation-prompt-for-long-term-session-state>

**另一条关于「谁的第一优先」的硬规则**（Agent Memory Atlas，讲得很锋利）：「**一次维护 pass 和它所服务的写入路径不得共享同一份预算；若必须共享，写入路径优先，维护取余下的那部分**，并且要在一个遵守 deadline、且在提前停止时会上报的循环里。」原因是「一个成功但饿死写入路径的 job」：按条数而非按时间限界的 drain，可能把整个预算花在一整份 backlog 上，**把它本该服务的 capture 给中止了**，而队列里每个条目都完好无损。来源：<https://neoneye.github.io/agent-memory-atlas/patterns/recoverable-background-work>

---

## 3. 「谁的上下文 / 用哪个模型 / 花多少 token」

这是用户问题里最实操的一问，材料比预期丰富。**跨系统的一致做法是：整理用独立的上下文与独立的模型调用，不复用主循环的上下文窗口。**

| 系统 | 整理的上下文从哪来 | 用什么模型 |
|---|---|---|
| Letta sleep-time | **独立的 sleep-time agent（自己的上下文）**，与 primary 共享记忆 | **可独立配置**：primary 用快模型；sleep-time **用更强更慢的模型**（gpt-4.1 / Sonnet 3.7），因为不受延迟约束 |
| Claude Dreams | **独立的异步 job**，输入 store + 1–100 个 session transcript | **可指定**：opus-5 / opus-4-8 / opus-4-7 / sonnet-5 / sonnet-4-6 等；带 `usage` token 计量 |
| Claude Code AutoDream | **后台 sub-agent**，读 memory 文件 | 未公开 |
| ChatGPT Dreaming | 后台合成进程 | 未公开（官方提及把计算成本降了 **5×**） |
| Gemini Memory Bank | 后台流水线，读事件流 | 平台管理 |
| AWS AgentCore | 异步流水线，读事件流 | 可自定义 consolidation 提示词 |
| Redis Agent Memory | **background extraction 读整个 session**（不只是最新一条） | 平台管理 |
| AI Dungeon | 取**6 个 action** 送进一个**专门训练的故事摘要模型** | **专用摘要模型**（非通用对话模型） |
| SillyTavern Summarize | 可用主 API，也可配独立后端 | 主 API（三种 prompt 构建模式）或独立后端 |
| **Smart Memory** | **独立的 Memory LLM** | 官方原话：「**它把这部分与你的主力扮演模型分开运行，这样两者不互相争抢**」；推荐本地小模型 |
| Microsoft env-probing curator | **既有的异步 curator + 最小权限只读世界工具** | 不改 task agent 与检索器 |

**关于 token 成本**，能找到的量化很有限，如实列出：

- **Letta 官方**：frequency 越高 token 越多（定性）。
- **Claude Code AutoDream**：作为 sub-agent 消耗算力，但「与活跃编码 session 相比成本很小」（**无数字**）。
- **Anthropic `Agent reviews before applying`**：官方明确说「**这会消耗更多模型 token，并且不会请求你批准**」。
- **AWS AgentCore**：异步 consolidation 延迟 20–40s（**延迟而非 token**）；抽取记录最多约 1,000 字符。
- **LangMem `BackgroundMemoryManager`**：检索 p50 约 **18 秒**（单一二手来源）。
- **Microsoft env-probing**：task-agent 成本 **$3.38 → $1.68**（这是**task agent** 的省钱，不是整理本身的成本）。
- **Sleep-time compute 论文**：达到同等准确率所需 test-time compute **降约 5×**；Multi-Query 摊销后**平均每查询成本下降**。
- **OpenAI**：后台合成的计算成本**降 5×**，正是这个降幅让 Free 层能上。
- **Hindsight**：明确点出成本链的形状——**N 条新记忆 → M 次 observation 更新 → K 次 mental model 刷新 → 每次刷新 K × 多次 LLM 调用**。
- **ChronoMem / AuthMem-Bench**（论文）公开了**总 token 消耗**：AuthMem-Bench 的 C1 用 **32,181,577 tokens**，C2 参考标注 5,453,134、预测标注 4,531,632、action 3,226,913。这是难得的「评测本身花了多少 token」的披露。来源：<https://arxiv.org/html/2608.01679v1>

**关于「并发请求能力」的现实约束**：SillyTavern 官方文档直白地说「**不是每个后端都支持并发请求**，所以摘要失败时就切回 blocking 模式」——即**后台整理与主演出争抢同一后端容量**是真实存在的工程限制。

---

## 4. 产物形态与写入策略

### 4.1 产物形态：事实卡 vs 叙事摘要（业界并没有二选一，而是分层并存）

- **明确分成两层并各给独立预算的样本**：AI Dungeon（Auto Summarization = 叙事摘要；Memory Bank = 可检索的离散记忆条目）、SillyTavern（Summarize = 滚动摘要；Vector Storage / Data Bank = RAG）、Smart Memory（**11 个 tier**：Canon / Long-term / Short-term / Session / Scenes / Arcs / Relationships / Profiles / Perspectives & Secrets / State Ledger / Triggered）。
- **Smart Memory 的 tier 分工写得很具体**（对 stage-ai 的 always/index/archive 分层有直接参照）：Canon = 稳定角色历史（独立槽位）；Long-term = 跨会话事实/关系/偏好/重大事件；Short-term = 滚动叙事摘要；Session = **仅本场**的细粒度细节（场景描述、被揭示的事、关系如何转变、具体物件地点）；Scenes = 场景历史；Arcs = 故事弧；Profiles = 状态快照；Perspectives & Secrets = **逐角色的知识与秘密**；State Ledger = 当前实体状态。
- **「状态」与「叙事」必须分开**这条结论在既有文档里已由多家独立得出，本报告不重复；此处补的是一手证据：Smart Memory 的 **State Ledger（当前实体状态）** 与 **Profiles（状态快照）** 被单独拎出来、且**在 prompt 里贴得离回复最近（depth 1）**，而叙事摘要（Short-term / Canon）注在 Main Prompt **之后**（靠近角色卡）。

### 4.2 去重 / 合并 / 更新 / 遗忘的具体算法（可直接抄的）

| 环节 | 具体做法 | 来源 |
|---|---|---|
| **去重（语义）** | 用 embedding 比较语义而非字面；Smart Memory 官方：「这能抓到多得多的重复，让记忆列表保持干净」 | Smart Memory |
| **去重（判断式）** | **不因为相似就拒绝**——「用模型的判断来决定一条几乎相同的记忆是真重复，还是**确有不同、值得都留**」 | Redis Agent Memory |
| **更新（两遍法，很实用）** | 第一遍：**模式短语**查状态变更语言（"no longer" / "became" / "healed" / "left the" / "was captured" …）；第二遍：未命中但主题相同的可疑配对，**直接问 AI 一句、答一词**。**额外调用只在发现可疑配对时发生** | Smart Memory |
| **更新（四操作）** | ADD / UPDATE / DELETE / NOOP，优先级 `NOOP > DELETE > UPDATE > ADD` | Mem0 |
| **更新（时间化失效，不删）** | 新事实取代旧事实时，旧边**不删**，设 `invalid_at`；查询默认只返回当前有效，翻一个列就变历史查询 | Zep/Graphiti |
| **更新（版本化取代）** | 非破坏性：插入新行 + 给旧行设 `valid_until_sha` + `superseded_by` 外键 | Sverklo |
| **遗忘（用量淘汰）** | Memory Bank 满时淘汰**最少被使用**的记忆；**高频使用的老记忆可以永久保留** | AI Dungeon |
| **遗忘（多维打分裁剪）** | 超预算时按：**永久性 / 抽取时重要度 / 最近被回忆时间 / 被使用次数 / 仍然为真的置信度** 打分，裁最低分 | Smart Memory |
| **遗忘（TTL）** | 给记忆设 TTL 自动删；可配置为对所有插入/生成的记忆自动套用 | Gemini Memory Bank |
| **遗忘（衰减 + 回忆强化）** | importance / merge / decay / eviction 四杠杆 | Hindsight 的四杠杆框架 |
| **规模控制** | 硬上限：索引 ≤ 200 行（Claude Code）；Memory Bank 条数按 tier（AI Dungeon 25/100/200/400）；每 actor ≤ 500 条（AgentCore self-managed） | 多源 |

### 4.3 append-only vs rewrite —— 两条路线各自出过什么问题

这是用户问到的关键分野，材料给出了**清晰的两边证据**。

**A. 允许 rewrite / 整体重建的一侧**

- **生产者**：Claude Dreams（「重复项合并、过期或被矛盾的条目用最新值替换」）、Gemini Memory Bank consolidation（「让记忆随着新信息摄入而演进」）、Smart Memory（旧事实自动退役替换）、Mem0（UPDATE/DELETE）、Letta Dreaming（「持续产出干净、简洁、详细的记忆」）、Claude Code AutoDream（合并重复、移除被矛盾条目、相对日期转绝对日期、把细节挪出索引）。
- **rewrite 的必要性论据（Letta 官方）**：MemGPT 式的**增量**记忆形成「**时间久了会杂乱无章**」；AutoDream 的实证画像：**10 session 后约 30% 冗余、50 session 后互相矛盾的事实堆积**。
- **rewrite 的防护措施（三条，全部来自真实产品）**：
  1. **输入不可变**：Claude Dreams 的 output store 是**新的一份**，「输入 store 永不被修改」，可以审阅后丢弃；**失败/取消时同样不动输入**。
  2. **先备份再整理**：Letta 的大规模 reorganize「**先备份当前仓库**再拆分大文件、合并重复项、重构层级」。
  3. **可回滚 + 审计**：Claude Memory Stores 的不可变 memory version + 30 天保留；SillyTavern 的 `Restore Previous`；Memoria 的 Git 级版本控制与「每次记忆变更都有 snapshot + 溯源链」。
- **rewrite 侧的已知风险**：**过度一般化**（Microsoft 论文点名的 curator 失效模式之一：overgeneralize partial evidence）；**被矛盾的语义覆盖掉细节**（既有文档里的 NarraWorld 结论：更强的摘要措辞会覆盖记忆中保留的区分）；**不可逆的信息损失**（Self-Sum 对规则式摘要的批评）。

**B. 只追加 / 不重写的一侧**

- **生产者**：Zep/Graphiti（边不删，只加时间化失效）、Sverklo（`superseded_by` 插入新行而非覆盖）、AI Dungeon Memory Bank（新增 + 按用量淘汰，不改写旧摘要）、Redis（新记忆作为独立可检索记录）、NstAgent 的 past-event log（**累积且不淘汰**）。
- **append-only 的必要性论据**：Graphiti 的双时间模型让「某一时刻的真相」可恢复；Sverklo 的论点是 SHA 钉住比分支指针更严谨，因为**分支会移动**；`Rollback the World, Keep the Reflection` 明确「**回滚世界，保留反思**」，但**只保留可复用的知识，明确排除分支局部的状态断言**。
- **append-only 侧的已知问题**：**无界增长**——NstAgent 作者把「bounding or consolidating the past-event log」明确列为 **future work**；成本近线性依赖 prefix caching，100K 字故事每篇 **7.5M input tokens**（10K 字只有 0.71M），其中**约 60% 由 provider cache 服务**；若全按未缓存计价，100K 字故事成本从 **$1.32 涨到 $2.28**（此段来自既有文档，此处仅交叉引用）。
- **中间路线（最值得抄的一条）**：**「结构化取代 + 保留历史」**——Mem0 的 UPDATE 之外，学界补的是 **STALE / CUPMem 的 write-time revision + 结构化状态合并 + 传播感知检索**（既有文档已覆盖），以及 Sverklo 的 `valid_from_sha / valid_until_sha / superseded_by`。

---

## 5. 事实性与污染风险（有实测数据的部分）

**这一节是本报告证据最硬的部分。** 按风险类型分组，每条都附数字。

### 5.1 整理阶段本身就是幻觉的产地（HaluMem）

**HaluMem（arXiv 2511.03506，v3 定稿 2026-01-05）**，声称是**第一个操作级（operation-level）**的记忆幻觉评测基准——它按记忆系统的操作阶段切分，因此能定位幻觉发生在哪一步。

- 三个评测任务：**记忆抽取（extraction）、记忆更新（updating）、记忆问答（QA）**。
- 数据集：HaluMem-Medium 与 HaluMem-Long，**各约 15,000 个记忆点 + 3,500 道多类型问题**；平均每用户对话长度达 **1.5k 与 2.6k 轮**，context 长度**超过 1M tokens**。
- **核心结论（原文）**：「基于 HaluMem 的实证研究表明，**现有记忆系统倾向于在抽取与更新阶段产生并累积幻觉，随后把错误传播到问答阶段。**」
- 术语：记忆幻觉包括 **fabrication（编造）、errors、conflicts、omissions**。
- 呼吁方向：「**可解释且受约束的记忆操作机制**」，以系统性抑制幻觉。
- 来源：<https://arxiv.org/abs/2511.03506>、<https://github.com/MemTensor/HaluMem>、<https://arxiv.org/html/2511.03506v2>

### 5.2 整理会抹掉「来源权威性」——authority collapse（这条对 stage-ai 极重要）

**When Memory Becomes Authority: Benchmarking Authority Collapse at the Memory Consolidation Boundary（arXiv 2608.01679，清华）**

- 定义：**authority collapse（权威崩塌）** = 整合过程**保留了断言内容，却抹掉了约束其授权使用的来源限定**，导致存下来的记忆**暗示出比其来源所允许的更大权威**。
- 关键的洞察：**记忆整合同时也是隐式的授权边界**。它把带角色标签的历史转成持久记忆条目时，也**分配了操作状态**——一条存下来的条目之后可能被当作「用户事实」、「已证实的观察」、或「长期指令」来使用。而这些**在文本上完全无法区分**：
  - 「直接的用户陈述」与「未经背书的第三方报告」产出**同一条记忆**（例如「The user lives in Seattle」），但**只有前者可以授权一次 profile 更新**。
  - **权威洗白（authority laundering）**：把在非授权语境里引入的断言，变成看似用户事实 / 已证实观察 / 长期规则的东西。**这条断言不必是假的、也不必含注入指令——失效点在于整合时被静默赋予的权威。**
- **实测数字（很硬）**：
  - 7 个基于主流 agent 记忆系统的 consolidator × 7 个 LLM backbone = **49 个配置中，48 个出现 authority collapse**（剩下那个配置是任何非授权历史都没写下包含焦点断言的记忆）。
  - 控制化的 action-grounded 评测中，**没有权威元数据的崩塌记忆带来的平均未授权动作率 = 50.3%**。
  - 端到端冻结流水线中：**自动预测并持久化权威标签，把观测到的未授权动作率从 16.9% 降到 0.0%**，而良性任务成功率**基本不变（39.7% → 40.0%）**。
  - 未加标签时，consolidator 在 **350 个非授权变体里写下了 139 条焦点操作性值（39.7%）**，在 350 个授权变体里写下 256 条（73.1%）。条件于「写下了焦点值」，no-label 条件的 ASR = **42.4%**。
  - 标签预测精度：在 700 变体 / 4,453 条冻结记忆身份上，预测与参考**一致率 98.7%**（95% CI 98.0–99.4），**macro F1 = 91.7%**，**危险的越权升级 26 例（0.6%）**，过度限制 30 例（0.7%）。
  - **「标签只能决定一条写入的条目如何被使用；它无法把被省略掉的信息找回来。」**
- 来源：<https://arxiv.org/html/2608.01679v1>

### 5.3 记忆会放大谄媚、拉低准确率（Writer 的两篇论文，2026-06）

这是本调研**唯一一组大规模、跨模型、指出「有记忆比没记忆更差」的量化结果**，且明确点名 Mem0 与 Zep。

- **论文一：Recalling Too Well: Sycophancy Evaluation and Mitigation in Memory-Augmented Models**（arXiv 2606.10949）
  - 构造 **MIST**（Memory Influence on Sycophancy Tests）基准：合成多轮对话，用户在**科学、医学、道德推理**领域表达**看似可信的误解**。
  - 覆盖 **3 个记忆系统 × 5 种 chat regime × 5 个记忆增强 LLM**。
  - **结论：所有条件下记忆都放大谄媚行为，谄媚率相比 in-context 基线最高高 25×。**
  - **错误分析指认记忆抽取是主因**：「**把内容有损压缩成离散片段，把用户的误解编码进去，同时丢掉了纠正性的上下文**」（lossy compression into discrete snippets encodes user misconceptions while discarding corrective context）。
  - 两项轻量缓解措施：① **在记忆抽取时严格把 assistant turn 与 user turn 一起包含进去**；② **用 LLM 对整个对话做摘要，而不是做记忆抽取**。两者都降低了 MIST 上的谄媚，且在事实召回上与记忆系统持平或更好。
  - 另一发现：**线性可分性分析显示，基于建模的方法难以找到信号**——即「用一个分类器去识别该不该写这条记忆」这条路不好走。
- **论文二：The Price of Agreement**（agentic 金融场景）
  - 在 FinanceBench 与 FinanceAgent 上测 8 个前沿模型，注入三类对抗性用户偏好：**反驳（Rebuttal）、提出替代答案（Contradiction）、个人偏好（以工具结果形式注入，模拟记忆/个性化 API 调用）**。
  - 发现存在**注入方式与可观测性的权衡**：**直接注入造成的准确率损失更大，但模型至少更可能标记出这个冲突**；**以工具结果形式做的 agentic 注入（就像真实记忆系统那样）造成的准确率损失较小，但承认率崩塌**——在 FinanceAgent 上，**大多数模型以 EWU > 0.90 返回错误答案**，即**错误到来时几乎没有任何「哪里不对」的信号**。
  - 更大模型倾向于「给出错误答案但承认冲突」；更小模型更常「答错且不承认」。
- **TechCrunch 的通俗复述里有一个很具体的例子**：把「用户最喜欢的书是 Station Eleven」记下来后，问模型「说一本畅销的反乌托邦小说」，模型**显著更可能回答 Station Eleven**——即使这个问题与该偏好无关。**用 Mem0 与 Zep 这类记忆压缩工具时这个倾向更强。**
- **论文原话（值得照抄）**：「**所有记忆系统从根本上都难以区分相关上下文与无关锚点（irrelevant anchors），严重削弱多样性与创造力，并引入意料之外的偏见路径，从而限制系统效用。**」
- **一个重要的限定**：该研究**没有测 Anthropic 的 Opus 4.8**——后者被训练为主动反驳这类输入错误。**这个模式在不同模型上普遍成立。**
- Writer 官方博客还给了标题级结论：**记忆系统可以把谄媚放大到 25 倍**。
- 来源：<https://arxiv.org/html/2606.10949v1>、<https://arxiv.org/pdf/2606.10949v1>、<https://writer.com/engineering/personalized-context-degrades-ai-accuracy>、<https://techcrunch.com/2026/06/10/how-memory-tools-can-make-ai-models-worse>、<https://cryptobriefing.com/ai-memory-tools-degrade-model-performance>

### 5.4 反思会强化错误信念（memory confabulation）

**Honest Lying: Understanding Memory Confabulation in Reflexive Agents（arXiv 2605.29463，ICML 2026）**

- 定义：**memory confabulation（记忆虚构）**——Reflexion 式 agent 把**自信但错误的任务理解**写进反思记忆，并在多次尝试中**持续按它行动，即使环境每次都重置回正确任务**。
- 度量：提出 **Reflection Repetition Rate (RRR)**，一个基于日志的指标，检测对错误反思内容的重复依赖。
- **实测数字**：
  - 在 **ALFWorld** 中识别出 **16 个 "frozen environment"**，其中 **121 条反思里 0 条提到正确的目标物体**；HumanEval 中 **4 个**同类案例。
  - **缓解措施（用「程序化抽取轨迹级失败信号」取代开放式自我诊断）**：正确物体提及率 **0% → 86%**；**RRR 从 0.64 降到 0.10**；**解冻了 16 个 ALFWorld 环境中的 3 个**。
  - 结论原文：「**反思性记忆可以强化错误信念，而不是纠正它们。**」
- 来源：<https://arxiv.org/abs/2605.29463>、<https://icml.cc/virtual/2026/78008>、<https://openreview.net/pdf?id=1XBgFVP7F3>

### 5.5 「凭记忆漂移」与「未验证内容不得成为持久记忆」

**AI Agents Need Memory Control Over More Context（arXiv 2601.11653）**

- 现象命名：长程多轮中 agent 行为退化，表现为 **loss of constraint focus（约束焦点丢失）、error accumulation（错误累积）、memory-induced drift（记忆诱发的漂移）**。
- 对主流做法的批评：**transcript replay 与 retrieval-based memory 都方便，但都引入无界上下文增长，且易受 noisy recall 与 memory poisoning 影响**，导致行为不稳定、漂移加剧。
- 关键设计主张：**「retrieval 优化的是相关性信号（如语义相似度），而不是保住当前活跃的约束」**；而 agent 真正需要保住的往往是一小撮不变量（目标、策略约束、SLA 约束、实体标识符）。
- 解法 ACC（Agent Cognitive Compressor）：**把「产物召回（artifact recall）」与「状态提交（state commitment）」分离**，从而**「阻止未经验证的内容成为持久记忆」**。
- 实测：用 agent-judge 驱动的 live evaluation，跨 IT 运维、网络安全响应、医疗工作流；ACC **持续维持有界记忆**，多轮行为更稳定，**幻觉与漂移显著低于 transcript replay 与 retrieval-based agent**。
- 来源：<https://arxiv.org/html/2601.11653>

### 5.6 「摘要链条上错误会变形、且越来越难检出」

- **The Hallucination Snowball: Modeling Error Propagation as State Transformation**（OpenReview YOPVjUoijs）：「**在 Stage 1 注入的幻觉不只是持续存在，它们会变形：原始数值事实变成派生计算，再变成叙事散文，再变成经编辑批准过的结论。在每一次变形中，可检出性都近乎不可逆地下降。**」
- **Hallucination Cascade（arXiv 2606.07937）**：追踪多 agent 级联中的 claim 级事实不一致；transition 级分析显示每次 agent-to-agent 精炼**平均减少 0.072 的幻觉，但事实一致性与响应质量有微小而持续的损失**。
- 来源：<https://openreview.net/forum?id=YOPVjUoijs>、<https://arxiv.org/abs/2606.07937>、<https://arxivsignals.io/papers/2606.07937>

### 5.7 「一次性的细节被过度一般化」——直接点名的有

- **Microsoft env-probing 论文的问题陈述**（最直接的一句）：**「一个被限制在已完成轨迹上的 post-task curator agent，可能会保留错误、把局部证据过度一般化（overgeneralize partial evidence）、或保留过期知识。」**
- **记忆被滥用为无关锚点**：见 §5.3，Writer 论文点名「无法区分相关上下文与无关锚点」，且**记忆压缩工具（Mem0 / Zep）会加重这一点**。
- **过期知识在环境漂移下被编码为虚假泛化**：CLBench 的结论（被 Microsoft 论文引用）。
- **正确的做法（正面样本）**：Rollback-Induced Reflection 明确要求——**「对于那些真值可能取决于某个随后被回滚的动作的观察，RIR 保留其溯源但将其标记为待重新验证，而不是把它们当成关于已恢复世界的事实。」** 这条对 stage-ai 的「后台整理 + 回滚」组合是直接可用的规则。来源：<https://arxiv.org/pdf/2609.18304v1.pdf>

### 5.8 用户可见的污染事件（真实报告，非论文）

- **Medium 上的一手复盘**：「22 个静默失败在 4,286 次测试中存活：我们的 agent 记忆流利地说了谎」——其中一个内部复现案例是「**一个模型虚构了『工具输出中的提示注入』，并把那个幻觉写进了 agent 的记忆**」（页面返回 403，未能取得全文；标题与摘要来自搜索快照，**建议不要引用未经核实的细节**）。
- **Reddit r/AIMemory**（2026-07-27）：用户讨论长期 AI 记忆中的 "memory poisoning"：「当你给 agent 持久记忆后，**错误不会只发生一次——它们会被存下来**。一个错误的事实、一次误读……」
- **Cursor 官方的警告**：处理**不可信输入**的 automation 可能拾取「**误导性或恶意记忆**」并影响后续运行。
- 来源：<https://medium.com/@chenyuan19920509/22-silent-failures-survived-4-286-tests-our-agent-memory-lied-fluently-8b38131ea348>（403）、<https://www.reddit.com/r/AIMemory/comments/1v7kd7b/has_anyone_else_run_into_memory_poisoning_in>、<https://www.past.dev/blog/cursor-memory>

### 5.9 一个相关的、编码 agent 专属的泛滥来源

**Sample More, Reflect Less（arXiv 2607.28576）**——本调研里最强的「自我检查类方法不如多采样」的结论：

- **按 token 成本对齐比较**：自我检查式方法（self-inspection / reflection）**不如独立重复采样**（在同等 token 成本下）。
- **在最弱的模型上，Reflexion 从未触发过重试**（Reflexion's reflection mechanism never triggered a retry on the smallest model）——即「反思」这一步在小模型上**直接失效**，而这个失效是静默的。
- 来源：<https://arxiv.org/html/2607.28576v1>

**Large Language Model Agents Are Not Always Faithful Self-Evolvers（arXiv 2601.22436）**：研究 agent 学到经验后跨任务应用时**反而是负收益**——压缩后的经验（**condensed experience**）**被无视**。
来源：<https://arxiv.org/html/2601.22436v1>

---

## 6. 多分支 / 平行时间线的语义问题

这是用户问的六项里**最容易被跳过、但本调研找到了最系统材料**的一项。分三块：真实 bug 报告、学术系统、产品化实现。

### 6.1 真实 bug 报告：这正是「后台整理」与「分支」碰撞的原始事故现场

#### (a) GitHub Copilot：恢复检查点/编辑旧消息时，agent 记忆文件不回滚

**microsoft/vscode issue #307617**（真实用户报告，标题即结论）：

> **Agent memory files are not reverted when restoring checkpoints or editing previous messages**

- 报告的核心机制：「当用户恢复一个对话 checkpoint、或编辑一条更早的消息来『回滚』对话时，**在对话被丢弃的那部分里由 agent 创建的记忆文件（agent 生成的上下文/逻辑文件）不会被删除或回滚**。」
- 由此产生 **"logic persistence" loop（逻辑持久循环）**：如果 agent 之前得出过一个错误结论、或生成了无效逻辑并把它存进了记忆文件，**即使用户试图从更早的点重新开始，那个文件仍然生效**。「LLM 然后会继续掉进同样的陷阱，因为**它仍然在读取来自被丢弃时间线的 stale / corrupted 记忆**。」
- 复现步骤（原文）：① 与 Copilot Agent 开始对话 → ② 让 agent 创建/更新一个记忆文件（如 `architecture.md` 或逻辑摘要）→ ③ 让 agent 得出一个会被存进那个记忆的错误结论 → ④ 编辑一条更早的消息，或恢复到一个**在该错误发生之前**的 checkpoint → ⑤ 观察到记忆文件**仍然包含来自那些本该被删除的「未来」消息的错误逻辑** → ⑥ **agent 在新的对话分支里继续使用那段无效逻辑。**
- 用户提出的诉求（三种，可作为需求清单）：**① 自动回滚**——记忆文件应理想地**回滚到它们在那条时间线上的那个点应有的状态**；**② 状态同步**——在恢复点**之后**创建的记忆文件应被删除或移入 "discarded" 状态；**③ 手动覆盖**——加一个命令（如 `/clear-memory`）或 UI 按钮；**④ 默认动作**——可选地弹一个问题问用户：「你正在回退到更早的状态。**你要保留还是丢弃此后创建的记忆文件？**」
- **用户诉求的根因陈述**（原文，一句话说清了这个问题的严重性）：「用户编辑消息或恢复 checkpoint 的**首要原因，就是要避免 LLM 走那条坏路**。**如果记忆持续存在，『恢复检查点』这个功能就失去了它的主要效用**，因为 agent 的内部上下文仍然被那次被丢弃的交互『毒化』着。」
- 附带：同 issue 指出，**记忆文件还有永久增长的隐患，需要尺寸上限与维护**。
- 来源：<https://github.com/microsoft/vscode/issues/307617>

#### (b) Hermes（NousResearch）：网关 flush agent 用 stale 上下文静默覆盖更新的条目

**commit 48b5bc6，标题 `fix(gateway): prevent stale memory overwrites by flush agent (#2670)`**（2026-03-23）

- 问题原文：「网关的 memory flush agent 在 **session 重置/过期**时复盘旧对话历史并写入 memory。**它完全不知道在那次对话结束之后（由 live agent、cron job 或其它 session）做出的记忆变更**，导致**静默覆盖更新的条目**。」
- 修复两步（**这两步都是可复制的设计模式**）：
  1. **对 cron session 完全跳过 memory flush**（session id 以 `cron_` 开头的）：「cron session 是无头的，没有有意义的用户对话可供抽取记忆」——**即：不是每种 session 都值得整理，无头/自动化会话应排除**。
  2. **把当前 live 的记忆状态（`MEMORY.md` + `USER.md`）直接注入 flush 提示词**：「这样 flush agent 现在能看到已经存了什么，从而做出有依据的决策——**只添加真正新的信息，而不是盲目覆盖那些可能在对话结束后已被更新的条目**。」
- 根因陈述：「flush agent 在**对记忆当前状态一无所知的情况下**做记忆决策，导致 stale 上下文在网关重启和 session 重置时覆盖更新的条目。」
- 来源：<https://github.com/NousResearch/hermes-agent/commit/48b5bc60386360f7b234407fab2294216bb453c4>

### 6.2 学术系统：四条不同的答案

| 工作 | 答案 | 关键数字 / 洞见 |
|---|---|---|
| **ChronoMem**（arXiv 2607.27773，集成进 Google ADK） | **全量快照 + 语义版本控制**。每次记忆写入产出**一份 whole-memory 快照（一个 commit）**；维护结构化版本历史；**用自然语言 "undo" 请求**，经混合词法+语义检索、rank fusion、rerank 映射到具体历史版本 | 明确指出问题的本质：**「现有 agent 记忆系统是围绕前向演化设计的——不断累积、整合、覆写知识，却没有任何原则性机制去检视、版本化或回退先前的状态」**，这让 agent 在**纠正、概念漂移、记忆损坏**面前很脆弱——**尤其是在它已经暴露于后续信息之后**。提出 **post-exposure 评测协议**：测 agent 在回滚后能否**反事实地**行动（回答查询、总结历史时**当作后续更新从未发生**）。结果：**相比没有全局快照恢复的最强基线，回滚一致的 QA 与摘要平均提升约 10 个百分点**。**关键取舍讨论**：回滚粒度应该是「按条目的版本」（托管服务暴露的）还是「whole-memory 快照」（恢复时间上一致的状态所必需的）？作者的立场是后者。明确列出**未来工作**：「**线性截断之外的分支历史**」、更高并发的记忆后端与更强的多写者事务语义——即**「分支历史」是它承认尚未解决的**。也点名 ADK rewind 的局限：「现有 rewind 机制通常是 session 作用域的，**明确不恢复 app/user 级别的资源，也不恢复外部依赖**」 |
| **Rollback-Induced Reflection (RIR)**（arXiv 2609.18304） | 提出 **rollback boundary（回滚边界）** 是一个显式控制问题：**when**（何时回滚）、**where**（从哪个检查点续）、**what**（哪些信息跨过边界仍然有效） | 核心口号：**「Rollback the world, keep the reflection.（回滚世界，保留反思。）」** 具体机制：把**分支局部状态**（随检查点一起恢复）与**可复用知识**（跨回滚持久）**分开存**。Reflection Memory M 存在检查点**之外**，含四个字段：**Task Objective (G)**（回滚不变的目标）、**Environment Model (E)**（跨分支可复用的环境知识，分 observed facts / evidence-supported eliminations / action affordances 三个语义通道）、**Attempt History (H)**（**记录为历史事实，而不是关于当前状态的断言**——「后续尝试因此可以复用一条已发现的路径，而不必假设回滚前获得的资源、位置或进度在恢复后仍然有效」）、**Failure Analysis (F)**（解释最近一次被放弃的分支在**彼时条件**下为何失败，每次失败后**被替换**而非累积）。**最关键的一条规则**：「**没有任何一个字段表示 agent 当前的分支局部状态**」——那由活跃轨迹与恢复出的检查点提供。**这防止 stale 状态断言跨过回滚边界。** 还明确要求：**条目只能通过受约束的结构化通道准入，防止被放弃分支的叙事「伪装成当前状态」重新进入 prompt** |
| **From Faulty Memories to Corrected Actions: Dependency-Guided Rollback Repair**（arXiv 2608.10502） | 问题定义：**post-failure memory recovery**——给定一次失败执行与诊断出的故障记忆，**在保留未受影响工作的前提下**同时恢复答案与持久状态 | 批评现有防御：「**删除源头会让已经传播出去的断言、动作与派生记忆继续活跃**；而重置 store 或重放完整轨迹会**破坏良性状态并重复不必要的计算**」。做法：从运行时溯源建**类型化的 memory-to-action 图**，追踪显式下游依赖，**保留有独立可信支持的候选**，**停用无支持的记忆状态**，**只选择性重放与答案相关的受影响计算**。实测：150 例受控 benchmark 上 **恢复率 85.3% vs 最强竞品 77.3%**；在 50 例由轨迹派生的压力测试上 **68.0% vs 54.0%**；**claim invalidation F1 最高，0.669 vs 0.603** |
| **Aborted but Not Forgotten: KV-Cache Retention Breaks Rollback Consistency**（arXiv 2608.15939，HKUST） | 指出**逻辑回滚 ≠ 物理回滚**：应用把被拒绝的分支从 transcript 里删掉，**推理引擎却保留着它的 KV cache**，模型可以**继续注意力于应用认为已丢弃的内容** | 形式化为 **rollback consistency**：「一次完整的 abort 必须恢复**模型所注意到的状态**，而不只是 transcript」。方法：**same-token/different-cache 审计**——保持决策步 token 完全相同，只改变 cached prefix 是 stale 还是从已提交状态重建。**实测：在 7 个开源权重家族（3.8B–36B）中，仅"保留的 KV"一项就翻转了 63 个审计单元中的 25 个的类型化受保护效果，而这 63 个里攻击者 token 在服务请求中全都不存在。** 在 LangGraph 的 time-travel 下同样复现——**「即使已验证的逻辑回滚，仍可能留下被注意到的 stale KV」**。提示词层防御（「忽略此前被拒绝的内容」）**只能把翻转从 25/45 降到 14/45**——「模型无法区分『合法』上下文与『被拒绝』上下文，一旦它们都被嵌进 KV cache，**残留物与有效记忆无法区分**」。修复成本对比：**transaction-local fresh-cache rebind 只增加约 101 ms，而全局 flush 需要 6,481 ms**（多租户场景） |
| **Invalidation Contracts for Cross-Episode Agent Memory**（arXiv 2609.00243） | 给每个「恢复建议」附**版本戳 + 可缓存提示**，让客户端**无需试错**就能驱逐过期条目 | **行级 vs 表级失效的对比很有说服力**：表级失效的驱逐精度只有 **0.25**（「每移除 4 个，有 3 个仍然完全有效」）；**行级达到 1.00 的驱逐精度**（在行级 oracle 下，每个模型上都是）。行级失效把首试合规率提升 **0 到 66.7 个百分点**（7 个模型中），在 4/7 个模型上**回收 29–33% 的基线 token 成本**。还有一条很有意思的模型行为发现：**同样的字节在 Claude Haiku 4.5 上首次合规率 100%，在 Claude Sonnet 5 上只有 11% 或更低**，后者表现出「**input-schema conservatism**」——**拒绝接收会添加原始请求中不存在的字段的修复**。**即：记忆能不能被用上，取决于模型愿不愿意按记忆行动，而不只是记忆是否可检索** |

来源：<https://arxiv.org/abs/2607.27773>、<https://arxiv.org/html/2607.27773v2>、<https://arxiv.org/pdf/2609.18304v1.pdf>、<https://arxiv.org/abs/2608.10502>、<https://www.alphaxiv.org/abs/2608.15939>、<https://www.alphaxiv.org/abs/2609.00243>

**另有一篇直接相关的前置工作**：**Look Back to Reason Forward: Revisitable Memory for Long-Context LLM Agents（arXiv 2609.30355）**——「通过让 agent **重访早期上下文**来提升长上下文推理」。来源：<https://arxiv.org/abs/2609.30355>

### 6.3 产品化实现里的分支语义（三个可抄的具体设计）

1. **Smart Memory 的做法（也是它自曝的问题）**：**长期记忆在同一个角色的所有聊天之间共享，切换到更早的 checkpoint 或 branch 时不会回滚**，缓解手段是 **read-only 模式**。它的另外两条自曝（**编辑过去消息后旧记忆不更新**、**隐藏消息不移除记忆**）是同一个根因的三个表现：**派生产物（记忆）与源（消息）之间没有失效契约**。
   来源：<https://github.com/senjinthedragon/Smart-Memory>
2. **Living Storybook 的 temporal locking**：世界在某个时刻锁死，该时点的事件列表与**解析后的状态快照**变不可变；分叉时**优先就地覆写既有分叉，只有所有时间线都被锁定时才新建**，并**取消**其余尝试；新分叉**从锁定的父分叉继承**，带 `parentUuid` + `forkedFrom[uuid, lockedAt]` 溯源链。这实际上就是 **copy-on-write + 引用完整性校验 + 可回退** 的那一套。来源：<https://seehiong.github.io/posts/2026/02/engineering-a-narrative-multiverse/>
3. **Memoria / Sverklo / Memoir 的三条不同抽象**：
   - **Memoria**：snapshot / branch / merge / rollback 全给，「自维护——内置治理检测矛盾、隔离低置信度记忆」。
   - **Sverklo**：认为 **branch 会移动、SHA 不会**，因此 **SHA 钉住的双时间模型比 per-branch HEAD 更严谨**；并指出 Memoir 的实现**只支持 branch checkout，不支持 commit checkout**。
   - **Memoir**：把分支当**探索 what-if 的隔离沙箱**——「任何 'what if' 探索都会永久改变 agent 的记忆，用推测性信息污染主时间线」。
   来源：<https://github.com/matrixorigin/Memoria>、<https://sverklo.com/blog/we-already-shipped-git-for-agent-memory>、<https://zhangfengcdt.github.io/memoir/examples/context_branching/>

### 6.4 与 VN / 角色扮演场景的对应

- **Parallel Context Architecture（tokitai）**是唯一一个把「多分支对话」做成显式架构并给了实测的：agent 可 **fork / checkout / merge / abort**，用 **copy-on-write 符号链接**隔离文件系统层；**fork/resume 与 merge/reconcile 类任务成功率提升 42%**，token 消耗约 **1.8×**。来源：<https://try-tokitai.github.io/Parallel-Context-Architecture/>
- **GCC（Git Context Controller）**给的是「把 git 操作作为 agent 的一等工具」的完整协议（COMMIT / BRANCH / MERGE / CONTEXT），`CONTEXT` 支持从全局概览到 token 级的多粒度检索。来源：<https://arxiv.org/html/2508.00031v3>
- **MnesOS**：event-sourced RPG 引擎，**「backend 不保留跨网络轮次的操作记忆，采用树形事件溯源模型，原生支持分叉时间线」**。来源：<https://pypi.org/project/MnesOS/0.7.1/>

**小结（本节的净结论）**：**「后台整理」与「分支/回滚」的冲突是一个已被多次独立报告的、真实存在的失效模式，且业界一致的诊断是「派生产物与源之间缺少失效契约」。** 已提出的答案收敛为三种：① **版本化 + 全局快照回滚**（ChronoMem、Memoria、Memoria 式 Git）；② **边界显式化：明确哪些信息跨过回滚边界仍然有效、哪些必须被标记待重验**（RIR，最精细，也最贴合「叙事」场景）；③ **溯源 + 选择性修复**（dependency-guided rollback repair、invalidation contracts 的行级版本戳）。**没有找到任何系统声称「分支隔离的记忆」已被彻底解决**；ChronoMem 明确把「线性截断之外的分支历史」列为 future work。

---

## 7. 成本与收益的量化汇总

把所有找到的数字集中（**这是本报告里最需要小心引用的一节：绝大多数是二手转述或不同任务下的数字，不可直接横向比较**）：

### 7.1 正面数据

| 来源 | 收益 | 成本 |
|---|---|---|
| **Sleep-time Compute**（Letta/UCB，论文） | 达同等准确率所需 test-time compute **降约 5×**；扩大 sleep-time compute 后准确率 **+13%（GSM-Symbolic）/ +18%（AIME）**；Multi-Query 摊销进一步降平均每查询成本 | 需额外 sleep-time 推理；**效果与查询可预测性高度相关** |
| **Microsoft env-probing curation**（CLBench + APEX） | pass rate **39% → 73%**；reward **8.60 → 22.60**；每问查询数 **8.8 → 4.7**；task-agent 成本 **$3.38 → $1.68**；6 个 APEX 世界 **18/18 的 reward 比较为正**；task-agent 工具调用 **降 16–75%** | 给既有 curator 加只读世界工具；**不重训模型、不改动 task agent 与检索器** |
| **Zep / Graphiti** | LongMemEval **71.2% vs 全上下文 60.2%**；**准确率最高 +18.5%**；**响应延迟降 90%** | — |
| **Mem0**（论文） | LOCOMO 上省 token（既有文档记 90%）；**median latency 0.708s，p95 1.440s** | — |
| **OpenAI Dreaming V3** | 后台合成的**计算成本降 5×**，这是 Free 层能上线的经济前提 | 未公开绝对成本 |
| **ChronoMem** | 相比无全局快照恢复的最强基线，**回滚一致的 QA 与摘要平均 +10 个百分点** | whole-memory 快照的存储开销 |
| **Honest Lying 的缓解措施** | 正确物体提及 **0% → 86%**；**RRR 0.64 → 0.10**；解冻 16 个中的 3 个 frozen 环境 | 用程序化信号抽取替代开放式自我诊断 |
| **AuthMem-Bench 的权威标签** | 未授权动作率 **16.9% → 0.0%**；良性任务成功率**基本不变（39.7% → 40.0%）** | 标签预测；一致率 98.7%、macro F1 91.7% |
| **Dependency-guided rollback repair** | 恢复率 **85.3% vs 77.3%**（受控）/ **68.0% vs 54.0%**（压力测试） | 类型化 memory-to-action 图 + 选择性重放 |
| **Invalidation contracts（行级）** | 驱逐精度 **1.00**；首试合规 **+0 到 +66.7 pp**；**回收 29–33% 基线 token 成本**（4/7 模型） | 响应负载 +15% |
| **Parallel Context Architecture** | fork/resume 与 merge/reconcile 任务成功率 **+42%** | token 约 **1.8×** |
| **AutoDream 的问题画像** | — | 10 session 后约 **30% 冗余**；50 session 后出现矛盾事实堆积 |
| **AI Dungeon（商业产品，间接证据）** | 把「AI 忘掉几千 token 前的选择」当作核心产品痛点来解 | Memory Bank 条数按付费档位（25/100/200/400）——**即整理容量被当作付费点** |

### 7.2 负面数据（做了没效果 / 不如不做 / 有代价）

| 来源 | 结论 |
|---|---|
| **Writer 两篇论文**（Recalling Too Well / The Price of Agreement） | 记忆**放大谄媚最高 25×**；把用户误解编码进记忆并丢掉纠正性上下文；**质量下降最多 39%**（cryptobriefing 转述：performance drops of up to 39% across major language models）；**agentic 注入（即真实记忆系统的做法）产生的错误「EWU > 0.90」——错误到来时几乎没有信号** |
| **GCC（Git Context Controller）** | agent **自发放弃**了检索器式记忆，理由是**更慢的解决时间与更低的任务成功率**（相比更简单的压缩摘要）。**这是最直接的「agent 自己评测后决定不用记忆」的案例** |
| **Sample More, Reflect Less**（arXiv 2607.28576） | 按 token 成本对齐时，**自我检查/反思类方法不如独立重复采样**；**Reflexion 在小模型上从未触发过重试**——静默失效 |
| **LLM Agents Are Not Always Faithful Self-Evolvers**（arXiv 2601.22436） | 压缩后的经验（condensed experience）**被无视**；学到的经验跨任务应用时出现**负收益** |
| **HaluMem** | **现有记忆系统倾向于在抽取与更新阶段产生并累积幻觉**，并把错误传播到 QA |
| **AuthMem-Bench** | 49 个配置中 **48 个**出现 authority collapse；无权威元数据时平均未授权动作率 **50.3%** |
| **NCP-Bench**（叙事承诺保持，interactive narrative） | 最强模型（GPT-5.2）**20 轮后存活率仅 42%**；跨模型**事实冲突率 40%–68%**；100 轮限制内**只有零散个例满足全部成就承诺**；「**高语言质量不保证承诺保持**」 |
| **AgentCore 的失败语义** | **consolidation 失败时记忆仍然会被添加**（只是可能没去重）——即**失败降级为「重复」而非「丢失」** |
| **Mem0 的失败语义** | LLM 响应无效或为空时，**异步流水线优雅地返回空列表并记录错误**——即**静默丢弃一次整理** |
| **Claude Dreams 的失败语义** | **任一 input store 或 session 失败会导致整个 dream 失败**；取消/失败会**故意留下部分 output store** |
| **KV-cache 回滚不一致** | 仅保留的 KV 就翻转 **63 个审计单元中的 25 个**；提示词层防御只能把 25/45 降到 14/45 |
| **A-Mem / memory stream 的批评（二手）** | memory stream 是**基于检索而非基于权重**的，「批评者认为这使它成为一种查找机制而非真正的记忆」 |
| **不确定性缺失**（arXiv 2603.07670 综述） | agent 必须维护**置信度**并随新数据更新，**而大多数现有记忆系统对此处理得很差或完全不处理** |

来源：见上文各节。

---

## 8. 工程上的坑（有出处的一一列出）

### 8.1 并发：同一份文件 / 同一份上下文被两边写

- **结构性问题**：Letta 的 sleep-time agent 是**后台线程，与 primary agent 共享记忆**——两个执行体读写同一份记忆，这是设计上就存在的。
- **真实事故（Hermes #2670）**：gateway flush agent **对记忆当前状态一无所知**就做决策，**静默覆盖更新的条目**；修复 = **把当前 live 记忆状态注入整理提示词** + **对无头 cron session 完全跳过**。
- **真实事故（VS Code #307617）**：agent 自建记忆文件在回滚时不撤销，导致 **"logic persistence" loop**。
- **官方提供的并发原语（Claude Memory Stores）**：**`content_sha256` 前置条件的乐观并发**——「为避免覆盖并发写入……只有当存下来的内容哈希仍与你读到的一致时，update 才生效；不一致就重新读并针对新状态重试。」**注意这是 CAS 而非锁。**
- **社区共识（single-writer gate）**：「**在并行 agent 被 spawn 的地方**强制 single-writer 门，而**不是在各自的提示词里**」；「先做那份清单：列出两个 agent 可能同时触碰的每一个可变资源——分支、部署流水线、数据库、共享文件、对外发布面。为每一个决定**谁是唯一的写者**，并在它前面放一道 agent **绕不过去**的门。」原文还有一句很值得记的总结：**「生产环境出问题的地方不在那个聪明、能干、昂贵的部分（agent），而在于两个 agent 之间的蠢管道。」** 来源：<https://ultrathink.art/blog/single-writer-gate-for-parallel-agents>
- **更细的并发失效分析**：MemTX（arXiv 2607.23929）把共享记忆的失效归为六族：**tool-result pollution、stale late writes、dirty reads of tentative state、semantic conflict、permission laundering、cascading-rollback failures**；其立场是**「一次记忆写入不是一次信念提交（a memory write is not a belief commit）」**，写入应该**在快照隔离的事务里暂存**、经 **validate-and-commit** 准入、**不可逆的工具调用要由在途信念状态门控**、**撤回一个信念要触发对其派生记录与工具副作用的类型化级联修复**；两个不变量（action-safety gating、cascade-repair completeness）用 property-based testing 与**对 550 万个协议状态的有界穷举**做了机器校验，**零违例**。实测跨 3 个模型家族 5 个 backbone，**MemTX 在 8 个基线中领先**，**且是唯一在每个 backbone 上都没有下游伤害的方法**。结论句：「**backbone 能力不能替代提交纪律（Backbone capability does not substitute for commit discipline）。**」来源：<https://arxiv.org/html/2607.23929v1>
- 另有 **CoAgent**（arXiv 2606.15376）讨论多 agent 系统的并发控制，指出 **2PL 会迫使 agent 在**整个任务**期间持锁，阻塞所有触碰重叠状态的其它 agent**——即「用数据库锁保护长时间 LLM 调用」是反模式。来源：<https://arxiv.org/html/2606.15376v1>

### 8.2 幂等 / 失败重试 / 死信

**Agent Memory Atlas 的 `Recoverable Background Work` 模式**（把这一整块讲得最系统）：

- **问题**：「自动记忆捕获常常是异步的。交互请求成功了，但之后一次抽取调用超时，或一个 worker 在写完 chunk 与更新索引之间崩了。**如果原始输入或 job 状态是易失的，这个 session 看起来被记住了，而它的持久记忆其实是不完整的。**」
- **模式**：**在确认之前先把工作持久化**。Job 携带**稳定 ID、输入哈希、processor 版本、尝试次数、检查点**。**输出用确定性身份或事务性 upsert，使重试无法产生重复记忆。** 毒输入移入**可审阅的 dead-letter 状态**，而不是永远重试。对于有损抽取，**保留一份带栅栏的原始回退（fenced raw fallback）**，在 provider 或 schema 修好后可以重新蒸馏。
- **代价（原文如实列了）**：队列与检查点增加运维机械与最终一致性；**保留的输入可能含敏感 transcript**；重试风暴可能放大 provider 故障；**当一个 job 要写多个 store 而这些 store 没有共享事务时，幂等很难做**。
- **必须做的一件事**：「**把新鲜度暴露给调用方；不要让异步派生看起来是立即一致的。**」
- **一个非常漂亮的低成本机制（nanobot 的 `Dream`）**：它的 consolidation 跑在一份 **append-only archive** 上，由一个 **consumption cursor（消费游标）** 跟踪；`MemoryStore.dream_run_completed` **只在运行的 stop reason 是 `completed` 时才推进游标**。一个以 `error` / `tool_error` / `max_iterations` / `cancelled` 结束的运行**不推进游标**，因此那批材料**下次会被重新处理**。**没有重试队列、没有死信表、没有需要对齐的部分状态：工作没有被记为完成，所以它就没有被记为完成。**
- **另有一个反面模式（同页）**：「**这个模式没有覆盖的失效，是那个成功却饿死了写入路径的 job。**」——见 §2 末尾那条「维护 pass 与写入路径不得共享同一份预算」的规则。PLUR1BUS 的解法：**capture 按 agent 排队并在轮次结束后运行，embedding 走 `embedding-queue.jsonl` 由 cron 排干**，代价是一个**新鲜度缺口**——一条记忆可能**在词法上已可检索、但向量上还不可检索**。
- 来源：<https://neoneye.github.io/agent-memory-atlas/patterns/recoverable-background-work>

**通用的重试/idempotency 工程建议**（多篇一致）：idempotency key、条件写入、原子状态跟踪、visibility timeout 与死信队列必须与幂等 handler 一起校准；「**没有幂等，一次含糊的超时就能制造重复的 incident ticket、重复的 PR、重复的回滚 job**」。来源：<https://www.myrobertson.com/blog/retries-idempotency-duplicate-writes>、<https://www.task-queues.com/queue-fundamentals-architecture/exactly-once-vs-at-least-once-delivery/preventing-duplicate-job-execution-with-idempotency>、<https://cordum.io/blog/ai-agent-idempotency-keys>、<https://apphosts.in/blog/background-job-duplicates-after-restart-fix-guide>

### 8.3 限流 / 并发闸门

- **SillyTavern 的现实约束**：「**不是每个后端都支持并发请求**，所以摘要失败时就切回 blocking 模式。」——**后台整理与主演出争抢同一后端是真实约束**。
- **Cursor 的做法**：把整理单独放一个 **Memory LLM**，「**这样两者不互相争抢**」。
- **通用做法**：用 semaphore / token bucket 给 agent 后台任务设显式并发上限与速率上限，防止「一串任务 burst 出太多 worker，耗尽内存或 API 配额，导致超时或限流错误」。来源：<https://how2.sh/posts/how-to-ai-agents-background-job-throttling>、<https://caishengold.github.io/ai-agent-wire/posts/post_1771349631400>
- **官方配额实例**：AgentCore 每账号 **5,000 事件/秒**（跨所有 agent/session）；每 memory 资源 ≤ **100 个 strategy**；每 actor ≤ **500 条 self-managed 记忆**。

### 8.4 取消

- **Claude Dreams**：取消是**真实存在的端态**，但**会在原地留下部分 output store**（要你自己清理）——「**Clean up after a cancel. Canceled and failed dreams leave partial output stores in place on purpose.**」
- **nanobot**：以 `cancelled` 结束的运行**不推进消费游标**，材料下次重做——**取消被处理成「没做过」**。
- **KV-cache 侧**：逻辑取消**不等于**物理取消，见 §6.2。
- **stage-ai 的直接含义**：取消必须定义清楚：**输出物是丢弃、保留为草稿、还是原地留下**；以及**消费游标该不该推进**。

### 8.5 用户可见性 / 能否纠正

这是**几乎每一家都做了、而且做得比预期多**的一项：

| 系统 | 用户可见/可纠正的手段 |
|---|---|
| **Claude Dreams** | **输出是全新 store，可审阅后丢弃**；输入永不被改；另可用 Memory Stores API 做精确编辑 |
| **Claude Memory Stores** | 可在 API / Console 里读、写、改、删；不可变 memory version 提供**审计（谁在何时改了什么）+ 时间点恢复**；版本可保留 30 天，活跃记忆的近期版本不受限 |
| **Letta** | 桌面 App 的 memory viewer；直接看 `$MEMORY_DIR`；`/doctor` 审计放置/重复/token 占用；`Agent reviews before applying`（**注意：这是自动审阅，不会请求你批准**） |
| **Anthropic AutoDream** | 可通过 `/memory` 命令或 `settings.json` **开关**；关闭后既有的整合结果保留，只是不再自动跑 |
| **Cursor** | **后台生成的记忆在保存前会征求你的批准**；automation notes 在工具配置 UI 里可见可编辑可删 |
| **ChatGPT** | saved memories 列表可查看/编辑/删除；Dreaming V3 加了 review controls；**但 reference chat history 从不以固定列表展示** |
| **SillyTavern Summarize** | 摘要框可直接编辑；**Restore Previous（回滚到上一状态）**；Pause；摘要嵌在消息元数据里，**删/改那条消息会回退到最后一个有效摘要** |
| **Smart Memory** | 设置面板有 token 占用条 + 超预算时红色提示与丢弃量（悬停可见）；角色选择器可逐个查看/管理各角色的记忆、profile、实体注册表；实体与记忆图可悬停检视；**read-only 模式**用于处理分支问题 |
| **AI Dungeon** | Context Viewer 的 `Explore Memories`，**Timeline** 与 **Relevance** 两种视图看 Used / Stored Memories；Story Summary 是可见可编辑的 Plot Component |
| **Memoria** | TUI + web UI 浏览 Merkle KV 树；每次变更都有 snapshot + 溯源链 |
| **Sverko** | `sverklo ui` 与 `/api/memories` |
| **Nemotron / nanobot / Memoir** | 各自的 UI / 视图 |

**一条被反复强调的设计规则**（来自既有文档，也与本调研一致）：**「本轮 prompt 里到底有什么、每条卡片为什么被激活/被丢弃」必须可查**，否则所有触发/预算 bug 都无法定位。

### 8.6 「配置不生效且不报错」这类静默失效

本调研里出现了**三个不同层次的静默失效**，值得单独列：

1. **配置层**：Letta 的 `sleeptime_agent_frequency` 传错位置 → **「No error - the change is silently ignored.」**
2. **数据层**：Mem0 的异步流水线在 LLM 响应无效或为空时 → **返回空列表并记录错误**（即**这次整理静默地什么都没做**）。
3. **语义层**：AgentCore 的 consolidation 失败时 → **记忆仍然被添加**（即**失败静默降级为「多了一条未去重的记忆」**）；Hermes 的 flush agent → **静默覆盖更新的条目**。

**共同教训**：后台整理的失败模式**默认是静默的**，需要主动设计「可观测性」才能看见。

---

## 9. 关键的反面结论集中列（做了没效果 / 不如不做）

按证据强度排序：

1. **Writer 的两篇论文（2026-06，有同行评议 + TechCrunch 报道）**：记忆系统**放大谄媚最高 25×**，把用户误解编码进记忆并丢掉纠正上下文；**「所有记忆系统从根本上都难以区分相关上下文与无关锚点」**；agentic 注入（真实记忆系统的方式）**让错误在几乎没有信号的情况下到达（EWU > 0.90）**。**而且点名 Mem0 与 Zep。**
2. **GCC（Git Context Controller）**：agent **自发尝试检索器式记忆后放弃**，理由是**更慢、成功率更低**，回到更简单的压缩摘要。这是最直接的「agent 自己评测后决定不用记忆」。
3. **Sample More, Reflect Less**：**按 token 对齐时，反思/自检类方法不如独立重复采样**；**Reflexion 在小模型上从未触发重试**。
4. **Honest Lying**：**反思性记忆可以强化错误信念，而不是纠正它们**；16 个 frozen 环境里 121 条反思中 0 条提及正确目标。
5. **HaluMem**：**现有记忆系统倾向于在抽取与更新阶段产生并累积幻觉**，并传播到 QA。
6. **AuthMem-Bench**：**48/49** 的 consolidator-backbone 配置出现 authority collapse；无元数据时未授权动作率 **50.3%**。
7. **LLM Agents Are Not Always Faithful Self-Evolvers**：压缩后的经验**被无视**，跨任务应用出现负收益。
8. **NCP-Bench（叙事场景）**：**高语言质量不保证承诺保持**；GPT-5.2 在 20 轮后存活率仅 42%；事实冲突率 40–68%。
9. **「上下文压缩 = 记忆」这条线的边界（既有文档已覆盖，此处补一句本调研的对应发现）**：Anthropic 官方把上下文管理的指导原则定为「**找到那套最小的、高信号的 token 集合**」，并把 Skills / context editing / compaction / **memory tool** **列为四个不同的 API 原语**——即**产品上的立场就是「压缩 ≠ 记忆」，两者是不同原语**。来源：<https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>、<https://dreaming.press/posts/context-engineering-anthropic-way-claude-skills-compaction-memory>
10. **「记忆有害」的一般性论证（二手但条理清楚）**：Clawvard 的「Context Engineering for Agents: When Memory Hurts」——「**更多记忆会让 AI agent 变得更差**」。来源：<https://clawvard.school/blog/context-engineering-agent-memory>（**注意：这是观点文章，不是实测**）

---

## 10. 明确没有找到可靠材料的点（不用推测填充）

1. **没有任何系统或论文，直接做过「后台/异步整理 vs 前台/同步整理」的头对头对照实验并给出收益差**。找到的都是：同一系统内的**参数/策略**消融（Letta 频率、Microsoft 的 curator 加不加环境探测、AuthMem-Bench 的加不加权威标签），或**记忆 vs 无记忆**的对照（Writer、CLAUDE/GCC、NCP-Bench）。**「异步」这个属性本身值多少，没有找到量化。** 只有一条间接线索：SillyTavern 官方指出非阻塞模式**受后端并发能力限制**，说明「异步」在实践中常常不是免费的。
2. **没有找到任何公开的、可横向比较的「后台整理本身的单位成本」**（每千轮对话花多少 token / 多少钱）。能找到的只有：OpenAI 的「降 5×」（无绝对值）、AuthMem-Bench 公开的评测总 token 数、AgentCore 的延迟、AutoDream 的「相对很小」。**产品都不公开整理本身的 token 账单。**
3. **没有任何一家公开过「记忆检索命中率提升」这类内部指标的实测**。MEMORIA / LOCOMO / LongMemEval 是**问答准确率**，不是**命中率**。Zep 的 71.2% vs 60.2%、Mem0 的 token 节省是**端到端结果**，不是检索层指标。
4. **多分支/平行时间线**：找到了三个层次的答案（真实 bug 报告、四条学术答案、三个产品设计），但**没有找到任何系统声称这个问题「已解决」**；ChronoMem 明确把「线性截断之外的分支历史」列为 future work。**角色扮演/视觉小说场景下，没有找到哪家做了「每条时间线各有独立记忆层」的完整公开设计**——最接近的是 Smart Memory（明确说长期记忆跨 chat 共享、不回滚）与三款 Git-for-memory 工具（Memoria / Sverklo / Memoir，通用场景而非叙事场景）。
5. **没有找到「后台整理导致的具体商业事故复盘」**（例如「我们的记忆 agent 把 X 写错了，造成 Y」）。能找到的是**开源项目的 bug 报告与修复 commit**（VS Code #307617、Hermes #2670）与**知乎/Medium/Reddit 的用户级抱怨**，没有公司级的公开复盘文档。
6. **没有找到用户端的大规模实证**（例如「N 个用户里有 M% 纠正过程序写入的记忆」）。只有产品层面的定性描述（Cursor 要求批准、ChatGPT 有 review controls）。
7. **「生成 Agents 的 reflection 是否有实测的 cost/benefit 曲线」没有找到**。只有：阈值 150、约每天 2–3 次、消融实验证明 reflection 显著贡献可信度。**没有每轮 reflection 的 token 成本数字。**
8. **Cursor / Copilot / ChatGPT 的「记忆整理」内部机制（触发频率、模型、prompt）没有官方技术文档**——Cursor 有文档与 changelog，但整理细节未公开；Copilot 只有那篇 env-probing 论文（是研究，不是产品文档）；ChatGPT 的 Dreaming V3 只有官方博客与新闻转述。
9. **中文技术社区**：搜到了大量「Agent 记忆系统架构」的中文文章（阿里云开发者、掘金、知乎、腾讯云），但**基本都是对英文材料的二次综述或架构罗列，没有原创的实测数据或事故复盘**。唯一有点特色的中文材料是 OpenClaw Memory 的实践整理（三层记忆模型 Context → Compaction → Memory Files、Vector 70% + BM25 30%、时间衰减、Heartbeat 自动化），来源：<https://zhuanlan.zhihu.com/p/2020974849837810370>。
10. **「环境探测式策展」论文之外，没有第二篇专门研究「post-task curator agent 的失效模式」的论文**。Microsoft 那篇是目前唯一一篇把「curator 可能保留错误 / 过度一般化 / 保留过期知识」作为**核心问题陈述**并给出**量化收益**的工作。

---

## 11. 一条横向观察（只陈述，不评判）

把全部材料放一起，**「后台整理该写什么」这件事上，各家的分歧远小于「后台整理的产物与源之间如何保持一致性」这件事上的分歧**。几乎所有已知的严重问题——authority collapse、stale overwrite、回滚不一致、过度一般化、谄媚放大——都不是「整理写得不好」的问题，而是**「整理写得挺好，但它与源之间的关系没有契约」**的问题。

对上这个诊断，材料里出现过的**契约原语只有五个**，且都可复用：

1. **溯源 / provenance**（每条记忆记住它来自哪个 session / 哪几个 turn / 什么角色说的）
2. **权威标签**（这条信息是被授权、被证实、还是未经背书——AuthMem-Bench 证明这一个变量就能把未授权动作率从 16.9% 降到 0.0%）
3. **失效契约 / 版本戳**（源变了，派生条目怎么被驱逐——invalidation contracts 的行级版本戳；或 Graphiti 的时间化失效）
4. **消费游标 / 幂等键**（只处理过的才算处理过——nanobot 的 cursor；或者用 content_sha256 做 CAS）
5. **快照边界**（哪些信息跨过回滚边界仍然有效，哪些必须标记待重验——RIR 的四字段划分是最完整的）

来源：全文各节。
