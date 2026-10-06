# 检视报告

## 概要

本次检视覆盖 `dsh-aivn` 仓库 master 分支下未提交的**阶段 2（素材生成）**全部改动，包括 `src/media/`（契约、三类生图协议、音乐、后端装配、抠底、出图入库资产管理）、新增的 5 个 Agent 工具（搭台助手 4 个、剧作家 1 个）、能力面判定与双角色 persona/注入分叉、技能库更新、双语 README、`build.mjs` external 配置以及新增的媒体离线自动化套件 `e2e/verify-media.ts`。

整体评价：架构设计干净利落，扎实对标了 AIVN 工坊侧的素材生成语义，同时准确适应了 DSH 会话制模型的特性（如将剧作家缺图改造为同步一步入库、将候选预览下放至 Markdown 图片直出）；类型安全、构建与 22 项离线测试全绿；代码结构严谨，路径越界防御到位。**本次检视无阻塞问题**，给出条件准入（建议合并前处理 2 项建议改进）。

---

## 需求对齐

检视依据包括：
1. `261006-workshop-parity.plan.md`（§4.5、§5、§7、§8）；
2. `261006-workshop-parity.validation.md`（§6-§10）；
3. `261006-workshop-parity.assets.research.md`。

核查结果如下：
- **能力位门控与装配**：`can.image` 与 `can.music` 在地址和模型均配齐时才激活；未配置时不注册工具、persona 干净回落至 fallback 章且绝不提及未注册工具名，两角色提示词与工具清单完全闭环。
- **两套出图等待策略（D3 决策）**：搭台助手坚持「两步法」（`generate_image` 产出草稿 → 挑中后 `commit_asset` 入库），草稿不入素材表不污染台账；剧作家缺图坚持「同步一步法」（`generate()` 串行 `draft` + `commit`），调用即出图并当场入库，符合会话模型单轮自洽要求。
- **协议与契约实现**：Gemini、OpenAI、ModelsLab 三协议客户端与音频单一 Gemini 协议完整照搬，垫图规则（Gemini 独占多张/ModelsLab 单张/OpenAI 拒绝）、画幅校验容差比对（12%）、立绘 2K 档位下限、mimeType 自适应扩展名与音频 `.m4a` 默认策略均符合预期。
- **立绘抠底与留底原片（D2 决策）**：色键中位数提取、全局色键、反解带宽、限色等纯算法完整保留，`media-cache/sprite-sources/` 留存抠底前原片作为 `recut_sprite` 的前提；`sharp` 作为正式依赖并在 esbuild 中声明为 external，避免打包原生模块破坏插件加载。
- **既定不做项（D1、§8）**：周目/故事树、应用级素材库跨剧目导入、AIVN 前端广播通道/审批状态机均未引入，保持纯净。

---

## 阻塞问题

无。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| -   | -    | 无   | 无   |

---

## 建议修改

| ID | 位置 | 问题 | 建议 |
| -- | ---- | ---- | ---- |
| S1 | `src/stagehand/prompt.ts:133` | **提示词口径微小笔误**：在搭台助手的出图要点中写道「立绘**四档**取景（`framing`：full / half / square）」，但枚举实际上只有 `full`、`half`、`square` **三档**（后半句体量 `stature` 才是四档：small / normal / large / huge）。虽然模型能读懂后续括号，但这属于文字口径不一致。 | 将「立绘四档取景（`framing`：full / half / square）」改为「立绘三档取景（`framing`：full / half / square）」。 |
| S2 | `src/media/assets.ts:534-541` | **`manifest.json` 读改写的并发安全兜底**：`withManifest` 通过 `readManifest(this.dir)` 读取当前内存/文件后执行 `writeAtomic`。在单 turn 串行执行时不会有问题；但在并发调用（例如搭台助手在同一 turn 批量并发调用 3 次 `draft`，或者用户在剧作家出图同时操作）时，`writeAtomic` 虽然保证了单次写入原子替换，但缺乏并发排队互斥锁（In-Process Lock），存在后完成的 Promise 覆盖先完成的 Promise 局部写入的潜在竞态。 | 在 `PlayAssets` 类内引入一个轻量级的链式 Promise 锁（类似 `private manifestLock: Promise<void> = Promise.resolve()`），使 `withManifest` 和 `recordLedger` 的读-改-写在内存中串行排队。 |

