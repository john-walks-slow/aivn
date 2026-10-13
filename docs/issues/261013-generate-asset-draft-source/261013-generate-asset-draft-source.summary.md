# 工坊生图与素材寻址极简收口 — 实施小结（261013）

## 问题回顾

1. 工坊 `generate_asset` 同步出图报 `生图失败：路径不在剧目可读范围: media-cache/drafts/<id>/image.jpg`；
2. 模型调用 `read` 查看候选草稿或用候选草稿做 `references` 垫图时报错；
3. 模型从资源库导入 BGM（`import_asset`）报 `kind: must be equal to one of the allowed values`，且 `source="library:<kind>/<id>"` 与外层 `kind` 重复指定分类、单复数打架。

## 最终极简方案（已落地）

1. **剧目内文件一律直传相对路径，废除 `draft:<id>` 与 `sprite:<id>` 冒号伪协议**：
   - `PlayFiles` 只读白名单放行 `media-cache/drafts/`；
   - `generate_image` 回执直接给剧目内相对路径 `media-cache/drafts/<id>/image.<ext>`；
   - `read` 看图、`cut` 抠底、`import_asset` 入库、`references` 垫图全部传同一个相对路径；
   - 原地重抠已入库立绘时，`cut` 的 `source` 直接传 `assets/sprites/<主体id>/<差分名>.png`（不给 `output`），由能力层识别身份并自动读取 `media-cache/sprite-sources/` 留底原片重抠。

2. **外部资源库统一为 `library://<entryId>`，URI 内不再嵌分类**：
   - 唯一保留协议头的是外部资源库 `library://<entryId>`（与剧目内相对路径明确区分）；
   - `library://<entryId>` 里只写条目 id，不再重复写 `<kind>/` 子路径，类别统一由 `import_asset` 的 `kind` 参数（`background` / `cg` / `sprite` / `bgm` / `ambient` / `sfx`）指定（同时向下兼容带分类段的旧写法）。

3. **立绘同步生图宏（`generate_asset`）**：
   - 移除 `assetTool.ts` 中无 output 的 `cut` 包装调用，由 `PlayAssets.register` 在入库时一次完成去底、画布归一化、指标写入与原片留底。

## 验证

- `@aivn/agent`：`test/asset-ref.test.ts`、`test/image-cutout.test.ts`（12 例全绿）
- `@aivn/server`：`test/image.test.ts`、`test/assetLibrary.test.ts`、`test/agentkit.test.ts`、`test/workshopPrompt.test.ts`、`test/playEnv.test.ts`、`test/workshop.test.ts` 全绿
- `pnpm check:agent-contract`（9 项全绿）与 `pnpm typecheck` 全绿
- `@aivn/agent` 与 `@aivn/server` 已重新编译（`dist/`），`stage-ai` 服务已重启生效
