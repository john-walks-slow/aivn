# 260930 galgame UX 实证调研：真实日式 ADV 系统界面的设计规律

> 目的：为一个自研 galgame 播放器（AVG 引擎 + AI 生成剧情）提供「真的像 galgame」的界面重做依据。
> 方法：用 modlens 逐张精读 **29 张**不同的真实游戏截图（其中 18 张官方站小图先本地 LANCZOS 放大到 1200–1350px 宽再读），另用 5 张 3×3 联系表对 106 张候选图做分流筛选，辅以 PIL 对每张图精确取色（十六进制，取自画面 top10% / 中部 40% / 底部文本框 / 底栏 / 名字牌区 五个固定区域）。
> 品牌覆盖：柚子社（千恋＊万花）、Key（Summer Pockets / CLANNAD）、Type-Moon（Fate/stay night REMASTERED）、Frontwing（ATRI / The Fruit of Grisaia）、Akabeisoft2（コンチェルトノート / サノバウィッチ）。浅色日常系与深色幻想系都有覆盖。
> 重要限制（影响结论可信度，务必先读）：**本轮样本里「セーブ/ロード 槽位网格」「CGギャラリー 网格」「キャラクター紹介 网格」「バックログ 滚动列表」这四类没有拿到可信的一手截图**。它们的设计规律在本文件中是「基于同类引擎范式 + 部分间接证据」推出的，标注为 ⚠️推论，不能当作实测结论。

---

## 1. 样本清单

