# stage-ai AGENTS.md

## 目标

AI galgame 引擎：LLM 剧作家（playwriter）流式输出 Stage DSL（XML 标签式）增量剧本，服务端解析为 IR 事件经 WS 下发，前端像流式视频一样边生成边演出。玩家兼具演员（入戏表态）与导演（OOC/编辑/分岔/重写四正交原语）双重身份。路线树 + 书签完全替代存读档。

需求计划与阶段（P0–P7）见 `docs/features/260928-stage-ai-mvp/260928-stage-ai-mvp.plan.md`——动手前必读对应章节。

## 地图

- `packages/core` —— 语言与契约层（P0 已落地）：DSL v1 冻结规范（`src/dsl/spec.ts`）、流式解析器（`src/dsl/parser.ts`）、StageEvent/SequencedEvent IR（`src/dsl/events.ts`）、WS 协议类型（`src/ws/protocol.ts`，hello 带 cast 与 voice 能力位、audio_ready/tts_control 语音消息）、谱系数据模型（`src/lineage/model.ts`：行级事件日志唯一真相源、四原语、快照随分支走、export/load 持久化）、剧目配置契约 PlayConfig/CharacterCard（`src/play/config.ts`：voiceId 为 TTS 音色、voice 为台词风格描述、protagonist 主角卡与 voiceLanguage 语音语言（P4 增量，空白归一化为 undefined），server/web 共享，web 不得 import server 包）、语音分句器（`src/speech/chunker.ts`：PhraseChunker 强终止/次级阈值/700ms 空闲冲刷 + normalizeForTts；`src/speech/voices.ts` 预置音色库，server 校验与 web 下拉共享）
- `apps/server` —— playwriter 编排器 + 剧目之家（P1–P3 已落地，另含 P4 早交付增量）：beat 生命周期与玩家动作路由（`src/orchestrator.ts`，runtimeState 随 session 持久化、重启续演、feedVoice say 三段钩子）、cpa 网关 provider（`src/provider.ts`，克隆内置元数据时钳 maxTokens=STAGE_MAX_TOKENS）、三区装配提示词（`src/prompt.ts`，素材清单注入）、多剧目 WS hub（`src/transport.ts`：`/ws?play=` 路由、resume 重放、早到消息缓冲、tts_control 路由；每次 dispatch 现查 runtime——重建后活连接自动路由不断线）、剧目/会话存储与就绪门（`src/store.ts`，media-cache/tts 目录）、PlayHouse 多剧目 runtime（`src/playhouse.ts`：懒加载恢复/startFresh 清会话/reload 保存即生效（PUT play 与素材增删后重建 runtime，客户端集合与 runtime 生命周期解耦）/ttsPreview 试听走翻译路径/polish 按主角卡润色玩家输入）、REST + 静态服务（`src/http.ts`：素材白名单防穿越 + `/plays/:id/media/tts/*.mp3` + `POST /plays/:id/polish`，play/素材保存触发 reload）、fish-audio 客户端（`src/tts.ts`：undici 代理 + 多 key 轮询 + sha1 内容寻址缓存）、语音预取管线（`src/voice.ts`：分句→并发队列→audio_ready，enabled/paused 门控）、一次性文本补全（`src/llm.ts` completeText：streamSimple 直调收 text_delta，润色/翻译共用）、语音语言翻译（`src/translate.ts` Translator：结果缓存上限 500 + inflight 去重，失败抛错由调用方回退）；测试用 fake StreamFn/synth 注入（`test/orchestrator.test.ts`、`test/voice.test.ts`、`test/translate.test.ts`）
- `apps/web` —— 舞台演出层（P2/P3 已落地）：React 19 + vite；hash 路由（`src/router.tsx`）+ REST 客户端（`src/api.ts`，ttsPreview/polish）；`src/views/`（剧目库/Title 就绪门/舞台双视图/素材管理含音色下拉与试听、剧目配置区主角卡与语音语言）；`src/stage/`（ScriptBuilder 带 cues 轨道与行 seq、usePlayback 打字机+二段式点击+自动模式+语音钩子、StageTheater 舞台视觉层+语音开关+解锁遮罩、StopPanel 停止点操作含自由输入 ✨润色/撤销（P4 增量，润色恒基于原文不叠加）、useStageSocket 含 audio_ready 转发、VoiceDirector 语音导演 `src/stage/audio.ts`：单一共享 AudioContext、gapless 链式调度、快进淡出、背压滞回；P1 文字视图复用为 log）
- `plays/demo` —— 样例剧目《黄昏教室》（koharu 配萝莉萌妹 voiceId，素材取自 `feat/galgame-assets` 分支：8 差分立绘/8 背景/3 BGM/2 CG）；`play.json` + `assets/` 进 git，session.json/lineage.jsonl/media-cache 运行时不进

