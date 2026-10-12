---
name: galgame-ui-style
description: 剧目要换界面皮肤、主题色或消息框表面时读这个。规定剧目 theme.css 的令牌写面、深浅配色、对比度、材质色和窄屏自查；开始菜单 M1-M5 仅为未接线的引擎设计参考。
user-invocable: true
---

# 剧目界面皮肤

## 1. 写面边界（先读）

工坊/剧作家只可写入本剧目的以下文件：`plays/<id>/theme.css`、`play.json`、`assets/manifest.json`、`memory/**`、`characters/**`；`memory/archive/**` 是引擎产物，只读。界面皮肤实际只落 `plays/<id>/theme.css`，`play.json` 不承载颜色或风格开关。

`theme.css` 只能覆盖设计令牌（颜色、圆角、阴影、字族等），且只允许这两种选择器：`:root` 与 `html[data-ui-theme="dark"]`；确有需要时可加 `html[data-ui-theme="light"]`。不得写布局、尺寸、定位、DOM 结构、组件选择器、伪元素、媒体查询、`data-*` 注入或设置字段。

不得改 `packages/stage/src/stage.css`、`apps/web/src/app.css`、React/TS、标题菜单结构或任何生产 CSS。以下“生产 CSS”段落只说明引擎已经接通的档位长什么样，供引擎维护者参考，不是让剧目 agent 去改文件。
## 2. 可覆盖令牌

可覆盖的舞台/界面令牌如下；只在确实需要改变该表面时覆盖，不要造新主题令牌：

- 主色：`--accent`、`--accent-ink`、`--link`、`--play-accent`、`--play-accent-ink`、`--play-accent-dark`、`--play-accent-dark-ink`。
- 对话框：`--dialog-bg`、`--dialog-line`、`--dialog-ink`、`--dialog-ink-soft`、`--dialog-ink-thought`、`--dialog-ink-faint`、`--dialog-bad`、`--dialog-text-shadow`、`--dialog-hover`、`--dialog-veil`、`--dialog-shadow`。
- 选肢/名牌：`--choice-bg`、`--choice-line`、`--choice-ink`、`--choice-active-bg`、`--choice-scrim`；`--nameplate-bg`、`--nameplate-ink`、`--nameplate-line`。
- 弹窗：`--modal-bg`、`--modal-edge`、`--modal-shadow`、`--modal-glow`、`--modal-scrim`、`--modal-hover`、`--modal-line`、`--modal-field`、`--modal-field-edge`、`--modal-faint`；`--modal-btn-bg`、`--modal-btn-edge`、`--modal-btn-hover-bg`、`--modal-btn-hover-edge`；`--modal-danger`、`--modal-danger-bg`、`--modal-danger-edge`、`--modal-danger-bg-hover`、`--modal-danger-ink-hover`。
- 舞台器具：`--stage-chrome-deep`、`--stage-chrome-lit`、`--stage-chrome-bg`、`--stage-chrome-edge`、`--stage-chrome-gloss`、`--stage-chrome-quiet-bg`、`--stage-chrome-quiet-edge`、`--stage-chrome-quiet-ink`、`--stage-chrome-quiet-ink-hover`、`--stage-chrome-quiet-hover`。

`--accent-soft` 不要写：它由宿主按当前深浅档在 `apps/web/src/app.css` 派生。不要把 `--modal-*`、`--dialog-*` 的语义令牌写成固定组件选择器。

## 3. 完整浅/深模板

下面可直接复制，再替换颜色；`:root` 是浅色基线，深色只在第二段覆盖需要变化的令牌。两段都必须给舞台主色：

