# aivn-image-parity 实施小结

2026-10-06。计划与决策见 [`261006-aivn-image-parity.plan.md`](261006-aivn-image-parity.plan.md)，
检视见 [`261006-aivn-image-parity.review.md`](261006-aivn-image-parity.review.md)，
测试见 [`261006-aivn-image-parity.e2e.md`](261006-aivn-image-parity.e2e.md)，
用户实机验收项见 [`261006-aivn-image-parity.validation.md`](261006-aivn-image-parity.validation.md)。

## 交付

| 仓库 | 提交 | 内容 |
| --- | --- | --- |
| `dsh-aivn`（master） | `c5c88fc` | 生图链路对标补齐（后缀四段 / 编号锚点 / 自动补定妆照 / 同名跳过 / `play.json` 的 `image` 段 / 网址垫图）+ 删 `list_assets` + 媒体层回归用例，23 文件 |
| `stage-ai`（`feat/dsh-vn-stage`） | `4573e205` | 把 main 的两处舞台层改进（`orderSeq` 立绘层级、`<scene clear/>` 开新场清台）与它们依赖的 core `clear` 支持搬进抽包分支，并补 `actorCue.test.ts` 21 条 |
| `stage-ai`（main） | 本次文档提交 | 计划 / 小结 / 检视 / 验收 / 端到端报告五份 |

`list_assets` 按用户当轮的判断删掉：工具只做文件工具做不到的事，而它列的三样
（`assets/` 目录、`manifest.json` 的描述、`characters/` 角色卡）`read` / `glob` 都拿得到，
描述本身又已经在提示词里（剧作家 A 区每轮注入、搭台助手自己写 `manifest.json`）。同批把
`validate_play` 从 `src/stagehand/tools/` 挪到 `src/tools/`——它两个预设都装，不属于搭台助手。

## 验证

- 离线素材套件 `npm run e2e:media` **41/41**（新增 17 条：后缀四段、编号锚点、自动补定妆照、
  同名跳过、`play.json` 覆盖、网址 SSRF 拒答，以及从 AIVN `cutout.test.ts` 搬来的四条抠底回归）。
- `@aivn/stage` 包内 `npx vitest run` **35/35**（新增 `actorCue.test.ts` 21 条）。
- e2e：`injection` 16/16、`stagehand` 25/25、`stage` 19/19、`style` 25/25。
- 提交后（`lib/` 是最后重建的那一版）复跑 `injection` 16/16、`stagehand` 25/25、`stage` 19/19，
  与检视意见 N01 采纳后的一致。

## 检视意见的处置

`reviewer` 结论准入，无阻塞与建议修改项，1 条非阻塞（N01）：剧作家提示词还写着「那个主体得先有
neutral」，而代码现在会在该主体一张立绘都没有时自动补一张。已改：那一行现在说明「引擎会先自动补
一张，回执里两张都给你，记得两张都跟用户交代」，并写明「已有别的差分、只缺 neutral 时会拒绝」。

## 有意偏离 AIVN 的地方

- **网址垫图不落缓存**：AIVN 的 `media-cache/web-images/` 是给工坊 `view_image` 复用同一网址用的，
  这里下载完直接当垫图字节交给后端，省掉一层缓存失效（计划里已写明）。
- **不给 `generate_image` 加 `model` / `size` 参数**：逐剧目的生图设置属于剧目文件
  （`play.json` 的 `image` 段），不属于模型的每次选择。
- **媒体层回归用例落在既有的 `e2e/verify-media.ts`**，不给插件新引一套 vitest。
- **抠底调参 CLI 不做**：`recut_sprite` 就是那个入口。

## 舞台分叉：漂移已结束

上半场是"手工搬 + 补测试"（提交 `4573e205`），下半场把分支接回了 main：
`git merge main`（合并提交 `2c3f5df6`）——34 个新提交只撞出 1 处冲突（`packages/stage/src/StageTheater.tsx`
里 zIndex 那行的注释措辞），改名检测把 main 对 `apps/web/src/stage/*` 的改动自动并进了
`packages/stage/src/*`，`packages/core` 副本也一并对齐。验证：core/stage `tsc -b` 通过、
stage vitest 35/35、apps/web `tsc --noEmit` 通过且 vitest 31 文件 202 用例全绿；dsh-aivn 重建后
`lib/` 与合并前逐字节相同，插件运行时行为不受影响。**以后保持"定期 merge main"即可。**

根治方案（把抽包落到 main，让插件直接依赖 main 的 `packages/stage`）现在只差把分支合进 main
（`git merge feat/dsh-vn-stage`，会落成一个合并提交），但它会改 AIVN main 的结构，属于待定的仓库决定。
