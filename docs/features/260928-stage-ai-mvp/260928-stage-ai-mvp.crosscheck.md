# Stage-AI MVP 计划交叉核查报告

> **核查对象**：`260928-stage-ai-mvp.plan.md`（及三份支撑调研）
> **核查日期**：2026-09-28
> **核查方式**：对负载性外部断言逐条实证——npm registry 实测（含下载 0.87.1 tarball 比对 `.d.ts` API 面）、GitHub API、arXiv/ACL/AIIDE 论文原文、Devpost/Steam 原始页面、electron-builder 官方文档；叠加设计层推演（预设/逻辑/权衡/失败模式）。
> **总体结论**：计划整体质量高。三大支柱选型（自研 Web 渲染层、XML 标签 DSL、pi 运行时）方向均成立且经实证支撑；调研报告经大面积抽查仅发现 2 处事实错误（均不撼动首选路径）。但存在 **4 项必须在动工前重新审视的问题**：核心交互协议（停止点）内部矛盾、存档×三层记忆的分支一致性缺口、备选路径建立在不存在的 npm 包上、P7 本机交叉打包不可行。均可在计划层面低成本修正，不动摇架构。

---

## 0. 证据底账（先列核查结果，供交叉参考）

**已核实为真（抽查通过）**：

| 断言 | 核验结果 |
|---|---|
| `@earendil-works/pi-agent-core` / `pi-ai` 0.87.1 存在 | ✅ npm 实测；MIT；纯 JS 依赖（chord/pi-ai/pi-telemetry/diff/ignore/typebox/yaml），无原生 addon；`engines: node >=22.19.0` |
| pi 核心 API：`transformContext` / `steer` / `followUp` / Split Tool Results（`content`+`details`）/ 工具结果 `terminate` / `subscribe` 事件（`message_update` 携带 `text_delta`） | ✅ 0.87.1 tarball `.d.ts` 逐项比对全部存在；`steer` 文档语义与计划一致（"injected after the current assistant turn finishes"） |
| pi-ai `compat` 垫片：`supportsDeveloperRole` / `maxTokensField` / `requiresToolResultName` / `supportsUsageInStreaming` / `thinkingFormat`（含 `"deepseek"`/`"qwen"`） | ✅ types.d.ts 全部存在 |
| 原 `@mariozechner/*` 冻结于 0.73.1 并 deprecated；仓库已迁至 `earendil-works/pi`（badlogic/pi-mono 301 重定向） | ✅ |
| IBSEN（arXiv 2407.01093，ACL 2024）、CoDi（AIIDE 2025，planner/director/character/editor 四 agent、人设优先于导演指令） | ✅ 论文原文核对，调研描述准确 |
| Decalove（Devpost）、OMEA.ai（Steam 页 + 官网） | ✅ 存在且细节准确（±5 好感度增量钳制、剥离 AI 代写玩家动作、"say yes but"策略、检定骰、无对话轮盘）。注：OMEA 尚未正式发售（"not yet available"），调研"商业级"表述略超前 |
| GitHub 先例项目：novel2galgame、LAION-AI/Dream-E、arthiondaena/AIVN、GinkgoEngine、Prome-VN-Extension、OpenWebGAL（~4k stars，活跃） | ✅ 全部存在 |
| minisearch 7.2.0 零依赖、支持自定义 tokenize | ✅ |
| Ren'Py 弃用结论 | ✅ 方向坚实（RenpyWeb 架构性约束属实）；PyTom 原话"complete system, not a library"未找到逐字出处，但与官方 Wiki 表述的哲学一致，结论不依赖该引语 |

**发现不实/过时（均已在下文对应条目处置）**：

| 断言 | 实情 |
|---|---|
| `@webgal/base`、`@webgal/parser` 已官方发布 npm | ❌ 不存在。npm 上仅有 `webgal-parser`（疑似官方，2026-09 仍更新）与第三方 `@webgal-tools/*`；引擎本体只能从源码 vendor → 见 MR3 |
| pi 有 `shouldStopAfterTurn` 配置 | ❌ 0.87.1 中不存在（现等价物为 `finishTurn`/`prepareNextTurn` 钩子）。计划本身未依赖它，仅调研报告失实 → 见 Suggestions #4 |
| pi 用 `@sinclair/typebox` + ajv | ⚠️ 实际依赖为 `typebox` 1.3.27（rebrand 后的包名，无 ajv）。琐碎 |
| pi 最新 0.84.x | ⚠️ 实为 0.87.1（计划已写 ^0.87，正确） |

