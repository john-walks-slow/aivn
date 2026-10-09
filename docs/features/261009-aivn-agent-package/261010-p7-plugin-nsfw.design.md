# P7 设计 · 插件补限制级（NSFW）通道

日期：2026-10-10 · 状态：**设计稿**（用户 2026-10-10 指名为必做）
上游：服务端那条通道是**参考实现**（`apps/server/src/orchestrator.ts`、`apps/server/src/agentkit/nsfwTool.ts`）；
插件侧现状：`dsh-aivn-shared/src/playwriter/prompt.ts:13` 一句注释自认「限制级通道还没实现」，**零接线**。

---

## 0. 一句话

把服务端已经跑通的那条通道在插件上做出**同形**的一份：剧作家调 `enter_nsfw` / `exit_nsfw` →
下一拍起换**限制级专用模型** + 注入限制级提示词与合规声明 → 退出那一拍生成全年龄摘要、
**把模型可见面里的露骨段替换成摘要**、切回主模型 → 事件带标、左上角有标识、重建能恢复。

---

## 1. 参考实现：服务端那条通道的完整语义（实读）

| # | 语义 | 服务端落点 |
| --- | --- | --- |
| 1 | 两个工具：`enter_nsfw(reason?)` / `exit_nsfw(summary?)`；已在态内重复调用给一句说明、不改状态 | `agentkit/nsfwTool.ts` |
| 2 | 进入**立刻**广播标识（`{type:"nsfw", active:true}`），内容随后到；真值下一拍才兑现 | `orchestrator.ts:575-585` |
| 3 | 下一拍起：`nsfwActive = true`、记住起始拍号、**换模型**（`play.agents.playwriter.nsfwModel || config.nsfwModelId`）、重建 agent 为限制级模式 | `orchestrator.ts:1806-1812`、`playhouse.ts:1292-1293` |
| 4 | 限制级模式注入：`# 限制级（NSFW）创作指引` 章 + `memory/always/nsfw.md` + 配置里的 `nsfwPrompt`；**外加一对合规前置消息**（user「【设定合规说明】…年龄均在 20 周岁以上…」+ assistant 确认） | `orchestrator.ts:117-140`、`prompt.ts:445-450` |
| 5 | 期间落下的**每个谱系节点**都带 `payload.nsfw = true`（判断「哪几拍属于那一段」的唯一依据）；归档切片带 `nsfw: true`；人类转写照旧留原文 | `orchestrator.ts:2254-2260`、`:2145` |
| 6 | 退出那一拍：先出**全年龄摘要**（单独一次 completion，system = 改写为 1-3 句含蓄摘要），落进 `beat_end.payload.nsfwSummary`；再**用摘要折成的过渡轮重建 agent**（`bodyFromTree()`，模型侧看不到露骨原文）；另切一片不带标的摘要供 SFW 检索 | `orchestrator.ts:2185-2250`、`:2226` |
| 7 | 状态是**分支态**：随谱系快照走，跳出去/跳回段内时 `nsfwActive` 跟着变 | `orchestrator.ts:1613`、`:679` |

---

## 2. 插件侧的映射（逐条）

