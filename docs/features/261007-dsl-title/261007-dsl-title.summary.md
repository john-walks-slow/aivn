# `title` 全屏文本卡 实施小结

日期：2026-10-07 ｜ 仓库：`stage-ai` ｜ 分支：`feature/dsl-title-nij`

## 需求

为 Stage DSL 增加全屏文本卡 `<title>`（章节标题 / 诗歌 / 独白）：进入隐藏对话框、离开恢复；
对齐五档（左上/右上/左下/右下/居中，默认居中）；多行两种出法（`block` 整段一次出 /
`lines` 逐句出，默认 `lines`）；可与黑场 / 白场（纯色场）配合。

设计与调研见同目录 `261007-dsl-title.research.md` / `261007-dsl-title.plan.md`，
检视见 `261007-dsl-title.review.md`，用户验证见 `261007-dsl-title.validation.md`。

## 做了什么

| 层 | 变更 |
|---|---|
| core | `title` 进 DSL 白名单；`TitleAlign`/`TitleMode` 与默认值；`title_start/text/end` 三段 IR；解析器 title 挂起态（空标题丢弃、非法属性降级+警告）；`resolveSceneBg()` 纯色场分流；`LineageEventKind += "title"`；`lineageToEvents` 同规格重放 |
| stage | `ScriptLine`/`TranscriptEntry` 接入 title；`director` 的逐句揭示状态机（`revealTarget`/`titleStep`/`dismissTitle`，turbo 展开、auto 不推进、reset/resume 整卡显示）；`StageTheater` 全屏卡 + 五档对齐 + 隐藏对话框 + 纯色底；`stage.css` 新增 `.theater-title` 与 `--title-ink/font/shadow` 令牌 |
| server | `OpenLine` 聚合 title、计为「有内容」；`lineageToBeats` 写回 `（标题）…`；**`prompt.ts` 提示词新增《全屏标题卡》章与纯色 bg 说明** |
| web | 路由卡的起始/摘要节点纳入 title；舞台浅色主题补 title 令牌 |
| 文档 | README 新增《全屏标题卡与纯色场》小节；`apps/server/AGENTS.md` 两条 |

关键设计取舍（用户确认）：

1. **缺省 `lines`**：单行在 lines 下退化为一单位，对标题零损失，诗歌不必显式声明。
2. **回放/重建整卡一次显示**：逐句只是实时呈现动画，不是未决状态，重建不要求玩家重新点。
3. **纯色场扩展 `<scene bg>` 取值**（保留色名 + 十六进制），不新造机制。
4. **点击优先级 `title > 继续出口`**：标题卡若是这一拍最后一条内容，离开点击不会被「继续」吞掉。
5. 标题卡**不可原地改写**（`EDITABLE_KINDS` 不含它）。

## 验证

- `pnpm -r build` + `pnpm -r typecheck` 全绿。
- 单测：core 207 / stage 44 / server 除 `voice.test.ts` 外全绿（`voice.test.ts` 4 条为**既有失败**，
  已在主干复现，与本次无关）。新增：`core/test/title.test.ts`、`stage/playbackState.test.ts`，
  以及 parser/lineage/transcript/lineage-ops 的 title 用例。
- 用户实机验证：**通过**（用户书面确认可用于 ship）。
- 检视：`reviewer` 子代理模型受地区限制不可用，按约定以自查代替（见 review 文档）。

## 遗留

- **消费者插件 `dsh-aivn`（另一仓库，不在本工作树）**：`src/playwriter/prompt.ts` 的《标题卡》章与
  `src/style-tokens.ts` 的「标题卡」令牌组（默认值与 `stage.css` 对表）、e2e 夹具
  （`verify-rebuild.ts` / `verify-style.mjs`）待补。未补之前，插件侧模型不会主动写 `<title>`。
- **生图故障（与本功能无关）**：flow2api 网关返回
  `500 生成失败: Flow frontend RPC rejected: rpc=ogiZ0b, code=[5]`（上游 Flow 会话被拒，疑似需重新登录），
  `image.model` 配置本身正确（裸名 `gemini-3.1-flash-image`）。
