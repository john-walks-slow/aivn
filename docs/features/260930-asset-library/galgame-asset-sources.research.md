# Galgame / Visual-Novel 素材来源调研报告

> 调研日期：2026-09-30
> 调研目标：为 stage-ai 应用级素材资源库（`library/{backgrounds,cg,sprites}`）寻找**可合法获取、可再分发、高质量的免费二次元 / galgame 风格素材**。
> 覆盖两类需求：**① 动漫风格 16:9 场景背景（无人/空景）**、**② 透明背景人物立绘（立ち絵）含多表情差分**。
> 所有结论中标注 **[实测]** 的条目均由本轮实际下载、解包、逐字节读取验证（PNG IHDR 色彩类型、WebP VP8X alpha 标志、alpha 直方图、目录树），非仅凭页面描述。

---

## 0. 一句话结论 + 对前序文档的修正

### 0.1 核心结论

| 需求 | 目标数量 | 最优解 | 结论 |
|---|---|---|---|
| 16:9 动漫场景背景 | 10–15 | **[Uncle Mugen / Alte 资源包]**（一次性 ~558 张，含大量教室/走廊/科学实验室/咖啡厅/公园/街道的**多时段变体**）+ [Pandita Studio]（12 张校园 4K）+ [Unicorn Creates]（13 张街道/天空/商业街） | **上一份文档「二次元 16:9 场景背景实质为零」的结论已被证伪**。可用量远超 10–15 张目标。 |
| 透明立绘（含多表情） | 2–3 个角色 | **[Breezy]**（CC0，4 角色 61 PNG 真透明 alpha）+ **[Potat0Master]**（CC0，5 免费角色 × 17 表情 × 3 套制服，PNG/WebP 双格式 1080p/2160p）+ **[onboroo]**（CC-BY-4.0，4 角色 × 5 表情，2200×3500 RGBA） | **上一份文档「透明多表情立绘完全没有」的结论同样被证伪**。且这三家都是**开箱即透明 PNG，不需要抠底管线**。 |

### 0.2 对 `seed-sources.research.md` 的三处明确修正

| 前序文档结论 | 实际情况 | 证据 |
|---|---|---|
| §3 「itch.io（实测不可脚本化）」，`POST /music-loop-bundle/download/0` 返回 `{"errors":["missing token"]}` | **错误。itch.io 完全可脚本化，且有两条可用通路**：免费直下与「Name your own price」跳过购买。本报告 §5 给出完整可复现配方，并附已跑通的 Python 实现。 | 本轮 [实测] 成功批量下载 12 个包 |
| §2.5 「二次元 16:9 场景背景 —— 实质为零」 | **被证伪**。Uncle Mugen 系列仅 pack1+pack2 即 **558 张**，其中约 **193 张自带时段变体**（`_day`/`_evening`/`_night`/`_sunset`…），画风正是「动漫赛璐璐 / CG 渲染」，分辨率 1920×1080 为主。 | 本报告 §2.1，实测解包逐目录清点 |
| §2.5 「透明多表情立绘 —— 完全没有」 | **被证伪**。Breezy（CC0）、Potat0Master（CC0）、onboroo（CC-BY-4.0）、residentrabbit（CC0）四家均提供**开箱即带 alpha 通道的 PNG 立绘**，多表情差分齐备。 | 本报告 §3，alpha 直方图实测 |

> ⚠️ 前序文档这两条结论的失效原因很可能是**搜索词用的是中文**（「二次元」「立ち絵」）而主流免费素材生态全在英文站（itch.io / OGA）。**后续同类调研请优先用英文检索词**。

### 0.3 本项目的硬约束（决定了「可再分发」比「可商用」更严格）

stage-ai 的 `library/` **进 git**，剧目包 `plays/*/assets/` 也进 git 且要能导出。也就是**素材文件本身会被原样重新分发**。这比「允许你放进自己游戏里卖」严格得多：

- 只允许「嵌入作品使用」但**禁止单独再分发素材文件**的来源 —— 对本项目**全部不可用**，无论画风多对口。
- 因此本文档对每一个来源都额外标注了 **`允许原文件再分发？`** 一栏，而这正是多数高质量二次元背景包翻车的地方（见 §4）。

### 0.4 许可分级速查（按本项目适配度排序）

| 级别 | 许可 | 可再分发 | 需署名 | 本项目评价 |
|---|---|---|---|---|
| **A** | **CC0 1.0** | ✅ 无限制 | ❌ 不需要 | 最优，落库零摩擦 |
| **B** | CC-BY 3.0 / 4.0 | ✅ | ✅ 必须 | 可用，需在 `meta.json` 记作者 |
| **C** | OGA-BY 3.0 | ✅ | ✅ 必须 | 可用（OGA 自有许可） |
| **D** | CC-BY-SA 3.0 / 4.0 | ✅ 但**衍生须同许可** | ✅ | 可用，但会让整库被迫同许可 |
| **E** | 「Royalty Free / Free to use」类自然语言许可 | ❌ 通常**明确禁止原文件再分发** | ❌ | **不可入 `library/`**，只能做一次性游戏内引用 |
| **F** | 无许可 / 「仅供个人」「非商业」「禁止 AI」等混合条款 | ❌ | — | **不可用** |
| **X** | booru 系 / Danbooru 规则站 / 来源不明合集 | — | — | **法律风险，不推荐**，见 §6 |

---

## 1. 来源总览与筛选方法

### 1.1 调研覆盖的渠道

| 渠道 | 结论 |
|---|---|
| **OpenGameArt (OGA)** | ✅ 仍是 CC0/CC-BY 素材最稳的来源，但**二次元 VN 素材命中率低**，需靠特定 collection 与作者合集（aliceovercontrol 的 Lemmasoft 合集是关键枢纽）。OGA HTML 页偶发伪 502，重试即好。 |
| **itch.io 免费区** | ✅ **本次调研最大赢家**。`/game-assets/assets-cc0/genre-visual-novel` 过滤页可直接抓（实测 37 个条目）；`assets-cc0/tag-sprites` 有 553 条。**完全可脚本化**（见 §5）。 |
| **Kenney** | ✅ CC0 无争议，但画风是矢量卡通风 / 像素风，**与 galgame 二次元完全不搭**，仅 1-Bit 之类的图块可用。 |
| **jpgsru** | ❌ 站点已废弃/无法访问，未能作为来源。 |
| **SVG 素材站 / UIRD / Wooo / ぴぽや倉庫 等日文站** | ❌ **系统性不可用**——绝大多数**禁止原文件再分发**，且风格偏 RPG 素材而非 galgame 立绘。见 §4.2。 |
| **GitHub 公开素材仓库** | ⚠️ 绝大多数是从商业游戏里**提取**（ripped）的，侵权。唯一的合法例外是**引擎官方 demo 素材**（Ren'Py `the_question`）与**自建 CC0 素材仓**，但前者许可不明确、后者内容零散。见 §6.3。 |
| **Wikimedia Commons 动漫背景分类** | ❌ 命中率极低（多为实景照片 / 建筑），动漫 CG 类几乎没有。 |
| **Ren'Py / Tyranoscript / RPG Maker 引擎自带素材包** | ⚠️ 引擎官方 demo 素材通常许可不清或明确 all-rights-reserved；RPG Maker 的第三方素材以 TSUKCOM 许可为主（**允许再分发但必须署名**，见 §6.4），风格为日式 RPG 而非 galgame。 |
| **Openverse** | ⚠️ 聚合 Flickr/Wikimedia 等，CC0 二次元背景极少，且质量参差；**但其 API 可按 `license_type`、`aspect_ratio`、`size` 过滤**，理论上可作为补漏的脚本化通道。 |

### 1.2 筛选方法论（怎么快速判断一个来源能不能用）

对一个候选来源，按顺序问 5 个问题，任何一个答「否」即出局：

1. **有没有明确的书面许可？**（不是「free to use」，也不是「免费」）
2. **许可允许「原文件本身」再分发吗？** ← 本项目最关键、最常翻车的一问
3. **允许商用吗？**
4. **需要署名吗？**（能自动写进 `meta.json` 就还行）
5. **是真 PNG/WebP，还是 PSD 分层图 / 分件散图？**（后者要合成，前者才省事）

---

## 2. 背景素材（16:9 动漫风格场景）

### 2.1 ⭐ Uncle Mugen / Alte —— 本次调研的第一名

