# 应用级资源库

## 目标

一个跨剧目复用的**本地素材目录**（立绘 / 背景 / CG / BGM / SFX，带元数据）。每部剧的素材页可以浏览、搜索、从资源库一键导入；工坊 agent 也能罗列、搜索、导入。素材元数据随导入进入剧目，剧作家（playwriter）在 A 区看得见，因而能按情绪、氛围、时长编排 BGM 与音效。

不做的事：资源库本身**不做 UI 管理**（增删改元数据由用户在本地目录里做），资源库不引入数据库、不做多级目录组织。

## 现状勘察（动手前确认过的事实）

- 剧目素材是静态目录 `plays/<id>/assets/{backgrounds,cg,sprites/<charId>,bgm,sfx}/`，前端 `buildAssetIndex` 按 **stem（文件名去扩展名）** 解析成 URL，剧本 `<scene bg="bg_xxx">` 引用的是 stem。
- 素材元数据只有一份扁平表 `plays/<id>/assets/manifest.json`：`{stem: "一句画面说明"}`，只进剧作家提示词。**没有标签、没有情绪、没有时长**，BGM/SFX 更是连描述都常缺。
- BGM/SFX 机制有实质缺口：
  - `<scene ambient="...">` 写在 DSL 规范与提示词里，**客户端从头到尾没消费过**（`VisualState` 里没有 ambient 字段）。
  - `usePlayback` 场景视觉态是 `bgm: cue.bgm ?? null`：**模型换场景时漏写 bgm，音乐就断**。
  - BGM 固定音量 0.28、无淡入淡出、没有停止手段（`bgm="none"` 无语义），ambient 无音量概念。
  - SFX 走 `new Audio()`，音量属性生效，但无并发上限（同帧多次触发会叠成噪音）。
- 素材页（工坊「素材」tab）只有上传/删除与 play.json 编辑，没有第二来源；工坊 agent 有 11 个工具，无资源库相关。

结论：资源库要解决的不只是「多个剧目共享文件」，还有**元数据要能落到剧目里、并且真的驱动编排**。所以本需求含三块：资源库本身、元数据贯通、音频机制补完。

## 设计

### 1. 目录与条目

根目录 `STAGE_LIBRARY_ROOT`，默认 `library`（与 `STAGE_PLAYS_ROOT` 同构，仓库内 `library/`）。**一个条目一个子目录，目录名即 id**：

```
library/
  backgrounds/bg_classroom_sunset/{meta.json, bg_classroom_sunset.jpg}
  cg/cg_rooftop_confession/{meta.json, ...}
  bgm/bgm_rainy_piano/{meta.json, bgm_rainy_piano.mp3}
  sfx/sfx_door_open/{meta.json, ...}
  sprites/koharu/{meta.json, neutral.png, smile.png, shy.png, ...}
```

- kind 用目录名（`backgrounds` / `cg` / `sprites` / `bgm` / `sfx`），与剧目素材目录同名，少一层心智映射。
- `meta.json` **可缺省**：没有它也能罗列，标题回退成 id、描述留空。用户往目录里扔文件就是加素材；要让剧作家看得懂就补一份 meta。
- 单文件 kind 的素材文件随便叫什么（`meta.json` 之外的第一个媒体文件），**sprites 是角色包**：目录里多张差分图，meta 记角色信息与逐差分描述。
- 剧本 id 即文件名主体：导入到剧目时文件名沿用条目 id（`<scene bg="bg_classroom_sunset">` 跨剧目一致）。

### 2. 元数据 schema

`AssetMeta`（放 `packages/core/src/play/assets.ts`，server/web 共享契约）：

