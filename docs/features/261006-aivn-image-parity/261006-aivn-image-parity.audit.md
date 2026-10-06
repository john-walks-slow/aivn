# AIVN 生图 / 立绘 / 抠底改进 ↔ DSH 插件受益核对

- 日期：2026-10-06
- 参照物：`/root/projects/stage-ai`（AIVN，main）
- 被审对象：`/root/projects/dsh-aivn`（DSH 插件）
- 方法：`git log --oneline --since="3 weeks ago" -- apps/server/src packages/core/src/play apps/web/src/stage packages/stage/src` + `git show --stat` 圈出候选提交，逐条**读两边实际代码**后下结论。全程只读，未改任何代码。
- 结论口径：**已受益** = 插件里有等价实现；**未受益** = 插件缺这块能力；**不适用** = AIVN 的 UI / 工坊面板 / 桌面壳 / 本地调试脚本专属，插件是「工具面 + 舞台 tab」，没有对应落点；**不确定** = 说不清。

---

## 1. 总表

| AIVN 提交 | 改了什么（一句话） | 插件现状 | 结论 | 证据（两边 file:line） |
| --- | --- | --- | --- | --- |
| `a7809fe3` 抠底改纯色键 | 立绘抠底从「白底+滞回+连通域」换成纯色键（边框逐通道中位数 + 边界两侧闭式解反解覆盖率 + unblend），底色改由出图提示词负责 | 算法逐行照搬，仅把五个环境变量前缀从 `STAGE_CUTOUT_*` 换成 `DSH_AIVN_CUTOUT_*` | **已受益** | AIVN `apps/server/src/cutout.ts:221-240,342-388,479-509`；DSH `src/media/cutout.ts:224-243,345-391,482-512`（归一化 diff 仅差一个未用的 `CANVAS_WIDTH` 常量） |
| `872631c7` 细描边不被反解吃掉 | `solveAlpha`（逐通道比值取中位数）换成 `solveMix`（B→F 最小二乘投影 + 残差）；残差 > `solidResidual` 且不在色键里 → 判实心前景，描边留住 | `solveMix` + `edgeAlpha` 的 `mix.residual > solidResidual` 分支一字不差；`solidResidual` 默认 48 且 `recut_sprite` / `DSH_AIVN_CUTOUT_SOLID_RESIDUAL` 两个口子都在 | **已受益** | AIVN `cutout.ts:451-469,381-384,125`；DSH `src/media/cutout.ts:454-472,384-387,128` |
| `338dcf6c` 限色去绿边 + 低覆盖率混前景色 + 定妆照 3 候选 | 新增 `spill` 限色（默认 20）；`unblend` 在低覆盖率处混邻近实心前景色（修银发压绿幕的品红光晕）；定妆照建议一次出 3 张候选 | `despill` / `smoothstep` 低覆盖率混合一致；「定妆照建议一次出 3 张候选」写进了工具描述 | **已受益** | AIVN `cutout.ts:122,479-528`；DSH `src/media/cutout.ts:125,482-531`、`src/stagehand/tools/generate-image.ts:30` |
| `d8a19b73` 角色卡显式绑定立绘目录 | core 加 `CharacterHead.sprite` + `spriteIdOf()`；A 区差分清单跟着绑定目录走、绑走的目录不再重复列；人设按立绘目录反查卡 | 用 core 的 `spriteIdOf()` 渲染 A 区，绑定目录标注「（目录 xxx）」，未被绑的目录单列一节 | **已受益** | AIVN `packages/core/src/play/characterCard.ts:104-107`、`apps/server/src/prompt.ts:254-258`；DSH `src/play-context.ts:195-196,202,217`（core 走 `file:` 软链，实时同步） |
| `f935805f` 差分多选批量出图 + 身份基准 | 工坊对话框支持多选差分一次发起；工具描述把「身份基准恒为已入库 neutral」摆到明面上 | 批量 = 同一批里并行多次调 `generate_image`，描述里写明；UI 多选无落点 | **已受益**（UI 部分见「不适用」） | AIVN `apps/server/src/agentkit/imageTool.ts:52-58`；DSH `src/stagehand/tools/generate-image.ts:26-29` |
| `5cea9a67` modelslab 第三种格式 | 新增 `format: gemini \| openai \| modelslab`；modelslab 走 `base64_to_url` 两步垫图、单边封顶 1024、`enhance_prompt/safety_checker` 写死 false | 三种格式全支持，端点 / 垫图 / 尺寸口径逐条一致（构造器注入 fetch 换成全局 fetch、apiKey 改可选，属插件侧有意差异） | **已受益** | AIVN `apps/server/src/modelslabImage.ts:75-111,117-130`、`imageFactory.ts`；DSH `src/media/modelslab-image.ts`（归一化 diff 仅注释/配置名）、`src/media/backends.ts:80-89`、`src/index.ts:121` |
| `faaa543b` 立绘成为一等素材 | 角色卡瘦身为纯人格（id/name/sprite/voice/voiceId）；立绘声明（framing/stature/anchor/title）全归 `assets/manifest.json`；无卡主体同权 | 出图按 `spriteId` 落 `assets/sprites/<id>/`，不要求有卡；`declareSprite` 写 manifest；A 区分「角色表」与「有立绘没卡」两节 | **已受益**（资源库导入部分见「不适用」） | AIVN `playAssets.ts:920-951`、`prompt.ts:254-258`；DSH `src/media/assets.ts:340-369,496-518`、`src/play-context.ts:195-222` |
| `de7e4da0` 出图与入库解耦 | `draft()` 只落 `media-cache/drafts/<id>/`（成图 + 抠底前原片 + draft.json），`commit()` 才写 `assets/`、补声明、记台账、搬 `sprite-sources/` | `draft` / `commit` / `generate` 三分完全对齐：搭台助手两步走，剧作家一步做完；草稿 TTL 7 天、重抠的原片留底、`generated.json` 只记出图与 BGM | **已受益** | AIVN `playAssets.ts:290-330,421-431,483-520`、`agentkit/commitTool.ts`；DSH `src/media/assets.ts:196-306,411-447,467-494`、`src/stagehand/tools/commit-asset.ts`、`src/playwriter/tools/generate-image.ts:44` |
| `1ecb5161` 手动生图统一内核 + 垫参考立绘 | 新增 `imagePrompt.ts`（按 sprite/background/cg 选系统提示词、拼 craft + 角色卡 + 参考图编号）；REST 同步发起 + WS `image_result` 回报；舞台可有序多选参考立绘 | 无手动生图 UI、无导演栏（`onGenerateCg={noop}`）；「写提示词的模型」在插件里就是 agent 本人，不需要第二层 LLM | **不适用**（内核）/ **未受益**（垫图编号锚点，见附表第 3 条） | AIVN `apps/server/src/imagePrompt.ts:8-36,66-144`、`http.ts` 的 `POST /api/plays/:id/images`；DSH `src/client/stage-view.tsx:484,489`（`directorBar={false}` / `onGenerateCg={noop}`）、`src/media/generate-tool.ts:83-102` |
| `84fc4f04` 立绘整体下移、头顶留白加宽 | `packages/core/src/play/spriteStage.ts` 的 `top` 统一 +8 | 走 core 的 `spriteStagePreset`（`@aivn/stage` 的 `StageTheater` 调用它），core dist 与 src 同步 | **已受益** | AIVN `packages/core/src/play/spriteStage.ts:60-77`；DSH `src/client/stage-view.tsx:24,472`（`StageTheater`）→ 舞台包 `StageTheater.tsx:254` |
| `ef9877ec`（10-02）立绘提示词加头顶留白规则 | `POSE_TAIL` 末尾补「矮角色头顶多留、高角色少留」，防矮个子贴边 | 插件的 `POSE_TAIL` 只有前一句（手臂不夹窄缝），留白那句丢了 | **未受益**（并入附表第 2 条） | AIVN `playAssets.ts:1134-1140`；DSH `src/media/assets.ts:78-80` |
| `98650849`（10-06）立绘层级按 orderSeq / 说话状态 | 舞台 `Sprite` 加 `zIndex`：后上场更高、说话中 +1000 置顶 | 插件的 `@aivn/stage` 取自 worktree 分叉（`feat/dsh-vn-stage`，10-05 13:03），`git merge-base --is-ancestor 98650849 HEAD` = **NO** | **未受益**（依赖分叉滞后，见附表第 10 条） | AIVN `apps/web/src/stage/StageTheater.tsx:199-200,255,275`；DSH `package.json:57`（`file:../stage-ai/.worktrees/dsh-vn-stage/packages/stage`）、worktree 的 `packages/stage/src/StageTheater.tsx` 无 `zIndex` |

