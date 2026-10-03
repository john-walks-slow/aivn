# 长篇 LLM Roleplay / Galgame / 视觉小说引擎的记忆系统与上下文管理 SOTA 调研

> 调研日期：2026-10-04
> 调研目标：为 stage-ai 的 D7 三层记忆（always / index / archive）+ 纪元压缩（epoch compaction）寻找可落地的改进机制。
> 调研方式：本地聚合搜索（degoog：Brave + DuckDuckGo + Google CSE + Wikipedia）+ 语义搜索（exa）+ 原文抓取。共约 20 轮检索、30+ 篇原文抓取。
> 说明：本报告只做事实汇总与来源标注，机制是否采纳由主线决策。

---

## 0. 先把术语对齐（后续全文沿用）

| 术语 | 本报告中的含义 |
|---|---|
| **世界书 / lorebook / World Info / Story Card** | 「关键词触发的常驻知识库」这一族机制的总称，各家叫法不同 |
| **常驻条目（constant / Always On / 蓝灯）** | 不看关键词、每轮都注入的条目 |
| **触发条目（keyed / 绿灯）** | 关键词命中最近 N 轮对话时才注入 |
| **插入深度（depth / insertion position）** | 条目在最终 prompt 里的落点（顶部 / 底部 / 相对某条消息） |
| **token 预算（budget / context %）** | 条目族共享的注入配额，超了按优先级静默丢弃 |
| **递归激活（recursion / cascading）** | A 条目内容里出现 B 的 key，从而链式激活 B |
| **叙事状态（narrative state）** | 结构化、可判定的故事世界事实集合（与「叙事文本」相对） |
| **摘要树（hierarchical summary）** | 事件 → 场景 → 剧情线 → 纪元的层级摘要，每个高层节点指回下层 |

一个贯穿全部调研的核心共识（多家独立得出）：**「故事」（narrative，时序事件描述）与「状态」（state，某一时刻的系统快照）必须分开存储**。把力量值、物品、任务进度、NPC 关系交给自然语言摘要去保管，必然丢失精确数值与逻辑关系。

---

# 1. 业内同类系统各自怎么做

## 1.1 AI Dungeon（商业 RP 平台里文档最透明的样本）

这是唯一一家把**完整上下文装配顺序、预算切分比例、裁剪优先级**公开写进帮助文档的产品，对 stage-ai 的 A/B 区装配最有直接参考价值。

### 上下文组成与装配顺序（官方原文）

上下文由以下元素拼成，**组装顺序**为：

1. Instructions（作为 system prompt 发送）
2. Plot Essentials（原 Memory）
3. Story Cards
4. Story Summary
5. Memory Bank
6. History（过去所有 action）
7. Author's Note
8. Last Action
9. Front Memory（给脚本用的）

官方给出的实际拼接模板：

```
{Plot Essentials}
World Lore:
{Story Card Description 1}
{Story Card Description 2}
{Story Card Description 3}
Story Summary:
{Story Summary}
Memories:
{Memory 1}
{Memory 2}
{Memory 3}
Recent Story:
{Action 1}
> {User Input ('Do'/'Say') 1}
{Action 2}
> {User Input 2}
{Action 3}
[Author's note: {AuthorsNote}]
> {Last User Input} /OR/ {Last Action}
{Front Memory (for Scripting)}
```

### 预算切分与裁剪优先级（非常具体）

AI Dungeon 把元素分成 `Required` 与 `Dynamic` 两类：

**Required**（Instructions、Plot Essentials、Story Summary、Author's Note、Front Memory、Last Action）：
- 整体上限为**上下文大小的 70%**；
- 若 Required 之和超过 70%，按优先级保：Front Memory 与 Last action **永远完整保留**；其余按 **Author's Note → Plot Essentials → AI Instructions → Story Summary** 顺序塞入，塞不下的从**尾部截断**，更低优先级的元素**完全不包含**。

**Dynamic**（Story Cards、Memory Bank、Story History）：瓜分 Required 之后剩余的那部分：
- 约 **25% 给命中的 Story Cards**；
- 约 **50% 给 History（如果 Memory Bank 关闭则最多 75%）**；
- 约 **25% 给 Memory Bank**。

**Story Cards 的选取规则**：按触发词出现的**新近度 + 频率**排序取前若干条；评估时**至少回看 4 个 action**；但如果给 Story Cards 的预算是 500 token 以上，则用 `可用 token 数 ÷ 100` 决定回看多少个 action（例如 900 token → 回看 9 个 action）。

**Memory Bank 的选取规则**：用「与最近一个 action 的相关性」排序，塞满分配到的 token 为止。

### (a) 世界设定随剧情演进的写入与更新

- **Memory System = Auto Summarization + Memory Bank**，官方明确说是「借鉴 Voyage，用摘要模型、embeddings、向量」实现。
- **Auto Summarization** 自动把旧剧情压成摘要；**Memory Bank** 是「每过若干 action，由另一个 AI 模型**并行**写一条记忆」。用户可手动编辑（官方特意说明：Voyage 偏传统 RPG，有 game state 追踪 health/quests/inventory，但 AI Dungeon **故意没有搬过来**，因为它是协作叙事而非 RPG —— 这是产品选择，不是技术做不到）。
- **Memory Bank 容量受限**（Free 25 / Champion 100 / Legend 200 / Mythic 400 条）—— 这是「有界记忆」的一个商业实现样本。
- **Story Cards 手动创建 + AI 生成**：有 Story Card Generator，可填 `Command`（例如 "Describe {{title}}, including a hidden secret or mystery."）、`Additional Generation Context`、`Entry Formatting`（None / `{}` / `[]`）；**`Log Generations in Notes` 会在重生成 Entry 时把旧 Entry 留存在 Notes 里**，用户可从中挑回想要的信息 —— 这是一种**朴素但真实存在的版本管理**。
- 官方建议「随时更新 Story Cards 以反映剧情变化」。
- 第三方 mod 把「写卡」自动化：**AutoCards / MagicCards** 会在冒险过程中自动生成并更新剧情相关的 Story Card；**Inner Self** 给角色加记忆、目标、秘密、规划与自省。

### (b) 角色关系/变化的追踪

- AI Dungeon **不做结构化关系追踪**（官方明说没搬 Voyage 的 game state）。关系只能塞进 Story Card Entry 或 Plot Essentials，靠自然语言承载。
- 这是一个**反面样本**：官方自己也承认「AI 说了但没记住 / 卡片太长时只挑一部分用」。

### (c) 长上下文的压缩与召回

- 压缩：Auto Summarization（摘要）+ Memory Bank（离散记忆条目）。
- 召回：Memory Bank 用相关性检索；Story Cards 用 trigger 命中 + 新近度/频率排序。
- 官方给的**关键约束**：「Story Cards 触发不是即时的 —— 如果 AI 在回复中途触发了某张卡，它要到**下一次**输出才能看到卡片内容」。
- 官方给的**已知弱点**：「Entry 太长时 AI 不会转述全部信息」，且「**AI 根本不知道 Story Cards 存在**，只有 trigger 命中时才在上下文里看到一段 'World Lore:' 开头的文本」。

### (d) 记忆冲突与版本管理

- 没有自动冲突消解。靠**人工编辑**：Story Cards「随时可编辑，即使冒险已经开始」；Memory Bank 记忆也可编辑。
- `Log Generations in Notes` 提供了「保留上一版内容」的机制。
- 官方排障建议里明确提到要**用 Context Viewer 检查卡片是否在错误的时机被激活**（「写错 trigger 是极常见的错误」）。

来源：<https://help.aidungeon.com/faq/the-memory-system>、<https://help.aidungeon.com/faq/what-goes-into-the-context-sent-to-the-ai>、<https://help.aidungeon.com/faq/story-cards>、<https://help.aidungeon.com/faq/plot-essentials>、<https://github.com/magicoflolis/MagicCards>、<https://github.com/LewdLeah>

---

## 1.2 NovelAI Lorebook（参数颗粒度最细的实现）

NovelAI 的 Lorebook 把「条目怎么进上下文」拆成了十几个独立旋钮，是 A 区/B 区装配参数设计的**最完整参考表**。

### 条目结构（数据结构层面）

| 字段 | 语义 |
|---|---|
| **Entry Title** | **仅用于组织，AI 看不见** → 因此必须在 Entry Text 里自己写明条目讲的是什么 |
| **Entry Text** | 激活时插入上下文的正文 |
| **Activation Keys** | 激活关键词，大小写不敏感；`/.../` 包裹则按**正则**求值（大小写敏感，支持 i/s/m/u）；**`&` 表示必须多个 key 同时出现在搜索窗口内**（如 `NovelAI & Anlatan`） |
| **Always On** | 无视关键词，永远注入（≈ 常驻条目） |
| **Enabled / Hide** | 开关；Hide 只是对玩家隐藏，不影响 AI |
| **Search Range** | 搜索多少**字符**的 story 文本找 key，上限 10000 |
| **Key-Relative Insertion** | 条目相对「最后一个被找到的 key」插入：正数插在 key 之后，负数插在 key 之前（可做「注释就近附着」） |
| **Cascading activation** | 条目可以到**非 story 的上下文条目**里找 key（≈ 递归激活） |
| **Prefix / Suffix** | 裁剪后、插入前包裹的文本 |
| **Token Budget** | 该条目最多能占多少 token；**0~1 之间的小数按最大上下文的百分比解释** |
| **Reserved Tokens** | 条目为**自己预留**的 token（在所有条目落位前先预留）；条目实际不足这个数就只预留实际量 |
| **Insertion Order** | 落位顺序：**insertion order 高的先预留 token、先插入**；同 order 不保证顺序 |
| **Insertion Position** | `0` = 上下文最顶部，`-1` = 最底部，负号从底部数起 |
| **Trim Direction / Max Trim Type** | 装不下时从哪里裁、允许裁到什么程度；`Do Not Trim` 表示「只有完整装得下才注入」 |
| **Insertion Type** | 插入时用什么单位分隔上下文 |

### (a) 世界设定的写入与更新

- **Lore Generator**：给名字或短描述即可生成条目；`Add Context (advanced)` 可以把 Memory、Author's Note、最近约 2500 字符的 story、**或其它 lorebook 条目**拉进生成上下文（用已有设定生成新设定，保证一致性）；有 50 条 Generation History。
- **Categories + Subcontext**：分类可以定义该类的默认 placement；开启 `Create Subcontext` 会把该类条目**打包成一个块**整体注入（≈ 「角色卡组」作为一个原子单元）。
- **Advanced Conditions**（仅 Xialong / GLM-4.6 模型可用）：可以做条件化激活，包括 `Keyword Match`、`Lore Entry Active`（条目 A 激活才激活 B）、`AND/OR/NOT` 组、`Random Chance`、**`Numeric Comparison`（可用 `currentStep`/`paragraphCount`/`characterCount` 做「倒计时到某个事件」）**、`String Comparison`（可比较 `storyText`/`memoryText`/`authorsNoteText`）。

### (c) 压缩与召回 / 触发时机

- NovelAI 的 **Ephemeral Context**（见 tutorialspoint 综述）允许条目**有寿命**：故事步骤语法 `+3,~10,0` 表示「3 个 Story Step 后激活、激活后持续 10 个 Story Step、插入位置 0（顶部），`-1` 为底部」；`~10r` 表示 Duration 到期后可重复。
- 这提供了**「延迟触发 + 有限寿命 + 指定位置」三件套**，是 stage-ai 完全缺失的一类时间语义。

来源：<https://docs.novelai.net/en/text/lorebook>、<https://www.tutorialspoint.com/novelai/novelai-lorebook.htm>、<https://www.tutorialspoint.com/novelai/novelai-quick-guide.htm>、<https://github.com/TapwaveZodiac/novelaiUKB/blob/main/docs/Lorebook.md>

---

## 1.3 SillyTavern 生态（World Info + Summarize + Vector Storage + 中文插件生态）

SillyTavern 是「提示词装配」被当作一等公民的产品，其文档把 A 区各段的位置与优先级关系写得很明确。

### 1.3.1 提示词骨架

- **Main Prompt（System Prompt）**：说明 AI 该以什么身份、按什么规则生成，**通常是模型收到的第一段**。
- **Post-History Instructions（PHI）**：位于**用户消息之后**，是模型生成前收到的**最后指令**；文档明确说 **PHI 通常比 Main Prompt 优先级更高，可以覆盖主提示词**。
- **World Info**：可以在 prompt 的**任意位置**插入，「当满足条件时插入」——包括按 depth 插到对话中间。
- **Summarize**：摘要注入位置与 Author's Note 相同（主提示词前 / 后，或按 depth 插到对话中间）。
- SillyTavern 提供 **Prompt Itemization / Prompt Inspector** 来回看最终 prompt，这与 AI Dungeon 的 Context Viewer 同属「必须有的可观测性」。