| 字段 | 适用 | 说明 |
| --- | --- | --- |
| `title` | 全 | 短标题（缺省 = id） |
| `description` | 全 | **一句画面/声音说明**，剧作家按它选素材 |
| `tags` | 全 | 自由标签（教室/黄昏/室内、忧伤/安静…） |
| `source` | 全 | 出处与许可（如 `CC0 / Kenney`） |
| `mood` | bgm | 情绪词（温暖/忧伤/紧张…） |
| `scene` | bgm | 适用场景（日常/离别/回忆/战斗…） |
| `durationSec` | bgm/sfx | 时长（秒），剧作家判断循环与节奏 |
| `loop` | bgm | 是否适合循环播放 |
| `volume` | bgm/sfx | 建议默认音量（0–1） |
| `character` | sprites | `{name, persona?, voice?, voiceId?}` 角色卡原料 |
| `expressions` | sprites | `{表情名: {file, description}}` 差分表 |

剧目侧的 `assets/manifest.json` 复用同一个 schema：值升级为对象 `{...}`，**旧的纯字符串值继续接受**（等价于只有 `description`）。立绘差分的键用 `角色id/表情名`（如 `koharu/shy`），没写全名时回落到裸表情名——多角色剧目里 `smile` 这类裸键会互相覆盖，是既有隐患，导入时按全名写。

### 3. 导入语义

**复制，不是引用。** 剧目包要能导出（`exportZip`）、素材静态服务零改动、删掉资源库条目不会让老剧开天窗。

- 背景/CG/BGM/SFX：文件复制到 `assets/<kind>/<id>.<ext>`；同名 stem 的其它扩展名文件先删（否则 `stemMap` 会挑到旧的那张）。
- 立绘包：整包复制到 `assets/sprites/<id>/`，并把差分写进 `play.json` 角色卡（角色不存在就按 `character` 新建一张卡）。包里有 `neutral` 时，后续工坊 `generate_asset` 补差分能直接拿它当垫图保一致性。
- 元数据写进 `assets/manifest.json`（按上面的键规则）。
- 导入后 `playhouse.reload`——**保存即生效**，与素材上传同一条路。
- 失败不做降级：目标路径非法/文件缺失/角色 id 冲突直接报错。

### 4. 服务端

- `apps/server/src/library.ts` —— `AssetLibrary`：扫描目录、解析 meta、关键词搜索（id/标题/描述/标签/情绪/场景，大小写不敏感的子串匹配）、按 kind 过滤、解析绝对路径（防穿越）。**不写库**：资源库只读。
- `apps/server/src/assetImport.ts` —— 导入到剧目（复制 + 写 manifest + 合并角色卡），先全量校验再落盘。
- `PlayStore.assetNotes()` 升级为 `assetMeta()`，返回 `Record<stem, AssetMeta>`（旧字符串归一化）。
- REST：
  - `GET /api/library?kind=&q=` —— 条目列表（含文件预览 URL、字节数、是否已在该剧导入）
  - `GET /api/library/<kind>/<id>/<file>` —— 预览（图片/音频）
  - `POST /api/plays/<id>/assets/import` —— 导入 `{kind, entryId, expressions?}`
  - 素材上传/删除的既有路由不动。

### 5. Web

- `src/workshop/LibraryBrowser.tsx`：素材页「从资源库导入」打开的弹层。分类切换 + 关键词搜索 + 网格卡片（图片缩略图点开灯箱、音频就地试听、立绘包展示差分数与角色名）+ 每条一个「导入」按钮（已导入的打勾，重复导入显示「覆盖」）。
- 素材行的副标题显示 `manifest` 里的描述——导入的元数据在剧目里看得见，不只对 agent 有用。
- 立绘包导入后角色卡直接出现，差分映射已填好。

### 6. 工坊 agent

新增两个工具（工坊 prompt 同步说明）：

- `list_library` —— 罗列资源库。可选 `kind` 过滤 + `query` 关键词搜索；输出「id | 类型 | 标题 | 描述 | 标签」，上限截断并提示总数。这是「罗列 + 搜索」一个入口。
- `import_asset` —— `{kind, entryId, expressions?}`，立绘包可只导部分差分。回执说清落到哪些路径、play.json 变没变、剧本里该怎么引用（`<scene bg="…">` / `<actor expression="…">` / `<sfx src="…">`）。

