# 检视报告：删除出图审批 + 剧作家补充要求

## 准入结论

条件准入 —— 代码链路、归一化、UI、测试与文档同步都干净且 `pnpm typecheck` / 相关用例全绿，但 `galgame-visual-craft` 技能里还留着「出图前要拿到批准／用户点头之后再 `generate_image`」的门禁原文，而搭台提示词明令第一次出图前先读它——需求 2 想要的效果在执行面上被这份技能抵消，需一并改掉。

## 阻塞问题

- **`apps/server/skills/galgame-visual-craft/SKILL.md:272-281` 门禁原文没跟着删**：
  - 274 行「按搭台流程，出图前要拿到批准。」+ 281 行「用户点头之后再 `generate_image`。」
  - 影响：`apps/server/src/workshop.ts:323` 明令「**第一次出图前先 read_skill("galgame-visual-craft")**」，所以搭台助手在每个「准备开跑出图」的决策点上读到的最新一条恰是这句硬门禁；新提示词「所以惯例是**先列一张图单**——要出几张、分别是什么——跟他对一下再开跑」（`workshop.ts:205-207`）是惯例陈述，两者并存时模型只会照更硬的那句做——「做事过慢」这个被产品点名的毛病原样保留，等于本次精简只在提示词层生效、没落到执行层。同一份「列图单」流程在 `galgame-play-setup/SKILL.md:20-23` 已改成惯例口径，两份技能现在各说一套（正是该改动自己写下的「避免提示词与技能各说一套」那条标准）。另外该技能是**两个 agent 都能读**的共享技能，措辞也会漏进剧作家上下文，而剧作家在演出中根本拿不到用户批准。
  - 建议改法（保留清单格式这个有用的部分）：把 274 行改成「出图要钱也要时间（立绘一张 100 秒起），**惯例是先把场景清单摆给用户对一下**，一行一个」，删掉 281 行「用户点头之后再 `generate_image`」这句命令。

## 建议

- **`orchestrator.ts:638` 的取值为何不走 `opts.agents`**：`customPrompt: opts.play.agents?.playwriter?.prompt` 与同一构造里已有的 `opts.agents`（`playhouse.ts:1353` 传的正是 `play.agents?.playwriter`）是同一份数据，两处口径不一，后人加字段容易漏一处。换成 `opts.agents?.prompt`，并把 `PlaywrightOrchestratorOptions.agents` 的注释（`orchestrator.ts:288-293`「这里只用思考档位与工具开关」）补上 `prompt`。
- **「末尾」这处措辞与实际注入位置不符**：`packages/core/src/play/config.ts:144`、`config.ts:352-354`、`README.md:755` 都写「追加到系统提示词**末尾**」，但剧作家那段实际落在 `# 演出契约（引擎规则，不可改）` **之前**（末二段，`prompt.ts:481-490`）——只有 `apps/server/AGENTS.md:133` 写对了。四处统一成「拼在引擎契约之前」即可。
- **补三条现在没人守的断言**：① `orchestrator.buildAgent` → `buildSystemPrompt` 的接线（`prompt.test.ts:341-350` 只测了 `buildSystemPrompt` 本身，把 `orchestrator.ts:638` 整行删掉不会有测试变红，而这条正是本需求的核心链路）；② 旧 `play.json` 残留的 `agents.*.imageApproval` 被归一化静默丢弃、不炸解析（`261010-workshop-config.plan.md:34` 承诺了这条，`config.test.ts` 里没有对应用例）；③ `AgentPane` 两张卡各有一个「补充要求」输入框（`apps/web/test/agentModelOptions.test.tsx:32` 只钉了 combobox 数量 6，两个 textarea 没有任何断言）。
- **剧作家卡的 placeholder 举错了例子**：`AgentPane.tsx:26-31` 给的示例是「文风偏冷硬，对白别用感叹号；每轮结尾留一个悬念」——这正是 `README.md:755` 与 plan 里说该走 `memory/always/craft.md` 的**长期写作口径**（README 同一行也用了「文风偏冷硬」当例子，两处一起调）。建议换成「这个剧目额外怎么做事」类：如「本作不说日语」「涉及凶案的情节先问我一句」，与搭台卡那句举例也能区分开。
- **跨线（dsh-aivn）**：本次动了共享包 `@aivn/core`（`AgentSettings.prompt` 的归一化），按 `docs/references/261009-cross-host-verification.md` 需重建 DSH 侧 `lib/`（`npm run build` + `node build.mjs --check`）。另外 DSH 线的 A 区不读 `agents.playwriter.prompt`，那边该字段现在会被 core 保留但依旧不生效（不报错、也不落地）；`dsh-aivn/skills/aivn-play-setup` 的图单口径仍是「出候选、拿到点头再入库」。两条线要不要对齐属另开一笔，本次范围只覆盖独立版，记录备查。
- 合并前按 AGENTS.md 跑一次 `pnpm -r build`（本地 `packages/core/dist` 已不含被删类型，但共享包改动后重建是例行规矩）。

## 非阻塞问题

- **`playhouse.reload()` 没有等轮边界，而 `PUT /api/plays/:id/play` 直接调它**（`http.ts:391` → `playhouse.ts:541-547`）：同族的 `reloadAfterWorkshopWrite`（:765，其中 :769 等空闲）、`switchSave`（:738）、`dropRuntime`（:364）、`buildStageRuntime`（:324）都 `await old.orchestrator.whenIdle()`，唯独 `reload()` 直接 `buildRuntime` 后 `dispose()`（`orchestrator.ts:738` 会 `agent.abort()`）。所以 Agent 页保存（新的剧作家补充要求，也包括原有的模型/思考档位/能力）在演出进行中会腰斩当前这一拍；`README.md:660`、`README.md:807`「走轮边界重建、不腰斩演出」与 plan 的同一句承诺在这条链上没有代码保证。**这是预存在问题**（本次只是新增了一句同样的断言），但既然文档现在把「轮边界」写实了，要么给 `reload()` 补 `whenIdle()`，要么把这句收敛成「下一轮起生效」。
- 无效的「补充要求只在搭台卡」残留已清零：`imageApproval` / `IMAGE_APPROVALS` / `ImageApproval` / 「用户没点头」「出图审批」在 `apps/`、`packages/`、根 `README.md` 的现有源码面里一处不剩（`apps/server/AGENTS.md:134` 是明确写着「已删」的留痕，属有意）。剩下的命中只有历史 feature 文档（`docs/features/261004-*`、`261005-*`、`261006-*`）与 `261004-ui-overhaul/mockup/index.html`，均为历史记录，不必回改。
- `apps/server/skills/galgame-play-setup/` 下只有 `SKILL.md`，没有 `README.md`（需求清单里点名的那个 README 是仓库根那份，已同步）。