| # | 图名 | 作品 | 品牌 | 界面类型 | 图片 URL |
|---|---|---|---|---|---|
| 1 | system01 | コンチェルトノート | Akabeisoft2 | メッセージウィンドウ（剧情+更新通知） | `https://www.akabeesoft3.com/products/ap_concerto/img/system01.jpg` |
| 2 | system05 | コンチェルトノート | Akabeisoft2 | メッセージウィンドウ（含底部快捷条+右侧图标列） | `https://www.akabeesoft3.com/products/ap_concerto/img/system05.jpg` |
| 3 | system06 | コンチェルトノート | Akabeisoft2 | フローチャート叠加 ADV（带讲解编号） | `https://www.akabeesoft3.com/products/ap_concerto/img/system06.jpg` |
| 4 | system07 | コンチェルトノート | Akabeisoft2 | フローチャート节点局部 | `https://www.akabeesoft3.com/products/ap_concerto/img/system07.jpg` |
| 5 | system08 | コンチェルトノート | Akabeisoft2 | 確認ダイアログ（YES/NO） | `https://www.akabeesoft3.com/products/ap_concerto/img/system08.jpg` |
| 6 | system09 | コンチェルトノート | Akabeisoft2 | アイテム入手演出（暗场+居中插画） | `https://www.akabeesoft3.com/products/ap_concerto/img/system09.jpg` |
| 7 | system10 | コンチェルトノート | Akabeisoft2 | メッセージウィンドウ+右上流程图缩略图 | `https://www.akabeesoft3.com/products/ap_concerto/img/system10.jpg` |
| 8 | system11 | コンチェルトノート | Akabeisoft2 | フローチャート全屏（主菜单+达成率） | `https://www.akabeesoft3.com/products/ap_concerto/img/system11.jpg` |
| 9 | system12 | コンチェルトノート | Akabeisoft2 | フローチャート ノード情報ツールチップ | `https://www.akabeesoft3.com/products/ap_concerto/img/system12.jpg` |
| 10 | system14 | コンチェルトノート | Akabeisoft2 | 達成率詳細（仿 Win3D 浮雕弹窗） | `https://www.akabeesoft3.com/products/ap_concerto/img/system14.jpg` |
| 11 | system15 | コンチェルトノート | Akabeisoft2 | コンフィグ（完整设置页） | `https://www.akabeesoft3.com/products/ap_concerto/img/system15.jpg` |
| 12 | system16 | コンチェルトノート | Akabeisoft2 | 選択肢（choice） | `https://www.akabeesoft3.com/products/ap_concerto/img/system16.jpg` |
| 13 | system17 | コンチェルトノート | Akabeisoft2 | カレンダー（剧情内日期组件） | `https://www.akabeesoft3.com/products/ap_concerto/img/system17.jpg` |
| 14 | system19 | コンチェルトノート | Akabeisoft2 | ショートカット一覧（快捷键说明浮层） | `https://www.akabeesoft3.com/products/ap_concerto/img/system19.jpg` |
| 15 | system20 | コンチェルトノート | Akabeisoft2 | ウィンドウBEST風トップメニュー＋ドロップダウン | `https://www.akabeesoft3.com/products/ap_concerto/img/system20.jpg` |
| 16 | s_1144400_0 | 千恋＊万花 | 柚子社 | メッセージウィンドウ（章节+BGM 标签） | `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1144400/ss_b94f24118f044aafebf49421bc444d4a5df3db59.1920x1080.jpg` |
| 17 | s_1144400_4 | 千恋＊万花 | 柚子社 | メッセージウィンドウ（章节+缩略立绘） | `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1144400/ss_0b313863e1db6c181ddb8ac3953a748b5b508fde.1920x1080.jpg` |
| 18 | s_324160_7 | CLANNAD | Key | メッセージウィンドウ | `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/324160/ss_0e0606d6c0f736eb28f475ffad4ce47e23c4ec48.1920x1080.jpg` |
| 19 | s_324160_9 | CLANNAD | Key | クイックメニュー（右上弹出菜单面板） | `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/324160/ss_b4306a8b05177e0c42956123bbc6b353c01042e6.1920x1080.jpg` |
| 20 | s_324160_10 | CLANNAD | Key | 実績/ギャラリー 网格（成就） | `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/324160/ss_3edba975e26aa043a0ddf2cc1fe996c9c227509e.1920x1080.jpg` |
| 21 | s_345610_0 | The Fruit of Grisaia | Frontwing | タイトル画面 | `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/345610/ss_75d4a0462afcbeb5313f264cfc20fbf57fb40233.1920x1080.jpg` |
| 22 | s_345610_6 | The Fruit of Grisaia | Frontwing | メッセージウィンドウ（右侧竖排系统条） | `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/345610/ss_15d526c5ad9f7b2177a12bf3906355c4f1790488.1920x1080.jpg` |
| 23 | s_897220_5 | Summer Pockets | Key | メッセージウィンドウ（右侧双列系统按钮） | `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/897220/ss_d75ed429c7262deaeba074007683f5856451dfdc.1920x1080.jpg` |
| 24 | s_1230140_0 | ATRI -My Dear Moments- | Frontwing | タイトル画面 | `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1230140/ss_f9b78a7bbb22cf933a73877b58149aa61f2b1a48.1920x1080.jpg` |
| 25 | s_2458530_0 | サノバウィッチ | 柚子社 | イベント CG（无 UI，浅色） | `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2458530/ss_e7ae64718bab9b2efdd4bca2822aed69f4344917.1920x1080.jpg` |
| 26 | s_2458530_10 | サノバウィッチ | 柚子社 | イベント CG（无 UI，浅色） | `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2458530/ss_8bd80b71bcd06b8d84f873ed5e7522074fa54a0c.1920x1080.jpg` |

（表中 26 行为代表性样本；本轮实际逐张精读 29 张，另有 s_2458530_15、conc/system13、conc/m_system 等 3 张经确认无 UI 或仅为图例条带，未计入。Steam 原图 URL 可直接喂给 modlens；官方站图片为 250–500px 小图，须先放大再读，否则 OCR 会漏字。）

---

## 2. 分界面拆解

### 2.1 メッセージウィンドウ（消息窗口）—— 最重要的界面

**布局分区**（以 s_345610_6 / s_897220_5 / s_1144400_0 为基准）：

- 文本框：横向占满 100% 宽，高度约 22–30% 屏高，**贴屏幕底边**，左右各留 0–2% 边距。
- 系统按钮：两类布局并存
  - **右侧竖排图标列**（s_345610_6：`>> Skip / Auto / Next / Prev / Q.Save / Q.Load`；コンチェルトノート右侧 `X / AUTO / SKIP / MENU`），紧贴右缘，垂直居中偏下。
  - **底部一整条文字导航**（コンチェルトノート：`SAVE / LOAD / CONFIG / LOG / FLOWCHART`，斜杠分隔）。
  - Summer Pockets（s_897220_5）最极端：右下角**双列纯文字按钮** `CLOSE VOICE LOG LOCK` / `Q.SAVE Q.LOAD SAVE LOAD BACK AUTO SKIP TITLE QUIT CONFIG RECORD LOCK`——**全英文、全大写、无边框、无底色**。