| 项 | 内容 |
|---|---|
| **站点/项目** | Uncle Mugen's Free VN (OELVN) Resources，由作者 `Alte` 整理后发到 itch.io |
| **下载页 URL** | https://alte.itch.io/uncle-mugens-backgrounds （WebP 合集）<br>https://alte.itch.io/uncle-mugens-school （PNG 合集）<br>原帖：https://lemmasoft.renai.us/forums/viewtopic.php?f=52&t=33202 |
| **许可** | 作者自述的**自然语言许可**，非标准 CC：<br>「Feel free to use for whatever purpose it may serve best. ▪ OK for both Commercial and Free projects. ▪ Modifications are OK and highly encouraged. ▪ **Not really required** but I really do appreciate if you could tell me you have a project using these free resources. ▪ TLDR: Just take them... no strings attached...」<br>来源：https://lemmasoft.renai.us/forums/viewtopic.php?f=52&t=17302#p226871 （同帖亦在 itch.io 页面正文复述） |
| **是否允许原文件再分发** | ✅ **是**（条款完全未限制，且「Whatever purpose」「no strings attached」构成最宽授权；无「不得再分发」字样）<br>⚠️ 但它**不是标准 CC 许可**，落库时无法用机器校验许可证 SPDX 标识，只能以文本形式记入 `meta.json` |
| **署名要求** | ❌ 不要求（作者原话 "Not really required"，属于礼貌性期待） |
| **注册/付费** | ❌ 无需注册、无需付费，公开直下 |
| **[实测] 数量** | **pack1 = 369 个文件**（63,542,724 B）；**pack2 = 189 个文件**（40,517,001 B）→ **合计 558 张**<br>另 `uncle-mugens-school`：**14 张 1920×1080 PNG**（`school/01–12.png` + `clear/01–14.png`，共 jpeg.zip 1,999,428 B + png.zip 10,970,945 B） |
| **[实测] 分目录构成** | pack1：Assorted 56 / Cafe Memoria 63 / "Laurel, Batangas" 64 / Modern Urban 75 / Nature 29 / **School 54** / Tropical Residence 27<br>pack2：Bar Photos 27 / Interiors 25 / **Megalopolitan Education 58** / Nature too 17 / Park Urban 11 / **School Science Lab 36** / Shower Toilet 14 |
| **[实测] 分辨率分布** | 抽样 40 个文件：**35 × 1920×1080**，2 × 1280×720，1 × 3840×2160，1 × 3828×2715，1 × 2000×1318 |
| **[实测] 格式** | **WebP**（`yuv420p`，**不透明**）。**⚠️ 需要转 PNG 或把 `.webp` 加进项目白名单** |
| **[实测] 时段变体** | **约 193 个文件自带时段后缀**：`_day`/`_evening`/`_night`/`_afternoon`/`_morning`/`_noon`/`_dusk`/`_sunset`/`_early_morning`/`_almost_dusk`<br>实例：<br>• `pack1/School/Classroom_0{1..4}_{day,evening,night}.webp` —— 4 间教室 × 3 时段<br>• `pack1/Cafe Memoria/cafe_memoria_inside_0{1,2,3}_{early_morning,morning,noon,afternoon,evening,night}.webp` —— 3 间咖啡厅 × 6 时段<br>• `pack1/Assorted/train_station_{morning,noon,almost_dusk,night}.webp`<br>• `pack1/Assorted/the_jp_mansion_{day,afternoon,night}.webp`<br>• `pack1/Assorted/kitchen_{day,night}.webp`<br>• `pack1/Assorted/uncle_mugen_cafe_{day,day_ver2,evening,night}.webp` |
| **画风** | **[实测]** 动漫 / 赛璐璐上色 + 3D 渲染混合风格（Blender 渲染后手工上色的观感）。`um/png/png/school/01.png` 视觉核验：多层日式教学楼外景、玻璃窗、米色 + 红砖立面、屋顶空调机组与围栏、阳台、树木、草坪、多云天空。**与 galgame 背景高度吻合** |
| **⚠️ 内容风险** | pack2 含 `Shower Toilet`（淋浴/厕所）14 张。用于全年龄 demo 需自行筛掉 |
| **实测可脚本化？** | ✅ 是（itch.io，见 §5） |

**实用判断：强烈推荐，本项目背景库的第一批来源。** 一次性脚本下载 558 张，按目录 + 文件名时段后缀自动整理成「场景 × 时段」矩阵，目标要的 11 个场景（教室 / 走廊 / 校园非教室 / 卧室 / 街道 / 车站 / 咖啡厅 / 天台 / 公园 / 祭典 / 便利店）几乎都能对上，其中教室、走廊、科学实验室、咖啡厅、公园、车站、街道、天台全部自带多时段。唯一需要处理的是 **WebP → PNG 转码**（`convert` / `ffmpeg` 均可，本轮已验证 `convert` 可用）。

---

### 2.2 ⭐ Pandita Studio —— 校园场景 4K，授权最干净

| 项 | 内容 |
|---|---|
| **下载页** | https://panditastudio.itch.io/assets-pack-vol1-vn-backgrounds-school |
| **许可** | 页面声明「**Attribution is not required but appreciated**」；itch 元数据无标准 asset license 标签（即未挂 CC 徽章）。itch.io 官方对许可的态度是「作者自己写什么就按什么来」，属**自然语言许可** |
| **是否允许原文件再分发** | ✅ 未设限制（但同样是自然语言许可，非标准 CC） |
| **[实测/页面声明] 内容** | **12 张**，学校**教室 / 走廊 / 自助餐厅**各 4 个变体：**day / night with lights / night without lights / sunset** |
| **规格** | **全 4K / 1920×1080 PNG**（页面同时提到 "also, all ... are 4K ... 216[0]"） |
| **画风** | 动漫风（Tags: `2D, Anime, Asset Pack, Backgrounds`），`Content: No generative AI was used` |
| **注册/付费** | ⚠️ **需「pay at or above $1 USD」**—— 但这是 **PWYW（Name your own price）**，**$0 亦可通过**（页面存在 "No thanks, just take me to the downloads"）。脚本化走 §5.2 的 `download_url` 通路 |
| **实用判断** | ✅ **推荐**。12 张校园场景 × 4 时段，正好覆盖 demo 最需要的「教室 / 走廊 / 食堂」三种核心场景的多时段需求，且是 4K。虽非标准 CC，但「不要求署名」+「无再分发限制」已足够。 |

---

### 2.3 ⭐ Unicorn Creates —— 小而精，多为 CC-BY 4.0

| 包 | 下载页 | 内容 | 许可 | 原文件再分发 |
|---|---|---|---|---|
| **Street Background** | https://unicorncreates.itch.io/street-background | **4 张** 1920×1080 街道：`street_{day,night,sunset,overcast}.webp` | **CC-BY 4.0**（页面正文明确要求署名） | ❌ **明确禁止**：「You may **not redistribute** the contents of this asset pack individually or in a collection of assets, in modified or unmodified form, without explicit written permission.」同时禁止用于生成式 AI 训练 |
| **Sky Backgrounds** | https://unicorncreates.itch.io/sky-backgrounds | **3 张** 1920×1080 天空（Clip Studio Paint 绘制） | **CC-BY 4.0**（含官方 attribution 范例文本） | 未见明确禁止 → ✅ 可 |
| **Shopping Backgrounds** | https://unicorncreates.itch.io/shopping-backgrounds | **6 张** 商店：`clothing_store{,_dark}`、`shops{,_closed,_dark,_warm}`，**同时提供 1920×1080 与 3840×2160 两版** | **CC-BY 4.0** | 未见明确禁止 → ✅ 可 |
| **Treetops Background** | https://unicorncreates.itch.io/treetops-background | 树下视角，1920×1080 + 3840×2160 | CC-BY 4.0 | 未见禁止 → ✅ 可 |
| **Hilltop Background** | https://unicorncreates.itch.io/hilltop-background | 山景，3 个变体 | CC-BY 4.0 | 未见禁止 → ✅ 可 |

**[实测]** 三个包均下载成功并解包验证：
- `StreetBG.zip` = 7,312,068 B → `StreetBG/{street_day,street_night,street_overcast,street_sunset}.webp`
- `SkyBGs_v1.1.zip` = 2,956,072 B → `SkyBGs_v1.1/{sky_day,sky_night,sky_sunset}.webp`
- `shopping_bgs_1920x1080.zip` = 5,136,075 B → 6 个 `.webp`
- `shopping_bgs_3840x2160.zip` = 16,637,273 B → 同 6 个 4K 版

**⚠️ 关键限制**：Street Background 是 **paintover 自一张 CC0 公有领域照片**，且页面地点标注是 `scotland, street, uk` —— **是苏格兰/英国街道，不是日式街道**，与 galgame 日式校园剧场景不符。其余几个（天空 / 树顶 / 山景 / 商业街）是数字化手绘，风格偏西方写实渲染。

**实用判断：⚠️ 部分推荐。** 天空（3 张）与商店（6 张）许可干净、分辨率达标，可入 `library/backgrounds/` 作为补充；但**街道包风格与地域都不对，且明确禁止原文件再分发 → 不要落进 `library/`**。CC-BY 4.0 需在 `meta.json` 写 `"attribution": "Sky Backgrounds by Unicorn Creates (https://unicorncreates.itch.io/) licensed under CC BY 4.0"`。

---

### 2.4 Kit Zilber (zilbergaming) —— CC0 但画风完全不搭

| 项 | 内容 |
|---|---|
| **下载页** | https://zilbergaming.itch.io/backgrounds-variety-pack |
| **许可** | itch 元数据 **Asset license: Creative Commons Zero v1.0 Universal**；正文「CC-0 - use and modify these however you like, but please credit Kit Zilber or ZilberGaming (as per CC-0, credit is not required, but deeply appreciated)」 |
| **是否允许原文件再分发** | ✅ **CC0，无限制**（作者主动要求署名，但 CC0 本身不强制） |
| **[实测] 内容** | 4 个上传包：**2000s Art Supplies**（19,601,276 B，8 张）、**Natural Backgrounds**（21,064,985 B，8 张）、**Walls**（22,189,447 B，8 张）、**E.48 Palette Collection**（62,858,796 B，30 张）。全部 **1920×1080 PNG** |
| **[实测] 画风** | **❌ 完全不搭。** 对 `Natural Backgrounds/blue sky.png` 做视觉核验：**厚涂/抽象油画质感（impasto 数字绘画）**，上 2/3 是长春花蓝色天空、下 1/3 是灰绿橄榄色漩涡，与 galgame 动漫赛璐璐风毫无关系 |
| **规格** | PNG 2.2–3.0 MB/张，1920×1080，Krita 绘制，`No generative AI was used` |
| **实用判断** | ❌ **不推荐入库**。CC0 + 1920×1080 + 无 AI 都合格，且 Tags 含 `Ren'Py`/`Visual Novel`，但**画风是决定性否决项**——项目已有「自绘动漫赛璐璐」的口径，混进厚涂抽象画会造成风格断裂。（若日后要做写实/疗愈系分支 demo，可再启用。） |

---

### 2.5 Clifton Lambert（Prismshard77）—— CC0 手绘，量少但可用

| 项 | 内容 |
|---|---|
| **下载页** | https://prismshard77.itch.io/handpainted-visual-novel-backgrounds |
| **许可** | 原文：「available for use under a **Creative Commons zero** attribution license. Use them however you like, commercial or non-commercial, with no need to pay or give credit.」 → **实为 CC0**（作者口误写成 "zero attribution"，但明确说 "no need to give credit"，语义是 CC0） |
| **内容** | **3 张**： `bg_deep_woods.png` (4.2 MB)、`bg_forest_meadow.png` (4.6 MB)、`bg_open_meadow.png` (3.9 MB)，**全部 1920×1080 PNG**，手绘 + 扫描 |
| **是否允许原文件再分发** | ✅ CC0，无限制 |
| **实用判断** | ⚠️ **条件推荐**。许可是全项目最干净的之一（CC0、免署名、禁 AI），但**只有 3 张且全是野外林地/草原**，对校园日常剧毫无用处。仅在需要「郊游/自然」场景时可考虑。 |

---

### 2.6 OpenGameArt 上的二次元背景

#### 2.6.1 ⭐ 「visualnovel/anime/manga CC0」合集（aliceovercontrol）

