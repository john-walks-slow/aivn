# 立绘即素材（sprite-entity）用户验证

## 验证说明

- 验证对象：「立绘即素材」实施后的实机表现——主体（人 / 机甲 / 猫 / 道具）由同一个 id 寻址，角色卡 `characters/<id>.md` 与立绘目录 `assets/sprites/<id>/` 是两张各自可选的同名附件；呈现三轴（framing / stature / anchor）与名牌声明全部住在 `assets/manifest.json`。
- 环境/前置条件：
  - 在 worktree `.worktrees/sprite-entity` 内跑 `./scripts/dev-worktree.sh`，取它打印的 local 与 public URL。
  - 准备一个剧目（新建或已有的 demo 都行）；要验「存量不变」时用一个迁移过的老剧目。
  - 立绘图可以是站内生图，也可以是本机已有的任意 png/jpg。

## 设计偏差（实施与计划的差异，请一并确认是否接受）

1. **角色页彻底没有立绘入口**：计划验收 3 写「角色页不再管立绘」，实施取最彻底的读法——角色卡编辑器里一个立绘相关的按钮、字段、预览都没有（只在说明文字里指向素材页）。所有立绘操作集中在素材页「立绘」类别。
2. **素材页只在立绘级给全四格，差分只给取景覆盖**：manifest 模型支持 `<id>` 与 `<id>/<variant>` 两级、每级四个字段（title / framing / stature / anchor），但界面上立绘级给「名牌 + 取景 + 体量 + 对齐」四格，差分级只给一格「取景」。理由：差分改名牌/体量的真实需求极少，UI 克制优先；需要时手改 `assets/manifest.json` 即可生效（舞台逐级读，落后的哪级没写就回落上一级）。

## 检视建议的处理（reviewer 提了、本轮明确不改）

