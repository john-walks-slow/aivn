# 视觉小说 / 日系 Galgame 风格 BGM 的音乐学特征与 AI 音乐生成提示词工程（深度调研）

- 调研日期：2026-10-12
- 调研范围：① Galgame / 视觉小说 BGM 的和声、配器、混音与循环约束；② 典型场景的音乐形态矩阵；③ 面向 Lyria / Suno / Udio / MusicGen 的提示词词汇学与负向/避坑词表
- 调研方法：多轮多角度网络检索（英/日/中三语）+ 关键页面全文抓取；所有事实性主张后附来源链接
- 本文件性质：外部事实与既有项目事实的聚合，不含个人判断；不同来源互相矛盾处一律并列保留

---

## 0. 摘要：可直接落地的核心结论

**音乐学层**

1. 日系 Galgame BGM 的和声底子高度集中于四个「定番」：**カノン進行（I–V–vi–iii–IV–I–IV–V）**、**王道進行（IV△7–V7–iii7–vi，别名 4536 進行／小悪魔コード進行）**、**小室進行（vi–IV–V–I，6451 進行）**，以及**丸サ進行／Just the Two of Us 進行（IVmaj7–III7–vim7–vm7–I7）**。前三者构成日本流行音乐 1990 年代以降的和声骨架，第四者是「大人っぽい浮遊感」的来源。（[JA Wikipedia 王道進行](https://ja.wikipedia.org/wiki/%E7%8E%8B%E9%81%93%E9%80%B2%E8%A1%8C)、[JBG 音楽院三大進行](https://jbg-ongakuin.com/staff-blog/20250808/)、[nippon.com 丸サ進行](https://www.nippon.com/ja/japan-topics/g01096/)、[note 丸サ進行徹底解説](https://note.com/soundwitches/n/n62d9d7eb0174)）
2. 「切なさ／泣き」的技术构成是可枚举的：**maj7 / m7 / add9 / sus4 的张力音**、**半音下行与借用和音（iv、♭VI、♭VII）**、**クリシェ（半音阶内声）**、**不回到主音的未解決感**、以及**下行低音**。（[和音の学び 悲しいコード進行](https://waon-i.com/kg095/)、[うちやま作曲教室 泣ける進行10選](https://sakkyoku.info/beginner/cry-chord-progression-pattern/)、[LIVEARTIST 泣きメロの作り方](https://liveartist.info/naki-mero/)、[和音の学び ノスタルジック進行](https://waon-i.com/kg131/)）
3. 「和风」不是形容词：它是**ヨナ抜き音階**（大调去掉 4、7 级）与**平調子 / 都節（in 音階）/ 陰音階 / 岩戸 / 陽音階**这一族五声音阶的选型，配以**半音倚靠稳定音**的特征音程。（[Master the Score 日本音階](https://www.masterthescore.com/article/japanese-scales)、[Wikipedia In scale](https://en.wikipedia.org/wiki/In_scale)）
4. 「梦幻／神秘」在游戏配乐里的高相关调式是 **Lydian（升 4 级）**：既稳定（保留主音与纯五度）又不解决，广泛用于 Zelda、Final Fantasy、Genshin 等。（[music-dictionary Lydian in VGM](https://music-dictionary.org/music-theory/modes/lydian-mode-video-game-soundtracks-case-studies/)、[Hooktheory Genshin Main Theme = G/C Lydian](https://www.hooktheory.com/theorytab/view/yu-peng-chen/genshin-impact-main-theme)）
5. 视觉小说音乐的学术定位是 **mukokuseki（無国籍）风格的「垂直折衷主义」**：与 JRPG 相比，VN 的「纯管弦交响模型」比重明显更低，取而代之的是「电子节拍 + 管弦」（Fate/stay night）、「8-bit + 摇滚节奏组」（逆転裁判）等多种本土风格并存。（[Merlini, A Mukokuseki Music?](https://air.unimi.it/retrieve/468ee88e-058a-4bce-a880-30cc71091384/%28Paper%20SOS4%29%20A%20Mukokuseki%20Music.pdf)）

**工程层**

6. 视觉小说 BGM 的硬约束有两条与影视配乐**方向相反**：**（a）中频（约 1–4 kHz）必须给念白留出「洞」**，因为人声清晰度就集中在这里，而钢琴／吉他／弦乐／synth lead 也在同一带；**（b）动态必须平**，不能有影视式的高潮与冲击点，因为循环播放时每一次爬坡都会重复一次。（[Riot Anthem Studios](https://riotanthemstudios.com/blog/why-your-background-music-fights-your-dialogue-and-how-to-fix-it)、[BGMer ダッキングとEQ](https://bgmer.net/bgm-ducking-eq-guide/)、[VNDev 音量平衡指南](https://vndev.wiki/Guide:Balancing_a_Game%27s_Loudness)）
7. 无缝循环不是「风格词」，是**采样级工程 + 元数据**：`LOOPSTART/LOOPLENGTH`（RPG Maker、SDL_mixer）、`LOOP_START/LOOP_END`（ZDoom/FMOD）、WAV 的 `smpl` chunk。**生成模型不产出循环元数据**，只能靠提示词逼近「可循环的曲式」，再在 DAW 里剪到小节线。（[Austin Haynes: RPG Maker 原生循环](https://www.austinhaynesmusic.com/rpg-maker-music-loops)、[Looping with Vorbis metadata](https://bgm13.com/posts/vorbis-loop.html)、[Suno 独立游戏配乐实战](https://suno.ing/zh-cn/blog/suno-indie-game-soundtrack-guide/)）
8. 提示词工程的**最大单一失效原因**是「把负向词写在 Style／正向描述里」。Suno 官方行为是**忽视 Style 字段里的否定指令**，正确通道是 Advanced Options 的 **Exclude** 字段 + **Instrumental 开关** + Lyrics 框里的 `[Instrumental]` 标记；Style 里只有肯定性描述才可靠。（[Blake Crosley Suno 指南](https://blakecrosley.com/guides/suno)、[HookGenius 负向提示词](https://hookgenius.app/learn/suno-negative-prompting/)）
9. 「把曲子推离 Galgame」的陷阱词可归为五类：**动漫 OP 燃曲类**（`anime opening`、`J-rock`、`powerful guitar riff`、`four-on-the-floor`）、**影视大片/预告类**（`epic orchestral`、`cinematic trailer`、`huge impact hit`、`risers`）、**廉价芯片音类**（`8-bit`、`chiptune`、`NES era`）、**违和鼓点类**（`driving drums`、`EDM`、`drop`、`build-up`）、**人声类**（`with vocals`、`choir`、`humming`、`vocalise`）。另有**版权/过滤类**：真实艺术家名会被 Suno 过滤，主流做法是改写成声音描述。（[Veena 动漫音乐](https://www.veena.studio/make/anime-music)、[SunoGuide instrumental](https://sunoai.uk/en/guides/suno-instrumental-prompts/)、[Suno 艺术家黑名单](https://github.com/bitwize-music-studio/claude-ai-music-skills/blob/main/reference/suno/artist-blocklist.md)、[SunoAI Prompt Guide 避免艺术家名](https://sunoaipromptguide.org/how-to-avoid-artist-name-tags-on-suno-ai/)）
10. **情绪控制的已知系统性偏差**（多篇实证研究）：商业模型（Suno、Udio）倾向生成**比提示词更「愉悦」**的音乐，且所有模型都向**情绪中性**回归；**arousal（唤醒度）比 valence（愉悦度）更容易被忠实执行**。因此「sad / melancholic」类提示词需要额外强化，且「低唤醒 + 低愉悦」（忧郁）是最难命中的象限。（[AImoclips benchmark, arXiv 2509.00813](https://arxiv.org/html/2509.00813v2)、[Feels in the Music Machine 硕士论文](https://www.diva-portal.org/smash/get/diva2:2009627/FULLTEXT01.pdf)、[arXiv 2608.29987](https://arxiv.org/abs/2608.29987)）

---

## 1. 术语与范围界定

| 术语 | 本文含义 | 说明 |
| --- | --- | --- |
| BGM | 垫在场景／台词之下的循环背景音乐 | 与「主题歌（OP/ED）」「插入歌」「角色歌」相区别 |
| 劇伴（げきばん） | 日文对「影视/动画/游戏配乐 BGM」的通称 | 日本 DTM 圈与委托实务里的常用词 |
| ループ BGM | 供引擎反复播放、首尾衔接设计好的曲子 | 与「播完即止」的片头／片尾曲互斥 |
| 王道進行 | IV△7–V7–iii7–vi（C 大调 = F△7–G7–Em7–Am） | 别名 4536 進行、小悪魔コード進行 |
| 丸サ進行 | IVmaj7–III7–vim7–vm7–I7 | 别称 Just the Two of Us 進行、ジゴロ進行，海外也称（含 436 简化型） |

**范围边界（本报告不覆盖）**：VRM/Live2D 演出、TTS 语音合成、SFX 设计、素材授权与免费素材源清单——后者已由本项目既有技能 `galgame-audio` 覆盖（含 OpenTracks 等 40+ 素材源与授权档次）。

---

## 2. 音乐学与声学解构

### 2.1 和声特征

#### 2.1.1 三大定番（日本流行音乐和声的公共底座）

| 进行 | 级数（C 大调） | 别名 | 结构要点 | 情绪/用法 |
| --- | --- | --- | --- | --- |
| カノン進行 | I–V–vi–iii–IV–I–IV–V（C→G→Am→Em→F→C→F→G） | パッヘルベル進行 | 8 小节循环；低音逐级下行（ド→シ→ラ→ソ→ファ→ミ…）；**主音出现 2 次** | 「落ち着く・物語的」；适合需要叙事感的段落 |
| 王道進行 | IV△7–V7–iii7–vi（F△7→G7→Em7→Am） | 4536 進行、小悪魔コード進行 | 4 小节；**全程不出现 I**；iii 与 vi 各与 I 共享两个音 →「似要解决却不解决」 | 「宙づり・切ない」；1990 年代以降 J-POP 副歌最常用 |
| 小室進行 | vi–IV–V–I（Am→F→G→C） | 6451 進行 | 4 小节；**从 minor 起步、末了在 I 落地** | 「暗→明」的戏剧性；适合 A メロ→サビ的桥接与释放 |
| ツーファイブ | ii m7–V7–I maj7 | 251 進行 | 3 和弦，爵士最小单位 | 进入丸子/城市流行质感 |

来源：[JBG 音楽院](https://jbg-ongakuin.com/staff-blog/20250808/)、[VR Piano 定番5パターン](https://vrpiano.co.jp/chord/chord-progression/)、[VR Piano 王道進行](https://vrpiano.co.jp/chord/oudou/)、[JA Wikipedia 王道進行](https://ja.wikipedia.org/wiki/%E7%8E%8B%E9%81%93%E9%80%B2%E8%A1%8C)、[BASS NOTE 定番進行](https://bassnote.jp/blog/chord-progression/)、[er-theory 王道進行](https://er-music.jp/theory/702/)

**关键结构事实（用于提示词写作时的类比，不用于直接投喂模型）**

- 王道進行的命名史：2008 年 niconico 動画「音極道」命名；「小悪魔コード進行」由亀田誠治在 2014 年 NHK『亀田音楽専門学校』命名，用以描述「明るい和音から暗い和音へ変移する瞬間」。（[JA Wikipedia](https://ja.wikipedia.org/wiki/%E7%8E%8B%E9%81%93%E9%80%B2%E8%A1%8C)）
- 王道進行的直接派生（4 种，均可在提示词描述里表达为不同的「色彩词」而非和弦名）：
  - `IV→V→III7→VIm`：把 iii 换成**セカンダリードミナント** III7，vi 的解决感剧增（E7→Am 是强ドミナントモーション）。米津玄師「Lemon」、Official髭男dism「Pretender」用例。
  - `IV→V→#Vdim→VIm`：**パッシングディミニッシュ**，比基本型更悲。
  - `IV→V→IIIm→VIm→V`：末尾补 V，使回环更顺（循环用）。
  - `IV→V→IIIm→VI`：末和弦改大三，**ピカルディ終止**，短调曲里有「还有希望」的余味。
  （[music-studio.jp 王道進行派生](https://music-studio.jp/royal-road-progression/)、[er-theory](https://er-music.jp/theory/702/)）
- **純情コード進行**（亀田命名，カノン進行的变体）：C–G/B–Am–Em/G–F–C/E–Dm–G；用例「守ってあげたい」「勇気100%」「恋するフォーチュンクッキー」。（[JA Wikipedia](https://ja.wikipedia.org/wiki/%E7%8E%8B%E9%81%93%E9%80%B2%E8%A1%8C)）
- **コンファメ進行（アニソン進行）**：C→Bm7(♭5)→E7→Am→Gm7→C7→F→BbM7→G7；别名「マスピ進行」「ハレ晴レ進行」；结构上 = カノン進行 + ツーファイブ的复合，1 循环内含多个「小解决」。**注意：这是推向「アニソン」的和声，用在日常/抒情场景会过度戏剧化。**（[JBG 音楽院](https://jbg-ongakuin.com/staff-blog/20250807/)）
- 其他现代常见：1564 進行（レット・イット・ビー進行）、4156 進行（YOASOBI「夜に駆ける」等）、丸サ 5 型和弦与 4 和弦简化版。（[JBG](https://jbg-ongakuin.com/staff-blog/20250808/)、[note 丸サ進行](https://note.com/soundwitches/n/n62d9d7eb0174)）

#### 2.1.2 丸サ進行（Just the Two of Us 進行）的解构

- 基本型（C 大调）：`Fmaj7 – E7 – Am7 – Gm7 – C7`，级数 `IVmaj7 – III7 – vim7 – vm7 – I7`。
- 结构解剖（多来源一致）：
  1. **第二个和弦 E7 是核心**：它是 Am 的**セカンダリードミナント（V7/vi）**，且 Am 是 C 大调的**平行調**——于是「大调与小调混在一起」的模糊感出现。
  2. **E7→Am7 与 C7→Fmaj7 构成两次ドミナントモーション**（完全五度下行解决）；一般定番只有一次，这里两次 → 「洗練された」印象。
  3. 后半 `Gm7→C7→(Fmaj7)` 是**把 F 当临时主音的 II–V–I**；而 Gm7 对原调 C 大调是**借用和音（モーダルインターチェンジ，借自同主短调 C minor）**，B♭ 音带来「ひねり」。
  4. 全部和弦为四和音（セブンス）。三和音版（F–E–Am–Gm–C）会失去大部分色彩。
- 变体：`Fmaj7–E7–Am–C`（调性只在平行调间移动，变化最小）、`Fmaj7–E7–Am–C7`（『丸の内サディスティック』型，最「使いやすい」）、`Fmaj7–E7–Am7–C7`（省略 Gm7）、`Fmaj7–E7–Am7–G7`（更 POP）、加 9th 版。
- 用例：Grover Washington Jr.「Just the Two of Us」(1981) 为元祖；椎名林檎「丸の内サディスティック」使「丸サ進行」之名广传；T-SQUARE「宝島」、YOASOBI「夜に駆ける」A メロ、星野源「うちで踊ろう」「アイデア」等；经常与王道進行（F 起手，两者天然亲和）交替使用。
- 情绪定位：**メジャーとマイナーの隙間を縫う浮遊感、おしゃれ・アンニュイ・大人**；在 Galgame 里对应「城市／成熟／微妙的暧昧」，而不是青春期直球。

来源：[nippon.com](https://www.nippon.com/ja/japan-topics/g01096/)、[ongakuroom 10 曲分析](https://ongakuroom.com/just-the-two-of-us_bunseki/)、[mugwort lab](https://mugwort.me/major-minor-tonality-music_297/)、[note 丸サ進行](https://note.com/soundwitches/n/n62d9d7eb0174)、[4fingermusic](https://4fingermusic.com/what-is-chord-progression-understanding-popular-chord-progressions-through-the-mitsuru-method-part-1-just-the-two-of-us-progression/)、[JBG](https://jbg-ongakuin.com/staff-blog/20250807/)

#### 2.1.3 「切ない／泣き」的和声工具箱（伤感与催泪场景的技术清单）

综合日文作曲教学站点的可枚举技法：

**A. 张力音与和弦色彩**

| 元素 | 效果（来源原话/要点） |
| --- | --- |
| `m7` | 柔らかい陰りを作りやすい |
| `maj7` | **記憶や郷愁の雰囲気**が出やすい；Fmaj7 = 回想感 |
| `add9` | 透明感を足す；「言い切れない感情」 |
| `sus4` | **解決前のためらい**；サビ前や終止前の「溜め」 |
| `6th` | 柔らかい色 |
| 三和音のみ | 悲しみは作れるが「言い切ってしまう」 |

（[和音の学び 悲しいコード進行](https://waon-i.com/kg095/)、[和音の学び ノスタルジック](https://waon-i.com/kg131/)）

**B. 进行层面**

- 顺次下行：`Am–G–F–E`（分かりやすい切なさ）
- 分数コード平滑下行：`Am–Am/G–Fmaj7–E7`（しっとりした哀愁）
- 内声下行：`Am–C/G–F–E`（映画音楽的な陰り）
- 末尾放强导音：`Am–G–F–E7`（未解決感の強い痛み）
- 小调定番：`i–♭VI–♭III–♭VII`、`i–iv–♭VI–V`、`i–♭VII–♭VI–V`、`i–v–♭VI–♭III`、`i–iv–i–V`
- 大调里的借用和音：`ivm`、`♭VI`、`♭VII`（「直前まで自然だった景色が少し翳る」）；最实用的单点改动是 `I→IV→iv→I`（サビ終わり、落ちサビ、ラスサビ前）
- **クリシェ**：半音阶内声上行（`E→Eaug→E6→E7`）或下行（`A→AM7→G`），「泣ける」指标性技法
- 「泣ける要素盛りだくさん」复合例（A 大调）：`A → AM7 → G → D → Dm7 → C#m7 → Bm7 → E7` —— 同时含 クリシェ変形、サブドミナントマイナー、♭VII、IIIm→IIm

（[和音の学び](https://waon-i.com/kg095/)、[うちやま作曲教室](https://sakkyoku.info/beginner/cry-chord-progression-pattern/)、[和音の学び ノスタルジック](https://waon-i.com/kg131/)）

**C. 结构与旋律层面（「泣きメロ」）**

- 三大定番を土壌にする，然后**「设计而非发现」旋律**：在 16 分音符的分散和弦里「听出」旋律碎片并口唱拾取；把和弦切换的**头音当「着地点」**，其间自由在音阶上跑。
- 关键：**コードが変わる瞬間の頭の音が着地点**；落点音在构成音内 → 与进行一体；落在构成音外 → 浮游感/紧张感（可刻意使用）。
- **サビに集中させる**：A メロ、B メロ 刻意压低、制造落差，サビ 一気に解放；サビ后半「もう一押し」（改一个和弦、旋律走向意外、节奏崩一点）。
- 旋律配置法：コードトーン中心＝素直；7th 长保＝解けない感情；9th 上伸＝透明な切なさ；少しずつ下行＝泣きの雰囲気。
- 音数**宁少勿多**：「余白があるから印象に残る」，从已有旋律做减法；「動きすぎない」——重复播放时易疲劳。

（[LIVEARTIST](https://liveartist.info/naki-mero/)、[和音の学び](https://waon-i.com/kg095/)、[Level Up Time 作曲家ワークフロー](https://leveluptime.net/archives/492)）

#### 2.1.4 和风／和音阶（和风场景与世界观序章）

| 音阶 | 构成（C 起） | 性质与用法 |
| --- | --- | --- |
| ヨナ抜き長音階 | 大调去 4、7 级 | 日本旋律的底层；「大量日本旋律从民歌到 J-POP 本质上是 yonanuki」 |
| ヨナ抜き短音階 | 自然短调去同样两级 | 同上，暗色版 |
| 平調子 hirajōshi | C–D–E♭–G–A♭（1–2–♭3–5–♭6） | 13 弦箏的标准调弦；两个半音倚靠（D–E♭、G–A♭） |
| 都節 / in 音階 / miyako-bushi | C–D♭–F–G–A♭（1–♭2–4–5–♭6） | 半音直接在根音上方；「桜」音阶 |
| 陰音階 insen | C–D♭–F–G–B♭（1–♭2–4–5–♭7） | 江户期主力；五个音同时按 = **C7sus4(♭9)「Phrygian chord」** |
| 岩戸 iwato | C–D♭–F–G♭–B♭（1–♭2–4–♭5–♭7） | 把 5 级降半音 → 抽掉稳定性锚点，最不安定；夜景/幽灵/不安 |
| 陽音階 yo | C–D–F–G–B♭（1–2–4–5–♭7） | 无半音、最开阔；民俗/祭典；从第 2 级起可拼成纯四度堆叠 |
| 琉球音阶 | （Okinawa 专属） | 冲绳语境专用，不可用于本土日本语境（来源明确警示） |

- 实战写法：**「旋律用音阶提供身份、和声用西洋和声提供运动」**——anime/game scoring 的常见做法是「不全然停在某个音阶里」；音阶给 identity，和弦给 motion；半音与三和弦相蹭是强香料，刻意用之则妙，偶发则不协。
- 传统乐器与音阶的绑定：箏（13 弦，标准平調子，可移动柱 = 换调弦，`oshide` 押弦可临时半音/全音）；三味線；尺八；太鼓。
- 提示词可用要素：`koto` / `shamisen` / `shakuhachi` / `taiko` / `pentatonic` / `hirajoshi` 等（`koto`、`shamisen` 出现在 Lyria 官方乐器关键词表里，见 §4.3）。

来源：[Master the Score](https://www.masterthescore.com/article/japanese-scales)、[Wikipedia In scale](https://en.wikipedia.org/wiki/In_scale)、[Musicnotes](https://www.musicnotes.com/blog/japanese-scales-in-music-theory/)、[Koto scales and tuning (Andô 1989)](https://exa.ai/library/publication/d0hns2mcy7r)、[raagengine Suno Japanese instrumental](https://raagengine.com/suno-prompt-generator-for-japanese-instrumental-music/)

#### 2.1.5 Lydian 与「梦幻／神秘」

- Lydian = 大调升 4 级；与主音形成 tritone，但**主音与纯五度依旧稳定** → 「稳定 + 悬置」的漂浮感；避免强终止解决。
- VGM 中的典型用法：长持续音上的踏板主音、强调 tritone 的琶音、回避终止的和声进行；多用于主角主题、大地图、启示/升级时刻。
- 具名案例：Zelda 主主题（教科书级 Lydian 旋律）；Final Fantasy VII「Aerith's Theme」（Lydian 摇篮曲，升 4 级带来 tragic beauty，和声以平行中音和弦推进）；Chrono Trigger「Corridors of Time」；Genshin Impact Main Theme（**G Lydian / C Lydian**，Hooktheory 归类 stats）；Mario Overworld（局部使用升 4 级）；Elden Ring（现代暗色用法）。
- 另据 Zelda OoT 乐器/音阶分析：「The Lydian Scale — can sound playful, quirky and whimsical; dreamy, spacey, and a bit disoriented」；同一来源把 Yo 音阶描述为 bright, pastoral and yearning（「山村/思乡」）。
- 另：久石让「One Summer's Day」（《千与千寻》）分析指出其统一性来自**四度音程**——四分和弦（quartal chord）、sus4、延伸和弦（m11、maj7(#11)）、moll 五声音阶 4 音组、以及 **Lydian 调式（第 72 小节 Eb Lydian，随后 F Mixolydian、D Phrygian）**。这为「日系梦幻配乐」的和声—配器组合提供了一个可引用的范例。

来源：[music-dictionary](https://music-dictionary.org/music-theory/modes/lydian-mode-video-game-soundtracks-case-studies/)、[Hooktheory Genshin](https://www.hooktheory.com/theorytab/view/yu-peng-chen/genshin-impact-main-theme)、[Video Game Music Shrine Zelda OoT](https://videogamemusicshrine.com/inside-the-score-the-legend-of-zelda-ocarina-of-time-original-soundtrack-title-theme-opening/)、[One Summer's Day 分析 (RSU)](https://rsucon.rsu.ac.th/files/proceedings/intersoc2021/1923_20210514184537.pdf)

#### 2.1.6 转調（世界观序章／终章的高扬手段）

- アニソン的常规手段：后半（大サビ／2 番サビ）做**短 2 度或长 2 度上方转调**，同一旋律瞬时提升亢奋感。
- 剧伴（BGM）反过来要求抑制：「転調やメロディの起伏を抑えめにしてシーンに溶け込ませる」。
- 战斗／暗色场景常用**ハーモニックマイナー**（自然短调升 7 级 → V 变大三，对 Im 的解决感增强 →「緊迫感の中の爽快感」）。

来源：[Core Music School アニメOP 作り方](https://core-ms.net/2026/06/30/anime-opening-composition/)、[Core Music School アニメ音楽の作り方](https://core-ms.net/2026/07/20/anime-music-composition-method/)

#### 2.1.7 「为什么 Galgame 的曲子听起来都还不错」——产业与风格背景

- 知乎答案给出的两点结构性解释（作为产业背景记录，非音乐学结论）：
  1. **公共音乐素材创作者社群（フリーBGM／同人音楽）规模大**：列举 赤堀豊、MUNYOT、全国将軍、Ramine、SENTIVE、ツバサ忍 等，不少作曲家本身运营素材站，使小规模同人作品也能有较高音乐水准。
  2. **长期实践沉淀出「几个调式就能让曲子好听」的一套成熟手法**；该答案同时直指副作用——**严重的同质化，在 galgame 音乐里尤其明显**（「確かに聴きやすいが、個性的でユニークな曲はますます少なくなっている」）。
  来源：[知乎「Why are the soundtracks of Japanese Galgames so good?」](https://www.zhihu.com/en/answer/1867974972)
- 学术侧对 VN 音乐风格的量化观察（Merlini 对 400+ 曲目的元分析）：
  - **「純粋な管弦编曲」在 VN 里被大幅压缩**——如沙耶の唄、Zero Escape／Danganronpa／逆転裁判 初代等，几乎听不到纯管弦。
  - VN 有多个不同的「home styles」（Tagg 2012）；垂直折衷主义比 hyperorchestral 模型更丰富多样。
  - 两个具名对照：Fate/stay night = **「电子节拍 + 管弦」模型**；逆転裁判 = **几乎恒定的 8-bit 音色 + 摇滚节奏组**组合。结论是「与其说存在一种 mukokuseki 音乐，不如说有**多种** mukokuseki 风格」。
  - 产业侧案例：MONACA Studio（岡部啓一创立，2004）展示了动画与游戏配乐在一家工作室内的无缝 polymedia 生产，**eclecticism 是跨作品一贯的特征**。
  - 另一篇（Hybrid Rhythms）提出东西方差异：**西方（好莱坞 transmedia）把离散电子节拍整合进统一的管弦声音；东方（anime 媒体mix）偏好与摇滚绑定的节奏组，且风格矛盾基本不予消解**。
  来源：[Merlini, A Mukokuseki Music? (PDF)](https://air.unimi.it/retrieve/468ee88e-058a-4bce-a880-30cc71091384/%28Paper%20SOS4%29%20A%20Mukokuseki%20Music.pdf)、[Merlini, The Vibes of Cool Opulence](https://www.researchgate.net/publication/393607978_The_Vibes_of_Cool_Opulence_Hybrid_Rhythms_in_Eastern_and_Western_Video_Game_Music)
- 单个 VN 的作曲实操（Steins;Gate，作曲 阿保剛）：主题「Gate of Steiner」以 **E♭ 大调 16 分音符反复音型**开场，加 synth harmony，30 秒处进入「melancholic but heroic」的主要 motif，再叠加 bass 与 synth orchestra ——「wonderful electronica blend」；全片以**未来感电子／techno 为主干**，另有「Suspicious Eyes」（电子 blip 起手，加 percussion、synth chorus、bass，循环前最后一小段用主主题开头小节）、「SERN」（刻意人工音与优美 haunting 人声采样、拟真乐器混合以制造「何为真实」的错位）、「Yanagibayashi」（传统日本乐器 + 现代电子 synth 的融合）、以及「Noisy Times / Walking on Sleeping」等轻快喜剧曲。**「主题在多个曲目中以不同编曲／不同调重现」是 VN 配乐高识别度的核心手法。**
  来源：[VGMO Steins;Gate 评论](https://vgmonline.net/steinsgate/)、[RPGFan The Sound of STEINS;GATE](https://www.rpgfan.com/music-review/the-sound-of-steinsgate-complete/)
- 《グリザイア》／Kajiura 系（动画侧但对「神秘/宏大」场景有参考价值）：梶浦由記的标识性特征是 **modal 音阶、成对的高女声、高音色乐器、folksong-like 元素**，以及「**Kajiurago**」这一自造无意义语言的女声吟唱；她自述自己的风格「primarily rhythmic」，打击乐选择常被听众低估。
  来源：[Mutual Images: Kajiura Yuki and neo-medieval anime soundtracks](https://mutualimages-journal.org/index.php/mi/article/download/119/95)

### 2.2 配器特征

#### 2.2.1 常见乐器清单（按场景气质归类）

| 气质 | 常见配器 | 出处/备注 |
| --- | --- | --- |
| 日系日常／校园 | 独奏钢琴、轻钢琴 + 轻打击 | 素材站对「内向女主角」系列的分类即按此铺 |
| 抒情／告白／回忆 | 钢琴 + 弦乐、钢琴 + 竖琴、钢琴独奏（emotional） | |
| 怀旧／童年／夕阳 | **八音盒（オルゴール）、チェレスタ（钢片琴）、グロッケンシュピール（钟琴）** | |
| 温柔日常 | 尼龙弦吉他 / 原声吉他、钢琴 + 木吉他 | |
| 轻快过场／喜剧 | 明亮钢琴、拨弦弦乐、Glöckchen、尤克里里、口笛/竖笛 | |
| 压抑／悬疑 | 低音钢琴 + 持续弦乐、暗色 ambient piano、小调弦乐、无鼓 | |
| 别离／终章 | 钢琴独奏（慢、稀疏）、弦乐 + 钢琴（bittersweet）、大提琴 | |
| 梦幻／神秘 | 八音盒、チェレスタ、竖琴、Rhodes、synth pad、bells、人声无词吟唱（vocalise） | |
| 和风 | 箏、三味線、尺八、太鼓 | |
| 都市／冷色 | Rhodes / 电钢琴（lo-fi）、synth bass、synth pad | Steins;Gate、城市流行 |

来源：[Vacuous BGM「内向女主角」12 曲分类](https://note.com/good_pansy5184/n/n6e63b42fcc76)（Act 1 病弱大小姐型 = オルゴール/室内楽/アンビエント；Act 2 害羞学妹型 = ライトピアノポップ/アコースティック/Lo-Fi；Act 3 纯真小声型 = フォークポップ/ピアノバラード；Act 4 创伤青梅型 = アンビエントピアノ/ウォームアンビエント/エセリアル）、[Core Music School ゲーム音楽](https://core-ms.net/2026/03/23/dtm-game-music-production/)、[Core Music School アニメ音楽](https://core-ms.net/2026/07/20/anime-music-composition-method/)

#### 2.2.2 关键乐器的声学事实（用于判断「频段是否与人声打架」）

**チェレスタ（Celesta / celeste）**

- 分类：被击奏的体鸣乐器（metallophone），键盘操作，键→毡制小锤→调音钢片→木质共鸣箱。
- 音域：常见四~五个半八度；四八度版本**发声音域一般记作 C4–C8**；是**移调乐器，实际发声比记谱高一个八度**。
- **基频 4186 Hz**（C8）——「one of the highest pitches in common use」。
- 音色：类似钟琴但**更柔和细腻**（celeste 法语「天上的」）；比 glockenspiel 有更圆润、有「glow」的起音；低音区反而「圆、空心、略带木质」，高音区明亮细小。
- 记谱音量不大：「the delicate, bell-like sound is not loud enough to be used in full ensemble sections」——常用来**给其他乐器（长笛、竖琴、钢琴、小提琴）的旋律加一层高音点**，或单独在稀疏织体中承担旋律。
- 与 glockenspiel 的听辨差异：glockenspiel 用硬槌、定音金属棒，**更硬、更穿透**，可在密集配器中保持可闻；celesta 是毡锤 + 共鸣箱，**更柔、更易融合**。
- 在配器史中的语义：柴可夫斯基《胡桃夹子》「糖梅仙子之舞」= 奇幻；Holst《行星》「Neptune」= 宇宙神秘；Bartók《为弦乐、打击乐与钢片琴而作》= 阴森、梦魇（影响了后来的电影配乐，如《闪灵》）；Ravel《鹅妈妈》= 童年梦幻；Shostakovich 第五末乐章 = 脆弱、反讽。

来源：[Wikipedia Celesta](https://en.wikipedia.org/wiki/Celesta)、[BBC Classical Music](https://www.classical-music.com/features/instruments/celesta)、[InstrumentHeritage](https://instrumentheritage.com/celesta-instrument/)、[instrumentsounds.org](https://instrumentsounds.org/instruments/celesta/)

**八音盒／オルゴール（music box）**：不是一个被广泛引用的单一乐器规格，但上述来源一致把「music box / celesta / glockenspiel」并列作为「日系怀旧与梦幻」的标配音色组（[本项目既有 skill `galgame-bgm` 亦如此归类](../../../apps/server/skills/galgame-bgm/SKILL.md)）。工程上需注意：**八音盒与钢片琴都带长衰减的金属泛音**，在循环接缝处会形成「尾音被硬切」的问题（见 §2.4）。

#### 2.2.3 Key 社 / Key Sounds Label 的配器与写作惯例（日系 VN 配乐的典型样本）

- 阵容：Jun Maeda（麻枝准）、Shinji Orito（折戸伸治）、Magome Togoshi（戸越まごめ）为 Key 的招牌作曲家；Togoshi 于 2006-10 退社。
- 观察到的写作习惯（粉丝社群技术性总结，非学术）：
  - 折戸伸治早期**常用小提琴弦做 drone（持续音）**——ONE、Kanon「Hidamari no Machi」、Air「Nomichi」等；后期减少。
  - 折戸伸治的另一习惯：**写情感强烈的钢琴（或八音盒）曲，然后混入鼓的节奏型**——「而且居然成立」；ONE「Tsuisou」、Kanon「Kaze o Matta Hi」、Air「Kawa」、Clannad「Shionari」。
  - 麻枝准的「痛切」曲常**呈克制（restrained）**；他喜欢在节奏上做实验。
- 音响层面的世代对比（乐评）：Kanon/Air/Clannad 三作**以 Piano、Strings、Acoustic 乐器为主，没有过度使用 synth**；反例 Angel Beats! 因依赖 synth 而被评「听起来像 RPG，不像 visual novel」。
- 具体曲目形态（对一个文化现象级 VN 的逐曲描述，可用于校准「场景→配器」的映射）：
  - Clannad「Ushio」= 温柔钢琴独奏开场；「Her Determination」= breathy synth + 电吉他（元气少女感）；「Like the Wind」= 轻快、复杂旋律；「A Couple of Idiots」= 木琴（xylophone）定调「傻气」；「Spring Wind」= 傻气开局→霓虹感的怀旧旋律；「The Place Where Wishes Come True」= 第一版**八音盒**、第二版后半转弦乐；「Distant Years」= 钢琴版 / 弦乐版；
  - Jun Maeda「Nagisa」= 慢、试探、脆弱起手 → 主旋律处「希望与悲伤并存」；结尾变奏「Nagisa ~ Farewell at the Foot of the Hill」「Tiny Palm」（接 riya 人声，间或回首原主题）；「Country Train」= 背景列车声 + 轻快钢琴与弦乐。
  - 明确指出**「TOE」是少数不 loop、以钢琴收尾的曲目**——说明 VN 原声里也存在「不循环、有明确终止」的例外（用于剧情高潮）。
- 方法论要点（社群评价中西方作曲家 Kevin Penkin 的 VN 写法，可作为「VN BGM 好在哪里」的正面清单）：**strong, simple melodies; resounding harmonies and counter-melodic strains; great, varied instrumentation among classical instruments (including East Asian instruments); strong theming and "musical narration"**；同一评论同时指出全合成管弦的**音色平坦（flatness）是唯一可批评点**——与 §2.3「平坦动态」形成有趣对照（此处指音色缺乏动态层次，非音量动态）。

来源：[Kazamatsuri 论坛 KSL Composers Topic](https://forum.kazamatsuri.org/t/ksl-composers-topic/2825)、[Chikorita157 的 Key 音乐观察](https://chikorita157.com/2010/08/25/the-observation-of-music-from-keys-visual-novels/)、[Wikipedia Key Sounds Label discography](https://en.wikipedia.org/wiki/Key_Sounds_Label_discography)、[VGMO Clannad OST 评论](https://vgmonline.net/clannad/)、[Anime Instrumentality Jun Maeda 专题](https://blog.animeinstrumentality.net/composer-profiles/composer-of-the-month-jun-maeda/)、[RPGFan Jyuzaengi 评论](https://www.rpgfan.com/music-review/jyuzaengi-engetsu-sangokuden-original-soundtrack/)

#### 2.2.4 编配密度原则（来自实务委托方的明确要求）

- 劇伴（含 VN BGM）的最大原则：**「主役になりすぎない」**——与台词、影像同时存在。
- 技术手段：**转调与旋律起伏压到较低**；**旋律音域收窄（如 A4–E5 一个八度内）、避免大跳，写成「歌わないメロディ」**；以「コード感で感情を作る」而非靠旋律抢戏。
- 一份 VN 用途的策划实践：**1–2 小时的 VN 约需 10–20 首 BGM**；另一份委托方口径：**短編ノベル 3–5 曲 / 5–8 曲，中編〜長編 10–20 曲**；「最低限そろえたいのは タイトル、日常、シリアス、回想、エンディング の 5 系統」。
- 曲长与循环：VN「1 曲あたりの再生時間が長くなる。ここでケチると同じ曲を 10 分聴かせることになり、確実に飽きられる。曲数を絞るなら、代わりに 1 曲のループを長めに作るのが正解」；游戏 BGM 循环长度参考：バトル 1–2 分、ボス 2–4 分、フィールド/探索 2–4 分、街 1–2 分、メニュー/タイトル 30 秒–1 分。（[Core Music School](https://core-ms.net/2026/03/23/dtm-game-music-production/)）
- VN 素材方的实际产物：一包 12 曲、每曲 **5–8 分钟循环构成、60–108 BPM、WAV 44.1kHz、首尾 texture 一致以支持 seamless loop**；明确说明「繊細なピアノやアコースティックギターが思考を邪魔しない」。（[Vacuous BGM Vol.06](https://note.com/good_pansy5184/n/n6e63b42fcc76)）
- 委托规格书的「最小 5 项」：**使用シーン・尺・ループ有無・参考曲・避けたいもの**；其中**「避けたいもの」最能减少返工**（例：「金管の派手なファンファーレは不要」「ボーカルは入れない」）。（[Level Up Time 発注チェックリスト](https://leveluptime.net/archives/1246)、[BGM発注仕様書の書き方](https://leveluptime.net/archives/1226)）

来源：[Core Music School アニメ音楽](https://core-ms.net/2026/07/20/anime-music-composition-method/)、[core-ms ゲーム音楽](https://core-ms.net/2026/03/23/dtm-game-music-production/)、[Level Up Time 曲数目安](https://leveluptime.net/archives/1225)、[Level Up Time 作曲家ワークフロー](https://leveluptime.net/archives/492)、[そらまにあ SE/BGM 素材探し](https://soramania.com/game-production-se-bgm/)

---

### 2.3 视觉小说核心配乐约束

#### 2.3.1 人声避让：为什么中频人声区必须留白

**（a）频率掩蔽的物理机制**

- 人的**语声清晰度（intelligibility）强烈依赖 1–4 kHz**（辅音能量集中区）；语声的**「体感/厚度」在约 120–300 Hz**（随声型与近讲效应变化）；**无声音素（/s/、/f/、/ʃ/ 等摩擦音）为宽带噪声，常峰值于约 4–10 kHz**。游戏里台词常常与密集 SFX 和音乐床共用这些频带，**「掩蔽是默认的失效模式」**。（[SonusGearFlow: Vocal Production for Game Audio](https://sonusgearflow.com/musicproduction/vocal-production-for-game-audio-production)）
- 另一来源给出相近数字：**人的話し声主要信息在 1–3 kHz**，而吉他、钢琴、合成器等**旋律乐器在同一频带也有强能量**——「音量下げても同じ高さの音が同時に鳴っていることで、声の輪郭が打ち消される」。（[BGMer](https://bgmer.net/bgm-ducking-eq-guide/)）
- 视频制作侧的表述：**对白与音乐的冲突「多数是因为音乐的中频太忙，或音量本身太大」**；即使音量压低，只要音乐里有一个「扛旋律」的中频元素，就会与对白形成 frequency masking 与 acoustic competition；**有人声音乐会使冲突加剧**。（[Riot Anthem Studios](https://riotanthemstudios.com/blog/why-your-background-music-fights-your-dialogue-and-how-to-fix-it)）
- 更细的数字：人声**清晰度相关频带约 250 Hz–4 kHz**（一说 250Hz〜4kHz 是「声的带域」）。（[note 星野メロ](https://note.com/hoshino2/n/b314e3240b9f)、[小林将大](https://kobatee.jp/blog/auto-article-2025-08-25/)）
- 游戏音频工程侧对 sidechain/ducking 的量化建议：
  - 典型增益衰减 **~3–9 dB**，峰值可放到 10–12 dB；
  - attack **3–8 ms**、release **250–500 ms**（避免 word-to-word pumping）；
  - sidechain 高通 **100 Hz** 左右（避免低频触发无谓 ducking）；
  - **多带 ducking**：低频 20–120 Hz 几乎不动（0–2 dB 保音乐重量），**中频 120 Hz–4 kHz 主 duck（3–10 dB）**，高频 4–16 kHz 轻 duck（1–4 dB）；
  - **按 stem duck**（旋律/和声/打击），只压与人声竞争的那一层；
  - 「超过某个点后，更多 gain reduction 并不提升清晰度，只会让音乐听起来不稳定」，**频率选择性处理优于全带压缩**。
  （[SonusGearFlow: Sidechain Compression for Game Audio](https://sonusgearflow.com/musicproduction/sidechain-compression-for-game-audio-production)）

**（b）可直接抄的 EQ 配方（多来源并列）**

| 来源 | BGM 侧处理 | 人声侧处理 |
| --- | --- | --- |
| Riot Anthem Studios（YouTube 实操） | **1 kHz 处 cut 8–10 dB（中宽带）**；整体推子压到约 **-24 dB** | 对白 **2.5 kHz 提 3–6 dB** |
| BGMer（日文音響処理指南） | **1.5–2.5 kHz 缓坡 dip 2–3 dB**；**100 Hz 以下高通** | — |
| なまずわーくす（对照实验） | BGM 整体约降 **11.8 dB** 后仍可能「抢戏」；进一步**去掉旋律层与和弦最高音**（保留低音与鼓）来控制「音数」 | — |
| kobatee（旁白混音） | BGM 存在感随段落变化；**不只调音量，也调带宽**；建议用 ducking 或 dynamic EQ 而非大幅 EQ | 先把旁白单独调清楚 |
| note 星野メロ | BGM 约 **-18 至 -24 dB**（旁白峰值 -6 dB 时）；**声与 BGM 差 12–18 dB**；ducking 降 **-6 dB**、恢复 **300–500 ms** | — |
| Ren'Py 社区（游戏内建机制） | `preferences.emphasize_audio = True`，`config.emphasize_audio_volume = 0.9` —— **有声时其他音频整体降到 90%**，「不希望被察觉」 | 音量归一化（voice 默认 **-16 LUFS**），响度排序 **SFX > Voice > Music > Ambience** |
| SonusGearFlow（工程侧建议） | 对白 bus 键控音乐 mid stem 约 6 dB 衰减 + 全带 1–3 dB 兜底，attack ~5 ms / release ~400 ms | 语音 EQ：高通 60–100 Hz、消除 200–400 Hz boxiness、presence 区小提 1–3 dB + dynamic EQ，去齿音 5–8 kHz 减 2–6 dB |

**（c）与「日系 Galgame 配器」的直接推论**

- 该留白的频段正好是**钢琴中音区、木吉他、弦乐中音区、Rhodes、synth lead** 的主战场——这解释了为什么 VN 的标准配器是「**单件独奏 + 少量铺底**」，而不是完整乐队/全管弦（后者会把中频填满）。
- 也解释了 Riot Anthem 的结论：**「选无聊的音乐」**——「No trumpet solos, no vocals, no loud synths. Choose repetitive music, or find the part of a piece of music where minimal elements are poking through at the midrange, and loop that section.」
- 以及一份「旁白前提下的 BGM 选曲清单」：**主旋律不要太强、中高频不要过密、展开不要太激烈、不与语速打架、信息型内容节奏要整齐**。（[kobatee](https://kobatee.jp/blog/auto-article-2025-08-25/)）

**（d）跨媒体对照：游戏内其他音源**

- 不只是人声：**UI 音效、环境音、脚步声与 BGM 的调性冲突**也会累积成「nuisance score」。Bjørn Jacobsen 的实测案例：**音乐在 Am，房间音在 A#/B♭（Am 里没有 B♭）**——19 名玩家的对照里，**听到不协和版本的人平均早 1–2 分钟退出**。（[A Sound Effect: How to maintain immersion](https://www.asoundeffect.com/game-audio-immersion/)）
- Galgame 侧的实作口径：**SFX 最响、Voice 次之、Music 再次、Ambience 最轻**；voice 单独做压缩 + 限幅 + 响度归一化（因演员录音天然不稳），音乐与 SFX **不做无谓压缩**；ambience 额外加高通（避免「台风里打电话」的听感）。（[CuteShadow: Audio Mixing VA for Ren'Py Dummies](https://cuteshadow.itch.io/tokidoki-tactical-squad/devlog/1083680/audio-mixing-va-for-renpy-dummies-me)）
- 反例参考：一条 Ren'Py 混音经验明确反对「用 mixer 默认值来补偿素材响度不齐」——**默认值留给玩家**，自己的素材要在导出前对齐。（同上）

#### 2.3.2 动态曲线：为什么不能有突兀的影视高潮／爆音

**（a）循环语义下「高潮」是缺陷而非亮点**

- 若一首 BGM 的用途是「长时间垫在对话下」，每次循环都会在**同一个位置**再次爬坡 → 玩家记得住那个「涨起来的地方」，疲劳与出戏随之产生。
  - 素材与工具方的操作口径：`consistent dynamics throughout`、`no dramatic build`、`no drop`、`no risers/whooshes`、`flatten the peaks`；「Dynamics is the whole game for a bed. You want a track that plays at one polite volume from start to finish.」（[SunoGuide instrumental](https://sunoai.uk/en/guides/suno-instrumental-prompts/)、[SunoMarket YouTube BGM](https://sunomarket.com/blog/suno-for-youtube-background-music)、[MusicSmith 提示词最佳实践](https://musicsmith.ai/blog/ai-music-generation-prompts-best-practices)）
  - Suno 游戏 BGM 指南：探索区/菜单 BGM **必须无缝循环**，Style 里加 `seamless loop, consistent rhythm, no long intro, no fade out`，验收标准是**连播 5 遍无跳拍/无咔哒、循环段无突然加鼓或撤乐器**；「整首含 intro 循环」被列为实测失败项。（[Suno.ing 独立游戏配乐实战](https://suno.ing/zh-cn/blog/suno-indie-game-soundtrack-guide/)）
- 游戏配乐长度—重复次数与耐受度的量化模型（Marcelo Martins）：理想是 **音乐长度 ≥ 单次游玩时长（Gameplay Time）**；若音乐长度为游玩时长的 50%（重复 1 次），多数玩家可接受；**重复 3–5 次开始令人厌烦，超过 5 次是最差情形**。对策（可在提示词层面部分表达）：部件顺序反转、**旋律静音版与含旋律版交替**、插入静默、随机播放列表、可扩展结尾（expandable end）。（[Gamasutra/Game Developer: Rethinking the audio loop in games](https://www.gamedeveloper.com/audio/rethinking-the-audio-loop-in-games)）
- 游戏作曲家的实务要求：「メロディは動きすぎない——動きが多いメロディは最初の数回は新鮮でも繰り返すうちに疲れてきます。特にループするゲームBGMではそれが顕著」；「音数を絞る……余白があるから印象に残る」；长时间播放的 BGM 尤其要「プレイヤーへの配慮」。（[Level Up Time 作曲家ワークフロー](https://leveluptime.net/archives/492)）
- VN 委托方的具体返修意见示例（真实对话记录）：「0:41、1:06、1:45 の辺りもっと溜めて、更にドラマチックに感情描いてもらいたい」——同时作者附注：**「BGM での溜めはリズムが崩れるので使いづらいテクニック。こういうピアノソロだと使っても問題なかった」**，并强调**「使いすぎたり長すぎたりするとダメ。BGM の方に気を取られちゃうと、メインの物語に集中できなくなる」**——即：BGM 允许的「戏剧性」量是有上限的，且与配器密度（钢琴独奏 vs 有节奏组的曲子）相关。（[恒石涼平 美しょゲを作ろう BGM編d](https://note.com/ryodist/n/n4bd037e012de)）

**（b）突然的大音量在心理声学上的直接后果**

- 生存恐怖游戏的实验与传统结论：**「a loud sound with an immediate attack, presented in a previously quiet or silent environment, will always evoke a comparable shock response」**——即爆音的惊吓与语义无关，是物理参数驱动的。（[Garner 博士论文, Aalborg](https://vbn.aau.dk/ws/portalfiles/portal/549530933/Tom_Garner_13.pdf)）
- 音量与恐惧/焦虑的对照实验：音量越高恐惧评分越高（低音量的 Likert 均值 2.0 → 中 2.3 → 高 2.8）；**「音效与冲击点在静默之后最有效」**；相反，**中低音量、随机时机、无明确声源**的声音更能制造持续的焦虑感。（[Abdelmeguid 论文](https://ahmedam.com/wp-content/uploads/2017/12/abdelmeguid_thesis.pdf)、[Garner 预实验报告](https://vbn.aau.dk/ws/portalfiles/portal/61575828/a_preliminary_experiment_MG.pdf)）
- 因此对于「垫在阅读文本下的 BGM」：**突兀的爆音会把玩家的注意力从文本上拽走**，而低到中音量、无明确「事件感」的持续性纹理才是 VN 需要的形态。

**（c）响度与峰值（VN 实测数据，可直接用于校准）**

VNDev Wiki《Balancing a Game's Loudness》给出的实测表（2020-12-21 前后，默认音量设置下）：

| 作品 | 播放时长 | 默认音量 | 实测 LUFS | 备注 |
| --- | --- | --- | --- | --- |
| Fate/stay night Réalta Nua (Windows) | 2:30 | Music 70% / SFX 90% / Voice 100% | **-12 LUFS** | 削波严重（4.1 dB），未含 OP 与 Vita 版 OST patch |
| Muv-Luv Extra (Steam) | 2:05 | Master 100% / Music 50% / SFX 43% / Voice 90% | **-17.5 LUFS** | OP 单独为 -12 LUFS（不计入）；语音响度不齐 |
| Doki Doki Literature Club (Steam) | 2:30 | ~75% | **-23 LUFS** | 极稳定、无削波；作者 Dan Salvato 称纯凭耳朵对齐 |
| One Night Stand | 每次 ~0:12 | 100% | **-23.5 LUFS** | 三次平均（-24 / -22.5 / -24.5）；弹吉他动作会明显抬高 LUFS |
| Danganronpa V3 (Steam) | 4:50 | 50% | **-24.8 LUFS** | 学级裁判段落比其他部分更响（-25 → -24.7） |

同页其它硬性事实：

- **anchor element**（锚定元素）= 观众用来设音量的参照，通常是**对白**；无对白时为音乐。
- **峰值不应超过 -1 dB**（多音源叠加如音乐+SFX+语音容易越界）；SNES 官方开发手册里已有该问题的记载。
- 测量建议：至少半小时、最好 1–2 小时以上的游玩片段，且**安静与喧闹场景按比例取样**；VND 因响度较一致，取样时间可短。
- 若整段 LUFS 偏高/偏低，**对所有素材同幅调整**（降 1 dB = 降约 1 LUFS）。
- 无障碍相关建议：开局前提供音量设置、分开的 master/SFX/music 控件、字幕默认开启、提供降低中高频的 EQ 预设等。

来源：[VNDev Wiki Balancing a Game's Loudness](https://vndev.wiki/Guide:Balancing_a_Game%27s_Loudness)

**游戏 BGM 的 LUFS 目标（多个独立来源）**

| 来源 | 目标值 |
| --- | --- |
| Suno.ing 独立游戏配乐 | **-16 ~ -14 LUFS** integrated，「留余量给音效叠加」；战斗 BGM 可高 1–2 dB，但**不超过 -12 LUFS** |
| 某独立游戏 AI 音乐指南（中英文版） | 同上（-16 ~ -14 LUFS），并提醒直接导出 -8 LUFS 会与 UI 音效叠加削波 |
| 日本游戏音乐作曲家 | 「ゲーム用途は -18〜-16 LUFS 前後、映像用途は -12 LUFS 前後が目安」 |
| Suno/Godot/Unity 落地建议 | Unity/Godot -16 LUFS；Unreal -14~-16 LUFS；Web (Howler) -14 LUFS |

来源：[Suno.ing](https://suno.ing/zh-cn/blog/suno-indie-game-soundtrack-guide/)、[技术栈：独立游戏 AI 音乐指南](https://jishuzhan.net/article/2050171520824180737)、[Level Up Time](https://leveluptime.net/archives/492)、[AI 工具指南 Suno 游戏 BGM 模板](https://aitoolsguidebook.com/zh/articles/suno-game-bgm-prompts/)

**（d）「安全音乐 vs 威胁音乐」的对照表（学术侧对恐怖/悬疑用乐的定义，可直接反推负向词）**

Mireault 对《寒蝉鸣泣之时》的研究给出「safe music」与「threatening music」的特征对照：

| 维度 | 安全音乐（safe） | 威胁音乐（threatening） |
| --- | --- | --- |
| 旋律/和声 | 可辨识的旋律与和声 | 不协和和声、半音阶化 |
| 节奏 | 规整节奏 | 不规则节奏、ostinato |
| 音色 | 合成的原声乐器（钢琴、吉他） | 极端音区与极端力度、「不自然」音色（弦乐 sul ponticello、电子音）、音高不可辨的织体 |
| 动态 | **unchanging dynamics（不变的动态）** | 极端力度对比 |

同一研究还指出：**VN 的音响语码以「loop 与硬切」为基础**——「音乐与影像的关系…以 loop 为枢纽，重复同时制造出连续织体与硬切（hard breaks）」；这被作者认为**挑战了游戏音乐学界「硬切属于 1980 年代技术限制」的叙事**，因为视觉小说是当代媒介却仍普遍使用带硬接缝的循环与最少的接缝处理。（[Mireault, No slaughter without laughter? music and genres in Japanese popular media, 摘录](https://exa.ai/library/publication/4n6dxdfx1gm)）

同源的另一条实务结论（Simon Wood 的 ambient piece 定义）可直接引用：「**ambient pieces** 是为情感反应而创作的低调音乐；这类音乐给作曲家的特定挑战是**不能烦人、不能无聊**，因为它可能在游戏中长时间播放。达成方式之一是**把 loop 藏起来**。」（同上）

---

### 2.4 无缝循环与 Loopability 的声学结构要求

#### 2.4.1 音乐结构层（作曲家侧）

来自 DTM/游戏音乐实务与 VN 素材方的做法：

1. **同和弦起止**：曲子的第一个与最后一个和弦相同（例如 Cm 起就 Cm 收）——「これだけでループ時の違和感が大幅に減る」。
2. **禁止淡出**：不能像普通歌曲那样 fade out 收尾；最后也要维持音量，否则循环时「音量が急に上がって不自然」。
3. **注意混响尾巴（リバーブテイル）**：末尾残留残响会在循环点被切断；要么调短 decay，要么把 loop point 设在残响消失之前。
4. **循环点对齐小节头**：多数引擎可按小节指定循环点；在拍中间循环会不自然。
5. **イントロ与循环部分分离**：只播一次的 intro 与之后反复的 body 分开导出（业界常见做法）。
6. **首尾 musical 素材呼应**：Winifred Phillips 的建议被引用为「**以同样的音结束与开始循环，并保证（至少循环末尾的）混响时间足够短，避免多个音重叠到开头**」。（[natecombsmusic 关于游戏音频循环的技术帖](http://natecombsmusic.blogspot.com/2015/02/video-game-audio-how-to-make-smooth-and.html)）
7. **旋律装饰音（cymbal swell、bells、chime）要小心**：它们自身衰减很长，会与残响尾一起成为循环接缝的麻烦；「这也是为什么 loop 通常不带上拍（upbeats），尤其是旋律性上拍」。（同上）
8. **不要有线性推进**：音乐太「线性」时，重复几次就能听出接点；要求「可循环的结尾、无长 fade-out、无破坏重复的最终冲击、稳定 groove」。（[Make A Song AI 游戏音乐指南](https://makeasongai.com/zh-TW/blog/ai-music-for-games)）

#### 2.4.2 混响尾巴与「folded tail」（工程层，AI 生成曲目尤其相关）

- 现象：单声部循环引擎（RPG Maker、GameMaker）在文件末尾**瞬间跳回开头**；若末尾有 reverb / delay / 或仍在延音的音符，ring-out 被切断 →「房间瞬间消失」+ 开头干声落在空洞上。
- 三类解法：
  1. **two-voice tail overlap**：在循环点让上一遍的尾音继续响，同时启动下一遍（需要引擎支持双声部；Unity/Godot/Web 可做）。
  2. **folded tail（把尾巴折进开头）**：把越过循环点的尾音渲染出来，**混进循环主体开头**——这样硬跳时「尾巴本来就在」，即便单声部也听起来连贯。（Loopsmith 的 RPG Maker preset 会在需要时自动选择该模式）
  3. 手工法（老教程）：把尾音剪到另一轨、放到序列开头；代价是「第一次播放」时会出现半截 cymbal swell 之类的怪现象，须单独给尾音轨加 fade。
- 一个同源判断标准：**「如果音乐在循环末尾是干的（dry），硬跳就完美；只要有 reverb、delay 或越过循环点的延音，就会出问题。」**

来源：[Austin Haynes: RPG Maker Loops Music Seamlessly](https://www.austinhaynesmusic.com/rpg-maker-music-loops)、[Loopsmith 开发日志：Why Reverb Tails Break at Game Music Loop Points](https://austinhaynes.itch.io/loopsmith/devlog/1581065/why-reverb-tails-break-at-game-music-loop-points)、[Loopsmith 1.2.0](https://austinhaynes.itch.io/loopsmith/devlog/1570962/loopsmith-120-seamless-single-file-loops-and-a-way-to-prove-they-loop)、[ModDB: Making A Loop 'Loop' Better](https://www.moddb.com/tutorials/making-a-loop-loop-better)、[natecombsmusic](http://natecombsmusic.blogspot.com/2015/02/video-game-audio-how-to-make-smooth-and.html)

#### 2.4.3 循环元数据（文件格式层）

| 标签 | 语义 | 使用者/生态 |
| --- | --- | --- |
| `LOOPSTART` / `LOOPEND` / `LOOPLENGTH` / `LOOPCOUNT` | Vorbis comment；`LOOPEND` 为**排他**终点；`LOOPLENGTH = LOOPEND - LOOPSTART`（样本数）；`LOOPCOUNT` 默认无限 | SDL_mixer / SDL3_mixer（Ogg、Opus、FLAC 都识别）；RPG Maker MV/MZ 读 `LOOPSTART` + `LOOPLENGTH` |
| `LOOP_START` / `LOOP_END` / `LOOP_BIDI` | ZDoom 定义的 Vorbis comment 标准（FOMM/FOMM-used），被 Crispy Doom 等跟进实现 | ZDoom/FMOD 生态（.ogg 与 .flac） |
| WAV `smpl` chunk | 采样点元数据；**只有 WAV 支持** | 通用音频编辑器 / 部分引擎（Unity 从 WAV 读，但有一个导入设置会破坏它） |
| `LOOP_MIX` | 把循环点之后的音频混入每遍循环的开头（即 folded tail 的元数据化） | loop-ogg 工具支持，「我只见过一次实际用例」 |

细节事实：

- 时间值的两种写法：**采样索引**（纯整数）或 **MM:SS[.mmm]**；两种标准对歧义的处理不同（loop-ogg 会把「整数且 ≥ 采样率」当作误写而按采样数解释）。
- 兼容性建议（面向 FLAC）：**循环区放在文件末尾、同时给 `LOOP_START` 与 `LOOP_END`、全大写加下划线、用采样索引而非时间、并在文件外另记循环点**。
- **RPG Maker 只认 OGG**（不是 MP3/WAV/M4A），且**任何重编码/重导出都可能静默丢掉标签**——「tagged OGG 应该是送进 bgm 目录前的最后一站」。
- **数值必须采样级精确**：差几个样本就会在波形中途跳转，每次循环都产生 click。
- Ren'Py 侧的等价机制不在文件元数据里，而在**文件名内联指令**：`<from X loop Y>` 指定首遍起始位置与后续循环起点（可用于「一次 intro + 循环 body」）；并有 `synchro_start` 让多通道同时启动（用于多层循环曲的层间同步）。

来源：[bgm13.com: Looping with Vorbis metadata](https://bgm13.com/posts/vorbis-loop.html)、[SolraBizna/loop-ogg](https://github.com/SolraBizna/loop-ogg)、[Austin Haynes](https://www.austinhaynesmusic.com/rpg-maker-music-loops)、[Crispy Doom 的 LOOP_START/LOOP_END 实现 patch](https://code.idtech.space/crispy/crispy-doom/commit/797a9a563b2e90849bc6eb79169a9381896eeb15.patch)、[Ren'Py Audio 文档](https://www.renpy.org/doc/html/audio.html)、[Solarus 论坛：Creating Seamless OGG Music Loops 教程](https://forum.solarus-games.org/en/index.php?topic=1390.0)

#### 2.4.4 引擎层与「循环曲的可变性」（VN 专有的增强手段）

VNDev Wiki《Guide:Dynamic audio in visual novels》（作者 FulminisIctus，2023 VN;Conf 演讲、2025 重写）系统整理了 VN 可用的动态音频手段：

- **音频替换（audio replacement）** 的过渡方式：sudden stop/start、fade out/in、crossfade、transition（在旧曲尾部无缝贴一个乐句使其「收束」）、以及组合与延迟。**注意「crossfade 若两首曲子的调或速度差异太大，长 crossfade 反而会把问题放大」。**
- **音频操纵**：pitch、speed、volume、panning、**notes 操纵（MIDI/MOD）**、**vertical change（垂直重配/分层）**、**horizontal change（水平重排）**、各类效果（reverb/EQ/echo，按情境调强度）。
- **分层曲的工程实现**（社区实践，Ren'Py）：歌曲拆成多层各自导出 wav，**长度必须完全一致**（即使某层是静音段），全部用 `synchro_start=True` **同时起播、全时运行**，然后用 `set_volume` 做交叉淡变来改变情绪强度——「只是让它们在后台跑，就能让所有过渡无缝，比计算时间戳简单得多」。（[com__et 的 Ren'Py 动态音频教程](https://itch.io/devlog/548526/how-to-add-dynamic-audio-in-renpy-its-easier-than-you-think.amp)）
- **chance-based 音频**：随机容器（多个变体随机取值、禁止连续重复、加权）、音轨内随机容器（每次循环随机选演奏旋律的乐器）。
- **VN 中动态音频的四类收益**：seamlessness & immersion、variability（降低重复感）、relaying information（信息传递更细腻）、intensifying emotions（不换曲而加强情绪）。
- **可对标的既有 VN 案例**：*Doki Doki Literature Club* 的「Okay Everyone!」**按正在读谁的诗改变配器**（实现方式为切换不同版本而非淡入淡出层）；*I'm Just Here to Change the Lights* 按在场角色改变配器；*Usagi Syndrome* 有钢琴谜题（玩家交互触发音符）。作者的 *_Mycorrhiza_* 里：第一扇门的吓人铺底 = **6 层 ambiance + 2 层鼓**按情境混合；街区主题 = **3 个钢琴 pattern × 3 个鼓 pattern × 5 个旋律 pattern（其中一个完全静音）**随机组合，且「较高的第三钢琴层不能连续出现两次」；墙裂声 = 4 个不同音效 + 1 个静音文件，**静音出现概率 50%、每个音效各 12.5%**（制造更长的静默期）；第三扇门的「insanity」变量每升一级就把钢琴和弦层替换为更不协和的版本（共 8 版），并在**小节末尾**才无缝切换。
  来源：[VNDev Wiki: Dynamic audio in visual novels](https://www.vndev.wiki/Guide:Dynamic_audio_in_visual_novels)、[com__et](https://itch.io/devlog/548526/how-to-add-dynamic-audio-in-renpy-its-easier-than-you-think.amp)

#### 2.4.5 「AI 生成 + 循环」的现实约束（综合多来源的操作结论）

1. 主流生成模型（Lyria 3.5 / Suno / Udio / MusicGen）**都不输出循环点元数据**，也不接受「循环起点/终点」参数；只能靠提示词表达「可循环的曲式意图」，再用 DAW 剪到小节线。
2. 生成结果的**默认形态是「一首歌」**——有 intro、有 fade out、有高潮；这与 BGM 需求**结构上冲突**。Suno 游戏 BGM 指南把「用流行歌结构做 loop」列为最先踩到的坑，并给出四步法：**生成时预埋 → 选节奏已稳定的 8–16 小节种子段（约 15–30 秒）→ Extend 补长 → Studio/DAW 精修（复制核心段、对齐节拍点、删除首尾 fade）**。
3. **时长不可控**的实测记录（本项目上下文）：Lyria 经本机 flow2api 网关实测固定返回约 **176 秒**，且 `generationConfig` 的音频字段是否被识别未能测出（该轮遇到令牌池 503）；因此「时长与循环意图只能靠提示词表达」。详见 `docs/features/261005-music-generation/261005-music-generation.plan.md`。
4. Suno 侧的能力与限制：Loop Mode 可生成可重复内容，但仍需人工找循环点；探索与战斗 BGM 建议**共用和弦进行或 BPM 倍数关系**（如 90 vs 180 BPM 双拍）以便引擎内切换；crossfade 时长建议：探索→遇敌 0.3–0.5 s、战斗→探索 1–2 s、探索→Boss 0 或 0.2 s、菜单→游戏 1 s。
5. MusicGen 侧：单次生成上限约 **30 秒**（1503 tokens，受 sinusoidal positional embedding 限制；若给 audio prompt 还要占用额度），需要靠 **continuation 链式续接**做长；且评分模式（sampling）优于 greedy、默认 `guidance_scale=3` 效果最好；官方明列局限包括「不能生成真实人声」「训练数据为英文描述」「不同风格/文化表现不均」「有时会生成歌曲结尾而塌缩到静音」「文本描述与最佳生成之间的关系难以评估，可能需要 prompt engineering」。

来源：[Suno.ing](https://suno.ing/zh-cn/blog/suno-indie-game-soundtrack-guide/)、[MusicGen HF 文档](https://huggingface.co/docs/transformers/main/model_doc/musicgen)、[MusicGen 模型卡](https://huggingface.co/facebook/musicgen-medium/raw/76ea784ec523f4c389edf358b127a6bc02a62a52/README.md)、[MusicGen Prompt Guide](https://geratools.com/musicgen-prompt-guide)、[docs/features/261005-music-generation/261005-music-generation.plan.md](../../261005-music-generation/261005-music-generation.plan.md)

## 3. 场景化音乐风格矩阵

### 3.0 矩阵的使用说明与共同约束

**每格给出的七个字段**

1. **戏种定义**：这个场景在 VN 里承担什么叙事功能
2. **和声与调式**：可用的进行/调式（供创作者与提示词「和声色彩词」参考；**绝对不要把罗马数字或和弦名直接喂给生成模型**，见 §4.1）
3. **配器**：主奏 + 铺底
4. **节奏与 BPM**：有据可查的数值区间
5. **动态与循环**：该场景是否循环、允许的动态幅度
6. **英文提示词**：分 Lyria 版与 Suno 版（两版差异见 §4.1）
7. **避坑**：这一格最容易踩的陷阱词

**三类共同约束（每一格都适用，不再重复）**

- **必须有**：`instrumental only, no vocals`（或 Suno 侧开 Instrumental 开关 + Exclude 填 `vocals, singing, humming`）、`seamless loop`（循环场景）、`consistent dynamics`、`background music under dialogue, keeps the foreground clear`。
- **必须避免**：影视预告式的高潮与冲击（`epic`、`trailer`、`impact hit`、`risers`）、动漫 OP 式的高 BPM 与失真吉他（`anime opening`、`J-rock`、`powerful guitar riff`、`four-on-the-floor`）、芯片音（`8-bit`、`chiptune`、`NES`）、与人声抢中频的扛旋律元素。
- **中文 mood / scene / tags 必须落在素材库既有词表内**（本项目 `library/bgm/` 的 61 条已用词；`mood` 2–5 个、`scene` 2–5 个、`tags` 2–5 个）。原因与完整词表见既有技能 [galgame-bgm/SKILL.md](../../../apps/server/skills/galgame-bgm/SKILL.md)：剧作家只能读这一行文字来选曲，自造词会变成匹配不上的孤岛。

**BPM 参考基准（来自可查来源，非推断）**

| 用途 | BPM 区间 | 来源 |
| --- | --- | --- |
| VN 素材包（内向女主角主题）整体 | 60–108 BPM | [Vacuous BGM Vol.06](https://note.com/good_pansy5184/n/n6e63b42fcc76) |
| アニメ劇伴：日常系 | 70–90 BPM | [Core Music School アニメ音楽](https://core-ms.net/2026/07/20/anime-music-composition-method/) |
| アニメ劇伴：戦闘系 | 140–180 BPM | 同上 |
| アニソン OP：摇滚系 | 150–185 BPM（160 前后最常见） | [Core Music School OP 作り方](https://core-ms.net/2026/06/30/anime-opening-composition/)、[古賀稔宏 アニソン風](https://kogamusic.net/articles/anison-production.html) |
| アニソン OP：抒情 ballad 系 | 70–90 BPM（可加 half-time feel） | 同上 |
| アニソン ED | 70–120 BPM | [Veena](https://www.veena.studio/make/anime-music) |
| 游戏 BGM 通用：菜单/标题 | 80–100 BPM | [Suno.ing](https://suno.ing/zh-cn/blog/suno-indie-game-soundtrack-guide/) |
| 游戏 BGM：探索 | 75–95 BPM | 同上 |
| 游戏 BGM：过场/剧情 | 70–110 BPM | 同上 |
| Suno 游戏模板：村庄 | 95–100 BPM | [AI 工具指南](https://aitoolsguidebook.com/zh/articles/suno-game-bgm-prompts/) |
| Suno 游戏模板：恐怖 | 60–70 BPM | 同上 |
| 旁白垫底（talking-head） | 60–85 BPM | [SunoMarket](https://sunomarket.com/blog/suno-for-youtube-background-music) |
| 剧伴（离别场景示例） | 60–72 BPM，ppp–mp | [Core Music School](https://core-ms.net/2026/07/20/anime-music-composition-method/) |

---

### 3.1 日常／喜剧／轻快／吐槽（Slice of Life / Upbeat / Comedy）

**戏种定义**：校园走廊、社团、午休、便利店、闲聊、角色吐槽与插科打诨；在 VN 里出现频率最高、单次循环时长最长的一类。

**和声与调式**

- 大调为主；`I–V–vi–IV`（1564）、`vi–IV–V–I`（小室）、`IV–V–iii–vi`（王道）皆可用，但**用三和音/仅加 6th、add9 的轻量 voicing**，避免加太多 7th 让色彩变「成人」。
- 喜剧/吐槽场景常配**半音级滑音、拟声式短句、怪异的乐器替换**（例如木琴、拨弦、口哨）；Clannad 的「A Couple of Idiots」用 xylophone「quickly establishes the piece's silly tone」。（[VGMO Clannad](https://vgmonline.net/clannad/)）
- 轻快感来自**节奏型与音数**，不是 BPM 拉高：「走って聞こえるのは、ドラムの刻みが細かく前へ進み、静かな場面とうるさい場面の差が大きい時」——但 VN 场景不宜做大的落差。

**配器**：明亮钢琴 / 电钢琴、木吉他（ноylon 或 steel）、拨弦弦乐（Pizzicato Strings）、木管（flute / clarinet / recorder）、glockenspiel / xylophone、尤克里里、口琴、轻打击（brush、tambourine、woodblock）、轻快 bass。可加**一句角色的「主题乐器」动机**做差异化。

**节奏与 BPM**：**95–130 BPM**（VN 素材包 60–108 BPM 的上半区；剧伴日常系 70–90 BPM 的低区则更偏向「温和日常」而非「轻快喜剧」）。4/4；可有 swing/shuffle 或 bossa 型轻 groove。

**动态与循环**：**必然循环**（一段闲聊可能十几分钟）。动态必须平；**不要有「笑点"impact"」**——喜剧感由音型承担，不由音量承担。若需要「笑点」，交给 SFX。

**英文提示词**

```
# Lyria 版（结构化多种子：genre → mood → instrumentation → tempo → arrangement）
"Bright Japanese-style piano pop for a slice-of-life scene, cheerful and playful with a light
sense of humor, solo upright piano with pizzicato strings and glockenspiel accents, ukulele
strumming underneath, light brushed percussion and woodblock, no drums solo, 112 BPM, in C major,
instrumental, seamless loop, consistent dynamics throughout, no fade in or fade out, sparse
arrangement, background music under dialogue, keeps the foreground clear"
```

```
# Suno 版（Style 字段；Instrumental 开关打开；Exclude 填 vocals, singing, humming, drops）
"instrumental, no vocals, Japanese-style light piano pop, cheerful playful slice-of-life,
bright upright piano, pizzicato strings, glockenspiel accents, ukulele, brushed drums,
112 BPM, major key, seamless loop, no intro, no outro, consistent energy, no dramatic changes,
sparse arrangement, background bed, clean mix"
```

**避坑**

- `upbeat` 单独用会把曲子推向 128–140 BPM 的舞曲感 → 换 `cheerful`, `playful`, `bouncy`, `light`。
- `happy` 在实证研究里是最容易「过度明亮 / blur」的词之一（模型向更高 valence 偏移），需要配 `with a touch of warmth`, `understated` 压制。
- **不要写 `comedic`+`cartoon`**：会得到卡通片配乐（滑音、boing），与日系日常的「有节制的俏皮」不同。

---

### 3.2 抒情／心动／告白／两人独处（Romance / Confession / Intimacy）

**戏种定义**：放学后独处、天台、月光、告白前后、牵手与沉默；VN 的情感主轴场景，通常**第一次跑循环的时长只有几分钟但情绪密度最高**。

**和声与调式**

- 王道進行与カノン進行为主；告白场景常用**小室進行后半释放**（`vi–IV–V–I`）或在结尾补 `I` 完成一次「解决」。
- 张力音：`maj7`（余韵/记忆感）、`add9`（透明感）、`sus4`（解决前的踌躇）——这三者是「心动」的技术核心。
- 需要「暧昧/不确定」时用**分数和弦下行**（`Am–Am/G–Fmaj7–E7`）或**末句不解决**。
- 「しっとりした大人っぽさ」可用丸サ進行，但 VN 里更常见的是它的**四和弦简化版**（`Fmaj7–E7–Am7–C7`）。

**配器**：**独奏钢琴**为主（VN 的默认语言）；`钢琴 + 小提琴/大提琴`、`钢琴 + 竖琴`、`钢琴 + 木吉他（指弹）`、`钢琴 + soft strings pad`。可有 `celesta`/`music box` 做高音点缀（因为 celesta 音量小，会被听众听成「在钢琴之上的光点」而非独立声部）。**不要鼓**，或只用极轻的 brush / 无低频 perctexture。

**节奏与 BPM**：**60–90 BPM**；4/4、或 3/4 / 6/8（摇篮曲感）。可用 rubato 感的 sparse 织体，但**循环用曲要克制 rubato**（会造成接缝难对齐）。

**动态与循环**：**通常循环**（对话垫底）；告白尖端可做**一次性不循环**版本（Clannad OST 里「TOE」就被明确标注为少数不循环、以钢琴收尾的曲目）。若循环，动态必须平；若真需要戏剧性，允许的就只是「一次轻微的起伏」——VN 委托案例中，制作方要求「0:41、1:06、1:45 の辺りもっと溜めて、更にドラマチックに」但作者同时强调**只能在钢琴独奏这类稀疏配器里做「溜め」，且不能过度**。

**英文提示词**

```
# Lyria 版
"Solo piano with soft strings for a tender romantic scene, warm and hopeful with a touch of
hesitation, sparse arrangement, pedal-heavy sustained chords, nylon-string guitar answer
phrases, celesta sparkles in the high register, 72 BPM, in D major, instrumental, seamless
loop, steady rhythm, no fade in or fade out, background music under a monologue, keeps the
foreground clear"
```

```
# Suno 版
"instrumental, no vocals, Japanese-style emotional piano ballad, tender warm romantic, solo
piano with soft sustained strings, nylon guitar, gentle celesta accents, 72 BPM, major seventh
chords, sparse, intimate, seamless loop, no intro, no outro, consistent dynamics, no build-up,
background bed for visual novel dialogue, clean midrange, room for voice"
```

**避坑**

- **不要写 `emotional` + `powerful` + `building to a climax`**：这是抒情场景最致命的组合（会把曲子变成动画插入歌）。要改为 `emotional, restrained, unhurried`。
- **不要写 `sad`**（详见 §3.4）：告白场景要的是「sad but hopeful」这类**双极走向**。
- **不要写 `strings orchestra`**：会得到全管弦铺底、中频被填满；写 `soft sustained strings`、`string pad` 或直接点名 `cello, viola ensemble`。
- `music box` 单独成曲会显得廉价/幼稚；作为**点缀**（`celesta accents`, `music box figure`）更接近日系用法。

---

### 3.3 怀旧／夕阳／放学路／物哀（Nostalgia / Sunset / Mono no aware）

**戏种定义**：放学路上的坡道、夏天的云、旧照片、童年回忆、祭典归途、同学录；日文语境里对应「郷愁」「懐かしさ」「物哀」，与「单纯的怀旧（nostalgic）」相比多一层**「已经失去、无法回去」的静默感**。

**和声与调式**

- `I→vi→IV→V`、`vi→IV→I→V`（回想感のあるポップさ）、`I–Imaj7–I7–IV`（静かな映画的郷愁）、`I→IV→iv→I`（一瞬で胸を締める陰影）。
- 技法核心：**maj7 与 add9 打底 + 一点点借用和音**；「基本は三和音を中心にする，強調したい場所だけ maj7 や add9 を加える」——全曲都挂 maj7 会让轮廓模糊。
- **下行低音与分数和弦**是「时间流过」的听觉隐喻；旋律宜**順次進行（级进）+ 同音反復**，少跳进。
- 和风浓度选择：若场景在乡间/神社/旧家，可用**陽音階（yo）或ヨナ抜き長音階**的旋律配西洋和声（「旋律给身份、和弦给运动」）；若只是城市夕阳，保持纯大调即可。

**配器**：**八音盒 / celesta / glockenspiel（punti）**、钢琴（避免过度明亮，宜 muted / felt-piano 感）、**尼龙弦吉他指弹**、竖琴 arpeggio、口琴 / 尺八（乡愁）、轻弦乐 pad、极轻的 tambourine 或 shaker 模拟远处风铃/风。**不要鼓组**。

**节奏与 BPM**：**65–100 BPM**。可有缓慢的三拍子（6/8、3/4）营造摇荡感。

**动态与循环**：**循环**；动态平。**「物哀」不靠大起伏**，靠留白与音色；核心手法是「音数を減らして間を作る」。

**英文提示词**

```
# Lyria 版
"Japanese nostalgic music box and felt piano, wistful and warm with a quiet sense of loss,
music box leading with felt piano and nylon-string guitar, harp arpeggios, soft sustained
strings underneath, 78 BPM, in A major with a borrowed minor iv, instrumental, seamless loop,
consistent dynamics throughout, no fade in or fade out, gentle and unhurried, background music
for a nostalgic scene"
```

```
# Suno 版
"instrumental, no vocals, Japanese nostalgic music box and felt piano, wistful nostalgic,
warm and quietly sad, music box melody, felt piano, nylon guitar fingerpicking, harp, soft
string pad, 78 BPM, major with borrowed iv, seamless loop, no intro, no outro, gentle
dynamics, no build, no drums, background bed, midrange kept open"
```

**避坑**

- **`nostalgic` 在 Suno 语汇里常与 lo-fi hip hop / vinyl crackle 绑定**（[JBG 情绪表](https://jbg-ongakuin.com/staff-blog/20250807/) 把 Nostalgic 归给 Lo-fi Hip Hop / Folk）——若不想得到「lo-fi 学习用 beats + 鼓」，必须**同时写明 `no drums` 或点名乐器**。这是本项目最需要注意的一条：`nostalgic` 单独出现极可能带出鼓组。
- `cinematic` 会引出弦乐铺满的「电影感」——定位到旧照片/小物时是反效果。
- 不要写曲名或作品名（如 `like Clannad`）：既可能被过滤，也会让模型去找具体旋律。

---

### 3.4 伤感／催泪／别离／雨天（Melancholic / Tearjerker / Rain）

**戏种定义**：生死别离、误解与和解失败、雨夜独白、Bad End、墓前。日文语境里的「切ない」「泣き」是这个场景的技术目标。

**和声与调式**

- 下行系：`Am–G–F–E`（最直白的切なさ）、`Am–Am/G–Fmaj7–E7`（分数和弦滑降）、`Am–C/G–F–E`（内声下行，电影式阴翳）、`Am–G–F–E7`（末句留强导音 = 未解決の痛み）。
- 小调定番：`i–♭VI–♭III–♭VII`、`i–iv–♭VI–V`、`i–♭VII–♭VI–V`。
- 大调里的阴翳：`iv`（下属小和弦）、`♭VI`、`♭VII`；**`F → Fm` 是最经济的「胸が締まる」开关**。
- 张力音：`m7`（柔らかい陰り）、`maj7`（回想）、`add9`（透明）、`sus4`（ためらい）；**避免在收束处用强终止**，让悲伤「言い切られずに残る」（如 `Am(add9)` 或 `Am7` 结束）。
- 需要「泪点被推到顶」时用复合型（例：`A → AM7 → G → D → Dm7 → C#m7 → Bm7 → E7`，同时含 クリシェ、iv、♭VII、IIIm→IIm）。
- 判断是否「哭得出来」的听感指标：**半音進行 + 四和音**（[うちやま作曲教室](https://sakkyoku.info/beginner/cry-chord-progression-pattern/) 明确把这两项列为「泣ける」的要点）。

**配器**：**钢琴独奏（慢、稀疏）** 为骨干；`钢琴 + 大提琴`（最常用）、`钢琴 + violin solo`、`钢琴 + 低音弦乐 drone`（折戸治伸早期手法：用小提琴弦当持续音）、雨声作为环境底（注意：**雨声是 SFX/环境层，不应写进 BGM 提示词**——否则模型会把噪声当成音乐内容，且无法在换场时单独控制）。若需要「催泪」独立层次，可在后段**加一层独奏小提琴/大提琴**（VNDev 手册举的例子正是「人物在主角怀里死去时，独奏小提琴奏出 heart-wrenching 的旋律，不换曲而强化情绪」）。

**节奏与 BPM**：**55–80 BPM**；4/4 或 6/8；**无鼓**或极轻 timpani/低音鼓（只在极少数需要「沉重」时）。

**动态与循环**：循环场景（雨夜独白可以循环很久）需平动态；**Bad End / 一次性的告别场景可以 `loop: false`**（与片尾曲同类，允许有明确的结束）。

**英文提示词**

```
# Lyria 版
"Solo piano with cello for a heartbreaking farewell scene, melancholic and restrained, sparse
slow piano, sustained cello line entering on the second phrase, low strings drone underneath,
no percussion, 62 BPM, in A minor with a descending bass, minor seventh and suspended chords,
instrumental, steady dynamics, no dramatic build, no fade in or fade out, background music
that does not compete with the voice"
```

```
# Suno 版
"instrumental, no vocals, sorrowful Japanese solo piano and cello, melancholic bittersweet,
sparse slow grand piano, deep sustained cello, low string drone, no drums, no percussion,
62 BPM, A minor, descending bassline, minor 7th and sus4 chords, unresolved ending,
seamless loop, consistent dynamics, no build-up, no riser, background bed under dialogue"
```

**避坑（这一格最关键）**

- **`sad` 是效率最低的情绪词**：实证研究一致显示（a）商业模型（Suno、Udio）倾向生成比提示词**更愉悦**的音乐；（b）所有模型都向**情绪中性**回归；（c）valence（愉悦度）比 arousal 更难忠实执行；（d）「低 valence + 低 arousal」（sad / gloomy / dull 象限）本身就是模型最弱的象限之一。→ 实操：**用「乐器 + 音区 + 稀疏度 + 和声色彩 + 否定句」四重冗余去表达悲伤，而不是只依赖 `sad`**。（[AImoclips](https://arxiv.org/html/2509.00813v2)、[Feels in the Music Machine](https://www.diva-portal.org/smash/get/diva2:2009627/FULLTEXT01.pdf)）
- **`emotional violin` / `sad strings`** 会得到「韩剧 OST」式的厚重弦乐；VN 的克制感要求 **`solo cello` / `single violin line`** 这种「一个人拉」的写法。
- **不要写 `rain sounds` / `thunder`** 到 BGM 提示词里（见上）。
- 不要写 `depressing` / `dark`（后者会把配器推向 drone 与低频，见 §3.5）。

---

### 3.5 紧张／推理／暗潮／对峙（Mystery / Suspense / Tension）

**戏种定义**：推理的线索收集、走廊尽头、电话里的坏消息、对峙前的静默、危机倒计时；在 VN 里通常**不循环或长循环**，视段落长度而定。

**和声与调式**

- 学术侧对「威胁音乐（threatening music）」的定义可直接当作技术清单：**极端音区与极端力度、不协和和声、半音阶化、不规则节奏、不自然音色（如弦乐 sul ponticello、电子音）、音高不可辨的织体、ostinato**。对照组「安全音乐」则是可辨识旋律与和声、规整节奏、合成的原声乐器、**不变的动态**。（[Mireault 摘录](https://exa.ai/library/publication/4n6dxdfx1gm)）
- 日文实务：**ドローン（持续音）+ 低音区暗色音色**，不用鼓直到揭示瞬间；不协和音、reverse 音效、不规则 percussion、扭曲钢琴；**テンポ：なし〜ゆっくり（没有节奏反而更不安）**；「音が鳴っていない時間」も演出の一部，静寂からの急な音是最强的恐怖手段（stinger）。（[Core Music School ゲーム音楽](https://core-ms.net/2026/03/23/dtm-game-music-production/)）
- 战斗/暗色系若需要驱动力，可用**ハーモニックマイナー**（V 变大三，对 Im 的解决感增强 =「緊迫感の中の爽快感」）——但这已经偏向「战斗」而非「对峙」。

**配器**：**低音钢琴 + 持续弦乐**、`dark ambient piano`、`minor key strings`、synth drone / pad、低音单簧管、大提琴/低音提琴、reverse cymbal、极稀疏的金属敲击、**电子脉冲（pulse）**（日系推理/科幻 VN 大量使用，如 Steins;Gate 的合成器语汇）。

**节奏与 BPM**：**60–100 BPM，或无明确节拍**；可有 16 分音符的**微弱机械脉冲**（心跳感），但不做「推进型鼓组」。

**动态与循环**：「推理/暗潮」常需**长循环**（玩家在推理段落停留很久）→ 必须平动态，否则每次循环都在「又紧张一次」。**真正的危机/揭示时刻应另做一首不循环的 stinger/transition 曲**，而不是让循环曲自带爆点。VNDev 手册把这一点归纳为：用**换曲**承担信息（「你现在进入了不同的环境/状态」），用**分层或参数操纵**承担情绪的细微加强。

**英文提示词**

```
# Lyria 版
"Dark ambient piano with low sustained strings for a suspenseful investigation scene, tense
and restrained, sparse low piano notes with long silences, sustained minor-key string drone,
low cello, subtle electronic pulse without any beat, no percussion, no tempo, in D minor,
instrumental, seamless loop, steady sparse texture, no build-up, no impact, no fade in or
fade out, background music that does not compete with the voice"
```

```
# Suno 版
"instrumental, no vocals, dark ambient suspense for a visual novel mystery scene, tense
restrained ominous, low sparse piano, sustained minor strings, cello drone, faint electronic
pulse, no drums, no beat, 68 BPM, D minor, dissonant passing notes, seamless loop, consistent
low energy, no risers, no hits, no drop, background bed, room for voice"
```

**避坑**

- **`horror` / `scary`** 会把曲子推向恐怖片（低频轰鸣、突然的 screech）；VN 的「暗潮」要的是**不安而非惊吓**。
- **`tension building` / `rising tension`** 在循环曲里是自毁设定：每次循环都重建一次张力。要改为 `sustained tension, static unease, no build`。若需要一次性堆积，做 `loop: false` 的版本。
- **`epic` / `dramatic` / `orchestral`** 会直接跳到影视 vs 战斗配乐（`huge impact hit`、`brass swells` 是 trailer 音乐的标配词汇）。
- **`suspense` + `orchestra`** 在 Suno 语汇里常触发「好莱坞惊悚」模板（ticking pulse、low brass、risers、cinematic impacts）——见 [MusicPromptPro 的 trailer 模板](https://musicpromptpro.com/topics/suno-prompt-for-cinematic-trailer)；VN 要写 `sparse`, `restrained`, `no brass`。

---

### 3.6 梦幻／神秘／世界观序章（Ethereal / Fantasy / Music Box / Prologue）

**戏种定义**：标题画面、序章的旁白、梦境、回忆的浮游段、超自然设定说明、幻想世界观登场。

**和声与调式**

- **Lydian** 是这一场景最可引用的调式选择：与 4 级的 tritone 制造「稳定但不解决」的漂浮与惊叹；VGM 传统（Zelda 主主题、FF7「Aerith's Theme」、Chrono Trigger「Corridors of Time」、Genshin Main Theme 的 G/C Lydian）都密集使用；用法特征为**长持续音上的踏板主音、强调 tritone 的琶音、回避强终止**。（[music-dictionary](https://music-dictionary.org/music-theory/modes/lydian-mode-video-game-soundtracks-case-studies/)、[Hooktheory](https://www.hooktheory.com/theorytab/view/yu-peng-chen/genshin-impact-main-theme)）
- 久石让范例的可用要点：**四度关系（quartal chord、sus4、maj9(#11)）+ 五声音阶 4 音组 + 局部调式转换（Eb Lydian → F Mixolydian → D Phrygian）**，整曲靠「四度」统一。（[One Summer's Day 分析](https://rsucon.rsu.ac.th/files/proceedings/intersoc2021/1923_20210514184537.pdf)）
- 和风幻想：**岩戸音階（iwato）**（最不安定，适合「夜/幽灵/不安」）或 **insen**（insen 五点同按 = Phrygian chord）。

**配器**：**八音盒 / celesta / glockenspiel**（celesta 的声学特性使其「本身就是为这种场景造的」：高音区 fine、bell-like，且常与长笛/竖琴/钢琴叠合做「光点」）、竖琴、kalimba、vibraphone、Rhodes、**宽 reverb 的 synth pad**、无词女声吟唱（`wordless vocalise`——但注意这属于人声，与人声避让原则冲突，**只在没有台词的序章/标题使用**）、太鼓或手鼓（若为东方幻想）。

**节奏与 BPM**：**60–90 BPM，或无节拍**；可用 6/8、7/8 或自由漂浮的时间感。

**动态与循环**：标题/序章可 `loop: false`（一次演完）或有明确的 intro+loop 结构；梦境内插入段常循环。

**英文提示词**

```
# Lyria 版
"Dreamlike music box and celesta for the prologue of a fantasy visual novel, ethereal and
mysterious with a sense of wonder, music box melody doubled by celesta, harp arpeggios,
wide reverberant synth pad, gentle kalimba accents, no percussion, lydian brightness with an
unresolved harmony, 70 BPM, in C lydian, instrumental, consistent gentle dynamics, no fade in
or fade out, wide stereo space, atmospheric"
```

```
# Suno 版
"instrumental, no vocals, ethereal fantasy prologue, dreamlike mysterious wonder, music box
and celesta melody, harp arpeggios, warm wide synth pads, kalimba accents, no drums, 70 BPM,
lydian mode, suspended chords, unresolved harmony, seamless loop, consistent dynamics,
no build, wide stereo reverb, spacious, background bed"
```

**避坑**

- **`epic fantasy` / `cinematic orchestral` / `taiko`** 会把曲子推向 RPG 战斗主题或预告片（这是「梦幻序章」最容易跑偏的一条）。
- **`choir` / `angels` / `celestial voices`** 会引入人声层，破坏避让原则；真要人声只写 `wordless vocalise, no lyrics`，且明确规定使用场景为无台词段落。
- **`8-bit` / `chiptune`** 会得到复古游戏音乐——注意**日系 VN 里 8-bit 是有传统的**（逆転裁判 = 8-bit + 摇滚节奏组；Steins;Gate 有 PC-98 风格的 chiptune 变体专辑），但那是**风格选择**，不能当默认。
- **`ambient` 单独用**可能得到没有任何旋律的 padding——VN 的「梦幻」仍需要可辨识的动机（音乐记忆点）。

---

### 3.7 终章／真爱升华／治愈救赎（Climax / True Route / Redemption / Ending）

**戏种定义**：Rail 线的最后一幕、真相大白、和解与重生、True End 的连锁回忆、staff roll 前的最后一段。**这是唯一允许「有走向」的场景**。

**和声与调式**

- 结构上普遍采用「**主题曲/主旋律的变奏**」——这是日系 Galgame 感动曲的行业惯例。委托实例明确记录：「美少女ゲームの感動曲といえば主題歌アレンジ」；另一例：「テーマ曲のメロディをアレンジすることで、ゲームプレイ時により印象的なものになるように」。（[恒石涼平](https://note.com/ryodist/n/n4bd037e012de)、[VGMO Clannad](https://vgmonline.net/clannad/)）
- 和声路线：**从 minor 走向 major 的解决**（小室進行 `vi–IV–V–I` 天然承担这个功能）；或用王道進行的最后补 `V`（`IV–V–IIIm–VIm→V`）形成回环；或在末段做**半音/全音上行转调**提升（アニソン手法，用在一次性的终章曲是允许的）。
- 「切ない幸せ」= 甜与苦同时：委托方的原话是「想いが通じ合った幸せ、でも終わりが近付く悲しみを少し覚える」，并要求「綺麗な音色で暖かさを軸に、寂しさを入れる形で」。（[恒石涼平](https://note.com/ryodist/n/n4bd037e012de)）

**配器**：由稀到密的**渐进增层**：`钢琴独奏 → 加弦乐 → 加木管/竖琴 → （可选）完整室内乐`。这一格可以出现克制的打击（timpani 滚奏、低音鼓轻击），但仍**不应有影视预告式的铜管冲击**。若健康度允许，加入无词人声吟唱（此时通常对白已结束）。

**节奏与 BPM**：**60–90 BPM**；由稀疏到流动；可用 4/4 稳定推进。

**动态与循环**：**`loop: false`**（一次播完，允许有明确的结束与起伏）。这与片头/片尾曲同类：`with a clear beginning and ending`。

**英文提示词**

```
# Lyria 版
"Emotional piano leading into warm strings for the true ending of a visual novel, bittersweet
yet hopeful and healing, solo piano growing into a warm chamber string ensemble, gentle harp,
soft wordless vocalise far in the background during the final section, gradual arrangement
that adds one instrument at a time, 76 BPM, in G major resolving from E minor, rich major
seventh and add9 harmony, instrumental, with a clear beginning and a resolved ending,
no fade out, wide stereo space"
```

```
# Suno 版
(this scene wants a full arc, so describe structure explicitly and turn Instrumental off
only if you actually want a song)
"instrumental, no vocals except soft wordless vocalise, Japanese emotional ending theme for a
visual novel, bittersweet hopeful healing, solo piano opening, warm chamber strings entering,
harp, gentle timpani swell, one instrument added per section, 76 BPM, G major moving from
E minor, maj7 and add9 chords, clear beginning, resolved ending, no fade out, no EDM, no drops,
full arrangement arc"
```

**避坑**

- **这是唯一可以写 `building` / `climax` 的场景**，但仍要写清 `gradual arrangement`（逐层加入）而不是 `epic orchestral`（后者会立刻变成好莱坞预告）。
- **不要写 `anime opening`** 来求「燃」：OP 语义带固定 BPM 区间（150–185）、失真吉他、四つ打ち与 kime 齐奏，会与「泪」的语义互斥。
- **主题变奏无法用提示词指定原曲**（模型没有你剧目里的主题）。可行做法是**在同一批生成里复用相同的旋律记忆点描述词**（同一乐器、同一调、同一节奏型措辞），或在 DAW 里用 MIDI 重写主题旋律叠上去。

---

### 3.8 补充：过场与功能性曲目

| 类型 | 音乐形态 | 关键约束 | 循环 |
| --- | --- | --- | --- |
| 标题画面 | 主题动机最完整的一次呈现；允许最强的情感浓度 | 常要求「单曲循环也不腻」——因此仍建议平动态 | 通常 `true` |
| 菜单／系统 | 30 秒–1 分的极短循环；「短いループで十分。ただし印象的であること」 | 音数最少；绝对不能有人声 | `true` |
| 咖啡馆／图书馆／街道等场所 | 场所感的乐器选择（咖啡馆 → 轻爵士/钢琴；图书馆 → 低音钢琴/无鼓；街道 → 木吉他/轻打击） | 与 §3.1 同族但更静态 | `true` |
| 转场／过场（ジングル类） | 1–15 秒；「短く閉じる，フェードで逃げず切って終わると次に繋がる」 | 无循环；允许明确的终止 | `false` |
| 危机／揭示 stinger | 一次性重音或短句，用来「遮住换曲的突然」 | 与 BGM 分轨，不能写进循环曲 | `false` |
| 片尾曲（ED）/ 主题歌 | 完整歌曲结构，有人声 | 与 BGM 是两种物种；提示词需完全换一套（可写 `with vocals`） | `false` |

来源：循环长度与用途对照见 [Core Music School ゲーム音楽](https://core-ms.net/2026/03/23/dtm-game-music-production/)、[Suno.ing](https://suno.ing/zh-cn/blog/suno-indie-game-soundtrack-guide/)；ジングル定义与「切って終わる」见 [Core Music School](https://core-ms.net/2026/03/23/dtm-game-music-production/) 与 [古賀稔宏](https://kogamusic.net/articles/anison-production.html)；换曲时用 SFX 遮挡突然启动/停止见 [VNDev Wiki](https://www.vndev.wiki/Guide:Dynamic_audio_in_visual_novels)。

## 4. 面向生成模型的提示词工程

### 4.1 四种模型的机制差异（决定提示词写法，而不是风格偏好）

| 维度 | **Google Lyria 3.5 / Lyria 3 Clip** | **Lyria RealTime** | **Suno** | **Udio** | **Meta MusicGen** |
| --- | --- | --- | --- | --- | --- |
| 输入形态 | 单段自由文本（可为短句或结构化长文） | **加权提示词数组**（`WeightedPrompt(text, weight)`），可实时改权重 | Style 字段（自由文本）+ Lyrics 字段（结构标签/歌词）+ **Exclude 字段** + Instrumental 开关 | 单一 rich prompt 字段 + Lyrics 字段（`/` 呼出 tag 列表） | 单段文本（**按句子理解，不按逗号 tag 理解**） |
| 长度限制 | 官方未给出硬上限（示例为一段话） | 每条 prompt 一条短语 | 旧模型 Style ≈200 字符；**V4.5+/V5 = 1000 字符，超出静默截断**（故要求**前置最重要信息**） | 实用上「约 200 字符后模型开始平均概念」；建议**控制在 150 字符内** | 无明确上限，但过长会稀释 |
| 负向词 | 未提供独立负向字段；改用正向替换 + 结构约束 | 同左（降低权重≈弱化） | **Style 里的否定指令不可靠**；官方通道是 **Exclude 字段**（Advanced Options） | 有 **Style Reduction**（Advanced Controls）降低不想要的风格；另有 Manual Mode 只用精确 tag | 无负向机制 |
| 无人声 | 提示词里写明 `instrumental`（官方原话：Specify "instrumental" in your prompt to exclude vocals completely） | 同左 | **Instrumental 开关 + `[Instrumental]` 标记 + Exclude 填 `vocals`** 三重保险 | **Instrumental Mode** 或写乐器 tag | 天生弱人声（模型本身无法生成真实人声） |
| 结构控制 | 支持 `[Intro] -> [Verse] -> [Chorus]` 箭头/tag，以及时间点（`Build to a beat drop at 12 seconds`） | 靠权重随时间变化 | Lyrics 里的 `[Verse]` 等结构 tag；Style 里也可描述段落 | Lyrics 里的 tag；**tag 是原子的，不能用 `|` 堆叠** | 不支持结构（单次生成内无法维持 verse/chorus）；需靠 continuation 链式续接 |
| 单次时长 | 30 秒片段或完整歌曲（Lyria 3.5） | 流式 | 视版本，可 Extend | 长结构是强项（v4 可到 ~10 分钟量级） | **约 30 秒硬上限**（1503 tokens；给 audio prompt 会占用额度） |
| 调/调式指定 | 支持（`in G major`、`in C pentatonic`） | 支持 | **BPM 只作近似引导**；调式规范不可靠 | **对 key/mode 规范反应较好**（如 `A minor`、`Mixolydian`） | **不吃 key signature**（来源明确：`an explicit key signature does not`） |
| 技术混音术语 | 描述性语言有效（音色/织体描述） | 同左 | **混音参数被忽略**（`Sidechain compression on the kick` 无效） | **接受大量制作技术语言**（saturation、transient shaping、mid-side EQ、wide stereo field、mono-compatible 等） | 基本不支持 |
| 人声生成 | Lyria 3.5 **默认带人声与歌词** | 视权重 | 默认带；需显式关闭 | 默认带；需 Instrumental Mode | 无法生成可辨识歌词的人声（会以无词音节形式出现） |
| 循环意图 | 可通过提示词表达「可循环」，但**不输出循环元数据** | N/A（流式，本质是持续生成） | 同上；官方有 Loop Mode，但仍需 DAW 精修 | 同上 | 同上 |
| 主要官方/权威来源 | [Lyria prompt guide (Gemini API)](https://ai.google.dev/gemini-api/docs/lyria-prompt-guide)、[Vertex AI 音乐生成 prompt guide](https://cloud.google.com/vertex-ai/generative-ai/docs/music/music-gen-prompt-guide)、[DeepMind Lyria prompt guide](https://deepmind.google/models/lyria/prompt-guide/) | 同左（同一页） | [Blake Crosley Suno 指南](https://blakecrosley.com/guides/suno)、[MusicSmith 提示词最佳实践](https://musicsmith.ai/blog/ai-music-generation-prompts-best-practices)、[HookGenius 负向提示词](https://hookgenius.app/learn/suno-negative-prompting/) | [Udio: Prompt Like a Master](https://help.udio.com/en/articles/10716541-prompt-like-a-master)、[Udio: Brick Method](https://help.udio.com/en/articles/12232112-the-brick-method-making-udio-work-for-you)、[Udio Prompt Tags and Style Guide](https://aimusicdaily.com/udio-prompt-tags) | [MusicGen HF 文档](https://huggingface.co/docs/transformers/main/model_doc/musicgen)、[MusicGen Prompt Guide](https://geratools.com/musicgen-prompt-guide)、[Meta AudioCraft](https://audiocraft.metademolab.com/musicgen.html) |

**Lyria 官方的结构化框架**（Vertex AI / Gemini Enterprise 文档原样）：

```
[Genre & style] + [Mood] + [Instrumentation] + [Tempo & rhythm] + [Vocal style & language] + [Lyrics]
```

其中：`Genre & style` 定义主类型与风格特征（如 `cinematic orchestral fantasy`、`lo-fi`、`8-bit`）；`Mood & emotion` 描述要唤起的感觉（`energetic`、`melancholy`、`peaceful`、`tense and suspenseful`）；`Instrumentation` 要点名具体乐器；`Tempo & rhythm` 给速度与节奏性格；`Vocal style & language` 给性别/音域/表演/语言；`Arrangement/Structure` 可选，**并明确「Specify `instrumental` in your prompt to exclude vocals completely」**。（[Vertex AI prompt guide](https://cloud.google.com/vertex-ai/generative-ai/docs/music/music-gen-prompt-guide)）

**Udio 的 Brick Method（官方帮助中心）**——固定顺序、用下划线把「属于同一格」的概念粘连：

```
Genre -> Vocalist -> Mood -> Instrumentation -> What/How/Where
例：pop_synthwave female vocal bold_happy synth_drums song_layered_track
```

规则原文：保持顺序；格内多概念用下划线（`bold_happy`）；**格与格之间用空格**；两词一格时用空格（`female vocal` 而非 `female_vocal`）；**始终以 What/How/Where 收尾**（告诉 Udio 你要什么、怎么编排、走向何处；`cutscene` / `menu` 属于 Where 的示例词，也可用「single」表示单曲）。（[Udio Brick Method](https://help.udio.com/en/articles/12232112-the-brick-method-making-udio-work-for-you)）

**MusicGen 的四段式（社区权威指南）**：

```
1. Genre or style anchor  → "lo-fi hip hop" / "80s synthwave" / "acoustic folk"
2. Specific instruments   → "Rhodes piano, upright bass, brushed snare"（不要只写 "jazz"）
3. Tempo or energy level  → "80 BPM" / "slow and meditative"
4. Mood or texture        → "warm, late-night, melancholy"
```

关键差异：**MusicGen 读整句而不是读逗号 tag**——「a warm jazz trio with Rhodes piano, upright bass, and brushed drums, 90 BPM, relaxed late-night feel」优于「Rhodes, bass, drums, jazz, warm, 90 BPM」。且**「Generate multiple seeds」是标准做法（同提示词出 3–4 个版本再挑）**。（[MusicGen Prompt Guide](https://geratools.com/musicgen-prompt-guide)）

**Suno 的关键操作事实**

- **把最重要的 genre/mood 前置**（超出 1000 字符会静默截断）；用描述句而非命令句（写「Upbeat pop track...」而不是「Create an upbeat pop track...」）。
- **纯器乐的三重保险**：① Custom Mode 打开 Instrumental；② Lyrics 框放 `[Instrumental]`（或 `[Instrumental Break]`）——注意「anything outside brackets gets sung」；③ Exclude 字段填 `vocals, singing, humming, spoken word`。实测记录：`no vocals` **写在 Style 末尾会失败（出现哼唱泄漏）**，写在最前面则通过。（[Suno.ing 器乐指南](https://suno.ing/blog/suno-instrumental-music-guide/)、[Blake Crosley](https://blakecrosley.com/guides/suno)）
- **「no X」格式最省字符**，但要配合正向描述，且**同一元素要写全**（`no acoustic guitar, no electric guitar, no guitar of any kind`）。（[HookGenius](https://hookgenius.app/learn/suno-negative-prompting/)）
- **真实艺术家名会被过滤**：官方过滤器会拦截风格字段里的真实音乐人名；正确做法是改写成声音描述。（[Suno 指南：避免艺术家名](https://sunoaipromptguide.org/how-to-avoid-artist-name-tags-on-suno-ai/)、[艺术家黑名单对照表](https://github.com/bitwize-music-studio/claude-ai-music-skills/blob/main/reference/suno/artist-blocklist.md)）

### 4.2 通用提示词框架（本报告推荐的 Galgame BGM 六段式）

把上述官方框架合并、按 Galgame BGM 的约束重排，得到一份适用于任何模型的可裁剪模板：

```
[1 用途与轨道身份] + [2 风格锚点] + [3 配器] + [4 情绪与本曲走向] + [5 速度/和声色彩/调式] + [6 循环与动态约束]
```

| 段 | 作用 | 示例措辞 | 省略后果 |
| --- | --- | --- | --- |
| 1 用途 | 压住「抢戏」——这一句是 VN BGM 与普通器乐曲的分水岭 | `background music under dialogue, keeps the foreground clear`、`for a visual novel scene, unobtrusive`、`bed for a conversation` | 会得到「一首器乐曲」而非「一段垫乐」；模型倾向把旋律推到前景 |
| 2 风格锚点 | 决定「像不像日系」 | `Japanese-style …`、`anime-style …`（**但不要 `anime opening`**）、`JRPG town theme`、`bittersweet Japanese piano ballad` | 会得到泛用类型（generic piano / generic lo-fi） |
| 3 配器 | 最大的单变量；必须点名 2–4 件并区分主次 | `solo piano with soft sustained strings`、`music box leading, felt piano underneath` | 模型自选配器，极可能填入鼓组与 synth lead |
| 4 情绪 + 走向 | 单写情绪词会被模型拉向中性；**成对写走向**最有效 | `sad but hopeful`、`warm with a quiet sense of loss`、`tense and restrained, no release` | 情感会被弱化（实证指向中性回归） |
| 5 速度/和声色彩 | BPM 与「色彩词」（**不是和弦名**） | `72 BPM`、`in D major`、`major seventh and add9 chords`、`wistful chromatic passing chords`、`minor key with a suspended resolution` | 速度与色调漂移；Lyria/Udio 对 key 敏感，Suno 只作近似 |
| 6 循环与动态 | VN 的硬需求，**别省** | `seamless loop, consistent dynamics throughout, no fade in or fade out, no build, no risers` | 默认给出「有 intro / 有 fade out / 有高潮」的歌曲形态 |

**和声的写法原则（重要）**

- **不要在提示词里写罗马数字或和弦名**（`IV-V-iii-vi`、`Fmaj7-E7-Am7`）。已检索到的官方与权威指南均未把和弦符号列为可识别输入；Udio 文档承认它对 key/mode 名（`A minor`、`Mixolydian`）反应较好，MusicGen 明确**不吃 key signature**。
- 把和声意图**翻译成色彩词与乐器行为**：`warm major seventh chords`、`descending bassline`、`suspended chords that never fully resolve`、`a momentary minor iv`、`bittersweet chromatic passing chords`、`lydian brightness`。
- Suno 的 Lyrics 框支持在歌词里夹带**未文档化的演出 tag**（如 `[Modulation: +1 semitone at last chorus]`、`[Key: E Minor]`、`(building up)`）——一部分社区实践证明有效，但官方 tag 表只承认结构/力度/编制三类，**属 best-effort，不能押注**。（[Suno v5 プロンプト設計書](https://zenn.dev/devp/articles/241a962af54c38)）

### 4.3 稳定引导「日系 Galgame 感」的词汇表

#### 4.3.1 风格锚点词（放在开头）

| 想要 | 措辞 | 备注 |
| --- | --- | --- |
| 通用日系 | `Japanese-style`、`anime-style`、`Japanese piano piece` | `anime-style` 比 `anime opening` 安全得多 |
| 日系钢琴小品 | `Japanese piano ballad`、`Japanese emotional piano piece`、`sentimental piano solo` | |
| 日系游戏配乐 | `JRPG score`、`visual novel soundtrack`、`game soundtrack`、`emotional orchestral with synths` | 注意 `visual novel soundtrack` 本身是 Suno 训练数据里存在的表述（有大量以 `Inspired by visual novel music from the late 90s` 开头的公开 prompt） |
| 城市/成熟 | `city pop`、`urban, cool`、`late-night` | 会带出丸サ進行与 Rhodes |
| 怀旧 90s | `90s-style Japanese trance-pop`、`retro Japanese pop` | 有公开 prompt 用例 |
| 和风 | `traditional Japanese`、`koto and shakuhachi`、`wafu` | Lyria 官方乐器表里有 `Koto`、`Shamisen` |
| 吉卜力抒情 | `Studio Ghibli orchestral, pastoral, warm` | 来源称 `Studio Ghibli / Joe Hisaishi influence` 是**最有效的单一风格锚点**——但注意与艺术家名过滤规则的冲突（见 §4.4.7） |

来源：[raagengine Suno Japanese instrumental](https://raagengine.com/suno-prompt-generator-for-japanese-instrumental-music/)、[Suno 官方公开 playlist 中的 prompt（含 `Inspired by Visual Arts/Key soundtracks (CLANNAD, AIR)`、`Inspired by visual novel music from the late 90s` 等真实用例）](https://suno.com/playlist/4513cddf-b17c-431e-91c6-7160a387dae8)、[Lyria 官方乐器关键词表](https://ai.google.dev/gemini-api/docs/lyria-prompt-guide)

#### 4.3.2 情绪词（模型可识别的固定搭配）

**Lyria 官方 mood 词表（原样照抄可用）**：
`Ambient, Bright, Chill, Dark, Dreamy, Emotional, Ethereal, Euphoric, Funky, Groovy, Melancholic, Nostalgic, Ominous, Psychedelic, Relaxed, Soulful, Triumphant, Upbeat, Whimsical`

**Suno 语境下社区整理的情绪 tag（含解释）**：
`euphoric`（压倒性喜悦）、`melancholic`（苦甜、反思、sad-but-beautiful）、`introspective`（内省）、`nostalgic`（对过去的渴求、温暖的回忆）、`eerie`（不安、诡异、悬疑）、`triumphant`、`intimate`（贴近、私密、低语）、`menacing`、`hopeful`、`heartbreak`、`serene`（平静、安详、漂浮）、`dreamy`、`anthemic`。

**日文来源的情绪-Mood 表（可用于理解语汇对应）**：Dreamy（夢見心地）、Energetic、Melancholic、Romantic、Nostalgic（郷愁）、Upbeat、Dark、Peaceful、Mysterious、Aggressive、Emotional、Playful、Hopeful、Chill、Epic、Tense、Sad。

**走向词（比堆情绪词更有效；这是本报告最推荐的技法）**

| 单写 | 改成 |
| --- | --- |
| `sad` | `sad but hopeful`、`bittersweet yet warm`、`melancholic with a quiet sense of relief` |
| `happy` | `happy but wistful`、`cheerful with a hint of sadness`、`bright with a small ache` |
| `tense` | `tense and restrained, no release`、`sustained unease rather than rising tension` |
| `warm` | `warm and unhurried, with a quiet sense of loss` |
| `calm` | `calm and spacious, slightly lonely` |

来源：[galgame-bgm 既有 skill](../../../apps/server/skills/galgame-bgm/SKILL.md)（本项目既有措辞）、[Suno Style Tag Dictionary](https://github.com/suno-ai-farm/suno-style-tag-dictionary)、[SUNO用音楽プロンプト大辞典](https://note.com/goro_yattemiyo/n/nf009315b5400)、[Lyria 官方](https://ai.google.dev/gemini-api/docs/lyria-prompt-guide)

#### 4.3.3 乐器词（含 Lyria 官方关键词表的直接关联）

**Lyria 官方承认的乐器关键词**（照抄可用；括号内为对 Galgame 的相关性）：

- Keyboards & Synths：`Buchla Synths`、`Clavichord`、`Dirty Synths`、`Harpsichord`、`Mellotron`、`Moog Oscillations`、`Ragtime Piano`、**`Rhodes Piano`**、**`Smooth Pianos`**、`Spacey Synths`、**`Synth Pads`**
- Bass & Drums：`303 Acid Bass`、`808 Hip Hop Beat`、`Boomy Bass`、`Conga Drums`、`Drumline`、`Funk Drums`、`Precision Bass`、`Tabla`、`TR-909 Drum Machine`
- Guitars & Strings：`Banjo`、`Balalaika`、`Bouzouki`、**`Cello`**、`Charango`、`Dulcimer`、`Fiddle`、`Flamenco Guitar`、**`Guitar`**、**`Harp`**、**`Koto`**、`Lyre`、`Mandolin`、`Pipa`、**`Shamisen`**、`Shredding Guitar`、`Sitar`、`Slide Guitar`、**`Viola Ensemble`**、**`Warm Acoustic Guitar`**
- Wind & Brass：`Alto Saxophone`、`Bagpipes`、**`Bass Clarinet`**、`Didgeridoo`、**`Harmonica`**、**`Ocarina`**、`Trumpet`、`Tuba`、**`Woodwinds`**
- Percussion：`Bongos`、`Djembe`、**`Glockenspiel`**、`Hang Drum`、`Kalimba`、`Maracas`、`Marimba`、`Mbira`、`Steel Drum`、**`Vibraphone`**
  （[Lyria prompt guide](https://ai.google.dev/gemini-api/docs/lyria-prompt-guide)）
  **注意：官方表中没有 `celesta` 与 `music box`。** → 在 Lyria 上表达「八音盒/钢片琴」质感时，可用 `Glockenspiel`、`Vibraphone`、`Kalimba`、`Marimba` 作为近似锚点，或在描述层面写 `bell-like high register, delicate`。这是各模型词表不一致的典型案例。

**实践中最有效的 Galgame 配器措辞（跨模型）**

| 需要 | 措辞（英文） |
| --- | --- |
| 独奏钢琴 | `solo piano`、`solo grand piano`、`sparse solo piano`、`felt piano`（弱音/柔化质感） |
| 尼龙木吉他 | `nylon-string guitar`、`fingerpicked acoustic guitar`、`warm acoustic guitar` |
| 八音盒/钢片琴/钟琴 | `music box`、`celesta`、`glockenspiel`、`bell-like high register, delicate` |
| 弦乐铺底 | `soft sustained strings`、`string pad`、`legato strings`、`cello drone`、`solo cello`、`single violin line` |
| 合成器 | `warm analog pad`、`soft synth pad`、`Rhodes piano`、`electric piano` |
| 轻打击 | `brushed drums`、`light shaker`、`soft hand percussion`、`tambourine` |
| 「不抢戏」的乐句 | `answer phrases`、`counter-melody in the low register`、`melody stays within one octave` |

#### 4.3.4 织体与制作词（控制「密度」这个最容易被忽视的维度）

- **稀疏**：`sparse`、`minimal`、`restrained`、`uncluttered`、`thin texture`、`room for voiceover`、`keeps the foreground clear`、`understated`
- **留白**：`long silences between phrases`、`space between phrases`、**`ma`（间，日本美学的「有意留白」）**——来源明确把 `ma instruction: deliberate silence between phrases` 列为「三个最小要素」之一（[raagengine](https://raagengine.com/suno-prompt-generator-for-japanese-instrumental-music/)）
- **混响与空间**：`intimate, close-mic'd`、`dry`、`roomy but not washy`、`wide stereo field`
- **音区约束**：`melody in the middle register`（远离人声 presence 区的做法之一）、`melody stays in one octave`、`do not double the melody in the midrange`
- **制作语言（Udio 尤其有效，Suno 基本无效）**：`mid-forward`、`soft transients`、`mono-compatible`、`vintage tape warmth`、`light tape saturation`

#### 4.3.5 循环与动态词（VN 专用组合，建议整块照抄）

```
seamless loop, loopable, steady tempo, consistent dynamics throughout,
no fade in or fade out, no intro, no outro, no dramatic build, no build-up,
no drop, no riser, no sudden changes, no key change, no tempo change,
even energy from start to finish, no ending flourish, no final impact
```

分层说明（不同模型可用不同措辞）：

- **要给模型的最小集合**：`seamless loop` + `no fade in or fade out` + `consistent dynamics throughout`
- **Suno 加强版**（独立来源反复出现）：`loop-friendly`、`no intro, no outro`、`consistent energy`、`no dramatic changes`、`no sudden hits`、`no long fade out`
- **负向兜底（Suno Exclude 字段）**：`fade out, fade in, build-up, drop, riser, cymbal crash, key change, tempo change, abrupt ending`
- **注意**：`short loop` 这类**长度**要求不要写——生成模型控制不了时长（Lyria 经本机网关固定约 176 秒），写了只会让曲子变潦草。（本项目既有 skill 已记录该实测）

来源：[Suno.ing 独立游戏配乐](https://suno.ing/zh-cn/blog/suno-indie-game-soundtrack-guide/)、[SunoGuide instrumental](https://sunoai.uk/en/guides/suno-instrumental-prompts/)、[SunoMarket](https://sunomarket.com/blog/suno-for-youtube-background-music)、[AI 工具指南](https://aitoolsguidebook.com/zh/articles/suno-game-bgm-prompts/)、[MusicSmith](https://musicsmith.ai/blog/ai-music-generation-prompts-best-practices)、[galgame-bgm 既有 skill](../../../apps/server/skills/galgame-bgm/SKILL.md)

---

### 4.4 负向 / 避坑词表（陷阱词总表）

#### 4.4.1 会把曲子推向「动漫 OP 燃曲」的词

| 陷阱词 | 为什么危险（可查证据） | 改写 |
| --- | --- | --- |
| `anime opening` / `anison` / `OP theme` | 该语义在音乐工业里绑定固定特征：BPM ≈130–180（J-rock OP 常 >170）、失真吉他、live drums「每 4 小节一次 fill，每句一次 crash」、サビ四つ打ち、kime 齐奏、bass 8 分音符推进、16 分钢琴琶音与弦乐 run、开放感大合唱 | `Japanese-style piano piece`、`gentle anime-style BGM` |
| `J-rock` / `rock band` / `powerful guitar riff` / `distorted guitars` | 同上；失真正是 OP 的标志音色 | `nylon-string guitar, fingerpicked`、`clean electric guitar far in the background` |
| `four-on-the-floor` / `yotsuuchi` | OP サビ 的标准节奏型 | `no kick drum`、`no percussion` |
| `TV size` / `90 seconds` / `intro 8 bars, verse 16...` | 这是歌曲结构，不是 BGM 结构；会生成「一次性播完的歌」 | `seamless loop, no intro` |
| `sabi` / `chorus` / `hook` | 会生成有明显副歌的歌曲形态，循环时每圈都回到「副歌高潮」 | `no chorus, no hook, consistent section` |
| `female vocal` + `anime` | 直接得到动画 OP 主题歌 | `instrumental only` |

来源：[Veena 动漫音乐（OP vs BGM 对照表）](https://www.veena.studio/make/anime-music)、[Core Music School アニメOP 作り方](https://core-ms.net/2026/06/30/anime-opening-composition/)、[古賀稔宏 アニソン風](https://kogamusic.net/articles/anison-production.html)、[Tracklister Anison 指南（BPM 分层）](https://tracklist.live/discover/guide/anison)、[openmusicprompt J-pop](https://openmusicprompt.com/suno/pop/j-pop)

#### 4.4.2 会把曲子推向「影视大片／预告片」的词

| 陷阱词 | 风险 | 改写 |
| --- | --- | --- |
| `epic orchestral`、`cinematic`、`trailer`、`hyperorchestral` | 来源明确：`cinematic` 只描述「感觉」而不描述「在画面下如何行为」；trailer 模板必备词汇是 ticking pulses、low brass、hybrid drums、risers、cinematic impacts、decisive final button —— 与 BGM 完全互斥 | `strings and piano, restrained`、`chamber-like`、`intimate` |
| `big impact hit`、`risers`、`whooshes`、`build and drop` | 预告片结构；在循环曲里每圈重复一次 | `no risers, no hits, no drop` |
| `Hans Zimmer` / `John Williams` / `Two Steps from Hell` 等作曲家名 | 会触发过滤或得到「模仿」结果；黑名单对照表把 `Hans Zimmer` 列为应改写成 `epic film score, powerful brass, modern orchestral`（但后者对 VN 同样不合适） | 直接描述你真正要的东西，别引用风格源 |
| `orchestral score` / `full orchestra` / `brass section` / `choir` | 中频被填满，压住台词；VN 学术侧已观察到「纯管弦模型在 VN 里被大幅压缩」 | `soft sustained strings`、`single violin line` |
| `dramatic` / `powerful` / `sweeping` | 会拉大动态（与「平动态」直接冲突） | `restrained`、`understated` |

来源：[MusicPromptPro Suno trailer](https://musicpromptpro.com/topics/suno-prompt-for-cinematic-trailer)、[SunoGuide instrumental BGM（对 "cinematic" 的批评）](https://sunoai.uk/en/suno-instrumental-bgm/)、[Merlini](https://air.unimi.it/retrieve/468ee88e-058a-4bce-a880-30cc71091384/%28Paper%20SOS4%29%20A%20Mukokuseki%20Music.pdf)、[Suno 艺术家黑名单](https://github.com/bitwize-music-studio/claude-ai-music-skills/blob/main/reference/suno/artist-blocklist.md)

#### 4.4.3 会把曲子推向「廉价芯片音／塑料 MIDI 感」的词

| 陷阱词 | 风险 | 改写 |
| --- | --- | --- |
| `8-bit`、`chiptune`、`NES era`、`retro game`、`pixel RPG` | 得到方波/三角波+噪声的芯片音；Suno 官方游戏模板里这是**某一类游戏的正确选择**，但对「日系抒情 VN」是灾难 | `celesta and music box`、`glockenspiel, delicate`、`felt piano` |
| `MIDI`、`General MIDI`、`soundfont`、`FM synth` | 会得到塑料感的 GM 音源演奏 | 点名真实乐器音色与演奏法（`fingerpicked`、`pedal-heavy`、`legato`） |
| `cheap`、`casual mobile game`、`kids game` | 会得到简化的、玩具化的编曲 | `delicate`、`intimate`、`refined` |
| `vocaloid` / `hatsune miku` | 得到电子歌姬声（属人声，违背避让原则） | `no vocals` |

来源：[AI 工具指南 Suno 游戏 BGM 模板](https://aitoolsguidebook.com/zh/articles/suno-game-bgm-prompts/)、[Suno.ing](https://suno.ing/zh-cn/blog/suno-indie-game-soundtrack-guide/)、[Bitwize 音乐技能库](https://github.com/bitwize-music-studio/claude-ai-music-skills/blob/main/reference/suno/artist-blocklist.md)、[Merlini（逆転裁判 = 8-bit + rock 节奏组，作为「有传统的例外」）](https://air.unimi.it/retrieve/468ee88e-058a-4bce-a880-30cc71091384/%28Paper%20SOS4%29%20A%20Mukokuseki%20Music.pdf)

#### 4.4.4 会引入「违和鼓点」的词

| 陷阱词 | 风险 | 改写 |
| --- | --- | --- |
| `drums`、`drum kit`、`beat`、`groove`、`rhythm section` | 一旦给出鼓，模型几乎必然给一个 4/4 backbeat，且会占据中低频、抬高动态 | 明确 `no drums, no percussion`；若确实需要节奏，写 `light shaker`、`soft brushed percussion`、`tambourine only` |
| `EDM`、`electronic dance`、`techno`、`house` | 得到四つ打ち与 build-up/drop | `soft synth pad`、`ambient pulse`（且加 `no beat`） |
| `lo-fi hip hop` / `lofi beats` / `boom-bap` | 会带出 vinyl crackle + 鼓组 + 侧链感；**注意 `nostalgic` 在 Suno 语汇里与 lo-fi 强关联** | `felt piano`、`warm analog warmth`（不要写 lo-fi） |
| `driving drums`、`punchy drums`、`energetic` | 会抬高能量曲线 | `even energy`、`steady` |
| `trap`、`808`、`hi-hat rolls` | 完全异质 | 删除 |
| `taiko`（除非和风战斗/祭典） | 会引入低频重击，压台词 | 仅在世界观/和风场景使用，并压到 `distant taiko far in the background` |

来源：[SunoGuide instrumental](https://sunoai.uk/en/guides/suno-instrumental-prompts/)、[SunoMarket](https://sunomarket.com/blog/suno-for-youtube-background-music)、[JBG 情绪-ジャンル对照表（Nostalgic→Lo-fi Hip Hop）](https://jbg-ongakuin.com/staff-blog/20250807/)、[HookGenius 负向提示词示例](https://hookgenius.app/learn/suno-negative-prompting/)

#### 4.4.5 会引入人声（破坏避让）的词

| 陷阱词 | 结果 | 改写 |
| --- | --- | --- |
| `with vocals`、`female singer`、`male vocal`、`vocalist` | 得到「一首歌」 | 删除；写 `instrumental only` |
| `choir`、`chant`、`gregorian`、`kajiurago`、`angels` | 合唱层会占满中频 | `wordless vocalise, very far in the background`（仅无台词段落） |
| `humming`、`ooh`、`aah`、`vocalise`、`whistling` | 常见的「伪人声」泄漏（模型爱加） | 若不要：`no humming, no whistling, no vocal samples`；若想要一丝人声情绪：`soft wordless humming, no lyrics` |
| `rap verse`、`spoken word` | 明确的人声段落 | 删除 |
| 作者名/歌手名/作品名 | 触发过滤或模仿 | 描述声音特征 |
| 任何**非括号文本写进 Lyrics 框** | Suno：「anything outside brackets gets sung」 | Lyrics 框只放 `[Instrumental]` 或结构 tag |

来源：[blakecrosley Suno 指南](https://blakecrosley.com/guides/suno)、[Suno.ing 器乐指南（anti-vocal 表）](https://suno.ing/blog/suno-instrumental-music-guide/)、[sunoai.uk](https://sunoai.uk/en/guides/suno-instrumental-prompts/)、[SunoMarket](https://sunomarket.com/blog/suno-for-youtube-background-music)、[galgame-bgm skill](../../../apps/server/skills/galgame-bgm/SKILL.md)

#### 4.4.6 会破坏「可循环性」的词

`intro`、`outro`、`fade in`、`fade out`、`build to...`、`building to a climax`、`crescendo`、`explosive chorus`、`drop`、`final hit`、`button ending`、`resolved ending`、`ending flourish`、`long reverb tail`、`upbeat pickup`

→ 全部反向处理：`no intro, no outro, no fade, consistent dynamics, no ending flourish`；并接受「生成出可循环的段落后，在 DAW 里剪到小节线」这一步**不可省略**。

（[MusicSmith：`seamless loop, no fade in/out, no reverb tails` vs `button ending`](https://musicsmith.ai/blog/ai-music-generation-prompts-best-practices)、[Suno.ing 四步循环工作流](https://suno.ing/zh-cn/blog/suno-indie-game-soundtrack-guide/)、[AI 工具指南](https://aitoolsguidebook.com/zh/articles/suno-game-bgm-prompts/)）

#### 4.4.7 「引用了具体来源」的词（版权与过滤）

- Suno **主动过滤真实艺术家/乐队名**；触发后表现为生成失败或结果异常。规则对话是：**「如果你正要敲一个艺术家名，停下来，去描述他们的声音。」**
- 对照表节选（可直接作为改写参考）：
  - `Hans Zimmer` → `epic film score, powerful brass, modern orchestral`
  - `Nobuo Uematsu` → `JRPG score, emotional, orchestral with synths` ← **这两个改写方向在 Galgame BGM 语境下都偏「满」，需要再往回收**
  - `Koji Kondo` → `video game music, melodic, adventurous, iconic`
  - `Danny Elfman` → `quirky film score, gothic, whimsical orchestral`
  - `Vangelis` → `synth soundtrack, atmospheric, epic electronic`
- **大写字词也可能触发误判**：来源建议 tag 尽量小写、简短、避免生僻或像专有名词的词。（[SunoAI Prompt Guide](https://sunoaipromptguide.org/how-to-avoid-artist-name-tags-on-suno-ai/)）
- **与另一来源冲突的记录（并列保留）**：raagengine 声称点名游戏/动画作曲家（Yoko Shimomura、Yasunori Mitsuda、Nobuo Uematsu）以及 `Joe Hisaishi Studio Ghibli influence`「产生非常精确的风格输出」，并称这是其最有效的锚点；而 Suno 侧资料显示真实人名会被过滤。二者的差异可能来自平台（该文覆盖 Suno）与时间，也**可能只是过滤器触发阈值不同**。**实操建议：先试「描写的等效说法」，只有在平台不拦截时才考虑作曲家名。**（[raagengine](https://raagengine.com/suno-prompt-generator-for-japanese-instrumental-music/) vs [SunoAI Prompt Guide](https://sunoaipromptguide.org/how-to-avoid-artist-name-tags-on-suno-ai/)、[黑名单表](https://github.com/bitwize-music-studio/claude-ai-music-skills/blob/main/reference/suno/artist-blocklist.md)）
- **绝对不要写曲名**：`instrumental version of xxx` 等于要求翻唱既有旋律；模型会去找那首曲子。（[galgame-bgm skill](../../../apps/server/skills/galgame-bgm/SKILL.md)）

#### 4.4.8 负向词的「通道」速查（按模型）

| 平台 | 正确通道 | 错误通道（无效或不可靠） |
| --- | --- | --- |
| Suno | **Exclude 字段**（Advanced Options）填 `vocals, singing, humming, spoken word, fade out, build-up, drop, riser, cymbal crash, key change, tempo change`；Instrumental 开关；Lyrics 只用 `[Instrumental]` | 在 Style 里写 `no drums`、`no vocals`（官方口径：**不可靠/会被忽视**） |
| Udio | **Instrumental Mode**；**Style Reduction**（Advanced Controls）；Manual Mode（只用精确 tag，避免自动修饰）；把情绪写进 style prompt 而非依赖未文档化的 tag | 依赖 `[angry verse]` 这类未文档化 tag；用 `|` 堆叠 tag（会被当作字面 section 名） |
| Lyria | 正向替换（`instrumental`、点名配器、`no percussion` 这类描述性短语）；用加权提示词**降低**不想要的元素权重（RealTime） | 无专门的负向字段 |
| MusicGen | 无；只能用正向描述挤压可能性；**多 seed 生成后挑选**是标准缓解手段 | 期待负向词生效 |

来源：[Blake Crosley](https://blakecrosley.com/guides/suno)、[HookGenius](https://hookgenius.app/learn/suno-negative-prompting/)、[Udio Brick Method](https://help.udio.com/en/articles/12232112-the-brick-method-making-udio-work-for-you)、[Udio 模型参考](https://github.com/mikefluff/skills/blob/main/skills/music-prompt/references/models/udio.md)、[aiMusicDaily Udio](https://aimusicdaily.com/udio-prompt-tags)、[Lyria prompt guide](https://ai.google.dev/gemini-api/docs/lyria-prompt-guide)、[MusicGen Prompt Guide](https://geratools.com/musicgen-prompt-guide)

---

### 4.5 修复流程（出得不像时按顺序改，别重写整段）

结合本项目既有 skill 的实战顺序与外部来源的排障表：

1. **换配器**（情绪词不动）——配器是最大的单变量。
2. **加走向**（用 `but` / `yet` 接一个转折，或改为「X and Y 并存」）。
3. **加循环与动态约束**（听着断就往这里调）。
4. **加无人声三重保险**（听着像在唱歌就往这里调）。
5. **调情绪词**——它通常不是问题所在。
6. **查冲突**：正向描述里是否隐含了被排除的元素（例如写了 `emotional` 却又排除 `strings`）。
7. **只改一个变量后再生成**；一次生成约 84 秒（本项目实测），别来回试。

外部来源的「症状 → 处理 → 避免」对照表（Suno 语境，但可迁移）：

| 症状 | 第一步 | 避免 |
| --- | --- | --- |
| 出现人声哼唱 | 强化 `no vocals` 并简化 Style；把排除词写进 Exclude | 加大能量 |
| 太短 | 用 Extend（保持同一 Style） | 整曲重生成（会丢 vibe） |
| 循环接缝差 | 对齐小节 + fade（Studio/DAW） | 硬切 |
| 风格漂移 | 锁定 BPM（±3） | 每次都换全新 Style |
| 中频打架（垫旁白失败） | 简化 Style、降低 presence、减少同时发声层数 | 靠压低总音量硬撑 |

来源：[Suno.ing 器乐指南](https://suno.ing/blog/suno-instrumental-music-guide/)、[SunoGuide instrumental BGM](https://sunoai.uk/en/suno-instrumental-bgm/)、[HookGenius](https://hookgenius.app/learn/suno-negative-prompting/)、[galgame-bgm skill](../../../apps/server/skills/galgame-bgm/SKILL.md)

---

### 4.6 模型能力边界与实测事实汇总

**（1）情绪控制的可预期偏差（可引用的实证结论）**

| 结论 | 出处 |
| --- | --- |
| 商业模型（Suno、Udio）生成的音乐被听者评为**比提示词更愉悦（higher valence）**；开源模型（AudioLDM2、Mustango 等）倾向相反 | [AImoclips](https://arxiv.org/html/2509.00813v2) |
| 所有模型都表现出**向情绪中性回归**的偏差（a bias toward emotional neutrality） | 同上 |
| **arousal 比 valence 更容易被准确传达**（在 valence 上的偏差显著大于 arousal） | 同上；[arXiv 2608.29987](https://arxiv.org/abs/2608.29987) 亦得出「valence 比 arousal 保留得更可靠」的相反表述——两者对「哪个更难」的判断不一致，**并列保留** |
| 情绪命中率按象限不均：**valence 在「低愉悦 + 高唤醒」（angry/anxious/scared）象限最准；arousal 在「高愉悦 + 高唤醒」（happy/excited/energetic）象限最准** | [AImoclips](https://arxiv.org/html/2509.00813v2) |
| 6,086 组 Suno/Udio 「prompt–music」配对的分析：文本 prompt 的 V-A 与生成音乐的 V-A **只有弱但显著的正相关**；且音乐 V-A 中 Q1（高-高）与 Q3（低-低）占绝大多数，**Q2（低 valence + 高 arousal）与 Q4 样本极少** | [Feels in the Music Machine (DiVA)](https://www.diva-portal.org/smash/get/diva2:2009627/FULLTEXT01.pdf) |
| 生成侧：text-conditioned 普遍优于 audio-conditioned；emotion-following 因**音乐类型**差异很大 | [arXiv 2608.29987](https://arxiv.org/abs/2608.29987) |

**对 Galgame BGM 的直接含义（不改写来源结论，仅作映射说明）**：
「伤感」「忧郁」「寂寥」这类**低 valence** 目标是模型最弱的一侧，必须是**冗余表达**（乐器 + 音区 + 稀疏度 + 和声色彩词 + 走向 + 排除句）；而「轻快」「心跳」这类高 arousal 目标相对容易命中。

**（2）Lyria（经本项目 flow2api 网关）的实测事实**

| 项 | 实测值 |
| --- | --- |
| 端点 | `POST /v1beta/models/{model}:generateContent`，`x-goog-api-key` 头 |
| 请求体 | 只有纯文本提示词；**不带 `generationConfig` 也能出音频**（音频字段是否被识别未测出） |
| 返回 | `candidates[0].content.parts[0].inlineData`，mimeType `audio/mp4`，**内联 base64**（无二次下载） |
| 容器/编码 | MP4/M4A（`ftypM4A`），**AAC 48 kHz 立体声** |
| 时长 | **176.06 秒**（固定） |
| 码率/体积 | 105450 bps / 2,320,755 字节（base64 约 3.09 MB） |
| 可用模型 | `flow-music-lyria-3.5`（可用）；`flow-music-lyria-3-pro` 当时 503 |
| 限流 | 连续生成两次后第三次起返回 `503 没有可用的Token进行音频生成`（**令牌池冷却，立刻重试无效**） |

来源：`docs/features/261005-music-generation/261005-music-generation.plan.md`（本项目 2026-10-05 实测记录）

**（3）Lyria 3 产品侧（官方博客）**

- Lyria 3 在 Gemini app 里可生成 **30 秒**原创曲目，输入可以是文字、照片甚至视频（官方博客《Tips for using Google DeepMind's Lyria 3》）。
- 官方建议：从基础提示词起手 → 加乐器/动态/人声细节 → 用「让你想起某段经历」的方式写主题 → 可指定歌手性别、音域（baritone/soprano）、音色（rich, gravelly, soulful, breathy）或合唱。

来源：[Google 博客：Tips for using Google DeepMind's Lyria 3](https://blog.google/products-and-platforms/products/gemini/tips-prompting-lyria-3/)、[DeepMind Lyria prompt guide](https://deepmind.google/models/lyria/prompt-guide/)

**（4）MusicGen 的已知硬边界（官方模型卡原文要点）**

- 无法生成真实人声（`not able to generate realistic vocals`）
- 训练数据为英文描述，其他语言表现下降
- 不同音乐风格与文化表现不均
- **有时会生成「歌曲结束」而塌缩到静音**（`sometimes generates end of songs, collapsing to silence`）——对循环用途是明确风险
- 「有时很难判断什么样的文本描述能得到最好的生成结果，可能需要 prompt engineering」
- 单次约 30 秒；采样优于贪婪；`guidance_scale` 过高会提升文本贴合度但降低音质，官方建议 **3**

来源：[MusicGen 模型卡](https://huggingface.co/facebook/musicgen-medium/raw/76ea784ec523f4c389edf358b127a6bc02a62a52/README.md)、[MusicGen HF 文档](https://huggingface.co/docs/transformers/main/model_doc/musicgen)

**（5）MusicGen Melody（旋律条件生成）**

- 可用旋律（哼唱、任一单旋律线）作为条件，让模型按你描述的风格编配其和声/伴奏——是「先把脑子里的主题变成编配」的最快路径。
- 输入音频**理想上应去掉低频（鼓与贝斯）**；官方建议用 Demucs 分离。
- 与 MusicGen 的机制差异：音频条件是与 decoder hidden states **拼接**，而非 MusicGen 的 cross-attention；音乐生成侧是**延续（continuation）**，Melody 侧是**条件信号**。

来源：[MusicGen Melody 文档](https://huggingface.co/docs/transformers/v5.8.1/model_doc/musicgen_melody)、[Meta AudioCraft](https://audiocraft.metademolab.com/musicgen.html)

---

## 5. 与本项目既有资产的衔接

### 5.1 既有技能与文档

| 资产 | 与本报告的关系 |
| --- | --- |
| `apps/server/skills/galgame-bgm/SKILL.md`（203 行，八段式速查） | 本报告是它的**音乐学与文献依据**。该 skill 的四段式（配器 / 情绪与走向 / 速度·循环 / 用途）、配器选型表、情绪词表、循环句、反例词表均在本报告第 3、4 节得到外部来源支撑与扩充 |
| `apps/server/skills/galgame-audio/SKILL.md` | 免费素材源与授权档次；与本报告的「生成路线」互补 |
| 仓库根 `skills/galgame-audio/SKILL.md` | 选题与授权调研记录（**不参与打包**，`read_skill` 读不到），与生成提示词无关 |
| `docs/features/261005-music-generation/` | `generate_bgm` 工具的接口实测、后台排产、落盘约定；本报告 §4.6(2) 摘录其关键实测值 |
| `library/bgm/` 既有 61 条素材 | 决定了 `mood`/`scene`/`tags` 的可选词表；**生成曲必须落在这些词上**，否则剧作家在混合清单里匹配不到（既有 skill §8 的完整词表） |
| 素材 `volume` 惯例 | 既有 61 条落在 **0.35–0.45**（众数 0.45）；对白垫底取 **0.35–0.40**，情绪重的过场可到 **0.45** |

### 5.2 可直接归档为「本项目参数」的数值（全部有外部来源或实测支撑）

| 参数 | 建议值 | 依据 |
| --- | --- | --- |
| BGM 素材 `volume` | 0.35–0.45 | 既有素材库统计（本项目事实） |
| 生成曲目标响度（若将来做母带归一） | **-16 ~ -14 LUFS** integrated，峰值 ≤ -1 dB | [Suno.ing](https://suno.ing/zh-cn/blog/suno-indie-game-soundtrack-guide/)、[VNDev](https://vndev.wiki/Guide:Balancing_a_Game%27s_Loudness) |
| 与语音的响度差 | 12–18 dB | [note 星野メロ](https://note.com/hoshino2/n/b314e3240b9f) |
| BGM 中频 carve（后期可选） | 1.5–2.5 kHz 缓坡 −2~−3 dB；100 Hz 以下高通 | [BGMer](https://bgmer.net/bgm-ducking-eq-guide/) |
| 引擎侧 ducking（若做） | 声起 −4~−8 dB，attack 0.3–0.5 s 级；或 Ren'Py 式 `emphasize_audio` 降到 90% | [BGMer](https://bgmer.net/bgm-ducking-eq-guide/)、[CuteShadow](https://cuteshadow.itch.io/tokidoki-tactical-squad/devlog/1083680/audio-mixing-va-for-renpy-dummies-me) |
| 循环句（提示词最小集合） | `seamless loop, consistent dynamics throughout, no fade in or fade out` | 多来源交集 |
| 无人声三重保险 | Style 前置 `instrumental, no vocals` + Instrumental 开关 + `[Instrumental]` + Exclude `vocals` | [Suno.ing](https://suno.ing/blog/suno-instrumental-music-guide/)、[Blake Crosley](https://blakecrosley.com/guides/suno) |
| 一次生成耗时 | 约 84 秒（Lyria via flow2api，输出约 176 秒） | 本项目实测 |

### 5.3 本报告未能解决 / 需要后续验证的问题

1. **Lyria 的循环能力上限**：官方文档没有「循环」相关参数或措辞说明；「`seamless loop` 在 Lyria 3.5 上是否被理解」没有官方或第三方证据。→ 需要本项目自行做提示词对照实验（建议变量：`seamless loop` 有无 × `consistent dynamics` 有无 × `no fade` 有无）。
2. **`generationConfig` 的音频字段**：本机网关忙时未能测出；若支持时长参数，循环设计空间会显著扩大。（`docs/features/261005-music-generation/` 已记录待补测）
3. **`celesta` / `music box` 是否被 Lyria 识别**：官方乐器关键词表里没有；本报告只能给近似替代（glockenspiel / vibraphone / kalimba / marimba）。→ 值得实测。
4. **作曲家名是否被 Suno 过滤**：两个来源矛盾（raagengine 称有效；Suno 侧资料称会被过滤）。→ 若要用，需实测。
5. **「Galgame 感」缺少可直接引用的量化基准**：目前只能引用「VN 之 home styles 多元」「纯管弦比重低」「电子+管弦 / 8-bit+摇滚 两个极端案例」这类定性结论（Merlini）；**没有找到「以 N 首 galgame BGM 为样本的和声/配器统计」**。这是一处明确的知识空缺。
6. **物哀（mono no aware）与音乐的对应**：检索到日语侧大量「郷愁／懐かしさ／ノスタルジック」的技术文章，但**没有找到把「物哀」作为音乐学概念系统展开的文献**；本报告 §3.3 用「nostalgic + 静默的丧失感」作为操作化表述，属外推而非直接引用，使用时需注意。
7. **FP 基础事实的时效**：DOVA-SYNDROME → OpenTracks 改名（2026-09-15）、Suno 版本与过滤策略、Lyria 版本（3.5）都在快速变化；本报告的事实以 2026-10-12 的检索结果为准。

---

## 6. 参考来源清单（按主题索引）

> **引用格式说明**：表中少量条目使用 `https://exa.ai/library/publication/<id>` 形式的链接——这是检索工具返回的**文献库指针**，不是出版商页面，可能无法直接打开。这类条目均已在表内补齐题名/作者/年份，可据此另行检索：
>
> - Mireault, Julie. *No slaughter without laughter?: music and genres in Japanese popular media*（《寒蝉鸣泣之时》相关章节；含 loop/硬切、safe vs threatening music 分类、Simon Wood 的 ambient piece 定义）
> - Andô, Masateru (1989). *Koto scales and tuning*（含十个主要 choshi 的使用频率统计：平調子 40.0%、半雲井調子 24.4%、雲井調子 21.1%，in 系合计 91.1%）
> - 大畑耕一 (1990). 「ヨナ抜き長音階に関する歴史的・分析的考察」（日本小学音乐课程中的五声音阶）
>
> 另：`https://suno.com/playlist/4513cddf-...` 是一条 Suno 官方公开播放列表，用于展示真实用户提示词写法（含 `Inspired by Visual Arts/Key soundtracks (CLANNAD, AIR)`、`Inspired by visual novel music from the late 90s` 等在野用例），**不是权威规范**，仅作语料参考。

### 6.1 和声 / 音乐理论（日文为主）

| 主题 | 链接 |
| --- | --- |
| 三大進行（カノン・小室・王道）的用法与派生 | https://jbg-ongakuin.com/staff-blog/20250808/ |
| 機能和声与 11 种定番進行一览（含コンファメ進行） | https://jbg-ongakuin.com/staff-blog/20250807/ |
| 王道進行（4536）结构与「切なさ」成因 | https://vrpiano.co.jp/chord/oudou/ |
| 定番 5 進行对照表 | https://vrpiano.co.jp/chord/chord-progression/ |
| 王道進行：Wikipedia（命名史、亀田誠治、純情進行） | https://ja.wikipedia.org/wiki/%E7%8E%8B%E9%81%93%E9%80%B2%E8%A1%8C |
| 王道進行派生 3 型与用例曲 | https://music-studio.jp/royal-road-progression/ |
| 王道進行别名与派生（含パッシングディミニッシュ、ピカルディ） | https://er-music.jp/theory/702/ |
| アニソン进行速查（4536 / 436丸サ / 6451） | https://bassnote.jp/blog/chord-progression/ |
| 丸サ進行（Just the Two of Us）：音乐评论角度 | https://www.nippon.com/ja/japan-topics/g01096/ |
| 丸サ進行：10 曲分析 | https://ongakuroom.com/just-the-two-of-us_bunseki/ |
| 丸サ進行：调性分析（三个变体、两个 dominant motion） | https://mugwort.me/major-minor-tonality-music_297/ |
| 丸サ進行：理论教程（セカンダリードミナント / モーダルインターチェンジ / 简化版） | https://note.com/soundwitches/n/n62d9d7eb0174 |
| 泣ける進行 10 選（クリシェ、IVm、半音進行、四和音） | https://sakkyoku.info/beginner/cry-chord-progression-pattern/ |
| 悲しい進行（下行、未解決、maj7/add9/sus4） | https://waon-i.com/kg095/ |
| ノスタルジック進行（I→Imaj7→I7→IV 等） | https://waon-i.com/kg131/ |
| 泣きメロの作り方（着地点、サビ集中、落差） | https://liveartist.info/naki-mero/ |
| エモい進行（情绪—进行—场景对照表） | https://kennelmusic.com/emotional-chord-progressions-songwriting-guide/ |
| 日本音階（ヨナ抜き、平調子、陰音階、岩戸、陽音階） | https://www.masterthescore.com/article/japanese-scales |
| In scale / miyako-bushi / Sakura 音階 | https://en.wikipedia.org/wiki/In_scale |
| Japanese scales 概览 | https://www.musicnotes.com/blog/japanese-scales-in-music-theory/ |
| 箏の調弦（choshi）、半音与平均律偏差 | https://exa.ai/library/publication/d0hns2mcy7r |
| ヨナ抜き長音階の歴史的考察（1990, 大畑耕一） | https://exa.ai/library/publication/qtz3shj99wc |
| Lydian 在游戏配乐中的案例研究 | https://music-dictionary.org/music-theory/modes/lydian-mode-video-game-soundtracks-case-studies/ |
| Genshin Main Theme = G/C Lydian（Hooktheory） | https://www.hooktheory.com/theorytab/view/yu-peng-chen/genshin-impact-main-theme |
| Zelda OoT 主题分析（Lydian / Yo / Mario cadence / Mitsuda lick） | https://videogamemusicshrine.com/inside-the-score-the-legend-of-zelda-ocarina-of-time-original-soundtrack-title-theme-opening/ |
| 久石让「One Summer's Day」分析（quartal、sus4、Lydian） | https://rsucon.rsu.ac.th/files/proceedings/intersoc2021/1923_20210514184537.pdf |
| Superstar Saga（下村陽子）D♭ Lydian（Hooktheory） | https://www.hooktheory.com/theorytab/view/yoko-shimomura/superstar-saga---stardust-fields |
| 游戏 OST 的和声功能可塑性（Euromac 11） | https://euromac11.sciencesconf.org/699884 |

### 6.2 视觉小说 / 日系配乐的学术与评论

| 主题 | 链接 |
| --- | --- |
| Merlini, *A Mukokuseki Music?*（JRPG/VN 的垂直折衷主义、VN 纯管弦比重低、Fate 与逆転裁判对照、MONACA） | https://air.unimi.it/retrieve/468ee88e-058a-4bce-a880-30cc71091384/%28Paper%20SOS4%29%20A%20Mukokuseki%20Music.pdf |
| Merlini, *The Vibes of Cool Opulence*（东西方混合节奏的文化差异） | https://www.researchgate.net/publication/393607978_The_Vibes_of_Cool_Opulence_Hybrid_Rhythms_in_Eastern_and_Western_Video_Game_Music |
| Mireault, *No slaughter without laughter?*（《寒蝉》的 loop 与硬切、safe vs threatening music、Wood 的 ambient piece 定义） | https://exa.ai/library/publication/4n6dxdfx1gm |
| Kishōtenketsu as Leitmotif（FF7 主题与 Tarnhelm 进行，Journal of Sound and Music in Games） | https://online.ucpress.edu/jsmg/article/4/4/15/197773/Kishotenketsu-as-LeitmotifStorytelling-and-Musical |
| Key Sounds Label 作曲家与作品年表 | https://en.wikipedia.org/wiki/Key_Sounds_Label_discography |
| Key 社音乐观察（Kanon/Air/Clannad vs Angel Beats 的 synth 依赖对比） | https://chikorita157.com/2010/08/25/the-observation-of-music-from-keys-visual-novels/ |
| KSL 作曲家写作习惯（折戸治伸的 violin drone 与「钢琴+鼓」） | https://forum.kazamatsuri.org/t/ksl-composers-topic/2825 |
| Jun Maeda 专题（Winter Fireworks / Natsukage / Nagisa / Country Train） | https://blog.animeinstrumentality.net/composer-profiles/composer-of-the-month-jun-maeda/ |
| Clannad OST 逐曲评论（含「TOE 不循环」） | https://vgmonline.net/clannad/ |
| Jyuzaengi 评论（「composer 风格 perfect for visual novels」清单 + 全合成管弦的音色平坦问题） | https://www.rpgfan.com/music-review/jyuzaengi-engetsu-sangokuden-original-soundtrack/ |
| Steins;Gate OST 评论（Gate of Steiner、SERN、Yanagibayashi） | https://vgmonline.net/steinsgate/ |
| Steins;Gate Complete 评论（主题变奏、8-bit 变体专辑） | https://www.rpgfan.com/music-review/the-sound-of-steinsgate-complete/ |
| 梶浦由記与 neo-medieval（modal 音阶、Kajiurago、应声） | https://mutualimages-journal.org/index.php/mi/article/download/119/95 |
| 大逆转裁判角色主题论文（tempo/instrument/tonality/timbre/mood 分析框架） | https://jyx.jyu.fi/bitstreams/b2956747-d02a-48ab-ab3e-48ec3742d4c4/download |
| 知乎：日本 Galgame 配乐为何水准高（素材社群 + 手法同质化） | https://www.zhihu.com/en/answer/1867974972 |

### 6.3 视觉小说音频工程（循环、动态、响度）

| 主题 | 链接 |
| --- | --- |
| VNDev Wiki：动态音频完整手册（替换/操纵/交互/随机、Mycorrhiza 案例） | https://www.vndev.wiki/Guide:Dynamic_audio_in_visual_novels |
| VNDev Wiki：响度平衡（VN 实测 LUFS 表、anchor element、-1 dB 峰值） | https://vndev.wiki/Guide:Balancing_a_Game%27s_Loudness |
| Ren'Py Audio 官方文档（通道、loop、synchro_start、partial playback、音量乘法） | https://www.renpy.org/doc/html/audio.html |
| Ren'Py 混音实务（emphasize_audio、voice -16 LUFS、响度排序） | https://cuteshadow.itch.io/tokidoki-tactical-squad/devlog/1083680/audio-mixing-va-for-renpy-dummies-me |
| Ren'Py 分层动态音乐实现（synchro_start + set_volume） | https://itch.io/devlog/548526/how-to-add-dynamic-audio-in-renpy-its-easier-than-you-think.amp |
| 循环点与残响尾（folded tail / two-voice overlap） | https://www.austinhaynesmusic.com/rpg-maker-music-loops |
| 残响尾为何在循环点断裂 | https://austinhaynes.itch.io/loopsmith/devlog/1581065/why-reverb-tails-break-at-game-music-loop-points |
| Loopsmith 1.2.0（单文件 folded tail、循环验证） | https://austinhaynes.itch.io/loopsmith/devlog/1570962/loopsmith-120-seamless-single-file-loops-and-a-way-to-prove-they-loop |
| 手工剪辑循环与残响尾迁移（含 Winifred Phillips 建议） | http://natecombsmusic.blogspot.com/2015/02/video-game-audio-how-to-make-smooth-and.html |
| Vorbis 循环元数据全格式对照（LOOPSTART / LOOP_START / smpl） | https://bgm13.com/posts/vorbis-loop.html |
| loop-ogg（LOOP_MIX 与两套标准） | https://github.com/SolraBizna/loop-ogg |
| Crispy Doom 的 LOOP_START/LOOP_END 实现 patch（解析逻辑） | https://code.idtech.space/crispy/crispy-doom/commit/797a9a563b2e90849bc6eb79169a9381896eeb15.patch |
| Solarus 论坛：OGG 无缝循环教程（Audacity 找点） | https://forum.solarus-games.org/en/index.php?topic=1390.0 |
| 游戏循环与听觉疲劳模型（重复次数容忍度、5 种缓解方案） | https://www.gamedeveloper.com/audio/rethinking-the-audio-loop-in-games |
| 游戏音频的 nuisance score 与调性冲突实验（Am vs B♭） | https://www.asoundeffect.com/game-audio-immersion/ |
| 游戏音乐制作实务（无缝循环 5 铁则、各场景 BGM 参考与循环长度） | https://core-ms.net/2026/03/23/dtm-game-music-production/ |
| 剧伴制作实务（cue sheet、BPM 分层、EQ 与 -23 LUFS 广播基准） | https://core-ms.net/2026/07/20/anime-music-composition-method/ |
| 游戏音乐委托规格书（必须 5 项、「避けたいもの」最重要） | https://leveluptime.net/archives/1246 |
| BGM 发注仕様書写法（7 项模板、参考曲传法、修正指示写法） | https://leveluptime.net/archives/1226 |
| 游戏 BGM 曲数目安（VN 按「画面数 + 状态数」估算） | https://leveluptime.net/archives/1225 |
| 作曲家工作流（音色先决、减法做旋律、ループチェック、响度） | https://leveluptime.net/archives/492 |
| VN 制作实务（BGM 数量与素材音量平衡） | https://soramania.com/game-production-se-bgm/ |
| 美少女ゲーム BGM 发注实例（感动曲 = 主题歌变奏，「溜め」的使用限度） | https://note.com/ryodist/n/n4bd037e012de |

### 6.4 人声避让 / 混音 / 心理声学

| 主题 | 链接 |
| --- | --- |
| 游戏语音制作与掩蔽（1–4 kHz 清晰度、120–300 Hz 体感、4–10 kHz 摩擦音） | https://sonusgearflow.com/musicproduction/vocal-production-for-game-audio-production |
| 游戏音频 sidechain 工程（多带 ducking 数值、K-weighting、时序常数） | https://sonusgearflow.com/musicproduction/sidechain-compression-for-game-audio-production |
| 为何 BGM 与对白打架及修正（1 kHz cut 8–10 dB、音乐推子 -24 dB） | https://riotanthemstudios.com/blog/why-your-background-music-fights-your-dialogue-and-how-to-fix-it |
| 有声与 BGM 的频段与 EQ（1–3 kHz 冲突、1.5–2.5 kHz dip 2–3 dB、100 Hz 高通、ducking -4~-8 dB） | https://bgmer.net/bgm-ducking-eq-guide/ |
| 旁白与 BGM 的平衡（250 Hz–4 kHz、-18~-24 dB、差 12–18 dB、ducking -6 dB/300–500 ms） | https://note.com/hoshino2/n/b314e3240b9f |
| 旁白优先的架构（音量、带宽、编曲、段落抑扬四件事一起设计） | https://kobatee.jp/blog/auto-article-2025-08-25/ |
| 对照实验：只降音量 vs 减音数（BGM -11.8 dB 仍可能抢戏） | https://namazu.works/guides/bgm-under-narration |
| 游戏音频 ducking 的系统化做法（FMOD、总线层级、优先级） | https://www.gamedeveloper.com/audio/game-audio-theory-ducking |
| 突然大音量与惊吓反应（参数驱动的 shock response、静默后最有效） | https://vbn.aau.dk/ws/portalfiles/portal/549530933/Tom_Garner_13.pdf |
| 音量—恐惧/焦虑实验（音量 2.0/2.3/2.8；随机时机与无明确声源更能制造焦虑） | https://ahmedam.com/wp-content/uploads/2017/12/abdelmeguid_thesis.pdf |
| 生存恐怖音效参数预实验（pitch / 3D / loudness 处理；silence 间隔） | https://vbn.aau.dk/ws/portalfiles/portal/61575828/a_preliminary_experiment_MG.pdf |
| 环境音/角色音对玩家体验的影响（MDPI 2024） | https://www.mdpi.com/2076-3417/14/2/583 |

### 6.5 乐器声学

| 主题 | 链接 |
| --- | --- |
| Celesta（音域 C4–C8、4186 Hz、移调、与 glockenspiel 对比） | https://en.wikipedia.org/wiki/Celesta |
| Celesta 在古典与影视配乐中的语义（Nutcracker / Holst / Bartók / Ravel） | https://www.classical-music.com/features/instruments/celesta |
| Celesta 构造与演奏特性详解（共鸣箱、八度移调、与钢琴/木琴对比） | https://instrumentheritage.com/celesta-instrument/ |
| Celesta 听辨要点（避免把「magical / holiday」当作听辨特征） | https://instrumentsounds.org/instruments/celesta/ |

### 6.6 生成模型官方文档与提示词工程

| 主题 | 链接 |
| --- | --- |
| Lyria prompt guide（Gemini API，含完整乐器/风格/情绪关键词表、RealTime 加权提示词） | https://ai.google.dev/gemini-api/docs/lyria-prompt-guide |
| Lyria 音乐生成 prompt guide（Vertex AI，结构化框架原文） | https://cloud.google.com/vertex-ai/generative-ai/docs/music/music-gen-prompt-guide |
| 同文（Gemini Enterprise Agent Platform 版） | https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/music/music-gen-prompt-guide |
| DeepMind Lyria prompt guide | https://deepmind.google/models/lyria/prompt-guide/ |
| Google 博客：Lyria 3 提示技巧（30 秒曲目、乐器/人声指定） | https://blog.google/products-and-platforms/products/gemini/tips-prompting-lyria-3/ |
| MusicGen HF 文档（30 秒限制、guidance_scale、音频条件机制） | https://huggingface.co/docs/transformers/main/model_doc/musicgen |
| MusicGen 模型卡（已知局限、采样、响度归一化） | https://huggingface.co/facebook/musicgen-medium/raw/76ea784ec523f4c389edf358b127a6bc02a62a52/README.md |
| MusicGen Melody（旋律条件生成、Demucs 预处理） | https://huggingface.co/docs/transformers/v5.8.1/model_doc/musicgen_melody |
| Meta AudioCraft MusicGen 项目页（chromagram 旋律引导、长序列窗口法） | https://audiocraft.metademolab.com/musicgen.html |
| MusicGen Prompt Guide（四段式、句子优于 tag、多 seed） | https://geratools.com/musicgen-prompt-guide |
| Suno 指南（Style/Lyrics/Exclude 三字段、无 official no-vocals tag、混音术语被忽略、BPM 仅近似） | https://blakecrosley.com/guides/suno |
| Suno 提示词最佳实践（字段长度、结构 tag、负向提示、loop 用语） | https://musicsmith.ai/blog/ai-music-generation-prompts-best-practices |
| Suno 器乐提示词（Style 公式、loopable、anti-vocal 强化表） | https://sunoai.uk/en/guides/suno-instrumental-prompts/ |
| Suno 器乐 BGM 设计（对 "cinematic" 的批评、密度/音区/编排留白、loop QA） | https://sunoai.uk/en/suno-instrumental-bgm/ |
| Suno 器乐完整指南（六套场景模板、伪人声抑制、Loop 设计与 DAW 流程） | https://suno.ing/blog/suno-instrumental-music-guide/ |
| Suno 负向提示词（Exclude 字段写法 + 50 例） | https://hookgenius.app/learn/suno-negative-prompting/ |
| Suno 提示词避坑（Style 里否定不可靠、artist name、dynamics 是全部） | https://sunomarket.com/blog/suno-for-youtube-background-music |
| Suno AI 艺术家黑名单与改写对照表 | https://github.com/bitwize-music-studio/claude-ai-music-skills/blob/main/reference/suno/artist-blocklist.md |
| 如何避免触发 Suno 的艺术家名过滤 | https://sunoaipromptguide.org/how-to-avoid-artist-name-tags-on-suno-ai/ |
| Suno Style Tag Dictionary（情绪/乐器 tag 说明） | https://github.com/suno-ai-farm/suno-style-tag-dictionary |
| Suno v5 プロンプト設計書（meta tag 全表、除外プロンプト、演出 tag） | https://zenn.dev/devp/articles/241a962af54c38 |
| SUNO用 音楽プロンプト『大』辞典（7 要素构造、Mood 表、Situation 表） | https://note.com/goro_yattemiyo/n/nf009315b5400 |
| Suno 日本語器乐 14 模板（音阶选用、作曲家锚点主张） | https://raagengine.com/suno-prompt-generator-for-japanese-instrumental-music/ |
| Suno 独立游戏配乐实战（场景时长/BPM/循环矩阵、三处最常见的坑） | https://suno.ing/zh-cn/blog/suno-indie-game-soundtrack-guide/ |
| Suno 游戏 BGM 10 模板（BPM 与 key 的分场景取值、loop 工作流） | https://aitoolsguidebook.com/zh/articles/suno-game-bgm-prompts/ |
| Suno 官方公開 playlist（真实 prompt 用例，含 key/VN 相关表述） | https://suno.com/playlist/4513cddf-b17c-431e-91c6-7160a387dae8 |
| Suno J-pop / Anime 风格 prompt 集 | https://openmusicprompt.com/suno/pop/j-pop |
| Suno trailer 提示词（陷阱词的来源模板） | https://musicpromptpro.com/topics/suno-prompt-for-cinematic-trailer |
| Suno YouTube 背景音乐 prompt（"no vocals / seamless loop / even energy" 范式） | https://musicpromptpro.com/topics/suno-prompt-for-youtube-background-music |
| Udio：Prompt Like a Master（要素清单、Style Reduction、Manual Mode） | https://help.udio.com/en/articles/10716541-prompt-like-a-master |
| Udio：Brick Method（固定顺序与下划线规则） | https://help.udio.com/en/articles/12232112-the-brick-method-making-udio-work-for-you |
| Udio：guidance tags 官方列表 | https://help.udio.com/en/articles/11166249-level-up-your-creations-with-guidance-tags |
| Udio tag 与 style 指南（生产术语接受度、key/mode、原子 tag） | https://aimusicdaily.com/udio-prompt-tags |
| Udio 模型参考（弱项、不堆叠 tag、artist-voice 过滤） | https://github.com/mikefluff/skills/blob/main/skills/music-prompt/references/models/udio.md |
| AI 生成音乐用于游戏（loop 优先、与 SFX 频率冲突的测试清单） | https://makeasongai.com/zh-TW/blog/ai-music-for-games |

### 6.7 情绪可控性的实证研究

| 主题 | 链接 |
| --- | --- |
| AImoclips：TTM 情绪传达基准（12 情绪词、四象限、商业模型偏正向、中性回归） | https://arxiv.org/html/2509.00813v2 |
| LARA-Gen：连续 valence-arousal 控制（文本情绪词的语义模糊性） | https://arxiv.org/abs/2510.05875 |
| Feels in the Music Machine：Suno/Udio 6086 组 prompt–music V-A 相关性 | https://www.diva-portal.org/smash/get/diva2:2009627/FULLTEXT01.pdf |
| Symbolic Music Generation Conditioned on Continuous-Valued Emotions | https://recipp.ipp.pt/server/api/core/bitstreams/ced2cf94-4a21-456d-856e-83cd92fe734b/content |
| How Well Do Generative Music Models Follow Emotion Conditioning?（text > audio） | https://arxiv.org/abs/2608.29987 |

### 6.8 动漫 OP / アニソン 的对照特征（用于界定「不要什么」）

| 主题 | 链接 |
| --- | --- |
| Anison 完整指南（BPM 分层、TV size 90–120 秒、编曲特征） | https://tracklist.live/discover/guide/anison |
| 动漫 OP 的音乐特征表（BPM 120–180、失真吉他+synth、90 秒–2 分） | https://soundcy.com/article/what-anime-openings-sound-like |
| 动漫音乐制作（OP 与 BGM 的逐项对照表、四段式小节数、kime、tenchou） | https://www.veena.studio/make/anime-music |
| アニメOP 作曲法（BPM 150–180、Bメロ 溜め → サビ 解放、DTM 混音数值） | https://core-ms.net/2026/06/30/anime-opening-composition/ |
| アニソン風の作り方（160–185 BPM、編成、Bメロ 抜き、コード选型） | https://kogamusic.net/articles/anison-production.html |
| AMV 场景的 AI 工作流（`anime opening style`、`epic chorus` 这类词的典型使用语境） | https://suno.bi/zh/blog/amv-ai-anime-music-video-workflow |
| 独立游戏 AI 音乐指南（提示词公式、Audacity 循环后期、Cocos 实现） | https://jishuzhan.net/article/2050171520824180737 |

### 6.9 项目内既有文档

| 文件 | 用途 |
| --- | --- |
| [`apps/server/skills/galgame-bgm/SKILL.md`](../../../apps/server/skills/galgame-bgm/SKILL.md) | 生成 BGM 的提示词速查（本报告的实践落点） |
| [`apps/server/skills/galgame-audio/SKILL.md`](../../../apps/server/skills/galgame-audio/SKILL.md) | 免费素材源与授权档次 |
| [`docs/features/261005-music-generation/261005-music-generation.plan.md`](../../261005-music-generation/261005-music-generation.plan.md) | `generate_bgm` 接口实测与设计决定 |
| [`docs/features/261005-music-generation/261005-music-generation.summary.md`](../../261005-music-generation/261005-music-generation.summary.md) | 交付摘要 |
| [`docs/references/260914-free-online-audio-sources.md`](../../references/260914-free-online-audio-sources.md) | 免费在线音频源 |

---

*报告结束。所有事实性陈述均标注来源；来源之间的矛盾已并列保留（§4.4.7 作曲家名过滤、§4.6(1) valence/arousal 难度）。具备实操指导意义的具体数值集中在 §3.0 的 BPM 表、§3.1–3.7 的提示词模板、§4.3 的词汇表、§4.4 的陷阱词表与 §5.2 的项目参数表。*
