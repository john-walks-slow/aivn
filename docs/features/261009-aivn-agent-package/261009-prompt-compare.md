# AIVN 双宿主提示词正文逐段对照（只读调研）

调研目标：判断 AIVN 引擎两个宿主的**提示词正文**哪些能抽成共用包、必须参数化什么。

- 独立服务端：`/root/projects/stage-ai-shared`（branch `feat/shared-aivn-core`，HEAD `c8595bb9`）
- DSH 插件：`/root/projects/dsh-aivn-shared`（branch `feat/shared-aivn-core`，HEAD `e832b35`）
- 本报告不修改任何仓库文件；唯一写出的文件是这份报告。
- 下文 `srv` = stage-ai（独立版），`plug` = dsh-aivn（插件）。

## 0. 先纠两处坐标

1. **活技能目录不是仓库根 `skills/`。** 独立版 `read_skill` 读的是 `apps/server/skills/`
   （`paths.ts` 的 `workshopSkillsDirOf` + `build-exe.mjs` 的打包清单），仓库根 `skills/galgame-audio/`
   是**写给人看的副本**，与 `apps/server/skills/galgame-audio/` **内容不一致**（11840 B vs 9807 B）；
   `scripts/check-agent-contract.mjs:279` 把 `skills/galgame-audio` 明确列为 `KNOWN_NON_SKILL`。
   所以技能比对以 `apps/server/skills/` 为准（4 份：audio / bgm / play-setup / visual-craft）。
2. **独立版没有「搭台助手」这个词**，对应物是**工坊**（workshop）：`apps/server/src/workshop.ts` 的
   `buildWorkshopPrompt`。它不在你给的文件清单里，但第 1 题要的「搭台助手那边」只能对到它。

另外两仓都维护了一份**跨宿主契约**：`srv:apps/server/src/agentkit/contract.ts` 的 `CAPABILITY_MATRIX`
（15 条，逐条写 `equivalence` 与 `intentionalDifference`）。本报告与它交叉验证过，结论一致。

---

## 1. 逐段对照表

### 1.1 剧作家 system prompt

srv 的装配函数是 `apps/server/src/prompt.ts` 的 `buildSystemPrompt`（L490–509）；
plug 的正文分两半：静态 `PLAYWRITER_PROMPT`（`src/playwriter/prompt.ts` L243–248，进 persona.prefix）
+ 动态 A 区（`src/play/play-context.ts`）+ 静态尾段 `playwriterTail`（prompt.ts L283–294，order 200）。

| # | 段名 | srv 位置（文件:行） | plug 位置（文件:行） | 关系 |
|---|---|---|---|---|
| 1 | 角色开场 ROLE_INTRO | `prompt.ts:108-110` | `playwriter/prompt.ts:19-21` | 仅措辞小改（首行、末行逐字相同；中间 1 行改词） |
| 2 | 剧本语言 | `prompt.ts:128-136`（`scriptLanguageSection`） | `play/play-context.ts:90-94` | 结构性分叉（同义重排；srv 条件成段，plug 在快照里拼） |
| 3 | 工作循环 HOW_I_WORK | `prompt.ts:113-120` | `prompt.ts:37-45` | 结构性分叉（2 处逐字相同片段；停止点机制不同 + plug 加并发段） |
| 4 | 剧目在哪 WHERE_THE_PLAY_IS | — | `prompt.ts:24-34` | **只有 plug 有** |
| 5 | 剧目文件 PLAY_FILES | —（内容散落在 skill `galgame-play-setup` §三） | `play/play-files.ts:11-79` | **只有 plug 有**（srv 对等物在 skill 里，且字段表不同） |
| 6 | 剧目设定（premise） | `prompt.ts:494-496`（模板行） | `play-context.ts:96-101` | 结构性分叉（章标题同、空值兜底不同） |
| 7 | 角色表 | `prompt.ts:498-500` + 渲染器 L364-434 | `play-context.ts:184-241` | 结构性分叉（模板重写；plug 无在场/折叠分级，恒全卡） |
| 8 | 台上其它主体 | `prompt.ts:414-423` | `play-context.ts:228-238` | 仅措辞小改（标题逐字相同，尾句微调） |
| 9 | 素材清单 | `prompt.ts:436-458` | `play-context.ts:251-274` | 结构性分叉（类目标题逐字相同；plug 去掉 `LIBRARY_REF`、加空清单兜底） |
| 10 | 配乐与音效编配规则 AUDIO_RULES | `prompt.ts:25-37` | `play-context.ts:283-294` | 仅措辞小改（3 处片段逐字相同；plug 末条改为「只挑清单里真有的」） |
| 11 | 已生成的图 | `prompt.ts:441-446` | — | **只有 srv 有**（plug 的台账思路不同：候选 + `import_asset`） |
| 12 | 引用即导入 LIBRARY_REF | `prompt.ts:46-56` | — | **只有 srv 有**（plug 的 `library` 恒假，`contract.ts` 记为 intentional-difference） |
| 13 | 写作参数 | `craftParams.ts:91-103` | `play/craft.ts:76-88` | **正文逐字相同，除停止点一行**（见 1.3） |
| 14 | 创作口径 craft.md | `prompt.ts:467-468` | `play-context.ts:103-106` | 结构性分叉（srv 原样注入；plug 在参数后追加一行「想改就 edit 这一格」） |
| 15 | 限制级 NSFW | `prompt.ts:470-476` | — | **只有 srv 有**（plug 无 NSFW 通道，`contract.ts` 记为 intentional-difference） |
| 16 | 记忆索引 | `prompt.ts:477-488` | `play-context.ts:304-311` | 结构性分叉（标题与行模板逐字相同；尾部指路不同：`read_memory_detail`/`search_archive` vs `read`） |
| 17 | 剧本格式 FORMAT_RULES | `prompt.ts:139-250` | `prompt.ts:48-129` | **混合**：6 个逐字块（合计约 1243 字）+ 5 处分叉（fx / title / 结束轮） |
| 18 | 结局与多周目 ENDING_RULES | — | `prompt.ts:141-165` | **只有 plug 有**（srv 侧 `@aivn/core` 已解析 `<ending>`，但提示词不教） |
| 19 | 缺图/出图 IMAGE_POINTER | `prompt.ts:519-540`（`imageChapter`） | `prompt.ts:265-273` | 结构性分叉（都按 `can.image` 门控；srv 讲工具用法，plug 只留取舍 + 指向 skill） |
| 20 | 记忆卡 MEMORY_RULES | `prompt.ts:318-330` | `prompt.ts:173-196` | **混合**：3 个逐字块（约 267 字）+ plug 追加《世界状态》一节 |
| 21 | 引入新角色 | `prompt.ts:259-309`（`newCharacterRules`） | `prompt.ts:205-209`（`NEW_CHARACTER_POINTER`） | 结构性分叉（srv 三步全文 + `can.characters` 门控；plug 只剩一句指针，正文下沉到 skill） |
| 22 | 联网检索 SEARCH_GUIDE | `agentkit/searchTool.ts:22-33` | `stagehand/prompt.ts:115-119` | 结构性分叉（只有标题与空行相同；plug 是缩写版） |
| 23 | 演出契约 CONTRACT_RULES | `prompt.ts:333-347` | `prompt.ts:212-232` | **混合**：章首+第 1、2 条与第 4 条逐字相同；第 3、5、6 条重写，plug 多第 7 条 |