### 1.3.2 World Info 的完整运行语义

- 定位：**动态词典** —— 只有关键词出现在扫描范围内时，才把该条目的内容插进 prompt。
- **扫描深度（Scan Depth）**：看最近多少条消息参与 key 匹配。
- **递归扫描（Recursive Scan）**：条目可以互相激活。每条可设 `Non-recursable`（不被别人激活）、`Prevent further recursion`（激活后不再继续递归）、`Delay until recursion`（只在被递归激活时才生效）。全局设 `Max Recursion Steps`。
- **预算与丢弃**：`Context %` / token budget 硬上限；**耗尽后继续命中的条目被丢弃**。丢弃顺序的经验规律（第三方整理）：**常驻条目优先胜出 → 然后看 insertion order → 直接命中关键词的胜过「只在别的条目内容里被提到」的**。
- **激活灯色**：蓝灯（Constant，永远生效）/ 绿灯（Normal，关键词在最近 N 条消息内）/ 黄灯（Selective，关键词出现在**整个聊天历史**）/ 红灯（禁用）。
- **Vectorized（🔗）**：允许条目**被 embedding 相似度**激活（而不是关键词）。上游警告 embedding **非确定性**，要可预测性就别开。
- **Probability**：条目被激活后仍有概率不注入（100 = 每次注入，0 = 等于禁用）。
- **Inclusion Group / Group Weight / Group Scoring**：互斥分组，只保留组内得分最高者，其余停用 —— 这是「同类条目二选一」的机制。
- **Sticky / Cooldown / Delay**：条目激活后黏住若干轮、冷却若干轮、延迟若干轮才生效。
- **Sticky/Cooldown 与 Vectorized 互斥**：向量化条目不参与 sticky/cooldown。
- 超预算时会有告警提示。
- 文档明确警告：**「激活关键词、标题等不在 Content 字段里的东西不会进上下文，所以每条 World Info 都应该是自成体系的完整描述」**。

### 1.3.3 中文社区的实战补充（Foreverse 世界书规范）

一份把 runtime 行为写成规范的中文资料，与桌面酒馆语义对齐，价值在于**把注入流程讲成了四步**：

1. 扫描最近若干轮对话，用每个条目的关键词匹配（大小写不敏感）；
2. 命中的条目按插入位置与优先级注入；
3. 注入总量受 token 预算约束，**超出预算的低优先级条目被静默丢弃，不报错**；
4. 已注入的内容可再次触发其它条目（递归激活）。

给出的关键参数与建议：常驻条目「每一条都持续消耗上下文，**建议 ≤5 条**」；扫描深度决定「聊出窗口的设定等于没聊过」；「递归」的**高级玩法是主动在条目内容里埋别的条目的关键词**。

还定义了 **V3 decorators**：条目内容里以 `@@` 开头的行会被**剥离**（不泄漏进 prompt）：
- `@@activate`：无条件强制激活（绕过 constant/key/二级 key/概率，仍受冷却约束）；
- `@@dont_activate`：任何机制都不能把它塞进 prompt。

排障速查表（很有价值）：完全不触发→查绑定与开关；时灵时不灵→查 key 是否掉出扫描窗口 / 别名不全；聊久了失效→查预算被常驻与长条目吃满；**触发了但模型不采信 → 条目太长太文学，改成「事实前置的电报体」**。

### 1.3.4 压缩：Summarize 扩展

- 摘要会**嵌入 chat 文件元数据中**，挂在「生成摘要时最后一条在上下文里的消息」上；**删除或编辑那条消息会回退到上一个有效摘要**。
- 有 `Restore Previous`（回退到上一版摘要）、`Pause`（手动干预 / 停更）、`Injection Template`（用 `{{summary}}` 宏标记注入点）、`Injection Position`。
- 三种源模式：**Raw blocking**（只用摘要提示词 + 聊天历史，提示词变化大，不适合 llama.cpp 等 prompt processing 慢的后端）、**Raw non-blocking**、**Classic blocking**（把摘要提示词作为中性 system instruction 追加在常规生成提示词末尾，**不省略角色卡/主提示词/示例对话**，因此「通常与已处理 prompt 的复用配合良好」—— 官方明确推荐给 llama.cpp 系）。
- 官方免责声明原话要义：摘要「*可以*被理解为长期记忆，但请对这一说法持保留态度」，**LLM 生成的摘要会丢关键细节或产生幻觉**，用户应跟踪摘要状态并手动修正。

### 1.3.5 召回：Vector Storage / Chat Vectorization / Data Bank

- **Chat Vectorization**：后台给每条消息算向量；生成时用**最近 2 条消息**当查询检索聊天历史，把最相关的消息**临时挪到聊天历史的开头或结尾**（因为首尾对模型影响最大）。价值在于**能捞回「太靠后、本来塞不进上下文」的消息**。
- **Data Bank**：把大文档切块（chunk），只检索最相关的块 —— 纯 token 效率导向。
- ⚠️ **官方关于 prompt caching 的明确警告（对本项目极重要）**：
  > Chat Vectorization 这类**任何动态 prompt 源**（World Info、Summarization 等）都会**在多次 LLM 调用之间重构 prompt 前缀**，导致频繁 cache miss。**与缓存同用时，向量化往往是反效果的** —— 你必须在两者里选一个。

### 1.3.6 中文插件生态（最贴近「长篇 galgame」的实践集）

一份中文横评对比了四家主流记忆方案（2026-05）：

| 方案 | 核心做法 | 特点 |
|---|---|---|
| **Horae 时光记忆** | **结构化时间锚**：把对话拆成事件/地点/人物状态，**各自带时间戳**；注入时自动换算「昨天/上周三/上个月 15 号」相对时间 | 场景记忆（壁炉/服装锁定）、物品系统（唯一编号 + 分级 + 「5 斤→4 斤」自动解析）、**NPC 关系网「变化时才输出，无变化零 Token」**、RPG 模式（血条/技能/HUD） |
| **酒馆记忆增强（表格记忆，muyoou）** | **可编辑表格**：角色关系、物品清单、关键事件全部表格化，列可自定义，AI 自动填、用户可手改，模板可 JSON 导出分享 | **可视化最强**；但是**「注入是全表覆盖」，每轮重发整张表，token 消耗更大** |
| **Amily2 号助手** | 只做总结，把旧历史压成摘要塞回上下文 | 零配置；功能单一 |
| **全自动总结脚本（AutoSummarizer）** | 跑在酒馆助手里的 JS 脚本，后台静默压缩 | 轻量；无可视面板 |

这份横评给出的实践结论（可直接借用）：

- **只能装一个**：两个记忆插件会**同时给同一段历史做总结**，产生重复甚至冲突的 prompt。
- **世界书管「固定不变的设定」，记忆插件管「动态变化的状态」，两者职能不冲突，组合使用最强。**
- **强烈推荐配一个低成本副 API（DeepSeek / Gemini Flash）专门跑摘要**：摘要任务不要求高智能但很费 token；主 API 用高端模型。
- **摘要节奏**：每 **50–80 楼**小总结一次，每 **200–300 楼**大总结一次，关键剧情节点单独建条目；「聊到几百楼才想起来总结是新手最常犯的错」。
- 手工总结的推荐提示词结构（可直接复用为 epoch compaction 的模板）：
  > 请暂停剧情。请将第 0 楼到第 150 楼发生的事情详细总结，按时间顺序保留：主要事件和情节 / 角色关系变化 / 重要对话和承诺 / 获得的物品和信息 / 世界观新增设定 / 省略冗余，保留关键。
- 提到一类「**变更是 Token 免费**」的实现（Horae 的 NPC 关系网）：**只在有变化时输出**，无变化则不产生 token —— 这是解决「A 区无界增长」的关键思路之一。

另一篇中文实战文章给出了**四层架构**（针对「第 500 轮崩溃综合征」）：

```
第一层：Character Card（角色卡）
第二层：Lorebook（世界书，关键词注入）
第三层：RPG Companion（实时结构化状态注入）
第四层：RAG Memory（长期记忆检索）
```

该文的核心论点（与 NarraWorld 独立得出同一结论）：
- 「长期 RPG 的核心挑战不是『让 AI 记住更多』，而是**用正确的数据结构存储正确的信息**。自然语言适合叙事，但不适合状态管理。」
- Summary 扩展的致命缺陷是 **Narrative Compression**：把「力量值 18」压成「你曾经很强大」，把「月光剑 + 治疗药水×3 + 金币 500」压成「你有一些装备和金钱」，**且不可逆**。
- SillyTavern 的 prompt 优先级（该文整理）：System Prompt → World Info（**占 25% 预算**）→ Persona/Character → Chat History → User Message → Buffer。
- 该文同时承认：把 8K 上下文换成 200K 后「生成质量反而下降」，因为注意力被稀释（Lost in the Middle）。

中文圈的世界书入门建议（对 A 区角色表有直接启示）：
- 全局世界观用**蓝灯常驻，1–3 条**；能用绿灯就别用蓝灯，「省 token 就是省钱」。
- 关键词**覆盖多种叫法**（「林浅雪 / 大师姐 / 雪姐 / 寒月剑主」一起放）。
- 单条建议 **200–500 字**，过长拆条。
- **「世界书写得越多越好」是完全相反的**：一个 100 条精炼的世界书 ≠ 一个 500 条冗余的世界书；「先做 5 条用半个月，再考虑要不要扩」。

来源：<https://docs.sillytavern.app/usage/prompts/>、<https://docs.sillytavern.app/usage/core-concepts/worldinfo>、<https://docs.sillytavern.app/extensions/summarize>、<https://docs.sillytavern.app/extensions/chat-vectorization>、<https://docs.sillytavern.app/usage/core-concepts/data-bank>、<https://foreverse.cn/zh/docs/worldbook>、<https://foreverse.cn/zh/blog/lorebook-not-triggering-checklist>、<https://guide.sillytavern.one/presets-lorebooks/lorebook-basics>、<https://guide.sillytavern.one/extensions/memory-extensions>、<https://guide.sillytavern.one/advanced/long-chat-summary>、<https://developer.cloud.tencent.com/article/2711460>、<https://github.com/muyoou/st-memory-enhancement>、<https://github.com/SenriYuki/SillyTavern-Horae>、<https://github.com/EphemeralAlien/AutoSummarizer>、<https://github.com/KritBlade/VectFox>

---

## 1.4 Character.AI（消费级产品的分层记忆 UI）

Character.AI 走的是**「用户可写 + AI 自动抽取 + 用量可视化」三层**路线，2025-05 到 2026 完成了两次迭代：

**2025-05：Chat Memories**（全员可用）
- 每个 chat 一个 **400 字符**的固定信息框，写「关于你的 persona 或角色的关键信息，角色会在这个对话里记住」。
- 官方措辞值得注意：「**我们无法保证角色一定会按你写的方式使用或引用这些信息**，但加入 chat memories 会提高它在长对话中被使用的可能性」。
- 官方写作建议：**短、具体（日常习惯/关系/偏好）、清晰直接（只有 400 字符）、随时更新**。

**2026：Memory 界面重构为三件套**
- **Story Memory**（免费，全员）：**用户自己写**的背景、关键事件、特殊时刻 —— 前身就是 Chat Memories 文本框。
- **Facts**（c.ai+ 层）：在聊天过程中**自动捕获**外貌、怪癖、关系等细节；**可编辑、可删除**。
- **Memory Usage**：可视化「当前是什么在填满这个 chat 的记忆空间」（c.ai+ 解锁完整版）。
- **Pinning（消息钉选）**：长按一条消息把它**原样（保留原始措辞）**放进 Story Memory；免费，c.ai+ 拥有双倍钉选数。
- **Facts 可复制到新 chat**：开始新会话时可选择把「角色关于你、Persona 和这个世界知道的一切」带过去。

对 (a)(b)(d) 的回答：**设定写入 = 用户手写 + AI 自动抽取双通道**；**冲突管理 = 全部可编辑可删除 + 用量可视化**（把「上下文里到底有什么」暴露给用户）。

来源：<https://blog.character.ai/helping-characters-remember-what-matters-most>、<https://blog.character.ai/memory>、<https://www.roborhythms.com/character-ai-adds-chat-memories>

