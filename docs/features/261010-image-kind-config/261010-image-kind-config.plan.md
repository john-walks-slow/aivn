# 生图配置按类目分开（背景 / CG / 立绘）

## 需求

设置页的「出图」目前只有一份配置，三类素材（背景 / CG / 立绘）共用同一个接口格式、地址、Key、模型、档位、垫图策略与超时。要改成：每类可以各自覆盖这几个字段，没覆盖的跟随基础配置。

场景举例：立绘走本机 flow2api 的 `gemini-3.0-pro-image` + 2K（抠底要分辨率），背景与 CG 走 cpa 的 `gpt-image-2` + 1K（便宜、够用、支持任意尺寸）。

## 用户路径

1. 设置 → 出图 → 基础配置照旧填一份（这一份是兜底，行为和现在完全一样）。
2. 下面多出三个小节：**背景 / CG / 立绘**，每个 7 个输入框：接口格式、生图地址、生图 Key、出图模型、出图档位、垫图策略、出图超时 ms。
3. 每个输入框的 placeholder 显示它当前继承到的值（= 基础那份的值）。留空 = 跟随基础。
4. 保存后立即生效（与其它设置同一条路：重建进程级客户端，已加载剧目在下一个轮边界换用）。
5. 想确认某一类现在到底用什么：placeholder 就是答案；`settings.json` 里也能直接看。

## 配置形态

`<dataRoot>/settings.json` 的 `image` 多一个 `kinds`：

```json
"image": {
  "enabled": true,
  "format": "gemini",
  "baseUrl": "http://127.0.0.1:38000",
  "apiKey": "<your-api-key>",
  "model": "gemini-3.0-pro-image",
  "size": "1K",
  "concurrency": 6,
  "timeoutMs": 180000,
  "reference": "neutral",
  "kinds": {
    "background": {},
    "cg": { "model": "gpt-image-2", "size": "2K", "format": "openai", "baseUrl": "http://127.0.0.1:9999" },
    "sprite": { "size": "2K", "timeoutMs": 300000 }
  }
}
```

合并规则：

- **逐字段**，空串 / 缺省 = 取基础那份（与 `music.baseUrl` / `music.apiKey` 的回落同一条口径，见 `musicConnectionOf`）。
- 可覆盖：`format` / `baseUrl` / `apiKey` / `model` / `size` / `reference` / `timeoutMs`。
- 不进类目：`enabled`（生图总开关是一件事）、`concurrency`（并发闸门按剧目一个，共用一个 limiter）。
- 优先级：`play.json` 的 `image.model` / `image.size`（请求级覆盖，作用于全部类目，现状不变）> `image.kinds.<kind>` > `image` 基础。
- 立绘的 `minTier: "2K"` 下限不动：类目档位填 1K 会被抬到 2K（抠底要分辨率），README 与界面 hint 写明。

写语义（设置页提交的形态）：

| 值 | 含义 |
| --- | --- |
| 字段缺席 / `undefined` | 不改这一项 |
| `""` / `null` | 清空覆盖，回到跟随基础 |
| 具体值 | 设置（过校验，格式/档位非法直接报错） |

`apiKey` 沿用现有掩码规则：回传掩码 = 不改，清空 = 回落基础。

## 代码落点

### 服务端

- `apps/server/src/imageBackend.ts`：新增 `IMAGE_KINDS = ["background", "cg", "sprite"]` 与 `type ImageKind`（服务端本地的类目词汇表，不进共享包）。`playAssets.ts` 的 `AssetKind` 改成它的别名，`http.ts` 等既有引用点不动。
- `apps/server/src/config.ts`
  - `ServerConfig.image` 加 `kinds: Record<ImageKind, ImageKindOverride>`；`ImageKindOverride` 七个字段全可选，缺省 = 跟随。
  - `freshSettings()`：`kinds: { background: {}, cg: {}, sprite: {} }`。`settingsFromEnv()`（旧 `.env` 迁移）只填基础块，类目留空。
  - `applyPatch()`：`kinds` 逐类目逐字段合并，掩码/空串按上表归一，`format` 走 `parseEnum`、`size` 走 `parseImageSize`/`imageSizeText`、`timeoutMs` 走 `positiveInt`；`changed` 记 `image.kinds.sprite.model` 这种粒度。`next.image` 要深拷贝 `kinds`（现在是浅拷贝 `{ ...base.image }`，直接改会污染 base）。
  - 新增 `imageConfigFor(config, kind)`：返回该类目合并后的 `{ format, baseUrl, apiKey, model, size, reference, timeoutMs }`；回落只在这一处发生。
  - `imagePendingTtlMs`：超时取基础与三个类目里的最大值（骨架占位兜底上界要盖住最慢那一类）。
