# 立绘落位重构：头顶基准、抠图归一化与 shot 概念重整

日期：2026-10-10
状态：已实施并本机验证；跨宿主（dsh-aivn）验证待合并回主线后执行

## 问题

舞台立绘「明显过靠上」，用户判定为设计缺陷而非素材偶发。

### 已定位的两个原因

**主因：素材表把 `anchor` 写错（数据问题，已修）**

`plays/320000/assets/manifest.json` 里五个**人形**主体（yi / chusan / dunniang / baina / jiarong）被写成
`"anchor": "center"`。`center` 在 `spriteStagePreset` 里的语义是「图片盒垂直居中」
（`top = 50 - height/2`），本来是给悬空物准备的。full/normal 档因此得到：

| 列 | height | center 的 top | 后果 |
|---|---|---|---|
| 横屏 | 132 | −16% | 图盒上沿在舞台顶以上，头被 `overflow:hidden` 裁掉 |
| 竖屏 | 102 | −1% | 头顶贴屏幕上沿 |

跨剧目扫过 8 份 manifest，`anchor` 只出现在 320000 这一份；其余剧目人形立绘落位正常。
所以「换别的立绘有没有这个情况」的答案是：同一剧目内换任意一张都一样，偏的是字段不是图。
**已修**：五个人形主体的 `anchor: "center"` 删除（回落缺省 `bottom`），vxn / yixisheng 两个
悬空物保留。修后 full/normal 落横屏 top=18、竖屏 top=16。

**次因：定位基准是「图片盒上沿」而非「人物头顶」（设计问题，本计划处理）**

`.theater-sprite` 的 `top` 定位的是图片盒子上沿。抠图流水线（`packages/agent/src/media/cutout.ts`）
的做法是：裁出 alpha 外框 → 等比缩放 → **底部居中贴进固定 1080×1920 画布**。于是：

- 画布上边距恒等于 `1920 − figureHeight`，它不是被声明的量，是贴画布后的剩余空间。
- 谁先卡住由外框长宽比决定：外框比 9:16 胖就宽度先卡（人被缩矮、余量堆回顶部），
  瘦就高度先卡（人物满高）。
- 单格制式只在**细长外框**上成立：baina 0.436、dunniang 0.369、rin 0.307 这类能拿到满高
  1920、上边距 ≈0.1%；**宽肩人形、蹲姿与方形非人主体一律被宽度先卡**——worried2 0.602、
  yixisheng 0.597、chusan 0.666、vxn 0.954，refit 后 figureHeight 只有 1795 / 1809 / 1621 / 1132，
  余量全堆到顶部，对应 125 / 111 / 299 / 788px（6.5%～41.1% 画布高）的上边距。

**回算验证**：把已入库立绘当原片重跑一遍贴画布，算出的上边距与实测 top_pad 逐张吻合
（vxn 788/790、chusan 299/301、jiarong 178/178、yixisheng 111/114），机制成立——
`画布上边距 = 1920 − figureHeight`。

**订正**：`cutout.ts` 注释里「单格制式保证外框比 ≤ 0.558、人物恒满高」与 `cutout.test.ts` 的
`tall.figureHeight === short.figureHeight` 只是那两个构造用例的形状，不是普遍不变式。
`figureHeight` **不是常数**，它带着「这张图里的人本来多高」的信息——这正是要落进素材表的
「实际高度参数」，不是可以丢掉的中间量。

## 方案

### 一、抠图阶段归一化上边距（治本）

`cutout()` 贴画布时，除了底部居中，把**上边距也归一化**：人物外框顶到画幅上沿留固定
padding（建议 5% 画布高 = 96px，可调）。

这直接消灭「同一 preset 下头顶高度不一致」：无论外框多胖、多少格，人物头顶到画幅上沿
都是同一个距离，`--sprite-top` 的 16%/18% 从此是「人物头顶留白」而不是「图片盒留白」。

