---
name: galgame-audio
description: 为 Galgame / 视觉小说项目挑选与获取免费（CC0/CC-BY/免署名可商用）BGM 与音效（SFX）素材的完整速查。覆盖 OpenTracks（原 DOVA-SYNDROME）、魔王魂、効果音ラボ、Sonniss GDC、Kenney、Freesound、爱给网等 40+ 中英日素材源，含授权档次、六大 BGM 场景 × SE 类别选源映射、脚本化下载路径、落地红线。当用户要为游戏/剧目找免费配乐音效、需要判断某素材能否商用、或要批量拉取素材库时使用。
user-invocable: true
---

# galgame-audio（免费 Galgame BGM 与音效素材获取）

> 2026-09 深调结果，逐站在线核实。完整调研报告：
> `docs/freeform/260928-free-galgame-audio-assets.research.md`（381 行，含全部逐站明细与链接）。

## 何时使用

- 用户要为 galgame / 视觉小说 / 引擎剧目准备免费 BGM 或音效时；
- 需要判断某个素材源/某首曲子能否商用、是否需署名、能否随 exe 分发时；
- 需要批量落库（Kenney 全家桶、Sonniss GDC、魔王魂整站等）时；
- 项目规划 6 大类 BGM 场景（日常欢快/温馨日常/抒情浪漫/悲伤感动/悬疑紧张/高潮燃曲）与常见 SE 类别（UI/打字/环境/心跳/战斗等）时。

---

## 0. 最重要的一条时效事实

**日本最大免费 BGM 站 DOVA-SYNDROME 已于 2026-09-15 改名 OpenTracks**：

- 新址：`https://opentracks.com`（旧 `dova-s.jp` 全站 301 跳转）
- 规模：**19,248 首 BGM + 1,296 个 SE**，免费、免登录、商用/海外可用、署名任意（个别曲目需署名）
- 六大 BGM 场景 + SE 一站式覆盖——**本项目 BGM 主力源，没有之一**

---

## 1. 授权档次速判（拿素材先看这个）

| 标称 | 含义 | 可商用 | 需署名 | 代表源 |
|---|---|---|---|---|
| CC0 / Public Domain | 公共领域/放弃版权 | ✅ | ❌ | Kenney、Sonniss、OpenGameArt、FreePD、Freesound(滤CC0)、Keynata |
| CC BY 4.0 | 署名即可商用 | ✅ | ✅ | 魔王魂、OtoLogic、MusMus、incompetech、爱给"CC-可商用-署名" |
| 站规"商用利用OK" | 日系站自定义条款 | ✅ | 看站规 | OpenTracks、効果音ラボ、甘茶（免署名但停更） |
| NC（非商用） | 仅个人/非商业 | ❌ | — | FMA 大量曲、itch.io 部分包（包内 LICENSE 为准，例：FullminisIctus VN pack） |
| 付费档才有商用权 | 免费档禁商用 | 付费后✅ | — | Suno/Udio/AIVA/Soundraw 免费档、Bensound/Uppbeat 免费档 |

**铁律**："免费下载" ≠ "可商用"；下载前看包内 LICENSE 文件或站规页面。

---

## 2. Tier 1 首选（零署名 / 直接可商用 / 适配度最高）

| 源 | 规模与授权 | 定位 |
|---|---|---|
| **OpenTracks**（原 DOVA）<br>opentracks.com | 19,248 BGM + 1,296 SE<br>免费免登录、署名任意 | BGM 绝对主力：6 类场景 + SE 全覆盖；标签搜（楽しい/切ない/緊張感/力強い…） |
| **効果音ラボ**<br>soundeffect-lab.info | 2,000+ SE<br>商用免费免署名 | SFX 主力：UI/系统/生活/环境/战斗魔法；**禁 18 禁** |
| **Sonniss GDC 十年合辑**<br>sonniss.com/gameaudiogdc | 每届 5–10GB WAV；2026 版 7.47GB/347 文件；历史 200GB+（含 torrent）<br>商用无署名；**禁单独再分发/AI 训练** | SE 地基：影视级 foley/ambience/magic/fantasy 应有尽有 |
| **Kenney**<br>kenney.nl | 4 万+ 资产全 CC0 | UI 音、Music Jingles 85 个、碰撞音；直链 ZIP 打包 |
| **Freesound**<br>freesound.org | 约 73 万声音，52% CC0（约 38 万条） | 长尾补充搜索；官方 REST API 可脚本建库，**必须按 CC0 过滤** |
| **OpenGameArt**<br>opengameart.org | 游戏向 CC0 音乐 3,500+ 项 | VGM 风格浓度高，可高级搜索过滤 |
| **爱给网 CC 区**<br>aigei.com/music | CC 配乐约 2 万首免费商用 + CC 音效 | 中文语境/古风强项；需登录、批量受限 |
| **itch.io 免费音频包**<br>itch.io/game-assets/free/tag-cc0/tag-music | Tallbeard 200+ 首 CC0、Keynata 99 首、WAFU 日式日常、Vacuous（日常+Horror 12 包）、HydroGene 16-bit、ArrowSMorgan MIT 等 | 视觉小说专精包聚集地（搜索 tag：visual-novel / music / cc0） |

