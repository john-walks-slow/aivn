# AIVN 已演剧目导出 / 零 API 离线回放 / 回灌续演 —— 外部调研报告

日期：2026-10-13
分支：`feat/play-export-replay`
性质：对提案（`.plan.md` / `.research.md`）的**外部事实交叉核验**，不做方案裁决
方法：Exa 检索 ≈24 轮 + 一手文档抓取 6 篇；所有结论附来源 URL
说明：标注「对照证据」的段落是**外部事实与提案表述的逐条比对**，不是个人偏好

---

## 0. 结论速览

| # | 提案中的假设 | 外部证据的判定 |
|---|---|---|
| 1 | 单 HTML 嵌归档、双击即播在浏览器可行 | **成立（桌面）**。Bun `--compile --target=browser` 官方文档明确把单 HTML 定位为"double-click it from your desktop — it opens in the browser and works offline, no localhost server needed" |
| 2 | "双击即可在浏览器中获得完整声画"（移动端同理） | **错误/严重夸大**。iOS/iPadOS Safari 无法打开本地 HTML（Files 预览不执行 JS）；Android Chrome 受 scoped storage 限制，`file://` 基本只在 Chrome 自身 Download 目录可用；微信内置浏览器不能直接跑本地 HTML |
| 3 | 内嵌 Base64 ZIP 比裸 Data URI 好 | **成立**。SingleFile 作者的原话："SingleFile commonly stores web page resources as data URIs. However, this approach can be inefficient for large resources." |
| 4 | "资源经 Deflate 压缩后再 Base64，通常接近甚至小于原始未压缩体积" | **夸大**。ZIP 对已压缩媒体（WebP/MP3/JPG）几乎无收益；WACZ 规范甚至强制这类文件用 STORE 模式。实际净体积 = 原始 × ~1.33（base64 税），而非"接近原体积" |
| 5 | 播放器 bundle "gzip 后约 180KB" | **口径错**。`file://` 没有 `Content-Encoding`，单文件里 JS 是**裸文本**。react-dom 19 的 `react-dom-client.production.js` 自身就是 492.50 kB（gzip 87.86 kB），加上 React 与 stage 代码，单 HTML 的裸 JS 量级是数百 KB 到 MB，不是 180KB |
| 6 | `fflate` 约 8KB | **成立**。README 原文："weighs 8kB minified for the core build (3kB for decompression only)" |
| 7 | 体积表 5MB→Zip 4.5MB→HTML 6.0MB 的算术 | **自洽**，但与 §2.2 的定性表述（"接近甚至小于原始"）冲突；表格本身已经说明了"压缩几乎没收益（-10%）+ base64 税（+33%）" |
| 8 | `<script id="aivn-archive" type="application/octet-stream">` 存 Base64 | **成立且有规范依据**。HTML 规范 4.12.1：非 JS MIME 类型的 `type` = data block，"not processed by the user agent, but instead by author script or other tools"；并且要求"必须用合法 MIME 类型字符串"，`application/octet-stream` 合规 |
| 9 | 导入时"正则扫描提取 `#aivn-archive` 的 Base64" | **可做但脆弱**，且与"polyglot"表述混用。提案 research.md 4.1 把小标题写成"Polyglot Archive"，但实际结构是纯 HTML + Base64 文本块，**不是** polyglot；真正的 polyglot（ZIP 数据裸放在 HTML 注释里）能让 OS 解压工具直接打开，但 AIVN 若继续用 Base64 就永远拿不到这一点 |
| 10 | 导入用"魔法头 `PK\x03\x04`"识别 Zip | **在不做 polyglot 时成立**（纯 HTML 文件头是 `<!DOCTYPE`）。反过来说：**一旦将来改成真 polyglot，`PK\x03\x04` 检查就必然失效**（ZIP 会被推到 offset > 0），提案当前的两种识别逻辑不能同时支持 polyglot 路线 |
| 11 | 浏览器内存足以在启动时全量解压并 Blob URL 化 | **风险被低估**。Chromium 官方 blob 存储限额：**Android = total_physical_memory / 100**（8GB 手机 ≈ 80MB in-memory blob）；官方还有专门章节 "Creating Large Blobs Too Fast" 警告 renderer OOM |
| 12 | `fflate.unzipSync` 启动解压 | **可行但会卡主线程**；`unzip`（async）依赖 Web Worker，而 `file://` 下 `blob:` Worker 的可用性各引擎实现不一致（blob URL 的 origin 在创建者 origin 为 opaque 时"implementation-defined"）→ 必须自带同步回退 |
| 13 | 离线播放器"不需要 WebSocket，通过前端本地数据驱动" | **成立且有现成可复用层**。仓库 `packages/core/src/lineage/replay.ts` 的 `lineageToEvents()` 注释即"谱系 → 客户端事件流（只读物化层）" |
| 14 | 音画自动开始播放 | **错误**。Chrome 自 66/71 起有 autoplay policy；Ren'Py 官方 web 文档原文："sound and music files won't play until the user clicks inside the game at least once"；iOS 甚至限制到 **per-element**（WebKit bug 132691 被 WONTFIX）。必须有显式"开始"按钮 |
| 15 | TTS mp3 用 `blob:` URL 喂 `<audio>` | **可行但有几个已知坑**：iOS 上 Blob 必须带 MIME type（`new Blob([buf],{type:'audio/mpeg'})`），否则不播（WebKit 198015/245056）；blob URL 带 fragment 在 Safari 会 404；Safari 15 曾有 blob > 65536 字节导致 `ended` 不触发 |
| 16 | 单 HTML 是"随处分享"的最佳载体 | **只对桌面成立**。Gmail 附件上限 25MB（企业 50/70MB），且 `.html` 属于 Workspace 可拦截类型；微信附件路径不通；itch.io 单 HTML 可直接上传（这点有利） |
| 17 | `lineage.jsonl` 作为完整谱系事件日志 | **成立，符合 JSON Lines 规范与事件溯源惯例**。JSON Lines 三要求（UTF-8、每行一个合法 JSON 值、`\n` 结尾）；Azure 事件溯源指引确认 append-only + 重放，快照只是优化 |
| 18 | `session.json` 里存"运行时会话状态快照（含谱系快照）" | **与仓库既有约定重复**。`packages/core/src/lineage/model.ts` 首行注释即"行级事件日志是唯一真相源"；事件溯源惯例是快照"never the source of truth"。归档里同时带 session 全量状态 + lineage 全量日志 = 冗余且可能互相矛盾 |
| 19 | 增量剪枝"仅打包当前谱系树实际引用到的 assets 与 tts" | **方向对，但依据不完整**。素材引用分散在 `scene`/`cg`/`sfx`/`preload`/`actor` 等事件 payload 的 `attrs` 里（见 orchestrator.ts），`preload` 事件按代码注释"不重放"，剪枝流程必须显式覆盖它；另外 `media-cache/tts` 已是按内容寻址（`<hash>.mp3`），可重建 |
| 20 | 导出后能"无缝恢复谱系树与状态，继续开演" | **技术成立，但需要一套版本/迁移契约**。Ren'Py 明确"save compatibility 不保证"；inK 用 `kInkSaveStateVersion=10` / `minCompatible=8`；游戏存档社区的一致做法是 magic + schema_version + 单向迁移链 + 对更新版存档显式拒绝 |

---

## 1. 单文件 Web App：业界既有做法与共识

### 1.1 官方工具链

