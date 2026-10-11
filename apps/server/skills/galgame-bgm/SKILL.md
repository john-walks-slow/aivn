---
name: galgame-bgm
description: 为 galgame / Visual Novel 生成可垫对白、可循环的日系 BGM。覆盖 Lyria 3.5 纯文本提示词结构、配器、和声修辞、七类场景范例、负向排除，以及 mood / scene / tags / loop / volume 元数据对齐。当需要为剧目创作或扩展背景音乐时使用。
user-invocable: true
---

# galgame-bgm

目标工具：`generate_bgm`。它只接收一段英文 `prompt`，后台排产后落盘到 `assets/bgm/<id>.m4a`（AAC 48kHz，约 176 秒）。没有时长参数、没有独立 Exclude 开关、没有独立 Instrumental 开关；所有正向与负向约束都写进同一个英文字符串。

生成是后台任务，不要等待音频到货再继续写作。生成完成后再用 `annotate_asset(kind="bgm", name=...)` 补齐标题、描述和选曲元数据；不要把未完成的曲子写进剧本引用。

## §0. 核心声学约束

每条 BGM 都服务于长对白和反复播放。提示词中必须表达以下三条物理约束：

- **频段留白**：`sparse midrange, restrained presence in the 1 kHz–4 kHz dialogue range, clear space for spoken dialogue`。1kHz–4kHz 是角色语音主要存在区，避免密集钢琴和弦、明亮铜管、厚墙式中频弦乐盖住配音。
- **平坦动态**：`flat, consistent dynamics throughout, no cinematic swell, no gradual crescendo, no dramatic build`。禁止影视配乐式渐强、爬坡和突然高潮；循环第二遍必须与第一遍同一能量级。
- **无缝循环**：`seamless loop, loopable, stable repeating phrase, no abrupt start or ending, no fade-in, no fade-out`。不要写明确前奏、尾奏、终止感或一次性结尾。

默认再加：`steady tempo, restrained arrangement, background music under dialogue`。除非明确做片头/片尾，galgame BGM 优先 `loop: true`。

## §1. 六段式提示词黄金蓝图

严格按此顺序拼成**一段英文字符串**：

```text
[用途与首句纯器乐锚定] + [核心配器] + [日系风格与和声色彩] + [情绪走向] + [速度/动态/循环] + [末尾终极负向排除]
```

### 1. 用途与首句纯器乐锚定

首句必须直接开始：

```text
Instrumental only, no vocals, no lyrics, no humming; background BGM under character dialogue for a Japanese visual novel.
```

纯器乐要求必须在**开头首句**出现一次；模型偶尔会泄漏哼唱或无词人声，不能只依赖默认行为。

### 2. 核心配器

写一个主角乐器，加一到两个低存在感铺底声部：`solo piano with a soft strings pad`、`music box with celesta accents`、`fingerpicked acoustic guitar with soft piano`。不要把十种乐器堆在一起。

### 3. 日系风格与和声色彩

用可触发的声学与和声描述，不单写圈内黑话。例：`warm major seventh and add9 chords, gentle secondary-dominant motion`、`pentatonic melody with a restrained traditional Japanese folk touch`。

### 4. 情绪走向

写状态和转折，不写空泛标签：`tender but hesitant`、`melancholic yet quietly hopeful`、`tense and restrained, never resolving fully`。循环 BGM 通常保持微小变化，不做一次性高潮。

### 5. 速度 / 动态 / 循环

给 BPM 或可感知速度，再写三条硬约束：`flat consistent dynamics`、`no cinematic swell`、`seamless loop with no fade-in or fade-out`。上游固定约 176 秒，BPM 不会改变文件长度。

### 6. 末尾终极负向排除

每条 prompt 最后必须再次写：

```text
Instrumental only, no vocals, no lyrics, no humming, no vocalise, no choir, no spoken words; no cinematic swell, no dramatic build, no abrupt ending, no fade-in, no fade-out.
```

开头和末尾双重锚定是纯器乐的强制规则。不要用 Suno 风格的 `Exclude:` 字段，也不要把否定词放到工具参数外。

## §2. 配器选型表

