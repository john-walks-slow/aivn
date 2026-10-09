# 检视报告：list_voices 分页（261009-voice-pagination）

## 概要

检视范围：worktree `/root/projects/dsh-aivn/.worktrees/voice-pagination`（分支 `feat/voice-pagination`）
相对 HEAD 的 4 个未提交改动——`src/tools/list-voices.ts`（逻辑）、`README.md` / `README.en.md`（文案）、
`lib/index.js`（构建产物）。工具层改动本身小而干净：参数形状、边界、失败路径、文案与文档一致性都过关，
没有发现功能性阻塞问题。两处需要处理：一是 `lib/index.js` 里带进了「在 worktree 构建」产生的注释路径 churn
（合并回主检出后会误触 `build.mjs --check` 硬判），二是末尾引导语在「窗口封顶」这件事上的口径比旧文案更弱。

检视未执行任何编译 / 测试 / 真实 API 调用；`npm run typecheck`、`npm run build`、stub 自测均以任务书描述为据
（我另核了工作树里的 `lib/index.js` 与 `src/`、`.tmp/` 探针脚本来交叉验证）。

## 需求对齐

用户诉求「能看 25～50、50～75……」被完整满足，且没有过度设计：

- `page`（从 1 起、每页 25）是这类 LLM 工具的正统做法；没有顺手加 `offset` / `page_size` / `sort` 等用不上的旋钮，
  符合项目「实用主义」取向。DSH 内置工具里没有可对照的分页惯例（在 `/usr/lib/node_modules/@deepseek-ai/dsh` 下
  未找到 `page` / `offset` 形状的参数），因此按通用做法判为 canonical。
- 关键效果已达：`language=ja` 的建议窗口 1000 条，旧实现只暴露 25 条（2.5%），现在 40 页逐页可取。
  `.tmp/voice-pagination-demo.txt` 的真实输出也印证了 page 1 / 2 / 40 与越界页的实际形态。
- 边界与失败路径齐全：`matched.length === 0` 早退保留原措辞；越界页有专门消息；`page<1` 被夹到 1；
  末页/非末页的提示分支不互相打架。`page` 走 JSON Schema 严格校验（`dsh-tools/lib/types/schema.js:264-316`、
  `json-schema.js:137`），非整数在进 `execute` 之前就被 `ToolArgsError` 拦掉，不存在 NaN 页码导致 `第 NaN 页` 的风险。
- 未找到本改动的计划文档（`stage-ai/docs/features/261005-dsh-vn-plugin/` 下无 `261009-*`），
  故需求对齐按用户原话判定；本仓库不放开发侧记录、报告落 stage-ai 的做法也符合 AGENTS.md。

## 阻塞问题

