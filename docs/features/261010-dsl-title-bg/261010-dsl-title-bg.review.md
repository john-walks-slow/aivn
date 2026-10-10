# 检视报告

## 概要

本次改动检视范围涵盖舞台 DSL `<title>` 标题卡新增 `bg`（底色）与 `ink`（字色）属性的完整实现链条，包括 `packages/core`（颜色词表与亮度计算、标题样式解析、IR 事件、流式解析与谱系重放）、`packages/stage`（剧本渲染行模型、会话历史 transcript、舞台渲染与样式覆盖）、`apps/server`（编排层 attrs 留存、提示词、AGENTS.md）及根目录 `README.md` 与相关测试。

整体评价：设计简洁克制、模块边界划分严谨。通过在 `color.ts` 抽象最小化纯色词表与 WCAG 相对亮度算法，让解析与谱系层保持「只认字面量不感知色彩」的正交性；在渲染层集中计算对比色与投影规则，很好地达成了「让模型无需理解客户端皮肤令牌即可预判输出观感」的目标。实现质量很高，未发现阻断性缺陷。

## 需求对齐

- **需求达成度**：完全满足计划要求。
  - `<title>` 缺省为黑底白字（`bg="black"`，`ink` 缺省由对比度算法得出 `#ffffff`）；
  - `bg="none"` 支持显式透明，字色回落舞台皮肤 `--title-ink`，保留 `--title-shadow` 投影；
  - 实底情况下移除文字投影（`textShadow: "none"`），避免实底文字发光模糊；
  - 非法值挂 `malformed_tag` 警告并平滑回退，保持鲁棒性；
  - 流式解析、谱系记录、会话回看与历史重放全链路均正确承接与透传属性。
- **与计划差异**：
  - `packages/core/src/dsl/spec.ts` 契约文档与注释已完整同步，但 plan 中第 46 行提到的「title 章补 `TITLE_BG_*` 常量」实际直接放置并导出于 `packages/core/src/dsl/titleStyle.ts`，并通过 `packages/core/src/index.ts` 统一重导出，属于合理的职责归位，不构成偏离。

## 阻塞问题

无

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| -   | -    | 无   | -    |

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S-01 | [packages/stage/src/transcript.test.ts:183-189](packages/stage/src/transcript.test.ts#L183-L189) | 用例描述称「缓冲里的标题卡也进记录（对齐与底色取缺省，字色不落值）」，但实际断言是 `expect(entries[0]).not.toHaveProperty("bg")`。原因是 `fromLine(line)` 仅在 `line.bg` 有值时挂载，而该用例传入的 mock `line` 未给 `bg`。用例描述与断言逻辑存在字面出入，容易使读者误解为缓冲行会产生缺省的 `bg="black"`。 | 建议调整用例标题或在 mock 数据中补充带 `bg: "black"` 的断言分支，使测试标题与断言表达的一致性更明确（例如注明「缓冲行未带 bg 时 transcript 不冗余注入」）。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | [packages/core/src/dsl/color.ts:35-47](packages/core/src/dsl/color.ts#L35-L47) | `contrastInk(color)` 假定入参必为合法 `#rgb` 或 `#rrggbb`。虽然调用方 `resolveTitleStyle` 已经过 `parseColorValue` 保证，但若未来内部其他模块直接调用该工具函数且传入非法字符串，`relativeLuminance` 会计算出 `NaN`，`> 0.35` 比较失败后静默落回 `#ffffff`。 | 保持现状即可；若后续对外开放或复用增多，可考虑在函数头显式判断 `COLOR_HEX_RE.test` 作为防御。 |
| N-02 | [packages/stage/src/StageTheater.tsx:196-200](packages/stage/src/StageTheater.tsx#L196-L200) | `titleCardStyle` 构造返回样式对象时，直接将内联属性解构注入。在 `card.background === null` 且未提供 `card.ink` 时返回 `{}`，由 `.theater-title` 现有的 CSS 类承接皮肤变量，逻辑很轻量；但如果有动态换肤需求，`--title-ink` 的优先级会被内联 `color` 强覆盖。这完全符合本功能的显式声明优先预期，在此记录备忘。 | 无需修改，当前设计符合预期。 |

## 准入结论

**结论**：`准入`

**说明**：核心功能完备、边界完备、多层分流与回退逻辑清晰，且测试与跨层契约（DSL / Parser / Lineage / Stage / Server Orchestrator / Prompt / README）均保持高度一致，无任何阻塞问题，可以直接合入与交付。
