# 生图与入库解耦（草稿区 + 显式采用）

## 动机

工坊要能「一次出 3 张候选 → 用户挑一张 → 只把选中的那张入库」。现在的 `generate_image`
一次调用就把图写进 `assets/` 并顺手改 `assets/manifest.json`（呈现声明），于是：

- 候选图会直接污染素材表与 manifest，选没选中的都躺在剧目素材里；
- 没法在「出图」和「这张图是谁、放哪儿、什么取景」之间插一个人来挑。

## 目标形态

**generate 只负责生成，绑定是另一件事。**

- `generate_image`（工坊）→ 出图 + 抠底 → 落在半临时草稿区，**不写 `assets/`、不碰 manifest**。
  回执带草稿 id 与预览 URL。
- 新增 `commit_asset`（只装工坊）→ 把一张草稿正式入库到 `assets/sprites/<id>/<variant>.png`
  （或 backgrounds/cg），**此时才**写 manifest 呈现声明与生成台账。

剧作家那条路不变：它没有「让用户挑」这回事——工具调用本身就声明了最终 id，宿主在后台
`generate()`（= draft + commit）一次做完，时间线的骨架 → `asset_ready` 语义原样保留。

## 草稿区

`<剧目根>/media-cache/drafts/<draftId>/`

| 文件 | 内容 |
| --- | --- |
| `image.<ext>` | 可预览的成图；立绘是抠底后的透明 PNG |
| `source.<ext>` | 立绘抠底前的原片，入库时搬进 `media-cache/sprite-sources/` |
| `draft.json` | 出图时的意图：kind / spriteId / variant / name / framing / stature / title / prompt / aspect / createdAt / committedAt |

- 整个目录在 `media-cache/` 下，本来就不进 git、可重建。
- 预览 URL：`/plays/<playId>/drafts/<draftId>/image.png`（新增静态路由，与 tts 那条同形）。
- 建新草稿时顺手清掉超过 7 天的旧草稿目录（best-effort）。

## 立绘的身份基准

- 草稿**不吃**「自动补 neutral」：非 neutral 立绘找不到**已入库**的 neutral 就直接报错，
  让用户先出定妆照候选、采用一张，再出差分。这样候选流程与老规矩（差分必须有基准）一致。
- `generate()`（剧作家 / 手动生图）保留自动补 neutral：那边没有人在挑，先定一张再派生是必要的便利。

## API

```ts
draft(target, prompt, style?): Promise<DraftedAsset>      // 只生成，落草稿区
commit(draftId, options?): Promise<GeneratedPlayAsset>    // 入库：写 assets + manifest 声明 + 台账
generate(target, prompt, style?, options?)                // = draft + commit（+ 自动补 neutral），签名不变
```

**落位就用草稿出图时的意图**，`commit` 只收一个 `draftId`——候选之间的差别在画面不在身份
（定妆照的三张候选都按 `variant="neutral"` 出图，挑中的那张就按 `neutral` 入库）。
不开口子让 commit 改身份：多一个参数就多一条「图是按 A 出的、绑成 B」的错法，而没有真需要它的场景。

## 影响面

- `store.ts`：草稿目录与路径。
- `playAssets.ts`：`draft` / `commit` / `generate` 重构；`persist` / `declareSprite` / `recordPrompt` / 留底都挪到 commit。
- `http.ts`：草稿预览静态路由 `/plays/:id/drafts/<draftId>/<file>`。
- `agentkit/imageTool.ts`：sync 描述改成「出草稿」，回执带 draftId；草稿预览照旧走 `onAsset` 推气泡
  （不推的话默认折叠的工具行会把候选藏起来）。
- `agentkit/commitTool.ts`（新）：`commit_asset(draftId)`。
- `agentkit/kit.ts`：`TOOL_CATALOG` 与 `image` 能力加 `commit_asset`（只工坊）。
- `workshop.ts` 的 `imageGuide()`、`skills/sprite-differences`：3 候选 → 采用 → 出差分的新节奏。
- `apps/web` 的 `WorkshopMarkdown`：`assetUrl` 放行 `/plays/<id>/drafts/…`。
