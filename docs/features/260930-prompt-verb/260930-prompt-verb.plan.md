# 动词收敛：编辑纯原地 / fork 是打断原语 / prompt 是唯一输入

> 2026-09-30 计划。承接 D9（OOC 主界面化）与 D10（五动词），本计划把「五动词正交」改成**四个原语 + 组合**。

## 1. 要解决的问题

当前实现的五动词，有三个是假的：

| 声称 | 实际 |
| --- | --- |
| 编辑「纯原地，不开新分支」（D10:371 契约） | `editInPlace` 挂的是链上节点，`attach` 顺手把 leaf 移到 edit 节点上——被编辑行之后的内容被甩进一条**不可达分支**。`rebaseAt(keepLeaf)` 还会把 `lastStop` 降成 `pause` 并让客户端整段重放 |
| 重生成「句/段两级」 | `recordRewrite` 对 line 和 beat 做的事完全一样，`granularity` 只是写进日志的装饰字段（review:68 已标）；`instruction` 也只是往 A 区通道塞一句「重新演绎」，而 fork 本身已经把它做到了 |
| 分岔（动词） | `forkAt` 只挪 leaf，**不写任何事件**——`lineage.jsonl` 里看不出「这里岔过」 |

导演注（OOC）则是另一套通道：它有独立的协议消息、独立的谱系 kind、独立的 A 区通道、独立的 `ooc_ack` 回执，但语义上它只是「往当前挂载点插一句用户输入」。

## 2. 新动词表

四个原语，组合权在用户：

| 原语 | 语义 | 谱系事件 |
| --- | --- | --- |
| **回看** | 客户端只读，不动世界线 | 无 |
| **编辑** | 原地替换当前分支某一行的文本 | `edit`（旁挂） |
| **fork** | 挂载点移到某节点，从那里起算新世界线 | `fork`（链上节点） |
| **prompt** | 在挂载点插一句用户输入 | `prompt` |

派生操作 = 序列，不是新动词：

- **打断** = `fork(拍中节点)` + `prompt(你想插的话)`
- **重来** = `fork(拍首事件)` + **立刻续演**，一次操作走完，中间不落地。拍首是玩家表态节点时锚点落在**它自己**上——上一拍的选择留在链上、不重新问，链尾那句表态由 §4.7 并进紧接着的这一轮。不带任何引擎生成的指令：被删掉的那一幕不在 transcript 里，redo 和 continue 是同一份输入，补一句「重新演绎这一幕」纯属多余
- **带着意图重来** = `fork(拍首事件)` + `prompt("这次让她先笑出来")`。意图是用户的话，不是引擎的注解
- **改因**（改了台词要重演） = `fork(该行父节点)` + `edit(该行)`，之后按正常停止点继续

`rewrite` / `ooc_at` / `ooc` 三个协议消息与三个谱系 kind 全部退役。

## 3. 谱系模型（`packages/core/src/lineage/model.ts`）

### 3.1 kind 集合

`LineageEventKind`（:21-24）：

```
- "ooc" | "player" | "rewrite"
+ "prompt" | "fork"
```

`prompt` 承袭 `player`/`ooc` 的位置（都在 `text` 字段存原文，`payload.input` 同步），`fork` 无 payload。

`LineageEvent` 上删 `granularity`（:37），`LineageNode` 上删 `granularity`（:93）。

### 3.2 编辑改旁挂

`editInPlace`（:171）替换为 `recordEdit(nodeId, newText)`：

- 事件写 `{ kind: "edit", editTargetId: target.id, text: newText, parentId: null }`
- `parentId: null` = 不进 parentId 树。`load()`（:336）遇到 `kind === "edit"` 时不进 `attach`，直接塞进 `edits: Map<targetId, LineageEvent[]>`
- **leaf 完全不动**。`append` 之后仍然永远挂叶尖
- `EDITABLE_KINDS` 不变（:108，只允许改 say/narrate/thought）
- 同一行多次编辑 → map 里追加，`materialize` 取最后一条

`materialize`（:201）的 override 来源从「链上扫 edit 子节点」改为读 `this.edits.get(event.id)`，并保持**只在 `ancestorChain` 上的节点才生效**——废弃分支上改过的行不影响当前分支。

`describe()`（:288）：

