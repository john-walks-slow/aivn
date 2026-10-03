# 角色卡顶层化、主角升格与工坊页签重划

需求日期：2026-10-04
分支：`refactor/workshop-layers`（worktree `.worktrees/workshop-layers`）

## 一、目标

三件事，都是同一件事的三个面：把「角色」从「记忆」里分出来，再把「主角」从「剧目设置」里分出来，最后让工坊页签按这个分层站队。

1. **角色卡从 `memory/` 里搬出来**，成为剧目目录的顶层 `characters/` —— 角色表是它自己的一个面，不再算记忆的一部分。
2. **主角升格成角色卡**：`characters/protagonist.md` 与别的卡同一形状，获得上台、立绘、配音的全部能力；是否上台、是否配音由剧目的创作口径（`craft.md`）定，引擎不预设。剧作家在角色表里读得到主角设定。
3. **工坊页签重划**：新开「剧目」页承载原先记忆页里的剧目卡；「设定与记忆」只剩剧目记忆并改名「记忆」。页序 对话 / **剧目** / 角色 / 记忆 / 素材 / 文件 / Agent / 设置。

改完三层各管一件事：**剧目页**说这部戏是什么（标题、开局、语音、封面），**角色页**说有谁（主角与全部角色，同一套卡），**记忆页**说剧作家每轮读到什么（世界与人物设定、创作口径、设定卡）。

## 二、新结构

### 剧目目录

```
plays/<id>/
├── play.json
├── characters/
│   ├── protagonist.md          ← 玩家扮演的角色（固定 id）
│   └── <id>.md                 ← 其余角色卡
├── memory/
│   ├── always/{premise,craft,nsfw}.md
│   ├── index/**                 （设定卡，子目录随意）
│   ├── arcs/  archive/          （机器产物）
├── assets/
│   ├── sprites/<角色id>/*.png  （立绘仍是素材，含 sprites/protagonist/）
│   └── …
├── theme.css
└── media-cache/ workshop/ saves/ active.json
```

`assets/sprites/` 不动：立绘是媒体，归素材层；上移的只有角色卡 markdown。

### 工坊页签（8 页）

| 序 | 页 | 内容 |
| --- | --- | --- |
| 1 | 对话 | 不变 |
| 2 | **剧目**（新） | 标题 / opening / 语音语言 / 无名角色音色 / 封面。保存写 `play.json` |
| 3 | 角色 | 主角卡 + 全部角色卡，走同一份编辑器；卡路径 `characters/<id>.md` |
| 4 | **记忆**（原「设定与记忆」） | 只剩 `memory/**`：世界与人物设定、创作口径、设定卡（`arcs/`、`archive/` 仍不进这一页） |
| 5 | 素材 | 不变 |
| 6 | 文件 | 不变；文件树里多出 `characters/`，可编辑 |
| 7 | Agent | 不变 |
| 8 | 设置 | 不变 |

## 三、主角升格：设计

### 现状

`play.json.protagonist: {name, persona}`，全仓只有一个消费者：`playhouse.polish()`（玩家输入润色的口吻依据）。它不在 cast 里，因而没有 A 区、没有立绘、没有音色；资源库导入到主角时还专门跳过立绘（`copyMedia = false`，理由注释写着「舞台只画 characters，protagonist 只供音色与润色」——其实连音色也没有，那句话是错的）。

### 设计

**主角 = `characters/protagonist.md`，id 固定为 `protagonist`。**

