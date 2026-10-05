# 检视报告

## 概要

本次改动针对停止点玩家输入「回声」机制（乐观本地状态）存在的状态冻结、虚假回声与窗口期丢失等固有缺陷，执行了「玩家输入升格为一等舞台事件（`player_input`）」的重构。涉及 core 协议与重放、server 编排管道、web 舞台事件消费与会话记录全链路。整体架构设计方向正确，成功消除了脆弱的回声补丁层与重复拼串逻辑；但在客户端回执起播逻辑（`shouldAutoStart`）中存在阻塞级时序与交互缺陷，导致 pre-`beat_start` 窗口与 Auto 模式下回执无法即时呈现。

## 需求对齐

- **满足项**：
  - `core`：`StageEvent` 联合类型成功扩充 `{ kind: "player_input"; text }`；`lineageToEvents` 规范重放 prompt 节点，`toNodeView` 正确暴露 `seq`。
  - `server`：`orchestrator.ts` 中 `playerAction` 统一经 `onStageEvent` 广播并携带 `seq` 落谱系；`noteBeatInputs` 在事件广播前正确设置 `beatNsfw`，限制级打标语义与原路径一致。
  - `web`：彻底清除了 `playerEcho`、`afterKey`、`dismissEcho`、`dialogContent` 特权分支与相关 props；`transcript.ts` 支持缓冲行即时呈现与基于 `seq` / 文本位置去重。
- **偏离/遗漏项**：
  - 核心交互不变量要求「选完选项立刻看见回执」。服务端刻意在 `beat_start` 之前先下发 `player_input`，但客户端 `shouldAutoStart` 将 `live`（一拍生成中）和 `!auto`（非自动模式）作为硬性门禁，导致该时序优化在客户端完全失效，Auto 模式下更引入长达 2~3 秒的回执迟滞。