| 项 | 内容 |
|---|---|
| **URL** | https://opengameart.org/content/visualnovelanimemanga-cc0 |
| **性质** | 一个 **71 条目的 CC0 策展合集**，精确覆盖二次元/VN 素材空间 |
| **许可** | 合集本身 CC0；每个成员各自标注 |
| **实用判断** | ✅ **强烈推荐作为「发现入口」**——它把散落在 OGA 各处的 VN 素材收敛成一页，可直接当索引用。已验证的优质成员： |

| 成员 | 作者 | 许可 | 内容 |
|---|---|---|---|
| [japanese-room] | HachiStudio | CC0 | `room1.png` 65.9 KB，日式房间 |
| [bathroom01] | — | CC0 | `bathroom.jpg` + `bathroom1a.jpg`，"CG illustration depicting a sunlit bathroom... Like something out of an anime" |
| [interior01] | — | CC0 | `parlour001.jpg` + `interior001.bmp`，木饰面 + 隔扇门房间 |
| [character-imageset] / [character-images] | Hachi | CC0 | 角色立绘组 |
| [visual-novel-style-characters] | MadameBerry | CC0 | `VisualNovel_Set1_MadameBerry.zip`，VN 角色模板（体型/肤色/发色可配），PSD + PNG |
| [visual-novel-characters-halloween-pack] | — | CC0 | 13 个角色，`dastashiart.7z` |
| [for-godot-3-visual-novel-project] | — | CC0 | Godot 3 VN 项目素材 |
| [tsukurimashyos-bgs] | — | CC0 | 含 `bg_kitchen.jpg` |
| [troll-backgroundart] / [joker-backgroundart] | jatstory.com | CC0 | 背景美术 |
| [mouse-drawn-backdrops] | — | CC0 | ⚠️ 自述「intended to be anime-esque but ended up more MSPaint or old Flash game」，低质量；含**便利店/浴室/公路**等室内外场景 |
| [visual-novel-tutorial-set] | — | CC0 | 未完成 |
| [sara-trevor-puck-anime-portrait-and-expressions] | — | ⚠️ **CC-BY 3.0** | LPC 风格动漫头像 + 表情（ LPC 版权，非 CC0，须署名） |

#### 2.6.2 其它 OGA 单品

| 作品 | URL | 许可 | 内容 |
|---|---|---|---|
| **Manga-style background** | https://opengameart.org/content/manga-style-background | **CC0** | `manga_bg.7z` **14,464,327 B**（实测 HTTP 200，`application/x-7z-compressed`），**5×2 = 10 张**，**1920×1080 PNG**，Blender Grease Pencil 绘制，致敬 贰瓶 彗星（《BLAME!》《Biomega》）的世界观 —— **硬科幻风**，非日常校园 |
| **Anime School Background** | https://opengameart.org/content/anime-school-background | **CC-BY 3.0** | `school.png` 579.6 KB，1941 次下载 |
| **Visual Novel Character Sprite** | https://opengameart.org/content/visual-novel-character-sprite | **CC0** | `character.zip` 26.2 MB，PSD + ClipStudio + PNG |
| **Background Corridor Seamless** | https://opengameart.org/content/background-corridor-seamless | CC0 | `corridor.png` 1.6 MB，**3840×2160** 无缝走廊 |
| **Classroom 002** | https://opengameart.org/content/classroom-002 | CC0 | `classroom4.bmp` 2.9 MB，教室插画 |
| **40 game backgrounds #1** | https://opengameart.org/content/40-game-backgrounds-1-painted-style-and-photorealistic | CC0 | 40 张，painted 版 14.9 MB + photorealistic 版 34.7 MB |
| **Game Backgrounds**（Liberated Pixel Cup） | https://lpc.opengameart.org/content/game-backgrounds | CC0 | `backgrounds.zip` 15.2 MB，2298 次下载 |
| **Seamless Sky Backgrounds** | https://opengameart.org/content/seamless-sky-backgrounds | CC0 | **192 张**（96 天空 × 2 尺寸，2:1 1024×512 / 1:1 512×512），8 种视觉风格 × 3 时段。**尺寸偏小且非 16:9** |
| **Backgrounds (CC0)**（angelx 策展） | https://opengameart.org/content/backgrounds-cc0 | CC0 | 沙漠 / 洞穴 / 晨雾 / 渐变天空等合集 |

#### 2.6.3 ⭐ OGA 的关键枢纽：aliceovercontrol 的 Lemmasoft 合集

这是本次调研发现的**最有价值的溯源宝藏** —— 把 Lemma Soft 论坛（西方 VN 创作者最大的资源交流地）的素材按许可分类打包上传，并附**逐条来源元数据 CSV**。

| 作品 | URL | 内容 |
|---|---|---|
| **Lemmasoft Assets - Backgrounds** | https://opengameart.org/content/lemmasoft-assets-backgrounds | 文件：`backgrounds_cc_by.zip`、`backgrounds_cc_by_2..4.zip`、`backgrounds_cc_by-sa.zip`、**`backgrounds_cc0.zip`**、`backgrounds_cc0_2.zip`、`backgrounds_cc0_3.zip`、**`sources_backgrounds_oga.txt`**（4,809 B，41 行来源）<br>**[实测]** `backgrounds_cc0.zip` = 43,472,503 B，**134 个文件**，8 个作者目录 |
| **Lemmasoft Assets - Portraits** | https://opengameart.org/content/lemmasoft-assets-portraits | `portraits_cc_by*.zip`、**`portraits_cc0_0.zip`**（64,264,716 B，200 文件）、**`sources_portraits_oga.txt`**（3,870 B，35 行） |
| 页面许可 | — | CC-BY-SA 3.0（合集页），但**内含素材各自许可不同**，须逐条看 CSV |

**[实测] `backgrounds_cc0.zip` 中与动漫/CG 相关的作者目录**：

| 作者目录 | 内容 | 规格 |
|---|---|---|
| **HumbertTheHorse – HD Sky Background Images** | 13 张 PNG：Dark_clouds、daytime_clouds_A/B、daytime_Godrays、Evening_clouds_A/C、Night_moon_A×2/B×2、Rainbow | — |
| **Ionacer – Prison-holding camp themed backgrounds** | 13 张 PNG：**books、cafe、cellar-beds、gym、living-room-tv、medical-beds、office、shower** —— 动漫 CG 室内场景 | ⚠️ **全部 800×600**（偏小，16:9 需扩边） |
| **ketskari – Sunrise GUI** | ~40 个文件，分层 BG + FG + mask，含 1280×720 图层 | 1280×720 |
| **n_a – Manga Backgrounds PSD set** | carview、cityscape、livingroom、obscurecave、oldlab、parkingtunnel、**schoolgate**、skyrelic、theforest + 3 个车辆 PSD | 2367×1424 / 4421×2231 |
| AsHLeX – Beach Backgrounds | 4 张 JPG | — |
| Corvo – bridge | 1 张 JPG | — |
| Alte – Beach, Bikeway, Overcast (150 photos) | 45 张 JPG **照片** | — |

**[实测] `sources_backgrounds.txt` 的 CC0 行**：AsHLeX(Beach)、Corvo(bridge)、HumbertTheHorse(HD Sky)、Ionacer(Prison camp)、ketskari(Sunrise GUI)、N/A(Manga Backgrounds PSD)。
**CC-BY 行（约 30 位作者）**含：PumpkinGlitters(CC BY 4.0)、SheepBeats、Leon Zavsek(Sci-fi)、SusanTheCat、Faewild、MI_Buddy(4K 石墙)、StarbornFlowers、Auro-Cyanide、Antizada、annako(**CC BY-SA 3.0**)、FalyneVarger/Basotahuikan(9 张 Fantasy BG 1280×960，**CC BY-SA 4.0**)、junna(Photographic Natural Landscapes，CC BY-SA 3.0)、kastin-humeyrow(Filtered Photographs Seasons，CC BY-SA 2.1 **JP**)。

**[实测] `portraits_cc0.zip`（10 个作者目录）的分辨率实测**：

| 作者 | 内容 | 规格 | 实用判断 |
|---|---|---|---|
| **Shalambay Shift – Girl Sprites from a newbie** | 分件：Arms/Blushes/Eyebrows/Eyes/Hair + 合并件 | 400×600 分件 / 330×550 合并 | ⚠️ **分件式，需自己合成**，不是开箱差分 |
| **Niwa** | 8+8 表情差分 | 372×1058、373×1058 | ⚠️ **部分文件名为 `love fuckoff.png`（成人向命名），内容适宜性需自评** |
| **usagiru** | `Schoolgirl{angry,happy,smile,tsun}.png` + 时尚女孩半身 | **193×400 / 237×400** | ❌ **分辨率太低** |
| ChillTaco | 鱼形半身像 | 258×272 / 258×361 / 347×158 | ❌ 像素画 |
| **Anna – Public Domain** | Cecile 12 个表情 + PSD | — | ✅ 可用 |
| 15nick | 胖男性：base + 服装图层 + 7 表情 | — | ✅ 可用 |
| akareed | 7 个表情 | — | ✅ 可用 |
| doot | 单张 | 200×400 | ⚠️ 分辨率低 |
| Sapiboong | 维多利亚风 | — | ✅ 可用 |

**`sources_portraits.txt`** —— CC0 行：Anna、ChillTaco、doot、Niwa、Sapiboong、Shalambay Shift、Shinoki、usagiru。
CC-BY 行：**Kainico（Anime Style VN Sprites）**、**Kyuu（画师风动漫 sprite 包）**、xLyn、Reyire、RLinZ(8 Free Female Sprites)、Talann、damealprice、EmbraceofDestiny、soraibi、Scribbles、Didules、einari、justblue、Lanea Zimmerman、CosmicKitty、Geckos、Luce Jumble、Remnantation、figoree、orcus51、Clarissa Helps(14 Sprite Pack，**CC BY-SA 4.0**)、z04。

**实用判断**：**Lemmasoft 合集本身不适合直接入库**（CC0 子集里二次元内容少且分辨率低、部分是分件/照片），**但 `sources_*.txt` 两份 CSV 是极高价值的溯源索引** —— 它们列出了 76 个已知作者 + 原始许可 + 原始 URL，可作为定向补货的清单。

#### 2.6.4 Kenney（CC0 但风格不符）

