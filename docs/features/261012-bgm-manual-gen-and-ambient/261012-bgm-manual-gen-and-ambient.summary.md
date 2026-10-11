# 261012 BGM 手动生成能力与 Ambience 素材体系重构 · 交付摘要

## 一、需求背景与目标

1. **彻底解耦并正规化 `ambient`（环境氛围音）素材体系**：
   - 告别此前「环境音借壳 sfx / assetRef 在 sfx 与 bgm 间兜底查找」的过渡设计；
   - 将 `ambient` 提升为与 `bgm`、`sfx` 完全平级的一等素材类别（`AssetKind`），在资源库（`library/ambient/`）与剧目（`assets/ambient/`）中享有专属物理目录、专属元数据与专属 UI 分组呈现，同时保持向下兼容。
2. **在工坊素材页面提供 BGM 手动生成能力**：
   - 为 BGM 提供与当前生图（Image）同构的手动生成对话框（`MusicGenDialog`）；
   - 提供 `POST /api/plays/:id/music` 异步排产接口，与 `asset_ready` 广播联动；
   - 内置基于 `galgame-bgm` 规范的 6 大经典场景风格模板，支持一键填入经声学验证的 Prompt，并在后台生成完毕后自动同步写入选曲元数据到 `manifest.json`。

---

## 二、改动与实现详情

### 1. 核心协议与共享包
- **`packages/core/src/play/assets.ts`**：
  - `ASSET_KINDS` 新增 `"ambient"`：`["backgrounds", "cg", "sprites", "characters", "bgm", "ambient", "sfx"]`；
  - `AUDIO_KINDS` 新增 `"ambient"`：`new Set(["bgm", "ambient", "sfx"])`。
- **`packages/agent/src/media/asset-index.ts`**：
  - `KINDS` 素材目录扫描清单加入 `"ambient"`；
  - 音频白名单扩展为 `\.(png|jpe?g|webp|mp3|ogg|wav|m4a|flac)$`，与服务端及素材库统一。
- **`packages/stage/src/assets.ts`**：
  - 舞台资产索引 `buildAssetIndex` 中，`ambient` 通道优先从专属 `assets/ambient/` 目录索引，其次平滑回落 `sfx` 与 `bgm`：
    `ambient: (stem) => byStem(ambient, "ambient")(stem) ?? byStem(sfx, "sfx")(stem) ?? byStem(bgm, "bgm")(stem)`。

### 2. 服务端与资源库
- **`apps/server/src/assetRef.ts`**：
  - `refsFromScene` 将场景环境音属性的候选类别调整为优先正统 `ambient`：`candidates: ["ambient", "sfx", "bgm"]`。
- **`apps/server/src/store.ts` & `library.ts` & `http.ts`**：
  - 素材上传与静态服务白名单加入 `"ambient"`；
  - `KIND_EXT` 为 `ambient` 配置标准音频扩展名集合；
  - 在 `library/ambient/` 中建立标准环境音分类目录。
- **`apps/server/src/playhouse.ts`**：
  - 新增公有方法 `generateMusic(playId, req)`：
    - 入参校验与排产記账（`jobIdForMusic`）；
    - 异步调用 `PlayMusic.generate`；
    - 音频入库后，自动将请求中的 `title`, `description`, `tags`, `mood`, `scene`, `loop`, `volume` 通过 `music.annotate` 写入素材表 `manifest.json`；
    - 广播 `asset_ready`（`type: "bgm"`）通知前端刷新。
- **`apps/server/src/http.ts`**：
  - 挂载 `POST /api/plays/:id/music` REST 端点，带边界防御与数据清洗（volume 限制在 0~1、prompt 长度限制 2000 字等）。

### 3. 前端界面与交互
- **`apps/web/src/api.ts`**：
  - 新增 `api.generateMusic(playId, req)` 客户端调用方法。
- **`apps/web/src/workshop/MusicGenDialog.tsx`**：
  - 针对 BGM 手动生成的专用模态对话框；
  - 预置 6 大经典场景风格模板（校园日常、心动告白、夕阳怀旧、泪点别离、悬疑暗流、终章救赎），一键填入声学特征、Prompt 及元数据；
  - 响应式表单设计（支持移动端窄屏单列自适应）；
  - 异步到货通知与就地试听音频播放器。
- **`apps/web/src/workshop/AssetsPanel.tsx`**：
  - 素材分类新增「环境音 (Ambience)」独立卡片；
  - 在「背景音乐 (BGM)」分组标题右侧新增「✨ 生成」按钮，点击弹出 `MusicGenDialog`；
  - 素材类别标题展示友好中文标签（背景图、插图 (CG)、环境音 (Ambience)、背景音乐 (BGM)、音效 (SFX)）。
- **`apps/web/src/workshop/LibraryBrowser.tsx`**：
  - 资源库分类 Tab 新增「环境音」选项卡。

---

## 三、验证与测试

1. **类型检查与构建**：
   - `pnpm -r build`：全 6 个 workspace 项目编译通过；
   - `pnpm typecheck`：全工作区 TS 零报错。
2. **契约守卫**：
   - `pnpm check:agent-contract`：全部 9 项检查全绿。
3. **单元测试**：
   - `test/assetRef.test.ts`：13 项全部通过（新增环境音优先查 ambient、其次 sfx、再查 bgm 的测试用例）；
   - `test/music.test.ts`：26 项全部通过（新增 annotate 完整元数据入库测试）。
4. **代码检视闭环**：
   - Reviewer 提出的 B-001 路径契约问题已解决；
   - R-001 输入边界校验、R-003 窄屏响应式、R-005 音频格式白名单已全面修复。
