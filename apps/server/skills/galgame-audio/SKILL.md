---
name: galgame-audio
description: 为视觉小说剧目找免费 BGM 与音效（SFX）的选源速查：40+ 中英日素材源的授权档次（CC0 / CC BY / 站规商用 / NC / 付费档）、六大 BGM 场景与常见 SE 类别的选源映射、批量下载路径、配额与再分发红线，以及配了音乐后端时用提示词出曲的写法（情绪/乐器/节奏/用途、循环意图）。当用户要为剧目配乐配声、需要判断某首曲子能不能商用，或要在剧目里登记音频素材时使用。
user-invocable: true
---

# galgame-audio（免费 BGM 与音效素材获取）

剧目里的音频有两个来路：**找现成的**（免费素材源）与**自己生成**（配了音乐后端时的 `generate_bgm`）。
这份速查解决前一条路上的两件事：**去哪个源找**、**这个源的素材能不能用在剧目里**——
以及什么时候该走生成而不是找。

找到之后按剧目规矩落进 `assets/bgm/`、`assets/sfx/`，并在 `assets/manifest.json` 里登记描述
（素材 id 就是文件名去掉扩展名）。

## 0. 一条时效事实

日本最大的免费 BGM 站 **DOVA-SYNDROME 已于 2026-09-15 改名 OpenTracks**：`https://opentracks.com`
（旧 `dova-s.jp` 全站 301）。19,000+ 首 BGM + 1,200+ SE，免费免登录、商用与海外可用、署名任意
（个别曲目除外）——**BGM 主力源，没有之一**。

## 1. 授权档次速判（拿素材先看这个）

| 标称 | 含义 | 可商用 | 需署名 | 代表源 |
|---|---|---|---|---|
| CC0 / Public Domain | 公共领域 | ✅ | ❌ | Kenney、Sonniss、OpenGameArt、FreePD、Freesound（滤 CC0） |
| CC BY 4.0 | 署名即可商用 | ✅ | ✅ | 魔王魂、OtoLogic、MusMus、incompetech |
| 站规「商用利用 OK」 | 日系站自定义条款 | ✅ | 看站规 | OpenTracks、効果音ラボ、甘茶 |
| NC（非商用） | 仅个人/非商业 | ❌ | — | FMA 大量曲、itch.io 部分包（以包内 LICENSE 为准） |
| 付费档才有商用权 | 免费档禁商用 | 付费后 ✅ | — | Suno/Udio/AIVA/Soundraw 免费档、Bensound/Uppbeat 免费档 |

**铁律：「免费下载」≠「可商用」。** 下载前看包内 LICENSE 或站规页面。

## 2. Tier 1（零署名 / 直接可商用 / 适配度最高）

| 源 | 规模与授权 | 定位 |
|---|---|---|
| **OpenTracks** opentracks.com | 19,000+ BGM + 1,200+ SE，免费免登录、署名任意 | BGM 绝对主力：日系标签搜（楽しい／切ない／緊張感／力強い） |
| **効果音ラボ** soundeffect-lab.info | 2,000+ SE，商用免费免署名 | SFX 主力：UI／系统／生活／环境／战斗魔法；**禁 18 禁** |
| **Sonniss GDC 合辑** sonniss.com/gameaudiogdc | 每届 5–10GB WAV，商用无署名；**禁单独再分发 / 禁 AI 训练** | SE 地基：影视级 foley／ambience／magic |
| **Kenney** kenney.nl | 4 万+ 资产全 CC0 | UI 音、Music Jingles 85 个；直链 ZIP |
| **Freesound** freesound.org | 约 73 万条，约半数 CC0 | 长尾补充；官方 REST API，**必须按 CC0 过滤** |
| **OpenGameArt** opengameart.org | CC0 音乐 3,500+ | VGM 风格浓 |
| **爱给网 CC 区** aigei.com/music | CC 配乐约 2 万首免费商用 | 中文语境／古风强项；需登录、批量受限 |
| **itch.io 免费音频包** itch.io/game-assets | Tallbeard 200+ CC0、Keynata 99 首、WAFU 日式日常等 | 视觉小说专精包聚集地 |

