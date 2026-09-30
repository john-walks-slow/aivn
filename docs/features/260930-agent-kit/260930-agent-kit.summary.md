# 统一 Agent 基座 小结

日期：2026-09-30　分支：`feat/agent-kit`　计划：`260930-agent-kit.plan.md`　验证：`260930-agent-kit.validation.md`　检视：`260930-agent-kit.review.md`

## 起因

用户的原话：

> 「工坊 agent 和 playwriter 改用统一基座……可以共享一些工具（例如 playwriter 可以给临时角色生图，它和工坊 agent 应该用同一套东西）仅仅暴露内容不同。dsl 中的 beat 结束，出选项，和生图都改成工具（可考虑 schema 设计）而非 dsl。（有些可以和工坊共享）。整体往通用化方向改进。计划后属于 p0/p1 级功能，则可在工坊添加 agent 设置 tab」

问题在结构上：剧作家（`orchestrator`）和工坊（`workshopSession`）是两套从零搭的 agent，工具各写一份；
而剧本 DSL 里混着三类**控制信号**——`<stop>`（轮收束 + 停止点载荷）、`<option>`、`<preload_asset>`。
它们不是台词，是宿主该执行的动作，却用文本标签表达，于是要靠提示词约束「stop 之后别再说话」加解析器闸门双兜底。

## 做了什么

### 1. 一套基座，两个暴露面

`apps/server/src/agentkit/` 是唯一工具实现面（12 个文件）：

- `kit.ts` —— 按 `role: "playwriter" | "workshop"` 装配；`TOOL_ROLES` 是「谁有哪些工具」的唯一真相源，
  同时喂给服务端装配和设置页的开关列表。工具开关在装配最后一道过滤。
- `deps.ts` —— 判别联合收窄注入依赖。工坊与剧作家的差别被写进类型里，不是写进 if 里。
- `result.ts` / `role.ts` / `readiness.ts` —— 小工具与元信息。

18 个工具里重叠的是：**生图**（`generate_image`）、**读记忆卡**、**写记忆**、**列剧目文件 / 读写剧目文件**、
**素材检视**、**资源库检索**。只有一方要的：剧作家的 `beat_done`，工坊的就绪检查 / 改名 / 派生差分 /
`read_skill` 技能库读取。

`read_skill` 只归工坊是评审后改的：技能库是**跨剧目的通用做法速查**（去哪里找素材、授权能不能商用），
而这部剧的画风与创作口径是**剧目记忆**（`craft.md` 与设定卡），每轮本来就注入——
给剧作家挂一个只读通用资料的工具，再在它自己的提示词里挂一份画风记忆，是两处真相源。
连带把剧作家 system prompt 里的 `<available_skills>` 块删了：教它调一个装不进去的工具只会空转。

### 2. 生图：一个实现，两种等待

同一个 `generate_image`，参数 schema **逐字节相同**，description 与等待策略不同：

| | 工坊（sync） | 剧作家（queued） |
| --- | --- | --- |
| 语义 | 「出这张图，我要看」 | 「现在排上，三五句之后我引用它」 |
| 返回 | markdown 图片回执，点开即看大图 | 立刻返回 id + 是否跳过（已有 / 已在队列 / 剧目里已有） |
| 临时角色 | 必须是已登记成员，否则报错 | 给 `characterName` 就自动登记一个空设定角色（stub） |

底层落到同一层 `PlayAssets`（`workshopAssets.ts` 改名）：工坊侧还要撤销条与素材气泡，剧作家在拍内预发射
不产对话内容——按 `notify: "workshop" | "silent"` 分流，一张图在飞时两边共用同一个 inflight 去重。

### 3. DSL 瘦身：控制信号变工具

- `beat_done`（`options` 2~4 条 / `placeholder` / 都不给）取代 `<stop>` + `<option>`：
  单选项会被 schema 当场拒掉（错误回执喂回模型，它自己改），什么都不给 = 这一轮自然演完。
  工具返回 `terminate: true`，一轮到 `beat_done` 就收尾。
- `generate_image` 取代 `<preload_asset>`。
- **时间线还是 DSL，副作用改走工具**：两个工具产出的 `stop` / `preload_asset` 仍是从 `emitStageEvent`
  出来的事件（加 seq → 广播 → 落谱系），所以舞台、占位、谱系、纪元压缩全都照旧。`DSL_TAGS` 10 → 8。
- 旧标签按 `legacy_tag` 整条丢弃（不按字面输出——那会把标签念到舞台上）。

### 4. 逐剧目的 agent 设置（P0/P1 判级落地）

模型 = P0，思考档位 = P0，工具开关 = P1。三项都是**逐剧目**的：网关按量计费，工坊长对话跑便宜模型、
剧作家要文笔跑强模型是常态；某部剧不想让 agent 自己花钱生图，也只关这一部。

落点 `play.json` 的 `agents` 段（三个字段全可选，老档不受影响），UI 是工坊新增的第六个页签「Agent」，
两张卡各管一个 agent；模型清单来自新端点 `GET /api/agents/models`（透传网关 `/v1/models`，**读不到就报错、
不静默退化成默认**），工具目录来自 `GET /api/agents/tools`（与 `createAgentKit` 同一份数据）。
保存走既有 `PUT /api/plays/:id/play` → 轮边界重建 runtime，**不腰斩当前这一轮**。

## 顺带修掉的

- `pickCutIndex` 在 beat 尾巴都是 toolResult 的新结构下永远切不出压缩弧（向前找 `user` 一直越界），
  改成「向前找下一条 user，越界就回退到本拍的 user」。
- 纪元压缩渲染 `beat_done` 的参数（否则玩家选项会在压缩后从模型记忆里消失）。
- `PlayAssets` 提升到剧目级缓存，剧作家不再现场造实例。

## 已知问题（详见 review 第三节）

1. `gemini-3.5-flash-lite` 会把 `generate_image` 写成正文里的 `<call:default_api:generate_image …/>`，
   于是图不出现、界面也不提示；`beat_done` 正常，换 cpa `medium` 也正常。属模型侧差异。
2. 解析器 warning 至今没有消费者，上面那条会永远静默。
3. 工具目录是静态的：没配 exa 时开关仍显示可开，但这一轮并没有装上 `web_search`。

## 附带的文档改动

`README.md` 此前被一次提交（`8e2bed4`）从 513 行截成 7 行（`@@ -1,513 +1,7 @@`，只留下工坊页签表格），
`.env` 配置面、素材库、记忆结构、剧目目录等全部丢失。本次按现状把全文恢复，并补上：
工坊六页签（含新 Agent 页）、**「剧目级 Agent 设置」一节**（三个字段 + play.json 例子 + 两个端点）、
四个视图与设置分家、`<preload_asset>`/`generate_asset` 改成 `generate_image` 的表述。
