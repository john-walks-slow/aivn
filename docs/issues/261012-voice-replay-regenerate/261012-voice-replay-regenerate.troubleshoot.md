# 重听对「没生成过语音的行」按需补生成（261012）

## 现象

导演工具栏那个语音键，对**过去没生成过语音**的行点了没反应：

- 那一行没有音频时，键根本不出现（`voiceState` 只有 pending/ready 两态有键）；
- 就算出现，点了也只是「重播已有的 URL」——台账里没有就什么都不发生。

用户的期望：**再点一下应该是重新生成并播放**。

## 根因

两条各自都成立的原因叠在一起：

1. **客户端只有一张内存 URL 台账**（`VoiceDirector.urls`，靠 `audio_ready` 帧填充）。
   刷新页面、换设备、或当时语音开关关着，这一行的台账就是空的——**空台账 ≠ 没有音色**，
   但界面分不出这两件事，只能一律不摆键。
2. **服务端没有「按需补生成一行」的入口**。语音只在演出流里顺带预取：那一轮没生成，
   事后没有任何办法让它补上（内容寻址缓存里也许有文件，但没有谁去把 URL 发回来）。

`audio_pending` 是唯一的「在合成」信号，而它只在演出流里发——所以补生成这条路要从协议开始接。

## 修复

- **协议**（`packages/core/src/ws/protocol.ts`）：
  - 客户端 → 服务端 `voice_request {seq}`；
  - 服务端 → 客户端 `audio_failed {seq, phrase}`（原来合成失败只打一行告警，界面要靠 45s 兜底上界才熄灯）；
  - hello 的 `cast` 每项多一个 `voice`：这个角色配得出声吗（角色卡音色或剧目级兜底音色）。
- **服务端**：
  - `VoicePipeline.synthesizeLine(seq, charId, text)`：按同一套分句规则把整行**一次性排上**
    （于是客户端先收到这一行全部的 `audio_pending`，知道自己该等几句），再按并发上限合成；
    生成过的短语命中内容寻址缓存，秒回且不重复烧配额。
  - `orchestrator.requestVoice(seq)`：从事件流里取回**当时那一行**的说话人与台词（不是重新生成剧本），
    交给同一条管线；`transport` 收 `voice_request` 转给它。
- **客户端**：
  - `VoiceDirector.requestReplay(seq)`：台账里已经有这一行的音频 → 直接重播（不打扰服务端）；
    没有 → 记下「用户点名要听这一行」并请服务端补生成。
  - 到齐才起播：补生成的短语是**一次全报**的，所以「pending 清空」就等于这一行做完了——
    不会照第一句回来的就播，又切成「只配前半句」。
  - `StageTheater`：工具栏与回顾里的键，在这一行「还没音频但配得出声」时也摆出来
    （`voiceCast` 由宿主从 hello 的 cast 传进来；不给这张表的宿主＝这条能力不开，行为与原来一致）。

![补生成中的那一帧](assets/replay-button-pending.png)

## 验收

- 单元：`pnpm --filter @aivn/server test test/voice.test.ts`（17 例：补生成沿用原 seq 与短语号、
  旁白/不存在的 seq 不冒泡、失败明说 `audio_failed`、改写后按新台词、改写作废旧代（在飞不发/排队扔掉）、
  观众不在时攒下的旧帧抬代后不补推）；`pnpm --filter @aivn/stage test`（70 例，其中 `voiceReplay.test.ts`
  九条：没有台账才求服务端、连点只求一次、换行照求、关语音再开后还能重试、全失败收手、作废后旧帧不收、
  改写后旧音频作废…）。
- 真机 E2E（假模型网关 + 真 Fish TTS，`/tmp/aivn-repro/drive-voice-request.mjs`）：
  语音关着演完一轮 → `ready 帧 0 / 缓存文件 0` → 发 `voice_request` →
  `pending=[0,1] ready=[0,1] 缓存文件=2`（帧沿用原 seq，两个短语一次性报齐，音频落进缓存）。
- 浏览器 E2E（headless Chromium 打真服务端，`/tmp/aivn-repro/browser-replay.mjs`）：
  演完一轮 → **刷新页面**（台账清零，模拟换设备）→ 工具栏出现「这一句还没有语音，点一下生成」
  → 点击 → 发出 `voice_request {seq:35}` → 服务端回 `audio_pending 35/0 35/1` 再回 ready
  → 客户端去拉这一行的音频（起播）→ 键变成「重听这句」。

```bash
# 服务端那条路（真打 Fish，一次调用）
/tmp/aivn-repro/run-voice-request.sh
# 浏览器那条路（刷新后台账为空的行）
BASE=http://localhost:<port> OUT=/tmp/replay.png node /tmp/aivn-repro/browser-replay.mjs
```

## 遗留

- 台账**部分有**的行（前半句在、后半句不在）走的是「直接重播已有」那条快路，不会去补后半句。
  要一并治，得让客户端知道「这一行一共几句」——那是把 `audio_pending` 的语义从「正在合成」
  扩成「这一行有几句」，属于协议层的另一笔。本次只做用户点名的「没生成过」那一种。
- `dsh-aivn` 那条线不传 `voiceCast`，所以按需生成的键在那条线上不出现（行为与改动前一致）；
  共享包改动仍要在 DSH 侧重建 `lib/` 后才算落到位（按 `docs/references/261009-cross-host-verification.md`
  的矩阵，`packages/core` + `packages/stage` 两条都要走 DSH 侧构建与舞台验证）。
- **角色换音色不追溯旧录音**：过去已经生成好的那些行按「录音」保留，重听照放旧声音。
  声音是内容寻址（`sha1(voiceId + 文本)`），要连带作废得先有产品口径；本次只保证
  「台词改了 → 旧声音作废（行代次）」，不把「换了音色」隐式塞进语音开关或台账的失效逻辑。
- 补生成有 20s 的等待上界：请求在断线时丢掉、或服务端不受理（没有回执）时，到点放下
  「已经问过了」的记号，让同一行还能再点一次——不然重试入口会被幂等标记焊死。
