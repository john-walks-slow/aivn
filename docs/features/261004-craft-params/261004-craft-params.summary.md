# 写作参数化 实施总结

## 背景

原先把「剧作家每一轮该写多长、停止点给几条选项、素材从哪来」这套写法指导只写在工坊提示词里，让搭台 agent 转述给用户——没有可配置面。2026-10-03 曾决定「引擎不自带任何创作口径」，口径全部交给 `memory/always/craft.md`；结果是新剧目看不到也改不动任何东西，而「一轮写多长」是剧作家每轮都在做、且本该有一个可见答案的决定。

本轮把它拆成两半：

- **能取确定值的** → 参数（`play.json` 的 `craft` 段），引擎给默认值，工坊有卡片，模型有工具；
- **只能拿话说的**（文风、禁忌、称呼、视角） → 留在 `craft.md`，每轮原样注入。

## 交付内容

**core（`packages/core/src/play/config.ts`）**

- `CraftParams{beatLength?, stopOptions?, assets?}`、`CRAFT_BEAT_LENGTHS` / `CRAFT_STOP_OPTIONS` / `CRAFT_BACKGROUND_SOURCES` / `CRAFT_CG_SOURCES` / `CRAFT_SPRITE_SOURCES` / `CRAFT_AUDIO_SOURCES`、`DEFAULT_CRAFT`（medium / three / 背景 `library-first`、插图 `generate`、立绘 `generate`、音效 `library`）、`resolveCraft()`。
- `PlayConfig.scriptLanguage?` / `PlayConfig.craft?` / `PlayConfig.image?: {model?, size?}`；`AgentSettings.imageApproval?`（`ask` / `auto`，只认工坊那张卡）。
- 三个解析分支沿用既有口径：非法枚举值逐字段丢弃，整段没剩下东西就不留空壳；`image.size` 只做非空校验，合法性留给生图层（不同后端词汇不同）。

**server**

- 新 `src/craftParams.ts`：`renderCraftParams(effective, can)`（剧作家的提示词段，按 `can.image` / `can.library` 降级措辞）、`describeCraftParams()`（工坊与工具回执的现状清单）、`mergeCraftParams()` + `CraftPatch`（三态：省略=不变、值=设定、`null`=恢复默认；结果裁掉与默认相同的字段）。
- 新 `src/agentkit/craftTool.ts`：`set_craft`，只装工坊，group `files`。读-合并-写整体在 `withPlayConfigLock` 内；写回用**原始对象只换 `craft` 一个键**（不整篇 `parsePlayConfig` + 序列化，那会丢掉引擎不认识的手写字段）；写盘走 `PlayFiles.write`（结构校验 + 撤销条）。
- `src/prompt.ts`：写作参数段**永远注入**（全默认值时也注入），位置紧跟 `craft.md` 之前；`scriptLanguage` 段紧随 `ROLE_INTRO`；NSFW 两段从**恒注入**改成按 `can.nsfw`（`CAPABILITY_TOOLS.nsfw = "enter_nsfw"`）收口；几处指向 craft.md 的口径指针改成《写作参数》。
- `src/workshop.ts`：`WorkshopPromptContext` 加 `scriptLanguage` / `craft` / `imageApproval`；新增 `playLanguageNote()`；`imageGuide()` / `setupFlow()` 按审批模式分叉；写作要点区分「参数用 `set_craft`、散文写 craft.md」；删掉 `assetSourceGuidance()`（取舍内容搬进 `set_craft` 的工具描述）。
- `src/workshopSession.ts`：把 play.json 的三项现读值透传进工坊 prompt。
- 生图逐剧目覆盖：`ImageRequest` 加可选 `model` / `size`，`geminiImage` / `openaiImage` 取 `req.x ?? this.x`；`PlayAssets` 新增私有 `imageOverride()`，**每次出图现读** `play.json` 的 `image` 段。

**web**

- `src/workshop/PlayPane.tsx`（剧目页，只写 play.json）：补剧本语言下拉、逐剧目生图模型与档位输入，以及「写作参数」一段（六个下拉，第一项恒为「默认」= 把该字段从文件里删掉）。写作参数最初摆在「记忆」页的设定卡里，合并时随主干的角色卡重构（`SettingsPane` 拆成 PlayPane / CharacterPane / MemoryPane）挪到「剧目」页——它写的还是 play.json，和标题、语音语言同一份文件。
- `src/workshop/AgentPane.tsx`：搭台助手卡补「出图审批」下拉；`src/workshop/MemoryPane.tsx` 里 craft.md 的占位符改成只说文风与禁忌，节奏与素材来源指向「剧目」页。

