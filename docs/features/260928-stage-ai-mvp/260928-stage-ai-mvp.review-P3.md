# 检视报告

## 概要

本次检视覆盖 P3 语音管线（D5）全部工作树改动：core 侧 PhraseChunker/normalizeForTts/VOICE_PRESETS、server 侧 FishTts 客户端（多 key 轮询 + sha1 内容寻址缓存）与 VoicePipeline 预取管线、WS 协议 audio_ready/tts_control/hello.voice、web 侧 VoiceDirector（共享 AudioContext、gapless 链式调度、快进淡出、背压滞回）及素材页音色下拉试听。

整体设计落地质量高：**文字先行铁律在每一层都有独立兜底**（server 合成失败仅告警跳过、client 解码失败丢弃该句、自动模式 hold 只增加等待从不阻塞文字）；seq 行关联（say_start 事件序号 ↔ ScriptLine.seq）契约清晰且有测试锁定；sha1 缓存使分岔/重演零配额；静态路由白名单与凭据隔离（keys.json 在仓库外、.env 已 ignore）合规。测试 core 62 + server 20 全绿，build/typecheck 通过。

但存在两项阻塞问题：**TTS 非轮换错误被自身 catch 吞掉后仍遍历全部 key**（配额浪费 + 错误语义失真），以及**客户端背压暂停状态在节拍边界/开关切换时重置却不补发恢复消息，服务端 paused 残留导致语音永久静默**。两者均为局部小改，修复后可直接复审。

## 需求对齐（对照计划 §D5）

