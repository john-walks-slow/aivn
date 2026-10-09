# 抽 AIVN Agent 共用包（`@aivn/agent`）—— 计划

日期：2026-10-09（v3，按「架构最干净、不怕重写」重写）· 前置：`261009-aivn-agent-package.research.md`
（含 §5 核查更正）、`261009-inventory-{plugin,server}.md`、`261009-prompt-compare.md`、
`261009-tool-surface-map.md`（工具面并集表）、`261009-server-red-diagnosis.md`

## 目标架构（一句话）

**能力（capability）共享，工具面（face）宿主自持并由同一份参数声明编译出来。**

一份能力 = 一个领域动作的完整定义（参数规格 + 文档 + 副作用 + 实现）。
一个 face = 「工具 id + 哪个能力的哪些字段 + 角色/能力位 + 宿主策略（同步/排产、草稿/直落）」。
face 是**声明**，不是第二份实现，也不是第二份文案。

```
@aivn/core        领域模型（DSL/IR/剧目配置/素材表/角色卡/取景体量/生命周期/分句）——零依赖，不动
@aivn/stage       舞台渲染与播放——不动
@aivn/agent       新增：能力 + use case + 提示词/技能正文 + 中立 schema IR + 依赖面
apps/server       宿主：face 声明 + schema 编译 + 会话/权限/队列/注入/传输 + 宿主专有工具
dsh-aivn          宿主：同上（DSH 版）
```

包内：

```
packages/agent/src/
  capabilities/<domain>/<action>.ts   能力：id / doc / fields(参数真相源) / sideEffects / run(args, deps)
  schema/ir.ts                        中立 schema IR（JSON Schema 子集 + 约束 + 文档）
  schema/toPi.ts · toDsh.ts           两个纯函数：IR → 各宿主可吃的结构（无宿主 SDK 依赖）
  usecases/                           媒体、素材、剧目文件、readiness、craft、检索、音色、语音纯函数
  prompts/sections/*.ts               提示词正文分段
  prompts/compose.ts                  composePlaywriter(facts) / composeStagehand(facts) / renderSnapshot(facts)
  prompts/facts.ts                    HostFacts：8 类宿主事实
  prompts/skills/*.md                 技能正文唯一真相源
  deps.ts                             注入面（含宿主服务：限流/队列/回调/校验/路径白名单）
```

## 设计规约（"最干净"落到这几条）

| # | 规约 |
| --- | --- |
| R1 | **参数文档只写一遍**：字段的类型、约束、说明都写在能力的 `fields` 里；face 只 `pick`，不重写文案 |
| R2 | **face 差异是显式的类型差异**：两个宿主露出不同字段时，差在 pick 列表上（可读、可查），不是两份散文 |
| R3 | **生命周期是宿主策略不是参数**：同步等待 vs 后台排产、直落 `assets/` vs 只产草稿，编译 face 时给 |
| R4 | **同名不同义必须改名**：见下方清理清单 |
| R5 | **包不依赖任何宿主 SDK**：schema 以中立 IR 出口；`ContentBlock`/`TypeBox`/`defineTool` 全在宿主 |
| R6 | **正文唯一真相源在包内**：提示词分段与技能 markdown；宿主只负责「何时注入、注到哪、facts 是什么」 |
| R7 | **宿主专有工具不进包，但其领域实现若可共享则进包**（例：`recut_sprite` 的留底重抠、`commit_asset` 的采用流水线） |
| R8 | 包内**不握模块级可变状态**；需要状态的一律走注入面（两宿主是不同进程，不为了"跨实例"设计） |

## 事实基础（本次实测，决定了上面的形状）

| 事实 | 数值 |
| --- | --- |
| 服务端工具面 / 插件工具面 | 24 / 9，同名 5 |
| 严格同构（参数面与语义都一致） | **1 个**：`web_search` |
| 同名**不同义**（必须改名） | **2 个**：`import_asset`、`generate_image` |
| 同名同域、参数面不同 | 2 个：`generate_bgm`（10 参+排产 vs 3 参+同步）、`list_voices`（插件多 `page`） |
| 单宿主工具 | 13 条（服务端 13 / 插件 4：`set_stage_style`、`cut`、`import_asset`、`generate_asset`） |
| 既有 `contract.ts` 的 `CAPABILITY_MATRIX` | 15 行里 **6 处与代码不符**（music/view/voice/library/image/readiness），**缺 2 行**（`set_craft`/`set_stage_style`） |
| 既有 `261008-tool-audit.md` 的「DSH 侧对照」表 | 5 行里 **4 行误记**（除 `web_search` 外全错），含「`cut` 服务端有对应」（服务端根本没这个工具） |
| 提示词 | 逐字相同 1848 字 / 71 行；8 类事实必须参数化；3 处应保持不同 |
| 技能正文 | `aivn-audio`↔`galgame-audio` 逐字重合 86%；另两份同题重写 |

