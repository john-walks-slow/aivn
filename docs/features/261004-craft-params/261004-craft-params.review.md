# 检视报告

## 概要

本轮检视针对 `feat/craft-params` 分支（未提交改动共 28 个文件，含 4 个新增模块与 2 个新增测试，约 2457 行 diff），覆盖 core 契约定义与校验、server 端参数解析与三态补丁、剧作家与工坊双角色提示词装配、`set_craft` 工具及其并发安全、逐剧目生图参数覆盖与请求级透传、工坊前端卡片与审批设置，以及配套测试与文档。整体架构边界清晰、设计考究，需求对齐度极高，充分践行了「确定值结构化、散文留在 craft.md」的设计原则；但在提示词降级分支措辞、前端下拉框选项冗余及个别边界防御上存在若干细节需优化。

## 需求对齐

完整满足了 `261004-craft-params.plan.md` 规划的全部第一与第二梯队需求：
1. **写作参数段落化**：`play.json` 的 `craft` 段（篇幅、停止点、素材来源 4 类）定义完整，`DEFAULT_CRAFT` 缺省生效与 `resolveCraft` 机制运行正常。
2. **邻接字段覆盖**：`scriptLanguage`、`agents.workshop.imageApproval`、`image.model` / `image.size` 逐剧目覆盖均已完整支持，`can.nsfw` 能力位闭环收口了限制级章节的注入。
3. **架构优化偏差说明（正向演进）**：原计划打算在 `playhouse.ts` 构造期注入 `image` 配置并向 `PlayAssets` 透传快照，实际实现改为在 `PlayAssets.imageOverride()` 中于每次生图请求时现读 `play.json`；该调整消除了长驻实例缓存导致的配置脏读风险，较原计划更为健壮。

## 阻塞问题

无

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | `apps/server/src/craftParams.ts:2133, 2187-2192` | **音乐音效在 `can.library === false` 时仍指导模型调取「素材资源库」**：`audioDirective` 未接收 `can` 能力位参数，当 `assets.audio === "library"` 时恒定输出 `只用素材资源库里现成的 bgm/sfx。`。若该剧目未挂载或未启用资源库（`can.library === false`），剧作家将被误导去查阅不存在的素材资源库，背离了计划文档中「`can.library === false` 时凡指向资源库的措辞降级成『只用素材清单里已有的』」的不变式。 | 为 `audioDirective` 增加 `can: AssetCapabilities` 参数；当 `!can.library` 时降级渲染为：`只用素材清单里已有的 bgm/sfx，没有合适的宁可不给。`。 |
| S2 | `apps/server/src/craftParams.ts:2139-2142, 2181-2185` | **`noImage("sprite")` 误导模型使用「素材资源库」获取立绘差分**：`noImage` 统一输出 `本剧目没开生图：需要新${what}时用素材资源库里现成的，或换一段能演的戏、用旁白交代。`。但在宿主引用即导入与资产体系中，立绘差分（sprite）依附于角色卡，库中不存在独立的 sprite 资产类型（仅有整卡 characters），剧作家也没有 `import_asset` 工具。指示模型在无生图时「用素材资源库里现成的立绘」会导致模型输出无效 DSL 引用或空转。 | 将立绘降级指令与通用 `noImage` 分离，对立绘输出专属降级语：`本剧目没开生图：不要给角色出新立绘差分，角色表里已有的差分照常用，缺立绘用旁白交代。`；同时在 `noImage` 中若 `!can.library`，背景与 CG 亦应回落为「用素材清单里已有的」。 |
| S3 | `apps/web/src/workshop/SettingsPane.tsx:1378-1414, 1468-1502` | **写作参数卡 6 个下拉框中均包含与「默认」重复的选项，且选择会产生 UI 自动弹回**：在 `CRAFT_OPTIONS` 中，每项均同时存在 `["", "默认（...）"]` 与默认值本体（如 `["medium", "中等..."]`、`["three", "每次 3 条"]` 等）。当用户在下拉中点击「中等」时，`editCraft` 会因 `blank("medium") === true` 将其判定为默认并执行 `delete craft.beatLength`，导致 state 变成 `undefined`，进而触发 `<select value="">`，下拉框显示瞬间跳回「默认（中等）」。在同一菜单中摆放两项同义项且其中一项点后弹回，给用户带来困惑。 | 移除 `CRAFT_OPTIONS` 中与默认值重复的显式选项（仅保留第一项「默认（xxx）」及非默认选项），或调整选项绑定与解析方式，消除冗余项与选择弹回体验。 |
| S4 | `apps/server/src/craftParams.ts:2079-2084` | **`STOP_OPTIONS_DIRECTIVE` 措辞过度绝对，可能抑制模型的无参自然演完**：提示词渲染为 `beat_done 每次给 3 条互斥选项：beat_done(options=["…", "…", "…"])。`。「每次给」带有强约束，容易使模型误认为每一轮收束都必须提供选项，从而压制了 DSL 规范中允许的 `beat_done()`（自然演完）与 `placeholder` 自由输入。计划文档原设计为「每个停止点给 3 条互斥选项；停止点出现在哪一轮仍照创作口径」。 | 优化措辞为：`有停止点时给 3 条互斥选项：beat_done(options=["…", "…", "…"])；自然演完或停止点时机照创作口径。`，保持规则弹性。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `apps/server/src/workshop.ts:603, 613` | **出图审批设为 `auto` 时设定流程步骤 3 标题仍写着「拿到批准才出图」**：`setupFlow` 中步骤 3 固定为 `3. **列图单、拿到批准才出图**：...（本剧目免审批，列完直接出）`，标题与内容存在轻度语义对立，模型可能对加粗标题过度敏感。 | 将步骤 3 标题做微小动态插值：`3. **${ctx.imageApproval === "auto" ? "列图单、免审批出图" : "列图单、拿到批准才出图"}**：`。 |
| N2 | `packages/core/src/play/config.ts:1697` | **`parsePlayConfig` 对 `scriptLanguage` 的类型防御微瑕**：若 `play.json` 中意外写入非字符串（如 `"scriptLanguage": 1` 或 `true`），`data.scriptLanguage?.trim()` 会抛出 TypeError，与 core 包静默丢弃非法值的规范略有偏差。 | 建议使用 `typeof data.scriptLanguage === "string" && data.scriptLanguage.trim() ? { scriptLanguage: data.scriptLanguage.trim() } : {}`。 |
| N3 | `apps/server/src/agentkit/craftTool.ts:2032-2036` | **`readCraft` 缺少 JSON 解析防御**：`deps.files.read("play.json")` 虽然挂了 catch，但后方的 `JSON.parse(raw)` 未被保护。若文件正在被非受控编辑产生残缺，可能导致工具报错未包裹。 | 将 `JSON.parse` 纳入 try-catch 兜底，解析失败时优雅回退至 `resolveCraft(undefined)`。 |
| N4 | `apps/server/src/agentkit/craftTool.ts:1903-1974` | **`setCraftParams` Schema 显式展开略显冗长**：参数定义中多处使用 `Type.Literal(CRAFT_ENUMS.xxx[0])` 等索引式硬编码展开，可维护性稍逊。 | 后续可重构为 `Type.Union([...CRAFT_ENUMS.xxx.map((val) => Type.Literal(val)), Type.Null()])`，更显紧凑且防止未来枚举增减时漏项。 |