| 用途 / 气质 | 推荐写法 | 控制点 |
| --- | --- | --- |
| 校园日常 | `solo piano with light pizzicato strings` | 钢琴少音、留中频空位 |
| 温柔闲聊 | `fingerpicked acoustic guitar with soft piano accents` | 不要完整鼓组 |
| 心动告白 | `solo piano with a very soft strings pad` | 长音铺底，避免弦乐旋律抢对白 |
| 黄昏怀旧 | `music box with celesta and sparse piano` | 高音点缀，低动态 |
| 雨中别离 | `sparse solo piano with soft sustained cello` | 钢琴稀疏，低音不轰 |
| 悬疑调查 | `low felt piano with a restrained viola drone` | 无冲击鼓、无电影式低频冲击 |
| 梦境八音盒 | `delicate music box with celesta and airy synth pad` | 梦幻但不厚、不做 EDM |
| 终章誓言 | `warm solo piano with gentle legato strings` | 情绪宽但动态平，不能变预告片 |

**为什么不用完整管弦乐队**：`full orchestra`、`epic orchestral` 会增加中低频密度、铜管瞬态和电影式动态，模型容易生成主题曲或预告片；对白被压住，循环又会在固定位置重复高潮。日系视觉小说底色是**单件独奏 + 少量铺底**。需要规模感时用 `warm piano + restrained legato strings`，不要用 `full orchestra`。

## §3. 和声色彩与日系修辞词典

| 中文意图 | 直接可用的英文声学 / 和声修辞 |
| --- | --- |
| 王道、明亮日系 | `warm major seventh and add9 chords, gentle secondary-dominant feel, bright open voicings` |
| 轻快校园 | `major key, diatonic pop harmony, light syncopation, short repeating piano motif` |
| 物哀、淡淡遗憾 | `minor key with suspended tones, wistful chromatic passing chords, bittersweet major-sixth color` |
| 物哀但不绝望 | `melancholic minor harmony resolving briefly to warm major seventh chords, quietly hopeful` |
| 和风 | `pentatonic melody, open fifths, restrained traditional Japanese folk touch` |
| 和风现代化 | `pentatonic fragments over warm add9 chords, subtle Japanese folk color without theatrical gestures` |
| 空灵 | `open fifths, suspended second chords, high-register sparse notes, unresolved suspended cadence` |
| 梦幻 | `Lydian brightness, celesta over add9 chords, slow arpeggios, airy sustained pad` |
| 心动、犹豫 | `warm major seventh chords with gentle chromatic inner voice movement, unresolved cadence` |
| 哀婉、泪点 | `minor ninth color, descending bass line, sparse suspended piano voicings, delayed resolution` |
| 决意、救赎 | `steady major-key progression, rising inner voices, warm suspended-to-major resolutions without a climax` |
| 悬疑暗流 | `minor mode, low pedal tone, semitone tension, sparse dissonant seconds, unresolved cadence` |
| 都市冷色 | `electric piano, restrained synth pad, suspended fourths, cool close voicings, minimal rhythmic pulse` |

不要只写 `Marunouchi progression`、`Yonanuki`、`物哀` 或 `和风`。这些词不够稳定，必须展开成上表里的和弦、音阶、声部和终止描述。不要写曲名、作者名或 `instrumental version of ...`，否则模型会趋向翻唱。

## §4. 七大经典场景风格矩阵

以下 prompt 均为可直接复制的单段英文字符串。每条都把纯器乐锚定放在首句与末尾，并默认服务对白、平坦动态、无缝循环。

### 1. 校园日常 / 闲聊放学

- 建议 BPM：`92–108 BPM`
- 和声特征：明亮大调、maj7/add9、短小重复动机、稀疏中频
- 应用：教室、社团、放学路、轻松闲聊

```text
Instrumental only, no vocals, no lyrics, no humming; light background BGM under casual character dialogue in a Japanese visual novel. Solo piano with gentle pizzicato strings and a few soft acoustic guitar accents, warm major seventh and add9 chords, bright open voicings, a simple pentatonic piano motif with a light Japanese pop feel. Cheerful and relaxed with a small wistful aftertaste, friendly rather than hyperactive. 100 BPM, steady tempo, sparse midrange, restrained presence in the 1 kHz–4 kHz dialogue range, flat consistent dynamics throughout, no cinematic swell, seamless loop, loopable, stable repeating phrase, no abrupt start or ending, no fade-in or fade-out. Instrumental only, no vocals, no lyrics, no humming, no vocalise, no choir, no spoken words; no cinematic swell, no dramatic build, no abrupt ending, no fade-in, no fade-out.
```

### 2. 心动暗恋 / 独处告白

- 建议 BPM：`68–82 BPM`
- 和声特征：温暖 maj7、add9、内声部半音移动、悬置不解决
- 应用：独处、告白前、犹豫、关系确认

