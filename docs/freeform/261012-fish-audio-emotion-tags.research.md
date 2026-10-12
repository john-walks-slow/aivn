# Fish Audio 语音情感/语气标记（Emotion / Expression Tags）调研报告

- 调研日期：2026-10-12
- 目标模型：`s2.1-pro-free`（`POST https://api.fish.audio/v1/tts`）
- 使用场景：AIVN 引擎，剧作家模型在单行台词内联写语气标记，整行原样送 TTS，标记对玩家不可见
- 调研方法：官方文档（docs.fish.audio 全量 `llms-full.txt`）+ 官方博客/GitHub/HuggingFace + 第三方集成商文档 + 社区 issue/教程 + **本机 `s2.1-pro-free` 实测（21 次请求 + 9 次 ASR 回读验证）**

> 本报告严格区分 **「官方文档明确支持」**（标注 `【官方】`）与 **「社区实践 / 未证实 / 第三方」**（标注 `【社区】`/`【第三方】`），并单列 **「本机实测」**（`【实测】`）。

---

## 0. TL;DR —— 最需要在提示词里写死的 8 条事实

1. **语法是方括号 `[tag]`，不是小括号 `(tag)`、不是 `<|tag|>`。** S2/S2.1 系列用 `[ ]`；`( )` 是已废弃的 S1 专属语法，S2.1 会**静默忽略**（既不生效、也不会被念出来）。`<|...|>` 是保留语法，只用于说话人 `<|speaker:N|>` 与音素 `<|phoneme_start|>/<|phoneme_end|>`，**没有** `<|laugh|>` 这种标记。`【官方】`
2. **标记永远不会被念出来。** 无论大小写、是否有效、是否中文、是否残留未闭合方括号，标记文本都不会进入语音。**无效标记 = 静默失效（不是报错）**。`【实测】`+`【官方】`
3. **S2.1-Pro 的标记集合是开放域的（open-domain），不是固定清单。** 官方原文：*"S2.1-Pro and S2-Pro treat `[bracket]` tags as standard text rather than dedicated control tokens"*。任何自然语言描述理论上都会被尝试执行。所以「官方完整清单」只应被当作**高命中率的锚点词**，而非白名单。`【官方】`
4. **位置即语义（Placement IS meaning）。** 标记从出现位置起生效，直到**下一个标记**或**句末**。句首 = 整句；句中 = 从该点开始。情绪类标记官方建议放**句首**；音量/语气类可放任意位置。`【官方】`
5. **叠加不超过 3 个（官方），社区建议 ≤2 个。** 互相物理冲突的组合（如 `[whispering]` + `[shouting]`）会产出不稳定音频。`【官方】`+`【第三方】`
6. **不要以标记结尾。** 单独一个 `[sad]` 后面没有文本时，官方明确说「输出不可预测」；实测该情况会产出一段纯非语言声音（ASR 听到一个 gasp 声），不是可控的台词。`【官方】`+`【实测】`
7. **情绪标记不计入 token 限制**（官方 Performance Notes），但 API 计费按**输入文本 UTF-8 字节数**计（`$15.00 / M UTF-8 bytes`；`s2.1-pro-free` 为 `$0.00`），标记文本是否计入计费字节官方未明确说明。`【官方】`
8. **API 层不做内容过滤。** 实测含 `[moaning][panting]` 乃至显式中日文成人文本的请求全部返回 `HTTP 200` 并正常出音频；但 Fish Audio 的 AUP/ToS **书面禁止**色情内容并保留封号权。二者并存 → **技术可行，合规风险自负**。`【实测】`+`【官方】`

---

## 1. 2026-10 引擎与模型现状

### 1.1 官方当前 TTS 模型线

| model header | 状态 | 语法 | 备注 |
|---|---|---|---|
| `s2.1-pro` | **推荐生产** | `[bracket]` 开放域 | 83 语言，多说话人，TTFA/DPA 保证，`$15.00 / M UTF-8 bytes` |
| `s2.1-pro-free` | **免费开发者层** | 同上 | **与 s2.1-pro 是同一个模型**，同样质量与语言覆盖；无 TTFA/DPA 保证；fair-use 限制。官方 changelog：**免费至 2026-11-30** |
| `s2-pro` | 上一代 | `[bracket]` 开放域 | 80+ 语言，100ms TTFA，完全开源（Qwen3-4B backbone） |
| `s1` | **已弃用**，2026-12-31 退役 | `(parenthesis)` 固定 64+ 标签集 | 退役后 `model: s1` 自动由 `s2.1-pro` 承接并按 s2.1-pro 计费 |
| `drama-3-preview` | Preview（新） | `[bracket]` 方向 + `<paired>` 标签 | 见 §6 |

