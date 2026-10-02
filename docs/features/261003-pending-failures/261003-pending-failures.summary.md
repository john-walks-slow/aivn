# pending 面板的失败态

失败的生成项留在面板上，展开看错因，手动删才清。

## 问题

pending 面板原本只有 `running` / `done` 两态。`done` 停留 4 秒后自动消失，而**失败连
「失败」这个事实都传不出来**——`begin()` 的收尾函数不接受任何出错信息，生图/语音/
剧作家轮次一挂，那一行照走成功收尾，错误只落在服务端日志里。

玩家看到的是：那一行消失了，什么也没发生。既看不出出了事，也没有可以回看的错因。

## 契约

`PendingJob` 加第三态与错因字段（`packages/core/src/ws/protocol.ts`）：

```ts
state: "running" | "done" | "failed";
error?: string;   // 失败态的原因，后端报错原文
```

新增一条客户端消息，供面板上的删除键回传：

```ts
{ type: "pending_dismiss"; jobId: string }
```

## 记账

`PendingJobs.begin()` 的收尾函数收 `(error?: string)`（`apps/server/src/pendingJobs.ts`）：

- 不给 error = 干成了 → `done`，排 4 秒退场计时（行为不变）
- 给了 error = 挂了 → `failed`，**不排退场计时**，常驻到有人删它

`dismiss(id)` 是失败项唯一的出路。清一条**还在跑的**也放行：那件活儿后来收尾时
`this.jobs.get(id) !== entry`，自行退出，不多广播一次。

`errorText(error)` 把异常拍平成一句话（`Error` 取 message，其余 `String()`），
随收尾函数一起导出——收尾收的是字符串，记账层不该知道各家异常长什么样。

## 三处调用点

| 位置 | 失败判定 |
|---|---|
| `playAssets.ts` 出图 | `catch` 里 `done?.(errorText(error))` 后照原样抛出 |
| `voice.ts` 合成 | `.catch` 里告警之外再 `done?.(reason)` |
| `orchestrator.ts` 轮次 | `finishBeat` 把收尾**挪到「这一轮成没成」判定之后** |

第三条是关键：原先 `pendingBeatJob?.()` 在函数开头无条件调用，挪到末尾才能拿到
`beatFailure`（空轮 / beatError 两条路径的结果）。超时也覆盖到了——`beatTimedOut`
总会顺带设 `beatError`。

## 面板

`PromptQueuePanel.tsx`，行渲染抽成 `PendingJobRow`（running / done / failed 三态
的差异集中在一处，不再挤在 `map` 里）：

- 失败行：左侧 `alert` 图标 + `--dialog-bad` 警示色 + 行尾删除键
- 展开键的展开内容按状态分：失败展开**错因**，生图展开提示词
- 收起态徽标：压一枚 `alert` 在最前并挂 `.failed` 类——收起时那是唯一能看出
  「出事了」的地方
- 顶行：`正在生成 · N 项失败`（失败不被「正在生成」盖掉），都没发生才叫「刚刚完成」

`--dialog-bad` 是新加的主题变量，深浅两套舞台各给一档。不用 `--ink-faint` 那类
压暗灰——那一档是「刚完成」，与「挂了」不能混。

## 显式重置路径没动

语音总开关关闭（`setEnabled(false)`）与 runtime `dispose()` 的 `clearAll` /
`clearKind` 照旧清空整类。那是玩家主动收摊或 runtime 被丢弃，不是「自动消失」，
两者语义不同：前者是「我不想要语音了」，后者是「刚才那件失败了但没人看见」。

## 代价

pending 表会随失败累积，长到玩家手动删为止。这正是要的行为——但也意味着失败率高的
剧目需要玩家偶尔清一下面板。

## 验证

- `apps/server/test/pendingJobs.test.ts` 6 例：失败常驻 60 秒不收、同名重试顶掉旧
  条目并挡住迟到的收尾、dismiss 广播与空 id 不广播、删在跑的自行退出、errorText 拍平
- `apps/web/test/pendingPanel.test.tsx` 7 例 DOM：徽标警号与 failed 类、顶行计数、
  删除键只长在失败行、展开错因、无原因时的兜底文案、生图行仍走老样子