导入二进制素材走既有的 `workshop_asset` 瞬态消息（对话流里内联显示，音频给播放器而不是图片），并触发本轮的 runtime 重建。工坊 agent **不写资源库**（只读浏览 + 导入），与「资源库由用户在本地目录管理」的产品决定一致。

### 7. 剧作家提示词与音频编排

BGM/SFX/立绘清单从「一行 stem 列表」改成**每条一行**的元数据描述（描述｜标签｜情绪/适用场景｜时长/是否可循环）。清单下面补编排规则：

- BGM 缺省续播（换景不换乐是对的），`bgm="none"` 才停；ambient 同理。
- 音量：`bgm_volume` / `ambient_volume` / `sfx volume`。
- 交叉淡入淡出由客户端固定 1.2s，不给模型旋钮。

DSL 改动（**加属性、不加标签**，属 DSL v1 冻结契约内的增补，改 spec.ts + 计划文档先行）：

- `SceneAttrs` 增 `bgm_volume?`、`ambient_volume?`。
- 语义定死：属性**缺省 = 保持当前**（不再是「缺省即停」）；`bgm="none"`（或 `""`）= 停止。
- 编排器写谱系时不再把缺省属性塞空串（重放要能区分「保持」与「停止」），`replay.ts` 同步。
- 客户端：ambient 通道（循环、低音量、可被 BGM 让位）、BGM/ambient 交叉淡入淡出、音量属性、sfx 并发上限。

## 实现清单

1. `packages/core/src/play/assets.ts`：`AssetMeta` / `LibraryEntry` / `parseAssetMeta` / 清单渲染辅助。
2. `apps/server/src/library.ts` + `assetImport.ts`；`store.assetMeta()`；`prompt.ts` 清单与编排段；`workshop.ts` 两个工具 + prompt 段；`http.ts` 三条路由；`config.ts` 的 `libraryRoot`；`playhouse/workshopSession` 接线。
3. `apps/web`：`api.ts`、`LibraryBrowser.tsx`、`AssetsPanel.tsx` 接线、素材行描述、chat 气泡的音频条目。
4. 音频补完：`script.ts` Cue、`director.ts` 视觉态、StageTheater 播放层、core spec/events/replay、orchestrator 谱系 attrs。
5. 种子素材：背景/立绘/BGM/SFX 落到 `library/`，逐条 meta.json（描述可被剧作家直接用）。
6. 测试：server 库扫描/搜索/导入/清单渲染用例；core 解析器增量属性用例；web 组件用例。端到端跑真实浏览器。

## 验收

- 资源库非空时，素材页能按分类与关键词翻找、试听/看图、一键导入；导入后立刻出现在剧目素材列表且带描述，剧目素材包能导出。
- 工坊 agent 能只靠工具找到并导入素材，导入后对话流里能看到条目，runtime 立刻重建。
- 剧作家 A 区里 BGM/SFX 带情绪、场景、时长、可循环标记，并能正确编排：BGM 跨场景续播、`none` 停、ambient 有声、淡入淡出无爆音。
- 素材页删除/剧目包导出/重启服务后行为不变。

## 风险与取舍

- **复制导致磁盘重复**：同一个背景在 3 部剧里存 3 份。接受——剧目包自包含是硬需求（导出/迁移/删除资源库不炸），省掉的是「引用」带来的整套生命周期耦合。
- **资源库无 UI 管理是刻意取舍**：用户要在浏览器里改一堆 JSON 元数据是折磨，但「元数据错了让 LLM 读错」的风险远小于「为了加素材先学一套管理界面」。元数据用 JSON 文件 + 注释文档承载，用户手改一次就顺手。
- **新增 DSL 属性**：冻结契约的增补而非改标签集；语义（缺省保持 vs none 停止）写进计划与 spec 注释，解析器是属性白名单 `pick`，改动面可控。
- **立绘包粒度**：以「角色」为条目而非单张图，与剧目 `sprites/<charId>/` 的结构对齐；代价是库粒度粗一点，导入时可用 `expressions` 挑子集缓解。