---

## 1.5 Novelcrafter Codex（写作工具路线：结构化 story bible）

不是 RP 引擎，但解决的是**同一类问题**（长篇中设定的一致性演化），且实现方式对「剧作家怎么写世界记忆」最有参考价值。

- **Codex 是结构化数据，而 AI 真的会读它**：为角色、地点、物品、设定、势力建条目，组织成**可自定义的分类（categories）+ 用户自定义字段 + 标签**；支持「Series Codex」（跨书的系列级设定）。
- **场景级上下文附加**：写某个场景时点 `+ Codex` 把**特定几个**条目挂到这个场景的**完成提示词**里 —— 明确适用于「场景引用了背景事件但没在 beat 里写出来」「需要 AI 记住这场戏特有的角色动态」。
- 官方给出的取舍建议（几乎可以直接抄给 playwriter 的写卡工具）：
  - **AI 忽略条目** → 原因一：一个场景挂了太多条目；**解法：只挂提供关键上下文的条目，宁缺毋滥**。原因二：关键信息埋在冗长条目里；**解法：为场景附加专门建「简练聚焦」的条目，或把最重要的部分放在条目开头**。
  - **AI 写出与附加条目矛盾的内容** → 原因：场景 beat 与附加条目冲突；**解法：明确哪一份来源优先，然后改**。
- **版本管理**：Novelcrafter 的帮助文档里有独立的 **Revision History**，其中**明确区分了 `Codex: description` 版本化、`Codex: notes` 版本化、`Snippet content` 版本化** —— 即「设定条目的正文与笔记各自有修订历史」。

来源：<https://www.novelcrafter.com/features/codex>、<https://www.novelcrafter.com/help/docs/codex/the-codex>、<https://www.novelcrafter.com/courses/codex-cookbook/codex-scenes>、<https://www.novelcrafter.com/help/docs/organization/revision-history>

---

## 1.6 MemGPT / Letta（记忆 agent 架构的经典范式）

### 经典 MemGPT（arXiv 2310.08560）

- 把上下文窗口当作**受限内存资源**，做「虚拟内存分页」式分层：
  - **Main context**（≈ RAM）= system instructions + **working context** + **FIFO queue**；
  - **External context**（≈ 磁盘）= **recall storage**（历史消息）+ **archival storage**（主动保存的记忆）。
- LLM 通过**函数调用**在这些层之间搬数据；`request_heartbeat=true` 允许把多个函数调用链起来（多步检索）。
- 由 **queue manager** 管理 recall storage 与 FIFO 队列的进出，并配套 **page-warning / flush** 协议。

### Letta 2026 的两个新概念（对「epoch compaction 该由谁做」直接相关）

1. **Memory Blocks**：模型可直接编辑的**离散功能记忆块**（不由系统硬编码）。
2. **Sleep-time agents / Dreaming**：
   - 建 sleep-time agent 时，Letta 在底层**实际创建两个 agent**：一个 primary（面向用户、有对话工具与检索工具，但**没有编辑自己 core memory 的工具**），一个 sleep-time（**持有编辑 primary 上下文记忆的工具**）。
   - 动机（官方原文要点）：MemGPT 把记忆管理、对话和其他任务捆在一个 agent 里，导致**更慢**（对话中要调记忆操作）也**更不可靠**；把记忆卸载到 sleep-time agent 后，**记忆整理可以异步进行**，而且「MemGPT 的记忆形成是增量的，时间久了会杂乱无章」，sleep-time agent 能**持续产出干净、简洁、详细的记忆**。
   - **可独立配置模型**：primary 用快模型（如 gpt-4o-mini），**sleep-time 用更强更慢的模型（gpt-4.1 / Sonnet 3.7）**，因为 sleep-time 不受延迟约束。
   - **可配置触发频率**：频率越高，token 消耗越大，但 agent 有更多时间修订记忆。
   - 更新的产品形态（Letta docs「Memory & dreaming」）：agent 用 **MemFS —— 一个 git-backed 的记忆文件系统**；`/init` 引导初始化；`/remember` 显式教学；**Dreaming 用后台 subagent 复盘近期对话、合并有用经验、更新记忆，不打断正在进行的工作**；触发时机可选「**每完成 N 个 agent step 后**」或「**当上下文窗口被压缩时**」；可选 **`Agent reviews before applying`** —— 用第二个后台对话先审阅和修订提议的记忆变更；`/doctor` 用来**审计记忆的放置、重复项与 system prompt token 占用**；大规模整理时「**先备份当前仓库**再拆分大文件、合并重复项、重构层级」。

来源：<https://arxiv.org/abs/2310.08560>、<https://www.letta.com/blog/sleep-time-compute>、<https://docs.letta.com/configuration/memory>、<https://github.com/letta-ai/sleep-time-compute>、<https://aiengineeringfromscratch.docpage.cn/en/14-agent-engineering/memory-blocks-sleep-time-compute>

---

## 1.7 通用记忆层框架：Mem0 / Zep-Graphiti / MemOS / HippoRAG / A-MEM

### Mem0（arXiv 2504.19413）

- 定位：从持续对话中**动态抽取、合并、检索**显著信息。
- **写入语义 = 四种操作**：`ADD` / `UPDATE` / `DELETE` / `NOOP`；官方给出的**优先级顺序是 `NOOP > DELETE > UPDATE > ADD`**（能不动就不动，其次删，其次改，最后才是加）。
- 变体：**graph memory**（用图表示会话元素间的复杂关系）。
- 基准（LOCOMO）：相比 OpenAI 在 LLM-as-a-Judge 上**相对提升 26%**；graph 版比基础版总分再高约 2%；相比「全上下文」方案 **p95 延迟低 91%、token 成本省 90%+**。

### Zep / Graphiti（双时间模型，是「冲突与版本管理」最完整的答案）

- **双时间（bi-temporal）** 把两种时间分开：
  1. **Valid Time**：事实在真实世界里**何时为真**；
  2. **Transaction Time**：系统**何时得知**这条事实。
- 边上的字段（`EntityEdge`）：
  ```python
  valid_at:   datetime | None  # 事实开始为真的时刻
  invalid_at: datetime | None  # 事实不再为真的时刻
  created_at: datetime         # 边首次创建（系统得知）的时刻
  expired_at: datetime | None  # 边被取代/失效（系统得知）的时刻
  ```
- **矛盾处理 = 时间化失效（temporal edge invalidation），而不是删除**：
  1. 新 episode 带来矛盾信息；
  2. LLM 在**边解析阶段**分析矛盾；
  3. **旧边更新**：`invalid_at ← 新事实的 valid_at`，`expired_at ← 当前时间戳`；
  4. 同时创建新边。
  这样「系统知道什么、以及何时知道」的完整历史被保留。
- **时间点查询**语义：返回 `valid_at <= T AND (invalid_at > T OR invalid_at IS NULL)` 的边。
- **节点 vs 边的时间**：实体节点代表持久对象，**时间有效性只记在边上**（因为一个实体会随时间拥有多个变化的关系）；episodic node 同时有 `valid_at`（内容发生时间）和 `created_at`（摄入时间）。
- `add_episode(..., reference_time=...)` 会成为抽取出的边的 `valid_at` —— **保证事实锚定在「它发生的时间」，而不是「它被处理的时间」**。
- 检索是**向量 + BM25 + 图**的混合检索。

### MemOS（arXiv 2505.22101）

- 把记忆提升为「一等操作资源」，统一三种记忆：**parametric（模型权重）/ activation（上下文内运行时状态）/ plaintext（明文记忆）**。
- 核心抽象 **MemCube**：标准化记忆单元，支持追踪、融合、迁移异构记忆。
- 论点：现有 RAG 式明文记忆**缺乏生命周期管理（lifecycle management）与多模态集成**，限制了长期知识演化。

### HippoRAG（NeurIPS 2024）

- 神经生物学启发（海马索引理论）：**LLM + 知识图谱 + Personalized PageRank**，模拟新皮层与海马的分工，实现跨外部文档的持续知识整合。

### A-MEM（Agentic Memory）

- 受 Zettelkasten 启发：为记忆建立**可链接的原子笔记**，由 agent 自己组织。

### STALE：记忆失效判定（arXiv 2605.06527）—— 与 (d) 最相关

- 指出一个被低估的失败模式：**Implicit Conflict（隐式冲突）**——后一个观察**在没有显式否定**的情况下让早先的记忆失效，需要上下文推断与常识推理才能发现。
- 基准 STALE：**400 个专家验证的冲突场景、1200 条评测查询、三个探测维度、100+ 日常主题、上下文长至 150K token**。
- 三个维度：**State Resolution**（识别先前信念已过期）、**Premise Resistance**（拒绝基于过期状态预设的提问）、**Implicit Policy Adaptation**（在下游行为里主动应用更新后的状态）。
- 结果：「**检索到更新证据**」与「**据此行动**」之间存在普遍落差，**最好的模型也只有 55.2% 总体准确率**；模型常常接受用户问题里嵌入的过期假设，也难以识别「用户状态某一方面的变化应该让相关记忆一并失效」。
- 提出的原型 **CUPMem**：通过**结构化状态合并（structured state consolidation）**与**传播感知检索（propagation-aware search）**来强化**写入时修订（write-time revision）**。

来源：<https://arxiv.org/html/2504.19413v1>、<https://deepwiki.com/mem0ai/mem0/11.1-custom-prompts>、<https://github.com/mem0ai/mem0/tree/main/docs/core-concepts/memory-operations>、<https://getzep-graphiti.mintlify.app/concepts/temporal-model>、<https://arxiv.org/abs/2505.22101>、<https://papers.nips.cc/paper_files/paper/2024/file/6ddc001d07ca4f319af96a3024f6dbd1-Paper-Conference.pdf>、<https://arxiv.org/abs/2605.06527>

---

## 1.8 叙事 / 角色扮演方向的学术 SOTA（与本项目形态最接近）

### 1.8.1 NstAgent：Scaling Long-Form Story Generation via Narrative State Tracking（arXiv 2609.35759）

- **Training-free agentic 框架**，让 LLM 跟踪一个**结构化叙事状态**，显式包含三类：**characters / past events / future requirements**。
- 流程：**每生成一章正文，立即更新叙事状态**，下一章以「当前状态」为条件生成。
- 规模与结果：把评测从 10K 字扩到 **100K 字**，**叙事一致性与写作质量都不随长度明显退化**（对比基线随长度退化）。
- 关键工程细节（对成本估算有用）：成本近线性**依赖 prefix caching**。因为 past events 累积且不淘汰，输入增长快于正文长度：100K 字故事每篇 **7.5M input tokens**，而 10K 字只有 0.71M，其中**约 60% 由 provider 的 cache 服务**。若全部按未缓存计价，100K 字故事成本从 **$1.32 涨到 $2.28**。作者明确把「**bounding or consolidating the past-event log**」列为 future work —— 即连 SOTA 也没解决无界增长。

### 1.8.2 NarraWorld：Shared Worlds, Private Minds（arXiv 2609.32401）—— 本报告认为最值得完整借鉴的一篇

把「长篇写作的记忆构建」当作**世界创造**，而不是检索。三个组件：

**(1) 共享的、证据锚定的记忆底座 + 四个视图**

从**同一份叙事结构**投影出四种记录：

| 视图 | 内容 |
|---|---|
| **World facts** | 已发生的事件、**当前有效**的事实、实体状态、关系 |
| **Per-character beliefs**（按角色索引） | 角色 *c* 的**知识与信念**；与 world view **引用同一批事件与命题，但赋予不同的、视角相关的状态** —— 因此可以合法地持有**与事实相矛盾的假信念** |
| **Open developments** | 跨段落/章节发展的叙事线（冲突、关系），记录**当前状态：open / advanced / blocked / resolved** |
| **Hypothetical branches** | 与未解决发展相关联的**有界**候选延续（possible-world branches），带 hypothetical 标记 |

**走查示例（照抄下来极好理解）**：源文本「Mara 趁 Leo 不在，把钥匙从抽屉移到了空心书里」
- 记录移动事件并更新钥匙位置；事件与结果是**源支持的、当前的** → 进 world view；
- Mara 参与了事件（有 access link）→ 她的视图包含新位置；
- **Leo 对该移动没有观测/通信链 → 他的视图保留「钥匙在抽屉里」的旧信念**；
- 移动事件推进了「Leo 找钥匙」这条 development → development 视图纳入该事件；若仍未解决 → branch 视图给出「Mara 告知 Leo」「Leo 自己发现」等候选。