### 1.1 用户点名的五件事，逐条结论

| 点名项 | 结论 | 说明 |
| --- | --- | --- |
| 抠底算法细节（绿幕约定 / 限色去绿边 / 低覆盖率混前景色 / 细描边保留 / 参数默认值） | **完全同步** | 归一化 diff 只差一个未使用的常量；默认值 48 / 0.8 / 4 / 20 / 48 五项一致（AIVN `cutout.ts:111,114,118,122,125` ↔ DSH `cutout.ts:114,117,121,125,128`）。绿幕底色约定也就是同一条英文 `KEY_BACKGROUND`（AIVN `playAssets.ts:1099-1103` ↔ DSH `assets.ts:66-70`） |
| 出图提示词脚手架（三种措辞 / 绿幕要求 / 身份基准 / 差分与定妆照关系） | **部分未受益** | 绿幕要求、垫图=身份基准、草稿不是基准这三条已同步；但**立绘后缀缺四段**（景别措辞、差分身份锁、非人留白、头顶留白）、**背景/CG 缺参考图编号锚点**，且 **neutral 定妆照完全不能垫参考图**（与工具描述自相矛盾） |
| 后端格式支持面 | **3/3 全支持** | gemini / openai / modelslab 全在（`backends.ts:19,80-89`）。参数差异：① 插件的 `apiKey` 可选（不配就不带鉴权头，AIVN 必填）；② 网络走全局 fetch（AIVN 注入 undici fetch，为可测性）；③ **插件不读 `play.json` 的 `image.model` / `image.size` 逐剧目覆盖**；④ 其余端点、垫图规则、尺寸上限、`assertCanvas` 一致 |
| 草稿 → 采用两步流 / 重抠覆盖台账的语义 | **已受益** | draft 落 `media-cache/drafts/`、commit 写 assets + manifest + `generated.json` + 搬 `sprite-sources/`；`recut` **不碰台账**（只覆盖 PNG），与 AIVN 的「台账写者只有出图与 BGM」同口径（DSH `assets.ts:267-276`）。差异只有「剧作家自动补定妆照」缺（附表第 4 条） |
| 角色卡 `sprite` 绑定 / 差分批量 / `assets/sprites/<主体id>/` 目录约定 | **对齐** | 绑定解析统一走 core `spriteIdOf`（DSH `play-context.ts:195`、`list-assets.ts:131`）；差分批量 = 并行多次调用；目录约定两边都是 `assets/sprites/<主体id>/<差分名>`。唯一毛刺：`list-assets.ts:132` 读 `manifest['sprites/<id>'].variants`，而引擎写的键是 `manifest['<id>']`（`assets.ts:497-518`），所以那一列**永远为空**（差分清单实际由 A 区 `play-context.ts:186-187` 读目录给出） |

