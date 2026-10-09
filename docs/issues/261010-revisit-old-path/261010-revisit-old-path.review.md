# 检视报告

## 概要

本次改动针对用户报告的「跳转至历史节点后继续走到轮末，再按继续会异常生成新分支而非沿旧路继续推进」的缺陷进行了修复（提交 `ef7902bd`）。核心调整包括：在 `revisitOldPath` 中将锚点放宽识别根节点 `root`、针对不带新意图的「继续」动作放宽来源标签完全匹配、并将 `prevLeafId` 传入重构后的 `LineageTree.beatEndFrom(headId, prefer)` 使其在遇到轮中岔口时沿历史世界线顺延至 `beat_end`。整体方案针对性强、改动精炼，与既有架构与设计不变量吻合良好。

## 需求对齐

本次修复完整覆盖并满足了用户报告的三类根因场景：
1. **跳开端卡按继续**：锚点放宽识别 `root`，不再从零新建世界线分支；
2. **旧路下一拍以「插一句/选项」开头**：「继续」动作不带意图，不再强制要求 `originOfBeat` 逐字相同，能够沿用历史记录（`prevLeafId`）推进；
3. **拍内历史分岔（重写曾落于拍内）**：`beatEndFrom` 顺着世界线（`prefer` 优先、`beat_end` 次之、最早非 fork 再次之）贯通至真实 `beat_end`，避免挂载点停在拍半途导致后续触发新一轮生成。

与排查文档（`261010-revisit-old-path.troubleshoot.md`）及验证文档（`261010-revisit-old-path.validation.md`）的范围完全对齐，未发现遗漏或过度设计。

## 阻塞问题

无

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S-01 | [packages/core/src/lineage/model.ts:369](packages/core/src/lineage/model.ts#L369) | `beatEndFrom` 内部在 `kids.length > 1` 的循环步中调用 `this.isAncestor(kid.id, prefer)`，而 `isAncestor` 实现为 `this.ancestorChain(nodeId).includes(...)`，在长拍深树且多次岔口的链条上存在微小重复扫描。 | 目前单拍深度通常受控在几十行以内，开销有限；后续若单拍规模增大或分支更复杂，可考虑将 `prefer` 的祖先链提取为一个 `preferAncestors: Set<string>` 集合传入或在方法入口处一次性求出，将匹配优化为 O(1) 查表。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | [apps/server/src/orchestrator.ts:972](apps/server/src/orchestrator.ts#L972) | `revisitOldPath` 中通过 `candidates.find((entry) => entry.child.id === hit.id)!.endId` 反查 `endId`。由于 `hit` 来自 `candidates` 映射，此处断言安全，但如果写成 `hitEntry.endId` 或让 `lastVisited` 支持传递带元数据的对象，可以省去一次 `find`。 | 仅为代码自文档性与可读性优化，可保留现状。 |
| N-02 | [docs/references/261009-cross-host-verification.md](docs/references/261009-cross-host-verification.md) | 本次改动了共享包 `packages/core`（`LineageTree.beatEndFrom` 的签名与语义变更）。按照跨宿主规范，核心包改动会同步到兄弟仓 `dsh-aivn`。 | 留意在合并到主分支发布前，按规范确认 DSH 宿主适配侧是否有依赖旧版 `beatEndFrom` 严格停在分岔点的隐式假定（查证可知 DSH 适配层未直接调用 `beatEndFrom`，仅复用 core 树模型）。 |

## 准入结论

**结论**：`准入`

**说明**：代码修改精准且边界收敛，设计与既有规范高度自洽，单元测试覆盖了三类复现场景及回归断言，无阻塞性架构与安全隐患。
