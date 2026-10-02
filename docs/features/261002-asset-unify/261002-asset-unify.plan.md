# 生图落盘统一与工具清单统一

> 状态：实施中。目标分支 `feat/dsl-v2`（已变基到 main）。

## 要解决的两件事

**一、`media-cache/` 里混着两类东西。** 站内生成的 bg/cg 落 `plays/<id>/media-cache/img/`，
TTS 音频落 `plays/<id>/media-cache/tts/`，音色目录快照落仓库根 `media-cache/voices.json`。
前者与后者性质不同：前者是**素材**（有 id、有描述、用户在素材页管理、导出剧目包要带走），
后者是**缓存**（按内容寻址、可随时重建、不该进版本库）。同一个目录名下挂两种东西，
于是「站内生成的图不进 git」这条规则实际上是 media-cache 整目录不进 git 的副作用，
而不是一条独立判断。

拆法：**素材归 `assets/`，缓存留 `media-cache/`。** 删掉 `ImageAssets` 这一层，
剧作家的 bg/cg 与工坊走同一个 `PlayAssets`，落 `assets/backgrounds/<name>.jpg` 与 `assets/cg/<name>.jpg`。

**二、工具清单按角色切分。** `TOOL_ROLES` 给每个工具标了 `roles`，剧作家拿不到资源库工具、
`generate_image` 的 schema 还少两个参数。用户要的是：一份清单，两个角色都能开，
剧作家也能搜资源库、也能垫图出 CG；但生图与资源库工具**对剧作家默认禁用**（用户可在 Agent 页打开）。

## 一、拆掉 ImageAssets

### 落点

| 内容 | 位置 | 说明 |
|---|---|---|
| 站内生成的 bg/cg | `assets/backgrounds/` `assets/cg/` | 走 PlayAssets，与工坊同一实例 |
| TTS 音频 | `plays/<id>/media-cache/tts/` | 保留 |
| 音色目录快照 | 仓库根 `media-cache/voices.json` | 保留 |
| 出图 prompt 台账 | `assets/generated.json` | 已有，PlayAssets 写；ImageAssets 那份 manifest 删掉 |

`store.ts` 的 `mediaDir()` / `mediaPath()` / `imageDir()` / `imagePath()` 四条路径方法：
后两条删掉，前两条保留。`http.ts` 的 `GET /plays/:id/media/img/*` 路由删掉，
`/media/tts/*` 保留。

### 改造点

**`playhouse.ts`**
- 不再构造 `ImageAssets`（`playhouse.ts:774-778` 整段删）。
- `helloPayload` 的 `assets` 字段改由 `store.listAssets()` + `ledger()` 合成——
  现在带的是 `images.snapshot()`（协议形态的 `{id, type, url}`），客户端 `useGeneratedAssets` 存下来
  做 `generated` 表。改成静态清单后前端那条路径要一起改，见下。
- `preloadAsset()` 改为直接调 `playAssets.generate({kind, name: id}, prompt)`，
  到货后广播的 `asset_ready` 里 url 换成 `/plays/<id>/assets/<kind>/<file>`。
- `imageTools` 的 `statusOf` / `hasStaticAsset` 两个依赖删掉：`statusOf` 是 ImageAssets 的内存态，
  `hasStaticAsset` 现在 PlayAssets 的 `exists()` 就是同一件事。

**`orchestrator.ts`**
- `imageTools` 从 `{playAssets, images, kick, kickSprite, hasStaticAsset, exa}` 收成
  `{playAssets, kick, kickSprite, exa}`。
- `generatedAssets` 注入 A 区的「已生成的图」清单改读 `store.ledger()`。

**`http.ts`**
- CG 台账的四路并进去掉 `readGeneratedEntries`（`media-cache/img/manifest.json`），
  剩三路：素材描述表、目录扫描、`assets/generated.json`。PlayAssets 写的 ledger
  已覆盖工坊与剧作家的全部出图，删掉那一路不丢东西。

**测试**
- `image.test.ts` 的 `describe("ImageAssets：…")` 整块删掉，其中「同描述不同 id 共用一张图」
  与「不同 id 同描述并发只出一次」两条是 ImageAssets 专属能力，合并后不存在了。
  「剧作家 generate_image：后台排产」那组保留，跟着新落点改。
