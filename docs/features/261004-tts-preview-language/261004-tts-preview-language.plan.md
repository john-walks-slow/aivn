# 音色试听改用 Fish 官方样本（多语言）

## 背景

素材管理页/角色卡的「试听」按钮此前固定合成一句中文（`playhouse.ts` 的 `TTS_SAMPLE_TEXT`），
只在剧目设了 `voiceLanguage` 时才会被翻译成目标语言。Fish 公共库 1000 条热门音色横跨 19 种语言
（抽 300 条实测：en 115 / es 80 / ru 26 / ar 22 / zh 20 / ja 14 / fr 9 …），拿一句中文去试听俄语音色、
日语音色都不合适——音色会被迫用非母语发音，听不出它真实的样子。

## Fish 自己提供的试听素材（2026-10-04 实测）

`GET /model/{id}`（目录列表接口同样带）每条音色都有：

| 字段 | 内容 |
|---|---|
| `samples[].audio` | 作者预渲染的示例音频，R2 签名 URL（`X-Amz-Expires=3600`），无鉴权可下 |
| `samples[].text` / `default_text` | 官方示例文本，**本身就是音色母语的**（Rem 日文、俄语音色俄语、王琨中文） |
| `languages` | 权威语种标签（`["ja"]`） |

覆盖：抽 300 条，7 条没有 sample、18 条没有 `default_text`。
实测下载（经本机 Clash 代理）：Rem 289645B / 1.1s，派蒙 221100B / 1.0s，俄语音色 226114B / 1.0s。

## 方案

试听分三级：

1. **官方样本音频**：`VoiceCatalogService.sample(id)` 现取（不进 12 小时目录快照——签名 URL 一小时过期，
   存进快照只会是死链），由 `FishTts.fetchSample` 经同一条代理下到剧目的 `media-cache/tts/preview-<voiceId>.mp3`，
   再从本地静态路由回放。音色母语、零配额、点了就响。
2. **官方示例文本 + 自家合成**：没有样本的音色，用 `default_text`（同样母语）走既有 TTS 合成。
3. **语言兜底**：连示例文本都没有的音色，按 `languages[0]` 取一句母语问候（`PREVIEW_TEXTS`，未收录语种退回英语）。

试听**不再走 `runtime.synth`**：那条路会把文案翻成剧目的 `voiceLanguage`，而试听要听的是音色本身，
顺带省掉这次翻译调用，也不再为了试听去建一个 runtime（原先 `this.get(playId)` 会）。

## 影响面

- `apps/server/src/voiceCatalog.ts`：新增 `sample(id)` 与 `VoiceSample`；
- `apps/server/src/tts.ts`：抽出 `cacheFile`，新增 `fetchSample`；
- `apps/server/src/playhouse.ts`：`ttsPreview` 改为三级策略，删除 `TTS_SAMPLE_TEXT`；
- API `POST /api/plays/:id/tts-preview` 与前端调用形状不变（仍返回 `{url}`）。
