# 视觉小说引擎「舞台演出层」原语设计调研（设计参照）

> 立场：这是一份**设计参照**材料，不做产品优劣排名、不做选型推荐。目的是把主流 VN 引擎/框架在「演出」这一层**公认的原语粒度**、**属性词汇表**、**时间与缓动词汇表**、**默认与覆盖机制**、**并行与冲突处理约定**、以及**作者（人或 LLM）踩过的坑**抽出来，供 DSL v2 的语法设计对照。
>
> 调研时间：2026-10-02。方法：约 40 轮检索 + 12 次页面抓取（一手文档优先：官方 reference manual / 源码仓库 / 引擎作者注释）。
>
> **一条元观察（贯穿全文）**：几乎所有成熟 VN DSL 都把「演出指令」拆成**同一个七层结构**，只是每一层的表达形式不同：
> `状态寻址（谁）` × `属性设定（改成什么）` × `时间（多久/何时）` × `曲线（怎么变）` × `并行关系（和谁一起）` × `等待/阻塞语义（什么时候继续）` × `冲突与中断策略（被打断怎么办）`。
> 差异主要来自：**曲线是「语句前缀」还是「属性」**、**并行是「块结构」还是「隐式同帧」**、**寻址是「tag 身份」还是「层号 + 页」**。

---

## 目录

