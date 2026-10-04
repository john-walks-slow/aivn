# 能力开关 · 计划

工作区 `.worktrees/capability-switches`，分支 `feat/capability-switches`，基线 `feat/generic-tools@fa05f12`。
本计划经过一次外部核查（`261004-capability-switches.crosscheck.md`），文件面与提示词两块按核查结论重做过。

## 起因

Agent 页现在摆的是**工具**：22 个 id（`read`、`edit`、`recut_sprite`、`get_readiness`…），剧作家那张卡
13 个 / 6 组。用户要先把自己那句「它能不能自己画图」翻译成「它得勾上 `generate_image`」才能做决定——
这层翻译本该由我们做，而且作者越不懂 agent，翻错得越离谱。

工具通用化之后还多了一个表达不出来的东西：剧作家写角色卡与写记忆卡**共用同一个 `write`**。
界面上只能整块开关，所以「能写记忆、但别自己建角色」这种最自然的诉求，现在写不出来。

## 目标

用户勾的是**它能不能做这件事**；这件事要哪些工具、能动哪些文件、提示词里注不注那一章，
都由这一勾推出来。每一行配一句人话讲清关掉它的后果，默认值按产品意图给。

## 用户路径

1. 工坊 → Agent 页 → 「剧作家」那张卡：模型、思考档位，然后一列能力。
2. 「管理角色」「记忆」「生图」「素材资源库」「联网检索」「限制级通道」六行，每行一句后果；
   末尾一行灰字：**始终可用：读文件、结束本轮、状态跟踪**。
3. 取消「管理角色」→ 保存 → 下一轮生效。再遇到新角色，它走 `say` 的 `name` 属性，或出图时带
   `characterName`（引擎建一张最小卡）；既有角色回场时它仍能 `read` 那张卡拿全人设。
4. 勾回来 → 它重新能在演出里直接写 `characters/<id>.md`，下一轮边界进 A 区角色表。

## 设计

### 一、能力是用户与系统之间的唯一语汇

工具仍是装配单位（schema、依赖、`generate_image` 的同步 / 排产分叉都在工具层），但开关、`play.json`、
`kit.can`、提示词章节一律说能力。`CAPABILITY_TOOLS`（一位一工具）与 `TOOL_GROUPS` 被能力目录取代；
`TOOL_CATALOG` 留着——它是工具层的真相源（id、中文名、谁装得上），能力目录只**引用**工具 id，由用例钉住不漂。

### 二、一个能力声明三件事

```ts
interface CapabilityCatalogEntry {
  label: string;   // 界面上的名字：「管理角色」
  desc: string;    // 一句后果：关掉它会发生什么
  group: CapabilityGroup;
  /** 授权哪些工具。按角色给：同一个能力在两边需要的口可能不同。 */
  tools: Partial<Record<AgentRole, readonly string[]>>;
  /** 打开它给这个角色哪几段写面（路径知识在 playFiles.ts，见「四」）。 */
  scopes?: readonly WriteScope[];
  locked?: true;   // 常开：界面不给开关，装配时无条件算开
  defaultOn: readonly AgentRole[];
}
```

装配走两条推导（都在 `createAgentKit` 一处）：**装上的工具** = 开着的能力声明的工具并集 ∩ 依赖面真装得出来的
（没配 Exa / TTS 的那几个照旧不注册），再加**基座工具**；**`can` 位** = 这个能力开着且它声明的工具都装上了
（键就是能力 id，一份语汇到底）。写面见「四」。

`read` 是**基座工具**：两个角色恒装，不出现在任何能力里。开关管的是「动不动手」，不是「看不看」——
这正是这次要修的：默认关掉「管理角色」不该顺手把读角色卡也收走（A 区角色表满 5 人后分级折叠，
不在场的角色只剩一行摘要，剧作家要靠 `read characters/x.md` 拿全卡让 ta 回场）。

### 三、能力目录