- `nodes` 里不再出现 `edit` 节点（它是旁挂，不在树上）
- 目标节点新增 `editedText: string | null`、`editCount: number`、`editedAt?: number`
- `children` 计数仍来自 `parentId`，但现在会算上 `fork` 节点（见 3.3）
- `parentId: null` 的 `edit` 事件不参与任何树遍历

`export`（:327）/`load`（:336）：`edit` 事件照常落 `lineage.jsonl`（append-only 铁律不动），`load` 时按 kind 分流。不写旧档兼容层（见 §9）。

### 3.3 fork 是真节点

`forkAt(nodeId)`（:159）改成 `recordFork(nodeId)`：

```ts
// 先把挂载点退到目标节点，再在其下挂一个空的 fork 标记——
// 之后所有 append 天然落在它下面，fork 点本身成为树上的一个节点
this.leaf = nodeId;
return this.append("fork");
```

`materialize`（:211）跳过 `fork`（标记不产生内容行）。`rebuild.ts` 的 `lineageToEvents` / `lineageToBeats`（:38/:142）同样跳过。

## 4. 编排器（`apps/server/src/orchestrator.ts`）

### 4.1 editLine（:614）—— 退化成「只换对话体」

```
guardIdle → tree.recordEdit → flushLineageLog
→ buildAgent(rebuildMessages(tree.chainEvents(tree.leafId)))
→ send { type: "line_edited", nodeId, text }
```

不再有 `rebaseAt`：不动 leaf、不动 `this.events`、不动 `seq`、不动 `lastStop`、不动引擎状态、不发 `lineage` 广播。客户端按 `nodeId` 就地替换那一行文字（`ScriptLine` 加 `edited` 标记，剧本视图用新文字渲染）。

引擎状态不回滚：改一句台词不等于撤销已经算出的好感度/旗标——那才叫分岔。

### 4.2 forkTo（:609）—— 只挪挂载点

保持 `rebaseAt(nodeId, "已从此处开新分支")`（:664），但不再传 `keepLeaf`（这个选项存在的唯一理由是 `recordRewrite` 要保留 leaf 停在 rewrite 节点上，现在 `recordFork` 自己会 append）。`rebaseAt` 里删掉 `opts.keepLeaf` 分支。

新增一个参数 `opts.resume`（默认 false）：为 true 时**跳过 `restoreStopPoint`**，发出去的 `rebase` 消息也不带 `stop`，把「停在这个停止点让玩家选」换成「立刻续演」（§7.1 的重来）。`engaged` 在整个 fork+续演过程里必须一直为真，否则 `whenIdle()` 会在两者之间放行，`switchSave` / 工坊写盘的 runtime 重建会和开拍撞车。

### 4.3 rewrite / oocAt 退役

- `rewrite`（:624）、`oocAt`（:638）删除
- `resolveBeatAnchor`（:790）、`renderRewriteTurn`（:811）删除——**幕首锚点的计算搬到客户端**（§7.2），服务端不再需要知道「拍边界」这件事
- 服务端不再有「重演」这个概念，只有 `fork` 和 `prompt`

### 4.4 prompt 队列（替代 `agent.steer`）

```
private pending: PromptItem[]   // 不持久化
type PromptItem = { id: string; text: string; createdAt: number }
```

`playerAction`（:542）改签名，`PlayerAction`（:206）：

```ts
export type PlayerAction =
  | { kind: "choice"; optionIndex: number }
  | { kind: "free"; text: string }
  | { kind: "continue" }
  | { kind: "prompt"; text: string };
```

四种 kind 归一成同一段原文 `text`：
- `choice` → `（选择了：${option.text}）`
- `free` → 原文本
- `prompt` → 原文本
- `continue` → 不落 `prompt` 事件、也不进对话体（§4.6），归一化时直接跳过

分流：

- `choice` / `free` / `continue`：**必须 idle**。busy 时没有停止点可回应，挡回 error（同今天 :556）
- `prompt`：`engaged` → 进 `pending`，广播队列后返回；否则直接 `deliverPrompts([item])`

`deliverPrompts(items)`：

