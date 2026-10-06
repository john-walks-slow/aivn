# dsh-vn-plugin 阶段 1 总结

需求：把 AIVN 的核心演出引擎做成 DSH 插件。本文件记录阶段 1（演出闭环）的交付、检视与收口。
计划见 `261005-dsh-vn-plugin.plan.md`，检视见 `261005-dsh-vn-plugin.review.md`，
用户验证步骤见 `261005-dsh-vn-plugin.validation.md`。

## 交付

**代码在 `/root/projects/dsh-aivn`**（本仓库只放需求记录）。两次提交：

| 提交 | 内容 |
| --- | --- |
| `ce954b3` | 阶段 1 本体：`@aivn/stage` 抽取（在 `stage-ai` 侧分支 `feat/dsh-vn-stage`）、宿主半边（剧目数据层 / 提示词 / DSL 管线 / 工具 / 素材路由 / 起剧目两条入口）、客户端「舞台」tab |
| `0bcd136` | 检视收口：3 个阻塞项 + 12 个建议项 |
| `16bce79` | 用户实测报的两处：舞台接上补全后的样式、藏掉原生输入框铺满整栏 |
| `febcccce`（stage-ai `feat/dsh-vn-stage`） | `@aivn/stage` 补回抽包时漏搬的样式（含移动端小节） |

做出来的东西：在 DSH 里新建会话、选「剧作家」预设，会话工作目录就是一座剧目（`play.json`
是身份证），切到「舞台」页签就能看到剧作家用它写的 Stage DSL 实时演出一场视觉小说——
台词逐字上屏、立绘与背景按指令切换、轮末交出选项或自由输入，玩家点一条就落成自己的台词、
剧作家接着往下写。整块画面由抽出来的 `@aivn/stage` 渲染，插件侧只负责接数据与装工具。

## 检视：条件准入

检视范围 `ce954b3`，结论**条件准入**——方向与分层对、注释质量高，风险集中在宿主的错误处理
边界与客户端两条路径。三个阻塞项都是「能跑到、一跑到就出事」：

| ID | 问题 | 修法 |
| --- | --- | --- |
| B1 | 三条**纯读取**路径能杀掉整台 DSH：DSH 挂了进程级 `unhandledRejection → process.exit(1)`，而 `/aivn/*` 的 handler 是 `void handle(...)`。坏 `play.json`、坏 `manifest.json`、`/aivn/asset?path=assets`（EISDIR）都会让整台 DSH 连同所有会话退出 | handler 外层 `.catch` 统一转 500；`EISDIR` 回 400；两处 JSON 解析各自抛出带文件名的可读错误 |
| B2 | 一次断线把整部戏演两遍：`EventSource` 自带重连、中枢每次连接都整段补推历史，客户端既不去重也不重置，`ScriptBuilder` 把同一个 seq 的台词再建一遍 | 按 `seq` 去重；只在 **seq 断档**（滚出 4000 帧缓冲）时 `builder.reset()` + 递增 `resetToken` 整段重放；切会话也接进同一条重置路径 |
| B3 | 「继续」发的是**开局指令**：AIVN 的 continue 不注入文本，初版却把 `playConfig.opening`（「游戏开始」）当玩家输入再投一次；而 `no_stop` 的轮默认可点击继续，自然演完的每一轮点一下都发一句，还落成一行玩家台词 | 改投中性的「（继续）」并在宿主侧标 `silent`（仍是 user 消息，但不摆上玩家时间线），加 `continued` 连点闸 |

十二个建议项一并收口，其中三项是「顺手就能做对、不做会一直硌人」的：

- **S4** 追收束那句原来是按**正文全等**从玩家时间线上摘除的（改一个字就静默失效，玩家原样
  粘贴那句话又会删掉他自己那行）。新增 `src/injected.ts`：引擎自投的消息按 `message.id` 登记、
  在 inbox 插入时认领。S4 与 B3 共用这一份。
- **S1/S2** `manifest.json` 的键形与 `list_library` 的语义都按发动机口径写清了（键是**素材 id**：
  不带目录前缀、不带扩展名；立绘是 `<立绘目录>/<差分>`）。初版的文档与 e2e 夹具用的是
  引擎不认的第三种约定——不报错，只是永远匹配不上，`list_library` 白写。
- **S3** 剧目 id 缺省从目录名规范化派生。原来直接取 `basename(dir)`，`My Plays`、`.hidden`
  这类目录名过不了 `ID_PATTERN`，在**最常见的用法**上当场报错。

