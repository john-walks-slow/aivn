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

## 未做的（已记入计划文末）

`@aivn/stage` 抽包分支与 main 的结构性漂移：分支里的 `packages/stage` 是 `apps/web/src/stage/`
在抽取那一刻的副本，main 之后每改一次舞台层都不会自动到达，`packages/core` 副本同样在漂。
本轮是"手工搬 + 补测试"，下次核对 `git log main -- apps/web/src/stage` 即可看出漏没漏；
根治要么把抽包做进 main（`apps/web` 直接引 `@aivn/stage`），要么给插件加一步从 main 生成的构建脚本。
