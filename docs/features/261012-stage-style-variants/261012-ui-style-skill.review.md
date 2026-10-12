# 检视报告

## 概要

检视了 [galgame-ui-style/SKILL.md](../../../apps/server/skills/galgame-ui-style/SKILL.md) 及其引用的主题生成器、主题加载、令牌定义、可写面、标题画面结构和生产舞台 CSS。配色与窄屏/对比度提醒覆盖较完整，但当前技能把剧目可写的 `theme.css`、引擎生产 CSS、以及尚未接通的开始菜单风格开关混在了一起，按现文执行会引导工坊 agent 写不可写或不会生效的内容。

## 需求对齐

三项用户要求在意图层面都有提到：消息框与开始菜单配对、ATRI 作为默认档、材质色必须呼应主题色。`--play-accent*`、深浅配色、对比度和窄屏注意事项也与现有实现大体一致。

但与当前实现存在关键偏差：消息框五档确实在 [stage.css:3178](../../../packages/stage/src/stage.css:3178) 已接通，开始菜单仍只有 ATRI 结构，代码中没有 `data-menu-style`、`menuStyle` 或 `dialogStyle` 的接线；同时 `theme.css` 的“只写 `:root`”规则与实际必须使用的深色选择器相互矛盾。技能没有明确哪些内容只是引擎实现参考、哪些内容是工坊可实际落盘的剧目文件，因此不足以稳定产出用户要求的可选配对皮肤。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B1 | [SKILL.md:11](../../../apps/server/skills/galgame-ui-style/SKILL.md:11)、[SKILL.md:34-39](../../../apps/server/skills/galgame-ui-style/SKILL.md:34) | `theme.css` 被硬性描述为“只在 `:root` 覆盖令牌”，示例却又要求用 `html[data-ui-theme="dark"]` 写深色 `--play-accent-dark*`。实际生成器 [playTheme.ts:80-94](../../../apps/web/src/ui/playTheme.ts:80) 正是 `:root` + `html[data-ui-theme="dark"]` 两段；若 agent 遵守前一句，就会漏掉深色舞台值，或为了满足后一句违反技能自己的边界。 | 明确改为“只写令牌，不改布局/结构/组件选择器；令牌可按主题状态分别写在 `:root` 与 `html[data-ui-theme="dark"]`（必要时 `html[data-ui-theme="light"]`）”。同时给出完整可复制的浅/深色模板，并说明 `--accent-soft` 等由宿主现推、不要自行重复定义。 |
| B2 | [SKILL.md:83-94](../../../apps/server/skills/galgame-ui-style/SKILL.md:83)、[SKILL.md:110](../../../apps/server/skills/galgame-ui-style/SKILL.md:110) | 技能把五组消息框与五组开始菜单说成可成对选择，并规定 `.title-screen[data-menu-style="..."]`，但仓库当前没有任何 `data-menu-style`/`menuStyle`/`dialogStyle` 命中；[TitleView.tsx:139-210](../../../apps/web/src/views/TitleView.tsx:139) 只渲染 `.atri-menu`，生产 CSS 也只有 `data-dialog-style`。因此 agent 可能把 `play.json` 或 `theme.css` 当成开关载体，写入一个不会被消费的属性，用户看不到开始菜单风格变化。 | 在技能中明确现状：ATRI 是唯一实际标题菜单档，消息框五档是已接通的引擎档；开始菜单 M1-M5 和配对开关属于待接线设计，当前剧目不能通过可写文件启用。若本次需求要求立即可选，先提供真实的设置字段/持久化路径、属性注入和标题菜单生产 CSS，再在技能中写启用契约；否则删除“可选配对”的行动式表述，保留为未来生产实现参考。 |
| B3 | [SKILL.md:93-102](../../../apps/server/skills/galgame-ui-style/SKILL.md:93)、[SKILL.md:14](../../../apps/server/skills/galgame-ui-style/SKILL.md:14) | “生产 CSS 的硬约定”要求 agent 按 `html[data-dialog-style]` 和 `.title-screen[data-menu-style]` 写规则，但工坊实际可写面只有 `theme.css`、`play.json`、`assets/manifest.json`、`memory/**`、`characters/**`，见 [playFiles.ts:101-127](../../../apps/server/src/playFiles.ts:101)。主题文件又被禁止新增组件选择器。技能没有说这些是引擎维护者的参考，agent 会尝试改 `packages/stage/src/stage.css`/`app.css`，或者把选择器错误写进剧目 `theme.css`。 | 增加醒目的边界段：工坊/剧作家只把令牌写入剧目 `theme.css`，不得写 `stage.css`、`app.css`、React、设置字段或 `data-*` 注入；生产 CSS 约定仅供引擎实现者接通既有档位时参考。若未来允许剧目自定义选择器，必须先改变可写面和安全边界，不能靠本技能暗示。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | [SKILL.md:47-52](../../../apps/server/skills/galgame-ui-style/SKILL.md:47) | 表面令牌清单不完整且有模糊项。实际生产令牌还包括 `--dialog-text-shadow`、完整的 `--modal-btn-*`、`--modal-danger-*`，而“按钮与 danger 令牌”不能给模型可执行的名字。缺名会导致 agent 直接写死颜色或误造不存在的令牌。 | 按实际源码列出完整令牌名，并标注哪些是舞台根消费、哪些是宿主/portal 消费；至少补上 `--dialog-text-shadow`、`--modal-btn-bg/edge/hover-bg/hover-edge`、`--modal-danger` 及其 bg/edge/hover/ink 变体。 |
| S2 | [SKILL.md:20-21](../../../apps/server/skills/galgame-ui-style/SKILL.md:20)、[SKILL.md:48-52](../../../apps/server/skills/galgame-ui-style/SKILL.md:48) | 技能将 `--accent-soft` 列入主题令牌，但实际主题生成器刻意不写它，由 [app.css:288-294](../../../apps/web/src/app.css:288) 按当前深浅档推导；同时 `--modal-*` 主要定义/消费在 `stage.css`。当前文字容易让 agent 为了“完整”覆盖派生令牌，破坏宿主的深浅配比。 | 把“可覆盖”与“不要覆盖/由宿主派生”分栏，明确 `--accent-soft` 不写；说明 modal 令牌只有在确实需要改变弹窗表面时才覆盖，不能凭空造主题专属令牌。 |
| S3 | [SKILL.md:58-64](../../../apps/server/skills/galgame-ui-style/SKILL.md:58) | `liftForDark` 的算法写对了，但文档将其描述成通用“每个通道提亮 22%”，没有强调输入是六位 hex、按通道 `round(v * .78 + 255 * .22)`，也没有提醒 `readableInk` 对无效值的行为。模型可能对 HSL/百分比色自行套算法。 | 直接注明只对 `#rrggbb` 使用该公式，给一个输入/输出例子，并要求最终仍以白/深墨对比度较高者作为 `*-ink`；复杂渐变的对比度要在最终底上复核。 |
| S4 | [SKILL.md:81-93](../../../apps/server/skills/galgame-ui-style/SKILL.md:81) | “ATRI 也必须作为选项”与当前实现的语义没有分清：ATRI 是“不设置属性”的缺省，而不是现有的 `data-dialog-style="atri"` 档；将其写成普通可选值会使 agent 或未来实现添加无意义的 `atri` 分支，并可能改变默认级联。 | 明确 ATRI 的唯一启用方式是省略两个属性；若产品要在设置中展示它，持久化值可为 `atri`，但渲染层必须归一化为移除属性，并写清这不是现有生产 CSS 选择器。 |
| S5 | [SKILL.md:94-102](../../../apps/server/skills/galgame-ui-style/SKILL.md:94) | `focus-visible` 规则只给出标题菜单的 `.atri-menu.is-keyboard`，但消息框风格还覆盖 `.quick-btn`，且基线存在 `.quick-btn.tgl-on` 的激活态与全局 hover 级联。清单虽提醒 hover，未明确要检查所有风格分支和 `:disabled`，容易只修 ATRI 标题菜单。 | 将焦点/hover 自查扩展到消息框、快捷按钮、选肢和开始菜单；要求激活态显式声明 `color`，并保留 `:hover:not(:disabled)` 与 `:focus-visible` 的状态优先级。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | --- |
| N1 | [SKILL.md:85-92](../../../apps/server/skills/galgame-ui-style/SKILL.md:85) | 五组配对表对材质色方向有配比范围，但没有说明配比用于最终表面底色/边线还是装饰色；模型可能把 26% accent 直接用于正文或整块底，造成对比度退化。 | 每行将“底/边/装饰/文字”分开写，强调正文始终使用经过对比度验证的 `*-ink`。 |
| N2 | [SKILL.md:99-111](../../../apps/server/skills/galgame-ui-style/SKILL.md:99) | 窄屏约束描述较好，但“通常 `calc(100% - 24px)`”仍给了自由发挥空间；消息框风格的实际断点和窄屏规则在 `stage.css` 中分散于多个媒体块，技能无法保证 agent 只改正确层。 | 对剧目主题文件只要求不改尺寸/布局；将具体断点与尺寸保留在引擎生产 CSS 说明中，并注明不能由剧目 agent 落盘。 |
| N3 | [SKILL.md:106-112](../../../apps/server/skills/galgame-ui-style/SKILL.md:106) | “确认改动只写入允许的剧目文件”虽已出现，但没有列出 `theme.css` 的实际相对路径格式和禁止改动的生产文件，和前面的生产 CSS 章节形成冲突。 | 在自查清单开头列出允许写入集合及禁止集合，避免最后一条被模型当作软提醒。 |

## 准入结论

**结论**：`不准入`

**说明**：配色、对比度、材质色和 ATRI 基线的方向基本正确，但 B1-B3 会直接导致 agent 违反可写面、漏掉深色令牌，或尝试启用当前不存在的开始菜单风格机制。至少澄清主题文件的深色写法、生产 CSS 与剧目写面的边界，并如实标注标题菜单风格尚未接通后，才适合进入技能库。
