# sprite-entity（立绘即素材：角色卡与立绘解绑）端到端测试报告

## 测试环境
- **被测系统**：AIVN (stage-ai) `feat/sprite-entity` 分支（worktree: `.worktrees/sprite-entity`）
- **运行环境**：ARM64 Linux (LineageOS chroot Ubuntu 24.04), Node.js v22.23.2, Chromium (Playwright 1.63.0-alpha)
- **服务实例**：
  - 前端 Web 界面：http://127.0.0.1:32389/
  - 后端 REST/WS API：http://127.0.0.1:62412/
  - 数据目录：worktree 根目录（`plays/` 与 `library/`）
- **测试剧目**：`test`（喫茶常春藤与灵狐少女的恋爱契约）及实测验证存档 `s_e2e_test`

---

## 功能类测试项

| # | 测试步骤 | 预期 | 实际 | 状态 | 证据 |
|---|----------|------|------|------|------|
| 1 | **无卡主体上台**：在素材页立绘段新建 id `mecha`，上传图片声明 `framing=full` + `stature=huge`；新建 `cat` 声明 `square` + `small` + `bottom`。两者均不建角色卡。在舞台上让 `<actor id="mecha" />` 与 `<actor id="cat" />` 同台演出。在角色页核验列表。 | 两台均有立绘渲染；机甲巨大（top 2%、height 232% 顶天立地），猫体型小且落地不悬空（top 72%、height 28%、origin 贴底）；角色页完全查不到 mecha 和 cat。不压台词条。 | 逐项完全吻合。机甲、猫与常规角色同台渲染，DOM 变量计算与视觉层次分明，角色卡列表无任何脏数据。 | 通过 | `docs/features/261004-sprite-entity/e2e-assets/stage-init.png`<br>`docs/features/261004-sprite-entity/e2e-assets/01-no-card-in-character-page.png` |
| 2 | **名牌与一次性角色**：立绘卡上给 `mecha` 填名牌「试验机·壹式」；剧本声明 `<say id="npc_guard" name="守卫">…</say>`（无卡、无立绘）；主体不填 `<say name>` 说话（`mecha` 和 `cat`）；核验语音调度回落逻辑。 | 名牌依次正确展示「守卫」、「试验机·壹式」、以及回落 id「cat」。无卡主体语音调度走剧目级 `defaultVoiceId`（45c5d3723c9c42f598e4776dcfd5f02d），不报错或静默崩溃。 | 舞台与回顾（Backlog）中名牌精准匹配：「守卫」由 say 标签覆盖生效；「试验机·壹式」由素材表 title 生效；cat 回落至 id；`voiceOf` 正确回落剧目配置。 | 通过 | `docs/features/261004-sprite-entity/e2e-assets/02-spoken-words-backlog.png`<br>`apps/server/src/orchestrator.ts:562` |
| 3 | **素材页立绘段声明落盘**：在素材页立绘卡配置立绘级名牌、取景、体量、对齐，为差分单独覆盖取景为 half，检查 `assets/manifest.json`。 | `assets/manifest.json` 出现 `<id>` 键（含 title/framing/stature/anchor）与 `<id>/<variant>` 差分键（仅 framing）；差分未写字段跟随立绘级。 | 落盘生成 `mecha: { title: "试验机·壹式", framing: "full", stature: "huge", anchor: "bottom" }` 与 `mecha/damaged: { framing: "half" }`。格式与继承完全正确。 | 通过 | `docs/features/261004-sprite-entity/e2e-assets/03-assets-panel-sprites.png`<br>`plays/test/assets/manifest.json` |
| 4 | **角色页没有立绘入口**：打开工坊角色页，依次检查角色卡列表及角色卡编辑器（包括新建卡与编辑已有卡）。 | 角色卡编辑器仅保留人设、音色等卡片属性，完全移除立绘上传、取景、体量、对齐和生图控件；说明文字明确指向素材页。 | 经 DOM 输入项与关键词遍历排查，角色编辑器中无任何立绘/差分/取景/体量控件，仅剩角色名、人设正文和音色三项。 | 通过 | `docs/features/261004-sprite-entity/e2e-assets/04-character-list.png`<br>`docs/features/261004-sprite-entity/e2e-assets/04-character-editor.png` |
| 5 | **从资源库导入立绘**：在素材页立绘行点击「从资源库导入」，选择纯立绘包（如 `sprites/guard_bot`）；再在角色页导入纯角色卡（如 `characters/aoi`）。 | 纯立绘包导入到 `assets/sprites/<id>/`，三轴声明写入 manifest，不创建空壳角色卡；纯角色卡仅落盘 `characters/<id>.md`，不产生多余立绘目录。 | `guard_bot` 完整导入 `assets/sprites/guard_bot/neutral.png` 且 manifest 生成对应的 stature 与 anchor；`aoi` 仅创建角色卡 Markdown，立绘目录未创建，两套解绑互不干扰。 | 通过 | `docs/features/261004-sprite-entity/e2e-assets/06-library-picker-modal.png`<br>`docs/features/261004-sprite-entity/e2e-assets/06-assets-panel-with-guard-bot.png`<br>`docs/features/261004-sprite-entity/e2e-assets/06-role-page-with-aoi.png` |
| 6 | **无映射表**：在 `assets/sprites/<id>/` 放入新差分文件 `overload.png`（不修改 manifest 或任何映射配置），剧本写 `<actor id="mecha" variant="overload" />` 演出。 | 直接生效切到 `overload.png`，无需中间映射表。 | `stage/assets.ts` 通过 `stemMap` 依据文件名 stem 直接解析并加载对应图片，无需在 manifest 或角色卡中登记差分映射。 | 通过 | `apps/web/src/stage/assets.ts:80-105`<br>`docs/features/261004-sprite-entity/e2e-assets/08-no-map-overload-variant.png` |
| 7 | **存量剧目不缺位**：打开老剧目演出场景，检查存量角色（如 `suzune`）在舞台上的计算数值。 | 缺省 full/normal: landscape top 10% / height 132%；portrait top 8% / height 102%；half/square landscape 10%/90%、portrait 8%/92%。换差分时不上下跳动。 | 舞台真实行内 CSS 变量完全吻合：`--sprite-top: 10%`、`--sprite-height: 132%`、`--sprite-top-portrait: 8%`、`--sprite-height-portrait: 102%`。核心预设单元测试全部通过。 | 通过 | `packages/core/test/spriteStage.test.ts`<br>`docs/features/261004-sprite-entity/e2e-assets/stage-init.png` |
| 8 | **旧剧本/旧存档照常演出**：测试旧属性 `expression="neutral"`、`state="damaged"`，以及新写法 `variant`。同时写三个属性时验证优先级。 | 均能平滑定位到同名差分，解析器不报错、舞台不空白；优先级按 `variant` → `expression` → `state`。 | 谱系重放与 DSL 解析器测试验证通过；三者并存时按预期优先采用 `variant`。旧属性平滑转换为 internal variant 事件。 | 通过 | `packages/core/src/lineage/replay.ts:103`<br>`docs/features/261004-sprite-entity/e2e-assets/02-spoken-words-backlog.png` |
| 9 | **站内生图（真实 API 单点）**：素材页调用「生成新立绘」定妆照（`neutral`），再对差分调用重生成。实测出图与参考立绘 picker 显示。 | 差分为 `neutral` 时显示参考立绘 picker；改差分名或重生成已有差分时自动隐藏 picker（垫自身 neutral）。真实出图文件落盘、manifest 写入。 | 调用生图 API 耗时约 45s，成功生成 1080x1920 RGBA PNG（1.4MB）落盘至 `assets/sprites/robot_test/neutral.png`；`manifest.json` 自动写入立绘配置；picker 显示/隐藏逻辑严格符合预期。 | 通过 | `docs/features/261004-sprite-entity/e2e-assets/07-dialog-neutral-with-refpicker.png`<br>`docs/features/261004-sprite-entity/e2e-assets/07-dialog-smile-without-refpicker.png`<br>`docs/features/261004-sprite-entity/e2e-assets/07-real-img-gen-result.png` |

