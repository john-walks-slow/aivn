# 抽 AIVN Agent 共用包 —— 调研

日期：2026-10-09 · 相关：`261008-aivn-dual-host/`（上一轮结论：不抽包）、
`docs/references/261009-cross-host-verification.md`

## 0. 这份调研要回答什么

用户要求：**抽得更多**——"所有工具都能复用"、"提示词也当然必须复用"。
上一轮（2026-10-08）的 ADR 结论是「不抽新的共享 Agent 包，继续 `@aivn/core` + `@aivn/stage` +
各宿主自持 Agent 装配」。本轮用实测把那个结论重新过一遍：哪些是真重复、哪些是宿主差异、
抽包的代价落在哪。

三份原始盘点（本目录）：

| 文件 | 内容 |
| --- | --- |
| `261009-inventory-plugin.md` | 插件侧 56 文件 / ~8165 行逐文件盘（行数、导出、依赖、宿主耦合、归类） |
| `261009-inventory-server.md` | 服务端 `apps/server/src` 逐文件盘 + `packages/core` 边界 |
| `261009-prompt-compare.md` | 两边提示词逐段对照（剧作家 23 段 + 搭台助手 17 段）、技能逐文件比对 |

## 1. 触发这次重开的实证

1. **`cutout.ts` 漂移出过一次真实事故**（2026-10-09，剧目 `demo` 的 `kikyo`）：上游那份有
   底色体检（`assertKeyBackground`，白底/灰底直接报错），插件这份是 10-06 的旧抄件、没有这条，
   于是白底被当成色键硬抠——浅色处抠成洞 + `despill` 压错通道把画面抹灰，一路静默入库。
   事故之后插件侧的处置是「以上游为准重抄一遍，适配面收敛到三处，同步方式定为重抄」
   （`dsh-aivn` 的 `e832b35`）。**这是「靠人重抄」这套同步方式的第一次付费记录。**
2. 重抄时才发现：那份文件 598 行里有 570 行与插件侧逐行相同，真正的适配只有三处
   （env 前缀、措辞指路、一个没人用的常量）。**"两份代码" 与 "一份代码 + 三行适配" 的差距，
   就是这次要抽掉的东西。**
3. 提示词侧同一件事：实测两边**逐字相同**的正文约 1848 字 / 71 行（最大一块 37 行 886 字），
   其余是「同题重写」——修一边忘另一边的失败模式不会报错，只会让某个实例教模型调不存在的工具。
   仓库为此已经写了 `scripts/check-agent-contract.mjs` 来守——**守卫的存在本身就是重复的证据**。

## 2. 实测：共享面有多大

### 2.1 同一份东西写了两遍（抽包的直接收益）

| 面 | 插件侧 | 服务端侧 | 关系 |
| --- | --- | --- | --- |
| 抠底 `cutout` | `src/media/cutout.ts` 613 | `apps/server/src/cutout.ts` 598 | 同一份（适配 3 处） |
| 生图协议 | `gemini-image` 156 / `openai-image` 137 / `modelslab-image` 180 / `image.ts` 178 | `geminiImage` 167 / `openaiImage` 154 / `modelslabImage` 194 / `imageBackend` 168 / `imageMime` | 同一批协议各写一遍 |
| 立绘提示词后缀 | `src/media/prompts.ts` 193 | `imagePrompt.ts` 144 | 同一份口径（key 底、身份锁、景别） |
| 联网检索 | `src/tools/web-search.ts` + `src/exa.ts` | `agentkit/searchTool.ts` + `exa.ts` | **同名同语义的工具实现两遍** |
| 音色库 | `src/tools/list-voices.ts` + `voice-catalog.ts` | `agentkit/voiceTool.ts` + `voiceCatalog.ts` | 同上 |
| 素材导入 | `src/media/import.ts` + `src/tools/import-asset.ts` | `assetImport.ts` 259 | 同语义（服务端另有 library 复制） |
| 素材台账/留底/草稿 | `media/{catalog,draft-store,commit,storage}.ts` | `generatedLedger.ts` / `playAssets.ts` 内 | 同语义 |
| 外部图下载（SSRF 防护） | `media/web-image.ts` 155 | `webImage.ts` 187 | 同语义 |
| 工具描述与参数 schema | `src/tools/*.ts`（描述 20–45% + schema 数据） | `agentkit/*Tool.ts`（TypeBox 内联） | 同一份机制数据两种写法 |
| 副作用元数据 | `tool-catalog.ts` 一句散文 | `agentkit/contract.ts` 9 个结构化布尔 | 同概念、两种成熟度 |
| 提示词正文 | `playwriter/prompt.ts` 295 + `stagehand/prompt.ts` 173 | `prompt.ts` 562 + `workshop.ts` 574 + `imagePrompt.ts` 144 | 1848 字逐字相同 + 大量同题重写 |
| 技能正文 | `skills/` 3 份 425 行 | `apps/server/skills/` 4 份 741 行 | `aivn-audio`↔`galgame-audio` 逐字重合 **86%**；play-setup 3% / visual-craft 9%（同题重写）；`galgame-bgm` 无对应物 |

