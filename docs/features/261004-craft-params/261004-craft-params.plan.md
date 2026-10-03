# 写作参数化：篇幅、停止点、素材来源与三处邻接设置

日期：2026-10-04
分支：`feat/craft-params` · 工作区 `.worktrees/craft-params`

## 起因

「一轮写多长、停止点给几条选项、素材从哪来」现在全部是 `memory/always/craft.md` 里的一段散文：
由搭台助手按 `workshop.ts` 的「剧目写作要点」「素材来源」两条指导写出来，剧作家每轮原样读到。

两端都落在自然语言上：用户要改节奏得先把散文读懂再改对，剧作家要从散文里读出意图。本次把其中
三件事变成 `play.json` 的结构化参数——用户在设置页点几下配完，搭台助手用一个工具写，引擎渲染成
固定措辞的指令段注入剧作家提示词。

同时收进四处邻接设置（剧本语言、工坊出图审批、NSFW 入口、生图模型/尺寸）。

## 决策记录

**1. 引擎重新带默认值（2026-10-04 用户决定，推翻 2026-10-03 的「引擎不自带任何创作口径」）。**

新剧目开箱即用：篇幅默认「完整小场面」、停止点默认 3 条选项、素材来源默认
「背景优先库 / 插图与立绘自绘 / 配乐音效用库」。这与 10-03 删掉的 `CRAFT_RULES` 有三点不同，
也正是不算走回头路的理由：

- 值**在 play.json 里**，用户看得见、改得动、存得下，不是散在提示词正文里的硬编码；
- 渲染**只有一处**（`craftParams.ts`），prompt 正文里不再复述第二遍；
- 它只覆盖可枚举的三维，文风/禁忌/停止点节奏仍归 craft.md。

代价要认：`prompt.test.ts` 现有三条护栏（「craft.md 是唯一来源」「硬编码句式黑名单含
`10–25 句` / `500–1500 字` / `2~4`」）必须重写为「默认值由 craft 段渲染」的新不变式。
`261003` summary 遗留节写的「第一反应是把 craft.md 落盘做硬、而不是把默认加回来」，本轮按用户
决定反向执行。

**2. NSFW 入口不新增字段。**

它有现成机制：`agents.playwriter.tools` 的启用集里取消 `enter_nsfw` / `exit_nsfw` 就是关闭。
真正缺的是提示词没跟着收口——`prompt.ts` 的 `nsfwGuidance` 现在恒注入「进入限制级」那一章，
不管工具有没有装上，这正是 `apps/server/AGENTS.md` 里点名的「工具可见性错配当 bug 治」。
所以本轮做的是补一个 `can.nsfw` 位并让那一章按它收口，不再立第二个开关。

## 现状

- **口径的唯一来源是 `memory/always/craft.md`**：`PlayMemory.load` 原样读入（`memory.ts`），
  `buildSystemPrompt` 原样注入（`prompt.ts` 的 `craftSection`），引擎侧没有任何默认
  （2026-10-03 的 `261003-craft-style-handoff` 把 `CRAFT_RULES` 与「单轮该写多长」整节删干净了）。
- **两条写入口**：搭台助手用 pi 的 `write`/`edit` 写（走 `PlayFiles` 白名单 + 撤销条）；
  用户在工坊「设置」页的「创作口径」卡里手改。两条路都 `markChanged` → 收束时重建 runtime。
- **craft.md 还兼着出图口径**：`playhouse.ts` 把 craft 原文喂给 `composeImagePrompt`
  （`imagePrompt.ts` 的「创作口径/画风设定」段）。画风关键词必须留在 craft.md。
- **`plays/demo` 的 craft.md 已经在写素材来源**（「素材来源：插图与立绘差分用 `generate_image`
  生成；背景与配乐**优先**使用资源库或预置素材。」）——参数必须留得住那个「优先」。
- **play.json 已有同类先例**：`voiceLanguage` / `defaultVoiceId` / `protagonist` / `cover` /
  `agents.<role>.*` 都是逐剧目的结构化设置，由 `parsePlayConfig` 逐字段校验，
  读写走 `withPlayConfigLock` + `PlayFiles` 白名单。工坊 `writingPoints` 里已有一张
  play.json 字段表（要求定点 `edit`、不整篇覆盖），本次给它加三行。
