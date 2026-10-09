# 生图接口新增 NovelAI 格式（261009）· 实施计划

## 目标

`image.format` 增加第四种协议形状 `novelai`，让本机（或任何部署）把生图后端指向 NovelAI 官方 API
即可出图，与现有 `gemini` / `openai` / `modelslab` 平级。**不改 `ImageRequest` 契约，不改
`PlayAssets`**——协议差异只落在新的 `novelaiImage.ts` 里。

## 设计决策

1. **它是「接口格式」不是「产品名」**（沿用现有口径）：`novelai` 描述的是
   `POST /ai/generate-image` + Bearer 的这一套形状。接官方还是接中转由 `image.baseUrl` 决定。

2. **垫图走 img2img，只吃一张**。
   NovelAI 唯一「换场景保角色」的专用能力 Precise Reference **只支持 V4.5**（V5/V4/V3 都不支持），
   不能当通用垫图机制；img2img 全代通用，且与 modelslab 同形（单张 + 图生图）。
   给多张直接报错、不静默取第一张——少垫一张只会画错人，查不出来。差分那条主路径（垫自家 neutral）
   恒为一张，不受影响。

3. **画布按档位折算，落 64 的倍数，封顶官方单图预算**。
   `tierArea(tier)`（`1K`≈1024²、`2K`≈2048²…）当目标面积，按画幅比例展开后对齐到 64 的倍数，
   再按官方单图上限 3,145,728 像素收缩。于是 **`2K`/`4K` 都会顶到上限**（`4K` 拿不到，
   与 modelslab 的「档位无意义」同类，只是这里的天花板高得多）。字面像素照发，越界即报错。

4. **按模型名前缀分代发提示词**：`nai-diffusion-4*` / `nai-diffusion-5*` 走 `v4_prompt` +
   `v4_negative_prompt`（两者必须同时在场，缺一个上游回 500 而不是 400）；其余（`nai-diffusion-3` …）
   走 `params_version: 3` 的 `prompt` + `uc`。分代判据只认名字前缀，不猜能力表。

5. **不带新设置项**。采样器 / 步数 / CFG / 负面词都取官方默认值，落成模块常量并写明出处——
   用户点名的需求只是「支持 NovelAI」，加四个设置项要同时动四处配置面 + 设置页 + README，
   属于另一件事。真要调再说。

6. **响应是 ZIP**。用已在依赖里的 `fflate` 的 `unzipSync` 解出 `image_0.png`；解不出就报错，
   不猜字节。

## 落点清单

| 文件 | 改动 |
| --- | --- |
| `apps/server/src/novelaiImage.ts` | 新增：`NovelAiImageGen implements ImageBackend` |
| `apps/server/src/imageFactory.ts` | 加一个分支与 import；注释里的「三款格式」改「四款」 |
| `apps/server/src/imageBackend.ts` | 契约注释补一句第四种形状（无逻辑改动） |
| `apps/server/src/config.ts` | `format` 联合类型 + 两处 `parseEnum` 白名单加 `novelai` |
| `apps/server/src/configApi.ts` | 无逻辑改动（`image` 整块复用 `ServerConfig["image"]`），仅确认 |
| `apps/web/src/api.ts` | `Settings["image"]["format"]` 联合类型加 `novelai` |
| `apps/web/src/views/SettingsScreen.tsx` | 下拉加 `novelai` 选项；提示文案补一句认证是 Bearer token |
| `apps/server/test/novelaiImage.test.ts` | 新增：分代请求体、ZIP 解包、画布、多垫图报错、错误报文 |
| `README.md` | 「接口格式」行、`apiKey`/`baseUrl`/`model`/`size`/`reference` 行、示例 C、格式对比表 |
| `apps/server/AGENTS.md` | 「生图配置」一节补 `novelai` 的形状与三条铁律 |
| `docs/features/261009-novelai-image/*` | research / plan / summary |

## 验证

- `pnpm --filter @aivn/server typecheck` + `pnpm --filter @aivn/web typecheck`（静态验证必须有）。
- 只跑新增的 `test/novelaiImage.test.ts` 与受影响的 `config.test.ts` / `configApi.test.ts`。
- **不打真 API**：没有 NovelAI 凭据，也用不上——契约用假 fetch 锁死。
- 用户侧验收：设置页选 `novelai` 后字段提示与示例是否自洽（1 条，截图）。
