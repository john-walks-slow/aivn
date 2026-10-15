# AIVN 已演剧目导出 / 零 API 回放 / 接续演出交叉核查

核查日期：2026-10-13  
核查范围：`261013-play-export-replay.research.md`、`261013-play-export-replay.plan.md`，以及 `packages/core`、`packages/stage`、`apps/server`、`apps/web` 的相关实现。  
结论性质：中立的设计复核；以下内容区分“技术上可行”和“适合作为产品默认”。

## Must Reconsider

- **不要再把“单 HTML 双击即可获得完整声画、随处分享”作为无条件承诺。**
  - 桌面端把单 HTML 作为离线回放载体是可行的；但 `file://` 在不同浏览器的同源、`fetch`、模块加载、Worker、存储和媒体行为并不统一。Chrome/Edge 下页面不能可靠地 `fetch` 自身文件；iOS/iPadOS 的文件预览路径通常不执行 JavaScript；微信内置 WebView 不能把聊天中的本地 HTML 当成可运行网页。浏览器的音频自动播放策略还要求用户手势，iOS 对音频元素的解锁更严格。
  - 因此准确的产品承诺应改为：**桌面：打开后点击“开始”即可离线回放；移动端：优先通过 HTTPS 托管回放页，或导入 Stage AI；微信：优先分享托管 URL，不承诺本地 HTML 直接运行。**
  - 参考：[Chrome autoplay](https://developer.chrome.com/blog/autoplay)、[MDN autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)、[WHATWG file URL issue](https://github.com/whatwg/html/issues/3099)、[Ren'Py Web 文档](https://renpy.org/doc/html/web.html)。

- **“内嵌 Zip + 前端解包”适合作为一种分发实现，但还不能被定性为唯一或最 canonical 的底层格式。**
  - 更稳健的分层是：
    1. **AIVN Played Archive（标准 Zip）**：面向导入、备份、继续演出，是唯一的可续演归档真相载体；
    2. **Standalone Replay HTML**：由 Played Archive 物化出的观赏产物，适合桌面分享和短中篇；
    3. **Hosted/Web Package（`index.html` + 资源目录或静态站）**：面向移动端、微信、itch.io 和长篇媒体。
  - Twine 的实践也是运行 HTML 与编辑/归档格式并存；ink/Inky 区分可播放 Web 导出、编译故事数据和可序列化状态；Ren'Py Web 则明确采用目录/Zip 发行，并要求 HTTP(S) 服务器。AIVN 应借鉴这种“同一数据集，多种交付形态”，而不是让单 HTML 同时承担编辑、导入、移动分发和长篇媒体承载的全部职责。
  - 参考：[Twine 导出](https://www.twinery.org/reference/en/story-library/exporting.html)、[inkle Web 导出](https://www.inklestudios.com/ink/web-tutorial/)、[Ren'Py Web](https://renpy.org/doc/html/web.html)。

- **研究稿中的“Polyglot Archive”命名与实际结构不一致，必须纠正。**
  - `script[type="application/octet-stream"]` 中放 Base64 Zip 是“纯 HTML + data block”，不是 HTML/ZIP polyglot。把文件改名为 `.zip` 后，操作系统不能直接解压，因为文件中没有裸 Zip 字节流。
  - 真正的 HTML/ZIP polyglot 是 HTML 字节与 Zip 字节共存，通常利用 Zip 允许前置数据、中央目录在尾部的特性。它可以同时被浏览器打开和 Zip 工具读取，但要处理 `file://` 下无法 `fetch` 自身文件、HTML 注释中的 `-->`、编码归一化、64KB 尾部限制、部分归档工具兼容性等问题。
  - 结论：若“接收方不安装 AIVN 也能用 Zip 工具取出素材”不是核心需求，**保留 Base64 data block 更简单、更稳健，并删除 Polyglot 一词**。若确实要做 polyglot，则必须重新设计导入：不能只检查 `PK\x03\x04` 文件头，也不能只用正则提取 Base64；应由 Zip 解析器读取整个文件并支持非零起始偏移。
  - 参考：[HTML/ZIP/PNG polyglot 说明](https://gildas-lormeau.github.io/Polyglot-HTML-ZIP-PNG/SUMMARY.html)、[SingleFile FAQ](https://github.com/gildas-lormeau/SingleFile/blob/04a75238564d97d1618b9024b290fc0ede75279a/faq.md)、[HTML data block 规范](https://html.spec.whatwg.org/multipage/scripting.html)。

- **“`fflate` 可以按中央目录只解压当前媒体”需要更精确地表述。**
  - `fflate.unzipSync()` 和 `unzip()` 的高层结果并不是随机访问资源对象；`filter` 的作用主要是“跳过不需要解压的条目”，不是避免读取整个 Zip，也不是把嵌入式归档变成无需常驻内存的流式文件系统。
  - `fflate.Unzip` 可以按条目流式处理并不启动不需要的条目，但仍需扫描归档；在 Base64 已经被读成字符串、再解码成 `Uint8Array` 的单 HTML 中，完整归档字节通常仍会驻留内存。
  - 只有在“归档通过 HTTPS 提供、服务器支持 Range”时，类似 `zip.js` 的 `HttpRangeReader` 才能真正做到按中央目录和条目随机读取、按需下载。双击 `file://` 的单 HTML 没有这个网络 Range 前提。即使在内存中的 `Uint8Array` 上自行实现中央目录索引，也只能减少“解压输出”和“Blob 数量”，不能消除归档输入本身。
  - 结论：可实现的目标应是 **按需解压 + 有界缓存**，而不是“单 HTML 完全惰性随机访问”。
  - 参考：[fflate README](https://github.com/101arrowz/fflate)、[fflate unzip 文档](https://github.com/101arrowz/fflate/blob/master/docs/functions/unzipSync.md)、[zip.js ZipReader](https://gildas-lormeau.github.io/zip.js/api/classes/ZipReader.html)、[zip.js HttpRangeReader](https://gildas-lormeau.github.io/zip.js/api/classes/HttpRangeReader.html)。

- **必须撤回“启动时全量解压并为全部媒体建立 Blob URL 映射表”的默认设计。**
  - 启动阶段可能同时存在：HTML 中的 Base64 字符串、Base64 解码后的 Zip `Uint8Array`、解压后的媒体字节、Blob 对象、Blob URL，以及音频解码后的 `AudioBuffer`。峰值内存可能是归档媒体体积的数倍。
  - Chromium 对 Android Blob 存储设置了明显低于桌面的实现级限制，并明确警告“快速创建大量大 Blob”可能导致 renderer OOM。该数字不是跨浏览器 API 契约，但足以说明“15–40MB 文件在所有手机上秒开”的结论没有证据基础。
  - 推荐策略：启动只读取归档头、manifest、剧目元数据和当前路径/首屏所需资源；图片、BGM、环境音、SFX、TTS 分别按当前舞台状态按需解压；建立小型 LRU 资源缓存；切场和离开回看时撤销不用的 Blob URL，并清掉 `<img>`/`<audio>` 的 `src` 引用；不要预先把所有音频 decode 成 `AudioBuffer`。
  - 解压和 Base64 解码应优先放 Worker；但因 `file://` 下 Blob Worker 的跨浏览器行为没有稳定规范保证，必须保留主线程同步回退，并显示“正在准备资源”的状态，而不是假设始终无阻塞。
  - 参考：[Chromium Blob 存储说明](https://raw.githubusercontent.com/chromium/chromium/main/storage/browser/blob/README.md)、[MDN blob URL 生命周期](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob)、[SQLite/浏览器文件访问对照](https://developer.chrome.com/blog/sqlite-wasm-in-the-browser-backed-by-the-origin-private-file-system)。

- **音频映射不能只靠 `seq` 或重新计算 TTS 文件名。**
  - 当前服务器 TTS 文件名是 `sha1(voiceId + 翻译后的文本)`，而 `lineageToEvents()` 的台词文本是谱系中的原始文本；当设置了 `voiceLanguage` 时，离线端没有 API、翻译器和必要上下文，无法可靠推导服务器落盘的 TTS 文件名。
  - 当前 `audio_ready` 协议只发送 `{seq, url}`，并没有把“这一句对应的 `nodeId`、台词代次、最终 TTS 文本、媒体 hash、MIME”持久化为归档级索引。原地改写、分岔重写和同 `seq` 的不同分支会使 `seq` 单独作为媒体主键不够安全。
  - 归档必须新增显式的 `audio/manifest.json` 或等价索引，例如：`nodeId`、`seq`、`lineGeneration`、`voiceId`、`sourceTextHash`、`spokenTextHash`、`path`、`mime`、`bytes`。播放器按当前谱系节点查表，而不是猜文件名。若同一句在多个节点复用同一音频，可由 hash 去重，但索引仍要记录节点到媒体的映射。
  - 这也是“完整零 API 回放”成立的前提：没有映射和 TTS 文件，播放器只能回放文字，不能保证还原原声。

- **必须重新定义 `session.json`、`lineage.jsonl` 与“真相源”的关系。**
  - 仓库自身的 `LineageTree.export()` 返回的是 `{events, leafId, snapshots}`；`session.json` 还保存 `engine`、`scene`、`runtime`、`history` 等运行态。`lineageToEvents()` 接收的是当前分支投影后的 `LineageNodeView[]`，不是原始整棵树。
  - `lineage.jsonl` 是追加日志，但当前模型的删除会从内存树移除节点、清理快照和旁注；删除内容不会自动变成可重放的 tombstone。代码注释也明确指出：如果未来仅从 `lineage.jsonl` 重建，已删除内容可能复活。因此不能简单宣称“`lineage.jsonl` 独自包含了完整当前谱系”。
  - 建议二选一并写成格式契约：
    1. **当前实现更安全的路线**：`lineage.store.json`/`session.json.lineage` 是当前谱系真相，包含事件、`leafId`、快照和已剪枝后的事件集合；`lineage.jsonl` 仅作为可选审计/追加日志，不参与导入重建；或
    2. **真正事件溯源路线**：为删除、剪枝、快照替换等结构操作增加显式事件/tombstone，并规定导入从日志重建当前树。
  - 无论选哪条，归档中只能有一个“当前状态真相”，其他文件必须标注为派生、审计或加速件，并在导入时做一致性校验。
  - 参考：[事件溯源模式](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)、[JSON Lines 规范](https://jsonlines.org/)、仓库 [`packages/core/src/lineage/model.ts`](../../../packages/core/src/lineage/model.ts)。

- **“导入后任意 Stage AI 实例无缝继续”需要版本和身份契约，不能只靠改名副本。**
  - `LineageTree.nextId()` 使用本地时间和计数器，`seedNextId()` 只能避免当前进程内的部分计数冲突，不能提供跨归档、跨设备、跨实例的全局唯一身份。
  - 若导入总是生成全新的独立剧目目录，ID 碰撞不构成问题；但若未来要把归档合并进已有剧目、比较两个分支或做增量同步，就必须有稳定的作品身份、归档身份、父节点身份和格式版本。建议导出头包含：`magic`、`archiveFormatVersion`、`playIdentity`、`archiveId`、`baseHeadId/leafId`、`producerBuild`、`createdAt`、校验摘要。
  - 默认导入应采用“新建独立剧目 + 显式选择继续点”的语义，不要静默把外部归档合入本地同名剧目。合并应是单独的高级操作，并要求父节点存在性、格式版本、分支头和内容 hash 校验；必要时为外部节点加 namespace，而不是依赖本地时间 ID。
  - 继续生成所需的上下文不是只有 `session.json`：至少还包括 `play.json`、角色卡、剧目记忆、当前分支上的快照（`engine`、`stateFiles`、`compaction`、`nsfw`）、当前 `leafId`、停止点、运行态和可用素材清单。`history` 更适合保留审计/UI 历史，不能替代 `bodyFromTree()` 从谱系重建的 Agent 对话上下文。
  - 参考：[ink 状态版本化](https://github.com/inkle/ink/blob/master/ink-engine-runtime/StoryState.cs)、[Git bundle 的 prerequisites / references](https://git-scm.com/docs/git-bundle)、仓库 [`apps/server/src/orchestrator.ts`](../../../apps/server/src/orchestrator.ts)。

- **必须处理“全谱系回放”与“隐私/剧透”之间的冲突。**
  - 若导出包包含完整树，则接收方能看到已经演出或保留在树中的其他分支、重写文本、原始 Agent 历史、角色卡、记忆卡以及可能未公开的创作提示。若只导出当前路径，则不能再宣称可浏览完整路线树。
  - 建议在产品上明确区分：
    - **公开回放**：当前路径或作者选定分支，允许脱敏，不携带 Agent 内部思考和未公开分支；
    - **完整 Played Archive**：作者备份/跨设备继续演出，包含完整树、状态和素材；
    - **可分享继续包**：由作者明确勾选是否带角色卡、记忆、Agent 历史和生成台账。
  - 这不是过度设计，而是“零 API 分享”和“无缝继续生成”在数据边界上的直接矛盾。

- **导入安全风险不止 Zip Slip。**
  - 当前 `importZip()` 先对整个输入执行 `unzipSync()`，再做路径校验；恶意 Zip Bomb、极端条目数、超大解压尺寸可能在路径校验之前就消耗大量内存。导入 HTML 时如果先提取 Base64 再同步解压，同样会复现该风险。
  - 导入协议至少应在解压前限制：压缩包字节数、条目数、总解压字节数、单文件大小、压缩比、文件名长度、重复/大小写冲突、绝对路径与 `..`；对资源类型和 MIME 做白名单；拒绝归档内可执行脚本被播放器当作数据执行。现有 Zip Slip 防护应继续保留，但不能被视为完整的输入安全方案。
  - 参考：[Snyk Zip Slip](https://security.snyk.io/research/zip-slip-vulnerability)、[Android Zip Path Traversal](https://developer.android.com/privacy-and-security/risks/zip-path-traversal)。

- **“仅打包当前谱系实际引用的 assets”必须先定义“当前谱系”。**
  - 计划同时提供路线树浏览和已演出分支切换时，资源收集不能只扫 `leafId` 的祖先链；应扫描所有被保留、可从播放器访问的节点及旁注，包括 `scene` 的背景/BGM/环境音、`actor` 的主体与差分、`cg` 旁注、`sfx`、停止点所对应的分支内容，以及 `preload` 记录涉及的资源。
  - `preload` 在 `lineageToEvents()` 中不重放，但不等于它从归档引用集合中不存在；若实际演出期间该资源后来被 `scene`/`actor`/`cg` 使用，必须通过最终事件引用保留。资源剪枝应采用显式白名单，而不是扫描所有 `attrs` 字符串猜测。
  - 角色卡的 `sprite` 绑定、素材表中的名牌和 manifest 呈现声明也必须原样保留，不能根据角色 id 重新推断立绘目录。

## Suggestions

- **把 AIVN Played Archive 定为 canonical 规范，把单 HTML 定为 viewer build。**
  - 建议目录拓扑改为带格式头的形式：
    ```text
    archive.zip
    ├── aivn-archive.json          # magic / formatVersion / playIdentity / archiveId / heads / hashes
    ├── play.json
    ├── characters/**/*.md
    ├── memory/**
    ├── assets/**
    ├── assets/manifest.json
    ├── media/manifest.json        # 节点/seq/代次 → 音频文件
    ├── media/tts/**
    ├── lineage.store.json         # events + leafId + snapshots，当前树真相
    ├── lineage.jsonl              # 可选审计/追加日志，明确不是独立真相
    ├── runtime.json               # beat/read/stop/epoch 等可选恢复加速件
    └── history.json               # 可选 UI/审计历史，不作为 Agent 上下文唯一来源
    ```
  - 不要求一次性引入所有新文件；关键是先区分“真相、派生、索引、缓存”，避免未来再把 `session.json` 与 `lineage.jsonl` 的职责混在一起。

- **单 HTML 第一版建议继续用 Base64 data block，不要第一版就做真 polyglot。**
  - 形式可以保留：`<script id="aivn-archive" type="application/octet-stream">BASE64</script>`，但导入侧使用 HTML parser/固定 id 读取 `textContent`，不要依赖宽松正则。
  - 归档内容使用标准 Zip；图片、MP3、M4A、WebP、JPG、PNG 使用 STORE 或低压缩级别，文本/JSON/Markdown 使用 Deflate。这样避免把已经压缩的媒体再压一次。
  - 只有当“把 `.html` 改名/直接交给解压工具也能打开”成为明确需求时，才单独实现 HTML/ZIP polyglot，并把它作为兼容性较低的高级导出格式。

- **播放器采用“启动元数据 + 按需资源 + 有界缓存”的三段式加载。**
  - 启动阶段只解析版本头、标题、manifest、当前 leaf/路径和首屏资源；
  - 当前 scene、立绘、CG、SFX、BGM、TTS 分别按需获得；
  - 维护按资源类别的 LRU，设置总字节预算和单项上限；切场、路线跳转、关闭回顾时回收 Blob URL/解码缓冲。
  - `fflate` 可作为第一版依赖，但不要将其 `filter` 描述成完整的随机访问能力；若未来需要大包 HTTP Range，再为 hosted 版本增加 `zip.js`/Range Reader 路径。

- **统一“播放事件”和“归档索引”的身份。**
  - 播放器的视觉事件应继续复用 `lineageToEvents()`，但输入必须是当前路线树投影后的 `LineageNodeView[]`，并且保留原始 `seq`，不要从原始 `LineageStore` 直接假设可渲染。
  - 音频、CG 旁注、编辑文本、分支选择都应以 `nodeId` 为主键，`seq` 作为兼容播放器的时间线定位键。这样可避免分支重写、原地编辑后同 `seq` 复用造成错配。

- **为归档定义严格的兼容政策。**
  - 加载时先校验 `magic`、格式版本、播放器支持范围、清单 hash 和资源总量；对未知新版本明确提示“需要更新 Stage AI”，不要猜测读取。
  - 维护少量 golden archives：短篇、含多分支、含重写/删除、含旁注 CG、含 TTS、含压缩记录、旧版本归档；CI 做“导出 → 导入 → 当前路径重放 → 继续生成前上下文重建”的往返验证。
  - 导出 HTML 内嵌播放器本身带固定 build/version；这样旧 HTML 的回放可保持历史行为，而新 Stage AI 导入则走显式迁移链。

- **导出 UI 不要只暴露“完整版/轻量版”两个体积档位，应按用户目标命名。**
  - `分享回放（单 HTML）`：当前路径或作者选定分支，桌面优先；
  - `分享回放（Web 包/托管）`：移动端与长篇优先，允许 HTTP Range/缓存；
  - `完整归档（Zip，可续演）`：完整树、状态和素材；
  - `文本/轻量预览`：明确不含语音或大媒体。
  - 这样用户的心智模型是“我要分享观看”还是“我要跨设备继续”，而不是被迫理解 Zip、Base64 和 Blob。

- **体积估算改用实测并拆开三个口径。**
  - 记录：原始媒体总量、标准 Zip 字节数、单 HTML 字节数、播放器裸 JS/CSS 字节数、可选 gzip/brotli 传输字节数。
  - 不再把“gzip 后约 180KB”写成单 HTML 磁盘体积；`file://` 没有 HTTP `Content-Encoding`。对于媒体为主的归档，应默认按 Base64 约 33% 增长估算，并把 TTS、BGM、透明 PNG 的实际编码作为主要变量。

- **保留用户第一次点击的“开始遮罩”，即使桌面浏览器偶尔允许自动播放。**
  - 点击处理里统一调用 `AudioContext.resume()`、初始化 BGM/语音通路，之后再开始自动播放。这样行为在 Chrome、Firefox、Safari、WebView 间一致，也给播放器一个展示资源准备错误和格式不支持错误的入口。
  - TTS Blob 显式设置 `audio/mpeg` MIME；播放推进不要只依赖 `ended` 事件，应有超时/失败收束。

- **导入时默认新建独立目标，不做隐式合并。**
  - 本地已有同名剧目时，使用用户可读的副本名并在元数据中保留 `playIdentity`/`archiveId`/原始标题；
  - 如果未来增加“合并到已有剧目”，单独设计基于 `baseHeadId`、节点存在性和 hash 的合并向导；不将“继续演”与“合并世界线”混为一件事。

- **为回放和续演建立不同的验收矩阵。**
  - 回放验收：视觉事件顺序、转场、立绘绑定、CG 旁注、BGM/SFX/TTS、停止点、路线树、编辑后文本、移动/桌面启动手势。
  - 续演验收：导入后的 Agent system prompt、谱系投影、当前 branch state、`memory/archive` 可见范围、压缩摘要、NSFW 通道状态、`prevLeafId`/`readPos`、素材清单和下一拍分支来源。
  - 不能只验证“HTML 能打开”或“Zip 能解压”；那两项都不足以证明接续演出正确。

## Open questions

- **目标兼容矩阵到底是什么？**
  - 第一版是否承诺 Windows/macOS 桌面浏览器即可？是否把 Android Chrome、iOS Safari、微信 WebView 列为正式支持，还是明确标为“需托管 URL/不保证本地文件”？这会直接决定单 HTML 是否是默认入口。

- **“单 HTML”要不要支持离线保存回放进度？**
  - 只读回放不需要 IndexedDB/OPFS；若允许观众在单 HTML 中继续选择、添加书签或跨次打开恢复位置，就会引入 `file://` 存储差异、隐私和迁移问题。第一版更适合把单 HTML 定义为只读播放器，位置保存放在浏览器可用的 hosted 版本或显式导出存档中。

- **公开回放是否包含完整分支树、未公开分支、Agent 历史和创作记忆？**
  - 如果不包含，应允许导出“当前路径/选定节点子树”；如果包含，应在 UI 明确说明这会暴露哪些内容。尤其要决定是否导出思考过程、工具调用、原始提示词、NSFW 记忆和未采用素材。

- **归档是否必须可在没有 Stage AI 的环境中被第三方工具读取？**
  - 若答案是否定的，Base64 data block + 标准 Zip 已足够；若答案是肯定的，应决定是否把 HTML/ZIP polyglot 作为独立格式，以及是否接受 macOS Archive Utility、iOS 文件预览和实现差异的兼容成本。

- **继续演出使用哪个断点？**
  - 是当前 `leafId`，还是作者选择的任意路线节点？如果选择任意节点，是否允许从轮中节点续演，还是强制回到 `beat_end`/`root`？当前编排器对 `readPos`、`lastStop`、`prevLeafId`、`resume`、`playFrom` 已有明确语义，导出 UI 必须与这些语义对齐，不能只显示一个模糊的“继续”。

- **谱系删除和重写的持久化真相最终采用哪条路线？**
  - 如果 `lineage.jsonl` 继续作为审计日志，则应在格式文档中承认它不能单独重建当前剪枝后的树；如果希望它可独立恢复，就需要加入删除/tombstone/结构操作事件并建立回放测试。

- **旧归档的兼容期限是什么？**
  - 是否承诺“永远可播放”？单 HTML 自带旧播放器可以较好地保留历史回放，但导入到新版 Stage AI 仍需要迁移链。应明确支持的 `archiveFormatVersion` 范围，以及遇到更新版本时的拒绝提示。

- **媒体许可与隐私是否需要归档级标记？**
  - 生成图、资源库素材、Fish 音色及 TTS 结果可能有不同的分享许可。至少应在 manifest 中保留来源/许可元数据，并允许导出时排除不宜分享的资源或仅保留文本。

- **资源体量阈值是否由构建实测决定？**
  - 计划中的“<150 句”“20–40MB”“短中篇秒开”只能作为初始假设。应在真实安卓低内存机、桌面 Chrome/Firefox/Safari、微信托管 URL 上测量首屏时间、峰值 JS/Blob/音频内存、跳转延迟和崩溃率，再决定默认导出形态。

- **SQLite-WASM 是否真的有业务需求？**
  - 若只是读取谱系、构建路线树和按需索引，JSON/JSONL + 内存索引更简单；只有当浏览器端要做大规模查询、增量编辑、持久化多档存档或复杂全文检索时，才值得引入 SQLite-WASM。它不应因为“看起来 canonical”而进入第一版单文件播放器。