### 1.2 搭台助手（工坊）system prompt

srv 装配：`apps/server/src/workshop.ts:135-163` `buildWorkshopPrompt`；
plug 装配：`src/stagehand/prompt.ts:142-173`（static/guide/整份）+ `src/stagehand/context.ts:103-128`（注入段）。

| # | 段名 | srv 位置 | plug 位置 | 关系 |
|---|---|---|---|---|
| 1 | 身份（搭台者 / 搭台助手） | `workshop.ts:137` | `stagehand/prompt.ts:27-41` | 仅措辞小改（同一句主干；plug 并入《剧目在哪》） |
| 2 | 剧本语言提示 | `workshop.ts:171-174` | `stagehand/context.ts:39-42` | 结构性分叉（同义；srv 在 prompt 里现拼，plug 走注入段） |
| 3 | 职责边界 | `workshop.ts:59-76` | `stagehand/prompt.ts:47-55` | 结构性分叉（srv 按 `can.files` 两支；plug 写口恒在，加「演出的事你看不到」） |
| 4 | 对话风格 | `workshop.ts:84-96` | `stagehand/prompt.ts:65-76` | 仅措辞小改（≈同义；plug 加「独立工具调用放同一批」、去 AIVN 界面语汇） |
| 5 | 设定流程（指针） | `workshop.ts:187-201` | `stagehand/prompt.ts:40-41`（并入身份） | 结构性分叉（都指向 skill；plug 更短且无审批分支） |
| 6 | 出图要点 | `workshop.ts:146-149` + `imageGuide:309-328` / `NO_IMAGE_GUIDE:99` / `IMAGE_BASICS:102-110` | `stagehand/prompt.ts:87-105`（`assetGuide`） | 结构性分叉（srv 讲草稿/`commit_asset` 三段式；plug 讲 `generate_asset`/候选） |
| 7 | 剧目写作要点 | `workshop.ts:229-251` | — | **只有 srv 有**（plug 已下沉到 skill `aivn-play-setup`） |
| 8 | 命令行 bash | `workshop.ts:288-299` | `stagehand/prompt.ts:108-112` | 结构性分叉（同义重写；srv 列白名单，plug 只说「bash 不受限」） |
| 9 | 联网检索 | `workshop.ts:154`（`SEARCH_GUIDE`） | `stagehand/prompt.ts:115-119` | 结构性分叉（同左 1.1 #22） |
| 10 | 读故事树 | `workshop.ts:113-132`（`lineageGuide`） | — | **只有 srv 有**（plug 换成职责边界里一句「演出的事你看不到」） |
| 11 | 配乐（generate_bgm） | skill `galgame-bgm` + `musicTool` 描述 | `stagehand/prompt.ts:122-126`（`MUSIC`，`can.music`） | **只有 plug 有成章**（srv 的做法在 skill，不占 prompt） |
| 12 | 技能库指针 | `workshop.ts:151`（清单）+ `setupFlow`/`writingPoints` 里的 `read_skill` 指路 | `stagehand/prompt.ts:129-134`（`SKILLS`） | 结构性分叉（投放机制不同，见 §4.2） |
| 13 | 技能清单块 | `workshop.ts:136,151`（`skillsPrompt()`） | —（宿主注入 `available_skills`） | 结构性分叉（同为 name+description，来源不同） |
| 14 | 当前状态 | `workshop.ts:157-162` + `renderReadiness`（`agentkit/readiness.ts:4-12`） | `stagehand/context.ts:37-49` + `play/readiness.ts:76-93` | 结构性分叉（章名相同；plug 多主题皮肤行 + 素材对账 + 总数上限 200） |
| 15 | 会话摘要回注 | `workshop.ts:254-257`（`digestSection`） | — | **只有 srv 有**（DSH 自带会话压缩） |
| 16 | 自定义段 | `workshop.ts:276-280`（`customSection`） | — | **只有 srv 有**（`play.json agents.workshop.prompt`） |
| 17 | 音色提示 | `workshop.ts:209-219`（`voicePickHint`） | —（并入 skill `aivn-play-setup` §二） | **只有 srv 有**成段 |

