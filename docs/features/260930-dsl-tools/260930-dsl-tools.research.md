# DSL 标签与工具的边界：stop / preload_asset

> 调研日期 2026-09-30。分支 `feat/dsl-tools`（从 `feat/prompt-verb` 的 `de224b3` 开）。
> 只调研，不动代码。

## 起因

两个问题摆在一起问，因为它们其实是同一个问题：**剧本里的东西，什么时候该是标签、什么时候该是工具。**

1. `<stop>` 标签和 `beat_done` 工具是两套收束机制，合成一个工具（用户提议名 `beat_break` / `present_options`）是否更好。
2. `preload_asset` 拆成工具、而不是内置于 DSL，是否有收益。

---

## 一、现状核对

### `<stop>` 标签轨道（文本）

`packages/core/src/dsl/parser.ts`

| 位置 | 行为 |
| --- | --- |
| `:393` `emitStop()` | 解析到 `</stop>` 时置 `stopped = true` |
| `:397-398` `emit()` | `stopped` 为真时丢弃此后所有事件，warn `gated` |
| `:75` `private stopped` | 上面那个闸门的唯一状态 |
| 三态 `stopParse` | 处理 `<stop>` / `<stop type=choice>` 的选项收集 |

`apps/server/src/orchestrator.ts`

| 位置 | 行为 |
| --- | --- |
| `:1317-1330` | payload 存进 `pendingStop`，并 append lineage `stop` 节点 |
| `:1114` | 护栏：`choice` 无选项 → 降级 `free`（模型漏写选项时的兜底） |

即：`<stop>` 既是**载荷**（选项文案、自由输入的 placeholder），又是**内容闸门**（后面的字一律不算数）。两件事捆在一个标签上。

### `beat_done` 工具轨道

`apps/server/src/orchestrator.ts:41-57`：`execute` 返回 `terminate: true`，参数是空对象（`additionalProperties: false`）。

`orchestrator.ts:418-425` 挂了 `agent.finishTurn` 兜底：pi 只在「批内全部工具结果都 terminate」时才收束 turn，模型把 `beat_done` 和记忆工具同批调用会让 terminate 被吞掉、这一轮继续空转。兜底按 `beat_done` 出现这件事显式收束。

**所以「工具调用本身就是一 turn 的自然结尾」在本仓库不成立。** 工具结果要回给模型继续生成，只有 `terminate` 才收束。

### `preload_asset` 轨道

`packages/core/src/dsl/spec.ts:23,31`：在白名单里，属 `VOID_TAGS`（自闭合、无正文）。

`apps/server/src/orchestrator.ts:1293-1310`：解析到即 append lineage `preload` 节点，然后

- `type="sprite"` → **只记谱系，不发起**（立绘差分一致性不足，D6）
- `type="bg"` / `type="cg"` → 若剧目里已有同名导入素材就跳过，否则调 `onPreloadAsset` **后台发起**

发起时机就是**解析流式扫到的那一刻**——这是生图铁律①「预发射绝不能卡住播放」的全部依赖。

---

## 二、Q1：stop / beat_done 合成一个工具

### 收益

1. **载荷结构化。** 选项从 DSL 属性变成工具参数，类型由 schema 兜住。`orchestrator.ts:1114` 那条「choice 没选项就降级 free」的护栏可以删掉——让模型重试比替它猜好。
2. **删掉一整块解析器状态机。** `stopParse` 三态 + `stopped` 闸门 + `gated` warn + `emitStop` + `closeOption`，连带 golden 用例。DSL 标签 10 → 9。
3. **「stop 之后别说话」从提示词约束升级为协议约束。** 今天这条写在提示词里（"stop 标签之后不要再输出任何内容"），靠模型自觉 + 解析器闸门双重兜底。改成工具后，terminate 之后根本没有文本位置可写——这条约束消失而不是被更好地遵守。
4. **命名更准。** `beat_done` 只说了「结束」，没说「结束在哪儿」；参数一加就自明了。

