---
name: galgame-bgm
description: 给 galgame / 视觉小说写 AI 生成 BGM 的英文提示词速查。含配器选型表、情绪走向写法、无缝循环怎么写进提示词、无人声/纯器乐约束、和弦色彩与「日系钢琴/八音盒/弦乐」这类具体风格的措辞、反例词表，以及 mood/scene 标签必须对齐素材库既有词表。当要把中文情绪翻成英文提示词、要生成的曲子风格不对、或要填 mood/scene/loop/volume 这些声明时使用（本剧目配了音乐后端时才用得上）。
user-invocable: true
---

# galgame-bgm（生成 BGM 的提示词怎么写）

面向 `generate_bgm`（工坊专用，后台排产）。**上游固定给 ~176s 的成品**，时长与循环只能靠提示词去影响，
不能靠参数——实测 `generationConfig` 里的音频字段不生效（记录见 `docs/features/261005-music-generation/`）。

## 0. 提示词四段式

工具只吃一段英文自由文本，但**必须**按这个顺序写满四段。缺一段就会偏向那一段的极端：

```
[配器] + [情绪与走向] + [速度/循环] + [用途]
```

- **配器**：第一段，也是最决定「像不像 galgame」的一段。
- **情绪与走向**：不是词而是**走向**——`sad but hopeful` 与 `sad` 出两首完全不同的曲子。
- **速度/循环**：见第 3 节，**循环那句别省**。
- **用途**：`solo accompaniment for dialogue`、`under a monologue`。这一段压住「抢戏」的曲子。

## 1. 配器选型（galgame 味的主来源）

| 想要的气质 | 写什么 |
| --- | --- |
| 日系日常 / 校园 | `solo piano`, `soft piano with light percussion` |
| 抒情 / 告白 / 回忆 | `solo piano with strings`, `piano and harp`, `solo piano, emotional` |
| 怀旧 / 童年 / 夕阳 | `music box`, `celesta`, `glockenspiel` |
| 温柔日常 | `acoustic guitar`, `soft piano and acoustic guitar` |
| 压抑 / 悬疑 | `low piano with sustained strings`, `dark ambient piano`, `minor key strings` |
| 别离 / 终章 | `solo piano, slow, sparse`, `strings and piano, bittersweet` |
| 轻快过场 | `bright piano, upbeat`, `light percussive ensemble` |

**galgame 的底色通常是单件独奏 + 少量铺底**：写了完整乐队（`full orchestra`、`big band`）就会往游戏主题曲或
影视配乐跑，台词全被压住。

## 2. 情绪词（照抄，别自造）

模型认这些固定搭配；自造的词会被解成别的东西。

- 温柔 / 治愈：`gentle`, `warm`, `soft`, `healing`, `tender`
- 忧伤 / 失落：`melancholic`, `sad`, `somber`, `wistful`, `bittersweet`
- 明亮 / 日常：`bright`, `cheerful`, `upbeat`, `playful`, `light`
- 紧张 / 悬疑：`tense`, `suspenseful`, `anxious`, `dark`, `ominous`
- 壮烈 / 高潮：`epic`, `heroic`, `intense`, `driving`

**成对写走向**（比堆词有效得多）：

| 单写 | 改成 |
| --- | --- |
| `sad` | `sad but hopeful`, `bittersweet, yet warm` |
| `happy` | `happy but wistful`, `cheerful with a hint of sadness` |
| `tense` | `tense building to relief` |

## 3. 无缝循环（galgame 的硬需求，别省）

**BGM 要反复铺在对话下面**：galgame 的一段对话可能十几分钟，同一首曲子循环几十次。
**头尾接不上就是一次实打实的出戏**——每次循环到接缝处音色突变，听众立刻出戏。

实测上游固定给 ~176s，**没有「指定时长」的入参**，所以只能靠提示词表达意图：

```
seamless loop, loopable, steady tempo, no fade in or fade out,
no intro, no outro, no dramatic build, consistent dynamics throughout
```

