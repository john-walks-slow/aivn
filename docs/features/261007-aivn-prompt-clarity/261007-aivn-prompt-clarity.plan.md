# dsh-aivn 提示词透明化与可维护性整理 · 实施计划

> 需求见 `261007-aivn-prompt-clarity.research.md`。常青真相源在 dsh-aivn `AGENTS.md`「提示词地图」。
> 本计划经 auto_human 评审（有条件批准）+ expert cross-check（门控取 (i)+(ii)）后定稿。

## 目标

三层 agent 提示词整理成「单一真相源 + 可查地图」：① 盘点沉淀成文档；② 内容下沉到 skill；
③ 精简去重、统一术语。**不做**运行期提示词覆盖机制、全量模板化、新增 skill 数量。

## 硬约束

1. 改 `src/` 必须 `npm run build` 并提交 `lib/`（`.githooks` 的 `build.mjs --check` 拦）。
2. `persona.prefix` 装载时烘焙（改动要重挂预设）；动态内容走 `systemPrompt.section`。
3. skill **没有能力位门控**（三份恒列）；persona 门控章随能力位消失 → **门控章不能整章下沉**，
   只能「正文下沉 + persona 门控指针」。
4. skill 两预设共用，下沉目标必须预设中立。

## 逐章归属

见 `research.md` §2（P=留 persona / S=下沉 / M=删）。

## 门控规则（要落成的硬保证）

- (i) skill 的 name+description 能力中立，不点名门控工具。
- (ii) skill 正文点名门控工具时必须条件化（「本剧目配了 / 没配 X 后端」两支都写）。
- persona 门控指针保留同名标题、随能力位出现/消失；e2e 据此判定。
- 修掉 `aivn-visual-craft` §7 现有的无条件点名（既有缺陷）。

## 分期

- **Phase A · 提示词地图**：dsh-aivn `AGENTS.md` 新增「提示词地图」（常青真相源）；本目录放证据快照。
- **Phase B · 去重**：删 stagehand `STYLE` 章；`assetGuide`/`MUSIC`/`IMAGE_CHAPTER`/`AUDIO_RULES` 瘦身；
  skill 正文门控工具去无条件点名。
- **Phase C · 下沉**：`aivn-visual-craft` 增「演出中缺图」；`aivn-play-setup` 增唯一「演出中引入新主体」；
  persona 门控章改门控指针；三份 skill description 更新。
- **Phase D · 命名 + 验证同步**：章名统一；e2e `verify-injection.mjs` / `verify-stagehand.mjs` /
  `verify-media.ts` 同步；双语 README 同步。

## 验收

`npm run build` / `typecheck` / `node build.mjs --check` / `npm run e2e:media`（离线静态）/ e2e
`stagehand`+`injection` 全绿；「未配后端」分支确认门控指针出现/消失、skill 描述能力中立、正文条件化。

## 明确不做

运行期提示词覆盖；全量模板化；动 A 区渲染逻辑与剧目文件格式；新增 skill；改 `@aivn/core` / DSL。