其余：`/aivn/input` 加同源与 `content-type` 校验（S5，`/aivn/*` 在 DSH 的信任栅栏之外）、
补上 e2e 里未定义的 `KNOWN_IDS`（S7，那条分支恰恰是「舞台没挂载」的失败路径，一进去就
`ReferenceError`）、`BODY_LIMIT` 改按字节（N9）、SSE 事件名统一成 `frame`（N1）、角色卡 YAML
名称转义（N5）、素材清单排序固定（N6）、`StageHub.dispose()`（N4）、删掉恒 false 的继续卡片
分支（N8）、剧作家预设按计划收掉 `bash`（N2）、`/new-play` 的开放范围写进 README（N3）。

## 验证

| 项 | 方式 | 结果 |
| --- | --- | --- |
| 全链路 | `dsh-e2e run e2e/run.mjs stage`（真 LLM 完整演一遍） | **14/14** |
| B1 三条杀进程路径 | `e2e/b1-probe.sh`（改坏文件 → 请求 → 立刻还原） | 500 / 500 / 400，**进程存活** |
| B3 的 silent 推进 | 真实投递 + 读中枢帧流 | 消息送达（会话日志有 id）、`beat` 起笔帧到达、**无** `player_input` 帧 |
| S5 / N9 两道闸 | curl | 403 / 415 |
| 类型与构建 | `npx tsc --noEmit` + `npm run build` | 干净 |

真机截图（`dsh-aivn/e2e-artifacts/`）：`stage-preset.png`（座位选剧作家）、`stage-stop.png`
（停止点面板）、`stage-echo.png`（选项原文落成玩家台词）、`stage-next-beat.png`（第二轮停止点）。

## 用户实测报的两处（2026-10-05 下午）

1. **舞台样式看着没应用**：不是没注入，是 `@aivn/stage` 抽包时**漏搬了一整段**——
   `.choice*`（选项卡片本身）、`.modal-*`、`.ref-picker-*`、`.dir-btn`、全局
   `button` / `input` 底样式，以及整个移动端 `@media (max-width:720px)` 小节。
   没有 `.choice`，选项就落成浏览器默认按钮的样子，也不绝对定位，位置自然不对。
   补法是不手抄：`scripts/port-stage-css.py` 按白名单从 app.css 精确抽取，元素级
   选择器加 `:where(.stage-root)`（特异性为零，不改与类规则的胜负关系）。
   顺手把 S6 那条移动端缺口一起收了。
2. **原生输入框该藏**：舞台页签下它是多余的（舞台自己有出口），还占着下面 128px。
   按 DSH 的稳定 `data-*` 钩子（`data-conversation-content` / `data-composer-seat`）在舞台页签下藏掉，
   舞台从 656 长到 784，手机竖屏铺到窗口底边；切回 Chat 页签自动恢复。

排障留下的工具：`e2e/css-diag.mjs` 往舞台根里插探针元素量计算样式——「样式到底有没有
生效」这种问题不用再靠肉眼猜。

## 遗留

1. **发布准备**：`@aivn/core` / `@aivn/stage` 由 `file:` 换版本号依赖（缺的是
   `@aivn/stage` 发布到 npm——包装在 main 上了，见下）、`before-publish-repo` 检查、
   去掉 `package.json` 的 `"private": true`。
3. **按会话回收缓冲**：插件卸载已收（`StageHub.dispose()`），会话被删/归档后的 `buffers` /
   `parsers` 回收留到接 `agent/disposed`。
3. **`@aivn/stage` 已合进 stage-ai main**（2026-10-06：抽包本身 `9cf654bb`，随后
   `feat/dsh-vn-stage` 上最后那笔 `9486a070`（导演栏两岔与出图格交给宿主）由
   `f1439282` 一并并入）。插件的 `file:` 依赖因此从 `.worktrees/dsh-vn-stage/packages/stage`
   改指 `stage-ai/packages/stage`，分叉消失。
4. **阶段 2**：搭台助手的素材生成工具（生图、抠底裁切、BGM、配音、跨剧目资源库导入）。

## 一句话回顾

阶段 1 把「DSH 里能演一场视觉小说」这条链打通了；检视挑出的三个阻塞项都不是风格问题，
而是「用户打开舞台页签就可能踩着」的边界问题——修完才提交，`ce954b3` → `0bcd136`。
