# NovelAI 生图接口调研（261009）

调研目标：为 `image.format` 增加第四种协议形状 `novelai`。只接官方 API，不接第三方中转。

## 一句话

`POST {base}/ai/generate-image`，`Authorization: Bearer <persistent token>`，请求体是
`{input, model, action, parameters}`，**响应是一个 ZIP**（里面 `image_0.png`）。
模型分两代：V4/V4.5/V5 走 `v4_prompt` 结构，V3 及更早走 `prompt` + `uc`。

## 端点与认证

| 项 | 值 |
| --- | --- |
| 主机 | `https://image.novelai.net`（**不是** `api.novelai.net`，后者对生图回 `model must be a valid enum value`） |
| 路径 | `/ai/generate-image` |
| 认证 | `Authorization: Bearer <token>`；token 是持久化 API token（`pst-` 前缀），不是登录得到的 30 天 access token |
| 请求 | `application/json`（官方客户端现在默认 multipart，JSON 是仍在支持的旧格式，两者像素一致） |
| 响应 | ZIP（`binary/octet-stream` / `application/x-zip-compressed`），内含 `image_0.png` |

来源：[Using the API（Aedial UKB）](https://aedial.github.io/novelaiUKB/en/Using-the-API.html)、
[V5 直连实测](https://dev.to/ilan_kim/calling-the-novelai-v5-api-directly-nai-diffusion-5-full-request-body-paramsversion-4310-133a)。

## 请求体

```json
{
  "input": "<正向提示词>",
  "model": "nai-diffusion-4-5-full",
  "action": "generate",
  "parameters": { "...": "见下" }
}
```

### 参数（核心）

| 参数 | 说明 |
| --- | --- |
| `width` / `height` | 必须 64 的倍数；单边 ≥64；官方历史上把单图上限标为 **2048x1536 = 3,145,728 像素**（2023 年的分辨率放开公告） |
| `n_samples` | 本层固定 1（多张会成倍烧 Anlas） |
| `seed` | 0 或不给 = 随机 |
| `sampler` | 官方默认 `k_euler_ancestral` |
| `steps` | V4/V4.5 默认 28，V5 默认 23 |
| `scale` | CFG，官方默认 5（V4.5/V5）～6 |
| `noise_schedule` | `native` / `karras` / `exponential` / `polyexponential`；官方站点默认 `karras` |
| `qualityToggle` | 官方站点默认开：给提示词补 `masterpiece, best quality, very aesthetic, absurdres` |
| `negative_prompt` | 负面词（V4+ 实际读的是 `v4_negative_prompt.caption.base_caption`） |
| `uc` | **只给 V3 及更早**的负面词；V4+ 走 v4 结构（见下） |
| `params_version` | V5 官方发 4、V4.x/V3 发 3；实测该值被上游忽略（4/3/1/0 出图逐像素相同） |

### V4 / V4.5 / V5 的提示词结构

V4 及之后的模型要求 **`v4_prompt` 与 `v4_negative_prompt` 同时在场**——只给一个或都不给
不是 400 校验错，而是 **500 Internal Server Error**（V5 实测同样如此，V5 没有 `v5_prompt`）。

```json
"v4_prompt": {
  "caption": { "base_caption": "<正向提示词>", "char_captions": [] },
  "use_coords": false,
  "use_order": true
},
"v4_negative_prompt": {
  "caption": { "base_caption": "<负面词>", "char_captions": [] },
  "use_coords": false,
  "use_order": false
}
```

V3 及更早（`nai-diffusion-3` / `nai-diffusion-furry-3`）没有这一层，正向走 `parameters.prompt`
（与顶层 `input` 同串）、负向走 `parameters.uc`。

### 图生图（垫图）

`action: "img2img"` + `parameters.image`（base64 PNG，**不带 data URI 前缀**）+ `strength`（0.01–0.99）
+ `noise`。源图按请求画布使用；官方与主流客户端都会先把源图缩放到目标画布再发。

### Precise Reference（角色参考）

`director_reference_images[]` / `director_reference_descriptions[]` / `director_reference_strength_values[]`
等五条并行数组，专为「换场景保角色」设计。**但官方文档明确它只支持 V4.5 模型**，V5 不支持
（第三方实测：发过去 schema 不拦，但没验证是否真是「忽略且照常计费」）。V3/V4 也不支持。

结论：**不能拿 Precise Reference 当通用的垫图机制**，只能用 img2img。这与已有的 modelslab
格式同形（单张垫图 + 图生图），一行兜底逻辑都不用新造。

## 与我们现有四要素的对应

| 我们的概念 | NovelAI 的落点 |
| --- | --- |
| `format` | 新增 `novelai` |
| `image.baseUrl` | `https://image.novelai.net`（**不带** `/ai`） |
| `image.apiKey` | 持久化 API token，走 `Authorization: Bearer` |
| `image.model` | `nai-diffusion-4-5-full` / `nai-diffusion-5-full` / `nai-diffusion-3` …，按前缀分代 |
| `image.size` | 档位按 `tierArea` 折算目标面积，落到 64 的倍数上；像素预算 3,145,728 |
| `references[]` | img2img 的 `image`；**只吃一张**，多张直接报错（同 modelslab） |
| 垫图策略 `image.reference` | 与 gemini / modelslab 同义：`neutral` 时差分垫定妆照 |

## 来源

- [Using the API — Aedial NovelAI UKB](https://aedial.github.io/novelaiUKB/en/Using-the-API.html)
- [Calling the NovelAI V5 API directly（请求体逐字段实测）](https://dev.to/ilan_kim/calling-the-novelai-v5-api-directly-nai-diffusion-5-full-request-body-paramsversion-4310-133a)
- [NovelAI 官方文档 · Precise Reference](https://docs.novelai.net/en/image/precisereference/)（「only available on our V4.5 models」）
- [NAIWeaver API_DOCUMENTATION.md v0.8.2](https://github.com/ststoryweaver/NAIWeaver/blob/v0.8.2/API_DOCUMENTATION.md)
- [novelai-bridge `generate.rs`（画布与能力闸门的实现参考）](https://docs.rs/novelai-bridge/latest/src/novelai_bridge/client/generate.rs.html)
- [NovelAI SDK（尺寸 64 的倍数、模型能力表）](https://yuanhuakk.github.io/novelai-sdk-unofficial/en/image-generation/models-and-sizes.html)
- [Introducing nai_smea & higher Image Generation Resolutions（2048x1536 上限出处）](https://blog.novelai.net/introducing-nai_smea-higher-image-generation-resolutions-9b0034ffdc4b)
