# 检视报告

## 概要

本次改动针对工坊 Agent 生图工具存在的「模型无法预判抠底参数」以及「抠图瑕疵时重新出图会顶掉满意画面且白烧配额」两大痛点，实现了立绘原地重抠底（`recut_sprite`）能力。核心设计是在立绘首次出图落盘前把未抠底的原片缓存在 `media-cache/sprite-sources/`，当用户指出边缘问题时，本地重跑 `cutout.ts` 覆盖 assets 目录下的透明 PNG。
整体架构清晰，职责划分合理，代码保持了极简实用风格；工具清单、角色装配与前端自动化加载闭环完整。检视未发现阻塞问题，但发现多格式留底覆盖优先级、并发写竞态以及单测断言证伪度等建议改进项。

## 需求对齐

- **完全满足需求目标**：
  1. `generate_image` 工具彻底剔除了 `cutout` 调参参数，首次出图一律采用基于实测基准的默认参数，避免模型盲调；
  2. 实现了独立的工坊专用工具 `recut_sprite`，支持基于留底原片原地重抠，并提供精细化调参（strong、weak、minHole、keySmooth、edgeBand）；
  3. 重抠过程不调后端生图模型、不消耗出图配额、不透明主体像素 100% 保持一致，秒级响应并向工坊对话回传 Markdown 预览图片；
  4. 留底缺失（老图或上传图）有清晰、诚实的错误提示，不破坏剧目资产。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-1 | `apps/server/src/playAssets.ts:284-296` (`keepSpriteSource`) 与 `181-191` (`readSpriteSource`) | **多格式留底原片覆盖与读取优先级竞态**：`keepSpriteSource` 写入新留底时未清理同 stem 的旧扩展名文件（例如前一次生成是 `.jpg`，切换模型或设置后重新出图是 `.png`）。而 `readSpriteSource` 遍历时固定以 `[".jpg", ".jpeg", ".png", ".webp"]` 顺序查找。若残留旧 `.jpg`，重抠将持续命中陈旧的旧图原片，导致重抠结果与当前立绘错位。 | 在 `keepSpriteSource` 写入新留底前，循环清理同 stem 但不同扩展名的其他已有文件（如 `[".jpg", ".jpeg", ".png", ".webp"]` 中不匹配当前 `extOf(mimeType)` 的遗留文件），确保留底目录每个 stem 唯一对应最新原片。 |
| SUG-2 | `apps/server/src/playAssets.ts:171-179` (`recut`) | **缺乏并发保护与文件写竞态**：`generate()` 拥有针对 `${spec.kindPath}/${spec.stem}` 的 `inflight` 任务互斥，但 `recut()` 未做互斥保护。若同一立绘在后台出图过程中触发了 `recut`，或者用户/Agent 连续发出多条不同参数的 `recut` 请求，由于异步 I/O 完成时序不确定，可能发生后发先至的文件覆盖竞态或读到半更新原片。 | 在 `recut()` 开始前检查目标是否处于 `this.inflight` 中（若存在进行中的 `generate` 则拦截或排队）；亦可针对当前 stem 加简单任务锁，保证重抠写操作的串行化。 |
| SUG-3 | `apps/server/test/playAssets.test.ts:121-133` | **单测断言证伪度不足（缺少反向变化断言）**：测试中断言 `expect(written.equals(expected.data)).toBe(true)` 是在测试代码中重复执行了被测函数的逻辑，属于同义反复；而 `opaquePixelDiff == 0` 仅断言不透明区域一致，如果 `recut` 发生空转直接返回原始图，不透明像素差值同样为 0，无法直接证明「重抠调参后边缘确实发生了改变」。 | 在该用例中显式增加一条反向断言：`expect(written.equals(await readFile(files.absoluteOf(first!.path)))).toBe(false)`，直接证明调参重抠产生的 PNG 相比初次出图的原文件发生了有效字节变化。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| NBR-1 | `apps/server/src/store.ts:241` 与素材删除流程 | **留底原片生命周期治理**：`media-cache/sprite-sources/` 位于 `.gitignore` 中，但当用户在工坊彻底删除某个立绘或角色时，对应的留底原片不会被级联清理，长期使用下可能产生孤儿缓存。 | 后续在 `deleteAsset` 等素材清理流程中，可考虑按 `sprites/<charId>/<expression>` 联动清理 `spriteSourceDir` 下对应的原片文件。 |
| NBR-2 | `apps/server/src/store.ts:283` (`writeAsset`) | **用户手动上传立绘无法享受原地重抠**：用户直接上传的立绘目前不写 `media-cache/sprite-sources/`。当前实现对这类图报错提示「没法原地重抠」，处理方式诚实且符合需求定义，但对希望上传带白底原片由系统抠底的用户体验略有不足。 | 作为后续体验迭代项，可在用户上传立绘时提供「白底图自动抠底并留底」的扩展支持。 |
| NBR-3 | `apps/server/src/agentkit/recutTool.ts:26` | **TypeBox 调参 schema 上限与底层轻微不一致**：`recutTool.ts` 中 `minHole` 设置的最大值为 `10000`，而 `cutout.ts` 的 `envInt` 支持到 `100_000`。虽然 10000 像素已能满足绝大多数立绘抠洞场景，但上层契约略严于底层。 | 记录备忘，后续调参边界有大洞需求时可对齐为 `100_000`。 |