1. 每条 `appendLineage("prompt", { payload: { input: text } })`——**注入时才落谱系**，删掉的排队输入不留痕
2. `markSent(items)` → 广播 `prompt_queue`（`status: "sent"`, `beatNo: this.beatNo + 1`）
3. `await this.beginBeat(this.renderPromptTurn(items.map(i => i.text), acrossStop))`

`renderPromptTurn`（替掉 `renderUserTurn` :843 / `renderDirectorNote` :857 / `recordPlayerLine` :871）：

```
【状态】
<renderStateSection>

【用户输入】
<第 1 条>

【用户输入】
<第 2 条>

（以上是用户发来的内容。若以「OOC」开头，那是导演指示：据此调整接下来的演出方向，
  不要复述或回应这段指示本身。否则是其中某个角色（可能就是主角，也可能是别人）
  的行动、话语或心理：照字面意思演成该角色的言行，涉及主角的决定性动作时给出停止点。
  两种都不要在剧本中复述这段文字本身。）

（用户是在未作回应的情况下直接发来这段的。若其中已包含某个角色的行动或话语就直接演；
  否则继续演出，并在合适时机再给出回应机会。）
```

最后那段**无条件追加**，条件只有一条：`acrossStop && lastStop && lastStop.stopType !== "pause"`。判断依据是「引擎上次是不是在问玩家」，与发消息的人是谁无关——今天的「玩家本轮未作回应」隐含了身份判断，改成引擎事实后对导演注和角色代入一样成立。

`acrossStop = !this.busy`（同今天 :849）。

### 4.5 排空点

`beginBeat`（:882）的 `finally`：

```ts
if (this.busy) this.finishBeat();
this.beatPending = false;
if (!this.busy) {
  this.send({ type: "beat_settled" });
  this.drainPending();
}
```

```ts
/** 拍收束后：有排队输入就立刻续开下一拍（保持 engaged），没有才放行 whenIdle。 */
private drainPending(): void {
  if (this.pending.length === 0) {
    this.flushIdleWaiters();
    return;
  }
  const items = this.pending.splice(0, this.pending.length);
  this.beatPending = true;          // 先占位，外层 finally 已经把 engaged 交出去了
  void this.deliverPrompts(items);
}
```

`beatPending = true` 必须在 `void` 之前同步置位：`engaged = busy || beatPending`，不置位的话 `switchSave` / 工坊写盘的 `whenIdle()` 会在这一拍收束的瞬间被放行，随后 pending 又开新拍——runtime 重建和开拍撞车。

这条路径**不再走 `agent.steer`**：`steer` 的队列语义是「turn 边界插话」，而我们要在**拍边界**统一处理，编排器自己持有队列更准。副作用是 pi 的 `steeringMode`（one-at-a-time / all）在这个链路上不再有意义，`createAgent` 里的 `steeringMode` 配置可以删掉。

### 4.6 「继续」不再是玩家说的话

今天 `recordPlayerLine`（:887）对 `continue` 也落一条 `player` 谱系事件，文本写死「（继续）」，`renderUserTurn`（:869）也照抄一份进对话体。后果是每一拍都以一条玩家输入节点开头，两个问题：

- 「继续」不是玩家说的话，是引擎的推进动作。谱系里这次推进已经被前一拍的 `beat_end` 记着了，不必再补一个标记；对话体里 `【状态】` 本身就是一条 user 消息，足够开下一拍
- 「重来」把锚点落在拍首（§7.2）时，这条「（继续）」就成了链尾悬空节点；玩家再点一次「继续」又落一条，同一轮里出现两份一模一样的输入

改法：`continue` 既不落谱系事件，也不进对话体——那一轮的 user 消息只有 `【状态】` 段。`choice` / `free` / `prompt` 才落 `prompt` 事件。

### 4.7 链尾悬空的表态交给下一轮

锚点落在玩家表态节点上时（选项 / 自由输入 / 插一句），链尾是一条**没有台词回应的表态**。`rebuild.ts` 的 `lineageToBeats` 遇到这种「只有 inputs 没有 script」的尾组，今天会凑成 `{user, assistant: ""}` 的空轮次——`recordRewrite` 当年就是为了躲这个才把表态切掉、改用 `recap` 回灌。

新做法把「躲」换成「接」：

```
lineageToBeats(chain) → { beats, trailingInputs: string[] }
rebuildMessages(beats) 不渲染尾组
```

