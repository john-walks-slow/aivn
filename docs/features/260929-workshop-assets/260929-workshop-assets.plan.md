# 工坊生图能力 + 就绪门放开 —— 实施计划

日期：2026-09-29
分支：`feat/workshop-assets`（worktree：`.worktrees/workshop-assets`）

## 1. 问题与目标

工坊 agent 告诉用户「我不会创建素材」。这是代码事实，但它是**实现漏了计划**：D9（`260928-stage-ai-mvp.plan.md:355`）写明工坊工具含 `gen_asset`，P4c 只落了 5 个文件工具（`workshop.ts:137`）。更深的约束是 `PlayFiles` 把 `assets/**` 设为只读（`playFiles.ts:16,39-43`），工坊即便想写图也无处落脚。

| # | 目标 | 验收口径 |
| --- | --- | --- |
| 1 | 工坊能调生图 API 出背景 / CG / 角色立绘，产物落 `assets/` | 说「给澪画张背景」→ 落盘 `assets/backgrounds/xxx.jpg`，对话气泡里能看到图 |
| 2 | 没有图也能开演 | 只有 premise 的剧目，「开始游戏」可点，舞台有可看表现 |
| 3 | （本轮不做）关键词搜网图 | 素材写入通道本身是通用的，将来加搜图只是多一个往通道灌 URL 的工具 |
| 4 | 设定过程多询问、生图前先确认 | 工坊先反问设定 → 给提案 → 确认后写盘 → 列素材清单 → 再确认 → 才生图 |

## 2. 已确认的决策

| 决策点 | 结论 | 理由 |
| --- | --- | --- |
| 生图产物落点 | **静态素材 `assets/`** | 它是剧目定义的一部分，进 git、素材页可管可删、写盘可撤销、就绪门认它 |
| 就绪门 | **只强制 `premise`，图全可选** | 设定能边演边补；缺背景走氛围底色、缺立绘角色不上台，演出不等素材 |
| 角色立绘 | **本轮做，垫图保一致性** | 走本机 flow2api（`/v1beta` Gemini 原生端点）的 inlineData 垫图 |
| 搜网图 | **不做，也不需要专门架构** | 素材写入通道本身是通用的 |
| 生图后端 | **flow2api 与 cpa 双实现可切换，默认 cpa** | 默认值指向本项目自己配置的依赖；本机 `.env` 显式切到 flow2api 拿垫图能力 |

## 3. 架构设计

### 3.1 生图后端：一个接口，两个实现

现状 `ImageGen`（`imagegen.ts`）既是协议实现（cpa `images/generations` / `chat/completions` SSE）又是业务接口，没有垫图概念。抽出接口：

```ts
// apps/server/src/imageBackend.ts
export interface ImageRequest {
  prompt: string;
  /** 画幅（flow2api 走别名模型名解析；cpa 忽略）。 */
  aspectRatio?: ImageAspect;              // "16:9" | "3:4" | "1:1" | ...
  /** 参考图（垫图）：角色一致性靠它，不靠 prompt 措辞。 */
  references?: { mimeType: string; data: Buffer }[];
}
export interface GeneratedImage { data: Buffer; mimeType: string }
export interface ImageBackend { generate(req: ImageRequest): Promise<GeneratedImage> }
```

**`Flow2ApiImageGen`**（新文件 `flowImage.ts`）：`POST {base}/v1beta/models/{alias}:generateContent`，头 `x-goog-api-key`。

- 铁律：**必须传别名**（`gemini-3.1-flash-image`）。传完整模型名时 flow2api **完全忽略** `generationConfig`，画幅被模型名钉死（`model_resolver.py:672`）。
- **别名白名单自校验**：非法画幅/尺寸 flow2api **静默降级不报错**（`model_resolver.py:687-705`）——立绘要 `3:4` 却默默出 `16:9` 会毁角色站位。`createImageBackend()` 启动时对照别名能力表校验配置，写错直接启动失败而不是默默出废图。
- 响应解析**三分支**（`routes.py:655-663`）：正常是 `parts[].inlineData`；网关配置异常时退化为 `parts[].fileData`（只有地址没有字节）；被拒时只有 `text`。后两者给出不同的错误文案，不混为一谈。
- HTTP 用 undici 的 `fetch`（项目全链路一致），`fetchImpl` 构造注入（照 `imagegen.ts:32`），超时 `AbortSignal.timeout`——测试直接注假 fetch，不做全模块 mock。

