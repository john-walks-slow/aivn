# 检视报告

## 概要

检视范围：261008「舞台立绘被背景压住」修复的 6 处改动（`stage.css` / `StageTheater.tsx` / 两个新增测试 / mock 脚本 / `apps/web/AGENTS.md` / issue 文档四件套）。整体评价：根因定位准确，两处修复（栈加 `isolation: isolate`、纯色场提到屏幕级 `z-index:4`）方向正确、实现干净，层序未引入新的错序；主要问题集中在**注释与 issue 文档的机制描述漂移**（2 处仍落后于代码）与**样式断言测试的正则脆弱性**，均非阻塞。

## 需求对齐

- 修复成立：`.theater-stack { isolation: isolate }`（`stage.css:396-401`）落在「数值所在的那一层」，把栈内 `1/2/4` 关回层内；`.theater-sprites`（`z-index:0`）与外层兄弟不再被背景层数值压过。文档三处（`stage.css` 注释、`apps/web/AGENTS.md`、`layering.test.ts` 头注）对机制的描述一致且已订正 camera 那一处初稿错误（troubleshoot 第 39-45 行有显式订正说明）。
- 纯色场迁移成立：`z-index:4` 位于立绘层（0）、CG 层之上，`.theater-overlay`（5）之下；台词条（12）、选肢层（15）、选肢遮罩（8）、工具条（20/45）都不在 camera 上下文内，不受影响。新增条件 `bgVeil && bgStack`（`StageTheater.tsx:807`）与 `transitionVeilColor` 只对 `fade`/`fade-white` 返回非空（`effects.ts:88-92`）一致，`cut`/`dissolve` 不产生 veil，四种转场行为正确。
- 回看抑制已补齐：`.theater-stage.rewinding .theater-fade-veil { animation: none }`（`stage.css:743`）——veil 的基态是 `opacity:0`，掐掉动画即不可见，回看不闪。
- 无过度设计、无与计划偏离。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| S1 | `apps/web/test/spriteLayering.test.tsx:10-12` | 头注把结论写反了：「父层 `.theater-camera` 只是 `z-index:auto` 的普通元素、不成层叠上下文」——这正是本次已订正掉的错误说法（camera 因 `will-change: transform` **是**上下文）。它同时与同一 PR 里 `stage.css:394`、`AGENTS.md`、`layering.test.ts:15` 三处新写的正解直接矛盾，后人读测试很容易被带偏。 | 按 `layering.test.ts:11-16` 的口径改写：camera 是上下文（实测），病根是「栈内数值与立绘层同处该上下文比大小」，隔离须落在数值所在层。 |
| S2 | `packages/stage/src/layering.test.ts:25-35` | `ruleBody` / `zIndexOf` 的正则 `(?:^\|})\s*<selector>\s*\{([^}]*)\}` 只处理「扁平、单行选择器、声明体无嵌套」的规则：选择器含逗号、出现在 `@media` 内、或声明体里再嵌 `{}`（未来加 `@supports`/嵌套）时会静默匹配不到或匹配到别的规则体，得到**假绿/假红**。当前 CSS 下逐条核对无误（`.theater-stack`/`.theater-fade-veil`/`.theater-sprites`/`.theater-camera`/`.theater-overlay` 均为顶层扁平规则，且 `.theater-stage.rewinding .theater-sprites` 那条不满足「紧接 `^`/`}`」故不会误命中），但这是一颗埋雷。 | 至少给 `ruleBody` 加一条「命中数 ==1，否则抛错」的断言，避免静默取到错误规则；或在注释里显式声明「仅支持顶层扁平规则，新增 @media/嵌套规则时本文件需同步升级」。 |
| S3 | `docs/issues/261008-.../261008-sprite-hidden-behind-bg-stack.troubleshoot.md:101-103` | 修法描述与最终代码不符：文中写「`.trans-fade*` 的类同时挂到 camera 与 stack 两处：栈里的类管背景新旧让位，camera 上的类管 veil」，但实际实现里 `trans-*` 只挂在栈 div（`StageTheater.tsx:743`），veil 的动画由自身 `.theater-fade-veil` 规则驱动（`stage.css:422`），camera 上没有 `trans-*` 类。文档漂移，会误导后人按「双处挂类」去改。 | 把该段改成最终形态：veil 挂在 camera 下、由自身类触发 `fx-veil`；`trans-*` 只在栈上。 |
| S4 | `docs/issues/261008-.../261008-sprite-hidden-behind-bg-stack.e2e.md:40` | 「关键观测」表写「回看中纯色场 … 不入 DOM（回看指向的那一格本就没有待播的转场）」。实测路径并非如此：回看定位到某个 `fade` 转场节点时 `visual.bgTransition` 仍在（`StageTheater.tsx:622`），`bgVeil && bgStack` 成立，veil 元素**在 DOM 里**，只是被 `.rewinding ... .theater-fade-veil { animation: none }` 抑制成不可见。 | 表格该行改为「在 DOM 内、被 `rewinding` 规则掐掉动画（`opacity:0` 基态即不可见）」。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| N1 | `apps/web/test/spriteLayering.test.tsx`（整文件） | 6 例中「换底之后立绘仍在 DOM」「栈与立绘是兄弟」「立绘在栈之后」三条断言，删掉 `isolation` 修复后**照样全绿**（文件注释已自陈）。其真正独立价值只在「DOM 顺序」这一条——CSS 层序契约由 `layering.test.ts` 守。二者定位不完全重叠，但重合度不低。 | 保留（DOM 顺序是第二道防线，成本低），但可在文件头明确「本文件不守 isolation 契约，只钉结构」，避免后人误以为删掉它=丢掉守卫。 |
| N2 | `scripts/mockSpriteLayers.mjs:55-58` 与 `...validation.md:24` | 二者断言「CG 在立绘之下（CG 是整屏画面、立绘压在其上）」，但按 CSS 绘制顺序，`.theater-cg`（`z-index:auto`）与 `.theater-sprites`（`z-index:0`，stack level 0）同处 step 6、按树序绘制，CG 在 DOM 中靠后（`StageTheater.tsx:761` vs `791`），实际是 **CG 盖住立绘**。此为改动前既有行为，与本次修复无关（本次未动 CG 层，风险中性）。 | 若非有意，应另开 issue 确认 CG/立绘的期望层序；本次仅建议修正 `mockSpriteLayers.mjs` 注释与 validation 表述，或在文档里标注「现状与预期不符，待确认」。 |
| N3 | `apps/web/AGENTS.md:56` | 新 pitfalls 条目信息密度很高、正文极长（单行逾 400 字），且与 `stage.css` 注释、issue 文档有相当篇幅重复。 | 可考虑拆分或压缩，把细节留给 `.troubleshoot.md`，pitfall 只留「结论 + 诊断手法」。属维护性偏好，不影响准入。 |
| N4 | `packages/stage/src/stage.css:411-423` | `.theater-fade-veil`（`z-index:4`）与栈内 `.trans-fade .theater-stack-old`（同为 `z-index:4`）数值相同；因栈已 `isolation`，二者不同上下文，无冲突。仅提示后人：这两个 4 是语义无关的同值巧合。 | 无需改；如需可加一句注释点明「与栈内 4 不在同一上下文」。 |
| N5 | `docs/issues/261008-.../*.md` 各文件 | 四件套中 troubleshoot/e2e/summary/validation 的机制表述经本次检视发现 2 处漂移（S3/S4），建议统一以 `stage.css` 的注释为唯一真相源再校对一遍全文。 | 一次性校对，避免文档间再互相矛盾。 |

## 未决问题

- `.theater-cg`（auto）与 `.theater-sprites`（0）的绘制顺序实际为"CG 在上"，与项目文档自述相反（见 N2）。此为改动前既有状态，本次未触碰，**未做浏览器实测**（仅按 CSS 2.1 Appendix E 的层叠绘制顺序推演）。需确认这是否为已知/有意行为；若不是，应另立 issue，不应混入本次修复。
- `mockSpriteLayers.mjs` 依赖 `packages/core/dist/lineage/*.js` 的构建产物，本检视未执行该脚本，未验证四种转场 mock 存档能真正生成（脚本内 `rm(dir)` 会清掉 `plays/mock-layers`）。属验证脚本，非交付代码。

## 准入结论

**结论**：`条件准入`

**说明**：无阻塞问题，修复正确、层序自洽、测试可守（`layering.test.ts` 读样式表、删 `isolation` 会变红，已自证有效）。但存在 S1（测试文件头注写反结论，与本 PR 的正解自相矛盾）、S2（CSS 断言正则脆弱易假绿）、S3/S4（issue 文档与最终实现/运行时行为漂移）四项建议修改，建议合并前先修 S1、后续迭代清掉 S3/S4 并给 S2 加一道失配即报错的护栏。
