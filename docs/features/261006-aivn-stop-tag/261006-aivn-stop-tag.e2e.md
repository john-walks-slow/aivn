# 端到端验证报告：停止点回到 DSL（`<stop …/>`）

日期：2026-10-06 ｜ 实例：`dsh-e2e`（dsh-base + dsh-web-app + dsh-aivn），home `.dsh-e2e-home`，端口 55002

## 运行方式与结果

实例在改动落地后重启过一次（`dsh-e2e stop` → `start --wait-ready`），此后按模块逐个跑：

| 模块 | 命令 | 结果 | 关键断言 |
|---|---|---|---|
| injection | `dsh-e2e run e2e/verify-injection.mjs` | **16/16** | A13：剧作家工具面只有 `validate_play`，**没有** `beat_done`、没有 `set_stage_style` |
| stage | `dsh-e2e run e2e/run.mjs stage` | **14/14** | S10：真实 LLM 交出停止点，面板上 4 个选项；S13：第二轮同样交出停止点；S14：0 页面报错 |
| （stage 内含）opening | — | **5/5** | T1 开局指令跟着第一条消息走（seq 11 < request/header 15），T2 不落成玩家台词 |
| director | `dsh-e2e run e2e/run.mjs director` | **17/17** | D15/D16 见下（本次的核心） |
| stagehand | `dsh-e2e run e2e/run.mjs stagehand` | **20/20** + handmade **4/4** | S13/S14 工具面；H2/H4 模型自己写出的 `play.json` 引擎读得出来 |

## 核心证据

### 1. 停止点由剧本标签产出，选项面板照常（stage S10）

```
✓ S10 停止点交出 4 个选项：把伞递给她 / 打开伞看看伞尖 / 退到补丁板后面 / 自由输入
✓ S11 选项原文已投给剧作家（点了「把伞递给她」，收到「把伞递给她」）
✓ S13 第二轮也交出了停止点：把伞倒过来倒水 / 撑开这把伞 / 把伞放回补丁板 / 自由输入
```

### 2. 拍尾的「在新对话中分支」恢复可用（director D15/D16，本次改动的目的）

```
    页签：Chat / Trajectory / AIVN（切回 Chat：true）
    分支键：{"found":3,"usable":3,"clicked":true}
✓ D15 已从这一轮分出新的对话（session-316dd236-ce2b-463a-a845-271edaa87c99）
✓ D16 分支出来的会话也演到同一个点（收到 107 帧：整段重投影）
```

同一探针在改动前跑出来的是 `{"found":3,"usable":0}`——三个分支键全部 `aria-disabled="true"`。
现在 `usable: 3`，点击真的分出了子会话，子会话的舞台探针收到 107 帧整段重投影。

### 3. 模型把停止点写在最后一行并停笔（会话日志原文）

从 `.dsh-e2e-home/sessions/…/session.v4.jsonl.zstd` 解出的助手消息尾部（三条不同会话）：

```
…<narrate>她把伞举过头顶。</narrate>
<stop options="站到伞底下 | 问林这把伞是谁的 | 去走廊尽头看那扇门"/>
```

```
…<say id="lin" mood="平静">今天不敲那扇门。你再想一遍，伞是从谁那儿借的。</say>
<stop options="说一个名字 | 说不记得了 | 走过去看那滩水"/>
```

```
…<narrate>周往后退了半步…</narrate><say id="zhou">那你打算怎么办。</say>
<stop options="走过去，把伞横在门和林的手之间 | 喊她一声，让她把手放下 | 留在补丁板这里，先看清门缝那一线水"/>
</stop>
```

标签之后没有任何后续正文——`concludeTurn()` 的硬边界撤掉之后，真模型没有续写下一拍。
最后一条里那个多出来的 `</stop>` 是模型的旧习惯（把标签当包裹标签闭合），被当
`mismatched_close` 告警丢弃，不影响任何行为。

### 4. 分支子会话与父会话尾部逐字一致

`session-316dd236`（分支出来的）与它的父会话最后一条助手消息正文完全相同，停止点标签也在——
证明重建走的是同一份文本，而不是靠内存里的帧流凑出来的。

## 未覆盖与不做

- **`<stop placeholder="…"/>` 与 `<stop/>` 的端到端**：走哪条路由模型自己定，套件里无法强制；
  三种形态的解析在 `packages/core/test/parser.golden.test.ts` 里逐条锁死（含撕裂喂入与坏载荷）。
- **坏载荷的端到端**：同样不可控（要模型恰好写错）。解析层行为由单测覆盖（一条选项 → 挂
  `malformed_tag`、不产出 IR）；客户端侧走的是既有的 `no_stop` 通路（`stage-view.tsx`：
  没收到 `stop` 帧 → `isNoStop` → 普通「继续」卡），这条路本次一行未改。
- **语音 / 生图 / 音乐**：实例里没配这些后端，相关分支跑不出来（与本次改动无关）。
- **e2e-tester 子代理两次中断**（无 closing message）：第一次在跑 `director` 全套时崩，resume 后
  再次崩在同一处；同时刻这台机器可用内存只剩 ~1.1 GB、swap 已用 2.9 GB。本报告由主工程师直接
  跑套件并逐条留证（各套件输出见上），未再第三次重跑——第二次崩溃时工作区已带上另一个 agent
  对 `@aivn/stage` 依赖的在飞改动（`package.json` 20:34），再跑就不再是隔离环境了。