**`CpaImageGen`**（原 `ImageGen` 改造）：逻辑不变，忽略 `references`（cpa 走文生图）。

配置（`config.ts` 是**手写 interface + `loadConfig` 字面量两处**，无 schema 库，两处必须同改，否则 typecheck 拦）：

```
STAGE_IMAGE_BACKEND=cpa                 # cpa（默认） | flow2api；本机 .env 设为 flow2api
STAGE_FLOW_BASE_URL=http://127.0.0.1:38000
STAGE_FLOW_API_KEY=<你的 flow2api key>
STAGE_FLOW_MODEL=gemini-3.1-flash-image   # 必须是别名
STAGE_FLOW_SIZE=2k
STAGE_FLOW_TIMEOUT_MS=180000
STAGE_IMAGE_CONCURRENCY=2
# 以下 cpa 分支（backend=cpa 时生效）
STAGE_IMAGE_MODEL=gpt-image-2
STAGE_IMAGE_SIZE=1536x1024
```

D6 预发射（`preload_asset`）与工坊生图共用同一个后端实例。D6 铁律其余部分不变；内容寻址指纹从 `sha1(type+prompt)` 扩为 `sha1(type+prompt+画幅)`。

### 3.2 并发闸门：抽出共享 `Limiter`（带优先级）

`ImageAssets` 的闸门是**实例私有**的，生图变成两条来源后各自建闸门会让并发翻倍。抽出 `limiter.ts`：

- `Limiter` 实例**挂在 PlayHouse 上按 playId 存 Map**，用 `limiterFor(playId)` 取。必须如此：`reload` 会重建 runtime 但**复用同一 `WorkshopSession`**（工坊铁律④），若按 runtime 建闸门，存活闭包持旧实例、新 `ImageAssets` 持新实例，并发翻倍——而「工坊每生一张图触发一次 reload」正是最高频的触发路径。
- **优先级**：playwriter 预发射 `high`、工坊生图 `normal`。工坊是人在等的串行对话，一批 3 张能占满闸门 75s；预发射虽不 await（铁律①），但被挤到队尾就等于「提前发射」失去意义。等待队列按优先级取人，同级先进先出。
- **槽位直接转让给 waiter**（铁律⑥）：实测 `max=1` 时，先减 `running` 会让 b/c 重叠超发。`acquire()` 必须在 `try` 之外——否则队列满抛错会触发 `finally` 的 `release()`，凭空发一个槽、计数漂移。
- 现有 `test/image.test.ts` 的「并发闸门不超发」**测不出转让语义**（5 个请求同 tick 抵达，release 微任务间隙无新请求可插队，两种实现都过），必须补一条专门用例。

### 3.3 剧目素材生成层：`WorkshopAssets`

新文件 `apps/server/src/workshopAssets.ts`。与 `ImageAssets` 分工明确：

| | `ImageAssets`（D6，保留） | `WorkshopAssets`（本轮新增） |
| --- | --- | --- |
| 产物落点 | `media-cache/img/` + manifest | `assets/<kind>/<name>.<ext>` |
| 定位 | 运行时锦上添花，内容寻址缓存 | 剧目静态素材，进 git |
| 谁调用 | playwriter 的 `preload_asset` | 工坊 agent 的 `generate_asset` |
| 垫图 | 无（sprite 本就不生图） | 立绘差分用 `neutral` 作垫图 |

落点与画幅：

| target | 落盘路径 | 画幅 |
| --- | --- | --- |
| `background` | `assets/backgrounds/<name>.<ext>` | `16:9` |
| `cg` | `assets/cg/<name>.<ext>` | `16:9` |
| `sprite` | `assets/sprites/<characterId>/<expression>.<ext>` | `9:16`（**实测后改**：原定 3:4，但网关把 3:4 静默出成横图，见文末「画幅实测更正」） |

**扩展名按返回的 `mimeType` 决定，不硬编码 `.jpg`**：把 PNG 字节装进 `.jpg` 文件会让 Safari 等不嗅探的客户端裂图，flow2api 将来出 WEBP 就是全平台裂图。

**命名白名单分层**：