### 1.3 逐字相同的段落（含字数与行号）

字数 = 该段正文（含段内换行）的字符数，已剥掉 `const X = \`` 声明与结尾反引号。

**剧作家侧**

| 段 | srv 行号 | plug 行号 | 行数 | 字数 |
|---|---|---|---|---|
| ROLE_INTRO 首行 | `prompt.ts:108` | `playwriter/prompt.ts:19` | 1 | 43 |
| ROLE_INTRO 末行 | `prompt.ts:110` | `playwriter/prompt.ts:21` | 1 | 27 |
| HOW_I_WORK 章标题 | `prompt.ts:113-114` | `prompt.ts:37-38` | 2 | 8 |
| HOW_I_WORK「停止点是出口…」 | `prompt.ts:118-119` | `prompt.ts:41-42` | 2 | 38 |
| FORMAT_RULES 章标题+引言+场景章标题 | `prompt.ts:139-144` | `prompt.ts:48-53` | 6 | 87 |
| FORMAT_RULES `<actor …/>` 行 | `prompt.ts:147` | `prompt.ts:56` | 1 | 67 |
| FORMAT_RULES `<sfx>`+`<cg>` | `prompt.ts:149-150` | `prompt.ts:57-58` | 2 | 61 |
| **FORMAT_RULES：位置说明 + 立绘四属性表 + 台上同权 + 取景体量 + 行为词表** | `prompt.ts:156-192` | `prompt.ts:59-95` | **37** | **886** |
| FORMAT_RULES 台词三类（say/narrate/thought） | `prompt.ts:212-216` | `prompt.ts:97-101` | 5 | 104 |
| FORMAT_RULES 注释章 | `prompt.ts:233-236` | `prompt.ts:102-105` | 4 | 38 |
| MEMORY_RULES 章标题+首句 | `prompt.ts:318-320` | `prompt.ts:173-175` | 3 | 92 |
| MEMORY_RULES write 范例 + 「改既有卡先 read」 | `prompt.ts:323-326` | `prompt.ts:177-180` | 4 | 142 |
| MEMORY_RULES「写具体可用的设定…」 | `prompt.ts:328` | `prompt.ts:181` | 1 | 33 |
| CONTRACT_RULES 章标题+章首段+第 1、2 条 | `prompt.ts:333-339` | `prompt.ts:212-218` | 7 | 187 |
| CONTRACT_RULES 第 4 条（OOC 语义） | `prompt.ts:342-343` | `prompt.ts:222-223` | 2 | 75 |

剧作家侧逐字相同的正文合计约 **1848 字 / 71 行**，其中单块最大的就是 FORMAT_RULES 的 37 行 886 字。

**写作参数（`renderCraftParams`）**：`craftParams.ts:91-103` 与 `play/craft.ts:76-88`
在「归一化空白与引号」后 **13/13 行全部等价**；其中
`BEAT_LENGTH_LABEL`/`BEAT_LENGTH_DIRECTIVE`（srv `craftParams.ts:28-38` / plug `craft.ts:45-55`）
**5/5 行逐字相同**；`backgroundDirective`/`cgDirective`/`audioDirective` 也逐字相同。
**唯一实质差异是停止点那 4 行**：

- srv `craftParams.ts:46-51`：`有停止点时给 2 条互斥选项：beat_done(options=["…", "…"])。` …
- plug `craft.ts:63-68`：`有停止点时给 2 条互斥选项：<stop options="… | …"/>。` …

另有两处无害改词（`角色表里已有的差分` → `角色已有的差分`，`noImage()` 与 `spriteDirective('off')` 各一处）。

**A 区各段（角色表 / 素材清单 / 记忆索引 / 状态区）**：代码级模板重写，**没有任何一行正文逐字相同**
（唯一逐字相同的只是类目字符串与其外壳模板：`可用背景 bg`/`可用音乐 bgm`/`可用音效 sfx`/`已有插图 cg`
四个 heading 常量 + 共用的 `` `\n# ${heading}\n\n…` `` 外壳；`# 记忆索引（按需查详情）`、
`# 台上其它主体（有立绘，没有角色卡）`、`# 写作参数（本剧目设定，照它写）` 这三个整标题；
以及 `差分 variant：` 这个行内标签）。

---

## 2. 装配机制

### 2.1 独立版（纯常量 + 模板函数 + 能力位门控）

- **形态**：`prompt.ts` 里全是 `const X = \`…\`` 纯字符串常量；唯一的模板函数是
  `scriptLanguageSection()`、`newCharacterRules(canCharacters)`、`imageChapter(can)`，
  以及 `buildSystemPrompt(ctx)` 把 20 来个常量 + 动态渲染按固定顺序插进一个 template literal
  （`prompt.ts:490-509`）。
