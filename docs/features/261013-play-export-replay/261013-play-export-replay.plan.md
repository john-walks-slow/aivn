# 演后剧目导出单 HTML 与接续演出方案（精简版）

日期：2026-10-14  
分支：`feat/play-export-replay`  
原则：实用主义、KISS、拒绝提前优化、实现最精简闭环

---

## 1. 核心目标

1. **导出单 HTML**：已演剧目一键导出为一个自包含的 `.html` 文件。
2. **零 API 离线观看**：接收者双击该 HTML，任何现代浏览器本地打开即可完整播放（带背景、立绘差分、BGM、TTS 语音台词、分支跳转），无需联网或配置 API Key。
3. **导入继续演**：把该 `.html` 文件导入 Stage AI，能完整恢复剧目与历史进度，由本机 Agent 接着往下演。

---

## 2. 极简技术实现

### 2.1 数据组织与单 HTML 生成（服务端）

1. **打包剧目数据**：
   - 收集剧目完整运行数据：`play.json`、`characters/`、`memory/`、`assets/`、`session.json`、`lineage.jsonl`、`meta.json` 以及 `media-cache/tts/`（实际生成的配音）。
   - 附带一份微型 `voiceMap.json`（记录 `seq -> tts/xxx.mp3`），方便前端离线回放直接对应音频。
   - 使用现有的 `fflate.zipSync` 将上述内容打包为一个 Zip buffer。
2. **拼装单 HTML**：
   - HTML 模板结构：
     ```html
     <!DOCTYPE html>
     <html>
     <head>
       <meta charset="utf-8">
       <title><!-- 剧目名 --></title>
       <style>/* 内联 Stage 舞台样式与基础布局 */</style>
     </head>
     <body>
       <div id="root"></div>
       <script id="aivn-data" type="text/plain"><!-- BASE64 ZIP 数据 --></script>
       <script>/* 内联轻量播放器 JS（含 fflate 解压与 @aivn/stage 回放逻辑） */</script>
     </body>
     </html>
     ```
   - 用户在剧目详情或侧栏点击「导出剧目」即可下载该 `.html` 文件。

---

### 2.2 零 API 离线播放器（前端单文件）

1. **解压与资源就绪**：
   - 页面启动时，从 `#aivn-data` 取出 Base64，使用 `fflate.unzipSync` 在内存中解压。
   - 图片与音频解压为 `Uint8Array`，直接调用 `URL.createObjectURL(new Blob([...]))` 建立内存 URL 映射。
2. **演出重放**：
   - 调用 `@aivn/core` 现成的 `lineageToEvents(lineage)`，还原完整演出事件流。
   - 直接复用 `@aivn/stage` 现成的视觉与播放逻辑（`StageTheater`、`ScriptBuilder`、`usePlayback`）。
   - 播放体验：打字机文字、立绘表情换装、背景转场、BGM 循环、台词配音播放。
3. **分支选项交互**：
   - 遇到 `<stop>` 分支：
     - 若该选项在谱系树中已有后续节点：正常点击，直接跳转该分支继续播放。
     - 若该选项尚未生成：轻量提示「该选项尚未生成，可导入 Stage AI 接着演」。

---

### 2.3 导入 Stage AI 继续演（服务端 + 剧目库）

1. **统一导入端点**：
   - `POST /api/plays/import` 扩展：
     - 若上传的是 `.zip`：按原有 zip 逻辑解压导入。
     - 若上传的是 `.html`：提取其中的 `#aivn-data` Base64 Zip，解压落盘到 `plays/<id>`。
     - 若本地已存在同名剧目 ID，自动改名为 `<id>-continued`，避免覆盖。
2. **接续生成**：
   - 导入后 `session.json` 与 `lineage.jsonl` 原样恢复，剧目停留在导出时的世界线末端。
   - 用户打开剧目点击「继续」或选择未探索选项，本地 Agent 自然接管上下文，调用本地 API 继续向后编排演出。

---

## 3. 落地步骤

1. **服务端导出与导入**：
   - 在 `apps/server/src/store.ts` 增加导出单 HTML 的打包逻辑，以及从 HTML 导入的提取逻辑。
   - 新增导出接口 `GET /api/plays/:id/export?format=html`。
2. **轻量独立播放器 Bundle**：
   - 基于现有 `@aivn/stage` 和 `@aivn/core` 打包一个轻量 standalone 播放器脚本。
3. **前端入口接入**：
   - 剧目详情/舞台增加「导出单 HTML」按钮；
   - 剧目库「导入剧目」支持选择 `.html` 文件。
4. **验证**：
   - 导出某已演剧目为 `.html`，直接双击在浏览器中验证声画与分支；
   - 将该 `.html` 重新导入，验证能否接着演下一拍。