```text
Instrumental only, no vocals, no lyrics, no humming; intimate background BGM under a quiet confession scene in a Japanese visual novel. Tender solo piano with a very soft legato strings pad, warm major seventh and add9 chords, gentle chromatic inner voice movement, an unresolved suspended cadence, delicate high-register fills with plenty of silence. Tender and hopeful but hesitant, slowly becoming emotionally certain without a climax. 76 BPM, sparse midrange, restrained presence in the 1 kHz–4 kHz dialogue range, soft even articulation, flat consistent dynamics throughout, no cinematic swell, seamless loop, loopable, no abrupt start or ending, no fade-in or fade-out. Instrumental only, no vocals, no lyrics, no humming, no vocalise, no choir, no spoken words; no cinematic swell, no dramatic build, no abrupt ending, no fade-in, no fade-out.
```

### 3. 黄昏归途 / 怀旧物哀

- 建议 BPM：`72–88 BPM`
- 和声特征：小调与温暖大七和弦交替、下行低音、五声音阶
- 应用：夕阳街道、回家、童年回忆、旧物
- 注意：`nostalgic` 单独使用容易带出鼓点；必须绑定稀疏、无鼓或极轻打击乐。

```text
Instrumental only, no vocals, no lyrics, no humming; quiet background BGM under reflective dialogue on a sunset walk in a Japanese visual novel. Music box and soft felt piano with a very light sustained cello pad, pentatonic melody with a restrained traditional Japanese folk touch, minor key with warm major seventh colors, wistful chromatic passing chords and a gentle descending bass line. Bittersweet, nostalgic in a fragile and private way, warm memories with no rhythmic drive. 80 BPM, sparse and rubato-like phrasing over a steady pulse, no drum groove, no beat-led percussion, restrained presence in the 1 kHz–4 kHz dialogue range, flat consistent dynamics, no cinematic swell, seamless loop, loopable, no abrupt start or ending, no fade-in or fade-out. Instrumental only, no vocals, no lyrics, no humming, no vocalise, no choir, no spoken words; no cinematic swell, no dramatic build, no prominent drums, no beat drop, no abrupt ending, no fade-in, no fade-out.
```

### 4. 泪点别离 / 雨中哀婉

- 建议 BPM：`58–72 BPM`
- 和声特征：小调九和弦、下行低音、延迟解决、重复强化哀婉与纯器乐
- 应用：雨天车站、离别、道歉后、崩溃前的克制段落
- 注意：模型容易回归中性；同时写 `deeply sorrowful`、`grief-stricken but restrained`、`achingly bittersweet`，但保持对白空间和低动态。

```text
Instrumental only, no vocals, no lyrics, no humming; deeply sorrowful instrumental background BGM under spoken dialogue during a rainy farewell in a Japanese visual novel. Sparse solo piano with soft sustained cello and distant felt-string harmonics, minor ninth color, descending bass line, delayed resolution, suspended piano voicings, occasional chromatic passing tones. Grief-stricken and aching, deeply melancholic yet restrained, quietly devastated and unable to let go, not neutral, not cheerful, not merely wistful. 64 BPM, sparse midrange, restrained presence in the 1 kHz–4 kHz dialogue range, no rhythmic groove, flat consistent dynamics throughout, no cinematic swell, seamless loop, loopable, stable repeating phrase, no abrupt start or ending, no fade-in or fade-out. Instrumental only, no vocals, no lyrics, no humming, no vocalise, no choir, no spoken words; no cinematic swell, no dramatic build, no neutral mood, no cheerful resolution, no drums, no abrupt ending, no fade-in, no fade-out.
```

### 5. 悬疑暗流 / 调查对峙

- 建议 BPM：`72–92 BPM`
- 和声特征：小调、低音持续音、半音张力、稀疏不协和二度、不解决终止
- 应用：调查、走廊、秘密揭露前、对峙

```text
Instrumental only, no vocals, no lyrics, no humming; restrained suspense background BGM under investigation dialogue and a quiet confrontation in a Japanese visual novel. Low felt piano with a restrained viola drone, sparse low pedal tone, minor mode, semitone tension, occasional dissonant seconds, muted bass pulses with no impact hits. Tense, suspicious and watchful, gradually tightening through harmonic pressure while remaining controlled and unresolved. 84 BPM, minimal pulse, sparse midrange, clear space in the 1 kHz–4 kHz dialogue range, flat consistent dynamics throughout, no cinematic swell, seamless loop, loopable, no abrupt start or ending, no fade-in or fade-out. Instrumental only, no vocals, no lyrics, no humming, no vocalise, no choir, no spoken words; no cinematic swell, no dramatic build, no trailer impacts, no risers, no jump-scare hit, no abrupt ending, no fade-in, no fade-out.
```

### 6. 梦幻序章 / 概念八音盒

