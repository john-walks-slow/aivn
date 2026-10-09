# 检视报告 · DSH 插件补限制级（NSFW）通道

## 准入结论

**结论**：`条件准入`

**说明**：通道整体架构与服务端参考实现高度同形，状态闭环完备，重放/重建/回退与模型可见面折叠的设计非常精巧。但存在 3 处需在合并/后续处理的建议缺陷（冷开段内重建切回主模型实参漏传、段内冷开重建后再退出时合规声明被当作玩家输入泄漏、折叠区间起点可能多圈入进段前的最后一条历史消息），无导致系统崩溃或不可逆损坏的阻塞级硬伤。

---

## 需求对齐

检视范围对应 `feat/shared-aivn-core` 分支在 `master..HEAD` 的全部 6 笔提交（`326840a` ~ `bfbe0e0`），完整对应设计稿 `261010-p7-plugin-nsfw.design.md` 中的 6 个实施步骤：
1. **语义对齐**：进入（当前拍亮标、下一拍切限制级模型、首拍补合规声明）与退出（当前拍仍演出限制级正文、轮尾合闸、切回主模型、生成 SFW 摘要并折叠面）与服务端参考实现口径完全一致。
2. **取舍落地**：D1（下一拍切模型）、D2（退出切回原模型）、D3（非配置硬门控、仅剧作家独占）、D4（`inject` 单条合规声明并登记摘除）、D5（主模型异步改写摘要，参数做参考）均正确实现。
3. **配置与资产**：双语 README、`settings-card`、`play.json` 覆盖及插件缺省级配置均已落地。

---

## 阻塞问题

无。

---

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S-01 | `src/index.ts:267` | **段内冷开重建后退出切不回主模型（参数缺失）**：`stage-log.ts:223` 触发 `deps.onNsfw?.(sessionId, nsfw, nsfw ? (mainBeforeEnter ?? undefined) : undefined)` 时传了第三个参数（进段前的主模型）；但在 `src/index.ts:267` 构造 `StageLog` 时的接线写的是 `onNsfw: (sessionId, active) => tap.noteNsfw(sessionId, active)`，漏传了第三参 `main`。导致 `tap.noteNsfw` 里的 `if (active && main) state.remembered = main;` 中 `main` 永远为 `undefined`。冷开或刷新进入段内的会话，退出时 `state.remembered` 为空，无法切回进段前的主模型。 | 修改 `src/index.ts:267` 为 `onNsfw: (sessionId, active, main) => tap.noteNsfw(sessionId, active, main)`。 |
| S-02 | `src/stage/stage-tap.ts:426` | **面替换折叠区间可能多圈入进段前的历史消息**：在 `onStatus` 中 `state.startSeq = attachedAgent(ctx, sessionId)?.session?.surface.nodes.at(-1);` 发生在进入后的第一拍 `status === 'running'` 时。此时会话面尾部节点 `at(-1)` 实际上是**进入前那一轮（或者触发进段的那一条玩家输入/开局指令）**。后续 `foldSegment` 执行 `shadowed = nodes.slice(at); endSeq = shadowed[shadowed.length - 1];` 时，会把这个 `at(-1)` 节点也一并包含进替换范围 `[startSeq, endSeq]` 被折叠掉。若进段前最后一条是普通剧情的助手台词或玩家输入，它在模型可见面会被误折。 | 进段时 `startSeq` 应该定位到限制级段落的第一个实际节点（例如进段首拍产生的第一个 assistant/user 节点，或记录进段前的末尾节点并在 `foldSegment` 时用 `at + 1` 作为 `shadowed` 起点）。建议比对 `shadowed = nodes.slice(at + 1)` 并校验 `at + 1 < nodes.length`。 |
| S-03 | `src/stage/stage-tap.ts:179-182` 与 `src/stage/stage-log.ts:212` | **段内冷开重建后再退出时，合规声明会泄漏上台成为玩家台词**：冷启动或分支时，内存中的 `InjectedMessages` 针对该会话是空的；若冷开后处于段内并继续演出，后续调用重投影（如导演改写或 rewind）时，`stage-log.ts:212` 仅依赖 `injected.claim(sessionId, message.id)` 摘除引擎消息。但冷开会话中此前由 `injectCompliance` 注入的合规声明消息的 `source.kind` 为 `'user'`，内存登记一旦因进程重启或冷开缺失，该消息就会通过 `message.source.kind === 'user'` 校验被作为 `player_input` 重新摆上舞台台词条。 | 合规声明注入消息时使用自定义 source kind（例如 `source: { kind: 'dsh-aivn-nsfw-compliance' }`，参考 `NSFW_FOLD_KIND` 和 `DIRECTOR_KIND` 的做法），这样即使冷会话内存中没有 `injected` 登记，`stage-log.ts:213`（`message.source.kind !== 'user'`）也会自然将其过滤，不污染玩家台词。 |

