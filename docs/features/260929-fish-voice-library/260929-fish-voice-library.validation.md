# 验证记录（260929 fish-voice-library）

## 自动化

| 命令 | 结果 |
|---|---|
| `pnpm test` | core **72** passed（5 文件）、server **105** passed（12 文件） |
| `pnpm typecheck` | core / web / server 全 Done |
| `pnpm build` | web ✓ built，无 error |

新增用例：

- `packages/core/test/voices.test.ts`（7）—— `isVoiceId` 收放边界、32 位 hex 大写拒绝、`languageLabel` 未收录代码回落、同一音色多语言各计一次且按条数降序。
- `apps/server/test/voiceCatalog.test.ts`（6）—— 分页抓满并按收藏降序、丢弃未训练条目、落盘后二次命中缓存不再打 fish、**无快照时抓取失败抛错**（不静默返回空目录）、**有快照时沿用并标 stale**、按 id 解析目录外音色。fetcher 注入假实现，测试不碰网络与真实 key。

## 真实链路联调（起服务打真 API）

服务起在临时端口（`acquire-port --wait` 分配，未硬编码），走 7890 代理 + 真实 key：

| 检查项 | 实测 |
|---|---|
| `GET /api/voices` | `entries: 1000`，`totalAvailable: 1000`，`stale: false` |
| 语言分布 | `en:309 es:285 ru:92 pt:92 zh:88 ar:71 ja:51 fr:24 de:9 it:7 ko:3 tl:2 hi:1 sw:1 ro:1 el:1 sv:1 lv:1 cy:1 id:1` —— 与调研阶段独立抓取完全一致 |
| 条目结构 | `{id,title,description,languages:["en"],tags:[…10 个],likes:28708,cover:"coverimage/90e65ea…"}` |
| `GET /api/voices/f82e3885ac22468eb6c773b96f2c5752`（目录外） | 返回 `萝莉萌妹` / 甜美可爱 / `languages:["zh"]` / 8 个标签 —— **demo 剧目的老音色没被改动破坏** |
| `GET /api/voices/not-a-hex-id` | `400` |
| 二次请求 | `real 0m0.063s`（命中 `media-cache/voices.json`，442 KB） |
| 封面 CDN | `https://public-platform.r2.fish.audio/coverimage/f82e3885…` → `200 image/jpeg` |
| `GET /api/voices?refresh=1` | 缓存已存在时仍重新走网络（`real 0m31.8s` vs 命中缓存 `0.063s`），`media-cache/voices.json` mtime 随之更新 |
| 无 key（`STAGE_TTS_KEYS` 指向不存在的文件）+ 无磁盘快照 | `GET /api/voices` 与 `/api/voices/:id` 均返回 `400 {"error":"未配置 fish key，无法获取音色库"}` —— 显式报错，不返回空目录冒充成功 |

## 顺手修掉的既有 flake

`apps/server/test/image.test.ts` 用 `setTimeout(10ms)` 等 manifest 落盘。单跑通过、全量并行跑时序不够（新加一个测试文件把并发度抬高就稳定复现失败）。

修法不是调 sleep，而是给 `ImageAssets` 加 `whenSaved(): Promise<void>`（manifest 写入本来就是 fire-and-forget，对外暴露一个可 await 的完成点），测试改为 `await assets.whenSaved()`。与既有的 `orchestrator.whenIdle()` 同一套路。

## 浏览器实测（Playwright + 本机 Chrome，375×812）

卡片塌陷、语言默认值、关闭按钮三项都是**在浏览器里量出来的**，不是看 CSS 推的——前两次
修复都栽在这一点上。

| 检查项 | 实测 |
|---|---|
| 卡片塌陷 | 修复前每张卡 `height: 7px`、封面 `height: 0px`、网格行高全为 `7.03px`；修复后卡片 `366.5px`、封面 `163.5px` |
| 重叠 / 零高度 | 60 张卡中零高度 `0` 张、同列重叠 `0` 对（逐张比对 `rect.top` 与前一张 `rect.bottom`） |
| 语言默认值 | CDP 覆盖 `zh-CN` → 下拉显示 `中文（88）`，计数 `匹配 88 / 1000`；en-US 环境显示 `English / 英语（309）` |
| 「全部语言」项 | 不存在（遍历全部 `option` 校验文本） |
| 顶栏高度 | 153px → `109.2px` |
| 关闭按钮 | `×` 位于 `(331, 8) 34×34`，与「重新抓取」无重叠；点击后面板消失，再次点「音色」可重开 |
| 横向溢出 | `scrollWidth === clientWidth` |

## 卡片行高塌陷的根因

`.voice-library-grid` 是 `flex: 1` 撑满的定高网格容器，行是 `auto`。`.voice-card` 是
`overflow: hidden` 的 flex 列容器，浏览器给它的 **max-content 高度只有 7px**，行跟着塌成
7px，封面/描述/按钮全被裁掉。`git show HEAD~1:apps/web/src/app.css` 确认改之前就是这个
结构——是一直存在的老问题，不是改语言筛选时改坏的。

修法是显式 `grid-auto-rows: min-content`。中途试过 `.voice-card { align-self: start }`，
那是错的：卡片长高到 430px 但行仍是 7px，相邻卡片反而叠在一起。

## 需要用户在浏览器里确认的部分

自动化与 curl 覆盖不到交互，以下请实机过一遍：

- [ ] 顶部搜索能命中 `narration`（英文标签）与音色名
- [ ] 逐个点「试听」都能出声；合成中按钮置灰，不会并发打多句
- [ ] 选一个音色 → 按钮文案变新名字 → 保存后刷新仍在
- [ ] demo 剧目的 koharu 显示「萝莉萌妹」（不是 8 位短 id）
- [ ] 「显示更多」每次 +60，滚到底能翻完
- [ ] 语音语言下拉有 34 个语种；选 `hi` 后保存，演出时台词为印地语
- [ ] 断网/代理不通时打开面板：红色报错条 + 「重新抓取」按钮，**不显示空目录冒充成功**