## 阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| BLK-01 | `apps/web/src/stage/playbackState.ts:73-79`<br>`apps/web/src/stage/director.ts:708-726` | **`shouldAutoStart` 门禁缺陷导致回执无法在 `beat_start` 前即时显示，且在 Auto 模式下严重迟滞**：<br>1. 服务端设计在 `beat_start` 广播前先广播 `player_input` 事件（见 `orchestrator.test.ts:164`）。但客户端收到事件时 `stage.state` 仍为 `"stopped"`（`live: false`），`shouldAutoStart` 首行 `if (!input.live ...)` 直接截断，导致回执行无法起播；同时由于未消费 cue 使 `playback.exhausted` 变假，停止点面板消失，对话框却仍停留在前一句台词，遇纪元压缩或网络延迟时界面假死无反馈。<br>2. 玩家开启 Auto 模式时，`input.auto` 为真同样使 `shouldAutoStart` 拒不起播；回执行只能等待 Auto 模式计时器延迟（`900 + current.text.length * 55`，可达 3.2 秒）才显示，严重破坏「选完立刻可见」的核心体验。<br>测试 `playerReceipt.test.tsx:69` 人为同时传入了 `live={true}`，掩盖了真实线上环境 `player_input` 先于 `beat_start` 到达的时序。 | 将 `nextIsPlayerInput` 的起播逻辑与 LLM 生成状态解耦：玩家回执是已由服务端接受并落入缓冲的既有事实，不受 `live` 和 `auto` 限制：<br>```typescript<br>export function shouldAutoStart(input: AutoStartInput): boolean {<br>  if (input.hold) return false;<br>  if (input.nextIsPlayerInput) {<br>    return (!input.hasCurrent \|\| input.currentComplete) && input.cursor < input.cueCount;<br>  }<br>  if (!input.live \|\| input.auto) return false;<br>  return !input.hasCurrent && input.cursor < input.cueCount;<br>}<br>```<br>并在 `playerReceipt.test.tsx` 补充两组测试：`live: false` 时的即刻消费，以及 `auto: true` 时不受延迟阻塞的即刻消费。 |

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-01 | `apps/web/src/stage/transcript.ts:102-106` | **`fromView` 中 `unmatchedInputs` 未在 `seq` 命中时及时移除，存在二次认领产生重复 key 的风险**：<br>遍历路线树节点时，当 prompt 节点的 `seq` 命中了 `lineBySeq`，该 `line` 并未从备用池 `unmatchedInputs` 中剔除。若后续链路上存在无 `seq` 的老档 prompt 节点且具有相同文本，会再次从 `unmatchedInputs` 认领同一条 `line`，造成两条会话记录复用同一个 `line.key`。 | 在 `line = lineBySeq.get(node.seq)` 命中时，同步将其从 `unmatchedInputs` 中剔除：<br>```typescript<br>let line = node.seq === undefined ? undefined : lineBySeq.get(node.seq);<br>if (line) {<br>  const at = unmatchedInputs.indexOf(line);<br>  if (at >= 0) unmatchedInputs.splice(at, 1);<br>} else {<br>  const at = unmatchedInputs.findIndex((candidate) => candidate.text === text);<br>  if (at >= 0) line = unmatchedInputs.splice(at, 1)[0];<br>}<br>``` |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| NT-01 | `apps/web/src/stage/transcript.ts:18`<br>`apps/web/src/stage/beats.ts:243` | **注释陈旧漂移**：`transcript.ts:18` 注释仍保留「玩家输入没有 seq」；`beats.ts:243` 仍写着「回看游标可能停在玩家发来的那句话上（它没有 seq）」。重构后现代谱系节点的 prompt 和 input 行均已携带 `seq`。 | 更新注释，明确说明新事件管道下输入均带 `seq`，仅老档历史为 `undefined`/`null`。 |
| NT-02 | `apps/web/src/stage/director.ts:347-368` | **`lineEntry` 兜底生成未复制 `nameOverride`**：在谱系未追上缓冲时，`director.ts` 的 `lineEntry` 未保留 `line.nameOverride`，而 `transcript.ts` 的 `fromLine` 正确保留。存在瞬态名牌闪烁的微弱潜在不一致。 | 在 `lineEntry` 中补齐 `...(line.nameOverride ? { nameOverride: line.nameOverride } : {})`。 |
| NT-03 | `packages/core/src/dsl/events.ts:46` | **事件载荷未来扩展性**：`player_input` 目前为 `{ kind: "player_input"; text: string }`，若后续多周目或角色切换引入玩家身份/情绪，缺少额外 metadata 字段。 | 当前设计满足实用主义原则，无需过度设计；后续有需求时再扩展即可。 |

## 准入结论（初审）

**结论**：`不准入`

**说明**：将玩家输入升格为舞台事件的架构演进清晰、彻底根除了回声三层补丁的历史包袱，但客户端起播控制（`shouldAutoStart`）中遗留的 `live` 与 `auto` 条件打破了服务端精心设计的时序优势，在 Auto 模式及纪元压缩窗口期会引发明显的回执缺失与迟滞问题，须修复 BLK-01 并补全测试后准入。

---

## 复审

### 复审范围与处理核验

开发团队针对初审报告提出的各项问题完成全量修复，并自查解决了 1 处同源衍生回归。逐项核验结果如下：