**(2) 层级聚合 + atomic closure（跨叙事尺度组织记忆）**

- 层级：**events → scenes → plotlines → plots**。
- **每个高层节点保留其成员事件、记录、支持源区间的 atomic closure**：因此「一个跨多章的背叛」可以被**当作单条记录检索**，再**展开回确切的底层事实**。检索可以先选中高层单元，再下钻到相关行动、信念与源证据。
- hypothetical 记录**留在层级之外**，直到后续文本把它实现为证据。
- 消融结论：**去掉 cross-event organization 掉分最多**（在 pacing / world building / coherence 上损失尤其大）；去掉 character beliefs 主要伤角色相关指标；去掉 possible worlds 对总分影响较小但会改变创造性/世界建模类指标。

**(3) Planned reconstruction（把「检索」变成「先规划依赖、再装配」）**

四阶段：**admissible view projection → dependency planning → multi-scale retrieval → budgeted assembly**。

- **情境条件下的记忆访问**：按请求的时间、披露范围、分支范围确定哪些记录可用，并保留**记录权威性与信念持有者**（holder labels 保证多角色的信念不被混同）；focalization 决定叙述可以用哪个角色的信息。
- **Preview-guided dependency planning（关键创新）**：相似度检索只能跟随 query 的显式内容，**隐式依赖需要中间规划步**。planner 收到「当前叙事情境」+ **一份紧凑的 memory preview（完整角色名单 + 简要描述 + developments + records）**，再产出依赖清单。原文举例：一句「rewrite the betrayal scene」不只需要背叛本身，还需要**这次修改可能影响到的角色关系**。
- 检索在 **token 预算**内装配（LoCoMo 实验用 **8k memory budget**）。
- 一个有意思的结论：在事实性问答（LoCoMo）上**排除 hypothetical branch 视图反而提升 4.4 分**（因为假设性内容不该作为事实证据）—— 即**视图要按任务选用，不是永远全开**。

### 1.8.3 DREAM：Event-Aware Memory Graph（arXiv 2608.05170）

- 面向 role-playing 的多 agent 框架：**系统化构建 memory graph，并生成动态角色档案**。
- 角色档案的字段模板（可直接用作 stage-ai 的角色状态数据结构）：
  ```
  Background / Appearance / Linguistic styles / Personality Traits /
  Core Motivations / Relationships / Cognition Chains / Key Experiences /
  Causal Narrative Chains（由 triples 生成一段因果叙事描述）
  ```
  提示词里对 `Relationships` 的更新指令是「Update dynamic relations with others」，对 `Cognition Chains` 是「**CRITICAL**: Summarize the character's state of mind in this event and how it compares to the past」。
- 把角色经验组织成**时间有序、因果相连的事件图**，在 CoSER、LifeChoice 与自建 TCM（temporal & causal consistency）基准上优于强基线。

### 1.8.4 REVERIEMEM / Staying In Character（arXiv 2606.25632）

- 面向「从小说抽取角色」的 agent，解决**知识边界（角色不该知道自己不知道的事）**与**语气多样性**。
- **三层记忆**：**episodic layer（第一人称经历）/ visibility-tagged facts（带可见性标签的事实）/ situational personality（情境化人格）**。
- 结果：知识边界保真度比最强前作**提升 34.6 分**；配 4,386 题的评测。
- 相关佐证：**TimeChara**（10,895 个实例）测「point-in-time character hallucination」—— 角色知道了他还不该知道的事，**GPT-4o 也有显著幻觉**；**CHARM** 发现幻觉主要来自**合规失败**（模型已识别问题出戏，但还是回答了）。

### 1.8.5 MOOM（arXiv 2509.11860）

- 明确针对「**现有方法记忆无控制增长**」的问题：提出**双分支记忆插件**，借文学理论把**情节发展**与**角色刻画**当作核心叙事要素分别建模（**plot conflicts + user profile 两支**），并配**遗忘机制**保持记忆规模可控。
- 数据集 ZH-4O：中文超长角色扮演对话，**每段约 600 轮**。

### 1.8.6 DualMem / RoleMemo：从事实到洞察

- 论点：记忆系统应当**通过 persona 去解读事实**，而不只是存储事实。**persona-agnostic 的摘要会产出泛化答案**；把「事实记忆」与「persona 记忆」拆开，一个 4B 模型能打赢零样本的 DeepSeek-V3.2 框架。

### 1.8.7 ArcANE：给「角色弧光到当前章」的上下文

- 结论：把**角色截至当前章节的发展弧（character's arc up to the current chapter）**给模型，**在全部六个模型上都打赢其它所有上下文策略，领先 2.2–8.4 分**。这与「A 区角色卡应该是『当前时点的角色』而不是『角色设定书』」是同一个结论。

### 1.8.8 RecurrentGPT（arXiv 2305.13304）—— 「记忆可读可编辑」的经典

- 用自然语言模拟 LSTM：把 LSTM 的 cell state / hidden state / input / output 全部换成**自然语言段落**，用 prompt engineering 模拟循环。
- 短时记忆 = 段落级摘要；长时记忆 = 检索到的相关历史 + 长期计划。
- 立论价值：**LLM 能写出超出上下文窗口的长文本**，且记忆**人可读、可编辑**；作者明确论证这缓解了「固定大小上下文」的限制。
- 现代对照：Arcanum 的评述指出它是 2023 年系统，**早于今天的长上下文模型**。

### 1.8.9 MemoryBank（arXiv 2305.10250）

- 受**艾宾浩斯遗忘曲线**启发：记忆强度随时间衰减，**被回忆时得到强化**。这是「有意识的遗忘 / 衰减」机制在 LLM 记忆里的经典落地。

### 1.8.10 Generative Agents（arXiv 2304.03442）—— 检索打分公式的来源

- **memory stream**：用自然语言完整记录 agent 的经验。
- **检索打分 = relevance（embedding 相似度）+ recency（指数衰减）+ importance（LLM 打分）** 三者合成。
- **Reflection**：当累积重要度超过阈值时，把记忆**综合成更高层的推论**（insight），并把反思与计划**写回 memory stream**。
- 消融实验证明 memory / reflection / planning 三者各自都显著贡献可信度。
- 局限（作者自述）：记忆检索函数有待改进、成本高、**对 prompt/memory hacking 的鲁棒性未测**、会继承底层 LLM 的偏见。

### 1.8.11 RAPTOR（arXiv 2401.18059）—— 摘要粒度问题的标准答案

- **递归地 embedding + 聚类 + 摘要文本块，自底向上构造一棵不同摘要层级的树**，检索时可以在不同抽象层级上取用。这正是「摘要粒度」问题的 canonical 解法：不要二选一，而是**同时保留多个粒度**。

### 1.8.12 一致性与长期性的基准数字（用于判断问题严重程度）

来自 Arcanum 的 AI RPG 研究索引（63 篇论文，2026-09-25 校验）与 ConStory 分析：

- **NCP-Bench**：即使用最强的 **GPT-5.2**，在 20 轮后「叙事完整性」**只有 42% 的 run 保持住**；各模型**事实冲突率 40–68%**；且**写作质量高并不预示一致性高**。
- **RoleBreak**：即使最强系统，**平均 10.4 轮就出现第一次人格崩坏**；更大模型只是推迟失败。
- **RPGBench**：模型「能产出吸引人的故事，但常常无法实现一致、可验证的游戏机制」。
- **ConStory-Bench（arXiv 2603.05890 / ACL Findings 2026）**：2000 个提示、**19 类错误子型**；矛盾**聚集在事实与时序细节**上，且**倾向出现在长篇叙事的中段**；**即使 GPT-5-Reasoning 也约每 10,000 词出 1 个错**；自动化 **ConStory-Checker 检出的错误是人类专家的 3.2 倍**；**错误会聚集**（错一个细节会提高继续出错的风险）。
- 「**由模型外部的可追踪世界状态支撑一致性**」这一结论在多个系统上被重复验证：**FIREBALL**（真实 game state 改善生成的回合，模型还能产出可执行的游戏命令）、**带 function calling 的 game master**（同时提升叙事质量与状态更新一致性）、**PAYADOR**、**IVIE**。
- **反证 / 警示**：一项 N=130 的随机对照研究发现，LLM 驱动的 NPC **显著提高了玩家的认知负荷**，且**未显著改善整体体验**（自主性上升，可用性与信任下降）；另一项研究（Symbolically Scaffolded Play）发现**更紧的提示词约束对「任务发布者 NPC」有帮助，但让「嫌疑人 NPC」更不可信** —— 即「约束越多越好」并不成立。

来源：<https://arxiv.org/abs/2609.35759>、<https://arxiv.org/html/2609.32401v1>、<https://arxiv.org/html/2608.05170>、<https://arxiv.org/abs/2606.25632>、<https://arxiv.org/abs/2509.11860>、<https://arxiv.org/abs/2305.13304>、<https://arxiv.org/abs/2305.10250>、<https://arxiv.org/pdf/2304.03442>、<https://arxiv.org/abs/2401.18059>、<https://aclanthology.org/2026.findings-acl.410.pdf>、<https://mllog.dev/en/posts/constory-consistency-bugs-long-stories-llm>、<https://arcanumrpgs.com/research>、<https://openreview.net/pdf?id=b0gO9JXUiP>、<https://www.techrxiv.org/doi/pdf/10.36227/techrxiv.177160619.98027802>、<https://dl.acm.org/doi/10.1145/3748302>

---

## 1.9 四个维度的横向对照表

| | (a) 世界设定的写入与更新 | (b) 角色关系/变化追踪 | (c) 压缩与召回 | (d) 冲突与版本管理 |
|---|---|---|---|---|
| **AI Dungeon** | 手动 Story Card + AI 生成器 + Auto Summarization + Memory Bank（并行模型写记忆） | ❌ 无结构化追踪（刻意不搬 Voyage 的 game state） | 摘要 + 相关性召回 + trigger/新近度/频率排序；四段预算切分（卡片 25% / 历史 50% / 记忆 25%） | 无自动消解；全靠手动编辑；`Log Generations in Notes` 保留旧版 Entry；Context Viewer 排障 |
| **NovelAI** | Lore Generator + Add Context（用已有设定生成）+ Categories/Subcontext | ❌ 无专用结构；靠条目引用 | 关键词/Always On/正则/`&`/Cascading；token budget + reserved tokens + insertion order/position；**Ephemeral Context（delay/duration）** | 无自动消解；用 insertion order 决定谁先占 budget；`Key-Relative Insertion` 处理「就近覆盖」 |
| **SillyTavern** | World Info 手写 + 中文插件自动填表 | Horae 的关系网（**变化才输出**）；记忆表格的关系表 | WI 预算丢弃 + Summarize + Chat Vectorization/Data Bank；**递归激活 + inclusion group + sticky/cooldown/delay** | Restore Previous 回退；条目编辑即生效；摘要挂在消息上、删消息即回退 |
| **Character.AI** | 手写 Chat Memories（400 字符）+ AI 自动捕获 Facts | Facts 自动抽「关系」类细节，可编辑删除 | Story Memory 常驻 + Facts 常驻 + 消息 Pinning 原样保留 + Memory Usage 可视化 | 全靠「可编辑可删除」+ 用量可视化 |
| **Novelcrafter** | Codex 结构化条目 + 场景级附着 + AI 在 Codex Chat 中读写 | 自定义字段（含关系） | 场景上下文（手动挂载）+ 自动匹配条目 | **Codex description / notes 各自有 Revision History** |
| **MemGPT/Letta** | agent 自己用函数写；现在由 **sleep-time agent 异步写** | Memory blocks（离散可编辑） | Main/External 两层 + recall/archival + FIFO 队列；sleep-time 整理 | `Agent reviews before applying`；`/doctor` 审计重复与放置；git-backed MemFS 可回滚 |
| **Mem0** | LLM 抽取 → 四操作 | — | 向量 + 图；LOCOMO 上省 90% token | **ADD/UPDATE/DELETE/NOOP**，优先级 `NOOP > DELETE > UPDATE > ADD` |
| **Zep/Graphiti** | 每个 episode 抽取事实入图 | 实体→实体边，边上有时间 | 向量 + BM25 + 图混合 | **双时间 + 时间化失效（不删边）** |
| **NstAgent** | 每章后更新结构化叙事状态 | characters 字段 | past events 日志（**承认无界增长是 future work**） | 靠状态覆盖；依赖 prefix caching 摊薄成本 |
| **NarraWorld** | 事件入共享图 → 四视图投影 | **per-character beliefs（按角色索引）+ holder labels** | **planned reconstruction（先规划依赖）+ atomic closure 层级展开 + token 预算装配** | 视图隔离即冲突隔离（事实 vs 信念 vs 假设）；hypothetical 在实现前不入层级 |
| **DREAM** | 事件图 + 动态角色档案 | Relationships / Cognition Chains / Causal Narrative Chains | 事件图检索 | 因果链显式化 |
| **REVERIEMEM** | visibility-tagged facts | **知识边界（谁知道什么）** | 三层记忆 | 可见性标签天然防越界 |
| **STALE / CUPMem** | 写入时修订 | 状态传播失效 | — | **显式状态裁决 + 传播感知检索**；命中率仅 55.2% |

