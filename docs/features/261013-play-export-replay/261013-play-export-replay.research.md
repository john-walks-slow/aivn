# 已演剧目导出、零 API 离线回放与继续演出调研

日期：2026-10-13  
分支：`feat/play-export-replay`  
主题：已演出剧目的便携导出、零 API 单 HTML / 离线包播放、以及逆向导入继续演出

---

## 1. 核心需求剖析

### 1.1 背景与现状
当前 AIVN（Stage AI）已有 `exportZip` 接口，但其定位是**剧目制作包导出**（空白模板）：
- 仅打包 `play.json`、`assets/`、`characters/`、`memory/`；
- 明确排除了 `session.json`、`lineage.jsonl`、`meta.json`、`media-cache/` 等玩家运行期数据。

用户需求变化：玩家在演完一个剧目（或一段长线剧情）后，希望将**真实的演出成果**分享给他人或永久保存。

### 1.2 关键诉求
1. **零 API 门槛查看**：
   - 接收方可能没有 Stage AI 环境，也没有任何 LLM API Key、生图 API Key 或 Fish Audio TTS 配额；
   - 必须能开箱即看，且体验不能降级为纯文本，必须还原舞台视觉（背景、立绘差分、运镜、动作、标题卡）、声音（BGM、SFX、TTS 语音台词）、打字机节奏与历史回顾。
2. **单 HTML 是否可能？**：
   - 探究单文件（Self-contained HTML）的技术可行性、体积边界、移动端兼容性与最佳打包策略。
3. **导入继续演（Dual-Use Archive）**：
   - 导出的产物若被传给有 Stage AI 环境的玩家，或原作者想换台机器继续演，能够一键导入系统；
   - 导入后完整恢复当时的谱系树、设定与素材，在任意分支或终点继续由 Agent 生成后续剧情。

---

## 2. 单 HTML（Single HTML）深度可行性分析

### 2.1 结论：完全可行，且能达到极佳体验

单 HTML 播放器的核心逻辑：
1. **前端运行时（Runtime）**：将 `@aivn/stage` 舞台渲染层与 `@aivn/core` 谱系重放层打包为一个紧凑的独立 JS + CSS bundle（利用 esbuild/vite，gzip 后约 180KB）。
2. **剧情数据（Lineage Data）**：`lineage.jsonl` / `session.json`，纯文本 JSON，体积仅 30KB ~ 100KB。
3. **媒体资源（Assets & Audio）**：背景、立绘、CG、BGM、TTS 语音音频。

### 2.2 打包方案对比：内嵌 Data URI vs 内嵌 Zip 解包

| 维度 | 方案 A：裸 Base64 Data URI | 方案 B：内嵌压缩 Zip + `fflate` 解包（推荐） |
|---|---|---|
| **HTML 文件体积** | 资源原始体积 × 1.33（膨胀 33%） | 资源经 Deflate 压缩后再 Base64，通常接近甚至小于原始未压缩体积 |
| **浏览器解析负担** | HTML DOM 包含数千万字符文本，移动端解析 AST 时极易卡死或爆内存 | HTML 本身仅包含几行骨架代码与一个 Base64 数据块，秒级解析完成 |
| **媒体加载性能** | 每个 img/audio 直接引用巨大 data URI | JS 在页面就绪后几毫秒内解压为内存 `Blob URL`，浏览器处理与常规网络资源一致 |
| **复用导入机制** | 导入时需要正则扫描几百处 data URI 重构文件 | 内嵌的 Zip 本身就是一个标准的剧目目录树，导入时直接拿这个 Zip 还原，零转换成本 |

**推荐实践**：
使用方案 B。在单 HTML 内部嵌入一个 `Uint8Array` / Base64 的 Zip 数据包，页面启动时调用内嵌的轻量 `fflate`（已是项目依赖，解压模块仅约 8KB），将素材在浏览器内存中建立 `blobUrls` 映射表。

### 2.3 文件体积测算与物理边界

以典型 2~3 轮（约 30~50 句台词）的短篇剧目与数十轮长篇剧目为例：

