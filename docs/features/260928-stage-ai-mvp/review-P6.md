# 检视报告

## 概要

本次代码检视覆盖 stage-ai 项目 P6 阶段（路线树 + 书签 + 四原语 + 设置面板 + 移动端适配与过夜 soak 脚本）的全部新增与变更代码。整体架构清晰，严格遵循 DSL 冻结、谱系 append-only、四原语正交等核心原则，核心模型契约完备；但在上下文重建（rebuild）、整幕重写截断锚点计算以及配置面板的前后端数据一致性上存在 3 处阻塞级缺陷，需修复后方可准入。

## 需求对齐

本阶段变更基本对齐了计划文档（§3.5、D10、P6）与 DoD 的要求：
- **四原语正交性**：路线树视图中跳转（jump）、分岔（fork）、编辑（edit）、重写（rewrite）、分岔后 OOC（ooc_at）与书签（bookmark）均以独立 action 暴露，不发生隐式联动；书签仅作为命名标记挂接快照，不移动挂载点、不污染重放缓冲。
- **谱系日志 append-only**：所有节点突变与编辑均以事件追加记录，未改写既有历史事件。
- **移动端与设置面板**：落地了 100dvh、visualViewport `--kb` 软键盘避让变量及 `.env` 逐键回写能力。
- **与 DoD 偏离点**：
  1. 原地编辑台词后，LLM 对话轮次上下文未应用文本覆盖（违背 D10）。
  2. 整幕重写的拍边界截断将玩家输入保留在祖先链中，产生空轮次与双重回灌。
  3. 设置面板保存后拉取旧内存配置，导致 UI 表单跳回旧值。
  4. soak 脚本 RSS 采样了客户端进程自身而非服务端。

---

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| BLK-01 | `apps/server/src/rebuild.ts:110-145` | **`lineageToBeats` 遗漏文本覆盖映射，导致编辑台词后生成上下文仍含旧内容**<br>在 `lineageToEvents`（L19–24）中正确建立了 `overrides` 并在输出 IR 事件时通过 `textOf` 覆盖；但在供 LLM 对话轮次重建的 `lineageToBeats` 中，`case "say"`、`thought`、`narrate` 均直接读取 `event.text`，未传入也未应用 `overrides`。<br>这导致原地编辑台词后，虽然前端回放看到新台词，但编排器通过 `rebuildMessages` 重建 Agent 后，LLM 看到的历史上下文仍然是未修改的旧文本，直接违背计划 §D10“后续生成上下文用新文本”的铁律。 | 提取共享的 `buildOverrides(chain: readonly LineageEvent[]): Map<string, string>` 逻辑；在 `lineageToBeats` 开头计算 `overrides`，并在 `say`/`thought`/`narrate` 提取文本时统一使用 `overrides.get(event.id) ?? event.text ?? ""`。 |
| BLK-02 | `apps/server/src/orchestrator.ts:742-756` | **整幕重写截断锚点落入正文，导致玩家输入节点遗留并造成双重回灌与畸形空轮次**<br>在 `resolveBeatAnchor` 中，检测到本拍首事件为 `player/ooc` 时，将 `recap` 提取后将 `anchorId` 推进到 `chain[start + 1]`（即正文首节点）。<br>随后 `recordRewrite(anchorId, ...)` 将 `leaf` 设为 `anchor.parentId`——由于正文首节点的 `parentId` 恰好是 `chain[start]`（`player` 节点），导致该玩家输入节点未被回退，依然留在祖先链中！<br>后果：`lineageToBeats` 在历史中构造出了一个 `{ user: recap, assistant: "" }` 的畸形空轮次；紧接着 `rewrite` 调用的 `beginBeat` 又发出了包含 `【玩家表态】\n${recap}` 的 user 消息，造成玩家表态被双重注入且历史出现连续 user 消息/空白 assistant 响应，可能导致模型幻觉或部分 API 报 400 失败。 | 整幕重写旨在回退整拍并重新演绎。截断目标节点应当是本幕起始的 `chain[start]`（即 `player/ooc` 节点自身），让挂载点回退到 `chain[start].parentId`（上一拍的 `beat_end`），使整拍（包括旧玩家输入）完全切出主链；提取出的 `recap` 仅在随后的 `renderRewriteTurn` 中回灌。 |
| BLK-03 | `apps/server/src/configApi.ts:36-54`<br>`apps/web/src/views/SettingsScreen.tsx:57` | **设置面板读写数据源脱节，保存后立即刷新导致 UI 表单被旧内存配置重置**<br>`SettingsFile.read()` 仅返回服务进程启动时传入的 `this.config` 内存对象，并未读取解析 `.env`；而 `SettingsFile.write()` 将修改逐行写入了 `.env` 文件，但并未同步更新内存中的 `this.config`。<br>在前端 `SettingsScreen.tsx` 中，用户点击保存后执行 `save()`，其在写回成功后立即调用 `load()` 重新拉取设置；此时 `GET /api/config` 依然返回未改变的旧 `this.config`，导致页面上的输入框瞬间被旧值覆盖重置，给用户造成“保存未成功”的严重误导。 | 方案 A（推荐）：`SettingsFile.write()` 在成功写回 `.env` 后，将传入变更同步回写更新内存中的 `this.config` 属性；<br>方案 B：`SettingsFile.read()` 每次动态解析 `.env` 文件，以磁盘当前值为准，辅以 `this.config` 作为缺省后备。 |

