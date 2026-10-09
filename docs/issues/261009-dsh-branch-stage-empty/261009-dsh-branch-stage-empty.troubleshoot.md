# 从选项分叉出新对话后，舞台台词条落在「（点击开始）」

> 日期：2026-10-09 · 仓库：`dsh-aivn`（分支 `task/15`）· 记录：`stage-ai/docs/issues/`
> 症状提出：从上一个选项分叉出新对话 → 进 AIVN tab → **选项显示正常，但选项背后的文本是「（点击开始）」**。

---

## 1. 问题复现

复用 `e2e/verify-director.mjs` 既有的分叉段（D15/D16 那一处），它是全仓唯一一次真实的
「原生分叉 → 新会话舞台由会话面重建」流程，不额外花 LLM：

- **D16** 只数了帧数（`childFrames > 3`）——帧确实到了，判据就过了；
- 补 **D18**：切到子会话的 AIVN tab，读 `.theater-dialog .dialog-text`，断言它**不是**三句占位之一
  （`PLACEHOLDERS`：`（点击开始）` / `剧作家正在落笔…` / `还没开演——按画面上的「开演」开始。`），
  且停止点选项照常在。

**负向对照**（判据是否真能抓到这个 bug）：把修复那一行改回 `setResumeAfterReset(false)`
（即修复前的行为），重启实例重跑 `npm run e2e:director` → **D18 变红**，台词条上就是那句
「（点击开始）」；改回来即绿。判据确实咬得住这个现象，不是一条永远为真的断言。

---

## 2. 根因

`src/client/stage-view.tsx` 调 `@aivn/stage` 的 `usePlayback` 时**只给了 `resetToken`，没给
`resumeAfterReset`**。

`usePlayback`（`packages/stage/src/director.ts`）在换代（`resetToken` 变化）后有两条 effect：

1. **换代 effect** 把游标归零，并把 `showTailRef.current = opts.resumeAfterReset === true`；
2. **首屏快进 effect** 把所有 cue 的视觉一次性应用，`cursorRef.current = cues.length`（游标到头），
   然后**只有** `showTailRef.current` 为真才 `setCurrentKey(lastLineKey)`——把末尾那句摆上台词条。

插件这边 `resumeAfterReset` 从未传过，恒为 `false`，于是重建完的状态是：
**游标已在末尾，但没有任何一行在屏上**（`current === null`）。

---

## 3. 现象与根因的关联

从 `current === null` + 游标到头往下推，用户看到的两个现象都落在这个状态上：

| 用户看到的 | 机制 |
|---|---|
| **选项显示正常** | `exhausted = cues.length <= cursor && (current === null \|\| lineComplete)` → 游标到头且 `current` 为 null，`exhausted` 为真；`panelReady = !busy && exhausted && lineDone` 随之成立 → `StopPanel` 照常摆出 |
| **选项背后是「（点击开始）」** | `StageTheater` 的 `dialogContent`：`hasView` 为假（`view` 由 `current` 推出）→ 落到 `emptyDialogHint(live)`；分叉出来的会话没有 `beat/start` 帧，客户端 `live` 为 `false` → 返回 `'（点击开始）'` |

**为什么只有分叉暴露**：改写 / 重写之后紧接着有一轮在跑（`live === true`），台词条显示的是
「剧作家正在落笔…」，`current === null` 被这一层掩盖了——所以既有的 D11–D14 全绿、这条溜了过去。
冷开场（宿主重启后打开舞台）其实同病，只是不容易撞上。

---

## 4. 修复路径（单点修复）

AIVN app 本体在 `apps/web/src/views/StageScreen.tsx` 传的是 `resumeAfterReset: rebase.resume`，
其中 `resume = !streaming`——**空闲就显示末行，还在写就不显示**。插件缺的正是这一路判据，
而「还有没有一轮在写」只有重建方（`stage-log.rebuildStage` 的 `running`）知道。三处改动：

