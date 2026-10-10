# 检视报告

## 概要

检视范围覆盖当前 worktree（`single-tree`）相对 HEAD 的全部改动以及最新修复提交。改动将 stage-ai 从“一剧目多周目/多存档树”彻底收敛为“一剧目一棵路线树”，移除了 PlaySaves、saveId、active.json、SavesView 及全部周目 REST 接口；会话与谱系日志直接落在剧目根；START 按钮按开演状态切换“NEW GAME”与“新的开始”；通过 `?new=1` 和 WS `restart` 驱动从根节点 fork 出新运行枝；提示词对齐 rules/lores 语义及当前路线优先原则。

经复核，上一轮检视提出的阻塞问题与主要建议项均已妥善修复：StageScreen 改用 `history.replaceState` 清理 query 参数避免了路由二次抖动；`restartFromRoot` 加入了 `whenIdle` 保护；helloSync 与 useStageSocket 中的 switched 死逻辑已清除；app.css 中的周目页废弃样式已移除。

## 需求对齐

- **单树落盘与多周目清理**：彻底废弃周目系统与切档机制，移除 `saves.ts`、`active.json`、`SavesView.tsx` 及相关 REST API。会话与事件日志直落剧目根，且导出剧目包时正确排除运行时数据。
- **首次与新开始 START 状态机**：Title 画面根据 `readiness.started` 区分初次演出与“新的开始”；通过 `?new=1` 传参进入舞台并一次性触发 `restart`，URL query 清理改用 `history.replaceState`，不触发全局 hash 路由重新解析与组件重载。
- **root fork 状态初始化与并发**：编排器实现 `restartFromRoot()`，等待 `whenIdle()` 后以 `forkTo(ROOT_ID, { resume: true })` 在根节点开启新分支；修复了状态回写时场景属性的 fallback 逻辑。
- **共享 Core 协议一致性**：WS 协议精简，移除 `saveId` / `saveName`，新增 `restart` 客户端消息，前后端类型契约保持严密一致。
- **rules / lores 提示词契约**：明确 rules 为规则与创作事实、lores 为世界观设定，物理路径完全兼容 `memory/index/`，并硬性规范“当前路线优先，其他分支事实不得带入”。

---

## 阻塞问题

无。

---

## 建议修改

[Should fix；不影响准入但建议后续迭代跟进。无则写「无」。]

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-01 | [apps/server/test/transport.test.ts:22](apps/server/test/transport.test.ts#L22) | **测试 mock 数据遗留废弃的 `save` 属性及旧周目注释**。<br>`transport.test.ts` 中 fakePlayhouse 的 mock runtime 对象仍然定义了 `save: { id: "stest", name: "第 1 周目" }`，以及注释「舞台连上走 stage（缺周目才建）」。`PlayRuntime` 接口已不再包含 `save` 字段。 | 清理 `apps/server/test/transport.test.ts` 中多余的 mock 属性 `save` 和废弃注释，使测试夹具与核心类型完全一致。 |

---

## 非阻塞问题

[Nice to have；记录备忘。无则写「无」。]

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| ADV-01 | [apps/web/AGENTS.md:10](apps/web/AGENTS.md#L10) | **模块级 AGENTS.md 仍提及已删除的 SavesView**。<br>`apps/web/AGENTS.md` 中写有 `周目页 SavesView enter/重命名/删除`。 | 在后续文档同步维护中更新 `apps/web/AGENTS.md`，删除 SavesView 相关的说明。 |
| ADV-02 | [apps/server/src/store.ts:180-189](apps/server/src/store.ts#L180-L189) | **`touchMeta` 每次保存遍历当前叶路径**。<br>`touchMeta` 每次保存都会调用 `tree.chainEvents(tree.leafId)` 来计算拍数和最后一句文本。当前深度下开销极小且单树每轮仅落盘一次，性能可接受。 | 保持现状即可，后续若分支极长可考虑按需增量计算。 |

---

## 准入结论

**结论**：`准入`

**说明**：全部功能与架构收敛符合预期，阻塞问题已全部清零，协议与数据持久化逻辑严密，可以进入下一阶段。