- **装配时机**：`orchestrator.ts:612-665` 的 `buildAgent()`（`buildSystemPrompt` 调用在 L625）
  把它塞进 pi `Agent.initialState.systemPrompt`；
  A 区在**一个纪元内冻结**，改了设定/口径就重建 Agent（`orchestrator.ts:295` 注释、`:724`）。
  工坊更彻底：`workshopSession.ts:578-585` **每一轮**都 `buildWorkshopPrompt` 一次，喂给新建的 pi Agent。
- **门控**：全部走 `kit.can`（`agentkit/kit.ts` 的 `AgentCapabilities`），逐章判 bool：
  `can.image` 门 `imageChapter`、`can.search` 门 `SEARCH_GUIDE`、`can.memory` 门 `MEMORY_RULES` 尾句、
  `can.characters` 门 `newCharacterRules` 第 1 步、`can.library` 门 `LIBRARY_REF`、
  `can.nsfw` 门 NSFW 章。工坊侧另加 `can.files` / `can.shell` / `can.voice` / `can.lineage` / `can.skill`。
- **A 区由谁渲染**：全在 `buildSystemPrompt` 内部（`prompt.ts:349-488`）：
  角色表 = 角色卡目录 + `spriteIdOf`/`variantsOf` + `describeAsset`（`@aivn/core`）；
  素材清单 = `ctx.assets`（`store.listAssets` 的 `keys: backgrounds/cg/sfx/bgm/sprites/<主体id>`）；
  记忆索引 = `memory.visibleContext()`（`memory.ts:88`，三层 `always/index/archive`）；
  写作参数 = `renderCraftParams(resolveCraft(play.craft), can)`；
  状态 = `renderStateSection()`（B 区，走 user 消息，见下）。
- **B 区（user 消息）**：`orchestrator.ts:1690-1720` 的 `renderPromptTurn` 拼
  `【状态】\n{renderStateSection(...)}` + 若干 `【用户输入】\n{text}` + 两句括注兜底。
  引擎自己补的话还有 `BEAT_DONE_NUDGE`（`orchestrator.ts:79-82`）、`NSFW_PRE_TURNS`（`:127-155`）、
  解析告警回灌 `renderBeatWarnings`（`:110-124`）。

### 2.2 DSH 插件（persona.prefix 烘焙 + section order 注册 + context 快照）

- **三段投放点**（都来自 `@deepseek-ai/dsh-system-prompt`）：
  1. `persona.prefix` —— `src/playwriter/preset.ts:48-51` 把 `PLAYWRITER_PROMPT` /
     `stagehandStatic()` 交给 `@deepseek-ai/dsh-persona`，**装载时烘焙成静态文本**（改了要重挂预设）；
  2. `systemPrompt.section({name, order, text})` —— `play-context.ts:140-156` 注册 A 区 8 段 + 尾段，
     `text` 是**函数**，每次组装现读，`order` 排序见 `play-context.ts:45-54`
     （language 100 / premise 110 / cast 120 / assets 130 / craft 140 / memory 150 / endings 160 /
     tail 200）；搭台助手是 language 100 / state 120（`stagehand/context.ts:30`）；
  3. `systemPrompt.context({…})` —— `play-context.ts:155` 把【状态】物化成 **user 角色快照**
     （等价独立版的 B 区，但走正规段位而不是自己拼 user 消息）。
- **门控**：`src/capabilities.ts:17-48` 的 `Capabilities`（`shell`/`voice`/`search`/`image`/`music`），
  由**插件配置**（shell 开关、Fish key、Exa key、生图/音乐后端 baseUrl+model）在装载时算定，
  与 AIVN 的逐剧目 `agents.<role>.capabilities` 不同。`files`/`skill`/`view`/`readiness` 恒真、
  `library`/`lineage` 恒假——**假的那两位在 persona 里根本不存在对应章**（不是「关掉」，是没有）。
  工具面门控另有一份：`src/tool-catalog.ts:14-27` 的 `ToolGate` + `gateSatisfied`，
  `src/preset-tools.ts` 据此决定装不装工具；提示词的门控章与工具门控是**两套手动对齐**的开关。
- **A 区由谁渲染**：`play/play-context.ts` 的 `readPlaySnapshot()`（L80-118）
  现场同步读盘（`loadPlaySync` / `listAssets` / `readManifest` / `readCharacterCards`），
  按 `TTL_MS=1000` 缓存一个 turn。渲染器：`renderCast` L184-241、`renderAssets` L251-274、
  `renderMemoryIndex` L304-311、`renderEndings` L401-428、`renderState` L351-389；
  写作参数 `play/craft.ts` 的 `renderCraftParams`。搭台助手的状态渲染在
  `stagehand/context.ts:37-49`（文件清单 `renderListing` L70-80 + 皮肤 `renderTheme` L57-67
  + `renderReadiness`）。
- **`{{cwd}}` 是宿主变量**：`play-files.ts:13`、`playwriter/prompt.ts:26`、`stagehand/prompt.ts:33`
  三处的 `{{cwd}}` 由 DSH 的 `dsh-system-prompt` 做**严格** `{{variable}}` 插值（未知变量会抛错）。

### 2.3 A 区两边长什么样（模板对照）

