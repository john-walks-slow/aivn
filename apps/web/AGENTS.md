# apps/web AGENTS.md

## 职责

- `apps/web` —— 舞台演出层（P2/P3 已落地）：React 19 + vite；hash 路由（`src/router.tsx`）+ REST 客户端（`src/api.ts`，ttsPreview/polish）。

## 地图与界面约定

- `src/stage/generatedAssets.ts`（生成资产台账 + 预解码，到货才淡入）。
- `src/views/`（剧目库/Title 就绪门含「有周目则「继续（档名）」在前 / 开始新周目」/周目页 SavesView `enter/重命名/删除`/舞台外壳 StageScreen：持连接与作品集状态，视图选择是 `useState` 初始值 —— URL 上的 `?view=`/`?tab=`/`?workshop=1` 走 `stage/view.ts` 的纯函数解析）。
- **封面是 play.json 的 `cover: {kind, id}`（只认 backgrounds/cg），没有设置入口就自动取第一张背景、其次第一张插图，解析只有 `api.ts` 的 `coverUrl` 一处（剧目库与标题画面共用，指向的图被删了自动回落）；设置入口在工坊「剧目」页的封面选图里，点一张即设、可恢复自动挑选**。
- `src/ui/Icon.tsx`（lucide 图标 registry，全站交互 chrome 统一走它，`btn-icon` 图标+文字行内排；舞台侧栏底栏「退出」的出口用 `exit`（LogOut）而不是 `back`）。
- **界面铺满视口、没有画框**（`app.css` 里 `--frame`/`--frame-pad` 那层「桌面上的 16:9 窗口」已整层删掉：宽屏四周露出的深色底读起来就是一圈黑边）。
- `src/voice/`（VoiceLibrary 全屏音色库面板——**筛选全部走服务端窗口查询**：语言下拉（首项「全部语言」，默认跟随 `navigator.language`，各语言不摆计数——每个语言是各自独立的 1000 条窗口、与热门目录不同源）+ 数据驱动的高频标签 chips（多选 = Fish 的并集语义、标签原样大小写；剔除 Japanese/English 这类与语言重名的标签）+ 搜索框（300ms 防抖，走**全库标题搜索**，不再匹配描述与标签）+ 卡片网格逐个试听/选用 + 右上角固定「×」关闭键、分页 60 条防 1000 张图卡顿；useVoiceCatalog 是两层状态：`catalog` 基础目录管下拉与 `nameOf`、`result` 当前窗口管网格，查询带序号防慢响应覆盖新结果，筛选失败不回落热门目录、目录外 voiceId 按 id 解析）。窗口语义见 `apps/server/AGENTS.md`。
- `src/workshop/`：
  - WorkshopPane 八 tab 对话/剧目/角色/记忆/素材/文件/Agent/设置（`stage/view.ts` 的 `WorkshopTab` 是顺序唯一真相源：**剧目**在最前——它改的是剧目本身；**角色/记忆**紧跟其后——改的是剧目的成员与内容；其余是素材与机器设置）。
  - AgentPane 单剧目 agent 设置（剧作家/搭台助手各一张卡：模型下拉走 `GET /api/agents/models`（网关清单 ∩ 设置页「支持的模型」清单；读不到就显式报错，不静默退化成默认；清单外的旧值补一项「不在支持清单里」显示，不静默改写 play.json）、思考档位、按 `groupLabel` 分组的**能力开关**（数据源 `GET /api/agents/capabilities`，一行 = 名字 + 一句后果，`locked` 的渲染成灰字「始终开启」不给开关，`available: false` 的行尾补 `unavailableNote`；界面上不出现任何工具 id）；搭台助手那张卡还有**出图审批**（`ask` 默认 / `auto`）；保存即写 play.json 的 `agents` 段）。
  - PlayPane 剧目页（标题 / opening / `scriptLanguage` 剧本语言 / `voiceLanguage` 语音语言 / 无名角色音色 / 逐剧目生图 `image.model` + `image.size` / 封面选图 / **写作参数**（`craft` 的六个下拉）；只写 `play.json` 一份，是唯一写剧目字段的页。六个下拉的第一项恒为「默认」，选中即把那个字段从文件里删掉——`editCraft` 是同一条规矩的唯一入口，`setImage` 同理（两个生图字段都留空就把整个 `image` 段删掉））。
  - CharacterPane 角色页（`detail.cast` 就是全部角色卡，主角只是 id 固定 `protagonist` 的那张：同一个 CharacterEditor、同样能上台/有音色/能从资源库导入，只是不给删；**「新建角色」先收一个用户指定的 id**（规则与剧目 id 同：`[\w-]+`，重名/非法就地报错，不自动取 `charN`）；**立绘的目录绑定在这一页**（名字上面那一行 `.sprite-bind`：下拉候选 = 剧目里现有的 `assets/sprites/*` ∪ 当前绑定值，选中写进卡的 `sprite`，选「与角色同名」= 摘掉那一格；被别的角色用着的目录在选项里标名字），**但图片本身仍归素材页**——CharacterEditor 只有名字 / persona / 音色三格，差分与上传都在素材页。保存只写 `characters/<id>.md`，这一页一个字节都不碰 `play.json`）。**每张卡带它立绘目录的缩略图（中立差分优先，没图才落回图标；目录走 core 的 `spriteIdOf` 而非 id），角色卡面板的标题行有「打开立绘」：切到素材页并把那个**立绘目录**排到立绘段最前（没有该目录时把目录名填进「新立绘」那一行）——人格在这页、图在素材页，但不能让人自己记着图在哪儿**。
  - MemoryPane 记忆页（只列 `memory/**` 的卡片，`arcs/`+`archive/` 不列；常驻设定在前、设定卡在后。craft.md 的占位符只提文风与禁忌，「节奏与素材来源」指向剧目页）。
  - SettingsScreen 服务端设置页（`#/settings`，剧目库页右上「⚙ 设置」进：模型网关 / 长会话与压缩 / 生图 / 语音 / 联网检索 / 访问密码 / 局域网访问 / 界面主题，外加启动参数只读回显。**保存即落盘 `<数据目录>/settings.json` 并立即生效**，没有「重启后生效」这一步；单把凭据（API Key / 生图 Key / 访问密码）把掩码**填进输入框**——原样回传 = 不改、清空 = 显式清除，多把 key（语音 / 检索）输入框恒空、留空 = 不改。保存/放弃按钮常驻在滚动区之外（`.settings-footer`），滚多深都在。「局域网访问」那一组是开关（写 `lanAccess`）+ 手机该连的地址（只读 `bootstrap.lanUrls`，逐条可复制）+ 「允许局域网访问（Windows 防火墙）」按钮（`POST /api/lan/open-firewall`，只在装好的 Windows 版里可用）。
  - WorkshopSettings（演出侧两个开关）。
  - useWorkshop 状态机（助手一轮的内容是 `WorkshopPart[]`：流式期间在 `state.live`，收束后取 `message.parts`，同一个渲染器读两种来源；`workshop_asset` 带 `toolCallId` 时挂到对应那次调用上，否则留 `message.images`）。
  - TurnParts 助手一轮的段落渲染器（按 parts 顺序铺正文气泡 / 「思考」可折叠行 / 工具行；`TOOL_LABEL` 与参数摘要收在这里）。行的展开态默认由「是否流式中、这次调用有没有素材」决定，用户点过之后记进组件本地的 toggled。
  - AssetStrip 素材条（工具行里显示这次调用产出的图，WorkshopPane 与工具行共用）。
  - FileBrowser 剧目文件树/编辑器/预览。
  - AssetsPanel 素材库（**立绘段在最前**，其后是背景/CG/音效/BGM；角色卡不在这里，归「角色」页：「音色：…」开全屏音色库面板 + 试听，素材行带描述副标题。立绘段一个目录一张 `.sprite-card`——`assets/sprites/<id>/` 里的文件即差分，名牌 / 取景 / 体量 / 锚点四个声明留空＝不声明、落回引擎缺省，写走 `PUT /api/plays/:id/assets/sprite`，逐差分行只给取景覆盖与「重新生成」「删除」，目录级能上传差分 / 出图，段头「生成新立绘」+ 新 id 一行建目录；**标题写引擎真正在用的名字（按 `spriteIdOf` 的绑定反查卡 name → 名牌 → id），名字与 id 不同才把 id 并排带上，没卡就标一句「只有立绘」；目录名与某张卡的 id 同名、而那张卡绑去了别处时补一句「角色 X 的立绘绑的是 Y」，否则用户看到的就是「卡在、图也在，怎么就是绑不上」——不要写「没有同名角色卡」，那是内部诊断，用户刚导进来的角色看到这句只会以为导入失败了**；`focus` 点名的主体排在段首（滚不动：卡片高度随图解码陆续长出来，滚动位置会被顶回去）。**到货刷新走 `subscribeAssetReady`**（助手/舞台那边的导入与后台出图，不是自己发起的也要跟上）。
  - **手动生图**（`ImageGenDialog` 是素材页 backgrounds/cg 的「✨ 生成」与立绘段的「生成新立绘」/差分行「重新生成」共用的那个对话框：`kind` 决定出哪些字段；sprite 分支给立绘 id（留空＝新建，id 只在新建时可改）、差分名（`fixedVariant` 时锁死）、取景与体量两个下拉，提交的就是 `spriteId`/`variant`/`framing`/`stature`/`title`。发起后 REST 立刻返回、对话框停在「生成中」，完成经 WS `image_result` 按 `target` 匹配亮图。`ui/RefCharacterPicker.tsx` 是有序多选的角色立绘 chip，序号即提示词里的「第几张」；`src/stage/cgOptions.ts` 是勾选序与提交门槛的纯函数）。
  - LibraryBrowser 资源库浏览面板（防抖搜索 + 网格卡 + 图片灯箱/音频试听 + 导入/覆盖态 + `target`，素材页与角色/主角卡入口共用一个组件；分类 tab 是背景/插图/**立绘**/音乐/音效，**没有「角色」**——角色卡不是素材，只能从角色页进；角色/主角卡入口传 `only="characters"`，锁死类别且不渲染 tab，两类卡都能导入库里任意角色（主角和别人同权，`assetImport` 只按 target 决定落到 `characters/protagonist.md` 还是 `characters/<id>.md`），立绘包落 `assets/sprites/<id>/` 并把三轴写进 `assets/manifest.json`，不再有 `filter`）。
  - ImageLightbox 灯箱。
  - **工坊恒全屏且复用舞台那条连接**（`useStageSocket.onWorkshop`），不再有独立路由页与独立连接。

