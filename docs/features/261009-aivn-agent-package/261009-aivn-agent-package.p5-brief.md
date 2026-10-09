# P5 任务书：把两个宿主的工具面收成同一个形态

> 这份是**交给 expert 的输入**（不是计划本身）。计划请另写到
> `docs/features/261009-aivn-agent-package/261009-aivn-agent-package.p5.plan.md`。
> 本文件由主会话整理，事实基础是 P0~P4 落地后的**当前代码**（不是那份 P4 前的读数）。

## 0. 一句话目标

P0~P4 已经把「能力」（参数真相源 + 描述正文 + 请求归一化）抽进 `packages/agent`。
**P5 要收的是 face 层**：同一份能力，两个宿主今天各自露不同的参数、不同的返回时机、不同的复合动词。
用户的要求是——**两边形态越相似、复用越多、越干净越好，走 canonical**；做法不是把差异抄来抄去，
而是把「不够通用」的实践通用化，往「通用 Agent + 原子化工具」收，少留特殊规则。

用户对两份实现的判断（重要，决定了收敛方向）：

- **DSH 插件那一版更接近理想形态**：工具少（9 个）、原子（`generate_image` / `cut` / `import_asset` 三件套）、
  门控靠配置禁用集而不是角色分叉。
- **独立服务端那一版有很多值得重构的地方**：24 个工具、两个角色的工具分叉、
  复合动词（`generate_image` 一个 schema 两种生命周期、`generate_asset` 式的一键宏）、
  以及把「素材编目」塞进「生成」工具里的 10 参 `generate_bgm`。

## 1. 已定的决策（不要再讨论）

1. **`generate_asset`（插件侧）= 保留为显式宏**：它继续存在、继续一键（生成 + 立绘抠底 + 登记），
   但必须是**显式的**——描述里说清它就是「`generate_image` + `import_asset` 的后两步」这个宏，
   不藏策略、不与原子三件套产生两套语义。（插件今天已经这么自我描述，见下 §3。）
2. **P4 里「有意不收敛」的 face 分叉，现在要重新审**：用户认为那些分叉里藏着大量可重构项。
   P4 已落地的代码不要推倒重来，但 P5 可以提出**替代方案 + 迁移步骤**。
3. **外号/改名**：服务端 `import_asset` → `library_import` 已在 P4 落地；插件那份保留原名（那是另一个领域动作）。

## 2. 当前事实（实读，可直接引用；要复核请自己再读一遍代码）

### 2.1 能力层（已共享，`packages/agent/src/capabilities/`）

只有 5 条能力，`CAPABILITIES` 表是单一真相源（`capabilities/index.ts`）：

| 能力 id | 实现文件 | 参数面（共享的那部分） |
| --- | --- | --- |
| `web.search` | `web/search.ts` | `query` / `numResults` |
| `voice.list` | `voice/list.ts` | `query` / `language` / `gender` / `tags` / `page` |
| `music.generate` | `music/generate.ts` | `name` / `prompt` / `title` / `description` / `tags` / `mood` / `scene` / `loop` / `volume` / `overwrite` / `model` |
| `image.generate` | `image/generate.ts` | `kind` / `name` / `spriteId` / `variant` / `references` / `referenceCharacters` / `framing` / `stature` / `title` / `keyColor` / `style` / `prompt` |
| `image.cutout` | `media/cutout.ts` | `source` / `output` / `tolerance` / `keySmooth` / `edgeBand` / `spill` / `solidResidual`（五个旋钮的真相源是 `cutoutTuningFields`，另有 `CUTOUT_TUNING_GUIDE` 正文） |

IR/编译器：`schema/ir.ts` 的 `FieldMap` / `pick` / `tighten` / `InferArgs` / `assertCommonSubset`。
**宿主的收紧只能写在 face 上**（`tighten`），共享字段只能用两个宿主都表达得出的子集（`assertCommonSubset` 盯着）。

### 2.2 服务端（`apps/server/src/agentkit/`）

- **24 个工具**，`TOOL_CATALOG`（`kit.ts:275` 起）带 `roles: ["playwriter"] | ["workshop"] | 两者`；
  能力目录 15 行（`kit.ts:94` 起）；`BASE_TOOLS = ["read"]`。
