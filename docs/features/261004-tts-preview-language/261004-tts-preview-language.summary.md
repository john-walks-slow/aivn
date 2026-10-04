# 音色试听改用 Fish 官方样本（多语言）小结

## 背景

素材管理页/角色卡的「试听」此前固定合成一句中文，音色的母语完全没被用上——而 Fish 公共库 1000 条
热门音色横跨 19 种语言（抽 300 条实测：en 115 / es 80 / ru 26 / ar 22 / zh 20 / ja 14 …）。
详见 [计划](261004-tts-preview-language.plan.md)。

## 实现

试听改成分级取材，三级都保证「用音色自己的语言」：

1. **Fish 官方预渲染样本**（`samples[].audio`）：`VoiceCatalogService.sample(id)` 现取元数据
   （不进 12 小时目录快照——签名 URL 一小时过期），`FishTts.fetchSample` 经同一条出口代理下到
   剧目的 `media-cache/tts/preview-<voiceId>.mp3`，再由既有静态路由回放。零配额。
2. **官方示例文本 + 自家合成**（`default_text` / `samples[].text`）：作者没传样本的音色（约 2%）。
3. **语言兜底**（`PREVIEW_TEXTS`）：连示例文本都没有时，按 `languages[0]` 念一句母语问候，未收录语种退回英语。

试听不再经 `runtime.synth`：那条路会把文案翻成剧目的 `voiceLanguage`，而试听要听的是音色本身；
顺带省掉这次翻译调用，也不再为试听去建一个 runtime。

改动文件：

- `apps/server/src/voiceCatalog.ts`：`VoiceSample` + `sample(id)`；`strList` / `firstSample` / `fetchModel` / `entryOf` 抽取。
- `apps/server/src/tts.ts`：落盘逻辑抽成 `cacheFile`；新增 `sampleFile` / `fetchSample`。
- `apps/server/src/playhouse.ts`：`ttsPreview` 三级策略 + 盘上已有样本时短路；删除 `TTS_SAMPLE_TEXT`。
- `apps/server/test/ttsPreview.test.ts`：11 个用例（新增）。

API `POST /api/plays/:id/tts-preview` 与前端调用形状不变（仍返回 `{url}`）。

## 验证

- `pnpm typecheck` 全绿；新用例 11/11 通过；受影响模块用例（playhouse / http / voiceCatalog）共 48/48 通过。
- 真实 API 单点验证（本机 3 把真 key + Clash 代理）：日/中/俄三条音色各取一次官方样本并落盘，
  289645B / 221100B / 226114B，单次 1.0–2.2s。
- 线上实例（`supervisorctl restart stage-ai`，pid 换成 20654 后）：首次试听 3512ms（取元数据 + 下载），
  同一条音色再点 29ms（命中盘上样本短路），静态路由 `audio/mpeg` 200。
- 用户侧验证见 [验证文档](261004-tts-preview-language.validation.md)。

## 检视处理

[检视报告](261004-tts-preview-language.review.md) 结论为条件准入，无阻塞问题。

| 意见 | 处理 |
| --- | --- |
| S-01 二次试听未先查盘 | 已改：`ttsPreview` 先看 `sampleFile(voiceId)` 在不在盘上，在就直接返回（实测 3512ms → 29ms） |
| S-02 语言标签未归一化 | 不采纳：Fish 的 `languages` 是 ISO 639-1 两字码（抽 300 条全是 `ja`/`ru`/`zh` 这种，无区域后缀），为不存在的输入写归一化属于过度防御 |
| S-03 示例文本未 trim | 已改：`str(raw.default_text).trim() \|\| str(sample?.text).trim()` |
| N-01 `PlayRuntime.synth` 注释过时 | 已改：注明演出侧专用、试听走另一条路 |
| N-02 缺空语言标签兜底用例 | 已补：`[]` 与 `["xx"]` 都断言回退到英语 |
