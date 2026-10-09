# 检视报告

## 概要

检视范围：`src/playwriter/preset.ts` 的行集隔离（去掉 `dsh-agent-instructions`、技能库三行进 `isolate: { skills: true }` 组）、`e2e/verify-injection.mjs` 的 A15/A16、两份 README 的同步描述、`lib/index.js` 构建产物；另看到 `AGENTS.md` 的「预设行集」段与 issue 记录（`…troubleshoot.md`）为同一笔改动的配套文档，一并核对。改动**方向正确、机制成立**，两层隔离在 DSH 里都走的是上游明确支持的路径（realm 内私有服务 + `entry.parent.ctx[Context.isolate]` 的符号继承；上游内置预设 `standard.patch.yml` 就是这么隔离 `planMode` / `compaction` / `workflowEngine` 的）。我另外用只读方式复核了 e2e 会话日志与 DSH 源码，结论是：**主诉症状已消除**，但有三处残留（宿主行在非 web 剖面仍会注入、冷会话的浏览器技能清单读宿主的注册表、A16 在默认实例里没有牙），以及若干文档口径过满。

## 需求对齐

需求（「这两个预设不该看到宿主的全局 skill 与指令」）**已满足**，且我有独立于作者自述的证据：

- 改动后的会话日志（`.dsh-e2e-home/sessions/--root-projects-dsh-aivn--/session-4e5f4a33…` 17:20、`session-37489724…` 17:22，`zstd -dc` 解出后只读比对）：系统提示词里既无 `Instructions from:`、也无本仓库 `AGENTS.md` 的正文；全部事件里不含 `agent-instructions` 这个消息 source；`<available_skills>` 恰为 `aivn-audio` / `aivn-play-setup` / `aivn-visual-craft`。
- 改动前的会话（同目录 `session-57708846…` 17:21 及 10-06 起的历史会话）：`user/message` 事件带 `"source":{"kind":"agent-instructions","form":"instructions","baseline":true,…}`，正文就是 `Instructions from: AGENTS.md` + 仓库 AGENTS.md 全文——问题现象与 troubleshoot 的判断一致。
- 隔离在**宿主全局 provider 在位**时成立：17:22 那次实例确实装了第三方 `@aiwayds/dsh-subagent-registry`（该会话 `request/header` 的工具表里有 `use_agent` / `ask_agent`），而技能清单仍只有三份 `aivn-*`。这正是本次问题的关键场景（用 `ctx.skills.registerProvider` 往 global layer 塞 runtime skill 的插件）。
- 顺带修掉了一处**人设自相矛盾**：`src/stagehand/prompt.ts:127` 的《技能库》章原本宣称清单是「做法速查…清单里没有的事，就按这个剧目的实际情况办」，而改动前清单里混着 `dsh-subagent-registry-config` 这类本机运维技能。

与计划/spec 的差异：本项是问题修复类，无 plan 文档；troubleshoot → 修法的对应关系成立。