编排器持有 `private trailingInputs: string[]`，`beginBeat` 开头把它并进本轮的输入列表（`renderPromptTurn([...trailingInputs, ...本轮输入])`）后清空。效果：模型照旧看得见你上一次选了什么，但不必造一条空 assistant 轮次，也不必服务端再写 recap。

「重来」正是这条路径的主用例：fork 到一条表态节点后立刻续演，续演那一轮的输入就是被截下来的那句表态——玩家点一次「重来这一幕」，模型收到的是「她选了 A」，然后重演。

这条路径顺带覆盖所有「链尾停在表态节点」的重建场景（分岔到某一拍的拍首、崩溃后重启续演），不再需要为它单开特例。

## 5. 协议（`packages/core/src/ws/protocol.ts`）

`ClientMessage` 增删：

```ts
- | { type: "ooc"; text: string }
- | { type: "rewrite"; nodeId: string; granularity: "line" | "beat"; instruction?: string }
- | { type: "ooc_at"; nodeId: string; text: string }
+ | { type: "prompt"; text: string }
+ | { type: "prompt_edit"; id: string; text: string }
+ | { type: "prompt_delete"; id: string }
```

`ServerMessage` 增删：

```ts
- | { type: "ooc_ack" }
+ | { type: "line_edited"; nodeId: string; text: string; seq?: number }
+ | { type: "prompt_queue"; items: PromptQueueItem[] }

type PromptQueueItem = {
  id: string;
  text: string;
  beatNo: number;              // 入队时的拍号
  status: "pending" | "sent";
  sentBeatNo?: number;         // 注入到第几拍
};
```

`line_edited` 带 `seq`：客户端靠它 `ScriptBuilder.replaceText(seq, text)` **就地换掉缓冲里那一行**，不重放全量事件。不带 `seq`（节点上没有行号，例如旁白之外的 kind）时客户端只刷新谱系标签。

`fork` 多一个 `resume`：

```ts
| { type: "fork"; nodeId: string; resume?: boolean }
```

`resume: true` = 分岔完**立刻开新拍**（「重来这一幕」语义：等于紧接着点了一次「继续」，中间不设停止点、零点击）。不带 = 只把树摆到分岔点，等玩家自己表态（路线树里对任意节点分岔走这条）。

**为什么合成一条消息而不是连发两条**：`fork` 之后编排器已经 `guardIdle()` 上了新拍的锁，紧跟着的 `prompt` 会被当成「演出进行中」拒掉。所以要续演就得由 `fork` 自己带话，不能拆成两个动作。

`edit { nodeId, newText }`、`jump { nodeId }` 不变。`prompt_edit` / `prompt_delete` 找不到 id 时回 `error`（不静默）。

WS 消息是顺序处理的，客户端连发 `fork` → `prompt` 天然串行，不存在原子性问题。

`apps/server/src/transport.ts`（:124-142）分发同步改；`LineageOps` 相应改成 `{ fork, edit, prompt }`。

## 6. 提示词 A 区（`apps/server/src/prompt.ts`）

改三处：

- :105 `玩家既是主角（通过【玩家表态】入戏回应），也是导演（通过【导演注】调整演出方向）。`
  → `用户发来的东西一律进【用户输入】区：可能是在替某个角色行动或说话，也可能只是给这场戏的指示。`
- :168 `【玩家表态】是主角…【导演注】是导演指示…`
  → `【用户输入】是用户发来的内容：以「OOC」开头 = 导演指示，遵从但不复述、不跳出戏外回应；否则是某个角色（可能就是主角，也可能是别人）的行动、话语或心理，照字面意思演成该角色的言行。两种都不要在剧本里复述这段文字本身。`
- :169 「本轮未作回应」规则改写成 §4.4 那段尾巴的对应表述（提到「某个角色」，不提「玩家」）

`rebuild.ts` 的 `lineageToBeats`（:142）里 `case "player"` / `case "ooc"`（:162-167）合并成 `case "prompt"`，模板统一为 `【用户输入】\n{input}`。`editOverrides`（:20）签名从 `(chain)` 改成 `(edits: ReadonlyMap<string, LineageEvent[]>)`——`lineageToEvents` 与 `lineageToBeats` 的调用方都要能把 `tree.edits` 传进来。

