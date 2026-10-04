# 能力开关 · 实施记录

## 来源

2026-10-04 用户提：「工具开关对一般用户太不友好，现在工具又通用化了，把工具开关变成能力开关
（可能影响提示词、也可能影响工具）」——举例「剧作家默认没法建角色，但能写记忆」。
工作区 `.worktrees/capability-switches`，分支 `feat/capability-switches`，基线 `main@88cef4f`
（前置的 `feat/generic-tools` 已 fast-forward 进 main）。计划与外部核查见同目录 `.plan.md` / `.crosscheck.md`。

## 一句话

Agent 页、`play.json`、`kit.can`、提示词章节现在说的是**能力**（「管理角色」「生图」），
工具退到装配层——同一个 `write` 因此能被拆成「能写记忆卡」和「能写角色卡」两种授权。

## 一、能力目录是唯一语汇

`apps/server/src/agentkit/kit.ts` 的 `CATALOG_ROWS`（14 行，`CAPABILITY_CATALOG` 是它的宽类型视图）：
演出 `stage`（常开）/ `nsfw`；角色 `characters`（剧作家，**默认关**）/ `voice`（工坊）；
写作 `memory`（剧作家）/ `files`（工坊）；素材 `image` / `library`；查资料 `search` / `lineage`；
搭台辅助 `skill` / `view` / `readiness`；进阶 `shell`（**默认关**）。

一行 = 界面名字 + 一句后果 + 分组 + 给哪些角色 + 授权哪些工具 id + 开出来能动哪几类文件 + 常开/默认关。
工坊 10 个开关、剧作家 6 个开关 + 1 行常开。`TOOL_CATALOG` 留着只写「这个工具谁装得上」，
能力只引用它的 id；装一个没登记的 id、或添一个谁都够不到的工具，用例当场红。

## 二、两条推导都在 `createAgentKit`

- **装上的工具 = 基座 `read` ∪ 开着的能力授权的工具**（再按 `TOOL_CATALOG.roles` 与依赖面收一道：
  没配 Exa / TTS / 生图后端就装不出来）；
- **`can` 位 = 该能力开着且它授权的工具都装上了**——键就是能力 id，非适用角色恒为 false。
  两个角色的提示词读的是同一个对象，不会各算各的。

同一个能力在两个角色上给出的口可以不同：`image` 剧作家只拿 `generate_image`、工坊多拿 `recut_sprite`；
`library` 工坊多拿 `import_asset`（实现上是 `libraryTool` 的 `importAsset: false`，工厂与目录的角色标记
必须一致，否则孤儿工具用例红）。

## 三、文件面：能力给写面，路径知识留在文件层，执行点在执行面

- `playFiles.ts` 新增 `WriteScope`（`characters` / `memory` / `config`）、`SCOPE_PREFIXES`、
  `writeScopeOf` / `inWriteScopes` / `WRITE_SCOPE_LABELS`，并导出原先私有的 `isGenerated`。
  `writeScopeOf` 先过 `isEditable`，所以引擎产物与 `assets/**` 天然没有 scope。
- `PlayEnv` 构造函数改收 `(files, policy: PlayEnvPolicy, onWrite)`，`policy = { writeScopes, readGenerated }`：
  - 写面：不在 scope 内 → 「本剧目没给这个角色开改角色卡 / 记忆卡 / 剧目文件的能力：X」；
  - 读面：`!readGenerated && isGenerated` → 「引擎产物走不了通用读写口：X（往事走 `read_memory_detail` /
    `search_archive`）」——只有工坊 `readGenerated: true`，剧作家按路径翻不到 `memory/arcs` / `memory/archive`
    （那两个目录按分支过滤，通用 `read` 直接翻等于把别的世界线摊开）。
- scope 不进 `PlayFiles`：工坊只有一个 `PlayFiles` 实例，它同时是文件页、craft / premise 写口与
  `applyChanges` 读盘检查的口，挂上去会连带打断这四处用户面。

## 四、提示词跟着能力位走

- 剧作家（`prompt.ts`）：`MEMORY_RULES` 与记忆索引段的教法跟 `can.memory`；
  `newCharacterRules(can.characters)` 与分级角色表末尾那句跟 `can.characters`（关着时改说
  「先 `read characters/<id>.md`」）；生图 / 库 / 检索 / 限制级照旧各跟自己的位。
