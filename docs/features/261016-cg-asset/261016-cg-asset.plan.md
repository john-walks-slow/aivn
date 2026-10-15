# 插图（CG）：工坊里先备好，剧作家临场点名

> 状态：已实施。分支 `feat/cg-asset-v2`（基于 `main` = `a09cb969`）。

## 需求

有些玩家希望先把插图设计出来，再在剧里看它们登场：**工坊里事先生成 → 剧作家在剧本里临场运用**。

这条用法只服务少数玩家，目标是**让它成立**，不做成 agent 主动引导的方向。

## 勘察：链路本来就有，断的是「模型知不知道」

| 环节 | 现状 |
|---|---|
| 素材 | `assets/cg/<id>` 与背景同权；资源库 `library/cg` 走引用即导入 |
| 工坊出图 | `generate_image(kind="cg")` 出候选 → `import_asset` 入库；素材页「CG → 生成」走 `POST /api/plays/:id/images` |
| 剧作家引用 | `<cg id caption/>` 是 DSL 正式标签，舞台按 id 从素材索引解析；A 区有《已有插图 cg》清单（带描述） |
| 翻阅 | CG 视图列出静态素材与站内生成的图（含生图 prompt） |

断的是**知识**：`<cg>` 在指令清单里只有一行裸标签、没有语义；A 区那份清单也没有一句用法
（背景那份有「<scene> 的 bg 优先取这些 id」）。于是模型面前摆着预先画好的插图也不知道写
`<cg id="…"/>` 就能让它登场，更不知道它盖满整屏、要到下一次 `<actor>` / 换底才撤。

## 改动

1. `packages/agent/src/prompt/stage-dsl.ts` 新增 `CG_RULES`（两宿主共用的 DSL 契约块），
   `packages/agent/src/index.ts` 导出；`apps/server/src/prompt.ts` 的 `FORMAT_RULES` 在《台词》之前
   `${CG_RULES}` 装上。四条机制：这一行是**引用**不是生成；caption 是画底下那行说明；
   插图铺满整个舞台、盖住背景与立绘；它停在画面上直到下一次 `<actor>` 或换底 `<scene bg>` 撤掉它
   （所以要在它之后接着写台词）。
2. `packages/agent/src/prompt/a-zone.ts` 的 `renderAssetSections`：cg 段补一句 tail
   （`在一幕里写 <cg id="…"/> 让它登场。`），与《可用背景 bg》那条对称。

两条都只讲机制，不讲「什么时候该插一张画」——那是剧目的创作口径（技能库与 `craft.md` 的事）。

## 明确不做

- **不加「CG 企划清单」这类新产物**：CG 就是剧目素材，工坊对话或素材页出图即「设计」。
- **不在工坊提示词里加「先设计 CG」的号召**：场景偏僻，这不是引擎该替所有剧目做的决定。
- **不动引擎行为**：`<actor>` 撤插图这条既有行为照旧（改了会动到存量剧目的画面），只把这条事实写给模型。
- **不动 UI**：素材页的 CG 生成入口与 CG 视图都不缺东西。

## 迁移记录（这条分支的来历）

第一版 `c266b17e` 落在 `backup/main-261016` 上——它是在 2026-10-15 22:10 那次 `reset --hard`
之后从旧 main 切出来的，继承了错误基底；恢复动作把 main 拨回 `a09cb969` 之后，那一版不在新线上。
本次按新结构重写了一遍，语义一字未变，只是落点从各宿主自己的 `prompt.ts` 搬到了共享包：

| 第一版 | 现在 |
|---|---|
| `apps/server/src/prompt.ts` 的 `FORMAT_RULES` 内联那一章 | `packages/agent/src/prompt/stage-dsl.ts` 的 `CG_RULES` + 服务端插值 |
| `apps/server/src/prompt.ts` 的 `section("已有插图 cg", "cg", …)` | `packages/agent/src/prompt/a-zone.ts` 的 `renderAssetSections` |
| `apps/server/test/prompt.test.ts` 两例 | 服务端两例 + `packages/agent` 三例（契约块两例、清单 tail 一例） |

## 遗留

- **插件侧待接线**：`CG_RULES` 落在共享包（`dsh-aivn` 以 `file:` 依赖它、构建期打进自己的 `lib/`），
  但那个宿主的 `src/playwriter/prompt.ts` 还没 import 它、也没插值——插件线的剧作家暂时看不到这一章。
  兄弟仓的改动要连它的受跟踪 `lib/` 一起重建提交，不在本次范围。

## 测试

- `packages/agent`：`stage-dsl.test.ts` 新增《插图那块》两条（四条机制都在 / 不点名生图工具），
  `a-zone.test.ts` 新增一条（清单带用法）。
- `apps/server/test/prompt.test.ts` 两条：插图清单带用法（清单空着整段不出现）、格式段确实装上了这一章。
- `pnpm check:agent-contract`（改 `prompt.ts` 后必跑）+ `pnpm typecheck`。
