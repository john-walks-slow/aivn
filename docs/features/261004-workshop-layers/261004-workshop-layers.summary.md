# 角色卡顶层化、主角升格与工坊页签重划 — 实施总结

## 背景

原结构里角色是「记忆的一层」：角色卡放在 `memory/always/characters/<id>.md`，而名字/音色/立绘差分映射这些机器字段又散在 `play.json` 的 `characters[]` 与 `protagonist` 里。同一个角色被切成两处、三类数据，工坊也把「设定与记忆」挤在一个页签里——改一个标题要落 `play.json`，改一张卡要落记忆目录，用户得先分清「这条改动落在哪个文件上」。

本次做三件事：

1. 角色卡上移到剧目顶层 `characters/`，`play.json` 不再承载任何角色数据。
2. 工坊「设定与记忆」拆成「剧目」与「记忆」两个页签，剧目排在角色之前。
3. 主角升格为一张普通角色卡（id 固定 `protagonist`），与别的角色同权。

计划见 [`plan.md`](./261004-workshop-layers.plan.md)，检视报告见 [`review.md`](./261004-workshop-layers.review.md)，用户验证见 [`validation.md`](./261004-workshop-layers.validation.md)。

## 做法

### 角色卡顶层化

- `packages/core/src/play/characterCard.ts` 成为角色路径的唯一真相源：导出 `CHARACTER_DIR`、`PROTAGONIST_ID`、`characterCardPath(id)`、`isProtagonist(id)`。各处不许再手抄字符串。
- `PlayConfig.protagonist` 与 `ProtagonistCard` 接口删除（`parsePlayConfig` 里那条分支一并撤掉）；`PlayConfig.characters` 保留为纯元数据，没有运行时逻辑读它。
- `store.characterDir()` 供 `loadCharacters`（记忆层）、`loadCharacterCards`（REST cast）、`assetImport` 共用；`PlayFiles` 的 `DIR_ROOTS` 加 `characters`，`characters/**` 进可写白名单。

### 主角 = 一张普通卡

- 主角不靠 frontmatter 标记来认——`characters/` 的不变式是「角色表 = 目录的文件列表」，再用固定文件名 `protagonist.md` 指认主角，天然排除「两个主角」或「零个主角」。
- `store.createEmpty` 建目录时就写一张主角卡（正文「（玩家扮演的角色。还没有写设定。）」）。**空文件会被 `loadCharacters` 跳过**，只建目录不写卡的话角色表里根本没有主角。
- 主角与别的卡能力完全一致（上台、立绘、音色、从资源库导入都照常），只有两处特殊：A 区角色表标注「，玩家扮演」（`prompt.ts` 读 `isProtagonist`）、工坊角色页不给删。**是否上台、是否配音交给剧目自己的 `memory/always/craft.md`**，引擎不预设。
- `assetImport` 里主角与普通角色的唯一差别是落点：`target: "protagonist"` → `characters/protagonist.md`，立绘与差分映射一起导（原先「主角不导立绘」的理由——主角没有立绘位——已经不成立）。
- `playhouse.polish()` 不再读 `play.json`，改读主角卡拼「主角设定：」。

### 工坊页签

- `stage/view.ts` 的 `WorkshopTab` / `TABS` 是顺序唯一真相源：对话 / 剧目 / 角色 / 记忆 / 素材 / 文件 / Agent / 设置。
- `PlayPane`（新）：只写 `play.json`（标题 / opening / 语音语言 / 无名角色音色 / 封面选图），是唯一写剧目字段的页。
- `MemoryPane`（新，取代 `SettingsPane`）：只剩 `memory/**` 卡片，`arcs/` 与 `archive/` 不列。
- `CharacterPane`（重写）：`detail.cast` 即全部角色卡，主角只是其中一张；保存只写 `characters/<id>.md`，这一页一个字节都不碰 `play.json`。

### 数据迁移

仓库样例 `plays/demo` 已迁移（`koharu.md` 上移、`protagonist.md` 新建、`play.json` 删 `protagonist` 字段）。本机其余剧目按 AGENTS「未上线不考虑旧版迁移」不写运行时兼容路径，由用户跑一次性脚本 `scripts/migrate-play-layout.mjs`（默认 dry-run，`--apply` 才动盘，软链接一律跳过——worktree 里指向主工作区的那些软链绝不能被顺着写下去）。

## 测试与验证

- `pnpm -r typecheck` 干净。
- core 9 文件 129 用例、server 37 文件 508 用例（不含 e2e-live）、web 24 文件 162 用例全绿。
- 本 worktree dev 实例实机走查：八页签顺序、剧目页字段、记忆页只剩记忆、角色页主角卡（含「玩家扮演」与 `characters/protagonist.md` 路径）、文件页顶层 `characters/`；`GET /api/plays/demo` 的 cast 含主角。

## 检视后修改（条件准入 → 已处理）

| 来源 | 问题 | 处理 |
| --- | --- | --- |
| S1 | 角色页对主角卡缺失（没迁移的老剧目、卡被清空）没有兜底，用户无处编辑或恢复 | `rolesOf` 在 cast 里找不到主角时补一张空卡（名字「你」），编辑后照常落 `characters/protagonist.md`；补了回归用例 |
| S2 | 计划里规划的 `playPane.test.tsx` 遗漏 | 新增该测试（字段渲染 / 改标题 + 拾取封面 / 恢复自动挑选 / 清空音色 / 只走 `savePlay`） |
| N1 | README 页签表行序与实现不一致 | 表格改为 对话 / 剧目 / 角色 / 记忆 / 素材 / 文件 / Agent / 设置 |
| N2 | `FileEditor` 的「基准」跟着 `value` 走：敲一个字后 dirty 立刻被重置，保存键刚亮就灭，还提前显示「已保存」 | 改由 `MemoryPane` 持有 `drafts` 与盘上那份 `onDisk`，dirty 由两者比出来（对齐 `FileBrowser` 的既有做法）；补了回归用例。实机复验：输入后保存键可用、「已保存」只在真保存后出现 |

## 遗留

- `scripts/migrate-play-layout.mjs` 是一次性脚本：用户迁完本机剧目后可以删，也可以留着换机用。
- 本机其他剧目的迁移由用户自行执行，不在本次范围内。
