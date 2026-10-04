# 261005 音乐生成 · 交付摘要

搭台助手（工坊）多了一个 `generate_bgm` 工具：库里有合适的曲子就导入，没有就自己写一首落进剧目。
受 capability「生成 BGM」管控，只装工坊。提示词最佳实践另做了一份 skill。

## 一、做了什么

### 1. 后端（Gemini 原生形状）

| 文件 | 作用 |
| --- | --- |
| `apps/server/src/musicBackend.ts` | `MusicBackend` 接口 + `GeminiMusicGen`。POST `/v1beta/models/{model}:generateContent`，`x-goog-api-key` 头，解析 `candidates[0].content.parts[0].inlineData`。mime → 扩展名映射（`audio/mp4`→`.m4a`） |
| `apps/server/src/musicFactory.ts` | `createMusicBackend(config)`：`!config.music.enabled` 返回 null（与 imageFactory 同一套「配齐才装得上」） |

音频只有一种协议形状，所以**没有 `format` 枚举**——不像生图那样有 gemini/modelslab/openai 三种。

### 2. 剧目层

`apps/server/src/playMusic.ts` 的 `PlayMusic`：

- 落 `assets/bgm/<id>.<ext>`，id 用 `assertAssetStem` 校验
- 同 stem 下别的扩展名清掉（素材索引按 stem 认，留着旧的会挑到上一首）
- 素材表只补自己确知的那几格（`title`/`mood`/`scene`/`loop`/`volume`/`source`），`description` 归工坊与用户不动
- 同名在飞的那次合并成一次；`existingUrl()` 供工具判重
- `source` 标成「站内生成（音乐生成后端）」，不是某个下载站

**刻意不并进 `PlayAssets`**：那个类的垫图、抠底、画幅档位、立绘差分基准全是给图准备的，
音乐一条都用不上，硬塞会让一个类同时管两件不相干的事。两者只共用 `withPlayConfigLock` 那把锁。

### 3. 工具（后台排产形态）

`apps/server/src/agentkit/musicTool.ts` 的 `generate_bgm`：

- **发起即返回**，不等曲子。照 `generate_image` 的 queued 形态。
- 剧目里已有同名曲子直接跳过（回执说明），不烧那一分半。
- 没配后端就**整个不注册**（与 `libraryTool` 同一套）：装一个必然失败的工具只会诱使模型空转。
- 工具描述只留契约；长篇提示词知识在 skill。

### 4. 排产、记账与到货

| 位置 | 改动 |
| --- | --- |
| `packages/core/src/ws/protocol.ts` | `PendingJob.kind` 加 `bgm`；`GeneratedAsset.type` 加 `bgm` |
| `apps/server/src/pendingJobs.ts` | `jobIdForMusic(name)` → `music:<name>`，与 `img:` 同口径（同名重生成覆盖同一条） |
| `apps/server/src/playhouse.ts` | `queueMusic()`：记账 → 跑活 → 广播 `asset_ready`。失败**不自动退场**（pendingJobs 的统一口径） |
| `apps/web/src/stage/PromptQueuePanel.tsx` | `bgm` → `volume` 图标（`mic` 已被语音合成的「正在出声」占着） |
| `apps/web/src/stage/generatedAssets.ts` | **bgm 不进生图台账**：预解码与骨架占位都是图的机制，音频没有骨架 |

**没有骨架占位那一层**：BGM 不进时间线，到货只是素材页多了一张可播放的卡。
客户端那条 `asset_ready` → 重拉素材列表的通路本来就与类型无关，所以素材页零改动就跟上。

判重两档：剧目里已有同名曲子直接跳过（不烧那一分半），用户明确要重做时才带 `overwrite=true` 覆盖；
同名在飞的那次合并成一次。

**到货刻意不回调 `workshop.pushAsset`**（检视发现并修掉的阻塞项）：那条通道会把前端置成 `busy`、
靠下一条 `workshop_done` 复位，而 BGM 是 84 秒后才到的——那时回合早收束完了，再置一次就再没有东西
解开它，工坊输入框被永久锁死。代价是工坊对话里没有内联预览：曲子到的那一轮早已结束，卡片那时还不存在。
`PlayMusic` 上连 `onAsset` 这个口都没有，并有一条用例守着它别被接回去。

### 5. capability

`CAPABILITY_CATALOG` 新增一行（分组「素材」，只给工坊）：

- `roles: ["workshop"]`，无 `locked` 无 `defaultOff` → **搭台默认开**，在 Agent 页自动出现在那张卡上
- 剧作家**不授权**，理由写进能力描述：生成一次音乐是分钟级开销，剧作家在写剧本时该从库里选曲而不是现生成
- `needs: "music"` → 服务端没配后端时亮「暂不生效」，但开关照旧给

