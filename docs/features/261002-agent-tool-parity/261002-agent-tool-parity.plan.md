# 通用工具与 media-cache 下线

## 背景

剧作家（playwriter）与工坊（workshop）共用 `apps/server/src/agentkit/` 一套基座，但工具面上仍有两处按角色分叉：

- **库工具只归工坊**：`list_library` / `import_asset` 的 `roles` 只有 workshop，剧作家的 `PlaywriterKitDeps` 里连 `store` / `assetLibrary` 都没有。
- **生图能力按角色裁参数**：`imageTool.ts` 的 `imageParams(withExpression)` 给剧作家砍掉 `expression` 与 `referenceCharacters`，理由是「剧作家的 bg/cg 走 media-cache，那条链路不接垫图」。

同时 `ImageAssets`（media-cache 出图层）全仓只剩两处调用方：剧作家的后台排产 `preloadAsset`、导演栏 `requestCg`。工坊生图、库导入、立绘早已全走 `PlayAssets`（`assets/` + `assets/generated.json`）。结果是同一件事两张台账（`media/img/manifest.json` 与 `assets/generated.json`），而唯一没有垫图能力的恰是这条老路。

诉求：剧作家也要能导入资源库素材、也能垫图生成 CG；这两项默认禁用；工具不分叉，媒体缓存那层拆掉。

## 目标

1. `generate_image` 两个角色同一份实现与**同一份 schema**（`expression` / `referenceCharacters` 都给），只差等待策略（工坊 sync 等图 / 剧作家后台发起）与通知通道。
2. `list_library` / `import_asset` 两个角色共用同一份实现，剧作家也能装。
3. 剧作家的「生图 + 素材资源库」默认禁用，可在工坊 Agent 页逐剧目打开。
4. 删掉 `ImageAssets` 与 `media/img/`：站内生成图一律落 `assets/`，台账只有 `assets/generated.json` 一张。

## 设计

### 默认禁用怎么表达

`disabledTools` 只有一个方向（「关掉谁」），装不出「默认关、用户手动开」。补一个对称的白名单：

```
有效关闭集 = (DEFAULT_OFF[role] ∪ disabledTools) − enabledTools
```

- `DEFAULT_OFF` 是代码里的事实源（`kit.ts` 的 `TOOL_ROLES[].defaultOff`），目录项把 `defaultOff` 带给设置页，开关状态由「目录 + play.json」两份一起算，与实际装上的工具不会对不上。
- `enabledTools` 让「显式打开」这件事在 play.json 里留下痕迹；没有它，用户打开的默认关工具会在下次装载时又关回去。
- 能力位 `can.image` / `can.library` 跟着有效集走，提示词里对应的章节同步收掉。

### 垫图走哪条链路

`PlayAssets` 才有 `resolveReferences`（垫图），`ImageAssets` 的 `gen.generate({prompt, aspectRatio})` 根本没有参考图入参。所以不是给缓存层补垫图，而是让剧作家也走 `PlayAssets`：

- 剧作家的 bg/cg：后台 `playAssets.generate({kind, name, referenceCharacters}, prompt, style, undefined, {notify: "silent"})`，到货后广播 `asset_ready`（客户端 `generated` 表按 id 收；静态素材优先，重建后自然落进 `assets/` 清单）。
- 立绘：已经是这条链（`kickSprite`），不动。
- 导演栏 `requestCg`：同一个后台入口，`id` 仍是 `cg_<时间戳>`。
- 「这个 id 已经有图了吗」：`PlayAssets.exists()` 取代 `statusOf` + `hasStaticAsset`。

### 台账归一

- `assets/generated.json`（`PlayAssets` 写）成为站内出图的唯一台账。
- 提示词 A 区「已生成的图」改读它（现在读 `ImageAssets.notes()`）。
- CG 页 `GET /api/plays/<id>/cg` 只并 `readPlayLedgerEntries`。
- hello 不再带 media-cache 快照：新图都落在 `assets/`，静态素材清单已经涵盖。

## 改动面

| 文件 | 改动 |
| --- | --- |
| `packages/core/src/play/config.ts` | `AgentSettings.enabledTools` |
| `agentkit/kit.ts` | `defaultOff`、`enabled` 依赖、剧作家装库工具、目录带 `defaultOff` |
| `agentkit/deps.ts` | 剧作家补 `store` / `assetLibrary` / `onPlayConfigChanged`；`QueuedImageDeps` 换成 PlayAssets 口径 |
| `agentkit/imageTool.ts` | 单一 schema；剧作家后台分支支持垫图与差分 |
| `agentkit/libraryTool.ts` | 依赖面从 `WorkshopKitDeps` 抽成通用窄接口 |
| `orchestrator.ts` | `imageTools` 换 `kickPlayAsset`；`statusOf`/`hasStaticAsset`/`images` 退场；把 store 与资源库透给 kit |
| `playhouse.ts` | `preloadPlayAsset` 取代 `preloadAsset`；删 ImageAssets 装配与 `images` 字段 |
| `imageAssets.ts` | 删除（`readPlayLedgerEntries` 挪进 `store.ts`） |
| `prompt.ts` | `generated` 来源改台账；资源库在位时加一句「先查库再出图」 |
| `web/.../AgentPane.tsx`、`api.ts`、`useStageSocket.ts` | 默认禁用的开关状态；hello.assets 下线 |

## 验证

- `pnpm -r typecheck` + 受影响模块单测（`agentkit` / `image` / `playAssets` / `playhouse` / `http` / `prompt`）。
- 契约断言：`generate_image` 两角色 schema 逐字相同；剧作家的生图与库工具默认不在装好的工具里，`enabledTools` 点名后出现。
- 实机：工坊 Agent 页关/开剧作家的生图与资源库；剧作家 `import_asset` 落 `assets/` 并在下一轮进 A 区；垫图 CG 到货后舞台上淡入。