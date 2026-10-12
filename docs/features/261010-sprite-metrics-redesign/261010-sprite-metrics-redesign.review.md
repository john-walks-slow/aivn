# 检视报告

## 概要

本次检视覆盖立绘指标重构（sprite-metrics-redesign）的全部范围，包括抠图流水线归一化、领域层 framing/assets/spriteStage 契约与落位算法、渲染层接线、服务端四处调用点及相关单测。整体实现逻辑清晰，数学推导自洽，存量向下兼容完备，未发现阻碍准入的阻塞性缺陷。

## 需求对齐

完全满足需求规格与设计计划：
1. 抠图端成功支持 `aspectRatio` 与 `topPadding`，自洽回传 `figureTop` 与 `figureHeight`。
2. 领域层成功引入 `spriteAspectRatio` 单一换算源，并保证了 `figureTop + figureHeight = 1920` 的不变式与缺省兼容。
3. 舞台渲染层在 `spriteStagePreset` 完整实现「盒高补偿 + 头顶钉位」，小物体贴地与非 bottom 锚定行为完全保留。
4. 服务端采用、抠图、重抠各调用路径均正确透传指标并回写 `assets/manifest.json`。

## 阻塞问题

无

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| - | - | 无 | - |

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | `apps/server/src/playAssets.ts:544` | **路径分支抠图未传取景比例**：在 `cut(request)` 的非引用路径分支（`source` 为纯路径时），直接调用 `cutout(read.bytes, tuning)`，使用了缺省的 `aspectRatio`（9:16）。若用户或上游对 half (3:4) 或 square (1:1) 的非标准路径素材调用通用 cut，输出会被压进 9:16 画布，造成多余的宽度压缩与顶部留白。 | 建议在可能推断出 `framing` 的场景下允许传入 `aspectRatio`，或在注释中明确此分支仅针对未声明取景的兜底场景。 |
| S2 | `packages/agent/src/media/register.ts:46` | **registerAsset 未透传落位指标**：`adoptDraft` 通过 `imageOverride` 成功把 `figureTop` 与 `figureHeight` 带进 `declareSprite`，但姊妹函数 `registerAsset` 目前仅将未附带指标的 `spec` 传入 `declareSprite`。如果未来有已包含指标的 `spec` 经过 `registerAsset` 入库，指标将无法自动落入 manifest。 | 建议在 `registerAsset` 的 `input` 中同样允许传递 `figureTop` / `figureHeight`（或直接使用 `spec` 上的字段并入 `declareSprite`），保持采用与登记的对称性。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `packages/agent/src/media/cutout.ts:271` 与 `277` | **像素舍入的 1px 潜在漂移**：在 `cutout.ts` 中，`meta.height` 来自 `sharp.resize` 后的实际尺寸，而 `figureHeight` 计算为 `Math.round(box.height * scale)`。在极少数浮点舍入边界下，`sharp` 解码尺寸可能与 `Math.round` 产生 ±1px 偏差，导致合成时 `top` 与回传的 `figureTop` 有 1px 微差。 | 可直接使用 `meta.height ?? Math.round(box.height * scale)` 作为统一的 `figureHeight` 真实值。 |
| N2 | `docs/features/261010-sprite-metrics-redesign/261010-sprite-metrics-redesign.plan.md:194-198` | **跨宿主待办备忘**：计划文档中记录了与兄弟仓 `dsh-aivn` 联动的四处类型对齐需求，合并回主线后需按计划执行跨宿主验证与类型补齐。 | 维持原计划，在合入主分支后触发 cross-host-verification 即可。 |

---

## 重点核查专项反馈

### 1. 契约一致性与不变式核查
- **`figureTop + figureHeight = 1920` 不变式**：
  - 在 `cutout.ts:283-284` 中，`figureTop = canvasHeight - figureHeight`（其中 `canvasHeight` 默认为 1920）。无论走「高度先卡」还是「宽度先卡」分支，只要 `canvasHeight` 为 1920，两者之和严格恒等于 1920。
  - **宽度先卡自洽性**：在宽度先卡时，人物高度缩减（`scale = canvasWidth / box.width`），人物贴在画布底部（`top = canvasHeight - meta.height`），顶部留白变大。`figureTop` 忠实记录了顶部留白，`spriteStagePreset` 中 `figureScale = 1920 / figureHeight` 放大盒高，`headroom = (figureTop / 1920) * height` 向上推回图片盒，两者配合恰好使得头顶在舞台上的绝对位置恢复到 `raw.top`（即：`top + (figureTop / 1920) * height = raw.top`），完全自洽。