| 服务端 | 插件用什么做 | 落点 |
| --- | --- | --- |
| 换模型 | `ctx.sessionController.selectForNextRequest(agent, {provider, model, reasoningEffort})`；进入前用 `selectionFor(agent).current` **记住玩家当前的选择**，退出时切回那一个（不是插件的默认值） | `src/index.ts:64` 已 inject `sessionController`；调用点放在进入/退出那一刻（`src/stage/stage-tap.ts` 的工具回调里） |
| 限制级提示词 | `play-context.ts` 新增一段 `aivn:play-nsfw`，`text: () => 每轮现读`（照 `stagehandGuide` 的现读先例）；章节正文与合规声明**尽量与服务端同源**（写进 `packages/agent`，两边引同一份） | `src/play/play-context.ts:146-162`、`src/playwriter/prompt.ts:240-251` |
| 合规前置轮次 | 插件不塞假消息：**在进入后的第一拍用 `agent.inject` 投一条「设定合规说明」的系统/上下文消息**（`next-step` 语义，落 `agent/inbox/inserted` 并按 `message.id` 登记摘除，见 `src/injected.ts`） | `src/injected.ts:33`（按 id 摘除的现成做法） |
| 事件打标 | **独立帧** `{kind:'nsfw',active}`（值变化时推一次，重建末尾无条件补一帧）；段起止本身靠会话面里的 `tool/result` 配对重推 | `src/hub.ts`、`src/stage/stage-tap.ts`、`src/stage/stage-log.ts`、`src/client/stage-view.tsx` |
| 退出摘要 | 优先用工具参数 `summary`；没给就 `agent.followup` 单开一轮要一段（结局之后要 `epilogue` 已有先例），落 `beat_end` 载荷的 `nsfwSummary` | `followup` 先例：`src/stage/director.ts:87`、`src/routes.ts:272` |
| **模型可见面替换** | **`session.append(type, data, { surfaceOp: { op: 'replace', startSeq, endSeq } })`**——DSH 的会话面替换机制（compaction 就用它）：模型侧看到摘要，**人类转写照旧是原文**。`startSeq` = 进入那一刻的消息 seq，`endSeq` = 退出那一拍的 seq | `node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts:455-462`、`index.d.ts:219`；插件已有 `session` 句柄（`src/stage/stage-log.ts:108`） |
| 分支 / 重建恢复 | 从会话日志**重推**：`stage-log.ts` 的重建路径扫 `tool/call` 里的 `enter_nsfw` / `exit_nsfw` 与 `nsfwSummary`，恢复「当前在不在段内」；不额外落盘 | `src/stage/stage-log.ts:94-153`、`src/stage/stage-tap.ts:257-264` |
| 配置 | **零改 core**：`play.json` 的 `agents.playwriter.nsfwModel` / `nsfwThinking` / `nsfwPrompt` 已由 `@aivn/core` 解析（`packages/core/src/play/config.ts:139-164`），插件经 `src/play/play.ts:58` 已拿到 `play.config`；插件级默认写进 `src/index.ts:85-139` 的配置面 + 设置卡 | `src/index.ts:85-139`、`src/client/settings-card.tsx`、README 双语配置表 |
| 界面标识 | 左上角常驻位（`.aivn-fullscreen` 旁边）+ 帧字段驱动 | `src/client/stage-view.tsx:637-643`、`src/client/host.css:164-198` |

---

## 3. 要拍的几个决定（本稿的取舍与理由）

- **D1 · 换模型按「下一请求」生效**：`selectForNextRequest` 的语义与服务端「下一拍生效」一致——**进入那一拍仍由主模型演**（它只写到「即将发生」为止），下一拍才是限制级模型。退出同理：**退出那一拍仍由限制级模型收尾**，之后才切回。
- **D2 · 进入前记住玩家的模型选择**：退出切回的是 `selectionFor(agent).current` 记下的那一个，不是插件的默认模型；玩家在段内手动换过模型时，以退出那一刻的现值为准（**不覆盖玩家的选择**）。
- **D3 · 不按配置门控（2026-10-10 实施时改）**：原稿写的是「没配 `nsfwModel` 就不装这两个工具」，实读服务端后推翻——服务端那一位能力（`kit.ts` 的 `nsfw` 行）**没有 `needs`**，只在能力面上默认开，`nsfwModel` 没配时回落到主模型（`playhouse.ts:1292-1293`），通道照旧成立。所以插件也不门控：装了才有「切不了模型但通道还在」这条路。另外两条一并定下：
  - **只给剧作家**（`ToolSpec.playwriterOnly`）：服务端那一位 `roles: ["playwriter"]`，搭台助手不写剧情，给它两个开关没有意义；
  - **独占**（`concurrent: false`）：两头翻的是会话态、还要广播，与同样翻旗标的 `set_stage_style` 同类；它们一拍才调一次，串行没有代价。
- **D4 · 合规声明用 `inject` 一条消息**，不学服务端塞一对假 user/assistant 消息：DSH 的会话面有自己的形状，塞假助手消息会污染转写与重建；`inject` 落的是可摘除的 inserted 消息。
- **D5 · 摘要优先取工具参数**：`exit_nsfw(summary=…)` 是剧作家自己给的那一句（最懂剧情），引擎只在它缺席时补一轮；服务端是反过来（引擎必摘要、参数只当参考）——**这条差异要不要抹平，请拍板**（抹平 = 插件也无条件跑一次摘要，代价是多一次模型调用）。

---

