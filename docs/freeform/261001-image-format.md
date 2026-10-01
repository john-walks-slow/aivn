# 生图配置：按接口格式适配，不按产品名

（2026-10-01）

## 为什么改

原来的配置面是产品名的形状：`STAGE_IMAGE_BACKEND=cpa|flow2api` 二选一，再加一组 `STAGE_FLOW_*`。
产品名一旦进配置，换一家网关就得改代码——cpa 那条路里写死了两种协议（seedream 走
`/images/generations`、gemini 模型走 chat/completions SSE 流式出图），flow2api 那条路里写死了
别名白名单。

现在配置只描述**协议形状**：

| | `STAGE_IMAGE_FORMAT=gemini` | `STAGE_IMAGE_FORMAT=openai` |
| --- | --- | --- |
| 端点 | `POST {base}/v1beta/models/{model}:generateContent` | `POST {base}/v1/images/generations` |
| 认证 | `x-goog-api-key` | `Authorization: Bearer` |
| 画幅 | `generationConfig.imageConfig.aspectRatio` | 没有画幅参数，并进 `size`：档位按总像素量级换算，长短边各自对齐 16 的倍数 |
| 垫图 | `inlineData` 排在提示词之后 | 接口没有参考图入参；带垫图的请求直接报错，不静默丢 |
| 返回 | `candidates[0].content.parts[].inlineData`（`fileData` 单独报错） | `data[0].b64_json` 或 `data[0].url`（远端 url 由本站下载） |

地址 / 模型 / 档位三个键两种格式共用：`STAGE_IMAGE_BASE_URL`、`STAGE_IMAGE_MODEL`、`STAGE_IMAGE_SIZE`。
代码侧只有 `geminiImage.ts` / `openaiImage.ts` 两个实现与一个装配函数 `createImageBackend()`，
不再认识任何产品名。

## 实测（2026-10-01）

- **cpa 网关 `http://127.0.0.1:9999` 认 Gemini 原生端点**：`gemini-3.1-flash-image:generateContent`
  返回 200 / 14.96s / `inlineData` image-jpeg 353235 字节，`imageConfig.aspectRatio=16:9` 生效
  （1376x768）。原来那条「gemini 模型只能走 chat/completions 流式」的绕路可以不要了，
  而且原生端点还顺带给了垫图能力。`GET /v1beta/models` 也通。
- 同一个请求体打 flow2api `http://127.0.0.1:38000`：形状一致，同样回 1376x768。
- **两家的模型名规则不同**：flow2api 的**别名**模型名（`…-portrait-2k`）把画幅档位钉在名字里，
  此时 `imageConfig` 被忽略（2026-10-01 实测：传 `9:16` 仍回 1376x768）；裸名
  `gemini-3.1-flash-image` 吃 `imageConfig`（实测 `9:16` → 768x1376）。cpa 直接填模型名。
  这条只写进 README 与设置页提示，代码层不做白名单——格式是通用的，具体填什么由部署方决定；
  画幅真被忽略时落盘前的 `PlayAssets.assertCanvas` 会拦住。

## 受影响的行为

- `STAGE_IMAGE_BACKEND`、`STAGE_FLOW_*` 全部删除。
- `STAGE_IMAGE_SIZE` 的语义从「WxH 字符串」变成「档位」：gemini 原样透传给上游
  `imageConfig.imageSize`，openai 侧按画幅换算（16:9 的 `1K` → `1360x768`）。档位取值与大小写
  后来按官方规范校准过，见 `261001-image-interface-specs.research.md`。
- 默认单图超时 150s → 180s：带垫图的立绘差分实测 138s，150s 太贴。
- cpa 走 gemini 格式时不再借用 LLM 网关的 `STAGE_BASE_URL`，生图地址独立配置。
