# Stage DSL `title` 标签：VN 引擎惯例调研

日期：2026-10-07 ｜ 仓库：`stage-ai`（`packages/core` / `packages/stage`）、`dsh-aivn`（消费者）

本调研只回答一个问题：**在 VN 引擎与剧本语言里，"全屏文本卡"这一类演化是怎么表达、怎么收尾的**。
它服务于后一篇 [`261007-dsl-title.plan.md`](261007-dsl-title.plan.md)；设计与取舍在那里落定。

---

## 0. 结论速览

| 议题 | 业界惯例 | 对我们的含义 |
|---|---|---|
| 隐藏对话框 | Ren'Py `window hide` / `window auto`；KAG `[hidemessage]` | 是**独立于内容的显隐状态**，不是某种"台词"；我们映射为一个离开时自动复位的模式 |
| 全屏文本 | Ren'Py NVL 模式（整屏文本窗）；标题卡走 `show screen` + `window hide` | "全屏"与"隐藏对话框"是同一件事的两面：文本卡就是**对话框的替代品**，不是叠在对话框上的层 |
| 标题卡收尾 | Ren'Py `add Pause(n)`（定时）/ `with Pause`（等点击）；标签块用 `window hide → show → pause/hide → window auto` | 两种收尾都有先例：**定时收**与**点击收**。我们只有"点击"这个时钟，取点击收 |
| 多行文本出法 | NVL 一次铺一屏；ADV/打字机逐字；`[p]` 分页点击、`[l]` 行末点击等待 | "整段一次出"= 不设分页等待；"逐句出"= 每段之间夹一个点击等待（`[p]` 的语义） |
| 点击语义 | 点击只做一件事：**推进当前文本**（未打完→打完；打完→下一句）。选项是另一个 UI 层，不抢这个点击 | 逐句揭示与 `<stop>` 的选项按钮天然两层，不需要客户端额外判别"这是哪种点击" |
| 纯色背景 | Ren'Py `image black = Solid("#000")` 后 `scene black`；官方教程内置 `black`/`white`/`grey` 三个 Solid | 惯例就是**把纯色当一张具名背景**。给 `bg` 认保留色名/色值，等价于内置几张 Solid，不新造机制 |

---

## 1. 对话框显隐：独立状态，自动复位

**Ren'Py** 把这套做成了显式语句（[Displying Images · Hide and Show Window](https://www.renpy.org/doc/html/displaying_images.html)）：

- `window show` / `window hide`：显式显示/隐藏对话窗，可带转场；
- `window auto True`：由引擎按语句类型自动管理——`say` 前显示，`scene`/无标题 `menu` 前隐藏；**`window show`/`window hide` 会取消 auto 模式**；
- 隐藏发生在"非对话交互"期间（过场、pause、scene 之间）。

