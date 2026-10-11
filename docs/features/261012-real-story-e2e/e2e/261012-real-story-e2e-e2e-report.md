# real-story-e2e 端到端测试报告

## 测试环境

- **被测系统**：AIVN (Stage AI) 现网服务（`http://localhost:8787`，基于 `apps/server/dist` 生产构建）
- **测试客户端**：Playwright + Chrome 153（无头沙箱隔离模式，桌面视口 1440×900，移动端视口 390×844）
- **真实 API 配置**：
  - **文本生成 / 编排**：`cpa/omni`（对话与创作网关，上下文 262k）
  - **生图 / 抠底**：`flow2api`（Google Flow 逆向网关 `gemini-3.0-pro-image`，画幅 half 3:4 与 16:9，本地 `cutout.ts` 纯色键反解）
  - **语音合成**：`Fish Audio`（TTS 多 Key 轮询网关，代理 `127.0.0.1:7890`，音色：昔涟 `25b1469648534f40af84b88462289866`）
- **故事主题设定**：可爱少女“雾岛澪”在废弃天文台寻找已故天文学家父亲留下的最后一段观测记录，主题是“记忆是否等于拥有过”，结尾有留白但温柔。
- **凭据防护**：所有真实 API 凭据、私钥及 Authorization 均已严格脱敏，不写入本报告。

---

## 功能类测试项

