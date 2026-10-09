# 媒体 use case 拆分（P1）· 小结

> 需求背景见 `261008-aivn-dual-host.plan.md` 的 **P1-3**（「对媒体能力优先抽取领域结果与生命周期契约，
> 而不是直接共用整套后端」）；P0 的生命周期契约见 `261008-aivn-dual-host.media-lifecycle.summary.md`。
> 本文件是这次重构的实施记录。dsh-aivn 仓库不放开发记录，故记在主仓这里。

## 要解决的问题

`dsh-aivn` 的 `src/media/assets.ts` 是一个约 1089 行的单类（`PlayAssets`），同一个类同时承担：

1. 资源目标解析（`resolve`）；
2. sprite identity policy（neutral 定妆照、差分的身份基准、自动补 neutral）；
3. 画幅校验（`assertCanvas`）；
4. 草稿写入与过期清理；
5. 入库 / commit（写 `assets/`、素材表、台账）；
6. manifest 读改写；
7. ledger 读改写；
8. BGM；
9. BGM / 图片的留底原片；
10. 抠底。

后果是 `generate_image` 这条「纯生成候选」的路径在**同一个类里**与「采用 + 转换 + 入账」的全部
机器相邻：读代码的人看不出哪条能力属于哪个 use case，改一处面向全类。

## 做了什么

把它拆成**按 use case** 的一组模块，`assets.ts` 退化成装配层（`PlayAssets` 门面 + `playAssetsOf`）。
**不改变任何工具名与用户可见行为**——这是重构，e2e 一行未改地跑通就是证据。

| 模块 | 行数 | 职责 |
| --- | --- | --- |
| `src/media/types.ts` | 141 | 跨 use case 的共享类型（`AssetTarget` / `AssetSpec` / `DraftedAsset` / `GeneratedAsset` / `LedgerEntry` / `DraftRecord` / `PlayAssetsOptions`） |
| `src/media/storage.ts` | 67 | 落盘原语：按文件路径的读改写串行队列、原子替换、读 JSON |
| `src/media/target.ts` | 203 | **资源目标解析**：目标 → 落盘规格；垫图三态取字节；`NEUTRAL`、stem 白名单、`existingAsset` |
| `src/media/draft-store.ts` | 122 | 草稿区 `media-cache/drafts/` 的读写、过期清理（天数由 core 契约推出） |
| `src/media/prompts.ts` | 170 | 出图提示词后缀（色键底 / 身份锁 / 垫图编号锚点） |
| `src/media/catalog.ts` | 113 | **入库落位与记账**：`persist` / `keepSource` / 素材表声明 / 台账（不认识草稿与候选） |
| `src/media/generate-image.ts` | 142 | **出图 use case**：`draft`（剧目目标 → 草稿）、`createGeneric`（无目标候选） |
| `src/media/generate.ts` | 103 | **一步入库 use case**：`generate`（`ensureNeutral` + `draft` + `commit`）、`exists`、`ensureNeutral` |
| `src/media/commit.ts` | 41 | **采用 use case**：草稿 → 入库 |
| `src/media/cut.ts` | 48 | **抠底 use case**：纯色底 → 透明 PNG，只写输出 |
| `src/media/import.ts` | 58 | **登记 use case**：外部图 / 候选图显式落位入库 |
| `src/media/bgm.ts` | 38 | **BGM use case** |
| `src/media/assets.ts` | 109 | 装配层：`PlayAssets` 门面 + `playAssetsOf` |

拆分后的依赖方向是**单向**的：

```
tools ──▶ assets(门面) ──▶ generate / generate-image / commit / cut / import / bgm
                                  │              │
                                  ▼              ▼
                            target / prompts   catalog ──▶ storage
                                              draft-store ──▶ target
```

`generate-image`（生成侧）**不再 import 写侧的 `catalog`**：画幅校验随出图走，落位判定
（`existingAsset`）住在认识落位的 `target`。这样「生成」这条路径在模块图上就看不见「入账」。

## 与共享契约对齐的地方

- **草稿保留期**改为由 `@aivn/core` 的 `ASSET_DRAFT_RETENTION_DAYS` 推出（原为字面量
  `7 * 24 * 60 * 60 * 1000`）。「候选能躺多久」是两边对用户说的同一句话。
- **状态名与转换**按 core 的 `assetLifecycle` 注释落在代码上：本插件同步出图，草稿区的前置态只有
  `draft`，入库即 `adopted`（`commit`），重复采用幂等（`draft-store` / `commit` 的头注写明）。
- **有意没有引入** core 里 dsh 当前不存在的部分：`pending`（没有后台排产）、`rejected`（契约本就
  有意不含）、队列与到货广播。plan 的立场是「减少无意分歧」而非消灭分歧。

## 验证

| 项 | 结果 |
| --- | --- |
| `npx tsc --noEmit`（src/media 范围） | **0 error** |
| `npm run e2e:media`（离线媒体套件，48 条） | **48/48 通过**（e2e 未改动） |
| `node build.mjs`（宿主半边 lib/index.js） | 重建成功，语法校验通过 |
| 宿主半边 lib 与源码一致性（build.mjs 同参数重打后逐字节比对） | **一致** |

### 必须先说清的现场残差（不是这次改动引入的）

在本 worktree 的起点（master，HEAD `f477638`）上，下面两条**本来就是红的**，原因是兄弟仓
`stage-ai/packages/{core,stage}` 的 `dist` 已经走到了 dsh-aivn 之前（core 删了 `<epilogue>` /
`EndingCard`、新增 `assetLifecycle`；stage 随之删了 `EndingCard`）：

- `npm run typecheck`：14 个错误，全在 `src/client/stage-view.tsx`(7) / `src/play/ledger.ts`(2) /
  `src/stage/stage-tap.ts`(5)——**没有一个是 `src/media/`**。
- `node build.mjs --check`：客户端半边打不动（`src/client/stage-view.tsx` import 的 `EndingCard`
  在兄弟仓 `@aivn/stage` 的 dist 里已不存在）。宿主半边 `lib/index.js` 可以判、且一致。

因此 `node build.mjs --check` 这条硬关卡在当前兄弟仓现场**不可能全绿**：它是「确认这次不一致与
兄弟仓有关」的典型场景，提交时用 `git commit --no-verify` 绕过客户端那半边，并在提交信息里记明。
宿主半边（与兄弟仓无关、永远硬判）已确认一致。把 dsh-aivn 的 client 侧对齐到当前 `@aivn/stage`
是**另一个任务**，不在本次重构范围内（本次不碰 `src/client`）。

未跑真实生图 / 音乐后端：媒体套件用桩后端返回真实 PNG / M4A 字节，走与真后端**完全相同**的落盘
路径（抠底是真的）。真出图那条验收沿用需求文档既有安排。

## 有意不做的

- **不动工具名、schema、persona、技能**：行为面零变化。
- **不引入队列 / 传输 / 持久化的统一**：那是 plan 明确要保留的宿主差异。
- **不照搬 stage-ai 的 `apps/server/src/playAssets.ts` 实现，也不复制 `@aivn/core` 源码**：
  只消费它的契约常量。
- **不为了「对齐」引入 dsh 当前没有的状态**（`pending` 等）。
