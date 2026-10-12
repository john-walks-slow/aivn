# 一行台词一条语音 — 重构小结（261012）

用户原话：**「不要边流边切。重构、简化。一句一起送」**。

## 结果

一行 `<say>` = 一次 TTS 请求 = 一个音频文件。播放端不再有短语链，「缺一段就停在半句」
这个故障类**从结构上消失**：一行要么有音频、要么没有。

| 层 | 改动 |
| --- | --- |
| `packages/core` | `PhraseChunker` / `speechLength` 删除，`normalizeForTts` 挪进 `speech/text.ts`；协议三个语音帧去掉 `phrase` |
| `apps/server` | `VoicePipeline` 攒整句、`say_end` 一次送；补生成同样整句一次 |
| `packages/stage` | `VoiceDirector` 一行一个 buffer，台账 `seq → url`；短语链/墓碑/批等全部删掉 |
| `apps/web` | 三个语音处理函数少一个 `phrase` 参数 |

净变化：**-736 / +355 行**（含两个被整段删掉的分句测试文件）。

保留的机制（与分不分句无关，前面两轮挣来的）：台词代次（原地改写作废旧活儿）、
观众离场攒帧补推、轮边界交班、并发上限、客户端背压暂停、按需补生成、失败明说 `audio_failed`。

## 检视

`261012-voice-line-level.review.md`：两轮。第一轮拦下三条——客户端清旧行后没重算背压（残留
`paused:true` 会把服务端泵永久停住）、交班没带 `enabled`/`paused`（重建会把「玩家关了语音」翻回去）、
失败帧不通知界面（喇叭一直闪着）。第二轮又抓出 `takeVoiceBacklog()` 判空没算开关状态（同一个漏洞的另一扇门）。
四条都已修并补了用例（含 `take → 停旧 → 接手` 真路径）。

跨宿主顺序由用户裁定：**先合本仓，DSH 随后单独适配**（那边现在有另一位 agent 未提交的改动，
且 `src/tools/cut.ts` 本来就编译不过）。DSH 侧已经改完（未提交，见下）：`src/voice/voice.ts` 下线 `PhraseChunker`/`chunkLine`/短语号、
整句一次送并补 `failed` 帧，`voice-host.ts` 的 `replayCached` 按整行找缓存文件名，`hub.ts` 与
`src/client/stage-view.tsx` 的语音帧类型少一个 `phrase`；`npm run build` +
`node build.mjs --check` 绿（产物与源码一致），`tsc --noEmit` 只剩**那边自己的**在飞改动
`src/tools/cut.ts` 缺 `figureTop`。用 esbuild 把 `src/voice/voice.ts` 单独打出来喂假 synth 验过：
整句一条请求、失败明说一帧、纯省略号不合成。
**那两处改动没有提交**：`dsh-aivn` 工作区里有另一位 agent 未提交的改动（含 `stage-view.tsx` 与
`lib/*.js`），而 `lib/` 是构建产物、没法只提交我这半——留给那边一起收。

## 验证

- `@aivn/core` 263 / `@aivn/stage` 80 / `@aivn/server test/voice.test.ts` 18 例全绿，`pnpm typecheck` 全绿。
- 真机（真 Fish）：补生成一行 → 1 条 pending、1 条 ready、缓存 1 个文件。
- 浏览器（刷新后台账为空的行）：点击 → 请求 → 这一行的帧回来 → 拉这一个文件起播 → 键变「重听这句」。

## 遗留

- 出声道次比原来晚：整句合成完才出声（长句更明显）。这是「一句一起送」的直接代价。
- TTS 缓存换代：旧短语文件成为孤儿，存量剧目的行第一次重放会真合成一次。
- 超长行不切分（TTS 上游若静默截断会缺尾巴），真遇到再定口径。
- DSH 那条线（`dsh-aivn`）自带一套分句语音宿主，吃的是 `@aivn/stage` 的
  `handleAudio/markPending` 旧签名——共享包这次是**破坏性改动**，那边必须跟着改并重建 `lib/`
  （见 [`261009-cross-host-verification.md`](../../references/261009-cross-host-verification.md)）。
