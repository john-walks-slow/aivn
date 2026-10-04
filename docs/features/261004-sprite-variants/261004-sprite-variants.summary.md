# 立绘差分：基准可见、常用 chips、批量生成（261004-sprite-variants）

计划与设计取舍见 [261004-sprite-variants.plan.md](261004-sprite-variants.plan.md)。

## 背景

素材页生成差分时，参考图选择器被整块藏掉（`canPickRefs` 只在差分名是 `neutral` 时为真），界面上没有一个字说明「这张会拿谁的图垫」。而服务端是强制的：非 neutral 的差分恒以该主体目录里的 `neutral.*` 为身份基准，自带别的参考图直接拒。用户看得见图、看不见基准，就不知道自己在拿哪张脸当同一个人。

另外两件事：差分名要手打（模型与用户各造各的词），一次只能出一张（出 6 个表情点 6 次、等 6 轮）。

## 改了什么

**差分词表进 core**（`packages/core/src/play/spriteVariants.ts`）

- `COMMON_SPRITE_VARIANTS`：14 个常用差分名；`spriteVariantChoices(existing)`：常用词 ∪ 该主体已有差分，已有的排前面并标 `existing`，两边去重。
- 两份消费者：素材页的 chips、`generate_image` 的 `variant` 描述（模型与用户用同一套词，不再各造一套）。

**基准可见**（`apps/web/src/workshop/ImageGenDialog.tsx`）

- 差分非 neutral 时（批量模式则一进来就说）显示一行只读信息：`身份基准：neutral.png（差分都拿这张定妆照垫图，出来的才是同一个人）` + 34px 缩略图。
- 缺 neutral 时按服务端的两条分支分别措辞：该主体一个差分都没有 → 「会先自动出一张 neutral」；已有别的差分 → 「请先单独出一次 neutral」。新主体（还没有目录）不说不确定的句。

**chips + 批量**（`ImageGenDialog.tsx` / `AssetsPanel.tsx`）

- 立绘卡片新增「差分」按钮 → 对话框进批量模式：chips 多选、自定义差分名回车追加、待生成清单、取景/体量与画面要求整批共用。
- 提交时**整批并发**（一次一张地等受理会把每张的提示词组装串起来白等），每张一张单张请求；并行度交给服务端既有的出图闸门 `image.concurrency`（默认 6）。
- 每张受理后就有一行（受理中 → 生成中 → 亮图），失败的那张单独标红、不拖住其余；每张到货各自刷新素材列表。
- 单张流程（出图 / 重新生成某条差分）保持原样。

**样式**：`app.css` 新增 5 条规则（chips 容器、基准行、批量进度行、错误色），chips 本体复用既有 `.chip-btn`。

## 验证

- `pnpm -r build`、`pnpm typecheck` 通过。
- `packages/core/test/spriteVariants.test.ts`：4 条（已有排前并标 existing、词表不重复、词表外自定义名仍进候选、去重与空白、空目录即整份词表）。
- 实机（dev 实例，真出图）：`cat` 这个主体挑 `smile` + `angry` 两张并发提交，两张同时进「生成中」，约 1 分钟各自到货并落 `assets/sprites/cat/`，对话框逐张亮图；基准行在批量与单张两种模式下都显示正确。证据图在 `e2e-assets/`。

## 检视

`reviewer` 结论**条件准入**（无阻塞）。三条建议修改已改：

- 广播回调按「当前这批」认领 target，别的图完成不再顺手触发父面板 reload（原来只要 `msg.ok` 就刷）。
- 自定义差分名重复输入不再被反手取消（那是在「加入」，取消只会让人以为敲丢了）；待生成清单改成可单条去掉的 chips。
- 批量收束后若还有失败项，主按钮变成「重试失败的 N 张」，只把失败的那几个再发一遍。
- 顺带：`.error-text` 改用既有的主题变量 `var(--dialog-bad)`，不再写死颜色。

一条记为已知边界：一批里同时勾了 `neutral` 与别的差分时，差分可能引用盘上那张旧的 neutral 垫图（扇出没法保证先后）。要换基准就单独重出 neutral 再派差分。

## 遗留

- 服务端 REST 协议未改（仍是单张端点），批量由前端扇出。
- `spriteId` 输入框仍按小写 a-z 校（服务端 `assertSpriteId` 允许大写）——既有行为，本轮没动。
- 实机验证出图落在共享的 `plays/test`（软链到主工作区）：新增 `assets/sprites/cat/` 下若干张，属验证产物。