## 实施状态（已完成）

需求全部落地并通过三轮检视（`260930-asset-library.review.md` / `.review2.md` / `.review3.md`，最终**准入**）。

### 交付内容

| 块 | 落点 | 状态 |
| --- | --- | --- |
| 元数据契约 | `packages/core/src/play/assets.ts`（`AssetMeta`/`LibraryEntry`/`parseAssetMeta`/`describeAsset`/`libraryEntryMatches`） | ✅ 12 例测试 |
| 只读资源库 | `apps/server/src/library.ts`（`AssetLibrary` 扫描 + `filePath` 防穿越） | ✅ |
| 导入 | `apps/server/src/assetImport.ts`（复制不引用 + 两阶段 `ImportPlan`） | ✅ 20 例测试 |
| 串行锁 | `apps/server/src/store.ts` `withPlayConfigLock(store.dir, …)` | ✅ 反向验证过 |
| REST | `GET /api/library?kind=&q=`（含全量 `counts`）、`GET /library/<kind>/<id>/<file>`、`POST /api/plays/:id/assets/import`、`GET /api/plays/:id/assets/meta` | ✅ |
| Web | `LibraryBrowser.tsx`（分类 tab + 防抖搜索 + 灯箱/试听 + 导入/覆盖态）、`AssetsPanel` 接线 + 描述副标题 | ✅ |
| 工坊 agent | `list_library` / `import_asset` 两个工具 + `libraryGuide` 章节 | ✅ |
| 音频机制 | `loopAudio.ts`（双通道交叉淡入淡出 + SFX 上限 6）、`AssetIndex.ambient`、谱系音量往返 | ✅ 28 例 web 测试 |
| 提示词 | `AUDIO_RULES` 编排段 + 素材元数据逐条清单 | ✅ |
| 种子素材 | 66 条 = 12 背景 + 1 立绘包（nanase，4 差分）+ 20 BGM + 33 SFX | ✅ 0 告警 |

### 检视过程中修掉的问题

三轮检视共发现并修复 6 个阻塞、7 个建议，其中三个值得记：

1. **音量在重放时丢失**（`replay.ts` 的 `pickVolume`）：谱系存字符串、重放不还原成数字，刷新页面音量就回默认。
2. **空串音频 cue 三态退化**（`orchestrator.ts`）：空串会被 `pickDefined` 丢掉，「停止」退化成「保持」——刷新一下音乐又响起来。改为写谱系前把空串归一化成 `none`。
3. **剧目配置读改写竞态**（最隐蔽的一个）：`play.json` 与 `assets/manifest.json` 的写入方散在 http / workshop / workshopAssets / assetImport 四处，都是「读全量 → 改一项 → 写回」。第一版修法把锁挂在 `WeakMap<PlayStore>` 上，但 `PlayLibrary.store()` 每次调用都 new 一个实例，**每个 HTTP 请求持有不同实例，队列直接穿透，等于没锁**——而当时的单测恰好复用了同一个 store 变量，把这个洞测成了「通过」。第二版改用剧目目录路径做 key（`withPlayConfigLock(store.dir, …)`，挂在存储层而非业务模块），并把并发用例改成每次取新实例。改完做了反向验证：故意把 key 换回对象身份，用例当场失败。

### 遗留

- BGM 的听感质量机器判断不了，留了 5 条待人工试听清单（见 `seed-sources.research.md`）。其中 `bg_rainy_night` 原曲 278s 剪到 30s、`bgm_snowfall_loop` 本无缝循环被加了 30ms 淡入淡出，接上去可能仍有接缝。
- `bg_photo_corridor` 实拍自南亚学校走廊，不是日式校园，已在 `meta.json` 里注明。
- `bg_hd_parallax_glitch` 因 Starling 图层包被拍平成黄洞而未入库。