**Bun `--compile --target=browser`**（[Bun Docs](https://bun.com/docs/bundler/standalone-html)）

- 官方卖点原文："Bundle a single-page app into a single self-contained .html file with no external dependencies… no relative paths, no external files, no server required."
- 明确列举适用场景："Double-click it from your desktop — it opens in the browser and works offline, no localhost server needed"、"Email attachments: Yes, you can email a working web app"
- 历史对照："Browsers have tried to solve this before. Safari's `.webarchive` and Chrome's `.mhtml` save a page as a single file. In practice, only some browsers can open them, which defeats the purpose."（→ 说明**自定义单文件格式**比浏览器原生归档格式更可靠）
- 明确列出的局限：
  - "Code splitting is not supported"
  - "Large assets increase file size since they're base64-encoded (**33% overhead vs the raw binary**)"
  - "External URLs (CDN links, absolute URLs) stay as-is: Bun inlines only relative paths"
- 缓存代价（第三方解读，[bunjs.run](https://bunjs.run/bun-compile-browser)）："If you update your JavaScript, the user only needs to re-download the changed bundle. With a single-file approach, **the entire file must be re-downloaded**."

**vite-plugin-singlefile**（[README](https://github.com/richardtallent/vite-plugin-singlefile/blob/main/README.md)）

- 官方立场非常明确："Bundling your entire site into one file **isn't recommended for most situations**. In particular, this is not a good idea, performance-wise, for hosting a site on a normal web server."
- 适用面："very handy for offline web applications — apps bundled into a single HTML file that you can double-click and open directly in your web browser, no server needed"
- **官方列出的、在单文件模式下受限的功能清单**（对 AIVN 逐条相关）：
  - `localStorage`、Persistent Storage APIs、FileSystem API
  - Requests for local files relative to the same folder
  - Requests for images / fonts from external websites
  - Requests to external APIs（需要 `{ mode: 'no-cors' }`）
  - Following links to other files relative to the same folder
  - SPA hash-based routing、WebXR、Worklets
- 明确不支持多入口："it creates one HTML file and no other files… apps that require multiple entry points… will be closed as `wontfix`"
- 一个规范级细节："Static resources in `public` folder (like `favicon`) are not inlined by Vite"；"Inlining of SVG isn't supported directly by Vite"

**esbuild-single-html**（[npm](https://www.npmjs.com/package/esbuild-single-html)）：同类插件，卖点 "perfect for single-page applications, web components, offline tools"。

### 1.2 单文件应用的规模匹敌案例

**TiddlyWiki 5** 是最成熟的长寿单文件应用，其社区给出了直接可用的量级事实（[Talk TW: gzip 支持讨论](https://talk.tiddlywiki.org/t/suggestion-adding-gzip-support-to-import-export-from-and-to-tiddlywiki/8833)、[GitHub #4262](https://github.com/TiddlyWiki/TiddlyWiki5/issues/4262)）：

- `empty.html` 原始 **2.4MB**；用 CompressionStream gzip 后 **0.431MB**（"about 80% smaller"）
- 关键结论原文：**"If you serve TW from a proper server, gzipping is activated anyway. So there is no reason to gzip the core."**
- 用户实测对照（[Google Groups](https://groups.google.com/g/tiddlywiki/c/Ra1lJ6mKbn0)）：`empty.html` 文件 892kB，网络传输 **187kB**；tiddlywiki.com.html 文件 2100kB，传输 621kB
- 另一条实测：TiddlyWiki 5.3.3 = 7.30MB，uglify 后 6.20MB，再 LZMA level 9 后 3.66MB（[Discussion #7920](https://github.com/TiddlyWiki/TiddlyWiki5/discussions/7920)）
- 社区对"整体压缩主程序"的反对理由（与 AIVN 直接相关）："Tobi Beer uses compressed plugins, and that's a nightmare. If users have a problem with those plugins I personally don't try to help"（可调试性损失）；"Including Buffer-type string transformations…"；以及 **"The size penalty for base64 is 4/3."**

**对照证据**：提案研究稿用"gzip 后约 180KB"来描述播放器 bundle 体积。TiddlyWiki 的实测数字表明，被 gzip 的传输体积与磁盘上的文件体积是两个数，**而 AIVN 的单 HTML 在 `file://` 下拿不到传输压缩**。若把播放器 JS 内联进 HTML，其磁盘占用是裸文本；若把播放器也塞进内嵌 ZIP 再由 fflate 解压后 eval，则启动路径变复杂且失去 source map 可调试性（TiddlyWiki 社区的上述抱怨正是此代价）。

### 1.3 单文件 = 无缓存粒度、单入口、无秘密

第三方综述一致点（[nos-workspace](https://nos-workspace.com/learn/single-html-file-apps)、[vibed.city](https://vibed.city/blog/single-file-web-app)、[mk0r](https://mk0r.com/t/weekend-project-single-file-html)）：

- "It cannot keep a secret, because anyone can read the source."
- "It cannot share state between people without a server somewhere."
- "the file is roughly a third larger than its images, nothing inside it can be cached, and you cannot fix a typo without re-sending the whole thing"
- 实践边界共识："The honest boundary is roughly: one screen, one purpose, no accounts, no data that outlives the session."（对 AIVN：离线回放确实是"一个屏幕、一个用途、无账户"，落在边界之内）
- 文件版本命名的实用建议："Name the file with a version. `pricing-v3.html` beats three copies called `pricing (2).html`."

**AIVN 具体化的含义**：单 HTML 是**分发/观赏产物**，不能同时充当**可再次编辑/可增量更新**的主产物。这正对应 twine 的双形态（见 §8.1）。

---

## 2. HTML 里嵌归档：机制对比与规范级细节

### 2.1 方案 A：`<script type="非JS MIME">` data block + Base64（提案采纳）

**规范依据**（[HTML Standard §4.12.1](https://html.spec.whatwg.org/multipage/scripting.html)）：

- `type` 设为"任何其他值"时："the script is a **data block**, which is not processed by the user agent, but instead by author script or other tools. Authors **must** use a valid MIME type string that is not a JavaScript MIME type essence match to denote data blocks."
- 规范解释为何强制"合法 MIME 类型字符串"："Values for the `type` attribute that are not MIME types, like `module` or `importmap`, are used by the standard to denote types of scripts which have special behavior in user agents. By using a valid MIME type string now, you ensure that your data block will not ever be reinterpreted as a different script type, even in future user agents."
- 规范示例恰好就是 AIVN 的用法（`<script type="text/x-game-map">` 存地图数据 ）
- `src`/`charset`/`async`/`defer`/`crossorigin`/`nonce` 在 data block 上一律无效
- 读取方式：`text` / `textContent` IDL，规范明确它们是"encouraged way of dynamically setting the text"，**参数会过 Trusted Types 检查**

**转义安全性**（[MDN `script type`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type)、规范 §4.12.1.2）：

- 规范建议的通用规避法：把 `<!--` 写成 `<\!--`、`<script` 写成 `<\script`、`</script` 写成 `<\/script`
- 对 AIVN 的意义：标准 base64 字母表为 `A–Z a–z 0–9 + / =`，**不含 `<`、`>`**，因此 Base64 载荷里不可能出现 `</script`、`<script`、`<!--` 序列 → 该编码天然免疫这一整类问题（这是"Base64 优于"裸字节塞注释"的一个实打实理由）

**Trusted Types / CSP 影响**：若宿主给这个文件套了 `require-trusted-types-for 'script'`，则通过 `innerHTML` 注入脚本会被拦，但**读取** data block 的 `textContent` 不受影响。若宿主套了 `script-src` 而不含 `'unsafe-inline'`，则内联播放器脚本会被拦。规范另有说明："When inserted using the `innerHTML` and `outerHTML` attributes, or the `insertAdjacentHTML()` method, they do not execute at all."

### 2.2 方案 B：HTML/ZIP polyglot（SingleFileZ 路线）

一手资料：[How to Create HTML/ZIP/PNG Polyglot Files](https://gildas-lormeau.github.io/Polyglot-HTML-ZIP-PNG/SUMMARY.html)（已抓取全文）、[SingleFileZ 设计说明 issue #1265](https://github.com/gildas-lormeau/SingleFile/issues/1265)、[SingleFile FAQ](https://github.com/gildas-lormeau/SingleFile/blob/04a75238564d97d1618b9024b290fc0ede75279a/faq.md)

**ZIP 侧的格式自由度（这是 polyglot 的全部基础）**：

- 原文："The format enables data to be prepended before the ZIP content by setting an offset greater than 0 for the first file entry, while allowing up to **64KB** of data to be appended afterward (i.e. ZIP comment)"
- 另一处表述："The central directory is required and authoritative… To read a ZIP file, you must first read the central directory and ignore local headers"

**基本结构（ZIP 放在 HTML 注释中）**：

```html
<!doctype html>
<html><head><meta charset=utf-8><title>Please wait...</title>
<script> Content of lib/zip.min.js </script></head>
<body><p>Please wait...</p>
<!-- [ZIP data] -->
<script> Content of assets/main.js </script>
</body></html>
```

**第一道坎（决定整个方案的实现路径）**：

> "The `assets/main.js` script on this 'bootstrap page' reads the ZIP data by calling `fetch("")` … However, there's a problem: due to the same-origin policy, retrieving ZIP data directly with `fetch("")` fails when the page is opened from the filesystem (**except in Firefox**)."

**第二道坎（绕开 fetch 的代价）**——改为从 DOM 读二进制，必须处理字符编码：

1. DOM 文本内容被解码成 UTF-16 而非 windows-1252
2. `NULL`（U+0000）被解码成替换字符 U+FFFD
3. `\r` 与 `\r\n` 被归并成 `\n`

官方给出的修法：页面改存为 `windows-1252` + 一张字符映射表；`\r`/`\r\n` 的位置用额外一个 `<script type="application/json">`（"consolidation data"）记录以便重建。

**最终形态的已知局限（原文列表，直接可当风险登记表）**：

- "Manual resolution of dependencies"
- "Avoid overflow of **64KB** of data after ZIP file (comment)"
- "**Presence of `-->` in ZIP or PNG binary data**"（二进制里出现 `-->` 会提前结束 HTML 注释）
- "Use of `String#replaceAll()` to replace paths in text files instead of relying on parsing"
- "Lack of `<meta>` tag containing the Content Security Policy (CSP)"
- "No support for frames"
- "Alternative formats: MHTML, Web Bundle, WARC/WACZ, MAFF..."
- "Is it dangerous? 🤷 (GIFAR)"

**官方已知问题（SingleFileZ 的 polyglot 输出）**：

- "A bug in 'Archive Utility' on macOS prevents it from decompressing the resulting file. You can use `unzip` to get around this issue."
- "The HTML page cannot be viewed when opened from the filesystem on iOS because the page is displayed by default in a viewer which does not support JavaScript. Installing a third-party browser can help you get around this issue."
- "Depending on the browser you're using, the presentation may be a little slow."
- PNG 变体额外代价："The signature, the `IHDR` and the `IEND` chunks become visible as text nodes briefly and should be removed as soon as the page is parsed"、"The displayed page is rendered in **quirks mode**"

**SingleFile 自解压 ZIP 的产品化用法**（[single-file-cli 输出选项](https://deepwiki.com/gildas-lormeau/single-file-cli/3.3-output-configuration-options)、[npm](https://www.npmjs.com/package/single-file-cli)）：

```
single-file https://example.com --compress-content --self-extracting-archive --password=secret
single-file http://info.cern.ch first-website.html \
  --crawl-links=true --crawl-max-depth=2 --crawl-save-archive=true \
  --crawl-save-archive-mark-unarchived-links=true --compress-content=true
```

默认 `--self-extracting-archive = true`；"When using `--self-extracting-archive`, the output is **both** an HTML file and a ZIP archive, allowing it to be opened in a browser directly or extracted with ZIP tools."

**对照证据（重要）**：提案 research.md §4.1 把该节标题写作"数据自描述（Polyglot Archive）"，但正文结构是 `<!-- BASE64_ZIP_STREAM -->` 式的 Base64 文本块。**Base64 文本块不是 polyglot**：把 `.html` 改名 `.zip` 后 OS 解压工具打不开（Base64 不是 ZIP 字节流）。这带来两个直接后果：
1. 提案拿不到 polyglot 的**唯一实质收益**——用户可以不靠 AIVN 就用 `unzip` 取出原素材；
2. 提案"用 `PK\x03\x04` 魔法头识别 Zip"与"从 HTML 里正则提 Base64"这两条分支逻辑，**在真正的 polyglot 文件上会同时失效**（polyglot 的文件头是 `<!doctype html`，ZIP 在 offset>0；而 Base64 提取逻辑也找不到 Base64）。若要转向真 polyglot，导入侧需要改成"扫描 offset 找 End of Central Directory / 用 zip reader 直接打开整个文件"。

### 2.3 方案 C：裸 Data URI（提案已否决，否决理由经核验）

- RFC 2397 原文："The `data:` URL scheme is only useful for **short** values… For anything else larger, data URLs are likely to be inappropriate."（[RFC 2397](https://greenbytes.de/tech/webdav/rfc2397.html)）
- 浏览器实际长度上限（[MDN data: URLs](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/data)）："Browsers are not required to support any particular maximum length of data. Chromium and Firefox limit `data` URLs to **512MB**, and Safari (WebKit) limits them to **2048MB**. Note that Firefox 97 increased the limit from 256KB to 32MB, and Firefox 136 increased it to 512MB."
- 性能软上限（第三方实测综述，[toolbox365](https://www.toolbox365.net/tutorials/base64-large-file-memory-and-data-url/)）："Chrome ~2 MB（perf falls off）"/"Safari (iOS) ~100 KB (old)"，规则表建议 "> 1 MB → always separate URL — never data URL"
- 另一个历史陷阱：`String.fromCharCode.apply(null, uint8Array)` 在元素数 >~65,000 时抛 `RangeError: Maximum call stack size exceeded`
- data URL 的 origin 语义（MDN）："Data URLs are treated as unique opaque origins by modern browsers"

**判定**：提案否决方案 A 的理由（AST 解析负担、巨大 DOM 文本）与外部证据一致，成立。

---

## 3. 体积、压缩与"180KB"口径问题

### 3.1 Base64 税与 Deflate 收益

- Base64 膨胀：'64 encodes three bytes as four characters, so each embedded image grows by about **33%**'（[transformpipe](https://transformpipe.com/blog/self-contained-html-explained)）；Bun 官方同口径
- **已压缩媒体再压缩无收益**：WACZ 规范强制要求 —— "Already compressed files MUST NOT be compressed again to allow for random access. All `archive/` files should be stored in ZIP with **'STORE'** mode."（[WACZ 1.1.1](https://specs.webrecorder.net/wacz/1.1.1/)）
- TiddlyWiki 社区同结论："If you included images or PDFs, compression will not do anything there, since this content is already compressed"
- fflate README 也提示按文件选择性压缩："Custom per-file compression options allow avoiding compression for already-compressed formats (PNG, JPEG, PDF) to save resources"（[DeepWiki: ZIP Archive Handling](https://deepwiki.com/101arrowz/fflate/2.4-zip-archive-handling)）
- fflate 的默认压缩级别文档：`level` 0–9；`zipSync(files, { level: 6 })` 是 AIVN 现有 `exportZip` 的写法（见仓库 `apps/server/src/store.ts`）

**净账（AIVN 语境）**：

```
归档体积 ≈ (文本类资源 × deflate 系数) + (媒体类资源 × 1.0)
单 HTML ≈ (归档体积 - 已存储内容) × 1.333 + 播放器裸 JS + 数据 JSON
```

对以立绘/BGM/TTS 为主的剧目，deflate 系数≈1.0，因此**净结果几乎就是 +33%**。提案表格里 5.0MB→Zip 4.5MB（-10%）与 19.1MB→17.5MB（-8.4%）其实与"文本+PNG 立绘占约 1/4~1/3"的构成吻合——但研究稿 §2.2 的定性表述"通常接近甚至小于原始未压缩体积"在媒体为主的剧目上不成立。

### 3.2 提案表格里缺失的一项：播放器 JS 没被 33% 覆盖

| 项 | 提案值 | 外部核对 |
|---|---|---|
| 播放器 bundle | "~400 KB (minified)" / "gzip 后 ~180KB" | react-dom 19 自身：`react-dom-client.production.js` = **492.50 kB**，gzip = **87.86 kB**（[React PR #28966 的 CI 尺寸表](https://github.com/facebook/react/pull/28966)）；`react.production.js` 另有 ~1.8kB gzip。React 19 把 reconciler 从 `react-dom` 挪到 `react-dom/client`，bundlephobia 只统计 `react-dom`（3.9kB min / 1.4kB gzip）会严重低估，必须比较 `react-dom` + `react-dom/client`（[facebook/react#27824](https://github.com/facebook/react/issues/27824)） |
| 另有一方测算 | react-dom gzip 从 18.3.0 的 46KB 涨到 19 RC 的 **57.5KB**（bundlejs 实测，同 issue） | 说明 gzip 后总量与"180KB"同一数量级的前提是**再叠上 stage/core 全部应用代码**；而这 180KB 在 `file://` 下不成立 |

**结论**：单 HTML 里若内联播放器源码，其文本量 = 400KB~1MB+（未 gzip），这部分**不受 base64 影响也不受 deflate 影响**（除非把播放器也塞进 ZIP 且用 fflate 解压后注入）。把播放器也塞进 ZIP 的代价是可调试性（TiddlyWiki 社区的明确抱怨）与启动路径复杂度。

### 3.3 `file://` 没有传输压缩

`file://` 不是 HTTP，没有 `Content-Encoding` 协商。因此：
- 服务端 gzip/brotli 对"发出去的 HTML"有效（如果走 URL 分发），对"落在用户磁盘上的 HTML"无效
- 提案把"Zip 压缩后再 Base64"当作总体优化，方向没错，但**不要用 gzip 后的数字描述磁盘上的文件**

---

## 4. 浏览器内存、Blob 与解码的真实边界

### 4.1 Chromium 官方 Blob 存储限额（一手，已抓取 [storage/browser/blob/README.md](https://raw.githubusercontent.com/chromium/chromium/main/storage/browser/blob/README.md)）

> **In-Memory Storage Limit**
> - If the architecture is x64 and NOT Chrome OS or Android: `2GB`
> - If Chrome OS: `total_physical_memory / 5`
> - **If Android: `total_physical_memory / 100`**

| Device | Ram | In-Memory Limit | Disk | Disk Limit | Min Disk Availability |
|---|---|---|---|---|---|
| Cast | 512 MB | 102 MB | 0 | 0 | 0 |
| Android Minimal | 512 MB | 5 MB | 8 GB | 491 MB | 10 MB |
| Android Fat | 2 GB | 20 MB | 32 GB | 1.9 GB | 40 MB |
| CrOS | 2 GB | 409 MB | 8 GB | 4 GB | 0.8 GB |
| Desktop 32 | 3 GB | 614 MB | 500 GB | 50 GB | 1.2 GB |
| Desktop 64 | 4 GB | 2 GB | 500 GB | 50 GB | 4 GB |

同一份文档的 **Common Pitfalls** 两节与 AIVN 直接相关：

> **Creating Large Blobs Too Fast** — "Creating a lot of blobs, especially if they are very large blobs, can cause the renderer memory to grow too fast and result in an OOM on the renderer side. This is because the renderer temporarily stores the blob data while it waits for the browser to request it. Meanwhile, Javascript can continue executing."
>
> **Leaking Blob References** — "If the blob object in Javascript is kept around, then the data will never be cleaned up in the backend… if a URL is created for a blob, this will keep the blob data around until the URL is revoked (and the blob object is dereferenced). However, the URL is automatically revoked when the browser context that created it is destroyed."

**由此得出的实现约束（对照证据）**：提案"页面加载时…将图片与音频生成内存 Blob URL，建立 assetUrl 映射表"这一句，在 Android 上撞的是 `RAM/100` 的 in-memory 额度。8GB 机型 ≈ 80MB。一个 15MB 的归档解压后若一次性全部 Blob 化并按 Chromium 的传输策略落到内存，会直接顶满；而"一次创建多个大 blob"正是官方点名的 OOM 路径。**建议分批、按需建立 Blob URL，并在切场时 `revokeObjectURL`。**

### 4.2 Blob URL 生命周期与 §5 之外的已知缺陷

- MDN [blob: URLs](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob)："Each time you call `createObjectURL()`, a new object URL is created, even if you've already created one for the same object. Each of these must be released by calling `URL.revokeObjectURL()`… As long as there's one object URL active, the underlying object cannot be garbage-collected and may cause memory leaks."
- blob URL 的 origin 语义："**The origin of the creator of this URL. If the creator's origin is opaque, then this part is implementation-defined.**" → 这正是 `file://`（opaque origin）下 blob Worker/blob 音频行为不确定的规范根源
- Firefox 有一个**故意的延迟释放**：bug 1800266 标题即 "Intentional latency in `URL.revokeObjectURL()` freeing memory"，注释指出 "Bug 1420419 added a **5 second** timer for releasing a revoked url"
- pdf.js 的实践教训（[PR #10644](https://github.com/mozilla/pdf.js/pull/10644)）："there's currently no attempt at releasing these resources, which are held alive by `blob:` URLs"；且**仅 revoke 不足以完全释放**——还需把 `img.src` 移除
- 历史上 Chrome 的 createObjectURL 内存不归还问题（[SO 33667099](https://stackoverflow.com/questions/33667099/createobjecturl-memory-leak-in-chrome)）："Even though I exactly called `revokeObjectURL`… Chrome had still hold physical memory and the memory was not released forever unless I refresh the page. Eventually, Chrome was crashed when the memory usage was up to 1.5GB."
- Safari 的历史 blob 泄漏（WebKit bug 31253 长尾评论）：多条报告指向 iOS 上 zip 解出的 blob + createObjectURL/revokeObjectURL 仍泄漏；但同一线程末尾有更新："The original issue no longer reproduces… as of at least Safari 26"

### 4.3 解码路径的内存放大

第三方深入分析（[DEV: Why Your Browser Chokes on Big Payloads](https://dev.to/will_indie/why-your-browser-chokes-on-big-payloads-streamlining-base64-decode-tasks-without-freezing-chrome-378m)）：

- `atob()` 是阻塞同步函数，主线程完全占用（浏览器无法重绘、无法处理点击、无法跑 microtask）
- **UTF-16 放大**："JavaScript strings are represented as UTF-16… every character takes up 2 bytes. If you have an 80MB Base64 string, that string is already taking up ~160MB of RAM. When you run `atob()`, it returns another string. If the decoded binary is ~60MB, that new UTF-16 string takes up ~120MB. **You now have nearly 300MB of heap allocated just for a single conversion pass.**"
- 另一处综述给的峰值口径更极端："peak memory ~8× input"（[toolbox365](https://www.toolbox365.net/tutorials/base64-large-file-memory-and-data-url/)）
- 推荐做法：Worker + TypedArray + 分块（base64 长度按 4 的倍数切）+ Transferable（`postMessage({bytes}, [arrayBuffer])` 零拷贝）
- 另一个陷阱：一次 `String.fromCharCode.apply(null, uint8Array)` 在 >~65,000 元素时爆栈

**更好的一手替代**（[MDN `Uint8Array.fromBase64()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array/fromBase64)）：

> "This method should be preferred over `Window.atob()` because it results in a byte array… use the instance method `Uint8Array.prototype.setFromBase64()`" （流式解码）

- Baseline 状态（[base64decode.org 综述](https://www.base64decode.org/articles/base64-decoding-in-javascript-browser-a-complete-guide-0002/)）：Chrome 140 / Edge 140 / Firefox 133 / Safari 18.2 / Node 25 / Deno 2.5，标记为 Baseline Newly available（2025）
- 实测对比（[MeasureThat 结果页](https://www.measurethat.net/Benchmarks/ShowResult/624902)）：`Uint8Array.fromBase64` **484 ops/sec** vs 传统 `atob`+逐字符循环 **16 ops/sec**（约 30×）
- 同文的可操作性结论："ids 10 megabyte payload decodes in single-digit milliseconds with `Uint8Array.fromBase64`; `atob` alone is a few times slower, and the classic follow-on loop that maps characters to a byte array takes roughly **twenty times** longer"

**对 AIVN**：能拿到 `Uint8Array.fromBase64` 就优先；拿不到（老 Safari）退回 `atob` + 分块；**并且整段解码应放到 Worker**，否则 15MB 归档的启动会有可见冻结。

### 4.4 数组/缓冲区硬上限

- MDN [RangeError: invalid array length](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Invalid_array_length)：`Array` 上限 2^32−1；**`ArrayBuffer` 上限在 32 位系统是 2^31−1（2GiB−1）**；Firefox 89 起 64 位为 2^33（8GiB）
- V8 源码 `js-array-buffer.h`：`kMaxByteLength` 在 32 位 = `kMaxInt`，64 位（非 sandbox）= `kMaxSafeInteger`；实际分配还受 `array_buffer_allocator()->MaxAllocationSize()` 约束，超限抛 `RangeError: Invalid array buffer length` / `Array buffer allocation failed`
- 三者的实际含义：**"单个 HTML 小于 2GB"不是可依赖的设计前提**，但 AIVN 的量级（数十 MB）离这个天花板很远，除非走超长篇累积导出

### 4.5 DOM 文本节点规模的现实

- 移动 WebView 的极端案例（[DevDiscipline: Opening 11 Million Character HTML in a Mobile WebView](https://devdiscipline.com/posts/opening-11-million-character-html-in-a-mobile-webview)）：11M 字符 HTML 直接黑屏、WebView 主线程窒息；作者把风险阈值定在 1.5M 字符
- 同一篇给出的正确做法："stored the 11 million characters of data as a **String** in the `rawChunks` array, not as a DOM Node. Storing data as a string takes up much less RAM, and rendering it to the DOM only when needed significantly reduces the document's total memory footprint."
- 大文件解析实测（[SO: DOMParser for large html](https://stackoverflow.com/questions/66645084/domparser-for-large-html)）：250MB HTML 用 `DOMParser` 约 18 秒且整页阻塞；作者改用 `FileReader` 取原始文本 + 按块解析，262MB 文件的"到首屏"时间降到 **~1.8s**
- Lighthouse 的 DOM 规模红线：warn > ~800 节点，error > ~1,400 节点（[Chrome for Developers](https://developer.chrome.com/docs/lighthouse/performance/dom-size)）——这条针对渲染树，不针对单个 data block 文本节点，但说明大 DOM 会拖垮 INP

**对 AIVN**：单个 data block 里的 15–40MB Base64 是**一个超长文本节点**。规范与实测都没有"文本节点上限"，但经验证据表明移动 WebView 在千万字符量级会卡死。**建议把归档放到文件尾部、用可寻址方式读，而不是把全部字节都变成 DOM 文本**——而这与"单文件 + `file://` 无法 fetch 自身"直接冲突（见 §5.2）。这是本设计最核心的张力。

---

## 5. `file://` 环境硬约束清单

### 5.1 origin 与同源策略

[MDN Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin%5Fpolicy)：

> "Modern browsers usually treat the origin of files loaded using the `file:///` scheme as **opaque origins**. What this means is that if a file includes other files from the same folder (say), they are not assumed to come from the same origin, and may trigger CORS errors. Note that the URL specification states that the origin of files is **implementation-dependent**, and some browsers may treat files in the same directory or subdirectory as same-origin even though this has security implications."

规范侧至今未定：`https://html.spec.whatwg.org/#sandboxOrigin` 只定义了 network scheme 与 `data:`，对 `file:` 回避（[whatwg/html#3099](https://github.com/whatwg/html/issues/3099)）。该 issue 里那张逐引擎行为表极为有用：

| 引擎 | `location.origin` / `window.origin` | 同目录/子目录 DOM 访问 | `localStorage` | `fetch()` on `file:` |
|---|---|---|---|---|
| Edge | `file://` | 目录、子目录、父目录**都允许** | 所有 `file:` URL 共享 | 超时 |
| Firefox | `null` | 同目录与子目录允许；父目录禁止 | 按同目录或子目录作用域 | 同目录/子目录**可以**，父目录 NetworkError |
| Safari | `null` | iframe 会被换成 Finder 窗口 | **所有 `file:` 阻断** | 全部 NetworkError |
| Chrome | `null` | 全部禁止 | 所有 `file:` URL 共享 | 全部 NetworkError |

Ladybird 的工程评论补充了两个"必须给 file:// 开特例"的现实需求：允许从 `file://` 加载字体、**允许 `file://` 自动播放**。说明 `file://` 在各引擎里是一堆特例的集合，不是一致环境。

### 5.2 `fetch("")` / `fetch(file://…)`

- Fetch 规范原文（[whatwg/fetch#1195](https://github.com/whatwg/fetch/issues/1195) 引用）："For now, unfortunate as it is, **file URLs are left as an exercise for the reader**. When in doubt, return a network error."
- 实测结论（[SO 55383132](https://stackoverflow.com/questions/55383132/why-are-some-file-fetch-calls-allowed-while-others-are-cross-origin-reques)）："On Chrome and Edge, it always fails, regardless of whether the file exists… on Firefox, if the file being fetched exists, it succeeds"；XHR 在 Chrome 也不行、Firefox 可以
- Polyglot 方案正是被这条打掉的（§2.2 引文）

### 5.3 ES Module / Worker / Service Worker

- 外部 ES 模块在 `file://` 被 CORS 拦截（[barker.codes](https://barker.codes/blog/javascript-modules-and-the-file-uri-scheme/)）："The browser's built-in module loader uses CORS to fetch modules"；**例外**："an inline module script that imports a module from an external server"可以（外部服务器允许 `null` origin）
- V8 官方博客确认同一点："module scripts and their dependencies are fetched with CORS. This means that any cross-origin module scripts must be served with the proper headers… **This is not true for classic scripts.**"（[v8.dev/features/modules](https://v8.dev/features/modules)）
- whatwg/html#8121 里 domenic 的原则性说明："we drew a line in the sand, and said no new web platform features would break the same origin policy. The existing features need to be grandfathered in"
- Worker：经典 Worker 的请求 `mode` 是 `"same-origin"`（[SO 58098143](https://stackoverflow.com/questions/58098143/why-are-cross-origin-workers-blocked-and-why-is-the-workaround-ok) 引规范）；MDN 明确 "This must be same-origin with the caller's document, or a `blob:` or `data:` URL"（[Worker() constructor](https://github.com/mdn/content/blob/main/files/en-us/web/api/worker/worker/index.md)）
  - **关键**："`data:` URLs… have an opaque origin, which makes them cross-origin to all other origins including their owner"；"`blob:` URLs should be used instead, where possible, because **the URL inherits the origin of the document that created it**"
  - 但 whatwg/html#1322 的讨论揭示了规范的含糊："the origin of an object URL created from an opaque origin is implementation defined"；且实现与规范不符——"what chrome actually does is to look up the url in the Blob URL Store and then return the origin of the incumbant settings object at the time createObjectURL was called"；同一讨论里有人说 "Workers created using object urls work already even in sandboxed iframes, at least in implementations"
  - **实操含义**：`fflate` 的 async `unzip()` 依赖 Worker。在 `file://` 下"blob Worker 能否创建"各引擎不一致且无规范保证 → **AIVN 的离线播放器必须实现同步回退（`unzipSync`），并接受主线程冻结**，或者至少做能力探测
- Service Worker 在 `file://` 被明确拒绝（[MDN register()](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)）："`SecurityError`… The `scriptURL` is not a potentially trustworthy origin"；实测错误信息 "serviceWorker.register() must be called with a script URL whose protocol is either HTTP or HTTPS"；Edge 的错误 "The URL protocol of the current origin ('file://') is not supported"（[MS Q&A](https://learn.microsoft.com/en-us/answers/questions/5512482/service-worker-registration-error-in-microsoft-edg)）
  - 同一份工程笔记给出 `file://` 下**可用**的存储能力（实测）："**Web Workers** work perfectly ✅ / **Shared Workers** work perfectly ✅ / **IndexedDB** works perfectly ✅ / **Cache API** doesn't work / **fetch interception** less relevant"
  - 另一份可靠口径（[web.dev storage-for-the-web](https://web.dev/articles/storage-for-the-web)）提示："LocalStorage should be avoided because it is synchronous… limited to about 5MB"；以及 Safari 的 7 天可写存储驱逐（对 `file://` 不适用，但对"托管版回放"适用）

### 5.4 SQLite WASM 在离线单文件下基本排除

- 官方文档硬性要求（[sqlite-wasm README](https://github.com/sqlite/sqlite-wasm/)）：OPFS 后端必须 `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`；且"**Only the worker versions allow you to use the OPFS storage back-end**"
- Chromium 官方博客更直接："**Browsers will not serve Wasm files from `file://` URLs, so any apps you build with this require a web server** and that server must include the following headers"（[Chrome for Developers: SQLite Wasm in the browser backed by OPFS](https://developer.chrome.com/blog/sqlite-wasm-in-the-browser-backed-by-the-origin-private-file-system)）
- SQLite 官方还列出：OPFS 仅在 Worker 上下文可用（"OPFS is only available in Worker-thread contexts, not the main UI thread"）；Safari < 17 与 opfs VFS 不兼容；WASM 构建读不了 WAL 模式数据库（缺少 shared-memory API）（[sqlite.org/wasm persistence](https://sqlite.org/wasm/doc/trunk/persistence.md)、[cookbook](https://sqlite.org/wasm/doc/tip/cookbook.md)）

**判定**：把 SQLite-WASM 当"离线单文件的数据库层"在 `file://` 下不可行（除非把 wasm 也 base64 内联并由 JS 手动 instantiate，但 OPFS/COOP-COEP 仍不可用）。若离线播放器只需要"读谱系事件流"，根本不需要数据库——JSONL + 内存索引即可（见 §10）。

---

## 6. 音频与自动播放：决定"打开即播"能否成立

### 6.1 桌面 Chromium / Firefox

- Chrome autoplay policy（[Chrome for Developers](https://developer.chrome.com/blog/autoplay)、[chromium.org/audio-video/autoplay](https://www.chromium.org/audio-video/autoplay/)）：
  - "Muted autoplay is always allowed."
  - "Autoplay with sound is allowed if: The user has interacted with the domain (click, tap, etc.) / On desktop, the user's **Media Engagement Index** threshold has been crossed / The user has added the site to their home screen… / Top frames can delegate autoplay permission to their iframes"
  - Web Audio 自 **Chrome 71** 起纳入策略。原文："If an `AudioContext` is created before the document receives a user gesture, it will be created in the `suspended` state, and you will need to call `resume()` after the user gesture."
  - **重要放宽**："An AudioContext will be resumed automatically when two conditions are met: The user has interacted with a page. The start() method of a source node is called."
  - 跨源 iframe 需要 `allow="autoplay"`，否则 "the audioContext will never be allowed to run"
- MEI 的判定门槛原文："often lets a website play audio for more than **7 seconds** then we assume in future that the user is expecting this website to have the right to autoplay"
- MDN 权威策略汇总（[Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)）：`Navigator.getAutoplayPolicy()` 可查询；Firefox 的 `media.autoplay.block-webaudio` 默认 `true`，即 "audio contexts are only able to play on pages once there has been **Sticky activation**"
- **`file://` 的特殊性**：Ladybird 的 issue 列表把 "Allowing autoplay for file:// URLs" 列为需要给 file origin 开的特例之一（[whatwg/html#3099 评论](https://github.com/whatwg/html/issues/3099)）。AIVN 的播放器在 `file://` 下**恰好**可能拿到这个特例——但这属于实现细节，不能作为设计前提
- 实践建议仍然一致：放一个显式"开始/播放"按钮（Chrome 官方："Think of a 'play' button or 'on/off' switch for instance"）

### 6.2 iOS / WebKit：更严格，且是 per-element

- WebKit bug 132691（[bug 132691](https://bugs.webkit.org/show_bug.cgi?id=132691)）：`HTMLAudioElement.play()` 只能由用户交互触发，被 **WONTFIX**。官方给的两条出路："1) You can try the WebAudio API instead… it requires user interaction only **once per AudioContext** 2) You can create all your elements at once in response to a 'click' event"
- iOS 上的成熟解法（[Flowy: the ios safari audio-unlock trick](https://www.flowy.fm/learn/ios-safari-audio-unlock-trick)）：
  - "WebKit's audio-gesture policy is enforced **per audio element**, not per page. The rule is: a `play()` call must happen inside a user-gesture handler at least once for the element to be unlocked."
  - 解锁手法：在手势回调里给该元素设 16 字节静音 WAV data URL 并 `play()`，成功即解锁该元素整个会话
  - 注意事项："**pointerdown** alone doesn't count on iOS; you need at least **touchend, mouseup, or click**"；"don't latch on a rejected `play()`"；"if the audio element already has a real (non-`data:`) URL loaded, don't reset it"

### 6.3 Blob URL 音频的已知坑（直接命中 TTS 回放）

- **iOS 必须给 Blob 带 MIME type**（[WebKit bug 198015](https://bugs.webkit.org/show_bug.cgi?id=198015)）："the file parser can't determine the type of the file in the absence of a Content-Type HTTP header and a lack of any file extension on the URL"；社区验证的修法 `new Blob([arrayBuffer], { type: 'audio/mpeg' })`。同一 bug 被 [245056](https://bugs.webkit.org/show_bug.cgi?id=245056)（MediaRecorder 场景）标为 duplicate
- **blob URL + fragment 在 Safari 会 404**（[SO 13231915 讨论](https://stackoverflow.com/questions/13231915/loading-audio-via-a-blob-url-fails-in-safari) 引 WebKit bug 236069）
- **Safari 15：blob > 65536 字节导致 `ended` 不触发、播放提前结束且不断重发 206**（[WebKit bug 238113](https://www2.webkit.org/show_bug.cgi?id=238113)，已修复）—— 对"每句 TTS 一个 blob、靠 `ended` 推进台词"的播放器是系统性风险；对策是把推进逻辑挂在计时器/字数上，而不是只挂 `ended`
- Ren'Py 的官方 web 文档把这条写成玩家可见行为："**Due to limitations in the browser intended to stop advertisements from playing audio, sound and music files won't play until the user clicks inside the game at least once.**" 并提到 Safari 不支持 OGG，需要 `config.webaudio_required_types = [ "audio/mpeg" ]` 之类的探测

**对照证据**：提案 §2.3 写"舞台立绘、背景、音乐、语音即时就绪，开启演出"，并把"双击即可在浏览器中获得完整声画与分支交互"作为目标 2。外部证据的判定是：**必须有显式的第一次点击**，且 iOS 上需要 per-element 解锁。这不是可以绕过的实现细节，而是三个引擎的既定策略。"双击即播"应改为"打开 → 点一次 → 开演"。

---

## 7. 分发渠道：这个 HTML 到底谁能打开

### 7.1 桌面：OK

- 双击 `.html` 在 Windows/macOS 由默认浏览器打开并执行 JS（各工具链文档都以此为前提，如 Bun："Double-click it from your desktop"）

### 7.2 iOS / iPadOS：**不行**

- [Apple 社区](https://discussions.apple.com/thread/256102223)："Due to evolving security reasons, you can no longer open an HTML file directly with Safari (or Firefox) in iOS 18.5. **Quick Look is as close as you can get and it will not run JavaScript.**"
- [SO 67581426](https://stackoverflow.com/questions/67581426/how-to-open-a-local-html-file-in-safari-on-an-ipad)："Safari iPad no longer supports access to local or iCloud files."
- SingleFileZ 的官方 Known Issues 同源："The HTML page cannot be viewed when opened from the filesystem on iOS because the page is displayed by default in a viewer which does not support JavaScript."
- 有第三方可绕过：Microsoft Edge for iOS 仍能打开本地 html；或自建"HTML 编辑器/浏览器"类 App；或在网页里用 `<input type=file>` + `URL.createObjectURL` 转成 blob 打开（[SO 67581426 的答案](https://stackoverflow.com/questions/67581426/how-to-open-a-local-html-file-in-safari-on-an-ipad)）
- 第三方综述给出同样结论（[Pagira](https://www.prestapps.com/pagira/blog/open-html-file-on-iphone)）："Safari on iPhone and iPad does not open a file that lives on the device. The browser is built to fetch pages over the network. It has no 'open file' command, and it does not appear in the Files app's 'Open with' menu."（该页还说明了它自己这类 App 的定位是"打开整个文件夹而非单文件"，这与单 HTML 方案无冲突）

### 7.3 Android：**部分可用，且窄**

- Chrome + scoped storage（[android.stackexchange 220400](https://android.stackexchange.com/questions/220400/local-files-revisited-opening-local-html-files-file-path-to-file-in-chrome)）：Android 10 起 `file:///storage/emulated/0/...` 报 access denied；可行位置是 `Android/data/com.android.chrome/files/Download/`（Android 10）或 `/Download`（Android 11）
- **即使打开，相对子资源也可能失败**（[android.stackexchange 256263](https://android.stackexchange.com/questions/256263/html-does-not-find-local-links-and-local-images-chrome-on-android-10)）：放在推荐目录里，Chrome 能打开 index.html，但 `<img src="smily.gif">` 不显示、`href="a1.html"` 报 `ERR_FILE_NOT_FOUND`。（**对单 HTML 的启示**：这反而是单文件自包含的一个真实优势——所有子资源都内联，不需要相对路径解析）
- Firefox for Android：Fenix 从 85 起不再支持 `file:`（[mozilla-mobile/fenix#7546](https://github.com/mozilla-mobile/fenix/issues/7546)，维护者原话 "for now Fenix will not support loading `file://` anymore"）
- Android IPC 层的方向性变化（同 issue 引用 Google issue tracker）："apps should only use `content://`-URIs when launching other apps, meaning… you cannot open any of the other local resources possibly referenced by the HTML file pointed to by the received Intent"

### 7.4 微信 / IM（AIVN 的主要中文分享场景）

- 微信内置浏览器（X5）对本地 HTML 的限制（[微信开放社区](https://developers.weixin.qq.com/community/develop/doc/0006acf61648906fc3c793a465b800)）：真机 `webView` 加载 `wxfile://` 路径报 `net:ERR_UNKNOWN_URL_SCHEME`，换成 `file://` 则白屏；小程序 web-view 只允许业务域名，`file://` 直接报"不支持打开非业务域名 file://"
- 微信小程序的文档打开能力白名单（[wx.openDocument](https://developers.weixin.qq.com/miniprogram/dev/api/file/wx.openDocument.html)）：`fileType` 合法值仅 `doc docx xls xlsx ppt pptx pdf` —— **不含 html**
- 微信聊天的"聊天素材支持小程序打开"（[support_material](https://developers.weixin.qq.com/miniprogram/dev/framework/material/support_material)）里**有** `text/html`（标注为 "webview"），但这是"由小程序接管打开"的通道，需要小程序声明 `supportedMaterials` 并通过审核——不是"双击聊天里的 html 就跑起来"
- 中文技术综述的结论（[kd.cn](https://www.kd.cn/ask/22703.html)，二手但描述一致）：微信默认阻止可能含脚本的 HTML 直接下载/执行，通行做法是托管成 URL 分享，或发 ZIP 包让用户自行解压后用第三方浏览器打开

**对照证据**：提案目标 2 的"到处分享，双击即播"在移动端/IM 端不成立。可行动的替代路径（都由外部资料直接支持）：
1. **托管成 URL**（GitHub Pages / Pages 类静态站；或 itch.io HTML5）——微信/移动端都能点开
2. **发 ZIP 包 + 指引**（微信可传 zip；符合其 `application/zip` 素材类型）
3. **走 AIVN 导入**（接收方有 Stage AI 时最顺；对应提案目标 3）

### 7.5 邮件

- Gmail 附件上限（[Gmail Help](https://support.google.com/mail/answer/6584?hl=en-uk)）："For personal Gmail accounts, the limit is **25 MB**… If your file is greater than 25 MB, Gmail automatically adds a Google Drive link"；企业版 50MB 发送 / 70MB 接收（[Android Authority](https://www.androidauthority.com/gmail-file-size-limit-3644154/)）
- `.html` 不是 Gmail 的硬黑名单类型（黑名单是 `.exe/.js/.jar/...` 那一串，见 [File types blocked in Gmail](https://support.google.com/mail/answer/6590)），**但** Workspace 管理员的"附件合规"策略可以把 `.htm/.html/.mhtml` 列为拦截类型（[Gmail 管理员设置](https://support.google.com/a/answer/2364580?hl=en)；实务讨论见 [edugeek](https://www.edugeek.net/forums/topic/225619-google-workspace-blocking-htm-html-mhtml-attachments-do-i-need-the-full-stop/)）
- **量化后果**：提案的"完整版单 HTML 5–15MB"可以邮件，但"中长篇 19–23.5MB"贴着 25MB 边界，且企业域名随时可能被策略拦掉

### 7.6 itch.io（如果考虑托管）

- [itch.io HTML5 文档](https://itch.io/docs/creators/html5)：单文件 HTML **可以直接上传，不需要打包 ZIP**；ZIP 时限制为
  - "The ZIP file should not contain more than **1,000 individual files** after extraction."
  - "The maximum length of a file name including path should not be greater than 240 characters"
  - "The size of all the extracted content should not be greater than **500MB**"
  - "The size any single extracted file should not be greater than **200MB**"
- 这个限制是**对着"文件多"设计的**，而单 HTML 恰好只有一个文件 → 对 AIVN 的"单 HTML 托管分发"极为友好（对比 Ren'Py web 构建常见的 1000 文件超限问题）

---

## 8. 视觉小说 / 交互小说的 canonical 分发形态（先例）

### 8.1 Twine：**双形态**（这是最强的那条先例）

- **运行形态**：`Publish to File` → 单个自包含 HTML（[Twinery: Archiving and Exporting Stories](https://www.twinery.org/reference/en/story-library/exporting.html)）：
  > "This file can be **either opened directly in a web browser to play your story, or imported into Twine**."
- **归档形态**：Library 的 `Archive` 生成一个 HTML，内含全部故事（同上页）
- 具体格式有公开规范（[iftechfoundation/twine-specs](https://github.com/iftechfoundation/twine-specs)）：
  - [Twine 2 HTML Output Spec](https://github.com/iftechfoundation/twine-specs/blob/master/twine-2-htmloutput-spec.md)：`<tw-storydata name startnode creator creator-version format format-version **ifid** options tags zoom hidden>` + `<style role="stylesheet">` + `<script role="script">` + `<tw-passagedata pid name tags position size>`
  - [Twine 2 Archive Output Spec](https://github.com/iftechfoundation/twine-specs/blob/master/twine-2-archive-spec.md)：多故事 = 多个 `<tw-storydata>` 并列
  - [Twine 2 JSON Spec](https://github.com/iftechfoundation/twine-specs/blob/master/twine-2-jsonoutput-doc.md)：面向工具链的第三种形态
  - [Twee 3 Spec](https://github.com/iftechfoundation/twine-specs/blob/master/twee-3-specification.md)：**面向人/版本控制的纯文本交换格式**（`:: PassageName [tags] {"metadata"}`），`StoryData` 里带 `ifid`
- **`ifid` 的语义**（Twee 3 规范 + [The Treaty of Babel](https://www.eblong.com/zarf/blorb/)）："An IFID (Interactive Fiction IDentifier) **uniquely identifies compiled projects**"；Twine 2 用 v4 随机 UUID、全大写
- **官方劝退 base64 媒体**（[naughty.games 的 Twine 发布指南](https://naughty.games/guides/twine-publish) 引 Twine 文档）："The alternative, encoding media as base64 directly inside the story, is technically possible but Twine's documentation recommends against it because it's harder to work with and makes the published file much larger for no real benefit."
- **跨设备注意**："Any project changes you make in the either instance… will not be automatically available in the other instance, you will need to repeat export / import process"（[Twine Q&A](https://twinery.org/archive/questions/43696/editing-across-multiple-devices.html)）
- **反向教训**：用"另存为"保存 Twine 应用页面得不到工程（[Twine Q&A 48804](https://twinery.org/archive/questions/48804/game-saved-as-html-file-folder-now-cant-be-imported.html)）——说明"HTML 可回灌"必须由格式显式保证，而不是靠"它是个网页"

**可直接借用的三条**：
1. **分发产物（HTML）与可编辑产物（Twee/JSON）分离**，且分发 HTML 里嵌一份机器可读的完整数据块，使它能被重新导入
2. **一个稳定的项目标识符**（IFID）写进 HTML 属性，用于导入时的去重与归属（对应 AIVN 提案里的 `data-id` / `data-title`，可以把 `playId` + 一个 IFID 级 UUID 一并写入）
3. 官方明确反对 base64 内联媒体（Twine 的立场是"链接到同级媒体文件夹"）——AIVN 需要 base64/zip 的理由是**单文件移动不破**，这是与 Twine 不同的取舍，但代价（+33%、无缓存、官方称"for no real benefit"）应当被记录为已知成本

### 8.2 ink / Inky：编译产物 + 状态序列化 + **显式版本号**

- 编译链（[RunningYourInk.md](https://github.com/inkle/ink/blob/master/Documentation/RunningYourInk.md)）：`.ink` → 单个 `.json` → runtime 构造 `Story`，循环 `Continue()`
- 状态（[inkjs README](https://github.com/inkle/inkjs)、[StoryState.cs](https://github.com/inkle/ink/blob/master/ink-engine-runtime/StoryState.cs)）：
  - `string savedJson = _inkStory.state.ToJson();` / `_inkStory.state.LoadJson(savedJson);`
  - 版本常量：`kInkSaveStateVersion = 10`、`kMinCompatibleLoadVersion = 8`、`Story.inkVersionCurrent = 21`、`Story.inkVersionMinimumCompatible = 18`
  - 加载时硬校验："ink save format incorrect, can't load." + "Ink save format isn't compatible with the current version (saw 'X', but minimum is '8'), so can't load."
  - 存档字段清单：`flows / currentFlowName / variablesState / evalStack / outputStream / choiceThreads / visitCounts / turnIndices / turnIdx / storySeed / previousRandom / inkSaveVersion`
  - 还支持后台序列化：`CopyStateForBackgroundThreadSave()` → `BackgroundSaveComplete()`
- inkjs 的 CORS 教训（同一 README）："Unfortunately, your browser won't let you do that because of CORS policy, which means you need a web server to do this."
- `ink_JSON_runtime_format.md` 定义了独立的运行时字节码格式（`inkVersion` + `root` 容器），即**编译器产物格式与存档状态格式是两个独立版本化的东西**

**对 AIVN**：谱系事件日志是"重放源"，归档需要**自己的格式版本号**（不是指 play.json 的 schema），并且应区分"事件日志格式版本"与"运行时状态快照版本"。

### 8.3 Ren'Py：单文件容器 + 明确的兼容性免责

- web 端口（[Ren'Py Web/HTML5](https://renpy.org/doc/html/web.html)）：
  - "Actually running the game from this folder isn't supported, as the game needs to be hosted by a web server."（**单目录双击不可行，必须服务器**）
  - 限制清单：无多线程（`renpy.invoke_in_thread`、`threading` 不可用）→ 不能后台预载图片；**Networking is not supported**；Live2D 不支持；视频只能用浏览器支持的格式且只支持 `renpy.movie_cutscene()`
  - 浏览器缓存限制："files that are greater than **50MB** in size won't be cached, which means big files will be downloaded every time your game is run."
  - `progressive_download.txt`：`-` 前缀 = 游戏开始前下载，`+` 前缀 = 需要时下载。默认：
    ```
    - image game/gui/**
    + image game/**
    + music game/audio/**
    + voice game/voice/**
    ```
  - 关于音频："Due to limitations in the browser intended to stop advertisements from playing audio, sound and music files won't play until the user clicks inside the game at least once."
  - `.wasm` 需要 `application/wasm` MIME；`game.zip` 被托管商拒时改名 `game.data` 并改 index.html
- 打包与归档（[Building Distributions](https://www.renpy.org/doc/html/build.html)）：`build.archive()` / `.rpa` 归档，用途是减少文件数与"protects files from casual copying"
- 社区实践（[itch.io 讨论](https://itch.io/t/2109287/too-many-files-publishing-renpy-vn-to-play-in-browser)、[Arghbulous 优化指南](https://arghbulous.itch.io/the-muzeum/devlog/1309260/renpy-web-build-tips-to-stay-under-the-1000-files-limit-other-optimisations)）：
  - 用 `.rpa` 把上千文件收成一个，是解决 1000 文件限制的**社区标准做法**
  - **把多句语音合并进一个 ≤30s 的文件**："the length of a VA file shouldn't exceed that, else the lag on web browser becomes noticeable"；"You can usually fit around 8-10 lines in 30s… you can go from 300+ VA files to only 30+ after this"
  - 有第三方工具做 webp/ogg 转换与 7Zip 重打包
- 存档（[Saving, Loading, and Rollback](https://www.renpy.org/doc/html/save_load_rollback.html)）：
  - "While we usually attempt to keep save compatibility between releases, **this compatibility is not guaranteed.** We may decide to break save-compatibility if doing so provides a sufficiently large benefit."
  - 存档是 ZIP（`screenshot.png` / `extra_info` / `json` / `renpy_version` / `log`），`log` 是 pickle 的用户态变更日志
  - 元数据字段：`_save_name` `_renpy_version` `_version` `_game_runtime` `_ctime`（JSON 存储，只能放 JSON 可表示的值）
  - 加载语义（v6 文档表述）："the variables are reset to what they were when the init code in the current version of the script finished running. The saved user state is then merged with this, with saved user state overriding any variable that was also assigned in the init code. Finally, a rollback is triggered."
- **存档签名**（[renpy/savetoken.py](https://github.com/renpy/renpy/blob/9d275e9349909c53c7317035b5d52ef331d823fb/renpy/savetoken.py)）：用 ECDSA 签名 `log`，验证失败时弹窗询问用户是否信任；`verify_data` 失败 → `ask(gui.UNKNOWN_TOKEN)`；emscripten（web 端口）下直接 `return True`（"The web sandbox should be enough."）

### 8.4 Blorb（IFRS / IFF）：**最贴近 AIVN 需求的既有单文件容器规范**

（[Blorb Spec 2.0.5，Andrew Plotkin](https://www.eblong.com/zarf/blorb/)）

> "This is a formal specification for a common format for storing resources associated with an interactive fiction game file… **In addition, the executable game file may itself be a resource in a resource file.** This is a convenient way to package a game and all its resources together in one file."

结构要点（可直接对照 AIVN 的 archive.zip 拓扑）：

- `FORM` + 长度 + `IFRS`；**第一个 chunk 必须是资源索引 `RIdx`**，且只允许一个
- `RIdx` 条目 12 字节：`usage`（`'Pict'`/`'Snd '`/`'Data'`/`'Exec'`）+ `number`（游戏视角的资源号）+ `start`（相对 FORM 起点的字节偏移）
- 资源各自成 chunk，顺序不限（"since the resource index contains all the information necessary to find a particular resource"）
- 可选 chunk：`RelN`（发行号）、`IFhd`（**游戏标识**，"If they don't [match], the interpreter should display an error"）、`Fspc`（封面图 = 一个普通图片资源号）、`RDes`（资源文字描述）、`Loop`（V3 循环标记）、`Reso`（缩放）、`APal`
- 支持的媒体：图片 PNG/JPEG/占位矩形；音频 AIFF/MP3/Ogg/MOD（MOD 覆盖 `.MOD/.IT/.XM/.S3M`）；`Exec` 支持 `ZCOD/GLUL/TAD2/TAD3/HUGO/ALAN/ADRI/LEVE/AGT /MAGS/ADVS/EXEC`
- **开发态/分发态双形态**：规范第 16 节明确给出"资源摊平成目录"的等价表示（`PIC1` `SND1` `DATA1` `STORY` `IDENT` `PALETTE` `FRONTIS` `RESDESC` `METADATA` `RELEASE` `RESOL` `ADAPTPAL` `LOOPING`）——即 **单文件容器与目录形态一一对应，可互相拆装**
- 生态里配有 `ifsitegen.py`（"a Python script for packaging a Blorb file (or a bare Z-code or Glulx file) into a playable web page"）

**对照证据（最直接的一条）**：Blorb 与提案的 `archive.zip` 拓扑几乎同构（资源 + 可执行/剧本 + 游戏标识 + 封面 + 可选描述），差别是 Blorb 把"索引"作为**格式强制的第一个 chunk**，而提案把索引放在 `assets/manifest.json`（位置与强制程度未定）。Blorb 用 `IFhd` 做"这份资源属于哪个作品"的校验——这正是 AIVN 导入去重与归属校验可以照抄的机制。

---

## 9. 便携归档格式谱系（决策对照）

| 格式 | 结构 | 索引机制 | 随机访问 | 规范级约束/教训 | 对本需求的相关度 |
|---|---|---|---|---|---|
| **ZIP（AIVN 提案）** | local header × N + central directory + EOCD | central directory（在文件尾，权威） | 需要先读中央目录 | 允许 offset>0 前缀与 ≤64KB 后缀（polyglot 基础） | 基线 |
| **ZIP64** | 同上 + ZIP64 EOCD/EOCD locator + extra field | 同 | 同 | fflate：`> 65535` 条目支持仍在 PR（#230 / #270）；**仍不支持单文件 > 4GB**，CHANGELOG 明写 "Still not possible to have above 4GB files"；JSZip2（fork）4.3 起自动 ZIP64，读取精确到 2^53−1 | 长篇累积导出需注意条目数与单文件尺寸 |
| **EPUB 3.3 / OCF** | ZIP + `mimetype` + `META-INF/container.xml` + package document | OPF manifest | 读系统自定 | **强制约束**：MUST NOT 跨卷/分卷；**只允许 STORE 与 Deflate**，其他压缩视为错误；MUST NOT 用 ZIP 自带加密；仅 audio/video/font/script 可远程托管，其余 MUST 在容器内；MUST NOT 引用 `META-INF` 内文件；"Some reading systems do not provide access to resources outside the directory where the package document is stored" | 说明"基于 ZIP 的规范"普遍会收紧 ZIP 自由度；AIVN 若想跨工具可读，可考虑最小对齐 |
| **WACZ** | ZIP + `datapackage.json`(Frictionless) + `datapackage-digest.json` + `archive/*.warc(.gz)` + `indexes/*.cdx(.gz)` + `pages/pages.jsonl` | 中央目录 + CDXJ 索引 | **HTTP Range 优先** | "Already compressed files MUST NOT be compressed again"；`archive/` 与 `index/*.cdx.gz` 用 STORE；`datapackage.json` 带每个文件的 hash；发布 MUST 带 `Content-Length`、服务器 MUST 支持 Range、SHOULD 带 CORS；媒体类型 `application/wacz` | **最贴近"ZIP + 元数据 + 索引 + jsonl"的现代规范**；它明确把"托管分发"作为一等场景 |
| **ZIM** | 自有 header + MIME 列表 + URL 指针表 + title 索引 + cluster 指针表 + clusters | 自有 | 天然按 cluster 随机访问 | zstd / LZMA2 分簇；压缩比可达 3∶1，收益"almost all… within the clusters" | 说明"为离线随机访问自造格式"的代价是放弃 ZIP 工具生态 |
| **MHTML / .mhtml** | MIME multipart 单文件 | 无 | 无 | Bun 文档指其"only some browsers can open them, which defeats the purpose" | 失败先例 |
| **Web Bundles** | CBOR/HTTP 语义包 | 内部索引 | 有 | **Chrome 于 2023-02 移除对 Web Bundle 导航的实验性实现**；b1 格式读取被删除；仅 Chromium + flag | 失败先例（若考虑"浏览器原生单文件格式"） |
| **git bundle** | 文本 header（`# v2/v3 git bundle` + capabilities + prerequisites + references）+ packfile | ref 列表 + pack 索引 | pack 内可随机访问 | 支持**自包含**与**带 prerequisites 的增量**两种；`git bundle verify` 校验前提是否满足；"It is okay to err on the side of caution, causing the bundle file to contain objects already in the destination" | **"回灌续演"的强先例**：用 prerequisites 表达"我基于哪个基点增量"，用 verify 做导入前校验 |
| **SQLite 单文件** | B-tree 页 | 内建 | 有 | 单文件、serverless 是卖点；但 WASM 版在 `file://` 不可用（§5.4） | 不适用于离线单文件回放 |

---

## 10. 事件日志、内容寻址与"续演身份"的 canonical 做法

### 10.1 事件溯源

（[Azure Architecture Center: Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)、[hld-handbook 综述](https://github.com/handbook-academy/hld-handbook/blob/main/content/part-5-architecture-patterns/03-event-sourcing.md)）

- "Each entity in an event-sourced system has its own eventstream… Applications derive the current state of an entity by replaying all the events in its stream. This process is known as **rehydration**."
- **快照的定位（与提案直接相关）**：
  > "Snapshots are an optimization, not a replacement for the eventstream. **The eventstream remains the source of truth**, and you can regenerate snapshots from it at any time."
  > "They are always an optimization, never the source of truth. If a snapshot is incompatible or corrupted, the system falls back to full event replay."
- 一致性机制："Append new events with `expectedVersion = lastSeenVersion`"（乐观并发）
- 事件演进的三条策略（官方列名）：tolerant deserialization / event versioning / **upcasting**；"In-place migration… breaks immutability and should be a last resort"
- 反模式（来自 hld-handbook）：把 Kafka 当事件存储（缺 per-aggregate 查询与 `expectedVersion`）；事件写成 CRUD diff（`UserUpdated`）而非业务动词（`CustomerMovedHome`）；投影处理器不做幂等
- 官方对成本的原话："event sourcing is 'a complex pattern that introduces significant trade-offs… **costly to migrate to or from**'"

**对照证据**：仓库 `packages/core/src/lineage/model.ts` 已经采纳了同一原则 —— 首行注释原文："**行级事件日志是唯一真相源**（计划 D7/D10）"，并且"edit 是挂在目标旁边的旁注，不入树，日志永不改写"。提案把 `session.json` 描述为"运行时会话状态快照（含谱系快照）"、同时又把 `lineage.jsonl` 作为"完整谱系事件日志"一起打包，等于把一个**派生量**当成并列真相源。按事件溯源惯例，正确的形态是：归档只保证 `lineage.jsonl` 完整可重放；`session.json`（或快照）是**可选的加速件**，且必须能被丢弃后由日志重建。这也与 `apps/server/src/rebuild.ts` 的存在一致（`lineageToBeats` 能从谱系重建拍次）。

### 10.2 JSON Lines

（[jsonlines.org](https://jsonlines.org/)、[ndjson-spec](https://github.com/ndjson/ndjson-spec/blob/master/README.md)）

- 三要求：UTF-8（"a byte order mark (U+FEFF) must NOT be included"）；每行一个合法 JSON 值（"`null` is a valid value but a blank line is not"）；行终止符 `\n`（`\r\n` 也被接受）
- 约定：扩展名 `.jsonl`（旧名 `.ndjson`）；推荐 gzip → `.jsonl.gz`；MIME `application/jsonl`（尚未标准化）/ ndjson 用 `application/x-ndjson`
- 追加友好性（[jsonlkit FAQ](https://jsonlkit.com/jsonl-faq)）："Open in append mode and write another line; no rewrite, no seeking"
- 解析器健壮性建议："Parse each line independently — don't fail the whole file because one line is malformed; collect errors with line numbers."、"Stream-parse rather than slurp."

**对 AIVN**：`lineage.jsonl` 的格式选择与社区规范一致。需要显式处理的边界：文件末尾必须有换行（"if a line terminator follows the last JSON value in a file, it must be the last byte in the file"）、空行不是合法记录、**BOM 必须禁止**（Windows 端手改文件很容易引入 BOM，而导入侧如果按行 JSON.parse，第一行会因 BOM 直接失败）。

### 10.3 内容寻址与去重

（[GitLab Artifact Registry ADR-008: Content Addressable Storage](https://gitlab.com/gitlab-org/ops/artifact-registry/-/blob/main/docs/adr/008_content_addressable_storage.md)、[Cloudstic: Content-Addressable Storage](https://docs.cloudstic.com/concepts/content-addressing)）

- 标识格式："Content hashes use the `algorithm:hex` format (for example, `sha256:a3b5c7d9...`), following the OCI Content Descriptors convention."
- 存储路径可直接由 hash 推导："given an object key, the namespace hash and content hash can be extracted by parsing the path components **without a database lookup**"
- 去重是结构性质而非协调步骤："If the destination path already exists, the blob is a duplicate and no new object is written. No database coordination is needed for the deduplication check itself."
- 完整性校验免费获得："clients can verify integrity on download by computing the SHA256 hash of the received content and comparing it to the expected hash"
- 零长度陷阱（很有价值的一条细节）："The SHA256 hash of empty content… is a known constant. Zero-length writes are only permitted to that specific hash path. Without this invariant, a race between a failed upload (which produces zero bytes) and the move step could silently overwrite existing blob content at an unrelated hash path with an empty object."
- 回收需要 mark-and-sweep GC + repack（"Identify fragmented packs (>30% wasted space)"）
- Merkle/HAMT 结构共享："Only nodes along the path of a change need to be rewritten… two snapshots that differ in only 10 files share 99%+ of their tree nodes"

**对照证据**：AIVN 的 `media-cache/tts/<hash>.mp3` 已经采用内容寻址（`apps/server/src/store.ts` 注释："按内容寻址可重建"；`apps/server/src/tts.ts`："hash 命中直接复用；写入临时文件后 rename，防并发交错损坏"）。这意味着 **(a) 归档里的 TTS 天然可去重；(b) 归档 manifest 可以直接用 hash 做完整性校验（无需新机制）；(c) "可重建"意味着归档**必须**带 TTS，否则接收方在无 API 环境下无路可退。

### 10.4 分支 DAG + 头指针 + 崩溃安全的追加日志

（[strongdm/cxdb NEW_SPEC.md](https://github.com/strongdm/cxdb/blob/main/NEW_SPEC.md)、[docs/architecture.md](https://github.com/strongdm/cxdb/blob/main/docs/architecture.md)）

这套设计与 AIVN 的谱系（`LineageEvent` 的 `parentId` 树 + 快照 + blob 存储）高度同构，其中的工程决策可直接借鉴：

- "Immutable Turn nodes form a **parent-pointer DAG** (a tree per branch/head). All payload bytes are stored in a **content-addressed blob store** keyed by hash. **Branching is constant time**: create a new head pointer referencing an existing turn."
- 文件布局：`turns.log`（追加、定长记录）+ `turns.idx`（TurnID → offset）+ `heads.tbl`（ContextID → head）+ `blobs.pack` + `blobs.idx`
- 写入顺序（crash-safe）："1) Ensure blob exists… 2) Append `TurnRecordV1` to `turns.log`. 3) Update `turns.idx`. 4) Update `heads.tbl`"
- 崩溃恢复："Partial last record in `turns.log` (**truncate to last valid crc**). Head table corruption (rebuild from head WAL or last-known snapshot)."
- 记录自带 `crc32`，追加型日志的恢复策略是"扫到最后一个 CRC 有效处截断"
- 分页语义："Prefer cursor-style paging: `GET_LAST(context, limit) -> turns[], next_cursor_turn_id`"
- 可选 overlay patch（用于删改/合规）：`Patch { target_turn_id, new_payload_hash, flags, seq }`，支持 as-of 语义

**对照证据**：AIVN 的 `lineage.jsonl` 是"append-only + parentId 构成分支树"，与 cxdb 的 Turn DAG 同构；但 AIVN 目前**没有**记录级 CRC/长度前缀，因此"文件尾被截断"时的恢复策略只能是逐行 `JSON.parse` 失败即丢弃尾部。这在 JSONL 上是可行的（JSONL 的每行独立性天然给了这个能力），但是一个应当被**显式写进导入校验**的性质（"最后一行不完整 → 截断到最后一个可解析行"，而不是整体报错）。

### 10.5 存档/归档格式的版本化与迁移（社区共识集中于此）

（[Game Dev: Save Systems & Persistence](https://andrewaltimit.github.io/Documentation/docs/gamedev/save-systems.html)、[Socratopia: Save-System Versioning and Migration](https://www.socratopia.app/library/game-code-anatomy-en/chapter-28)、[Beasty Save System](https://bauflowbeasty.github.io/docs/beasty-save-system/guides/versioning-and-migrations/)、[TinySave](https://www.peekgames.dev/docs/tinysave/migrations)、[egmatic](https://egmatic.com/blog/save-game-progress-save-system-guide)）

- **文件头模式（可直接照抄的字段清单）**：
  ```
  struct SaveHeader {
      char     magic[4];          // "ASAV" -- reject anything else immediately
      uint16_t format;             // 0 = JSON, 1 = MessagePack, 2 = custom binary
      uint16_t schema_version;     // drives the migration chain
      uint32_t flags;              // e.g. bit 0 = zstd-compressed payload
      uint32_t payload_len;
      uint32_t checksum;           // CRC32C or xxHash32 of the payload
      uint64_t timestamp_ms;
      uint64_t generation;         // monotonic save counter
  };
  ```
  "`magic` rejects foreign files, `schema_version` routes to the migration chain, `checksum` detects corruption before any payload is decoded, and `generation` feeds cloud conflict detection."
- **迁移链**：增量 v1→v2→v3…，"Migrations are **append-only**: a `v3 -> v4` step is run by every player who ever had a v3 save, so editing it after release risks corrupting saves… **Add new steps; never rewrite old ones.**"
- **迁移必须在数据层**，不能在内存对象层："each migrator must operate on the raw save data (the dict/JSON shape), not on deserialized in-memory objects whose class may no longer exist"
- **schema 变更规则表**：加字段→给默认值；删字段→停止读取，**永不复用其 tag/key**；改字段含义→新版本号 + 显式转换
- **对更新版存档显式拒绝**："If `v > CurrentVersion` throw `SaveTooNewException(v)` — never guess at a newer schema."；错误消息范例："This save was made with a newer version of the game."
- **回滚/损坏处理**："Never delete a file that failed to load — keep it so it can be attached to a support ticket"；"fall back to `.bak` or an older slot on failure"
- **测试纪律**："Keep real save files from every shipped version… in the repository, and load each through the current migration chain in CI."（golden-save corpus）
- **原子写**："Write the new save data to a temporary file. Rename the temporary file over the real one."（AIVN 的 TTS 缓存写入已经用了这个模式）
- 序列化格式对照（同一篇的表格，对 JSON 的定位）：JSON "Human-readable: Yes / Size: Large / Schema evolution: Easy (named, optional fields) / Excellent for debugging and tooling; no native binary blobs"
- 安全警示（对"导入别人的归档"直接相关）："Treat every save as hostile input… Never use a serializer that can instantiate arbitrary types from the stream — .NET `BinaryFormatter`…, Python `pickle`, Java native serialization, Godot `get_var(allow_objects = true)`"

### 10.6 确定性回放（另一条实现路线）

- Photon Quantum（[Replays 文档](https://dev-doc.photonengine.com/quantum/current/manual/replay)）：记录输入（`RecordingFlags.Input`）与 checksum（`RecordingFlags.Checksums`）；回放要求"the same libraries, game assets, configurations and user input"；`DeterministicGameMode.Replay`；可选校验 checksum；导出可含/不含 asset db（"which should be omitted in production environments where file size is an issue"）
- nape-js replay（[Replay Guide](https://napejs.org/guides/replay-guide/)）：`Recorder` 存 initial snapshot + 每帧 input + 可选 keyframe（`keyframeEvery: 60`）；"Binary format is versioned (magic `RPLY`, version `u16`); **decoding throws on mismatch**"；明列 5 条确定性前提（同平台、固定 dt、纯 `applyInput`、引擎版本匹配）
- Feather（[Session Replay](https://kyonru.github.io/feather/session-replay/)）：输入 + 开发者自选状态快照（sparse delta + periodic keyframe）；"Feather orchestrates inputs and developer-selected checkpoints; **your game defines what 'same starting point' means**"；seeded 内容应存 seed 而不是逐个对象
- Unity InputRecorder / UnityReplaySystem：输入日志 + 固定步长重放

**对 AIVN 的相关性**：AIVN 的"回放"**不需要确定性模拟**——因为 `lineage.jsonl` 记录的是已经物化好的演出事件（`say`/`scene`/`actor`/`sfx`/`stop`…），回放只是把事件按 seq 重发，不重新调用 LLM、不重新跑随机数。这是比"确定性重演"简单得多的路线（也就没有那些"同平台/固定 dt/纯函数"的约束）。但**续演**（导入后由别的实例继续生成）才真正需要身份/版本契约：新的生成必须明确"我基于是哪个节点、哪份快照、哪个格式版本"。

---

## 11. 提案与仓库现状的对照（代码事实，供实现参考）

以下均为本 worktree 内只读检查所得，用于把外部结论落到具体文件：

- **已存在制作包导出**：`apps/server/src/store.ts` 的 `exportZip(playId)` 明确排除 `["session.json", "lineage.jsonl", "meta.json", "media-cache", "node_modules"]`，注释为"剧目包导出（zip：play.json + assets + 剧目级记忆，不含存档/媒体缓存等运行时）"，压缩参数 `zipSync(files, { level: 6 })`。→ 提案的 `exportPlayed` 是**并列新增**，不是改造既有语义。
- **导入已有路径与防穿透**：同文件内已有 `importPackage` 的落盘逻辑，含 Zip Slip 防护（`if (dest !== targetAbs && !dest.startsWith(targetAbs + sep)) throw new Error("剧目包含非法路径")`）。→ 提案"升级为识别两种输入格式"是在这条已有护栏上扩展；**HTML 分支同样必须走这条路径校验**（不要因为"来源是 HTML"就省掉）。
- **谱系是唯一真相源**：`packages/core/src/lineage/model.ts` 首行注释；`LineageEvent` 字段：`id / parentId / kind / turn / text / payload / createdAt / editTargetId? / cgTargetId?`；`LineageEventKind` 枚举含 `root scene actor fx say narrate thought title sfx preload cg stop prompt beat_end edit fork`。
- **快照四要素**：`LineageSnapshot { engine, stateFiles, compaction?, nsfw }`；注释："跳转/分岔/删除/续演都靠它把现场装回来"。
- **重放层已存在**：`lineageToEvents(chain)`（"谱系 → 客户端事件流（只读物化层）"）、`lineageToBeats(...)`（服务端 rebuild）。注释指出 `preload` 不重放（"生成不因回放重来"），且 `seq` 沿用原值而非重编号。
- **素材引用藏在事件 payload 的 `attrs`**：`orchestrator.ts` 里 `attrs: { bg, bgm, ambient, transition, bgm_volume, ambient_volume }`、`actor` 事件带 `pos/variant`、`cg` 通过 `cgTargetId` 挂在目标行上（`recordCg`）。→ **"仅打包谱系引用到的素材"的剪枝必须覆盖 `cg` 的旁注引用**（它不是树上的节点，只挂在目标旁边，容易漏）。
- **引擎产物不动**：`apps/server/src/playFiles.ts` 的 `GENERATED_PREFIXES = ["memory/archive/"]`，注释说明"它跟分支走（按 pathSet 过滤）…所以看得见、改不动"。→ 归档里 `memory/archive/**` 属于运行时派生物，是否随归档走需要单独决策（它由引擎写、与分支相关、可重建）。
- **TTS 已内容寻址**：`store.ts`："TTS 音频缓存目录（media-cache/tts，按内容寻址可重建，运行时不进 git）"；`http.ts` 的静态路由为 `/plays/:id/media/tts/<hash>.mp3`；`tts.ts`："写入临时文件后 rename，防并发交错损坏"。
- **前端素材 URL 目前由服务端提供**：`apps/web/src/api.ts` 的 `assetUrl(playId, dir, name)` → 离线播放器必须替换这一层（提案的 `assetUrl` 映射表思路与之对应）。
- **`fflate` 已是 server 依赖**：`apps/server/package.json` → `"fflate": "^0.8.3"`。
- **前端产物目前未构建**：`apps/web/dist/assets` 在本 worktree 不存在（未跑 `pnpm -r build`），因此"播放器 bundle 实际体积"待构建后实测。

---

## 12. 逐条判定：成立 / 夸大 / 错误（汇总）

### 12.1 成立
1. 单文件 HTML 在桌面浏览器双击可用（Bun 官方定位、vite-plugin-singlefile 官方定位）
2. `<script type="application/octet-stream">` 作为数据块合规且被规范明确鼓励（HTML 规范 §4.12.1）
3. Base64 载荷天然不含 `<`/`>`，免疫 `</script`、`<script`、`<!--` 拼接问题
4. 内嵌 ZIP 优于裸 Data URI（SingleFile 作者原话；RFC 2397 自身的"只适合短值"警告）
5. `fflate` 体积（8KB min / 3KB inflate-only）与它是项目既有依赖
6. 离线回放不需要 WebSocket：`lineageToEvents()` 已是只读物化层
7. `lineage.jsonl` 作为 append-only 事件日志，符合 JSON Lines 规范与事件溯源惯例
8. 归档需要 Zip Slip 防护：已有的 `importPackage` 路径校验是正确的模式（参考 [Snyk Zip Slip](https://security.snyk.io/research/zip-slip-vulnerability/)，CodeQL 的推荐修法是"校验规范化后的全路径以目标目录为前缀"，Android 官方建议还加上"目标目录必须为空"）
9. 单 HTML 在 itch.io 上可**直接上传，无需 ZIP**（唯一文件 ≤ 200MB 单文件限制、总量 500MB）
10. 三分之一体积税（base64）与"单文件无缓存粒度"是被多方复述的既知代价

### 12.2 夸大
1. **"资源经 Deflate 压缩后再 Base64，通常接近甚至小于原始未压缩体积"** —— 对已压缩媒体不成立（WACZ 强制 STORE 就是这条的证据）；净效果 ≈ +33%
2. **"gzip 后约 180KB"** —— `file://` 下没有传输压缩；且 react-dom 单包就远超此数（492.50kB 裸 / 87.86kB gzip）
3. **"现代浏览器完全能加载 30MB 的单 HTML"** —— 无可靠外部证据支持"30MB 单文本节点"这一具体量级；反面证据是移动 WebView 在 1.1 千万字符（≈11MB 文本）即卡死
4. **"5MB ~ 15MB…在 PC 和主流移动端…秒开"** —— 桌面成立；移动端受 blob 内存额度（Android = RAM/100）与解析成本限制，未被量化验证
5. **"完整分支体验 + 未探索分支打徽章"** —— 逻辑可行，但"未演出的分支"在离线包里根本不存在的判断需要**谱系层**支持（`stop` 事件带 `stopOptions`），而不是运行时猜测；实现的复杂度被低估（提案把它写成一段 UI 描述）
6. **TTS 每句 ~25KB** —— 属合理量级但未经本仓库实测（取决于编码码率与句长），不应作为体积承诺

### 12.3 错误 / 需要改写
1. **"双击即可在浏览器中获得完整声画"** —— iOS 不可能；Android 半可行；必须改为"打开后点一次开始"
2. **"Automated：无需用户手势即可播放"** —— 三个引擎的 autoplay policy 都要求手势；iOS 甚至 per-element
3. **research.md §4.1 标题"Polyglot Archive"** —— 实际结构不是 polyglot；该命名会误导实现（若真做 polyglot，导入侧两条识别逻辑都要重写）
4. **依靠 `PK\x03\x04` 魔法头 + 正则提取 Base64 双分支** —— 只对"纯 HTML + Base64"成立；与 polyglot 互斥；且正则匹配 Base64 需要容忍换行/空白
5. **`fflate.unzipSync` 作为唯一解压路径** —— 会在启动时冻结主线程；async 路径依赖 Worker，而 `file://` + `blob:` Worker 的可用性无规范保证（blob URL 在 opaque origin 下 origin 为 implementation-defined）
6. **`session.json` 与 `lineage.jsonl` 并列打包** —— 违反"事件日志是唯一真相源"（仓库自己的注释与事件溯源惯例都是这么定的）
7. **Web `file://` 下依赖任何"网络/服务"能力** —— Service Worker 被直接拒绝；`fetch` 自身文件在 Chromium 一律失败；SQLite-WASM 官方明说不支持 `file://`
8. **移动端/微信分享路径** —— 微信不能直接跑本地 HTML；`wx.openDocument` 白名单无 html；Gmail 25MB 且 `.html` 可被管理员拦

---

## 13. 可操作建议

### P0（阻塞性：会让"零 API 离线回放"目标落空）
1. **加"开始"入口**：页面加载后显示标题卡 + 一个显式的播放/开始按钮；在该按钮的 `click` 处理里 `AudioContext.resume()` 并逐元素解锁（iOS 需要 `touchend`/`mouseup`/`click`，`pointerdown` 不算）。不要假设自动开演可行。
2. **`file://` 能力探测 + 同步回退**：启动时探测 `fetch("")`、`new Worker(blobURL)`、`AudioContext.state`；解压路径必须有 `unzipSync` 回退。任何依赖 Worker/OPFS/ServiceWorker 的设计都要有降级路径。
3. **TTS Blob 必须带 MIME**：`new Blob([u8], { type: "audio/mpeg" })`（iOS 不加就不播）；台词推进不要只挂 `ended`（Safari 15 的 blob > 64KB 缺陷）。
4. **把"分发形态"与"可编辑形态"分开定义**，并明确对外承诺：
   - 桌面双击 → 可用
   - 移动端 → 需托管成 URL，或发 ZIP 让人自己解压后用第三方浏览器，或导入 Stage AI
   - 微信 → 只走 URL 或 ZIP，不要承诺"点开就玩"
5. **归档格式加版本号与自描述头部**（magic + format + schema_version + checksum），导入侧对"更新版本"显式拒绝而非猜测。参照游戏存档社区共识与 ink 的 `kInkSaveStateVersion / kMinCompatibleLoadVersion`。
6. **导入 HTML 分支必须复用已有的 Zip Slip 防护**，不要因为输入是 HTML 而绕开 `importPackage` 的路径校验；并且显式拒绝绝对路径、`..`、符号链接语义、以及大小写别名冲突（仓库已有"按小写比"处理 Windows/macOS 的既有做法）。

### P1（决策性：影响体积与体验的量级）
7. **明确"剪枝"的引用来源清单**：至少覆盖 `scene.attrs.bg`、`actor.attrs.pos/variant`、`cg.cgTargetId` 关联的图、`sfx`、`bgm/ambient`、`preload`（虽然不重放，但仍是被引用过的资源）。建议用"白名单枚举 + 用例兜"的方式而不是"扫 attrs 里所有字符串"。
8. **对已压缩媒体使用 `level: 0`（STORE）**，只对文本类（`lineage.jsonl`、`session.json`、`play.json`、`characters/*.md`、`memory/**`、`assets/manifest.json`）用 Deflate。参照 WACZ 的硬性规定与 fflate 的 per-file 压缩选项。
9. **解码走 `Uint8Array.fromBase64` 优先 + `atob` 分块回退**，整段放 Worker；Blob URL 分批创建、切场即 `revokeObjectURL`（并且按 pdf.js 的教训，同时移除 `src` 属性）。
10. **重新考虑"播放器 JS 内联还是放进 ZIP"**：内联 = 启动最快但文件大且无 source map；放进 ZIP = 文件小但启动多一步解压 + eval，且不可调试（TiddlyWiki 社区明确抱怨过这条路）。建议：**内联**，并把"180KB gzip"改写为"实测的裸文本体积"。
11. **决定是否转向真 polyglot**。若做：
    - 收益 = 用户不装 AIVN 也能用 `unzip` 取原素材（SingleFile 的产品化证据）
    - 代价 = windows-1252 页面编码 + consolidation data + 64KB 注释上限 + `-->` 冲突 + quirks mode（若走 PNG 变体）+ macOS Archive Utility bug + 导入侧识别逻辑重写
    - 取舍建议的判据：如果"接收方能自己提取素材"不重要（因为目标用户本来就要么只播放、要么导入 AIVN），**保持 Base64 纯 HTML 更简单且更稳**，但应把文档里的"Polyglot"一词删掉，避免后续实现者按 polyglot 写代码
12. **归档只保证 `lineage.jsonl` 完整可重放**；`session.json`/快照标记为"可选加速件"，并验证"删掉它也能重建"。这样离线播放器与导入续演共用一条真相源。
13. **给出体积的实测口径**：在 CI 或构建脚本里对真实剧目导出并记录（归档字节数、HTML 字节数、播放器 JS 裸/gzip 两值），把提案里的估算表替换成实测表（避免"180KB"这类口径继续传播）。

### P2（工程化：让这件事长期可维护）
14. **golden-archive 语料**：像游戏存档社区建议的那样，把每个格式版本的样例归档（含短篇/中长篇/多分支/含 TTS/不含 TTS）留在仓库并让 CI 跑"导入 → 重放 → 再导出"往返测试。
15. **给 JSONL 加解析健壮性**：逐行 parse、跳过空行、**剥掉 BOM**、最后一行不完整则截断到最后一个可解析行（参照 cxdb 的"truncate to last valid crc"精神，只是这里用 JSON 可解析性作校验）。
16. **素材 manifest 记录 hash + size**：直接复用 TTS 已有的内容寻址习惯，导出时把每个资源的 `sha256` 写进 `assets/manifest.json`，导入时校验（WACZ 的 `datapackage.json` 就是这么做的，收益是"完整性校验成为寻址方案的副产品"）。
17. **为"回灌续演"定义增量语义**：不要只做"全量覆盖/改名副本"。git bundle 的 `prerequisites` 模型（references + 需要接收方已有的对象）是现成的范式——AIVN 可以定义"归档 A 基于节点 N，接收方若已有 N 则可增量续演"。这也是"分支树上两边各自演过"时的合并依据。
18. **避免把凭据写进归档**：`settings.json` 属于数据目录根（不进 git 且不在 `exportZip` 的范围），确认导出白名单不会把任何 API key/代理配置卷进去。

---

## 14. 待实测清单（外部资料无法替代的本机验证）

1. 在 Chrome / Edge / Firefox / Safari 上，从 `file://` 打开一个含 15MB Base64 data block 的 HTML：解析耗时、`textContent` 读取耗时、`atob`/`fromBase64` 耗时、峰值内存
2. 同样文件在 Chrome for Android 与 iOS（如可得）：能否打开、是否卡死、blob 是否被 paging
3. `new Worker(URL.createObjectURL(blob))` 在 `file://` 下各引擎是否成功（决定 `fflate` async 路径）
4. `<audio>` 用 `blob:` URL 在 iOS 的行为（含 Blob 无 type / 有 type 两种），以及 `ended` 是否触发
5. 构建后的 `apps/web` 舞台 bundle 真实裸体积与 gzip 体积（当前 `apps/web/dist` 不存在，无法估算）
6. 一份真实长篇剧目（数百句 + 多首 BGM + 全量 TTS）的：`lineage.jsonl` 体积、被引用素材集合、归档体积、单 HTML 体积
7. 导出的 HTML 在微信内置浏览器通过 URL 打开时，JS/CSS/音频是否被限制
8. `pnpm` 构建后，`standalone.tsx` 能否在不引入 Node polyfill 的前提下跑通（React 19 + `packages/stage`）

---

## 15. 来源清单

**单文件 Web App / 打包**
- https://bun.com/docs/bundler/standalone-html
- https://bunjs.run/bun-compile-browser
- https://github.com/richardtallent/vite-plugin-singlefile/blob/main/README.md
- https://www.npmjs.com/package/esbuild-single-html
- https://transformpipe.com/blog/self-contained-html-explained
- https://vibed.city/blog/single-file-web-app
- https://nos-workspace.com/learn/single-html-file-apps
- https://mk0r.com/t/weekend-project-single-file-html
- https://talk.tiddlywiki.org/t/suggestion-adding-gzip-support-to-import-export-from-and-to-tiddlywiki/8833
- https://github.com/TiddlyWiki/TiddlyWiki5/issues/4262
- https://github.com/TiddlyWiki/TiddlyWiki5/discussions/7920
- https://groups.google.com/g/tiddlywiki/c/Ra1lJ6mKbn0
- https://talk.tiddlywiki.org/t/plugin-compression/10215

**HTML 规范与 polyglot**
- https://html.spec.whatwg.org/multipage/scripting.html
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script
- https://gildas-lormeau.github.io/Polyglot-HTML-ZIP-PNG/SUMMARY.html
- https://gildas-lormeau.github.io/Polyglot-HTML-ZIP-PNG/en-EN/
- https://github.com/gildas-lormeau/Polyglot-HTML-ZIP-PNG/
- https://github.com/gildas-lormeau/SingleFile/issues/1265
- https://github.com/gildas-lormeau/SingleFile/blob/04a75238564d97d1618b9024b290fc0ede75279a/faq.md
- https://deepwiki.com/gildas-lormeau/single-file-cli/3.3-output-configuration-options
- https://www.npmjs.com/package/single-file-cli
- https://www.aperisolve.com/wiki/techniques/files-archives

**体积 / base64 / 解码性能**
- https://github.com/facebook/react/pull/28966
- https://github.com/facebook/react/issues/27824
- https://bundlephobia.com/package/react-dom
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array/fromBase64
- https://www.measurethat.net/Benchmarks/ShowResult/624902
- https://dev.to/will_indie/why-your-browser-chokes-on-big-payloads-streamlining-base64-decode-tasks-without-freezing-chrome-378m
- https://www.base64decode.org/articles/base64-decoding-in-javascript-browser-a-complete-guide-0002/
- https://www.toolbox365.net/tutorials/base64-large-file-memory-and-data-url/
- https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/data
- https://greenbytes.de/tech/webdav/rfc2397.html
- https://http.dev/data-url
- https://github.com/101arrowz/fflate
- https://github.com/101arrowz/fflate/blob/master/CHANGELOG.md
- https://deepwiki.com/101arrowz/fflate/2.4-zip-archive-handling
- https://deepwiki.com/101arrowz/fflate/2.2-asynchronous-apis
- https://github.com/101arrowz/fflate/pull/230
- https://github.com/101arrowz/fflate/pull/270
- https://github.com/bybraveHQ/jszip2

**内存 / Blob / 数组上限**
- https://raw.githubusercontent.com/chromium/chromium/main/storage/browser/blob/README.md
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/storage/browser/blob/README.md
- https://chromium.googlesource.com/chromium/src/+/9105672b2e613a12e6faeb531ff28ceb99758098/storage/browser/blob/blob_storage_constants.h
- https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Invalid_array_length
- https://chromium.googlesource.com/v8/v8/+/44b299590083b888637c79fb5632806e607ab861/src/objects/js-array-buffer.h
- https://github.com/nodejs/node/issues/65534
- https://bugs.webkit.org/show_bug.cgi?id=1800266
- https://github.com/mozilla/pdf.js/pull/10644
- https://stackoverflow.com/questions/33667099/createobjecturl-memory-leak-in-chrome
- https://bugs.webkit.org/show_bug.cgi?id=31253
- https://johnkavanagh.co.uk/articles/object-url-lifecycle-creating-and-revoking/
- https://stackoverflow.com/questions/66645084/domparser-for-large-html
- https://devdiscipline.com/posts/opening-11-million-character-html-in-a-mobile-webview
- https://developer.chrome.com/docs/lighthouse/performance/dom-size
- https://web.dev/articles/dom-size-and-interactivity
- https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work

**file:// 与同源**
- https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin%5Fpolicy
- https://github.com/whatwg/html/issues/3099
- https://github.com/whatwg/fetch/issues/1195
- https://barker.codes/blog/javascript-modules-and-the-file-uri-scheme/
- https://v8.dev/features/modules
- https://github.com/whatwg/html/issues/8121
- https://github.com/mdn/content/blob/main/files/en-us/web/api/worker/worker/index.md
- https://github.com/whatwg/html/issues/1322
- https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register
- https://learn.microsoft.com/en-us/answers/questions/5512482/service-worker-registration-error-in-microsoft-edg
- https://stackoverflow.com/questions/55383132/why-are-some-file-fetch-calls-allowed-while-others-are-cross-origin-reques
- https://stackoverflow.com/questions/21408510/chrome-cant-load-web-worker
- https://stackoverflow.com/questions/58098143/why-are-cross-origin-workers-blocked-and-why-is-the-workaround-ok
- https://web.dev/articles/storage-for-the-web
- https://bugs.webkit.org/show_bug.cgi?id=154916

**音频 / 自动播放**
- https://developer.chrome.com/blog/autoplay
- https://www.chromium.org/audio-video/autoplay/
- https://developer.chrome.com/blog/web-audio-autoplay
- https://groups.google.com/a/chromium.org/g/blink-dev/c/5Y1BqbGauEs/m/ddkN1jgECgAJ
- https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices
- https://bugs.webkit.org/show_bug.cgi?id=132691
- https://bugs.webkit.org/show_bug.cgi?id=198015
- https://bugs.webkit.org/show_bug.cgi?id=245056
- https://www2.webkit.org/show_bug.cgi?id=238113
- https://stackoverflow.com/questions/13231915/loading-audio-via-a-blob-url-fails-in-safari
- https://www.flowy.fm/learn/ios-safari-audio-unlock-trick

**分发渠道**
- https://discussions.apple.com/thread/256102223
- https://stackoverflow.com/questions/67581426/how-to-open-a-local-html-file-in-safari-on-an-ipad
- https://www.prestapps.com/pagira/blog/open-html-file-on-iphone
- https://android.stackexchange.com/questions/220400/local-files-revisited-opening-local-html-files-file-path-to-file-in-chrome
- https://android.stackexchange.com/questions/256263/html-does-not-find-local-links-and-local-images-chrome-on-android-10
- https://github.com/mozilla-mobile/fenix/issues/7546
- https://developers.weixin.qq.com/community/develop/doc/0006acf61648906fc3c793a465b800
- https://developers.weixin.qq.com/community/develop/doc/0002c098e446d8d0b4a7bb21756400
- https://developers.weixin.qq.com/miniprogram/dev/api/file/wx.openDocument.html
- https://developers.weixin.qq.com/miniprogram/dev/framework/material/support_material
- https://www.kd.cn/ask/22703.html
- https://support.google.com/mail/answer/6584?hl=en-uk
- https://support.google.com/mail/answer/6590
- https://support.google.com/a/answer/2364580?hl=en
- https://www.androidauthority.com/gmail-file-size-limit-3644154/
- https://www.edugeek.net/forums/topic/225619-google-workspace-blocking-htm-html-mhtml-attachments-do-i-need-the-full-stop/
- https://itch.io/docs/creators/html5
- https://itch.io/t/3964421/1000-files-limit-on-browsergame
- https://itch.io/t/4233566/game-upload-size-problem
- https://github.com/itchio/itch.io/issues/870

**视觉小说 / IF 先例**
- https://www.twinery.org/reference/en/story-library/exporting.html
- https://twinery.org/archive/questions/43696/editing-across-multiple-devices.html
- https://twinery.org/archive/questions/48804/game-saved-as-html-file-folder-now-cant-be-imported.html
- https://github.com/iftechfoundation/twine-specs
- https://github.com/iftechfoundation/twine-specs/blob/master/twine-2-archive-spec.md
- https://github.com/iftechfoundation/twine-specs/blob/master/twee-3-specification.md
- https://github.com/iftechfoundation/twine-specs/blob/master/twine-2-jsonoutput-doc.md
- https://github.com/iftechfoundation/twine-specs/blob/master/twine-2-storyformats-spec.md
- https://twinery.org/cookbook/terms/terms_twee.html
- https://twinery.org/cookbook/savinggames/sugarcube/sugarcube_savinggames.html
- http://www.motoslave.net/sugarcube/2/releases.php
- https://intfiction.org/t/unable-to-save-games/52022
- https://intfiction.org/t/sugarcube-2-29-advice-on-best-practices-calculate-or-store/43401
- https://naughty.games/guides/twine-publish
- https://github.com/inkle/ink/blob/master/Documentation/RunningYourInk.md
- https://github.com/inkle/ink/blob/master/Documentation/ink_JSON_runtime_format.md
- https://github.com/inkle/ink/blob/master/ink-engine-runtime/StoryState.cs
- https://github.com/inkle/inkjs
- https://github.com/y-lohse/inkjs/blob/master/README.md
- https://renpy.org/doc/html/web.html
- https://www.renpy.org/doc/html/build.html
- https://www.renpy.org/doc/html/save_load_rollback.html
- https://github.com/renpy/renpy/blob/9d275e9349909c53c7317035b5d52ef331d823fb/renpy/savetoken.py
- https://github.com/renpy/renpyweb/blob/master/perfs.md
- https://itch.io/t/2109287/too-many-files-publishing-renpy-vn-to-play-in-browser
- https://arghbulous.itch.io/the-muzeum/devlog/1309260/renpy-web-build-tips-to-stay-under-the-1000-files-limit-other-optimisations
- https://32blog.com/en/renpy/renpy-distribution-guide
- https://www.eblong.com/zarf/blorb/
- https://github.com/iftechfoundation/ifarchive-if-specs/blob/main/Blorb-Spec.md
- https://www.eblong.com/zarf/blorb/blorb.html

**归档格式规范**
- https://www.w3.org/TR/epub/
- https://w3c.github.io/epub-specs/epub33/core/
- https://w3c.github.io/epub-specs/epub34/authoring/
- https://www.w3.org/publishing/epub32/epub-ocf.html
- https://idpf.org/epub/31/spec/epub-spec.html
- https://specs.webrecorder.net/wacz/1.1.1/
- https://github.com/webrecorder/specs/blob/main/wacz/1.2.0/index.md
- https://github.com/webrecorder/wacz-format
- https://github.com/webrecorder/py-wacz
- http://www.loc.gov/preservation/digital/formats/fdd/fdd000586.shtml
- https://webrecorder.net/blog/2021-01-18-wacz-format-1-0/
- https://github.com/openzim/libzim/
- https://en.wikipedia.org/wiki/ZIM_(file_format)
- https://developer.chrome.com/docs/web-platform/web-bundles
- https://groups.google.com/a/chromium.org/g/blink-dev/c/VS9UgOC7Wqc
- https://github.com/chromium/chromium/commit/98d9c97a6ebcba1f744bd8850a85ffbbdf258834
- https://wicg.github.io/webpackage/subresource-loading.html
- https://git-scm.com/docs/bundle-format
- https://git-scm.com/docs/git-bundle
- https://git-scm.com/book/en/v2/Git-Tools-Bundling
- https://www.kernel.org/pub/software/scm/git/docs/gitformat-bundle.html
- https://github.com/git/git/blob/master/Documentation/git-bundle.adoc
- https://sqlite.org/wasm/doc/trunk/persistence.md
- https://sqlite.org/wasm/doc/trunk/index.md
- https://sqlite.org/wasm/doc/tip/cookbook.md
- https://sqlite.org/wasm/doc/c1244b92ce/building.md
- https://github.com/sqlite/sqlite-wasm/
- https://developer.chrome.com/blog/sqlite-wasm-in-the-browser-backed-by-the-origin-private-file-system

**事件日志 / 内容寻址 / 存档版本化**
- https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing
- https://github.com/handbook-academy/hld-handbook/blob/main/content/part-5-architecture-patterns/03-event-sourcing.md
- https://jsonlines.org/
- https://github.com/ndjson/ndjson-spec/blob/master/README.md
- https://jsonlkit.com/jsonl-specification
- https://jsonlkit.com/jsonl-faq
- https://en.wikipedia.org/wiki/Line_Delimited_JSON
- https://gitlab.com/gitlab-org/ops/artifact-registry/-/blob/main/docs/adr/008_content_addressable_storage.md
- https://docs.cloudstic.com/concepts/content-addressing
- https://github.com/strongdm/cxdb/blob/main/NEW_SPEC.md
- https://github.com/strongdm/cxdb/blob/main/docs/architecture.md
- https://andrewaltimit.github.io/Documentation/docs/gamedev/save-systems.html
- https://www.socratopia.app/library/game-code-anatomy-en/chapter-28
- https://bauflowbeasty.github.io/docs/beasty-save-system/guides/versioning-and-migrations/
- https://www.peekgames.dev/docs/tinysave/migrations
- https://egmatic.com/blog/save-game-progress-save-system-guide
- https://arawn-software-publishing.gitbook.io/arawn/basics/save-data-versioning
- https://dev-doc.photonengine.com/quantum/current/manual/replay
- https://napejs.org/guides/replay-guide/
- https://kyonru.github.io/feather/session-replay/

**安全**
- https://security.snyk.io/research/zip-slip-vulnerability/
- https://snyk.io/blog/zip-slip-vulnerability/
- https://snyk.io/blog/zip-slip-vulnerability-cheat-sheet/
- https://github.com/snyk/zip-slip-vulnerability
- https://codeql.github.com/codeql-query-help/java/java-zipslip/
- https://developer.android.com/privacy-and-security/risks/zip-path-traversal

**本仓库（对照事实）**
- `packages/core/src/lineage/model.ts`、`packages/core/src/lineage/replay.ts`
- `apps/server/src/store.ts`、`apps/server/src/rebuild.ts`、`apps/server/src/tts.ts`、`apps/server/src/http.ts`、`apps/server/src/playFiles.ts`、`apps/server/src/orchestrator.ts`
- `apps/web/src/api.ts`、`apps/server/package.json`
