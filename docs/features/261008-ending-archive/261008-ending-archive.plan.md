# `<ending>` 退化为纯归档标签：设计

> 日期：2026-10-08 · 仓库：`stage-ai` · 分支：`task/16`
> 范围：**仅 stage-ai 这一半**（`packages/core` 语法/IR + `packages/stage` 渲染）。
> dsh-aivn 侧的跟进（账本、提示词、舞台接线）是另一个任务，以前置依赖本任务。
> 上游：[`261007-dsl-endings`](../261007-dsl-endings/261007-dsl-endings.plan.md)（本次推翻了它的两处产品口径）。

---

## 1. 产品口径的对齐

`261007-dsl-endings` 把 `<ending/>` 设计成**自带画面**的结局卡：舞台画面区浮出「— 剧终 — / 标题 /
副标题 / 收束散文」，其中收束散文由引擎在结局之后**单开一轮**点名要 `<epilogue>…</epilogue>`。

本次重新对齐为：

| | 旧（261007） | 新（本次） |
|---|---|---|
| `<ending/>` | 终局 + **自带结局卡** | **纯归档标签**，不产生任何画面 |
| 终幕画面 | `EndingCard` 组件 | 剧作家自己用 `<scene>` / `<title>` / `<narrate>` 搭 |
| 收束散文 | `<epilogue>` 包裹标签 + 独立一轮 | `<ending>` 自己的 `summary` 属性 |
| `summary` 去向 | 上屏（填进结局卡） | **只用于归档**，不上屏 |
| 结局卡三字段 | `id` / `title` / `subtitle` | `id` / `name` / `subtitle` / `summary` |

**理由**：末行一写就是「这个故事到此为止」的账目。每部戏想要的终幕本来就不一样，把它固定成一张卡片
是把创作权从剧作家手里拿走；而「引擎单开一轮点名要收束散文」多引入一个失败模式（模型忽略指令），
换来的文本却只是归档用。引擎侧因此只剩三件事：**落账、拒绝继续、别让「点舞台继续」冒出来**。

---

## 2. 目标与非目标

**目标**

1. `EndingAttrs` 改名与增字段：`title` → `name`，新增 `summary?`，保留 `id`（必填）/ `subtitle?`。
2. 删掉 `<epilogue>` 标签、`EPILOGUE_TAG`、三个 `epilogue_*` IR 事件，以及全部相关解析/渲染/CSS。
3. 把标签定界从「首个 `>`」改成**引号感知**——`summary` 是数百字的自由散文，正文里一个 `>` 就会让
   标签头提前截断，失败形态是**整条结局被丢弃**（见 §4）。

**非目标**

- 不改 dsh-aivn（另开任务）。
- 不给 `<ending>` 加类型学字段（good/bad/true）——留给未来的画廊排序/配色增量加入。
- 不改 `<stop>` 的任何行为。
- 不引入属性值的转义语法。

---

## 3. 语法面

```
<ending id="true_sunrise" name="晨光" subtitle="这一次，她没有回头"
         summary="她把三年的沉默一次说完，然后走进了那片光里。"/>
```

| 字段 | 必填 | 语义 |
|---|---|---|
| `id` | ✔ | 结局身份：账本的键、多周目引用的名字。正则 `^[\p{L}\p{N}][\p{L}\p{N}._-]*$`（不变） |
| `name` | | 账本里给这条结局看的**人话名**；缺省回落 `id`。归档用，不上屏 |
| `subtitle` | | 补充短句（一句氛围 / 主题）。归档用，不上屏 |
| `summary` | | **归档摘要**：对整部剧、整条路线的归纳。归档用，不上屏 |

`VOID_TAGS` 与 `<ending>` 作为末行、取代该轮 `<stop>`、其后内容一律丢弃（`content_after_ending` 告警）
这些口径**全部不变**。

### 属性值里含双引号

没有转义语法。属性值用双引号声明时不能内含双引号；要写含 `"` 的正文请**改用单引号声明该属性**：

```
<ending id='e1' summary='他说"走吧"，就再没回头。'/>
```

中文散文用「」是常态，所以这不是阻塞项；写进 `spec.ts` 文件头只是让模型知道有出口。

---

## 4. 引号感知定界（本次的必要改动）

`consumeOpenTag` 原来用 `this.buffer.indexOf(">")` 定界，不感知引号（`spec.ts` 文件头把它列为已知限制）。
字数小的时候无感，把几百字的收束散文放进属性后就开始咬人——实测（探针）：

- 属性值含 `>` → 标签头在 `>` 处提前截断 → 属性解析失败 → **整条标签降级丢弃**（只有一条 warning）。
- 对 `<ending>` 而言这是**最糟的失败形态**：结局没了 → 终局态丢失 → 账本不记账 → 那一轮没有停止点，
  于是舞台摆出「继续」，**游戏静默地走过了结局**。

**修法**：从 `<tag` 之后找第一个**不在引号内**的 `>`（`findTagEnd`），不引入新的转义语法。

```ts
function findTagEnd(buffer: string): number {
  let quote: '"' | "'" | null = null;
  for (let i = 1; i < buffer.length; i++) {
    const ch = buffer[i]!;
    if (quote !== null) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i;
  }
  return -1;
}
```

**流式正确性**：引号未闭合时必须返回「等待更多数据」（`-1`）而不是提前消费——否则撕裂喂入会把半个
属性当场解析掉。这条有专门用例覆盖。

**探针结果**：`>` 号、中文引号「」、单引号、引号跨 chunk、同 buffer 内的兄弟标签，全部通过；
未闭合引号在消息边界照旧走 `malformed_tag`（丢弃 + 告警），不挂死。