## 舞台（src/stage/）

- `src/stage/CgView.tsx`（CG 视图：`GET /api/plays/<id>/cg` 的只读台账 —— `assets/cg` 静态素材与站内生成图共用一张卡，`origin` 分角标，站内生成那张把生图 prompt 原文摊开；开着这一页时 `asset_ready` 里的 cg 自增 nonce 补进网格。服务端那一路 `generatedLedger.ts` 的 `readPlayLedgerEntries()` 直接读 `assets/generated.json`，不建 runtime、不触发生图）。
- `src/stage/`：
  - ScriptBuilder 带 cues 轨道与行 seq。
  - **玩家输入是一等舞台事件**（`player_input`，服务端先于 `beat_start` 广播）：落进缓冲就是普通一行（type `"input"`、actorId `player`，整行显示不走打字机），**没有客户端回声层**——「选完立刻看见」全靠 `shouldAutoStart` 的回执例外（不等 `live`/`auto`，只让语音 hold 与「当前行已读完」把关）。transcript 按 seq 认回谱系 prompt 节点，认走的行及时移出老档兜底池（无 seq 按路径顺序+同文本对回，防同 key 双条）；`beatAtLine` 对 input 行恒 null——玩家的话排在两轮之间，不锚任何一轮，原语按钮置灰。
  - usePlayback 打字机+二段式点击+自动模式+**按住 Ctrl 的快进档**（整行一次读完、行间不设停顿，只追缓冲里已有的内容；回看中不推进；输入框里不劫持）+语音钩子。
  - **回看中生图的插图是行级旁注**（谱系 `LineageNodeView.cgs`，服务端 `recordCg`）：`usePlayback` 收 `cgByNode`（nodeId → 最新一张），`withAttachedCg` 在返回值上按 nodeId 覆盖画面——图跟着你看的那一行，不往后漂、不进树、不分叉；`cg_attached` 帧一到就重拉谱系。
  - StageTheater 舞台视觉层+解锁遮罩+三按钮导演栏（插一句 / 编辑当前这句台词 / **重写**这一轮，输入都走 Modal；「重写」= 分岔带 `instruction`，交代的那句是重演这一轮的第一条输入，随 fork 一起发，不是排进队列等下一轮）。**立绘落位与缩放的唯一入口是一组 CSS 变量**（`--sprite-top/height/origin`，竖屏另有一份 `-portrait`）：值取自 `packages/core` 的 `spriteStagePreset(取景, 体量, 锚点)` 预设表，取景/体量来自 `assets/manifest.json`（差分覆盖立绘级），锚点还能被逐行 `<actor anchor="…">` 覆盖；`framing-*` / `anchor-*` 那层 class 已删，只剩 `pos-*`。**`visual.sprites` 的键是演员 id，查图与呈现前先过 `index.spriteDirOf(id)` 解成立绘目录**（卡上 `sprite:` 显式绑定，缺省同名）——参考垫图选择器与 CG 面板列的本来就是目录，名字走 `index.spriteName(dir)`（认领它的那张卡）再落舞台名牌。
  - StageShell 外壳（侧栏五视图 + 视图栏 `×` + `Esc` + 折叠/拖宽/窄屏抽屉 + 底栏两行：当前周目在最上、`exit` 图标的「退出」压在最下，两者间一条线）。
  - `stage/view.ts` 的 `stageViewFromQuery`/`workshopUrl`/`workshopConnectionFromQuery`。
  - `ui/Modal.tsx` 居中模态窗（portal body，触摸捕获，Esc 只关最上层）。
  - PromptQueuePanel 排队面板（待注入的句子可改可撤 + 正在生成的事：剧作家的轮次/生图/语音，失败项不自动消失、手动清）。**舞台与工坊共用同一份数据**（`useStageSocket` 的 `pendingJobs` 与 `queue`，工坊复用的就是那条连接），差在落点：舞台里浮在画面右上，工坊里 `dock` 成内容区底部一条——工坊右上角是各页自己的头（素材页那排「生成新立绘」就在那儿），浮层会压住真按得着的东西。
  - `src/stage/settings.ts`（localStorage 布尔开关，读写收 storage 参数以便 node 下测）与 `playbackState.ts` 的 `stopAffordance`（本轮写完的出口是摆卡片还是点舞台，二选一；默认关即点舞台）。
  - StopPanel 停止点操作含自由输入 ✨润色/撤销（P4 增量，润色恒基于原文不叠加）。
  - 选肢层是 `.theater-stage` 的子元素（只盖画面，不压台词条/导演栏/侧栏）。
  - useStageSocket 含 audio_ready 转发。
  - `src/stage/RouteCanvas.tsx` + `routeTree.ts`（路线视图：一张卡 = 谱系一个节点，卡内左上角落笔时刻（`MM-DD HH:mm`）+ 正文（本轮首句台词，scene/sfx/cg 这些控制指令不当摘要）+ 左下角角色名，卡片背景优先取这一幕出过的 CG、没有才用场景背景、只从卡片右半边横向淡入，正文压在一层不透明纱上，右下角三个**带字样**的动词按钮「跳转」`return` / 「重写」`rewrite` / 「删除」`remove`（与舞台导演栏同一套手感：无边框、悬停浮出浅底——二十几像素的方块里分不出跳转和重生成，动词必须写出来；title 里写死「生不生成」，卡面只此一处解释）；「重写」弹一个可留空的输入框（交代的那句随 fork 一起发、落进重演的这一轮，与舞台同一条路；锚点由卡片自己算的 `forkFromId` 给——总是本轮之前的那一点，同时把「被顶掉那一拍的首节点」作为 `replaced` 发出去：本轮由玩家的一句话开头时，服务端照 `replaced` 把那句原话带进新枝，剧作家照旧看得到「玩家说了什么」），「删除」弹确认框并写出「将删除 N 轮 / M 个节点」；**卡面可点即选中**——选中后同一次子树遍历标出来路（`.kin`）与「删掉会没掉的范围」（`.doomed`），点空白或 `Esc` 取消；已无检视栏，操作只在卡内按钮上；`routeTree.ts` 是布局唯一真相源，`NODE_W`/`NODE_H` 同时决定两轴步长、连线端点与画布边界）。
  - VoiceDirector 语音导演 `src/stage/audio.ts`：单一共享 AudioContext、gapless 链式调度、快进淡出、背压滞回。
  - `src/stage/loopAudio.ts` BGM/ambient 播放层（`LoopChannel` 双通道交叉淡入淡出 FADE_MS=1200、50ms 步进调 volume、dispose 停干净；`SfxPlayer` 一次性音效 MAX_SFX=6 挤掉最老）——**舞台不再直接持有 `<audio loop>`**，两条常驻通道都走 LoopChannel。
  - `director.ts` 的纯函数 `resolveAudio(current, cue)` 是「缺省=保持、`none`/`""`/大写 NONE=停止」的唯一真相源。
  - P1 文字视图复用为 log。
