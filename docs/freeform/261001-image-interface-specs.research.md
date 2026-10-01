# 生图接口规范核对：Gemini 原生 vs OpenAI images

（2026-10-01，`STAGE_IMAGE_FORMAT=gemini|openai` 这套实现落地之后回头核对一遍）

## 一句话

我们发出去的请求形状与两款官方接口一致，两处不是「形状不对」而是**取值用了非官方词**：档位写成了
小写 `1k`（官方明文拒小写），画幅白名单比官方窄一半，OpenAI 侧的尺寸换算按「短边像素」而不是官方
的「总像素量级」，于是换一台 Gemini/OpenAI 就会出问题。本轮把这几处按规范改齐。

## 资料来源

| 用途 | 地址 | 取法 |
| --- | --- | --- |
| Gemini REST 参考（`models.generateContent` 的全部请求字段） | <https://ai.google.dev/api/generate-content> | 抓到 HTML 后转纯文本，含 `GenerationConfig` / `ImageConfig` / `AspectRatio` / `ImageSize` / `Modality` / `ResponseFormatConfig` 的定义 |
| Gemini 生图指南（分辨率表、参考图上限、大小写要求） | <https://ai.google.dev/gemini-api/docs/image-generation> | 同上 |
| OpenAI images 参数与取值 | <https://github.com/openai/openai-node/blob/master/src/resources/images.ts> | `platform.openai.com` 对本机 403（Cloudflare 拦），改用官方 SDK 源码——它由官方 OpenAPI 生成，参数注释即官方文档原文 |

> 子代理本轮不可用（deep-researcher、resume、最小探针三连失败），web research 全部自己跑。

## Gemini 侧

**端点**：`POST {base}/v1beta/models/{model}:generateContent`，认证 `x-goog-api-key`（官方等价）。
v1beta 不是过渡写法，`GenerationConfig.imageConfig` 至今仍是官方字段。

**画幅** `generationConfig.imageConfig.aspectRatio`，官方 14 个取值
（`1:1 / 1:4 / 1:8 / 2:3 / 3:2 / 3:4 / 4:1 / 4:3 / 4:5 / 5:4 / 8:1 / 9:16 / 16:9 / 21:9`）。
给了参考图而不给画幅时，模型按参考图的画幅出图。

**档位** `generationConfig.imageConfig.imageSize`，是 `string` 而非枚举，可选值
`512` / `1K` / `2K` / `4K`（另有网关接受的 `512P` / `512PX` 别名），默认 `1K`。
指南里写得最重的一句：

> You must use an uppercase 'K' (e.g. 1K, 2K, 4K). Lowercase parameters (e.g., 1k) will be rejected.

**档位的语义是总像素量级**（1K ≈ 1024²、2K ≈ 2048²、4K ≈ 4096²），画幅只决定这块面积怎么摆。
官方分辨率表（3.1 Flash Image，W×H）：

| 画幅 | 512px | 1K | 2K | 4K |
| --- | --- | --- | --- | --- |
| 1:1 | 512x512 | 1024x1024 | 2048x2048 | 4096x4096 |
| 4:3 | 600x448 | 1200x896 | 2400x1792 | 4800x3584 |
| 9:16 | 384x688 | 768x1376 | 1536x2752 | 3072x5504 |
| 16:9 | 688x384 | 1376x768 | 2752x1536 | 5504x3072 |
| 21:9 | 792x168 | 1584x672 | 3168x1344 | 6336x2688 |

**`responseModalities: ["IMAGE"]`**：`IMAGE` 是官方 `Modality` 枚举的一个值，只给图片不给文字
是对的（我们要的就是图，文字 token 不用付）。

**参考图**：塞进 `parts[].inlineData`（`{mimeType, data}`），官方示例的顺序也是文本在前、图片在后。
Gemini 3 系上限 14 张，其中 3.1 Flash Image 最多 10 张物体 + 4 张角色一致性图，3 Pro Image 最多
6 + 5 + 3。我们只用 1 张（角色 neutral 定妆照）。

**新版 Interactions API**：官方现在主推 `POST /v1beta/interactions`，参数换成
`response_format: {type: "image", aspect_ratio, image_size}`，输出走 `interaction.output_image.data`。
`:generateContent` 没被废弃，REST 参考里 `imageConfig` 仍在。flow2api / cpa 两大网关都只实现
后者，所以保持现状；需要迁的时候是「端点 + 请求体 + 取图路径」三处一起换，配置面不用动。

## OpenAI 侧

**端点**：`POST {base}/v1/images/generations`，`Authorization: Bearer`。
返回 `data[0].b64_json`（GPT image 模型恒为 base64）或 `data[0].url`（dall-e 的默认，**URL 只在 60 分钟内有效**，
所以必须当场下载——我们就是这么做的）。

**`size` 是字面 `WxH`，合法值按模型分家**（SDK 参数注释原文）：

| 模型 | 允许的 `size` |
| --- | --- |
| `gpt-image-2` 系（`-2026-04-21`、`-2.5-sunburst`、`-2.5-flare`） | **任意** `WIDTHxHEIGHT`：宽高都要能被 16 整除、画幅在 1:3–3:1，超过 2560x1440 属实验特性，上限 `3840x2160` |
| `gpt-image-1` / `-1-mini` / `-1.5` / `chatgpt-image-latest` | `1024x1024` / `1536x1024` / `1024x1536`，另加 `auto` |
| `dall-e-3` | `1024x1024` / `1792x1024` / `1024x1792` |
| `dall-e-2` | `256x256` / `512x512` / `1024x1024` |