**KAG（吉里吉里）** 提供 `[hidemessage]`（消息层临时隐藏，点一下即恢复）以及 `[cm]`/`[ct]`/`[er]` 三个清屏标签、`[p]` 分页等待（[Tags](https://kirikirikag.sourceforge.net/contents/Tags.html)、[Letter](https://kirikirikag.sourceforge.net/contents/Letter.html)）。

要点：**"隐藏"是一个可以跨越多条指令存续的状态**，而不是绑定到某一句台词上。一次 `window hide` 之后的 `scene`/`show`/`pause` 全都在隐藏态里，直到 `window show` 或 `window auto` 把它拨回来。

> 对我们的直接启示：`title` 不能是"一条带隐藏属性的台词"，那样 `</title>` 之后又冒出 `<say>` 时隐藏态就断了。正确的形状是**进入 title 就是进入一个隐藏态，离开 title 自动复位**——与 Ren'Py 的 auto 管理同构，只是我们把"离开"定义为 `</title>`（见 §4）。

---

## 2. 全屏文本：NVL 与标题卡

VN 业界把对话呈现分两档（[VNDev Wiki · Textbox](https://vndev.wiki/Textbox)）：

- **ADV（Adventure）**：立绘基本不被遮挡，文本框占屏幕下方约三分之一——绝大多数作品；
- **NVL（Novel）**：文本框覆盖立绘或屏幕大部，用于叙事密集、独白、诗歌类的段落。

Ren'Py 官方教程把 NVL 定义为"一次在屏幕上呈现多行文本、窗口占满整屏"的模式（[NVL-Mode Tutorial](https://www.renpy.org/doc/html/nvl_mode.html)），并明确它可以和 ADV 混用：`nvl show` / `nvl hide` 负责切换，`nvl clear` 负责清空累积的文本。

**标题卡（chapter card / eyecatch）** 是另一条常见路线（[VNDev Wiki · Special graphics](https://vndev.wiki/Special_graphics)、[Ren'Py Patreon · title screens](https://patreon.renpy.org/title-screens.html)）：

```renpy
label title(message, subtitle=None):
    window hide
    show screen title_screen(message, subtitle)
    with dissolve
    pause 2
    hide screen title_screen
    with dissolve
    window auto
    return
```

官方旧教程的等价写法（[Chapters](https://sources.debian.org/data/main/r/renpy/6.10.2.dfsg1-1/doc/tutorials/Chapters.html)）：

```renpy
scene black with dissolve
show text "Chapter 1\nA Frightening Sight" with Pause(1.5)
scene black with dissolve
```

两个可直接复用的结构性事实：

1. **标题卡与全屏文本是同一族**：都是"对话框让位给一块占据全屏的文本"；NVL 是持续形态，标题卡是短暂形态。
2. **对齐与排版是卡片自己的属性**：官方示例用 `xalign`/`yalign`/`text_align`/`layout "subtitle"` 控制位置与逐行对齐，与对话框无关。

---

## 3. 逐句 vs 整段：分页等待与打字机

- **打字机（typewriter）** 是每字/每行逐步显现的动画，**几乎每个 VN 都是标配可选**（[VNDev Wiki · Textbox](https://vndev.wiki/Textbox)）。
- **分页等待**由 KAG 的 `[p]`（改页点击等待）表达：到 `[p]` 处停下等你点击，点了才清屏继续；`[l]` 是"行末点击等待"（[Letter](https://krkirikag.sourceforge.net/contents/Letter.html)）。这正是"逐句出"的引擎原语——**每句之间放一个等待点**。
- **整段一次出**对应不放等待点：文本连续铺完，只有段落真正结束才停。

因此"两种出法"在引擎层面并不是两种渲染器，而是**同一条文本流里放不放等待点**。我们的 DSL 里没有 `[p]` 这种行内标记，所以由 `title` 的 `mode` 属性在块级一次性决定"这段里每行之间要不要等待"。

---

## 4. 收尾：定时 vs 点击，以及"必须点掉最后一句"

Ren'Py 标题卡给了两种先例：

| 写法 | 收尾方式 |
|---|---|
| `show text "…" with Pause(1.5)` | **定时**：1.5 秒后自动淡出 |
| `show text "…" with Pause`（无时长） | **点击**：停到玩家点击或回车 |
| `pause 2` 之后再 `hide screen` | 定时 |

我们的引擎**没有时间轴时钟**：演出节奏完全由「事件流 + 玩家点击/自动模式」驱动（见 `packages/stage/src/director.ts` 的 `usePlayback`，自动模式用固定公式 `min(900 + 字数*55, 3200)` 估算停顿）。引入"秒数"属性会打开一个新的时间语义面，而它不属于本任务。所以选择**点击收**：标题卡停在屏幕上，直到玩家点掉——这与 `with Pause`（无时长）的语义一致，也符合"标题给读者一个停顿"的用途。

**必须点掉最后一句**：逐句模式下，最后一行显示完后，再点一次才离开 title、恢复对话框。这是 KAG `[p]`"点了才继续"的自然延续，也让读者控制重读节奏。

---

## 5. 点击语义：只有一个"推进"，选项是另一层

VN 的点击几乎是单义的（[VNDev Wiki · Textbox](https://vndev.wiki/Textbox)）：

- 当前文本还在打字 → 点击**跳到整段显示完**（skip the typewriter）；
- 文本已显示完 → 点击**推进到下一段**；
- 到了选项 → 选项是**独立的按钮 UI**，点击选项按钮才有效，点空白通常不推进。

KAG 的三段式也印证这一点：`[l]`/`[p]` 是"等待点击然后继续"，`[s]` 是"停止执行，等待玩家点击选择支/按钮"（[Tags](https://kirikirikag.sourceforge.net/contents/Tags.html)）——`[s]` 与 `[p]` 是两种**不同的等待**，前者等的是选择，后者等的是推进。

> 对我们的直接启示：**逐句揭示（推进）与 `<stop>`（选择/输入）本来就分属两层**。我们的 `advance()`（推进当前文本）与 StopPanel 的选项按钮（选择）也已经是两层。所以不需要让客户端"识别这是哪一种点击"——让 `advance()` 具备"揭示下一句标题行"的能力，而停止点面板继续用自己的按钮截获点击即可。

---

## 6. 纯色背景：把 Solid 当一张具名背景

Ren'Py 官方教程（[Chapters](https://sources.debian.org/data/main/r/renpy/6.10.2.dfsg1-1/doc/tutorials/Chapters.html)）直接写：

```renpy
init:
    image black = Solid((0, 0, 0, 255))
    image white = Solid((255, 255, 255, 255))
    image grey  = Solid((128, 128, 128, 255))

scene black with dissolve
show text "Chapter 1" with Pause(1.5)
```

即：**纯色场就是一张由 `Solid` 生成的、有名字的图**，`scene black` 与 `scene bg_meadow` 语法上完全一致。官方还特别注明 `black`（小写）是唯一默认识别的颜色，其它颜色要在 `init` 里手工定义。

这条惯例的价值在于：不需要为纯色另立一套 `solid`/`field` 语法；**给背景 id 的命名空间里保留几个色名（或接受色值字面量）即可**。这也是我们的候选方案（见 plan §6）。

---

## 7. 对我们现有实现的对照

| 我们已有 | 与惯例的对应 |
|---|---|
| `<say>`/`<narrate>`/`<thought>` 三类包裹标签，`say_start/text/end` 三段 IR，打字机 | ADV 的对话呈现 |
| `advance()`：打字中→瞬显，已完→消费下一条 cue（`packages/stage/src/director.ts:626`） | §5 的"单义推进"，两段式已就位 |
| `<stop>` 落谱系 + StopPanel/选项浮层，与舞台点击互不干扰 | §5 的"选择是另一层"已就位 |
| `--stage-bg` + `.theater-bg-fallback`（无素材时的纯色底） | §6 的 Solid 雏形——只差"可指定的色值" |
| `theme.c`ss/`theme.json` 的设计令牌（`--dialog-*`/`--font-ui`/`--accent`…） | 标题的字体/颜色/投影应进同一套令牌（见 plan §8） |

---

## 8. 参考来源

- Ren'Py Documentation — [Displaying Images · Hide and Show Window](https://www.renpy.org/doc/html/displaying_images.html)
- Ren'Py Documentation — [Dialogue and Narration · Dialogue Window Management](https://www.renpy.org/doc/html/dialogue.html)
- Ren'Py Documentation — [NVL-Mode Tutorial](https://www.renpy.org/doc/html/nvl_mode.html)
- Ren'Py Documentation — [Statement Equivalents](https://www.renpy.org/doc/html/statement_equivalents.html)、[Transitions](https://www.renpy.org/doc/html/transitions.html)
- Ren'Py Patreon — [Title Screens](https://patreon.renpy.org/title-screens.html)
- Ren'Py Tutorial (Debian mirror) — [Chapters](https://sources.debian.org/data/main/r/renpy/6.10.2.dfsg1-1/doc/tutorials/Chapters.html)
- VNDev Wiki — [Textbox](https://vndev.wiki/Textbox)、[Special graphics](https://vndev.wiki/Special_graphics)
- KAG System Reference — [Tags](https://kirikirikag.sourceforge.net/contents/Tags.html)、[Display text](https://kirikirikag.sourceforge.net/contents/Letter.html)
- 仓库既有调研（可复用，避免重复）：[`261002-vn-engine-presentation-primitives.research.md`](../261002-dsl-v2/261002-vn-engine-presentation-primitives.research.md)、[`261002-galgame-presentation-primitives.research.md`](../261002-dsl-v2/261002-galgame-presentation-primitives.research.md)
