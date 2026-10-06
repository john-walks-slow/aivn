# 搭台助手对标 AIVN 工坊 · 实施计划

> 需求（用户原话，2026-10-06）：「要保证搭台助手具有和现在 aivn 的工坊 agent 的同等能力
> （包括专属 skill、各类素材生成和管理工具）（对标 aivn（看一下 aivn 最新代码，已有不少演进））」
>
> 调研：`261006-workshop-parity.assets.research.md`（素材生成链）、
> `261006-workshop-parity.content.research.md`（内容/台账/搭台辅助）。
>
> 用户已拍板：**周目与分支树不做**（`list_saves` / `read_lineage` 出范围，persona 走 AIVN 的 fallback 章）。

## 1. 目标与成功判据

把插件 `aivn-stagehand` 预设从「`create_play` + 文件工具」补齐到与 AIVN `workshop` 角色同等的能力面：
**能查就绪、能定写作参数、能读专属技能、能查音色、能出图与入库（含重抠）、能生成 BGM、能联网查资料**，
并且 persona 与 AIVN 工坊同构（同样按「能力位」决定教它做什么）。

做成什么样算完成：

1. 第 3 节的差距表逐行有落点：实现，或明确不做（附理由，写进 README/计划）；
2. 端到端一条真路径跑通：空目录起剧目 → 助手问设定并落盘 → 出 3 张定妆候选 → 用户挑一张 → `commit_asset` 入库 →
   立绘/背景在舞台用得上 → `generate_bgm` 出一首 → 技能库与音色库可查；
3. 未配后端的部署里，助手**不谎报能力**：相关工具不注册、persona 走 fallback 章、回执照实说该怎么办；
4. e2e 新增 `stagehand` 场景（沿用 `dsh-e2e` 基建），受影响的既有场景（`stage`/`injection`/`voice`）不回归；
5. 双语 README 补齐全部新配置项与能力说明（是本插件唯一用户文档）；
6. **两个 agent 的系统提示词都被按 DSH 现实逐条核过**：prompt 里出现的每个工具名、每个机制、每条承诺，
   都能映射到插件里真实存在的工具或机制（对照表见 §4.3），映射不到的当场改 prompt 或补工具——
   不留「提示词里写着、代码里没有」的悬空承诺。

## 2. 现状一句话

插件的搭台助手只有 `create_play` + DSH 文件工具，persona 里还写着「素材本阶段没有生成工具」；
AIVN 工坊侧有 **12 个能力 / 20 个工具**（含两角色共用的 read/write/edit/bash），以及一套按能力位门控的
14 章 persona、四份专属技能、应用级素材库与出图草稿流程。

## 3. 差距表（AIVN 工坊 12 能力 → 插件落点）

| AIVN 能力 | 授权工具 | 插件侧现状 | 落点 | 阶段 |
| --- | --- | --- | --- | --- |
| `files` 改剧目文件 | write / edit / set_craft | write/edit 有；`set_craft` 在**剧作家** | `set_craft` 移给搭台助手 | 1 |
| `readiness` 检查开演条件 | get_readiness | 在**剧作家** | `get_readiness` 移给搭台助手 | 1 |
| `shell` 命令行 | bash | 预设里有 `disabled` 行 | 保持默认关（AIVN 也是 `defaultOff`），用户可在预设里开 | 1 |
| `view` 看图 | view_image | `dsh-tool-fs` 自带 `read_image` | 白送；persona 教用法 | 1 |
| `skill` 技能库 | read_skill | 无 | 插件自带 `skills/` + 预设挂 `skill-filesystem` / `tool-skill` | 1 |
| `voice` 音色库 | list_voices | 无（Fish TTS 已在） | 新增 `list_voices`（Fish 音色窗口） | 1 |
| `search` 联网检索 | web_search | 无 | 新增 `web_search`（自建 Exa 客户端，config 配 key） | 1 |
| `library` 素材资源库 | list_library / import_asset | `list_library` 语义是**剧目自己的素材** | **不做**（用户已拍板：library / import_asset 的概念不需要）；现有工具改名为 `list_assets` 去歧义 | — |
| `image` 生图 | generate_image / commit_asset / recut_sprite | 无 | 新增后端客户端 + 草稿区 + 入库 + 重抠 | 2 |
| `music` 生成 BGM | generate_bgm | 无 | 新增后端客户端 + 同步生成 + 台账 | 2 |
| `lineage` 故事树 | list_saves / read_lineage | 无数据面 | **不做**（用户已拍板）；persona 走 fallback | — |
| （演出面）剧作家生图 | generate_image(queued) | 无 | **做成同步形态**：一次调用声明最终 id、出图即入库（用户不挑图），阶段 2 一起做 | 2 |

