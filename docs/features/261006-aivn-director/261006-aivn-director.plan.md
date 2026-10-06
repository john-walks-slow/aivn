# dsh-aivn 导演工具栏 / pending panel / 与 DSH 回退·分支一致

2026-10-06。用户要求（deep-auto 全量支持）：

1. 支持 AIVN 导演工具栏的**编辑（改写）、提示、重试**；提示要支持**引导（随下一轮发出）或打断**；重试要支持**带指令**。
2. **不做** AIVN 自管的谱系分支，改用 DSH 原生的「在新对话中分支」。
3. 视工作量支持 **pending panel**（图片/音乐/语音/提示，重点是**语音与提示**）。
4. 确认 dsh-aivn 与 **dsh-rewind**、与「在新对话中分支」配合良好：回退到某个点再进舞台要回到那个点；在某选项处分支出新对话，新对话进舞台也要在那个选项处。

## 一、调查结论（事实，实现依据）

### 1.1 DSH 侧 API（`/usr/lib/node_modules/@deepseek-ai/dsh/`）

- **Agent 的输入与打断**（`@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts`，Agent 模块扩展）：
  - `followup(message)` —— 排进**下一轮**（next-turn，单独成轮）。
  - `steer(message)` —— 最近的 step 边界插入（运行中下一 step 就吃到）。
  - `inject(message)` —— 最近的 pre-step 插入，**不唤醒**驱动器。
  - `cancel(cause, options?)` —— 中止当前轮/回合间任务；`{keepInbox:true}` 保留排队与 steering；`cause` 形如 `{kind:'user'}`。
  - `whenIdle()`、`runMaintenance()`、`session`、`inbox`、`status`、`options`。
- **重写/回退的正规做法**（照抄 `dsh-rewind-plugin@0.14.0`，`/root/.dsh/profiles/web/node_modules/dsh-rewind-plugin/lib/index.js`）：
  ```js
  const surface = agent.session.surface.nodes;      // 模型可见的 seq 列表（顺序即上下文顺序）
  const events  = agent.session.snapshotEvents();   // 全量事件（另一个插件也在用；标注 deprecated 但可用）
  const targetIndex = surface.indexOf(targetSeq);   // targetSeq 必须是 surface 上的节点
  const shadowedSeqs = surface.slice(targetIndex);  // 到末尾为止的连续 surface 区间
  agent.session.append('user/message', marker, {
    surfaceOp: { op: 'replace', startSeq: shadowedSeqs[0], endSeq: shadowedSeqs.at(-1) },
    sourceEventSeqs: [...shadowedSeqs],
  });
  ```
  - `marker` 是一条 `createUserMessage(...)`，该插件的 `source = {kind:'dsh-rewind'}`；回退标记因此能按 source kind 认出来。
  - 该插件回退前会：若 agent 非 idle → `agent.cancel({kind:'user'},{keepInbox:true})` → 等 `whenIdle()`（15s 上限）→ 清 `inbox.nextStep` 里的 steering。
  - 校验要求：`startSeq/endSeq` 必须是 surface 上**连续**区间的首尾，`sourceEventSeqs` 必须**恰好覆盖**被遮蔽的节点（"complete shadowed-node coverage"、唯一且更早）。
  - 该插件的用户入口只允许**人类 user 消息**作目标（`isHumanUserMessageEvent`：`source.kind === 'user'`），我们内部用（重写/改写）可以取更靠后的 assistant 节点。
- **会话日志 → 消息**：`dsh-session` 导出 `deriveEventMessage(event)`（event → `Message`）、`foldSurface`、`isAppendSurfaceEvent`、`isReplacementSurfaceEvent`。`Session` 有 `surface.nodes`（seq[]）、`snapshotEvents(from?,to?)`、`eventAt(seq)`、`seq`、`append(...)`。
- **分支（在新对话中分支）**：`ctx.sessionController.fork({sessionId, atSeq?})` → 新会话 id（`@deepseek-ai/dsh-api-session-controller/lib/types/commands.d.ts`）。`atSeq` 是**闭区间**截点，省略则取最近的完整轮边界。子会话继承 `[0, boundary]` 事件 + 合成 `session/end-seed`，`header.inheritedEventCount = boundary+1`、`parentSession` 指向父会话。**surface 会在子会话里重新折叠**，所以分支后新会话的 surface 就是那一刻的上下文。
- 会话日志里 `user/message` 事件的 `data` 就是 UserMessage（`data.source.kind` 可判来源）。GUI 里「在新对话中分支」的提示是「仅可从已完成轮次的最后一条消息分支」。
- 客户端（浏览器半边）可用：`ctx.sessions`（`fork` / `binding` / `list`）、`ctx.uiWorkspace`（`openSession` / `activeSessionId`）、`ctx.uiConversation`（`nodes` / `events`）。会话切换会重挂 view。