### 代价与坑

1. **工具必须自带 `terminate: true`，且要先验一件事：pi 在 terminate 之后是否真的不再让模型输出。** 这是实现第一步要跑的实验，不是可以想当然的前提。
2. **两个终止工具会多两种错法**（传空数组、两个都调）。建议**合成一个**：`beat_done(options?: string[], mode?: "choice" | "free", placeholder?: string)`。不传 `options` 就等价于今天的 `no_stop`，名字也不用改——模型今天已经会「不传」这个形态（4/44 的真实 no_stop 就是这么来的），迁移不需要额外教。
3. **隐藏成本：纪元压缩会丢选项。** `apps/server/src/compaction.ts:170` 渲染 toolCall 时只写 `[调用 beat_done]`，不渲染 args。今天选项在 assistant 文本里，压缩后重建的 Agent 还能从历史里看到玩家当时面对的选项；搬进工具参数后就只剩一个函数名。**必须单独给这个工具渲染 args**，否则压缩一次，玩家历史选项就从剧作家的记忆里蒸发了。

### 不受影响的

- lineage 里既有的 `stop` 节点是**数据**不是 DSL，`materialize` 照旧重放。
- `renderTranscript` 渲染的是 agent 消息（user/assistant/toolResult），**不碰 lineage**——原本怀疑迁移会很痛，查过不是。
- WS 协议的 `StopPayload` 形状不变，只是 `stop` 从 DSL 属性变成工具参数的投影。

---

## 三、Q2：preload_asset 拆成工具

### 先看一个数

三个真实存档（`plays/demo/saves/`，worktree 运行时数据）里的 lineage 节点统计：

| 存档 | preload 节点 | 引用到的资产 |
| --- | --- | --- |
| `smun2wist`（31 轮） | **0** | `bg_classroom_sunset` |
| `smun6y7j2`（9 轮） | **0** | `bg_classroom_sunset` |
| `smungywsu`（5 轮） | **0** | `bg_classroom_sunset` |

**45 轮戏，零次预发射。** 引用的背景全是用户导入的静态素材，生图那条路根本没被走到。

原因在 `apps/server/src/prompt.ts:92-93`：只有当剧目**一张背景都没有**时，才会插一段「每写到一个新场景，先用 preload_asset 预发射」。demo 有背景，这段永不出现；`:143-144` 只在格式说明里被动提了一句。模型看不到任何压力去用它。

### 再看一个数：45 秒

`apps/web/src/stage/director.ts:22` `PENDING_TTL_MS = 45_000`：骨架占位 45 秒后被摘掉，落到氛围底色。

而工坊铁律⑦记的生图耗时是 **100s+**。也就是说：**即便模型真的预发射了，快的那一半能赶上，慢的那一半图到货时骨架早没了——这一轮演的是氛围底色，图白烧。**

这大概就是它零使用的真正原因：不是模型懒，是这条路的成功率本来就低。

### 收益评估

如果拆成工具：

| 收益 | 评价 |
| --- | --- |
| 宿主能回执（「该 id 已有静态素材，跳过」「队列已满，30 分钟后再试」） | **真收益**。今天模型预发射一个清单里没有的 id，谱系照记、配额照烧，它自己永远不知道 |
| 不用占 DSL 标签位 | 收益很小，标签位不值钱 |
| 工具比标签显著得多，模型会更愿意用 | **这不是收益，是风险**（见下） |

代价：

| 代价 | 评价 |
| --- | --- |
| 失去「解析到即发起」的精确时机 | 工具调用要等 turn 收束才执行，等于预发射挪到这一轮文本写完之后——**图更没希望赶上**。除非改规则让模型在写正文**之前**先批量调一次，那多一轮 RTT，且模型还没写戏就要先决定画面需求 |
| 多一个工具要和 `beat_done` 抢「独占批次」这条铁律 | 真风险。模型同批调 `preload_asset` + `beat_done`，terminate 被吞，就是当初 `beat_done` 踩过的那个坑 |
| 45s TTL 没修的话，工具化只会让预发射用得更多、也浪费得更多 | 见上 |