| 层 | 文件 | 改动 |
|---|---|---|
| 宿主 | `src/hub.ts` | `reset(sessionId, running)`：重置帧带上 `running`（帧类型加一个字段） |
| 宿主 | `src/stage/stage-log.ts` | 重建时把 `running` 传给 `reset`（它本来就用这个值决定末帧的 `beat` 状态，一直没往外说） |
| 客户端 | `src/client/stage-view.tsx` | 新增 `resumeAfterReset` 状态与落地口 `rebase(running)`；`reset` 帧按 `!running` 定夺；`beat/start` 时若画面还停在重建摆出的末句，再换一次代把它撤下来 |

第三条不可省：换代之后 `shouldAutoStart` 要求「此刻没有台词在显示」，留着重建摆出的旧末句，
改写 / 重写那条路上新一轮的第一句就要玩家点一下才上来——那会把 D13 那条链弄坏。

---

## 5. 验收标准

| # | 判据 |
|---|---|
| 1 | 从选项分叉出新对话 → 进 AIVN tab：**停止点选项照常摆出**，且台词条上是重投影出来的正文，不是三句占位之一（`verify-director` D18） |
| 2 | 回退 / 改写 / 重写之后仍停在「剧作家正在落笔…」，新一轮内容自动接上（D11–D14 不回归） |
| 3 | 重建帧自带的 `running` 与实际一致（`verify-rebuild` R1b） |
| 4 | 离线套件全绿：`verify-rebuild` 14/14、`verify-ending` 8/8 |

---

## 6. 顺带发现（非本问题引入）

### 1. e2e 实例的模型 provider 没配上 → 所有真 LLM 用例集体「第一拍超时」

**症状**：`npm run e2e:director` 在 D4 卡满 600s 超时，后续全部「无从验起」。**页面无任何报错**
（D17 还是绿的），只是剧作家一个字都不写。

**根因**：会话日志里没有助手消息，翻到 `turn/end` 才看见：

```json
{"type":"turn/end","data":{"turn":1,"reason":{"kind":"error",
 "error":{"message":"no adapter registered for provider \"cpa\"","code":"NO_ADAPTER"}}}}
```

provider 的适配器由 `@deepseek-ai/dsh-llm-pi-ai` 在**设置文档**里拿到 `llm-pi-ai.providers`
之后才注册（它在 dsh-base 里是「挂载但休眠」的）。而 e2e home 的 `settings.yaml` 走的是
dsh-settings 的 legacy 导入：`settings.yaml` → 改名为 `settings.yaml.imported` → 逐段 `update()`；
**表里没有 `llm-pi-ai` 的落点，这一段被丢掉**（只剩 `.imported` 里那份原文，日志一行 warn）。
profile 的 patch 层（`profiles/web/cordis.patch.yml`，settings 的实际落盘处）因此没有这一条。

**处置**：把 `llm-pi-ai` 段按 patch 条目的形状（`- id / name / config`）补进
`<home>/profiles/web/cordis.patch.yml`，重启实例即恢复。

**这条值得回灌 `dsh-e2e` 技能**（骨架侧，非本仓）：`/root/.dsh-e2e-skel/settings.yaml` 里那些
**需要 config 落点的段**（`llm-pi-ai`、`agent-presets`、`dsh-imagegen`……）在新建 home 时
应当直接写成 patch 条目，而不是塞进一个注定被导入丢弃的 `settings.yaml`。已建 home 不会自动同步，
需要手工补或 `wipe` 重建——本 worktree 是手工补的。

### 2. DSH 的「Preview Notice」弹窗遮住输入框

**症状**：`sendMessage` 的 `editor.click()` 一直重试到超时，报的是
`<p>We look forward to exploring the limits of intell…</p> … intercepts pointer events`——
一串看不出所以然的 DOM 噪声。

**根因**：`dismissOnboarding` 只认「添加 API key」那扇门的按钮文本（`Configure later|稍后配置`），
而这次挡住输入框的是新冒出来的 **Preview Notice**（按钮文本 `Continue`）。

**处置**：`dismissOnboarding` 改成逐扇关门（两套标签都认），返回值也换成**「输入框中心点上
最顶层的就是输入框吗」**——比数弹窗个数可靠，直接测「遮罩还挡不挡事」。
