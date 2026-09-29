# Playwriter（剧作家）配置面穷尽调研

> 只读调研。行号对应调研时 HEAD（apps/server、packages/core 源码，非 dist）。
> 结论一句话：**剧作家的「模型级」旋钮已经全部 env 化并被设置面板覆盖；但「行为级」旋钮（一拍写几行、提前几拍发图、好感度步长、选项条数、归档切片长度、压缩摘要截断……）几乎全部是硬编码常量或写死在提示词模板里，一个都没有配置面。**

## A. 服务端全局配置（`apps/server/src/config.ts`）

`loadConfig()` 一次性从 env 装配 `ServerConfig`（config.ts:67-107），共 20 个键。解析器：`parsePositiveInt`（config.ts:44）、`parseRatio`（config.ts:56），非法值回退默认并 warn。

### A1. 服务端/运维级（不影响剧本内容）

| 字段 | env 键 | 默认值 | 行 | 影响 |
|---|---|---|---|---|
| `port` | `STAGE_PORT` | `8787` | 72 | HTTP/WS 监听 |
| `playsRoot` | `STAGE_PLAYS_ROOT` | `resolve(repoRoot, "plays")` | 73 | 剧目库根目录 |
| `modelBase` | `STAGE_MODEL_BASE` | `deepseek/deepseek-flash` | 75 | pi-ai 元数据基座（决定 contextWindow/cost 估算） |
| `baseUrl` | `STAGE_BASE_URL` | `http://127.0.0.1:9999/v1` | 76 | cpa 网关端点 |
| `apiKey` | `STAGE_API_KEY` | `sk-1234` | 77 | 网关鉴权（provider.ts:36 走 `envApiKeyAuth`） |

### A2. 直接影响剧作家产出

| 字段 | env 键 | 默认值 | 行 | 影响 playwriter 的哪一段 |
|---|---|---|---|---|
| `modelId` | `STAGE_MODEL_ID` | `ms/deepseek-ai/DeepSeek-V4.1-Flash` | 74 | 注入 `model.id`（provider.ts:23），决定网关路由到哪个模型 |
| `maxTokens` | `STAGE_MAX_TOKENS` | `32768` | 78 | 钳住 `model.maxTokens`（provider.ts:29）；单拍最大输出长度 |
| `contextWindow` | `STAGE_CONTEXT_WINDOW` | `131072` | 79 | 纪元压缩预算基数（orchestrator.ts:878） |
| `compactRatio` | `STAGE_COMPACT_RATIO` | `0.6` | 80 | 压缩触发阈值占窗口比例（orchestrator.ts:878-881） |
| `keepRecentTokens` | `STAGE_KEEP_RECENT_TOKENS` | `20000` | 81-85 | 切尾点保留预算（orchestrator.ts:882 → compaction.ts:68） |
| `image.enabled` | `STAGE_IMAGE_ENABLED` | `true`（`!== "false"`） | 87 | 关闭则 `createImageGen` 返回 null（imagegen.ts:136） |
| `image.model` | `STAGE_IMAGE_MODEL` | `gpt-image-2` | 88 | 含 `gemini` 走 SSE 流式，否则走 images/generations（imagegen.ts:36-38） |
| `image.size` | `STAGE_IMAGE_SIZE` | `1536x1024` | 89 | 出图尺寸（seedream 需 ≥3686400 像素） |
| `image.concurrency` | `STAGE_IMAGE_CONCURRENCY` | `2` | 90-94 | `ImageAssets` 闸门槽位（playhouse.ts:337） |
| `image.timeoutMs` | `STAGE_IMAGE_TIMEOUT_MS` | `150000` | 95 | `AbortSignal.timeout`（imagegen.ts:56,94） |
| `tts.enabled` | `STAGE_TTS_ENABLED` | `true` | 98 | 无 key 时 TTS 整体停用（tts.ts:113-125） |
| `tts.keysPath` | `STAGE_TTS_KEYS` | `~/.config/fish-audio/keys.json` | 99-102 | fish-audio key 文件 |
| `tts.proxy` | `STAGE_TTS_PROXY` | `http://127.0.0.1:7890` | 103 | undici 代理 |
| `tts.baseUrl` | `STAGE_TTS_BASE_URL` | `https://api.fish.audio` | 104 | 语音服务地址 |
| `tts.concurrency` | `STAGE_TTS_CONCURRENCY` | `2` | 105 | `VoicePipeline` 并发（orchestrator.ts:336 / voice.ts:94） |

