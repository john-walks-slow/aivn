# 语音只配了省略号前半句（261012）

## 现象

用户报告：**「带省略号的句子常常只配了省略号前半句」**。听感是这一句的前半截有声音，后半截没有；
长句被逗号切出来的情况下同样是「前面那截响、后面那截不响」。

## 复现

不需要真模型：`@aivn/core` 的分句器只吃文本流，所以造一台**假模型网关**（OpenAI 兼容 SSE，
按固定节奏吐一份写死的剧本）+ 一个 Node WS 客户端当舞台即可，节奏可控。

- 剧本：6 行 `<say>`，每行都带省略号（→ 每行必然切成 2 个短语，共 12 个短语）。
- 假网关每 400ms 吐 6 个字，整份剧本 ~16s 吐完。
- 客户端 `start` 后第 5 秒**硬断开**（模拟手机锁屏/切后台），第 17 秒连回来（`resume` + `tts_control enabled`）。

修复前的结果（6 行 × 2 短语）：

```
✅ 完整  seq=1  发出过=[0,1] 到位=[0,1]
⚠️ 只配到一半  seq=7  发出过=[0,1] 到位=[0]     ← 只响前半截
❌ 整行没声音  seq=14 … seq=35
TTS 缓存 4 个文件（期望 12）
```

修复后同样场景：**6 行全完整、缓存 12/12**。

实测数据留在 `apps/server/test/voice.test.ts`（单元级）与本文末尾的验收标准里。

## 根因

两处，症状一样，都是**队列里已经许出去的句子被丢掉**：

1. **最后一个舞台连接断开时把语音队列整条清空**（`transport.ts` 的 `drop()` →
   `orchestrator.setTtsState({ enabled: false })` → `VoicePipeline.setEnabled(false)` 里
   `this.queue.length = 0`，同时 `enabled=false` 让此后到来的短语**连队都进不去**）。
   设计意图是「没人消费 audio_ready 了，省配额」，但 `enabled=false` 是个**单向**的重开关：
   客户端重连会重发 `enabled: true`，于是**新短语照做、被清掉的那些永远不做**。
   TTS 本来就落后于文字流，队列里压着的正是玩家此刻在听的那几行——所以断一次线就切一行。

2. **轮边界重建 runtime 时 dispose 掉旧管线**（`playhouse.ts` 的 `reloadAfterWorkshopWrite` /
   `reload` → `orchestrator.dispose()` → `voice.dispose()`）。重建只等「这一轮生成完」
   （`whenIdle`），而玩家多半还在读这一轮最后几句，队列里那几句跟着 `dispose` 一起没了。
   触发条件很常见：剧作家写记忆卡/角色卡、工坊保存、设置页改动都会排一次轮边界重建。

**为什么症状偏偏长在省略号上**：省略号是分句器的硬切点，带省略号的句子必然被切成 ≥2 个短语；
断线/重建时丢掉的是队列里**靠后**的那些短语（FIFO），于是这一句只出声前半截。
不带标点的短句整句就是一个短语——它要么整句响、要么整句不响，读起来不像「配了一半」。
缓存取证也印证了这一点：拿 `sha1(voiceId + "\0" + normalizeForTts(短语))` 逐短语去比对
`plays/<id>/media-cache/tts/`，凡是「部分命中」的行**一律是前缀**（前 k 个短语在、后面全不在），
说明丢的是队列尾巴，不是随机失败。

顺带确认的一条：客户端的链式调度是**严格按短语序号**推进的（`audio.ts` 的 `trySchedule`
从 `nextToPlay` 起找），缺一个短语就停在那儿——所以后端丢掉的那一句，客户端那边是**永久**缺声，
不是「晚点补上」。

## 修复

- `VoicePipeline` 增加第三道门 `audience`（与 `enabled` 分开）：
  - 观众离场**只停泵**：队列继续收、已经许出去的句子继续排队，不再清空；
  - 离场期间合成完的帧（`audio_ready`）也留着，人回来按原序补推；
  - `enabled` 仍是「玩家自己关的语音」：队列与攒下的帧一起作废（客户端那边整行也清了）。
- `transport.ts`：最后一个观众离场 → `setTtsState({ audience: false })`；
  舞台连接建立（且登记进广播组之后）→ `{ audience: true }`，在这一刻补推并接着排队。
- 轮边界重建接力：`VoicePipeline.handover()` / `adopt()` 把「排队中的句子 + 在飞的句子 + 攒下的帧
  + 当时的观众状态」交给新一任编排器。在飞的那两句**故意也交出去**：新管线重排一遍会命中内容寻址缓存
  （同一个 `FishTts` 客户端里去重的是同一个请求），所以既不重复烧配额，也不丢这两句。

## 验收标准

- 单元：`pnpm --filter @aivn/server test test/voice.test.ts`
  - 观众离场期间零上游请求、零下发；回来之后三句一句不少、顺序不变。
  - `handover()` 交出的队列含在飞的句子；新管线接手后三句全部发出。
- 端到端（假模型网关 + 假舞台，脚本见下方命令）：
  - 断线场景：`完整 6 / 一半 0 / 全无 0`，缓存 12/12。
  - 重建场景（流到一半改 `settings.json` 触发轮边界重建）：同样 `完整 6 / 一半 0 / 全无 0`。

```bash
# 假网关（写死剧本、按节奏吐）
MOCK_PORT=<port> MOCK_CHUNK_MS=400 MOCK_CHUNK_CHARS=6 node mock-llm.mjs
# 服务端指过去（数据目录另起，settings.json 的 baseUrl 指向假网关）
STAGE_DATA_DIR=<tmp> STAGE_PORT=<port> node apps/server/dist/index.js
# 假舞台：start → 5s 断线 → 17s 重连 → 汇总
STAGE_PORT=<port> TTS_CACHE=<tmp>/plays/repro/media-cache/tts node drive.mjs
```

## 遗留

- 客户端链式调度「缺一个短语就永久停住」这条没有改：本问题的病根在服务端丢活儿，
  补上之后缺短语只剩「TTS 真失败」与「进程被重启」两种罕见情况。真要治，得给短语加一帧显式的
  「这句没了」，客户端据此跳过去——那是协议改动，留作后续。
