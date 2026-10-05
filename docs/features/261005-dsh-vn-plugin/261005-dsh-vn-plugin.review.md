# 检视报告

## 概要

检视范围为 `/root/projects/dsh-aivn` 的 `ce954b3`（阶段 1：舞台视图、剧作家预设与停止点全链路），跳过构建产物 `lib/`，逐文件读了 `src/`、`build.mjs`、`cordis.patch.yml`、`e2e/`、`README.md`、`AGENTS.md`，并对照计划 `261005-dsh-vn-plugin.plan.md`、实施规格 `docs/features/261005-dsh-vn-plugin/preset-and-prompt.spec.md`、上游 AIVN（`apps/server`、`packages/core`、`.worktrees/dsh-vn-stage/packages/stage`）与 DSH 本体（`0.1.7-rc.2` 类型契约）核对。

整体：**架构方向正确、分层干净、注释质量高**（`sessionPreset` 的权威判据、`preset-tools` 的装卸、`beat-guard` 的动机都写清了「为什么」）。真正的风险集中在**宿主的错误处理边界**与**客户端重连/继续两条路径**：三个阻塞项都是「能跑到、但一跑到就出事」的类型，不是风格问题。

## 需求对齐

计划阶段 1 的验收面（宿主：剧目数据层 / 提示词 / DSL 管线 / 工具 / 静态资源 / `/new-play`；客户端：`@aivn/stage` 接线 + 停止点 + 逐字 + 重连）**已覆盖**，`e2e/verify-stage.mjs` 的 14 条断言与计划的验收描述对得上。与计划/规格的差异逐条核对如下：

| 项 | 结论 |
|---|---|
| `read_skill` 未做、搭台助手只装 `create_play` + 文件工具、`RefCharacterPicker` 随包搬入 | 与计划「阶段 1 与计划的偏差」表一致，README 也如实写了，认可 |
| 剧作家预设含 `dsh-tool-bash` | **两份文档互相矛盾**：计划 §3.7 写「不装 bash」，实施规格第 33 行要求「`@deepseek-ai/dsh-tool-bash`（非 win32）」。实现跟的是规格。见 N2 |
| `list_library` 语义 | 代码按规格改成「列剧目内素材」，但 README 仍按 AIVN 口径描述（见 S2）——文档没跟上这次语义变更 |
| `assets/manifest.json` 键约定 | README 与 e2e 夹具都用了引擎不认的键形（见 S1），属新增文档的准确性缺陷 |
| 已知限制（重启后中枢缓冲为空、`buildAssetIndex` 不读角色卡 `sprite:`、`@aivn/stage` 走 `file:`） | 三项都在计划里显式登记，不是新缺陷；S1/N7 只是提醒发布前收口 |

