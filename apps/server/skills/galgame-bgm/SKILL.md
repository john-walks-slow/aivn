---
name: galgame-bgm
description: 给 galgame / 视觉小说写 AI 生成 BGM 的英文提示词速查。含配器选型、情绪词表、速度与曲式、galgame 味的关键措辞（钢琴/八音盒/弦乐铺底）、反例（EDM/摇滚/史诗会跑偏）、以及配套的 mood/scene 元数据怎么填。当用户或助手要给剧目生成 BGM、需要把中文情绪翻成英文提示词、或生成的曲子风格不对要改提示词时使用。
user-invocable: true
---

# galgame-bgm（生成 BGM 的提示词怎么写）

> 面向 `generate_bgm` 工具。素材**从哪找**（CC0 曲库、授权能不能分发）是另一份技能
> `galgame-audio`——先查库再生成，别拿生成当找曲子的第一手段。

## 0. 提示词的四段式

工具只吃一段英文自由文本，但**必须**按这个顺序写满四段。缺一段就会偏向那一段的极端：

```
[配器] + [情绪与走向] + [速度与曲式] + [用途]
```

- **配器**：第一段，也是最决定「像不像 galgame」的一段。
- **情绪与走向**：不是词而是**走向**——`sad but hopeful` 与 `sad` 出两首完全不同的曲子。
- **速度与曲式**：`slow / medium tempo`、`loopable`、`steady rhythm`。
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

**galgame 的底色通常是单件独奏 + 少量铺底**：写了完整乐队（`full orchestra`, `big band`）就会往游戏主题曲或影视配乐跑，台词全被压住。

## 2. 情绪词（照抄，别自创）

模型认这些固定搭配；自造的词会被解成别的东西。

- 温柔 / 治愈：`gentle`, `warm`, `soft`, `healing`, `tender`
- 忧伤 / 失落：`melancholic`, `sad`, `somber`, `wistful`, `bittersweet`
- 明亮 / 日常：`bright`, `cheerful`, `upbeat`, `playful`, `light`
- 紧张 / 悬疑：`tense`, `suspenseful`, `anxious`, `dark`, `ominous`
- 壮烈 / 高潮：`epic`, `heroic`, `intense`, `driving`

**成对写走向**（这一招比堆词有效得多）：

| 单写 | 改成 |
| --- | --- |
| `sad` | `sad but hopeful`, `bittersweet, bittersweet yet warm` |
| `happy` | `happy but wistful`, `cheerful with a hint of sadness` |
| `tense` | `tense building to relief` |

## 3. 速度与曲式

```
slow tempo / medium tempo / gentle tempo
steady rhythm / no tempo changes
loopable / seamless loop
sparse arrangement, lots of space for dialogue
```

- **要当环境音一直垫着的**：`loopable`, `steady rhythm`, `no dramatic build`。
- **要当片头/片尾曲的**：反过来写 `with a clear beginning and ending`, `building to a climax`。

## 4. 用途段（别省）

台词段落的曲子不加这句，八成出成有主唱有高潮的「歌」。写法：

```
solo accompaniment for dialogue
background music under a monologue, keeps the foreground clear
understated accompaniment, does not compete with the voice
```

## 5. 反例（这些词会把曲子推出 galgame）

| 别写 | 会变成 | 改写成 |
| --- | --- | --- |
| `epic orchestral` | 影视预告配乐 | `strings and piano, restrained` |
| `EDM` / `electronic dance` | 舞曲 | `soft synth pad` |
| `rock band` / `guitar riff` | 摇滚 | `acoustic guitar, fingerpicked` |
| `with vocals` / `singer` | 一首**歌** | 删掉；工具出不了人声歌词 |
| `instrumental version of...` | 翻唱既有曲子 | 描述**风格**而不是**作品名** |
| `anime opening` | 动画 OP 那种燃曲 | `Japanese-style piano piece, gentle` |
| `8-bit chiptune` | 游戏芯片音 | `celesta and music box` |

最后两条最常踩：**写曲名等于要求翻唱**（模型会去找那首的旋律），写风格才是原创。

## 6. 元数据怎么填（`mood` / `scene`）

曲子的**选取**全靠这两栏，剧作家看不到音频只能看字。两栏都必须按这首曲子真实的情绪填：

- `mood`：2–5 个情绪词，中文即可（`温柔` / `忧伤` / `轻快` / `紧张`）。
- `scene`：2–5 个适用场景（`告白` / `别离` / `回忆` / `日常` / `悬疑` / `片尾`）。
- `loop`：要一直垫着就 `true`；有明确起止的片头片尾曲 `false`。
- `description`：**写在哪一段垫、什么情绪**。剧作家靠这句决定换不换曲，别写成曲风形容词堆砌。

范例（告白的过场，一首要一直垫着的）：

```
prompt: solo piano with soft strings, tender and hopeful with a touch of
        hesitation, slow tempo, seamless loop, sparse arrangement,
        background music under a monologue, keeps the foreground clear
name:   bgm_confession_tender
title:  心意渐明
mood:   [温柔, 心动, 忐忑]
scene:  [告白, 独白, 日常]
loop:   true
volume: 0.35
description: 两人独处时的过场，音量压低不抢台词；告白的最后一句可以一直垫着。
```

## 7. 生成不出想要的曲子时

按这个顺序改，别重写整段：

1. **换配器**，情绪词不动（配器是最大的变量）。
2. **加走向**（`but` 接一个转折）。
3. **加用途段**（压住抢戏）。
4. 还不对才改情绪词——它通常不是问题所在。

一次生成约 84 秒（实测），改一次是一轮等待，别来回试。