**发现的配置陷阱**：config.ts:109-115 有交叉校验（`keepRecentTokens ≥ contextWindow × compactRatio` 时 warn 压缩静默失效），但这只是启动时一次告警，面板改完要重启才重跑。

**死键**：根 `.env` 里有 `STAGE_PLAY_DIR`，而 config.ts:73 读的是 `STAGE_PLAYS_ROOT`——该键从未被任何代码读取（已全仓 grep 确认）。

## B. 剧目级配置（`packages/core/src/play/config.ts`）

`PlayConfig`（config.ts:22-35）/ `CharacterCard`（config.ts:4-14），跨端契约，工坊可改。

| 字段 | 定义行 | 编排器/提示词读它？ | 其他消费者 |
|---|---|---|---|
| `id` | 23 | 间接（`cast`、URL 路由） | playhouse/store/http |
| `title` | 24 | ❌（工坊 system prompt 用，workshop.ts:151） | 剧目库 UI |
| `premise` | 25 | ✅ A 区「剧目设定」（prompt.ts:76,91）；为空时回退 `memory.premise` | 就绪门（store.readiness） |
| `characters[]` | 26 | ✅ A 区「角色表」（prompt.ts:42-55）；`id` 用于 `update_state` 校验与 `VoicePipeline.voiceOf` | cast、素材管理页 |
| `characters[].persona` | 7 | ✅ 角色卡正文（prompt.ts:49） | 前端立绘/音色 |
| `characters[].voice` | 9 | ✅ 渲染成「音色：…」行（prompt.ts:49）——**注意：这是台词风格描述，不是音色 id** | — |
| `characters[].voiceId` | 11 | ✅ TTS 音色（orchestrator.ts:334） | 音色下拉/试听 |
| `characters[].sprites` | 13 | ✅ A 区列差分名（prompt.ts:45-48） | 前端立绘解析 |
| `protagonist` | 28 | ❌ | 玩家输入润色 system prompt（playhouse.ts:277-279） |
| `voiceLanguage` | 30 | ❌ | `Translator` 台词翻译（playhouse.ts:307-316） |
| `opening` | 32 | ✅ 开场 user 消息（orchestrator.ts:502,548） | 重建历史（orchestrator.ts:719） |
| `initialState` | 33 | ✅ 引擎真值初值（orchestrator.ts:663） | 谱系快照 |
| `initialScene` | 34 | ✅ `currentScene` 初值（orchestrator.ts:664） | — |

**prompt.ts A 区实际注入的字段全集**（`buildSystemPrompt`，prompt.ts:34-157）：`play.premise`（经 `memory.premise` 覆盖，76）→ `characters[].{id,name,persona,voice,sprites}`（42-55）→ `assets` 四类清单 `backgrounds/bgm/sfx/cg` + 已生成图清单（57-74）→ `memory.craft`（77-79）→ `memory.visibleContext(arcIds)` 即 locations/lore/arcs 卡的 `[层] 标题：摘要`（80-84）。
**注意**：`PlayConfig` 没有任何「风格/节奏/每拍行数」类字段——这类创作参数目前只能塞进 `memory/always/craft.md`（间接、纪元内冻结），这是目前唯一的软性调参口。

## C. 编排器里的硬编码行为旋钮（无任何配置面）

### C1. 提示词三区（`apps/server/src/prompt.ts`）

| 区 | 位置 | 内容 | 可否外置为文件 |
|---|---|---|---|
| A 区（system prompt） | prompt.ts:86-156（模板起点 86 `# 剧目设定`，97 DSL 格式，145「演出准则」10 条） | 设定/角色/素材/craft/index/DSL 规范/演出准则 | ❌ 全是模板字符串字面量 |
| B 区（每轮 user 消息） | orchestrator.ts:807-819 `renderUserTurn` + 822-833 `renderDirectorNote` + 775-792 `renderRewriteTurn` | 【状态】【玩家表态】【导演注】【重写】 | ❌ 同上 |
| C 区（状态块） | prompt.ts:160-179 `renderStateSection` | 场景/好感度/旗标/进度/场景细节/活跃剧情线 | ❌ 同上 |