## 4. 迁移面（要动的清单）

**工具与装配**：`src/tools/enter-nsfw.ts`、`src/tools/exit-nsfw.ts`（新）→ `src/tool-catalog.ts:53-125` 两行（含 gate）→ `src/preset-tools.ts:86-111` 装配 → `src/tools/context.ts:185-200` 扩面。
**提示词**：`src/play/play-context.ts:146-162` 新增段；`src/playwriter/prompt.ts:240-251` 的门控扩成 `{image, nsfw}`；合规声明进 `packages/agent`（与服务端同源）。
**打标**：`src/hub.ts:41-48`、`src/stage/stage-tap.ts:84-88`、`src/client/stage-view.tsx:67-77`。
**摘要与面替换**：`src/stage/stage-tap.ts`（退出那一刻的收束钩子）、`src/play/ledger.ts`（若要落账）。
**界面**：`src/client/stage-view.tsx:637-643` + `host.css:164-198`。
**恢复**：`src/stage/stage-log.ts:94-153`。
**配置与文档**：`src/index.ts:85-139`、`src/client/settings-card.tsx`、`README.md` / `README.en.md`（配置表 :82-100、工具表 :474-486）。
**e2e**：`e2e/verify-injection.mjs:151-215`（章与工具面）、`e2e/verify-settings.mjs:258,281`、`e2e/verify-media.ts:551`（遍历 TOOL_CATALOG）；新增一条 NSFW 判据（见 §6）。
**产物**：`npm run build` + 提交 `lib/`。

---

## 5. 风险

| # | 风险 | 对策 |
| --- | --- | --- |
| R1 | `selectForNextRequest` 的实际生效时机与并发（两轮重叠、玩家同时手动换模型） | 先写一条最小 e2e 判据钉住「进入后下一拍的模型确实是 nsfwModel」；退出切回用记下的选择 |
| R2 | 面替换的边界算错：藏多了（把日常也藏了）或藏少了（露骨原文仍进主模型上下文） | 判据直接比对**替换前后的模型可见面**（`session` 的 surface 折叠），不看转写 |
| R3 | `enter_nsfw` / `exit_nsfw` 的工具调用在会话日志里的形态（`tool/call` 的字段）与重建路径的兼容 | 先在 `e2e/run.mjs rebuild` 那条**不需要实例**的套件里补一条重建判据 |
| R4 | 合规声明注入后进了人类转写 | 用 `injected.ts` 的按 id 摘除（现成机制） |
| R5 | 段内「在新对话中分支」/ 冷启动后状态错 | 重建判据覆盖三种：段内重建、段后重建、切到段外的枝 |

---

## 6. 验收判据（可检查）

1. **工具面**：剧作家装 `enter_nsfw` / `exit_nsfw`，搭台助手不装；不按配置门控（模型没配时回落主模型）；
2. **换模型**：`enter_nsfw` 之后的下一拍，实际请求用的是配置里的限制级模型；`exit_nsfw` 之后切回**进入前的那一个**；
3. **提示词**：进入后的系统提示词含限制级章 + 合规声明；退出后不再含；
4. **面替换**：退出后**模型可见面**里已无露骨原文（只剩摘要），而**人类转写**照旧含原文；
5. **打标与标识**：段内每帧带 `nsfw`，左上角标识亮/灭与段起止一致；
6. **重建**：段内冷启动重建 → 仍是限制级态且模型是 nsfwModel；段后重建 → 已退出；跳到段外的枝 → 标识灭。

---

## 7. 实施顺序（每步单独可验证）

1. **工具 + 门控 + 打标 + 标识**（不换模型、不替换面）：先把「通道存在」跑通，e2e 判据 1/5 绿；
2. **换模型**（记住/切回）：判据 2 绿；
3. **提示词与合规声明**：判据 3 绿；
4. **摘要 + 模型可见面替换**：判据 4 绿（这条最贵，单独一步）；
5. **重建恢复**：判据 6 绿（rebuild 套件）；
6. **配置面 + README 双语 + e2e 全量 + `lib/` 重建**；
7. **reviewer 检视 + 落地 main**。

---

## 8. 实施进度

### 第 1 步 · 工具 + 门控 + 打标 + 标识 —— **已完成**（2026-10-10，插件 worktree `326840a` 之后）