- 名字牌：位于文本框上边缘之上或之上偏左，**压在框体顶部**。
- 附加信息条：柚子社在左下放 Q 版缩略立绘 + 章节号 `CHAPTER 1-1`（左下角） + 左上放 BGM 名 `♪ 花鳥風月` + 右上放回看入口。

**控件视觉处理**（读到原文）：

- 文本框**几乎都是半透明深色/主题色底 + 细装饰边**。Frontwing Grisaia 用 `#475B74`~`#070A1A` 的深蓝黑半透明，框内有**金色卷草纹（filigree scrollwork）**花边；Summer Pockets 用**青绿渐变** `#31898B`~`#75C2BC`；柚子社千恋＊万花用**暗红梅色** `#804352`（不透明）配和风几何纹样。
- 名字牌**不是贴在框上的色块，而是浮在框左上角/正上方的独立铭牌**：柚子社把 `【ムラサメ】` 放在文本框上沿的渐变横幅里，字带**深红底 `#412A30` 描边**；CLANNAD 的 `Tomoyo` 是独立圆角铭牌，浅底 + 深字。
- 正文**是衬线/明朝体观感**（Key、柚子社、Frontwing 一致），不是 web 的无衬线；行距宽松，段间距明显。
- **背景几乎都不做整体压暗**，只靠文本框本身的半透明与背景拉开层次——这是 galgame 与多数 web 后台最大的观感差之一。

**交互反馈**：右侧/底部按钮**默认无边框无底色**，靠文字本身（常带轻微投影/浮雕）浮在画面上；focus 时才点亮（如确认框的 `YES` 高亮为青蓝辉光、`NO` 为白字）。

### 2.2 クイックメニュー / 快捷菜单弹层

两种范式并存：

- **面板式弹层**（CLANNAD s_324160_9）：右上角一块**米色/橙调圆角矩形面板**（底 `#E9E9E1`~`#E5E1D8`），菜单项纵向排列：`No menu transition delay / Auto Mode / Settings / Skip previously read text / Close window / Save / Load / Return to previous choice / Dangopedia / Configuration / Return to title screen / Close game / Cancel`。**每项是一个独立的浅橙圆角按钮**，面板整体不遮盖剧情，只压住右上角。
- **原生窗口菜单式**（コンチェルトノート system20）：经典 Windows/BGI 顶部菜单栏 `画面(S) 進行制御(M) 文字表示(C) ヘルプ(H)`，下拉出 `バックログ(F8) / オート(F6) / スキップ(F7) / 次の選択肢へ進む(N) / 前の選択肢に戻る(B) / オプション(F3) / フローチャート(F12)`。**带 mnemonics 括号下划线快捷键标注**是这一系的签名。

### 2.3 コンフィグ（设置）

- **单页多分区，不分 tab**。コンチェルトノート system15 是一整页（蓝青半透明面板，水/天使主题背景），纵向排布大量设置项，底部一个全局 `CONFIG` 导航条（`LOAD / FLOWCHART / CONFIG / EXTRA`），左下有 `ショートカットの一覧 / ゲームに戻る / タイトルに戻る / ゲームの終了 / 設定の初期化`。
- 设置项呈**文字行 + 滑杆(MIN..MAX) 或 文字行 + ON/OFF 切换 或 文字行 + LOW/HI** 形态，并带**每个角色独立的音量条**（列出 `神凪莉都 / 今里和奏 / 東条白雪 / 名凪星華 / 夕月小夜璃 / タマ`）。开关项原文例：`画面モード フルスクリーン/ウィンドウ`、`セーブ時の確認メッセージ ON/OFF`、`メッセージウィンドウの不透明度`、`ロード時の確認メッセージ ON/OFF`、`クリックでボイスをスキップ ON/OFF`、`未読文章のスキップ ON/OFF`、`フローチャート更新メッセージの表示 ON/OFF`、`フローチャート遷移時ミニマップの表示 ON/OFF`。
- **滑杆不用 web 的圆角 track，而是「MIN——●——MAX」式的细横条**，当前值高亮。
- 文字分区标签用 `-general` / `音` / `テキスト` 这类极简前缀/后缀，而不是侧边导航。

### 2.4 セーブ/ロード（存读档）