- **生图后端是全局单例**：`playhouse.ts` 构造时 `createImageBackend(config)` 一次，
  `model` / `size` 在构造期就烧进 `GeminiImageGen` / `OpenAiImageGen`；`playAssetsFor` 把它
  传进每个剧目的 `PlayAssets`。**逐剧目覆盖要改成请求级**（见实现方案）。
- **`prompt.ts` 的 NSFW 章不受能力位约束**，`can` 位表（`CAPABILITY_TOOLS`）里没有 nsfw。

## 数据模型

### `play.json` 新增 `craft`

```ts
export const CRAFT_BEAT_LENGTHS = ["short", "medium", "long"] as const;
export type CraftBeatLength = (typeof CRAFT_BEAT_LENGTHS)[number];

export const CRAFT_STOP_OPTIONS = ["two", "three", "four", "free"] as const;
export type CraftStopOptions = (typeof CRAFT_STOP_OPTIONS)[number];

/** 素材来源：逐类来路。取值集各类不同构——音频没有生成通道，立绘必须垫图。 */
export interface CraftAssetSources {
  /** 背景：library-first 优先库、缺了才自己画；library 只用库；generate 自己画。 */
  background?: "library-first" | "library" | "generate";
  /** 插图：library 走引用即导入；generate 自己画；off 本剧不出插图。 */
  cg?: "library" | "generate" | "off";
  /** 立绘差分：generate 自己出（neutral 定妆照垫底）；off 不新出，有什么用什么。 */
  sprite?: "generate" | "off";
  /** 配乐/音效：library 只用清单/库里已有的 id；off 不用。 */
  audio?: "library" | "off";
}

export interface CraftParams {
  beatLength?: CraftBeatLength;
  stopOptions?: CraftStopOptions;
  assets?: CraftAssetSources;
}

/** 缺省生效值（引擎默认）：字段缺省 = 这一项取它。 */
export const DEFAULT_CRAFT = {
  beatLength: "medium",
  stopOptions: "three",
  assets: { background: "library-first", cg: "generate", sprite: "generate", audio: "library" },
} as const;
```

`parseCraftParams` 与 `parseAgentConfig` 同口径：整段可缺省，逐字段校验、非法值丢弃。
**play.json 只存与默认不同的字段**（照 `configApi` 的「只落改动过的键」），所以引擎默认值以后
调整能惠及所有没显式设过的剧目；`resolveCraft(play.craft)` 负责与 `DEFAULT_CRAFT` 合成生效值。

### 三处邻接字段

```ts
/** 剧本语言（顶层，与 voiceLanguage 并列）：写「剧本用什么语言写」，翻译是另一件事。 */
scriptLanguage?: string;          // ISO 639-1；缺省 = 跟随玩家输入（现行为）

/** 生图覆盖（顶层）：逐剧目换模型/尺寸，缺省 = 跟 STAGE_IMAGE_MODEL / STAGE_IMAGE_SIZE。 */
image?: { model?: string; size?: string };   // size 走 parseImageSize 的两种写法

/** 工坊出图审批（agents.workshop）：ask = 用户点头才出（现行为）；auto = 不用逐张问。 */
imageApproval?: "ask" | "auto";
```

## 渲染

新模块 `apps/server/src/craftParams.ts`，三份输出：

**剧作家侧**（`renderCraftParams(craft, can)`，永远输出，因为默认值也算生效值）：

```
# 写作参数（这部剧的设置，按它执行）

- 每轮篇幅：一轮是一个完整的小场面，约 15~25 句台词与旁白。
- 停止点选项：每个停止点给 3 条互斥选项；停止点出现在哪一轮仍照创作口径。
- 素材来源：
  - 背景：先查素材清单与资源库，库里有的直接用 id（写了库里有的 id，宿主会自动导入）；库里确实没有、画面又必须有，才自己生成。
  - 插图：自己用 generate_image 出。
  - 立绘：自己用 generate_image 出；先出 neutral 定妆照，其余差分垫它。
  - 配乐与音效：只用素材清单里已有的 id；没有合适的宁可不给。
```

篇幅三档措辞固定（「短交锋 / 完整小场面 / 一场戏」是操作性描述，句数只是参考——模型数不准）：

