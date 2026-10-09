# 开始游戏与全屏（dsh-aivn）

> 需求（2026-10-09，用户提出）：
> 1. aivn 舞台界面左上角添加全屏按钮
> 2. 新会话需要有手段直接进入 aivn tab
>
> 迭代（同日，用户看完第一版后）：入口改到**剧作家 chip 右边**、改名**「开始游戏」**、
> **点下去就发 START 并进 AIVN 页**；全屏键**不要蓝字**。
>
> 实施：`dsh-aivn` 仓库 master 工作树（未提交）。
> 套件：`entry`（新写，11/11）、`stage`（回归，14/14 + 5/5）。

## 要解决的问题

**全屏**：舞台上一直只有「HIDE」（净画面）与浏览器自己的 F11。手机上没有 F11，浏览器地址栏与
状态栏白占一块，看戏时画面被压掉一截。AIVN app 那边早就有一枚全屏键（`StageScreen` 的
`expand`），DSH 插件这一版从来没做过。

**新会话进舞台**：AIVN tab 只挂在**会话头部的页签列**上，而 DSH 对「已创建、已选中、一条消息
都没发」的会话**根本不渲染页签列**。于是第一次玩的人面对的是：新建会话 → 选「剧作家」→ 一块
空白 Hero 屏 + 一个聊天输入框，**没有任何东西告诉他这里有舞台**。他得先盲发一句话，页签列才
冒出来，才看得到「AIVN」。

## 调研结论（决定了做法）

两条都是 DSH 的墙，不是插件这边的取舍。都在打包产物里读过、并在真浏览器里实测过
（`node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`）：

| 事实 | 证据 |
| --- | --- |
| 空白会话不渲染页签列 | `blank = session === undefined \|\| session.blank && conversationPhase(...) === 'blank'`，页签条件 `showTabs = !hideChrome && tabs.length > 1` |
| 空白会话的 view 区也返回 null | `if (session.blank && conversationPhase(session, conversation) === "blank") return null;` |
| 「空白」按 `session.blank && phase === 'blank'` 判，**不是**只看有没有 sessionId | 同上；`phase` 的 active 岔口还有 `activeTargets.size > 0` |
| **没有公开 API 能切 view** | `setView` / `openView` 是 `ui-conversation` 私有的 per-session store action（`createConversationStore`，`persist: "dsh.conversation"`），只经 props 发给 `conversation.session.header` 这个槽的占用者，**不在包的 client index 导出** |
| `ctx.conversation` 够不着 | 它只有 input / blocks / send / updateQueue / cancel / loadOlder |
| `uiConversation.binding(id).activate(target)` 不是切页签 | 它激活的是**数据 target**（`activeTargets`），不是页签选择 |
| 页签选择**会持久化** | 点一下页签后 `localStorage["dsh.conversation.<会话>"] = {"view":"aivn-stage",...}`，刷新后仍停在舞台（实测） |

**第一版的判断错了**，值得记下来：当初认为「空白会话上点按钮不可能显示舞台」，因为 view 区在
blank 期返回 null。这只说对了一半——**view 区是在等 `conversationPhase` 变 active**，而
`activeTargets.size > 0` 或**会话不再 blank** 都会让它 active。第二版改走「点下去自己发一条
`START`（= `play.json` 的 `opening`）」这条路：那条消息一到会话里，`session.blank` 就翻了，
页签列与 view 区**同时**到位——于是「发消息 → 切页签」这一串是**可靠的**，不必赌渲染时机。
第一版「点一下只记个意图、改口『说句话就进舞台』」被用户退回，正是因为它把本来能一步做完的事
拆成了两步。

