# 搭台助手对等移植 · 素材生成与处理（调研）

> 只读调研，未修改任何源码。范围＝AIVN「工坊（workshop）」侧与素材生成/处理相关的六个工具
> （`generate_image` / `commit_asset` / `recut_sprite` / `generate_bgm` / `list_library` / `import_asset`）
> 及其全部下游实现。所有结论以本机 `/root/projects/stage-ai` 的代码为依据，行号以本机为准。
>
> 本机数据目录＝仓库根（`settings.json`、`plays/`、`library/`、`media-cache/` 都在根下）。
> **本文不含任何真实凭据**，凡涉密处一律写掩码。

---

## 0. 先说三件对全篇有影响的事

1. **`generate_image` 是「一份 schema、两套等待策略」。** 工厂按角色传 `mode`：工坊 `sync`（等图、回 markdown 预览、只产草稿），剧作家 `queued`（发起即返回、draft+commit 一次做完）。两者**共用同一个 `parameters` 对象实例**（`apps/server/src/agentkit/imageTool.ts:26-88`，测试锁在 `test/image.test.ts:155-171`）。本次调研的对象是 `sync` 那一侧；`queued` 只在与工坊行为形成对照时提到。

2. **`imagePrompt.ts` 不在工坊出图这条路上。** `composeImagePrompt` 的三个调用点全在 `playhouse.ts` 的 `requestCg`（:1036，舞台 WS 生 CG）与 `generateImage`（:1119、:1171，素材页手动生图 REST）里，`playAssets.ts` / `agentkit/imageTool.ts` 一次都没调它。工坊与剧作家的 `generate_image` 都是**模型自己写 prompt**（`prompt` 是必填参数）。所以 `imagePrompt.ts` 属于「舞台/手动」那条路，移植工坊这半边时不是必需品——但它解释了「出图提示词内核只有一份」这句 AGENTS.md 说法的边界。

3. **权限面与「能力的 writeScopes」不是一回事。** `writeScopes`（characters / memory / config）只在 `agentkit/playEnv.ts:120` 生效，拦的是 pi 的 `read`/`write`/`edit`。素材类工具走的是另一条口——`PlayFiles.writeBinary` / `PlayFiles.write` / `store.assetPath` / `PlayStore.deleteAsset`（`playFiles.ts:229`、`:248`、`:280`），**不查 writeScopes**。也就是说「素材」能力开出来后，工具能写的文件面不受该剧目写入白名单约束，只受各自实现代码里那几个固定路径约束（下面每节逐条列）。

---

## 1. 总表

### 1.1 工具 → 行为 / 依赖 / 落点 / 权限

| 工具 id | 参数（必填 **粗**／可选） | 调用后发生什么（一句） | 依赖的服务端配置 | 产出落点 | 权限面（能改哪些文件） |
| --- | --- | --- | --- | --- | --- |
| `generate_image`（工坊 sync） | **`kind`**（union `background`\|`cg`\|`sprite`）、**`prompt`**(1–4000)；可选 `name`(≤40)、`spriteId`(≤40)、`variant`(≤40)、`references`(1–6)、`referenceCharacters`(1–6)、`framing`(union full\|half\|square)、`stature`(union small\|normal\|large\|huge)、`title`(≤40)、`style`(≤200) | 同步等图（70–140s），**只产草稿**，回执给 `draftId`+预览 URL，并向工坊对话推一条素材气泡 | `image.enabled` + `image.format/baseUrl/apiKey/model/size/timeoutMs/concurrency/reference` | `media-cache/drafts/<draftId>/{image.<ext>, source.<ext>, draft.json}` | 只写 `media-cache/drafts/**`；顺带删过期草稿目录（`pruneDrafts`）。**不碰 `assets/`** |
| `commit_asset` | **`draftId`**(1–64) | 把一张草稿提升为正式素材：按草稿记录的意图写 `assets/`、补素材表呈现声明、记生图台账；立绘另把留底原片搬进 sprite-sources | 无独立配置（但 `playAssets` 必须存在，否则直接回「生图未启用」） | `assets/backgrounds\|cg/<name>.<ext>` 或 `assets/sprites/<spriteId>/<variant>.png`；`assets/manifest.json`；`assets/generated.json`；`media-cache/sprite-sources/<spriteId>/<variant>.<ext>` | `assets/**`（含 manifest.json、generated.json）+ `media-cache/sprite-sources/**` |
| `recut_sprite` | **`spriteId`**(1–40)；可选 `variant`(≤40)、`cutout`（对象：tolerance 0–128、keySmooth 0–8、edgeBand 1–32、spill 0–255、solidResidual 0–255，全可选） | 拿 `media-cache/sprite-sources/` 里的抠底前原片本地重跑一遍抠底，**覆盖** `assets/` 里那张 PNG；画面不变、不烧配额、几秒 | 同上（要曾出过图并留了底片） | 覆盖 `assets/sprites/<spriteId>/<variant>.png` | `assets/sprites/<id>/**`（并清同 stem 的旧扩展名） |
| `generate_bgm` | **`name`**(1–40)、**`prompt`**(1–2000)；可选 `title`(≤40)、`description`(≤300)、`tags`(≤8)、`mood`(≤8)、`scene`(≤8)、`loop`(bool)、`volume`(0–1)、`overwrite`(bool) | **发起即返回**（不等曲子），宿主后台跑（~84s），到货广播 `asset_ready(type=bgm)`；已有同名且未 `overwrite` 时**直接跳过** | `music.enabled` + `music.baseUrl/apiKey`（留空回落 `image.*`）+ `music.model/timeoutMs` | `assets/bgm/<name>.<ext>`（扩展名跟着上游 mime，实测 `.m4a`）；`assets/manifest.json` | `assets/bgm/**` + `assets/manifest.json` |
| `list_library` | 可选 `kind`（union backgrounds\|cg\|sprites\|characters\|bgm\|sfx）、`query`(≤100) | **只读**浏览应用级资源库（跨剧目，`<dataRoot>/library/`），列出前 40 条匹配行 | 无（`assetLibrary` 是 PlayHouse 构造参数，恒存在） | 无（读 `library/**`） | 只读，无写入面 |
| `import_asset` | **`kind`**、**`entryId`**（string ≤64 或 **string 数组** 1–40）；可选 `variants`(≤24)、`target`（仅字面量 `"protagonist"`） | 把库里条目**复制**进本剧目：单文件类落 `assets/<kind>/`，立绘类落 `assets/sprites/<id>/`，条目带 `meta.character` 时另写一张角色卡 | 无（同上） | `assets/<kind>/<id>.<ext>`、`assets/sprites/<id>/<variant>.<ext>`、`characters/<id>.md`、`assets/manifest.json` | `assets/**` + `characters/<id>.md` |