| id | 名字 | 分组 | 角色 | 授权工具 | 写面 | 默认 |
| --- | --- | --- | --- | --- | --- | --- |
| `stage` | 轮与状态 | 演出 | 剧作家 | `beat_done` `update_state` | — | **常开** |
| `characters` | 管理角色 | 角色 | 剧作家 | `write` `edit` | `characters` | **关** |
| `voice` | 音色库 | 角色 | 工坊 | `list_voices` | — | 开 |
| `memory` | 记忆 | 写作 | 剧作家 | `write` `edit` `read_memory_detail` `search_archive` | `memory` | 开 |
| `files` | 改剧目文件 | 写作 | 工坊 | `write` `edit` `set_craft` | `characters` `memory` `config` | 开 |
| `image` | 生图 | 素材 | 两个 | 剧作家 `generate_image`；工坊再加 `recut_sprite` | — | 开 |
| `library` | 素材资源库 | 素材 | 两个 | 剧作家 `list_library`；工坊再加 `import_asset` | — | 开 |
| `search` | 联网检索 | 查资料 | 两个 | `web_search` | — | 开 |
| `lineage` | 故事树 | 查资料 | 工坊 | `list_saves` `read_lineage` | — | 开 |
| `skill` | 技能库 | 搭台辅助 | 工坊 | `read_skill` | — | 开 |
| `view` | 看图 | 搭台辅助 | 工坊 | `view_image` | — | 开 |
| `readiness` | 检查开演条件 | 搭台辅助 | 工坊 | `get_readiness` | — | 开 |
| `nsfw` | 限制级通道 | 演出 | 剧作家 | `enter_nsfw` `exit_nsfw` | — | 开 |
| `shell` | 命令行 | 进阶 | 工坊 | `bash` | — | 关 |

行数：剧作家 **6 个开关 + 1 行常开**（今天 13 个工具 / 6 组），工坊 **10 个开关**（今天 16 个工具 / 8 组）。
「技能库」「看图」「检查开演条件」各占一行——它们互不相干，合成一行只是把三种诉求混在一个开关里。
「音色库」与「管理角色」同属**角色**组——音色（`voiceId`）本来就写在角色卡上；没有并成一个开关，因为工坊的角色卡
读写本来就是「改剧目文件」的一部分，并了会让「管理角色」在工坊那边名不副实。

各条 `desc` 的落点（写文案时按此，不出现工具名）：

- 管理角色——「自己写、改角色卡（人设、立绘取景）；关着时新角色走临时角色通道，完整卡去工坊补」
- 记忆——「自己把世界设定记成卡，并能翻找往事」
- 生图——「缺背景 / 立绘时自己画，后台出图不阻塞台词」
- 素材资源库——「查库里有哪些素材」；联网检索——「缺现实资料时上网查」
- 限制级通道——「能进入 / 退出限制级剧情」
- 改剧目文件——「直接读写角色卡、记忆卡、play.json 与写作参数」
- 故事树——「翻周目与分支记录」
- 技能库——「查跨剧目的通用做法」；看图——「把生成出来的图读进来说实话」；检查开演条件——「开演前查还缺什么」
- 音色库（工坊）——「挑 TTS 音色，配给角色卡」
- 命令行——「以服务进程权限跑命令，能绕开文件面（默认关）」

### 四、文件面：能力给写面，路径知识留在文件层，执行点在 agent 执行面

`playFiles.ts` 加三个**穷尽可写面**的 scope 与判定函数，路径只在这一层出现：

```ts
export type WriteScope = "characters" | "memory" | "config";
const SCOPE_PREFIXES: Record<WriteScope, readonly string[]> = {
  characters: [`${CHARACTER_DIR}/`],
  memory: ["memory/"],
  config: ["play.json", "theme.css", "assets/manifest.json"],
};
export function inWriteScopes(rel: string, scopes: readonly WriteScope[]): boolean;
export function isGeneratedFile(rel: string): boolean; // 已有的 isGenerated 导出
```

**执行点放在 `PlayEnv`，不是 `PlayFiles`。** 工坊只有一个 `PlayFiles` 实例（`workshopSession.ts:95`），
它同时是文件页的读写删口（`http.ts:371-389`）、craft / premise 的一等公民读写口（`http.ts:392-417`）、
`applyChanges` 里 bash 写坏 play.json 之后的读盘检查（`workshopSession.ts:265-272`）。scope 挂到它头上，
「关掉工坊的改剧目文件」会连带打断这四处用户面，还会把读盘拒绝误报成「play.json 解析不了」。
`PlayEnv`（`playEnv.ts:84-95` 的 `denial()`）本来就是 agent 唯一的路径检查点，scope 收在它构造上即可，
`PlayFiles` 一个字段都不用改。

