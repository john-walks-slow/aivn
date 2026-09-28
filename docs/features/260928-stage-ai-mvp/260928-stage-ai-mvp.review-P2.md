# 检视报告

## 概要

本次检视覆盖 Stage-AI P2 前端批次及配套改动，包含手写 hash 路由、REST 客户端、AssetIndex 资产解析、Director 演出导演（打字机/二段式点击/自动模式）、StageTheater 舞台视觉层、剧目库与 Title 门面、素材配置管理页、PlayConfig 契约跨端迁移及服务端 prompt/http 小改。
整体架构分层清晰，视觉样式严格遵循 plain/clean 浅色实用规范，核心契约迁移完整。但在前端状态机流式响应时序、停止点与演出缓冲解耦、输入框组件焦点管理以及服务端 Zip 解压安全性上存在关键缺陷，须修复后准入。

## 需求对齐

- **舞台渲染（D4 流式播放）**：打字机（35ms/char）、二段式点击快进、自动模式、背景淡入与立绘站位已实现。但**二段式点击与自动模式在流式事件增量到达时存在时序死锁缺陷**；停止点面板未能遵守“演出全部消费完毕后方可淡入”的时序契约。
- **剧目生命周期（D13 就绪门/剧目库/Title）**：剧目卡片展示、就绪门细项检查（premise、角色立绘、背景图）、新建剧目、剧目包导入/导出逻辑基本齐全。但 Zip 导入缺少路径安全防护。
- **素材管理与配置**：支持四大目录素材上传/删除、角色卡及差分映射维护，但存在按键失焦的严重交互问题。
- **P1 遗留代码处置**：`StageView` 已作为只读剧本 log 视图复用，`StopPanel` 正常承接交互，未产生死代码。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B1 | `apps/web/src/stage/director.ts:133-140` | **自动模式在流式事件追加时卡死**：`usePlayback` 中自动推进的 `useEffect` 依赖项为 `[auto, current, lineComplete, cues, consumeNext]`。而 `cues` 是由 `ScriptBuilder` 内部原地变更的稳定数组引用。当某句台词播完但后续 cue 尚未生成到达（流式等待），effect 因 `!next` 返回；随后新事件到达触发 `revision` 自增重渲染，但因依赖项引用全未改变，React 不会重新触发定时器，导致自动模式彻底卡死。 | 将 `opts.revision` 加入自动推进 `useEffect` 的依赖数组（或将依赖改为 `cues.length`），确保新事件到达时能重新评估后续 cue。 |
| B2 | `apps/web/src/views/StageScreen.tsx:37, 81-91` | **停止点过早渲染破坏演出节奏与剧情剧透（违背 §5 D4 契约）**：`busy` 仅判断 `stage.state === "streaming" || stage.state === "connecting"`。当 LLM 迅速生成完毕发出 `beat_end` 后，`stage.state` 立即变为 `"stopped"`。此时前端打字机可能才播到第一句（缓冲队列中仍有大量未播台词），下方选项按钮/输入框却立刻弹出并可用，直接剧透全段结局，且允许玩家在演出未完时提前点击发送新请求。 | 将 `StopPanel` 的呈现与可用状态绑定到播放器的消费完毕状态：仅当 `stage.state === "stopped" && playback.exhausted && lineDone` 时才展示/解除禁用选项面板。 |
| B3 | `apps/server/src/store.ts:205-215` | **剧目包导入存在 Zip Slip 与目录穿越安全漏洞**：`importZip` 中直接读取解压后 `play.json` 的 `play.id` 作为落盘目录名（未校验 `/^[\w-]+$/`），且对压缩包内文件路径 `rel` 未做跳出父目录检查（Zip Slip）。恶意构造的 Zip 文件可向服务宿主任意路径写入文件。 | 1. 对 `play.id` 进行 `/^[\w-]+$/` 正则强制校验；2. 对写入目标执行路径合规校验：`path.resolve(target, rel).startsWith(target)`，阻断一切包含 `..` 的路径穿越。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | `apps/web/src/views/AssetsView.tsx:239-252` | **角色卡表情差分编辑每输入一字即失焦（Focus Loss）**：`CharacterEditor` 将可变的 `expression` 直接作为 React 渲染 `key`，并在 `onChange` 中直接通过 `delete c.sprites[expression]` 修改父级对象键名。每次击键都会导致 DOM 节点被销毁并重新挂载，光标瞬间丢失焦点，严重破坏输入体验。 | 在编辑表单内部使用带唯一自增/随机 ID 的临时数组维护映射项（如 `{ id, expression, file }[]`），React key 绑定稳定的内部 ID，仅在失焦或保存时转换为 Record 对象。 |
| S2 | `apps/server/src/prompt.ts:14-17` | **提示词素材清单与角色卡 `sprites` 映射契约脱节**：`buildSystemPrompt` 中生成角色差分列表时，直接抓取磁盘文件名并去扩展名，完全忽略了角色卡中定义的语义化 `c.sprites` 键名（如 `smile`）。若用户在 UI 配置了差分映射，LLM 却根据文件名输出底层 stem，导致前端 `assets.ts` 表情匹配失效并降级为首图。 | 角色差分 expression 列表应优先采用 `Object.keys(c.sprites ?? {})`；仅在未配置映射时才回退至磁盘文件 stem。 |
| S3 | `apps/web/src/stage/director.ts:169-175` | **`useEffect` 遗漏依赖项数组**：队列排空状态维护的 `useEffect` 完全缺少 dependency array，将在每次打字机定时器触发的 render（35ms 一次）中无条件执行，存在隐性竞态且掩盖状态流转逻辑。 | 补齐依赖项数组，或将 `exhausted` 转为基于 `cues.length`、`cursorRef.current`、`lineComplete` 计算的派生变量（Derived State）。 |
| S4 | `apps/web/src/stage/StageTheater.tsx:59, 73` | **舞台顶栏按钮点击冒泡触发意外台词推进**：`← 标题` 和 `剧本` 按钮未调用 `e.stopPropagation()`，点击会冒泡至外层 `.theater` 的 `onClick={advance}`，导致切屏时错误推进了一句台词。 | 为这两个按钮的 `onClick` 处理函数添加 `e.stopPropagation()`。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `apps/web/src/views/LibraryView.tsx:70` | **`play.premise` 缺少防御性判空**：若历史数据或导入数据缺失 premise 字段，直接调用 `.slice(0, 90)` 会抛出 TypeError 导致剧目库白屏。 | 改为 `(play.premise ?? "").slice(0, 90)`。 |
| N2 | `apps/web/src/views/AssetsView.tsx:55-60` | **素材删除缺乏二次确认**：点击“删除”立即调用 REST 接口删除磁盘文件，无 `confirm` 提示，极易误触。 | 增加简单的客户端确认对话框（`window.confirm`）与操作加载禁用态。 |
| N3 | `apps/web/src/views/StageScreen.tsx:21` | **`replaceState` 剥离查询参数未联动路由状态**：直接操作 `history.replaceState` 剥除 `?mode=` 不会触发 `hashchange`，导致 `useRoute` 内部状态与地址栏短暂不同步。 | 建议在 `router.tsx` 中统一提供带 replace 语义的路由导航方法。 |

## 准入结论

**结论**：`不准入`

**说明**：存在自动播放流式等待卡死、演出未完提前弹出停止点（违背 §5 D4 设计契约与剧透）、以及 Zip 导入任意文件写入漏洞三项阻塞问题，须修复后重新检视。