| 取值 | 渲染 |
|---|---|
| `short` | 一轮是一个短交锋：约 6~10 句，一个转折就收束。 |
| `medium` | 一轮是一个完整的小场面：约 15~25 句台词与旁白。 |
| `long` | 一轮是一场完整的戏：约 30 句以上，把这一段写透再收束。 |

素材来源每类都写清「缺了怎么办」——参数收窄了策略空间之后，缺口行为必须有出口：

| 取值 | 渲染要点 |
|---|---|
| `background: library-first` | 先查清单与库；库里没有、画面又必须有，才自己生成 |
| `background: library` | 只用清单/库里的 id；库里没有就用旁白交代，不自己生成 |
| `background: generate` | 自己出图（清单已有的直接引用，不重复出） |
| `cg: library` | 写库里的插图 id，宿主自动导入 |
| `cg: generate` | 自己出图 |
| `cg: off` | 不出插图，用旁白与台词交代 |
| `sprite: generate` | 自己出立绘差分；先 neutral 定妆照，其余垫它 |
| `sprite: off` | 不新出差分，有什么用什么；没有立绘的角色不上台 |
| `audio: library` | 只用清单里已有的 bgm/sfx id，别凭空造 |
| `audio: off` | 不用配乐与音效 |

**能力位降级**（渲染器收 `can`）：`can.image === false` 时，凡是「自己画」的措辞换成
「本剧没有生图，用已有素材或旁白交代」；`can.library === false` 时，凡是指向资源库的措辞
降级成「只用素材清单里已有的」。

**剧本语言**（设了才输出）：`- 剧本语言：一律用{语言}写（玩家的中文输入按剧情转写成该语言的台词）。`

**搭台助手侧**（`describeCraftParams(effective, imageApproval, scriptLanguage)`）——
照实列出生效值（含默认），让它可以对用户复述现状：

```
当前写作参数（play.json 的 craft 段，用 set_craft 改；未列出的项按引擎默认）：
- 每轮篇幅：完整小场面（约 15~25 句）
- 停止点选项：3 条互斥选项
- 素材来源：背景=优先库；插图=自己画；立绘=自己画；配乐音效=用库
- 剧本语言：跟随玩家输入
- 工坊出图审批：要先问过你
```

注入位置：`prompt.ts` 的 A 区，紧挨在 `craftSection` 之前（`assetSection` 之后）。

## 用户路径

1. **新剧目**：搭台助手第 4 步落盘 premise → 写 craft.md（文风、禁忌、停止点节奏）→ 按用户在
   第 1 步答的节奏与素材意向调 `set_craft`（不调也有一份默认生效）。
2. **自己配**：工坊「设置」页 →「写作参数」卡（新），四组下拉 + 剧本语言 + 一个保存按钮；
   每组的「默认（…）」项 = 不写这个字段、跟引擎默认走。
3. **改主意**：「节奏快点」「背景别自己画了」→ 对话里说，搭台助手调 `set_craft`。
4. **收回一项**：「这条别管了」→ 设置页选回「默认」，或让搭台助手把该项设为 `null`。
5. **剧作家侧**：每轮 A 区多一段「写作参数」。

## 实现方案

### core（`packages/core/src/play/config.ts`）

- `CraftParams` / `CraftAssetSources` / `DEFAULT_CRAFT` / `CRAFT_*` 常量；
- `PlayConfig` 加 `craft?`、`scriptLanguage?`、`image?`；`AgentSettings` 加 `imageApproval?`；
- `parsePlayConfig` 里接三个新解析分支，口径同 `parseAgentConfig`（逐字段丢弃非法值）。

### server

