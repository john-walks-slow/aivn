# 手机端剧目库封面被压成一条 排查

**状态：已定位并修复（`fix/mobile-home`）。** 2026-10-01 用户报告。

## 现象

手机上打开首页（剧目库），每张作品牌的封面变成一条十几像素高的细横条，看着像「图片没显示出来」；同一页面在桌面模式/宽屏下正常。用户原话：「首页在手机上布局有问题，图片都显示不出来」「我试了开桌面模式就显示出来了」。

图：`evidence/01-before-phone.png`（412×839，修复前）。

## 根因

`.library-grid` 同时是**定高滚动容器**和**网格**：

```css
.library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(246px, 1fr));
  align-content: start;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
```

它的行是 auto 行。**网格容器高度确定、内容又装不下时，auto 行会被压缩到 min-content 去迁就容器高度**——这是 track sizing 干的事，`align-content: start` 拦不住，它只管剩余空间怎么分配。

手机上单列排 4 张牌，内容自然高度 1427px，网格容器只有 704px：

```
(704 - 48 padding - 60 gap) / 4 = 149px   ← 每行被压到 149px
```

浏览器实测：`gridTemplateRows: "149px 148.984px 148.984px 149px"`。

卡片被压到 149px 后，封面 `.card-cover` 作为列向 flex 子项还会继续被压（`flex-shrink: 1`），最终只剩 16~39px：

```
covers=[16,36,39,36]  cards=[149,149,149,149]  scroll=704/704   ← 修复前
```

`scrollHeight === clientHeight` 是关键证据：内容根本没溢出，全被压进一屏了，所以连滚动都没有。

桌面 1280 宽时 4 列 1 行，内容装得下，所以不触发——这正是「开桌面模式就好了」的原因，与访问方式、缓存、代码新旧都无关。

## 修复

```css
grid-auto-rows: max-content;
```

把行高钉死在内容高度，装不下就滚动。修复后：

```
covers=[213,213,213,213]  cards=[345,325,323,325]  scroll=704/1427   ← 修复后
```

213px ÷ 378px = 1.78，正是 16:9，封面回到应有比例。

## 同一个坑的另外两处

`.picker-grid` 早就写了 `grid-auto-rows: min-content`，说明这个坑此前已经踩过一次。另有两处「定高滚动容器 + 网格」没写，实测强制内容溢出时同样塌陷：

| 位置 | 强制溢出时 | 现状 |
|---|---|---|
| `.cg-grid`（CG 视图） | 行塌到 24px，卡片全部被 `overflow: hidden` 裁切 | 当前 demo 只有 2 张 CG，装得下，所以没暴露 |
| `.saves-list`（周目页） | 行塌到 61px，卡片全部被裁切 | 周目数少时装得下 |

两处都加了同一条属性。二者在内容装得下时行高本就是内容高度，所以对现有渲染零影响，只在原本就已经坏掉的溢出场景生效。

## 验证

- 静态：`tsc --noEmit` 0；web 62 例全过。
- 实机尺寸（Chromium 移动仿真，真 UA + touch）：Pixel 7 412×839、iPhone 13 390×664、360×740——封面比例均 1.78，卡片无裁切，网格可滚，无横向溢出，懒加载图到滚动到底时全部补上。
- 回归：桌面 1280×800 修复前后完全一致（行 275.156px、封面 142px、卡片 275px、不滚动）。
- 极端内容：标题与前提各复制数十遍，行高随内容涨到 371px，无裁切。

证据图：`evidence/02-after-phone.png`、`03-after-phone-scrolled.png`、`04-after-desktop.png`。