落地：`src/tools/enter-nsfw.ts` / `exit-nsfw.ts`（描述逐字照服务端）、`tools/context.ts` 的
`NsfwControl` / `NsfwHost`、`tool-catalog.ts` 两行（`playwriterOnly` + 独占）、`preset-tools.ts`
按预设过滤、`stage-tap.ts` 的 per-session 态（`active || pendingEnter` 口径、值变才推帧）、
`hub.ts` 新帧、`stage-log.ts` 从 `tool/result` 配对重推、客户端角标 + 样式。

**验证**：`npm run typecheck` ✓、`npm run build` ✓、`node build.mjs --check` 产物一致 ✓、
`node e2e/run.mjs rebuild` **17/17** ✓——其中 R14–R16 是这一步新加的三条永久判据
（段内重建要亮、出了段要灭、被回退抹掉的调用不算数）。这一步**不需要实例、不花 LLM**。

**顺带修的环境问题**：插件 worktree 的 `node_modules/@deepseek-ai/` 缺 `dsh-scope`（主检出不缺），
`rebuild` 套件因此 import 期就炸；补软链即可（node_modules 不入库）。

### 第 2 步 · 换模型 —— **已完成**（同一 worktree，接在第 1 步之后）

- **读选择**：`sessionController.projections({sessionId}, signal)` 的 `modelSelection.next ?? lastUsed`
  （公开投影）。**换模型**：`sessionController.selectModel({sessionId, provider, model, reasoningEffort?})`
  ——GUI 里手动换模型走的就是这一条。原稿写的 `selectForNextRequest` / `selectionFor` 在
  `ApiSessionAgentController` 上，公开的 `sessionController` 服务类型里**没有**它们（只有内部类有），
  所以改用公开面（本稿 §2 那一行随之作废）。
- **模型 id 解析**：`agents.playwriter.nsfwModel` 两种写法都收——`provider/model` 直接拆；光一个 id 就去
  `ctx.llm.listProviders()` × `listModels()` 里找。找不到**出声告警**并继续用主模型（通道照旧，
  与服务端没配 `nsfwModel` 时的行为一致）。`nsfwThinking` → `reasoningEffort`（`default` 等于不指定）。
- **时机**：切换放在**两拍之间**（这一拍收完、下一拍还没开笔）。`selectModel` 是异步的，放这里就与下一拍
  的提示词装配没有竞态；要问 provider 目录的解析再提前到工具那一拍（`enter` 是异步工具）。
- **回路**：换之前读到的现值记成「回来的位置」；**段内重建**时改用日志里**进段之前**那条
  `model/selection`（冷开时现值可能就是限制级模型本身，认不出来）。
- 同一拍里既进又退（模型自己写反）不换：这个通道从头到尾没真开过。

**验证**：`typecheck` ✓；`node e2e/run.mjs rebuild` **18/18** ✓（新增 R17：段内重建要记住进段前的主模型）。
「真的换过去了没有」要真实例才验得了，留给第 7 步的 e2e 判据（§6 判据 2）。

### 第 3 步 · 限制级提示词章与合规声明 —— **已完成**

- 两段正文写进 `src/playwriter/prompt.ts`（`nsfwEntryPointer` / `nsfwGuidance`），与服务端
  `prompt.ts` 那两段**逐字同源**：没进通道时给入口指针（教它什么时候调 `enter_nsfw`），
  开着时给创作指引 +（有的话）剧目自己的 `memory/always/nsfw.md` 与 `agents.playwriter.nsfwPrompt`。
- 挂成 `aivn:play-nsfw` 段（order 210，尾段之后），`text: () =>` **逐轮现读**通道现值，所以中途
  进出会立刻换文本。快照多了 `nsfwMemory` / `nsfwPrompt` 两格（跟着 A 区那份 TTL 缓存走）。
- **指令面联动**：这两位被用户在配置里禁掉时，连入口指针也不出现（提示词不能教一个不存在的工具），
  判据取的是工具面那份过滤的同一条（`disabled.has('enter_nsfw')`）。
- **合规声明**（D4 落地）：`NSFW_COMPLIANCE` 一条，在这一段第一次开笔时用 `agent.inject` 投
  （`next-step`、整批认领，与开局指令同一条路），并登记进 `injected`——玩家台词条上不该出现
  一句他没说过的话。同一段只投一次，退出时清标记，下次进来再投。**与服务端的差异**：服务端塞的是
  一对假 user/assistant（声明 + 确认），插件只投声明那一条（D4 的取舍，见 §3）。

