# 立绘色键底色改成显式参数（261009-keycolor-explicit）

## 需求

用户原话：「反向也推回」。

起因是两条发行线的**无意分歧**：dsh-aivn 侧已经把「绿底 / 洋红底」从提示词里的判断句
改成显式参数 `keyColor`（`2a998c6`），独立版这边还是老的那句
「always use pure green #00FF00, unless the character's own colouring is greenish …
in which case use pure magenta #FF00FF instead」。这不是有意差异，是要收敛的漂移。

真实的误触发已经发生过：剧目 `demo` 里 `noa` 是金发红瞳、身上一点绿都没有，生图模型却给了
纯品红 `#FD05FB` 底——「算不算绿色系」交给生图模型判断，它会把绿瞳、绿配饰也算进去。
底色不可预期的直接代价是抠底（纯色键）与角色配色撞上时把角色身上那块一起抠掉。

## 改动

| 位置 | 改动 |
| --- | --- |
| `apps/server/src/playAssets.ts` | 新类型 `KeyBackgroundColor`；`KEY_BACKGROUND` 常量 → `keyBackground(color)`（纯绿 / 纯品红两种措辞，不给按纯绿）；`AssetTarget` / `AssetSpec` 加 `keyColor`；`resolveSprite` 用 `assertKeyColor` 收口值域；`ensureNeutral` 把底色带给顺手补的那张定妆照；`suffixFor` → `spriteSuffix(…, keyColor)` |
| `apps/server/src/agentkit/imageTool.ts` | `generate_image` 加 `keyColor` 参数（union green / magenta）；`PROMPT_RULES` 改成「底色显式给，别在 prompt 里自己写」；sync 与 queued 两条路都透传；`kickSprite` 依赖类型加 `keyColor` |
| `apps/server/src/orchestrator.ts` / `playhouse.ts` | `kickSprite` 类型与 `preloadSprite` 透传；`generateImage` 的请求与立绘目标带上 `keyColor` |
| `apps/server/src/http.ts` | `POST /api/plays/:id/images` 的 body 收 `keyColor`（与 `framing` / `stature` 同一口径，边界只搬运，值域由 `playAssets` 收口） |
| `apps/web/src/api.ts` / `workshop/ImageGenDialog.tsx` | 手动生图对话框的「取景与体量」那一行多一个**抠底底色**下拉（默认纯绿）；选项表放对话框本地，**没有**动 `packages/core`——它是两条发行线共享的，为一个下拉去动它会把改动静默传到 dsh-aivn 的 `lib/` |
| `apps/server/test/playAssets.test.ts` | 老用例改成「默认底色里**不许**出现品红」（那正是判断句的痕迹）；新增一条：`keyColor=magenta` 时品红在、绿不在，顺手补的定妆照跟同一底色，非法值被拒 |
| `README.md` | 抠底一节、「工坊手动生图」一节、「立绘的呈现」的站内生图那一条，三处都写上 `keyColor` |

**只影响定妆照**：差分的后缀本来就说「跟垫图同一个底色」，垫图是已入库的 neutral，
所以 `keyColor` 只需要在定妆照那一次给对；顺手补的定妆照由 `ensureNeutral` 自动继承。

## 验证

- `pnpm typecheck`（core / server / web 三包）全绿。
- `pnpm --filter @aivn/server test test/playAssets.test.ts` 55 条通过，含新增的色键底色用例；
  `test/http.test.ts test/playhouse.test.ts test/workshop.test.ts` 96 条通过。
- `pnpm check:agent-contract` 7 项全过（改过 `imageTool.ts` 的工具契约，这道守卫必须跑）。
- `pnpm --filter @aivn/web test`：213 通过、**5 条失败**——`test/useWorkshopTurn.test.tsx`（4 条）
  与 `test/useWorkshopNewThread.test.tsx`（1 条）。已用 HEAD 版本的 `api.ts` / `ImageGenDialog.tsx`
  复跑确认**同样失败**，是预存问题、与本次改动无关（失败形态是 hook 状态没落地，`expected [] to deeply equal [...]`）。
- DSH 侧不需要重建：本次没碰 `packages/core` / `packages/stage`，`dsh-aivn` 的 `lib/` 与这次改动无关
  （按 `docs/references/261009-cross-host-verification.md` 的对照表，`apps/server` 改动只跑独立版单测）。

## 附带

`cutout.ts` 是**镜像文件**：dsh-aivn 那份以上游为准整份抄过去，只允许三处适配（env 前缀、宿主措辞、
上游那个没人用的 `CANVAS_WIDTH`），适配面写在文件头。这条维护规则已补进跨线验证矩阵。