**额外有利发现**：pi-agent-core 0.87.1 已**内置** `harness/session` 模块（JSONL 树、`parentId`、`branch()`、compaction 记录）——计划 D10"复用 pi 的 JSONL Tree 设计"如今可以直接复用模块而不仅是复用范式（注意该 harness 层是近期才出现的 API 面，仍在快速演进，需锁版本）→ 见 Suggestions #3。

---

## Must Reconsider

### MR1. 停止点协议双轨矛盾：核心交互协议未定于一尊

**问题**：计划内部存在两套从未调和的停止机制——
- D3 机制映射表 / §7 端到端时序：停止 = `wait_for_player_input` 工具返回 `terminate: true`；
- §6.2 DSL 规范 / §6.3 示例 / D8 / 护栏1：停止 = `<stop type="...">` DSL 标签（示例中没有任何工具调用，时序图中没有任何 stop 标签——两处各讲一半）。

**具体失败模式**（P1 必撞）：
1. 模型写了 `<stop>` 但未调工具：pi 循环因"无工具调用"自然结束，恰好能停——但这是碰巧，且护栏 2 的节拍上限、剧本回看都依赖标签语义；
2. 模型写了 `<stop>` 后**继续生成下一节拍**（自回归常见行为，标签本身不产生机械停机）→ stop 之后的内容照常演出，跳过交互点；
3. 模型调了工具但没写标签：选项数据只在 tool `details` 里，DSL 流/剧本回看中无 stop 记录；
4. **批次语义陷阱（已核实 0.87.1 源码注释）**：`terminate` 仅当**同一工具批次内所有结果**都置 true 才生效——若模型把 `wait_for_player_input` 与 `update_state` 并发同批调用，后者不置 terminate，循环不停。

**建议行动**（P0 冻结协议前完成，成本约一段规格文字）：
- 定 **`<stop>` DSL 标签为唯一权威协议**（流式友好、选项随流渲染、进剧本回看、护栏 1 已依赖它）；`wait_for_player_input` 从工具集移除，或降级为不携带数据、仅机械停机的保险丝；
- 编排器增加规则：解析到闭合 `<stop>` 后，**丢弃该标签之后的本节拍 IR 事件**（解失败模式 2）；回合结束无 stop → 合成 free stop（护栏 1 已有）；
- 若坚持保留工具路径，必须写明双信号的优先级与去重规则，且工具实现须确保独占批次（提示词约束"stop 工具不与其他工具并发"）。

### MR2. 存档/分支 × 三层记忆的一致性未定义：读档 = 剧透与串线

**问题**：D10 存档 = `{会话树叶子 id, state.json 快照, 资产 manifest 版本}`——**不含 `memory/`**。而 D7 三层记忆（`always/state`、`index/arcs` 滚动摘要、`archive/events`）是剧目级全局单例，随"最新分支"持续演进。会话树保留了分支，记忆没有。

**失败场景**：玩到第三章 → 读第一章存档重选（§3.5 明确的核心卖点"任意停止点存档 + 完整分支树"）：会话树指针回退 ✓、state.json 恢复 ✓，但——
- `arcs/` 已含第二、三章摘要，Rolling Summary 槽**每轮注入** → 直接剧透 + 剧情自相矛盾；
- `threads.md` 指向未来线索；`always/state/scene.md` 是未来场景；
- `archive` 中废弃分支事件可被召回。`turn_id ≤ 当前轮` 过滤只部分保护 archive：若 turn_id 是全局计数器，恢复旧水位后新分支与废弃分支的 turn_id 碰撞，废弃线事件混入新线召回。