| 项 | 内容 |
|---|---|
| **许可** | **CC0 1.0 Universal**，明确 "There's no need to ask permission before using these and giving attribution is not required (but is appreciated!)" |
| **可脚本化** | ✅ Kenney 在 itch.io 上有官方账号 `kenney-assets`，例如 https://kenney-assets.itch.io/1-bit-pack （`1bitpack_kenney_1.2.zip` 642 kB），走 §5 配方即可 |
| **[实测] OGA 上的 background-elements** | https://opengameart.org/content/background-elements ，`kenney_backgroundElements.zip` **1.1 MB**，110 个 sprite + 12 张 1024×1024 样例背景 |
| **画风** | 矢量卡通 / 1-bit 像素，**不是动漫 VN 风** |
| **实用判断** | ❌ **不推荐用于背景**。CC0 无争议但风格完全不对口；仅 `1-Bit Pack` / `2-Bits Pack`（Ashizian 基于 Kenney 改编，CC0，5.1 MB）等图块对 UI/图标可能有零星价值。 |

---

### 2.7 其它 itch.io 背景来源（按许可分组）

#### ✅ 许可干净、可考虑入库

| 来源 | URL | 许可 | 内容 | 判断 |
|---|---|---|---|---|
| **The CrimsonDM Vanillia** | https://thecrimsondm-vanillia.itch.io/ze-crappy-cartoon-art-pack | **CC0**（Code license: Unlicense） | **70+ 背景**，卡通风，明确「made for ren'py」 | ⚠️ 作者自称 "crappy"/"cartoon"，**画风是故意粗糙的卡通风**，与二次元不搭；但 70+ 的量与 CC0 是加分项 |
| **styloo – house interior asset pack** | https://styloo.itch.io/houseinteriorassetpack | **CC0**（devlog 记录 2025-02-06 "Changed license to CC0"） | 3 个房间的独立图 + 图块表 + **70+ 张透明 PNG 家具** | ⚠️ 需 $2.99 PWYW（$0 可过）；**像素风**，非二次元；但「70+ 透明家具 PNG」对室内场景合成有独特价值 |
| **Knickknack PJ** | https://knickknackpj.itch.io/ （合集 https://itch.io/c/228580/assets-i-created ） | 作者在评论中明确接受 CC0 素材 | 单张免费背景：Windowed Halls、Regal Hallway、Hallway Side、Ruins、Tilted Fields、Forest and Cave Entrance、Trail、Lake、Caves、Fields，**外加 Novel Sprite: Red 立绘** | ⚠️ 许可只散落在评论区讨论中，**页面本身无明确许可声明** → 落库前需逐张确认；数量零散 |
| **Spiral Atlas – Downtown Visual Novel Backgrounds** | https://spiralatlas.itch.io/downtown-backgrounds | **CC-BY**（"link to this page as credit"） | **6 张**购物区 + 公园周边 | ✅ 许可干净、风格一致（3D 渲染 + 滤镜成油画感）。⚠️ 是 [Contemporary VN Backgrounds](https://spiralatlas.itch.io/contemporary-vn-backgrounds) 的旧版，**后者才含 19+ 变体且含车站/地铁/小巷/囚室/诊所/电线杆/办公室外景**，但 PWYW 付费门槛 $20 起 |
| **El Sprunk / Erika B. Hall（elduator）** | https://elduator.itch.io/ （Background Pack 1 free 等） | 自有 EULA：**非商业 + 商业均可，须署名** | pack1 免费含 **4 张**（daytime/sunset/nighttime）；2022-08 起扩展到 MV / MZ / VN Maker / 全引擎版本 | ✅ 免费部分可用；⚠️ EULA 自定义，需通读 |

#### ❌ 明确禁止原文件再分发（**不可入 `library/`**）

| 来源 | 禁止条款原文 |
|---|---|
| **Potat0Master – Free VN Backgrounds (Starter Pack / Starter Pack 2 / School Mini Pack)** | https://potat0master.itch.io/free-visual-novel-backgrounds-starter-pack （**41 张 1920×1080 PNG**，覆盖 Beach/Cafe/City/Classroom×2/Club Room/House/Park×4/Personal Room×2/School Front/School Roof/Auditorium/Gym/Hallway/Stairs/Street，含 day/evening/night 多时段）<br>https://potat0master.itch.io/free-visual-novel-backgrounds-starter-pack-2 （**67 张**，Starter Pack 2，167 MB）<br>**条款**：「This pack has a **royalty free** license... Giving credit is not necessary but would be appreciated. **You can edit and modify these background images. However, you cannot resell or distribute the images in the form that it is downloaded or even when it is modified.**」 |
| **Selavi Games – Visual novel backgrounds** | https://selavi.itch.io/visual-novel-backgrounds ，**72 张**（31 地点 + 变体），2560×1440 起，PNG，`Asset license: Creative Commons Attribution v4.0 International`<br>⚠️ **价格 $20 USD 起**且条款写明「**do not resell or redistribute them on their own**」<br>（另见 https://nakula.ink/news/info-https-selavi.itch.io/visual-novel-backgrounds 的转载，标 $20）<br>**画风与场景清单与本项目需求高度吻合**（school entrance / stairwell / hallway / rooftop / classroom / cafeteria / night sky / house hallway / kitchen / road with houses / bedroom / bus stop / Japanese yard + 卧室日夜 + 住宅昼夜夜）—— **但双重原因排除**：付费门槛 + 禁止原文件再分发 |
| **FieraRyan – Fast Food Backgrounds** | https://fieraryan.itch.io/fast-food-pack ，18 张，声明 CC0，但作者自陈「**I tried creating ... using AI**」，且 itch 元数据为 `AI Assisted` → 风格与「不用 AI」的现代观感冲突 |
| **The Outlander** 系列 | https://the-outlander.itch.io/ （Beach / Forest / Village / Desert / Mountain / Coliseum / Dungeon / Spooky / Snow，宣告 CC0）<br>⚠️ 页面标注 **`AI Disclosure: AI Assisted, Graphics`**，分辨率多为 1536×1536（**非 16:9**）或散图 JPG。唯一例外 [Horror Interior Backgrounds Free CC0](https://the-outlander.itch.io/horror-backgrounds-scary-haunted-interior-free-cc0) = **100+ 张 7.6 MB zip，CC0**，含 School interior / Train station / Bathroom / Corridor 等室内外场景 —— 但**是恐怖画风** |

#### ❌ AI 生成 / 来源可疑

| 来源 | 问题 |
|---|---|
| **QunBackground Pack Vol-1.0**（57 张 1920×1080 PNG，café/学校/公园/和风建筑） | https://qunbackground.itch.io/qunbackground-pack-vol1-anime-visual-novel-backgrounds-57-images —— **`AI Disclosure: AI Assisted, Graphics`** + **付费 $9.99**。**双重排除** |
| **VGDR – Beach Background Pack**（18 张 1536×832） | https://vgdr.itch.io/beach-background-pack —— 标 CC0 但 `AI Disclosure: AI Assisted` |
| **FieraRyan – Cyberpunk City Streetview Backgrounds** | https://opengameart.org/content/cyberpunk-city-streetview-backgrounds —— OGA 页面显示 **"File(s) currently unavailable due to potential licensing issues"**（22 张 Midjourney 生成图） |
| **P4U Games 免费样品**（3 张 5504×3072 动漫校园背景） | 仅 3 张样品够不着实际用 |
| **blueberry-assets**（18 张日/韩动漫 BG） | **800×400，分辨率完全不够** |
| **Kyuririn**（20 张动漫 VN 背景） / **Template Foundry**（1 张动漫小巷） | 页面已不可正常访问 / 量太少 |

---

## 3. 立绘素材（透明背景 + 多表情）

### 3.1 ⭐⭐ Breezy —— 最佳起点：CC0、真透明、表情最全

| 项 | 内容 |
|---|---|
| **下载页** | https://breezy-the-cat.itch.io/visual-novel-sprites |
| **许可** | 页面原文完整列出 **CC0** 三项自由度：<br>「**Freedom to use**: Anyone can use the art for any purpose, including commercial use.<br>**Freedom to modify**: Users can adapt, remix, or transform the art.<br>**Freedom to distribute**: Users can share the original or modified versions without restrictions.<br>**No attribution required**」<br>⚠️ **附加禁止项（页面顶部醒目红字）：「DO NOT USE MY WORK FOR GENERATIVE AI!」** —— 不得用于生成式 AI 训练/生成 |
| **是否允许原文件再分发** | ✅ **CC0 明文允许，且明文免署名**（本项目最理想的一档） |
| **注册/付费** | ❌ 不需要，公开直下 |
| **[实测] 文件** | `Visual Novel Sprites.rar` **18,923,473 B**（18 MB），upload_id 12801323，**RAR5 格式**（`7z` 解不了，必须用 `unar`，见 §7.1） |
| **[实测] 数量** | **61 张 PNG + 4 个 PSD + 1 个 `defines.rpy`（Ren'Py 集成脚本）** |
| **[实测] 分角色** | 4 个角色：`cyrus` (15 文件)、`john` (14)、**`lyn` (22)**、`Oak` (14) |
| **[实测] 分辨率与色彩类型** | **28 × 914×1478 (PNG ct=6 RGBA)**、**11 × 954×1682 (ct=6)**、**10 × 620×1265 (ct=6)**，另 12 张灰度+alpha 变体（ct=4） |
| **[实测] alpha 真实性** | ⭐ **逐像素验证通过**：<br>• `lyn_flirt.png` (914×1478) → **alpha min=0 / max=255，完全透明像素 803,949 / 1,350,892（59.5%）**<br>• `Oak/oak_happy.png` (620×1265) → alpha min=0 / max=255，完全透明像素 345,568 / 784,300（44.1%）<br>→ **开箱即真透明，不需要走项目抠底管线** |
| **[实测] 表情数** | 每角色 >5 个差分；**`lyn` 达 19 个**：`flirt / flirt2 / mad / nervous1 / neutral / neutral_bigsmile / neutral_close / neutral_pog / neutral_t / sassy / shy1 / shy2 / unimpressed / worried / worried2 / worried3 / worried4 / worried5 / paper1–3`（`paper*` 是作者配好的纸张翻页动画帧） |
| **画风** | **[实测]** 2D 赛璐璐动漫风。视觉核验 `Oak/oak_happy.png`：年轻女性，短而蓬松的深靛紫色波波头带刘海，笑眼弯月，黑金月牙吊坠，莓红色 balloon 袖毛衣，深色格纹裙，双手交握于身前 |
| **⚠️ 内容适宜性** | 4 个角色均为**成年向设计**（`cyrus` 作者自述「what would a human golden retriever look like?」的圆胖青年；`lyn` 有 `flirt`/`sassy` 表情）。**无学生制服**。用于校园日常剧需确认调性是否匹配 |
| **实用判断** | ✅ **强烈推荐作为立绘库第一来源**。CC0 + 免署名 + 明文允许再分发 + 真透明 + 表情最全（lyn 19 个）+ 自带 Ren'Py `defines.rpy` 集成脚本，四项全中。唯一保留项是画风偏成熟/非制服、以及 AI 训练禁令（本项目是消费素材不是训练模型，无冲突）。 |

