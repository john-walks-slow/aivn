# 261009 预设看到宿主全局 skill 与指令 —— 落地记录

需求原话（用户 2026-10-09）：「剧作家不应该看到全局的 skill（例如 `root/.dsh/skills`）和指令（例如 `root/.dsh/AGENTS.md`）」。

根因与机制见同目录的 [troubleshoot](261009-preset-host-isolation.troubleshoot.md)；检视结论见 [review](261009-preset-host-isolation.review.md)（条件准入，建议项已全部处理）。

## 改了什么

dsh-aivn 侧（`/root/projects/dsh-aivn`）：

| 文件 | 改动 |
| --- | --- |
| `src/playwriter/preset.ts` | 两个预设共用的 `rows()`：删掉 `@deepseek-ai/dsh-agent-instructions` 一行（连 `DSH_HOME` / `INSTRUCTION_BYTES` 常量与 `homedir` 导入）；技能库三行（`dsh-skill` / `dsh-skill-filesystem` / `dsh-tool-skill`）收进 `{ name: 'cordis:group', group: true, isolate: { skills: true } }` 组，预设拿到一份**私有**技能注册表（global layer 为空） |
| `lib/index.js` | 构建产物，随源码重建 |
| `e2e/verify-injection.mjs` | 新增 A15（会话日志里没有 `source.kind === 'agent-instructions'` 的消息）、A16（技能清单只列 `aivn-*`） |
| `README.md` / `README.en.md` / `AGENTS.md` | 同步预设行集与技能库的描述、记下这两条隔离别被「顺手简化」 |

代码落点（dsh-aivn）：`2a998c6`（与另一个 Agent 的「立绘色键底色」同笔提交）、`9db31f4`（跟进的措辞收敛与判据加固）；本文档在 stage-ai 的 `74bca213`。

## 验证

实例：`dsh-e2e`（worktree = 本仓库，工作区 = 仓库根——它自带一份 `AGENTS.md`，正是「工作区指令会漏进来」的最好靶子）。

| 跑法 | 结果 |
| --- | --- |
| 旧行集（把 `lib/index.js` 临时打回改动前）+ 默认实例 | `verify-injection` → **A15 ✗**（`agent-instructions` 消息确实在），其余通过 |
| 新行集 + 默认实例 | `verify-injection` **20/20** |
| 新行集 + `--extra @aiwayds/dsh-subagent-registry:<path>`（宿主全局层真的挂了 provider，`$DSH_HOME/agents/` 被播种出 workhorse/oldfox/rubber-duck 证明它 apply 过、工具表里出现 `use_agent`） | `verify-injection` **20/20**，A16 报「宿主全局 provider 在位，清单仍只有随包的 aivn-*」；`verify-stagehand` **22/22**（S11/S12 证明搭台助手那半边同样只列三份 aivn-*） |

判据的牙：A15 有牙（旧行集实测变红，且改成按类型化 `source.kind` 认、文案判据留作兜底，不再只依赖上游措辞）。A16 只在宿主全局层挂了 provider 时才有区分度——裸跑时宿主全局层本来就是空的（web 剖面关掉了宿主 `skill-filesystem`），所以 A16 自己把这条前提打印出来，并给出让前提成立的一行命令。

残差记录：最后一次判据加固（A15 加文案兜底）与 `preset.ts` 的注释收尾未再复跑——都属注释与更严格的断言，行为面未变，上面三次实跑覆盖的是行为面。

## 已知残差（本轮不动，已记在 troubleshoot 末节）

1. **冷会话的 `/skill` 菜单**会回落到宿主注册表（上游 `sessionSkillCatalog.list` 的 `presets.serviceFor(live,'skills') ?? ctx.get('skills')`）：Agent 未 resume 的窗口里菜单列宿主技能、不含三份 aivn-*。命中后走 realm 解析找不到就不注入，静默无操作。
2. **非 web 剖面**：宿主平面的 `agent-instructions` 监听器预设管不着，`dsh-base` 直出的剖面仍会注入宿主 `AGENTS.md`。
3. 宿主平面的**全局提示词段**（「You are an AI agent powered by DeepSeek Harness」、Web GUI 段、deliverable-file-references 等）照旧在剧作家/搭台助手的提示词里——既有状况，与本次的 skill/指令隔离无关。
