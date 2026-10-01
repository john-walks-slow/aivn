# 261002 UX 打磨（worktree dev 走查七条）

## 来源

用户在 worktree dev 实例上走查后给的七条意见，逐条落地。

## 逐条设计

### 1 去掉那圈黑边框

现状：`.screen, .stage-shell` 有一条 `border: 1px solid var(--frame-line)`（近黑），但真正
读成「一圈黑边」的不是它——是「视觉 2.0」把界面缩成 16:9 窗口之后，`#root` 内缩、
四周露出 `body` 的深胡桃底（`--frame: #2a2521`，宽屏约 19px 宽的一圈），再加窗口自己的
投影。窄屏（≤820px）本来就是满铺，所以只有宽屏看得见。

做法：整层画框删掉，而不是只删那 1px 描边——`--frame` / `--frame-pad` /
`--frame-radius` 三个令牌连同 `#root` 的内缩、窗口的 16:9 上限与投影一起走，界面铺满
视口。深色不再是画框的颜色，只留在该深的地方（舞台衬底、消息窗）。

### 2 剧的封面

现状（先答问题）：封面**没有任何设置入口**，工坊和用户都改不了。两处消费者各自
现算：

- `LibraryView.coverOf`：`assets/backgrounds[0]`，没有则 `assets/cg[0]`
- `TitleView.titleArt`：只有 `assets/backgrounds[0]`，没有 CG 回落

也就是「碰巧排在第一张的那张图」，且剧目库与标题画面两条规则还不一样。

做法：`play.json` 加 `cover?: { kind: "backgrounds" | "cg"; id: string }`，指向剧目里
**已有**的一张图——复用现成的背景或插图，不新增一份文件。没设时保留原回落
（先背景后插图），两条消费者共用同一个解析函数。设置入口放在工坊「设定与记忆」的
「剧目」卡里（剧目字段的所在地）：列出本剧目的背景与插图，点一张即设为封面，可清空。
工坊那侧由系统提示词告知：play.json 的 `cover` 就是封面，它可以直接写。

### 3 导入界面的 tab

现状：`LibraryBrowser` 一律渲染五个分类 tab（全部/背景/插图/角色/音乐/音效），外加一个
可选的 `filter`。于是：

- 主角卡入口传 `filter = meta.character.protagonist`，但 tab 仍在——切到「音乐」会
  出现一张空网格，而不是「这里只列角色」
- 角色卡入口（`libraryInto = <角色id>`）什么 filter 都不传，于是它是个**素材**浏览器，
  在这里导一张背景进角色卡
- 素材页的 tab 里有「角色」，导进去的却是角色卡（落点不对）

做法：给组件一个明确的 `only` 语义。

- `only="characters"`：不渲染 tab，请求锁 `kind=characters`，只列角色
- 素材页：tab 里去掉「角色」

角色卡与主角卡两个入口都传 `only="characters"`，**都不再传 `filter`**——主角卡照样能
导入库里的任意角色，主角与配角的差别只在于导入时要不要带走立绘与音色（服务端
`assetImport` 按 target 裁，本来就是这么做的），用户不该被列表先筛一遍。

### 4 侧栏返回图标改退出

`.side-exit` 用的是 `Icon name="back"`（ArrowLeft），但它的动作是**离开这场戏回剧目库**，
不是「上一层」。加 `exit: LogOut` 进图标 registry 并换用它。标题画面底部那个
「← 剧目库」同样是回剧目库，但它是带文字的按钮、语义已经写明，不动。

### 5 premise / craft 默认空

现状：`createEmpty` 落盘两份带正文的模板——`PREMISE_TEMPLATE`（写作引导）与
`DEFAULT_CRAFT`（四条风格准则）。两份都被当正文注入：premise 那份模板直接进了剧作家
A 区的「剧目设定」，还让就绪门误判「故事前提已就绪」。

做法：

- `createEmpty` 两份都写空文件（卡还要在列表里，所以文件留着）。
- `DEFAULT_CRAFT` 里那四条**风格准则**是必要让剧作家知道的，移进 `buildSystemPrompt`
  的内置段（与引擎契约同层，用户改不坏）。craft.md 此后是纯用户/工坊内容。
- premise 的写作引导是给用户看的，移进「世界与人物设定」编辑框的 placeholder。

### 6 删冗余描述与 hint

按用户点名的口径扫一遍面向 end user 的文案：讲实现路径（落哪个目录、哪个字段名、
哪张表）的一律删，留「做什么」和「不做什么会怎样」。

### 7 crafter 会话 e2e

对话页的会话层：新建 / 切换 / 归档 / 删除。走一遍真实 WS 通路。
