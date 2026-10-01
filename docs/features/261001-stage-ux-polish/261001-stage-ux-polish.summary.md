# 舞台体验 14 条 · 交付小结

分支 `feat/stage-ux2`。这一轮是一次纯体验修订：用户实际操作一遍演出流程后提了 14 条，
逐条落地。多数是界面与提示层，实质性的协议/状态机改动只有两条（阅读位置、语音合成中）。

## 14 条与落点

| # | 诉求 | 落点 |
| --- | --- | --- |
| 1 | 语音生成中要有标志 | 新增 `audio_pending`（core 协议）+ `VoiceDirector.pendingPhrases` 三态机 + `.dir-btn.voice-pending` 闪烁 |
| 2 | 选项/自由发言立刻显示成消息 | `StageScreen` 的 `echo` 回声：发话瞬间先把这句话顶进对话框，播放头一动就交回真实内容。**台词条要回声优先**——初版写成「有当前行就显示当前行」，停止点上上一句正是当前行，屏幕上根本看不到回声 |
| 3 | 阅读进度真实保存 | `read` 上行 → `Orchestrator.readPos` → `session.json` → `hello.readPos` → 播放层 seek |
| 4 | 选项遮罩不遮 sidebar 展开键 | `.side-drawer-btn` z-index 3 → 8（压过 `.choice-overlay` 的 6） |
| 5 | 自由输入是一种 option | `StopPanel` 统一选项列表，末尾固定一张「自由输入」ghost 卡；模态窗恒可关 |
| 6 | 缺分岔按钮 | 导演栏第四个动词键 `fork`（`forkTo(nodeId)`，不 resume = 停下来等玩家） |
| 7 | 文案改技术表述 | 「插一轮」→「提示词」、「重来」→「重新生成」；四个动作的文案集中在 `ACTION_META` |
| 8 | 「点击舞台继续」→「继续生成」 | `StageTheater` |
| 9 | DSL 出错回灌给模型 | parser 告警 → `describeBeatWarnings` → `renderBeatWarnings` 拼进下一轮 user 消息 |
| 10 | 非舞台页展开键进标题栏 | `StageShell` 的 `.view-bar-lead`；舞台页仍悬浮（画面上不压东西） |
| 11 | 每轮长度太短 | `prompt.ts` 新增「单轮该写多长」小节（10–25 句 / 500–1500 字）+ 演出契约第 7 条兜底；`DEFAULT_CRAFT` 的「一轮 3~8 行台词为宜」改成同一量级 |
| 12 | 没立绘不裂图、没背景显白 | `Sprite` 的 `onError` 退场；`--stage-bg` 深色 → 白色 |
| 13 | 置灰逻辑说不清 | `editBlock` / `beatBlock` / `forkBlock`：busy 优先于锚点缺失，title 说真实原因；补 `panelReady` 时立刻重拉谱系（修谱系滞后 2.5s 导致的误灰） |
| 14 | 生图接 flow2api | 代码路径本就完整（`Flow2ApiImageGen` + 别名铁律）；实机验通并把 `.env` 切过去 |

## 两条实质改动

### 阅读位置（#3）

链路：`usePlayback` 播放头推进 → `onRead` → `StageScreen` 防抖 1s → `sendRead` → WS `read`
→ `transport` → `Orchestrator.setReadPos` → 防抖 1.5s 后 `persist()` → `hello.readPos` →
`usePlayback({resumeAt})` 在首次快进时 seek。

三个必须记住的点：

- **锚点是 `ScriptLine.seq`**，即 `say_start` / `narrate_start` / `thought_start` 的事件 seq，
  与谱系节点 payload 同尺，跨 rebase 稳定。
- **只补到那一行的视觉**。位置之后的换景 / 退场属于还没读到的内容，提前生效等于剧透。
- **换代即作废**。分岔 / 重写后 epoch 自增，旧 seq 属于另一条世界线，`resetToken` 变化时
  `resumeAtRef` 清空。老档没有 `readPos` 字段 → 退回「快进到本轮末尾」的老行为。

### 语音合成中（#1）

`audio_pending` 解决的是一个具体的歧义：**「正在生成」和「这句没配音」长得一模一样**，
玩家没法区分。合成失败时服务端只打一行告警、没有任何消息回来，所以客户端自己带
45s 上界熄灯（`PENDING_TTL_MS`）。

## 每轮长度（#11）

病根不在系统提示词，而在 `DEFAULT_CRAFT` 里那句「一轮 3~8 行台词为宜」——它就是用户说的
「默认指导」。改了三处：

1. `DEFAULT_CRAFT`：3~8 行 → 10~25 句（500~1500 字），并写明朝下限理解。
2. 系统提示词新增「单轮该写多长（硬要求：默认写长）」：量 / 质 / 收束 / 与创作口径的关系 / 自检。
3. **演出契约**（不可改那段）第 7 条再钉一次「一轮至少 10 句」。

第 3 条是必需的：创作口径是用户与工坊都能改的文件，长度规则只写在一般性建议里会被它压过去。
真链路实测：改前 6 句 / 257 字，改后两轮 14 句 / 604 字、14 句 / 767 字。

## 顺带修掉的既有缺陷

- `apps/server/src/orchestrator.ts` 的 `finishBeat` 里 `this.busy` 被误写成 `this.beusy`（无限递归）。
- `apps/web/src/stage/StageTheater.tsx` 里 `Sprite` 的返回类型从显式 `ReactNode` 改成隐式。
- `VoiceDirector.hasVoice` 被 `voiceState` 取代后成了死代码，删掉。

## 生图后端（#14）

`STAGE_IMAGE_BACKEND=flow2api` 已写进主仓库 `.env`（gitignored）。选它的原因很硬：
cpa 网关上**没有 `gpt-image-2` 这个模型**（142 个模型里与出图相关的只有
`gemini-3.1-flash-image` / `Qwen-Image-Edit` / `seedream-5.0-flash`），默认值必然 404。
flow2api 另有画幅与垫图（角色一致性）两项 cpa 给不了的能力。

画幅只有 **16:9 / 9:16** 可靠：`3:4` / `4:3` 会被上游静默改成横图且**不报错**
（2026-09-29 实测，`imageSize=2k`）。单图实测约 130 秒。