---

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| -- | ---- | ---- | ---- |
| N1 | `src/media/assets.ts:46` | **常量的代码自文档性**：`const NEUTRAL = 'neutral'` 定义在文件顶层，而 `@aivn/core` 或相关类型中也存在基准差分概念。作为剧目差分基准的核心标识，建议保持与上游 core 约定的紧密语义。 | 保留现状即可，已写明注释「立绘的身份基准差分名」。 |
| N2 | `src/media/assets.ts:571-589` | **草稿自动清理的 I/O 时机**：`pruneDrafts()` 目前在每次 `writeDraft` 时同步触发（通过异步 best-effort 遍历）。当草稿区累积大量小文件或目录时，高频遍历目录可能有少量冗余 I/O。 | 可以在清理函数上加一个防抖或时间戳冷却（例如距上次清理超过 1 小时才真正扫描一次），目前草稿量小，属于 Nice-to-have。 |
| N3 | `e2e/verify-media.ts` | **E2E 临时目录清理保证**：套件末尾执行了 `await rm(dir, { recursive: true, force: true })`，若中间断言抛出未捕获异常退出，临时目录可能会残留在 `/tmp` 下。 | 可在外部包裹 `try...finally` 确保无论测试通过还是异常中断都清理临时目录。 |

---

## 准入结论

**结论**：`条件准入`

**说明**：代码实现完整、扎实，不仅精确还原了 AIVN 工坊与剧作家侧的素材生成与处理机制，而且严格遵守了 DSH 运行时的无假绿、不谎报能力、路径沙箱防御与原生外部模块打包规范。测试套件完备且全数通过。建议处理 S1（文案笔误）与 S2（原子写入竞态兜底）后合入主分支。

---

## 检视结论的处理

| ID | 处理 | 落点 |
| --- | --- | --- |
| S1 | 已改：「立绘四档取景」→「立绘三档取景」，并在离线套件的 persona 断言里钉住这个用词（`on.includes('立绘三档取景')`），写错就红 | `src/stagehand/prompt.ts:133`、`e2e/verify-media.ts` |
| S2 | 已改：读-改-写按**文件路径**加串行队列（`withFileLock`，模块级 `Map`，跨 `PlayAssets` 实例共享——工具是并发调用的，各建各的实例，锁挂在实例上等于没锁），`withManifest` 与 `recordLedger` 都走它；队列里存「吞掉结果的版本」，一个任务失败不毒化后面的任务，空闲时清 Map | `src/media/assets.ts` |
| S2（验证） | 新增断言 M22：并发落库五首曲子后素材表与台账一条不少。**确认它抓得住**：临时把锁去掉跑一遍 → `✗ M22 …（0/5）`，装回来 → 23/23 通过 | `e2e/verify-media.ts` |
| N3 | 已改：套件在 `process.on('exit')` 里兜一次临时剧目清理（正常路径末尾照旧删），断言中途抛异常也不在 `/tmp` 留东西 | `e2e/verify-media.ts` |
| N1 | 不动（注释已写明「立绘的身份基准差分名」） | — |
| N2 | 不动：与 AIVN 同口径（每次出图顺手清一次），草稿量小、`pruneDrafts` 本身 best-effort 且失败不打断出图 | — |

复跑：`npm run e2e:media` **23/23**、`npx tsc --noEmit` 通过、`npm run build` 通过；
`dsh-e2e` 的 `stagehand` / `verify-injection` 两套在改动后重跑仍全绿。