---

# 2. 对我们最有借鉴价值的 5 个机制

> 每个机制都给出：**数据结构 / 触发时机 / 提示词位置** 三要素，以及对应的 stage-ai 问题点。
> 问题点编号：**P1** = 剧作家没有写世界记忆的工具；**P2** = 长篇下 A 区角色表无界增长；**P3** = 重建时上下文截断失忆；**P4** = session.json 单点故障。

---

## 机制 1：分层视图 + 信念持有者 —— 「世界事实」与「角色认知」分离

**来源**：NarraWorld（arXiv 2609.32401）、REVERIEMEM（arXiv 2606.25632）、DREAM（arXiv 2608.05170）

**对应问题点**：P2、P3，并**为 P1 提供写入目标**（有明确 schema 才谈得上「写工具」）

**数据结构**（建议 shape）：

```
MemoryRecord {
  id:           稳定 ID（人类可读前缀 + 序号，不用裸 UUID）
  view:         fact | belief | development | branch
  holder:       (view=belief 时) 角色 id；fact 视图为 null
  subject / predicate / object      # 三元组形式，便于精确比对
  status:       active | superseded | retracted   # 见机制 4
  valid_at / invalid_at             # 剧情内时间（见机制 4）
  evidence:     [ {epoch, turn_range, quote_span} ]  # 源支撑，用于下钻与审计
  importance:   1..5                # 供预算排序
}

CharacterState {            # 对应 DREAM 的字段模板，是 A1 区的素材
  id, name, aliases[]       # aliases 直接作为触发键
  arc_summary_at_epoch      # ArcANE：只给「截至当前的弧光」，不给设定书
  relations: [ {target, stance, intensity, last_changed_turn} ]
  knowledge_boundary: [record_id...]   # 该角色「知道」的 record（REVERIEMEM 的 visibility tag）
  on_stage: bool            # 是否在场 → 决定注入详略
}
```

**为什么能解决 P2**：A 区角色表之所以无界增长，是因为把「角色是谁」和「角色现在如何」混在一张卡里。拆开后：
- 不变量（姓名、口癖、基本性格）→ 冻结在 A0；
- 变量（关系、所在地、知道什么、目标）→ 变成**有界的 `relations[]` 与 `knowledge_boundary[]`**；
- **不在场的角色只注入一行 roster（`name + 一句状态 + 关系值`）**，全卡只在该角色被触发时按需注入（这正是 SillyTavern 常驻/绿灯 与 AI Dungeon Story Cards 的做法）。

**为什么能解决 P3**：`evidence[]` 让「重建时上下文截断」变成可恢复——摘要节点即使丢了细节，也能通过 ID 把 `atomic closure` 展开回原台词切片（你的 archive 正好已经有逐轮切片）。**这就是 NarraWorld 的 atomic closure 在 D7 上的直接映射**：`arcs 摘要卡 → 场景卡 → 事件记录 → archive 台词切片`，每一层都存子节点 ID。

**触发时机**：在**每轮演出结束后**由记忆写手（见机制 5）执行：抽取本轮的 fact/belief/development 变更。
**提示词位置**：
- `fact` 视图的 active 记录 → A1 区（纪元级状态卡）；
- `belief` 视图 → 只在**该角色在场或该角色发言**时注入（REVERIEMEM 证明这能把知识边界保真度提升 34.6 分）；
- `development`（open/advanced/blocked/resolved）→ A1 区一行制；
- `branch`（假设性延续）→ **默认不注入**（NarraWorld 在事实问答上排除它反而 +4.4 分），只在剧作家需要「下一步可以怎么走」时作为 tool 结果给。

---

## 机制 2：变更驱动的状态卡（delta card）+ 常驻/触发双层 + 优先级预算丢弃

**来源**：NovelAI Lorebook 的 `Insertion Order / Token Budget / Reserved Tokens / Trim`；SillyTavern WI 的 `context % 预算 + 优先级丢弃 + inclusion group`；Foreverse 的「常驻 ≤5 条」「超预算静默丢弃」；AI Dungeon 的四段预算切分；Horae 的「**关系网变化时才输出，无变化零 Token**」；muyoou 表格插件的**反面教训**（「注入是全表覆盖，每轮重发整张表，token 消耗更大」）

**对应问题点**：P2（直接）、P3（间接）

**数据结构**：

```
StateCard {
  id
  scope:        global | character:<id> | location:<id> | item:<id>
  tier:         constant | triggered        # 蓝灯 / 绿灯
  keys:         [别名、绰号、职务 ...]     # 触发用；NovelAI 支持 & 与正则
  body:         事实前置的电报体，200–500 字
  version:      int
  last_changed_turn: int
  budget_tokens: int                        # 该卡上限
  priority:     int                         # 同批注入时的排序键
  emit_policy:  always | on_change          # ← Horae 的省钱核心
  sticky / cooldown / delay: int            # ← 触发后的寿命控制
}
```

**两条硬规则（直接抄）**：
1. **常驻条目 ≤ 5 条**（Foreverse 明确建议；中文教程建议全局世界观用蓝灯 1–3 条）。stage-ai 的 always/ 区应当照此收敛：premise + craft + DSL spec + 至多 1–2 条全局状态，其余全部走触发。
2. **超预算按优先级静默丢弃**，并且**丢弃顺序要可预测**：常驻先胜出 → 再看 priority → 直接命中触发词胜过「只在别的卡内容里被提到」。

**触发时机**：每轮装配时扫描最近 N 轮（NovelAI 用字符窗口，SillyTavern 用消息条数，AI Dungeon 用「≥4 个 action，或 `可用token÷100` 个 action」）。**建议采用 AI Dungeon 的自适应公式**：预算充足时扩大回看窗口。
**提示词位置**：`tier=constant` 的卡进 A1 区；`tier=triggered` 的卡**进 B 区**，插在**最近若干轮对话之前**（AI Dungeon 把 Story Cards 放在 Dynamic 段顶部；NovelAI 支持负数 insertion position 插到近底部）。

**关键提示**：Foreverse 的排障表指出「**触发了但模型不采信 → 条目太长太文学，改成事实前置的电报体**」。这条对 galgame 尤其重要 —— 角色卡越文学化，越容易被模型当作氛围描写而忽略其约束力。

---

## 机制 3：预览驱动的依赖规划（planned reconstruction）取代 top-k 相似度召回

**来源**：NarraWorld 的 retrieval 阶段；RAPTOR（多粒度树）；「grep is all you need」的检索范式讨论

**对应问题点**：P3

**机制**：
1. 维护一份**紧凑的 memory preview**：**完整角色名单 + 每人一句简介 + 所有 open developments + 最近 N 条 record 的标题**（不是全文）。NarraWorld 明确说 preview 里放的是 "the full character roster, brief descriptions, developments, and records"。
2. 剧作家先输出（或系统先跑一次小模型）**依赖规划**：从「当前叙事情境 + 本轮的写作请求」推导出**隐式依赖**。原文的例子：一句「rewrite the betrayal scene」不只需要背叛本身，还需要**这次修改会牵连到的角色关系**。
3. 用规划出的依赖去检索（可 grep + 向量混合），在 **token 预算内装配**。
4. 检索结果如果是高层摘要节点，**按 atomic closure 展开**到需要的那一层为止（不必展开到底）。

**为什么重要**：相似度检索**被 query 文本本身所限**，天然找不回「用户没提到但会被影响」的东西。stage-ai 的 archive 是 MiniSearch 全文检索，这一点上**已经比纯向量更可控**：检索性能研究（Is grep all you need?）显示 grep 在全部 10 组 inline 配对中胜出、在 file-based 配对中赢 5/10，**交付方式（delivery mode）比检索器本身影响更大** —— 也就是说，**「检索到什么」不如「把检索结果放在 prompt 的什么位置」重要**。

**触发时机**：在**重建（rebuild）**与**每次需要跨纪元素材的轮次**执行；日常轮次可省（只有 local 上下文）。
**提示词位置**：规划输出不进 prompt（是内部中间产物）；**装配结果进 B 区**，插在最近对话段之前。

---

## 机制 4：写入时裁决 + 双时间失效（不删除）—— 版本与冲突的完整答案

**来源**：Zep/Graphiti 的双时间模型；Mem0 的四操作与优先级；STALE/CUPMem 的 write-time revision；Character.AI 的 Facts 可编辑删除 + Memory Usage；Novelcrafter 的 Codex Revision History；AI Dungeon 的 `Log Generations in Notes`

**对应问题点**：P1（写工具的**语义**就是这里定义的）、P3、P4

**数据结构**（在机制 1 的 MemoryRecord 上扩展）：

```python
class MemoryRecord:
    # ---- 双时间 ----
    valid_at:   turn | None     # 剧情内何时开始为真
    invalid_at: turn | None     # 剧情内何时不再为真
    created_at: turn            # 引擎何时写入（= 生成它的那一轮）
    expired_at: turn | None     # 引擎何时得知它被取代
    # ---- 状态 ----
    status:     active | superseded | retracted
    superseded_by: record_id | None
```

**写入算法（把 Mem0 + Graphiti 合成一套可执行的规则）**：

1. 抽取候选事实（含 subject/predicate/object 与来源台词区间）；
2. 与库中同 `(subject, predicate)` 的 active 记录比对，产出四操作之一，**优先级 `NOOP > DELETE > UPDATE > ADD`**（Mem0 官方优先级）；
3. 若判定为 UPDATE/DELETE：
   ```
   旧记录：invalid_at ← 新事实的 valid_at
           expired_at ← 本轮 turn
           status     ← superseded
           superseded_by ← 新记录 id
   ```
   **旧记录保留不删**（Graphiti 的时间化失效）；
4. 新记录以 `reference_time = 本轮剧情时间` 写入（保证 `valid_at` 锚定在**剧情发生时间**而非**引擎处理时间**）；
5. **传播失效**（STALE/CUPMem 的核心）：一条记录的失效要传播到依赖它的记录（例如「钥匙在抽屉」失效 → Leo 的 belief 仍然有效，因为**信念不会被事实变化自动推翻**；但「Leo 知道钥匙位置」这条 development 可能要被标记为 blocked）。
6. 把本次变更追加到**变更日志**（见机制 5 的 P4）。

**提示词位置 / 触发时机**：
- 写入由记忆写手（机制 5）在**每轮结束后**执行；
- 读回时**默认只注入 `status=active` 的记录**；
- 需要「回溯剧情」时（例如角色提到「你当初说过……」），可按时间点查询：`valid_at <= T AND (invalid_at > T OR invalid_at IS NULL)`（Graphiti 的查询语义）。

**给剧作家的写工具最小集**（参考 Anthropic memory tool 的命令集与 Novelcrafter 的取舍哲学）：

```
world_state_write(scope, key, value, evidence_turn_range)   # 需要时自动裁决 ADD/UPDATE/DELETE
world_state_read(query | time_point, budget_tokens)
world_state_list(scope, status_filter)
world_memory_append(view, holder, text, evidence)           # 事件/发展/信念
```

Anthropic 的 memory tool 命令面是 `view / create / str_replace / insert / delete / rename`，**全部限定在 `/memories` 前缀下**（并要求做路径穿越防护）；Claude「在开始任务前会自动检查记忆目录」，工作是**把学到的东西写进文件、后续会话再读回来** —— 这就是「剧作家有写工具」的标准形态。