| 建议 | 处理 | 理由 |
| ---- | ---- | ---- |
| SUG-03：`imageTool` 加 `characterId` / `expression` 兼容别名 | 不改 | 工具 schema 是给模型看的契约，加别名只会诱导模型继续用旧名；`expression` / `state` 的别名只保留给**存量剧本与存档**（解析器与谱系重放），工具层不兼容。 |
| ADV-02：「生成新立绘」弹窗不能录名牌 `title` | 不改 | 名牌在素材页立绘卡上填一次即可，弹窗只管出图；避免弹窗字段膨胀。 |

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| -------- | -------- | -------- | ---- | --------- |
| **1. 无卡主体上台**：素材页 →「立绘」→ 新建 id `mecha`，上传或生成一张图；在该立绘卡上把取景选 `full`、体量选 `huge`。再建 `cat`，取景 `square`、体量 `small`。剧本写 `<actor id="mecha" />` / `<actor id="cat" />`（两者都不建角色卡），演出。 | 机甲顶天立地、猫小而落地；两个主体都没出现在角色页；没填名牌时舞台上显示 id（`mecha` / `cat`）。 | 两台同台渲染：`mecha` 算得 top 2% / height 232%，`cat` top 72% / height 28% 且原点贴底（不悬空）；角色页里这两个 id 一条都没有。 | 通过 | [e2e 报告 · 第 1 项](261004-sprite-entity.e2e.md)、`e2e-assets/stage-init.png` |
| **2. 一次性 NPC 的名牌与默认音色**：剧本写 `<say id="npc_guard" name="守卫">…</say>`，不建卡；剧目设置里填好 `defaultVoiceId`，演出这一句。 | 名牌显示「守卫」，配音走剧目级 `defaultVoiceId`；不因没有角色卡而报错或静音。 | 名牌显示「守卫」；无卡主体的配音落到剧目级 `defaultVoiceId`（`orchestrator.voiceOf`），不报错。 | 通过 | [e2e 报告 · 第 2 项](261004-sprite-entity.e2e.md)、`e2e-assets/02-spoken-words-backlog.png` |
| **3. 名牌回落链第三段**：素材页给 `mecha` 的立绘卡填名牌「试作一号」；剧本里**不写** `<say name>`，让该主体说一句话，演出。 | 名牌显示「试作一号」（卡 `name` → `<say name>` → manifest `title` → id）。 | 实测填的名字在舞台与回顾里都生效（e2e 用的是「试验机·壹式」）；`cat` 没有 `<say name>` 也没有名牌，回落到 id。 | 通过 | [e2e 报告 · 第 2 项](261004-sprite-entity.e2e.md) |
| **4. 角色页不管立绘**：打开角色页，任意角色卡编辑器，从头翻到尾。 | 没有任何立绘入口：不能上传、不能设取景/体量/对齐、不能生图；只有指向素材页的说明。 | 编辑器只剩名字 / persona / 音色三格；遍历 DOM 输入项与关键词，没有立绘、差分、取景、体量控件。 | 通过 | [e2e 报告 · 第 4 项](261004-sprite-entity.e2e.md)、`e2e-assets/04-character-editor.png` |
| **5. 素材页立绘类别：上传与三轴声明**：素材页「立绘」→ 新建 id `xiaoyu` → 上传两张图（比如 `neutral.png` / `smile.png`）→ 立绘卡上改取景、体量、对齐；再给 `smile` 这条差分单独选一个取景。 | 改完舞台上立刻生效；`plays/<剧目>/assets/manifest.json` 里出现 `xiaoyu`（带 `title` / `framing` / `stature` / `anchor`）与 `xiaoyu/smile`（只带 `framing`）；差分级没写的字段跟随立绘级。 | 落盘 `mecha: {title, framing:"full", stature:"huge", anchor:"bottom"}` 与 `mecha/damaged: {framing:"half"}`；差分级没写的字段按立绘级继承。 | 通过 | [e2e 报告 · 第 3 项](261004-sprite-entity.e2e.md)、`e2e-assets/03-assets-panel-sprites.png` |
| **6. 素材页立绘类别：从库导入**：先在 `library/` 里放一个 `sprites/<id>/`（或 `characters/<id>/` 里带立绘）的素材包，然后在素材页立绘行点「从资源库导入」，选它。 | 立绘落到剧目 `assets/sprites/<同名 id>/`；库里只有角色卡没立绘时也补卡，两者各补各的、不互相牵连。 | 纯立绘包 `guard_bot` 只落 `assets/sprites/guard_bot/` + 素材表声明、不建空壳卡；纯角色卡 `aoi` 只落 `characters/aoi.md`、不产生立绘目录。 | 通过 | [e2e 报告 · 第 5 项](261004-sprite-entity.e2e.md)、`e2e-assets/06-assets-panel-with-guard-bot.png` |
| **7. 素材页立绘类别：站内生图**：点「生成新立绘」→ 素材名填 `neutral`；再对已有立绘点「再出一张」出一个差分。 | 新建（`neutral` 定妆照）时参考立绘 picker 可见、可选别的立绘当垫图；差分时不出现该 picker（自动垫本主体的 `neutral`）；两次都出图成功并落进 `assets/sprites/<id>/`。 | 定妆照弹窗有参考立绘 picker，差分弹窗没有（自动垫 `neutral`）；真跑了一次外部生图，1080×1920 透明 PNG 落进 `assets/sprites/`。 | 通过 | [e2e 报告 · 第 7 项](261004-sprite-entity.e2e.md)、`e2e-assets/07-real-img-gen-result.png` |
| **8. 无映射表**：把 `assets/sprites/xiaoyu/` 里 `smile.png` 改名为 `grin.png`；剧本 `<actor id="xiaoyu" variant="grin" />` 演出。 | 直接换到 `grin.png`，不需要改任何映射表或声明。 | 直接往目录里放一个新文件（e2e 用的是 `overload.png`），剧本按 stem 当 `variant` 引用即演出，没有改任何声明或映射。 | 通过 | [e2e 报告 · 第 6 项](261004-sprite-entity.e2e.md)、`e2e-assets/08-no-map-overload-variant.png` |
| **9. 存量剧目站位不变**：打开一个迁移过的老剧目（如 demo），演出原本就有的场景；重点看有卡角色的站位与大小。 | 与改动前的呈现逐一致：landscape 缺省 full/normal、top 10、height 132；half/square top 10、height 90；portrait full 8/102、half/square 8/92。 | 横竖屏两列 CSS 变量与改动前逐数字一致（`packages/core/src/play/spriteStage.ts` 的预设表，e2e 在真实剧目上核对过落位）。 | 通过 | [e2e 报告 · 第 8 项](261004-sprite-entity.e2e.md) |
| **10. 旧剧本与旧存档的 `expression` / `state`**：拿一段带 `expression="smile"`（或 `state="damaged"`）的旧剧本，或一个旧存档，演出；再写一行新写法 `variant="grin"`，以及一行三个都写的，对比。 | 三者都照常切到同名差分演出，不报错、不空白；新写法 `variant` 为准，同时写时优先级 `variant` → `expression` → `state`。 | 三个属性名都能触发换差分、不报错；同时写时 `variant` 胜出（解析器与谱系重放同一处回落顺序）。 | 通过 | [e2e 报告 · 第 9 项](261004-sprite-entity.e2e.md) |

## 验证结论

**通过。** 本轮由 `e2e-tester` 子代理在 worktree 的 dev 实例（Chromium 真机驱动，含一次真实外部生图）逐项走完这十项，功能类 9 项通过、0 不通过、0 受阻，体验类 3 项观察无关键问题；完整过程、逐步证据与截图见 [`261004-sprite-entity.e2e.md`](261004-sprite-entity.e2e.md) 与同目录 `e2e-assets/`。

这份清单保留下来，你随时可以照它自己再复看一遍——尤其是「机甲顶天立地、猫小而落地」这类画面观感，端测给的是一致性结论，最终好不好看仍以你眼睛为准。

## 待跟进

无。