## 7. 前端（`apps/web`）

### 7.1 导演栏（`StageTheater.tsx` :325-440）

四个按钮变三个，删掉「从这里分岔」——锚点就是当前拍首，跟「重来这一幕」是同一个操作，两个按钮摆在一起只是让人选一个重复的动作。任意节点的分岔放在路线树/剧本视图里，那里的锚点由玩家点的行决定。

| 按钮 | 原来 | 改成 |
| --- | --- | --- |
| ① | 导演注（OOC） | **插一句** — `onPrompt(draft)`。面板里加一个 `OOC` 快捷按钮，点一下给输入框加 `OOC：` 前缀（已有前缀则撤掉） |
| ② | 编辑当前台词 | 不变（`onEdit`） |
| ③ | 重生成这一幕 | **重来这一幕** — 面板留空就只 `onFork(anchor)`；填了话就 `onFork(anchor)` 再 `onPrompt(draft)`。title 写「会分岔」 |

①③共用同一块输入面板（`action` 状态已有这个机制），hint 文案分别写「可以是角色的行动/话语，也可以是给这场戏的指示」和「留空 = 只重来这一幕；填了 = 连意图一起给」。

fork 完**立刻开新拍，不落地**：「重来」和「从上一拍的最后继续」是同一个操作，玩家不该被停在中间。服务端把 fork 和续演合成一次调用——`forkTo(anchor, { resume: true })`：`rebaseAt` 不恢复停止点、`rebase` 消息里不带 `stop`，紧接着 `beginBeat` 起新拍。客户端看到的是这一幕消失 → 舞台退到上一拍的选择之后 → 新的这一幕开始演，中间没有任何停止点、一次点击都不需要。

（不带 `resume` 的裸 `fork` 仍保留：路线树上任意节点的分岔用那条，它就该停在那个停止点让玩家自己选下一步。）

`oocQueued` 小红点删掉——右上角队列面板是同一个信息的另一个显示点，按钮上不重复。

### 7.2 拍首锚点计算搬到这里

`buildBeats`（`beats.ts` :29）已经知道每张卡的首节点（`card.id`）。锚点规则只有一条：

```ts
const anchor = card.id;                        // 拍首事件本身
// anchor 的父为 null = 这张卡就是世界的起点，没东西可以分岔出去 → 禁用重来
```

拍首是玩家表态节点时（选项 / 自由输入 / 插一句），锚点就落在**它自己**上：上一次的选择留在链上（它确实发生过），不会被重新问一遍。链尾因此总是一条「还没有台词回应的表态」，由 §4.7 的 `trailingInputs` 并进下一轮——模型看得见你选了什么。今天服务端要靠 `resolveBeatAnchor` + `recap` 干这件事，客户端一行判断都不用。

拍首是剧本事件时（该拍由「下一幕」进入，§4.6 之后这种拍不再有拍首表态节点），锚点落在那行上，同一条 `resume` 路径接管。没有表态就没有悬空输入要接，续演那一轮的 user 消息只有 `【状态】` 一段——与玩家自己按「下一幕」产生的对话体逐字相同。两种情况对玩家是同一个操作：不用做任何事。

拍号：`rebaseAt` 把 `beatNo` 回退到被重演的那一拍，新拍沿用同一个号。玩家看到的是「这一幕又来了一次」，不是「多了一幕」。

### 7.3 路线树与回顾列表

`beats.ts` 的 `buildBeats`：

- `rewrite` 分支（:45）改成 `fork`：`cardOfNode.set(node.id, current); closed = true; continue`（和今天 rewrite 一样），fork 节点不产内容行、不单独成卡
- 下一个节点开新卡时，若链上它的父是 `fork` 节点，该卡带 `forkedFrom: { nodeId, turn }`
- `edit` 节点不再出现在 `nodes` 里，:44 的过滤分支删掉
- `BeatCard` 加 `forkedFrom: LineageNodeRef | null`

`RouteCanvas.tsx`：

- **删掉** :257 的 `⑂ {branchCount} 条分支` 页脚（`route-node-fork`）
- 改成：带 `forkedFrom` 的卡在头部挂一个 `⑂` 徽标，`title="从第 N 拍分岔而来"`。语义从「这里有 N 条分支」变成「这张卡是从那儿岔出来的」
- 分岔边（父卡 → `forkedFrom` 非空的子卡）单独描边色 `.route-edge.fork`，让扇出在画面上是一条边而不是一个数字