关键原文（[Models Overview](https://docs.fish.audio/developer-guide/models-pricing/models-overview)）：

> **s2.1-pro-free** — Fish Audio S2.1-Pro Free - **The same model as S2.1-Pro**, available at $0 for development and testing
> - Use the `s2.1-pro-free` model string with the same TTS API endpoint
> - **Same model quality and language coverage as `s2.1-pro`**
> - Free to use under fair-use limits
> - **No TTFA or DPA guarantees**

→ **`s2.1-pro-free` 支持全部标记能力，与 `s2.1-pro` 无差别**（官方明写「同一个模型」）。两者的差别只在 SLA/延迟保证，不在标记支持。

### 1.2 到期风险

[Changelog](https://docs.fish.audio/developer-guide/getting-started/changelog) 原文：

> `s2.1-pro-free` is the same model at no cost **through November 30, 2026** for testing, prototyping, development, and smaller businesses, under fair-use limits and without those guarantees.

**⚠️ 免费期 2026-11-30 结束**，之后需要切到付费 `s2.1-pro`（或自行承担后果）。这对本项目（一行台词一次请求、量大）是关键成本项。

### 1.3 S1 退役对「旧语料」的影响

[Migrate from S1](https://docs.fish.audio/developer-guide/models-pricing/migrate-from-s1) 明确列出 S2.1-Pro 与 S1 的三处行为差异：

> - **S1-style `(happy)` emotion tags are not interpreted as tags**, and the API does not convert them.
> - **Loudness normalization is applied to the output.**（`prosody.normalize_loudness` 默认 `true`，S1 上无效、S2 上生效）
> - **`repetition_penalty` has no effect.**（S1 生效，S2.1-Pro 无效）

---

## 2. 语法权威结论（最重要的部分）

### 2.1 三种语法形态，只有一种正确

| 形态 | 归属 | 在 `s2.1-pro` / `s2.1-pro-free` 上的行为 | 依据 |
|---|---|---|---|
| `[happy]`、`[whispering]`、`[用低沉沙哑的嗓音]` | **S2 / S2.1 正典** | ✅ 生效 | `【官方】` |
| `(happy)`、`(whispering)`、`(break)`… | S1 旧语法（部分亦是 v1.6 paralanguage） | ⚠️ **不生效**，见下 | `【官方】`+`【实测】` |
| `<|laugh|>`、`<|whisper|>` | **不存在** | ❌ 无此语法 | `【实测】` |
| `<|speaker:0|>`、`<|phoneme_start|>` | S2 保留 token | 仅用于说话人切换 / 音素注音 | `【官方】` |

**官方对 `()` 的定论**（[Emotion Control](https://docs.fish.audio/developer-guide/core-features/emotions)、[Emotion & Expression Control](https://docs.fish.audio/developer-guide/best-practices/emotion-control) 两处均置顶 Warning）：

> The API does not convert `(parenthesis)` tags to `[bracket]` cues, so rewrite them in S2 syntax.
> S1-style `(happy)` text sent to S2 **is not interpreted as a tag**.

**注意一处官方文档内部的张力（对本项目有实际影响）**：
- [Fine-grained Control](https://docs.fish.audio/developer-guide/core-features/fine-grained-control) 与 Emotions 页把 `(break)` `(long-break)` `(breath)` `(laugh)` `(cough)` `(lip-smacking)` `(sigh)` 列为**小括号的 paralanguage 特殊效果**（"First Available V1.6，Stage: Experimental"，并注明 `(laugh)`/`(cough)`/`(lip-smacking)`/`(sigh)` "are developing. You may need to repeat them multiple times for better results."）。
- 而 [Runware 的 S2.1 Pro 集成文档](https://runware.ai/docs/models/fish-audio-s2-1-pro/guides/emotion-and-expression) 称：*"Paralanguage cues require `settings.normalize` set to `false`. With normalization enabled (the default), the model may strip or misinterpret parenthesized tokens."* `【第三方】`

→ **对本项目的建议：不要依赖 `(break)` 类小括号 paralanguage**，用等价的 `[break]` / `[long-break]` / `[pause]` / `[short pause]` / `[long pause]` / `[sigh]` 方括号形式（这些在官方 S2 清单里都有）。这样既规避了 normalize 的不确定性，也保持「全句只出现一种括号语法」的一致性。

### 2.2 大小写 / 空格 / 标点 / 全角 / 中文括号

`【实测】`（本机 `s2.1-pro-free`，逐档 ASR 回读验证，A~J 组 10 例 + K 组 15 例）：

| 输入形态 | 是否被念出来 | 是否生效/可用性 |
|---|---|---|
| `[sad] おかえりなさい…` | ❌ 未念出 | ✅ 生效 |
| `[SAD][WHISPERING] おかえりなさい…` | ❌ 未念出 | 大写出音频时长显著拉长（6.32s vs 基准 3.5s），**未见字母拼读**，说明大写同样被当作语义 cue 处理。注意：**单次样本，未做重复验证**，不能断言大小写完全等价 |
| `[ sad ] おかえりなさい…`（标记内带空格） | ❌ 未念出 | 未确认是否生效 |
| `(sad) おかえりなさい…` | ❌ 未念出 | ⚠️ 官方声明不解释为标记；实测音频时长变化落在噪声区间内（见 §2.4），**倾向无效** |
| `(sad)(whispering) さようなら、もう会えないね。` | ❌ 未念出 | 同上，倾向无效但**不会被念出来**（安全） |
| `【悲しい】おかえりなさい…`（全角方头括号） | ❌ 未念出 | 时长变化在噪声区间，**未证实** |
| `［悲伤］おかえりなさい…`（全角方括号） | ❌ 未念出 | 时长变化在噪声区间，**未证实**。另有第三方文档明确称「中文括号将被视为普通文本」`【第三方】` |
| `[sad おかえりなさい…`（未闭合） | ❌ 未念出 | 音频正常产出，**未证实**是否生效 |
| `[sad[whispering]] おかえりなさい…`（嵌套） | ❌ 未念出 | 音频正常产出，**未证实**。社区称嵌套会被 tokenizer 拆开或忽略 `【社区】` |
| `[sad][😭] おかえりなさい…` | ❌ 未念出 | 输出与 `[sad]+4 个标记` 的字节数**完全一致**（63528B），提示超出部分的标记可能被忽略 |
| `[zzz-nonsense-token-9f3] テストです。` | ❌ 未念出 | **静默失效，不报错，不朗读**（1.59s，与纯文本相当） |
| `[sad]`（标记独占，后面无文本） | — | ⚠️ 产出 2.53s 纯非语言声（ASR 听成 `<GASP>`），**不可控** |

**结论（可直接写进提示词）**：
- 必须用**半角英文方括号 `[` `]`**。
- 标记**内部不含空格**、**不含嵌套**、**不要用引号包裹**（官方 S1 troubleshooting 亦写 "Don't use quotes around tags"）。
- 标记**必须带后续文本**。
- 未知标记**安全但无用**——不会破坏音频，也不会被念出来。这点对本项目很重要：剧作家模型偶尔写错标记，**不会导致玩家听到「square bracket sad」**。

### 2.3 官方英文原文中关于「不会被念出来」的佐证

Agents 文档（[Expressive mode](https://docs.fish.audio/llms-full.txt)）原文：

> The delivery cues are rendered by the voice model. **They are never spoken and never appear in transcripts or message history.**

以及 Emotion Control 页的 Troubleshooting（官方把「标记被念出来」列为**异常**）：

> **Emotion Not Working?**
> 1. Check placement - Put the cue where the emotion or effect should begin
> 2. Keep wording clear - Use concise natural language descriptions
> 3. Use the right syntax - S2 cues use square brackets; S1 cues must use parentheses

S1 版 troubleshooting 更直接：

> 1. Check tag placement (beginning of sentence for emotions)
> 2. **Verify spelling exactly matches the list**
> 3. **Don't use quotes around tags**
> 4. Include parentheses

### 2.4 ⚠️ 方法论坑：**不要用音频时长判断标记是否生效**

`【实测】` 同一句 `おかえりなさい、ご主人様。今日はいい天気ですね。` 在 `temperature=0.7`、无 seed 条件下重复 4 次：

| 输入变体 | 4 次时长 (s) | 均值 |
|---|---|---|
| 纯文本 baseline | 3.735 / 4.284 / 4.859 / 4.153 | **4.258** |
| `(sad) ` + 文本 | 4.571 / 4.519 / 4.153 / 3.918 | 4.291 |
| `[sad] ` + 文本 | 4.101 / 3.970 / 4.232 / 4.441 | 4.186 |
| `[qqq-nonsense-token-9f3] ` + 文本 | 4.023 / 4.336 / 4.441 / 3.918 | 4.179 |
| `[用低沉沙哑的嗓音，像刚哭过一样] ` + 文本 | 4.049 / 4.467 / 3.735 / 3.735 | **3.997** |
| `(sad)(whispering) ` + 文本 | 4.624 / 4.650 / 3.735 / 4.284 | 4.323 |
| `[sad][whispering][soft tone] ` + 文本 | 3.866 / 4.284 / 4.650 / 4.284 | 4.271 |

→ **组间差异（3.997~4.323）远小于组内波动（极差可达 1.1s）**。仅凭时长完全无法区分「生效 / 未生效 / 乱写」。官方的 [JS SDK 文档](https://docs.fish.audio/api-reference/sdk/javascript/api-reference) 亦称 *"results are non-deterministic regardless of seed value"*（ComfyUI 节点文档同）。**判断标记是否生效必须靠人听，或靠对生成音频做描述性评估，不能靠 ffprobe 时长。**

---

## 3. 官方标记清单（S2 / S2.1 `[bracket]` 形式）

> 来源：[Emotion Control](https://docs.fish.audio/developer-guide/core-features/emotions)（本页为 2026-05-27 由 [docs 提交 9184a08](https://github.com/fishaudio/docs/commit/9184a08f69a9a2755fbc2c01bbcdb334269e11e6) 与 [PR #97](https://github.com/fishaudio/docs/pull/97) 重构后的版本；重构把 Tone / Audio Effects / Special Effects 从「Complete Emotion Reference」中拆出，另立「Sound & Delivery Markers」小节，并新增 `[emphasis]` 与 `[clear throat]`）。
> 全部标记均为 `【官方】`。

### 3.1 基础情绪 Basic Emotions（24 个 —— 语义类）

| 标记 | 语义 | 官方给的典型使用场景 |
|---|---|---|
| `[happy]` | 愉悦、上扬 | 好消息、问候 |
| `[sad]` | 忧郁、低沉 | 同情、坏消息 |
| `[angry]` | 挫败、攻击性 | 抱怨、警告 |
| `[excited]` | 高能、热切 | 宣布、庆祝 |
| `[calm]` | 平静、放松 | 说明、冥想 |
| `[nervous]` | 焦虑、不确定 | 免责声明、道歉 |
| `[confident]` | 笃定、自信 | 演示、销售 |
| `[surprised]` | 震惊、惊叹 | 反应、发现 |
| `[satisfied]` | 满足、满意 | 确认、评价 |
| `[delighted]` | 非常愉悦 | 庆祝、赞美 |
| `[scared]` | 恐惧 | 警告、恐怖故事 |
| `[worried]` | 担心、忧虑 | 顾虑、提问 |
| `[upset]` | 心烦、困扰 | 抱怨、问题 |
| `[frustrated]` | 恼怒、气急 | 技术问题、延误 |
| `[depressed]` | 非常悲伤、无望 | 严肃话题 |
| `[empathetic]` | 共情、关怀 | 支持、咨询 |
| `[embarrassed]` | 羞愧、尴尬 | 道歉、失误 |
| `[disgusted]` | 厌恶、反感 | 负面评价 |
| `[moved]` | 被触动 | 感人时刻 |
| `[proud]` | 自豪 | 成就、表扬 |
| `[relaxed]` | 放松、随意 | 日常交谈 |
| `[grateful]` | 感激 | 致谢 |
| `[curious]` | 好奇、探询 | 提问、探索 |
| `[sarcastic]` | 讽刺、挖苦 | 幽默、批评 |

### 3.2 进阶情绪 Advanced Emotions（25 个 —— 语义类）

| 标记 | 语义 | 官方给的典型使用场景 |
|---|---|---|
| `[disdainful]` | 轻蔑、鄙视 | 批评、拒绝 |
| `[unhappy]` | 不满、不快 | 抱怨、反馈 |
| `[anxious]` | 非常焦虑、不安 | 紧急事项 |
| `[hysterical]` | 情绪失控 | 极端反应 |
| `[indifferent]` | 冷漠、无所谓 | 中立回应 |
| `[uncertain]` | 不确定、犹疑 | 推测、提问 |
| `[doubtful]` | 怀疑、质疑 | 不信、质问 |
| `[confused]` | 困惑 | 请求澄清 |
| `[disappointed]` | 失望 | 期待落空 |
| `[regretful]` | 后悔、歉疚 | 道歉、失误 |
| `[guilty]` | 有罪感 | 坦白、道歉 |
| `[ashamed]` | 深深羞愧 | 严重错误 |
| `[jealous]` | 嫉妒、怨恨 | 比较 |
| `[envious]` | 羡慕 | 带欲望的仰慕 |
| `[hopeful]` | 怀抱希望 | 未来计划 |
| `[optimistic]` | 乐观 | 鼓励 |
| `[pessimistic]` | 悲观 | 警告、怀疑 |
| `[nostalgic]` | 怀旧 | 回忆、故事 |
| `[lonely]` | 孤独 | 情感内容 |
| `[bored]` | 无聊、厌倦 | 不感兴趣 |
| `[contemptuous]` | 蔑视 | 强烈批评 |
| `[sympathetic]` | 同情 | 哀悼 |
| `[compassionate]` | 深切关怀 | 支持、帮助 |
| `[determined]` | 坚决 | 目标、承诺 |
| `[resigned]` | 认命、接受失败 | 放弃、接受 |

> 注：基本 + 进阶 = 49。官方标题称"64+ emotional expressions"，差额来自 Tone/Audio Effects/Special Effects（6+11+5=22）—— 49+22=71。文档标题的 "64+" 与 S1 的 "64+" 是同一个营销口径；**S2 的 24/25 分组是官方实际表格**。

### 3.3 语气/音量标记 Tone Markers（6 个 —— 非语言/交付类）

> 官方原文：*"These markers aren't emotions. They shape how a line is delivered, add natural human sounds, or layer in ambient effects."*

| 标记 | 语义 | 使用时机 |
|---|---|---|
| `[in a hurry tone]` | 匆忙、急迫 | 时间敏感信息 |
| `[shouting]` | 大声呼喊 | 引起注意 |
| `[screaming]` | 极大声、恐慌 | 紧急、恐惧 |
| `[whispering]` | 极轻、私密 | 秘密、安静场景 |
| `[soft tone]` | 温柔、安静 | 安慰、摇篮曲 |
| `[emphasis]` | 强调后随词句 | 关键字突出。**放在要强调的词/短语正前方** |

官方 `[emphasis]` 示例：
```
This is [emphasis] really important.
```

### 3.4 音频效果 Audio Effects（11 个 —— 非语言声音类）

| 标记 | 语义 | 官方建议的后随文本 |
|---|---|---|
| `[laughing]` | 完整大笑 | `Ha, ha, ha` |
| `[chuckling]` | 轻笑 | `Heh, heh` |
| `[sobbing]` | 剧烈哭泣 | 可无文本 |
| `[crying loudly]` | 放声大哭 | 可无文本 |
| `[sighing]` | 释然/烦躁的呼气 | `sigh` |
| `[groaning]` | 挫败的哼声 | `ugh` |
| `[panting]` | 气喘 | `huff, puff` |
| `[gasping]` | 猛吸气 | `gasp` |
| `[yawning]` | 打哈欠 | `yawn` |
| `[snoring]` | 鼾声 | `zzz` |
| `[clear throat]` | 清嗓 | `ahem` |

> 官方补注：*"You can also use natural expressions like 'Ha,ha,ha' for laughter without tags."*

### 3.5 特殊效果 Special Effects（5 个 —— 环境/停顿类）

| 标记 | 语义 |
|---|---|
| `[audience laughing]` | 观众笑声 |
| `[background laughter]` | 背景环境笑声 |
| `[crowd laughing]` | 人群哄笑 |
| `[break]` | 短暂停顿 |
| `[long-break]` | 较长停顿 |

### 3.6 官方「well-tested / 常用锚点」补充清单

这些出自其他**官方**页面，与 §3.1–3.5 有交集但扩充了词形，**对提示词非常有用**（本地实测均不报错）：

**（a）S2 官方博客 [Fish Audio S2! Fine-Grained AI Voice Control at the Word Level](https://fish.audio/blog/fish-audio-s2-fine-grained-ai-voice-control-at-the-word-level/)（2026-03-12，作者 Sabrina Shu）—— 分五大类：**

呼吸与反应：
| 标记 | 效果 | 官方示例 |
|---|---|---|
| `[sigh]` | 表达性呼气 | `I tried again. [sigh] Nothing changed.` |
| `[inhale]` / `[exhale]` | 可听见的呼吸 | `[inhale] Okay. Let's do this.` |
| `[gasp]` | 急吸 | `She opened the door. [gasp] It was empty.` |
| `[panting]` | 沉重急促呼吸 | `[panting] I've been running for twenty minutes.` |
| `[clears throat]` | 说话前清嗓 | `[clears throat] Right. Where were we.` |

发声 Vocal Sounds：
| 标记 | 效果 | 官方示例 |
|---|---|---|
| `[laughing]` | 完整笑声 | `[laughing] I have no idea what just happened.` |
| `[chuckling]` | 压抑轻笑 | `[chuckling] Well, that didn't go as planned.` |
| `[giggle]` | 高频轻笑 | `[giggle] You actually said that out loud.` |
| `[sobbing]` | 带喘的哭 | `[sobbing] I just wanted things to be different.` |
| `[crying]` | 带泪的嗓音 | `[crying] Please don't go.` |
| `[groan]` | 不适/无奈 | `[groan] Not this again.` |

节奏 Pacing：
| 标记 | 效果 | 官方示例 |
|---|---|---|
| `[pause]` | 短暂静默 | `I thought about it. [pause] Then said nothing.` |
| `[short pause]` | 更短的拍子 | `Are you sure? [short pause] Really sure?` |
| `[long pause]` | 长静默 | `She looked at him. [long pause] Walk away.` |

嗓音风格 Voice Style：
| 标记 | 效果 | 官方示例 |
|---|---|---|
| `[whispering]` | 气声、低语 | `[whispering] Don't let them hear you.` |
| `[soft voice]` | 轻且温柔 | `[soft voice] Take your time. There's no rush.` |
| `[loud voice]` | 提高音量 | `[loud voice] Can anyone hear me?` |
| `[shouting]` | 全音量 | `[shouting] Get out of the house — now!` |
| `[low voice]` | 更低音域 | `[low voice] I know what you did.` |

情绪（该页只举 3 例）：
| `[excited]` | `[angry]` | `[sad]` |

其他：
| `[emphasis]` | `[rustling sound]`（背景摩擦声） |

官方在该页明确说明：*"Because S2 is trained on open-ended descriptions, **novel tags generalize well** — you're not limited to examples seen during training."*

**（b）[Models Overview](https://docs.fish.audio/developer-guide/models-pricing/models-overview) 的 "Common examples" 短清单：**
```
[whisper] [laugh] [emphasis] [sigh] [gasp] [pause]
[angry] [excited] [sad] [surprised] [inhale] [exhale]
```
并给出句中放置示例：
> `"I can't believe it [gasp] you actually did it [laugh]"`

**（c）[HuggingFace fishaudio/s2-pro](https://huggingface.co/fishaudio/s2-pro) 与 [GitHub fishaudio/fish-speech](https://github.com/fishaudio/fish-speech) README 的 "Rich Emotion Library"（官方 repo，33 个）：**
```
[pause] [emphasis] [laughing] [inhale] [chuckle] [tsk] [singing] [excited]
[laughing tone] [interrupting] [chuckling] [excited tone] [volume up] [echo]
[angry] [low volume] [sigh] [low voice] [whisper] [screaming] [shouting] [loud]
[surprised] [short pause] [exhale] [delight] [panting] [audience laughter]
[with strong accent] [volume down] [clearing throat] [sad] [moaning] [shocked]
```
并声明：**"15,000+ Unique Tags Supported"**。

> ⚠️ 官方在 [GitHub Discussion #1302](https://github.com/fishaudio/fish-speech/discussions/1302) 明确澄清：
> *"There is **no fixed list of 15,000 accepted tags**. The S2 Pro README explicitly describes them as free-form natural-language instructions rather than presets. … The '15,000+' figure **should not be read as a public allowlist that can be enumerated**. Tag adherence is model behavior, so voice, surrounding text, and sampling settings can change the result."*

**这是本报告最重要的「元结论」**：不存在可枚举的官方白名单。

**（d）中文语料里额外被官方 ASR 文档提到的：** `[高兴]`（happy）、`[laughter]` 作为 `transcribe-1-pro` 输出的 emotion/vocal-event cue。说明**中文标记官方亦认可**（用于 ASR 侧）。`【官方】`

### 3.7 S1（legacy）固定清单 —— **仅作历史参照，不要用在 s2.1-pro-free**

`【官方】` 来源：[Emotion Control S1 小节](https://docs.fish.audio/developer-guide/core-features/emotions)、[Models Overview](https://docs.fish.audio/developer-guide/models-pricing/models-overview)。语法为 `( )`。

- **基础情绪 24**：`(angry) (sad) (excited) (surprised) (satisfied) (delighted) (scared) (worried) (upset) (nervous) (frustrated) (depressed) (empathetic) (embarrassed) (disgusted) (moved) (proud) (relaxed) (grateful) (confident) (interested) (curious) (confused) (joyful)`
- **进阶情绪 25 / 27（两版文档不一致）**：
  - Emotions 页（与 S2 表格对齐）：`(disdainful) (unhappy) (anxious) (hysterical) (indifferent) (uncertain) (doubtful) (confused) (disappointed) (regretful) (guilty) (ashamed) (jealous) (envious) (hopeful) (optimistic) (pessimistic) (nostalgic) (lonely) (bored) (contemptuous) (sympathetic) (compassionate) (determined) (resigned)`
  - Models Overview 页（**旧版词表，含一批 Emotions 页已不再出现的词**）：`(disdainful) (unhappy) (anxious) (hysterical) (indifferent) (impatient) (guilty) (scornful) (panicked) (furious) (reluctant) (keen) (disapproving) (negative) (denying) (astonished) (serious) (sarcastic) (conciliative) (comforting) (sincere) (sneering) (hesitating) (yielding) (painful) (awkward) (amused)`
  - → **官方两页 S1 清单自相矛盾**（`impatient/scornful/panicked/furious/...` 一组只在 Models Overview 出现）。这进一步说明「固定清单」本身不可靠。
- **语气 5**：`(in a hurry tone) (shouting) (screaming) (whispering) (soft tone)`
- **音频效果 10**：`(laughing) (chuckling) (sobbing) (crying loudly) (sighing) (panting) (groaning) (crowd laughing) (background laughter) (audience laughing)`
- **特殊效果 5**：`(audience laughing) (background laughter) (crowd laughing) (break) (long-break)`

---

## 4. 位置规则 / 叠加 / 数量 / 失效行为

### 4.1 位置规则（官方）

[Emotion Control → Placement Rules](https://docs.fish.audio/developer-guide/core-features/emotions)，"For S2" 原文四条：

> - **Sentence-level emotion cues usually work best at the beginning of sentences**
> - **Tone controls can go anywhere in the text**
> - **Sound effects can go anywhere in the text**
> - Bracket cues can use natural language descriptions and are not limited to a fixed set of tags

官方给的对照示例：
```
[happy] What a wonderful day!
What a [warm and happy] wonderful day!
```
两句都「正确」—— 但**生效范围不同**：前者整句，后者从 "wonderful" 起。

**ComfyUI 官方合作节点文档** 把这条讲得更透（[Fish Audio Prompt Guide](https://docs.comfy.org/tutorials/partner-nodes/fishaudio/prompt-guide)）：

> **Position is meaning.** A tag applies from where it appears **until the next tag or the end of the sentence**. `[whispering] I didn't want to go inside` whispers the whole line. `I didn't want to go [whispering] inside` starts whispering at "inside".

官方博客同样表述：
> 标签影响其之后的内容。在需要发生转变的确切位置放置标签 —— 除非你希望从句首开始，否则不要放在句首。

**⚠️ 与社区文档的一处冲突**：`【社区】` [instagit 的 fish-speech 分析](https://instagit.com/fishaudio/fish-speech/how-use-inline-emotion-prosody-control-tags.md) 称 *"A tag at the end has no acoustic effect because no speech follows it"* 且 *"the model applies the change immediately after the token preceding the tag"*（即**作用于之前的词**）。这与官方「作用于之后」的表述**相反**。**以官方为准：标记是前向指令（forward instruction）**。社区的 [JarodMica gist（面向 s2.1-pro 的系统提示词）](https://gist.github.com/JarodMica/8197976f2bde9fa8a27f026df9725b1a) 也采用官方口径：*"Use tags as forward instructions only. A tag must appear before the words, phrase, sound, pause, or sentence it controls. Never place a nonverbal, emotion, tone, pause, or effect tag at the end of a sentence, paragraph, or output."*

### 4.2 能否叠加 / 每句数量

`【官方】` Emotion Control：
> **Maximum of 3 combined emotions per sentence recommended.**
```
[sad][whispering] I miss you so much.
[angry][shouting] Get out of here now!
[excited][laughing] We won! Ha ha!
```

`【官方】` ComfyUI 指南：
> Layer emotions for complex expressions. **Keep combinations to three tags or fewer per sentence.**
> Pair a physical tag with an emotion tag. Physical tags like `[panting]` or `[whispering]` register on their own, but **pairing them with an emotion produces more consistent, natural results**:
```
[panting] [tired] I've been running for twenty minutes.
[whispering] [scared] Don't move. Don't make a sound.
[shouting] [angry] I told you this would happen!
```

`【官方】` Do's / Don'ts：
> **Do:** Use one primary emotion per sentence / Test different emotion combinations / Match emotions to context logically / Add appropriate text after sound effects (e.g., "Ha ha" after laughing) / Use natural expressions when possible / **Space out emotional changes for realism**
> **Don't:** **Don't overuse emotion tags in short text** / **Don't mix conflicting emotions** / Don't make bracket descriptions so long that they interrupt readability / Don't forget brackets / Don't place sentence-level emotion cues far from the sentence they control

`【官方】` ComfyUI 补充 Don't：
> Don't **leave a descriptive tag without text after it**.

`【第三方】` [Runware S2.1 Pro 指南](https://runware.ai/docs/models/fish-audio-s2-1-pro/guides/emotion-and-expression)（更保守，值得参考）：
> 1. Start with core tags before reaching for free-form.
> 2. **Stack at most two compatible tags.** `[sad][whispering]` works. Piling on four tags at the same position dilutes each one. If you need a complex delivery, use **a single free-form tag that describes it in natural language**: `[speaking softly with sadness]`.
> 3. **Give each emotion enough text to land.** A tag applied to three words doesn't have room to develop. For transitions, write at least one complete sentence per emotional beat.
> 4. Use paralanguage for timing, tags for mood.
> 5. Reserve phoneme control for genuine mispronunciations.
> 6. Set `normalize` to `false` for paralanguage and phoneme tags.

**冲突处理建议**：物理 + 情绪配对（如 `[panting][tired]`）是官方推荐；**但「用单条自由描述替代多标记叠加」（`[speaking softly with sadness]`）是第三方建议**。对 galgame 台词（通常短），建议**上限 2 个标记**。

### 4.3 冲突组合

`【第三方】` Runware 原文：
> Compatible pairs like `[sad]` + `[whispering]` or `[excited]` + `[laughs]` work because they describe deliveries a person could plausibly perform at the same time. **Conflicting pairs like `[whispering]` + `[angry][shouting]` send the model in two directions at once and produce unstable output.** If the delivery you want combines mood and manner, stack them. If the two tags fight each other physically, pick one.

`【官方】` 只笼统说 "Don't mix conflicting emotions"，未给物理冲突的判定表。**「同一生理机制的两个极端」（音量、语速）互斥；「情绪 + 音量」可叠加。**

### 4.4 无效 / 未识别标记的行为 —— 实测结论

| 情形 | 结果 | 依据 |
|---|---|---|
| 完全不存在的标记（`[zzz-nonsense-token-9f3]`） | **HTTP 200，音频正常，标记不被念出，效果≈无** | `【实测】` |
| 拼写错误（`[chucking]` 误写） | 不报错 | `【社区】` JarodMica gist 明确建议 "Do not use `[chuckling]` or the typo `[chucking]`; Fish Audio handles `[laughing]` more reliably" |
| 使用 S1 语法 `(sad)` | **HTTP 200，标记不被念出，官方称不解释为标记** | `【官方】`+`【实测】` |
| 全角括号 `【】`/`［］` | HTTP 200，不被念出，是否生效未证实 | `【实测】` |
| 未闭合 `[sad` | HTTP 200，音频正常 | `【实测】` |
| 嵌套 `[sad[whispering]]` | HTTP 200，音频正常 | `【实测】` |
| 标记后无文本（`[sad]` 独占） | HTTP 200 但产出**纯非语言声**（ASR 判为 `<GASP>`），官方称 "output can be unpredictable" | `【官方】`+`【实测】` |
| 超过 3 个叠加（5 个） | HTTP 200，输出与 2 个标记版本字节数完全一致，提示溢出标记被忽略 | `【实测】` |

**→ 关键工程结论：剧作家模型写错标记不会「翻车」，只会「没效果」。** 没有「标记被念出来」的风险，也没有 4xx 报错风险。这降低了提示词的容错压力，但仍需在提示词里给准确清单以保证效果。

### 4.5 语言支持（对中文/日文项目重要）

`【官方】` Emotions 页 Language Support：
> All 13 supported languages can use emotion markers. For sentence-level control, cues usually work best at the sentence start in these languages:
> **English, Chinese, Japanese**, German, French, Spanish, Korean, Arabic, Russian, Dutch, Italian, Polish, Portuguese

（注意：这段是 S1 时代的表述残留，"13 languages" 与 S2 的 83 语言不一致。S2.1-Pro 支持 **83 语言**，[Models Overview](https://docs.fish.audio/developer-guide/models-pricing/models-overview)。）

`【官方】` 官方博客明确：**标记可以用脚本本身的语言书写**，给了 4 个语言的例子：
```
日本語： [囁き声で] 誰にも聞かせないで。
        [ため息をついて] もう一度やり直そう。
中文：  [低声说] 不要让他们听见。
        [叹气] 我真的不知道该怎么办了。
Español：[susurrando] No dejes que te escuchen.
        [enojado] ¿Cómo pudiste hacer eso?
한국어： [속삭이며] 아무도 모르게 해줘.
        [화나서] 어떻게 그럴 수가 있어.
```
`【官方】` ComfyUI 指南同样确认：*"Tags work in your language. Write cues in the same language as your script: `[低声说] 不要让他们听见`, `[ため息をついて] もう一度やり直そう`."*

`【社区】` 日文社区（[HodaPress Review](https://review.waction.org/tools/fish-audio/emotion-tag)，2026-08-15）的经验：
> 日本語タグはS2の特徴的な機能ですが、**英語タグのほうが学習データが多く、安定しやすい傾向があります**。品質にこだわる場合は英語タグを試してみるのが無難です。
> （日文标签是 S2 的特色功能，但**英文标签训练数据更多，倾向更稳定**。讲究质量时用英文标签更稳妥。）
> 该文同时声明：「※現状、正しい日本語でのタグ翻訳のソースを見つけることができませんでした」——即社区也承认日文标记的官方依据不完整。

**→ 对本项目的建议：台词以日文/中文为主时，标记仍写英文**（英文标记有官方表格背书，中/日文描述属"开放域自由发挥"）。这与本地 CLI 默认走日文语音（Rem 音色）的场景一致。

---

## 5. 与情感控制相关的其他官方手段

### 5.1 采样参数（官方 API）

[Text to Speech API Reference](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech) 全部字段：

| 字段 | 默认 | 范围 | 对情绪的影响 |
|---|---|---|---|
| `temperature` | `0.7` | `0 <= x <= 1` | **"Controls expressiveness. Higher is more varied, lower is more consistent."** ← 官方唯一直接关联「表现力」的旋钮 |
| `top_p` | `0.7` | `0 <= x <= 1` | "Controls diversity via nucleus sampling." |
| `prosody.speed` | `1` | — | 语速（本机 CLI 暴露为 `--speed`） |
| `prosody.volume` | `0` | — | 音量 dB（本机 CLI 暴露为 `--volume`） |
| `prosody.normalize_loudness` | `true` | bool | **S2 上生效、S1 上无效**；迁移时输出响度会变 |
| `chunk_length` | `300` | `100 <= x <= 300` | 文本分块大小 |
| `min_chunk_length` | `50` | `0 <= x <= 100` | 分块最小字符数 |
| `normalize` | `true` | bool | 英中文本规范化；**官方称音素标记会被 normalize 保留，故可保持 true**；第三方称 paralanguage/音素需 `false` |
| `latency` | `normal` | `low`/`normal`/`balanced` | 质量/延迟权衡 |
| `max_new_tokens` | `1024` | — | 每块最大音频 token |
| `repetition_penalty` | `1.2` | — | **官方：对 S2.1-Pro 无效** |
| `condition_on_previous_chunks` | `true` | bool | 用前块音频做上下文以保持音色一致 |
| `early_stop_threshold` | `1` | `0 <= x <= 1` | 批量早停 |
| `features` | — | — | 请求级特性开关，如 `["quality-guard"]` |
| `pronunciation_dictionary` | — | — | 服务端发音词典引用 |
| `format` / `sample_rate` / `mp3_bitrate` / `opus_bitrate` | `mp3` / 44100 / 128 / -1000 | — | 编码 |

`【第三方】` ComfyUI 官方文档对参数的经验值：
> | Parameter | Default | Effect |
> | `temperature` | 0.7 | Expressiveness. Higher is more varied, lower is more consistent |
> | `top_p` | 0.7 | Diversity via nucleus sampling |
> | `speed` | 1.0 | Speaking rate, 0.5 to 2.0 |
> | `volume` | 0.0 | Volume adjustment in decibels, -10 to 10 |
> | `normalize` | true | Expands numbers and dates for natural reading. Keep on unless normalization rewrites text you want read literally |
> The `seed` controls whether the node reruns; **results are non-deterministic regardless of seed value**.

`【社区】` Vellum 的 Fish Audio skill 建议 `temperature 0.7-0.8` 对表现力最自然。

**→ 对 AIVN 的实操含义**：情绪主要靠标记，`temperature` 只调「波动量」。注意**输出非确定**：同一行台词每次生成都可能不同，因此「先试听后锁定」不可行，需要接受随机性或做多次取一（官方博客提到 "Coming soon: pick your favorite from multiple generations"，尚未上线）。

### 5.2 参考音频 / 参考文本（`reference_id` / `references`）

`【官方】` [Voice Cloning](https://docs.fish.audio/features/voice-cloning)、[Instant Voice Cloning cookbook](https://docs.fish.audio/developer-guide/sdk-guide/cookbook/instant-voice-cloning)、[Text to Speech](https://docs.fish.audio/features/text-to-speech)：

- **持久音色**：`reference_id` = voice model ID（本项目 CLI 的 `-v 0c7771ca5910484e8a4933068017fcee`）。
- **即时克隆（zero-shot）**：`references: [{audio: <bytes>, text: "<参考音频的逐字转写>"}]`。**官方强调 `text` 必须与音频完全一致（含标点）以获得最佳韵律**。
  > *"Use 10–30 s of clean speech, and make `text` match the audio exactly (including punctuation) for the best prosody."*
- 多说话人 zero-shot：`references` 传 2D 数组；`reference_id` 传任意字符串标识。
- 官方 API 建议：**"For best results, upload reference audio using the create model before using this one. This improves speech quality and reduces latency."**
- SDK：Python 默认 `model="s2-pro"`；**JS SDK（npm `fish-audio`）默认 `s1`，必须显式传 model**。`【官方】`

**→ 对情绪控制的实际意义**：参考音频的**情绪色彩会被继承**。`【社区】` [Discussion #1217](https://github.com/fishaudio/fish-speech/discussions/1217) 的实测经验：
> "Keeping it around 30s+ (but not too long) helped, and **clips that already have some emotional range in them tend to carry over better to the expressive tags**. Also **real human recordings work way better than using another TTS output as reference**."

`【社区】` [Issue #1031](https://github.com/fishaudio/fish-speech/issues/1031) 中维护者的建议：*"If your reference audio has great emotional features, you can also add description in your reference text."*（即把情绪描述写进 reference text）—— 但该帖后续多人反馈「并不管用」。

**→ 给 AIVN 的建议方向（未验证）**：如果想强化某角色的情绪表现，可以给该角色准备**带情绪的参考音频 + 精确转写**，而不是只靠标记。

### 5.3 Agents 的 `voice.expressive`（官方，但走 Agent API 而非 `/v1/tts`）

`【官方】` [Agents 文档](https://docs.fish.audio/llms-full.txt)：
> **Expressive mode** makes the agent steer its own delivery: it opens sentences with emotion cues, adds natural pauses and emphasis, laughs where it genuinely fits... It is on by default. Toggle it via the API (`voice.expressive`, default `true`).
> **The delivery cues are rendered by the voice model. They are never spoken and never appear in transcripts or message history.**

这是**官方对「标记不会被念出来」最直白的书面确认**，但它属于 `/v1/agent/*` 端点，**不能用于 `/v1/tts`**。对本项目只能作为概念佐证。

### 5.4 音素控制（拼音/罗马字/CMU Arpabet）

`【官方】` [Fine-grained Control](https://docs.fish.audio/developer-guide/core-features/fine-grained-control)：
```
英文： I am an <|phoneme_start|>EH1 N JH AH0 N IH1 R<|phoneme_end|>.
中文： 我是一个<|phoneme_start|>gong1<|phoneme_end|><|phoneme_start|>cheng2<|phoneme_end|><|phoneme_start|>shi1<|phoneme_end|>。
日文： <|phoneme_start|>ha0shi1ga0<|phoneme_end|>見えます。
```
- 替换范围：英文替换**一个词**；中文替换**一个字/音节**；日文替换**一个短词/短语**。
- 官方：音素标记**会被文本规范化保留**，所以 `normalize` 可保持默认 `true`；仅当你不希望规范化改写周围文本（数字、日期、URL）时才设 `false`。
- `【第三方】` Runware 则称音素控制需要 `normalize: false`，并强调「每个音素标记只替换一个词，标点放在闭合标记之后」。

**→ 对本项目的实际价值**：给角色名/专有名词（人名、招式名、地名）钉发音，避免 TTS 念错。这是**情绪标记之外**另一类可内联的控制标记，且与情绪标记可共存于同一 `text`。

### 5.5 ⚠️ 一个**不适用于本项目**的「情绪字段」

`【第三方】` [docs.fishaudio.org](https://docs.fishaudio.org/en/docs/control-instructions/global-emotion) 有一个全局 `emotion` 请求字段，但该站点属于**第三方聚合平台（Kitta Audio）**，不是 Fish Audio 官方 API。其原文明确：
> **Global `emotion` currently applies only to `minimax-2.8-turbo` … FishAudio and Qwen models do not apply this request field.**

Fish 官方的 `/v1/tts` **没有** `emotion` 字段（见 §5.1 完整字段表）。ASR 侧文档也说：*"There is no separate emotion field; the cues are part of the text."*

---

## 6. Drama 3（`drama-3-preview`）—— 值得关注的下一代，但当前不用

`【官方】` [Drama 3](https://docs.fish.audio/features/text-to-speech/drama-3)（Preview 状态，行为可能变化）。同一个 `POST /v1/tts`，只改 `model` header。三个新能力：

1. **方向（direction）**：`[calm, measured storyteller voice]` —— 与 S2.1 相同语法，但官方措辞更强调"像给配音演员说戏"。
2. **成对标签（paired tags）**：限制只对**特定词**生效。
   > Wrap words in a paired tag, such as `<whisper>…</whisper>`, to change the delivery of those words only.
   > **Supported tags: `<whisper>`, `<emphasis>`, `<soft>`, `<fast>`, `<slow>`, `<stress>`, `<forceful>`.**
   官方 curl 示例：`It is going to <emphasis>blow</emphasis>.`
3. **语言切换标签（实验性）**：包住短语切换语言。

`【官方】` 官方 [Drama 3 产品页](https://fish.audio/drama-3/) 的 Tags 菜单：**Whisper / Emphasis / Soft / Faster / Slower / Stress / Forceful**（与上表一致）。

`【官方】` 警告：*"If the `model` header is missing or misspelled, the request doesn't fail: it falls back to `s2.1-pro`."*

**→ 对本项目的判断**：Drama 3 的成对标签（`<emphasis>blow</emphasis>`）非常适合 galgame「只强调某个词」的需求，比 `[emphasis]`（前向生效到下一个标记/句末）更精确。但它是 **preview**，官方明说行为可能变化、可用性可能变化。**建议先记录，不进提示词**。

---

## 7. 亲密 / 成人向（NSFW）语音

### 7.1 官方文档明确支持的「亲密向」标记

`【官方，来自 fish-speech GitHub / HuggingFace README】`
- **`[moaning]`** ← 明确列在官方 "Rich Emotion Library" 里（中英日三语 README 一致）。
- `[panting]`、`[breath]`(小括号)、`[breath]` 相关、`[inhale]`、`[exhale]`、`[gasp]` ← 官方表格。
- `[whispering]`、`[soft tone]`、`[soft voice]`、`[low voice]`、`[breathy]`(第三方列)、`[lip-smacking]`(小括号) ← 官方/半官方。

`【官方】` 官方博客明确给 `[giggle]`、`[chuckling]`、`[crying]`、`[groan]`、`[rustling sound]` 等。

`【第三方】` [Vellum 的 Fish Audio skill](https://www.vellum.ai/skills/fish-audio) 把 `[moaning]` 归到 "Paralinguistic Sounds"，标注效果为 "Vocal moan"、适用 "Pain, frustration"，并把 `[breathy]` 标为 "Airy, expressive"。同一份清单还列出 `[giggling]` `[tsk]` `[clearing throat]` `[panting]` `[gasp]` `[volume up/down]` `[low volume]` `[echo]` `[singing]` `[with strong accent]` `[pitch up/down]` `[voice breaking]` `[barely holding it together]` `[trailing off]` `[laughing tone]` `[excited tone]` `[interrupting]`。**注意这是第三方总结，不是官方白名单。**

`【第三方】` [Controllable TTS 实验文档](https://lvgog.com/agent-book/zh/chapter6/controllable-tts/) 把中文标记映射到 S1 原生标签：`[SIGH]`→`(sighing)`、`[LAUGH:small]`→`(chuckling)`、`[BREATH]`→`(gasping)`。属社区做法。

### 7.2 中文「娇喘/喘息」向的社区写法

`【社区，未证实】` 中文社区流传的扩展标签清单（来源：[ComfyUI资源网 3243 号文章](https://www.comfyorg.cn/3243.html)）。**这不是官方文档，很多词无从验证**，仅作为「社区实际在写什么」的记录：

- 情绪类新增：`[relieved]` `[amused]` `[sorrowful]` `[melancholic]` `[painful]` `[devastated]` `[annoyed]` `[furious]` `[outraged]` `[scornful]` `[condescending]` `[fearful]` `[terrified]` `[panicked]` `[whining]` `[pleading]`
- 生理/非语言类：`[sob]` `[deep sigh]` `[guffaw]` `[grunt]` `[moan]` `[tsk]` `[gasp]` `[stuttering]` `[hesitating]` `[muttering]` `[mumbling]`
- 空间/后期类：`[large hall]` `[small room]` `[echo]` `[telephonic]` `[megaphone]` `[muffled]` `[outdoor]`
- 该文还提到一种 **`[+tag]` / `[-tag]` 状态开关语法**（如 `[-angry, +sad]`）。**这一语法在官方任何文档中均无记载，本机实测未验证，应视为社区臆造，不要用。**

`【社区】` [Astorie 日语版](https://astorie.ai/ja/how-to/create-sound-effects-for-video/fish-audio-s2) 提出「**方括号独占式（bracket-only）提示词**」用法，专门生成纯非语言声：
> 声のSFXのプロンプトは方括弧だけで構成し、セリフは含めません。例：`[sharp gasp]`、`[exhausted breathing for 5 seconds]`、`[nervous chuckle]`、`[startled scream then silence]`、`[panting after running, slow recovery]`。**モデルは方括弧の内容をそのまま声の演技全体として解釈するため、周囲に文章を添える必要はありません。**

⚠️ **这与我方实测 + 官方说法相冲突**：官方 Emotions 页说 "Don't **leave a descriptive tag without text after it**"，官方博客说 "without text after it, output can be unpredictable"。我方实测 `[sad]` 独占确实产出了不可控的纯非语言声（2.53s，ASR 判为 `<GASP>`）。
→ **结论：`[panting]` 独占「能出声」但「不可控」**；官方立场是不要这么用。若要做纯喘息/呼吸声，**风险自负**（可能得到一段随机气息声而非目标表演）。

### 7.3 内容政策（官方书面）

`【官方】` [Fish Audio 官方 ToS](https://fish.audio/terms/)：
> You warrant and represent that you will not post, upload, share, store, or otherwise provide through the Services any User Submissions that: … (ii) **contain sexually explicit content or pornography**; … (iv) exploit minors; (v) depict unlawful acts or extreme violence…

`【官方】` [Fish Audio Customer Agreement（企业版）](https://fish.audio/enterprise-terms/)：
> Customer Materials and the use of Customer Material … will not: … (d) **be deceptive, obscene, pornographic or unlawful**;
> Fish Audio **may monitor Customer's use of the Services and may prohibit any use of the Services or Platform it believes may be in violation**.

`【第三方平台】` [fishaudio.org Acceptable Use Policy](https://fishaudio.org/en/acceptable-use)（**Kitta Audio，非 Fish Audio 官方**，但它代理 Fish Audio 音色）明确禁止：
> • Pornographic or sexually explicit content
> • **Nude, semi-nude, fetish, sexually suggestive, arousal-focused, or undressing content**
> • Sexual exploitation, non-consensual intimate content, or any content involving minors
> • **Attempts to bypass safety filters, moderation systems, or account limits**

`【官方】` NotFound 一处：Fish Audio 官方文档站**没有**独立的「TTS 内容审核/安全」页面（`llms-full.txt` 全文检索 "safety/prohibit/NSFW/moderat" 只命中 Agents 的 prompt guardrails，与 TTS 无关）。

### 7.4 实测：API 层是否拦截 NSFW

`【实测】`（`s2.1-pro-free`，本机 Key 轮询，仅看 HTTP 状态与产物体积，未试听）：

| 输入 | 结果 |
|---|---|
| `[moaning] ああ…そこは…だめ…` | ✅ HTTP 200，46,392 B，2.90 s |
| `[panting][breathy] はぁ…はぁ…もう…走れない…` | ✅ HTTP 200，47,646 B，2.98 s |
| `[moaning][panting] ああっ…だめ…イく…気持ちいい…もっと…` | ✅ HTTP 200，114,519 B，7.16 s |
| `[moaning][panting][breathy] Oh god yes... ah... right there... I'm coming...` | ✅ HTTP 200，84,426 B，5.28 s |
| `[娇喘][呻吟][喘息] 啊…啊…不要…那里…不行…要去了…` | ✅ **HTTP 200**，87,352 B |
| `[moaning][panting][breathy] Nngh... ah... I'm... I'm gonna cum...` | ✅ **HTTP 200**，133,328 B |
| `[喘息][耳语][湿润的声音] 嗯…嗯…好舒服…` | ✅ **HTTP 200**，272,090 B |

→ **`/v1/tts` 请求期没有任何内容过滤器**。所有请求（包括显式中日文成人文本）均返回 200 并正常出音频。**拒绝/封禁只可能发生在事后审计层**（官方 ToS 保留 monitor + prohibit 权）。

### 7.5 Fish Audio 自家音色库里的成人向内容 —— 强反证

`【实测】`（调用 `GET https://api.fish.audio/model?title=...` 公共音色库检索，2026-10-12）：

| 检索词 | 结果数 | 抽样 |
|---|---|---|
| `nsfw` | **64** | `nsfw voice`（tags: `erotic voice`, `nsfw voice`, `amsr voice`, `breathy`） |
| `喘ぎ` | **23** | `喘ぎ声`（"A soft and extremely breathy young female voice with an intimate, whispering tone"）、`激しい喘ぎ声♡` |
| `呻吟` | **30** | `呻吟`（"柔和、带有呼吸感的女性嗓音，适合营造亲密、放松的氛围"）、`鞠婧祎2`（描述直接写「淫荡，高潮，叫床 娇喘 呻吟」）、`叫床` |
| `moaning` | **199** | `moaning`(tags 含 `Pained`,`Distressed`)、`Karina moaning`、`Moaning girl` |
| `breathy` | **200** | `Intimate Breath`（"A soft, intimate female voice expressing **sensual sounds and gentle breaths**"）、`Mommy ASMR`（tags 含 `sexy`）、`Soft Breathy Female` |
| `asmr` | **200** | `ASMR`、`Mommy ASMR`、`Asmr` |
| `whisper` | **200** | `whisper`（"ideal for ASMR"） |

`【官方，Fish Audio 自有域名】` 官方**生成了专门的落地页**做 SEO：
- https://fish.audio/ja/m/63fc7405de8b4c1ab70d3c04dc2831ff/ —— 标题「**喘ぎ声 AI音声ジェネレーター**」，页面文案：「10,781 回生成・41 高評価」，音色描述：「A soft and extremely breathy young female voice with an intimate, whispering tone. It is highly expressive and well-suited for **Japanese character acting or ASMR-style content**.」
- https://fish.audio/m/688f774faaef4f7f9cf3facfe7aabddf/ —— 「**Free 喘ぎ声 AI Voice Generator**」，2,987 次使用。

→ **Fish Audio 平台自身运营着大量成人/ASMR 向音色并为其做 SEO 落地页**，同时 ToS 书面禁止色情内容。两套事实并存。**对本项目的实务含义：用 Fish 做成人向 galgame 配音在技术上无障碍，但属于 ToS 灰色地带，存在账号风险，建议评估自托管（S2-Pro 权重开源）作为退路。**

### 7.6 社区成人向实践要点汇总

| 做法 | 来源 | 可信度 |
|---|---|---|
| 用 `[moaning]` `[panting]` `[breathy]` `[whispering]` `[sigh]` 组合 | 官方 README + 第三方 skill | 官方支持 `[moaning]`/`[panting]` |
| **挑一个音色本身就是「breathy/intimate/ASMR」的**（如 `喘ぎ声`、`Intimate Breath`、`Mommy ASMR`），比堆标记有效得多 | 官方博客反复强调 "If a tag isn't landing the way you expect, try a different voice before adjusting the tag itself — **the issue is often the voice, not the instruction**" | `【官方】` |
| 用 `<|phoneme_start|>` 钉住拟声词的读法 | 官方 | `【官方】` |
| 方括号独占式 `[exhausted breathing for 5 seconds]` | Astorie | `【社区】`，与官方 "don't leave a tag alone" 冲突 |
| `[+tag]`/`[-tag]` 状态开关 | 中文社区 | `【社区】`，**无任何官方依据，勿用** |
| 在 reference text 里写情绪描述 | 维护者在 Issue #1031 的回帖 | `【社区】`，多人反馈无效 |

---

## 8. 社区实践与已知坑（GitHub Issues / Discussions 汇总）

### 8.1 「标记没用」类

| Issue | 标题 | 关键内容 |
|---|---|---|
| [#1162](https://github.com/fishaudio/fish-speech/issues/1162) | *Emotion tags don't seem to do anything* (2026-03-03) | 报告者："The speaker's voice never changes, with **some tags only adding background static to the audio**. Has anyone gotten this feature to work or is it just a gimmick?" 回复（yoimiya122）：「**效果不稳定**。即使放在句中同一位置，也只是间歇性生效。」给了两句同位置 `[whisper in small voice]` 对照，只有一句生效。该 issue 被打了 `bug` 标签，并被 PR #1180（"docs: Add emotion tags investigation documentation"）引用。 |
| [#1031](https://github.com/fishaudio/fish-speech/issues/1031) | *Emotional control doesn't seem to be very useful* | 「用克隆音色时加情绪标记基本没用」；「我加 `(sad)` 也没用」；「也许模型本身没这个功能，只是噱头」；「S1 1.4/1.5 就说有情绪控制，但我找不到怎么控制」。维护者建议在 reference text 里加情绪描述。**多轮追问后问题未解决，最终无官方结论。** |
| [#1280](https://github.com/fishaudio/fish-speech/issues/1280) | *S2-Pro: bracket emotion control appears weak on **emotion-neutral** transcripts* (2026-04-28) | **最有价值的一条**。系统性实验：<br>• 文本语义已带情绪时（`[happy] What a beautiful day!`）→ 标记效果明显、对齐良好<br>• 文本语义中性时（`[happy] The meeting starts at three o'clock.`）→ **几乎听不出区别，不同标记输出彼此接近、也接近无标记 baseline**<br>• 扫了 temperature `0.6/0.8/1.0/1.2/1.5` × 7 个标记（happy/sad/angry/confused/surprised/scared/proud），**未找到任何能让中性文本上的标记效果达到对齐文本水平的设置**，「更高温度主要增加变异性，而非情绪意图」<br>• 三问官方：标记是**覆盖**文本情绪还是**放大器**？有无更强的 prompt 模式？能不能给一个中性文本上效果明确的样例？<br>• 另一用户（NalinGHub, 2026-07-06）：「Any update on this? I've noticed similar results.」<br>• **截至 2026-10-12 未见官方回复** |

> **→ 对本项目最重要的可操作结论（来自 #1280）**：
> **标记是「放大器」而非「覆盖器」。**
> 如果一句台词本身语义中性（如「会議は三時からです」），写 `[sad]` 效果会非常弱。
> 想稳定拿到情绪，**要么让台词本身带情绪语义，要么用强描述性自由标记**（`[voice breaking, barely holding it together]`）。

### 8.2 本地部署 vs 官方网页质量差异

`【社区】` [#1217](https://github.com/fishaudio/fish-speech/discussions/1217)：
- 本地 HF 权重「情绪与韵律更弱、更不稳定」，`[crying loudly]` `[shouting]` `[sobbing]`（韩语）**本地基本不生效**，官方网页同样输入很好。
- **Fish Audio 官方支持团队的答复（原文引用）**：
  > the S2 Pro weights released on Hugging Face are **identical** to the ones we use in our production environment. We do not "prune" … The difference … is typically due to **the advanced orchestration pipeline built around the model on our official website**. These include: **Text Normalization**（高度优化的预处理，确保模型正确解读情绪 cue）；**Audio Enhancement**（生成后滤波与增强）；**Fine-tuned Inference Parameters**（网页端精心调过的 top_p / temperature / repetition_penalty）。
- 另有用户推测官方可能有「用另一个模型补齐情绪」的流程。

→ **含义**：官方 API（我们走的就是官方 API）已包含这套 orchestration，所以本项目的标记效果应当明显优于自托管。这也是不应自托管 S2-Pro 做成人向的理由之一（另需自己复刻整套 pipeline）。

### 8.3 第三方实践者的「场景化提示词」经验（最值得抄的一条）

`【社区】` [Making AI Voices Cry: A Doubao TTS Emotion Experiment](https://blog.ax0x.ai/doubao-tts-emotion-research)（Xingfan Xia, 2026-03-16）—— 虽是豆包实验，但经验与 #1280 完全吻合：

> "The model doesn't respond to labels. **It responds to descriptions. You're not tagging an emotion; you're directing a performance.** Rewriting the hint from the bare label 'sad' to a scene description 'trembling, sobbing voice' jumps the model's emotion from barely-moving to full emotion."

其「生产级情绪提示」表（中文，可直接借鉴到 Fish 的自由标记里）：

| 目标情绪 | 描述式提示 |
|---|---|
| 甜腻撒娇 | 用甜蜜撒娇的声音，像在跟男朋友撒娇，语调上扬很开心 |
| 悲伤哭泣 | 用哭泣的声音，边哭边说，很伤心，声音颤抖带着哽咽 |
| ASMR/耳语 | 用ASMR悄悄话的声音，非常小声非常轻柔，像在耳边低语 |
| 兴奋 | 用非常激动兴奋的语气，开心到快要尖叫了 |
| 愤怒 | 用愤怒嫌弃的语气，非常不满在骂人，声音拔高 |
| 困倦慵懒 | 用疲惫慵懒的声音，边打哈欠边撒娇，声音软绵绵的 |
| 平静关怀 | 用低沉磁性的声音，表面平淡但充满关心，像大叔在叮嘱 |
| 压抑的悲伤 | 用压抑悲伤的声音，故意克制但声音微微颤抖，不想让人看出来 |

> 该文总结的公式：**动词 + 生理描述 + 场景**。作者的判断："The quality of your hint is the single biggest lever you have — bigger than voice selection, bigger than model version."

**⚠️ 但这是豆包（Doubao TTS，用 `context_texts` 字段）的实验，不是 Fish Audio。** Fish Audio 官方首发博客里也有同样的理念（`[the calm, measured tone of someone who has done this a thousand times]`、`[overly cheerful, clearly forcing it]`），所以这条**跨引擎普适**，可以迁移。

### 8.4 其他坑

- **JS SDK 默认 s1**：`fish-audio` npm 包不传 model 会用 `s1`（已弃用）。必须显式传。`【官方】`
- **Python SDK 默认 `s2-pro`**（非 s2.1-pro）。`【官方】`
- **model header 拼写错误不会报错，会回落到 `s2.1-pro`**。`【官方】`
- **`repetition_penalty` 在 S2.1-Pro 上无效**（S1 有效），如果之前靠它压重复音，迁移后要重新试听。`【官方】`
- **`prosody.normalize_loudness` 默认 true 且 S2 上生效**（S1 无效），迁移后响度会变。`【官方】`
- **`normalize: true`（默认）会展开数字/日期**。若台词里有需要逐字读的符号，需设 `false`。`【官方】`
- **`/v1/asr` 与 TTS 的额度是分开的**：本机实测 TTS 免费层可用，但 ASR 返回 `402 Insufficient API credit. **API credit is managed independently from platform credit**`。即：免费层能合成，不能转写。`【实测】`
- **并发限制按账号预充金额分档**：`< $100` → 5 并发；`≥ $100` → 15；`≥ $1,000` → 50。所有 Key 共享。`【官方】`
- **`/v1/asr` 每个请求占一个并发槽直到返回，长录音可达数分钟**，会挤占 TTS 并发。`【官方】`
- **429 无 `Retry-After`**（原生 API；兼容 API 有），需指数退避。`【官方】`
- **多说话人模式下不能混用 S1**：`<|speaker:N|>` 仅 S2 家族 + drama-3-preview 支持。`【官方】`
- **ComfyUI 多说话人用 `@Voice1` 语法，且每个连接的音色必须至少出现一次，否则节点报错** —— 这是 ComfyUI 节点特有，不是 API 语法。API 用 `<|speaker:0|>`。`【官方】`

---

## 9. 可直接抄进提示词的「标记 → 语义」对照清单

> 全部为 `[bracket]` 形式，可用于 `s2.1-pro-free`。分三组：**情绪类（语义）**、**非语言声音类（发音/气息）**、**节奏/强调类（交付）**。
> 置信度标注：`★官方表格` = 官方 Emotion Control 页表格逐条列出；`★官方其他页` = 官方博客/README/ComfyUI 官方指南；`☆社区` = 社区实践。

### 9.1 A 组：情绪类（放句首，整句生效；每句 1 个）

| 标记 | 语义 | 示例句式 | 置信度 |
|---|---|---|---|
| `[happy]` | 愉悦上扬 | `[happy] 今日はいい日だね！` | ★官方表格 |
| `[sad]` | 悲伤低沉 | `[sad] もう…会えないんだね。` | ★官方表格 |
| `[angry]` | 愤怒攻击 | `[angry] ふざけるな！` | ★官方表格 |
| `[excited]` | 兴奋 | `[excited] やった、ついに成功した！` | ★官方表格 |
| `[calm]` | 平静放松 | `[calm] 大丈夫、ゆっくり話して。` | ★官方表格 |
| `[nervous]` | 紧张 | `[nervous] あ、あの…その…` | ★官方表格 |
| `[confident]` | 自信 | `[confident] 任せて。私が何とかする。` | ★官方表格 |
| `[surprised]` | 惊讶 | `[surprised] えっ、本当に？` | ★官方表格 |
| `[satisfied]` | 满意 | `[satisfied] うん、いい出来だ。` | ★官方表格 |
| `[delighted]` | 非常喜悦 | `[delighted] 嬉しい！ありがとう！` | ★官方表格 |
| `[scared]` | 恐惧 | `[scared] だ、誰かいるの…？` | ★官方表格 |
| `[worried]` | 担忧 | `[worried] それで大丈夫なの？` | ★官方表格 |
| `[upset]` | 心烦 | `[upset] もう、なんでこうなるのよ。` | ★官方表格 |
| `[frustrated]` | 恼怒气急 | `[frustrated] 何度言えば分かるの。` | ★官方表格 |
| `[depressed]` | 极度消沉 | `[depressed] 何もかも、どうでもいい…` | ★官方表格 |
| `[empathetic]` | 共情关怀 | `[empathetic] 辛かったね。よく頑張った。` | ★官方表格 |
| `[embarrassed]` | 害羞尴尬 | `[embarrassed] そ、そんなこと言わないでよ…` | ★官方表格 |
| `[disgusted]` | 厌恶 | `[disgusted] うわ、気持ち悪い…` | ★官方表格 |
| `[moved]` | 被触动 | `[moved] そんな…泣いちゃうよ。` | ★官方表格 |
| `[proud]` | 自豪 | `[proud] 見て、私やったんだよ！` | ★官方表格 |
| `[relaxed]` | 放松随意 | `[relaxed] まあ、座って。お茶でもどう？` | ★官方表格 |
| `[grateful]` | 感激 | `[grateful] 本当にありがとう。` | ★官方表格 |
| `[curious]` | 好奇 | `[curious] それ、どういう意味？` | ★官方表格 |
| `[sarcastic]` | 讽刺挖苦 | `[sarcastic] へえ、すごいご立派なことで。` | ★官方表格 |
| `[disdainful]` | 轻蔑 | `[disdainful] ふん、程度が知れるわ。` | ★官方表格 |
| `[unhappy]` | 不满 | `[unhappy] あんまり納得いかないな。` | ★官方表格 |
| `[anxious]` | 焦虑不安 | `[anxious] どうしよう…どうしよう…` | ★官方表格 |
| `[hysterical]` | 歇斯底里 | `[hysterical] いや！いやあああ！` | ★官方表格 |
| `[indifferent]` | 冷漠 | `[indifferent] ふうん。そう。` | ★官方表格 |
| `[uncertain]` | 不确定 | `[uncertain] たぶん…そうだと思うけど。` | ★官方表格 |
| `[doubtful]` | 怀疑 | `[doubtful] 本当に？信じられないな。` | ★官方表格 |
| `[confused]` | 困惑 | `[confused] え？どういうこと？` | ★官方表格 |
| `[disappointed]` | 失望 | `[disappointed] そっか…期待してたのに。` | ★官方表格 |
| `[regretful]` | 后悔歉疚 | `[regretful] あのとき、ああすべきだった。` | ★官方表格 |
| `[guilty]` | 罪恶感 | `[guilty] 私のせいだ…ごめん。` | ★官方表格 |
| `[ashamed]` | 深深羞愧 | `[ashamed] 顔も見られない…` | ★官方表格 |
| `[jealous]` | 嫉妒 | `[jealous] ずるい…なんであの子ばかり。` | ★官方表格 |
| `[envious]` | 羡慕 | `[envious] いいなあ、羨ましい。` | ★官方表格 |
| `[hopeful]` | 怀抱希望 | `[hopeful] きっと、また会えるよね。` | ★官方表格 |
| `[optimistic]` | 乐观 | `[optimistic] 何とかなるって。` | ★官方表格 |
| `[pessimistic]` | 悲观 | `[pessimistic] どうせ無理だよ…` | ★官方表格 |
| `[nostalgic]` | 怀旧 | `[nostalgic] 昔はよくここで遊んだね。` | ★官方表格 |
| `[lonely]` | 孤独 | `[lonely] ひとりは、やっぱり寂しいね。` | ★官方表格 |
| `[bored]` | 无聊 | `[bored] 退屈だなあ…何かしようよ。` | ★官方表格 |
| `[contemptuous]` | 蔑视 | `[contemptuous] 君に語る価値もない。` | ★官方表格 |
| `[sympathetic]` | 同情 | `[sympathetic] お悔やみ申し上げます。` | ★官方表格 |
| `[compassionate]` | 深切关怀 | `[compassionate] 私がそばにいるから。` | ★官方表格 |
| `[determined]` | 坚决 | `[determined] 絶対に諦めない。` | ★官方表格 |
| `[resigned]` | 认命 | `[resigned] 仕方ないか…そういう運命なら。` | ★官方表格 |
| `[serious]` ★ | 严肃 | `[serious] 真面目な話がある。` | ☆社区（S1 旧词表） |

### 9.2 B 组：非语言声音类（放发生位置，句首/句中/句尾均可）

| 标记 | 语义 | 示例句式 | 置信度 |
|---|---|---|---|
| `[laughing]` | 大笑 | `[laughing] あはは、何それ！` | ★官方表格 |
| `[chuckling]` | 轻笑 | `[chuckling] ふふ、そうかもね。` | ★官方表格 |
| `[giggle]` | 甜笑/咯咯笑 | `[giggle] えへへ、照れるなあ。` | ★官方博客 |
| `[sobbing]` | 带喘抽泣 | `[sobbing] どうして…どうしてなの…` | ★官方表格 |
| `[crying]` | 带哭腔 | `[crying] 行かないで…お願い。` | ★官方博客 |
| `[crying loudly]` | 放声大哭 | `[crying loudly] うわああん！` | ★官方表格 |
| `[sighing]` | 叹息 | `[sighing] はあ…疲れた。` | ★官方表格 |
| `[sigh]` | 同上（短形） | `[sigh] またか…` | ★官方博客 |
| `[groaning]` | 挫败哼声 | `[groaning] うう…また失敗した。` | ★官方表格 |
| `[groan]` | 同上（短形） | `[groan] もう勘弁してよ。` | ★官方博客 |
| `[panting]` | 气喘 | `[panting] はぁ…はぁ…ちょっと待って…` | ★官方表格 |
| `[gasping]` | 猛吸气 | `[gasping] はっ…！` | ★官方表格 |
| `[gasp]` | 同上（短形） | `[gasp] うそ…本当に？` | ★官方博客 |
| `[inhale]` | 吸气 | `[inhale] よし、行こう。` | ★官方博客 |
| `[exhale]` | 呼气 | `[exhale] ふう…落ち着いた。` | ★官方博客 |
| `[yawning]` | 哈欠 | `[yawning] ふああ…眠い…` | ★官方表格 |
| `[snoring]` | 鼾声 | `[snoring] すぴー…すぴー…` | ★官方表格 |
| `[clear throat]` | 清嗓 | `[clear throat] えっと、それでね。` | ★官方表格 |
| `[clears throat]` | 同上（第三人称形） | `[clears throat] では、始めます。` | ★官方博客 |
| `[moaning]` | 呻吟 | `[moaning] ああ…そこ…だめ…` | ★官方 README |
| `[tsk]` | 咂嘴/啧 | `[tsk] ちっ、仕方ないな。` | ★官方 README |
| `[singing]` | 歌唱 | `[singing] ～♪ たのしいな～♪` | ★官方 README |
| `[rustling sound]` | 摩擦声 | `[rustling sound] ごめん、荷物を動かしてて。` | ★官方博客 |
| `[cough]` | 咳嗽 | `[cough] けほっ…失礼。` | ★官方博客（中文页） |
| `[sniffing]` | 抽鼻/嗅 | `[sniffing] ぐすっ…` | ★官方博客（中文页） |
| `[breathing]` | 可听见的呼吸 | `[breathing] すー…はー…` | ★官方博客（中文页） |
| `[laughing tone]` | 笑着说话（非独立笑） | `[laughing tone] もう、仕方ないなあ。` | ★官方 README |
| `[excited tone]` | 兴奋语气（持续） | `[excited tone] すごいすごい！` | ★官方 README |
| `[interrupting]` | 打断 | `[interrupting] ちょっと待って！` | ★官方 README |
| `[delight]` | 愉悦（短形） | `[delight] わあ、きれい！` | ★官方 README |
| `[shocked]` | 震惊 | `[shocked] そんな…！` | ★官方 README |

### 9.3 C 组：节奏 / 强调 / 音量（可放任意位置）

| 标记 | 语义 | 示例句式 | 置信度 |
|---|---|---|---|
| `[whispering]` | 耳语 | `[whispering] 誰にも聞かせないで。` | ★官方表格 |
| `[whisper]` | 耳语（短形） | `[whisper] 内緒の話があるの。` | ★官方其他页 |
| `[soft tone]` | 轻柔软语 | `[soft tone] おやすみ、いい夢を。` | ★官方表格 |
| `[soft voice]` | 轻声 | `[soft voice] ゆっくりでいいよ。` | ★官方博客 |
| `[shouting]` | 大声喊 | `[shouting] 逃げて！早く！` | ★官方表格 |
| `[screaming]` | 尖叫 | `[screaming] いやあああ！` | ★官方表格 |
| `[loud voice]` | 提高音量 | `[loud voice] 誰かいる？` | ★官方博客 |
| `[low voice]` | 低音域 | `[low voice] 知ってるよ、君がやったこと。` | ★官方博客 |
| `[in a hurry tone]` | 匆忙急迫 | `[in a hurry tone] 急いで、時間がない！` | ★官方表格 |
| `[emphasis]` | 强调后随词 | `これは [emphasis] 本当に大事なこと。` | ★官方表格 |
| `[break]` | 短停顿 | `[break] えっと、それで…` | ★官方表格 |
| `[long-break]` | 长停顿 | `[long-break] （意を決して）…行くよ。` | ★官方表格 |
| `[pause]` | 短暂静默 | `考えた。 [pause] そして何も言わなかった。` | ★官方博客 |
| `[short pause]` | 更短停顿 | `本当に？ [short pause] 本当に？` | ★官方博客 |
| `[long pause]` | 长静默 | `彼女は見つめた。 [long pause] 行って。` | ★官方博客 |
| `[audience laughing]` | 观众笑声 | `会場は大爆笑 [audience laughing]` | ★官方表格 |
| `[background laughter]` | 背景笑声 | `[background laughter] みんな楽しそうだった。` | ★官方表格 |
| `[crowd laughing]` | 人群哄笑 | `[crowd laughing] 会場が沸いた。` | ★官方表格 |
| `[volume up]` | 音量渐强 | `[volume up] だんだん盛り上がってきた！` | ★官方 README |
| `[volume down]` | 音量渐弱 | `[volume down] ここからは小声で。` | ★官方 README |
| `[low volume]` | 低音量 | `[low volume] そっと、囁くように。` | ★官方 README |
| `[loud]` | 大声 | `[loud] おい、聞こえるか！` | ★官方 README |
| `[echo]` | 回声效果 | `[echo] ここは…どこだ…` | ★官方 README |
| `[with strong accent]` | 浓重口音 | `[with strong accent] あら、いらっしゃいませ。` | ★官方 README |
| `[singing]` | 旋律感朗读 | `[singing] お誕生日おめでとう～` | ★官方 README |

### 9.4 D 组：自由描述（官方明确支持的「开放域」能力 —— 本项目的核心竞争力）

`【官方】` 官方反复强调：*"If you can describe it to a voice actor, S2 can attempt it."* / *"novel tags generalize well"*。官方原文示例：

```
[tired, end of a long shift]
[voice rough from crying, trying to sound normal]
[professional broadcast tone]
[the calm, measured tone of someone who has done this a thousand times]
[overly cheerful, clearly forcing it]
[speaking slowly, almost hesitant]
[dead tired, end of a very long shift]
[pitch up]
[whispers sweetly]
[laughing nervously]
[with gentle warmth]
[speaking through tears]
[as if confiding a secret]
[voice breaking]
[barely holding it together]
[slightly sad] / [very excited] / [extremely angry]   ← 官方「强度修饰语」
```

`【官方】` comfyui 指南的中文示例：`[低声说]`、`[疲惫，漫长的一天结束了]`、`[哭哑了嗓子，努力听起来正常]`、`[播音腔]`。

**强度修饰语是官方技巧**（Emotions 页 Intensity Modifiers）：
```
[slightly sad] I'm a bit disappointed.
[very excited] This is absolutely amazing!
[extremely angry] This is unacceptable!
```
`【官方】` 官方还给了 **Emotion Intensity Scale** 表（当词汇表用）：

| 基础情绪 | 轻微 | 中等 | 强烈 |
|---|---|---|---|
| Happy | `satisfied` | `happy` | `delighted` |
| Sad | `disappointed` | `sad` | `depressed` |
| Angry | `frustrated` | `angry` | `furious` |
| Scared | `nervous` | `scared` | `terrified` |
| Excited | `interested` | `excited` | `ecstatic` |

### 9.5 E 组：官方推荐的组合模板（可直接用）

`【官方】` Common Combinations：

| 场景 | 组合 | 官方示例 |
|---|---|---|
| 耳语秘密 | `[mysterious][whispering]` | "I have something to tell you…" |
| 怒吼 | `[angry][shouting]` | "Stop right there!" |
| 悲伤叹息 | `[sad][sighing]` | "I wish things were different. Sigh." |
| 兴奋大笑 | `[excited][laughing]` | "We did it! Ha ha!" |
| 紧张提问 | `[nervous][uncertain]` | "Are you sure about this?" |

`【官方】` ComfyUI 补充的「物理 + 情绪」配对：
```
[panting] [tired] I've been running for twenty minutes.
[whispering] [scared] Don't move. Don't make a sound.
[shouting] [angry] I told you this would happen!
[sighing] [sad] I just don't know anymore.
```

`【官方】` 情绪渐变（跨句，每句 1 个标记）：
```
[happy] I got the promotion!
[uncertain] But... it means relocating.
[sad] I'll miss everyone here.
[hopeful] Though it's a great opportunity.
[determined] I'm going to make it work!
```

### 9.6 亲密/成人向标记（**低置信度，需自行试听验证**）

| 标记 | 语义 | 建议句式 | 置信度 |
|---|---|---|---|
| `[moaning]` | 呻吟 | `[moaning] ああ…そこ…` | ★官方 README 列出（仅列出，无语义说明） |
| `[panting]` | 喘息 | `[panting] はぁ…はぁ…` | ★官方表格 |
| `[breathy]` | 气声、气息感 | `[breathy] ん…っ…` | ☆第三方（Vellum）/ Fish 音色库 tag 里有 `breathy`，但 **不在官方标记表** |
| `[whispering]` | 耳语 | `[whispering] 耳元で…ね？` | ★官方表格 |
| `[soft voice]` | 轻柔近语 | `[soft voice] ゆっくりでいいから…` | ★官方博客 |
| `[sigh]` / `[sighing]` | 叹息/吐气 | `[sighing] ん…はぁ…` | ★官方表格 |
| `[low voice]` | 低沉 | `[low voice] 声、聞こえる？` | ★官方博客 |
| `[wet sounds]` / `[moist]` / `[licking]` | 湿润声/舔音 | — | ❌ **无任何官方依据，纯社区臆造，实测未验证** |
| `[喘息]` / `[娇喘]` / `[呻吟]` | 中文同义 | `[娇喘] 啊…嗯…` | ☆社区；官方支持中文标记（ASR 侧有 `[高兴]` 先例），但中文成人向标记无官方依据 |
| `[湿润的声音]` | 湿润音色 | — | ❌ 无依据 |

**⚠️ 最重要的一条（来自官方博客原文）**：
> **Test your voice before scripting.** Different voices respond to the same tag with different intensity. … **If a tag isn't landing the way you expect, try a different voice before adjusting the tag itself — the issue is often the voice, not the instruction.**

→ 对本项目：**选一个本身就是「breathy / intimate / ASMR」的音色，比在提示词里堆亲密向标记有效得多。** Fish 公共音色库里有大量此类音色（已实测可检索到 `喘ぎ声`、`Intimate Breath`、`Mommy ASMR`、`nsfw voice` 等，见 §7.5）。

---

## 10. 未证实 / 存疑 / 需要实测的事项（诚实清单）

| 事项 | 状态 |
|---|---|
| 中文成人向标记（`[娇喘]` `[呻吟]` `[湿润的声音]`）是否真生效 | **未证实**。官方支持中文标记（`[低声说]` 有官方例），但成人向中文词无任何官方依据，本机未做听感验证 |
| 日文标记是否与英文等效 | **未证实，且社区倾向英文更稳**（HodaPress：「英語タグのほうが学習データが多く、安定しやすい」）。本机未做 A/B 听测 |
| 全角 `【】`/`［］`、未闭合 `[`、嵌套 `[a[b]]` 是否会被解释 | **未证实**。实测不报错、不被念出，但无法判断是否生效 |
| 大写 `[SAD]` 是否等价于 `[sad]` | **未证实**。单次样本时长显著不同，但 §2.4 已证明时长不可靠 |
| 标记文本是否计入计费 UTF-8 字节 | **官方未明说**。官方只说 "Emotion markers don't count toward token limits"，而计费单位是输入 UTF-8 字节 —— 二者不是同一件事 |
| `s2.1-pro-free` fair-use 的具体阈值 | 官方未公布数字 |
| `s2.1-pro-free` 是否在 2026-11-30 后彻底关闭 | 官方措辞是 "at no cost **through** November 30, 2026"，之后如何未说明 |
| 官方是否有 TTS 请求期内容审核 | 实测未见任何拦截（含显式内容）；官方文档无 TTS 安全页；ToS 保留事后 monitor/prohibit 权 |
| `[+tag]` / `[-tag]` 状态开关语法 | **无官方依据**，疑为社区臆造，**不要用** |
| 「方括号独占式」生成纯喘息/呼吸声 | **实测可出声但不可控**（`[sad]` 独占产出 2.53s 非语言声）；官方明确反对 ("Don't leave a descriptive tag without text after it") |
| 剧作家模型写出的自由描述是否都能生效 | **不能保证**。官方称「open-domain / novel tags generalize well」，但 #1280 已证明中性文本上效果弱、且标记解读存在不稳定性 |

---

## 11. 给 AIVN 的落地建议（基于上述证据的推论，标注为建议而非事实）

1. **语法统一**：提示词里规定「语气标记一律使用半角方括号 `[标记]`，写在受影响的词/句正前方，标记后必须跟台词文本，标记内不得有空格/嵌套/引号」。
2. **清单收敛**：优先只暴露 §9.1–9.3 中 `★官方表格` / `★官方其他页` 的标记（约 80 个），并可给模型「允许用 `[自由描述]`」的口子（这是 S2 的官方卖点，也是补齐「流泪/咬牙/哽咽」等细粒度情绪的唯一手段）。
3. **每句 1–2 个标记**，硬性上限 2（官方说 3，第三方建议 2；galgame 单行通常很短，3 个会互相稀释）。
4. **句首放情绪，句中放声音/强调**，绝不放句尾或单独成句。
5. **优先英文标记**，即使台词是日文/中文。
6. **不要用 `()`**：无效果且容易与台词内的括号内容混淆。
7. **让台词本身带情绪语义**：来自 [Issue #1280](https://github.com/fishaudio/fish-speech/issues/1280) 的核心发现 —— 标记是放大器不是覆盖器。剧作家写「淡淡的「そう。」」配 `[sad]` 效果会很弱，写「[sad] もう…終わりにしよう。」才有效。**这条应当写进提示词的「台词写作原则」而不只是「标记清单」。**
8. **亲密场景靠音色而非标记**：把 `voice_id` 与「情绪档位」解耦，为亲密场景单独准备 breathy/ASMR 音色。
9. **标记以外的两个补充杠杆**：`<|phoneme_start|>` 钉人名/拟声词读音；`temperature`（0.7→0.8）微调表现力波动。
10. **合规**：`s2.1-pro-free` 免费期 2026-11-30 截止；成人向内容处于 ToS 灰色地带，建议评估 S2-Pro 自托管作为退路（但注意官方承认网页/API 端有一套 self-host 没有的 orchestration pipeline，会显著影响情绪表现质量）。

---

## 12. 来源清单

### 官方（Fish Audio 自有域名）
- [Emotion Control — docs.fish.audio](https://docs.fish.audio/developer-guide/core-features/emotions) —— **主参考**：完整情绪表、Tone/Audio Effects/Special Effects、Placement Rules、Intensity Modifiers、Performance Notes
- [Emotion & Expression Control — docs.fish.audio](https://docs.fish.audio/developer-guide/best-practices/emotion-control) —— S1 legacy 页，含 S1 troubleshooting 规则
- [Models Overview — docs.fish.audio](https://docs.fish.audio/developer-guide/models-pricing/models-overview) —— 模型能力对比、S1 的 24/25/5/10 清单
- [Text to Speech API Reference — docs.fish.audio](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech) —— 全部请求字段与默认值
- [Fine-grained Control — docs.fish.audio](https://docs.fish.audio/developer-guide/core-features/fine-grained-control) —— 音素标签、`(break)` 等 paralanguage
- [Migrate from S1 — docs.fish.audio](https://docs.fish.audio/developer-guide/models-pricing/migrate-from-s1) —— 三处行为差异
- [Changelog — docs.fish.audio](https://docs.fish.audio/developer-guide/getting-started/changelog) —— s2.1-pro-free 免费至 2026-11-30
- [Drama 3 — docs.fish.audio](https://docs.fish.audio/features/text-to-speech/drama-3) —— 成对标签 `<whisper>`/`<emphasis>`/`<soft>`/`<fast>`/`<slow>`/`<stress>`/`<forceful>`
- [Drama 3 产品页 — fish.audio](https://fish.audio/drama-3/)
- [Pricing & Rate Limits — docs.fish.audio](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits)
- [Voice Cloning — docs.fish.audio](https://docs.fish.audio/features/voice-cloning)
- [Instant Voice Cloning cookbook — docs.fish.audio](https://docs.fish.audio/developer-guide/sdk-guide/cookbook/instant-voice-cloning) —— `references[].text` 必须与音频完全一致
- [Text to Speech feature page — docs.fish.audio](https://docs.fish.audio/features/text-to-speech)
- [S2 官方博客（英） — fish.audio](https://fish.audio/blog/fish-audio-s2-fine-grained-ai-voice-control-at-the-word-level/) —— well-tested 标记分类表、四语言标记示例、Tips
- [S2 官方博客（中） — fish.audio](https://fish.audio/zh-CN/blog/fish-audio-s2-fine-grained-ai-voice-control-at-the-word-level/)
- [S2 官方博客（日） — fish.audio](https://fish.audio/ja/blog/fish-audio-s2-fine-grained-ai-voice-control-at-the-word-level/)
- [Fish Audio 开源 S2 博客（中） — fish.audio](https://fish.audio/zh-CN/blog/fish-audio-open-sources-s2/)
- [Voice Design 博客（日） — fish.audio](https://fish.audio/ja/blog/voice-design/)
- [GitHub fishaudio/fish-speech](https://github.com/fishaudio/fish-speech) —— "15,000+ Unique Tags" + Rich Emotion Library 33 词
- [HuggingFace fishaudio/s2-pro](https://huggingface.co/fishaudio/s2-pro) —— 同上
- [Fish Speech README（中）](https://speech.fish.audio/README.zh/) / [README.zh](https://speech.fish.audio/zh/README.zh/)
- [Terms of Use — fish.audio](https://fish.audio/terms/)
- [Customer Agreement（企业） — fish.audio](https://fish.audio/enterprise-terms/)
- [喘ぎ声 音色落地页（日） — fish.audio](https://fish.audio/ja/m/63fc7405de8b4c1ab70d3c04dc2831ff/)
- [喘ぎ声 音色落地页（英） — fish.audio](https://fish.audio/m/688f774faaef4f7f9cf3facfe7aabddf/)
- [Text to Speech API 营销页 — fish.audio](https://fish.audio/text-to-speech-api/)
- [docs.fish.audio/llms-full.txt](https://docs.fish.audio/llms-full.txt) —— 全文（本次抓取 942,961 字节）

### 官方（GitHub issue/discussion/commit）
- [Issue #1162 — Emotion tags don't seem to do anything](https://github.com/fishaudio/fish-speech/issues/1162)（bug 标签）
- [Issue #1031 — Emotional control doesn't seem to be very useful](https://github.com/fishaudio/fish-speech/issues/1031)
- [Issue #1280 — S2-Pro: bracket emotion control appears weak on emotion-neutral transcripts](https://github.com/fishaudio/fish-speech/issues/1280) —— **最关键的实证**
- [Discussion #1302 — What are all the Inline Tags for S2 Pro?](https://github.com/fishaudio/fish-speech/discussions/1302) —— 「15000+ 不是可枚举白名单」
- [Discussion #1217 — Local quality worse than web demo](https://github.com/fishaudio/fish-speech/discussions/1217) —— 官方支持团队关于 orchestration pipeline 的答复
- [docs commit 9184a08](https://github.com/fishaudio/docs/commit/9184a08f69a9a2755fbc2c01bbcdb334269e11e6) / [docs PR #97](https://github.com/fishaudio/docs/pull/97) —— 情绪文档重构与 `[emphasis]`/`[clear throat]` 补录
- [Saganaki22/ComfyUI-FishAudioS2 README_ZH](https://github.com/Saganaki22/ComfyUI-FishAudioS2/blob/v0.5.2/README_ZH.md)

### 官方合作/集成方
- [ComfyUI × Fish Audio Prompt Guide — docs.comfy.org](https://docs.comfy.org/tutorials/partner-nodes/fishaudio/prompt-guide) —— 中文版：[zh](https://docs.comfy.org/zh/tutorials/partner-nodes/fishaudio/prompt-guide)、日文版：[ja](https://docs.comfy.org/ja/tutorials/partner-nodes/fishaudio/prompt-guide)

### 第三方（聚合/评测/教程，非官方）
- [Runware — Fish Audio S2.1 Pro: Emotion and expression control](https://runware.ai/docs/models/fish-audio-s2-1-pro/guides/emotion-and-expression)
- [Vellum — Fish Audio TTS Skill](https://www.vellum.ai/skills/fish-audio)
- [JarodMica gist — Fish Audio TTS Prosody Tags（面向 s2.1-pro 的系统提示词）](https://gist.github.com/JarodMica/8197976f2bde9fa8a27f026df9725b1a)
- [HodaPress — Fish Audio 感情タグ完全ガイド（日）](https://review.waction.org/tools/fish-audio/emotion-tag)
- [queststudio.io — Fish Audio Emotion Tags: Fix S1 and S2.1 Syntax Confusion](https://queststudio.io/blog/fish-audio-emotion-tags-guide) 与其[审核表](https://queststudio.io/static/blog/fish-audio-emotion-tags-guide-worksheet.md)
- [instagit — How to Use Inline Emotion and Prosody Control Tags in Fish-Speech](https://instagit.com/fishaudio/fish-speech/how-use-inline-emotion-prosody-control-tags.md)
- [Astorie — Fish Audio S2 对话生成（中）](https://astorie.ai/zh-CN/how-to/generate-dialogue/fish-audio-s2) / [声音特效（日）](https://astorie.ai/ja/how-to/create-sound-effects-for-video/fish-audio-s2)
- [云声配音 — Fish-Speech 情感与控制指令 S1 教程](https://www.yuntts.com/649.html) / [Fish Speech 情绪控制完整说明](https://www.yuntts.com/882.html)
- [ComfyUI资源网 — S2 终极表现力控制指令词典](https://www.comfyorg.cn/3243.html)（**含大量未经官方验证的扩展标签与 `[+tag]` 语法**）
- [深入理解 AI Agent — 实验 6-6：Fish Audio S1 控制标记 TTS](https://lvgog.com/agent-book/zh/chapter6/controllable-tts/)
- [blog.ax0x.ai — Making AI Voices Cry: A Doubao TTS Emotion Experiment](https://blog.ax0x.ai/doubao-tts-emotion-research)
- [Like Magic AI — Fish Audio S2 Review](https://likemagicai.com/2026/06/02/fish-audio-s2/)
- [VocalCopyCat — Fish Audio S2 Research](https://www.vocalcopycat.com/blog/fish-audio-s2-expressive-speech-research)
- [BreezeBlue — 音声ディレクションとオーディオタグ](https://breezeblue.ai/ja/blog/pair-voice-direction-with-audio-tags)

### 易混淆的**第三方平台**（**不是** Fish Audio 官方，勿引用其 `emotion` 字段/`modelId`）
- [docs.fishaudio.org](https://docs.fishaudio.org/en/docs/control-instructions/fine-grained-emotion/s2) / [zh](https://docs.fishaudio.org/zh/docs/control-instructions/fine-grained-emotion/s2) —— Kitta Audio
- [fishaudio.org Acceptable Use Policy](https://fishaudio.org/en/acceptable-use) / [Credits](https://fishaudio.org/en/pricing/credits)
- [fishspeech.net](https://fishspeech.net/zh/voice-clone-tutorial)
- [www.fish-audio.net](https://www.fish-audio.net/terms)

---

## 13. 本机实测方法与原始结果（可复现）

**环境**：`/usr/local/bin/fish-tts` 同源逻辑改写；`POST https://api.fish.audio/v1/tts`；`model: s2.1-pro-free`；`reference_id: 0c7771ca5910484e8a4933068017fcee`（Rem）；`format: mp3`；`temperature: 0.7`；经 `http://127.0.0.1:7890` 代理；多 Key 轮询。

**回读验证**：用 Google Gemini（`gemini-3.5-transcribe` / `gemini-3.8-flash`）对生成音频做逐字转写，判断标记是否被念出。
**注**：Fish Audio 自家 `/v1/asr` 在本机返回 `402 Insufficient API credit`（**API 额度与平台额度互相独立**），故改用外部 ASR。

**第 1 轮（10 例，全部 HTTP 200）**：A_plain / B_bracket_emotion / C_paren_legacy / D_invented_tag / E_moaning / F_panting_breathy / G_cn_freeform / H_english_nsfw / I_tag_at_end / J_multi3

**第 2 轮（15 例语法变体，全部 HTTP 200）**：K_base / K_paren_sad / K_bracket_sad / K_fullwidth / K_cn_brackets / K_unclosed / K_nested / K_overflow5 / K_explicit_nsfw / K_explicit_en / K_tag_only / K_caps / K_space_inside / K_pipe / K_emoji_tag

**第 3 轮（7 变体 × 4 次重复 = 28 请求，用于方差分析）**

**ASR 回读关键结果**：
```
A_plain          -> おかえりなさい、ご主人様。
B_bracket_emotion-> さようなら もう 会えない          ← "[sad][whispering]" 未被念出
C_paren_legacy   -> さようなら。もう会えない。          ← "(sad)(whispering)" 未被念出
D_invented_tag   -> テストです                        ← 无效标记未被念出
E_moaning        -> あー、そこはダメ。                 ← "[moaning]" 未被念出
F_panting_breathy-> うう、もう、走れない               ← "[panting][breathy]" 未被念出
K_base           -> おかえりなさい、ご主人様。今日はいい天気。
K_paren_sad      -> おかえりなさいご主人様。今日はいい天気ですね。
K_bracket_sad    -> お帰りなさい、ご主人様。今日はいい天気ですね。
K_fullwidth      -> おかえりなさい。 ご主人様。 今日はいい天気です。
K_cn_brackets    -> お帰りなさい、ご主人様。今日はいい天気ですね。
K_nested         -> おかえりなさい、ご主人様。今日はいい天気です。
K_overflow5      -> お帰りなさい、ご主人様。今日はいい天気ですね。
K_caps           -> ふああ、おかえりなさい、ご主人様。今日はいい天気ですね。
K_space_inside   -> おかえりなさいご主人様。今日はいい天気です、ね。
K_pipe           -> お帰りなさい、ご主人様。今日はいい天気ですね。
K_emoji_tag      -> お帰りなさい、ご主人様。 今日はいい天気です。
K_tag_only       -> <GASP>                            ← 标记独占 → 纯非语言声
H_english_nsfw   -> Ah Ah, please, don't.
```
**共同结论：没有任何一种标记形态被念出来。** 包括 S1 小括号、全角括号、未闭合、嵌套、大写、`<|laugh|>`、臆造词、emoji。

**并发/额度实测**：
- `/v1/tts` 在 `s2.1-pro-free` 下免费可用（本机 8 个 Key，Key#0 即成功）
- `/v1/asr` 返回 `402 — API credit is managed independently from platform credit`
- 公共音色库 `GET https://api.fish.audio/model?title=...` 免费可用（本文 §7.5 数据即由此获得）