```css
:root {
  --accent: #2b7fb8;
  --accent-ink: #f3fbff;
  --link: #216a9e;
  --play-accent: #2b7fb8;
  --play-accent-ink: #f3fbff;
  --dialog-bg: #f8fafc;
  --dialog-line: #cbd5e1;
  --dialog-ink: #0f172a;
  --dialog-ink-soft: #334155;
  --dialog-ink-thought: #475569;
  --dialog-ink-faint: #64748b;
  --dialog-bad: #be123c;
  --dialog-text-shadow: none;
  --dialog-hover: #e2e8f0;
  --dialog-veil: #f1f5f9;
  --dialog-shadow: 0 10px 30px rgb(15 23 42 / .12);
  --choice-bg: #f8fafc;
  --choice-line: #94a3b8;
  --choice-ink: #0f172a;
  --choice-active-bg: #dbeafe;
  --choice-scrim: linear-gradient(180deg, transparent, rgb(226 232 240 / .7));
  --nameplate-bg: #fff;
  --nameplate-ink: #0f172a;
  --nameplate-line: #2b7fb8;
  --modal-bg: #f8fafc;
  --modal-edge: #94a3b8;
  --modal-shadow: 0 18px 44px rgb(15 23 42 / .2);
  --modal-glow: #2b7fb8;
  --modal-scrim: rgb(15 23 42 / .48);
  --modal-hover: #e2e8f0;
  --modal-line: #cbd5e1;
  --modal-field: #fff;
  --modal-field-edge: #94a3b8;
  --modal-faint: #64748b;
  --modal-btn-bg: #f1f5f9;
  --modal-btn-edge: #94a3b8;
  --modal-btn-hover-bg: #e2e8f0;
  --modal-btn-hover-edge: #64748b;
  --modal-danger: #b42318;
  --modal-danger-bg: #fee4e2;
  --modal-danger-edge: #f97066;
  --modal-danger-bg-hover: #fecdca;
  --modal-danger-ink-hover: #7a271a;
  --stage-chrome-deep: #174a70;
  --stage-chrome-lit: #2b7fb8;
  --stage-chrome-bg: #e8f3fb;
  --stage-chrome-edge: #2b7fb8;
  --stage-chrome-gloss: inset 0 1px 0 rgb(255 255 255 / .6);
}
html[data-ui-theme="dark"] {
  --accent: #79b8bd;
  --accent-ink: #102020;
  --link: #9bd5d8;
  --play-accent: #79b8bd;
  --play-accent-ink: #102020;
  --play-accent-dark: #79b8bd;
  --play-accent-dark-ink: #102020;
  --dialog-bg: #111923;
  --dialog-line: rgb(255 255 255 / .16);
  --dialog-ink: #f8fafc;
  --dialog-ink-soft: #cbd5e1;
  --dialog-ink-thought: #c4b5fd;
  --dialog-ink-faint: rgb(248 250 252 / .62);
  --dialog-bad: #fb7185;
  --dialog-text-shadow: 0 1px 4px rgb(0 0 0 / .7);
  --dialog-hover: rgb(255 255 255 / .12);
  --dialog-veil: rgb(255 255 255 / .06);
  --dialog-shadow: 0 16px 48px rgb(0 0 0 / .65);
  --choice-bg: #151d2a;
  --choice-line: rgb(255 255 255 / .18);
  --choice-ink: #f8fafc;
  --choice-active-bg: color-mix(in srgb, var(--accent) 35%, #161c2a);
  --choice-scrim: linear-gradient(180deg, transparent 20%, rgb(8 10 16 / .65));
  --nameplate-bg: #f8fafc;
  --nameplate-ink: #0f172a;
  --nameplate-line: var(--accent);
  --modal-bg: #111923;
  --modal-edge: color-mix(in srgb, var(--accent) 42%, #fff3);
  --modal-shadow: 0 18px 48px #000b;
  --modal-glow: var(--accent);
  --modal-scrim: #01040add;
  --modal-hover: #ffffff1f;
  --modal-line: #ffffff14;
  --modal-field: #02071099;
  --modal-field-edge: #ffffff24;
  --modal-faint: #ffffff80;
  --modal-btn-bg: #ffffff0f;
  --modal-btn-edge: #ffffff29;
  --modal-btn-hover-bg: #ffffff24;
  --modal-btn-hover-edge: #ffffff47;
  --modal-danger: #fca5a5;
  --modal-danger-bg: #ef444433;
  --modal-danger-edge: #ef444480;
  --modal-danger-bg-hover: #ef444459;
  --modal-danger-ink-hover: #fff;
  --stage-chrome-deep: #071a2e;
  --stage-chrome-lit: #79b8bd;
  --stage-chrome-bg: #0b1b2b;
  --stage-chrome-edge: var(--accent);
  --stage-chrome-gloss: inset 0 1px 0 #ffffff2e;
}
```

## 4. 配色与材质

推荐色板：`#1b5aa6`、`#2b7fb8`、`#2f7f6f`、`#4a6f45`、`#6a5599`、`#c2557f`、`#a97526`、`#9b3b4f`。自定义六位色 `#rrggbb` 的深色提升只用 `round(v * .78 + 255 * .22)`，例如 `#2b7fb8` → `#5a9bc8`；最终用白/深墨中对比度较高者作 `*-ink`。正文至少 4.5:1，大字至少 3:1，必须在最终底色（含透明、渐变、插画）上复核。

材质色只作底、边、金线、印章或小标题，并掺入 `--accent`，例如 `color-mix(in srgb, var(--accent) 26%, #7e1a32)`；正文始终用经过验证的 `*-ink`。固定方向可参考：酒红底 20–30%、纸底 6–12%、暖金/朱红小件 20–40% accent。

## 5. 当前档位事实（不要把设计写成开关）

消息框 `card`、`cinema`、`hud`、`scroll`、`velvet` 是已接通的五个引擎档，生产层按 `html[data-dialog-style="..."]` 消费。ATRI 不是 `data-dialog-style="atri"`：ATRI 的唯一启用方式是省略 `data-dialog-style` 与菜单属性；若设置层展示 `atri`，渲染时也必须归一化为移除属性。

开始菜单当前只有 ATRI 结构（`.title-screen`、`.atri-menu`、`.atri-item` 等）。M1–M5 是尚未接线的设计参考，仓库没有 `data-menu-style`、`menuStyle` 或 `dialogStyle` 的剧目写入口；不要在 `play.json`、`theme.css` 或素材文件中写这些属性，也不要声称可以成对选择。

## 6. 引擎参考与自查

引擎维护者接线时，五档消息框应检查 `.theater-dialog`、`.dialog-name`、`.dialog-text`、`.dialog-foot`、`.dialog-options`、`.quick-btn`、`.quick-sep` 的深浅值；浅色用实底，深色可用玻璃。具体尺寸、断点和 `html[data-dialog-style]` 生产规则只能改引擎 CSS，不能落盘到剧目主题。

交活前确认：主题文件只有上述令牌与允许的两种根选择器；未写 `--accent-soft`；浅深主色和表面都实际看过；正文、选肢、弹窗、名牌对比度合格；材质色不吞文字；390px 左右没有内容溢出。焦点/hover 自查要覆盖开始菜单、五档消息框、快捷按钮、选肢和弹窗：只用 `:focus-visible`，检查 `:hover:not(:disabled)`、`:disabled` 与 `.quick-btn.tgl-on` 激活态，激活态须显式声明 `color`；所有 `transition`/`animation` 时间值带 `ms`/`s` 单位，并检查 `prefers-reduced-motion`。