---

## 2. 未受益清单（按价值排序）

> 「改动量」按只动插件、不动 AIVN 估算。

### 2.1 【高】定妆照（neutral）不能垫任何参考图 —— 与工具描述、README 自相矛盾

- **缺什么**：AIVN 只在「非 neutral 的差分」上禁止显式 `references`；**neutral 定妆照是允许的**，这正是「用户拿一张既有角色图来定妆」的唯一入口（`referencesFor` 的注释与 `REFERENCE_RULE` 都这么写）。插件把这条禁令套在**所有** `kind=sprite` 上，于是 neutral + references 直接抛错。
- **症状**：剧作家/搭台助手按工具描述调用 `generate_image(kind="sprite", spriteId="lin", references=["assets/refs/lin.png"])` 会拿到「立绘差分不吃显式垫图」——一句对 neutral 根本不成立的话。用户没有任何办法用既有图定妆。
- **要动**：`src/media/assets.ts:205-211`（把 `if (target.references?.length)` 收进 `spec.variant !== NEUTRAL` 分支）——**1 行条件**，外加 `src/media/generate-tool.ts:99` 的 REFERENCE_RULE 已经写对了，不用改。
- **前置依赖**：无。

### 2.2 【高】立绘提示词后缀缺 AIVN 的四段