## 4. 架构

### 4.1 能力面（`can`）：真相源 = 插件配置 + 预设行集

新增 `src/stagehand/capabilities.ts`，一处算出搭台助手的 `can` 位：

```
files / skill / view / readiness   → 恒真（预设行集决定）
shell                              → 预设里 bash 行是否启用（默认关）
image / music / voice / search     → 插件 config 里对应后端是否**配全**（enabled + baseUrl + apiKey）
library / lineage                  → 恒假（两者都已出范围，persona 走各自的 fallback 章）
```

配置面照现有 `tts` 的形状扩（`src/index.ts` 的 schemastery `Config` + `cordis.patch.yml`），
env 兜底沿用 `DSH_AIVN_*` 口径。**未配 = 工具不注册 + persona 不教**，与 AIVN 的音乐侧同口径。

> 刻意与 AIVN 不同（两处，均为修不一致，实施时在代码注释里写明）：
> ① AIVN 的 `can.image` 在后端缺失时仍为真（工具恒注册），提示词照旧教出图——插件按后端是否配全判定；
> ② AIVN 工坊 `generate_image` 省略 `variant` 实际抛「差分名不能为空」而描述写「按 neutral」——插件按 neutral 兜底。

### 4.2 工具装配

`src/preset-tools.ts` 的 `install()` 按预设分两套：

- **剧作家**：现有五个里 `get_readiness` / `set_craft` **移出**（AIVN 归工坊），`list_library` 改名 `list_assets` 后两个角色都留
  （它本来就是「读剧目自己的素材清单」，与 AIVN 那个跨剧目库无关，改名是为了不留同名异义的坑）；
- **搭台助手**：`create_play` + 新增 `set_craft` / `get_readiness` / `list_assets` / `list_voices` /
  `web_search` / `generate_image` / `commit_asset` / `recut_sprite` / `generate_bgm`（后五个按 `can` 装）。

新增目录 `src/stagehand/`（persona、capabilities、tools/）与 `src/media/`（后端与素材落盘），
与 `src/playwriter/` 平级；`STAGEHAND_PROMPT` 从 `src/playwriter/prompt.ts` 搬到 `src/stagehand/prompt.ts`。

### 4.3 persona：14 章同构装配

照 AIVN `buildWorkshopPrompt` 的章节顺序与门控重写，用插件语汇（舞台 tab、工作区即剧目、
DSH 工具名）。门控章：`对话风格`(files)、`出图要点`(image)、技能清单(skill)、`命令行`(shell)、
`联网检索`(search)；同章换 fallback 的四处：`职责边界`、`设定流程`第 4 步、`剧目写作要点`、`读故事树`。

插件侧的三处适配：

- 章 12「当前状态」不写进静态 persona，改由 **搭台助手 scope 的上下文注入**给（文件清单 + 就绪 + 写作参数），
  复用 `play-context.ts` 的 `readPlaySnapshot`，与剧作家的 A 区注入同一套机制；
- 章 13「会话压缩定稿」不再自建（DSH 自带 compaction），只在 persona 里保留「不要重问已确定的事」一句；
- 章 14「本剧目补充要求」读 `play.json` 的 `agents.stagehand.prompt`（逐剧目自定义段，原样拼在最后）。

**两个 agent 的提示词都要过一次「承诺 ↔ 机制」审视**（用户 2026-10-06 追加要求）。台词是模型唯一的行为依据，
而 AIVN 的工坊 persona 是长在 AIVN 自己的运行时上的（素材页、路线视图、气泡、pending 面板、到货广播、
pi 的工具名 `view_image`/`read_skill`），照抄必然指向不存在的东西。审视按这张表逐条走，结论落进
`261006-workshop-parity.validation.md`：