> 这条最要紧：**上一轮 ADR 是在一张有 4 行错的工具面对照表上做出的**。
> 本计划的第一件事就是把那张表换成本次实测的 `261009-tool-surface-map.md`。

## 清理清单（改名与拆解，都是"最干净"的必要动作）

| 现值 | 问题 | 改成 |
| --- | --- | --- |
| 服务端 `import_asset` | 从应用级资源库按 `entryId` 导入，与插件的本地登记**同名不同义** | `library_import`（能力：`library.import`） |
| 插件 `import_asset` | 本地路径/URL 登记入库 | 名字保留（能力：`asset.register`） |
| 服务端 `generate_image` | 一个 id 扛三种语义（工坊草稿 / 剧作家排产直落 / 绑 target） | 能力 `image.generate(target?)`；工坊 face（draft 策略）与剧作家 face（queued 策略）分开声明，**策略进 face、不进文案分支** |
| 插件 `generate_asset` | 一键（生成+抠底+登记） | 保留为**宿主便利 face**：由 `image.generate` + `asset.commit` 两个能力组合（实现仍在包里） |
| `CAPABILITY_MATRIX` 6 处误记 + 2 处缺失 | 契约与代码不符 | 由包内能力表**派生**，矩阵不再手写 |

## 实施

### P0 · 前置：把那 7 条红清掉（其中 1 条是真回归）——**已完成**（`3ea5876e`）

服务端 main 原有 7 条红（本次已定性，详见 `261009-server-red-diagnosis.md`）：

| 用例 | 定性 | 修法 |
| --- | --- | --- |
| `voice.test.ts` ×4（数量恰好 ×2） | **陈旧夹具**：`836be2b4` 让 `finishTurn` 同轮追收束再跑一次模型，而假流不吐 `beat_done` → 整条事件流跑两遍 | 改夹具（假流补 `beat_done` + `stopReason: toolUse`），**不要**把期望数字改成 4/2/8/2 |
| `workshopPrompt.test.ts:87`（`defaultVoiceId`） | 陈旧：字段表已下沉进 `galgame-play-setup` 技能 | 改成配对断言（提示词钉指针 + `readSkill` 钉语义） |
| `workshopPrompt.test.ts:105`（`**交给用户落盘**`） | 陈旧：措辞已改 | 改断言 |
| `workshopPrompt.test.ts:123`（skill 关仍有 `read_skill`） | **真回归**：`8a08d4fc` 新增的两处指针漏了 `can.skill` 门控 | 修代码（`workshop.ts:194` / `:239`） |

**为什么必须先做**：第三条是提示词门控的真 bug，而 P2 要改的正是这一族；
带着 7 条红进去，「不新增红」在这一族上分不出新旧。

**结果**（`3ea5876e`，基于 `ec46b1f0`）：apps/server **752 通过 / 3 跳过 / 0 失败**，typecheck 0 错，
`check:agent-contract` 7/7。基线已干净。

### P1 · 结构落地（能力/face 框架 + 双编译器 + 一条端到端）

- 建包骨架、`schema/ir.ts`、`schema/toPi.ts`、`schema/toDsh.ts`、`capabilities/` 与 `deps.ts`。
- 端到端只打通**唯一严格同构**的 `web_search`：能力一份 → 两个 face → 两个编译器 →
  两个宿主的工具注册；两边的 `exa` 客户端合一份。
- 判据：包单测绿；服务端 `build/typecheck/test` 无新增红；插件 `typecheck` + `e2e:media` 58/58 +
  `verify-injection` 的工具面断言不变；**两边各自跑一次真检索**（单点）。

### P2 · 媒体与素材 use case

