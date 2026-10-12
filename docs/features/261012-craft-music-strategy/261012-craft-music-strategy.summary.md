# 261012 剧目设置素材来源支持音乐生成与音效导入解耦 · 交付摘要

## 一、需求背景
用户提出：
- 工坊剧目设置中的「素材来源」：音乐要单独支持，并默认改成生成（`generate`）；
- 音效（`ambient / sfx`：环境音与音效）才是只从素材库导入（`library`，当前没有实时环境音与音效模型）。

此前系统历史遗留将音乐与音效合并为单一的 `audio: ["library", "off"]`，且注释写着“引擎不生音频”，导致新支持的 BGM 生成能力无法在剧目创作策略中被模型和用户精细配置。

---

## 二、改动实现清单

### 1. 核心模型与配置 (`packages/core/src/play/config.ts`)
- 新增音乐来源枚举与类型：
  `export const CRAFT_MUSIC_SOURCES = ["generate", "library-first", "library", "off"] as const;`
  `export type CraftMusicSource = (typeof CRAFT_MUSIC_SOURCES)[number];`
- `CraftAssetSources` 扩展 `music?: CraftMusicSource`；
- `EffectiveCraft.assets` 扩展 `music: CraftMusicSource`；
- **更新 `DEFAULT_CRAFT` 默认值**：
  ```ts
  export const DEFAULT_CRAFT: EffectiveCraft = {
    beatLength: "medium",
    stopOptions: "three",
    assets: {
      background: "library-first",
      cg: "generate",
      sprite: "generate",
      music: "generate", // 音乐默认直接生成
      audio: "library",  // 音效/环境音默认只用素材库
    },
  };
  ```
- `resolveCraft(craft)` 支持 `music` 合成与向后兼容。

### 2. 提示词与白名单 (`packages/agent`)
- **`packages/agent/src/craft/params.ts`**：
  - `AssetCapabilities` 扩展 `music?: boolean`；
  - 新增 `MUSIC_LABEL` 与 `musicDirective`（涵盖生成、资源库优先、只用资源库、不用背景音乐）；
  - `AUDIO_LABEL` 与 `audioDirective` 明确指向环境音与音效（ambient / sfx）；
  - `renderCraftParams` 将原有一行拆分为：
    - `音乐（bgm）：...`
    - `音效（ambient / sfx）：...`
  - `describeCraftParams` 与 `CRAFT_ENUMS` 增加 `music`；
- **`packages/agent/src/readiness/play.ts`**：
  - `strayCraftValues` 增加 `assets.music` 白名单校验。

### 3. 前端界面 (`apps/web/src/workshop/PlayPane.tsx`)
- 剧目设置页（PlayPane）的写作参数区分为七项：
  - 每轮篇幅
  - 停止点选项
  - 素材来源：背景
  - 素材来源：插图（CG）
  - 素材来源：立绘
  - **素材来源：音乐（BGM）**（默认：直接生成；支持素材资源库优先、只用素材资源库、不用背景音乐）
  - **素材来源：音效（环境音与音效，ambient / sfx）**（默认：只用素材资源库里现成的；支持不用音效与环境音）
- `CRAFT_OPTIONS`、`CraftField`、`editCraft` 同步支持 `music` 字段的删除与修改。

---

## 三、验证与守卫
1. 构建与类型：`pnpm -r build` 与 `pnpm typecheck` 全部通过；
2. 契约守卫：`pnpm check:agent-contract` 9 项全绿；
3. 单元测试：`craft-params.test.ts`、`craftParams.test.ts`、`config.test.ts` 全部通过。
