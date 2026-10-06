# 搭台助手对标 AIVN 工坊 —— 验证记录（阶段 1）

日期：2026-10-06　范围：`dsh-aivn` 阶段 1（能力面 + persona + 工具迁移 + 注入 + 技能库 + 两份提示词的机制审视）

阶段 2（生图 / 重抠 / BGM / 剧作家同步出图 / 台账）不在本记录内。

## 1. 这一阶段做完了什么

| 项 | 落点 |
| --- | --- |
| 能力面模型（`can`） | `src/stagehand/capabilities.ts`：只留会变的三位 `shell` / `voice` / `search` |
| 搭台助手 persona（AIVN 工坊 14 章的对标版） | `src/stagehand/prompt.ts` |
| 「当前状态」注入（文件清单 + 就绪 + 剧本语言） | `src/stagehand/context.ts`，挂在搭台助手自己的 scope 上 |
| 工具迁移：`get_readiness` / `set_craft` 归搭台助手 | `src/playwriter/tools/` → `src/stagehand/tools/` |
| `list_library` → `list_assets`，两个角色都装 | `src/playwriter/tools/list-library.ts` → `src/tools/list-assets.ts` |
| 音色库 `list_voices` | `src/stagehand/voice-catalog.ts` + `src/stagehand/tools/list-voices.ts` |
| 联网检索 `web_search` | `src/stagehand/exa.ts` + `src/stagehand/tools/web-search.ts` |
| 技能库（随包两份） | `skills/galgame-audio/`、`skills/galgame-visual-craft/`；预设行 `skill-filesystem` + `tool-skill` |
| 共用模块归位 | `src/playwriter/craft.ts` → `src/craft.ts`；`src/playwriter/readiness.ts` → `src/readiness.ts`（都读写同步化，工具与注入共用一份判据） |
| 配置面 | `shell`、`search.keys` / `search.baseUrl`（env 兜底 `DSH_AIVN_EXA_KEYS`） |
| README 双语 | 配置表、预设、注入、工具面、技能库、权限四节同步 |

## 2. 承诺 ↔ 机制对照表（用户点名的审视）

原则：**提示词里出现的每一个工具名、每一句「引擎会替你……」都必须能指到一个真实机制**；
指不到的一律删掉，不用「模型大概会理解」兜。下表是逐条过完的结果。

### 2.1 搭台助手 persona（`src/stagehand/prompt.ts`）

| 章 | 承诺 | 机制 | 判定 |
| --- | --- | --- | --- |
| 身份 + 剧目在哪 | 工作目录即剧目根；文件工具直接可用 | `{{cwd}}` persona 插值 + 预设行的 `dsh-tool-fs` | ✅ 保留 |
| 起一座新剧目 | 「用 `create_play`，别手工 write」 | `create_play` 工具（两个预设都装，`wx` 不覆盖） | ✅ 保留 |
| 职责边界 | 「改文件必须真的调 write / edit」 | 文件工具在行集里 | ✅ 保留 |
| 职责边界（演出那半） | 「演出的事你看不到」 | 插件没有周目 / 谱系数据面（`readiness.ts` 明说不报 saves） | ✅ 改写：AIVN 的《读故事树》章在插件里没有对应机制，删章换成这一句 |
| 对话风格 | 先读后写、edit 优先、只准汇报真写过的文件 | 工具流水就是判据；`edit` 工具在行集里 | ✅ 保留 |
| 设定流程（四步） | 第 3 步「列图单，自己放进 assets/」 | 阶段 1 没有生图工具 | ✅ 按现实改写（阶段 2 换成「草稿 → 挑 → 入库」） |
| 设定流程（第 4 步） | premise / craft.md / `set_craft` / manifest | 写文件 + `set_craft` 工具 | ✅ 保留 |
| 出图要点 | 「现在没有生图工具，把图单交给用户」 | 同上；素材 id 命名与描述要求指向 `assets/manifest.json`（`play-context` 与 `list_assets` 都读它） | ✅ 按现实改写 |
| 剧目写作要点 | `set_craft` 改写作参数 | `set_craft` 写 `play.json` 的 `craft` 段，剧作家侧 A 区现读 | ✅ 保留 |
| 命令行 | shell 相关 | 预设行 `tool-bash`（`shell: true` 才装） | ✅ 门控保留 |
| 联网检索 | `web_search` | Exa 客户端 + 工具（配了 key 才注册） | ✅ 门控保留 |
| 技能库 | 「清单里的做法速查，动手前加载全文」 | `skill-filesystem`（`customSkillDirs` 指向包内 `skills/`）+ `tool-skill` 的会话技能目录 | ✅ 保留（机制换成 DSH 原生技能面，比 AIVN 的 `read_skill` 更完整） |
| 当前状态 | — | 不在 persona 里：`stagehand/context.ts` 的注入段 | ✅ 换位 |
| 会话压缩定稿 | — | DSH 自带会话压缩 | ❌ 删章（再教一遍必与宿主打架） |
| 逐剧目自定义段 | — | 插件没有 Agent 设置面；`@aivn/core` 的 `parseAgentConfig` 只认 `playwriter`/`workshop` 且 `prompt` 只给 `workshop`，插件读不到自己的角色名 | ❌ 删章（用户想加剧目级要求就写进 `memory/always/craft.md`，persona 已指向它） |
| 生图 / 音乐 | — | 阶段 2 | ⏸ 未进这一阶段（persona 里也没有任何相关工具名） |

### 2.2 剧作家提示词（`src/playwriter/prompt.ts`）——查出的四处悬空承诺

