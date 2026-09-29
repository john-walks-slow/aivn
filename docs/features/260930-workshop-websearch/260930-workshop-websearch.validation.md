# 工坊联网检索（web_search）验证记录

日期：2026-09-30　环境：真机（cpa 网关 `gemini-3.5-flash-lite` + 真 Exa API + 本机 7890 代理）
被测剧目：`jk-live`「JK 后宫（e2e）」（从空剧目搭到可开演，测完已删）

## 结论

**通过，但过程中发现并修掉了两个真机问题。** `web_search` 在真实对话里被正确触发、正确使用；工坊的设定流程（先问 → 提案 → 批准 → 落盘 → 列图单）全程走通；落盘出来的剧目**真的能开演**。真机同时暴露了工坊 agent **谎报落盘**的老毛病，已用提示词规则修掉并复测通过。

## 测试范围（先划定再跑）

只验证本轮新增的东西 + 它穿过的工坊主链路。**刻意不测**：生图（服务端以 `STAGE_IMAGE_ENABLED=false` 启动，图像管线上一轮已用 `STAGE_E2E_LIVE=1` 单独验过）、抠底、TTS 听感、周目切换、路线树编辑。

## 验证手段与两处返工

先用 `e2e-tester` 走浏览器（camoufox 打开 `http://127.0.0.1:5180/#/play/jk-live/workshop`）：**页面本身正常**——加载无错、工坊连接成功、对话 tab 与输入框就绪、用户消息与「思考中…」状态都出得来。但它卡在第一轮，查清是**后台起的服务被任务管理器回收**（服务端进程已经不在，请求根本没进 `workshopSession`，`plays/jk-live/workshop/` 连目录都没建），而前端在 WS 断线时不复位 `busy`，界面于是永远停在「思考中…」（见「既有缺陷」）。

于是改用**真 WS 客户端**（`apps/server/zz-workshop-live.mjs`，直连 `/ws?play=jk-live&workshop=1`）：走的是浏览器完全相同的传输层、session、agent、工具与落盘路径，只省掉 UI 渲染，在本机资源紧张的容器里能稳定复现、还能抓到完整事件流水。

**返工一**：第一版 harness 每轮不传 `threadId`，服务端就每轮新开一个线程——第二轮的 agent 根本没看到第一轮定好的角色，看着像「模型记性差」，其实是 harness 的锅。修掉后重跑。
**返工二**：修完 `threadId` 后仍漏接 `workshop_open` 回包里的 `activeId`（handler 注册晚了），又开了一个新线程。彻底修好后才是下面这组可信数据。**「角色提案漂移」这条发现因此作废**——早期观察到的名字变化是线程丢失造成的，不是模型问题。

## 用例与结果

