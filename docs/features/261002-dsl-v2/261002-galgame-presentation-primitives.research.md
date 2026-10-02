# 现代 galgame / 视觉小说舞台演出效果全集与浏览器技术可实现性调研

> 面向 stage-ai DSL v2 设计。落点是「可直接转成 DSL 语法原语」的粒度：每个效果给出参数维度、取值空间、时间/缓动语义、浏览器实现手段，并标注不可行或高代价项。
>
> 调研日期：2026-10-02。调研方式：约 20 轮主题检索 + 9 轮正文抓取，覆盖 Ren'Py（含 ATL / 变换属性表 / 转场库 / 显示物）、KiriKiri + KAG（含引擎层转场处理器与 extrans 扩展）、KAGEX / ティラノスクリプト / 空想曲线（Tyrano 系）、Naninovel（Unity 商业 VN 框架，效果参数表最完整）、Vine / Visual Novel Maker、Godot 4 Web 导出限制、Live2D Cubism for Web、Ink、Unity Cinemachine + Timeline，以及浏览器侧 WAAPI / CSS Filter / Compositing / View Transitions / WebCodecs / OffscreenCanvas / PixiJS 的规范与性能资料。
>
> **本文档不做价值判断、不做选型推荐。** 所有事实性陈述附来源；凡属我的归纳（跨引擎参数对齐、浏览器实现映射）均显式标注「归纳」。

---

## 目录

