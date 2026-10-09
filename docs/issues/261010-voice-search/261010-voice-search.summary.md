# 音色库搜索修复 总结

外部反馈「音色库只在全局热门 1000 条里本地过滤、雷姆搜不到；list_voices 支持 tag 与常用 tag，
界面也该支持」。定位见 `261010-voice-search.troubleshoot.md`，验收见 `...validation.md`。

## 结论

1. 「本地过滤」不成立——搜索一直走服务端 → Fish 全库标题子串搜索。真正让「雷姆搜不到」的是
   **语言下拉默认预选浏览器系统语言、关键词与它 AND**（英文系统 `?language=en&q=雷姆` = 0 条）。
   现在系统语言只是浏览起点，一有关键词就摘掉；用户显式挑过的语言才是真筛选（AND）。
2. 标签区域先被修好（固定词表、不再随窗口空掉），实拍后**用户裁决撤掉**——手机上要占五六行。
   面板最终只有 搜索 + 语言下拉 + 卡片网格；标签能力留在 API 与工具上。

## 改动

| 文件 | 改了什么 |
| --- | --- |
| `apps/web/src/voice/useVoiceCatalog.ts` | 新增 `effectiveVoiceLanguage`（语言两种身份的唯一入口）；`VoiceFilter` 收成 `{language, title}` |
| `apps/web/src/voice/VoiceLibrary.tsx` | 用 `effectiveVoiceLanguage` 算生效语言；删掉标签 chips 与面板侧 tag 状态/取数 |
| `apps/web/src/api.ts` | `voiceCatalog` 不再带 `tags` |
| `apps/web/src/app.css` | 删掉已无引用的 `.picker-tags`（`.chip-btn` 留给立绘差分多选） |
| `packages/core/src/speech/voices.ts` | 新增 `VOICE_TAG_GROUPS`（五组常用标签，补上原本漏掉的 anime / character-voice） |
| `packages/agent/src/capabilities/voice/list.ts` | `list_voices` 描述里的词表改由 core 常量渲染（同一份，不再各写一套） |
| `apps/web/test/voiceSearch.test.ts` | `effectiveVoiceLanguage` 的 5 条断言；`packages/core/test/voices.test.ts` 加词表去重断言 |
| `README.md` / `apps/web/AGENTS.md` | 使用说明与模块指引同步 |

## 验证

- 浏览器实跑（Playwright + 线上 8787）：默认态搜「雷姆」发出 `?q=雷姆` → **13 条**、语言下拉「全部语言」；
  显式挑日语 → `?language=ja&q=雷姆` → 10 条、下拉「日本語」；清空关键词回到 `?language=ja` 的 1000 条浏览窗口；
  标签行 `.picker-tags` 计数 = 0。
- `pnpm --filter @aivn/{core,agent,web,server,stage} typecheck` 全过；core `voices` 8 / web `voiceSearch` 5 /
  web `characterCards` 12 全绿；`pnpm check:agent-contract` 9 项过。
- 证据图：`01-before-en-language-0.png`（改前 0 条）、`02-after-search-13.png`、`03-after-phone.png`。

## 检视

reviewer 结论**准入**（无阻塞），报告见 `261010-voice-search.review.md`——那一版含标签 chips。
随后按用户裁决把 chips 与面板侧 tag 管道整段删除（纯删除、无新增语义），未再送检；
删除后 typecheck、受影响用例与浏览器实跑均过。报告里的 S-02 / N-02 针对的正是这段已删代码。

## 跨宿主

`packages/core` 与 `packages/agent` 是两条发行线共享的，`dsh-aivn` 的 `lib/` 已随包重建、
`node build.mjs --check` 绿。**那边工作区现有 `lib/index.js` 的改动（`list_voices` 描述的词表）待提交。**

## 未动

服务端查询面（`GET /api/voices` 的 `language` / `tag` / `q`）、`list_voices`（tags 并集 / gender / 分页）、
试听与选用、目录外 voiceId 按 id 解析。
