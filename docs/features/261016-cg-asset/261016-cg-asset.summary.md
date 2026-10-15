# 插图（CG）先备好再登场：小结

> 这是新基线（`main` = `a09cb969`）上的版本；第一版在 `backup/main-261016` 的 `c266b17e` 上，
> 落点是旧的单宿主 `prompt.ts`，语义相同。来历与对照见 plan 的「迁移记录」。

## 做了什么

链路本来就在，缺的是模型那一侧的知识——两处提示词：

- `packages/agent/src/prompt/stage-dsl.ts` 新增 `CG_RULES`（两宿主共用的 DSL 契约块，`index.ts` 导出，
  服务端 `FORMAT_RULES` 在《台词》之前装上）：这一行是**引用**不是生成；caption 是画底下那行说明；
  插图铺满整个舞台、盖住背景与立绘；它停在画面上直到下一次 `<actor>` 或换底 `<scene bg>` 撤掉它。
- `packages/agent/src/prompt/a-zone.ts` 的 `renderAssetSections`：cg 段补一句 tail
  （`在一幕里写 <cg id="…"/> 让它登场。`），与《可用背景 bg》那条对称。

只讲机制，不讲「什么时候该插一张画」；没碰引擎行为与 UI。

## 为什么是这个形状

勘察下来这条路**本来就是通的**：`assets/cg/<id>` 与背景同权、工坊两条出图路都支持 CG、
`<cg id caption/>` 是正式标签、A 区已有《已有插图 cg》清单（带描述）、CG 视图照常列。
断的只是「没有一处告诉过模型 `<cg>` 是什么、清单是拿来用的」。

所以这一轮只补「知道」，不补「通路」——加新概念（CG 企划清单之类）对这个只服务少数玩家的用法是负收益。

落点按新基线的分层选：`<cg>` 是两宿主共用的 DSL 契约（插件也要教同一条），进共享包 `stage-dsl.ts`；
清单 tail 跟着已经共享的 `renderAssetSections` 走，不另开一份。

## 测试

- `packages/agent`：`stage-dsl.test.ts` 新增《插图那块》两条、`a-zone.test.ts` 新增一条 —— 该包 16 例全过。
- `apps/server/test/prompt.test.ts` 两条（清单带用法 + 格式段确实装上了这一章）—— 42 例全过。
- `node scripts/check-agent-contract.mjs` 9 项全过。
- `pnpm typecheck` 四个包全过（新建 worktree 要先 `pnpm -r build` 出 dist）。

## 遗留

- **插件侧待接线**：`CG_RULES` 已在共享包里，`dsh-aivn/src/playwriter/prompt.ts` 还没 import 它、
  也没插值，插件线的剧作家暂时看不到这一章。兄弟仓的改动要连受跟踪的 `lib/` 一起重建提交，不在本次范围。
- 模型照不照这条写，自动化覆盖不到：机制写进去了，但「这一幕该不该插一张画」属创作口径。
