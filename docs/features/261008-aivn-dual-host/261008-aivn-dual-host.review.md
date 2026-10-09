# 检视报告

## 概要

检视范围：P0 阶段的三个提交（4336e556 素材生命周期契约、aee750a5 跨宿主能力矩阵与工具副作用元数据、e1f4c469 prompt/tool 契约漂移守卫），含 core/assetLifecycle.ts、agentkit/contract.ts、kit.ts 装配、scripts/check-agent-contract.mjs 及 prompt/workshop 的两处改写。整体方向正确：把「两边各自承诺了什么」从人记变成可查、可校验的单一记录，且不碰工具执行与宿主状态机，符合 plan 的「减少无意分歧」而非「消灭分歧」。未发现阻塞问题，但有几处契约自身的自洽性与守卫的有效性问题需要处理。

## 需求对齐

- 三个提交均落在 plan 的 P0 边界内，未扩功能；`pnpm check:agent-contract` 实跑 5/5 通过。
- 与 plan 的措辞有一处落差需要显式登记：plan 的 **P0-4** 写「优先处理已有专家检视提出的**权限 profile 与 generate_image 语义问题**」。commit aee750a5 把两者登记成了矩阵文字与按角色分化的副作用元数据，但**没有收敛实现**——`generate_image` 的「四概念压一个入口」和专家检视的 P0 最小权限（如 `bash`/`import_asset` 是否上剧作家侧）仍是原样。这是「先边界后实现」的合理取舍，但建议在小结里标成 P1 待办，否则「优先处理」会被读成已处理。
- plan 的 P0-2（共享包版本漂移）、P0-3（两边 README/AGENTS 明确独立版与 DSH 定位）在这三个提交里**未覆盖**，需确认是另批提交还是漏项。
- 有意不含 `rejected` 的判断成立：`PlayAssets.pruneDrafts` 只清不记，界面上确实不存在「否决」动作，把它记成状态会强加一次显式否决。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| S1 | `apps/server/src/agentkit/contract.ts:315-324` | `sideEffectsForTool` 只为 `playwriter` 分支返回 `asset_create: true`，`workshop` 形态则落到目录位的值；而目录位 `generate_image`（:277）的注释写着「工坊形态只落草稿」却没派生 `asset_create`。结果是 `generate_image` 的**同一个字段在两个角色间互相矛盾**，契约自身不自洽。 | 把 `asset_create: true` 提到目录位（两个角色都产出草稿，这是事实），删掉那条错误注释；`asset_adopt`/`workspace_write`/`background_job` 的按角色差异保留。 |
| S2 | `apps/server/src/agentkit/contract.ts:315-317` | 只对**命中** `TOOL_SIDE_EFFECT_CATALOG` 的工具抛错；`roleTools` 装出来的工具若没登记（`name` 不在目录），`sideEffectsForTool` 返回 `undefined`，`attachToolContract` 把它塞进 `sideEffects`，`assertToolContracts` 再抛「no side-effect contract」——但**工具目录与工具副作用目录之间没有正向覆盖校验**：`TOOL_CATALOG` 新增一个条目而这轮没装它，就不会被发现。契约声明「一个工具九项声明」，守卫却不保证这条成立（对比：能力矩阵有 `matrix.size === CAPABILITY_CATALOG.length` 的对账，工具目录没有）。 | 补一条与能力矩阵同级的对账（测试或漂移守卫）：`TOOL_CATALOG` 的每个 id 都要在 `TOOL_SIDE_EFFECT_CATALOG` 里；顺带可对 `CAPABILITY_CATALOG` 内工具 id 与 `TOOL_CATALOG` 做交叉校验——目前矩阵只登记能力（15 条），并未真正记录「两宿主各装了哪些工具」。 |
| S3 | `scripts/check-agent-contract.mjs:65` | 内建 `read/write/edit/bash` 的补入是**死代码**：`toolNamesMentionedIn`（:74-75）只收含下划线的名字，`read`/`write`/`edit`/`bash` 都进不来；白名单（:119）又要求 `词根_` 结尾。两条路径都到不了，等于这段「覆盖内建工具」是假的。 | 要么删掉这一行并说明内建工具不在本检查范围，要么让 `toolNamesMentionedIn` 也收无下划线的短名（需同步收敛白名单），使覆盖成为事实。 |
| S4 | `scripts/check-agent-contract.mjs:46` | `LIFECYCLE_STATES` 声明后从未使用：检查 3 只扫 `FORBIDDEN_LIFECYCLE_WORDS` 这三个旧词，并不校验「用到的状态词出自共享契约那一套」。因此**任何拼错的状态词（如 `adpoted`）都拦不住**——而拦截点名的正是这条。 | 二选一：删变量并把检查名改准（现状只拦已知旧词）；或实现白名单校验（扫提示词/工具文里的状态词集合，与 core 的 `ASSET_LIFECYCLE_STATES` 对齐），后者才配得上「只用共享契约那一套」这个名字。 |
| S5 | `apps/server/src/prompt.ts:285,297`；`apps/server/src/agentkit/imageTool.ts:33-37,81` | 「信息挪回该在的层」这个结论对一部分内容不成立。被删的两条 model-facing 信息——(a) **无卡主体必须给 `title`**，否则名牌只显示 id（pruned 行）；(b) `sprite:` 时立绘目录名与角色 id 不同、别去撞（删的是「A 区角色表里标着立绘（目录 …）」）——在 `QUEUED_DESCRIPTION`/`SYNC_DESCRIPTION` 里**都找不到**，只写在 schema 字段的 **JSDoc 注释**里（`imageTool.ts:33-37` 与 `:81` 均无 `description:`）。而工具栏目的 `parameters` 是**运行时 TypeBox 对象**，注释不会进入模型可见的 JSON schema，`title: Type.Optional(Type.String({ maxLength: 40 }))` 对模型就是一个裸参数。删散文同时把信息也删了，正是守卫要防的那类静默漂移。 | 把 (a)(b) 两条补进 `QUEUED_DESCRIPTION`（或至少给 `title`/`spriteId` 的 schema 补 `description`），不要只留在给开发者看的注释里。注意 `title` 那条笔者的原意（「没有角色卡的主体必须给」）比现在的措辞强，别顺手丢了。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| N1 | `packages/core/src/play/assetLifecycle.ts` | 新契约目前有 **0 个实现消费者**：`canTransitionAsset`/`isTerminalAssetState`/`isAssetReferencable` 只在测试里被断言，唯一接线是 `playAssets.ts` 的 `ASSET_DRAFT_RETENTION_DAYS`。`isTerminalAssetState`/`isAssetReferencable` 现在无人调用。 | 不阻塞（P0 是契约先行），但建议在 plan/summary 里列出「计划中的消费端接线」，避免为无人消费的 API 继续加表面积。 |
| N2 | `packages/core/src/play/assetLifecycle.ts` vs `apps/server/src/pendingJobs.ts:54`（`PendingJob.state: running/done/failed`） | 「在生成」这件事在面板上仍用第二套状态词（running/done/failed）。契约没覆盖它，所以「两边共用一句话」在面板这一层还没兑现。 | 登记为已知分歧即可；若将来要统一，属于另一个契约。 |
| N3 | `apps/server/src/agentkit/contract.ts:20,24` | `profile`（shared/preset-specific）与 `equivalence`（required/semantic-only/intentional-difference）两维语义冗余，且无校验；`profile: "shared"` 只表示「两边都有实现」，与「共用一套实现/语义门控」容易被读混（该文件 docstring 也说它「不是第二个工具注册表」，但字段名暗示是）。 | 合并为一维或给 `profile` 写清判据；至少补一句「shared = 两宿主都实现，不等于实现相同」。 |
| N4 | `apps/server/src/agentkit/contract.ts:304-310` | `bash`/`write`/`edit`/`import_asset` 的 `requires_confirmation` 均为 `false`（只有 `commit_asset` 为 true）。若将来据该位做 UI 确认门控，会漏掉这些高权限工具。 | 先记录；做门控时逐项复核。 |
| N5 | `scripts/check-agent-contract.mjs` | 检查器默认不接 CI、且**未在 `AGENTS.md` 登记**，只在 drift-check.summary 里提到。它很可能变成「写完就没人跑」的脚本，而它的价值恰恰在于「每次改提示词都会跑」。 | 把 `check:agent-contract` 写进 `apps/server/AGENTS.md`（或项目 `AGENTS.md`）的必跑清单；CI 受限可接受，但发现入口要给到。 |
| N6 | `scripts/check-agent-contract.mjs:94-105` | 参数词检查依赖「具名参数调用行整行放行」启发式，`overwrite=` 项的可达性很窄（`\b` 落在 `=` 后会失败，故它基本只匹配「散文里写 `overwrite=`」）。规则是可用的，但边界是启发式的，未来可能出现误报/漏报。 | 保持现状（作者已做收窄与假红验证），但把「靠什么判据、哪些形态会漏」记在该脚本头部注释或 AGENTS 里。 |

## 准入结论

**结论**：`条件准入`

**说明**：无阻塞问题，契约化方向正确、守卫实跑通过且不在关键路径引入回归（`DRAFT_TTL_MS` 数值与旧字面量一致，工具行为未改）；但 S1（`generate_image` 副作用元数据自相矛盾）、S5（被删的 model-facing 信息实际未落到 DESCRIPTION）建议在合并前或紧随的迭代内处理，其余可在后续迭代清理。

补充实证（供参考，未修改任何代码）：`node scripts/check-agent-contract.mjs` 实跑 5/5 通过；`installedToolNames()` 的解析未出现误报（`name: "..."` 扫描只命中工具名）。
