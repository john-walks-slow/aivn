# 检视报告

## 概要

本次检视覆盖计划文档、实施总结及本次列出的 core / agent / stage / web / server 变更，重点检查 `buildPageView` 分页投影、`novel` / `nvl` 渲染接线、主题切换、纯文本素材配置和提示词闭环。整体实现已形成从主题选择到舞台连续段落流的完整链路，现有测试也覆盖了主要换景、打字机截断和回看场景。

## 需求对齐

总体满足计划：新增 `novel` / `nvl` 两档主题，舞台返回 `PageView`，同场段落累积、换背景 / `clear` / 标题分页，页末嵌入选肢，并补齐 `craft.assets.background = "off"`、工坊提示词和技能文档。

与计划相比，仍有两点边界没有被测试或完全表达：

- `buildPageView` 的测试覆盖了换背景和回看，但没有覆盖纯色场、无 `bg` 的 `clear` 换页、标题作为首个分页边界，以及换景后页眉场景名的清空语义。
- 新增标题菜单样式仍使用 `:focus` 选择器；项目级 UI 约定要求键盘焦点使用 `:focus-visible`，并避免鼠标点击后留下键盘式焦点反馈。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | [packages/stage/src/playbackState.ts:231-247](../../../../packages/stage/src/playbackState.ts:231) | 分页状态用 `currentBg: string | null` 同时表示“还没有背景”和“当前场景没有背景”。因此纯文本剧本先用无背景场景，再通过 `<scene bg="...">` 切到首张背景时，`bgChanged` 不会触发翻页；`<scene clear="true">` 且不带 `bg` 时也不会更新 `scene`，页眉可能继续显示上一场的背景 id。计划明确把 `clear` 作为分页边界，且 `novel` 页眉应反映当前页。 | 将“是否已有场景”与 `currentBg` 分离（例如维护 `hasScene` / 当前场景 token），对任意已存在场景到新背景的转换判定边界；`clear` 后显式清空或更新页眉场景值。补充无背景 `clear`、无背景→有背景、纯色 `black/white` 场景的单测。 |
| S2 | [packages/stage/src/stage.css:4295-4315](../../../../packages/stage/src/stage.css:4295) 与 [packages/stage/src/stage.css:4747-4749](../../../../packages/stage/src/stage.css:4747) | `novel` / `nvl` 在有选肢时通过 `.theater-stage::after { display: none; }` 去掉画面暗遮罩，但页内选肢本身使用透明渐变；在高亮背景或浅色分支下，选肢可读性完全依赖各背景图，缺少统一的对比度保障。当前样式虽然有边线和主题色，但没有对“底图最亮区域”提供不透明阅读底。 | 保留页内布局，同时给选肢容器或每个选项增加足够不透明、随深浅主题切换的底色，或只关闭旧的画面遮罩而保留一层局部页末阅读纱。用亮背景、暗背景、浅色主题各检查一次选项文字对比度。 |
| S3 | [apps/web/src/app.css:7843-7844](../../../../apps/web/src/app.css:7843) 与 [apps/web/src/app.css:8020-8021](../../../../apps/web/src/app.css:8020) | 新增 `novel` / `nvl` 标题菜单把 hover、键盘焦点都写成 `:focus`。鼠标点击菜单后浏览器仍可能保留焦点态背景 / 左边线，和项目约定的“焦点环只走 `:focus-visible`、鼠标不显示键盘反馈”不一致，也会使纯文字菜单在触摸设备上留下选中样式。 | 将键盘专用规则改为 `.atri-menu.is-keyboard .atri-item:focus-visible`，普通交互保留 `:hover`；必要时补通用 `:focus-visible` 环而不是静置 `:focus`。同步检查浅色 / 深色两套 novel 与 nvl 规则。 |
| S4 | [packages/stage/src/playbackState.test.ts:51-170](../../../../packages/stage/src/playbackState.test.ts:51) | 当前单测覆盖了典型背景切换，但没有覆盖计划中最容易出错的分页边界组合：`clear` 无背景、`title` 首页、纯色背景和当前行仍在流式增长时的场景页眉。测试名和实施总结容易给出“分页规则已完整锁定”的印象，后续改动仍可能回归这些边界。 | 增加小型表驱动用例，至少断言 `pageNo`、`scene`、entries keys 和当前行截断；特别验证 `<scene clear>` 后上一页段落不会与新页混合。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | [packages/stage/src/playbackState.ts:297-321](../../../../packages/stage/src/playbackState.ts:297) | 回看时 `rawEntries` 仍包含当前播放头之前的整段 transcript，再按目标页过滤。因此回看到同一页较早行时，后续同页已读段落仍会显示在目标行之后。这可能是“保留整页上下文”的有意设计，但会让玩家看到回看位置之后的文本，和“当前句聚焦 / 回看”直觉略有冲突。 | 明确产品语义：若回看应严格避免剧透，按 scrub 位置截断 entries；若要保留整页上下文，在 UI 或计划文档注明这是同页上下文，并考虑隐藏目标行之后的段落或给回看态更明显的标记。 |
| N2 | [packages/stage/src/director.ts:581-612](../../../../packages/stage/src/director.ts:581) | `Playback.page` 被声明为可选，虽然 `usePlayback` 当前总会返回 `page`，StageTheater 也保留了无 page 的兼容回退。该兼容层让宿主类型无法表达“新接口必定提供 PageView”，也增加了两套投影逻辑长期漂移的可能。 | 若共享包的协议已经升级完成，将 `page` 改为必选并删除 StageTheater 的 fallback；若必须兼容旧宿主，给兼容原因和淘汰条件留一条明确注释或版本边界。 |
| N3 | [packages/stage/src/StageTheater.tsx:1155-1175](../../../../packages/stage/src/StageTheater.tsx:1155) | 页眉与 Scene Plate 直接展示 `pageView.scene` / `bgAssetId`。对纯色背景、`clear` 场景和场景没有 id 的剧本，用户可能看到内部素材 id 或通用 `CHAPTER`，文学向书页的场景标题感会不稳定。 | 让页眉展示优先级统一为显式章节 / 场景标题，其次是素材可读名，再回落到“CHAPTER”；对纯色与无背景场景提供稳定的空场 / 章节文案。 |

## 准入结论

**结论**：`条件准入`

**说明**：未发现阻塞合并的问题，主题、舞台渲染、配置和提示词链路已基本闭环。建议在合并前处理 S1 的无背景场景分页语义，并按 S3 修正键盘焦点选择器；S2 / S4 可随同一轮 UI 与边界回归一起完成。