**数据与文档**：`plays/demo`（play.json 加 `scriptLanguage` 与 `craft` 示例、craft.md 撤掉素材来源行）、`README.md`（新增「剧作家怎么写：写作参数 + 创作口径」一节与设置表两行）、`apps/server/AGENTS.md`、`apps/web/AGENTS.md`。

## 验证

- `pnpm -r typecheck`：三个包全过。
- 测试（分支上）：core 139 / server 541（40 文件，排除 `test/e2e-live-*`）/ web 154，全绿。新增 `apps/server/test/craftParams.test.ts`、`apps/server/test/craftTool.test.ts`；core 补 `craft`/`scriptLanguage`/`image`/`imageApproval`/`resolveCraft` 用例；改写了三处「引擎不自带任何口径」的旧护栏与两处「素材来源维度」的旧用例。合入主干后用例集随角色卡重构变动，最终数为 core 137 / server 541 / web 169，见下节。
- 未跑真图 / 真 LLM 的 `e2e-live-*`；未做浏览器验证（本轮是后端 + 一个设置表单，按用户既有偏好不代跑 UI）。

## 检视与处理

结论「条件准入」，阻塞 0 项。4 项建议全部修掉：音效那行在没配库时不再指向「素材资源库」；立绘没生图时单独一条降级语（不出新差分、已有差分照常用）；六个下拉删掉与默认值同义的冗余项（选了会被删字段、下拉立刻弹回）；停止点措辞从「每次给 N 条」改成「**有**停止点时给 N 条」。非阻塞 4 项改 1 项（设定流程第 3 步标题随审批模式分叉），其余 3 项说明理由后保留。逐项见 [实施检视报告](261004-craft-params.review.md)。

## 合并（2026-10-04）

分支开发期间主干推进了 `128b67c`（角色卡上移顶层、主角升格为一张普通角色卡），合入时按新结构落地：

- `SettingsPane.tsx` 已在主干删除（拆成 PlayPane / CharacterPane / MemoryPane），写作参数与生图字段一并落到 **PlayPane**，不再新造一张卡；`craft.md` 的占位符改在 MemoryPane 里。
- `writingPoints` 里「角色卡在 `characters/<id>.md`」「主角也是一张普通卡」等主干新说法保留，写作参数那条插在创作口径之前；play.json 字段表补 `scriptLanguage` / `craft` / `image`，并去掉已迁走的 `protagonist`。
- `play.json` 的 `scriptLanguage` 与 demo 的写作参数示例保留；`protagonist` 段随主干迁走。

合入后 `main` = `6e5b8f6`（ff-only，未 push），分支 worktree 保留未删。合入后在 main 工作区重建并重跑：`pnpm -r build` 通过，core 137 / server 541（40 文件，排除 `test/e2e-live-*`）/ web 169 全绿。

> **构建产物陈旧会假失败**：合并当时 main 工作区的 `packages/core/dist` 停留在 `128b67c` 之前（03:28，早于该提交的 05:27），`isProtagonist` / `characterCardPath` / `DEFAULT_CRAFT` / `resolveCraft` 一个都不在其中，web 的 `characterCards`（6 条，渲染卡在「读取中…」）与 `playPane`（2 条，`DEFAULT_CRAFT` 为 undefined）共 8 条用例因此失败。`pnpm -r build` 后即 169/169 全绿——不是代码缺陷。跑 dev（`node --watch dist/index.js`）的实例同样要重建后才看得到本次改动。

## 与计划的偏差

- 逐剧目生图覆盖：计划是从 `playhouse.playAssetsFor` 构造期注入 `play.image`，实际改成 `PlayAssets` 内部每次出图现读 play.json。理由：`playAssetsFor` 的 map 按剧目缓存、进程内永不失效，构造期快照会让「设置页改了模型，出图还是老模型」。代价是每次出图多读一次小文件。
- 用户直接批准合并（「合并」），未逐项实机验证，[验证文档](261004-craft-params.validation.md) 的 11 项仍为「待验证」。

## 留下的口子（后续可做）

- `stopOptions` 只定「给了就是几条」，什么时候交还主导权仍归剧作家自己判断；若日后要参数化「多久收一次」得另开一维。
- 生图模型目前是文本框（没有清单接口）；若 `GET /api/agents/models` 之外再出个生图模型清单，这里可以换成下拉。
- 参数化候选里没做的：`beat` 之外的节奏维度、素材命名风格、默认运镜偏好——它们要么取值不成集合，要么和 craft.md 的散文边界重叠。