### 1.2 能力（能力目录里的行）→ 工具 → `needs`

| 能力 id | 界面名 | 分组 | 授权工具（工坊） | `needs` | 缺依赖时界面 | 缺依赖时工具 |
| --- | --- | --- | --- | --- | --- | --- |
| `image` | 生图 | 素材 | `generate_image`、`recut_sprite`、`commit_asset` | `image` | 补一句「服务端没配生图后端，暂不生效」 | **照旧注册**，调用时回文本错误（见 3.3，这是个不一致点） |
| `music` | 生成 BGM | 素材 | `generate_bgm` | `music` | 补一句「服务端没配音乐生成后端，暂不生效」 | **不注册**（`musicTool.ts:91`） |
| `library` | 素材资源库 | 素材 | `list_library`、`import_asset` | 无 | 恒 `available: true` | 恒注册（`assetLibrary` 恒存在；空库返回「资源库是空的」） |

依据：能力目录 `apps/server/src/agentkit/kit.ts:149-176`；工具→角色 `kit.ts:274-302`；`needs` 判定 `kit.ts:252-266`；`available` 的数据源 `playhouse.ts:859-880`（`image: this.imageBackend !== null`、`music: this.musicBackend !== null`）。

> 角色可见性：`generate_image` / `list_library` 两个角色都装；`commit_asset` / `recut_sprite` / `generate_bgm` / `import_asset` **只装工坊**（`kit.ts:281-299`）。`import_asset` 在剧作家侧是工厂开关 `importAsset: false`（`kit.ts:463-468` → `libraryTool.ts:189`），因为剧作家的默认导入路径是「引用即导入」。

---

## 2. 逐工具

### 2.1 `generate_image`（工坊 sync 形态）

**参数语义与边界**（schema：`agentkit/imageTool.ts:26-88`）

- `kind` 三值 union，`prompt` 必填。其余全部可选，**没有任何参数接受 `null`**；「不给」= 走缺省。
- `name` 给背景/CG 用（就是剧本里的 `bg`/`cg` id）；`spriteId` 给立绘用（就是 `assets/sprites/` 的目录名，**不要求有角色卡**）。二者不会互相校验「给了没给」——真正的必填校验在 `playAssets.ts:652`（背景/CG 无 `name` 抛错）与 `:747`（立绘无 `spriteId` 抛错）。
- `references` 与 `referenceCharacters` 是同一件事的两个入口，工具层先合并去重再封顶 6 张（`imageTool.ts:228-239`）：**顺序保留**（数组顺序即 prompt 里「第 1 张、第 2 张」的编号顺序），两个字段各自合法但合起来超 6 张时按前 6 张截断。
- `framing` 决定**画幅**（`full`→9:16、`half`→3:4、`square`→1:1，`packages/core/src/play/framing.ts:58-63`）与 prompt 里的景别措辞（`:65-69`）；`stature` 只管舞台摆位大小。两者都能被素材表里既有的声明覆盖（优先级：调用方显式 > 差分级声明 > 立绘级声明 > 缺省，`playAssets.ts:750-752`）。
- `variant` 缺省问题见 5.1。

**执行链**（工坊）

1. `execute` 先看 `deps.playAssets` 在不在，不在就直接回一句「生图未启用（STAGE_IMAGE_ENABLED=false 或后端缺凭据）」（`imageTool.ts:205-212`）；注意这句文案里引的 `STAGE_IMAGE_ENABLED` 是**旧环境变量时代的措辞**，现在真正的开关是 `settings.json` 的 `image.enabled`。
2. `runSync` → `PlayAssets.draft()`（`imageTool.ts:242-270`）→ 落草稿；回执三行：`草稿已出：<draftId>`、markdown 预览、以及「这张还没进素材表，要采用它就调 `commit_asset`」。
3. 同时 `deps.onAsset(draft.path, draft.url, draft.kind, false, toolCallId)` 推气泡（工坊依赖里给了 `onAsset`，`kit.ts:491-497`）——**候选图要在对话里看得见**，因为工具行默认折叠。

**草稿里到底有什么**（`playAssets.ts:482-522`）

- `media-cache/drafts/<uuid>/image.<ext>`：立绘是**抠好底的 .png**，背景/CG 跟着上游 mime（`extOf`，`imageBackend.ts:119-123`）。
- `source.<ext>`：**只有立绘有**，抠底前原片（重抠的后悔药）。
- `draft.json`：出图意图（`draftId/kind/name?/spriteId?/variant?/framing?/stature?/title?/aspect/prompt/imageExt/sourceExt?/createdAt`）。这是 `commit_asset` 唯一需要的输入。
- 预览 URL 走 `/plays/<playId>/drafts/<draftId>/image.<ext>`，静态路由在 `http.ts:177-189`（draftId 限 `^[\w-]{1,64}$`、文件名限 `^[\w][\w.-]*$` 且不含 `..`）。
- 每次出草稿顺手清 7 天前的旧草稿目录（`DRAFT_TTL_MS`，`playAssets.ts:70`；清理 `:525-542`，best-effort 不打断出图）。

