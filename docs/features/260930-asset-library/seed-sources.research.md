# 260930 · 二次元 galgame 素材资源库 —— 可再分发素材来源调研

> 调研日期：2026-09-30　执行环境：Android Linux 容器，墙外站点走 `http://127.0.0.1:7890` 代理
> 目标：给「应用级素材资源库」找一批**可程序化下载**、**许可证允许再分发**的 BGM / SFX / 背景图 / 立绘种子素材
> 验证方式：每条直链都跑过 `curl -sIL`（直连优先、失败回退代理），多份包**实际下载并用 `file` / `ffprobe` 核对字节**

---

## 0. TL;DR

- **本调研的筛选条件比"能商用"严格得多**：素材目录要进 git、要随剧目包导出 = **把音频/图片原文件本身再分发**。绝大多数"免费商用音乐站"在这一条上直接出局。
- **可用主力只有三个半**：
  1. **OpenGameArt.org（CC0 条目）** —— 绝对主力。SFX 与 BGM 都有**直链 zip/单文件**，无需登录、无需 API key，CC0 无署名负担，102 条链接全部实测 200。
  2. **incompetech / Kevin MacLeod（CC BY 4.0）** —— BGM 品质最好的一档，**且站点提供机器可读目录 `pieces.json`（1443 首）**，直链 mp3 规则稳定。代价：必须署名，且单文件 5.5–6.5 MB。
  3. **Wikimedia Commons（Public Domain / CC0 / CC-BY）** —— 拟音（door/chime/clock/typing/rain/thunder/heartbeat）的富矿，`upload.wikimedia.org` 直链极干净。
  4. 半可用：**Kenney.nl（CC0）**、**Openverse API（CC0/PD 图片）**。
- **两个重大发现**：
  - **freepd.com 已于 2026-01-31 永久关站**（17 年老牌 CC0 音乐站）。此前项目内的 `260928-free-galgame-audio-assets.research.md` 仍把它列为 Tier 1，**该结论已过期**，需更正。
  - **背景图与立绘存在真实缺口**：合规（可再分发）的**二次元 16:9 场景背景**和**透明多表情立绘**在所有主流 CC0 站上**几乎不存在**。详见 §2.5。
- **推荐下载清单共 62 条**：BGM 20 / SFX 33 / 背景 9 / 立绘 0（缺口，见 §2.5）。全部 id 符合 `^[a-z][a-z0-9_]*$`，无重复。

---

## 1. 来源清单

### 1.1 OpenGameArt.org（CC0）—— 绝对主力

- **站点**：https://opengameart.org
- **CC0 检索页**（可脚本化，已实测）：

  ```
  https://opengameart.org/art-search-advanced?keys=&field_art_type_tid[]=13&field_art_licenses_tid[]=4&sort_by=count&sort_order=DESC&items_per_page=120
  # 13=Sound Effect, 12=Music, 9=2D Art
  # 许可 tid：CC0=4，CC-BY 3.0=2，CC-BY 4.0=17981，CC-BY-SA 3.0=3，CC-BY-SA 4.0=17982
  ```

- **许可**：逐条目独立标注。CC0 = 公有领域奉献，**可再分发、无署名义务**，本项目唯一无合规摩擦的一档。
- **直链规律**：`https://opengameart.org/sites/default/files/<文件名>`，公开可 curl。
- **代理**：**全部 102 条直链直连即可 200，未使用代理**。这是它相对其他源的最大工程优势。
- **条目级许可原文提取方法**（本调研用来避免误判）：

  ```
  curl -s 'https://opengameart.org/content/<slug>' | grep -o 'License(s):[^<]*'
  ```

  实测输出示例：`License(s): CC0`（512 Sound Effects，author=`subspaceaudio`）。

#### 1.1.1 SFX 集合（实测直链，格式 / 体积 / 内容）