**验证**：`typecheck` ✓；一次性探针（不入库、不起实例）**8/8**——`nsfw.md` / `nsfwPrompt` 进快照、
入口指针与指引互不串味、没有 `nsfw.md` 时不出现空章。注入套件新增判据 **A14c**（没进通道时只有入口
指针、不泄漏通道内指引）；**它还等着跑**：本机可用内存只剩 1.3 GB，起实例 + 浏览器会打爆，留到第 7 步
与其余 e2e 一起跑一次。

### 第 4 步 · 退出摘要 + 模型可见面替换 —— **已完成**

- **摘要**（D5 按 A 落）：剧作家在 `exit_nsfw(summary=…)` 给的那句当**参考**；这一段有台词时用
  **主模型**跑一次一次性补全（`ctx.llm.stream` + 与服务端同源的 SFW 系统提示），没有台词就直接用
  参考、再退到兜底句——没有原文可改写时不再花一次模型调用。失败只告警并退到参考/兜底（服务端同款）。
- **折叠**：走 DSH 的会话面替换 `surfaceOp: { op: 'replace', startSeq, endSeq }`（与导演重写同一条路），
  标记消息的来源种类用自定义的 `dsh-aivn-nsfw-fold`（**不是** `user`）——模型此后只看得到那句摘要。
- **人类那一侧照旧**（这一步最容易漏的一条）：DSH 的面替换是**模型侧**机制，而插件的舞台本来就是
  会话面的投影——只认面的话，冷开 / 分支之后这一段就从舞台上消失了。所以重建帧流时认出折叠标记、
  把被挡掉的原文**渲回去**；判据是来源种类，与导演重写那种「真该藏」的替换区分开。
- 顺序：先切回主模型（摘要要用主模型写）→ 生成摘要 → 折叠。
- 共用的那一点（来源种类 + 标记正文）单独放 `src/stage/nsfw.ts`：写（`stage-tap`）读（`stage-log`）
  两侧必须认同一份。

**验证**：`typecheck` / `build` / `build.mjs --check` 全绿；`node e2e/run.mjs rebuild` **20/20**
（新增 R18 折叠之后原文照渲、R19 标记不被念成玩家台词）。「模型真的只看得到摘要」要真实例 + 真模型，
留第 7 步。

### 第 6 步 · 配置面与 README 双语 —— **已完成**

- **插件级两格**（`src/index.ts` 的 `Config`）：`nsfwModel`（限制级专用模型，`provider/model`
  最稳，光一个 id 去已注册的 provider 里找）与 `nsfwPrompt`（补充提示词）。**逐剧目那份
  `play.json` 优先**，插件配置只当缺省——与服务端「play 覆盖实例配置」同一个次序。
- 接线：`nsfwModel` 走 `installStageTap(..., {nsfwModel: () => config.nsfwModel.get()})`（getter，
  配置可改）；`nsfwPrompt` 进 `Runtime` → `play-context` 的 `readPlaySnapshot(dir, canImage, default)`
  第三参。另把「解析不出模型」由**缓存 null** 改成**不缓存**：先把模型配好再进通道、进过一次再配好，
  两条路都能生效。
- 设置卡两格（P1 组，text）；README 中文 + 英文：配置表加两行、字段数 19 → 21、配置示例加两行、
  新增「限制级（NSFW）通道」一节（含「模型只看得到摘要、人类这边什么都不藏」这句）、
  上下文注入表加一行、工具表加 `enter_nsfw` / `exit_nsfw` 两行、独占那句改成「`set_stage_style`
  与限制级那两位」。
- e2e 的设置套件断言逐字段（S5–S8），不枚举全部字段，所以新增两格不需要改它。

**验证**：`typecheck` / `build` / `build.mjs --check` 全绿；`rebuild` 20/20；
一次**不入库**的探针验了配置次序 **3/3**（play.json 没配 → 插件缺省；配了 → 以它为准；
插件没配 → 仍以 play.json 为准）。

### 待办

第 7 步 e2e 全量（含 A14c）+ reviewer 检视 + 落地（插件侧还卡在主检出那份未提交的 `lib/index.js`）。