- `name` / `expression`：`^[a-z][a-z0-9_]{0,39}$`。剧本里是 `<scene bg="rooftop_dusk">` 这种小写下划线，模型照着写即可。
- `characterId`：**走 `play.json` 角色 id 的成员校验，不做正则**。`parsePlayConfig` 不约束角色 id 格式，`Koharu` 这类大写 id 完全合法，正则会误伤。
- `kindPath`（`backgrounds` / `cg` / `sprites/<id>`）**只由服务端从已校验枚举拼装**——这是 `store.writeAsset` 不做路径穿越校验的唯一安全前提，写进代码注释钉死。（`writeAsset` 也非原子写，与现有素材上传同风险等级，不在本轮扩大改动。）

**in-flight 锁**：同一 target 的并发请求直接合并（与 `ImageAssets` 的内容寻址缓存是两回事）——同一批次两次 `generate_asset` 打同一路径会烧两份配额、竞态写、`replaced` 标记不确定。

**覆盖时必须显式播报**：目标已存在则覆盖并在返回文本与对话卡片里明写「已覆盖原有素材」。不做 provenance 清单（过度设计），代价是工坊出的图与用户手工导入的图无法区分来源——素材页仍可回看与重传，覆盖行为对用户可见即可接受。

### 3.4 角色一致性：`neutral` 兼任定妆照与垫图

不新建 `assets/refs/` 目录（会污染素材清单、素材页多一格，且 `buildAssetIndex` 的 `files[0]` 兜底会误选参考图）。用 **`neutral` 差分本身**当定妆照与垫图——它既是模型和 playwriter 能直接引用的合法差分（`<actor id="mio" expression="neutral"/>`），又是进 git 后换机器也保得住的「同一个人」。

**`neutral` 缺失时的三分支**（关键：避免用户删掉 neutral 后默默换脸）：

| 磁盘现状 | 行为 |
| --- | --- |
| `neutral` 存在 | 正常：作垫图生成差分 |
| `neutral` 缺，该角色**一个差分都没有** | 自动新建 `neutral`（prompt 追加「正面站姿全身，中性表情」）——没有既存差分，不存在不一致 |
| `neutral` 缺，**但已有其它差分** | **报错**：让用户先过目新的定妆照，确认后重试。不自动重建——否则新定妆照与已有差分不是同一个人，演出中静默换脸 |

顺带修 `listAssets()` 的 `sprites/<charId>` 结果**排序**（现在 `readdir` 顺序不定，`buildAssetIndex` 的 `files[0]` 兜底会随机选一张差分——既有 bug）。

### 3.5 二进制写入：走 `PlayFiles`，不绕过白名单

`PlayFiles.isEditable` 对 `assets/**` 恒 false。若 `WorkshopAssets` 绕过它直接调 `store.writeAsset`，铁律② 的文本就变假，人和 agent 的写权限面分叉。改为在 `PlayFiles` 上**显式开一条二进制通道**：

```ts
writeBinary(rel: string, data: Buffer): Promise<string>
```

只接受 `assets/{backgrounds,cg,sprites/<id>}/<名>.<png|jpg|webp>`，带体积上限；**不产 `WorkshopWrite` 撤销记录**（`before` 是 utf8 文本，2MB 二进制会被解成乱码串回传前端，撤销按钮会写回乱码）。工坊的 `write_file` 文本工具**仍然拒绝 `assets/`**——文本工具写图片路径没有意义。

同批更新 AGENTS.md 铁律② 的文本，描述这条新增通道。

### 3.6 `play.json` 立绘映射自动补写

生成立绘后 `character.sprites[expression]` 要有映射才算数（`Readiness.characterSprites` 与 `buildAssetIndex.sprite` 都依赖它）。**工具内部自动补写**，不甩给模型：

1. 读 `play.json`（经 `PlayFiles`），按成员校验找 `characterId` 对应的角色，找不到就报错回给模型；
2. 写 `sprites[expression] = "<expression>.<ext>"`；
3. `parsePlayConfig` 校验 → 写盘 → 发一条 `workshop_write`（`before` 齐备，可撤销）。

这样「写盘可见可撤销」铁律对新能力依然成立，而模型不必手搓 JSON（它看不到二进制产物，必然出错）。

### 3.7 工坊工具：`generate_asset`

第六个工具（`workshop.ts`）。参数**保持扁平**：`pi-ai` 的 `Type` 就是 typebox，`Type.Union` 可用并能序列化成干净的 `anyOf`；不用的理由不是「不确定」，而是 **provider 侧对 `anyOf` 约束采样的容忍度因网关而异**（这正是 pi-ai 另给 `StringEnum` 的原因），扁平参数的错误信息对模型更直白。