### 6. 配置面（四处齐）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `music.enabled` | `false` | 关掉后工坊没有「生成 BGM」这一手 |
| `music.model` | `flow-music-lyria-3.5` | 换网关时改这个 |
| `music.apiKey` | `""` | **留空 = 用出图那把** |
| `music.baseUrl` | `""` | **留空 = 用出图地址** |
| `music.timeoutMs` | `300000` | 比出图宽：一首 ~176s 要 84s，2MB 量级 |

地址与 key 回落是刻意的：flow2api 一个进程同时挂图片与音频模型，两边填两遍是重复劳动。

**没有新增 `STAGE_*_ENABLED` env 开关**——开关走 `enabled` + capability + `play.json` 那条既有路。
凭据只走 `GET/PUT /api/config` 那一个保存入口，掩码回传，无旁路落盘。

![设置页「音乐生成」分组](/root/projects/stage-ai/docs/features/261005-music-generation/screenshots/settings-music-group.png)

实拍绝对路径：
`/root/projects/stage-ai/docs/features/261005-music-generation/screenshots/settings-music-group.png`

### 7. skill

`apps/server/skills/galgame-bgm/SKILL.md`（工坊经 `read_skill` 自读）：

四段式提示词 → 配器选型表 → 情绪词与「成对写走向」→ **无缝循环** → 声明值填法 → 无人声约束 →
和弦色彩与日系措辞 → 反例词表 → **mood/scene 必须对齐素材库既有 61 条的词表** → 完整范例 → 迭代修正顺序。

两处硬约束值得单说：

- **循环**：galgame 的一段对话十几分钟、同一首曲子循环几十次，头尾接不上就是一次出戏。
  写 `seamless loop` + `no fade in or fade out`；要循环就别写 `building to a climax`（每次循环都在同一处爬坡）。
- **词表对齐**：剧作家看不见音频，只能读 `mood`/`scene` 那一行，而且是在**资源库与生成曲混合的清单里**挑。
  自造「凄美」就成只此一条的孤岛，挑不出也匹配不上。词表是从库里 61 条真实 `meta.json` 现统计的。

## 二、顺手修掉的既有问题

`applySettings()` 原来只清 `modelCache`，**按剧目缓存的 `playAssets` 持有构造时的 backend 引用**——
改了生图的 key 或模型要重启才生效。清掉 `playMusic` 时顺手把 `playAssets` 也一起清了（同一个病根）。

## 三、检视后补的两处（都不是我第一版想到的）

1. **工坊输入框会永久锁死**（阻塞）。后台到货仍回调 `workshop.pushAsset`，而它会置 `busy: true`；
   BGM 到达时那一轮已经收束，没有任何后续 `workshop_done` 能复位。改为只走 `asset_ready`。
2. **舞台会一直静音**（阻塞）。`StageScreen` 的 `onAssetReady` 只为 `sprite` 重拉素材列表，
   而 `<scene bgm="id">` 正是拿那张列表寻址的——不重拉就一直按缺素材降级，直到用户整页刷新。
   把 `bgm` 一起纳入重拉。

另有一处契约自相矛盾：工具描述承诺「同名重生成会覆盖」，实现却是无条件跳过。加了 `overwrite` 参数
把两边对齐——默认跳过（防手滑烧配额），显式重做才覆盖。

## 四、验证

| 项 | 结果 |
| --- | --- |
| 接口实测 | 5 次真实调用，端点/请求/响应/音频形状/503 全部记录在 `.plan.md` |
| 真实产物 | 2,320,755 字节 M4A，`ffprobe` → AAC 48kHz 立体声 176.06s |
| 用例 | `test/music.test.ts` + `test/agentkit.test.ts` → **44 passed**；扩到 10 个受影响文件 → **233 passed**，core **179 passed** |
| 回归 | playhouse / workshop / workshopPrompt / settingsStore / config / configApi → 全绿 |
| typecheck | server 与 web 干净（`cli-cutout.ts` 的报错是并行 agent 的在途文件，与本改动无关） |

**跳过的**：真网关的端到端出曲（一次 84 秒且烧令牌池，连测三次就撞冷却）；
`generationConfig` 音频字段的探测（同上撞冷却，据实记在 `.plan.md` 1.7，探测是待办不是结论）。

## 五、待办

- [ ] 令牌池冷却过去后补测 `generationConfig` 里的音频字段。若真被支持，时长就不必再受制于 176s。