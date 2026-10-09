# P6 轴范围分析独立复核

## 1. 一句话结论

§9 的大方向成立：运行时语义不应强行文件化，`read_memory_detail` 与 `set_craft` 有文件化路径；但当前代码下工具面已是 **25 项**而非 24 项，`library_import` 并不等价于插件的 `import_asset`，P6-d 的回滚论证不成立为“无损”，P6-b 的“工坊文件页共用写锁”也不成立。

## 2. 逐条判定复核表

| 工具 | §9 判定 | 我的判定 | 是否一致 | 证据 |
|---|---|---|---|---|
| `beat_done` | 不能/不该 | 不能/不该 | 一致 | 服务端工具以 `terminate` 收束，`apps/server/src/agentkit/beatTool.ts:76-80`；编排器对同批调用和漏调有专门处理，`apps/server/src/orchestrator.ts:651-669`。插件停止点是助手消息末尾的 DSL 标签，`/root/projects/dsh-aivn-shared/src/preset-tools.ts:36-38`，这是分支/重建载体要求，不是同一宿主机制。 |
| `update_state` | 有条件能 | 有条件能，但“天然不损回滚”不成立 | 部分不一致 | 服务端当前把 affinity/flags 留在 engine，把 scene/threads 留在 `stateFiles`，`apps/server/src/agentkit/memoryTool.ts:62-83`；快照虽同时保存两者，`apps/server/src/orchestrator.ts:2105-2114`，恢复也分别恢复，`apps/server/src/orchestrator.ts:1585-1598`。搬到文件后必须新增解析、校验、运行态同步和分支边界处理，不能仅因快照已有 `stateFiles` 就宣称无损。 |
| `enter_nsfw` | 不能 | 不能 | 一致 | 它改变模型选择，`apps/server/src/orchestrator.ts:625-647`，并有 pending 状态，`apps/server/src/orchestrator.ts:659-669`附近的轮处理；文件 flag 不能替代轮边界换模型。插件能力面明确没有该通道，`/root/projects/dsh-aivn-shared/src/capabilities.ts:13-15`。 |
| `exit_nsfw` | 不能 | 不能 | 一致 | 同上；服务端退出还涉及专用摘要/提交链路，§9 所引 `apps/server/src/orchestrator.ts:2065-2069` 应保留为实现证据。 |
| `read_memory_detail` | 能文件化 | 能文件化 | 一致 | 服务端工具只是调用 `readCard`，`apps/server/src/agentkit/memoryTool.ts:97-113`；插件提示词给出记忆卡路径，`/root/projects/dsh-aivn-shared/src/play/play-context.ts:248-266`（§9 引用），文件目录和路径教学也在 `/root/projects/dsh-aivn-shared/src/play/play-files.ts:17-20,72-79`。代价是丢失标题/路径容错与可用项回执。 |
| `search_archive` | 有条件但统一收益 0 | 有条件但不建议做 | 一致 | 服务端查询带当前分支 `pathSet` 与 NSFW 过滤，`apps/server/src/agentkit/memoryTool.ts:116-129`；插件没有同等 archive 文件/分支树，`/root/projects/dsh-aivn-shared/src/capabilities.ts:13-15`。grep 替代会丢相关性排序、limit 语义及过滤。 |
| `list_saves` | 能（数据是文件）但收益 0 | 能读目录但不应作为统一目标 | 一致 | 存档布局和 `list()` 语义在 `apps/server/src/saves.ts:5-10,117-139`；插件无周目概念，不能凭“有目录”得到同一产品动作。 |
| `read_lineage` | 不建议 | 不建议 | 一致 | 服务端返回的是按存档、路径过滤、分页和 kind 渲染的故事树，不是简单文件读取；工具装配为工坊专有，`apps/server/src/agentkit/kit.ts:493-543`。插件能力面没有 lineage，`/root/projects/dsh-aivn-shared/src/capabilities.ts:13-15`。 |
| `list_library` | 能（目录）但收益 0 | 有文件/目录可读，但统一收益 0 | 一致 | 服务端工具执行筛选、描述渲染和 40 条截断，`apps/server/src/agentkit/libraryTool.ts:87-133`；插件明确不假定跨剧目库，`/root/projects/dsh-aivn-shared/src/capabilities.ts:13-15`。 |
| `library_import` | 有条件能并入 `import_asset` | 有条件可重构，但不属于“两边收敛”；应降为服务端内部重构 | 不一致 | `library_import` 是按库 kind/entryId 复制并写角色卡/素材的复合动作，`apps/server/src/agentkit/libraryTool.ts:137-189`；插件 `import_asset` 是路径/URL/草稿等来源的登记，当前目录清单没有 library，`/root/projects/dsh-aivn-shared/src/tool-catalog.ts:53-125`。只有先给 `import_asset` 增加受控 library source 才能复用，仍不能说插件已有同一动作。 |
| `read_skill` | 不能/不该 | 不能/不该 | 一致 | 服务端只读技能目录的专用工具，`apps/server/src/agentkit/skillTool.ts:18-35`；插件技能由预设行集提供，`/root/projects/dsh-aivn-shared/src/preset-tools.ts:17-24,44-45`，宿主通道不同。 |
| `set_craft` | 能文件化 | 有条件能，但建议先保留工具 | 部分不一致 | 插件明确教模型定点 edit `play.json`，`/root/projects/dsh-aivn-shared/src/play/play-context.ts:112-114`；服务端工具同时做 patch、枚举校验、锁和回执，`apps/server/src/agentkit/craftTool.ts:98-146`。直接 edit 会失去当场 enum 拒绝、三态 patch 语义和可靠回执，且当前文件页写口不共用该锁。 |