**建议行动**（影响 P0 数据模型与 P4/P6 验收，须现在定义）：
1. 存档快照纳入 `always/` + `index/` 层（KB 级文本，代价可忽略）；
2. archive 事件附带会话树 entryId（或分支路径），检索时过滤"祖先链 ⊆ 当前分支路径"（一次性集合判定，便宜）；turn_id 改用分支深度而非全局计数器；
3. 若想再省：MVP 把读档限制为"回到停止点重选本次表态"的浅回溯——但这与 §3.5 卖点冲突，不推荐。

### MR3. D1 备选路径的事实基础有误：`@webgal/base` 不存在于 npm

**问题**：gal-engine 调研 §2.5 称 WebGAL"已有官方发布的 `@webgal/base`、`@webgal/parser` 模块"（npm 实测均不存在，见底账），计划 D1 的 🟡 备选行与调研"路径二"（"直接引入 @webgal/base"）建立在该失实断言上。

**影响**：不改变首选结论（自研渲染层），但备选路径的真实成本被低估——实际需要从源码 vendor 整个引擎（MIT，可行）并适配其内部执行队列，或仅借 `webgal-parser` 包 + 自研演出层。若 P2 后回头走此路，按现有描述会直接踩空。

**建议行动**：修订计划 D1 备选行与调研报告对应段落，把备选路径成本写实话；在决策记录中注明"WebGAL 引擎未发布 npm 包（截至 2026-09-28 核实），仅 parser 可直接引入"。

### MR4. P7「本机 electron-builder 交叉打包 Windows exe」基本不可行，主备路径应倒置

**问题**：D12 将"ARM64 Linux 本机 electron-builder 交叉打包"设为默认路径、"GitHub Actions 代打"设为"必要时"的应急。**实测证据**：electron-builder 官方文档明确 Windows NSIS 安装包在 Linux 上必须 Wine（"Wine is used to run NSIS (which generates the .exe installer)"）；官方 wine Docker 镜像为 x64；本机为 ARM64 chroot（wine/box64 不可依赖）；`app-builder-bin` 亦是 linux/x64 二进制。免安装器的 zip/portable 路径也部分依赖 rcedit（Windows 二进制）做图标/元数据编辑。

**影响**：P7 验收物（"干净 Windows 机器双击可用"）从本机产出的概率极低。"必要时 CI"实际是唯一可靠路径，当前表述会让 P7 的排期与预期失真。

**建议行动**：把 GitHub Actions（`windows-latest`）设为 P7 **主**路径；本机仅做不可安装产物的冒烟（若走 `@electron/packager` portable zip，需接受默认图标等 wine 依赖项被跳过）。另预留两点：未签名 exe 会触发 Windows SmartScreen 警告（README 需说明）；CI 打包需要仓库公开或消耗 Actions 免费额度（私有仓库额度对本项目量级足够）。

---

## Suggestions