- **缺什么**（AIVN `playAssets.ts:1150-1213`，插件 `assets.ts:626-629` 只有 `COMMON_TAIL + KEY_BACKGROUND + POSE_TAIL`）：
  1. **景别措辞** `SPRITE_FRAMING_SHOT[framing]`（core 已有，`packages/core/src/play/framing.ts`）：`half` 的 3:4 画幅里不写 "medium shot, waist-up"，模型照样画全身——AIVN 的注释明说「写死 9:16 全身时半身角色照样会被画成全身」。
  2. **差分身份锁** `IDENTITY_TAIL` / `HUMAN_IDENTITY` / `PROP_IDENTITY`（「Same character as the reference image: identical hairstyle… Change only the facial expression.」+「同底色同画风」）：垫图之外的第二道保险，非 neutral 立绘现在是**一个字都不加**。
  3. **非人留白** `PROP_TAIL`（`:1160-1162`，`square` 走它）：「整个主体完整入画、四周留空」——插件对 `square` 既不拼 `POSE_TAIL` 也不拼 `PROP_TAIL`，非人主体可能被裁到画面边上，抠底就断。
  4. **头顶留白** `POSE_TAIL` 的第二句（`ef9877ec`，`:1139-1140`）。
- **症状**：`framing` 有效（画幅对）但画面内容不一定对；差分之间靠垫图硬撑，没第二道锁；`square` 主体贴边。
- **要动**：`src/media/assets.ts` 把 `spriteTail()` 拆成 `neutralSuffix()` / `identitySuffix()` / `humanSuffix()` / `propTail`（约 60–80 行，措辞照抄 AIVN）。`SPRITE_FRAMING_SHOT` 直接从 `@aivn/core` import 即可。
- **前置依赖**：无（core 已导出）。注意：拆的时候要按 `spec.variant === NEUTRAL` 分流，所以和 2.4 有代码位置重叠，建议一起做。

### 2.3 【高】背景 / CG 垫图没有「第几张是谁」的编号锚点

- **缺什么**：AIVN 的 `suffixFor()`（`playAssets.ts:1009-1017`）+ `referenceSuffix` / `genericReferenceSuffix`（`:1032-1083`）会把 `references` 的**顺序**写进提示词（`The attached reference images are, in this exact order: 1) 七濑, 2) 澪 … Do not merge them into one person.`）。图片本身没有名字，模型只看到「第一张、第二张」。
- **症状**：多人 CG 垫两张立绘时，模型各画各的——**不报错、图还挺好看**，只是七濑长成了澪。插件现在只对 `kind=sprite` 拼后缀，背景/CG 的 `references` 是裸传的。
- **要动**：`src/media/assets.ts:219`（`full` 的拼装）加一条非立绘分支（约 25 行）；`references()` 里已能拿到主体 id，只差把「name」解析出来（AIVN 用 `referenceSprites`）。
- **前置依赖**：需要从 `references` 数组反查主体名（插件 `resolve()` 已有 `readManifest` 与 `spriteIdOf`，成本低）。

### 2.4 【中高】剧作家路径缺「自动补定妆照」

- **缺什么**：AIVN 的 `generate()`（剧作家 / 手动生图那条路）先跑 `ensureNeutral()`（`playAssets.ts:421-423, 780-808`）：非 neutral 且该主体一个差分都没有时，**自动先出一张 neutral**（带 `NEUTRAL_LEAD` 中性前置描述压住表情词、按立绘级取景走），再派生差分；已有其它差分时改成报错（防止静默换脸）。插件 `generate()` → `draft()` 一律直接抛「先出定妆照候选…」（`assets.ts:212-216, 244-256`）。
- **症状**：演出中剧作家需要一条新差分（`<actor id="lin" variant="angry">` 但 `assets/sprites/lin/` 只有 neutral 之外的情况）会硬失败在工具层；而 AIVN 在那条路上会顺手补一张。
- **要动**：`src/media/assets.ts` 把「neutral 前置校验」从 `draft()` 提到 `generate()`，加 `ensureNeutral()` + `NEUTRAL_LEAD` 常量（约 40 行）；`src/playwriter/prompt.ts:246-247` 的措辞要跟着改（现在写的是「那个主体得先有 neutral」）。
- **前置依赖**：2.2 拆出来的 `neutralSuffix`（自动补的那张要走 neutral 后缀）。

