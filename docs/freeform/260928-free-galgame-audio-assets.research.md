# Galgame 免费 BGM / 音效素材资源穷尽式调研报告

> 调研日期：2026-09-28　作用域：Stage-AI 引擎剧目配乐（BGM）与音效（SFX）素材库建设
> 目标：为 6 大类 BGM 场景（日常欢快 / 温馨日常 / 抒情浪漫 / 悲伤感动 / 悬疑紧张 / 高潮燃曲）与常见 SE（UI 点击悬停、打字翻页、开门脚步、雨声蝉鸣风海浪、心跳、惊讶、闪光、钟声、魔法战斗）找到"可直接下载、授权可商用/可随游戏分发、多多益善"的免费资源。
> 覆盖中／英／日三语来源；每个来源均核实过当前在线状态（截至 2026-09-28）。

---

## 0. TL;DR —— 直接能用的优先级推荐

### 🥇 Tier 1：零署名、可直接商用、游戏适配度最高的首选源

| 来源 | 内容 | 授权 | 说明 |
|---|---|---|---|
| **OpenTracks（原 DOVA-SYNDROME）** [opentracks.com](https://opentracks.com) | 19,248 首 BGM + 1,296 个 SE，全免费下载 | 站方ライセンス：商用/个人/海外均可，署名**任意**（个别作曲家曲目需署名，页面有标注） | 日本最大级免费 BGM 站；2026-09-15 由 DOVA 改名，旧域名自动跳转。钢琴/弦乐/日常/悬疑/燃曲全类型覆盖，galgame 适配度天花板。下载无需注册（未来计划引入免费登录） |
| **効果音ラボ** [soundeffect-lab.info](https://soundeffect-lab.info) | 2,000+ SE，分类：ボタン・システム音／環境音／自然・動物／生活／戦闘／演出・アニメ／声素材 | 商用免费、クレジット・署名・报告**不要**；禁 18 禁内容与再配布 | UI 音、环境音、战斗魔法音一站解决；**注意：禁止用于アダルト（18+）作品** |
| **Sonniss GDC 游戏音频包（十年合辑）** [sonniss.com/gameaudiogdc](https://sonniss.com/gameaudiogdc) / [gdc.sonniss.com](https://gdc.sonniss.com) | 每年 GDC 免费发放约 5–10GB WAV；2026 版 7.47GB / 347 文件；历届合辑 200GB+（含 torrent） | 免版税、商用 OK、**无署名**、终身不限项目；禁单独再分发原始音轨、禁 AI/ML 训练 | 影视级音效一次性大包，环境音/UI/战斗/风声雨声等 galgame 常用类别齐全，是 SE 库的"地基" |
| **Kenney** [kenney.nl](https://www.kenney.nl) | 40,000+ 资产全部 CC0（音频板块含 UI 音、碰撞音、音乐 jingles 85 个、音效包若干） | **CC0 1.0** | 游戏资产圈最可靠 CC0 源；打包 ZIP 单文件下载，无注册无 API 门槛 |
| **Freesound** [freesound.org](https://freesound.org) | 约 73 万条声音，其中 CC0 约 38 万条（52%），2025 年新增 72% 为 CC0 | 逐条授权：CC0 / CC-BY / CC-BY-NC 混杂 | 环境声、拟音（foley）、UI、心跳、脚步等细分声音的宝库；**必须按 CC0 过滤后使用**；有公开 API（需注册 token） |
| **爱给网 CC 专区** [aigei.com/music](https://www.aigei.com/music) + [aigei.com/sound](https://www.aigei.com/sound) | CC 配乐 2 万首、CC 音效大量、可精确按 "CC0-可商用-公共版权" 筛选 | 逐条标注 CC0/CC-BY 等；CC0 条目免费商用**免署名** | 中文圈最大免费商用素材聚合，覆盖古风/现代/日常/悬疑等 galgame 常见情绪；下载需登录，页面下载速度一般（习惯即可）；另有版权商用付费区（199 元/首，非免费范围） |
| **OpenGameArt** [opengameart.org](https://opengameart.org) | 游戏向音乐/音效数万条，音乐中含大量 CC0 游戏循环曲 | 逐条：CC0 / CC-BY / OGA-BY / GPL 混杂（高级搜索可按 CC0 过滤） | 老牌社区；可直接生成 credits 文件；**VGM（游戏音乐）风格浓度极高**，RPG/战斗/镇子/迷宫都有 |
| **itch.io 免费音频包**（搜标签 `free` + `music` / `audio` / `visual novel`） | 数以千计的免费/捐赠包，其中不少专为视觉小说制作 | 逐包授权，多为 CC0 或"free with credit" | 见 §5 精选；**针对性最强**——有人专门做"galgame 用"音乐包 |

### 🥈 Tier 2：需署名（CC-BY 类）或轻量限制、但质量/风格极佳的源

| 来源 | 内容 | 授权 | 说明 |
|---|---|---|---|
| **魔王魂** [maou.audio](https://maou.audio) | BGM / 旧ゲーム音楽 / 歌もの / 効果音，数百首起、持续更新（2025-12 仍发新曲） | 二选一：站规（商用免费、需署名"音乐:魔王魂"、改変自由、18禁OK、禁再配布/禁AI学習/禁流通配信）或 **CC BY 4.0** | 日系游戏 BGM 御三家之一；有**一括下载页** [maou.audio/all](https://maou.audio/all/) 可整站打包 |
| **MusMus** [musmus.main.jp](https://musmus.main.jp) | 数百首原创 BGM + 效果音；日常/安静/POP/钢琴向 | 商用免费；**署名必须（页面标注，无法署名时可付费免除）** | 干净简约的日系日常 BGM，galgame 日常场景贴合 |
| **OtoLogic** [otologic.jp](https://otologic.jp) | BGM + ジングル + 効果音（数千条），效果音尤其细腻，含环境音/系统音/UI | **CC BY 4.0**（署名即可商用）；可购"无署名合约"（BGM ¥2,200/曲等） | 质量高、更新频繁、无注册；BGM 与 SE 同站，工程效率高 |
| **甘茶の音楽工房** [amachamusic.chagasi.com](https://amachamusic.chagasi.com) | 500+ 首原创，和风/幻想/钢琴/治愈/悲伤/悬疑分类全 | 商用免费、**署名不要**、报告不要；禁再配布/禁JASRAC登记/禁配信；MP3 128kbps | 日式抒情/催泪钢琴的经典来源；**2019 年后停更**、音质一般 | 
| **incompetech（Kevin MacLeod）** [incompetech.com](https://incompetech.com) | 2,000+ 全长曲，按情绪（calm/epic/triumphant…）与风格浏览；游戏打包下载页 | **CC BY 4.0**（署名固定句式）；$30/曲可免署名 | 全球被用最多的免费配乐库之一，古典/氛围/史诗全覆盖 |
| **FreePD** [freepd.com](https://freepd.com) | 数百首**真公共领域**音乐（Kevin MacLeod 联合运营） | **CC0** | "绝对无风险"备胎；古典/电影配乐向 |
| **Pixabay Music** [pixabay.com/music](https://pixabay.com/music) | 数万首曲目 + 大量音效 | Pixabay Content License：商用、免署名；禁单独转卖音轨；2019 前上传为 CC0（分池） | 曲库大、质量参差；下载自动附带 License Certificate 可作抗 Content ID 凭证 |
| **H/MIX GALLERY** [hmix.net](https://www.hmix.net) | 302 首，主打和风/幻想/RPG/ホラー | 同人（含有偿发布）·YouTube·非商用**免费无署名**；**个人/同人以外商用需 ¥2,200/曲买断** | 作曲家秋山裕和，世界观风格强，RPG 味 galgame 适配高 |
| **Zapsplat** [zapsplat.com](https://zapsplat.com) | 数十万条音效（下载上限按计划） | 免费档需署"ZapSplat"；Premium 免署名；游戏/应用商用明确放行 | 音效覆盖比肩 Freesound 的规模备选 |

### 🥉 Tier 3：兜底/补充/按需

- **Musopen**（公版古典，免费账号每天 5 首下载限额）· **FMA**（逐曲 CC，需过滤 NC）· **Soundimage.org / Twin Musicom / Purple Planet / Audionautix / White Bat Audio / TeknoAXE**（CC-BY 类免费曲库，见 §4）
- **YouTube Audio Library**（仅限 YouTube 生态内使用，跨平台有风险）
- **掏声网 / 耳聆网**（中文聚合与社区，见 §6）
- **AI 生成**：本地开源模型或现成 CC0 AI 音乐包（见 §7）

### ⚠️ 明确不推荐用于本项目

- **Mixkit 音乐**：免费 license 明文禁止用于视频游戏内置；SE 部分 license 较宽松（逐条确认）
- **Bensound 免费档**：免费 license 只覆盖免费在线视频/教育用途，**游戏商用必须买 Professional 单曲**；即付费档才是游戏可用
- **Uppbeat 免费档**：每月 3 首、仅个人 license、商用受限
- **BBC Sound Effects**：RemArc 授权非商用
- **Jamendo 免费档**：个人使用授权，商用需付费 sync
- **AI 平台免费档**（Suno/Udio/AIVA/Soundraw/Mubert 等免费计划）：一律**禁商用**（详见 §7）
- **耳聆网/淘声网中 CC-BY-NC、Fair Use 条目**：不可商用

---

## 1. 授权模型速览（先看懂再下载）

| 授权 | 商用 | 署名 | 再分发/打包进游戏 | 典型源 |
|---|---|---|---|---|
| **CC0 1.0（公有领域奉献）** | ✅ | ❌ 不需要 | ✅（可随游戏分发；单独卖音频文件仍建议谨慎） | Kenney、FreePD、Freesound 的 CC0 条目、OpenGameArt CC0 条目、Sonniss（近似）、爱给网 CC0 条目 |
| **CC BY / CC-BY 4.0** | ✅ | ✅ 必须署名 | ✅ | incompetech、OtoLogic、魔王魂（可选）、Freesound CC-BY 条目、MusMus、CCmixter |
| **CC BY-SA** | ✅ | ✅ | ⚠️ 衍生作品需同协议（把单个音频嵌入游戏二进制一般可接受，但引擎内"素材库"整体分发时要小心） | OpenGameArt 部分条目 |
| **CC BY-NC** | ❌ | — | ❌ | FMA 大量曲目、Freesound 部分、FullminisIctus 的 VN 包音乐部分 |
| **站方自定义免费许可**（"免费使用、署名任意/必须/付费免除"等） | 通常 ✅ | 按站 | 通常 ✅（禁"音源为主体的再分发"是共同点） | OpenTracks、甘茶、効果音ラボ、効果音辞典、くらげ工匠、H/MIX（同人）、Zapsplat、Pixabay、Mixkit SFX |
| **免版税（Royalty-Free）付费/订阅模型** | ✅（付费档） | 视套餐 | ✅ | Bensound 付费档、Uppbeat 付费档、Audiostock（日本商用音频市集，部分免费曲） |

**三层铁律（本项目落地时使用）：**
1. 优先 CC0 或"署名任意"源 → 素材清单里可以不加 credits 段，省事且无再分发障碍。
2. CC-BY 类 → 游戏内部准备一个 credits 页/README 收纳固定署名句式即可，成本极低，可大量扩充曲库。
3. 每一首真正进入剧目的素材，记录「曲名 / 作者 / 来源链接 / 授权条款原文」四件套（后续若遇 Content ID 争议或授权变更，这是唯一自保凭证）。

---

## 2. 日系免费 BGM 站点（galgame 风格适配度核心区）

> 日系站点普遍是"免费素材文化"：商用免费、报告不需要、署名要求不一；共同禁止项是"音源本身再分发/单独贩售/配信平台登记/AI 学习"。

### 2.1 OpenTracks（旧 DOVA-SYNDROME）★首选
- 链接：https://opentracks.com（旧 https://dova-s.jp 自动 301 跳转，所有曲目页 URL 同样跳转）
- **改名事实（已核实）**：2026-08-18 公告 → 2026-09-15 完成改名，运营方为株式会社 TRACKS（2026-03 起法人化运营）。改名仅涉及名称/域名，条款无实质变化；旧署名 "DOVA-SYNDROME" 不需修改。
- 规模：**19,248 首 BGM/ジングル + 1,296 个 SE/ボイス**（2026-09 统计），仍在每日上新；作曲者均为真人（站方明确不接受 AI 生成音源）。
- 授权：音源利用ライセンス——个人/法人/商业/海外一律免费；署名"任意"（部分作曲家曲目页面特别标注需署名或需联系，下载前看曲目页）；禁止把音源作为主内容（如"作业用BGM"合集站）、禁止音乐为主的游戏/服务二次授权、禁止再配布素材形态。
- 下载：逐曲 MP3 直接下载，无需注册（2026 内计划引入免费登录与去广告付费套餐，但音源本身永久免费）。
- 风格与适配：提供**情绪标签**（明るい/楽しい/温かい/切ない/悲しい/緊張感/日常/ファンタジー…）、节奏（三拍子等）、乐器（ピアノ/弦楽器/管楽器…）多维检索，覆盖 galgame 全部 6 类场景；SE 含 UI/環境/自然/生活。**本项目 BGM 主力源。**
- 来源：[opentracks.com](https://opentracks.com)、[改名公告](https://opentracks.com/news/detail/7)、[PR TIMES 新闻稿](https://prtimes.jp/main/html/rd/p/000000007.000122198.html)、[ITmedia 报道](https://www.itmedia.co.jp/news/article/2608/18/2000000595/)、[Real Sound](https://realsound.jp/tech/2026/08/post-2494254.html)

### 2.2 魔王魂（Maou Damashii）★
- 链接：https://maou.audio（规则页 https://maou.audio/rule/）
- 规模：BGM（ネオロック/ボス戦/日常/幻想等）、旧ゲーム音楽（レトロ歌謡/8bit 风）、歌もの（ボーカル曲）、効果音（バキューン系）。持续更新（2025-12 新曲）。运营：株式会社ジョーカーサウンズ（森田交一）。
- 授权（已核实规则页）：**二选一**——① 站规：个人/商用/18禁/改変全 OK、报告不要；**需署名"音乐:魔王魂"**（TV 等无法署名场合可免）；禁再配布（曲单曲）、禁ストリーミング配信・ストア販売、禁 NFT、**禁 AI 学習/自動作曲系统取用**；② **CC BY 4.0** 亦可（且该 license 下允许游戏引擎加密打包）。
- 下载：逐曲 MP3 免注册；**一括ダウンロード页 https://maou.audio/all/**（官方整站打包，批量友好）。
- 适配：战斗/燃曲、奇幻、老式 JRPG 味道强；日常治愈向相对弱。配合引擎的高潮/战斗场景。
- 注意：有第三方"魔王魂转存/合集"站，勿用；认准 maou.audio。
- 来源：[maou.audio](https://maou.audio)、[利用ルール](https://maou.audio/rule/)

### 2.3 甘茶の音楽工房（Amacha Music Studio）
- 链接：https://amachamusic.chagasi.com（别馆「ノスタルジア」：怀旧/治愈钢琴向）
- 规模：500+ 首原创；分类：明るい/癒し/悲しい/ほのぼの/幻想的/和風・アジア/ジャズ/オルゴール/ピアノ等；另有"アニメ・ゲーム用/映像・映画用"场景分类。
- 授权（已核实官方利用規約）：**商用・个人均可、署名不要（任意）、加工可**；禁再配布/单独販售、禁 JASRAC 等管理団体登记、禁配信平台发布（含翻唱）。MP3 128kbps 仅此一档。
- 状态：**2019-09 后停止更新**（Wikipedia 确认），站仍在线。
- 适配：钢琴独奏/催泪/和风/日常四类 galgame 场景的经典日式听感；音质（128kbps）是短板，可作情绪样板或低优先级来源。
- 来源：[利用規約](https://amachamusic.chagasi.com/terms.html)、[Wikipedia](https://ja.wikipedia.org/wiki/%E7%94%98%E8%8C%B6%E3%81%AE%E9%9F%B3%E6%A5%BD%E5%B7%A5%E6%88%BF)

### 2.4 MusMus
- 链接：https://musmus.main.jp
- 规模：原创 BGM 数百首 + 効果音；以清爽、安静、POP/爵士/ボサノバ/钢琴类见长，也有奇幻/紧张分类。
- 授权：商用 OK、报告不要、加工可；**署名必须**（在作品里标注 MusMus；无法署名时可咨询付费使用）。Spotify 等配信服务上的 MusMus 曲不可用作 BGM（只可下载本站文件）。
- 下载：免注册 MP3。
- 适配：日常欢快/温馨日常场景的"看着干净"的日系配乐。
- 来源：[musmus.main.jp](https://musmus.main.jp)

### 2.5 OtoLogic
- 链接：https://otologic.jp
- 规模：BGM + ジングル + 効果音数千条（音色细腻、更新频繁）；含环境音/UI 系统音/机械/自然/幻想等。
- 授权：**CC BY 4.0** 商用免费；无署名合约（BGM ¥2,200 / ジングル ¥1,100 / 効果音 ¥550，买断）另含 WAV 提供。下载免注册 MP3；注意禁止把素材用于 Content ID 登记/商標申请。
- 适配：BGM 与 SE 同站可一次配齐；氛围向与环境音（雨、房间、街景）尤其好用。
- 来源：[otologic.jp](https://otologic.jp)、[FAQ](https://otologic.jp/free/faq.html)、[ノンクレジット契約](https://otologic.jp/free/onerous-contract.html)

### 2.6 H/MIX GALLERY
- 链接：https://www.hmix.net
- 规模：302 首（アルバム约 30 张分），作曲家秋山裕和，世界观浓：和风/幻想/RPG/ホラー/癒し/バトル。
- 授权（已核实）：**同人作品（含有偿分发）·YouTube（含收益化）·个人/学校/非商用 = 免费、申请不要、署名任意**；同人以外的商业游戏/应用/商品化需 **Standard ¥2,200/曲** 买断（一项目全曲 Project Pack ¥7,480）；广播广告/电影/大型商用需 Professional ¥3,300 起；店舗 BGM ¥9,900/年。MP3 免费下，WAV 为商用许可附带。
- 适配：和风/奇幻 R18 向 galgame 的镇子/迷宫/战斗/悲伤都很合适；**先按同人范围用（免费），一旦正式商业化每曲 ¥2,200 是明确成本**。
- 来源：[hmix.net](https://www.hmix.net)、[ご利用ガイド/利用規約](https://www.hmix.net/terms.html)

### 2.7 HURT RECORD
- 链接：https://www.hurtrecord.com
- 规模：1,000+ 曲；主打**伤感、抒情、治愈**的钢琴/弦乐/氛围。
- 授权：商用 OK、署名"任意（推荐）"；站方称"規約の緩さ"。禁单独再配布。
- 适配：**抒情浪漫/悲伤感动两大场景的直接对口源**，日系催泪曲风浓。
- 来源：[bloomeria 汇总文](https://bloomeria.jp/blog/free-bgm-sites-for-streaming)（附曲数/授权表格）

### 2.8 其他日系可用站（快速索引）
| 站 | 规模/风格 | 授权要点 | 备注 |
|---|---|---|---|
| **[Music-Note.jp](https://www.music-note.jp)** | 300+ 首，古典/器乐向 | 商用 OK、署名任意 | 求知/图书馆/圣堂氛围 |
| **[SHW（SoundHorizonWorld）](http://shw.in)** | 200+ 首游戏向（RPG/ACT/ダンジョン/戦闘） | 商用 OK、署名任意 | 老牌游戏 BGM 站 |
| **[ユーフルカ](https://yufuruka.com)** | 800+ 个 BGM/SE/ボイス，RPGツクール/Unity 对应、**loop 规格** | 商用免费（署名"可能な限り"） | ツクール系工程直插友好 |
| **[M-ART](https://m-art-music.com)** | 游戏/视频用免费 BGM | 署名不要 | 规模较小 |
| **[イワシロ音楽素材](https://iwasiro.hp.xrea.jp)** | BGM+効果音 | 个人/商用 OK、署名任意 | |
| **[エグザムゲームズ](https://examgames.moo.jp)** | 同人游戏用 BGM | 署名即可商用 | |
| **[MOMIZizm MUSiC](https://momizizm.com)** | 400+ 曲 RPG 向 | 个人免费可用；**法人需付费套餐**；署名必要（付费后免除） | 浏览时注意区分个人/法人条款 |
| **[TAM Music Factory](http://www.tam-music.com)** | 游戏/其他向原创 BGM + 効果音（MP3/OGG ループ/MIDI） | 非商用免费免署名；**商用要署名**（"音乐:TAM Music Factory"）即免费；报告 2021 起任意 | ピアノ/癒し幻想/オルゴール/和風分类，galgame 适配好；高音质版在 Audiostock 付费 |
| **[煉獄庭園](https://note.com/rengokuteien/n/n0f6dc2ab7bab)** | 1,000+ 曲（MP3/MIDI），ポップス/オーケストラ/ロック/ダーク | **署名必须**；个人/企业/同人/18禁均可免费；禁 AI 学習/直リンク | 2000 年开站的名站；主站 (rengoku-teien.com) 在线状态需自行确认（規約在 note 上） |
| **[フリーBGM BGMer](https://bgmer.net)** | 数百首，按场景 | 商用 OK、署名任意 | 近年活跃的日本站（被 bgmlibrary 对比文收录） |
| **[ノスタルジア](http://nostalgia.chagasi.com)** | 甘茶别馆，怀旧治愈钢琴 | 同甘茶 | |
| **[ポケットサウンド](https://pocket-se.info)** | 効果音 + BGM | 商用/加工/18禁 OK；**免费需署名**；付费（550円/SE、1100円/BGM、月额 1650円 免署名） | SE 质量好 |
| **[Audiostock](https://audiostock.jp)**（参考） | 日本商用音频市集，有免费曲/免费周 | 免费曲署名可能；其余按许可购买 | 付费兜底渠道，不用作免费主力 |

---

## 3. 日系音效（SE）站点

| 站 | 内容 | 授权（已核实） | 适配 |
|---|---|---|---|
| **効果音ラボ** ★ [soundeffect-lab.info](https://soundeffect-lab.info) | 2,000+ 音；ボタン・システム音/環境音/自然・動物/生活/戦闘/演出・アニメ/声素材；质量号称可上电视节目 | 商用免费、**署名・报告都不要**；**禁 18 禁 & 再配布** | UI 点击、翻页、环境音、战斗魔法一把抓；电视级质量；注意 18 禁限制 |
| **効果音辞典** [sounddictionary.info](https://sounddictionary.info) | 数千音，與効果音ラボ同作者系，命名直白搜索好 | 商用免费、署名不要；禁 18 禁/再配布/AI 学習；**"效果音为主体的内容"（如ポン出し App）被视为再配布**；但"把 SE 嵌进游戏作为操作音"明确属于允许项 | 同上；重"把 SE 当核心卖点"的场景不能直接打包 |
| **On-Jin ～音人～** [on-jin.com](https://on-jin.com) | 老牌効果音站（生活系/戦闘系/機械系等）；年度追加 | **个人/サークル/学校/ボランティア = 免费免連絡**；企业/营利制作需フォーム連絡取得使用許諾（免费） | 同人 galgame 免费；公司化运营后需先联系 |
| **フリー効果音素材 くらげ工匠** [kurage-kosho.info](http://www.kurage-kosho.info) | システム音/動作生活/自然生物/戦闘技魔法/機械/演出背景音 | 报告・署名・リンク不要，用途加工自由，**商用免费** | ゲーム系 SE 量身定做；"戦闘・技・魔法"直接对口战斗魔法音 |
| **無料効果音で遊ぼう！** [taira-komori.jpn.org](https://taira-komori.jpn.org) | 独特性强的效果音 + 环境音 | 个人/企业商用 OK | 环境音专长（小森平氏久站点） |
| **びたちー素材館** [bitachi.dojin.com](https://bitachi.dojin.com) | 独特/亲切向效果音 | 商用可 | 娱乐向补充 |
| **魔王魂 効果音** [maou.audio/category/se](https://maou.audio/category/se/) | バキューン/ズキューン系演出音 | 同 §2.2（需署名） | 演出/幽默音 |
| **ポケットサウンド** [pocket-se.info](https://pocket-se.info) | 効果音 + BGM，18 禁游戏可 | 免费需署名；付费免署名 | ↑见 §2.8 |

---

## 4. 国际免费音乐库（欧美系）

| 站 | 规模/风格 | 授权 | 下载方式 | 备注 |
|---|---|---|---|---|
| **incompetech** [incompetech.com](https://incompetech.com) | 2,000+ 全长曲；古典/氛围/史诗/轻松全情绪；游戏打包页 [incompetech.com/music/packs.html](https://incompetech.com/music/packs.html)（Game Bundle 1/2 附多 tempo/mix） | **CC BY 4.0**；$30/曲免署名 | 免注册 MP3；bundle ZIP | 署名句式固定："Music by Kevin MacLeod (incompetech.com), Licensed under CC BY 4.0" |
| **FreePD** [freepd.com](https://freepd.com) | 数百首**真公有领域**（CC0），电影/古典/氛围向 | **CC0** | 免注册 | Kevin MacLeod 联合背书；"绝对零风险" |
| **Pixabay Music** [pixabay.com/music](https://pixabay.com/music) | 数万首 + 音效；风格全 | Pixabay Content License：商用、免署名、可随游戏分发、**不可单独转卖音轨**；2019-01 前上传为 CC0 | 免注册（登录推荐）；自动发 License Certificate 下载 | 曲库海量但质量混杂；有 CC0 筛选滤镜 |
| **Mixkit** [mixkit.co](https://mixkit.co) | Envato 旗下，数百首精细 curate 音乐 + 大量 SFX | **音乐：Mixkit 免费许可明文禁止用于视频游戏**；**SFX：许可较宽松（商用免署名）** | 免注册 | 只能把其 **SFX** 纳入本项目；音乐排除 |
| **Free Music Archive (FMA)** [freemusicarchive.org](https://freemusicarchive.org) | 庞大、独立音乐向 | **逐曲 CC（CC0/CC-BY/CC-BY-NC/SA 混杂）**，NC 曲极多 | 免注册 | 只用 CC0/CC-BY 曲目；避免 NC |
| **ccMixter / dig.ccmixter** [dig.ccmixter.org](https://ccmixter.org) | 独立/电子/Remix 向 | 逐曲 CC（多为 CC-BY 系）；不少标注"game"用途 | 免注册 | 找"game"标签曲 |
| **Chosic** [chosic.com](https://www.chosic.com) | 聚合 FMA/Bensound 等 + 自家筛选 | 聚合各源授权 | 免注册 | 情绪/流派过滤好用；看每曲出处 |
| **Soundimage.org（Eric Matyas）** [soundimage.org](https://soundimage.org) | 游戏风格分类（Fantasy/Sci-Fi/Chiptune/Horror…），无缝 loop | 商用需署名（链接 soundimage.org） | 免注册 | 游戏专用向 |
| **Twin Musicom** [twinmusicom.org](https://www.twinmusicom.org) | 流派广（jazz→chiptune） | CC BY 类：署名"曲名 by Twin Musicom"；付费可免 | 免注册 | |
| **Purple Planet** [purple-planet.com](https://www.purple-planet.com) | 情绪向配乐 | 免费需署名；付费免 | 免注册 | 明确许可游戏商用 |
| **Audionautix（Jason Shaw）** [audionautix.com](https://audionautix.com) | 数百首 | CC BY 3.0（署名"Audionautix"） | 免注册 | |
| **White Bat Audio** [whitebataudio.com](https://whitebataudio.com) | 风格强（电子/氛围/史诗） | 免费商用、署名 optional | 免注册/按包 | |
| **TeknoAXE** [teknoaxe.com](https://teknoaxe.com) | 海量，风格杂（含动漫/VGM） | 商用免费、署名必须（可付费免） | 免注册 | |
| **Bensound** [bensound.com](https://www.bensound.com) | 100+ 免费曲（精致现代） | **免费档限"免费可访问在线视频+教育用途"，游戏商用需 Professional 单曲/订阅** | 免注册 | 免费档不适用于本项目 |
| **Uppbeat** [uppbeat.io](https://uppbeat.io) | 数千首 + SFX | 免费档 3 首/月、个人 license、商用受限；付费免 | 注册 | 免费档不推荐 |
| **YouTube 音频库** [studio.youtube.com](https://studio.youtube.com) | 数千首 + 音效 | 标准 license **仅限 YouTube 生态**；CC BY 曲可跨界 | 需 YouTube 账号 | 跨平台发布有风险，不推荐作为正式素材源 |
| **Musopen** [musopen.org](https://musopen.org) | 10 万+ 公版古典录音 + 乐谱 | 公版曲目无限制；现代演绎按曲标注 | 免费账号**每天 5 首**（标准 MP3）；Premium $55/年无限+无损 | 钢琴/弦乐/管弦乐古典的"催泪/悲壮"场景素材池；批量抓取需 Premium |
| **IMSLP** [imslp.org](https://imslp.org) | 公版乐谱 + 部分录音 | 公版/CC 按条目 | 免注册 | 古典乐谱为主，录音质量参差，一般不用 |
| **Internet Archive** [archive.org](https://archive.org) | 海量公版音频/歌集 | 逐项（大量 Public Domain/CC） | 免注册、可 curl/API 批量 | 找合集搜索"public domain music" |
| **SoundBible** [soundbible.com](https://soundbible.com) | 音效为主 + 少许音乐 | 逐条（CC/公有/专利授权混杂） | 免注册 | 小量补充 |

---

## 5. 一站式批量下载素材包（重点！）

### 5.1 Sonniss — #GameAudioGDC 年度免费包（十年合辑）★
- 链接：https://gdc.sonniss.com（当年），https://sonniss.com/gameaudiogdc（历史合辑页）
- 事实：GDC 2026 包 = 7.47GB / 347 个 WAV（17 家厂商精选）；**历史包从 2015 起全部保留可下**（社区镜像超 200GB，含官方 torrent）。
- 授权：EULA——全球非独占免版税、**无署名**、商用 OK、终身不限项目；**禁：单独再分发/辑成音效库转售、AI/ML 训练**。
- 下载：直链 ZIP + Google Drive 镜像 + 官方 torrent。
- 适配：影视级 foley/环境/UI/战斗/怪物/机械音；**SE 库地基**。

### 5.2 Kenney（CC0 资产帝国）★
- 链接：https://www.kenney.nl（音频板块 [kenney.nl/assets/category:audio](https://www.kenney.nl/assets/category:audio)）
- 事实：4 万+ 资产全 CC0；音频含 *Interface Sounds*（UI 音组）、*Impact Sounds*、*RPG Audio*、*Music Jingles*（85 个短 loop，CC0）、*Digital Audio* 等。
- 下载：按 pack 一个 ZIP 直下，更新时重下覆盖；无账号。
- 适配：UI 点击/悬停/确认、碰撞、8bit 音效的零风险来源；Jingles 可用于转场/提示音。

### 5.3 OpenGameArt（OGA，许可可筛选）★
- 链接：https://opengameart.org（高级搜索可按 License=CC0 过滤；[CC0 音乐集合页](https://opengameart.org/content/cc0-bgm) 2025-11 持续更新）
- 事实：音乐 3,000+（CC0 项 3.5k 量级，参考 HuggingFace 镜像数据集 [nyuuzyou/OpenGameArt-CC0](https://huggingface.co/datasets/nyuuzyou/OpenGameArt-CC0)，含 music 3.49k 行）；音效数百；可整集合生成 credits 文件。
- 授权：逐条 CC0 / CC-BY / CC-BY-SA / OGA-BY / GPL。
- 下载：逐文件 ZIP；无账号；有 RSS/API 类接口（第三方工具可抓）。
- 适配：VGM 风格 loop（战斗/镇子/迷宫/标题）浓度高，galgame 场景直接命中。

### 5.4 itch.io 免费音频包精选（视觉小说专精档）★
> itch.io 免费包授权逐包不同；以下为**已核实**适合 VN/本项目的免费包。搜索入口：https://itch.io/game-assets/free/tag-music / tag-audio / tag-visual-novel

| 包 | 内容 | 授权 |
|---|---|---|
| **Tallbeard Studios FREE Music Loop Bundle** [tallbeard.itch.io/music-loop-bundle](https://tallbeard.itch.io/music-loop-bundle) | **200+ 首 loop**（含 2026 Q2 等季度分卷、chiptune 卷、troubadour 卷，共约 700MB 多 ZIP） | **CC0**，署名可选 |
| **Vacuous BGM 系列** [vacuous2409.itch.io](https://vacuous2409.itch.io) | 几十个 VN 专精包（角色主题/日常/ホラー/和风/钢琴弦乐/战斗），每包 12 首 loop WAV 44.1k | 免费商用+署名（"BGM: ... — Vacuous BGM"）；大规模商用另行联系 |
| **Potat0Master – Free BGM for VN (Pack 1)** [potat0master.itch.io/free-background-music-for-visual-novels-bgm-pack-1](https://potat0master.itch.io/free-background-music-for-visual-novels-bgm-pack-1) | 5 首 VN 场景曲（标题/日常/惊悚/戏剧） | Royalty-free 商用、署名可选、可改不可单卖 |
| **LunaLucid – Creative Commons Collection 2015** [lunalucid.itch.io/free-creative-commons-bgm-collection](https://lunalucid.itch.io/free-creative-commons-bgm-collection) | 124MB BGM 合集 | **CC BY 4.0**（署名 LunaLucid） |
| **HydroGene – High Quality 16-bit RPG Music** [hydrogene.itch.io/high-quality-16-bit-music](https://hydrogene.itch.io/high-quality-16-bit-music) | 28 首 SNES 风格 JRPG 曲（mp3/ogg/wav 无缝 loop） | **CC0** |
| **ArrowSMorgan – Visual Novel OST Starter Pack** [arrowsmorgan.itch.io/visual-novel-ost-starter-pack](https://arrowsmorgan.itch.io/visual-novel-ost-starter-pack) | 15 曲（5 平静/5 恐怖/5 动作），Tsukihime/Umineko 风格影响，wav/mp3/ogg | **MIT License**（无 AI） |
| **WAFU Sound Works Vol.3（日式日常 VN 曲）** [wafusoundworks.itch.io/wafu-vol3-visual-novel-music-pack](https://wafusoundworks.itch.io/wafu-vol3-visual-novel-music-pack) | 12 首和风日常/告白/回忆/对峙/ED 曲，Full+无缝 Loop 双版本，WAV48k/OGG；另有免费 sampler 与全免 Vol | Royalty-free 无限商用免署名（AI 辅助制作；禁单卖/AI 训练；不可上配信平台） |
| **Souichi Sakagami (Trial & Error) – 72 首日式动漫/游戏曲** [tandess.itch.io/free-songs-pack](https://tandess.itch.io/free-songs-pack) | 72 首（465MB 一个包） | Royalty-free（官网 [tandess.com](http://www.tandess.com/en/music/free-material/material.html) 同步） |
| **Oasis Game Assets – VN Music Pack Vol.1** [oasis-game-assets.itch.io/visual-novel-music-pack-vol-1](https://oasis-game-assets.itch.io/visual-novel-music-pack-vol-1) | 12 曲（日常/咖啡店/深海/惊悚/送别等） | Royalty-free（无 AI） |
| **Keynata Commons Music Pack** [carf-coder.itch.io/keynata-commons-music-pack](https://carf-coder.itch.io/keynata-commons-music-pack) | 99 首 AI 生成古典/JPOP/Rock（MP3+MIDI，规则统计引擎非神经网络） | **CC0**（昨天刚发；WAV 母带在 [carf-coder.github.io/keynata-commons](https://carf-coder.github.io/keynata-commons)） |
| **AssetSmithy – 3 Free Fantasy VN Tracks** [assetsmithy.itch.io/3-free-fantasy-music-3-royalty-free-visual-novel-tracks](https://assetsmithy.itch.io/3-free-fantasy-music-3-royalty-free-visual-novel-tracks) | 3 首全长幻想风 VN 曲（WAV48k+MP3 320） | Royalty-free 商用、署名可选；禁单卖/Content ID 登记；AI 制作已声明（Steam 需披露） |
| ⚠️ **FullminisIctus – Visual Novel Audio Pack** [fulminisictus.itch.io/visual-novel-audio-pack](https://fulminisictus.itch.io/visual-novel-audio-pack) | 14 首 VN 音乐 + UI SFX + 转场 jingle（1GB） | **音乐 CC-BY-NC（禁商用）**；**SFX CC-BY（可商用需署名）**——只取 SFX 部分 |
| ⚠️ **Quaternius/AI 转存类** | — | 注意辨别 itchio 上大量 AI 冒名转存包，只用作者本人主页 |

---

## 6. 中文资源

### 6.1 爱给网 ★（中文圈主力）
- 链接：音乐 https://www.aigei.com/music / 音效 https://www.aigei.com/sound / 授权查询 https://www.aigei.com/license/sound
- 规模：**CC 配乐约 2 万首（免费商用）+ CC 音效大量**；另有版权配乐/音效付费商用区（配乐 199 元/首、音效 4.99 元/首起）与 CC 游戏音效专区。
- 授权：CC 区逐条标注（"CC0-可商用-公共版权"/"CC-可商用-署名"/"CC-可非商用"等，还有 pixabay/pexels/freepik/videvo 等平台 license 标签），过滤"可商用(含CC0/公共版权)"即可。**CC0 条目免署名可商用**。
- 下载：需登录（免费账号）；有 App；批量下载对免费用户受限（单条逐下）。
- 适配：中文语境、古风、现代言情、游戏 UI/环境音等 galgame 场景全覆盖；情绪标签（温馨/紧张/悲壮/燃）与引擎 6 类场景可对齐。
- 注意：大数据量来源 5000 万+，混杂 UGC；**只用 CC 区并核对单条协议**。

### 6.2 淘声网（toSound）★
- 链接：https://www.tosound.com
- 事实：聚合**耳聆网、Freesound、Looperman** 等国内外平台的百万级声音的一站式中英搜索下载站（"吐司"搜索引擎 + AudioDown 下载加速），免注册直接搜/下；每条标注授权类型（CC0 / CC-BY / CC-BY-NC / Royalty-Free / Fair Use / Public Domain）。
- 适配：当"中文关键词搜 Freesound 等英文库"的桥；CC0 与 Royalty-Free 条目可商用。
- 注意：有安全防护（创宇盾），抓取自动化不友好，人工浏览无碍。

### 6.3 耳聆网（ear0.com）
- 链接：https://www.ear0.com
- 事实：中国最早的 CC 声音分享社区（2013 起，非营利），**截至 2026-09 仍在线、仍有新上传**；全部声音按 CC0 / CC-BY / CC-BY-NC 三档授权，免费注册下载。
- 适配：国内原创实录音效（环境、生活、自然）稀有补充；下载需注册，按条核 CC 档位。

### 6.4 国内 VN 圈子与付费/平台绑定源（不推荐直接采用）
- **橙光/66RPG**：橙光官方素材库素材仅限橙光平台内使用（平台绑定），且明确"公版音乐不可用于作品"、商用音乐需授权并注明出处——**不适合我们的独立引擎**。
- **站长素材（sc.chinaz.com）等**：批量需 VIP 且授权条款常含糊/面向站长用途，游戏商用风险高，不推荐作为素材源。
- **新片场素材/视觉中国等**：商用为正版授权售卖，不在"免费"范畴。

---

## 7. AI 生成音乐（平台与成品包）

### 7.1 生成平台（免费档一律禁商用）
| 平台 | 免费档 | 商用条件 | 备注（2026 现状） |
|---|---|---|---|
| **Suno** [suno.com](https://suno.com/pricing) | 50 credit/日（约 10 首）、可下载、**禁商用** | Pro **$10/月**（约 500 首/月）或 Premier $30/月；付费期间生成的曲目永久保留商用权 | v5.5 模型；免费档下载权限正在收紧（转向仅试听/分享） |
| **Udio** [udio.com](https://www.udio.com) | 10 credit/日+100/月，禁商用 | Standard $10 非商用；**Pro $30/月**才有商用权 | **2025-10 起（UMG 合作后）已暂停全部下载/导出**，当前不可用于生产流程 |
| **AIVA** [aiva.ai](https://www.aiva.ai) | 3 首/月下载，版权归 AIVA | Standard €15：YouTube/Twitch 等有限商用；**Pro €49：全版权归属** | 古典/配乐向，适合钢琴弦乐但贵 |
| **Soundraw** [soundraw.io](https://soundraw.io) | 无限试听与编辑、**无下载** | Creator 约 $6–11/月（MP3 无限下载+永续商用许可）；Artist 档 WAV/Stems | **用自家原创素材训练**，无版权诉讼云，商用最放心；禁单独转卖 |
| **Mubert** [mubert.com](https://mubert.com) | 25 首/月、禁商用（Ambassador 档） | Creator 约 $14/月 | |
| **Riffusion** | 免登录无限生成、个人用途 | 付费档/本地自托管 MIT 模型 | 本地跑可商用（自担版权责任） |
| **MusicGen（Meta）/ Stable Audio Open（Stability）** | 开源权重，本地自部署 | 生成物归用户（自担风险；权重许可限制见各项目 LICENSE） | 技术团队可在内网跑，批量产"练习曲"再人工筛选 |
| **Beatoven / Boomy / Loudly / Soundful** | 免费档禁商用 | 付费档 | 同质化，优先级低 |

**官方结论**：想用 AI 做剧目 BGM，最划算路径是 **Suno Pro（$10/月，一次性订阅 1–2 个月把曲库做完）** 或 **Soundraw Creator（约 $11/月，商用最干净）**；免费档不能进商业游戏。

### 7.2 现成的 CC0 / 免费商用 AI 音乐包（推荐直接用）
- **Keynata Commons**（99 首，CC0，MP3+MIDI/WAV 母带）：https://carf-coder.github.io/keynata-commons（itch.io 页见 §5.4）
- **btahir/open-lofi**（GitHub，150+ lo-fi CC0 10 类，Suno v5 制作人捐赠公有领域，含 catalog.json 清单）：https://github.com/btahir/open-lofi
- **HowWorks Music**（约 275 首 CC0 AI 曲，免账号）：howworks.ai（自述全 CC0、无 Content ID 指纹）
- 注意：AI 内容上线 Steam 需按 Steam 政策披露 AI 元素；非 AI 素材包（下文标注"无 AI"的 itch 包）无此负担。

---

## 8. GitHub 开源/聚合仓库

| 仓库 | 内容 | 授权 |
|---|---|---|
| **SoundSafari/CC0-1.0-Music** [github.com/SoundSafari/CC0-1.0-Music](https://github.com/SoundSafari/CC0-1.0-Music) | **全球最大 CC0 音乐语料 ~7,000 首 / 约 40GB**（按来源站分组，100MB+ 文件剔除） | CC0（文件本身按各自来源，成套即 CC0 池） |
| **madjin/awesome-cc0** [github.com/madjin/awesome-cc0](https://github.com/madjin/awesome-cc0) | CC0 资产导航（含音乐/音效分类：FMA 5400+ 公版曲、Musopen、itch.io CC0 1688 项等） | 导航 |
| **TMHSDigital/Free-Game-Dev-Assets** [github.com/TMHSDigital/Free-Game-Dev-Assets](https://github.com/TMHSDigital/Free-Game-Dev-Assets) | 免费商用游戏资产目录（audio/ 分类含 Sonniss GDC、Incompetech、Freesound 等条目+许可元数据） | 目录本体 CC0 |
| **fiehrfly/muses** [github.com/fiehrfly/muses](https://github.com/fiehrfly/muses) | 免费/开源音乐库清单（含平台限制注记），sources/*.md 逐库说明 | 目录 CC0 |
| **Kavex/GameDev-Resources** [github.com/Kavex/GameDev-Resources](https://github.com/Kavex/GameDev-Resources) | 经典 gamedev 资源导航（音频：FreePD/Freesound/Musopen/PacDV/GameSounds 等） | 导航 |
| **gravitygamesinc/gamedev-free-resources** [github.com/gravitygamesinc/gamedev-free-resources](https://github.com/gravitygamesinc/gamedev-free-resources) | 免费资源（含 OST/SFX 平台列表） | 导航 |
| **csevier/awesome-open-assets** [github.com/csevier/awesome-open-assets](https://github.com/csevier/awesome-open-assets) | 公有领域/CC 资源大全（音乐/音效/游戏 OST） | 导航 |
| **Kavex/GameSounds** [github.com/Kavex/GameSounds](https://github.com/Kavex/GameSounds) | 可直接用的免费游戏音效样本库 | 站方许可 |

---

## 9. API / 可脚本化下载路径（工程接入角度）

| 源 | 方式 | 备注 |
|---|---|---|
| **Freesound** | 官方 **REST API**（token 免费注册拿，支持按 license=CC0 过滤、分页、频谱/波形） | 最适合写脚本批量建库；速率有限制 |
| **Internet Archive** | 开放 API + 直接 HTTP 下载，可 curl 整个集合 | "Public Domain Music" 类集合可批量 |
| **Sonniss** | 直链 ZIP + 官网 torrent | 一次下齐，无需脚本 |
| **Kenney** | 每 pack 直链 ZIP（URL 规律） | 可脚本批量 |
| **OpenGameArt** | 逐文件 ZIP + 高级搜索 URL 参数；社区有 API/镜像 | |
| **魔王魂** | 官方**一括ダウンロード页** https://maou.audio/all/ | 整站打包，脚本友好 |
| **OpenTracks（原 DOVA）** | 逐曲页面直链下载；无公开 API（有 AI 検索β） | 批量需抓页面；下载本身免费免登录 |
| **爱给网** | 需登录/App；无公开 API | 批量受限 |
| **淘声网** | 免登录下载，但有创宇盾防护 | 不宜自动化 |
| **itch.io** | 网页下载；官方 **butler CLI** 可自动购买/下载 | 免费包用 butler 可脚本化 |
| **Pixabay** | 官方 API（免费音乐/音效，需 token） | 有 Content License 条款约束 |

---

## 10. 六大 BGM 场景 × 常见 SE 的选源映射

### BGM（6 类场景）
| 场景 | 首选源 | 备选源 |
|---|---|---|
| 日常欢快 | OpenTracks（楽しい/明るい 标签）、MusMus（POP/ボサノバ）、Tallbeard CC0 包、WAFU Vol.3 | Vacuous 日常包、Pixabay（按 mood）、愛给 CC 配乐 |
| 温馨日常 | 甘茶（ほのぼの/癒し）、OtoLogic（アンビエント）、OpenTracks（温かい/穏やか） | incompetech（calm）、Soundimage、open-lofi |
| 抒情浪漫 | HURT RECORD（1000+ 伤感/抒情）、OpenTracks（切ない+ピアノ）、TAM（ピアノ/オルゴール） | 甘茶钢琴、AIVA 风格（如付费）、MusMus 钢琴 |
| 悲伤感动 | HURT RECORD、OpenTracks（悲しい/寂しい）、甘茶（悲しい） | Musopen 古典慢板（免费档逐首取）、FreePD |
| 悬疑紧张 | OpenTracks（緊張感/怪しい/不気味）、OtoLogic（環境音+SE 组合）、incompetech（dark） | Vacuous Horror 系列（12 包）、FMA CC0 氛围曲、煉獄庭園（ダーク系） |
| 高潮燃曲 | 魔王魂（ネオロック/バトル）、OpenTracks（力強い/激しい/game 标签）、SHW（戦闘曲） | HydroGene 16-bit、incompetech（epic）、OpenGameArt CC0 battle |

### SFX（常用类别）
| SE 类别 | 首选源 |
|---|---|
| UI 点击/悬停/确认 | 効果音ラボ（ボタン・システム音）、Kenney Interface Sounds、OtoLogic（UI/システム） |
| 文本框打字/翻页/光标 | 効果音ラボ（システム音）、Freesound CC0 搜索 type/keyboard、愛给 UI 专区 |
| 开门/脚步/物件 | Sonniss GDC 包（foley）、Freesound CC0、効果音ラボ（生活） |
| 雨声/蝉鸣/风/海浪（环境） | Sonniss（ambience 专卷）、Freesound CC0（雨/蝉大量）、効果音ラボ（環境音/自然動物）、OtoLogic 環境音、無料効果音で遊ぼう！ |
| 心跳/惊讶/闪光/钟声/提示 | 効果音ラボ、OtoLogic（ジングル/アクセント）、Kenney（jingle/UI）、Freesound CC0 |
| 魔法/战斗/打击 | くらげ工匠（戦闘・技・魔法）、効果音ラボ（戦闘/演出）、Sonniss（magic/fantasy 在 GDC 包内很常见）、魔王魂 SE |
| 系统 BGM 切换/剧情转场 | Kenney Music Jingles（85 个 CC0）、Vакуous 转场包、itatachi 系 |

---

## 11. 风险与注意事项（落到项目里必须执行的）

1. **授权会变，落地前逐条复核**：Pixabay 2019/2023 两次改约、OpenTracks 刚改名；本站规则页为准，别信二手列表。
2. **"免费下载" ≠ "可商用"**：FMA/itch.io 大量 NC 曲；搜到的免费包务必看包内 LICENSE 文件（例：FullminisIctus VN pack 音乐是 NC）。
3. **再分发红线**：几乎所有源的共同禁令是"音源本体的二次分发/转售/配信登记/素材库再贩"。我们的"素材库随 exe 分发"是**随成品游戏嵌入**，普遍允许；但**不要**把素材库单独打包成一个"素材包"对外卖。
4. **Content ID / 音商標**：魔王魂/効果音辞典/OtoLogic 等明确禁止把素材注册 Content ID 或音商標。运营阶段注意别把素材曲提交到 YouTube Content ID 系统。
5. **AI 相关条款**：魔王魂/OtoLogic/煉獄庭園/Sonniss/効果音辞典 均禁 AI 学习/训练取用（Sonniss 禁 AI/ML 训练尤其严格）——**不要把下载的素材喂给本地模型做训练**；但作为"输入素材播放于产品"没有问题。
6. **18 禁限制**：効果音ラボ/効果音辞典禁成人作品；魔王魂/OpenTracks/OtoLogic 等允许。若引擎后续承接 18+ 内容，SE 主力源要换成允许 18+ 的（OpenTracks SE、OtoLogic、くらげ工匠）。
7. **平台锁定源规避**：YouTube 音频库（仅 YouTube）、Mixkit 音乐（禁游戏）不入库。
8. **AI 生成曲入 Steam**：凡 AI 制作的曲目（WAFU/AssetSmithy 等包）需在国内/Steam 政策下做 AI 内容披露；Suno/Udio 免费档生成的曲目**不可商用**。
9. **录音里的"人声肖像权/环境可识别物"**：Freesound/耳聆网等社区录音如含他人说话/品牌声，商用前横幅规避。
10. **版本与备份**：建议按"源站名/日期/授权截图"归档到仓库 media-cache 结构，避免日后依赖源站在线状态。

---

## 12. 关键来源总链接（本报告全部事实出处）

- OpenTracks（原 DOVA）：https://opentracks.com ｜ 改名公告 https://opentracks.com/news/detail/7 ｜ PR TIMES https://prtimes.jp/main/html/rd/p/000000007.000122198.html ｜ ITmedia https://www.itmedia.co.jp/news/article/2608/18/2000000595/ ｜ Real Sound https://realsound.jp/tech/2026/08/post-2494254.html
- 魔王魂：https://maou.audio ｜ 规则 https://maou.audio/rule/ ｜ 一括下载 https://maou.audio/all/
- 甘茶の音楽工房：https://amachamusic.chagasi.com ｜ 規約 https://amachamusic.chagasi.com/terms.html ｜ Wikipedia https://ja.wikipedia.org/wiki/甘茶の音楽工房
- MusMus：https://musmus.main.jp
- OtoLogic：https://otologic.jp ｜ FAQ https://otologic.jp/free/faq.html ｜ 無署名契約 https://otologic.jp/free/onerous-contract.html
- H/MIX GALLERY：https://www.hmix.net ｜ 規約 https://www.hmix.net/terms.html
- HURT RECORD：https://www.hurtrecord.com （授权摘自 bloomeria 汇总 https://bloomeria.jp/blog/free-bgm-sites-for-streaming）
- 効果音ラボ：https://soundeffect-lab.info ｜ 効果音辞典 https://sounddictionary.info/terms-of-use/ ｜ くらげ工匠 http://www.kurage-kosho.info ｜ On-Jin https://on-jin.com/kiyaku.php ｜ ポケットサウンド http://pocket-se.info/rules/
- TAM Music Factory：http://www.tam-music.com/interface ｜ 煉獄庭園規約：https://note.com/rengokuteien/n/n0f6dc2ab7bab
- Sonniss：https://sonniss.com/gameaudiogdc ｜ GDC2026 https://gdc.sonniss.com ｜ 许可 https://sonniss.com/gdc-bundle-license/ ｜ BPB 报道 https://bedroomproducersblog.com/2026/03/16/sonniss-gdc-2026-bundle/
- Kenney：https://www.kenney.nl
- OpenGameArt：https://opengameart.org ｜ HuggingFace CC0 镜像数据集 https://huggingface.co/datasets/nyuuzyou/OpenGameArt-CC0
- Freesound：https://freesound.org （规模/CC0 占比数据引自 Cinevva 汇总 https://app.cinevva.com/guides/free-sound-effects-music）
- itch.io 包：Tallbeard https://tallbeard.itch.io/music-loop-bundle ｜ Vacuous https://vacuous2409.itch.io ｜ Potat0Master https://potat0master.itch.io/free-background-music-for-visual-novels-bgm-pack-1 ｜ LunaLucid https://lunalucid.itch.io/free-creative-commons-bgm-collection ｜ HydroGene https://hydrogene.itch.io/high-quality-16-bit-music ｜ ArrowSMorgan https://arrowsmorgan.itch.io/visual-novel-ost-starter-pack ｜ WAFU https://wafusoundworks.itch.io/wafu-vol3-visual-novel-music-pack ｜ Souichi Sakagami https://tandess.itch.io/free-songs-pack ｜ Oasis https://oasis-game-assets.itch.io/visual-novel-music-pack-vol-1 ｜ Keynata https://carf-coder.itch.io/keynata-commons-music-pack ｜ AssetSmithy https://assetsmithy.itch.io/3-free-fantasy-music-3-royalty-free-visual-novel-tracks ｜ FullminisIctus https://fulminisictus.itch.io/visual-novel-audio-pack
- 国际曲库：incompetech https://incompetech.com/music/royalty-free/licenses/ ｜ FreePD https://freepd.com ｜ Pixabay https://pixabay.com/music ｜ Mixkit https://mixkit.co ｜ FMA https://freemusicarchive.org ｜ ccMixter https://ccmixter.org ｜ Chosic https://chosic.com ｜ Soundimage https://soundimage.org ｜ Twin Musicom https://twinmusicom.org ｜ Purple Planet https://www.purple-planet.com ｜ Musopen https://musopen.org/faq/ ｜ Uppbeat https://uppbeat.io ｜ Bensound 条款 https://www.bensound.com/terms-and-conditions
- AI 平台：Suno https://suno.com/pricing ｜ Soundraw https://soundraw.io ｜ AI 商用对比（MusicDelta）https://musicdelta.com/en/articles/ai-composition-tools-commercial-use ｜ Udio 现状（Belreos）https://belreos.com/blog/best-ai-music-generator-2026
- GitHub：https://github.com/SoundSafari/CC0-1.0-Music ｜ https://github.com/madjin/awesome-cc0 ｜ https://github.com/TMHSDigital/Free-Game-Dev-Assets ｜ https://github.com/fiehrfly/muses ｜ https://github.com/btahir/open-lofi
- 中文：爱给网 https://www.aigei.com ｜ 淘声网 https://www.tosound.com ｜ 耳聆网 https://www.ear0.com ｜ 橙光素材规范 https://www.66rpg.com/course/details/t_92/110.shtml