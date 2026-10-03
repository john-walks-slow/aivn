# 检视报告

## 概要

本轮检视针对分支 `feat/manual-image-gen` 上的手动生图功能改动。该改动实现了舞台 CG 导演生图扩展（有序参考立绘垫图、基于历史开关）与工坊手动生图（角色卡立绘生成/重生成、素材页背景与 CG 生成），在统一通用提示词内核（`imagePrompt.ts`）与通用出图层（`PlayAssets`）的同时，保持了舞台 WS 时间线链路与工坊 REST 异步链路的清晰边界。整体架构设计优秀，状态机与时序逻辑严密，代码质量高。检视结论为**条件准入**。

## 需求对齐

| 需求项 | 计划要求 | 实现情况 | 对齐评估 |
| ------ | -------- | -------- | -------- |
| 舞台生图：参考角色立绘 | 多选、有序、序号与提示词编号（①②③）对齐，只列出有立绘角色，默认全不选 | `StageTheater.tsx` 集成 `RefCharacterPicker`，仅展示有立绘角色，点击顺序记录于 `selectedRefs`，选中项置顶显示序号；`requestCg` 透传至 `preloadAsset` 并通过 `composeImagePrompt` 注入编号锚 | 完全对齐 |
| 舞台生图：基于历史开关 | 默认勾选，取消勾选时去掉剧情与场景上下文；不勾历史且无指令时前端禁提、服务端守卫 | 前端 `cgCanSubmit` 校验，未勾选历史且无指令时提交按钮置灰；`requestCg` 服务端双重拦截报错；`composeImagePrompt` 依据 `useHistory` 精确过滤台词与场景 | 完全对齐 |
| 舞台生图：参考立绘前置校验 | 在落时间线节点之前校验，角色无立绘时直接抛错走 `error` 帧（toast 提示），不落空节点 | `PlayAssets.assertReferences` 提升并公开，`requestCg` 开头同步 `await assets.assertReferences(refIds)`，校验失败由 `dispatchSafe` 捕获并通过 WS `error` 帧下发，不执行 `directorCg` | 完全对齐 |
| 工坊手动生图：角色卡入口 | 差分行支持「重生成」且锁定差分名；底栏「生成立绘」若无立绘则默认预填 `neutral`；支持选择取景画幅 | `CharacterEditor.tsx` 行内与底栏分别唤起 `ImageGenDialog`，传递 `fixedExpression` 与 `initialFraming`；服务端 `mapSprite` 自动补全映射并同步角色卡 `framing` | 完全对齐 |
| 工坊手动生图：素材页入口 | 素材页 `backgrounds` 与 `cg` 单元格支持手动「生成」，支持填写素材名、描述与参考立绘 | `AssetsPanel.tsx` 增加生成按钮，唤起 `ImageGenDialog`，传递 `refCandidates` 并提供参考角色立绘选择器 | 完全对齐 |
| 工坊手动生图：通信与副作用隔离 | REST 请求发起并返回 `{ target, path, prompt }`，后台异步生成；`AssetNotify` 加 `"manual"`，不产生对话气泡与撤销条；广播 `image_result` 收口并触发 `reloadAfterWorkshopWrite` | `POST /api/plays/:id/images` 负责同步校验与提示词组装后即刻返回；后台通过 `{ notify: "manual" }` 跳过工坊对话流与多余重建；完成/失败广播 `image_result`，`ImageGenDialog` 按 `target` 精准匹配并展示结果，成功后触发 `reload` | 完全对齐 |
| 目录立绘兜底对齐 | `referenceSpriteOf` 增加目录任意文件兜底，与舞台 `index.sprite` 行为对齐 | `referenceSpriteOf` 在差分映射未命中时遍历 `spriteStems` 兜底，解决了用户刚上传立绘尚未绑定差分映射时参考图校验不一致的问题 | 完全对齐 |

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| -- | ---- | ---- | ---- |
| S1 | `apps/server/test/playhouse.test.ts` | 计划中规划的服务端集成测试尚未补充：包括 `requestCg` 校验前置（无立绘角色抛错阻止落节点、`referenceCharacters` 正确透传）以及 `generateImage` 手动端点（入参校验、返回结构、异步触发与 `image_result` 广播）。目前仓库中仅添加了 `imagePrompt.test.ts` 和 `cgOptions.test.ts`。 | 建议在 `apps/server/test/playhouse.test.ts` 中补充上述场景的测试用例（可 Mock `StreamFn` 与 `ImageBackend`），建立对核心业务编排链路的回归防护。 |
| S2 | `README.md` | 项目规范明确要求「README 是用户的使用说明书，凡是面向用户的能力都必须在项目 README 里说明白」。本次修改新增了舞台生图中的参考立绘垫图与基于历史开关，以及工坊角色卡/素材页的手动生图能力，但 `README.md` 尚未同步更新相关使用说明。 | 建议在 `README.md` 的「导演生图」章节补充参考立绘与基于历史开关的操作说明，并新增「工坊手动生图」小节，介绍在角色卡与素材页直接出图的使用方式。 |
| S3 | `apps/web/src/workshop/ImageGenDialog.tsx:102-108` | `canSubmit` 在素材名/差分名不匹配 `STEM` 正则（如用户以数字开头或包含非法字符）时直接返回 `false`，提交按钮被禁用。由于按钮禁用，用户点击无反应，且无法触发 `submit()` 内部的 `setError` 提示信息，用户可能难以直观发现按钮被禁用的原因。 | 建议在输入框下方增加弱提示（如当且仅当输入非空但格式非法时显示错误说明），或者保留提交按钮可点击、在点击时调用校验并展示 `setError`，提升用户交互的可发现性。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| -- | ---- | ---- | ---- |
| N1 | `apps/server/src/playhouse.ts:842-853` | 在 `generateImage` 的异步 kick 闭包中，代码为 `const last = generated[generated.length - 1]; if (last) { ... }`。虽然正常情况下 `PlayAssets.run` 至少返回 1 项，但若出现意外空数组，缺少 `else` 分支会导致该次操作既不广播成功也不广播失败，对话框将一直悬挂在「生成中」。 | 可在 `if (!last)` 时统一按异常处理，广播 `ok: false` 并记录警告日志，增强极限边界下的防御健壮性。 |
| N2 | `apps/web/src/workshop/AssetsPanel.tsx:189-190` | `AssetsPanel` 中解析角色首选立绘时使用了内联逻辑 `c.sprites?.neutral ?? Object.values(c.sprites ?? {})[0] ?? spriteFiles[0]`。该逻辑与服务端 `PlayAssets.referenceSpriteOf` 及前端 `AssetIndex.sprite` 逻辑相似。 | 未来可考虑将此三级兜底逻辑提炼为共享的纯函数 Helper（如 `resolveRoleDefaultSprite`），进一步避免后续规则漂移。 |