```
generate_asset(
  kind: "background" | "cg" | "sprite",
  name?: string,          // kind=background|cg 时的素材 id
  characterId?: string,   // kind=sprite 时的角色 id（走成员校验）
  expression?: string,    // kind=sprite 时的差分名
  prompt: string          // 英文生图描述
)
```

参数缺失或非法时返回中文错误文本让模型自我修正（沿用 `write_file` 的「把错误回给模型重试」模式）。

返回文本示例：

```
已生成 assets/backgrounds/classroom_dusk.jpg（16:9，1.2MB），已写入剧目素材。
角色卡立绘映射已更新（neutral、smile）。同 id 再次生成会覆盖旧图；不满意可说「重画 classroom_dusk」。
```

**超时**：单轮工坊 180s 在连出 2–3 张图时不够（flow2api 单张 10–30s），`TURN_TIMEOUT_MS` 提到 **420s**。仍是硬上限，网关挂死照样解锁。

**工具执行签名**（pi-agent-core 0.87.1 实测）：`(toolCallId, params, signal?, onUpdate?)`，`label` 必填，返回 `content` 是数组、`details` 必填。

### 3.8 WS 消息：`workshop_asset`

```ts
| { type: "workshop_asset"; threadId: string; kind: string; path: string; url: string; replaced: boolean }
```

必须以 `workshop_` 开头——`useWorkshopSocket.ts:42` 与 `useStageSocket.ts:190` 只按该前缀分发。瞬态、不进事件缓冲。丢消息的后果仅是对话里少一张缩略图，文件在盘上、素材页照常可见。

**图片挂到消息上，不放独立状态**：`useWorkshop` 收到 `workshop_asset` 先攒进 `pendingAssets`，`workshop_done` 时附到新 assistant 消息的 `images` 字段（`WorkshopChatMessage` 加 `images?: {url, path, kind}[]`）。这样 `workshop_history` 整段替换后图片仍在、顺序也对——放独立状态会在重连/切线程时丢图。

同轮 runtime 重建沿用现有单次 reload：工具经 `WorkshopToolDeps` 新增的 `onAssetsChanged` 回调置位既有的 `wroteDuringTurn`，收束时一次 `onFilesChanged()`（素材增删与文本写盘合并成同一次重建，`await orchestrator.whenIdle()` 等节拍边界）。

### 3.9 就绪门放开

`PlayStore.readiness()`：`ready = premise 非空`。`characterSprites` / `background` **保留为字段**（素材页与工坊仍用它做建议项），语义从「阻塞项」降为「建议补齐」。

**`premise` 有两个取值源**（既有隐患）：`store.readiness()` 只读 `play.premise`，而 `prompt.ts:44` 读 `memory.premise || play.premise`。工坊若只写记忆卡不写 `play.json`，就绪门会一直红而 playwriter 已经在用新前提。`readiness()` 必须同时读 `memory/always/premise.md` 兜底。

配套三处（缺项逻辑在前端被重复实现了两遍，必须同改）：

- `apps/web/src/api.ts`：导出 `missingItems(readiness)`（只收 `premise`）与 `adviceItems(readiness)`（收立绘/背景）。
- `TitleView.tsx`：按钮 `disabled={!readiness?.ready}` 不变（服务端 `ready` 已变），缺项块改口径；有 premise 但缺图时显示一行弱提示「暂无素材：演出将使用氛围背景，角色可能不上台」。
- `LibraryView.tsx`：`missingItems` 改调 `api.ts` 的公共函数，杜绝再次分叉。

### 3.10 缺素材的降级不再靠运气

现状风险链：零素材剧目 → `prompt.ts` 的 `assetSection` 四行全塌成空串（模型没有任何锚点）→ 模型引用了某个 `bg` id 却没预发射 → `script.ts` 压根没登记 pending（`PENDING_TTL_MS` 只摘「已登记但超时」，对「压根没登记」零作用）→ `StageTheater` 落回 `app.css` 米白渐变，**整个第一幕都在白底上飘字，且那个 id 永远不会变图**。