---

## 3. Tier 2（需署名，但风格/质量极佳）

| 源 | 要点 |
|---|---|
| **魔王魂** maou.audio | CC BY 4.0（可选站规免署名档付费）；18 禁 OK、改変 OK；**官方整站打包下载页 `maou.audio/all/`**，脚本友好 |
| **MusMus** musmus.main.jp | 需署名；POP/ボサノバ/オルゴール 等日常轻音乐强 |
| **OtoLogic** otologic.jp | CC BY 4.0；BGM+SE 同站；动画/游戏向专业级 |
| **甘茶の音楽工房** amachamusic.chagasi.com | 免署名但 **2019 后停更**、MP3 128kbps；ほのぼの/癒し系值得翻 |
| **incompetech**（Kevin MacLeod） | CC BY 4.0，$30 买断免署名；calm/dark/epic 全覆盖 |
| **Pixabay** music / sound-effects | 免署名，自带 license 证书；2019/2023 两次改约，落地前看现行条款 |
| **HURT RECORD** / TAM Music / SHW / くらげ工匠 / 煉獄庭園 | 同人圈质量源：伤感抒情（HURT RECORD 1000+）、ピアノ・オルゴール（TAM）、戦闘曲（SHW/くらげ工匠）、ダーク系（煉獄庭園） |
| **H/MIX GALLERY** | 同人免费，**商用需 ¥2,200/曲**——商业化前算成本 |

---

## 4. 中文源

| 源 | 要点 |
|---|---|
| **爱给网**（首选）aigei.com/music · /sound | 只用 CC 区并按单条核对协议；过滤"可商用(含CC0/公共版权)" |
| **淘声网** tosound.com | 聚合耳聆网/Freesound/Looperman 百万级；免登录搜/下；创宇盾防护，不宜自动化 |
| **耳聆网** ear0.com | 2013 年至今仍在线；CC0/CC-BY/CC-BY-NC 三档；国内原创实录音效稀缺补充 |
| **平台绑定源（不采用）** | 橙光/66RPG（仅限平台内）、站长素材、新片场（付费授权） |

---

## 5. AI 生成音乐（现状与红线）

| 平台 | 免费档 | 商用条件（2026 现状） |
|---|---|---|
| Suno | 50 credit/日、**禁商用** | Pro **$10/月**起，付费期生成曲永久保留商用权 |
| Udio | **2025-10 起已暂停下载/导出** | 当前不可用于生产流程 |
| AIVA | 3 首/月、版权归 AIVA | Standard €15 有限商用 / Pro €49 全版权 |
| Soundraw | 无限试听、无下载 | Creator 约 $6–11/月，永续商用许可，商用最干净 |
| MusicGen / Stable Audio Open | 开源权重本地自部署 | 生成物归用户（自担版权责任） |

**现成的 CC0 AI 音乐包（推荐直接用）**：
- Keynata Commons：99 首 CC0（carf-coder.github.io/keynata-commons）
- btahir/open-lofi：GitHub 150+ lo-fi CC0，含 catalog.json（github.com/btahir/open-lofi）
- HowWorks Music：约 275 首 CC0（howworks.ai）
- ⚠️ AI 生成曲上 Steam 需做 AI 内容披露

---

## 6. GitHub 开源/聚合仓库

| 仓库 | 内容 |
|---|---|
| **SoundSafari/CC0-1.0-Music** | 全球最大 CC0 音乐语料 ~7,000 首 / 约 40GB，按来源站分组 |
| **madjin/awesome-cc0** | CC0 资产导航（音乐/音效分类） |
| **TMHSDigital/Free-Game-Dev-Assets** | 免费商用游戏资产目录（audio 分类带许可元数据） |
| **fiehrfly/muses**、**Kavex/GameDev-Resources**、**Kavex/GameSounds**、**csevier/awesome-open-assets**、**gravitygamesinc/gamedev-free-resources** | 经典导航/样本库 |

---

## 7. 六大 BGM 场景选源映射

