# 立绘演完行为词闪一下（261012）

## 现象

用户报告：**「舞台上立绘的动效（比如跳什么的）播完常常会看到立绘有闪了一下（像是额外淡入了一次）」**。

## 根因

`.entering` 是**常驻类**（立绘挂载时加上，此后不摘），它带的规则是
`animation: sprite-in var(--fade-ms) ease`；演行为词时 `.acting` 用更高特异性把 `animation`
整条换成行为词那一段。**`animation` 是整条替换的属性**：撤掉 `.acting` 的那一刻，
`animation-name` 从 `sprite-act-jump` 换回 `sprite-in`，浏览器把入场淡入当成一条**新动画**
从 0% 重播——`sprite-in` 的 `from { opacity: 0 }`，于是立绘瞬间透明再淡回来，
看着就是「演完闪了一下／又淡入了一次」。

真浏览器实测（headless Chromium，假流注入摆一个人再演一记 `jump`，`getAnimations()` 逐帧采样）：

```
行为词开演后（修复前）：
   120ms  opacity=1.000  sprite-act-jump:running
   240ms  opacity=0.000  sprite-in:running      ← 立绘瞬间透明，入场淡入重播
   280ms  opacity=0.520  sprite-in:running
   360ms  opacity=0.963  sprite-in:running
   480ms  opacity=1.000  -
```

## 修复

修好之后同一场景、同一时刻（行为词演完那一帧）的实拍：

![行为词演完那一帧的立绘](assets/action-end-frame.png)


入场淡入改成**一次性**：

- `StageTheater` 的 `Sprite` 把 `.entering` 变成状态位，动画跑完（`onAnimationEnd`）就摘掉；
  行为词把入场动画顶掉时它没有 `animationend`，所以在行为词的收尾计时器里一并摘掉。
- `stage.css` 的 `.acting` 规则从 `.entering.acting / .leaving.acting` 收成一条
  `.theater-sprite.acting`，并**挪到 `.entering` 之后**——同为 (0,2,0) 时后写者赢，
  不再需要靠第二个状态类抬特异性。

这样入场动画只存在于「挂载那一下」，行为词的加/减都动不到它：撤 `.acting` 只是回到「没有动画」。

## 验收标准

- 行为词演完之后立绘元素上不该再有动画，`opacity` 全程 1.000：

```
行为词开演(>100ms)后最小 opacity = 1.000（期望 1.000）
低于 0.99 的采样 = 0 次
该窗口内出现过的动画 = [sprite-act-jump:running]（期望没有 sprite-in）
```

- 入场淡入本身不能丢（回归）：页面内 rAF 录制，挂载后 `opacity` 应从 0.000 爬到 1.000
  （修复后实测 `最小 0.000 / 最大 1.000，见到过 entering 类 = true`）。
- `pnpm --filter @aivn/stage test`（62 例）全绿。

## 附注

`packages/stage` 是两条发行线共用的渲染层：本改动会随构建进 `dsh-aivn` 的 `lib/client.js`，
所以合回 main 之后要在 DSH 侧重建一次 `lib/`（见 `docs/references/261009-cross-host-verification.md`）。
