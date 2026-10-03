# apps/server AGENTS.md

## 职责

- `apps/server` —— 后端：REST + WS 舞台广播 + 演出编排（`orchestrator.ts`）+ 工坊会话（`workshopSession.ts`）+ `playhouse.ts`（按剧目缓存 runtime / PlayAssets / 模型）。

## agentkit：两个 agent 的共用基座

- **两个 agent 共用一套基座**：`src/agentkit/` 是唯一工具实现面（`kit.ts` 按 `role: "playwriter" | "workshop"` 装配，`deps.ts` 用判别联合收窄依赖），同一工具**同一份 schema 与实现，只有 description + 等待策略 + 注入依赖不同**（`generate_image`：工坊 sync 等图并回 markdown 图片、剧作家 queued 后台排产只占时间线位置）。
- **工具清单不再按角色切分**：`kit.ts` 的 `TOOL_CATALOG` 是两个角色合用的同一份全集（`agentToolCatalog()` 是设置页与装配共用的唯一真相源），play.json 的 `agents.<role>.tools` 存**启用集**（白名单，不是禁用集）过滤，缺省走 `DEFAULT_ENABLED`（搭台除 `bash` 外全开——命令行按剧目手动勾；剧作家开着轮收束/记忆/联网/生图/**只读**查库，`import_asset` 仍默认关——素材策略是创作决策，工具不给它那条策略就是空话）。
- `can` 位（image/search/library/voice/shell）反过来决定提示词注不注某一章。
- `generate_image` 的两个角色**同一份 schema**（`expression` 与 `references` 都拿得到——垫图读 `assets/sprites/`，与谁调的无关），只差 description 与等待策略。**垫图入口只有一个 `references`**（每项可以是角色 id、剧目内相对路径或 http(s) 网址，1–6 张；`referenceCharacters` 保留为只吃角色 id 的兼容别名，两者在工具层合并去重）。**`neutral` 定妆照可以垫外部参考图**（用户拿一张既有角色图来定妆走的就是这条），background/CG 也按它垫图；**非 neutral 的立绘差分不吃 `references`**——身份基准恒为该角色的 `neutral` 定妆照（传了直接报错，因为换基准会与既有差分不是同一个人）。
- **自动注册临时角色**：`generate_image` 的 `characterName` 参数带上了、而 `characterId` 不在角色卡目录里时，`playAssets.resolveSprite` 就地写一张最小卡再出图（卡里只有 id/name，正文写「（演出中临时引入，设定未补。）」——留空会让工坊以为「作者写过了，就是没写」），并打 `autoRegistered` 让宿主走同一条 `onPlayConfigChanged` 轮边界重建：工坊与用户此刻不在场，等他们想起建卡，这一轮早演过去了。
- 已有卡时这个参数不作数（不覆盖人设）。
- **同名工具调用并发**：create_character 的落盘与 generate_image 的成员校验原本实时读盘，同批发出时谁先完成不定，会偶发扑空。
- `playhouse.writeCharacter` 落盘的同时把 id 登记进 `knownCharacters`（WeakMap<PlayStore>），`characterIdsOf` 那个回调读实时盘 ∪ 它，竞态就没了。
- **无名角色音色**：`<say id="passerby" name="路人甲">` 这种一次性角色没有角色卡、而音色挂在角色卡的 voiceId 上，于是永远没声音。
- `play.defaultVoiceId`（工坊「设定」页挑）在 `voiceOf` 里兜底，有卡的角色仍然各用各的。
- **抠底参数不在它上面**（填参数得先看过成图，出图那一刻没人看过），改抠底走工坊专有的 `recut_sprite`——立绘落盘前把抠底前的原片留一份到 `media-cache/sprite-sources/<角色id>/`（跑批产物不进 git），重抠拿它本地重跑一遍 `cutout.ts` 覆盖 assets/ 里那张 PNG：画面一个像素不变、不烧配额、几秒出结果。
- 没有留底的（更早出的图、用户上传的）直接报错，只能重新出图。
- `import_asset` 仍在清单里，但**对剧作家默认关闭**——它的默认导入路径是引用即导入（见下），用户想让它自己动手再勾上。

## DSL、轮收束与 IR 事件

- **DSL 是时间线、工具是副作用**：`beat_done`（轮收束 + 停止点载荷，`options` 若干条 / `placeholder` / 都不给；schema 只兜「至少两条非空」这个无效载荷，**给几条、何时给归剧目的创作口径**，见下）与 `generate_image` 产出 `stop` / `preload_asset` 两个 IR 事件，经 `emitStageEvent` 与解析器产出的事件走同一条路（加 seq → 广播 → 落谱系），client 侧一行不用改。
- 文本形式的 `<stop>`/`<option>`/`<preload_asset>` 已从 DSL 摘除，遇到只静默降级并记 `legacy_tag` 警告（照读会把标签念到舞台上）。

## 工坊线程（压缩、消息文件与文件工具）

- **工坊线程也有纪元压缩**：`workshopSession.ts` 的 `maybeCompact` 每轮开跑前判定（与演出侧同一时刻、同一套 `compaction.ts` 计量与切点），但产物落线程的 `compaction` 字段而不是 `memory/arcs`——工坊会话是搭台过程、不是剧目事实，进 arcs 会污染剧作家每轮注入的 A 区。
- **消息文件一条不删**：只有前 `cutAt` 条移出 agent 上下文，面板照常显示（旧对话照常在，只是中间多一条可点开的分隔）。
- 工坊模型可以和剧作家不同，阈值因此另有一套 `STAGE_WORKSHOP_*` env（缺省逐项沿用全局），生效值再与模型自带窗口取 min。
- 摘要回注 A 区（工坊 A 区本就每轮重建，没有前缀缓存约束），多轮是**拿旧定稿重写成一份完整文档**而不是叠加（`capDigest` 封顶 6000 字）。
- 工坊的 read / write / edit / bash 全部是 **pi 的内建工具**（`agentkit/piTools.ts` 只做 `AgentHarnessTool → AgentTool` 的适配，把 `onUpdate`/`toolContext`/`invocation`/`context` 补齐，`context` 用 `withAbortSignal(signal, BACKGROUND_CONTEXT)` 把工坊单轮的 7 分钟超时传下去）。
- 路径白名单、`play.json` 结构校验与撤销条收在 `agentkit/playEnv.ts` 的 `PlayEnv extends NodeExecutionEnv` 里——它是**装饰不是重写**，只覆写两个口子：`absolutePath`（读面，read/write/edit 唯一的路径入口）与 `writeFile`（写面，白名单 + `parsePlayConfig` + `onWrite`）。
- pi 的 `withFileMutationQueue` 顶掉了原来的 `fileLocks`（WeakMap<env> + canonicalPath，同一 `PlayEnv` 实例内自动串行）。
- **bash 不走这一层**：它继承 `NodeExecutionEnv.exec`，cwd 就是剧目目录，以服务进程的权限跑、改文件不进撤销条，所以 `DEFAULT_ENABLED` 里默认关，`can.shell` 决定提示词注不注「命令行」那章（讲的是边界与后果，不是用法——cwd/截断/超时都在 pi 的 bash 描述里）。
- `workshopSession` 订阅 `tool_execution_end`，跑过 bash 就置脏。
- 收束前若 `play.json` 已解析不了，**跳过这次 runtime 重建并广播 `workshop_error`**（带着坏配置去 rebuild 只会抛在 `void` 的 promise 里，用户看到的是「面板不刷新了」而不是「哪里坏了」）。
- play.json 校验失败的消息只有走 `write` 才原样回给模型——pi 的 `edit` 把它包成「Could not edit file: …. Error code: invalid.」，原因只留在 cause 上，不为消息粒度再造第二套错误面。

## 素材、出图与台账

- 出图**只有一层**：`PlayAssets` 落 `assets/`，工坊与剧作家共用一个实例，同一张图在飞去重只烧一次配额。
- `ImageAssets`（media-cache 里的 bg/cg 内容寻址缓存）已删——`media-cache/` 现在只剩 TTS 音频、立绘留底原片（sprite-sources/）与 `view_image` 下载的网图（web-images/）——全是可重建的中间物。
- 代价是内容寻址去重没了：同一句提示词生成两次会真出两张图，剧作家侧改由工具自己判「剧目里已有同名素材就跳过」（`playAssets.existingUrl()`）。
- CG 页的生成台账只有 `assets/generated.json` 一份（`generatedLedger.ts` 的 `readPlayLedgerEntries`）。
- **一张表一个写者**：`assets/manifest.json`（素材描述）归工坊与用户，`assets/generated.json`（站内出图这次用的 prompt 记录，进 git、只读）归引擎——两边都动一张表时，工坊补一条中文描述就能把引擎记的 prompt 整条替换掉（2026-10-01 实测）。

## 立绘：后缀、景别与画幅

- 立绘的自动后缀只规定抠底要的构图（哪里要有纯白留白），不描述任何人物特征：那里曾写着「twin tails」，等于给所有角色定了个双马尾，prompt 里明写 long straight hair 也救不回来。
- **立绘景别与画幅跟着 `framing` 走**（`play/framing.ts` 是唯一真相源：**三档** full 9:16 / half 3:4 / square 1:1，出图画幅取 `SPRITE_FRAMING_ASPECT`、提示词里的景别措辞取 `SPRITE_FRAMING_SHOT`；写死 9:16 全身时半身角色照样会被画成全身，出图与舞台声明对不上）。
- **没有 bust 档**——胸像的价值已被 `shot` 运镜吃掉，留着只是多一个让模型选错的出口。
- 存量声明按 `LEGACY_SPRITE_FRAMING` **降级到 half 而不是丢弃**：丢掉等于让一张胸像按全身摆位，错一个躯干量级且用户看不出来。
- `square` 是**给非人 sprite** 的：猫、道具没有头肩腰之分，全身/半身这套人形术语套上去语义不通，正方形让这类主体占满画布又不浪费左右空间。
- 画幅必须落在**上游真正支持的取值**内——走 flow2api 时 Google Flow 只有 1:1 / 9:16 / 16:9 / 4:3 / 3:4 五档，原先 half 用的 2:3 发过去不报错、静默退回 16:9，出图直接变成一张横的，重试也没用。
- **3:4 / 4:3 两档的枚举也曾被该网关接反**（2026-09-29 那次实测因此被误读成「上游不认 3:4」），2026-10-04 已在本机 flow2api 的出口换算里修正并真实出图复通（详见 `docs/issues/261004-flow2api-aspect-swap/`）——所以 `half` 就写 3:4，别为了绕开它改成 4:3。

## 生图后端

- 生图后端本机默认走 flow2api（`STAGE_IMAGE_BASE_URL=http://127.0.0.1:38000`，账号 credits 计费、额度 988 起）：cpa 网关的 `gemini-3.1-flash-image` 几分钟就撞一次 429 额度耗尽，做不了连续出图与对照实验。
- 两套后端的协议形状一样，换回去只改 `.env`。

## 提示词装配

- **工具知识只写在工具描述里，系统提示词不复述**（同一规则写两处必然漂移——生图那几条已经漂移过一次）。
- `prompt.ts` 的 `imageChapter` 只留工具本身与后果（发起即返回、这一轮就引用到它则先上骨架占位），调用写法（走函数调用不是文本标签、id 命名、prompt 后缀串）全在 `QUEUED_DESCRIPTION`。
- **什么时候该画一张不再由引擎决定**——早先那句「清单里没有就自己画一张背景」替所有剧目做了同一个决定，已撤掉，改成指向剧目的创作口径。
- 原先那句「提前 3–5 句发起」已删——流式播放下 3–5 句只给图 3–5 秒的头，而真图要一分多钟，这个数推导不出来。
- 现在只留事实：这一轮就引用到它，舞台先上骨架占位、到货后淡入。
- `workshop.ts` 的资源库章节整段删掉，内容进了 `list_library` 的描述。
- 反过来也有搬不动的两类：DSL 渲染契约（`action` 八词、`shot` 四档、anchor 三档）是引擎认的字符串，工具描述里没有位置放。
- 「按描述选素材」这类引用 A 区清单的规则，工具描述里也没有「清单」可指。
- 工坊提示词里每个工具名出现的地方都按 `can.library` 收了条件——工具没注册就别在提示词里教它调。
- 两份提示词的正文按章抽成模块常量（剧作家 `ROLE_INTRO` / `HOW_I_WORK` / `FORMAT_RULES` / `NEW_CHARACTER_RULES` / `CONTRACT_RULES`，搭台 `RESPONSIBILITY_RULES` / `TALK_RULES` / `IMAGE_BASICS` / `NO_IMAGE_GUIDE` / `LINEAGE_GUIDE`），带能力位的章走 `imageChapter` / `setupFlow` / `writingPoints`，装配模板只留顺序与开关——改一章不必在几百行里找位置。
- `beat_done` 的三种停法只在「## 结束轮」与 `beatTool.ts` 的 `BEAT_DONE_DESCRIPTION` 各写一遍（契约 vs 工具说明），`# 你怎么工作` 不再复述第三遍。
- 搭台提示词里**不写死 UI 入口清单**（曾列出「玩家能打字的五处界面」，界面一改即成假信息），只说清要改什么、让用户自己找入口。

## 看图（view_image）

- **看图是一个能力不是一道流程**：`view_image`（只装给工坊，目录里的 `files` 分组）把图读成 image attachment，`source` 吃两种来源——剧目内路径（PlayFiles 白名单）或图片网址（`webImage.ts` 下载，按 URL 摘要缓存到 `media-cache/web-images/`，不进 git）。
- **系统提示词里不写「出完图看一遍」**——每张都看只是白烧一轮，看不看得由模型自己判断。
- 网址分支的地址是模型给的，所以 `webImage.ts` 在下载前解析域名并拒掉回环/私网/链路本地/云元数据、每跳重定向重判、非 http(s) 直接拒。
- 出口代理读标准的 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量（取第一个非空的），不另开配置项——代理本来就是环境的事。

## 引用即导入（资源库）

- **引用即导入**（`assetRef.ts` 的 `AssetRefResolver`）：剧本里写了剧目没有的 id，宿主就去库里找同名条目导入（`scene bg`→backgrounds、`cg id`→cg、`actor id`→characters、`scene bgm`→bgm、`ambient`→sfx 再 bgm、`sfx src`→sfx）。
- 解析管道不 await，事件先广播按缺素材降级，到货后广播 `asset_ready` 复用现有的到货淡入。
- 角色导入改 play.json 走 `rebuildAtBeatBoundary`（与剧作家给临时角色生立绘同一条延迟重建）。
- 库里没有就静默降级**不回话给模型**。
- 这条链路是剧作家的**默认**导入路径，不需要开任何工具——但**剧作家提示词里要写这条契约**（`prompt.ts` 的 `LIBRARY_REF`，按 `canLibrary` 注入）：不告诉它，它就只剩「缺素材就自己画」这一条路，把本该从库里拿的背景全烧成配额。
- 库里也没有的那一段尤其要写明「静默降级、不回话给模型」，否则它会换个 id 反复重写同一个引用。
- 垫图让单张从 69s 变 138s 而像素一样（`STAGE_IMAGE_REFERENCE=none` 可掐掉，默认保一致性）。

## 出图内核与手动生图

- **出图提示词的内核只有一份**：`src/imagePrompt.ts` 的 `composeImagePrompt(deps, kind, ctx)` 按 sprite/background/cg 选系统提示词并拼上下文（指令 + 创作口径 + 角色卡 + 剧情/场景 + 参考图编号），舞台 `requestCg` 与手动入口都走它。
- **手动生图是「REST 同步发起 + WS 异步回报」**：`POST /api/plays/:id/images` 只做校验与提示词组装就返回 `{target, path, prompt}`——CF 隧道 100s 无字节即断，出图 70–140s 绝不能压在 HTTP 连接上。
- 出图在后台跑，完成或失败一律广播 `image_result`（成功 `{target, ok:true, url, path}`、失败 `{target, ok:false, message}`），客户端对话框按 `target` 匹配自己的那一张。
- `AssetNotify` 的第三个值 `"manual"` 就是给它留的：刷新素材列表，但不产工坊气泡、不进撤销条、不自动重建。
- 素材名/差分名的白名单收在 `assertAssetStem`，REST 入口与出图前各判一次——入口不判就会先返回一个非法 path，用户等一分多钟才在 WS 上收到失败。
- 舞台那一路的参考立绘必须在**落时间线节点之前**校验（`assertReferences`），否则会留下一个永远填不上的骨架。

## 生图配置（接口格式、画幅与尺寸）

- **生图配置按接口格式而不是按产品名**：`STAGE_IMAGE_FORMAT=gemini|openai` 选协议形状（`geminiImage.ts` = `/v1beta/models/{model}:generateContent`，垫图走 `inlineData`；`openaiImage.ts` = `/v1/images/generations`，接口没有参考图入参、带垫图直接报错），地址/模型/尺寸统一读 `STAGE_IMAGE_BASE_URL` / `STAGE_IMAGE_MODEL` / `STAGE_IMAGE_SIZE`——后者说的是两种官方词汇：`1K`/`2K`/`4K` 是 Gemini `imageConfig.imageSize` 的原词（**K 必须大写，官方拒小写**；语义是总像素量级 1K≈1024²），gemini 侧原样透传。
- openai 侧的 `size` 是字面 `WxH`，所以档位由 `canvasFor` 按画幅换算（16:9 的 `1K` → `1360x768`），也可以直接写字面尺寸 `1536x1024` 喂只认标准尺寸的老模型。
- 画幅白名单取两款接口的交集（Gemini 官方 14 个取值，减去 OpenAI 不收的 1:4/4:1/1:8/8:1）——换一家 Gemini 或 OpenAI 生图只改地址与模型名，不动代码。

## 服务入口、端点与记账

- **公网入口是同端口的**：`index.ts` 先过 `webAuth.ts` 的密码闸门（`STAGE_PASSWORD`，HTTP Basic，HTTP 与 `/ws` 升级同一个判断——只挡 HTTP 等于没挡），再由 `webStatic.ts` 把 `apps/web/dist` 挂上，API 路径（`api`/`plays`/`library`）不碰前端目录，其余路径按 hash 路由回 index.html。
- 所以 `pnpm -r build` 之后一个端口就是整站，公网部署只指向这一个。
- 开发时仍是 vite + server 两个端口。
- 在生成的事由 `pendingJobs.ts` 统一记账（剧作家的轮次 / 背景 / CG / 立绘 / 语音），一改整表广播 `pending_jobs`，与排队面板共用一块浮层，重连时随 hello 的 `pendingJobs` 恢复。
- 新增端点：`GET /api/agents/models`（网关 `/v1/models` 清单 ∩ `STAGE_MODELS` 支持清单，收窄在 `provider.ts` 的 `supportedModels`：按配置顺序排、清单里的 id 网关没有即报错点名；读不到网关即 400 不降级）、`GET /api/agents/tools`（工具目录）。

## 技能库与新剧目初始状态

- 技能库（仓库 `skills/<name>/SKILL.md` + frontmatter）只装**跨剧目的通用做法速查**，只给工坊（`read_skill`，角色标记 `workshop`）——这部剧自己的画风锚点与创作口径一律留在剧目记忆里（`memory/always/craft.md` 与设定卡，每轮本来就注入），不给剧作家开技能通道：教模型调一个装不进去的工具，它只会反复空转烧 token。
- **新剧目的 premise 与 craft 落盘就是空文件**（`createEmpty` 不再写模板），通用创作准则改由 `prompt.ts` 的 `CRAFT_RULES` 常驻系统提示词、引导文案搬进前端输入框 placeholder——模板正文写进文件会让人以为「已经填过了」，还会让就绪门把一份空模板判成前提已就位。

## 创作口径与剧目记忆

- **2026-10-03 起引擎不再自带任何创作口径**：`CRAFT_RULES` 与「单轮该写多长」整节已从 `prompt.ts` 删除，一轮多长、选项给几条、多久交还主导权、什么文风、**素材来源**（哪些自己画、哪些从资源库里找）全部由剧目的 `memory/always/craft.md` 承载（每轮原样注入），由搭台助手与用户对齐后写进去（写法指导见 `workshop.ts` 的「素材来源」一条，工具名按 `can.image` / `can.library` 收条件）——文件空着剧作家就真的没有口径可听，所以工坊「设定流程」第 4 步硬性要求落盘。

## 设置面板与配置面

- **设置面板只有一个保存入口**：`configApi.ts` 把 `.env` 当可写配置面，`GET/PUT /api/config` 一把梭（`SettingsFile.read/write`，`set()` 只落改动过的键、掩码与空值视为保持不变）。
- 多把 key 不走独立文件也不走独立接口：`STAGE_TTS_KEYS` / `STAGE_EXA_KEYS` 都是逗号分隔的字符串（`config.ts` 的 `parseKeyList`），传输面统一是 `KeyListView {keys, masked, keyCount}`——读侧 `keys` 恒空、只给掩码，写侧留空=不改、填入=整组替换（`writeKeyList`）。
- 2026-10-02 拆掉了 `PUT/GET /api/config/tts-keys` 与 `~/.config/fish-audio/keys.json` 这条旁路：密钥与其余配置走两条路，用户会只改一半然后发现没生效。
- 模型 ID 两处（全局设置、剧目「Agent」页）复用 `ui/ModelSelect.tsx` 的同一个下拉，清单取 `GET /api/agents/models`，读不到就显式报错给重试、绝不退化成文本框。

## 限制级（NSFW）通道

- **限制级（NSFW）剧情通道**：剧作家主动调 `enter_nsfw` 开启限制级通道（切换至限制级专用模型、注入 20 岁以上虚拟合规轮次与 `memory/always/nsfw.md`），退出时调 `exit_nsfw`（推荐与 `beat_done` 同批发出）。
- 退出时自动提取 1-3 句全年龄 SFW 摘要并在进入前历史末尾追加过渡轮次，主模型只看到含蓄前情提要，前台演出与谱系事件完整保留。
- 谱系快照（MemorySnapshot）存 nsfw 状态，分支跳转自动复位模式。