**关于「工具怎么设计 LLM 才会用」**（Anthropic 的 Writing effective tools for agents 一文的要点，直接可用于设计写卡工具）：
- **工具返回值要 token 高效**：只回高信号信息，**优先上下文相关性而非灵活性**，避免 `uuid`/`mime_type` 这类底层标识符；**把任意字母数字 UUID 换成语义化名称或 0-indexed ID，能显著提升检索精度、减少幻觉** —— 这条直接支持「不要用裸 UUID 做记忆 ID」。
- **提供 `response_format: concise | detailed` 参数**让 agent 自己控制返回详略。
- **对可能吃光上下文的返回值实现分页 / 区间选择 / 过滤 / 截断**（Claude Code 默认把工具返回限制在 25,000 token）。
- **错误信息要 prompt-engineer 过**：给出「具体可执行的改进方向」，而不是不透明的错误码或 traceback。
- **工具描述要像给新同事交接**：把隐含的查询格式、术语定义、资源间关系写显式；参数名要无歧义（`user_id` 而不是 `user`）。
- **工具按任务的自然切分命名**，减少 loaded 到上下文里的工具数量。

---

## 机制 5：异步记忆写手（sleep-time agent） + append-only 事件日志 + git 化记忆目录

**来源**：Letta 的 sleep-time compute / dreaming；AI Dungeon 的 Memory Bank 并行模型；Anthropic 的 structured note-taking 与 compaction；事件溯源（event sourcing）

**对应问题点**：P1（无写工具的正面解法）、P3、**P4（单点故障）**

### 5a. 把「写」从剧作家身上卸载

Letta 的论证值得照抄：
- 把记忆管理、对话和其他任务**捆在同一个 agent 里**会同时导致**更慢**（对话中要调记忆操作）和**更不可靠**（要同时调记忆工具与普通工具）。
- 解法是**两个 agent**：primary 面向用户（**不给它编辑记忆的工具**），sleep-time agent 持有**编辑 primary 上下文记忆的工具**，异步跑。
- **模型可以不同**：primary 用快模型；**sleep-time 用更强更慢的模型**（不受延迟约束）。
- **触发频率可配**：「每 N 个 step」或「**当上下文窗口被压缩时**」—— 后者与 stage-ai 的**纪元压缩**是同一时机。
- **可选二次审阅**：`Agent reviews before applying` —— 用第二个后台对话先审阅和修订提议的记忆变更（消耗更多 token，但不打扰用户）。
- **定期审计**：Letta 的 `/doctor` 用来审计**放置（placement）、重复（duplication）、system prompt token 占用** —— 直接对应 stage-ai 的「A 区角色表无界增长」，即需要一个例行的「记忆体检」任务。

AI Dungeon 的侧面印证：「memory bank 由另一个 AI 模型**与你的冒险并行**创建，每过若干 action 写一条记忆」。

**落到 stage-ai**：
- 剧作家（playwriter）**不承担**压缩与整理职责，它只通过机制 4 的工具做**本轮的增量写入**；
- 纪元压缩由一个**独立的 memory-writer 角色**在纪元边界（或上下文被压缩时）执行，可用更便宜的模型；
- 压缩提示词按 Anthropic 的建议来调：**先最大化 recall，确保捕获每一条相关信息，再迭代提升 precision 去掉冗余**。

### 5b. P4：append-only 日志 + git 化记忆目录

- **事件溯源模式**：**把每一次状态变更写成 append-only 事件**，当前状态由**重放事件**导出。业界共识表述：「The safest pattern is event sourcing: write every state change as an append-only event, then derive current state by replaying events.」Temporal 这类工作流引擎正是用 append-only 事件日志在其持久层里**跨重启/崩溃恢复状态**。
- **Letta MemFS 的具体形态**：agent 用**一个 git-backed 的记忆文件系统**；整理前「**先备份当前仓库**」再拆分/合并/重构；有 versioning model 与 synchronization behavior。
- **Anthropic 的对应做法（structured note-taking / agentic memory）**：agent **定期把笔记持久化到上下文之外**，之后再拉回来；Claude Code 用 to-do list，自定义 agent 用 `NOTES.md`。Claude 玩 Pokémon 的案例：agent **在数千步里维持精确的记账**（「过去 1,234 步我都在 1 号路练级，皮卡丘离目标 10 级还差 8 级」），**自己发展出已探索区域的地图、记住解锁了哪些成就、维护战斗策略笔记**；**上下文重置后，agent 读自己的笔记就能继续多小时训练序列**。
- 这条对 stage-ai 尤其重要：`session.json` 单点故障的解法不是「更频繁地写同一个 json」，而是**把状态拆成「不可变事件日志 + 可从日志重建的派生快照」**，快照损坏/截断时可以从日志重放。

**推荐落地形态**：

```
plays/<id>/journal/<epoch>.ndjson     # append-only，每行一条事件（roll 完写一行，fsync）
plays/<id>/state/                     # 从 journal 重建出的派生快照（可随时丢弃重建）
plays/<id>/memory/                    # git-backed 记忆目录（always/ index/ archive/）
                                      # 纪元边界自动 commit，整理前自动 backup
```

**提示词位置**：journal 与 state/ 默认**不进 prompt**；只有 memory/ 下的卡片按机制 2/3 装配。

---

## （附）第 6 个值得留意的机制：遗忘/衰减

**来源**：MemoryBank（艾宾浩斯遗忘曲线）、Generative Agents（recency 指数衰减）、MOOM（遗忘机制）、AI Dungeon 的 Memory Bank 容量上限

**要点**：记忆强度随时间衰减、**被回忆时强化**。在 galgame 里最自然的映射是**重要度分级 + 衰减**：重要度低的记录随时间降权、最终被压缩进 arcs 摘要；重要度高的记录（承诺、伏笔、关系转折）永不衰减。GenAI 的实际做法是把 `relevance + recency + importance` 三者合成分数 —— **recency 项正是防止「A 区/索引区被远古细节永久占位」的机制**。
这是 P2（无界增长）的**长期解**：机制 2 解决「每轮注入多少」，遗忘机制解决「库里永久保留多少」。

---

# 3. 上下文工程最佳实践与 A 区 / B 区装配建议

## 3.1 先说结论性事实（这些是硬约束，不是偏好）

### 3.1.1 缓存是前缀哈希，任何前缀变更都会击穿它

- **Anthropic**：缓存键是「**从开头到断点的累积前缀哈希**」。文档原话要点：
  - 创建顺序是 **`tools` → `system` → `messages`**，构成层级；
  - **写入只在你的断点发生**（打一个 `cache_control` 只写一条缓存条目）；
  - **读取是向后回溯**：在断点处算前缀哈希，找不到就**一次往前退一个 block** 地找之前写入过的条目；
  - **回溯窗口是 20 个 block**；超过就彻底 miss。**长回合里建议每约 15 个 block 放一个中间断点**；
  - 「**在 prompt 开头放置静态内容**（工具定义、系统指令、上下文、示例），用 `cache_control` 标出可复用内容的结尾」；
  - **想消除首个真实请求的 cache-miss 延迟，可以在启动时发一个 `max_tokens: 0` 的请求**：API 会执行 prefill（在你的 `cache_control` 断点写入缓存）并立即返回（`content: []`、`stop_reason: "max_tokens"`），输出 token 计费为 0，只按正常 cache-write 计费。断点要打在**与真实请求共享的最后一个 block**（system prompt 或 tool definitions）上，**不要打在占位 user 消息上**。
- **OpenAI**：缓存起步 **1024 token**，命中在 1024 之上**以 128 token 为增量**（1024 → 1152 → 1280…），最后不足一个增量的部分按全价计；**只匹配前缀，且要求精确匹配**。
- **DeepSeek**：**Context Caching on Disk**，自动的，要求**从 prompt 开头起逐字符完全一致**；命中后输入 token 价格降至约 1/10。
- **SillyTavern 文档的直接警告**：任何**动态 prompt 源**（World Info、Summarization、Chat Vectorization…）都会**在多次调用之间重构 prompt 前缀**，导致频繁 cache miss；**与缓存同用时向量化往往适得其反，必须二选一**。
- **NstAgent 的实测**：100K 字故事每篇 7.5M input token，其中**约 60% 由 provider cache 服务**，成本从 $2.28 降到 $1.32。

**推论**：**「每轮重排/重发动态内容」与「高缓存命中率」是互斥的**。stage-ai 现在把「标题摘要注入」放在固定位置，如果这些摘要每轮都变，就等于每轮击穿缓存。

### 3.1.2 长上下文的退化是位置性的，也是长度性的

- **Anthropic**：context rot —— token 数增加时模型从上下文中**准确回忆**信息的能力下降；原因是 transformer 的 **n² 成对关系**被摊薄，且训练分布里短序列更常见；表现为**性能梯度而非悬崖**，长上下文下「信息检索与长程推理的精度」下降。
- **Lost in the Middle**：相关信息出现在**开头或结尾时**性能最高，**出现在长上下文中段时显著退化**，即使对明确的长上下文模型也一样。
- **ConStory-Bench**：长篇叙事的矛盾**倾向出现在中段**。

**推论**：**最硬的约束放开头，最紧的上下文放结尾**。中段是「可信度最低区」。

### 3.1.3 compaction 的调参方法（Anthropic 原话要点）

- compaction = 「把接近上下文上限的对话**高保真地**压缩成摘要，然后**在一个新上下文窗口里重新开始**」；
- Claude Code 的实现：把消息历史交给模型压缩，**模型保留架构决策、未解决的 bug、实现细节，丢弃冗余的工具输出与消息**；然后 agent 用「压缩后的上下文 + **最近访问的 5 个文件**」继续；
- **「compaction 的艺术在于选择保留什么、丢弃什么」**：过于激进的压缩会丢掉「重要性只在后来才显现的微妙但关键的上下文」；
- **调参建议**：**先在复杂 agent trace 上最大化 recall（确保压缩提示词捕获每一条相关信息），再迭代提升 precision（去掉多余内容）**；
- **最低成本的一种 compaction 是 tool result clearing**（工具结果一旦深入历史，agent 为什么还要再看原始结果？）；
- **结构化笔记**与**子 agent 架构**是另外两条并行路线：subagent 各自可能烧掉几万 token，但**只返回 1,000–2,000 token 的凝练摘要**。

---

## 3.2 给 A 区 / B 区装配的 3 条可落地建议

### 建议 1：把 A 区劈成 A0（字节冻结）与 A1（纪元级状态），并把缓存断点放在 A0 末尾

**现状问题**：always/（premise、craft、角色卡全文）整体注入 system prompt。角色卡一旦随剧情更新，**premise 与 craft 的缓存也一起被击穿**。

**建议的分区**：

```
[ A0 —— 纪元内字节级不变，缓存断点打在这里 ]
  premise（世界观前提）
  craft（剧作手法/风格约束）
  DSL 规范 + 引擎契约（Stage DSL 的语法与可用指令）
  → cache_control 断点

[ A1 —— 只在纪元边界变化 ]
  当前侧写：在场角色全卡（tier=constant，≤5 条）
  世界状态卡：active 的 world facts（一行制）
  open developments 列表（一行制）
  arcs 摘要卡（纪元压缩产物）
  → cache_control 断点

[ B 区 —— 每轮可变，放在 messages 里、靠近最后一个 user turn ]
  触发注入的世界书条目（tier=triggered）
  本轮按需召回的 archive 切片 / 卡详情
  最近 N 轮实际对话

[ 尾部 —— 最紧的指令 ]
  PHI 风格的「本轮演出要求」（SillyTavern 文档明确说 PHI 优先级高于主提示词）
```

**几条具体做法**：
- **不要在 A0 里放任何每轮会变的量**：时间戳、UUID、随机 JSON key 顺序、检索片段、用户特定元数据放在前缀过早处，都会破坏字节稳定的前缀（这条在中英文资料里被反复点名）。
- **为「变化频率不同的段落」分别设断点**（Anthropic 明确列出的场景）。A0 一个断点、A1 一个断点，这样**A1 变化只击穿 A1 之后的缓存**，premise/craft/DSL 的缓存得以保留。
- **长回合补中间断点**：如果一轮里有大量工具调用（≈ 很多 block），按 Anthropic 的建议**每约 15 个 block 放一个中间断点**，否则会掉出 20-block 回溯窗口而静默 miss。
- **纪元重建后预热缓存**：发一个 `max_tokens: 0` 的 prefill 请求把 A0+A1 写进缓存，**这样玩家的第一个真实请求不会承担全量 prefill 延迟**。
- **确认网关侧的缓存行为**：不同 provider 的规则不同（OpenAI 1024 起步 / 128 增量 / 精确前缀；DeepSeek 逐字符前缀 / 命中约 1/10 价）。若走 cpa 网关转发，**先实测 `prompt_cache_hit_tokens` 之类的用量字段**再决定断点策略。

### 建议 2：A1 用「roster 一行制 + 全卡按需」双层表示，且状态一律走 delta 写入

