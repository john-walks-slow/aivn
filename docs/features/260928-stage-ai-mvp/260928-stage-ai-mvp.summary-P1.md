# stage-ai MVP 实施摘要（P1：核心闭环）

> 状态：P1 完成（server 7/7 单测、全仓 typecheck 零错误、真实 LLM 浏览器全链路七路径验证、review 阻塞项全部实证修复）。P2（演出层：场景 bg/立绘/CG/语音管线）待开工。

## 背景

P0 语言契约层（`@stage-ai/core`）之上搭起最小可用引擎：cpa 网关驱动的 playwriter（pi-agent-core）流式写戏，React 19 前端像流式视频一样边生成边演出，玩家在停止点入戏表态或以导演身份 OOC 干预。

## 交付内容

| 模块 | 内容 |
| --- | --- |
| `apps/server` | 编排器（beat 生命周期：beat_start→流式→beat_end(stop/act_end)；玩家动作路由 choice/free/continue/ooc；busy 拒绝；谱系行级聚合+快照+持久化）、cpa provider（pi-ai openai-completions API）、playwright 提示词（剧目 premise+角色卡+DSL 规范+导演注通道）、WS hub（广播/resume 重放 eventsAfter(lastSeq)/重连 stoppedReplay 重发 beat_end）、剧目与会话存储（play.json + session.json + lineage.jsonl） |
| `apps/web` | vite 7 + React 19：ScriptBuilder（StageEvent→ScriptLine 增量聚合）、useStageSocket（重连退避/总是 resume/角色名映射/版本号驱动的滚底）、StageView（say 带情绪/旁白居中/心声斜体/场景分隔条/流式光标）、StopPanel（choice 按钮/free 输入/pause 继续按钮/OOC 导演备注）、plain clean 浅色样式 |
| `packages/core` | hello 消息加可选 `cast`（角色名映射，向后兼容） |
| `plays/demo` | 样例剧目《黄昏的走廊》：mio/月见澪，黄昏旧校舍 + 天文社 + 拆楼倒计时设定 |

## E2E 验证（真实 LLM：DeepSeek-V4.1-Flash via cpa，浏览器全链路）

1. 首拍流式演出（scene/narrate/say+情绪/thought，角色名「月见澪」正确映射）
2. choice 三种形态（1/3/2 选项）→ player_choice → 续演
3. OOC ×2：幕收束指令生效（LLM 按指令写完收尾，含指定台词「下次……」）；free 停止点请求生效
4. pause stop「继续」按钮；free 输入 → player_free → 续演（玩家台词被剧本吸收）
5. reload 全量 resume：95 行台词 + choice 面板 + 状态完整恢复
6. 首拍 ~9s 出全，第二拍 ~5s，延迟体感可接受

## Review（review-P1.md）与修复

两轮内闭环，阻塞项全部实证修复：

- **B1 自动滚底失效**：`lines` 是原地变更的稳定引用，`useEffect([lines])` 只跑一次——40 行流完 scrollTop 钉在 0。修复：hook 暴露 `revision`（事件批次自增）驱动滚底 effect；mock 舞台实证 scrollTop 2096 贴底。
- **B2 choice 零选项死局**：服务端护栏（D3）——`finishBeat` 将零选项 choice 降级 free stop（parser 侧 warning 已有）；单测覆盖。
- **S1 error 不可见**：App 加 error banner；mock 实证服务端错误消息渲染。
- resume 语义修复（review 前自查发现）：前端总是发 `resume{lastSeq}`（0=全量重放），reload 不再白屏。

已知限制（记入 review 报告，P2+ 处理）：跨进程重启恢复（seq/stop/LLM 转录不持久化，autostart 会污染旧谱系——P2 纪元装配范围）；choice 偶发单选项（提示词工程调优）；thought id=player 时显示原始 id；lineage.jsonl 追加无串行化、session.json 非原子写（P6 soak 前处理）。

## 测试

- `@stage-ai/core` 45/45（P0 回归线全绿）
- `apps/server` 7/7：fake StreamFn 注入真实 agent loop，验证 beat 生命周期、stop 类型、choice 路由、busy 拒绝、无效选项、OOC 谱系、resume seq 过滤、choice 降级

## 下一步（P2）

演出层：场景 bg 渲染、立绘（gen_asset 管线 + sprite）、CG 展示、sfx；语音管线（PhraseChunker 句级预取 + Fish Audio）；KV cache 纪元压缩与跨进程会话恢复的架构前置。
