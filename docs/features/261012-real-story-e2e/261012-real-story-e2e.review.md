# 检视报告

## 概要

本次检视覆盖剧目库空状态文案/清除搜索按钮，以及路线树首屏自动取景的实现与新增测试。剧目库改动与目标行为基本一致；路线树的首屏取景算法和测试意图清晰，但 ResizeObserver 的生命周期与“树增长后不再抢镜头”的要求存在实际冲突，因此当前不能准入。

## 需求对齐

- `LibraryView.tsx`：已区分“已开演 + 空搜索词”和其他搜索结果为空的文案；搜索词为空时不渲染“清除搜索”，符合需求。
- `RouteCanvas.tsx`：已加入 `MIN_ZOOM` 下限、整树居中与长链贴根回退，也记录了手动拖拽/缩放状态；但 `ResizeObserver` 重新绑定后仍会调用自动取景，可能在路线数据变化（树长大）时重新抢镜头，未完整满足“树后来再长也不再重新取景”。
- 新增测试覆盖了静态首屏、长链回退和一次 rerender 后的镜头保持，但测试替身的 `ResizeObserver` 不会模拟真实观察器的首次回调，未覆盖上述生命周期场景。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B-01 | [RouteCanvas.tsx:194–204](apps/web/src/stage/RouteCanvas.tsx:194) | `ResizeObserver` effect 依赖 `frameAuto`，而 `frameAuto` 又依赖 `width`、`height`、`dir`（以及随之变化的 `frameFromRoot`）。树新增卡片时布局尺寸通常会改变，`frameAuto` 身份随之改变，旧 observer 被清理、新 observer 被创建；浏览器对新 `observe(el)` 会安排一次当前尺寸通知。该回调只检查 `manual.current`，没有检查 `framed.current`，因此会再次执行 `frameAuto()` 并重置 camera。也就是说，玩家尚未手动操作时树后来长大可能重新居中/缩放，违反需求中“首屏只自动取景一次、树后来再长也不再重新取景”；即使玩家已经手动操作，当前实现只靠 `manual` 防住这一条路径，仍未保证首屏后的自动策略是一次性的。现有 `NoopResizeObserver` 测试无法暴露该问题。 | 将 observer 回调与“首屏一次”和“视口尺寸变化后的重新取景”明确分离：至少在回调中使用/维护首屏完成标记，并避免因 `width`/`height`/`dir` 变化而重绑 observer；若确实需要响应真实视口尺寸变化，应比较 observer 回调中的 viewport 尺寸，只在容器实际尺寸变化时处理，而不是把布局尺寸变化当作触发条件。同时补一个会在 `observe()` 后主动回调的 ResizeObserver 测试，先 rerender 增加卡片再断言 transform 不变，并覆盖手动拖/缩后也不自动变化。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S-01 | [routeFit.test.tsx:45–50](apps/web/test/routeFit.test.tsx:45) | `NoopResizeObserver` 的 `observe()` 为空，测试只验证 `useLayoutEffect` 的同步结果，无法验证真实浏览器中 ResizeObserver 的首次通知、重绑和回调顺序；因此第三个“树长大后不重新取景”测试当前只能证明 observer 不回调时的行为。 | 使用可控的 ResizeObserver mock：`observe()` 记录 callback，并提供手动 `trigger()`；在 rerender 后触发 callback，断言镜头不变。另增加一次尺寸变化 trigger，明确产品是否要求仅在真实 viewport resize 时自动调整，并按该约定断言。 |
| S-02 | [RouteCanvas.tsx:179–186](apps/web/src/stage/RouteCanvas.tsx:179) | `frameAuto()` 在 `k < MIN_ZOOM` 时调用 `frameFromRoot()`，后者通过 `setCamera` 更新状态，而 `frameAuto()` 仍无条件返回 `true`。这在当前 effect 中表示“已完成取景”，但实际上只是提交了异步状态更新；如果面板容器在入场动画/布局稳定前仍返回异常尺寸，可能把一次不稳定的 fallback 标记为已完成。 | 让取景函数返回更明确的结果（例如 `"framed" | "waiting"` 或布尔值只表示尺寸有效且已完成目标策略），并在尺寸不足/布局尚未稳定时保留下一次机会；同时将动画期间的容器尺寸策略写进测试或产品约定。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | [LibraryView.tsx:95–99](apps/web/src/views/LibraryView.tsx:95) | `emptyHint` 每次渲染都会计算，逻辑本身很简单且没有问题，但用 `search.trim() === ""` 判断筛选语义、用原始 `search` 插值显示搜索语义，未来若新增筛选类型容易继续堆条件。 | 后续可抽成小型纯函数（如 `libraryEmptyHint(filterMode, search)`），让文案规则可独立测试；本次改动无需阻塞。 |
| N-02 | [routeFit.test.tsx:76–84](apps/web/test/routeFit.test.tsx:76) | 分岔树测试使用固定像素 transform，较好地验证了当前布局契约，但把 `routeTree` 的具体间距和取景算法耦合在一起，布局常量变更会导致测试同时失败，定位信息有限。 | 保留一个精确 transform 测试用于算法回归，同时补一个基于 `translate/scale` 解析的行为断言（整树边界落在 padded viewport 内且居中），降低测试对具体卡片间距的耦合。 |