### 2.2 各宿主的真实差异（抽不掉的）

| 面 | 插件 | 服务端 |
| --- | --- | --- |
| 工具运行壳 | `defineTool`（`@deepseek-ai/dsh-tools`，JSON-Schema 子集 DSL + `output.render → ContentBlock`） | `AgentTool`（`@earendil-works/pi-agent-core`，TypeBox 参数 + `textResult`） |
| 上下文对象 | `PlayContext{hub, sessionId, playDir(), broadcastStyle()}` | `AgentKitDeps`（按角色收窄的判别联合）+ `PlayEnv` |
| 提示词装配 | `persona.prefix` 烘焙 + `systemPrompt.section`(order 100–200) + `systemPrompt.context` 快照 | 常量 + 模板函数一次装进 pi `initialState.systemPrompt` |
| 技能通道 | 宿主 `available_skills` 恒列 + `skill` 工具按需加载 | 清单拼进工坊 prompt + `read_skill` 只读 `apps/server/skills/` |
| 媒介作业形态 | 同步等待（70–140s，那一轮停在那里） | 后台排产 + `pendingJobs` + 到货广播 |
| 会话/持久化 | DSH 会话日志、workspace、预设 | `PlayHouse` 1420 / saves / `LineageTree` / orchestrator 2460 |
| 传输 | host route + SSE | 手写 node:http 路由 + ws |

### 2.3 边界态（要设计接缝才能共享）

`library` / `playFiles` / `memory` / `assetImport` / `assetRef` / `generatedLedger` /
`playAssets`(1250) —— 它们今天直接握 `PlayStore` / `ServerConfig` / 目录布局。共享要先把
「存储与配置」抽成注入面。插件侧对应物（`src/play/*` + `src/media/*`）本来就已经是
「`{dir, image?, music?}` 注入」的形状，**可以先以插件这份为实现，服务端把队列架在它上面**。

### 2.4 提示词的实测结构

- **逐字相同**：~1848 字 / 71 行。最大一块 = FORMAT_RULES 的「位置说明 + 立绘四属性表 +
  台上同权 + 取景体量 + 行为词表」（`prompt.ts:156-192` = 插件 `prompt.ts:59-95`，37 行 886 字）。
  另：ROLE_INTRO 首末行、台词三类、注释章、记忆卡 3 块、演出契约章首 + 第 1/2/4 条、
  AUDIO_RULES 主体；写作参数渲染归一化后 13/13 行等价。
- **必须参数化（8 类）**：停止点载体（工具 vs 剧本标签）、世界状态来源、能力位协议、
  技能通道、宿主语汇（工具名/斜杠命令/`{{cwd}}`）、`play.json` 字段面、工具名表、NSFW 可选章。
- **应当保持不同（3 例）**：停止点载体、角色表在场分级（服务端 `activeCast` 折叠 vs 插件恒全卡）、
  工坊「读故事树」章（服务端有周目/分支，插件拍板不做）。

### 2.5 现状基线（动工前必须先记住的事实）

| 项 | 现状 |
| --- | --- |
| 服务端 `apps/server` 测试 | **753 项里 7 红**（`voice.test.ts` 4 条 + `workshopPrompt.test.ts` 3 条），main 与 worktree 都红，属既有残差；抽包期间的判据是「不新增红」 |
| 插件离线套件 `npm run e2e:media` | 58/58 绿 |
| 插件 `@aivn/core` 依赖面 | 39 条 import / 28 文件 |
| 仓库根 `skills/galgame-audio/SKILL.md` | **不是技能，是人读的选题/授权调研记录**（`apps/server/AGENTS.md` 与守卫的 `KNOWN_NON_SKILL` 都登记了用途，实测与 `apps/server/skills/` 那份 225 行不同）。本调研初稿误判成「陈旧副本」，核查后更正：**抽包时不要动它** |
| `scripts/check-agent-contract.mjs` | 现读 `packages/core` 与三份提示词文件的**硬编码路径**，文件一挪就静默失准 |

