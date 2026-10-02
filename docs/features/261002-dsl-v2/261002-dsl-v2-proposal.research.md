# Stage DSL v2 语法草案

> 日期：2026-10-02 · 状态：草案待定词  
> 配套调研：[演出效果全集与浏览器可实现性](261002-galgame-presentation-primitives.research.md) · [引擎原语对照](261002-vn-engine-presentation-primitives.research.md) · [语音与音频体系](261002-vn-voice-and-audio-presentation.research.md)

## 设计约束（用户 2026-10-02 定）

1. **不考虑向后兼容**。v1 的 `pos="left|center|right"`、`transition`、`action="enter|leave|shake"` 都可以直接改掉。
2. **面向 playwriter，不是代码编写员**。剧本里不该出现的东西：毫秒数、缓动曲线、z-index、opacity 数值、锚点、坐标、flip、scale 倍数。
3. **声明式**：只说目标状态，不写"先 A 再 B"。移动不是 `move`，是"她现在站在中间"。
4. **强于全面控制**。一个东西有八档行为能挑，就不要给它一个自由参数。
5. **范围**：镜头 + 屏幕特效 + 角色演出 + 语音。粒子与视频不进 v2。
6. **动画层**：原生 CSS + WAAPI，不引第三方库。
7. **主角**：只同台上台，不做台词框内小头像。

---

## 1. 核心手法：把"怎么过去"折进行为词

引擎内部维护一张**行为词 → 动画配方**的表（时长、曲线、位移方式、是否打断）。剧本只写行为名。

```
enter="walk"   →  900ms ease-out，从画面外侧滑入，末段 60ms 微沉
enter="run"    →  550ms ease-out，起步快、尾段带 8px 过冲
enter="fade"   →  400ms linear 透明度
enter="pop"    →  260ms back-out，缩放 0.82 → 1.06 → 1.0
leave="walk"   →  900ms ease-in，滑出并缩到 0.96
leave="fade"   →  350ms linear
```

这样"节奏感"变成**编剧的品味而不是工程师的调参**：想让角色慌慌张张地冲进来就写 `enter="run"`，想要他就慢慢走进光里就写 `enter="walk"`。行为词不够用时，**加行为词**，不加参数。

同理还有：

- **景别 `shot`**（`wide` / `normal` / `close` / `extreme`）—— 摄影术语，编剧知道
- **气氛 `mood`**（`memory` / `dream` / `nightmare` / `tension` / `intimate` / `dusk` / `tense`）—— 一词同时决定滤镜、暗角、转场时长、有没有慢推
- **身量 `size`**（`far` / `normal` / `near`）—— 纵深与特写，一个词解决，不用 scale 数值

---

## 2. 标签集（9 个）

### `<scene>` 场景

```
<scene bg="bg_rooftop_dusk" bgm="bgm_piano" bgm_volume="0.4"
       ambient="ambient_wind" mood="dusk"/>
```

| 属性 | 说明 |
|---|---|
| `bg` / `bgm` / `ambient` | 沿用 v1 三态语义：缺省=保持，`none`=停 |
| `bgm_volume` / `ambient_volume` | 0–1，沿用 |
| `mood` | 场景气氛。一词打包滤镜 + 转场 + 缓推 |
| `duration` | 可选。只在"这一场要慢慢黑下去"这类地方显式给，秒。默认由 mood 定 |

**`mood` 的配方表（草案）**

| mood | 滤镜 | 转场 | 附带 |
|---|---|---|---|
| `normal` | 无 | dissolve 500ms | — |
| `dusk` | 暖调 + 轻暗角 | dissolve 700ms | 背景慢推 1.0→1.04 |
| `memory` | sepia 0.6 + 暗角 | dissolve 1200ms | 慢推 + 边缘柔化 |
| `dream` | 提亮 + 轻微模糊 | dissolve 1400ms | 慢推 1.0→1.06 |
| `nightmare` | 冷调 + 压暗 + 噪点 | 闪黑 500ms | — |
| `tension` | 轻微压暗 + 收窄暗角 | 硬切 250ms | — |
| `intimate` | 暖调 + 背景虚化 blur(6px) | dissolve 900ms | — |
| `cold` | 青灰调 | dissolve 600ms | — |