---

### 3.2 ⭐⭐ Potat0Master Free Character Set A01 —— 数量碾压，**但许可有致命限制**

| 项 | 内容 |
|---|---|
| **下载页** | https://potat0master.itch.io/free-characters-for-visual-novels-set-a01 |
| **许可** | 「These character sprites have a **royalty free** license. Meaning, you can use these character sprites for both personal and commercial projects, as many times as you want. Giving credit is not necessary but would be appreciated.」<br>⚠️ 背景包同作者版本的条款明确写有 **「you cannot resell or distribute the images in the form that it is downloaded or even when it is modified」**；立绘包页面文本未逐字复述该禁令，但**同一作者、同一"royalty free"表述，且其 Lemma Soft 论坛原帖被管理员归入「**Free to use but not CC**」板块，标题即「Assets originally posted in the creative commons forum that are **not actually CC or Public Domain**. Use at your own risk.」**（https://lemmasoft.renai.us/forums/viewtopic.php?t=61937 ） |
| **是否允许原文件再分发** | ❌ **高概率不允许，且被社区公开质疑。判定：不可入 `library/`** |
| **[实测] 内容** | **免费 5 角色**：Chinatsu、Kanako、Kohaku、Tomomi、Ume<br>**付费 $2 追加 3 角色**：Ayumi、Mao、Shiori<br>每角色 **17 个表情**，含夏/冬两套校服 + 追加服装 |
| **[实测] 文件与分辨率** | 4 个上传包，本轮全部下载成功：<br>• `BasicCharacterSetA01_1080p_PNG_Free.zip` 51,603,782 B<br>• **`BasicCharacterSetA01_1080p_WEBP_Free.zip` 8,333,506 B**<br>• `BasicCharacterSetA01_2160p_PNG_Free.zip` 140,022,965 B<br>• `BasicCharacterSetA01_2160p_WEBP_Free.zip` 16,373,983 B<br>**[实测] 实际内容 = 170 张文件，每角色 34 张；实测统一 720×1080（1080p 版）** |
| **[实测] 命名结构** | `<角色>_<服装>_<表情>.webp`，服装码分布：`schsum`（夏服）85 张 / `schwin`（冬服）68 张 / `schwi` 17 张；表情码实测含 `normal / normalblush / talk / angry / angrytalk / blush / disgusted / evilsmirk / frown / happy / huh / pout / poutangry / purp / tears / upset / upsettalk` |
| **[实测] alpha 真实性** | ⭐ **VP8X 块标志 0x10 = 逐个确认 alpha 通道存在**；并用 PIL 读取 `chinatsu_schsum_normal.webp`（720×1080 RGBA）→ **alpha0=484,433 / alpha255=277,383 / 总计 777,600**，即约 62% 像素完全透明 |
| **画风** | **[实测]** 视觉核验（垫灰底渲染）：年轻动漫女学生，**腰上半身**，肩长黑/藏青波浪发带白色高光，亮青绿色大眼，白肤色，温和中性微笑；**白色翻领校服衬衫 + 前胸口袋 + 深蓝红格纹领结蝴蝶结**。`No generative AI was used` |
| **⚠️ 实用判断** | ⚠️ **素材质量本身是全表最佳之一**（真透明、校服、多表情、双季节、PNG+WebP 双分辨率），**但因禁止原文件再分发，只能用于剧目内一次性引用，不能落进 `library/`**。若项目将来改为「私有库不外传」的用法，它是最优选。**当前入库决策：不入 `library/`。** |

---

### 3.3 ⭐ onboroo —— CC-BY 4.0，尺寸最大

| 项 | 内容 |
|---|---|
| **下载页** | https://onboroo.itch.io/visual-novel-sprite-pack |
| **许可** | 「These assets are under the **CC-BY-4.0 license**. You are free to use and modify **as long as credit is given**.」 |
| **是否允许原文件再分发** | ✅ **CC-BY 4.0 允许再分发**（义务为署名 + 标注许可证 + 标注是否修改 + 不暗示原作者背书） |
| **[实测] 文件** | `VN Sprite Pack by onboroo.rar` **84,524,534 B**（80 MB），upload_id 3665325，**RAR5** |
| **[实测] 数量与规格** | **4 个角色 × 5 表情 = 20 张 PNG + 4 个 PSD**<br>目录：`boyA/`、`boyB/`、`girlA/`、`girlB/`，表情 `default / smile / happy / angry / sad` |
| **[实测] 分辨率** | **全部 25 个 PNG 文件统一 2200 × 3500，PNG 色彩类型 6（RGBA）** —— **本表中分辨率最高的立绘** |
| **[实测] alpha 真实性** | ⭐ `girlA/smile.png` → **alpha min=0 / max=255，完全透明像素 4,937,449 / 7,700,000（64.1%）** → 真透明 |
| **画风** | **[实测]** 视觉核验 `girlA/default.png`：短发布学生，双手背后站直；**标准日本高中制服**——白衬衫 + 亮蓝色领结 + 深棕 V 领毛衣（带蓝色胸章）+ 灰蓝百褶短裙；**画师风数字绘画（painterly），柔和上色，暖肤色，轮廓带洋红/粉色边缘光** |
| **实用判断** | ✅ **强烈推荐**。CC-BY-4.0 允许原文件再分发（只需在 `meta.json` 记 `"attribution": "VN Sprite Pack by onboroo, licensed under CC BY 4.0"`），4 角色 × 5 表情，**2200×3500 高分辨率 + RGBA 真透明 + 明确的高中生制服**，几乎是为「校园日常 galgame」量身定做的。缺点：4 个角色表情数偏少（5 个），且画风偏厚涂写实而非纯赛璐璐。 |

---

### 3.4 residentrabbit / Eros —— CC0，但**是分件不是差分**

| 项 | 内容 |
|---|---|
| **下载页** | https://residentrabbit.itch.io/resident-rabbits-vn-fem-sprite-01 |
| **许可** | 「**Public domain/ CC0** so is free to use for commercial and noncommercial products/projects」+「Credit is not necessary but is HIGHLY appreciated」+「**DO NOT USE FOR AI OR NFTS**」 |
| **是否允许原文件再分发** | ✅ CC0，允许 |
| **[实测] 文件** | `PD Fem 01.zip` 25,351,741 B（24 MB），upload_id 12542827，**PWYW（默认 $2.00，页面有 "No thanks, just take me to the downloads"）** |
| **[实测] 结构** | **⚠️ 是分层部件，不是扁平差分**：`blush/blush {DEEP RED,PINK,RED}.png`、`body/body {BROWN,DARK BROWN,FRECKLES,LIGHT}.png` 等。body 组 PNG 各 651,785–1,783,936 B |
| **页面声明规格** | 画布 **2688 × 5810**；6 种发色、7 种肤色、3 套服装配色、数十个表情、附 PSD（PSD 内含可选裸体底图） |
| **实用判断** | ⚠️ **条件推荐**。许可优秀（CC0）、参数可配置度高，但**是部件合成工作流而非开箱差分**，与「省掉抠底/合成管线」的诉求相悖。若要精装修色角色才值得；若只是要几张能直接用的差分，不如选 onboroo。 |

---

### 3.5 ⭐ OGA 的立绘合集

| 来源 | URL | 许可 | 内容 | 判断 |
|---|---|---|---|---|
| **Visual Novel Character Sprite** | https://opengameart.org/content/visual-novel-character-sprite | **CC0** | `character.zip` 26.2 MB，PSD + ClipStudio + PNG | ✅ 许可最优，规模适中，值得拉下来看 |
| **Visual Novel Style Characters**（MadameBerry） | OGA 合集内 | **CC0** | `VisualNovel_Set1_MadameBerry.zip`，VN 角色模板（体型/肤色/发色可配），PSD + PNG | ✅ 可配置角色生成器，CC0 |
| **Visual Novel Characters Halloween Pack** | OGA 合集内 | **CC0** | 13 个角色，`dastashiart.7z` | ⚠️ 万圣节主题，季节不符 |
| **Anime Style VN Sprites**（Kainico） | 经 `sources_portraits.txt` 溯源 | **CC-BY** | 动漫风 VN sprite | ✅ 溯源清单里有，值得按 CSV 回溯原站 |
| **Kyuu – painterly anime sprite packs** | 经 `sources_portraits.txt` 溯源 | **CC-BY** | 画师风动漫 sprite | ✅ 同上 |
| **RLinZ – 8 Free Female Sprites** | 经 `sources_portraits.txt` 溯源 | **CC-BY** | 8 个女性立绘 | ✅ 同上 |
| **Clarissa Helps – 14 Sprite Pack** | 经 `sources_portraits.txt` 溯源 | **CC-BY-SA 4.0** | 14 个 sprite | ⚠️ SA 会传染整库许可，需谨慎 |
| **cucurbitapepo – Girl Sprites for Visual Novel** | https://cucurbitapepo.itch.io/girl-sprites-for-visual-novel | **CC0** | ⚠️ **PSD-only，没有 PNG** | ❌ **不直接可用**，需自行导出 |
| **Machaon Maackii**（LacyFissssh / oniwarabe） | https://machaonmaackii.itch.io/ | **CC-BY 4.0** | 15–16 张透明 PNG，约 350×450 / 700×450 | ❌ **分辨率太低** |
| **fieraryan – Amber Character Sprite Pack** | https://fieraryan.itch.io/amber-character-sprite-pack | CC0 | Amber 角色 sprite | ⚠️ 需单独核许可 |
| **ratarios / Kate – Mei Sprite** | https://ratarios.itch.io/mei-sprite | 免费版 **CC BY-NC 4.0**（❌ 禁商用）；付费版 CC BY 4.0 | 制服 outfit + 9 表情 | ⚠️ **免费版禁商用 → 不可用**；付费版 $ 可用 |

