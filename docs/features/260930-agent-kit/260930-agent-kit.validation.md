# 统一 Agent 基座 验证记录

日期：2026-09-30　分支：`feat/agent-kit`　计划：`260930-agent-kit.plan.md`

## 一、验收项逐条

| # | 需求 | 验证方式 | 结论 |
| --- | --- | --- | --- |
| 1 | 工坊 agent 与剧作家共用一套工具实现，只有暴露面不同 | `test/agentkit.test.ts`：两侧工具 id 集合按角色过滤；两侧 `generate_image` 的 `parameters` JSON **逐字节相同**、`description` 不同 | 通过 |
| 2 | 剧作家能借同一实现给临时角色生图 | `test/playAssets.test.ts`「临时角色：剧作家给 characterName 就自动注册 stub」；`test/image.test.ts` 排产断言 `spriteKicks === ["mio"]` | 通过 |
| 3 | `beat_done` 工具（含 options / placeholder / 都不给） | `test/orchestrator.test.ts`：载荷 → `stop` 事件 + 停止点 + 谱系；`terminate === true` | 通过 |
| 4 | 停止点选项、预发射不再走 DSL 标签 | `test/orchestrator.test.ts` 里已无任何 `<stop …>`/`<option>` 文本；`test/image.test.ts` 断言 preload id 集合 | 通过 |
| 5 | 逐剧目 agent 设置（模型 / 思考 / 工具开关） | `test/agentkit.test.ts`（`disabledTools` 过滤、`can` 位翻转）+ `test/http.test.ts`（两个目录端点）+ 真机 UI | 通过 |
| 6 | 工坊新增「Agent」页签 | 浏览器实测（下图一） | 通过 |

## 二、自动化验证

构建与类型（`--filter` 逐包，core 的 dist 必须先建）：

```
pnpm --filter @stage-ai/core build        # 0
tsc -p apps/server/tsconfig.json --noEmit # 0
tsc -p apps/web/tsconfig.json --noEmit    # 0
```

单测按模块单跑（本机 8GB，多文件并发会让 sharp 相关的用例假超时）：

| 包 / 模块 | 结果 |
| --- | --- |
| core（7 个文件） | 92 passed |
| server `agentkit` | 12 passed |
| server `orchestrator` | 26 passed |
| server `workshop` | 38 passed |
| server `prompt` | 14 passed |
| server `compaction` | 11 passed |
| server `playAssets` | 13 passed |
| server `image` | 12 passed |
| server `http` | 4 passed |
| server `playhouse` + `transport` | 12 passed |

真机 e2e（`./scripts/dev-worktree.sh`，端口经 `acquire-port` 动态分配；公网 quick tunnel 地址见交付消息）：

1. **两个目录端点**：`GET /api/agents/tools` 返回 19 个工具（带中文名 / 分组 / 归哪些角色）；`GET /api/agents/models` 透传网关 `/v1/models`（本机网关 200，列出 cere/… 等模型）。
2. **工坊「Agent」页**：模型下拉首项为「跟随服务端默认（gemini-3.5-flash-lite）」、思考档位四档、工具按「轮与停止点 / 生图 / 记忆与状态…」分组列出开关，页面无红字、无错位。
3. **设置落盘**：把剧作家思考档位改成「浅思考（low）」→ 点「保存设置」→ `plays/demo/play.json` 出现
   ```json
   "agents": { "playwriter": { "thinking": "low" } }
   ```
   （验证后已把该文件还原为 HEAD 内容，不留残余。）
4. **beat_done 真机**：默认模型跑完整演出，两个 beat 都在谱系里落成
   `stop {"stopType":"choice","options":[…3 条…]}` 与 `…[…2 条…]`，
   历史里是**真的工具调用** `{"role":"toolCall","name":"beat_done","args":{"options":[…]}}`；
   舞台摆出同样的选项卡 + 「自由发挥…」。

   ![beat_done 的选项卡与舞台](beat-done-options.png)
5. **generate_image 真机**（模型换成 cpa `medium`）：同一轮里模型发起**真的工具调用**
   `generate_image(kind="background", name="bg_eaves_rain_night", …)`，谱系落 `preload` 节点（seq 108），
   证明「工具 → IR 事件」这条路在真实网关上成立。工坊侧的 `write_memory` 同轮也是真调用。
6. **错误不静默**：本机网关没有 `gpt-image-2` provider，出图真实失败——舞台顶部直接给
   「生图失败：生图 HTTP 400: …unknown provider for model gpt-image-2」，演出不中断。

   ![生图失败的显式提示](asset-failed.png)
