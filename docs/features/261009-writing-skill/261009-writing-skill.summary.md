# 261009 编剧技能：技能库对剧作家开放

## 需求

用户要求：调研通用的剧本编写／故事设计／人物设定／台词编写技艺，写成一份编剧技能放进技能库。

用户对这份技能的两条硬要求：
1. **叠加而非限制**——读完能写更宽的东西，不能把什么故事都锁进好莱坞三幕套路；风格无关（文风归剧目自己的 `craft.md`）。
2. **文笔不能有 AI 腔**。

## 做了什么

### 1. 调研（保留）

四份调研报告，`docs/freeform/`：

- `261009-story-structure.research.md` —— 麦基、Truby、Egri、Save the Cat 及其批评、起承转合／序破急，以及各框架的适用边界。
- `261009-character-dialogue.research.md` —— 想要／需要／自欺／前史、三种弧光、关系网与对手；台词的目标、潜台词、说明的出路、声音区分。
- `261009-interactive-narrative.research.md` —— 视觉小说的分支拓扑（共通线／角色线／阶梯／分叉合流）、组合爆炸的工程现实、假分支。
- `261009-ai-writing-craft.research.md` —— StoryScope（叙事层特征 93.2% macro-F1，洗掉表层 AI 味后仍 93.9%）、LAMP 七类编辑诊断、先规划后写作的实证。

### 2. 技能库对剧作家开放（保留）

此前 `read_skill` 只装给工坊，剧作家的 A 区也不注入技能清单。改动：

- `agentkit/kit.ts`：`skill` 能力与 `read_skill` 工具的 roles 都加上 `playwriter`；`playwriterTools()` 装 `createReadSkillTool()`。
- `agentkit/contract.ts`：`CAPABILITY_MATRIX` 的 `skill` 条目 roles 同步。
- `prompt.ts`：`PromptContext` 增 `skills?: string`；新增 `skillSection()`，在 A 区 `HOW_I_WORK` 之后注入《技能库（跨剧目的通用做法）》一章。
- `skills.ts`：清单块改进程内 memo，新增 `preloadSkills()` / `skillsPromptBlock()`。
- `index.ts`：启动时 `await preloadSkills()`（A 区是同步装配的，不预载取不到清单）。
- `orchestrator.ts`：`buildAgent()` 传入 `skills: skillsPromptBlock()`。

两个刻意的设计点：

- **那一章不点名任何一份技能**。第一版写死了 `read_skill("galgame-writing")`——技能改名、下线或还没写出来时，那就是一句指向空气的指路。现在清单里有什么就读什么。
- **`skill` 能力对剧作家默认开**，可以在 Agent 页关掉（关掉 = 该剧目里剧作家看不到技能库）。

### 3. 技能正文（已作废）

`expert` 子代理基于上述四份调研从零写的 `apps/server/skills/galgame-writing/SKILL.md`（389 行）被用户判定文笔不合格，**整份作废**，计划另找人重写。文件已移出技能库到 `/root/downloads/261009-galgame-writing.rejected.md`——留在技能库里会被两个 agent 的提示词列出来、还能被读，与"作废"矛盾。

**重写时这份技能落在 `apps/server/skills/<名字>/SKILL.md` 即可被两个 agent 读到，不需要再动代码。** 名字取什么都行，A 区那一章不依赖具体名字。

## 验证

- `pnpm --filter @aivn/server typecheck` 通过。
- `pnpm check:agent-contract` 7 项全过。
- `pnpm --filter @aivn/server test test/agentkit.test.ts test/promptCapabilities.test.ts` 39 条全过；`test/prompt.test.ts test/workshop.test.ts` 95 条全过。
- 已知（与本次改动无关）：`test/workshopPrompt.test.ts` 有 3 条陈旧用例在本次改动前就失败（断言的 `defaultVoiceId`、`**交给用户落盘**` 已迁进技能 `galgame-play-setup`；「技能库关掉时不含 read_skill」那条实际由 `can.files` 门控）。

## 未做

- 技能正文的写作（用户另找人重写）。
- 剧作家侧的技能内容验收（等重写版落地）。
