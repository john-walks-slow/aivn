# 检视报告

## 概要

检视范围涵盖音色试听多语言改造涉及的全部改动文件（`apps/server/src/voiceCatalog.ts`、`apps/server/src/tts.ts`、`apps/server/src/playhouse.ts`、`apps/server/test/ttsPreview.test.ts`）及计划文档 `docs/features/261004-tts-preview-language/261004-tts-preview-language.plan.md`。改动架构清晰，落盘缓存与并发去重处理严谨，彻底解除了此前音色试听强制翻成剧目语言且需构造完整 runtime 的历史债务，整体完成度高。

## 需求对齐

完整满足需求，与计划规范高度对齐：
1. **三级试听策略落地**：实现了「官方样本音频优先 → 官方示例文本自家合成 → 语言标签母语问候兜底」的完整三级阶梯。
2. **免除 runtime 构建与翻译**：`ttsPreview` 已剥离 `runtime.synth` 调用，不再触发剧目翻译与运行时初始化开销。
3. **接口与路由兼容**：保持现有 `POST /api/plays/:id/tts-preview` 契约不变，落盘文件名 `preview-<voiceId>.mp3` 完全匹配既有静态服务正则路由（`^[\w-]+\.mp3$`）。
4. **单测覆盖全面**：包含 9 个新增单元测试，覆盖了三级策略流转、并发与缓存复用、错误如实抛出、非法音色校验等核心场景。

## 阻塞问题

无

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| S-01 | `apps/server/src/playhouse.ts:818-825` | 二次试听未先查本地磁盘：在 `ttsPreview` 中，即使本地 `media-cache/tts/preview-<voiceId>.mp3` 已经存在，仍会先 `await this.voices.sample(voiceId)` 请求上游 Fish API 获取模型元信息，随后才进入 `fetchSample` 命中磁盘缓存。对于已有样本的音色，每次点击试听都会多付一次外部网络往返延迟。 | 在调用 `this.voices.sample(voiceId)` 前，先检查 `join(store.mediaDir(), \`preview-${voiceId}.mp3\`)` 是否已存在；若存在可直接返回对应静态路由 URL，使重复试听实现零延迟短路返回。 |
| S-02 | `apps/server/src/playhouse.ts:114-116` | 语言标签匹配未做规范化：`previewText` 直接使用 `languages[0] ?? ""` 作为键索引 `PREVIEW_TEXTS`。若上游音色标签带区域后缀（如 `zh-CN`、`en-US`）或大小写差异（如 `ZH`），会匹配失败并降级回默认英语文案。 | 在索引前对语言代码进行归一化（如 `languages[0]?.toLowerCase().split(/[-_]/)[0] ?? ""`），增强对各类语言标签格式的容错性。 |
| S-03 | `apps/server/src/voiceCatalog.ts:161` | 示例文本未做空白字符修剪：`text: str(raw.default_text) \|\| str(sample?.text)` 中，若上游返回纯空格（如 `"   "`），`str()` 会返回非空真值，传递至 TTS 合成空白文本，无法正确触发第三级语言兜底。 | 改为 `.trim()` 处理，例如 `str(raw.default_text).trim() \|\| str(sample?.text).trim()`。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| N-01 | `apps/server/src/playhouse.ts:59-60` | 注释过时残留：`PlayRuntime.synth` 注释仍写着 `/** 语音合成闭包（含语音语言翻译）：ttsPreview 复用同路径。 */`，但 `ttsPreview` 已解耦独立。 | 清理过时注释，避免后续维护产生认知误导。 |
| N-02 | `apps/server/test/ttsPreview.test.ts:77-85` | 兜底文案测试缺少空语言边界：用例覆盖了日语标签兜底，但未显式断言 `languages: []` 或未收录语种回退到英语 `DEFAULT_PREVIEW_TEXT` 的分支。 | 补充断言验证未收录语言与空语言标签正确回退至英语文本。 |

## 准入结论

**结论**：`条件准入`

**说明**：核心功能与架构重构满足需求且表现稳健，无阻塞问题。建议合并前或后续迭代跟进 S-01 本地样本直接命中短路及 S-02 语言标签规范化，以进一步提升试听体验与健壮性。