配套：**归一化留白只统一「头顶位置」，不统一「人物大小」**——外框比大的主体今天在画布上
只占 1132/1920，比满高的人矮掉四成，两个主体同框时身上比例对不上。所以回传值要两个都留：
`figureTop`（人物头顶到画幅上沿的像素数，归一化后等于固定 padding）与 `figureHeight`
（人物实际像素高，归一化后仍是各主体自己的值）。`figureTop` 决定头顶钉在哪，
`figureHeight / canvasHeight` 决定这张图里的人本来多大，布局据此把不同外框比的主体缩放到
可比的观感。两者在归一化那一刻同时算得出，不需要重新分析图像。

**画幅约束（实测几何）**：抠图输出画布**恒为 9:16**（`canvasWidth = canvasHeight * 9/16`，三处调用都没传
`canvasHeight`），而出图画幅跟着 framing 走（`SPRITE_FRAMING_ASPECT`：full 9:16 / half 3:4 / square 1:1）。
于是 `figureHeight = min(canvasH, canvasW / 外框比)`——外框比只要超过 9:16 就被宽度卡死，余量全堆到顶部。
vxn 外框比 0.954，`1080 / 0.954 = 1132`，与实测 refit_figureH 1132、top_pad 788/790 逐位吻合；chusan
0.666 → 1621/299 同理。**这不仅是外框比问题，更是画幅不匹配**：square 取景的源图是 1:1，却要被压进 9:16 画布。

**两条要求有几何上限**：「头顶钉在固定 padding」+「人物缩放到画布高的固定比例」同时成立，要求画布比 ≥ 外框比。
9:16（0.5625）对 0.6~0.95 的外框不成立——硬缩到固定高度会横向出画。

**收口：画布比跟着 framing 走，不再恒 9:16。**
- `cutout()` 的画布比按 framing 传入（full 9:16 / half 3:4 / square 1:1，取 `SPRITE_FRAMING_ASPECT` 换算成像素画布），
  每档画布比 ≥ 该档主体的外框比，`figureHeight = canvasH − padding` 于是对全档成立。
- 档与档之间的构图差异由 preset 承接（它本来就按 framing 分档）。
- 回传 `figureTop`（归一化后恒等于固定 padding）与 `figureHeight`（归一化后 = canvasH − padding）。
- 注意渲染面：高度是舞台高的百分比、宽度由图片固有比例推出，画布比一改，同一 `height%` 渲染出的宽度跟着变，preset 的横向占位要重新校。
- 存量素材不重抠：缺这两个字段时回落现状（`figureTop = 0`，按旧画布比）。

### 二、布局侧按人物真实高度落位（兜底 + 表达力）

素材表新增**立绘级**字段 `figureTop`（像素，相对 1920 画布高）。布局时：

```
effective_top = sprite_top_pct − (figureTop / 1920) × sprite_height_pct
```

即「图片盒上沿」先按人物头顶偏移量往下推，再套原有 preset。缺省 `figureTop = 0`（= 现状），
存量素材行为不变；新素材由抠图写入实测值。

**为什么不是只改 CSS**：`figureTop` 是素材属性，不是舞台属性——同一张图在两个剧目里
头顶位置应该一致。它必须住 `assets/manifest.json`，与 framing/stature/anchor 并列。

### 三、shot 概念重整（按你的备注做）

当前三套概念的事实分工：

| 概念 | 层 | 作用 | 现状 |
|---|---|---|---|
| `framing` | 素材级 | 图里画到哪儿（full/half/square） | 三档，出图+舞台一起生效 |
| `stature` | 素材级 | 台上站多大（small/normal/large/huge） | 四档，只改高度与落位 |
| `anchor` | 素材级 | 哪条边锚在 stage 上 | 三档，人形误用 center 是本次 bug 根因 |
| `shot` | **逐行** | 这一句的景别强调（wide/normal/close/extreme） | 四档，纯缩放，锚在头顶 |

`shot` 与 `framing` 的边界在 `framing.ts` 里写得很清楚：framing 是「图里画到哪儿」，
shot 是「把已有素材推近」。**两者不重叠**——shot 不重新出图，framing 决定画幅与出图措辞。