**出图本体**（`playAssets.ts:431-475`）

- 垫图装配唯一入口是 `referencesFor`（`:823-842`）：非 neutral 立绘**恒**垫该主体已入库的 neutral 定妆照，且**显式传 references 会直接报错**；neutral 与背景/CG 按调用方给的垫图走。全局开关 `image.reference="none"` 会连显式参考图一起关掉（`:824`）。
- 参考图解析 `resolveReferences`（`:682-724`）：每项可以是①主体 id（剧目里既没立绘也没卡就报错并列出可选主体）②剧目内相对路径（容错前导 `/` 与 `plays/<id>/` 前缀，文件必须存在）③`http(s)://` 网址（下载走注入的 `fetchImage`）。
- 立绘请求带 `minTier: "2K"`（`:459`，为抠底要更高源图分辨率），背景/CG 不声明。
- 后缀拼装在 `suffixFor`（`:1009-1027`）+ `KEY_BACKGROUND`（`:1099-1103`，默认纯绿 `#00FF00`、角色本身绿色系时换品红 `#FF00FF`）+ `POSE_TAIL`（`:1134-1140`，人形留白）。
- 落盘前**画幅回执校验** `assertCanvas`（`:616-630`）：读实际像素尺寸与请求画幅比对，容差 12%（`imageBackend.ts:157-168`），不符直接抛错不落盘。原因是网关对画幅**静默降级**而不是报错。
- 立绘立刻抠底（`:473`），用的默认调参（`cutout.ts:109-127`）。
- 等待期间在 pending 面板记账（`:443-448`），失败也留一行错因（`:466`）。

**并发与去重**

- `draft` **不去重**——同一目标并发出三张候选正是这条流程要的。
- `generate()`（剧作家/手动那条）才有 `inflight` 去重（`:268-284`，key = `kindPath/stem`）；`recut` 会先 await 同名在飞任务（`:369`）避免读到半写状态。

**失败怎么报**：`execute` 外层统一 catch 成 `生图失败：<reason>`（`imageTool.ts:217-219`）。也就是说画幅不符、抠底不干净、参考图解析失败、后端 HTTP 错误，到模型眼前都是同一句式 + 原文。

### 2.2 `commit_asset`

**参数**：只有一个 `draftId`（`commitTool.ts:19-25`）。落位不需要重述——用的是 `draft.json` 里的意图（`playAssets.ts:312-335`）。

**行为**（`playAssets.ts:312-335`）

1. `loadDraft` 校验 id 形状 `^[\w-]{1,64}$`，再读 `media-cache/drafts/<id>/draft.json`；文件不在就报「找不到草稿 <id>：它可能已被清理，或者 id 记错了」（`:337-345`）。
2. 用草稿意图重新 `resolve` 出一个 spec（所以此时素材表里的既有声明会参与取景/体量的回落）。
3. 立绘且草稿里有 `sourceExt` 时，把原片搬进 `media-cache/sprite-sources/<spriteId>/<variant>.<ext>`（`keepSpriteSource`，`:552-569`，写失败只告警、不把成功出图报成失败）。**这是 `recut_sprite` 能成立的前提。**
4. `persist`：写 `assets/<kindPath>/<stem><ext>`，并删掉同 stem 的其它扩展名（`:572-583`），返回 `replaced`（此前有没有同名素材）。
5. 立绘另走 `declareSprite`（`:934-951`）把 `framing`（neutral 那次写立绘级；与基准不同的差分写一条 `<id>/<variant>` 覆盖）、`stature`、`title` 写进 `assets/manifest.json`——**只动这几格，描述一个字不碰**。读-改-写整表包在剧目级锁 `withPlayConfigLock` 里（`withManifest`，`:892-925`）。
6. `recordPrompt`（`:596-609`）把实际用的 prompt 记进 `assets/generated.json`（键：背景/CG 用 stem，立绘用 `<spriteId>/<variant>`），同样走剧目锁。写失败只告警。
7. `markCommitted` 往 `draft.json` 补一个 `committedAt`（`:348-355`，best-effort）。

**幂等**：同一张草稿重复采用只是把同一个文件再写一遍（描述里明说，`commitTool.ts:31`）。
**草稿清理**：没被采用的草稿留在草稿区，7 天后由下一次出图顺手删掉。
**审批/草稿态**：这里就是 AIVN 的两段式草稿态的全部机制——**草稿区**（`media-cache/drafts/`，不写 assets、不碰素材表、不记台账）+ **显式入库**。工具本身**不做审批校验**：`commit_asset` 不会问「用户点头了吗」。工坊侧的「出图审批」是**纯提示词约束**（见 2.7）。

### 2.3 `recut_sprite`

**参数**：`spriteId` 必填；`variant` 可选（**这里缺省确实按 `neutral`**，`recutTool.ts:87`）；`cutout` 是可选对象，五个调参各自可选，逐个带 min/max（`recutTool.ts:19-33`）。

**行为**（`playAssets.ts:363-375`）

1. `resolve` 出 spec，非立绘直接抛「只有立绘需要抠底」。
2. 若同目标有在飞出图，先 await 它（`:369`，理由是留底在出图途中写）。
3. 该立绘在 `assets/` 里没有图 → 抛「…还没有抠底图，先 generate_image 出图再来重抠」。**注意这条查的是 `assets/`，也就是草稿不能重抠。**
4. `readSpriteSource`（`:377-387`）按 `media-cache/sprite-sources/<id>/<stem>.<ext>` 逐个扩展名试；找不到就抛「没有留底原片（抠底前那一张）…更早出的图、用户自己上传的立绘都没有——那种只能重新出图」。
5. `cutout(源片, resolveTuning(tuning))` → `persist(spec, data, ".png")` 覆盖 `assets/` 里那张。

