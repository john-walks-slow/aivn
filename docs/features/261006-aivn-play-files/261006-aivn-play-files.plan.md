# 去掉 create_play，把「剧目怎么长」写进提示词（2026-10-06）

## 决定（用户 2026-10-06）

> 我觉得去掉 create play 比较好。最多留 validate（不过那个是不是已经有 readiness 负责了？
> maybe 将 readiness 改成 validate_play）。至于怎么让模型知道各种东西放哪里以及各自的 schema
> 才是你应该考虑的（通过提示词之类的），而不是加一个特殊的 create play。

采纳。`create_play` 是**工具面里的第二条写文件路径**：它做的三件事（写 `play.json`、写前提、
写角色卡）文件工具都能做，而模型无论走哪条路都得知道「东西放哪、字段什么形状」——那份知识属于
提示词，不属于工具。加一个专用工具，等于同时维护两套说法，还多一处会漂的入口。

## 改法

**1. 删掉 `create_play`（工具与提示词里的它）**

- `src/tools/create-play.ts` 删除；`preset-tools.ts` 的基础层只剩 `list_assets`。
- 人侧的 `/new-play` 命令**保留**（它是用户按的按钮，不花 LLM 往返），继续用 `scaffoldPlay`。
  于是「手写」与「脚手架」两条路仍在，靠同一章文本保证落出同一个形状。

**2. 新增共用的《剧目文件》章（`src/play-files.ts`）**

一段文本，**两个预设都挂**：目录骨架（每份文件是什么）、`play.json` 的字段表（含 `id` 的
命名规则）、角色卡格式（frontmatter 三键、YAML 标量要引号、主角固定 `protagonist`）、
以及「动笔前先 read，已存在的别覆盖」。

字段表照 `@aivn/core` 的 `parsePlayConfig` 写：`id` / `title` 必填，其余缺省；`craft` / `image` /
`agents` 指给专门入口（`set_craft` 与设置界面），不教手写。这章替换掉了两处旧文本：
剧作家提示词里那句「用 `create_play` 把它立起来」，搭台助手的 `NEW_PLAY` 章，
以及两处各抄了一遍的目录骨架（改一处漏一处的来源）。

**3. `get_readiness` → `validate_play`**

用户问「那个是不是已经有 readiness 负责了」——是同一个工具，改名的同时补上它唯一缺的那件事：
`play.json` 在但读不出来时，原来会**抛异常**（`loadPlaySync` 直接往上抛），现在改成把引擎那句
原因报出来（`readiness.ts` 的 `problem` 字段，注入的《当前状态》与工具回执共用同一份渲染）。
于是它的语义完整了：**刚写完剧目文件，问它写得对不对、还缺什么**。

它仍归搭台助手（AIVN 的 `CATALOG_ROWS` 里 `readiness` 就在工坊那一侧，`verify-injection` 的
A13 就是这条）；剧作家没有它——它要写的那几份文件（前提、卡片）本来也没有校验器。

## 影响面

- 工具面：两个预设都少一个工具，搭台助手多一个改名的（`validate_play`）。
- 提示词：剧作家与搭台助手都多一章《剧目文件》，少了各自的重复文本与 `create_play` 说法。
- 健壮性：`play.json` 坏掉时不再把一轮请求炸掉，而是报成一句能读的话。
- e2e：`verify-stagehand` 的 S13/S14 换名字、S18 断言新章在提示词里；
  `verify-injection` 的 A13 换名字、新增 A13b（没有 `create_play`）与 A14（剧作家也有那一章）。
- README 中英文、插件 AGENTS.md 同步。

## 没动的东西

- `set_craft`：它也是「写 `play.json` 的一段」，但带白名单与「省略 / `null`」两套语义，
  不是文件工具能表达的东西；**同一问题，留着待议**。
- 素材类工具（`commit_asset` / `recut_sprite`）：它们做的是图像处理与台账，不是写一个字段。
- `scaffoldPlay` / `/new-play`：见上，保留。
