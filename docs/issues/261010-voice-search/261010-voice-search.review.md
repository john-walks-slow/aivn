# 检视报告

## 概要

本次改动针对外部反馈「音色库搜不到榜外音色（如雷姆）」与「界面缺少常用标签」两个问题。经根因排查，原实现并非客户端本地过滤，而是界面将浏览器系统语言（如英文系统 `en`）作为硬性筛选条件与搜索关键词进行 AND 组合，导致跨语种搜索被截断；同时原有标签 chips 从当前查询窗口动态统计，在空结果或小样本窗口下 chips 完全消失。改动抽离了语言筛选策略纯函数 `effectiveVoiceLanguage`（系统语言仅作为浏览起点，输入关键词时自动摘除），并将常用标签固化为统一真相源 `VOICE_TAG_GROUPS` 供前端与 Agent 描述共用。代码整体精简克制，架构定位合理，契约与测试覆盖到位。

## 需求对齐

- **需求满足度**：完全满足。
  1. 修复了系统语言与关键词误做强制 AND 导致的搜索截断问题，确保关键词搜索默认走全库标题搜索；显式选择语言仍可与关键词 AND 筛选。
  2. 固化了常用标签 chips，并与 `packages/agent` 的 `list_voices` 能力描述统一复用 `@aivn/core` 的 `VOICE_TAG_GROUPS`，消除了双端维护词表的漂移风险。
  3. 保留了选中标签即使不在常用词表也能作为取消勾选入口的兜底机制。
- **与计划/文档偏差**：无偏差。相关文档（`README.md`、`apps/web/AGENTS.md`、排障与验证文档）均已同步更新。

## 阻塞问题

无

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S-01 | [apps/web/src/voice/VoiceLibrary.tsx:124-139](apps/web/src/voice/VoiceLibrary.tsx#L124-L139) | 下拉框选中态回显逻辑：当处于「未显式选语言 + 输入关键词」时，`effectiveVoiceLanguage` 计算出的 `language` 为 `""`，此时 `<select>` 的 `value={language}` 会回显为首项「全部语言」。而当用户清空搜索框后，`language` 会无感跳回系统语言（如 `en`），下拉框显示也会自动弹回对应语种。此表现虽符合「系统语言仅为浏览起点」的设计意图，但在缺少 UI 状态提示时，用户可能会对「输入文字后下拉自动切为全部语言、清空文字后又切回」感到微小的认知跳跃。 | 属于当前设计预期的折中方案，交互基本合理。建议在后续迭代中，可考虑在下拉项中或右侧加轻量文案/提示（例如显示「全部语言（搜索默认）」或视觉弱化），让用户更直观理解该联动。 |
| S-02 | [apps/web/src/voice/VoiceLibrary.tsx:86-89](apps/web/src/voice/VoiceLibrary.tsx#L86-L89) | 标签去重查找效率：`topTags` 计算中使用 `tags.filter((tag) => !VOICE_COMMON_TAGS.includes(tag))`。虽然 `VOICE_COMMON_TAGS` 只有 28 个元素，`tags` 上限 4 个，性能损耗微乎其微，但语义上 `VOICE_COMMON_TAGS` 是静态数组，使用 `Set` 进行 lookup 是更标准的写法。 | 可在模块作用域导出或定义 `const VOICE_COMMON_TAGS_SET = new Set(VOICE_COMMON_TAGS)`，简化包含性判断。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | [apps/web/src/app.css:1673-1681](apps/web/src/app.css#L1673-L1681) | 移动端（窄屏）标签换行占高：28 个固定 chips 在小屏设备（如 390px 宽）换行排列约占 4~5 行（高度约 120px~150px），会一定程度挤占卡片网格可视空间（validation 文档已记录此折中）。 | 后续若用户反馈移动端拥挤，可考虑将 `.picker-tags` 改造为单行/双行横向滑动（`overflow-x: auto; flex-wrap: nowrap`），或默认展示首两组（画风、性别年龄）+「更多」折叠展开。 |
| N-02 | [packages/core/test/voices.test.ts:1](packages/core/test/voices.test.ts#L1) | 基础常量单测缺失：`VOICE_TAG_GROUPS` 与 `VOICE_COMMON_TAGS` 作为跨包导出的共享常量，目前缺少基础断言用例（如非空、无重复 tag 等）。 | 可在 `packages/core/test/voices.test.ts` 中补充一条轻量测试，核验 `VOICE_COMMON_TAGS` 的长度与去重性，防止后续手滑引入重复词。 |

## 准入结论

**结论**：`准入`

**说明**：本次修复精准定位了「默认系统语言 AND 截断关键词」与「动态 tags 窗口空导致 chips 丢失」的根因；架构上将领域常量提升至 `@aivn/core`，消除了前后端多处维护标签词表的冗余；纯函数 `effectiveVoiceLanguage` 职责清晰且具备完备单测；构建与类型检查全部通过。无阻塞性问题，同意合入。