7. **模型不在内置目录时的提示**：切到 cpa `medium` 后服务端日志按设计打了一条
   `[stage-ai] 模型「medium」不在 pi-ai 内置目录：沿用 gemini-3.5-flash-lite 的元数据（思考档位与输出上限可能不准）`。

   ![工坊 Agent 页签](agent-tab.png)

## 三、计划外发现（一条，值得记）

**模型会把工具调用写进正文，而不是走函数调用通道。**

`gemini-3.5-flash-lite`（`.env` 里的 `STAGE_MODEL_ID` 默认值）连续三轮都把生图写成正文里的
`<call:default_api:generate_image …/>`。这不是我们教的格式，是它自己 harness 格式的泄漏。
后果：**那张图不会出现，界面上也什么都不说**——解析器把标签外裸文本丢掉，工具从未被调用。

- 同一模型下 `beat_done` 却是真的工具调用（两次都成功出停止点），所以不是「这个模型不会用工具」，
  而是「它对时间线中段的副作用调用（生图）会写成文本」。
- 已在提示词的生图章节补一条硬规则（「走函数调用，别把它夹在台词里当标签写」），真机重跑**没有改善**。
- 换 cpa `medium` 后同一套提示词下零泄漏，工具调用正常（见上第 5 条）。**结论是模型侧差异，不是本次改造的 bug。**
- 迁移前同一批模型能用 `<preload_asset>` 标签出图（`plays/mh`、`plays/test` 的历史谱系里有 preload 节点），
  所以对**坚持用 flash-lite 的剧目**来说，工具化确实收紧了这条路径。要么给这类剧目换一个走函数通道的模型，
  要么等网关侧把 Gemini 的函数调用转换补全。

## 四、没有覆盖到的

- **真实出图到货**（占位 → 淡入）：本机网关没有可用的出图模型（`gpt-image-2` 400），失败路径已验（上面第 6 条），
  成功路径由 `test/image.test.ts` 的假流 + 既有的 `STAGE_E2E_LIVE=1` 真机 e2e 兜底。
- **工坊侧改模型后真开一轮**：模型解析（`resolveCpaModel`）与装配（`createAgentKit`）都有单测，
  真机只验了「设置 → play.json → 服务端接受」这一段；工坊长对话本身没有真跑（成本高、收益低）。

## 五、增量：定点编辑工具（2026-10-01）

用户要求「编辑工具全面仿照 pi 原生的设计，区别仅仅是限制范围」。落成 `edit_file`
（`agentkit/filesTool.ts` + `agentkit/editText.ts`），只归工坊——剧作家的记忆写入走 `write_memory`。

| 需求 | 验证方式 | 结论 |
| --- | --- | --- |
| schema 与 pi 的 `edit` 同形（`path` + `edits[{oldText,newText}]`，`minItems: 1`） | `test/editFile.test.ts`：`prepareArguments` 兼容 JSON 字符串 / 单对象 / 顶层 `oldText+newText` 三种历史写法 | 通过 |
| 匹配语义：精确 → 模糊（NFKC / 行尾空白 / 智能引号 / 连字符 / 特殊空格） | 同上：「引号/行尾空白不一致也能改，且只重写被触碰的行」——未触碰的行按原字节拷回 | 通过 |
| 唯一性与重叠：命中多处或两段交叠一律拒绝 | 同上两条用例 | 通过 |
| BOM 与行尾原样保留 | 同上：`\uFEFFa\r\nb\r\n` 改一行后仍是 CRLF + BOM | 通过 |
| 范围限制：路径走 PlayFiles 白名单、play.json 过 `parsePlayConfig` | 同上：`session.json` 与不存在的文件都拒绝且不落盘；把 `play.json` 改坏结构不落盘 | 通过 |
| 同一路径的写操作串行 | `fileLocks`（同一 Map 管 `write_file` / `edit_file` / `delete_file`），pi 的 `withFileMutationQueue` 的最小版 | 通过（代码路径；并发时序由锁保证） |

单测：`test/editFile.test.ts` 12 passed、`test/agentkit.test.ts` 12 passed、`test/workshop.test.ts` 38 passed、
`test/prompt.test.ts` 15 passed；`tsc -p apps/server/tsconfig.json --noEmit` 0。

顺带修掉两处工具描述与实现不符（同一次改动里）：`inspect_asset` 声称「和 read_file 同一套白名单」
但实际只做路径越界检查（改用 `pathOf(path, "read")`，白名单这才真的生效）；
`delete_file` 说「删除 memory/ 下的文件」而实现还能删 `theme.css` 与 `assets/manifest.json`（描述改成实话）。