**检视范围声明**：本次提交（`2a998c6`）同时含「立绘色键底色 `keyColor`」这条不相干的功能（`src/media/*`、`e2e/verify-media.ts`、`skills/aivn-visual-craft`，以及两份 README 里 `generate_asset` / `keyColor` 那几行）。按检视范围要求，那部分**未纳入**本次检视（README 的 keyColor 行只做了顺带目视，未与本仓 `src/media/*` 对照核实）。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| M1 | `e2e/verify-injection.mjs:179-186` | **A16 在默认实例里没有牙**：默认 `dsh-e2e` 剖面的宿主 global layer 本来就是空的（`dsh-web-app/cordis.patch.yml` 关掉了宿主 `skill-filesystem`，`skill-badge` 亦关；`skill-office` / `sandbox-windows-acl` 不在此剖面），所以改动**前**行集下清单同样只有三份 `aivn-*`。实证：17:21 那次就是旧行集（同一份日志里有 `agent-instructions` 注入），它的清单仍是三份 `aivn-*` → A16 ✓。也就是说：未来有人把 isolate 改回去，默认跑法下 A16 依然会绿。它只在宿主全局 provider 在位时咬人（`--extra @aiwayds/dsh-subagent-registry` 那次才有意义） | 把「宿主全局 provider 在位」变成**显式前提 + 守卫**，照本仓既有惯例办（`verify-settings.mjs` 会读 `instance.json` 的 env 快照，前提不满足就打印说明并以退出码 2 结束）：要么让 `injection` 模块守卫「实例是以 `--extra @aiwayds/dsh-subagent-registry` 起的」，要么给 e2e 自带一个宿主全局 skill 夹具（`dsh-e2e start --patch <overlay>` 加一层宿主行指向夹具插件，让 `ctx.skills.registerProvider` 落在 global layer）。若两者都不做，请在 A16 的注释里写明「本判据只在宿主存在全局 provider 时有区分度」，别让人以为它守着这条回归 |
| M2 | `src/playwriter/preset.ts:69`（注释）、`README.md:394`、`README.en.md:336`、`AGENTS.md:72-77`、`…troubleshoot.md:43` | **「浏览器侧也按 realm 找到它 / 两个预设都不看宿主的技能与指令」说过头了**。(a) 浏览器侧只在**活着的**会话上按 realm 找：`dsh-api-session-controller/lib/index.js:2293` 是 `presets.serviceFor(live,'skills') ?? this.ctx.get('skills')`，冷会话（未 resume agent）回落到**宿主注册表**，scope 用 `agentPresets.acquireScope` 给的 generation key（同文件 `:2318-2326`、`dsh-agent-preset-registry/lib/index.js:776`）——于是冷会话的 `/skill` 菜单 = 宿主 global layer（含第三方 runtime skill），且**不含**三份 `aivn-*`；(b) `dsh-agent-instructions` 的注入走的是宿主行的 `agent/pre-step` 监听器（`dsh-agent-instructions/lib/index.js:1271`），宿主那一行只是**在 web 形态下被关掉**（`dsh-web-app/cordis.patch.yml:549`），而 `dsh-base` 默认是开的（`dsh-base/cordis.patch.yml:289`），默认 profile bundles 恰好就是 `['@deepseek-ai/dsh-base']`（`dsh-app-boot/lib/index.js:543`）——即：装在非 web 剖面（或用户自己把那行打开）时，这两个预设仍会拿到 `$DSH_HOME/AGENTS.md` + 工作区 `AGENTS.md`，预设层没有任何手段阻止 | 把口径改准：①预设「自己不装」≠「一定没有」，前者成立、后者只在宿主行缺席时成立；②浏览器侧那句改成「活着的会话按 realm 找到它」并记下冷会话的残差；③`troubleshoot.md:45` 的「不加 isolate 会被 `leakedServices` 拒绝装配」应改为「宿主已注册时会先撞 `service "skills" has been registered`；宿主没注册时才会被 `leakedServices` 判为 root-realm 泄漏」——两条路的结论都是装配失败，但机制不同（`mountPreset` 的两道守卫在 `dsh-agent-preset-registry/lib/index.js:272-274`：先抛行级失败、再抛 `Preset services require isolate realms`） |
| M3 | 验证证据（缺一半） | 本次只跑了 `verify-injection`（剧作家）。搭台助手那半边未被复跑，而它正是用户实机先撞见的那个预设（troubleshoot 里 `demo` 会话用的是搭台助手）；它的 `verify-stagehand.mjs` S11/S12 恰恰是「私有注册表仍能列出三份 `aivn-*`」的正向判据 | 复跑一次 `e2e/verify-stagehand.mjs`（成本约为 0–1 拍 LLM）确认 S3–S12 仍绿；两预设共用 `rows()`，风险不大，但 15 秒的确认能消掉「另一侧被 isolate 弄空」的猜测空间 |
| M4 | `e2e/verify-injection.mjs:168-177` | A15 是**对着上游英文文案**做的负向断言（`workspace instruction` 命中三条 intro 之一）。它在今天有效（我确认旧日志确实命中、新日志确实干净），但 DSH 一旦改措辞就会**静默变成永远绿**——负向断言最怕这种漂移 | 换成**类型化判据**：断言全部事件里不存在 `source.kind === 'agent-instructions'` 的 message（旧日志里这条消息带 `"kind":"agent-instructions"`，字段稳定且语义明确，已实证可读），并保留现有文案判据做兜底 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| N1 | `e2e/verify-injection.mjs:171` | `allText(sessionEvents(sessionDir))` 又解了一遍会话日志（这一条前面已经解过两次，每次都是全量 `zstd -dc`，缓冲上限 64MB）。不是缺陷，只是白花的 I/O | 复用循环里已取到的 `events`（`const events = sessionEvents(sessionDir)`），或让 `allText` 接收现成的事件数组 |
| N2 | 系统提示词实测内容（改动后会话） | 两个预设的提示词里**仍有宿主侧的全局提示段**：开头 `You are an AI agent powered by DeepSeek Harness.`、结尾的 Web 界面段（`You are interacting with the user through the DeepSeek Harness Web GUI at …`，含 HMR / `pnpm run dev:web` 之类）、`ui:deliverable-file-references`（教 `present` / 图片 markdown / 文件链接写法，而剧作家手里没有 `present`）、以及 harness checkout 路径段。它们都是宿主 plane 的全局段（`dsh-web-app/lib/index.js:179-184`、`dsh-client-ui-deliverables/lib/index.js:257`、`dsh-app-boot/lib/index.js:4127`），本轮改动**动不到**，属既有状况。但需求原话是「只需要 persona + A 区注入 + 随包三份 skill」，现实不是 | 若在意：`systemPrompt` 的段是分层的且「同名作用域段会盖掉全局段」，本插件已经按 `agent.ctx` 注册作用域段（`src/play/play-context.ts:141` / `src/stagehand/context.ts:114`），照同样办法用空文本段遮掉 `app:web-surface` / `harness:source` / `ui:deliverable-file-references` 即可（空文本段会被 `renderSections` 过滤掉）。这是范围决策：遮掉后模型就不知道 GUI 地址了，需要你拍板；不遮也行，但请在 README 里把「不看宿主的指令」限定为「不注入 AGENTS.md」 |
| N3 | `2a998c6` 提交形状 | 一笔提交里混了两个不相干的功能（预设隔离 + 立绘 `keyColor`），描述也把两者并排写。事后回溯「哪一笔引入了预设行集变化」时需要额外辨认 | 后续遇到同类情况拆笔提交（本仓 `commit-own-changes` 的 hunk 级提交正好支持） |
| N4 | `README.md:411` / `README.en.md:346` | 「技能库是**私有**的…宿主上那几十个本机运维技能、以及第三方插件代码里注册进来的技能，都不该挤进这两个预设的清单」——在模型面上成立 ✓；但浏览器 `/skill` 面在冷会话下不成立（见 M2-a）。读者会把两件事读成一件 | 与 M2 合并处理即可，无需单独改 |

## 准入结论

**结论**：`条件准入`

**说明**：无阻塞问题——主诉症状已被独立证据确认消除，机制走的是上游支持的隔离路径，`lib/` 已重建（`grep` 见 `cordis:group` / `isolate: { skills: true }`，且不再有 `dsh-agent-instructions` 行）。但存在四条建议修改项：其中 M1（A16 的区分度）与 M2（文档口径过满，含冷会话残差与「非 web 剖面宿主行仍会注入」）建议在合并前处理——它们都不影响产品行为，却直接影响这条回归将来还拦不拦得住人、以及维护者读到的结论对不对；M3/M4 是低成本的验证与判据加固。