---

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | `src/stage/stage-log.ts:54-60` | **时间旅行事件过滤未排除 NSFW 折叠事件**：`isTimeTravel` 过滤了 `compact-checkpoint`，但未显式排除 `NSFW_FOLD_KIND`。虽然 `NSFW_FOLD_KIND` 的 `source.kind` 不是 `'user'`（`source.kind === 'dsh-aivn-nsfw-fold'`），`event.type !== 'user/message'` 为 false，但由于 `event.data.source.kind !== 'compact-checkpoint'`，如果将来某些逻辑将 `source.kind` 作为可扩展来源匹配，建议在此明确注释或严格判定。 | 目前依赖 `event.data.source.kind !== 'compact-checkpoint'` 实际上会将折叠事件触发一次 `rebuild`。实测折叠触发重建是无害且可将折叠原文照渲的机制，但可在 `isTimeTravel` 注释中明确记录「NSFW 折叠也触发重投影以确保舞台视图同步」的原因。 |
| N-02 | `src/stage/stage-tap.ts:432` | **同一拍既进又退的边缘状态重置**：`if (state.pendingEnter && !state.pendingExit && !state.active) void switchToNsfw(...)` 正确阻止了同一拍既进又退时的模型切换；随后 `state.pendingExit` 分支会重置状态并调用 `closeSegment`。但此时段落内可能没有有效 `startSeq`，`foldSegment` 会静默跳过，逻辑自洽，惟注释可简要补充此场景行为。 | 保持现状即可，代码已有健壮防卫。 |
| N-03 | `src/preset-tools.ts:288` | **工具禁用配置联动仅检查了 `enter_nsfw`**：`available: () => !disabled.has('enter_nsfw')`。若用户单独在配置中禁用了 `exit_nsfw` 而未禁用 `enter_nsfw`，通道仍可进入但模型无法调用退出工具。 | 属于极端非典型配置，建议在文档中说明 `enter_nsfw` 与 `exit_nsfw` 须成对启用/禁用，或者判断中写为 `!disabled.has('enter_nsfw') && !disabled.has('exit_nsfw')`。 |

---

## 判据有效性

### 1. `e2e/verify-rebuild.ts`（R14–R19）
- **R14（段内重建：进了没退 → 标识亮）**：**真实锁住**。用真实伪造日志（`enter_nsfw` 结果在面上）驱动真实 `rebuildStage`，断言 `hub.history` 包含 `{ kind: 'nsfw', active: true }`。
- **R15（出了段重建：进了又退 → 标识灭）**：**真实锁住**。验证了 `enter_nsfw` 与 `exit_nsfw` 配对时，最终输出 `{ kind: 'nsfw', active: false }`。
- **R16（回退抹掉的调用不算数：结果不在面上 → 标识不亮）**：**真实锁住**。精准模拟了 `tool/call` 在日志中但 `tool/result` 不在 `session.surface.nodes` 里的场景，确保未生效的调用不被重推为激活。
- **R17（段内重建记住进段前的主模型）**：**真实锁住**。测试了从日志中提取进入前最后一条 `model/selection` 的推导机制（返回 `cpa/main-model`）。但**请注意**：此判据只测试了 `rebuildStage` 的回调抛出，因夹具自身直调了回调，未能暴露上述 S-01（`src/index.ts:267` 包装层漏透传参数）的集成缺陷。
- **R18（折叠之后重建：被折叠的那一拍照旧演出来）**：**真实锁住**。构造包含 `surfaceOp: { op: 'replace' }` 和 `source.kind: 'dsh-aivn-nsfw-fold'` 的伪造日志，断言 `rebuildStage` 将被折叠遮挡的台词重新发回舞台 IR。
- **R19（折叠标记不会被念成玩家台词）**：**真实锁住**。断言 `foldInputs` 不含 `已收束为剧情摘要`，锁住了折叠标记不作为玩家输入广播的语义。