## 3. 与上一轮 ADR 的关系

ADR 的三条论据逐条复核：

| ADR 论据 | 复核结论 |
| --- | --- |
| 「共享的是领域，不是 Agent 装配」（core 已被消费 39 处） | 仍然成立，但**漏掉了「同一份领域实现的第二处」**：抠底/生图协议/联网检索/音色库/素材 use case 都不是「各宿主自持的装配」，而是同一份实现的第二份拷贝。ADR 的候选清单里只有 capability schema / tool metadata / result types / domain policy 四项，**没有盘点 §2.1 这一列** |
| 「多一个包 = 多一层构建与漂移机会」 | 反向也成立：**当前「重抄」本身就是最贵的漂移通道**（§1 已付费一次）。抽包后漂移面只剩适配器那几行，且可被类型系统与测试直接钉住 |
| 「触发条件是 rule of three」 | 用户的直接选择构成新的触发：他们要的是**维护成本**，不是第三个宿主。这一条应记为「ADR 的重启条件由用户显式豁免」 |

ADR 里仍然正确的部分（本计划照单接受）：**该进包的是稳定、宿主无关的领域声明与实现；
会话/传输/权限/队列/技能注册这些宿主机制不进包**。

## 4. 结论

1. **值得抽，而且不止抠底**：§2.1 那一列全部是「同一份东西的两份拷贝」，抽掉它们不制造中间态。
2. **"所有工具都能复用" 要按实现理解，不按工具面理解**：两边工具集合本来就该不同
   （服务端 24 / 插件 9，只有 5 个同名）。能共享的是**每个工具的实现、描述、参数 schema 与
   副作用元数据**——一份实现、两个宿主各自注册。宿主专有的（`beat_done`/`update_state`/
   `lineage`/`saves`/`nsfw`/`view_image`/`library`）各自留本地。
3. **提示词能复用的是"一份正文 + 参数"，不是"一份文本硬塞两边"**：1848 字可逐字共享，
   8 类宿主事实参数化，3 处有意差异登记进契约。
4. 抽法见 `261009-aivn-agent-package.plan.md`。

## 5. 核查后的更正（本调研初稿 → 复核）

计划初稿做过一次独立核查（expert 子代理），以下事实在核查中被推翻或收紧，已回改进本文件与计划：

| 初稿说法 | 复核结论 |
| --- | --- |
| 「根目录 `skills/galgame-audio` 是陈旧副本，抽包前先删」 | **误判**。它是写给人看的调研记录（`apps/server/AGENTS.md` + 守卫 `KNOWN_NON_SKILL` 登记），抽包不动它 |
| 「工具面可抽成一份宿主中立 spec + 双适配器」 | **不成立**。同名工具的**参数面本来就不同**：`generate_image` 服务端 11 参 vs 插件 4–5；`generate_bgm` 10 vs 3；`import_asset` 两边根本不是同一个工具（服务端是「从资源库导入」）。只有 `web_search` 接近同构 |
| 「参数 schema 取两边可执行子集的交集」 | **代价被低估**。DSH 的 JSON Schema 子集明确拒绝 `minLength/maximum/pattern`，参数根还是隐式开放对象（表达不了 `additionalProperties:false`）；服务端那些约束是 pi 的**运行时硬校验**，共享后降级为「描述里写范围」 |
| 「模块级锁/去重表会让两边各锁各的」 | **理由错误**。两宿主是不同进程，esbuild 把包 inline 进 `lib/`，内存 Map 从不跨进程。真正要注入的是服务端有而插件没有的：出图限流、`pendingJobs`/`jobIdForImage`、`onAsset` 回调、画幅校验、剧目文件路径白名单 |
| 「回执统一为纯文本」 | 对 `view_image` 不成立（返回 image 内容块）——而 `view_image`/`read_skill`/`library` 本来就该留宿主 |
| 基线红测试只是「既成事实」 | 更严重：`workshopPrompt.test.ts` 的 3 条红**正是能力位门控与 `play.json` 字段面**断言——恰好是提示词复用要改的那两族，Phase 2 用「不新增红」在这一族分不出新旧 |