1. **BLK-01（`shouldAutoStart` 门禁与时序解耦）——已彻底解决**：
   - `apps/web/src/stage/playbackState.ts:75-82` 按建议实现解耦：
     ```typescript
     export function shouldAutoStart(input: AutoStartInput): boolean {
       if (input.hold) return false;
       if (input.nextIsPlayerInput) {
         return (!input.hasCurrent || input.currentComplete) && input.cursor < input.cueCount;
       }
       if (!input.live || input.auto) return false;
       return !input.hasCurrent && input.cursor < input.cueCount;
     }
     ```
   - **时序与边界复核**：
     - **Pre-`beat_start` 窗口**：服务端 `player_input` 到达时 `stage.state` 为 `"stopped"`，此时 `nextIsPlayerInput` 为真、`currentComplete` 为真，`shouldAutoStart` 立即放行；80ms 定时器触发 `consumeNext` 完成回执显示。即使服务端紧接着执行纪元压缩（`maybeCompactEpoch`）或遭遇网络时延，用户界面也能在毫秒级内看到自己的选择回执，不出现停滞假死。
     - **Auto 模式定时器竞争**：在自动模式下，输入到达后虽然 Auto 自身的长延时 effect（1.3s~3.2s）亦会挂起，但 80ms 的起播定时器率先触发 `consumeNext`，立即更新 `current` 为 input 行并置 `shownLength` 为全长。这促使组件 re-render 并清除了旧有的长延时计时器；随后 Auto 模式以回执自身的较短长度（`900 + len*55`）平滑过渡到下一句，完美兼顾了「回执即时呈现」与「阅读回执后自动推进」。
     - **Hold / 多端同看约束**：`hold` 维持一票否决权，语音未完不强推；`(!input.hasCurrent || input.currentComplete)` 守卫确保了在多端同步且本端尚未读完上一句时，不被抢占阅读节奏。
   - **测试覆盖**：
     - `playerReceipt.test.tsx` 重构为真实时序：回执行入队时维持 `live: false` 断言 250ms 内消费；新增 Auto 模式用例，断言同样在 250ms 内消费，证明未走 1.3s 延迟分支。
     - `playbackState.test.ts` 补齐了 `live=false`、`auto=true`、`hold=true`、`!hasCurrent` 等多组精确单测。

2. **SUG-01（`transcript.ts` 中 `unmatchedInputs` 二次匹配去重）——已解决**：
   - `apps/web/src/stage/transcript.ts:103-108` 在 `node.seq` 命中 `lineBySeq` 时，同步执行 `const at = unmatchedInputs.indexOf(line); if (at >= 0) unmatchedInputs.splice(at, 1);`，彻底阻断了后序无 `seq` 节点对已认领行借用 key 的路径。
   - `transcript.test.ts` 新增「seq 认回的行及时移出兜底池」单测，断言全表 key 唯一性且两处同文本输入均正确收录。

3. **自查缺陷修复（`beats.ts:beatAtLine` 对 input 行的守卫）——核验通过**：
   - **问题根因**：老架构下 prompt 节点的 `seq` 恒为 `null`，`beatAtLine` 依赖 `line.seq == null` 隐式返回 `null`；新架构下 input 行被赋予了合法 `seq`，排在两轮边界之间时会误命名前一拍（`startSeq <= at`），导致回顾工具栏与舞台右上角的「重写」等原语按钮在查看玩家输入时错误点亮。
   - **修复与调用面**：在 `apps/web/src/stage/beats.ts:248-250` 中添加 `line.kind === "input" -> null` 显式守卫。调用方 `StageScreen.tsx:414`（舞台目标反查）与 `:424`（回顾列表每项轮锚定）均传递 `TranscriptEntry`，属性 `kind` 完整对齐；在 `apps/web/test/directorTargets.test.ts` 中补充了针对性断言，相邻正常台词行未受影响。

4. **NT-01 与 NT-02——已解决**：
   - `transcript.ts:17-18` 与 `beats.ts:243-244` 注释已修正，准确描述带 `seq` 的新事件模型。
   - `director.ts:379` 的 `lineEntry` 补齐了 `...(line.nameOverride ? { nameOverride: line.nameOverride } : {})`，消除了潜在的名牌瞬态闪烁差异。

### 综合评价

经过本轮修正，回执即时起播的核心交互不变量在全场景下（常规模式、Auto 模式、弱网与长纪元压缩、多端同看）均得到了坚实保障，边界防御严密；对历史老档的兼容机制与会话记录的去重稳健可靠；测试用例真实反映了生产 WS 时序。代码已具备生产级交付质量。

## 准入结论（复审）

**结论**：`准入`

**说明**：阻塞问题（BLK-01）与建议项（SUG-01）均已高质量修复，自查同源缺陷处理到位，单元测试与类型检查全绿，符合合并准入标准。