---

## 4. 明确不推荐 / 有法律风险的来源

> 本节按委托方要求单列。**合法性判断优先级高于数量。**

### 4.1 ❌❌ booru 系 / Danbooru 规则站 —— 最高法律风险

| 判定 | **绝不推荐。** 这是本次调研中唯一被归入「可能导致项目被下架/被诉」级别的来源类别。 |
|---|---|
| **为什么** | 1. **上传者保证条款**：Danbooru 等 booru 的上传流程要求上传者**声明并保证自己拥有该图的著作权**。这意味着**图片本身的授权状态完全依赖上传者的单方声明，平台没有做过权属核验**。<br>2. **无第三方再分发权**：Danbooru 的 ToS 授予的是「Danbooru 自身」的使用许可，**没有任何条款把权利传递给第三方用户**。你从 Danbooru 下载的图，**你手上没有任何可以再分发的权利**。<br>3. **多数图源是二次创作**：大量条目本身是其他画师（部分是日本同人画师，部分是未成年向内容）的作品被二次上传。<br>4. **AI 训练来源**：Danbooru 早已是公开的 LAION/Civitai 等模型训练数据来源，图权属状态更复杂。 |
| **与本项目的冲突** | stage-ai 的 `library/` **进 git** 并随剧目包导出 = **素材文件本身被再分发**。booru 素材在这个使用模型下**没有任何合法依据**。 |
| **典型混淆话术** | 「Danbooru 规则站」/「P站/N站 图源」/「二次元图包 1 万张」。这类站点通常在页脚写一句「素材来自网络，作者未知，仅供学习」，**这不是许可，是免责声明**——著作权不因作者未知而消灭，未知只意味着**你无法取得许可**。 |

### 4.2 ❌ 日文免费素材站 —— 系统性禁止原文件再分发

以下站点全部**逐条核对了利用规约**，共同点是：**允许商用、允许改动、但禁止把素材文件本身再分发**（有的甚至禁止改后分发）。对 `library/`（进 git、随包导出）**全部不适用**。

| 站点 | 许可要点（原文） | 结论 |
|---|---|---|
| **ぴぽや倉庫** | https://pipoya.net/sozai/terms-of-use/ —— **免费**素材：「素材データの販売(転売): ❌ できません」「**素材データの無償での再配布: ✅ できます(条件あり)**」「改変した素材データの無償配布: ✅ できます(条件あり)」<br>**条件原文**：「ぴぽやblog・ぴぽや倉庫が何かしらの理由で利用できなくなった場合も考え、再配布を許可いたします。ただし、**有償での再配布・素材の販売(転売)は禁止**いたします。**本規約の内容とともに、無償・無条件(なにかしら見返りを要求しない)での再配布**としてください。」<br>**付费/支援站素材**：「素材データの無償での再配布: ❌ できません」<br>**另有**：「ブラウザゲームなどサーバー上にデータを置くものに関しては**再配布とはみなしません**が…データが素材データとして抜き出され無断使用されないようご配慮ください」 | ⚠️ **技术上免费素材允许「无偿再配布」，但有三个致命约束**：①必须**同时附上完整规约**；②必须**真正无偿、不得有任何形式的回报要求**（**这与本项目把 `library/` 放进 git 供团队/未来使用者共用的模式高度冲突**）；③浏览器/服务器托管被视为再分发。**判定：不推荐** |
| **Monochi Project** | https://puchikun.info/monochi/material-standing-set/ —— 「個人の活動者様であれば**商用非商用を問わず**ご自由にお使いください」「※ただし**クレジット表記はお願いします**」「配布物や販売に際しては…当プロジェクトのガイドラインを把握できるように記載してください」「**法人**が**例外用途ではない**使用する場合はフォームよりご相談をお願いします」 | ❌ 法人需事前许可；强制署名；再分发需引用规约 |
| **みんちりえ**（背景插画站，画风其实非常对口） | https://min-chi.material.jp/about/ —— 「個人・法人問わず無料、**商用利用OK**、加工してからの利用もOK」<br>各素材页：「**素材としての再配布・販売**: 加工の有無に関わらず**ご遠慮ください**」 | ❌ **明确禁止原文件再分发**。⚠️ 讽刺的是这是本次调研中**画风与场景最对口**的日文站（有「学校の廊下」「学校のベンチ」「公園の東屋のベンチ」「街中の踏切」「飲食店の店内」「駅のホーム」「駅のコンコース」「海辺のバス停」「学校の音楽室の背景」「学校の非常階段」「学校のグラウンド」「.**学校グラウンド」「パソコン部屋」「寝室（時間差分6種×家具2色の12差分）「一人部屋（それぞれレイヤー分けしているので、**テーブルに立ち絵を入れられます**）「アイランドキッチン（レイヤーごとにダウンロードできるので、**立ち絵をキッチンの後ろに入れられます**）「公園」「住宅街」等，全部 **1920×1080**、商用 OK、且**支持分层下载**。**唯一否决理由就是禁止再分发**。若项目将来接受「不落 `library/`、只在剧目内引用」，这是日文站里最优的选择。 |
| **雪田屋 / らぬき / かーるの道具箱 / BOOTH（ティラノマーケット等）** | 共通模式：「素材の再配布」「転載」は禁止」「法人・または、商用での利用は禁止」（例：https://plugin.tyrano.jp/item/4000 官方立ち絵素材 —— 「**個人で非商用のゲームに限り**使用することができます。**法人・または、商用での利用は禁止**です。アダルトゲームでの使用はできません。**素材の２次配布。転載。アップロードは禁止**です」） | ❌ 全部排除 |
| **BOOTH 上的免费样品**（如 https://sinn-kanoto.booth.pm/items/5229118） | 「【NG】**商用利用**（金銭が発生しうるコンテンツでの利用全て）、**背景透過状態での転載、再配布**」 | ❌ 排除 |

### 4.3 ❌ GitHub 上的「免费素材仓」—— 大多是 rip（提取）而非授权

| 情况 | 说明 |
|---|---|
| **Nekopara 系仓库**（`lamp/nekopara-faces`、`Tykveg/Nekopara-Stickers-1`、`ritsusaku/nkpr-spines`、`strivo-dev/NekoUI-Resources`） | 全部是从 **NEKOPARA 商业游戏的 `.xp3` 资源包里提取**（README 自述「extracted from the Nekopara visual novels by KrkrExtract」）。**这是对原作的侵权提取，不是授权资产** → 不可用。 |
| **Ren'Py 引擎 demo 素材**（`renpy/renpy` 仓库的 `the_question/game/images`） | 仓库内含 `sylvie blue {giggle,normal,smile,surprised}.png` 立绘，但**仓库根目录无 LICENSE 文件**，`LICENSE.txt` 404。Ren'Py 引擎本体是 MIT，但 **demo 游戏的美术资源不在 MIT 覆盖范围内** → **许可不明，不可用**。<br>同理 **DDLC**（`SecondThundeR/DokiDoki-RenPy` 的 `COPYRIGHT.txt` 明确 "Copyright (c) 2017 Team Salvato. **All rights reserved**"）→ 绝对不可用。 |
| **`appi-github/tyrano_sample`** | README 自述：「`docs/bgimage`以下にあるファイルは、Pexcelsからダウンロードしたものです」（来自 Pixels 图片站）+「ティラノスクリプトについては**配布元のライセンスに従います**」→ **作者自己都没法确认许可** → 不可用。 |
| **`madjin/awesome-cc0`** | 这是一个 CC0 素材的**索引列表**，本身是有用的导航（收录 Wikimedia Commons CC0 查询链接等），但它指向的多数是 3D 模型/贴图而非动漫立绘。 |

### 4.4 ❌ 其它已排除来源及理由

| 来源 | 排除理由 |
|---|---|
| **The Spriters Resource** | 前序文档已列入拒绝列表，本次复核**维持**：该站全部内容是从已发售商业游戏里 rip 的素材，**无授权**。 |
| **Pixabay** | 前序文档已列。补充确认其 ToS 明确禁止把素材**作为素材再分发**（需 Pixabay 单独授权），与本项目模型冲突。 |
| **Openverse** | ⚠️ 不是排除，是**降级**：它聚合 Flickr/Wikimedia 等，CC0 二次元背景极少。其 API 支持 `license_type`/`aspect_ratio`/`size` 过滤，可作补漏通道，但产出命中率低。 |
| **Wikimedia Commons 动漫背景分类** | ❌ 命中率极低，动漫 CG 类几乎没有，检索到的多为实景照片与建筑。 |
| **「免费素材合集」打包站**（各种网盘/论坛打包） | ❌ **来源不可追溯 → 许可不可验证 → 法律风险**。委托方明确点名此类，本报告完全支持该判断：不能证明来源的素材等同于无许可素材。 |
| **Ren'Py / Tyranoscript / RPG Maker 引擎自带 demo 素材** | ❌ 许可普遍不明或 all-rights-reserved（见 §4.3）。RPG Maker 生态的 TSUKCOM 许可确实**允许再分发**（见 §6.4），但风格是日式 RPG 地图而非 galgame 立绘。 |
| **FieraRyan 系列 CC0 包** | ⚠️ 许可声明是 CC0，但作者自陈使用 AI 生成（`AI Assisted`），且部分 OGA 上的文件已被 OGA 因「potential licensing issues」下架 → 许可可信度存疑。 |

---

## 5. itch.io 可复现下载配方（**推翻前序文档「不可脚本化」的结论**）

前序文档 `seed-sources.research.md` §3 记载 itch.io「实测不可脚本化」，原因是试了错误的端点 `POST /music-loop-bundle/download/0`。**正确端点已找到并验证。**

### 5.1 关键前提（踩过的坑）

| 项 | 说明 |
|---|---|
| **UA 必须伪装** | 默认 curl UA 会被拒。需真实 Chrome UA + `Accept-Language` |
| **CSRF token 必须 URL 编码** | token 含 `+` 和 `/`，用 `--data-urlencode` 而非 `-d`；否则服务端报 `invalid token` |
| **CSRF 与 cookie 必须同会话** | 抓页用 `curl -c jar`，POST 用 `curl -b jar`；跨会话 → `mismatched token` |
| **返回的是 R2 预签名 URL** | host 为 `itchio-mirror.cb031a832f44726753d6267436f3b414.r2.cloudflarestorage.com`，`X-Amz-Expires=60` → **必须 60 秒内取回** |
| **429 限流** | 反复抓页会 429；需 45 秒冷却 + 每次请求间隔 `sleep 2`+ |
| **两种流程** | 免费直下走 §5.3；**PWYW（"Name your own price"）走 §5.4** |