- ⚠️ **本轮未拿到可信一手截图**。可靠事实是：存在**快捷键浮层 `ショートカット一覧`**（system19），列 `F4:セーブを開く。/ F5:ロードを開く。/ Shift+S:クイックセーブ / Shift+L:クイックロード`，以及 `セーブ時の確認メッセージ / ロード時の確認メッセージ` 两个确认开关——说明存读档是**独立全屏页 + 独立的确认弹窗**两层结构，而非嵌在设置里。
- ⚠️ 推论：槽位网格采用「缩略图 + 空槽斜线占位 + 页码切换」的标准 BGI/Ethornell 做法。

### 2.5 バックログ（回想）

- ⚠️ 未拿到一手截图。可确认的入口是：系统底部导航固定有 `LOG`/`履歴`，且有独立快捷键 `F8:履歴の表示。` 与 `F7:既読のみスキップ。`（只跳已读）。Summer Pockets 右下有 `LOG` 按钮，Grisaia 右侧竖排无 LOG 但有 `>>` 回卷与 `Prev/Next` 页导航。

### 2.6 フローチャート（流程图）

这是本轮读得最细、也最有参考价值的一类（コンチェルトノート）：

- 全屏。**中央是分支树**：节点是**扁圆角矩形块**，用直角折线连接。未到达=`淡青蓝填充`，当前位置=`亮青绿/青蓝高亮块`，已通过并可跳转=另一种色。**颜色是唯一的状态编码手段**。
- 节点旁用**白色括号编号** `（1）` `（2）` 标注教学序号；当前窗口显示的节点在右上显示**通し番号**（如 `023`）。
- 点击节点弹**详情工具提示**（system12）：`023 / 5月20日 火曜日 / さっさと寝る……はずが。 / 秘蔵の桃色桃源郷を勝手に見るなちんちくりん！`，未通过时红色提示 `※このシナリオを通過してクリアしていないためジャンプできません`。
- **右上角常驻一张全局缩略地图（ミニマップ）**，可在 config 里开关。缩放用左侧竖向弧形量表 + 箭头按钮 + Q 版小人标记。
- 底部/侧边有 `達成率：38%` 与一个 `達成率詳細` 弹窗（system14）——**仿 Windows 3D 浮雕窗口**（蓝白渐变标题栏 + 右上角 `×` 关闭），白底黑字列表：`種別：達成率 / フロー：39.2% / 接続：36.9% / 合計：38.0%`。
- 主菜单在这个画面里直接可见：`START / LOAD / FLOWCHART / CONFIG / EXTRA / EXIT`（左侧竖排）。

### 2.7 タイトル画面（标题画面）

- **LOGO 居中偏上，是画面绝对主角**；菜单项在 LOGO 下方**水平居中纵向排列**。
- Grisaia（s_345610_0）：`From the Beginning / Continue / Configuration / Extras / Quit Game`——**深蓝衬线字 + 轻微投影/浮雕，无边框无底色**；背景是**水彩/墨迹/树影 + 米白画布**（`#FFFFFF`/`#F3F3F3` 系 + 顶部大面积留白）。
- ATRI（s_1230140_0）：LOGO 在**左上**（含假名注音 `アトリ`），菜单 `CONTINUE / START / LOAD / SYSTEM / EXTRA / INFORMATION / EXIT` **左对齐竖排**，纯文字无底板；背景是明亮海边废墟实景。底部右侧版权。
- 共同点：菜单**永远是纯文字**，不画成按钮/胶囊/卡片；**没有一个用图标**。

### 2.8 選擇肢（選択肢）

system16：三条**半透明深蓝横向按钮**竖向堆叠压在剧情上：`莉都の部屋に行ってみる / 下に降りる / ……別にいいか`。选中态用**更亮的蓝/白字**表示。周围剧情照常运行、不暂停。

### 2.9 確認ダイアログ（确认弹窗）

system08：深蓝灰面板，**有细密几何/电路纹理**做底纹，正文三行居中偏左，**一条细双横线**把正文与按钮分隔，底部 `YES`（高亮青蓝辉光=焦点）/ `NO`（白字）。这是唯一一次见到「明确焦点高亮」。

### 2.10 アイテム入手演出 / 剧情内组件

