# 搭台助手对标 AIVN 工坊 —— 验证记录

> 第 1–5 节是**阶段 1**（能力骨架与 persona）的记录；第 6 节起是**阶段 2**（素材生成）。

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

## 6. 阶段 2 做完了什么

生图与配乐从「能力位是假」变成真：`src/media/` 九个模块 + 五个工具 + 两个角色的 persona 分叉。

| 面 | 落点 |
| --- | --- |
| 契约 | `src/media/image.ts`（画幅 / 档位 / `ImageRequest` / 从字节读画幅 / 画幅容差比对） |
| 三个协议 | `gemini-image.ts`（官方 / flow2api / cpa）、`openai-image.ts`（官方与兼容网关）、`modelslab-image.ts`（text2img / img2img） |
| 音乐 | `src/media/music.ts`（只有 Gemini 形状；扩展名跟着响应的 mime 走） |
| 装配 | `src/media/backends.ts` 的 `createMediaBackends`：**地址与模型都给齐**才算配好，否则工具不注册 |
| 抠底 | `src/media/cutout.ts`，**整份照搬** AIVN 的实现，只把五个调参的环境变量前缀换成 `DSH_AIVN_CUTOUT_*` |
| 出图/入库 | `src/media/assets.ts` 的 `PlayAssets`：`draft` / `commit` / `generate` / `recut` / `generateBgm` |
| 工具 | 搭台助手 `generate_image`（草稿）/ `commit_asset` / `recut_sprite` / `generate_bgm`；剧作家 `generate_image`（同步一步） |
| 配置面 | `image{format,baseUrl,apiKey,model,size,timeoutMs}` 与 `music{baseUrl,apiKey,model,timeoutMs}`；`can.image` / `can.music` 由后端是否建成决定 |
| 能力位回填 | `craft.ts` 的 `PHASE1_CAPABILITIES` → `assetCapabilitiesOf({image})`（`library` 恒假），《写作参数》的素材来源措辞跟着真实后端走 |
| persona | 搭台助手 `assetGuide(can)` 两分支 + 《配乐》（`can.music` 门控）+ 设定流程第 3 步分叉；剧作家 `playwriterTail(can)` 的《缺图怎么办》+ 「引入新角色」第 2 步分叉 |
| 技能库 | 视觉技能加第七章「用 `generate_image` 出图」；音频技能加 8.5「用 `generate_bgm` 出曲」 |
| 文档 | 双语 README：配置表加 `image` / `music`、工具表加五行、新增《素材生成》章（目录与台账 / 候选图怎么给用户看 / 立绘取景体量与抠底五调参 / 三种格式差在哪）、权限章的出网与文件两节改写 |
| 依赖 | `sharp` 作正式依赖，并在 `build.mjs` 里标成 **external** |

## 7. 第二遍「承诺 ↔ 机制」审视（阶段 2 新增的机制）

| 核什么 | 结论 |
| --- | --- |
| 工具名 | persona 与技能里出现的 `generate_image` / `commit_asset` / `recut_sprite` / `generate_bgm` / `list_assets` 全是注册在案的真名；剧作家侧只提 `generate_image`（它没有另三个） |
| 上下文注入 | 剧作家的《素材清单》与《写作参数》照旧；搭台助手不注入素材清单（它用 `list_assets` 现查）——出图后素材表与台账是**工具回执**告诉它的 |
| 工作区与路径 | 工具回执给的是**工作区内绝对路径**（`absPath`）；剧目内相对路径另给一份（`assets/backgrounds/x.png`），与 `@aivn/stage` 的读法一致 |
| 呈现通道 | **不新增 HTTP 路由**：候选图与成图走「回复里的工作区绝对路径 markdown」。助手正文里的 markdown 图片在本 GUI 能渲染（本会话反复用过）；**工具回执里的 markdown 会不会也渲染未验**（没有真图可出），所以 persona 明确要求模型把回执里那行**贴进回复**——回执不渲染也看得到 |
| 角色边界 | 生图工具**不分角色**（schema 与实现同一份），只有等待策略与说明不同；`generate_bgm` 只给搭台助手（与 AIVN 同：一首 84 秒，塞进演出回路等于整轮都在等） |
| 会话机制 | 剧作家的出图是**同步**的（D3）：没有回合之外的注入通道，所以不承诺「发起即返回 / 到货淡入 / 骨架占位」——那三样是 AIVN 靠广播与时间线占位做的，插件不做 |
| 悬空承诺复查 | 「骨架占位」这类 AIVN 语汇在新章里没有出现；`recut_sprite` 只出现在它真能用的地方（立绘、且留过底） |

## 8. 验证结果（阶段 2）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `npx tsc --noEmit` | 通过 |
| 构建 | `npm run build`（`lib/` 是跟踪产物） | 通过（`lib/index.js` 236.7kb；sharp 走 external） |
| 素材链路离线套件（新增） | `npm run e2e:media` | **21/21 通过** |
| 搭台助手 e2e（加两条断言） | `dsh-e2e run e2e/run.mjs stagehand` | **17/17 通过** |
| 注入 e2e（加一条断言） | `dsh-e2e run e2e/verify-injection.mjs` | **14/14 通过** |
| 舞台 e2e（回归） | `dsh-e2e run e2e/run.mjs stage` | **14/14 通过** |
| 真后端出图 | 直连本机 flow2api | **未通过（网关侧环境问题，见下）** |

