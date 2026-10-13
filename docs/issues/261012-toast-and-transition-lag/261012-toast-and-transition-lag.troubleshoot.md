# 问题排查：页面跳转与新开局时过多的 Warning Toast 及动效迟滞

## 1. 现象描述

1. **过多的 warning toast**：在剧目中进行跳转（如路线树中点击跳转、顺着原路继续、重写、开新分支等操作）或进入游戏/重新开始时，屏幕顶部频繁弹出警告样式的浮层 Toast（例如「顺着原路继续」、「已跳到这里」、「重写这一段」、「已从此处开新分支」等）。
2. **新开局时动效迟滞与旧状态残留**：当在标题画面或路线树重新开始（或新分支重建）时，先播出了上一段剧情的退场动画（如立绘退场 `.leaving`、或旧背景转场 `.bgTransition` / veil 黑白屏过度等），视觉上出现明显的动效迟滞和跳变。

---

## 2. 根因分析

### 2.1 Warning Toast 泛滥根因

代码链路追踪：
1. 服务端 `orchestrator.rebaseAt(...)` 在发生分支切换或跳转时，会广播 `rebase` 消息，并在其中附带了一段文字说明 `note`：
   - 顺着原路继续：`this.rebaseAt(endId, "顺着原路继续", ...)`
   - 路线跳转：`this.rebaseAt(nodeId, "已跳到这里", ...)`
   - 分岔：`this.rebaseAt(nodeId, "已从此处开新分支", ...)`
   - 重写：`this.rebaseAt(nodeId, "重写这一段", ...)`
   - 剪枝：`this.rebaseAt(leafId, "剪掉这一段", ...)`
2. 前端 `apps/web/src/views/StageScreen.tsx` 的 `onRebase` 回调中（Line 256）：
   ```ts
   onRebase: ({ note, playFrom, resumeAt, busy: streaming, keepView }) => {
     ...
     if (note) pushToast(note, "warn");
   }
   ```
   **直接将服务端下发的操作说明 `note` 无差别以 `"warn"` 级别的 Toast 弹出给用户**！
3. 本质上，这些 `note`（「顺着原路继续」、「已跳到这里」、「重写这一段」等）只是常规的结构跳转或回放导航操作的正常状态说明，**根本不是任何 warning（警告）或 error**，甚至大部分常规流程下用户主动触发跳转后直接看到画面与文本切换即可，完全不需要在屏幕上挂一个带有黄色感叹号的 warning toast 打扰沉浸感。只有真正的异常（例如判废退回重试：`本轮没有写出内容，已退回本轮开头原样重演一次`，或异常失败）才具备警示属性。

### 2.2 新的开始时「先有退场过渡动画」动效迟滞根因

代码链路追踪：
1. 舞台画面状态 `visual` 是由 `usePlayback` 中的 `cues` 队列驱动的（`packages/stage/src/director.ts`）。
2. 当发生分支重置（`rebase`）、重新开始（`restart` / `new=1`）、跳转（`jumpTo`）或首屏快速快进（`resume`）时：
   - `director.ts` Line 826 / Line 844 会把状态复位为 `setVisual(EMPTY_VISUAL)`；
   - 紧接着在 `useEffect`（Line 848）检测到 `!fastForwardedRef.current && cues.length > 0` 时执行快进重放：
     ```ts
     for (let i = 0; i < cues.length; i += 1) applyVisual(cues[i]!);
     ```
   - 关键问题发生在 `applyVisualCue` / `applyCue` 循环执行历史 cues 时：
     1. **退场立绘残留与退场动画**：
        当历史 cues 中有某角色登场又离场（`<actor leave="fade">`），`applyActorCue` 会给该角色打上 `leaving: true`。在正常演出时，`leaving: true` 配合 CSS `transition: opacity var(--fade-ms)` 播放 220ms 的淡出。
        但是在快进/重置到某一刻（`fastForward` 或 `visualAt`）时，`applyCue` 一路推到最终状态，如果最新状态里有人此前打上了 `leaving: true`，在 `StageTheater` 首次渲染时该组件带上了 `.leaving` 类，或者组件卸载前被挂上了 `.leaving`，导致浏览器立即执行了退场淡出！
        而在 `visualAt`（回看函数）中明确有：
        ```ts
        return { ...visual, sprites: standingSprites(visual.sprites) };
        ```
        `standingSprites` 会过滤掉所有 `slot.leaving` 的角色。而在 `fastForward` 最终形成的 `visual` 里，却没有清理掉已经 `leaving` 的立绘槽位！
     2. **背景与 Veil 转场过度动画残留**：
        循环执行 `applyVisualCue` 时，每遇到一次 `<scene transition="fade">`，就会生成 `bgTransition: { name: "fade", seq: ..., from: ... }`。
        当快进结束时，`visual.bgTransition` 仍然保留了历史中的最后一次转场对象（包含 `from`）以及 `bgVeil`！
        这导致新舞台挂载/重置的第 1 帧，`StageTheater` 渲染出了 `<span className="theater-fade-veil">`（带 `fx-veil` 黑屏动画）以及旧背景+新背景的 `theater-stack` 过渡容器，浏览器在屏幕上播放了上一个场景的过渡淡出和黑幕动画！

---

## 3. 修复方案

### 3.1 Warning Toast 逻辑梳理与精简

1. **区分正常操作反馈与真实警告**：
   - 服务端的普通 rebase note（「顺着原路继续」、「已跳到这里」、「重写这一段」、「已从此处开新分支」、「剪掉这一段」）是正常的交互流向，用户已经在点击路线卡片或导演栏，画面跳转本身就是明确反馈，不应该弹出警告 toast。
   - 只有异常降级/回退提示（如 `本轮没有写出内容`、`判废`、`退回`、或带有错误性质的说明），才作为 warn toast 提示。
   - 或者将正常操作说明从 warning 中摘除，改为不弹 toast，或者仅在需要排障的 debug/console 中输出。

### 3.2 消除开局与跳转时的退场动画/动效迟滞

1. **快进（Fast-Forward）与重置完成后净化视觉终态**：
   - 在 `usePlayback` 的 fast-forward 执行完毕时（无论是 seek 到某处还是快进到末尾）：
     - 清除所有 `slot.leaving` 的立绘（使用 `standingSprites(visual.sprites)`），历史里已经离场的角色不应在新的一幕初次渲染时挂着 `.leaving` 播淡出。
     - 清除 `bgTransition`（转为纯净的静态背景，即 `bgTransition: null` 或 `from: null`），不把历史里的转场黑屏和双层淡化带进新开局的第一帧。
     - 行为词（`action`）与抖动/闪光效果：快进到的终态只保留静态站位，不残留瞬态动画触发序号。
2. **在路由切换或清空重置的过渡期增加防抖/静音标记**：
   - 类似回看模式 `.rewinding` 的处理，在切换剧目或开局（`fresh` / 重置完成首帧）时抑制过渡动效（`transition: none; animation: none`），待稳定挂载后再开启常规演出过渡。

---

## 4. 验收标准

1. 点击「开始故事」、标题页进入、路线树跳转、原路继续、重写分支时，界面顶部不再出现无意义的黄色 Warning Toast。
2. 真正发生错误（如网络断开、生图失败、写不出内容自动回滚等）时，Warning/Error Toast 依然正常提示。
3. 从标题页点「开始故事」或从路线重开新分支时，第一帧干净利落直接切入目标场景，不会先播前一段的立绘退场淡出动画和黑幕转场。
4. 全量自动化测试（`pnpm test`）及相关单测通过。