| 核什么 | 例（插件侧的真名/真机制） |
| --- | --- |
| 工具名 | `read_image`（不是 `view_image`）、`skill`（不是 `read_skill`）、`bash`、`list_assets` |
| 上下文注入 | 戏剧家在 A 区注入拿到什么、搭台助手在「当前状态」注入拿到什么；prompt 里承诺的信息是否真在 |
| 工作区与路径 | 会话工作目录即剧目根；`assets/` `characters/` `memory/` 的真实布局 |
| 呈现通道 | 候选图/素材怎么给用户看（GUI 的 markdown 图片 / `present`），AIVN 的素材气泡与 pending 面板都不存在 |
| 角色边界 | 剧作家不该看见搭台契约，搭台助手不该看见舞台契约（沿用现有注入分面） |
| 会话机制 | DSH 自带 compaction 与工具回执呈现；不承诺 AIVN 的压缩定稿与广播 |

凡「映射不到」的，二选一：删这句话，或把它要的机制补进实施范围（补了就得进差距表）。

### 4.4 技能库

插件包新增 `skills/`（`galgame-bgm` / `scene-composition` / `sprite-differences` / `style-anchors`），
预设挂 `skill-filesystem`（`customSkillDirs` 指向插件包内该目录）+ `tool-skill`——用 DSH 原生的
「目录只列 name/description、按需加载全文」机制，等价且优于 AIVN 的 `read_skill`。

文本改写（调研已发现的漂移）：把「`play.json` 的 persona」改为 `characters/<id>.md`；
把 AIVN 界面语汇（素材页 / 路线视图）换成插件语汇；`galgame-bgm` 里依赖应用级库 61 条词表的约束，
改为「按剧目已有 BGM 的 mood/scene 对齐，新曲自己开词」。`package.json` 的 `files` 加 `skills`。

### 4.5 素材生成（阶段 2 核心）

- **后端**：`src/media/image.ts`（gemini / openai / modelslab 三种协议形状，照搬 AIVN 的三个 provider）、
  `src/media/music.ts`（Gemini 形状单一协议）；
- **草稿区**：`<剧目根>/media-cache/drafts/<draftId>/{image.<ext>,source.<ext>,draft.json}`（与 AIVN 同形）；
  立绘另留抠底前原片 `media-cache/sprite-sources/`（重抠的前提）；`media-cache/` 不进版本控制（写 `.gitignore` 提示）；
- **入库**：`commit_asset` 写 `assets/**` + 原子改 `assets/manifest.json` + 记 `assets/generated.json` 台账
  （单写者 + tmp+rename，不做 AIVN 那套剧目级锁）；
- **预览**：阶段 2 开头做一个 spike——「插件 HTTP 路由 + markdown 图片」与「写进工作区 + 绝对路径 markdown」
  两条路各验一次，取能在 GUI 聊天里真看见候选图的那条（这是「出 3 张候选让用户挑」流程的前提）；
- **两个入口、一份实现**：搭台助手走**两步**（`generate_image` 只出草稿 → 用户挑 → `commit_asset` 入库），
  剧作家走**一步**（`generate_image` 同步等图，出图 + 入库 + 补素材表 + 记台账一次做完，回执给最终 id）——
  与 AIVN 的 sync / queued 分工同形，只把那边「发起即返回 + 后台排产 + 到货广播」换成同步等待
  （理由：插件是 DSH 会话模型，没有回合之外的注入通道；用户 2026-10-06 拍板接受这次 70–140s 的停顿）；
- **音乐**：`generate_bgm` **同步等待**（实测 ~84s；工具不声明 `timeoutMs` 即不受限，已确认）。
  与 AIVN 的「发起即返回」不同：AIVN 靠到货广播让人不必干等，插件没有那条通道，
  同步等待至少保证回执说的是真话（理由同步写进代码注释）；
- **重抠**：`src/media/cutout.ts`（照搬 AIVN 的 sharp 纯函数实现）+ `recut_sprite`；
  `sharp` **作为正式依赖**（已确认本机 arm64 有预编译二进制），抠底五个调参走 `STAGE_CUTOUT_*` 环境变量；
- **能力位回填**：`src/playwriter/craft.ts` 的 `PHASE1_CAPABILITIES` 改为按 `can` 传，
  生图开了之后写作参数章自动带上出图指导（`library` 位恒假——该能力已出范围）。

## 5. 分期

体量 >3500 loc，分两期，逐期走实施 → 受影响范围测试 → 检视 → 提交。

**阶段 1 · 能力骨架与 persona**（无外部后端，立刻可用）
`can` 模型 + 搭台助手 persona 14 章 + 工具迁移（`get_readiness` / `set_craft` 移给搭台助手、
`list_library` 改名 `list_assets`）+ 搭台助手上下文注入 + 技能库（四份 skills）+ `list_voices` + `web_search`
+ **两个 agent 的提示词「承诺 ↔ 机制」审视**（§4.3 的表，结论落 validation 文档）+ README 双语更新。