### 2.5 【中】缺「剧目里已有同名素材就跳过」的守卫

- **缺什么**：AIVN 的剧作家工具在发起前先查（`agentkit/imageTool.ts:283`（立绘）、`:307-309`（背景/CG）），已有就回一句「不用重出」。插件完全没有这道守卫，剧作家重复调用会**覆盖旧图 + 白烧一份配额**，只靠工具描述里的「先 `list_assets` 看一眼」。
- **症状**：模型忘了一次 list_assets，用户刚验收过的图被顶掉。
- **要动**：`src/media/assets.ts` 暴露一个 `exists(target)`（内部已有私有 `existing()`，约 15 行）+ `src/playwriter/tools/generate-image.ts` 调用（约 5 行）。
- **前置依赖**：无。

### 2.6 【中】`declareSprite` 会用差分取景覆盖立绘级基准

- **缺什么**：AIVN 只在 `variant === NEUTRAL` 时写立绘级 `framing`（`playAssets.ts:939`：「立绘级取景以 neutral 那次为准：它是所有差分的垫图基准，一条 closeup 不该把基准带跑」），差分不同才写 `<id>/<variant>` 覆盖。插件对**任何**带了 `framing` 的差分都写立绘级（`assets.ts:507`），于是差分级的「不覆盖」判断永远为假，覆盖键也白写。
- **症状**：给全身主体出一条 `half` 差分，整个主体的舞台摆位被带跑（同一目录下所有差分与兜底图一起变）。
- **要动**：`src/media/assets.ts:497-518`，把 `framing` 收进 `spec.variant === NEUTRAL` 条件（约 6 行）。
- **前置依赖**：无。

### 2.7 【中】不读 `play.json` 的 `image` 段（逐剧目模型 / 档位覆盖）

- **缺什么**：AIVN 每次出图现读 `play.json` 的 `image.model` / `image.size` 覆盖部署级（`playAssets.ts:243-249`，core `config.ts:231` 的 `PlayImageConfig`）。插件只读全局设置（`src/index.ts:97-103`），README 也明说「`image` 段本插件当前不读」（`README.md:161`）。
- **现状**：管线其实**已经铺好**——`AssetTarget.model/size`（`assets.ts:99-101`）与 `ImageRequest.model/size`（`image.ts:83-86`）都在，`assets.ts:220-228` 也透传了，只是没有任何调用方填这两个字段，`toTarget()`（`generate-tool.ts:123-138`）也没有这两个参数。
- **要动**：① 读 `play.json` 的 `image` 段（`src/assets.ts` 或 `src/play.ts`，约 15 行）；② `src/media/generate-tool.ts` 的 schema 加 `model` / `size` 并透传（约 10 行）；③ README 那一行删掉。
- **前置依赖**：无。

### 2.8 【中】垫图不接受 http(s) 网址

- **缺什么**：AIVN 的 `references` 支持「主体 id / 剧目内路径 / http(s) 网址」三态（`imageTool.ts:113-120`、`playAssets.ts:682-720,871-880`），网址经 `webImage.ts` 下载（带回环/私网/云元数据拒答 + 每跳重定向重判）。插件的 `references()`（`assets.ts:388-394`）只走 `resolveInPlay`，给 URL 会拿到「垫图路径越界」。
- **症状**：用户在网上看到一张想要的参考图，没有任何入口喂进来（只能自己先下载进剧目目录）。
- **要动**：新增一个 HTTP 图片下载器（含 SSRF 防护，约 60 行）+ `assets.ts:387-396` 加 URL 分支（约 10 行）+ 描述更新。
- **前置依赖**：需要一个「按 URL 缓存到 `media-cache/`」的落点（插件现在没有 `web-images/` 这一层）。

### 2.9 【低】差分常用词表没用 core 的共享词表