- **不引入 frontmatter 标记，用固定文件名**：`characters/` 的不变式是「角色表 = 那个目录的文件列表」，固定 id 让「谁是主角」不需要第二处声明，也不会出现两个主角或零个主角。DSL 里就是 `<actor id="protagonist">` / `<say id="protagonist">`。
- **能力与任何角色卡相同**：`name` / `voice` / `voiceId` / `framing` / `sprites` / `spriteFraming` / 正文，全部可用。上台、立绘、配音因此天然可用，不需要为它加任何引擎开关。
- **引擎不设「主角默认不上台」**：是否上台、是否配音是创作口径，按项目既有原则（2026-10-03 起引擎不自带任何创作口径）写进 `craft.md`。搭台助手的写作要点里加一条，让它在对齐时把这件事问出来。
- **主角只多一处标注**：A 区角色表里标「玩家扮演」。剧作家由此知道这个人的台词与决定来自【用户输入】（契约第 4 条已经这么规定，只是过去没有 id 可指）。
- **`play.json.protagonist` 与 `ProtagonistCard` 类型删除**，唯一真相源是那张卡。
- **输入润色改读这张卡**（`name` + 正文）。
- **资源库导入 `target=protagonist` 写这张卡，立绘照导**：删掉 `copyMedia = false` 那条特殊分支，主角与别的角色同一条路径。
- **新剧目建一张空的 `characters/protagonist.md`**，与 `premise.md` / `craft.md` 同一口径：留个位置让设定页有卡可编；空文件不进 cast（`loadCharacters` 本来就跳过空文件），写进内容才进 A 区。
- **UI 复用同一份编辑器**：主角卡不再是一段 bespoke 的双输入框，`CharacterEditor` 直接编它（名字 / 音色 / 人设 / 立绘差分 / 出图全一样）。它与别的卡唯一不同的地方是**不给删除**——玩家总在这个剧里，「没有主角」不是一个状态。

### 风险

主角进入 cast 之后，剧作家理论上可以替他编台词。契约第 4、5 条已经压住这件事（用户输入照字面演；「未作回应」时不许替玩家编造），A 区的「玩家扮演」标注是补强而不是新机制。

## 四、其他设计决定

1. **路径的唯一真相源收进 core**。`packages/core/src/play/characterCard.ts` 加导出：`CHARACTER_DIR = "characters"`、`PROTAGONIST_ID = "protagonist"`、`characterCardPath(id)`、`isProtagonist(id)`。服务端与 web 一律从它取（现在同一个字符串在 5 处各拼一次，正好借这次收敛）。
   服务端加 `PlayStore.characterDir()`，读目录的三处（readiness / `PlayMemory.load` / http cast）与写卡的一处（`writeCharacter`）全走它。

2. **PlayFiles 白名单加 `characters/`**：`isEditable` 允许 `characters/**` 的 `.md/.json/.txt`，`DIR_ROOTS` 加 `characters`（文件页才下钻得到、pi 的 read/write/edit 才进得来）。`play.json` 的结构校验与 `assets/` 只读都不动。

3. **记忆页与剧目页拆成两个组件**：
   - `SettingsPane.tsx` → **`MemoryPane.tsx`**：只读 `listFiles` + `memory/` 前缀过滤。删掉剧目卡、`draft`/`savePlay`、`CoverPicker`、音色库与 `listAssets` 依赖，顺带消掉「两个请求谁先回来」那类竞态。
   - 新增 **`PlayPane.tsx`**：剧目表单（标题 / opening / 语音语言 / 无名角色音色 / 封面）+ 保存，沿用 `.panel` + `.field` 与保存按钮的现成手感，不新造视觉。
   - 改名理由：页面叫「记忆」，组件却叫 `SettingsPane`，还和设置页的 `WorkshopSettings` 撞名。

4. **图标**：`ui/Icon.tsx` 加 `drama: Drama`（lucide）给「剧目」页，其余页图标不动。

5. **`play.json` 的 `characters` 元数据字段不动**（没有任何逻辑读它，与本次分层无关）。

## 五、用户路径