外置化最小改造点：prompt.ts:86 起的模板字面量 + orchestrator.ts:809/824 的区标题串，统一走 `plays/<id>/memory/always/*.md` 或独立 `prompts/*.md`（注意 A 区改动必须走 `buildAgent` 重建，orchestrator.ts:354-396）。

### C2. DSL 工具集（全部定义在 `orchestrator.ts`，**不在 prompt.ts**）

| 工具 | 名称/描述定义行 | 参数上限 | 说明 |
|---|---|---|---|
| `beat_done` | 42-55（`label` 44、`description` 46-47） | `Type.Object({})` 40 | 唯一 `terminate: true`（52）；`agent.finishTurn` 兜底（387-392） |
| `update_state` | 109-113 | `affinity` 记录 / `flags` 记录 76-84 | **校验常量：`AFFINITY_DELTA_CAP = 5`（58）、`AFFINITY_MAX = 100`（59）** |
| `write_memory` | 149-153 | `content` **maxLength 2000**（89） | 只允许 `scene` / `threads`（88） |
| `read_memory_detail` | 162-166 | `name` 无上限 | — |
| `search_archive` | 181-185 | `query` maxLength **200**（101）、`limit` **默认 5、钳 [1,10]**（192） | — |

工具集装配点：orchestrator.ts:371-381（`tools: [createBeatDoneTool(), ...createMemoryTools(...)]`）。提示词里只有工具**名**引用（prompt.ts:83 的 `read_memory_detail`、139 的 `beat_done`），描述文本在 orchestrator。

### C3. 拍相关（每拍约束、护栏、收束）

| 值 | 位置 | 语义 |
|---|---|---|
| `3~8 行台词` | prompt.ts:149 | 每拍台词行数建议（**只在提示词里，无代码校验**） |
| `3–5 句` 提前发射 / 3–5 句后再引用 | prompt.ts:116 / 113 | 生图预发射提前量 |
| `15–30 秒` 出图时延 | prompt.ts:109,116 | 与 `image.timeoutMs` 150000 呼应 |
| 空 choice → 降级 free | orchestrator.ts:983-988 | 护栏；placeholder 文案写死 |
| 空拍 → error + `pause` 停止点 | orchestrator.ts:991-997 | 护栏 |
| 拍收束条件 | orchestrator.ts:964-973 | `turn_end` 且 `beatClosed` 才 `finishBeat`；`agent_end` 兜底 |
| 导演注越停止点追加「未作回应」 | orchestrator.ts:829-831 | 静默态判定（`stopType !== "pause"`） |
| choice 选项条数 | **无上限** | parser（parser.ts:344-359）与编排器都不限量，提示词只给 2 个示例（prompt.ts:132-133） |

### C4. 记忆 / 压缩

| 值 | 位置 | 语义 |
|---|---|---|
| `TRANSCRIPT_CHARS_PER_MESSAGE = 2000` | compaction.ts:13 | 单条消息进摘要的截断上限 |
| `TRANSCRIPT_CHARS_TOTAL = 120_000` | compaction.ts:15 | 摘要输入总量上限（超限从尾部截） |
| `scale > 10` 退回 1 | compaction.ts:58 | 标定系数异常护栏 |
| 一句话摘要「不超过 60 字」 | compaction.ts:23 | 写进 `EPOCH_SUMMARY_SYSTEM` |
| `GENERIC_TITLES` 8 项 | compaction.ts:106-115 | 摘要首行误判过滤 |
| archive 切片 800 字 / 每行 200 字 | orchestrator.ts:1032 / 1132 | 逐拍归档摘要长度 |
| `searchArchive` 默认 limit 5 | memory.ts:101 | 检索默认返回条数 |
| index 三层 `locations/lore/arcs` | memory.ts:185 | 目录层名硬编码 |
| 切尾点必须落 `user` 消息 | compaction.ts:79 | 结构性约束 |

### C5. 生图

| 值 | 位置 | 语义 |
|---|---|---|
| `MAX_QUEUE = 12` | imageAssets.ts:31 | 排队上限，超了直接失败降级 |
| `n: 1` | imagegen.ts:47 | 每次只出一张 |
| gemini 流式 `max_tokens: 300` | imagegen.ts:70 | **与 `config.maxTokens` 无关的独立硬编码** |
| 协议分派：名字含 `gemini` → SSE | imagegen.ts:36-38 | 模型名匹配，不是显式枚举 |
| 失败不重试、不跨模型回退 | imagegen.ts（无 catch）+ playhouse.ts:162-167 | 由调用方降级 |
| `type="sprite"` 不生图 | orchestrator.ts:1170-1178 | 只记谱系 |