| 位置 | 原来的话 | 问题 | 处置 |
| --- | --- | --- | --- |
| 「剧目在哪」 | 「这座剧目还缺什么（前提、角色卡、立绘、背景），调 `get_readiness` 看一眼」 | `get_readiness` 这一阶段起归搭台助手，剧作家没有这个工具 | 改成「这些都在下面几段注入里，每轮现读」 |
| 「你怎么工作」 | 「世界线、存档、重演、跳转是引擎和玩家的事」 | 插件没有周目与故事树，这句话在描述不存在的机制 | 删句 |
| 注释章 | 「它不上舞台、不进谱系、不产出任何事件」 | 没有谱系 | 删「谱系」 |
| 记忆卡章 | 「`memory/arcs/`、`memory/archive/` 不要动」 | 插件没有这两个目录的产出者 | 删句 |

另核对无误的几处（不改）：`beat_done` 独占一批（工具确实在剧作家手里）、`update_state` 写
`memory/always/state/`（实现一致）、`create_play`（两个预设都有）、A 区六段与【状态】的注入
（`play-context.ts` 注册，`verify-injection` 逐段断言）。

### 2.3 工具名冻结

两个预设的提示词里出现的名字，必须都在该角色的工具集里（e2e 断言，见 §3）：

- 剧作家：`create_play`、`list_assets`、`beat_done`、`update_state` + 文件工具；
- 搭台助手：`create_play`、`list_assets`、`get_readiness`、`set_craft`（+ 配了 key 才有 `list_voices` / `web_search`，+ `shell: true` 才有 `bash`）+ 文件工具 + `skill`。

## 3. 验证结果

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `npx tsc --noEmit` | 通过 |
| 构建 | `npm run build`（`lib/` 是跟踪产物） | 通过（`lib/index.js` 169.2kb） |
| 搭台助手 e2e（新增） | `dsh-e2e run e2e/run.mjs stagehand` | **15/15 通过** |
| 注入 e2e（含两条新断言） | `dsh-e2e run e2e/run.mjs verify-injection` | **13/13 通过** |
| 实跑一景 | 新会话选「搭台助手」→「看一眼现在的工作区」 | 7 步 14 次工具调用：`glob` ×3 → `get_readiness` → `read` ×4 → `list_assets` → … → 如实报「`play.json` 不在，严格说这还不是一座剧目」，未改任何文件 |

新增套件 `e2e/verify-stagehand.mjs` 的断言：座位选到搭台助手、persona 有《职责边界》/《设定流程》/
《出图要点》/《剧目写作要点》、**没有**舞台契约（两套注入不串）、《当前状态》列出真实文件与大小、
带就绪报告、技能清单里有两份自带技能（同时证明 skill 行装载与包内路径算对）、工具面是
`create_play + list_assets + get_readiness + set_craft`（且没有 `beat_done` / `update_state` / 旧名
`list_library`）、没配 key 时 `list_voices` / `web_search` 不注册。

`verify-injection` 新增两条：`list_assets` 在、旧名不在；`get_readiness` / `set_craft` 不在剧作家手里
而 `beat_done` 在。

两个角色的实际工具清单（同一实例、同一轮次，取自会话日志的 `request/header`）：

```
剧作家   : beat_done, create_play, edit, glob, grep, list_assets, read, read_image, update_state, write
搭台助手 : create_play, edit, get_readiness, glob, grep, list_assets, read, read_image, set_craft, skill, write
```

（`shell: false` 且没配 TTS / Exa key 的实例上：两边都没有 `bash`；搭台助手没有 `list_voices` /
`web_search`，剧作家没有 `skill`。文件工具两个角色共有。）

**没跑的**：`stage`（舞台渲染）与 `voice`（真 Fish key）两个套件——本阶段没动舞台管线、客户端
与语音链路，按「只跑受影响范围」跳过。

## 4. 与计划的偏离

| 计划里写的 | 实际 | 为什么 |
| --- | --- | --- |
| 技能库四份（`galgame-bgm` / `scene-composition` / `sprite-differences` / `style-anchors`） | 两份：`galgame-audio`、`galgame-visual-craft` | 那四个名字来自其它工作树；AIVN **main** 的 `skills/` 就是这两份（视觉那三份已并进 `galgame-visual-craft`）。对标的是 main |
| persona 章 14 读 `agents.stagehand.prompt` | 取消 | `@aivn/core` 的 `parseAgentConfig` 只认 `playwriter` / `workshop`，且 `prompt` 只给 `workshop`；插件没有逐剧目 Agent 设置面。剧目级要求写 `memory/always/craft.md` |
| 「预设里留一行 `disabled` 的 bash，用户自己开」 | 新增配置项 `shell: boolean` | 预设是代码注册的，GUI 改不动它的行；要让用户真能开就得有配置面 |
| `readiness` 判据保持异步 | 改同步（`readPlayReadiness`） | 注入段是同步求值的，工具与注入必须共用一份判据，否则两版会漂 |

## 5. 阶段 2 接续点

- `can` 里加 `image` / `music` 两位（配置面同时加生图后端与音乐后端）；
- `generate_image` 草稿（不回执 URL，草稿留在 `assets/drafts/`）→ 用户挑 → `commit_asset` 入库；
  剧作家侧同一工具走**同步一步**（出图即入库、一次调用给最终 id）；
- `recut_sprite`（抠底，sharp 作正式依赖）+ `set_sprite_bounds` 之类的素材级声明；
- `generate_bgm`（异步渲染，回执走会话注入）；
- 舞台生 CG + `composeImagePrompt`、台账页——按计划表；
- persona 的《出图要点》换成 AIVN 那套「草稿 → 挑 → 入库」正文，`skills/galgame-visual-craft`
  补「生图模型选型与流水线」两章。