**副作用范围刻意最小**：`recut` **不**重记 generated.json、**不**重写 manifest 声明、**不**动留底原片——只覆盖成图。返回的 `replaced` 在 `persist` 里算（`:574-576`，此时几乎必然为 true）。

**抠底实现**（`cutout.ts:133-213`，纯 `sharp` + 自写算法）：底色取整圈边框逐通道中位数（`:243-257`）；全局色键只看颜色不看连通性（`:221-240`）；边缘 alpha 逐像素反解覆盖率（`:342-388`）；`unblend`（`:479-509`）+ `despill`（`:518-528`）；裁到人物外框、等比缩放、底部居中放进 1080×1920 画布（`:172-204`）。前景占比不在 2%–97% 之间直接抛错（`:149-157`）。**默认档**：48 / 0.8 / 4 / 20 / 48（`cutout.ts:109-127`），每一项可被 `STAGE_CUTOUT_*` 环境变量覆盖。

**调参语义**（工具描述 `recutTool.ts:47-61` 逐条给了症状→旋钮的对应）：`tolerance` 管抠得多狠；`keySmooth` 治 JPEG 环纹咬穿掩膜；`edgeBand` 治深色底白边晕；`spill` 治残留色边（动颜色不动 alpha）；`solidResidual` 护细描边（调小=更多像素判实心，0=关掉混合残差这条）。

### 2.4 `generate_bgm`

**参数**（`musicTool.ts:23-54`）：`name`、`prompt` 必填；其余为素材表元数据与 `overwrite`。

**注册条件**：`createGenerateMusicTool` 在 `deps?.music` 缺失时返回 `[]`——**工具压根不注册**（`musicTool.ts:88-93`），注释写明「装一个必然失败的工具只会诱使模型空转」。

**行为**（`musicTool.ts:101-132`）

1. `deps.music.existingUrl(name)` 查剧目里有没有同名曲（`playMusic.ts:97-104`，逐个音频扩展名试），有且没有 `overwrite` → 回「已有同名曲子，跳过生成，直接 `<scene bgm="…">` 引用；要重做才带 `overwrite=true`」。
2. `deps.kick(req, toolCallId)` 把活交给宿主，**工具不 await**（`musicTool.ts:113-128`）。

**宿主干活的地方**是 `playhouse.queueMusic`（`playhouse.ts:468-496`）：先 `assertAssetStem` 验名（非法名不该先占面板一行再失败）→ `pendingFor(playId).begin({id: jobIdForMusic(name), kind:"bgm", label:...})` → 真正 `music.generate(req)` → 成功广播 `asset_ready {type:"bgm"}` + 收尾；失败调 `finish(errorText)` **留在面板上**等人手动删。回执文案由工具侧给出（`playhouse.ts:491-495`），宿主那句 `"音乐生成未启用…"`（`:471`）实际上到不了——因为没后端时工具根本没注册。

**落盘与元数据**（`playMusic.ts:106-180`）

- `backend.generate` → `assets/bgm/<id><ext>`，扩展名跟上游 mime（`musicBackend.ts:54-64`：`audio/mp4`→`.m4a`，认不出兜底 `.m4a`）。
- 写前先删同 stem 的其它音频扩展名（`removeStaleSiblings`，`:120-131`），`replaced` 由此得出。
- `declareMeta`（`:139-180`）走同一把剧目锁写 `assets/manifest.json`，**只补它确知的格**：`title`/`description`/`tags`/`mood`/`scene`/`loop`/`volume`/`source`。音量规则：给了用给的，没给且既有值不是数字才落 0.4（免得把用户调过的 0.2 拨回去）。`source` 恒写「站内生成（音乐生成后端）」。
- 同名并发去重：`PlayMusic.inflight`（`:81-88`）。

**没有骨架占位那一层**：BGM 不进时间线，到货只是素材页多一张可播的卡（`musicTool.ts:14-15`、`playhouse.ts:465-466`）。**刻意不接 `onAsset`**——`pushAsset` 会把前端置 busy、等下一条 `workshop_done` 复位，而 BGM 一分半后才到、那时回合早收束，再置一次就永久锁死输入框（`playhouse.ts:449-452`）。

**上游铁律**（`musicBackend.ts:3-16`，均为本机 flow2api 实测）：只走 Gemini 形状 `:generateContent`；返回 `audio/mp4` 不是 mp3；~175s 的曲子要 ~84s；产物 base64 一次 ~2.9MB。**没有任何时长入参**（`musicFactory.ts` 无该字段，`GeneratedMusic` 只有字节/mime/扩展名），所以循环与长度只能靠提示词表达。

### 2.5 `list_library`

**参数**：`kind` 可选、`query` 可选（`libraryTool.ts:37-44`）。

**行为**：`library.list()` 全量 → 按 `kind` 与 `libraryEntryMatches(e, query)` 过滤 → 取前 40 条（`LIST_LIMIT`，`:22`）渲染成 `id | kind | 标题 | 描述[ | 差分：…][ | 主角][ | ⚠ 警告]`（`:106-134`）。空库与无匹配给两句不同的回执（`:112-118`）。超出 40 条时补一行「共 N 条，只列了前 40，用 query 缩小范围」。

**只读**：`AssetLibrary`（`library.ts:48`）只提供 `list` / `entry` / `filePath`，没有任何写入方法；服务端注释明确「增删改由用户在本地目录做，UI 不管这块」（项目 AGENTS.md 同口径）。

### 2.6 `import_asset`

**参数**：`kind` 与 `entryId` 必填；`entryId` 是 union（单 id 或同类别的一批 id，数组上限 40，与列表截断同一个常量）；`variants` 可选；`target` 只接受字面量 `"protagonist"`（`libraryTool.ts:46-63`）。

