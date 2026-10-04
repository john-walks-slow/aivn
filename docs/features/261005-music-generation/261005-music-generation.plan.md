# 261005 音乐生成（计划与实测记录）

给搭台助手（工坊）加一个后台生成 BGM 的工具，受 capability 管控；另加一份 galgame 风格 BGM 提示词的 skill。

## 一、接口实测记录（本机的 flow2api 网关）

实测于 2026-10-05，网关 `http://127.0.0.1:38000`（本机服务，直连不过代理）。
下面每条都是实测打出来的，不是照图片那条推的。

### 1.1 端点与鉴权

与生图同一套 Gemini 原生形状，凭据走 `x-goog-api-key` 头：

```
POST /v1beta/models/{model}:generateContent
x-goog-api-key: <key>
```

### 1.2 可用模型（`GET /v1beta/models`，共 76 个）

音乐相关的四个：

| 模型 | 实测结果 |
| --- | --- |
| `flow-music-lyria-3.5` | **可用**。本特性默认模型 |
| `flow-music-lyria-3-pro` | 请求能进来，但当时返回 **503**（见 1.6） |
| `musicfx` / `lyria` | 未单独验证（那两次探测被 20s 超时切掉了，不是报错） |

### 1.3 请求体：只有纯文本提示词

```json
{
  "contents": [{ "role": "user", "parts": [{ "text": "solo piano, warm, slow tempo, gentle" }] }]
}
```

**不带 `generationConfig` 就能出音频**——所以音频生成配置不是必填项，这一点是实测确认的。

### 1.4 响应体：内联 base64，不是文件 URL

```json
{
  "candidates": [{
    "content": { "parts": [{ "inlineData": { "mimeType": "audio/mp4", "data": "<base64>" } }] },
    "finishReason": "STOP"
  }],
  "modelVersion": "flow-music-lyria-3.5"
}
```

**与图片那条一致，也是 `inlineData`**：不存在「返回一个 URL 再去下载」的第二步，一次响应就带全了音频。
`finishReason` 单独挂在 `candidates[0]` 上（不在 `parts` 里），失败排查要看它。

### 1.5 实际音频形状

| 项 | 实测值 |
| --- | --- |
| mimeType | `audio/mp4` |
| 容器 | `mov,mp4,m4a,3gp,3g2,mj2`，文件头 `ftypM4A ` |
| 编码 | **AAC**，48 kHz，立体声 |
| 时长 | **176.06 秒** |
| 码率 | 105450 bps |
| 体积 | 2,320,755 字节（base64 3,094,340 字符，约 4:3 膨胀） |

三点直接影响实现：

1. **落盘扩展名必须跟 mime 走**：`audio/mp4` → `.m4a`。写死 `.mp3` 会让浏览器按错的 codec 播。
2. **扩展名逐个回退**：素材名不带扩展名，判重时按 `.m4a/.mp3/.ogg/.wav` 依次试（用户手传的可能是别的）。
3. **体积是 2MB 量级**：比图片大一个档，所以超时给得比出图宽（300s vs 90s）。

### 1.6 令牌池与 503

连测两次生成之后，第三次开始返回：

```json
{ "error": { "code": 503,
  "message": "没有可用的Token进行音频生成。所有Token都处于禁用、冷却、锁定或已过期状态。",
  "status": "UNAVAILABLE" } }
```

**这是令牌池冷却，不是偶发网络错**——立刻重试没有用，要等。这是后台排产的一个额外理由：
同步等待的那一轮正好把用户的整轮时间耗在这上面，而它本来还可能撞上冷却。

### 1.7 未测出的一项（据实记录）

**`generationConfig` 里的音频字段是否被识别，这次没能测出来。** 探测请求发过去时令牌池已进入冷却，
拿到的是 1.6 的 503 而不是字段回显，所以拿不到「字段被静默忽略」还是「被接受」的判据。

**已知能确定的**只有：1.3 里不带 `generationConfig` 也能出音频，即它不是必填项。

因此实现取保守解：**一个音频字段都不传**，时长与循环意图只靠提示词表达（这条写进 skill 第 3、4 节）。
等冷却过去后值得补一次探测——如果 `durationSeconds` 之类真被支持，时长就不必再受制于 176s。

## 二、设计决定

### 2.1 产物落 `assets/bgm/`，不落 `library/`

`library/` 是用户手工维护、服务端只读的目录（产品决定）。生成物属于剧目素材，与 `generate_image` 同构。
素材描述写进 `assets/manifest.json`，`source` 标成「站内生成（音乐生成后端）」而不是某个下载站。
id 用 `assertAssetStem` 校验。

### 2.2 只装工坊，剧作家不授权

生成一次音乐是分钟级开销（84s），而剧作家一轮只有 240s——塞进演出回路等于整轮都在等一首歌落盘。
产品判断：剧作家在写剧本时该**从库里选曲**而不是现生成。这一条写进了能力描述里。

对照：工坊拿到的是 `import_asset`，剧作家那边由「引用即导入」这条默认路径顶替，同样不留自己搬素材的口。

### 2.3 后台排产，不在回合里等

照 `generate_image` 的 queued 形态：

- 工具**立即返回**排产文案；
- 记账挂进 `pendingJobs`（`kind: "bgm"`，id `music:<name>`，面板上看得见在等什么、已等多久）；
- 跑完经 WS 广播 `asset_ready`（`type: "bgm"`），客户端沿用现有的到货刷新通路；
- **没有骨架占位那一层**：BGM 不进时间线，到货只是素材页多了一张可播放的卡。

判重两档：剧目里已有同名曲子直接跳过（不烧那一分半），同名在飞的那次合并成一次。

### 2.4 提示词知识放 skill，不放工具描述

工具描述只留契约（怎么调、落哪、怎么引用、要等多久）；「什么样的 prompt 才出得来日系味」放
`skills/galgame-bgm/SKILL.md`，由 `read_skill` 按需读取。与出图那条渐进披露同一套规矩：
塞进工具描述里的东西它每轮都付钱。

## 三、待办与后续

- [x] 后端（`musicBackend.ts` / `musicFactory.ts`）
- [x] 剧目层（`playMusic.ts`，落盘 + 素材表声明 + 判重）
- [x] 工具（`musicTool.ts`，queued 形态）
- [x] capability「生成 BGM」（只装工坊、默认开）
- [x] 配置面四处（`config.ts` / `configApi.ts` / 设置页 / README）
- [x] 提示词排产 + `pendingJobs` 记账 + `asset_ready` 广播
- [x] skill（含无缝循环、无人声约束、既有词表对齐）
- [x] 测试
- [ ] **冷却过去后补测 `generationConfig` 音频字段**（见 1.7）