**这条直接针对「A 区角色表无界增长」。**

- **roster 层（常驻，一行一角色）**：
  `名字 | aliases | 在场? | 关系值/立场 | 一句话当前状态 | state_version`
  这是**唯一必须常驻的角色内容**，长度与角色数成线性但每行极短。**NovelAI / AI Dungeon / SillyTavern 三家都把「常驻条目 ≤ 5 条 / 常驻要短」当作硬建议**；Foreverse 的排障表把「聊久了失效」直接归因于「预算被常驻和长条目吃满」。
- **全卡层（触发注入）**：
  `keys = [名字, 小名, 职务, 绰号]`（中文教程反复强调**别名要覆盖多种叫法**，否则漏触发）。全卡正文遵循 Novelcrafter 的排障结论：**关键信息放在条目开头**；**只挂提供关键上下文的条目，宁缺毋滥**；遵循 Foreverse 的结论：**事实前置的电报体，不要文学化**。
- **写入一律 delta**：
  - 关系网：**只在变化时输出**（Horae 的做法，「无变化零 Token」）；
  - **绝对不要**走「每轮重发整张表」的路线（muyoou 表格插件的已知短板，中文横评明确指出它「Token 消耗稍大」）；
  - 每次变更**递增 `state_version` 并写一条 journal 记录**（同时服务 P4）。
- **按性别/在场裁剪**：不在场的角色只保留 roster 行；这相当于把角色卡从「全集」降为「工作组缓存」，是 SillyTavern 蓝灯/绿灯二分在角色维度上的直接应用。
- **给「角色卡」本身设 token 上限**（NovelAI 的 `Token Budget` + `Reserved Tokens` + `Trim Direction`）。Trim Direction 尤其值得引入：**「Do Not Trim」= 只有完整装得下才注入**，这对「角色卡被截半导致人格崩坏」是直接的防御。

### 建议 3：召回内容与摘要一律进 messages 尾部，B 区改成「预览 → 规划依赖 → 预算装配」

**这条针对「重建时上下文截断失忆」。**

- **位置**：
  - **把召回内容放进 `messages`，且靠近最后一个 user turn**，而不是塞进 system prompt。理由有两层：一是**不污染 A0 的字节稳定前缀**；二是**利用「结尾位置注意力最高」**。
  - AI Dungeon 的实际排布印证了这一点：Author's Note 与 Last Action 在全序列**最靠后的位置**（且 Required 环节里这两项**永远完整保留、不截断**）；NovelAI 提供**负数 insertion position 把条目插到接近底部**；SillyTavern 让 Summarize 的注入位置「与 Author's Note 相同」——三家都把最高优先级材料放在尾部。
  - 同时 **context rot 的位置规律要求把最硬的约束也放开头**：这就是「A0 放不可违背的规则、尾部放本轮的紧约束」的双锚结构。
- **摘要粒度：不要二选一，要做树**（RAPTOR 的结论）。建议三档：
  | 粒度 | 产物 | 保留什么 | 位置 |
  |---|---|---|---|
  | **turn** | 每轮台词切片 | 原样（已在 archive） | 不注入，仅检索 |
  | **scene** | 场景卡（10–30 轮） | 事件 + 参与者 + 结果 + 状态变更 diff + 子节点 ID | B 区按需 |
  | **arc/epoch** | arcs 摘要卡 | 支线状态 + 关系变化 + 未回收伏笔 + 子节点 ID | A1 常驻 |
  每个高层节点**必须存子节点 ID（atomic closure）**，否则「展开回原台词」不可能，就会重演中文教程里描述的「重发角色卡没反应、反复提醒越提醒越乱、最后只能重开一个对话」。
- **压缩节奏与提示词**：
  - 采用中文社区的节奏建议：**每 50–80 轮小总结，每 200–300 轮大总结**，关键剧情节点单独建条目；
  - 压缩提示词按 Anthropic 的方法调：**先最大化 recall，再提 precision**；优先做**最轻的清理**（例如把「已经过去很久的工具调用原始返回」清掉）；
  - 压缩时必须**保留 claim attribution 与不确定性** —— NarraWorld 明确指出：**「更强的摘要措辞会覆盖记忆中保留的区分」**（shared writing summaries should preserve claim attribution and uncertainty, since stronger summary wording can override distinctions retained in memory）。这意味着摘要里「据说 / 主角以为 / 实际是」必须显式标注，否则信念/事实的分离会在摘要层被抹平。
- **B 区的检索不要做 top-k 相似度**，改做机制 3 的 **preview → dependency planning → budgeted assembly**。落地上：
  - 维护一份**预览串**（roster + 一句简介 + open developments + 最近记录标题），它本身也进 A1（很短）；
  - 检索器保留 MiniSearch 全文检索（**grep 类检索在「inline 交付」场景下的表现被实测优于向量**），必要时叠加向量；
  - **交付方式（放哪一段、怎么包装）比检索器本身影响更大** —— 优先把工程投入放在装配位置与包装格式上。
- **一个具体的排版细节**：AI Dungeon 给 Story Card 的包裹前缀是 `World Lore:`，Memory Bank 用 `Memories:`，Story Summary 用 `Story Summary:`。**显式的小标题分级**是最省事的效果杠杆；SillyTavern 也建议用 `{{summary}}` 宏 + Injection Template 包一段固定壳。

---

## 3.3 除 A/B 区之外的 3 处顺带建议（来自调研中反复出现的工程共识）

1. **装配必须可视**：AI Dungeon 有 Context Viewer、SillyTavern 有 Prompt Itemization / Prompt Inspector、Memo 有 Memory Usage、Letta 有 `/doctor`。**「本轮 prompt 里到底有什么、每条卡片为什么被激活/被丢弃」必须可查**，否则所有触发/预算 bug 都无法定位。Foreverse 的排障原则值得内化：**「条目失效不报错 —— 排障永远从『它有没有被注入』查起，而不是问模型为什么不听话。」**
2. **写工具与读工具都要做 tool description 工程**：Anthropic 的结论是**工具描述的精细调整能带来巨大提升**（Claude Sonnet 3.5 在 SWE-bench Verified 上取得 SOTA 的表现，来自精确化工具描述后错误率的显著下降）。同时**把 UUID 换成语义化名称能显著提升检索精度**（这条应直接作用于 archive/记忆 ID 的设计）。
3. **给「记忆整理」留一个人工审阅位**：Letta 的 `Agent reviews before applying`（第二个后台对话审阅）与 Novelcrafter 的 Revision History、Character.AI 的 Facts「可编辑可删除」是同一个思想的三种强度。**最弱的版本也要有「回退到上一版」的能力**（SillyTavern 的 `Restore Previous`、git-backed MemFS 的 backup-before-reorganize）。

---

## 3.4 一个必须承认的开放问题

即使是本文引用的最新工作，也**没有解决「past events 无界增长」**：

- **NstAgent（2026-09）**：past events 累积且**不淘汰**，作者原话把「**Bounding or consolidating the past-event log**」列为 **future work**。
- **NarraWorld（2026）**：靠 hierarchical aggregation + delimiting 的 hypothetical 分支来控制规模，但没有讨论无限长度下的长期增长。
- **MOOM** 自称是「第一个」正面处理「现有方法记忆无控制增长」的双分支插件，用**遗忘机制**控制规模 —— 这是目前最直接回应该问题的方案。
- **AI Dungeon** 用**产品层面的硬上限**（Memory Bank 25/100/200/400 条）+ **用户手动编辑**来兜底。
- **MemoryBank** 用遗忘曲线、**Generative Agents** 用 recency 衰减、**Mem0** 用 `NOOP > DELETE > UPDATE > ADD` 的保守写入策略，都是「抑制增长」而非「保证有界」。

也就是说：**「有界 + 不丢关键 + 可下钻」是一个真实的开放问题**。stage-ai 若要声称解决它，需要自己给出策略，可选的组合是「机制 2 的注入预算 + 机制 1 的层级 atomic closure + 附件的遗忘衰减 + 硬上限」。

---

# 4. 来源清单

## 4.1 商业产品与官方文档

1. AI Dungeon — What is the Memory System? <https://help.aidungeon.com/faq/the-memory-system>
2. AI Dungeon — What goes into the Context sent to the AI? <https://help.aidungeon.com/faq/what-goes-into-the-context-sent-to-the-ai>
3. AI Dungeon — What are Story Cards? <https://help.aidungeon.com/faq/story-cards>
4. AI Dungeon — What is Plot Essentials? <https://help.aidungeon.com/faq/plot-essentials>
5. AI Dungeon — 讨论：memory 如何工作 <https://www.reddit.com/r/AIDungeon/comments/1mexyw1/how_does_memory_works>
6. AI Dungeon — 讨论：能否自动更新 story card <https://www.reddit.com/r/AIDungeon/comments/1h2fcaa/is_there_any_way_to_auto_update_information_in>
7. MagicCards（自动生成 Story Card 的 AI Dungeon 脚本）<https://github.com/magicoflolis/MagicCards>
8. LewdLeah（AutoCards / Inner Self 作者）<https://github.com/LewdLeah>
9. FableForge 到 AI Dungeon 的 Story Card 指南 <https://news.thefableforge.com/posts/ai-dungeon-quickstart>

10. NovelAI — Lorebook 官方文档 <https://docs.novelai.net/en/text/lorebook>
11. NovelAI — Lorebook 教程 <https://www.tutorialspoint.com/novelai/novelai-lorebook.htm>
12. NovelAI — Quick Guide（Context Viewer / Ephemeral Context / Context Settings）<https://www.tutorialspoint.com/novelai/novelai-quick-guide.htm>
13. NovelAI — UKB Lorebook 笔记 <https://github.com/TapwaveZodiac/novelaiUKB/blob/main/docs/Lorebook.md>

14. SillyTavern — World Info <https://docs.sillytavern.app/usage/core-concepts/worldinfo>
15. SillyTavern — Prompts（Main Prompt / PHI / Context 组成）<https://docs.sillytavern.app/usage/prompts/>
16. SillyTavern — Prompt Manager <https://docs.sillytavern.app/usage/prompts/prompt-manager>
17. SillyTavern — Summarize 扩展 <https://docs.sillytavern.app/extensions/summarize>
18. SillyTavern — Chat Vectorization 扩展 <https://docs.sillytavern.app/extensions/chat-vectorization>
19. SillyTavern — Data Bank <https://docs.sillytavern.app/usage/core-concepts/data-bank>
20. SillyTavern — World Info Encyclopedia（第三方深度指南，kingbri / Alicat / Trappu）
21. SillyTavern-Docs — Prompts and Context（DeepWiki）<https://deepwiki.com/SillyTavern/SillyTavern-Docs/3.2-prompts-and-context>
22. SillyTavern — MessageSummarize 扩展 <https://github.com/qvink/SillyTavern-MessageSummarize>

23. Character.AI — Helping Characters Remember What Matters Most（2025-05 Chat Memories）<https://blog.character.ai/helping-characters-remember-what-matters-most>
24. Character.AI — Smarter Memory for Smarter Chats（2026 Story Memory / Facts / Memory Usage）<https://blog.character.ai/memory>
25. Roborhythms — Character AI Story Memory 取代 Chat Memories <https://www.roborhythms.com/character-ai-adds-chat-memories>
26. StoryChat — 如何让 Character.AI Bot 真正记住东西 <https://blog.storychat.app/how-to-make-your-character-ai-bots-actually-remember-stuff-finally>

27. Novelcrafter — Codex 功能页 <https://www.novelcrafter.com/features/codex>
28. Novelcrafter — The Codex（帮助文档）<https://www.novelcrafter.com/help/docs/codex/the-codex>
29. Novelcrafter — Adding Codex entries as scene context <https://www.novelcrafter.com/courses/codex-cookbook/codex-scenes>
30. Novelcrafter — Revision History <https://www.novelcrafter.com/help/docs/organization/revision-history>

31. Letta — Sleep-time Compute <https://www.letta.com/blog/sleep-time-compute>
32. Letta — Memory & dreaming（MemFS / dreaming / doctor）<https://docs.letta.com/configuration/memory>
33. Letta — sleep-time-compute 论文配套仓库 <https://github.com/letta-ai/sleep-time-compute>

## 4.2 中文社区实践