**读面按角色给一条规则**（同样在 `PlayEnv`）：工坊 = 剧目可见面全开；剧作家 = 可见面减去引擎产物
（`memory/arcs/`、`memory/archive/`）。那两个目录跟分支走、按 arcIds / pathSet 过滤，而文件是剧目级、
不随回滚消失——通用 `read` 能直接读出来，等于把别的世界线的纪元摘要摊开（今天 `isVisible` 确实放行，
只挡写不挡读）。收窄后它们只剩 `read_memory_detail` / `search_archive` 这两个带过滤的工具能看。

引擎自己的写口不受影响，而且这是有意的：出图补 `sprites` 映射走 `playAssetsFor` 的实例（`playhouse.ts:373`）、
临时角色建卡走 `writeCharacter` 的（`playhouse.ts:548`）、引用即导入走 `assetImport` 的（`assetImport.ts:131`）。
**能力开关管的是这两个 agent 自己的手**；「关掉管理角色，出图带 characterName 时盘上还是多一张最小卡」
是引擎行为。

### 五、提示词跟着能力位走

**剧作家（`prompt.ts`）**

| 位置 | 现在 | 改后 |
| --- | --- | --- |
| `MEMORY_RULES`（记忆卡格式） | `can.files` | `can.memory` |
| 记忆索引段那句「或直接 read 那个文件」 | `can.files` | 不变（`read` 是基座工具） |
| 记忆索引段的 `read_memory_detail` / `search_archive` 教法 | 无条件 | 按 `can.memory` 收，关了换成「详情问用户 / 让工坊查」 |
| `newCharacterRules`（引入新角色的三步） | `can.files` | `can.characters` |
| 分级角色表末尾那句「要它的完整人设就走《引入新角色》建档」 | 无条件 | 按 `can.characters`；关着时改说「先 `read characters/<id>.md`」 |
| `imageChapter` / `LIBRARY_REF` / `SEARCH_GUIDE` / 限制级两段 | `can.image` / `can.library` / `can.search` / `can.nsfw` | 不变 |

`characters` 关掉时第 1 步换成：「本剧目没有给剧作家改卡的口。新角色直接上台：出图时带 `characterName`，
引擎会建一张最小卡，人设与音色由用户在工坊补；只出声不出图的用 `say` 的 `name` 属性。」三步的编号与
第 2、3 步原样留着。`MEMORY_RULES` 里那句「角色不在这里，走 `characters/<id>.md`」按 `can.characters` 收条件。

**工坊（`workshop.ts`）——这次要补的审计**

工坊提示词今天**没有一处**按能力位收条件（只有生图、库、音色、命令行收了），能力化之后
`files` / `lineage` / `skill` 关掉变成一次点击就能到达的状态，「教它调一个没有的工具」会从边角态变常态。
逐处收条件，或照 `NO_IMAGE_GUIDE` 的写法换成同形的 fallback 段：

| 位置 | 能力位 | fallback |
| --- | --- | --- |
| `talkRules`（先读后写 / 只改几段用 edit） | `files` | 收走 |
| `RESPONSIBILITY_RULES`（改文件必须真调 write / edit） | `files` | 换成「改文件没开：把要改的内容整理成清单给用户」 |
| `writingPoints` 的 play.json 字段表 / `set_craft` / manifest 编辑 | `files` | 收走（与用户讨论仍可，但不能落盘） |
| `setupFlow` 第 4 步（`set_craft`） | `files` | 收走 |
| `LINEAGE_GUIDE`（整章） | `lineage` | 换成「读故事树没开：让用户去回顾面板看」 |
| `skillsPrompt()`（教 `read_skill`） | `skill` | 收走 |
| `voicePickHint` / `imageGuide` / `workspaceSection` / 库相关 | `voice` / `image` / `shell` / `library` | 已收，不动 |

（workshop.ts 的 `can.files` 与剧作家那位是**同名不同义**：对工坊它是「能改剧目文件」，对剧作家恒为 false。）

### 六、默认集