`StageTheater.tsx` 的回顾列表（:622-639）：铅笔 / rewrite / fork 三个行内按钮里，**rewrite 那个删掉**——它和 fork 按钮今天传的是同一个参数（`beat` = 该卡首节点），差别只是服务端把首节点切掉还是留下。新设计下「重来这一幕」= `fork(card.id)`，就是 fork 按钮的行为，只是 title 改成「这一幕重新来一次（会分岔）」。

`LineagePanel.tsx`：`LineageOps`（:14-17）`rewrite` 成员删除，调用方（StageScreen）跟着改。这个文件里没有逐行渲染（`describeRow`/`treeRows` 都不存在），节点文字全在 `beats.ts` / `RouteCanvas.tsx` 里。

`transcript.ts`（P1 文字视图/回顾）：`TranscriptKind`（:5）`"line" | "player" | "ooc"` → `"line" | "input"`，筛选条件（:79-84）简化成 `node.kind !== "prompt"`，:82-84 那条「一条 OOC 记了两个节点要去重」的分支随之消失。CSS `.bl-ooc` 改名 `.bl-input`。

### 7.4 排队面板（新增 `PromptQueuePanel.tsx`）

固定在**右上角**的独立小面板，**不跟导演栏联动**：

- `items.length === 0` → 整个面板不渲染
- 每行：原文 / 入队拍号 / 状态（`等待中` 或 `已注入 · 第 N 拍`）/ 编辑 / 删除
- 编辑 = inline contenteditable 或小 input，提交走 `prompt_edit`
- `sent` 项保留到下一拍开始，然后淡出（不是立刻消失——要看得见「发出去了」）
- 挂载在 `StageScreen.tsx` 的舞台层，`position: fixed; top; right`，`z-index` 低于工坊抽屉

## 8. 测试

| 文件 | 改/加 |
| --- | --- |
| `packages/core/test/lineage.test.ts` | :91/:95 的 rewrite 用例换 fork；**新增**：edit 旁挂（leaf 不变 / `ancestorChain` 不含 edit / `materialize` 生效 / `children` 计数不含 edit / `editedText`+`editCount` 正确 / 多次编辑取最后一条 / 废弃分支上的编辑不影响当前分支）；`recordFork` 产生节点、fork 后 append 挂在其下、`materialize` 跳过 fork；`export`→`load` 往返 edit+fork 无损 |
| `apps/server/test/lineage-ops.test.ts` | :85 editLine 改成断言「不动 leaf / 不重发 events / 只发 `line_edited` / 引擎状态不变」；:108-143 forkTo 断言多出 `fork` 节点；:150-172 rewrite、:182-187 oocAt 删除，改写成「客户端连发 fork+prompt」的服务端行为 |
| `apps/server/test/orchestrator.test.ts` | :149-172 改测新 user 消息形态（含 OOC 遵从条款 + 角色代入条款 + 未作回应尾巴）；:457-544 rewrite 用例删；**新增**：busy 中 `prompt` 不开拍、只进队列；拍收束后自动开新拍且只开一次；多条 pending 合成一条 user 消息 + N 个 `prompt` 谱系事件；`prompt_edit` / `prompt_delete` 生效；pending 不进 `runtimeState`；`whenIdle()` 在 pending 排空前不放行；`continue` 不落谱系 `prompt` 节点、对话体里只剩 `【状态】`；`fork(anchor, {resume:true})` 后立刻开新拍、中间不发 `stop`，且被截断的表态并进这一轮 user 消息、没有空 assistant 轮次；`whenIdle()` 在 fork+续演之间不放行 |
| `apps/web/src/stage/beats.test.ts` | :136/:171-178 的 rewrite 用例换 fork；断言 `forkedFrom` 正确、`prompt` 节点进卡首、edit 不产生节点、拍首锚点 = `card.id` |
| `apps/web/src/stage/transcript.test.ts` | :45-67 合并成 `prompt`，去掉去重分支 |

