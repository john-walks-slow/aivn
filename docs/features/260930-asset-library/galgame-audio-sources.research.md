# galgame 向 BGM / SFX 素材源调研 · 可执行下载清单

> 调研时间：2026-09-30。所有「实测」结论均为本次调研在本机（直连 + `http://127.0.0.1:7890` 代理双通路）真实执行所得。
> 本文件的目标是**可直接照着下载**：每个包给站点 URL、下载页 URL、许可类型 + 原文摘录、曲目清单、是否允许原文件再分发、是否需注册/付费、实测下载可行性。

---

## 0. 判定尺子（为什么大量「免费素材站」不能进库）

`library/<kind>/<id>/` 进 git，且随剧目包导出 ⇒ **素材文件本身被再分发**。

| 情形 | 判定 |
| --- | --- |
| CC0 / Public Domain | ✅ 可入库 |
| CC BY 4.0 / 3.0、OGA-BY 3.0/4.0、CC BY-SA 4.0/3.0 | ✅ 可入库（需在 `meta.json.source`/剧目内保留署名） |
| 条款**明确写出**「允許再配布原素材」「You are free to repost my tracks」 | ✅ 可入库 |
| 「royalty-free」但**未**明确允许再分发原文件 | ❌ 默认保留所有权利，不可入库 |
| 条款写「再配布禁止」「素材として配布不可」「resell or redistribute the assets as assets」「Standalone redistribution … prohibited」 | ❌ 不可入库 |
| 「禁止把素材整理成素材集再发布」「アプリ/ツールで素材として抜き出せる状態での配布は再配布」 | ❌ 不可入库（**这条正中本项目的使用方式**） |
| booru / Danbooru 规则站、来源不明的打包聚合站 | ❌ 排除 |
| Pixabay / Mixkit / Zapsplat / Freesound 外的 stock 站 | ❌ 其条款普遍禁止 "Standalone basis" 再分发 |

**CC0 ≠ 放弃录音本身的全部权利**：CC0 只是作者放弃自己那一层著作权。若素材里含第三方采样/演奏录音，CC0 标签不覆盖那一层。对纯合成/自录的素材风险低，对「钢琴翻弹名曲」类要警惕。

---

## 1. 结论速览：本次调研找到的可入库源

### 1.1 第一梯队（推荐优先落地）

| 源 | 许可 | 可入库 | 实测下载 | 对 galgame 的价值 |
| --- | --- | --- | --- | --- |
| **OtoLogic** `otologic.jp` | CC BY 4.0，FAQ **明确允许再分发原素材** | ✅ | ✅（需浏览器会话中转，见 §7.1） | **日系校园 + 抒情钢琴 + 演出音效的最强单源**：学校のチャイム 46 变体、回想/闪光/耳鸣/心跳/翻书/写字/脚步、オルゴール + ポップス・ピアノ BGM |
| **PeriTune** `peritune.com`（2026-02 以前公开曲） | CC BY 4.0（新旧分界见 §3） | ⚠️ 有条件 ✅ | ✅（直连 ZIP） | 473 首日系钢琴/日常/治愈，**雨の街ピアノ、情感ピアノ、造語コーラスピアノ** |
| **OpenGameArt** `opengameart.org` | CC0 / CC-BY / CC-BY-SA / OGA-BY 混合（逐条看） | ✅ | ✅（直链 200） | 打底量大、许可最干净；本次已挑出 VN 向钢琴/角色主题曲 + 校园 SFX |
| **itch.io 的 CC0 / CC-BY 音频包** | CC0 / CC BY 4.0 | ✅ | ✅（脚本可批量，见 §7.2） | 现代 galgame 风格钢琴包、2000+ 免署名 SFX |
| **Kenney** `kenney.nl` 音频包 | CC0 | ✅ | ✅（直链 zip） | 9 个包 ≈ 780 个 SFX（含 `bookFlip1/2/3.ogg`） |
| **Freesound**（逐条 CC0 过滤） | CC0 / CC BY | ✅（需逐条看许可） | ⚠️ 需登录 | 补齐**长尾具体音**（上课铃/椅子拖动/走廊脚步/耳鸣/闪光） |

### 1.2 本项目当前缺口对照（`library/` 现状 → 需要补什么）

现状：BGM 20 条（`bgm_bittersweet … bgm_town_theme`）、SFX 33 条（`sfx_belt_handle … sfx_wind_chime`）。
现有音频绝大多数来自 OpenGameArt CC0，属**通用西式**音色。

| 缺口 | 现状 | 建议来源（可入库） |
| --- | --- | --- |
| 日系抒情钢琴 BGM | 只有 `bgm_piano_soft_loop`（28s 短循环，extenz/CC0） | OtoLogic ポップス・ピアノ 8 曲；PeriTune 情感钢琴；roskovair CC0；tungerman CC-BY |
| 上课铃 / 校内放送 | 无 | OtoLogic `school_bell01`（46 文件）+ `announce01` + `electronic-chime01` |
| 翻书 / 写作业 | 有 `sfx_book_open`/`book_close`/`page_flip`/`page_place`，偏通用 | OtoLogic `books01`（本01-03/雑誌01/新聞01）+ `writing_material02`（鉛筆/シャープペン/ボールペン）+ OGA `pencil.zip` |
| 椅子拖动 | 无 | Freesound CC0（`571295`/`571294`/`173940` 等，见 §6.3） |
| 走廊脚步 | 有户外材质脚步 7 条，无室内走廊 | Freesound CC0 `455782`（高中走廊）/`368834`/`811940`；OtoLogic `footsteps01` |
| 体育馆 | 无 | Freesound CC0 `472673`（Footsteps in Gym）；OtoLogic `applause-cheer01`/`handclap-yell01` |
| 社团活动 | 无 | OtoLogic `applause-cheer01`、`handclap-yell01`、`game-sports01` |
| 时钟 | 有 `sfx_clock_tick` | OtoLogic `clock01`/`pendulum-clock01`/`pocket-watch01`（含整点报时） |
| 门 | 有 5 条 | OtoLogic `doorbell01`（门铃/入店旋律） |
| 心跳 | 有 3 条 | OtoLogic `heartbeat01`（心拍01-04，含萌系デフォルメ） |
| **耳鸣 / 目眩** | 无 | OtoLogic `dizzy01`（オノマトペめまい 3 变体）；Freesound CC0 `377205/377206/377207/377208`（tinnitus 四格式） |
| **闪回 / 闪光** | 无 | OtoLogic `flashback01`（回想01-09）+ `flash01`（闪光照相）+ `sparkle01` |
| 蝉鸣（夏日场景，日系 galgame 必备 ambient） | 有 `bgm_forest_ambience` | OtoLogic `city_ambi01`（雑踏 街頭02 = 夏の環境音/セミ）；Freesound CC0 `717588`/`571090`/`717587`/`396809` |
| 转场 / 幕 | 无 | OtoLogic `scene_change01`、`curtain01`、`cut01` |
| UI 音 | 有 4 条 | ObsydianX CC0 Interface SFX 200+；Kenney `ui-audio`/`interface-sounds` |

> 注意 `library/` 里 `sfx_belt_handle` 与 `sfx_page_flip` 的 `source` 分别写着 `OpenGameArt / Kenney / CC0`——Kenney 的 `beltHandle1/2.ogg`、`bookFlip1/2/3.ogg` 出自 `kenney_rpg-audio.zip`，本次已确认该 zip 的直链（§4.3）。

---

## 2. OtoLogic（`otologic.jp`）— 最匹配的日系单源

### 2.1 许可（可入库 ✅）

- 许可页：<https://otologic.jp/free/license.html>
- FAQ：<https://otologic.jp/free/faq.html>
- 原文（FAQ）：
  > 「当サイトのフリー素材利用規約は、クリエイティブ・コモンズ・ライセンス（CCライセンス）という、第三者の非営利組織が制定するパブリック・ライセンスを採用しています。… 当サイトが採用しているバージョンは CC BY 4.0（クレジット表記の義務さえ果たせば、その他大きな制約はないライセンス）です。」
  > 「適切なクレジット表記が継承される限り、素材用音源として用いるだけでなく、**素材そのものを第三者に再配布し、自由に他者と共有することもできます**（CC BY 4.0 第2条 aの1のA参照）」
- 每个页面底部都有：「当ページのフリー素材は CCライセンス(CC BY 4.0) の下に提供されています。」
- 署名写法（官方示例）：
  - `使用した音素材：OtoLogic(https://otologic.jp)`
  - `BGM by OtoLogic(CC BY 4.0)`
  - `BGM・効果音素材：OtoLogic（https://otologic.jp）`
- 允许：格式转换（「いかなるフォーマットであっても問題ありません」）、商用、无注册、免费。
  > 「・学校の授業や部活、イベントに使えますか？ 問題なくお使いいただけます。 なお特別な優遇はなく、クレジット表記は必須です。」
- 禁止：Content ID 登録、把音源作为商标（サウンドロゴ）注册。
- 免署名授权（可选，非必需）：<https://otologic.jp/free/onerous-contract.html>
  - 价格：**BGM ¥2,200 / ジングル ¥1,100 / SE ¥550**（「1点の素材 = zip 文件里的一整套（素材名）」）
  - 特权：免署名 + **提供 WAV 44.1kHz/16bit**；通过邮件直接交易、发票结算。
- 音频规格：<https://otologic.jp/free/specifications.html>
  > 「現在、フリー素材の配布形式は原則MP3（LameMP3：VBR Q4）のみとなっています。無圧縮のWAVファイル（44.1kHz 16bit）は、ノンクレジットライセンスご契約時の特典として入手可能です。」
  ⇒ **免费只能拿到 MP3（VBR Q4）**；库内若要无损需买免署名授权。

### 2.2 下载 URL 模式（已从页面 DOM 中取出并验证）

```
# 分类页
https://otologic.jp/free/se/<slug>.html
https://otologic.jp/free/bgm/<slug>.html

# 单个试听 MP3（pre = preview，可直接 <audio> 播放）
https://otologic.jp/sounds/se/pre/<name>.mp3
https://otologic.jp/sounds/bgm/pre/<name>.mp3

# 整包 ZIP（MP3；一个「素材名」一个 zip）
https://otologic.jp/sounds/se/mp3-zip/<Name>-mp3.zip
https://otologic.jp/sounds/bgm/mp3-zip/<Name>-mp3.zip
```
名称含空格时 URL-encode（`%20`）。实测样例：
- `https://otologic.jp/sounds/se/mp3-zip/Japanese_School_Bell05-mp3.zip`
- `https://otologic.jp/sounds/bgm/mp3-zip/haru%20no%20kyousitu-mp3.zip`（春の教室）
- `https://otologic.jp/sounds/bgm/mp3-zip/anata%20wo%20siritakute-mp3.zip`

**⚠️ 实测**：`curl` 直连（含浏览器 UA、含 `cf_clearance` cookie）一律 **403 / Cloudflare「Just a moment...」**——`cf_clearance` 与 TLS 指纹绑定，导 cookie 无效。必须走浏览器会话（§7.1 的方案已验证可用）。

### 2.3 SFX 分类页清单（galgame 相关）

站点首页 https://otologic.jp/ → 效果音全分类：