- 建议 BPM：`60–76 BPM`
- 和声特征：Lydian brightness、add9、开放五度、悬置终止、高音稀疏点描
- 应用：序章、梦境、世界观揭示、回忆碎片

```text
Instrumental only, no vocals, no lyrics, no humming; delicate conceptual opening BGM under narration and dialogue in a Japanese visual novel. A single music box melody with sparse celesta accents, airy synth pad and occasional high-register piano notes, Lydian brightness, open fifths, suspended second chords, warm add9 harmony and an unresolved suspended cadence. Dreamlike, mysterious and tender, as if a memory is slowly coming into focus, with no dramatic reveal. 68 BPM, very sparse arrangement, restrained presence in the 1 kHz–4 kHz dialogue range, flat consistent dynamics throughout, no cinematic swell, seamless loop, loopable, stable repeating phrase, no abrupt start or ending, no fade-in or fade-out. Instrumental only, no vocals, no lyrics, no humming, no vocalise, no choir, no spoken words; no cinematic swell, no dramatic build, no orchestral hit, no EDM pulse, no abrupt ending, no fade-in, no fade-out.
```

### 7. 终章救赎 / 真爱誓言

- 建议 BPM：`70–86 BPM`
- 和声特征：稳定大调、上行内声部、sus 到 major 的温暖解决；规模感来自和声宽度，不来自音量爬坡
- 应用：终章、重逢、救赎、誓言、结局对白

```text
Instrumental only, no vocals, no lyrics, no humming; warm emotional background BGM under a final love vow and ending dialogue in a Japanese visual novel. Warm solo piano with gentle legato strings, occasional harp harmonics and very soft sustained pads, steady major-key progression, rising inner voices, suspended-to-major resolutions, rich major seventh and add9 chords. Sincere, relieved and deeply loving, moving from exhaustion to quiet trust, emotionally full but intimate and controlled. 78 BPM, sparse midrange, clear space in the 1 kHz–4 kHz dialogue range, restrained arrangement, flat consistent dynamics throughout, no cinematic swell, seamless loop, loopable, no abrupt start or ending, no fade-in or fade-out. Instrumental only, no vocals, no lyrics, no humming, no vocalise, no choir, no spoken words; no cinematic swell, no dramatic build, no heroic brass, no trailer percussion, no abrupt ending, no fade-in, no fade-out.
```

## §5. 负向与陷阱词避坑表

| 陷阱词 / 写法 | 常见偏移 | 替代写法 |
| --- | --- | --- |
| `anime opening`, `opening theme` | 燃曲、主旋律前置、鼓点和高潮 | `Japanese visual novel background BGM under dialogue` |
| `lo-fi hip-hop`, `chillhop` | 明显 boom-bap 鼓点、采样感，盖对白 | `soft felt piano, sparse pulse, no drum groove` |
| `epic orchestral`, `full orchestra` | 影视轰炸、铜管、宽动态 | `solo piano with restrained legato strings` |
| `cinematic`, `trailer music` | 渐强、riser、impact、固定高潮 | `flat consistent dynamics, no cinematic swell` |
| `rock band`, `guitar riff` | 摇滚鼓组和失真电吉他 | `fingerpicked acoustic guitar, no drum kit` |
| `EDM`, `electronic dance` | 四拍底鼓、drop、舞曲结构 | `airy synth pad, no beat drop` |
| `8-bit chiptune`, `retro game music` | 粗糙芯片音效、方波旋律 | `celesta and delicate music box` |
| `nostalgic`（单独使用） | 怀旧流行鼓点、轻快伴奏 | `fragile private nostalgia, no drum groove, sparse piano` |
| `sad song`, `vocal ballad` | 歌曲结构、主唱或哼唱 | `instrumental only, sparse piano, no vocalise` |
| `with vocals`, `singer`, `female voice` | 人声主体，盖角色配音 | `no vocals, no lyrics, no humming` |
| `choir`, `vocalise`, `ooh`, `aah` | 无词人声泄漏 | `no choir, no vocalise, no humming` |
| `building to a climax`, `rising climax` | 每次循环都在相同位置爬坡 | `flat consistent dynamics, no dramatic build` |
| `clear beginning and ending`, `intro`, `outro` | 前奏尾奏和接缝突变 | `no abrupt start or ending, seamless loop` |
| 曲名、作者名、`instrumental version of ...` | 翻唱、模仿既有旋律 | 描述乐器、和弦、音阶与动态 |

## §6. 元数据填写与素材库对齐

### 6.1 工具顺序

