# 视觉小说 / Galgame 语音与音频演出体系深度调研报告
## 面向 LLM 剧本 DSL、Web Audio 调度与剧目级语音配置的技术实践

- **文档归属**：`docs/features/261002-dsl-v2/260902-vn-voice-and-audio-presentation.research.md`
- **调研执行**：Deep Researcher
- **调研基准时间**：2026 年 10 月
- **关联工程上下文**：stage-ai（自研 Web 视觉小说引擎，React 19 + Web Audio API + 服务端 TTS 预取管线 + LLM 流式自定义标签 DSL）
- **调研方法**：67 轮聚合网络搜索 + 25 轮网页正文抓取，覆盖引擎官方文档、社区 wiki、数据库实证、浏览器规范、TTS 厂商 API 文档

---

## 目录

- [0. 执行摘要](#0-执行摘要)
- [1. 语音在视觉小说层的「演出维度」全集](#1-语音在视觉小说层的演出维度全集)
  - [1.1 业界分类学：VNDB 的 Voice Acting 标签体系](#11-业界分类学vndb-的-voice-acting-标签体系)
  - [1.2 文本的发音体分型：出声台词 / 内心独白 / 旁白 / 无字语音](#12-文本的发音体分型)
  - [1.3 短促的非文字语音：Bark Lines 与 Dialogue Blips](#13-短促的非文字语音bark-lines-与-dialogue-blips)
  - [1.4 语音与背景音轨的动态关系：强调与闪避](#14-语音与背景音轨的动态关系强调与闪避)
- [2. 语音合成的生产流水线与工程参数空间](#2-语音合成的生产流水线与工程参数空间)
  - [2.1 主流 TTS 接口参数横向对照](#21-主流-tts-接口参数横向对照)
  - [2.2 情绪与语气标签：三种截然不同的表达范式](#22-情绪与语气标签三种截然不同的表达范式)
  - [2.3 Fish Audio S2 情绪标记全表](#23-fish-audio-s2-情绪标记全表)
  - [2.4 角色级偏差：语速、音高、韵律、留白](#24-角色级偏差语速音高韵律留白)
  - [2.5 发音词典与文本归一化（ITN）](#25-发音词典与文本归一化itn)
  - [2.6 长篇生产的一致性问题：音色漂移与 Style Locking](#26-长篇生产的一致性问题音色漂移与-style-locking)
  - [2.7 长文本切分策略与配额成本](#27-长文本切分策略与配额成本)
- [3. 语音与台词的对齐粒度与口型同步](#3-语音与台词的对齐粒度与口型同步)
  - [3.1 对齐粒度的四级抽象](#31-对齐粒度的四级抽象)
  - [3.2 口型同步的三条工业路线](#32-口型同步的三条工业路线)
  - [3.3 文本揭示与语音进度的同步](#33-文本揭示与语音进度的同步)
- [4. 语音驱动的播放节奏与交互时序](#4-语音驱动的播放节奏与交互时序)
  - [4.1 自动播放的时间计算模型](#41-自动播放的时间计算模型)
  - [4.2 语音未就绪时的降级与背压](#42-语音未就绪时的降级与背压)
  - [4.3 快进与点击跳过时语音的退场](#43-快进与点击跳过时语音的退场)
  - [4.4 跨行延续与回顾重听](#44-跨行延续与回顾重听)
- [5. 引擎实现解剖：Ren'Py / Naninovel / TyranoScript / KAG](#5-引擎实现解剖)
  - [5.1 Ren'Py 语音指令与配置面全集](#51-renpy-语音指令与配置面全集)
  - [5.2 Naninovel 语音指令与配置面全集](#52-naninovel-语音指令与配置面全集)
  - [5.3 TyranoScript / KAG 体系](#53-tyranoscript--kag-体系)
  - [5.4 其他引擎与工具链](#54-其他引擎与工具链)
  - [5.5 已知坑清单](#55-已知坑清单)
- [6. 浏览器侧：Web Audio 时序、缓存与成本控制](#6-浏览器侧web-audio-时序缓存与成本控制)
  - [6.1 双时钟模型与前瞻调度](#61-双时钟模型与前瞻调度)
  - [6.2 自动播放策略与解锁](#62-自动播放策略与解锁)
  - [6.3 解码、内存与台账](#63-解码内存与台账)
  - [6.4 缓存键设计与在途去重](#64-缓存键设计与在途去重)
  - [6.5 持久化缓存与配额淘汰](#65-持久化缓存与配额淘汰)
  - [6.6 流式 TTS 的前端适配](#66-流式-tts-的前端适配)
- [7. 面向 LLM 剧本的 DSL v2 语音指令空间](#7-面向-llm-剧本的-dsl-v2-语音指令空间)
  - [7.1 剧目级语音配置矩阵](#71-剧目级语音配置矩阵)
  - [7.2 指令与属性的取值空间](#72-指令与属性的取值空间)
  - [7.3 枚举封闭、缺省保持与静默降级](#73-枚举封闭缺省保持与静默降级)
  - [7.4 三个轴的独立性](#74-三个轴的独立性)
- [8. 本次未覆盖的空白](#8-本次未覆盖的空白)
- [9. 信源索引](#9-信源索引)

---

## 0. 执行摘要

本报告回答的问题：**在视觉小说这一层，语音到底有哪些「演出维度」是超出「一句话配一段音频」的？面向 LLM 产出的剧本 DSL，语音相关的指令应该有哪些、取值空间是什么、浏览器里的时序与缓存该怎么处理。**

四条主要发现：

1. **语音在 VN 里至少是五层语义，不是一层。** VNDB 用一个元标签 `Voice Acting (g402)` 挂了 12 个子标签来描述业界实况：主角全程配音（g135，2152 部）、主角部分配音（g774，464 部）、旁白配音（g836，213 部）、心声配音（g2088，380 部）、无文字纯语音段落（g1484，133 部）、语音收藏重听（g2358，121 部）、可更换声优（g3730）、强制「语音 or 字幕」二选一（g3858）、TTS 作为设定发声而非无障碍工具（g3686，57 部）等。这套标签是现成的行业词汇表——DSL 的取值空间可以直接从这里取，而不是凭空发明。

2. **「是否开启语音」在成熟引擎里从来不是布尔，而是三层正交结构。** Ren'Py 有 `config.has_voice`（剧目级硬开关）、`voice_tag` + `SetCharacterVolume` / `SetVoiceMute` / `ToggleVoiceMute`（角色级）、`preferences.volume.voice`（通道级）。Naninovel 有 `Enable Auto Voicing`（剧目级）、`authorId` 驱动的 per-author volume（角色级）、`Voice Group Path`（通道级）。把三者压成一个 `voice: on/off` 会丢掉「只配主角」「只配部分角色」「收藏重听」这些已被验证的表达力。

3. **自动模式的推进条件是「语音结束 + 缓冲垫」，不是字数。** Ren'Py 的 `preferences.wait_voice`（默认 True）+ `config.afm_voice_delay`（默认 0.5 秒）是行业事实标准；Naninovel 用 `Min Auto Play Delay`（1 秒）压阵；TyranoScript 社区文档直接写明 `[vo~]` 相比 `[playse]` 的最大优势就是「オートで進んだときに再生し終わるのを待ってくれる」。这三条独立来源指向同一个结论：语音是自动模式的主时钟。

4. **浏览器侧的时序问题是「双时钟」问题，不是「延迟」问题。** Web Audio 的硬件时钟（`AudioContext.currentTime`）与 JS 主线程时钟精度差几个数量级；主线程被 React 重渲染或 GC 阻塞时，`setTimeout` 驱动的播放会断链。可靠做法只有一条：短切片 + 用音频时钟绝对时间点预约 + 段间短斜坡消爆音。stage-ai 已落地的「共享 AudioContext + gapless 链式调度 + 背压滞回 + 快进淡出」正是这条路径的完整形态。

---

## 1. 语音在视觉小说层的「演出维度」全集

### 1.1 业界分类学：VNDB 的 Voice Acting 标签体系

VNDB 是全球最大的视觉小说数据库，其标签体系中 `Voice Acting` 被放在 `Tags > Style > Presentation > Sounds and Music` 路径下，是一个**元标签**（meta-tag，本身不能直接贴在作品上，只能挂子标签）。官方描述：

> This meta-tag is for housing the tags that detail how the voice acting is used in a game. If the protag has voice acting, does heroine lines only partially voiced, or does the game has every line voiced, including characters thoughts and all...
>
> （这个元标签用来收纳那些「配音在游戏里是怎么用的」的标签：主角有没有配音、女主角的台词是不是只配了一部分、还是包括角色心声在内的每一句都配了音……）

注意它列出的三问，恰好是 DSL v2 需要回答的三问：**谁配了**（角色维度）、**配多少**（覆盖度维度）、**配的是什么类型的文本**（文本类型维度）。

完整的子标签矩阵（数据取自 VNDB kana API 实时查询，2026-10-02；描述为原文翻译后的原义）：

| 标签 | ID | 作品数 | 定义（VNDB 原文要点） |
| :--- | :--- | :---: | :--- |
| Protagonist with Voice Acting | [g135](https://vndb.org/g135) | 2152 | 主角有配音。仅当主角**几乎全程**都在说话时使用本标签。 |
| Protagonist with Partial Voice Acting | [g774](https://vndb.org/g774) | 464 | 主角有配音，但**不常**配音。 |
| Changeable Voice Actors | [g3730](https://vndb.org/g3730) | 45 | 玩家可以在多个声优之间为某个或多个角色做选择。 |
| Japanese Voice Acting (For Non-OJLVNs) | [g3356](https://vndb.org/g3356) | 214 | 非日语 galgame 中的日语配音。 |
| Mandatory Choice Between Voices OR Subtitles | [g3858](https://vndb.org/g3858) | 13 | 有配音，但**强制**玩家在「有声音无字幕」与「有字幕无声音」之间二选一，不能同时要。 |
| Non-Japanese Voice Acting | [g2397](https://vndb.org/g2397) | 1949 | 至少含一种非日语配音；与有无日语配音无关。 |
| Protagonist with Voiced Changeable Names | [g3267](https://vndb.org/g3267) | 33 | 玩家给主角起的名字会被念出来。适用于手输名字与多选一名字两种情况。 |
| **Text to Speech Voices** | [g3686](https://vndb.org/g3686) | 57 | 游戏**刻意**用语音合成做配音。标注时要确认这是设计选择，而不是引擎自带的辅助功能（如 [Ren'Py 的 self-voicing](https://www.renpy.org/doc/html/self_voicing.html)）。 |
| Uncredited Voice Acting | [g3094](https://vndb.org/g3094) | 105 | 声优未署名或未经官方确认。 |
| Unoriginal Voice Acting | [g3759](https://vndb.org/g3759) | 10 | 非原创配音。 |
| **Voiced Default Name** | [g2126](https://vndb.org/g2126) | 332 | 允许改名的游戏里，如果玩家保持默认名，角色会**真的把主角名字念出来**；而不是给个泛称、只说「你」、或者在名字处尴尬地停一拍。 |
| **Voiced Narration** | [g836](https://vndb.org/g836) | 213 | 旁白被完整或至少大量配音。 |
| **Voiced Thoughts** | [g2088](https://vndb.org/g2088) | 380 | 角色的心声（通常用**括号**而非引号标注）被配音。**可能会有回声效果**以区别于心声与出声对话。注意不要与 g836 混淆。 |
| **Voice Only Parts** | [g1484](https://vndb.org/g1484) | 133 | 游戏包含**文本框不出现**、但角色在说话、剧情仍在推进的连续段落。多数日系游戏偶尔有脱离文本的配音，但本标签只用于这种情况以**整句、整场**为单位出现时。 |
| **Voice Saving** | [g2358](https://vndb.org/g2358) | 121 | 游戏提供**保存配音台词并随时重听**的功能。 |

（来源：[VNDB g402 页面](https://vndb.org/g402) + VNDB kana API 逐标签查询；完整子标签列表与计数见 g402 页面。）

**这 16 个标签里，只有 2 个（g3686 TTS、g2358 Voice Saving）直接映射到产品功能，其余 14 个都是「剧本层」的维度。** 对 DSL v2 而言可直接借鉴的剧本层维度至少有五条：

- **覆盖度**：全员 / 主角优先 / 主角部分 / 特定角色 / 无
- **文本类型**：出声台词 / 心声 / 旁白 / 无字
- **命名可发音性**：默认名是否被念出
- **段落级存在性**：允许「只有声音没有文字」的整段演出
- **可听性互斥**：是否强制语音/字幕二选一

### 1.2 文本的发音体分型

在 Ren'Py / Naninovel / TyranoScript 这类引擎里，**一行文本的「说话主体」本身就是一个正交维度**，而不只是「这行有没有配语音」。

TyranoScript 的场景文件语法把「谁在说」写成行首的 `#角色名`，然后台词作为正文；Ren'Py 用 `Character()` 绑定的角色对象作为 `say` 的第一个参数；Naninovel 则是 `@char` 声明演员 + 紧随其后的 `@print` 文本。三者的共同点是：**说话主体是显式声明的，因此「谁在说」天然可被作为语音配置的判定依据。**

行业里存在的四种发音体：

| 发音体 | 表达形式 | 是否通常配音 | 特殊处理 | 权威来源 |
| :--- | :--- | :--- | :--- | :--- |
| 出声台词（spoken dialogue） | `角色名「台词」` | 是 | 驱动口型 | 引擎默认路径 |
| 内心独白（thought） | 括号而非引号，如 `(我真是个笨蛋)` | 是（g2088，380 部） | **可能有回声效果**以区别于出声对话 | [VNDB g2088](https://vndb.org/g2088) |
| 旁白（narration） | 无角色名的叙述文本 | 少数（g836，213 部） | 常配一个独立「旁白音色」 | [VNDB g836](https://vndb.org/g836) |
| 无字语音（voice-only） | 文本框不出现，只有人声 | 是（g1484，133 部） | 需要一个「有声音但不显示文字」的演出指令 | [VNDB g1484](https://vndb.org/g1484) |

其中「心声可能有回声效果以区别于出声对话」是 VNDB 原文明确指出的视觉小说惯例——**这意味着心声在音频链路上不只是「另一个 speaker」，而是一条挂了效果器的独立支路**。

stage-ai 的 `ScriptLine` 已经有 `type: "say" | "narrate" | "thought"` 三态（`apps/web/src/stage/script.ts`），与上表前四分之三直接对齐。缺的只有第四态（无字语音）。

### 1.3 短促的非文字语音：Bark Lines 与 Dialogue Blips

[VNDev Wiki 的 Voice acting 页面](https://vndev.wiki/Voice_acting) 把「配音风格」分成三大类，其中两类的存在形式完全不是「一句话配一段音频」：

1. **Full Voice Acting（全程配音）** —— 每句都有音频。
2. **Partial Voice Acting（部分配音）**，下分两支：
   - **Bark Lines（短吼）** —— 独立于完整句子的短促发声。
   - **Character or Scene Focused（按角色或按场景集中）** —— 某些角色全程有，某些角色没有；或者某些场景有，某些场景没有。
3. **Dialogue Blips（对话哔哔声）** —— 打字机每吐一个（或几个）字符时发出的极短音效，用于给文字注入「有人正在说」的实感。

**Bark Lines 的工程意义**：一个句子本身没有音频，只在句首/句中插一段极短的角色音效（惊讶的「诶？！」、得意的「哼」、悲伤的抽泣）。这既是一种成本控制手段（短音频的合成与传输成本远低于整句），也是一种**演出语言**——它把「情绪」和「文本」解耦到了两条轨道上。

**Dialogue Blips 的工程意义**：它是纯打字的辅助通道，与语音通道**无关**。stage-ai 已有独立的 `SfxPlayer`（`apps/web/src/stage/loopAudio.ts`，`MAX_SFX=6` 挤掉最老），在概念上正好对应 blip 通道；但 DSL 里没有「给这行加 blip」的表达位。

### 1.4 语音与背景音轨的动态关系：强调与闪避

语音在混音里的特殊地位，成熟引擎都用「强调（emphasize）」机制处理。Ren'Py 把它做成了三个可配变量：

```python
define config.emphasize_audio_channels = [ 'voice' ]
define config.emphasize_audio_volume = 0.8
define config.emphasize_audio_time = 0.5
```

> A list of strings giving audio channel names. If the "emphasize audio" preference is enabled, when one of the audio channels listed starts playing a sound, all channels that are **not** listed in this variable have their secondary audio volume **reduced to `config.emphasize_audio_volume`** over `config.emphasize_audio_time` seconds. When no channels listed in this variable are playing audio, all channels that are not listed have their secondary audio volume raised to 1.0 over `config.emphasize_audio_time` seconds. For example, setting this to `[ 'voice' ]` will lower the volume of all non-voice channels when a voice is played.

（来源：[Ren'Py config.emphasize_audio_channels](https://www.renpy.org/doc/html/config.html)）

对应的玩家偏好是 `preferences.emphasize_audio`（默认 False）。

这个机制对浏览器实现的直接含义：**语音通道与 BGM/ambient 通道必须走两条独立的 Gain 路径，且非语音通道保留一个「secondary volume」可被语音事件实时改写**。stage-ai 的 `LoopChannel` 目前是「双通道交叉淡入淡出 + 50ms 步进调 volume」，没有 secondary volume 概念——这是把 Ren'Py 这条能力补齐时需要改的地方。

---

## 2. 语音合成的生产流水线与工程参数空间

### 2.1 主流 TTS 接口参数横向对照

| 引擎 | 语气/情绪控制形态 | 语速 | 音高 | 音量 | 发音覆盖 | 分段 | 特殊能力 | 来源 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Amazon Polly** | SSML：`<amazon:domain name="news">`（newscaster）、`<amazon:effect name="whispered">`、`<amazon:effect name="drc">`、`<amazon:effect phonation="soft">`、`<amazon:effect vocal-tract-length>`、`<amazon:auto-breaths>` | `<prosody rate>` | `<prosody pitch>` | `<prosody volume>` | `<lang>`、`<phoneme>`（IPA / X-SAMPA / x-amazon-pinyin / x-amazon-yomigana / x-amazon-pron-kana） | `<break time>`、`<mark>`、`<p>`、`<s>` | `<say-as>`、`<sub alias>`、`<w>`、`<amazon:max-duration>` | [supportedtags](https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html) |
| **ElevenLabs** | v3 **Audio Tags**：方括号自由文本，如 `[shouts]` `[worried]` `[rushed]` `[drawn out]` | 标点 + `[pause]`/`[rushed]`/`[drawn out]` 标签 | 由标签/文本表达 | 标签表达 | 70+ 语言 | 由模型自切 | 多说话人对话（`[overlapping]`）、打断（`—`） | [Audio Tags 101](https://elevenlabs.io/blog/v3-audiotags) |
| **Fish Audio S2** | 方括号自然语言标记，**64+** 个预置情绪/风格 + 自由文本 | `prosody.speed` | 由参考音频/标记 | `prosody.volume` | 13 种语言均支持情绪标记 | `chunk_length` | 参考音频（`reference_id`）、`normalize` 数字归一化 | [Emotion Control](https://docs.fish.audio/developer-guide/core-features/emotions) |
| **OpenAI TTS** | 自由文本 `instructions` 字段（如 `"Speak in a cheerful and positive tone."`） | — | — | — | 多语种 | 由模型切 | 极简 request 形状 | [Text to speech guide](https://developers.openai.com/api/docs/guides/text-to-speech) |
| **Google Cloud TTS** | SSML `<prosody>`、`<break strength>`、`<say-as>`、`<sub>`、`<audio>`、自定义发音词典 | `<prosody rate>` | `<prosody pitch>` | `<prosody volume>` | `<phoneme>`（IPA / X-SAMPA） | `<break>`、`<p>`、`<s>` | `<audio src>` 内嵌音频、自定义发音词典随请求下发 | [SSML reference](https://docs.cloud.google.com/text-to-speech/docs/ssml) |
| **Azure Speech** | SSML `<mstts:express-as style=... styledegree=... role=...>` | `<prosody rate>` | `<prosody pitch>` | `<prosody volume>` | `<voice name>` 多音色单文档 | `<break>` | 角色 role（Girl/Boy/老练） | [SSML voice](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-voice) |
| **VOICEVOX**（日系 TTS） | `speaker` + `style` 组合（预设矩阵） | `speed` | `pitch` | `volume` | — | — | `intonation`（抑扬）、`pre`/`post`（首尾留白） | [tyrano_voicevox_plugin](https://booth.pm/ja/items/6017687) |

**对 DSL 设计的直接结论**：行业里情绪控制存在三种互不兼容的形态——

1. **SSML 标签**（Polly / Google / Azure）：封闭枚举，跨厂商不通用。
2. **自由文本 instructions**（OpenAI）：开放，但无法枚举、无法校验。
3. **行内方括号标记**（ElevenLabs v3 / Fish Audio S2）：**封闭基线 + 自由扩展**——Fish Audio 明确写「Bracket cues can use natural language descriptions and are not limited to a fixed set of tags」，同时又给了 64+ 的预置表。

第 3 种是对 LLM 最友好的形态：**LLM 天然会写方括号标记**（这是训练数据里的自然语言直觉），引擎也天然能解析。这解释了为什么 Fish Audio 与 ElevenLabs 独立地走到了同一个设计上。

### 2.2 情绪与语气标签：三种截然不同的表达范式

#### 范式 A：SSML 封闭标签

Polly 的完整支持列表（[supportedtags](https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html)）：

| Action | SSML tag | Neural | Long-form | Generative |
| :--- | :--- | :--- | :--- | :--- |
| Adding a pause | `<break>` | 全 | 全 | 全 |
| Emphasizing words | `<emphasis>` | 不可用 | 不可用 | 不可用 |
| Specifying another language | `<lang>` | 全 | 全 | 全 |
| Placing a custom tag in your text | `<mark>` | 全 | 全 | 部分 |
| Adding a pause between paragraphs | `<p>` | 全 | 全 | 全 |
| Using phonetic pronunciation | `<phoneme>` | 全 | 全 | 部分 |
| **Controlling volume, speaking rate, and pitch** | `<prosody>` | 部分 | 部分 | 部分 |
| Setting a maximum duration | `<prosody amazon:max-duration>` | 不可用 | 不可用 | 不可用 |
| Adding a pause between sentences | `<s>` | 全 | 全 | 全 |
| Controlling special types of words | `<say-as>` | 部分 | 全 | 全 |
| Identifying SSML-enhanced text | `<speak>` | 全 | 全 | 全 |
| Pronouncing acronyms and abbreviations | `<sub>` | 全 | 全 | 全 |
| Improving pronunciation by parts of speech | `<w>` | 全 | 全 | 全 |
| Adding the sound of breathing | `<amazon:auto-breaths>` | 不可用 | 不可用 | 不可用 |
| Newscaster speaking style | `<amazon:domain name="news">` | 选部分 neural | 不可用 | 不可用 |
| Adding dynamic range compression | `<amazon:effect name="drc">` | 全 | 全 | 不可用 |
| Speaking softly | `<amazon:effect phonation="soft">` | 不可用 | 不可用 | 不可用 |
| **Controlling timbre** | `<amazon:effect vocal-tract-length>` | 不可用 | 不可用 | 不可用 |
| **Whispering** | `<amazon:effect name="whispered">` | 不可用 | 不可用 | 不可用 |

> If you use unsupported SSML tags in standard, neural, or long-form format, you will get an error.

**注意最后一句**——不支持的标签是**硬错误**，不是静默降级。这对 DSL 编译期校验是个明确的信号：语法层必须先做白名单过滤，不能把原文直接甩给引擎。

#### 范式 B：自由文本 instructions

OpenAI 的接口形状（[官方 guide](https://developers.openai.com/api/docs/guides/text-to-speech)）：

```js
const speechFile = path.resolve("./speech.mp3");
const mp3 = await openai.audio.speech.create({
  model: "gpt-4o-mini-tts",
  voice: "coral",
  input: "Today is a wonderful day to build something people love!",
  instructions: "Speak in a cheerful and positive tone.",
});
```

`instructions` 是一整段自然语言。优点是零枚举负担；缺点是**同一个 `instructions` 在不同上下文可能产出不同结果**，且无法在编译期校验。

#### 范式 C：行内方括号标记

ElevenLabs v3 的 Audio Tags 按类别组织（[Audio Tags 101](https://elevenlabs.io/blog/v3-audiotags)）：

> Tags range across a few categories, such as **emotions, delivery and pacing, human reactions, accents, and sound effects**.

官方明确对比了 SSML：

> Eleven v3 doesn't support SSML break tags or the rest of the SSML tag set. Instead, Audio Tags, punctuation, and the very fabric of a text's structure take over the role.
>
> （对照表里把 SSML 的 `<break>` 映射到 v3 的对应标签；文档原话：From a writer's perspective, adding `[whispers]` to a line takes much less effort than configuring a prosody rate.）

多说话人对话的示例（原文引用）：

```
Emma: [overlapping] [annoyed] —I think you need to go home.
```

`[overlapping]` 是专门为「两个角色同时说话」设计的标签——这是一个**纯演出层概念，TTS 侧不关心但 VN 层关心**的典型例子。

### 2.3 Fish Audio S2 情绪标记全表

这是目前公开的、**唯一一个提供了完整可枚举清单**的方括号情绪体系（stage-ai 当前用的就是 Fish Audio S2.1）。清单取自 [docs.fish.audio 官方文档](https://docs.fish.audio/developer-guide/core-features/emotions) 对应的仓库源码片段（`fishaudio/docs` 的 `snippets/emotion-list-*.mdx`）。

官方声明：**64+ emotional expressions and voice styles**。按实际表格数是 24 + 25 + 6 + 11 + 5 = **71 个**。

#### 基础情绪（24 个，Basic Emotions）

| 情绪 | 标记 | 描述 | 典型场景 |
| :--- | :--- | :--- | :--- |
| Happy | `[happy]` | 欢快、雀跃 | 好消息、打招呼 |
| Sad | `[sad]` | 忧郁、低落 | 同情、坏消息 |
| Angry | `[angry]` | 恼怒、攻击性 | 抱怨、警告 |
| Excited | `[excited]` | 有活力、兴奋 | 宣布、庆祝 |
| Calm | `[calm]` | 平和、放松 | 指示、冥想 |
| Nervous | `[nervous]` | 焦虑、不确定 | 免责、道歉 |
| Confident | `[confident]` | 果断、自信 | 演讲、销售 |
| Surprised | `[surprised]` | 震惊、惊奇 | 反应、发现 |
| Satisfied | `[satisfied]` | 满足、愉悦 | 确认、评价 |
| Delighted | `[delighted]` | 非常开心 | 庆祝、称赞 |
| Scared | `[scared]` | 害怕、恐惧 | 警告、恐怖故事 |
| Worried | `[worried]` | 担忧、不安 | 顾虑、疑问 |
| Upset | `[upset]` | 心烦、 distress | 抱怨、问题 |
| Frustrated | `[frustrated]` | 恼火、ennervated | 技术问题、延误 |
| Depressed | `[depressed]` | 非常悲伤、绝望 | 严肃话题 |
| Empathetic | `[empathetic]` | 理解、关怀 | 安慰、咨询 |
| Embarrassed | `[embarrassed]` | 羞愧、尴尬 | 道歉、失误 |
| Disgusted | `[disgusted]` | 反感、厌恶 | 负面评价 |
| Moved | `[moved]` | 被打动 | 动情时刻 |
| Proud | `[proud]` | 自豪、成就 | 成就、赞扬 |
| Relaxed | `[relaxed]` | 轻松、随意 | 随意对话 |
| Grateful | `[grateful]` | 感谢、感激 | 谢谢、感谢 |
| Curious | `[curious]` | 好奇、有兴趣 | 提问、探索 |
| Sarcastic | `[sarcastic]` | 讽刺、嘲讽 | 幽默、批评 |

#### 高级情绪（25 个，Advanced Emotions）

| 情绪 | 标记 | 描述 | 典型场景 |
| :--- | :--- | :--- | :--- |
| Disdainful | `[disdainful]` | 蔑视、鄙夷 | 批评、拒绝 |
| Unhappy | `[unhappy]` | 不满、不悦 | 抱怨、反馈 |
| Anxious | `[anxious]` | 非常担忧、不安 | 紧急事务 |
| Hysterical | `[hysterical]` | 失控的情绪化 | 极端反应 |
| Indifferent | `[indifferent]` | 漠不关心、中立 | 中立回应 |
| Uncertain | `[uncertain]` | 怀疑、不确定 | 推测、提问 |
| Doubtful | `[doubtful]` | 怀疑的、质问的 | 不信、质问 |
| Confused | `[confused]` | 困惑、迷茫 | 需要澄清 |
| Disappointed | `[disappointed]` | 失望、不满 | 期望落空 |
| Regretful | `[regretful]` | 后悔、歉意 | 道歉、失误 |
| Guilty | `[guilty]` | 内疚、有责 | 认错、道歉 |
| Ashamed | `[ashamed]` | 深度羞愧 | 严重失误 |
| Jealous | `[jealous]` | 嫉妒、怨恨 | 比较 |
| Envious | `[envious]` | 羡慕、想要 | 带着渴望的欣赏 |
| Hopeful | `[hopeful]` | 对未来乐观 | 未来计划 |
| Optimistic | `[optimistic]` | 正面展望 | 鼓励 |
| Pessimistic | `[pessimistic]` | 负面展望 | 警告、怀疑 |
| Nostalgic | `[nostalgic]` | 怀念过去 | 回忆、故事 |
| Lonely | `[lonely]` | 孤独、寂寞 | 情感内容 |
| Bored | `[bored]` | 无聊、疲惫 | 不感兴趣 |
| Contemptuous | `[contemptuous]` | 蔑视 | 强烈批评 |
| Sympathetic | `[sympathetic]` | 同情 | 慰问 |
| Compassionate | `[compassionate]` | 深切关怀 | 支持、帮助 |
| Determined | `[determined]` | 决心、果断 | 目标、承诺 |
| Resigned | `[resigned]` | 接受失败 | 放弃、接受 |

#### 语气标记（6 个，Tone Markers）

| 语气 | 标记 | 描述 | 何时用 |
| :--- | :--- | :--- | :--- |
| Hurried | `[in a hurry tone]` | 匆忙、急迫 | 时间敏感的信息 |
| Shouting | `[shouting]` | 大声、呼喊 | 引起注意 |
| Screaming | `[screaming]` | 极响、惊慌 | 紧急、恐惧 |
| Whispering | `[whispering]` | 极轻、秘密 | 秘密、安静场景 |
| Soft | `[soft tone]` | 温和、轻声 | 安慰、摇篮曲 |
| Emphasis | `[emphasis]` | **重音强调某个词/短语** | 突出关键词 |

`[emphasis]` 的用法特殊：文档写「Place `[emphasis]` right before the word or phrase you want to stress」——它是**位置相关的**，不是整句属性。

#### 音频效果（11 个，Audio Effects）

| 效果 | 标记 | 描述 | 建议配套文本 |
| :--- | :--- | :--- | :--- |
| Laughing | `[laughing]` | 大笑 | Ha, ha, ha |
| Chuckling | `[chuckling]` | 轻笑 | Heh, heh |
| Sobbing | `[sobbing]` | 抽泣 | 可选 |
| Crying Loudly | `[crying loudly]` | 痛哭 | 可选 |
| Sighing | `[sighing]` | 释然/挫败的叹气 | sigh |
| Groaning | `[groaning]` | 挫败的呻吟 | ugh |
| Panting | `[panting]` | 气喘吁吁 | huff, puff |
| Gasping | `[gasping]` | 倒吸凉气 | gasp |
| Yawning | `[yawning]` | 打哈欠 | yawn |
| Snoring | `[snoring]` | 打鼾 | zzz |
| Clear Throat | `[clear throat]` | 清嗓子 | ahem |

#### 特殊效果（5 个，Special Effects）

| 效果 | 标记 | 描述 |
| :--- | :--- | :--- |
| Audience Laughter | `[audience laughing]` | 观众笑声 |
| Background Laughter | `[background laughter]` | 背景笑声 |
| Crowd Laughter | `[crowd laughing]` | 大群体笑声 |
| Short Pause | `[break]` | 短暂停顿 |
| Long Pause | `[long-break]` | 延长停顿 |

#### 使用规则（官方 Best Practices，直接影响 DSL 校验）

> **Placement Rules (For S2)**
> - Sentence-level emotion cues usually work best **at the beginning of sentences**
> - Tone controls can go anywhere in the text
> - Sound effects can go anywhere in the text
> - Bracket cues can use natural language descriptions and are not limited to a fixed set of tags

> **Do's**
> - Use **one primary emotion per sentence**
> - Test different emotion combinations
> - Match emotions to context logically
> - Add appropriate text after sound effects
> - Use natural expressions when possible
> - Space out emotional changes for realism

> **Don'ts**
> - Don't overuse emotion tags in short text
> - Don't mix conflicting emotions
> - Don't make bracket descriptions so long that they interrupt readability
> - Don't forget brackets
> - Don't place sentence-level emotion cues far from the sentence they control

> **Performance Notes**
> - Emotion markers don't count toward token limits
> - No additional latency for emotion processing
> - All emotions available on all pricing tiers
> - **Maximum of 3 combined emotions per sentence recommended**

> **Troubleshooting: S1 vs S2 语法差异**
> - **S2-Pro / S2.1-Pro**：`[bracket]` 方括号，自由自然语言
> - **S1（legacy）**：同样的情绪名，但必须用 `(parentheses)` 圆括号，且是固定标签集

**这段「最佳实践」是 DSL 设计的直接输入**：
- 「一句一个主情绪」→ 编译器可以校验：一行 `<say>` 最多接受 N 个情绪属性。
- 「句级情绪放句首」→ 情绪应作为**句子级属性**而不是内联在文本里。
- 「不要混用冲突情绪」→ 可以定义冲突表做静态校验。
- 「最多 3 个组合情绪」→ 取值空间有上界。

### 2.4 角色级偏差：语速、音高、韵律、留白

角色级音色库（stage-ai 的 `VoiceLibrary`）解决的是「谁在发声」，但一个角色在不同场景下还需要微调。

**VOICEVOX 的 preset 模型是最完整的参数化范例**。来自 [tyrano_voicevox_plugin 的 BOOTH 页面](https://booth.pm/ja/items/6017687) 的实际配置：

```
; VOICEVOXのプリセットを作成(話速、音程、音量などを指定する)
[voicevox_preset id="zunda_normal" speed="1.3" pitch="0.05" intonation="1.1" volume="1.5" pre="0.1" post="0.1"]
[voicevox_preset id="zunda_slow"   speed="1.3" pitch="0.05" intonation="1.1" volume="1.5" pre="0.1" post="0.1"]

; キャラクターの音声登録 & 使用プリセットの指定
[voicevox_chara name="zunda" speaker="ずんだもん" style="ノーマル" preset="zunda_normal"]
```

完整参数集：**speed（语速）、pitch（音高）、intonation（抑扬）、volume（音量）、pre（发音前留白）、post（发音后留白）**。同一个插件还演示了**句中切换**：

```
[voicevox_chara name="zunda" style="あまあま"]   ; 句中切 style
[voicevox_chara name="zunda" preset="zunda_slow"] ; 句中换 preset
[voicevox_ruby text="VOICEVOXの読み上げテキストを指定できるよ"]  ; 显示文本与朗读文本分离
```

其中 `[voicevox_ruby]` 是一个**极高价值的发现**：它让「屏幕上显示的文本」与「送进 TTS 的文本」分离。VNDB 的 g3267（Protagonist with Voiced Changeable Names，33 部）与 g2126（Voiced Default Name，332 部）本质上就是 ruby 语法的商业化形态——名字是一个 TTS 前替换变量。

**PSY 谱系**（Polly/Azure/Google）的等价参数则是 SSML 属性：`<prosody rate="+10%" pitch="-2st" volume="+2dB">`。Polly 额外提供 `<amazon:effect vocal-tract-length>`（声道长度，音色）与 `<amazon:effect phonation="soft"`（软发声），但两者在 neural / generative 音色上都标注为「不可用」。

**Fish Audio** 的对应参数是 `prosody: { speed, volume }`（API 层面），情绪与音色靠 `reference_id` + 文本标记。

**结论**：行业里存在两层偏差——**角色级（voice library entry 上）** 与 **语句级（单次合成请求上）**。两者应该分开建模，不要混成一片。

### 2.5 发音词典与文本归一化（ITN）

发音问题在中文/日文 galgame 里尤其突出。业界的解法分三层：

#### 层 1：引擎级音素覆盖

Amazon Polly 的 `<phoneme>` 支持五种字母表（[官方文档](https://docs.aws.amazon.com/polly/latest/dg/phoneme-tag.html)）：

```xml
<!-- IPA -->
<speak>You say, <phoneme alphabet="ipa" ph="pɪˈkɑːn">pecan</phoneme>.</speak>

<!-- X-SAMPA -->
<speak>You say, <phoneme alphabet='x-sampa' ph='pI"kA:n'>pecan</phoneme>.</speak>

<!-- 中文：Pinyin -->
<speak>你说 <phoneme alphabet="x-amazon-pinyin" ph="bo2">薄</phoneme>。</speak>

<!-- 日文：Yomigana / Pronunciation Kana -->
<speak>名前は<phoneme alphabet="x-amazon-yomigana" ph="ヒロカズ">浩一</phoneme>です。</speak>
<speak>名前は<phoneme alphabet="x-amazon-pron-kana" ph="ヒロ'カズ">浩一</phoneme>です。</speak>
```

日文特有三套（yomigana / pron-kana / IPA），中文有拼音——这不是「参数」，而是**每种语言要单独接的表**。

#### 层 2：请求级自定义发音词典

Google Cloud TTS 支持随请求下发发音词典：

> As an alternative to providing pronunciations inline with the `phoneme` tag, provide a dictionary of custom pronunciations in the speech synthesis RPC. When the custom pronunciation dictionary is in the request, the input text will automatically be transformed with the SSML `phoneme` tag.
>
> （作为逐个内联 `<phoneme>` 的替代方案，可以在合成 RPC 里下发自定义发音词典。字典在请求中时，输入文本会被自动改写成带 `<phoneme>` 的等价形式。）

#### 层 3：文本级替换表（Ren'Py 的 `config.tts_substitutions`）

这是**最贴近 LLM 生成场景**的一层。[Ren'Py config 文档](https://www.renpy.org/doc/html/config.html)：

```python
define config.tts_substitutions = [ ]
```

> This is a list of (pattern, replacement) pairs that are used to perform substitutions on text before it is passed to the text-to-speech engine, so that the text-to-speech engine can pronounce it correctly. Patterns may be either strings or regular expressions, and replacements must be strings. **If the pattern is a string, it is escaped, then prefixed and suffixed with `r'\b'` (to indicate it must begin and end at a word boundary), and then compiled into a regular expression. If the pattern is a regular expression, it is used as-is, and the replacement is not escaped. The substitutions are performed in the order they are given. If a substitution matches the string, the match is checked to see if it is in title case, upper case, or lower case; and if so the corresponding casing is performed on the replacement.** Once this is done, the replacement is applied. For example: `define config.tts_substitutions = [ ("Ren'Py", "Ren Pie"), ]` Will cause the string "Ren'Py's pronounced ren'py." to be voiced as if it were "Ren Pie's pronounced ren pie."

三个工程细节值得注意：
- 字符串 pattern 自动加 `\b` 词边界约束（避免 `AI` 命中 `said`）。
- **大小写自适应**（title case / upper / lower 会被保留）——对英文缩写词典至关重要。
- 按顺序应用，允许后面的规则处理前面规则的输出。

#### 层 4：数字归一化

Google 的 `<say-as>` 提供了一整套 interpret-as 取值：`currency` / `telephone` / `verbatim`(spell-out) / `date` / `characters` / `cardinal` / `ordinal` / `fraction` / `expletive`(bleep) / `unit` / `time`，其中 `date` 与 `time` 还带 `format`（`yyyymmdd`、`dmy`、`hms12` 等字段码）。

Fish Audio 用一个 API 开关替代了整套标记：

```json
{ "text": "...", "normalize": true }
```

文档同时强调要避开 SSML 保留字符（`"`、`&`、`'`、`<`、`>`），否则会被读成代码。

**对 stage-ai 的意义**：LLM 写的台词里必然出现 `2026年`、`3,000円`、`第2章`、`AI`、`OK`、emoji、省略号。TTS 编译器在把文本交给 Fish Audio 之前，必须有一层与 `config.tts_substitutions` 等价的预处理。stage-ai 的 `PhraseChunker`（`packages/core/src/speech/chunker.ts`）目前只做分句，不做归一化——这是缺口。

### 2.6 长篇生产的一致性问题：音色漂移与 Style Locking

多角色、长篇目的 AI 配音有一个人尽皆知但很少被文档化的问题：**同一角色的不同句子听起来像不同的人。**

社区实践的两种应对（来自 dev.to 与 IndexTTS2 相关讨论）：

1. **Style Locking（风格锁定）** —— 冻结交付参数（语速、情绪强度）而不只是锁 voice ID，保证同角色跨批次一致。原文（[Versely](https://www.versely.studio/blog/style-locking-ai-text-to-speech-2026)）：

   > It is not the same as cloning a person's voice. You lock style when a series, course, or channel needs one narrator feel without retraining a clone every batch. Style locking pins performance (**pace, pitch, and energy**), not just which voice ID you picked.

2. **Vector Anchors（向量锚定）** —— [dev.to 的实践记录](https://dev.to/lcmd007/from-stochastic-drifting-to-vector-anchors-how-i-solved-voice-consistency-in-qwen-tts-4dff) 描述了不用 seed 而是用向量约束的做法：

   > Stop relying on seeds. Learn how to implement deterministic persona via vector constraints. … the 72 hours of trial and error … solving a problem that has been a nightmare for many: Cross-sentence voice stability.

3. **TTS → RVC 后处理** —— [RVC in the Stack](https://blog.veydh.com/2026/2026-04-rvc-voice-conversion-architecture) 描述了「先 TTS 出表现力，再 RVC 强制映射到目标音色」的两段式管道：

   > Retrieval-based Voice Conversion (RVC) maps audio from one timbre toward another using models trained on target-speaker data. It is not a text front-end: it consumes waveforms. That is why the common assistant pattern chains TTS → RVC when you want machine-generated speech to resemble a specific voice embedding learned from clean clips.

   还有社区总结的「双层结构」（[GPT-SoVITS 相关调研](https://github.com/xgx042375/AI-BOT-Life/blob/main/docs/%E8%B0%83%E7%A0%94-%E8%AF%AD%E9%9F%B3%E6%83%85%E7%BB%AA%E5%8A%A8%E6%80%81%E8%B0%83%E5%8F%82-2026-09-11.md)）：

   > 社区确实是「参考音频管情绪方向、动态参数管能量与稳定」的双层结构 ——GPT-SoVITS 官方明确说过 embedding 式情绪…

**对 stage-ai 的意义**：`apps/server/src/tts.ts` 的缓存键是 `sha1(voiceId + "\0" + text)`。这保证了「同句重演不烧配额」，但**没有保证「同角色不同句的音色一致」**——后者需要角色级参数固定（seed / temperature / prosody 全部锁在角色卡上）。缓存键里也缺 `mood`（一旦 DSL 支持情绪，情绪必须进键，否则改了情绪会命中旧音频）。

### 2.7 长文本切分策略与配额成本

切分策略对配额和音质有双重影响。

Deepgram 的 [Text Chunking for TTS](https://developers.deepgram.com/docs/text-chunking-for-tts-optimization) 给出了三级递进策略：

1. **按最大字符数硬切** —— 简单，不考虑文本结构。
2. **按从句与句子边界切** —— 正则识别 `.` `?` `!` `;`，以及「逗号 + 单空格 + 并列连词（and, but, or, nor, for, yet, so）」这一语法规则。文档原话：

   > In this example, the aim is to preserve naturalness of speech by chunking the text based on clause and sentence boundaries. When people speak, they tend to pause at the end of a clause or a sentence, so this strategy is helpful when working with texts that contain complex sentences in a narrative style.

3. **动态切分** —— 保留第 2 条的边界规则，但逐块检查字符数，超限时**再按逗号二次切分，且子块不小于 3 个字符**。

文档列出的注意事项：保持自然度（发音、语调、节奏）、上下文理解（找自然断点）、动态调整块大小、考虑用户预期。

一个第三方长文本分析（[seed-audioai](https://seed-audioai.com/blog/text-to-speech-long-text)）还给出了一条常被忽略的告警：

> ⚠️ … dialogue with multiple speakers — **4,000-byte combined dialogue cap and silent truncation past approximately 655 seconds**.

「静默截断」是最危险的失败模式——返回 200，但音频缺尾巴。stage-ai 现有的 `PhraseChunker` 应对的正是这一层（分句级 TTS + gapless 拼接），方向正确。

**配额侧的两个已知实践**：
- Deepgram 的批量 TTS 指南（[batch-text-to-speech-scalable-voice-generation-guide](https://deepgram.com/learn/batch-text-to-speech-scalable-voice-generation-guide)）声称合理的批处理架构可削减 40–60% 的 TTS 成本。
- ElevenLabs 的延迟优化文档（[latency-optimization](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization)）指出**音色选择本身影响延迟**，从快到慢：default/premade/synthetic/IVC → PVC；更高质量的输出格式也会增加延迟。

---

## 3. 语音与台词的对齐粒度与口型同步

### 3.1 对齐粒度的四级抽象

| 粒度 | 定义 | 典型实现 | 优点 | 代价 |
| :--- | :--- | :--- | :--- | :--- |
| **行级** | 一条台词 ↔ 一个音频文件 | Ren'Py `voice "x.ogg"` + `say`；Naninovel `@voice` + `@print` | 引擎侧最简单，缓存与统计最粗 | 长句合成慢、点击跳过浪费整段 |
| **句级** | 一条台词内的自然短语 ↔ 一个音频文件 | 标点切分后逐片合成 | 延迟低、可局部丢弃、可流式续播 | 需处理片间接缝与节奏对齐 |
| **词级** | 一个词 ↔ 时间戳 | 强制对齐（Montreal Forced Aligner 一类）；TTS 原生返回词时间戳 | 打字机与语音严格同步；Karaoke 式高亮 | 需要额外的对齐产物与传输 |
| **音素级** | 一个音素/viseme ↔ 时间戳 | Rhubarb Lip Sync；Sinsy； talking-head-anime | 精确口型（Live2D / 3D 模型） | 成本最高，2D 立绘通常不值得 |

Ren'Py 与 Naninovel 都提供了**从行级切到 ID 级自动关联**的机制，这实际上是一种「隐式行级」：

**Ren'Py Automatic Voice**（[官方文档](https://www.renpy.org/doc/html/voice.html)）：

> This is done by creating voice files that match the identifier for each line of dialogue. To determine the identifiers to use, first export the dialogue to a spreadsheet by choosing from the launcher "Extract Dialogue", "Tab-delimited Spreadsheet (dialogue.tab)", and "Continue".
>
> To make Ren'Py automatically play voices, set `config.auto_voice` to a string containing `{id}`.

```python
config.auto_voice = "voice/{id}.ogg"
# 对话 id 为 demo_minigame_03fc91ef 时，引擎去找 voice/demo_minigame_03fc91ef.ogg，存在就播
```

`config.auto_voice` 还可以是一个**函数**（接收对话 id，返回文件名），这是扩展自定义命名规则的官方接口。

**Naninovel Auto Voicing**（[官方文档](https://naninovel.com/guide/voicing)）有一个更重要的补充警告：

> NOTE The `@voice` commands are intended to occasionally play voice clips at specific moments and are **not suited for implementing a complete voiceover**; see the "Auto Voicing" section below… **Some built-in features (e.g., replay voice in backlog, voiceover documents, etc.) work only with the auto voice workflow.**

以及去重机制：

> If the same author has identical text messages (in the same script), both messages will be associated with the same voice clip. If that is not desired, add a unique text identifier to one of the messages, e.g.:
> ```
> Hello.
> Hello.|#uniqueid|
> ```

**「重复台词共用同一段语音」是一个必须提前决策的设计点。** LLM 写剧本时，重复短句（「嗯。」「好。」）极其常见；stage-ai 现有的内容寻址缓存（`sha1(voiceId + text)`）天然选择了「共用」路线，但缓存键不含 seq，所以**改写后的同文本会静默复用旧音频**——这既是省配额的优势，也是潜在 bug 源（同一句在不同上下文情绪不同时会串音）。

### 3.2 口型同步的三条工业路线

#### 路线 A：文本驱动（最原始，也最常用）

说话时打开嘴，文字打完闭嘴。无需任何音频分析。问题是语音明显长于打字机时会出现「嘴已经闭了但还在说」。

#### 路线 B：音量包络驱动（Ren'Py 社区主流）

[Auto-LipSync for Ren'Py](https://jaybe-games.itch.io/automatic-anime-lipsync-plugin-for-renpy) 的描述：

> It reads your voice-over files **on the fly**, figures out exactly how loud or quiet they are, and automatically switches your character's mouth between [states].

日文侧对应的社区插件（[ボイス再生機能拡張プラグイン](https://note.com/skt_order/n/nb85f985e028a)）：

> 再生中の音声の音量に応じて口パク等のアニメーションを行います。キャラクター差分パーツ機能と一緒に使います。同一キャラ複数パーツの同時アニメーションには対応し[ない]…
>
> （根据播放中音频的音量做口型等动画，配合角色差分部件功能使用。不支持同一角色多个部件的同时动画……）

**这条路线在浏览器端的实现成本极低**：一个 `AnalyserNode` + 一个 RMS 阈值映射到嘴部差分（closed / mid / open）。stage-ai 已有 `expression` 属性驱动差分，加一个由语音能量驱动的 expression 覆盖是自然延伸。

#### 路线 C：音素识别（Rhubarb 路线）

[Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync)：

> analyzes your audio files, recognizes what is being said, then automatically generates lip sync information. You can use it for animating speech in computer games, animated cartoons, or any similar project.

第三方教程（[hysenlabs](https://hysenlabs.com/projects/danielswolf-rhubarb-lip-sync)）补充：

> writes out mouth-shape data for **six to nine standard 2D mouth positions**. It is a CLI first, with integrations for After Effects, Moho, OpenToonz, Spine and Vegas Pro.

`wiki.visionaire-tracker.net` 的教程则给出了完整的嘴型表（A–H 共 8 型）与帧序对应。

**这条路线需要离线预处理**，对「LLM 实时产出台本 → 立即播出」的 stage-ai 流程不成立（音频是未来才有的）。但对**已完成的剧目批量补口型**（例如作品定稿后跑一遍离线任务）成立。

#### 日文引擎的内置解法：预烘焙差分

[TyranoScript 的目パチ・口パク機能](https://tyrano.jp/usage/tech/pachi) 走的是另一条路：**不分析语音，而是预烘焙差分图**。要求准备三张差分图：

- 目パチ（眨眼）：`open.png` / `mid.png` / `close.png`
- 口パク（口型）：同构的三张

文档明确要求**所有差分图与 base 图同分辨率**。这套方案的自动版本是：`[voconfig]` 里已经为每个角色配了 `vostorage="t/t{number}.ogg"`，引擎在触发语音的同时就能按序号同步切到对应口型差分——**因为语音与口型都是预制的，天然同步**。这对 TTS 实时生成不适用（口型差分无法预生成），但对「已定稿 + 离线补图」的工作流是一条成熟路径。

### 3.3 文本揭示与语音进度的同步

打字机与语音的关系有三种可选策略（这是 VN 的经典分歧点）：

1. **语音主导打字机**：按语音时长倒推打字机速度，让文字与语音同步抵达行尾。优点是完美同步；缺点是需要先拿到完整音频时长，与「流式合成」冲突。
2. **打字机主导语音**：文字正常速度吐，语音跟着播。多数作品的默认行为。
3. **文字先行、语音追上**（stage-ai 当前形态）：行开始时若语音未就绪，先静音上文字，语音解码完成后中途跟进。

Ren'Py 侧有一个直接相关的配置：`config.afm_characters`（默认 250）——「The number of characters in a string it takes to cause the amount of time specified in the auto forward mode preference to be delayed before auto forward mode takes effect」（长句会额外延迟），以及 `config.afm_bonus = 25`（「The number of bonus characters added to every string when auto-forward mode is in effect」）。这说明**Ren'Py 的自动模式默认就是「字数模型」，语音只是叠加一个「不打断」约束**——而不是替代。

---

## 4. 语音驱动的播放节奏与交互时序

### 4.1 自动播放的时间计算模型

[VNDev Wiki - Autoplay](https://vndev.wiki/Autoplay) 列出了业界用来决定「这一行显示多久」的全部因子（原文枚举）：

> - A **per-character delay**, so longer text is shown for longer than shorter text. This delay might be set directly by the player or developer, or it might be calculated from a "characters per second" variable.
> - A **fixed delay**, independent of the length of the text, to make sure really short texts still get shown long enough to be read comfortably.
> - **Additional fixed delays in response to sprite changes**, expression changes, CGs, or other visual changes that might give the player a reason to look a bit more closely before the text changes again.
> - A **per-word delay** might be available in some engines.
> - **Additional delays on punctuation marks.**
> - Additional variable delays might be applied when the text contains **uncommon words or characters**, especially the first time they appear in the game.
> - **If there's voice acting, the duration of the voice lines might be used directly or as a factor in deciding when to advance the text.**
>
> Since people would rather wait a fraction of a second too much than a fraction of a second too little, it's probably a good idea to keep the default speed a bit slow. **A possible initial value could be 8 characters per second plus a 1.5 second length-independent delay.**

注意「If there's voice acting, the duration of the voice lines might be used **directly or as a factor**」——两条路线都存在。

Ren'Py 选的是**「直接」+ 缓冲垫**：

```python
# preferences.wait_voice
# If True, auto-forward mode will wait for voice files and self-voicing to finish
# before advancing. If False, it will not.
preferences.wait_voice = True

# config.afm_callback
# If not None, a Python function that is called to determine if it is safe to auto-forward.
# If None, an internal function is used to **disable auto-forwarding when a voice is playing**,
# unless `preferences.wait_voice` is set to False.
config.afm_callback = None

# config.afm_voice_delay
# The number of seconds after a voice file finishes playing before AFM can advance text.
config.afm_voice_delay = .5
```

（来源：[Ren'Py config.html](https://www.renpy.org/doc/html/config.html) 与 [preferences.html](https://www.renpy.org/doc/html/preferences.html)）

**`config.afm_voice_delay = 0.5` 就是「语音结束后还要停半秒」这条工业标准的权威出处。**

Naninovel 的对应配置（[configuration 指南](https://naninovel.com/guide/configuration)）：

| 属性 | 默认值 | 说明 |
| :--- | :--- | :--- |
| Default Skip Mode | Read Only | 首次启动时的默认跳过模式 |
| **Skip Time Scale** | **10** | 快进模式的时间缩放，设为 1 可禁用变速快进 |
| **Min Auto Play Delay** | **1** | auto play 模式下执行下一条指令前的**最小**等待秒数 |
| Complete On Continue | True | 激活 Continue 输入时是否立即完成阻塞型 wait 指令 |
| Wait By Default | False | 未显式指定 `wait` 参数时是否等待 |
| **Skip Print Delay** | **0** | 大于 0 时，每条 print 指令会在快进模式下等待指定秒数（不缩放）——「用来把快进速度降下来」 |
| Max Auto Wait Delay | 0.02 | auto play 下每个字符的等待延迟上限 |
| Scale Auto Wait | True | 是否按 print 指令的 reveal speed 缩放 auto play 等待时间 |

TyranoScript 侧则是**靠标签选择**而非全局开关——[ごいしはまぐりのボイス再生まとめ](https://www.goihama.games/2469/) 里作者明确对比了两种标签：

> `[vo～]` の良いところ：**オートで進んだときに再生し終わるのを待ってくれる。**
> これは本当に重要でボイスが入っていてオートする機能を組み込む作品の場合は必須在这儿.);
> `[playse]` は再生終了を待ってくれないので、しゃべっている途中で次に進んでしまいます。
>
> （`[vo~]` 的优点：**自动推进时会等语音播完。** 这非常重要，作品里有语音又要加自动模式时几乎是必需的。`[playse]` 不会等播放结束，会在说话说到一半就进到下一句。）

**三条独立来源指向同一结论：语音必须能作为「阻塞自动推进」的主时钟。** stage-ai 的 `usePlayback` 有自动模式与语音钩子，但需确认 auto 的推进条件是否已接入「语音结束 + 缓冲垫」。

### 4.2 语音未就绪时的降级与背压

TTS 流式合成天然比打字机慢。业界有三种降级策略：

1. **文字先行，语音追上**（stage-ai 当前形态，`audio.ts` 注释原文）：
   > 文字先行：行开始时语音未就绪则静音上文字，短语解码完成后跟进起播

2. **整句阻塞等待**（录制型作品的行为）：语音是预制文件，加载几乎瞬时，不存在这个问题。

3. **静默降级为文本模式**：合成失败时不阻塞演出。stage-ai `apps/server/src/voice.ts` 的注释写明：
   > 音频失败只告警不阻塞演出（风险#3 对策）。

**背压（backpressure）是这个方向上最少被公开文档化、但工程上最关键的一环。** stage-ai 的实现注释给出了完整的机制：

```typescript
/** 背压阈值：未消费短语超过 PAUSE_AT 暂停预取，回落 RESUME_AT 恢复（滞回）。 */
const PAUSE_AT = 10;
const RESUME_AT = 3;
```

以及 `VoicePipeline` 侧的对应门控（`apps/server/src/voice.ts`）：

> 门控：`enabled`（语音总开关，关=停合成）/ `paused`（客户端背压：缓冲积压或持续快进）。

**滞回（hysteresis）是这里的关键设计**——单一阈值会在阈值附近抖动，导致合成队列反复启停。这是一个值得在 v2 里保留并文档化的决策。

### 4.3 快进与点击跳过时语音的退场

#### 点击跳过

Ren'Py 有一个直接相关的玩家偏好：

```python
# preferences.voice_sustain
# If True, voice keeps playing until finished, or another voice line replaces it.
# If False, the voice line ends when the line of dialogue advances.
preferences.voice_sustain = False
```

并且给出了 `voice sustain` 语句（[voice.html](https://www.renpy.org/doc/html/voice.html)）：

```
voice "line0001.ogg"
"Welcome to Ren'Py..."
voice sustain
"... your digital storytelling engine."
```

> Normally, a playing voice is **stopped at the start of the next interaction**. The `voice sustain` statement can **sustain** voice playback through an interaction.

**默认行为是「下次交互开始时停掉当前语音」，且默认在自动模式下等待语音播完。** 这两条默认值构成了「快进时语音怎么处理」的答案：**点击跳过 = 立刻停；auto = 等播完再走**。stage-ai 的 `FADE_MS = 100` 快进淡出比 Ren'Py 的硬停更平滑，是一处改进。

#### 跳过模式

[VNDev Wiki - Skipping](https://vndev.wiki/Skipping) 列出的引擎差异项（原文枚举）：

> - Whether text is animated when appearing during skipping, or it appears instantly.
> - Whether it's only text that's sped up or animations also play faster.
> - **Whether different types of audio are muted while skipping.**
> - **Whether sound effects on "skipped" lines get played.**
> - **Whether audio that does get played is sped up in any way**, and if so, how.
> - Some games or engines might provide a "jump to next scene" or "jump to next chapter" button.

Naninovel 给了一个**独立的语音与音效快进开关**（configuration 指南）：

| 属性 | 默认值 | 说明 |
| :--- | :--- | :--- |
| **Play Sfx While Skipping** | **True** | 快进时是否播放非循环音效（SFX）。关闭时会忽略没有 `loop!` 的 `@sfx` 指令 |
| Skip Time Scale | 10 | 快进时的时间缩放 |
| Skip Print Delay | 0 | 快进时每条 print 的额外等待（用于「把快进降速」） |

注意 Naninovel 单独为 **SFX** 做了快进开关，但配置表里**没有对应的「Play Voice While Skipping」**——这与 [Naninovel Voicing 文档](https://naninovel.com/guide/voicing) 里那句「`@voice` 只适合偶尔播放，不适合完整配音；backlog 重听、voiceover 文档等功能**只在 auto voice 工作流下**可用」形成呼应：**完整配音型项目的快进语义在 Naninovel 里是「跳过自动配音」**，而偶尔点缀型 `@voice` 则不在此约束内。

**这是一个真实存在的设计分叉**：
- 「全程配音型项目」→ 快进 = 静音（否则玩家会被几百行语音轰炸）。
- 「点缀型音效项目」→ 快进 = 保留（点缀本身是演出的一部分）。

stage-ai 是全程配音型，走前者是对的；但 DSL 层是否应该允许个别行声明「快进时也播」是一个可以留白的点（Naninovel 的 `loop!` 就是这个机制在 SFX 上的对应物）。

#### 玩家侧的真实诉求

搜索结果里有一条来自 [MyAnimeList 讨论串](https://myanimelist.net/forum/?topicid=1726527) 的玩家原话，标题是「Do you skip the voice acting in visual novels?」（你在 VN 里会跳过配音吗），并提到：

> I realized halfway that it took me 30 minutes to finish the prologue … cuz I pay attention to details and I'm a slow reader. **I wish to skip the voice acting of the visual novel**…

这是「快进静音」这一默认行为的用户侧佐证——玩家明确希望有一个「只跳文本不跳语音」或反过来「只跳语音不跳文本」的分离开关。VNDB 的 g3858（强制语音/字幕二选一，13 部）是这个诉求在商业作品里的极端形态。

### 4.4 跨行延续与回顾重听

**跨行延续**（voice sustain）解决的是「一段长语音被切到多行」的排版需求。Ren'Py 的语法：

```renpy
voice "line0001.ogg"
"Welcome to Ren'Py..."
voice sustain
"... your digital storytelling engine."
```

配套的 API 与信息对象（[voice.html](https://www.renpy.org/doc/html/voice.html)）：

- `_get_voice_info()` 返回 `VoiceInfo`，字段：
  - `filename` —— 正在播放的文件名，或 None
  - `auto_filename` —— Ren'Py 为自动配音查找的文件名
  - `tag` —— 触发本次互动的 Character 的 `voice_tag`
  - `sustain` —— False 表示本次互动播放的；True 表示从上一次互动延续而来
- `voice(filename, tag=None)`
- `voice_sustain(ignored='', **kwargs)`
- `voice_can_replay()` / `voice_replay()`
- `VoiceReplay()` —— 重播最近一次播放的语音

**回顾重听**（backlog replay）是 Naninovel 明确列出的「只在 auto voice 工作流下可用」的功能之一，Ren'Py 侧对应 `voice_replay()` + `PlayCharacterVoice()`：

> `PlayCharacterVoice(voice_tag, sample, selected=False)` — This plays sample on the voice channel, **as if said by a character with voice_tag**. This will set the volume, but will not perform any other voice-related handling of the file — **it's intended for use in menus to help the user determine the character volume**.

VNDB 的 g2358（Voice Saving，121 部）把这件事提升为**产品功能**（保存 + 随时重听），而不是引擎内建。

stage-ai 已经有 `replayToken` + `replaySources` 这套重听链（`apps/web/src/stage/audio.ts`），以及 `URL_LEDGER_MAX = 500` 的内存护栏——这是对的方向：**重听必须依赖 URL 台账而非内存里的 AudioBuffer**。

---

## 5. 引擎实现解剖

### 5.1 Ren'Py 语音指令与配置面全集

**语句（statements）**：

| 语句 | 语义 | 来源 |
| :--- | :--- | :--- |
| `voice "file"` | 在 voice 通道播放文件 | [voice.html](https://www.renpy.org/doc/html/voice.html) |
| `voice sustain` | 让语音跨过一次 interaction 继续播放 | 同上 |

**配置变量（config）**：

| 变量 | 默认值 | 语义 |
| :--- | :--- | :--- |
| `config.voice_filename_format` | `"{filename}"` | 格式化 `voice` 语句的参数以产生文件名（可省略目录与扩展名） |
| `config.auto_voice` | `None` | **字符串** → 用 `{id}` 格式化；**函数** → 接收 dialogue id、返回文件名；**None** → 关闭自动配音 |
| `config.has_voice` | `True` | 为 False 时禁用 voice 混音器与全部 voice 功能 |
| `config.voice_callbacks` | `[]` | 接受 `(event, info)`；`event ∈ {"play", "stop"}`；`info` 是 `_get_voice_info()` 的同一对象 |
| `config.emphasize_audio_channels` | `['voice']` | 强调通道列表 |
| `config.emphasize_audio_volume` | `0.8` | 非强调通道降到多少 |
| `config.emphasize_audio_time` | `0.5` | 淡入淡出秒数 |
| `config.afm_voice_delay` | `0.5` | 语音播完后，AFM 还能再等多少秒才推进 |
| `config.afm_callback` | `None` | 为 None 时内部函数会在语音播放中禁止 auto-forward（除非 `preferences.wait_voice = False`） |
| `config.afm_bonus` | `25` | 自动前进模式下每句额外赠送的字符数 |
| `config.afm_characters` | `250` | 超过此字符数的句子会让自动前进偏好额外延迟 |
| `config.after_phrase_callbacks` | `[...]` | 「Used to sustain voice through pauses」——**带停顿的台词行在第二段及之后触发**；这正是 voice sustain 的实现钩子 |
| `config.tts_substitutions` | `[]` | 送入 TTS 前的文本替换（发音纠正） |
| `config.audio_when_minimized`（preference） | True | 窗口最小化时是否停音频 |

**偏好（preferences）**：

| 变量 | 默认值 | 语义 |
| :--- | :--- | :--- |
| `preferences.wait_voice` | `True` | auto-forward 模式等待语音与 self-voicing 播完 |
| `preferences.voice_sustain` | `False` | 语音是否播到自然结束而不是台词推进就停 |
| `preferences.emphasize_audio` | `False` | 是否启用强调通道（压低非语音通道） |
| `preferences.voice_after_menu` | — | 菜单出现后语音是否继续播 |
| `preferences.volume.voice` | `1.0` | voice 混音器音量 |
| `preferences.audio_when_minimized` | `True` | 最小化时是否继续播 |
| `preferences.web_cache_preload` | `False` | 是否把游戏文件预载进浏览器缓存以支持离线 |

混音器全集：`main` / `music` / `sfx` / `voice`，其中 `main` 是特殊的，音量以 dB 表述（`0.0 = -40 dB`，`1.0 = 0 dB`）。

**Screen Actions**：

| Action | 语义 |
| :--- | :--- |
| `SetCharacterVolume(voice_tag, volume=None)` | 设定/返回某 voice_tag 的音量（0.0–1.0，相对 voice 混音器）。None 时返回 `BarValue` |
| `SetVoiceMute(voice_tag, mute)` | 静音/取消静音某 voice_tag |
| `ToggleVoiceMute(voice_tag, invert=False)` | 反转静音；`invert=True` 时 selected 表示「未静音」 |
| `PlayCharacterVoice(voice_tag, sample, selected=False)` | 在菜单中试听（会设置音量但不做其他 voice 处理） |
| `VoiceReplay()` | 重播最近的语音 |

**多语言配音**（Multilingual Voice）：把英语版放在 `game/omelette.ogg`，法语翻译放 `game/tl/french/omelette.ogg`，切换语言时自动用对应版本。自动配音同规则（`tl/` 下的路径需与原文件的路径对齐）。

**Self-Voicing**（无障碍朗读，[self_voicing.html](https://www.renpy.org/doc/html/self_voicing.html)）——[renpy/sphinx/source/self_voicing.rst](https://github.com/renpy/renpy/blob/master/sphinx/source/self_voicing.rst) 补充：

> Ren'Py generally uses speech synthesizers provided by the **operating system and web browser**. **Linux is the exception** — the `espeak-ng` command must be installed for self-voicing to work on Linux. The voice may be selected through the accessibility menu, which uses `renpy.get_tts_voices()` to list available voices and `Preference` to set the voice.

按 `v` 键切换 self-voicing 模式；该模式下键盘导航改为上下箭头遍历控件。

**这条对 stage-ai 的意义有两层**：
1. **正面**：self-voicing 与剧情配音是**两个正交的系统**，共用同一个 `tts_substitutions` 文本预处理层与同一个「等待」语义（`wait_voice` 同时覆盖 voice 与 self-voicing）。
2. **反面**：VNDB g3686 特意强调「Make sure this is by deliberate design and **not a function provided by the game engine, such as Ren'py self-voicing**」——说明「TTS 朗读」在玩家认知里默认是**无障碍功能**，不是「角色配音」。stage-ai 若把两者混为一谈，作品的观感会偏向「朗读小说」而不是「galgame」。

### 5.2 Naninovel 语音指令与配置面全集

**指令（commands）**（[API reference](https://naninovel.com/api)）：

| 指令 | 参数 | 说明 |
| :--- | :--- | :--- |
| `@voice` | `voicePath`（必）、`volume`、`group`、`authorId` | 在指定路径播放语音。`authorId` 指定这段语音属于哪个角色演员；**启用 per-author volume 时会据此调整音量** |
| `@stopVoice` | — | 停止当前播放的语音 |

**配置（configuration 指南，Audio 段）**：

| 属性 | 默认值 | 说明 |
| :--- | :--- | :--- |
| Audio Loader | Audio- (Addressable, Project) | 音频资源加载器 |
| **Voice Loader** | Voice- (Addressable, Project) | 语音资源加载器（与音频**分开**） |
| Audio Player | Naninovel Audio Player | `IAudioPlayer` 实现 |
| Default Master/Bgm/Sfx/**Voice** Volume | 1 | 各通道首次启动的默认音量 |
| **Enable Auto Voicing** | **False** | 启用后每条 `@print` 都会尝试播放关联的语音片段 |
| **Voice Overlap Policy** | **Prevent Overlap** | 见下 |
| **Voice Locales** | **Null** | 允许语音语言独立于主语言本地化选择 |
| Default Fade Duration | 0.35 | 音频启停的默认音量淡入淡出时长 |
| **Play Sfx While Skipping** | **True** | 快进时是否播放非循环 SFX |
| Custom Audio Mixer | Null | 自定义混音器资产 |
| Master/Bgm/Sfx/**Voice** Group Path | Master / Master/BGM / Master/SFX / **Master/Voice** | 各通道的混音组路径 |
| Master/Bgm/Sfx/**Voice** Volume Handle Name | Master Volume / BGM Volume / SFX Volume / **Voice Volume** | 暴露给设置 UI 的参数名 |

**Voice Overlap Policy 的三个取值**（原文）：

> - **Allow Overlap** — Concurrent voices will be played without limitation.
> - **Prevent Overlap** — Prevent concurrent voices playback by **stopping any played voice clip before playing a new one**.
> - **Prevent Character Overlap** — Prevent concurrent voices playback **per character**; voices of different characters (auto voicing) and any number of `@voice` command are allowed to be played concurrently.

**这三档是一条独立于「配不配语音」之外的混音策略轴。** 「Prevent Character Overlap」尤其贴合多角色同时说话的演出——单通道互斥会让两个角色的话互相截断，而按角色互斥能保住对话双方。

**语音混音组**（[audio 指南](https://naninovel.com/guide/audio.html)）：

```naninovel
; 通过 Master/Reverb 混音组播放语音
@voice ScaryVoice group:Master/Reverb
```

引擎通过 `FindMatchingGroups(groupPath)` 查找组；多个组匹配同一路径时取第一个。

**自定义音频后端**：Naninovel 的 `IAudioManager` 接口不依赖 Unity 默认后端（不引用 `AudioClip` / `AudioSource`），因此可以整体替换为 FMOD / Wwise 而**不修改引擎源码**。文档给了完整的 FMOD override 骨架。这是「语音通道抽象」做得比较彻底的一个例子。

**Auto Voicing 工作流**（[voicing 指南](https://naninovel.com/guide/voicing)）：

- 语音资源默认在 `Resources/Naninovel/Voice`（可在 Audio 配置的 Loader 折叠面板改），可用子文件夹，脚本中用正斜杠引用。
- 启用 Auto Voicing 后，Audio 配置菜单出现「Open Voice Map Utility」按钮（也可从 `Naninovel -> Tools -> Voice Map` 菜单进）。
- Voice Map 工具：选择脚本文件 → 若含 print 指令或通用文本行，会以「文本行 + 音频片段字段」成对列出 → 拖入片段完成关联。也可以按「片段名匹配台词开头」自动映射。
- ⚠️ 警告：用 Voice Map 窗口分配时，**务必把语音片段存在 `Resources` 文件夹之外**，以免冲突。
- 非源语言的关联：选择脚本的 `Localization Document`，分配的片段会自动带上该 locale 前缀。
- 重复台词共享同一片段；需要区分时用 `|#uniqueid|` 语法（也可跑 `Naninovel/Tools/Text Identifier` 批量生成）。

### 5.3 TyranoScript / KAG 体系

**语音角色绑定（`[voconfig]`）**（[ごいしはまぐり 教程](https://www.goihama.games/2469/)）：

```tyranoscript
; Boisu設定
[voconfig sebuf=1 name="tarou" vostorage="t/t{number}.ogg" number=1 ]
[voconfig sebuf=1 name="hanako" vostorage="h/h{number}.ogg" number=1 ]
[vostart]
;t1
#tarou
「t1.oggの再生です」[p]
[stopse buf=1]
```

- `sebuf=1` —— 用 SE 缓冲 1 号作为语音通道
- `name` —— 绑定到场景文件里的 `#角色名`
- `vostorage` —— 文件名模板，`{number}` 是自增序号
- `number` —— 当前序号

作者明确列出了 `[vo~]` 的优缺点（原文）：

> **良いところ**（优点）
> - **オートで進んだときに再生し終わるのを待ってくれる。** これは本当に重要でボイスが入っていてオートする機能を組み込む作品の場合は必須在这儿Yanpad。
> - 記述が楽。一律に#の後にnameをつけるだけです。
>
> **悪いところ**（缺点）
> - **何を再生しているか記述上分かりづらい。** → 対策：再生前にコメントアウトでファイル名を記載しておく。
> - **再生が+1づつ順番に行われる。選択肢があると全て+1という訳にはいかない。** → 対策：選択後、jumpした後にvoconfigのnumberで採番をし直す。

**「一条语音跨多行」在 TyranoScript 的实现**（[同作者的宏教程](https://www.goihama.games/2717)）：

```tyranoscript
[macro name=playvo]
#%chara
[text val=%mes]
[p]
[stopse buf=1]
[endmacro]
; 呼び出し
[playvo chara=haraguti mes="山神さん こんにちは"]
[playvo chara=misa mes="あっ こんにちは"]
```

宏里三件事：**用 `#` 触发语音**、**显示文本**、**点击等待后停止语音**（`[stopse buf=1]`）。这就是「第 N 行开始播 N 号语音、第 N 行点击时停」的完整实现。

**KAG 系的音轨槽位模型**（[HyperEZnovel 音频标签参考](https://hyperiyon.com/hypereznovel/docs/tags-audio.html)）：

BGM 标签（`[playbgm]` / `[stopbgm]` / `[fadeinbgm]` / `[fadeoutbgm]` / `[fadebgm]` / `[fadepausebgm]` / `[pausebgm]` / `[resumebgm]` / `[xchgbgm]` / `[bgmopt]` / `[setbgmstop]` / `[clearbgmstop]` / `[setbgmlabel]` / `[clearbgmlabel]`）的参数：

| 名字 | 类型 | 必填 | 默认 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `storage` | string | 必填 | - | 音频文件名（可省略扩展名） |
| `loop` | bool | 选填 | `true` | 是否循环 |
| `volume` | int | 选填 | `100` | 音量（0–100） |
| `fadein` | int | 选填 | `0` | 淡入时间（毫秒） |
| `start` | int | 选填 | `0` | 播放起始位置（毫秒） |
| `buf` | int | 选填 | `0` | 缓冲编号（多 BGM 用） |

SE 标签（`[playse]` / `[stopse]` / `[fadeinse]` / `[fadeoutse]` / `[fadese]` / `[seopt]`）+ 等待标签（`[ws]` 等）。

**「音轨槽位（buf）」是一个被低估的设计**：它让「语音槽」与「音效槽」在物理上分离，从而「停音效不停语音」成为一条语句级指令。stage-ai 目前的 BGM/ambient 走 `LoopChannel`、SFX 走 `SfxPlayer`、语音走 `VoiceDirector`——三者物理分离，与 KAG 的 `buf` 模型是同构的。

**Web 音频移植的已知冲突**（[PlayseEx 插件](https://github.com/TAKASHI-S97/PlayseEx)）：

> 標準の `[playse]` の音楽再生は **Howler** を採用しておりますが、**ピッチ修正非対応**のため、こちらでは **Web Audio API** へ移植しております。
> 待機、再生スキップのロジック等は標準のまま移植しておりますが、**口パク機能関連の処理は外しております。**
> また、**Web Audio API の仕様として、ピッチ修正を行うと音の再生速度も変わります。**

三个可迁移的教训：
1. Howler.js 不支持 pitch 修正，要 pitch 就得用 Web Audio。
2. **改了 pitch 就会改速度**——音色偏移与语速不是正交的，DSL 不该把它们当两个独立参数暴露。
3. 从 Howler 迁到 Web Audio 时，**口型驱动逻辑会断**——迁移不是换个库的事。

插件给 `[playse_ex]` 增加了这些参数：`storage` / `buf` / `loop` / `sprite_time`（区间循环，Web Audio 版单位是**秒**而非毫秒）/ `clear`（停掉其他槽位）/ `volume`（0–100）/ `pitch`（**音分 cents**，`100 cents = 半音`，`1200 cents = 一个八度`）。

### 5.4 其他引擎与工具链

| 工具/引擎 | 语音相关能力 | 来源 |
| :--- | :--- | :--- |
| **Pixi'VN**（浏览器 VN，React/PixiJS） | 面向 AI 辅助开发，集成 Spine 2D 与 Live2D；`# show image` 语法与 `# move` / `# edit` / `# animate` 同层 | [pixi-vn.com](https://pixi-vn.com) / [itch.io](https://drincs-productions.itch.io/pixi-vn) |
| **Ink** | 音频走宿主运行时（ink web 加载的 JS 引擎连接 ink story 与网页，负责动画、音频与 UI），ink 语言本身不含音频原语 | [inkle 官方](https://www.inklelestudios.com/ink) / [ink-if-story-template Audio 参考](https://remyvim.github.io/ink-if-story-template/reference/audio) |
| **Twine / Harlowe / SugarCube** | 同样以宏/JS 挂音频，无内建配音管线 | [Twine Cookbook](https://moonbase.twinery.org/cookbook/starting/twine2/storyformat.html) |
| **BGI / Ethornell**（Buriko General Interpreter） | 编译脚本（`._bp`），工具链为逆向工程向（BGIKit / EthornellTools / msg-tool） | [openbgi.net](https://openbgi.net) / [msg-tool DeepWiki](https://deepwiki.com/lifegpc/msg-tool/6.2-bgiethornell-engine) |
| **Visionaire Studio** | 有完整的 Rhubarb Lip Sync 集成教程（嘴型表 A–H） | [wiki.visionaire-tracker.net](https://wiki.visionaire-tracker.net/wiki/Lip_sync) |
| **TyranoScript VOICEVOX 插件** | 实时合成：字符→VOICEVOX speaker/style/preset→逐句播；带管理 UI 可把生成结果落盘 | [BOOTH](https://booth.pm/ja/items/6017687) / [GitHub](https://github.com/Ouvill/tyrano_voicevox_plugin) |

**TyranoScript VOICEVOX 插件的完整参数表**（可直接抄进 DSL 的取值空间）：

```
[register_voicevox_app url="http://localhost:50021"]
[chara_new name="zunda" storage="chara/zunda/normal.png" jname="ずんだもん"]

; preset: 话速、音程、音量
[voicevox_preset id="zunda_normal" speed="1.3" pitch="0.05" intonation="1.1" volume="1.5" pre="0.1" post="0.1"]

; 角色 → speaker + style + preset
[voicevox_chara name="zunda" speaker="ずんだもん" style="ノーマル" preset="zunda_normal"]

[voicevox_on]
#zunda
ずんだもんだよ。[p]
```

注意它显式声明了一条缺失能力（原文）：**「自動で字幕送り機能は未実装」**（未实现自动字幕推送功能）——即「实时 TTS 播放」与「文本自动推进」是**两个独立特性**，插件作者只做了前者。

### 5.5 已知坑清单

| 坑 | 现象 | 根因 | 规避 |
| :--- | :--- | :--- | :--- |
| **voice 语句必须写在 say 之前** | `voice` 放在台词之后不生效 | Ren'Py 的 voice 是「为下一次 interaction 准备的」 | 语句顺序固定；或改用 auto voice |
| **重复台词的 auto voice 冲突** | 自动配音不播 / 播错段 | 对话 id 分配规则变化或 mod 导致 id 漂移（Reddit 案例：mod 后 `_1` 后缀导致文件名对不上） | 重新 Extract Dialogue 对齐 id；或在脚本里做 Python 修正 | 
| **`voice sustain` 打断打字机** | 用 `voice sustain` 后文本推进异常 | `config.after_phrase_callbacks` 才是 sustain 的实现钩子 | 用官方语句而非 hack 回调 |
| **Web 移植丢口型** | 从 Howler 迁 Web Audio 后口型不动 | 音频库替换时口型逻辑依赖旧库的回调 | 迁移时同步移植口型；或改用 AnalyserNode 驱动 |
| **pitch 与 speed 耦合** | 调音高变快 | Web Audio 的 pitch 走 `playbackRate`，会同步改速度 | 音色偏移应在 TTS 服务端完成，播放器只做原速渲染 |
| **SSML 不支持标签是硬错误** | `<emphasis>` 在 neural 音色上报错 | Polly 明确「unsupported SSML tags … you will get an error」 | 编译期按「引擎 × 音色类型」白名单过滤 |
| **`sprite_time` 单位在移植后变了** | 区间循环长度错 | Web Audio 版用秒，标准 Howler 版用毫秒 | 移植时显式转换并测试 |
| **快进时音效与语音行为不同** | SFX 保留但语音静音 | 引擎只给 SFX 做了快进开关 | 这是设计分叉不是 bug，按作品类型取舍 |
| **TTS 「自动字幕推进」常被遗漏** | 语音播了但文本不同步 | 实时 TTS 插件只做播放不做时序对齐 | 把「语音结束」接进 auto 的推进条件 |
| **self-voicing 被误认为剧情配音** | 作品观感变成「朗读小说」 | 玩家默认把 TTS 归为无障碍功能 | 剧情配音要有独立的角色音色与情绪，界面也要明确区分 |

---

## 6. 浏览器侧：Web Audio 时序、缓存与成本控制

### 6.1 双时钟模型与前瞻调度

[web.dev - A tale of two clocks](https://web.dev/articles/audio-scheduling)（Chris Wilson）是这个问题的权威论述：

> The Web Audio API exposes access to the audio subsystem's **hardware clock**. This clock is exposed on the AudioContext object through its `.currentTime` property… This enables this clock to be designed to be able to **specify alignment at an individual sound sample level**, even with a high sample rate.

> The JavaScript clock is our much-beloved and much-maligned JavaScript clock, represented by `Date.now()` and `setTimeout()`.

关键结论（原文）：

> The audio clock is used for scheduling parameters and audio events throughout the Web Audio API — for `start()` and `stop()`, of course, but also for `set*ValueAtTime()` methods on AudioParams. **This lets us set up very precisely-timed audio events in advance.**

**核心论点：「look ahead」而非「push in」。**

> In short, because you will need the flexibility to change tempo or parameters like frequency or gain (or to stop scheduling altogether), **you don't want to push too many audio events into the queue — or, more accurately, you don't want to look ahead too far in time, because you may want to change that scheduling entirely.**

对 stage-ai 的直接映射：gapless 链式调度的**链长**是一个精度与灵活性之间的权衡点——链太长则中途放弃（快进）需要作废大量已预约的事件，链太短则段间抖动暴露。`PHRASE_PAD = 0.25`（句间缓冲垫）就是这个权衡的具体取值。

**MDN `AudioBufferSourceNode.start()`** 的参数语义（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start)）：

- `when` —— 「The time, in seconds, at which the sound should begin to play, **in the same time coordinate system used by the AudioContext**. If `when` is less than `AudioContext.currentTime`, or if it's 0, the sound begins to play at once.」
- `offset` —— 「The computation of the offset into the sound is performed using the sound buffer's **natural sample rate**, rather than the current playback rate, so even if the sound is playing at twice its normal speed, the midway point through a 10-second audio buffer is still 5.」
- `duration` —— 「The value is independent of the `AudioBufferSourceNode.playbackRate`, so e.g., a `duration` of 2 seconds with a `playbackRate` of 2 will play 2 seconds of the source, producing a 1 second audio output.」
- `InvalidStateError` —— 「Thrown if `start()` has already been called. **You can only call this function once during the lifetime of an AudioBufferSourceNode.**」

**「一个 AudioBufferSourceNode 只能 start 一次」是一条硬约束**——任何需要「暂停/继续/从中间开始」的场景都得换节点（`stop()` + 新建节点 + `offset`）。

**MDN Autoplay Guide**（[MDN](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)）：

> As a general rule, you can assume that media will be allowed to autoplay only if **at least one** of the following is true:
> - The audio is muted or its volume is set to 0
> - The user has interacted with the site (by clicking, tapping, pressing keys, etc.)
> - If the site has been allowlisted
> - If the Autoplay Permissions Policy is used to grant autoplay support to an `<iframe>`
>
> Note: playback of any media that includes audio is generally blocked if the playback is **programmatically initiated in a tab which has not yet had any user interaction**.

受影响的 API 明确列出：**The HTML `<audio>` and `<video>` elements** 与 **The Web Audio API**。

### 6.2 自动播放策略与解锁

浏览器差异（同一份 MDN 文档的 Browser configuration options 段）：

- **Firefox**：`media.allowed-to-play.enabled`（默认 `false`，nightly 下为 `true`）决定是否暴露非标准属性 `HTMLMediaElement.allowedToPlay`；`media.autoplay.allow-extension-background-pages`（默认 `true`）。
- `<iframe>` 场景需要 `allow="autoplay 'src' https://example.media"` 或用 `Permissions-Policy: autoplay=()` 完全禁用。

**对 stage-ai 的结论**：「点击开始」遮罩不是 UX 选择，是**移动端铁律**（`audio.ts` 的注释已经写明）。标题画面的「开始游戏 / 继续周目」按钮天然满足手势要求，Title 就绪门已经存在——但**必须确认语音的 `AudioContext` 是在这个手势的同步路径上 `resume()` 的**（而不是在 WebSocket 收到 `audio_ready` 之后才尝试创建上下文）。

### 6.3 解码、内存与台账

`decodeAudioData` 的语义（[MDN BaseAudioContext.decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)）：

> The `decodeAudioData()` method … is used to **asynchronously decode audio file data contained in an ArrayBuffer** that is loaded from `fetch()`, `XMLHttpRequest`, or `FileReader`. **The decoded AudioBuffer is resampled to the AudioContext's sampling rate**, then passed to a callback or promise.

两个值得注意的点：
1. **异步**——所以「解码完成」是一个事件，不是一个时刻；stage-ai 的「短语解码完成后跟进起播」正是这个异步窗口的处理。
2. **重采样到 AudioContext 采样率**——服务端产的 24kHz/44.1kHz mp3 解码后会被重采样；这本身有 CPU 成本。

**内存量级**：一个 10 秒的 48kHz 立体声 32-bit float PCM `AudioBuffer` 约 `48000 × 2 × 4 × 10 ≈ 3.84 MB`。一整场戏若有 60 句 × 平均 8 秒，全部驻留内存就是 2 GB 级别——**不可行**。stage-ai 的 `URL_LEDGER_MAX = 500` 与「行结束时随 `lines` 一起丢掉 AudioBuffer、只留 URL 台账」是正确的结构。

**配额与持久化**（[MDN Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) 与 [BrowserStorage.com 汇总](https://www.browser-storage.com/browser-storage-fundamentals-quotas/storage-quotas-eviction-policies)）：

- IndexedDB 与 Cache API 默认属于 **temporary（best-effort）** 层，可通过 StorageManager API 升级为 **durable**；`localStorage` **不能**升级。
- **Firefox**：临时存储组（IndexedDB + CacheStorage）上限为总磁盘的 20%，单源上限为 10 GB 与 10% 组配额中的较小者；LRU 淘汰；调用 `navigator.storage.persist()` 可退出。
- 跨浏览器配额差异极大，**没有标准化**。

**降级策略**（Ren'Py Web 平台的对应实现，`preferences.web_cache_preload`）：

> If True the game files will be loaded into the web browser's cache, **allowing the game to be played offline**. If False, the game files will not be loaded into the web browser's cache, and **the game will require internet access to play**.

这正是 TTS 场景下「离线可用」的实现：把合成好的音频预热进浏览器缓存，而不是依赖 TTS API 在线。

### 6.4 缓存键设计与在途去重

**Pipecat TTS Cache**（[官方文档](https://docs.pipecat.ai/api-reference/server/services/tts/tts-cache)）：

> Deterministic key generation: Before requesting audio, a cache key is generated from the **normalized text, voice ID, model, sample rate, and settings**.

**Voice Studio**（[文档](https://voicestudio.msrbuilds.com/docs/models-and-cache)）：

> Synthesis cache: Every generated clip is cached to disk under `backend/cache/`, keyed by a **content hash of the text + voice + engine + all settings** (cfg, exaggeration, language, voice mode, style prompt, Qwen sampling params, and so on).

**两个独立来源给出同一公式：`hash(归一化文本 + 音色 + 引擎 + 全部参数)`。**

对照 stage-ai 现状（`apps/server/src/tts.ts`）：

```typescript
const file = `${createHash("sha1").update(voiceId).update("\0").update(text).digest("hex")}.mp3`;
```

已覆盖：**音色 + 文本**。缺失：**情绪标记、语速/音高 prosody、模型名、格式**。一旦 DSL v2 引入 `<say mood=...>`，缓存键必须扩展，否则「改了情绪但命中旧音频」会成为静默 bug。

在途去重（stage-ai 已实现，值得记录为既有决策）：

```typescript
/** 同目标文件进行中的请求去重（键为绝对路径：跨剧目同 hash 并发不互等，R-N1）。 */
private readonly inflight = new Map<string, Promise<void>>();
```

以及原子落盘：

```typescript
const tmp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
await writeFile(tmp, audio);
await rename(tmp, target);
```

重试策略（同一文件，注释原文）：

```typescript
const RETRYABLE_STATUS = new Set([401, 402, 429]);
/** 非轮换错误哨兵：持久性 4xx/5xx 不换 key 重试（换 key 也必然失败，只会烧配额）。 */
class NonRetryableTtsError extends Error {}
```

**「哪些错误值得重试」是一个被明确决策过的点**：401/402/429（配额/限流）换 key 重试有收益；其它 4xx/5xx 换 key 只会烧配额。

### 6.5 持久化缓存与淘汰

| 存储 | 上限 | 可持久化 | 适用 |
| :--- | :--- | :--- | :--- |
| `localStorage` | ~5 MB | ❌ | 只放小配置（stage-ai 的 `settings.ts` 用的就是它） |
| IndexedDB | 分组配额（Firefox 临时组为磁盘 20%，单源 ≤ min(10 GB, 10% 组)） | ✅ `navigator.storage.persist()` | 结构化数据、音频 Blob |
| Cache API | 同上 | ✅ | 原始 HTTP 响应（音频文件最自然） |
| 内存（AudioBuffer） | 受主线程/渲染进程限制 | ❌ | 只放当前行 + 少量前瞻 |

**结论**：stage-ai 现有的「服务端 media-cache/tts 内容寻址文件 + 浏览器 URL 台账」已经是**服务端持久化**路线；浏览器端再缓存一层（即 Ren'Py 的 `web_cache_preload` 思路）能得到离线可玩 + 首播零延迟。

### 6.6 流式 TTS 的前端适配

流式 TTS 的三种端点形态（[ElevenLabs latency-optimization](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization)）：

> - **Regular endpoint**: Returns a complete audio file in a single response.
> - **Streaming endpoint**: Returns audio chunks progressively using **Server-sent events**.
> - **Websockets endpoint**: Enables **bidirectional** streaming for real-time audio generation.

WebSocket 端点专为「LLM 实时输出」设计：

> The text-to-speech websocket endpoint supports bidirectional streaming making it perfect for applications with **real-time text input (e.g. LLM outputs)**. Setting `auto_mode` to true automatically handles generation triggers, removing the need to manually manage chunk strategies. If `auto_mode` is disabled, the model will wait for enough text to match the chunk schedule before starting to generate audio. For instance, if you set a chunk schedule of 125 characters but only 50 arrive, **the model stalls until additional characters come in—potentially increasing latency**.

**这段话直接命中 stage-ai 的场景**（LLM 流式产出剧本 + 服务端切句合成）：如果按「够 N 字才合成」的策略，第一句可能永远等不到 N 字。ElevenLabs 的解法是 `auto_mode` 自动决定触发时机。

**Cartesia Sonic** 的对应设计（[composite-voice 文档](https://composite-voice.com/docs/guides/tts/cartesia-tts)）：

> Cartesia's Sonic models deliver fast time-to-first-byte, and the **context-based streaming protocol links multiple text chunks into a single coherent utterance with consistent prosody**.

即「跨块保持韵律一致」是这些引擎的明确设计目标——这与 stage-ai 的「服务端分句 → 前端 gapless 拼接」形成对照：前者靠引擎内部上下文，后者靠拼接。

**延迟基准**（供参照）：
- ElevenLabs Flash 模型「~75ms inference speeds」（仅模型推理，不含端到端）。
- Cartesia Sonic 3.6 第三方基准（[Coval](https://benchmarks.coval.ai/models/sonic-3.6)）：mean **413 ms** time to first audio，5.3% WER（28 个系统中的第 21 位）。
- ElevenLabs 地区差异：「using Flash models with Websockets, you can expect the following TTFB latencies depending on your location」，当前区域含 USA / Netherlands / Singapore，可通过响应头 `x-region` 判断。

---

## 7. 面向 LLM 剧本的 DSL v2 语音指令空间

以下小节把前六节的证据汇总成一套**有据可依的取值空间**，并明确标注哪些是行业既有做法、哪些是本项目的决策点。

### 7.1 剧目级语音配置矩阵

需求要求「是否开启语音在 play（剧目）级别配置——同一套剧本可以配成全程配音、只配主角、只配部分角色、或完全静音」。

Ren'Py 与 Naninovel 的配置面都证明**三层正交**是成熟做法（Ren'Py 的 `config.has_voice` / `voice_tag` / `volume.voice`，Naninovel 的 `Enable Auto Voicing` / `authorId` 音量 / `Voice Group Path`），再加上 VNDB 的 16 个子标签，可以得到一张完整的矩阵：

| 层 | 字段 | 取值 | 出处 |
| :--- | :--- | :--- | :--- |
| **剧目** | `play.voice.enabled` | `true` / `false` | Ren'Py `config.has_voice`；Naninovel `Enable Auto Voicing` |
| **剧目** | `play.voice.textKinds` | 勾选子集：`dialogue` / `thought` / `narration` / `voiceOnly` | VNDB g2088 / g836 / g1484 |
| **角色** | `character.voiceId` | 音色库条目 id 或 `null`（`null` = 该角色不配音） | Naninovel `authorId`；Ren'Py `voice_tag` 缺省 |
| **角色** | `character.voiceEnabled` | `true` / `false` | Ren'Py `SetVoiceMute` / `ToggleVoiceMute` |
| **角色** | `character.voiceVolume` | `0.0`–`1.0` | Ren'Py `SetCharacterVolume` |
| **角色** | `character.voiceParams` | `{ speed, pitch, volume, intonation, pre, post }` | VOICEVOX preset |
| **通道** | `play.voice.mixer` | `main` / `voice`；可强调与 ducking | Ren'Py mixers + `emphasize_audio_channels` |
| **混音** | `play.voice.overlapPolicy` | `allow` / `prevent` / `preventPerCharacter` | Naninovel `Voice Overlap Policy` |
| **混音** | `play.voice.ducking` | `{ channels: ['voice'], volume: 0.8, time: 0.5 }` | Ren'Py `config.emphasize_audio_*` |
| **多语** | `play.voice.locales` | 语言标签列表，语音语言独立于主语言 | Naninovel `Voice Locales` |
| **多语** | `play.voice.autoVoiceFormat` | 形如 `voice/{id}.ogg` 或函数 | Ren'Py `config.auto_voice` / `config.voice_filename_format` |
| **播放** | `play.voice.advancePolicy` | `waitVoice`（默认，等语音 + 缓冲垫）/ `timeBased`（字数模型） | Ren'Py `preferences.wait_voice` |
| **播放** | `play.voice.voiceDelay` | 秒，默认 `0.5` | Ren'Py `config.afm_voice_delay` |
| **播放** | `play.voice.sustain` | `true` / `false` | Ren'Py `preferences.voice_sustain` |
| **播放** | `play.voice.playWhileSkipping` | `true` / `false`（`@sfx` 的 `loop!` 对应物） | Naninovel `Play Sfx While Skipping` |
| **回看** | `play.voice.replay` | `enabled` / `disabled` | Naninovel backlog replay；VNDB g2358 |
| **无障碍** | `play.voice.selfVoicing` | 与剧情配音**分离**的独立开关 | Ren'Py self-voicing（独立于 voice 通道） |

「全程配音 / 只配主角 / 只配部分角色 / 完全静音」四种配置在这张矩阵里的映射：

| 目标 | 配置方式 |
| :--- | :--- |
| 全程配音 | `enabled=true`；所有 `character.voiceId != null`；`textKinds = 全部` |
| 只配主角 | `enabled=true`；`character.voiceId` 只在主角上非空 |
| 只配部分角色 | `enabled=true`；指定角色集合填 `voiceId`，其余为 `null` |
| 完全静音 | `enabled=false`（或全部角色 `voiceEnabled=false`） |

**注意「完全静音」有两条不同的路径**：剧目级硬停（不合成、不预取、省所有配额）与逐角色静音（剧本仍可产出语音文件供收藏/重听）。Ren'Py 的 `config.has_voice = False` 是前者（同时隐藏 voice 混音器），`SetCharacterVolume(tag, 0.0)` 是后者。两者在 UX 上不同，值得在 play.json 里显式区分。

### 7.2 指令与属性的取值空间

**核心判断：语音绝大多数情况下是「台词行的伴随属性」，而不是独立指令。** 理由有三：

1. Ren'Py 的 `voice` 语句必须写在 `say` **之前**（声明式附属），Naninovel 的 auto voice 干脆完全省掉显式指令——两家都把「这行有声音」视为台词行的属性。
2. VNDB 的 16 个标签里，只有 g1484（Voice Only Parts）真的需要独立于台词的语音段落。
3. LLM 写剧本时，让它「先写一个 voice 标签再写台词」比「在台词标签上写一个属性」更容易写错顺序。

据此的三类表达：

#### 类别 1：台词行的语音属性（主干）

```xml
<say id="lucy" mood="worried" tone="whispering" speed="0.9">有人在吗……</say>
<narrate voice="on">雨越下越大了。</narrate>
<thought id="lucy" mood="sad">都是我的错。</thought>
```

| 属性 | 作用面 | 取值空间 | 依据 |
| :--- | :--- | :--- | :--- |
| `mood` | 情绪 | Fish Audio 基础情绪 24 项的子集（建议先取交集高的：neutral/happy/sad/angry/excited/calm/nervous/sarcastic/scared/moved） | [Fish Audio](https://docs.fish.audio/developer-guide/core-features/emotions) 基础情绪表；ElevenLabs 同类 |
| `tone` | 语气/体量 | `normal` / `whispering` / `shouting` / `screaming` / `soft` | Fish Audio 的 6 个 Tone Markers |
| `speed` | 单句临时语速 | `0.8`–`1.3`（缺省继承角色基准） | VOICEVOX `speed`；Fish Audio `prosody.speed` |
| `voice` | 覆盖默认 | `on` / `off` / 显式 `voiceId` | `on/off` 来自 play 级开关语义；显式 id 来自「Changeable Voice Actors」(g3730) |
| `auto` | 文本自换 | `true` / `false` | VOICEVOX 插件的 `[voicevox_ruby text="..."]`（显示文本 ≠ 朗读文本） |

**关键约束（来自 Fish Audio 官方 Best Practices）**：
- 「Use **one primary emotion per sentence**」→ 一行最多一个 `mood`。
- 「Maximum of **3** combined emotions per sentence recommended」→ 若允许 `mood + tone + 效果` 组合，上界为 3。
- 「Don't mix conflicting emotions」→ 可定义冲突表（如 `happy` vs `sad`）做静态校验。
- 「Don't overuse emotion tags in short text」→ 短句（如「嗯。」）可以不写情绪。
- 「Sentence-level emotion cues usually work best **at the beginning of sentences**」→ 情绪是**句子级属性**，不该内联在文本中。

**这最后一条对 LLM 特别重要**：把情绪写成属性而不是塞进正文 `文本[happy]文本`，能让 DSL 编译器验证、能让缓存键纳入、也让「文本与朗读文本分离」（ruby）成为自然能力。

#### 类别 2：跨行与无字语音（少数但必要）

```xml
<!-- 跨行延续：一段长语音跨多次点击 -->
<say id="lucy" sustain="true">我一直在等你。</say>
<say id="lucy" sustain="true">从三年前的那个雨夜开始。</say>

<!-- 无字语音段落（g1484 Voice Only Parts） -->
<voice id="lucy" mood="scared" text="有人吗……救救我……" show="false"/>
```

| 属性 | 取值 | 依据 |
| :--- | :--- | :--- |
| `sustain` | `true` / `false` | Ren'Py `voice sustain` 语句 + `preferences.voice_sustain` |
| `show` | `true` / `false`（是否显示文本） | VNDB g1484 |
| `text` | 朗读文本（可与显示文本不同） | VOICEVOX `ruby`；Ren'Py `config.auto_voice` 的 id 映射 |

#### 类别 3：通道级控制（少用，运行时用得多）

```xml
<voice action="stop"/>
```

| 属性 | 取值 | 依据 |
| :--- | :--- | :--- |
| `action` | `stop`（立即 50–100ms 斜坡截断） | Naninovel `@stopVoice`；KAG `[stopse buf=1]` |

### 7.3 枚举封闭、缺省保持与静默降级

从两份兄弟调研（`260902-galgame-presentation-primitives` 的「枚举封闭是让 LLM 一次写对的主要抓手」、`260902-vn-engine-presentation-primitives` 的「三层抽象」结论）与本次语音证据的交叉，voice 指令面应该遵守与既有 DSL 一致的三条契约：

1. **枚举封闭**：情绪/语气只从**已下发到系统提示词的表**里取。Fish Audio 的 71 个标记全量注入提示词是可行的（71 × 约 4 token ≈ 300 token），但**注入的是本机音色库实际支持的那部分**——换 TTS 后端时表要跟着变。
2. **缺省保持**：不写 `mood` = 保持中性；不写 `voice` = 按角色默认。这与既有 DSL 的「缺省 = 保持当前」规则（`resolveAudio` 的三态）同源。
3. **静默降级**：未知情绪名 → 剥掉该属性、按中性合成 + 记 `warning`，与既有 `LEGACY_TAGS` 的处理一致。**这条尤其重要**：Polly 明确「unsupported SSML tags … you will get an error」，一个未过滤的未知标签会直接把整句合成打挂。

**一个需要显式决策的点：情绪是否进缓存键。** Pipecat 与 Voice Studio 两家都把「全部参数」放进键。stage-ai 现有键是 `sha1(voiceId + "\0" + text)`——一旦 DSL 引入 `mood`/`tone`/`speed`，这三个必须进键，否则同一句在不同情绪下会串音。这是 v2 实现时的一个必改项。

### 7.4 三个轴的独立性

把上面所有证据压缩成三个正交轴（这也是 stage-ai play.json 的结构骨架）：

```
┌─────────────────────────────────────────────────────────────┐
│  轴 1：谁在发声（Speaker）                                     │
│  play.voice.enabled · character.voiceId · character.voiceEnabled │
│  character.voiceVolume · character.voiceParams                 │
│  取值依据：Ren'Py voice_tag / Naninovel authorId               │
├─────────────────────────────────────────────────────────────┤
│  轴 2：怎么发声（Delivery）                                     │
│  台词属性：mood · tone · speed · auto（朗读文本覆盖）            │
│  播放策略：advancePolicy · voiceDelay · sustain                 │
│  混音策略：overlapPolicy · ducking · playWhileSkipping          │
│  取值依据：Fish Audio 情绪表 / Ren'Py afm_* / Naninovel         │
│           Voice Overlap Policy + Play Sfx While Skipping       │
├─────────────────────────────────────────────────────────────┤
│  轴 3：听到什么（Content）                                      │
│  textKinds：dialogue / thought / narration / voiceOnly          │
│  autoVoiceFormat（多语言覆盖） · replay（回顾重听）              │
│  取值依据：VNDB g2088 / g836 / g1484 / g2358；                  │
│           Ren'Py config.auto_voice + Multilingual Voice         │
└─────────────────────────────────────────────────────────────┘
```

**三轴正交的好处**：同一份剧本改 `play.json` 即可在四种配音方案间切换，剧本文件一个字都不用动——这正是需求里「同一套剧本可以被配成 X」的语义。**剧本层只负责轴 3 里「这一行属于哪类文本」+ 轴 2 里「这一行怎么念」；轴 1 完全由剧目配置与角色卡决定，不进 DSL。**

---

## 8. 本次未覆盖的空白

诚实标注本次调研没拿到直接证据的部分：

- **Naninovel 快进时语音的确切行为**：配置表里只有 `Play Sfx While Skipping` 而无对应语音开关，voicing 文档也未明说；未从 Naninovel 源码（GitHub raw 拉取 404，API 需鉴权）确认。结论是基于「有 SFX 开关但无 voice 开关」这一**结构性证据的推断**，非直接引用。
- **Ren'Py 是否有内建的口型同步**：官方文档没有；`voice_callbacks`（`play`/`stop` 两事件）只能做「开始/结束」级别的切换，做不到音量包络级。社区插件（Auto-LipSync、Live2D Tutorial）是第三方实现。
- **ElevenLabs v3 的完整 Audio Tag 词表**：官方博客按类别描述了「emotions / delivery and pacing / human reactions / accents / sound effects」，但完整清单分散在多篇指南与第三方 PDF（如「40 audio tags」），未从官方 API reference 拿到权威全表。对比之下 Fish Audio 的 71 项是完整可枚举的。
- **Azure `mstts:express-as` 的 style 全表**：只拿到「40+ 种情绪/场景」的存在性陈述与 SSML 结构说明（`style` / `styledegree` 0.01–2 / `role`），未拿到逐项枚举。
- **实际时延与成本的实测数据**：全部为厂商文档与第三方基准（Coval 测 Cartesia Sonic 3.6 = 413 ms TTFB；ElevenLabs Flash ≈ 75 ms 推理时间），未做自建实测。
- **`config.voice_after_menu` 的完整文档条目**：在 preferences 页面中以「If True, voice will continue playing after the game menu is shown」的形式出现（变量名在抓取中被截断），未拿到完整的 config/preference 对照表。
- **多角色抢话的自动化策略**：ElevenLabs 有 `[overlapping]` 标签、TyranoScript 的 `[voconfig number]` 递增在遇到选项分支时会错乱（社区文档明确提到），但**没有引擎提供「对话抢白（interruption）编排」的成熟方案**。这是一个真实的空白。
- **VNDev Wiki 的 Autoplay / Voice acting 页面对 degoog 抓取返回 403**，最终通过 `index.php?action=raw` 与 `web_fetch` 获取；Lemma Soft 论坛与 Reddit 全文被 403/反爬拦截，相关结论仅基于搜索摘要（已标注来源为 snippet）。

---

## 9. 信源索引

### 引擎官方文档

- [Ren'Py — Voice（voice 语句、voice sustain、Automatic Voice、Multilingual Voice、Voice Functions、Voice Actions）](https://www.renpy.org/doc/html/voice.html)
- [Ren'Py — Configuration Variables（afm_*、emphasize_audio_*、voice_*、tts_substitutions、has_voice）](https://www.renpy.org/doc/html/config.html)
- [Ren'Py — Preference Variables（wait_voice、voice_sustain、emphasize_audio、volume.voice、web_cache_preload、audio_when_minimized）](https://www.renpy.org/doc/html/preferences.html)
- [Ren'Py — Self-Voicing（无障碍朗读）](https://www.renpy.org/doc/html/self_voicing.html) ／ [源码 self_voicing.rst](https://github.com/renpy/renpy/blob/master/sphinx/source/self_voicing.rst)
- [Ren'Py — Audio（混音器、play 语句）](https://www.renpy.org/doc/html/audio.html)
- [Naninovel — Voicing（Auto Voicing、Voice Map、Text Identifier、重复台词 ID）](https://naninovel.com/guide/voicing)
- [Naninovel — Audio（@bgm/@sfx/@voice、Audio Mixer、group 参数、自定义 FMOD/Wwise 后端）](https://naninovel.com/guide/audio.html)
- [Naninovel — Configuration（Audio / Scripts 段全部配置项）](https://naninovel.com/guide/configuration)
- [Naninovel — Commands API Reference（@voice / @stopVoice / @wait / @skip）](https://naninovel.com/api)
- [TyranoScript — タグリファレンス V6](https://tyranoscript.com/tag)
- [TyranoScript — キャラの目パチ口パク（差分图三态规范）](https://tyrano.jp/usage/tech/pachi)
- [HyperEZnovel — 効果音・BGM操作（KAG 兼容音频标签参数表）](https://hyperiyon.com/hypereznovel/docs/tags-audio.html)
- [KAG System リファレンス（吉里吉里 KAG3 标签文档）](https://krkrz.github.io/krkr2doc/kag3doc/contents/index.html) ／ [标签参考](https://krkrz.github.io/krkr2doc/kag3doc/contents/Tags.html)
- [Pixi'VN — 浏览器 VN 引擎](https://pixi-vn.com) ／ [itch.io 页](https://drincs-productions.itch.io/pixi-vn)
- [Ink — inkle 叙事脚本语言](https://www.inklelestudios.com/ink) ／ [ink-if-story-template Audio](https://remyvim.github.io/ink-if-story-template/reference/audio)

### 数据库与社区 wiki

- [VNDB — Tag: Voice Acting (g402)](https://vndb.org/g402)（16 个子标签的分类入口）
- [VNDB 子标签页：g135](https://vndb.org/g135) [g774](https://vndb.org/g774) [g3730](https://vndb.org/g3730) [g3858](https://vndb.org/g3858) [g3686](https://vndb.org/g3686) [g2126](https://vndb.org/g2126) [g836](https://vndb.org/g836) [g2088](https://vndb.org/g2088) [g1484](https://vndb.org/g1484) [g2358](https://vndb.org/g2358) [g2397](https://vndb.org/g2397)
- [VNDB kana API（标签定义与计数的程序化查询）](https://api.vndb.org/kana/tag)
- [VNDev Wiki — Voice acting（Full/Partial/Bark Lines/Dialogue Blips/配音制作流程）](https://vndev.wiki/Voice_acting)
- [VNDev Wiki — Narrative features（History / Rollback / Autoplay / Skipping）](https://vndev.wiki/Narrative_features)
- [VNDev Wiki — Autoplay（自动前进的时间计算因子）](https://vndev.wiki/Autoplay)
- [VNDev Wiki — Skipping（跳过模式的各种变体）](https://vndev.wiki/Skipping)
- [ごいしはまぐり — ティラノスクリプト備忘録36 ボイス再生（`[vo~]` vs `[playse]`、autoplay 等待）](https://www.goihama.games/2469/)
- [ごいしはまぐり — ティラノスクリプト備忘録42 ボイス再生マクロ（跨行宏）](https://www.goihama.games/2717/)
- [BOOTH — ティラノスクリプト-VOICEVOX-プラグイン（preset/chara/ruby 完整参数与用法）](https://booth.pm/ja/items/6017687)
- [GitHub — Ouvill/tyrano_voicevox_plugin](https://github.com/Ouvill/tyrano_voicevox_plugin)
- [note — ボイス再生機能拡張プラグイン（音量驱动口型、不支持同一角色多部件同时动画）](https://note.com/skt_order/n/nb85f985e028a)
- [GitHub — TAKASHI-S97/PlayseEx（Howler 不支持 pitch、Web Audio 移植、口型逻辑需同步迁移、pitch 改速度）](https://github.com/TAKASHI-S97/PlayseEx)
- [Reddit — Ren'Py（部分配音作品的 auto-advance 需求）](https://www.reddit.com/r/RenPy/comments/1btizej/voice_acted_autoadvance/)
- [Reddit — Ren'Py（auto voice 因 id 漂移不播的案例）](https://www.reddit.com/r/RenPy/comments/vovwoe/auto_voice_problems_and_attempt_to_fix_it)
- [Reddit — visualnovels（玩家希望「能跳过语音」的诉求）](https://www.reddit.com/r/visualnovels/comments/10a68ih/do_you_listen_to_the_voice_lines_completely_when/)

### TTS 厂商文档

- [Fish Audio — Emotion Control（71 个情绪/语气/音效标记全表 + 最佳实践）](https://docs.fish.audio/developer-guide/core-features/emotions)
- [Fish Audio 文档源码（emotion-list-*.mdx 片段）](https://github.com/fishaudio/docs)
- [Fish Audio — Text to Speech API Reference](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech)
- [ElevenLabs — Audio Tags 101: Directing emotional TTS in Eleven v3（与 SSML 对照表）](https://elevenlabs.io/blog/v3-audiotags)
- [ElevenLabs — Latency optimization（三类端点、chunk schedule、auto_mode、区域延迟）](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization)
- [ElevenLabs — Edit voice settings（stability / similarity_boost / style / speed）](https://elevenlabs.io/docs/api-reference/voices/settings/update)
- [OpenAI — Text to speech guide（`instructions` 自由文本语气）](https://developers.openai.com/api/docs/guides/text-to-speech)
- [Amazon Polly — Supported SSML tags（含各音色类型的可用性矩阵）](https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html)
- [Amazon Polly — Using phonetic pronunciation（IPA / X-SAMPA / pinyin / yomigana / pron-kana）](https://docs.aws.amazon.com/polly/latest/dg/phoneme-tag.html)
- [Amazon Polly — Controlling volume, speaking rate, and pitch](https://docs.aws.amazon.com/polly/latest/dg/prosody-tag.html)
- [Amazon Polly — Amazon Polly Features](https://aws.amazon.com/polly/features)
- [Google Cloud TTS — Speech Synthesis Markup Language (SSML) reference（break/say-as/phoneme/sub/audio/自定义发音词典）](https://docs.cloud.google.com/text-to-speech/docs/ssml)
- [Google Cloud TTS — Quotas & limits](https://docs.cloud.google.com/text-to-speech/quotas)
- [Microsoft Azure — Voice and sound with SSML（mstts:express-as）](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-voice)
- [Microsoft Azure — SSML overview](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup)
- [Coval — Cartesia Sonic 3.6 TTS latency and accuracy benchmark（413 ms TTFB）](https://benchmarks.coval.ai/models/sonic-3.6)
- [composite-voice — CartesiaTTS（context-based streaming 跨块韵律一致）](https://composite-voice.com/docs/guides/tts/cartesia-tts)

### TTS 工程实践

- [Deepgram — Text Chunking for TTS REST Optimization（三级切分策略）](https://developers.deepgram.com/docs/text-chunking-for-tts-optimization)
- [Deepgram — Batch Text-to-Speech Scalable Voice Generation Guide（成本削减 40–60%）](https://deepgram.com/learn/batch-text-to-speech-scalable-voice-generation-guide)
- [Pipecat — TTS Cache（缓存键 = normalized text + voice ID + model + sample rate + settings）](https://docs.pipecat.ai/api-reference/server/services/tts/tts-cache)
- [Voice Studio — Models & Cache（content hash of text + voice + engine + all settings）](https://voicestudio.msrbuilds.com/docs/models-and-cache)
- [seed-audioai — Text to Speech Long Text: Chunking Without Audible Seams（静默截断告警）](https://seed-audioai.com/blog/text-to-speech-long-text)
- [dev.to — From Stochastic Drifting to Vector Anchors: Cross-sentence voice stability](https://dev.to/lcmd007/from-stochastic-drifting-to-vector-anchors-how-i-solved-voice-consistency-in-qwen-tts-4dff)
- [Versely — What Style Locking Means in TTS](https://www.versely.studio/blog/style-locking-ai-text-to-speech-2026)
- [Veydh — RVC in the Stack: Voice Conversion After TTS](https://blog.veydh.com/2026/2026-04-rvc-voice-conversion-architecture)
- [Comfyui-Index-TTS2 — Voice Consistency Guide](https://github.com/xuchenxu168/Comfyui-Index-TTS2/blob/main/docs/voice_consistency_guide.md)
- [GitHub — AI-BOT-Life：调研-语音情绪动态调参（参考音频管情绪方向、动态参数管能量与稳定）](https://github.com/xgx042375/AI-BOT-Life/blob/main/docs/%E8%B0%83%E7%A0%94-%E8%AF%AD%E9%9F%B3%E6%83%85%E7%BB%AA%E5%8A%A8%E6%80%81%E8%B0%83%E5%8F%82-2026-09-11.md)
- [GitHub — hexgrad/kokoro（82M 参数开源 TTS，54 音色，24kHz）](https://github.com/hexgrad/kokoro)

### 浏览器与 Web 平台规范

- [MDN — AudioBufferSourceNode: start() method（when/offset/duration 语义、只能调一次）](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start)
- [MDN — BaseAudioContext: decodeAudioData()（异步解码、重采样到 AudioContext 采样率）](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)
- [MDN — Autoplay guide for media and Web Audio APIs（自动播放四条件、浏览器配置项、iframe 策略）](https://developer.mozilla.org/en-US/docs/Web/Media/Autoplay)
- [MDN — Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [MDN — AudioParam: setValueAtTime()（以 AudioContext.currentTime 为基准调度）](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/setValueAtTime)
- [web.dev — A tale of two clocks（双时钟模型 + look-ahead scheduler，Chris Wilson）](https://web.dev/articles/audio-scheduling)
- [BrowserStorage.com — Storage Quotas & Eviction Policies（Firefox 20% 组 / 10 GB 单源 / LRU / persist()）](https://www.browser-storage.com/browser-storage-fundamentals-quotas/storage-quotas-eviction-policies)
- [Ircam — Timing and Scheduling（Web Audio 前瞻调度器原理）](https://ircam-ismm.github.io/webaudio-tutorials/scheduling/timing-and-scheduling.html)

### 口型同步工具

- [GitHub — DanielSWolf/rhubarb-lip-sync（6–9 种 2D 嘴型）](https://github.com/DanielSWolf/rhubarb-lip-sync)
- [hysenlabs — Rhubarb Lip Sync CLI 安装与使用](https://hysenlabs.com/projects/danielswolf-rhubarb-lip-sync)
- [Visionaire Studio Wiki — Lip sync（Rhubarb 集成 + A–H 嘴型帧序表）](https://wiki.visionaire-tracker.net/wiki/Lip_sync)
- [itch.io — Automatic LipSync for Ren'Py（音量驱动口型）](https://jaybe-games.itch.io/automatic-anime-lipsync-plugin-for-renpy)
- [GitHub — pkhungurn/talking-head-anime-3-demo（THAnime 音素驱动口型）](https://github.com/pkhungurn/talking-head-anime-3-demo)