- **服务端**：`prompt.ts` 的 `assetSection` 在零素材时显式写一条指令「当前剧目暂无导入素材：任何 `<scene bg>` / `<cg id>` 都必须先用 `preload_asset` 发射，id 自取」。3 行改动，零成本，直接堵住这个塌陷。
- **不做的**：服务端在 `scene` 事件里对未知 bg 自动补预发射——那个时刻**没有可用的 prompt**（剧本里只有 id），只能编一句弱描述，出一张大概率是废图的图并烧配额。客户端把「未解析的 bg」也挂进 pending 同样无意义，TTL 摘除后还是白底。
- 残留风险记入本计划：模型若仍引用未预发射的 id，舞台白底。开演前缺图提示会明确告知用户。

### 3.11 无立绘角色的降级

现状（`StageTheater.tsx:207-218`）：角色没立绘 → `index.sprite()` 返回 `null` → `return null` → **角色静默消失，零提示**。

不推翻这个降级（没有图就是没有图，编个占位人是新美术工作），但让它**有意为之**：`prompt.ts` 的角色块在无差分时显式写「（无立绘：不要为该角色发 `actor` 指令，台词照写）」，playwriter 因此不会发出必然落空的 `actor`。

### 3.12 工坊提示词重写（目标 4）

`buildWorkshopPrompt` 从「给具体提案而不是反问」改成**设定向导**契约：

1. **开场先问**：题材基调 / 时代地点 / 主角与核心关系 / 画风 / 篇幅尺度，一次问 3–5 个，每个带具体默认值建议，让用户「回车即可接受」。
2. **拿到回答出完整提案**：premise 全文 + 角色卡 + 素材缺口清单，一次给全。
3. **确认后写盘**：`write_file` 前一句话说明写什么。
4. **生图前必确认**：先逐条列出待生成的图（id、用途、英文 prompt），等用户点头才调 `generate_asset`。已存在的素材直接引用不重生成。
5. **立绘流程**：先定 `neutral`，再出差分；prompt 里逐项锁定身份特征（发色/瞳色/发饰/体型），只改表情。
6. **画风与文风**：落 `memory/always/craft.md`（playwriter 会注入 A 区），而不只是嘴上说说。

`renderReadiness` 文案同步改口径：`开演条件：premise ✓` + `建议补齐：立绘 / 背景（不影响开演）`。

## 4. 改动清单

### 服务端

| 文件 | 改动 |
| --- | --- |
| `src/limiter.ts` | 新增：带优先级的槽位转让式闸门 |
| `src/imageBackend.ts` | 新增：接口 + 画幅类型 |
| `src/flowImage.ts` | 新增：flow2api 实现（三分支响应解析、别名白名单自校验、fetch 注入） |
| `src/imagegen.ts` | 改造成 `CpaImageGen`（同一接口，忽略 references） |
| `src/config.ts` | 新增 `image.backend` / `flow.*`——**interface 与 `loadConfig` 字面量两处同改** |
| `src/imageAssets.ts` | 改用 `Limiter` 与 `ImageBackend`；指纹加画幅 |
| `src/workshopAssets.ts` | 新增：素材生成层（落盘、命名分层校验、neutral 三分支、in-flight 锁） |
| `src/workshop.ts` | 新增 `generate_asset`；提示词重写；`TURN_TIMEOUT_MS` 420s |
| `src/playFiles.ts` | 新增 `writeBinary`（受限二进制写通道，不产撤销记录） |
| `src/workshopSession.ts` | 接入 `WorkshopAssets`；`wroteDuringTurn` 合并 reload；播发 `workshop_asset` |
| `src/playhouse.ts` | `limiterFor(playId)` 存 Map；构造 `WorkshopAssets`、传进 `WorkshopSession` |
| `src/store.ts` | `readiness()` 放开到 premise + 记忆兜底；`listAssets` 排序 |
| `src/prompt.ts` | 零素材 directive；无立绘角色提示 |
| `packages/core/src/ws/protocol.ts` | 新增 `workshop_asset`；`WorkshopChatMessage.images` |

### 前端

| 文件 | 改动 |
| --- | --- |
| `src/workshop/useWorkshop.ts` | `pendingAssets` + switch 分支；`TOOL_LABEL` 加 `generate_asset`；导出 `missingItems`/`adviceItems` |
| `src/workshop/WorkshopPanel.tsx` | 气泡内渲染图片卡片（缩略图 → 灯箱）；写盘条显示覆盖标记 |
| `src/ui/ImageLightbox.tsx` | 新建：点击放大 / Esc 关闭 |
| `src/workshop/FileBrowser.tsx` | 图片扩展名分流到 `<img>`，不再当文本读成乱码 |
| `src/views/TitleView.tsx`、`LibraryView.tsx` | 就绪门放开 + 缺项逻辑去重 |
| `src/app.css` | 图片卡片与灯箱样式（复用 `bg-fade` 动画语言） |