### 1.2 AIVN 侧参照（`/root/projects/stage-ai`）

- 导演栏在 `apps/web/src/stage/StageTheater.tsx`（≈661-741），五个动作：提示 / 改写 / 重写（内部名 restart，走 `onFork`）/ 生图 / 重听。回调在 StageScreen：`onPrompt`/`onEdit`/`onFork`/`onGenerateCg`/`onReplay`。
- **提示**：WS `{type:'prompt', text}` → `orchestrator.playerAction` → 进 `this.pending: PromptQueueItem[]`，**等这一拍演完**（`autostarted && !engaged`）才 `agent.prompt(text)`——即「随下一轮发出」。
- **改写**：WS `{type:'edit', nodeId, newText}` → `orchestrator.editLine(nodeId, newText)`：**直接改脚本行，不经过模型**。
- **重写**：WS `{type:'fork', nodeId|seq, resume, replaced, instruction}` → `orchestrator.forkTo(...)` → `rebase` → `beginBeat` → `runBeatTurn` → `agent.prompt(instruction)`；`resume:true` 时**当场打断当前输出**。
- **生图**：`generate_cg` → 后台作业 → `asset_ready`。
- **重听**：纯客户端，播已缓存的音频 URL。
- **pending panel**（`apps/web/src/stage/PromptQueuePanel.tsx`）两类数据：
  - `prompt_queue` → `{id, text, beatNo, status:'pending'|'sent', sentBeatNo?}[]`（提示队列；sent 后消失）
  - `pending_jobs` → `{id, kind:'beat'|'bg'|'cg'|'sprite'|'voice'|'bgm', label, prompt?, startedAt, state:'running'|'done'|'failed', error?}[]`
  - 语音由 TTS 作业驱动：`audio_ready {seq, phrase, url}`；失败项留在面板，靠 `pending_dismiss` 手动清。

### 1.3 dsh-aivn 现状（要改的地方）

- `src/hub.ts`：每会话一条 seq 递增的帧流，`append/appendBeat/appendVoice/appendStyle`，`subscribe()` 先补推缓冲再跟实时；缓冲上限 4000。帧种类：`ir` / `beat` / `voice` / `style`。**没有任何失效/重建机制**——回退后舞台照旧。
- `src/stage-tap.ts`：`agent/assistant-stream` 文本增量 → `StageDslParser` → `hub.append`；`agent/status` → `beat` 帧；`agent/inbox/inserted` → `player_input`（引擎自己投的按 `InjectedMessages` 的 message.id 摘掉）；玩家第一条消息顺带补 `play.json` 的 `opening`。
- `src/routes.ts`：`/aivn/play`、`/aivn/assets`、`/aivn/stream`(SSE)、`/aivn/audio`、`/aivn/tts`、`/aivn/asset`、`POST /aivn/input {session,text,silent?}`（`agent.followup`）。四道写闸：同源 / content-type / 8KB / JSON。
- `src/client/stage-view.tsx`：`EventSource` 收帧；`builder.reset()` + `setResetToken` 已有「断档重放」路径（`frame.seq > lastSeq+1` 时整段重放，注意 `seq <= lastSeq` 的帧会被丢，所以**重置帧不能靠把 seq 归零**来生效）；`<StageTheater directorBar={false} …>`，`targets = {beatId:null, beatNodeId:null, lineNodeId:null, lineSeq: playback.view?.seq ?? null, lineText}`；`onPrompt={(text)=>void send(text)}`（走 `/aivn/input`，会落成玩家台词！）。
- `@aivn/stage`（消费 `stage-ai/.worktrees/dsh-vn-stage/packages/stage`，见 `261006-aivn-image-parity` 的记忆条目）：
  - `StageTheater` props 已有 `directorBar`、`onPrompt(text)`、`onEdit(nodeId,text)`、`onFork(anchor,opts)`、`onGenerateCg`、`onReplay`、`voiceState`、`targets`、`canContinue`。
  - `DirectorAction = 'prompt'|'edit'|'restart'|'fork'|'cg'`；提示面板有 `GuideMode = 'guide'|'fork'`（**fork 要换掉**）；`ACTION_META` 里有各动作的标题/占位/提示文案；按钮置灰条件写在 `editBlock/beatBlock/forkBlock`（依赖 `targets.lineNodeId`/`beatId`/`lineSeq`）。
  - 没有 pending panel 组件（AIVN 的 PromptQueuePanel 没被抽进包）。
