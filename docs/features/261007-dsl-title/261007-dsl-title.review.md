# `title` 标签实施检视报告

日期：2026-10-07 ｜ 仓库：`stage-ai` ｜ 变更范围：`packages/core`、`packages/stage`、`apps/server`、`apps/web`、文档

> **检视方式说明**：按 `/workflow-implement-review` 应使用 `reviewer` 子代理。本次 `reviewer`
> 子代理连续两次以 `User location is not supported for the API use.` 失败（其模型受地区限制），
> 最小探针（`general` 子代理「只回复 ok」）正常，判定为 reviewer 档位不可用而非通道整体故障。
> 依约定**以自查代替**，逐文件复核了全部改动（含 diff 对新旧行为的一致性）。

## 检视范围

`git diff` 覆盖 20 个已跟踪文件 + 4 个新增文件（`packages/core/src/dsl/sceneBg.ts`、
`packages/core/test/title.test.ts`、`packages/stage/src/playbackState.test.ts`、
`docs/features/261007-dsl-title/`）。设计依据见同目录 `*.research.md` / `*.plan.md`。

## 结论

**准入（条件准入）**：无阻塞问题；自查发现并已修复 3 个问题（1 个交互正确性、2 个 UX/一致性）。
静态验证与受影响测试全绿。

## 自查发现与处置

### 已修复

1. **交互正确性（中）——标题卡若是这一拍最后一条内容，"继续"出口会吞掉它的离开点击。**
   `onStageClick` 原顺序是 `scrubbed → canContinue → advance`。当 title 是最后一条 cue 且本轮以
   `no_stop` 收束时，`panelReady/canContinue` 为真，点击会走 `onContinue()` 直接开下一轮——对话框
   未恢复、标题卡也没被点掉。
   修复：`packages/stage/src/StageTheater.tsx` 的点击优先级改为 `scrubbed → isTitle → canContinue →
   advance`（`isTitle` 时点击只归标题卡）；并把停止点/继续浮层在 title 期间整层不渲染
   （`!hideUi && !isTitle && overlay`）——title 与 stop 本不同时在场（stop 写在 `</title>` 之后）。

2. **UX（中）——正文带尾随换行时"读完"提示永不出现。**
   `titleReady` 原用 `shown === view.text`。解析器让 `lines` 模式的最后一个揭示断点落在末行正文末尾、
   不含尾随换行（模型常把 `</title>` 另起一行），字面比对永远差一个 `\n`，`▼` 提示不出现。
   修复：改用 `shown.length >= titleStepEnds(view.text).at(-1)`，并以 `current.closed` 收口（流式
   未写完不提示）。

3. **一致性（低）——`@aivn/stage` 自带的浅色主题块缺 title 令牌。**
   `apps/web/src/app.css` 与 `packages/stage/src/stage.css` 各有一份 `data-stage-theme="light"`
   覆盖（前者给 AIVN 应用、后者随包给宿主如 dsh-aivn）。只加了前者，后者漏了 `--title-ink` /
   `--title-shadow`。已补齐 stage.css 的浅色块，两处一致。

### 复核通过、无需改动

- **解析器挂起态**：`title_start` 延后到首段非空白正文再发，避免空 `<title>` 制造一个要点掉的空屏；
  `pending` 缓冲在 `closeWrap` 时按 `started` 判定丢弃/收尾；`endMessage` 自动闭合保留已流出正文。
  撕裂喂入与整段喂入等价（测试覆盖，`mergeDeltas` 同步纳入 `title_text`）。
- **director 状态机**：`revealTarget = titleRevealTarget(current, titleStep)` 统一承载打字机目标、
  `lineComplete`/`exhausted`、`shouldAutoStart.currentComplete`；`advance()` 的 title 分支正确处理
  「打字中→瞬显 / 未闭合→不响应 / 逐句→下一条 / 末句→dismiss 后立即接上后续 cue」；`turbo` 展开全部；
  `auto` 模式显式不推进 title（否则逐句卡会被自动消费跳过剩余行）；reset/seek/resume 路径对 title
  整卡显示（符合"重放不重演逐句点击"）。
- **谱系/重建**：`kind:"title"` 落谱系、`lineageToEvents` 同规格三段重放（空正文 2-seq），
  `lineageToBeats` 写回 `（标题）…` 并使 title 计为「有内容」（仅标题+停止点的一拍不被判废）；
  `fromView`/`fromLine` 可回顾、`editableNodeId` 排除 title、服务端 `EDITABLE_KINDS` 亦不含 title。
- **纯色 bg**：`resolveSceneBg` 分类正确（保留色名大小写不敏感、`#rgb`/`#rrggbb`、非法值退回素材 id、
  空值 null）；`StageTheater` 分流后色值画纯色底、`bgPending` 对色值不误报；谱系原样存 `bg`。
- **路由卡**：`beats.ts` 把 title 纳入 `startNodeId`/预览的首选内容节点（标题卡单独成拍也有摘要）。
- **类型不遗漏**：全仓 `tsc` 通过；`orchestrator.recentCast`、`feedVoice` 等只认说话人的地方**刻意**
  不含 title（title 无说话人、不配音），复核无副作用。

## 遗留（非本次仓库范围，需在消费者仓 `dsh-aivn` 跟进）

- 本仓库 `apps/server/src/prompt.ts` 的 `FORMAT_RULES` 已补《全屏标题卡（title）》章与纯色 bg 说明
  （独立 AIVN 应用的剧作家提示词）。**消费者插件 `dsh-aivn` 的对应两处尚未改**——它的
  `src/playwriter/prompt.ts`（`FORMAT_RULES`）与 `src/style-tokens.ts`（「标题卡」令牌组，默认值与
  `stage.css` 对表）属另一个仓库，不在本工作树边界内；设计文档 `*.plan.md` §9.4 已逐文件写清。
  未改那两处前，**DSH 插件**侧的模型不会主动写 `<title>`、其皮肤也不认识 title 令牌；本仓库引擎与
  应用内提示词均已就绪，写入剧本即生效。e2e 夹具（`verify-rebuild.ts` / `verify-style.mjs`）
  同属该仓，一并在那边补。