| 资源类别 | 短篇典型规格 | 短篇体积 | 中长篇典型规格 | 中长篇体积 |
|---|---|---|---|---|
| 舞台播放器 Bundle | JS + CSS (minified) | ~400 KB | JS + CSS (minified) | ~400 KB |
| 剧本与谱系数据 | JSON 数据 | ~50 KB | JSON 数据 | ~200 KB |
| 背景与 CG 图 | 2~4 张 WebP/JPG | ~800 KB | 8~15 张 WebP/JPG | ~3 MB |
| 立绘差分透明图 | 4~8 张 PNG/WebP | ~1.5 MB | 15~30 张 PNG/WebP | ~6 MB |
| BGM 音乐 | 1 首循环曲 (M4A/MP3) | ~1.5 MB | 3 首循环曲 | ~4.5 MB |
| TTS 语音台词 | 30 句 MP3 (约 25KB/句) | ~750 KB | 200 句 MP3 | ~5 MB |
| **总原始体积** | - | **~5.0 MB** | - | **~19.1 MB** |
| **Zip 压缩后** | 主要是音频/图片已压缩 | **~4.5 MB** | - | **~17.5 MB** |
| **单 HTML 最终体积** | Base64 编码后 | **~6.0 MB** | - | **~23.5 MB** |

**边界结论**：
1. **短篇与中篇（< 150 句台词）**：生成的单 HTML 体积在 **5MB ~ 15MB** 之间，极其轻量，在 PC 和主流移动端（含手机浏览器）均能实现秒开和流畅播放。
2. **长篇（> 300 句台词，多首 BGM）**：单 HTML 体积会上升至 **20MB ~ 40MB**。现代浏览器完全能加载 30MB 的单 HTML，但如果在微信等受限 Webview 下，可能会受文件大小或内存限制。
3. **分档导出策略**：
   - **单文件全要素 HTML（含配音与音乐）**：默认首选，全真视觉小说体验。
   - **单文件轻量 HTML（免语音）**：移除 TTS 语音文件，体积通常骤降至 2MB~4MB，特别适合纯文本+立绘阅读。
   - **离线 Zip 包（HTML + assets 目录）**：提供解压即可本地双击使用的静态文件夹，适合不想把几十兆塞进单个 HTML 的极长篇。

---

## 3. 离线无 API 查看时的交互设计

### 3.1 核心体验保障
离线播放器不需要 WebSocket，不需要轮询，通过前端本地数据驱动：
1. **主舞台回放**：
   - 自动适配屏幕（移动端自适应）；
   - 支持文字打字机、语音同步播放、立绘表情动作、换景转场、BGM 循环与音效；
   - 底部操作栏：自动播放（Auto）、快进（Skip / Turbo）、语音开关、全屏、回顾（Backlog）。
2. **分支选择与谱系导航**：
   - 当剧情播放到分支节点（`<stop options="..."/>`）：
     - **已演出的分支**：正常点击，无缝进入该分支继续播放。
     - **未演出的分支**：如果导出的剧目树中未曾探索该分支，按钮呈现淡色或标识，点击弹出提示：
       > 「该分支在本次导出中尚未生成。如需探索新世界线，请导入 Stage AI 继续开演。」
3. **路线树查看（Route Tree）**：
   - 提供简易路线面板，展示当前故事线及分岔结构，用户可以直接点击任意已记录的节点跳转回放。

---

## 4. 导入继续演（Import & Resume）的技术机制

### 4.1 数据自描述（Polyglot Archive）
导出的单 HTML 文件不仅是一个网页，也是一个**自包含的剧目包**。
文件结构：
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>剧目名 - AIVN Replay</title>
  <style>/* Inlined Stage CSS */</style>
</head>
<body>
  <div id="root"></div>
  <script>/* Inlined Standalone Player JS + fflate */</script>
  <script id="aivn-archive" type="application/octet-stream">
    <!-- BASE64_ZIP_STREAM -->
  </script>
</body>
</html>
```

### 4.2 导入恢复流程
1. 用户在 Stage AI 的「剧目库」页面点击「导入剧目包」或将文件直接拖入浏览器。
2. 后端接收文件流：
   - 若文件是 `.zip`：按标准 Zip 解压；
   - 若文件是 `.html`：提取 `<script id="aivn-archive">` 中的 Base64 数据并解压。
3. 解包产物包含：
   - `play.json`、`characters/*.md`、`memory/**`、`assets/**`
   - `session.json`、`lineage.jsonl`、`meta.json`
   - `media-cache/tts/**`
4. 校验与落盘：
   - 路径防穿透校验（防 Zip Slip）；
   - 如果本地已有同名剧目 ID，自动派生 `<id>-continue` 或提示改名；
   - 写入 `plays/<targetId>/` 目录并预热运行时。
5. 继续演出：
   - 玩家进入剧目，舞台停留在导出时的世界线位置（或任意跳转点）；
   - 点击「继续」或在分支处选择未生成的选项时，本机的剧作家 Agent 接管上下文，调用宿主的 LLM / 生图 / TTS API 顺畅续写！