## 准入结论

**结论**：`条件准入`

**说明**：代码架构规范、单元测试完备，核心状态合并与文件锁保全实现优异。建议在正式合入或下阶段迭代中优先处理 S1–S3 问题（修复能力位降级文案准确性以及优化工坊设置页下拉交互体验）。

## 检视后处理（2026-10-04）

| ID | 处理 | 说明 |
| --- | --- | --- |
| S1 | 已修 | `audioDirective` 接 `can`：没配库时改成「只用素材清单里已有的 bgm/sfx；没有合适的宁可不给」 |
| S2 | 已修 | 立绘单独一条降级语（不出新差分、已有差分照常用）；`noImage` 的背景/插图按 `can.library` 在「素材资源库」与「素材清单」之间切换 |
| S3 | 已修 | `CRAFT_OPTIONS` 删掉与默认值同义的显式项（选了会被 `editCraft` 删字段、下拉弹回），默认值只在第一项括注里报一次 |
| S4 | 已修 | 改成「**有**停止点时给 N 条互斥选项」——写成「每次给」会逼它每轮硬塞选项，再也收不了尾 |
| N1 | 已修 | 设定流程第 3 步的加粗标题跟着审批模式分叉（免审批 / 拿到批准才出图） |
| N2 | 不改 | `scriptLanguage` 与既有的 `voiceLanguage` 用同一行 `?.trim()` 写法；手写非字符串是编辑事故，现约定就是抛错而不是静默丢弃（只改一个字段反而造成两套口径） |
| N3 | 不改 | play.json 坏掉时 `store.loadPlay` 等一串入口都会抛；这里加兜底只会把「文件坏了」伪装成「默认值生效」 |
| N4 | 不改 | schema 里逐项 `Type.Literal` 展开是**穷尽**写法：枚举增删时这一处必然要动，改成 `.map()` 反而让漏项更难发现 |
