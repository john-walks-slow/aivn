# 验证：生图与入库解耦（草稿 → 采用）

## 用户验证（1~3 条）

1. **候选定妆照**：在工坊里让助手给某个角色出定妆照。
   期望：一次摆出 3 张候选（都是草稿），**素材页里一张都没有**、`assets/manifest.json` 没被动过。
   选中一张后助手调 `commit_asset`：这一张才出现在素材页与素材表里。

2. **入库才生效**：候选阶段刷新素材页 → 立绘段里没有那些候选；
   采用后刷新 → 出现 `assets/sprites/<id>/neutral.png`，取景/名牌声明也在。

3. **剧作家那条路没变**：开演让剧作家引用一个没有的背景 id → 仍然先骨架占位、到货淡入
   （它走 `generate()` = 出草稿 + 立刻入库，不需要人挑）。

## 已自动化覆盖

- `playAssets.test.ts`：`draft` 不写 assets/（素材、manifest、台账都不碰）；同一目标并发 3 张候选
  是三份不同草稿；`commit` 才写 assets/ + manifest 声明 + 台账，并把留底原片搬进 `sprite-sources/`；
  非 neutral 的草稿必须以**已入库的** neutral 为基准。
- `http.test.ts`：`/plays/:id/drafts/<id>/<file>` 送图、越界与不存在的都 404。
- `workshop.test.ts` / `promptCapabilities.test.ts` / `agentkit.test.ts`：工具目录与提示词按新契约。

## 未覆盖 / 已知边界

- 草稿区没有管理界面（列出/删除草稿）——七天自动清，中间不打扰用户。
- 草稿预览走 `WorkshopMarkdown` 的 markdown 图与工具行素材条两处，**实拍截图待补**（见下）。
