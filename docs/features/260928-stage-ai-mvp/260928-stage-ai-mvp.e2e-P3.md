# stage-ai P3 语音管线 E2E 测试报告

- **日期**：2026-09-28 18:33 – 19:15
- **被测**：P3 语音管线（D5，reviewer 修复后代码）——服务端 PhraseChunker 分句 → fish-audio 预取 → WS `audio_ready`；web VoiceDirector gapless 调度 / 解锁遮罩 / 语音开关 / 快进淡出 / 自动模式 hold / 背压；素材页音色下拉与试听（web :5180 → server :8787，真 LLM + 真 fish-audio key）
- **方法**：Playwright（Chromium headless，`--autoplay-policy=no-user-gesture-required`）浏览器自动化；以可观测信号替代听感——WS 帧监听（audio_ready/tts_control 双向）、`/plays/demo/media/tts/*.mp3` 请求与 content-type、页内 MutationObserver 行时间线、`new AudioContext().state` 旁证、console/pageerror/unhandledrejection 全程监控。共 5 轮（r2 全量 / r3 严判回归 / r4 刷新恢复 / r5 背压专项；r1 为修复前旧代码作废轮）
- **结论**：**功能与回归项全部通过，未发现产品缺陷**；全程 console/page/unhandled rejection 零错误。1 项（自动模式 hold）受 fish-audio 实时合成延迟制约无法自然形成测试场景，判环境受限而非缺陷，留用户真机验收

## 测试环境事实

- demo 剧目 koharu（小春）voiceId `f82e3885…`（萝莉萌妹中文音色）；会话从 beat-3 choice 停止点续演
- fish-audio `s2.1-pro-free` 实时合成延迟波动大：**1.3s（sha1 缓存命中）~ 80.7s**，中位约 30s；一拍 beat 总时长约 32s
- 真模型一拍生成（选项→beat_start）稳定在 ~120ms 路由 + 30s 流式
- 语音行组实测：一拍 4-8 个 audio_ready（按 say 行 seq 分组、短语乱序到达）

---

## 一、功能测试结果

### 1. AudioContext 解锁遮罩 ✅（r2）

- 进入舞台（voiceAvailable=true 时）出现遮罩：`🔊 点击开启语音，进入剧场`（`.voice-unlock`）
- 点击后遮罩消失；顶栏出现「🔊 语音」按钮
- 解锁旁证：页内 `new AudioContext().state === 'running'`

### 2. 静音持久化 + 修复后新遮罩行为 ✅（r2）

- 点击「🔊 语音」→「🔇 静音」，`localStorage.stage-voice = "0"`；同时 `tts_control {enabled:false}` 发往服务端（关=停合成省配额）
- 刷新后保持静音（按钮 🔇 + localStorage）✓；**静音态进入舞台不再出现解锁遮罩**（修复项：遮罩条件 `voiceAvailable && voiceOn && !unlocked`）✓
- 再点恢复 → 遮罩如期出现（voiceOn 且未解锁）→ 点击解锁 →「🔊 语音」

### 3. 语音开关循环不死锁 ✅（r2 + r3 严判）

- 🔊→🔇 循环 4 次后最终 🔊，localStorage=1；`tts_control` enabled 序列 `1100010101` 完整对称无丢失
- 循环后触发新拍：audio_ready 新帧到达 + mp3 200（r3 拍 1 严判，非重放帧）——重新开启后新台词有语音 ✓

### 4. 续演新拍：audio_ready + mp3 静态服务 ✅（r2 + r3 严判）

- 选择选项 → beat_start ~120ms；audio_ready 帧携带 `{seq, phrase, url}`（seq=say 行 say_start 序号）
- VoiceDirector 解码 fetch 命中 `/plays/demo/media/tts/<hash>.mp3`：HTTP 200 + `content-type: audio/mpeg`（多轮全部请求无一非 200）
- 打字机多行推进、行间无 console 错误

### 5. 文字先行 + 二段式快进 ✅（r2）

- 点击舞台消费新行 → 打字机 140ms 内起打（caret 出现），不等语音合成/解码
- 打字中点击：瞬显全文（10 → 49 chars）；再点：切下一行，无拖尾卡顿
- 快进淡出（100ms ramp + stop）无 console 错误；后续行语音正常起播

### 6. 快进后新节拍语音不死锁（B2 核心回归）✅（r3 严判）

- 语音开启下连点快进 18 次（8s 内消费整拍到停止点）→ 做选择进入新节拍 → **新帧** audio_ready 到达（合成延迟 32.7s）+ mp3 200——节拍边界清场/补发逻辑工作正常，无永久静默

### 7. 素材页音色下拉 + 试听 ✅（r2）

- 角色卡「音色」下拉 17 项：预置二次元音色库（萝莉萌妹/Cute Girl/アニメ声の少女/Rem/元气女仆/Frieren/Furina…）+「未设置（不配音）」
- koharu 当前 voiceId 已配置显示
- 点「试听」→ POST tts-preview → mp3 请求 200 + audio/mpeg（缓存命中 1.6s），无失败弹窗（alert 监听为空）

### 8. 刷新/离开重进恢复 + 管线继续 ✅（r4，真实用户路径 Title→继续）

- 重进舞台：hello + resume 重放，台词行恢复、语音按钮 🔊、遮罩解锁正常
- 再触发一拍：新帧 audio_ready（延迟 34.5s）+ mp3 200——管线跨拍持续工作

### 9. 客户端背压（积压 >10 暂停预取）✅（r5 专项）

