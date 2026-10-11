# 立绘 neutral 顶部留白偏多（cut 不认取景、丢落位指标）

- 剧目：`mio-observatory`（工坊「一口气搭台」建的）
- 报告：`neutral` 差分顶部留白明显比 `smile` 多

## 现象

同一机位下两个差分的 computed style（mock 周目实测）：

| | `--sprite-top` | `--sprite-height` |
| --- | --- | --- |
| 修复前 `neutral` | 18% | 90% |
| 修复前 `smile` | 13.26% | 94.74% |
| 修复后两者 | 13.26% | 94.74% |

素材本身：

| 文件 | 画布 | 人物像素高 | 顶部留白 | 素材表 |
| --- | --- | --- | --- | --- |
| `sprites/mio/neutral.png` | 1080x1920（9:16） | 1505（78.4%） | 415px（21.6%） | 无 `figureTop` / `figureHeight` |
| `sprites/mio/smile.png` | 1440x1920（3:4） | 1821（94.8%） | 99px（5.2%） | `figureTop: 96` / `figureHeight: 1824` |

## 根因

工坊的定妆照流程是**原子三件套**：`generate_image`（`framing: half`）出候选 → `cut` 抠到
`assets/sprites/mio/neutral.png` → `import_asset` 登记那张透明 PNG。这条路上有两处断点：

1. **`PlayAssets.cut()` 的路径分支（source + output、不带 target）不给 `cutout()` 传 `aspectRatio`**，
   于是永远按缺省的 9:16 开画布。半身主体外框比 0.713 > 0.5625，`cutout()` 里
   `scale = min(targetHeight / box.height, canvasWidth / box.width)` 被宽度先卡住，
   人物只能到画布高的 78%，余量全堆到顶部——正是 `cutout.ts` 注释里为 `square` 主体警告过的同一类失败
   （当时是 41% 上边距，这次 21.6%）。
2. **同一条分支不写素材表**，量出来的 `figureTop` / `figureHeight` 只出现在工具回执里；
   紧接着的 `import_asset` → `registerAsset` → `declareSprite` 只登记调用方给的 framing/stature/title，
   指标就此丢失。舞台缺这两个字段就退回旧行为（图片盒上沿 = 头顶），那 21.6% 烘进图里的空白直接长在舞台上。

对照：`generate()` = `draft` + `commit` 那条路（剧作家后台排产、素材页手动生图）两件事都做对了
（`aspectRatio: spriteAspectRatio(spec.framing)` + 经 `imageOverride` 把指标带进 `declareSprite`），
所以同一剧目里两张差分的表现才不一致——`smile` 是后来走 `generate_asset` 出的。

## 修复

- `cut()` 路径分支：输出落在 `assets/sprites/<主体>/<差分>.png` 上时判定为「立绘入库前的抠底」，
  画幅取 `cutFraming()`（草稿里记的出图取景 → 素材表已有声明 → 缺省 full），写完文件后
  用 `declareSprite()` 把 framing 与两个落位指标落表——与 target 分支「原地重抠」的既有行为一致。
- 新增 `spriteRefOfPath()`（`@aivn/agent` 的 `media/catalog.ts`）：`assetRel()` 的逆运算，
  把 `assets/sprites/<主体>/<差分>.<ext>` 解析回立绘身份。
- 立绘身份的判定用**写盘层规范化后的路径**（`relative(root, absoluteOf(output))`）：
  `./assets/…` 与 `assets/…` 是同一个文件，只差个前缀就静默退回 9:16 是查不出来的那种错。

## 数据修复

用修正后的这条路对 `mio/neutral` 重跑了一遍抠底（源图还是那张草稿 `f184d434-…`，
留底原片没动）：画布 1080x1920 → 1440x1920，素材表补上 `figureTop: 96` / `figureHeight: 1824`
（与 `smile` 一致），`neutral.png` 的像素内容随之重来一遍。

## 顺带发现（未修，另计）

工坊的**一键 `generate_asset`（sync 面）出立绘是坏的**：`runSync` 的 cut 依赖调
`assets.cut({ source })`（没有 `output`），而本宿主没有候选区，`cut` 当场抛
「抠底要 output」；即使补上 output，`source` 给的是草稿的**剧目内路径**
（`media-cache/drafts/…`），那不在 `PlayFiles` 的读白名单里，也会被拒。
两条都要动那个宏的 `produce` 回执（把 `draft:<id>` 句柄交给 cut / register），不属于本次范围。
剧作家侧（queued）与素材页手动生图走的是 `generate()`，不受影响。

同时 `dsh-aivn`（DSH 那条线）的 `src/media/generate-image.ts` 与 `src/media/cut.ts`
也是不带 `aspectRatio` 直接调 `cutout()`，且尚未接 `figureTop` / `figureHeight`
——同一类问题在那条线上仍成立，待那边跟进。