---

## 体验类测试项

| # | 体验场景 | 关注点 | 观察 | 建议/问题 |
|---|----------|--------|------|-----------|
| 1 | **素材页立绘段布局** | 密度、可发现性、层次感 | 顶部设有新增立绘输入框与上传入口；每个主体独立卡片，卡片右上角标注「角色卡：xxx」或「没有同名角色卡」，区分度好。名牌/取景/体量/对齐 4 个下拉控件一行排布，差分列表下仅单列取景覆盖，整体清晰直观。 | **建议**：当剧目累积角色与道具主体较多（如 10+ 个）时，素材页垂直滚动较长。后续可考虑在素材页顶部加入主体快速索引定位或折叠展开能力。 |
| 2 | **舞台视效与比例** | 拟真感、同框协调、穿帮排查 | 机甲（huge 体量）232% 高度，气势雄浑，居左占据舞台纵向全幅；猫咪（small 体量 + bottom 贴底）28% 高度，稳稳贴在舞台底部地面；与正常人物（132%）同台时大小落差极大、极其自然。台词条与角色立绘有明确层次，下沿自然延伸，不遮挡台词阅读。 | **体验良好**：small 档位小体量实体自动改用 `bottom center` 作为 transform-origin，缩放与运镜时小动物脚不离地，体验极其自然。 |
| 3 | **新建与重生成弹窗** | 交互心智与垫图直觉 | 新建 `neutral` 时展示参考立绘选择芯片，可自由选其它角色垫图作为形象基准；一旦差分名不是 `neutral`（如 `smile`），参考立绘选择区立刻自动隐藏，向用户传达“差分会自动承接本主体 neutral 形象”的明确心智。 | **体验良好**：避免了用户在画差分时误选其它角色垫图导致出现“换脸”、“画风崩坏”的困惑。 |

