# 工坊线程上下文压缩

> **状态**：待对齐
> **范围**：`apps/server`（compaction / workshop / workshopThreads / workshopSession / playhouse）+ `packages/core` 协议 + `apps/web` 对话流一条分隔线
> **前置**：[compaction.ts](../../apps/server/src/compaction.ts) 的纪元压缩（演出侧，2026-09-28 MVP 交付）已在册，本需求是同一套治理在工坊侧的落地

---

## 0. 现状（调研结论）

### 工坊现在怎么跑一轮

[workshopSession.ts:126](../../apps/server/src/workshopSession.ts#L126) `chat()` → [workshop.ts:185](../../apps/server/src/workshop.ts#L185) `runWorkshopTurn()`：

1. 读线程全部历史（[workshopThreads.ts:38](../../apps/server/src/workshopThreads.ts#L38) `messages()`，`JSON.parse` 整个文件，无上限）；
2. `historyToMessages` 全量转成 `AgentMessage` 塞进 `initialState.messages`；
3. **每轮新建 Agent、跑完即弃**——工坊没有常驻对话体，也没有 B 区；
4. 只回灌 user/assistant 文本，工具调用历史不重放（跑完就丢）。

全链路无 token 计量、无截断、无摘要。线程聊长了直接顶爆窗口（`STAGE_CONTEXT_WINDOW`，默认 131072）报 400。

### 演出侧已经有的那套

[orchestrator.ts:1169](../../apps/server/src/orchestrator.ts#L1169) `maybeCompactEpoch()`，在每轮开跑前触发：

- `measureContext` 计量——触发判定与切尾点**同一把尺子**，系数由 provider 实测 usage 标定（[compaction.ts:49](../../apps/server/src/compaction.ts#L49)，中文下 chars/4 会低估 4 倍，2026-09-30 检视 BLK-02 修的）；
- `pickCutIndex` 取切点，落点必须是 `user` 消息；
- `renderTranscript` + `completeText` + `splitSummary` 自生成摘要（不用 pi 的 `compact()`，它绑死 pi session 的 `Entry[]`）；
- 摘要落 `memory/arcs` 一张卡，重建 Agent，seed 并进保留段第一条 user 消息。

### 三处不能照搬的差异

| | 演出侧 | 工坊侧 | 结论 |
|---|---|---|---|
| 计量标定 | 消息里带 provider usage，可就地算 scale | 持久化的 `WorkshopMessage` 只有 text/images，无 usage | 得把上一轮的 usage 标定系数存到线程上 |
| 摘要去处 | `memory/arcs` 卡片（剧目事实，剧作家每轮注入） | 工坊会话是**搭台过程**，不是剧目事实 | 落线程元数据，不进 memory（进了会污染 A 区） |
| 人的可见性 | 玩家看不到压缩 | 用户眼前就是一屏聊天记录 | 原文一条都不能少，压缩只发生在模型侧 |

顺带：[workshopThreads.ts:22](../../apps/server/src/workshopThreads.ts#L22) 的 `WorkshopThread.summary` 注释写着「归档时生成」，实际从没写过（只在 [workshopSession.ts:288](../../apps/server/src/workshopSession.ts#L288) 透传）。本需求把它用起来。

---

## 1. 设计决定

1. **消息文件一条不删。** 压缩不重写 `<threadId>.json`，只在 `threads.json` 的线程元数据上推进 `cutAt`——前 `cutAt` 条原文永远留在文件里、永远渲染在用户眼前，只是不再进 agent 的上下文。切点下标从文件头数，`append` 只在尾部追加，天然稳定。
2. **摘要落线程，不落 memory。** `compaction: {at, cutAt, oneLiner, body, epochs}` 存 `threads.json`；`summary` 字段镜像最新一句话摘要，供线程列表展示。
3. **摘要回注 A 区，不并进首条 user 消息。** 演出侧并进 user 是为了保住纪元内的 KV 前缀缓存；工坊的 A 区本来就每轮重建（文件清单 + 就绪状态），没有这个约束，放 A 区还不依赖切点落在哪条消息上。
4. **工坊的压缩参数单独一套 env，缺省沿用全局。** 工坊模型可与剧作家不同（[playhouse.ts:799](../../apps/server/src/playhouse.ts#L799)），窗口不等时用同一套阈值压会算错。新增三个键，不设就等于全局同名项：

   | env | 缺省 |
   |---|---|
   | `STAGE_WORKSHOP_CONTEXT_WINDOW` | `STAGE_CONTEXT_WINDOW` |
   | `STAGE_WORKSHOP_COMPACT_RATIO` | `STAGE_COMPACT_RATIO` |
   | `STAGE_WORKSHOP_KEEP_RECENT_TOKENS` | `STAGE_KEEP_RECENT_TOKENS` |

   `ServerConfig` 落成 `workshopContext: {contextWindow, compactRatio, keepRecentTokens}` 一组；生效值再与工坊模型自带的 `contextWindow` 取 `min`（元数据不可信，但只用来**收紧**不会更糟）。设置面板暂不加这三个框（`beatTimeoutMs`、`STAGE_PASSWORD` 一样是 env-only），README 必须写清楚。
5. **计量沿用「provider 实测标定」。** 每轮收束时把 `usage ÷ 本地估算` 存成线程上的 `tokenScale`，下一轮开跑前用它计量。拿不到 usage 时按 1 计（与演出侧同一兜底）。
6. **摘要失败只告警，不切、不降级。** 与演出侧一致（压缩是优化不是正确性前提）。
7. **前端只加一条分隔线。** 有压缩时才出现，点开看详情。不动任何现有气泡样式。

---

## 2. 服务端

### 2.1 计量与切点（`compaction.ts` 新增纯函数）

同一文件里现在有两套尺子不叫「一套治理」，新函数与演出侧并列放在文件末尾一节。

```ts
/** 工坊线程的一轮：只用到 role 与 text（结构化类型，免 import 环）。 */
export interface ThreadTurn { role: "user" | "assistant"; text: string }

/** 线程上下文的 token 估算：systemPrompt + 消息列表，同一把 scale 乘全量。 */
export function estimateThreadTokens(
  systemPrompt: string,
  messages: readonly AgentMessage[],
  scale: number,
): number;

/**
 * 切尾点：返回保留尾部里第一条 user 消息的**相对**下标（切掉 [0, cut)）。
 * 落点必须是 user 消息；返回 0 = 无段可压。
 */
export function pickThreadCutIndex(
  history: readonly ThreadTurn[],
  keepRecentTokens: number,
  scale: number,
): number;

/** 由上一轮的 provider 实测 usage 标定 scale：usageTokens ÷ 本地估算。异常值回落 1。 */
export function calibrateTokenScale(
  systemPrompt: string,
  messages: readonly AgentMessage[],
  usage: Usage | undefined,
): number | null;

/** 多纪元摘要合并：新的接在旧的后面，超上限从头截（更早的结论被下一轮摘要重新吸收过）。 */
export function mergeDigest(prev: string, next: string, maxChars?: number): string;
```

细节：

- `estimateThreadTokens` 先把 systemPrompt 包成一条 `{role:"system"}` 消息过 `estimateTokens`，再逐条加历史，最后整体乘 scale。scale 是在「system + 消息」这个整体上标定出来的，工具 schema 的固定开销由 scale 吸收（演出侧同理）。
- `pickThreadCutIndex` 是 `pickCutIndex` 的线程版：同样的「预算落在中间先向后顺延到下一条 user，顺延越界则向前退」规则，只是输入是 user/assistant 交替的纯文本轮次，越界场景比演出侧少。
- `calibrateTokenScale`：分子用 pi 的 `calculateContextTokens(usage)`，分母是 systemPrompt + 到**最后一条 assistant（含）**为止的消息本地估算——与 `estimateContextTokens` 的 `lastUsageIndex` 口径一致。`usage` 缺失/全零/系数落在 (0, 10] 之外 → 返回 null。
- `mergeDigest` 默认上限 6000 字符，超了从头截并加「（更早的对话已不再保留）」前缀；被截掉的原文仍在消息文件里。

### 2.2 摘要（`workshop.ts`）

- `EPOCH_SUMMARY_SYSTEM` 的姐妹提示词 `WORKSHOP_DIGEST_SYSTEM`（**另写一份，不复用**：演出侧那份讲的是「前情提要 / 剧情进展 / 玩家主权」，对搭台对话是错的）：

```
你是剧目搭建会话的长期上下文整理员。下面是用户与搭台助手的多轮对话原文（按时间顺序）。
请压缩成一份「本会话已确定事项」，供搭台助手后续无缝继续。

输出格式（严格遵守）：
第一行：一句话概括（不超过 60 字，不要加 markdown 标题符号）。
空一行后，从「## 已确定」开始分节正文。

要求：
- 只复述原文已有的事实，绝不新增设定、需求或结论
- 已落盘的文件逐条列出（改了什么、写成什么样）
- 用户明确表达过的偏好与禁忌单独一节，照原话口径记
- 已出图 / 已导入的素材连 id 一起记
- 用户提过但还没做完的事单列「待办」
- 写结论，不写叙事：不要复述「用户问…助手答…」的过程
```

- `summarizeThread(opts, head, prevDigest)`：`prevDigest` 非空时在转录前加一段「以下是本会话此前已压缩的摘要，请与下面的新增原文合并成一份完整定稿，不要丢掉此前的结论」。转录复用 `renderTranscript`，摘要拆解复用 `splitSummary`，请求走 `completeText`（[llm.ts:21](../../apps/server/src/llm.ts#L21)，`MAX_TOKENS=2048` 不变）。
- `renderTranscript` 加一个可选标签参数（`{user?: string; assistant?: string}`，默认仍是演出侧的「【玩家/导演】」）。工坊传 `{user: "用户"}`——那边说话的是剧目作者，不是玩家。

### 2.3 线程元数据（`workshopThreads.ts`）

```ts
export interface ThreadCompaction {
  at: number;        // 压缩时刻
  cutAt: number;     // 前 cutAt 条消息已不进上下文（原文仍在文件里）
  oneLiner: string;  // 最近一个纪元的一句话摘要
  body: string;      // 累积摘要正文（多纪元合并）
  epochs: number;    // 压缩次数
}

export interface WorkshopThread {
  // …现有字段
  summary: string | null;                       // 已有字段，从此刻起 = 最新一句话摘要
  compaction: ThreadCompaction | null;
  tokenScale: number | null;                    // provider 实测标定系数
}
```

只加字段，**不写迁移逻辑**：老线程读到 `undefined` 一律当 `null`/`1` 处理（`?? 0` / `?? 1`），首次压缩后自然带上新字段。

### 2.4 会话流程（`workshopSession.ts`）

`chat()` 在 append 用户消息**之前**插入预检（与演出侧同一时机：每轮开跑前）：

```ts
let thread = …;                       // 已有
const view = thread.compaction?.cutAt ?? 0;
const visible = history.slice(view);  // 模型可见的部分

// 1) 计量（用当轮 prompt，A 区已含上一轮的摘要）
const prompt0 = await this.systemPrompt(thread.compaction?.body ?? "");
const tokens = estimateThreadTokens(prompt0, historyToMessages(visible), thread.tokenScale ?? 1);

let compaction = thread.compaction;
if (this.opts.compaction && tokens > contextWindow * triggerRatio) {
  const cut = pickThreadCutIndex(visible, keepRecentTokens, thread.tokenScale ?? 1);
  if (cut > 0) {
    const head = visible.slice(0, cut);
    const digest = await summarizeThread({streamFn, model, getApiKey, signal}, head, compaction?.body);
    // 摘要失败 → summarizeEpoch 的同一约定：warn 后照常开跑，不切
    if (digest) {
      compaction = {
        at: Date.now(),
        cutAt: view + cut,
        oneLiner: digest.oneLiner,
        body: mergeDigest(compaction?.body ?? "", digest.body),
        epochs: (compaction?.epochs ?? 0) + 1,
      };
      await this.threads.update(active.id, { compaction, summary: digest.oneLiner });
      console.log(`[stage-ai] 工坊线程压缩：${tokens} tok → 保留 ${visible.length - cut}/${visible.length} 条，epoch=${compaction.epochs}`);
    }
  }
}

const prompt = compaction?.body ? await this.systemPrompt(compaction.body) : prompt0;
const answer = await runWorkshopTurn({... systemPrompt: prompt}, visible, content, handlers);
```

- 传给 `runWorkshopTurn` 的是 `visible`（= `history.slice(compaction.cutAt)`），head 不进上下文。
- `runWorkshopTurn` 返回值从 `string` 改成 `{ text: string; scale: number | null }`：跑完拿最后一条 assistant 的 `usage`（[workshop.ts:222](../../apps/server/src/workshop.ts#L222) 那处已有 `last`）算 `calibrateTokenScale`，写回 `threads.update(active.id, {tokenScale})`。`scale` 为 null 时不写（保留上一个）。
- 压缩是 await 的，期间用户在等——与「先问后写」的工作流一致；日志一行说明压了多少。

### 2.5 提示词（`buildWorkshopPrompt`）

`WorkshopPromptContext` 加 `digest?: string`。非空时在 `# 当前状态` 之前插一节：

```
# 本会话已确定（早期对话已压缩）

{digest}

以上是本会话早前已经确定的事项，不要重新提问、不要推翻；要改就基于它往下改。
```

### 2.6 配置与装配（`config.ts` / `playhouse.ts`）

- `config.ts`：`ServerConfig` 加 `workshopContext`（三项）；`loadConfig` 里三个键各自回落全局同名项；交叉校验（[config.ts:191](../../apps/server/src/config.ts#L191)）多跑一份工坊的 `keepRecentTokens ≥ contextWindow × compactRatio` 告警。
- `playhouse.ts`：`new WorkshopSession({...})` 增加

```ts
compaction: {
  contextWindow: Math.min(this.config.workshopContext.contextWindow, workshopModel.contextWindow ?? Infinity),
  triggerRatio: this.config.workshopContext.compactRatio,
  keepRecentTokens: this.config.workshopContext.keepRecentTokens,
},
```

---

## 3. 前端

- `packages/core/src/ws/protocol.ts`：`workshop_history` 下行加 `compaction: {cutAt: number; oneLiner: string; body: string} | null`；`WorkshopThreadInfo.summary` 已在透传，无需改。
- `useWorkshop.ts`：`WorkshopState` 加 `compaction`，`workshop_history` 分支一并写入。
- `WorkshopPane.tsx`：`state.messages.map` 里，当 `i === compaction.cutAt` 时插一条分隔：

```tsx
{i === state.compaction?.cutAt && (
  <div className="chat-divider">
    <button className="ghost-btn tiny-btn" onClick={() => setDigestOpen(!digestOpen)}>
      <Icon name="archive" size={12} /> 早期 {cutAt} 条对话已压缩
    </button>
    {!digestOpen && <span className="muted small">{oneLiner}</span>}
  </div>
)}
{digestOpen && <div className="chat-digest"><WorkshopMarkdown text={body} …/></div>}
```

- 样式：一条 `.chat-divider`（居中、1px 分隔线、小字 muted）+ `.chat-digest`（缩进一块 muted 底）。**不动任何现有气泡样式**。

---

## 4. 测试

`apps/server/test/compaction.test.ts` 增 `describe("工坊线程压缩")`（纯函数，零 fixture）：

1. `pickThreadCutIndex` 落点在 user 上；对话体本身就短于保留预算时返回 0；预算落在中间时向后顺延而不是劈开一轮。
2. `estimateThreadTokens` 随 scale 线性放大（中文 4 倍差距用这个用例钉住）。
3. `calibrateTokenScale`：正常 usage 标定出接近 4 的系数；usage 缺失 / 全零 / 系数 > 10 三种异常都返回 null。
4. `mergeDigest`：两次合并后旧结论仍在；超 6000 字符从头截且带标记。
5. `renderTranscript` 的标签参数：工坊口径下 user 显示为「用户」，演出侧默认不变。

`apps/server/test/workshop.test.ts` 增端到端一条（复用已有的 `makeStore()` + `createFakeStreamFn`）：

- 线程塞够历史 + 把 `contextWindow` 调到很小 → 下一轮开跑前触发压缩：假流收到的 context 里 **head 文本不存在**、A 区带摘要、`workshop_history` 下行的 `compaction.cutAt` 前移、`threads.json` 落盘 `summary`/`compaction`；
- 摘要请求失败（假流抛错）→ warn 后照常开跑、`compaction` 保持原样；
- 未超阈值 → 不压缩（`compaction` 为 null）。

`apps/server/test/workshopPrompt.test.ts`：有 digest / 无 digest 两态的提示词快照。

`helpers.ts`：`FakeResponse` 加可选 `usageTokens?: number`（现有假流 usage 全零，标定系数测不了）。

跑：`pnpm --filter @stage-ai/server test`（compaction / workshop / workshopPrompt 三个文件）。

---

## 5. 文档

- `README.md`：`STAGE_COMPACT_*` / `STAGE_CONTEXT_WINDOW` / `STAGE_KEEP_RECENT_TOKENS` 那几行的说明补一句「工坊另有三个 `STAGE_WORKSHOP_*` 覆盖项，不设即沿用」，并把三个新键列进配置表。
- 项目 `AGENTS.md` 的 `apps/server` 段：把「工坊有纪元压缩、产物落线程而非 arcs」写进去（现在这段只提了演出侧）。

---

## 6. 风险与非目标

- **窗口取谁**：工坊用自己那三个 env，缺省沿用全局；生效值再与工坊模型自带的 `contextWindow` 取 `min`（见 §1.4）。
- **拿不到 usage 的网关**：scale 退回 1 → 中文下低估 4 倍 → 压缩偏晚。演出侧同一暴露面，不单独兜底。
- **压缩后仍超窗口**：单轮巨物（贴一整本设定）压完还是超就照旧报 provider 的错，不做硬截断兜底——与演出侧一致，靠 §2.4 的预检已经提前一轮处理掉正常增长。
- **不做**：跨线程共享摘要、按 token 计费/限额、给压缩做开关、给用户「手动压缩」按钮、把三个新 env 搬进设置面板。