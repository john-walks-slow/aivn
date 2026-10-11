# 立绘 neutral 顶部留白偏多 —— 实施摘要

问题诊断见 [troubleshoot](261012-sprite-cut-headroom.troubleshoot.md)，检视结论见 [review](261012-sprite-cut-headroom.review.md)。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| [`packages/agent/src/media/catalog.ts`](../../../../packages/agent/src/media/catalog.ts) | 新增 `spriteRefOfPath(rel)`：`assets/sprites/<主体id>/<差分>.<ext>` → 立绘身份（`assetRel()` 的逆运算） |
| [`packages/agent/src/index.ts`](../../../../packages/agent/src/index.ts) | 导出它 |
| [`apps/server/src/playAssets.ts`](../../../../apps/server/src/playAssets.ts) | `cut()` 路径分支：输出落在立绘目录上时按立绘办——画幅取 `cutFraming()`（草稿出图取景 → 素材表声明 → 缺省 full），落盘后 `declareSprite()` 补写 framing 与 `figureTop` / `figureHeight`；身份判定用写盘层规范化后的路径 |
| [`apps/server/test/playAssets.test.ts`](../../../../apps/server/test/playAssets.test.ts) | 两条回归：候选 → cut → import_asset 全程（画布 1440x1920、`figureTop + figureHeight = 1920`、登记后指标仍在）、`./` 前缀写法算同一条路径 |
| [`apps/server/AGENTS.md`](../../../../apps/server/AGENTS.md) | 「立绘：后缀、景别与画幅」那节补一句：抠底是画幅与两格指标的**唯一来源** |

不改摆位公式、不动 preset 表、不动 `cutout()` 算法：舞台侧本来就按 `figureTop` / `figureHeight` 摆，
缺的只是让这条路把它们写下来。

## 验证

- 窄范围单测：`pnpm --filter @aivn/server test test/playAssets.test.ts` —— 新增 2 条通过；
  另有 4 条既存失败与本次改动无关（在未改动的 `main` 上一字不差地同样失败，
  属另一个在途工作 `261010-sprite-metrics-redesign` 的陈旧断言）。
- `pnpm typecheck` 全绿。
- 舞台实拍（mock 周目，同一机位，横屏 1100x760）：修复前后各截一张 neutral / smile。
  修复前 neutral `--sprite-top: 18% / --sprite-height: 90%`、smile `13.26% / 94.74%`；
  修复后两者都是 `13.26% / 94.74%`，实拍图上头顶回到同一水平线。
- 线上剧目数据已修复：`mio/neutral` 重抠成 1440x1920 + 素材表补两格指标，
  线上实例（读盘现取）立即生效，无需重启。

## 用户可见结果

`plays/mio-observatory` 的 `mio` 立绘：`neutral` 的头顶与 `smile` 对齐，人物也回到同一大小。

## 线上状态（2026-10-12 07:58）

- 代码已合入 main 并重建：`pnpm -r build`。
- 处置了一个**双实例**：8787 上跑着一个手工起的 `node dist/index.js`（ppid 1），
  而 supervisord 的 `stage-ai` 因端口被占**静默退到 8788**（日志里是「端口 8787 被占用，改用 8788」）。
  杀掉手工那个、`supervisorctl restart stage-ai`，现在托管实例（新 pid）独占 8787。
  以后再遇「改了没生效」，先查是不是同一条链路上挂着两个实例。
- 验证：`GET /api/plays/mio-observatory` 的 manifest 带 `figureTop: 96 / figureHeight: 1824`；
  公网 `https://stage.johnnren.qzz.io/` 上舞台实测 `--sprite-top: 13.26% / --sprite-height: 94.74%`
  （见 `evidence/live-stage-after-deploy.png`）。

## 未做

- 工坊一键 `generate_asset`（sync 面）出立绘仍是坏的（cut 缺 output + 源图给的是不可读的草稿路径），
  属于那个宏的投递面，另计。
- `dsh-aivn` 那条线的 `cut` 同样不带 `aspectRatio`，且尚未接 `figureTop` / `figureHeight`，待那边跟进。
