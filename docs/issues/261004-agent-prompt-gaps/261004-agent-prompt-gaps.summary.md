# 两个 agent 的提示词缺口（语音语言 / play.json 字段面 / 工具错配） 小结

## 背景

三处提示词层面的缺口，用户侧的表现都是**静默失效**（改了没效果、没声音、带外语口音），
排查成本高而修法很小：

1. **挑音色不看剧目的语音语言**：工坊提示词只教「voiceId 用 `list_voices` 查出来再填、按人设挑」，
   `WorkshopPromptContext` 里根本没有 `voiceLanguage` 字段，`list_voices` 的描述也只把它当普通筛选项。
   于是中文剧本（语音语言默认「跟随剧本语言、不翻译」）配上日语音色，台词就是日语音色念中文。
2. **play.json 没有字段表**：工坊提示词只写了 `cover` 一个字段。缺省字段（`voiceLanguage` /
   `defaultVoiceId` / `protagonist` / `agents`）压根不在文件里，`read` 也读不出来；
   字段名猜错会被 `parsePlayConfig` 静默丢弃（它只取认识的键），用户看到的就是「改了没生效」。
3. **工具可见性错配**：`create_character` 只装给剧作家、`list_voices` 只装给工坊，
   而 `create_character` 的描述却教剧作家「voiceId 先用 `list_voices` 查出来再填」——
   它只能留空或编一个 32 位 hex，两者都静默无声。

## 做了什么

- **语音语言进提示词**：`WorkshopPromptContext` 新增 `voiceLanguage`，由 `workshopSession.systemPrompt()`
  现读 `play.json` 注入（与 `customPrompt` 同一时刻，改完设定页下一轮就生效）。
  新增 `voicePickHint()` 生成那半句：语音语言已设 → 先按 `language="<值>"` 筛；未设 →
  「按剧本的书写语言筛（中文剧本用 `language="zh"`）」。`list_voices` 的描述补上语言这一维的后果
  （不匹配的嗓子会让整段台词带口音念出来）。
- **play.json 字段表**：工坊 `writingPoints` 新增一条，列出全部字段与「缺一个不报错、只是效果静默消失」
  的代价，并要求定点 `edit`、不要整篇 `write` 覆盖。
- **错配修正**：`create_character` 的 voiceId 注释改成「可省；音色由搭台助手在工坊配」，
  不再点名剧作家调不到的工具。
- 顺手修掉 `memoryTool.ts` 里三个损坏的替换字符（`音色的���话描述` → `音色的口语描述`）。

## 改动面

- `apps/server/src/workshop.ts`：`WorkshopPromptContext.voiceLanguage` + `voicePickHint()` +
  `writingPoints` 的 play.json 字段表。
- `apps/server/src/workshopSession.ts`：现读注入 `voiceLanguage`。
- `apps/server/src/agentkit/voiceTool.ts`：`list_voices` 描述补语言这一维的后果。
- `apps/server/src/agentkit/memoryTool.ts`：`create_character` 的 voiceId 注释 + 编码修复。
- 测试：`test/voiceTool.test.ts`、`test/workshopPrompt.test.ts`、`test/orchestrator.test.ts`（记忆工具组）
  各加一条回归。
- `apps/server/AGENTS.md`：提示词装配一节记下这三条经验。

## 关键约束（后续改动别踩）

- **语言这一维分两处写**：剧目的值（`voiceLanguage`）在系统提示词里，后果在 `list_voices` 的描述里。
  把值也写进工具描述就等于写死，把后果搬进提示词就与工具描述漂移。
- **可选字段的 schema 必须写进提示词**：缺省字段不在文件里、read 读不出来，只有提示词能告诉它字段名存在。
- **工具描述里不能提对方角色才有的工具**（剧作家没 `list_voices`、工坊没 `create_character`）。

## 验证

见同目录 `261004-agent-prompt-gaps.validation.md`。静态验证：`pnpm typecheck`
与相关测试（voiceTool / workshopPrompt / promptCapabilities / agentkit / workshop / orchestrator 记忆工具组）全绿。