所以 shot **不需要重构**。真正该动的是 `anchor`：它的名字和 UI 文案（「对齐」）没有传达
「这一档是给悬空物的」，五个主体因此误写 center。建议：

- **不改语义**（bottom/center/top 三档是对的），改**表述**：素材页那格从「对齐」改成
  「锚定」，并在 `center` 旁标注「悬空物」。
- 提示词侧：`generate_asset` 的工具描述里补一句 anchor 的适用场景（人形不写、悬空物写
  center），技能库 `galgame-visual-craft` 同步。

### 四、跨宿主波及

`packages/core` 与 `packages/stage` 构建期打进 dsh-aivn 的 `lib/`，改共享包必须双边验证
（`docs/references/261009-cross-host-verification.md`）。本次改动：

- `cutout.ts` 在 `packages/agent`——**不在共享包**，dsh-aivn 有自己的 cutout 副本，
  需确认是否同步改。
- `spriteStage.ts` / `framing.ts` 在 `packages/core`——共享，双边验证。
- 素材表 schema 加字段——dsh-aivn 侧读 manifest 的路径要认新字段，缺省不认时行为不变。

## 落地顺序

1. `cutout.ts` 画布比按 framing 传入（不再恒 9:16）+ 上边距归一化 + 回传 `figureTop` / `figureHeight`。
2. `framing.ts` / `assets.ts` 加 `figureTop` 字段与解析（缺省 0）。
3. `spriteStage.ts` 消费 `figureTop`，算出 effective top；测试更新。
4. `declareSpriteMeta` 写入路径：抠图 commit 时把 figureTop 落进 manifest。
5. 素材页表单显示 figureTop（只读，或给「重算」按钮）。
6. 存量 320000 本地重抠这条路已断：`media-cache/sprite-sources/` 为空（留底原片是可重建缓存、被清过），只能重新出图或靠布局侧读 `figureTop` / `figureHeight` 兜底。不阻塞本次实施。
7. 提示词与技能库补 anchor 表述。
8. 双边验证 + 截图。

## 测试范围

- `packages/agent/test/cutout.test.ts`：归一化后的上边距、figureTop 回传值。
- `packages/core/test/spriteStage.test.ts`：effective top 计算、figureTop 缺省行为。
- `apps/server/test/playAssets.test.ts`：commit 时 figureTop 落 manifest。
- 截图：320000 修后 vs 存量（对比头顶位置）。

## 未决

- 归一化 padding 取值（5%？）需要看实际效果定。
- 存量素材是否全部重抠，还是只重抠 320000。
- `figureTop` 要不要暴露给 Agent 工具（按「Agent 工具接口是第一等消费者」原则，倾向要——
  但先只做写入与消费，工具面等布局稳定后再加）。

## 实施记录（2026-10-10）

已落地：

- `packages/agent/src/media/cutout.ts`：画布比走 `aspectRatio`（缺省 9/16）、顶部留
  `topPadding`（缺省 5%）、人物缩到「画布高 × (1 − topPadding)」；回传 `figureTop` +
  `figureHeight`。宽度先卡时退回旧行为（高度由宽度定），`figureTop` 照实回传。
- `packages/core/src/play/framing.ts`：`spriteAspectRatio()` 是「取景 → 数值画布比」的唯一换算处。
- `packages/core/src/play/assets.ts`：`AssetMeta` / `SpriteDeclaration` 加两字段与解析（像素、缺省不落键）。
- `packages/agent/src/media/catalog.ts` + `adopt.ts`：`declareSprite` 写这两格（neutral 立绘级、
  非 neutral 差分级——**逐文件量**）；指标借 `imageOverride` 从抠图那一步进入库流水线。
- `packages/core/src/play/spriteStage.ts`：`spriteStagePreset(framing, stature, anchor, figureTop, figureHeight)`。
  先按 `1920 / figureHeight`（上界 4 倍）把盒高补回 preset 声明的观感，再用补过的高度算落位——
  头顶钉回 `raw.top`、脚下仍在 `raw.top + raw.height`。贴地 `small` 守 `top + height = 100`，
  `center` / `top` 两档不吃头顶偏移；缺字段或非法值逐位退回旧行为。