- 语音：`src/tts.ts` 内容寻址 `sha1(model \0 voiceId \0 text) + '.mp3'`，落在 `<剧目>/media-cache/tts/`；`src/voice.ts` 用 `@aivn/core` 的 `PhraseChunker` 分句、并发 2、`emit({lineSeq, phrase, state:'started'|'ready', url?})`；url = `/aivn/audio?session=…&file=…`。→ 重建舞台时**可以**按同样算法重算摘要、命中磁盘就补发 `ready` 帧（重听才不会瞎）。
- `src/injected.ts`：`InjectedMessages`（按 message.id 登记，`remember/claim`，LIMIT 32）。

## 二、设计决策

### 2.1 舞台状态以**会话 surface** 为准（解决第 4 条）

新增 `src/stage-log.ts`：`rebuild(sessionId)` = 从 surface 重建整条帧流。

1. `events = session.snapshotEvents()`，按 seq 建索引；`nodes = session.surface.nodes`。
2. `hub.reset(sessionId)`：清缓冲、**seq 不回退**，推一帧 `{kind:'reset'}`。
3. 逐节点：`msg = deriveEventMessage(event)`；
   - user 消息：`source.kind === 'user'` 且未被 `InjectedMessages` 认领 → `player_input`；`source.kind === 'dsh-rewind'`（回退标记）与其他非 user 来源 → 跳过；
   - assistant 消息：把文本喂给一个**新建的** `StageDslParser`（与实时路径同一套解析），IR 帧照常 append；顺带记录 `frameSeq → sessionSeq` 映射（导演动作用）；
   - 每遇到一条经认定的 user 消息就记一个「拍起点」（重写锚点）。
4. 语音：对每条 `say` 行，用 `PhraseChunker` 分句 + `sha1(model\0voiceId\0text)` 判磁盘命中，命中就补发 `voice ready` 帧（**不触发新合成**，没命中就当这一行没配音）。
5. 结束时补一帧 `beat: end`（重建总发生在 idle，或者 agent 正在跑但那是下面第 4 点的例外）。

触发时机（**只在结构真的变了的时候**，避免打断正常播放/自动推进）：
- SSE 订阅时这条会话**还没有缓冲**（进程刚起、或分支出来的新会话）→ 先重建再补推；
- `session/event` 收到带 `surfaceOp.op === 'replace'` 的事件（回退/重写/改写落下的标记）→ 重建；
- 导演动作（打断/重写/改写）执行完 → 重建。
**不**在每个 assistant 消息落定时重建。

客户端：新增处理 `frame.kind === 'reset'` —— **在 seq 去重之前**判（否则 seq 更小的帧会被丢）：`builder.reset(); director.reset(); setResetToken(n+1); lastSeq.current = frame.seq;` 后续重建帧照常应用。

live 路径与重建的关系：重建会重建 per-session 解析器（从 map 里删掉，下次增量新建）；重建期间若 agent 正在跑（只在「订阅时无缓冲」这一种情况可能），尾部未落定的文本会丢，这一轮剩下的增量从新解析器继续——可接受，且比现状（什么都不重建）强。

### 2.2 导演动作（`POST /aivn/direct`）

请求：`{session, action, text?, target?}`，`action ∈ 'guide' | 'interrupt' | 'edit' | 'restart'`；`target` 是客户端递回的不透明锚点（`line:<frameSeq>` / `beat:<n>`），服务端用 `stage-log` 的映射翻译成 session seq。