新增套件 `e2e/verify-media.ts`（`npm run e2e:media`，离线、几秒）用**桩后端 + 真 sharp** 跑完整条落盘路径：
立绘草稿的自动抠底（前景占比、人物高）与 alpha PNG、入库到 `assets/sprites/<id>/neutral.png`、
抠底前原片留底、素材表写 `framing`/`stature`、台账记 prompt、原地重抠、背景入库与「同 id 再次入库
认得出是覆盖」、BGM 落 `assets/bgm/<id>.m4a` 与素材表 source，外加三条负例（画幅不符不落盘、
没有入库的 neutral 出不了差分、立绘差分拒吃显式垫图）与三条 persona 分叉断言（配了/没配生图与音乐、
剧作家的缺图章跟着能力位出现与消失）。

**能力位两个方向都实测过**（e2e 实例的插件配置改一次、跑一轮、再还原）：套件按「工具面与 persona
必须一致」断言，所以配与不配两种实例都跑得过，且都跑了一遍：

| 实例配置 | 结果 |
| --- | --- |
| 没配生图 / 音乐（默认状态） | `generate_image` / `commit_asset` / `recut_sprite` / `generate_bgm` **一个都不注册**，persona 走「现在**没有生图工具**」的 fallback 章、没有《配乐》章；剧作家没有 `generate_image`、提示词里没有《缺图怎么办》。**stagehand 17/17、injection 14/14** |
| 临时配桩后端（`baseUrl: http://127.0.0.1:9`、`model: stub-image` / `stub-music`，只验注册与提示词、不发请求） | 四个工具**全在**工具清单里，persona 教「两步走：先出候选」并带《配乐》章；剧作家侧 `generate_image` 与《缺图怎么办》同时出现。**stagehand 17/17、injection 14/14** |

实际工具清单（没配任何后端的默认实例）：

```
剧作家   : beat_done, create_play, edit, glob, grep, list_assets, read, read_image, update_state, write
搭台助手 : create_play, edit, get_readiness, glob, grep, list_assets, read, read_image, set_craft, skill, write
```

**真后端那一条为什么没跑通**（如实记，未验就是未验）：本机 flow2api（`127.0.0.1:38000`）对
`gemini-3.1-flash-image` 一律回
`{"error":{"code":500,"message":"生成失败: Flow frontend RPC rejected: rpc=ogiZ0b, code=[5]"}}`——
用最小请求（"a red apple"、不带 `imageConfig`）同样复现，而 `tokens` 表里 `is_active=1`、`credits=988`、
项目绑定 `Sep 28 - 14:56 P2`（2026-10-05 还成功出过图），所以是网关上游的 Flow 项目引用失效，
不是插件的请求形状问题（请求已被网关接受并转发）。Google 官方 API 从本机也连不通（直连与 7890 代理
都超时）。**下一步**：网关侧恢复后按第 10 节那条命令补跑一次真出图。

## 9. 与计划的偏离（阶段 2）

| 计划里写的 | 实际 | 为什么 |
| --- | --- | --- |
| 抠底五调参走 `STAGE_CUTOUT_*` | `DSH_AIVN_CUTOUT_*` | 插件自己的环境变量前缀（与 `DSH_AIVN_TTS_KEYS` / `DSH_AIVN_EXA_KEYS` 同一口径）；`STAGE_*` 是 AIVN 那边命名空间 |
| 预览 spike：HTTP 路由 vs 写进工作区，两条各验一次 | 只保留后者 | spike 的结论是「工作区内绝对路径的 markdown 图片」这条 DSH 原生机制已经够用，新增路由是多余的写口；未验的是**工具回执**是否也渲染（见第 7 节） |
| 台账记 `assets/generated.json` | 照做，形状按插件需要收窄（`kind`/`path`/`prompt`/`model?`/`createdAt`） | 插件没有 AIVN 的 CG 页读取端；键沿用素材 id（`<主体id>/<差分>` 或文件名主体），与素材表同口径 |
| 立绘取景/体量声明 | 照做，`framing`/`stature` 写在 `assets/manifest.json` 的 `<主体id>` 键 | `@aivn/stage` 本来就认这两个键（声明缺省时回落 `DEFAULT_SPRITE_FRAMING` / `DEFAULT_SPRITE_STATURE`） |
| 垫图可给 http(s) 网址 | 只吃主体 id 与剧目内相对路径 | 计划 §8 已明确不做参考图下载与网图分支 |
| —（新增） | `sharp` 在 `build.mjs` 里标 external | 踩到的坑：esbuild 把 sharp 连同它的原生模块打进 `lib/index.js` 之后，dsh 装载插件直接 `failed to import`（整个预设消失、GUI 退回 Standard）。`sharp` 在 `dependencies` 里，运行时按包名解析 |

## 10. 阶段 2 的遗留与接续

- **真出图验收待补**：网关恢复后跑一次真后端（单点、不批量）。临时探针（不进仓库）的用法是
  `npx esbuild <探针>.ts --bundle --platform=node --format=esm --target=node22 --external:sharp --outfile=./probe.tmp.mjs`
  再从仓库目录跑（`sharp` 要按包名解析）；配好 `image` 之后直接在 GUI 里让搭台助手出候选更直观。
- **候选图在工具回执里的渲染**未验：见第 7 节，persona 已按「回执不渲染也看得到」的写法兜住。
- **舞台吃掉新素材**：素材落位与声明都由离线套件验过（路径、`framing`/`stature`、扩展名），
  但「出完真的在舞台上看见」要等真图——`stage` 套件跑的是夹具里已有的素材。
- **出图台账没有读取端**：`assets/generated.json` 只写不读（插件的界面里没有 CG 页），属有意收窄。
- `composeImagePrompt`（舞台缺图自动现生）与周目/分支树、应用级素材库一样，按计划**不做**。