| A 区段 | 独立版模板 | 插件模板 |
|---|---|---|
| 剧本语言 | `# 剧本语言\n\n正文、旁白、选项…一律用{label}写…`（`prompt.ts:130-135`） | 同义，`play-context.ts:91-93` |
| 剧目设定 | `# 剧目设定\n\n{premise}`（`prompt.ts:494-496`，空则整段留白） | `# 剧目设定\n\n{premise}`，空则 `（这份剧目还没有写世界观前提。自由发挥即可…）`（L96-101） |
| 角色表 | `### {name}（id: {id}，卡片 {characterCardPath(id)}[，玩家扮演]）\n{body}\n音色：…\n立绘[（目录 x）]差分 variant：a \| b` + 折叠名册（≥5 人时不在场只留一行摘要，`CAST_SUMMARY_CHARS=100`）+ `# 台上其它主体`（`prompt.ts:382-423`） | 同一形状，**无分级、恒全卡**；标题里路径硬编码 `characters/{id}.md`；尾部加一句「卡是 frontmatter + 正文两段…」+ 空卡兜底（`play-context.ts:204-240`） |
| 素材清单 | `# 可用背景 bg` / `# 可用音乐 bgm` / `# 可用音效 sfx` / AUDIO_RULES / `# 已有插图 cg` / `# 已生成的图` / LIBRARY_REF（`prompt.ts:450-458`） | 同四类目 + AUDIO_RULES，**无**「已生成的图」与 LIBRARY_REF，加空清单兜底与 `assets/` 途径说明（`play-context.ts:264-273`） |
| 写作参数 | `\n# 写作参数（本剧目设定，照它写）\n\n- 一轮篇幅：…\n- 停止点：…\n- 素材来源：\n  - 背景：…`（`craftParams.ts:91-103`） | **同一份模板**，只有停止点一行换成 `<stop …>` 语法（`craft.ts:76-88`） |
| 记忆索引 | `# 记忆索引（按需查详情）\n\n- [层] 名（路径）：摘要…` + 尾部按 `can.memory` 两支（`prompt.ts:481-488`） | 同一标题与行模板，尾部固定「read 它的路径」（`play-context.ts:307-310`）；**无** archive/layer 语义 |
| 状态 | user 消息 `【状态】\n场景：…\n好感度：…\n旗标：…\n进度：第 N 轮\n场景细节：…\n活跃剧情线：…`（`prompt.ts:543-562`） | user 角色快照 `【状态】\n场景：…\n好感度：…\n旗标：…\n活跃剧情线：…` + 「状态就是上面三个文件，由你自己写」（`play-context.ts:378-389`）；**无**进度轮次、来源是剧作家自己写的三个文件 |
| 结局/多周目 | —（`@aivn/core` 的 `config.ts:249` 注释说引擎会注入，实际 `prompt.ts` 未实现） | `# 此前已达成的结局`（`play-context.ts:422-427`），`newGamePlus && 账本非空` 才出 |

---

## 3. 宿主专有夹带（抽包必须参数化的清单）

### 3.1 独立版专有

| 专有物 | 类型 | 出现在哪些段（行号） |
|---|---|---|
| `beat_done(options=[…] / placeholder=…)` | pi 工具名 | HOW_I_WORK `prompt.ts:115`；FORMAT_RULES《结束轮》L239-250；写作参数 `craftParams.ts:47-50`；MEMORY_RULES L329（`update_state`）；契约 L344 |
| `update_state` | pi 工具名 | FORMAT 结束轮 L248、MEMORY_RULES L329 |
| `enter_nsfw` / `exit_nsfw` | pi 工具名 | NSFW 章 `prompt.ts:470-476` |
| `read_memory_detail` / `search_archive` | pi 工具名 | 记忆索引尾句 L485 |
| `list_library` | pi 工具名 | LIBRARY_REF L53 |
| `generate_image(kind=…, spriteId=…, framing=…, stature=…)` | 工具名 + 参数形状 | 引入新角色 L293-300；出图章 L525-539；写作参数 L132 等 |
| `write` / `edit` / `read` 的**具名参数**（`write(path=…, content=…)`） | pi 工具签名 | 引入新角色 L264、记忆卡 L324、音乐… |
| 「管理角色」能力名（Agent 页开关） | 能力位开关名 | `newCharacterRules` L255、L284 |
| 「工坊 / Agent 页 / 素材页 / 剧目页 / 记忆页」 | AIVN 界面语汇 | L274、L284、L486 |
| `<fx effect="…" trigger\|on\|off value="…"/>` 与《舞台效果（fx）》整章 | DSL 段 | FORMAT_RULES L148、L193-210 |
| `<title align mode>` 与《全屏标题卡》整章 | DSL 段 | FORMAT_RULES L217-232 |
| 纯色场 `bg="black"` / `#1a1a2e` | DSL 取值 | FORMAT_RULES L152-155 |
| `play.json` 字段：`scriptLanguage` / `voiceLanguage` | 剧目字段 | 剧本语言章 L123-126 |
| `memory/always/` `memory/archive/`（引擎产物不可写） | 路径约定 | MEMORY_RULES L330 |
| 「未作回应」提示语 | 引擎 user 消息壳 | 契约第 5 条 L344 + `orchestrator.ts:1707-1711` |
| `beat_done` 收束追话 `BEAT_DONE_NUDGE` | 引擎 user 消息 | `orchestrator.ts:79-82`（**不在 system prompt 里**） |
| `README`/`AGENTS.md` 语境下无 DSH 词 | — | srv 正文里**没有** `DSH` / `<stop>` / `<ending>` / `{{cwd}}` |

### 3.2 DSH 插件专有