## 3. 漏判与新增项

### 3.1 当前实际工具数

当前 `apps/server/src/agentkit/kit.ts:276-305` 的 `TOOL_CATALOG` 有 **25 项**：12 项宿主流程候选（§9 表中的 12 项）加 13 项其它工具。其它 13 项包括 `generate_image`、`generate_asset`、`generate_bgm`、`annotate_asset`、`cut`、`import_asset`、`list_voices`、`web_search`、`read/write/edit/bash`、`validate_play`。因此“24 = 12 + 12”已过时；没有第 13 个宿主流程候选，但有第 13 个“其它”工具。

插件当前目录是 10 项，而不是 §9 叙述中的 9 项：`/root/projects/dsh-aivn-shared/src/tool-catalog.ts:53-125`（含 `validate_play`、`set_stage_style`、媒体/检索工具）。不过 §9 的“插件没有这 12 个服务端宿主流程工具”仍成立。

## 4. 四条替代形态的代价复核

### `update_state` → 状态文件 + watcher

必须付：

- 迁移数据模型：当前 engine 的 affinity/flags 与 stateFiles 分属两套状态，`apps/server/src/agentkit/memoryTool.ts:62-83`；需定义 `state.json` schema、初值、坏 JSON/未知角色/增量校验、clamp 和部分成功回执。
- 保留分支语义：快照确实克隆两类数据，`apps/server/src/orchestrator.ts:2105-2114`，但文件化不会自动把工作区文件变成分支状态。必须在写后解析并更新当前运行态，在 beat close 写入 snapshot，在 jump/fork/restore 时用快照覆盖工作态；否则共享文件会把不同分支的写混在一起。
- 保留可见性和回执：当前工具逐项报告 applied/rejected，`apps/server/src/agentkit/memoryTool.ts:85-93`。watcher 若只观察写盘而不返回校验结果，模型无法自纠。
- 提示词：要把 affinity 的“增量而非目标值”、角色 id、单次 ±5、flags 目标值和状态文件路径教给模型；插件现有世界状态章只覆盖文件写法，`/root/projects/dsh-aivn-shared/src/playwriter/prompt.ts:145-165`。
- 测试面：服务端 memory/agentkit/orchestrator/prompt 的单测和分支回退用例均需重做；插件至少要覆盖合法/非法写、跨轮可见、跳转/分支/冷恢复。

可选：把文件写作为“提议”队列，在轮边界统一提交，能降低中途状态污染，但会改变当前工具的即时回执和下一轮可见时机。

### `read_memory_detail` → `read`