测试范围：core 只跑 `lineage.test.ts`，server 跑 `orchestrator.test.ts` + `lineage-ops.test.ts`，web 跑 `beats.test.ts` + `transcript.test.ts`。不跑全量。改 core 后 `pnpm --filter @stage-ai/core build` 再跑 server 测试。

## 9. 旧数据

不写读时兼容层（AGENTS.md：真实上线前不做旧版迁移）。直接删 `plays/demo/lineage.jsonl` + `plays/demo/session.json`——这两个是 saves/ 层落地之前的平铺遗留文件，未进 git，只有 demo 一个周目在用。

## 10. 文档

- `AGENTS.md` 顶部目标段：「跳转/分岔/重生成/编辑/导演注 OOC 五动词」改成新动词表；地图段里 `src/lineage/model.ts` 的「五动词」和 `recordRewrite` 说明改掉；`src/orchestrator.ts` 的「busy 中 OOC 走 `agent.steer` 原地注入」改成 pending 队列；`StageTheater` 的「常驻导演注浮层（🎬 导演，ooc_ack 显示已注入）」改成新面板
- 规范段的「五动词正交」改成「四原语 + 组合」，并补上：编辑不产隐藏分支、fork 必写节点、prompt 是唯一输入通道
- 「拍中分岔即截断」保留不变
- `docs/features/260928-stage-ai-mvp/260928-stage-ai-mvp.plan.md` D9/D10 标注被本计划取代
- README 补用户可见部分：插一句 / OOC 快捷键 / 排队面板 / 编辑是原地的 / 来重这一幕会分岔

## 11. 风险

- **`drainPending` 与 `whenIdle` 竞态**：§4.5 的 `beatPending = true` 必须在 `void` 之前同步置位。漏了会导致切档 / 工坊写盘在排空瞬间重建 runtime，把新拍腰斩。用 `whenIdle()` 的测试兜住。
- **fork + 续演必须是原子的**：`forkTo(anchor, {resume:true})` 里 `rebaseAt` 到 `beginBeat` 之间不能有 `await` 让出 `engaged`——中途被 `whenIdle()` 放行会让切档/工坊写盘重建 runtime，新拍腰斩。同理 `resume` 分支不发 `stop`，客户端不会在两个停止点之间闪一帧
- **「继续」不再进对话体**：§4.6 之后下一拍的 user 消息只剩 `【状态】` 一段。风险是模型把「上一拍刚给过选项」理解成还要再问一轮。若实测出现，兜底是在状态段后补一行 `（请继续演出）`，不进谱系
- **谱系里没有「这次是重来」的记录**：`fork` 事件只说挂载点移了，移之前的历史属于哪条分支从树上看得出来；刻意不存「原因」字段。将来真要展示「为什么分了这条线」再加
- **编辑不回滚引擎状态**：改台词后好感度/旗标仍是旧值。这是「纯原地」的定义，代价是台词和状态可能对不上。要能接受。
- **`recordFork` 让 `describe().children` 变多**：脚本视图和路线树若还在用 `children > 1` 判断分叉会误报。§7.3 一起清掉。
- **fork 节点进入 `materialize`/`lineageToBeats` 的路径**：漏跳过就会变成一行空文本。core 测试覆盖。

## 12. 实施顺序

1. core：`model.ts`（sidecar edit + fork 节点 + prompt kind）+ `protocol.ts` → 跑 `lineage.test.ts`
2. server：`rebuild.ts`（`prompt` kind + `trailingInputs`）→ `orchestrator.ts`（editLine / forkTo / rewrite 删 / continue 不落节点 / prompt 队列 / drainPending）→ `transport.ts` → `prompt.ts` A 区 → 跑 `orchestrator.test.ts` + `lineage-ops.test.ts`
3. web：`beats.ts` + `RouteCanvas.tsx` + `LineagePanel.tsx`（fork 徽标）→ `transcript.ts` → `StageTheater.tsx` + `PromptQueuePanel.tsx` + `useStageSocket.ts` + `StageScreen.tsx` + CSS → 跑 web 两个测试文件
4. 删 demo 旧档；`pnpm typecheck` + `pnpm build`
5. 起 dev，截图路线树 / 排队面板 / 剧本编辑三处给用户看
6. 文档：AGENTS.md + README + 本计划的 plan/review/summary
