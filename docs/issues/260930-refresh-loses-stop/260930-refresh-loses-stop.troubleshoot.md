# 刷新后停止点丢失 排查

**状态：已修复（2026-10-01，分支 `feat/cg-director`）。** 出现于 2026-09-30 路线画布收尾时的刷新复测，属 P1 起就存在的既有缺陷（`7da9227`），与路线画布改动无关。

## 现象

刷新（或重连、服务端重启、`reload` 后重连）进一个**挂载点落在第 0 拍内**的现场时：

- 剧本照常恢复：`resume` 全量重放，台词、场景、立绘都在，操作条也解锁。
- 停止点**不恢复**：`stop` 面板不出现（choice 选项、自由输入、幕末「下一幕」全无），客户端停在 `state="stopped"` 且 `stop === null`。
- 如果丢的是 `choice`，玩家没有选项可点，只能按「继续」开新拍——那个停止点被跳过。

## 根因

两条独立通道错位：

1. `hello` 只带 `idle`（编排器此刻不忙），**不带当前停止点**。停止点是靠紧跟其后的 `beat_end` 重放补的（`transport.ts::sendHello` → `orchestrator.stoppedReplay`，`playhouse.broadcastHello` 同）。
2. `stoppedReplay` 的守卫是 `if (this.busy || !this.autostarted || this.beatNo === 0) return null`（`orchestrator.ts:540`）。`beatNo` 来自 `stateAt(nodeId)` 的 `snapshot?.engine.turn ?? play.initialState.turn`——路径上没有快照时**回落初始状态，turn 恒为 0**。快照只在每拍收束时写（`orchestrator.ts:1087`），所以挂载点落在第 0 拍内（例如「跳到这里」点在第 0 拍的某张卡上）时 `beatNo === 0`，守卫把「还没开演」误判成「挂载点在第 0 拍」，重放被吞掉。

`lastStop` 本身是好的：`syncContext` 走 `restoreStopPoint` 正确算出 `pause`/`choice` 并随 `persist()` 落 `session.json` 的 `runtime.lastStop`，`jumpTo` 的同会话 `rebase` 也带 `stop`。丢的只是**重连时的那一次补发**。

为什么现在才浮出来：客户端此前一直卡在 `state="streaming"`（`useStageSocket` 的 `stateRef` 同步读 bug，已由 `048cbd4` 修掉），按钮恒禁用，这个「stopped 且无停止点」的状态被那个 bug 遮蔽；`hello.idle → stopped` 一落地，它才成为玩家可见状态。

## 证据（本机实测）

裸 WS 连 `ws://127.0.0.1:25002/ws?play=demo` 并发 `resume lastSeq=0`，两次复测（`plays/demo` 存档 `sloyw3v28`，两次的 `session.json` 都是 `engine.turn = 0`、`runtime.beatNo = 0`、`runtime.lastStop = {stopType:"pause"}`、`lineage.snapshots = []`）：

```
# 第一次：挂载点在第 0 拍深处的废弃支线上，48 条 lineage / 11 条 runtime.events
[+21ms] {"type":"hello","idle":true,"lastSeq":11,"epoch":3,"saveId":"sloyw3v28",...}
[+25ms] {"type":"events","n":11,"first":"scene","last":"scene"}
<2.5s 内再无消息：没有 beat_end>

# 第二次（收尾时「跳到这里」点了第 0 拍的卡之后，挂载点退到该拍幕首）
[+20ms] {"type":"hello","idle":true,"lastSeq":1,"epoch":9,"saveId":"sloyw3v28",...}
[+23ms] {"type":"events","n":1,"first":"scene","last":"scene"}
<2.5s 内再无消息：没有 beat_end>
```

两次 hello 与事件都到了，`beat_end` 重放缺席——正是上面第 2 条守卫。

浏览器侧同形状（第二次复测之后刷新）：`.stop-panel` 数量 **0**，舞台上没有任何「继续 / 下一幕」按钮，`session.json` 里却明明记着 `lastStop = pause`。

## 同一现场下各入口的实际可用性（刷新后）

- 路线视图：8 张卡、16 个工具按钮**全部可点**（`refresh-route-tools2.png`）——玩家仍有完整的结构操作能力。
- 舞台方向键：「说下去/编辑」因当前无台词而禁用（`title="这里是表态或导演注，没有台词可改"`，属正常语境禁用），跳转/分岔同理没有可挂载的当前行。

## 触发条件（真实玩法下可达）

- 「跳到这里」落在第 0 拍内的任意节点（第 0 拍收束前没有快照），随后刷新。
- 任何 `engine.turn` 解析为 0 的恢复路径（缺快照的存档、外部写入的 session.json）。
- 不受影响：挂载点在第 1 拍及以后（路径上有快照，`beatNo > 0`），以及正忙时的连接（那时本来就不该有停止点）。

## 修法与实施

两条候选里选了退一步那条：**`beatNo === 0` → `!this.autostarted`**。

- `autostarted` 才是「有没有开演」的判据（`start()` / `playerAction()` / 从 session 恢复时置位），
  `beatNo` 是挂载点**位置**。原守卫把两件事混成一件，于是「挂载点在第 0 拍」被当成「还没开演」，
  恢复用的重放被吞掉。
- 客户端只认 `stop` / `reason` 两个字段，`beat_end.beatId` 从头到尾没被用过；
  所以 `beat_end` 这条补发通道不需要协议侧配合，改动只落在服务端一处。

```ts
// orchestrator.ts::stoppedReplay
if (this.busy || !this.autostarted) return null;
```

回归覆盖见 `apps/server/test/orchestrator.test.ts` 的「重连恢复（停止点补发）」：
挂载点在第 0 拍深处（`snapshots: []`、`beatNo: 0`、`lastStop: pause`）时 `stoppedReplay()` 必须返回
停止点；真正没开演（`autostarted === false`）时必须返回 null。

## 关联

与本次同批修的另外两条一起落在 `feat/cg-director`：`feat/director-cg`（导演生图按钮）、
`feat/fix-stage-crash`（不存在的剧目 WS 连接把进程带走）。