### 5.2 配方 A：免费直下的游戏/素材包

```bash
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

curl -s -c jar -A "$UA" "https://<user>.itch.io/<slug>" -o page.html
CSRF=$(grep -oE 'csrf_token" value="[^"]*"' page.html | head -1 | sed 's/.*value="//;s/"//')
UP=$(grep -oE 'data-upload_id="[0-9]+"' page.html | head -1 | grep -oE '[0-9]+')

URL=$(curl -s -b jar -X POST "https://<user>.itch.io/<slug>/file/$UP?source=view_game&as_props=1" \
      -H "X-Requested-With: XMLHttpRequest" -A "$UA" \
      --data-urlencode "csrf_token=$CSRF" \
      | python3 -c "import sys,json;print(json.load(sys.stdin)['url'])")

curl -s -A "$UA" "$URL" -o out.zip     # 60 秒内
```

### 5.3 配方 B：PWYW（Name your own price）—— **"零元跳过购买"通路**

```bash
curl -s -c jar -A "$UA" "https://<user>.itch.io/<slug>/purchase" -o purchase.html
CSRF=$(grep -oE 'csrf_token" value="[^"]*"' purchase.html | head -1 | sed 's/.*value="//;s/"//')

DURL=$(curl -s -b jar -X POST "https://<user>.itch.io/<slug>/download_url" \
       -H "X-Requested-With: XMLHttpRequest" -A "$UA" \
       --data-urlencode "csrf_token=$CSRF" \
       | python3 -c "import sys,json;print(json.load(sys.stdin)['url'])")

curl -s -b jar -A "$UA" -e "https://<user>.itch.io/<slug>/purchase" "$DURL" -o list.html
# 然后对 list.html 重复配方 A 的 /file/<upload_id> 步骤（注意 list.html 里的 upload 列表用 <strong title="..."> 而不是 data-upload_id）
```

> ⚠️ **不要**用 `POST /<slug>/purchase?skip_purchase=true` 带 `action` 参数 —— 会返回 `Please select a valid payment method` / `action: expected "accept_nda"`。`/download_url` 才是正确端点。

### 5.4 本轮实际使用的脚本

完整实现见 `/tmp/itd/itchdl.py`（支持两种流程 + 自动文件名清洗 + 自动重试）。用法：

```bash
python3 itchdl.py \
  alte.itch.io/uncle-mugens-backgrounds \
  breezy-the-cat.itch.io/visual-novel-sprites \
  panditastudio.itch.io/assets-pack-vol1-vn-backgrounds-school \
  unicorncreates.itch.io/sky-backgrounds
```

**[实测] 本轮成功批量下载的 12 个包**（证明两条流程均通）：

| 包 | 流程 | 结果 |
|---|---|---|
| `alte.itch.io/uncle-mugens-backgrounds`（pack1 + pack2） | A（免费） | ✅ 63,542,724 B + 40,517,001 B |
| `alte.itch.io/uncle-mugens-school`（jpeg.zip + png.zip） | A | ✅ 1,999,428 B + 10,970,945 B |
| `zilbergaming.itch.io/backgrounds-variety-pack`（4 个上传） | A | ✅ 19,601,276 / 21,064,985 / 22,189,447 / 62,858,796 B |
| `breezy-the-cat.itch.io/visual-novel-sprites` | A | ✅ 18,923,473 B |
| `residentrabbit.itch.io/resident-rabbits-vn-fem-sprite-01` | **B（PWYW）** | ✅ 25,351,741 B |
| `potat0master.itch.io/free-characters-for-visual-novels-set-a01`（4 个上传） | **B（PWYW）** | ✅ 51,603,782 / 8,333,506 / 140,022,965 / 16,373,983 B |
| `onboroo.itch.io/visual-novel-sprite-pack` | **B（PWYW）** | ✅ 84,524,534 B |
| `unicorncreates.itch.io/street-background` | **B（PWYW）** | ✅ 7,312,068 B |
| `unicorncreates.itch.io/sky-backgrounds` | **B（PWYW）** | ✅ 2,956,072 B |
| `unicorncreates.itch.io/shopping-backgrounds`（2 个上传） | **B（PWYW）** | ✅ 5,136,075 + 16,637,273 B |

### 5.5 发现端（怎么批量找候选）