- **缺字段回退**：
  - 存量素材中 `figureTop` 与 `figureHeight` 为 `undefined`。
  - `headroom()` 校验 `!figureTop || figureTop <= 0` 返回 0；
  - `figureScale()` 校验 `!figureHeight || figureHeight <= 0` 返回 1；
  - 盒高与 top 均 100% 还原回未修改前的 `raw.height` 和 `raw.top`，无静默错位。

### 2. 落位公式核查
- **盒高一致性**：在 `packages/core/src/play/spriteStage.ts:145-150` 中，`height` 一次性由 `raw.height * figureScale` 算出，后续 `headroom(height, figureTop)` 与 `100 - height`、`50 - height / 2` 均使用的是放大补偿后的 `height`，没有任何地方混用未补偿的 `raw.height`。
- **负 top 保护**：没有对计算出的负 `top` 做 `Math.max(0, top)` 的误夹（`box()` 仅做 `round2(top)`），保留了盒子伸出舞台上边界的合法行为。
- **贴地 small 保护**：`grounded`（small 档）分支强制执行 `top = 100 - height`，不受 `headroom` 偏移干扰，且 origin 保持 `"bottom center"`，严格守住 `top + height = 100`。
- **center / top 锚定**：`center` 强制 `top = 50 - height / 2`，`top` 强制 `top = 0`，均未误加 `figureTop` 偏移。

### 3. 写盘路径与键位隔离
- **键位隔离**：
  - `declareSprite` 对 neutral 写入立绘级键 `<spriteId>`（写入 `framing`、`stature`、`figureTop`、`figureHeight` 等）；对非 neutral 写入差分级键 `<spriteId>/<variant>`。
  - 工坊与用户手写的描述走 `declareDescription`，落键到 `<spriteId>/<variant>` 的 `description` 字段。
  - `assetMetaOf` 每次获取浅拷贝对象保留已有属性，`declareSprite` 仅有选择地合并自身关心的呈现属性，不会覆盖工坊的 `description`、`tags` 或用户手填内容。
  - 写表过程统一受宿主 `withManifest` / `withPlayConfigLock` 锁保护，并发安全性良好。

### 4. 架构设计探讨：关于「画布贴合外框」替代方案的分析
用户关注：*「画布比跟着取景走」+「舞台按 figureHeight 反向补偿」是否存在更简单的等价实现（例如让画布直接贴合内容外框）？*

- **替代方案设想**：
  抠图后直接裁切透明边缘（bounding box），输出一张尺寸为角色真实外框（如 742×1680）的紧凑图。素材表记录原始宽高比例 `aspectRatio = w / h`，舞台直接按人物实际身高比例渲染。
- **为什么当前方案优于贴合外框（替代方案的致命缺陷）**：
  1. **差分切换闪烁与错位（表情抖动）**：
     这是 Galgame/视觉小说引擎的核心痛点。同一个角色的不同表情差分（例如普通 smile vs 挥手/张嘴/歪头 surprised），其透明紧凑外框的尺寸和中心点各不相同。若画布直接贴合外框，舞台在做 Cross-fade（十字淡化交叉过渡）时，两张图的包围盒尺寸、锚点和缩放比例不一致，切换瞬间人物躯干会发生明显的位移、抖动或比例缩放。当前方案固定画布底和居中对齐，保证了同一角色全部差分的足底与中轴线严格对齐。
  2. **CSS 宽高自适应与布局计算复杂度**：
     当前 Web 舞台基于 `--sprite-height` 百分比结合图片的固化比例进行排版。若各素材尺寸杂乱无章，CSS 必须针对每张图动态计算宽度和水平对齐偏移，破坏了当前 `pos-*`（左/中/右预设站位）的整洁抽象。
  3. **结论**：
     当前采用的「画布比锚定取景制式（保证同批次构图一致与差分稳定）+ 记录指标由舞台做反向盒高补偿」是权衡了**差分对齐稳定性**、**跨分辨率渲染自适应**与**旧素材兼容性**后的最优设计，不建议改为紧凑外框方案。

---

## 准入结论

**结论**：`准入`

**说明**：无阻塞问题。核心契约与不变式严密，边界与回退逻辑完备，建议修改项不影响当前功能运行与发布。