| 专有物 | 类型 | 出现在哪些段（行号） |
|---|---|---|
| `<stop options="甲 \| 乙"/>` / `<stop placeholder=…/>` / `<stop/>` | 剧本标签（=停止点） | HOW_I_WORK `prompt.ts:39`；FORMAT 结束轮 L108-129；写作参数 `craft.ts:64-67`；契约第 5 条 L224 |
| `<ending id name subtitle summary/>` | 剧本标签 | FORMAT L116 指针、ENDING_RULES L141-165、契约无 |
| `validate_play` | DSH 工具名 | MEMORY_RULES L196；搭台职责 L52 |
| `generate_asset` / `cut` / `import_asset` | DSH 工具名 | IMAGE_POINTER L265-273；skill 正文 |
| `skill` 工具 + 技能名 `aivn-play-setup` / `aivn-visual-craft` / `aivn-audio` | DSH 概念 | NEW_CHARACTER_POINTER L207-209；IMAGE_POINTER L267；搭台 `MUSIC` L124、`SKILLS` L132-133 |
| `{{cwd}}` | 宿主模板变量（严格插值） | `play-files.ts:13`、`prompt.ts:26`、`stagehand/prompt.ts:33` |
| `/new-play 剧目名` 斜杠命令 | DSH 命令 | WHERE_THE_PLAY_IS L34；搭台 IDENTITY L37 |
| `play.json` 字段：`newGamePlus` / `opening` / `craft` / `image` / `agents` | 剧目字段 | WHERE_THE_PLAY_IS L33；PLAY_FILES L27-39；ENDING_RULES L163 |
| `endings.json`（工作区根账本） | 路径约定 | ENDING_RULES L164；PLAY_FILES L23 |
| `memory/always/state/{scene.md,threads.md,state.json}` | **新的**状态路径约定 | MEMORY_RULES L184-196；契约第 3 条 L219-220；`play-context.ts:352` |
| 能力位开关名 `can.image` / `can.music` / `can.shell` / `can.search` | 插件配置能力位 | `playwriterTail({image})` L283；搭台 `assetGuide`/`MUSIC`/`SHELL`/`SEARCH` |
| 「DSH 的分支 / 新会话」（终局出口） | DSH 概念 | ENDING_RULES L160-161 |
| `<option>…</option>` / `<stop type="choice">`（作废旧写法） | DSH 兼容提示 | FORMAT L126 |
| `assets/manifest.json` 的 `framing`/`stature`/`title` 字段 | 素材表字段 | PLAY_FILES L72-79 |
| 无 `beat_done` / `enter_nsfw` / `update_state` / `read_memory_detail` / `list_library` / `<fx>` | pi 概念 | 插件正文里**一个都没有**（已验证） |
| `<title>` 的**语法章**（align / mode / 与纯色场配合）被整章删除 | DSL 段 | FORMAT_RULES 删掉了《全屏标题卡》整章；但 `<title>` 这个名字仍在 ENDING_RULES 里被当作已知标签引用（`prompt.ts:159`）——属于「删了规范、留了引用」的悬空点 |

**结论性观察**：两边的「宿主专有夹带」几乎是互补集合——srv 的夹带 = pi 工具名 + NSFW + 应用级素材库 +
fx/title 演出标签；plug 的夹带 = 剧本停止点/结局标签 + DSH 技能与命令 + 状态文件约定。
**停止点/状态这两处是唯一同时改动正文与 A 区渲染的地方**（`craftParams` 与 `renderStateSection`
各有一条语法级分叉），其余夹带都落在可替换的整章里。

---

## 4. 技能正文

### 4.1 逐文件比对

srv 活目录 `apps/server/skills/`（4 份）vs plug `skills/`（3 份）。
下表「逐字行重合率」= 去空行后两边**完全相同**的行数 ÷ 较短一边行数。

| srv 文件 | 字节 | plug 文件 | 字节 | 有无对应物 | 逐字重合率 | 判断 |
|---|---|---|---|---|---|---|
| `galgame-audio/SKILL.md` | 9807 | `aivn-audio/SKILL.md` | 9625 | 有 | **86%**（87/108） | **同一份内容的 fork**：frontmatter `name`、引言、`generate_bgm` 段（srv 后台排产 84 s vs plug 同步等待）、落地红线多 3 条（OpenTracks/平台锁定源/来源留档） |
| `galgame-bgm/SKILL.md` | 10894 | —（内容缩进 `aivn-audio` §8.5） | — | **无独立对应物** | 1% | srv 独立成篇（10 节：配器/情绪词/循环/声明值/反例词/词表对齐）；plug 只留 4 行「怎么写」指针 + 指向自身 §8.5 |
| `galgame-play-setup/SKILL.md` | 8563 | `aivn-play-setup/SKILL.md` | 7518 | 有 | **3%**（2/71） | **同题重写**：description 逐字相同、章节标题不同（四步走→四步流程）；plug 去掉 `set_craft`/`voiceLanguage`/`cover`/`agents` 字段与改文件能力分支，加 craft 取值表与「演出中引入新主体」 |
| `galgame-visual-craft/SKILL.md` | 17462 | `aivn-visual-craft/SKILL.md` | 13732 | 有 | **9%**（12/150） | **重写 + 收窄**：srv 有完整提示词工艺（四条铁律、体型量化、两个社团配方、模型选型、抠底调参、差分命名、背景/CG 构图、场景清单）；plug 保留铁律/画风锚点/外形锚定/cookbook/图单/差分/入库/自查，标题更短 |

