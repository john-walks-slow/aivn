# Fish Audio 音色库接入（P6 增量）

## 问题

原音色选择面是 `packages/core/src/speech/voices.ts` 里硬编码的 16 条 `VOICE_PRESETS`，
web 侧 `AssetsView` 直接摊进一个原生 `<select>`。两个问题：

1. **语言面窄**：16 条里只有 4 条非中日（en ×3、ja ×3、ko ×0），用户想试小语种（印地语、
   印尼语、他加禄语、斯瓦希里语、威尔士语…）无从下手；`voiceLanguage` 翻译目标也只硬编码
   了 zh/ja/en/ko 四个。
2. **列表是死的**：想加音色必须改代码重新构建，音色库页面上的新音色永远进不来。

## 实测基准（2026-09-29）

`GET https://api.fish.audio/model`（Bearer key，与 TTS 同一把 key）实测：

| 项 | 结论 |
|---|---|
| 可达音色数 | `total: 1000`，`accessible_upper_bound: 1000`，`window_limited: true` —— 免费档只开放热度前 1000 |
| 分页 | `page_size` ≤ 100，`page_number` 从 1 起，第 11 页返回 0 条 |
| 字段 | `_id` / `title` / `description` / `languages[]` / `tags[]` / `like_count` / `cover_image` / `state` |
| 状态 | 抓到的 1000 条 `state` 全为 `trained`（未训练完的模型进不了 TTS） |
| 语言分布 | en 309、es 285、ru 92、pt 92、zh 88、ar 71、ja 51、fr 24、de 9、it 7、ko 3、tl 2、sw 1、ro 1、el 1、sv 1、lv 1、hi 1、cy 1、id 1 |
| 筛选 | `?language=ja` / `?title=narration` 均生效（模糊、按热度排序） |
| 单条解析 | `GET /model/{id}` 生效，可解析**不在前 1000** 的音色 |

**小语种合成实测**（`fish-tts` 逐条验证，全部出音）：印地语、印尼语、他加禄语、韩语、
德语、斯瓦希里语 —— 小语种音色用 `s2.1-pro-free` 直接可用，**不需要额外改造**。

**既有 16 条预置音色不在前 1000 内**（含 demo 用的 `f82e3885…` 萝莉萌妹），
但仍是合法 `reference_id`（`GET /model/{id}` 返回 200，`state: trained`）——合成照常，
只是不会出现在热门列表里。

## 方案

### 决策 1：完全替换硬编码预置表，改为 API 拉取

用户已定。`VOICE_PRESETS` 删除，`isVoiceId` 简化为 32 位 hex 正则。
拉不到就是拉不到——面板显式报错，不做静默降级（符合项目「异常只给错误提示」铁律）。

**旧音色怎么办**：`voiceId` 已填但不在目录里时，按钮照常显示并标注「不在当前库中」，
试听照常（合法 id 就能合成）。这不是降级策略，是把当前状态如实显示出来。

### 决策 2：全屏音色库弹层

角色卡里的音色控件从 `<select>` 换成「选择音色」按钮 → 打开全屏面板：
左侧语言轨（带计数）+ 顶部搜索框 + 右侧音色卡网格（封面/名/语言/标签/热度）+ 逐条试听。

### 决策 3：全量抓一次 + 本地筛选

一次拉满 10 页 1000 条落盘缓存（12h TTL），搜索/语言筛选在内存里做。
不每次筛选都打 Fish API——省往返，且筛选零延迟。`?refresh=1` 强制重抓。

### 落点

| 文件 | 职责 |
|---|---|
| `packages/core/src/speech/voices.ts` | `VoiceEntry` / `VoiceCatalog` 契约 + `LANGUAGE_LABELS`（ISO 639-1 → 中文名）+ `isVoiceId` |
| `apps/server/src/voiceCatalog.ts` | Fish 音色库客户端：分页抓取、规范化、落盘缓存、单条解析 |
| `apps/server/src/http.ts` | `GET /api/voices`（目录）、`GET /api/voices/:id`（单条） |
| `apps/web/src/voice/VoiceLibrary.tsx` | 全屏音色库面板（纯展示 + 选择回调） |
| `apps/web/src/views/AssetsView.tsx` | 角色卡音色按钮接面板；`voiceLanguage` 下拉改吃 `LANGUAGE_LABELS` |

### 缓存落盘位置

`<repoRoot>/media-cache/voices.json`（`media-cache/` 已在 `.gitignore`）。
沿用 `imageAssets.ts` 的「磁盘是权威」思路：抓取失败时若盘上有快照就用快照，
没有则把错误如实抛给前端。

## 验收

> 已验证项见 validation.md；标 [ ] 的为待用户浏览器实机确认。

- [x] `GET /api/voices` 返回 1000 条，含 `languages`/`tags`/`likes`
- [x] 冷启动（无缓存）能自动抓取并落盘；二次启动命中缓存不打 Fish
- [x] `?refresh=1` 强制重抓
- [ ] 面板：搜索「narration」有结果；语言轨切到「印地语」只剩 1 条
- [ ] 面板内逐条试听可用（走既有 `tts-preview` 路径）
- [ ] 选中小语种音色后保存 → `play.json` 写入该 `voiceId` → 开演出声
- [x] demo 剧目原音色（不在前 1000）仍能显示并试听
- [x] `voiceLanguage` 下拉含小语种选项
- [x] 无 key / 断网 → 面板显式报错，不空白
- [x] `pnpm test` / `pnpm typecheck` / `pnpm build` 全绿