- [0. 一张总表：把「一个演出指令」拆成哪些正交维度](#0-一张总表把一个演出指令拆成哪些正交维度)
- [1. Ren'Py：Transform / ATL / show-hide 的 at / position-anchor 体系 / Transitions](#1-renpy)
- [2. KAG / KiriKiri：图层、动画与时间线调度](#2-kag--kirikiri)
- [3. TyranoScript / TyranoBuilder：标签集](#3-tyranoscript--tyranobuilder)
- [4. Naninovel（Unity 系）：命令参数模型与 async 轨道](#4-naninovelunity-系)
- [5. Ink：叙事层的极简与「外部钩子」策略](#5-ink)
- [6. Web 侧：2D 舞台库与浏览器 VN 框架](#6-web-侧)
- [7. 横切议题：并行、默认与覆盖、缓动词汇表、寻址、触发时机](#7-横切议题)
- [8. 表达力 vs「一次写对」：取舍与教训](#8-表达力-vs一次写对取舍与教训)
- [9. 来源索引](#9-来源索引)
- [10. 本次未覆盖 / 需进一步验证的空白](#10-本次未覆盖--需进一步验证的空白)

---

## 0. 一张总表：把「一个演出指令」拆成哪些正交维度

下表是逐引擎读文档后归纳出的**维度清单**（不是推荐方案，是「这个领域已经用过的槽位」）。空白表示该引擎在文档层面没有对应原语。

| 维度 | 槽位含义 | Ren'Py | KAG/KiriKiri | TyranoScript | Naninovel | Pixi'VN | Web 动画库（GSAP/anime.js） |
|---|---|---|---|---|---|---|---|
| **状态寻址（谁）** | 演出作用于哪个对象 | image **tag**（+ `as` 别名 / `onlayer` / `behind` / `zorder`） | `layer`（`base`/N/`message0`/`message1`）+ `page`（`fore`/`back`）**二维寻址** | `name`（`[image]`/`[ptext]`/`[button]` 的 name）或 `layer` | actor **Id**（`Sora`），`alias` 概念对应物 | **alias**（Pixi'VN）/ 组件路径 | 元素选择器 / 变量引用 / 函数式 value |
| **出现/消失** | 显隐指令 | `show` / `hide` / `scene` / `showif` / `show expression` | `image`(+`visible`) / `layopt visible` / `freeimage` | `[chara_show]` / `[chara_hide]` / `[chara_hide_all]` / `[layopt visible]` / `[freeimage]` | `@show` / `@hide` / `@hideAll` | `# show` / `# remove` / `# edit` | —（由显隐另行处理） |
| **属性设定** | 改哪些属性 | `xpos/ypos/xanchor/yanchor/xalign/yalign/xycenter/zoom/xzoom/yzoom/rotate/alpha/additive/matrixcolor/blur/crop/corner1-2/xpan/ypan/xtile/ytile/subpixel/around/angle/radius/…` | `left/top/width/height/opacity/index/visible`（`layopt`）+ `image` 上的 `mode`(合成模式)/`grayscale`/`r,g,b gamma`/`rfloor,rceil`/`mcolor,mopacity`/`lightcolor,lighttype`/`shadow*`/`clip*`/`flipud,fliplr` | `left/top/width/height/opacity/color`；keyframe 里再加 `x/y/z/rotate/scale/skew/perspective/rotateX|Y|Z/scaleX|Y|Z` | `pos`/`look`/`tint`/`visible`/`rotation`/`zoom`/`move`(XYZW)/`sort`/`actor`… | `xAlign/yAlign/anchor/scale/alpha/visible/style/cursor` + 任意 CSS 风格属性 | 任意属性（`x/y/scale/rotation/skew/alpha/colorAmount/hue/saturation/brightness/contrast`） |
| **时间（多久）** | 时长与延迟 | 插值语句的 duration（秒，float）；`pause` 裸等待；`time` 语句（绝对秒）；ATL transition 的 `delay` 属性；`fps` 属性（离散时间） | `time`（**毫秒**）、`delay`；`wait`/`wc`；`quake` 的 `time`+`timemode` | `time`（**毫秒**，各标签有各自默认值）、`delay`（kanim） | `time`（**秒**，decimal） | `duration` / `delay`（Motion 库单位） | `duration` / `delay`（秒；anime.js 另有 spring 无 duration） |
| **曲线（怎么变）** | 缓动 | **warper**：语句前缀 `linear/ease/easein/easeout/pause` + Penner 家族 `ease_*_quad|cubic|quart|quint|circ|expo|elastic|back|bounce/sine` | `accel`（`<-1` 减速 / `0` 匀速 / `>1` 加速）+ `spline` 样条开关（**无曲线名**） | `effect=`（**31 个关键字**：`jswing/def/linear` + `easeIn|Out|InOut × Quad,Cubic,Quart,Quint,Sine,Expo,Circ,Elastic,Back,Bounce`）；`[kanim]` 另有 `easing=ease|linear|ease-in|ease-out|ease-in-out|cubic-bezier(...)` | `easing:`（`Linear / SmoothStep / Spring / EaseIn…InOut × 10 种`） | `ease:` + `type:`（含 `spring`）+ `circInOut/anticipate/…` | `ease:` / `easing:`（easings.net 全家族）+ `spring(mass,stiffness,damping,velocity)` |
| **并行关系** | 谁和谁一起跑 | **`parallel:` 块**（多个块同时跑，最后一个结束才整体结束；**同块内不得共写同一底层数据**）；`block:` + `repeat`；`time` 可打断当前语句 | 多层 `move` **异步并行**（各自 `wm`）；`animstart` 的 **segment 段号** 让一张图跑多路动画；`trans children=true` 一次带动子层 | `[anim]` 默认异步，`[wa]` 全局等；`[kanim]` 的 `count`/`direction`/`delay` | **默认所有 async 命令并行**，靠 `wait`/`@await` 汇合；`@async` 开独立轨道，`@sync` 合流 | `canvas.animate` 返回 **tickerId**，`tickerIdToResume`/`transferTickers` 做链式接力 | `timeline()` + `position` 参数（`+= -= *= < << 'label' stagger(10)`）；`parallel()` / `set_parallel()` / `subtween` |
| **触发时机** | 什么时候开始 | 事件驱动：`show`/`hide`/`replace`/`replaced`/`appear`/`start`/`hover`/`idle`/…；`on <event>:` 处理器；`st` vs `at` 时间基；`showif` 自动投递 | 标签顺序执行即时机；`[waittrig]` 等事件（`name` + `canskip`）；`resetwait` + `wait mode=until`（绝对时钟） | 标签顺序；`cond=` 全局条件属性 | 脚本顺序；`if`/`unless` 参数 + `@if/@else` 块 | 脚本顺序；`autoplay:false` + `tickerIdToResume` 手动接棒 | timeline position；`call(fn, pos)`；`label(pos)`；`stagger` |
| **等待/阻塞** | 什么时候继续往下 | 语句本身会**产生一个 interaction**（可点击提前结束）；`pause` 裸等；动画随 show 语句完成 | 每个动/转都有配对的 **w 类标签**：`wait/wm/wt/wa/wq/wb/wf/wl/ws/wv`，多数带 `canskip` | `wait=true` 是**各标签默认**（阻塞式）；`[wa]` 等所有动画；`[wait_cancel]` | `wait` 参数（默认行为由全局 `Wait By Default` 决定）；`@await`；`@stop`；`complete!` 强制立刻完成 | `completeOnContinue`（Continue 键立刻完成阻塞动画，moveIn 默认 true） | Promise/await |
| **冲突/中断策略** | 被打断怎么办 | `show_cancels_hide`（默认 true：同名 tag 再次 show 会取消正在 hide 的动画）；并行块冲突**行为不可预测**（文档明确要求避免）；transform 替换时继承旧 transform 的**当前中间值** | `[clickskip]` 全局开关关掉点击打断；`stopmove/stoptrans/stopanim` 强制停止（**直接落到终态**）；`temp save/load` 做整场回滚 | `wa` 是「当前动画计数归零」的等待 → **计数泄漏会死锁**（社区实测）；`[stopanim]`/`[stop_kanim]`/`[3d_anim_stop finish=true]` | **`lazy`**（默认 false：旧动画立即跑完再动；`lazy:true` 则从当前状态续接新目标）——把「重叠打断」做成了显式参数 | `tickerIdToResume`、`aliasToRemoveAfter`、`completeOnContinue` | `overwrite` 策略、`kill()` |
| **全局默认** | 不写时的取值 | `config.default_transform` / `config.tag_transform` / `config.tag_zorder` / `config.layer_transforms` / `config.layers` / `_scene_show_hide_transition` / 各 property 的文档默认值 | `Config.tjs`（`numMovies`、`doubleBuffered`、`defaultQuakeTimeInChUnit`、`goToStartMenuItem.visible`…） | `[chara_config]`（`pos_mode`/`anim`/`effect`/`talk_anim`/表情 crossfade ms）+ 每标签文档默认值 | Actor Manager 配置：`Default Duration 0.35s`、`Default Easing Linear`、`Auto Show On Modify false` | 属性全可选，未写=保持现值 | `engine.defaults`（anime.js 可改全局 `ease`） |
| **可否被存档/回滚** | 演出状态是否进 save | **Transform / Transition 是可保存对象**；存档点在「与用户交互的语句开始处」；`Displayable/Transform/Transition` 可 pickle | 栞（bookmark）保存**层信息 + 段号 + 起始 label**，但**动画总是从头重放**（clip 方式与默认段都建议写成 loop）；`tempsave/tempload` 做场景级快照 | —（引擎内部状态） | actor 状态序列化进 save；rollback 支持 | 状态快照/历史（`@tsuzuru/core` 提供 snapshots/restore） | 由宿主引擎决定 |

---

## 1. Ren'Py

> 一手来源：[Transforms（ATL）](https://www.renpy.org/doc/html/transforms.html)、[Transform Properties](https://www.renpy.org/doc/html/transform_properties.html)、[Displaying Images](https://www.renpy.org/doc/html/displaying_images.html)、[Transitions](https://www.renpy.org/doc/html/transitions.html)、[Configuration Variables](https://www.renpy.org/doc/html/config.html)、[Screens and Screen Language](https://www.renpy.org/doc/html/screens.html)、[Saving, Loading, and Rollback](https://www.renpy.org/doc/html/save_load_rollback.html)、[ATL 教程脚本](https://github.com/renpy/renpy/blob/master/tutorial/game/tutorial_atl.rpy)、[warper 源码 000atl.rpy](https://github.com/renpy/renpy/blob/master/renpy/common/000atl.rpy)

### 1.1 舞台基元：只有四条指令 + 一个 `with`

`image`（定义可复用图像）/ `show`（放到某层）/ `scene`（清空某层并可选地 show）/ `hide`（按 tag 移除）。转场由 `with` 单独承担，也可以写成 `show ... with dissolve` 的从句。

**关键设计点：`image tag` 就是状态身份。**
「An image name consists of one or more components, separated by spaces. The first component of the image name is called the **image tag**. The second and later components of the image attributes.」——即 `show eileen happy at right` 里，`eileen` 是身份，`happy` 是变体（换表情 = 换属性 = 同身份替换）。这直接决定了后面所有「show / replace / hide」事件语义的形状。

`show` 支持的属性（全部正交、可任意顺序、每个只出现一次）：
- `as` —— 换身份（同一个 image 同时上屏两次）
- `at` —— 一个或多个逗号分隔的表达式，**从左到右应用**
- `behind` —— 放在若干 tag 之后（相对排序）
- `onlayer` —— 指定层
- `zorder` —— 层内绝对排序（文档坦承「Ren'Py 游戏通常不用，主要为移植别的引擎的 VN 而保留」）
- `with` —— 转场

层内默认顺序规则：「If an image with the same image tag is already showing on the layer, the new image replaces it. Otherwise, the image is placed above all other images in the layer.」（即**同 tag 替换不动 z 序，新 tag 追加到最前**）。

### 1.2 定位体系：`pos` + `anchor` 两元组，之上叠一组「便利别名」

Transform Properties 里的定位原语（原文照录关键定义与默认值）：

| 属性 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `pos` | (position, position) | (0,0) | 相对容器左上角的位置 |
| `xpos` / `ypos` | position | 0 | 分轴 |
| `anchor` | (position, position) | (0,0) | **物体自身**上的锚点 |
| `xanchor` / `yanchor` | position | 0 | 分轴 |
| `align` | (float,float) | (0,0) | ≡ 同时设 `pos` 与 `anchor` 为同值 |
| `xalign` / `yalign` | float | 0.0 | ≡ `xpos`+`xanchor` / `ypos`+`yanchor` 同值 |
| `xycenter` / `xcenter` / `ycenter` | position | 0 | ≡ `pos=v, anchor=0.5` |
| `offset` / `xoffset` / `yoffset` | absolute | 0 | 像素平移（向右/下为正） |
| `around` / `angle` / `radius` | 极坐标 | — | `around` 为极点，`angle` 0°朝上、90°朝右（会被 clamp 到 [0,360)），`radius` 为浮点时按 min(宽,高) 缩放 |
| `anchoraround`/`anchorangle`/`anchorradius` | 锚点的极坐标 | — | 同上但作用于 anchor；文档提示非 absolute 值会产生椭圆轨迹，**建议只传 int 或 `absolute()`** |
| `subpixel` | boolean | False | 子像素定位（影响颜色/半透明边缘，不影响像素选择） |

**量纲体系（设计上非常值得抄的一点）**：文档明确定义
> When the type is given as a position, its **relative** component is interpreted as a fraction of the size of the containing area (for `pos`) or of the displayable (for `anchor`).

即「**裸数字 = 相对比例，`absolute(x)` = 绝对像素**」的单一量纲约定。这让「立绘移动 100px」和「立绘移到画面 40% 处」可以共存于同一个属性而不需要额外标记。

内置 transform（定位预设）构成一个命名锚点集：`center` / `default` / `left` / `right` / `offscreenleft` / `offscreenright` / `reset` / `top` / `topleft` / `topright` / `truecenter`。其中 `default` 可通过 `config.default_transform` 重定义，`reset` 把每个属性打回默认值。

**属性应用顺序**（文档显式列出 20 步，末尾提示旧属性不应在新项目使用）：
`fps → mesh/blur → tile → pan → crop/corner1/corner2 → xysize/size/maxsize → zoom/xzoom/yzoom → point_to → orientation → xrotate/yrotate/zrotate → rotate → zpos → matrixtransform/matrixanchor → zzoom → perspective → nearest/blend/alpha/additive/shader → matrixcolor → GL Properties/Uniforms → position properties → show_cancels_hide`

### 1.3 ATL：把「演出」做成一门可组合的小语言

ATL 语句全集（按文档章节）：

| 语句 | 作用 |
|---|---|
| **displayable**（`old_widget` / `new_widget` / `name child`） | 换被变换的显示对象 |
| **properties** | 设一组属性的值（可多属性同行：`xalign 0.5 yalign 0.5`） |
| **pause [t]** | 裸等待 |
| **interpolation**：`warper_name <dur> prop value …`（或块形式 `warper:` / `warp <func>`） | 插值；**一条语句内多个属性同步进行** |
| **transform expression**：`<transform_name>` | 插值到一个命名 transform 的属性集 |
| `… knot …` | **样条轨迹**（1 个 knot → 二次贝塞尔；2 个 → 三次贝塞尔；≥3 个 → Catmull-Rom，首尾 knot 为控制点） |
| `… clockwise / counterclockwise / circles <n>` | **圆弧/螺旋运动**（自动由起终点算极点与角度差） |
| **pass** | no-op（用于分隔两个相邻 choice 集合等语法需要处） |
| **repeat [n]** | 回到块首（`repeat 2` = 总共执行两次） |
| **block** | 子块（配合 repeat 局部循环） |
| **parallel** | 多块并行；**最后一个块结束时整体结束** |
| **choice** | 随机取一块（`choice:` 后跟若干候选块） |
| **animation**（必须位于块首） | 把时间基从 `st` 切到 `at` |
| **on <event[,event]>:** | 事件处理器；`on` 块**永不自然结束** |
| **event <name>** | 主动产生事件 |
| **time <t>** | 从块开始起 t 秒后执行，**会打断当前语句** |
| `default` 事件 | `on` 处理器未被任何事件打断时自动产生 |

教程脚本里的官方范例（可直接当作文档级的「正确写法」样本）：

```renpy
show logo base:
    xalign 0.0
    parallel:
        linear 1.3 xalign 1.0
        linear 1.3 xalign 0.0
        repeat
    parallel:
        yalign 0.0
        linear 1.6 yalign 1.0
        linear 1.6 yalign 0.0
        repeat
```
> `parallel` statement lets us run two blocks of ATL code at the same time. Here, the top block moves the image horizontally and the bottom block vertically. Since they're moving at different speeds, it looks like the image is bouncing on the screen.

「合成性」是官方明确写出来的设计意图：
> The key to ATL is what we call **composability**. ATL is made up of relatively simple commands, which can be combined together to create complicated transforms.

以及 `image` 语句的一个语义差别（教程里特意强调）：
> When ATL is used as part of a `show` statement, values of properties exist even when the transform is changed. So even though your click stopped the motion, the image remains in the same place.

即「属性值」与「动画进程」是分离的：动画被点击打断，但当时的属性值保留下来。

### 1.4 缓动（warper）词汇表 —— 命名反直觉是重点

ATL 的缓动是**语句前缀**（`linear 1.0 xalign 1.0`），也可以 `warp <warper_function>` 用任意函数。定义域：`t ∈ [0,1] → t'`，`t'` 应从 0 到 1（但允许超出）。

内置：
- `pause` —— `t' = 1.0`（立即到终值），若语句 duration 为 0 则 `t' = 0.0`
- `linear` —— `t' = t`
- `ease` —— `t' = .5 - cos(π·t)/2`（两端慢）
- `easein` —— **先快后慢**（`cos((1-t)·π/2)`）
- `easeout` —— **先慢后快**（`1 - cos(t·π/2)`）

Penner 家族（来源 easings.net，注释里写明 "-in / -out surfix are inverted to much default warpers in ATL"，即**为了跟上面三个主命名对齐，Penner 的 in/out 被反过来了**）：

| Ren'Py 名 | easings.net 名 | Ren'Py 名 | easings.net 名 |
|---|---|---|---|
| `ease_back` | easeInOut_back | `easein_back` | easeOut_back |
| `ease_bounce` | easeInOut_bounce | `easein_bounce` | easeOut_bounce |
| `ease_circ` | easeInOut_circ | `easein_circ` | easeOut_circ |
| `ease_cubic` | easeInOut_cubic | `easein_cubic` | easeOut_cubic |
| `ease_elastic` | easeInOut_elastic | `easein_elastic` | easeOut_elastic |
| `ease_expo` | easeInOut_expo | `easein_expo` | easeOut_expo |
| `ease_quad` | easeInOut_quad | `easein_quad` | easeOut_quad |
| `ease_quart` | easeInOut_quart | `easein_quart` | easeOut_quart |
| `ease_quint` | easeInOut_quint | `easein_quint` | easeOut_quint |
| `easeout_*` | easeIn_* | `easeout_*` | easeIn_* |

可通过 `_warper` 只读模块取用，也可 `renpy.atl_warper` 装饰器自定义（须在解析到使用点之前的文件里定义）。

> **教训信号**：这个「为了对齐主词汇而把 Penner 的 in/out 反过来」的注释与对应表，说明**缓动命名一致性是这个领域反复出错的点**——族内命名规则必须在设计时一次性钉死，否则文档与实现会互相误导。

### 1.5 触发时机模型：事件 + 双时间基

**外部事件**（ATL transform 内自动触发）：
`start`（进入 `on` 时的伪事件，若无更高优先级事件发生）、`show`（`show`/`scene` 时该 tag 原本不存在）、`replace`（`show` 替换同 tag）、`hide`（`hide`）、`replaced`（被别人替换；**图像不会真正 hide 直到 ATL 块结束**）、`appear`（`showif` 首次显示时的瞬时出现）、`hover`/`idle`/`selected_hover`/`selected_idle`/`insensitive`/`selected_insensitive`（按钮状态）。

语义要点（官方论坛答复里的精确描述）：
> Line 2 will trigger `show` event of `eileen happy` image — it wasn't there before, now it appears.
> Line 3 will trigger `replaced` event of `eileen happy` image — because it is replaced by another `eileen` image. **It will not trigger its hide event!**
> Then `replace` event of `eileen vhappy` image will be triggered — it's replacing another image with the same tag. **It will not trigger its show event!**

即 **show/replace、hide/replaced 是互斥配对**，不是四件独立的事。

**双时间基**（文档标题写明「commonly confused」）：
- `st`（shown timebase）：displayable **首次**上屏时开始。
- `at`（animation timebase）：**同 tag** 的 image 上屏时开始（无论之前是否被 hide 过），用于「换表情时保持相位」。
默认 `st`，用 `animation` 语句切到 `at`。无 tag 的 displayable 上两者相同。

**`showif` 自动事件投递**：
```renpy
showif <cond>:
    transform cd_transform:
        xalign 0.5 yalign 0.5 alpha 0.0
        on appear:
            alpha 1.0
        on show:
            zoom .75
            linear .25 zoom 1.0 alpha 1.0
        on hide:
            linear .25 zoom 1.25 alpha 0.0
```
> `showif` delivers three events to its children: `appear` / `show` / `hide`.

### 1.6 Transitions：命名 → 家族 → 可参数化的转场矩阵

**预定义名**（全部 0.5s 或 1s 起步）：`dissolve`、`fade`(0.5 出黑 + 0.5 入)、`pixellate`、`move`、`movein{right,left,top,bottom}`、`moveout{…}`、`ease`/`easein{…}`/`easeout{…}`（余弦曲线版 move）、`zoomin`/`zoomout`/`zoominout`、`vpunch`/`hpunch`（屏幕震动各 0.25s；文档明确说「自定义它们最好用 ATL transition」）、`blinds`(1s)、`squares`(1s)、`wipe{…}`、`slide{…}`、`slideaway{…}`、`push{…}`、`irisin`/`irisout`。

**转场类（transition classes）**——文档特别声明「通常是函数而不是类，不要按 Python 的类去理解」：

| 类 | 参数要点 |
|---|---|
| `Dissolve(time, *, time_warp, mipmap)` | |
| `AlphaDissolve(control, delay=0.0, *, reverse, mipmap)` | 用一个「control displayable（几乎总是某个动画 transform）」的 alpha 通道决定谁可见 |
| `Fade(out_time, hold_time, in_time, *, color='#000')` | 三段：淡出→保持→淡入 |
| `ImageDissolve(image, time, ramplen=8, *, reverse, time_warp, mipmap)` | 按规则图逐像素溶解（Ren'Py 的 `blinds` 就是它的实例） |
| `Pixellate(time, …)` | |
| `CropMove(time, mode='slideright', startcrop, startpos, endcrop, endpos, topnew)` | 「一切涉及改变矩形切片的转场」都靠它 |
| `MoveTransition(delay, *, enter, leave, old, layers=['master'], time_warp, enter_time_warp, leave_time_warp)` | 位移补间；**文档明确限制：move 类只能用在 `with` 语句上、单层或全层，不能用在 ATL / `ComposeTransition()` 等其它场合** |
| `PushMove(time, mode='pushright')` | 新画面把旧画面推走 |
| `ComposeTransition(trans, before, after)` | 三转场组合 |
| `define.move_transitions(prefix, delay, time_warp=None, in_time_warp=None, out_time_warp=None, old=False, layers=['master'], **kwargs)` | 批量生成带方向的 move/ease 家族 |

`CropMove` 的 mode 分三组：wipes / slides / other，另可 `"custom"` 自定义。

**三种扩展路径**（原语粒度不同的体现）：
1. **ATL transition**：`transform spin(duration=1.0, *, new_widget=None, old_widget=None)`，必须自己设 `delay duration`，用 `old_widget` / `new_widget` 两个特殊语句挂到旧/新画面，用 `events False/True` 控制是否吞掉旧控件的事件。
2. **Python transition**：可调用对象，签名 `(old_widget=None, new_widget=None)`，返回的 displayable 必须带 `delay` 属性。
3. **Dict transition**：整套预定义转场的字典映射（供编辑器/工具按名字生成）。

**自动转场**：`_scene_show_hide_transition` 非 None 时，一串没有被 `with` 打断、也不处于菜单上下文的 `scene/show/hide` 之后会自动补一次转场（文档给了逐句注释的示例，说明触发点是「下一条与用户交互的语句之前」）。

### 1.7 全局默认 + 局部覆盖

| 机制 | 位置 | 作用 |
|---|---|---|
| `config.default_transform` | [config](https://www.renpy.org/doc/html/config.html) / [config.py](https://github.com/renpy/renpy/blob/master/renpy/config.py) | `show`/`scene` 时未指定 transform 时的初始化 transform |
| `config.tag_transform = {}` | 同上 | **按 tag 的默认 transform** |
| `config.tag_zorder = {}` | 同上 | 按 tag 的默认 zorder |
| `config.layer_transforms = {}` | 同上 | **整层套用的 transform**（在 layer/camera transform 之后应用） |
| `config.layers = ['master','transient','screens','overlay',…]` | 同上 | 层顺序 |
| `camera <transform>` | Displaying Images | 对整层套 transform（整层摇动/推镜的正规做法） |
| `_scene_show_hide_transition` | config | 自动转场 |
| 属性级默认值 | Transform Properties 文档每项都写 Default | 例如 `alpha=1.0`、`zoom=1.0`、`zpos=0`、`rotate=None` |
| `reset` / `Transform(reset=True)` | — | 显式打回默认 |
| `_rollback` / `_greedy_rollback` / `_scene_show_hide_transition` | [save/rollback](https://www.renpy.org/doc/html/save_load_rollback.html) | 回滚行为的全局开关 |

**继承规则（被替换的 transform）**——这是 ATL 最微妙的一段：
- ATL transform / 内置 transform / `Transform` 类三者**互相替换时**，旧 transform 的属性值被新 transform 继承；其他种类的 transform 不适用。
- `at` 列表按**从右往左**匹配：`show eileen happy at a, b, c` 之后 `show eileen happy at d, e` → `c`→`e`、`b`→`d`，`a` 不被替换。
- **替换瞬间复制的是旧动画的当前中间值**，因此「弹跳→改成匀速移动」会从玩家点击那一刻的位置继续。
- **位置属性特判**：`xpos/ypos/xanchor/yanchor` 以及设置它们的属性（`xalign`/`radius`/`angle`）遵循「子覆盖父」——文档理由是「a displayable may have only one position, and a position that is actively set takes precedence」。
- 想彻底重置：**hide 后再 show**；想打断动画但保留位置：`show eileen happy: pass`（空 ATL 块）。
- `Transform.unique()`：把 transform 标记为唯一，避免「加入 displayable 时被复制导致状态丢失」。

### 1.8 「同一对象多属性并行」的规则与其代价

文档两句关键原文：
> Each parallel block should be independent and modify **different Transform Properties**. For example, one block might control horizontal movement (`xalign`) while another controls vertical movement (`yalign`). **If two blocks try to change the same property at the same time, the behavior is unpredictable and should be avoided.**

Transform Properties 页进一步说明底层数据是共享的：
> Note that not all properties are independent. For example, `xalign` and `xpos` both update some of the same underlying data. In a `parallel` statement, **not more than one block should adjust properties sharing the same data**. The `angle` and `radius` properties set both horizontal and vertical positions.

**结论（跨引擎反复出现的一条共识）**：并行块的正确性不来自引擎检查，而来自**作者的自觉**——引擎只在文档里声明「未定义」，不做静态检查。同时「一条插值语句内多属性同步」是安全且推荐的（`linear 2.0 xalign 0.5 yalign 0.5`），所以**「多属性同步」的正确粒度是「一条插值语句」，而不是「多条并行语句」**。

### 1.9 演出状态与存档/回滚的耦合

- 「Displayable, Transform, and Transition」在保存对象的可序列化列表里。
- 存档发生在**与用户交互的语句开始处**；若在一条语句中途读档/回滚，得到的是该语句开始时的状态。
- 回滚会影响 init 阶段之后修改的变量与从这些变量可达的 revertable 对象；Python 里创建的数据通常不可回滚。
- `renpy.checkpoint()` / `block_rollback()` / `fix_rollback()` 提供手动控制；`renpy.suspend_rollback(flag)` 可整段禁止回滚。

> 这条对「演出指令」的设计意味着：**演出指令必须是可序列化的纯状态变换，而不是隐式调用栈里的副作用**，否则回滚/多周目/存档一致性都要另写一套。

---

## 2. KAG / KiriKiri

> 一手来源：[KAG System Reference — Tags reference](https://kirikirikag.sourceforge.net/contents/Tags.html)、[Transition について](https://krkrz.github.io/docs/kirikiriz/j/contents/Transition.html)、[AnimationLayer.tjs（作者注释即规格书）](https://github.com/krkrz/kag3/blob/master/data/system/AnimationLayer.tjs)、[novelsphere.js asd 文档](https://developer.novelsphere.jp/doc/o2doc2/content/spec_anim.html)、[KAG3 移植说明](https://krkrz.github.io/krkr2doc/kag3doc/contents/PortFromOldKAG.html)

KAG 是与 Ren'Py **路线正交**的一个样本：它把舞台建成**位图图层 + 双页**，演出指令是「往哪一页贴什么 + 怎么把里页翻到表页」。

### 2.1 寻址：`layer` × `page` 二维坐标

层种类：
- `base` —— 背景层（单独一类，`trans` 的常用对象）
- `0, 1, 2, …` —— 前景层（KAG 默认 3 个，`laycount` 可改）
- `message0` / `message1` —— 消息层（`[current]` 指定当前操作目标）

每一层还有**双页**：`fore`（表页，默认）与 `back`（里页）。绝大多数图层类标签都带 `page=` 选表/里。
层叠顺序由 `index` 属性显式给：`前景层 0 = 1000、前景层 1 = 2000（此后 +1000）、消息层 0 = 1000000、消息层 1 = 1001000、历史层 2000000`。背景层的 index 不可改。

消息层还有一条独立的 `position` 标签路径（带 radius / color / opacity / border / frame），与 `layopt` 的 opacity **语义不同**（文档明确警告）。

### 2.2 句法约定（对 DSL 设计有直接参考价值）

```
[trans time=0 rule=trans vague=1]
@trans time=0 rule=trans vague=1        # 两种写法等价
```
- 属性值加引号与否等价，含空格必须加引号。
- **属性值以 `&` 开头即按 TJS 表达式求值**：`[trans time=&f.clearTime]`。
- **省略 `=value` 等价于 `=true`**：`[playse loop storage="shock.wav"]` ≡ `[playse loop=true storage="shock.wav"]`。
- **几乎所有标签都有 `cond` 属性**（例外：`macro/endmacro/if/else/elsif/endif/ignore/endignore/iscript/endscript`），`cond` 是 TJS 表达式。
- `[emb exp=...]` 把表达式结果内嵌进正文。

### 2.3 `move`：路径 + 加速度 + 样条

```
[move time=4000 path="(0,240,255) (0,0,255) (0,-240,255) (0,-480,0)" layer=0]
```
- `path` 是**三元组序列** `(x, y, opacity)`；x/y 是图层左上角像素位置，opacity 是 0–255。
- **opacity 也被当作轨迹的一个分量**，且在点之间连续插值；若要「跳变式淡入淡出」，约定是**给 opacity 加 256**（文档原文：想让浓度突变时用 +256 的值）。这是一个用数值编码「插值/跳变」模式的朴素技巧。
- `spline=true` 时用 B 样条曲线插值路径点（至少 2 点）；默认直线插值。
- `time` 是**每两个相邻路径点之间**的时间，总时长 = 区间数 × time。
- `accel`：`< -1` 先快后慢、`0` 匀速、`> 1` 先慢后快；非零时单点耗时变化但总时长不变。
- `delay` 是开始前的延迟。
- 多层可以**异步并行**执行 `move`；本标签不等待，用 `[wm]` 等待。
- 移动期间**消息层的文字绘制会失败或变慢**（文档明说）。
- 鼠标点击会打断移动；用 `[clickskip enabled=false]` 禁止。

### 2.4 `trans`：固定三段节奏

文档给出的「标准用法」固定节奏是：
```
[backlay]                      ; 表页信息 → 复制到里页
[image storage=fg0 layer=0 page=back]
[trans method=universal time=1500 rule=trans0 vague=64]
[wt]                           ; 等转场结束
```
即：**backlay（快照当前）→ 改里页（准备新画面）→ trans（里页翻到表页）→ wt（等）**。`trans` 后表页等于里页。

转场方法（`method=`）：
- `crossfade`（默认给 `universal`）—— 交叉淡化，只吃 `time`
- `universal` —— 按**规则图**（256 级灰度）逐像素切换，规则图小于画面则平铺、大于则只用左上角；吃 `rule` + `vague`（模糊区，缺省 64）+ `time`
- `scroll` —— 吃 `from`（left/top/right/bottom，来向）+ `stay`（`stayfore` / `stayback` / `nostay`）
- 插件 `extrans` 追加：`wave`（maxomega, maxh）、`mosaic`、`turn`、`rotatezoom`、`rotatevanish`、`rotateswap`、`ripple`

TJS 侧对应 `Layer.beginTransition(name, options)`，options 是一个字典数组：`%[vague:100, time:2000, rule:"rule1.png"]`。

**限制与警告（原文）**：
> トランジション中は、文字表示ができなかったり、遅くなったりします。また、基本的に状態は「不定」なので、位置移動や表示・非表示の変更はトランジションの終了を待ってからにしてください。

> 本当に特殊な用途（一概に言えませんが）を用いる以外は、layer には base を指定してください。（需要对表页/里页同尺寸）

### 2.5 `quake`：独立的「屏幕摇动」原语

```
[quake time=800 timemode=ms hmax=10 vmax=10]   … [wq]
```
- `time` 是**毫秒**（或配合 `timemode="delay"` 用「文字速度 × time」为单位）
- `hmax` / `vmax` 是横/纵最大振幅，**省略各为 10**；`vmax=0` 即纯横摇、`hmax=0` 即纯纵摇
- 不等待，用 `[wq]` 等；`[stopquake]` 强制停（不必等 time 次数）

> 这是「屏幕摇动」被提升为一等公民的样本——不是 `transform` 的一种，而是独立标签。

### 2.6 动画：`.asd` 文件 + **segment（段号）+ label**

KAG3 把动画定义放到与图片同名的 `.asd` 文件（KAG2 时代是 `.asq`，发行包里有 `asq2asd` 转换脚本）。`[image storage=hoge ...]` 时若存在 `hoge.asd` 就自动加载动画信息。

**两种动画方式**：
- **clip 方式**：`@wait time=80` + `@clip left=N top=0` 交替，靠图集逐帧切；启动时必须在 `[image]` 上给 `clipleft/cliptop/clipwidth/clipheight`
- **cell 方式**：`@loadcell` 载入单元格图集 + `@copy dx dy sx sy sw sh`，不需要 clip 属性

**asd 可用标签**：`loadcell` / `copy` / `clip` / `wait time` / `loop` / `s` / `home` / label / `@jump`

**segment（段号）机制**——「同一张图同时跑多路动画」的原语：
- `seg` 是 ≥1 的整数（**0 号段是特殊段**：`[image]` 上屏即自动播放，`animstart`/`animstop` 不能指定 0）
- `[animstart layer=0 page=fore seg=3 target=*label]` 从 asd 里指定标签开始跑第 3 段
- `[animstop ... seg=3]` 停某段（**但不会等到停；实际要跑到 asd 里的 `home` 标签才真停**）
- `[wa layer=0 seg=0]` 等某段停（0 段也可等）

**存档语义（作者自己写在 AnimationLayer.tjs 注释里的坑）**：
- 栞（存档）只保存「哪个段、从哪个起始标签」，**读档时动画从 asd 开头重放**；
- `loop` 标签**只是声明「这段会循环」给存读档用，不会自动循环**——必须自己写回跳；不写 loop 的段在读档时**不会**重启动画；
- 若不 loop 且 `loop=false`，动画会一路跑下去，除非经过 `s` 标签停下，且停时必须回到与 base 图相同的状态；
- 因此默认段强烈建议写成 loop 结构或干脆不动画（clip 方式与默认段都如此）。

> 这是「演出状态可存档」的最早也最粗糙的实现方式：**只存「从哪来」，不存「到哪去」，靠重放**。文档层面已经把这看成约束而不是特性。

### 2.7 等待与可跳过矩阵

KAG 有一套非常完整的「等」标签族，几乎每个异步动作都有一个配对的 w：

| 标签 | 等什么 | 可 `canskip` |
|---|---|---|
| `[wait time=… mode=normal\|until]` | 时间 / 绝对时钟（配合 `resetwait`） | 默认 true |
| `[wc time=n]` | n 个字的时间 | — |
| `[wm]` | 自动移动（`move`）结束 | 默认 true |
| `[wt]` | 转场结束 | 默认 true |
| `[wa]` | 动画停止（按层与段） | — |
| `[wq]` | 屏幕摇动结束 | 可 skip |
| `[wb]` / `[wf]` / `[wl]` / `[ws]` / `[wv]` / `[wp]` | BGM 淡变 / SE 淡变 / BGM 结束 / SE 结束 / 视频结束 / 视频周期事件 | 可 skip |

**「可跳过」是横切全局开关**：`[clickskip enabled=…]` 控制「消息显示途中点击 = 打断转场/自动移动 + 一路显示到点击等待处」。文档建议 demo 场景关掉。所有 w 类标签的 `canskip` 还互相牵制：若 `clickskip` 被禁，则这些 skip 也失效。

**强制停止 = 直接落到终态**：`[stopmove]`（所有层的自动移动全停，图直接到最终位置与最终浓度）、`[stoptrans]`（转场全停，图完全切换）、`[stopquake]`。

### 2.8 其它原语

- `[bgmopt volume= gvolume=]`：**普通音量 × 全域音量**两个旋钮；全域音量记在系统变量里（跨存档继承），普通音量不继承。SE 同理（`[seopt]` 还有 `pan`）。
- `[xchgbgm storage= time= overlap= volume=]`：交叉淡化换曲（需 `Config.tjs` 的 `doubleBuffered=true`）。
- `[setbgmlabel name= storage= target= exp=]` / `[setbgmstop]`：**用 BGM 自身的循环标记点作为剧情钩子**（曲子里循环到一个 cue 就跳剧情）。
- `[waittrig name= canskip= onskip=]`：**等一个由 TJS 触发的信号**，`name="click"` 就是内置的鼠标点击；作者称之为「事件驱动编程模型下让剧本暂停等某件事的机制」。
- `[temp save]` / `[temp load se= bgm= backlay=]`：**内存级场景快照**（不入磁盘、不改变量、消息层不擦除），典型用途是「进 demo 场景前存一下，出来时一把恢复」，比逐条恢复设置省事。
- `[image]` 上还有一整套**色调处理**：`grayscale`、`r/g/b gamma`、`r/g/b floor`、`r/g/b ceil`、`mcolor/mopacity`（色混合）、`lightcolor/lighttype`（光混合）、`shadow/shadowopacity/shadowx/shadowy/shadowblur`，以及 20 多种 `mode` 合成模式（alpha/transp、opaque/rect、add、sub、mul、dodge、darken、lighten、screen、ps* 全家、diff、excl）。

---

## 3. TyranoScript / TyranoBuilder

> 一手来源：[Tag Reference (V6) 英文版](https://tyranoscript.com/tag/)、[タグリファレンス V6（日文）](https://tyranoscript.jp/tag)、[TyranoBuilder Tag Reference](https://tyranobuilder.com/tag/)、[kanim 完全解读](https://tyrano-complete.blogspot.com/2020/02/kanim.html)、[`[wa]` 死锁实测](https://kido0617.github.io/tyrano/2018-09-10-wa-freeze/)、[`[anim]` 性能与闪烁问题](https://hoshimi12.com/?p=21998)、[KAG tag 转换器 webTaleKit 的 changelog](https://github.com/EndoHizumi/webTaleKit)

TyranoScript 的独特之处是**三套并存的抽象**，作者可以按「我想要多少控制力」选一层。

### 3.1 三层抽象

**第一层：高层语义 API（`chara_*` / `bg` / `bgm`）——面向「我要做这个演出」**
```
[chara_new name="yuko" storage="yuko1.png" jname="ユコ"]
[chara_face name="yuko" face="angry" storage="newface.png"]   ; 表情预注册
[chara_show name="yuko" time=1000 zindex=1 wait=true]
[chara_mod  name="yuko" face="angry" time=300 cross=false]    ; 换表情
[chara_move name="yuko" left="+=200" top="-=100" anim=true time=600 effect=easeOutCubic wait=true]
[chara_hide name="yuko" time=1000 wait=true]
[chara_hide_all time=1000 wait=true]
```
要点：
- `chara_face` 预注册表情 → `chara_mod face=` 只是名字，不用写文件名（这是「演出指令」与「素材」解耦的样本）
- `chara_show` 默认 `time=1000`、`zindex=1`、`wait=true`
- `chara_move` 默认 `time=600`、`anim=false`、`wait=true`
- `chara_mod` 的 `cross` 有明确语义：`true` 旧图淡出+新图淡入（中间角色可能半透明透出背景）；`false` 新图直接叠上去不淡出（轮廓变了会不自然）
- `chara_hide` / `chara_show` 的 `layer` 必须一致

**第二层：底层补间（`[anim]`）——面向「我要动这个元素」**
```
[anim name=haruko left="+=100" time=10000 effect=easeInCirc opacity=0]
[anim layer=1 left="+=100" effect=easeInCirc opacity=0]
[wa]
```
- 选择器二选一：`name`（`[image]`/`[ptext]`/`[button]` 上的 name）或 `layer`（**动整个层，恒作用于 `fore` 页**）
- 属性：`left` / `top` / `width` / `height` / `opacity`(0–255) / `color`
- `time` 默认 **2000 ms**
- `effect` 关键词表（**31 个**）：`jswing`（默认）`def`（默认）`linear`（默认）`easeIn|Out|InOut × {Quad, Cubic, Quart, Quint, Sine, Expo, Circ, Elastic, Back, Bounce}`
- **相对位移语法**：`left="+=100"` / `"-=100"`
- **不等待**，用 `[wa]` 等全部动画
- `name` 的 `name` 属性会被映射成 HTML class（因为底层是 DOM/jQuery）

**第三层：关键帧（`[keyframe]` / `[frame]` / `[kanim]`）——面向「我有一段动画曲线」**
```
[keyframe name="animation1"]
[frame p=20%  x="100" ]
[frame p=40%  x="-100" ]
[frame p=60%  y=100 ]
[frame p=80%  rotate="40deg" ]
[frame p=100% y="-100" rotate="0deg"]
[endkeyframe]

[kanim layer=0 keyframe="animation1" time="5000"]
[wa]
```
- **定义与执行分离**：`[keyframe]` 定义可复用，`[kanim]` 执行（作者称「这样可以把关键帧定义复用多次」）
- `p` 是百分比位置；**省略 0% 帧则继承上一动画状态**
- **绝对/相对编码**：`x="100"` 是位移 100px，`x="*100"` 是「到距屏幕左边 100px 的位置」——**星号前缀编码绝对**，与 KAG 的 `opacity+256` 是同类朴素技巧
- 可动属性：`x y z` / `rotate` / `rotateX|Y|Z` / `scale` / `scaleX|Y|Z` / `skew` / `skewX|Y` / `perspective` / `opacity` / 「其它任意 CSS 样式」
- `[kanim]` 参数：`name|layer` / `keyframe` / `time` / `easing` / `count`（可填 `infinite`）/ `delay` / `direction`（`alternate` 时偶数轮反向）/ `mode`（`forwards` 默认保留终态 / `none` 回到初态）
- `[kanim]` 的 `easing` 与 `[anim]` 的 `effect` 是**两套词汇**：`ease | linear | ease-in | ease-out | ease-in-out`，另外支持 `cubic-bezier(...)`
- `[stop_kanim]` / `[wait]` / `[wait_cancel]`
- `[xanim]`（V515+）把 `[anim]` 与 `[kanim]` 合并成一个泛用动画标签

### 3.2 全局默认：`[chara_config]`

| 参数 | 含义 | 默认 |
|---|---|---|
| `pos_mode` | 开启后角色自动按说话者排位 | — |
| `anim` | 自动排位时是否带动画 | `true` |
| `effect` | 动画曲线（同上 31 关键字表） | — |
| `talk_anim` | 「开始说话时自动让立绘跳一下」：`up` / `down` / `zoom` / `none` | — |
| 表情 crossfade ms | `[chara_mod]` 换表情的交叉淡化时长，0 表示瞬切 | — |

> `talk_anim` 是个很有意思的原语：**「角色开始说话时自动播放一个入场小动作」被提升为全局配置项**，而不是每条台词写一次。

### 3.3 等待语义

- **`wait` 参数默认 true**（阻塞式）：`chara_show`/`chara_hide`/`chara_move`/`chara_mod` 都默认等动画跑完才继续
- `[wa]`：**等当前所有动画完成**才继续（不是「等某个」）
- `[wait time=…]`、`[wait_cancel]`
- `[3d_*]` 家族另有一套 `time`（默认 500/1000）+ `wait`（默认 true）+ `loop`/`direction`/`relative`/`finish` 参数

### 3.4 社区实测到的两个坑（作者/玩家自己总结，非引擎文档）

**坑 1：`[wa]` 死锁**。[kido0617 的排查记录](https://kido0617.github.io/tyrano/2018-09-10-wa-freeze/)写得很清楚：

> `anim` 标签的行为是：动画完成 −1、动画开始 +1。`wa` 标签是「等到当前动画数变成 0」。但**存在动画完成回调不触发的 case**，计数永远不归零 → `wa` 永久等待 → 卡死。
> 触发条件：**在动画进行中把动画目标删掉**。例如两个角色同屏、一个在动画另一个没动时执行 `chara_hide_all`；动画中 `freeimage` 同理。
> 临时对策：在删除前先 `wa`；或用 `[eval exp="TYRANO.kag.tmp.num_anim=0"]` 强制清零。

**坑 2：`[anim]` 的渲染开销与闪烁**。[hoshimi12 的记录](https://hoshimi12.com/?p=21998)：
> - 觉得卡/重时，在各元素显示后与各宏末尾插 `[wait time=0]`
> - **从屏幕外 `[anim]` 移进屏幕内会导致闪烁**（其他元素瞬间消失又出现），解决办法是不要在屏幕外显示元素
> - **等速移动要用 `effect=linear`**；`effect=def` 在其环境下疑似有 bug 而不工作
> 结论原文：`[anim]`  LOOKS 觉得很重、不稳定

> 这两条合起来是很有价值的教训样本：**「等待=等计数器归零」这种隐式等待在有删除/取消路径时极易漏计数**；**「先用离屏 transform 再移入」这种 CSS 常见技巧在舞台语义下会产生闪烁**。此外「31 个 easing 关键字 + 一个 jswing + 一个 def」也说明**曲线词汇表和默认曲线的选择是长期维护负担**（文档未介绍 `linear`，要靠社区考古）。

---

## 4. Naninovel（Unity 系）

> 一手来源：[Scenario Scripting](https://naninovel.com/guide/scenario-scripting)、[Commands API](https://naninovel.com/api/)、[Special Effects（转场）](https://naninovel.com/guide/special-effects)、[Characters](https://naninovel.com/guide/characters)、[Configuration](https://naninovel.com/guide/configuration)、[Script Expressions](https://naninovel.com/guide/script-expressions)

### 4.1 句法：行即语句，参数是 key:value

```
@char Sora.Happy look:left pos:45,10 time:0.5
@camera offset:4,1 zoom:0.5 time:3 wait!
```
- 行首符号：`@` 命令、`#` label、其余是通用文本行
- **参数值类型封闭**：`string`（含空格要加双引号）/ `integer` / `decimal` / `boolean` / `named`（`foo.8`）/ `list`（逗号分隔）
- **布尔 flag 简写**：`@hideAll wait!` ≡ `@hideAll wait:true`；`complete!`
- **无名参数**（nameless）每条命令至多一个，且必须写在所有具名参数之前
- **行内注入**：任何命令都能用 `[ ]` 内联进通用文本行，效果相同但生效时机随文本位置而变
- 通用文本可用特殊 `<` 命令改 `@print` 的参数；`AuthorID: text` 绑定说话者

### 4.2 「几乎所有命令都有的通用参数」——这条是 Naninovel 最值得抄的结构

| 参数 | 类型 | 含义 |
|---|---|---|
| `if` | 表达式 | 执行条件 |
| `unless` | 表达式 | 反向条件 |
| `wait` | boolean | **是否阻塞脚本播放器等它跑完** |
| `time` | decimal(秒) | 动画时长 |
| `easing` | 字符串 | 未指定时用配置里的默认函数 |
| `lazy` | boolean | **打断策略** |

> 于是「演出」完全长在参数上：同一个 `@char` 命令，`time` 控时长、`easing` 控曲线、`wait` 控阻塞、`lazy` 控打断、`if/unless` 控条件——没有任何一条命令需要写块结构来表达并行。

### 4.3 `lazy`：把「重叠打断」显式化

文档原文：
> When the animation initiated by the command is already running, enabling `lazy` will **continue the animation to the new target from the current state**. When `lazy` is not enabled (default behaviour), **currently running animation will instantly complete before starting animating to the new target**.

- 默认：旧动画**立刻跑到终点**再开始新动画（不跳变、不打断感）
- `lazy:true`：从当前状态**平滑续接**到新目标

> 这是本调研中唯一一个**把「同一对象上重叠动画的仲裁策略」做成显式布尔参数**的引擎。其余引擎要么藏起来（Ren'Py 的 parallel 冲突=未定义）、要么靠别的约定（Naninovel 之外的都不管）。

### 4.4 缓动词汇表

`Linear`、`SmoothStep`、`Spring`、`EaseIn|Out|InOut × {Quad, Cubic, Quart, Quint, Sine, Expo, Circ, Bounce, Back, Elastic}`（`EaseInBack/EaseOutBack/EaseInOutElastic` 等），全局默认值来自 actor manager 配置。

### 4.5 并发轨道：`@async` / `@sync` / `@await` / `@stop`

```
@async Quake loop!
    @spawn Pebbles
    @shake Camera
    @wait { random(3, 10) }

@async CameraPan
    @camera offset:4,1 zoom:0.5 time:3 wait!
    @camera offset:,-2 zoom:0.4 time:2 wait!

@async Loop      ; 给 async 块命名后可被 @stop / @await
@stop CameraPan
@sync Main       ; 把并发的轨道与主轨道同步
```
- `@await` 等所有 async 命令跑完
- `@async` 内的 `wait!` 让嵌套行跑在**专用脚本轨道**上，与主播放并行（典型用途：背景里跑复合动画，主线继续）
- `complete!` 强制立刻完成

### 4.6 演员抽象：appearance / pose / transition

```
@char Sora                      ; 默认外观
@char Sora.Happy               ; 切外观（表情/服装）
@char Kohaku.SuperAngry        ; 应用命名 pose（一组参数的打包）
@char Kohaku.SuperAngry tint:#ff45cb   ; pose 打底 + 单项覆盖
@char Kohaku.Happy pose:DownLeft
@char Kohaku.Body/Pose1,Face/Smile    ; 一次应用多个外观
```
- `via:` + `params:` + `dissolve:`（自定义溶解遮罩路径）控制外观切换的转场
- **pose 是「参数打包 + 可单项覆盖」**的显式机制（文档点名了这个组合能力）
- 后端抽象：Generic / Live2D / Spine 各有自己的实现，外观变更通过 Unity 事件路由
- `@char` 的自动排位：`characterPositions`（按角色 id 给 X 百分比，0=左边、100=右边、50=居中）、`look`（是否让角色朝向场景原点）
- 相机是一等对象：`@camera offset/roll/rotation/zoom/ortho/toggle/set`

### 4.7 转场家族（全部带命名 + 可调参数）

`BandedSwirl`、`Blinds`、`CircleReveal`、`CircleStretch`、`Crossfade`、`Dissolve`、`DropFade`、`LineReveal`、`RadialBlur`、`Ripple`、`RotateCrumble`、`Shrink`、`SlideIn`、`Swirl`，外加 `Custom`（给一张灰度 dissolve 遮罩纹理；`params` 第一项 0–100 控制边缘羽化模糊）。

### 4.8 全局默认值（配置面）

| 配置 | 默认 | 说明 |
|---|---|---|
| Default Duration | **0.35**（秒） | 所有 actor 修改（外观/位置/染色）的默认时长 |
| Default Easing | **Linear** | 默认缓动 |
| Auto Show On Modify | false | 修改时是否自动显示 |
| Wait By Default | false | **文档明确标注：「WARNING: Don't enable in new projects… 仅为向后兼容保留，下个版本将移除」** |
| Complete On Continue | true | 玩家按 Continue 时立刻完成阻塞动画 |
| Skip Print Delay | 0 | 快进时每条打印指令额外停留（可用来「慢放快进」） |
| Max Reveal Delay / Max Auto Wait Delay / Scale Auto Wait | 0.06 / 0.02 / true | 文本逐字显示的延迟上限 |

> `Wait By Default` 那条警告很有信息量：**「阻塞/非阻塞」这个默认值一旦被项目选定，就会变成跨项目的行为分叉，于是引擎最终不得不把它废弃。** 对 DSL 设计的含义是：这个默认值必须在 v2 里一次性定死且写进规范。

---

## 5. Ink

> 一手来源：[WritingWithInk](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md)、[RunningYourInk](https://github.com/inkle/ink/blob/master/Documentation/RunningYourInk.md)、[ink JSON runtime format](https://github.com/inkle/ink/blob/master/Documentation/ink_JSON_runtime_format.md)、[inkle 官网](https://www.inklestudios.com/ink/)

Ink 在本调研里的角色是**反例样本**：它证明「叙事层」和「演出层」可以是两个完全独立的语言，而 ink 选择了把后者整个让出去。

### 5.1 ink 里没有舞台原语

ink 的语法元素只有：内容行、`*` 选项、`+` 可重复选项、`-` gather 汇合点、`->` divert、`<>` glue、`===`/`---` 容器、`~` 函数/命令、`{}` 条件、`VAR`/`LIST`、`INCLUDES`、`THREAD`/`END THREAD`、`EXTERNAL`、以及大写游戏级查询（`CHOICE_COUNT()` / `TURNS()` / `TURNS_SINCE(-> knot)` / `SEED_RANDOM()` / `TURNS_SINCE` 的负值语义 `-1 = 从未出现`）。

运行时两段式循环：
1. **Present content**：`while (story.canContinue) { story.Continue(); }`，或 `ContinueMaximally()`；每条是一行字符串。
2. **Make choice**：读 `story.currentChoices` → 玩家输入 → `ChooseChoiceIndex(index)` → 回到 1。

存档 = `story.state.ToJson()` / `state.LoadJson()`（**全量状态序列化**）。

### 5.2 演出怎么进？三条路

文档原话：
> To mark up content more explicitly, you may want to use *tags* or *external functions*. At inkle, we find that we use a mixture.

1. **行内标签**（`#`）：`Character: text # mood:sad # shake:0.3` — 由宿主解析。
2. **外部函数**：
   ```
   EXTERNAL playSound(soundName)
   ```
   绑定：`story.BindExternalFunction("playSound", (string name) => audio.Play(name));`
   调用：`~ playSound("whack")`
   > 外部函数有两类：**Actions**（会改游戏状态，如播音效/显示图）与 **Pure functions**（无害、可重复调用、不改状态，如数学计算）。默认按 Action 处理；绑定时的 `lookaheadSafe` 参数区分：**Actions `lookaheadSafe=false`，Pure `lookaheadSafe=true`**。
   > 原因在文档里说了：与 glue（`<>`）的换行合并机制有关。
3. **Fallback**：测试期（Inky 编辑器 / ink-unity 播放器）来不及绑定外部函数时，可以在 ink 里写一个**同名同参的 ink 函数**作为 fallback，返回占位值。

运行期 JSON 格式也把「钩子」标准化了：`{"x()": "externalFuncName", "exArgs": 5}` 表示外部函数调用；divert 有 5 种形态（标准 divert / 变量目标 / 函数调用 `f()` / 隧道 `->t->` / 外部调用 `x()`）。

> **设计要点**：ink 把「演出指令」降级为**行内标签 + 外部函数**两个纯文本可序列化的钩子——没有任何时间、缓动、并行概念。这带来了极强的可移植性（同一份 ink 可跑在任何引擎上），代价是演出完全交给宿主。

### 5.3 值得注意的「负面约束」

- **`-> END` 必须显式写**；ink 会主动警告 `Apparent loose end exists where the flow runs out`，运行时报 `ran out of content` —— 对 LLM 生成的内容而言，这类「结构完整性的显式要求 + 双重提示」是可借鉴的护栏模式。
- 文中直言 `*` 与 `+`（once-only）的差异是「bit flag」，并详细列出 choice 标志位（`0x8` invisible default / `0x10` once only 等）。
- 官方也承认 `=== round \n and \n -> round` 是 legal but not a great idea（无限循环靠 divert）。

---

## 6. Web 侧

### 6.1 底层库：Pixi.js / Motion / GSAP / anime.js / Godot Tween

**GSAP 的 PixiPlugin** 值得单列，因为它记录了「把 3D 库接到 2D 舞台库上时踩了哪些语义坑」：

> Without the plugin, it's a tad cumbersome with certain properties because they're tucked inside sub-objects in PixiJS's API, like `object.position.x`, `object.scale.y`, `object.skew.x`. Plus **PixiJS defines rotational values in radians instead of degrees which isn't as intuitive** for most developers and designers.

```js
// 旧写法
gsap.to(pixiObject.scale, { x: 2, y: 1.5, duration: 1 });
gsap.to(pixiObject, { rotation: (60 * Math.PI) / 180, duration: 1 });
// 新写法
gsap.to(pixiObject, { pixi: { scaleX: 2, scaleY: 1.5, rotation: 60 }, duration: 1 });
```
以及**旋转方向消歧后缀**：`"_cw"` / `"_ccw"` / `"_short"`（例：`rotation: "-170_short"` 表示走最短路径 20°，而不是默认的逆时针 340°）。
→ 设计含义：**「角度单位」和「子属性寻址」是舞台 DSL 必须在语法层解决、而不是留给作者记住的坑**。

**anime.js 的 timeline 时间位置词汇表**（可直接当作「并行关系」维度的现成词表）：

| 类型 | 写法 | 含义 |
|---|---|---|
| Absolute | `100` | 时间线 100ms 处 |
| Addition | `'+=100'` | 上一元素结束后 100ms |
| Subtraction | `'-=100'` | 上一元素结束前 100ms |
| Multiplier | `'*=.5'` | 上一元素总时长的一半处 |
| Previous end | `'<'` | 上一元素结束位置 |
| Previous start | `'<<'` | 上一元素开始位置 |
| Combined | `'<<+=250'` | 上一元素开始后 250ms |
| Label | `'My Label'` | 某个 label 处 |
| Stagger | `stagger(10)` | 同组元素依次错开 10ms |

> 默认不写 position 时，子元素接在上一元素之后。**默认串行、一律显式写才并行**——这是与 Ren'Py `parallel:` 「必须显式开并行块」正好相反的默认值取向（anime.js 默认串行更安全，也更符合 VN「一条指令 = 一件事」的直觉）。

**spring**：anime.js 的 `spring(mass, stiffness, damping, velocity)` ——**时长由物理参数决定，`duration` 参数被忽略**。> 这是「时长不再是独立维度」的一个明确样本。

**Godot Tween**（同类参照）的默认值也值得记：
> Tweener are executed one after another by default. This behavior can be changed using `parallel()` and `set_parallel()`.
`set_parallel(true)` 之后追加的 tweener 默认同时跑，且**紧邻其前的那一个也会被算进并行组**。`Tween` 默认 `TransitionType = TRANS_LINEAR`、`EaseType = EASE_IN_OUT`。Tween 与 AnimationPlayer 的分工也被写明：**Tween 适合「事先不知道终值」的动画，AnimationPlayer 适合「时间编排复杂、要在编辑器里可视化调」的动画。**

### 6.2 Pixi'VN —— 明确以「LLM 写作」为设计目标的浏览器 VN 引擎

> 一手来源：[pixi-vn.com](https://pixi-vn.com/)、[Ink + Pixi'VN 的 hashtag 命令（canvas）](https://pixi-vn.com/ink/canvas)、[canvas-transition.mdx](https://github.com/DRincs-Productions/pixi-vn-wiki/blob/main/content/start/canvas-transition.mdx)、[make-visual-novel.mdx](https://github.com/DRincs-Productions/pixi-vn-wiki/blob/main/content/start/make-visual-novel.mdx)、[ink hashtag 自定义命令](https://pixi-vn.com/ink/hashtag)、[Issue #20「Basic Tickers」](https://github.com/DRincs-Productions/pixi-vn/issues/20)

官方定位原话：
> Many game engines are built on slow, aging systems — forcing developers through complex toolchains just to ship a simple story-driven game. Pixi'VN changes that by bringing video games into the web application ecosystem: **write your game with a plain text editor, deploy anywhere, and let AI do the heavy lifting.**
> The whole wiki is **written for LLMs**, and every library ships with **full JSDoc**. Engines built entirely on code instead of a visual editor play perfectly with AI.

**舞台命令（原语粒度的样本）**：
```
# show image eggHead
# show image flowerTop xAlign 0 yAlign 1 visible true cursor "pointer" alpha 0.5
# show imagecontainer james [m01-body m01-eyes-smile m01-mouth-neutral01] xAlign 0.5 yAlign 1 with movein direction right
# show text hello "Hello" xAlign 0.5 yAlign 0.5 style { "fill": "red", "fontSize": 30 }
# move eggHead x 300 y 0
# rotate flowerTop
# edit image helmlok alpha 0.5
# shake skully
# animate alien angle 360 options duration 1
# remove image flowerTop with dissolve duration 2
# remove image skully with zoomout
```
- **寻址 = alias**（`show image <alias> <url> ...`），寻址与内容分离
- **定位 = `xAlign` / `yAlign`（0–1）+ `anchor`**，与 Ren'Py 的 `xalign/yalign/anchor` 同构
- **转场是 `with` 从句**：`with dissolve` / `with movein direction right` / `with zoomin` / `with moveout`
- **一条命令里同时给出「目标状态」和「到达方式」**：`with moveout direction right ease circInOut type spring duration 0.5 delay 0.05`
- 复合演出原语有：`shake`；articulated animations（shake/bounce 等多步动画）各有一条 hashtag 命令
- **ticker 模型**：所有动画都是 Motion 库的 ticker，`canvas.animate(alias, keyframes, options)` 返回 `tickerId`；`tickerIdToResume`（转场跑完后再恢复这条动画）、`transferTickers(alias, alias, "duplicate")`（把旧对象的动画接力到新对象）、`aliasToRemoveAfter`（新对象淡入后再删旧对象）、`completeOnContinue`（Continue 键立刻完成）
- 转场家族：`dissolve` / `fade` / `moveIn|moveOut` / `pushIn|pushOut` / `zoomIn|zoomOut`，并明确在 issue 里标注每个效果的**设计出处**（例如「PushMove → Ren'Py PushMove」「ease → Ren'Py ease」）——**这是一份公开的「转场词汇表谱系」**
- **ink 集成**：用 ink 写叙事，用 `#` hashtag 命令驱动舞台；`HashtagCommands.add(fn, { name, description, validation })` 里 **`description` 里直接写使用示例、`validation` 用 Zod schema 声明参数**——把「命令的自描述文档」做成 API 的一部分

> 这是本调研中**唯一以「让 LLM 一次写对」为第一目标**的引擎。它的做法有三条可直接借鉴：
> 1. **一条命令只带一组封闭参数**（show/edit/remove/move/rotate/shake/animate 各司其职），不提供「通用 setter」；
> 2. **目标状态与到达方式分离但在同一条命令**（keyframes 给目标，options 给 duration/ease/type/delay）——比对 Naninovel 的「属性 + 通用参数」更紧凑；
> 3. **自描述**：命令的 `description` 里带代码块示例，参数用 Zod 校验，JSON 输出带 `$schema` URL——编译器/LLM 可以在运行时验证。

### 6.3 Tsuzuru —— 显式选择「不做成通用语言」

> 一手来源：[tsuzuru-engine/tsuzuru README](https://github.com/tsuzuru-engine/tsuzuru)

核心取向：
> Tsuzuru does **not** try to be a general-purpose scripting language or a clone of KAG, TyranoScript, or Ren'Py. The `.tzr` language is **intentionally constrained** so it can be parsed, validated, compiled, and connected to TypeScript plugins.

DSL v2 的形状（注意 `with` 从句 + `at` 定位 + 缩进块，全部是前人词汇的重新组合）：
```tzr
title "Sample Game"
character mio name="Mio"

scene start:
  bg classroom with fade(duration=300)
  show mio_smile at center with dissolve(duration=250)

  mio:
    Hello.
    Welcome to Tsuzuru.

  choice "Continue?":
    "Continue" id=continue:
      jump next
```
它把标准插件按**状态持续性**分类，这是一个很干净的划分：
| 插件 | 职责 |
|---|---|
| `plugin-std-visual` | 背景与精灵的**状态** |
| `plugin-std-audio` | BGM / SE / 语音状态与事件 |
| `plugin-std-effect` | **一次性**画面效果 |
| `plugin-std-camera` | **持久**相机状态 |
| `plugin-std-particle` | 持久粒子状态 |
| `plugin-std-hotspot` | 矩形热区状态与点击等待 |
| `plugin-std-system` | 结局/CG/成就解锁状态 |

且明确列出的限制里有：**「no arbitrary JavaScript or TypeScript execution inside `.tzr` files」** 和 **「generic macros, presets, reusable staging syntax, and scenario-local procedures are not implemented」**。

> 「一次性效果 vs 持久状态」这个分类轴在本调研中只有 Tsuzuru 显式化了；其它引擎靠「是否 `wait`、是否能被后续指令寻址」隐式区分。

### 6.4 Twine（Harlowe / SugarCube）—— 反方向的极简

Harlowe 的 passage 过渡只有**有限枚举 + 两个时机**：`transition-arrive:` / `transition-depart:`，效果枚举为 `instant / dissolve / flicker / shudder / rumble / slide-right / slide-left / pulse`，另有 `transition-time:`。

SugarCube 走 jQuery 事件路线：`Config.passages.transitionOut` 改属性或时长，或在 `:passagerender` 事件上挂 jQuery 效果。

> 对照样本：**当舞台层只是「整块 DOM 的进出场」时，粒度可以低到「passage 进 + passage 出 + 有限枚举 + 时长」**。这也是 Ren'Py 默认转场族（dissolve/fade/move/ease/push/zoom/wipe/iris）的粒度来源。

---

## 7. 横切议题

### 7.1 「一个演出指令」的正交维度（跨引擎归纳）

把上表压到最核心的**九个槽位**：

| # | 维度 | 不写会怎样 | 各引擎的表达 |
|---|---|---|---|
| 1 | **寻址（谁）** | 必须有默认 | tag（Ren'Py）/ alias（Pixi'VN）/ actorId（Naninovel）/ `name`（TyranoScript）/ `layer+page`（KAG） |
| 2 | **状态迁移（做/不做）** | 必须有默认 | show/hide（Ren'Py、TyranoScript、Naninovel、Pixi'VN）/ `visible`（KAG） |
| 3 | **属性集合** | 必须有默认（=保持） | 属性名 + 值；多属性同行 |
| 4 | **时长** | 必须有默认（Ren'Py 的 0.5s、Naninovel 的 0.35s、TyranoScript `chara_show` 1000ms / `chara_move` 600ms / `anim` 2000ms、KAG `animstart` 无默认但 `wait` 需显式 ms） | 单位不统一：Ren'Py 秒、Naninovel 秒、Web 库秒，**KAG 与 TyranoScript 用毫秒** |
| 5 | **曲线** | 必须有默认 | Ren'Py = 语句前缀；TyranoScript = `effect=` 属性（两套词）；Naninovel = `easing:`；Pixi'VN = `ease:`+`type:`；KAG = `accel` 数值 + `spline` 开关（**没有曲线名**） |
| 6 | **并行/串行** | 必须有默认 | Ren'Py 默认串行，`parallel:` 开并行；anime.js 默认串行，position 参数开并行；Naninovel 默认并行、`wait` 汇合；KAG 多 `move` 天然并行；Pixi'VN 用 ticker 接力 |
| 7 | **阻塞/让出** | 必须有默认 | Ren'Py 语句自带 interaction（可点击跳过）；Naninovel `wait`（默认关，且被标为不要在新项目启用）；TyranoScript `wait=true` 默认；KAG 用配对的 w 类标签 + `canskip` |
| 8 | **触发时机** | 必须有默认（=立即） | Ren'Py 事件系统（show/hide/replace/replaced/appear/…）+ `on:`；KAG `[waittrig]`；其余靠脚本顺序 |
| 9 | **冲突/打断** | 目前几乎都没有默认（全靠约定） | Ren'Py `show_cancels_hide` + 「parallel 同属性 = 未定义」；Naninovel `lazy`；KAG `stopmove/stoptrans/stopanim` 直接落终态；TyranoScript `wa` 计数器 |

### 7.2 全局默认 + 局部覆盖的三种实现形态

**形态 A：配置对象 → 按 key 查**（Ren'Py `config.default_transform` / `tag_transform` / `tag_zorder` / `layer_transforms`）
**形态 B：集中式「角色/演员配置」标签**（TyranoScript `[chara_config]`；Naninovel 的 actor manager 配置）
**形态 C：把默认值写进语法，让「不写 = 保持现值」**（Pixi'VN 的可选参数；Ren'Py 的「显示为默认可被 `config.default_transform` 重定义」）

以及一个在所有引擎里都存在但都很难解释的第四种：
**形态 D：属性被「替换」时的继承**（Ren'Py 的 transform 替换继承 + 位置属性「子覆盖父」特判；Pixi'VN 的 `copyCanvasElementProperty` 拷贝旧对象属性到新对象）
→ 这是「同一对象换素材」时最容易出意外的地方，四个引擎里三个都专门做了处理，但没有一个把它做成显式开关（Ren'Py 有 `reset=True` / `reset` transform 相当于手动开关）。

### 7.3 「同一对象的多个属性动画同时进行」的五种做法

| 做法 | 代表 | 优点（按文档表述） | 代价（按文档表述） |
|---|---|---|---|
| **一条语句内多属性** | Ren'Py `linear 2.0 xalign 0.5 yalign 0.5`；Naninovel `offset:4,1 zoom:0.5`；Godot `tween_property` 多条 + `set_parallel` | 「文档明确推荐」「最简单」 | 全部属性共享同一条曲线，无法给不同属性不同曲线（anime.js 例外：`rotate: {to:360, ease:'out(6)'}` 可逐属性指定） |
| **`parallel:` 块** | Ren'Py | 各块可有自己的语句、自己的 `repeat` | **文档明写：同块不得共写共享底层数据的属性，否则行为不可预测**（`xalign`/`xpos` 冲突；`angle`/`radius` 同时改 x 和 y） |
| **默认隐式并行 + 显式汇合** | Naninovel（所有 async 命令并行，`@await` 汇合）；Pixi'VN（ticker 各自跑）；KAG（多个 `move`） | 作者不用写并行代码 | **完全依赖等待语义的正确性**——TyranoScript 的 `wa` 死锁就是这个坑的实证 |
| **顺序默认、显式才并行** | anime.js（默认接在上一个之后，position 参数才并行）；Godot Tween（默认串行，`set_parallel` 才并行） | 误并行概率低 | 要并行的场合必须写 position |
| **关键帧** | TyranoScript `[keyframe]/[frame]/[kanim]` | 曲线可视化、可复用、能做非线性（rotate/scale/skew/perspective） | 定义与执行分离，LLM 容易写错对象（社区文章明确提醒「`kanim` 的 `name` 是元素的 name，不是 keyframe 的 name」） |

### 7.4 缓动与时间控制词汇表（合并版）

**曲线名空间（三套并存的命名法）**
- Ren'Py：`pause` `linear` `ease` `easein` `easeout` + `ease/easein/easeout × {back,bounce,circ,cubic,elastic,expo,quad,quart,quint}`（源自 easings.net，**in/out 相对 Penner 反转以对齐主命名**）
- TyranoScript：`jswing` `def` `linear` + `easeIn/Out/InOut × {Quad,Cubic,Quart,Quint,Sine,Expo,Circ,Elastic,Back,Bounce}`（另 `[kanim]` 的 `easing=ease|linear|ease-in|ease-out|ease-in-out|cubic-bezier(...)`）
- Naninovel：`Linear` `SmoothStep` `Spring` + `EaseIn/Out/InOut × {Quad,Cubic,Quart,Quint,Sine,Expo,Circ,Bounce,Back,Elastic}`
- Pixi'VN / Motion：`ease:` + `type: spring`，另有 `anticipate` 等 Motion 特有曲线
- Web 通用：easings.net 全家族 + `spring(mass, stiffness, damping, velocity)`（时长由物理决定）

**时间的词汇（三层混用是常态）**
- 裸等待：Ren'Py `pause` / KAG `[wait]` / TyranoScript `[wait]` / Naninovel `@wait`
- 绝对等待：Ren'Py `time <sec>`（会打断当前语句）/ KAG `resetwait` + `wait mode=until` / Naninovel `@sync`
- 等待某类动作结束：Ren'Py 无（语句即终点）/ KAG `wm/wt/wa/wq/wb/wf/wl/ws/wv` / TyranoScript `wa` / Naninovel `@await` / Pixi'VN `completeOnContinue`
- 循环：Ren'Py `repeat [n]` / KAG asd 的 `@loop`+`@jump target=*start` / TyranoScript `repeat`+`count`/`direction` / Naninovel `@async name loop!` / anime.js `loop:`/`.loop()`
- 可跳过：KAG 全局 `[clickskip]` + 每个 w 标签的 `canskip` / Ren'Py 的点击提前结束 interaction / Naninovel 的 `Complete On Continue` 与 `Skip Print Delay`

**单位陷阱（跨引擎不一致的一手证据）**：Ren'Py、Naninovel、GSAP/anime.js/Motion 用**秒**；KAG 与 TyranoScript 用**毫秒**；动画库用弧度而舞台语义习惯用角度（GSAP 的 PixiPlugin 专门做了适配）。

### 7.5 触发时机词汇表

| 时机 | Ren'Py | KAG | TyranoScript | Naninovel | Web |
|---|---|---|---|---|---|
| 立即 | 语句执行 | 标签顺序 | 标签顺序 | 脚本顺序 | timeline position |
| 上屏 / 替换 / 下屏 | `show`/`replace`/`hide`/`replaced`/`appear` | —（靠 `[image]`+`layopt`） | — | — | — |
| 条件成立/不成立 | `showif` + 投递事件 | `cond=` 属性 | `cond=` 属性 | `if`/`unless` 参数 | — |
| 事件信号 | `event` 语句 / `[waittrig]` 式（KAG） | `[waittrig name=]` | — | — | `call(fn, pos)` |
| 交互态（hover/idle/focus） | `hover` `idle` `selected_hover` `selected_idle` `insensitive` `selected_insensitive`；screen 层的 `on` | `onenter`/`onleave` 属性 | — | — | DOM 事件 |
| 时间基（相位） | `st` vs `at`（`animation` 语句切换） | — | — | — | `autoplay:false` + 手动 resume |
| 玩家按键 | 点击提前结束 interaction | `clickskip` / `waitclick` | — | `Complete On Continue` | — |

### 7.6 转场（Transition）作为一个独立轴

所有引擎都把「整屏画面切换」与「单对象动画」**分成两个原语族**：

| 引擎 | 单对象 | 整屏转场 | 二者的耦合点 |
|---|---|---|---|
| Ren'Py | ATL transform | `with` + transition class | ATL transition 可写（拿 `old_widget`/`new_widget`）；`MoveTransition` **只能**用在 `with` 上，不能嵌进 ATL/ComposeTransition |
| KAG | `move`（层内位移/淡变） | `trans`（里页→表页） | `move` 与 `trans` 都在同一层寻址体系（layer+page）内；文档强调「转场中状态不定，改位置/显隐要等 `[wt]`」 |
| TyranoScript | `[anim]`/`[kanim]`（元素级） | `[trans]`（层页面翻转）+ `[bg method=…]` | 两者共用 `time`/`wait` 但语义不同 |
| Naninovel | actor/background 的 `via:` 外观转场 | `@trans` / `@scene` | 转场效果命名家族被两处共用 |
| Pixi'VN | `# move` / `# animate` / `# edit` | `# show/remove with <transition>` | **同一个 `with` 从句同时服务两边** |

**转场家族命名的一致性**（跨引擎几乎完全重合，证明这是「公认原语粒度」）：
`dissolve` / `fade` / `crossfade` / `move-in` / `move-out` / `push` / `zoom-in` / `zoom-out` / `wipe` / `iris` / `blinds` / `shatter|mosaic|squares`
—— Ren'Py、Naninovel、Pixi'VN 三家几乎一模一样；Naninovel 额外有 `Swirl / Ripple / RotateCrumble / LineReveal / CircleReveal / DropFade / BandedSwirl / Shrink / RadialBlur`；KAG 有 `universal`（规则图）/ `scroll` / `wave` / `mosaic` / `turn` / `rotatezoom` / `rotatevanish` / `rotateswap` / `ripple`；Harlowe 有 `dissolve / flicker / shudder / rumble / slide-left / slide-right / pulse / instant`。

> **这是本调研中最强的一条「领域共识」**：转场是一个**有限枚举的参数化家族**，不是可组合的通用图。它同时被 Ren'Py（`CropMove` 的 mode 三组 + `ImageDissolve` 的规则图）与 Naninovel（`Custom` dissolve mask）证明可以「用一张灰度遮罩图」无限扩展。

---

## 8. 表达力 vs「一次写对」：取舍与教训

> 以下全部为**来源中明文写出的取舍、警告或社区实测**，每条附出处；不含本报告的偏好判断。

### 8.1 「可组合」被推到极致 → 作者/LLM 的责任也最重（Ren'Py 的教训）

- Ren'Py 自己把设计意图写成一句话：ATL 的关键是 **composibility**，「relatively simple commands, which can be combined together to create complicated transforms」。
- 代价写在同一份文档里：`parallel` 内「若两块改同一属性，行为不可预测，应避免」；底层共享数据的具体例子（`xalign`/`xpos` 共享数据；`angle`/`radius` 同时改横纵）。
- 代价还延伸到了**继承语义**：`at a, b, c` → `at d, e` 是「从右往左匹配」，`c`→`e`、`b`→`d`、`a` 不被替换；替换时复制的是**旧动画的当前中间值**；位置属性还额外「子覆盖父」。这些规则在教程里都没有正面讲，只在 reference 里以「Replacing Transforms」一节出现。
- 官方教程的补救方式是把它们拆到最小单位来讲（`show`/`hide`/`pause`/`repeat`/`linear`/`block`/`time`/`parallel`/`choice` 逐个 demo）。
- 社区里 ATL 的用法习惯本身就分裂：有用户「我从来不用 `ease`，我所有老 ATL 都用 `linear`，所以我花了一会儿才搞明白 `easein_back` 应该放在哪」（[forum 记录](https://www.renpy.org/doc/html/transforms.html) 引用）。

### 8.2 「抽象成高层 API」→ 一写不错但表达力受限（TyranoScript / Naninovel 的分层）

- TyranoScript 的应对是**三套并存**（`chara_*` 语义 API / `[anim]` 补间 / `[kanim]` 关键帧），并用 `[xanim]` 在 V515 后合并第二与第三层。作者的定位说法是「把动画定义与动画执行分开管理，关键帧定义可以反复复用」。
- 代价：`chara_move`/`anim`/`kanim` 各自的 `effect` 与 `easing` 是**两套不同的曲线词表**（一个 31 关键字带 `jswing`，一个 5 关键字带 `cubic-bezier`），官方文档都没有把它们放在一页说明。
- 社区实测的两个坑（见 §3.4）：`wa` 计数泄漏导致永久卡死；`[anim]` 重、离屏移入会闪烁、`effect=def` 疑似坏掉而文档未提 `linear`。
- Naninovel 的应对是**参数模型**：所有命令共享 `if/unless/wait/time/easing/lazy`，于是表达力靠「命令种类」扩展而不是「语法结构」。代价是命名负担：Actor Manager 有 `Default Duration`（0.35s）、`Default Easing`（Linear）、`Auto Show On Modify` 六个全局项，Script Player 又有一组打印/自动/快进参数；并且 **`Wait By Default` 被明确标注为「新项目不要启用，保留仅作向后兼容，下版本移除」**。

### 8.3 「枚举封闭」是让 LLM 一次写对的主要抓手

- Pixi'VN 是唯一把这一点写进产品定位的：`show / edit / remove / move / rotate / shake / animate` 各一条命令、参数可选且封闭、`with <枚举转场> direction <枚举> ease <曲线> type <枚举> duration <数> delay <数>`。
- 它的自描述 API：`HashtagCommands.add(fn, { name, description, validation })`，`description` 里直接写 ```ink 用法示例```，`validation` 用 Zod schema。
- 它的转场词汇表在 issue 里**逐条标注了出处**（哪些来自 Ren'Py 的哪个类），等于把「词汇表谱系」公开化。
- 反面参照：Tsuzuru 明确拒绝「做成通用脚本语言」——「intentionally constrained so it can be parsed, validated, compiled」，并明确 `.tzr` 内**不允许任意 JS/TS 执行**。
- ink 的反面教训：**松散的结构**是它的卖点（divert 流程「flat」、「写新分支不需要 boilerplate」），但代价是对「松散尾」有强依赖，需要 `-> END` 显式收尾并由编译器+运行时双重报错。

### 8.4 「演出状态要不要进存档」——三条路线的取舍

- **Ren'Py**：演出对象（Displayable/Transform/Transition）**可保存**，存档点在「与用户交互的语句开始处」，回滚恢复到语句起始状态。代价是需要理解「语句中途读档会得到什么」这条规则。
- **KAG**：只存「动画段号 + 起始 label」，读档从头重放。`AnimationLayer.tjs` 的作者注释里把后果写得很直白：`loop` 标签**只是声明给存读档用、不会自动循环**；不写 `loop` 的段读档时**不会**重启；因此默认段/clip 方式都「强烈建议写成 loop 结构或干脆不动画」。
- **Naninovel**：actor 状态序列化进 save；多外观（`Body/Pose1,Face/Smile`）也随状态存档并在读档时还原。

### 8.5 「等待语义」是最容易出致命 bug 的一环

- TyranoScript 的 `wa` 是「等动画计数归零」，删除动画目标会让计数漏减 → 永久卡死（社区实测，有复现代码）。
- Naninovel 把 `Wait By Default` 标成「不要在新项目启用」。
- KAG 用一整套配对标签（`wm/wt/wa/wq/wb/wf/wl/ws/wv`）+ 全局 `clickskip` 开关 + 每标签 `canskip` 来把这件事表达完整——粒度最细，但也因此文档面最复杂。
- Pixi'VN 的做法是把「玩家按 Continue 时立刻完成阻塞动画」做成 `completeOnContinue`（moveIn 这类转场默认 true）。
- Godot 的对应取舍写在文档里：Tween 适合「事先不知道终值」的动画，AnimationPlayer 适合「时间编排复杂、要在编辑器里可视化调」的动画；Tween 更轻量但无法可视化。

### 8.6 与「素材」解耦的做法

四个引擎不约而同做了「名字 → 素材」的映射层：
- Ren'Py：`image eileen happy = ...` 定义，`show eileen happy` 引用；tag/attribute 分离
- TyranoScript：`[chara_new]` 定义 + `[chara_face]` 预注册表情，`[chara_mod face=]` 只写名字
- Naninovel：`@char Kohaku.SuperAngry` + pose 打包 + 单项覆盖
- KAG：`[image]` 同名文件自动附带 `_m` 遮罩、`_p` 可点击区、`asd` 动画、`.ma` 动作定义

---

## 9. 来源索引

**Ren'Py**
- Transforms / ATL：https://www.renpy.org/doc/html/transforms.html
- Transform Properties：https://www.renpy.org/doc/html/transform_properties.html
- Displaying Images：https://www.renpy.org/doc/html/displaying_images.html
- Transitions：https://www.renpy.org/doc/html/transitions.html
- Configuration Variables：https://www.renpy.org/doc/html/config.html
- Screens and Screen Language：https://www.renpy.org/doc/html/screens.html
- Saving, Loading, and Rollback：https://www.renpy.org/doc/html/save_load_rollback.html
- Language Basics：https://www.renpy.org/doc/html/language_basics.html
- ATL 教程脚本（官方 repo）：https://github.com/renpy/renpy/blob/master/tutorial/game/tutorial_atl.rpy
- warper 源码 `renpy/common/000atl.rpy`：https://github.com/renpy/renpy/blob/master/renpy/common/000atl.rpy
- `renpy/config.py`（默认 transform / layer 配置的默认值）：https://github.com/renpy/renpy/blob/master/renpy/config.py

**KAG / KiriKiri**
- KAG System Reference（标签总表 + 每个标签的属性表）：https://kirikirikag.sourceforge.net/contents/Tags.html
- Dreamsavior 的英文镜像标签参考：https://dreamsavior.net/docs/kag-references/tag-reference/
- トランジションについて（转场方法与选项）：https://krkrz.github.io/docs/kirikiriz/j/contents/Transition.html
- `data/system/AnimationLayer.tjs`（动画规格 + asd 标签 + segment 说明 + 存读档陷阱）：https://github.com/krkrz/kag3/blob/master/data/system/AnimationLayer.tjs
- novelsphere.js 的 asd 文档：https://developer.novelsphere.jp/doc/o2doc2/content/spec_anim.html
- KAG3 移植与新功能（asq→asd、animation segment）：https://krkrz.github.io/krkr2doc/kag3doc/contents/PortFromOldKAG.html
- 吉里吉里Z 文件格式规格（.asd 定义）：https://krkrz.github.io/docs/specification/fileformat.html

**TyranoScript**
- Tag Reference (V6) 英文：https://tyranoscript.com/tag/
- タグリファレンス V6 日文：https://tyranoscript.jp/tag
- TyranoBuilder Tag Reference：https://tyranobuilder.com/tag/
- 使用教程（角色控制 / chara_config / chara_face）：https://tyranoscript.com/usage/tech/chara
- `[wa]` 死锁排查：https://kido0617.github.io/tyrano/2018-09-10-wa-freeze/
- 同一作者的后续对策宏/插件：https://kido0617.github.io/tyrano/2018-10-03-plugin-macro-work1/
- `[anim]` 注意点（卡顿/闪烁/等速移动）：https://hoshimi12.com/?p=21998
- `[kanim]` 参数详解：https://tyrano-complete.blogspot.com/2020/02/kanim.html

**Naninovel**
- Scenario Scripting：https://naninovel.com/guide/scenario-scripting
- Commands API：https://naninovel.com/api/
- Special Effects / Transitions：https://naninovel.com/guide/special-effects
- 转场效果逐个说明：https://nani.nanana.cn/guide/transition-effects
- Characters（appearance / pose / actor 实现）：https://naninovel.com/guide/characters
- Configuration：https://naninovel.com/guide/configuration
- Script Expressions：https://naninovel.com/guide/script-expressions

**Ink**
- WritingWithInk：https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md
- RunningYourInk：https://github.com/inkle/ink/blob/master/Documentation/RunningYourInk.md
- ink JSON runtime format：https://github.com/inkle/ink/blob/master/Documentation/ink_JSON_runtime_format.md
- inkle 官网：https://www.inklestudios.com/ink/

**Web 侧**
- Pixi'VN 官网（LLM-first 定位）：https://pixi-vn.com/
- Pixi'VN ink hashtag 命令（canvas）：https://pixi-vn.com/ink/canvas
- Pixi'VN 自定义 hashtag + Zod validation：https://pixi-vn.com/ink/hashtag
- Pixi'VN wiki · Transitions：https://github.com/DRincs-Productions/pixi-vn-wiki/blob/main/content/start/canvas-transition.mdx
- Pixi'VN wiki · Make a visual novel：https://github.com/DRincs-Productions/pixi-vn-wiki/blob/main/content/start/make-visual-novel.mdx
- Pixi'VN Issue #20（转场词汇表出处标注）：https://github.com/DRincs-Productions/pixi-vn/issues/20
- Tsuzuru（约束型 TS VN 引擎）：https://github.com/tsuzuru-engine/tsuzuru
- vnengine core（headless TS 引擎，事件划分）：https://jsr.io/@vnengine/core
- GSAP PixiPlugin：https://gsap.com/docs/v3/Plugins/PixiPlugin/
- anime.js v3 时间线位置：https://animejs.com/v3/documentation/
- anime.js v4 时间位置与 easing：https://animejs.com/documentation/timeline/time-position 、 https://animejs.com/documentation/timeline
- PixiJS v8 迁移指南（filter / container / animation 相关变更）：https://pixijs.com/8.x/guides/migrations/v8
- Godot Tween：https://docs.godotengine.org/en/stable/classes/class_tween.html
- Godot AnimationPlayer：https://docs.godotengine.org/en/stable/classes/class_animationplayer.html
- Godot Tween 源码：https://github.com/godotengine/godot/blob/master/scene/animation/tween.h
- Yarn Spinner 命令：https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/commands
- Yarn Spinner Dialogue Runner：https://docs.yarnspinner.dev/components/dialogue-runner
- Godot Dialogue Manager（`concurrent_lines` 等）：https://github.com/nathanhoad/godot_dialogue_manager 、 https://dialogue.nathanhoad.net/
- Twine Cookbook · Harlowe 段落过渡：https://twinery.org/cookbook/passagetransitions/harlowe/harlowe_passagetransitions.html
- Twine Cookbook · SugarCube 段落过渡：https://twinery.org/cookbook/passagetransitions/sugarcube/sugarcube_passagetransitions.html
- SugarCube v2 文档：https://www.motoslave.net/sugarcube/2/docs/
- RenJS（浏览器 VN，effects vs ambients）：https://renjs.net/docs-page.html

**LLM/AI 相关的一手观察**
- renpy-mcp（MCP 让 agent 读/写/编译/lint Ren'Py，README 提到「AI Agent 使用前请先阅读 AI_GUIDE.md——包含完整工作流、常见坑和 9 大禁止事项」）：https://github.com/Muanchen2/renpy-mcp
- RenPy-AutoScriptPlugin（ChatGPT 驱动 Ren'Py；作者自述「即使努力保证格式一致，仍有少数偏离，因此请先 console print 检查再解析」）：https://github.com/Wendy-Nam/RenPy-AutoScriptPlugin
- Lute Scenario DSL 提案（**一份专门为「LLM 友好剧本 DSL」写的规范草案**，含「language is total / reduces to data / 不可识别的行 = 静态错误，没有 prose fallback」等约束）：https://github.com/journeyWorker/lute/blob/main/docs/proposals/scenario-dsl/0.1.0.md
- 「From Outline to Detail: An Hierarchical End-to-end Framework for Coherent and Consistent Visual Novel Generation」（学术侧，提到「LLM 生成长而连贯的剧情困难」「跨模态一致性缺乏机制」「需要 script validation 机制保证可执行」）：https://exa.ai/library/publication/bk3yvr9cv4g

---

## 10. 本次未覆盖 / 需进一步验证的空白

1. **Ren'Py 的 `Function` / `Transform`（Python callable 作为 transform）与 `ATL curry`（部分参数传递）的细节**：文档确认存在（`transform <name>(args)`、`unique()`、`warp` 自定义），但未逐条展开其与「参数化演出模板」的关系。
2. **Ren'Py screen 语言中 `at` 属性与 `at transform` 的事件投递差异**（只有直接加到 screen 上的 transform 才会收到 show/hide/replace/replaced）——只拿到规则，未核对 `nearrect`/`box`/`vbox` 的完整语义。
3. **Naninovel 的 `@spawn` / `@despawn` / `@shake` / `@waitForDelay` / `@decals` 等完整命令集**与 `@camera` 的全部参数（只拿到片段）。
4. **KAG 的 `[waittrig]` 与 KAG 内部 trigger 机制的完整 API**（`kag.trigger(name)` 的调用方约定）。
5. **TyranoScript 的 `[html]` / `[mtext]` / `[position]` / `[3d_*]` 家族与 `[kanim]` 的 CSS 属性透传边界**（`frame` 文档写「Other: 各种 CSS 样式可以指定」，未验证实际透传哪些）。
6. **Web 端 2D 舞台库（Pixi.js v8 自带 `Animation`/ticker 与 Motion 的分工）**：只确认 Pixi'VN 「Motion for animation」，未核对 Pixi.js v8 原生动画 API 的能力边界与它的 v8 迁移改动。
7. **Electron 系的 VN 框架**（本次只覆盖到浏览器/Tauri 系）：未找到有代表性的、仍在维护的 Electron 专属演出层实现文档。
8. **LLM 一致性的一手实验数据**：只找到工具侧证据（renpy-mcp 的 lint/compile 闭环、RenPy-AutoScriptPlugin 的格式偏离），没有「哪种原语粒度对 LLM 更友好」的对照实验。

---

*报告完。撰写过程中未对上述引擎做优劣评价；所有「教训 / 代价」条目均可回溯到来源原文或社区实测记录。*