必须付：提示词路径指引、索引路径一致性、读权限确认；丢失 `readCard` 的三种命名容错和“未找到时列可用条目”回执（`apps/server/src/memory.ts:97-105`、`apps/server/src/agentkit/memoryTool.ts:108-112`）。还要确认服务端 `PlayEnv` 对 memory/index 的读面不会误触生成物隔离（`apps/server/src/agentkit/playEnv.ts:92-113`）。这是四条中成本最低的一条。

可选：保留一个只读索引/路径校验器，但那会重新造一个专用工具，不再是纯文件化。

### `set_craft` → `edit play.json`

必须付：

- 失去 schema 的即时枚举拒绝和 patch 三态；目前 Type.Literal/Null 在 `apps/server/src/agentkit/craftTool.ts:22-95`，直接 edit 只能依赖事后 `validate_play`。
- 失去结构化回执和“只改 craft、保留其它未知字段”的实现保证，当前读改写在 `apps/server/src/agentkit/craftTool.ts:127-146`。
- 处理并发：`set_craft` 使用 `withPlayConfigLock`，`apps/server/src/agentkit/craftTool.ts:127-143`；但工坊文件页 `PUT` 走 `workshop.writeFile`，`/root/projects/stage-ai-shared/apps/server/src/http.ts:417-429`，其底层 `PlayFiles.write` 并未调用 `withPlayConfigLock`。因此 §9 所说“与工坊文件页共用一条写队列”不成立：风险真实存在，但比原文描述的共享锁更差，是锁与无锁写者并存。
- 测试：craft schema/merge、validate_play、文件页与 agent edit 交错写、runtime reload 均需覆盖。

可选：先为通用 edit 的 `play.json` 引入同一目录锁和 compare-before-write，再考虑移除工具；否则保留 `set_craft` 更稳。

### `search_archive` → `grep events.jsonl`

必须付：当前 archive 查询不是顺序文本查找，而是分支可见性、NSFW 过滤、MiniSearch/CJK bigram、相关性排序和 limit；这些不能只靠 grep 得到（`apps/server/src/agentkit/memoryTool.ts:120-129`）。还须向模型暴露当前分支节点集合，避免读到其它枝。插件没有相同 archive 产品数据，统一收益为零。可选：仅作为服务端内部存储/检索实验，不纳入 P6 收敛指标。

### `library_import` → `import_asset(source=库路径)`

必须付：库根是应用级只读源，需新增 source 类型、路径白名单/entryId 解析、角色包与主角目标、批量导入、覆写和回执；现有 `import_asset` 的目录/来源真相在插件 `src/tool-catalog.ts:53-125`，没有库依赖。它不能让插件获得同一产品能力，因此“便车”只能减少服务端代码，不增加两宿主统一收益。可选：作为服务端内部 API 合并，工具面仍登记为 host-only。

## 5. P6-d 专章

### 回滚语义

“stateFiles 本来随快照走，所以把 engine 搬进 state.json 不损回滚语义”只说对了一半。快照当前确实保存 `engine` 和 `stateFiles` 的独立副本，`apps/server/src/orchestrator.ts:2105-2114`；恢复也分别写回 `engine` 与 `stateFiles`，`apps/server/src/orchestrator.ts:1585-1598`。但普通文件是剧目级工作区数据，不能自动获得 branch-local 版本。要实现无损，watcher 必须把文件内容转换为当前 branch 的运行态，并在 beat close/restore/fork 明确定义优先级、坏文件处理和初值；否则跨分支写入会污染后续分支，或恢复后文件与 engine 分裂。结论：可做，但当前论断不成立，必须把“文件是输入/缓存，快照才是分支真值”的机制写实。

### 观察机制可行性

`tools/post-execute` 确实是可拦截并修改/阻断结果的 waterfall，DSH 类型声明为 `/root/projects/dsh-aivn-shared/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:33-72`，决策类型为同文件 `:445-480`。它可在工具成功后校验 `write/edit` 的执行参数并返回 block/feedback，但不能凭自身保证其它写者、文件页或 OS 直接改动都被观察。