- system09：屏幕**全黑遮罩**，中央放一张获取物品的插画（青色工具组），底部照常有消息框与 `SAVE/LOAD/CONFIG/LOG/FLOWCHART`。**空的名字牌带（ribbon）悬在框上方**。
- system17：**剧情内日历组件**——`5 MAY` 月份标题 + `SUN..SAT` 星期表 + 7×5 日期格，**已过日期用红色 `X` 划掉**。这是「叙事时间」的可视化，不是设置。

### 2.11 快捷键说明浮层

system19：半透明青色**横向通栏浮层**，双栏排布热键说明（`F1:ショートカット一覧を表示。/ F2:画面モードの切り替え。/ F3:コンフィグを開く。/ F4:セーブを開く。/ F5:ロードを開く。/ F6:オートモードを実行。/ F7:既読のみスキップ。/ F8:履歴の表示。/ F12:フローチャートを開く。/ Ctrl:全てスキップ / スペース:ウィンドウの表示切り替え。/ Shift+S / Shift+L`）。**关键键用加粗/换色强调**。

### 2.12 ギャラリー/実績 网格

CLANNAD s_324160_10（Steam 成就页，可作为网格范式参考）：**暖米色纸质底 + 顶部/底部橙粉横带**，3 行**圆角矩形**格子；已解锁=实景缩略图+LOGO，未解锁=**灰色问号块**；底部有 `☑ ENABLE ACHIEVEMENTS NOTIFICATIONS / LOCAL / EXIT`。⚠️ 这是 Steam 成就页而非游戏内 CG ギャラリー，仅参考其「圆角格 + 未解锁占位」结构。

---

## 3. 跨作品规律（行业通用 vs 签名做法）

**几乎每款都有（可直接当规范用）：**

1. **消息框永远贴底、永远半透明、永远有主题色**，背景不整体压暗。
2. **名字牌是浮在框上方的独立铭牌**，不是框内的一个色块；字号明显小于正文但有描边/底色保证可读。
3. **系统操作入口集中在右下角或右缘**，且**以纯文字为主、无边框、无圆角胶囊**；常用 `AUTO / SKIP / LOG / SAVE / LOAD / CONFIG` 这套固定词表。
4. **标题画面菜单 = 纯文字竖排**（居中或左对齐），没有图标化。
5. **有一个全屏系统主菜单**收纳 SAVE/LOAD/CONFIG/LOG/FLOWCHART/EXTRA/EXIT。
6. **热键体系完备**（F1–F12 + Shift 组合 + Ctrl 临时快进），并在游戏内提供热键一览浮层。
7. **正文字体是明朝/衬线体**，标题/LOGO 是手写或装饰字体，正文与 UI 字体分工明确。

**某家的签名做法：**

- **コンチェルトノート（Akabeisoft2）**：最激进的「信息密度」派——剧情里常驻全局流程图缩略地图、成就率百分比、剧情内日历、热键浮层、数字加大的节点通し番号。是「攻略型」UI 的极端。
- **柚子社**：和风纹样（几何・青海波・樱花）做文本框边框装饰；章节号 + BGM 名 + Q 版缩略立绘常驻左下；名字带 `【】` 括号。
- **Key（CLANNAD/Summer Pockets）**：圆角铭牌 + 明亮浅色调 + 网格/书架式画廊；Summer Pockets 甚至把系统按钮做成双列纯英文大写字。
- **Frontwing**：Grisaia 用深蓝 + 金色 filigree 花边（偏古典欧风）；ATRI 则极简左对齐纯文字。
- **Type-Moon**：本轮只拿到纯 CG，**未拿到其系统界面截图**，故不对其 UI 下结论。

---

## 4. 浅色日常系 vs 深色幻想系

| 维度 | 浅色日常系 | 深色幻想系 |
|---|---|---|
| 代表 | Grisaia 标题、ATRI 标题、CLANNAD 浅色段、柚子社サノバ | 千恋＊万花消息框、Grisaia 剧情、CLANNAD 菜单、Fate CG |
| 背景 | 米白/水彩/阳光实景，大面积 `#FFFFFF`~`#F3F3F3` | 夜景/深紫 `#1A0C25`、深蓝 `#040C19`、暗梅 `#804352` |
| 文本框 | 半透明**青绿/天蓝渐变**（Summer Pockets `#31898B`~`#75C2BC`）或**近白浅底深字** | 半透明**深蓝黑/深红**（`#475B74`~`#070A1A` / `#804352`） |
| 名字牌 | 浅底 + 深色字，描边柔和 | 深底 + 亮色字（`#412A30` 底 + 亮字） |
| 强调色 | 单一冷色或暖色低饱和，克制 | 高饱和主题色（金 `#ED7A6F`、青蓝） |
| 装饰密度 | 低，靠留白与渐变 | 中高，靠卷草纹/几何纹/和风边框 |
| 对比策略 | **文字压深色块**、控件弱化成文字 | **深底 + 亮字**、控件用发光/浮雕 |

