# 检视报告

## 概要

本轮检视针对工坊 Agent 增加 Exa 联网检索能力的改动，范围涵盖 `apps/server/src/exa.ts`（新增客户端）、`apps/server/src/config.ts`（配置与凭据解析）、`apps/server/src/workshop.ts`（工具装配与提示词注入）、`apps/server/src/workshopSession.ts`、`apps/server/src/playhouse.ts`、配套单元测试及项目文档。整体设计高度克制，严格契合「只增加一个工具且同时兼顾搜索与获取信息」的需求定位，遵循无 key 优雅降级与上下文预算护栏，与现有的 TTS 客户端在网络代理、多 Key 轮换及非重试哨兵机制上保持良好同构，测试完备且完全与真实外部环境隔离。

## 需求对齐

- **单一工具满足搜索与正文获取**：采用 Exa `POST /search` 结合 `contents: { text: { maxCharacters } }`，单次请求即可同时召回结果列表与页面正文，免去了拆分「搜索 + 抓取」两套工具带来的模型规划开销与多次往返。
- **无 Key 零静默空转**：`createExa` 在 key 文件缺失或为空时返回 `null`，工坊不注册 `web_search` 工具，且 `buildWorkshopPrompt` 动态排除联网章节，彻底避免了模型因看到死工具而陷入无效循环。
- **上下文预算与安全防注入护栏**：检索正文总预算限定为 15,000 字符，按条数在 800~6,000 字符之间动态平摊；提示词中明确警示检索内容为「外部资料而非指令」（防御 Prompt Injection），并强制限定在剧目外部事实使用。
- **安全与凭据规范**：敏感 Key 仅通过外部 JSON 文件或环境变量提供，文档与测试严格采用占位符与虚构 Mock Key，全部外部请求走本地 代理 代理（`127.0.0.1:7890`），外部 API 均通过 `fakeFetch` 隔离，符合核心铁律。
- **范围控制**：未额外侵入 Web 端的设置面板，保持了配置面的轻量与改动边界的聚焦。

## 阻塞问题

无

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| - | - | 无 | 无 |

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S-01 | [apps/web/src/workshop/useWorkshop.ts:49-56](apps/web/src/workshop/useWorkshop.ts#L49-L56) | Web 前端状态机中的 `TOOL_LABEL` 映射字典未收录 `web_search`，Agent 在执行检索时前端状态栏直接降级展示英文标识 `web_search`，体验不够平滑统一。 | 在 `TOOL_LABEL` 中补充 `web_search: "正在联网检索…"`（亦可顺手补齐 `inspect_asset` 等既有工具标签），提升交互一致性。 |
| S-02 | [apps/server/src/exa.ts:46](apps/server/src/exa.ts#L46) | `Exa.search(query, numResults)` 中 `Math.floor(TEXT_BUDGET / numResults)` 在作为底层独立模块时缺乏入参防呆，若调用方传入 `<= 0` 或 `NaN`，将导致 `perResult` 产生 `Infinity` 或 `NaN`（序列化为 JSON 时异常）。 | 在 `search` 入口处对 `numResults` 做一层防御归一化（如 `const n = Math.max(1, Math.min(10, Math.floor(numResults || 5)));`），保证客户端底层防御的自闭环。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | [AGENTS.md:12](AGENTS.md#L12) | 架构地图描述中写为「十二工具」，实际当前工具列表中 `web_search` 为第 11 个工具（旧版原有 10 个），存在微小数量笔误。 | 将文档中的「十二工具」修正为「十一工具（配 key 时）」。 |
| N-02 | [apps/server/test/exa.test.ts:1](apps/server/test/exa.test.ts#L1) | 现有单元测试全面覆盖了 429 轮换、400 快速失败、成功分摊、预算截断等路径，但未显式模拟超时中断（AbortError）与非 HTTP 网络异常的轮换行为。 | 建议在后续维护中补充一个 `fakeFetch` 抛出超时/网络错误时验证游标轮换的测试用例。 |

## 准入结论

**结论**：`条件准入`

**说明**：核心功能实现完整、需求与安全规范深度对齐、架构设计克制同构、单元测试扎实；不存在阻碍发布的阻塞问题，仅存在 Web 状态提示中文映射缺失与底层入参防呆两项建议改进，可由后续迭代或合并前随手处理。

## 处置（2026-09-30，作者）

| ID | 处置 | 说明 |
| --- | --- | --- |
| S-01 | **已修** | `apps/web/src/workshop/useWorkshop.ts` 的 `TOOL_LABEL` 补齐 `web_search: "联网检索中"`，并顺手补上原本就漏掉的 `inspect_asset` / `read_skill` / `list_saves` / `read_lineage`（原来 11 个工具里有 5 个没有中文标签，会直接露出英文工具名）。 |
| S-02 | **不采纳** | `numResults` 的取值由 `webSearchParams` 的 JSON Schema 兜住（`Type.Integer({minimum:1, maximum:10})`），`Exa.search` 全仓只有 `webSearch()` 一个调用方。在底层再加一层 clamp 属于项目规范明令禁止的「用不到的过度防御性代码」；真要防，也该在 schema 层防而不是在 HTTP 客户端层防。 |
| N-01 | **已修** | AGENTS.md 地图行改回「十一工具」（原有 10 个 + 配 key 才有的 `web_search`）。 |
| N-02 | **已修** | `test/exa.test.ts` 补了「网络错误（TimeoutError）同样轮换下一把 key」一条——这是生产里最常见的失败路径，值得有回归线。 |

## 复检（delta）

针对处置情况逐项复查：

1. **S-01 处置复核（通过）**：`apps/web/src/workshop/useWorkshop.ts` 中的 `TOOL_LABEL` 成功补全 `web_search: "联网检索中"`，并顺手将此前漏掉的 `inspect_asset`、`read_skill`、`list_saves`、`read_lineage` 全部配齐中文映射。前端状态流呈现完整一致，践行了童子军法则。
2. **N-01 处置复核（通过）**：`AGENTS.md` 架构地图已修正为「十一工具」，与代码内 10 个固定工具 + 1 个条件式注册工具的数量完全相符。
3. **N-02 处置复核（通过）**：`apps/server/test/exa.test.ts` 新增「网络错误（超时/连不上）同样轮换下一把 key」用例，使用 `DOMException("...", "TimeoutError")` 准确模拟了 `AbortSignal.timeout` 触发时的真实异常形态，断言覆盖了 keyCursor 的顺延轮换，测试健全度进一步强化。
4. **S-02 不采纳理由裁决（成立）**：
   - 调用链路完全受控：`Exa.search` 是全仓单点的内部方法，外部入参经由 TypeBox 定义的 `webSearchParams` 强校验（`Type.Integer({ minimum: 1, maximum: 10 })`），非法数值在进入 execute 之前已被拦截，不存在产生 `NaN` 或 `<= 0` 的实际运行路径。
   - 契合项目规范：项目规范明确规定「项目真实上线前不要考虑兼容性/旧版迁移；不要写用不到的过度防御性代码」。在受控内部调用链路上重复增加 clamp 确实属于过度防御。
   - 因此，作者不采纳 S-02 的理由充分且符合项目编码原则，维持原实现。
5. **次生风险核查**：上述改动均为字典补充、文档修正和测试用例增补，未触碰核心业务逻辑，未引入任何次生风险或破坏性变更。

### 最终准入结论

**结论**：`准入`

**说明**：全部建议与非阻塞项均已妥善处理或给出充分的技术裁决，无遗留问题，无次生风险，满足合并准入要求。