`workspaceFiles.changes` 也存在，但 §9 给出的签名不对。实际声明在 `/root/projects/live2d-voice/node_modules/@deepseek-ai/dsh-api-workspace-files/lib/types/index.d.ts:74-139`：`changes(workspaceFileScope, signal)`，没有 path 参数，返回 `AsyncIterable<WorkspaceFileWatchFrame>`；说明明确写着只报告被 instrument 的 `fs/observed`，不是 OS watcher（同文件 `:117-124`，以及 `lib/types/changes.d.ts:1-21`）。而且该包不在 `/root/projects/dsh-aivn-shared` 当前 node_modules 中，接入插件还需确认宿主版本、inject 服务和 workspace scope 获取方式。因此它能做观察，但不是现成的“目录级 watcher + 校验回执”；回执仍需 post-execute 或插件自己的反馈/重建协议。

### 具体文件与测试面

服务端：`apps/server/src/agentkit/memoryTool.ts:10-94`（schema/写入/回执）、`apps/server/src/orchestrator.ts:493-496,1562-1605,1706,2096-2114`（文件写回调、状态恢复、注入、快照）、`apps/server/src/playFiles.ts:66-80,220-240`（写口校验）、`apps/server/src/prompt.ts:205,286`（状态教学）。插件：`src/play/play-state.ts:16-27`（初始状态文件）、`src/play/play-context.ts:298-330`（读取/注入）、`src/playwriter/prompt.ts:145-165`（写法教学）、`src/preset-tools.ts:26-29`（工具移除后的契约）。测试至少覆盖：状态 schema/非法写、下一轮注入、同拍多写、beat snapshot、jump/fork/restore、冷启动、文件页/模型并发，以及 DSH post-execute/changes 的宿主集成；不是只加一条 e2e。

## 6. P6-b 写锁风险的实际量级

风险是真实且被低估/描述错误。`set_craft` 的读改写进入按剧目目录串行队列，`apps/server/src/store.ts:57-78` 与 `apps/server/src/agentkit/craftTool.ts:127-143`；HTTP 的整份 `play.json` 保存也进入这把锁，`apps/server/src/http.ts:397-403`。但工坊文件浏览器的 `PUT` 经 `workshop.writeFile`，`apps/server/src/http.ts:417-429`，再到 `apps/server/src/workshopSession.ts:401-405` 和 `apps/server/src/playFiles.ts:220-240`，没有调用 `withPlayConfigLock`。因此模型 `edit play.json` 与设置页/导入/资源写者之间确有读改写窗口；不是“两个都走锁所以安全”，而是“结构校验有、跨写者串行没有”。

实际量级取决于是否同时有用户在剧目设置页、素材引用导入或文件页写 `play.json`；单一模型单线程时窗口小，但 UI 保存与后台资源落盘可并行，且丢的是整份后写 JSON，影响高于普通字段冲突。建议在删除 `set_craft` 前先统一所有 play.json 读改写到目录锁，或保留工具。

## 7. P6-a…e 逐条建议

- **P6-a：值得做。** `read_memory_detail` 只是索引路径到 read，语义损失可接受；先补路径/读权限与回执测试。
- **P6-b：暂不值得做。** 文件形态成立，但当前并发锁和即时枚举校验都是真实能力；先修统一锁/compare-before-write，再决策。
- **P6-c：不值得作为统一项。** 可做服务端内部 source 适配，但插件没有应用级 library，收益为零。
- **P6-d：值得研究但不宜立即切。** 收益高、风险最高；必须先写清 branch-local 真值和文件 watcher 失败语义，再做小范围实验。
- **P6-e：值得做。** 低成本把 beat/NSFW/skill/存档/故事树/library 的宿主差异登记进契约矩阵，避免后续再次把“可读文件”误当成同一产品动作。

若只能先做两条，选择 **P6-a + P6-e**：一条是最低风险的真实删除，一条是低成本收口判定；不先动 P6-b 或 P6-d。

## 8. 建议的切法

与 §9.6 不同之处：先把 P6-c 从“有条件能、可搭便车”改成“服务端内部重构，不计统一收益”；把 P6-b 拆成“先修 `play.json` 全写者锁/冲突检测，再评估删工具”；把 P6-d 拆为“状态 schema 与分支回放设计 → watcher 原型 → 单独迁移”，不得直接把 engine 真值搬进普通文件。第一阶段只落 P6-a、P6-e 和锁/状态机制的设计测试，之后再用结果决定 b/d。
