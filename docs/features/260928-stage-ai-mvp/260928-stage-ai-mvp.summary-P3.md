# stage-ai MVP 实施摘要（P3：语音管线）

> 状态：P3 完成（core 62/62 + server 20/20 单测、全仓 build/typecheck 零错误、WS 探针真模型 audio_ready 流验证、reviewer 复审**准入**、e2e 修复后代码 4 轮全过**零产品缺陷**零 console 错误）。用户实机验证待做（validation-P3.md）。

## 背景

P2 演出层之上补「有声音」：say 台词流式分句 → fish-audio 预取合成 → audio_ready 下发 → Web Audio gapless 链式播放。铁律：**文字先行**——音频未就绪/失败绝不阻塞演出；TTS 失败只告警跳过该句。

## 交付内容

| 模块 | 内容 |
| --- | --- |
| `packages/core` | `src/speech/chunker.ts` PhraseChunker：强终止（。！？…\n，省略号整组）绝对切分、次级标点累计 30 字切分、700ms 空闲冲刷（慢流尽早预取）、flush 兜底、normalizeForTts（百分比/温度/全角化/排版符号/emoji 剔除）、纯标点短语丢弃；`src/speech/voices.ts` VOICE_PRESETS 16 音色 + isVoiceId 校验；协议新增 audio_ready（seq=所属 say 行 say_start 序号，行关联键）/tts_control（enabled/paused）/hello.voice 能力位；CharacterCard 增 voiceId（TTS 音色）与 voice（台词风格描述）分离 |
| `apps/server` | `src/tts.ts` FishTts：undici ProxyAgent 走 7890、多 key 真轮询（成功后 cursor 前移）、401/402/429 才轮换重试（NonRetryableTtsError 哨兵防烧配额）、sha1(voiceId\0text) 内容寻址缓存（tmp+rename 原子写 + inflight 去重，分岔/重演零配额）；`src/voice.ts` VoicePipeline：lineStart/feedText/lineEnd 三段钩子、并发 2 预取、enabled/paused 门控、setEnabled(true) 清背压残留；orchestrator feedVoice 钩子注入；playhouse ttsPreview 试听（固定样本）；config STAGE_TTS_* 五项；http 静态 /plays/:id/media/tts/*.mp3 白名单 + POST tts-preview |
| `apps/web` | `src/stage/audio.ts` VoiceDirector：页面级共享 AudioContext（StrictMode 安全）+ 手势解锁遮罩补解码、句级 gapless 链式调度（chainEnd + 250ms 垫 + attack/release 斜坡消爆音）、文字先行（未就绪静默上字，解码完成跟进起播）、快进 100ms 淡出、旧拍迟到音频 floor 门槛丢弃、背压滞回（>10 暂停 / ≤3 恢复，pending 为派生值根除记账漂移）、解码失败静音墓碑防链停滞、清理路径补发 paused:false 防死锁；ScriptLine.seq 行关联；usePlayback 语音钩子（onLineStart/onFastForward/hold 自动模式语音收尾）；StageTheater 🔊/🔇 开关 + 解锁遮罩（仅语音开启时显示）；AssetsView 音色下拉 + 试听 |
| `plays/demo` | koharu 配 voiceId（萝莉萌妹中文声线） |

## 机器侧验证

- 单测：core 62（chunker 17：切分/省略号/空闲冲刷/正则化/纯标点）+ server 20（voice 6：门控/顺序/背压/并发）全绿
- WS 探针（真模型 glm-5.3-flash）：beat 内收 9 条 audio_ready，按行分组（seq 对应 say_start）、短语乱序到达不乱调度；mp3 静态服务 200 audio/mpeg（128kbps 44.1kHz）
- tts-preview：首次合成 4.4s、缓存命中 23ms
- 无 key 时 hello.voice=false、客户端自动隐藏语音开关（能力位门控）

## Review（review-P3.md）与修复

reviewer 首轮结论不准入，B/S 项已全部修复：

- **B1 非轮换错误烧配额**：request() 内 400/404/500 等 throw 被自身 catch 吞掉后仍遍历全部 key → NonRetryableTtsError 哨兵类，catch 中 instanceof 直接 rethrow
- **B2 背压残留死锁（语音永久静默）**：客户端 beatStarted()/setEnabled(false)/dispose() 重置 pausedSent 不补发恢复 + 服务端 paused 无清除路径 → 客户端 clearBackpressure() 统一出口（重置前补发 {paused:false}）；服务端 setEnabled(true) 顺带 paused=false + pump()（纵深防御）
- **S1 pending 双重扣减**：pruneBefore/fadeLine 对已调度短语重复扣减 → pending 改派生 getter（Σ 存活行 phrases.size − nextToPlay），五处手动记账全删
- **S2 解码失败链停滞**：失败短语删除后若恰为 nextToPlay 则整行静默中断 → 静音墓碑（1 样本 buffer 顶替，链不因缺口停滞）
- **S3 缓存并发写非原子**：tmp+rename 落位 + inflight Map 同 hash 去重（防交错写坏 mp3 + 双烧配额）
- **S4 chunker 死代码**：closed 标志删除；idle 冲刷回调直调 emit()（内联复制的 trim/字母检查/正则化全链消除）
- **N2 key 粘性轮询**：keyCursor=(index+1)%len 按请求真轮询
- **N3 concurrency NaN**：parsePositiveInt 守卫，非法值回退 2 并 warn
- **N4 durationMs 死字段**：协议删除（服务端从不填充，客户端以解码结果为准）
- **N5 静音用户见解锁遮罩**：遮罩条件加 voiceOn
- **N6 渲染期 TDZ**：StageScreen onNotify/onControl 绑定移到 useStageSocket 声明后
- N1（跨 delta 省略号边角）按 reviewer 结论不修——韵律层轻微偏差，修复复杂度不值

复审新增两项留档（review-P3.md 复审章节）：

- **R-N1 inflight 去重键未含目录** ✅ 已修：键改绝对路径——PlayHouse 共享 FishTts 实例下，两剧目并发同句 (voiceId,text) 时 B 侧不再拿到 404 URL
- **R-N2 服务端跳短语致行内链停滞** 留后续：合成失败无通知，客户端按序链停在缺口号至行尾（文字不受影响，行推进兜底恢复）。后续可加 tts_failed {seq,phrase} 或 say_end 带短语总数补墓碑

## 计划偏差（MVP 取舍）

- 「段间线性 crossfade」落地为 attack/release 短斜坡（15ms/40ms）——更简单且等效消爆音
- 「旁白可开（默认不配音）」的"可开"未实现：narrate/thought 恒不配音
- 「Backlog 重听缓存音频」：文件确实留存于 media-cache/tts，但 log 视图无重听入口（纯文本）
- audio_ready 的 durationMs 未实现服务端填充，字段已删除（客户端解码自带时长）

## E2E 验证（e2e-tester 浏览器自动化 + 真实 LLM/TTS，修复后代码）

4 轮有效测试（r2 全量 / r3 严判回归 / r4 刷新恢复 / r5 背压专项）全部通过，零产品缺陷，console/pageerror/unhandledrejection 全程零错误。报告：`260928-stage-ai-mvp.e2e-P3.md`。

- **B2 核心回归**：🔊→🔇×4 开关循环后新拍新帧 audio_ready + mp3 200；语音开启连点快进 18 次过停止点进新节拍，语音照常
- **N5 修复验证**：静音态进入舞台无解锁遮罩；再开语音遮罩如期出现
- **背压闭环**（r5 专项）：不消费积压 56.9s 触发 paused:true → 快进消费 → 滞回补发 paused:false → 服务端恢复 → 新拍 1.3s 出语音
- 文字先行 140ms 起打不等合成；音色下拉 17 项 + 试听 mp3 200；刷新恢复走真实 Title→继续 路径
- **环境受限项**：自动模式 hold 无法自然形成——fish-audio 免费模型实时合成延迟 28~80s 远大于 beat 时长（~32s），hold 场景（语音就绪早于行打完）构造不出；代码路径在位、反向不变式（不播不跳行）成立，留用户真机验收
- 观察项（非缺陷）：高延迟时段迟到音频大量丢弃 = 合成配额浪费，后续可考虑服务端按 beat 收束取消在途队列（进 P6 打磨池）

## 环境备忘

- STAGE_TTS_* 默认值：keys 读 `~/.config/fish-audio/keys.json`（3 把）、代理 7890、并发 2、api.fish.audio；详见 README.md 配置表
- LLM 网关现状同 P2：glm-5.3-flash 在用（V4.1-Flash 余额不足）

## 下一步（P4）

记忆与工坊（计划 §P4）：三层记忆全量（index/archive/纪元压缩）+ 工坊抽屉（meta-chat 共创 + 文件浏览编辑）+ 主界面常驻原地 OOC；验收线：30+ 轮会话稳态零重装配、空剧目工坊共创至就绪开演。