| 文件 | 改动 |
|---|---|
| `src/craftParams.ts`（新） | `resolveCraft(craft)`（合成生效值）、`renderCraftParams(effective, can)`、`describeCraftParams(...)`、`mergeCraftParams(current, patch)`（`null` 删项） |
| `src/prompt.ts` | `craftParamsSection` 插在 `craftSection` 之前；`scriptLanguage` 渲染；NSFW 两段按新的 `can.nsfw` 收口；`HOW_I_WORK` / `FORMAT_RULES` 里指向 craft.md 的口径指针改成「写作参数与创作口径」 |
| `src/agentkit/kit.ts` | `CAPABILITY_TOOLS` 加 `nsfw: "enter_nsfw"`；`TOOL_CATALOG` 登记 `set_craft`（group 用现成的 `files`，roles `["workshop"]`）；`workshopTools` 装上；核对 `DEFAULT_ENABLED` 的注释（把素材策略指向 craft.md 那句已失效） |
| `src/agentkit/beatTool.ts` | 描述里「给几条选项…全由剧目的创作口径（memory/always/craft.md）定」点名了已不承载它的文件，改成指向写作参数 |
| `src/agentkit/craftTool.ts`（新） | `set_craft`：读 play.json → `mergeCraftParams` → `files.write`（结构校验 + 撤销条）→ 回新生效值。**读-合并-写整体包进 `withPlayConfigLock`** |
| `src/workshop.ts` | 写作要点改成「craft.md 写文风、禁忌、停止点节奏」+「篇幅/选项/素材来源用 `set_craft`」；`assetSourceGuidance` 删除，内容搬进 `set_craft` 描述；play.json 字段表加 `craft` / `scriptLanguage` / `image`；出图审批那句按 `imageApproval` 分支；提示词附 `describeCraftParams` |
| `src/workshopSession.ts` | `systemPrompt()` 已 `loadPlay()`，透传 `play.craft` / `scriptLanguage` / `agents.workshop.imageApproval`（照 `voiceLanguage` 的现读注入先例） |
| `src/imageBackend.ts` | `ImageRequest` 加可选 `model?`、`size?`；两款实现取 `req.x ?? this.x`（构造期默认不变） |
| `src/playAssets.ts` | `generate` 时**现读** `play.json` 的 `image` 段，透传进 `ImageRequest` |
| `src/playhouse.ts` | 不动 |

**实施偏差（2026-10-04）**：原计划是从 `playhouse.playAssetsFor` 构造期注入 `play.image`。实际改成
`PlayAssets` 内部私有 `imageOverride()` 每次出图现读 play.json——`playAssetsFor` 的 map 按剧目缓存、
进程内**永不失效**，构造期快照会让「设置页改了模型，出图还是老模型」。代价是每次出图多读一次
play.json（本地小文件）。
| `src/configApi.ts` | 不动（全局仍是 env 的默认值，逐剧目覆盖在 play.json） |

工具描述里写清三件事：各枚举含义与缺口行为、**省略字段 = 不变 / `null` = 恢复默认**、
与 craft.md 的分工。多一个工具而不让模型直接 `edit` play.json 的理由：`parsePlayConfig` 只保证
「能解析」，整篇覆盖缩水或字段拼错都会被静默丢弃，模型以为设了、设置页显示默认，两端口径漂移；
`cover` 那种教模型手改 play.json 的既有做法是单字段低频特例，不作推广。

### web（`apps/web/src/workshop/SettingsPane.tsx`）

- 新增卡片 `{ key: "craft", kind: "craft", title: "写作参数" }`，排在「剧目」之后、常驻设定之前；
- 控件：每轮篇幅、停止点选项、素材来源 ×4、剧本语言（复用 `LANGUAGE_LABELS`），每组都带
  「默认（…）」项；保存走已有的 `savePlay`（复用 `kind !== "file"` 的保存按钮分支）；
- 「剧目」卡补生图模型/尺寸两个输入（尺寸用 1K/2K/4K/默认 下拉，模型用文本框，占位符显示
  env 当前值；模型没有清单接口，文本框是当前唯一办法）；
- 「Agent」页搭台卡补「出图审批」开关；
- 「创作口径」卡占位符改成「这里写文风、禁忌、停止点节奏；篇幅与素材来源去『写作参数』」。

### 数据与文档

- `plays/demo`：删 craft.md 的「素材来源」行，play.json 写一份 `craft` 示例（背景 `library-first`，
  与它原来那句「优先使用资源库」等价）。
- `README.md`：改写「剧作家怎么写，由剧目的创作口径定」一节，补 `craft` / `scriptLanguage` /
  `image` / `imageApproval` 的字段表与取值；`generate_image` 默认开启那段同步改口径。