- **缺什么**：AIVN 的 `variant` 描述用 `COMMON_SPRITE_VARIANTS.join(" / ")`（`agentkit/imageTool.ts:3,48`，core `packages/core/src/play/spriteVariants.ts`，14 个词 + 素材页 chips 同一份）。插件硬编码 `'neutral / smile / sad / damaged / sleepy…'`（`src/media/generate-tool.ts:38`）。
- **症状**：只是给模型的抄写起点，漂移风险大于当下损失。
- **要动**：`generate-tool.ts:38` 一行 + import。
- **前置依赖**：无。

### 2.10 【中低】舞台立绘层级没跟上（`@aivn/stage` 是分叉的 worktree）

- **缺什么**：插件 `package.json:57` 把 `@aivn/stage` 指向 `../stage-ai/.worktrees/dsh-vn-stage/packages/stage`，该分支 HEAD 停在 10-05 13:03：`git merge-base --is-ancestor 98650849 HEAD` = **NO**（立绘 zIndex：后上场更高、说话中置顶），`1114ff34`（`scene clear`）同样 = NO。
- **症状**：多人同台时立绘叠压顺序只按 DOM 顺序，说话的那个不一定在最上层；往后 AIVN 在舞台层的每一处改进都不会自动到达插件。
- **要动**：把 `dsh-vn-stage` worktree rebase / cherry-pick 到 main（或改成把抽包做进 main 的 `packages/stage`），然后重装 `@aivn/stage`。
- **前置依赖**：是其它所有「舞台层」条目的**共同前置**——不解决它，舞台侧的同步永远是手动的。

### 2.11 【低】其它零碎

| 项 | 缺什么 | 要动 |
| --- | --- | --- |
| `list-assets.ts:132` 读错 manifest 键 | 读 `manifest['sprites/<id>'].variants`，引擎写的是 `manifest['<id>']`，那一列恒空 | 1 行（改键或改读目录索引，A 区 `play-context.ts:186-187` 已有正确写法） |
| 前端出图工具契约没提 `sprite:` 绑定 | AIVN 的 `spriteId` 描述明写「卡上写了 `sprite:` 时立绘在它指的那个目录里」，插件的 `IMAGE_PARAMETERS.spriteId` 只说「目录名」；A 区虽标了「（目录 xxx）」 | 1–2 行 |
| 媒体层无回归用例 | 插件没有 `test/` 目录；AIVN 的 `cutout.test.ts` 钉住了色键、带符号分母、unblend、细描边四件事，插件照搬算法但没照搬用例 | 新建 `test/cutout.test.ts`（夹具要从 AIVN 抄） |
| 无本地抠底调参脚本 | AIVN 有 `apps/server/src/cli-cutout.ts`（20 行） | 可选；插件的等价物是 `recut_sprite` 调参 |

---

## 3. 已受益清单

