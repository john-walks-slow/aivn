# 去掉 create_play：剧目靠写文件立起来（2026-10-06）

设计与理由见同目录的 [plan](261006-aivn-play-files.plan.md)。这里记实施结果。

## 落地了什么

**1. `create_play` 删除**（工具、两处提示词说法、README 的中英两版、插件 AGENTS.md 的结构表）。
基础层只剩 `list_assets`；人侧 `/new-play` 与 `scaffoldPlay` 保留——它是用户按的按钮，
不花 LLM 往返。

**2. 新增共用的《剧目文件》章**（`src/play-files.ts`，两个预设都挂）：

- 目录骨架：`play.json` / `memory/always/premise.md` / `memory/always/craft.md` /
  `memory/index/<层>/<名>.md` / `characters/<id>.md` / `assets/*` / `assets/manifest.json` 各是什么；
- `play.json` 字段表：`id`（命名规则）、`title`、`opening`、`characters`、`scriptLanguage`、
  `initialScene` 写什么，`craft` / `image` / `agents` 指给专门入口；
- 角色卡格式：frontmatter `name` / `sprite` / `voice` + 正文，YAML 标量要引号，
  主角固定 `protagonist`；
- 纪律：动笔前先 read，`play.json` 已经在了别覆盖，改它用 edit 定点改。

这一章替换掉了三处旧文本：剧作家提示词里「用 `create_play` 立起来」那句、搭台助手的 `NEW_PLAY` 章、
以及两个提示词各抄了一遍的目录骨架（改一处漏一处的来源）。

**3. `get_readiness` → `validate_play`**：改名之外补上它缺的那件事——`play.json` 在但读不出来时
原来直接抛异常，现在把引擎那句原因报出来（`readiness.ts` 的 `problem`），注入的《当前状态》与
工具回执共用同一份渲染。它仍归搭台助手（与 AIVN 的 `CATALOG_ROWS` 一致）。

## 验证

| 套件 | 结果 |
| --- | --- |
| `injection`（A1–A14）：剧作家工具面没有 `create_play` / `validate_play` / `set_craft`，收束口在；剧作家的提示词里有《剧目文件》 | 16/16 ✓ |
| `stagehand`（S1–S18）：搭台助手装上 `list_assets` / `validate_play` / `set_craft`，`create_play` 与旧名不在；提示词里有《剧目文件》 | 19/19 ✓ |
| `stagehand / verify-handmade-play`（新增 H1–H4）：清掉工作区的剧目 → 让搭台助手把目录立成一座剧目 → 它**自己写出的 `play.json`** `id`/`title` 合规，引擎读得出来 | 4/4 ✓ |

H1–H4 是这次改动的关键证据：工具面少了一个「起剧目」工具之后，模型靠提示词那一章照样把剧目
立起来了（实测写出的 `id` 取自工作目录名、带上了 `characters`，一次成功）。

## 副作用与待办

- **静态前缀会烘焙**：搭台助手的 persona 前缀（身份 + 《剧目文件》 + 职责边界 + 对话风格）在
  预设装载时烤成静态文本，改了它要重挂预设才生效——线上实例下次重启才看得到新章，
  e2e 每次 `dsh-e2e start` 都是新的，所以套件跑得到。
- `set_craft` 没动：它也是「写 `play.json` 的一段」，但带白名单与「省略 / `null`」两套语义，
  不是文件工具能表达的东西。**同一问题，待议。**
- `validate_play` 仍只在搭台助手那一侧。剧作家落在空目录里时也会照《剧目文件》写 `play.json`，
  但它没有校验工具——要给它的话是 `preset-tools.ts` 基础层加一行的事（待议）。
