# 261012 BGM 手动生成能力与 Ambience 素材体系重构 · 方案设计

## 1. 目标

1. **彻底解耦并正规化 `ambient`（环境氛围音）素材体系**：
   - 告别 `assetRef.ts` 中「优先在 sfx/ 中寻址 ambient 资源」的“借壳 sfx / 狗皮膏药”设计；
   - 将 `ambient` 提升为与 `bgm`、`sfx` 平级的第一等素材类别（`AssetKind`），在资源库（`library/ambient/`）与剧目（`assets/ambient/`）中享有专属物理目录、专属元数据与专属 UI 分组呈现，同时保持向下兼容。
2. **在工坊素材页面提供 BGM 手动生成能力**：
   - 为 BGM 提供与当前生图（Image）同构的手动生成对话框（`MusicGenDialog`）；
   - 提供 `POST /api/plays/:id/music` 异步发起端点与 `asset_ready` 联动；
   - 内置基于 `galgame-bgm` 技能的高质量场景风格模板选择器，支持一键填入规范 Prompt 与元数据。

---

## 2. 详细技术方案

### 2.1 Ambience 第一等公民重构
- **`packages/core/src/play/assets.ts`**：
  `ASSET_KINDS = ["backgrounds", "cg", "sprites", "characters", "bgm", "ambient", "sfx"]`
  `AUDIO_KINDS = new Set(["bgm", "ambient", "sfx"])`
- **`apps/server/src/assetRef.ts`**：
  `refsFromScene` 中对 `ambient` 优先使用专属候选 `candidates: ["ambient", "sfx", "bgm"]`。
- **`packages/stage/src/assets.ts`**：
  舞台资源索引：`ambient: (stem) => byStem(ambient, "ambient")(stem) ?? byStem(sfx, "sfx")(stem) ?? byStem(bgm, "bgm")(stem)`。
- **`apps/server/src/store.ts` & `library.ts` & `http.ts`**：
  素材目录白名单与上传接口加入 `ambient`。
- **素材迁移与预置**：
  将 `library/sfx/` 中的 4 类环境音迁移/规范到 `library/ambient/`（并在 sfx 保留软链或向后兼容）。

### 2.2 BGM 手动生成链路
- **服务端接口 `POST /api/plays/:id/music`**：
  - 入参：`{ name, prompt, title?, tags?, mood?, scene?, loop?, volume?, description?, overwrite? }`
  - 逻辑：入参校验 → 调用 `playhouse.queueMusic(...)`，并在生成完成的回调中，自动调用 `playhouse.declareBgmMeta` 或在 `PlayMusic` 中持久化完整的元数据（解决此前到货元数据缺失的问题）。
  - 返回：`{ target, path, prompt }`。
- **Web 前端 `MusicGenDialog`**：
  - 位于 `apps/web/src/workshop/MusicGenDialog.tsx`；
  - 在 `AssetsPanel.tsx` 的 BGM 分组标题右侧新增「✨ 生成」按钮；
  - 支持快捷选择经典模板（日常闲聊、心动告白、夕阳怀旧、哀伤雨天、悬疑暗流、终章救赎）；
  - 支持提交后自动加入排队监听，到货后自动刷新素材列表。
- **Web 前端 `LibraryBrowser` 与 `AssetsPanel`**：
  - 增加「环境音」独立 Tab 与独立素材分组。

---

## 3. 验证与实施步骤
1. 核心包与协议层更新（core -> build -> agent/stage/server/web）；
2. 服务端 REST 端点与元数据更新；
3. 前端 UI 组件开发与集成；
4. 契约测试与端到端运行验证；
5. 检视与合并。