- **guide（引导·随下一轮）**：`agent.followup(createUserMessage({content:[text], source:{kind:'user'}}))`，并 `injected.remember(id)`（不落玩家台词线）。它进**提示队列**（服务端内存 + 帧 `{kind:'queue', items}` 推给舞台，见 2.3）。
- **interrupt（引导·打断）**：`agent.cancel({kind:'user'}, {keepInbox:true})` → 等 `whenIdle()`（超时 15s，照 rewind 插件的口径）→ 清 `inbox.nextStep` → `followup(同一条消息)` + 重建。
- **restart（重试，带指令）**：找到**当前这一拍的第一个 assistant surface 节点**（拍起点靠 stage-log 记录的 user 消息边界），从它开始 shadow 到 surface 末尾（`surfaceOp.replace`）；然后 `followup(instruction)`（instruction = 用户那句；留空则给一句默认「把这一拍重写一遍」）。⇒ 模型重写这一拍，舞台重建后旧内容消失。执行前若 agent 非 idle：先 cancel + whenIdle。
- **edit（改写某句）**：`target` 给出那一行的 frameSeq → 映射到 assistant session seq → 从**该节点**shadow 到末尾 → `followup('（导演改写）把这一拍重写一遍，其中这句：「原句」改成：「新句」；其余照旧。')`。原句由服务端从 stage-log 取（客户端不必回传，短句也省一次往返），新句来自请求。
- 所有写请求都过 `readJsonBody` 的四道闸。action 与 target 校验失败回 400 并带上能读的原因。

配套提示词：剧作家提示词加一小节《导演指令》——以「（导演…）」开头的 user 消息是**导演的要求**不是玩家台词：照办（重写这一拍 / 按这句改），别把它当成玩家说了什么。

### 2.3 提示队列 + pending panel（语音 + 提示）

服务端新增每会话的 `GuideQueue`（内存即可）：`{id, text, status:'pending'|'sent', at}`；guide 入队 → 帧 `{kind:'guide', items:[…]}` 全量快照（与 style 帧同一口径，幂等）；该消息被 agent 认领（`agent/inbox/inserted` 里 claim 到它）时标 sent → 再推一帧。队列随会话 dispose 清掉。

客户端 pending panel（**新组件放插件这一侧**，不塞回 `@aivn/stage`：它是宿主特有的东西）：
- 入口放在舞台右上角导演栏旁边的一个小徽标（有条目时才出现），点开是浮层列表；
- 条目：**提示**（来自 `guide` 帧：排队中 / 已送出）+ **语音**（来自 voice 帧：正在合成的行 → 从 `builder.cues`/lines 反查那一行文本）；
- 图片/音乐不做（插件里出图与配乐是同步工具调用，没有回合之外的作业可报；出图期间舞台已有 busy 态 + 等待回执）。这条写进 README/小结。
- 视觉克制：不新增主题色/新样式语言，沿用 `stage.css` 已有的浮层与 `--` 变量（用户明确要求过「没有点名的视觉不要动」）。

### 2.4 `@aivn/stage` 包的改动（会加深与 AIVN main 的漂移，记入漂移清单）

- 提示面板 `GuideMode`：`'guide'|'fork'` → `'guide'|'interrupt'`（文案：引导=随下一轮发出 / 打断=立刻停下这一轮，用这句接着写；`ACTION_META.prompt` 的说明与 `GuideMode` 注释一起改）。
- `onPrompt(text)` → `onPrompt(text, mode)`；`onFork` 由插件侧继续用于 restart（包不用改它的语义）。
- 置灰条件允许插件用**自铸的不透明锚点**：插件会传 `lineNodeId = 'line:<frameSeq>'`、`beatId = 'beat:<n>'`，包只当字符串用（现有实现就是这样，无需改）。
- 待定：pending panel 是否也放进包（倾向不放，放插件）。
- 包内单测：`actorCue.test.ts` 旁边补 prompt panel 的模式/文案测试（若面板逻辑可独立测）。

### 2.5 分支（第 4 条的另一半）

「在新对话中分支」由 DSH 自己完成（`sessionController.fork`），插件侧**不需要做任何事**：新会话首次打开舞台时走「订阅时无缓冲 → 从 surface 重建」这条路径，自然回到分支点。要验的就是这条 e2e。

## 三、实施顺序

- A. 基础设施：hub 的 reset 帧 + `stage-log.ts` 重建 + tap 的 rewind 检测/标记过滤 + 客户端 reset 处理 + 语音缓存补发。
- B. 导演动作：服务端 `director.ts` + `/aivn/direct` + 提示词《导演指令》 + 引导队列 + 客户端导演栏接线 + 包内 GuideMode 改造。
- C. pending panel（提示 + 语音）。
- D. e2e：重写（带指令）落回同一时间点、回退后重进舞台回到该点、分支会话进舞台在选项处、引导随下一轮 / 打断、pending 面板两态。
- E. reviewer → 提交（dsh-aivn 一个提交；stage 分叉一个提交；stage-ai 文档一个提交）。

## 四、风险与注意