| # | 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
|---|---|---|---|---|---|
| 1 | 打开 `http://localhost:8787/` 剧目库主页，观察既有剧目列表与分类筛选状态 | 页面正常加载，展示启动器卡片网格；顶部搜索栏、筛选选项卡、新建剧目按钮完好 | 正常加载，包含 9 部既有剧目，草稿与开演计数显示正确 | 通过 | ![剧目库主页](shots/01-library-home.png)<br>URL: `http://localhost:8787/#/` |
| 2 | 点击「已开演」筛选标签（当前为 0）与空剧目列表模拟 | 列表显示空状态或暂无剧目提示，不崩溃不报错 | 正常显示「没有找到与“”相关的剧目」及「剧场空空如也」空态卡片 | 通过 | ![筛选空状态](shots/02-library-filter-active-empty.png)<br>![空剧目库空态](shots/03-library-empty-state.png) |
| 3 | 进入全局系统设置（`#/settings`），检查模型网关并切换默认模型为 `omni`，保存设置 | 设置回显脱敏凭据，支持切换模型下拉；保存后立即写入 `<dataRoot>/settings.json` 并弹出绿色成功横幅 | 成功切换至 `omni`，回执提示「已保存并立即生效 2 项」，无刷新实时生效 | 通过 | ![全局设置页](shots/04-settings-screen.png)<br>`/api/config` 确认 `modelId: omni` |
| 4 | 点击「新建剧目」，填入 ID `mio-observatory` 与标题《星轨尽头的观测记录》，点击「创建并前往」 | 剧目目录与空卡片在服务端就绪，浏览器自动导航至 `#/play/mio-observatory` 标题页 | 成功创建，自动跳转标题页，标题与默认菜单展示完整 | 通过 | ![新建剧目表单](shots/05-create-play-form.png)<br>![新剧目标题画面](shots/06-new-play-initial-view.png) |
| 5 | 在故事未就绪（前提为空）时，点击标题页「START 开始游戏」进入舞台并点击「开始故事」 | 触发就绪门防护或提示空前提，不崩溃 | 舞台进入并显示「剧作家正在落笔…」，空前提轮以 `no_stop` 优雅收束，标题画面菜单自适应更新为 CONTINUE/START/ROUTE | 通过 | ![未就绪开演防护](shots/07-title-readiness-gate.png)<br>![空前提开始故事](shots/07b-stage-start-empty-premise.png) |
| 6 | 点击「WORKSHOP 工坊」进入工坊页，切换至「Agent」标签页检查与配置单剧目 Agent | 展示剧作家与搭台助手两张卡片，模型下拉正常列出可用模型；保存后落盘 `play.json` | 确认剧作家与搭台助手模型均绑定 `omni`，成功注入短篇篇幅与温柔留白补充要求并落盘 | 通过 | ![工坊Agent页](shots/09-workshop-agent-pane.png)<br>`play.json` 中的 `agents` 成功更新 |
| 7 | 在工坊对话区向搭台助手发送完整创作指令：撰写前提/文风、创建角色（夏目朔/雾岛澪）、查音色库绑定昔涟、出立绘并抠底入库、导入背景 | 搭台助手多工具自主规划调用：read/write/edit、list_voices、list_library、import_asset、generate_image、cut、validate_play；资产全部真实验收 | 助手连续执行 66 次工具调用，背景 `observatory_rooftop`、立绘 `mio/neutral` (1080×1920 RGBA)、角色卡与音色全部落盘，开演条件全绿 | 通过 | ![工坊对话流式执行](shots/10-workshop-chat-streaming.png)<br>![工坊对话执行完成](shots/11-workshop-chat-done.png)<br>![工具行与出图条目](shots/11b-workshop-chat-tools-and-assets.png) |
| 8 | 逐项检查工坊子面板：剧目 (PlayPane)、角色 (CharacterPane)、记忆 (MemoryPane)、素材 (AssetsPanel)、文件 (FileBrowser) | 数据与磁盘文件一致回显；封面自动绑定、角色立绘绑定与音色试听正常；素材表与代码编辑器完好 | 五个面板全部准确回显：剧目页展示写作参数；角色页支持昔涟音色试听并生成 preview MP3；素材页展示立绘与背景；文件页可预览透明立绘与 Markdown 编辑 | 通过 | ![剧目页](shots/12-workshop-play-pane.png)<br>![角色页](shots/13-workshop-character-pane.png)<br>![记忆页](shots/14-workshop-memory-pane.png)<br>![素材页](shots/15-workshop-assets-pane.png)<br>![文件页](shots/16-workshop-files-pane.png)<br>![文件立绘预览](shots/16b-workshop-files-image-preview.png)<br>![音色库面板](shots/13b-voice-library-modal.png) |
| 9 | 返回标题页，检查素材齐备后的标题画面 | 标题页自动绑定刚入库的 `observatory_rooftop.jpg` 作为全屏背景，展示故事简介 | 标题画面惊艳呈现天台黄昏背景，START/CONTINUE/ROUTE/WORKSHOP 菜单完备 | 通过 | ![标题画面就绪带封面](shots/17-title-ready-with-cover.png)<br>视觉呈现极具沉浸感 |
| 10 | 在标题画面点击「START 新的开始」进入舞台，开始首轮演出 | 剧作家（`omni`）真实创作第一拍，舞台背景、立绘、名牌、台词打字机、BGM (`bgm_piano_soft_loop`) 自动导入，后台并发 Fish TTS 合成 | 完美演播：天台背景淡入，雾岛澪立绘上台，山风与星空台词流式推进，BGM 循环启动，TTS 语音预取入库 | 通过 | ![首轮舞台演出第1句](shots/18-stage-beat1-line1.png)<br>![雾岛澪台词与名牌](shots/19-stage-beat1-mio-say.png)<br>TTS 缓存生成 `5a82f2866c...mp3` |
| 11 | 演出推进至第一轮末尾，停止点选项展示 | 弹出 3 个契合剧情深度的选项与 1 个自由输入入口，停止点格式正确 | 展现 3 条关于星光、引力与记录的深度选项与自由输入按钮 | 通过 | ![首轮停止点选肢](shots/20-stage-beat1-stop-choices.png)<br>DSL `<stop>` 正常解析 |
| 12 | 打开舞台「Log」回顾面板，检查剧本流水线与原文 DSL | 合并展示舞台指令（换景、立绘、差分、停止点）与角色台词，可切换原文查看完整 prompt 与思考 | 剧本流时间线合成精准，指令标签带人话转化，原文标签展示完整轮次与工具细节 | 通过 | ![剧本回顾流水](shots/21-stage-log-script-feed.png)<br>![原始DSL记录](shots/21b-stage-log-raw-dsl.png) |
| 13 | 体验停止点自由输入：输入文本后点击「✨ 润色」，随后点击「撤销」 | 触发 `/api/plays/:id/polish` 服务端接口，按主角夏目朔人设润色；撤销能回滚原句 | 成功调用大模型润色，输出沉稳克制的夏目朔语调；点击撤销即刻恢复原输入，返回选项 | 通过 | ![自由输入与润色模态窗](shots/22-stage-stop-polish-modal.png)<br>润色与撤销功能正常 |
| 14 | 选择第 1 项「但那道光，现在正真真切切地照亮你。」进入第二轮演出 | 玩家输入作为一等舞台事件立即回显，剧作家接话，后台提前生成观测室内部背景 (`observatory_interior`) 与微笑差分 (`mio:smile`) | 玩家输入瞬间上屏，剧作家调用 preload 生成背景与差分立绘，后台出图无阻断 | 通过 | ![玩家输入即时回显](shots/23-stage-player-input-echo.png)<br>![第二轮开场](shots/24-stage-beat2-line1.png)<br>后台出图成功入库 `mio/smile.png` |
| 15 | 推进第二轮演出，验证到货淡入与立绘差分切换 | 场景从天台淡入至天文台内部，立绘平滑切换至微带笑意的 `smile` 差分，演出继续推进 | 背景成功切换至带有黄铜望远镜的旧观测室，澪立绘切换为温柔微笑差分，伴随 Fish TTS 语音 | 通过 | ![微笑立绘差分呈现](shots/25-stage-beat2-mio-smile.png)<br>![第二轮停止点选肢](shots/26-stage-beat2-stop-choices.png) |
| 16 | 测试舞台导演栏「改写」功能：选中台词修改并提交 | 当前台词原地更新，落盘 `edit` 节点，不破坏世界线结构 | 成功修改主角心理旁白为“七岁生日那晚”，台词框立即同步更新为改写后文本 | 通过 | ![原地改写台词模态框](shots/27-stage-edit-line-modal.png)<br>`lineage.jsonl` 记录 `kind: "edit"` |
| 17 | 选择「轻轻转动沉重的铜质调焦轮…」进入第三轮（收束与终章） | 剧作家按提示词要求进行短篇收束，演出情感升华并以全屏标题卡 `<title>` 优雅收尾 | 剧作家写出深情台词，画面淡出为纯黑，全屏逐行展示纪念诗篇与“—— 终 ——”标题卡，BGM 渐隐 | 通过 | ![终章对白演出](shots/28-stage-beat3-ending.png)<br>![全屏大结局标题卡](shots/29-stage-finale-title-card.png)<br>故事达成完整温柔闭环 |
| 18 | 打开路线树视图（RouteCanvas），检查节点分布与分支结构 | 路线树准确呈现单树分支，包含起点、初始轮、首轮、第二轮、第三轮及结局卡片；节点悬停展示摘要与动词 | 路线树布局清晰，连线平滑，当前激活的世界线高亮，各节点带时间戳、角色与台词摘要 | 通过 | ![完整路线树全景](shots/30-stage-route-tree.png)<br>坐标与层级排布精准 |
| 19 | 在路线树中选中第一轮节点（10-12 05:07），点击「跳转」 | 舞台重基准（rebase）到该节点，恢复该拍首句演出，弹出「已跳到这里」气泡 | 成功跳转回第一轮天台黄昏场景，播放头重置至首句，快捷菜单与导演栏状态复原 | 通过 | ![节点卡片交互动词](shots/31-route-card-selected.png)<br>![跳转回第一轮现场](shots/32-stage-jumped-to-beat1.png) |
| 20 | 在路线树或舞台导演栏发起「重写这一轮」，交代要求后提交分岔 | 服务端创建新 fork 节点，保留旧分支并独立演进新分支 | 成功分岔出全新故事线（10-12 05:27），澪在新分支提出寻找备用钥匙，路线树呈现树状双分支 | 通过 | ![路线树重写对话框](shots/33-route-rewrite-modal.png)<br>![新分支生成中](shots/34-stage-rewrite-branch-generating.png)<br>![新分支第一拍结果](shots/34b-stage-rewrite-branch-result.png)<br>![路线树呈现真实分岔结构](shots/35-route-two-branches.png) |
| 21 | 在路线树中点击旧分支的节点（10-12 05:13）并点击跳转 | 舞台无缝回到旧分支的历史现场，不影响新分支的存在 | 舞台成功切回旧分支并停在第二轮观测室场景，原微笑立绘与背景原貌完好展现 | 通过 | ![成功切回旧世界线分支](shots/36-stage-returned-to-old-branch.png)<br>双分支并存且可自由穿梭 |
| 22 | 验证标题页单树模型逻辑：检查 CONTINUE、START、ROUTE 按钮行为 | CONTINUE 直达当前世界线；START 开新分支（`?new=1`）；ROUTE 直接打开路线树（`?view=route`） | CONTINUE 成功回到舞台；ROUTE 成功直达路线树视图；单树架构去除了冗余的多周目概念，逻辑精炼通透 | 通过 | ![标题页继续与新开始](shots/37-title-continue-vs-new.png)<br>![CONTINUE回舞台](shots/37b-title-continue-returned-stage.png)<br>![ROUTE直达路线树](shots/37c-title-route-direct-access.png) |