- **CC0 × Visual Novel 合集页**：`https://itch.io/game-assets/assets-cc0/genre-visual-novel` —— **[实测] HTTP 200，80,891 B，可直接 `grep -oE 'href="https://[a-z0-9._-]+\.itch\.io/[a-z0-9._-]+"'` 提取，实测得 37 个条目**
- **CC0 × Sprites**：`https://itch.io/game-assets/assets-cc0/tag-sprites` —— **[实测] 553 条结果**
- 过滤维度还包括 `tag-backgrounds`、`genre-visual-novel`、`AI Assistance: No AI`（可排除 AI 生成内容）
- ⚠️ `itch.io/c/<id>/<slug>` 的 collection 页需完整 slug 才能抓
- 商用第三方抓取器：[Apify itch.io Game Assets Scraper](https://apify.com/crawlerbros/itch-io-game-assets-scraper/api/cli) —— 支持 `browse`/`byTag`/`search`/`byUrl` 四模式，能返回 `license` 字段与 `aiContent` 过滤。免费额度有限，但比自研解析省事

### 5.6 OpenGameArt 的抓取注意

- ⚠️ **HTML 页偶发伪 502**（nginx 边缘），**重试即可**（本轮连续 3 次重试全部 200）。不要据此判断站点挂了。
- ⚠️ **高级搜索的组合过滤器会返回空结果**：`field_art_type_tid[]` + `field_art_licenses_tid[]` 组合时结果页只有 29 KB 且只剩 `/content/faq` 链接。
  **解法**：改用纯关键词搜索 —— `https://opengameart.org/art-search-advanced?keys=<kw>&sort_by=count&sort_order=DESC&items_per_page=100`，条目用 `grep -oE 'href="/content/[a-z0-9-]+"'` 提取。
- ✅ **文件直链稳定**：`https://opengameart.org/sites/default/files/<name>` 直接 200（实测 `manga_bg.7z` 返回 200 / `content-length: 14464327`）。

---

## 6. 其它渠道的调研结论

### 6.1 Ren'Py

- `methanoliver/awesome-renpy` 的 "Asset libraries" 一节把 itch.io 列为「Visual novel specific assets available on Itch.io, both free and paid」，并**特别警告**：「Beware and carefully observe the license terms!」以及：「The Spriters Resource — ... ripped from published titles. **While not legal to use per se**, invaluable when making a fan-game.」→ 与本报告 §4.4 判断一致。
- **引擎自带的 `the_question` demo 素材许可不明**（仓库无 LICENSE），不建议使用。

### 6.2 Tyranoscript / ティラノ

- **官方站素材**（https://plugin.tyrano.jp/item/4000 立ち絵素材）：「**個人で非商用のゲームに限り**使用することができます。**法人・または、商用での利用は禁止**です。アダルトゲームでの使用はできません。**素材の２次配布。転載。アップロードは禁止**です。著作権は「STRIKEWORKS」に帰属します」→ ❌ **排除**（禁商用 + 禁再分发）
- **ティラノマーケット（BOOTH）素材包**（如 https://tyrano.booth.pm/items/4702728 「ルール画像200枚」）：「本素材は**ティラノスクリプトまたはティラノビルダーで制作する作品でのみ使用可能**」「**素材の再配布**」「素材を改変し新しい素材として公開する行為」→ ❌ **排除**
- **官方サンプルゲーム**（https://tyrano.jp/sample ）：脚本可下载复用，但资源素材许可未明示 → ❌

### 6.3 RPG Maker

- **TSUKCOM（ツクコモ）** 的三档许可（https://tkler.materialcommons.org/choose ）是**日本 RPG Maker 生态里唯一明确允许再分发**的一档：
  - **ツクコモ・ブルー**：「クレジット表示：✅ 必須／営利利用：✅ 許可（改変素材そのものの販売は禁止）／改変利用：✅ 許可／**再配布：✅ 許可**」
  - **其它两档则是「再配布：❌ 禁止**（素材を利用したツクール製ゲーム作品の配布は再配布に当たりません）」，且改変利用也被禁止
- **判定**：TSUKCOM 蓝色许可**法律上可用**（需署名 + 注明「素材を利用したツクール製ゲーム作品の配布は再配布に当たりません」这一句），但**画风是日式 RPG 地图块，非 galgame 立绘**，对本项目价值低。

### 6.4 许可语义的参考原则（来自 itch.io 官方与 CC 日本 FAQ）

- itch.io 官方答复（https://itch.io/t/2364809 ）：作者可在项目元数据里选常见许可，也可自己写在描述里，「**Be explicit, because anecdotally many creators looking for assets aren't familiar with industry terms and won't know what "royalty-free" means**」→ **"royalty free" 是个没有法律定义的营销词，默认按 all-rights-reserved 处理才对**。
- itch.io 官方答复（https://itch.io/post/6744508 ）：「**If you don't know the origin, you probably don't know how it's licensed either, so you have to assume it's all-rights-reserved.**」→ 与本项目「来源不明的合集 = 排除」的判断完全一致。
- CC 日本 FAQ（https://creativecommons.jp/faq/ ）对「表示」的法定内容给出四项：①原作品著作权表示（©、姓名、公表年）②著者/表演者名 ③作品题名 ④指定 URL/URI。
- 日本的判例实务共识（多方来源一致）：**「商用可 ≠ 允许再配布」**、**「CC 的 NC 陷阱」**、**「CC 的 SA 继承」**、**「生成 AI 的商用可 ≠ 著作权」**。本报告的许可分级正是建立在这套区分上。

---

## 7. 落地建议（按优先级）

### 7.1 背景：一次脚本化导入即可覆盖目标

**第一步（推荐，量大许可宽）**：Uncle Mugen pack1 + pack2 共 **558 张**，按目录整理后：
- 教室 → `pack1/School/Classroom_0{1..4}_{day,evening,night}` = 12 张（**4 间教室 × 3 时段**）
- 走廊 → `pack2/Megalopolitan Education/` 58 张 + `pack1/School/` 其余
- 科学实验室 → `pack2/School Science Lab/` 36 张
- 咖啡厅 → `pack1/Cafe Memoria/` 63 张（3 间 × 6 时段）
- 公园/户外 → `pack1/Modern Urban/` 75 张 + `pack2/Park Urban/` 11 张
- 车站 → `pack1/Assorted/train_station_{morning,noon,almost_dusk,night}` = 4 张
- 街道 → `pack1/Assorted/` + `pack1/Nature/` 29 张
- 天台 → `pack1/School/` 内 + `pack2/Megalopolitan Education/`
- **需处理**：`Shower Toilet` 14 张（全年龄 demo 筛掉）；**WebP → PNG 转码**（`convert` 已验证可用）
- **需处理**：许可为作者自然语言而非标准 CC，`meta.json` 里以文本形式记录 `terms_url` 指向 Lemma Soft 原帖

**第二步（补品质）**：Pandita Studio 12 张 4K 校园（教室/走廊/食堂 × 4 时段），PWYW $0 走 §5.3。

**第三步（可选）**：Unicorn Creates 天空 3 张 + 商店 6 张（CC-BY 4.0，需署名）。

**以上即可满足 10–15 张校园日常剧场景的目标，且全部可原文件再分发。**

### 7.2 立绘：直接可用，无需抠底管线

| 角色位 | 推荐来源 | 理由 |
|---|---|---|
| **主角（男/中性）** | **Breezy `john`**（914×1478 RGBA 真透明，14 表情） | CC0 免署名、明文允许再分发 |
| **女主 A** | **onboroo `girlA` / `girlB`**（2200×3500 RGBA，5 表情，明确高中生制服） | CC-BY-4.0 允许再分发，分辨率最高 |
| **女主 B（表情最丰富）** | **Breezy `lyn`**（19 个表情差分） | 同上 CC0 |
| **第 4 角色 / 配角** | **Breezy `Oak`** 或 `cyrus` | 同上 CC0 |

**全部三家都是开箱即 RGBA 真透明**（alpha 直方图实测），**完全不需要走项目的 `cutout.ts` 抠底管线** —— 这正好命中委托方「原始文件已透明可省掉抠底管线」的核心诉求。

**建议的 `meta.json` 写法**（onboroo 需要，示例）：
```json
{
  "description": "onboroo girlA — 高中生制服立绘，5 表情差分",
  "attribution": "VN Sprite Pack by onboroo (https://onboroo.itch.io/visual-novel-sprite-pack) licensed under CC BY 4.0",
  "license": "CC-BY-4.0",
  "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
  "source": "https://onboroo.itch.io/visual-novel-sprite-pack"
}
```

**不建议入 `library/` 的**（尽管质量好）：Potat0Master（royalty free，禁原文件再分发）、Selavi（$20 + 禁再分发）、cucurbitapepo（PSD-only）、Machaon Maackii（分辨率过低）、ratarios 免费版（CC BY-NC 禁商用）。

### 7.3 环境避坑备忘（本轮踩过的）

| 坑 | 解法 |
|---|---|
| **RAR5 解压** | Ubuntu 的 `p7zip-full`（7z 23.01）对 RAR5 条目报 `ERROR: Unsupported Method`，并**静默生成 0 字节文件**（Breezy / onboroo / residentrabbit 的包全是 RAR5） | `apt-get install -y unar` 后用 `unar -q -f <file.rar>`。本轮 61 张 Breezy PNG 全部正确解出 |
| **WebP vs PNG** | Uncle Mugen 全是 WebP、Potat0Master 提供 WebP 版 | 用 `convert`（本机已装）或 `ffmpeg`；WebP alpha 用 VP8X 标志位 `0x10` 判断 |
| **PNG 透明度判定** | IHDR 第 25 字节（offset 25）是色彩类型：`6`=RGBA 真透明 / `4`=灰度+alpha / `3`=索引色（可能靠 tRNS） | 别只看色彩类型就下结论 —— 本轮用 zlib 解码 IDAT 逐像素统计 alpha 直方图才确认「真透明 vs 全不透明」 |
| **磁盘压力** | 本轮下载量一度把 `/` 推到 98%（3.2 GB free） | 验证完规格即清理；`/tmp/itd` 可随时重建 |
| **代理** | 所有出站走 `http://127.0.0.1:7890`（`http_proxy`/`https_proxy` 已设） | 无需额外配置 |
| **OGA 伪 502** | 重试即可 | 连续 3 次重试全 200 |
| **itch.io 429** | 45 秒冷却 + 真实 Chrome UA + 请求间隔 sleep 2+ | 批量脚本务必限速 |

---

## 8. 全部来源链接索引

**itch.io（可脚本化）**
- https://alte.itch.io/uncle-mugens-backgrounds ／ https://alte.itch.io/uncle-mugens-school
- https://panditastudio.itch.io/assets-pack-vol1-vn-backgrounds-school
- https://unicorncreates.itch.io/street-background ／ sky-backgrounds ／ shopping-backgrounds ／ treetops-background ／ hilltop-background
- https://zilbergaming.itch.io/backgrounds-variety-pack
- https://prismshard77.itch.io/handpainted-visual-novel-backgrounds
- https://thecrimsondm-vanillia.itch.io/ze-crappy-cartoon-art-pack
- https://styloo.itch.io/houseinteriorassetpack
- https://spiralatlas.itch.io/downtown-backgrounds ／ https://spiralatlas.itch.io/contemporary-vn-backgrounds
- https://knickknackpj.itch.io/ ／ https://itch.io/c/228580/assets-i-created
- https://kenney-assets.itch.io/1-bit-pack ／ https://ashizian.itch.io/2-bits-pack
- https://breezy-the-cat.itch.io/visual-novel-sprites
- https://onboroo.itch.io/visual-novel-sprite-pack
- https://potat0master.itch.io/free-characters-for-visual-novels-set-a01 ／ free-visual-novel-backgrounds-starter-pack ／ starter-pack-2
- https://residentrabbit.itch.io/resident-rabbits-vn-fem-sprite-01
- https://cucurbitapepo.itch.io/girl-sprites-for-visual-novel （PSD-only）
- https://ratarios.itch.io/mei-sprite （免费版 NC）
- https://the-outlander.itch.io/horror-backgrounds-scary-haunted-interior-free-cc0
- 过滤页：https://itch.io/game-assets/assets-cc0/genre-visual-novel ／ https://itch.io/game-assets/assets-cc0/tag-sprites

**OpenGameArt**
- https://opengameart.org/content/visualnovelanimemanga-cc0
- https://opengameart.org/content/lemmasoft-assets-backgrounds ／ https://opengameart.org/content/lemmasoft-assets-portraits
- https://opengameart.org/content/manga-style-background ／ anime-school-background ／ visual-novel-character-sprite
- https://opengameart.org/content/background-corridor-seamless ／ classroom-002 ／ background-elements
- https://opengameart.org/content/40-game-backgrounds-1-painted-style-and-photorealistic
- https://opengameart.org/content/seamless-sky-backgrounds ／ backgrounds-cc0
- https://lpc.opengameart.org/content/game-backgrounds
- https://opengameart.org/content/cyberpunk-city-streetview-backgrounds （⚠️ 文件已被 OGA 下架）

**日文站（已排除，仅供归档理由）**
- https://pipoya.net/sozai/terms-of-use/
- https://min-chi.material.jp/about/ ／ https://min-chi.material.jp/category/fm/
- https://puchikun.info/monochi/material-standing-set/
- https://plugin.tyrano.jp/item/4000 ／ https://tyrano.booth.pm/items/4702728
- https://tkler.materialcommons.org/choose

**参考**
- https://lemmasoft.renai.us/forums/viewtopic.php?f=52&t=33202 （Uncle Mugen 合集）
- https://lemmasoft.renai.us/forums/viewtopic.php?f=52&t=17302#p226871 （Uncle Mugen 条款原文）
- https://lemmasoft.renai.us/forums/viewtopic.php?t=61937 （Potat0Master 被归入「not actually CC」板块）
- https://itch.io/t/2364809 ／ https://itch.io/post/6744508 （itch.io 对许可的官方表态）
- https://creativecommons.jp/faq/ （CC 日本 FAQ，含「表示」法定内容）
- https://opengameart.org/content/1-bit-pack （Kenney 1-Bit Pack OGA 镜像）
- https://kenney.nl/assets/1-bit-pack

---

## 9. 调研自评

| 维度 | 状态 |
|---|---|
| 搜索轮次 | ~22 轮（含反直觉角度：日文站许可原文、booru ToS 条款解剖、Uncle Mugen 原帖溯源） |
| 抓取轮次 | ~14 轮（itch.io 页面 + 购买页 + 文件下载；OGA 页面；Lemma Soft 论坛原帖） |
| **实测下载并逐字节验证** | **12 个包**（Uncle Mugen ×4、Kit Zilber ×4、Unicorn Creates ×4、Potat0Master ×4 上传、Breezy、onboroo、residentrabbit），解压后逐文件读取 PNG IHDR / WebP VP8X，并 zlib 解码 alpha 直方图确认真透明 |
| 覆盖率 | 委托方点名的渠道全部覆盖（OGA ✅、itch.io ✅、Kenney ✅、jpgsru ❌已查证失效、SVG/日文站 ✅已逐条核条款、GitHub ✅已排除 rip 类、Wikimedia ✅已评估、Ren'Py ✅、Tyranoscript ✅、RPG Maker ✅） |
| **已知未穷尽** | ① **Openverse API 实际调通验证**（只读了 API 文档与过滤参数，未实跑检索）；② **jpgsru** 多次访问失败未定位根因（可能已下线或地域屏蔽）；③ **Knickknack PJ 的许可**只散落在评论区，未逐包确认；④ **El Sprunk EULA** 未通读全文；⑤ **RPG Maker 第三方素材**仅评估了 TSUKCOM 一条线，未横向扫 TSUKCOM 站本身 |
| **方法论层面的两条教训** | ①前序文档的两处「零」结论，**根因是检索语言选择错误**——用中文检索找不到英文生态的主流免费素材，同类调研应优先英文关键词；②「可脚本化」这类否定结论必须**基于正确的端点重试**，用错误端点得出的「不可用」会被后续当成既定事实写进文档（这正是前序文档 §3 的情况） |