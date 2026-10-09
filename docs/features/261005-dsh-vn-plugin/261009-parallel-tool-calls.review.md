# 检视报告：同批工具调用并行化（261009-parallel-tool-calls）

## 概要

检视范围：commit `a0d6ea6`（`dsh-aivn`）的 12 个文件——`src/tool-catalog.ts`、`src/preset-tools.ts`、
`src/stagehand/prompt.ts`、`src/playwriter/prompt.ts`、三份 skill、`README.md` / `README.en.md`、
`AGENTS.md`、`e2e/verify-media.ts`、`lib/index.js`。工作区里另一位 agent 未提交的改动（技能隔离
realm、`keyColor`）**不在范围内**；下文所有行号一律以 `a0d6ea6` 的提交内容为准（工作区里 `README*` /
`AGENTS.md` / `skills/aivn-visual-craft` / `e2e/verify-media.ts` 已被那位 agent 改过，行号会漂）。

**机制那一半是对的**：我自己核了宿主侧的事实链，与 `ToolSpec.concurrent` 的注释一致(
`dsh-tools/lib/types/index.js:685-692` 的 `executionMode` 只认精确 `true`，其余一律 `exclusive`；
`dsh-agent-loop/lib/index.js:506-540` / `551-660` 的 `executeToolCalls` / `runGroup` 让独占调用在所属
一步里形成栅栏，并行池上限 `DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10`)，装配改成
`{...tool, isConcurrencySafe: () => true}` 也安全——`register()` 只按面上字段（`name` / `output` /
`timeoutMs`）校验（`dsh-tools/lib/index.js:2878-2887`），`ToolDefinition` 是普通对象字面量，浅拷贝不
丢东西；`set_stage_style` 的独占判定也与实现相符（`src/tools/set-stage-style.ts:88-104` 读-改-写
`theme.json`，无锁）。九个工具里八个并发、一个独占，这个划分我逐条对过媒体层的锁与去重，**站得住**。

问题集中在**教学那一半**：新写的「同一批会并发跑」被当成对所有工具成立，而**同一段话上一行点名的
`glob` / `grep` 恰恰不成立**（宿主没给它们声明，是独占的）。方向没错、不会造成损坏，但这正是本提交
要消灭的那类「教一句假话」，建议一并收干净。无阻塞问题。

## 需求对齐

用户诉求两条：「生成各种素材、调用工具都尽量并行」+「在合适的地方教」。两条都落到了实处：

- **机制**：`ToolSpec` 新增**必填** `concurrent`（不给默认值，逼新工具表态），装配处
  `src/preset-tools.ts:254-256` 把它落成工具定义上的 `isConcurrencySafe`。独占的那个原样交回，
  没有多余地写一个恒 `false` 的分类器——与 `dsh-tools` 的 fail-closed 语义对得上。
- **教学**：分层与 `AGENTS.md`「提示词地图」一致（每轮契约进 persona，食谱进 skill，机制进
  工具 DESCRIPTION / README）。搭台助手《对话风格》(`src/stagehand/prompt.ts:67-68`)、剧作家
  《你怎么工作》(`src/playwriter/prompt.ts:44`) 与《缺图怎么办》(`:271-272`)、三份 skill
  (`aivn-visual-craft:163`、`aivn-audio:116`、`aivn-play-setup:20-24`) 都教到了；中英 README
  (`README.md:459-462`、`README.en.md:420-425`) 与 `AGENTS.md:17` 同步。
- **无过度设计**：没有顺手上独立的并行闸门（独立版的 `Limiter` 明确记录为「真出现再加」），
  也没有把并发教学塞进 A 区注入或工具 DESCRIPTION。

**计划文档**：本需求在 `stage-ai` 下只有 `.summary.md`（无 `.plan.md`），故需求对齐按用户原话 +
summary 对照。summary 里「没做的 / 留给以后的」两条（不搬 `Limiter`、不跑实例套件）理由成立，
我没有发现与它描述不符的地方。

**验证面**：本次只有离线判据，M45–M48 锁的是**数据**（谁声明独占）与**文案**（哪儿教了「同一批」）。
summary 自陈没跑实例套件（不碰章标题与门控条件句 + 本机内存紧张），这个取舍可以接受；但「装配那一行」
恰好落在判据的缝里，见 S3。