**没有画幅参数**：想要 16:9 就得自己算出 `WxH`。其余参数：`quality`（`standard/hd/low/medium/high/xhigh/max/auto`）、
`background`（`transparent/opaque/auto`）、`output_format`（`png/jpeg/webp`，GPT image 默认 png）、
`output_compression`、`moderation`、`style`（仅 dall-e-3）、`n`（1–10）、`stream` + `partial_images`。
`response_format` 只对 dall-e 有意义。

**图生图不在这个端点**：`POST /v1/images/edits`，multipart/form-data，GPT image 模型可传 `image[]`
最多 16 张（png/webp/jpg，各 <50MB），另有 `mask`、`input_fidelity`。我们没接这个端点，所以
「openai 格式不吃垫图」是实话，但它是**端点的选择**而不是接口没有这个能力。

## 逐条对照我们的实现

| 项目 | 我们原来 | 官方 | 处置 |
| --- | --- | --- | --- |
| Gemini 档位取值 | `1k` / `2k` / `4k` | `512` / `1K` / `2K` / `4K`，**小写被拒** | 改大写；配置里仍接受小写，装配时归一化后发大写 |
| 档位语义 | 注释写「短边像素量级」 | 总像素量级 | 按总像素量级重写注释与换算公式 |
| 画幅白名单 | 5 个（16:9 / 9:16 / 1:1 / 4:3 / 3:4） | 14 个 | 放宽到两款接口的交集 10 个；被排除的 4 个（1:4 / 4:1 / 1:8 / 8:1）是 OpenAI 的画幅下限 1:3 收不下的 |
| OpenAI 尺寸换算 | 短边取档位像素（16:9 的 1K → 1824x1024 = 1.87MP） | 无「档位」概念，只有 `WxH` | 改成总像素量级换算（16:9 的 1K → 1360x768 ≈ 1.04MP，与 Gemini 同量级）；两侧档位从此同义 |
| OpenAI 尺寸越界 | 4K 算出 7280x4096 直接发出去 | 上限 3840x2160 | 发请求前拦下来并说清该改什么 |
| OpenAI 老模型 | 只有档位，等于在 gpt-image-1 上必 400 | 只认三个标准尺寸 | `STAGE_IMAGE_SIZE` 接受字面 `WxH`，原样发给 `size` |
| Gemini 出图失败原因 | `parts` 为空只报「没有图像内容」 | — | 把 `finishMessage` / `finishReason` / `promptFeedback.blockReason` 带出来（本机实测正是只有它） |
| 垫图顺序 | 提示词在前、垫图在后 | 官方示例同序 | 不改 |

## 本机实测（2026-10-01）

cpa 网关 `127.0.0.1:9999` 走的是真 Gemini，回的 400 报文直接给了官方枚举：

| 请求 | 结果 |
| --- | --- |
| `imageSize: "1K"`, `16:9` | 200 / 28.7s / **1376x768**（与官方表一致） |
| `imageSize: "2K"`, `16:9` | 200 / 141.7s / **2752x1536**（与官方表一致） |
| `imageSize: "1k"`（小写）, `16:9` | 200 / 17.3s / 1376x768 —— **网关宽容，官方不宽容**，所以本地测不出来 |
| `imageSize: "8K"` | 400 `Unsupported image_size '8K'. Supported values are: 1K, 2K, 4K, 512, 512P, 512PX.` |
| `imageSize: "1K"`, `4:3` | 200 / 13.1s / **1200x896**（官方表一致） |
| `imageSize: "1K"`, `21:9` | 200 / 48.6s / **1584x672**（官方表一致） |
| `aspectRatio: "5:3"` | 400 `aspect_ratio must be one of '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', or '21:9'` |

flow2api `127.0.0.1:38000`（Google Flow 逆向网关）：

| 请求 | 结果 |
| --- | --- |
| 裸名 `gemini-3.1-flash-image`, `1K`, `16:9` | 200 / 106.4s / 1376x768 |
| 裸名, `1K`, `9:16` | 200 / 62.4s / 768x1376 —— `imageConfig` 生效 |
| 裸名, `2K`, `16:9` | 200 / 170.7s / **1376x768** —— 档位被解析成 `…-landscape-2k`，上游放大失败后静默退回 1K（与 `261001-image-speed.md` 记录的一致，大小写不影响） |
| 裸名, `4K`, `16:9` | 503 `当前模型需要 Ult 账号…: gemini-3.1-flash-image-landscape-4k` —— 档位确实被解析进模型别名 |
| 别名 `…-landscape-2k`, `1K`, `9:16` | 200 / 188.0s / **1376x768** —— 别名赢，`imageConfig` 被忽略 |

## 由此改掉的两条旧结论

- README 原写「`3:4` / `4:3` 会被静默改成 1200x896 横图」——错。1200x896 就是官方 `4:3` 的 1K 输出
  （见上表），那条是 flow2api 别名模型名把画幅钉死造成的观感，不是接口行为。cpa 上 4:3、3:4、21:9 都正确。
- `261001-image-speed.md` 里「`2k` 与 `1k` 逐像素相同」——那是 flow2api 的行为（它把 `2k` 翻成模型名
  后缀 `-2k`，上游放大失败时静默退回原图）。cpa 上 `1K` 与 `2K` 像素差一倍（1376x768 vs 2752x1536），
  官方表也是这么写的。

## 没做的部分

- `STAGE_IMAGE_SIZE` 不开放官方那个 `512`（0.5K，仅 3.1 Flash Image 有）：产品只用得上三个常规档位。
- 不接 OpenAI 的 `/v1/images/edits`：那是一条 multipart 端点，接了 openai 格式才能用垫图；
  要做的话得单独一轮（多模态表单、各网关对 `image[]` 的支持度不同）。现在带垫图的请求在 openai
  格式下报错并指路，不静默丢弃。
- 不迁 Interactions API：网关侧没有，迁了换不到东西。