# Fish 音色库调研（260929）

调研目的：回答两个问题——① 语音语言（基于 fish）还能支持多少语言；② 音 色包列表能不能从 fish api 方便获取。

## 1. 语音语言：小语种可行，且不需要换模型

`voiceLanguage` 走的是 LLM 翻译（`src/translate.ts`），翻译完再送同一个 `s2.1-pro-free` 模型合成。翻译侧与 TTS 侧解耦，所以**支持多少语言取决于两点：LLM 会不会翻 + 音色支持该语言**。实测用同一个模型合成了 6 个小语种（hi / id / tl / ko / de / sw），全部返回真实音频字节，无报错。

热门前 1000 个音色的语言分布（一次抓取实测）：

| 语言 | 数量 | | 语言 | 数量 | | 语言 | 数量 |
|---|---|---|---|---|---|---|---|
| en | 309 | | zh | 88 | | fr | 24 |
| es | 285 | | ar | 71 | | de | 9 |
| ru | 92 | | ja | 51 | | it | 7 |
| pt | 92 | | | | | ko | 3 |
| | | | | | | tl / hi / sw / ro / el / sv / lv / cy / id | 各 1 |

结论：小语种确实存在且可用，但**是长尾**——多数语种只有个位数音色，且都挤在 1000 窗口的尾部。UI 侧据此决定：语言下拉显示条数，让用户一眼看出"这个语种只有 1 个音色"，而不是以为选了就有一大堆。

## 2. 音色列表：有 API，无需抓网页

`https://fish.audio/voice-library` 页面 HTML 里不嵌数据（扫过，无内联 JSON）。直接打 API：

```
GET {base}/model?page_size=100&page_number=N&self=false&sort_by=score
Authorization: Bearer <key>
→ { total, items[], has_more, accessible_upper_bound, window_limited }
```

`items[]` 字段：`_id` / `title` / `description` / `cover_image` / `tags[]` / `languages[]` / `state` / `like_count` / `author{}`。

可用过滤器：`?language=ja`（精确）、`?title=narration`（模糊）。本次实现没有用服务端过滤——1000 条一次性抓全丢给前端，筛选在内存里做，交互零延迟。

### 关键约束

- **免费额度只到 1000**：`accessible_upper_bound: 1000`、`window_limited: true`，第 11 页返回 0 条。
- **目录外不等于不可用**：demo 剧目的 16 条预置音色（含 koharu 的「萝莉萌妹」`f82e3885…`）**都不在这 1000 里**，但 `GET /model/{id}` 能解析、`state: "trained"`、合成正常。所以"不在目录"不能当成"无效"，角色已填的 voiceId 必须能按 id 单条解析。
- **`total` 不可信**：带过滤时返回 1000，不带过滤时返回 1002，而 `items`/`has_more` 才是真的。判断还有没有下一页只能看 `items`。
- **`state` 必须过滤**：`trained` 之外的模型进不了合成，进目录等于让用户选到必然失败的音色。
- **封面 CDN**：`https://public-platform.r2.fish.audio/coverimage/<id>` 返回 200 image/jpeg。（`fish.audio/coverimage/<id>` 是 308 重定向；带 `.png` 后缀 404。）

### 走过的弯路（勿再试）

| 端点 | 结果 |
|---|---|
| `/v1/models`、`/v1/voices`、`/api/v1/voices`、`/api/explore/voices`、`/v1/models/{id}` | 404 |
| `/v1/wallet/self/api-info` | 404 |
| `fishaudio.org/api/open/v1/voices` | 401 —— 新平台 API 拒绝旧的 `sk-` key |

最终可用且已鉴权通过的就是 legacy 的 `api.fish.audio/model`。

## 3. 结论落到设计

1. 删掉 16 条硬编码 `VOICE_PRESETS`，**只信 API 目录**（用户决定：完全替换，不留兜底列表）。抓不到就在 UI 上报错，不假装还有 16 条能用。
2. 目录服务端抓一次缓存 12 小时（`media-cache/voices.json`），前端展开面板时读缓存，避免每次开面板都打 10 页网络。
3. 角色已填的 voiceId 走 `/api/voices/:id` 单独解析，保证 demo 这类"目录外但合法"的配置在 UI 上显示真实名字。
4. 语音语言下拉从 4 个硬编码扩到 34 个 ISO 639-1 语种。