- `apps/server/src/imageFactory.ts`：`createImageBackend` → `createImageBackends`，返回 `{ background, cg, sprite }` 三个 `ImageBackend`，每个按 `imageConfigFor` 装配；基础 `enabled === false` 时整组返回 `null`。
- `apps/server/src/playhouse.ts`：`imageBackend` 字段换成 `imageBackends: ImageBackends | null`；`playAssetsFor` 传 `backends` 与 `reference: Record<ImageKind, "none"|"neutral">`；三处 `!this.imageBackend` 判空改判这一组。
- `apps/server/src/playAssets.ts`：
  - `PlayAssetsDeps.backend` → `backends: ImageBackends`；`reference` → `Record<ImageKind, ...>`。
  - `produce()` 按 `spec.kind` 取后端与垫图策略，请求体其余部分不变（`imageOverride()` 的 play.json 覆盖照旧最后叠上）。
- `apps/server/src/configApi.ts`：读视图 `image.kinds` 每类目带 `apiKeySet` 与掩码 `apiKey`；写映射每类目按掩码规则处理 `apiKey`，其余字段原样交给 `applyPatch`。

### 前端

- `apps/web/src/api.ts`：`Settings["image"]` 加 `kinds`（字段可选，`apiKey` 为掩码 + `apiKeySet`）。
- `apps/web/src/views/SettingsScreen.tsx`：出图组里加三个类目小节（标题 + 一个 `settings-grid` 的 7 个 `Field`），placeholder 用基础那份的值；下拉（接口格式 / 垫图策略）加一个空值选项「跟随基础」；超时用一个允许留空的数字输入。草稿里统一用 `""` 表示「跟随」，提交原样带上。
- `apps/web/src/app.css`：只加类目小标题这一处样式，复用现有 `.settings-grid` / `.settings-field`。

### 文档

- `README.md`：「设置页字段总表」在出图那几行后补 `image.kinds.<kind>.*` 的说明与合并规则；「生图（可选）」一节的 JSON 示例补一份按类目覆盖的例子。

## 不做

- `play.json` 不新增逐类目覆盖（本轮明确只在设置页；请求级覆盖仍作用于全部类目）。
- 不给类目单开 `enabled` / `concurrency`。
- 不改 `packages/agent` 的 `ImageRequest`：路由完全在服务端（三个后端实例），dsh-aivn 与共享包不受影响。

## 测试范围

只跑受影响文件：

- `apps/server/test/config.test.ts`：`kinds` 写入与清除、非法 `format` / `size` 报错、空串回落基础、`imageConfigFor` 合并结果、`imagePendingTtlMs` 取最大超时。
- `apps/server/test/configApi.test.ts`：类目 `apiKey` 掩码回传不写回、清空 = 回落。
- `apps/server/test/playAssets.test.ts`：按 `kind` 落到对应后端（两个 stub 后端，断言请求进的是哪一只）。
- `pnpm typecheck` + `pnpm check:agent-contract` 不涉及（工具面没动，跑一次确认没漂）。
- 真 API 出图不作为常规测试；验收时单独跑一次（背景 1K + 立绘 2K 各一张）。

## 验收（给用户）

1. 设置页出图组能看到三个类目小节，留空时 placeholder 是基础值。
2. 给立绘填一个不同的模型/档位，保存 → settings.json 里出现 `kinds.sprite`，其它两类仍是 `{}`。
3. 清空该项再保存 → `kinds.sprite` 里那一格消失，回到跟随基础。
4. 真实出一张立绘与一张背景，落到各自配置的后端（可用两类走不同地址来验证）。