结论：**「浅色系」不等于「白底 UI」**——即使整体明亮，消息框仍是深色半透明块，正文仍是衬线体。目标产品当前「白底 + 系统字体 + 卡片」的观感，在两系里都找不到对应物。

---

## 5. "不像 web ui" 的具体判据

从样本归纳，以下每一条都能直接区分 galgame 感与 web 后台感：

1. **控件形态**：web 用「圆角矩形 + 底色 + 1px 描边 + hover 变深」；galgame 用**纯文字 + 投影/浮雕**，或**带纹样的不规则边框**。几乎不出现 web 那种胶囊按钮。
2. **元素排列**：web 是「顶部导航栏 + 侧边栏 + 卡片网格」；galgame 是**底部消息条 + 右缘竖排图标 + 弹层**。没有常驻侧边栏。
3. **留白节奏**：web 靠 padding 均匀铺开；galgame 靠**大面积空背景 + 贴边一条**——元素不居中堆叠，而是压边。
4. **字体**：web 默认无衬线（Inter/Roboto/系统 UI 字体）；galgame 正文是**明朝/衬线**，标题是**装饰体**。这是最刺眼的差别。
5. **图标使用**：web 用线性图标库（lucide 等）表达功能；galgame **几乎不用图标**，直接写 `AUTO` `SKIP` `LOG`。
6. **交互反馈**：web 用即时 hover/active 变色；galgame 用**焦点高亮**（默认全灰，焦点项发光/变亮），且常配确认弹窗。
7. **容器感**：web 面板是圆角+阴影的「卡片」；galgame 面板是**带纹样/渐变/边饰的「和纸/卷轴/水晶」**。
8. **信息组织**：web 是 tab 切换；galgame 是**全屏主菜单 + 底部一条快捷入口**，config 是单页长列表。

---

## 6. 给实现的建议清单（可直接转设计令牌）

1. 消息框改为**贴底通栏、半透明深色（带主题色与轻微纹样）**，去掉白底卡片感。
2. 正文改用**衬线/明朝体**，UI 标签用无衬线但**不加圆角胶囊**。
3. 名字牌做成**浮在消息框上边缘的独立铭牌**，带描边/底色，字号小于正文。
4. 系统入口收敛为**底部一排文字按钮 + 右缘竖排小图标**，全部去边框去底色。
5. 标题画面菜单做**纯文字竖排**（居中或左对齐），不放图标、不加边框。
6. 背景**不做整体压暗**，靠文本框半透明制造层次。
7. 建立**焦点态**而非 hover 态：默认弱化，焦点项发光/变亮，并配确认弹窗。
8. 配置页做**单页长列表**（文字行+滑杆/ON-OFF），不切 tab；滑杆用「MIN—●—MAX」细条样式。
9. 流程图/路线图用**圆角矩形节点 + 直角连线**，用**颜色区分未达/已达/当前位置**，节点旁标编号。
10. 保留一个**全屏系统主菜单**收纳 SAVE/LOAD/CONFIG/LOG/ROUTE/EXTRA/EXIT。
11. 补一套**热键体系**并在游戏内提供热键一览浮层。
12. 引入**主题色 + 纹样**（和风几何/卷草纹/渐变）作为消息框与面板装饰，这是 galgame 感的关键点缀。

---

## 7. 未覆盖 / 后续可补

- セーブ/ロード 槽位网格、CGギャラリー 网格、キャラクター紹介/立ち絵鑑賞、BGM/ボイス選択：需补一手截图（建议找 and age、Type-Moon、Honey∞Parade 等作品官网的系统页，或用 Camoufox 带登录抓 getchu 样本图）。
- 動效（打字机、淡入淡出、翻页转场）本轮全为静态截图，未覆盖，建议后续补 GIF/视频帧。
