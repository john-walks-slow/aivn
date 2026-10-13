# 纯文本 / 文本为主的互动小说（NVL / Sound Novel / Interactive Fiction）界面、排版范式与交互机制调研

> 调研目的：为 AIVN 设计「纯文本 / 文本为主的互动小说」显示方式与主题变体提供外部事实基线。
> 方法与边界：全部内容来自公开网络资料，逐条附来源链接；凡属来源作者的推测或未确证之点，均在该条内明确标注（见文末「存疑与未覆盖」）。
> 本文不含设计建议，只做事实聚合与对照。

---

## 0. 一页速览：本调研确证的关键事实

| 维度 | 确证事实 | 来源 |
| --- | --- | --- |
| 术语源流 | 全屏文字 = Chunsoft 1992《弟切草》确立的「サウンドノベル」格式；「ビジュアルノベル」一词由 Leaf 1996《雫》提出 | [arai-novelgamelabo](https://arai-novelgamelabo.com/entry/2024/10/25/120000) / [GameBusiness](https://www.gamebusiness.jp/article/2019/07/24/15991.html) |
| NVL 定义 | Ren'Py 官方二分法：ADV = 底部窗口逐行；NVL = 占满整屏的窗口、一次显示多行 | [Ren'Py nvl_mode](https://www.renpy.org/doc/html/nvl_mode.html) |
| 换页机制 | NVL 不自动清屏，必须显式 `nvl clear`（Ren'Py）/ `@resetText`（Naninovel）/ `Clear Page`（RouteVN） | [Ren'Py](https://www.renpy.org/doc/html/nvl_mode.html) / [Naninovel](https://naninovel.com/guide/text-printers.html) / [RouteVN](https://routevn.com/en/creator/docs/line-actions/dialogue/) |
| 追加 vs 替换 | Monogatari 的 NVL「dialogs are appended rather than replaced」，文本框可滚动并带 `unread` 指示 | [Monogatari](https://monogatari.io/v2/components/text-box) |
| 名字三派 | 名牌在窗内 / 独立名牌窗 / 完全不用名牌（ATRI 属于第三派：窗口之上无名牌地直接显示名字） | [arai 画面構造2](https://arai-novelgamelabo.com/entry/2024/10/28/170000) |
| 内心独白 | Ren'Py 内置 `nvl_thought` 样式（继承 `nvl_dialogue`），与 `nvl_label` / `nvl_dialogue` 并列 | [renpy 00nvl_mode.rpy](https://github.com/renpy/renpy/blob/master/renpy/common/00nvl_mode.rpy) |
| 文本颜色即规则 | 《うみねこのなく頃に》赤文字 / 青文字 / 金文字：文字颜色本身就是可推理的规则层 | [ja.wikipedia うみねこ](https://ja.wikipedia.org/wiki/%E3%81%86%E3%81%BF%E3%81%AD%E3%81%93%E3%81%AE%E3%81%AA%E3%81%8F%E9%A0%83%E3%81%AB) |
| 焦点化处理 | 《魔法使いの夜》推进时把上一段文本整体淡为半透明，只留当前文本清晰 | [someiyoshino](https://someiyoshino.info/entry/20131012/1381545919) |
| 无窗（无底板） | 《アオナツライン》默认消息窗完全透明；《Life is Strange》字幕式直接压在画面上、不显示说话人 | [arai 画面構造5](https://arai-novelgamelabo.com/entry/2024/11/14/180000) |
| 文字压图的可读性线 | WCAG 1.4.3：正文 4.5:1，大字 3:1；F83 明确把「背景图与前景文字对比不足」列为失败 | [W3C G18](https://www.w3.org/WAI/WCAG22/Techniques/general/G18) / [W3C 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) |
| 半透明面板测量法 | 必须分别对纯白、纯黑两种最坏背景测；实测 92% 不透明度达标，82% 时暗色主题文字降到 3.74:1 | [gohud](https://thruthesky.github.io/gohud/ja/theming-contrast.html) |
| 中日文行宽 | JLReq：縱組 1 行最大约 52 字、横組约 40 字；行間 1/2 全角〜全角 | [W3C JLReq](https://www.w3.org/2007/02/japanese-layout/docs/aligned/japanese-layout-requirements-ja.html) |
| 中文移动端行宽 | 每行中文字符 17–46，最佳 23；行高定 1.70；行长为字号整数倍 | [MEUX](http://meux.baidu.com/articles/65) / [极客文档](https://geekdaxue.co/read/yoyo24777@vst2c1/69a858bd-4d28-4248-971c-465e331939b6) |
| 基础阅读学 | 45–90 字符/行、行距 120–145%（Butterick）；45–75 字符、理想 66（Bringhurst，经 vocab.design 转述） | [Butterick](https://practicaltypography.com/line-length.html) / [vocab.design](https://vocab.design/measure) |
| 打字机无障碍 | Web 端 typewriter 组件族普遍支持 `prefers-reduced-motion`：命中时全文立即显示、光标不闪 | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) / [Quiet UI Typewriter](https://next.quietui.org/docs/components/typewriter) |
| AI 时代的「小说模式」 | Reverie 小说模式：散文填满屏幕、无气泡、更大字号与更宽行距、连续滚动不分页、操作栏默认极简、玩家指令用柔和视觉处理区分 | [Reverie](https://reverie.im/zh/blog/introducing-novel-mode) |

---

## 1. 术语、谱系与显示形态分类

### 1.1 四个关键词的准确含义

- **サウンドノベル（Sound Novel）**：Chunsoft 的商标与自称体裁，1992《弟切草》起。[Giant Bomb](https://wiki-origin.giantbomb.com/wiki/Franchises/Sound_Novel) 记：「故事文本覆盖整个画面，而不是装在文本框里，通常文字背后有一张图表现正在描述的内容」；「sound」来自对音效/BGM 的高度依赖。系列：弟切草(1992)、かまいたちの夜(1994)、街(1998)、かまいたちの夜2(2002)、忌火起草(2007)、428(2008) 等。
- **ビジュアルノベル（Visual Novel）**：Leaf「リーフビジュアルノベルシリーズ」提出，通常指《雫》(1996)、《痕》(1996)、《To Heart》(1997) 三作（[ja.wikipedia ビジュアルノベル](https://ja.wikipedia.org/wiki/%E3%83%93%E3%82%B8%E3%83%A5%E3%82%A2%E3%83%AB%E3%83%8E%E3%83%99%E3%83%AB)）。注意：**英语圈的 visual novel 与日语的「ビジュアルノベル」指涉不同**——英语圈多指「立绘 + 背景 + 文本框」的泛指（即日语的「選択式アドベンチャーゲーム」），Steam 标签也用此义；日语圈则偏「小说倾向的美少女游戏」。[GameBusiness](https://www.gamebusiness.jp/article/2019/07/24/15991.html) 指出欧美因 80–90 年代日本 ADV 几乎未输出、且全屏文字型（ひぐらし 等）出海更晚，导致「全屏文字 = 日本的 ADV」这种理解。
- **NVL**：Ren'Py 文档的二分——ADV（底部窗口逐行） / NVL（占满整屏的窗口、一次多行）。名称即「Novel」。[Ren'Py](https://www.renpy.org/doc/html/nvl_mode.html)；日文版同页 [ja.renpy.org](https://ja.renpy.org/doc/html/nvl_mode.html)。
- **キネティックノベル（Kinetic Novel）**：无分支、纯阅读。Ren'Py 文档把「无转场的 kinetic novel」列为 NVL 的典型适用场景。日语维基记《ひぐらしのなく頃に》虽自称サウンドノベル，但「ストーリー展開に影響を与える選択肢や分岐は存在せず、プレイヤーは一本道のシナリオを順に読み進め」——即实为 kinetic 式（[ja.wikipedia ひぐらし](https://ja.wikipedia.org/wiki/%E3%81%B2%E3%81%90%E3%82%89%E3%81%97%E3%81%AE%E3%81%AA%E3%81%8F%E9%A0%83%E3%81%AB_)）。

### 1.2 全屏文字的起源与「一度被边缘化、又被复兴」

[arai-novelgamelabo 画面構造1](https://arai-novelgamelabo.com/entry/2024/10/25/120000)（2024-10-25）指出：
- 国產 ADV 之始《表参道アドベンチャー》以及更早的海外作品，就是「真っ黒な画面いっぱいにテキストを表示し、状況を描写する」。
- 之后「グラフィックを画面上部に、テキストを下部に」的类型成为主流，全屏显示一度被赶到历史角落。
- **1992 年 Chunsoft《弟切草》把它复活**，并确立今日ノベルゲーム的格式；其「背景グラフィック全屏 + 临场感音响 + 分支选择」成为后来 Leaf 提「ビジュアルノベル」的范本。
- 全屏显示的特性：**「まさに小説的であること」**——不必遵守「メッセージは可能なかぎり削ぎ落とし簡潔に」这条游戏通则，可以以地の文（叙述）而非台词为主，人物与情景描写不必让位给「絵を見ればわかる」。
- 必须注意的唯一结构性限制是**文章跨页（ページまたぎ）**：「これを怠ると、せっかく良質な文章でもひどくだらしなく見えてしまう」（也存在刻意跨页的演出）。
- 全屏显示的排版自由度：可以「10 行以上も画面に広がる濃密な文章」连成一气，也可以某场景「1 行のみ画面中央にスパッと切れ味鋭く見せる」——这是「1〜3 行程度の文章をページ毎に固定位置に見せていくタイプ」所没有的控制乐趣。
- 该文举的近代全屏案例：《BLACK SHEEP TOWN》（BA-KU、PC、2022）。

历史顺序的另一处澄清（[garden at dawn, 2016](https://gardenatdawn.blogspot.com/2016/01/layout.html)）：全屏背景的想法 1992 年《弟切草》就有（PC 平台的《雫》1995），而今日我们熟悉的「全屏背景 + 下部文本框」初期作品（如《Piaキャロットへようこそ!!》1996、SS 版《下級生》1997）反而更晚；也就是说**下部文本框的普及并不早于全屏文字**。该文另外把屏幕结构谱系化为：古典多重窗口 → 全屏 + 下部文本框 → 全屏背景 + 全屏文字（完全的单一窗口）。

### 1.3 ADV / NVL 各自的表现性质（多来源交叉）

| 论点 | ADV | NVL | 来源 |
| --- | --- | --- | --- |
| 文本量/段落 | 必须「省略のテクニック」；甚至可以完全没有地の文，只靠台词与独白推进 | 可容纳长叙述、内心、层层描写 | [arai 画面構造2](https://arai-novelgamelabo.com/entry/2024/10/28/170000) |
| 节奏 | 快、轻；视觉不被遮挡 | 慢；过去行会残留在屏幕上，玩家可重读 | [towardstheendsky: NVL vs ADV](https://towards-the-end-sky.blogspot.com/2022/10/nvl-vs-adv-anatomy-of-visual-novels.html) |
| 视觉呈现 | 立绘/背景完整可见 | 立绘缩小、移到角落或干脆消失；美术倾向「清晰形状、不喧哗的配色」，因为强烈色彩会被文字层压住 | 同上 + [VN Paths](https://vnpaths.com/adv-vs-nvl/) |
| 适用题材 | 依赖视觉反应与快速会话 | 恐怖、心理剧、kinetic novel；「持续累积的紧张」 | [VN Paths](https://vnpaths.com/adv-vs-nvl/) |
| 混合 | 多数作品按场景切换：日常对话用 ADV，沉重独白/梦境/高潮转 NVL；典型为《素晴らしき日々》 | — | 同上 + towardstheendsky |
| 风险 | — | 频繁切换会造成玩家「失去现在是什么模式」的困惑、整体失焦 | towardstheendsky |
| 与引擎无关 | 现代主流引擎两边都能做 | — | VN Paths |

一手创作者/玩家观点（Lemma Soft 论坛长期讨论串）：[Full Page Text or Text Box?](https://lemmasoft.renai.us/forums/viewtopic.php?t=1776)（2007）、[ADV or NVL?](https://lemmasoft.renai.us/forums/viewtopic.php?t=3235)（2008）。其中集中出现的具体论点：
- 反对 NVL：「text obscures the images」「the image is dimmed and so 99% of the time I'm not seeing the "real" graphic, but a washed-out version」「if I want to stop and admire a graphic, I need to hide the text」；想看清 CG 得手动清屏。
- 支持 NVL：「feels more like reading a book」「you don't have to dim the screen too much (setting the alpha to 0.25 is just fine)」「I hate looking at the knees of characters while reading their text」。
- 折中方案举例：**半页 NVL**（1/2 页宽 NVL + 两侧放立绘）、「NVL for narrative, AVG for conversation」、「CG 用 NVL 展示、日常立绘场景用 AVG」。
- 一个创作者的做法（Ori Ochi Onoe）：不要文本框、也不想让文字完全盖住图，希望文字靠近脸部——「so you wouldn't stare at the girl's legs (AVG), but look her in the eyes when reading」。
- 关于「有大量动态立绘切换时用 NVL 会显得好笑（silly）」、以及「NVL 更像绘本书、ADV 更像动画」的判断。
- 关于「静态 CG 多时 NVL 更合适」。

一个 indie 开发者（One Day to Disappear, itch devlog）自述选择 NVL 的理由：**缺立绘与背景**、大量主人公内心独白与回忆闪回；并列出 NVL 的工程成本：「NVL is more difficult to program. Unlike the ADV it must be hidden and shown many times, especially when the scene changes or the characters change their expressions.」（[来源](https://onedaytodisappear.itch.io/one-day-to-disappear/devlog/148931/adv-or-nvl-this-is-the-problem)）

---

## 2. 日系 NVL / Sound Novel 代表作界面范式

### 2.1 《弟切草》（1992, SFC）与「サウンドノベル」的界面决定

- 画面：**一张绘有森林/洋馆的单幅画上直接叠加文章**；玩家读文章并在各处选择分支。（[ja.wikipedia 弟切草](https://ja.wikipedia.org/wiki/%E5%BC%9F%E5%88%87%E8%8D%89_(%E3%82%B2%E3%83%BC%E3%83%A0))）
- 开发依据（note 上的 33 周年回顾访谈，[note/nohdomi](https://note.com/nohdohi/n/n8fc4983131d0)）记录了**当时的 A/B 测试式取舍**：
  > 「ボタン押したら、画面自体が切り替わる？ボタン押すごとに、一文字ずつ？テキスト全部出す？カラオケみたいに色が変わるのは？ いろいろ試した結果、**一気に文字を出すと、置いてかれる感じがする**ため、**ボタン押下で、せいぜい3行、できれば1、2行表示する**という要件に落ち着いたそう。」
  （即：一次性全出 → 会被抛弃感；最终定为「一次按键最多 3 行，理想 1〜2 行」。）
- 音的设计：仅 9 曲，按「音のパート単位」拆开、逐层叠加营造氛围、或「ブツっと切って」制造恐怖；库房/水槽等生活音采样（同来源 + [ja.wikipedia](https://ja.wikipedia.org/wiki/%E5%BC%9F%E5%88%87%E8%8D%89_(%E3%82%B2%E3%83%BC%E3%83%A0))）。
- 玩法结构副作用：「お土産がいる」「ちょうちん」（两选项同结果的分支）等开发术语；**随进度增加选择项**（中村光一的主意）——「開発途中までは、すべての選択肢は見えていたそうです」。
- 「ピンクのしおり」：隐藏剧本的记号（此后成为 Chunsoft サウンドノベル的定番要素）。

### 2.2 《かまいたちの夜》（1994, SFC）

- 画面：「グラフィック上に文章が直接表示され、途中に出てくる2択〜4択の選択肢から好きなものを選ぶ」；多结局，且存在与事件真相完全无关的结局。（[ja.wikipedia かまいたちの夜](https://ja.wikipedia.org/wiki/%E3%81%8B%E3%81%BE%E3%81%84%E3%81%9F%E3%81%A1%E3%81%AE%E5%A4%9C)）
- **人物只用蓝色剪影**：取「据体格/发型区分角色」「不破坏玩家想象、便于移入感情」之效；后被广泛沿用作演出效果。（同页 + [4Gamer 30 周年访谈](https://www.4gamer.net/games/999/G999903/20240410075/)）
- **「画面をだんだん暗くする」机制**：麻野一哉为「不花成本地制造恐怖」让程序员做了「玩家察觉不到的程度把画面逐渐变暗」的命令——「同じ背景の画面でも、シナリオの最後の方になるとだいぶ暗くなってる」。灵感来自 DQ 地下城逐层降调的演出。（[4Gamer](https://www.4gamer.net/games/999/G999903/20240410075/)）
  - 这条对「背景图作为氛围衬底 → 压暗」提供了最直接的正史依据：**压暗是渐进、无感、与剧情进度联动**的。
- 音：约 250 种效果音，部分效果音是推理的重要线索；BGM 被大量电视节目借用。（[ja.wikipedia](https://www.kanmaitachi...) 同上）
- 实拍背景 + さりげない动画（猫跑过、女主角扑进怀里、血从楼梯滴下）。合成方法学的取舍：不当場残酷描写、把「一瞬だけカラーで見せて、すぐに白黒にする」。（4Gamer 同页）
- 手册开头一句被反复引用：「音のついた小説を，テレビ画面を通して楽しむことができるソフトです」——サウンドノベル 中「音」的优先级。（4Gamer 同页）
- **手机版（现代改版）的界面变化**（ja.wikipedia 同页）：
  - 「スマートデバイスの操作に合わせ、**タッチやスワイプなど電子書籍スタイルに適したインターフェース**に変更。これに伴い、**画面に文章が一気に表示されて読み進める形式**になっている」——即从「一次 1–3 行」改为「整页文字一次显示、翻页阅读」。
  - 「人物のシルエットが全てオミットされ、背景のみになっている」。
  - 追加：章仕立て、非搭载 flowchart。
- 系列新作《かまいたちの夜×3》（2024）官方描述仍用同一句范式：「**画面全体に表示されるテキストを読み進め、挿入される背景画像やサウンドにより臨場感あふれる演出を楽しめるサウンドノベル**」；并新增 5 分钟单位的时间轴，可在四位可操作主角间切换。（[Spike Chunsoft](https://www.spike-chunsoft.co.jp/news/43257/)）
- 英文维基条目（[Banshee's Last Cry](https://en.wikipedia.org/wiki/Kamaitachi_no_Yoru)）补充的可交互细节：**玩家会被要求输入「自己认为凶手是谁」的名字**；可快进已读文本、也可回退重读；故事按章分割，通关后章可重选重读；发现越多结局，分支点的可选项越多。并记该作「引入了 flowchart 式叙事结构」，成为 90 年代末—2000 年代日本 ADV 的潮流（《YU-NO》即属于此结构谱系）。

### 2.3 《街》《428 〜封鎖された渋谷で〜》：文本本身成为可操作界面

**428**（2008, Chunsoft，サウンドノベル）的一手系统资料：
- 类型定义同「画面全体に表示されるテキスト」。（[ja.wikipedia 428](https://ja.wikipedia.org/wiki/428%E3%80%9C%E5%B0%81%E9%8E%96%E3%81%95%E3%82%8C%E3%81%9F%E6%B8%8B%E8%B0%B7%E3%81%A7%E3%80%9C)）
- **文本内的词法交互**（[428 系统说明页](https://sangokusi.syuriken.jp/428/system.html) + ja.wikipedia）：
  - **TIP**：文章中**蓝色显示**的词，按 − 键划线、A 键即可读该词的「マメ知識」注释；注释分「428 标记」的设定说明与「虫眼鏡マーク」的现实世界说明两类。
  - **JUMP**：其他主角剧本中**红色显示**的人名，划线后 JUMP 过去，可解除某主角的 **KEEP OUT**（禁止进入）状态。
  - **时间轴（タイムチャート）**：5 分钟单位的格子，可确认/切换各主角在何时何地；既读时段可自由移动。
  - **TO BE CONTINUED**：某主角到达时段结尾即停；当**所有人**都 TO BE CONTINUED，播放预告片并进入下一时段。
- 界面演出的制作意图（4Gamer×ゲーマガ 对石井次郎访谈，[4Gamer](https://www.4gamer.net/games/094/G009484/20100122061/)）：
  - 进入时间轴时的「画面缩小」演出被刻意做成**不是切到另一画面**：「タイムチャートの柱に時間が凝縮している感じで」。
  - **明确禁止「文字上叠文字」**：「なぜかと言うと、**文字に文字を重ねるのはタブー**だからです」——因此教程（チュートリアル）长期不入，直到最后阶段才加。
  - 静止画用 pan/zoom 制造非单调性。
- 手机版（iOS/Android）操作映射（[4Gamer まとめ](https://www.4gamer.net/games/140/G014031/)）：タップ=読み送り、上スワイプ=読み戻し（既読テキスト）、下スワイプ=読み進み、2 本指タップ=亮度调整、下から上スワイプ=时间轴、画面下长按=主菜单、画面下双击=自动播放。**这是「纯文本阅读器」手势层的一个可直接对照的现成方案。**

### 2.4 《月姫》（2000）与《月姫 -A piece of blue glass moon-》（2021）

- 原始《月姫》用 **NScripter** 开发（[GameBusiness](https://www.gamebusiness.jp/article/2019/07/24/15991.html)；[ja.wikipedia ひぐらし](https://ja.wikipedia.org/wiki/%E3%81%B2%E3%81%90%E3%82%89%E3%81%97%E3%81%AE%E3%81%AA%E3%81%8F%E9%A0%83%E3%81%AB_) 的引擎栏同为 NScripter）。
- 重制版（2021）的系统清单（[Famitsu まとめ](https://www.famitsu.com/news/202108/26231377.html)）：系统菜单（Save/Load/Config/FlowChart）、**画面上部显示当前章标题与场景标题**、FlowChart、Gallery FlowChart、好感度分支、**含「表示されているのに選べない項目」**（随进度/好感度/分歧开放）、早送り（R1，未读或选项处自动解除，进入已读区再开）、早送り・早戻し（按住 R2/L2）、オートモード（L1，**语音处会等到播完**）、Backlog（△打开，可按 ○ 跳到该场景）、Mode Panel（↑打开：场景跳转、快速存档/读取、**直前のボイス再生**）、「既読シーンのオートスキップ」可连续跳到选项。
- 玩家侧的实际不满（两份体验记）：[ponkotugamer](https://ponkotugamer.com/2021/tsukihimer1/) 指「スキップ速度が遅い」「フローチャートから現在の位置より先には進めず後ろにしか戻れない」「章替わりのアイキャッチなどが飛ばせない」；[anbki](https://anbki.hatenablog.com/entry/2021/09/03/011627) 指「『次の選択肢までスキップ』がない」「バックログからボイス再生できない」。
- 演进评价（[inside-games](https://www.inside-games.jp/article/2021/09/20/134309.html)）：既读跳过、flowchart 齐备；新鲜点是**立绘显示方式的丰富变化**——「セリフに合わせてキャラクターの表情がコロコロと変わるのはもちろん、その時の距離感に応じてグラフィックの見せ方も変化」；庞大的文本量因此不显冗长。
- 另一篇从 ADV 设计史角度看 Type-Moon 的分析（[snowstep](https://snowstep.hatenablog.com/entry/20100727/1280256356)，2010）指出一个关键对照：Fate 在「一枚絵の震動、スクロール、部分エフェクト」与拟动画式切换上极其讲究，**但「Fate」对 Leaf 视觉小说所重视的『文字』及其配置所带来的平面艺术性演出却是『驚くほどに無頓着』**——即同为 NVL 谱系，Leaf 系（文字排版本身即演出）与 Type-Moon 系（文字是承载、演出交给图像）是两条不同的“文本为主”路线。

### 2.5 《ひぐらしのなく頃に》（2002）与《うみねこのなく頃に》

- 引擎：NScripter（ja.wikipedia ひぐらし 信息框）。体裁自称サウンドノベル，**无分支选项、一本道**（同页）。
- 文字显示：NVL 全屏。技术细节（[Qiita：Steam 版ひぐらし的字体替换](https://qiita.com/Msak/items/9ac1b71e9625fdc3b89c)，Unity 版）：
  - 正文字体用 **SDF（Signed Distance Field）** 形式嵌入资源（便于低开销加特效），日文约 3000 字被嵌入 SDF；正文用了 MS ゴシック。
  - 想改外观可在 `StreamingAssets/Scripts/init.txt` 里改 `SetCharSpacing(); SetLineSpacing(); SetFontSize();` 等参数，把改好的 init.txt 放到 `StreamingAssets/Update` 即生效（**即行距/字距/字号是配置文件级的开放参数，不是写死的**）。
  - 注意该文的实用警告：改动字距/字体导致**每行字数变少 → 行数变多 → 文本溢出窗口**——与「全屏文字需要按行容量反推排版」这一点直接相关。
- 《ひぐらし奉》（主机版）的设置项清单（[良藝館](https://www.kmzwakr.net/g44.html)）：操作音、BGM、SE、语音音量、语音焦点、语音声像、**消息显示速度**、**消息既读判定（开/关）**、**窗口透明度**（越右越不透明）、ルートナビ、**オートモード速度**、曲名显示、场景标题显示。游戏内快捷键：L1 = オート切り替え、R1 = 既読スキップ切り替え。**「窗口透明度」被做成玩家可调设置项本身就是一个可复用结论。**
- 《うみねこのなく頃に》的「文字颜色即规则」（[ja.wikipedia うみねこ](https://ja.wikipedia.org/wiki/%E3%81%86%E3%81%BF%E3%81%AD%E3%81%93%E3%81%AE%E3%81%AA%E3%81%8F%E9%A0%83%E3%81%AB)；[うみねこ解析 wiki](https://w.atwiki.jp/herikutu/pages/91.html)；[うみねこはないているか](https://umineko.locker.jp/akaji_o.html)）：
  - **赤き真実**（EP2 追加）：说话内容以**红字**展示即保证为绝对真实，无需举证；但不能说谎，也不能说出令游戏推进不能的话（否则成为ロジックエラー）。
  - **青き真実**（EP4 追加）：**蓝字**用于提出推翻对手主张的具体推理；被蓝字攻击方负有以红字反驳的义务；到游戏结束时刻（1986/10/6 00:01）仍未反驳则人类方胜。
  - **黄金の真実**（EP5）：**金字**，仅 game master 可用，力量与红字同等（有时劣、有时优）。
  - **復唱要求**：己方假设以「」括起，要求魔女以红字复唱；无强制力，魔女可以拒绝。
  - 标题本身印成「うみねこのなく頃に」，其中「な」为红字。
  - 附带的实际机制：赤文字打到一半若内容非真会**中途断掉**。
  - 这些是「**用文字样式承载规则语义**」的最强商业案例：颜色不是装饰，而是可被玩家推理、可被说谎方利用的规则对象。
- 关于说话人名与脚本结构：《うみねこ》的脚本数据本身**不直接绑定说话人名**（原版 PC 与 07th-mod 版本），需要靠对话前的 `msgwnd_xxx` 类命令来设置文本框里的说话人名——Project Umineko 维护者在讨论中如此说明（[umineko-project discussion #10](https://github.com/umineko-project/forum.umineko-project.org/discussions/10)）。而 Project Umineko（PS3 素材移植版）**每句有声优的台词都在框顶部有 nametag**。→ **「名牌」在这类引擎里是可开关的实现层选择，而不是叙事必需品。**
- PS3 版文本渲染的技术规格（[umineko-scripting docs/dialogue.txt](https://github.com/umineko-project/umineko-scripting/blob/master/docs/dialogue.txt)）：**逐字显示但速率非恒定**，逗号后停顿更长、某些字符前也停顿；参数 `a`（默认约 8）表示某字符从开始显示到完全淡入所需帧数（60fps 帧）；参数 `s` 覆盖消息显示速度设置，显式指定时**用户设置无效**；`a=100/300/600` 对应不同长度的向左淡入跨度；`s=1000` 时全部字符同时出现但有约 8 帧的淡入；`s=1000`+`a=0` 时除逗号后 4 帧停顿外完全瞬时。→ **「打字机效果」在这类作品里是逐字出现 + 逐字淡入 + 标点停顿三个维度共同定义的，而不是单一的 cps 数字。**

### 2.6 《Fate/stay night》（2004）与 NVL 段

- 引擎：吉里吉里2（[GameBusiness](https://www.gamebusiness.jp/article/2019/07/24/15991.html)）。
- NVL 段的排版控制力（[towardstheendsky](https://towards-the-end-sky.blogspot.com/2022/10/nvl-vs-adv-anatomy-of-visual-novels.html)）：「Perhaps the most vivid example of this is Fate Stay Night which uses **the colour, position, font and shapes** available to control player perceptions with a level of finesse not possible without NVL」；并提醒此手法有过度使用风险（「will rapidly become familiar and breed complacency」）。
- 具体手法之一（[towardstheendsky: Text Presentation](https://forums.fuwanovel.moe/blogs/entry/4377-text-presentation-%E2%80%93-an-anatomy-of-visual-novels/)）：**Berserker 的咆哮不写字，而用块状图形符号**代替——形状不均匀、破坏玩家对「对话」的既有预期，直观传达「狂战士」的原始与力量。文末总结：由于 VN 绝大多数时间都保持标准格式，任何格式破坏都会产生显著冲击。
- 同文对基础样式的性质总结（可作为「Say/Narrate/Thought」区分的语义学依据）：
  - 斜体：强调某些词句；**常与主人内心思考关联**；曲线柔和、更「轻、隐含」，像文字形式的耳语。
  - 粗体：视觉上等于「对读者大喊」，无可忽略，用于当下必须被注意的关键信息，或标示台词中的音量与情绪重音。
  - 颜色：可用关联意义（红=力量/攻击性、蓝=流动/平静），但**文化差异使其不如粗斜体普适**；例：Muv-Luv 给每个角色分配专属颜色，说话即用该色——一眼知道谁在说话，同时颜色本身提示角色轮廓。

### 2.7 《魔法使いの夜》（2012）：把「焦点」做成文本动画

[someiyoshino：テキストレイヤ UI 考察（1）](https://someiyoshino.info/entry/20131012/1381545919)（2013-10-12）的逐帧观察：
- **接触按键等待时，刚才绘制的那一段文本整体淡为半透明**；「今フォーカスされているテキストにのみ視線を集中させる、大変美しい処理」。
- 不是按行处理：多行会整块淡出；也可能在行途中等待输入、先淡出前半再显示后半；**旧活跃文本的淡出与新活跃文本的绘制同时进行**。
- 推测实现是在吉里吉里上重度定制（作者自注「どうも力技のような気がしている」，即此点为该博主的推测）。
- 字体：商用字体**筑紫明朝**转为图像资源随软件分发，并做**袋文字（描边字）**。
- 同系列第 4 篇（[シルバー事件／花と太陽と雨と](https://someiyoshino.info/entry/20131016/1381887762)）记录了「文本层 UI 完全非通则化」的极端案例：每显示 1 字先出光标 → 出方框 → 文字淡入（玩家会「目がチカチカして、かつ酔います」）；文本层坐标/行数/翻页演出按场景各异；翻页时从下方升起三条线逐像素抹除文字；另一作的翻页是「テキストレイヤが左侧から赤のグラデで塗りつぶされ、右に抜けて行く」，文字白→红→黑逐段淡变。作者结论：这类演出「ちゃんと分析すると、なんとなく今実装しているテキストレイヤでどちらも再現出来る気がしてきた（ページフラッシュをテキストレイヤ外で処理しないといかんが）」。

### 2.8 日系 NVL 的「文字加工」技法清单

[cactus_backyard 演出論的覚書 IV-4-3-α「テキストに関して。表示形態」](http://cactus4554.blogspot.com/2011/10/blog-post_7377.html)（2011）是一份不可多得的技法清单，逐条摘录：
- **显示形态本身即演出**：通常会话用画面下部消息框，主人公内面描写/回想场景切到全屏文字显示（所谓 visual novel 型）——这种灵活切换是 PC 用 AVG 特有。
- **竖排显示**在 PC 媒体上本身就是个性化的视觉演出。
- **词典/注释层**：正文中对文本用 popup 或 link 提供注释说明，或另设用语集；「メッセージウィンドウ多重表示」也与之相关。
- **字体操作**：按角色改文字颜色已广泛普及；**放大文字表示大声**也常见；Leaf 在「ビジュアルノベル」系列采用**自家字体**；**多书体并用**的代表是 Littlewitch（按说话者或感情切换各种字体）与 Triangle（**地の文用ゴシック体、台詞部分用明朝体**）。
- **文字以图像形式显示**：开头 epigraph 式文本、eyecatch、章标题、拟音文字。
- **画面内的“纸面”**：报纸、手机画面等以图像形式把文字信息呈现给玩家（举例《しすたぁエンジェル》《よつのは》）。
- **翻页节奏 = 文体造形**：点击翻页的间隔（= 一页显示的文章量）有时强调韵律感、有时表现速度感；与音響/画像脚本协作带来缓急抑扬、转换与断绝。
- **局部变速/临时自动**：在特定处给文本显示速度加权，或临时切自动推进以突出该处。
- **显示模式切换**：《HUSHABY BABY》(1999)、《妻とママとボイン》(2006) 有关西腔模式切换；《銀色》(2000) 有英语模式；《仏蘭西少女》可选中台词是否显示中文（并联动语音）。
- **竖排/横排可切换的实际产品**：《霞外籠逗留記》(raiL-soft, 2008) 开头部分用户可任意切换竖排/横排；raiL-soft 称此规格为 **「V=R（ヴァリアブルリード）システム」**，并在其后各作持续实现。
- 词典功能的实例清单（《二重影》《うたわれるもの》《水月》《最果てのイマ》等）；推理类 ADV 常附「手帳機能」。

---

## 3. 现代叙事游戏与互动小说（西方 / Web / AI 时代）

### 3.1 inkle：把「文本 UX」明确表述为两条支柱

- **GDC 2018「Designing Text UX for Effortless Reading」**（Joseph Humfrey）：[GDC Vault](https://gdcvault.com/play/1025104/Designing-Text-UX-for-Effortless) 摘要写：「principles of good typography and typesetting across a range of devices. **Animation will be shown to have value beyond aesthetics; it can play a critical role in leading the eye.** Eliminating distractions helps the player focus on the act of reading. All the design techniques fit inkle's two major pillars of text UX design, **focus and pacing**.」[重播页](https://www.gamedeveloper.com/design/video-designing-text-ux-for-effortless-reading)、[gamedesign.gg 摘要](https://gamedesign.gg/watch/text-ux-effortless-reading/)。
- 该演讲的现场听记（[Emily Short 的线程存档](https://threadreaderapp.com/thread/986670130347364352.html)）与媒体整理（[Kotaku](https://kotaku.com/the-problems-with-illegible-text-in-video-games-and-som-1825018305)）保留了可直接引用的具体数字与判断：
  - 「Focus is like harmony—beautiful typography in a single moment. Whereas pacing is like melody—how the story flow is presented over time, as a sequence.」
  - 「**Readable type face, 5–15 words a line, generous margins**；draw player eye with text brightness to where they should focus」（Emily Short 记录）。
  - 「**If the player is ever waiting between lines, even for a moment, they accumulate a sense of apathy.**」（Emily Short 记录）
  - 「Large sections of text speeds the player up *if* the player is already focused. **Rapid succession of choices does not actually speed things up.**」
  - 「In 80 days, the choices **fade in last and slowly** to try to get the player to commit to reading the body text first.」
  - 「Animating text flow leads the eye to where you need to read next.」
  - 「Test and iterate to get your pacing just so -- and do this with the final UX.」
  - BBC 字幕准则被点名为应参照对象：「the right size」「split larger quantities of text across multiple timed sections, allowing a smaller quantity of larger text, and preventing the eye from getting lost while reading」；并批评多数游戏的字幕不如便宜 DVD。
  - 以《Oblivion》的书做「legible 但不 readable」的反例：字体风格贴世界观、字形可辨，但读起来费时；Humfrey 的改法是换 Caslon 系、**一页放更少词、加大行距与页边**。
  - 号召：不要做「tiny tiny text」（开发者坐在电视旁所以不在乎）。
- **Sorcery! 的选项呈现与「move on」教训**（[gamedeveloper postmortem](https://www.gamedeveloper.com/business/postmortem-i-steve-jackson-s-sorcery-i-series-by-inkle)）：
  - 核心循环 UI 描述：「**small pieces of paper with choices as headings, with the unchosen scraps tossed aside when your chosen scrap rolls up to join the text flow.**」该循环被反复迭代「to make sure it communicated what was happening, and led your eye naturally from **choice to text back to choice** again.」
  - 「we try to write on the assumption that **people will always read the options first, and then merely skim the text above for context**」——**这直接给出一种「选项在文本之前/之上」的阅读顺序设计。**
  - 每个分支点底部若永久挂一个「Make a move」选项，会传递「上面可跳过」的错误信号；「We generally try never to have empty paragraphs in the gameflow」——即便无话可说也强迫写一句，效果很差；作者认为若重做，会把地图与移动旗标保留在剧情流中，让玩家直接移动而非用文本选项。
  - 视觉风格取舍：「we felt they were relying too heavily on the very static nature of a true gamebook - **full pages of text, for instance, which weren't very appealing to read**；and large choices rather than our model of **small, stacked options**」——并说明他们参考的其实是 parser-based IF 的「短交互、大量来回、多步动作」模型。
  - 另一个关键数据（[videogametourism 访谈](https://www.videogametourism.at/content/wordplay-text-visual-medium-interview-jon-ingold-0)）：「In Frankenstein... the pages of text were quite long. We found that **just that - having three or four paragraphs to read before the next choice came along - caused a significant tail-off in people's interest in reading.** So for Sorcery! we broke everything up into ruthlessly short chunks, and you can see the effect on people playing. **They read without meaning to.**」并说这是杂志写作的思路。
- inkle 的 UI 原则表述（[Vice 访谈](https://www.vice.com/en/article/the-makers-of-mobile-hit-80-days-on-the-importance-of-amazing-ui-852/)）：
  - 「Every screenshot should look delightful, well-balanced, and composed, **like a page from a glossy magazine**, or whatever else suits the tone of the game. It should be immediately parseable—including **knowing which bits are buttons and controls, which are displays, what's fixed, and what's variable.**」
  - 「A lot of games forget that **text is a visual medium**, and that people will look at text as an image before they read the words. **Bad typography prevents reading; and bad transitions from one screen of text to another can be confusing, or can lose a player's place in the story.**」
  - 「we work quite hard to **minimize the number of times the player is overwhelmed by choice**, and take care to **introduce each element of the UI one by one**, during the game, at the point when it's meaningful and useful」。
  - Humfrey：「**finding elements you can remove or hide** and, more intelligently, finding elements that you can **combine or coalesce**」；「establishing levels of contrast is essential: a stronger differential between shades makes elements stand out, while softer shades makes elements recede」；「giving text a larger margin will give it prominence and gravitas, as well as a sense of calm from the cleanliness of the space」。
  - 值得注意的工程副产品：他们开源了 Unity + ink 的 UI/动画框架 **inkle/SLayout**（Emily Short 线程中提及）。

### 3.2 Choice of Games / ChoiceScript：把「页」做成显式单位

- `*page_break` 官方说明（[CoG](https://www.choiceofgames.com/make-your-own-games/important-choicescript-commands-and-techniques/)）：插入一个只有「Next」按钮、无 radio 选项的界面；`*finish` 默认按钮为「Next Chapter」。**官方建议按钮标题不超过 5 个词**（「more than that looks really weird on the screen, particularly on mobile screens」）。
- 「页」的作用（[ChoiceScript wiki: page_break](https://choicescriptdev.fandom.com/wiki/Page_break)）：把长篇叙述切成两页以上以**降低「wall of text」的压迫感**，或单纯制造悬念；并给出叙事上的具体做法：**在角色死亡等重大事实揭晓之前放一个 page_break**（「Nothing ruins story suspense more than a new page of narrative loading, only to see a tell-tale "Play Again" at the very bottom」）。另建议**在每个子场景起始 label 之后立刻放 page_break**，免得在每个 goto 前都要记得放。
- 排版的社区共识（[论坛：*line_break and proper CS lineation](https://forum.choiceofgames.com/t/line-break-and-proper-cs-lineation/50213)）：读者角度「there's no indentation, the space between paragraphs is what signals it's a new paragraph」；用 `*line_break` 会看起来像格式故障；绝大多数 CoG 作品用**完整空行分段**。
- 写作单位与页面长度的经验（[论坛：Some terms questions](https://forum.choiceofgames.com/t/some-terms-questions/109478)）：「Every reader sees "pages" between choices or next buttons」；社区经验法则「**if it is below 300 words, put it in the choice; if it's above 300, make it a label**」；并提醒写作者必须**边写边在实际屏幕上阅读**，否则容易一边是 textwall、另一边是极短页的 staccato。
- 该帖还给出 ChoiceScript/长编 IF 结构的必读参考：Sam Kabo Ashwell 的 *Standard Patterns in Choice-Based Games*、Emily Short 的博客、以及 CoG 官方 *Game Design Guidelines*。（即：**选择结构的分型已有成体系的公共文献。**）

### 3.3 Twine 的四种主流 story format 与其「阅读感」

- 取舍总览（[intfiction 论坛](https://intfiction.org/t/story-format-pros-cons/45011)）：易用度 chapbook > harlowe > sugarcube > snowman；灵活度相反。Chapbook「barely lets you customize anything」，但自带名为 *backstage* 的调试与样式工具集；Snowman 几乎什么都要自己写。多数人最终落在 Harlowe 或 SugarCube；SugarCube「doesn't hit the "complexity ceiling" that you can run into with Harlowe」，且能无缝接 JavaScript。
- **Chapbook 的设计目标就是阅读体验**（[官方 guide](https://klembot.github.io/chapbook/guide/en/)）：默认就提供「a pleasure to read by players」的输出；响应式适配（不需缩放或滚动）、体积约 120K 代码、可在不懂 HTML/CSS 的情况下改外观并即时预览。
  - 具体默认观感（[markbessey 实测](https://markbessey.blog/2023/10/07/twine-part-2-hello-chapbook/)）：「formatted very much like a physical book page, with **decent margins on desktop and mobile, a header and footer line on each page, and a subtle drop-shadow box around it.** It's quite pleasant to read, whereas some of the other Twine formats are a bit more in your face.」出厂配色是**近黑灰字 / 白底 / 红链接**。
- **Chapbook 的字号-视口缩放模型**（[Font Scaling](https://klembot.github.io/chapbook/guide/en/customization/font-scaling.html)）：默认按视口宽度放大字号，**只会放大不会缩小**（避免在宽视口里出现不自然的窄列）；`config.style.fontScaling.baseViewportWidth` 默认 **1000**（此宽度以下按设定字号，以上开始放大）、`addAtDoubleWidth` 默认 **6**（视口为基准两倍宽时字号增加 6px）、可选 `maximumSize`。这是「同一套阅读排版在手机与桌面如何缩放」的一个现成可抄的模型。
- **Chapbook 的列宽**（[Page Style](https://klembot.github.io/chapbook/guide/en/customization/page-style.html)）：「On sufficiently wide web browser windows, Chapbook will add horizontal margins around the text of your story so that it's comfortable to read. **The exact width of the text column is based upon the font size**」——即栏宽定义为「字号×N」而不是固定像素。
- 七区布局（[Twine Cookbook: Chapbook](https://twinery.org/cookbook/css/storyformats/chapbook.html)）：header(left/center/right) + 主 passage 文本 + footer(left/center/right)，主内容在 `page` 元素里；这就是「页眉/页脚/正文」三带式书页布局的最小抽象。
- Harlowe 的默认对比度问题（[Christy Tucker](https://christytuckerlearning.com/harlowe-story-format-for-twine/)）：默认黑底白字 + 蓝链接，「WebAIM's color contrast checker puts it at **4.33:1**, so it fails the accessibility check for normal size text」→ 改白底黑字。这是一个「默认主题不过 AA」的现成反例。
- Harlowe 的排版建议（[intfiction: Harlowe: thinking outside the (box:)](https://intfiction.org/t/harlowe-thinking-outside-the-box/61328)）：
  - 「**The fonts in your story give it personality.**」「Variable weight fonts are the best for controlling legibility and are much smaller in file size」；**浅色字放深色底时字重极其重要**，越暗/越含蓄的字越需要加粗；必要时用 `letter-spacing` / `word-spacing` 救回「太挤或太散」的字。
  - 单位：「I recommend using **rem** for `margin`, `padding`, `font-size` and `line-height`」；`em` 会因嵌套而不可预测；`ch` 是「the width of an average character for an element's font」，「**The sweet spot for readability lies within 50 – 75 characters of width.**」——用 `ch` 定义栏宽可让改字号时换行点仍然可预测（并能防止孤字）。
  - 提示 `focus` 型个性字体适合标题/按钮但不宜做正文。

### 3.4 AI 叙事产品：文本为主的界面在 2023–2026 的形态

- **AI Dungeon**（[官方 wiki: User interface](https://ai-dungeon.fandom.com/wiki/User_interface)）：界面分左右两个隐藏菜单（左：汉堡；右：三点，含 Invite/Feedback/Quest Log/**View Adventure**/Edit adventure/Settings/Help/Refresh）。输入界面实体：World Info（长期记忆/概念定义）、Remember（一般长期记忆）、**Alter（直接改写故事正文）**、Undo/redo、**Retry（重生成最新 AI 回复）**、**Input Mode（循环切换 Do/Say/Story）**、输入框。
- **NovelAI**（[Interface Settings 文档](https://docs.novelai.net/en/text/usersettings/interface/)）：把「可读性」做成设置项——Interface Font Size 滑杆（10–24px，作用于编辑器外的一切）、Button Scale（作用于编辑器底部的 Lorebook/Undo/Redo/History/**Retry**/Send）、**[Editor V1] Input Box 开关可直接关掉编辑器底部输入框以获得更「干净」的写作/阅读体验**、Tips 开关、Editor Toolbox（选中文本时弹出：格式化、Inline Generation、**用 TTS 朗读该行**、Context Menu）、**Paragraph Visibility Range（离屏超过设定字符数就卸载文本，以省性能）**、Editor V2 与 Minibar（桌面端左侧的迷你故事列表）。另：[UI Parts 文档](https://docs.novelai.net/en/scripting/ui-parts/) 显示其扩展界面原语（单行/多行输入、文本框、存储键）。
- **流式输出的界面设计**（[Designing Streaming UIs / Brainy Papers](https://brainy.ink/paper/designing-streaming-uis)）：把流式显示拆成 7 个可测属性——time-to-first-token（**200ms 内必须有反馈**，超过 800ms 无反馈用户会认为产品坏了）、token cadence（**缓冲 30–60ms 再稳定渲染**，目标落在阅读速度 250–400wpm 附近；Claude 用渲染循环解耦网络与视觉更新）、structural commitment（列表/代码块/表格在可检测的瞬间就锁定布局，之后不再 reflow）、interrupt latency（**停止按钮必须从第一个 token 就可见、一击可达**）、edit affordance、completion design、post-stream artifact。反模式清单里包含：**auto-scroll 与用户抢夺滚动位置**（检测到手动滚动就暂停自动滚动直到用户重新锚定）、**destructive regenerate**（重生成应作为分支而不是覆盖）。
- **Friends & Fables**（[Franz 2.0 patch notes](https://fables.gg/patch-notes/franz-20-working-context-lore-improved-planning-and-more)）：**「We've added a convenient drawer right above the text input for you to quickly view and edit the working context」**——即把「AI 看到的上下文」做成输入框正上方的抽屉（Context Blocks / Plot & Plan / Scene Context 三个 tab）；Plot 每回合由 AI 重写、Plan 可查看与编辑；此前叫 Instruction/Memory/Lore 的区块支持拖拽排序与过期时间。架构上：[How Franz works](https://fables.gg/blog/how-franz-works) 说明「we might make a dozen different requests to various LLMs purpose built for certain tasks」，叙述与状态更新使用不同上下文；[与 ChatGPT/AI Dungeon/NovelAI 的对比文](https://fables.gg/blog/how-is-friends-and-fables-different-from-chatgpt-ai-dungeon-or-novelai) 强调「When you're playing a campaign, **it's not just text.** You can visually see things like where you are in the world through the mini map...」以及「在 over 不是纯文本产品时，界面需要承载规则集（D&D 5e）」。
- **Reverie「小说模式」**（[官方博文，2026-01-15](https://reverie.im/zh/blog/introducing-novel-mode)）——AI 产品里最接近「纯文本互动小说」的一次明确表述，逐条摘录：
  - 用户输入指令（如「你走进废弃的城堡」），AI **不以聊天消息回复，而是写出散文**（数段描写）。
  - 界面：**「散文填满屏幕。没有聊天气泡，没有 UI 杂乱——只有自然流动的文字，格式像书页一样。更大的字体和舒适的间距让长时间阅读成为享受而非负担。」**
  - **玩家输入的区分方式**：「当你的指令出现在叙事中时，**一种柔和的视觉处理标记它**——你可以看到你提供了什么，AI 扩展了什么。**区分清晰但不打断阅读流程。**」
  - 操作栏：**「默认保持最简。一次点击继续故事。需要时撤销。只有当你想要时才展开更多选项。界面消失，故事显现。」**
  - 翻页：**「一切连续滚动，像无尽小说中累积的章节。没有分页打断流程。」**
  - 输入语义被分为四类（动作/对白/直接叙述/请求描写），每类触发不同的扩写方式。
- 其他相关工程案例：**Yumina 文档**（[自定义 UI 指南](https://docs.yumina.io/zh/creator/advanced/custom-ui-deep)）给出「消息样子」预设中含**「小说排版」**（与平台默认/默认气泡/信纸/终端并列），并说明「消息样子」接管气泡渲染、其余（滚动、流式输出、swipe、输入）交给平台；**GWC**（[GitHub](https://github.com/QiuSui1145/GWC)）是一个 React 19 + Vite + Tailwind 的网页端「全沉浸式视觉小说风格 AI 聊天」，从零构建标题画面/对话框/存档/BGM 播放器/快捷栏，双击空白处进入沉浸模式，并有「快模式打字机」（加速）与移动端 UI 模式。

### 3.5 侧栏书卷式 / 混合式高密度文学文本流

- **Disco Elysium**：
  - 文本框位置与形状的原始决策（[80.lv 转述 Kurvitz 的 Gamespot Audio Logs](https://80.lv/articles/disco-elysium-working-on-ui-design)；[GameRant 转述](https://gamermatters.com/disco-elysiums-text-box-design-is-inspired-by-how-we-use-computers-and-twitter/)）：
    - 不放在画面下 1/3（CRPG 惯例，Kurvitz 认为那来自电影字幕的位置），而是**近右下、竖向排列**；参照 **Harebrained Schemes 的 Shadowrun Returns** 已用过此布局。
    - 理由：「If you're using a computer, [the bottom right side of the screen] is where you look 60 percent of the time. ... This is where your clock is. Where your tray is. Where your messages are.」
    - **Twitter 是竞争对手**：「As a writer, you want to write snappy, fast, evolving text. ... And Twitter does it very well.」文本框是一个**向上滚动的列**，「We want to build a dialogue engine that as addictive and as snappy as Twitter」。
  - 另一份转述（[reading.supply](https://reading.supply/@pageofswrds/kurvitzs-design-direction-G6dMF3)）把理由补得更完整：「The dialogue is column-shaped because **text is best presented as a column** — newspapers, Twitter, all of the systems that have actually figured out how to hold attention with text. The text tumbles up. You can scroll back. **Each line is short.**」
  - 说话人可辨识性的实证：一份学术复刻项目在复现 DE 对话引擎时，被试者明确的缺失反馈之一就是「the actual Disco Elysium game provides **visual cues**... We address this concern by tweaking our interface to better match the one from the game, including **highlighting actor names using the same colors from the game**」（[EMNLP 2023 论文 PDF](https://dojoteef.com/papers/discoelysium_emnlp_2023.pdf)）。→ **「说话人名配色」是被实验证明影响可跟随性的要素。**
  - 最坏情况的排版设计（[redlamp：Disco Elysium Final Cut 的 UI 负责人自述](https://redlamp.org/work/disco-elysium/)）：
    - 「We couldn't support **a dynamic text size slider**, but we did implement **three preset display modes: Monitor, TV, and Handheld**. Each mode had its own font sizes, layout rules, and visual adjustments.」
    - 「I also built a spreadsheet tool to **calculate font sizes as degrees of the player's field of vision**, to support decision-making across platforms.」
    - 原型覆盖的组合：「short and long entries, along with **varying response list lengths**」，并把「a long entry against a full response list」明确标为**最坏情况**，先做原型再实施；「Entry and response sized against each other, so neither crowds the other out」。
- **Citizen Sleeper**（作者 Gareth Damian Martin 在 Bluesky 的公开说明，[存档](https://couchsky.app/u/jumpovertheage.com/p/3ms6pxh3wl22s)）：
  - 「people so often compare the Citizen Sleeper UI layout to Disco but **the game's presentation of text was equally inspired by the elegant Destiny 2 conversation panel**」。
  - 「I actually started with a version inspired by the Destiny UI, and then as I ended up **using the same dialogue system asset as Disco**, tuned it to be natural for RPG players, with **the use of a CONTINUE button to keep player attention with regular clicks** being one of the notable features」。
  - 「my first game **In Other Waters**, also presented **prose text vertically (and dialogue horizontally)** kind of hybridising the two approaches」。
  - 另一条回复指出「the Shadowrun games were already doing this sort of vertical dialog UI back in 2013」；作者补充「In the 80s it was very common to have **all the dialog vertically on the side**」，并认为「its main innovation was the fact that it **openly borrowed from the Twitter interface - scrolling through dynamic short texts vs reading fixed dialogue boxes**」。
  - 玩家观察：**「CS1-2's displaying the name and tag on the side of the text window is easily my favorite of these styles」**。
  - 界面结构（[Oreate 的分析文](https://findings.oreate.ai/hub/how-the-art-of-citizen-sleeper-redefines-the-cyberpunk-aesthetic)）：**letterbox 取景**——「the screen is often divided into distinct sectors. The central view shows the 3D station, while the sidebars handle the technical data」；「a 'minimum amount of detail' strategy」。
  - 本地化对界面排版的硬约束（[点与思考访谈](https://www.pointnthink.fr/en/interview-gareth-damian-martin-2/)）：「Localization... involves translating around 180,000 words」；「The challenges extend to the game's user interface, where maintaining integrity is paramount. Translation into different languages often involves **using different fonts and taking into account varying text lengths. French, for example, tends to be longer than English, which poses problems for fitting text into predefined spaces in the user interface, particularly on platforms like the Switch.**」
- **Roadwarden**（开发者 devlog，[itch](https://assemble-entertainment.itch.io/roadwarden/devlog/133874/taking-a-fresh-look-roadwarden-devlog) 与 [后续](https://assemble-entertainment.itch.io/roadwarden/devlog/207234/improving-the-basics-roadwarden-devlog)、[更早](https://assemble-entertainment.itch.io/roadwarden/devlog/113863/the-new-chapter-about-steam-demo-and-others-roadwarden-devlog)）：
  - **叙事与选项原本只用两种颜色区分**，后来被迫加一条水平分隔线：「For me, it was always clear which text was which since they are in two different colors. However I've received a lot of opinions from very different people who barely see any difference between them. One of those people has helped me realize that **their color blindness is playing a significant role**」。→ **颜色单独承担区分职责是已证实的可用性风险。**
  - 「Text scrolling was enabled」：原本刻意禁止滚动以保持「elegant」，后认识到会失控、甚至让内容变得更无聊；最终只有约 1% 的文本框需要滚动条，不需要时不显示。
  - 通知位置从屏幕边缘移到**画面中央**，理由：「they appear too far away from the most relevant part of the screen - **the text section**」；并让通知停留时间分级（快速存档提示更短）。
  - 字体迭代：「I believe that the previous one has covered too much space, yet it also had letters that were too thin to comfortably read them. ... **It's always tough to sacrifice appealing visuals for the sake of readability**, but it's very important to make a text-based game as gentle to one's eyes as possible.」
  - 有 Archive（对话/叙述文本日志，可滚动回溯，容量上限「a couple of dozens of dialogue/narration chunks at once」）与 Journal（角色记录的人物/地点/本地知识 + 通用知识 + glossary）两套查阅系统，且**地图/日志/日记可在对话中途随时打开**（[第三方设计分析](https://jay.mcgavren.com/2023/02/22/roadwarden-game-design-analysis.html) 特别点出这一点的重要性）。
  - 后期追加：Trading 从「跳一堆对话选项」改为「核心文本旁边就是便捷按钮」；角色卡（character sheet）解释规则；地图 key 图标化；对话中默认不再把「distanced」态度高亮为默认项；**高亮 Trade/Rest/Travel 按钮以表明玩家没有被困在对话中**（[Growing and Evolving](https://moralanxietystudio.medium.com/growing-and-evolving-roadwarden-devlog-f35a80b268e6)）；选择中有随机要素时加 **d6 图标**。
- **Fallen London / Failbetter**（storylet 卡片式）：
  - 2012 年的 Story Page 改版（[官方公告](https://www.failbettergames.com/news/redesigning-the-story-page)）：quality 需求改用小图标（因为 story 复杂度上升后玩家记不住想要什么）；**去掉 storylet 方框上的渐变，理由是「should make them easier to read」**；「Echo Bazaar takes place largely in the imagination of the player, **so we don't want anything interrupting that line of communication**」；storylet 图标变小以便一页放更多。
  - 玩家反馈的取舍（[论坛](https://community.failbettergames.com/t/storylets-redesign/9282?page=2)）：有玩家强烈反对用图标替代文字——「Even though it seems intuitive that seeing pictures is easier than reading a block of text, **the text is much better at immersion for me. It's like a book, compared to, well, computer icons.**」；有玩家抱怨 hover 才显示关键信息在移动端不可用；有玩家抱怨「24 个 storylet... 用迷你图标后我几乎找不到想要的那个」。官方回应：不正式支持移动端，但会尽量适配；锁定按钮的文字说明改动涉及可访问性与其它连带问题，仍在讨论。→ **图标化是「可扫读性」与「沉浸/可读」之间的真实张力。**
  - storylet 的边框颜色分级（[Fallen London Wiki: Storylets](https://fallenlondon.wiki/wiki/Storylets)）：白=普通、铜=稍特殊、银=相当特殊（Ambition/季节）、金=一次性的例外事件、紫、黑、Living Green/Bloodied Green 与世界质量联动、Deeper Blue=新手引导、Snowy=圣诞。移动端从「手牌下方的主内容区」改为 **"Always" 标签**。
- **高密度文本流的两份「UI 标准 vs 打破标准」分析**（[towardstheendsky: UI Design](https://forums.fuwanovel.moe/blogs/entry/4226-ui-design-%E2%80%93-an-anatomy-of-visual-novels/)）：
  - ADV 的标准（以 Yuzusoft《サノバウィッチ》为例）：文本框约占画面下部 1/8、半透明，颜色与透明度用于「文字清晰可读 + 不完全遮挡背景与立绘」；底部一排极小的按钮（读档/存档/各类跳过/设置），可以隐藏以去除杂乱；**说话人名字在主文本之上、与文本左边对齐**；**文字不填满整个框，约留 1/3 空白**，使文本在任何台词长度下都占据大致相同的空间、避免紊乱。整体目标是「as easy to ignore as possible」。
  - **NVL 的标准做法：「a common trend in NVL titles is to have no UI buttons on the interface at all and instead require the player to open an entirely separate pause menu」**——理由是 NVL 文本占据屏幕更大比例，需要避免用 UI 把玩家拉出体验；「those with them try to frame them within the aesthetics of the narrative」。
  - 打破标准的例子（Girlfriend Simulator 式框式 UI）：大而明显的按钮占据左侧、界面本身就是叙事的一部分、左上有一个随选择上升的「unease meter」。

---

## 4. 关键 UI/UX 要素拆解

### 4.1 连续文本流的四种形态

| 形态 | 代表实现 | 机制事实 |
| --- | --- | --- |
| **单段聚焦（逐句替换/追加后保留）** | 传统 NVL | Ren'Py：`nvl` 角色连续 say 会不断追加到 `nvl_list`；必须 `nvl clear` 才清屏（[docs](https://www.renpy.org/doc/html/nvl_mode.html)） |
| **整页翻页** | Chunsoft 系、Ren'Py `nvl clear`、Naninovel `@resetText`、RouteVN `Clear Page` | Naninovel：fullscreen printer 默认**不会在每次 print 时重置文本**，要清屏需 `@resetText`，或打开 actor 配置里的 `Auto Reset`；且每次 print 默认**在前方插入两个换行**（`Auto Line Break` 可设为 0）（[Naninovel](https://naninovel.com/guide/text-printers.html)）。RouteVN：`Clear Page` **只在 NVL 模式可用**，作用为「clears all previous messages from the NVL page」（[RouteVN](https://routevn.com/en/creator/docs/line-actions/dialogue/)） |
| **连续追加 + 滚动** | Monogatari、Narraleaf、Reverie、Twine 类 | Monogatari NVL：「Dialogs are appended rather than replaced」「The text area is scrollable」「The `unread` class indicates when new content is below the visible area」，并给出 `text-box.unread::after { content: '▼' }` 的未读指示写法（[Monogatari Text-Box](https://monogatari.io/v2/components/text-box)） |
| **无限滚动窗口（固定高度内滚动）** | Ren'Py `config.nvl_list_length` | 官方描述：「If not None, the maximum length of the list of NVL dialogue. **This can be set (often in conjunction with forcing the dialogue to have a fixed height) in order to emulate an infinite scrolling NVL window.**」（[docs](https://www.renpy.org/doc/html/nvl_mode.html)）。社区文章进一步给出「超出上限时最旧的条目会被移除」的默认 GUI 行为：`define gui.nvl_list_length = 6`（[rect.page](https://rect.page/en/p/2026/05-13-making-chat-ui-with-renpy-nvl-mode/)） |

### 4.2 打字机 / 逐字推进：可调参数与既有取值

- **Ren'Py 文本标签族**（[Text 文档](https://renpy.org/doc/html/text.html)）：`{cps}`（设置该段显示速度，参数以 `*` 开头则作为当前速度的倍率）、`{w}`（自闭合，等待点击；给参数则 N 秒后自动结束等待）、`{p}`（段末暂停，语义同上但段落收束）、`{nw}`（本行显示完自动消失）、`{fast}`（在其之前的所有文本立即显示，即使处于慢速模式；并会**从前一行继承语音的持续**）、`{done}`（之后文本不显示，用于 `adjust_spacing` 时避免跳动；**带 done 的行不会加入 history buffer**）。
  - 慢速文本的渲染注意事项（同页）：「Ren'Py will render the text to a texture, and then draw rectangles from the texture to the screen... it's possible to get **rendering artifacts when characters overlap**. To minimize... ensure the `line_leading` and `line_spacing` properties are large enough that lines do not overlap」→ **慢速逐字与行距设置存在工程耦合。**
- **偏好项**（[Preferences](https://renpy.org/dev-doc/html/preferences.html)）：`preferences.text_cps`（**默认 40 cps**，0 为无限）、`afm_time`（默认 15，越大越慢，且**换算到墙钟时间时会把行长纳入计算**）、`afm_after_click`、`afm_enable`、`voice_sustain`、`wait_voice`、`voice_after_game_menu`。
- **Auto-forward 的语音协同**（[Config](https://www.renpy.org/doc/html/config.html)）：`config.afm_voice_delay = .5`（语音文件播完后 0.5 秒才允许推进）、`config.afm_characters = 250`（导致延迟生效所需的字符串长度）、`config.afm_callback`（默认在语音播放中禁用自动推进，除非 `preferences.wait_voice` 为 False）。
- **Naninovel**：`Default Base Reveal Speed 0.5`、`Max Reveal Delay 0.06`（定义可用范围，值越大显示越慢）、`Max Auto Wait Delay 0.02`、`Scale Auto Wait`（自动等待时间是否按 print 命令的 reveal 速度缩放）、`Skip Print Delay`（跳过播放时人为放慢）（[Configuration](https://naninovel.com/guide/configuration)）。实现层：`Revealable Text` 组件包装 TMPro，多数内置 printer 还带 **`Reveal Fader`（对已揭示字符附加渐变式不透明淡入）**（[Text Printers](https://naninovel.com/guide/text-printers.html)）。
- **Monogatari**：四类独立开关——`TypeAnimation`、`NVLTypeAnimation`、`CenteredTypeAnimation`、`NarratorTypeAnimation`，以及 `TextSpeed` **默认 20**（越低越快），玩家可在设置里调（[Dialogs](https://monogatari.io/v2/script-actions/dialogs)、[DeepWiki](https://deepwiki.com/Monogatari/Monogatari/3.3-text-box-and-dialog)）。→ **「打字机」按显示模式（ADV/NVL/居中/旁白）分别可关，是一个现成的粒度设计。**
- **WebGAL**：逐字动画有 `start` / `Settled` 两个状态类，模板可分别给样式；行高来自 `WEBGAL.config.lineHeight`（`em`），否则 textSize=medium 用 `2.2em`、其它用 `2em`（[文本框模板参考](https://docs.openwebgal.com/template-reference/ui/textbox.html)）。
- **《うみねこ》PS3 版**：见 §2.5——**逐字出现速率非恒定（标点后停顿）、逐字淡入帧数可调、用户设置可被脚本覆盖**。
- **Web 端无障碍**：MDN 定义 `prefers-reduced-motion` 语义与各平台开启路径（[MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)）；web.dev 给出正反两版写法（`@media (prefers-reduced-motion: reduce) { animation: none }` 与 `no-preference` 分支），并给出「一刀切压制所有动画」的 CSS 覆盖法及其局限（无法停止 Web Animations API）（[web.dev](https://web.dev/articles/prefers-reduced-motion)）；组件层实践：「The typewriter respects `prefers-reduced-motion`: **the full text appears instantly with no character-by-character animation, and the caret does not blink. Screen readers always read the full text, even while it types.**」（[Motion Components](https://www.motion-components.dev/docs/recipes/typewriter-hero/)、[Quiet UI](https://next.quietui.org/docs/components/typewriter)、[use-typewriter-animation](https://registry.npmjs.org/use-typewriter-animation)）。GSAP 范式则用 `gsap.matchMedia()` 在 `reduce` 分支直接写入完整文案并把原文作为 no-JS fallback、`aria-label` 也设为全文（[GSAP Vault](https://gsapvault.com/effects/typewriter-text)）。

### 4.3 回看（Backlog）/ 既读管理 / 回滚：机制与既有取值

- **Ren'Py 对话历史**（[Dialogue History](https://nightly.renpy.org/doc/history.html)）：`config.history_length` 控制上限（默认 GUI 设为 **250**），为 None 则完全不记录；`_history_list` 为 `HistoryEntry` 列表；`HistoryEntry.kind` 在显示中为 `"current"`，之后变为 `"adv"` 或 `"nvl"`（**历史项自带模式标记**）；`HistoryEntry` 保存 `_get_voice_info()` 的语音信息与一个可传给 `RollbackToIdentifier()` 的标识符（仅当该位置仍在 script log 中时才可用）；可通过 `config.history_callbacks` 追加字段。另有 `config.history_current_dialogue`（当前行是否入 history）。
- **NVL 的分页回滚**：`config.nvl_paged_rollback`（True 时回滚以**整页**为单位，而非一次一个文本块）（[nvl_mode](https://www.renpy.org/doc/html/nvl_mode.html)）。
- **KAG/吉里吉里 的未读/既读**（[KAG 3 文档：未読/既読処理](https://krkrz.github.io/krkr2doc/kag3doc/contents/ReadUnread.html)）：
  - 记录在 `trail_` 前缀的系统变量（如 `first.ks` 的 `*start` → `sf.trail_first_start`），需 `Config.tjs` 的 `autoRecordPageShowing = true`。
  - **以 label 为分段单位**：一个 label 到下一个 label（或 `[s]` 标签）为一个「部分」；中途退出不算既读，必须读到部分末尾。
  - 分支跳转的既读判定细节：`link`/`button` 跳转**自动视为既读**（可用 `contpage=false` 关闭）；`jump` 同理；`call` 不算既读（`coutpage=true` 可改为算）；`return` 处算既读。
  - 用途：**未读/已读可以改变消息显示速度、在既读部分禁用 `[l]` 等待**。
- **TyranoScript V4**（[开发者发布笔记](https://shikemokumk.hateblo.jp/entry/2015/12/03/130314)）：既读管理为标配，前提同样是 `autoRecordPageShowing = true`；`[config_record_label skip=false]` 禁止跳过未读（跳过中遇到未读会停止）；**`[config_record_label color="0x4444FF"]` 可改变已读文章的颜色**；记忆以 label 为单位。默认 config 画面提供 BGM/SE 音量、**文字速度、オート速度、未读跳过 ON/OFF**。自动模式：`[autostart]`/`[autostop]`/`[autoconfig speed=200 clickstop=true]`；`button` 的 `role` 可指定 `auto` 以便在消息框常驻自动切换按钮。
- **novelsphere Simple UI**（[ref_o2ui](https://developer.novelsphere.jp/doc/o2doc2/content/ref_o2ui.html)）：`automode`/`skipmode`/`save`/`load`/`config`/`backtotitle` 各有 true/false；`slot` 1–28；**`chspeed_min/max` 与 `automode_min/max`** 为设置画面可调范围（毫秒）——即「文字速度」与「自动速度」都被设计成**带上下限的滑杆**。
- **RPG Maker MZ 的 NovelGameUI**（[GitHub](https://github.com/nz-prism/RPG-Maker-MZ/tree/master/NovelGameUI)）：标准按钮集为 选项/存档/读档/日志/跳过/自动/UI 隐藏/退出；日志可配「保存上限」（0=不自动清除，但会增大存档体积）、「显示中消息是否从日志排除」、可用插件命令手动写入日志（用于把图片形式的消息也纳入日志）；跳过用「label 三明治」（起点 label 名 N、终点 label 名 N+1），**label 名重复会导致未读被误判为已读**（建议全程只用一次）；`既読のみスキップ可能` 选项可以关掉以允许跳过未读；按钮图像可分「跳过可/跳过不可」两态，**以视觉表现当前是否可跳过**；自动模式同样有 ON/OFF 两态图像。
- **Ren'Py ctc（click-to-continue）**（[Dialogue 文档](https://www.renpy.org/doc/html/dialogue.html)、[special screens](https://www.renpy.org/dev-doc/html/screen_special.html)）：`ctc`、`ctc_pause`（被 `{p}`/`{w}` 暂停时用的指示）、`ctc_timedpause`（被 `{p=}`/`{w=}` 暂停时用）、`ctc_position`；默认 GUI 的 `ctc` screen 是右下角的图标 + "Click to Continue" 小字（`size 12`）。NVL 另有 `config.nvl_page_ctc`（页末指示）与 `config.nvl_page_ctc_position`（默认 `"nestled"`）。
- **日式惯例的整合陈述**（[Zenn：ノベル部分に欲しい最低限の機能まとめ](https://zenn.dev/noranuko13/articles/6727f35ea38c17)，2025）：
  - **既读跳过是「最重要功能」**；反面案例包括：影片前后或剧情分隔点被中断、立绘/背景切换动画与语音照常播放、「突然跳到下一场景」（瞬间移动会让人读不懂剧情，建议默认高速再生、由玩家可选瞬间移动）、**照搬同一剧本的其它路线的完全相同的场景却无法跳过**。
  - 自动：至少应能分别调整**文字显示速度**与**到下一句的间隔**（「遅いならまだしも、早いと結局使えません」）；跳过与自动应能并用；不要在未读区自动停止后不恢复跳过。
  - 日志（Backlog）：有语音时**每行日志带重播按钮**、可反复听；对推理/ADV 查线索很方便；手游若无相册功能则日志是唯一补救手段。
- **月姫リメイク**的具体功能集与玩家批评见 §2.4（快捷存档/读取、直前语音重播、既读自动跳过到选项、但缺「到下一选项为止跳过」、backlog 不能重播语音）。

### 4.4 Say / Narrate / Thought / Player Input 的排版区分（本调研最核心的一节）

#### 4.4.1 日式：名字显示的三条路线与既有做法

- **三条路线**（[arai 画面構造2](https://arai-novelgamelabo.com/entry/2024/10/28/170000)）：① 名字放进消息窗内；② 另设名字窗口（ネームウィンドウ）；③ 两者都不是——例举 **《ATRI》是「メッセージウィンドウの上に名前ウィンドウなしにキャラクター名が表示されている」**；此外还有「根本不显示角色名」的选项。
- 名窗的实测注意点（同页）：**多语言展开时名字长度可能大幅超出**——「日本語では枠内に収まっていたのに、他の言語だとはみ出してしまう」；作者为此让程序在名字较长时切换成更横长的窗口。
- **「名字放进同一文本层」的经典实现**：在吉里吉里/TyranoScript 的宏里用条件判断按说话人改字色并写入 `【かぐ子】` 这类带括弧的名字，再接台词；另一种是把名字单独放在 `message1` 层当名牌（[kopacurve 博客，TyranoScript 宏范例](https://kopacurve.blog.fc2.com/blog-entry-206.html)）。该文同时示范了**「地の文用」另开一层并改字体颜色、把名字层设为不可见**的宏写法——即「旁白 = 换层 + 换色 + 不显示名牌」。
- **Ren'Py 默认 NVL 的角色名位置**（[ja.renpy nvl_mode](https://ja.renpy.org/doc/html/nvl_mode.html)）：「既定の状態では**キャラクター名が左側で、台詞がキャラクター名の右側にインデントされて**配置されています。名前の色は「color」パラメーターで設定できます。」官方进一步给出三档定制（[英文页](https://www.renpy.org/doc/html/nvl_mode.html)）：① 名牌 + 右缩进台词；② 名字写进文本流（`what_prefix="Sylvie: \""`，`what_suffix="\""`）；③ 完全去掉名字、只把台词放进引号（并警告第 3 种「誰が話した言葉なのかを見分けるのが難しくなる」），此时可用 `what_color` 给台词上色。
- **样式层的三分**（Ren'Py 源码 [00nvl_mode.rpy](https://github.com/renpy/renpy/blob/master/renpy/common/00nvl_mode.rpy)）：
  `style.create('nvl_window', ...)` / `nvl_vbox` / **`nvl_label`（名字）** / **`nvl_dialogue`（台词）** / **`nvl_thought`（内心，继承 nvl_dialogue）** / `nvl_entry`（每行对话的 window）；默认角色 `nvl = NVLCharacter(who_style='nvl_label', what_style='nvl_dialogue', window_style='nvl_entry', kind=adv)`，而 **`nvl_narrator = NVLCharacter(who_style='nvl_label', what_style='nvl_thought', ...)`**——**官方把「旁白/内心」直接映射到 `nvl_thought` 样式上**。
- **用独立 Character 承载内心独白是社区标准做法**（Lemma Soft 多帖）：常见组合是「角色说 → 有名字、正常色；该角色想 → 无名字或名字为空、另一颜色；NVL 版内心 → 同色无名字」；[Ren'Py 思考气泡帖](https://lemmasoft.renai.us/forums/viewtopic.php?t=64438) 讨论了「斜体不够强」的问题（某些字体斜体与正体几乎无差别），并给出用 `ConditionSwitch` 在 say screen 的 `style window` 里按变量切换文本框贴图（普通框 / 思考气泡框）的具体代码；另一做法是定义 `mct = Character("", show_thoughtbubble=True)`，让 `show_` 前缀的关键字参数透传给画面。
- 同一批帖子中实际被采用的区分手段清单（[Text styles and quotations in VNs?](https://lemmasoft.renai.us/forums/viewtopic.php?t=22919)、[thoughts/narration 展示方式帖](https://lemmasoft.renai.us/forums/viewtopic.php?t=36954)）：
  - 台词用引号、思考不用引号（或反之）；
  - 思考常用括号包裹；
  - 内心独白用斜体（有时前后加句点或省略号）；
  - 不同颜色（并常与斜体叠加）；
  - **去掉名牌而保留同一文本框位置**（作者理由：文本框位置不变则不用额外排版，且不会分散注意）；
  - 名声层 / 文本框换成思考气泡外形 / 用不同的文本框贴图 / 用灰色、低饱和度的字色；
  - 极端做法：**思考用白字黑底**（恐怖语境）；或把「旁白」做成上方字幕式（script 风字体 + 描边）、把内心放在下方常规文本框但灰化、斜体、略小。
  - 一位作者的实践总结：「I use white font for when he/she is speaking, and a gray italicized font to portray their thoughts, usually with periods before and after」；另一位：「I generally use all italics with the character's name for internal monologues, and then a separate "narration" text box without a character's name and in italics」。
  - 也有坚定的反引号派：「I, personally, HATE quotations in character dialogue. I can tell that someone is speaking; their portrait is on screen, and their name is above the text.」→ **引号不是必需项，名牌/立绘已提供说话人信息。**
- **VNDev Wiki 的三分定义**（[Writing](https://www.vndevwiki.org/Writing)）：narration（描述场景：时间地点、角色动作、氛围、视觉未传达的物理细节）/ dialogue（角色说出的言语，**通常以短句连续呈现，每句绑定角色名或头像**）/ internal monologue（角色私密想法，未说出口；用于主观反应、判断、内心冲突；可以「制造说出口与未说出口意图之间的对比」）。
- **日本的「地の文 vs 台詞」字体分工**：Triangle 的做法被记为「**地の文をゴシック体で表示し台詞部分を明朝体**」（[cactus](http://cactus4554.blogspot.com/2011/10/blog-post_7377.html)）；Littlewitch 则按说话者或感情切换各种字体。→ **用「字体族」而非「颜色」来切分叙述与台词，是有先例的。**

#### 4.4.2 西方 / Web：样式语义与既有反例

- 斜体 = 内心/强调、粗体 = 当下的关键信息与喊叫、颜色 = 角色身份（Muv-Luv 每角色一色；Disco Elysium 用角色名配色），见 §2.6 与 §3.5。
- **符号替代文字**：Berserker 的咆哮用块状符号（同 §2.6）。
- **工程侧的「效果语法」清单**（Monogatari 的 Visual Effects，[Dialogs](https://monogatari.io/v2/script-actions/dialogs)）给出了一整套即用型文本效果，可作为「纯文本模式需要多少种文字样式」的现实清单：
  `{bold} {italic} {big} {small} {strike} {redacted}（遮挡/审查样式） {invisible-ink}（悬停才显现） {handwriting}`，以及情绪/质感类 `{angry} {scared} {happy} {sad} {mysterious} {excited} {whisper} {shout} {dizzy} {dreamy} {robotic} {static} {rainbow} {glow} {impact}`。
  另：Monogatari 的 dialog 语法支持在文本后附加任意自定义 CSS class（`'y:happy:highlight Hello!'`、`'narrator::thought A quiet thought'`、`'centered::dramatic A revelation!'`），且 **class 每次对话都会重置**。
- WebGAL 的「文本拓展语法」：`[文本](ruby=...)` 注音、`[文本](style=...标准 CSS 行内语法)` 任意样式、以及计划中的提示/交互（[开发日志 5](https://www.openwebgal.com/zh-cn/blog/dev-note-5/)）。→ **Web 引擎可以直接用 CSS 作为「文本样式语言」。**
- **剧本格式可借用的语法**（[Screenplay 标准格式](https://www.simplyscripts.com/WR_format.html)、[Ensemble 指南](https://ensemblewriter.com/docs/screenplay-format)、[Oscars 示例 PDF](https://www.oscars.org/sites/oscars/files/scriptsample.pdf)）：动作/叙述=齐左满宽、句首大小写；角色提示=全大写、缩进约 3.7″、紧贴台词上方；台词=左右各缩进约 2.5″、居中窄列；括号提示=小写、括起、在角色提示与台词之间（现被建议尽量少用）；过渡=全大写、右对齐；(V.O.) 等后缀=在角色名后括起。→ 这是「叙述 / 说话人 / 台词 / 内心（V.O.）」四层被工业化固定下来的**排版语法先例**。
- **Doc-style NVL 行的默认形式**（Narraleaf 的 `DefaultNvlDialogItem`）：**「the speaker's name followed by a colon, then the line」**（[文档](https://www.narraleaf.com/docs/narraleaf-react/player/nvl-container)）——即「名字：文本」这一最简悬挂形式是引擎默认值。

### 4.5 选项（Choices）与自由输入（Free input）

#### 4.5.1 选项呈现位置：三种已成立的做法

| 位置 | 代表 | 事实 |
| --- | --- | --- |
| **文末流式展开（紧跟正文之后）** | Ren'Py NVL 菜单、ChoiceScript、Monogatari、RouteVN | Ren'Py：「There is also an alternate **NVL-mode menu presentation, which displays the menus immediately after the current page of NVL-mode text**」「The menu will disappear after the choice has been made, so it usually makes sense to follow menus with an "nvl clear" or some sort of indication as to the choice」，并可用 `nvl=True` 参数在单处调用（[docs](https://www.renpy.org/doc/html/nvl_mode.html)）。ChoiceScript：页 = 选择之间的单位，选择在页末。 |
| **固定栏 / 悬浮（与正文分离）** | ADV 传统 | 见 §1.3 与 §3.5 的 ADV 标准 |
| **选项置于文本之上（作为分节标题）** | inkle | 「small pieces of paper with choices as headings」+ 作者假设「**people will always read the options first, and then merely skim the text above for context**」；choices 最后才缓缓淡入（[postmortem](https://www.gamedeveloper.com/business/postmortem-i-steve-jackson-s-sorcery-i-series-by-inkle)、[Emily Short 线程](https://threadreaderapp.com/thread/986670130347364352.html)） |

#### 4.5.2 不可选 / 条件未满足项的呈现

- 月姫リメイク：「選択肢の中には、**表示されているのに選べない項目**が含まれることがある。ゲームの進行度や好感度、これまでの分岐など、何かしらの条件を満たすことで選べるようになる」（[Famitsu](https://www.famitsu.com/news/202108/26231377.html)）。
- Fallen London 的官方讨论（[论坛](https://community.failbettergames.com/t/storylets-redesign/9282?page=2)）：「It should be greyed out, but **the grey may be a bit too subtle**. We're discussing whether to change the **text caption for locked buttons** (which would be better accessibility too, but it opens some other worm cans)」。
- WebGAL 的模板里明确有 `Choose_item_disabled` 这一类名，用于「条件未满足、不可点击的选项」（[applyStyle 文档](https://docs.openwebgal.com/script-reference/commands/applyStyle.html)）。
- ChoiceScript 的 `*page_break` 与 `*finish` 按钮文案可用参数自定义，但**建议 ≤5 词**（[CoG](https://www.choiceofgames.com/make-your-own-games/important-choicescript-commands-and-techniques/)）。

#### 4.5.3 自由输入（Free input）与「输入回显」

- **AI 叙事侧的三种输入模型**：
  - AI Dungeon：Do / Say / Story 三模式循环 + 输入框 + Retry/Undo/Alter（§3.4）。
  - Friends & Fables：输入框 + 上方 Working Context 抽屉；玩家消息进 chat history，Plot/Plan 每回合重写（§3.4）。
  - Reverie 小说模式：输入被显式分为四类语义（动作/对白/叙述/请求描写），**玩家输入以「柔和的视觉处理」与 AI 生成的散文区分但不打断阅读**（§3.4）。→ **「玩家输入回显」在纯文本流中的处理被明确做成「柔和标记」而非「气泡」。**
- **parser IF 的提示符传统**（[IFWiki: Infocom-type parser](https://www.ifwiki.org/Infocom-type_parser)、[TADS Parser: The Parsing Sequence](https://www.tads.org/t2doc/doc/prsseq.htm)）：
  - 默认提示符是 `>`；它在**每一回合开始时由解析器自动打印**，等待玩家输入一行。
  - TADS 把提示符做成可按「输入类型」分派的钩子 `commandPrompt(typ)`：0 普通命令、1 未知词（可能要 oops）、2 对象歧义消解、3 缺直接宾语、4 缺间接宾语；并在读取后调用 `commandAfterRead(typ)` 以撤销在提示符里设置的文本效果。示例代码演示了「前 5 回合用长提示、之后改短」「解析器反问时不打印长提示（只打印 `>`）」。
  - 社区讨论给出的设计洞见（[intfiction: Promises that parsers can keep](https://intfiction.org/t/promises-that-parsers-can-keep/1197)）：把 `>` 换成「You decide to ...」这类**未完成句式**而非极简 `>`，能让玩家对自己该输入什么（词性、形式）形成强预期；并指出「解析器反问时不应该再打印自己的提示符，反问本身就该当作提示符」。同帖还提到一个长期提案：让解释器**不回显玩家按下的回车**，以便把多个提示与文本拼成同一个段落。
  - Inform 的提示符是个可替换的库消息（默认 `"^>"`）：可设成「What should you, the detective, do next?」再逐步缩短（[intfiction 帖子](https://intfiction.org/t/set-the-player-input/62150)）。
- **Roadwarden 的文本 parser**：接受大写字母，属于「简单命令」，出现在互动场景中而非作为全局输入（[devlog](https://assemble-entertainment.itch.io/roadwarden/devlog/207234/improving-the-basics-roadwarden-devlog)）。
- 需要注意的反面意见（原帖）：有人明确反对「鼓励玩家输入会被忽略的词语」（[intfiction](https://intfiction.org/t/promises-that-parsers-can-keep/1197)）。

### 4.6 有图 / 无图两种状态的兼容做法

#### 4.6.1 「无图」时的底色与配色

- **黑白底之争的实测**（[テイビのノベルゲーム制作日記](http://blog.livedoor.jp/tales_vivid/archives/30425162.html)）：一次推特投票结果「白地に黒文字 13 票、黒地に白文字 21 票、どちらも同じ 9 票くらい」；作者本人因**散光**觉得黑底白字「ちらつく／チカチカする」难以阅读，并查到「乱視の人は黒地に白文字は読みづらい傾向がある」。
- **字体与底色组合**（同页）：「黒地に白文字にしたら、明朝体は絶望的に読みづらかった」；ゴシック 25 票 vs 明朝 12 票；推测屏幕文字因像素锯齿而闪烁，明体的细线（はらい）更容易看起来发抖，印刷平滑所以没这个问题；并提到纸书的白并非纯白（偏黄、略暗）。结论（原话）：「結局は、万人に読みやすいフォントやルールはないのかもしれない。」
- **实施例：全屏小说型的具体排版参数**（[ぼっちのゲ制③](https://note.com/naikoutekibotti/n/nc19ab5a57f6f)，2026）：
  - 画面元素清单：本编文本（白字长文）/ 消息窗 / 菜单按钮（右上）/ **点击等待动画（右下白色的蝴蝶）** / 背景图 / 立绘 / 版权文字（单独层叠加）。
  - **行数上限 9 行**（由字号、行间、上下余白决定）；**每行最多约 26 字**（由字号、字间、左右余白决定）。
  - 字体选「しっぽり明朝」（理由是「一般的に『本文は明朝系が読みやすい』」，并按作品氛围选择）。
  - 字色：**基本白字（因背景基本偏暗）**，特殊场面用黑字；**描边用于提高判读性**；配色经验「背景と一体感を持たせたいなら色相が 0 じゃない色／背景から浮かせたいなら彩度が 0 の色」；且**基本文字色不要频繁变动**（否则「忙しなく感じる」）。
  - 消息窗：1280×720 基准、黑色半透明、**朝某侧渐隐**。
  - 背景偏暗的动机作者列了两条（其中一条是个人偏头痛对策），属自述。
- 另一份把「要不要窗口」做成设计光谱的分析（[note: ノベルゲームのメッセージ枠デザインを考える](https://note.com/trdd/n/n0805bf08b09b)）：① 有框（「くっきりはっきり、昔ながらの安心感」，近年也有透过式）；② 透过（「現在のスタンダード」，一般做法是「黒で透過し、**だんだん透明度が上がって画面に溶けこんでいく**」）；③ **无框/画面设计的一部分**（例：Narcissu、q.u.q.，主画面也退到黑底的电影宽银幕风格）；④ 位置自由/气泡/静止画的空白处/甚至压在静画之上（例：シルバー事件等，多用于高潮场面临时采用）。并指出**文字 2 行 vs 3 行、行长的长短也会改变印象**：「文字量が少ないほどライトな雰囲気に、多いほど読みもの寄りになる」。

#### 4.6.2 「有图」时文字压图的既有做法与度量

- **全屏文字直接压在整屏照片上**是 Chunsoft 系的基本形态（§1.1 Giant Bomb、§2.2）；《428》图片以 pan/zoom 与零星数秒视频避免单调（§2.3）。
- **半透明黑窗的既有取值**：TyranoScript 的全屏小说型示例参数——窗口 `left=20 top=60 width=920 height=560`（960×640 画面，故左 20 / 右 20 / 上 60 / 下 20），**`opacity=140`（255 满刻度）**，文字区内边距 `margint=50 marginl=80 marginr=80 marginb=100`，**字号 28 / 行间 16 / 字间 0，黑色描边**；作者理由：「写真背景＋全画面の場合、影より縁どりの方が見やすいと思います」「ウィンドウ内余白が多い方が文字は抜群に読みやすくなりますし、息苦しさも感じません」；并指出「行間は文字の大きさ×0.5 を目安」（有注音时再多留一点）（[note](https://note.com/mahiro_aihara/n/nab23ab093600)）。
- **渐变/局部变暗**：很多作品用「上部多少留白、其余余白均匀」并把窗口做成「朝某一侧渐隐」的黑半透明面（§3.5 的 arai「簡易的なフィルターのようなものから、周囲に装飾を懲らした華美なものまで様々」；ぼっち的窗「朝某侧渐隐」）。
- **完全无窗（字幕式）**：`アオナツライン` 默认窗口全透明（可调）；`Life is Strange` 直接压在背景上且不显示说话人（§2 与 §3.5 引 arai 画面構造5）。
- **WCAG 侧的硬线**：
  - [G18](https://www.w3.org/WAI/WCAG22/Techniques/general/G18)：正文 <18pt（粗体 <14pt）需 4.5:1；针对「背景或字本身亮度变化/有图案」的情形，官方给出的手段包括「使字后的背景变暗」「给字加至少 1px 的细黑描边」「随手后背景亮度变化同时改变字的明度」「给文字加 halo（光晕）」。
  - [G145](https://www.w3.org/WAI/WCAG22/Techniques/general/G145)：大字（≥18pt 或粗体 ≥14pt）3:1。
  - [1.4.3 理解](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)：明确 `F83` 是失败案例——**使用与前景文字对比不足的背景图**；并提醒抗锯齿会让细/特殊字体实际对比低于名义值，建议加粗或用更高对比。
  - [G18 的失败与示例](https://www.w3.org/WAI/WCAG22/Techniques/general/G18)：官方示例之一正是「在一张校园照片上放文字 → 把文字区域**雾化成白色**，使照片非常淡、最暗处仍能与黑字保持 4.5:1」。
- **遮罩不透明度的定量方法**（[CSS-Tricks: Nailing the Perfect Contrast Between Light Text and a Background Image](https://css-tricks.com/nailing-the-perfect-contrast-between-light-text-and-a-background-image/)）：
  - 步骤：把图片绘进 `<canvas>` 逐像素读色 → 找出与文字色对比度最差的像素 → 用 `mixedColor = baseColor + (overlayColor - baseColor) * overlayOpacity` 试算叠加后的颜色 → 用**二分搜索**找满足目标对比度的最小不透明度。
  - 现成结论：「For the common case of **white text on a black transparent overlay, you'll never need an opacity over 0.54** to achieve WCAG AA-level readability.」（并按最坏图统一取 0.54）
  - 局限（原文自陈）：只按数学对比度不够——**浅底深字压在繁复背景上，即使数值合格也可能难读**，所以「popular recommendation is to use light text on a dark background」；逐像素方法也未考虑像素所在位置与数量。
- **半透明面板的双背景测量法**（[gohud](https://thruthesky.github.io/gohud/ja/theming-contrast.html)）：
  - 阈值表：正文 4.5:1；大字（≥24px）3:1；强调性边框与图标 3:1；装饰性边框 2:1（WCAG 不要求）；相邻面 1.12:1（够分辨即可）。
  - 「浮起面板的背后可能是什么，写作品的人无从得知」，所以要**在纯白与纯黑两种最坏背景下分别测量**；实测案例：**不透明度 82% 时，亮背景之上暗主题的低调文字掉到 3.74:1（低于底线）；同样的玻璃观感要达标需 92%**。
  - 同一坑在代码库出现过 3 次：按下态按钮（强调面板上放强调色文字）、危险按钮、chip ——**同色系 + 无明度差 = 表格上好看、一测就崩**。
  - 处理方式：标签色不手选，由主题构建器/`GoSkin` 在**实际承载面板上**把明度提升到超过阈值，保留色相与饱和度。
  - **「读文字的色」与「涂面的色」需求相反**：浅色主题的警告色作为文字必须压暗（`#96500A`），但若被条形填充继承就变成棕色；于是分成 `warning`（文字用）与 `warning_vivid`（填充用）成对令牌，并用描边补足对比。→ 与 AIVN 已有的 `--success` / `--success-ink` 成对令牌思路完全一致。
- **亮/暗主题下字重的差异**（[Harlowe 排版长文](https://intfiction.org/t/harlowe-thinking-outside-the-box/61328)）：「When displaying light coloured fonts on dark backgrounds, **font weight is extremely important**. The darker (or more discreet) the font, the more weight it typically needs to show up clearly. With brighter fonts, less weight is required.」

#### 4.6.3 「同一套主题兼容有图/无图」的工程开关（各引擎的现成做法）

- **Ren'Py**：`window show` / `window hide`（可带转场）控制 NVL 窗口显隐；`nvl show` / `nvl hide` 为显式命令，「can be used in games that use a **mix of NVL-mode and ADV-mode** windows」；`config.window_show_transition` / `window_hide_transition` 设默认转场；`window auto True` 按语句类型自动显隐（默认 `config.window_auto_show` 含 say，`config.window_auto_hide` 含 `scene` / `call screen` / 无 caption 的 `menu`）；`config.empty_window` 在转场期间强制显示 NVL 窗口；**同一游戏里以角色为单位混用**：`Character(..., kind=nvl)` 的角色走 NVL，其它走 ADV，官方并提供「完全不定制的 NVL 角色」用于旁白（[nvl_mode](https://www.renpy.org/doc/html/nvl_mode.html)、[dialogue](https://www.renpy.org/doc/html/dialogue.html)）。
- **Monogatari**：角色级 `nvl: true` 让**该角色所有对话走 NVL**；另有 `centered`（居中浮框、隐藏常规文本框）与 `narrator`（不显示名字）；组件属性 `mode: 'adv' | 'nvl'`；NVL 下**不显示 side image**、「dialogs are appended rather than replaced」、文本区可滚动（[Dialogs](https://monogatari.io/v2/script-actions/dialogs)、[Text-Box](https://monogatari.io/v2/components/text-box)、[Characters](https://developers.monogatari.io/documentation/develop/building-blocks/characters)）。
- **RouteVN**：**每行**可在下拉里选该行用哪个 dialogue layout，且只列出类型为 `Dialogue ADV` / `Dialogue NVL` 的 layout；点击继续指示器在 layout 编辑器里配，可加在显示台词的文本揭示元素上（[Dialogue](https://routevn.com/en/creator/docs/line-actions/dialogue/)）。
- **Narraleaf（React）**：NVL 层与 ADV 行分离，且**「isActive（是否处于 NVL 模式）」与「isVisible（NVL 层是否在屏幕上）」是两个不同问题**——「A session stays active while the layer is hidden」；状态含 `phase: "idle" | "typing" | "awaitAdvance"`、`pendingAdvance`、`isTyping`；自定义容器由 `NvlContainer`（外层：可见性/转场/宽高比缩放）+ `NvlDialogList` + `Nametag` + `Texts` 组成，`renderDialogItem` 可只改单行外观（如给非活动行 `opacity-60`，给台词加左轨 `border-l-4 pl-2`）（[文档](https://www.narraleaf.com/docs/narraleaf-react/player/nvl-container)）。
- **WebGAL**：`applyStyle` 可在**运行时**把某个样式名映射到另一个样式名（`TextBox_ShowName_Background->TextBox_ShowName_Background_Red`），支持一次替换多个；可替换的常见项包括 `Choose_Main` / `Choose_item` / `Choose_item_disabled`。模板文件按界面切分（`Stage/Choose/choose.scss`、`Stage/Textbox/textbox.scss`、`UI/Title/title.scss`），4.6.1 起改为「用户定义了某个类就不再套用基础样式」。（[自定义 UI](https://docs.openwebgal.com/webgal-script/custom-ui.html)、[applyStyle](https://docs.openwebgal.com/script-reference/commands/applyStyle.html)、[RFC4](https://www.openwebgal.com/zh-cn/blog/rfc4/)）
- **WebGAL 的全屏文字命令**：`intro` 是独立的「全屏文字命令」，用 `|` 分多行，**演出结束后自动关闭、不遮挡后续对话**；连续多条 `intro` 只显示当前一条；可设 `fadeIn`（默认）/ `slideIn` / `typingEffect` / `pixelateEffect`（模糊）/ `revealAnimation`（卷轴展开）；加 `-hold` 参数则独白结束后保持该界面（[intro](https://docs.openwebgal.com/script-reference/commands/intro.html)、[对话/黑屏文字](https://docs.openwebgal.com/webgal-script/dialogue)）。→ 注意这与 NVL「累积」是不同机制：**黑屏独白是模态覆盖，不是文本流。**
- **Naninovel**：`@hidePrinter` 等 actor 命令可隐藏文本；`@printer` 的 `hideOther` 可隐藏其它 printer；**UI 级**另有「UI 显示切换功能允许玩家整体隐藏或显示游戏内界面」，且 `CustomUI` 的 `Save Visibility State` 会把可见性持久化到存档（[用户界面文档（中文）](https://nani.nanana.cn/zh/guide/user-interface)、[Commands](https://naninovel.com/api/)）。
- **KAG**：`ShowMessageWindow` / `HideMessageWindow` / `InitMessageWindow`（多窗） / `ChangeMessageWindow`（切换消息窗）/ `ShowMenuButton` / `HideMenuButton`；多消息层可以表现「两人对话」（[宴 命令一览](https://madnesslabo.net/utage/?page_id=252) 展示了这套 UI 系命令；KAG 的多层消息层见 [krkr2doc](https://krkrz.github.io/krkr2doc/kag3doc/contents/Letter.html)）。
- **本人作品的自述（NVL 与 CG）**：Lemma Soft 讨论串里出现「CG 用 NVL 显示、日常用 AVG」「有作品在展示全屏 CG 时切到 ADV/字幕式以便完整看 CG」「有些游戏 NVL 大部分时间 + 显示全屏 CG 时切字幕式」（[帖](https://lemmasoft.renai.us/forums/viewtopic.php?t=3235)）。CG 鉴赏/Gallery 侧：TyranoScript 用 `[cg storage=...]` 在剧情中登记解锁，`[cg_image_button]` 展示，并有 `no_graphic` 占位图；回想用 `[setreplay]`/`[endreplay]` 包围剧本，跳回时用 `tf.system.flag_replay` 判断是否需要重建消息框设置（[tyrano.jp](https://tyrano.jp/usage/tech/cg)）。CS2 引擎的 CG 列表支持「未看过的差分是否登记」「游戏中未用到的图登记」（`cgflag` / `cgreg`）（[cs2 manual](https://cs2.suki.jp/manual/data/setup/cglist.html)）。

---

## 5. 引擎与规范层：可直接对照的技术事实

### 5.1 NVL 支持的横向对照

| 引擎 / 工具 | NVL 机制 | 换页 | 混用 | 备注 |
| --- | --- | --- | --- | --- |
| **Ren'Py** | `Character(kind=nvl)`、`nvl_narrator`、`nvl_clear`、样式 `nvl_label`/`nvl_dialogue`/`nvl_thought`/`nvl_entry` | `nvl clear` | 同一游戏按角色混用；`nvl show/hide`、`window show/hide`、`window auto` | `config.nvl_list_length`、`config.nvl_page_ctc(_position)`、`config.nvl_paged_rollback`、`config.nvl_layer` |
| **KAG / 吉里吉里** | 默认可做「画面全面に文字を表示するタイプ（ヴィジュアルノベルタイプ）」；「KAG はどちらの方式でもできる」 | `[p]`（翻页等待）+ `[cm]`（清屏）；`ct`/`cm`/`er` 三种清除语义不同 | 多消息层可模拟两人对话 | **可竖排显示**（Config.tjs 切换）；`[l]` 点击等待、`[r]` 换行 |
| **TyranoScript** | 与 KAG 同源；有社区全屏小说实现（参数见 §4.6.2） | 同上 | 宏控制消息层与字体 | 既读管理、自动、跳过为标配 |
| **Naninovel (Unity)** | Fullscreen Printer（「aka "NVL" mode」） | `@resetText`；`Auto Reset` 配置可改为每次 print 自动重置 | `@printer` 切默认 printer、`hideOther` | 默认每次 print 前置两个换行（`Auto Line Break`）；`Reveal Fader` |
| **Monogatari (Web)** | `mode: 'nvl'`；角色级 `nvl: true`；另有 `centered`、`narrator` | —（追加+滚动） | 角色级混合 | NVL 下不显示 side image；`unread` class；四类打字机开关 |
| **Narraleaf (React)** | `NvlContainer` / `DefaultNvlContainer` / `NvlDialogList` / `Nametag` / `Texts` | — | `isActive` vs `isVisible` 分离 | `renderDialogItem` 可只改单行样式；`useNvl/useNvlDialogs/useIsNvlMode/useIsNvlVisible` |
| **RouteVN** | Dialogue 有 ADV / NVL 两模式 | `Clear Page`（仅 NVL） | **逐行**选择 layout | 点击继续指示器在 layout 编辑器配置 |
| **WebGAL (Web)** | 无 NVL 累积模式；有独立 `intro` 全屏文字（黑屏独白） | `intro` 自动关闭；`-hold` 保持 | `applyStyle` 运行时换样式 | 逐字有 `start`/`Settled` 两状态类；注音/行内 CSS 的「文本拓展语法」 |
| **Suika3** | 支持竖排（tategaki）与禁则（kinsoku），逐字 blit 与速度控制 | — | — | 竖排由 `config.ini` 开启 |

来源见 §4.6.3 各条与 [Suika3 DeepWiki](https://deepwiki.com/awemorris/suika3/5.2-text-rendering-and-dialogue-system)、[KAG 文档](https://krkrz.github.io/krkr2doc/kag3doc/contents/Letter.html)。

### 5.2 竖排（縦書き）的事实与工程要点

- **排版学归属**：[J-Compass](https://j-compass.com/docs/japanese-learning/writing-systems/mixed-script-and-furigana/vertical-horizontal-writing) 引 JLReq §2.3.1：「novels...are almost completely in vertical writing mode」；漫画的对白与旁白几乎全部竖排；而「Websites and chat interfaces」以横排为主（并指出这是技术路径依赖——HTML/CSS 的 `writing-mode` 初始值为 `horizontal-tb`）。
- **技术实现**：`writing-mode: vertical-rl` = 自上而下、行由右向左；`vertical-lr` 为蒙古文等使用。**注音（ruby）位置随书写模式改变**：横排在上方、竖排在本字右侧（JLReq §3.3.4）。（同页）
- **游戏引擎实现例**：《霞外籠逗留記》等 raiL-soft 作品把「竖排/横排可切换」做成名为 V=R（ヴァリアブルリード）系统的产品规格（§2.8）。
- **Web 侧的完整规格化实现**（[Shojiku 文档](https://shojiku.pages.dev/reference/vertical_text)）：`writingMode: vertical_rl` 让文本成为竖排块；`textOrientation: mixed`（默认）按 UAX#50 让 CJK/假名保持正立、拉丁字母与数字旋转 90°；`upright` 全部正立；竖排下的 `lineHeight` 语义变成**列宽**、`textAlign` 沿列方向（left→top）；`textOverflow` 的 `clip`/`shrink`/`ellipsis` 在竖排下沿「列堆叠方向」工作；`textCombineUpright: { digits: 2..=4 }` 实现**縦中横**（短数字串合成一个正立格，超出 N 位则完全不合）；`ruby` 在竖排下置于本字右侧；**禁则（kinsoku）全程适用——逗号不得起列、开括号不得结列**；竖排内容超出可跨页，**按整列为单位、保持右到左阅读顺序**。另给出降级路径（字体缺少竖排信息时按字符回退、合成 `、。` 与小型假名的微调）。
- **编辑/写作工具侧**：`vertedit`（VS Code 竖排 WYSIWYG，支持縦中横）、`tategaki-editor`（Web，Lexical + `writing-mode`，RubyNode / TateChuYokoNode / PageBreakPlugin）（[GitHub](https://github.com/k-rainfield/vertedit)、[GitHub](https://github.com/cordx56/tategaki-editor)）。
- **Ren'Py 的竖排与其已知缺陷**（[Style Properties](https://renpy.org/doc/html/style_properties.html)、[Text](https://renpy.org/doc/html/text.html)、[issue #3046](https://github.com/renpy/renpy/issues/3046)）：支持 `vertical` 样式属性与 `{horiz}`/`{vert}` 标签；但官方列出的 caveats 包括：`shaper="freetype"` 时竖排可能不正确；**字符自上而下、右到左排列但不旋转**（横排字符会一个个堆叠）；字体缺竖排信息时会被合成、可能不正确，「Generally, ideographic text works better than non-ideographic text」；且 issue #3046 记录 **7.4.0 之后竖排不再使用字体的竖排字形（`（）「」ー` 不再旋转），退回普通横排字形**，原因是 7.4.x 内置字体 SourceHanSansLite 不含竖排信息。

### 5.3 排版参数快照（可作默认值对照，全部原样摘录）

| 来源 | 参数 |
| --- | --- |
| TyranoScript 全屏小说实作（960×640） | 窗 920×560、opacity 140/255、文字内边距 上下 50/100、左右 80、字号 28、行间 16、字间 0、黑描边、窗口黑色半透明且一侧渐隐 |
| 同上的单行 3 行 ADV 惯例（kibits 规格表） | **文字数 25 字 × 3 行、字号 28px**、名字窗仅会话时显示、無名無顔的风格也存在 |
| 全屏小说实作（1280×720） | 最大 9 行、每行约 26 字、白字 + 描边、窗黑色半透明、朝一侧渐隐 |
| HyperEZnovel（Unity 模板 JSON） | `maxCharsPerLine: 50`、`maxLines: 3`、`charsPerSecond: 30`、`fontColor #FFFFFF`、**`readTextColor #CCCCCC`（已读色）**、`alignment TopLeft`、`margin {top 93, left 48, right 48, bottom 30}`、`:30` 注音 offsetY、名字窗 `fontSize 60` 且支持 outline/shadow/gradient；`novel_mode`：全屏 1920×1080、**`opacity: 191`**、四边 margin 100 |
| Ren'Py 默认 GUI | `gui.textbox_height = 279`、名字框 `gui.namebox_width = 214` / `namebox_height = 50`、`gui.name_xpos = 390` / `name_ypos = 15`（来自一份日文教程，[来源](http://renpy.chocolatemintfudge.net/?eid=2)）；`gui.nvl_list_length = 6`（[来源](https://rect.page/en/p/2026/05-13-making-chat-ui-with-renpy-nvl-mode/)） |
| Naninovel 默认 | Default Base Reveal Speed 0.5、Max Reveal Delay 0.06s、Max Auto Wait Delay 0.02s、默认转场时长 0.35s、场景原点 (0.50, 0.00) |
| Monogatari | `TextSpeed` 默认 20（越低越快）；四类打字机开关默认 true |
| WebGAL | 行高 `2em`（非 medium 字号）/ `2.2em`（medium）；文本容器 `paddingLeft: 0.1em` |
| Chapbook | `baseViewportWidth` 1000、`addAtDoubleWidth` 6、`maximumSize` 无默认（可选）；栏宽由字号推得 |
| JLReq（日文组版要件） | **1 行の行長：縦組 最大约 52 字、横組 约 40 字**；超过则建议分栏；**行間：基本版面字号 1/2 以上、全角以下**；行長短时 1/2 也可，**超过 35 字时用全角或略紧**；行长应设为字号的整数倍；长段以外的行须对齐行末 |
| モリサワ（实务参考值） | 四六判纵组 9pt ≈ **40–44 字**；菊判纵组 ≈ 49–52 字；菊判横组 ≈ 35 字；**纵组超过 50 字、横组超过 40 字应改分栏**；单行本 9pt/16 行/行间 8pt 或 17 行/行间 7pt；【本文】行长长→行间约全角，行长短（约 20 字）→可行间 2 分、宽裕时到 2/3；【见出し】字号 1/3–1/4；【表组み】1/2；【キャプション】1/4–1/2 |
| Adobe（实务参考值） | 本文 11–13Q、caption 9–10Q、小见出し 14–16Q；**行送り = 字号 ×150%（行间 2 分）〜175%（行间 2 分 4 分）** |
| 中文移动端（MEUX 眼动实验 + 访谈） | 可接受行间距 **1.50–1.70**，最终定 **1.70**；**字间距缩为 0**；段间距随字号自适应；**连续标点挤压**（第二个及之后的标点用半角）；**避头尾采用「推出式」**（因「先推入后推出」在 UI 场景实现成本过高）；行长为字号整数倍（否则两端对齐会拉大字间距） |
| 中文移动端（极客文档/目录式排版） | 每行中文字符 **17–46，最佳 23**；行距取中 **1.6 倍**；避免纯黑字压纯白纸（刺眼）；长行必须配合更大行距 |
| 西文（Butterick） | 正文 10–12pt（印刷）/ 15–25px（Web）；行距 **120–145%**；行长 **45–90 字符**（或 2–3 个小写字母表） |
| 西文（Bringhurst，经由 vocab.design 转述） | 单栏 45–75 字符 satisfactory，**66 字符为 ideal**；`max-width: 66ch` 因 zero 字形比平均小写字母宽，实际约 70–75 字符，**取 ~60ch 更接近 66**；行长长则行距要更大 |
| Harlowe 社区 | 可读性 sweet spot **50–75 字符**；用 `rem` 统一 margin/padding/font-size/line-height；栏宽用 `ch` |
| inkle | **一行 5–15 个词** |
| gohud（阈值表） | 正文 4.5:1、大字（≥24px）3:1、强调边框与图标 3:1、装饰边框 2:1、相邻面 1.12:1；半透明面需在纯白/纯黑两极端下测；玻璃面板达标不透明度 92% |

---

## 6. 标题画面 / 扉页的设计语言

### 6.1 VN 主菜单的构成惯例

- **标准按钮集**（[VNDev Wiki: Graphical User Interface](https://vndev.wiki/Graphical_User_Interface)）：New / Load / Options / Quit 为基本盘；常见追加 **Continue（直接读最近存档）**、**Extras（UGC 解锁内容，常在通关一次后才出现；可能展开成 Gallery 等子按钮）**、**About（引擎与版本、staff、许可）**、Side Content。
- 行为注意：**从主菜单进入存/读档时通常不允许存档**（玩家并不在游戏中）。
- 「作为玩家交互的第一个菜单，创造与游戏整体调性一致的良好第一印象很重要」；开发常用**关键视觉（key visual）+ 游戏 logo + 版权信息**，并播放 BGM 或环境音。
- **主菜单会随里程碑变化**：某些结局达成后换 BGM、换关键视觉，或两者同时；「In rare cases, some will even completely change the entire design and layout.」
- GUI 通用建议（同页）：「Ideally, GUI is designed custom for the game to reflect its tone and theme. When in doubt, it is recommended to use **simple and no-frills designs** rather than detract from the game by being intrusive」；并指出 GUI 美术常由**不同于立绘/CG 美术**的人担当（技能集不同）。
- **NVL 作品的标题画面差别**：很多 NVL 作品**界面上完全不显示 UI 按钮**，一切功能通过独立的暂停菜单进入（§3.5）。

### 6.2 引擎侧的标题画面结构

- **HyperEZnovel 的 `title_screen_config.json`**（[文档](https://hyperiyon.com/hypereznovel/docs/ui-template-title.html)）：`background.image` + `transitionTime`（背景淡入毫秒）、`bgm`、`transition.type=crossfade` + `time`（默认例 500ms）、按钮数组（type ∈ start/load/config/extra/exit，各带 graphic / x / y / width / height / targetStorage / targetLabel / `soundOver` / `soundOn` / **`buttonType: "triple"`** / **`requireGameClear`**）、`animation.buttonTransitionTime`。**「triple」= 自动读取三态贴图**（`title_btn_start.png` / `_h`（hover）/ `_p`（pressed））。exit 会弹确认对话框。
- **Ren'Py 的结构分离**：`navigation` screen（实际的菜单项清单）与 `main_menu` screen（标题画面的背板/图像）两层；`main_menu` 上的图像**按添加顺序叠放（先加的在下）**；同一组导航按钮在 title / 从标题进入的 game menu / 游戏中的 game menu 三种情境下常需要不同位置与不同按钮子集（教程用 `if`/`elif`/`else` 与 `renpy.get_screen("main_menu")` 区分）；动画可用 transform，且**同一 transform 可复用于不同按钮**（[itch devlog 教程](https://itch.io/devlog/521670/carrots-super-cool-tutorial-for-making-a-snazzy-animated-menu-for-all-your-sweet-sweet-renpy-visual-novel-needs.amp)）。默认 Ren'Py 主菜单是左侧导航 + 右下角游戏名与版本号，背板可换成自绘图并**删掉叠加黑矩形**（[Wooster 教程](https://inside.wooster.edu/technology/advanced-game-user-interface-design-renpy/)）。
- **Visual Novel Maker**：标题画面即一个 `ui.FreeLayout`（占满全屏）+ 一个 `ui.StackLayout`（vertical）承载按钮；坐标可用百分比与 `"50% - 20"` 之类表达式；按钮可 `resizable`、可给 `margin` 制造间距；每个按钮绑定一个具名 `action`（如 `newGame` / `switchLayout`）；`switchLayout` 的 `savePrevious` 可让标题画面不被销毁而是暂停隐藏，以便返回（[官方示例](https://asset.visualnovelmaker.com/help/Example__Custom_Title-Screen.htm)）。

### 6.3 「纯文字封面 / 扉页」的设计语言（文献层面的可迁移原则）

来源：[BookPublish Guides — Typography and hierarchy](https://www.bookpublish.app/guides/fundamentals/typography-and-hierarchy/) 与 [Covers made of nothing but type](https://www.bookpublish.app/guides/cover-art/typographic-only-covers/)。逐条摘录其可迁移论断：
- **读者不从顶部往下读**：「The eye lands on the largest area of high contrast, follows lightness to the next one, and only then starts reading words.」因此**明亮度（value）优先于尺寸**——「A small line in a bright color beats a large line sitting at a similar lightness to its background」；位置的权重最弱。
- 层级排序工具是**尺寸、字重、明度、空间**，位置只决定这个排序落在哪里。
- 小说封面的常规层级：① 书名（明显最大）② 作者名（第二，且小得多，除非是品牌）③ 系列行（小、跨系列一致）④ 标语/推荐（最小、可省——「The fourth line is the one to delete」，因为缩略图下不可读，反而抢走书名的空间）。
- **「60pt vs 48pt 不是层级，是两个相似的东西」**；书名通常是作者名的 2–3 倍；在纯文字封面上最强元素常是最小元素的 **4–5 倍**。
- **字重是尺寸的乘数**；空间不足时先加重量而不是加点数；**窄体字换来更高的字号**（thriller 封面常用 condensed all-caps 的原因）。
- 大号全大写标题几乎总是需要**加大字距**（默认字距是按小写正文字号设计的）；大号多行标题的**行距要收紧**（常紧于字高）。
- **用间距分组**：如果书名与副标之间的距离等于副标与作者名之间的距离，就等于告诉读者三者是一个块。
- **按意义断行**（`The Long / Walk Home` 错，`The Long Walk / Home` 对），并在断行处朗读检验。
- **给文字独立的区域**：最强的封面为标题留出一块安静区域，而不是压在细节上。
- 纯文字封面的必备条件：**一个强概念**（能对没见过的人用一句话描述）、**有真实性格的字体**（「A type-only cover is a portrait of a typeface」；中性的支撑字体在没有图的时候无话可说）、**真正的对比**、**在做事的空白**（空白是被塑形的元素，不是剩余物）。
- **反例即「无设计」**：把标题居中、作者名居中放在彩色矩形上；「The fault is centering as a default, because it is what happens when you type a title into a box and stop.」
- 构图手法：让标题中承载书的一个词**远大于**其余；把一块推到边缘（触三边看起来是决定过的、浮在中间看起来是临时的）；**让颜色承担图像的工作**（一个饱和色场，或一个极暗面板 + 反白字）；**把作者名当作构图中的一个形状**（可做成沿底边宽字距的一行、角落的小块，或几乎和书名一样大）。
- **缩略图测试**：纯文字封面缩小时表现优于几乎所有其他方案（「a large word is still a large word at 160 pixels while a detailed illustration becomes a smudge」）；缩小后若能存活的是一个强词 + 一种颜色则成立，若只剩一个灰块则从未有过概念。
- 类型-题材对应表（可作「字体情绪」参照）：粗窄无衬线/紧凑全大写 = 惊悚悬疑动作；经典衬线 = 文学历史回忆录；装饰性 display 衬线 = 奇幻、romantasy、哥特；手写/script = 言情、女性向、cozy；几何无衬线 = 科幻、商务、自助。**一套设计只用一到两种字面，「Three is a ransom note」**；需要变化时用同一家族的不同字重与尺寸。

---

## 7. 无障碍与可读性：跨来源汇总的检查项

1. **对比度**：正文 4.5:1、大字（≥18pt 或粗体 ≥14pt，gohud 用 ≥24px）3:1、强调性图形/图标 3:1、相邻面 1.12:1。（[W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)、[gohud](https://thruthesky.github.io/gohud/ja/theming-contrast.html)）
2. **文字压图**：加描边（≥1px）、给字加 halo、压暗文字区域、随背景明度调整字的明度；**F83 = 用对比不足的背景图是明确失败案例**；官方示例「把图雾化成白」。（[G18](https://www.w3.org/WAI/WCAG22/Techniques/general/G18)）
3. **抗锯齿导致的「名义对比达标、实际不达标」**：官方建议加粗笔画或超过 norm 要求；实践上细体明体在小字号屏幕上会更糟糕。（[W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)、[テイビ](http://blog.livedoor.jp/tales_vivid/archives/30425162.html)）
4. **暗底亮字**：`font weight` 必须够（越暗越含蓄越要加粗）（[Harlowe 长文](https://intfiction.org/t/harlowe-thinking-outside-the-box/61328)）；散光人群可能对黑底白字更不适（[テイビ](http://blog.livedoor.jp/tales_vivid/archives/30425162.html)）——两份来源给出**相反方向**的偏好，说明需要可切换。
5. **不要只靠颜色区分**（色盲）：Roadwarden 的实例（叙事/选项靠两色区分 → 必须加水平分隔线）。（[devlog](https://assemble-entertainment.itch.io/roadwarden/devlog/113863/the-new-chapter-about-steam-demo-and-others-roadwarden-devlog)）
6. **提供显示模式/字号而非单个滑杆**：Disco Elysium Final Cut 无法做动态字号滑杆，改为 **Monitor / TV / Handheld 三档预设**，每档有自己的字号、布局规则与视觉调整；字号用**视场角度**推导。（[redlamp](https://redlamp.org/work/disco-elysium/)）
7. **玩家可调窗口透明度**（ひぐらし奉 的设置项）。
8. **打字机动画必须尊重 `prefers-reduced-motion`**：命中时全文立即可见、光标不闪、屏幕阅读器始终读到全文。（[MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)、[Quiet UI](https://next.quietui.org/docs/components/typewriter)、[Motion Components](https://www.motion-components.dev/docs/recipes/typewriter-hero/)）
9. **多语言/多字体长度膨胀**：名字窗与按钮在某些语言下会溢出（[arai](https://arai-novelgamelabo.com/entry/2024/10/28/170000)、[Citizen Sleeper 访谈](https://www.pointnthink.fr/en/interview-gareth-damian-martin-2/)、[CoG 按钮 ≤5 词](https://www.choiceofgames.com/make-your-own-games/important-choicescript-commands-and-techniques/)）。
10. **不可选项的可辨识性**：仅灰色可能太弱，可改锁定文案（Fallen London 官方讨论）。（[论坛](https://community.failbettergames.com/t/storylets-redesign/9282?page=2)）
11. **字体授权**：嵌入商用字体需注意许可（《まほよ》把商用字体图像化后随包分发；[cactus 的字体操作段](http://cactus4554.blogspot.com/2011/10/blog-post_7377.html)；[ぼっち的提醒](https://note.com/naikoutekibotti/n/nc19ab5a57f6f)）。
12. **纯文字封面的缩略图测试**（§6.3）。

---

## 8. 参数与做法汇总（原样摘录表，供直接比对）

**「一次显示多少」的既有取值**

| 来源 | 值 |
| --- | --- |
| 《弟切草》开发结论 | 一次按键**最多 3 行、理想 1–2 行**；理由是「一気に文字を出すと、置いてかれる感じがする」 |
| かまいたちの夜 手机版 | 改为「文章一次性显示、电子书式翻页」 |
| Ren'Py 默认 GUI | NVL 一次最多显示 6 条（`gui.nvl_list_length = 6`），超出移除最旧项 |
| 日式 ADV 惯例（arai） | 消息窗**3 行为上限是最常见做法，2 行也不少**；作者认为 4 行以上偏多 |
| TyranoScript 3 行窗规格 | 25 字 × 3 行 |
| 全屏小说实作 | 最大 9 行 / 每行约 26 字 |
| ChoiceScript 社区经验 | 选择内 ≤300 词，超过就拆 label |
| inkle | 一行 5–15 词；Frankenstein 的「3–4 段后才有选项」导致阅读兴趣显著流失 |

**「名字怎么放」的既有取值**

| 来源 | 值 |
| --- | --- |
| Ren'Py NVL 默认 | 名字在左、台词右缩进；色可配 |
| Ren'Py NVL 三档定制 | ①名牌+缩进 ②名字写进文本流（`what_prefix`）③无名字只加引号（官方警告难辨说话人，可用 `what_color` 补） |
| Ren'Py NVL 样式 | `nvl_label` / `nvl_dialogue` / `nvl_thought`（旁白/内心）|
| Narraleaf 默认 NVL 行 | 「名字：文本」 |
| 日式 ADV 标准（towardstheendsky） | 名字在主文本之上、与文本左边对齐；**文本不填满框，留约 1/3 空白** |
| ATRI | 窗上方无名牌地直接显示名字 |
| Citizen Sleeper | 名字与 tag 显示在文本框的**侧边**（玩家明确表示这是最喜欢的做法） |
| 吉里吉里宏范例 | 名字带 `【】` 写进文本、按说话人换色；旁白另开层且不显示名字 |

**「选项放哪」的既有取值**

| 来源 | 值 |
| --- | --- |
| Ren'Py NVL | 紧跟当前页文本之后；选择后菜单消失，通常随后 `nvl clear` |
| ChoiceScript | 页末；`*page_break` 按钮默认「Next」 |
| inkle | 作为分节标题的小纸片置于文本之上；未选中的纸片被推开；作者假设玩家**先读选项再扫文本** |
| Roadwarden | 早期靠两色区分叙事与选项 → 加水平分隔线；后期把交易按钮放在「核心文本附近」 |

**「背景遮罩」的既有取值**

| 来源 | 值 |
| --- | --- |
| TyranoScript 全屏小说 | 黑色半透明窗 opacity 140/255；或朝一侧渐隐 |
| HyperEZnovel `novel_mode` | 全屏 1920×1080、opacity 191、四边 margin 100 |
| 全屏小说实作 | 1280×720、黑色半透明窗、朝一侧渐隐 |
| CSS-Tricks 定量结论 | 白字 + 黑遮罩时，达到 WCAG AA 所需不透明度**不超过 0.54**（按最坏图） |
| gohud 定量结论 | 玻璃面板需 **92%** 才在各种背景上达标；82% 时降到 3.74:1 |

---

## 9. 存疑与未覆盖

以下为本次调研中**证据不足、来源自陈推测、或明确未覆盖**的点，使用前需另行核实：

1. **《ひぐらし》具体名牌形态未确证**。已确证的是：脚本格式里说话人信息存在但需靠 `msgwnd_*` 类命令设置（Project Umineko 维护者表述）；07th-mod 的解包数据中旁白行的 `Speaker` 为 `null`、部分行有说话人；《ひぐらし》设定里有「既读判定」开关但**没有**名字显示开关。**未见可靠来源描述其名牌在屏幕上的确切位置与样式。**
2. **《魔法使いの夜》的淡出实现方式**：来源作者自陈「どうも力技のような気がしている」，即对吉里吉里定制的推断，非官方说明。
3. **《うみねこ》原版是否显示说话人名**：讨论帖的说法是「原版 PC 与 07th-mod 版本的脚本数据不绑定说话人名」，而 PS3 素材移植版有 nametag。**原版游戏画面是否显示名牌，本次未取得确证。**
4. **《Suzerain》的界面细节未覆盖**（本调研未检索到其文本流排版的可靠一手描述）。
5. **「悬挂人名 / 左轨人名」（hanging name in the left margin）**：本次未找到以该术语命名的 VN 实践文献。可用的**有来源的近似物**只有三处：① 剧本格式（角色提示缩进、台词居中窄列）；② Narraleaf 的默认 NVL 行「名字：文本」；③ Citizen Sleeper 把名字与 tag 放在文本框侧边（作者自述最受玩家欢迎的一种）。**AIVN 若采用「左轨悬挂人名」，属于在既有做法基础上的组合，而非业界成规。**
6. **《428》《かまいたちの夜》以外，Chunsoft 系的具体字号/行数参数**未取得。
7. **AI 时代的「纯文本互动小说」产品横评**（如又一款具体产品的字号、行宽）未取得可比参数，仅取得定性描述（Reverie）。
8. **「打字机速度」与阅读速度的量化对应关系**：仅有 inkle 的「玩家等待会累积 apathy」与流式 UI 文献的「阅读 250–400wpm」两条，**未见针对 VN 逐字显示速度的实验数据**。
9. 关于**纵向排版的游戏实践**，仅取得 raiL-soft 的 V=R 系统与 Shojiku 的规格化实现，**未取得具体商业 VN 的竖排截图级描述**。

---

## 10. 来源清单

**日系（NVL / Sound Novel）**
1. [Ren'Py NVL-Mode Tutorial（英）](https://www.renpy.org/doc/html/nvl_mode.html) / [日文版](https://ja.renpy.org/doc/html/nvl_mode.html)
2. [renpy/common/00nvl_mode.rpy 源码](https://github.com/renpy/renpy/blob/master/renpy/common/00nvl_mode.rpy)
3. [Ren'Py Text 文档（cps/w/p/nw/fast/done、竖排）](https://renpy.org/doc/html/text.html) / [Style Properties（vertical）](https://renpy.org/doc/html/style_properties.html) / [issue #3046 竖排字形回归](https://github.com/renpy/renpy/issues/3046)
4. [Ren'Py Dialogue 文档（ctc/voice/extend/window auto）](https://www.renpy.org/doc/html/dialogue.html) / [Config 文档（afm_*、history_*）](https://www.renpy.org/doc/html/config.html) / [Preferences](https://renpy.org/dev-doc/html/preferences.html) / [Dialogue History](https://nightly.renpy.org/doc/history.html) / [Special Screen Names（ctc screen）](https://www.renpy.org/dev-doc/html/screen_special.html)
5. [Ren'Py 思考气泡实现讨论（ConditionSwitch / 独立 Character）](https://lemmasoft.renai.us/forums/viewtopic.php?t=64438)
6. [Lemma Soft：Full Page Text or Text Box?](https://lemmasoft.renai.us/forums/viewtopic.php?t=1776) / [ADV or NVL?](https://lemmasoft.renai.us/forums/viewtopic.php?t=3235) / [Text styles and quotations in VNs?](https://lemmasoft.renai.us/forums/viewtopic.php?t=22919) / [thoughts/narration 展示方式](https://lemmasoft.renai.us/forums/viewtopic.php?t=36954) / [Customizing the NVL Textbox](https://lemmasoft.renai.us/forums/viewtopic.php?t=17232)
7. [Ren'Py 聊天式 NVL UI 实作（含 gui.nvl_list_length 与 vbox 反向布局）](https://rect.page/en/p/2026/05-13-making-chat-ui-with-renpy-nvl-mode/)
8. [arai ノベルゲーム研究所：画面構造1「全画面表示」](https://arai-novelgamelabo.com/entry/2024/10/25/120000) / [画面構造2「ウィンドウ表示」](https://arai-novelgamelabo.com/entry/2024/10/28/170000) / [画面構造5「ウィンドウ非表示」](https://arai-novelgamelabo.com/entry/2024/11/14/180000)
9. [GameBusiness：ビジュアルノベル成立史（福山幸司）](https://www.gamebusiness.jp/article/2019/07/24/15991.html)
10. [ja.wikipedia ビジュアルノベル](https://ja.wikipedia.org/wiki/%E3%83%93%E3%82%B8%E3%83%A5%E3%82%A2%E3%83%AB%E3%83%8E%E3%83%99%E3%83%AB) / [弟切草](https://ja.wikipedia.org/wiki/%E5%BC%9F%E5%88%87%E8%8D%89_(%E3%82%B2%E3%83%BC%E3%83%A0)) / [かまいたちの夜](https://ja.wikipedia.org/wiki/%E3%81%8B%E3%81%BE%E3%81%84%E3%81%9F%E3%81%A1%E3%81%AE%E5%A4%9C) / [428](https://ja.wikipedia.org/wiki/428%E3%80%9C%E5%B0%81%E9%8E%96%E3%81%95%E3%82%8C%E3%81%9F%E6%B8%8B%E8%B0%B7%E3%81%A7%E3%80%9C) / [ひぐらし](https://ja.wikipedia.org/wiki/%E3%81%B2%E3%81%90%E3%82%89%E3%81%97%E3%81%AE%E3%81%AA%E3%81%8F%E9%A0%83%E3%81%AB_) / [うみねこ EP4](https://ja.wikipedia.org/wiki/%E3%81%86%E3%81%BF%E3%81%AD%E3%81%93%E3%81%AE%E3%81%AA%E3%81%8F%E9%A0%83%E3%81%AB_episode4_-_Alliance_of_the_golden_witch)
11. [note：弟切草 33 年后回顾（文本显示行数的开发取舍）](https://note.com/nohdomi/n/n8fc4983131d0)
12. [4Gamer：かまいたちの夜 30 周年访谈（逐渐变暗的机制、效果音、剪影）](https://www.4gamer.net/games/999/G999903/20240410075/)
13. [Spike Chunsoft：かまいたちの夜×3 系统介绍](https://www.spike-chunsoft.co.jp/news/43257/) / [PlayStation.Blog：428 PS4 版](https://blog.ja.playstation.com/2018/08/24/20180824-428/) / [sangokusi：428 系统（TIP/JUMP/時間チャート）](https://sangokusi.syuriken.jp/428/system.html) / [4Gamer：428 iOS 版操作说明](https://www.4gamer.net/games/140/G014031/) / [4Gamer：428 访谈（教程与「文字上叠文字是禁忌」）](https://www.4gamer.net/games/094/G009484/20100122061/) / [inside-games：428 开发秘话](https://www.inside-games.jp/article/2008/12/29/32917.html)
14. [Famitsu：月姫リメイク 系统总整理](https://www.famitsu.com/news/202108/26231377.html) / [ponkotugamer 月姫リメイク感想](https://ponkotugamer.com/2021/tsukihimer1/) / [anbki 月姫リメイク感想](https://anbki.hatenablog.com/entry/2021/09/03/011627) / [inside-games：月姫リメイク 3 个理由](https://www.inside-games.jp/article/2021/09/20/134309.html)
15. [someiyoshino：テキストレイヤ UI 考察(1) 魔法使いの夜](https://someiyoshino.info/entry/20131012/1381545919) / [(4) シルバー事件・花と太陽と雨と](https://someiyoshino.info/entry/20131016/1381887762)
16. [snowstep：Fate 与 AYAKASHI 的表现技法（Fate 对文字排版的「无感」）](https://snowstep.hatenablog.com/entry/20100727/1280256356)
17. [Qiita：Steam 版ひぐらし字体替换与 init.txt 排版参数](https://qiita.com/Msak/items/9ac1b71e9625fdc3b89c) / [良藝館：ひぐらし奉 系统与操作](https://www.kmzwakr.net/g44.html)
18. [umineko-scripting docs/dialogue.txt（PS3 版文本渲染规格）](https://github.com/umineko-project/umineko-scripting/blob/master/docs/dialogue.txt) / [umineko-project 讨论 #10（msgwnd_ 与 nametag）](https://github.com/umineko-project/forum.umineko-project.org/discussions/10) / [うみねこ解析 wiki](https://w.atwiki.jp/herikutu/pages/91.html) / [うみねこはないているか（赤文字検証）](https://umineko.locker.jp/akaji_o.html)
19. [krkr2doc：文字を表示しよう（KAG 全屏/窗口/竖排、[l][r][p][cm]）](https://krkrz.github.io/krkr2doc/kag3doc/contents/Letter.html) / [未読/既読処理](https://krkrz.github.io/krkr2doc/kag3doc/contents/ReadUnread.html)
20. [TyranoScript CG/回想模式教学](https://tyrano.jp/usage/tech/cg) / [TyranoScript V4 发布笔记（既读管理/跳过/自动）](https://shikemokumk.hateblo.jp/entry/2015/12/03/130314) / [kopacurve：吉里吉里/KAG 名字与台词宏范例](https://kopacurve.blog.fc2.com/blog-entry-206.html) / [note：TyranoScript 全屏小说实作（窗口/字号/行间/字间/描边/backlog 宏）](https://note.com/mahiro_aihara/n/nab23ab093600)
21. [cactus_backyard：演出論的覚書 テキストの表示形態（字体/竖排/词典/翻页节奏）](http://cactus4554.blogspot.com/2011/10/blog-post_7377.html) / [garden at dawn：多重ウィンドウ、非全画面背景、全画面背景](https://gardenatdawn.blogspot.com/2016/01/layout.html) / [garden at dawn：鑑賞モードの諸形態（続）](https://gardenatdawn.blogspot.com/2014/08/viewer2.html)
22. [note：ノベルゲームのメッセージ枠デザインを考える](https://note.com/trdd/n/n0805bf08b09b) / [note：ぼっちのゲ制③ 全屏小说游戏画面考察](https://note.com/naikoutekibotti/n/nc19ab5a57f6f) / [テイビのノベルゲーム制作日記：字色と背景色とフォントの読みやすさ（问卷）](http://blog.livedoor.jp/tales_vivid/archives/30425162.html)
23. [Zenn：ノベル部分に欲しい最低限の機能まとめ（既读跳过/自动/日志）](https://zenn.dev/noranuko13/articles/6727f35ea38c17) / [novelsphere Simple UI 参考（速度上下限/功能开关）](https://developer.novelsphere.jp/doc/o2doc2/content/ref_o2ui.html) / [kibits 规格表（25 字×3 行等）](https://w.atwiki.jp/kibits/pages/26.html)
24. [HyperEZnovel：ゲームメイン画面（文本/名字窗 JSON 与 novel_mode）](https://hyperiyon.com/hypereznovel/docs/ui-template-game.html) / [タイトル画面](https://hyperiyon.com/hypereznovel/docs/ui-template-title.html)
25. [宴（Utage）：キャラクターの名前表示](https://madnesslabo.net/utage/?page_id=1943) / [コマンド一覧（UI 系命令）](https://madnesslabo.net/utage/?page_id=252)
26. [retouch 標準シナリオ書式（真の名前.台詞／表記名（真の名前）.台詞）](https://www.retouch.info/retouch/man00/scenarioFormat.html)
27. [cs2 エンジン CG リストテーブル](https://cs2.suki.jp/manual/data/setup/cglist.html) / [note：RPG Maker MZ 回想/CG 鉴赏插件](https://note.com/megaokie/n/ned7a3eafdcf7) / [GitHub：RPG Maker MZ NovelGameUI（日志/跳过/自动）](https://github.com/nz-prism/RPG-Maker-MZ/tree/master/NovelGameUI)
28. [towardstheendsky：NVL vs ADV](https://towardsthe-end-sky.blogspot.com/2022/10/nvl-vs-adv-anatomy-of-visual-novels.html) / [UI Design](https://forums.fuwanovel.moe/blogs/entry/4226-ui-design-%E2%80%93-an-anatomy-of-visual-novels/) / [Text Presentation](https://forums.fuwanovel.moe/blogs/entry/4377-text-presentation-%E2%80%93-an-anatomy-of-visual-novels/)
29. [VN Paths：ADV vs NVL](https://vnpaths.com/adv-vs-nvl/) / [VNDev Wiki：Graphical User Interface](https://vndev.wiki/Graphical_User_Interface) / [VNDev Wiki：Writing](https://www.vndevwiki.org/Writing)
30. [itch devlog：ADV or NVL? This is the problem!](https://onedaytodisappear.itch.io/one-day-to-disappear/devlog/148931/adv-or-nvl-this-is-the-problem) / [itch：Visual Novel Interface（action 斜体 vs 台词、名牌色）](https://creative-core-studio.itch.io/visual-novel-interface) / [itch：How can I design a good UI for my VN?!（NomnomNami 的 VN UI PDF）](https://nomnomnami.itch.io/how-can-i-design-a-good-ui-for-my-vn)
31. [Giant Bomb：Sound Novel (Franchise)](https://wiki-origin.giantbomb.com/wiki/Franchises/Sound_Novel) / [en.wikipedia：Banshee's Last Cry](https://en.wikipedia.org/wiki/Kamaitachi_no_Yoru) / [vndb：Chunsoft](https://vndb.org/p331) / [tsundokudiving：Talking games | Kamaitachi no Yoru](https://www.tsundokudiving.com/talking-games-kamaitachi-no-yoru/) / [Time Extension：Otogirisou 英译](https://www.timeextension.com/news/2024/03/32-years-on-spike-chunsofts-first-game-has-been-translated-into-english)

**西文 / Web / AI**
32. [GDC Vault：Designing Text UX for Effortless Reading](https://gdcvault.com/play/1025104/Designing-Text-UX-for-Effortless) / [gamedeveloper 报道](https://www.gamedeveloper.com/design/video-designing-text-ux-for-effortless-reading) / [gamedesign.gg 摘要](https://gamedesign.gg/watch/text-ux-effortless-reading/) / [Emily Short 听记线程](https://threadreaderapp.com/thread/986670130347364352.html) / [Kotaku：游戏字太小](https://kotaku.com/the-problems-with-illegible-text-in-video-games-and-som-1825018305)
33. [gamedeveloper：Sorcery! postmortem（纸片选项/move on/空段落）](https://www.gamedeveloper.com/business/postmortem-i-steve-jackson-s-sorcery-i-series-by-inkle) / [PocketGamer.biz：从平装书到触屏](https://www.pocketgamer.biz/the-making-of-sorcery/) / [Vice：80 Days 的 UI](https://www.vice.com/en/article/the-makers-of-mobile-hit-80-days-on-the-importance-of-amazing-ui-852/) / [videogametourism：Text is a visual medium](https://www.videogametourism.at/content/wordplay-text-visual-medium-interview-jon-ingold-0)
34. [Choice of Games：重要命令与技巧（*page_break、按钮 ≤5 词）](https://www.choiceofgames.com/make-your-own-games/important-choicescript-commands-and-techniques/) / [ChoiceScript wiki: Page break](https://choicescriptdev.fandom.com/wiki/Page_break) / [论坛：line_break 与分段](https://forum.choiceofgames.com/t/line-break-and-proper-cs-lineation/50213) / [论坛：术语与页面长度经验](https://forum.choiceofgames.com/t/some-terms-questions/109478) / [Introduction to ChoiceScript](https://www.choiceofgames.com/make-your-own-games/choicescript-intro/)
35. [intfiction：Story Format Pros & Cons](https://intfiction.org/t/story-format-pros-cons/45011) / [Chapbook Guide 首页](https://klembot.github.io/chapbook/guide/en/) / [Chapbook：Font Scaling](https://klembot.github.io/chapbook/guide/en/customization/font-scaling.html) / [Chapbook：Page Style](https://klembot.github.io/chapbook/guide/en/customization/page-style.html) / [Twine Cookbook：Chapbook](https://twinery.org/cookbook/css/storyformats/chapbook.html) / [markbessey：Hello, Chapbook](https://markbessey.blog/2023/10/07/twine-part-2-hello-chapbook/) / [Christy Tucker：Harlowe（默认对比 4.33:1）](https://christytuckerlearning.com/harlowe-story-format-for-twine/) / [intfiction：Harlowe 排版长文（ch/rem、字重、50–75 字符）](https://intfiction.org/t/harlowe-thinking-outside-the-box/61328)
36. [80.lv：Disco Elysium 的 UI（Kurvitz）](https://80.lv/articles/disco-elysium-working-on-ui-design) / [GameRant 转述](https://gamermatters.com/disco-elysiums-text-box-design-is-inspired-by-how-we-use-computers-and-twitter/) / [reading.supply 转述](https://reading.supply/@pageofswrds/kurvitzs-design-direction-G6dMF3) / [redlamp：Final Cut 三种显示模式与字号视场角](https://redlamp.org/work/disco-elysium/) / [EMNLP 2023：复现 DE 对话引擎的界面调整](https://dojoteef.com/papers/discoelysium_emnlp_2023.pdf) / [GDC 2023 论文](https://ubm-twvideo01.s3.amazonaws.com/o1/vault/gdc2023/GNR/Sandoval-Clark_GDCPaper.pdf)
37. [Gareth Damian Martin 关于 Citizen Sleeper UI 来源的公开说明（Destiny 2 / Shadowrun / In Other Waters）](https://couchsky.app/u/jumpovertheage.com/p/3ms6pxh3wl22s) / [gamedeveloper：Citizen Sleeper 与 TTRPG](https://www.gamedeveloper.com/business/how-citizen-sleeper-was-inspired-by-tabletop-rpgs-and-gig-work) / [点与思考访谈（本地化对 UI 的约束）](https://www.pointnthink.fr/en/interview-gareth-damian-martin-2/) / [Oreate：Citizen Sleeper 美术与 letterbox UI](https://findings.oreate.ai/hub/how-the-art-of-citizen-sleeper-redefines-the-cyberpunk-aesthetic)
38. [Roadwarden devlog：Taking A Fresh Look](https://assemble-entertainment.itch.io/roadwarden/devlog/133874/taking-a-fresh-look-roadwarden-devlog) / [The New Chapter（水平线/滚动/新字体）](https://assemble-entertainment.itch.io/roadwarden/devlog/113863/the-new-chapter-about-steam-demo-and-others-roadwarden-devlog) / [Improving The Basics](https://assemble-entertainment.itch.io/roadwarden/devlog/207234/improving-the-basics-roadwarden-devlog) / [Growing and Evolving](https://moralanxietystudio.medium.com/growing-and-evolving-roadwarden-devlog-f35a80b268e6) / [第三方设计分析](https://jay.mcgavren.com/2023/02/22/roadwarden-game-design-analysis.html)
39. [Failbetter：Redesigning the Story Page](https://www.failbettergames.com/news/redesigning-the-story-page) / [Fallen London 网站改版](https://www.failbettergames.com/news/fallen-london-website-redesign-now-live) / [官方论坛：storylets redesign 讨论（图标 vs 文字/锁定文案）](https://community.failbettergames.com/t/storylets-redesign/9282?page=2) / [Fallen London Wiki：Storylets（边框分级）](https://fallenlondon.wiki/wiki/Storylets) / [Template:Storylet](https://fallenlondon.wiki/wiki/Template:Storylet) / [Failbetter：Narrative Architecture（storylet 结构）](http://wiki.failbettergames.com/narrative-architecture)
40. [AI Dungeon Wiki：User interface](https://ai-dungeon.fandom.com/wiki/User_interface) / [NovelAI：Interface Settings](https://docs.novelai.net/en/text/usersettings/interface/) / [NovelAI：UI Parts](https://docs.novelai.net/en/scripting/ui-parts/) / [Brainy Papers：Designing Streaming UIs](https://brainy.ink/paper/designing-streaming-uis) / [Northbase：AI Input Best Practices](https://www.northbase.design/patterns/ai-input)
41. [Friends & Fables：Franz 2.0 patch notes（Working Context 抽屉）](https://fables.gg/patch-notes/franz-20-working-context-lore-improved-planning-and-more) / [How Franz works](https://fables.gg/blog/how-franz-works) / [与 ChatGPT/AI Dungeon/NovelAI 的差异](https://fables.gg/blog/how-is-friends-and-fables-different-from-chatgpt-ai-dungeon-or-novelai) / [Help：ACE 能看到什么](https://help.fables.gg/en/help/articles/4035786-what-game-state-can-ace-see-update)
42. [Reverie：小说模式（散文填满屏幕/无气泡/连续滚动/极简操作栏/玩家输入柔和标记）](https://reverie.im/zh/blog/introducing-novel-mode) / [Yumina：自定义 UI 指南（「小说排版」消息样子）](https://docs.yumina.io/zh/creator/advanced/custom-ui-deep) / [GWC（网页端全沉浸式 VN 风格 AI 聊天）](https://github.com/QiuSui1145/GWC) / [Slay the Princess 叙事设计深潜](https://www.gamedeveloper.com/design/deep-dive-player-centered-narrative-design-in-slay-the-princess) / [arimia 开发者访谈](https://arimiadev.com/developer-interview-slay-the-princess/)
43. [IFWiki：Infocom-type parser](https://www.ifwiki.org/Infocom-type_parser) / [TADS：The Parsing Sequence（commandPrompt 类型 0–4）](https://www.tads.org/t2doc/doc/prsseq.htm) / [intfiction：Promises that parsers can keep（提示符即预期）](https://intfiction.org/t/promises-that-parsers-can-keep/1197) / [intfiction：Set the player input（Inform 提示符可替换）](https://intfiction.org/t/set-the-player-input/62150)
44. [Screenplay 格式（Action/Cue/Dialogue/Parenthetical/V.O. 缩进规则）](https://www.simplyscripts.com/WR_format.html) / [Ensemble：Screenplay Format 完整指南](https://ensemblewriter.com/docs/screenplay-format) / [Oscars 示例 PDF](https://www.oscars.org/sites/oscars/files/scriptsample.pdf) / [en.wikipedia：Film script](https://en.wikipedia.org/wiki/Film_script) / [No Film School：Script Formatting](https://nofilmschool.com/screenplay-format)

**规范 / 排版 / 无障碍**
45. [W3C JLReq：日本語組版処理の要件（行長 52/40 字、行間、基本版面）](https://www.w3.org/2007/02/japanese-layout/docs/aligned/japanese-layout-requirements-ja.html) / [W3C JLReq 英文版](https://w3c.github.io/jlreq/index.html?lang=ja) / [JIS X 4051:2004](https://webdesk.jsa.or.jp/books/W11M0090/index/?bunsyo_id=JIS+X+4051%3A2004)
46. [モリサワ：組版の基本（行長と行間）](https://resources.morisawa.co.jp/uploads/tmg_block_page_image/file/5051/Mn_no171_a4_web.pdf) / [JEPA：日本語組版の常識を見直す（行長と字数の実務値）](https://www.jepa.or.jp/jepa_cms/wp-content/uploads/2025/02/8a9f1615bf023b2704663dd0932d7883.pdf) / [Adobe：Illustrator 文字組みの手引き](https://download.adobe.com/pub/adobe/jp/pdf/2607/Ai_Mojikumi_Guide_202607.pdf)
47. [MEUX：图文落地页阅读体验优化（行高 1.70、标点挤压、避头尾、眼动实验）](http://meux.baidu.com/articles/65) / [优设转载](https://www.uisdc.com/graphic-design-reading-experience) / [ZCOOL 阅文 YUX：中文排印（字距恒定/行长=字号整数倍/灰度均衡）](https://www.zcool.com.cn/article/ZMTE5NjYwOA==.html) / [极客文档：长文设计（17–46 字、最佳 23 字、行距 1.6）](https://geekdaxue.co/read/yoyo24777@vst2c1/69a858bd-4d28-4248-971c-465e331939b6)
48. [Butterick's Practical Typography：Line length](https://practicaltypography.com/line-length.html) / [Body text](https://practicaltypography.com/body-text.html) / [Typography in ten minutes 摘要](https://barnsworthburning.net/records/42854/typography-in-ten-minutes) / [vocab.design：Measure（Bringhurst 66 字符、ch 单位）](https://vocab.design/measure) / [EvanWill：估算理想文本宽度的方法](https://evanwill.github.io/_drafts/notes/text-body.html)
49. [W3C G18（4.5:1 与描边/halo 手段）](https://www.w3.org/WAI/WCAG22/Techniques/general/G18) / [G145（3:1）](https://www.w3.org/WAI/WCAG22/Techniques/general/G145) / [Understanding 1.4.3（F83 失败案例）](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) / [Understanding 1.4.6（7:1）](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html) / [Smashing：Accessible Text Over Images](https://www.smashingmagazine.com/2023/08/designing-accessible-text-over-images-part1/)
50. [CSS-Tricks：文字压图的最小遮罩不透明度（二分搜索、0.54 结论）](https://css-tricks.com/nailing-the-perfect-contrast-between-light-text-and-a-background-image/) / [gohud：読みやすさは測って決める（双背景测量、92%/82% 实测、vivid 成对令牌）](https://thruthesky.github.io/gohud/ja/theming-contrast.html) / [MDN：prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) / [web.dev：prefers-reduced-motion](https://web.dev/articles/prefers-reduced-motion)
51. [Motion Components：Typewriter（reduced-motion 下即时全文）](https://www.motion-components.dev/docs/recipes/typewriter-hero/) / [Quiet UI：Typewriter](https://next.quietui.org/docs/components/typewriter) / [use-typewriter-animation（ARIA live、虚拟化）](https://registry.npmjs.org/use-typewriter-animation) / [GSAP Vault：Typewriter Text](https://gsapvault.com/effects/typewriter-text)
52. [J-Compass：縦書き vs 横書き（JLReq §2.3.1、ruby 位置、writing-mode）](https://j-compass.com/docs/japanese-learning/writing-systems/mixed-script-and-furigana/vertical-horizontal-writing) / [Shojiku：Vertical writing（规格化竖排、縦中横、禁则、分页）](https://shojiku.pages.dev/reference/vertical_text) / [vertedit](https://github.com/k-rainfield/vertedit) / [tategaki-editor](https://github.com/cordx56/tategaki-editor)
53. [Suika3 DeepWiki：Text Rendering and Dialogue System（tategaki/kinsoku）](https://deepwiki.com/awemorris/suika3/5.2-text-rendering-and-dialogue-system)

**引擎文档（Web/NVL 实现）**
54. [Naninovel：Text Printers](https://naninovel.com/guide/text-printers.html) / [Configuration](https://naninovel.com/guide/configuration) / [Commands API](https://naninovel.com/api/) / [用户界面（中文）](https://nani.nanana.cn/zh/guide/user-interface) / [Engine Services](https://naninovel.com/guide/engine-services.html) / [Getting Started](https://naninovel.com/guide/getting-started)
55. [Monogatari：Dialogs](https://monogatari.io/v2/script-actions/dialogs) / [Text-Box](https://monogatari.io/v2/components/text-box) / [Characters](https://developers.monogatari.io/documentation/develop/building-blocks/characters) / [DeepWiki：Text Box & Dialog](https://deepwiki.com/Monogatari/Monogatari/3.3-text-box-and-dialog)
56. [Narraleaf：NVL Container](https://www.narraleaf.com/docs/narraleaf-react/player/nvl-container) / [RouteVN：Dialogue](https://routevn.com/en/creator/docs/line-actions/dialogue/)
57. [WebGAL：自定义 UI](https://docs.openwebgal.com/webgal-script/custom-ui.html) / [文本框模板参考](https://docs.openwebgal.com/template-reference/ui/textbox.html) / [applyStyle](https://docs.openwebgal.com/script-reference/commands/applyStyle.html) / [intro（全屏文字）](https://docs.openwebgal.com/script-reference/commands/intro.html) / [对话/黑屏文字](https://docs.openwebgal.com/webgal-script/dialogue) / [基础与 -notend/-concat](https://docs.openwebgal.com/webgal-script/base.html) / [文本拓展语法开发日志](https://www.openwebgal.com/zh-cn/blog/dev-note-5/) / [RFC2](https://www.openwebgal.com/zh-cn/blog/rfc2/) / [RFC4](https://www.openwebgal.com/zh-cn/blog/rfc4/) / [GitHub](https://github.com/OpenWebGAL/WebGAL)
58. [Visual Novel Maker：Custom Title-Screen 示例](https://asset.visualnovelmaker.com/help/Example__Custom_Title-Screen.htm) / [Ren'Py 动画主菜单教程（itch devlog）](https://itch.io/devlog/521670/carrots-super-cool-tutorial-for-making-a-snazzy-animated-menu-for-all-your-sweet-sweet-renpy-visual-novel-needs.amp) / [Wooster：Ren'Py 高级主菜单 UI](https://inside.wooster.edu/technology/advanced-game-user-interface-design-renpy/) / [【Ren'py】テキストウィンドウ、名前枠、フォントの変更](http://renpy.chocolatemintfudge.net/?eid=2)
59. [BookPublish：Typography and hierarchy](https://www.bookpublish.app/guides/fundamentals/typography-and-hierarchy/) / [Covers made of nothing but type](https://www.bookpublish.app/guides/cover-art/typographic-only-covers/) / [LLFs-FVNUIDP（免费 VN UI 模板集）](https://github.com/llfseik/LLFs-FVNUIDP)
60. [中国 AI 剧本杀界面设计报告（卷宗/纸纹/正文加粗标红/长文本滚动）](https://gitcode.csdn.net/69edb30554b52172bc701c14.html) / [百度秒哒：剧情向小游戏搭建指南（UI 设计哲学：插图是重心、UI 是画框、文本面板不超过屏高 25%、DOM 渲染文本）](https://cloud.baidu.com/doc/MIAODA/s/Pmpz55jdh)
