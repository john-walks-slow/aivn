# 窄屏立绘容量与自适应编排

日期：2026-10-11
状态：已实施并完成本机验证；跨宿主验证待合并主线后执行

## 目标

窄屏同框立绘不再因为每张图的实际宽度不同而互相覆盖；在不改变剧情状态、不伪造退场的前提下，根据舞台容器宽度限制当前画面可见人数，并保持同一布局档下结果稳定。

本计划独立于 `figureTop / figureHeight`。后者负责「一张立绘本身怎样归一化」，本计划负责「多张立绘怎样同时放进当前舞台」。

## 已对齐规则

- 窄竖屏默认最多显示 2 名角色。
- 较宽竖屏显示 3 名；横屏与桌面沿用现有排布。
- 自适应按少数宽度档切换，不按每个像素连续缩放。
- 当前说话人优先级最高。
- `keepVisible` 次之。
- 其他角色按新入场角色优先于旧入场角色：`orderSeq` 大的优先。
- 超出容量时只暂时不渲染，不触发 DSL `leave`，不修改 `VisualState`，不改变 `orderSeq` / `actionSeq`。
- 当前说话人和 `keepVisible` 角色超过容量时全部保留，允许有限重叠，不静默隐藏作者明确保留的角色。
- 暂不增加头像、姓名或「仍在场」提示。
- 尺寸变化立即按容量档重排，不做 hysteresis。
- 不新增 `priority`、`canSuppress`、`maxSprites` 或自动替换语义。

## 三层边界

### presence

`VisualState.sprites` 里的角色是否在场。只有 actor cue 的 `leave` / `action=exit|leave` 改变它。当前已有的 `leaving` 仍只表示真实退场动画。

### attention

当前说话人、动作状态和现有 z-index / dim 逻辑。`speakerFocusId` 继续只负责说话人亮度，不与容量淘汰混为一个字段。

### renderability

当前设备是否暂时显示，由新的 presentation planner 决定。被 planner 收起不是离场，不使用 `.leaving`、`.entering`，不写回剧情事件。

## 架构

服务端与 core 继续产生完整的 `VisualState`，不按客户端宽度裁剪。不同客户端可能有不同舞台容器宽度，客户端只能改变自己的画面呈现。

新增一个 stage 侧纯函数规划器，不改 `VisualState`：

```ts
interface PresentationPlan {
  profile: "desktop" | "portrait" | "narrow-portrait";
  capacity: number;
  actors: Record<string, {
    visible: boolean;
    renderPos: SpritePosition;
    renderScale: number;
    reason: "visible" | "speaker" | "keep-visible" | "newer-entry" | "suppressed-overflow";
  }>;
}
```

实际类型可按现有 `SpriteSlot` / `SpritePresentation` 调整，但必须保留以下输入：舞台容器宽度与方向、完整 sprites、当前 speaker、每个 slot 的 `keepVisible` / `orderSeq`、素材 framing/stature/figureHeight。

规划顺序：

1. 取非 `leaving` 的逻辑在场角色；真实退场中的角色保留原有淡出行为，不参与容量名额。
2. 按容器宽度与方向选择容量档：窄竖屏 2、较宽竖屏 3、桌面沿用现有容量。
3. 计算保留排序：当前 speaker → `keepVisible` → `orderSeq` 从大到小 → actor id 稳定兜底。
4. 先复用现有位置档排布，不改现有 `layoutSprites` 的 DSL 站位语义。
5. 容量内角色全部可见；容量外普通角色标记 `visible=false`。
6. speaker / keepVisible 超过容量时仍全部可见，输出诊断状态但不隐藏。

第一版 `renderScale` 固定为 1，不引入全员缩放。后续若真实画面仍需要有限缩放，另开阶段，不能在本次容量改动里悄悄改变 `figureHeight` 的视觉契约。

## `keepVisible` 数据流

新增 `ActorAttrs.keepVisible?: boolean`，只接受显式布尔语义。DSL 解析时仅在属性值明确为 `true` 时写入，缺省与其它值均视为 false。