**两个显式拒绝**（`:152-158`，都是返回文本而非抛错）：
- 批量 + `target=protagonist` → 「主角卡只有一张，一次导多个会互相覆盖。分开调用。」
- 批量 + `variants` → 「variants 是逐条目的差分清单，批量导入时不知道补给谁。分开调用。」

**批量语义**（`:159-186`）：按条目逐个 `importFromLibrary`，**一条失败不影响其余**，回执照实列出哪条没进来（`failed` 数组）。全失败时回 `导入失败：…`。

**导入实现**（`assetImport.ts:147-230`）：
- 文件复制在**锁外**（整包图片几十兆，进锁会堵住整条剧目配置队列，`:169` 注释）。
- 立绘类目（`characters` / `sprites`）落 `assets/sprites/<spriteId>/<variant><ext>`，`spriteId` 通常是条目 id，`target=protagonist` 时固定 `protagonist`（`:157`）。
- 要导哪些差分：显式 `variants` > `meta.variants` 声明 > 目录里全部文件（`pickedVariants`，`:113-118`）。`sprites` 类目一个文件都没有时抛「资源库条目 X 里没有立绘文件」（`:175-177`）。
- 单文件类目（backgrounds / cg / bgm / sfx）取 `entry.files[0]`。
- 全部扩展名都会清同 stem 旧文件（`ALL_EXT`，`:63`）。
- 配置读改写在**锁内**（`withPlayConfigLock`，`:207-228`）：manifest 用 `mergeMeta` 合（库里没写的字段不覆盖剧目侧手写的，`:71-77`）；角色卡只在条目有 `meta.character` 时才写，**「只声明了图」不再建空壳卡**（`:222-228`）。
- 角色卡写入 `applyCharacterCard`（`:239-259`）：只认 `name`/`voice`/`voiceId`/`persona`（persona 进正文），内容与盘上一致就不写盘也不推刷新。

**写入面**：`assets/**` + `characters/<id>.md`（经由 `PlayFiles.write`，**不过 writeScopes**）。

### 2.7 工坊提示词里的出图章节（`workshop.ts`）

**什么时候拼进去**：`can.image` 为真时用 `imageGuide(ctx)`，否则整段换成 `NO_IMAGE_GUIDE`（`workshop.ts:98-99`、`:148`）。`can` 来自 `this.kit.can`（`workshopSession.ts:538`），也就是 `capabilitiesOf` 现算的那一份。

**`imageGuide` 只留角色职责**（`workshop.ts:319-341`），且在 file 注释里明写了「画幅、并发、垫图链路、差分命名都是工具契约，归 `imageTool.ts` 的描述管」——这里曾抄过一遍，于是 framing 改三档后这行还写着「立绘 9:16 竖构图全身」，指挥模型按错构图出图。它现在说的四件事：
1. 审批：`imageApproval === "auto"` 走「免审批，该出就出」；否则「**用户没点头之前一张都不要开跑**」。
2. `generate_image` 只出草稿、不进素材表；采用要调 `commit_asset`；没采用的草稿一周后自动清。
3. **首次定妆照出 3 张候选**（同一 `variant="neutral"` 调 3 次、prompt 各不相同），摆给用户挑，只 commit 那一张。
4. 采用之后再派生差分（差分自动垫已入库的 neutral）；失败时**把接口原话带给用户**（503/额度/模型名/被拒尺寸照抄）。

**审批是纯提示词约束**：`imageApproval` 是 `play.json` 的 `agents.workshop.imageApproval`（`packages/core/src/play/config.ts:160`、`:359-360`，取值经 `IMAGE_APPROVALS` 白名单；UI 在 `apps/web/src/workshop/AgentPane.tsx:223`，缺省 `"ask"`），只在 `workshop.ts:181/188/328-332` 三处被读进提示词。**工具侧没有任何代码检查它**。

**降级路径**：`NO_IMAGE_GUIDE` 只说「把该出的图列成清单告诉用户，让用户在素材页自己上传」。设定流程第 3 步（`setupFlow`，`workshop.ts:180-194`）也按 `imageApproval` 与 `can.library` 分叉（库里有没有可先查）。

---

## 3. 配置面

### 3.1 `needs` 那几位是什么

| 能力 | `needs` 键 | 判定表达式 | 在哪一行 |
| --- | --- | --- | --- |
| `image` | `image` | `this.imageBackend !== null` | `playhouse.ts:866` |
| `music` | `music` | `this.musicBackend !== null` | `playhouse.ts:867` |
| `search` | `search` | `this.exa !== null` | `playhouse.ts:864` |
| `voice` | `voice` | `this.voices !== undefined` | `playhouse.ts:865` |
| `library` | 无 | — | `kit.ts:169-176` |

两个 backend 都在 `rebuildClients()` 里按当前设置重建（`playhouse.ts:240-245`），并在设置变更时清掉按剧目缓存的 `playAssets` / `playMusic`（`:261-262`，否则它们把旧 key/旧模型拷在构造现场里）。

- `createImageBackend`：`image.enabled === false` → `null`；否则按 `image.format` 装配 `GeminiImageGen` / `ModelsLabImageGen` / `OpenAiImageGen`（`imageFactory.ts:13-24`）。
- `createMusicBackend`：`music.enabled === false` → `null`；否则一律 `GeminiMusicGen`（**没有 format 分支**，音频只有一种协议形状，`musicFactory.ts:10-19`）。

### 3.2 各配置项

**生图**（`config.ts:63-73` 定义、`:126-136` 缺省值、`:334-349` 校验、README 117-129 行总表）