另需注意：本仓库当前工作区里躺着 `play.json` / `assets/` / `characters/` / `memory/`（开发态把仓库根当剧目，已在 `.gitignore` 中排除），不是提交内容，无需处理。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| B1 | `src/routes.ts:28`（配合 `src/play.ts:34`、`src/routes.ts:100`、`src/assets.ts:58`） | `handler: (req, res) => void handle(...)` 把 async handler 的 rejection 完全丢掉，而 DSH 启动时注册了进程级 `unhandledRejection` → 直接 `process.exit(1)`（证据：`@deepseek-ai/dsh-app-boot` 的 `installFailLoud`，运行入口 `dsh/lib/profile-boot-BZ2ZjNWi.js:255` 把它挂在当前进程且不卸载）。于是三条纯读取路径都能把整个 DSH 杀掉：① 工作区里的 `play.json` 被手改坏/写一半 → `JSON.parse` 抛 `SyntaxError`（`play.ts:34`）；② `assets/manifest.json` 坏 → 同样抛（`assets.ts:58`）；③ `/aivn/asset?path=assets`（目录）→ `readFile` 抛 `EISDIR`（`routes.ts:100`）。这三处都发生在用户**打开舞台 tab 的首次请求**上，代价是整台 DSH 掉线，不是「舞台显示不出来」 | `handle` 外层包一层 `try/catch`：按错误类型回 500/400 JSON 并 `ctx.logger.error` 记录，绝不让它冒泡成未处理 rejection；同时把「坏 `play.json`」明确算作可预期输入（`loadPlay` 里 catch `SyntaxError` 后抛出带文件名的可读错误，或由 handler 统一转 500）。`sendAsset` 单独拦 `EISDIR`/`EACCES` 回 400/403 |
| B2 | `src/client/stage-view.tsx:133-171`（配合 `src/hub.ts:80`、`:86`） | `EventSource` 自带重连，而 `hub.subscribe` 每次连接都**整段补推历史**；客户端既没有按 `seq` 去重，也没有在重连时重置 `ScriptBuilder`。`ScriptBuilder.apply` 对 `say_text` 只在 `line.key === openKey` 时续写（`packages/stage/src/script.ts:163-168`），重放会新建同序的整串行 → **一次断线（DSH 重启、网络抖动）就把整部戏在舞台上复制一遍**，播放头也回到开头。`@aivn/stage` 本来为此留了 `resetToken`（`stage/director.ts:504`「变化即整段重放，播放层必须强制归零」），AIVN 侧由 WS 的 rebase token 驱动（`apps/web/src/views/StageScreen.tsx:369`），插件侧完全没接 | 客户端记住已应用的最大 `seq`：`seq <= lastSeq` 的帧一律丢弃；一旦发现「补推从更小的 seq 开始」（含页内重连），就 `builder.reset()` 并同步重置播放层——即把 `resetToken` 接上（`usePlayback({..., resetToken})`），或退一步：在 `source.onerror`/重连时重建 `ScriptBuilder` 实例。顺带把 `sessionId` 变化也纳入同一条重置路径（现在 `builder` 是 `useState` 一次性创建，切会话若组件实例被复用会带着上一部戏的脚本） |
| B3 | `src/client/stage-view.tsx:269`、`:288` | 「继续」被实现成 `send(playConfig.opening)`，即把**开局指令**（`（游戏开始，请演出第一轮）`）当玩家输入再投一次。AIVN 的 continue 走 WS `{type:"continue"}`，服务端**不注入任何文本**（`apps/server/src/orchestrator.ts:893-910`、`:940-942`），本轮播放器只是继续生成。直接后果有两层：① 剧作家收到的是「游戏开始」，与提示词《演出契约》第 5 条「只发来『（继续）』这类没有内容的推进指令」直接冲突，容易重演/困惑；② `stage-tap` 会把这条经 inbox 落成 `player_input`，舞台上凭空出现一行玩家台词。触发面不小：`stopAffordance` 在 **no_stop 的轮**默认给 `clickToContinue`（`packages/stage/src/playbackState.ts:120-129`），也就是「自然演完」的每一轮，点舞台就会发这句。另外这里没有 AIVN 那样的连点闸（`StageScreen.tsx:406-411` 用 `continued` ref 挡第二次点击），连点两下会排两条输入 | 给「继续」一条中性推进指令（例如 `（继续）`，与提示词第 5 条对齐），或在宿主侧把「继续」做成不落 `player_input` 的内部动作（例如 `/aivn/input` 增一个 `kind: "continue"`，由 tap 决定是否落时间线）；无论走哪条，「开演」才用 `playConfig.opening`。同时按 AIVN 的做法对同一次挂起加一次性闸，避免连点重复投递 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| S1 | `README.md:110-120`、`e2e/lib/fixture.mjs:52-59` | `assets/manifest.json` 的键写法是**引擎不认的第三种约定**。引擎口径（`packages/core/src/play/assets.ts:237-254` 的 `spriteDeclarationOf`）是：立绘级 = `"<spriteId>"`，差分级 = `"<spriteId>/<variant>"`，单文件类目 = `"<entry.id>"`，**不带 `sprites/`、`backgrounds/` 前缀与扩展名**；AIVN 写盘也照这个（`apps/server/src/assetImport.ts:193` 的 `manifest.push([spriteId, base])`）。README 的 `"sprites/lin/normal.png"` 与本插件自己的 e2e 夹具都落在这条约定外，`list_library` 永远查不到描述——而这正是它存在的理由 | README 的示例改成 `{"veranda": {...}, "lin": {...}, "lin/normal": {...}}` 并补一句键规则；e2e 夹具同步改键，让「描述能被 `list_library` 列出来」成为一条真实断言 |
| S2 | `README.md:167` | `list_library` 一栏写「列本机素材资源库（`~/…/library/`）里的条目」，与实现（列剧目自己的 `assets/` + manifest）不符；`src/playwriter/tools/list-library.ts:1-10` 已经把这次语义变更写明，文档没跟 | 按实现改 README 那一行；顺带考虑工具名的误导性（对模型无害——description 是对的——但对读文档的人是误导），若阶段 2 真的要接跨剧目库，先想清楚是「改回资源库语义」还是「改名 `list_assets`」 |
| S3 | `src/scaffold.ts:56`（配合 `:19` 的 `ID_PATTERN`） | id 缺省时直接取 `basename(dir)`，而工作区目录名常见「带空格 / 以点开头 / 中文夹空格」（如 `My Plays`、`.hidden`）。这些名字过不了 `ID_PATTERN`，`create_play` 与 `/new-play 不写名字` 会在最常见的用法上抛「剧目 id 不合法：My Plays」，而用户根本没输过 id | id 缺省时做规范化（去空格/取合法字符、必要时补随机短后缀），实在无法派生再报错；或缺省不派生、统一生成 id（标题另存 `title`）。错误文案里也要说明「id 是从目录名推的」 |
| S4 | `src/beat-guard.ts:39-41`、`:90` | 「追收束那一句」靠**正文全等**认（`text.trim() === NUDGE`）。现状能跑，但判据挂在文案上：改一个字就静默失效；用户若恰好原样粘贴这段话，他自己那一行会被从时间线里删掉（模型仍看得到，画面丢行）；将来多一个内部注入点也会被误吞。`createUserMessage` 已经给了每条消息一个稳定 `id`（`dsh-llm/lib/types/message.js:53`），比文案可靠 | 在 `installBeatGuard` 里把构造出的 nudge 消息对象/其 `id` 交给 `stage-tap`（或抽一个共享的「本会话待摘除的消息 id」小状态），`onInput` 按 `payload.message.id` 判断而不是按正文；正文全等降级为兜底 |
| S5 | `src/routes.ts:24-29` | `/aivn/*` 是插件自己注册的 prefix 路由，落在 DSH 的浏览器信任栅栏之外——`isTrustedApiRequest`（`dsh-client-connection/lib/index.js`，注释明确「Network reachability and authentication stay out of scope」）只管 `/api`。后果：`POST /aivn/input` 不校验 Host/Origin 也不校验 `content-type`，恶意页面用 `fetch(..., {mode:'no-cors', content-type: text/plain})` 就能盲投一条「玩家输入」进任意已知 session；`/aivn/asset` 也只挡了路径越界。DSH 若绑 `0.0.0.0`，暴露面更大 | 至少做与 `/api` 同源同款的 Host/Origin 判定（loopback 或 `trustedHosts` 才放行），并校验 `content-type: application/json`；如果判断「本地单人工具、不值得」，请在 README 的 HTTP 面一节显式写明这条路由不做鉴权（并建议保持 loopback 绑定），别让它成为未记录的假设 |
| S6 | `src/client/stage-view.tsx:245`（配合 `@aivn/stage` 的 `stage.css`） | `stage.css` 头部自述「导演栏、**移动端**等小节仍留在宿主 app.css 里，不在这次搬家的范围内」，实测确认 `max-width: 720px` 那一段（安全区 `env(safe-area-inset-*)`、台词条内边距/字号、`.choice` 最小高度）与 `.theater-bar/.theater-dialog` 的安全区补边都还在 `apps/web/src/app.css:3805-3880`，没有随包搬进插件。用户日常用手机看 DSH GUI，这条缺口最可能在这台设备上暴露 | 上线前用真机（红米 K30S / 竖屏）在 DSH 里过一遍舞台：台词条是否被系统手势条压住、选肢卡是否够大好点、竖屏立绘是否正常。缺哪段就把那一段按 `.stage-root` 作用域补进 `@aivn/stage`（注意别把 AIVN 整页规则带过来）。本次检视未做实机验证，只能从 CSS 归属判定风险 |
| S7 | `e2e/verify-stage.mjs:131` | `skip(KNOWN_IDS.slice(5), …)` 里的 `KNOWN_IDS` 全仓库未定义。这条分支恰恰是「舞台没挂载」的失败路径——一进就 `ReferenceError`，套件崩掉、14 条断言与截图汇总全都不输出，把「失败」变成「看不出为什么失败」。唯一的验证资产在关键时刻失效 | 改成显式 id 列表 `['S6','S7','S8','S9','S10','S11','S12','S13']`（或改成 `results` 里已登记的 id 过滤），并顺手在本地跑一次「故意让舞台挂不上」确认该分支能正常出报告 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| N1 | `src/hub.ts:96` | SSE 帧一律写成 `event: ir`，`beat` 帧也叫 `ir`。当前客户端只监听 `ir`，能跑；名字与 README 的「帧分 ir / beat 两种」自相矛盾，以后加事件类型容易踩 | 帧类型就用事件名分开（`event: ir` / `event: beat`），或统一叫 `event: frame`，二者取一并与 README 对齐 |
| N2 | `src/playwriter/preset.ts:42` | 剧作家预设装了 `dsh-tool-bash`，与计划 §3.7「不装 bash」相反（规格第 33 行要求装）。计划里「写面按能力位收」的意图因此没有落地：模型能拿到 shell，而提示词只教了文件工具 | 明确取舍并同步文档：要么按计划收掉 bash（并考虑 Windows 上 `tool-pwsh` 的对称处置），要么在计划/README 里把「为什么留着 bash」写清 |
| N3 | `src/commands.ts:19` | `/new-play` 对所有会话开放（工具是按预设装的，命令不是）。在 standard 预设会话里敲它也会往工作区写 `play.json` | 若这是有意的（人侧入口不该被预设拦住），在 README 里说明；若不想，按 `sessionPreset` 过滤 |
| N4 | `src/stage-tap.ts:47`；`src/hub.ts:35`、`:86`；`src/routes.ts:79-83` | 资源只有生命周期、没有回收：`parsers`/`buffers`/`seqs` 按会话无限增长（会话被删/归档后仍在）；插件卸载时 `webServer` 路由被移除，但已建立的 SSE 连接与其 15s keepalive 定时器不会随插件停 | 在 `agent/disposed` 上清该会话的 parser 与缓冲；`StageHub` 增加 `dispose()` 统一关掉所有 client（clearInterval + end），由 `index.ts` 的卸载器调用 |
| N5 | `src/scaffold.ts:113` | 角色卡 frontmatter 用字符串拼 `name:`，模型给的显示名若含 `:`、`#`、换行会写出坏 YAML，而这张卡是要被 `parseCharacterCard` 读回来的 | 对 `name` 做最小转义（含特殊字符时加引号）或复用一个正经的 frontmatter 序列化 |
| N6 | `src/assets.ts:49` | 非立绘类目的文件名直接取 `readdir` 顺序（立绘特意排了序，理由写在注释里）。`list_library` 的输出顺序因此在多次调用间漂移 | 一行 `.sort()` 统一口径 |
| N7 | `package.json:37-38`、`README.md:28` | `@aivn/core` / `@aivn/stage` 是 `file:` 指向 AIVN worktree。构建期虽已 inline 进 `lib/`，但 `dependencies` 会让**安装方**解析这两个 `file:` 路径而失败——`npm i dsh-aivn` 装不上，不只是「版本不干净」 | 发布前换成真实版本依赖（计划已登记）；若最终确认运行时零依赖，把这两项挪到 `devDependencies` 更诚实 |
| N8 | `src/client/stage-view.tsx:81-83` | `readFlag(window.localStorage, SETTING_CONTINUE_CARD, …)` 读的是 AIVN app 的设置键；DSH 侧没有任何 UI 写它，恒为 `false`——「（继续）」卡片这条路在插件里永远不可达 | 要么给一个 DSH 侧设置落点，要么删掉这段与相关分支，别留一条不可达路径 |
| N9 | `src/routes.ts:123`、`:131-138` | `BODY_LIMIT` 按字符数而非字节算；`acceptInput` 不校验 `content-type`（见 S5） | 改 `Buffer.byteLength`；与 S5 一并处理 |

