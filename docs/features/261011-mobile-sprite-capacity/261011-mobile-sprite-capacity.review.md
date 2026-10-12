# 检视报告

## 概要

本次改动实现了窄屏立绘容量限制与自适应编排特性。涉及 `packages/core`（DSL 规范扩展、解析与谱系回放）、`packages/stage`（Cue 与 SpriteSlot 状态累积、纯函数 presentation planner、StageTheater 响应式尺寸监听与收起样式）。整体设计分层清晰，很好地将数据状态（presence）、叙事焦点（attention）与呈现视口（renderability）解耦，未破坏 VisualState 语义与历史回放。有少量关于 ResizeObserver 挂载监听边界、CSS visibility 过渡时序及回放属性保真的非阻塞优化项。

## 需求对齐

变更完全满足 docs/features/261011-mobile-sprite-capacity/261011-mobile-sprite-capacity.plan.md 的既定设计与规则：
1. **容量档位**：窄竖屏容量为 2，宽竖屏容量为 3，横屏/桌面不限容量，尺寸变化立即按档位重排。
2. **优先级排序**：说话人 > `keepVisible` > 新入场角色（`orderSeq` 降序）> 稳定字典序兜底。
3. **软收起语义**：超出容量角色仅在 presentation 视图层标记 `visible=false`，不改动 `VisualState`，不触发 `leave`，不修改 `orderSeq`/`actionSeq`。
4. **超容保全**：当说话人与 `keepVisible` 角色总数超过容量时全部保留可见，不强行抹除。
5. **退场解耦**：处于真实 `leaving` 中的角色不参与容量名额分配，但其淡出 DOM 表现被正确保留。

## 阻塞问题

无

## 建议修改

无

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | [StageTheater.tsx:523-537](packages/stage/src/StageTheater.tsx#L523-L537) | `ResizeObserver` 当前观测的是 `root`（`.stage-root` 根容器），但测量的尺寸是其内部子节点 `.theater-stage`。在首次挂载且样式尚未完全就绪、或舞台发生局部 flex 挤压时，若 `.stage-root` 尺寸未变而 `.theater-stage` 尺寸产生微调，可能漏触发重新度量。另外首次渲染时 stageWidth/Height 为 0，profile 会先落入 desktop；虽然首次 mount 时 `measure()` 会同步补正，但在极其严苛的首次布局计算中可能有短暂的一帧 desktop 计算。 | 建议直接用 `ro.observe(stage)` 观测实际舞台 DOM 容器 `.theater-stage`（或在 `stageRef` 上监听），保证测量的 target 与 observer target 严格一致。 |
| N-02 | [stage.css:741-745](packages/stage/src/stage.css#L741-L745) | `.theater-sprite.presentation-suppressed` 声明了 `visibility: hidden; opacity: 0;`。但在基础类 `.theater-sprite`（L724-L728）中，`transition` 仅声明了 `opacity`、`filter`、`transform`，没有声明 `visibility`。这会导致当立绘从收起状态恢复时，`visibility` 会瞬间变成 `visible` 并伴随 0 到 1 的 `opacity` 渐变；但在被收起的一瞬间，`visibility: hidden` 会立即生效，将立绘瞬间隐藏，可能略过预期的 `opacity` 淡出。 | 建议为 `.theater-sprite` 补充 `visibility var(--fade-ms) ease` 过渡，或者对 `.presentation-suppressed` 保持单纯的 `opacity: 0; pointer-events: none;`，让淡入淡出更平滑自然。 |
| N-03 | [replay.ts:109-112](packages/core/src/lineage/replay.ts#L109-L112) | 在 `lineageToEvents` 的 `actor` 分支中还原了 `pos`、`action`、`keepVisible`、`variant`，但未显式 pick `shot` 与 `anchor`。虽然谱系主要聚焦核心叙事与立绘在场，但为了保证重放链路全属性的一致性，建议保持字段对齐。 | 可在 `replay.ts` 的 `pickDefined` 中补充 `"shot"` 与 `"anchor"`，提升谱系事件还原的完备度。 |
| N-04 | [presentation.ts:61-62](packages/stage/src/presentation.ts#L61-L62) | 在为 `layoutSprites` 构建 `explicit` 位置映射时，使用了 `explicit.set(id, input.sprites[id]!.resolvedPos)`。若该角色此前未显式设置 `pos`（即 `pos === undefined`），此处会因为 `pos` 为假值而跳过，走自动排布；但如果角色显式写过 `pos`，传入的却是上一轮已计算的 `resolvedPos` 而非原始意图 `pos`。在绝大多数情况下两者一致，但使用 `input.sprites[id]!.pos!` 语义上更纯粹。 | 建议改为 `explicit.set(id, pos)`，直接传递原始声明的 `SpritePosition`。 |

## 准入结论

**结论**：`准入`

**说明**：核心功能实现稳健，状态流转与边界条件严谨完备，测试覆盖充分（含 parser、director cue 持续态以及 planner 极端边界），无阻塞性缺陷与破坏性改动，符合架构规范。