- **PhraseChunker 提交策略**：✅ 强终止绝对切分（省略号整组、\n 归一为句号）、次级标点累计 30 字（计划 25–35 区间中值）、700ms 空闲冲刷、TTS 前置正则化（百分比/温度/全角化/排版符号/emoji）。16 用例覆盖到位。
- **预取与 audio_ready**：✅ 分句即并发预取（并发 2）；audio_ready 带 URL。偏差：计划要求「URL+时长」，协议声明了 `durationMs?` 但 server 从不填充（客户端以解码结果为准）——字段沦为死协议面，建议补齐或删除。
- **Web Audio Gapless**：✅ 单一共享 AudioContext + 解锁遮罩手势 resume；chainEnd + 250ms 垫链式调度。偏差：计划的「段间线性 crossfade」落地为短 attack/release 斜坡（15ms/40ms）——更简单且等效消爆音，可接受。
- **音色映射**：✅ voiceId 与 voice（风格描述）分离、预置库 server 校验/web 下拉共享、试听走固定样本文案（同音色二次试听命中缓存）。偏差：计划「旁白默认不配音（**可开**）」的"可开"未实现（narrate/thought 恒不配音）——按 MVP 取舍接受，见 N5。
- **跳过策略**：✅ 快进 100ms 淡出 + 后续短语丢弃。偏差：计划「音频文件留在缓存，重听 Backlog 时可用」——文件确实留存，但 log 视图并无重听入口（纯文本），"可用"目前只是潜在能力。
- **背压**：✅ 客户端滞回（>10 暂停 / ≤3 恢复），较计划的固定 N=5 更稳。但状态清理路径有阻塞级缺陷（B2）。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B1 | `apps/server/src/tts.ts:70-84` | **非轮换错误被 catch 吞掉后仍遍历全部 key**：`request()` 中非 401/402/429 状态码走 `throw new Error(...)`（L73），但该 throw 位于自身 `try` 块内，被 L80 的 `catch` 捕获后 `lastError = error` 并继续循环下一把 key。后果：① 持久性 4xx（如失效 reference_id——`isVoiceId` 放行任意 32 位 hex，配错音色必现）每句短语烧 N 把 key 的请求；② 最终错误被包装成「全部 key 失败」，误导排障。注释「非轮换错误已在上面直接抛出」与实际行为不符。 | 用哨兵错误类区分：`class NonRetryableError extends Error {}`，非轮换状态 `throw new NonRetryableError(...)`，catch 中 `if (error instanceof NonRetryableError) throw error;` 后再记 `lastError` 继续。 |
| B2 | `apps/web/src/stage/audio.ts:129-137, 79-88` + `apps/server/src/voice.ts:35-46` | **背压 paused 残留 → 语音永久静默死锁**：客户端 `beatStarted()`（新节拍）与 `setEnabled(false)`（语音关）都会把 `pausedSent` 重置为 false 并清空 pending，**但不补发 `{paused:false}`**；服务端 `paused` 无任何其他清除路径（`setEnabled(true)` 也不触碰）。触发链：快进/未解锁遮罩期积压 >10 → 客户端发 `paused:true` → 玩家到达停止点做出选择（或切换语音开关）→ 客户端 pausedSent 归零 → 新节拍短语入队但 `pump()` 被 `this.paused` 拦死 → 无 audio_ready → 客户端 pending 永远为 0 → 永远不会再发 resume。语音自此静默至 orchestrator 回收，刷新页面/切换开关均无法复活。 | 最小修复：客户端 `beatStarted()`/`setEnabled(false)`/`dispose()` 中，凡 `pausedSent` 为 true 时先 `this.onControl?.({ paused: false })` 再重置。纵深防御：服务端 `setEnabled(true)` 同时 `this.paused = false`（重新开启视为新会话，客户端会按需重新暂停）。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | `apps/web/src/stage/audio.ts:259-268` | **pruneBefore 双重扣减 pending**：已调度短语在 `trySchedule` 中已 `pending -= 1`，`pruneBefore` 再按 `phrases.size`（含已调度）整行扣减，违反「pending = 已存储未调度」不变式。后果是背压计数漂移（提前恢复/延迟暂停）。 | 扣减改为 `old.phrases.size - old.nextToPlay`；或干脆废弃增量维护，`checkBackpressure` 时按 lines 现场重算。 |
| S2 | `apps/web/src/stage/audio.ts:194-210` | **解码失败导致行内链停滞**：`decode` 失败删除该短语后，若其序号恰为 `nextToPlay`，`trySchedule` 在缺口处永久 return，该行后续已解码短语再也不会被调度（整行语音静默中断）。 | 失败路径中若 `index <= line.nextToPlay`，推进 `nextToPlay` 至缺口后并 `trySchedule(line)`。 |
| S3 | `apps/server/src/tts.ts:37-45` | **缓存写入非原子**：相邻行重复短语（如两句「嗯。」）在预取窗口内并发 miss → 两路对同一路径 `writeFile`，fish 同文本两次合成字节不同，交错写可能产出损坏 mp3（客户端解码失败，正是 S2 的触发源），且双烧配额。 | 写临时文件后 `rename` 落位；可选：FishTts 内按 hash 去重 in-flight 请求。 |
| S4 | `packages/core/src/speech/chunker.ts:94, 154-161` | **死代码与逻辑重复**：`closed` 标志从未置 true（无 close 方法，push 中的检查恒假）；idle 冲刷内联复制了 `emit()` 的 trim/字母检查/正则化全链。 | 删除 `closed`；idle 回调直接调 `this.emit()`（emit 内部已 disarmIdle，timer 触发后置 null 亦无碍）。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `packages/core/src/speech/chunker.ts:109-127` | **跨 delta 边界的省略号边角**：「……」跨两次 push 到达会拆成两次 emit（第二次纯标点被丢弃，无害）；ASCII `...` 跨 push 到达则永不触发省略号终止，随缓冲并入下一强终止点。另 `speechLength` 把全角标点计入阈值（30 字含标点，实际内容略少于计划口径）。 | 均为韵律层面的轻微偏差，可不修；若追求精确可在缓冲尾部暂留不成组的 `…`/`.` 待下一 delta 拼接判定的复杂度并不值得。 |
| N2 | `apps/server/src/tts.ts:78` | **key 轮询实为粘性**：成功后 `keyCursor = index` 使下一请求仍从该 key 起步，单 key 先耗尽配额才轮换。 | 免费额度场景按请求真轮询（成功后 `keyCursor = index + 1`）分摊更均匀；现状也可接受。 |
| N3 | `apps/server/src/config.ts:38` | **STAGE_TTS_CONCURRENCY 无校验**：环境变量非数字时 `Number()` 产出 NaN（`while (inFlight < NaN)` 恒假）或空串产出 0——语音静默失效且无告警。 | 解析失败回退默认 2 并 warn。默认代理硬编码本机 7890 已在 AGENTS.md 说明，可接受。 |
| N4 | `packages/core/src/ws/protocol.ts:29` | **`durationMs` 死字段**：协议声明可选时长但服务端从不填充（见需求对齐）。 | 删除该字段，或在未来服务端解析 mp3 时长时再引入，避免协议面虚胖。 |
| N5 | `apps/web/src/stage/StageTheater.tsx:177-183` | **静音用户仍见解锁遮罩**：`voiceAvailable && !unlocked` 不看 voiceOn，localStorage 关闭语音的玩家每次进舞台仍要多点一次"开启语音"遮罩；且遮罩不阻断其下自动模式的打字推进，语义略拧巴。 | `voiceOn` 为 false 时不渲染遮罩（语音开启时再要求手势）。另：计划「旁白可开」与「Backlog 重听缓存音频」为未实现的潜在能力，建议在计划文档标注 MVP 取舍。 |
| N6 | `apps/web/src/views/StageScreen.tsx:26-27` | **渲染期赋值引用了尚未声明的 `stage`**：`director.onControl = (state) => stage.sendTtsControl(state)` 位于 `const stage = useStageSocket(...)` 之前，靠闭包延迟执行侥幸绕过 TDZ；若未来有人在渲染同步路径触发 onControl 即 ReferenceError。 | 把 `onControl`/`onNotify` 的绑定移到 `useStageSocket` 之后（或收进 useEffect）。 |

## 准入结论

**结论**：`不准入（修复 B1/B2 后可直接复审）`

**说明**：架构与铁律落地优秀、测试与静态验证全绿，但 B1（错误分类失真烧配额）与 B2（背压残留死锁令语音永久静默）为真实可复现的功能缺陷，须修复后复审；S1–S4 建议随手修复（均为十行内局部改动），N 项可留待后续。用户实机验证文档（validation-P3.md）已就绪，宜在 B/S 修复后再执行。

