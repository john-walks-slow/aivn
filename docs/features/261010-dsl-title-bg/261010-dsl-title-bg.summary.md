# `<title>` 加底色与字色参数（默认黑底白字）

日期：2026-10-10 ｜ 实施于 `stage-ai`，验证触及 `dsh-aivn`

## 背景

`<title>`（全屏文本卡）此前**没有底**，字色取舞台皮肤令牌 `--title-ink`（深色舞台 `#f2ebde` /
浅色舞台 `#23201c`），靠 `--title-shadow` 兜叠层可读性。模型看不到这套令牌、也无从知道当前是哪套皮肤，
所以「这张卡写出来长什么样」它判断不了；想黑底白字得自己先铺一行 `<scene bg="black"/>`。

用户裁决：**底色与字色都要有参数，缺省黑底白字，透明必须显式指定。**

## 契约

```xml
<title align="center" mode="lines" bg="black" ink="white">第一章
风起</title>
```

| 属性 | 取值 | 缺省 | 语义 |
|---|---|---|---|
| `bg` | `black` / `white` / `#rgb` / `#rrggbb` / `none` | `black` | 卡片底色；`none` = 显式透明（叠层） |
| `ink` | `black` / `white` / `#rgb` / `#rrggbb` | 按底色配对比色 | 卡片字色 |

- `ink` 缺省**由底色决定**（黑底白字、白底黑字、`#hex` 按 WCAG 相对亮度），所以显式把底色改成白
  也不会掉进「白底白字」；`bg="none"` 时 `ink` 缺省回到皮肤令牌 `--title-ink` 并保留投影。
- 底色为实色时**丢掉投影**（投影是给叠层可读性用的，压实在底上就是发光的糊字）。
- 非法取值落回默认并挂 `malformed_tag` 警告——与 `align` / `mode` 同规矩。

## 实施

分层与 `<scene bg>` 的纯色场同构：**解析与谱系只原样存字符串，颜色在渲染层才成立**（重放、回看、
分支重建因此天然带上这两个属性）。

| 文件 | 改动 |
|---|---|
| `packages/core/src/dsl/color.ts`（新） | 色名表 / 十六进制正则 / `parseColorValue` / `contrastInk`，`sceneBg` 与 `titleStyle` 共用 |
| `packages/core/src/dsl/sceneBg.ts` | 改用上述原语（取值词表与行为不变） |
| `packages/core/src/dsl/titleStyle.ts`（新） | `TITLE_BG_DEFAULT`/`TITLE_BG_NONE`、`isTitleBg`/`isTitleInk`、`resolveTitleStyle` |
| `packages/core/src/dsl/{spec,events,parser}.ts` + `lineage/replay.ts` | title 章契约说明；`title_start` 带 `bg`/`ink`；解析与重放两道守卫 |
| `packages/stage/src/{script,transcript,director}.ts` | 三条取数路径（缓冲行 / 谱系节点 / 兜底行）都带上 `bg`/`ink` |
| `packages/stage/src/StageTheater.tsx` | `titleCardStyle()` → 容器内联 `background` / `color` / `textShadow: none` |
| `packages/stage/src/stage.css` | `.theater-title` 承接字色与投影，两句文本改继承（`bg="none"` 的观感与改动前逐项相同） |
| `apps/server/src/orchestrator.ts` | `title_start` 的 attrs 落 `bg`/`ink`（进谱系） |
| `apps/server/src/prompt.ts` / `README.md` / `apps/server/AGENTS.md` | 提示词与文档面 |
| 测试 | `packages/core/test/{title,parser.golden}.test.ts`、`packages/stage/src/transcript.test.ts` |

## 验证

| 面 | 结果 |
|---|---|
| 静态 | `pnpm typecheck` 全绿；`pnpm check:agent-contract` 9/9 |
| 共享包单测 | core 15 文件 263 用例全过；stage 7 文件 62 用例全过 |
| 服务端 | `prompt` + `promptCapabilities` 50 通过；`lineage-ops` 32 通过 |
| 渲染实拍 | headless chromium + **假 WS 流注入**（不调 LLM）跑真实客户端，三张卡的计算样式与观感均符合预期：缺省黑底白字 / `bg="white"` 自动黑字 / `bg="none"` 叠在场景图上。截图见 `screenshots/` |
| 跨线（`dsh-aivn`） | `npm run typecheck` + `npm run build` + `node build.mjs --check` 全绿（`lib/` 已重新打进本次改动）；离线 `node e2e/run.mjs rebuild` 14/14 |
| 未做 | `dsh-aivn` 的实例级 `style` / `stage` 套件（本机内存紧张，1.9GB 可用 + 已在跑的 18 个浏览器进程）；模型侧提示词是否真的照写，留给用户实机确认（见 validation） |

## 检视结论

**准入**（`261010-dsl-title-bg.review.md`，无阻塞问题）。两条非阻塞备忘保持现状（`contrastInk` 的入参
由 `parseColorValue` 保证；内联字色按设计强于皮肤变量）；一条建议已改：`transcript.test.ts` 那条用例的
标题与断言对齐，并补上「缓冲行带底色/字色」的断言分支。

## 已知边界

- `dsh-aivn` 的提示词里本来就没有 `<title>` 那一章（该章是服务端独有），所以那边不需要改提示词；
  两线共用同一份解析与渲染，DSH 侧一旦吃到 title 剧本就是新观感。
- 老剧本若在前一行写了 `<scene bg="black"/>` 再写 `<title>`，现在卡会自己盖一层黑底——不冲突，只是那一行
  变成了多余。
- 本次只动 `<title>`；`<cg caption>`、台词三件套的字色不在范围。
