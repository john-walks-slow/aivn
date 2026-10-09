# 舞台上角色立绘全部不显示

## 现象

打开任一有立绘的剧目（用户报的 `#/play/testtest/stage`），舞台上只有背景，
**一个角色立绘都看不到**；台词照常演、背景照常换。舞台不是黑屏，也不是缺素材。

## 复现

`http://127.0.0.1:8787/#/play/testtest/stage`（本地后端 + Chromium 1440×810），
演到第一轮有立绘的那一句，实测：

- `.theater-sprite` 元素**在**，共 2 个（`lilia` / `protagonist`）。
- 两张 `<img>` 都已加载完成：`complete: true`、`naturalWidth 1080 × 1920`、
  `opacity: 1`、`filter: none`、`transform` 正常、`rect` 落在画面内。
- 素材 HTTP 200：`/plays/testtest/assets/sprites/lilia/smile.png` 等全部取到。
- 立在人物躯干上打点 `document.elementFromPoint()`，命中的是
  `IMG.theater-bg theater-stack-new`——**背景盖在立绘上面**。
- 临时 `display:none` 掉背景栈那一层，两张立绘立刻正常显示（见 `evidence/02-after.png`）。

结论：不是图没到、不是取景/缩放算错，是**层叠顺序**——立绘被背景压在下面。

## 根因

**背景双层栈的 `z-index` 逃出了自己那一层，永久压住立绘层。**

三件事叠在一起：

1. `StageTheater.tsx` 把背景双层栈 `.theater-bg-stack.theater-stack`（`position: absolute`，
   无 `z-index`）与 `.theater-sprites`（`position: absolute; z-index: 0`）**并排**放在
   `.theater-camera` 下。`.theater-camera` 因 `will-change: transform` **是一个层叠上下文**
   （实测确认），于是这两个兄弟同处这个上下文，彼此的 `z-index` 直接比大小。
2. `stage.css` 给栈内的层写了 `z-index`：
   `.theater-stack-new { z-index: 2 }`、`.trans-fade .theater-stack-old { z-index: 4 }`、
   `.theater-stack-veil { z-index: 5 }`。栈自己不是上下文，这些值是给「栈内新图压旧图」
   用的，**却冒泡到 camera 那个上下文里**参与外层排序。
3. 立绘层是 `z-index: 0`。于是栈里的背景层（1/2/4/5）**全部压过**立绘层。

> 订正（2026-10-08 复核）：本节初稿写的是「`.theater-camera` 不成层叠上下文」，
> 这是错的。camera 带 `will-change: transform`，它**是**上下文（浏览器实测：
> 同一点上放 camera 的孩子 5 与 camera 的兄弟 1，命中兄弟＝孩子被关住了）。
> 病根不在「没有上下文」，而在「栈内数值与立绘层落在同一个上下文里比大小」。
> 对修法无影响（仍是给栈加 `isolation`），但把 camera 认成非上下文会导出错误的备选修法
> ——实测在 camera 上加 `isolation: isolate` 无效，因为多套一层并不改变栈内数值与
> 立绘层比大小的关系。收口必须落在**数值所在的那一层**。

`dissolve` 那条 `.theater-stack-new { z-index: 2 }` 是常驻规则（不挂 `trans-*` 也在），
所以**只要有一次换底，背景就永久盖住立绘**——这就是「全都看不到」而不是「偶尔闪一下」。

### 现象与根因的关联

| 用户看到的现象 | 对应的机制 |
| --- | --- |
| 立绘一个都不显示 | 背景栈的 z-index 2/4/5 全部 > 立绘层 0 |
| 台词、背景、音乐都正常 | 只有立绘层被压；其余层要么在上面（台词条 12）要么是背景自己 |
| 「全都」而不是偶尔 | `.theater-stack-new { z-index: 2 }` 是常驻规则，换过一次底就永久成立 |
| 立绘位置的暗色轮廓隐约可见 | 立绘确实渲染了，只是被不透明背景盖住；边缘抗锯齿处透出一点 |

看截图可以注意到人物轮廓周围那圈紫色描边——那不是图的问题，是立绘被压在
背景下面、只从背景边缘的抗锯齿缝里透出来的（`evidence/01-before.png`）。
改后立绘完整可见且质量正常。

| 证据 | 说明 |
| --- | --- |
| `evidence/01-before.png` | 改前：立绘被背景盖住，只剩描边缝 |
| `evidence/02-after.png` | 改后：立绘完整可见（证明图与取景都没问题） |
| `evidence/03-isolation-only-veil-regression.png` | 只加 `isolation`：`fade` 黑场盖不住立绘 |
| `evidence/08-fade-midwash.png` | 完整修复：黑场过色中途，整屏（含立绘）一起被盖住 |
| `evidence/06-fade-veil-peak-live.png` | 完整修复：黑场落下，立绘正常显示 |

