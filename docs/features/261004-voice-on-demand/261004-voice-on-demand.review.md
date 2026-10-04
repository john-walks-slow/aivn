# 检视报告

## 概要

本次改动检视范围涵盖「音色目录按需查询」特性的完整链路（包括服务端窗口抓取、自适应翻页、内存缓存与并发去重、HTTP 参数校验、工坊 Agent 工具适配、前端状态流转与防抖渲染，以及配套单测）。整体架构设计清晰，对 Fish Audio 的大小写敏感度与窗口机制把握精准，并发去重与在途管理严密，单测质量高，无阻塞性缺陷。

## 需求对齐

- **服务端**：满足计划中将全量本地筛选重构为按需拉取对应窗口的要求；支持 `language`、`tags`（并集）与 `title`（全库搜索）三维组合；无条件查询平滑回落基础目录及磁盘快照。
- **并发与缓存**：严格实现了 12h 内存缓存、16 窗口 FIFO 逐出收口，以及并发请求共用同一 Promise（`windowInflight`），且失败时正确清理在途状态。
- **翻页策略**：`title` 搜索先探第 1 页自适应早停；`language`/`tags` 10 页并发一次打完，实测性能与计划预期完全对齐。
- **工坊工具与 HTTP**：`list_voices` 与 `GET /api/voices` 均对齐新契约，参数校验完备（不合规直接 400，不放行上游）。
- **前端体验**：实现了 300ms 关键词防抖、标签 chips 多选、查询序号（`searchSeq`）防竞态。但在多标签上限控制与错误状态恢复上存在轻微体验边界未闭环。

## 阻塞问题

无。

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-01 | [VoiceLibrary.tsx:116](apps/web/src/voice/VoiceLibrary.tsx#L116) | **前端标签多选未限制 4 个上限，点第 5 个会直接触发后端 400 报错**：后端 `http.ts` 明确校验 `tags.length > 4` 并返回 400，但前端 `toggleTag` 没有上限防御，展示的 chips 有 12 个，当用户勾选第 5 个时会立刻向后端发请求并弹窗「筛选失败：标签最多 4 个」，体验突兀。 | 在 `toggleTag` 中拦截：当未选中且已达 4 个时阻止添加并给予轻量提示，或在已选满 4 个时将其他未选中的 chips 设为 disabled 状态。 |
| SUG-02 | [useVoiceCatalog.ts:98](apps/web/src/voice/useVoiceCatalog.ts#L98) | **筛选失败时旧结果未清空，导致错误提示下方残留不匹配的旧数据**：`runSearch` 在 `catch` 路径中只设置了 `searchError`，未将 `result` 置空；同时组件层在 `filterActive` 下直接取 `result?.entries`。如果用户在已有结果的情况下输入了一个导致错误或查空的词，页面上方展示红字错误，下方却依然显示着上一次成功的卡片列表，造成视觉和数据认知矛盾。 | 在 `runSearch` 的 `catch` 块中调用 `setResult(null)`，或在 `VoiceLibrary` 渲染网格时判断若存在 `searchError` 则不渲染旧列表，确保失败态界面一致。 |
| SUG-03 | [VoiceLibrary.tsx:37](apps/web/src/voice/VoiceLibrary.tsx#L37) | **动态 topTags 重新计算可能导致已选中标签从 chips 栏中“隐形”**：`topTagsOf` 是根据当前 `entries` 动态计算前 12 个高频标签。当用户选了某个标签后，窗口结果变化可能导致先前选中的某个次高频标签跌出 top 12。此时该标签在界面上消失，用户既看不到其激活状态，也无法点击取消它。 | 在计算展示的 tags 时，将当前已选中的 `tags` 强制与 `topTags` 合并去重（如 `Array.from(new Set([...tags, ...topTags]))`），确保已选中的标签始终可见且可取消。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| MIN-01 | [voiceTool.ts:26](apps/server/src/agentkit/voiceTool.ts#L26) vs [http.ts:231](apps/server/src/http.ts#L231) | **搜索关键词长度上限两处不一致**：`http.ts` 限制 `title.length > 60` 返回 400，而 `voiceTool.ts` 中 `query` 的 schema 是 `maxLength: 100`。虽然工具直接调内部接口不报错，但对同一概念的约束边界略有分歧。建议统一为 60 或 100。 |

## 准入结论

**结论**：`条件准入`

**说明**：核心服务端架构、缓存并发机制、抓取翻页算法及单测验证完整严谨，无阻塞性缺陷。建议在合并前或后续迭代中优化前端标签选择上限拦截与失败结果展示一致性，以提供更平滑的用户体验。

## 处置记录（2026-10-04）

| ID | 处置 |
| -- | ---- |
| SUG-01 | 已修：`VoiceLibrary` 加 `MAX_TAGS = 4`（与 HTTP 面一致），`toggleTag` 到上限不再添加，未选中的 chips 同时置灰并带 `title` 说明——静默忽略点击读起来像卡了。 |
| SUG-02 | 已修（并按实际渲染路径调整）：错误横幅本来就**整段替换**网格，不存在「横幅下方残留旧列表」；真正的残留是重试期间旧的错误一直在（`searchError` 只在成功时清），现在 `runSearch` 一开跑就 `setSearchError(null)`。 |
| SUG-03 | 已修：展示的 chips 改为 `[...已选中的, ...高频榜里没选中的]`，已选标签恒在行内可取消，不会跌出榜单就变隐形。 |
| MIN-01 | 已修：`list_voices` 的 `query` 上限对齐 60 字。 |