## 准入结论

**结论**：`条件准入`

**说明**：
核心架构设计精炼规范，需求完全对齐，前置校验和异步出图状态流转清晰健壮，无阻塞问题。建议在合并交付前补充 `playhouse.test.ts` 测试用例与 `README.md` 文档说明，并优化弹窗表单的禁用校验提示。

## 处置记录（2026-10-04）

| ID | 处置 | 说明 |
| -- | ---- | ---- |
| S1 | 已修 | `apps/server/test/playhouse.test.ts` 新增 4 例：无立绘角色前置抛错、未勾历史且无指令拒绝、`generateImage` 立绘端点返回 `{target, path}` 并广播 `image_result`、半句提示词拒绝。全套 16 例通过 |
| S2 | 已修 | `README.md`「导演生图」补参考立绘与「基于历史」两条，并新增「工坊手动生图」一节（含三处入口对照表、异步语义、同名覆盖、无气泡无撤销条） |
| S3 | 已修 | `ImageGenDialog` 的提交按钮不再因名称格式非法而置灰：只判非空，格式校验留到 `submit()` 里给出可读错误。另将输入框改为实时过滤非法字符，避免用户敲完才发现名字不合法 |
| N1 | 已修 | `generateImage` 异步闭包内 `generated` 为空数组时补 `else` 分支，广播 `ok: false`（"出图未产生有效文件"），不再让对话框悬挂在「生成中」 |
| N2 | 接受 | 三级兜底（差分映射 → 目录任意文件）在服务端 `referenceSpriteOf`、前端 `AssetIndex.sprite`、`AssetsPanel` 三处出现。本轮不改：抽象收益小于改动面，且三处的输入来源本就不同（服务端读盘、前端读 hello 快照、素材页读 assets 清单）；若后续再出现第四处，届时一并收敛 |