34. SillyTavern 中文教程站 — 世界书入门 <https://guide.sillytavern.one/presets-lorebooks/lorebook-basics>
35. SillyTavern 中文教程站 — 记忆插件横评（Horae / 记忆表格 / Amily2 / 全自动总结）<https://guide.sillytavern.one/extensions/memory-extensions>
36. SillyTavern 中文教程站 — 长对话失忆终极解决方案：三种总结技巧 <https://guide.sillytavern.one/advanced/long-chat-summary>
37. Foreverse — 世界书规范（触发、预算与 V3 decorators）<https://foreverse.cn/zh/docs/worldbook>
38. Foreverse — 世界书不触发？按这张表逐条排查 <https://foreverse.cn/zh/blog/lorebook-not-triggering-checklist>
39. 腾讯云开发者社区 — RPG Companion × VectFox Advanced RAG：打造真正长期运行的 SillyTavern RPG 世界 <https://developer.cloud.tencent.com/article/2711460>
40. st-memory-enhancement（酒馆记忆增强 / 表格记忆）<https://github.com/muyoou/st-memory-enhancement>
41. SillyTavern-Horae（时光记忆）<https://github.com/SenriYuki/SillyTavern-Horae>
42. AutoSummarizer（全自动总结脚本）<https://github.com/EphemeralAlien/AutoSummarizer>
43. VectFox（EventBase 结构化事件记忆）<https://github.com/KritBlade/VectFox>
44. 火山引擎 AgentKit — 记忆库概述 <https://docs.volcengine.com/docs/agentkit/Memory_overview?lang=zh>
45. Awesome-AI-Memory（记忆研究索引）<https://github.com/IAAR-Shanghai/Awesome-AI-Memory>
46. Awesome-Agent-Memory <https://github.com/TeleAI-UAGI/Awesome-Agent-Memory>
47. 本地 AI 聊天入门指南（世界书扫描深度 / token 预算）<https://www.scribd.com/document/881731449/>

## 4.3 Anthropic / OpenAI / DeepSeek 官方上下文工程资料

48. Anthropic — Effective context engineering for AI agents <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
49. Anthropic — Effective harnesses for long-running agents <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>
50. Anthropic — Writing effective tools for AI agents <https://www.anthropic.com/engineering/writing-tools-for-agents>
51. Claude Docs — Prompt caching（断点、20-block 回溯、max_tokens:0 预热）<https://docs.claude.com/en/docs/build-with-claude/prompt-caching>
52. Claude Docs — Memory tool（`/memories`、命令集、路径穿越防护）<https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool>
53. Claude Docs — Compaction overview <https://platform.claude.com/docs/en/build-with-claude/compaction>
54. Claude Docs — Context editing <https://platform.claude.com/docs/en/build-with-claude/context-editing>
55. Anthropic — Managing context on the Claude Developer Platform <https://claude.com/blog/context-management>
56. Anthropic Cookbook — Context engineering: memory, compaction, and tool clearing <https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools>
57. OpenAI — Prompt caching 指南 <https://developers.openai.com/api/docs/guides/prompt-caching>
58. OpenAI Cookbook — Prompt Caching 201 <https://developers.openai.com/cookbook/examples/prompt_caching_201>
59. Azure OpenAI — Prompt caching（1024 起步 / 128 增量）<https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching>
60. DeepSeek — Context Caching on Disk <https://api-docs.deepseek.com/news/news0802>
61. Modular — Prefix caching（LLM Inference Handbook）<https://handbook.modular.com/inference-optimization/prefix-caching>
62. Prompt Caching 架构（缓存断点工程）<https://appscale.blog/en/blog/prompt-caching-architecture-llm-apps-agents-prefix-cost-latency-2026>
63. Prompt caching 命中率与缓存失效 <https://managed-code.com/blog-post/prompt-caching-explained>
64. LLM 缓存架构 <https://architecturediagram.ai/blog/llm-caching-architecture>
65. Fastio — DeepSeek token 上限与精确前缀匹配 <https://fast.io/resources/deepseek-token-limit>

## 4.4 学术论文（记忆架构 / 叙事一致性）

66. MemGPT: Towards LLMs as Operating Systems — arXiv 2310.08560 <https://arxiv.org/abs/2310.08560>
67. Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory — arXiv 2504.19413 <https://arxiv.org/html/2504.19413v1>
68. Mem0 自定义提示词与四操作 <https://deepwiki.com/mem0ai/mem0/11.1-custom-prompts>
69. Mem0 — Memory Operations 文档 <https://github.com/mem0ai/mem0/tree/main/docs/core-concepts/memory-operations>
70. Zep / Graphiti — Bi-Temporal Data Model <https://getzep-graphiti.mintlify.app/concepts/temporal-model>
71. Graphiti — Temporal Edge Invalidation 源码说明（`graphiti_core/utils/maintenance/edge_operations.py`）
72. MemOS: An Operating System for Memory-Augmented Generation — arXiv 2505.22101 <https://arxiv.org/abs/2505.22101>
73. Generative Agents: Interactive Simulacra of Human Behavior — arXiv 2304.03442 <https://arxiv.org/pdf/2304.03442>
74. RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval — arXiv 2401.18059 <https://arxiv.org/abs/2401.18059>
75. RAPTOR 参考实现 <https://github.com/parthsarthi03/raptor>
76. HippoRAG（NeurIPS 2024）<https://papers.nips.cc/paper_files/paper/2024/file/6ddc001d07ca4f319af96a3024f6dbd1-Paper-Conference.pdf>
77. HippoRAG 开源实现 <https://github.com/sravya8/hipporag>
78. MemoryBank: Enhancing Large Language Models with Long-Term Memory — arXiv 2305.10250 <https://arxiv.org/abs/2305.10250>
79. RecurrentGPT: Interactive Generation of (Arbitrarily) Long Text — arXiv 2305.13304 <https://arxiv.org/abs/2305.13304>
80. RecurrentGPT 仓库 <https://github.com/aiwaves-cn/RecurrentGPT>
81. A Survey on the Memory Mechanism of Large Language Model-based Agents（ACM TOIS 2025）<https://dl.acm.org/doi/10.1145/3748302>
82. 记忆机制综述配套仓库 <https://github.com/nuster1128/LLM_Agent_Memory_Survey>
83. LongMemEval（ICLR 2025）<https://proceedings.iclr.cc/paper_files/paper/2025/file/d813d324dbf0598bbdc9c8e79740ed01-Paper-Conference.pdf>
84. LongMemEval 代码 <https://github.com/xiaowu0162/LongMemEval>

## 4.5 学术论文（长篇叙事 / 角色扮演）

85. Scaling Long-Form Story Generation via Narrative State Tracking（NstAgent）— arXiv 2609.35759 <https://arxiv.org/abs/2609.35759> / <https://arxiv.org/html/2609.35759v1>
86. NstAgent 代码 <https://github.com/zhennan1/NstAgent>
87. Shared Worlds, Private Minds: Structured Memory for Long-Form Writing as World Creation（NarraWorld）— arXiv 2609.32401 <https://arxiv.org/html/2609.32401v1>
88. DREAM: LLM-based Dynamic Role-playing via Event-Aware Memory Graph — arXiv 2608.05170 <https://arxiv.org/html/2608.05170>
89. Staying In Character: Perspective-Bounded Memory For Book-Based Role-Playing Agents（REVERIEMEM）— arXiv 2606.25632 <https://arxiv.org/abs/2606.25632>
90. MOOM: Maintenance, Organization and Optimization of Memory in Ultra-Long Role-Playing Dialogues — arXiv 2509.11860 <https://arxiv.org/abs/2509.11860>
91. MOOM 代码 <https://github.com/cows21/MOOM-Roleplay-Dialogue>
92. STALE: Can LLM Agents Know When Their Memories Are No Longer Valid? — arXiv 2605.06527 <https://arxiv.org/abs/2605.06527>
93. More Than a Role: Memory in LLM-based Role-Playing Agents（综述）<https://openreview.net/pdf?id=b0gO9JXUiP>
94. A Survey of LLM-based Role-Playing Agents（Static Persona / Dynamic Memory）<https://www.techrxiv.org/doi/pdf/10.36227/techrxiv.177160619.98027802>
95. From Persona to Personalization: A Survey on Role-Playing Language Agents — arXiv 2404.18231 <https://arxiv.org/html/2404.18231v2>
96. A Survey on the Evolution of LLM Agent Memory Mechanisms（ACL Findings 2026）<https://aclanthology.org/2026.findings-acl.2069.pdf>
97. Lost in Stories: Consistency Bugs in Long Story Generation by LLMs（ConStory-Bench）— ACL Findings 2026 <https://aclanthology.org/2026.findings-acl.410.pdf>
98. ConStory-Bench 站点 <https://picrew.github.io/constory-bench.github.io>
99. ConStory 论文解读 <https://mllog.dev/en/posts/constory-consistency-bugs-long-stories-llm>
100. Awesome-Story-Generation（叙事生成论文索引）<https://github.com/yingpengma/Awesome-Story-Generation>
101. Character-Grounded Multi-Agent Story Generation for Long-Form Narrative — arXiv 2607.00918 <https://arxiv.org/abs/2607.00918>

## 4.6 长上下文退化、检索范式、持久化模式

102. Lost in the Middle: How Language Models Use Long Contexts（相关） <https://arxiv.org/abs/2307.03172>
103. Chroma — Context Rot 研究（18 个前沿模型全部随长度退化）<https://www.trychroma.com/research/context-rot>
104. Context Rot 机制分析 <https://www.tmls.nyc/research/context-rot-mechanistic>
105. Context Rot 完整指南 <https://www.morphllm.com/context-rot>
106. Is grep all you need? Agentic search vs vector retrieval <https://latenteval.ai/research/is-grep-all-you-need>
107. Is Grep All You Need? How Agent Harnesses Reshape Agentic Search <https://tandemly.ai/research/grep-vs-vectors-agentic-search>
108. Why grep Is Beating Your Vector DB <https://tullie.ai/blog/grep-vs-vector-db-retrieval>
109. Grep Is All You Need — Is it time to pack Vector Search? <https://medium.com/mlworks/grep-is-all-you-need-is-it-time-to-pack-vector-search-586ee976ff08>
110. Agent Context Compaction for Long-Running Sessions: Techniques and Tradeoffs <https://zylos.ai/research/2026-04-21-agent-context-compaction-long-running-sessions>
111. Event Sourcing vs Queue Systems <https://intuitionlabs.ai/articles/event-sourcing-vs-queue-systems>
112. Temporal — 事件溯源式持久化与崩溃恢复 <https://temporal.io/blog/temporal-replaces-state-machines-for-distributed-applications>
113. AI Agent Tool State Persistence Strategies <https://fast.io/resources/ai-agent-tool-state-persistence>
114. The agent memory decision nobody talks about: what to forget <https://www.arunbaby.com/ai-agents/0098-agent-memory-what-to-forget>
115. memU: Agentic Memory Framework 深度研究 <https://zylos.ai/research/2026-01-09-memu-memory-framework>
116. 12 Prompt Caching and Prefix Stability（字节稳定前缀被什么破坏）<https://agent-book.zhengqxhs.com/chapters/12-prompt-caching-prefix-stability.html>

## 4.7 索引 / 综述型资源

117. The AI RPG Research Index（63 篇论文 + 11 个产业条目，逐条核对 arXiv）<https://arcanumrpgs.com/research>
118. AI RPG Research Index 的 JSON 数据 <https://arcanumrpgs.com/research.json>
119. ICLR 2026 Workshop on Memory for LLM-Based Agentic Systems <https://iclr.cc/virtual/2026/workshop/10000792>

---

## 附：调研覆盖度自述

- **完全未覆盖的方向**（受检索结果所限，未在本次调研中取得一手材料）：NVIDIA ACE、Convai、Inworld 等商用游戏 NPC 中间件的内部记忆设计（仅有产品定位描述，无机制细节）；Mantella（Skyrim mod）与 inZOI 等 shipped 产品的实际记忆实现；《Where Winds Meet》等国产 AI NPC 的实现细节。
- **有争议/需自行验证的点**：中文插件横评中的体验评分、token 消耗排序来自第三方编辑组的主观汇总（原文自述「打分基于截稿时各家公开文档和社区反馈」），非实测；「grep 优于向量」的研究结论在论文中以「inline 交付」与「file-based 交付」两种模式分别成立，**不能简单外推为「向量无用」**。
- **时效性提醒**：本报告引用的多篇论文/产品文档标注日期在 2026 年（含 2026-05 ~ 2026-09），本机当前时间为 2026-10-04，材料属于最新一档；但 AI 记忆方向迭代极快，建议在形成设计方案时对关键机制（尤其 NarraWorld、NstAgent、STALE）做一次一手复核。
