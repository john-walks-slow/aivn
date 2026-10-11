# 检视报告

## 概要

本次检视覆盖 ambient 第一等素材类别重构、BGM 手动生成 REST/后台排产/元数据同步链路，以及工坊素材页和资源库 UI。整体架构方向正确：ambient 已进入共享 AssetKind，场景引用保留了旧 sfx/bgm 回落，BGM 也采用 REST 快速返回、后台生成并通过 `asset_ready` 刷新的异步模型；但生成接口的路径契约存在实际错误，且输入校验、移动端布局和旧资源迁移说明仍未闭环。

## 需求对齐

- `ASSET_KINDS`、`AUDIO_KINDS`、agent 素材索引、舞台索引、资源库扫描、上传/导入接口和前端分类均已加入 `ambient`。
- `refsFromScene` 现在按 `ambient -> sfx -> bgm` 查找，保持旧剧目中把环境音放在 `sfx` 或 `bgm` 下的兼容性；但“专属 `library/ambient` 目录”的迁移/预置没有在本次改动中落地，仓库既有说明仍描述旧的 `library/sfx` 路径。
- BGM 手动生成已具备对话框、REST 发起、后台排产、`asset_ready` 通知和生成后 manifest 元数据补写，基本满足计划主流程。
- 计划要求的“返回 `{ target, path, prompt }`”已实现，但 `path` 没有遵循实际后端返回的扩展名，见阻塞问题 B-001。
- 本次仅做静态代码检视，未执行测试、编译或浏览器验证。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B-001 | [apps/server/src/playhouse.ts:1144-1187](../../../apps/server/src/playhouse.ts:1144) | `generateMusic()` 将返回路径固定为 `assets/bgm/${name}.m4a`，但 `PlayMusic.run()` 按上游 MIME 将文件实际写成 `.m4a`、`.mp3`、`.ogg` 或 `.wav`（[apps/server/src/playMusic.ts:103-113](../../../apps/server/src/playMusic.ts:103)）。因此当后端返回非 `audio/mp4` 时，REST 回执中的 `path` 与真实文件不一致；客户端、日志或调用方若按回执读取会得到 404。该问题直接违反新增 REST 接口的路径契约，并且错误只在异步任务完成后才显现。 | 不要在 `generateMusic()` 中预构造扩展名。应让排产任务返回 `asset.path`，并将该实际路径作为回执的一部分；若接口必须同步返回路径，则先明确固定格式并禁止其他 MIME，或改为返回不带扩展名的 target、把实际 path 放入异步完成事件。对 `MusicGenDialog` 的兜底 URL 也应使用到货事件中的真实 URL/path，而不是写死 `.m4a`。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| R-001 | [apps/server/src/http.ts:568-594](../../../apps/server/src/http.ts:568)；[apps/server/src/playhouse.ts:1138-1175](../../../apps/server/src/playhouse.ts:1138) | REST 入口只检查 `name` 和 `prompt` 是否存在，没有校验字符串长度、数组元素类型/长度、`volume` 是否为有限的 0–1 数值、`title/description` 是否为空。后台路径直接把这些值交给 `declareMeta`，绕过了 `assetMetaPatchOf()` 的归一化；例如 `volume: 99` 会写进 manifest，破坏 `AssetMeta` 的 0–1 契约，超长字段也可膨胀剧目配置。 | 在 HTTP 边界复用与 `assetMetaPatchOf` 一致的归一化/校验函数，拒绝非法类型、超长文本、过长数组和越界音量；生成任务只接收已归一化的请求。对空白 title/description 应视为未提供，而不是依赖后续解析时丢弃。 |
| R-002 | [apps/server/src/playhouse.ts:1147-1185](../../../apps/server/src/playhouse.ts:1147) | 后台任务把“生成成功、元数据写入失败”整体记为失败，但音频文件已经落盘，且 `declareSource()` 已经写入来源。此时客户端收到失败状态，用户重试可能覆盖同名文件，manifest 可能处于只有 source 的半完成状态；错误恢复语义不清。 | 将音频落盘、元数据写入、广播和 pending job 收尾拆成可观察阶段；至少在元数据写失败时广播一个“素材已到货但标注失败”的结果，或把标注失败原因和真实音频 URL 一并保留，避免用户误以为没有产物。必要时为同名重试提供明确覆盖策略。 |
| R-003 | [apps/web/src/workshop/MusicGenDialog.tsx:252-373](../../../apps/web/src/workshop/MusicGenDialog.tsx:252) | 对话框的多个表单区直接使用内联 `gridTemplateColumns: "1fr 1fr"`，没有窄屏断点。项目明确要求 ≤720px 是一等场景且控件改单列；在 390px 宽度下高级设置、ID/Title 等输入会被压缩，中文 label 和输入内容可读性差，存在“竖排中文/窄控件”风险。 | 为音乐对话框提取语义 class，复用工坊已有移动端规则，在 ≤720px 将两列 grid 明确改为单列（每个控件 `grid-column: 1`），并为对话框滚动区域设置稳定的最大高度和底部操作区。 |
| R-004 | [apps/web/src/workshop/MusicGenDialog.tsx:201-206](../../../apps/web/src/workshop/MusicGenDialog.tsx:201)；[apps/web/src/workshop/AssetsPanel.tsx:749-750](../../../apps/web/src/workshop/AssetsPanel.tsx:749) | 新增 BGM 生成结果和素材行都使用原生 `<audio controls>`。项目已有 `AudioPill` 作为紧凑音频控件，规范明确避免浏览器原生播放器占据整条消息/素材行。BGM 行较长时会破坏素材页的扫描密度，完成态对话框也与工坊音频交互不一致。 | 复用 `ui/AudioPill.tsx` 或抽出统一的音频预览组件；保留键盘可操作性、时长预加载和错误状态，避免每个音频入口各自维护一套播放器。 |
| R-005 | [packages/core/src/play/assets.ts:19-23](../../../packages/core/src/play/assets.ts:19)；[apps/server/src/library.ts:28-36](../../../apps/server/src/library.ts:28)；[packages/agent/src/media/asset-index.ts:13-17](../../../packages/agent/src/media/asset-index.ts:13) | server/library 接受 `.flac`，但 agent/play 素材清单的 `MEDIA_EXT` 不接受 `.flac`，前端 `AssetRow` 的 `isAudio` 也不接受 `.flac`。这使资源库中合法的 FLAC 环境音/BGM 在导入后可能不出现在剧目索引，或显示为空白素材。该不一致在本次把 ambient 正规化、并把音频类别扩展到 UI 后更容易暴露。 | 统一音频扩展名白名单，明确浏览器可播放格式；如果产品不支持 FLAC，应从 library 的 `KIND_EXT` 移除并给出导入警告；如果支持，则同步 agent 索引、HTTP MIME/静态服务和前端预览处理。 |
| R-006 | [apps/server/src/assetRef.ts:160-167](../../../apps/server/src/assetRef.ts:160)；[docs/features/261012-bgm-manual-gen-and-ambient/261012-bgm-manual-gen-and-ambient.plan.md:17-28](../../../docs/features/261012-bgm-manual-gen-and-ambient/261012-bgm-manual-gen-and-ambient.plan.md:17) | 代码已支持 ambient 专属目录优先和旧目录回落，但计划所述“将 4 类环境音迁移/规范到 `library/ambient/`，并在 sfx 保留兼容”没有对应迁移产物或导入说明。现有 README/AGENTS 文档仍有 `scene ambient -> library/sfx` 的旧示例，用户无法判断同名条目最终会落入 ambient 还是 sfx。 | 补充一次性资源迁移/兼容策略：明确存量 `sfx` 不移动时的行为、同名冲突优先级、导入后物理落点，并同步 README、模块指引和资源库示例。若本次不负责迁移，应在计划/交付说明中明确延期，避免宣称 ambient 已完全解耦。 |
| R-007 | [apps/web/src/workshop/MusicGenDialog.tsx:147-188](../../../apps/web/src/workshop/MusicGenDialog.tsx:147) | 到货订阅只在 `waitingId` 设置后建立。当前真实后端通常耗时较长，但在本地 mock、缓存或未来低延迟后端下，REST 返回后到 `setWaitingId(name)` 前可能已经广播 `asset_ready`，对话框将永远停在排队态；同时 `onDone` 在“仅成功发起排产”时立即调用一次，到货时又调用一次，回调语义不够清晰。 | 在发起前注册一个按 target/id 过滤的订阅，或把 pending target 写入 ref 并在订阅回调前后都检查；将 `onDone` 拆成 `onQueued` 与 `onCompleted`，避免调用方把排产成功误当素材已落盘。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-001 | [apps/web/src/workshop/MusicGenDialog.tsx:19-97](../../../apps/web/src/workshop/MusicGenDialog.tsx:19) | 模板、元数据枚举和 `galgame-bgm` 技能之间没有共享常量。模板中的 `tags/mood/scene` 可以随意产生词（例如“环境音”被放在悬疑 BGM 标签中），长期会造成素材清单词表漂移，降低剧作家按元数据选曲的稳定性。 | 将模板元数据改为技能声明的词表，或把词表抽到 core/共享包并由模板和 agent 共用；对模板做静态合法值校验。 |
| N-002 | [apps/web/src/workshop/MusicGenDialog.tsx:117-125](../../../apps/web/src/workshop/MusicGenDialog.tsx:117) | `initialName` 和 `initialPrompt` 只影响首次 state 初始化，组件若在同一实例中切换目标不会同步；当前入口每次关闭后重建，影响暂不明显。 | 若组件未来支持从某条 BGM 行“再生成”，用 `useEffect` 或 key 重置表单，并明确覆盖确认文案。 |
| N-003 | [apps/web/src/workshop/LibraryBrowser.tsx:17-27](../../../apps/web/src/workshop/LibraryBrowser.tsx:17) | ambient Tab 已加入，但标签顺序是 BGM 后再 ambient；素材页顺序则是 ambient 后 BGM，两个入口的分类顺序不一致，会增加定位成本。 | 统一分类顺序，并把 BGM/环境音/音效作为相邻音频组；若有产品排序意图，在共享常量中定义。 |
| N-004 | [apps/web/src/workshop/AssetsPanel.tsx:32-40](../../../apps/web/src/workshop/AssetsPanel.tsx:32)；[apps/web/src/workshop/AssetsPanel.tsx:647-661](../../../apps/web/src/workshop/AssetsPanel.tsx:647) | ambient 已有独立分组和试听，但没有和 BGM 一样的显式“生成”动作，这是符合需求的（只要求 BGM）；分组标题与条目仍主要依赖文件名，生成曲目到货后需依赖 `asset_ready` 才显示标题。 | 保持当前职责边界，同时在到货刷新失败时显示可关闭错误而不是静默忽略 `listAssets`/`assetMeta` 失败，便于用户判断素材是否真正入库。 |
| N-005 | [apps/server/src/playMusic.ts:136-147](../../../apps/server/src/playMusic.ts:136) | 删除同 stem 的旧扩展名与写新文件不是同一原子操作；进程中断可能留下无文件或半替换状态。与音频生成的长耗时组合后，恢复时可能看到旧曲或缺曲。 | 在同目录使用临时文件写完后 rename，并在替换阶段统一清理旧扩展名；至少保证失败时旧文件不被提前删除。 |

## 准入结论

**结论**：`不准入`

**说明**：ambient 的类型、索引、查找回落和 UI 基础接入方向正确，BGM 的异步排产及元数据同步也基本闭环；但 REST 回执固定扩展名与实际落盘格式不一致，会直接产生错误资源路径，是新增能力的跨层契约阻塞。修复 B-001 并补齐接口边界校验后，建议再针对窄屏对话框和存量资源迁移说明复核。