0. [执行摘要](#0-执行摘要)
1. [业界通用抽象：舞台的三层模型](#1-业界通用抽象舞台的三层模型)
2. [背景与场景层](#2-背景与场景层)
3. [立绘层](#3-立绘层)
4. [镜头与构图](#4-镜头与构图)
5. [转场与叠化体系](#5-转场与叠化体系)
6. [屏幕效果（后处理）](#6-屏幕效果后处理)
7. [粒子与光效](#7-粒子与光效)
8. [CG 呈现方式](#8-cg-呈现方式)
9. [视频与动图素材](#9-视频与动图素材)
10. [图层合成规则（关键约束）](#10-图层合成规则关键约束)
11. [非纯视觉的演出同步原语](#11-非纯视觉的演出同步原语)
12. [缓动函数取值空间总表](#12-缓动函数取值空间总表)
13. [浏览器技术可行性总表](#13-浏览器技术可行性总表)
14. [明确做不到 / 代价高昂的清单](#14-明确做不到--代价高昂的清单)
15. [对 stage-ai DSL v1 现状的对照](#15-对-stage-ai-dsl-v1-现状的对照)
16. [信源索引](#16-信源索引)

---

## 0. 执行摘要

**业界共识的「舞台原语」分解**（来自 Ren'Py、Naninovel、KAG 三套独立引擎的文档交集）：

| 层 | 概念 | 关键参数维度 |
|---|---|---|
| Layer / Camera | 整层的变换容器 | x/y 偏移、zoom、rotation、z |
| Actor | 层内的一个实体（背景/立绘/CG/文本框/特效） | 资产 id、appearance、visible、transform(pos/rot/scale)、tint、blend |
| Transition | 两份画面状态之间的插值 | 时长、颜色/遮罩纹理、方向、缓动 |
| Effect | 附加在 actor 或 camera 上的持续/一次性效果 | 强度、时长、循环 |
| Timing | 串行 / 并行 / 等待 / 条件 | wait、async track、time scale |

出处：[Ren'Py Displaying Images](https://www.renpy.org/doc/html/displaying_images.html)、[Naninovel Characters](https://naninovel.com/guide/characters.html)、[Naninovel Custom Actor Implementations](https://naninovel.com/guide/custom-actor-implementations.html)（"An actor is a scene entity defined by a name, appearance, visibility, and transform"）、[KAG Trans.html](https://krkrz.github.io/krkr2doc/kag3doc/contents/Trans.html)。

**浏览器侧的三个硬性事实**，直接决定 DSL v2 的设计上限：

1. **只有 `transform` 和 `opacity` 能走合成器**。`web.dev` 明确："Today there are only two properties for which that is true - transforms and opacity"，且需 `will-change` 提升为独立层；层数爆炸会因显存/带宽成本反噬（[Stick to Compositor-Only Properties](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count)）。
2. **`filter` / `backdrop-filter` / `mix-blend-mode` 每加一层就多一次离屏 pass 与纹理回读**。CSS Filter Effects Level 2 规范原文："Each application of backdrop-filter or mix-blend-mode would require a separate rendering pass... that would double the required rendering time, and would potentially require twice the memory usage and GPU bandwidth"；嵌套会导致指数级劣化（[Filter Effects L2](https://drafts.csswg.org/filter-effects-2/)）。
3. **`backdrop-filter` 的作用范围受「Backdrop Root」规则裁剪**。祖先元素上任何 `filter`/`opacity<1`/`mask`/`clip-path`/3D transform/blend 都会创建一个 backdrop root，把背景模糊的采样范围截断（[Filter Effects L2 §Backdrop Root](https://drafts.csswg.org/filter-effects-2/)）。**在多层堆叠的舞台上做「背景虚化」，用 `backdrop-filter` 是陷阱，必须改成对背景层自身施加 `filter: blur()`。**

**对 DSL v2 最具复用价值的三条跨引擎结论**：

- **转场 = 双缓冲交换 + 属性补间两条路线并存**。KiriKiri 是纯双缓冲（back/fore 双页 + `Layer.beginTransition` 处理器），Ren'Py/Naninovel 是「状态 diff + 属性插值」，后者的现代转场（`zoominout`、`move`、`punch`、规则纹理溶解）本质都是属性 tween。
- **规则图像（rule image）是一个被低估的通用原语**。KAG `universal`、Ren'Py `ImageDissolve`、Naninovel `Custom` dissolve 三者语义完全一致：一张 256 级灰度图，每个像素的灰度值决定该处切换发生的进度。浏览器实现是 `mask-image` + `animation-timing-function: linear` 逐行推进，**不需要 shader**。
- **「持续型效果」与「一次性效果」在 DSL 层要分开**。Naninovel 显式二分：`@shake`/`@glitch` 是 one-off，`@rain`/`@blur`/`@bokeh` 是 continuous，需要 `@despawn` 或 `power:0` 显式停止（[Naninovel Special Effects](https://naninovel.com/guide/special-effects.html)）。

---

## 1. 业界通用抽象：舞台的三层模型

### 1.1 图层栈（Layer Stack）

**Ren'Py**：`config.layers` 定义全局有序的图层列表，**顺序在游戏内固定**；`scene`/`show`/`hide` 作用于某个 layer。`master` 是默认 layer，用于背景和角色精灵。可用 `renpy.add_layer()` 增建（[Displaying Images](https://www.renpy.org/doc/html/displaying_images.html)）。

`camera` 语句可以对整个 layer 施加一个 transform/ATL（[同页 · Camera and Show Layer Statements](https://www.renpy.org/doc/html/displaying_images.html)）。`camera` 与旧的 `show layer` 的区别被官方列出：
- Camera **propagates transform state**，`show layer` **resets** it；
- `show layer` 的 transform 在下次 `scene` 时被清除，`camera` 持续到显式清除；
- `show layer` 必须给 layer 名，`camera` 默认 `master`。

**归纳**：现代 DSL 应当有「层」概念 + 「层变换（camera）」概念，二者正交。`camera` 是持续的、跨 `scene` 存活的；`scene` 的语义（清空 layer）在 Ren'Py 里不会清 camera transform。

**KAG**：`base`（背景层）为父层，`前景层 0..N` 与消息层为其子层。`base` 因引擎限制**无法自由移动**——KAGEX 为此专门加了 `stage` 层以实现背景卷动（[THE NVL Maker · KAGEX 概要](https://www.nvlmaker.net/manual/docs/kagex.html)）。KAGEX 的层序（自下而上）：

```
messages
layers (前景层 level5–8)
event
layers (前景层 level0–4)
stage
base
```

KAGEX 引入了 **`level`** 概念来决定 z-order（替代 KAG 原版的「按层编号」），并新增 `layfront`/`layback` 在同 level 内置顶/置底（[同上](https://www.nvlmaker.net/manual/docs/kagex.html)）。

**Naninovel**：`Z Offset`（默认 50）与 `Z Step`（默认 0.1）控制角色到相机的 z 偏移与角色间 z 间距（用于避免 z-fighting）；正交模式下 z 分量（`pos:50,0,-1`）用于**排序**（[Naninovel Configuration](https://pre.naninovel.com/guide/configuration)）。角色可通过 `move_to_front()` 移到最前（配合 `z_index` 单独用不够）（[Godot VN pattern 实践帖](https://docs.godotengine.org/en/stable/classes/class_tween.html) 附带说明）。

**归纳**：`z-index` 在 DSL 层应是一个**一等参数**，而不是隐式由「谁后出现谁在前」决定。三家引擎都提供了显式 z 覆盖。

### 1.2 合成模式（Blend Mode）

**KiriKiri 图层类型**：`Layer.type` 支持大量合成模式，官方文档以 `blend(a,b,r) = a×(1−r) + b×r` 等算子定义（[GraphicSystem.md](https://krkrz.github.io/docs/kirikiriz/j/contents/GraphicSystem.html)）。KAG 的 `image` 标签 `mode` 属性取值空间（实测自 KAG 标签文档 [Tags.html](https://krkirikag.sourceforge.net/contents/Tags.html)）：

```
"alpha"(默认) "transp" "opaque" "rect" "add" "sub" "mul"
"dodge" "darken" "lighten" "screen"
"psadd" "pssub" "psmul" "psscreen" "psoverlay"
"pshlight" "psslight" "psdodge" "psdodge5" "psburn"
"pslighten" "psdarken" "psdiff" "psdiff5" "psexcl"
```

其中 `ps*` 前缀是 Photoshop 风格的像素级运算模式。KAG 另支持 **mask 图像**（`<name>_m` 作为 `<name>` 的 alpha 通道）与 **color key**（`key=0xff00ff` 指定透明色，[DispLayer.md](https://kirikirikag.sourceforge.net/contents/DispLayer.html)）。

**PixiJS** 提供等价的完整混合模式集：`ColorBurnBlend`、`ColorDodgeBlend`、`DarkenBlend`、`DivideBlend`、`HardMixBlend`、`LinearBurnBlend`、`LinearDodgeBlend`、`LinearLightBlend`、`PinLightBlend`、`SubtractBlend` 等；**v8 中非标准混合模式需手动 import 扩展**（[PixiJS Filters](https://pixijs.com/8.x/guides/components/filters)）。

**浏览器映射**：CSS `mix-blend-mode` 覆盖 `normal/multiply/screen/overlay/darken/lighten/color-dodge/color-burn/hard-light/soft-light/difference/exclusion/hue/saturation/color/luminosity`（[Compositing and Blending L2](https://drafts.csswg.org/compositing-2/)）。KAG 的 `add` ↔ CSS `screen`/`plus-lighter`（Canvas 2D 的 `globalCompositeOperation: lighter`）。**注意**：`plus-lighter` 是 CSS Compositing L2 新增的、尚未广泛实现的值；稳妥路径是 Canvas 的 `lighter` 或 WebGL 的 `ONE, ONE` 混合因子。

### 1.3 Actor 抽象

Naninovel 给出了最完整的形式化定义（[Custom Actor Implementations](https://naninovel.com/guide/custom-actor-implementations.html)）：

> An actor is a scene entity defined by a **name**, **appearance**, **visibility**, and **transform (position, rotation, and scale)**. It can **asynchronously** change appearance, visibility, and transform **over time**.

**归纳出的 DSL 属性面**（与 Ren'Py show 属性的 `at`/`onlayer`/`behind`/`zorder`、KAG `image` 的 `layer/page/storage/visible/left/top/key`、Naninovel `@char` 的 `idAndAppearance/look/avatar/pos/appearance/pose/via/params/dissolve/visible/position/rotation/scale/tint/easing/time/lazy/wait` 交集一致）：

| 维度 | 取值空间 | 缺省语义 |
|---|---|---|
| 资产标识 | 字符串 id（背景/立绘/CG 分表） | 必填 |
| 外观 appearance | 字符串（整图差分名 / 部件组合表达式） | 保持 |
| 可见性 visible | bool | 保持 |
| 位置 pos | 百分比对（`0,0`=左下，`50,50`=中，`100,100`=右上）或像素 | 保持 |
| 旋转 rotation | 三元组（欧拉角 xyz） | 保持 |
| 缩放 scale | 二元/三元（xyz 可不等比） | 保持 |
| 色调 tint | `#RGB` / `#RRGGBB` / `#RGBA` / `#RRGGBBAA` 或具名色 | 保持 |
| 转场 via | 转场名 | crossfade |
| 转场参数 params | 逗号分隔的十进制列表（可留空跳过取默认） | 转场默认 |
| 时长 time | 秒（十进制） | 背景 0.35s / 角色 SmoothStep |
| 缓动 easing | 见 §12 | 背景 Linear / 角色 SmoothStep |
| 等待 wait | bool | 由全局 `Wait By Default` 决定 |

出处：[Naninovel API · @char](https://naninovel.com/api/)、[Naninovel Configuration](https://pre.naninovel.com/guide/configuration)。

---

## 2. 背景与场景层

### 2.1 缩放平移 / Ken Burns

**引擎侧语义**：

- Ren'Py 变换属性 `xpan` / `ypan`：以角度（度）为单位在 displayable 上平移，0 为中心。官方示例 `show bg panorama: xpan 0 / linear 10.0 xpan 360 / repeat`（[Ren'Py transforms tutorial](https://code.jaenis.ch/mirrors/renpy/raw/branch/master/tutorial/game/indepth_transitions.rpy)）。
- Ren'Py `crop(x,y,w,h)` + `size(w,h)`：先裁剪再缩放。官方示例 `linear 4.0 crop (451, 437, 409, 230)` 做出「聚焦画面某一部分」（[同上](https://code.jaenis.ch/mirrors/renpy/raw/branch/master/tutorial/game/indepth_transitions.rpy)）。
- Ren'Py `xpan`/`xtile` 属于 `pan` 与 `tile` 变换，属性应用顺序中 `tile` 在 `pan` 之前、`crop` 在其后（[Transform Properties](https://www.renpy.org/doc/html/transform_properties.html) 的 Property Order 列表）。
- KAG 背景层受引擎限制不能自由移动（KAGEX 用 `stage` 层补）；`move` 标签做「レイヤ的自动移动」，`stopmove` 停止（[KAG Tags](https://kirikirikag.sourceforge.net/contents/Tags.html)）。
- KAGEX `layopt` 扩展属性含 `rotate`（角度）、`zoomx`、`zoomy`、`zoom`（放大率）、`afx`/`afy`（旋转缩放原点的 X/Y，可给 `center/left/right/top/bottom` 或相对坐标）（[KAGEX](https://www.nvlmaker.net/manual/docs/kagex.html)）。

**浏览器实现**：

- **基础形态**：`transform: translate(x, y) scale(s)`，`transform-origin` 控制锚点。Ken Burns 的标准做法是给图片设不同的 `transform-origin` 角点、然后对 `transform` 与 `opacity` 各跑一条不同长度的动画（[oliverjam.com · Ken Burns hero image](https://oliverjam.com/articles/ken-burns-hero-image)）。该文特别指出：**Ken Burns 效果的 `zoom` 必须用 `linear` 缓动**，任何缓动都会显得怪异（"any easing here looks strange (Ken Burns effects tend to have a consistent pan speed)"）。
- **⚠️ 关键陷阱（Chrome）**：自 Chrome 53 起，**未标记 `will-change: transform` 的元素在 transform scale 变化时会重新栅格化**（re-raster）。官方表述："`will-change: transform` means 'please animate it fast'"，等于强制把内容栅格化成固定位图、之后 transform 更新不再重新栅格（[Re-rastering composited layers on scale change](https://developer.chrome.com/blog/re-rastering-composite)）。**推论：Ken Burns（纯 scale 动画）如果不加 `will-change: transform`，在 Chrome 上会逐帧重新栅格化整张大图，代价极高。**
- **`background-position` / `scroll` 事件做视差是被明确劝阻的做法**："Don't use scroll events or `background-position` to create parallax animations"（[Performant Parallaxing](https://developer.chrome.google.cn/blog/performant-parallaxing)）。

**DSL 参数维度（归纳）**：

```
x: 像素/百分比      y: 像素/百分比
scale: 0.1–5（可 x/y 分离）
origin: 九宫格 (tl/t/c/tr/ml/mc/mr/bl/bc/br) 或百分比二元组
duration: ms        easing: 缓动名（Ken Burns 建议 linear）
```

### 2.2 视差 / 多层背景

**引擎侧**：KAGEX 专设 `stage` 层实现背景卷动（[KAGEX](https://www.nvlmaker.net/manual/docs/kagex.html)）。Ren'Py Utility Bundle 提供「depth-mapped parallax and distance simulation」，把单张背景图用深度图切成有纵深的场景，加雾气、bokeh、软模糊与鼠标视差（[Ren'Py Utility Bundle](https://cross-couloir.itch.io/renpy-utility-bundle-free-edition)）。

**浏览器实现（CSS 3D 视差）**：[Performant Parallaxing](https://developer.chrome.google.cn/blog/performant-parallaxing) 给出的标准配方：

```css
.container { perspective: 1px; perspective-origin: 0 0; overflow-y: scroll; overflow-x: hidden; }
.parallax-child { transform-origin: 0 0; transform: translateZ(-2px) scale(3); }
```

缩放补偿公式为 `(perspective − distance) / perspective`；上例 perspective=1px、Z=−2px，故需 `scale(3)`。中间任何层级若没有 `transform-style: preserve-3d`，透视会被压平。该文也记录了 **Mobile Safari 需要 `position: sticky` 才能让视差生效**。同一来源的速查表列出了完整的 3D 属性分工：

| 属性 | 挂在谁上 | 作用 |
|---|---|---|
| `perspective` | 场景（父） | 相机距离；越小越极端 |
| `perspective-origin` | 场景（父） | 相机站位；移动它等于转头 |
| `transform-style: preserve-3d` | 链条上每一级 | 保持真场景而非平面 |
| `transform`（`translateZ`/`rotateX/Y/Z`） | 元素本体 | 摆放与转向 |
| `transform-origin` | 元素本体 | 旋转轴心 |
| `backface-visibility: hidden` | 每个面 | 转过去就丢弃 |

并列出两条常见故障：**「应该是立体的却平了」** = 链条上缺 `preserve-3d`，或 `overflow`/`filter`/`clip-path` 把 3D 压平（在 Safari 上最常见）；**「面叠错序」** = 在同一个 `preserve-3d` 父级内按 `translateZ` 排序，而不是用 `z-index`。

> **对 DSL v2 的直接含义**：`filter` / `clip-path` 会**压平 3D 上下文**。若舞台同时使用 CSS 3D 视差与 `filter: blur()`，两者在同一元素上互斥。这是一条硬性互斥约束。

### 2.3 滚动背景（Tiling / Pan）

Ren'Py 的 `xtile` / `ytile` 把 displayable 重复多次平铺（[Ren'Py transforms tutorial](https://code.jaenis.ch/mirrors/renpy/raw/branch/master/tutorial/game/indepth_transitions.rpy)）。`xtile 3 / ytile 2` 配合 `xpan` 可做无限横向卷动的云层/雨幕。KiriKiri 的 `scroll` 转场本质也是把两张画面首尾拼接后平移（[KAG Trans.html](https://krkrz.github.io/krkr2doc/kag3doc/contents/Trans.html)）。

**浏览器**：`background-repeat: repeat` + 动画 `background-position` 是最省的做法（浏览器可平铺优化），但 `background-position` 动画**不走上合成器**（[web.dev](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count) 只把 `transform`/`opacity` 列为合成器可处理属性）。替代方案：`translateZ` 视差（§2.2），或用两个 `<div>` 各含一次平铺、`transform` 移动。

### 2.4 景深虚化（DOF / Bokeh）

**Naninovel `@bokeh`** 的完整参数（[Naninovel Special Effects](https://naninovel.com/guide/special-effects.html)）：

| 参数 | 类型 | 默认 | 含义 |
|---|---|---|---|
| Focus Object Name | String | null | 锁焦对象；设定后忽略 Focus Distance |
| Focus Distance | Decimal | 10 | 焦点到相机的距离 |
| Focal Length | Decimal | 3.75 | 离焦区域的模糊量；同时决定焦点灵敏度 |
| Duration | Decimal | 1 | 插值时间（参数到达目标值的速度） |
| Stop Duration | Decimal | 1 | 关闭时回到默认值的淡出时间 |

**Naninovel `@blur`**（对单个 actor 施加模糊，适用 sprite/layered/diced/Live2D/Spine/video/scene 全部实现）：

| 参数 | 类型 | 默认 | 含义 |
|---|---|---|---|
| Actor ID | String | MainBackground | 目标 actor |
| Intensity | Decimal | 0.5 | 强度，0.0–1.0 |
| Duration | Decimal | 1 | 插值时间（秒） |
| Stop Duration | Decimal | 1 | 淡出时间（秒） |
| wait | bool | — | 是否等待热身动画结束再执行下一条 |

Ren'Py 对应：`im.Blur(im, xrad, yrad=None)` 图像操纵器（椭圆核），以及 transform 属性 `blur`（[Ren'Py Image Manipulators](https://www.renpy.org/doc/html/im.html)）。

**商业作品实证**：《咒术回战 Phantom Parade》ADV 团队的做法是——"在关键场景，比平时更近地推近 Live2D 脸部周围，并用**被写界深度**模糊背景以制造沉浸感"（[CyberAgent Developers Blog](https://developers.cyberagent.co.jp/blog/archives/46743/)）。这条来自 2024 年商业手游的正文，是「背景虚化作为标准演出手段」的直接证据。

**浏览器实现**：

- **单层虚化**：`filter: blur(Npx)`，免费。
- **跨层虚化（焦点在前景，背景虚化）**：`filter: blur()` 直接作用在背景层上 —— **不要用 `backdrop-filter`**。理由见 §0 与 §10。
- **真 DOF（按 z 距离连续变化模糊半径）**：CSS **没有**这个原语。必须用 WebGL shader：把场景渲到 framebuffer，按每层 z 计算 CoC（circle of confusion）并用不同半径的高斯模糊。这是本报告认定的最高成本项之一。

---

## 3. 立绘层

### 3.1 位置 / 尺寸 / 缩放 / 旋转 / 翻转

**Ren'Py 变换属性全集与施加顺序**（[Transform Properties](https://www.renpy.org/doc/html/transform_properties.html) 的 Property Order，官方权威）：

```
1. fps
2. mesh, blur
3. tile
4. pan
5. crop, corner1, corner2
6. xysize, size, maxsize
7. zoom, xzoom, yzoom
8. point_to
9. orientation
10. xrotate, yrotate, zrotate
11. rotate
12. zpos
13. matrixtransform, matrixanchor
14. zzoom
15. perspective
16. nearest, blend, alpha, additive, shader
17. matrixcolor
18. GL Properties, Uniforms
19. position properties
20. show_cancels_hide
```

同一文档列出的属性组：

- **Positioning**：`xpos/ypos`、`xanchor/yanchor`、`xalign/yalign`、`xoffset/yoffset`、`xmaximum/xminimum`、`xsize/ysize`
- **Rotation**：`rotate`、`rotate_pad`、`xrotate/yrotate/zrotate`、`matrixtransform`、`matrixanchor`
- **Zoom and Flip**：`zoom`、`xzoom/yzoom`、`xflip/yflip`
- **Pixel Effects**：`alpha`、`matrixcolor`、`nearest`、`additive`
- **Cropping and Resizing**：`xysize`、`size`、`maxsize`
- **Panning and Tiling**：`xpan/ypan`、`xtile/ytile`
- **3D Stage**：`perspective`、`point_to`、`orientation`、`xrotate/yrotate/zrotate`、`matrixanchor`、`matrixtransform`、`zpos`、`zzoom`
- **Model-based rendering**：`blend`（模型另有独立属性集）
- **Uniforms**（GL 着色器 uniform）

**关键细节**：`rotate` 默认会**在四边补足额外空间**以保持外框不变（`rotate_pad` 默认 True）；设 `rotate_pad False` 可去掉补边但外框会随旋转变化（[Ren'Py transforms tutorial](https://code.jaenis.ch/mirrors/renpy/raw/branch/master/tutorial/game/indepth_transitions.rpy)）。**这对 DSL 很重要**——立绘旋转时的边界行为必须显式建模，否则会与背景的自动构图冲突。

`xflip/yflip` 提供了**水平/垂直翻转**，浏览器对应 `transform: scaleX(-1)` / `scaleY(-1)`。

**浏览器**：`transform: translate3d() rotate() rotateX/Y/Z scale() scaleX/Y` + `transform-origin`。注意 CSS 变换函数**从右向左应用**（矩阵连乘顺序与书写顺序相反），这与 Ren'Py 的 Property Order 是反序对应关系——写 DSL 到 CSS 的映射时要注意方向。

**Ren'Py 内置位置预设**（可直接映射为 DSL 的 `pos` 枚举）：`topleft`、`top`、`topright`、`left`、`center`、`right`、`offscreenleft`、`offscreenright`、`bl`、`default`、`reset`、`truecenter`。图示语义：`center`/`default` = 水平居中 + 底部对齐；`truecenter` = 双向居中；`offscreenleft/right` = 置于屏外但底部对齐（文档提醒：用完要 `hide`，否则仍占资源）（[Ren'Py Transforms · Built-in Transforms](https://www.renpy.org/doc/html/transforms.html)）。

> **归纳**：stage-ai 现有的 `pos: left|center|right` 恰好对应 Ren'Py 的三个预设，但缺少 `yalign` 维度（Ren'Py 全部是 bottom-aligned）。DSL v2 至少需要把 `pos` 升级为 `x`/`y` 百分比对 + `anchor`，而不是继续扩充类名。

### 3.2 前后层级

- Ren'Py `show` 属性 `zorder` 与 `behind`（`behind` 取逗号分隔的 image tag 列表，置于这些 tag 之后）（[Displaying Images](https://www.renpy.org/doc/html/displaying_images.html)）。
- KAGEX `laylevel layer=N level=M` + `layfront` / `layback`（[KAGEX](https://www.nvlmaker.net/manual/docs/kagex.html)）。
- Naninovel `pos:50,0,-1` 的 z 分量控制正交模式下的排序（[Naninovel API](https://naninovel.com/api/)）。

**浏览器**：`z-index`。**注意**：`mix-blend-mode`、`filter`、`opacity<1`、`transform-style: preserve-3d` 都会创建层叠上下文，改变 z-index 的可预测性（[Compositing and Blending L2 §3.3.1](https://drafts.csswg.org/compositing-2/)：「Applying a blendmode other than normal to the element must establish a new stacking context」）。

### 3.3 进出方式（Entrance / Exit）

**Ren'Py 的 `zoomin` / `zoomout` / `zoominout` / `move` / `movein*` / `moveout*`**（[Ren'Py Transitions](https://renpy.org/dev-doc/html/transitions.html)）：

- `zoomin`：让进入的图 zoom in 进来（0.5s）
- `zoomout`：让离场的图 zoom out 出去（0.5s）
- `zoominout`：进入的 zoom in + 离场的 zoom out
- `move`：`MoveTransition` 类，**只移动位置发生变化的那些图**（"The move transition finds images that have changed placement, and slides them to their new place"）
- `moveinleft/right/top/bottom`、`moveoutleft/right/top/bottom`

**KAG 的进出**：没有独立的进出场标签，靠「往 back 页画 + `trans`」实现。文档明确：「KAG にはフェードアウト、フェードインという概念がありません」（KAG 没有 fade-out / fade-in 概念），要淡出必须先往 back 页画黑再做 crossfade（[KAG Trans.html](https://krkrz.github.io/krkr2doc/kag3doc/contents/Trans.html)）。

**Naninovel**：`via:` 选转场（立绘同样用 `via:TransitionType`），默认 crossfade，全局 `Default Duration` 0.35s、角色默认 easing 为 **SmoothStep**（背景为 **Linear**）（[Naninovel Configuration](https://pre.naninovel.com/guide/configuration)）。

**浏览器归纳**：

| 进场 | CSS |
|---|---|
| 淡入 | `opacity: 0 → 1` |
| 从下滑入 | `translateY(100%) → 0` + `opacity` |
| 从左/右滑入 | `translateX(±100%) → 0` |
| 缩放入场 | `scale(0.6) → 1` |
| 挤压弹入（overshoot） | `scale(0.6) → 1.12 → 1` 或 `cubic-bezier(.34,1.56,.64,1)` |
| 圆形擦入 | `clip-path: circle(0% at 50% 50%) → circle(75% at ...)` |
| 溶解（噪点边缘） | 需要 mask-image + SVG 噪声，或 WebGL |

### 3.4 表情差分（Expression Variants）

**三种已被验证的组织范式**（[空想曲線 · キャラクタ立ち絵編](https://kopacurve.blog.fc2.com/blog-entry-387.html)）：

1. **固定模式（整图差分）**：为每个表情准备一张完整立绘图。最简单，作者推荐入门用。Tyrano 的 `chara_face` / `chara_mod` 是这一模式的引擎级封装：`[chara_face name="yuko" face="angry" storage="newface.png"]` 注册后 `[chara_mod name="yuko" face="angry"]` 或简写 `#yuko:angry` 切换（[ティラノスクリプト · キャラクター操作](https://tyrano.jp/usage/tech/chara)）。
2. **部分差分模式**：只把表情变化的部分裁出来，用 **`pimage`（部分加载）** 贴回原立绘之上（[KAG Tags](https://kirikirikag.sourceforge.net/contents/Tags.html) 的 `pimage` = 「前景レイヤの画像の部分読み込み」）。
3. **福笑い（Composable）模式**：眉/眼/口分别出图，像拼合照片一样组合（[空想曲線](https://kopacurve.blog.fc2.com/blog-entry-387.html)）。

**Naninovel 的 Layered Character** 是第 3 种的工程化版本，其**层组合表达式语法**值得直接借鉴（[Naninovel Characters · Layered Characters](https://naninovel.com/guide/characters.html)）：

| 语法 | 语义 |
|---|---|
| `group>layer` | 启用该 layer，并禁用同 group 内其他 layer |
| `group+layer` | 只启用该 layer，不影响同 group 其他 |
| `group-layer` | 只禁用该 layer |
| `group-`（省略 layer） | 禁用该 group 下全部 layer |
| `Char.+` | 启用全部已存在 layer |
| `Poses/Light>` | 启用 Light group 下全部 layer，并禁用相邻的 Dark group |
| `+layer,-layer,group>layer` | 逗号分隔多表达式，组合生效 |
| `Char.Uniform` | 通过 `Composition Map` 映射表把长表达式起一个短名 |
| `Body/Pose1,Face/Smile` | 多个 appearance 同时应用（Generic/Live2D/Spine 支持） |

> 这套 `>+-` 三字符表达式是本报告找到的**最紧凑的多部件立绘差分 DSL 语法**，且有商业引擎（Naninovel）背书与完整的表达式语义（递归作用于子 group）。

**实现代价对照**：
- 整图差分（模式 1）：最简单，N 张立绘 × M 表情的素材成本。
- 部件差分（模式 2/3）：素材省，但需要部件层 + 组合逻辑；Naninovel 明确指出部件角色会被渲染到**临时 render texture** 再贴到 mesh 上，"This setup is required to prevent semi-transparency overdraw issues and to support transition animation effects"（[Naninovel Characters](https://naninovel.com/guide/characters.html)）。
- 浏览器对应：多部件立绘 = 一个 `<div>` 容器内多个绝对定位的 `<img>`/`<div>` 子层，每层独立 `opacity` + `mask`。**不要用 canvas 重绘**——DOM 合成器直接处理，比 canvas 2D 便宜。

### 3.5 说话高亮（Speaker Highlight）与口型

**Naninovel 的 Speaker Highlight**：开启后，某个角色成为当前发言者时自动套用指定 pose（通常是 tint 或 scale），且推荐用 Shared Poses 统一管理（[Naninovel Characters](https://naninovel.com/guide/characters.html)）。

**口型/视线事件的触发时机**（这是对 DSL 设计有直接约束的细节）：`On Started Speaking` / `On Finished Speaking` 事件是在**文本被完整揭示（fully revealed）时**触发，**不是逐字触发**；官方建议若要逐字驱动口型，需要配合 `@lipSync` 命令手动控制（[Naninovel Characters](https://naninovel.com/guide/characters.html)）。Naninovel 提供 `Voice Source` 选项，用音频波形驱动口型动画，官方点名第三方方案 Live2D `Cubism Audio Mouth Input` 与 SALSA。

**Look Direction（视线）**：`@char Sora.Happy look:left pos:45,10`，取值 `left | right | center`（[Naninovel API](https://naninovel.com/api/)）。

**浏览器**：立绘的说话高亮 = 一层 `filter: brightness(0.6)` 或 `opacity: 0.5` 的覆盖，或直接改 `filter` 链。`filter` 动画不走上合成器，因此**说话高亮的切换应该是状态跳变而非动画**，或用 `opacity` 合成器属性。

### 3.6 色调 / 灰度 / 加算

Ren'Py 的对应能力：
- `alpha` 属性（透明度，官方示例 `linear 1.0 alpha 1.0 / pause .5 / repeat`）
- `additive`（加算混合）
- `matrixcolor`（4×4 颜色矩阵）
- `im.matrix.brightness(b)` / `.colorize(black, white)` / `.desaturate()` / `.saturation(level, desat=(0.2126,0.7152,0.0722))`（Rec.709 亮度权重）/ `.tint(r,g,b)`（[Ren'Py Image Manipulators](https://www.renpy.org/doc/html/im.html)）
- `im.Grayscale(im)`

**浏览器映射**：

| 引擎能力 | CSS |
|---|---|
| `alpha` | `opacity` |
| `desaturate` / `Grayscale` | `filter: grayscale(1)` |
| `brightness(b)` | `filter: brightness(b)` |
| `saturation` | `filter: saturate(s)` |
| `colorize(bw, ww)` | `filter: sepia()` 近似，或 WebGL |
| `tint(r,g,b)` | `mix-blend-mode: multiply` + 纯色层 |
| `matrixcolor` | 需 WebGL 3×3 色彩矩阵，或 SVG `feColorMatrix` |
| `additive` | `mix-blend-mode: screen`（近似）或 Canvas `lighter` / WebGL `ONE,ONE` |

`matrixcolor` 的能力在 Ren'Py 社区被广泛用于后期调色，第三方包 `Make Visual Novels` 提供 16 个预设 transform（vignette、bloom、CRT、grain、grade 等），并文档化了「可以用 `mesh True` + `shader "..."` + uniform 把着色器施加到整个 layer」（[Make Visual Novels! RenPy Shader Pack](https://makevisualnovels.itch.io/make-visual-novels-rspv1)）。该页也诚实记录了限制：**「这不是真正的光照系统——物体不会投射阴影，着色器无法获取自身之外的信息。」**

---

## 4. 镜头与构图

### 4.1 Camera 层

Ren'Py `camera` 语句 / Naninovel `@camera` / Unity Cinemachine 的 `Cinemachine Brain` + 多个 Virtual Camera 是同一抽象。

Naninovel `@camera` 的实际用法（[Naninovel Scenario Scripting](https://naninovel.com/guide/scenario-scripting.html)）：

```nani
@async
    @bgm volume:0.7 fade:10
    @camera offset:4,1 zoom:0.5 time:3 wait!
    @bgm volume:0.3 fade:5
    @camera offset:,-2 zoom:0.4 time:2 wait!
    @stopBgm fade:10
    @camera offset:0,0 zoom:0 time:3 wait!
```

归纳出的 camera 参数面：`offset`（x,y 偏移）、`zoom`、`rotation`、`time`、`easing`、`wait`。

**Unity Cinemachine 的构图模型**（作为参数维度的另一个参照，[Cinemachine 2.5 · Composing a shot](https://docs.unity3d.com/Packages/com.unity.cinemachine@2.5/manual/CinemachineUsing.html)）：Framing Transposer 定义画面内的 Dead zone（死区）、Soft zone（软区）、Screen（死区在屏幕中的位置 0.5 为中心）与 Damping（阻尼，模拟重型摄影机的滞后）。**这套「死区 + 软区 + 阻尼」模型在 2D 舞台上没有直接对应物**——它是跟随式相机的概念。2D galgame 的 camera 是纯编排式的（作者指定关键帧），不是跟随式的。

### 4.2 推拉摇移（Pan / Tilt / Dolly / Zoom）

- **推拉（dolly in/out）**：缩放整个层。Ren'Py `zoom`/`xzoom/yzoom`；Naninovel `@camera zoom`。
- **摇移（pan）**：平移整个层。Ren'Py `xpan/ypan`（角度制）；Naninovel `@camera offset`。
- **荷兰角（Dutch angle）**：Ren'Py `rotate` / KAGEX `layopt rotate`。
- **VRAM 面板实例**：Naninovel 的 lens-flare 类效果支持 `aspect`（4:3 / 16:9 / 21:9）+ speed 参数，即**遮幅比例是效果参数的一部分**（[Naninovel API · lensFlare](https://naninovel.com/api/)）。

### 4.3 震动（Shake）

**KAG `[quake]` / `[wq]`**：KAG 系统操作类中确有 `quake`（「画面の揺れの開始」）、`stopquake`（停止）、`wq`（等待震动结束）（[KAG Tags](https://kirikirikag.sourceforge.net/contents/Tags.html)）。

**Ren'Py `hpunch` / `vpunch`**：`vpunch` 竖向摇 0.25 秒，`hpunch` 横向摇 0.25 秒；官方注明"模拟和定制它们最好用 ATL Transition"（[Ren'Py Transitions](https://renpy.org/dev-doc/html/transitions.html)）。配套 `play audio "punch.opus"` 的音效是官方教程的标准组合。

**Naninovel `@shake` 的完整参数**（[Naninovel Special Effects](https://naninovel.com/guide/special-effects.html)）——这是本报告找到的最完整的震动参数化定义：

| 参数 | 类型 | 默认 | 含义 |
|---|---|---|---|
| ID | String | null | 目标 actor id；填 `Camera` 则震动主相机 |
| Shake count | Integer | 3 | 震动迭代次数 |
| Loop | Boolean | false | 循环直到 `@despawn` |
| Shake duration | Decimal | 0.15 | 每次迭代的基础时长（秒） |
| Duration variation | Decimal | 0.25 | 时长的随机化增量 |
| Shake amplitude | Decimal | 0.5 | 每次迭代的基础位移幅度（单位） |
| Amplitude variation | Decimal | 0.5 | 幅度的随机化增量 |
| Shake horizontally | Boolean | false | 是否水平位移 |
| Shake vertically | Boolean | true | 是否垂直位移 |

**Visual Novel Maker**（Windows VN 编辑器）的等价参数：`Range X`（水平移动范围，在 ±值间随机）、`Range Y`、`Duration`（[Visual Novel Maker · Screen](https://asset.visualnovelmaker.com/help/Screen.htm)）。

**Naninovel `@glitch`** 参数：`Duration`（默认 1 秒）、`Intensity`（默认 1，取值 0.0–10.0）；官方说明它是「施加到主相机的后处理，模拟数字视频失真与伪影」。

**浏览器实现**：

- **简单实现**：一段 `transform: translate()` 关键帧动画，`animation-iteration-count` 控制次数。**必须加 `will-change: transform`**。
- **参数化实现**：需要 JS 在 rAF 里按 `(t, seed)` 计算偏移，**随机数必须由 `seed` 驱动**（否则回看/回滚时震动不可复现——见 §11.6）。
- **种子确定性**：`Math.random()` 不可回滚。Ren'Py 在 rollback 时会 `rng.reset()`（[renpy/rollback.py](https://github.com/renpy/renpy/blob/2820893a/renpy/rollback.py)），这是一个明确的先例。

### 4.4 聚焦（Focus / Spotlight）

Ren'Py 的 `AlphaDissolve(control, old, new, alpha=False)`：「用一个 control displayable（通常是一个动画 transform）在两个画面之间转场。control 中不透明处用新画面，透明处用旧画面。」（[Ren'Py Transitions](https://renpy.org/dev-doc/html/transitions.html)）。官方 demo `alphadissolve` 就是一个聚光灯效果。

**浏览器实现（无需 shader）**：一个带 `radial-gradient` 的遮罩层。

```css
mask-image: radial-gradient(circle at 50% 50%,
  #000 0%, #000 var(--r), transparent calc(var(--r) + 8%));
```

对「新画面」层施加 `mask-image`，`--r` 随时间从 0 增到 75%。**零离屏 pass，纯合成器可跑**。这是本报告推荐聚光灯优先用此路径的**技术依据**（mask 与 transform/opacity 一样走合成器路径，而 `filter` 与 `backdrop-filter` 不走）。

### 4.5 遮幅（Letterbox / Pillarbox）

`snatchernauts_fx`（Ren'Py 8.4+ GL2 后期栈）的 Letterbox 预设以**宽高比**为一等参数，支持 2.39:1 / 21:9 / 16:9 / 4:3 等；speed 只控 UI 速度，比例由 preset 决定（[snatchernauts_fx](https://github.com/grahfmusic/snatchernauts_fx)）。

**浏览器实现**：`position: fixed` 的上下两条黑条，`transform: scaleY()` 从 0 到 1，或直接 `height: 0 → 12vh`。**完全免费，走合成器。**

### 4.6 伪 3D / 2.5D

**Ren'Py 3D Stage 属性**：`perspective`、`point_to`、`orientation`、`xrotate/yrotate/zrotate`、`matrixanchor`、`matrixtransform`、`zpos`、`zzoom`（[Transform Properties](https://www.renpy.org/doc/html/transform_properties.html)）。这是 Ren'Py 内建的**正交 3D 层**——把 2D displayable 当作有 z 坐标的平面，相机可绕其旋转。

**KiriKiri `perspective.dll`**：为 Layer 增加透視变换（`Layer.perspectiveCopy(src, left, top, width, height, x1,y1, x2,y2, x3,y3, x4,y4)`），把源图层的一个矩形做**四点任意映射的透视投影**复制到目标图层（[perspective.dll 备忘](https://wikiwiki.jp/gutchie/%E5%90%89%E9%87%8C%E5%90%89%E9%87%8C%E3%83%97%E3%83%A9%E3%82%B0%E3%82%A4%E3%83%B3%E3%81%AB%E9%96%A2%E3%81%99%E3%82%8B%E3%83%A1%E3%83%A2/perspective.dll)）。**这是「墙面/地面贴图」类伪 3D 布景的标准做法。**

**Naninovel 的 z 轴移动**："Bringing sprites closer to the viewer helped the feeling of closeness between them, and pulling the background in or pushing it away helped signify where the characters were in the space"——来自商业 VN 开发者 Of Sense and Soul 的文章（[ingthing.dev](https://ingthing.dev/sprites-camera-action-osas/)）。

**浏览器对应**：
- 四点透视（`perspectiveCopy` 的语义）= CSS `matrix3d()` 的 projective transform，或 `transform: perspective(800px) rotateX(45deg)`。**没有 `matrix3d` 的封装麻烦，但矩阵本身完全够用。**
- 深度排序 = `transform-style: preserve-3d` + `translateZ`。
- **⚠️ 互斥约束**：`filter`、`clip-path`、`overflow`（非 visible）会压平 3D 上下文（[Performant Parallaxing](https://developer.chrome.google.cn/blog/performant-parallaxing) 的故障排查表）。

### 4.7 镜头语汇的实证清单

来自《咒术回战 Phantom Parade》ADV 团队的正文（[CyberAgent Developers Blog](https://developers.cyberagent.co.jp/blog/archives/46743/)），可作为镜头原语的实证清单：

- 「通常时的 up 之上再推近 Live2D 脸部周围，用被写界深度模糊背景」
- 「战斗场景中动态且较多地移动相机，以表现 ADV 难以表现的临场感与速度感」
- **「不显示说话者、而是显示反应者的表情」**——「与其聚焦于说话者，不如把焦点放在『被这句话改变了表情的人』或『这句话被提及的人』上，用影像独有的手法增加信息量」
- 「只露口部、其余留空」以回避难以表现的作画
- 「用暗转刻意完全不让读者看到角色面孔，以营造余韵」
- 「台词中途把相机切到另一个人」

以及 Of Sense and Soul 的镜头使用统计（[ingthing.dev](https://ingthing.dev/sprites-camera-action-osas/)）：

- **Close shot（个别 sprite 近景）**：主角内心戏、NPC 介绍、焦点角色正在主张什么
- **Full shot（整个房间 + 完整立绘）**：对话较为非个人化、或需要「陌生感」
- **多人填满画框的 shot**：长对话段，用于增加亲密度与聚焦
- **戏剧性 zoom-in**：强调爆发
- **荷兰角（dutch angle）**：用于惊讶表情
- **blurred heartbeat pumping effect + heartbeat 音效**：紧张时刻
- **剪辑节奏**：数秒缓慢拉到广角 = 舒缓；瞬切 + 缓慢横/上/下摇 = 强调紧迫；**直接切换不摇镜 = 突兀，用于吵架与沉默**；说话人之间快速摇镜切换 = 拌嘴的动感或理念不合的距离感

以及「2D 景深营造」的做法：把背景层沿 z 轴推近/拉远以表达人物在空间中的位置或「外部世界不重要」。

---

## 5. 转场与叠化体系

### 5.1 转场的两条实现路线

**路线 A：双缓冲交换（KiriKiri / KAG）**

KAG 的核心模型是 `表ページ`（fore / 当前可见）与 `裏ページ`（back / 不可见）两套完全同构的图层。`backlay` 标签把 fore 的图层信息复制到 back；在 back 上改；`trans` 执行交换；`wt` 等待交换完成（[KAG Trans.html](https://krkrz.github.io/krkr2doc/kag3doc/contents/Trans.html)）。

KAG 特别强调「循环结构」：转场期间**可以同时做别的事**——"KAG の『時間をかけて何かを処理するもの』のほとんどのタグはそれ自体では終了を待たずに、終了を待つためのタグが別にあります。これにより、トランジションしながらBGM のフェードアウトのようなことができます"（转场的同时可以做 BGM 淡出）。相关等待标签：`wt`（等转场）、`wm`（等移动）、`wa`（等动画）、`wq`（等震动）、`wait`（固定毫秒）、`waitclick`（等点击）。

> **归纳**：KAG 的「触发型标签 + 显式等待标签」是把「并行」做成语言原语的最朴素方式——每个耗时操作有 start 标签和对应的 wait 标签。Naninovel 用相反但更现代的方式（`wait!` 参数，默认不等）。

**路线 B：状态 diff + 属性插值（Ren'Py / Naninovel）**

Ren'Py 的 `MoveTransition(delay, *, enter=None, leave=None, old=False, layers=['master'], time_warp=...)`：「找出位置发生变化的图像，把它们平滑地移动到新位置」。官方定义 `move_transitions(prefix, delay, ...)` 生成一族：`prefix inleft/inright/intop/inbottom`（带 delay 进入）、`prefix out*`（离场移出）（[Ren'Py Transitions](https://renpy.org/dev-doc/html/transitions.html)）。

### 5.2 KiriKiri 转场处理器全集（参数空间的权威来源）

**内置三个**（[KiriKiri トランジションについて](https://krkrz.github.io/krkr2doc/kr2doc/contents/Transition.html)）：

| 处理器 | 必需参数 | 可选参数 | 语义 |
|---|---|---|---|
| `crossfade` | `time` | — | 最简单的交叉淡入淡出 |
| `universal` | `time`, `rule` | `vague`（默认 64） | 按灰度 rule 图像逐像素推进；**rule 图小于画面时自动平铺**，大于时只用左上角部分 |
| `scroll` | `time` | `from`（left/top/right/bottom）, `stay`（`nostay`/`stayback`/`stayfore`） | 滚动 |

`vague`（「あいまい領域值」）：0 或 1 → 边界锐利；128 → 边界大幅模糊；取值 ≥1。

`stay` 三态精确语义：
- `nostay`（默认）：切换先的画面被后来的推着出去（两屏拼接滚动）
- `stayback`：先动的画面移动着退场，从它背后露出后动的画面
- `stayfore`：后动的画面原地不动，先动的画面从外面移入

**extrans 扩展插件的处理器**（同页）：

| 处理器 | 参数与默认值 | 效果 |
|---|---|---|
| `wave` | `time`, `wavetype`(0/1/2), `maxh`(50px), `maxomega`(0.2 rad/px), `bgcolor1`, `bgcolor2` | 光栅滚动做波形；`wavetype` 控制波纹「先细后粗 / 由细渐粗 / 由粗渐细」 |
| `mosaic` | `time`, `maxsize`(30) | 矩形马赛克过渡 |
| `turn` | `time`, `bgcolor` | 小卡片翻转 |
| `rotatezoom` | `time`, `factor`(1), `accel`(0), `twist`(2 圈), `twistaccel`(−2) | 先动的画面旋转 + 缩放；`accel` ≤−2 = 先快后慢，≥2 = 先慢后快，0 = 线性 |
| `rotatevanish` | `time`, `accel`(2), `twist`(2), `twistaccel`(2) | 后动的画面旋转缩放退场 |
| `rotateswap` | `time`, `twist`(1), `bgcolor` | 双向旋转交换 |
| `ripple` | `time`, `centerx`, `centery`, `rwidth`(16/32/64/128), `roundness`(1.0 真圆；<1 竖椭圆，>1 横椭圆), `speed`(6.0), `maxdrift`(24) | 波纹扩散 |

`ripple` 的官方实现注记很有价值：「首次执行时需要分配相当大的内存（0.5–4MB），**预先算好数值计算并存入内存**以保证转场流畅。这可能耗时 0.01–0.5 秒。相同条件下的计算结果会被缓存（保留最近 4 组）」（[同上](https://krkrz.github.io/krkr2doc/kr2doc/contents/Transition.html)）。**浏览器对应：预计算型转场（如 ripple）需要一张预烘焙的查找表纹理，或 WebGL。CSS 做不到。**

### 5.3 Ren'Py 转场库

内置（[Ren'Py Transitions](https://renpy.org/dev-doc/html/transitions.html)）：

| 名称 | 语义 |
|---|---|
| `dissolve` | 0.5s 交叉溶解（`Dissolve` 类，支持 `time_warp`、`mipmap`） |
| `fade` | 0.5s 淡出到纯色 + 0.5s 淡入（`Fade(out_time, hold_time, in_time, color='#000')`） |
| `pixellate` | 0.5s 像素化旧画面 + 0.5s 像素化新画面（`Pixellate(time, steps)`） |
| `move` | 移动位置发生变化的图（`MoveTransition`） |
| `movein*` / `moveout*` / `moveinout` | 位移进出 |
| `zoomin` / `zoomout` / `zoominout` | 缩放进出 |
| `blinds` | 1s 垂直百叶窗（`ImageDissolve` 实例） |
| `squares` | 1s 方格 |
| `slide*` / `slideaway*` | `CropMove` 类 |
| `pushright/left/up/down` | `PushMove` 类，新画面把旧画面推出 |
| `irisin` / `irisout` | 矩形虹膜（`CropMove` 类） |
| `hpunch` / `vpunch` | 0.25s 横向/纵向屏幕震动（用 ATL Transition 定义） |

`CropMove` 的完整参数（可实现多种效果的核心原语）：

```python
CropMove(time, mode='slideright',
         startcrop=(0.0, 0.0, 0.0, 1.0), startpos=(0.0, 0.0),
         endcrop=(0.0, 0.0, 1.0, 1.0),   endpos=(0.0, 0.0),
         topnew=True)
```

`Fade` 的参数是 `(out_time, hold_time, in_time, color)`；官方 demo 给出的变体：

```renpy
define fade = Fade(0.5, 0.5, 0.5)
define fadehold = Fade(...)
# Camera flash - quickly fades to white, then back to the scene.
define flash = Fade(0.1, 0.0, 0.5, color="#fff")
```

（[indepth_transitions.rpy](https://code.jaenis.ch/mirrors/renpy/raw/branch/master/tutorial/game/indepth_transitions.rpy)）

`ImageDissolve(image, time, ramplen=8, *, reverse=False, time_warp=None, mipmap=None)`：**用一张图像控制溶解过程——白色像素最先溶解，黑色最后**。`reverse=True` 反转。官方预置了 `blinds`、`squares`、`circleirisin/out`、`circlewipe`、`dream`（波纹溶解）、`teleport`（逐行揭示）等，需要一张屏幕尺寸的图所以没进标准库。

`AlphaDissolve(control, delay=0.0, *, reverse=False, mipmap=None)`：见 §4.4。

还有 `Swing(delay=1.0, vertical=False, reverse=False, background='#000', flatten=True)`：把旧画面绕轴旋转 90° 到侧视面，切换，再把新画面旋转 90° 转回来。

### 5.4 Naninovel 转场库（参数最完整）

**通用调用形式**（[Naninovel Transition Effects](https://nani.nanana.cn/guide/transition-effects)）：

```nani
@back River.Ripple time:1.5 wait!
@back Appearance.BandedSwirl params:,2.5      # 跳过前一个参数取默认
@char CharID.Appearance via:TransitionType params:...
@trans Time.Ripple                              # 仅做转场不改资产
```

所有转场参数均为十进制；默认 `time` 为 0.35 秒。

| 转场名 | 参数（默认值） | 效果 |
|---|---|---|
| `BandedSwirl` | Twist amount(5), Frequency(10) | 带状旋涡 |
| `Blinds` | Count(6) | 百叶窗 |
| `CircleReveal` | Fuzzy amount(0.25) | 圆形揭示，边缘模糊 |
| `CircleStretch` | — | 圆形拉伸 |
| `CloudReveal` | — | 云状揭示 |
| `Crossfade` | — | 交叉溶解（默认） |
| `Crumble` | — | 崩塌 |
| `Dissolve` | Step(99999) | 溶解（step 控制粒度） |
| `DropFade` | — | 下落淡入 |
| `LineReveal` | Fuzzy amount(0.25), Line Normal X(0.5), Line Normal Y(0.5), Reverse(0) | 线条揭示；`Line Normal` 是线条法线方向，`:,0,1` 即垂直下滑 |
| `Pixelate` | — | 像素化 |
| `RadialBlur` | — | 径向模糊 |
| `RadialWiggle` | — | 径向摆动 |
| `RandomCircleReveal` | — | 随机圆形揭示 |
| `Ripple` | Frequency(20), Speed(10), Amplitude(0.5) | 涟漪 |
| `RotateCrumble` | — | 旋转崩塌 |
| `Saturate` | — | 饱和度过渡 |
| `Shrink` | Speed(200) | 收缩 |
| `SlideIn` | Slide amount(1) | 滑入 |
| `SwirlGrid` | Twist amount(15), Cell count(10) | 网格旋涡 |
| `Swirl` | Twist amount(15) | 旋涡 |
| `Water` | — | 水面 |
| `Waterfall` | — | 瀑布 |
| `Wave` | Magnitude(0.1), Phase(14), Frequency(20) | 波浪 |

**自定义转场的两条官方路径**（[Naninovel Custom Transition Effects](https://naninovel.com/guide/transition-effects)）：

1. **Dissolve Mask 模式**：一张灰度纹理，颜色决定该像素何时切换。`@back Appearance.Custom dissolve:Textures/Spiral`。参数 1（0–100）平滑/模糊边界；参数 2（0/1）反转（亮处先显示）。官方 import 建议：**Single Channel + Red，关闭 Non-Power-of-2 与 Generate Mip Maps**。
2. **Custom Shader 模式**：在 actor shader 里用 `multi_compile` 定义 transition keyword，在 fragment 里按 `progress` 与 `transitionTex` 做 `lerp`。

### 5.5 转场效果的浏览器实现成本分级（归纳）

| 转场族 | 浏览器手段 | 是否需离屏 pass / shader | 备注 |
|---|---|---|---|
| `cut` | 直接换 `src` | 否 | |
| `dissolve` / `crossfade` | 两层 `opacity` 交叉 | 否 | 走合成器 |
| `fade` 到纯色 | 一层纯色 `div` 的 `opacity` | 否 | 走合成器 |
| `flash` | 纯色层 `opacity` 0→1→0 | 否 | 注意 WCAG 闪烁阈值（§6.7） |
| `slide*` / `push*` | 两层 `translate` | 否 | 走合成器 |
| `zoomin*` / `Shrink` | `transform: scale` | 否 | ⚠️ 无 `will-change: transform` 时 Chrome 逐帧重栅格 |
| `irisin/out` / `CircleReveal` | `clip-path: circle()` 插值 | 否 | 走合成器 |
| `blinds` / `squares` / `LineReveal` | `mask-image`（纯色/渐变）沿线性渐变方向移动 | 否 | 走合成器 |
| `ImageDissolve` / `universal` / `Custom dissolve` | `mask-image: url(rule.png)` + 动画 `--mask-pos`，或 `-webkit-mask` | 否 | **走合成器，零 shader**；rule 需非 POT、无 mipmap |
| `Pixelate` | CSS `image-rendering: pixelated` + 降分辨率容器；或 WebGL | 否/是 | 需实际重采样，CSS 只能近似 |
| `CircleStretch` / `DropFade` | `clip-path` 或 `transform` + `filter` | 否 | |
| `Wave` / `Ripple` / `Swirl` / `RadialWiggle` | **必须 WebGL/WAAPI + shader 或 SVG filter** | **是** | 逐像素几何形变 |
| `Crumble` / `RotateCrumble` | 同上，且需要噪声 | **是** | |
| `RadialBlur` | CSS `filter: blur()` 的空间变化版本不原生 | **是** | 需 shader 或 `backdrop-filter: blur()` + mask（后者受 Backdrop Root 限制） |
| `Saturate` | `filter: saturate()` | 否（但 filter 不走合成器） | |
| `Swing` | `transform: rotateY()` + `perspective` | 否 | |

---

## 6. 屏幕效果（后处理）

### 6.1 Ren'Py / 社区的屏幕效果清单

**`snatchernauts_fx`**（Ren'Py 8.4+ GL2）给出了一个工业级后期栈，其 post-FX 顺序为 **Letterbox → CRT → Film Grain → Bloom → Color Grade**（[snatchernauts_fx](https://github.com/grahfmusic/snatchernauts_fx)）：

- **Letterbox**：aspect（2.39:1 / 21:9 / 16:9 / 4:3 …），speed 仅控 UI
- **CRT**：`intensity`、`vignette`、`chromatic aberration`、`scanline_strength`、`scanline_density`、`glitch`、`anim_type`/`anim_speed`、`barrel`（桶形畸变）
- **Film Grain**：`intensity`、`size`、`speed`、`downsample`
- **Bloom**：`threshold`、`soft knee`、`intensity`、`radius`、`samples`、`anamorphic`（变形镜头横向拉伸）、`anim`（pulse/breathe）
- **Color Grade**：GPU `matrixcolor` 操作（saturation / contrast / brightness / hue / tint / sepia / identity）
- **2D Lighting**：ambient + 多个光源（point / spot / rect），分 front/behind，每灯可独立动画（`flicker` / `pulse` / `breathe`），可拖拽手柄

每项提供 20 个内置 preset，JSON 驱动。

**Make Visual Novels Shader Pack**（Ren'Py）提供 `LPVignette` shader，uniform 为 `u_vin_radius`(0.5)、`u_vin_softness`(0.3)、`u_vin_strength`(0.5)、`u_vin_center`(0.5,0.5)、`u_vin_tint`（[Make Visual Novels!](https://makevisualnovels.itch.io/make-visual-novels-rspv1)）。同页提到可把 shader 施加到整个 layer（`mesh True` + `shader` + uniform），也可叠加两层 shader。

**Visual Novel Maker 的 Screen 面板**给出了另一套面向创作者的词汇（[Visual Novel Maker · Screen](https://asset.visualnovelmaker.com/help/Screen.htm)）：

- `Wobble`：画面以不规则错动方式移动
- `Blur` + `Power`：模糊强度
- `Pixelate` + 目标块/像素尺寸 + `Duration`：平滑像素化
- **Tone Control**：R/G/B 色调偏移（−255..255）、`Grey` 强度（0..255）、以及 Normal / Dark / Sepia / Morning / Night 快捷预设
- **Flash**：「瞬间用指定颜色填满全屏，然后渐变回原画面，用于表现闪电等」；`Color Control` 给 RGB 0–255 与 Power 0–255
- **Shake**：`Range X`（在 −value..+value 间随机）、`Range Y`、`Duration`

### 6.2 浏览器实现手段对照

**CSS `filter` 函数全集**（[MDN `<filter-function>`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/filter-function)）：

```
blur() brightness() contrast() drop-shadow() grayscale()
hue-rotate() invert() opacity() saturate() sepia()
```

`backdrop-filter` 使用同一组 `<filter-function>`。

| 演出效果 | CSS | 成本 |
|---|---|---|
| 亮/暗 | `filter: brightness(x)` | 不走合成器；每帧重绘 |
| 灰度 | `filter: grayscale(1)` | 同上 |
| 色调偏移（红/蓝调） | `filter: sepia()` + `hue-rotate()` + `saturate()` 组合 | 同上 |
| 对比度 | `filter: contrast(x)` | 同上 |
| 模糊 | `filter: blur(Npx)` | 同上 |
| 色相旋转 | `filter: hue-rotate(Xdeg)` | 同上 |
| 暗角 vignette | `background: radial-gradient(...)` 覆盖层 | **走合成器（如果只动 opacity）** |
| 闪白 / 闪电 | 纯色层 `opacity` 动画 | 走合成器 |
| 胶片颗粒 grain | SVG `feTurbulence` 或 WebGL 噪声 | 需要 filter/离屏 |
| CRT 扫描线 | `repeating-linear-gradient` 覆盖层 | 走合成器 |
| 光泄漏 light leak | 多层 `radial-gradient` + `screen` 混合 | 每个 blend 多一次 pass |
| 色差 chromatic aberration | 需 WebGL（对 R/G/B 通道分别偏移采样） | **必须 shader** |
| 桶形畸变 barrel warp | `border-radius` 变形 + `clip-path`？或 WebGL | 精确版必须 shader |
| 扫描抖动 glitch | WebGL 块随机偏移 | **必须 shader** |
| Bloom | WebGL 多 pass 模糊 + 阈值合成 | **必须 WebGL** |
| 2D 光照 | WebGL（normal map + 光源 uniform）；Ren'Py 社区明确说明这不是真光照（无阴影、无跨对象采样） | **必须 shader，且有明确上限** |

社区现成的 Web 实现参考：[atmosphere-js](https://github.com/harbz/atmosphere-js)（Grain 用 Canvas + Perlin 噪声；Vignette 用 CSS radial-gradient；Light Leak 用多层 radial-gradient + `screen` 混合；Scanlines 用 `repeating-linear-gradient`；Paper 用 SVG `feTurbulence`）。

**性能警告**：`filter: blur()` 看起来是 GPU 安全的属性（由 GPU 执行、不改布局、静态 filter 每帧零成本），但**一旦动画化 blur 半径，在每一台没有独显的设备上帧率都会腰斩**（[css-animation.com](https://www.css-animation.com/core-css-animation-fundamentals/hardware-accelerated-properties/when-filter-and-backdrop-filter-are-worth-the-paint/)）。原文核心区分：「在 GPU 上执行 filter ≠ 廉价地动画化它。前者是栅格化步骤，后者是……」

**归纳**：`filter` 的**静态值**便宜，**动画值**昂贵。DSL 层应区分这两种用法：`<filter>` 声明式标签（一次性设定，OK）与 `<animate>`（若目标属性是 filter/blur，会逐帧重绘）。若要动画模糊且保 60fps，路径是：先预烘焙模糊结果（CSS 无法预烘焙）→ 或用 WebGL 在 GPU 上以低分辨率做模糊再上采样。

### 6.3 粒子与光效

**Naninovel 的效果二分法**（[Naninovel Special Effects](https://naninovel.com/guide/special-effects.html)）：

> Spawned effects are based on the `@spawn` command... They can be **one-off** (like `@glitch`) or **continuous** (like `@show` or `@blur`).
> Some effects are persistent by default and must be explicitly stopped: `@rain` → `@rain power:0`.

| 效果 | 关键参数 |
|---|---|
| `@shake` | ID（含 `Camera`）、count、loop、duration(0.15)、duration variation(0.25)、amplitude(0.5)、amplitude variation(0.5)、hor、ver |
| `@glitch` | Duration(1s)、Intensity(1，范围 0.0–10.0) |
| `@rain` | Intensity(0.5，粒子生成率/秒)、Fade-in time(5s)、X velocity(1)、Y velocity(1)；停止参数 Fade-out time(5s) |
| `@snow` | Intensity(0.5)、Fade-in time(5s)、Fade-out time(5s) |
| `@sun` | Intensity(0.85，光线不透明度)、Fade-in time(3s)、Fade-out time(3s) |
| `@bokeh` | Focus Object Name、Focus Distance(10)、Focal Length(3.75)、Duration(1)、Stop Duration(1) |
| `@blur` | Actor ID(MainBackground)、Intensity(0.5，0–1)、Duration(1)、Stop Duration(1)、wait |

`@spawn` 还带 transform 参数：`pos`（场景/世界位置）、`scale`、`rotation`（`rotation:,,15` 即 z 轴 15°）。

**浏览器实现路径与实测数据**：

1. **CSS 粒子**：少量（几十个）元素 + `transform` 动画。无数据表明可行，但每个粒子占一个 DOM 节点。
2. **Canvas 2D**：实测约 **1,500 粒子**开始掉帧（[game-snake #37](https://github.com/Rajath2005/game-snake/issues/37)）。
3. **WebGL2（主线程）**：同一来源称可支持 10,000+。
4. **OffscreenCanvas + Worker**：`transferControlToOffscreen()` 后 transfer 到 worker，worker 跑自己的 `requestAnimationFrame` 循环（[web.dev OffscreenCanvas](https://web.dev/articles/offscreen-canvas)、[MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)）。worker 的 rAF 由合成器驱动，**对主线程长任务免疫**（[javascript-web-workers.com](https://javascript-web-workers.com/high-performance-computation-patterns/offscreen-canvas-rendering/)）。
5. **PixiJS**：`Sprite`/`Container` 的 `filters` 数组可直接挂 `BlurFilter`、`ColorMatrixFilter`、`DisplacementFilter`、`NoiseFilter` 等；社区 `pixijs/filters` 包另有 `BulgePinchFilter`、`GlitchFilter`、`MotionBlurFilter`、`RadialBlurFilter`、`RGBSplitFilter`、`SimplexNoiseFilter`、`TiltShiftFilter`、`ZoomBlurFilter` 等（[PixiJS Filters](https://pixijs.com/8.x/guides/components/filters)、[pixijs/filters releases](https://github.com/pixijs/filters/releases)）。自定义 shader 走 `Filter.from()`，需同时提供 `glProgram` 与 `gpuProgram` 以支持双渲染器。

**一项 2026 年的架构级实测**（arXiv 论文，[Decomposing Browser Pipeline Architectures for DOM-Sourced Particle Effects](https://arxiv.org/pdf/2608.23609)），对「粒子该放 worker 还是主线程」有直接数据：

- Worker 管线（P3–P5）在 paper-primary Chrome 上稳定在 **~144 FPS**（p95 frame-time 7.0ms），主线程 Canvas2D 基线 P1 只有 **~52 FPS**（21.2ms）（n=10，Cliff's δ=1.0，p=1.08e−5）
- **在交互区间，把工作挪到 worker 是主要收益来源；把 Canvas2D 换成 WebGL2（在主线程）几乎没帮助**（density 2：P2 57.0 FPS vs P1 52.5 FPS）
- 压力区间（25 万粒子）：WebGL worker > Canvas2D worker；**WASM 模拟内核的微基准优势（Chrome 上 1.5–1.6×）不转化为端到端 FPS 收益**（P5 ≤ P4）
- 结论：「When profiling shows UI-thread jank on an effect, offload first—before reaching for WASM or a heavier renderer」
- 另一份来源的实用阈值：60Hz 目标下平均 draw 时间 < 8ms（若支持 120Hz 则 < 4ms）（[javascript-web-workers.com](https://javascript-web-workers.com/high-performance-computation-patterns/offscreen-canvas-rendering/)）

**光效（god ray / 体积光）**：`@sun` 在 Naninovel 中是粒子系统。浏览器纯 CSS 实现：用 `conic-gradient` 或多个旋转的 `linear-gradient` 锥形 + `screen` 混合 + `opacity` 动画。**每个 `mix-blend-mode` 多一次离屏 pass**（[Filter Effects L2](https://drafts.csswg.org/filter-effects-2/)），所以多个光锥叠加会线性增加成本。

### 6.4 视差与深度

Ren'Py Utility Bundle 的「depth-mapped parallax and distance simulation」：把任意单张背景图用**深度图**变成有纵深的场景，加入雾气、bokeh、软模糊与鼠标视差，**无需切图**（[Ren'Py Utility Bundle](https://cross-couloir.itch.io/renpy-utility-bundle-free-edition)）。这在浏览器里对应：WebGL 用一张 depth texture 做视差 + 按深度做雾/模糊。**这是「单图景深」的唯一低成本路径，且必须是 WebGL。**

### 6.5 商业作品的后期配置实证

《咒术回战 Phantom Parade》ADV 团队在 Unity 中引入 post-effect 的三层配置（[CyberAgent Developers Blog](https://developers.cyberagent.co.jp/blog/archives/46743/)）：

1. 关闭后期
2. **Post-Effect ON**：用 contrast / saturation / lift-gamma-gain 把整体色味拉近 anime；并在下方叠一层暗屏把视线引导到脸部周围
3. **Light ON**：Live2D 模型接收来自背景的光

他们的 Live2D 与背景融合方案是 **normal map**：把 3D 的凹凸信息（法线贴图）施加到 2D 素材上，让 2D 立绘受光照影响，从而「贴合背景、消除 2D 的平面感」（[同文](https://developers.cyberagent.co.jp/blog/archives/46743/)）。

**这条对 DSL v2 有直接价值**：`actor normal_map=...` 是一个可声明的材质属性，浏览器实现是 WebGL 的法线贴图 + 光源 uniform（Naninovel 侧也提到可以为角色 prefab 分配 Camera 层来渲染带 `Lights 2D` 的 layered actor，[Naninovel Characters](https://naninovel.com/guide/characters.html)）。

### 6.6 粒子/后期的层级指定

JJK FP 提到「レイヤー指定ポストエフェクト」（layer-specified post effect）用于制作「疑似被写界深度」与战斗场景的动画风格效果（[同文](https://developers.cyberagent.co.jp/blog/archives/46743/)）。**即：后期效果的作用域可以是「某一层」而不是「整个相机」**。Ren'Py 的对应能力是 `camera` / layer transform + `mesh` shader（[Make Visual Novels!](https://makevisualnovels.itch.io/make-visual-novels-rspv1)）。

### 6.7 屏幕效果的无障碍硬约束

**WCAG 2.2 SC 2.3.1 Three Flashes or Below Threshold**（[W3C Understanding](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold)）：

- 内容**不得在任意 1 秒内闪烁超过 3 次**，或低于 general flash / red flash 阈值
- **general flash 定义**：相对亮度变化 ≥10%（且较暗一侧相对亮度 <0.80）的一对相反变化
- **red flash 定义**：涉及饱和红的任意一对相反跃迁
- 例外：细密平衡图案（如白噪声，或方格边长小于 0.1° 视野的交替棋盘格）不违反阈值
- 该标准是 **Non-Interference** 条款：页面上**所有**内容都必须满足，无论它是否用于满足其他成功准则

对 DSL v2 的直接含义：**「闪白」不能是 `flash` 转场的无限次连发**。DSL 应在语法层限制闪光频率，或至少在解析/校验阶段给出警告。Vine 的术语表把 "Fade to black" 列为独立条目（[VN Paths Glossary](https://vnpaths.com/visual-novels-glossary/)）。

**`prefers-reduced-motion`**：多份来源建议在用户开启该媒体查询时收敛运动量。WAAPI 侧的官方做法（[MDN Using the Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API)）：

```js
document.getAnimations().forEach((animation) => {
  animation.updatePlaybackRate(animation.playbackRate * 0.5);
});
```

原文指出用 CSS 无法全局减速（"without recalculating durations in every CSS rule"），WAAPI 可以。CSS 3D 教程的排障表也把「看着不适」对应到「在 `prefers-reduced-motion` 下收敛到静止帧」（[Chrome Developers](https://developer.chrome.google.cn/blog/performant-parallaxing)）。

---

## 7. 粒子与光效

见 §6.3（已合并，以避免重复）。补充：Ren'Py 的 `SnowBlossom` 类粒子在社区被广泛使用，`snatchernauts_fx` 的 Film Grain 参数（`intensity/size/speed/downsample`）是一套成熟的颗粒参数化（[snatchernauts_fx](https://github.com/grahfmusic/snatchernauts_fx)）。

---

## 8. CG 呈现方式

### 8.1 缩放推镜 / Ken Burns

CG 呈现的通行做法是把它当成一个可自由变换的 actor：入场时 zoom + pan，停留时缓慢 Ken Burns，出场时缩小。引擎侧无专门原语——Ren'Py 的 `show cg at zoom, move` 与 Naninovel 的 `@back` + `@camera` 组合即可。

**浏览器**：`transform` + `will-change: transform`（§2.1 的 Chrome 重栅格陷阱在此尤其重要，CG 通常是全屏大图）。

### 8.2 遮罩揭示 / 逐字揭示

Ren'Py `teleport` 转场用一张图像「一行一行地揭示新画面」（[indepth_transitions.rpy](https://code.jaenis.ch/mirrors/renpy/raw/branch/master/tutorial/game/indepth_transitions.rpy)）。浏览器：`mask-image: repeating-linear-gradient(...)` 配合 `background-size` 动画，或 `clip-path` 多边形。

### 8.3 图内动效（Layered CG）

Naninovel 的 Layered Character 机制是通用解法（[Naninovel Characters](https://naninovel.com/guide/characters.html)）。它给出的关键实现注记同样适用于浏览器：

> 角色图层对象在运行时**不被 Unity 相机直接渲染**；每次 composition（appearance）变化时渲染一次到临时 render texture，再喂给一个自定义 mesh 供 Naninovel 相机看到。这个设置是为了**避免半透明 overdraw 问题、并支持转场动画效果**。

浏览器对应：**把多层 CG 预合成到一张离屏 canvas**（`OffscreenCanvas` 或普通 `<canvas>`），然后把这张 canvas 作为 actor 使用。这样多层半透明只 overdraw 一次，转场也只作用在合成结果上。**这条对「多层立绘 + 渐变 + 磨砂」的组合是重要的性能建议。**

### 8.4 CG 的显示控制

stage-ai 现有 `<cg id caption>` 标签。业界对应的字段（[Naninovel Backgrounds](https://naninovel.com/api/) 的 `@back` 参数）：

| 字段 | 含义 |
|---|---|
| `pos` | 相对场景边框的百分比位置；z 分量用于排序 |
| `visible` | 可见性 |
| `rotation` / `scale` | 变换 |
| `tint` | 色调（`#RGB`/`#RRGGBB`/`#RGBA`/`#RRGGBBAA` 或具名色） |
| `easing` / `time` / `lazy` / `wait` | 动画控制 |
| `via` / `params` / `dissolve` | 转场 |

`lazy` 的语义值得注意：**开启后从当前状态继续动画到新目标；不开启（默认）则先瞬间完成当前动画再开始新的**（[Naninovel API](https://naninovel.com/api/)）。这是「打断转场」的行为定义。

**VNDev Wiki 的 Special graphics 分类**给出了非逐句的 CG 类特殊图形（[vndev.wiki/Special_graphics](https://vndev.wiki/Special_graphics)）：

- **Chapter card / eyecatch / bumper**：章节或幕之间的过渡图（eyecatch 源自日文「 アイキャッチ」，商业breaks 前后的序列）
- **Character splash**：重要角色登场序列，显示名字/别名 + 立绘或专属 CG，暂停或等点击；常含年龄/职业/关系等信息
- **End slate**：路线结局的收尾图，通常配结局名
- **Opening / Ending video**：片头曲/片尾曲动画
- **Cutscene**：非交互序列，通常是视频文件、事件幻灯片，或带相机运动的 event CG
- **Scrolling text（crawl / roll / ticker）**：自动滚动的文字；Star Wars 风格片头、电影片尾 roll、新闻条 ticker

---

## 9. 视频与动图素材

### 9.1 视频

**Ren'Py `Movie` displayable** 的能力与限制（[Ren'Py Movie](https://www.renpy.org/doc/html/movie.html)）：

- 支持格式：WebM / Matroska / Ogg / AVI / 各种 MPEG 流
- **「全屏播放比放进 displayable 更高效」**
- **「YUV444 视频没有硬件加速，请用 YUV420 或 YUV422」**
- **「Ren'Py 的视频解码器不支持带 alpha 通道的视频」**——用 `side_mask` 参数替代：把 mov 转成左右并排的 webm，左半是颜色、右半是 alpha
- Movie sprite：主视频提供颜色，第二个「mask 视频」提供 alpha（白=全不透明，黑=全透明）
- 全屏视频：即使音轨全是静音也仍会加载音频
- API：`Movie(*, size=None, channel='movie', play=None, side_mask=False, mask=None, mask_channel=None, start_image=None, image=None, play_callback=None, loop=True, group=None, **properties)`

**Naninoel 的 Video Character** 用循环视频 clip 表示角色外观；给 appearance 名追加 `NoLoop`（大小写不敏感）可让某个外观不循环（[Naninovel Characters](https://naninovel.com/guide/characters.html)）。

**浏览器实现的关键约束**：

1. **自动播放策略**：`playsInline = true; muted = true; loop = true` 是 WebGL 纹理喂视频的标准三件套（[MDN Animating textures in WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Animating_textures_in_WebGL)）。**未静音的视频不能自动播放**，所以背景视频必须静音。
2. **同一来源要求同时等 `playing` 与 `timeupdate` 两个事件**才认为「有数据了」——否则上传空纹理会报错。这是一个必须处理的启动竞态。
3. **CORS**：视频必须来自安全源（HTTPS）才能提供 WebGL 纹理（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Animating_textures_in_WebGL)）。
4. **视频没有 alpha 通道**（浏览器 `<video>` 不支持 alpha）——与 Ren'Py 限制一致。WebM/VP9 with alpha 在浏览器中支持有限，**side-mask 双视频方案是更稳的路径**（[Ren'Py Movie](https://www.renpy.org/doc/html/movie.html) 的 side_mask 思路）。
5. **WebCodecs**：`VideoDecoder` 把 `EncodedVideoChunk` 解成 `VideoFrame`（[MDN WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)）。但 WebCodecs **不解封装**（"does not provide a built-in way to read `EncodedVideoChunk` from a video file"），需要自己配解复用（如 mediabunny）。**结论：WebCodecs 对「时间轴精确 seek 视频帧」有价值，对「播放一段视频」是过度工程。**
6. **Godot 4 Web 导出的相关事实**（作为旁证）：HTML5 导出只支持 WebGL 2.0（Compatibility 渲染）；**不支持 WebGPU**；Forward+/Mobile 在 web 上不可用；Godot 4.3 起 web 端音频默认走 Web Audio API 的 Sample 播放模式（低延迟但功能受限，audio effects 尚未实现）（[Godot Exporting for Web](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)）。

### 9.2 动图格式

[MDN Image file type and format guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types) 的结论：

- **APNG**：「适合不需要与其他活动或音轨同步的基础动画」
- **WebP**：「图像与动画图像的极好选择」，压缩率显著优于 PNG，支持更高色深、动画帧、透明度
- **GIF**：「适合基础图像与动画」，但全彩转 GIF 会产生令人不满的抖动（dithering）
- **AVIF**：压缩率比 WebP 再高约 50%，但**浏览器支持面较窄，且不支持渐进渲染**（文件必须完整下载才能显示）
- 「PNG / JPEG / GIF 这类老格式相比新格式性能较差，但历史浏览器支持面更广」

GIF vs Lottie 的对比（同来源）：文件大小典型值 **GIF 500KB vs Lottie 20KB**；缩放性固定像素 vs 无限；可编程性否 vs 是；质量 256 色 vs 矢量完美。`lottie-web` 支持 `renderer: 'svg' | 'canvas' | 'html'`。

**归纳**：演出素材的格式选择——

| 用途 | 推荐 | 理由 |
|---|---|---|
| 循环光效/粒子/环境动效 | **animated WebP** | 体积、透明度、性能的平衡点 |
| 全屏演出片段（cutscene） | **MP4 / WebM（`<video>`）** | 硬件解码、内存恒定、可 seek |
| UI 微交互 | CSS 或 Lottie | 可编程、体积小 |
| 逐帧透明演出（立绘呼吸、表情帧动画） | **APNG / animated WebP** | GIF 色深不足 |
| 极高密度矢量演出 | Lottie | 20KB 级、无限缩放 |

**⚠️ 一个 browser 特有的坑**：Canvas 文本/图片不会在字体/资源加载完成后自动重绘（[cn-font-split #132](https://github.com/KonghaYao/cn-font-split/issues/132)）。同源问题对**动图/贴图**同样成立——canvas 绘制的内容在资源到货后需要显式重绘。stage-ai 现有的「生成资产到货才淡入」逻辑（AGENTS.md 中 `generatedAssets.ts` 的预解码）在这一点上已经是对的做法。

---

## 10. 图层合成规则（关键约束）

### 10.1 CSS 合成模型的硬性规则

**Compositing and Blending Module Level 2** 的核心规则（[drafts.csswg.org/compositing-2](https://drafts.csswg.org/compositing-2/)）：

1. 合成顺序：**先 filter effect，再 clipping、masking、blending、compositing**（遵循 SVG 合成模型）
2. **「CSS 中任何创建层叠上下文的东西都必须被视为一个『isolated group』；HTML 元素本身不创建 group」**
3. 触发 isolation 的操作：`opacity`、filters、**3D transforms（2D transforms 不触发 isolation）**、blending、masking
4. 「应用非 normal 的 blendmode 到元素上必须建立新的层叠上下文，然后与包含它的层叠上下文做混合与合成」
5. `isolation: isolate` 显式创建 stacking context
6. **「背景层必须与其下方的元素背景层及其自身的背景色混合，不得与元素背后的内容混合」**
7. 每一层背景都必须被渲染进一个 isolated group

**这三条对「舞台图层栈」的直接推论（归纳）**：

- 一个 `mix-blend-mode` 立绘只会与**它所在 isolated group 内的背景**混合。如果立绘与背景不是同一个 isolated group 的兄弟，混合结果会与预期不符。
- **舞台容器若设置了 `filter` 或 `opacity < 1`，整个子树变成一个 isolated group**——这通常正是我们想要的（整个舞台自成一组）。但要小心：任何 `filter` 都会导致其后代的 `mix-blend-mode` 只在该组内生效。
- **2D transform 不触发 isolation；3D transform 触发 isolation。** 这意味着在同一父级内用 `translateZ` 排序的面会自动分组，而用 `scale()` 排序的不会。

### 10.2 Backdrop Root：为什么不能靠 `backdrop-filter` 做背景虚化

[Filter Effects L2](https://drafts.csswg.org/filter-effects-2/) 明确解释了 Backdrop Root 的存在理由：

> 这些效果被子元素继承……包含 `backdrop-filter` 或 `mix-blend-mode` 的元素，**不明确「何时」应用该效果**……如果允许嵌套的 `backdrop-filter` 或 `mix-blend-mode` 元素，每一层嵌套都会**翻倍**所需的 repaint 周期，导致显著的性能问题。

触发 Backdrop Root 的条件包括：`filter`、`opacity`、`mask`、clipping、3D transform、blending 本身。官方同时给出性能动机：

> 每次应用 `backdrop-filter` 或 `mix-blend-mode` 都需要**单独的渲染 pass**，以完成任何部分完成的层叠上下文并取得「最终」输出作为该元素的 backdrop。这会使**所需渲染时间翻倍**，并可能需要**两倍的内存与 GPU 带宽**来存储中间图形纹理。

**归纳**：在 stage-ai 的多层舞台上：

- ❌ 「立绘清晰、背景模糊」用 `backdrop-filter: blur()` 放在立绘容器上 —— 立绘容器上的 `filter`/`opacity` 会成为 backdrop root，把背景模糊的采样截断在容器内，结果是**背景完全不糊**或**糊错对象**。
- ✅ 正确路径：对**背景层自身**施加 `filter: blur(Npx)`，立绘层不动。这不需要任何 backdrop 采样，语义精确，且只付一次 filter pass。
- ✅ 若要「焦点外的所有东西都糊」，对**焦点层之外的每个层**分别施加 blur（`filter` 独立作用域），而不是用一个 backdrop-filter 罩住全屏。

### 10.3 alpha 混合、颜色键与遮罩

| 需求 | KiriKiri | Ren'Py | PixiJS | CSS |
|---|---|---|---|---|
| 纯 alpha 混合 | `mode="alpha"`（默认） | 默认 | 默认 | `normal` |
| 颜色键抠图 | `key=0xff00ff` | — | — | 无（需预处理） |
| 遮罩图抠图 | `<name>_m` 作为 alpha | — | mask sprite | `mask-image` |
| 加算发光 | `mode="add"` | `additive` | `ADD` blend | `screen`（近似）/ Canvas `lighter` |
| 正片叠底（接影） | `mode="mul"` | `matrixcolor` | `MULTIPLY` blend | `mix-blend-mode: multiply` |
| 滤色 | `mode="screen"` | — | `SCREEN` blend | `mix-blend-mode: screen` |
| 图像混合模式 | `mode="omAlpha"` 等 ~20 种 | `blend`（模型渲染） | ~20 种 | ~16 种 |

**「接影」技巧（归纳）**：把立绘的影子层用 `mix-blend-mode: multiply` 贴在背景上，是让立绘「站进场景」的最便宜手段。浏览器实现是两层 `<div>`，第二层纯黑 + blur + multiply。

### 10.4 立绘与背景的融合

三条已验证的路径：

1. **Normal map 伪光照**（《咒术回战 Phantom Parade》）：给 2D 立绘加法线贴图，让它接收来自背景的光，从而贴合背景、消除平面感（[CyberAgent Developers Blog](https://developers.cyberagent.co.jp/blog/archives/46743/)）。
2. **Layered actor + 专用相机渲染**（Naninovel）：角色 prefab 内含粒子/拖尾/sprite mask/第三方渲染器时，分配一台相机渲染到 render texture；需要预留 Unity camera layer 池（32 层中 8 层被引擎保留）（[Naninovel Characters](https://naninovel.com/guide/characters.html)）。
3. **着色器模拟光照（有明确上限）**：Ren'Py 社区包文档直言「物体不会投射阴影，着色器无法获取自身之外的信息，所以也无法接受阴影。这是模拟的光照效果，在与真实光源系统对比时有局限」（[Make Visual Novels!](https://makevisualnovels.itch.io/make-visual-novels-rspv1)）。

**浏览器对应**：路径 1 与 3 需要 WebGL；路径 2 对应 `OffscreenCanvas` 预合成。

### 10.5 DOM 层数与内存

[Stick to Compositor-Only Properties](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count)：

> 每一个创建的层都需要内存与管理，而这**不是免费的**。实际上在内存受限的设备上，创建层对性能的影响可能**远远超过**它带来的收益。每个层的纹理都需要上传到 GPU，因此还有 CPU↔GPU 带宽与 GPU 纹理内存的进一步约束。

并明确劝阻 `* { will-change: transform; transform: translateZ(0); }` 这种「把所有元素都提升」的写法。诊断方法：Chrome DevTools Timeline 的 **Paint profiler** 追踪层数，合成应控制在 **4–5ms** 内。

**另一条关于 GPU 内存泄漏的实践细节**（[Off-Main-Thread Rendering](https://www.browser-rendering.com/compositing-and-gpu-acceleration/off-main-thread-rendering/)）：被提升的层在动画结束、`will-change` 被移除时，浏览器会重新栅格化并在**最后几帧产生可见卡顿**；解决方法是等待 `transitionend`（或 `animationend` + 一个 `requestAnimationFrame`）让合成器先提交最后一帧再释放纹理。**这条对「一次性演出效果」的生命周期管理有直接价值。**

**WebGL context 上限**：「浏览器对每页同时存在的 WebGL context 大致限制在 **8–16** 个，把 canvas 移进 worker 并不会给你更多额度。超过上限时 Chrome 会静默丢弃最久未用的 context，表现为空白 canvas 或 `webglcontextlost` 事件」（[javascript-web-workers.com](https://javascript-web-workers.com/high-performance-computation-patterns/offscreen-canvas-rendering/)）。**含义：不要为每个特效各开一个 canvas。**

---

## 11. 非纯视觉的演出同步原语

### 11.1 等待与并行

**KAG 的「触发 + 等待」二元组**（[KAG Tags](https://kirikirikag.sourceforge.net/contents/Tags.html)）：

| 触发标签 | 等待标签 | 含义 |
|---|---|---|
| `trans` | `wt` | 等转场 |
| `move` | `wm` | 等自动移动 |
| `animstart` | `wa` | 等动画 |
| `quake` | `wq` | 等震动 |
| — | `wait time=3000` | 固定毫秒 |
| — | `waitclick` | 等点击 |
| — | `stoptrans` / `stopmove` / `animstop` / `stopquake` | 强制中止 |

KAG 文档明确警告：「对应的『等待』标签一定要写。即使是想用不同类的物事凑合（例如用 `wait` 标签等转场结束），也还是应该写上正确的等待标签。」

**Ren'Py**：`pause .5`（ATL 内）、`play audio "x.opus"` + `with vpunch`（转场自带等待）、`nvl`/`nvl clear`（多行模式）。

**Naninovel 的现代方案**（[Naninovel Scenario Scripting](https://naninovel.com/guide/scenario-scripting.html)）：

> 有些命令会随时间执行。例如 `@hide` 会在指定时间内淡出指定 actor。**默认情况下所有异步命令都不被等待**：`@show` 会在 `@hide` 开始淡出 Kohaku 后立刻开始淡入 Yuko。
> 若想在异步命令完成前继续等待，使用 `wait` 参数。
> 用 `@async` 命令让嵌套的行在**独立的脚本轨道上并发执行**，同时主播放例程继续推进。

官方给出的 `@async` 完整示例：

```nani
@async
    @bgm volume:0.7 fade:10
    @camera offset:4,1 zoom:0.5 time:3 wait!
    @bgm volume:0.3 fade:5
    @camera offset:,-2 zoom:0.4 time:2 wait!
    @stopBgm fade:10
    @camera offset:0,0 zoom:0 time:3 wait!
```

**归纳出的 DSL 时间控制原语**：

| 原语 | 语义 | 对应 |
|---|---|---|
| 串行 | 逐条执行，后一条等前一条 | 默认 |
| `wait` / `wait!` | 等本条完成再继续 | Naninovel `wait!` |
| `async` / 并行轨 | 在独立轨道并发执行 | Naninovel `@async` |
| 固定延时 | 等 N ms | KAG `wait time=N` |
| 显式中止 | 取消正在进行的转场/移动/震动 | KAG `stoptrans`/`stopmove`/`stopquake` |
| 打断语义 | 从当前状态继续 vs 先完成再开始 | Naninovel `lazy` |
| 命令内联 | 在一行台词中途执行命令 | Naninovel `[...]` 语法 |

### 11.2 命令内联（inline in a line）

Naninovel 明确支持（[Naninovel Scenario Scripting](https://naninovel.com/guide/scenario-scripting.html)）：

> 有时你可能想在**揭示（打印）文本的过程中**执行命令——比如某个角色在特定词被打印时改变外观，或某个音效在消息中途响起。**命令内联特性**用方括号 `[]` 处理这些情况。

「所有命令（标准与自定义）都可以内联到通用文本行中」。

**对 stage-ai DSL v2 的含义**：现有 DSL 是「标签先于台词」的模型；内联（如 `<say>她轻声说<sfx src="x"/></say>`）是一个自然扩展，且能表达「立绘在台词某个词后变表情」这类现代演出。Ren'Py 有等价的 `[variable]` 插值但语义不同；Naninovel 的方括号内联更贴演出。

### 11.3 条件

**Ink**（inkle）提供了最丰富的条件原语（[inkle/ink Documentation/WritingWithInk](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md)）：

- 简单条件：`* {seen_clue > 3} [Flat-out arrest Mr Jefferson]`
- 高级逻辑：变量、比较、算术
- **Alternatives（替代项）**，写在 `{...}` 中，用 `|` 分隔：
  - **Sequence（默认）**：记录被看过几次，每次显示下一个；用完后持续显示最后一个
  - **Cycle**（`&` 标记）：循环
  - **Once-only**（`!` 标记）：用完后**不显示任何内容**
  - **Shuffle**（`~` 标记）：随机输出
  - 支持空元素、嵌套、可含 divert 语句
- 条件文本：`* { 条件 } 文本`

**KAG**：`if` / `else` / `elsif` / `endif` / `ignore` / `endignore`，带 `cond` 属性（`cond="mp.笑"`）——**标签级条件，可作用于任何标签**（[KAG Tags](https://kirikirikag.sourceforge.net/contents/Tags.html)）。

**归纳**：DSL v2 需要的是「**标签级条件属性**」（`<actor id="x" cond="..."/>`）而不是分支语句块——这与 Ink 的 `* {cond}` 思路一致，且不需要把脚本变成可跳转的图（stage-ai 的剧本是线性流）。

### 11.4 时间缩放 / 快进

**WAAPI 的 `playbackRate` / `updatePlaybackRate`**（[MDN Animation.playbackRate](https://developer.mozilla.org/en-US/docs/Web/API/Animation/playbackRate)、[updatePlaybackRate](https://developer.mozilla.org/en-US/docs/Web/API/Animation/updatePlaybackRate)）：

- `playbackRate` 是缩放因子，初值 1；设为 0 相当于暂停（但 `playState` 不一定是 `paused`）；负值倒放
- `updatePlaybackRate(r)` 是**异步**方法：先同步当前播放位置再改速，因此不会产生跳变。**因为动画可能在独立线程/进程运行、直接设 `playbackRate` 会让位置跳变**
- `document.getAnimations()` 可枚举全页动画
- `animation.currentTime` 可读写（scrubbing），可 `pause()` / `play()` / `finish()` / `cancel()` / `reverse()`

**⚠️ 时间精度警告**：[MDN `Animation.currentTime`](https://developer.mozilla.org/en-US/docs/Web/API/Animation/currentTime) 明确：「为防止计时攻击与指纹追踪，`animation.currentTime` 的精度可能因浏览器设置而降低。」**含义：不要用 WAAPI 的 `currentTime` 做需要毫秒级确定性的演出时钟。**

**归纳**：stage-ai 现有「按住 Ctrl 的快进档」需要一个统一的 `timeScale` 概念，它必须作用在：
1. 自有动画驱动（若用 rAF）
2. WAAPI 动画（`updatePlaybackRate`）
3. CSS animation（只能靠 `animation-duration` 重算，不可变）
4. 打字机推进
5. 音频（`playbackRate` 会改变音高，需用 `preservesPitch`）

Ren'Py 的 `config.skipping` 会在 rollback 时被清除（[renpy/rollback.py](https://github.com/renpy/renpy/blob/2820893a/renpy/rollback.py)），说明 skip 模式是全局状态。

### 11.5 确定性回放（Rollback / Save-Load）

Ren'Py 的 rollback 模型（[Saving, Loading, and Rollback](https://www.renpy.org/doc/html/save_load_rollback.html)）：

- **「rollback 可以被认为是：在每个与用户交互的语句开始时保存游戏，在用户回滚时载入存档。」**
- **「保存发生在语句的开始处。如果载入或回滚发生在一个多次交互的语句中途，状态是该语句开始时激活的状态。」**
- 存档只记录「当前语句」与「需要返回的语句」，不记住到达路径
- checkpoint 是 `say` 与 `menu` 语句，以及调用了 `renpy.checkpoint()` 的 python 块
- `renpy.rollback(abnormal=True)`：回滚后第一个 transition 以**异常模式**执行，「跳过本应发生的转场」
- **回滚会 `rng.reset()`**（[renpy/rollback.py](https://github.com/renpy/renpy/blob/2820893a/renpy/rollback.py)）
- 回滚会 `renpy.audio.audio.rollback()`（停掉所有声音）与 `scene_lists.remove_all_hidden()`（停止所有隐藏动画）
- `block_rollback()` / `fix_rollback()` / `suspend_rollback()`：分别禁止回滚到当前语句之前 / 禁止改变之前的决策 / 暂停回滚
- **`renpy.retain_after_load()`**：让「当前语句到下一个 checkpoint 之间修改的数据」在载入后保留

**归纳出的对 DSL v2 的硬性设计约束**：

1. **DSL 的时间控制与随机必须可种子化**。`Math.random()` 在回看/回滚时不可复现 → 震动幅度、粒子、glitch 必须由 `seed + index` 驱动。
2. **DSL 的演出状态必须是可序列化的纯数据**（transform 数值、alpha、mask 参数），不能把「正在播放的 WAAPI Animation 对象」当作状态。Ren'Py 的做法是回滚时 `remove_all_hidden()` + 抑制下一次转场，等价于「取消所有在飞的动画并把画面直接设到目标态」。
3. **`abnormal` 模式**是必需的：回看/快进跳过时，所有耗时的演出应当瞬间完成或被跳过，而不是重新播放。
4. **checkpoint 的粒度应该是「一句台词」**，与 stage-ai 现有谱系（lineage）设计一致。

### 11.6 随机性的可复现

Ren'Py 在 rollback 时 `rng.reset()`（[renpy/rollback.py](https://github.com/renpy/renpy/blob/2820893a/renpy/rollback.py)）。对应到浏览器：`Math.random()` 不可回滚，需要自建 seeded PRNG（mulberry32/xorshift 之类），并把 seed 存进演出状态。

**这直接影响 §4.3 的震动与 §6.3 的 glitch 实现**：Naninovel 的「Amplitude variation」「Duration variation」这类随机化参数，在 DSL 层必须表达为「由 (seed, 事件序号) 决定的确定性扰动」。

### 11.7 文本同步（打字机 / 语音）

Naninovel 文档中与文本同步相关的可考证事实：

- `On Started Speaking` / `On Finished Speaking` 在**文本完全揭示后**触发，不是逐字（[Naninovel Characters](https://naninovel.com/guide/characters.html)）
- `Voice Source` 可用音频波形驱动口型；`Cubism Audio Mouth Input` / SALSA 是被点名的方案
- `Skip On Input` / `Skip Frames` 是配置项（[Naninovel Configuration](https://pre.naninovel.com/guide/configuration)）
- 支持从 Fountain screenplay 导入，Action 与 Dialogue 段落转为通用文本行（[Naninovel Scenario Scripting](https://naninovel.com/guide/scenario-scripting.html)）

**浏览器文本能力**：

- **Ruby（注音）**：所有主流浏览器都能正确渲染简单的单侧 `<ruby><rb>…</rt></ruby>`。但**表格式 ruby（先全部 `rb` 再全部 `rt`）在 Blink/WebKit 中解析正确但布局错误**；双侧 ruby 需要嵌套标记或 `rtc`，Gecko 处理得最好（[W3C Ruby Markup](https://www.w3.org/International/articles/ruby/markup)）。**结论：简单单侧 ruby 可以用，表格式/双侧不要用。**
- **日文 CJK web font 成本**：日文常用汉字超 2,000 字，字体被切成数百个 subset 文件，body CSS 本身约 150KB 且是 render-blocking（[Reinvent Notes](https://notes.rewheel.dev/en/blog/core-web-vitals-japanese-fonts)）。**stage-ai 的 UI 全中文，字体策略需按该文建议：`font-family: system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` 走系统字体，零字节传输**（[Toolbox365 · CJK font subsetting](https://www.toolbox365.net/tutorials/font-subset-unicode-range-and-cjk-strategy/)）。
- `font-display`：`block`（默认，Chromium/Firefox 最多阻塞 3 秒，**Safari 无限期阻塞**）、`swap`、`fallback`（100ms block + 3s swap）、`optional`（100ms 后不再 swap）（[web.dev · Optimize web fonts](https://web.dev/learn/performance/optimize-web-fonts)）。
- **Canvas 文本不会在字体加载后自动重绘**：需 `document.fonts.load()` / `document.fonts.ready` 等待，或监听 `document.fonts.onloadingdone` 手动重绘（[cn-font-split #132](https://github.com/KonghaYao/cn-font-split/issues/132)）。
- **HTML Canvas 渲染**（实验特性）可在 DOM 与 canvas 之间镜像绘制，1:1 映射 CSS 像素（[MDN 相关实验](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawElement)）。

---

## 12. 缓动函数取值空间总表

**Naninovel 的完整缓动枚举**（[Naninovel Transition Effects · Animation Easing](https://nani.nanana.cn/guide/transition-effects)）：

```
Linear
SmoothStep
Spring
EaseInQuad       EaseOutQuad       EaseInOutQuad
EaseInCubic      EaseOutCubic      EaseInOutCubic
EaseInQuart      EaseOutQuart      EaseInOutQuart
EaseInQuint      EaseOutQuint      EaseInOutQuint
EaseInSine       EaseOutSine       EaseInOutSine
EaseInExpo       EaseOutExpo       EaseInOutExpo
EaseInCirc       EaseOutCirc       EaseInOutCirc
EaseInBounce     EaseOutBounce     EaseInOutBounce
EaseInBack       EaseOutBack       EaseInOutBack
EaseInElastic    EaseOutElastic    EaseInOutElastic
```

共 3 + 30 = 33 个。Naninovel 的全局默认：**背景 `Linear`，角色 `SmoothStep`**（[Naninovel Configuration](https://pre.naninovel.com/guide/configuration)）。

**动画生态的标准集**（[easings.net](https://easings.net/) 的 30 个预设；GSAP 使用的是 Robert Penner 在 2002 年《Flash》书中确立的方程集：Sine/Quad/Cubic/Quart/Quint/Expo/Back/Circ/Elastic/Bounce —— [Milk Moon Studio 的 GSAP easing 指南](https://easing.milkmoonstudio.com/)）：

- CSS 原生关键词：`linear`、`ease`、`ease-in`、`ease-out`、`ease-in-out`、`ease-step-start`、`ease-step-end`、`steps(n, jump-*)`
- CSS `cubic-bezier(x1,y1,x2,y2)`：控制点 0..1（y 可超出 0..1 以产生 overshoot/undershoot）。`cubic-bezier(0.34, 1.56, 0.64, 1)` 是 Back/overshoot 的常用近似（[Milk Moon Studio](https://easing.milkmoonstudio.com/)）
- `linear(x1, x2, x3, ...)` 多点线性插值、`irregular(length, randomness)` 随机阶梯缓动、`in(power)`/`out(power)`/`inOut(power)` 参数化幂函数 —— anime.js v4 新增（[anime.js v4.0.0 release notes](https://newreleases.io/project/github/juliangarnier/anime/release/v4.0.0)）

**浏览器对 overshoot 的硬限制（归纳）**：`ease-in-back` / `ease-out-back` / `ease-out-elastic` / `ease-out-bounce` 的 y 值超出 [0,1]，**CSS `cubic-bezier()` 的控制点 y 允许超出 [0,1]**，因此 Back 类可以直接用 `cubic-bezier` 表达；**但 Elastic 与 Bounce 不是多项式，必须用 `@keyframes` 多段关键帧或 JS 逐帧计算**。

**Ren'Py 的缓动模型**：ATL 的 `linear` / `ease` / `easein` / `easeout` / `easeinout` 语句，加上 **Interpolation Statement**（`warper_name` 内置 warper / `warper_function` 自定义 `str` 函数签名 `(t: float) -> float`）（[Ren'Py Transforms · Interpolation Statement](https://www.renpy.org/doc/html/transforms.html)）。**归纳：`ease = linear` + `warp <funcname>` 是 Ren'Py 的模型**，对应 browser 的「缓动 = 时间→进度的重映射函数」，这个抽象是可移植的。

**Ren'Py 的 warper 内置清单**（[Transforms](https://www.renpy.org/doc/html/transforms.html)）包含 `linear`、`ease`、`easein`、`easeout`、`easeinout`，以及 `easeovershoot`、`easebounce`、`easeback`。

---

## 13. 浏览器技术可行性总表

可行性判定依据：CSS/WAAPI 规范文本（[Filter Effects L2](https://drafts.csswg.org/filter-effects-2/)、[Compositing and Blending L2](https://drafts.csswg.org/compositing-2/)、[web.dev 合成器属性](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count)）+ 实测数据（[arXiv 2608.23609](https://arxiv.org/pdf/2608.23609)、[Off-Main-Thread Rendering](https://www.browser-rendering.com/compositing-and-gpu-acceleration/off-main-thread-rendering/)）。

| 效果 | 手段 | 走合成器？ | 需离屏 pass | 备注 |
|---|---|---|---|---|
| 位移 / 缩放 / 旋转 / 翻转 | `transform` | ✅ | 否 | 缩放需 `will-change: transform` 防 Chrome 重栅格 |
| 透明度 | `opacity` | ✅ | 否 | |
| 立绘层级 | `z-index` | — | 否 | `blend`/`filter`/`opacity<1` 会创建层叠上下文改变语义 |
| 交叉溶解 / 淡入淡出 | 双层 `opacity` | ✅ | 否 | |
| 闪白 / 闪黑 / 闪电 | 纯色层 `opacity` | ✅ | 否 | ⚠️ 受 WCAG 2.3.1 闪烁阈值约束 |
| 推移 / 滑动 | `transform` | ✅ | 否 | |
| 缩放推镜 | `transform: scale` | ✅ | 否 | ⚠️ 同上重栅格陷阱 |
| 虹膜 / 圆形揭示 | `clip-path: circle()` | ✅ | 否 | |
| 聚光灯 | `mask-image: radial-gradient` | ✅ | 否 | |
| 百叶窗 / 方格 / 线条揭示 | `mask-image` 渐变 | ✅ | 否 | |
| **规则图像溶解** | `mask-image: url(rule.png)` | ✅ | 否 | 256 级灰度，禁 POT/mipmap |
| 遮幅 letterbox | 覆盖层 `transform`/`height` | ✅ | 否 | |
| 景深式背景虚化 | 对背景层 `filter: blur()` | ❌ | 每帧一次 filter | 静态值便宜，动画值昂贵 |
| 灰度 / 亮度 / 对比 / 饱和 / 色相 | `filter` | ❌ | 每帧 | |
| 色调矩阵 | SVG `feColorMatrix` 或 WebGL | ❌ | 视情况 | `filter` 无 matrix 等价 |
| 暗角 vignette | `radial-gradient` 覆盖层 | ✅ | 否 | |
| 扫描线 | `repeating-linear-gradient` | ✅ | 否 | |
| 噪点 / 颗粒 | SVG `feTurbulence` 或 WebGL | ❌ | 是 | 逐帧变化，需重绘 |
| 抖动 shake | `transform` 关键帧或 rAF | ✅ | 否 | 必须 seeded |
| 故障 glitch | WebGL 块随机偏移 | ❌ | 是 | CSS 无法逐块 |
| 色差 chromatic aberration | WebGL 分通道采样 | ❌ | 是 | |
| 桶形畸变 | WebGL / `matrix3d` 近似 | ❌ | 是 | |
| Bloom | WebGL 多 pass | ❌ | 是（多） | |
| 2D 光照 | WebGL + normal map | ❌ | 是 | 无阴影（引擎侧同样受限） |
| 波浪 / 涟漪 / 旋涡 / 形变转场 | WebGL shader 或 SVG filter | ❌ | 是 | |
| 径向模糊 | WebGL | ❌ | 是 | CSS 只有各向同性 blur |
| **真 DOF（按 z 连续变模糊）** | WebGL | ❌ | 是 | **CSS 无此原语** |
| 透视 / 伪 3D / 四点映射 | `perspective` / `matrix3d` / `preserve-3d` | ✅ | 否 | ⚠️ `filter`/`clip-path`/`overflow` 会压平 |
| 粒子（<100） | CSS/DOM | ✅ | 否 | |
| 粒子（~1500） | Canvas 2D 主线程 | ❌ | — | 实测上限 |
| 粒子（1万+） | WebGL2 / PixiJS | ❌ | — | 主线程会与 UI 抢帧 |
| 粒子（25 万） | OffscreenCanvas + Worker | ❌ | — | 实测 ~144 FPS vs 主线程 ~52 FPS |
| 光束 god ray | `conic-gradient` + `screen` | 部分 | 每层一次 blend | 多层叠加线性增本 |
| 视频背景 | `<video muted playsinline loop>` | ✅（合成） | — | 必须等 `playing` + `timeupdate`；需 HTTPS/CORS |
| 视频带 alpha | **浏览器不支持** | — | — | 需 side-mask 双视频方案 |
| 视频纹理 | `texImage2D(video)` | — | — | 每页 WebGL context 上限 8–16 |
| WebCodecs 精确帧控制 | `VideoDecoder` | — | — | 不解封装，需额外库 |
| 动图 | animated WebP / APNG / GIF | ✅ | — | GIF 256 色 + 抖动差 |
| Lottie | `lottie-web`（svg/canvas/html） | 部分 | — | 20KB vs GIF 500KB |
| 简单 ruby 注音 | `<ruby>` | — | — | 表格式/双侧在 Blink/WebKit 布局错误 |
| 縦書き | `writing-mode: vertical-rl` | — | — | |

---

## 14. 明确做不到 / 代价高昂的清单

### 14.1 浏览器 CSS 层做不到

1. **真景深（depth of field）**。CSS `filter: blur()` 没有 per-pixel 的深度输入。Ren'Py 也是靠 shader（`bokeh`）实现的，Naninovel 的 `Focal Length` 参数同理。**唯一路径是 WebGL。**
2. **逐像素几何形变的转场**（`Wave`/`Ripple`/`Swirl`/`Crumble`/`RadialWiggle`）。CSS `clip-path` 只能做直线/圆形/多边形。KiriKiri 的 `ripple` 官方就注明需要**预计算 0.5–4MB 数值表**以保证流畅（[KiriKiri トランジションについて](https://krkrz.github.io/krkr2doc/kr2doc/contents/Transition.html)）。
3. **桶形畸变、色差、多 pass bloom**。
4. **带 alpha 的视频**。`<video>` 无 alpha 通道；Ren'Py 也明确不支持（[Ren'Py Movie](https://www.renpy.org/doc/html/movie.html)）。
5. **全局时间缩放**。CSS 动画的 `animation-duration` 不可变，无法像 WAAPI 那样统一 `playbackRate`。
6. **颜色键（color key）抠图**。CSS 无 `key=0xff00ff` 等价物，需在素材侧预处理或用 `mix-blend-mode` 近似。
7. **表格式 / 双侧 ruby 的正确排版**（Blink/WebKit）。

### 14.2 代价高昂（可行但需权衡）

1. **动画 `filter: blur()`**。原文：「`filter: blur()` 看起来是 compositor-safe……但一旦你在全宽 hero 上动画化模糊半径，**每一台没有独显的设备上帧率都会腰斩**」（[css-animation.com](https://www.css-animation.com/core-css-animation-fundamentals/hardware-accelerated-properties/when-filter-and-backdrop-filter-are-worth-the-paint/)）。
2. **嵌套 / 多次 `backdrop-filter` 与 `mix-blend-mode`**。规范明示会导致**指数级**性能劣化（[Filter Effects L2](https://drafts.csswg.org/filter-effects-2/)）。
3. **大量合成层**。每层有 GPU 纹理内存与带宽成本，低内存设备上收益可能为负（[web.dev](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count)）。`will-change` 移除时机不当会在动画结束瞬间产生可见卡顿。
4. **无 `will-change: transform` 的 scale 动画（Chrome）**：逐帧重新栅格化全屏大图（[Chrome Developers](https://developer.chrome.com/blog/re-rastering-composite)）。
5. **主线程粒子系统**。实测瓶颈是「主线程竞争」而非绘制本身，**先 offload 再谈渲染器**（[arXiv 2608.23609](https://arxiv.org/pdf/2608.23609)）。
6. **每页 8–16 个 WebGL context 上限**；worker 不增加额度。
7. **多层半透明立绘**。Naninovel 专门把 layered actor 渲到临时 RT 再上屏，正是为了「避免半透明 overdraw 问题并支持转场」（[Naninovel Characters](https://naninovel.com/guide/characters.html)）。DOM 多层同样有 overdraw 成本。
8. **真 2D 光照（含阴影）**。Ren'Py 社区包自述「不是真光照系统，物体不投射阴影，着色器无法获取自身之外的信息」（[Make Visual Novels!](https://makevisualnovels.itch.io/make-visual-novels-rspv1)）。Naninovel 需要为角色分配 camera layer 池（32 层中可用 24 层）（[Naninovel Characters](https://naninovel.com/guide/characters.html)）。**浏览器侧对应的是 WebGL + 离屏 pass，成本同样高。**
9. **日文 CJK web font**。若剧本可能出现日文，需按 [Reinvent Notes](https://notes.rewheel.dev/en/blog/core-web-vitals-japanese-fonts) 的量化：body CSS 约 150KB 且 render-blocking，字体被切成数百个 subset 文件。**本项目 UI 与 AGENTS.md 记录均为中文语境（[Toolbox365 · CJK font subsetting](https://www.toolbox365.net/tutorials/font-subset-unicode-range-and-cjk-strategy/) 的建议是 CJK UI 走 `system-ui` 字体栈、零字节传输），故这条成本在当前内容下不触发。**

### 14.3 引擎侧本身就有的天花板（不是浏览器问题）

- Ren'Py 视频不支持 alpha（[Ren'Py Movie](https://www.renpy.org/doc/html/movie.html)）
- Ren'Py 着色器模拟光照无阴影（[Make Visual Novels!](https://makevisualnovels.itch.io/make-visual-novels-rspv1)）
- KAG `base` 层无法自由移动（KAGEX 需专门加 `stage` 层）（[KAGEX](https://www.nvlmaker.net/manual/docs/kagex.html)）
- KAG 无独立的 fade-in / fade-out 概念（[KAG Trans.html](https://krkrz.github.io/krkr2doc/kag3doc/contents/Trans.html)）
- Godot 4 Web 导出只支持 WebGL 2.0，不支持 WebGPU / Forward+（[Godot Docs](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)）
- Unity 相机 layer 池：32 层中 8 层被引擎保留（[Naninovel Characters](https://naninovel.com/guide/characters.html)）
- Naninovel 的 Live2D 集成在 Cubism SDK for Unity R5 后已无法维护，官方建议改用 Generic / Layered(camera mode) / custom（[Naninovel Characters](https://naninovel.com/guide/characters.html)）

---

## 15. 对 stage-ai DSL v1 现状的对照

（本节为本项目内的事实核对，不含建议。）

**v1 标签集**（`packages/core/src/dsl/spec.ts:20-29`）：

```
scene | actor | say | narrate | thought | sfx | cg | comment
```

**v1 的相关约束**（源码注释）：

- `SceneAttrs`（`spec.ts:62-73`）：`bg` / `bgm` / `ambient` / `bgm_volume` / `ambient_volume` / `transition`；音频属性缺省一律表示「保持当前」，`none` / `""` / 大写 `NONE` = 停止；背景 `bg` 缺省保持上一张
- `ActorAttrs`（`spec.ts:75-81`）：仅 `id` / `pos` / `expression` / `action`
- `SayAttrs`（`spec.ts:88-93`）：`id` / `name` / `mood`
- `CgAttrs`（`spec.ts:95-98`）：`id` / `caption`
- `VOID_TAGS`（`spec.ts:33`）：`scene` / `actor` / `sfx` / `cg`
- 解析器 `pick(attrs, ["bg","bgm","ambient","transition"])`（`packages/core/src/dsl/parser.ts:221`）
- 谱系回放 `pickDefined(attrs, [...])`（`packages/core/src/lineage/replay.ts:91`）

**前端对 transition 的实际处理**：

- `apps/web/src/stage/StageTheater.tsx:334`：`visual.transition === "cut" ? "cut" : ""` —— **非 `cut` 的 transition 一律降级为空串（即无转场）**
- `apps/web/src/stage/director.ts:251`：`transition: cue.transition ?? "fade"` —— **cues 层默认 `fade`**
- `apps/web/src/stage/script.ts:84`：`transition: event.transition`

**与业界对照的差距清单（事实陈述）**：

| 维度 | v1 现状 | 业界最低基线（来源见正文） |
|---|---|---|
| 立绘位置 | `pos: string`（left/center/right） | `x,y` 百分比对 + `anchor` + `z`（Naninovel）/ `xpos/ypos/xalign/yalign/xanchor`（Ren'Py） |
| 立绘变换 | 无 | position / rotation / scale / flip（Ren'Py 变换属性表） |
| 立绘层级 | 无显式控制 | `zorder` / `behind`（Ren'Py）、`level`（KAGEX）、`z` 分量（Naninovel） |
| 立绘外观 | `expression` → 素材 id | 外观表达式（整图 / 部件组合 `>+-` 表达式） |
| 立绘进出 | 无（隐含） | `via` + `time` + `easing`（Naninovel）/ `zoomin` `movein*`（Ren'Py） |
| 说话高亮 | 无 | Speaker Highlight（Naninovel） |
| 场景转场 | 仅识别 `cut` | 20+ 内置转场（Naninovel）/ 规则图像（KAG universal）/ `Fade(out,hold,in,color)`（Ren'Py） |
| 屏幕效果 | 无 | filter 全集 / 暗角 / 颗粒 / 光效（§6） |
| 粒子 | 无 | rain/snow/sun/bokeh/blur/glitch（Naninovel） |
| 时间控制 | 无 | `wait` / `async` / `lazy` / 命令内联（Naninovel、KAG） |
| 条件 | 无 | 标签级 `cond`（KAG）/ `* {cond}`（Ink） |
| 缓动 | 无 | 33 个枚举（Naninovel）/ `warp` 函数（Ren'Py） |

**已具备的、v2 应保留的能力（不需改动）**：BGM/ambient 的「缺省=保持、`none`=停止」语义（与 `director.ts` 的 `resolveAudio` 一致）、`sfx` 一次性音效、`cg` + `caption`、`comment` 作为合法出口的设计。

---

## 16. 信源索引

### 引擎文档

- [Ren'Py — Displaying Images](https://www.renpy.org/doc/html/displaying_images.html) ｜ [Displayables](https://www.renpy.org/doc/html/displayables.html) ｜ [Transforms](https://www.renpy.org/doc/html/transforms.html) ｜ [Transform Properties](https://www.renpy.org/doc/html/transform_properties.html) ｜ [Transitions](https://renpy.org/dev-doc/html/transitions.html) ｜ [Image Manipulators](https://www.renpy.org/doc/html/im.html) ｜ [Movie](https://www.renpy.org/doc/html/movie.html) ｜ [Saving, Loading, and Rollback](https://www.renpy.org/doc/html/save_load_rollback.html) ｜ [indepth_transitions.rpy 教程源码](https://code.jaenis.ch/mirrors/renpy/raw/branch/master/tutorial/game/indepth_transitions.rpy) ｜ [renpy/rollback.py](https://github.com/renpy/renpy/blob/2820893a/renpy/rollback.py)
- [KAG タグ一覧](https://kirikirikag.sourceforge.net/contents/Tags.html) ｜ [トランジションを使おう](https://krkrz.github.io/krkr2doc/kag3doc/contents/Trans.html) ｜ [吉里吉里 トランジションについて](https://krkrz.github.io/krkr2doc/kr2doc/contents/Transition.html) ｜ [グラフィックシステム](https://krkrz.github.io/docs/kirikiriz/j/contents/GraphicSystem.html) ｜ [前景レイヤ表示](https://kirikirikag.sourceforge.net/contents/DispLayer.html) ｜ [perspective.dll メモ](https://wikiwiki.jp/gutchie/%E5%90%89%E9%87%8C%E5%90%89%E9%87%8C%E3%83%97%E3%83%A9%E3%82%B0%E3%82%A4%E3%83%B3%E3%81%AB%E9%96%A2%E3%81%99%E3%82%8B%E3%83%A1%E3%83%A2/perspective.dll) ｜ [吉里吉里プラグイン概説](http://keepcreating.g2.xrea.com/DojinDOC/krkrDefaultPlugins.html)
- [Naninovel — Characters](https://naninovel.com/guide/characters.html) ｜ [Special Effects](https://naninovel.com/guide/special-effects.html) ｜ [Transition Effects](https://nani.nanana.cn/guide/transition-effects) ｜ [Scenario Scripting](https://naninovel.com/guide/scenario-scripting.html) ｜ [API（命令参数表）](https://naninovel.com/api/) ｜ [Configuration](https://pre.naninovel.com/guide/configuration) ｜ [Custom Actor Implementations](https://naninovel.com/guide/custom-actor-implementations.html) ｜ [Custom Actor Shader](https://naninovel.com/guide/custom-actor-shader)
- [KAGEX 概要（THE NVL Maker）](https://www.nvlmaker.net/manual/docs/kagex.html) ｜ [ティラノスクリプト タグリファレンス](https://tyrano.jp/tag/) ｜ [ティラノ キャラクター操作](https://tyrano.jp/usage/tech/chara) ｜ [空想曲線 · キャラクタ立ち絵編](https://kopacurve.blog.fc2.com/blog-entry-387.html)
- [Visual Novel Maker · Screen](https://asset.visualnovelmaker.com/help/Screen.htm) ｜ [Live2D Cubism for Web 框架使用](https://docs.live2d.com/en/cubism-sdk-manual/use-framework-web/) ｜ [CubeMotion Web Components](https://github.com/Live2D/CubismWebMotionSyncComponents)
- [inkle/ink — Writing With Ink](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md) ｜ [Unity Cinemachine 2.5](https://docs.unity3d.com/Packages/com.unity.cinemachine@2.5/manual/CinemachineUsing.html) ｜ [Godot Tween](https://docs.godotengine.org/en/stable/classes/class_tween.html) ｜ [Godot Exporting for Web](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)

### 商业作品 / 制作方

- [『呪術廻戦 ファントムパレード』ADV制作事例（CyberAgent）](https://developers.cyberagent.co.jp/blog/archives/46743/) ｜ [同 · シネマティックシーン制作](https://developers.cyberagent.co.jp/blog/archives/47520/)
- [Sprites, Camera, Action! — Of Sense and Soul（ingthing.dev）](https://ingthing.dev/sprites-camera-action-osas/)
- [snatchernauts_fx（Ren'Py GL2 后期栈）](https://github.com/grahfmusic/snatchernauts_fx) ｜ [Make Visual Novels! RenPy Shader Pack](https://makevisualnovels.itch.io/make-visual-novels-rspv1) ｜ [Ren'Py Utility Bundle](https://cross-couloir.itch.io/renpy-utility-bundle-free-edition)

### 浏览器规范

- [Filter Effects Module Level 2（drafts.csswg.org）](https://drafts.csswg.org/filter-effects-2/)
- [Compositing and Blending Module Level 2（drafts.csswg.org）](https://drafts.csswg.org/compositing-2/)
- [Web Animations Level 1（W3C）](https://www.w3.org/TR/web-animations-1/)
- [MDN — Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API) ｜ [Animation](https://developer.mozilla.org/en-US/docs/Web/API/Animation) ｜ [playbackRate](https://developer.mozilla.org/en-US/docs/Web/API/Animation/playbackRate) ｜ [updatePlaybackRate](https://developer.mozilla.org/en-US/docs/Web/API/Animation/updatePlaybackRate) ｜ [currentTime](https://developer.mozilla.org/en-US/docs/Web/API/Animation/currentTime)
- [MDN — `<filter-function>`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/filter-function) ｜ [Using filter effects](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Filter_effects/Using) ｜ [Image file type and format guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types) ｜ [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) ｜ [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) ｜ [Animating textures in WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Animating_textures_in_WebGL)
- [W3C — Ruby Markup](https://www.w3.org/International/articles/ruby/markup) ｜ [W3C WAI — Understanding SC 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold)
- [PixiJS Filters](https://pixijs.com/8.x/guides/components/filters) ｜ [pixijs/filters releases](https://github.com/pixijs/filters/releases) ｜ [anime.js v4.0.0](https://newreleases.io/project/github/juliangarnier/anime/release/v4.0.0)

### 性能与实践

- [web.dev — Stick to Compositor-Only Properties and Manage Layer Count](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count) ｜ [OffscreenCanvas](https://web.dev/articles/offscreen-canvas) ｜ [Developing game audio with Web Audio API](https://web.dev/articles/webaudio-games) ｜ [Optimize web fonts](https://web.dev/learn/performance/optimize-web-fonts)
- [Chrome Developers — Re-rastering composited layers on scale change](https://developer.chrome.com/blog/re-rastering-composite) ｜ [Performant Parallaxing](https://developer.chrome.google.cn/blog/performant-parallaxing) ｜ [Web animations playback control](https://developer.chrome.com/blog/web-animation-playback)
- [Off-Main-Thread Rendering（browser-rendering.com）](https://www.browser-rendering.com/compositing-and-gpu-acceleration/off-main-thread-rendering/) ｜ [OffscreenCanvas Rendering（javascript-web-workers.com）](https://javascript-web-workers.com/high-performance-computation-patterns/offscreen-canvas-rendering/) ｜ [Asadi — Decomposing Browser Pipeline Architectures for DOM-Sourced Particle Effects（arXiv）](https://arxiv.org/pdf/2608.23609)
- [css-animation.com — When filter and backdrop-filter Are Worth the Paint Cost](https://www.css-animation.com/core-css-animation-fundamentals/hardware-accelerated-properties/when-filter-and-backdrop-filter-are-worth-the-paint/)
- [easings.net — Easing Functions Cheat Sheet](https://easings.net/) ｜ [Milk Moon Studio — GSAP Easing 视觉指南](https://easing.milkmoonstudio.com/) ｜ [oliverjam.com — Ken Burns hero image](https://oliverjam.com/articles/ken-burns-hero-image) ｜ [harbz/atmosphere-js](https://github.com/harbz/atmosphere-js)
- [Reinvent Notes — Japanese Web Fonts and Core Web Vitals](https://notes.rewheel.dev/en/blog/core-web-vitals-japanese-fonts) ｜ [Toolbox365 — CJK font subsetting](https://www.toolbox365.net/tutorials/font-subset-unicode-range-and-cjk-strategy/) ｜ [cn-font-split #132（canvas 字体不自动重绘）](https://github.com/KonghaYao/cn-font-split/issues/132)
- [VNDev Wiki — Transition](https://vndev.wiki/Transition) ｜ [Special graphics](https://vndev.wiki/Special_graphics) ｜ [VN Paths — Visual Novels Glossary](https://vnpaths.com/visual-novels-glossary/)

---

## 附：待补充调研（本次未取得直接证据）

以下条目在检索中多次出现但**未能从官方文档直接取证**，落地前需单独确认：

1. **Ren'Py 的 `Atmosphere` displayable**（疑为屏幕后处理 displayable，含 `showif`/`hideif`）—— 仅在搜索片段中出现，未在 [displayables.html](https://www.renpy.org/doc/html/displayables.html) 正文中确认。
2. **Ren'Py 的 `LightShine` / `CRT` displayable** —— 同上，仅见于第三方包描述。
3. **KAG 的 `charaoffset` / `charaoffs` / `charazoom` / `charaalpha` / `charaflip` / `charaeffect` / `charaface` 标签** —— 多次检索未命中 KAG 官方英文/日文页的对应章节；已改用 KAGEX `layopt` 扩展属性 + KAG `image`/`pimage` 标签作为等价证据。
4. **KAG `quake` 标签的完整参数表**（仅有标签名与用途，无参数清单）。
5. **Naninovel `Camera` 页**（`/guide/camera.html` 返回 404）—— 相机参数面依据的是 `@camera` 在 Scenario Scripting 页的实际用法与 API 页的通用参数。
6. **Godot / Unity 在浏览器中的 2D VN 实践** —— 仅找到 Godot 官方 Web 导出限制与一个社区模式说明帖，未找到系统的浏览器端 2D VN 演出原语文档。