- `snapshotEvents()`/`eventAt()` 标注 deprecated（新调用"不建议"），但 `dsh-rewind-plugin`（第三方、在维护）也在用；插件只在**实时会话**（agent 在位）上读，语义安全。若将来有异步替代，换起来是一处。
- `surfaceOp.replace` 的校验较严（连续区间 + 完整覆盖 + 唯一更早来源）；实现要照 rewind 插件的 `planRewind` 口径算，并处理「目标已不在 surface 上」等错误。
- 客户端 reset 与播放状态：resetToken 已有先例（断档重放），行为可复用；但要确认重置后**不会**把「已演过的内容」重新播一遍（要实测）。
- 重建会重算 voice 帧（只发命中的），所以回退/分支后的旧台词「重听」仍可用；没命中的行保持无语音。

## 五、实施纪要（2026-10-06，与上面那版设计的差异）

计划里写的四个动作（guide/interrupt/edit/restart）在实现里收成**三条**：`guide` / `interrupt` /
`rewrite`（`rewrite` 带一个 `from: 'beat' | 'line'`）。理由：AIVN 的「改写」是直接改脚本行的原地
编辑，而 DSH 这边剧本就是剧作家的输出、会话日志才是权威——「改这一句」只能是**让剧作家重写这一拍**。
于是改写与重写走的是同一条路（往会话里追加一条 `surfaceOp.replace` 的标记），差别只在作废的起点：
改写从**最后一条**助手消息起（`line`），重写从这一拍**第一条**起（`beat`）。少一个接口，少一套语义。

其它落在纸面之外的实现细节：

1. **替换事件的过滤**（`stage-log.ts` 的 `isTimeTravel`）。三种东西都长着 `surfaceOp.replace`：
   回退与导演重写（要重投影）、上下文压缩（**不**重投影——它摘掉的是模型上下文里的中间那段，
   那些戏早就演过了，舞台是演出记录）、系统提示词 / 工具表的重投影（`system/message`、
   `developer/message`，与剧本无关，而且每开一个新的请求序列都会来一条）。只认 `user/message`
   且来源不是 `compact-checkpoint` 的那一种。
2. **重置帧要补一帧提示队列**：`reset` 会让客户端把队列一起清掉，而队列在导演手里（不在会话面上），
   所以重投影的帧流紧接着推一帧 `guide` 现值回去。
3. **`InjectedMessages` 改成按会话分表、且查过不销号**：重建也要把引擎投过的每一条再摘一遍，
   销了号的重建会把开局指令、追收束、「继续」统统变成玩家的台词。
4. **冷会话的舞台**：SSE 接上时这条会话一帧都没有（刚分支出来、宿主重启过），`StageLog.ensure`
   先看存档（`sessionController.inspect`）里的工作目录，确认有 `play.json` 才去 `resolveAgent`
   把会话挂起来重建——不是剧目的会话不该被挂起来白占内存。
5. **语音只补盘上已有的**：重建给台词行重新编号，旧语音帧作废；按同一套分句 + 内容寻址算法把
   命中的音频补成 `ready` 帧，**不触发新的合成**。流式那一遍若在行中途停过 700ms 以上，
   分句会与整段重算不同，那种行重建后就当没有配音。
6. **`@aivn/stage` 的两处加量（都是加法，AIVN 主线不受影响）**：`promptAlt?: 'fork' | 'interrupt'`
   （「提示」的第二岔由宿主决定）、`showGenerate?: boolean`（生图那一格归不归宿主）；
   另外把 `.theater-director` 那一段样式从 AIVN 的 `app.css` 挪进包的 `stage.css`
   （组件自己画的浮层，样式本该跟着组件走——插件里只有 `stage.css`，不挪就渲染成一排裸按钮）。
7. **提示词**：《演出契约》加了第 7 条，交代「（导演…」是片场喊话、不是戏里谁在说话。
8. **重置帧不靠「归零 seq」生效**：计划里写的是「客户端在 seq 去重**之前**处理 reset」，实现里
   靠的是**单调不回退的 seq**——重建帧的号一律比之前那个大，于是正常走去重之后照旧被应用；
   reset 帧自己也只是普通一帧（客户端在分派里认它）。少一条「序号会倒退」的特殊路径。
9. **`targets` 用自铸的不透明锚点**：`beat:current` / `line:<frameSeq>`。插件没有谱系节点，
   服务端按 `from` 决定作废到哪儿，舞台只当字符串传。
