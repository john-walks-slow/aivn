# 免费线上音频资源接入调研（BGM / SFX）

> 调研日期：2026-10-04
> 调研场景：自托管 galgame / 视觉小说引擎（Node/TypeScript），素材库 `library/bgm/<id>/` 与 `library/sfx/<id>/`（目录名即素材 id），剧本 DSL `<scene bgm="id" />` / `<sfx src="id" />` 引用，引用到的素材**被复制**进剧目目录 `assets/`，剧目可打包导出给其他用户。
>
> **判定尺子**：本调研判定的是「**音频文件本身能否随项目再分发**」，不是「能不能拿来用」。
>
> | 档位 | 含义 |
> |---|---|
> | ✅ 可入库 | CC0 / 公有领域 / 许可明确允许原文件再分发 |
> | ⚠️ 有条件 | CC BY / CC BY-SA（需署名）。**署名落地位置**：`library/<kind>/<id>/meta.json` 的 `attribution` 字段 + 剧目 `assets/manifest.json`（导出包随附署名清单） |
> | ❌ 不可入库 | 只允许「使用」，不允许把原文件放进可分发的包（royalty-free 但禁止 standalone redistribution） |
> | 🔗 仅远端引用 | 只允许使用不允许再分发，但若剧目**不下载、只引用远端 URL** 或许可行（本引擎不适用，因为当前设计是复制进 `assets/`） |
>
> **测试环境**：墙外站点一律 `curl -x http://127.0.0.1:7890`；国内站点直连。所有「实测」行均为 2026-10-04 真实请求结果。

---

## 0. 结论速览

### 0.1 总表

| # | 源 | 类别 | 有无 API | 许可档位 | 一句话结论 |
|---|---|---|---|---|---|
| A1 | **Freesound** | SFX + BGM | ✅ API v2 | ✅ CC0 / ⚠️ CC BY | 搜索需免费 token；**preview 文件匿名可直下**（实测 200）；API 条款限非商用 |
| A2 | **Openverse** | 聚合（4 个源） | ✅ API | 按 license 字段 | **匿名即可用、无需 key**（实测 200）；限 20/min、200/day；是 Freesound preview 的最佳无 token 入口 |
| A3 | **Jamendo** | BGM | ✅ API v3 | ⚠️ CC BY / ❌ BY-NC / ⚠️ BY-SA | 需免费 client_id；官方测试 id 已停用（实测）；下载受 `audiodownload_allowed` 门控 |
| A4 | **ccMixter** | BGM | ✅ Query API 2.0 | ⚠️ CC BY / ✅ PD / ❌ BY-NC | 站点仍在维护（实测 200）；mp3 直下**需带 Referer**（实测无 Referer 403） |
| A5 | **Free Music Archive** | BGM | ❌ API 已停 | ⚠️ CC 系 | API 官方下线，且**明文禁止抓取搜索结果 HTML** |
| A6 | **Pixabay** | BGM + SFX | ❌ 无音频端点 | ❌ 禁 standalone 再分发 | API **只有图片和视频，没有音频**（实测）；CDN mp3 可直下但站点 Cloudflare 挡抓取 |
| A7 | **Wikimedia Commons** | BGM/环境音 | ✅ MediaWiki API | ✅ CC0/PD 占多数 / ⚠️ CC BY | 4,429,992 个音频文件（实测），CC0 系约 117 万；直链稳定可下 |
| A8 | **Internet Archive** | BGM/环境音 | ✅ advancedsearch + metadata | ✅ PD/CC0 为主 | `advancedsearch.php` + `/metadata/<id>` 全可脚本化；直链 302→200 实测通过 |
| A9 | **Musopen / IMSLP** | 古典 | ❌ / ⚠️ 仅乐谱元数据 | PD | Musopen **无公开 API**（实测 404/403）；IMSLP 只有乐谱元数据 API |
| B1 | **incompetech** | BGM | ❌ | ⚠️ CC BY 4.0 | 全站 CC BY 4.0 + 另有 `llms.txt` 机器可读目录；credit 文案有指定格式 |
| B2 | **OpenGameArt** | SFX + BGM | ⚠️ RSS / 无 JSON | ✅ CC0 / ⚠️ CC BY | RSS 可用（实测 200）；`?_format=json` **无效**（返回 HTML）；需解析 HTML |
| B3 | **itch.io CC0 包** | SFX | ❌（半脚本化） | ✅ CC0 / ⚠️ CC BY | **PWYW $0 包可匿名走通下载链**（实测），但拿到的是 session 绑定的签名页，**无永久直链** |
| B4 | **FreePD.com** | BGM | ❌ | ✅ PD/CC0 | **站点已永久关闭**（实测页面显示 Site Closed） |
| B5 | **Chosic** | BGM | ❌ | ⚠️ CC BY / ✅ PD | 页面 403（反爬）；mp3 直链可从 HTML `data-url` 抽；CC BY 需署名 |
| B6 | **Bensound** | BGM/SFX | ❌ | ❌ | 免费档只许「在线视频/教育用途」，且每条视频绑定一次性授权码 |
| B7 | **Mixkit** | SFX | ❌ | ❌（🔗 有限） | "You can't redistribute the Item on its own" |
| B8 | **Zapsplat** | SFX | ❌ | ❌ | "must not be redistributed outside of your project" |
| B9 | **Sonniss GDC** | SFX | ❌ | ❌ | 2024-01-28 修订**删除了自由分发权**；FAQ 明文「Not as standalone files」 |
| J1 | **OtoLogic** | BGM + SFX | ❌ | ✅ **明确允许再分发** | CC BY 4.0，FAQ 原文确认可把素材本身再分发给第三方 |
| J2 | **効果音ラボ** | SFX | ❌ | ❌ | 再配布禁止 + 直リンク禁止。**注意：站点是 `soundeffect-lab.info`，`soundlabo.com` 是待售域名（实测）** |
| J3 | **魔王魂** | BGM + SFX | ❌ | ⚠️ CC BY 4.0（可选） | 官方提供「CC 许可 or 自家规约」二选一，选 CC BY 4.0 时可再分发 |
| J4 | **DOVA-SYNDROME** | BGM | ❌ | ❌ | 明文禁止「音源を配布」及「エンドユーザーが容易に音源ファイルにアクセスできる状態」 |
| J5 | **ポケットサウンド** | BGM + SFX | ❌ | ❌ | 「音素材そのものの二次配布・転売」禁止 |
| J6 | **甘茶の音楽工房** | BGM | ❌ | ❌ | 「音楽だけを販売したり、2次配布することは禁止」 |
| J7 | **JapanSoundTokyo / 効果音辞典 / 音彩工房** | SFX/BGM | ❌ | ❌ | 全部「再配布禁止」 |
| B10 | **Oculus Audio Pack 1** | SFX | ❌（zip） | ⚠️ CC BY 4.0 | 500+ WAV，Meta 官方页面明写 CC BY 4.0 |
| B11 | **Kenney.nl** | SFX | ❌（zip） | ✅ CC0 | 音频分类含 Interface/Impact/RPG/UI 等，全 CC0 |
| C1 | **HuggingFace 数据集** | BGM + SFX 批量 | ✅ | 按数据集 | 有几个可直接拉的 CC0 大包（体积见 §C1） |
| C2 | **本地生成模型** | 替代路线 | — | 见 §C2 | ACE-Step 最宽松（Apache-2.0 / v1.5 MIT）；MusicGen 权重 CC-BY-NC；Stable Audio Open 有 $1M 门槛 |

### 0.2 给本引擎的三条可落地路线

1. **SFX 主力 → Freesound（经 Openverse 检索）**：用 Openverse 匿名 API 按 `license=cc0` 搜 Freesound 的 preview mp3，拿到的 `url` 就是 `cdn.freesound.org` 直链，实测匿名 200 可下。完全不需要 Freesound token，绕开了 Freesound「API 仅限非商用」的条款问题（但下载行为本身仍走 Freesound CDN，署名按 CC0 不强制）。
2. **BGM 主力 → Wikimedia Commons + Internet Archive**：两者都是 CC0/PD 占多数，直链稳定、无鉴权、无速率墙，实测均通过。
3. **需要「零署名负担」时 → Kenney.nl / Oculus Audio Pack（⚠️署名）/ HuggingFace CC0 数据集**。

**必须避开**：Pixabay 音频（无 API + 许可禁 standalone）、Sonniss、Zapsplat、Mixkit、Bensound、DOVA-SYNDROME、効果音ラボ、ポケットサウンド、甘茶 —— 这些的导出包即构成「原始文件再分发」。

---

## A 类：有正式 API、免费、无需付费的

### A1. Freesound API v2

**站内信息**：`https://freesound.org/`（实测代理 200）

#### A1.1 免登录能不能拿到音频？—— 分两件事

| 问题 | 答案 | 实测 |
|---|---|---|
| 免登录能否**搜索**？ | **不能**，必须 token | `GET https://freesound.org/apiv2/search/text/?query=footsteps&page_size=2` → **HTTP 401** |
| 免登录能否取**单个声音元数据**？ | **不能** | `GET https://freesound.org/apiv2/sounds/68441/` → **HTTP 401** |
| 免登录能否**下载 preview 文件**？ | **能**，CDN 无鉴权 | `GET https://cdn.freesound.org/previews/68/68441_871124-hq.mp3` → **HTTP 200**，`content-type: audio/mpeg`，`content-length: 36217` |
| 免登录能否下载**原始文件**？ | **不能**，必须 OAuth2 | 官方文档：`Download Sound (OAuth2 required)` |

用户提到的 `https://freesound.org/data/previews/<id>/<id>_hq.mp3` 形状**部分正确但不精确**：
- 旧路径前缀会 301 跳到 CDN：`https://freesound.org/data/previews/316/316847_5121236-hq.mp3` → **HTTP 301** `location: https://cdn.freesound.org/previews/316/316847_5121236-hq.mp3`
- 正确形状是 `https://cdn.freesound.org/previews/<floor(sound_id/1000)>/<sound_id>_<uploader_userid>-hq.mp3`
- **文件名里的 `<uploader_userid>` 无法从 sound_id 推出**，所以「纯靠拼 URL 批量拿」不可行；必须走 API/聚合器的元数据。

实测多条样本（经 Openverse 拿到的真实 URL，全部 200）：

```
https://cdn.freesound.org/previews/342/342465_3906011-hq.mp3   → 200 audio/mpeg 196499 B
https://cdn.freesound.org/previews/155/155139_2098884-hq.mp3
https://cdn.freesound.org/previews/138/138681_2536305-hq.mp3
https://cdn.freesound.org/previews/232/232335_4194262-hq.mp3
https://cdn.freesound.org/previews/336/336328_4067257-hq.mp3
https://cdn.freesound.org/previews/208/208520_2305278-hq.mp3
https://cdn.freesound.org/previews/256/256954_233371-hq.mp3
https://cdn.freesound.org/previews/260/260778_4865436-hq.mp3
```

`-lq` 变体同样可下：`.../342465_3906011-lq.mp3` → **200**，74112 B。

#### A1.2 preview 音质与长度限制（官方原文）

