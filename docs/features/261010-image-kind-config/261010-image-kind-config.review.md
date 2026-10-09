# 检视报告：生图配置按类目分开（背景 / CG / 立绘）

## 概要

检视范围覆盖 [261010-image-kind-config.plan.md](docs/features/261010-image-kind-config/261010-image-kind-config.plan.md) 规划的完整改动：服务端配置模型与回落逻辑（[config.ts](apps/server/src/config.ts)）、设置 API 掩码与读写映射（[configApi.ts](apps/server/src/configApi.ts)）、后端多实例工厂与运行时素材装配（[imageBackend.ts](apps/server/src/imageBackend.ts) / [imageFactory.ts](apps/server/src/imageFactory.ts) / [playhouse.ts](apps/server/src/playhouse.ts) / [playAssets.ts](apps/server/src/playAssets.ts)）、前端设置页交互与样式（[SettingsScreen.tsx](apps/web/src/views/SettingsScreen.tsx) / [api.ts](apps/web/src/api.ts) / [app.css](apps/web/src/app.css)）、文档（[README.md](README.md)）及自动化测试集。
整体评价：实现架构清晰、职责边界合理，严格遵循既有配置回落口径（对齐 `musicConnectionOf`），未污染共享包契约，生命周期与就地生效机制完整；各模块测试用例覆盖度高。检视发现 1 项建议修改（关于空类目对象的持久化形态）与 1 项非阻塞体验备忘。

---

## 需求对齐

- **类目覆盖范围**：已完整支持 `background` / `cg` / `sprite` 三类素材覆盖 `format` / `baseUrl` / `apiKey` / `model` / `size` / `reference` / `timeoutMs` 七项字段。
- **配置隔离与不进类目字段**：`enabled` 与 `concurrency` 严格保持为顶层部署级配置，未渗透进类目；`play.json` 保持不变，满足「只在设置页」的要求。
- **立绘尺寸下限**：界面提示与 README 均已标注「立绘下限固定 2K，填 1K 也会按 2K 出图」。
- **生效与生命周期**：改动就地生效并由 `PlayHouse.rebuildClients()` 在设置变更时重建三个类目的生图后端实例，`imagePendingTtlMs` 正确按三类目与基础配置中的最大超时计算。
- **与计划/spec 的差异**：无遗漏与偏离。

---

## 阻塞问题

无。

---

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-01 | [apps/server/src/config.ts:413-421](apps/server/src/config.ts#L413-L421) | **清空字段后若类目变成空对象，仍会被保留在 `kinds` 中**：当用户在设置页清空某个类目的所有覆盖项时，`mergeKindOverride` 会逐个 `delete` 字段使其变回 `{}`。虽然语义上 `{}` 等同于跟随基础，且合并与比较逻辑正确，但在长时间多次编辑后，`settings.json` 中可能会残留 `"kinds": { "background": {}, "cg": {}, "sprite": {} }`。 | 建议在 `mergeKindOverride` 处理完毕后，或在 `applyPatch` 写入 `kinds[kind]` 时判断 `Object.keys(merged).length === 0`；虽然当前 `freshSettings()` 默认带三个 `{}` 结构也合法，但如果考虑对干净 JSON 的维护，可在需要时精简空键，或者保持现有 `{}` 对齐 `freshSettings` 契约（作为已知设计决策保持亦可）。 |

---

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| ADV-01 | [apps/web/src/views/SettingsScreen.tsx:459-483](apps/web/src/views/SettingsScreen.tsx#L459-L483) | **设置页类目折叠小节的展开状态在保存后重置**：`SettingsScreen` 中的 `save()` 成功后执行 `setSettings(fresh); setDraft(draftOf(fresh));`，由于使用的是原生 `<details>` 且未受控绑定 `open`，浏览器通常会保留 DOM 的 open 状态，但在组件重挂载或表单 reset 时可能折叠。属于原生 `<details>` 正常行为，不影响功能。 | 记录备忘即可，保持轻量无受控状态的设计是合理的。 |

---

## 准入结论

**结论**：`准入`

**说明**：核心功能实现扎实，服务端配置解析、多实例工厂构造、生命周期管理与前端设置页体验均高度符合规划；代码规范、类型检查与单测全部通过，无阻塞性缺陷。
