# 统一 Agent 基座 检视记录

日期：2026-09-30　分支：`feat/agent-kit`　相关文件：`apps/server/src/agentkit/**`、`playhouse.ts`、`playAssets.ts`、`apps/web/src/workshop/AgentPane.tsx`

## 一、设计上过关的地方

1. **一份 schema、两种暴露**：`kit.ts` 是唯一装配面，`TOOL_ROLES` 同时喂「装哪些工具」和「设置页列哪些开关」，
   两处不会漂。`deps.ts` 用判别联合（`mode: "sync" | "queued"`）在**类型层**堵死「工坊注入 kick 却按同步等图」
   这类错配——这是这套代码能同时服务两个角色而没长出两套实现的关键。
2. **工具产出的事件与解析器产出的事件同路**：`beat_done` / `generate_image` 都走 `emitStageEvent`
   （加 seq → 广播 → 落谱系），`stop` / `preload_asset` 仍留在 `StageEvent` 里。所以 client 侧一行没改，
   骨架占位、停止点重放、谱系分岔全部照旧。
3. **失败可见**：生图失败沿用既有 `asset_failed`（舞台顶部提示），模型清单读不到就报错并给重试按钮，
   网关别名不在内置目录就 warn。**没有一处「静默退化成看起来能用的默认」。**
4. **契约可选**：`PlayConfig.agents` 三个字段全可选，老剧目读出来不变，缺省即旧行为。

## 二、明确的取舍（不是 bug，但用户应该知道）

| 取舍 | 现状 | 判断 |
| --- | --- | --- |
| `resolveCpaModel` 对网关独占别名（cpa 的 `low`/`medium`/`gemini-3.5-flash-lite`）不在 pi-ai 内置目录 | 沿用默认模型元数据 + 一条 warn | 网关负责路由，元数据只影响思考预算与输出上限；真出问题会让用户改 `.env` 的 `STAGE_MODEL_BASE`。warn 已经在启动日志里 |
| 剧作家给临时角色生立绘会改 `play.json` | 排到轮边界重建 runtime，不腰斩当前演出 | 演出中改角色表等于腰斩那一轮；排到边界是唯一不失真的做法 |
| 工具开关关掉后，提示词里对应章节也收掉 | `can` 位反向控制章节注入 | 留着章节等于教模型调一个不存在的工具，模型会反复空转烧 token |
| 旧标签 `<stop>` / `<option>` / `<preload_asset>` | 整条丢弃 + `legacy_tag` warning（不输出到舞台） | 未知标签的默认处理是「按字面输出」，那会把 `<stop type="choice">` 念给玩家听。**不自动兼容执行**是有意的：用户明确要求迁成工具 |
| `pickCutIndex` 改为「先向后找下一条 user，越界再回退到本拍 user」 | 恢复纪元压缩的切点语义 | `beat_done` 之后每条 beat 尾巴都是 toolResult，只向后走的版本永远切不出弧 |

## 三、遗留风险

1. **模型会把工具调用写进正文**（本次真机发现，详见 validation 第三节）。
   `gemini-3.5-flash-lite` 会把 `generate_image` 写成 `<call:default_api:generate_image …/>`，
   图不会出现、界面也不提示。换 `medium` 无此问题。**对固定用 flash-lite 的剧目，这是个静默的体验回退。**
2. **解析器的 warning 没有任何消费者**：`legacy_tag` / `orphan_text` 收集了但没人读（日志也不打）。
   这意味着上面第 1 条会永远静默。补一条「把 parser warning 打到服务端日志」是低成本的下一步，
   但那属于另一个改动面（要给 warning 找到合适的出口），这次没顺手做。
3. **工具目录是静态的**：`GET /api/agents/tools` 返回的是代码里的目录，不反映某个剧目实际能不能用
   （比如没配 exa 时 `web_search` 不会真装上，只是目录里还列着）。设置页因此可能出现「开了但这一轮没装上」的错觉，
   提示词里不会有联网章节。改动很小（下拉/开关按 `can` 位置灰），但要服务端多返回一个可用位。
4. **`agentFailed` 类的失败没有汇聚点**：模型这一轮的工具批里如果有工具返回 error，模型能自己看到回执并重试，
   引擎不额外拦。这一层是 agent-loop 的既有行为，本需求没动。

## 四、独立检视（reviewer 子代理，聚焦 deps/imageTool/beatTool 三个文件）

子代理给了「需先改」，三条都成立，已在本次改掉：

| 检视发现 | 处置 |
| --- | --- |
| `imageTool.ts` 先 `emitPreload` 再判「静态素材已有 / 已生成过」——占位等不到 `asset_ready`，白闪到超时 | 占位挪到判定之后：静态素材与 `ready` 不占位，`queued`（在飞）与新发起才占。`image.test.ts` 的断言同步改成只期望会来的三张 |
| `beatTool.ts` 的 `options: ["  ", "道歉"]` 能过 schema（逐元素 minLength=1），trim 后不足两条却静默降级成「自然演完」——模型的一次笔误变成一轮没有停止点 | 显式抛错（pi 转成 error 回执喂回模型，可重写），配单测 |
| `PlaywriterKitDeps.images` 装配了但没人消费 | 删字段与 orchestrator 里的传参 |
| `options` 与 `placeholder` 同时给时 placeholder 被静默忽略 | 按 options 走，回执里明说「placeholder 这轮不生效」 |

判别联合本身没漏口：`role` 与 `mode` 的分支互斥，不存在注入错配的路径。

用户复评后又改了一条：`read_skill` 原先两个角色都装、工具文案还写着「读出图技能」，
而仓库里唯一的技能是 `galgame-audio`（免费 BGM/SFX 素材源）——名与实本来就对不上。
现在技能库只归工坊，文案改成通用做法速查；剧作家的画风与口径走 memory，
它的 prompt 里也不再有 `<available_skills>` 块（prompt.test.ts 锁住这条）。

## 五、准入结论

**准入**（独立检视的 4 条已改，改完复跑受影响模块全绿）。 计划里的 6 项验收全部通过（validation 第一、六节），真机跑通了「beat_done 出选项卡」与
「generate_image 落 preload 节点」两条主链。第三节第 1 条是模型侧行为，已如实记录并给出建议动作
（给这类剧目换一个走函数通道的模型），不需要在本需求内改代码。