- 搬 `image` 接口与三协议、抠底（连同插件 `e2e/verify-media.ts` 的抠底夹具一起进包单测）、
  提示词后缀、`web-image`、草稿区、采用、导入、台账、留底、readiness、craft、音色库。
- 服务端 `playAssets` 的 use case 换成包内实现，**队列与 adoption 流水线留上层**（R3 的宿主策略）。
- 判据：插件 `e2e:media` 全绿；服务端素材/生图相关测试不新增红；真出图单点一次。

### P3 · 提示词与技能正文

- 第一批只抽**逐字相同/近逐字**的：1848 字那批 + `renderCraftParams` 13 行模板 + A 区快照模板。
- `composePlaywriter/composeStagehand(facts)`；`HostFacts` 落地 8 类；3 处有意差异登记进能力表旁。
- 技能正文：先收敛 `audio` 两份的 86% 重合；两份**同题重写**的（play-setup / visual-craft）
  本届不动（261008 已判定合并会造出第三种说法）。两侧副本由脚本/构建生成并纳入守卫。
- 判据：服务端 `prompt/workshop` 回归 + `pnpm check:agent-contract` 全绿；插件
  `dsh-e2e` 的 `injection` / `stagehand` / `stage` 全绿。

### P4 · 工具面全量迁移与契约重建

- 服务端 24 + 插件 9 全部改为 **face 声明**；宿主专有工具的**实现**能下沉的下沉（`commit_asset`、
  `recut_sprite`、`get_readiness`/`validate_play` 的判定部分）。
- 按清理清单改名；`CAPABILITY_MATRIX` 改由包内能力表**派生**；`check-agent-contract.mjs` 同步改路径。
- 判据：两边工具面测试全绿；插件 e2e 全量（真 LLM 那几拍按 `E2E_PHASES` 只跑相关段）。

## 风险与对策

| # | 风险 | 对策 |
| --- | --- | --- |
| R1 | 服务端 `playAssets`(1250) / `agentkit`(3066) 装配签名被牵动 | 能力在下、策略在上；P2 只换实现不动队列与角色推导；每阶段跑服务端既有测试 |
| R2 | 插件 `lib/` 的 esbuild 源码路径注释随 worktree 路径变（已实证 11 行 `// ../stage-ai/...`；新包是第三条） | 把「合并前 `node_modules/@aivn/*` 指回 canonical `../stage-ai` → 重建 → `build.mjs --check`」写成脚本，固定收尾 |
| R3 | 改名（`library_import` 等）会牵动提示词与 e2e 断言 | 改名批次单独成阶段，用守卫扫全仓引用（`check-agent-contract.mjs` 已有工具名扫描） |
| R4 | 提示词 facts 参数化催生「第三种说法」 | facts 是输入不是分支：compose 内不得按宿主名 if/else；3 处有意差异从共用路径排除 |
| R5 | 新增第三层构建（core → agent → 双宿主） | 包不发布、只在本仓源码消费；插件侧由 `build.mjs --check` 钉 `lib/`，服务端侧由包单测 + 服务端测试钉 |
| R6 | 基线红掩盖新回归 | P0 先清干净（见上），并把判据记到 test id 级 |

## 验证矩阵

| 层 | 命令 / 判据 |
| --- | --- |
| 包 | `pnpm --filter @aivn/agent test`：抠底夹具（从插件 e2e 搬入）、能力纯函数、schema 双编译等价性 |
| 服务端 | `pnpm --filter @aivn/server build|test`、`pnpm check:agent-contract` |
| 插件 | `npm run typecheck`、`npm run build` + `node build.mjs --check`、`npm run e2e:media`、按改动面选 `dsh-e2e` 套件 |
| 交叉 | 「两侧技能副本与包内 md 逐字一致」「两侧提示词均从 compose 派生」「能力表覆盖两边全部 face」 |

## 与既有 ADR 的关系

本计划**取代** `261008-aivn-dual-host.shared-package.adr.md` 的「不抽包」结论。取代依据两条：
(a) 该 ADR 的候选清单没盘到「同一份实现的第二份拷贝」那一列（research §2.1），
(b) 它引用的工具面对照表（`261008-tool-audit.md` 的「DSH 侧对照」）**5 行里 4 行与代码不符**，
本计划已用实测表 `261009-tool-surface-map.md` 替换。落地时在 ADR 顶部加一行指向本计划。