- 工具的 face = `tighten(pick(<capability>Fields, [...]), {pi 专有约束})`，例：
  `imageTool.ts:36`（12 格，含 `referenceCharacters` 兼容别名）、`musicTool.ts:20`（10 格）、
  `voiceTool.ts:21`、`searchTool.ts:16`、`recutTool.ts:27`（从 `cutoutTuningFields` 里 pick 五个旋钮）。
- 生命周期：`generate_image` **一个 schema 两种语义**——工坊 `await` 出草稿（`draftId`，再由
  `commit_asset` 入库）；剧作家发起即返回、后台排产 + 到货广播直落 `assets/`。
- `contract.ts` 的 `CAPABILITY_MATRIX` + `apps/server/scripts/check-agent-contract.mjs`（**9 项**守卫，
  其中第 9 项双向核对矩阵 ↔ 包内能力表）。

### 2.3 插件（`/root/projects/dsh-aivn-shared/`）

- **9 个工具**，单一真相源 `src/tool-catalog.ts`：`validate_play` / `set_stage_style` /
  `generate_image` / `cut` / `import_asset` / `generate_asset` / `generate_bgm` / `list_voices` / `web_search`。
  两个预设默认装同一套，差异只走配置禁用集。
- face = `toDsh(pick(<capability>Fields, [...]))`（宿主 schema 是 JSON-Schema 子集，
  收紧全走描述，`src/tools/schema.ts` 头注解释了两边面不同的原因）。
- **同步等待**：`generate_asset` 等 70–140s、`generate_bgm` 等 ~84s。
  `src/tools/generate-bgm.ts` 头注给的理由是「插件没有『回合之外』的注入通道」——
  **这条理由今天不成立**：插件自己就在用 `agent.inject`（开局指令，`src/stage/stage-tap.ts:212`）
  与 `agent.followup`（导演消息、结局收束，`src/stage/director.ts:87`、`src/routes.ts:272`）。
- 插件**没有** `view_image`（看图），服务端**没有** `cut`（任意图抠底）——
  这两件事的实现都已经在包里（`media/web-image.ts`、`media/cutout.ts`），补齐主要是接线。

## 3. 五处「差别最大」+ 四条原子化提案（主会话的分析，**允许 expert 推翻、补全、重排**）

### 五处差别

1. **工具数量与角色分叉**：服务端 24 个 + 两角色；插件 9 个 + 配置禁用集。
   服务端把**宿主流程**编进了工具集（`beat_done` 停止点、`commit_asset` 采用、`library_import` 引用即导入）。
2. **生命周期：等 vs 不等**（见 §2.3）。工具调用语义与耗时绑死，是最大的不通用点。
3. **元数据混进生成工具**：服务端 `generate_bgm` 10 参（多出 `title/description/tags/mood/scene/loop/volume/overwrite`），
   插件 4 参（多出 `model`），且插件那边「元数据还没接线口」（等于缺功能）。
4. **寻址方式**：服务端按**已入库对象**寻址（`spriteId` / `draftId` / `entryId` / `saveId`，引擎持有留底原片）；
   插件按**文件路径**寻址（`cut(source, output)`，靠模型记住留底路径）。
5. **配置工具形状相反**：服务端 `set_craft` 是嵌套对象 + 三态（省略 / null / 值）；
   插件 `set_stage_style` 是 **17 个平铺参数**（每个 `oneOf[string, null]`，白名单在 `src/style/style-tokens.ts`）。

### 四条提案

1. **拆开「生成」与「落成素材」**：`produce`（产出候选 → 返回句柄）/ `register`（源 + `AssetTarget` → 落成素材）/
   `cutout`（就地重抠，已经是原子的）。插件的 `import_asset` 其实已经是 `register` 的形状，
   只差「source 可以是上一个候选」；服务端的 draft/commit 是 produce/register 的另一种编排。
   `generate_asset` 按 §1 的决策保留为显式宏。
2. **去重/覆盖策略变成显式参数**：统一 `onConflict: skip | overwrite | variant` 之类，别让「同名跳过」
   藏在宏里、而 `overwrite` 又出现在另一个工具上。
3. **元数据从生成工具里拆出去**：`generate_music(name, prompt, model?)` 是原子动作；
   `title/description/tags/mood/scene/loop/volume` 是素材条目属性，可考虑 `annotate_asset(target, {...})`。
   （素材表已是包内共享概念，见插件 `src/media/catalog.ts`。）