### 脚本与文档

| 文件 | 改动 |
| --- | --- |
| `scripts/init-worktree.sh`、`scripts/dev-worktree.sh` | 新增：worktree 初始化与动态端口启动 |
| `apps/web/vite.config.ts` | 代理目标改读 `STAGE_SERVER`（worktree 动态端口） |
| `README.md` | 新增配置项 + 工坊生图能力 |
| `AGENTS.md` | 工坊铁律② 改写（二进制通道）、增第 ⑤ 条；生图铁律增 flow2api/垫图/优先级条目 |

## 5. 测试策略

**平时一律 stub。** 真实出图按张计费，单元测试绝不打真接口。

| 测试 | 覆盖 |
| --- | --- |
| `test/limiter.test.ts` | **槽位转让**（`max=1` 对拍 b/c 不得重叠）、优先级插队、队列上限；`acquire()` 在 `try` 外 |
| `test/flowImage.test.ts` | 注入假 fetch：别名模型名、画幅进 `imageConfig`、垫图 `inlineData` 顺序、base64 解析、`fileData` 降级分支、纯文本被拒分支、别名白名单拒绝非法画幅 |
| `test/workshopAssets.test.ts` | 落盘路径、扩展名随 mimeType、命名白名单（穿越/大写 name）与 characterId 成员校验、neutral 三分支、in-flight 合并、覆盖返回 `replaced` |
| `test/playFiles.test.ts`（增量） | `writeBinary` 白名单；`write_file` 仍拒 `assets/` |
| `test/workshop.test.ts`（增量） | `generate_asset` 参数校验与错误回灌、play.json 映射补写过 `parsePlayConfig`、`workshop_asset` 播发 |
| `test/store.test.ts`（增量） | premise-only `ready`；`memory/always/premise.md` 兜底；`listAssets` 排序 |
| `test/image.test.ts`（回归） | 改用 `Limiter` 后 D6 缓存与预发射行为不变 |
| `test/e2e-live-image.test.ts` | **默认 skip**，`STAGE_E2E_LIVE=1` 时真调 flow2api 出 1 背景 + 1 立绘（垫图）。模型可用性检查打 `GET /v1/models/aliases`——**别名不在 `GET /v1beta/models` 里**，那里只有完整名 |

回归线：改动了 core 的 protocol，必须 rebuild 后跑 `pnpm test` 全量；解析器撕裂等价性用例全绿。

## 6. 用户使用路径

1. 剧目库 → 新建 → 进 Title 页，「开始游戏」灰着，提示去工坊。
2. 点「工坊」→ 说「我想做一个关于××的故事」→ 工坊反问 3–5 个设定问题（每个带默认值）。
3. 回车接受默认 / 改几处 → 工坊给完整提案（premise + 角色卡 + 素材缺口）。
4. 「就按这个来」→ 工坊写 `play.json` 与记忆卡 → 对话底部出现可撤销的写盘条。
5. 工坊列出待生图清单 → 「可以」→ 逐张生 → 气泡里出现图，可点开放大。
6. 回 Title 页 → 就绪门已绿 → 开始游戏。缺图也能开演。

改已有剧目：进工坊 → 讨论 → 确认后写盘 → 撤销条可回退。

## 7. 风险与取舍

| 风险 | 处置 |
| --- | --- |
| 真实出图按张计费，单轮多张可能超 180s | 提到 420s 硬上限；提示词要求生图前列清单、用户点头后逐张来 |
| 角色一致性依赖 `neutral` 垫图质量 | 提示词强制「先定 neutral」；`neutral` 缺失且已有其它差分时报错让用户先过目，不静默换脸 |
| flow2api 协议漂移 / 非法参数静默降级 | 启动时对照别名能力表自校验，写错即启动失败；测试断言请求体 |
| 工坊生成的图进了 git，体积不可逆膨胀 | 2K 单图 1–3MB，一张剧目十几张约 20MB。**重编码到长边 1920 / JPEG q80 可缩 5–8 倍但需引入图像编码依赖，本轮不做**，记为已知限制；覆盖重画也不回收 git 历史 |
| 工坊图与用户导入图无 provenance 区分 | 覆盖时显式播报 + 素材页可回看重传；不做 provenance 清单 |
| 生图产物不可撤销 | 替代手段是覆盖重画与素材页删除，工具返回文本明说 |
| 模型引用未预发射的 bg id → 白底飘字 | `prompt.ts` 零素材 directive 堵主路径；残留风险在 §3.10 已记 |
| 缺素材剧目的 `preload_asset` 出图质量依赖模型自觉 | 已有铁律约束 + 提示词明写，不加服务端兜底 |

