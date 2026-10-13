# 工坊 `generate_asset` 生图失败：草稿路径不在剧目可读范围（261013）

## 现象

用户在工坊发起一步生图（`generate_asset`）时，图片在后端实际生成落进 `media-cache/drafts/<draftId>/image.jpg` 后报错：

```
生图失败：路径不在剧目可读范围: media-cache/drafts/cac65613-856f-4e68-a990-5240c742c36f/image.jpg
```

## 根因

`apps/server/src/agentkit/assetTool.ts` 的 `runSync`（工坊同步走 `@aivn/agent` 的 `asset.generate` 宏：出候选 → 抠底 → 登记）在 P5-c 接入时直接照搬了 DSH 插件侧的写法，与独立版服务端的两处契约不一致：

1. **草稿句柄 vs 磁盘相对路径**：
   - 独立版服务端的 `PlayFiles` 读白名单（`isVisible`）只放行剧目编辑面与 `assets/`，**不放行 `media-cache/`**；草稿在服务端通过 `draft:<draftId>` 句柄由 `PlayAssets.readSource` 解析。
   - 但 `assetTool.ts` 的 `runSync.produce.run` 返回了 `{ path: draft.path, adopted: false }`（即 `media-cache/drafts/<draftId>/image.jpg`），随后传给 `assets.register(source, ...)`。
   - `PlayAssets.readSource` 只认 `^draft:(\S+)$`，遇到 `media-cache/drafts/...` 落入普通文件分支 `this.deps.files.pathOf(src, "read")`，当场触发 `路径不在剧目可读范围: media-cache/drafts/...`。
2. **立绘同步生图的 `cut` 回调**：
   - `runSync` 注入了 `cut: async ({ source }) => ({ path: (await assets.cut({ source })).path })`。
   - 独立版没有给 `cut` 设临时输出区，`PlayAssets.cut({ source })` 不带 `output` 必报 `抠底要 output（本宿主没有候选区…）`；而自 `261012-sprite-ingest` 起，`PlayAssets.register` 在立绘入库时已自带 `normalizeSprite`（去底 + 画布归一化 + 落位指标入表）。

## 修复路径

1. **`apps/server/src/agentkit/assetTool.ts`（`runSync`）**：
   - `produce.run` 返回 `draft:${draft.draftId}` 句柄。
   - `cut` 回调直接透传 `{ path: source }`：让 `asset.generate` 宏照常把 `original: produced.path`（即草稿句柄）随 `register` 一并传入，由 `PlayAssets.register` 统一完成立绘去底、画布归一化、原片留底（`media-cache/sprite-sources/`）与素材表指标写入。
2. **`apps/server/src/playAssets.ts`（`draftIdOf`）**：
   - 收口草稿标识解析 `draftIdOf(source)`（供 `readSource` 与 `cutFraming` 共用）：除 `draft:<draftId>` 外，兼容 `(?:media-cache/)?drafts/<draftId>/image.<ext>` 与 `/plays/<playId>/drafts/<draftId>/image.<ext>`，防止调用方或模型直接传草稿路径/预览 URL 时撞上 `PlayFiles` 白名单报错。

**置信度**：100%。

## 验收标准

- 工坊 `generate_asset` 同步生成背景 / CG：成图正常落入 `assets/backgrounds/` 或 `assets/cg/`，回执带预览 URL，不再报「路径不在剧目可读范围」。
- 工坊 `generate_asset` 同步生成立绘：成图经去底与画布归一化落入 `assets/sprites/<id>/<variant>.png`，`assets/manifest.json` 含 `figureTop` / `figureHeight` 指标，`media-cache/sprite-sources/` 留有色键底原片。
- `PlayAssets.register` 与 `PlayAssets.cut` 传入 `draft:<id>` 或 `media-cache/drafts/<id>/image.jpg` 均可正常解析草稿。