`StageEvent` 保持通过 `ActorAttrs` 携带该字段；`applyActorCue` 将它写入 `SpriteSlot`，后续 actor cue 缺省时保持旧值，像 `variant` / `anchor` 一样属于 slot 的持续状态。

回放路径 `visualAt` / `applyVisualCue` 复用同一字段，确保同一逻辑状态下 planner 输入一致。`keepVisible` 不改变服务端事件之外的任何逻辑。

剧本示例：

```xml
<actor id="chusan" keep_visible="true"/>
```

它表达「当前设备容量不足时不要自动收起 chusan」，不表达屏幕上限、位置或缩放。

## 舞台接线

- `.theater-stage` 已有 `container-type: inline-size`，继续以舞台容器宽度为测量对象。
- `StageTheater` 用 `ResizeObserver` 监听舞台容器宽度，计算当前容量档；只有档位变化时重新生成 plan。
- 真实 `visual.sprites` 继续完整遍历，渲染层改为读取 plan 的 `visible`、`renderPos`、`renderScale`。
- 被收起角色不调用 `onError`、不挂 `.leaving`，不改变 `current/outgoing` 差分交叉淡化状态。
- 容量恢复时使用 presentation 层的淡入或直接恢复，不播放角色入场动画。
- CSS 只消费 planner 给出的类名/变量，不使用 `nth-child` 决定身份，也不在 CSS 中实现优先级。

## 纯函数与测试

新增 planner 测试覆盖：

- 390px 左右窄竖屏，普通三人只保留当前 speaker 与新入场角色。
- `keepVisible` 角色优先于普通新入场角色。
- speaker、keepVisible 超过容量时都保持可见。
- 同一 VisualState 与同一容量档输出稳定且顺序确定。
- `leaving` 不占新容量，但保留真实退场的旧画面行为。
- suppression 不改变 `orderSeq`、`actionSeq`、`leaving`。
- 宽竖屏容量 3，桌面沿用旧排布。
- 纯函数不依赖 DOM、ResizeObserver 或浏览器 viewport。

接线测试覆盖：

- 容器宽度档变化会更新呈现 plan。
- 回看时收起/恢复不播放假的入场/退场动画。
- speakerFocusId 的 dim 逻辑仍只由说话人决定。
- `keepVisible` 从 actor cue 到 VisualState、回放、StageTheater 全链路保留。

## 不做的事

- 不按屏幕宽度修改服务端 WS 事件或谱系。
- 不把暂时收起写成 actor leave。
- 不新增自动替换其它角色的机制。
- 不改 `spriteStagePreset`、`figureTop` / `figureHeight` 算法。
- 不新增窄屏提示 UI。
- 不用 CSS `nth-child` 或纯 CSS 媒体查询决定隐藏谁。
- 不承诺所有设备构图完全相同，只承诺同一布局档下结果稳定。

## 实施顺序

1. 扩展 core `ActorAttrs`、parser、StageEvent 与回放相关类型，加入 `keepVisible`。
2. 扩展 stage `SpriteSlot` 与 `applyActorCue`，补充 keepVisible 的持续状态测试。
3. 在 `packages/stage` 新增纯 planner 与容量档函数，先用固定 `renderScale=1`。
4. 接入 StageTheater 的 ResizeObserver 与 plan 渲染，增加 presentation 专用可见状态处理。
5. 补 stage 单测与窄屏/桌面真实截图，确认 speaker / keepVisible / 新旧入场顺序。
6. 重新构建 core、stage、web，跑受影响测试与 typecheck；再做 dsh-aivn 跨宿主验证。

## 验收重点

- 390px 窄屏三人同框时，不再让普通旧角色挡住说话人或新入场角色。
- 同一个角色被暂时收起后，下一句仍可正常说话、换差分、执行 action，再恢复显示。
- 真实 leave 仍然播放退场，不会被容量 planner 当成收起。
- 桌面现有三人构图不发生意外变化。