DSH 的社区提案 [#5192](https://github.com/deepseek-ai/deepseek-harness/discussions/5192)
正是在问「插件如何切 view」，维护者给的两个方向（暴露 details 控制服务 / 把 select 动作转发给
owner）都还没落地。现有插件（dsh-zen、dsh-view-manager）一致走 DOM 点击。

**结论**：需求 2 只能用 DOM 接缝做——「发消息」那半边是干净的产品能力，「切页签」那半边只能点 DOM。

## 做了什么

### 1. 舞台左上角全屏键（`src/client/fullscreen.tsx`）

- 目标元素是**舞台视图那一层**（`.aivn-stage-view`），不是里面的 `.theater`——后者只是画面那
  一栏，全屏它会把台词条留在屏幕外。
- 两档：**原生全屏**（`Element.requestFullscreen`，Chrome / Firefox / Android Chrome）与
  **CSS 伪全屏**（`position: fixed; inset: 0`，给 iPhone Safari——它至今不支持元素全屏，
  只有 iPad / macOS 的 Safari 支持）。不是取舍，是该平台给得出的上限。
- 状态只有一处真相（`document.fullscreenElement`），`fullscreenchange` 把按钮自点、浏览器 Esc、
  别的脚本三条路收敛到同一份状态；CSS 档没有浏览器事件，Esc 自己接。
- 字形自己画（十行 SVG），没动 `@aivn/stage` 的图标表：那张表只有「放大」（`expand`，AIVN app
  拿它当「看全树」），没有配对的「缩小」。为这一枚去改兄弟仓库，等于让从源码构建的人多背一处
  跨仓依赖。
- **迭代：去掉了已全屏态的主题色。** 第一版给 `.aivn-fullscreen.on` 上了 `color: var(--accent)`
  （冷蓝）——而字面此刻已经写着「退出全屏」，颜色是多余的一层信息，用户直接问「为啥是蓝色字」。
  去掉它，只留字面这一个状态出口。

### 2. 新会话上的「开始游戏」（`src/client/stage-entry.ts`）

- 位置：挂在 `[data-slot="conversation.hero.agentPreset"]` 的**后面**——宿主 Hero 那行画的就是
  座位 chip 上的预设名，于是读起来是「剧作家 ▾ 开始游戏」。用 `data-slot` 这个稳定钩子认位置，
  不认哈希类名；也**不是**去 register 那个槽——它是 `single` 的，真去注册会把宿主的预设选择器顶掉。
- 按一下做三件事：把 `opening` 投给剧作家（走舞台「开演」**同一条** `POST /aivn/input`，
  落点仍然只有宿主那一个）→ 那条消息让会话不再 blank、页签列与 view 区一起到位 →
  点一下 AIVN 页签。页签可能比渲染晚一步，所以最后这一步交给 MutationObserver 等它出现
  （等多久有上界，见 `ARM_TTL_MS`）。
- 只切一次：兑现即消账。之后手动切回 Chat 不会被抢回来；页签点中之后选择由 DSH 自己持久化。
- 只对**剧作家预设**的会话出现。

两个实测踩到的坑，都写进了代码注释：

1. **页签列与那一格不在同一棵子树里**（`slot.parentElement.contains(tabs)` 为 false）。第一版
   盯直接子节点，能过纯粹是因为那一行恰好在同一刻也在重画；改成盯公共祖先的 subtree 才确定。
2. **观察整个 body 的那一档不能常驻**：它是给「还没有 Hero 可盯」的装载期用的，而会话正文每帧
   都在长——长期挂着就是白烧 CPU。改成只有在「当前确实没有会话」时才订。

## 验证

| 套件 | 结果 | 覆盖 |
| --- | --- | --- |
| `entry`（新写） | **11/11** | E1 搭台助手会话上不出现；E2/E3 空白剧作家会话上摆着「开始游戏」且是那一格的**紧邻兄弟**（坐标 + DOM 双判）；G0/G1 读到开局指令、按得下去；G2/G3 按一下就落到舞台、选中的页签是 AIVN；**G4 START 真的投给了剧作家——判据取会话日志里的玩家消息，不是看 HTTP 响应**；F1 全屏键在左上角（离左 10px、上 8px）；F2 全屏元素**就是舞台那一层**；F3 再按还原 |
| `stage`（回归） | **14/14 + 5/5** | 舞台挂载、导演栏三格、台词上屏、停止点、选项回执、开局指令补送 |

G4 是这一版的要点：只断言「页面切到了 AIVN」会漏掉「消息其实没发出去」——那条也能让页签
自己收拾好（玩家手点）。从会话日志取那条玩家消息，才是「点击真的发送了 START」的证据。

未跑 `style` / `director`（用户要求收敛测试规模）：两者与本次改动无交集（`style` 量的是皮肤令牌
在 `.theater-dialog` 上的计算值，`director` 量的是导演栏与重投影），本次新增元素不碰这两处。

## 有意不做的

- **不动 `@aivn/stage`**（图标表、`StageTheater` 内部）。AIVN app 的全屏键长在 `StageScreen`
  的顶栏里，那一栏没搬进包里，插件这边也没有它的落点——所以这一枚归插件自己。
- **不做「会话一起来就自动进舞台」**（不点按钮也抢）。那会在每次新会话上抢视图，属于对 DSH
  原生行为的越权；现在是「玩家按了才切」。
- **不写 CSS 伪全屏那一档的自动化断言。** Chromium 走的是原生档，CSS 档在 e2e 里不可达；它只在
  iPhone Safari 上生效，属于必须实机确认的残余风险，见 `.validation.md`。
