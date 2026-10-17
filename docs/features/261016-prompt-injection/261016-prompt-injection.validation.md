# 261016 提示词注入（并下线动态切换型限制级通道）延迟验证记录

## 验证说明

- 验证对象：① 限制级（NSFW）动态切换通道整体下线（不再给 Agent 暴露工具、设置页与 Agent 页不再显示相关字段）；② Agent 页新增「提示词注入」：一组用户/系统/工具/助手消息注入到**工坊与剧作家**上下文的开头，并支持 preset 存取。
- 环境/前置条件：本 worktree 的 dev 实例（公网隧道随实例变化，见交付留言）。示例剧目「注入验收」（id `inject-probe-v2`）是专门为这次验收建的。
- **基底说明**：这项工作的第一版写在 10-16 从**旧主线**切出的 worktree 上（当时 main 被 reset 回 origin/main）。新主线（`a09cb969`）与本项工作本已提交的 `a356a25c` 之间有 659 个文件不同、`apps/web` 是整体重写的，硬解 rebase 冲突会把旧外壳带回来。因此这一版是**按新界面重写一遍**（服务端与 core 的部分按语义重放，web 的注入一节按新主线的令牌与窄屏规矩重写），验收也只认这一版。

## 延迟决策记录

| # | 环节 | 原本需要确认的问题 | 采取的决定 | 依据/理由 | 状态 |
|---|------|--------------------|-----------|----------|------|
| 1 | 范围界定 | 「相关代码可以不删」到什么程度 | 只摘**入口**（能力目录 / 工具装配 / 提示词章节 / 两处表单），`orchestrator` / `rebuild` / `lineage` / `memory` 的通道状态机原样保留 | 整段删要动两条发行线共享的谱系模型（`LineagePayload.nsfw` / `LineageSnapshot.nsfw`），风险远大于收益；入口没了它自然不可达 | 待确认 |
| 2 | 数据落点 | 注入内容存哪 | `play.json` 的 `agents.injection = { enabled, messages[] }` | 「agent 设置」页编辑的就是 `agents` 段；开关与内容都是逐剧目的 | 待确认 |
| 3 | 作用范围 | 两个 agent 各存一份还是共用一份 | **一份共用**，注入到剧作家与搭台助手两边 | 需求原话是「往工坊与剧作家的上下文开始都注入」；分成两份会让同一个剧目的两个 agent 对世界的认知分家 | 待确认 |
| 4 | preset 的层级 | preset 跟剧目走还是跨剧目共用 | **应用级** `<数据目录>/prompt-presets.json`，REST `GET/PUT/DELETE /api/prompt-presets` | preset 的用处就是换个剧目还能用同一套开场；跟剧目走就失去意义 | 待确认 |
| 5 | `tool` 角色的实现 | 「工具提示词」是当文本注还是当真实工具结果注 | 落成「一次 assistant 工具调用 + 紧随其后的 `toolResult`」两条消息；界面上标成「工具结果」 | 协议要求工具结果必须与调用成对，裸 `toolResult` 会被 OpenAI 兼容层 400（已用真模型跑一轮验证上游收得下） | 待确认 |
| 6 | 系统提示词的位置 | 注入组打头的 `system` 会不会顶掉引擎提示词 | 首条系统消息由 `agentInitialMessages` 自己用 `createInitialSystemMessage` 落，注入排在它后面 | pi 只在 `messages[0]` 不是 system 时才插入 `initialState.systemPrompt`——实测打头的注入 system 会让引擎提示词整段消失（DSL 契约与工具声明都在里面） | 待确认 |
| 7 | 测试取舍 | 下线后的 NSFW 编排用例怎么办 | 删掉 `orchestrator.test.ts` 里整个「限制级（NSFW）模式切换与上下文隔离」describe（10 条），另加一条「提示词里再没有它的入口」 | 那批用例测的是已经不可达的路径，留着只会误导；运行时代码保留的事实写进 `apps/server/AGENTS.md` | 待确认 |
| 8 | 游戏内按钮的入口 | 舞台上的限制级角标 / 工具行标签要不要一起摘 | **不动**（`useStageSocket` 的通道角标、`TurnParts` 的工具名表） | 用户点名的两处是「工具不暴露、设置不显示」；角标是运行时情形回显，通道已不可达，它自然不出现 | 待确认 |
| 9 | 未触碰的既有失败 | `apps/web/test/playPane.test.tsx` 有 1 条失败 | 不动 | 在主工作区同一条用例上复现（`素材来源：音乐与音效` 找不到 label），与本次改动无关 | 待确认 |
| 10 | 是否合入主分支 | 改完是否直接合 main | 先不合，等用户点头；用户 10-17 明确「合并吧」后用 `merge-to-main.sh` 变基 + ff-only 合入（`0afec136`） | worktree-dev 规矩：合入主分支必须获用户显式同意 | 已合入 |

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| -------- | -------- | -------- | ---- | --------- |
| 起 dev 实例并打开工坊 Agent 页 | 界面是新主线那套：左轨「舞台 / 工坊」胶囊 + 竖排 7 页签 + 左下「已连接」 | 一致（页签读回：舞台/工坊/对话/剧目/角色/记忆/素材/文件/Agent） | 待验证 | `.shots/v2-agent-pane.png` |
| 看 Agent 页末尾 | 有「提示词注入」一节：启用开关 + 消息行 + preset 行 | 有 | 待验证 | `.shots/v2-injection-section.png` |
| 该剧目盘上已有两条注入（system + tool），刷新页面 | 两条原样渲染，开关保持勾选 | 行数 2，角色 `system` / `tool`，开关 true | 待验证 | 读回路径 |
| 删一条 → 「添加一条」补回（助手）→ 保存设置 | play.json 的 `agents.injection` 变成这两条 | `{enabled:true, messages:[system…, assistant…]}` | 待验证 | |
| 「保存为 preset」→ 看 `<数据目录>/prompt-presets.json` | 出现同名那一份 | 出现 `虚构声明-v2`，内容与界面一致 | 待验证 | |
| 刷新页面 → 删空所有行 → 选 preset → 载入 | 两条消息回来 | 0 → 2 行，回执「已载入…」 | 待验证 | `.shots/v2-injection-loaded.png` |
| 390 宽打开同一页 | 一行折成两行（角色 + 删除 / 正文独占），不出现竖排中文、不横向溢出 | 溢出 0px，版式如预期 | 待验证 | `.shots/v2-injection-mobile.png` |
| 打开 `#/settings` | 不再有「限制级（NSFW）专用模型」「限制级专属提示词」 | 页面文本已无「限制级 / NSFW」 | 待验证 | `.shots/v2-settings-no-nsfw.png` |
| **真模型跑一轮**（工坊对话页发一句，注入里带一条 `tool`） | 上游收得下这组消息（不成对会被 400），且模型确实读到了注入 | 无失败条；思考里逐字复述了注入的系统指令，回复正文引用了注入的「前情：2077 年、海边小镇、刚搬来的侦探」 | 待验证 | `.shots/v2-live-turn.png` |

## 验证结论

待验证。自动化与真模型两条路都已跑通（单测 + 前端实跑 + 真模型一轮）；合入后在新 main 上又复验了一遍构建、类型、契约守卫与受影响的用例，全绿。

## 待跟进

1. **DSH 侧（`dsh-aivn`）**：这次动了 `packages/core`（`AgentConfig` 新增可选的 `injection` 字段 + 归一化）。按 `docs/references/261009-cross-host-verification.md`，共享包改动合入 main 后要在 `dsh-aivn` 跑一次 `npm run build` + `node build.mjs --check` 并把 `lib/` 同笔提交。改动是**纯增量可选字段**（dsh-aivn 不读 `agents.injection`），语义上不受影响。
2. `apps/web/test/playPane.test.tsx` 的 1 条失败是既有问题（主工作区同样失败），未处理。
3. 旧基底那份 worktree（`.worktrees/nsfw-off-prompt-inject`，分支 `feat/nsfw-off-prompt-inject`）留着没删，里面的提交可以随时对照——它没有合入，也不会再更新。