### 引入时间

`a0967d6f feat(dsl): 通用动效/转场体系（fx 原语 + 双层转场）`（2026-10-07）
引入双层背景栈与这套 `z-index`。该提交只验证了转场观感（`261007-dsl-effects.validation.md`
逐项「用户实机验收」通过），没有验证「换过底之后立绘还在不在」。

同日在它之前还有一笔 `0a12aca9 fix(stage): 立绘的 z-index 关进自己那一层`，
那笔的意图正是「立绘层自成一层、不与外层比大小」；双层栈把背景也塞进同一个
父层，却没有给背景栈同样的隔离，于是把上一笔刚修好的事从另一头破了。

## 修复路径

**给背景栈自己加 `isolation: isolate`，并把转场纯色 veil 提到屏幕遮罩层。**

两处改动，都在同一个病因上：

### 1. 背景栈自成层叠上下文（`stage.css`）

`.theater-stack { isolation: isolate; }` —— 栈内的 0/1/2/4/5 从此只在这一层里比，
整层回到「背景」这个身份，落回立绘层（0）下面。与 `0a12aca9` 给立绘层做的
是同一件事、同一种手法，CLAUDE 里那句「谁自成一层」的规矩两边对齐。

### 2. `fade` / `fade-white` 的纯色 veil 移到屏幕遮罩层（`StageTheater.tsx` + `stage.css`）

只加 `isolation` 会带来一个副作用，已实测确认：veil 是「纯色升到全遮挡再落下」，
它**必须**盖住立绘与 CG；关进背景栈之后它就只能盖背景了——
人物会在黑场里浮着不动（`evidence/03-isolation-only-veil-regression.png` 实拍：
黑场下面两条立绘还亮着）。

所以 veil 不该待在背景层，它本来就是**屏幕级**的东西（`cut`/`dissolve` 是背景层的事，
`fade` 是「整屏过色」）。移到 `.theater-camera` 之下、`.theater-sprites` 与 CG 之上的
一层（`z-index: 4`，与 `.theater-stack-veil` 原来的 5 同量级、压在 `.theater-overlay` 的 5 之下）。
`trans-*` 的类仍只挂在栈 div 上（背景新旧让位用它）；veil 不靠栈上的类触发——
它自己带 `animation: fx-veil`，由调用方按 `seq` 换 key 重挂来重播。

实测该组合（`evidence/08-fade-midwash.png` / `evidence/06-fade-veil-peak-live.png`）：
黑场期间整屏（含立绘）全黑，黑场落下后立绘正常显示。

`cut` / `dissolve` 不涉及 veil，行为不变。

### 不改的方案与被否掉的理由

- **只把 `.theater-sprites` 提到 `z-index: 3`（或更高）**：治标。背景栈的 z-index
  还会继续与 CG 层、后续任何并排层比大小，同样的病会再犯一次。且 `.theater-sprites`
  的 0 是 `0a12aca9` 特意选的语义（「整层落在选肢遮罩 8 之下」），动它要重新推一遍
  所有层的关系。
- **只加 `isolation` 不动 veil**：会让 `fade` 转场从「整屏过黑」退化成「背景过黑、
  立绘浮在黑场里」，观感明显劣化。
- **给 `.theater-camera` 加 `isolation`**：**实测根本无效**——栈内数值与立绘层同处
  camera 这个上下文，再套一层不改变它俩比大小的关系（对照实验：camera 隔离而栈不隔离，
  立绘仍被背景压住）。这条路当初被否决时写的理由是「会把抖动层封成一层、veil 盖不住立绘」，
  方向对但不是要点：它连主症状都修不了。camera 打 `will-change: transform`，多一层合成边界
  对抖动也有影响，本就没必要动它。

## 置信度

**95%**。机制已在浏览器里用 `elementFromPoint` + 逐层 computed style 直接观测到，
两个成因（栈的 z-index 泄漏、veil 需要整屏）都做了对照实验：隐藏栈立绘可见、
单独加 isolation 会让 fade 的黑场盖不住立绘、完整两处改动后黑场与立绘都正确。

## 验收标准

- 舞台：任一有立绘的剧目，**换过一次底之后**立绘照常显示（这是回归点——
  此前只在「还没换过底」时能看到立绘）。
- `transition="dissolve"`：背景交叉溶解时，立绘始终在背景之上。
- `transition="fade"` / `fade-white`：黑/白场期间**整屏**（含立绘与 CG）被盖住，
  落下后立绘正常显示。
- `transition="cut"`：硬切，立绘不受影响。
- 回看（滚轮回翻）到换底那一刻：立绘照常显示，不出现旧层残留。
- 台词条、选肢遮罩、右上角工具条与立绘的前后关系不变（`0a12aca9` 的成果不回归）。
- 舞台包单测与 `apps/web` 相关用例无回归。
