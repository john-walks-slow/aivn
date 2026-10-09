# 舞台上角色立绘不显示 — 修复总结

## 问题

舞台上所有角色立绘都不显示，只有背景；台词、音乐、换景一切正常。

## 根因

`a0967d6f`（261007 的双层转场）引入的背景栈，`z-index` 逃出了自己那一层，
换过一次底之后永久压住立绘层。详见
[`261008-sprite-hidden-behind-bg-stack.troubleshoot.md`](261008-sprite-hidden-behind-bg-stack.troubleshoot.md)。

一处需要留意的是：这**不是**「图没到」或「取景算错」。立绘元素一直在 DOM 里、
图 HTTP 200、`complete: true`、位置尺寸全对——只是被不透明背景盖住了。
诊断时若只看截图会误判成素材缺失。

另一处是事后复核订正的（初稿说错、已改）：`.theater-camera` 带 `will-change: transform`，
它**是**层叠上下文，不是「`z-index:auto` 的普通元素」。所以病根不是「缺上下文」，
而是「栈内数值与立绘层落在**同一个**上下文里比大小」。修复本身不受影响（仍是给栈加
`isolation`），但这决定了备选修法的对错：实测在 camera 上加 `isolation` **无效**，
收口必须落在数值所在的那一层。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `packages/stage/src/stage.css` | `.theater-stack` 加 `isolation: isolate`（栈自成层叠上下文）；`.theater-stack-veil` → 屏幕级 `.theater-fade-veil`；回看抑制列表补上纯色场 |
| `packages/stage/src/StageTheater.tsx` | 转场纯色场从背景栈里移出来，挂在镜头容器下、立绘与 CG 之上 |
| `packages/stage/src/layering.test.ts` | 新增：读 `stage.css` 断言层叠契约（9 例） |
| `apps/web/test/spriteLayering.test.tsx` | 新增：jsdom 钉 DOM 结构（6 例） |
| `scripts/mockSpriteLayers.mjs` | 新增：四种转场各一场的 mock 存档，验证用 |

两处改动必须一起做：只加 `isolation` 会把纯色场关进背景层，`fade` / `fade-white`
的黑白场就盖不住立绘，人物浮在黑场里不动（已实测复现）。

## 设计取舍

**为什么隔离落在栈上、而不是把立绘层抬上去。** 把 `.theater-sprites` 提到 `z-index: 3`
也能立刻修好眼前这一例，但背景栈的 z-index 仍会继续与 CG 层、与后续任何并排层比大小，
同样的病会再犯。`.theater-sprites` 的 `0` 还是 `0a12aca9` 特意选的语义
（「整层落在选肢遮罩 8 之下」），动它要重新推一遍所有层的关系。
根因是「栈内排序泄漏到了外层」，就在栈上收口——与 `0a12aca9` 给立绘层做的是同一件事。

**为什么纯色场要搬家。** 它本来就属于屏幕（`cut`/`dissolve` 是背景层的事，
`fade` 是「整屏过色」）。关进背景栈之后它按自身语义就失效了。这次把它挪到
镜头容器下（`z-index: 4`，在立绘与 CG 之上、屏幕遮罩 5 之下），语义与位置终于对上。

## 测试

- `packages/stage`：62 例通过（含新增 9 例）。
- `apps/web`：222 例通过（含新增 6 例）。
- `pnpm -r build`、`pnpm typecheck` 全绿。

新增的 `layer.test.ts` 做过有效性验证：**删掉 `isolation: isolate` 时有 1 例变红**。
这一点值得记一笔——`apps/web/test/spriteLayering.test.tsx` 是 jsdom 测试，
它读不到 CSS，把修复整条删掉它照样绿。真正的守卫必须是读样式表那个。
（后者已在文件头注明自己只钉结构、不守层叠契约，免得后人误当它是 isolation 的守卫。）

## 检视结论

`261008-...review.md`：**条件准入**，无阻塞问题。提出 4 项建议修改（S1–S4）与 1 个未决问题（N2），
本轮已全部处理：

- **S1** `spriteLayering.test.tsx` 头注写反了结论（仍在说 camera 不成上下文）→ 按正解改写。
- **S2** `layering.test.ts` 的规则解析正则会静默失配 → 改为命中多条即抛错，并实测护栏会响。
- **S3/S4** issue 文档两处机制漂移（veil 的触发方式、回看中 veil 是否入 DOM）→ 按代码实际行为订正。
- **N2**（未决问题，已实测确认）**CG 与立绘并存时是 CG 压住立绘**，与文档自述相反。
  这是 `a0967d6f` 之前就有的行为，本次没动 CG 层，已记为「待跟进、另立 issue」，未并入本次修复。

## 实机验证

四种转场逐场走查（`mock-layers` 剧目，素材软链自 `testtest`），判定用
`elementFromPoint` 在立绘躯干上打点：改前命中 `IMG.theater-bg.theater-stack-new`，
改后命中 `IMG.theater-sprite`。截图与验证项见
[`261008-sprite-hidden-behind-bg-stack.validation.md`](261008-sprite-hidden-behind-bg-stack.validation.md)，
跑法见 [`.e2e.md`](261008-sprite-hidden-behind-bg-stack.e2e.md)。

## 遗留

无。这次没有引入兼容层，也没有留下待清理的旧类名（`.theater-stack-veil` 已删干净）。
