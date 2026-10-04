# 音色目录按需查询（语言 / 标签 / 关键词）计划

## 背景

当前音色目录只抓**一个窗口**：`/model?page_size=100&page_number=1..10&self=false&sort_by=score`
（全局热度前 1000），语言/标签/关键词筛选全在本地内存做。实测（2026-10-04，真 key）：

- 全局 1000 条里 ja 只有 52 条（en 308 / es 283 / ru 96 / pt 93 / zh 86 / ar 71），二次元角色音几乎没有。
- **每个过滤组合各有一个独立的 1000 条窗口**：`language=ja` 另有一批 1000 条全日语音色
  （329 条 `anime` 标签、548 条 `character-voice`，Rem / Frieren / Furina / 白上吹雪 / 五条悟 /
  Kaneki / DIO / Luffy 都在其中）；`total` 恒回 1000，是窗口大小不是库容量。
- `tag` 数组参数是**并集**：`tag=anime&tag=character-voice` ≠ 交集（交集才 17 条）。
- `title` 参数是**全库标题搜索**：搜 Rem 前 100 条里 98 条在热度窗口外；可与 `language` 组合。

## 设计

把「一次抓全量、本地筛」改成**按需查询**：筛选条件发给服务端，服务端按组合抓 Fish 对应窗口。

### 服务端（voiceCatalog.ts）

```ts
export interface VoiceQuery {
  language?: string;  // ISO 639-1
  tags?: string[];    // Fish 并集语义
  title?: string;     // 全库标题搜索
}
list(query: VoiceQuery, refresh = false): Promise<VoiceCatalog>
```

- **空查询**（`{}`）= 今天的 `get()`：磁盘快照 + 12h TTL + 失败沿用旧快照 + 5 分钟静默期。
  它仍是「语言下拉的语种来源 + voiceId 显示名解析」的基础目录，行为不变。
- **非空查询**：内存缓存（key = 规范化查询串，TTL 12h，上限 16 条，超出按最旧逐出）+ 并发去重
  （同 `inflight` 模式）。不落盘：重启重抓一次，换目录体积不膨胀。
- **抓取策略分两种**（实测定的，见下）：`title` 搜索**先探第 1 页**，满 100 条才并发补 2–10 页
  （搜「雷姆」1 个请求 0.6s 就回来）；语言/标签窗口**10 页一次并发打完**，只用一轮往返
  （探路再补要多花一轮，10 页并发本身就要 4–12s，见实测）。
- 失败如实抛给调用方（UI 显示错误），不做静默降级。窗口查空不算错（标题搜不到是正常答案），
  只有基础目录沿用「空目录 = 上游坏了」的旧约定。

### HTTP

`GET /api/voices` 增加查询参数（与 `refresh=1` 正交）：

- `language=ja`、`tag=anime&tag=character-voice`（可重复，≤4 个）、`q=雷姆`（≤60 字符）。
- 返回形状不变（`VoiceCatalog`），前端类型零改动。

### 工坊工具（list_voices）——第一等消费者

查询面的设计以 agent 工具为先，UI 跟着受益：

- `language`：走服务端语言窗口（日语从 52 条变 1000 条）。
- `tags: string[]`（≤4，并集）：Fish 标签原样传，二次元/角色向 = `["anime","character-voice"]`。
  描述里给**实测词表**（照抄、别自己造词，作者手打的标签大小写敏感、猜错就是 0 条）：
  female/male/young/middle-aged/old、energetic/calm/confident/cheerful/bright/serious/dramatic/
  expressive/friendly、deep/clear/smooth/high/measured、narration/storytelling/advertisement/
  social-media/entertainment/educational、animated。词表来自真实窗口统计（全局 1000 + 日语 1000），
  曾经想当然写的 `cute` 实际两个窗口都是 0 条。语言别当 tag（Japanese/Mandarin 是作者顺手打的，
  语言维度走 `language`）。
- `query`：升级为**全库标题搜索**（服务端 `title`）——agent 找特定角色（雷姆/Frieren）直达，
  不再局限在窗口内本地匹配 id/描述/标签。
- `gender`：窗口内本地筛（male/female 是标签，Fish 没有独立参数）。
- 描述文案改口：说明「每个语言/标签组合各有一个 1000 条窗口，按需抓取、首次几秒、之后走
  本机缓存」，并给出二次元/找角色名的参数示例。

### 前端（VoiceLibrary / useVoiceCatalog）

- `useVoiceCatalog` 拆两层状态：`catalog`（基础目录，管下拉与名字解析）+ `result`（当前
  查询窗口，管网格）。查询变更带序号防串台（慢响应晚到不覆盖新查询）。
- 语言下拉 → 触发 `list({language})`；**不再显示计数**（窗口不同源，计数只会误导）。
- 搜索框 → 300ms 防抖 → `list({title: q, ...当前语言/标签})`，占位文案改「搜索音色名」
  （全库标题搜索，用户已拍板）。
- **标签 chips**：从当前窗口统计高频标签（剔除与语言重名的 Japanese/English 等），多选 =
  并集；**不置顶特设 chip**（用户拍板：数据驱动即可，anime / character-voice 本来就在高频前列）。
- 分页 60 条、试听、选用逻辑不变。

## 边界与取舍

- 描述/标签关键词匹配（本地三字段）被全库标题搜索取代，是唯一的功能取舍。
- 语言下拉的语种列表仍来自基础目录（全局窗口里的 20 种）——Fish 没有「全部支持语言」接口。
- **首次抓一个窗口的代价由上游决定，不是都由请求数决定**（2026-10-04 真机实测）：
  `q=雷姆` 0.6s / 13 条、`q=Frieren` 2.9s / 200 条（探路 + 补页两轮）、`language=ru` 4.1s / 1000 条、
  `language=ja&tag=anime` 11.8s / 1000 条（同样 10 页一轮并发，比 ru 慢一倍——按 tag 过滤的页
  上游就是慢）。之后内存缓存命中 31ms。
- 缓存只在内存：服务重启（每次部署）后第一个日语窗口要重付一次十几秒。UI 用「筛选中…」如实
  表达等待，不做骨架假数据。

## 影响文件

- `apps/server/src/voiceCatalog.ts`：`VoiceQuery` + `list()` + 自适应翻页重构。
- `apps/server/src/http.ts`：查询参数解析与校验。
- `apps/server/src/agentkit/voiceTool.ts`：走窗口查询 + 文案。
- `apps/web/src/api.ts` / `src/voice/useVoiceCatalog.ts` / `src/voice/VoiceLibrary.tsx`：查询状态、chips、防抖。
- 测试：voiceCatalog 的 URL 构建/缓存/去重/早停、http 参数解析、voiceTool 窗口筛选。

## 验证

- `pnpm typecheck` 全绿；voiceCatalog / voiceTool / http 三份用例 39 个全绿。
- 真机 API：见上「边界与取舍」的实测数字。
- 真机 UI（1280×900 无头 Chrome 走真实 8787 端口）：默认按系统语言 zh 出 1000 条（不再是 52 条）；
  切日语出 1000 条、chips 为数据驱动高频标签（anime / character-voice / young / …）；点 anime chip
  出 1000 条（并集，フェルン / 五条悟 / 星街すいせい 一排）；搜「雷姆」出 3 条（`language=ja` 与
  `title` 是 AND，去掉语言筛则 13 条）；试听与选用照旧。