1. 先确定素材 id 和 prompt，调用 `generate_bgm`；它后台排产，约 40–84 秒，不阻塞当前轮。
2. 收到到货后调用 `annotate_asset(kind="bgm", name="<id>", ...)`。BGM 的标题、描述、`mood`、`scene`、`tags`、`loop`、`volume` 都通过这一步补齐或修改。
3. 剧本引用使用 `<scene bgm="<id>" />`；不要引用仍在排产或失败的 id。

### 6.2 字段规则

| 字段 | 规则 |
| --- | --- |
| `title` | 中文短标题，能体现画面用途，不写技术参数 |
| `description` | 写「哪一段垫什么情绪」，并注明 `不盖对白`、`可整场循环` 等使用条件 |
| `mood` | 2–5 个真实情绪词，只用下方既有枚举 |
| `scene` | 2–5 个真实场景词，只用下方既有枚举 |
| `tags` | 2–5 个真实特征词，只用下方既有枚举 |
| `loop` | 对话垫底、场景循环填 `true`；一次性片头/片尾才填 `false` |
| `volume` | 严格使用 `0.35–0.45`；对白垫底通常 `0.35–0.40`，情绪较重的过场最多 `0.45` |

上游固定约 176 秒，**没有时长入参**。不要写 `short loop`、`30 second loop` 等假时长指令；它们不会缩短文件，只会让结构变潦草。

### 6.3 既有 61 条素材使用的枚举词

不要创造同义词；剧作家会按这些字符串从混合素材清单选曲。

**mood：**

`温柔` `温暖` `治愈` `忧伤` `忧郁` `惆怅` `哀婉` `悲伤` `怀念` `怀旧` `日常` `轻松` `轻快` `俏皮` `安静` `平静` `沉思` `寂寥` `孤独` `压抑` `紧张` `压迫` `诡异` `清冷` `空灵` `心动` `酸涩` `不舍` `释然` `决意` `宏大` `明亮` `微妙` `隐忍` `期待`

**scene：**

`日常` `闲聊` `校园` `校园日常` `教室` `放学` `社团` `回忆` `独白` `内心戏` `告白` `别离` `告别` `初遇` `和解` `道歉` `过场` `转场` `开场` `角色登场` `片尾` `结局` `高潮` `咖啡馆` `图书馆` `街道` `郊外` `都市` `海边` `黄昏` `夜晚` `雨天` `夏天` `假期` `周末` `对峙` `危机` `追逐` `悬疑` `推理` `梦境` `等待` `犹豫` `独处` `崩溃`

**tags：**

`日系` `钢琴` `八音盒` `钢片琴` `弦乐` `竖琴` `尤克里里` `合成器` `轻音乐` `环境音` `循环` `都市` `和风` `西式` `概念原声` `角色主题曲` `日常` `校园` `回忆` `温柔` `伤感` `轻快` `推进` `怀旧` `治愈` `诡异`

### 6.4 标注范例

```text
annotate_asset(
  kind="bgm",
  name="confession_dusk",
  title="黄昏里的回答",
  tags=["日系", "钢琴", "弦乐", "循环"],
  mood=["温柔", "心动", "微妙"],
  scene=["告白", "独处", "黄昏"],
  loop=true,
  volume=0.35,
  description="两人放学后独处并慢慢确认心意时垫底；无明显前奏尾奏，不盖对白，可整场循环。"
)
```

## §7. 调优排障五步法

一次生成通常要等 40–84 秒。每次只改一个变量，按以下顺序定位：

1. **先查人声泄漏**：prompt 开头首句和末尾是否都含 `instrumental only, no vocals, no lyrics, no humming`；再补 `no vocalise, no choir, no spoken words`。不要先改曲风。
2. **再查循环接缝**：加入 `seamless loop, loopable, stable repeating phrase, no abrupt start or ending, no fade-in, no fade-out`；删除 `intro`、`outro`、`clear beginning and ending`、`building to a climax`。
3. **再查对白遮挡**：把配器减到一个主乐器 + 一层铺底，加入 `sparse midrange, restrained presence in the 1 kHz–4 kHz dialogue range`；删掉完整乐队、铜管、厚鼓组。
4. **再查动态和场景偏移**：加入 `flat consistent dynamics, no cinematic swell, no dramatic build`；将模糊标签改为可触发的和弦、音阶、声部与 BPM。`nostalgic` 偏鼓点时改成 `fragile private nostalgia, no drum groove`。
5. **最后才改情绪词**：使用成对走向，如 `sad but hopeful`、`tender but hesitant`、`tense and unresolved`。不要同时替换配器、BPM、和声和情绪，否则无法判断是哪一项起效。