- **`loopable` 或 `seamless loop` 至少写一个**，别只写 `steady tempo`（那只是速度稳，不是接得上）。
- **`no fade in or fade out` 很关键**：模型爱给开头一个渐入、结尾一个渐出，接缝处就会有一次明显的音量台阶。
- **要循环的曲子就别写 `building to a climax`**：有高潮的曲子循环起来每次都在同一个地方爬坡。
  改写 `building, then settling back`，或干脆不要推进。
- 片头曲 / 片尾曲这类**只播一次**的，才写 `with a clear beginning and ending`——那和循环是互斥的。

## 4. 声明值怎么填（loop / volume）

上游固定 ~176s，**拿不到别的长度**，所以别硬凑一个假的时长：

| 字段 | 怎么填 |
| --- | --- |
| `loop` | 循环用途填 `true`；片头/片尾曲填 `false`。**galgame 里绝大多数是 `true`** |
| `volume` | 素材库既有 61 条全落在 **0.35–0.45**（众数 0.45）。对白垫底取 **0.35–0.4**，情绪重的过场可以到 0.45 |
| `description` | 写在哪一段垫、什么情绪，**并照库的惯例写一句使用条件**（「没有人声、不盖对白」这类） |

**不要为了「短一点好循环」去写 `short loop`**：上游不给这个长度，写了只会让曲子变潦草而不会变短。

## 5. 无人声 / 纯器乐（必写）

galgame 的 BGM 是**垫在台词下面的**，人声会和人声打架。写 `with vocals` / `singer` / `female singer`
出来的是**一首歌**，不是 BGM，台词直接被压掉。

- 默认就是纯器乐，**不用写否定句**，但下面这句更保险：
  ```
  instrumental only, no vocals, no lyrics, no humming
  ```
- 偶尔会出现无词哼唱（`ooh`, `aah`, `humming`, `vocalise`）。那是折中方案：想要有人声情绪但不要歌词时，
  显式写 `soft wordless humming, no lyrics`；完全不想要就写 `no humming, no vocalise`。

## 6. 和弦色彩与「日系」措辞

「日系」不是形容词，是**和声与配器的组合**。想要那种味道，按下面往里挑：

| 想要 | 措辞 |
| --- | --- |
| 日系钢琴小品的和声味 | `major key, bright open chords`, `lydian brightness`, `warm major seventh chords` |
| 物哀 / 泪点 | `minor key with a major seventh resolution`, `wistful chromatic passing chords` |
| 八音盒 / 钢片琴的日系质感 | `music box`, `celesta`, `glockenspiel, delicate, high register` |
| 弦乐铺底 | `soft strings pad`, `sustained strings`, `legato strings` |
| 和风 | `koto`, `shamisen`, `pentatonic scale, traditional Japanese` |
| 都市 / 冷色 | `synth pad`, `electric piano, lo-fi`, `urban, cool` |

**别写曲名**：写 `instrumental version of xxx` 等于要求翻唱那首的旋律，模型会去找它。
描述**风格**才是原创。另外别写 `anime opening`——那是燃曲，会把日常场景顶掉。

## 7. 反例词表（这些会把曲子推出 galgame）

| 别写 | 会变成 | 改写成 |
| --- | --- | --- |
| `epic orchestral` | 影视预告配乐 | `strings and piano, restrained` |
| `EDM` / `electronic dance` | 舞曲 | `soft synth pad` |
| `rock band` / `guitar riff` | 摇滚 | `acoustic guitar, fingerpicked` |
| `with vocals` / `singer` | 一首**歌** | `instrumental only` |
| `instrumental version of...` | 翻唱既有曲子 | 描述**风格**而不是作品名 |
| `anime opening` | 动画 OP 那种燃曲 | `Japanese-style piano piece, gentle` |
| `8-bit chiptune` | 游戏芯片音 | `celesta and music box` |
| `building to a climax` | 循环时每次都爬坡 | `consistent dynamics throughout` |

## 8. mood / scene / tags：必须对齐素材库既有词表