## 准入结论

**结论**：`条件准入`

**说明**：方向与分层是对的，阶段 1 的验收面也确实立住了；但三个阻塞项都在「用户真会走到的路径」上——B1 能让整台 DSH 因一份手改坏的 `play.json` 直接退出，B2 会在一次断线后把整部戏复制一遍，B3 让默认的「点舞台继续」每次都给剧作家发一句「游戏开始」。三条都不大（合计约一处 try/catch、一处 seq 去重、一处『继续』文案/门闩），修完即可准入；建议项里的 S1/S2（README 键形与 `list_library` 描述）发布前必须收口，S6（移动端样式）需真机确认。

---

## 修复复核（2026-10-05，`dsh-aivn` 提交 `0bcd136`）

三条阻塞项全部按建议修掉，建议项 12 条收口 11 条（S6 按检视自己的措辞「需真机确认」登记为待办），
非阻塞项收口 8 条。逐条对应：

| ID | 处置 | 落在哪里 |
| --- | --- | --- |
| B1 | 已修 | `src/routes.ts` 的 handler 外层 `.catch` + `fail()`；`sendAsset` 拦 `EISDIR`；`loadPlay`/`readManifest` 各自抛出带文件名的可读错误 |
| B2 | 已修（比建议更进一步） | `src/client/stage-view.tsx`：按 `seq` 去重，**只在 seq 断档时**才 `builder.reset()` + `resetToken` 整段重放——建议里的「重连即重置」会在每次网络抖动后把整部戏倒回开头。切会话也接进同一条路径 |
| B3 | 已修 | 继续改投 `（继续）`；`src/routes.ts` 的 `acceptInput` 支持 `silent`，与 `beat-guard` 共用 `src/injected.ts` 按 `message.id` 摘除；`continued` 连点闸 |
| S1 | 已修 | `README.md` 的键规则表 + `e2e/lib/fixture.mjs` 夹具改键（`veranda`、`lin/normal`） |
| S2 | 已修 | `README.md` 的 `list_library` 一栏按实现改写 |
| S3 | 已修 | `src/scaffold.ts` 新增 `idFromDir()`；错误文案说明「id 是从目录名推的」 |
| S4 | 已修（按建议的核心方案） | 新增 `src/injected.ts`；`beat-guard` 投前登记、`stage-tap` 按 `payload.message.id` 认领。正文全等**不再**做兜底——id 已足够且更可靠，留着反而多一条会静默漂移的判据 |
| S5 | 已修（取建议的前者） | `sameOrigin()` + `content-type` 校验；README 的 HTTP 面一节写明 `/aivn/*` 在信任栅栏之外、插件自己挡 |
| S6 | 待办（登记） | `261005-dsh-vn-plugin.validation.md` 验证项 5 + 待跟进；需真机竖屏确认 |
| S7 | 已修 | `KNOWN_IDS` 显式定义，两处 `skip()` 改成按它切片 |
| N1 | 已修 | 统一 `event: frame`（`src/hub.ts` + 客户端 + README） |
| N2 | 已修（按计划） | 剧作家不再装 `bash`；搭台助手留一行 `disabled: true`（DSH 注册器跳过 `disabled` 行，只在清单里可见） |
| N3 | 已修（文档） | README 斜杠命令一节写明「对所有会话可见，只新建不覆盖」 |
| N4 | 部分 | `StageHub.dispose()` 已加并由 `index.ts` 卸载器调用；按会话回收 `buffers`/`parsers` 留待接 `agent/disposed` |
| N5 | 已修 | `src/scaffold.ts` 的 `yamlScalar()` |
| N6 | 已修 | `src/assets.ts` 非立绘类目同样排序 |
| N7 | 待办 | 发布前换版本号依赖，被 `@aivn/stage` 未合并/未发布阻塞 |
| N8 | 已修（取建议的后者） | 删掉 `readFlag`/`SETTING_CONTINUE_CARD` 与那段不可达分支 |
| N9 | 已修 | `BODY_LIMIT` 改按字节累积；`content-type` 随 S5 一并处理 |

复核证据：`e2e/verify-stage.mjs` 14/14 通过；新增 `e2e/b1-probe.sh` 回归 B1 的三条路径
（500/500/400，进程存活）与 S5/N9 的两道闸（403/415）；B3 用真实投递 + 读中枢帧流复核
（消息送达、`beat` 起笔、无 `player_input` 帧）；`tsc --noEmit` 与 `npm run build` 干净。
