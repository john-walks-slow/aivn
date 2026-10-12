# 立绘入库收口（机制修复）

前情：`docs/issues/261012-sprite-cut-headroom/`（`mio/neutral` 顶部留白偏多）。
那次只补了 `cut` 的一条分支，机制问题还在：**立绘的入库不变量没有归属点**。

## 现状：六条写口，两条做对了

「立绘入库不变量」= ①画布比跟该差分的 `framing`、②顶部固定 5%、③人物缩到画布高 95%、
④素材表落 `figureTop` / `figureHeight`（舞台据此把头顶钉回 preset 位置）。

| 写口 | 归一化 | 指标 |
| --- | --- | --- |
| `commit()`（草稿 → 入库） | ✓ 抠底画幅按 framing | ✓ |
| `cut()` 路径分支（source + output） | 上一轮补的 | 上一轮补的 |
| `cut()` 素材引用分支（原地重抠） | ✓ | ✓ |
| `register()`（`import_asset`：草稿 / 路径 / 网址） | ✗ | ✗ |
| `importFromLibrary()`（资源库导入） | ✗ `copyFile` 直写 | ✗ |
| `POST /api/plays/:id/assets`（素材页上传） | ✗ `store.writeAsset` 直写 | ✗ |

后果不止「留白偏多」这一种：模型跳过 `cut` 直接 `import_asset(source="draft:…")` 会得到一张
**绿底不透明**的立绘；从资源库导入的角色立绘（真透明 PNG，自带 3–7% 留白）没有指标，
舞台按「图片盒上沿 = 头顶」摆，头顶再偏一点。同一个不变量，六处各写各的。

## 收口

**1. 归一化成为入库流水线自带的一步（共享包）**

新增 `prepareSprite(bytes, { framing })`，按输入分两支，产出恒为「该 framing 的画布 + 5% 顶留白 + 人物 95%」的透明 PNG 与两个落位指标：

- 边框是色键色（通道极差 ≥ 96）→ `cutout()`：去底 + 归一化；
- 已有透明像素（已抠好的 PNG：资源库条目、用户上传、上一轮 cut 的产物）→ 只重排画布（量 alpha 外框 → 缩放到 95% → 贴底居中）；
- 都不是（不透明、也没有色键底）→ 报错，说清合法输入是什么。不做静默降级。

`cutout()` 的落画布那一段抽成 `placeOnCanvas()`，两条支路共用——**归一化的算法只有一份**。

**2. 两条入库流水线（`adoptDraft` / `registerAsset`）对 sprite 自觉调用它**

宿主不再负责「记得抠底、记得带指标」：`adoptDraft` 拿草稿原片自己归一化，`registerAsset` 拿登记进来的字节自己归一化，两者都把指标并进 `declareSprite` 的声明。
宿主要做的只剩「把字节读进来、把落位说清楚」。

**3. 两条旁路（资源库导入 / 素材页上传）改走同一条路**

- `importFromLibrary`：立绘类目不再 `copyFile`，改为读字节 → `prepareSprite` → 写 `.png` + 指标进素材表。
- `POST /assets` 上传：立绘类目同样过一遍，写盘后补声明。

**4. 服务端随之瘦身**

`commit` 的内联抠底与 `imageOverride` 搬运删掉（流水线自己做）；`cut` 保留「画幅跟草稿取景走」
（先按对的画布开，避免归一化时又要放大一次，是画质而非机制问题）；`recut` 走同一条路。

## 不做

- 不为存量素材做迁移：已经在 `assets/sprites/` 里的图保持原样（缺指标的仍退回旧行为）。
- 不动 `dsh-aivn`（同一条线的问题走那边的改动；本次共享包只是多一个可用的 `prepareSprite`）。

## 验证

- 单测：`prepareSprite` 三支（色键原片 / 已抠好 PNG / 两者都不是）；`registerAsset` 直接登记未抠底的草稿 → 透明 PNG + 指标；资源库导入 → 1920 高画布 + 指标。
- 实拍：mock 周目导入一个资源库角色（自带 3–7% 留白、原本没有指标），看头顶与大小。
- 回归：`mio-observatory` 两张立绘仍与 preset 对齐（上一轮的 mock 对比可复用）。
