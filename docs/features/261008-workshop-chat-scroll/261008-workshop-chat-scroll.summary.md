# 261008-workshop-chat-scroll

## 背景

工坊「对话」页进来时停在会话开头。两处原因：

1. 自动滚底只挂在 `messages.length / live / pendingAssets.length` 上——**从别的页签切回对话页、或首次进来时历史正好已经到手**，这三个值都不变，滚动区新挂上来就停在 `scrollTop = 0`。
2. 原先只要内容一变就无条件吸到底（`el.scrollTop = el.scrollHeight`）：往上翻着读历史的人，会被助手吐出的每一个字拖回底部。也正因为无条件下拽，单独加一个「回到顶部」键是没用的——刚点上去就被下一段增量拽回来。

## 实现

### 滚动（`apps/web/src/workshop/WorkshopPane.tsx`）

`atTail` 是对话页滚动的唯一状态，由滚动区的 `onScroll` 按几何算出来（离底 ≤ `TAIL_GAP` 24px 即算贴着底）：

- **吸到底**（`stickToTail`，同时把 `atTail` 置真）：进对话页 / 切会话（`useLayoutEffect`，`[tab, state.activeId]`）、自己发话（`submit`）。走 layout effect 是为了别让人先看见会话开头、再被拽下去。
- **跟着长**（`useEffect`，`[atTail, messages.length, live, pendingAssets.length]`）：只在贴着底时跟。人往上翻过就松开——正在读上文的人不该被新一行拖走；滚回底部则自动恢复跟随。
- **回到顶部**：离开底部时右下角浮出 `.chat-top-btn`（`scrollTo({ top: 0, behavior: "smooth" })`），贴底时不渲染。

滚动区外面多包一层 `.chat-scroll`（`position: relative`）只给这颗键当定位锚点，让键浮在滚动区上而不跟着内容滚走。

### 样式（`apps/web/src/app.css`）

`.chat-top-btn` 走**纸面令牌**（`--panel` / `--line` / `--ink-soft`），不是舞台那套 `--dialog-*`：后者是舞台主题的玻璃令牌（默认深色，只被 `html[data-stage-theme="light"]` 覆盖），工坊跟的是界面主题 —— 第一版用它，浅色界面上浮出一颗深色圆点。

## 测试

`apps/web/test/workshopChatTail.test.tsx`（jsdom，6 例）：jsdom 不做布局，把「内容比视口高」按数值摆在 `Element.prototype` 的 `scrollHeight / clientHeight / scrollTop` 上（含浏览器那样的夹取），页签来回切换后新挂上来的滚动区一样算数。

- 会话到手即落底、贴底时不摆「回到顶部」键；
- 从别的页签回到对话页同样落底；
- 贴底时内容长高（流式增量、图解码）继续跟着走；
- 往上翻过之后新一行不再拽人、露出「回到顶部」键；
- 「回到顶部」滚回开头（`{ top: 0, behavior: "smooth" }`）；
- 自己发的话一定看得见：翻上去过也吸回底部。

去掉本次逻辑后 6 例中 3 例转红（另 3 例是旧行为本来也满足的），确认用例咬得住。

## 实机验收（Chromium，420×820，stub 剧目）

脚本 `e2e/chat-scroll.mjs`（用法 `pnpm e2e:chat-scroll <web 地址> [输出前缀]`，已收拢到集中 e2e 目录）的实测值：

| 步骤 | `scrollTop` | 离底 | 「回到顶部」键 |
| --- | --- | --- | --- |
| 进入工坊对话页 | 3784 | 0 | 无 |
| 手动上翻到 400 | 400 | 3384 | 有（32×32，右下角） |
| 点「回到顶部」 | 0 | 3784 | 有 |
| 切到「剧目」再回「对话」 | 3784 | 0 | 无 |

浅色与深色界面主题下各截一次，按钮底色分别是 `rgb(255, 252, 245)` / `rgb(32, 28, 25)`，跟着主题走。

## 取舍

- **没有做「回到底部」键**：滚回底部即自动恢复跟随，另加一颗键属于冗余。用户需求也只要「回到顶部」。
- **没有监听图片解码补滚**：贴底时内容长高由后续增量（或下一次 `messages` 变化）补回底部；进页面那一瞬的图未解码导致的几十像素偏差属于可接受残余，改前同样存在。
- 修改范围小（约 30 行组件逻辑 + 30 行 CSS + 测试），按 `workflow-implement-review` 第 3 步的豁免条款未再走独立 reviewer。