## 准入结论

**结论**：`不准入`

**说明**：剧目库需求已正确实现；路线树的首屏取景在静态场景成立，但 ResizeObserver 重绑后可能因树增长再次自动取景，直接违反本次需求的核心行为约束。修复 observer 生命周期并补上真实回调测试后再重新检视。

## 复审

### 范围与处理核验

复审覆盖初审提出的 B-01、S-01、S-02、N-01，以及相关新增测试：

- B-01：`RouteCanvas.tsx` 的 `ResizeObserver` effect 已改为只挂载一次（依赖为空），不再随路线布局的 `width` / `height` / `dir` 变化而重绑。回调通过 `frameAutoRef` 读取每轮渲染的最新取景函数，因此既能响应真实画布尺寸变化，又不会因树新增卡片触发“重新 observe”而抢镜头。玩家拖拽、缩放、点击“看全树”或“回到开头”后仍由 `manual` 阻止自动取景。
- S-01：`routeFit.test.tsx` 已使用可控的 `FakeResizeObserver`，覆盖 observer 实例保持为 1、树增长后镜头不变，以及画布实际变窄时重新取景；同时补充了整树边界与居中行为断言。该测试能够检出 observer 随布局变化重挂的回归。
- S-02：新增 `canvasSize()` 统一读取 `clientWidth` / `clientHeight`，避免祖先入场 `transform: scale(0.98)` 污染首屏尺寸；取景函数在画布无尺寸时返回 `false`，有尺寸时将整树居中或贴根回退并视为完成，语义与实现一致。
- N-01：剧目库文案规则已抽为模块级 `emptyHintOf(filterMode, search)`，组件只负责调用，规则更易独立测试和维护。

### 综合评价

本次修正准确解决初审指出的 observer 生命周期问题，且没有改变“真实视口尺寸变化可重新取景”的既有意图。新增测试覆盖了首屏、可读倍数下的整树居中、长链贴根、树增长保持镜头和画布尺寸变化重取景；未发现新的架构、实现或用户体验阻塞问题。

## 准入结论（复审）

**结论**：`条件准入`

**说明**：初审的阻塞问题已修复，剧目库与路线树需求均与实现对齐；仍建议后续在真实浏览器中确认面板首次打开和旋转/缩放窗口时的视觉取景，但不构成本次合并阻塞。

- **准入范围**：可进入下一阶段（合并/交付）。
- **后续建议**：保留真实浏览器窄屏与面板入场动画下的路线树冒烟验证，确认 `clientWidth` 取值和底部控制栏让位后的可读性。
