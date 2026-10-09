# 生图接口新增 NovelAI 格式（261009）· 实施总结

## 做了什么

`image.format` 从三档变四档，新增 **`novelai`**：`POST {base}/ai/generate-image`、`Authorization: Bearer`
（填持久化 API token，`pst-` 开头）、响应是 ZIP。设置页、README、模块指引都跟上了。

改动面（全部在 worktree `feat/novelai-image`，不触碰 `packages/core` 与 `packages/stage`）：

| 文件 | 内容 |
| --- | --- |
| `apps/server/src/novelaiImage.ts` | 新增后端：请求体组装、分代提示词结构、画布换算、垫图 fit、ZIP 解包、错误报文 |
| `apps/server/src/imageFactory.ts` / `imageBackend.ts` | 接入第四种格式（含契约注释） |
| `apps/server/src/config.ts` / `apps/web/src/api.ts` / `SettingsScreen.tsx` | 格式联合类型与设置页下拉（枚举顺序四处统一为 `gemini|modelslab|novelai|openai`） |
| `apps/server/test/novelaiImage.test.ts` | 11 条假 fetch 契约用例 |
| `README.md` / `apps/server/AGENTS.md` | 字段总表、示例、四格式对比表、novelai 三条口子 |

## 定下来的几件事

1. **垫图走 img2img、只吃一张**。NovelAI 唯一「换场景保角色」的专用能力 Precise Reference
   **官方只支持 V4.5**（V5/V4/V3 都不支持），当不了通用垫图机制。多张直接报错——与 modelslab 同口径。
2. **垫图先 fit 到画布再发**（`fitToCanvas`，sharp `contain` + 补不透明黑 + 编码 PNG）。
   上游要求图生图源图与画布同尺寸、且收 base64 PNG，而我们的垫图常是 **JPEG 原片**
   （`media-cache/sprite-sources/<id>/neutral.jpg`）——这条是首轮检视抓出来的阻塞项，做法对齐
   novelai-bridge 的 `fit_image_to_canvas`。
3. **提示词结构按模型名前缀分代**：`nai-diffusion-4*` / `-5*` 走 `v4_prompt` + `v4_negative_prompt`
   （**两个必须同时在场，缺一个上游回 500 而不是 400**），更早的走 `prompt` + `uc`。
4. **画布**：档位当目标面积按画幅展开、对齐 64、朝单图 3,145,728 像素预算收缩（`2K`/`4K` 都顶到上限）；
   字面像素必须是 64 的倍数、越界报错。
5. **不加设置项**：采样器 / 步数 / CFG / 负面词取官方默认，落成模块常量。

## 验证与检视

- 静态：server / web `typecheck` 均过。
- 用例：`test/novelaiImage.test.ts` 11 条全绿；受影响的 `config` / `configApi` / `image` / `settingsStore`
  四份共 53 条全绿。**没跑全量**，也没打真外部 API（本机无 NovelAI 凭据）。
- 检视：`reviewer` 两轮。第 1 轮「不准入」（1 阻塞 + 5 建议），修完第 2 轮**条件准入**，
  阻塞与建议 R1–R4 全部落地；S5（V4+ 是否补发 `uc`）经双方独立核对 novelai-bridge 的 wire 结构
  **确认原样保留正确**。详见 [review.md](261009-novelai-image.review.md)。
- 实机验收：dev 实例已交付（隧道 + 截图），见 [validation.md](261009-novelai-image.validation.md)。

## 留给后人的两条

- **用这一档要自己掂量官方的账**：官方 API 明确要求请求由人发起、一次一个，本引擎默认并发 6，
  跑批量实验请把「出图并发」调到 1；另外立绘固定 `2K`（1152x2048 ≈ 2.36MP）会超出 Opus 免费带
  （≤1,048,576 像素），每张都烧 Anlas。两条都写进 README 了。
- **`dsh-aivn` 侧没同步**：那边 `src/media/image.ts` 是另一份实现，要它支持 NovelAI 是独立一次改动。
