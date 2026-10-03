# prompt-capabilities：两份提示词的能力位收成一套表达

## 背景

债务简报 `/tmp/debt-briefs/3-prompt-capabilities.md`：搭台助手刚把能力位收成 `can: AgentCapabilities`
（`{ image, search, library, voice, shell }`），剧作家这边还是 `prompt.ts` 里三个各自独立的可选布尔
（`canImage?` / `canSearch?` / `canLibrary?`）。同一个概念两种写法，下一次加能力位必然有人只改一边——
`can` 位决定提示词注不注某一章，漏改一边就是「教模型调一个它装不进去的工具」。

## 方案（含两处判断）

1. **形状：不加角色派生类型，两位读同一个 `kit.can`。** 曾考虑给剧作家裁一个
   `Pick<AgentCapabilities, "image" | "search" | "library">`，被否：那又是一次投影，加一位能力就多一处要改，
   正好是这次要消掉的病。改成 `PromptContext.can: AgentCapabilities` 后，生产侧一个调用点
   （`orchestrator.ts` 的 `buildSystemPrompt`）直接 `can: this.kit.can`，与 `workshopSession.ts` 的
   `can: this.kit.can` 同一句——能力位从「装配」到「提示词」只有一条路。
   代价是剧作家手里多了 `voice` / `shell` 两位数（对它恒为 false，工具压根装不上），以一条用例
   （`voice/shell` 打开时提示词逐字不变）钉住「不读就不用管」。
2. **字段按并集，且不再手写。** `AgentCapabilities` 从常量表 `CAPABILITY_TOOLS`（一位对应一个授权它的工具）
   派生：`type AgentCapabilities = Record<CapabilityKey, boolean>`，`kit.can` 由 `capabilitiesOf(已装的工具)`
   算出。加一位能力＝表里加一行，类型跟着长一位，忘了给某个角色的提示词收条件会被类型或测试顶上。
3. **`can` 必填，不再有「不传就是开」的隐式缺省。** 原来的 `imageChapter(ctx.canImage !== false)`
   在漏传时默认**开**——少给一个字段，模型就被教去调一个可能不存在的工具。改成必填后，
   漏传是编译期错误；行为上仍逐字等价（生产侧本来就恒传 `kit.can.image`）。

## 改动

| 文件 | 改动 |
| --- | --- |
| `apps/server/src/agentkit/kit.ts` | 新增 `CAPABILITY_TOOLS` 表与 `CapabilityKey`；`interface AgentCapabilities` → `Record<CapabilityKey, boolean>`；新增 `capabilitiesOf(tools)`；`createAgentKit` 的 `can` 改由它算（删掉局部 `has()`）。未碰 `TOOL_CATALOG` / `ROLE_INSTALLABLE` / `DEFAULT_ENABLED` |
| `apps/server/src/prompt.ts` | `PromptContext` 三个可选布尔 → 必填 `can: AgentCapabilities`；正文三处改读 `ctx.can.*`；`imageChapter(ctx.can.image)` |
| `apps/server/src/orchestrator.ts` | 唯一生产调用点：三个 `canXxx: this.kit.can.xxx` → `can: this.kit.can` |
| `apps/server/test/helpers.ts` | 新增共用构造器 `caps(over)`（缺省＝生图开、库与联网关，与原剧作家测试的实际缺省一致） |
| `apps/server/test/prompt.test.ts` | 28 处调用改走本文件的薄包装 `build(ctx)`，能力位改用 `can: { image: true }` 这类写法（断言语义不变） |
| `apps/server/test/compaction.test.ts` | 唯一一处直接调用补 `can: caps()` |
| `apps/server/test/promptCapabilities.test.ts`（新增） | 8 条回归用例，见下 |

**未动**（简报边界）：`workshop.ts`、`playFiles.ts`、`playEnv.ts`、`workshopSession.ts`。

## 新增回归用例盯什么

- 表里每个工具都真在工具目录里、且至少一个角色装得上——写错一个名字，这一位就永远是 false。
- `capabilitiesOf` 的键集合等于表的键集合；按装上的工具逐位算。
- 同一个 `AgentCapabilities` 对象同时喂两份 prompt（「同一套表达方式」的契约）。
- 库不可用 → 两份提示词都不提 `list_library`；生图不可用 → 两边各自换成降级说明、
  不出出图那套做法；生图可用 → 两边都把那一章接回来；联网检索同理由 `can.search` 决定
  两边注不注 `SEARCH_GUIDE`。
- `voice` / `shell` 两位对剧作家提示词逐字无影响（`toBe` 全等）。

## 验证证据

- `pnpm -r typecheck` 全绿（core / server / web）。
- **逐字等价对照**：改动前用临时脚手架把 12 组上下文（`image/search/library` 八种组合 + defaults /
  empty / nsfw / sfw）的剧作家 system prompt 落盘，改动后用等价的 `can` 取值重新落盘，
  逐字 diff **12/12 完全一致**（脚手架用完即删，未留在仓库里）。
- `apps/server` 测试 37 份文件 / 480 条全绿（`npx vitest run`，排除需要真实外部 API 的 `e2e-live-*`）。
- 检视结论：**准入**（无阻塞问题），报告见同目录 `261004-prompt-capabilities.review.md`；
  其中唯一的非阻塞建议（补齐 `search` 位的跨提示词用例）已采纳并合入。