- 工坊（`workshop.ts`）这次补了整轮审计——从前只有生图 / 库 / 音色 / 命令行收条件：
  `responsibilityRules(can.files)`、`talkRules`（无 `files` 整章返回 ""）、`lineageGuide`、
  `writingPoints`、`setupFlow` 第 4 步、`skillsPrompt()` 全部按位分叉或收走。
  play.json 字段表里的 `tools` 也改成了 `capabilities`。

## 五、API 与界面

- `GET /api/agents/tools` → `GET /api/agents/capabilities`：返回每个角色的能力目录
  （id / label / desc / group / groupLabel / locked / available / unavailableNote）与每个角色的默认集。
  `available: false` 表示服务端没配 Exa / TTS / 生图后端，界面临时补一句「暂不生效」，开关照旧能勾。
- `AgentPane.tsx` 按 `groupLabel` 分组渲染「名字 + 一句后果」，`locked` 渲染成灰字「始终开启」不给开关，
  **界面上不再出现任何工具 id**。样式类名沿用 `agent-tool-group` / `switch-row`，CSS 一行未动。
- `packages/core` 的 `AgentSettings.tools` → `capabilities?: string[]`：core 只做形状解析
  （去空白、去重、保留空数组），未知 id 与 locked 能力都在服务端丢/忽略。**不写迁移**，老文件的 `tools` 不再读。

## 六、验证

```
pnpm -r build        # core / server / web 全过（web 走 vite build）
pnpm typecheck       # 三个包全过
pnpm test            # core 155 passed / web 177 passed / server 631 passed, 3 skipped
```

server 那 3 个 skip 是既有真跑生图的 e2e（`e2e-live-image` / `e2e-live-senren`，按仓库约定默认不跑）。

本轮新增 / 重写的用例：

- `test/agentkit.test.ts`（重写 23 条）：孤儿工具双向钉子（装得上的工具 = 基座 ∪ 被授权的工具）、
  目录形状、默认集、启用集解析、写面并集、工厂 vs 目录对账；
- `test/playEnv.test.ts`（15 条）：工坊关 `files` 时文件页 GET / PUT / DELETE、craft / premise 写口、
  `applyChanges` 读盘检查、`view_image` 本地分支照旧（scope 不放 `PlayFiles` 的防回归钉子）；
  剧作家写角色卡被拒而 `read` 角色卡仍通；写 `memory/arcs/x.md` 撞读面那句话；
- 新建 `test/playFiles.test.ts`（3 条）：三个 scope 穷尽可写面 + 大小写；
- `test/promptCapabilities.test.ts`（重写 9 条）与 `test/prompt.test.ts` 的「写口与提示词一致性」
  describe：能力位四态 + 分级表指路；
- `test/workshopPrompt.test.ts` 加 3 条能力门用例（`files` / `lineage` / `skill` 各关一次）。
- `packages/core/test/config.test.ts` 加 4 条：启用集去空白 / 去重、空数组保留（= 只剩常开，
  与「没写、走默认集」不同义）、非数组当没写、拼错的 id 这一层不校验（认不认得出是能力目录的事）。
- `test/playhouse` / `http` 的 API 形状用例同步跟上（新端点、`locked` / `available` 两列）。

实机验收步骤（尤其「老剧目静默回默认」这条）见同目录 `.validation.md`。

## 七、与原计划的差异

见 `.plan.md` 的「实际实现与原计划的差异」：`assist` 三合一被否（拆回三行）、
`import_asset` 的作用域收在工具工厂里、`CapabilityEnv` 只留 search / voice / image、
`capabilityTools` 再按 `TOOL_CATALOG.roles` 过滤一道、读面拒绝先于写面。

## 未做

- 不留「高级：按工具勾」的第二套界面。
- 不拆「建新卡」与「改既有卡」两个口（写面是同一段路径）。
- 不写 `play.json` 迁移：老剧目的 `agents.<role>.tools` 不读，回到新默认（唯一需要用户动手的地方，
  已写进 validation）。
- 不引入全局级能力默认（`settings.json`），仍旧逐剧目。
- 不动引擎自己的写口（出图补映射、临时角色建卡、引用即导入）——关掉「管理角色」后出图带
  `characterName` 仍会多一张最小卡，那是引擎行为。
- 不给剧作家 `list_voices`（TTS 没配时它不注册，会让「管理角色」整位跟着掉）。
