# 一行台词一条语音：分句合成整条下线（261012）

## 症状

用户听到的是「半句半句的」：一句台词只响了前半截，后半截永远不来。前面两个 issue
（[`261012-voice-phrase-tail-loss`](../261012-voice-phrase-tail-loss/261012-voice-phrase-tail-loss.summary.md) 丢队列、
[`261012-voice-replay-regenerate`](../261012-voice-replay-regenerate/261012-voice-replay-regenerate.summary.md) 按需补生成）
都是在**分句合成**这套结构上打补丁：一边丢活儿，另一边把缺的那一段补回来。

## 根因

「半句」这个故障不是某一处 bug，是**结构**给的：

1. 一行台词被 `PhraseChunker` 边流边切成若干短语（硬切 `。！？`、省略号整组、长度 ≥30 的软切）；
2. 每个短语单独一次 TTS、单独一个文件、单独的 `(seq, phrase)` 帧；
3. 客户端按短语序号链式拼接播放，**缺一个就停在它前面**。

于是「服务端少发了/丢了某个短语」「客户端台账只记到一部分」「某一句合成失败」——
每一条都会表现成同一个症状：只响前半句。要在这套结构里做到「一定不会半句」，
得让链路每一环都保证不丢（代次、补推、补生成、批次收束…），这正是前面两轮补的东西，
补到最后仍然留着一条：「台账里只有前半句的行」不会去补。

用户 2026-10-12 的裁定：**不要边流边切，一句一起送，重构、简化**。

## 改法

一行 say = 一次 TTS 请求 = 一个文件：

- **core**：`PhraseChunker` 与 `speechLength` 删除，`normalizeForTts` 留下（挪进 `speech/text.ts`）；
  协议里 `audio_ready/audio_pending/audio_failed` 去掉 `phrase` 字段。
- **服务端**：`VoicePipeline` 只攒文字，`say_end` 时整句送去合成；补生成（`voice_request`）
  同样是整句一次。台词代次（原地改写作废旧活儿）、观众离场攒帧、交班接力、并发上限、
  背压暂停全部照旧——它们与分不分句无关。
- **客户端**：`VoiceDirector` 一行一个 `AudioBuffer`，台账 `seq → url`；
  短语链、`nextToPlay`、解码失败墓碑、批次批等全部删掉。背压阈值改按「已到货未播的行数」算
  （一行一文件，一条就是几秒到十几秒）。

副作用与取舍：

- **出声更晚**：这一行的声音要等整句合成完（长句更明显）。愿意接受——一行写完到玩家读完
  本来就有余量，而「半句」是不可接受的失败。这也是 VN 引擎的常规做法
  （Ren'Py `voice` / Naninovel `@voice` 都是一条台词一个文件，见
  [`261002-vn-voice-and-audio-presentation.research.md`](../../features/261002-dsl-v2/261002-vn-voice-and-audio-presentation.research.md) §3.1
  的「行级 vs 句级」）。
- **TTS 缓存整体换代**：缓存键是 `sha1(voiceId + 文本)`，文本从「短语」变成「整行」，
  旧短语文件成为孤儿（`media-cache/tts/` 是可重建缓存，留着不碍事，要清可整个删）。
  存量剧目的每一行在第一次重放时会真合成一次。
- **超长行没有兜底切分**：一行几百字也照一次送。TTS 上游若有静默截断，表现会是「尾巴没有声音」
  ——真遇到再按产品口径决定（要么写作参数限长，要么回来做句级兜底），不预设。

## 验收

- 单元：`@aivn/core` 263 例（`text.test.ts` 接替 `chunker.test.ts`）、`@aivn/stage` 80 例、
  `@aivn/server test/voice.test.ts` 18 例全绿；`pnpm typecheck` 全绿。
- 真机 E2E（假模型网关 + 真 Fish，`/tmp/aivn-repro/drive-voice-request.mjs`）：
  语音关着演完一轮 → `ready 0 / 缓存 0` → `voice_request` → 该行 **1 条 pending、1 条 ready、
  缓存 1 个文件**。
- 浏览器 E2E（headless Chromium，`/tmp/aivn-repro/browser-replay.mjs`）：
  演完一轮 → **刷新**（台账清零）→ 工具栏「这一句还没有语音，点一下生成」→ 点击 →
  `voice_request{seq}` → 服务端回这一行的帧 → 客户端拉这一个文件起播 → 键变「重听这句」。
  这一轮实测抓出并修掉了一个真 bug：**别的行的迟到帧把「等这一行」的记号放掉了**
  （`flushWantReplay` 只认它自己那一帧，已补回归用例）。