无。

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | `lib/index.js`（`git diff` 前 17 个 hunk，如 `// ../stage-ai/packages/core/dist/dsl/spec.js` → `// ../../../stage-ai/packages/core/dist/dsl/spec.js`） | 产物是在 worktree 根目录跑的 `npm run build`，esbuild 的源码路径注释按 cwd 计算，于是 `lib/index.js` 里带进了 17 处纯注释 churn（本次 19 个 hunk 中只有 2 个是真改动）。`build.mjs:116-121` 是逐字节比对，`build.mjs:136-154` 对宿主半边**永远硬判**：这一版 `lib/index.js` 合并回主检出后，任何人在主检出跑 `node build.mjs --check`（pre-commit 钩子跑的就是它）都会重建出 `../stage-ai/...` 而判「产物没跟上源码」——一次实打实的假红。历史上有先例：`e7e9868` 是 worktree 形态、`9518b4b` 是事后在主检出重建归位。证据：主检出与 worktree 的 `node_modules/@aivn/core` 软链文本相同（`../../../stage-ai/packages/core`），但主检出的 cwd 到同一真实路径只有两层。 | 二选一：(a) 合并回主检出后**在主检出重跑 `npm run build`**，把这批注释路径改动一并提交（推荐，与 `9518b4b` 同款做法）；(b) 提交前把 `lib/index.js` 里的注释路径行改回 `../stage-ai/...` 形态（但那样在 worktree 里跑 `--check` 会反过来判红）。无论哪条，都不要把「worktree 形态的产物」当成主检出的形态——这是会拦人的关卡，不是说明书。 |
| S2 | `src/tools/list-voices.ts:97-103`（并与 `:88` 的 `totalPages` 口径相关） | 末尾引导语把旧文案里唯一一句「用条件缩小范围」换掉了，只剩「下一页 page=N+1」/「已是最后一页」。两点退化：(1) 第 1/40 页时不给「条件宽，可以先收窄」的提示，模型有动机一路翻 40 页（每页 25 条 × ~3KB，是纯烧预算）；(2) `totalPages` 是**本窗口内**的页数，窗口本身有 1000 条上限（`voice-catalog.ts:13-15`），所以当 `window.total > window.entries.length` 时，末页的「已是最后一页」会被读成「全库就这些」——而窗口外的条目本页之后再也拿不到（旧文案至少留了「缩小范围」这条退路）。附带：越界页消息（`:93`）只说「共 X 条匹配，只有 M 页」，把 `全库 B` 丢了，模型在越界时反而看不清截断。 | 在 tail 里按数据补齐，而不是只补页码：<br>· 当 `window.entries.length < window.total` 时（不论第几页），补一句「本窗口只覆盖前 A 条，全库 B 条，还有 B−A 条不在窗口内——用更具体的 language / tags / query 缩小」；至少要在末页补，别让「已是最后一页」冒充「全库到底」。<br>· `totalPages` 较大（比如 > 4）时在第 1 页补一句「共 M 页、越往后热度越低，先收窄条件更省时间」，把翻页当兜底而不是首选。<br>· 越界消息补上「（本窗口 A 条，全库 B）」，与正常页的信息面一致。<br>**需确认**：`total > entries` 是否真会出现——实样本 `language=ja` 是 `共 1000 条（本窗口 1000，全库 1000）`，两者相等，看不出 Fish 的 `total` 是否自己也封顶在 1000。建议再打一次**不带条件**的窗口核对 `window.total`，再决定这条提示的措辞强度（不改也对，只是少一层保险）。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `src/tools/list-voices.ts:16` vs `src/voice/voice-catalog.ts:13` | 两个模块各有一个 `PAGE_SIZE`，含义不同（工具层一页 25 条输出 / 上游一页拉 100 条）；打包时 esbuild 已经不得不把后者重命名为 `PAGE_SIZE2`（见 `lib/index.js` 的 `var PAGE_SIZE2 = 100`），是同名异义的气味。 | 把工具层这个改成更具体的名字（如 `VOICES_PER_PAGE` / `TOOL_PAGE_SIZE`），或给另一个加限定（`FETCH_PAGE_SIZE`）。改名成本一次，收益是以后不会有人把两个数混着改。 |
| N2 | `src/tools/list-voices.ts:26` 与 `:57` | 同一件事（一页 25 条 + 翻页方式）在 `DESCRIPTION` 末句与 `page` 的参数描述里各写一遍。本仓库其它工具（如 `web-search.ts:37` 的 `numResults`）把范围与默认值只放在参数描述里。冗余不至于错，但两处措辞将来容易漂。 | 择一为准：`DESCRIPTION` 只留「结果按热度降序、一页 25 条」，翻页细节归 `page` 的参数描述；或反之。顺带可在参数描述里补一句「小于 1 按 1 算」——代码里 `Math.max(1, …)` 是静默夹取，而 schema DSL 没有 `minimum`（`dsh-tools/lib/types/schema.d.ts:14-19` 的注解只有 `description/title/default/examples`），所以只能靠文案说明。 |
| N3 | `src/tools/list-voices.ts:89` | `Math.floor(args.page ?? 1)` 里的 `Math.floor` 是死代码：`type: 'integer'` 已被 `validateJsonSchemaValue` 严格校验（`json-schema.js:137`），非整数进不到 `execute`。`Math.max(1, …)` 则确实必要（schema 无法表达下界，0 / 负数会通过校验）。 | 简化为 `Math.max(1, args.page ?? 1)`，让读者一眼看出这里只处理「页号下界」这一件事。 |
| N4 | `src/tools/list-voices.ts:9`（文件头注释）、`src/voice/voice-catalog.ts:16,18,82-88` | 页码只在**窗口缓存活着**时稳定：TTL 12h、LRU 上限 16 窗。若模型在一段很长的会话里翻到第 N 页、期间窗口被过期或挤出（17 个不同条件就够），第 N+1 页会基于重取的窗口重排，理论上出现重复或漏条。影响很小（挑音色，不是对账），但这是「分页语义」的一部分。 | 在文件头注释里点一句「页码依赖窗口缓存（12h / 16 窗）；跨窗口重取后页码可能重排」，给后来改 `WINDOW_CACHE_LIMIT` 的人一个提示。不必写防御代码。 |
| N5 | `skills/aivn-play-setup/SKILL.md:67-68` | 「音色」一节告诉模型「有 `list_voices` 就别凭记忆编——按 language / tags / query 收窄、按人设挑那个嗓子」，没提一页 25 条、不满意可以翻页。按分层规约机制归 `DESCRIPTION`，所以**不改也不算漏**；但这是唯一一处给「挑音色」写食谱的地方，第一页不理想时点一句翻页能省一轮试错。 | 可选：补半句「一页 25 条，第一页没有合适的就按末尾提示翻页，最后一页仍不理想再收窄条件」；若采用 S2 的措辞，两边保持一致。 |
| N6 | 工作树 `.tmp/`（`probe*.ts/mjs`、`probe-tool.mjs` 516KB、`probe.mjs` 512KB、`voice-pagination-demo.txt`）与 `scripts/`（`init-worktree.sh`、`dev-worktree.sh`），均未跟踪 | 这两个目录不在本次改动范围内，但 `git status` 里是 `??`，`git add -A` 会一并带走（其中还有两份半兆的打包中间产物）。另外 `scripts/init-worktree.sh` 硬编码了 `/root/projects/stage-ai`——本仓库是公开的，AGENTS.md 明确要求施工单里的绝对路径与私有仓库引用不该出现在这里。凭据面我扫过：探针都从 `DSH_AIVN_TTS_KEYS` 读 key，没有硬编码 key（`.tmp/voice-pagination-demo.txt` 里只有公开音色库数据）。 | 提交时按 hunk 挑（本仓库有 `commit-own-changes` 技能），别用 `git add -A`；`.tmp/` 建议加进 `.gitignore`；`scripts/` 若确要入库，先把绝对路径改成相对/可配置。 |

## 准入结论

**结论**：`条件准入`

**说明**：工具层改动无阻塞问题——参数形状、边界、失败路径、中英 README 同步、`lib/` 重建齐备，
用户诉求「25～50、50～75」在功能上已经达成，可以进入合并流程。合并前请落实两件事：
**S1**（回主检出后重建 `lib/index.js`，否则 `build.mjs --check` 会在主检出误报产物过期）与
**S2**（末页/窗口封顶的口径，避免模型把「本窗口的第 40 页」当成「全库到底」）；其余为非阻塞备忘。