> `previews` | object | no | Dictionary containing the URIs for mp3 and ogg versions of the sound. The dictionary includes the fields `preview-hq-mp3` and `preview-lq-mp3` (for **~128kbps** quality and **~64kbps** quality mp3 respectively), and `preview-hq-ogg` and `preview-lq-ogg` (for **~192kbps** quality and **~80kbps** quality ogg respectively). — [Freesound API Resources](https://freesound.org/docs/api/resources_apiv2.html)

- preview **没有官方长度上限**（截取全曲预览，受原始文件长度决定）；实际观测到的时长字段 `duration` 单位是毫秒（例：`"duration":1540` = 1.54s）。
- **hq mp3 只有 128kbps** —— 这是最主要的质量天花板。想把 Freesound 当 BGM 主力的话，128kbps mp3 听起来会明显不如常见 320kbps 素材，建议只用作 SFX。

#### A1.3 拿 token 的确切流程

1. 注册 Freesound 账号（免费，**不绑卡**）。
2. 打开 `https://freesound.org/apiv2/apply`（实测直接 GET 返回 **HTTP 302**，需登录态才能看表单）。
3. 填表申请 API credential，页面会给「Client secret / Api key」两列，**用 `Api key` 那一列**。
4. 每次请求作为 `token` 查询参数带上：`?token=<api_key>`。
5. OAuth2 用于上传/评分/下载原始文件，走 RFC6749 authorization code grant，全部必须 https。

官方原文：

> In order to start using APIv2 you'll need an API credential that you can request in https://freesound.org/apiv2/apply. Basic API calls can be authenticated using a typical api key mechanism in which you'll need to add the key given with your APIv2 credential into every request you make. You'll need to add the key as a `token` request parameter.
>
> Retrieving previews does not require OAuth2 authentication. — [APIv2 Overview](https://freesound.org/docs/api/overview.html)

> To authenticate API calls with the token strategy you'll ... You should use the keys in 'Client secret ... Api key' column, which are long alphanumeric strings. You should get a different API key for every application you develop. — [Authentication](https://freesound.org/docs/api/authentication.html)

#### A1.4 CC0 过滤参数

用 `filter` 参数（Solr 语法），字段名见 Sound Instance 表：

```
GET /apiv2/search/text/?query=footsteps&filter=license:"Creative Commons 0"&fields=id,name,license,previews,duration
```

官方原文：

> The `license` field: The Creative Commons license under which the sound is available to you ("Attribution", "Attribution NonCommercial", "Creative Commons 0").
>
> Filters are defined with a syntax like `filter=filtername:value filtername:value` (that is the Solr filter syntax). For multi-word queries, the values must be enclosed in double quotes and separated by spaces (`filter=filtername:"val ue"`). — [Resources](https://freesound.org/docs/api/resources_apiv2.html)

**Freesound 只有 3 种许可**：`Creative Commons 0` / `Attribution` / `Attribution NonCommercial`（**没有 BY-SA、没有 BY-ND**）。

#### A1.5 速率限制

Freesound 文档未公布具体数字，但有硬性要求：

> Do not abuse server bandwidth. Make reasonable use of the API and respect request limits. **Do not register multiple API keys to circumvent request limitations.** — [Terms of Use](https://freesound.org/docs/api/terms_of_use.html)

第三方客户端实现里按 throttle window 跟踪用量（`FreesoundUsageTracker`），通常按分钟/天两档。

#### A1.6 ⚠️ 最关键的条款：API 仅限非商用

> **You can use the Freesound API for free only for non-commercial purposes.** To use the Freesound API for commercial purposes, please contact us using the Freesound contact form and we will talk about licensing options.
>
> Be fair with your usage of the Freesound API. Do not use the api to replicate Freesound in another site or to present Freesound data pretending it is yours. Remember to properly credit Freesound and Freesound users in accordance to sounds' licenses. — [Freesound API Terms of Use](https://freesound.org/docs/api/terms_of_use.html)

**这对本项目的含义**：本项目是自托管、非营利的开源引擎，**API 用途本身属非商用**，条款可接受。但若将来此引擎被用于商业发行，走 Freesound API 这一路径需要另行联系 Freesound 取得商用许可。

#### A1.7 许可档位判定

| 内容 | 档位 | 依据 |
|---|---|---|
| Freesound **CC0** 声音的 preview / 原始文件 | ✅ **可入库** | CC0 1.0 全文允许 reproduce and Share the Licensed Material |
| Freesound **Attribution (CC BY)** 声音 | ⚠️ **有条件** | 需署名；`meta.json` 写 `attribution`，`assets/manifest.json` 汇总 |
| Freesound **Attribution NonCommercial** | ❌ **不入库** | NC 限制与「可自由分发的开源素材库」不兼容 |
| 用 **API** 抓取的行为 | ⚠️ 非商用 | 见 A1.6 |

Freesound 官方对 CC0 的白话解释：

> for the "zero" license you can do pretty much what you want with the sound. You could even sell the sound, ... but you can't claim you are the author! — [Freesound FAQ](https://freesound.org/help/faq/)

#### A1.8 元数据字段里可直接拿来入库的东西

- `id`, `name`, `tags`, `username`, `license`（默认返回字段）
- `previews` → `preview-hq-mp3` / `preview-lq-mp3` / `preview-hq-ogg` / `preview-lq-ogg`
- `duration`（毫秒）、`filesize`、`samplerate`、`channels`、`bitrate`、`type`（扩展名）
- `description`（含 HTML），`created`，`num_downloads`，`avg_rating`
- `analysis`（需 `descriptors` 参数）—— 内容分析特征，可用于自动 mood 分类

---

### A2. Openverse API

**站内信息**：`https://api.openverse.org/`（WordPress 基金会项目）

#### A2.1 匿名调用要不要 key —— 不要

> Openverse provides free and open access to the Openverse API to **anonymous and registered users**. [...] **Anonymous requests should be sufficient for most users.** Indeed, https://openverse.org itself operates using anonymous requests from the browser.
>
> Registered users are automatically granted slightly higher limits. [...] Exceeding the limit will result in '429: Too Many Requests' responses. — [api.openverse.org](https://api.openverse.org/)

**实测（全部匿名、无任何 header 鉴权）**：

```
GET https://api.openverse.org/v1/audio/?q=piano&license=cc0&page_size=2
→ HTTP 200
{"result_count":240,"page_count":120,"page_size":2,"page":1,
 "results":[{"id":"0eb636a7-...","title":"Piano C.wav",
   "url":"https://cdn.freesound.org/previews/68/68441_871124-hq.mp3",
   "creator":"pinkyfinger","license":"cc0","license_version":"1.0",
   "license_url":"https://creativecommons.org/publicdomain/zero/1.0/",
   "provider":"freesound","source":"freesound",
   "filesize":36217,"filetype":"mp3","bit_rate":128000,
   "duration":1540,
   "attribution":"\"Piano C.wav\" by pinkyfinger is marked with CC0 1.0. ...",
   "alt_files":[{"url":"https://freesound.org/apiv2/sounds/68441/download/","filetype":"wav", ...}],
   ...}]}
```

#### A2.2 限流（实测响应头）

```
x-ratelimit-limit-anon_burst: 20/min
x-ratelimit-available-anon_burst: 19
x-ratelimit-limit-anon_sustained: 200/day
x-ratelimit-available-anon_sustained: 199
```

第三方文档补充：

> Anonymous Tier — Applied to unauthenticated requests. Throttled at 1 request per second. **Page size capped at 20 results. Any page_size > 20 without authentication returns a 401 Unauthorized response.**

**实测印证**：

```
GET /v1/audio/?q=piano&license=cc0&page_size=21  → HTTP 401
GET /v1/audio/?q=piano&license=cc0&page_size=20  → HTTP 200
```

> ⚠️ 200 request/day 的天花板很低。若要做全量灌库，必须注册 OAuth2 应用（免费，只需 name/description/email，不绑卡）。

**注册流程（免费）**：

```bash
# 1) 注册应用
curl -X POST -H "Content-Type: application/json" \
  -d '{"name":"<app-name>","description":"<desc>","email":"<you>@example.com"}' \
  https://api.openverse.org/v1/auth_tokens/register/
# → 201 {"client_id":"...","client_secret":"...","name":"..."}

# 2) 换 access token
curl -X POST -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=client_credentials&client_id=<id>&client_secret=<secret>' \
  https://api.openverse.org/v1/auth_tokens/token/
```

实测 `POST /v1/auth_tokens/register/`（空 body）→ **HTTP 400**（端点存在，仅参数校验失败）。

⚠️ **注册后必须点邮件里的验证链接**，否则限流仍按匿名档：

> You must verify your email address by click the link sent to you in an email. Until you do that, the application will be subject to the same rate limits as an anonymous user.

注册后 `page_size` 上限 500。

#### A2.3 音频来源覆盖（实测有效值）

`GET /v1/audio/?source=wikimedia` → 报错并回列合法值：

```json
{"detail":{"source":["Invalid source parameter 'wikimedia'. No valid sources selected.
 Refer to the source list for valid options: 'wikimedia_audio', 'jamendo', 'freesound', 'ccmixter'."]}}
```

**只有 4 个源**：`freesound` / `jamendo` / `wikimedia_audio` / `ccmixter`。

实测各源计数（`q=piano&license=cc0` 场景下 `result_count`）：

| source | 实测 result_count |
|---|---|
| `freesound` | 240 |
| `jamendo` | 240（注意：该值为分页上限表现，非全库计数） |
| `ccmixter` | 有效 |
| `wikimedia_audio` | 有效 |

#### A2.4 过滤能力

`/v1/audio/` 支持参数：`q`、`source`、`excluded_source`、`license`、`license_type`、`creator`、`tags`、`title`、`filter_dead`（默认 true）、`extension`、`mature`、`category`、`length`、`page`、`page_size`。

**license 合法值**：

> available licenses include: `by`, `by-nc`, `by-nc-nd`, `by-nc-sa`, `by-nd`, `by-sa`, `cc0`, `nc-sampling+`, `pdm`, and `sampling+`

**license_type 合法值**：`all`, `all-cc`, `commercial`, `modification`（实测三个值均返回 200）。

**⚠️ 重要限制（官方明文）**：

> Although there may be millions of relevant records, only the most relevant several thousand records can be viewed. **This is by design: the search endpoint should be used to find the top 10,000 most relevant results, not for exhaustive search or bulk download of every barely relevant result.** As such, the caller should not try to access pages beyond `page_count`, or else the server will reject the query.

#### A2.5 能不能直下

能。`results[].url` 就是媒体文件本身的可下载直链（实测 200）。

**对 Freesound 源**：`url` 是 `cdn.freesound.org` 的 **preview mp3（128kbps）**；`alt_files[].url` 是 `https://freesound.org/apiv2/sounds/<id>/download/`（**原始文件，需 OAuth**）。

**⚠️ 这是个漂亮的绕过**：Openverse 把 Freesound 的 **license 元数据 + preview 直链**都吐出来了，而且**不需要 Freesound token**，因此也不受 Freesound「API 仅限非商用」条款约束（你用的是 Openverse 的 API）。

#### A2.6 许可档位判定

| 内容 | 档位 |
|---|---|
| `license=cc0` / `license=pdm` / `license=by` 结果中的文件本体 | ✅ 可入库 / ⚠️ 需署名（依具体 license 字段） |
| `license=by-nc*` 结果 | ❌ 不入库 |
| Openverse 提供的 `attribution` 字段 | **直接可用**，格式如 `"\"Piano C.wav\" by pinkyfinger is marked with CC0 1.0. To view the terms, visit https://creativecommons.org/publicdomain/zero/1.0/."` |

`attribution` 字段官方定义：

> `attribution` | ReadOnlyField | The plain-text English attribution for a media item. Use this to credit creators for their work and fulfill legal attribution requirements.

**这正好可以直接写进 `meta.json` 的 `attribution` 字段。**

---

### A3. Jamendo API v3

**站内信息**：`https://developer.jamendo.com/v3.0`

#### A3.1 client_id 申请流程（免费）

1. 到 `https://devportal.jamendo.com` 注册 developer 账号（免费，不绑卡）。
2. 在账号里 create an "application"。
3. 每个 application 给一个 `client_id`（公开）和一个 `client_secret`（保密，只有 OAuth2 写操作才用）。

官方原文：

> Every api call needs the 'client_id' GET parameter. To get your client_id, you have to sign up for a developer account on our Developer Portal. [...] For each application you will get a private 'client_id' that you can use to authenticate all API queries made by your application. **If you want to make some quick tests, you can use this client id: 709fa152 (ONLY for TESTING the read api).** — [Authentication](https://developer.jamendo.com/v3.0/authentication)

**⚠️ 实测：这个官方测试 id 已经不能用了。**

```
GET https://api.jamendo.com/v3.0/tracks/?client_id=709fa152&format=json&limit=2&license_cc0=1&include=licenses
→ HTTP 200（但内容是失败）
{"headers":{"status":"failed","code":11,
  "error_message":"Jamendo Api Suspended Application Error: Your application has been suspended, please contact Jamendo",
  "warnings":"","results_count":0},"results":[]}
```

**结论**：必须自己注册 developer 账号拿真实 client_id 才能测。文档里那句「用 709fa152 快速测试」已经失效。

#### A3.2 search 能否按 CC license + tags/mood 过滤 —— 能

`GET https://api.jamendo.com/v3.0/tracks/`

**许可过滤参数**（官方原文）：

| 参数 | 官方描述 |
|---|---|
| `ccsa` | Creative Commons Share Alike. Explicit this paramenter if you need to enforce some strict conditions on the type of license. |
| `ccnd` | Creative Commons No Derivs. |
| `ccnc` | Creative Commons Non Commercial. |
| `prolicensing` | Filter to get only tracks subscribed to our single track licensing commercial program |
| `probackground` | Filter to get only tracks subscribed to our background music commercial program |

⚠️ **文档里没有 `license_cc0` 这个参数**（我实测传了没报错但拿不到结果，因为 app 已停用）。**没有直接的「只要 CC0」开关**。判断 CC0 只能靠返回的 `license_ccurl` 字段自己解析 —— CC0 在 Jamendo 上极罕见（Jamendo 主体是 CC BY / BY-NC / BY-SA）。

**tags / mood 过滤**：

| 参数 | 说明 |
|---|---|
| `tags` | 布尔式，`[rock+pop]` = `rock AND pop`。支持 genre / instrument / theme / **nc tags**（"nc" = non-commercial tags，不是 NC 许可） |
| `fuzzytags` | 模糊式，`[rock+pop]` = `rock OR pop`，AND 结果排前 |
| `search` | 全文（曲名+专辑名+艺人名+tags+相似艺人） |
| `featured` | `featured=1` 取官方精选，可按 genre 做榜单 |
| `boost` / `order` | `order` 含 relevance / popularity_total / releasedate_desc 等 |

官方推荐的「按氛围做歌单」写法：

> to implement a genre-based chart in your application, we suggest to choose one of our featured selections: **lounge, classical, electronic, jazz, pop, hiphop, relaxation, rock, songwriter, world, metal, soundtrack**. Declare one of these genres in the 'tags' parameter, combine it with 'featured=1', 'groupby=artist_id', and then boost (boost, not order!) choosing your favorite rating.

#### A3.3 audio URL 能否直下

返回字段有两个：

- `audio` → 流媒体 URL，形状：`https://prod-1.storage.jamendo.com/?trackid=235&format=mp31&from=app-devsite`
- `audiodownload` → 下载 URL，形状：`https://prod-1.storage.jamendo.com/download/track/235/mp32/`

**合法格式**（`audioformat` 参数）：`mp31`（96kbps，默认）/ `mp32` / `ogg` / `flac`。

⚠️ **关键门控：`audiodownload_allowed`**

> Since February 2021, a new field 'audiodownload_allowed' is returned in this api. It contains a boolean to know if you can propose or not the possibility to download the track through your application. Indeed, **now Jamendo artists can choose if they want to allow or not the download of their tracks.** [...] Moreover, in August 2020, the content of the field 'audiodownload' returned in this api will become an empty string if 'audiodownload_allowed' is false. — [tracks method](https://developer.jamendo.com/v3.0/tracks)

还有一个专门的重定向下载端点：

```
GET https://api.jamendo.com/v3.0/tracks/file/?client_id=<id>&id=<trackid>&action=download
→ 302 redirect 到真实文件
```

> The 'file' method represent an exception to the norm. Instead of returning a document object, here we http-redirect to the requested file url, in order to let your application download a certain resource. [...] **in April 2022, the api /v3.0/tracks/file will start returning 404 error if 'audiodownload_allowed'/'track_audiodownload_allowed' is false for the track you are trying to download.** — [tracks/file](https://developer.jamendo.com/v3.0/tracks/file)

#### A3.4 速率限制

> | | Non-Commercial Apps |
> |---|---|
> | Access our public API | ● |
> | Access our whole library | ● |
> | Number of API requests per month | **Up to 35,000** |
> | Monetize your app | ● |

**35,000 请求/月**（免费档）。`limit` 单次最大 200。

#### A3.5 CC BY / BY-NC / BY-SA 的差别（对本项目）

Jamendo 自己不区分「CC0」概念，全部走 CC。本项目要「原文件可再分发」：

| 许可 | 可否入库 | 说明 |
|---|---|---|
| **CC BY** | ⚠️ 可入库 | 需署名（曲名 / 艺人 / license URL / 是否修改）。`meta.json` + `manifest.json` |
| **CC BY-SA** | ⚠️ 可入库，但**有传染性风险** | SA 要求衍生作品以同协议发布。"把音乐同步进游戏"按 CC 4.0 定义**算 Adapted Material**（`where the Licensed Material is a musical work, performance, or sound recording, Adapted Material is always produced where the Licensed Material is synched in timed relation with a moving image`）→ 理论上会要求整个剧目以 BY-SA 发布。**对本引擎是实质负担，建议默认排除 BY-SA** |
| **CC BY-NC** | ❌ 不入库 | 非商用限制与开源分发冲突 |
| **CC BY-ND** | ⚠️ 可入库（同步即算改编，ND 反而有争议） | ND 禁止改编，但同步算改编 → 同样有风险，建议排除 |
| **CC0** | ✅ | Jamendo 上极少 |

**实践建议**：Jamendo 上只取 `ccsa=false&ccnd=false&ccnc=false` 交叉筛选出来的纯 CC BY 曲目，并接受 128kbps 级 mp3 与署名义务。

---

### A4. ccMixter / dig.ccmixter.org Query API

**维护状态：仍在维护。** 实测 2026-10-04 全部可用。

```
GET https://ccmixter.org/api/query?f=json&limit=2&tags=blues&lic=by
→ HTTP 200
[{"upload_id":70943,"upload_name":"Roman Song",
  "user_name":"NiGiD","user_real_name":"Martijn de Boer (NiGiD)",
  "license_url":"http://creativecommons.org/licenses/by/3.0/",
  "license_name":"Attribution (3.0)",
  "file_page_url":"https://ccmixter.org/files/NiGiD/70943",
  "upload_date_format":"Sat, Jun 13, 2026 @ 7:21 AM", ...}]
```

**API 端点**：`https://ccmixter.org/api/query`（ccHost Query API 2.0）

**格式参数 `f=`**：`page` / `html` / `atom` / `rss` / `xspf` / `xml` / `js` / `json` / `docwrite` / `csv` / `textfile` / `m3u` / `ids` / `count`

**许可过滤 `lic=`**（官方 Appendix B）：

| 值 | 含义 |
|---|---|
| `by` | Attribution |
| `nc` | NonCommercial |
| `sa` | Share-Alike |
| `nod` | NoDerives |
| `byncsa` | NonCommercial ShareAlike |
| `byncnd` | NonCommercial NoDerives |
| `s` | Sampling |
| `splus` | Sampling+ |
| `ncsplus` | NonCommercial Sampling+ |
| `pd` | **Public Domain** |

**其他可用参数**：`tags`（`+` 分隔）、`type=all|any`、`search` / `s`、`user` / `u`、`sort`、`ord`、`limit`、`offset`、`ids`、`dataview`、`t`（模板）。

**下载地址**：用 `f=xspf` 拿 track `<location>`：

```
GET https://ccmixter.org/api/query?f=xspf&limit=2&tags=blues&lic=by
→ HTTP 200
<track>
  <location>https://ccmixter.org/content/NiGiD/NiGiD_-_Roman_Song_1.mp3</location>
  <identifier>70943</identifier>
  <title>Roman Song</title>
  <creator>Martijn de Boer (NiGiD)</creator>
  <meta rel="http://creativecommons.org/licenses/by/3.0/">http://creativecommons.org/licenses/by/3.0/</meta>
</track>
```

**⚠️ 实测关键坑：mp3 直下必须带 Referer**

```
curl -I https://ccmixter.org/content/NiGiD/NiGiD_-_Roman_Song_1.mp3
→ HTTP 403 Forbidden, Content-Length: 10

curl -I -H "Referer: https://ccmixter.org/" -A "Mozilla/5.0" <同一 URL>
→ HTTP 200 OK, Content-Type: audio/mpeg, Content-Length: 6613768
```

**许可原文**：

> The ccHost Query API is an open, publicly available interface that is available for public use, especially by 3rd party websites, mobile applications, smart TV appliances and any other network connected device. [...] **The music itself is owned by the individual artists that uploaded it to the site and agree, through the Creative Commons licenses to share the music through this mechanism.** — [Permission to Use Query API](http://dig.ccmixter.org/about)

**档位判定**：

| 内容 | 档位 |
|---|---|
| `lic=pd` 结果 | ✅ 可入库 |
| `lic=by`（CC BY 3.0 等）结果 | ⚠️ 可入库，需署名（ccMixter 的 `%columns%` 里有 `license_url` / `license_name`，可直接落 `meta.json`） |
| `lic=nc` / `byncsa` / `byncnd` | ❌ 不入库 |
| `lic=s` / `splus`（Sampling Plus） | ⚠️ 注意：Sampling+ 不是标准 CC 4.0 家族，条款怪异，**建议排除** |

**批量抓取成本**：`limit` 默认 10，URL 上下文最大约 100~200。API 无鉴权、无限流文档。站点是 2014 年的老 PHP（`Apache/2.2.22 (Debian) PHP/5.4.36`），**抓取要限速、加 User-Agent**。

---

### A5. Free Music Archive API

**结论：官方 API 已停摆；网站本身仍在运营（实测 200），但明文禁止抓取。**

```
GET https://freemusicarchive.org/            → HTTP 200
GET https://freemusicarchive.org/app-developers → HTTP 200
```

**官方原文（`/app-developers` 页）**：

> Free Music Archive (FMA) used to have an API that app developers could use to make FMA content available in their apps. **Due to the heavy load this put on our servers we unfortunately had to shut down our API.** That being said, we welcome app developers to FMA provided your apps do not put excessive stress on our servers. Therefore, please keep the following in mind:
>
> **Without explicit approval from FMA, it is not allowed to forward search queries from your users to our search engine and scrape content from the returned HTML. If we suspect that is happening without our approval then we will block those requests.**

**历史脉络**：
- 2009 由 WFMU 创立
- 2018-11 宣布关站，反复延期，2018-12 与 KitSplit 合作后无限期续命
- 2019 被 Tribe of Noise 收购，此后以 "FMA NEXT" 名义重建
- CC 的 `cccatalog` 项目早在 2020-03 就把 FMA provider 标记为 `status: discontinued`

**档位判定**：❌ **不作为程序化数据源**。既无 API，又明文禁止抓取 HTML 搜索结果。若人工挑曲后手工入库，授权仍按各曲目的 CC 许可（多数为 CC BY / BY-NC，**NC 需逐条排除**），但不属于「可程序化调用」的源。

---

### A6. Pixabay API

#### A6.1 免费 key 流程

1. `https://pixabay.com/accounts/register/` 注册账号（免费，不绑卡）。
2. 登录后打开 `https://pixabay.com/api/docs/`，页面里直接显示你的 API key（"Please **login** to see your API key here"）。
3. 请求：`https://pixabay.com/api/?key=<KEY>&q=<query>`。

> key (required) | str | Please login to see your API key here.

#### A6.2 ⚠️ 致命发现：Pixabay API **没有音频端点**

实测：

```
GET https://pixabay.com/api/audio/?key=demo&q=piano  → HTTP 400
GET https://pixabay.com/api/?key=demo&q=piano         → HTTP 400
```

`/api/docs/` 页面只文档化两个端点：`GET https://pixabay.com/api/`（图片）和 `GET https://pixabay.com/api/videos/`（视频）。

官方 API 介绍页原文：

> Welcome to the Pixabay API documentation. Our API is a RESTful interface for searching and retrieving **royalty-free images and videos** released by Pixabay under the Content License.

> Gain access to over 5.9M+ million **images and videos** with the free Pixabay API.

**结论：Pixabay 的音乐（290,000+ 曲）和音效（120,000+）无法通过官方 API 检索。** 想用只能抓网页 —— 而网页现在有 Cloudflare 挡：

```
GET https://pixabay.com/music/search/piano/       → HTTP 403（Cloudflare challenge）
GET https://pixabay.com/service/license-summary/  → Cloudflare challenge 页
GET https://safesearch.pixabay.com/music/         → HTTP 403
```

但 **CDN 直链是可以匿名下的**（实测）：

```
GET https://cdn.pixabay.com/audio/2024/07/29/audio_4e09b35d5b.mp3
→ HTTP 200, content-type: audio/mpeg, content-length: 3137201
```

URL 形状：`https://cdn.pixabay.com/audio/<YYYY>/<MM>/<DD>/audio_<10位hex>.mp3`
⚠️ hex 段无法推算，必须从页面 HTML 里抓 —— 而页面被 Cloudflare 挡。**所以 Pixabay 音频对本项目实际上是不可程序化接入的（即便不考虑许可）。**

#### A6.3 Content License 对「复制进项目 / 随项目导出」的判定

**许可版本史**（供参考）：

| 时期 | 许可 |
|---|---|
| 至 2019-01-09 | CC0 |
| 2019-01-09 ~ 2023-04-16 | Pixabay License |
| 2023-04-17 起 | **Content License**（现行） |

Terms of Service 页脚：`Last updated: November 18, 2024`（2024 年更新过一次，但 §5 的 Prohibited Uses 核心措辞未变）。

**官方原文（Terms of Service §5）**：

> Subject to the Prohibited Uses described below [...] when you download any Content that is not CC0 Content from the Service, we grant you an irrevocable, worldwide, perpetual (or as long as allowed by law), non-exclusive and royalty-free right to download, use, copy, modify or adapt the Content for commercial or non-commercial purposes ('Content License').

**关键限制（§5 Prohibited Uses 与 license-summary）**：

> **You cannot sell or distribute Content (either in digital or physical form) on a Standalone basis.** Standalone means where no creative effort has been applied to the Content and **it remains in substantially the same form as it exists on our website**.
>
> This includes selling or distributing Content on a Standalone basis as an image, **audio**, video, NFT or **other digital file** (including through a stock media platform), as well as a print, wallpaper, poster or on merchandise or on other physical products.

**FAQ 的追加说明**：

> Yes. You may use Pixabay music in commercial video projects, including content you sell or distribute [...] **as long as the music is part of a larger creative work and not distributed as a standalone file.**
>
> **Can I resell or redistribute these sound effects?** — 同样只允许「as part of a larger creative work」

**对本项目的判定：❌ 不可入库。**

理由：本引擎的 `library/bgm/<id>/` 就是**目录名 + 原始音频文件 + meta.json** 的赤裸素材库形态；剧目导出的 `assets/` 目录里是被复制进去的**未修改原始 mp3**。这**完全落在 "remains in substantially the same form as it exists on our website" 的 Standalone 定义里**，即使「这个包是给别的用户跑 galgame 用的」也不改变「包里含原始 mp3 文件」这一事实。

🔗 **仅远端引用**：如果将来引擎支持「引用远端 URL 不下载」模式，Pixabay 的 CDN 直链（`cdn.pixabay.com/audio/...`）理论上可用。但注意是该 CDN URL 无法程序化发现（见 A6.2），且用户导出剧目后别人机器上不一定能访问。

**另一个坑：Content ID**。官方 FAQ 明说：

> Even though music on Pixabay is free to use under the Pixabay Content License, some contributors or their distributors may choose to register their tracks with **Content ID**. This can result in automated claims even when the track is used legally.

---

### A7. Wikimedia Commons API（取音频）

**站内信息**：`https://commons.wikimedia.org/w/api.php`（MediaWiki Action API）

#### A7.1 检索方式与实测结果

无鉴权、无 key、无速率文档限制（建议 `maxlag` 礼貌参数）。

**方式一：搜索**

```
GET https://commons.wikimedia.org/w/api.php?action=query&format=json
    &list=search&srsearch=filetype:audio piano&srnamespace=6&srlimit=3
→ HTTP 200
{"query":{"searchinfo":{"totalhits":6023},"search":[
  {"ns":6,"title":"File:Outing- Chinese kids' Piano Song - Junjun's edition ... .ogg","pageid":81097371,...},
  ...]}}
```

**方式二（推荐）：按分类 + imageinfo 批量取**

```
GET https://commons.wikimedia.org/w/api.php?action=query&format=json
    &generator=categorymembers&gcmtitle=Category:Audio files of music
    &gcmtype=file&gcmlimit=50
    &prop=imageinfo&iiprop=url|extmetadata|size|mime
```

返回的 `extmetadata` 里含 `LicenseShortName`、`UsageTerms`、`Artist`、`Credit`、`AttributionRequired` 等字段，**可直接映射到 `meta.json`**。

#### A7.2 直链形状（实测 200）

```
https://upload.wikimedia.org/wikipedia/commons/<a>/<ab>/<URL-encoded filename>
```

实测样本：

```
GET https://upload.wikimedia.org/wikipedia/commons/a/aa/Blue_Danube_%28Exercise_and_variations-collections_in_piano%29_JMC%2C_Han.ogg
→ HTTP 200, content-type: application/ogg, content-length: 5236138
```

⚠️ 从 `imageinfo.url` 拿到的 URL 尾部会带 tracking 参数，形如：

```
...ogg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
```

**入库前需要 strip 掉 `?utm_*`**（不影响下载，但存进 `meta.json` 很脏）。

#### A7.3 许可分布（实测计数）

用 `srsearch=filetype:audio incategory:<分类>` 得到的 totalhits：

| 许可分类 | 音频文件数（实测） |
|---|---|
| 全部音频（`filetype:audio`） | **4,429,992** |
| `incategory:CC-Zero` | **1,172,811** |
| `incategory:CC-BY-4.0` | 72,725 |
| `incategory:PD-self` | 15,076 |

**结论**：Commons 音频以 **CC0 系为绝对主力（约 117 万）**，PD 与 CC BY 是少数派。这非常适合本项目的「✅ 可入库」判定。

⚠️ 但要注意：`CC-Zero` 分类里混有大量 **spoken Wikipedia / 发音文件 / 环境录音**，不是音乐。做 BGM 需要额外过滤（按 `Category:Audio files of music`、`Category:Music by ...` 之类的分类树，或按 duration 过滤短于 30s 的文件）。

#### A7.4 质量是否适合做 BGM

- **格式**：大量 `.ogg` / `.flac` / `.mp3` / `.wav` 混合；古典音乐录音里 flac / ogg 很常见。
- **质量**：历史录音（如 1910s 管弦乐）数量很大，**音质不适合现代 galgame BGM**；但 `Category:Recordings published by Musopen` 类目下有 44.1kHz 现代录音。
- **建议**：Commons 更适合做 **SFX / 环境音 / 古典桥段**，而非当代电子/氛围 BGM。

#### A7.5 档位判定

| 内容 | 档位 |
|---|---|
| `CC-Zero` 分类文件（约 117 万） | ✅ **可入库** |
| `PD-self` / PD-old 等 | ✅ **可入库** |
| `CC-BY-4.0` 等 | ⚠️ 可入库，需署名（`extmetadata.Artist` + `LicenseShortName` + `imageinfo.descriptionurl` 写入 `meta.json`） |
| `CC-BY-SA-*` | ⚠️ 有 SA 传染风险，建议排除 |

---

### A8. Internet Archive（public-domain 音频集合）

#### A8.1 可脚本化检索 API

**检索：`advancedsearch.php`**

```
GET https://archive.org/advancedsearch.php
    ?q=collection:(opensource_audio) AND licenseurl:(*publicdomain*)
    &fl[]=identifier&fl[]=title&fl[]=licenseurl
    &rows=3&output=json
→ HTTP 200
{"responseHeader":{"status":0},
 "response":{"numFound":165180,"docs":[
   {"identifier":"why-not-93bpm",
    "licenseurl":"https://creativecommons.org/publicdomain/mark/1.0/",
    "title":"WHY NOT 93bpm"},
   {"identifier":"lasombraporquetequiero",
    "licenseurl":"http://creativecommons.org/publicdomain/zero/1.0/"},
   ...]}}
```

**note**：`numFound: 165180` —— 仅 `opensource_audio` 集合里带 publicdomain licenseurl 的就有 16.5 万条。

**⚠️ 实测踩坑**：该端点的 Elasticsearch 后端**间歇性 500**，返回：

```json
{"error":"[BACKEND_ERROR] Invalid or no response from Elasticsearch"}
```

重试即恢复（实测连续两次查询中第一次失败、后两次成功）。**抓取脚本必须带重试**。

**元数据：`/metadata/<identifier>`**

```
GET https://archive.org/metadata/why-not-93bpm
→ HTTP 200
{"created":..., "d1":"ia601603.us.archive.org", "dir":"/2/items/why-not-93bpm",
 "files":[{"name":"WHY NOT -  93bpm.mp3","source":"original",
           "size":"4460725","md5":"cf872eeb...","format":"VBR MP3",
           "length":"185.86","track":"01"},
          {"name":"WHY NOT -  93bpm.png","source":"derivative","format":"PNG",...}],
 "metadata":{...}}
```

`files[]` 里 `source:"original"` 是原始上传文件，`source:"derivative"` 是 IA 自动转码的派生版本。

#### A8.2 下载直链形状（实测 302→200）

```
https://archive.org/download/<identifier>/<URL-encoded filename>
```

实测：

```
curl -I https://archive.org/download/why-not-93bpm/WHY%20NOT%20-%20%2093bpm.mp3
→ HTTP/2 302 → (follow) HTTP/2 200
   content-type: audio/mpeg
   content-length: 4460725
```

⚠️ 注意 filename 里的**连续空格要 URL-encode 成 `%20%20`**（这个样本文件名里 "WHY NOT -  93bpm" 有双空格）。用 `metadata` API 拿到的原始 `name` 字段做 `encodeURIComponent` 最稳。

#### A8.3 典型授权

`licenseurl` 字段直接给出：

- `https://creativecommons.org/publicdomain/mark/1.0/` → **PD Mark** ✅
- `http://creativecommons.org/publicdomain/zero/1.0/` → **CC0** ✅

**档位判定**：✅ **可入库**（按 `licenseurl` 过滤 PD/CC0）。

**推荐用法**：以 `licenseurl` 做白名单过滤（`*publicdomain*`、`*zero*`），避开 `*licenses/by-nc*`。

---

### A9. Musopen / IMSLP

#### A9.1 Musopen —— ⚠️ **无公开 API**（重要辟谣）

网络上流传一份「Musopen REST API」配方：

> `GET https://musopen.org/api/v1/search/?composer=bach&license=cc0&format=json` — authenticate with an API key (free, no rate limit for non-commercial use) — 来源：`lifetips.alibaba.com/tech-efficiency/find-free-music-downloads-at-musopen`

**实测全部失败**：

```
GET https://musopen.org/api/v1/search/?composer=bach&license=cc0&format=json → HTTP 404
GET https://musopen.org/search/?license=cc0                                 → HTTP 403
GET https://musopen.org/                                                    → HTTP 403
GET https://dev.musopen.org/                                                → HTTP 000（无法连接）
```

**结论：那篇 lifetips.alibaba.com 的文章是 AI 生成的低质量内容**（文中还引用「Carnegie Mellon HCI 研究所 2023 fMRI 研究」「12 行 Python 脚本」等无法核实、明显编造的细节）。**Musopen 没有公开 API。**

**Musopen 真实情况**：

- 501(c)(3) 非营利，2006 年创立，约 100,000+ mp3
- 免费用户**每天限 5 次下载**；$55/年会员解除限制并给 lossless
- 站点被 Cloudflare 保护（curl 403），需浏览器或反检测浏览器
- 官方 FAQ 明确免责：**Musopen 不保证上传内容真的属于公有领域**

> Musopen's goal is to be the largest online repository of music in the public domain. [...] However, please note that **Musopen cannot guarantee that any music uploaded by its users is, in fact, in the public domain.** [...] Musopen does not review music uploaded by users of the site to determine if the music is in the public domain or subject to copyright. — [Musopen FAQ](https://musopen.org/faq/)

**档位判定**：❌ **不作为程序化数据源**（无 API + 主动反爬）。若人工选用，许可上多数标 PD，**但仍需自行判断**（官方自己都说不能保证）。**推荐改走 Internet Archive 上的 Musopen 镜像收藏**（Musopen 的 Kickstarter 录音项目明确同时发布到 archive.org）。

#### A9.2 IMSLP —— 只有**乐谱**元数据 API，没有录音 API

API 端点（实测 200）：

```
GET https://imslp.org/imslpscripts/API.ISCR.php
    ?account=worklist/disclaimer=accepted/sort=id/type=2/start=0/retformat=json
→ HTTP 200
{"0":{"id":"\"A\" (Ferrari, Carlotta)","type":"2",
  "parent":"Category:Ferrari, Carlotta",
  "intvals":{"composer":"Ferrari, Carlotta","worktitle":"\"A\"","icatno":"ICF 1237","pageid":"1637322"},
  "permlink":"https://imslp.org/wiki/\"A\"_(Ferrari,_Carlotta)"}, ...}
```

`type=1` = 人物（作曲家/演奏者），`type=2` = 作品。

**另有 MediaWiki API** 可用（`https://imslp.org/api.php`），但同样只覆盖乐谱与元数据。

**下载乐谱需要 setting cookie**：

```python
cookies = {"imslp_wikiLanguageSelectorLanguage": "en",
           "imslpdisclaimeraccepted": "yes"}
```

**IMSLP 有 `Category:Recordings published by Musopen`**，但该类目几乎为空（实测页面无内容）。

**档位判定**：❌ **与本项目无关**。IMSLP 是乐谱库，不是音频素材库。古典录音请走 Commons / Internet Archive。

---

## B 类：没有 API 但可脚本化抓取的

### B1. incompetech（Kevin MacLeod）

**站内信息**：`https://incompetech.com/`（实测代理 200）

#### B1.1 许可：**全站 CC BY 4.0**（确认）

`https://incompetech.com/llms.txt`（站点自己提供的机器可读摘要）：

> Royalty-free music and custom graph paper generators by Kevin MacLeod, online since 1997. **Nearly all music is free to use under Creative Commons Attribution 4.0**; graph paper is public domain (CC0). **Machine-readable catalog data is available** — see the Agent Section below.

> Licensing metadata common to every piece (schema.org MusicComposition): composer and copyrightHolder are Kevin MacLeod (Person); offer category "Creative Commons License", **license https://creativecommons.org/licenses/by/4.0/**. **Attribution is required unless a no-attribution license is purchased.**

⚠️ 措辞是 "**Nearly all** music" —— 存在少数例外（付费 no-attribution 曲目），需要逐条看 `llms.txt` 的 Agent Section。

#### B1.2 credit 文案要求（官方指定格式，必须逐字）

> ```
> Title Kevin MacLeod (incompetech.com)
> Licensed under Creative Commons: By Attribution 4.0
> https://creativecommons.org/licenses/by/4.0/
> ```
>
> It is important that you replace the word Title with the Actual Title of the piece that you are using!

**可见性要求（官方原文）**：

> **Do I have to put the credit where people can see it? Yes.** Credits change from media to media - but in general a credit needs to be placed such that a person who wants to know where the music came from should have no difficulty in finding it. A reasonable effort may be expended (e.g. clicking on a credits option) but **the credit should not be obscured.**

→ 对本项目落地：`meta.json` 的 `attribution` 字段存上述四行；剧目导出的 `assets/manifest.json` 汇总；剧目的 staff roll / credits 页展示。

#### B1.3 能不能改曲 / 能不能再分发

> **Can I change your music?** Yes, you can sing over, chop, splice, compress, lengthen, and add instruments to anything you like. **You MUST make it clear in the credits which parts are yours, and which parts are mine.**

> **Is this music Copyright Free?** No. All of this music is copyrighted. Though some of the baroque and classical compositions are in the public domain; **these recordings are not.**

CC BY 4.0 本身允许 `reproduce and Share the Licensed Material, in whole or in part`，所以**再分发原文件是许可允许的**（需署名 + 指示是否修改）。incompetech 页面没有额外禁止再分发的条款。

#### B1.4 ZIP 批量包 / 直链形状

- 没有公开的官方批量 ZIP。站点是**逐曲下载**。
- `llms.txt` 提到 "Machine-readable catalog data is available — see the Agent Section below" → **这是官方提供的程序化入口**，应优先用它拿曲目清单，再拼直链。
- 曲目文件在 `https://incompetech.com/music/royalty-free/mp3-royaltyfree/<Title>.mp3` 之类的路径下（需从 `llms.txt` 的 Agent Section 或页面 HTML 确认精确形状）。
- **许可页有 copy-paste 生成器**：`https://www.incompetech.com/music/royalty-free/licenses/` — "Select titles, then **copy and paste the generated credits** into your work."

#### B1.5 档位判定

⚠️ **有条件可入库** —— CC BY 4.0 允许再分发原始文件，必须署名。**credit 文案必须逐字使用官方格式**（含曲名替换规则）。

---

### B2. OpenGameArt 音频

**站内信息**：`https://opengameart.org/`（Drupal 7 站点）

#### B2.1 RSS —— ✅ 可用（实测 200）

```
GET https://opengameart.org/rss.xml
→ HTTP 200, Content-Length: 29696
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xml:base="https://opengameart.org"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
 <title>OpenGameArt.org</title>
 <item>
  <title>OpenGameArt.org Spring Game Jam 2026 - Fresh</title>
  <link>https://opengameart.org/content/opengameartorg-spring-game-jam-2026-fresh</link>
  ...
```

⚠️ 这是**全站最新内容**的 RSS，不是「音频分类」的 RSS。`<description>` 里塞的是完整 HTML（已转义），需要二次解析。

**带过滤的检索 URL（实测 200）**：

```
https://opengameart.org/art-search-advanced?field_art_type_tid[]=13
    &field_art_licenses_tid[]=4
```
- `field_art_type_tid[]=13` = 2D Art / Sound Effect 类型过滤器
- `field_art_licenses_tid[]=4` = CC0 许可过滤器

**可加 `format=rss` 变体**（实测 200）：

```
https://opengameart.org/art-search-advanced?field_art_type_tid[]=13&format=rss
```

#### B2.2 ❌ `?_format=json` **无效**

用户提到的「Drupal 站点常带 `/node/xxx?_format=json`」在 OGA 上**不成立**。实测：

```
GET https://opengameart.org/node/1?_format=json
→ HTTP 200，但 content-type 是 text/html，返回的是完整 XHTML 页面（不是 JSON）
```

OGA 没有启用 Drupal 的 REST/JSON:API 模块。**只能解析 HTML 或 RSS。**

#### B2.3 批量抓取 URL 形状

```
列表页：https://opengameart.org/art-search-advanced?field_art_type_tid[]=13&field_art_licenses_tid[]=4&page=<n>
详情页：https://opengameart.org/content/<slug>
文件下载：https://opengameart.org/sites/default/files/<filename>
```

实测 CC0 过滤后的列表页给出（示例）：

```
/content/door-open-door-close
/content/dull-explosion
/content/swish-bamboo-stick-weapon-swhoshes
/content/synthesized-explosion
```

#### B2.4 许可（官方 FAQ 原文）

> **Creative Commons 0 "(CC0)"** — Works released under this license may be copied, modified, distributed, performed or otherwise used in anyway without asking, crediting or notifying the creating artist. [...] If you are using art, this license means commercial use is ok.
>
> **Creative Commons Attribution ("CC-BY 3.0" and "CC-BY 4.0")** — [...] 1. You must state that you have used the work and credit the original artist. **Appropriate credit includes providing the title of the work, the name of the creator and attribution parties, a copyright notice, a license notice, a disclaimer notice, and a link to the material.** 2. You must indicate if you have made changes to the work. 3. **You may not impose any additional restrictions on the redistribution of the work.** In practice, this means the work may not be not used on distribution networks that use some form of Digital Rights Management (DRM).
>
> **OpenGameArt.org Attribution ("OGA-BY 3.0" and "OGA-BY 4.0")** — These licenses are derivatives of the CC-BY licenses (enumerated above) which removes the restriction against technical measures that prevent redistribution of a work. (eg. DRM)
>
> **CC-BY-SA** — [...] must credit you as its author, not use it on platforms that include some form of DRM, and must release any changes or otherwise derivative works you make under the same license.

**⚠️ 一个坑（官方明文）**：

> A submission's preview images or preview audio clips may not fall under the same license as the submission's assets available for download. Previews are for demonstration purposes and may contain works or logos not intended as freely licensed content. **Unless otherwise noted, assume the previews are 'All rights reserved'.**

→ **不要下 preview，要下 submission 里声明的 asset 文件。**

#### B2.5 档位判定

| 内容 | 档位 |
|---|---|
| CC0 条目（含 OGA 上明确标 CC0 的） | ✅ **可入库** |
| CC-BY 3.0 / 4.0 | ⚠️ 可入库，需署名（含 title / author / license notice / link） |
| **OGA-BY 3.0 / 4.0** | ⚠️ 可入库，需署名。**对本项目其实更友好**（不禁 DRM） |
| CC-BY-SA | ⚠️ 有 SA 传染，建议排除 |
| GPL 系列 | ⚠️ 不建议（艺术素材套 GPL 有解释争议） |

---

### B3. itch.io 上的 CC0 / CC BY 音频包

#### B3.1 ⚠️ PWYW 包**可以匿名走通下载链**（实测完整链路）

**实测记录（2026-10-04）**：

```bash
# 步骤 1：拿游戏页（同时种下 session cookie）
curl -c /tmp/c.txt "https://ne-mene.itch.io/general-sound-pack"
# → HTTP 200, 45197 B

# 步骤 2：从 HTML 抽 csrf_token 与 upload_id
#   csrf_token: <input name="csrf_token" value="WyJnRkRuIjoxNzkxMTI0MDY5..." >
#   upload_id:  页面里 class="upload_list_3207306" → 3207306

# 步骤 3：POST 到 /download_url（无需登录！）
curl -b /tmp/c.txt -X POST "https://ne-mene.itch.io/general-sound-pack/download_url" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "X-Requested-With: XMLHttpRequest" \
  -H "Referer: https://ne-mene.itch.io/general-sound-pack" \
  --data "csrf_token=<CSRF>&upload_id=3207306"
# → HTTP 200
{"url":"https://ne-mene.itch.io/general-sound-pack/download/eyJpZCI6MjEyMzQ5MywiZXhwaXJlcyI6MTc5MTEyNDQ2NX0%3D.9%2B1IN3FQSNJfy10wmCGF4kB%2F45I%3D"}

# 步骤 4：GET 那个签名 URL（带同一 session cookie）
curl -b /tmp/c.txt "<上一步的 url>"
# → HTTP 200（19 KB 的下载页）
#   页面文本含： "Download sounds.zip 6.5 MB Jun 18, 2023"
```

#### B3.2 下载 URL 形状与「无永久直链」的结论

- `/download_url` 返回的 URL 形状：`https://<user>.itch.io/<game>/download/<base64url(JSON)>.<hmac>`
  - base64 解出是 `{"id":2123493,"expires":1791124465}` —— **带过期时间戳、绑定 session**
- 该 URL 是一个**落地页**，页面上列出文件名与大小（如 `sounds.zip 6.5 MB`），但**真正的字节下载 URL 由页面上的 JS（`init_GameDownload`）在会话内生成**，HTML 里没有静态的 `.zip` 链接。
- 实测直接尝试 `/download/<upload_id>`、`/file/<upload_id>` → 全部 **HTTP 302**（跳回游戏页，无权限）。

**结论**：itch.io **没有永久直链**。可以脚本化（session + CSRF + 两步 POST），但：
- 需要维护 session cookie
- 签名 URL 会过期
- 页面结构变化会破坏脚本
- 属于「半脚本化」而非「稳定直链」

**对 $0（纯免费）包与 PWYW 包的区别**：纯免费包直接进入下载页；PWYW 包通常会先弹「支持作者」的输入框，脚本需处理该路径。实测的 `ne-mene/general-sound-pack` 是 `min_price: 0, actual_price: 0`，属于纯免费。

从页面 JS 里的 `init_GameDownload` 数据可以确认价格参数：

```json
{"game":{"min_price":0,"id":2123493,"slug":"general-sound-pack","actual_price":0,"type":1,"type_name":"default"},"show_download_lightbox":true}
```

#### B3.3 许可分布（itch.io 把许可放在 asset 元数据里）

itch.io 的 asset 页面有结构化的 `Asset license` 字段，可直接抓：

| 包名 | 许可 | 备注 |
|---|---|---|
| `sindriax/blip8-sounds` | **CC0** | 181 个 chiptune SFX，"no credit needed" |
| `nihil-existentia/free-audio-asset-collection` | **CC0** | 30 个 wav，48kHz/24bit |
| `kmontesdev/fantasy-ambient-sound-effects-pack-cc0` | **CC0** | 2GB，但下载重定向到 Google Drive（不好脚本化） |
| `obsydianx/interface-sfx-pack-1` | **CC0** | 200+ UI 音，WAV + OGG |
| `nox-sound-design/essentials-series-sfx-nox-sound` | **CC0** | 1,644 个 SFX |
| `ne-mene/general-sound-pack` | **CC0** | 100+ 音，6.5MB zip |
| `filmcow/filmcow-sfx` | 需逐条确认 | 4,000+ SFX（免费） |
| `comigo/bleeps-n-bloops` | **CC0** | 67 个复古 SFX |

**发现方式**：itch.io 有 browse 页（`https://itch.io/game-assets/tag-sound-effects`），asset 页面上的 `Asset license` 是结构化文本，可正则抽取。

#### B3.4 档位判定

| 内容 | 档位 |
|---|---|
| 标注 **CC0** 的包 | ✅ **可入库** |
| 标注 **CC BY** 的包 | ⚠️ 可入库，需署名 |
| 未标许可 / "free to use" 但无明确许可 | ❌ **不入库**（无授权证明） |

---

### B4. FreePD.com

#### B4.1 ⚠️ **站点已永久关闭**（实测）

```
GET https://freepd.com/
→ HTTP 200（返回的是关站公告页）
```

公告原文：

> **FreePD.com - Site Closed**
>
> A Note on FreePD.com's Closure
>
> Thank you for being part of the FreePD community. **After 17 years of sharing millions of free-to-use, Public Domain music downloads with creators worldwide, we have officially taken the service offline.**
>
> The hosting and maintenance of the site have ceased. We sincerely appreciate the support and creativity you all brought to the public domain music movement.

**时间线旁证**：
- `incompetech.com/wordpress/2025/07/update-to-freepd/` —— 2025-07 Kevin MacLeod 还在给 FreePD 加 WAV 源文件下载
- `website.informer.com` 显示域名 2008-08-03 注册、`2026-08-03` 到期（未续）
- `sanglorian.github.io/flow/freepd-com/` 最后记录到 `web.archive.org/web/20250914182536/https://freepd.com/`（2025-09-14 还有快照）

**所以：2025-09 之后、2026 年之前关闭。**

#### B4.2 存档现状

- Wayback Machine 有历史快照：`http://archive.org/wayback/available?url=freepd.com&timestamp=20240101` → `web.archive.org/web/20240104044209/https://freepd.com/`
- 原始 mp3 的直链**已经 404**（hosting ceased）。
- **但 FreePD 的内容散落在别处**：
  - `mrfakename/cc0-music-captioned`（HF 数据集）明确写：**"Some of the music comes from FreePD, a site that shared public domain music. The FreePD website has since been taken down."** → 这个数据集含 9,015 首 CC0 曲目（详情见 §C1）
  - `SoundSafari/CC0-1.0-Music`（GitHub）也把 FreePD 列为其数据来源之一
  - `incompetech` 的 `llms.txt` 提到 "except tracks on **FreePD**, which are CC0"

#### B4.3 档位判定

- 站点本体：❌ **不可用**（已关闭）
- **FreePD 的历史曲目（尤其经 HF 数据集 / Internet Archive 镜像拿到的）**：✅ **可入库**（CC0 / PD）

---

### B5. Chosic

**站内信息**：`https://www.chosic.com/`

#### B5.1 抓取可行性（实测部分受阻）

```
GET https://www.chosic.com/download-audio/?t=113362
→ HTTP 301 → https://www.chosic.com/free-music/all/
→ HTTP 403（反爬）
```

直接抓 mp3 直链会 403。但**从列表页 HTML 的 `data-url` 属性可以抽到直链**（社区脚本验证过）：

```python
soup = BeautifulSoup(requests.get("https://www.chosic.com/free-music/all/").content, "html.parser")
for u in soup.select("[data-url]"):
    print(u["data-url"])
# 输出示例：
# https://www.chosic.com/wp-content/uploads/2020/06/John_Bartmann_-_09_-_Happy_Clappy-1.mp3
# https://www.chosic.com/wp-content/uploads/2020/11/batchbug-sweet-dreams.mp3
# https://www.chosic.com/wp-content/uploads/2021/01/fm-freemusic-inspiring-optimistic-upbeat-energetic-guitar-rhythm.mp3
```

**URL 形状**：`https://www.chosic.com/wp-content/uploads/<YYYY>/<MM>/<slug>.mp3`（WordPress 上传目录）
⚠️ 需要带 `User-Agent` header 才能过反爬 —— 实测裸 curl 403。

#### B5.2 许可（官方页面原文）

> Royalty-free music for YouTube and social media, free to use even commercially. [...] **Sort by popularity | Newest | Downloads | All licenses | With attribution | No attribution | Duration** [...]
>
> \* All the rights for these music tracks belong to their authors who let their music free use **in exchange for crediting them in your project** (**except works that are in the public domain - no credit is required**). **We advise you to check the licence details in each track page.**

站点自带 `All licenses` / `With attribution` / **`No attribution`** 三个过滤器 —— **`No attribution` 就是 PD 档，对应 ✅ 可入库的曲目**。

第三方分析补充：

> Its policy identifies **public-domain tracks that do not require attribution** and **Creative Commons music—typically CC BY—that requires crediting the artist**. [...] Some uses, including certain games, apps, films, radio projects, or software, **may require contacting the artist**. [...] Chosic advises users to check each track's license and notes that it does not guarantee protection from copyright claims.

⚠️ **"certain games, apps... may require contacting the artist"** —— 这条对本项目（游戏引擎）是隐患，需要逐曲确认。

#### B5.3 档位判定

| 内容 | 档位 |
|---|---|
| `No attribution` 过滤出的 PD 曲目 | ✅ **可入库** |
| CC BY 曲目（多数） | ⚠️ 可入库，需署名（页面提供 copy 按钮的 attribution 文本） |
| 「需联系作者」的特殊用途 | ❌ 不入库（游戏/软件场景） |

---

### B6. Bensound

**站内信息**：`https://www.bensound.com/`

#### B6.1 Free License 的真实范围（官方原文）

> **4.2 FREE LICENSE.** [...] the Free License (as defined below) shall be **revocable**. The Free License allows you to download and use Music Tracks, free of charge, in your Project **as part of an online video or live video streaming that is published AND accessible free of charge, OR for usages limited to theatrical performances and films, providing that your Project is meant for educational purpose only and does not generate revenue**.
>
> By downloading and using any Music Track under this Free License, you agree to **include in your video description, for online videos, the attribution text and its unique license code provided when downloading a track** and acknowledge that it is **valid for a single video only**.

**禁止条款 §5.1**：

> (ii) use the Audio Assets in **meditation soundtracks and Projects that contain only audio material**;
> (iv) use the Audio Assets and any derivative work containing the Audio Assets, in whole or in part, **in any other stock product, library, collection, or database for distribution or resale**;
> (vi) use the Audio Assets in Projects that contain sexual activity or sexual-oriented nudity.  ← ⚠️ galgame 场景高度相关
> (ix) permit a third party to use or copy the Audio Asset(s);
> (xi) **sublicense or assign the use of the Audio Assets for standalone distribution**; and/or
> (xii) **make the Audio Assets available and/or distribute, resell, or perform the Audio Assets separately from the Project into which the Audio Assets have been incorporated**;
> (xiii) use the Audio Assets for AI training.
>
> (i) use the Audio Assets in applications or software that **produces or generates videos, songs or any type of creative content** [...]  ← ⚠️ 对「游戏引擎」场景直接冲突

**⚠️ 单视频绑定授权码**：

> Each attribution text is valid for one video only. To reuse the same track in a new video, you must download it again to generate a new attribution.

**档位判定：❌ 不可入库。** 三重冲突：
1. §5.1(xi)(xii) 禁止 standalone 分发与「脱离 Project 分发」→ 导出的 `assets/` 包即违反
2. Free License 只覆盖「免费在线视频 / 教育用途剧场」→ **游戏不在范围内**
3. §5.1(i) 禁止用在「产出内容的软件」中 → 引擎分发场景直接踩线
4. 附加：§5.1(vi) 禁止 18 禁内容

---

### B7. Mixkit

**站内信息**：`https://mixkit.co/license/modal/sfxFree/`

**Mixkit Sound Effects Free License 原文**：

> Items under the Mixkit Sound Effects Free License can be used in your commercial and non-commercial projects for free.
>
> You are licensed to use the Item to create an End Product that incorporates the Item as well as other things, **so that it is larger in scope and different in nature than the Item**. You're permitted to download, copy, modify, distribute and publicly perform the Sound Effect Items on any web or social media platform, in podcasts and **in video games**, as well as in films and presentations [...]
>
> **You can't redistribute the Item on its own, as stock, in a tool or template, or with source files.** You're also not allowed to claim them as your own or register them on any rights management service.

**官方 User Terms §9 补充**：

> (d) rent, license, sublicense, sell, resell or otherwise commercially exploit or make Mixkit or any Item available to any third party [...] including **aggregate or collate an Item(s) and make available on a stock or inventory basis**;
> (j) **use scripts or bots to mass download Items** (this includes using any means whatsoever to scrape/download the entire library and/or database of Items)

**档位判定：❌ 不可入库。**

- 关键句 "**You can't redistribute the Item on its own, as stock, in a tool or template, or with source files**" —— 本引擎的 `library/sfx/<id>/` 正是 "with source files" 形态
- 且 §9(j) **明文禁止脚本批量下载** → 连抓取都不合法

🔗 **仅远端引用**：Mixkit 明确允许 "in video games"，所以如果能改成「游戏运行时流式引用远端 URL 而不落盘」，或许可行（但本引擎当前设计是复制进 `assets/`）。

---

### B8. Zapsplat

**站内信息**：`https://www.zapsplat.com/license-type/standard-license/`

**Standard License 原文**：

> You may edit, adapt, or combine our sounds with other sounds for use within your projects. However, **our sounds must not constitute the primary value of a product** (for example a sound effects app) **or be redistributed outside of your project**, as detailed below in point 5. Prohibited Uses.
>
> **Prohibited Uses:** You may not, under any circumstances:
> 1. Share, transfer, loan, rent, sublicense, or sell our sound effects or music to any third party.
> 2. **Redistribute our sounds in any form (e.g., sound libraries, file sharing, apps, social networks, or physical media such as hard drives, DVDs, ROMS etc).**
> 3. Use our sounds as the primary value in a relaxation video, soundboard, or similar standalone product.
> 4. Remix or alter our music tracks into new standalone musical works for distribution.
> 5. Use our sounds in physical products (e.g., toys) without a separate written agreement.
> 6. **Use our sounds or music to train Artificial Intelligence (AI) or machine learning models of any kind.**

**官方对 "redistribution" 的解释（FAQ 文章）**：

> Redistribution in a license usually refers to taking the audio file as-is and sharing it with others by selling it, posting it on social media or any other file sharing platform, **outside of a movie, game, animation, eBook etc.** You can't do this. But if the audio file is embedded into the work, to enhance the scene, add a background in a game, or offer navigational cues in a software platform etc, this is okay.

**⚠️ 关键区分**：Zapsplat 的立场是「**嵌入到作品里就行，把文件本身发出去不行**」。对照本项目：

- 剧目导出包 `assets/` 里是**原始 wav/mp3 文件**，且 `library/sfx/` 本身就是素材库 → 落在「sound libraries / 把文件本身共享」里 → **❌**
- 反过来，如果导出的是**加密/打包成一个二进制且用户无法直接提取音频**的产物，则接近 "embedded into the work"（但本引擎的 galgame 资源包天然是可解包的）
- 另外还有一条：**Zapsplat 也托管少量 CC0 素材**：

> We also host a few **Creative Commons 0** licensed sounds. These are copyright free and can be used without limitation. However we ask you check the license for each sound you download and use to which a link is clearly displayed on each sound result.

**档位判定：❌ 不可入库**（Standard License）。**但 Zapsplat 上标注 CC0 的少数素材是 ✅ 可入库的**，需逐条识读。

**附加义务**：Standard License 要求 credit（可付费升级 Gold 去署名）；免费账户每下载 4 个音后延迟 60 分钟。

---

### B9. Sonniss GDC Game Audio Bundles

**站内信息**：`https://sonniss.com/gameaudiogdc/` · `https://sonniss.com/gdc-bundle-license/`

#### B9.1 ⚠️ 2024-01-28 修订是本源的转折点

官方「Previous Versions」页原文：

> On **28 January 2024** the Agreement was amended: the **NO AI TRAINING OR USAGE** section was added; and in RIGHTS GRANTED, **the former right at (c) to freely distribute the licensed sound effects and make an unlimited amount of copies was removed**, a synchronization right was added at (d), and the public-performance right moved from (d) to (c).

**旧版（2024-01-28 前下载的）RIGHTS GRANTED**：

> c) **Licensee may freely distribute the licensed sound effects and make an unlimited amount of copies.**
> d) Licensee may publicly perform a reproduction of the sound effects over any form of medium.

**现行版 RIGHTS GRANTED**：

> a) Licensee may use the licensed sound effects on an unlimited number of projects for the entirety of their life time.
> b) Licensee may use and modify the licensed sound effects for personal and commercial projects **without attribution** to the original creator.
> c) Licensee may publicly perform a reproduction of the sound effects over any form of medium.
> d) Licensee may use the licensed sound effects for the purposes of **synchronization with audio and visual projects** the Licensee is involved with, which includes but is not limited to: games, films, television & interactive projects.

**现行版禁止**：

> a) Licensee may not modify any of the sound effects with intent to claim authorship of the original recording.
> b) **Licensee may not sell any of the sound effects as they come.** (Although the sound effects may be sold as incorporated into licensee project).
>
> **NO AI TRAINING OR USAGE** [...] the Licensee is expressly prohibited from using any sound effects licensed under this Agreement for the purpose of training artificial intelligence technologies.

**⚠️ 版本适用规则（重要）**：

> the version that governs your use of the sound effects is the one that was published at sonniss.com/gdc-bundle-license/ **on the day you downloaded**. **A newer version is never applied backwards to you.**

#### B9.2 FAQ 里的直接答案

> **Can I resell or redistribute these sound effects?**
> **Not as standalone files or in sound effect libraries.** But you can absolutely sell them as part of your finished game, film, app, or creative project. **The restriction only applies to raw redistribution.**

> **Can I use these sound effects for AI or machine learning training?**
> No. AI/ML training is strictly prohibited under our license.

#### B9.3 档位判定

**❌ 不可入库（现行版）。**

理由：FAQ 明说 "**Not as standalone files or in sound effect libraries**"。本项目的 `library/sfx/<id>/{meta.json, 音频文件}` **就是一个 sound effect library 的形态**，且导出包把原始文件分发给第三方 → 构成 "raw redistribution"。

🔗 **仅远端引用**：Sonniss 明确允许 "as part of your finished game" → 如果引擎改为运行时从远端流式播放而非落盘，或许在旧版条（c 条自由分发，2024-01-28 前的下载）下更宽松；现行版下仍属灰色。

**规模参考**：
- GDC 2024 bundle：27.5 GB+
- GDC 2026 bundle：7.47 GB+，347+ 文件（`https://gdc.sonniss.com/`）

**下载形态**：整包 ZIP / 分卷，从 Sonniss 站点或分发的 CDN。无 API，无逐文件直链。

---

### B10. Oculus Audio Pack 1（Meta）— 额外发现的优质源

**站内信息**：`https://developers.meta.com/horizon/downloads/package/oculus-audio-pack-1/`

**官方描述原文**：

> The Audio Pack is an archive of WAV audio files provided as a convenience for application developers. It includes a variety of sounds including weather, animal sounds, human vocals, creepy atmospheric noises, UI interaction feedback, doors, musical cues, laser blasts, and more.
>
> **All files are licensed under the Creative Commons Attribution 4.0 License.** See the included License.txt for more information.

- 500+ 高质量 WAV，为 VR 场景录制
- 另有 **Oculus Ambisonics Starter Pack**（AmbiX WAV 环境声场），同样 **CC BY 4.0**
- 内容偏「恐怖 / 环境 / UI 反馈 / 脚步」，很适合 galgame 的氛围与音效

**档位判定**：⚠️ **有条件可入库**（CC BY 4.0，需署名）。

**抓取形态**：登录 Meta 开发者账号后下载 zip；**无 API、无逐文件直链**。属于「一次性拉一个大包」的源。

---

### B11. Kenney.nl — 额外发现的优质源

**站内信息**：`https://kenney.nl/assets/category:Audio?sort=release`

**Support 页原文**：

> **Yes, all game assets on the asset pages are public domain licensed (CC0).** You're free to use them, even in commercial projects.

**音频分类现有包**（实测页面）：

| 包名 | 许可 |
|---|---|
| Sci-fi Sounds | CC0 |
| Interface Sounds | CC0 |
| Impact Sounds | CC0（130 个文件） |
| Voiceover Pack (Fighter) | CC0 |
| Voiceover Pack | CC0 |
| Music Jingles | CC0 |
| RPG Audio | CC0 |
| Casino Audio | CC0 |
| Digital Audio | CC0 |
| UI Audio | CC0 |

**档位判定**：✅ **可入库**（无署名义务）。

**抓取形态**：每包一个 ZIP 直链（`https://kenney.nl/media/pages/assets/<pkg>/<hash>/<pkg>.zip` 一类），页面 HTML 里有。无 API。另有付费 all-in-1 包。

---

### B12. 日本系音源

> ⚠️ **先纠正一处事实**：用户提到的「効果音ラボ https://soundlabo.com」中，**`soundlabo.com` 与効果音ラボ无关**。实测：
>
> ```
> GET https://soundlabo.com/ → HTTP 200, final URL = https://www.hugedomains.com/domain_profile.cfm?d=soundlabo.com
> 页面标题：「SoundLabo.com is for sale | HugeDomains」
> ```
>
> `soundlabo.com` 是一个**待售的停放域名**。効果音ラボ的官方站点是 **`https://soundeffect-lab.info/`**。

#### B12.1 OtoLogic —— ✅ **明确允许再分发**（最优质日本源）

**站内信息**：`https://otologic.jp/`

**许可原文（FAQ）**：

> 当サイトが採用しているバージョンは **CC BY 4.0**（クレジット表記の義務さえ果たせば、その他大きな制約はないライセンス）です。
>
> ・**素材の再配布はできますか？**
> **適切なクレジット表記が継承される限り、素材用音源として用いるだけでなく、素材そのものを第三者に再配布し、自由に他者と共有することもできます（CC BY 4.0 第2条 aの1のA参照）。**
> ※クレジット表記義務を消滅させたり、新たな使用条件を課すことはできません（CC BY 4.0 第2条 aの5のB参照）

**利用条件（官方原文）**：

> ・利用者を問いません（個人・団体・法人、国籍や所在地など）
> ・利用するメディアの種類を問いません（動画・ラジオ・**ゲーム**など）
> ・権利者と連絡を取る必要がありません（許可申請・使用報告など）
> ・**営利目的の利用も問題ありません**（商業・収益化利用など）
> ・利用する作品の内容を問いません（年齢制限のある表現など）
> ・**素材の改変も問題ありません**（編集・加工・編曲など）
>
> 利用条件は「クレジット表記をすれば無料」とシンプルです。

**内容**：BGM / ジングル / 効果音 三类。

**档位判定**：⚠️ **有条件可入库**（CC BY 4.0，需署名 `OtoLogic`）。
**这是所有日本源里唯一明确写「素材そのものを第三者に再配布できる」的站点**，非常契合本项目。

**署名格式**：站点未给强制格式，FAQ 只说「『OtoLogic』のクレジットを表示すれば無料で使用できます」。写入 `meta.json` 的 `attribution` 用：`OtoLogic (https://otologic.jp/) — CC BY 4.0`。

**抓取形态**：站点按类别列表，每个素材是 `<a>` 直链下载；素材以 ZIP 形式分发（付费版给 WAV，免费版给 mp3/ogg）。无 API，需解析 HTML。

#### B12.2 効果音ラボ（soundeffect-lab.info）—— ❌ 再配布禁止

**站内信息**：`https://soundeffect-lab.info/agreement/` · `https://soundeffect-lab.info/faq/`

**利用規約原文**：

> 当サイトの音声ファイル（MP3形式）をダウンロードした時点で、下記規約に同意したものとみなします。
>
> - 使用にあたっての報告、リンク、クレジット表記不要（禁止ではなく任意）
> - アダルト作品、公序良俗に反する作品、違法行為に利用することは禁止
> - 個人、法人、公的機関問わず無料で使用可能（**商用利用無料**）
> - **再配布禁止**※許可できる場合あり（企業様限定）。**効果音が重要な役割を果たすコンテンツも再配布に該当**（後述）。
> - 効果音を改変して利用することは問題ないが、**改変したものを再配布することは禁止**
> - **効果音ファイルへの直リンク禁止**
> - **AI学習用のデータとして利用することは禁止**

**「再配布」的定义（官方原文，这是判定的核心）**：

> ### 当サイトにおける再配布の定義
>
> 効果音ファイルそのものを再配布することだけでなく、「**効果音が重要な役割を果たすコンテンツ**」を作成することも、当サイトでは再配布と同じ扱いとしています。音を聴かせることを主目的とした商品やアプリもこれに該当します。
>
> **再配布に該当するケース**
> 例1）効果音を自由に鳴らせるアプリを作る（ポン出しサンプラー的なもの）
> 例2）**動画に効果音を挿入できるアプリを作る際、デフォルトの効果音素材として組み込む（動画以外の作成アプリも該当）**
> 例3）効果音を販売もしくは配布する
> 例4）効果音だけを流す動画を作る
> 例5）効果音の紹介を目的とした動画を作る
> 例6）当サイトの効果音を組み込んだフリー素材を作る
>
> **再配布でないケース**
> 例1）アプリに操作音として効果音を組み込む（**音源ファイルむき出しでも可**）
> 例2）楽曲の中に効果音を組み込む
> 例3）TV番組の演出音として素材を使用
> 例4）効果音を利用したYouTube動画を公開
> 例5）**RPGツクールのRTPに効果音素材として組み込む（当該作品は商用として有料販売も可）**

**⚠️ 这里有个真实的解读灰区，必须写清楚**：

- 「再配布でないケース 例1」说「アプリに操作音として効果音を組み込む（**音源ファイルむき出しでも可**）」→ 一个 galgame 把 SFX 嵌进去并分发，**字面上接近这一条**
- 「再配布でないケース 例5」说「RPGツクールのRTPに効果音素材として組み込む（**当該作品は商用として有料販売も可**）」→ **这几乎就是 galgame 引擎的场景**（引擎自带素材 → 作品分发）
- 但「再配布に該当するケース 例2」说「動画に効果音を挿入できる**アプリ**を作る際、デフォルトの効果音素材として組み込む」→ 如果本引擎把素材放进 `library/` 作为**默认随包素材**，就踩这条
- 而本站的定位是**素材库**（`library/sfx/`）+ **引擎默认随包**（若引擎自带样例素材）→ 风险明显

> **⚠️ 特别注意 FAQ 里的一条**：
>
> 効果音ラボは、ニコニ・コモンズにも当サイトと同じ音源を登録しております。[...] ニコニ・コモンズ音源の規約：**営利利用には許可が必要**。効果音ラボの規約：営利利用可能。**同じ音源でもダウンロードしたサイトにより利用規約が異なります。**

**档位判定：❌ 不可入库。**

保守判定理由：本引擎的分发形态（`library/sfx/` 目录 + 导出包 `assets/` 含原始 mp3）与「素材集」高度同构，落在「例3）効果音を販売もしくは配布する」与「例6）当サイトの効果音を組み込んだフリー素材を作る」的射程内。且规约明文「**素材の著作権は放棄していないため、無断での再配布は固く禁じております**」。

**额外限制**：直リンク禁止、AI 学习禁止、Content ID 注册禁止、音商標登録禁止、アダルト作品禁止（**对 galgame 场景是硬伤**）。且**没有批量下载**（官方 FAQ 明确说不提供）。

#### B12.3 魔王魂（maou.audio）—— ⚠️ **可选 CC BY 4.0**

**这是日本源里第二个有 CC 许可分支的站点。**

**官方原文**：

> **魔王魂で配布されている音楽は クリエイティブ・コモンズ 表示 4.0 国際 ライセンスの下に提供されています。** このランセンス下では作品の暗号化が禁止されていますが、RPGツクールシリーズやウディタ、Unityなどのゲーム制作用途における暗号化は許可します。許可証の発行も可能です。
>
> **魔王魂ではCCライセンスでご利用いただくか、下記の魔王魂素材利用規約を守っていただくかを選んでご利用いただけます。**

**自家规约要点**：

> - 個人利用も商用も無料で利用可能！報告一切不要！
> - 改造OK！タイトルや歌詞変更もOK！
> - 可能な限り『音楽：魔王魂』みたいに著作表記して下さい。
> - 禁止事項：著作を偽る行為、フレーズを真似る盗作行為
> - **過去に公開していた曲も素材利用はOK！ただし曲単品を再配布するのはNG!**
> - NFTへの出展は一切禁止
> - **AIによる自動作曲システムなどに組み込んでフレーズや音色を再利用することを禁止**（映像や画像生成システムのBGMとして利用するのはOK）
> - JASRAC等への楽曲登録禁止、他素材サイトへの登録禁止、ストリーミング配信禁止

**⚠️ 二选一的解读关键**：
- 走**自家规约** → 「曲単品を再配布するのはNG」→ ❌
- 走 **CC BY 4.0** → Section 2(a)(1)(A) 授权 `reproduce and Share the Licensed Material, in whole or in part` → **✅ 允许再分发原文件**（需署名）
- 站点明说「二选一」，所以**选 CC BY 4.0 是合法路径**

**版权声明**：`音楽：魔王魂` / 英文版 `Music: Koichi Morita Music`

**档位判定**：⚠️ **有条件可入库，但必须显式选择 CC BY 4.0 路径**，并在 `meta.json` 记录「许可依据：CC BY 4.0（魔王魂提供了 CC 与自家规约二选一）」。若走自家规约则 ❌。

**抓取形态**：站点按分类（BGM / 効果音）列表，每个音有直接下载链接。无 API。**无批量下载。**

#### B12.4 DOVA-SYNDROME —— ❌

**站内信息**：`https://dova-s.jp/help/articles/license/`

**禁止事项原文**：

> ## 再配布・演奏・その他
> - 営利、非営利を問わず、**音源を配布、または販売すること**
> - **コンバート等を行わず、エンドユーザーが容易に音源ファイルに音声ファイルとしてアクセス、複製が可能な状態での利用**
> - ライブパフォーマンス等、公での音源の演奏
> - 音源の楽譜を作成し公開・販売すること
> - **音源を AIのトレーニングに使用すること**
>
> 7. **作曲・制作者名の表示および偽称の有無を問わず、また、営利、非営利を問わず、音源を配布、または販売すること**
> ※**オープン・クローズドを問わずインターネット上での公開、CD等媒体での配布など、形態を問わずエンドユーザーが音源のみを利用することができる一切の方法が該当します。**

**站点 FAQ 的补充（针对游戏场景）**：

> はい、**ゲームの背景音楽（BGM）として使用する範囲であれば、商用、非商用問わず無料でご利用いただけます。※音楽データそのものを素材として再配布・提供できる形で利用したり、音楽が主なコンテンツとなるゲームには使用できません。**

**档位判定：❌ 不可入库。**

理由：第 2 条禁止「**エンドユーザーが容易に音源ファイルに音声ファイルとしてアクセス、複製が可能な状態での利用**」—— 本引擎的 `assets/` 就是明文的原始音频文件，用户可任意复制。且第 1 条禁止「音源を配布」。

**另注**：DOVA 还对「音楽作品における利用」有额外限制，且要求到 UGC 平台（YouTube/TikTok）分发；Apple Music/Spotify 分发、BGM 素材形态分发均禁止。

#### B12.5 ポケットサウンド（pocket-se.info）—— ❌

**利用規約原文**：

> ポケットサウンドの音素材は無料でご利用頂けますが、ご利用の際には**作品でのクレジット表記、またはポケットサウンドへのリンク**をお願いします。
>
> **利用可能範囲**
> - 商用利用：OK / 音素材の加工：OK / Unityゲームでの利用：OK / 18禁ゲームでの利用：OK
> - 動画での音素材利用：OK / YouTube収益化：OK / 即売会等で頒布する作品での利用：OK
>
> **禁止事項**
> - 音素材への直リンク
> - BGM素材のみをそのまま動画にしてYoutube等へのアップロード
> - **音素材そのものの二次配布・転売**
> - 有償利用申請をせずにクレジット表記の未記載

**档位判定：❌ 不可入库**（「音素材そのものの二次配布」禁止）。
注：本站**需要署名**（免费档），不署名需付费（效果音 550円/个、BGM 1,100円起，或月额 1,650円 / 10,000円）。

#### B12.6 甘茶の音楽工房（amachamusic.chagasi.com）—— ❌

**利用規約原文**：

> ● 公開中の音楽素材は、商用利用、個人利用問わず利用できます。
> ● 音楽素材は、ウェブ、映像、ゲーム、ラジオなど、**何かのBGMとしてお使い下さい**。
> ● **音楽だけを販売したり、2次配布することは禁止です。**
> ● 著作権は放棄しておりません。楽曲の著作権は甘茶にあります。
> ● 作曲者を偽る行為は禁止です。
> ● 楽曲を使用した作品を、JASRACなど著作権管理団体に登録することはできません。
> ● **音楽素材の直リンクでの使用は禁止です。**

> Q: お店のBGMとして使っても良いですか？ A: 問題ありません。**お店のBGMとしての使用は2次配布と見なしません**のでご利用いただけます。

**档位判定：❌ 不可入库**（「音楽だけを販売したり、2次配布することは禁止」）。
另注：**2019 年以降新曲追加停止**。mp3 仅 128kbps。

#### B12.7 其他日本源快查

| 站点 | 许可要点（原文/摘要） | 档位 |
|---|---|---|
| **効果音辞典**（sounddictionary.info） | 「**再配布禁止**※許可できる場合あり（企業様限定）。効果音が重要な役割を果たすコンテンツも再配布に該当」「**効果音ファイルへの直リンク禁止**」「**AI学習用のデータとして利用することは禁止**」 | ❌ |
| **JapanSoundTokyo**（japansound.tokyo） | 「**再配布禁止**」「編集した効果音も再配布禁止」「素材のまま又は加工や変換しただけの状態などで、素材として販売や公開、配信するなど、**第三者が取得できる状態を禁止します**」「ツクール制作等によりシステム上音源がむき出しになる場合、必ず著作表記と音源の二次配布、無断利用禁止の表記をお願いいたします」 | ❌（注：ツクール条暗示可，但需书面联系） |
| **音彩工房**（onseikoubou.com） | 「**音楽素材そのものの無断再配布は除く**」「当サイトの音楽素材を、**無断で販売、再配布すること**」为禁止事项 | ❌ |
| **sound labo' fuzzy**（srtk.sakura.ne.jp/slf/） | 「**素材として使用せず、作品単体のまま二次配布を行うことは原則禁止**」「作品ファイルへの直リンクは禁止」 | ❌ |
| **Audiostock**（audiostock.jp） | 商业授权库，有期间限定免费作品；但模板「利用詳細のご連絡必須」、禁止二次利用，**且明确提供「研究・機械学習でのご利用はデータセット提供プラン」（即数据集另行授权）** | ❌（免费档不适合） |

**日本系总体结论**：**只有 OtoLogic（CC BY 4.0，明文允许再分发）与 魔王魂（可选 CC BY 4.0）两个源可用于本项目。** 其余全部是「免费使用但禁止再分发原始文件」的模式 —— 这是日本音素材行业的普遍惯例。

---

## C 类：非「下载站」但能解决同一问题的角度

### C1. 公开的 CC0 / 公有领域音频数据集

> 适合**批量灌库**（一次性拉大包，而不是逐条 API 调用）。

| 数据集 | 平台 | 内容 | 体积 | 许可 | 可用性 |
|---|---|---|---|---|---|
| **FSD50K**（官方） | Zenodo | 51,197 条 Freesound 音频，200 类 | ~100GB | ⚠️ **混合**：CC0 + CC-BY + CC-BY-NC + CC Sampling+；**数据集本身 CC-BY** | 需按 clip 逐条过滤许可 |
| **HughXuechen/fsd50k-cc0-curated-v1** | HuggingFace | **纯 CC0 子集**，1,408 个 WAV（FSD50K dev split） | **~1.5 GB / 4.73 小时** | ✅ **全部 CC0**，"no attribution required" | ✅ 推荐，直接从 HF 拉 |
| **schismaudio/vcsl-percussion** | HuggingFace | VCSL 打击乐子集，1,524 个 WAV 乐器采样 | ~1.5 GB | ✅ **CC0-1.0** | ✅ 推荐（适合做打击乐/环境 SFX） |
| **mrfakename/cc0-music-captioned** | HuggingFace | 9,015 首纯器乐 CC0 曲（来源含 FreePD、Freesound、Pixabay、Chosic、FMA），带文字描述 | **~294 GB**（download_size 294,018,631,460 B） | ✅ CC0 | ⚠️ 体积巨大，需分片拉 |
| **openmusic/cc0-1.0-music** | HuggingFace | CC0 音乐集 | 未公开 | CC0 | ⚠️ **Gated**：需接受条件才能访问（可能是署名要求或限制） |
| **SoundSafari/CC0-1.0-Music** | GitHub | ~7,000 首 CC0 曲，**~40 GB** | 40 GB | ✅ CC0 | ✅ 有 git 仓库，按来源网站分组 |
| **sumin0223/FSD50k / Fhrozen/FSD50k** | HuggingFace | FSD50K 镜像 | ~100GB | 混合 | 同 FSD50K 官方 |

**HF 拉取方式（URL 形状）**：

```
https://huggingface.co/datasets/<org>/<name>
# parquet 分片：https://huggingface.co/datasets/<org>/<name>/resolve/main/data/<split>-*.parquet
# 或 git clone https://huggingface.co/datasets/<org>/<name>
```

**⚠️ 许可注意（FSD50K 官方原文）**：

> All audio clips in FSD50K are released under Creative Commons (CC) licenses. **Each clip has its own license as defined by the clip uploader in Freesound, some of them requiring attribution to their original authors and some forbidding further commercial reuse.** [...] The licenses are specified in the files `dev_clips_info_FSD50K.json` and `eval_clips_info_FSD50K.json`. **These licenses are CC0, CC-BY, CC-BY-NC and CC Sampling+.** In addition, FSD50K as a whole [...] is released under CC-BY.

→ **不要直接拉官方 FSD50K 全量**，用 `HughXuechen/fsd50k-cc0-curated-v1` 这类已过滤纯 CC0 的子集。

**⚠️ 一个附带风险**：`schismaudio/vcsl-percussion` 条目自述是「percussion subset of VCSL」，但**独立第三方对 VCSL 的许可有争议**（VCSL 的 CC0 声明在其 repo 里，本节未独立核实到 VCSL 官方页面原文）。建议拉取前到 VCSL 官方 GitHub 核对 LICENSE。

---

### C2. 免费开源的本地音频生成模型（不依赖线上资源）

> 路线价值：**完全绕开线上站点的许可与抓取问题**，且产物是「你生成的」，理论上可自由分发。
> ⚠️ 但本节所有模型都**必须核对权重许可**，而不是代码许可 —— 这是最常见的误区。

| 模型 | 代码许可 | **权重许可** | 商用可行性 | 备注 |
|---|---|---|---|---|
| **AudioCraft / MusicGen**（Meta） | MIT | **CC-BY-NC 4.0** | ❌ **不可商用** | 官方原文：`The code in this repository is released under the MIT license. The models weights in this repository are released under the CC-BY-NC 4.0 license.` 训练数据：10K 内部曲库 + ShutterStock + Pond5（**全是授权版权音乐**） |
| **AudioGen**（同仓） | MIT | CC-BY-NC 4.0 | ❌ | 文本转音效 |
| **Stable Audio Open 1.0** | — | **Stability AI Community License** | ⚠️ 有门槛 | 见下 |
| **Stable Audio Open Small / 3.0 Small·Medium** | — | Stability AI Community License | ⚠️ 有门槛 | 同上 |
| **ACE-Step v1 (3.5B)** | **Apache-2.0** | **Apache-2.0** | ✅ **可商用** | 无营收门槛 |
| **ACE-Step v1.5** | **MIT** | **MIT** | ✅ **可商用** | 官方明确 "Commercial-Ready" |

#### C2.1 MusicGen / AudioCraft —— ❌ 不可商用

官方 model card 原文：

> **License: Code is released under MIT, model weights are released under CC-BY-NC 4.0.**

训练数据（论文原文）：

> We use 20K hours of licensed music to train MusicGen. Specifically, we rely on an internal dataset of 10K high-quality music tracks, and on the ShutterStock and Pond5 music data.

→ **CC-BY-NC 权重 = 生成物用于商业项目有法律风险**。仅适合非商用/自用。

#### C2.2 Stable Audio Open —— ⚠️ 有营收门槛

**Stability AI Community License（2024-07-05 版）关键条款原文**：

> This Agreement is intended to allow research, non-commercial, and **limited commercial uses** of the Models free of charge. In order to ensure that certain limited commercial uses of the Models continue to be allowed, **this Agreement preserves free access to the Models for people or organizations generating annual revenue of less than US $1,000,000**.

> If You are using or distributing the Stability AI Materials for a Commercial Purpose, **You must register with Stability AI at (https://stability.ai/community-license)**.

> If at any time You or Your Affiliate(s), either individually or in aggregate, **generate more than USD $1,000,000 in annual revenue** [...] any licenses granted to You under this Agreement shall terminate as of such date.

**`Commercial Purpose` 定义**（对本项目重要）：

> "Commercial Purpose" means any purpose other than a Research Purpose or Non-Commercial Purpose that is primarily intended for commercial advantage or monetary compensation to You or others, including but not limited to, (i) **creating, modifying, or distributing Your product or service, including via a hosted service or application programming interface**, and (ii) for Your business's or organization's internal operations.

**分发义务（若你要分发带模型的产物）**：

> (i) provide a copy of this Agreement to that third party,
> (ii) retain the following attribution notice within a "Notice" text file: "**This Stability AI Model is licensed under the Stability AI Community License, Copyright © Stability AI Ltd. All Rights Reserved**", and
> (iii) **prominently display "Powered by Stability AI"** on a related website, user interface, blogpost, about page, or product documentation.

**输出归属（对生成素材入库很关键）**：

> (iii) **Ownership of Outputs.** As between You and Stability AI, **You own any outputs generated from the Models** or Derivative Works to the extent permitted by applicable law.

**训练数据（论文原文，对溯源友好）**：

> Our dataset consists of 486,492 audio recordings, where 472,618 are from Freesound and 13,874 are from the Free Music Archive (FMA). All audio files are licensed under **CC0, CC BY, or CC Sampling+**. [...] we are left with **266,324 CC0, 194,840 CC-BY, and 11,454 CC Sampling+** audio recordings.

**模型参数**：latent diffusion，最长 **47 秒**、**44.1kHz 立体声**；autoencoder 156M + T5 text encoder 109M + DiT 1057M；消费级 GPU 可跑。

**档位判定**：⚠️ **有条件**。开源项目 / 个人（<$1M 年营收）可免费用 + 商用，但需注册并满足 Notice 文件 + "Powered by Stability AI" 展示义务。**对本项目（自托管开源引擎）是可行的，但需在 README/关于页加 "Powered by Stability AI"**。

**⚠️ 一个重要的负面结论（论文原文）**：

> On music generation. Note that most commercial music is copyrighted. Hence, our model was trained with limited high-quality music since we focused on CC training data. **As a result, it is not competitive against state-of-the-art music models.** [...] Due to the above limitations, prompt engineering may be required for best results. Further, it was mainly trained with English text and is not expected to perform well in other languages.

→ **Stable Audio Open 做 galgame BGM 的效果预期不高**，更适合做 SFX。

#### C2.3 ACE-Step —— ✅ 最宽松的路线

**ACE-Step v1（`ace-step/ACE-Step`）**：

> ## 📜 License & Disclaimer
> This project is licensed under **Apache License 2.0**

HuggingFace 模型卡（`ACE-Step/ACE-Step-v1-3.5B`）：

> **License: Apache 2.0**
> Developed by: ACE Studio and StepFun
> Model type: Diffusion-based music generation with transformer conditioning

**ACE-Step v1.5（`ACE-Step/Ace-Step1.5`）** —— 官方宣传要点：

> 🚀 ACE-Step v1.5 is a highly efficient open-source music foundation model designed to bring commercial-grade music generation to consumer hardware.
>
> - 💰 **Commercial-Ready**: Unlike many models trained on ambiguous datasets, ACE-Step v1.5 is designed for creators. **You can strictly use the generated music for commercial purposes.**
> - 📚 Safe & Robust Training Data: The model is trained on a massive, legally compliant dataset consisting of:
>   - Licensed Data: Professionally licensed music tracks.
>   - Royalty-Free / No-Copyright Data: A vast collection of public domain and royalty-free music.
>   - Synthetic Data: High-quality audio generated via advanced MIDI-to-Audio conversion.
> - ⚡ Extreme Speed: Generates a full song in **under 2 seconds on an A100** and under 10 seconds on an RTX 3090.
> - 🖥️ Consumer Hardware Friendly: Runs locally with **less than 4GB of VRAM**.
>
> **License: [MIT]**

**档位判定**：✅ **可商用**（v1 = Apache-2.0，v1.5 = MIT），**无营收门槛、无 attribution 强制义务**。

**对本项目的意义**：如果目标是「一条完全不依赖线上资源的 BGM 生产线」，**ACE-Step 是目前许可最干净的免费开源选择**（Apache-2.0 / MIT 双版本，均无 NC 限制、无营收门槛）。

---

## 附：实测记录汇总表

> 全部请求于 2026-10-04 执行。墙外站点经 `-x http://127.0.0.1:7890`，国内站点直连。

| # | 请求 | 结果 |
|---|---|---|
| 1 | `GET https://freesound.org/` | **200** |
| 2 | `GET https://freesound.org/apiv2/search/text/?query=footsteps&page_size=2` | **401**（无 token） |
| 3 | `GET https://freesound.org/apiv2/sounds/68441/` | **401** |
| 4 | `GET https://freesound.org/apiv2/apply/` | **302**（需登录态） |
| 5 | `GET https://freesound.org/data/previews/316/316847_5121236-hq.mp3` | **301** → `cdn.freesound.org` |
| 6 | `GET https://cdn.freesound.org/previews/68/68441_871124-hq.mp3` | **200** `audio/mpeg` 36217 B |
| 7 | `GET https://cdn.freesound.org/previews/342/342465_3906011-hq.mp3` | **200** `audio/mpeg` 196499 B |
| 8 | `GET .../342465_3906011-lq.mp3` | **200** `audio/mpeg` 74112 B |
| 9 | `GET https://api.openverse.org/v1/audio/?q=piano&license=cc0&page_size=2` | **200**（匿名） |
| 10 | `GET https://api.openverse.org/v1/audio/?q=piano&license=cc0&page_size=21` | **401** |
| 11 | `GET https://api.openverse.org/v1/audio/?q=piano&license=cc0&page_size=20` | **200** |
| 12 | 限流响应头 | `anon_burst: 20/min`，`anon_sustained: 200/day` |
| 13 | `GET /v1/audio/?source=wikimedia` | 报错，合法值 = `wikimedia_audio, jamendo, freesound, ccmixter` |
| 14 | `POST /v1/auth_tokens/register/`（空 body） | **400**（端点存在） |
| 15 | `GET https://api.jamendo.com/v3.0/tracks/?client_id=709fa152&...` | **200** 但 `status:"failed"`, `code:11`, `"Your application has been suspended"` |
| 16 | `GET https://ccmixter.org/api/query?f=json&limit=2&tags=blues&lic=by` | **200** JSON |
| 17 | `GET https://ccmixter.org/api/query?f=xspf&limit=2&tags=blues&lic=by` | **200** XML，含 mp3 `<location>` |
| 18 | `GET https://ccmixter.org/content/NiGiD/NiGiD_-_Roman_Song_1.mp3`（无 Referer） | **403** |
| 19 | 同上（`-H "Referer: https://ccmixter.org/"`） | **200** `audio/mpeg` 6613768 B |
| 20 | `GET https://freemusicarchive.org/` | **200** |
| 21 | `GET https://freemusicarchive.org/app-developers` | **200**（含禁止抓取条款） |
| 22 | `GET https://pixabay.com/api/audio/?key=demo&q=piano` | **400** |
| 23 | `GET https://pixabay.com/api/?key=demo&q=piano` | **400** |
| 24 | `GET https://cdn.pixabay.com/audio/2024/07/29/audio_4e09b35d5b.mp3` | **200** `audio/mpeg` 3137201 B |
| 25 | `GET https://pixabay.com/music/search/piano/` | **403**（Cloudflare） |
| 26 | `GET https://pixabay.com/service/license-summary/` | Cloudflare challenge |
| 27 | `GET https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=filetype:audio&srnamespace=6` | **200**，`totalhits: 4,429,992` |
| 28 | `srsearch=filetype:audio incategory:CC-Zero` | **200**，`totalhits: 1,172,811` |
| 29 | `srsearch=filetype:audio incategory:CC-BY-4.0` | **200**，`totalhits: 72,725` |
| 30 | `srsearch=filetype:audio incategory:PD-self` | **200**，`totalhits: 15,076` |
| 31 | `GET https://upload.wikimedia.org/wikipedia/commons/a/aa/Blue_Danube_....ogg` | **200** `application/ogg` 5236138 B |
| 32 | `GET https://archive.org/advancedsearch.php?q=collection:(opensource_audio) AND licenseurl:(*publicdomain*)...` | **200**，`numFound: 165,180` |
| 33 | 同上（简化查询，首次） | **500** `[BACKEND_ERROR] Invalid or no response from Elasticsearch` |
| 34 | 同上（重试） | **200** |
| 35 | `GET https://archive.org/metadata/why-not-93bpm` | **200** JSON，`files[]` 含 `source: original` |
| 36 | `GET https://archive.org/download/why-not-93bpm/WHY%20NOT%20-%20%2093bpm.mp3` | **302** → **200** `audio/mpeg` 4460725 B |
| 37 | `GET https://musopen.org/api/v1/search/?composer=bach&license=cc0&format=json` | **404** |
| 38 | `GET https://musopen.org/search/?license=cc0` | **403** |
| 39 | `GET https://musopen.org/` | **403** |
| 40 | `GET https://dev.musopen.org/` | **000**（无法连接） |
| 41 | `GET https://imslp.org/imslpscripts/API.ISCR.php?...type=2...` | **200** JSON |
| 42 | `GET https://incompetech.com/` | **200** |
| 43 | `GET https://opengameart.org/rss.xml` | **200** 29696 B RSS 2.0 |
| 44 | `GET https://opengameart.org/art-search-advanced?field_art_type_tid[]=13&field_art_licenses_tid[]=4` | **200** 56958 B |
| 45 | `GET https://opengameart.org/art-search-advanced?field_art_type_tid[]=13&format=rss` | **200** |
| 46 | `GET https://opengameart.org/node/1?_format=json` | **200** 但返回 HTML（**非 JSON**） |
| 47 | `GET https://freepd.com/` | **200**（页面 = "Site Closed"） |
| 48 | `GET https://www.chosic.com/download-audio/?t=113362` | **301** → `/free-music/all/` → **403** |
| 49 | `POST https://ne-mene.itch.io/general-sound-pack/download_url`（csrf + upload_id，无登录） | **200** `{"url":"https://ne-mene.itch.io/general-sound-pack/download/eyJpZCI6MjEyMzQ5MywiZXhwaXJlcyI6...}"}` |
| 50 | `GET <上一步 url>`（同 session） | **200**，页面含 "Download sounds.zip 6.5 MB" |
| 51 | `GET https://ne-mene.itch.io/general-sound-pack/file/2724433` | **302** |
| 52 | `GET https://soundlabo.com/` | **200** → 重定向到 `hugedomains.com`（**待售域名**） |
| 53 | `GET https://directory.audio/` | **200** |
| 54 | `GET https://cc0-sounds.exi.software/` | **200** |
| 55 | `GET https://api.openverse.org/v1/audio/?q=ambient&license_type=commercial` | **200**，`result_count: 240` |
| 56 | `GET https://api.openverse.org/v1/audio/?q=ambient&license_type=modification` | **200** |
| 57 | `GET https://api.openverse.org/v1/audio/?q=ambient&license_type=all-cc` | **200** |

---

## 附：对本引擎的具体落地建议

1. **`meta.json` 建议字段**（不动实现，只列事实依据）：
   - `source`：来源站（`freesound` / `openverse` / `wikimedia` / `archive.org` / `otologic` / `incompetech` / ...）
   - `sourceUrl`：原始落地页 URL
   - `license`：`CC0-1.0` / `PD` / `CC-BY-4.0` / `CC-BY-3.0` / ...
   - `licenseUrl`：许可 deed URL
   - `attribution`：**可直接用 Openverse 返回的 `attribution` 字段原文**
   - `attributionRequired`：`true` / `false`
   - `retrievedAt`：ISO 日期

2. **剧目导出时**：把 `assets/` 里所有 `attributionRequired: true` 的素材汇总进 `assets/manifest.json`，并在剧目 credits 页渲染。这样 CC BY 的义务就在「随包一起分发」的层面被满足。

3. **入库白名单建议**（按优先级）：
   - ✅ **CC0 / PD**：Freesound(preview 经 Openverse)、Wikimedia Commons CC-Zero、Internet Archive PD/CC0、OpenGameArt CC0、Kenney.nl、itch.io CC0 包、OtoLogic(⚠️署名)、HF CC0 数据集、ACE-Step 生成
   - ⚠️ **需署名**：Freesound CC BY、Commons CC-BY-4.0、OGA CC-BY/OGA-BY、incompetech CC BY 4.0、Oculus Audio Pack、魔王魂(须选 CC BY 4.0 路径)、Chosic 的 CC BY 曲目
   - ❌ **黑名单**：Pixabay、Sonniss、Zapsplat、Mixkit、Bensound、DOVA-SYNDROME、効果音ラボ、ポケットサウンド、甘茶、効果音辞典、JapanSoundTokyo、音彩工房、Audiostock(免费档)、MusicGen 权重、Free Music Archive(禁止抓取)

4. **建议排除 CC BY-SA**：因 CC 4.0 把「音乐同步到动态影像」定义为产生 Adapted Material，SA 的传染性会波及整个剧目包。