- frontmatter 差异：srv 四份都带 `user-invocable: true`，plug 三份都**没有**（DSH 宿主不认这个键）。
- `description` 字段：`galgame-audio` 与 `aivn-audio` **逐字相同**；`galgame-play-setup` 与
  `aivn-play-setup` **逐字相同**；`galgame-visual-craft` 与 `aivn-visual-craft` **不同**（plug 版指名
  「一键出图 / 候选挑图 / 外部图登记」，srv 版讲「纯色键底 / neutral 垫图 / 抠底调参」）。
  —— description 恒列进清单，所以这两对逐字相同意味着**改名时两处必须同改**。

### 4.2 两边怎么把技能喂给模型

| | 独立版 | 插件 |
|---|---|---|
| 载体 | `apps/server/skills/<name>/SKILL.md` | `<package>/skills/<name>/SKILL.md` |
| 加载 | `skills.ts` 用 pi `loadSkills(env, SKILLS_DIR, BACKGROUND_CONTEXT)`，进程内 `cache` 一次 | 由 `src/playwriter/preset.ts:27-32,79-82` 把插件 skills 目录挂成 `isolate: { skills: true }` 的 realm；宿主扫目录 |
| 清单 | `formatSkillsForSystemPrompt(skills)` → **拼进工坊 system prompt**（`workshop.ts:136,151`），只给 name/description/路径 | 宿主把 name+description 恒列成一条 `available_skills` 上下文消息（**不进 persona 正文**） |
| 读全文 | 工具 `read_skill(name)`（`skills.ts:readSkill`），名字不在清单里就报错并列出可选 | 宿主 `skill` 工具（`dsh-skill` 行，在 isolate realm 里） |
| 可见范围 | 只有工坊有（剧作家 kit 里没有 `read_skill`） | **两个预设都装**（剧作家单飞也要备料） |
| 恒列 vs 按需 | 清单恒列、正文按需 `read_skill` | 清单恒列、正文按需 `skill` |
| 生效条件 | 改 markdown 即生效（进程内 cache 需重启进程） | 改 markdown 即生效（宿主每轮扫） |

**重要事实**：srv 的**剧作家拿不到技能**（`read_skill` 是 workshop 工具），而 plug 的**剧作家有技能库**
——这正是 plug 敢把《引入新角色》《缺图怎么办》的正文下沉到 skill、正文只留指针的结构前提。
抽包时「正文放 skill 还是放 prompt」不能统一，得由宿主声明「本 agent 能不能读 skill」。

---

## 5. 结论：最可行的切法

### 5.1 可以直接抽成包里的一份文本（逐字或近逐字，无需宿主改写）

按「可直接复用」从高到低：

1. **舞台 DSL 词典块（最大一块，≈886 字 / 37 行）** —— 位置说明、立绘四属性表、台上同权、
   取景体量与 anchor、行为词表。纯领域语法，与宿主零耦合。srv `prompt.ts:156-192` =
   plug `prompt.ts:59-95`。
2. **台词标签块** `<say>/<narrate>/<thought>`（104 字）与 `<scene>/<actor>/<sfx>/<cg>` 示例行
   （67+61 字）。
3. **注释章 `<comment>`**（38 字）。
4. **写作参数渲染器 `renderCraftParams`**（13 行模板 + 篇幅/素材来源的措辞表）——
   只差停止点 4 行，参数化后完全共用。
5. **记忆卡规范**（标题+首句 92 字、`write` 范例+「改既有卡先 read」142 字、「写具体可用的设定」33 字）
   —— plug 在此之上追加《世界状态》，是纯增量。
6. **演出契约的前 7 行（章首+第 1、2 条，187 字）+ 第 4 条 OOC 语义（75 字）**。
7. **配乐与音效编配规则 AUDIO_RULES** —— 主体 5 行逐字相同，末条措辞不同（可参数化成「素材来源措辞」）。
8. **技能正文 `aivn-audio` ↔ `galgame-audio`** —— 已达 86% 行重合，收敛到一份后靠
   `generate_bgm` 那一段的分支参数（后台排产 vs 同步等待）区分。
9. **A 区类目标题与行模板**（`# 可用背景 bg` 等 8 个字符串 + `- {id}（{detail}）`、
   `# 记忆索引（按需查详情）` + `- [层] 名（路径）：摘要`）—— 字符串级可共用，模板代码需各自实现。

### 5.2 必须由宿主传入（参数化清单）

**A. 停止点 / 收束机制（最硬的一处）**

| 参数 | srv | plug |
|---|---|---|
| 停止点载体 | 工具 `beat_done` | 剧本标签 `<stop …/>` |
| 语法文本 | `beat_done(options=["…","…"])` / `(placeholder="…")` / `()` | `<stop options="… \| …"/>` / `<stop placeholder="…"/>` / `<stop/>` |
| 写作参数停止点行 | `craftParams.ts:47-50` | `craft.ts:64-67` |
| 契约/格式里的收束段 | FORMAT L239-250 | FORMAT L108-129 |
| 契约的「玩家按继续」语义 | 无（走「未作回应」注） | 契约第 5 条后段 |

**B. 世界状态来源**

| 参数 | srv | plug |
|---|---|---|
| 状态真相源 | 引擎 `EngineStateSnapshot` + 谱系快照 | `memory/always/state/{scene.md,threads.md,state.json}` |
| 谁渲染 | `renderStateSection` 走 **user 消息** | `renderState` 走 `systemPrompt.context` |
| 含「进度：第 N 轮」 | 有 | 无 |
| 好感度/旗标写入方式 | 工具 `update_state` | 剧作家自己 write/edit 三个文件 |