## 重点检视项逐项核验记录

1. **正确性验证**：
   - **错误路径保护**：`recut` 流程中，先执行 `this.readSpriteSource` 与 `cutout`，只有当抠底成功产出合法 PNG 数据后，才会调用 `persist` 覆写。若抠底因前景不足（`< 2%`）或底色不纯（`> 97%`）抛错，`assets/` 下原有立绘原封不动，已通过单测用例 `重抠失败不落半残图` 充分验证。
   - **成员校验安全性**：`recut` 传入 `notify: "workshop"` 调 `resolveSprite`。由于只有先前成功生成过的立绘才能重抠，而在初次出图时 `mapSprite` 已将角色（含剧作家临时角色 stub）写入 `play.json` 的 `characters` 中，因此正常重抠绝不会误触发成员缺失报错；而在角色不存在时能有效拦截，行为正确。
   - **留底写失败降级**：`keepSpriteSource` 内部用 `try...catch` 捕获异常仅打印 `console.warn`，保证主干出图流程正常落盘，不阻断用户。
2. **两处抠底调用的一致性**：
   - `cutSprite` 与 `recut` 均调用 `cutout.ts` 的统一入口，均未传 `canvasHeight`，统一走 `CANVAS_HEIGHT = 1920, CANVAS_WIDTH = 1080` 画布基准。
   - 裁切前景外框、等比缩放、底部居中（锚点 `[0.5, 1.0]`）逻辑均在 `cutout()` 内部统一执行，不存在画幅或缩放差异。
3. **并发安全性**：
   - 见建议修改项 SUG-2。
4. **测试质量**：
   - 见建议修改项 SUG-3。整体测试用例针对性强，真实覆写验证了不透明像素逐位相同、错误降级不落半残图、老图/上传图诚实报错等关键场景。
5. **工具面一致性**：
   - `ROLE_INSTALLABLE.workshop`、`workshopTools`、`TOOL_CATALOG` 均已完整登记 `recut_sprite`；
   - `agentkit.test.ts` 的角色安装清单比对锁与默认启用集锁均已覆盖；
   - 前端 `AgentPane.tsx` 通过 `toolsByRole` 动态向后端接口获取工具清单，自动将 `recut_sprite` 挂入「生图」分组（`group: "image"`）渲染开关，配置链路完备。

---

## 准入结论

**结论**：`条件准入`

**说明**：本次重抠设计架构清晰，功能闭环且完全命中业务痛点（不烧配额、原图画面 100% 保真、本地秒级调参），无阻塞问题。建议合并前或在后续迭代中处理多扩展名留底残留优先级覆盖（SUG-1）、并发写竞态保护（SUG-2）以及补充反向断言测试（SUG-3）。

## 整改记录

三条建议全部已处理：

| ID | 处理 |
| --- | --- |
| SUG-1 | `keepSpriteSource` 写新留底后清掉同 stem 的其它扩展名（与 `persist()` 清 assets 旧扩展名同一条理由）。另把散在两处的 `[".jpg", ".jpeg", ".png", ".webp"]` 收成 `IMAGE_EXTS` 一份。补一条用例：换扩展名重新出图后旧留底确实不在了。 |
| SUG-2 | `recut` 在读留底前 `await this.inflight.get(key)`——同一张图正在出图就等它出完。留底是出图途中写的，抢读只会拿到旧原片。反方向（重抠在飞、出图抢跑）没加锁：两边都是秒级本地写，后写覆盖先写就是正确结果。 |
| SUG-3 | 补的是更有证伪力的那条：**默认档重抠逐字节等于出图产物**。原来那条 `written == cutout(留底, 同参数)` 确实偏同义反复，现在两条互补——一条证明留底就是当初那张原片，一条证明参数真的传到了抠底层。 |

三条非阻塞问题未处理，理由：

- NBR-1（删素材不留清缓存）：留底是纯缓存，多占一点磁盘，重抠入口还先查抠底图在不在，删掉的图不会被缓存「复活」。
- NBR-2（上传的立绘也能重抠）：上传路径要额外决定「要不要抠底」，是另一条需求；当前如实报错。
- NBR-3（`minHole` 上限 10000 vs 底层 100000）：schema 严一点不影响现有能力，留作备忘。