## 3. Tier 2（需署名，风格/质量极佳）

| 源 | 要点 |
|---|---|
| **魔王魂** maou.audio | CC BY 4.0（可付费免署名）；18 禁 OK、改変 OK；官网有整站打包下载页 |
| **MusMus** musmus.main.jp | 需署名；POP／ボサノバ／オルゴール 日常轻音乐强 |
| **OtoLogic** otologic.jp | CC BY 4.0；BGM + SE 同站，动画/游戏向专业级 |
| **甘茶の音楽工房** amachamusic.chagasi.com | 免署名但 **2019 后停更**；ほのぼの／癒し系值得翻 |
| **incompetech**（Kevin MacLeod） | CC BY 4.0，可买断免署名；calm／dark／epic 全覆盖 |
| **Pixabay** music / sound-effects | 免署名带 license 证书；条款改过两次，落地前看现行版本 |
| **HURT RECORD** / TAM Music / SHW / くらげ工匠 / 煉獄庭園 | 同人圈质量源：伤感抒情、钢琴八音盒、战斗曲、黑暗系 |

## 4. 中文源

| 源 | 要点 |
|---|---|
| **爱给网**（首选）aigei.com/music · /sound | 只用 CC 区，逐条核对协议 |
| **淘声网** tosound.com | 聚合耳聆网／Freesound／Looperman；有防护，不宜自动化 |
| **耳聆网** ear0.com | 2013 年至今；CC0／CC-BY／CC-BY-NC 三档 |
| 平台绑定源 | 橙光／66RPG（仅限平台内）、新站素材、新片场（付费授权）——不采用 |

## 5. AI 生成音乐（现状）

| 平台 | 免费档 | 商用条件 |
|---|---|---|
| Suno | 50 credit/日、**禁商用** | Pro 起，付费期生成曲永久商用权 |
| Udio | **已暂停下载/导出** | 当前不可用于生产 |
| AIVA | 3 首/月、版权归 AIVA | Standard/Pro 才有商用权 |
| Soundraw | 无限试听、无下载 | Creator 起，永续商用许可，商用最干净 |
| MusicGen / Stable Audio Open | 本地自部署 | 生成物归用户（自担版权责任） |

现成 CC0 AI 音乐包（可直接用）：Keynata Commons 99 首、btahir/open-lofi 150+ 首、
HowWorks Music 约 275 首。**AI 生成曲上架 Steam 需做 AI 内容披露。**

## 6. 六大 BGM 场景 → 选源

| 场景 | 首选 | 备选 |
|---|---|---|
| 日常欢快 | OpenTracks（楽しい／明るい）、MusMus | Tallbeard CC0、WAFU Vol.3、Pixabay |
| 温馨日常 | 甘茶（ほのぼの／癒し）、OpenTracks（温かい） | OtoLogic アンビエント、incompetech calm、open-lofi |
| 抒情浪漫 | HURT RECORD、OpenTracks（切ない＋ピアノ） | TAM（ピアノ／オルゴール）、MusMus |
| 悲伤感动 | HURT RECORD、OpenTracks（悲しい／寂しい）、甘茶 | Musopen 古典慢板、FreePD |
| 悬疑紧张 | OpenTracks（緊張感／怪しい／不気味） | incompetech dark、煉獄庭園、Vacuous Horror |
| 高潮燃曲 | 魔王魂（ネオロック／バトル）、OpenTracks（力強い／激しい） | SHW、HydroGene 16-bit、OpenGameArt battle |

## 7. 常见 SE 类别 → 选源