---

## 画幅实测更正（2026-09-29，实施期追加）

计划阶段只读了 flow2api 源码（`model_resolver.py`），结论是「3:4 会被翻成 `three-four` 后缀、支持」。**源码只保证请求被正确组装，不保证上游认这个画幅。**

真实出图（imageSize=2k，单变量对照）：

| 请求画幅 | `gemini-3.1-flash-image` | `gemini-3.0-pro-image` |
| --- | --- | --- |
| `16:9` | 1376x768（1.79）✅ | — |
| `9:16` | 768x1376（0.558）✅ | — |
| `3:4` | 1200x896（1.339）❌ | 1200x896 ❌ |

网关 `request_logs` 里 `request_body.model` 确实是 `gemini-3.1-flash-image-three-four-2k`——**客户端、别名白名单、`imageConfig` 全对**，是上游只认横竖两档、其余静默退回默认横图。

**处置**：
1. 立绘画幅 3:4 → **9:16**（竖版全身立绘本身也更配这个比例）；
2. 加**画幅回执校验**（`sizeOfImage` + `aspectMatches`，容差 12%）：回执不对直接报错、一个字节都不落盘——不靠"下次注意"，让错画幅在工坊对话里当场可见；
3. 实测结论写进 AGENTS.md 生图铁律⑦与 README，避免下一个人再拿 3:4 试水。

---

## 实施期追加决策（2026-09-29）

### A. 抠底：接，作为管线的一步

舞台上立绘是叠在背景上的普通 `<img class="theater-sprite">`（`apps/web/src/stage/StageTheater.tsx:207-218`），
**透明是硬需求**——不抠底就是一块盖住背景的方砖。

落地 `src/cutout.ts`：border-seeded flood fill 抠背景 → 覆盖率守卫 → 反解底色 → 边缘 alpha 软化
（`alpha = 255 * max(colorDist/EDGE, dist/INTERIOR)`）→ 按前景包围盒裁切 → 居中落进 1080x1920 透明画布。

由此倒推出一条**对生图 prompt 的硬要求**：模型必须出**纯白或纯绿纯色底、无渐变无投影**——
flood fill 的前提就是底色是纯色。抠不干净（四周剩一圈底色）**直接报错让模型重来**，
不落一张半坏的图进 git（项目铁律：对于大多数异常不做失败降级）。

### B. 表情面板：加，作为 `generate_asset` 的一个参数

一次调用出 2xN 面板（`src/spriteSheet.ts`，`SHEET_MAX=6`），切格后逐张抠底落盘。
**单格分辨率低是它的代价，换来的是「一套表情必然同一个人」**——垫图做不到这个保证，
它只能让「已经在同一张脸上派生」变得更稳。

与垫图是**互补关系，不是替代**：

| | 表情面板 | 垫图（neutral） |
| --- | --- | --- |
| 一次出一套 | ✅ 便宜、必然一致 | ❌ 一张一张出 |
| 之后单独加一个差分 | ❌ 面板是整体的 | ✅ 唯一可行的路 |
| 首次定妆照后锁死角色 | ❌ | ✅ |
| 分辨率 | 低（切格后） | 满 |

代码里就是照这个划的：sheet 模式**不传垫图**（同一张面板内角色天然一致，垫图在这条路上没有信息增量），
`runSingle` 保留垫图。

### C. 出图技法：走 agent skill，不进 system prompt

出图的技法细节（画风锚点、场景构图、表情面板范式）随需求增长，硬塞进 system prompt 会一直占常驻 token。
改走 pi 原生 skills：`apps/server/skills/{style-anchors,scene-composition,sprite-differences}/SKILL.md`，
`formatSkillsForSystemPrompt` 每轮只注入 name/description/路径，模型判断相关时用 `read_skill` 读全文。
（pi 的 `loadSkills` 第三参是 `Context` 不是 `{signal}`，用 `BACKGROUND_CONTEXT`。）

**不为此放宽 `PlayFiles` 读白名单**——那才是真正的边界。