### 2. `e2e/verify-injection.mjs`（A14c）
- **A14c（没进通道时只有入口指针，不泄漏通道内指引）**：**真实锁住**。在剧作家系统提示词断言中，核验包含 `## 亲密/限制级剧情入口（enter_nsfw）` 且不包含 `限制级（NSFW）创作指引`，确保了普通日常模式下限制级指引的严格隔离。

### 3. 当前缺失的判据
1. **实机切模型生效判据（设计稿 §6 判据 2）**：目前仅有静态与转写测试，缺乏在 live agent 实例上断言 `sessionController.selectModel` 真正使底层 `agent/request` 切换到 `nsfwModel`，以及退出时切回原模型的端到端用例（待第 7 步 e2e 实例就位后补齐）。
2. **段内冷开后再退出的回归判据**：缺少「冷开进入段内（此时没有内存中的 `injected` 表）→ 跑一轮并调用 `exit_nsfw` → 触发重投影」的链路判据，因此 S-01 与 S-03 在单元/转写级未被检出。

---

## 处置（作者回复，2026-10-10）

| ID | 处置 | 落点 |
| --- | --- | --- |
| S-01 | **已修**：接线改成 `onNsfw: (sessionId, active, main) => tap.noteNsfw(sessionId, active, main)`；另加一条**静态锚点**判据 R23 盯住这次接线（重放判据照不到包装层，夹具直调回调）。 | `src/index.ts`、`e2e/verify-rebuild.ts` R23 |
| S-02 | **已修**：折叠区间的起点抽成 `foldRangeStart(nodes, boundary)`，语义是「边界那一条的下一条」；`foldSegment` 用它并加了越界判断（这一段没有产出 → 不折）。判据 R20–R22 锁住三种情形（正常 / 边界即末尾 / 边界已被抹掉）。 | `src/stage/nsfw.ts`、`src/stage/stage-tap.ts`、`e2e/verify-rebuild.ts` R20–R22 |
| S-03 | **已修**：合规声明改用自定义来源种类 `dsh-aivn-nsfw-compliance`（照 `NSFW_FOLD_KIND` 的做法），重建那条「玩家说过的话才上时间线」会自然滤掉它，不再依赖内存里那份 `injected` 登记。 | `src/stage/nsfw.ts`、`src/stage/stage-tap.ts` |
| N-01 | 保持现状：折叠事件确实会触发一次重投影，而那次重投影正是「把折叠原文照渲回去」的路径——已在 `stage-log` 相应位置补了说明。 | `src/stage/stage-log.ts` |
| N-02 | 保持现状：注释已补「同一拍既进又退不换模型、这一段没有区间可折」这条行为。 | `src/stage/stage-tap.ts` |
| N-03 | **已修**：`available` 改成两位成对看（只禁掉其中一个也整段不提）。 | `src/preset-tools.ts` |

**仍缺的判据**（检视指出，认账）：①实机切模型生效（`selectModel` 真的换了请求用的模型、退出切回）
——要 e2e 实例 + 真模型，留最后一次 e2e 跑；②段内冷开后再退出的整链路——目前只锁住了它的两个
构成部分（R17 记住主模型、R23 接线透传、R14 段内重建亮），整链路同样留给实例跑。
