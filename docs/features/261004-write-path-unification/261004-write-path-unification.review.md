# 检视报告

## 概要

本次检视覆盖 commit `1e81143`（工坊写路径统一重构），包含 `PlayFiles.write` 统一结构校验、`WorkshopSession` 单一置脏与收束逻辑、`PlayEnv` 委派简化及配套单测与文档。整体架构设计干净直接，成功消除债 1（多写入口校验缺失）与债 4（改动通知路径割裂），且未引入冗余逻辑与破坏性变更。

## 需求对齐

完全满足需求与既定设计边界：
1. **债 1（校验统一）**：将 `assertPlayConfig` 下沉至所有文本写入口的唯一收口 `PlayFiles.write`，agent `write`/`edit`、文件页手改、资源库导入主角卡三条路径均被统一兜底，非法配置不再落盘；`PlayEnv` 成功退化为纯代理，职责单一。
2. **债 4（收束统一）**：`changedDuringTurn` 的散乱赋值统一收束为 `markChanged()`，运行时重建统一由 `applyChanges()` 触发；回合内手工修改实现就地兑现且避免回合末二次重建，保证了演出不会被反复腰斩。
3. **既定边界保持**：未将 bash 强塞入前置校验，继续由 `applyChanges` 收束时的读盘兜底；未破坏对外接口契约；未做债 5（`pathOf` 抛中文串）。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| S-01 | [validation.md:24](docs/features/261004-write-path-unification/261004-write-path-unification.validation.md#L24) | **验证文档关于回合内手工改动生效时机的描述有偏差**：文档 B 组第 3 步记载为「在搭台助手正在回复的过程中，去文件页改一张记忆卡保存 → 不被卡住；这一轮结束时生效。」但代码中 `WorkshopSession.writeFile` 在任何时刻都是执行 `markChanged()` 后立即 `await this.applyChanges()`，即时触发重建并清除了脏标记。因此实际行为是「就地生效且本轮结束不重复重建」，而非「等这一轮结束才生效」。此描述会影响验收判断。 | 将用例说明修正为：「在搭台助手正在回复的过程中，去文件页改一张记忆卡保存 → 立即就地生效，且助手本轮回复结束时不会再次重复重建演出。」 |
| S-02 | [http.ts:410](apps/server/src/http.ts#L410) | **历史注释与实现漂移**：`http.ts` 中针对 `premise.md` 保存的注释写着「走工坊的 writeFile：它已经把『写盘 → 撤销条 → 等节拍边界再重建 runtime』串好了」。实际上 `writeFile` 显式不记撤销条（见 `workshopSession.ts:276`）。虽然该行不在本次 commit diff 范围内，但相关写路径刚完成重构，易造成误导。 | 建议在后续重构或文档同步时，将该处注释纠正为「走工坊的 writeFile：统一走置脏与重建收束通道」。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| N-01 | [playEnv.ts:71](apps/server/src/agentkit/playEnv.ts#L71) | **FileError 错误码映射粒度**：`playEnv.writeFile` 捕获到写失败时，只要路径是 `play.json` 便固定返回 `code = "invalid"`。若发生罕见的底层系统写权限/IO 错误，语义略有混淆。但考虑到该分支核心目标是拦截不合法结构回传给 agent，且详细原因在 message 里完整保留，当前简化合理，无需过度设计。 | 记录备忘，后续若需要区分文件 I/O 权限异常与结构校验异常再做细化。 |
| N-02 | [playFiles.ts:169-170](apps/server/src/playFiles.ts#L169-L170) | **局部路径规范化调用存在微冗余**：`write(rel, content)` 中第一行 `this.pathOf(rel, "write")` 已经对 `rel` 做过 `normalizePath` 与越界检查，第二行又执行了一次 `normalizePath(rel)`。因为债 5（改造 `pathOf` 返回值类型）本轮明确不做，当前写法安全自闭环，属于可保留代码。 | 待后续处理债 5 时，连同 `pathOf` 直接返回结构化 `{ abs, clean }` 一并精简。 |

## 准入结论

**结论**：`准入`

**说明**：本次重构干净利落，精准清偿债 1 与债 4；单点校验与单一收束逻辑闭环且健壮，单测设计与既有行为高度一致，未发现任何功能或架构阻塞缺陷。建议修改项仅涉及验证文档细节表述修正与一处既有陈旧注释，不影响主干代码合并。