- `http.test.ts` 的 CG 台账用例改：fixture 不再写 `media-cache/img/manifest.json`，
  URL 断言从 `/plays/p1/media/img/a.jpg` 改成 `/plays/p1/assets/cg/a.jpg`。

### 三处能力取舍

1. **内容寻址去重没了。** ImageAssets 按 `sha1(type+prompt+aspect)` 命名文件，
   同一句提示词生成两次只烧一次配额。合并后是「一个 id 一个文件」，分岔/重演时
   同一句再出一次 CG 会真的重新出图。**接受**——剧作家侧改由 `generate_image`
   工具自己判「剧目里已有同名素材就跳过」（`hasStaticAsset` 的逻辑搬进工具），
   而 ImageAssets 那套静默复用反而让用户不知道自己烧了多少钱。

2. **站内生成的图从「不进 git」变成「进 git」。** `assets/` 在 git 白名单里
   （`plays/*/` 整体 ignore，只有 demo 例外）。对 demo 剧目来说，站内生成的图会跟着进版本库。
   接受——它现在是素材，不是缓存，导出剧目包本来就该带走。

3. **骨架占位的状态判据从内存态改成查盘。** 现在 `statusOf(id)` 返回 `ready/queued/none`
   靠 ImageAssets 的内存 Map。合并后没有内存态了，工具侧改成：
   `playAssets.exists()` 命中 → 已有，跳过；没命中 → 排产。
   「已在队列里」这一档没有对应物，但 `PlayAssets.generate` 的 `inflight` 去重
   保证同一目标并发只烧一份，重复调用会返回同一个 promise。

## 二、工具清单统一

### 一份清单

`TOOL_ROLES` 的 `roles` 字段删掉，改成 `TOOL_CATALOG`（工具 id → label/group）——
两个角色共用同一份，装不装只看用户勾没勾。差异只剩两处，都不是「工具归属」：

1. **默认启用集** `DEFAULT_ENABLED`（`kit.ts` 的常量）：
   - `workshop`: 全部
   - `playwriter`: `beat_done` + 记忆四项 + `web_search`
   （**生图与资源库对剧作家默认关**——用户可在 Agent 页勾上）
2. **装配时的依赖与等待策略**（`generate_image` 的 sync / queued、`files`/`lineage` 依赖面）

`packages/core` 的 `AgentSettings.disabledTools` 改成 `tools`，存**启用集**：

```json
"agents": { "playwriter": { "tools": ["beat_done", "generate_image", "list_library"] } }
```

写启用集而不是禁用集，是因为默认禁用的那几个用黑名单表达时，「用户打开了它」与
「它本来就开着」在文件里长得一样——下次改默认值就会把用户的显式选择一起吞掉。

设置页相应改成「启用开关」，初始态取 `GET /api/agents/tools` 新增的 `defaults` 字段；
`AgentToolEntry` 的 `roles` 字段删除。

`import_asset` 保留在清单里但**对剧作家默认关闭**（多数情况下它用引用即导入就够了，
见第三部分）。两个角色的资源库工具是**同一份实现**：依赖面里的 `onWrite` / `onAsset`
（往工坊对话流推撤销条与素材气泡）改成可选，剧作家侧宿主给空实现——工具照常能用，
只是没有撤销条可点。资源库没配就不注册这两个工具。

### schema 统一

`imageTool.ts` 删掉 `imageParams(withExpression)` 的分叉，两个角色用同一份 schema：
`expression` 与 `referenceCharacters` 都给。垫图读 `assets/sprites/`，与谁调的无关。

`REFERENCE_RULE` 从工坊独占并入共享的 `PROMPT_RULES`——两个角色都拿得到这个参数，
规则就该是共享的，写在工坊那侧等于剧作家那份没修。

### 依赖面

`deps.ts` 的判别联合保留（`PlaywriterKitDeps` / `WorkshopKitDeps` 依赖确实不同），
但 `createLibraryTools` 的 `Pick<WorkshopKitDeps, ...>` 改成 `Pick<KitCommonDeps, "playId">`
加上一个公共的 `assetLibrary`。资源库是应用级只读的，两个角色拿的是同一个实例。

## 三、引用即导入

