# 261016-starter-chips

## 背景

工坊「对话」页的空会话只有一行写死的例子（「构思一个充满和风神怪色彩的现代轻喜剧…」）。新会话摆一组随机建议 chip，点一下填进输入框（不代发）；建议也不该只有原创点子——同人创作、改编名著同样是一句话就能开动的起点。

## 实现

### 建议池（`apps/web/src/workshop/starters.ts`）

19 条建议分四类（`original` 原创 / `fanfic` 同人 / `adaptation` 文学改编 / `form` 形式玩法），每条写成用户真会说出口的一句话。`pickStarters(count = 4, random = Math.random)` 先每类各抽一条（一轮里四类都见得到），不够再从剩下的补，最后打乱顺序——否则第一条永远是「原创」。`random` 可注入，只给测试定死结果用。

### 界面（`apps/web/src/workshop/WorkshopPane.tsx`）

- `starters` 是组件状态，初值与「新会话」「切会话」两处一起重抽；建议只在空会话（`messages` 与 `live` 都为空）摆出来。
- `applyStarter(text)` 把整句填进输入框并聚焦，光标用 `requestAnimationFrame` 落到末尾——`value` 要等这一帧渲染完才更新，同步设 selection 会被旧值截短。发不发由用户决定。
- 空态里那行写死的「例如：…」删掉：那正是 chip 的活，同一句已经收进 `original` 组。

### 样式（`apps/web/src/app.css`）

`.starter-chips` 是 flex 换行、居中；`.starter-chip` 胶囊按钮走纸面令牌（`--panel-2` / `--line` / `--ink-soft`），悬停换 `--accent` 描边。整句比标签长，所以 `max-width: 100%` + 左对齐，长句在胶囊内折行而不是溢出。

## 测试

`apps/web/test/starters.test.ts`（3 例）：抽出的四条不重复且四类各一；要的条数超过池子时按池子大小给；换一组随机源得到不同批次。`pnpm --filter @aivn/web typecheck` 通过。

## 实机走查（Chromium，stub 剧目）

| 检查 | 结果 |
| --- | --- |
| 新会话摆出的建议 | 4 条，四类各一（如「从《三国演义》里一个从没上过战场的运粮兵眼里看那场战争」「将《罗密欧与朱丽叶》改写成两家 AI 公司之间的故事」「一家只在雨夜开门的旧书店…」「一部没有台词的视觉小说…」） |
| 点第一条 | 输入框值 = 该句原文，`document.activeElement` 是 textarea，「发送」由置灰变可用 |
| 再点「新会话」 | 换了一批 |
| 390×844 竖屏 | `.starter-chips` 的 `scrollWidth === clientWidth`，页面无横向滚动 |

截图见 `screenshots/`。

## 取舍

- **不做「换一批」按钮**：用户要的是「新会话给随机建议」，没点名的新控件不摆。
- **建议不读剧目**：池子是静态文案，与当前剧目的 premise / 角色无关；要贴合剧目得先有「按前提生成建议」的路子，不在这次范围内。