| 条目页 | 作者 | 许可 | 直链 | 实测 | 内容与听感 |
|---|---|---|---|---|---|
| [512 Sound Effects (8-bit style)](https://opengameart.org/content/512-sound-effects-8-bit-style) | subspaceaudio | CC0 | `https://opengameart.org/sites/default/files/The%20Essential%20Retro%20Video%20Game%20Sound%20Effects%20Collection%20%5B512%20sounds%5D.zip` | `200` `application/zip` **20,582,855 B** | 512 个 8-bit wav。**含 `Movement/Opening Doors/sfx_movement_dooropen1..4.wav`、`Movement/Footsteps/sfx_movement_footstepsloop3_slow.wav` 等成组条目**，galgame 常用项一网打尽 |
| [RPG Sound Pack](https://opengameart.org/content/rpg-sound-pack) | artisticdude | CC0 | `.../files/rpg_sound_pack.zip` | `200` `application/zip` **12,465,564 B** | 249 条 wav，分 `battle/`（magic1、spell、swing1/2/3）等目录。魔法/挥击演出音 |
| [50 RPG sound effects](https://opengameart.org/content/50-rpg-sound-effects) | kenney | CC0 | `.../files/RPGsounds_Kenney.zip` | `200` `application/zip` **690,952 B** | 104 文件 ogg。**`OGG/bookFlip1..3.ogg`、`bookOpen.ogg`、`bookClose.ogg`、`bookPlace1/2.ogg`、`beltHandle1/2.ogg`** —— 翻书/开关书/放书的最优解 |
| [Interface Sounds](https://opengameart.org/content/interface-sounds) | kenney | CC0 | `.../files/kenney_interfaceSounds.zip` | `200` `application/zip` **834,536 B** | 104 文件 ogg。`Audio/click_001..005.ogg`、`back_001..004`、`close_001..004`、`confirmation_001..`。UI 四件套 |
| [85 Short music jingles](https://opengameart.org/content/85-short-music-jingles) | kenney | CC0 | `.../files/jingleSounds_Kenney.zip` | `200` `application/zip` **1,089,319 B** | 92 文件 ogg，`OGG/jingles_HIT/jingles_HIT00..17.ogg` 等。转场/提示短音 |
| [Different steps on wood, stone, leaves, gravel and mud](https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud) | tinyworlds | CC0 | `.../files/%5Bkdd%5DDifferentSteps_0.zip` | `200` `application/zip` **77,711 B** | 8 个 ogg：`wood01-03` / `stone01` / `leaves01-02` / `gravel` / `mud02`。**脚步五材质，全套只有 77 KB** |
| [Platformer Sounds: Terminal, Interaction, Door...](https://opengameart.org/content/platformer-sounds-terminal-interaction-door-shots-bang-and-footsteps) | yd | CC0 | `.../files/yd-Sounds.zip` | `200` `application/zip` **172,479 B** | 14 文件 ogg：`yd-Sounds/door_open.ogg`、`steps_stairs.ogg`、`steps_platform.ogg`、`boxopen.ogg`、`beep_message.ogg` |
| [Door Open, Door Close Set](https://opengameart.org/content/door-open-door-close-set) | qubodup | CC0 | `.../files/qubodup-DoorSet.7z` | `200` `application/x-7z-compressed` **3,340,803 B** | 拟音级开门关门。**7z 格式，需 `p7zip-full`** |
| [Heartbeat sounds](https://opengameart.org/content/heartbeat-sounds) | bart | CC0 | `.../files/heartbeat_slow_0.wav` | `200` `application/octet-stream` **635,216 B** | 实测 `pcm_f32le 44100 stereo 1.80s` 慢心跳；另有 `heartbeat_fast_0.wav`（397,080 B）、`heartbeat_slow_reverb.wav`、`heartbeat_fast_reverb.wav`（带回响，适合闪回/惊吓） |
| [Water Waves](https://opengameart.org/content/water-waves) | qubodup | CC0 | `.../files/wave_01_cc0-11505__transitking__wavesound.flac` | `200` **265,335 B** | flac 海浪。同页另有 `wave_02`（583,157 B）、`wave_03`（401,955 B）、`wave_04`（338,969 B） |
| [Magic Spell SFX](https://opengameart.org/content/magic-spell-sfx) | jaggedstone | CC0 | `.../files/magical_1_0.ogg` | `200` `audio/ogg` **59,071 B** | 7 个 ogg（`magical_1..7`），法术/咏唱 |
| [Fireplace Sound loop](https://opengameart.org/content/fireplace-sound-loop) | pagdev | CC0 | `.../files/fire.wav` | `200` **10,324,410 B** | 实测 `pcm_s32le 44100 stereo 29.3s`。**32-bit float WAV，浏览器不解码，必须转码** |
| [Ambient Bird Sounds](https://opengameart.org/content/ambient-bird-sounds) | isaiah658 | CC0 | `.../files/birds-isaiah658_0.ogg` | `200` `audio/ogg` **544,669 B** | 实测 **48000 Hz** stereo 30.7s。清晨/野外环境音 |
| [Dripping water loop](https://opengameart.org/content/dripping-water-loop) | — | CC0 | `.../files/atmosbasement.mp3_.flac` | `200` **1,309,638 B** | 实测 flac 44.1k stereo **20.1s**。地下室/水滴 |
| [Loopable Dungeon Ambience](https://opengameart.org/content/loopable-dungeon-ambience) | yd | CC0 | `.../files/dungeon_ambient_1_0.ogg` | `200` `audio/ogg` **1,626,352 B** | 实测 **48000 Hz** stereo 94.3s。**条目名自带 Loopable** |
| [UI Sounds](https://opengameart.org/content/ui-sounds) | stumpystrust | CC0 | `.../files/UI_SFX_Set.zip` | `200` `application/zip` **1,425,902 B** | UI 音效组 |
| [80 CC0 RPG SFX](https://opengameart.org/content/80-cc0-rpg-sfx) / [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx) / [100 CC0 SFX #2](https://opengameart.org/content/100-cc0-sfx-2) | — | CC0 | `.../files/80-CC0-RPG-SFX_0.zip`(1,845,114 B) / `100-CC0-SFX_0.zip`(2,921,904 B，内含 `bell_01..03.ogg`) / `sfx_100_v2.zip`(2,367,871 B) | 全 `200` | 扩充池。**`bell_0*.ogg` 是 Commons 没有的干净铃音** |
| [50 CC0 retro / synth SFX](https://opengameart.org/content/50-cc0-retro-synth-sfx) | — | CC0 | `.../files/50-CC0-retro-synth-SFX.zip` | `200` **1,938,142 B** | 复古合成器音，UI/提示扩充 |
| [202 More Sound Effects](https://opengameart.org/content/202-more-sound-effects) | — | CC0 | `.../files/MoreSounds.zip` | `200` **14,937,403 B** | 202 条，拟音补漏 |
| [Dark Ambiences](https://opengameart.org/content/dark-ambiences) | ogrebane | CC0 | `.../files/dark_ambiences.zip` | `200` **3,129,422 B** | 黑暗环境音组 |
| [40 CC0 water / splash / slime SFX](https://opengameart.org/content/40-cc0-water-splash-slime-sfx) | — | CC0 | `.../files/water-splash-slime-sfx.zip` | `200` **2,259,262 B** | 水花/黏液 |
| [Steam release sounds](https://opengameart.org/content/steam-release-sounds) | bart | CC0 | `.../files/steam_hishes.zip` | `200` **622,313 B** | 蒸汽嘶声 |
| [Rain](https://opengameart.org/content/rain) | — | **CC-BY 3.0** | `.../files/Rain_v1.zip` | `200` **61,859 B** | CC-BY 3.0，**需署名**。音质一般，优先用 Commons 的 PD 雨声 |
| [Thunder](https://opengameart.org/content/thunder) | — | **CC-BY 3.0** | `.../files/thunderclap_0.ogg` | `200` `audio/ogg` **1,323,044 B** | CC-BY 3.0 需署名。另有 `thunder-seq.wav`（**10,425,284 B**，过大不建议） |
| [Click](https://opengameart.org/content/click) | — | CC0 | `.../files/click.wav` | `200` **5,144 B** | 实测 `mono 44100` 单声，**最短最干的裸点击**，适合做打字机逐字音底 |

#### 1.1.2 BGM 集合（实测直链，含 ffprobe 读出的真实时长/采样率）

| 条目页 | 作者 | 许可 | 直链 | 实测体积 / 时长 / 采样率 | 听感 |
|---|---|---|---|---|---|
| [Emotional piano loop](https://opengameart.org/content/emotional-piano-loop) | extenz | CC0 | `.../files/Piano%20Loop.wav` | **4,910,368 B** / 27.8s / 44.1k stereo | 钢琴短循环，音量克制，**最安全的"对白底噪"型 BGM** |
| [Next to You](https://opengameart.org/content/next-to-you) | joth | CC0 | `.../files/Next%20to%20You.mp3` | **1,674,888 B** / 83.5s / 44.1k | 中速抒情，弦乐+钢琴渐进，告白/并肩 |
| [Searching](https://opengameart.org/content/searching) | yd | CC0 | `.../files/Searching.ogg` | **2,113,188 B** / 104.6s / 44.1k | 探索感循环，节奏稳不喧哗，日常推进 |
| [Snowfall](https://opengameart.org/content/snowfall) | kistol | CC0 | `.../files/Snowfall%20%28Looped%20ver.%29_0.ogg` | **877,451 B** / 49.5s / 44.1k | **文件名自带 Looped，无缝循环版**，冬日/回忆/离别 |
| [Chill lofi inspired](https://opengameart.org/content/chill-lofi-inspired) | omfgdude | CC0 | `.../files/ChillLofi.ogg` | **6,486,377 B** / 125.1s / 44.1k **(~500 kbps!)** | lo-fi 慢摇，卧室/深夜。**同页 `ChillLofiR_0.mp3` 仅 2,717,205 B，优先取 mp3 版** |
| [Bossa Nova](https://opengameart.org/content/bossa-nova) | joth | CC0 | `.../files/8bit%20Bossa.mp3` | **1,196,325 B** / 59.6s / 44.1k | 8-bit 拿骚，咖啡馆/轻松日常 |
| [Town Theme RPG](https://opengameart.org/content/town-theme-rpg) | cynicmusic | CC0 | `.../files/TownTheme.mp3` | **1,316,581 B** / 97.5s / 44.1k | 小镇主题，街道/放学路 |
| [Loading screen loop](https://opengameart.org/content/loading-screen-loop) | haeldb | CC0 | `.../files/TremLoadingloopl.wav` | **3,641,852 B** / 20.6s / 44.1k | 加载/待机循环 |
| [Insistent: background loop](https://opengameart.org/content/insistent-background-loop) | yd | CC0 | `.../files/Insistent.ogg` | **1,767,874 B** / 128.7s / 44.1k | 持续推进的紧张循环，悬疑/被追 |
| [Forest Ambience](https://opengameart.org/content/forest-ambience) | tinyworlds | CC0 | `.../files/Forest_Ambience.mp3` | **716,670 B** / 44.8s / **48000 Hz** | 林间环境音式配乐，郊外/神域 |
| [rain and thunders](https://opengameart.org/content/rain-and-thunders) | kindland | CC0 | `.../files/Dark_Rainy_Night%28ambience%29.ogg` | **6,776,906 B** / 278.8s / 44.1k | 雨夜长环境音，独处/失眠/压抑 |
| [Creepy](https://opengameart.org/content/creepy) | — | CC0 | `.../files/CrEEP.ogg` | **5,083,744 B** / 89.3s / 44.1k | 不安的 creeps 音型，怪奇。同页 `CrEEP_0.mp3` 仅 **3,574,665 B**，优先 |
| [Night Prowler](https://opengameart.org/content/night-prowler) | — | CC0 | `.../files/S31-Night%20Prowler.ogg` | **2,525,529 B** / 152.7s / 44.1k | 潜行夜行，追踪/潜行场景 |
| [Sirens in Darkness](https://opengameart.org/content/sirens-in-darkness) | — | CC0 | `.../files/012_Sirens_in_Darkness_0.mp3` | **7,042,393 B** | 黑暗中警报，高潮前的压迫 |
| [Eye of the Storm](https://opengameart.org/content/eye-of-the-storm) | — | CC0 | `.../files/Eye%20of%20the%20Storm.mp3` | **926,741 B** | 风暴之眼，决战/高潮 |
| [4 Chiptunes (Adventure)](https://opengameart.org/content/4-chiptunes-adventure) | subspaceaudio | CC0 | `.../files/Juhani%20Junkala%20%5BChiptune%20Adventures%5D%20OGG.zip` | **8,103,420 B**（另有 WAV 版 32,145,935 B） | 8-bit 冒险组曲，异世界/回忆杀 |
| [5 Chiptunes (Action)](https://opengameart.org/content/5-chiptunes-action) | subspaceaudio | CC0 | `.../files/5%20Action%20Chiptunes%20By%20Juhani%20Junkala.zip` | **49,639,688 B** | 战斗组曲。**体积大，一次性取**
| [JRPG Pack 1 Exploration](https://opengameart.org/content/jrpg-pack-1-exploration) | subspaceaudio | CC0 | `.../files/JRPG%20Music%20Pack%20%231%20%5BExploration%5D%20by%20Juhani%20Junkala.zip` | **16,406,435 B** | JRPG 探索主题 |
| [At the end of hope](https://opengameart.org/content/at-the-end-of-hope) | — | CC0 | `.../files/at_the_end_of_hope_loop.wav` | **12,702,430 B**（intro 版 4,764,424 B） | 已有 loop/intro 分轨。**体积偏大，转码后再入库** |
| [Tragic ambient main menu](https://opengameart.org/content/tragic-ambient-main-menu) | haeldb | **OGA-BY 3.0** | `.../files/ambientmain_0.ogg` | `200` **1,972,219 B** / 100.0s | **许可为 OGA-BY 3.0（署名制），非纯 CC0**。未列入推荐清单 |
| [Completion sound](https://opengameart.org/content/completion-sound) | haeldb | **OGA-BY 3.0** | `.../files/completetask_0.mp3` | `200` **18,180 B** | 同上，**不列入推荐清单** |

---

### 1.2 incompetech / Kevin MacLeod（CC BY 4.0）—— BGM 主力之二

- **站点**：https://incompetech.com
- **合集页**：https://incompetech.com/music/royalty-free/music.html
- **许可页**：https://incompetech.com/music/royalty-free/licenses/
- **许可**：**CC BY 4.0**（https://creativecommons.org/licenses/by/4.0/）。逐首录音，**不可用 CC0**。
  **必须署名的固定句式**（站方在许可页生成 credits）：`Music by Kevin MacLeod (incompetech.com), Licensed under CC BY 4.0` + **曲名 + ISRC**（ISRC 在目录里逐条给出）。
- **⭐ 关键工程发现 —— 站点提供机器可读目录**（站方 `llms.txt` 明示）：

  | 端点 | 实测 |
  |---|---|
  | `https://incompetech.com/llms.txt` | `200` `text/plain` 4,244 B |
  | `https://incompetech.com/music/royalty-free/pieces.json` | `200` `application/json` **881,512 B / 1443 首**，字段 `title` `filename` `length` `instruments` `genre` `bpm` `description` `feel` `isrc` |
  | `https://incompetech.com/music/royalty-free/genre.json` | `200` 855 B |
  | `https://incompetech.com/music/royalty-free/collections.json` | `200` 4,802 B |

  直链规律：`https://incompetech.com/music/royalty-free/mp3-royaltyfree/<URL-encoded filename>`。**不需登录、不需 key，直连可达。**
- **实测下载**（10 首全部 `200`，`file` 确认为 MPEG layer III）：

  | 直链 | 体积 | 时长 | 听感 |
  |---|---|---|---|
  | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Ethernight Club.mp3` | 6,116,475 B | 305.7s | **凌晨两点、雨中拉面店、下一段楼梯透出暗红光**。夜都市/打工/失眠，VN 夜间场景的教科书配乐 |
  | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Bittersweet.mp3` | 6,468,058 B | 202.0s | 73bpm，作者自己说"我可能有点想哭"。青春回忆/遗憾/离别前夜 |
  | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Carefree.mp3` | 6,566,713 B | 205.1s | 96bpm 尤克里里，"没事的"那种明亮释然。结局回收/日常治愈 |
  | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Sneaky Snitch.mp3` | 5,466,943 B | 136.6s | 双簧管+小鼓的俏皮偷窃感，日常吐槽/搞笑桥段 |
  | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Night Vigil.mp3` | 11,667,276 B | 288.2s | 54bpm 守夜，亡者行进的肃穆。悲伤/葬礼/异世界仪式 |
  | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Send for the Horses.mp3` | 5,928,898 B | 185.2s | 飘渺空灵，梦境序列 / 雨中告别蒙太奇 |
  | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Ishikari Lore.mp3` | 6,688,921 B | 164.0s | 东方民谣调式，东方/和风/妖怪题材 |
  | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Deliberate Thought.mp3` | 7,224,606 B | 177.4s | 69bmp 电子圆号+人声垫，思索/犹豫/独白 |
  | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Mesmerizing Galaxy Loop.mp3` | 2,979,130 B | 93.0s | **文件名带 Loop，为弹幕射击游戏写的无缝循环**。可作长循环底 |
  | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Monkeys Spinning Monkeys.mp3` | 5,005,207 B | 125.0s | 144bpm 明快循环（长笛+拨弦）。喜剧/日常加速 |

- **代理**：直连可达，无需代理。

---

### 1.3 Wikimedia Commons（Public Domain / CC0 / CC-BY）—— 拟音富矿

- **站点**：https://commons.wikimedia.org
- **直链规律**：`https://upload.wikimedia.org/wikipedia/commons/<首两位十六进制>/<后两位>/<文件名>`。**API 返回的 URL 尾部带 `?utm_source=commons.wikimedia.org&...` 追踪参数，脚本取用时必须 `split('?')[0]` 截掉**（否则链接虽能用但带脏参数）。
- **许可**：逐文件标注，含 `Public domain` / `CC0` / `CC BY 3.0` / `CC BY 4.0` / `CC BY-SA 4.0` 等。**本项目只取 PD / CC0 / CC BY 三档，BY-SA 一律不用**。
- **取用方式（可脚本化）**：

  ```
  curl -s "https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=filetype:audio%20door&srnamespace=6&srlimit=12&format=json"
  curl -s "https://commons.wikimedia.org/w/api.php?action=query&titles=File:Door_handle_creaking.ogg&prop=imageinfo&iiprop=url|size|mime|extmetadata&format=json"
  ```

- **实测直链**（全部 `200`）：

  | 文件 | 许可 | 体积 | 听感 |
  |---|---|---|---|
  | `commons/1/15/Squeaky_door.ogg` | PD | 94 KB | 门轴吱呀，日常推门 |
  | `commons/7/74/Door_handle_creaking.ogg` | PD | 142 KB | **门把手转动的细碎吱声**，进屋/犹豫开门 |
  | `commons/6/6a/Squeaky_door_hinge.ogg` | PD | 126 KB | 纯门轴 |
  | `commons/c/c2/Garage_door_closing.ogg` | PD | 137 KB | 沉重金属门落下 |
  | `commons/4/4e/Garage_door_opening.ogg` | PD | 120 KB | 卷帘/铁门升起 |
  | `commons/7/7c/Door_knocker_audio.ogg` | **CC0** | 30 KB | 门环敲击（作者 Mx. Granger），访客到访 |
  | `commons/2/28/Windchime.ogg` | PD | 1,649 KB | **风铃长录（stephan 实录）**，夏日/庭院 |
  | `commons/0/09/Windchimes.ogg` | PD | 48 KB | 风铃短版，适合当点缀 |
  | `commons/a/a6/Windglockenspiel.Koshi.ogg` | **CC0** | 1,388 KB | 户外风铃铁片琴，更清亮 |
  | `commons/2/2b/Heartbeat_mitral_valve_150_bpm.ogg` | PD | 85 KB | 150bpm 机械心音，紧张/心动 |
  | `commons/9/9b/Heartbeat_speedsup.wav` | **CC BY 4.0**（Bob Smaude，**需署名**） | 406 KB | 心跳加速，惊吓/心跳骤停桥段 |
  | `commons/a/a4/Human_heart_rate.flac` | **CC0** | 2,838 KB | 真实人体心率，flac 无损 |
  | `commons/6/6b/Turning_a_page.ogg` | PD | 48 KB | 翻书页，文字推进 |
  | `commons/5/56/Clock_ticking.ogg`（natalie） | PD | 492 KB | 钟表滴答，教室/等待/时间流逝 |
  | `commons/8/8b/Alarm_clock_ticking.ogg`（ezwa） | PD | 267 KB | 闹钟滴答，清晨/惊醒 |
  | `commons/4/4f/Typing_fast.ogg` | PD | 696 KB | 快速打字，消息/终端 |
  | `commons/3/34/Typing_medium_speed.ogg` | PD | 759 KB | 中速打字，**打字机音效主力** |
  | `commons/c/c5/Typing_hunt_and_peck.ogg` | PD | 807 KB | 一指禅生疏打字 |
  | `commons/5/51/Typing_-_Model_M13_1999.ogg` | **CC0** | 166 KB | 机械键盘清脆敲击 |
  | `commons/d/d7/Smith-Corona_Prestige_Auto_12_typing.ogg` | **CC BY 3.0**（需署名） | 973 KB | 老式打字机，回信/年代感 |
  | `commons/0/0e/Rain_%281%29.ogg` | PD | 572 KB | 稳定雨声，窗外雨/长夜 |
  | `commons/4/42/Rain_and_thunder.ogg` | PD | 222 KB | 雨+雷，天气转折 |
  | `commons/0/09/Rain_thunder_steps.ogg` | PD | 1,216 KB | 雨中脚步，雨天赶路 |
  | `commons/a/ac/Nosferatu_thunderclap_-_Richard_Humphries.wav` | **CC BY 4.0**（需署名） | 4,701 KB | 电影级雷击，惊雷/宿命时刻 |
  | `commons/a/ab/Rhumphries_-_rbh-thunder-storm.ogg` | **CC BY 3.0**（需署名） | 3,057 KB | 雷暴长环境音 |
  | `commons/a/ab/In_a_Heartbeat_%28ISRC_USUAN1100197%29.mp3` | **CC BY 3.0**，作者 Kevin MacLeod | 8,617 KB | incompetech 曲子在 Commons 的镜像，**体积大不必用** |

- **代理**：直连可达。

---

### 1.4 Kenney.nl（CC0）—— 稳定但 URL 带 hash

- **站点**：https://kenney.nl　**音频分类页**：https://kenney.nl/assets/category:Audio
- **许可**：全部资产 **CC0 1.0**。
- **直链规律**：`https://kenney.nl/media/pages/assets/<slug>/<内容hash>-<时间戳>/kenney_<slug>.zip`。**hash 每次构建都会变，不能硬编码**——脚本化做法是抓 `https://kenney.nl/assets/<slug>` 页面后正则取 `https://kenney\.nl/media/pages/assets/[^"]*\.zip`。下载按钮是 `javascript:void(0)` + `#inline-download`，但 zip 真实地址就写在 HTML 里。
- **实测直链**（全部 `200` `application/zip`）：

  | 包 | 直链 | 体积 |
  |---|---|---|
  | interface-sounds | `.../assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip` | **814 KB** |
  | rpg-audio | `.../assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip` | **942 KB** |
  | ui-audio | `.../assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip` | **402 KB** |
  | impact-sounds | `.../assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip` | **782 KB** |
  | digital-audio | `.../assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip` | **967 KB** |
  | music-jingles | `.../assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip` | **1,210 KB** |
  | sci-fi-sounds | `.../assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip` | **5,737 KB** |

- **注意**：Kenney 的同一批包在 OpenGameArt 上有**镜像且 hash 稳定**（如 `kenney_interfaceSounds.zip` = 834,536 B、`jingleSounds_Kenney.zip` = 1,089,319 B、`RPGsounds_Kenney.zip` = 690,952 B）。**脚本化入库建议走 OGA 镜像，Kenney 官网留作人工备份。**
- **代理**：直连可达。

---

### 1.5 Openverse API（CC0 / PD 图片）—— 背景图唯一可脚本化入口

- **站点**：https://openverse.org　**API**：`https://api.openverse.org/v1/images/?q=<关键词>&license=cc0,pdm&page_size=N`
- **许可**：逐图标注（`cc0` / `pdm` / `by`），API 直接返回 `width` `height` `license` `creator` `url` `foreign_landing_url`。**无需 key 即可基本使用**。
- **实测**：
  - `q=visual novel background&license=cc0,pdm` → `result_count` 仅 **2**（640×480、500×375）。**二次元 VN 背景基本为零。**
  - `q=sunset sky&license=cc0` → `result_count` **240**。返回 flickr `live.staticflickr.com/..._b.jpg`（1024×594，实测 `200` `image/jpeg` 124,565 B）、stocksnap `cdn.stocksnap.io/img-thumbs/960w/...`、rawpixel。
- **⚠️ 陷阱一：StockSnap 源在本机取不到**。Openverse 会返回 `source=stocksnap` 的结果，但其 `url` 指向 `cdn.stocksnap.io/img-thumbs/960w/...` —— **实测无论用描述性 UA 还是浏览器 UA，CDN 与落地页 `https://stocksnap.io/photo/sunset-sky-Q16XY4FN0F` 均返回 `403`（Cloudflare 拦截）**。且该 `url` 本来也只是 960w 缩略图，与元数据声明的 3000×2000 不符。**结论：`source=stocksnap` 的结果直接过滤掉，不要写进下载脚本。**
- **⚠️ 陷阱二：`url` 字段不保证是原图**。入库前一律用 `file` / PIL 核对真实像素与体积。**实测可用性排序：`source=flickr`（`live.staticflickr.com/..._b.jpg` → 200）≈ `upload.wikimedia.org`（→ 200）> `rawpixel`（未实测）> `stocksnap`（403，排除）**。
- **⚠️ 陷阱三：CC-BY / CC-BY-SA 混在 `license=cc0` 查询里吗？** 不会 —— `license=` 参数是精确过滤，`cc0` 查询结果只会是 CC0。但**必须逐条读返回的 `license` 字段**，因为 `pdm`（公有领域标记）与 `cc0` 是两种不同标注，署名要求与再分发条件要以每条的 `license` + `license_version` 为准。
- **风格警告**：全部是**实拍照片**，非二次元。

---

### 1.6 archive.org（公有领域）—— 可脚本化但命中率低

- **元数据 API**：`https://archive.org/metadata/<identifier>` → `200 application/json`，返回 `server` + `dir` + 完整 `files` 列表；**直链规律**：`https://<server>/<dir>/<filename>` 或 `https://archive.org/download/<id>/<file>`。**无需 key，完美程序化。**
- **实测搜索**：`q=kevin macleod incompetech` 返回的 8 条里，带 `licenseurl` 的只有 3 条，其中 2 条是 **CC BY-NC-SA 4.0 / CC BY-NC-ND 3.0（禁商用）**，其余 `licenseurl` 为空（授权不明）。
- **结论**：机制可用，但**公有领域音频的授权元数据质量参差，误用风险高**。列为补充源，不作主力。

---

## 2. 推荐下载清单

> 排序：按 galgame 常用度（出现频率 × 通用性）降序。
> 直链列中 `ZIP#成员路径` 表示**该直链下载的是压缩包，需要解包后取成员文件**（已在 §4 说明）。
> OGA 缩写基址 `OGA` = `https://opengameart.org/sites/default/files`

### 2.1 BGM（20 条）

| id | 类别 | 直链 | 许可证 | 中文描述（氛围 / 适合场景） | 来源站点 |
|---|---|---|---|---|---|
| `bgm_piano_soft_loop` | BGM | `OGA/Piano%20Loop.wav` | CC0 | 27.8 秒钢琴短循环，音量克制、无人声、不抢对白。**最安全的"垫底" BGM**，适合温馨日常、回忆独白、安静对话 | OpenGameArt |
| `bgm_searching_loop` | BGM | `OGA/Searching.ogg` | CC0 | 105 秒探索感循环，节奏稳定不喧哗。适合日常推进、调查、找东西、场景转场 | OpenGameArt |
| `bgm_snowfall_loop` | BGM | `OGA/Snowfall%20%28Looped%20ver.%29_0.ogg` | CC0 | 49.5 秒**官方标注 Looped 的无缝循环**，冬日轻音。适合雪景、回忆闪回、离别、年末 | OpenGameArt |
| `bgm_next_to_you` | BGM | `OGA/Next%20to%20You.mp3` | CC0 | 83 秒中速抒情，弦乐与钢琴渐进推进。适合告白、并肩、两人独处的升温段 | OpenGameArt |
| `bgm_town_theme` | BGM | `OGA/TownTheme.mp3` | CC0 | 97 秒明亮小镇主题，吉他与轻鼓。适合街道、放学路上、集市、初遇 | OpenGameArt |
| `bgm_loading_loop` | BGM | `OGA/TremLoadingloopl.wav` | CC0 | 20.6 秒加载/待机循环，音型简单不分散注意力。适合读档界面、菜单待机、等待演出 | OpenGameArt |
| `bgm_eternight_club` | BGM | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Ethernight%20Club.mp3` | CC BY 4.0 | 凌晨两点、雨中拉面店、下一段楼梯透出暗红霓虹。夜都市、打工人、失眠、孤独但温柔的场景 | incompetech |
| `bgm_bittersweet` | BGM | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Bittersweet.mp3` | CC BY 4.0 | 73bpm 酸甜交织，作者自述"我可能有点想哭"。青春回忆、遗憾、错过的告白 | incompetech |
| `bgm_carefree` | BGM | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Carefree.mp3` | CC BY 4.0 | 96bpm 尤克里里，"一切都会好起来"的那种明亮释然。适合治愈日常、结局回收、和解 | incompetech |
| `bgm_night_vigil` | BGM | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Night%20Vigil.mp3` | CC BY 4.0 | 54bpm 守夜，亡者行进般的肃穆庄严。适合悲伤高潮、葬礼、异世界仪式、牺牲场景 | incompetech |
| `bgm_send_for_the_horses` | BGM | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Send%20for%20the%20Horses.mp3` | CC BY 4.0 | 飘渺空灵，"适合梦境序列，或 sad people standing in the rain 的蒙太奇"。适合梦境、雨中告别 | incompetech |
| `bgm_ishikari_lore` | BGM | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Ishikari%20Lore.mp3` | CC BY 4.0 | 东方民谣调式旋律。适合和风、妖怪题材、异世界、神社场景 | incompetech |
| `bgm_deliberate_thought` | BGM | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Deliberate%20Thought.mp3` | CC BY 4.0 | 69bpm 环绕合成器加人声垫，沉着冷静。适合犹豫、思考、独白、心理戏 | incompetech |
| `bgm_sneaky_snitch` | BGM | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Sneaky%20Snitch.mp3` | CC BY 4.0 | 双簧管与小鼓的俏皮"偷偷摸摸"。适合吐槽、恶作剧、搞笑日常、潜行小动作 | incompetech |
| `bgm_insistent_loop` | BGM | `OGA/Insistent.ogg` | CC0 | 128 秒持续推进的紧张循环，压迫感稳定累积。适合被跟踪、倒计时、危机升级 | OpenGameArt |
| `bgm_creepy` | BGM | `OGA/CrEEP_0.mp3`（比 ogg 版小 30%） | CC0 | 89 秒不安的 creeps 音型，怪奇而不好笑。适合诡异、怪谈、不可名状 | OpenGameArt |
| `bgm_night_prowler` | BGM | `OGA/S31-Night%20Prowler.ogg` | CC0 | 152 秒潜行夜行曲，脚步般推进。适合跟踪、潜入、深夜行动 | OpenGameArt |
| `bgm_bossa_nova_8bit` | BGM | `OGA/8bit%20Bossa.mp3` | CC0 | 60 秒 8-bit 拿骚风，轻松俏皮。适合咖啡馆、约会、校园闲聊 | OpenGameArt |
| `bgm_rainy_night` | BGM | `OGA/Dark_Rainy_Night%28ambience%29.ogg` | CC0 | 278 秒雨夜长环境音，兼作 BGM 与雨声底。适合独处夜、压抑、剧情间过渡 | OpenGameArt |
| `bgm_forest_ambience` | BGM | `OGA/Forest_Ambience.mp3` | CC0 | 45 秒林间环境音式配乐。适合郊外、神社参道、自然场景 | OpenGameArt |

> 备用（未进主表，按需取）：`bgm_jrpg_exploration`（`OGA/JRPG%20Music%20Pack%20%231%20%5BExploration%5D%20by%20Juhani%20Junkala.zip`）、`bgm_chiptune_adventure`（`OGA/Juhani%20Junkala%20%5BChiptune%20Adventures%5D%20OGG.zip`）、`bgm_monkeys_spinning_monkeys`（incompetech 144bpm 喜剧循环）、`bgm_eye_of_storm`（决战高潮）、`bgm_sirens_darkness`（高潮前警报）。

### 2.2 SFX（33 条）

| id | 类别 | 直链 | 许可证 | 中文描述 | 来源站点 |
|---|---|---|---|---|---|
| `sfx_ui_click` | SFX | `OGA/kenney_interfaceSounds.zip`#`Audio/click_003.ogg` | CC0 | 短促清脆的按键点击，无环境底噪。**选项按钮/推进的主力** | OpenGameArt |
| `sfx_ui_confirm` | SFX | 同上#`Audio/confirmation_001.ogg` | CC0 | 上扬的双音确认音。提交、达成、同意 | OpenGameArt |
| `sfx_ui_back` | SFX | 同上#`Audio/back_002.ogg` | CC0 | 下降音，返回/取消/退出菜单 | OpenGameArt |
| `sfx_ui_close` | SFX | 同上#`Audio/close_002.ogg` | CC0 | 收束音，面板关闭、对话窗收起 | OpenGameArt |
| `sfx_page_flip` | SFX | `OGA/RPGsounds_Kenney.zip`#`OGG/bookFlip2.ogg` | CC0 | 纸张翻动的干脆声。**文字推进、内心独白翻页** | OpenGameArt |
| `sfx_book_open` | SFX | 同上#`OGG/bookOpen.ogg` | CC0 | 书翻开，掀开日记/档案/笔记本 | OpenGameArt |
| `sfx_book_close` | SFX | 同上#`OGG/bookClose.ogg` | CC0 | 书合上，收束一段回忆或对话 | OpenGameArt |
| `sfx_page_place` | SFX | 同上#`OGG/bookPlace1.ogg` | CC0 | 书落回桌面，翻页动作的收尾 | OpenGameArt |
| `sfx_belt_handle` | SFX | 同上#`OGG/beltHandle1.ogg` | CC0 | 拉链/皮带扣。换衣、收拾道具、准备出门 | OpenGameArt |
| `sfx_door_creak` | SFX | `https://upload.wikimedia.org/wikipedia/commons/7/74/Door_handle_creaking.ogg` | PD | 门把手转动的细碎吱声。**犹豫着推开门的质感**，比游戏音效真实得多 | Wikimedia Commons |
| `sfx_door_open` | SFX | `.../commons/1/15/Squeaky_door.ogg` | PD | 门轴吱呀的开门，日常推门进屋 | Wikimedia Commons |
| `sfx_door_close_heavy` | SFX | `.../commons/c/c2/Garage_door_closing.ogg` | PD | 沉重金属门落下，宣告结束/隔绝 | Wikimedia Commons |
| `sfx_door_knock` | SFX | `.../commons/7/7c/Door_knocker_audio.ogg` | CC0 | 门环敲击三下，**访客到访**，引出对话者 | Wikimedia Commons |
| `sfx_door_open_retro` | SFX | `OGA/The%20Essential%20Retro%20Video%20Game%20Sound%20Effects%20Collection%20%5B512%20sounds%5D.zip`#`Movement/Opening Doors/sfx_movement_dooropen1.wav` | CC0 | 8-bit 开门，风格统一的游戏化版本 | OpenGameArt |
| `sfx_step_wood` | SFX | `OGA/%5Bkdd%5DDifferentSteps_0.zip`#`wood01.ogg` | CC0 | 木地板脚步，教室/老宅走廊 | OpenGameArt |
| `sfx_step_stone` | SFX | 同上#`stone01.ogg` | CC0 | 石板脚步，庭院/地下通道 | OpenGameArt |
| `sfx_step_leaves` | SFX | 同上#`leaves01.ogg` | CC0 | 踩落叶，秋日林道 | OpenGameArt |
| `sfx_step_gravel` | SFX | 同上#`gravel.ogg` | CC0 | 碎石脚步，山路/河滩 | OpenGameArt |
| `sfx_step_mud` | SFX | 同上#`mud02.ogg` | CC0 | 泥泞脚步，雨后乡道 | OpenGameArt |
| `sfx_step_stairs` | SFX | `OGA/yd-Sounds.zip`#`yd-Sounds/steps_stairs.ogg` | CC0 | 上楼梯脚步，上学/回家/公寓 | OpenGameArt |
| `sfx_step_chain` | SFX | 同上#`yd-Sounds/steps_chain.ogg` | CC0 | 铁链脚步，监牢/地牢 | OpenGameArt |
| `sfx_heartbeat_slow` | SFX | `OGA/heartbeat_slow_0.wav` | CC0 | 1.8 秒慢心跳，平静下的暗涌、告白前的心悸 | OpenGameArt |
| `sfx_heartbeat_fast` | SFX | `OGA/heartbeat_fast_0.wav` | CC0 | 快速心跳，紧张/恐惧/濒死 | OpenGameArt |
| `sfx_heartbeat_reverb` | SFX | `OGA/heartbeat_slow_reverb.wav` | CC0 | 带回响的心跳，**闪回、幻听、记忆抽离** | OpenGameArt |
| `sfx_typing_medium` | SFX | `.../commons/3/34/Typing_medium_speed.ogg` | PD | 中速真实打字声。手机消息、终端输入、聊天界面 | Wikimedia Commons |
| `sfx_typing_keyboard` | SFX | `.../commons/5/51/Typing_-_Model_M13_1999.ogg` | CC0 | 清脆机械键盘敲击，程序员/工位/深夜coding | Wikimedia Commons |
| `sfx_clock_tick` | SFX | `.../commons/5/56/Clock_ticking.ogg` | PD | 钟表滴答，教室/空教室/时间流逝的压迫 | Wikimedia Commons |
| `sfx_wind_chime` | SFX | `.../commons/2/28/Windchime.ogg` | PD | 风铃实录（stephan 实地录音），夏日庭院、神社、午后的闲适 | Wikimedia Commons |
| `sfx_rain` | SFX | `.../commons/0/0e/Rain_%281%29.ogg` | PD | 稳定雨声底，窗外雨、屋檐下避雨 | Wikimedia Commons |
| `sfx_rain_thunder` | SFX | `.../commons/4/42/Rain_and_thunder.ogg` | PD | 雨夹雷，天气突变、剧情转折 | Wikimedia Commons |
| `sfx_wave` | SFX | `OGA/wave_01_cc0-11505__transitking__wavesound.flac` | CC0 | 海浪（flac 无损），海边、港口、回忆闪回 | OpenGameArt |
| `sfx_fire_crackle` | SFX | `OGA/fire.wav` | CC0 | 壁炉/篝火噼啪 29 秒，冬夜、营火、祖父家。**32-bit float，须转码** | OpenGameArt |
| `sfx_water_drip` | SFX | `OGA/atmosbasement.mp3_.flac` | CC0 | 20 秒地下水滴回响，地下室、地牢、密室 | OpenGameArt |

> 备用（未进主表，按需取）：`sfx_bell`（`OGA/100-CC0-SFX_0.zip`#`bell_02.ogg`，干净铃音，Commons 没有）、`sfx_click_raw`（`OGA/click.wav`，5 KB 单声道最短点击）、`sfx_birds`（`OGA/birds-isaiah658_0.ogg`，48 kHz 晨间鸟鸣）、`sfx_dungeon_ambience`（`OGA/dungeon_ambient_1_0.ogg`，条目名自带 Loopable，48 kHz）、`sfx_magic_cast`（`OGA/magical_1_0.ogg`~`magical_7_0.ogg`）、`sfx_bag_open`（`OGA/yd-Sounds.zip`#`boxopen.ogg`）、`sfx_beep_message`（同上#`beep_message.ogg`，手机/终端提示）。

### 2.3 背景图（8 条 —— **均为实拍照片或视差分层图，非二次元**）

| id | 类别 | 直链 | 许可证 | 中文描述 | 来源站点 |
|---|---|---|---|---|---|
| `bg_photo_night_city` | 背景 | `https://upload.wikimedia.org/wikipedia/commons/a/aa/Melbourne_at_night_from_the_International_Space_Station.jpg` | CC0 | 夜间城市灯火天际线，2128×1416。**写实照片**，适合都市夜景/终章 | Wikimedia Commons |
| `bg_photo_forest_path` | 背景 | `https://upload.wikimedia.org/wikipedia/commons/2/26/Forest_path%2C_%C3%85nnaboda.jpg` | CC0 | 林间小径，6016×4000。**写实照片**，适合郊外/记忆闪回。⚠️ **16.5 MB，入库前必须转码压缩** | Wikimedia Commons |
| `bg_photo_sunset` | 背景 | `https://live.staticflickr.com/6040/6249263074_2e411529e6_b.jpg` | CC0 | 落日天空，1024×594。**写实照片**，尺寸偏小需放大评估 | Openverse/Flickr |
| `bg_hd_parallax_glitch` | 背景 | `OGA/Glitch%20parallex%20BG%20sampler.zip` | CC0 | **HD 多层视差背景包**，实测内含 2914×2173 / 2460×2104 / 2339×1818 RGBA 图层。科幻/异空间，**非二次元**。⚠️ **41.8 MB** | OpenGameArt |
| `bg_parallax_forest` | 背景 | `OGA/parallax_forest_pack.zip` | CC0 | 视差森林包，预览层实测 544×320。**分辨率偏低，仅适合做氛围底** | OpenGameArt |
| `bg_parallax_mountain` | 背景 | `OGA/parallax_mountain_pack.zip` | CC0 | 视差山景包，预览层实测 272×160。**分辨率过低，仅作占位** | OpenGameArt |
| `bg_magic_cliffs` | 背景 | `OGA/Magic-Cliffs-Environment.zip` | CC0 | 奇幻悬崖环境包，主图实测 2512×304 横幅。适合天/地平线分层 | OpenGameArt |
| `bg_photo_corridor` | 背景 | `https://upload.wikimedia.org/wikipedia/commons/9/98/Tejgaon_Government_High_School_Corridor_of_the_North_Building_%282025%29.jpg` | CC0 | 校园走廊实拍照，3072×4096（实测 `200 image/jpeg` 3,455,185 B）。**写实照片，印度校园，非日式校园** | Wikimedia Commons |
| `bg_photo_corridor_alt` | 背景 | `https://live.staticflickr.com/65535/54902254555_e837f29160_b.jpg` | CC0 | 另一张走廊照片，1024×683（实测 `200` 103,417 B）。尺寸偏小 | Openverse/Flickr |

### 2.4 立绘

**本次调研在全部合规来源中未能找到任何可用的二次元透明立绘。** 详见 §2.5 缺口分析。

### 2.5 缺口分析：背景图与立绘

这是本次调研**最重要的负面结论**，不要用"没查到"含糊过去：

**缺口一：二次元 16:9 场景背景 —— 实质为零。**

| 检索路径 | 实测结果 |
|---|---|
| OpenGameArt CC0 2D Art（`type=9, license=4`，按 count 排序取前 60） | 返回的全是**像素图 tileset**（Zelda-like、dungeon-crawl-32x32、roguelike 1700 tiles）与**视差背景条**。逐个下载量尺寸：`272×160`、`544×320`、`720×720`、`2512×304`。**没有一个是 1920×1080 场景画。** |
| OpenGameArt CC-BY-SA 2D Art（`type=9, license=17982`） | 被 **LPC（Libre Pixel Cup）** 俯视 RPG 素材完全占据（`lpc-terrains`、`lpc-floors`、`lpc-birds`…）。**俯视 RPG 素材图集不是 VN 立绘。** |
| Openverse `q=visual novel background&license=cc0,pdm` | **`result_count` = 2**，尺寸 640×480 与 500×375。**可确认的零。** |
| Openverse 实拍 CC0（sunset sky / night city / forest path / beach） | 数量充足（单项 240 条）、分辨率高（3000×2000~6016×4000），**但全是照片，风格与二次元 VN 完全不符**。 |

**结论**：合规池里**只有"实拍照片"和"低分辨率像素/视差条"**两种背景。要 16:9 二次元背景，唯一现实路径是**本项目自己的生图管线**——而且这条路已经跑通了：`apps/server/src/flowImage.ts` 的实测记录表明 flow2api 出图 `16:9` → **1376×768 ✅**（合规画幅），`9:16` → 768×1376 ✅（立绘画幅）。生图 + `writeBinary` 落 `assets/backgrounds/` 已经是现成通路。

**缺口二：透明多表情立绘 —— 完全没有。**

- 所有 VN 风格立绘站（Uncle Mugen、CraftPix、Sutemo、背景素材屋）**条款一律禁止再分发素材本身**，本任务硬性排除。
- OpenGameArt 上带 CC0/CC-BY 标记的"角色"素材全部是**俯视/横版 RPG 精灵图集**，不是透明 PNG 站立立绘，更没有多表情差分。
- 唯一的开放许可角色素材是 **LPC 系列（CC-BY-SA 3.0 / GPL）**，但它既是 share-alike（衍生需同协议，素材目录整体分发要额外处理），**画风也完全不是二次元**。

**替代方案（推荐，不凑数）**：
1. **立绘**：走已有工坊管线 —— `generate_asset`（`type="sprite"`）出 2D 平涂赛璐璐 → `cutout.ts` 抠底 → 落 `assets/sprites/<role>/<expr>.png`。差分靠"挂在同一角色 `neutral` 定妆照上"的垫图一致性保证（项目已有 `inflight` 去重与 `figureHeight` 回执）。
2. **背景**：走 `generate_asset`（`type="background"`，`aspectMatches` 回执保证 16:9）。
3. **降级方案**：若某部剧目必须是实拍质感，用 §2.3 的 Openverse/Commons CC0 照片，**但必须写进 `craft.md` 的画风约定**，不要让照片背景和生图背景在同一剧目里混用。

---

## 3. 不可用 / 被否决的来源

| 来源 | 否决原因（实测为准，非二手转述） |
|---|---|
| **freepd.com** | ⛔ **已死站**。实测 `https://freepd.com/` 返回 `200` 但内容是告别页：*"After 17 years… we have officially taken the service offline… is now permanently closed. 2008-2025"*，`Last-Modified: Sat, 31 Jan 2026`。**必须更正项目内 `260928-free-galgame-audio-assets.research.md` 把它列为 Tier 1 的结论。** |
| **Freesound.org** | ⛔ 下载需 OAuth token。虽有 REST API，但注册取 key 是硬门槛，不满足"无需凭证即可程序化下载"。 |
| **itch.io（各 CC0 包）** | ⛔ **实测不可脚本化**。`curl -X POST https://tallbeard.itch.io/music-loop-bundle/download/0` 返回 `200 application/json` 但 body 是 `{"errors":["missing token"]}` —— 需要会话/CSRF token。免费包也过不了这关。 |
| **OpenTracks（原 DOVA-SYNDROME）** | ⛔ 站方音源利用许可**禁止把音源作为素材形态再配布**。19,248 首体量诱人但本任务不可用。 |
| **魔王魂 maou.audio** | ⛔ 站规**禁再配布（曲单曲）**、禁配信平台发布、禁 AI 学习。（其 CC BY 4.0 备选同样带站规限制。） |
| **効果音ラボ / 効果音辞典** | ⛔ 明文禁再配布；另禁 18+ 作品。 |
| **甘茶の音楽工房** | ⛔ 禁再配布/单独贩售/JASRAC 登记；2019-09 后停更。 |
| **OtoLogic** | ⛔ 站规禁再配布形态分发；署名与素材库再販是核心限制。 |
| **MusMus / HURT RECORD / H/MIX / くらげ工匠 / 無料効果音で遊ぼう** | ⛔ 同类日系站，条款共同禁止音源/素材本体的二次配布。 |
| **Pixabay** | ⛔ Pixabay Content License **禁止以 Standalone basis 分发/销售 Content**。素材目录进 git = 独立再分发，直接踩线。（API 另需 token。） |
| **Unsplash / Pexels / rawpixel 站点级** | ⛔ 站级许可禁止 standalone 再分发。⚠️ 例外：**单张被 Openverse 标为 `cc0` 的图片可用**（本报告 §2.3 即是这样用的）——判断必须**逐文件**看 Openverse 的 license 字段，不能看站点名。 |
| **Mixkit** | ⛔ 音乐许可明文禁止用于视频游戏；音效条款亦限制再分发。 |
| **Zapsplat** | ⛔ 免费档需署 ZapSplat，且禁止再分发音效文件。 |
| **Bensound / Uppbeat** | ⛔ 免费档不覆盖游戏商用；且 royalty-free ≠ 可再分发。 |
| **Sonniss GDC 游戏音频包** | ⛔ EULA 免版税且无署名，但**禁止单独再分发/辑成音效库转售**。影视级素材量巨大，正好卡在红线上。 |
| **Spriters Resource / Sprite Database** | ⛔ 从商业游戏提取的 sprites，属侵权素材，无任何授权。 |
| **Uncle Mugen / CraftPix / Sutemo / 背景素材屋 / 橙光素材库** | ⛔ 全部禁止素材再分发；橙光素材还平台绑定。 |
| **archive.org（作为 BGM 主力）** | ⚠️ 非否决但降级：机制完全可脚本化（metadata API `200`），但搜 `kevin macleod` 返回结果中 **2/3 带明确 licenseurl 的是 CC BY-NC-SA / CC BY-NC-ND（禁商用）**，其余 licenseurl 为空。**误用风险高，不作主力。** |
| **OpenGameArt 的 OGA-BY 3.0 条目** | ⚠️ 部分排除：`tragic ambient main-menu`、`Completion sound` 经条目字段确认为 **OGA-BY 3.0**（非纯 CC0）。OGA-BY 3.0 本身允许再分发+署名，可按需启用，但为降低元数据风险，**推荐清单一律不收 OGA-BY 条目**。 |

---

## 4. 注意事项

### 4.1 循环播放：爆音与接缝

- **文件名/条目名带 `Loop` / `Looped` 的才是真无缝循环**（已实测确认）：`Snowfall (Looped ver.).ogg`、`Mesmerizing Galaxy Loop.mp3`、`Loopable Dungeon Ambience`、`fire.wav`（自述 loop）、`at_the_end_of_hope_loop.wav`。
- **incompetech 的 10 首实测曲目全是 2–5 分钟全长曲，不具备无缝循环性质**。直接 `loop=true` 播放会在曲尾/曲首接缝处出现明显断点与爆音。**处理方式**：入库时用 300–800 ms 交叉淡化裁成 30–90 秒片段，或在播放层做 crossfade（`apps/web/src/stage/audio.ts` 的 `VoiceDirector` 已有 gapless 链式调度与淡出能力可复用）。
- **`Insistent.ogg`（128.7 s）**、`Searching.ogg`（104.6 s）虽非标注 loop，但作者声明为 background loop，接缝风险中等。
- **WAV 循环尤其危险**：`Piano Loop.wav`（27.8 s）、`TremLoadingloopl.wav`（20.6 s）首尾若非零电平，循环点会"啪"一声。入库前用 `ffmpeg` 检测并施加 20 ms 首尾淡入淡出。
- **环境音类**（`fire.wav`、`dungeon_ambient_1_0.ogg`、`Forest_Ambience.mp3`）建议**交叉淡化双份叠加**消除接缝，这是环境音的标准做法。

### 4.2 采样率与位深

- **超过 44.1 kHz 的（3 个，需注意）**：
  - `Forest_Ambience.mp3` — **48000 Hz** stereo
  - `birds-isaiah658_0.ogg` — **48000 Hz** stereo
  - `dungeon_ambient_1_0.ogg` — **48000 Hz** stereo
  - 其余实测条目均为 44100 Hz。
- **32-bit float WAV**：`fire.wav` 实测 `pcm_s32le 44100 stereo`（9.9 MB）。**浏览器 `<audio>` 与 Web Audio 解码 32-bit float WAV 支持不可靠，入库前必须转成 16-bit PCM 或 OGG。**
- **32-bit float WAV（另一例）**：`heartbeat_slow_0.wav` 实测 `pcm_f32le`（635 KB）。
- 其余 WAV 为 `pcm_s16le 44100 stereo`，浏览器原生可播。

### 4.3 体积：超过 5 MB、不适合做 BGM 的

| 素材 | 体积 | 处置建议 |
|---|---|---|
| incompetech 全部 mp3（实测 5.0–11.7 MB） | 5.0–11.7 MB | **320 kbps 全长曲**。一律**裁片 + 转 192 kbps** 后入库 |
| `ChillLofi.ogg` | 6.5 MB | **~500 kbps Vorbis，极不划算**。同页 `ChillLofiR_0.mp3` 仅 2.7 MB，**优先取 mp3 版** |
| `Dark_Rainy_Night(ambience).ogg` | 6.8 MB | 278.8 s 环境音，转码或裁段 |
| `CrEEP.wav` | 15.8 MB | 同页 `CrEEP_0.mp3` 仅 3.6 MB，**取 mp3** |
| `fire.wav` | 9.9 MB | 转 16-bit OGG 后可降到 ~1 MB |
| `swamp_low_quality.wav` | 17.6 MB | 不取（有 `swamp.ogg` 1.2 MB 替代） |
| `thunder-seq.wav` | 10.0 MB | 不取（有 `thunderclap_0.ogg` 1.3 MB 替代，且许可还是 CC-BY 3.0） |
| `at_the_end_of_hope_loop.wav` | 12.1 MB | 转码 |
| `Cleyton RX - Underwater.wav` | 43.0 MB | **绝不取**（同页 mp3 版 6.5 MB） |
| `The Essential...512 sounds].zip` | 20.1 MB | 512 条 wav，**入库时按需抽取子集**，不必全量 |
| `rpg_sound_pack.zip` | 12.2 MB | 含大量 `__MACOSX/` 垃圾条目（249 条里约半数是 Mac 资源叉），解包后需清理 |
| `FantasyChoir24bit.zip` | 68.1 MB | 不取（24-bit 合唱团，体积失控） |
| `5 Action Chiptunes.zip` | 47.4 MB | 一次性取，之后不必重下 |
| `JRPG Music Pack #1.zip` | 15.7 MB | 同上 |
| `Juhani Junkala [Chiptune Adventures] WAV.zip` | 30.7 MB | **只取 OGG 版（7.7 MB）** |
| `In a Heartbeat.mp3`（Commons 镜像） | 8.4 MB | 不取，直连 incompetech 拿原曲 |
| `Forest_path, Ånnaboda.jpg` | 16.1 MB | 照片背景，**入库前转 1920×1080 WebP/PNG，目标 < 1.5 MB** |

### 4.4 工程注意事项

- **7z 包需要 `p7zip-full`**。本机已装（`/usr/bin/7z`），但 CI/新环境需注意：`qubodup-DoorSet.7z`、`door.7z`、`GUI_Sound_Effects_by_Lokif.7z`、`corsica_s-walking_in_snow.7z`、`Fantozzi-footsteps.7z`、`independent_nu_ljudbank-*.7z`（4 个）、`krank_sounds.7z` 全是 7z。**优先选 `.zip` 变体。**
- **`rpg_sound_pack.zip` 含 `__MACOSX/` 与 `.DS_Store`**，任何解包逻辑都要过滤。
- **Kenney 的 zip URL 含构建 hash**（如 `fa43c1dd4d-1677589452`），**会变**。脚本抓取时用正则，不要写死；要稳定就走 OGA 镜像。
- **Wikimedia API 返回的 URL 带 `?utm_source=commons.wikimedia.org&...`**，入库前 `split('?')[0]` 截断。
- **⚠️ `upload.wikimedia.org` 会按 User-Agent 限流（实测）**：用浏览器 UA 连续 HEAD 26 条时，有 6 条返回 **`429 Too Many Requests`**（且带 UA + sleep 4 s 重试仍是 429）；换成 Wikimedia 要求的**描述性 UA** 后全部 `200`：

  ```bash
  UA='stage-ai-asset-library/1.0 (local research; https://github.com/stage-ai) curl/8'
  curl -sIL -A "$UA" "https://upload.wikimedia.org/wikipedia/commons/..."   # 200
  ```

  **入库脚本必须用描述性 UA，且请求间加 ~2–5 s 间隔**，否则会随机踩到 429。
- **Commons 路径是「一字符 / 两字符」两段哈希**（如 `7/74/`、`c/c2/`、`a/ab/`），不是常规的两段各两字符。拼接或校验时别写错段数。
- **Openverse 返回的 StockSnap `url` 是 960w 缩略图**，与元数据声明的 3000×2000 不符 —— **入库前一律用 `file` 或 PIL 核对真实像素**。
- **CC-BY 署名必须落到 `meta.json`**：incompetech 需要 `Music by Kevin MacLeod (incompetech.com), Licensed under CC BY 4.0` + 曲名 + ISRC（ISRC 可从 `pieces.json` 取）；Commons 的 `Heartbeat speedsup.wav`（Bob Smaude）、`Nosferatu thunderclap`（Richard Humphries）、`Rhumphries - rbh-thunder-storm` 需署作者名。**建议素材库在 `meta.json` 里固化 `license` + `attribution` 两个字段，署名页自动生成。**
- **`rpg_sound_pack.zip` / `MoreSounds.zip` 等老包的文件名是 2011 年 macOS 时代的 WAV**，采样率多为 44.1k mono，体积虚大，建议统一转 OGG。
- **素材目录进 git 的体积预算**：按推荐清单 62 条全量入库，BGM 20 条转码后约 25–35 MB、SFX 33 条约 5 MB、背景 9 张约 12 MB（含 16.5 MB 的森林大图），**总量控制在 50 MB 以内是可达的**；若把 incompetech 原片直接塞进去会突破 200 MB。

---

## 5. 附：本调研的验证方法（可复现）

```bash
P="-x http://127.0.0.1:7890"   # 直连优先，失败再回退代理

# 1) 单条直链体检（状态码 / content-type / content-length）
curl -sIL --max-time 30 -A "Mozilla/5.0" "<url>" | grep -iE '^(HTTP/|content-type:|content-length:)'

# 2) OGA CC0 检索（CC0=4, Music=12, SFX=13, 2D Art=9）
curl -s 'https://opengameart.org/art-search-advanced?keys=&field_art_type_tid[]=13&field_art_licenses_tid[]=4&sort_by=count&sort_order=DESC&items_per_page=120'

# 3) OGA 条目的真实许可字段（避免把 CC0 误认成 CC-BY）
curl -s 'https://opengameart.org/content/<slug>' | grep -o 'License(s):[^<]*'

# 4) incompetech 机器可读目录
curl -s 'https://incompetech.com/music/royalty-free/pieces.json'   # 1443 首，含 title/filename/isrc/feel/bpm
curl -s 'https://incompetech.com/llms.txt'                          # 站方自述的数据端点清单

# 5) Commons 音频检索 + 许可 + 干净直链
curl -s 'https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=filetype:audio%20door&srnamespace=6&srlimit=12&format=json'
curl -s 'https://commons.wikimedia.org/w/api.php?action=query&titles=File:X.ogg&prop=imageinfo&iiprop=url|size|mime|extmetadata&format=json'

# 6) 字节真实性核对
file <已下载文件>                      # 音频类型 / PNG 尺寸 / 位深
ffprobe -v error -show_entries format=duration -show_entries stream=sample_rate,codec_name -of csv=p=0 <文件>
```

**统计**：本调研共对 **102 条直链**跑了 HEAD 校验（59 条 SFX + 43 条 BGM/单文件），**全部返回 200**；最终对报告正文中 **55 条可直接复制的素材直链**做了一次全文回归复验（描述性 UA + 1 s 间隔），**同样全部 200**；另**实际下载 100+ 个文件**（约 480 MB）用于 `file`/`ffprobe` 字节核对；Openverse/Wikimedia/kenney/itch.io/freepd 各自单独做了连通性与授权验证。代理仅在 `freepd.com` 首轮探测时用到 —— **所有最终采纳的直链均无需代理**。