验收：空目录起剧目 → 助手按新 persona 问设定 → 落 premise / craft.md / 角色卡 → `get_readiness` 如实报告 →
技能可查可读、看图可用、`set_craft` 改得动写作参数；未配 Fish/Exa 时对应工具不注册、persona 走 fallback；
**提示词里出现的每个工具名都在实测的工具清单里**（写成一条 e2e 断言）。

**阶段 2 · 素材生成**
生图后端 + 草稿区 + 预览 spike + 搭台助手两步（`generate_image` → `commit_asset`）+
剧作家一步（同步出图即入库）+ `recut_sprite`（sharp 正式依赖，已确认本机 arm64 可跑）+
`generate_bgm` + 台账（`assets/manifest.json` / `assets/generated.json`）+ 舞台吃掉新素材的回归验证。

验收：真出一张背景与一张立绘（3 张候选 → 挑一张 → 入库）→ 舞台上用得上 → 重抠一张改参数 →
出一首 BGM；剧作家在演出中缺图能一次调用补上并当场可用。

## 6. 验收与测试策略

- **单元**：`can` 判定矩阵（配了/没配 × 各能力）、persona 章节门控（有/无各 fallback）、
  craft 参数合并、manifest/台账读改写、草稿清理、资源库扫描（阶段 3）；
- **e2e**：`dsh-e2e` 起实例跑 `stagehand` 新场景（工具是否注册、persona 是否含门控章、`get_readiness` 真读盘）；
  阶段 2 加一条**真后端**的最小出图用例（单点、不批量重跑，凭据走 `api-vault`）；
- **受影响范围**：现有 `stage` / `injection` / `voice` 三个场景必须仍绿（工具迁移动了剧作家的装配面）；
- 不做无差别全量回归。

## 7. 已拍板与既定决策

**用户已拍板**

- **D1 · 应用级素材资源库：永久不做。** `library` / `import_asset` 的概念不需要——
  跨剧目库目录约定、库内容来源、技能词表依赖一并取消；现有 `list_library` 改名 `list_assets`
  （它读的是剧目自己的素材清单，与 AIVN 那个跨剧目库无关系，改名去歧义）。
- **D2 · 抠底：带，`sharp` 作为正式依赖。** `recut_sprite` 在阶段 2 落地，不做可选依赖降级。
- **D3 · 剧作家缺图：同步出图。** 剧作家也装 `generate_image`，同步等图、出图即入库（一次调用给最终 id，
  不走草稿/挑图那两步）；接受演出中这次 70–140s 的停顿。

**其余由我决定，列在这里供复核**

- 生图/音乐后端默认**不预置**（未配 = 工具不装、persona 走 fallback 章）；本机用法
  （flow2api `127.0.0.1:38000` + `gemini-3.1-flash-image` / `flow-music-lyria-3.5`）写进双语 README 示例；
- 逐剧目能力开关（AIVN 的 `agents.<role>.capabilities` + Agent 设置页）不做，能力面由宿主级插件配置决定；
- `generate_bgm` 同步等待（AIVN 是发起即返回，理由见 §4.5）；
- 搭台助手沿用现有预设行集 + 插件工具，不引入 AIVN 的工坊线程模型。

## 8. 明确不做

- 周目与分支树（`list_saves` / `read_lineage`）——用户已拍板；
- 应用级素材资源库与 `import_asset`——用户已拍板；
- AIVN 工坊的线程模型（压缩定稿、`workshop_tool_*` 广播、`pending_jobs` 面板、`applyChanges` 收束重建）——
  插件把工坊当普通 DSH 会话跑，用 DSH 自己的会话与压缩机制；
- AIVN 的 Agent 设置页（逐剧目能力勾选）与 `imageApproval` 审批状态机——审批改为纯 persona 约束
  （与 AIVN 的实现口径一致：那边也没有代码校验）；
- 舞台 WS 生 CG（`playhouse.requestCg` + `composeImagePrompt`）：插件没有「舞台缺图自动现生」这条入口，
  缺图由剧作家的 `generate_image` 当场补（D3）；
- 参考图下载、`view_image` 的网图分支（DSH 的 `read_image` 只管本地图，够用）。
