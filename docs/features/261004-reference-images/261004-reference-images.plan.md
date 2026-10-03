# 通用垫图入口（references）设计计划

## 背景与目标

`generate_image` 原有的垫图能力有两个硬编码限制：

- **sprite**：只有 `expression !== "neutral"` 时才自动拿本角色的 `neutral` 立绘垫图；出 `neutral` 定妆照时 `referencesFor` 直接 `return []`，只能纯文生图。于是「用户给一张既有角色图，让工坊垫着它出一张定妆照」这条路走不通。
- **background / cg**：只能通过 `referenceCharacters`（剧目内角色 id 列表）垫图，垫的还只能是角色立绘，无法直接给一张外部图（用户上传的参考图、网络图）。

目标：把「参考图」抽象成一个**统一的入口**——`references`，每个条目可以是角色 id、剧目内相对路径或 http(s) 网址；让 `neutral` 定妆照也能垫图。这不是为某个场景加一个旁路参数，而是把原先「只有差分自动垫 neutral」这一条特例泛化成通用能力。

**范围内**：垫图入口本身（工具参数、解析、加载、提示词后缀、queued 链路透传）。
**范围外**（用户明确要求先不做）：工坊对话框直接收图、角色卡记录参考图来源字段、参考图验收工具。

---

## 参数设计

新增 `references: string[]`（1–6 项），每项三种形态之一：

| 形态 | 例子 | 解析 |
|---|---|---|
| 角色 id | `"alice"` | 取该角色立绘：优先 `neutral`，否则任意一张差分 |
| 剧目内路径 | `"assets/backgrounds/ref.png"` | 走 `PlayFiles.absoluteOf` 白名单读盘 |
| http(s) URL | `"https://…/alice.jpg"` | 走 `webImage.ts` 下载（内网地址挡死） |

`referenceCharacters` **保留为兼容别名**：与 `references` 在 `imageTool.resolveRefs` 里合并去重、封顶 6 项。工具 schema 仍是两个角色的同一份。

---

## 垫图规则（唯一不变式）

- **立绘差分（非 neutral）**：身份基准**恒为该角色的 `neutral` 定妆照**。调用方带 `references` 直接报错——差分基准被换掉会与既有差分不是同一个人，且演出中静默换脸。要换基准就把 `neutral` 重出一遍（那一次可以带 `references`）。
- **neutral 定妆照**：带 `references` 就按它垫图出图（首次定妆、用户给既有角色图都从这里进来）；不带就是纯文生图。
- **background / cg**：按 `references` 垫图（角色立绘、剧目内路径、网络图都行）。
- `STAGE_IMAGE_REFERENCE=none` 仍是全局开关，显式指定的参考图同样归它管。

---

## 实现要点

### 1. 工具层 `apps/server/src/agentkit/imageTool.ts`

- schema 新增 `references`，`referenceCharacters` 降为兼容别名。
- `resolveRefs(params)`：合并两字段 → 去重 → 截断 6 项。
- `REFERENCE_RULE` 改写为统一垫图说明，并写明「非 neutral 差分不吃 references」。
- `runSync` / `runQueued` 都调 `resolveRefs`；queued 的 `kickSprite` 补传 `references`。

### 2. 装配层 `apps/server/src/playAssets.ts`

- `AssetTarget` / `AssetSpec` 增加 `references`；解析结果 `ResolvedReference { name, characterId?, source }`。
- `resolveReferences(items)`：URL 原样、角色 id 经 `referenceSpriteOf` 解析、`assets/`/`plays/` 路径校验存在；**不含斜杠且不在角色表里的项按角色卡报错**（不做静默丢弃）。
- `referencesFor(spec)`：按上面三条规则装配；差分带显式参考图 → 抛错。
- `loadReference(source)`：URL 走注入的 `fetchImage`；本地读盘后 `sniffImageMime` 失败即报错（不兜底 `image/jpeg`）。
- 提示词后缀：全具名角色沿用 `referenceSuffix`（点名「第几张是谁」，多人 CG 不串脸）；含路径/URL 时走新增的 `genericReferenceSuffix`；neutral 垫图在 `neutralSuffix` 之后追加 `neutralReferenceTail`。

### 3. 透传链路 `apps/server/src/{playhouse,orchestrator}.ts`

- `playhouse.preloadAsset` / `preloadSprite` 接收并透传 `references` 到 `PlayAssets.generate`。
- `orchestrator.ts` 的 `imageTools` 类型同步；装配处 `kick` / `kickSprite` 转发第 4/5 参。
- `playAssetsFor` 给 `PlayAssets` 注入 `fetchImage: this.webImage`。

---

## 影响面与向后兼容

- 既有差分派生逻辑不变（仍以 `neutral` 为基准）。
- 既有 `referenceCharacters` 调用行为不变（合并进 `references`）。
- 角色卡 / play.json / manifest.json 无结构改动。
- OpenAI 生图协议不支持垫图，原有报错保留。