## 阻塞问题

无。

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | `src/stagehand/prompt.ts:62` | 注释写着「并发的机制前提……见 `tools/parallel.ts`」——**这个文件不存在**（`src/tools/` 下 10 个文件，没有 `parallel.ts`）。同一提交里 `tool-catalog.ts:11-12`、`preset-tools.ts:110-116` 都指对了家，只有这一处悬空。这类「指向不存在的文件」是后来人排查并发问题时第一个会踩的坑。 | 改成指向真正实现处：装配在 `src/preset-tools.ts` 的 `withConcurrency`，声明在 `src/tool-catalog.ts` 的 `ToolSpec.concurrent`。 |
| S2 | `src/stagehand/prompt.ts:65` 与 `:67-68`（同一处措辞也进了 `src/playwriter/prompt.ts:44`、`README.md:459-461`、`README.en.md:420-423`） | 「**同一批会并发跑**」被写成了对所有工具成立，而宿主这一侧：`read` / `read_image` 声明了并发（`node_modules/@deepseek-ai/dsh/.../dsh-tool-fs/lib/index.js:344`、`:997`），**`glob` / `grep`（`dsh-tool-fs-search`）、`write` / `edit`、`bash`、`skill` 全都没有声明 → 独占栅栏**（全量核对：整个 `@deepseek-ai/dsh` 树里只有 `dsh-tool-fs` 的 read/read_image、`dsh-tool-web` 的 web_search/web_fetch、`dsh-tool-subagent` 带这个字段）。而 persona 的**上一行**恰好把「read / glob / grep」并列成「先读一遍」的手段，剧作家那边写的是「把要读要查的东西一次读回来」——模型照做时，一半的调用不会重叠。这不会坏任何东西（栅栏只是串行，调用一个都不会丢），但与本提交「只教不补机制，教的就是一句假话」的立论自相矛盾。 | 措辞按**真的会重叠的东西**点名，别下全称判断。例如：「同批发几个**独立的读**（`read` / `read_image`）与几个素材调用（出图 / 抠底 / 入库）——它们会并发跑；`glob` / `grep` / 改文件这类宿主工具是逐个来的，放同一批也不会更快（但也不会更慢，不必刻意拆开）。」README 那句（用户向）同理：把「读几个文件」改成「读几个文件（`read`）与几张图 / 几次抠底」，别让读者以为 `grep` 也在并行池里。**需确认**：是否干脆请宿主把只读的 `glob` / `grep` 也声明成并发安全——那是上游的事，本提交按现状改措辞即可。 |
| S3 | `src/preset-tools.ts:117-119`（调用点在 `:254-256`）与 `e2e/verify-media.ts` 的 M45–M48 | 本提交的**核心机制**（catalog 的 `concurrent` → 工具定义上的 `isConcurrencySafe`）**没有判据覆盖**：M45 只读 `TOOL_CATALOG`（`e2e/verify-media.ts:665-670`），M46–M48 只读提示词与 skill 文本。把 `withConcurrency(buildTool(...), spec.concurrent)` 从 `:255` 改回 `buildTool(spec, play, deps)`，M45–M48 全绿而机制整个消失——判据锁不住它要保护的那件事。`withConcurrency` 目前是模块私有函数，e2e 够不着。 | 导出 `withConcurrency`（或一个更小的 `executionModeOf(tool)`），在 `verify-media.ts` 补一条：`withConcurrency(<任一工具>, true).isConcurrencySafe?.({}) === true` 且 `withConcurrency(<任一工具>, false).isConcurrencySafe === undefined`。M45 那条留作「谁独占」的意图锁，两者互补。 |
| S4 | `src/media/cut.ts:47-48`（`cut` 的 `writeFile(outAbs, cut.data)`）与 `src/media/bgm.ts:37`（`generate_bgm` 的 `writeFile(abs, music.bytes)`） | 这两条被声明成可并发，但它们**直接写最终路径**（无 tmp+rename）。同批两次落在**同一个目标**上（`cut` 的 `output` 指回同一张已入库立绘、同名的两支曲子）会交错写入——`cut` 的 DESCRIPTION 恰恰推荐把 `output` 指回 `assets/sprites/<id>/<variant>.png` 这个稳定路径。对比：`persist`（`media/catalog.ts:25-31`）走 tmp+rename，同目标并发只会「最后写者胜」，不会写出坏文件。影响面小（要模型误用才触发），但既然这一格声明的是「并发安全」，闭环成本很低。 | 二选一：(a) 这两处改走 `storage.ts` 已有的 `writeAtomic`（各两行）；(b) 在 `cut` / `generate_bgm` 的 DESCRIPTION 里点一句「别在同一批里对同一目标发两次——后一次的写入会盖掉前一次」。倾向 (a)，与 `persist` 口径一致。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `src/media/generate.ts:26`（有 inflight 去重）vs `src/media/bgm.ts:20-40`（无） | 媒体层的「并发就绪」在出图那侧是完整的（模块级 `generationInflight` + 按路径的 `withFileLock`），但 BGM 这条**没有同目标去重**，落盘也不原子。`aivn-audio` 现在教「要出几首就放同一批」，同名单批两次 = 双倍配额 + 静默覆盖（`replaced: true` 只在台账/回执里看得出来）。同为「按最终目标去重」的意图，两条路不一致。 | 要么给 `generateBgm` 挂上 `generate()` 同款的模块级 `inflight` 表（key = `dir\u0000bgm/<stem>`），要么在 `aivn-audio` 那句后面补半句「同一首别在一批里发两次」。 |
| N2 | `src/playwriter/prompt.ts:271` | 「一轮的预算是 240 秒」这句在本插件里找不到对应物：DSH 的 agent loop 没有步级/轮级预算（`dsh-agent-loop` 里搜不到 240s 相关的 step timeout），插件自己的 240s 是**音乐后端单次调用**的超时（`src/index.ts:136`、`src/media/backends.ts:75`），出图是 180s（`:66`）。本提交正好改到了同一句的尾部，顺手核一下这句想说什么——而且并发之后它的论证也变了：N 张同批 ≈ 一张的等待，剩下的正当理由是**配额**不是时间。 | 若原意是「别为以后可能用得上而出、别烧配额」，就把时间论据删掉只留配额；若确有某个预算数，写出它的来源。属既有文案，不阻塞。 |
| N3 | `src/media/generate.ts`（无闸门）vs 独立版 AIVN 的 `Limiter`（`STAGE_IMAGE_CONCURRENCY`，默认 6） | 声明并发之后，一批最多 10 张 2K 图会同时进后端：同一把 key 打同一网关（`media/backends.ts` 无排队、无 key 轮询限速），本机还要同时压 sharp 并持有整幅位图。summary 已明确记录「真出现额度被一批打空再加」，此处只作备忘：**若加，闸门该落在 `media/generate.ts` 这一层（与 inflight 同层），不要落进提示词**——提示词管不了这个。 | 记录在案即可；下次出现 429 / 内存尖峰时按上面那层加。 |
| N4 | `src/tool-catalog.ts:35-52`（`concurrent` 字段） | 这一格声明的是「实现能不能重叠」，但实现体在别的文件（`src/tools/*.ts` + `src/media/*`）。以后有人给 `import_asset` 加一处无锁的共享写，没人会回头改 catalog——M45 只保护「独占者唯一」，不保护单条声明的诚实性。这是「单一真相源」选型的固有代价，不是错。 | 在字段注释里补一句「改这几个工具的实现时要回来复核这一格（尤其是新增跨调用的共享状态）」，把复核点写在会被读到的地方。 |

## 准入结论

**结论**：`条件准入`

**说明**：机制那一半查证无误、可以直接用——九个工具的并发/独占划分与媒体层的锁、去重、草稿隔离
逐条对得上，装配方式对宿主 `register()` 与 `executionMode` 契约都安全，`lib/index.js` 已重建
（新文案与 `concurrent` 标志都在产物里）。合并前建议落实 **S1**（把 `tools/parallel.ts` 这个不存在的
引用改对）与 **S2**（「同批并发」的措辞别下全称判断——`glob` / `grep` 不会重叠）；**S3** 希望在
同一轮补上（装配那一行现在没有任何判据看着，是本次改动唯一「拆了不会报警」的地方）；**S4** 与四条
非阻塞项可留待后续迭代。
