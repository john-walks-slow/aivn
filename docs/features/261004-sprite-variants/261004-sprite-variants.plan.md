# 立绘差分：基准可见、常用 chips、批量生成（261004-sprite-variants）

## 为什么

- 素材页生成差分时，参考图选择器被整块藏掉（`canPickRefs = kind !== "sprite" || variant === "neutral"`），界面上没有一个字说这张会拿谁垫图。服务端其实是强制的：非 neutral 的差分恒以该主体的 `neutral.*` 为身份基准，自带别的参考图会被直接拒。
- 差分名要手打；一次只能出一张，出 6 个表情要点 6 次、等 6 轮。

## 改什么

### 1. 差分词表进 core（三处共用的唯一真相源）

`packages/core/src/play/spriteVariants.ts`：

- `COMMON_SPRITE_VARIANTS`：常用差分名（小写 a-z0-9_，与 `assertAssetStem` 同一套合法字符）。
- `spriteVariantChoices(existing)`：常用词 ∪ 该主体已有差分名，去重，标注哪些已有（`{ name, existing }`），按「已有在前、其余按词表序」排。

用处：素材页 chips、`generate_image` 描述里给模型的推荐词（Agent 是第一等消费者，同一套词免得它自己造词）。

### 2. 基准可见（web `ImageGenDialog`）

差分分支（variant ≠ neutral）显示一行只读信息：身份基准 = `assets/sprites/<id>/neutral.png` + 小缩略图。取不到时按服务端的两条分支分别说：

- 该主体一个差分都没有 → 「还没有定妆照：会先自动出一张 neutral，再出这张差分」；
- 已有别的差分但没有 neutral → 「缺 neutral 定妆照，请先单独出一次 neutral」（服务端此刻会拒）。

### 3. chips + 自定义待生成清单（web）

素材页立绘卡片新增「+ 差分」入口 → 对话框进入批量模式：

- chips 取自 `spriteVariantChoices(该目录已有差分名)`，已有的标「已有」（点了仍然可以重出，就是覆盖）；
- 输入框回车/逗号追加自定义词，重复的忽略；清单可单条删；
- 取景 / 体量 / 名牌三个声明对整批生效。

### 4. 批量提交：前端扇出，服务端协议不动

清单里每个词各发一次 `POST /api/plays/:id/images`（沿用单张端点）。并行数由**既有闸门** `image.concurrency`（默认 6）管，不自建队列。每张到货按 `image_result.target` 匹配，对话框里逐行显示状态与缩略图；失败的那几张单独标出，不影响其余。

服务端一行不改：`PlayAssets.generate` 与 `ensureNeutral` 的 `inflight` 去重本来就是为「一批并发出 6 个差分」写的（同 key 复用第一条 promise，6 个差分不会补出 6 张定妆照）。

### 5. Agent 侧：同一份词表（形状不变）

`variant` **不做数组**——工具的出图提示词是模型自己写的，一批共用一个 prompt 只会出成同一张图存好几个文件名；模型要出三个表情就该写三条 prompt、调三次。Agent 侧这一轮只拿一件事：`generate_image` 的 `variant` 描述里列出同一份 `COMMON_SPRITE_VARIANTS`，让模型用的名字与界面 chips、与设计语汇是同一套（它自己造词就等于每部剧一套私有词汇）。

## 不做什么

- 不改服务端 REST 协议（不新增批量端点）。
- 不改 `PlayAssets` 的生成与垫图规则、不改 `ensureNeutral` 的两条兜底。
- 不新增并行度设置（已有 `image.concurrency`）。
- 不碰立绘落位、取景画幅、身份基准这套语义。

## 验收

- 静态：`pnpm -r build` + `pnpm typecheck`。
- 用例（只为会坏的地方写）：core 词表 helper 的合并去重与排序。
- 实机（用户看）：素材页 → 某主体「+ 差分」→ chips 多选 → 一次出多张并在对话框里逐张亮图；以及基准那一行是否说清了「拿 neutral 垫」。