4. **寻址统一到 `AssetTarget`**（包内已有该类型）：对已入库对象的操作一律用 target，文件路径只出现在「源」的位置。
   插件的 `cut(source, output)` 可升格成服务端那种「不需要模型知道任何路径」的重抠——这是安全边界，不只是审美。

配置工具倾向统一成**一个「补丁对象」**（键值都是字符串/null），白名单与取值规则是**数据**，不是 schema 里 17 条 `oneOf`。

## 4. 明确**不要**统一的地方（宿主机制逼出来的，硬统一会更糟）

- **文件读写**（`read`/`write`/`edit`/`bash`）：DSH workspace 权限模型 vs 服务端 `PlayEnv` 白名单 +
  角色/能力三档写面（`characters` / `memory` / `files`）。
- **技能库**：DSH `available_skills` + realm 隔离（`isolate: {skills: true}`）vs 服务端 `read_skill` + 只读目录。
- **故事树 / 周目**：服务端 `list_saves` / `read_lineage`；DSH 那边是会话历史与 fork。
- **服务端的 `beat_done` / `update_state` / `enter_nsfw`**：依赖它的编排器与谱系回滚，插件形态里没有对应物。
- 已知产品流程差异（插件为「模型自己写文件」兜错）：`validate_play` 是服务端 `get_readiness` 的超集
  （多 craft 取值 / 台账悬空对账 / 角色卡张数）。

**但**：上面每一条都要 expert 自己复核一遍——哪些真是宿主机制、哪些只是历史惯性，写清楚判定依据。

## 5. 约束（硬）

- 设计规约 R1~R8 见 `261009-aivn-agent-package.plan.md` 的「设计规约」一节与「实施」里各阶段的收紧条目；
  P1~P4 落地过程还改过几处（编译器住宿主、包不读 env、共享字段只用共同子集、一个 fetch 抽象）。
  **先读那份 plan 的「实施进度」表与各阶段小节，再动手写计划。**
- 判据：**不新增红**。验证命令见 plan 的「验证矩阵」一节（包单测 / 服务端 `typecheck` + 受影响子集 + 契约守卫 /
  插件 `typecheck` + `build.mjs --check` + `e2e:media`；live e2e 见 plan 里的 provider patch 配方）。
- 环境：两个 worktree `/root/projects/stage-ai-shared`、`/root/projects/dsh-aivn-shared`（分支 `feat/shared-aivn-core`）；
  主检出 `/root/projects/stage-ai`、`/root/projects/dsh-aivn` **勿动**。
  插件 `node_modules/@aivn/*` 是手动软链，**别在 worktree 跑 `npm install`**；`lib/` 是受跟踪产物。
  本机内存紧张：e2e 只跑与改动相关的判据（`E2E_PHASES` / `E2E_ONLY`）。
- 参考读数：`261009-tool-surface-map.md` 的并集判定表（**注意它的 HEAD 是 P4 前的 `c8595bb9` / `e832b35`**，
  §4.1 的矩阵已被 P4 修正，引用时说明这一点）；`261009-inventory-server.md` / `261009-inventory-plugin.md` /
  `261009-prompt-compare.md` / `261009-aivn-agent-package.research.md`。

## 6. 交付物（只出计划，**不改任何代码**）

写到 `docs/features/261009-aivn-agent-package/261009-aivn-agent-package.p5.plan.md`，至少包含：

1. **形态目标**：收敛后两边的工具面长什么样（名字、参数、返回时机），以及「服务端改什么 / 插件改什么」。
2. **阶段划分**（建议 P5-a…P5-x，按「收益 / 风险」排），每阶段：改动文件清单、为什么这么切、
   对既有能力与提示词的影响面。
3. **验证判据**：每阶段跑什么、期望数字（当前基线：包 22 文件/168 条；服务端受影响子集 131 条；
   契约守卫 9 项；插件 `build.mjs --check` 一致；`e2e:media` 53/53；live e2e `injection` 20/20、
   `stagehand` 22/22、`handmade-play` 4/4）。
4. **风险与反悔点**：哪些步骤可能推翻既有决策（例如异步化会改回合语义、提示词与 e2e 锚点），
   以及「做到哪一步就该停下来找用户确认」。
5. **对不该统一清单的复核结论**（每条：宿主机制 / 历史惯性，证据）。

回复请只给：计划文件的路径 + 5~10 行的要点摘要（不要复述全文）。