### C6. 语音

| 值 | 位置 | 语义 |
|---|---|---|
| `maxChars = 30` | core chunker.ts:96 | 次级标点切分阈值（汉字数） |
| `idleFlushMs = 700` | core chunker.ts:97 | 空闲冲刷 |
| `VoicePipeline` 并发兜底 `?? 2` | voice.ts:94 | 正常路径由 `config.tts.concurrency` 传（playhouse.ts:352） |
| fish-audio `model: "s2.1-pro-free"` | tts.ts:130 | **TTS 模型名硬编码，无 env** |
| fish-audio `timeoutMs: 20_000` | tts.ts:131 | **TTS 超时硬编码，无 env** |
| `CACHE_LIMIT = 500` | translate.ts:6 | 台词翻译缓存 |
| `MAX_TOKENS = 2048` | llm.ts:13 | 润色/翻译/纪元摘要的单发上限（与 `config.maxTokens` 无关） |
| `reasoning: "low"` | llm.ts:39 | 旁路补全的思考档 |
| 润色输入 ≤2000 字 | http.ts:312 | REST 层校验 |
| `TTS_SAMPLE_TEXT` | playhouse.ts:263 引用 | 试听固定样本 |
| 工坊 `TURN_TIMEOUT_MS = 180_000` | workshop.ts:185 | 工坊单轮超时 |
| 工坊 `write_file` content maxLength `200_000` / path `300` | workshop.ts:29-31 | |
| 线程标题截 20 字 | workshop.ts:301-302 | |
| parser `MAX_WARNINGS = 200` / `WARN_DETAIL_LIMIT = 120` | core parser.ts:38-39 | 诊断量 |

## D. 工坊能改什么 vs 不能

**可写白名单**（`playFiles.ts:41-45` `isEditable`，`pathOf` 71-79 强制）：

| 路径 | 规则 | 备注 |
|---|---|---|
| `play.json` | 精确匹配（42） | 写前过 `parsePlayConfig`（workshop.ts:83-89）；**不可删除**（playFiles.ts:130） |
| `theme.css` | 精确匹配（42） | |
| `assets/manifest.json` | 常量 `ASSET_MANIFEST`（18、42） | `assets/` 下唯一可写文本 |
| `memory/**/*.md\|.json\|.txt` | `EDITABLE_EXT`（14）+ 前缀 `memory/`（43-44） | |

**只读可见**：`assets/**`（`READONLY_PREFIXES`，16、49）——素材图可见不可改。
**不可见**：`session.json` / `lineage.jsonl` / `saves/**` / `media-cache/**` / `workshop/**` / `theme.css` 之外的根层文件（`DIR_ROOTS` 只放行 `memory`、`assets` 下钻，20、53-55）。
**路径校验**：`normalizePath`（32-38）禁绝对路径、`..`、空段、反斜杠。

**工坊五工具**（`workshop.ts:47-138`）：`list_files`(48-59) / `read_file`(61-73) / `write_file`(75-104) / `delete_file`(106-127) / `get_readiness`(129-135)。system prompt 由 `buildWorkshopPrompt(title, files, readiness)`（150-182）现场构造：固定文案在 151-175（职责边界/对话风格/剧目写作要点），动态部分只有文件清单（179）与就绪门（181，经 `renderReadiness` 140-147）。
**工坊改不了的东西**：任何剧目级「行为参数」——因为 `PlayConfig` 里就没有这类字段（见 B 节结论）。

## E. 已有设置面板

后端 `configApi.ts`：`SettingsView`（12-28）覆盖 config.ts 的**全部 20 个 env 键**，`read()` 42-86（磁盘 `.env` 优先）、`write()` 89-148（掩码回传=不改）。前端 `SettingsScreen.tsx` 分三组：模型网关（102-172）、出图（174-210）、语音（212-263）。