## 开发与调试

- 启动：`pnpm --filter @stage-ai/server start`（需根目录 `.env`：cpa 网关 STAGE_BASE_URL/STAGE_API_KEY/STAGE_MODEL_ID 等）+ `pnpm --filter @stage-ai/web dev`（:5180，/ws 代理 :8787）
- Node ≥ 22.19（pi-agent-core engines 要求），pnpm workspace
- `pnpm test` —— vitest（core 65 + server 24，测试范围按改动模块控制）
- `pnpm typecheck` / `pnpm build`（改 core 后须 rebuild，web/server 走 workspace symlink 的 dist 类型）
- 解析器改动必须保持撕裂等价性测试（chunk=1/2/3/5/7）与消息边界自动闭合用例全绿——这是 P0 冻结契约的回归线
- 语音本地联调：`.env` 的 STAGE_TTS_*（默认读 `~/.config/fish-audio/keys.json`，走 7890 代理）；无 key 时 hello.voice=false、客户端自动隐藏语音开关

## 规范

- **DSL v1 已冻结**（9 标签白名单 + stop 三类型）：改标签集 = 改计划文档先行，同步更新 spec.ts 与 golden 用例
- **谱系事件日志 append-only**：一切结构操作（分岔/编辑/重写）以追加事件表达，物化时重放；日志永不改写
- **四原语正交**（OOC/编辑/分岔/重写）：不隐式联动，组合权在用户；新增交互先对照计划 D10
- **beat 边界解析归编排器**（P1）：core 的 `recordRewrite` 只记粒度标注，`granularity="beat"` 时 nodeId 传节拍首行
- **文字先行铁律**（P3 语音）：音频未就绪/失败绝不阻塞演出；TTS 失败只告警跳过该句；audio_ready 是瞬态消息不进事件缓冲重放
- **audio_ready 行关联**：seq = 所属 say 行 say_start 事件的序号（客户端 ScriptLine.seq 对应），改协议先对齐 core/ws/protocol.ts
- **pi-ai 流式调用必须接 `provider.streamSimple`**（P4 教训）：`StreamFn` 契约是 `SimpleStreamOptions`（带 `reasoning` 字段），只有 streamSimple 做 reasoning→reasoningEffort 换算，错接完整版 `provider.stream` 会**静默丢弃 reasoning**。且 streamSimple 在调用方不传 maxTokens 时以 `model.maxTokens` 填充发出——捐赠元数据（STAGE_MODEL_BASE）的输出上限与网关路由无关（deepseek-flash 捐 384k 超 glm 网关 [1,131072] → 400 空拍），故 `createCpaProvider` 克隆时钳为 `STAGE_MAX_TOKENS`（默认 32768）；一次性补全（completeText）另显式 `maxTokens: 2048`。glm 网关对「无工具 + thinking:disabled」报 400（该模型始终思考，带工具则容忍）——编排器带工具故安全
- **剧目配置保存即生效**（P4）：PUT play / 素材增删后 `playhouse.reload` 重建 runtime（音色/主角卡/语音语言/素材清单即时生效）；WS 客户端集合挂 PlayHouse 与 runtime 解耦，transport 每次 dispatch 现查 runtime——新增消费 play 配置的闭包时不得缓存旧引用，走 reload 重建路径
- 剧目运行时数据不进 git（`plays/*/session.json`、`plays/*/lineage.jsonl`、`media-cache/`）；`play.json` 剧目定义进 git