---

# 复审记录（round 2，2026-09-28）

修复清单逐项核验（代码级追踪 + 全量静态/测试验证），结论：**准入**。

## 修复核验

| 项 | 核验结果 |
| --- | --- |
| B1 | ✅ `NonRetryableTtsError` 哨兵 + catch 中 `instanceof` rethrow（tts.ts:93, 103）。非轮换 4xx/5xx 不再遍历 key；错误信息不再被「全部 key 失败」包装误导。 |
| B2 | ✅ 双侧到位。客户端 `clearBackpressure()` 统一出口（audio.ts:268-272），`beatStarted()`/`setEnabled(false)`/`dispose()` 三处清理前补发 `{paused:false}`；服务端 `setEnabled(true)` 顺带 `paused=false + pump()`（voice.ts:40-44）作纵深。卸载时 socket 已关导致 resume 丢失的残余窗口，由「任一客户端连接即发送 tts_control enabled」的同步效应兜底复活（voiceOn=true → paused=false；voiceOn=false → 后续开启时复活），全路径可达恢复。 |
| S1 | ✅ `pending` 改派生 getter（audio.ts:64-70，Σ 存活行 `phrases.size - nextToPlay`），五处手动记账全数删除，faded 行自动除账，双重扣减漂移根除。 |
| S2 | ✅ 解码失败改 1 样本静音墓碑（audio.ts:207），链式调度无缺口停滞，`decode` 签名同步收敛为 `(line, phrase)`，unlock 补解码路径一致。墓碑 21µs@0.0001 增益，听感无声，垫片照常衔接。 |
| S3 | ✅ tmp+rename 原子写 + `inflight` Map 按 hash 去重（tts.ts:32, 46-63）。并发重复短语只合成一次；失败时 Promise 拒绝正确传播给所有等待方。`.tmp` 残留不被静态路由白名单（`^[\w-]+\.mp3$`）serve。 |
| S4 | ✅ `closed` 死标志删除；idle 回调直调 `this.emit()`（内部 disarmIdle 对已触发 timer 为 no-op），行为等价由 core 62 用例锁定。 |
| N2 | ✅ `keyCursor = (index + 1) % keys.length` 真轮询分摊额度。 |
| N3 | ✅ `parsePositiveInt` 守卫（NaN/0/负数/垃圾值回退 2 并 warn；未设置时静默）。 |
| N4 | ✅ `audio_ready.durationMs` 死字段删除，协议面收敛。 |
| N5 | ✅ 遮罩条件 `voiceAvailable && voiceOn && !unlocked`——静音用户不再被迫多点一次；会话中开启语音时遮罩照常出现补手势。 |
| N6 | ✅ `onNotify`/`onControl` 绑定移至 `useStageSocket` 声明之后，TDZ 隐患消除。 |
| N1 | 按初审结论不修（韵律层轻微边角），接受。 |

## 验证

- `pnpm build` / `pnpm typecheck`：全绿（core/server/web）。
- `pnpm test`：core 62 + server 20 全部通过。
- 服务端已用新代码重启且 tts-preview 冒烟（缓存命中）通过（实施方报告）。

## 复审新增观察（非阻塞，留档）

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| R-N1 | `apps/server/src/tts.ts:46-58` | **inflight 去重键未含目录**：FishTts 实例为全 PlayHouse 共享，`inflight` 仅按 hash 文件名索引——两个剧目并发请求相同 (voiceId, text) 时，B 剧目会等待 A 剧目的写入完成后直接返回，但文件落在 A 的 media-cache，B 侧 `existsSync` 为假却不再合成 → audio_ready 指向 404 → 客户端墓碑静音（优雅降级，不阻塞演出）。单用户本地多剧目同句并发概率极低。 | 去重键改为绝对路径（`${target}`），一行修复；顺手可在 synthesize 失败路径清理 `.tmp` 残留。 |
| R-N2 | 协议层（D5 后续迭代） | **服务端跳短语致行内链停滞**：服务端某短语合成失败只告警不下发（铁律正确），但客户端按序链式调度会停在该缺口号，该行后续已就绪短语也不再播放（行推进时 fadeLine 兜底恢复）。铁律「跳过该句」的实际粒度是「该句起至行尾」。 | 未来需要时给协议加 `tts_failed {seq, phrase}` 通知或 say_end 携带短语总数，客户端据此即时/行末补墓碑；当前频率与影响可接受。 |

## 最终结论

**结论**：`准入`

**说明**：两项阻塞问题（B1/B2）修复到位且经代码级追踪与全量测试验证；S1–S4、N2–N6 全部落实，质量高于预期（pending 派生化与墓碑方案优于初审建议的最小修法）。R-N1/R-N2 为留档观察项，不阻塞。剩余流程：按 validation-P3.md 完成用户实机验证（含背压触发场景建议：遮罩出现后暂缓点击、让积压超过 10 句再进入，验证语音在下一节拍正常复活——这正是 B2 的修复回归线）。