| 项 | 证据 |
| --- | --- |
| 抠底算法（纯色键 / 限色 / 低覆盖率混合 / 细描边实心判据 / 五档默认值）全量同步 | AIVN `cutout.ts:111-128,221-240,342-388,479-528` ↔ DSH `src/media/cutout.ts:114-130,224-243,345-391,482-531`；归一化 diff 仅多/少一个未用常量 |
| 抠底调参面（`recut_sprite` 五参数 + `DSH_AIVN_CUTOUT_*` 环境变量） | DSH `src/stagehand/tools/recut-sprite.ts:37-52`、`src/media/cutout.ts:114-128`、`README.md:400-410` |
| 绿幕底色约定（纯绿 #00FF00，绿色系主体换品红） | AIVN `playAssets.ts:1099-1103` ↔ DSH `assets.ts:66-70`（逐字） |
| 立绘公共后缀（2D 平涂画风 + 单一纯色键底 + 手臂不留窄缝） | AIVN `playAssets.ts:1119-1140` ↔ DSH `assets.ts:61-80,626-629` |
| 草稿 → 采用两步流（draft/commit/generate 三分、TTL 7 天、幂等重复采用） | AIVN `playAssets.ts:290-330,483-520` ↔ DSH `assets.ts:196-306,560-603`、`src/stagehand/tools/commit-asset.ts` |
| 重抠语义（拿留底原片原地重跑、覆盖 PNG、**不动台账**、没留底如实报错） | AIVN `playAssets.ts:363-387` ↔ DSH `assets.ts:267-276,481-494` |
| 立绘身份基准（非 neutral 恒垫已入库 neutral；草稿当不了基准；显式垫图被拒） | AIVN `playAssets.ts:823-840` ↔ DSH `assets.ts:212-217,377-397` |
| 立绘留底原片（入库时搬进 `media-cache/sprite-sources/<主体id>/`） | AIVN `playAssets.ts:377-387` ↔ DSH `assets.ts:468-494` |
| 三种生图格式（gemini / openai / modelslab）与各自铁律 | AIVN `geminiImage.ts` / `openaiImage.ts` / `modelslabImage.ts` ↔ DSH `src/media/{gemini,openai,modelslab}-image.ts`（归一化 diff 只有注释、配置名、fetch 注入三处） |
| 画幅与档位契约（`IMAGE_ASPECTS` 交集白名单、`1K/2K/4K` 大写、`minTier: 2K` 只给立绘、落盘前 `assertCanvas`） | AIVN `imageBackend.ts:20-31,44,100`、`playAssets.ts:459` ↔ DSH `image.ts:22-43,97,160-166`、`assets.ts:226,610-620` |
| 立绘取景 / 体量 / 对齐 → 舞台摆位（core `spriteStagePreset`，含 10-04 的头顶留白 +8） | `packages/core/src/play/spriteStage.ts:60-77`（core dist 与 src 同步）↔ DSH `src/client/stage-view.tsx:24,472` → `@aivn/stage` 的 `StageTheater.tsx:254` |
| 角色卡 `sprite` 显式绑定（core `spriteIdOf`；A 区差分清单跟绑定目录走；未绑目录单列） | AIVN `characterCard.ts:104-107`、`prompt.ts:254-258` ↔ DSH `play-context.ts:195-202,217-222` |
| 无卡主体同权（只按 `spriteId` 出图与落盘、`title` 出名牌、`characters/` 与 `sprites/` 互不依赖） | AIVN `playAssets.ts:751-770` ↔ DSH `assets.ts:341-359`、`play-context.ts:214-222` |
| 素材描述表（`assets/manifest.json` 的 framing/stature/anchor/title、差分覆盖键、读-改-写按文件串行加锁） | AIVN `playAssets.ts:909-951` ↔ DSH `assets.ts:496-518,540-552`（**但见 2.6 的写入口径差异**） |
| 生图台账 `assets/generated.json`（只记出图与 BGM，重抠不写） | AIVN `playAssets.ts:520-538` ↔ DSH `assets.ts:520-538` |
| 「定妆照建议一次出 3 张候选」写进工具契约 | AIVN `bcf67099` ↔ DSH `src/stagehand/tools/generate-image.ts:30` |
| 差分批量 = 同一批并行多次调用（每次给这一张自己的 prompt） | AIVN `imageTool.ts:52-58` ↔ DSH `src/stagehand/tools/generate-image.ts:26-29` |

---

## 4. 不适用（一句话一条）