---

## 建议修改

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| REC-01 | `apps/server/src/configApi.ts:81-83` | **设置面板无法将 `STAGE_API_KEY` 清空**<br>`if (model.apiKey && model.apiKey !== mask(this.config.apiKey))`。当用户希望移除 API Key（例如切换为本地无需认证的端点）将输入框清空时，`model.apiKey` 为 `""`，此判断为假，无法写回空密钥。 | 改为判断 `model.apiKey !== undefined && model.apiKey !== mask(this.config.apiKey)`，当传入 `""` 时允许清空配置项。 |
| REC-02 | `apps/server/src/orchestrator.ts:615-620` | **`removeBookmark` 缺少 `guardIdle()` 守护**<br>`addBookmark`、`editLine`、`forkTo` 等均受 `guardIdle()` 保护，而 `removeBookmark` 直接操作 `opts.tree` 并调用 `persist()`。若在拍进行中调用，可能与异步持久化发生竞态。 | 在 `removeBookmark` 开头补齐 `this.guardIdle()`，保持结构操作行为统一。 |
| REC-03 | `scripts/soak.mjs:231-237` | **Soak 脚本 RSS 采样了客户端进程自身而非服务进程**<br>`const rss = process.memoryUsage().rss / 1024 / 1024;` 获取的是运行 Node 脚本本身的轻量客户端内存，而非真正运行 LLM/编排器/状态机的服务端进程内存，无法验证 DoD 中的“服务端长跑资源缓涨与 RSS 平稳”。 | 服务端增加暴露进程指标的轻量路由（例如在 `/api/health` 或 `/api/config` 中附加 `serverRss`），soak 脚本通过轮询服务端接口统计真实 RSS 趋势。 |
| REC-04 | `apps/server/src/configApi.ts:158-170` | **`.env` 回写未防御换行符注入**<br>`set` 函数直接拼接 `${prefix}${value}`，若传入字符串含 `\n`，会导致 `.env` 产生意外的新行配置。 | 在更新前对 `value` 进行换行符过滤或去除 `value.replace(/[\r\n]/g, "")`。 |
| REC-05 | `apps/server/src/orchestrator.ts:705-722` | **拍中分岔/跳转后恢复的停止点语义需进一步对齐**<br>`restoreStopPoint` 在节点不是 `stop` 或 `beat_end` 时缺省赋予 `{ stopType: "pause" }`，玩家点击继续后会以 `continue` 表态向模型开拍续写，而非接着放完该拍剩余内容。 | 属于当前设计的正常权衡，但建议在设计文档或前端提示中明确“拍中分岔即截断后续并开启新演”的语义。 |

---

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| NBL-01 | `apps/web/src/stage/LineagePanel.tsx:281` | 剧本视图的台词改写输入框未绑定快捷键（如 `Ctrl+Enter` 提交、`Esc` 取消）。 | 在 `textarea` 的 `onKeyDown` 中补充快捷键支持，提升导演编辑操作流畅度。 |
| NBL-02 | `apps/web/src/stage/LineagePanel.tsx:322-326` | 路线树深度缩进固定 capped 在 12 层，深层分支可能在视觉上扁平化。 | 当前 MVP 平铺实现已足够；后续路线树体验升级为可视化连线图时统一重构。 |
| NBL-03 | `packages/core/src/lineage/model.ts:315` | `LineageTree.describe()` 仅以 `createdAt` 排序，毫秒级同戳事件的排序可能不稳定。 | 排序改为以 `createdAt` 为第一键、`id` 为第二稳定键：`a.createdAt - b.createdAt || a.id.localeCompare(b.id)`。 |

---

## 准入结论

**结论**：`不准入`

**说明**：存在 3 个阻塞性问题（BLK-01 编辑台词后生成上下文缺失覆盖、BLK-02 整幕重写截断锚点遗留旧表态导致畸形空轮次与双重回灌、BLK-03 设置面板保存后 UI 状态被旧内存数据重置）。须优先修复上述 3 项阻塞问题后重新提交检视。