- **触发**：全程不点击消费 → 短语持续积压 → **56.9s 时 `tts_control {paused:true}` 发出**（阈值 >10 生效）
- **恢复不死锁**：快进消费释放积压 → 滞回回落（≤3）补发 `paused:false` → 服务端 pump 恢复 → 新拍 audio_ready 1.3s 到达 ✓
- **beat 边界专属补发路径**（clearBackpressure 于 beatStarted）：UI 门控下无法自然隔离验证——panelReady 要求 cues 消费完毕，而任何消费（点击推进/自动模式/快进）都会先行释放积压触发滞回补发。该路径为防御性兜底，行为级未覆盖，如实记录（单测侧 server test/voice.test.ts 已覆盖 paused 门控）

### 10. 全程错误监控 ✅（所有轮次）

- console error / pageerror / unhandledrejection：**全部轮次 0 错误**

---

## 二、环境受限项：自动模式 hold（语音播完才推进）⚠️ 未形成场景，非缺陷

三次尝试（r2 D / r3 H / r4 H）实测合成延迟 80.7s / 28.2s / 39.5s，均 **>> 一拍 beat 时长（~32s）与打字时长（~1s/行）**。hold 的前提是「语音在当前行打完前就绪」（`holdsLine(): ctx.currentTime < chainEnd`），在 fish-audio 免费模型当前时段延迟下，语音几乎总是在 beat 收束后才大批到达（迟到音频按 floorSeq 门槛丢弃，设计如此）——hold 场景无法自然形成。

- 代码路径已确认在位：`usePlayback` 自动推进 `if (opts.hold) return`；`VoiceDirector.holdsLine()` 以 chainEnd 判定
- 反向不变式成立：语音未起播时不存在「播着语音跳行」；快进淡出路径已验证
- **建议**：该项留用户真机验收（`260928-stage-ai-mvp.validation-P3.md` 已含对应验证步骤）；TTS 延迟改善后可回归

## 三、观察项（非缺陷）

1. **vite dev 代理 WS 首连偶发 closed warning**：进入舞台瞬间偶现 `WebSocket is closed before the connection is established`（console.warning 级），客户端 500ms 退避重连成功——P2 已知 dev 环境噪声，生产无此层
2. **fish-audio 延迟波动**：同 key 同模型 1.3s（缓存命中）~ 80.7s（实时合成），波动 >60 倍。免费模型 s2.1-pro-free 高峰期限流/排队明显；sha1 内容寻址缓存对重复台词收益极大
3. **快进不触发背压**：连点 37 次快进期间无 `paused:true`（每次推进释放 pending，不积压）——符合设计（背压只防「不消费的积压」）
4. **迟到音频丢弃量大**：合成延迟 > 拍时长时，收束后到达的音频被 floorSeq 门槛静默丢弃（文字不受影响）——设计如此，但意味着高延迟时段大量合成配额被浪费，可考虑服务端侧按 beat 收束取消在途队列

## 四、体验评估（可观测信号侧）

- **打字与语音配合**：文字先行严格执行（起打 140ms，无等待）；语音就绪后自动跟进起播（mp3 fetch → decode → trySchedule 链路无报错）
- **句间衔接**：多短语行（phrase 0..n）mp3 请求密集连续到达，链式调度（chainEnd + 0.25s 垫 + 短斜坡）无中间报错；爆音/断裂感属听感范畴，机器不可判，留用户验收
- **快进手感**：二段式点击响应即时（瞬显 <250ms、切行 <900ms 含轮询粒度），无拖尾卡顿
- **遮罩体验**：静音玩家不再被迫点解锁遮罩（修复生效），开启语音才引导手势——交互负担合理

## 五、截图与证据索引（/tmp/stage-e2e/）

| 文件 | 内容 |
|---|---|
| r2-A-unlocked.png | 解锁后舞台（顶栏 🔊 语音 + 台词 + 停止点） |
| r2-D-auto.png | 自动模式开启状态 |
| r2-E-assets.png | 素材页角色卡（音色下拉 + 试听按钮） |
| r3-2-auto.png | 自动模式 hold 观察窗 |
| r4-final.png | 刷新恢复后舞台 |
| r2/r3/r4/r5-run.json | 各轮结构化结果（含每项 PASS/FAIL 与证据字段） |

## 六、方法注记

- **WS 帧等待必须带时间下限**：r2 曾以无下限谓词等待 audio_ready，匹配到历史帧造成两项假阳性 PASS（D/F 阶段）——r3 起所有关键等待改为 `f.t >= tSince` 严判新帧，假阳性项全部重验
- **同 hash 路由 goto 不重挂组件**：`goto('#/play/demo/stage?mode=…')` 在已在舞台时只触发 hashchange，useStageSocket 的 `[playId]` effect 不重跑、WS 不重连——「刷新恢复」须走真实路径（回 Title 点继续 / page.reload）
- **headless Chromium 语音测试参数**：`--autoplay-policy=no-user-gesture-required`（CDP 点击虽是 trusted 事件，仍显式放开更稳）+ `--mute-audio`（容器无音频设备）；`decodeAudioData` 在 suspended context 下正常工作，用于页内测量 mp3 时长
- 行-语音配对靠时间轴重建（MutationObserver 行时间线 + mp3 响应时刻 + performance.timeOrigin 换算），未侵入应用代码；VoiceDirector 未挂 window，AudioContext 旁证用独立实例

## 七、清理与环境状态

- 未创建新剧目、未改动 play.json / 角色配置（试听用 koharu 现有音色，未保存任何变更）
- demo 会话自然推进了 7+ 拍（session.json/lineage.jsonl 为运行时数据，不进 git）
- 浏览器进程已全部关闭；证据保留在 /tmp/stage-e2e/（重启丢失，重要结论已录入本报告）