- **没有暴露的 env 键：无。** 所有 `STAGE_*` 都在面板里。
- **暴露了但写不回的**：`port` 与 `playsRoot` 在 `read()` 里返回（configApi.ts:57-58），但 `write()` **没有对应分支**（89-148），前端也只在底部以纯文本回显（SettingsScreen.tsx:272「剧目库：…　服务端口：…」）——即**只读展示、不可改**。
- 面板改的是 `.env`，**需重启生效**（SettingsScreen.tsx:85 显式说明），不热改。
- TTS keys 走独立接口 `GET/PUT /api/settings/tts-keys`（http.ts:150-162），返回掩码 `sk-xxx••••`。

## F. 结论：当前无任何界面可调、但理论上应该能调的 playwriter 旋钮

| 旋钮 | 现值与位置 | 谁在读它 | 改成配置面需动哪些文件 |
|---|---|---|---|
| 每拍台词行数 | `3~8` prompt.ts:149 | 剧作家（提示词） | prompt.ts（或外置 `prompts/beat.md`）；若要服务端校验还需 core parser |
| 生图提前发射句数 | `3–5 句` prompt.ts:113,116 | 剧作家 | 同上 |
| 生图尺寸语义/风格后缀 | `"anime visual novel background, no text"` prompt.ts:112,118 | 剧作家 | prompt.ts；或做成 `ServerConfig.image.styleSuffix` |
| choice 选项条数区间 | **无**（parser.ts:344-359、orchestrator.ts:983 只判空） | 剧作家 / 前端 StopPanel | prompt.ts 加约束；可选 core parser 加 `maxOptions` 裁剪 |
| 好感度步长与上限 | `5` / `100` orchestrator.ts:58-59 | `update_state` 工具 | orchestrator.ts + PlayConfig（`CharacterCard` 或 PlayConfig 新字段） |
| `write_memory` 单文件长度 | `2000` orchestrator.ts:89 | 写状态文件的剧作家 | orchestrator.ts:89（从 PlayConfig 读） |
| `search_archive` limit | `5`/`[1,10]` orchestrator.ts:192、memory.ts:101 | 检索工具 | orchestrator.ts + memory.ts |
| archive 切片长度 | `800` / 每行 `200` orchestrator.ts:1032,1132 | 记忆检索质量 | orchestrator.ts |
| 纪元摘要截断 | `2000`/`120000`/`scale≤10`/`60 字` compaction.ts:13,15,58,23 | 摘要生成质量 | compaction.ts + `ServerConfig.compaction.*` |
| TTS 模型 | `"s2.1-pro-free"` tts.ts:130 | 语音合成 | tts.ts:130 + `ServerConfig.tts.model` + configApi/SettingsScreen |
| TTS 单请求超时 | `20_000` tts.ts:131 | 语音合成 | tts.ts:131 + `ServerConfig.tts.timeoutMs` |
| 分句阈值 | `maxChars=30`、`idleFlushMs=700` core chunker.ts:96-97 | `VoicePipeline`（voice.ts:61 建 chunker 未传参） | core chunker 调用点 voice.ts:61 传参 + `ServerConfig.tts.*` |
| 旁路补全输出上限 | `MAX_TOKENS=2048` llm.ts:13 | 润色/翻译/摘要 | llm.ts + `ServerConfig` |
| 生图队列上限 | `MAX_QUEUE=12` imageAssets.ts:31 | 生图降级 | imageAssets.ts + `ServerConfig.image.maxQueue` |
| gemini 生图 `max_tokens` | `300` imagegen.ts:70 | 生图流 | imagegen.ts:70 |
| 润色输入上限 | `2000` 字 http.ts:312 | REST | http.ts |
| 工坊单轮超时/写盘上限 | `180000` workshop.ts:185、`200000/300` workshop.ts:29-31 | 工坊 agent | workshop.ts + `ServerConfig.workshop.*` |
| 剧目级创作风格（节奏/视角/人称/禁止项） | 无字段，只能塞 `memory/always/craft.md` | 剧作家 A 区 | core `play/config.ts` 加 `PlayConfig.craft` + prompt.ts:77 附近 + 前端配置区 |
| 玩家表态的「未作回应」注入策略 | orchestrator.ts:829-831（固定条件） | 剧作家 | orchestrator.ts + PlayConfig 开关 |
| 服务端口 / 剧目库根目录 | 可读不可写（configApi.ts:57-58 vs 89-148） | 运维 | configApi.write() 补分支 + SettingsScreen 增加「服务」组 |
