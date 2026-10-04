# 剧作家收成通用工具 · 计划

工作区 `.worktrees/generic-tools`，分支 `feat/generic-tools`，开发基线 `main@4c605d0`。
合入时主分支已前进到 `main@1622ffb`（样例剧目撤出、NSFW 按读者隔离三条），变基后有两处冲突
（`memoryTool.ts` 的依赖清单、`memory.test.ts` 里被替换的用例位置），就地解决后合入 `main@a6d9678`。

## 起因

剧作家维护两类剧目文件：角色卡（`characters/<id>.md`）与记忆卡（`memory/index/**/*.md`）。
它为此有**两个专用工具**：`create_character`、`write_memory`，各自带自己的 schema、参数名与路径守卫。
而工坊（搭台助手）早就在用 pi 的内建 `read` / `write` / `edit` 改同一批文件。

玩家完全可以玩到一半去工坊 agent 那里改完再回来接着玩。两边的写入对象、白名单、后果完全一致，
差别只在「谁调的」——这就是一份冗余：两套 schema、两处路径守卫、两处格式说明，改一处必漏一处。

用户的决定（原话）：「我不喜欢这样冗余的做法，还是按照剧作家收成全通用工具吧。」
补充边界：「update_state 是特例可以不用动」。

## 决策

**剧作家的写路径收成通用 `read` / `write` / `edit`，与工坊共用同一个 `PlayEnv` 与同一份
`PlayFiles` 白名单。读路径里带分支语义的两个保留为专用工具。**

保留 `update_state`：它写的 `stateFiles` / `engine.affinity` / `engine.flags` 活在 `LineageTree`
的谱系快照里，必须随分支切换、分叉、回退一起回滚（`restoreBranchState` 就地改 `this.stateFiles`，
因为工具闭包持着那个对象）。文件是剧目级的、不随分支回滚，两者不可能合并成一个写口。

保留 `read_memory_detail` / `search_archive`：它们的过滤条件是分支——
`read_memory_detail` 按 `arcIds` 过滤纪元卡，`search_archive` 按 `tree.pathSet()` 过滤历史切片。
通用 `read` 会绕过这两个过滤器，等于把别的世界线的内容和还没演到的压缩摘要直接摊开。

## 两处必须补上的洞

专用工具不只是「多一个口」，它还承担了两件通用工具不自动承担的事：

1. **写完立刻排一次轮边界重建。** A 区（每轮注入的提示词）在纪元内冻结，回执承诺的
   「下一轮进 A 区角色表 / 记忆索引」靠 `rebuildAtBeatBoundary` 兑现。通用写口没有这条链路，
   所以要在 `PlayEnv.writeFile` 落盘成功后回调出去，由宿主登记角色 id 并排重建。
   当轮想知道自己刚写了什么，模型直接 `read` 那个文件——内存里的 `cards` 不再有第二条写入口。
2. **格式说明的落点。** 角色卡 frontmatter 与记忆卡「首行标题、次行摘要」的格式原本写在被删掉的
   工具描述里。pi 的内建工具**没有描述覆写入口**（`piTools.ts` 只做适配），格式只能搬进剧作家提示词。
   这是项目规矩「工具知识只写在工具描述里」的一处明确例外，在 `apps/server/AGENTS.md` 里记下了。

顺带把 `write_memory` 的路径守卫（`always` / `arcs` / `archive` 拒绝写入）搬到文件层：
`memory/arcs/`（纪元压缩产物）与 `memory/archive/`（逐轮切片）是引擎产物且跟分支走，
手改手建会绕过上面那两个过滤器，所以改成**看得见、改不动**（`GENERATED_PREFIXES`）。
`memory/always/` 仍然可写（`craft.md` 本来就是工坊与用户共编的）。

## 不做

- 不动 `update_state`（用户的明确边界）。
- 不动 `read_memory_detail` / `search_archive`（分支过滤没有文件等价物）。
- 不给剧作家开 `bash`（它绕开整个白名单层，没有理由为这次收束引入）。
- 不写「探索性新功能」：`carryOver` 补偿、快照 diff + `lineage.jsonl` 恢复、NSFW 纪元隔离
  这三条只留方向，不在本轮实现。

## 风险与对策

| 风险 | 对策 |
|---|---|
| 通用写口破坏「角色表 = `characters/` 目录文件列表」的一致 | 写盘回调按 `characterIdOfPath` 认角色卡并登记，与引用即导入同一条路 |
| 一轮里多次写盘 → 连着重装多份 runtime | 复用 `rebuildAtBeatBoundary` 的 `pendingRebuilds` 去重（同剧目只挂一个待办） |
| 模型整篇 `write` 覆盖既有卡，抹掉 `voiceId` / `sprites` 等机器字段 | 提示词硬性要求「改既有卡先 read 再 edit」，并单测钉住 `edit` 保住别的字段 |
| 格式搬进提示词后与 `parseCharacterCard` 漂移 | 提示词的字段清单与 `parseCharacterCard` 的 `SCALAR_FIELDS` 对照写；解析结果才是真相源 |
| `onWrite` 回调链漏路径 | `PlayEnv.writeFile` 是**唯一**写面（`playFiles.ts` 的白名单收口），回调挂在它上面；两处覆盖率由 `playEnv.test.ts` 钉住 |
