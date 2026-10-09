# 舞台上角色立绘不显示 — 端到端验证

本问题的 E2E 证据即「修复前 vs 修复后」的实机截图与四种转场的逐场走查，均已内联在
[`261008-sprite-hidden-behind-bg-stack.validation.md`](261008-sprite-hidden-behind-bg-stack.validation.md)
与 [`261008-sprite-hidden-behind-bg-stack.troubleshoot.md`](261008-sprite-hidden-behind-bg-stack.troubleshoot.md)
中。此处只登记**用什么跑的、怎么复现**，供后人重跑。

## 复现与验证环境

- 实例：本 worktree 的 server（`pnpm --filter @aivn/server start`，端口经 `acquire-port` 现取），
  静态挂 `apps/web/dist`。浏览器 Chromium 1440×810，Playwright（playwright-core）。
- 判定手段：`document.elementFromPoint()` 在**立绘躯干**上打点，看命中的是谁。
  命中 `.theater-sprite` = 立绘在上面；命中 `IMG.theater-bg.theater-stack-new` = 被背景压住。
  这比肉眼看截图可靠——立绘被不透明背景完全盖住时，截图上看不出它在不在 DOM 里。
- 逐层诊断：从立绘往上走 `parentElement`，逐层读 `getComputedStyle` 的
  `position / z-index / isolation / overflow / transform`，定位层叠上下文断在哪一层。

## 测试剧目

`scripts/mockSpriteLayers.mjs` 生成剧目 **`mock-layers`**：四种转场（cut / dissolve /
fade / fade-white）各一场、每场都上两个立绘，末尾再补一场 CG。素材从
`plays/testtest/assets` 软链（背景、立绘、CG 都现成，不复制 33MB）。

```bash
node scripts/mockSpriteLayers.mjs            # 生成 plays/mock-layers
# 起服务后进：/#/play/mock-layers/stage
```

为什么需要它：这个 bug 只在**换过一次底之后**才成立（`.theater-stack-new { z-index: 2 }`
是常驻规则），而默认的 `fade` 转场又必须整屏过色。四种转场各演一遍才看得出
「立绘是否始终在背景之上」与「纯色场是否盖住立绘」这两件事。

## 关键观测

| 观测点 | 修复前 | 修复后 |
| --- | --- | --- |
| 立绘躯干上 `elementFromPoint` | `IMG.theater-bg.theater-stack-new` | `IMG.theater-sprite` |
| `.theater-stack` 的 `isolation` | `auto` | `isolate` |
| `fade` 过色峰值时纯色场所在 | 背景栈内（`z-index: 5`） | 镜头容器下（`z-index: 4`，在立绘与 CG 之上） |
| 回看中纯色场 | 栈内、随栈一起被抑制 | 仍在 DOM 内，但被 `.rewinding` 规则掐掉动画（veil 基态 `opacity:0`，即不可见） |

## 修复后经公网入口复验

交付验收时经 cf 临时隧道（发布构建、server 静态挂 `apps/web/dist`）又跑了一遍同样的打点判定：

| 剧目 | 立绘数 | 立绘躯干 25% 处命中 | `.theater-stack` 的 `isolation` |
| --- | --- | --- | --- |
| `testtest`（用户报的那个） | 2 | `.theater-sprite` | `isolate` |
| `mock-layers`（四种转场） | 2–3 | `.theater-sprite` | `isolate` |

四种转场逐场推进、每次都换过底之后立绘仍在最上层——
正是「换过一次底就永久被压住」这个复现点。截图：`evidence/11-after-testtest-tunnel.png`、
`evidence/12-after-mocklayers-tunnel.png`。

## 回归用例

- `packages/stage/src/layering.test.ts` —— 读 `stage.css` 断言层叠契约（9 例）。
  已验证：删掉 `isolation: isolate` 时有 1 例变红，**这个文件真的抓得住本 bug**。
- `apps/web/test/spriteLayering.test.tsx` —— jsdom 渲染 `StageTheater` 钉 DOM 结构（6 例）。
  注意 jsdom 不算层叠、也读不到 CSS，它能守的是**结构**（栈与立绘是兄弟、纯色场不在栈内）；
  样式侧的契约由上面那个文件守。
