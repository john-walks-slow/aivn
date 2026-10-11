# 检视报告

## 概要

检视了本次立绘抠底画幅与落位指标修复涉及的 `PlayAssets.cut()`、共享素材路径解析、素材表声明及回归用例。整体数据流与既有 `target`/`commit` 路径一致，核心修复覆盖了候选图抠底、画幅选择、指标落表和后续 `import_asset` 保留四个关键环节。

## 需求对齐

满足需求。路径分支在输出落入 `assets/sprites/<主体>/<差分>.<扩展名>` 时识别立绘身份，优先从草稿取景、其次从既有声明取景、最后回落 `full`，并将 `figureTop`/`figureHeight` 通过 `declareSprite()` 写入 manifest；非立绘输出仍保持原有行为。新增回归用例覆盖了 `draft -> cut -> register` 主流程，并验证了 `half` 对应的 1440x1920 画布和指标持久化。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| R-1 | [`packages/agent/src/media/catalog.ts:81`](../../../../packages/agent/src/media/catalog.ts:81)、[`apps/server/src/playAssets.ts:547`](../../../../apps/server/src/playAssets.ts:547) | 新增的 `spriteRefOfPath()` 只对 `rel.trim()` 做正则匹配，没有复用路径层的规范化规则。`PlayFiles` 的 `normalizePath()` 明确接受并去掉一个前缀 `./`；因此 `output: "./assets/sprites/mio/neutral.png"` 是合法且最终会写入 `assets/sprites/mio/neutral.png`，但 `spriteRefOfPath()` 无法识别它，导致该调用仍使用默认 9:16 画幅且不写 `figureTop`/`figureHeight`。同一合法路径仅因是否带 `./` 就产生不同业务结果。 | 在逆解析前统一使用与写盘层相同的 canonical 相对路径（至少去掉可接受的 `./` 前缀），或让 `spriteRefOfPath()` 接受 canonicalizer 回传的路径；补一条带 `./` 的回归用例，确认画布和 manifest 指标与不带前缀时一致。更长期可将路径规范化逻辑下沉到共享包，避免各层重复维护。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-1 | [`packages/agent/src/media/catalog.ts:73`](../../../../packages/agent/src/media/catalog.ts:73) | `SPRITE_ASSET` 的匹配结果仅用于识别身份，没有复用 `assertSpriteId` / `assertAssetStem` 的命名约束。当前 `writeBinary()` 已负责路径安全和扩展名白名单，风险有限，但该函数本身会把含点号、大小写或其他不符合素材命名约定的单段目录/文件名解析成素材身份；后续若调用方绕过更高层校验，manifest 可能出现不符合约定的键。 | 视共享规则边界决定是否收紧：要么在该函数中调用/复用统一的 sprite id 与 stem 校验，要么明确文档说明它是纯语法逆解析、合法性由调用方保证，并增加非法命名不会进入声明分支的测试。 |

## 准入结论

**结论**：`条件准入`

**说明**：核心修复逻辑与既有素材声明模型一致，主流程无阻塞问题；建议在合并前补齐 `./` 路径规范化，避免合法输入出现静默回退到 9:16 且指标丢失的行为差异。