| 字段 | 缺省 | 作用 |
| --- | --- | --- |
| `image.enabled` | `false`（新装） | 总开关；关 = 不发起任何生图 |
| `image.format` | `gemini` | 协议形状：`gemini` \| `openai` \| `modelslab` |
| `image.baseUrl` | 空 | 服务根地址，**别带 `/v1` 或 `/v1beta`** |
| `image.apiKey` | 空 | gemini 走 `x-goog-api-key`、openai 走 Bearer、modelslab 进请求体 `key` |
| `image.model` | 空 | 出图模型名（modelslab 填 `model_id`） |
| `image.size` | `1K` | 档位 `1K/2K/4K`（K 必须大写）或字面 `WxH`（openai 专用） |
| `image.concurrency` | `6` | 出图并发闸门（`limiterFor`，`playhouse.ts:508-515`），队列上限 12（`limiter.ts:22`） |
| `image.timeoutMs` | `180000` | 单图超时 |
| `image.reference` | `neutral` | `neutral`=差分垫 neutral 定妆照；`none`=全走文生图（**连显式参考图一起关掉**） |

**音乐**（`config.ts:74-88`、`:137-145`、`:351-358`、README 131-139 行）

| 字段 | 缺省 | 作用 |
| --- | --- | --- |
| `music.enabled` | `false`（新装） | 总开关；关 = `generate_bgm` 压根不注册 |
| `music.baseUrl` | 空 | **留空回落 `image.baseUrl`**（`config.ts:490-495`） |
| `music.apiKey` | 空 | **留空回落 `image.apiKey`** |
| `music.model` | `flow-music-lyria-3.5` | 音频模型名 |
| `music.timeoutMs` | `300000` | 单曲超时（比出图宽一档） |

**不进设置页的**：抠底五个调参走环境变量 `STAGE_CUTOUT_TOLERANCE` / `_KEY_SMOOTH` / `_EDGE_BAND` / `_SPILL` / `_SOLID_RESIDUAL`（`cutout.ts:111-125`），逐张图的重抠走 `recut_sprite`。参考图下载的出口代理读标准 `HTTP_PROXY`/`HTTPS_PROXY`（`webImage.ts:14`、`:109-112`），不另开配置项。

### 3.3 缺了 / 配错时的表现（工具不装？还是装了报错？）

三种形态**并存**，按工具分：

| 情形 | 表现 | 依据 |
| --- | --- | --- |
| 没配音乐后端 | `generate_bgm` **不注册**；能力 `available:false`；`can.music` 变假，提示词不教它调 | `musicTool.ts:91`、`kit.ts:510-514` |
| 没配资源库客户端 | `list_library` / `import_asset` 不注册 | `libraryTool.ts:83-85` |
| 没配联网 / TTS | `web_search` / `list_voices` 不注册，能力位跟着翻 | `kit.ts:469`、`:519` |
| **没配生图后端** | `generate_image` / `commit_asset` / `recut_sprite` **照旧注册**；只有界面那行补「暂不生效」；调用时回一句文本错误 | `kit.ts:491-508`；`imageTool.ts:205-212`、`commitTool.ts:52`、`recutTool.ts:81` |

**这里有一个不一致点值得单独记住**：`can.image` 是「能力开着 **且** 它授权的工具都装上了」（`kit.ts:380-392`），而生图那三个工具**恒装**，所以**生图后端缺失时 `can.image` 依然是 true**，工坊提示词照旧拼出 `imageGuide`（教它出图、`NO_IMAGE_GUIDE` 永不生效），模型只能靠调用失败的那句回执才知道。`test/agentkit.test.ts:190-200` 只验证了「能力被 play.json 关掉时 `can.image` 翻假」，没有覆盖「后端缺失」这一维。音乐那条路没有这个问题（工具真不注册）。

**另一种「配了但不可用」**：`createImageBackend` 只检查 `enabled`，**不检查 `baseUrl`/`apiKey` 是否为空**。`enabled:true` + 空地址仍会造出 backend、`available:true`，但每次出图都在 fetch 时炸（相对 URL 解析失败 / 401），错因要等一次真出图才暴露。

**配错会炸在装配期**：`GeminiImageGen` 构造函数在 `size` 是字面像素时直接抛错（`geminiImage.ts:66-70`，文案：要按像素出图请换 `STAGE_IMAGE_FORMAT=openai`）。该抛错发生在 `rebuildClients()` 里，而 `rebuildClients` 被构造期（`playhouse.ts:230`）与 `applySettings`（`:256`）直接调用，**没有 try/catch**；`applySettings` 又挂在 `settings.subscribe`（`:232`）上，`SettingsStore.subscribe` 的 notify 也没有兜底（`settingsStore.ts:84-87`）。按读码推断：写进一个 `format=gemini` + 像素尺寸的设置会让保存请求抛错（且设置已先落盘），重启后同样在启动期抛出。**这一条我只读了代码，没有实跑验证。**

### 3.4 本机实际配置

数据目录＝仓库根（开发态）。**运行期设置的唯一真相源是 `<dataRoot>/settings.json`**；根目录的 `.env` 只在**第一次启动且没有 settings.json 时**参与迁移，此后与运行期设置无关（`settingsStore.ts:7-8`、`:56`；`index.ts:42` 注释同口径）。本机 `settings.json` 存在，所以 **`.env` 现在不生效**（它的 `STAGE_IMAGE_*` 与 settings 恰好一致，看不出差别）。

本机 `settings.json` 实测（凭据掩码）：

- `image`：`enabled: true`、`format: "gemini"`、`baseUrl: "http://127.0.0.1:38000"`、`apiKey` 已填（值不在此记录）、`model: "gemini-3.1-flash-image"`、`size: "1K"`、`concurrency: 6`、`timeoutMs: 180000`、`reference: "neutral"`。
- `music`：`enabled: true`、`baseUrl: ""`、`apiKey: ""`（**都留空 → 回落生图那一份地址与 key**）、`model: "flow-music-lyria-3.5"`、`timeoutMs: 300000`。
- 结论：本机 `imageBackend` 与 `musicBackend` 都非 null，**生图与 BGM 两项能力在界面上都是 `available: true`**。
- 38000 是本机 flow2api（Google Flow 逆向网关）；`.env` 的注释与 README 都写明了这条：`gemini-3.1-flash-image` 是「裸名、吃 `imageConfig`」，别名模型（`…-portrait-2k`）会把画幅档位写死、忽略 `imageConfig`。**未确认**：该网关此刻是否在跑（本次调研没起服务、没发请求）。