- **搭一部新戏**：工坊「剧目」页改标题/开局 → 「角色」页写主角（名字、人设，要配音就挑音色）→ 加 NPC 卡 → 「记忆」页写世界与人物设定、创作口径。每一步只在这一页里发生，不再需要在「设定与记忆」里翻半天。
- **想让主角上台/出声**：在「角色」页给主角卡配上立绘差分与音色，在「记忆」页的创作口径里写一句「主角上台并配音」；剧作家据此决定要不要写 `<actor id="protagonist">` 与 `<say id="protagonist">`。不写就藏在台后（和今天一样）。
- **从资源库拿一个现成角色当主角**：「角色」页主角卡上的「从资源库导入主角卡」，导入后卡与人设/立绘/音色一起落到 `characters/protagonist.md` 与 `assets/sprites/protagonist/`。
- **看文件**：「文件」页能看到 `characters/` 整棵，工坊对话里让 agent 改角色卡也落在同一处。

## 六、实施清单

### packages/core

- `play/characterCard.ts`：导出 `CHARACTER_DIR` / `PROTAGONIST_ID` / `characterCardPath` / `isProtagonist`；文件头注释路径改 `characters/<id>.md`。
- `play/config.ts`：删 `ProtagonistCard` 与 `PlayConfig.protagonist`，`parsePlayConfig` 去掉对应分支；`CharacterCard.persona` 等注释里的路径改 `characters/`。
- `play/assets.ts`：`AssetCharacter.protagonist` 注释改为「导入时落主角卡这张角色卡」。

### apps/server

- `store.ts`：加 `characterDir()`；`readiness()` 读卡目录改走它；`createEmpty` 建 `characters/` 与空的 `characters/protagonist.md`，`play.json` 不再写 `protagonist`。
- `memory.ts`：`PlayMemory.load` 的角色卡目录改 `store.characterDir()`；注释。
- `playFiles.ts`：`isEditable` 加 `characters/` 分支，`DIR_ROOTS` 加 `characters`。
- `playhouse.ts`：`writeCharacter` 落 `store.characterDir()`；`polish()` 改从主角卡取 name/persona。
- `http.ts`：cast 接口读卡目录。
- `assetImport.ts`：`characterCardPath` 引 core；删 `copyMedia` 的主角特殊分支与 `applyProtagonist`，主角走 `applyCharacterCard`（id 用 `PROTAGONIST_ID`）；`ImportResult.protagonist` 语义改为「落到主角卡」。
- `playAssets.ts`：`mapSprite` 的写卡路径引 core；报错文案带新路径。
- `assetRef.ts`：`characterIdsOf` 的目录；注释。
- `prompt.ts`：A 区角色表给主角标「玩家扮演」；契约里点明主角 id 与「是否上台/配音照创作口径」。
- `workshop.ts`：写作要点加一条「主角的呈现」（藏台后 / 上台 / 配音，配音需在卡上挑音色）；角色卡路径文案。
- 文案处：`agentkit/deps.ts`、`agentkit/libraryTool.ts`（导入回执）、`agentkit/memoryTool.ts`（`create_character` 描述）、`orchestrator.ts` 注释。

### apps/web

- `stage/view.ts`：`WorkshopTab` 加 `"play"`，`TABS` 改 `chat, play, characters, memory, assets, files, agent, settings`。
- `workshop/WorkshopPane.tsx`：TABS 加「剧目」（`drama` 图标，排在角色前）、「设定与记忆」改「记忆」；渲染分支接 `PlayPane` / `MemoryPane`。
- `workshop/PlayPane.tsx`（新）：剧目表单 + `CoverPicker` + 音色库选择。
- `workshop/MemoryPane.tsx`（由 `SettingsPane.tsx` 改名并瘦身）。
- `workshop/CharacterPane.tsx`：卡路径引 core；主角卡改成从 cast 里取（没有则空卡），用 `CharacterEditor` 渲染，不给删除；「新建角色」避开 `protagonist`；库导入的 `target=protagonist` 落点不变。
- `workshop/CharacterEditor.tsx`：卡路径展示文案。
- `workshop/AssetsPanel.tsx`、`api.ts`、`ui/Icon.tsx`：文案与图标。
- `views/TitleView.tsx`：就绪门那句指向工坊「记忆」页。

### 测试