---

## 体验类测试项

| # | 体验场景 | 关注点 | 观察 | 建议/问题 | 备注/证据 |
|---|---|---|---|---|---|
| 1 | 剧目库主页空态与筛选体验 | 视觉/交互/常识 | 剧目库启动器质感极佳，卡片 hover 有优雅的放大与阴影；切换到「已开演 0」时，居中提示「没有找到与“”相关的剧目」，文案将空搜索词与状态筛选混杂 | **问题**：在仅切换 Tab（非搜索）而结果为空时，提示文案应为「暂无已开演剧目」，而非「没有找到与“”相关的剧目」 | ![筛选空状态](shots/02-library-filter-active-empty.png) |
| 2 | 工坊搭台助手对话体验 | AI 协作 / 工具反馈 | 搭台助手执行力极强，一次性规划并落盘了所有必需文件；工具调用行自动展示状态、耗时与产出缩略图，用户对后台发生的写盘和生图一目了然 | **观察**：工具卡片先图后音频的设计非常紧凑，且生图草稿出图后直接内联展示，给创作者很强的笃定感 | ![工坊对话执行完成](shots/11-workshop-chat-done.png)<br>![工具行与出图条目](shots/11b-workshop-chat-tools-and-assets.png) |
| 3 | 美少女立绘与纯色抠底反解质量 | 视觉/审美/人物一致性 | 雾岛澪的立绘表现出极高水准的二次元美少女质感：深蓝长发、高领毛衣、星图斗篷与清澈眼眸；经 `cutout.ts` 纯色键反解后，边缘发丝清晰且未损失细黑描边，1080×1920 构图比例在舞台中央落位自然 | **观察**：第二轮通过 preload 差分生成的 `smile` 差分立绘，在保持原人设特征（发型、服饰）的同时自然流露温柔微笑，前后情绪过渡细腻 | ![立绘预览](shots/16b-workshop-files-image-preview.png)<br>![微笑差分舞台落位](shots/25-stage-beat2-mio-smile.png) |
| 4 | 真实语音（Fish TTS）与多媒体演出 | 听觉/视听节奏 | 选用昔涟音色后，雾岛澪的对白带有轻柔微细的气息感，与台词打字机节奏和背景钢琴曲完美融合；台词在换景与进观测室时配合舞台淡入，沉浸感极强 | **问题/观察**：回顾抽屉的台词行中，由于浏览器初始需用户手势解锁 AudioContext，有时进入页面首拍前几秒语音可能未被自动拉起，但「试听」与重放按钮均 100% 正常；建议在标题页 START 时即引导解锁 AudioContext | ![舞台台词与立绘](shots/19-stage-beat1-mio-say.png) |
| 5 | 短篇剧情与情感表达（AI 剧作家表现） | 剧作深度 / 主题契合度 | omni 在剧作家角色下的文学水准令人惊叹：围绕“记忆是否等于拥有过”的主题，巧妙借用“光年之外的星光纵使星体消亡但引力与光芒依然抵达”作为隐喻；三轮故事层层递进，从天台的迷茫、到观测室发现父亲留下的刻度卡纸、再到目镜中重现微光，最终以全屏黑色诗意标题卡温柔收束，完全没有模板化俗套感 | **观察**：这是极具示范意义的真实 Galgame / 视觉小说短篇体验，达到了人类商业短篇企划的阅读愉悦度 | ![终章对白演出](shots/28-stage-beat3-ending.png)<br>![全屏大结局标题卡](shots/29-stage-finale-title-card.png) |
| 6 | 路线树视图（RouteCanvas）探索与世界线分叉 | 交互/宏观叙事感知 | 路线树呈现非常直观，节点卡片带有缩略背景与人物名牌，选中节点标出来路（`.kin`）与废弃范围（`.doomed`）；点击重写后优雅分岔出两条独立时间线，玩家可以自由在两条世界线中跳转穿梭 | **建议**：卡片数量增多后，默认视口有时偏左，用户需要点一次「看全树」才能居中看到全部树枝；建议每次打开路线面板时自动执行一次 `fitToTree` 自适应居中 | ![完整路线树全景](shots/30-stage-route-tree.png)<br>![双分支并存全景](shots/35-route-two-branches.png) |
| 7 | 深色与浅色主题适配 | 视觉/色彩规范/对比度 | 舞台和工坊全面响应 `html[data-ui-theme="dark|light"]`；深色模式下背景色调自然深沉，文字对比度极高，没有出现生硬的纯白块；浅色模式下台词框与器具采用浅色磨砂玻璃，字墨清晰 | **观察**：经实测，深色主题在 1440 宽屏下的夜空氛围尤为舒适，与星空题材相得益彰 | ![深色主题1440](shots/38-stage-dark-theme-1440.png) |
| 8 | 窄屏移动端（390×844）一等场景适配 | 移动端交互/无画框/排版 | 在 390 视口下，顶栏收缩为紧凑排布，导演栏收敛为纯图标并让开工坊切换键；台词条占底部合理高度，无任何竖排中文挤压现象；路线视图的工具栏贴底放置，握持操作顺手 | **观察**：移动端完全不是简单的缩放，而是经过精心重构的专有响应式版式，手感扎实 | ![移动端窄屏深色](shots/39-stage-narrow-390-dark.png)<br>![移动端窄屏浅色](shots/40-stage-narrow-390-light.png)<br>![移动端剧目库](shots/41-library-narrow-390.png) |

---

## 结论

- **功能**：通过 22 · 不通过 0 · 受阻 0
- **体验**：8 项深度体验观察，关键建议 2 项（筛选空状态提示文案细化、路线树初次打开自适应居中）
- **总体**：**通过**

---

## 待跟进

1. **标题页与路由双井号细节**：在某些特殊导航时 URL 偶见 `##/play/...`，虽不影响 hash 路由功能但可收紧 `router.tsx` 中 `location.hash` 拼接逻辑。
2. **筛选空状态文案**：当仅处于 `filterMode === "active"` 且 search 为空时，建议将 `没有找到与“”相关的剧目` 优化为 `暂无已开演剧目`。
3. **路线树初次打开视口**：建议在打开路线树模态窗后延迟 100ms 自动触发一次 `zoomFit`，让同时存在多条分支时首屏即可完整居中呈现所有世界线。