- `packages/stage/src/{assets,StageTheater}.tsx`：声明透传到 `spriteStagePreset`。
- `apps/server/src/playAssets.ts`：四处 `cutout()` 传画幅并解构新字段；`commit` 借 `imageOverride`、
  `cut` / `recut` 原地重抠后补写声明（否则重抠完舞台仍照旧值摆）。
- 回执三处对齐：`GeneratedPlayAsset.cutout`、`capabilities/media/cutout.ts` 的 `CutoutResult`、`cutTool` 的兜底。

验证（本机 320000，桌面 1440×900 与窄屏 390×844）：三主体头顶绝对位置由 162.6 / 272.0 / 348.0
收敛到 161.6 / 162.0 / 162.0；窄屏 135 / 215 / 270 → 135 / 135 / 135。截图在
`docs/screenshots/metrics-ab/`（before/after × 桌面/窄屏）。用例：core 18、agent 32、server playAssets 62。

已知余留：**窄屏横向**。渲染宽度 = 盒高 × 画布比，portrait 列 full/normal 是 102%，
人物内容占满画布宽的主体因此约 57% 舞台高宽——390 宽的舞台上修前就已溢出，补偿后更明显。
要收紧得动 preset 表（那一列的高度本身偏大），不该在组件里加特判。

补验（2026-10-11）：

- 合成绿底原片跑三档抠图，输出画布 1080×1920 / 1440×1920 / 1920×1920 与取景逐位对应，
  `figureTop + figureHeight` 恒等于 1920；真实指标喂进 `spriteStagePreset` 后头顶精确落在声明的
  `top`（18/14/10 等）、人物高度等于声明的体量（132/168/232 等）。宽主体（外框比 1.45）在 square
  画布上仍是宽度先卡，差额落在顶部留白里——固定画布比的必然结果，舞台靠 `figureTop` 补回来。
- 顺手修掉一处运行时崩溃：`spriteAspectRatio("bust")` 与 `spriteStagePreset("bust", …)` 原来会
  在 `Record[未知键]` 上抛 `undefined.split` / `undefined.landscape`。两个函数都改走
  `framingOf` / `statureOf` 归一（`bust` 降级 half、认不出的按缺省），与模块内其它取值口径一致。

检视结论（[review](261010-sprite-metrics-redesign.review.md)）准入，0 阻塞，四条处理如下：

- **N1 采纳**：`cutout.ts` 回传的 `figureHeight` 改用 sharp 实际解码高，不再另算一遍
  `round(box.height × scale)`——两者在浮点边界会差 1px，而合成用的 `top` 取的是实际高，
  回传另一个数就等于让舞台照着一个与图片不符的头顶位置往上推。
- **S2 不成立**：`declareSprite` 本来就是从 `spec` 读这两个字段，而 `registerAsset` 把调用方给的
  `spec: AssetRef` 原样传进去——与 `adoptDraft` 同一份契约，对称性已有。
- **S1 已在现场**：路径分支那行注释写着「拿不到取景声明，画幅走缺省」，正是建议补的那句。
- **N2 是备忘**，照计划在合并后做跨宿主验证。
- 随之更新 4 条 `playAssets` 断言：差分覆盖现在另带自己那份逐文件指标，原来用 `toEqual` 锁死键集的
  写法改成断言「取景对 + `figureTop + figureHeight = 1920` 自洽」，比原来更能守住「逐文件」这个契约；
  另一条数落盘次数的断言改成断言「只动素材表这一份文件」。



跨宿主待办（合并回主线后）：dsh-aivn 的 `node_modules/@aivn/*` 软链指向主仓 packages，
worktree 的改动它看不到。合并后要 `npm run build` + `node build.mjs --check`，
并把四处 `cutout` 结果类型的构造补上 `figureTop`：`src/media/types.ts` 的两处 `cutout?`、
`src/media/cut.ts`、`src/media/generate-image.ts`、`src/tools/cut.ts` 的兜底值。
`src/media/cutout.ts` 已是再导出，不需重抄。

