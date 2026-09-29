# 总结（260929 fish-voice-library）

## 做了什么

把「16 条硬编码预置音色 + 一个 `<select>`」换成「从 Fish 公共音色库实时抓取的全屏音色库面板」，并把小语种语音真正打开。

| 层 | 改动 |
|---|---|
| `packages/core/src/speech/voices.ts` | 删 `VOICE_PRESETS`/`VoicePreset`，改为 `VoiceEntry`/`VoiceCatalog` 契约 + `LANGUAGE_LABELS`（34 语种）+ `countVoicesByLanguage` + `languageLabel`；`isVoiceId` 保持 32 位 hex |
| `apps/server/src/tts.ts` | 抽出 `readTtsKeys()` 供目录复用，合成逻辑不变 |
| `apps/server/src/voiceCatalog.ts`（新） | 抓热门前 1000 → 过滤 `state:"trained"` + 合法 id → 按收藏降序；12 小时磁盘缓存（`media-cache/voices.json`，tmp+rename 原子写）；`resolve(id)` 解析目录外音色；fetcher 可注入便于测试 |
| `apps/server/src/http.ts` | 新增 `GET /api/voices` 与 `GET /api/voices/:id`（32 位 hex 校验） |
| `apps/web/src/voice/useVoiceCatalog.ts`（新） | 目录状态 hook：懒加载、强制刷新、目录外 voiceId 按 id 解析出名字 |
| `apps/web/src/voice/VoiceLibrary.tsx`（新） | 全屏面板：左语言轨（带条数）+ 顶部搜索 + 卡片网格（封面/语言/标签/收藏），每条可试听与选用，60 条一页 |
| `apps/web/src/views/AssetsView.tsx` | 音色下拉 → 「音色：<名字>」按钮 + 清除 + 试听；语音语言下拉 4 → 34 语种 |
| `apps/server/src/imageAssets.ts` | 加 `whenSaved()`，替掉测试里猜时序的 `setTimeout` |

## 关键设计决定（用户拍板）

1. **选择面形态**：全屏音色库弹层。行内搜索框和「仅搜索」两个轻量方案都被否掉——用户要能逛、能试听、能看语言分布。
2. **兜底策略**：**完全替换**，不留本地兜底列表。抓不到就在 UI 上明确报错。对齐项目「不要考虑失败降级策略，只需给出错误提示」的规矩，也避免用户在一个可能已经过期的内置列表上做选择。

## 值得记住的三件事

- **目录外 ≠ 不可用**。免费额度只暴露 1000 个热门音色，但按 id 单查照常工作，demo 剧目那 16 条老音色全在窗口外。如果 UI 把「不在目录」显示成「未设置」，会把好端端能用的配置说成坏的——所以必须保留按 id 解析这条路径。
- **`total` 会骗人**。分页时它一会儿 1000 一会儿 1002，判断还有没有下一页只能看 `items`。
- **语音语言和音色是两件事**。`voiceLanguage` 管翻译，音色管能不能发那个语言的音。选小语种音色不必切模型（同一个 `s2.1-pro-free` 全部实测通过），但必须选到支持该语言的音色。

## 状态

代码、测试、README、AGENTS.md 均已更新；真实链路已联调通过（详见 validation.md）。**待用户在浏览器实机确认交互项**，确认后再合回 main。