---

## 证据图

### 1. 无卡主体上台：机甲（huge）、猫咪（small）与正常角色同框
![机甲、猫咪与灵狐少女同台](docs/features/261004-sprite-entity/e2e-assets/stage-init.png)

### 2. 角色页无任何立绘入口（彻底解绑）
![角色页无立绘控件](docs/features/261004-sprite-entity/e2e-assets/04-character-editor.png)

### 3. 素材页立绘段与三轴声明落盘
![素材页立绘段配置](docs/features/261004-sprite-entity/e2e-assets/03-assets-panel-sprites.png)

### 4. 名牌与回落链（守卫 NPC、试验机名牌、cat id）
![回顾面板中的名牌展现](docs/features/261004-sprite-entity/e2e-assets/02-spoken-words-backlog.png)

### 5. 从资源库导入纯立绘包（无卡主体）
![资源库导入守卫机器人立绘](docs/features/261004-sprite-entity/e2e-assets/06-assets-panel-with-guard-bot.png)

### 6. 生图弹窗：定妆照提供参考垫图 vs 差分自动隐藏
![定妆照显示参考立绘选择器](docs/features/261004-sprite-entity/e2e-assets/07-dialog-neutral-with-refpicker.png)

![差分自动隐藏参考立绘选择器](docs/features/261004-sprite-entity/e2e-assets/07-dialog-smile-without-refpicker.png)

### 7. 真实 API 生图成功落盘与呈现
![真实 API 生成的 robot_test 立绘](docs/features/261004-sprite-entity/e2e-assets/07-real-img-gen-result.png)

---

## 结论
- **功能类**：通过 9 · 不通过 0 · 受阻 0
- **体验类**：3 项观察，关键问题 0
- **总体结论**：**通过**

## 待跟进
- 无阻塞性缺陷。未来可在素材页立绘列表中引入折叠或多主体过滤搜索，优化大量主体时的浏览体验。
