# `<title>` 加底色与字色参数（默认黑底白字）

日期：2026-10-10 ｜ 仓库：`stage-ai`（改动面）+ `dsh-aivn`（共享包受影响的验证面）

## 1. 问题

`<title>`（全屏标题卡）现在**没有底**，字色取舞台皮肤令牌 `--title-ink`——深色舞台 `#f2ebde`、
浅色舞台 `#23201c`（`packages/stage/src/stage.css:89` / `:234`），靠 `--title-shadow` 兜叠层可读性。

模型看不到这套令牌，也无从知道当前是哪套皮肤，所以「这张卡写出来长什么样」它判断不了：
想要黑底白字的章节卡得自己先铺一行 `<scene bg="black"/>`，想叠在场景上又完全靠运气。

## 2. 契约

`<title>` 增两个属性，与 `align` / `mode` 并列：

```xml
<title bg="black" ink="white" align="center" mode="lines">第一章
风起</title>
```

| 属性 | 取值 | 缺省 | 语义 |
|---|---|---|---|
| `bg` | `black` / `white` / `#rgb` / `#rrggbb` / `none` | `black` | 卡片底色；`none` = 显式透明（叠在场景上，回到旧观感） |
| `ink` | `black` / `white` / `#rgb` / `#rrggbb` | 按底色配对比色 | 卡片字色 |

- 色名大小写不敏感；取值词表与 `<scene bg>` 的纯色场**同一套**（`black` / `white` / 十六进制）。
- `ink` 缺省**由底色决定**：黑底白字、白底黑字、`#hex` 按相对亮度取对比色。条文写进提示词，
  模型要么拿到一个必然可读的默认，要么自己点名颜色——不会出现「白底白字」这种它预判不到的结果。
- `bg="none"` 时 `ink` 缺省回到舞台皮肤 `--title-ink`，投影保留（就是加这个属性之前的观感）。
- 底色为实色时丢掉投影（投影是为叠层可读性准备的，实底上加投影是发光的糊字）。
- 非法取值：`bg` 落回 `black`、`ink` 落回「按底自动」，各挂一条 `malformed_tag` 警告——与
  `align` / `mode` 同一条规矩。

## 3. 分层与影响面

**解析与谱系不感知颜色**：`bg` / `ink` 原样存进 IR 与谱系 attrs，只有渲染层分流——与
`<scene bg>` 的纯色场（`packages/core/src/dsl/sceneBg.ts`）同构。于是重放、回看、分支重建
天然带上这两个属性。

| 文件 | 改动 |
|---|---|
| `packages/core/src/dsl/color.ts` | 新增：色名表、十六进制正则、`parseColorValue`、`contrastInk`（sceneBg 与 title 共用） |
| `packages/core/src/dsl/sceneBg.ts` | 改用 color.ts 的色值原语，取值词表与行为不变 |
| `packages/core/src/dsl/titleStyle.ts` | 新增：`isTitleBg` / `isTitleInk` / `resolveTitleStyle`（底色、字色、是否投影） |
| `packages/core/src/dsl/spec.ts` | title 章补 `TITLE_BG_*` 常量与契约说明 |
| `packages/core/src/dsl/events.ts` | `title_start` 增 `bg`（必给，缺省已归一到 `black`）与 `ink?` |
| `packages/core/src/dsl/parser.ts` | title 分支解析并校验两个属性；挂起态带上它们 |
| `packages/core/src/lineage/replay.ts` | 重放过一遍守卫（老档/手改日志里的坏值落回默认） |
| `packages/stage/src/script.ts` | `ScriptLine` 增 `bg` / `ink`；`title_start` 落值 |
| `packages/stage/src/transcript.ts` | 会话记录条目带上两者（缓冲行与谱系节点两条路） |
| `packages/stage/src/director.ts` | 兜底自造条目带上两者 |
| `packages/stage/src/StageTheater.tsx` | `resolveTitleStyle` → 卡片容器内联 `background` / `color` / `text-shadow` |
| `packages/stage/src/stage.css` | 卡片容器给默认 `color` / `text-shadow`，两句文本改为继承 |
| `apps/server/src/orchestrator.ts` | `title_start` 的 attrs 带上 `bg` / `ink`（落谱系） |
| `apps/server/src/prompt.ts` | 《全屏标题卡》一节补两个属性、缺省与 `none` |
| `README.md` | 同上 |

`dsh-aivn` 侧没有 `<title>` 的提示词章（该章是服务端独有的），所以只吃共享包：
重建 `lib/` 后 `node build.mjs --check` 必须绿。

## 4. 验证

| 面 | 跑什么 |
|---|---|
| core | `pnpm --filter @aivn/core test test/title.test.ts test/parser.golden.test.ts` |
| stage | `pnpm --filter @aivn/stage test src/transcript.test.ts` |
| 类型 | `pnpm typecheck` |
| 跨线 | `pnpm -r build` → dsh-aivn `npm run build` + `node build.mjs --check` + `node e2e/run.mjs rebuild` |
| 人眼 | 起 dev，黑底白字缺省、`bg="white"`（自动黑字）、`bg="none"` 三种各看一眼（截图给用户） |

## 5. 非目标

- 不给 `<cg caption>` / 台词三件套加同类参数（本次只动 `<title>`）。
- 不做卡片的背景**图**（要图就用 `<scene>`）。
- 不改 `align` / `mode` 的语义。