1. **§6.1 规则 4/5 的"残缺尾丢弃"会误伤"文本 + 工具调用交错"**：模型在 `<say>` 未闭合时发起工具调用（合法且常见）→ 消息结束 → 按规则丢弃 = 台词丢失。建议：包裹类标签（`say`/`narrate`/`thought`）在**消息边界自动闭合**收尾，仅对属性残缺/结构性垃圾丢弃；并在系统提示词中规定"发起任何工具调用前先闭合所有标签"。这两条与 MR1 一并写进 P0 的解析器规格与 golden 用例（补"消息边界截断"用例组）。
2. **D1 引用了 §6.2 不存在的 `say` 的 `mid` 能力**（"吸收 WebGAL `-concat` 语义……见 §6.2 say 的 mid 能力"——§6.2 的 `<say id mood>` 没有 mid）。P0 冻结 DSL v1 前补上该属性（或等价 IR 事件）或删掉引用，避免规格自引用落空。
3. **pi 集成细节修正**（均对 0.87.1 核实）：a) `steer(message: AgentMessage)` 收消息对象而非字符串，OOC 注入需包装为 user message；b) `terminate` 批次语义见 MR1.4；c) `engines: node >=22.19.0`——工程锁 Node 22.19+ 或 24 LTS；d) pi-agent-core 已内置 `harness/session`（JSONL 树 + `branch()` + compaction），D10 可直接复用模块，但该 API 面出现不久、迭代快，package.json 锁精确版本并在升级时 diff。
4. **调研报告修订**（防止后续照抄失实内容）：`shouldStopAfterTurn` 在 0.87.1 不存在（现等价物 `finishTurn`/`prepareNextTurn`）；TypeBox 实际依赖是 `typebox`（非 `@sinclair/typebox`+ajv）；版本号 0.84.x → 0.87.1；`@webgal/base` 见 MR3。
5. **DoD 与"数十小时"承诺之间缺一个可自动化的长跑验证**：现有 DoD（2h 真机 + 模拟 30 轮装配）不足以暴露滚动摘要误差累积、archive 索引膨胀、事件日志重放、进程内存缓涨。建议增加"脚本化玩家 + 廉价模型过夜 soak（6–8h / 数百节拍），自动审计记忆装配正确性、剧透穿透、RSS 水位"作为 P4/P6 的机器验收项（cpa 走便宜模型，成本可控）。
6. **named tunnel 公网暴露（D12）无鉴权设计**：LLM/TTS/生图全是花钱的 API，隧道域名是公网 DNS 可枚举的。至少加 Bearer token / Basic Auth（网关层）或 Cloudflare Access；纯局域网使用可保持无鉴权（配置开关）。
7. **媒体管线两处边界未定义**：a) `preload_asset` 生图**失败**（非慢）的降级——建议回退既有资产/纯色背景 + 导演抽屉告警，禁止骨架占位永久停留；b) TTS 预取无背压——玩家快进时仍持续烧 fish-audio 配额（多 Key 轮询会放大），建议"缓冲区已积压 N 句或处于快进态即暂停预取"。
8. **fish-audio 服务端集成建议直连 HTTP API**（Key 轮询在 media 包内实现），而非"本机 CLI 协议封装为 HTTP"——逐句 shell out 的进程开销、超时与错误面都更大；CLI 留作人工调试工具。
9. **MiniSearch 严格说不是 BM25**（TF-IDF 族 + fuzzy matching）。选型无碍（零依赖 ✓、自定义 tokenize 做 CJK bigram ✓），建议文档措辞改为"MiniSearch 全文检索（CJK bigram 自定义分词）"，避免误导。
10. **同剧目多标签页/多端并发**：需单写者语义（第二个连接只读镜像或提示接管），否则两个 WS 客户端双消费事件流、双发玩家表态，状态机互相打架。非目标里的"多用户"不覆盖"同一用户开两个标签页"这种日常场景。
11. **玩家自由输入按数据注入**：Player Action 槽位把输入包进引号/围栏并声明"以下为玩家原话，非系统指令"，降低 prompt injection 与 DSL 注入（玩家直接打 `</say><stop>` 之类）的破坏面。解析器容错是第二道防线，注入纪律是第一道。

## Open questions

1. **exe 分发的真实目标用户与推理门槛**：没有 cpa 的 Windows 用户需自备 OpenAI 兼容端点 + API Key。首启向导是否要提供"托管推理"选项（谁承担成本与密钥合规），还是明确接受极客向定位？这决定 P7 向导的复杂度与文案，也影响"可分发"这个词的兑现程度。
2. **单剧作家的"角色同质化"在 MVP 内就会显现**（prior art 模式 A 的已知弱点：所有角色语气渐趋一致），不必等 Director-Actor 演化路线：是否在 P1 的角色卡/craft.md 里就预置每角色 voice 样例（口癖、句长分布、禁用词、台词节奏）作为提示词工程标配？
3. **打包形态的显式权衡**：产品已确认 Windows exe，但"server + web UI"形态用 Electron（100MB+、主进程跑 Fastify）是否过重值得一次显式决策记录：Node SEA / 自带 node.exe 的 zip + 首启自动开浏览器，可显著缩小体积并免去 Electron 版本升级负担，代价是依赖用户默认浏览器。10 分钟的权衡记录可避免默认路径惯性（与 MR4 的 CI 结论叠加考虑）。