**C. 能力位名与门控协议**：srv `AgentCapabilities`（image/search/memory/characters/nsfw/library/shell/
voice/lineage/skill/files/view，逐剧目勾）vs plug `Capabilities`（shell/voice/search/image/music，
插件配置定）。共用章必须声明「本章依赖哪个能力位」，由宿主给 bool + 章的两支文案。
**必须参数化**的还有「门控章整章消失 vs 换措辞」两种策略（plug 的 `assetGuide` 是换措辞恒在，
`MUSIC`/`SHELL`/`SEARCH` 是消失）。

**D. 技能通道**：本 agent 有没有 skill 工具；技能清单怎么进 prompt（自己拼 vs 宿主注入）；
技能正文放 prompt 还是放 skill（plug 下沉、srv 内联）。→ 参数：`skills: { available: boolean; names: string[]; listing: 'self' | 'host' }`。

**E. 宿主标识与界面语汇**：`{{cwd}}` 变量名（DSH 严格插值，未知变量抛错）；斜杠命令 `/new-play`；
终局出口措辞（「DSH 的分支 / 新会话」）；AIVN 的「工坊 / Agent 页 / 素材页」↔ 插件的「搭台助手 / 舞台」；
`endings.json` 与 `memory/archive/` 这类路径约定。

**F. 剧目文件清单**：`play.json` 的字段面不同（srv 有 `voiceLanguage`/`defaultVoiceId`/`initialState`/
`cover`/`image`/`agents`；plug 有 `opening`/`newGamePlus`，且强调「还没有 play.json = 不是剧目」）。
PLAY_FILES 章要拆成「核心字段（id/title/opening/characters/scriptLanguage/initialScene/craft）」
+ 宿主扩展字段表。

**G. 平台专有工具名**：srv `beat_done/update_state/enter_nsfw/exit_nsfw/read_memory_detail/
search_archive/list_library/commit_asset/recut_sprite/get_readiness/view_image/read_skill`；
plug `validate_play/generate_asset/cut/import_asset/generate_bgm/list_voices/web_search/skill`。
共用的 `generate_image` / `write` / `edit` / `read` / `web_search` / `list_voices` 名字相同但**参数形状不同**
（srv `generate_image(kind="sprite", spriteId=…, framing=…, stature=…)`；plug 是候选 + `generate_asset` 一键）。

**H. NSFW 章（整章可选）**：srv 有 4 支文案（未开启入口 / 开启指引 / 剧目专属口径 / 用户补充提示词）+
`NSFW_PRE_TURNS` 合规前置轮；plug 完全没有 → 抽包时是 `optional chapter`。

### 5.3 「同一段在两个宿主本来就该不一样」的例子

1. **停止点的载体**（srv `<stop>`→`beat_done`，plug `beat_done`→`<stop>`）：两边都把对方的做法
   **故意**改回来过，理由是宿主机制不同——srv 要「工具 terminate 之后没有文本位置可写」来省掉
   「stop 之后别再说话」的提示词约束与解析器状态机（`agentkit/beatTool.ts:8-16`）；
   plug 要「轮尾重新落在助手消息上」，DSH 的「在新对话中分支」与舞台重建才可用
   （`dsh-aivn/AGENTS.md` 的停止点一节）。`contract.ts:37-47` 把这条记为
   `semantic-only` + `intentionalDifference`，两边 IR 同构。**这一处不能统一措辞，只能统一语义槽位。**
2. **A 区角色表的分级**：srv 角色 ≥5 且给了 `activeCast` 时，在场角色全卡、退场角色只留一行摘要
   （`prompt.ts:366-375`，`CAST_GRADING_MIN_SIZE=5`）；plug 明确**恒全卡**，
   「阶段 1 没有编排器给谁在场」（`play-context.ts:180-183`）。前者是 token 优化，后者是宿主没有
   「本轮在场角色」这个信号。**同一章该不该做分级，由宿主能否提供 activeCast 决定。**
3. **搭台助手的「读故事树」章**：srv 有周目/分支树，工坊可以 `list_saves`/`read_lineage` 查
   「某个角色出现过几次」（`workshop.ts:113-132`）；plug 没有周目与故事树（用户拍板不做），
   把它换成职责边界里一句「演出的事你看不到，别猜别编」（`stagehand/prompt.ts:54-55`）。
   **这是宿主能力差异，不是文案差异**——抽包时应把该章定为可插拔的宿主能力章。
   （另两处同类：srv 的《会话摘要回注》在 plug 交给 DSH 自带压缩；srv 的 LIBRARY_REF 在 plug 无对应能力。）

---

## 附：最小可行抽包切法（建议）

```
prompt-core/                       # 宿主无关的正文与渲染器
  dsl-format.md                    # 5.1 #1–3（≈1243 字逐字块）+ 宿主可插拔的 fx/title/停止点章
  craft-params.ts                  # renderCraftParams + 措辞表，停止点行由宿主注入
  memory-rules.md                  # 5.1 #5（+可插拔《世界状态》）
  audio-rules.md                   # 5.1 #7
  contract.md                      # 5.1 #6 + 可插拔第 3/5/6/7 条
  play-files.md                    # 拆「核心字段」+ 宿主扩展字段表
宿主注入面（一个 types-only 接口）
  stopSyntax / stateSource / capabilities / skills / hostWords / toolNames / extraChapters
```

三类东西**不要**进包：① 停止点、状态来源这种机制耦合段（只共享语义槽位）；
② NSFW、素材库、故事树这类宿主专有能力章（整章可选）；
③ 工具名与参数形状（归各自工具 DESCRIPTION，正文只留「何时用」）。