用户定的方向：不给 agent 一个「导入」动作，而是**在剧本里写 id，宿主发现剧目里没有就去库里找**。

```
<scene bg="moon_rooftop" />     → 库 backgrounds/moon_rooftop/
<cg id="confession" />          → 库 cg/confession/
<actor id="koharu" expression="shy" />  → 库 characters/koharu/
<scene bgm="rain_loop" />       → 库 bgm/rain_loop/ 或 sfx/rain_loop/
<sfx src="door_knock" />        → 库 sfx/door_knock/
```

### 落点：解析管道

`StageDslParser` 在 `packages/core`，纯同步、没有文件系统访问。自动导入必须放服务端。

`PlaywrightOrchestrator.onStageEvent` 是所有 IR 事件进引擎的入口。在那里加一层
`resolveAssetRef(attrs)`：收到 `scene` / `cg` / `actor` / `sfx` 事件时，
把里面的素材 id 交给 `AssetRefResolver`，后者异步查盘、缺则从库里导入。

**不做的事**：不改解析器、不给事件加字段。解析器照旧产出事件，引擎照旧广播，
客户端照旧按 id 解析——客户端的 `AssetIndex` 已经在做「静态清单优先、站内生成兜底」，
导入完成广播一次 `asset_ready` 让客户端把新素材并进 `generated` 表即可。

### 时序

导入是异步的（读盘 + 复制 + 写 manifest）。事件先广播，客户端按现有逻辑解析——
解析不到就降级（背景保持上一张、CG 不显示），这与现在「骨架占位」的表现一致。

导入完成后广播 `asset_ready`（`{id, type, url}`），客户端 `useGeneratedAssets` 存进
`generated` 表并触发重新解码 → 画面到货淡入。**复用现有的到货淡入路径**，
不新增一套。

角色（`<actor id>`）是特例：导入角色会改 play.json（`applyCharacter`），
而拍进行中改 play.json 要排到轮边界。这里同样走现有的 `onPlayConfigChanged` 延迟机制，
立绘文件先落盘（画面这一轮就能用），角色卡排到轮边界重建时生效。

### 找不到怎么办

库里有同 id 就导入，没有就什么都不做（保持现有的降级）。**不给剧作家回话**——
事件已经广播出去了，回一句话要么打断剧本要么变成台词。解析告警走现有的
`ParserWarning` 回灌机制？不行，那条路是给模型自修正用的，而「库里没这个背景」
不是模型写错，是素材真的不存在。静默降级。

### 资源库没配时

`AssetRefResolver` 构造时不传 library 实例，整个机制不挂载。

## 落地清单

```
apps/server/src/imageAssets.ts        →  generatedLedger.ts（只留 CG 页要的那一份台账读法）
apps/server/src/store.ts              删 imageDir/imagePath
apps/server/src/http.ts               删 media/img 路由、CG 台账从四路并成三路
apps/server/src/playhouse.ts          删 ImageAssets 装配、preloadAsset 改走 PlayAssets、挂 AssetRefResolver
apps/server/src/playAssets.ts         加 existingUrl（exists() 现在是它的薄封装）
apps/server/src/orchestrator.ts       imageTools 收窄、事件 switch 接引用解析
apps/server/src/assetRef.ts           新：AssetRefResolver
apps/server/src/agentkit/kit.ts       TOOL_ROLES → TOOL_CATALOG + DEFAULT_ENABLED + enabledToolsFor
apps/server/src/agentkit/imageTool.ts schema 统一、deps 收成 existingAssetUrl
apps/server/src/agentkit/libraryTool.ts 依赖面 onWrite/onAsset 转可选，两个角色同一份实现
apps/server/src/agentkit/deps.ts      assetLibrary 提到公共依赖，disabled → enabled
packages/core/src/play/config.ts      disabledTools → tools（启用集）
apps/web/src/workshop/AgentPane.tsx   禁用开关 → 启用开关
apps/web/src/api.ts                   AgentToolEntry 去 roles、agentTools 返回 defaults
apps/server/test/assetRef.test.ts     新：引用即导入的 8 条
apps/server/test/image.test.ts        删 ImageAssets 组、排产组换新 deps、加 schema 统一与垫图透传
apps/server/test/http.test.ts         CG 台账改走 assets/generated.json
apps/server/test/agentkit.test.ts     目录/默认集/schema 统一
README.md / AGENTS.md                 同步
```

