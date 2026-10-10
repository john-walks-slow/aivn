# 工坊配置整理：删出图审批、补剧作家补充要求

## 起意

工坊「Agent」页原本有两处东西容易让人发懵：

- 搭台助手卡上有「出图审批」(`ask` / `auto`)，但它**只是提示词约束**——`agents.workshop.imageApproval` 只在 `workshop.ts` 的三处被读进 system prompt，工具层没有任何检查。开了 `ask` 之后搭台助手被那句「用户没点头之前一张都不要 generate_image」拖慢，动作变得畏手畏脚。
- 剧目页有「写作参数」，与 Agent 页的「补充要求」是两个不同性质的配置面，看不出各自的归属与边界。

产品裁决（2026-10-10）：

1. 删掉「出图审批」。模型自己能拿捏尺度，宁可少也不要多——**别把 Agent 当傻子**。
2. 受它控制的那段提示词精简：只讲**情况**（出图花钱、立绘一张 100 秒起、用户看不到中间过程）与**惯例**（先列一张图单跟用户对一下），不写门禁式硬命令。
3. 反过来补一处缺口：**剧作家也要有逐剧目的补充要求**（原来只有搭台助手有）。

## 配置边界（定下来的四条）

| 层 | 真相源 | 内容 |
| --- | --- | --- |
| 部署运行配置 | `<数据目录>/settings.json` | 网关、密钥、默认模型、上下文/压缩、出图/语音/检索后端等整机设置 |
| 剧目 Agent 配置 | `play.json` 的 `agents` | 每个角色的模型、思考档位、能力开关、补充要求 |
| 剧目创作配置 | `play.json` 的 `craft` / 语言 / 封面 + `characters/` + `memory/` | 写作参数（枚举、可校验）、角色卡、创作口径 `craft.md` |
| 素材与呈现数据 | `assets/` | 素材描述与呈现声明、生成台账 |

补充要求是**自然语言的额外要求**，不是创作口径的替代：长期写作口径仍走 `memory/always/craft.md`，能取确定值的三件事（篇幅、停止点条数、素材来源）仍走 `craft`。

## 改动

### 1. 删除出图审批

- `packages/core`：删 `AgentSettings.imageApproval`、`IMAGE_APPROVALS`、`ImageApproval` 与归一化分支。
- `apps/server`：`WorkshopPromptContext` 删 `imageApproval`；`workshopSession` 不再传；`workshop.ts` 的 `setupFlow` / `imageGuide` 去掉审批分叉。
- `apps/web`：`AgentPane` 删审批下拉与 `setOrClear` 的类型成员。
- 旧 `play.json` 里残留的 `imageApproval` 会被归一化静默丢弃（`parseAgentConfig` 不再认它），不需要迁移。

### 2. 提示词改成讲情况与惯例

`setupFlow` 的第三步与 `imageGuide` 的首条改成陈述句：

> 出图这一步的实际情况：**花钱，立绘一张要等 100 秒起**，用户在图上桌之前看不到任何中间结果。所以惯例是**先列一张图单**——要出几张、分别是什么——跟他对一下再开跑。

保留原来的能力位分叉（`can.files` 的清单兜底、`can.skill` 的技能指针、`can.library` 的先查库）与草稿→采用的流程说明。`SKILL.md` 里同一句话（四步走的第 3 步）一并改掉，避免提示词与技能各说一套。

### 3. 剧作家补充要求

- `AgentSettings.prompt` 改成两个角色都保留（原来只留 `workshop`）。
- `apps/server/src/prompt.ts`：`PromptContext` 加 `customPrompt`，新增 `customSection()` 拼在 A 区、**紧挨 `# 演出契约（引擎规则，不可改）` 之前**——契约是最后说的定论，用户这段讲的是这个剧目额外怎么做事。
- `orchestrator.buildAgent` 传 `play.agents?.playwriter?.prompt`。
- `AgentPane` 的补充要求改成两张卡都渲染，各自一句 placeholder 说明它能写什么。

## 生效链路

- 搭台助手：`workshopSession.systemPrompt()` 每轮现读 `play.json`，下一轮对话生效。
- 剧作家：A 区在纪元内冻结，保存后走 `savePlay` → `playhouse.reload` → **轮边界**重建 runtime，下一轮起生效，不腰斩正在演出的那一轮。

## 不做

- 不做服务端硬审批 gate（不引入批准凭证、审批条、状态机）。
- 不把 Agent 运行配置（模型/思考/能力）搬去剧目页，也不把写作参数复制进 Agent 页。
- 不做跨剧目的 Agent 模板或 Prompt Stack 编辑器。
- 不改 `craft.md` 与 `craft` 段的分工。

## 验收

- Agent 页只有 6 个下拉（剧作家 4 + 搭台 2），两张卡各有「补充要求」，界面上不再出现「出图审批」。
- 工坊提示词里搜不到「点头」「审批」这类门禁措辞，但出图的花费/耗时事实与列图单的惯例仍在。
- `agents.playwriter.prompt` 能落到 A 区且排在演出契约之前；空值不留痕。
- `pnpm typecheck` 与受影响的用例（core config、server prompt/workshop、web agentModelOptions）全绿。

## 追加：出图并发提示（2026-10-10）

工坊原本完全不知道出图是并发的，提示词里那句「一次只出真正需要的那几张」还是收敛语气；而 pi 默认并行执行同一条消息里的多个 tool call，模型只要肯一次发一批就是真并发。改动：

- **`generate_image` 的描述**（`imageTool.ts` 的 `hostNote()`）加一条：一批一起发就并发跑；报出这个部署的并发上限（`image.concurrency`，缺省 `DEFAULT_IMAGE_CONCURRENCY = 6`）与排队区容量（`DEFAULT_MAX_QUEUE`）；一批里超出排队区的那部分直接报「生图队列已满」，张数多就分批发。
- **排队区 12 → 30**：原来 12 只有两批，工坊一次把图整批发出来很容易撞上；30 = 并发 6 的五批。
- **工坊出图章节**改成「这一批要出的图在一条消息里一次全发出去，引擎会并发跑」；定妆照那条改成「同一批发 3 条」。**提示词里不报数字**——同一规则写两处必然漂，数字只住在工具描述里。
- 并发值经 `playhouse → orchestrator/workshopSession → createAgentKit → imageTool` 现读注入，设置页调了并发，模型下一次看到的数字就跟着变。

连带：`imagePendingTtlMs`（骨架占位的兜底上界，随 hello 下发的 `assetsTtlMs`）按排队上限折算，队列变 30 后默认从 540s 变 1080s——排队区变大，最坏等待自然变长。