> 顺带收益：`generate_image` 的生图 prompt 这类自由文本字段同样受益——旧限制的注释里点名了它。

---

## 5. 改动清单

| 层 | 文件 | 变更 |
|---|---|---|
| core | `src/dsl/spec.ts` | `EndingAttrs`：`title` → `name`、新增 `summary?`；删 `EPILOGUE_TAG`；`DSL_TAGS` 去 `"epilogue"` 而 `LEGACY_TAGS` 收它（见下）；`ENDING_TAG` 注释重写（不产生画面、终幕自搭）；文件头「`>`」限制换成引号定界与单引号出口的说明 |
| core | `src/dsl/events.ts` | 删 `epilogue_start` / `epilogue_text` / `epilogue_end`；`ending` 注释更新 |
| core | `src/dsl/parser.ts` | 删 epilogue 的包裹标签处理（`OpenWrap.tag`、`emitText`、`closeWrap` 分支）；`ending` case 读 `name`/`subtitle`/`summary`，并对旧字段 `title=` 挂改名告警；新增 `findTagEnd` 并接入 `run()`；新增 `legacyWrap` 状态吞掉作废包裹标签的正文（见下） |
| core | `test/parser.golden.test.ts` | 删「收束散文」整块；ending 用例扩展到四字段；新增「属性值里的 `<` 与 `>`」与「改名与旧标签降级」两组（见 §6） |
| stage | `src/EndingCard.tsx` | **删除** |
| stage | `src/index.ts` | 去掉 `EndingCard` / `EndingCardData` 导出 |
| stage | `src/stage.css` | 删 `.ending-overlay` / `.ending-card` / `.ending-mark` / `.ending-title` / `.ending-subtitle` / `.ending-summary` / `.ending-summary-pending` 全部规则 |
| stage | `src/script.ts` | 去掉三个 epilogue case；`ending` 注释改为「纯归档标签，不产生画面」 |
| web | `test/endingCard.test.tsx` | **删除**（AIVN 本体从没接过 `EndingCard`，全仓 grep 已确认无其他引用点） |

`playbackState.ts` 的 `ended` 闸与 `StageTheater` 的 `ended` 入参**保留**——那是「终局态不给出口」，
与新口径一致，且正是 §4 里那条失败链路的兜底。

---

## 6. 测试面

`parser.golden.test.ts` 新增两组。

「`<ending>` 属性值里的 `<` 与 `>`」：

| 用例 | 覆盖 |
|---|---|
| `summary` 含 `>` | 标签头不提前截断，整条结局照常产出 |
| `summary` 含 `<` 与「」 | 中文引号不参与定界 |
| 单引号声明的 `summary` 含 `"` | 双引号出口 |
| 数百字的 `summary` | 长自由文本原样保留 |
| 含 `>` 的属性值撕裂喂入 | 流式语义与整段等价（chunkSize 1/2/3/5/7） |
| 只喂到引号中段 | **保持等待**，不产出半个标签；补全后正常产出 |
| `<scene bg="school > gate">` | 既有标签同样受益，不截断 |
| `<scene>`+`<say>` 撕裂喂入 | 既有标签行为不变 |

「改名与旧标签降级」：

| 用例 | 覆盖 |
|---|---|
| `title=` 被忽略 + 告警 | 改名有回声，不静默丢字段 |
| 独立 `<epilogue>` | 丢弃 + `legacy_tag`，不按台词演出 |
| 嵌在 `<say>` 内的 `<epilogue>` | 正文不漏进外层台词 |

---

## 6.5 作废包裹标签的吞噬语义

`epilogue` 从 `DSL_TAGS` 移除后，如果只是「不在白名单」，它会走**未知标签**分支——那条分支的口径是
「按字面文本输出（不丢用户可见内容）」，于是：

- **独立出现**：正文落成 `orphan_text` 被丢弃，但告警说不明白（不是「这个标签没了」）；
- **写在包裹标签里**：正文会**漏进外层台词被念出来**。

这正是 `LEGACY_TAGS` 创立的动机（`option` 的注释里写着「硬判成未知标签会把 `<option>…</option>` 当
台词原样吐到舞台上，那比丢掉糟得多」）。所以 `epilogue` 进 `LEGACY_TAGS`；又因为它是**包裹型**的，
单元级的「整条丢弃」管不住它的正文，另加 `legacyWrap` 状态把正文吞到它自己的闭合标签（或本条消息结束），
与 `<comment>` 同一条口径；期间其它标签一律不开工，免得摆出空台词行。

---

## 7. 风险

| 风险 | 处置 |
|---|---|
| 引号感知定界改变既有标签的行为 | 探针覆盖 scene/say/生图 prompt/未知标签/注释；不引入转义，语义只放宽不收紧；另有两个既有标签回归用例（§6） |
| 存量剧本写 `title=` 会静默失效 | `parseAttrs` 收下未识别的属性但 `ending` case 只读 `name` → `title` 被忽略，因此**挂一条改名告警**走既有回喂通道。存量剧本仍须一并改（dsh-aivn 侧任务；本仓无样例剧目，`plays/` 不进 git） |
| 旧 `<epilogue>` 残留被演出来 | 进 `LEGACY_TAGS` + `legacyWrap` 吞正文（§6.5） |
| `summary` 太长拖慢解析 | 定界是一次线性扫描，无正则回溯；数百字无感 |
| 删 `EndingCard` 破坏下游 | dsh-aivn 从没接过它（全仓 grep 确认）；`stage.d.ts` 重建后导出面收窄是有意的信号 |