### 结论

**收益不成立，但原因不是「它是 DSL」，是「它现在根本没人用」。**

工具化解决的是「模型不知道预发射失败」这个反馈问题，可这个问题要等模型开始用预发射才存在。在零使用的前提下拆工具，等于给一条没人走的路换一套更好走的地形。

真要处理 `preload_asset`，优先级应该反过来：

1. 先修 45s TTL 与生图耗时的矛盾（骨架要么等图、要么 TTL 拉长到生图上界）；
2. 再决定要不要在提示词里给预发射一点真实压力（比如「这个场景需要一张清单里没有的背景」时才提）；
3. 至于它是标签还是工具——等它真被用起来再看。若那时确实需要回执，工具化也顺手。

---

## 四、统合：DSL 是时间线，工具是副作用

两问的答案落在同一条原则上。

| | DSL 标签 | 工具 |
| --- | --- | --- |
| 是什么 | **会出现在时间线上的东西** | **只对宿主说的话** |
| 为什么 | 要 seq 排序、要流式解析、要在停止点处被截断 | 宿主要回执、参数要校验、不能被模型「再写点别的」绕过 |
| 现状归属 | `scene` `actor` `cg` `sfx` `say` `narrate` `thought` `comment` | `beat_done` + 四个记忆工具 |
| 待议 | `stop`（控制信号 + 载荷） | `preload_asset`（声明式副作用） |

按这条线：

- **`stop` 该是工具**。它不对应舞台上的任何东西，它是一条「交给玩家」的控制指令加上它的载荷。而且它现在承担的内容闸门职责，正是因为它是文本才不得不承担的——工具 terminate 之后没有文本位置可写，闸门自然消失。**Q1 的答案：是。**
- **`preload_asset` 该是工具**。它是纯宿主副作用，舞台上看不见。但它同时是**唯一一个需要在流式输出中途精确生效的宿主副作用**——这个例外在今天不值钱（零使用），因为它想解决的问题（图赶不上）本来就没解决。**Q2 的答案：先别动。**

---

## 五、要定的三件事

1. **stop → 工具，做不做？** 收益明确（删状态机 + 删提示词约束 + 删兜底护栏），代价是三件：先验 pi 的 terminate 行为、给压缩补 args 渲染、合成单个工具而不是两个。倾向做。
2. **`no_stop` 率会怎么变？** 不传 `options` 就是今天的 `no_stop`，真实数据 4/44。模型调一个工具比「记得写对一个标签」更容易，no_stop 率大概率上升。上升是好事（更自然的演出节奏）还是坏事（玩家失去介入点），是产品取向，不是技术问题。
3. **`preload_asset` 45s TTL 那个矛盾修不修？** 修它属于生图铁律的地盘（`PENDING_TTL_MS` 写在 `apps/web/src/stage/director.ts`，铁律⑤），和这两问是独立的一件事。可以在这轮顺手，也可以单开。

## 六、范围（若决定做 Q1）

计划文档 `docs/features/260928-stage-ai-mvp/260928-stage-ai-mvp.plan.md` §6 先行 → `packages/core/src/dsl/{spec,parser}.ts` + golden（标签 10 → 9）→ `apps/server/src/orchestrator.ts`（工具定义、护栏删除、lineage 投影）→ `apps/server/src/compaction.ts`（args 渲染）→ `apps/server/src/prompt.ts`（`## 停止点` 段改写成工具说明）→ README / AGENTS.md。

预估：core 与 server 的 parser / orchestrator / prompt 三个测试文件 + 新增「压缩后选项仍在」的回归用例。改 core 后须 `pnpm --filter @stage-ai/core build`。