| 角色 | 默认开 |
| --- | --- |
| 剧作家 | 常开 `stage` + 基座 `read`；`memory` `image` `library` `search` `nsfw`；**`characters` 关** |
| 工坊 | 「能力目录里工坊的那 10 个」减 `shell`；即 `files` `voice` `image` `library` `search` `lineage` `skill` `view` `readiness` |

工坊沿用今天「装得上的全部减 bash」的策略，写成「能力目录里工坊的那些减 `shell`」，新增能力不会静默漏装。
剧作家侧从「写口整块开」改成「记忆开、改卡关」：角色卡是**制作资产**（音色、立绘、取景都在卡上，工坊的地盘），
记忆卡是**剧情事实**（演出中自然长出来的）。

代价要说清：关掉之后，剧作家在戏里给新角色临时编的人设只活在当轮上下文与那张占位最小卡里，**不进记忆卡**
（角色设定有两份真相是这次要消的病）。要让新角色的设定留得住，要么打开这一项，要么去工坊补档。

### 七、Agent 页与 API

`GET /api/agents/capabilities`（替掉 `GET /api/agents/tools`）：

```ts
{ capabilities: Record<AgentRole, { id, label, desc, group, groupLabel, locked, available }[]>,
  defaults: Record<AgentRole, string[]> }
```

- `locked` 的行不给开关，渲染成灰字「始终开启」；
- `available: false`（服务端没配 Exa / TTS）时行尾补一句「服务端没配 Exa，暂不生效」——开关照旧能勾，
  配好 key 下次生效，既不摆一个勾了没用的开关，也不吞用户的选择。这两列是**新活**：今天的
  `playhouse.tools()` 没有它们，要把 exa / voices / assetLibrary 的配置状态引进 API；
- 界面按分组渲染「名字 + 一句后果」，**不再出现任何工具 id**。

### 八、play.json

`agents.<role>.tools` → **`agents.<role>.capabilities`**，语义不变：启用集，缺省 = 该角色默认集。
`capabilities: []` 不是「一个都不开」——常开的 `stage` 与基座 `read` 仍在，README 与界面按「只剩常开」写。
`locked` 的能力不往文件里写（写了也忽略）。

## 外部参照（只当命名与分组的参照）

同类产品里「把工具收纳成能力」是常见做法：ArgoUI 把 Skills Hub 与 Tools 合成一个 Capabilities 页（#2190），
hermes-agent 同样（#57590），DSH 的 dsh-capability-toggle 插件按能力家族（skills / MCP / tools / prompt /
security）管开关。它们都没有我们这三条约束（文件面、分支状态、提示词章节），只借「能力当用户语汇」这一条。

## 工具归属表（现有 22 个工具一个不落）

| 工具 | 归属 | 谁 |
| --- | --- | --- |
| `read` | 基座（不挂能力，恒装） | 两个 |
| `beat_done` `update_state` | `stage`（常开） | 剧作家 |
| `enter_nsfw` `exit_nsfw` | `nsfw` | 剧作家 |
| `write` `edit` | `characters`（`characters/`）+ `memory`（`memory/`）/ `files`（工坊三位全给） | 两个 |
| `read_memory_detail` `search_archive` | `memory` | 剧作家 |
| `generate_image` | `image` | 两个 |
| `recut_sprite` | `image` | 工坊 |
| `list_library` | `library` | 两个 |
| `import_asset` | `library` | 工坊 |
| `web_search` | `search` | 两个 |
| `set_craft` | `files` | 工坊 |
| `list_saves` `read_lineage` | `lineage` | 工坊 |
| `read_skill` | `skill` | 工坊 |
| `view_image` | `view` | 工坊 |
| `get_readiness` | `readiness` | 工坊 |
| `list_voices` | `voice` | 工坊 |
| `bash` | `shell` | 工坊 |

`import_asset` 在 `TOOL_CATALOG` 里的 `roles` 从 `["playwriter", "workshop"]` 收成 `["workshop"]`——
能力目录不再给剧作家授权它（它导入素材走 DSL 写 id、引擎自动导入），留着就是一个谁都要不到的孤儿工具。

## 合并掉的独立开关（三处）

