# 语音只配了省略号前半句 — 修复小结（261012）

## 结论

用户报告的现象成立，根因是**服务端把已经许诺出去的语音队列丢掉**，两处：

| 触发 | 原来发生了什么 | 现在 |
| --- | --- | --- |
| 最后一个舞台连接断开（锁屏/切后台/换设备） | `transport.drop()` → `setTtsState({enabled:false})` → 清空队列，且此后短语连队都进不去 | 改判「没人在听」：`{audience:false}` 只停泵——队列继续收、离场期间合成的帧留着，人回来按原序补推 |
| 轮边界重建 runtime（工坊写盘/设置改动） | `orchestrator.dispose()` → `voice.dispose()` 清空队列 | 新实例**建好之后**同步交班（`take → dispose 旧 → adopt 新`），排队中/在飞的句子与攒下的帧一起过去 |

关键取舍：`enabled` 是「玩家自己关的语音」（队列作废，客户端整行也清了），`audience` 是「这一刻没人在听」（活儿留着）。两者曾经混用同一个开关，是 1 号路径的病因。

## 验证

- 单元（`apps/server/test/voice.test.ts`，11 例）：离场期间零上游请求零下发、回来三句补齐；`handover` 交出在飞的句子；接手登记过的语音条目留在共享记账表里。
- 假模型网关 + 假舞台端到端（见 troubleshoot 文的复现命令）：
  - 断线：修复前 `完整 1 / 一半 1 / 全无 4`、缓存 4/12 → 修复后 `完整 6 / 一半 0 / 全无 0`、缓存 12/12。
  - 轮边界重建：修复后同样 6/6、缓存 12/12（修复前最后一行只出前半截）。
- 受影响的 `apps/server` 用例（voice / transport / playhouse / pendingJobs）43 例全绿；`pnpm typecheck` 全绿。
  `playAssets.test.ts` 的 4 例失败是 main 基线就有的（已在 main 工作区复跑确认），与本改动无关。

## 检视

`261012-voice-phrase-tail-loss.review.md`：三轮检视，最后一轮**条件准入**、无阻塞项。
前两轮的两个阻塞项都已闭环：

1. backtrack 摘取早于 `await buildRuntime`（构建期间重复广播 / 构建失败丢 backlog）→ 改成「构建成功之后一次同步事务」，并用 `playhouse.test.ts` 的「重建失败：旧 runtime 原样留着」钉住。
2. 交班顺序会让旧实例 `dispose()` 的 `clearAll()` 抹掉新实例刚登记的语音记账 → 调成 `take → dispose → adopt`，并加共享 `PendingJobs` 的回归断言。

## 遗留（未在本笔修复内）

- `orchestrator.dispose()` 里 `pending.clearAll()` 会连**同剧目共享**的记账表一起清（image/bgm 在跑的任务也会从面板消失）。这是改动前就有的行为，修它要给记账表加所有权/代际，属独立改动。
- 客户端链式调度缺一个短语就永久停住（`apps/web/src/stage/audio.ts`）：本笔治的是「服务端丢活儿」，剩下能触发它的只有真 TTS 失败与进程重启。要治得加一帧显式的「这句没了」，是协议改动。
- 交班把在飞任务重新排队，依赖合成层的内容寻址缓存去重（同一个 `FishTts` 客户端）；换合成后端时要重新确认这条前提。