> `intimate` 的背景虚化走**对背景层自身 `filter: blur()`**，不用 `backdrop-filter`（祖先的 filter/opacity 会建 Backdrop Root 把采样截断，见调研 §10.2）。

### `<actor>` 角色

```
<actor id="lucy" expression="smile" at="left" enter="walk"/>
<actor id="lucy" expression="shock" action="stagger"/>
<actor id="lucy" at="center" size="near"/>
<actor id="lucy" leave="fade"/>
```

| 属性 | 取值 | 缺省 |
|---|---|---|
| `id` | 角色 id（`player` 即主角） | 必填 |
| `expression` | 差分名 | 保持 |
| `at` | `far_left` / `left` / `center` / `right` / `far_right` / `1`–`5` | 保持 |
| `size` | `far` / `normal` / `near` | 保持 |
| `enter` | `fade` / `slide` / `walk` / `run` / `pop` | — |
| `leave` | `fade` / `slide` / `walk` | — |
| `action` | `shake` / `nod` / `jump` / `stagger` / `turn` / `bow` | — |

**`at` 接数字（1–5）时的语义**：第 N 号机位。引擎按在场人数自动展开——1 人站中间，2 人分左右，3 人左中右，4–5 人等距铺开并自动错开前后层。编剧写"她走到位置 2"，引擎负责在 16:9 和竖屏两种画幅下都排得好看。

**没有 `move`**：换位就是改 `at`，引擎自动补间。同理换表情就是改 `expression`。这让「状态声明」成为唯一写法。

**`enter`/`leave`/`action` 的互斥**：`enter` 与 `leave` 不能同时给（写了 `leave` 就不该再 `enter`）；`action` 只在角色已在场时有意义（不在场就丢弃 + warning，与现有 `dropTag` 一致）。

### `<camera>` 镜头

```
<camera focus="lucy" shot="close"/>
<camera shake="heavy"/>
<camera letterbox="on"/>
<camera reset/>
```

| 属性 | 取值 | 说明 |
|---|---|---|
| `focus` | 角色 id / `bg` / 素材 id | 镜头对准谁（自动算平移与缩放，不给数值） |
| `shot` | `wide` / `normal` / `close` / `extreme` | 景别 |
| `shake` | `light` / `heavy` | 抖动 |
| `letterbox` | `on` / `off` | 电影宽画幅黑边 |
| `reset` | 自闭合 | 复位到标准全景 |

`focus` + `shot` 是**一起写的**：`focus="lucy" shot="close"` 才有意义，`shot` 单独给就以舞台中心为焦点。引擎从立绘的实际渲染位置反推镜头中心——所以立绘在左边时，`focus="lucy"` 的镜头会自己跟着挪。

### `<fx>` 一次性画面冲击

```
<fx flash="white"/>
<fx flash="red"/>
<fx flash="black"/>
```

- 只有闪屏一种形态。**持续性气氛一律走 `scene` 的 `mood`**，不在这儿混。
- 红闪（被打）、白闪（雷击/闪光）、黑闪（冲击）是三种最常用的瞬时反馈。
- 镜头抖动走 `camera shake`，不进 `fx`。

### `<cg>` 插图

```
<cg id="cg_handshake" caption="夕阳下的约定"/>
```

保持 v1 形态。切 CG 时的转场由当前 `scene` 的 `mood` 决定，不给 CG 单独的转场参数。

### `<sfx>` 音效

```
<sfx src="door_open" volume="0.5"/>
```

保持 v1 形态。

### `<say>` / `<narrate>` / `<thought>` 台词

```
<say id="lucy" mood="happy" tone="whisper">你终于来啦。</say>
<say id="player" voice="off">……算了。</say>
<narrate>雨越下越大。</narrate>
<thought id="player" mood="nervous">（她在等我吗。）</thought>
```