---

## 4. 移植这半边的工作量点（只摆事实与难点）

### 4.1 纯逻辑，可直搬

- **`cutout.ts`（566 行）**：自包含的纯函数，输入 Buffer 输出 Buffer，只依赖 `sharp` 与 5 个环境变量。没有任何剧目/HTTP/UI 概念。`cli-cutout.ts`（20 行）是它的命令行包装。
- **三个生图 provider（`geminiImage.ts` / `openaiImage.ts` / `modelslabImage.ts`）**：纯 HTTP + 协议适配，只依赖 `undici`。各自把「上游的坑」写在注释里（画幅静默降级、垫图张数、单边 1024、K 大小写、`processing` 异步队列不接轮询）——这些是**上游事实**，与 AIVN 无关。
- **`musicBackend.ts`**：同上，Gemini 形状单一协议 + mime→扩展名映射表。
- **`imageBackend.ts` 的画幅白名单与像素嗅探**（`IMAGE_ASPECTS`、`sizeOfImage`、`aspectMatches`、`extOf`、`tierArea`/`canvasFor`）：纯算术与字节解析。
- **`playAssets.ts` 的草稿/入库/重抠/台账/声明逻辑**：本身是纯逻辑，但**签名绑着 AIVN 的 `PlayStore` + `PlayFiles` + `Limiter` + `PendingJobs` + `WebImageFetcher` 五个依赖**（`playAssets.ts:219-234`）。搬过去要重写的是这层适配，不是算法。
- **`playMusic.ts` 的元数据合并规则**（只补确知的格、音量只在没有既有值时兜 0.4、`source` 恒写站内生成）：规则本身可以直接照抄。
- **`imageMime.ts` / `generatedLedger.ts`**（32 行）：纯读。
- **参数 schema 与工具描述**：`imageTool.ts` 的 `PROMPT_RULES` / `REFERENCE_RULE` / `SYNC_DESCRIPTION` 是**给模型看的文本契约**，与运行时无关，可直接搬——但要注意 `variant` 缺省那句与实现不符（5.1）。

### 4.2 绑着 AIVN 自己的运行时 / HTTP / 工坊 UI

- **没有 `PlayStore` / `PlayFiles` 这层。** AIVN 的素材工具落盘走 `PlayFiles.writeBinary`、`store.assetPath`、`store.deleteAsset`、`withPlayConfigLock`（剧目级读-改-写锁）。DSH 插件侧目前是 `src/assets.ts`（98 行，同步 `readdirSync` 读索引 + 读 manifest + 路径越界守卫），**没有 PlayStore / 没有剧目配置锁 / 没有二进制写口**。要落地素材工具，这层得先补齐（尤其是「一张表一个写者 + 读-改-写整表」的锁语义：manifest.json 现在有三个写者，键位不重叠才勉强安全）。
- **工坊 UI 的通道**：`onAsset` 推素材气泡、`onWrite` 推刷新信号、`pending_jobs` 做「在生成的事」面板、`asset_ready` / `asset_failed` 广播、`/plays/:id/drafts/...` 草稿静态路由（`http.ts:177-189`）。插件侧对应的舞台/tab 机制不同，**这条是纯适配工作量**，而且是「看不见但缺了就残废」的那种：草稿预览没有 URL 就没有「让用户挑候选」的流程。
- **`pendingJobs`**：生图在飞记账（`PlayAssets.produce` 里 `begin`/`done`）与 BGM 后台记账（`queueMusic`）。不做顶多是没有进度条，做得不对会出「失败项自动蒸发 / busy 永久锁死」这类事故（`playhouse.ts:449-452` 那段注释就是踩过的坑）。
- **`imageApproval` 与 `agents.workshop.capabilities`**：属于 AIVN 的 `play.json` + Agent 设置页这一套。插件要么复刻、要么换成 DSH 自己的设置面。注意它**只是提示词约束**，移植时若想「真的拦住」，需要新机制（现有代码里没有）。
- **`composeImagePrompt` / `imagePrompt.ts`**：**不在工坊工具这条路上**（1.2 已证），除非同时要搬「素材页手动生图」与「舞台 WS 生 CG」。别把它当成 `generate_image` 的一部分。
- **默认能力集**：`defaultCapabilitiesFor` 对工坊是「目录里属于它的能力减 `shell`」（`kit.ts:336-340`），所以新增能力会**默认被装上**。移植时要决定插件侧是不是也要这套「默认全开减 shell」的口径。

### 4.3 依赖本机特供后端

- **生图走的不是官方 API，是本机 flow2api（`http://127.0.0.1:38000`）。** 证据链：本机 `settings.json` 的 `image.baseUrl`；`.env` 注释「本机走 flow2api（Google Flow 逆向网关，38000）；cpa（9999）两种格式都认」；`geminiImage.ts:31-32` 提到别名模型把画幅写死在模型名里；项目 AGENTS.md「生图后端本机默认走 flow2api…cpa 网关的 `gemini-3.1-flash-image` 几分钟就撞一次 429」。**这意味着「能出图」这件事依赖一个本机常驻的第三方网关进程**，而它不在这个仓库里。
- **BGM 与生图共用同一个网关**（`config.ts:490-495` 的回落就是照这个事实设计的；`musicBackend.ts:8-9` 明说 flow2api 同时挂 `flow-music-*`）。所以音乐生成也不是「换个 key 就能用」。
- **画幅受网关能力约束**：`packages/core/src/play/framing.ts:47-56` 记载走 flow2api 时 Google Flow 只有 1:1 / 9:16 / 16:9 / 4:3 / 3:4 五档，`2:3` 会被静默退回 16:9；`half` 用的 3:4 曾被网关接反、2026-10-04 才在网关出口换算里修正。**这是「上游行为」而不是「本仓库行为」**，移植时要么一并带上这台网关，要么换后端并重新验画幅。
- **`sharp` 是原生依赖**：`cutout.ts:1` 直接 `import sharp`。
- **参考图下载走环境代理**（`HTTP_PROXY`/`HTTPS_PROXY`，`webImage.ts:109-112`），本机是 Clash 7890——属于部署环境事实，不是代码依赖。