| 今天能单独关的 | 改后 | 理由 |
| --- | --- | --- |
| 剧作家的 `import_asset` | 没了（剧作家侧「素材资源库」只给 `list_library`） | 它导入素材走 DSL 写 id、引擎自动导入；自己搬是重复路径 |
| 工坊的 `set_craft` | 并入「改剧目文件」 | 写作参数就写在 `play.json` 里 |
| 工坊的 `recut_sprite` | 并入「生图」 | 抠底脏了原地重抠，是生图的一个后续动作 |

## 实现方案

按这个顺序推进（前两步是签名级决定，定稿再动 `kit.ts`）：

| 文件 | 改动 | 量级 |
| --- | --- | --- |
| `packages/core/src/play/config.ts` | `AgentSettings.tools` → `capabilities`；解析同形 | ~15 |
| `apps/server/src/playFiles.ts` | `WriteScope` / `SCOPE_PREFIXES` / `inWriteScopes` / 导出 `isGenerated` | ~40 |
| `apps/server/src/agentkit/playEnv.ts` | 构造收 `{ writeScopes, readGenerated }`，`denial()` 两种模式分别判；错误消息把「不在剧目可写面」与「本剧目没给这个角色写这类文件」分开 | ~30 |
| `apps/server/src/agentkit/kit.ts` | 能力目录（14 行）+ 两条推导 + 基座工具；`CAPABILITY_TOOLS` / `TOOL_GROUPS` / `DEFAULT_ENABLED` 下线；`import_asset` roles 收窄 | ~160 |
| `apps/server/src/agentkit/deps.ts` | `enabled: Set<tool>` → `capabilities: Set<cap>` | ~5 |
| `apps/server/src/orchestrator.ts` `workshopSession.ts` | 传能力集；`PlayEnv` 带写面与读面 | ~20 |
| `apps/server/src/prompt.ts` | 上表六处 + fallback 文案 | ~50 |
| `apps/server/src/workshop.ts` | 上表六处审计 + fallback 文案 | ~60 |
| `apps/server/src/playhouse.ts` `http.ts` | `/api/agents/capabilities`（含 `locked` / `available`） | ~40 |
| `apps/web/src/api.ts` `workshop/AgentPane.tsx` | 能力开关 + 分组 + 常开行 + 不可用提示 | ~80 |
| 测试 | 见下 | ~300 |
| 文档 | README「剧目级 Agent 设置」、`apps/server/AGENTS.md`（能力位那两节）、本目录四件 | ~160 |

合计 ~950 行，单阶段。

测试清单（按影响面跑，不跑全量）：

- `agentkit.test.ts`：**装得上的工具集合 = 基座 ∪ 该角色被授权的工具**（工具层多一个孤儿、能力层写一个装不上的
  id，都要红）；默认集；按能力过滤后 `can` 位跟着翻；剧作家默认 `can.characters === false`、`can.memory === true`；
- `playEnv.test.ts`：**工坊 `files` 关**的整态——文件页 GET / PUT / DELETE、craft / premise 写口、`applyChanges`
  读盘检查、`view_image` 本地分支全部照旧（这几条正是「scope 不放 PlayFiles」的防回归钉子）；剧作家写
  `characters/x.md`（`characters` 关）与 `memory/arcs/x.md` 被拒且消息可读；剧作家 `read characters/x.md` 仍通（基座）；
  `read memory/arcs/x.md` 被拒；
- `prompt.test.ts` / `promptCapabilities.test.ts`：`memory` 开 `characters` 关 → 记忆章在、建档章换成 fallback、
  角色表末尾那句改指 `read`；两个都开 → 两章都在；两个角色的 `can` 仍是同一个对象；
- `workshopPrompt.test.ts`：`files` / `lineage` / `skill` 各关一次 → 对应章节收走或换成 fallback，逐字断言；
- `config.test.ts`：`capabilities` 解析、未知 id 丢弃、空数组保留、locked 能力不落盘；
- `playhouse.test.ts` / `http.test.ts`：新 API 的形状与 `locked` / `available` 两列。

## 不做

