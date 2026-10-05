# 弹窗遮罩点击穿透到舞台推进

## 现象

舞台上点开任一弹窗（提示 / 改写 / 重写 / 生图 / 自由输入），点弹窗背景遮罩关闭时，
舞台同时往前推进一句；停在停止点上时则直接开新一轮。

## 复现

`apps/web/test/modalScrim.test.tsx`（新增，2 例，修前皆红）：

- 点开「提示」再点遮罩 → `onContinue` 被调了 1 次（应为 0）。
- 点开「提示」再点遮罩 → 播放头从 null 走到了 l1（应不动）。

## 根因

`Modal` 用 `createPortal` 挂到 `document.body`，但 React 里 portal 的事件仍按**组件树**
冒泡，而非 DOM 树。舞台的弹窗全都渲染在 `.theater`（`onClick={onStageClick}`）的子树里，
遮罩 `.modal-scrim` 的 `onClick` 只调 `onClose`、没拦冒泡——点一下遮罩关了弹窗，
同一事件继续冒到 `.theater`，又触发一次翻句 / 继续生成。

卡片层（`.modal-card`）一直有 `stopPropagation`，只有遮罩层漏了；触摸三件套遮罩上也有，
只差 mouse click 这一路。`dismissible=false`（free 停止点）的遮罩连 `onClick` 都没挂，
同样往上冒，同一病因。

## 修复路径

单点修 `apps/web/src/ui/Modal.tsx`：遮罩的 `onClick` 先 `stopPropagation` 再 `onClose`。
修在事件源头，舞台 / 路线 / 标题页所有调用方一次性受益；路线画布的「点空白取消选中」
也被同一事件误伤，一并治好。

## 置信度

95%。机制明确且测试复现；改动一行、可逆。

## 验收标准

- `test/modalScrim.test.tsx` 2 例通过。
- `test/stageKeyboard.test.tsx` 等现有舞台用例无回归。
- 实机：任一弹窗点遮罩关闭，台词停在原句。