| 类别 | 首选 |
|---|---|
| UI 点击／悬停／确认 | 効果音ラボ（ボタン・システム音）、Kenney Interface Sounds |
| 打字／翻页／光标 | 効果音ラボ、Freesound CC0（type/keyboard） |
| 开门／脚步／物件 | Sonniss GDC（foley）、効果音ラボ（生活）、Freesound CC0 |
| 雨／蝉／风／海浪 | Sonniss ambience、Freesound CC0、効果音ラボ（環境音） |
| 心跳／惊讶／钟声／提示 | 効果音ラボ、OtoLogic ジングル、Kenney jingle、Freesound CC0 |
| 魔法／战斗／打击 | くらげ工匠、効果音ラボ（戦闘）、Sonniss magic、魔王魂 SE |
| 转场／系统 | Kenney Music Jingles（85 个 CC0）、Vacuous 转场包 |

## 8. 批量落库（写脚本时）

| 源 | 方式 |
|---|---|
| Freesound | 官方 REST API（免费 token，支持 `license=CC0` 过滤、分页）——最适合脚本建库 |
| Internet Archive | 开放 API + 直链 HTTP，可 curl 集合 |
| Sonniss / Kenney | 直链 ZIP（Kenney 每 pack URL 有规律），一次下齐 |
| 魔王魂 | 官方一括ダウンロード页，整站打包脚本友好 |
| OpenTracks / itch.io | 逐条页面下载；itch.io 有 butler CLI |
| 爱给／淘声 | 登录受限 / 有防护，不宜自动化 |

找到的素材落进剧目后要**在 `assets/manifest.json` 里登记**：素材 id 是文件名去扩展名，
描述写清「什么场景／什么情绪」——剧作家挑曲子看的就是它，文件名看不出来。
写 `bgm` 时把 `mood` / `scene` 照库里既有的词表填。

## 9. 用 `generate_bgm` 出曲（配了音乐后端时）

工具配了音乐后端才注册；它**后台排产**（发起即返回，一首约 175 秒的曲子实测 84 秒到货），
所以不会卡住这一轮对话，但结果也不是马上能听的。

- **一类场景一首**：别为同一情绪反复出；出之前先读 `assets/manifest.json` 看 `bgm` 里已有什么。
- **上游固定给约 176 秒、没有时长参数**：要它适合循环就在 prompt 里写 `seamless loop, no fade out`——循环意图只能靠提示词表达。
- **prompt 写清四件事**：情绪（quiet / tense / bittersweet）、乐器（piano / strings / synth）、节奏（slow / mid-tempo）、用途（rainy afternoon scene）。
  具体措辞与反例词表见 skill `galgame-bgm`。
- **落库后补一句适用场景**（素材表的描述）——剧作家挑曲子看的就是它。
- 能从上面的免费源拿到现成的（尤其整部剧目需要十几首时）就别一律烧配额；AI 曲上架 Steam 需做 AI 内容披露。
- 剧目里已有同名曲子时 `generate_bgm` 会**直接跳过**：用户明确说要重做那一首时才带 `overwrite=true`。

## 10. 落地红线

1. **授权会变，落地前逐条复核**：Pixabay 改约两次、OpenTracks 刚改名；以本站规则页为准。
2. **再分发红线**：几乎全部源禁「音源本体二次分发/转售」；**随剧目成品嵌入普遍允许**，
   但不要把素材包单独再分发。
3. **Content ID / 音商标**：魔王魂、OtoLogic 等禁把素材注册 Content ID 或音商标；
   运营期别把素材曲提交 YouTube Content ID。
4. **AI 训练条款**：魔王魂、OtoLogic、煉獄庭園、Sonniss、効果音辞典均**禁 AI 学习取用**——
   不要把下载的素材喂给模型；作为剧目内播放素材无碍。
5. **18 禁限制**：効果音ラボ、効果音辞典禁成人作品；魔王魂、OpenTracks、OtoLogic 允许。
