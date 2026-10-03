# workshop-generality 实施小结

- 计划：`261004-workshop-generality.plan.md`（本目录）
- 检视：`261004-workshop-generality.review.md`（结论：准入）
- 用户验证：`261004-workshop-generality.validation.md`
- 分支：`feat/workshop-shell`，worktree `./.worktrees/workshop-shell`，基线 `main@db735bd`

## 一句话

搭台助手不再自造文件工具：`read` / `write` / `edit` / `bash` 全部换成 pi 的内建工具，
只在它们与「剧目目录」之间加一层 100 行的装饰（`PlayEnv`）来承载原有的白名单、`play.json` 结构校验与撤销条；
自造的 480 行工具实现与并发锁（`fileLocks`）整层删掉。

## 动机（用户的原始担忧）

> 「自己实现的太多、定制太多、暗规则太多、可以复用 pi 通用能力的没复用，导致维护成本变高、能力不通用」

三条都对着落地了：

| 担忧 | 这次的处置 |
| --- | --- |
| 自己实现的太多 | 删 480 行自造工具（`filesTool.ts` 238 + `editText.ts` 241）；`edit` 的模糊匹配、BOM/行尾保留、重叠拒绝这些边界逻辑本来就是 pi 的事，我们不必再维护一份 |
| 定制太多 | 并发控制从自造的 `fileLocks` 换成 pi 的 `withFileMutationQueue`；工具签名从自造形状换成 pi 的 `AgentHarnessTool`，用一个 64 行的适配器收口 |
| 暗规则太多 | 提示词里那条**已经漂了**的画幅死规则（写 9:16，真相源是 `play/framing.ts` 的三档）删掉；工具契约只留在工具描述里，提示词不复述（沿用既有规范）；`canX` 四个布尔收成一个 `can: AgentCapabilities` |
| 能力不通用 | 补上最后一公里：`bash`。此前「搭台 agent 本质是个通用 agent」这句话是打折的——没有命令行，它就只会在剧目目录里整篇读整篇写 |

## 关键设计

### `PlayEnv extends NodeExecutionEnv`：装饰，不是重写

只覆写两个口子，其余 14 个 FileSystem 方法全部直接继承：

- `absolutePath` —— read / write / edit 唯一的路径入口，在这里做**读面**白名单。
- `writeFile` —— **写面**白名单 + `play.json` 过 `parsePlayConfig` + 回调 `onWrite({path, before, after})` 生成撤销条。

`exec` **刻意不覆写**（源文件里写了原因）：bash 就该是这台机器上的一个真 shell，给它套白名单等于造半个沙箱，
而半个沙箱既挡不住人也不通用。

### `bash` 的开关与边界

- 开关复用**既有的逐剧目工具开关**（`play.json` 的 `agents.workshop.tools`），没有新增任何环境变量 —— 这是用户明确要求的一条（原话：「为啥这个都要加个环境变量啊。不是本身就有工具开关的设计吗」）。
- `DEFAULT_ENABLED.workshop` = 全量减 `bash`。`bash` 在设置页的「命令行」组里，勾上才装给这个剧目。
- 它绕开 `PlayEnv`，所以 `play.json` 结构校验也绕开了。兜底：`workshopSession` 订阅 `tool_execution_end`，跑过 bash 就置脏；收束前若 `play.json` 已解析不了，**跳过 runtime 重建并广播 `workshop_error`**，把「哪里坏了」直接摆到对话流里（原先那条路是 `void this.opts.onFilesChanged()`，坏配置会让 rebuild 抛在一个没人接的 promise 里）。
- 单条命令没有自己的超时；实际边界是工坊单轮的 7 分钟，到点 abort 连带杀子进程。
- **没做沙箱**：本机 kernel 4.19.325、`CONFIG_USER_NS` 未开，bwrap / nsjail / Landlock 全部不可用；用户拍板「换成通用版，不写沙箱」。代价写进了 README —— 公网入口免密（用户 2026-10-04 拍板维持）＋ 某个剧目勾了 bash ＝ 这台机器上的一个 shell 公开在公网。README 的公开部署段落已点名这一点。

### 一处已知的消息粒度取舍

`play.json` 校验失败的**原因**只有走 `write` 才原样回给模型：pi 的 `edit` 把 `writeFile` 的失败包成
`Could not edit file: <path>. Error code: invalid.`，具体原因只挂在 `cause` 上。
拦得住才是这一层的目的，所以没有为消息粒度再造第二套错误面 —— 代码里注释了这一条，测试也只断言「被拒 + 文件没变 + 没产生撤销条」。

## 与计划的偏差（都是有意为之）

1. **`DEFAULT_ENABLED.workshop` 用 `filter(id => id !== "bash")` 而不是计划里写的「显式 14 条」**：显式列表会在新增工具时静默漏装，而过滤版本的行为是「除 bash 外全开」，正是要表达的语义。
2. **`exec` 不覆写**：计划里没写这一条，但它是不写沙箱的必然推论，已在源码注释与 README 里写明。
3. **计划说 `imageGuide` 与 `SYNC_DESCRIPTION` 重复了四处**——核对后只有两处是真重复（「一次一张同批并行」「neutral 垫图」）；画幅那条不是重复而是**漂移**（提示词写死 9:16，真相源是三档 framing）；「出图失败原话转述」属于汇报行为，保留在提示词里。

## 检视意见的处置

- 阻塞问题：0。
- 建议 S-01（`workshopSession.ts` 告警分支的 `threadId` 加空值兜底）：**未采纳**。该分支的前提是 `changedDuringTurn === true`，而这个标志只可能在一轮已经开始、`this.activeId` 已被赋值之后被置起，所以 `activeId` 在那里不可能为 null；`workshop_error` 的协议类型本身也允许 `threadId: string | null`，前端不读这个字段。同文件同一类型的那条告警（`chat()` 开头的「工坊正在回复」）用的就是同一个写法。按项目「不写用不到的过度防御性代码」的既定取向，保持与它一致更好。

## 验证

| 项 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 受影响单测 | `cd apps/server && npx vitest run test/playEnv.test.ts test/agentkit.test.ts test/workshop.test.ts test/workshopPrompt.test.ts test/voiceTool.test.ts` | 5 文件 / 87 用例全过 |
| server 类型检查 | `cd apps/server && npx tsc -b --force` | EXIT=0 |
| web 类型检查 | `cd apps/web && npx tsc -b --force` | EXIT=0 |
| 运行时工具目录 | `GET /api/agents/tools` | workshop 15 条工具；`bash` 在「命令行」组、**不在**默认集；playwriter 拿不到 `bash` |
| 提示词章节收放 | `test/workshop.test.ts` 的「命令行章节随 bash 开关出现与消失」 | 勾上才出现 `# 命令行（bash）`，关掉即不含 |
| 实机冒烟 | worktree 起 dev（`./scripts/dev-worktree.sh --no-tunnel`） | 已起；`bash` 真跑一轮需要真 LLM 调用，留给用户按 `.validation.md` 的 C 组自行确认 |

未做浏览器 e2e（用户 2026-10-02 明确「以后别 e2e 了」）。

## 回归范围

`agentkit` / `workshop` / `workshopPrompt` / `voiceTool` / 新增 `playEnv` 五组用例；未跑全量。
`test/editFile.test.ts` 随 `editText.ts` 一并删除（测的是已不存在的实现）。