### 4.4 语义冲突（搬之前要拍的板）

- **`list_library` 重名但不同物**：AIVN 工坊的 `list_library` 查的是**应用级跨剧目资源库**（`<dataRoot>/library/`，`list_library` 描述里明说「库和剧目各存一份…删库不影响剧目」）；DSH 插件 `src/playwriter/tools/list-library.ts` 的 `list_library` 查的是**剧目自己的 `assets/` + manifest**，文件注释里写着「资源库导入是下一阶段的事」。两个同名工具语义不同，移植时要么改语义、要么改名。
- **`import_asset` 是「复制而不是引用」**：剧目自包含这条取舍写死在 `assetImport.ts:24-28`。插件侧若没有「应用级资源库」这个概念，`import_asset` 就没有源可导——**它依赖 `library/` 这个数据目录的整个概念**（含 `meta.json`、`KIND_EXT` 白名单、`characters`/`sprites` 两类多文件条目）。这是这半边里**前置条件最重**的一块：不是搬一个工具，是搬一个目录约定 + 一套 meta 格式 + 导入语义。
- **`generate_image` 的 sync/queued 一具两形**：工坊要「等图 + 贴预览 + 只出草稿」，剧作家要「发起即返回 + 占时间线位置」。同一份 schema 两种等待策略与两套回执文案，移植时不能只搬一半。

---

## 5. 没读到 / 不确定的地方

### 5.1 `generate_image(sync)` 省略 `variant` 会抛错，但描述说「按 neutral」——**读码得出，未实跑**

SYNC_DESCRIPTION 写「立绘给 spriteId + variant（**variant 不给按 neutral**）」（`imageTool.ts:130`），工具头注释同口径（`:41`）。但同步链路把 `undefined` 原样传下去：

- `imageTool.ts:254`：`variant: typeof params.variant === "string" ? params.variant : undefined`
- `playAssets.ts:292-302`（`draft`）→ `:636-645`（`resolve`）→ `:746-748`（`resolveSprite`）：`assertAssetStem(target.variant ?? "", "差分名")`
- `playAssets.ts:58-65`：空串 → 抛「差分名不能为空」

对照：**剧作家 queued 那条有显式兜底** `params.variant?.trim() || "neutral"`（`imageTool.ts:282`），**`recut_sprite` 也有**（`recutTool.ts:87`）。测试 `test/image.test.ts:104-105`、`:151` 锁的正是 queued 的缺省行为；**我没有找到任何 sync + 省略 variant 的用例**。

结论（按读码）：工坊调 `generate_image(kind="sprite", spriteId="x")` 会得到 `生图失败：差分名不能为空`，与描述不符。**未实跑验证**（未起服务、未发请求）。移植前建议先用一条最小用例把它钉死，再决定「照描述补上兜底」还是「照实现改描述」。

### 5.2 `can.image` 不反映生图后端可用性——已从代码确定，但只验证到测试覆盖的空档

见 3.3。代码路径明确（`kit.ts:491-508` 恒注册 → `capabilitiesOf` 只判「工具在不在」→ `can.image` 恒真），`test/agentkit.test.ts:190-200` 只覆盖了「能力被关」这一维。我**没有实跑**「关掉 `image.enabled` 后工坊提示词是否仍拼 `imageGuide`」这一条端到端路径。

### 5.3 配错设置会炸在装配期——**读码推断，未实跑**

见 3.3 末段。我确认了「`GeminiImageGen` 构造抛错」「`rebuildClients` 无 try/catch」「`applySettings` 挂在 subscribe 上」「subscribe/notify 无兜底」四处，但**没有实际写入一份非法设置去观察**（本次任务禁止改动文件，写入 settings.json 属于改文件）。所以「保存请求返回 500」「重启后启动失败」这两句是推断而非观测。

### 5.4 本机 flow2api 的实时状态未确认

`settings.json` 指向 `http://127.0.0.1:38000`，但我没有探测该端口是否在跑、`flow-music-lyria-3.5` 是否仍可用。**「本机实际能出图/能出 BGM」这一点未确认**——只确认了配置指向它。

### 5.5 没有细读的部分（与本次范围相邻）

- `view_image`（`agentkit/viewTool.ts`）与 `webImage.ts` 的下载/缓存全貌：它属于「搭台辅助」组，不在本次六个工具内，只在「网址参考图」这条路上被 `PlayAssets` 用到（`:871-884`）。本次只读了 `webImage.ts` 的代理部分。
- `library.ts` 的完整实现（`meta.json` 解析细节、`libraryEntryMatches`、`describeAsset` 在 core 里的定义）：只读了 `KIND_EXT`、`list` / `entry` 的签名与库根目录来源。
- DSH 插件侧只做了最小定向（`src/assets.ts`、`src/playwriter/tools/list-library.ts`、`package.json`、目录树），**没有通读**其 stage/tab 与工具装配；4.2 / 4.4 里对插件的判断基于这些定点阅读，不是全面评估。
- 本机 `.env` 与 `settings.json` 的逐字段比对只做了 image/music 两块（且已确认 `.env` 当前不生效）。