- 不留「高级：按工具勾」的第二套界面——一份语汇是这次的目的，两套必然漂。
- 不拆「建新卡」与「改既有卡」两个口：写面是同一段路径，拆了只是多一行开关。
- 不写 `play.json` 迁移：老文件的 `agents.<role>.tools` 不再读，老剧目回到新默认（唯一需要用户动手的地方）。
- 不引入全局级能力默认（`settings.json`）：仍旧逐剧目。
- 不改 A 区注入：能力位只决定 agent 能做什么，不决定它看到什么（记忆索引、角色表照旧每轮注入）。
- 不动引擎自己的写口（出图补映射、临时角色建卡、引用即导入）。
- 不给剧作家 `list_voices`：TTS 没配时它不注册，会让「管理角色」整位跟着掉；音色由工坊配是今天的边界。

## 风险与对策

| 风险 | 对策 |
| --- | --- |
| 关掉「管理角色」后模型仍想写卡 | 两层：提示词换成「这条路没给你」，`PlayEnv` 直接拒 |
| 新增工具忘了挂进能力 → 谁都勾不到 | 用例钉「装得上的工具 = 基座 ∪ 被授权的工具」，漏了当场红 |
| 新增一类可写文件，scope 没跟上 | 用例对着 `isEditable` 逐类断言三个 scope 穷尽可写面 |
| 工坊关掉某项能力后，提示词还在教它调 | 上表逐处收条件 + `workshopPrompt.test.ts` 逐字用例 |
| 老剧目静默回默认（有人关过生图 → 又开了，会花钱） | 写进 validation.md 的实机步骤；不写迁移是本项目既有约定 |
| 工坊的「命令行」绕开文件面与 scope | 早就是已知边界（bash 不走白名单），那一行的 desc 直说 |

## 已拍板（原「需要拍板的几处」）

1. **合并顺序**：`feat/generic-tools` 已 fast-forward 进 `main`（`fa05f12`），本分支 rebase 到主干 `88cef4f` 上开工。本分支何时合 main 由用户发话。
2. **默认集**照「六」的表：剧作家默认关「管理角色」。
3. **音色库与「管理角色」同组不合并**（角色组）；工坊的角色卡读写留在「改剧目文件」里。
4. **合并掉的三处开关**照「合并掉的独立开关」表执行。
5. **`read` 设成基座工具、`stage` 设成常开**，界面都不给开关。
6. 老 `play.json` 的 `agents.<role>.tools` **不读、不迁移**，老剧目回到新默认。

## 实际实现与原计划的差异

实施过程中定下的几处（与上面的计划表不同，以本节为准）：

- **`assist` 三合一被否**：计划过程中一度把「读技能库 / 看图 / 检查开演条件」合成一行 `assist`，用户否决——「并不直接相关的功能还是保持拆碎」。改回三行 `skill` / `view` / `readiness`（分组均为「搭台辅助」），目录 14 行、工坊 10 个开关。
- **`import_asset` 的作用域收在工具工厂里**：只在能力目录里不给剧作家授权还不够——`TOOL_CATALOG` 的角色标记与实际装得出来的工具必须一致，否则「装得上的工具 = 基座 ∪ 授权工具」的对账用例会红。实现是 `libraryTool` 多一个 `importAsset?: boolean`（缺省装），`playwriterTools` 传 `false`，`TOOL_CATALOG` 里它的 `roles` 同时收成 `["workshop"]`。
- **`CapabilityEnv` 只留 `search` / `voice` / `image`**：`library` 不进这个面——`AssetLibrary` 永远是构造出来的（`new AssetLibrary(join(dataRoot, "library"))`），谈不上「没配」，把它算进去会把一个空库误报成「暂不生效」。
- **`capabilityTools(cap, role)` 会再按 `TOOL_CATALOG.roles` 过滤一道**：能力目录只声明「这个能力要哪些口」，角色可见性仍归工具层，是同一个能力在两个角色上给出不同工具集的落点（`image` / `library`）。
- **读面拒绝先于写面**：`absolutePath` 是 read / write / edit 共同的路径入口，所以拿引擎产物路径去 write / edit 时撞上的是读面那句「引擎产物走不了通用读写口」，写面那句「本剧目没给这个角色开改…的能力」只对可见文件生效。两句各自的场景都有用例钉住（`test/playEnv.test.ts`）。
- **`capabilities` 的解析只管形状**（去空白、去重、保留空数组）：未知 id 与 locked 能力都在服务端丢/忽略，core 不引入第二份能力名单。