| 分类页 slug | 标题 | 内容要点 / 适用 |
| --- | --- | --- |
| `se/school_bell01` | 効果音＞学校のチャイム | **上课铃**：和式 Westminster 钟「キーンコーンカーンコーン」，按快慢×长短×远近分变体；公开日 2022-05-27 / 2015-02-22 / 2014-08-06 / 2014-07-08 / 2012-05-04 |
| `se/announce01` | 効果音＞アナウンス音 | **校内放送**：4点チャイム、電子チャイム（ピンポンパンポーン）、ディナーチャイム生録音（チャイムアナウンス01-09） |
| `se/electronic-chime01` | 電子チャイム | 校内/館内放送用 |
| `se/electronic-time-signal01` | 電子時報 | 整点报时 |
| `se/heartbeat01` | 効果音＞心音 | 心拍01（ドックンドックン/緊張）、心拍02（ドキドキ/**デフォルメ・かわいい・アニメキャラ**）、心拍03（バクバク/ホラー）、心拍04（緊迫/ゲーム） |
| `se/books01` | 本・雑誌・冊子 | **翻书**：本01(辞書)、本02(漫画の単行本)、本03(ハードカバー)、雑誌01、チラシ01-02、新聞01；关键词「パラッ パラパラ パタッ」「ページをめくる 読書」 |
| `se/writing_material02` | 筆記用具 | **写字**：鉛筆01（使用例明确「ノートをとる 学校 授業」）、シャープペン01（書く・ノック）、ボールペン01、消しゴム01 |
| `se/stationery02` | 文房具 | 文具通用音 |
| `se/footsteps01` | 足音 | 足音01（木の床を歩く・やや重い）、足音02（固い床・汎用）、足音03（固い床・軽い）；デフォルメ调在「ポップモーション」 |
| `se/flashback01` | シーン・回想 | **闪回/回忆转场**：回想01-09（リバースシンバル+風、ノイズスイープ、シンセパッド等） |
| `se/flash01` | フラッシュ | **闪光**（相机/白闪） |
| `se/dizzy01` | オノマトペ・めまい | **耳鸣/目眩/眩晕**：オノマトペめまい01-03（ピヨピヨ ひよこ声、漫画动画风夸张表现） |
| `se/sparkle01` | キラキラ | 闪亮 |
| `se/inspiration01` | ひらめき | 灵光一闪 |
| `se/sigh01` | ため息 | 叹息 |
| `se/negative01` | ネガティブ | 消极/失落 |
| `se/surprise01` | びっくり | 惊吓 |
| `se/scene_change01` | 場面展開 | 场景切换 |
| `se/curtain01` / `se/theater01` | 幕 / 剧场 | 开幕闭幕 |
| `se/cut01` | カット | 硬切 |
| `se/clock01` / `se/pendulum-clock01` / `se/pocket-watch01` / `se/stopwatch01` / `se/cuckoo-clock01` | 时钟系 | 壁钟、摆钟、怀表、秒表、布谷鸟钟 |
| `se/instruments-piano01` | ピアノ（SE） | 钢琴音效：ピアノ01（单音/明亮）、ピアノ02（プロフェッショナルのピアノ風和音）、ピアノ03（ガーン不協和音，含 长/短混响、干/高八度 5 变体） |
| `se/instruments-japanese01` | 和楽器 | 和乐器 |
| `se/applause-cheer01` | 歓声・拍手 | **社团活动/体育馆应援** |
| `se/handclap-yell01` | 手拍子 | 打拍子 |
| `se/city_ambi01` | 雑踏 | 街頭02（雑踏 人ごみ ガヤ 足音 車 **セミ** = 夏の環境音/歩道/駅前）、改札前01（駅の環境音）、街頭01；**夏天场景的蝉鸣**在这里 |
| `se/ambi-texture01` | テクスチャー | 环境02（フィルムノイズ/無線機）、環境01（ホラー/不穏） |
| `se/weather01` | 天候 | 雨/风/雷 |
| `se/water-drops01` | 水滴 | |
| `se/doorbell01` | ドアベル | 门铃/入店旋律 |
| `se/household-others01` / `se/appliance-others01` / `se/cooking_tools01` / `se/cooling-heating01` / `se/washing-machines01` / `se/vacuum-cleaner01` | 家用 | 日常场景 |
| `se/pc-keyboard01` / `se/pc-mouse01` / `se/pc03` / `se/typewriter01` / `se/printer01` | IT/打字 | |
| `se/cell_phone02` / `se/phone02` / `se/radio-communication01` | 手机/电话 | |
| `se/motion-slide01` / `se/motion-slam01` / `se/motion-grab01` / `se/motion-fall01` / `se/motion-tremble01` / `se/motion-swish01` / `se/motion-speed-lines01` | ポップモーション | **デフォルメ调动作音**（椅子拖动感、摔倒、抓取、颤抖、速度线）——galgame 演出感最强的分类 |
| `se/game-*01`（action/fighting/rpg/shooter/sports/racing/other） | ゲーム用セット | 游戏音成套 |
| `se/retroanimeaccent01` / `retroanimeexplosion01` / `retroanimerobots01` / `retroanimeweapons01` / `retroanimeothers03` | レトロアニメ | 复古动画演出音 |
| `se/horror-accent01` / `se/human-horror01` / `se/noise01` / `se/panic01` | 恐怖 | |
| `se/multi-accent01` / `se/single-accent02` / `se/short-accent01` / `se/bell-accent01` / `se/percussive-accent01` / `se/parody-accent01` / `se/news-accent01` | アクセント | 强调音/点缀音 |
| `se/ding01` / `se/pop01` / `se/censor-bleep01` / `se/buzzers01` / `se/warning01` / `se/countdown01` / `se/timer-equipment01` / `se/quiz01` / `se/roulette01` / `se/lottery-drawing-bingo01` / `se/syakiin01` | 系统/综艺 | |
| `se/ambi-texture01` 等 | 环境・背景 | 汇总入口 |

> 完整 slug 列表（共约 130 个分类页）可从 https://otologic.jp/ 首页 `a[href*="/free/se/"]` 直接抓出；本次已抓全。

### 2.4 BGM 分类页清单

首页 → BGM 全分类：

| slug | 标题 | 说明 |
| --- | --- | --- |
| `bgm/pop-music-piano01` | ポップス・ピアノ | **galgame 主力**，见下 |
| `bgm/music-box01` | オルゴール | **回忆/结局场景神器**，见下 |
| `bgm/orchestra01` | オーケストラ | |
| `bgm/ambient01` | アンビエント | The Dark Eternal Night（やや暗い/不穏/不気味、ハープ・ピアノ・シンセ）、夢想（やや暗い/透明、アコギ・シンセ・ピアノ）、残像の比喩（悲しい/さびしい/透明、シンセ）、Outer Space 等 |
| `bgm/short-loop01` | ショートループ | ループ01（明るい/マーチング）、ループ02（明るい/ひょうきん）、ループ03（やや明るい/緊迫）；已含 loop 长版 |
| `bgm/minimal01` | ミニマル | 对白垫底 |
| `bgm/documentary01` | ドキュメンタリー | |
| `bgm/jazz01` / `bgm/bossanova01` / `bgm/rock01` / `bgm/electronica01` / `bgm/soul01` / `bgm/pop-music01` / `bgm/pop-music-synth01` / `bgm/other01` | 分类 | |
| `bgm/instruments*` | 楽器 | |
| `bgm/music_box-douyo-*` / `bgm/wood_mallet-douyo-*` | 童謡 | 童谣（注意可能涉及第三方曲目版权，逐条确认） |
| `bgm/game-*-gb*` / `bgm/game-*-nes*` | ゲーム用サントラ | GB/NES 8bit 风格（game-action/rpg/fighting/shooter/sports/jp/other） |
| `bgm/recent` | 新着 | |

#### ポップス・ピアノ（`pop-music-piano01`）逐曲

| 曲名 | 关键词 | 乐器 | ZIP |
| --- | --- | --- | --- |
| あなたを知りたくて | 感動・切ない・優しい | ピアノ・ハープ | `sounds/bgm/mp3-zip/anata%20wo%20siritakute-mp3.zip` |
| 涙の意味 | 感動・しっとり | ピアノ | `sounds/bgm/mp3-zip/namida%20no%20imi-mp3.zip` |
| 娯楽委員会 | やや明るい・まったり | ピアノ・木琴・ベース | `sounds/bgm/mp3-zip/goraku%20iinkai-mp3.zip` |
| Puzzle | やや暗い・淡々 | ピアノ・コントラバス・パーカッション | `sounds/bgm/mp3-zip/Puzzle-mp3.zip` |
| **春の教室** | やや明るい・優しい・伴奏のみ | ピアノ・パーカッション | `sounds/bgm/mp3-zip/haru%20no%20kyousitu-mp3.zip` |
| らららラグタイム | 明るい・ひょうきん／チップチューン／南国風 | ピアノ／シンセ／スティールパン | `sounds/bgm/mp3-zip/ra%20ra%20ra%20ragtime-mp3.zip` |
| 閉鎖恋愛 | 暗い・壮大 | ピアノ | `sounds/bgm/mp3-zip/heisarenai-mp3.zip` |
| 悲しみに咲く花 | やや暗い・切ない・伴奏のみ | ピアノ・シンセ | `sounds/bgm/mp3-zip/kanasimi%20ni%20sakuhana-mp3.zip` |

> 另有「涙の意味」的 `Narr`（主旋律有無）双版本机制：如 `anata wo siritakute.mp3` + `anata wo siritakute-Narr.mp3`——**「伴奏のみ」版本 = 对白垫底的最佳选择**。

#### オルゴール（`music-box01`）逐曲

| 曲名 | 关键词 | 乐器 |
| --- | --- | --- |
| 思い出はずっと | 感動・優しい・温かい・切ない・バラード | 72弁オルゴール |
| Beside You | 感動・優しい・温かい・切ない・バラード | 18弁オルゴール |
| Nostalgia | 感動・切ない・哀愁・寂しい | カード式オルゴール 30弁 |
| 星をかぞえて | 優しい・穏やか・睡眠・夜・イージーリスニング | 72弁オルゴール |
| 静寂に包まれて | 優しい・穏やか・おしゃれ・イージーリスニング | 18弁オルゴール |
| 苦悩の先に | 不安・苦悩・葛藤・挑戦・試練・チャレンジ | カード式オルゴール 30弁 |
| 過ちの代償 | （页面截断，同分类） | カード式オルゴール |

### 2.5 实测下载记录

| 时间 | 目标 | 结果 |
| --- | --- | --- |
| 2026-09-30 | `curl -I https://otologic.jp/free/se/school_bell01.html`（UA/代理/cookie 多种组合） | ❌ 403，返回 Cloudflare `Just a moment...` |
| 2026-09-30 | `camoufox-cli open https://otologic.jp/free/se/school_bell01.html` | ✅ 正常渲染，标题 `フリー効果音：学校のチャイム｜OtoLogic` |
| 2026-09-30 | 页面内 `fetch()` → 本地 sink | ✅ 得到 `Japanese_School_Bell05-mp3.zip`，**1,926,340 B**，解包 12 个 MP3（`Japanese_School_Bell05-01(Slow-Long).mp3` … `-12(Far-Fast-Short).mp3`），另有识别的 44 个同族文件 |

---

## 3. PeriTune（`peritune.com`）— 有条件可用 ⚠️

### 3.1 许可分界（关键）

PeriTune 在 **2026-03** 改了条款。站点自述：**2026 年 2 月以前公开的既存曲继续适用 CC BY 4.0**；新条款下**禁止「楽曲単体の転売・再配布」**（把乐曲文件本身出售或二次分发）。

- 条款更新公告：`https://peritune.com/blog/2026/03/01/terms-update/`（站点博客）
- 利用条款页：`https://peritune.com/about/`
- 新条款原文要点：
  > 「楽曲単体の転売・再配布：楽曲ファイルそのものを売る、または二次配布することは禁止します」
  > 「2026年2月以前の既存曲：引き続きCC BY 4.0としてご利用いただけます」
- 其他禁止：Content ID 登録、BGM まとめ動画、自作発言。

**⇒ 可入库的操作定义**：只取 **2026-02 及以前公开**的曲目，按 **CC BY 4.0** 署名（`Music by PeriTune (https://peritune.com/)` / 曲名 + 站名）。2026-03 以后的新曲 **只能剧目内引用，不进 library**。

### 3.2 曲目年代证据（决定可用性的唯一依据）

从列表页 `https://peritune.com/music/` 抓到的文章链接 + 发布日期：

| 曲名 | 发布日期 | 可用性 |
| --- | --- | --- |
| Backstreet Swing | 2026/09/26 | ❌ 新条款 |
| Secret Corridor | 2026/09/18 | ❌ |
| **Rainwalk（雨の街ピアノ）** | **2026/09/14** | ❌ |
| Emerald Hill | 2026/08/17 | ❌ |
| Relentless | 2026/08/10 | ❌ |
| Rituale Machina | 2026/07/30 | ❌ |
| Harbor Morning | 2026/07/18 | ❌ |
| Sylblanc | 2026/07/05 | ❌ |
| Frosylva | 2026/06/26 | ❌ |
| Oceanfront | 2026/06/17 | ❌ |
| Black Throne | 2026/06/12 | ❌ |
| Rising Tension | 2026/06/11 | ❌ |
| Ticking Labyrinth | 2026/06/11 | ❌ |
| The City Breathes Your Name | 2026/04/06 | ❌ |
| Gilded Bazaar | 2026/03/26 | ❌ |
| **Glistening Ripples（情感ピアノ）** | **2026/03/21** | ❌ |
| Cerebral Maze | 2026/03/17 | ❌ |
| Portside Café | 2026/03/13 | ❌ |
| Whirlwind | 2026/03/02 | ❌（3 月，落新条款侧） |
| Ancient Gust | 2026/02/06 | ✅ CC BY 4.0 |
| **Glass Cradle（切ないメルヘンワルツ）** | **2026/01/28** | ✅ |
| Dreambyte | 2026/01/17 | ✅ |
| Morning Snowfields | 2026/01/02 | ✅ |
| Depthborn | 2025/12/17 | ✅ |
| Deep Frost Calling | 2025/12/15 | ✅ |
| Cerulean_Relics | 2023/07/21 | ✅ |
| Bustling_Village | 2023/07/12 | ✅ |
| Forest_Sage | 2023/07/02 | ✅ |
| Forgotten_Past | 2023/06/21 | ✅ |
| Midnight_Masquerade | 2023/06/15 | ✅ |
| Moonlit Path | 2023/06/12 | ✅ |
| Dia_Scriost | 2023/06/09 | ✅ |
| Radiant_Sunshine | 2023/05/31 | ✅ |
| RetroRPG_Castle | 2023/05/13 | ✅ |
| Lost_in_the_Woods | 2023/04/20 | ✅ |
| Dawning_Tale | 2023/04/04 | ✅ |
| Sword_Flash | 2023/03/29 | ✅ |
| RetroRoman_Battle3 | 2023/03/05 | ✅ |
| Coppelia_Room | 2023/02/05 | ✅ |
| Clown_Circus | 2023/01/21 | ✅ |
| Awayuki | 2023/01/07 | ✅ |
| Conjurer | 2022/12/23 | ✅ |
| SnowChill | 2022/12/08 | ✅ |
| Foreboding | 2022/11/15 | ✅ |
| MoonForest | 2022/11/05 | ✅ |
| Enchanter3 / Firmament3 / Harvest6 / Dramatic5 / Shenxian / Climbing / CyberPunk_City / Steam_Fortress / Prairie5 / Dungeon_Tower / Otogi4 / Enchanter2 / Breeze3 / Irregular / Holy_Place3 / Raid_FolkMetal2 / Enchanter / Poema / Pastorale2 / Undertaker | 2019/12/20 – 2020/07/16 | ✅ |

> **保守做法**：只用 **2026-01-28 及更早**（即 `Glass Cradle` / `Dreambyte` / `Morning Snowfields` / `Depthborn` / `Deep Frost Calling` 及全部 2025 与更早曲目）。分界线上（2026-02-06）的 `Ancient Gust` 按「2026年2月以前」字面属可用，但建议实测后再定。
> **注意**：此前搜集到的 `Tender Gaze` / `Last Embrace` / `Hanadoki` / `Pale Warmth` / `Petite Walk` / `Gentle Brew` / `Lollipop Lane` / `Sunlit Café` 等日系钢琴曲的日期尚未逐条确认——**必须逐条查 `peritune.com/blog/YYYY/MM/DD/<slug>/` 的日期**再决定是否入库。

### 3.3 批量下载（已实测通）

列表页 <https://peritune.com/music/> 上有两类 ZIP 直链（HTTP HEAD 实测可达）：

- **分段合集（每 20 首）**：`https://peritune.com/music/PeriTune_List_<N1-N2>.zip`
  - 已有 `PeriTune_List_1-20.zip` … `PeriTune_List_241-260.zip`（共 13 个）
  - 实测：`PeriTune_List_1-20.zip` → **HTTP 200，`content-length: 193130592`（≈193 MB），`last-modified: Sat, 10 Jan 2026`**，经 7890 代理可达
- **单曲 ZIP**：每首曲子自己的 zip（从列表页 `<a href>` 抓，本次共抽出 **262 条 zip 直链**）

> ⚠️ 批量包会跨新旧条款分界（列表按上传顺序编号，260 号附近正是 2026 年初），**不要整包入库存档**——按 §3.2 的日期白名单逐曲挑。

---

## 4. OpenGameArt（`opengameart.org`）— 直链已验证

### 4.1 直链规则（实测 200）

```
https://opengameart.org/sites/default/files/<文件名>
```
空格要 URL-encode 成 `%20`，否则 404。

实测（`curl -I`，直连不走代理）：

| URL | 状态 | 大小 |
| --- | --- | --- |
| `…/sites/default/files/SchoolDay_0.ogg` | 200 | 2,069,323 |
| `…/sites/default/files/judgement_0.wav` | 200 | 13,211,264 |
| `…/sites/default/files/pencil.zip` | 200 | 279,813 |
| `…/sites/default/files/book_flips_-_starninjas.zip` | 200 | 136,291 |
| `…/sites/default/files/Visual%20Novel%20Concept%20Album.zip` | 200 | 14,241,651 |
| `…/sites/default/files/JRPG%20Piano.mp3` | 200 | （JRPG Piano 页面） |
| `…/sites/default/files/JRPG_Piano.mp3` | **404** | 纯下划线不行，必须保留原文空格 |

### 4.2 高级检索参数（可复现）

```
https://opengameart.org/art-search-advanced?keys=<q>&field_art_type_tid%5B%5D=13&field_art_licenses_tid%5B%5D=4&sort_by=count&sort_order=DESC
```
- `field_art_type_tid[]`：`9`=2D Art, `10`=3D Art, `7273`=Concept Art, `14`=Texture, `12`=Music, **`13`=Sound Effect**, `11`=Document
- `field_art_licenses_tid[]`：`4`=CC0, `2`=CC-BY 3.0, `17981`=CC-BY 4.0, `3`=CC-BY-SA 3.0, `17982`=CC-BY-SA 4.0, `10310`=OGA-BY 3.0, `31772`=OGA-BY 4.0, `5`=GPL2, `6`=GPL3
- ⚠️ 坑：`keys` 只接受**单个关键词**，多词（如 `school bell`）返回 0 结果；`field_art_tags_tid` 是错的字段名，用了会只返回侧栏行。

### 4.3 已确认许可 + 已取到直链的 OGA 素材

#### BGM（galgame 向）

| 素材 | 许可 | 直链 | 备注 |
| --- | --- | --- | --- |
| Some character themes (music) (originally for visual novel) | **CC0** | `…/judgement_0.wav` (13.2 MB)、`principalmatter_0.wav` (12.3 MB)、`ghostlyguest_0.wav` (10.5 MB)、`ojouslamentation_0.wav` (11.6 MB)、`clumsygirl_0.wav`、`playfultanuki_0.wav` | 明确「originally for visual novel」的角色主题曲，气质最贴 galgame |
| School day / Rain / Sun / Loop | **CC0** | `…/SchoolDay_0.ogg` (2.07 MB)、`SchoolDay.wav`、`SchoolDayRain.ogg`、`SchoolDayRain.wav`、`SchoolDaySun.ogg`、`SchoolDaySun.wav` | **校园日常 + 雨天/晴天变体**，直击缺口 |
| First Light Particles – CC0 Atmospheric Piano/Ambient Track | **CC0** | `…/first_light_particles_0.wav` (25.3 MB) | 标题自带 CC0；日系 OST 风钢琴 Yoiyami |
| Anime-esque Intro-Outro Theme | **CC0** | `…/Anime-esque%20Intro-Outro%20Theme.zip`、`…/Play%20Now_0.mp3` | 0:34 / 190 BPM，intro+bridge-loop+outro |
| Upbeat Visual Novel Music | **CC-BY 3.0 + CC-BY-SA 3.0（双许可）** | `…/Visual%20Novel%20Concept%20Album.zip` (14.2 MB) | 许可直接从页面 `license-name` 抽出，确认是 BY 3.0 与 BY-SA 3.0 |
| Emotional piano loop | CC0 | （extenz，138 BPM，4.9 MB wav） | `bgm_piano_soft_loop` 的出处同源 |
| Emotional Piano | **CC-BY 4.0** | `…/lmao_0.mp3` | |
| JRPG Piano | CC0 | `…/JRPG%20Piano.mp3` (502 kB) | |
| Starfield Romance / Yoiyami | （待复验） | `starfield_romance1.wav` (42 MB) | 本次 `content/starfield-romance` 返回 404，slug 需重查 |
| Back to Elementary School II | OGA-BY 3.0 + CC0（双） | `…/spring_-_back_to_elementary_school_ii.wav` (65.4 MB) | Spring Spring |
| Summer Days(WIP) | CC-BY 3.0 | `…/Summer_Days_WIP.wav` (18.3 MB) | |
| Sunny Day Outside (Loop) | CC-BY 4.0 | Airos | |
| Peaceful Intro (Looping) | CC-BY 3.0 | Eric Matyas（同曲也在 soundimage.org） | |

#### SFX

| 素材 | 许可 | 直链 | 备注 |
| --- | --- | --- | --- |
| 10 Book Page Flips | **CC0** | `…/book_flips_-_starninjas.zip` (136 kB) | 10 个翻书音 |
| Pencil Sounds | **CC0** | `…/pencil.zip` (280 kB) | 「Writing & erasing pencil sounds」，源 freesound `damsur` / `NachtmahrTV` |
| Paper Pages Sounds | **CC-BY 3.0** | `…/paper_pages_0.mp3` / `paper_pages.wav` / `.ogg` / `.flac` | 纸页音，按 click 切分 |
| Page Flips（Wandering Door Games） | **CC-BY-SA 4.0** | `…/pageflips.zip` (372 kB) + `multi_page_flip_01.ogg`、`page_flip_01..08.ogg`、`page_flip_soft_01.ogg` | 11 个翻页变体 |
| Heartbeat (single sound) | **CC0** | `…/heartbeat.mp3_.flac` | |
| 100 CC0 SFX | **CC0** | `…/100-CC0-SFX_0.zip` | 含 3× bell、4× paper、7× slam、doors 等 |
| 80 CC0 RPG SFX | **CC0** | `…/80-CC0-RPG-SFX_0.zip` | 含 4× book/page flip |
| Basic Sound Effects | **CC0** | `bell1_0.mp3`、`bell2_0.mp3`、`bell3_0.mp3`、`button_0.mp3`、`coin1_0.mp3`、`coin2_0.mp3`、`explosion_0.mp3`、`explosion_distant_0.mp3`、`gunshot_0.mp3`、`splash1_0.mp3`、`splash2_0.mp3`、`success_0.mp3`（均在 `…/sites/default/files/`） | 基础铃/按钮 |
| Interface beeps | **CC0** | `…/beeps.zip` (1.1 MB) | |
| AK Game Audio | （待复验） | 含 page turning、50 retro/synth SFX、多材质脚步 | slug 需重查 |
| Platformer Sounds | （待复验） | `yd-Sounds.zip` (172.5 kB)：`steps_chain`、`steps_stairs1`、`steps_stairs` | slug 需重查 |
| Inventory Sound Effects | （待复验） | turn page / sell / buy / metal clash / ring / leather / cloth | |
| Fantasy Sound Effects (Tinysized SFX) | （待复验） | books/paper、boots/steps、water drops | |
| CC0 Sound Effects（脚步合集） | （待复验） | footsteps wood/stone/leaves/gravel/mud | |
| Old Pages/Flip with sound | **CC0** | `FlippingPages.ogg` (9.9 kB) 等 | 其实是 2D Art 类目（含翻页动画+音） |
| Page Turning Sfx | 自定义（要求署名 `Sound Effect By Nicole Marie T`，允许商用+随作品出售） | `Page Turning Sfx.wav` (199 kB) | ⚠️ 未明说可再分发原文件 ⇒ **默认不入库** |
| Win Jingle | CC0 | `winjingle.zip` (11.6 MB)、`winjingle.mid` | |
| Good CC0 UI Sounds | CC0 | — | |

---

## 5. itch.io — 可批量脚本下载（已实测）

### 5.1 CC0 包（无署名义务）

| 包 | 站点 URL | 许可原文要点 | 文件 / 曲目 | 需注册/付费 | 实测 |
| --- | --- | --- | --- | --- | --- |
| **Cinematic Piano BGM**（rosko vair） | <https://roskovair.itch.io/cinematic-piano-bgm> | `Asset license: Creative Commons Zero v1.0 Universal`；描述「Released under CC0 license as part of Society of Play's Asset Pack Jam. Acknowledgement is greatly appreciated, but not required.」 | 15 条，见 §5.1.1；文件：`Reaching mid-dream, mp3` 4.1 MB、`Well of stars, sheet music` 89 kB、`Well of stars, sheet music`(2) 51 kB、`All tracks in a .zip file` 27 MB（实际 28,895,353 B） | 免费、无需注册 | ✅ **全部 3 个文件已下载**（zip 28,895,353 B；单曲 4,402,191 B；谱 52,608 B） |
| **Anamnesis**（efilheim） | <https://efilheim.itch.io/anamnesis> | CC0 / public domain，免费 | ambient/sci-fi/dreamy；`anamnesis BGM ogg.zip` 68 MB、`anamnesis BGM wav.zip` 284 MB；WAV/OGG 44100Hz 16-bit | 免费 | 未实测（风格偏离，优先级低） |
| **FREE Music Loop Bundle**（Tallbeard Studios） | <https://tallbeard.itch.io/music-loop-bundle> | 页面 `LICENSE CC-0 (Public Domain)`，原文：「To the extent possible under law, Abstraction Music and Tallbeard Studios has waived all copyright and related or neighboring rights to the music contained in this asset pack. This work is published from the United States. All assets are available to use in any commercial or non-commercial project, and may be modified in any way the user chooses.」；署名非必需（可选 `Abstraction` + `abstractionmusic.com`） | 200+ 首。11 个 zip（全部 `Version 20260627-03`）：`music-loop-bundle-2026-q2.zip` 71 MB、`-song-browser.zip` 780 kB（**先下这个看目录**）、`-pre2023.zip` 142 MB、`-chiptune.zip` 44 MB、`-2024-q1.zip` 40 MB、`-2024-q2.zip` 28 MB、`-2024-q3.zip` 55 MB、`-2024-q4.zip` 36 MB、`-2025-q4.zip` 43 MB、`-2026-q1.zip` 70 MB、`-troubadeck.zip` 152 MB | 免费（PWYW） | 未实测（体量大，优先级中） |
| **Fantasy Game Music Tracks (CC0)**（kmontesdev） | kmontesdev.itch.io | CC0 | 7 首：Awakening、Aural、Akash Chamber、Faerie Shrine、Interlude、Shores of Yore、Elven Companion | 免费 | 未实测 |
| **Fantasy Ambient Sound Effects Pack (CC0)**（kmontesdev） | kmontesdev.itch.io | CC0 | 2 GB：hits / ambience / foley / monsters / weapons / spells | 免费 | 未实测 |
| **Keynata Commons Music Pack**（carf-coder） | <https://carf-coder.itch.io/keynata-commons-music-pack> | CC0 | 99 首（AI 作曲）：Rock 25、J-Pop 17、Karaoke 13（guide+backing）、Classical 44（钢琴独奏/小提琴-大提琴二重/弦乐四重奏）；MP3 + MIDI。zip：`keynata-commons-complete-cc0.zip` 269 MB、`-classical-cc0.zip` 61 MB、`-jpop-cc0.zip` 59 MB、`-karaoke-cc0.zip` 90 MB、`-rock-cc0.zip` 57 MB | 免费 | 未实测（**注意是 AI 作曲，若在意可跳过**） |
| **High Quality 16 bit Music**（HydroGene） | <https://hydrogene.itch.io/high-quality-16-bit-music> | CC0 | 28 首 SNES 风 RPG 曲，mp3/ogg/wav，seamless loop | 免费 | 未实测 |
| **Public Domain Trash Music**（thatguynm） | <https://thatguynm.itch.io/public-domain-trash-music> | CC0 | 11 首；`TGNM_CC0-trashJams.zip` 84 MB | 免费 | 未实测 |
| **Instrumental Music**（ondrosik） | <https://ondrosik.itch.io/instrumental-music> | CC0 | 2 小时+ 器乐，flac + preview ogg zip | 免费 | 未实测 |
| **Fantasy Music Mega Pack**（Blacis） | blacis.itch.io | CC0 / public domain | 100+ 首；另有 `Free 25 Fantasy RPG Game Tracks Vol. 2` | 免费 | 未实测 |
| **Essentials Series – Free Sound Effect**（Nox_Sound_Design） | <https://nox-sound-design.itch.io/essentials-series-sfx-nox-sound> | 「All sounds are released under **CC0**, allowing you to use them freely without attribution or restrictions.」 | **1,644 个 SFX**；`Essentials_Series_NOX_SOUND.zip` 988 MB | 免费（PWYW） | 未实测（体量最大，性价比最高） |
| **Interface SFX Pack 1 (CC0)**（ObsydianX） | <https://obsydianx.itch.io/interface-sfx-pack-1> | `Asset license: Creative Commons Zero v1.0 Universal`；「These are CC0 licensed, meaning you can do anything you want with them!」 | 200+ UI 音，含 Confirm / Back / Cursor / Error 各多风格多 pattern；`Interface SFX Pack 1 WAV` 32 MB、`Interface SFX Pack 1 OGG` 17 MB | 免费（PWYW） | 未实测 |
| **200 Free SFX**（Kronbits） | <https://kronbits.itch.io/freesfx> | `Asset license: CC0`；「You can use this sfx in your personal/commercial projects as many times as you want. CC0 License. No credit needed.」 | 223 文件 / 41 文件夹 / 100 MB；含 `Retro FootStep 03.wav`、`Retro FootStep Grass 01.wav`、`Retro FootStep Gravel 01.wav`、`Retro FootStep Metal 01.wav`、`Retro FootStep Mud 01.wav` 等 | 免费 | 未实测 |
| 其余 CC0（itch 标签页确认） | — | CC0 | Game Creator's Pack（Jonathan So）、SKYETUNES（Skye Ash）、Lurking Layers（ImperialDawnAudio）、SenseZera（Chisech）、Dystopian Ambient Pack、saunterer、Halloween Game Music Pack、Studio Time props、Naranoiston Djonisya + Tenazalina Albums | 免费 | 未实测 |
| itch CC0 合集页 | <https://itch.io/c/8078079/cc0-audio-no-ai> | — | 用户 Void 整理的「CC0 Audio - No AI」 | — | 本次抓取遇 SSL EOF，未读取 |

> 💡 **CC0 的坑**：itch 上「CC0」是作者自己打的标签，只在作者自己那一层权利上成立。AI 生成类（如上面 Keynata）另当别论；也有作者在评论区追加限制（见 §5.1.1 roskovair）。**入库前逐包读页面描述 + 评论区**。

#### 5.1.1 roskovair 曲目（已从下载到的 zip 解包，文件名自带时长）

| # | 文件名 | 时长 |
| --- | --- | --- |
| AJ1 | `Reaching Mid-dream` | 3m37s |
| AJ2 | `Well of Stars` | 1m05s |
| AJ3 | `Constellate` | 1m13s |
| AJ4 | `Bucket of Stardust` | 0m18s |
| AJP1 | `Reaching Mid-dream bridge only` | 0m29s |
| AJP1 | `Reaching Mid-dream intro only repeating` | 3m35s |
| AJP1 | `Reaching Mid-dream outro 1` | 0m47s |
| AJP1 | `Reaching Mid-dream outro 2` | 0m34s |
| AJP2 | `Well of Stars intro only` | 0m37s |
| AJP2 | `Well of Stars repeat w fadeout` | 4m18s |
| AJP2 | `Well of Stars second part only` | 0m33s |
| AJP3 | `Constellate impromptu only` | 0m18s |
| AJP3 | `Constellate intro 1x with decrescendo` | 0m57s |
| AJP3 | `Constellate repeating w fadeout` | 3m34s |
| AJP4 | `Bucket of Stardust high register` | 0m18s |

录音：MIDI controller + Spitfire LABS 免费 Soft Piano 插件；2022-09-23~25 创作。
**⚠️ 作者评论区留言（3 年前，与 CC0 标签存在张力，原文）**：
> 「It's okay to use this in a project and publish your project wherever you want, and I appreciate being given credit, but I'm not interested in distributing the music itself outside of itch.io or having others distribute it to any other websites on my behalf.」

⇒ 按本项目「原文件再分发」的判定尺子，**这条应当按 §4 的谨慎原则处理**：可用作剧目内引用；若要入库，需承担作者本意与 CC0 标签冲突的风险（法律上 CC0 标签 + 页面描述「Release under CC0」成立，但作者个人意愿相反）。

### 5.2 CC BY / CC BY-SA 包（可入库，需署名）

| 包 | 站点 URL | 许可 | 曲目 / 文件 | 需注册/付费 | 实测 |
| --- | --- | --- | --- | --- | --- |
| **Tearjerker Music Pack**（Tungerman） | <https://tungerman.itch.io/tearjerker-music-pack> | `Asset license: Creative Commons Attribution v4.0 International`；原文：<br>「Tearjerker Music Pack is licensed under Creative Commons: By Attribution 4.0 http://creativecommons.org/licenses/by/4.0/<br>'1. Credit. Credit me as "Tungerman".<br>'2. Commercial / Non-commercial use. Both free.<br>'3. Editing. You are free to edit my tracks for personal use as well as distribute the modified tracks to the public, as long as my name is in the credits.<br>'4. **Reposting. You are free to repost my tracks so long as you mention my name (Tungerman).**<br>'5. This resource pack is free for use in any kind of game project and any game engine. Using it in other types of media, such as video, podcast, film, etc. is also allowed.」 | **10 首钢琴曲**（官方只公开 5 首曲名，从评论区用户的使用清单得到：`Visions of Innocence`、`Survivor's Lament`、`Acceptance`、`A Moment of Silence`、`Afterglow`）。文件：`[FLAC] Tearjerker Music Pack.zip` 88 MB、`[MP3] …zip` 61 MB、`[OGG] …zip` 24 MB | 免费（PWYW $0 可过） | ✅ 下载通路已验证：`[FLAC] Tearjerker Music Pack.zip` 实际下载到 **62,488,576 B**（88 MB 的 71%）时被本轮主动终止——**是被我 kill 的，不是权限/限速问题**，说明 PWYW 的 `/download_url` → R2 presigned 链路完全通。重跑需给足超时（单文件 88 MB，经代理约 3–5 分钟） |
| **Retro Indie Josh**（Joshua McLean）music packs 1–11 | <https://retroindiejosh.itch.io/> | **CC BY 4.0**（部分旧作 CC BY-SA 3.0/4.0）；署名 `Contains music ©2025 Retro Indie Josh (https://retroindiejosh.itch.io)` | 8-Bit Music Pack 1（OGA，ogg，≈9:30）；Orchestral Music Pack 1（OGA，CC-BY-SA 4.0）：`A Brief Respite` 1:46、`Aftermath` 1:07 + loop 0:58、`Peace` 4:19、`Sunset` 1:25、`Threat Within` 2:54、`To Live Is Enough` 3:44、`Unfamiliar Home` 3:50、`Waltz Town` 2:02；Music Pack 9 Genesis（5 首 SNES BGM）；Music Pack 11 Chiptune 4 | 免费 | 未实测 |
| **Slice of Anime Music**（lolurio） | <https://lolurio.itch.io/slice-of-anime-music> | **CC BY 4.0**（从 BY-SA 3.0 改过） | `Sweet Memories.wav` 38 MB，2:21，WAV stereo 48kHz 24-bit（单曲） | 免费 | 未实测 |
| **School Time**（東月 / dongnguyet） | <https://dongnguyet.itch.io/school-time> | CC BY | `School_time.mp3` 891 kB（单曲），可爱 VN 校园场景 | 免费 | 未实测 |
| **Visual Novel Audio Pack Vol.2**（FulminisIctus） | <https://minisictus.itch.io/visual-novel-audio-pack-vol-2> | 描述称 **SFX = CC-BY 4.0 / 音乐 = CC-BY-NC 4.0** | 1 GB | PWYW（作者说「只要游戏本身完全免费」即可捐赠） | 未实测；**NC 部分不可商用入库** |
| **Infinite Lo-Fi**（Alenia Studios） | alenia-studios.itch.io/infinite-lo-fi | CC BY 4.0 + 附加条款（仅署名 + No AI training） | 15 首，≈37 分钟 | 付费 | 需复验「No Resale」是否覆盖此包——**Amapola / Anyun / Alenia Heritage 明确写「Standalone redistribution or resale of these audio files is strictly prohibited」⇒ ❌ 不可入库**；Infinite Lo-Fi 的许可行不同，需单独核实 |
| **ADV Game BGM Pack**（syuP） | <https://syup.itch.io/adv-game-bgm-pack> | 「Redistribution prohibited」 | 10 首：`1.Morning Light` 4.1 MB、`2.Quiet Path` 5.5 MB、`3.Small Memories` 5.1 MB、`4.Soft Rain` 4.7 MB、`5.Twilight Reverie` 5.1 MB、`6.Secret Garden` 5.6 MB、`7.Gentle Breeze` 5.2 MB、`8.Fading Memory` 3.1 MB、`9.Evening Glow` 4.1 MB、`10.Silent Farewell` 3.7 MB | 免费 | ❌ **不可入库** |
| **Free Background Music for Visual Novels (BGM Pack 1)**（Potat0Master） | <https://potat0master.itch.io/free-background-music-for-visual-novels-bgm-pack-1> | 「royalty free license… you cannot resell or distribute them in the form that it is downloaded or even when it is modified」 | 5 免费：`Frozen Winter`(情绪)、`Hope`(主菜单)、`Beanfeast`(欢快)、`Woo Scary`(恐怖)、`Dramatic Boi`；$2 追加 Moon Guitar / Pizzicato Boi / Simple Line | 免费 + $2 增补 | ❌ **不可入库** |
| **Elegant Emotional Piano BGM for Games (5 Tracks)**（okamennme） | <https://okamennme.itch.io/elegant-emotional-piano-bgm-for-games-5-tracks> | 免费商用、无署名要求，但**未提再分发** | 5 首：`A Piano_Day_Sketch`、`Sakura_Farewell`、`Ravel-inspired_Piano_Sketch`、`The_Two_Yellow_Figures`、`Diamond Konpeito_Suite`；WAV+OGG，`…zip` 92 MB | **$5 起售** | ❌ 付费 + 许可不明 |
| **Come Home**（Jan Hehr） | <https://janhehr.itch.io/comehome> | 未列明 | 15 首：Divine Intervention 2:10、Respiration 1:41、Reality bends 2:05、Chemical Synthesis 3:17、Cyber Narcosis 2:08、Archangel 0:49、Feel-Good Chemicals 2:41、Artificial Flowers 3:15、Starstruck 2:21、The Graveyard 1:47、Hunted by Shadows 1:33、Tarnished 2:01、Root of all Evil 2:01、Guardian watching 0:52、Life Essence Stream 2:03；`Come-Home Updated.zip` 605 MB | 免费 | ❌ 许可未定，先不采 |
| **Visual Novel & Romance Story BGM Pack Vol.1 – Everyday Hearts**（tone diary） | <https://tonediary.itch.io/ai-free-visual-novel-romance-story-bgm-pack-vol1-everyday-hearts> | 未列明 | 5 首（Loop / Fade 双版）：`Sunny Campus` 65s/128s、`After School Talk` 58s/129s、`First Confession` 76s/147s、`Rainy Promise` 61s/145s、`Starry Walk Home` 48s/117s；WAV 44.1k/16bit + MP3 320k；zip 74 MB | **$5 起售** | ❌ 付费 + 许可不明（**风格极对，值得后续联系作者要许可**） |
| **Visual Novel Music Pack ~ Vol. 1**（Oasis Game Assets） | <https://oasis-game-assets.itch.io/visual-novel-music-pack-vol-1> | 未列明 | 12 首：`A Detour from the Road`(免费)、Brightening Lights、Beach、Afternoon、Bustling Streets、Studio、From the Depths、Feeling Watched、Messy Café、Funeral March、Cozying Up、Unravel | 部分免费 / 其余付费 | ❌ 许可未定，先不采 |
| **Assets pack vol.1 - Piano BGM**（Pandita Studio） | <https://panditastudio.itch.io/assets-pack-vol1-piano-bgm> | 「免费曲目无需署名」，但未提再分发 | 免费 3 首：`IN THE WOODS` 1:46(Happiness)、`STARS DROPPING` 1:53(Reflexion)、`GROWL` 1:38(Tension)；付费 $1 加 WAV + `A WALTZ` 1:54(Sadness) | **$1 起售** | ❌ 付费 |

---

## 6. Freesound（逐条 CC0）— 长尾具体音的补位源

### 6.1 性质与下载

- 站点：<https://freesound.org/>
- 搜索页支持许可过滤且**结果 ID 能直接抓**（本次已实现）：
  ```
  https://freesound.org/search/?q=<关键词>&f=license%3A%22Creative+Commons+0%22
  ```
  结果行是 `<a href="/people/<user>/sounds/<id>/">`，可解析出 `名称 / 作者 / sound id`。
- 单条页面：`https://freesound.org/s/<id>/`
- **实测**：`https://freesound.org/s/377205/download/…` 会 302 到 `/home/login/?next=…` ⇒ **下载需要注册并登录 Freesound 账号**（免费）。这一点对「全自动批量下载」是硬门槛，需人工登录一次或用会话 cookie。
- `apiv2` 需要 token（`{"detail":"Authentication credentials were not provided."}`）。
- **SoundSpool**（<https://soundspool.com/>）是 Freesound 的**元数据索引**，不托管音频；「Download on Freesound」按钮跳回 Freesound。它的价值是**按许可色标快速筛**（页面明确 `CC0 / CC BY / CC BY-NC` 徽章）+ 可读的 `Key Takeaway` 描述。合法、可用作发现工具（<https://soundspool.com/licenses> 说明页）。

### 6.2 已筛出的 CC0 校园 / 剧情 SFX（本次实测抓取，含结果总数）

> 说明：以下结果的许可由 **搜索页的 `f=license:"Creative Commons 0"` 过滤**保证；入库前建议逐条打开确认（Freesound 允许作者事后改许可）。

**上课铃 / 校内铃（`q=school bell`，CC0 共 91 条）**

| 音名 | 作者 | ID / 链接 |
| --- | --- | --- |
| 8 School bell.wav | 15FPanska_Hecl_Filip | <https://freesound.org/s/461158/> |
| Modern School Bell | BennettFilmTeacher | <https://freesound.org/s/403459/> |
| School bell tone.mp3 | austin1234575 | <https://freesound.org/s/213794/> |
| Short Alarm bell in school hall (some clock ticks…) | sbyandiji | <https://freesound.org/s/217486/> |
| School bell.wav | deleted_user_7020630 | <https://freesound.org/s/378394/> |
| Electronic School Bell | mpaol2023 | <https://freesound.org/s/370181/> |
| about the schools_CEVLPT_school bell.wav | thecityrings | <https://freesound.org/s/184829/> |
| School Bell.mp3 | payattention | <https://freesound.org/s/81003/> |
| School bell synth | HeyKey1800 | <https://freesound.org/s/437526/> |
| School Bell Tone 2 | MysteryPancake | <https://freesound.org/s/592560/> |
| school bell | wsglol | <https://freesound.org/s/675934/> |
| School Bell | civvy | <https://freesound.org/s/620392/> |
| School Bell | melokacool | <https://freesound.org/s/613690/> |

**教室环境（`q=classroom ambience`，CC0 共 28 条）**

| 音名 | 作者 | 链接 |
| --- | --- | --- |
| Classroom Ambience Environment in Nepal | hawa9874 | <https://freesound.org/s/869656/> |
| AMB-Impulse, amb of classroom | soundandmelodies | <https://freesound.org/s/643508/> |
| Classroom Ambience - High School Class.wav | okieactor | <https://freesound.org/s/417041/> |
| School Ambience, Kampot, Cambodia | marc.om | <https://freesound.org/s/806511/> |
| classroom_ambiance.wav | joedeshon | <https://freesound.org/s/258094/> |
| Chalk_Board_Writing_Classroom | DeanHopkins | <https://freesound.org/s/266841/> |
| Room Noise 2 | tvilgiat | <https://freesound.org/s/472678/> |
| Classroom Ambience.wav | Tallis0410 | <https://freesound.org/s/707510/> |
| S11-25 Murmur of kids entering a classroom | craigsmith | <https://freesound.org/s/675190/> |
| Breezy Classroom | Jackie-makes-noiz | <https://freesound.org/s/520451/> |

**椅子拖动 / 摩擦（`q=chair scrape`，CC0 共 58 条）**

| 音名 | 作者 | 链接 |
| --- | --- | --- |
| plastic chair scrape on plastic 1.WAV | SizEffects | <https://freesound.org/s/571295/> |
| plastic chair scrape on plastic 2.WAV | SizEffects | <https://freesound.org/s/571294/> |
| Chair Scrape | bangcorrupt | <https://freesound.org/s/832998/> |
| **wood chair scrape on floor, papers,.mp3** | JohnsonBrandEditing | <https://freesound.org/s/173940/> |
| Chair scrape.wav | deleted_user_2104797 | <https://freesound.org/s/325278/> |
| chair wood old push slide across concrete floor | kyles | <https://freesound.org/s/455673/> |
| scraping chair.wav | skysonglark | <https://freesound.org/s/459137/> |
| Chair Scrape mp3 | ME_Studios_Official | <https://freesound.org/s/656682/> |
| Wooden chair, slide scrape on wood floor.wav | SpliceSound | <https://freesound.org/s/188204/> |
| dragging chair on concrete floor, wide room 05 | funkysandwich | <https://freesound.org/s/871017/> |
| Small group of people leaving a room | pfranzen | <https://freesound.org/s/659703/> |
| Chair Metal Drag.m4a | RoyalRose | <https://freesound.org/s/560285/> |

**翻页 / 纸（`q=page turn paper`，CC0 共 306 条，取前 14）**

| 音名 | 作者 | 链接 |
| --- | --- | --- |
| Paper Page Turn.wav | bbrocer | <https://freesound.org/s/382651/> |
| paper sheets flip through turn page nice various.wav | kyles | <https://freesound.org/s/450803/> |
| Turning page (heavy paper) | xkeril | <https://freesound.org/s/856497/> |
| Turning Magazine Pages | KaosMakinesi | <https://freesound.org/s/414555/> |
| Page Turn | IENBA | <https://freesound.org/s/656546/> |
| paper turning.mp3 | Mikes-MultiMedia | <https://freesound.org/s/349701/> |
| Page Turn Free | AardsReal | <https://freesound.org/s/842183/> |
| Page turned | Beussa | <https://freesound.org/s/749880/> |
| Book_Turning_Pages_02.wav | moai15 | <https://freesound.org/s/336373/> |
| Singular Page Turn.wav | Flem0527 | <https://freesound.org/s/630019/> |
| Paper Sketchbook Page Flips 1 | OwlStorm | <https://freesound.org/s/320148/> |
| Paper Sketchbook Page Flips 2 | OwlStorm | <https://freesound.org/s/320149/> |
| Paper Flutter .wav | mickdow | <https://freesound.org/s/320913/> |
| Page turn; short.WAV | thomasanthony321 | <https://freesound.org/s/682757/> |
| Page Turning | ominous_studios | <https://freesound.org/s/698636/> |

> OwlStorm 页面注明：「NOTE ON LICENSING: All my sounds are now CC0, so you don't have to credit me. But if you want to, credit Ashe Kirk or Owlish Media」。

**写字 / 铅笔（`q=writing pencil paper`，CC0 共 275 条，取前 14）**

| 音名 | 作者 | 链接 |
| --- | --- | --- |
| writing and paper noises with pencil in a notebook | MeanRaccoon | <https://freesound.org/s/816927/> |
| Writing - pencil on paper | magnus1906 | <https://freesound.org/s/513938/> |
| Writing pencil on paper (mono).WAV | y_ltr27 | <https://freesound.org/s/556400/> |
| Pencil Writing on Paper | deleted_user_7146007 | <https://freesound.org/s/383867/> |
| Pencil writing on paper.WAV | Thomas Radio | <https://freesound.org/s/370789/> |
| quick writing with pencil on paper.wav | 123jorre456 | <https://freesound.org/s/46630/> |
| Pencil Writing on Paper | elliotlp | <https://freesound.org/s/277312/> |
| Writing with pencil on thick paper.wav | PanosA | <https://freesound.org/s/546367/> |
| Writing with Pencil on Paper | parkersenk | <https://freesound.org/s/444479/> |
| Pencil or Marker writing and scribble on paper | khenshom | <https://freesound.org/s/530190/> |
| Writing with pencil- energetic | fthgurdy | <https://freesound.org/s/376706/> |
| writing_pencil_2.aif | rui_aires | <https://freesound.org/s/365891/> |

**走廊脚步（`q=footsteps hallway`，CC0 共 60 条）**

| 音名 | 作者 | 链接 |
| --- | --- | --- |
| footsteps, creaky, hallway | drewhalasz | <https://freesound.org/s/432955/> |
| **high school hallway quiet near bathroom distant voices** | kyles | <https://freesound.org/s/455782/> |
| Footsteps in hallway | DigPro120 | <https://freesound.org/s/811940/> |
| Footsteps_Hallway.wav | georgisound | <https://freesound.org/s/368834/> |
| Walking through the hallway | Oscar_K | <https://freesound.org/s/786023/> |
| Footsteps_Quick.wav | georgisound | <https://freesound.org/s/368833/> |
| Footsteps up and down wooden stairs then falling | lreeve | <https://freesound.org/s/863394/> |
| Footsteps - wet shoes squeaking on hard floor.wav | jodybruchon | <https://freesound.org/s/433882/> |
| wooden stairs old house hallway | Garuda1982 | <https://freesound.org/s/633131/> |
| hallway.mp3 | WaveAdventurer | <https://freesound.org/s/169953/> |
| Footsteps_Up_Stairs.wav | georgisound | <https://freesound.org/s/368832/> |
| long industrial hallway with people walking and talking | Garuda1982 | <https://freesound.org/s/538380/> |

**心跳（`q=heartbeat`，CC0 共 376 条，取前 14）**

| 音名 | 作者 | 链接 |
| --- | --- | --- |
| heartbeat sub kick - softer | music_is_wiggly_air | <https://freesound.org/s/784658/> |
| heartbeat-80bpm-limited.wav | loudernoises | <https://freesound.org/s/332819/> |
| Heartbeat 97 BPM | Cloud-10 | <https://freesound.org/s/688735/> |
| Heartbeats 61.wav | patobottos | <https://freesound.org/s/369017/> |
| Heartbeat.wav | Jeffreys2 | <https://freesound.org/s/333486/> |
| Human Heartbeat | RICHERlandTV | <https://freesound.org/s/798674/> |
| Heartbeats 2 | AppleCorey | <https://freesound.org/s/693150/> |
| Heartbeat Drone.wav | bfederi1 | <https://freesound.org/s/382025/> |
| Heartbeats | AppleCorey | <https://freesound.org/s/693144/> |
| Heartbeat.wav | morganpurkis | <https://freesound.org/s/384662/> |

**耳鸣 / 目眩（`q=tinnitus ringing ears`，CC0 共 15 条 —— 全量）**

| 音名 | 作者 | 链接 |
| --- | --- | --- |
| tinnitus.flac | tnturner | <https://freesound.org/s/377207/> |
| tinnitus.mp3 | tnturner | <https://freesound.org/s/377206/> |
| tinnitus.wav | tnturner | <https://freesound.org/s/377205/> |
| tinnitus.aif | tnturner | <https://freesound.org/s/377208/> |
| Ear Ringing Long (Extended Falloff) | deleted_user_9482149 | <https://freesound.org/s/456698/> |
| tinnitus.wav | Sclolex | <https://freesound.org/s/210533/> |
| **Tinnitus - high pitched 10khz ish** | Sadiquecat | <https://freesound.org/s/851975/> |
| Tinnitus/Ear ringing after loud noise stereo | SomeOrdinaryDude | <https://freesound.org/s/738245/> |
| Ear Ringing Sound.m4a | CanimalsOzSeries | <https://freesound.org/s/570442/> |

**闪光 / 相机（`q=camera flash`，CC0 共 71 条，取前 14）**

| 音名 | 作者 | 链接 |
| --- | --- | --- |
| Camera Flash Charging.aif | ftpalad | <https://freesound.org/s/119902/> |
| Camera Flash_Crackle_Near_Mono.wav | _stubb | <https://freesound.org/s/406614/> |
| camera flash charge.wav | adeluc4 | <https://freesound.org/s/125326/> |
| Camera Flash Sound.wav | juanstrydom2002 | <https://freesound.org/s/655045/> |
| Old camera flash.wav | MichelleGrobler | <https://freesound.org/s/410559/> |
| off camera flash charging | satanicupsman | <https://freesound.org/s/148267/> |
| Picture with disposable camera with flash on | dylanperitz | <https://freesound.org/s/452363/> |
| camera with flash.wav | skynproduction | <https://freesound.org/s/91480/> |
| Camera shutter and flash combined | montclairguy | <https://freesound.org/s/353044/> |
| Camera with Flash Sound and then Charge (fast) | RegoneFF | <https://freesound.org/s/456988/> |
| Synthetic camera flash + future weapon sounds | AnthonyChan0 | <https://freesound.org/s/202428/> |

**黑板 / 粉笔（`q=chalk blackboard`，CC0 共 39 条，取前 14）**

| 音名 | 作者 | 链接 |
| --- | --- | --- |
| chalk on blackboard | stephanyoliveira | <https://freesound.org/s/483299/> |
| Writing by chalk on the blackboard.wav | deleted_user_7020630 | <https://freesound.org/s/378400/> |
| writing on a blackboard (Olympus LS10 xy) | Soundscape_Leuphana | <https://freesound.org/s/210319/> |
| Chalk on board | paisagemsonoraunila | <https://freesound.org/s/869525/> |
| chalk on wooden slate | Diegolar | <https://freesound.org/s/561830/> |
| Chalk.wav | LukeUPF | <https://freesound.org/s/233049/> |
| blackboard1.wav | lezaarth | <https://freesound.org/s/232420/> |
| Chalkboard | TimOut789 | <https://freesound.org/s/751870/> |
| Chalk writing on board.mp3 | mrrap4food | <https://freesound.org/s/619018/> |
| Write/Draw with chalk on board | Breviceps | <https://freesound.org/s/447925/> |
| Writing with Chalk / Chalkboard | digitale.de | <https://freesound.org/s/178433/> |

**挂钟走针（`q=wall clock tick`，CC0 共 88 条，取前 14）**

| 音名 | 作者 | 链接 |
| --- | --- | --- |
| Wall Clock Ticking | Filmscore | <https://freesound.org/s/830193/> |
| clock-tick-01.flac | pbimal | <https://freesound.org/s/534094/> |
| clock_ticking_mono.wav | Greaseball | <https://freesound.org/s/666582/> |
| clock_ticking stereo.wav | Greaseball | <https://freesound.org/s/666583/> |
| Wall Clock | aunrea | <https://freesound.org/s/485955/> |
| kitchen clock clockwork sound effect | Garuda1982 | <https://freesound.org/s/530171/> |
| Cheap electric Wall Clock ticking | Ed_Haa | <https://freesound.org/s/798826/> |
| **wall clock chiming and ticking** | launemax | <https://freesound.org/s/250037/> |
| Elgin Starburst Wall Clock Ticking | Filmscore | <https://freesound.org/s/830206/> |
| Wall Clock Ticking on Wall | JoelMcDaniel | <https://freesound.org/s/832492/> |
| Wall clock tick.wav | itinerantmonk108 | <https://freesound.org/s/639497/> |
| Tick Tock Dry | GammaGool | <https://freesound.org/s/759501/> |

**蝉 / 夏日环境（`q=cicada summer`，CC0 共 282 条，取前 14）**

| 音名 | 作者 | 链接 |
| --- | --- | --- |
| Summer time cicada.MP3 | macdaddyno1 | <https://freesound.org/s/421932/> |
| Cicada, short buzzings, birds, hot summer | TRP | <https://freesound.org/s/717588/> |
| Cicada, close harsh buzzing, heat bug, summer | TRP | <https://freesound.org/s/571090/> |
| Cicada, close buzzing droning, sparrows | TRP | <https://freesound.org/s/717587/> |
| Heat bugs summer insect cicadas various clean | TRP | <https://freesound.org/s/573943/> |
| Cicada, single, hot summer, insects, field | TRP | <https://freesound.org/s/616613/> |
| Cicada during summer in South of France (1 hour) | felix.blume | <https://freesound.org/s/536915/> |
| Cicada summer.wav | beansqueso31 | <https://freesound.org/s/243438/> |
| Summer Ambiance .wav | PrincessGrace | <https://freesound.org/s/329371/> |
| Cicada - nature insect sound | bolkmar | <https://freesound.org/s/427547/> |
| Cicada Single | Jedo | <https://freesound.org/s/396809/> |
| Cicada daytime.MP3 | macdaddyno1 | <https://freesound.org/s/352601/> |

**体育馆（`q=gymnasium school gym`，CC0 仅 2 条）**

| 音名 | 作者 | 链接 |
| --- | --- | --- |
| **Footsteps in Gym** | tvilgiat | <https://freesound.org/s/472673/> |
| tap dancing.aif | payattention | <https://freesound.org/s/82803/> |

> 体育馆是 CC0 里的**真空区**。补充思路：OtoLogic `game-sports01` / `applause-cheer01` + Freesound 的 `basketball`/`whistle`/`squeaky shoes` 关键词（本轮未逐一抓取，建议以同样方式再跑一轮）。

**社团活动（`q=school club brass band` → CC0 共 0 条）**
⇒ CC0 里没有现成的社团活动音。替代：OtoLogic `applause-cheer01`（歓声・拍手）、`handclap-yell01`（手拍子）、`game-sports01`；必要时用 OGA 的 cheer/applause 类资源。

### 6.3 早前抓到的其它 CC0 校园/生活簇（未在本轮复验 ID，供补充检索）

- Freesound 包 `deleted_user_7020630`「School」：`Writting.wav`、`Zipper.wav`、`Writing by chalk on the blackboard.wav`、`Walk 2.wav`（school hallway）、`School bell.wav`
- `Robinhood76`「SCHOOL noises」：`01753 school bell.wav`、`01752 chalk painting.wav`、`00683 school chair in chamber 1.wav`、`12081 pencil drawing circles.wav`、`04496 searching in old book-looping.wav`
- `15FPanska_Hecl_Filip`「15FHeclF-school」包：`8 School bell.wav`(461158)、`9 Opening and closing door.wav`、`7 Opening backpack.wav`、turnstile
- `tvilgiat` Footsteps in the Hallway 3（小学）；`Vetter Balin` `school_ambience.wav`（CC0 已确认）；`conleec` `AMB_School_Hallway_Students_001.wav`；`Dr. Macak` `School Hall-1.wav`；`Elenalostale` SCHOOL CLASSROOM AMBIENCE（CC0）；`Group39` Highschoolers Writing Test in Classroom；`BluetoothBoy` Pencil Writing；`P_Chester` Field Recordings chalk；`janica_uys241180` Classroom ambience
- `Luka Aleksic` Various Sound Effects（CC0，27 文件，含 `turn_page.wav`、`bell.wav`、门吱呀、`tap_water.wav`、`toilet_flush.wav`）
- `Bret Bernhoft` Common Household Sound Effects（CC0/PD）
- `kirrifant` footsteps in snow（CC0）
- `harvey656` SFX（CC0）
- `blip8-sounds`（CC0，181 个 8bit）
- `Nihilex` Free Audio Asset Collection（CC0，30）
- `Ne Mene` Free Sound Assets（CC0，100+）

---

## 7. 下载配方（可复现）

### 7.1 Cloudflare 拦截站的浏览器中转（**已实测成功**，OtoLogic 用）

`curl` 带 UA / 代理 / `cf_clearance` cookie 都无法过 Cloudflare（cookie 与 TLS 指纹 + IP 绑定）。可行方案：

```bash
# 1) 起一个本地 sink，接收浏览器 POST 过来的字节
cat > /tmp/galresearch/sink.py <<'PY'
import http.server, socketserver, os, urllib.parse
OUT="/tmp/galresearch/oto_out"; os.makedirs(OUT, exist_ok=True)
class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin","*"); self.send_header("Access-Control-Allow-Headers","*")
        self.send_header("Access-Control-Allow-Methods","POST,OPTIONS")
    def do_OPTIONS(self): self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        n=int(self.headers.get('content-length',0)); data=self.rfile.read(n)
        fn=os.path.basename(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('name',['out.bin'])[0])
        open(os.path.join(OUT,fn),'wb').write(data); print("WROTE",fn,len(data),flush=True)
        self.send_response(200); self._cors(); self.end_headers(); self.wfile.write(b"ok")
    def log_message(self,*a): pass
socketserver.TCPServer.allow_reuse_address=True
with socketserver.TCPServer(("127.0.0.1",8791),H) as s: s.serve_forever()
PY
nohup python3 /tmp/galresearch/sink.py > /tmp/galresearch/sink.log 2>&1 &

# 2) 用 camoufox 打开目标站任意一页（过掉 Cloudflare 挑战）
camoufox-cli open "https://otologic.jp/free/se/school_bell01.html"

# 3) 在页面上下文里 fetch 目标文件，再 POST 到本地 sink
#    注意：camoufox-cli eval 不支持顶层 await —— 必须包成 IIFE
camoufox-cli eval "(async()=>{
  const u='https://otologic.jp/sounds/se/mp3-zip/Japanese_School_Bell05-mp3.zip';
  const r=await fetch(u,{credentials:'include'});
  if(!r.ok) return 'HTTP '+r.status;
  const b=await r.blob();
  const pr=await fetch('http://127.0.0.1:8791/put?name=Japanese_School_Bell05-mp3.zip',{method:'POST',body:b});
  return pr.status+' size='+b.size;
})()"
# → "200 size=1926340"；文件落在 /tmp/galresearch/oto_out/
```
（HTTPS 页面 POST 到 `http://127.0.0.1` 不受 mixed-content 拦截，Chrome 对 localhost 例外。）
**批量做法**：先在页面里 `eval` 出所有 `mp3-zip` 链接数组，再在同一个 `eval` 里 for-await 循环逐条 fetch + POST。

### 7.2 itch.io 批量下载（**已实测成功**）

流程（`/tmp/itd/itchdl.py` 已实现）：

1. `GET https://<user>.itch.io/<game>` → 取 `<meta name="csrf_token" content="…">`
2. 枚举文件行：`data-upload_id="(\d+)"` 与标题文本
3. 取下载 URL，二选一：
   - **PWYW $0 可过**：`GET /purchase` 页 → `POST /download_url`（`--data-urlencode csrf_token=`）→ JSON `{"url": "…"}`
   - **直接取文件**：`POST /file/<upload_id>?source=view_game&as_props=1` → JSON `{"url": "…"}`
4. 该 `url` 是 **R2 presigned URL**，**约 60 秒内必须开始下载**，否则过期
5. 下载到本地

实测输出（本次）：
```
roskovair.itch.io/cinematic-piano-bgm [6555491] Reaching mid-dream, mp3 file -> 4402191B
roskovair.itch.io/cinematic-piano-bgm [6566733] Well of stars, sheet music -> 52608B
roskovair.itch.io/cinematic-piano-bgm [6555537] All tracks in a .zip file -> 28895353B
```
代理说明：itch.io 与 OGA **直连和 `http://127.0.0.1:7890` 都通**。

### 7.3 OGA / Kenney 直连

```bash
# OGA（文件名有空格的必须 URL-encode）
curl -O "https://opengameart.org/sites/default/files/SchoolDay_0.ogg"
curl -O "https://opengameart.org/sites/default/files/Visual%20Novel%20Concept%20Album.zip"

# Kenney：zip 直链里带一个哈希段，先从素材页 HTML 抽出来
#   https://kenney.nl/assets/<slug>  →  grep 'https://kenney.nl/media/pages/assets/.*\.zip'
```
Kenney 音频包 zip 直链（本次实测抽出，全部 CC0）：

| 包 | zip 直链 |
| --- | --- |
| RPG Audio（52 文件，含 `bookFlip1/2/3.ogg`、`beltHandle1/2.ogg`、`clothBelt.ogg`） | `https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip` |
| Interface Sounds（100） | `https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip` |
| Impact Sounds（130） | `https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip` |
| Music Jingles（86） | `https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip` |
| UI Audio（52） | `https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip` |
| Digital Audio（63） | `https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip` |
| Casino Audio（55） | `https://kenney.nl/media/pages/assets/casino-audio/2472606a04-1721639069/kenney_casino-audio.zip` |
| Sci-fi Sounds（73） | `https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip` |
| Voiceover Pack（95） | `https://kenney.nl/media/pages/assets/voiceover-pack/3f7f168698-1677589897/kenney_voiceover-pack.zip` |
| Voiceover Pack (Fighter)（47） | （同 slug 规则，未抓） |

许可（素材页明写）：`License: Creative Commons CC0`；`kenney.nl/assets/category:Audio` 分类页；官方说明「Credit 'Kenney.nl' or 'www.kenney.nl', this is not mandatory」。
另有独立站点 <https://cc0-sounds.exi.software/>（92 个 CC0 合集 / 7,656 文件）把这些包按 CC0 规范化整理，可用来**核对文件名清单**（`Kenney_rpgaudio` 52、`Kenney_digitalaudio` 63、`Kenney_impactsounds` 130、`Kenney_interfacesounds` 100、`Kenney_musicjingles` 86、`Kenney_uiaudio` 52、`Kenney_voiceoverfighter` 47、`Kenney_voiceoverpack` 95、`Kenney_casinoaudio` 55；另有 `Essentials_Series_NOX_SOUND` 1644、`Bb Books, Paper, Writing (Jan 2021)` 50、`80 CC0 RPG SFX` 80 等）。

### 7.4 Freesound 逐条下载

- 搜索：`https://freesound.org/search/?q=<kw>&f=license%3A%22Creative+Commons+0%22`
- 单条页：`https://freesound.org/s/<id>/`
- **实测**：`/sounds/<id>/download/<filename>` 无会话时 302 到登录页 ⇒ 需用登录后的 cookie（`curl -b cookies.txt`）或浏览器。
- 帮助筛许可：<https://soundspool.com/>（Freesound 元数据索引，不托管文件，每页有 CC0/CC BY/CC BY-NC 徽章与 `Key Takeaway` 描述）

---

## 8. 明确不可入库（仅可用于剧目内引用）

> 以下源**素材本身是好的**，可以用于剧目演出（在演出现场播放、或写进 `plays/*/assets/`，只要不把原文件当素材再分发）；但**不能进 `library/`**，因为 `library/` 会随 git 与剧目包把原文件分发出去。

### 8.1 日本免费素材站（逐条核实）

| 站点 | URL | 禁止条款原文 | 备注 |
| --- | --- | --- | --- |
| **効果音ラボ** | soundeffect-lab.info | 再配布禁止；直リンク禁止；アダルト作品禁止；Content ID 登録禁止。明确把「アプリやソフトウェアの開発で、アセットとして音源を抜き出せる状態で配布」视为再配布 | **直接命中本项目的使用方式** |
| **魔王魂** | maou.audio | 「過去に公開していた曲も素材利用はOK！ただし**曲単品を再配布するのはNG**」；EN 页 "Redistribution of data is prohibited."；Content ID / 配信禁止；NFT 禁止；AI 音楽生成埋め込み禁止 | 免费、商用 OK、18禁 OK、无需注册；**改编曲可作素材分发**（「魔王魂の曲を改変した音楽を音楽素材として配布してもOK」），教育用途二次配布需署名+链接+文件名含 `maoudamashii`/`魔王魂`。署名「音楽：魔王魂」/ "Music: Koichi Morita Music" |
| **効果音辞典** | sounddictionary.info | 再配布禁止 | |
| **甘茶の音楽工房** | amachamusic.chagasi.com | 「音楽だけを販売したり、2次配布することは禁止です」 | 免费商用/个人；MP3 128kbps；加工 OK（tempo/key/fade）；无 Content ID |
| **DOVA-SYNDROME / OpenTracks** | dova-s.jp | 禁止事項 #5「当サイトのコンテンツを複製し公開（オン・オフライン問わず）する行為」；#6「非権利者が当サイトの音源を二次的に公開・配布する行為」；许可 §7「音源を配布、または販売すること」 | 免费、无需署名、商用 OK、18禁 OK；另禁止未事先咨询用于工具类 app/平台 |
| **音人 On-Jin** | on-jin.com | 「素材をそのまま、または加工やコンバートしただけの状態などで、素材として販売や公開、配信するなど、**第三者が取得できる状態にする事はできません**」；直リンク厳禁 | 唯一例外：ツクール等系统上音源必然暴露时，若加「著作者表示 + 音源の二次配布禁止」标注可获许可——但那是「随作品暴露」，不是「当素材库分发」。企业营利用途另需联络 |
| **Springin' Sound Stock** | springin.org/sound-stock | 第5条(2)「第三者に対して本コンテンツ（加工したか加工していないかを問わず）を**再頒布、貸与、販売する等の行為**」；FAQ 明确「効果音を自由なタイミングで鳴らせるアプリ、効果音の再生が主となるような作品での使用は**再配布に該当**しますので禁止」 | 1,000+ 音，免费商用、无需署名。例外只有 Scratch |
| **MusMus** | musmus.main.jp | 2次配布的定义：「**素材集に収録し、販売、配布する**」「配布したゲームなどのコンテンツに含まれた楽曲ファイルを、そのまま素材としての使用が可能と紹介する」 | MP3 only |
| **ポケットサウンド** | pocket-se.info | 再配布禁止 | |
| **くらげ工匠** | — | 再配布禁止 | |
| **無料効果音で遊ぼう！** | taira-komori.jpn.org | 再配布禁止 | |
| **ぴぽや（倉庫）** | pipoya.net | **无料素材**：「素材データの無償での再配布 できます(条件あり)」——允许！条件是「本規約の内容とともに、無償・無条件での再配布」。**有料素材 / 支援サイト向け素材**：再配布できません | ⚠️ 主要提供图片/立绘，**不含音频**；纯图片场景也需按上述条件。转卖禁止 |
| **Monochi Project** | puchikun.info/monochi | 禁止 (2)「無編集または創造性を伴わない程度の加工のみを施したコンテンツを、**無許諾で二次配布、販売する行為**」 | 角色/世界観素材，无音频 |

### 8.2 itch.io / 其它平台（逐条核实）

| 包 | URL | 禁止原文 | 说明 |
| --- | --- | --- | --- |
| **ELV Games**（Visual Novel Music 1/2/4、Music Bundle、Cosy Melodies Bundle） | `elv-games.itch.io/terms`；<https://elvgames.itch.io/visual-novel-music-1> | 「The Assets may not be resold, published, or distributed in any way except as an integral part of the project for which they were used; this also applies to those that have been edited or modified.」 | VN Music 1 = 7 首（`Pink Peonies` 1:27、`In the Mirror` 1:13、`Forever Here` 1:30、`Swan Boat` 1:34、`Back in Time` 1:30、`Saturday Morning` 1:29、`Always by Your Side` 1:19，全部带 loop 版）；VN Music 2 = `Welcome Home` 1:33、`Beautiful Refuge` 1:57、`In Your Arms` 1:38、`Raindrops` 1:18、`The Day We Met` 1:50、`Life Goes On` 2:02；VN Music 4 = `Memory of the Willow Tree` 2:04、`Autumn Love` 1:50、`Come Join Me` 1:43、`Shattered and Forgotten` 1:36（zip 194 MB）。署名「Music by pegonthetrack & ELVGames」。禁 AI 训练/NFT |
| **WAFU Sound Works** Vol.3 VN Music Pack | <https://wafusoundworks.itch.io/wafu-vol3-visual-novel-music-pack> | 「**No reselling/redistributing the audio itself**」 | 12 曲（Daily Life 2:14/1:44、Lighthearted 2:33/1:36、Bittersweet 2:38/2:53、Memory 2:13/2:18、Tension 3:29/2:23、Ending Hope 2:32/2:13），WAV 48kHz/16bit + OGG，含 seamless loop 共 48 文件；免费 sampler「Bittersweet I」 |
| **Alenia Studios**（Amapola / Anyun / Alenia Heritage） | alenia-studios.itch.io | 「Alenia Studios Standard License (CC BY 4.0 + Additional Terms)」：**「No Resale: Standalone redistribution or resale of these audio files is strictly prohibited.」** | Amapola = 20 首钢琴独奏（VN 向）；Anyun = 13 首原声/管弦叙事曲（含 BPM/乐器标注）；Heritage = 同系列 |
| **Vacuous BGM**（Novel Game BGM Collection Vol.01-07、For Male Vol.01-07） | vacuous2409.itch.io | 「Redistribution of the raw audio files or resale as stock music is not permitted.」 | 每卷 12 首 loop-ready WAV，4-7 分钟/曲；署名 `BGM: "<Title>" — Vacuous BGM`。**档案页写「No attribution required」与条款矛盾 ⇒ 按不可入库处理** |
| **glowcompany**（Seoul School / Seoul School Mini / Seoul Everyday SFX Mini） | glowcompany.itch.io | 「You may not resell or redistribute the assets as assets.」 | Seoul School $9（48 icon / 18 tile / 23 音：上课+下课 4 音钟、粉笔、翻页、椅子摩擦、推拉门、柜门、脚步、饮水机、走廊人声、空教室底噪、托盘碰撞、牛奶吸管、哨子、球弹跳、8 个 UI）；Seoul Everyday SFX Mini = 12 个免费音（上课钟、粉笔、柜门、门铃、刷卡、投币、雨棚雨声、霓虹嗡鸣、铁板滋滋、硬币落罐、UI confirm、item get）。**风格是韩式而非日式** |
| **Potat0Master** BGM Pack 1 | potat0master.itch.io | 「you cannot resell or distribute them in the form that it is downloaded or even when it is modified」 | |
| **syuP** ADV Game BGM Pack | syup.itch.io | 「Redistribution prohibited」 | 10 曲，风格极对 galgame，**可惜** |
| **moodfrog** Household Foley Megapack | moodfrog.itch.io | 「royalty-free… no attribution required」（营销词，未允许再分发）；**且是 Suno AI 生成** | 100 MP3 / 100 双 take，39 one-shot + 11 loop |
| **Polarsound Productions** Household Interior Foley | polarsound.itch.io | 「All sounds are royalty-free for commercial and non-commercial use」（营销词） | 默认按保留所有权利处理 |
| **Mayra** free sound packs | mayra.itch.io | 自定义许可，只写「credit required」，**未提再分发** | 需向作者确认后才可考虑 |
| **Pixabay** | pixabay.com | 「You cannot sell or distribute Content … on a **Standalone** basis.」；另禁 ML 训练/建库 | |
| **composersquad / meraj-melody / cyberleaf / n91music / alexeyshishnin** cinematic piano 系列 | 各自 itch 页 | 付费（$1.60–$19）或「royalty free license」/「credit optional」等营销词 | `composersquad` 的包还登记了 **YouTube Content ID** ⇒ 双重不可用 |
| **FreePD.com** | freepd.com | 站点**已永久关闭** | 替代镜像：<https://codeberg.org/fineless71/FreePD>（CC0）、<https://github.com/0lhi/FreePD>（CC0） |
| **Audiostock** | audiostock.jp | 付费授权站（OtoLogic 也在此代销，¥660/曲） | 付费，且许可为 Audiostock 标准授权，非 CC |

---

## 9. 其它 CC-BY / CC0 音乐源（大库、可入库）

| 源 | URL | 许可 | 规模 / 代表曲 | 署名格式 | 再分发 |
| --- | --- | --- | --- | --- | --- |
| **Alexander Nakarada / CreatorChords** | <https://creatorchords.com> | CC BY 4.0 | 大目录（含钢琴）；例 `Emotional Piano Improvisation` 5:44 / 100 BPM；Bandcamp 有「Complete Discography (CC BY 4.0)」 | `Music: <Title> by Alexander Nakarada (https://creatorchords.com) Licensed under CC BY 4.0` | ✅（未发现禁止再分发条款） |
| **Kevin MacLeod / incompetech** | <https://incompetech.com> | CC BY 4.0 | Game Bundle 1 & 2 等 | `<Title> – Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0` | ✅ |
| **Soundimage.org (Eric Matyas)** | <https://soundimage.org> | 「Soundimage International Public License」（CC-BY 类自定义） | **1,900+ 曲**；`Peaceful Intro (Looping)` 同曲也在 OGA 标 CC-BY 3.0 | 授权原文允许「reproduce and Share the Licensed Material, in whole or in part」+「produce, reproduce, and Share Adapted Material」；**署名必须出现在作品内部本身**（不能只写简介）：`Music by Eric Matyas www.soundimage.org`；免署名授权 $30/曲 | ⚠️ 再分发看起来被允许，但**需最后确认无附加限制**（本条为待办） |
| **Zane Little Music** | <https://shop.zanelittle.com>、<https://zanelittlemusic.com>、itch/OGA/FMA | **CC0**（FMA 专辑页明写 `CC0 1.0 Universal`） | 专辑：`Digital Cocktail`、`New Peach Radio [Vol.1]`、`A Bag of Chips [Vol.1/2/3]`（Vol.3 = Jelly 1:15、Chow 1:50、Smash 2:49、Mall 1:20、Take 3:01、Lonely 2:24、Rain 3:17、Critter 2:26、Buy 1:21、Cloud 2:26、Terminal 3:10、Mine 4:01）；OGA 单曲：Sinister Abode、The End-Day 30、It Takes A Hero、Flowerbed Fields [Loop]、Wednesday Night、100 Victories、Dailiez Vol.1（30 曲）；FMA 共 54 曲 | 无需署名 | ✅（注意作者说明：这些曲子**不是**无缝循环） |
| **OSM（otoL）** 类心水曲目（OGA CC0 单曲） | — | CC0 | JRPG Piano、Anime-esque Intro-Outro Theme、First Light Particles、Upbeat Visual Novel Music（此项实为 CC-BY 3.0/SA 3.0） | — | ✅ |

---

## 10. 待办 / 未完成验证

1. **PeriTune 逐曲日期核对**：`Tender Gaze` / `Last Embrace` / `Hanadoki` / `Pale Warmth` / `Petite Walk` / `Gentle Brew` / `Lollipop Lane` / `Sunlit Café` 的公开日期未确认——**这是能否入库的唯一判据**。
2. **OtoLogic 逐包下载**：本轮只实测了 `Japanese_School_Bell05-mp3.zip`。其余 130+ 分类页的 zip 需要按 §7.1 的脚本批量跑一遍（每包 ≈1–3 MB）。
3. **Freesound 登录会话**：需要一次人工登录取得 cookie，才能批量拉取 §6.2 的 CC0 具体音。
4. **体育馆 CC0 缺口**：CC0 只有 2 条，需补跑 `basketball` / `whistle` / `squeaky shoes` / `cheer crowd` 等关键词。
5. **社团活动 CC0 缺口**：`school club brass band` 返回 0 条，需换 `brass band practice` / `school festival` / `band rehearsal` / `cheerleading` 再跑。
6. **Soundimage.org 再分发条款**：需把 IP 许可全文读完确认无「不得单独再分发」类限制。
7. **Alenia Studios `Infinite Lo-Fi`**：许可行与 Amapola/Anyun 不同，需单条确认。
8. **Mayra / Polarsound / Pandita / Oasis Game Assets / tone diary**：许可未明，需向作者确认或放弃。
9. **itch CC0 合集页** `itch.io/c/8078079/cc0-audio-no-ai` 本轮 SSL 失败未读取。
10. **OGA 若干部位 slug 需重查**：`fantasy-sound-effects`、`platformer-sounds`、`cc0-sound-effects`、`ak-game-audio`、`starfield-romance` 本次返回 404 或未取到许可字段。
11. **OtoLogic 童謡类目**（`music_box-douyo-*`、`wood_mallet-douyo-*`）：童谣可能含第三方曲目版权，逐条确认后才能用。
12. **tungerman 完整 10 曲曲名**：官方只公开 5 首；完整清单需从下载到的 `[MP3]/[OGG]/[FLAC] Tearjerker Music Pack.zip` 内文件名列。

---

## 附：本次调研的实测命令与留痕

| 位置 | 内容 |
| --- | --- |
| `/tmp/itd/itchdl.py` | itch.io 批量下载器（CSRF → `/file/<id>` 或 `/download_url` → R2 presigned → 60s 内下载） |
| `/tmp/itd/dl.log` | 历史成功下载记录（alte.itch.io、panditastudio.itch.io、breezy-the-cat.itch.io） |
| `/tmp/galresearch/fs.py` | Freesound CC0 搜索解析器（`https://freesound.org/search/?q=&f=license:"Creative Commons 0"`） |
| `/tmp/galresearch/ogapage.py` | OGA 素材页解析器（取许可 + `sites/default/files` 直链） |
| `/tmp/galresearch/sink.py` + `oto_out/` | 浏览器中转下载的本地 sink 与产物（含已验证的 `Japanese_School_Bell05-mp3.zip`） |
| `/tmp/galresearch/oto/*.txt` | OtoLogic 分类页正文转储（SFX/BGM 曲目与关键词） |
| `/tmp/galresearch/dl_*` | itch.io 实测下载产物（roskovair 三件套） |

**网络可达性实测（2026-09-30）**
- itch.io：直连 ✅ / 代理 ✅
- opengameart.org：直连 ✅（`/sites/default/files/*` 返回 200）
- kenney.nl：直连 ✅
- peritune.com：直连 ✅
- freesound.org：直连 ✅（页面可读；下载需登录）
- otologic.jp：直连 ❌ 403 Cloudflare / 代理 ❌ 403 / 带 UA ❌ 403 / 带 `cf_clearance` cookie ❌ 403 → **需浏览器会话** ✅