### 提示词瘦身（第二轮，紧跟工具统一）

工具清单统一之后，「工具没装但提示词还在教它」的问题浮出来一次：剧作家默认关了生图，
`imageChapter` 整章跟着消失，但它其实混着三类内容。同时发现两处已经漂移的重复。

| 搬走 | 去处 |
| --- | --- |
| 走函数调用不是文本标签 / id 自取 / prompt 后缀串 / 提前 3–5 句 | `QUEUED_DESCRIPTION` |
| 资源库章节整节（16 行） | `list_library` 的 description |
| `characters/<id>` 路径格式、id 字符集、首行 `# 名字` | `write_memory` 的 description |
| 「引入新角色」里过时的「这个工具没有 expression 参数」 | 删（schema 已统一） |

留在系统提示词里的三类：决策类（什么时候该画一张）、清单类（按描述选素材、没立绘别上台）、
DSL 渲染契约（`action` 八词 / `shot` 四档 / anchor 三档——引擎认这些字符串，工具描述里没有位置放）。

顺带修一个真 bug：工坊提示词里「先查资源库」和「库里已有合适的角色可以 import_asset」两处
**没有按 `canBrowseLibrary` 收条件**——没配资源库时那两个工具压根没注册，提示词却在教它调。

### 跟随 main（rebase 3 个提交）

main 领先的三条里只有 `d63c1f6` 带新代码，而且是 web 侧（排队面板收起成徽标），
不碰提示词层。`6236573` 是纯合并，相对 rebase 前的基线内容无差异。

但 `5bf7083`（AGENTS.md 更正立绘取景表）暴露了一类漂移：它只改了 AGENTS.md，
**README 与源码注释还写着合并前的四档**。一并修掉：

| 位置 | 原文 | 现 |
| --- | --- | --- |
| `config.ts` `CharacterCard.framing` | 取景（bust/half/full） | full/half/square，并点明 bust 会被降级 |
| `config.ts` `spriteFraming` | 举例 `closeup = bust` | 举例换成 full/half 的混合画幅 |
| `playAssets.ts` `framing` 字段 | 取景（bust/half/full） | full/half/square |
| `framing.ts` `SPRITE_FRAMING_LABELS` 注释 | 「出图一律按全身来」 | 出图与摆位一起生效 |
| `README.md` 六处 | 四档表 + 「出图实际只按全身来」 | 三档表 + square 的用途 + bust 降级说明 |

顺带把 `apps/server/vitest.config.ts` 的 `testTimeout` 提到 20s：生图用例要在本机真编
JPEG/PNG 再抠底，5s 默认值是纯抖动源（同一个文件单跑过、并行跑不过），已经逐条
override 过两次，换成改默认值。

## 验证

- `pnpm typecheck`：core / web / server 三个包全过
- `pnpm --filter @stage-ai/core test`：8 files / 116 tests
- `pnpm --filter @stage-ai/web test`：17 files / 110 tests
- `pnpm --filter @stage-ai/server test`：34 files / 414 tests（2 skipped）
  - 新增 `workshopPrompt.test.ts`（3 条，工具知识不在系统提示词里重复）与 `prompt.test.ts` 三条回归护栏

## 遗留与风险

- **内容寻址去重没了**（同 prompt 不同 id 会真出两张图）。已接受：剧作家侧改由工具
  判「剧目里已有同名素材就跳过」，而且 ImageAssets 那套静默复用反而让用户不知道自己
  烧了多少钱。
- **站内生成的图从「不进 git」变成「进 git」**。它现在是素材，导出剧目包本来就该带走。
- **`preloadAsset` 里有一次目录 stat**（为了判断剧目里是否已有同名素材）。命中就跳过
  出图，这是要省的那次配额。
- **角色导入卡在轮边界**：立绘文件先落盘、画面这一轮就能用，但角色卡要等重建才进
  `cast`。用户会看到「有人上台但名牌暂缺」的一两秒。
- `playAssets.test.ts` 里一条要在本机真编 3 张不同画幅图的用例在慢机器上顶穿默认 5s，
  已单独放宽到 20s（与本次改动无关，是机器速度）。