- server：`characterCard.test.ts` / `playAssets.test.ts` / `playhouse.test.ts` / `assetLibrary.test.ts` 的读写路径改 `characters/`；`assetLibrary.test.ts` 的写盘清单期望值与主角导入用例（改为断言落 `characters/protagonist.md` 且立绘被复制）；`prompt` 用例里主角标注相关断言。
- web：`characterCards.test.tsx` 路径与主角卡用例；`settingsPaneCards.test.tsx` → `memoryPaneCards.test.tsx`（删 playDetail 竞态两条）；新增 `playPane.test.tsx`；`viewEntry.test.ts` 补 `tab=play`。

### 文档

- `README.md`：工坊页签表（现在是过期的「六页」）按新八页重写；剧目目录树加 `characters/`；记忆三层树去掉角色卡；主角相关段落（素材页那行、资源库导入那条「写进 play.json」）改到新位置与新语义。
- `apps/web/AGENTS.md`：workshop 小节（页签、`MemoryPane`/`PlayPane`、封面入口、主角卡与路径）。
- `apps/server/AGENTS.md`：角色卡路径、主角升格（agentkit 一节、引用即导入一节、无名角色音色那条）。
- 根 `AGENTS.md` 不动。
- 本需求目录补 `validation.md` / `summary.md`。

### 数据迁移（一次性，不进代码）

项目未上线，按 AGENTS「不考虑旧版迁移」，不写运行时兼容路径。

- **仓库里的样例 `plays/demo`**（`play.json` 里现有主角「你」）：
  `git mv plays/demo/memory/always/characters plays/demo/characters`；
  主角的 name/persona 落成 `plays/demo/characters/protagonist.md`；`play.json` 删掉 `protagonist` 字段。
- **本机其余剧目**（`plays/*`，不进 git）：本次不动，由用户自己迁。给一个一次性脚本 `scripts/migrate-play-layout.mjs`（dry-run 默认，`--apply` 才动盘）做两件事：把 `memory/always/characters/*` 上移到 `characters/`；把 `play.json.protagonist` 写成 `characters/protagonist.md` 并从 play.json 删掉。用户跑完即可删脚本，或留着下次换机用。
  不迁的后果：这些剧目的角色表为空，旧卡只作为记忆卡出现在记忆页，主角人设丢失（`parsePlayConfig` 会静默丢掉那个字段）。

## 七、验证

- `pnpm --filter @stage-ai/core build`，server 与 web typecheck 干净。
- 受影响用例：server 的 characterCard / playAssets / playhouse / assetLibrary / assetRef / prompt；web 的 characterCards / memoryPaneCards / playPane / viewEntry。不跑需要真实外部 API 的用例。
- 起本 worktree 的 dev（`./scripts/dev-worktree.sh`）实测并截图：
  1. 角色页主角卡与 NPC 卡是同一份编辑器；改主角名字/人设/音色/立绘差分，保存后落 `characters/protagonist.md`。
  2. 记忆页只有 premise / craft / 设定卡，没有剧目卡、没有角色卡。
  3. 剧目页改标题、点封面、清音色，保存后 `play.json` 生效、剧目库卡片跟着变。
  4. 文件页能看到并编辑 `characters/`。
  5. 工坊对话里让 agent 建一张角色卡，落点正确（提示词已是新路径）。
  6. demo 剧目：主角设定在 A 区角色表里带「玩家扮演」标注（可经工坊对话或服务端读提示词验证）。
- `?tab=play` 直达可用，`workshopUrl(id, "play")` 正常。

## 八、已对齐的决定

1. **本机既有剧目不由本次改动迁移**：只搬 `plays/demo`，其余由用户跑一次性脚本。
2. **页签顺序**：对话 / 剧目 / 角色 / 记忆 / 素材 / 文件 / Agent / 设置。
3. **主角留在「角色」页**，但升格为角色卡：上台、立绘、配音都支持，是否启用照 `craft.md`；剧作家在 A 区读得到主角设定。