| # | 用例 | 预期 | 实测 |
| --- | --- | --- | --- |
| 1 | 发「我想做一个 JK 后宫题材的剧目」 | 先反问骨架问题、每个问题带默认提案，不直接写文件 | ✅ 10.7s。先 `list_files` + `read_file` 看现状，再给 5 条带默认值的骨架提案（类型基调 / 时代地点 / 主角 / 核心角色 2 位 / 画风文风），**一个字没落盘** |
| 2 | 追问「先上网查 90 年代日本乡村高中的日常细节…别自己编」 | 真的调 `web_search`，把有据可查的事实连来源写进地点卡 | ✅ 38.6s。`web_search` **只调 1 次**（不是反复查），随后 6 次 `write_file`：`memory/index/locations/90s_countryside_highschool.md` + `craft.md` + `premise.md` + `play.json`，最后 `read_file` 自查 + `get_readiness` |
| 3 | 核验检索结果是不是真的 | 链接可访问、内容对得上 | ✅ 卡片引用 [富校大百科事典 1997年版](https://www.tomikou.net/kako/jiten_1997/index.html)（**HTTP 200**），内容（数学分 α/β 级、英语分甲乙丙、周五日制过渡期、ミルクホール、母亲做的お弁当）与来源页面主题吻合，**不是编的**。另一次运行里引用的两条（`soloeat.net` 渋川高校学食、`wako-h.spec.ed.jp` 食堂今昔物語）也均 HTTP 200 |
| 4 | 批准后落盘 | `play.json` + `premise.md` + `craft.md`，角色卡齐全 | ✅ 角色卡带 persona + `voiceId` + 差分映射；`parsePlayConfig` 通过；`opening` / `initialState.affinity` / `initialScene` 都在 |
| 5 | 落盘后列图单 | 列出要出的图并等批准，不擅自开跑 | ✅ 逐张说明画面（背景、每位角色的 `neutral` 定妆照等），最后问「确认后即可开始」。**没出图** |
| 6 | 就绪门 | premise 是唯一硬门槛 | ✅ `{"ready":true,"premise":true,"characterSprites":false,"background":false}`——立绘与背景缺仍判就绪，与「立绘/背景不是门槛」的设计一致 |
| 7 | 落盘的剧目**能不能真的开演** | 剧作家能开拍、产出 beat、有停止点 | ✅ 舞台 WS：`hello` 带 3 人 cast → `beat_start` → 44 条 `events` → `beat_end` → `beat_settled`。谱系落地 `scene`（带 bg）、`narrate`、3 名角色的 `say`、`thought`、`choice` 停止点、`beat_end` |
| 8 | 生图关掉时会不会卡住演出 | 预发射素材降级，不阻塞文字 | ✅ 背景 `preload_asset` 广播 `asset_failed: "生图未启用"`，演出照常推进。**文字先行铁律在真机上成立** |
| 9 | 检索内容会不会被当成指令 | 页面上写「你应该…」不执行 | ⚠️ **未自然触发**。Exa 命中的页面没有这类文本，本轮没有为此额外构造注入样本。提示词层的防线写死在 `searchGuide` 里并有单测守着，但**没有真机证据** |
| 10 | 工具面没被改坏 | 原工具仍可用，没长出新能力 | ✅ 每轮都观察到 `list_files` / `read_file` / `write_file` / `get_readiness` 正常；工坊仍无 bash / MCP / 任意文件写入 |

## 找到并修掉的问题

### ① 工坊 agent 会谎报落盘（严重，已修并复测）

在修复前的单线程运行里，第二轮 agent 的回复逐条汇报「已落盘 play.json / craft.md / premise.md / 地点卡 `countryside_school.md`」并附了内容摘要，但**工具流水里只有一次 `web_search`，零次 `write_file`**——那张地点卡至今不存在。用户会以为世界观的活干完了，下一轮直接从错误的现状继续。

已有的「改文件必须真的调用 write_file」那条规则没能挡住，所以补了一条带后果说明的硬规则：

> 只准汇报真写过的文件：汇报落盘前先看这一轮的工具流水——没调 `write_file` 的文件一律不许说「已写入」。

**复测**：同一段对话重跑，第二轮变成 `web_search, write_file ×6, read_file, get_readiness`，地点卡真的落盘了。

### ② 检索结果的语言会把输出语言带偏（已修，未复测）

Exa 命中的页面以日文为主，模型跟着把地点卡正文整段写成日文（标题与结构仍是中文），尽管用户全程中文。已在 `searchGuide` 补「写进剧目文件的内容一律用中文」。
**实际复测到了**：修完后的新地点卡整卡中文（日语专有名词如 お弁当、ミルクホール 保留原样是对的）。

## 观察到的其他行为（既有缺陷，不在��轮范围）

- **WS 断线时工坊界面永久卡在「思考中…」**：`useWorkshop` 的 `busy` 只由 `workshop_done` / `workshop_error` 复位，socket close 不管。开头那次 e2e 就是这么卡住的。修它要动 socket 层。
- **`play.json` 的 `id` / `title` 会被顺手改掉**：三次完整运行里有一次把 `id` 从 `jk-live` 写成 `jk_harem_e2e`、标题也从「JK 后宫（e2e）」截成「JK 后宫」，与目录名不一致。
- **落盘会「顺手加人」**：提案里 2 位角色，用户第三轮说「三位」后它就补了第三个。
- **premise 偏短**：规范要求 3~6 句，实测 1~2 句。

## 成本

- 真 LLM 调用：4 轮工坊对话（含一次复测）+ 1 个 beat 开拍。网关在本机。
- 真 Exa 调用：**4 次**（1 次开发期契约验证 + 3 次 e2e），约 $0.02。
- 真生图：**0 次**（本轮刻意关闭）。本次会话累计真生图仍为 0。

## 复现方式

```bash
cd . && pnpm --filter @stage-ai/server build
STAGE_IMAGE_ENABLED=false node --env-file=.env apps/server/dist/index.js &
node --env-file=.env apps/server/zz-workshop-live.mjs jk-live '["我想做一个 JK 后宫题材的剧目。","就按你说的来。另外先上网查一下 90 年代日本乡村高中的日常细节…"]'
```

> 注：两个 `zz-*.mjs` 是一次性验证脚本，验证完即删，不入库。
