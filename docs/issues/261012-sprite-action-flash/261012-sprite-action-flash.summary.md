# 立绘演完行为词闪一下 — 修复小结（261012）

## 结论

现象成立，根因是 **CSS `animation` 是整条替换的属性**：`.entering`（常驻类）挂着 `animation: sprite-in`，
演行为词时 `.acting` 用更高特异性把整条换成行为词动画；撤 `.acting` 的那一刻
`animation-name` 换回 `sprite-in`，浏览器把入场淡入当**新动画**从 `opacity: 0` 重播一遍。

修复：入场淡入改成**一次性**——动画跑完（`onAnimationEnd`）就摘掉 `.entering`，
行为词把它顶掉时（没有 `animationend`）在行为词的收尾计时器里一并摘掉；
`.acting` 规则收成一条 `.theater-sprite.acting` 并挪到 `.entering` 之后（不再需要靠第二个状态类抬特异性）。

## 验证

headless Chromium 假流注入（摆一个人 → 点一下推进 → 演一记 `jump`），`getAnimations()` 逐帧采样：

| | 行为词开演后的采样 |
| --- | --- |
| 修复前 | `240ms opacity=0.000 sprite-in:running` → `280ms 0.520` → `360ms 0.963`（补播入场淡入） |
| 修复后 | `opacity` 恒 `1.000`，只剩 `sprite-act-jump:running` |

回归：入场淡入本身仍在（页面内 rAF 录制：挂载后 `0.000 → 1.000`）；
`pnpm --filter @aivn/stage test` 62 例全绿；`pnpm typecheck` 全绿。

## 影响面

`packages/stage` 是两条发行线共用的渲染层，本改动会随构建进 `dsh-aivn` 的 `lib/client.js`：
合回 main 之后需在 DSH 侧重建 `lib/` 并按 `docs/references/261009-cross-host-verification.md`
跑该侧验证（本仓 worktree 里 `dsh-aivn` 仍指向 main 的 `packages/*`，无法在合并前验证）。

## 遗留（未在本笔修复内）

- 行为词收尾用固定 `560ms`（`StageTheater.tsx`），与 CSS 的 `--act-ms` 两处真相源；
  `prefers-reduced-motion` 下 CSS 时长变 0 而定时器不变。这不是闪烁的根因，属既有实现。
- `onAnimationEnd` 未区分动画名（当前元素只有入场与行为词两类动画，语义上够用）。
- 浏览器级回归（`getAnimations()` / CSS 级联）不在现有 vitest 设施能力范围内，
  本次以实测脚本 + 本文留证，未加自动化用例（项目规范：不为测试改产品代码或造 harness）。
