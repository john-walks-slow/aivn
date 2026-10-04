# 立绘即素材：角色卡与立绘解绑 实施总结

## 做了什么

台上的一切改由**一个 id 寻址**：人、机甲、猫、道具同权。每个 id 有两张**各自可选**的同名附件，谁也不依赖谁：

- 角色卡 `characters/<id>.md`：只剩 `id` / `name` / `voice` / `voiceId` 与正文人设。
- 立绘 `assets/sprites/<id>/`：一组差分图 + 呈现声明。

**命名恒等**：id = 目录名，variant = 文件名 stem，中间不再有映射表——`thumb.png` 改名成 `grin.png`，剧本写 `variant="grin"` 直接生效。

**呈现轴**收敛成四条：`framing`（图里画到哪）× `stature`（台上站多大）× `shot`（这一句多近，DSL 逐行）× `anchor`（垂直对齐，manifest 声明 + DSL 覆盖），`pos` 照旧。机甲 = `full` + `huge`，猫 = `square` + `small`。

`expression` 与 `state` 合并为 `variant`（旧剧本/旧存档的两个属性名在解析器与谱系重放里留别名）。名牌回落链四段：卡 `name` → `<say name>` → 素材表 `title` → id；无卡主体 TTS 走剧目级 `defaultVoiceId`。

声明只住 `assets/manifest.json`：键 `<id>` 是立绘级（含名牌 `title`），键 `<id>/<variant>` 是差分覆盖。资源库新增 `sprites` 类别（只有立绘、没有卡）。

舞台预设表移进 `packages/core`（`spriteStage.ts`），web 一次算成 CSS 变量、媒体查询按宽高比挑横/竖列。三档缺省数值与加表之前逐一致：landscape `full/normal` top 10 / height 132，`half`、`square` 都是 top 10 / height 90；portrait `full` 8/102，`half`、`square` 都是 8/92。

## 为什么这么做

改动前立绘是角色卡的附件：生图硬要 `characterId`（没卡就自动建空壳卡）、取景只写在卡上、差分靠卡上的映射表、资源库没有「非角色立绘」这一类——机甲、道具、武器这些「不是人但有立绘」的主体没有位置。同时 `expression` / `state` 是同一槽位的两个名字（同时写后者被静默丢掉），`framing` 一档同时管出图画幅、提示词措辞、舞台摆位与主体类别，而卡上的取景和 manifest 里的取景是两份、舞台只读卡那一份。

## 改动范围

**core**：`play/assets.ts`（`spriteDeclarationOf` / `spriteTitlesOf`、`AssetMeta.variants` + `stature`/`anchor`、旧键 `expressions` 读回落）、`play/characterCard.ts`（卡瘦身）、`play/framing.ts`（取景/体量常量与缺省）、`play/spriteStage.ts`（新，预设表）、`play/config.ts`（library kind 加 `sprites`）、`dsl/spec.ts` + `dsl/parser.ts`（`variant` / `anchor`，别名兜底）、`lineage/*`、`ws/protocol.ts`。

**server**：`playAssets.ts`（出图不再建卡、声明落 manifest、参考垫图候选）、`playhouse.ts`（`cast` 补素材表主体 + `asset_ready{type:"sprite"}` 广播）、`orchestrator.ts`（`names` 打底）、`http.ts`（新增 `PUT /api/plays/:id/assets/sprite`）、`assetRef.ts`（多类别按序回退、`characters`/`sprites` 双候选）、`assetImport.ts`、`library.ts`、`agentkit/*`（`imageTool` 改 `spriteId`/`variant`、`libraryTool` 加 `sprites`、`recutTool`、`readiness`）、`imagePrompt.ts`（按取景措辞、体量入提示词）、`prompt.ts`（搭台助手与剧作家提示词）、`store.ts`。

**web**：`workshop/AssetsPanel.tsx`（立绘类别：上传、名牌、三轴声明、差分取景覆盖、从库导入、站内生图）、`workshop/CharacterEditor.tsx`（瘦身 −188 行，立绘入口全部移走）、`ImageGenDialog.tsx`（`neutral` 定妆照才给参考立绘 picker）、`LibraryBrowser.tsx`、`stage/assets.ts`（`AssetIndex.spriteIds`）、`stage/StageTheater.tsx`（CSS 变量落位、导演生图候选改按立绘目录）、`stage/director.ts`、`app.css`、`api.ts`。

