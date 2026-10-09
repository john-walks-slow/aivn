# 生图配置按类目分开（背景 / CG / 立绘）—— 实施记录

## 做了什么

设置页「出图」那一份配置过去三类素材共用；现在每类可以各自覆盖 `format` / `baseUrl` / `apiKey` / `model` / `size` / `reference` / `timeoutMs`，没覆盖的字段跟随基础那份（对齐 `music.baseUrl` / `music.apiKey` 的回落口径）。

`settings.json` 形状：

```json
"image": {
  "enabled": true, "format": "gemini", "baseUrl": "http://127.0.0.1:38000", "apiKey": "...",
  "model": "gemini-3.0-pro-image", "size": "1K", "concurrency": 6, "timeoutMs": 180000, "reference": "neutral",
  "kinds": { "background": {}, "cg": { "format": "openai", "model": "gpt-image-2", "size": "2K" }, "sprite": { "size": "2K" } }
}
```

定下来的口径：

- 逐字段合并，空串 / 缺省 = 取基础那份；**回落只在 `config.ts` 的 `imageConfigFor` 一处**。
- `enabled` 与 `concurrency` 不进类目（总开关是一件事；并发闸门按剧目一个）。
- 优先级：`play.json` 的 `image.model` / `image.size`（请求级，作用于全部类目，现状不变）> `image.kinds.<kind>` > `image` 基础。
- 立绘的 `minTier: "2K"` 下限保留（抠底要分辨率），这一类填 `1K` 会被抬到 2K。
- 骨架占位兜底上界（`imagePendingTtlMs`）改为取基础与三个类目里最大的超时。

## 改动面

服务端：

- `imageBackend.ts`：新增服务端本地词表 `IMAGE_KINDS` / `ImageKind`、`IMAGE_FORMATS` / `IMAGE_REFERENCES`、`ImageBackends`（不进共享包——类目路由是部署配置，dsh-aivn 不认）。
- `config.ts`：`ImageKindOverride` / `ImageKindPatch` / `ImageSettingsPatch`；`ServerConfig.image.kinds`；`applyPatch` 里新增 `mergeKindOverride`（空串 / `null` = 清掉这一格，`image.kinds.<kind>` 粒度记 changed）；新增 `imageConfigFor()`；`imagePendingTtlMs` 取最大超时。
- `imageFactory.ts`：`createImageBackend` → `createImageBackends`，三类各装一个后端实例。
- `playAssets.ts`：`deps.backend` → `deps.backends`，`deps.reference` 由单值改为逐类目 `Record`；`produce()` 按 `spec.kind` 取后端，`referencesFor()` 按类目读垫图策略。
- `playhouse.ts`：`imageBackends` 接线 + 逐类目 reference（经 `imageConfigFor`）。
- `configApi.ts`：读视图 `image.kinds` 逐类目带掩码 `apiKey` 与 `apiKeySet`；写映射逐类目按「掩码回传 = 不改、清空 = 回落基础」。

前端：`api.ts` 的 `Settings.image.kinds` 类型；`SettingsScreen.tsx` 出图组末尾三个可折叠小节（`<details>`，摘要显示「已覆盖 N 项 / 跟随基础」，placeholder 显示继承值）；`app.css` 加 `.settings-kind*` 三个选择器。

文档：README 设置页字段总表补「按类目覆盖」一节与示例 D，并修掉一处已过时的「垫图策略是全局开关」；`apps/server/AGENTS.md`、`apps/web/AGENTS.md` 各补一条。

测试：`config.test.ts`（新增 4 条：只写覆盖项、空串/null 清空、非法格式与档位、改类目不动 base、类目超时进 TTL）、`configApi.test.ts`（类目 Key 掩码回传不写回 / 清空回落）、`playAssets.test.ts`（按类目取后端、垫图策略逐类目，并新增 `ImageBackends` 形式的 fixture）、`helpers.ts` 加 `sharedBackends` / `NEUTRAL_REFERENCE`，`workshop.test.ts` 与 `e2e-live-senren.test.ts` 跟着换新依赖形状。

## 验证

- `pnpm typecheck` 全绿（含 apps/web）。
- 只跑受影响文件：`config.test.ts` 25 条、`configApi.test.ts` 16 条、`playAssets.test.ts` 64 条、`workshop.test.ts` 53 条，全绿。
- 真 API 出图按约定不作为常规测试。
- 检视：`261010-image-kind-config.review.md`，结论**准入**，无阻塞；1 条建议（清空后 `kinds` 里保留空对象 `{}`）按设计保留——`freshSettings()` 本来就带三个 `{}`，空对象即「跟随基础」，比较与合并都正确。1 条非阻塞备忘（原生 `<details>` 展开态在重挂载时可能折叠）不处理。

## 与计划的差异

无。计划里写的三条口径（只在设置页、全套七项可覆盖、不动 `packages/agent`）逐条落地；dsh-aivn 与共享包未受影响（`ImageRequest` 未改）。

## 预览

- 本机 service 已用新构建重启（supervisord `stage-ai`，pid 已确认更换并监听 8787）。
- 隧道：<https://market-calvin-bacon-rat.trycloudflare.com/#/settings>（quick tunnel，临时）。
- 截图：`settings-image-group.png`（展开态出图组）、`settings-kinds-collapsed.png`、`settings-kinds-expanded.png`。