- 实施完成后按 `/update-module-instruction` 更新 `apps/server/AGENTS.md`、`apps/web/AGENTS.md`
  （「创作口径与剧目记忆」整节要重写），按 `/update-project-instruction` 核对根 `AGENTS.md`。

### 不做

- **不做旧数据迁移**：老剧目没写 `craft` 就吃默认值，行为可能变（原来 craft.md 写「每轮 10 句」
  而现在引擎默认「15~25 句」会叠加）——但 craft.md 与参数各管一摊，散文里那句仍生效，
  以「更具体的一方」为准的情况由用户在设置页看到现值后自行收敛。不动 `mh`/`random` 等本机剧目。
- 不做预设层（「轻快/沉浸」一键打包），先把字段立起来。
- 不参数化「文风与禁忌」「停止点节奏」：说不成条目，留在 craft.md。

## 参数化候选（剩余）

| 候选 | 现状 | 参数形态 | 建议 |
|---|---|---|---|
| 停止点密度 | craft.md 散文 | `craft.stopDensity: "every" \| "sparse" \| "auto"` | 观望：`stopOptions` 已管住「出现时给几条」，这条管「多久出现一次」，先靠散文 |
| 每轮生图张数上限 | 无 | `craft.maxImagesPerRound: number` | 观望：素材来源管得住「该不该生」，管不住「该生时一轮生几张」（`sprite: generate` 时一口气出五个差分）。配额事故频发就是第一候选 |
| 叙事人称 | craft.md 散文 | `craft.narration: "first" \| "third"` | 不建议：能枚举，但散文写得更准，收益小于多一个口径来源 |
| 是否允许演出中引入新角色 | `create_character` 工具开关 | —— | 已有机制，不另立参数 |
| 停止点之外自动推进 | 玩家侧设置 | —— | 不属于剧目口径 |

判断口径：能枚举、且引擎渲染成固定措辞比散文更稳的才参数化；说不成条目的留在 craft.md。
已有工具开关能表达的（工具能力）不另立参数——NSFW 入口就是按这条收的。

## 影响面与风险

- **`prompt.test.ts` 三条护栏要重写**：从「引擎不带任何口径」改成「可枚举三维由 craft 段渲染、
  缺省取 `DEFAULT_CRAFT`；craft.md 只贡献文风与节奏」。黑名单用例（`10–25 句` 等）换成
  「数字只在渲染段出现一次、改参数即跟着变」的断言。
- **craft.md 职责收窄**：搭台助手的五件事指导要同步改，否则它会继续往 craft.md 里写素材来源，
  与参数重复。
- **两个写者**：`set_craft` 与设置页都改 play.json 的 `craft` 段，必须走 `PlayFiles.write` 的校验
  与 `withPlayConfigLock`，`set_craft` 的读-合并-写要在同一把锁内完成。
- **参数与能力冲突**：渲染时按 `can` 降级措辞，不做硬拦截；UI 上给出提示。
- **逐剧目生图覆盖**：全局单例后端不再够用，但**不改后端构造**——只在 `ImageRequest` 上带
  `model`/`size` 覆盖，构造期值仍作默认。这样 flow2api / cpa 两套后端与全局设置页都不受影响。
- **热更时序**：参数卡走 `savePlay` → `playhouse.reload` **立即重建**；craft.md 与工坊写盘走
  `reloadAfterWorkshopWrite` **等节拍边界**。这是 play 卡的既有行为，本次不改，验证时要知道。

## 验证

- core：`craft` / `scriptLanguage` / `image` / `imageApproval` 解析用例（合法/非法/缺省/逐字段丢弃）；
  `DEFAULT_CRAFT` 合成。
- server：`renderCraftParams` 各分支（含每类缺口行为、`can` 降级、`scriptLanguage`）；
  `buildSystemPrompt` 默认值段与改参数后的差异；`set_craft` 读写 play.json（校验不过不落盘、
  `null` 恢复默认、并发合并）；NSFW 章按 `can.nsfw` 收口；`ImageRequest` 覆盖透传。
- 实机（用户在开着的 dev 里看）：改 demo 的「写作参数」，发一轮确认剧作家按新篇幅写；
  改回「默认」确认恢复；切一次剧本语言与出图审批。
- 不跑浏览器 e2e（本轮是纯后端 + 一个设置表单）。