| 属性 | 取值 | 作用 |
|---|---|---|
| `mood` | Fish Audio 基础情绪子集（happy/sad/angry/excited/nervous/calm/scared/sarcastic/moved） | 驱动 TTS。v1 里它只是文字标注，v2 真正进合成 |
| `tone` | `normal` / `whisper` / `shout` / `soft` | 语气 |
| `voice` | `off` | 本句闭麦 |

**没有 `speed`**：语速是角色卡的事（`CharacterCard.voice`），不是单句的事。

### `<comment>` 注释

保持 v1 形态，语义不变。

---

## 3. play.json 的语音配置

```json
{
  "voice": {
    "enabled": true,
    "strategy": "npcs",
    "kinds": ["say", "thought"],
    "delay": 0.5
  }
}
```

| 字段 | 取值 | 说明 |
|---|---|---|
| `enabled` | bool | 总开关。false = 不合成、不预取、省全部配额 |
| `strategy` | `all` / `npcs` / `protagonist` / `custom` | `npcs` = 主角不配音（**默认值**，代入感最强也最省配额） |
| `kinds` | `["say","thought","narrate"]` 子集 | 哪些文本类型配音。旁白默认不配 |
| `delay` | 秒 | 自动模式下语音播完的缓冲垫，默认 0.5 |

角色卡沿用 `voiceId`（有值=有音色），`custom` 策略下再加一个 `voiceEnabled` 布尔。

**TTS 缓存键必须改**：现在是 `sha1(voiceId + "\0" + text)`，加了 mood/tone 之后必须一起进键，否则同一句台词在不同情绪下会互相串音。

---

## 4. 主角立绘

`ProtagonistCard`（现在是 `{name, persona}`）扩成 `CharacterCard` 的同构超集，加 `sprites` / `framing` / `voiceId`。

- 剧本里 `<actor id="player" .../>` 就是普通角色
- 台词条名牌：`id === "player"` 仍显示「你」，这条不变
- 主角能不能出声由 `voice.strategy` 决定，DSL 不管

---

## 5. 一次对比：同一场戏的 v1 与 v2

**场景**：黄昏天台，女主跑上来，回头看见主角，说了一句。

v1 写不出来（没有位置、没有景别、没有闪屏）：

```xml
<scene bg="bg_rooftop_dusk" bgm="bgm_sad_piano" transition="fade"/>
<actor id="lucy" pos="left" expression="shock"/>
<say id="lucy" mood="surprised">你…你怎么在这？</say>
```

v2：

```xml
<scene bg="bg_rooftop_dusk" bgm="bgm_sad_piano" mood="dusk"/>
<actor id="lucy" expression="shock" enter="run" at="left"/>
<camera focus="lucy" shot="close"/>
<say id="lucy" mood="surprised" tone="soft">你…你怎么在这？</say>
<fx flash="white"/>
<actor id="lucy" at="2" size="near"/>
<say id="lucy" mood="nervous">我找了你一个下午。</say>
<camera reset/>
```

---

## 6. 落地顺序（待确认后开工）

1. `packages/core`：行为词表（配方）+ v2 标签集 + 解析器 + IR 事件类型
2. `apps/web`：`stage/scene.ts` 舞台状态机（把 `director.ts` 的 `VisualState` 扩成带 transform 的对象树）+ 渲染层重写
3. `play.json`：`voice` 块 + `ProtagonistCard` 扩展
4. `apps/server`：TTS 缓存键 + `VoicePipeline` 读 `strategy`
5. `prompt.ts`：剧作家提示词换 v2 语法

---

## 7. 待定清单

- `mood` 的词表到底收哪几个（draft 里的 8 个够不够）
- `action` 的词表（现在 6 个，`sway` / `startle` 要不要）
- `at` 数字机位的自动排布在 4–5 人同框时是否好看
- 行为词配方表的初始数值——这是唯一需要"调品味"的地方，得实际跑起来看