| 项 | 为什么不适用 |
| --- | --- |
| `imagePrompt.ts` 的三种系统提示词 / `composeImagePrompt`（`1ecb5161`） | 那是「再叫一个 LLM 把用户的一句话写成出图提示词」；插件里写 prompt 的就是 agent 本人，多一层只是多一次往返 |
| 手动生图 REST `POST /api/plays/:id/images` + WS `image_result` 回执（`1ecb5161`） | 插件没有生图入口 UI，也没有「CF 隧道 100s 断连」这个约束 |
| 舞台导演栏的生图 / 垫参考立绘面板、`RefCharacterPicker`（`1ecb5161`） | 插件舞台 `directorBar={false}`、`onGenerateCg={noop}`（`src/client/stage-view.tsx:484,489`），没有落点 |
| `ImageGenDialog` 的差分多选批量 UI（`f935805f`）、角色页「立绘目录」一行、素材页按绑定反查卡名（`d8a19b73`） | 工坊面板专属；插件的能力面是「对话里调工具」，批量由 agent 多次调用完成 |
| 设置页表单与 `configApi` 的读写映射（`5cea9a67` 等） | 插件有自己的一套 `Config` + 设置卡（`src/index.ts:121`、`src/client/settings-card.tsx:76-79`） |
| 资源库导入 / 引用即导入 / `libraryTool` / `assetImport`（`faaa543b`） | 插件的「工作区即剧目」，没有跨剧目 `library/`，`list_assets` 刻意与 `list_library` 区分（`src/tools/list-assets.ts:4-7`） |
| `http.ts` 的草稿静态路由 + `WorkshopMarkdown` 的 `assetUrl`（`de7e4da0`） | 插件用工作区绝对路径贴图 + `/aivn/asset?path=`（`README.md:384-388`、`src/routes.ts:105`） |
| 工坊写撤销条、`pendingJobs` 面板、`imageApproval`（ask/auto）等编排侧设置 | 插件的「草稿 → 采用」本身就是审批步骤，且没有撤销条与浮层面板 |
| `cli-cutout.ts` 本地调参脚本（`338dcf6c`） | 20 行一次性调试脚本，插件的等价物是 `recut_sprite` 五参数 |
| `cutout.test.ts` 的夹具具体写法（`872631c7`） | 用例本身可借鉴（已列进 2.11），但夹具依赖 AIVN 的测试资产目录 |
| `scene clear` 开新场（`1114ff34`） | 是 DSL / 舞台语义，与生图/立绘/抠底无关（仅在 2.10 里作为「stage 包滞后」的旁证提及） |

---

## 5. 置信度

**读实了的（直接读了实现，不是靠提交标题猜）：**

1. 抠底五段算法与五个默认值**逐行一致** —— 我对两边做了去注释/去空行的归一化 diff，只差一个 `CANVAS_WIDTH` 常量。置信度 **高**。
2. `draft` / `commit` / `generate` / `recut` 四种语义、草稿 7 天 TTL、留底原片路径、重抠不写台账 —— 两边实现通读对比，逐条对上。置信度 **高**。
3. 三种生图后端**逻辑等价** —— 三个文件各做了一次归一化 diff，差异全部落在注释、配置名、`undici` fetch 注入、apiKey 可选四处。置信度 **高**。
4. 2.1（neutral 不能垫参考图）—— 读了 DSH `assets.ts:205-211` 的确切条件，并与 `generate-tool.ts:99` 的 REFERENCE_RULE 对照过，**是实打实的矛盾**。置信度 **高**。
5. 2.6（`declareSprite` 用差分取景覆盖立绘级基准）—— 逐行对照 AIVN `:939` 的条件与 DSH `:507` 的无条件写入，且推演了 `framing !== level.framing` 判断为何恒假。置信度 **高**。
6. 2.2 / 2.3 的「缺哪几段」—— 用 grep 确认插件里 `SPRITE_FRAMING_SHOT` / `NEUTRAL_LEAD` / `IDENTITY_TAIL` / `PROP_TAIL` / `referenceSuffix` **一个都没有**，并读了 AIVN 的 `suffixFor` 全貌。置信度 **高**（措辞该不该照搬是设计判断，但「缺」这件事是确定的）。
7. 2.10（stage 包取自 worktree 且滞后）—— 用 `git merge-base --is-ancestor` 验证 `98650849`、`1114ff34` 都不在该分支上，并 diff 了两份 `StageTheater.tsx` 看到 `zIndex` 缺失。置信度 **高**。

**只是推断 / 未实机验证的：**

- 「半身不写景别就会被画成全身」「多人 CG 会画错人」——这是 AIVN 代码注释与提交信息里记录的实测结论，我**没有**在插件里真跑一次生图复现。置信度 **中**（机制清楚，量级未验）。
- 2.4 的严重性：剧作家演出中到底多常需要「无 neutral 的新差分」，我没有统计插件实际剧目。置信度 **中低**。
- 2.8（URL 垫图）的真实需求强度：纯推断（用户有网上参考图），没有使用记录支撑。置信度 **低**。
- 我没有跑插件的 e2e（插件仓库里 `test/` 目录不存在），所有插件侧结论都来自**读代码**，不是跑出来的。
- 我**没有**逐条追 AIVN 在 `apps/web/src/workshop/` 与 `apps/desktop/` 下的其它生图相关改动（那是明确不适用面），只看了被点名的提交与 `apps/web/src/stage`。