**这三栏是剧作家选曲的唯一依据**——它看不见音频，只能读这一行（剧目素材表，剧作家每轮的素材清单就是它）。
而选曲是**在资源库与生成曲之间一起选**的，所以：

> **`mood` / `scene` 必须落在 `library/bgm/` 既有 61 条已经用过的词上。**
> 自造一个「凄美」出来，库里没有任何曲子带这个词，它就成了只此一条的孤岛，
> 剧作家在混合清单里挑不出它，也匹配不上任何一场戏的既有曲。

**mood（照抄既有词）**——常用一批：

`温柔` `温暖` `治愈` `忧伤` `忧郁` `惆怅` `哀婉` `悲伤` `怀念` `怀旧` `日常` `轻松` `轻快` `俏皮`
`安静` `平静` `沉思` `寂寥` `孤独` `压抑` `紧张` `压迫` `诡异` `清冷` `空灵` `心动` `酸涩`
`不舍` `释然` `决意` `宏大` `明亮` `微妙` `隐忍` `期待`

**scene（照抄既有词）**——按「这场戏在干什么」选：

`日常` `闲聊` `校园` `校园日常` `教室` `放学` `社团` `回忆` `独白` `内心戏` `告白` `别离` `告别`
`初遇` `和解` `道歉` `过场` `转场` `开场` `角色登场` `片尾` `结局` `高潮` `咖啡馆` `图书馆`
`街道` `郊外` `都市` `海边` `黄昏` `夜晚` `雨天` `夏天` `假期` `周末` `对峙` `危机` `追逐`
`悬疑` `推理` `梦境` `等待` `犹豫` `独处` `崩溃`

**tags（常用既有词）**：`日系` `钢琴` `八音盒` `钢片琴` `弦乐` `竖琴` `尤克里里` `合成器` `轻音乐`
`环境音` `循环` `都市` `和风` `西式` `概念原声` `角色主题曲` `日常` `校园` `回忆` `温柔` `伤感`
`轻快` `推进` `怀旧` `治愈` `诡异`

**填法**：mood 2–5 个、scene 2–5 个、tags 2–5 个，都要**真的描述这首曲子**。
`description` 写在哪一段垫、什么情绪——剧作家靠它决定换不换曲，别写成曲风形容词堆砌。

## 9. 完整范例

**告白过场**（循环、垫对白）：

```
prompt: solo piano with soft strings, tender and hopeful with a touch of
        hesitation, slow tempo, seamless loop, steady rhythm, no fade in or
        fade out, sparse arrangement, instrumental only, no vocals,
        background music under a monologue, keeps the foreground clear
name:   bgm_confession_tender
title:  心意渐明
tags:   [日系, 钢琴, 循环]
mood:   [温柔, 心动, 微妙]
scene:  [告白, 独白, 犹豫]
loop:   true
volume: 0.35
description: 两人独处时的过场，音量压低不盖台词；没有前奏尾奏，可整场循环。
```

**悬念推进**（不循环、有推进）：

```
prompt: dark ambient piano with low sustained strings, tense and restrained,
        steady rhythm building slowly, instrumental only, no vocals,
        background music for a scene, does not compete with the voice
name:   bgm_suspense_corridor
title:  走廊尽头
tags:   [轻音乐, 环境音]
mood:   [紧张, 压抑, 悬疑]
scene:  [悬疑, 危机, 推理]
loop:   false
volume: 0.42
description: 追查段落垫底，从走廊一路走到尽头；不循环，一幕放完。
```

## 10. 出得不像时怎么改

按这个顺序改，别重写整段（每次生成要等一分半）：

1. **换配器**，情绪词不动——配器是最大的变量。
2. **加走向**（用 `but` 接一个转折）。
3. **加 `seamless loop, no fade in or fade out`**（听着断就往这儿调）。
4. **加 `instrumental only, no vocals`**（听着像在唱歌就往这儿调）。
5. 还不对才改情绪词——它通常不是问题所在。

一次生成约 84 秒（实测），改一次是一轮等待。别来回试。