| 场景 | 首选源 | 备选源 |
|---|---|---|
| 日常欢快 | OpenTracks（楽しい/明るい）、MusMus（POP/ボサノバ）、Tallbeard CC0 包、WAFU Vol.3 | Vacuous 日常包、Pixabay（按 mood）、爱给 CC 配乐 |
| 温馨日常 | 甘茶（ほのぼの/癒し）、OtoLogic（アンビエント）、OpenTracks（温かい/穏やか） | incompetech（calm）、Soundimage、open-lofi |
| 抒情浪漫 | HURT RECORD、OpenTracks（切ない+ピアノ）、TAM（ピアノ/オルゴール） | 甘茶钢琴、MusMus 钢琴 |
| 悲伤感动 | HURT RECORD、OpenTracks（悲しい/寂しい）、甘茶（悲しい） | Musopen 古典慢板、FreePD |
| 悬疑紧张 | OpenTracks（緊張感/怪しい/不気味）、OtoLogic（環境音+SE 组合）、incompetech（dark） | Vacuous Horror 系列、FMA CC0 氛围曲、煉獄庭園 |
| 高潮燃曲 | 魔王魂（ネオロック/バトル）、OpenTracks（力強い/激しい/game 标签）、SHW | HydroGene 16-bit、incompetech（epic）、OpenGameArt CC0 battle |

## 8. 常见 SE 类别选源映射

| SE 类别 | 首选源 |
|---|---|
| UI 点击/悬停/确认 | 効果音ラボ（ボタン・システム音）、Kenney Interface Sounds、OtoLogic（UI/システム） |
| 文本框打字/翻页/光标 | 効果音ラボ（システム音）、Freesound CC0（type/keyboard）、爱给 UI 专区 |
| 开门/脚步/物件 | Sonniss GDC（foley）、Freesound CC0、効果音ラボ（生活） |
| 雨声/蝉鸣/风/海浪 | Sonniss（ambience 专卷）、Freesound CC0（雨/蝉大量）、効果音ラボ（環境音/自然動物）、OtoLogic 環境音 |
| 心跳/惊讶/闪光/钟声/提示 | 効果音ラボ、OtoLogic（ジングル/アクセント）、Kenney（jingle/UI）、Freesound CC0 |
| 魔法/战斗/打击 | くらげ工匠（戦闘・技・魔法）、効果音ラボ（戦闘/演出）、Sonniss（magic/fantasy）、魔王魂 SE |
| 剧情转场/系统 | Kenney Music Jingles（85 个 CC0）、Vacuous 转场包 |

---

## 9. 脚本化 / API 下载路径（批量落库时）

| 源 | 方式 |
|---|---|
| Freesound | 官方 REST API（免费 token，支持 license=CC0 过滤、分页），最适合写脚本建库 |
| Internet Archive | 开放 API + 直接 HTTP 下载，可 curl 集合 |
| Sonniss | 直链 ZIP + 官网 torrent，一次下齐 |
| Kenney | 每 pack 直链 ZIP（URL 规律），可脚本批量 |
| OpenGameArt | 逐文件 ZIP + 高级搜索 URL 参数 |
| 魔王魂 | 官方一括ダウンロード页 `maou.audio/all/`，整站打包脚本友好 |
| OpenTracks | 逐曲页面直链；无公开 API，批量需抓页面 |
| itch.io | 网页下载；官方 butler CLI 可自动化（免登入包） |
| Pixabay | 官方 API（需 token，受 Content License 条款约束） |
| 爱给/淘声 | 登录受限 / 创宇盾防护，不宜自动化 |

---

## 10. 落地红线（必须执行）

1. **授权会变，落地前逐条复核**：Pixabay 2019/2023 两次改约、OpenTracks 刚改名；以本站规则页为准。
2. **"免费下载" ≠ "可商用"**：FMA/itch.io 大量 NC 曲；下载后必须看包内 LICENSE 文件。
3. **再分发红线**：几乎全部源禁"音源本体二次分发/转售"。**随成品游戏嵌入普遍允许**（我们的"素材库随 exe 分发"OK）；但不要单独卖素材包。
4. **Content ID / 音商标**：魔王魂/効果音辞典/OtoLogic 等禁把素材注册 Content ID 或音商标；运营期别把素材曲提交 YouTube Content ID。
5. **AI 相关条款**：魔王魂/OtoLogic/煉獄庭園/Sonniss/効果音辞典均**禁 AI 学习/训练取用**，尤其 Sonniss 禁 AI/ML 训练非常严格——不要把下载素材喂给本地模型训练；作为产品内播放素材无碍。
6. **18 禁限制**：効果音ラボ/効果音辞典禁成人作品；魔王魂/OpenTracks/OtoLogic 允许。承接 18+ 内容时 SE 主力换 OpenTracks SE、OtoLogic、くらげ工匠。
7. **平台锁定源规避**：YouTube 音频库（仅 YouTube）、Mixkit 音乐（禁游戏）不入库。
8. **AI 曲入 Steam 披露**：AI 制作曲目需做内容披露；Suno/Udio 免费档生成曲不可商用。
9. **录音肖像/品牌声**：Freesound/耳聆网社区录音含他人说话、品牌声时商用前规避。
10. **版本与备份**：按"源站名/日期/授权截图"归档到 media-cache 结构，避免依赖源站在线状态。