**脚本与文档**：新增 `scripts/migrate-sprite-declarations.mjs`（一次性迁移，无运行时回落）；README 改 30+ 处（取景/体量/名牌、素材页立绘类别、一次性角色、library 目录树、导入步骤、`meta.json` 字段表、面板说明）；`AGENTS.md`、`apps/server/AGENTS.md`、`apps/web/AGENTS.md` 同步。

## 迁移

`node scripts/migrate-sprite-declarations.mjs`：把卡上的 `framing` / `spriteFraming` 抄进 manifest、`expressions` 键改写 `variants`、谱系与存档里的 actor `expression`/`state` 改写 `variant`。已对 `plays/` 真实数据跑过一次，重跑输出「没有需要迁移的剧目」（幂等）。

## 验证

- **静态**：`pnpm -r build` 全绿（core / server / web）；`pnpm typecheck` 全绿。
- **迁移脚本**：在 `/tmp` 造了一份 fixture 实测 `--root` + `--apply`：只带被迁移字段的卡不再留下空栅栏（`---\n---`）、带名字的卡栅栏保留、映射里文件名与差分名不一致时真改名、`expressions` → `variants`、两级声明落进素材表；迁完的卡用 `parseCharacterCard` 解析正常（名字/音色/正文都对）；重跑输出「没有需要迁移的剧目」。
- **测试**：三个 workspace 各跑整套——core 165 passed（10 文件）、server 646 passed / 3 skipped（45 文件，跳过的两文件是 `e2e-live-*`，要 `STAGE_E2E_LIVE=1` 才真跑外部 API）、web 179 passed（27 文件）。本轮新增用例：`http.test.ts`（写立绘声明的白名单取值与非法值 400 且不落盘）、`assets.test.ts`（`spriteTitlesOf` 只收立绘级、忽略空白与差分级 title）、`assetRef.test.ts`（引用即导入按 `characters`/`sprites` 双候选、多类别按序回退）。
  - 三处 web 用例是跟着这次改名一起改的存量用例：`actorCue.test.ts`（`expression` / `state` 两个槽合成 `variant`；`anchor` 缺省从写死的 `bottom` 改成 `null`——剧本不写就听素材声明）、`rewindVisual.test.ts`（重算画面的 `sprites[].expression` → `variant`）、`characterCards.test.tsx`（保存的角色卡不再带 `framing` / `sprites`，cast 里带上来的旧字段当噪声丢掉）。
- **检视**：reviewer 两轮。第一轮 2 阻塞 + 3 建议 + 2 非阻塞；阻塞项（HTTP 非法入参二次写响应头、名牌回落链第三段没落地）已修并补测，建议项 2 条已修、1 条明示拒绝，非阻塞项 1 条已修、1 条明示拒绝；第二轮结论**准入**。详见 `261004-sprite-entity.review.md`。
- **端到端**：`e2e-tester` 子代理在 worktree 的 dev 实例上（Chromium 真机驱动）走完验收清单十项——无卡主体同台（机甲 huge 顶天立地 / 猫 small 贴地）、名牌三段回落与无卡主体 TTS 回落剧目级音色、素材页三轴声明落盘与差分继承、角色页无立绘入口、纯立绘包与纯角色卡各自导入互不牵连、改文件名即换差分、横竖屏预设与改动前一致、`expression`/`state`/`variant` 三者都演出且 `variant` 优先，另真跑了一次外部生图（定妆照有参考 picker、差分自动隐藏并垫 neutral，1080×1920 透明 PNG 落盘）。功能类 9 项通过、0 不通过、0 受阻；体验类 3 项无关键问题。报告与截图：`261004-sprite-entity.e2e.md`、`e2e-assets/`。
- **用户实机验收**：用户授权本轮以端到端测试闭环后提交；验证清单十项已逐项填上端测结果并标记「通过」，用户可照 `261004-sprite-entity.validation.md` 自己复看。

## 明确不做

画幅自由覆盖、DSL 逐行体量、显式 `sprite:` 绑定字段、图层 z 轴、服装套装轴；`generate_image` 工具层不加 `characterId` / `expression` 别名（工具 schema 是给模型的契约，别名只会诱导模型继续用旧名）；「生成新立绘」弹窗不录名牌（名牌在素材页立绘卡上填一次）。
