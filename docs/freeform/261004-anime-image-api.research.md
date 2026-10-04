# 2026 年生图 API 调研：全参数控制 · 低审查 · 二次元向

- 调研时间：2026-10-04
- 调研目标：2026 年当前可付费购买、参数全面且高级控制能力强（尺寸/步数/seed/LoRA/ControlNet/img2img/inpaint）、审查尺度宽松（最好近乎无审查）、擅长二次元风格、提供 API 的生图服务
- 说明：本报告只罗列检索到的事实与出处，不做主观推荐。凡"官方文档/官方定价页"标为【一手】，第三方评测、对比站、厂商博客标为【二手】，其中部分站点带明显 SEO/AI 生成痕迹，可信度单独标注。

---

## 0. 结论速览（事实对照，不含推荐）

按"审查尺度 × 参数完整性"两个硬维度分层，检索到的服务可分为五类：

| 层级 | 服务 | 审查（官方口径） | 全参数能力 | 计价 | 出处 |
|---|---|---|---|---|---|
| L1 自建 | RunPod / Modal / 任意 GPU 云跑 ComfyUI | 平台无内容策略；由你自己决定 | 无上限（原版 ComfyUI 全部节点） | GPU 秒计费（RTX4090 约 $0.5–0.7/h，单图约 $0.01–0.03） | [RunPod 文档](https://docs.runpod.io/tutorials/serverless/comfyui)、[worker-comfyui](https://github.com/runpod-workers/worker-comfyui/blob/main/README.md) |
| L2 模型商直供（可放 NSFW） | ModelsLab / StableDiffusionAPI | 官方站有"Uncensored AI image generator API"页，`safety_checker:"no"` | Checkpoint + 多 LoRA + 多 ControlNet + IP-Adapter + inpaint + img2img + 自训 | 平铺 $0.0047/图；$21/$47/$149 月订阅 | [ModelsLab 定价](https://modelslab.com/pricing)、[ControlNet 文档](https://docs.modelslab.com/image-generation/controlnet/controlnet-main) |
| L2 | Civitai Orchestration | 有成熟内容政策；NSFW 需 yellow Buzz，`allowMatureContent` 显式开关 | 任意 Civitai checkpoint + LoRA 叠加 + img2img；**文档中未暴露 ControlNet** | 1,000 Buzz = $1；SDXL 1024² ≈ 8 Buzz | [提交作业文档](https://developer.civitai.com/orchestration/guide/submitting-work)、[SDXL recipe](https://developer.civitai.com/orchestration/recipes/sdxl) |
| L2 | Replicate（社区模型） | 条款禁 NCII/非法色情/CSAM/极端血腥，**未禁止合意成人内容**；由各模型自带 safety checker 决定 | 社区 fork 提供 2 LoRA + 3 ControlNet + inpaint/img2img + seed/steps/CFG 全覆盖，可关 safety checker | 按 GPU 秒（L40S $0.000975/s，单次约 $0.005–0.008） | [Replicate 定价](https://replicate.com/pricing)、[AnIllustrious Multi-ControlNet LoRA](https://replicate.com/mewforest/anillustrious-multi-controlnet-lora) |
| L3 NSFW 专用网关 | NoCensor.ai | 明示"不应用内容过滤"（CSAM 等窄类除外） | 尺寸 + 最多 2 LoRA + img2img denoise + 自训 LoRA + pipeline；**无 ControlNet** | 75 credits/图；$25/2,750 credits ≈ $0.68/图 | [开发者文档](https://nocensor.ai/developers)、[定价](https://nocensor.ai/pricing) |
| L3 | Siray / SpicyAPI / WaveSpeed Spicy 线 | "Spicy"= 默认审核解除，仅限合法成人内容 | 尺寸/比例/seed/负向；LoRA 仅部分（Qwen 系）；**无 ControlNet** | Siray Z-Image $0.004，Qwen3 Pro Spicy $0.046 | [Siray 定价对比](https://blog.siray.ai/uncensored-image-endpoint-comparison/)、[SpicyAPI 定价](https://spicyapi.ai/pricing) |
| L3 | Venice AI | 官方称"无内容过滤"，模型带 `uncensored: true` 标记 | 负向/seed/cfg_scale/宽高/比例/变体数/style preset；**无 LoRA/ControlNet** | $0.01/图的 WAI-Illustrious、Chroma、Lustify 系 | [图像模型列表](https://docs.venice.ai/models/image)、[model list 文档](https://docs.venice.ai/api-reference/endpoint/models/list) |
| L4 二次元专属 | NovelAI 官方 API | 内部模型分 `full` 与 `curated`；禁写实向"; 动漫 NSFW 可 | 步数/采样器/guidance/seed/多角色 prompt/Vibe Transfer/Character Reference/img2img/infill | 订阅制 $10/$15/$25 月；Opus 标准尺寸免费 | [API 文档](https://api.novelai.net/docs)、[订阅文档](https://docs.novelai.net/en/subscription/) |
| L4 | PixAI Platform API | 未在文档中披露审查尺度（见 §7 缺口） | 模型版本 + 最多 5(会员 15) LoRA + 比例/批次/seed/采样器；Tsubaki 系列支持 mode 档位 | 会员 $9.99–$49.99/月；按 credits | [Create image 文档](https://platform.pixai.art/en/docs/api-v2/image/createImage) |
| L5 参数强但**明令禁止** NSFW | fal.ai / Runware / Novita / Together AI 等 | AUP 明写禁止"sexually explicit content"或性相关内容 | fal `flux-general` 支持 LoRA+ControlNet+IP-Adapter；Runware 支持 LoRA+ControlNet+IP-Adapter+自传模型；Together AI 有 `disable_safety_checker` 开关 | 见 §5 | [fal AUP](https://fal.ai/legal/acceptable-use-policy)、[Runware ControlNet](https://runware.ai/docs/learn/controlnet)、[Together API schema](https://docs.together.ai/reference/post-images-generations) |

**核心事实**：检索到的服务中，同时满足"官方不禁止 NSFW + ControlNet 可控 + LoRA 可叠加 + img2img/inpaint + 动漫 checkpoint 可选"这四项的，只有 **ModelsLab** 与 **Replicate 社区模型**；**自建 ComfyUI** 则无任何一项受限。二次元专项平台（NovelAI / PixAI / SeaArt / TensorHub）审查宽松但控制面偏"平台自研参数"，没有通用 ControlNet。

---

## 1. 判断维度与"审查尺度"实际含义

### 1.1 用户提出的能力清单，在 2026 年的落地情况

| 需求 | 说明（检索到的现状） |
|---|---|
| 尺寸 | SD 系平台（ModelsLab/Civitai/Runware/Replicate）支持任意宽高；ModelsLab 文档写 width/height 256–1024 且被 8 整除，但其站点宣称"no resolution upcharge up to 2048×2048"（两者口径不一致，见 §5.1 备注） |
| 步数 | 普遍可调：Civitai SDXL `steps: 1–150`；Replicate 社区模型 `num_inference_steps: 1–500`；NovelAI `1–50` |
| seed | 通用支持。注意 Civitai 的 **CLI 不暴露 seed**，只能通过 raw graph（`--print-input`/`--input`）传入 |
| LoRA | 三种形态：① URL 传 safetensors（Replicate / Together AI / Runware / Novita）；② 平台内模型 ID（ModelsLab `lora_model` 逗号分隔；Civitai AIR URN 字典；PixAI `loras[]`）；③ 自训（ModelsLab DreamBooth / Runware 训练 API / Civitai LoRA 训练 recipe / PixAI 每月免费训练额度） |
| ControlNet | ModelsLab 有独立 endpoint，20 种控制类型，可多 ControlNet 串联；Replicate 社区 fork 支持 3 槽；fal `flux-general/inpainting` 支持（但平台禁 NSFW）；Runware 支持多 ControlNet + start/stop step + controlMode；**Civitai / NovelAI / PixAI / Venice / NoCensor 的公开文档中未出现 ControlNet 参数**（PixAI 站点侧有 ControlNet，但 Platform API 文档未列） |
| img2img | 普遍支持。命名差异：Civitai sdcpp 用 `strength`、comfy 用 `denoiseStrength`；NoCensor 用 `denoise`；ModelsLab 用 `init_image` + `strength` |
| inpaint | ModelsLab 有独立 inpaint endpoint（`init_image` + `mask_image`）；Replicate 社区模型有 `mask` 字段；fal `flux-general/inpainting` 有 `mask_url`；NovelAI 有 `action: infill` |

### 1.2 "几乎完全无审查"在 2026 年的真实分布

- **明示允许成人内容**：NoCensor.ai、Venice AI（`uncensored` 标记）、Siray/SpicyAPI/WaveSpeed 的"Spicy"SKU（口径是"解除默认审核、仅限合法成人内容、零容忍 CSAM"）、Replicate（**未禁止**合意成人内容，但不背书、可按模型移除）、ModelsLab（营销上主打"uncensored"）。
- **有明确成熟内容开关**：Civitai（`allowMatureContent` + yellow Buzz 专用货币）、Eachlabs（`enable_safety_checker: false`，仅 Seedream v4.5 与 Wan 视频模型支持）、Chutes（自建 chute 时 `safety_checker=False`）、fal（`enable_safety_checker` 可关，但部分模型"关闭需账户授权，未授权请求一律检查"）。
- **明令禁止**：
  - fal.ai AUP 第 1.4 条把"sexually explicit content"列入禁止项，并禁止"规避任何安全护栏、内容过滤器"，Trust & Safety 页面另称已接入 **OpenAI Omni 审核 API** 做实时过滤（[AUP](https://fal.ai/legal/acceptable-use-policy)、[Trust & Safety](https://fal.ai/legal/trust-and-safety)）。
  - Novita AUP 自 2026-08-05 起把"Is sexually explicit"写入禁止条款（转引自 [18models 政策追踪页](https://18models.ai/policy-tracker)，该页为厂商站点，需自行复核）。
  - Tensor.Art 自 2025-11-27 起主站转为纯 SFW，NSFW 迁到 TensorHub，用独立的更高价 Token 体系（[政策说明转引](https://goongen.ai/blog/tensor-art-nsfw-policy)）。
  - NovelAI 内部把部分模型限定为 `curated`，且平台明确禁止写实向内容（[AI Dynamic Storytelling Wiki 条目](https://aids.miraheze.org/wiki/NovelAI) 记为 "Photorealism prohibited in image generation"）。

### 1.3 一个反复出现的关键机制：安全开关的"静默降级"

- fal 部分模型（如 `fal-ai/pony-v7`）文档写明：`enable_safety_checker` 默认 **false**，但"禁用它需要账户授权；未授权请求一律会被检查"（[pony-v7 llms.txt](https://fal.ai/models/fal-ai/pony-v7/llms.txt)）。
- ModelsLab 文档中 `safety_checker` 的默认值在不同端点不一致：enterprise text2img 示例为 `"no"`，CommonImageGenerationParams 里 `default: false`，但部分说明文案写 "Default: yes"。同一端点的默认值口径自相矛盾（[text2img](https://docs.modelslab.com/enterprise-api/text-to-image/text2img)、[ControlNet](https://docs.modelslab.com/enterprise-api/text-to-image/controlnet-ep)）。
- Replicate 的 per-model safety checker 由模型作者决定，且平台保留随时移除模型的权利（[RawSignal 汇总](https://rawsignalai.com/directory/developer-apis/replicate)）。
- 第三方测试站反复提到"文生图能过、图生图被过滤"的隐性差异（[HackAIGC 对比](https://www.hackaigc.com/blog/best-nsfw-ai-image-generators-comparison-2026)，二手）。

---

## 2. 二次元专项平台（动漫原生 checkpoint）

### 2.1 NovelAI（Anlatan LLC）

**API 存在性确认**【一手】
- 官方有 API 文档：`https://api.novelai.net/docs`；图像端点独立在 `https://image.novelai.net`，文本在 `https://text.novelai.net`（[api.novelai.net/docs](https://api.novelai.net/docs)、[novelai-api 源码常量](https://github.com/Aedial/novelai-api/blob/main/novelai_api/_low_level.py)）。
- 调用 `POST /ai/generate-image`，返回 SSE / ZIP 附件；**未订阅返回 402** —— 即 API 访问绑定在订阅上（[OpenAPI 摘录](https://raw.githubusercontent.com/api-evangelist/novelai/refs/heads/main/openapi/novelai-ai-api-openapi.yml)）。
- 第三方开发者的官方口径是"必须向用户索取其 **Persistent API token**"，没有公开的开发者 API Key 发放体系（同 api.novelai.net/docs 首页说明）。

**图像模型**（API 的 `model` 枚举，旧版）：`nai-diffusion`、`safe-diffusion`、`nai-diffusion-furry`、`nai-diffusion-inpainting`、`nai-diffusion-3-inpainting`、`safe-diffusion-inpainting`、`furry-diffusion-inpainting`、`kandinsky-vanilla`、`nai-diffusion-2`、`nai-diffusion-3`；2026 年在用的是 `nai-diffusion-4-5-full` / `nai-diffusion-4-5-curated`，以及 V5 的 `nai-diffusion-5-full` / `nai-diffusion-5-curated`（[API 文档](https://api.novelai.net/docs)、[wpnews 实测](https://wpnews.pro/news/novelai-v5-on-opus-usage-limits-the-2026-09-21-subscription-anlas-reset-and-the)）。
- 命名区分：`full` 与 `curated` 是两套内容尺度不同的版本；`safe-diffusion` 是明显受限的版本。

**参数面**（合并官方文档 + 社区 SDK）
- 基础：`prompt`、`negative_prompt`、`steps`（1–50，UI 默认 23/28）、`scale`（Prompt Guidance，V3+ 建议 5–6）、`sampler`（Euler Ancestral / Euler / DPM++ 2M / DPM++ 2M SDE / DPM++ SDE / DPM++ 2S Ancestral / DPM Fast / DDIM，各带 SMEA / SMEA DYN 变体）、`noise_schedule`（karras / exponential / polyexponential）、`seed`、`n_samples`（Small 最多 6，Normal/Large 最多 4）、分辨率档（Small/Normal/Large）、`uc_preset`、`quality_toggle`、`cfg_rescale`(Decrisper)、`variety_boost`、`smea` / `smea_dyn`。
- 多角色：`character_prompts[]`，每条含 `prompt` / `uc` / `center` 坐标（[第三方 SDK 文档](https://docs.ttapi.io/api/en/novel/text-to-image)、[novelai-python](https://pypi.org/project/novelai-python/0.7.7/)）。
- 参考图：`character_reference[]`（type: `character&style` / `character` / `style`，strength、fidelity）、`vibe_transfer[]`（image + strength）——这是 NovelAI 版的"角色一致性"方案。
- 生成方式：`action`: `generate` / `img2img`（含 Strength & Noise）/ `infill`（局部重绘）；另有 `/ai/upscale`、`/ai/annotate-image`、`/ai/generate-image/suggest-tags`。
- 社区 Rust 客户端 `novelai_bridge` 的 `GenerateImageRequest` 结构体字段包含 `controlnet: Option<ControlNetConfig>`（[docs.rs](https://docs.rs/novelai-bridge/latest/novelai_bridge/struct.GenerateImageRequest.html)）——暗示较新版本可能有 ControlNet 类能力，但官方文档未展开，**待核实**。

**定价**（官方文档为准）
- Tablet $10/月（1,000 Anlas）、Scroll $15/月（1,000 Anlas，仅上下文更大）、Opus $25/月（10,000 Anlas）；无年付折扣（[订阅文档](https://docs.novelai.net/en/subscription/)、[FAQ](https://docs.novelai.net/en/faq/)）。
- Opus 特权：单张、Normal 尺寸（不同来源写 832×1216 或 1024×1024，官方 FAQ 用 "Normal Sized"）、≤28 步、不用底图时 **0 Anlas**；批量/更大尺寸/更多步数照扣（[FAQ](https://docs.novelai.net/en/faq/)）。
- V5 上线后新增"电池式使用上限"，约 7–9 天回满；**2026-09-21 起订阅 Anlas 在订阅期满时清零**；余额查询端点从 `api.novelai.net` 迁到 `image.novelai.net`（[wpnews 实测](https://wpnews.pro/news/novelai-v5-on-opus-usage-limits-the-2026-09-21-subscription-anlas-reset-and-the)）。
- 单张 Anlas 实测：Small ≈11、Normal ≈26、Large ≈39–45（[Siray/Hakky 汇总](https://book.st-hakky.com/en/data-science/novelai-pricing-plans-comparison-image-generation-tips-and-japanese-settings)）。
- Anlas 加购包（第三方口径，官方未公开列价）：2,000 / 5,000 / 10,000 三档，价格在二手来源间不一致（$3.79 或 $4.79 等）（同 Hakky 文）。

**注意**：有第三方站点宣称 NovelAI "2026 更新了 API 访问"并给了 `novelai-node-sdk` 示例、$12/$18/$30 的"涨价后"价格表（[aitoolsdevpro](https://aitoolsdevpro.com/ai-tools/novelai-guide/)，**疑似 AI 生成内容**），与官方 $10/$15/$25 冲突，**不应采信**。

### 2.2 PixAI（Mewtant Inc.，东京）

**Platform API 确认存在**【一手】：`https://platform.pixai.art`，生成端点 `POST https://api.pixai.art/v2/image/create`（[Create image 文档](https://platform.pixai.art/en/docs/api-v2/image/createImage)、[平台首页](https://platform.pixai.art/en)）。

- 参数：`modelVersionId`（模型版本 ID，从模型页 URL 末段取）、`prompt`、`aspectRatio`、`mode`（仅 Tsubaki 系列：Lite/Standard/Pro/Ultimate）、`batchSize`、`seed`、命名 `style` 预设、`loras[]`（最多 5，会员更多）、负向提示（Tsubaki.2 仅 Pro/Ultimate 支持）、SDXL 模型的采样器/步数/CFG/VAE。
- 模型：Tsubaki.2（DiT，2026-03 发布）/ Tsubaki.3、Haruka v2（SDXL）、Hoshino v2（SDXL）、Reference Pro（参考图编辑）。
- API Key：会员可即时获取；非会员走邮件申请，人工审批最长 5 个工作日（[FAQ](https://platform.pixai.art/en/docs/faq)）。
- API 生成不进入公开历史（同 FAQ）。
- Credits：Tsubaki.2 四档 2,200 / 3,200 / 6,800 / 7,000 credits（[Tsubaki.2 文档](https://docs.pixai.art/docs/models-and-lora/tsubaki2)）。
- 会员：Free（每日 10,000 credits）/ Starter $9.99（年付 $7.99）/ Plus $29.99（$22.99）/ Premium $49.99（$35.99），分别含 30 万 / 100 万 / 200 万月度 credits、3/5/10 次免费 LoRA 训练、5/10/15 LoRA 叠加上限（[会员文档](https://docs.pixai.art/docs/pricing/membership)）。
- 站点侧能力（不等同于 API）：ControlNet、掩膜局部重绘、LoRA 权重 0–2、Hires/Face Fix、img2img、视频（[Panel Tools](https://docs.pixai.art/docs/tools/panel-tools)、[Model Overview](https://docs.pixai.art/docs/models-and-lora/model-overview)）。
- **审查尺度**：本次检索未找到 PixAI 的官方内容政策原文，**未验证**。

### 2.3 SeaArt（SeaCloud API + 站内模型）

**SeaCloud API**【一手】：`https://cloud.seaart.ai`，统一队列形态：
- `POST /v1/queue/{modelId}` → 返回 `request_id` / `status_url` / `response_url` / `cancel_url`（[Create Task 文档](https://cloud.seaart.ai/docs/model-api/multimodal/submit)）。
- 已文档化模型举例：`gpt_image_2`（含 `moderation` 参数）、`gpt_image_1_5`、`nano_banana`、`flux_2_pro`（**`safety_tolerance` 0–5，0 最严、5 最宽，默认 2**；[FLUX.2 pro 文档](https://cloud.seaart.ai/docs/api-reference/model-api/blackforest-labs/flux-2-pro)）、`wan25_i2i_preview_intl`（含 `negative_prompt`、`seed`、`prompt_extend`）。
- 另有官方 Python SDK（`seaart`）与 Next.js 客户端；模型列表 `GET /seaart-cloud-admin-web.../skill/models`（[SDK 手册](https://cloud.seaart.ai/docs/sdk/operation-manual)）。

**SeaArt 站内（非 SeaCloud）**
- 站内模型含 SDXL、Anime 系列、**Illustrious 系列**、NoobAI-XL（官方专文介绍：基于 Illustrious-xl-early-release-v0，用约 1,300 万张 Danbooru + e621 图训练，官方推荐参数 Euler/Euler a、28–40 步、CFG 3.5–5.5、分辨率 768×1344 ~ 1344×768）（[NOOBAI XL 文档](https://docs.seaart.ai/guide-1/6-permanent-events/high-quality-models-recommendation/noobai-xl.md)）。
- 站内控制面：Checkpoint + **最多 5 个 LoRA 叠加**、ControlNet（含 openpose / lineart realistic & anime / depth / ip_adapter）、VAE（含 `kl-f8-anime2`）、img2img、AI Canvas、ComfyUI（[LoRA 文档](https://docs.seaart.ai/guide-1/4-parameters/4-1-model)、[ControlNet 文档](https://docs.seaart.ai/guide-1/2-seaart-ai-basic-function/2-3-controlnet)）。
- 计价：Stamina（日清）+ Credits。免费用户 130 Stamina/天（≈21 图）；SVIP 档位 300/700/2,100/3,500…100,000 Stamina/天。官方商城页同一处给出"Standard Image: 6 Credits ≈ $0.006/Image"与"≈ $0.06/Image"两种换算，**口径冲突**（[商城页](https://www.seaart.ai/mall)）。
- 有第三方博客称 Pro 档（~$29.99/月）才含 API 访问（[Flowith](https://flowith.io/blog/seaart-pricing-2026-free-vs-standard-vs-pro/)，**二手，与 SeaCloud 独立 API 产品线口径不同**）。
- **审查尺度**：未见官方内容政策对 NSFW 的明确许可或禁止，**未验证**。

### 2.4 Yodayo / Moescape
- 站内有 SD1.5 / PXL / Illustrious 三类底模、Spells（=LoRA/Textual Inversion）、Hires.fix、ControlNet、背景移除、图生视频；货币为 Mochi（免费）/ YoBeans（付费）（[模型/参数向导 PDF](https://cdnc.heyzine.com/files/uploaded/a459f658f7ee3e9e86e7776592f41a568c3763a3.pdf)、[YoBeans 文档](https://docs.moescape.ai/getting-started/publish-your-docs-1)）。
- **本次检索未找到公开的第三方开发者 API 文档或 API 定价**，仅有社区 userscript（[Yodayo-Chat-Customizer](https://github.com/pervertir/Yodayo-Chat-Customizer)）。**结论：截至检索时无可确认的官方 API。**

### 2.5 动漫向开源底模生态（决定"哪个平台能出好图"）
- **Illustrious / NoobAI-XL**：SDXL 系，Danbooru+e621 训练；NoobAI-XL 官方推荐 Euler/Euler a、28–40 步、CFG 3.5–5.5（[SeaArt 文档](https://docs.seaart.ai/guide-1/6-permanent-events/high-quality-models-recommendation/noobai-xl.md)）。
- **Pony V7**：已上线 fal，`fal-ai/pony-v7`，$0.03/百万像素（[模型页 llms.txt](https://fal.ai/models/fal-ai/pony-v7/llms.txt)）。Pony V6（SDXL）仍是动漫 NSFW 的主力，V7 转向 Flux 架构（[LocalForge 对比](https://offlinecreator.com/blog/flux-uncensored-vs-sd3-vs-pony-diffusion-2026)，二手）。
- **Chroma**：Flux.1-schnell 衍生的 8.9B 全开源（Apache 2.0）无审查模型，"reintroducing missing anatomical concepts"（[Tensor.Art 模型页](https://tensor.art/models/862384522979764866)、[LocalForge 对比](https://offlinecreator.com/blog/flux-uncensored-vs-sd3-vs-pony-diffusion-2026)）。Venice 与 Chutes 均上线。
- **Z-Image / Qwen-Image / Seedream**：2026 年的新一代（Qwen-Image Apache 2.0、Z-Image Turbo 少步数蒸馏、无负向），已成为"无审查"网关的主力后端（[Siray 对比](https://blog.siray.ai/uncensored-ai-generation/)、[HackAIGC 模型评测](https://www.hackaigc.com/blog/best-uncensored-ai-models-2026-mimo-grok-qwen)，二手）。
- **WAI-NSFW-illustrious / iLustMix（Illustrious 系）/ HassakuXL / Animij / NovaFurryXL / Booba**：可在 Venice、Chutes、ModelsLab、StableDiffusionAPI 等直接以模型 ID 调用（[Venice 模型表](https://docs.venice.ai/models/image)、[Chutes 模型列表](https://chutes.ai/app/chute/vonkaiser-imageclassic/llms.txt)、[ModelsLab uncensored 页](https://stablediffusionapi.com/uncensored-image-generator)）。

---

## 3. 通用生图平台（参数最全的一档）

### 3.1 ModelsLab（原 StableDiffusionAPI）

**产品面**
- 自述 10,000+ 模型（文档另写 "50,000+ models available"），含 SDXL / SD1.5 / SD2.1 / SD3.5 / Flux / Z-Image，以及社区 fine-tune（Realistic Vision、DreamShaper、Pony、Illustrious、CivitAI 导入）；支持上传自训 checkpoint、DreamBooth 训练（[image-generation-api](https://modelslab.com/image-generation-api)、[model-selection 指南](https://docs.modelslab.com/guides/model-selection)、[SD API 页](https://modelslab.com/stable-diffusion-api)）。
- 独立站点 `stablediffusionapi.com/uncensored-image-generator` 宣称 **318+ NSFW 模型**（Wai NSFW Illustrious SDXL、NSFW Flux LoRA、Pornmaster Pro、Pony、Illustrious、inpainting checkpoint 等），并写明"`safety_checker: "no"` + 一个 REST 端点"（[页面](https://stablediffusionapi.com/uncensored-image-generator)）。

**参数面**（文档给出完整 schema）
- 通用：`key`、`model_id`、`prompt`、`negative_prompt`、`width`/`height`（256–1024，8 的倍数）、`samples`（1–4）、`num_inference_steps`、`guidance_scale`（1–20）、`seed`、`safety_checker`（"yes"/"no"）、`safety_checker_type`（blur / sensitive_content_text / pixelate / black）、`scheduler`、`clip_skip`（1–8）、`vae`、`upscale`、`highres_fix`、`base64`、`webhook`、`track_id`、`multi_lingual`。
- LoRA：`lora_model` 逗号分隔多 LoRA（例 `contrast-fix,yae-miko-genshin`）+ `lora_strength`（0.1–1，逗号分隔）。
- IP-Adapter：`ip_adapter_id`（`ip-adapter_sdxl` / `ip-adapter_sd15` / `ip-adapter-plus-face_sd15` / `ip-adapter-plus_sdxl_vit-h` / `ip-adapter-plus-face_sdxl_vit-h`）+ `ip_adapter_scale` + `ip_adapter_image`。
- ControlNet 专用端点：`controlnet_model` 支持 canny / depth / hed / mlsd / normal / openpose / scribble / segmentation / inpaint / softedge / lineart / shuffle / tile / face_detector / qrcode / blur / pose / gray / low_quality；**多 ControlNet** 逗号分隔（`"canny,depth,openpose"`）；`controlnet_conditioning_scale` 0.1–5；`auto_hint`；`guess_mode`；带 `mask_image` 即可做 ControlNet 引导的 inpaint。
- inpaint / img2img 独立端点：`init_image`、`mask_image`、`strength`（默认 0.55–0.7）。
- 端点路径示例：`/api/v7/images/text-to-image`、`/api/v4/dreambooth/...`、`{base}/text2img`、`{base}/img2img`、`{base}/inpaint`、`{base}/controlnet`。
（以上全部来自 [docs.modelslab.com](https://docs.modelslab.com/llms.txt)、[text2img](https://docs.modelslab.com/enterprise-api/text-to-image/text2img)、[ControlNet](https://docs.modelslab.com/enterprise-api/text-to-image/controlnet-ep)、[ControlNet Main](https://docs.modelslab.com/image-generation/controlnet/controlnet-main)、[inpainting](https://docs.modelslab.com/enterprise-api/text-to-image/inpainting)、[img2img](https://docs.modelslab.com/enterprise-api/text-to-image/img2img)、[Flux t2i](https://docs.modelslab.com/image-generation/flux/flux-text-to-image)）

**价格**
- 平铺 **$0.0047/图**，无分辨率加价（宣称 2048×2048 以内）；月付 Basic $21（3,250 次调用、5 并发）、Standard $47（10,000 次、10 并发）、**Open Source Unlimited $149**（自托管开源模型不限量、15 并发）、Enterprise $249 起（专用 GPU、99.9% SLA）。**无免费额度、无试用**（[定价页](https://modelslab.com/pricing)、[对比页](https://modelslab.com/text-to-image-api-pricing-comparison)）。
- 延迟自述 2–4 秒，无冷启动；1,000+ RPM 吞吐。
- ⚠️ 口径冲突：定价页说"no resolution upcharge up to 2048×2048"，但 API 文档写 `width`/`height` 最大 1024（`num_inference_steps` 在某处写 "minimum 1, maximum 20"、在别处写 20–50）。**接入前需以实际端点 schema 为准**。

### 3.2 Civitai（Orchestration API）

**为什么重要**：Civitai 是动漫 fine-tune / LoRA 生态的中心，其编排 API 允许直接以 AIR URN 指定**任意社区 checkpoint**（含 Illustrious、NoobAI、Pony、Lustify 等），并叠加任意多个平台内 LoRA。

**接口**【一手】
- `POST https://orchestration.civitai.com/v2/consumer/workflows?wait=60&whatif=false`，Bearer token（[提交作业](https://developer.civitai.com/orchestration/guide/submitting-work)）。
- 单步便捷端点：`POST /v2/consumer/recipes/{recipe}`（如 `imageGen`）。
- `whatif=true` 可先算价不扣费。

**参数面（imageGen 步骤）**
- SDXL：`engine`: `sdcpp`（默认）| `comfy`；`ecosystem: "sdxl"`；`model`（AIR URN）；`prompt` ≤10,000 字符；`negativePrompt`；`width`/`height`（64–2048，16 的倍数）；`cfgScale` 0–30（默认 7）；`steps` 1–150（默认 20）；`sampleMethod` + `schedule`（sdcpp）或 `sampler` + `scheduler`（comfy）；`vaeModel`；`loras`（`{airUrn: strength}` 映射，0.6–1.0 常见）；`embeddings`（textual inversion，仅 sdcpp）；`quantity` 1–12；`seed`；`uCache`。
- SD1：另有 `clipSkip`（默认 -1，社区 checkpoint 常用 2）；SDXL **不接受 clipSkip**（会 400）。
- img2img：`operation: "createVariant"` + `image`（纯字符串 URL）+ `strength`（sdcpp，默认 0.7）或 `denoiseStrength`（comfy，默认 0.75）。
- **未暴露 ControlNet**：SDXL 与 SD1 两份 recipe 的参数表里都没有 controlnet 字段；变体生成只靠 `strength`。（[SDXL recipe](https://developer.civitai.com/orchestration/recipes/sdxl)、[SD1 recipe](https://developer.civitai.com/orchestration/recipes/sd1)）
- 其他引擎：Flux 2（klein/dev/flex/pro/max，klein 支持 LoRA；dev/flex 暴露 `guidanceScale`/`numInferenceSteps`）、Flux 1（sdcpp / comfy / Kontext）、Z-Image、Qwen、Anima、ERNIE、Krea v2、MAI Image 2.5、Seedream、Gemini、OpenAI、Grok、WAN 图像等。
- 训练：SDXL & SD1 LoRA 训练、Flux 1 LoRA 训练、Flux 2 Klein LoRA 训练、Wan / LTX2 视频 LoRA、Chroma/ERNIE/Qwen/Z-Image LoRA（[recipes 目录](https://developer.civitai.com/orchestration/recipes/)）。

**内容政策与货币机制（关键）**
- 计费用 Buzz，**1,000 Buzz = $1.00 USD**（[Buzz 购买指南](https://civitai.com/articles/33522/the-ultimate-guide-to-earning-for-free-and-buying-yellow-buzz-on-civitai)）。
- 三色 Buzz：`blue`（互动赚取，仅 SFW）、`green`（购买，仅 SFW）、`yellow`（购买，**SFW + NSFW**）。不指定 `currencies` 时按 blue → green → yellow 顺序扣。
- `allowMatureContent: true` **强制用 yellow Buzz 结算**；`false` 限 SFW；不设置则由实际结算货币推断。
- 成熟内容产出但用了 blue/green 时：`upgradeMode: "manual"` 会扣留输出，需 PATCH 改 `allowMatureContent: true` 并把 blue/green 返还、改扣 yellow；`"automatic"` 则内联换币补差价（[提交作业文档](https://developer.civitai.com/orchestration/guide/submitting-work)）。
- 提示词被内容审核拦截会返回 step `failed` + `reason: "blocked"`，**CLI 文档警告：反复提交被拦提示词会导致账号被禁言（muted）**，且不要重试（[CLI 生成文档](https://developer.civitai.com/site/guide/cli-generate)）。
- 购买渠道：civitai.com 上因卡组织限制只能**加密货币**（USDC/BTC/ETH/SOL，推荐 Base 上的 USDC）；信用卡购买仅限 PG 站 **civitai.green**（[教育文章](https://education.civitai.com/civitais-guide-to-on-site-currency-buzz-%E2%9A%A1/)）。
- 另有第三方转售商（如 softimer 售 10,000 Buzz / €31.90），非官方渠道。

**价格示例**
- SD1 512²/20 步/q1 → **约 4 Buzz**（=$0.004）；SDXL 1024²/20 步 → **约 8 Buzz**（=$0.008）；1344×768/25 步 ≈10 Buzz；quantity 4 → ≈32 Buzz。
- Flux 1 sdcpp 28 步/cfg 3.5 → ≈28 Buzz（=$0.028）；Flux 1 comfy 1024²/20 步 → ≈8 Buzz。
- Flux 2 Klein 4b createImage/20 步 → ≈12 Buzz（=$0.012）；9b/24 步 ≈24 Buzz。
- 附加资源费：超过 10MB 的额外资源按公式加 Buzz（1–3 个资源 +1 Buzz，4–5 个 +2，…12 个 +12）；VAE 与绝大多数 embedding 不计。
（[SDXL recipe 成本段](https://developer.civitai.com/orchestration/recipes/sdxl)、[Flux1 recipe](http://developer.civitai.com/orchestration/recipes/flux1)、[Flux2 recipe](https://developer.civitai.com/orchestration/recipes/flux2)、[附加资源定价公告](https://civitai.com/articles/7929/new-pricing-model-for-additional-resource-usage)）

**CLI**：`civitai generate "prompt" --negative-prompt ... --quantity N --aspect-ratio ... --checkpoint <versionId> --lora <versionId:strength> --image ... --ecosystem ...`；`--max-cost` 只是**本地估算检查**、不是消费上限；`--timeout` 到期后作业仍在服务端跑并照常计费。**seed 只能通过 raw graph（`--print-input` / `--input`）传入**（[CLI 文档](https://developer.civitai.com/site/guide/cli-generate)）。

### 3.3 Replicate

- 参数面取决于具体模型（社区模型 = 作者自定义 schema，官方模型 = 稳定 schema）（[官方模型文档](https://replicate.com/docs/topics/models/official-models)）。
- 动漫+全控制代表模型：
  - [`mewforest/anillustrious-multi-controlnet-lora`](https://replicate.com/mewforest/anillustrious-multi-controlnet-lora)：AnIllustrious v5（Illustrious/NoobAI 系 SDXL）底模；`lora_urls` + `lora_scales`（**最多 2 个 LoRA**，支持 Civitai/HF 链接）；**3 槽 ControlNet**（openpose/canny/midas depth 等，各有 `conditioning_scale` 0–4 与 `start`/`end` 0–1）；txt2img / img2img / inpaint（`image` + `mask`）；`scheduler`、`num_inference_steps` 1–500、`guidance_scale` 1–50、`prompt_strength`、`sizing_strategy`、可选 SDXL refiner。
  - [`fofr/sdxl-multi-controlnet-lora`](https://replicate.com/fofr/sdxl-multi-controlnet-lora)：3 ControlNet（canny / midas depth / leres depth / softedge hed / pidi / openpose / QR Monster / lineart / **lineart anime**）+ img2img + inpainting + **API 可关 safety checker**。
- 价格：社区模型按 GPU 秒计（L40S $0.000975/s、A100 80GB $0.0014/s、H100 $0.001525/s、T4 $0.000225/s）。上述两个模型单次运行实测 ≈ **$0.0052–0.0079**。官方模型按输出计（FLUX schnell $0.003/图、FLUX dev $0.025/图、FLUX 1.1 Pro $0.04/图、Ideogram v3 Quality $0.09/图）。（[定价页](https://replicate.com/pricing)、[AnIllustrious 页面](https://replicate.com/mewforest/anillustrious-multi-controlnet-lora)）
- 私有模型/部署要付**setup + idle** 时间；"fast booting fine-tunes" 例外只付 active 时间。
- 内容政策：条款禁止非自愿性内容、非法色情、CSAM、极端血腥，**未禁止合法的合意成人内容**；但每个模型自带 safety checker 决定实际能不能出（[RawSignal 汇总](https://rawsignalai.com/directory/developer-apis/replicate)，二手）；[18models 政策追踪](https://18models.ai/policy-tracker) 把 Replicate 归为"Not guaranteed"。另有二手来源称 Replicate 已于 2025 年末被 Cloudflare 收购，政策与定价存在变数（**该说法仅见于该汇总页，未在 primary 源确认**）。
- LoRA 训练：`replicate/fast-flux-trainer` 等官方模型（[官方模型清单](https://replicate.com/docs/topics/models/official-models)）。

### 3.4 Runware（参数最全，但 AUP 禁 NSFW）

- 自述 400,000+ 模型，统一 AIR ID（含 `civitai:4384@128713` 这类直接指向 Civitai 模型的 ID），支持 LoRA / ControlNet / IP-Adapter 堆叠，支持上传自有 checkpoint、LoRA、LyCORIS、VAE、embedding（[Image Generation API](https://runware.ai/image-generation-api)、[Model Upload](https://runware.ai/docs/platform/model-upload)）。
- 参数：`positivePrompt`、`negativePrompt`、`width`/`height`、`steps`、`CFGScale`、`scheduler`、`seed`、`vae`、`clipSkip`、`lora[]`、`controlNet[]`（`weight`、`startStep`/`endStep`、`controlMode`: balanced/prompt/controlnet）、IP Adapters、Refiner、`numberResults`、`includeCost`（[文本生图文档](https://runware.ai/docs/learn/text-to-image)、[ControlNet 文档](https://runware.ai/docs/learn/controlnet)）。
- LoRA 训练 API：上传 ≥10 张图（可带 caption + 触发词），按步计费，产出可下载的 .safetensors，训练校验失败不收费（[LoRA 训练页](https://runware.ai/lora-training)）。
- 定价：纯按量、无订阅，`/docs/models/index.json`、`/docs/models/{id}/schema.json`（`info["x-pricing"]`）、`/docs/models/{id}/examples.json` 全量开放；示例：FLUX 3 Image 0.75K $0.0205（折扣后）、Ideogram 4.5 极低档 $0.008、Recraft V4.1 Flash $0.007；模型上传 beta 期免费，之后 $0.05/GB/月。失败任务不收费（[定价文档](https://runware.ai/docs/platform/pricing)、[定价页](https://runware.ai/pricing)）。
- **审查**：[18models 政策追踪](https://18models.ai/policy-tracker) 将 Runware 列为 Prohibited（**二手，未见其 AUP 原文，待复核**）。

### 3.5 fal.ai（参数强、生态大，但明确禁 NSFW）

- 1,000+ 模型，统一 endpoint 形态；`fal-ai/flux-general/inpainting` 支持 **LoRA 数组 + ControlNet + IP-Adapter + `image_url` + `mask_url` + `strength`**（[api 文档](https://fal.ai/models/fal-ai/flux-general/inpainting/api)）。
- 通用参数：`seed`、`image_size`、`num_inference_steps`、`guidance_scale`、`num_images`、`output_format`、**`enable_safety_checker`**（跨模型命名工具，另有别名 `enable_safety_checks`）；被判定不安全的图会**被替换成全黑同尺寸图**，并在响应 `has_nsfw_concepts` 数组里标注（[模型参数文档](https://fal.ai/docs/documentation/model-apis/model-arguments)）。
- 动漫相关：`fal-ai/pony-v7`（$0.03/百万像素）、`fal-ai/flux-lora-fast-training`（训练自定义风格 LoRA 后作为自己的 endpoint 调用）。
- 价格示例：FLUX.1 dev ≈$0.025/MP、FLUX 1.1 Pro Ultra $0.06、FLUX 2 Dev $0.0084（第三方归一化表 [pricepertoken](https://pricepertoken.com/flux-pricing)）。
- **审查**：AUP 第 1.4 条禁"sexually explicit content"；第 7.4 条禁"规避安全护栏/内容过滤器"；Trust & Safety 页面称已接入 OpenAI Omni 审核 API；触发时返回 422 `content_policy_violation`（不可重试）。因此尽管单模型能关 safety checker，**平台层面属禁止**（[AUP](https://fal.ai/legal/acceptable-use-policy)、[Trust & Safety](https://fal.ai/legal/trust-and-safety)、[错误码](https://fal.ai/docs/documentation/model-apis/errors)、[FAQ](https://fal.ai/docs/documentation/model-apis/faq.md)）。

### 3.6 Together AI（有 `disable_safety_checker` 开关）

- `POST /v1/images/generations`，参数：`prompt`、`model`、`steps`、`image_url`、`seed`、`n`、`width`、`height`、`negative_prompt`、`response_format`、`guidance_scale`、`output_format`、**`image_loras[]`（path + scale，可指向 HuggingFace / Civitai 下载链接 / Replicate 模型；最多 2 个）**、`reference_images[]`、**`disable_safety_checker`（boolean，"If true, disables the safety checker for image generation"）**（[API schema](https://docs.together.ai/reference/post-images-generations)、[Flux LoRA 快速上手](https://togetherai-migration.mintlify.app/docs/quickstart-flux-lora)）。
- 模型与价（部分）：SDXL $0.0019/MP（第三方实测 $0.0033）、Juggernaut Lightning Flux $0.0017、Juggernaut Pro Flux $0.0049、Qwen Image $0.0058、FLUX.2 [dev] $0.0154、FLUX.2 [pro] $0.03、FLUX.1 Kontext [pro] $0.04、FLUX.2 [max] $0.07/MP、GPT Image 2 $0.053/图、Nano Banana Pro $0.134/图（[定价页](https://www.together.ai/pricing)）。
- 注意：模型库**没有**动漫专用 checkpoint；LoRA 可绕过一部分（可挂 Civitai 动漫 LoRA），但底座是 FLUX/SDXL。
- 内容政策：检索未找到官方对 NSFW 的明确表态；`disable_safety_checker` 的存在意味着平台允许在请求层关闭过滤，**但账号级政策风险未验证**。

### 3.7 其他通用平台（简要）

| 平台 | 关键事实 | 出处 |
|---|---|---|
| DeepInfra | FLUX 全family按图计费：FLUX-2-dev $0.01×w/1024×h/1024×iters/28；FLUX.1-dev $0.009×…；schnell $0.0005×…；OpenAI 兼容接口 | [DeepInfra Flux 页](https://stage.deepinfra.com/flux) |
| Fireworks | FLUX.1 dev 服务端 $0.0005/步（28 步≈$0.014）、schnell $0.00035/步；支持 LoRA 推理与 SDXL ControlNet；官方 FAQ 称 FLUX 服务端**不支持 img2img**、暂不支持托管 LoRA 训练；按需部署 A100 $2.90/h、H100 $5.80/h | [Fireworks FAQ](https://docs.fireworks.ai/faq/models/image-generation/flux)、[发布博文](https://fireworks.ai/blog/flux-launch) |
| Novita AI | `/v3/async/txt2img`、`/v3/async/img2img`；`model_name` 选 checkpoint、`loras[]` 最多 5、`controlnet.units[]`（少 20 种 SD15/SDXL 预处理器）、`hires_fix`、`clip_skip`、`restore_faces`、`enable_nsfw_detection`（**开启会额外收 $0.0015/图**）；支持上传自训 LoRA（限 5 个）与风格训练 API。**AUP 自 2026-08-05 起禁止 sexually explicit**（二手转引） | [txt2img](https://novita.ai/docs/api-reference/model-apis-txt2img)、[img2img](https://novita.ai/docs/api-reference/model-apis-img2img)、[迁移指南](https://novita.ai/docs/guides/model-apis-v2-to-v3-migration)、[政策追踪](https://18models.ai/policy-tracker) |
| Chutes | 开源模型托管（Bittensor）；中央化图像 API (`image.chutes.ai`) 18 个模型，含 **chroma / Illustrij / Animij / HassakuXL / NovaFurryXL / Booba / iLustMix（Illustrious 系）**；扩散模板支持 txt2img / img2img / inpaint + ControlNet，参数含 `scheduler`、`safety_checker`（默认 True，可设 False）、`guidance_scale`、`num_inference_steps`、`seed`；付费：Plus $10/月、Pro $20/月；私有 chute 从 $1.80/h GPU + 3× 时费的一次性部署费 | [imageclassic 模型](https://chutes.ai/docs/models/vonkaiser-imageclassic)、[扩散模板](https://chutes.ai/docs/templates/diffusion)、[定价](https://chutes.ai/pricing)、[chutes-js 模型清单](https://npmx.dev/package/chutes-js) |
| OpenRouter Image API | `POST /api/v1/images`，统一 `resolution` / `aspect_ratio` / `size` / `quality` / `output_format` / `background` / `n`(1–10) / `seed` / `input_references`；**无 LoRA / 无 ControlNet**；目录含 Google Gemini Image、OpenAI GPT Image、BFL FLUX、xAI Grok Imagine、ByteDance Seedream、Microsoft MAI-Image、Recraft、Krea、Sourceful；**无动漫专用无审查模型**；无免费层（`:free` 不覆盖图像模型） | [图像生成文档](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)、[发布公告](https://openrouter.ai/blog/announcements/image-api/)、[教程](https://openrouter.ai/blog/tutorials/image-generation-models/) |
| Venice AI | 见 §4.2 | — |
| AI Horde | 志愿者算力，**完全免费**；REST API（`/v2/generate/async`、`/check`、`/status`）；匿名 key `0000000000`（最低优先级）；kudos 优先级体系，kudos 不可买卖；worker 侧看不到请求者身份；模型由志愿者提供，可含社区 checkpoint | [集成文档](https://github.com/Haidra-Org/AI-Horde/blob/main/README_integration.md)、[使用说明](https://stablehorde.net/details/usage/)、[README](https://github.com/Haidra-Org/AI-Horde/blob/main/README.md) |
| SeaCloud（SeaArt） | 见 §2.3 | — |

---

## 4. 明确"无审查"定位的服务

### 4.1 NoCensor.ai

- **定位**：成人内容优先的生成网关，含图像、视频、换脸、放大、多阶段 pipeline、AI 去衣。官方称"prompt safety 层只处理少量禁止类别，其余原样通过，成人内容与普通内容同延迟同质量"（[博客](https://nocensor.ai/blog/nocensor-ai-public-rest-api-build-nsfw-ai-applications-with-the-developer-sdk)）。
- **API**：`POST /api/v1/generate`，异步 202 + 轮询 + webhook；Bearer key，作用域 `generation` / `mgmt` / `webhooks`，每账号最多 5 把 key；生成限速 10 rpm（[开发者文档](https://nocensor.ai/developers)）。
- **参数**：`prompt`、`model`（`anime` / `realistic`）、`width`/`height`、`loras[]`（**图像最多 2 个**，strength 钳制在 [0.1, 1.0]，默认 0.8；LoRA 必须与目标端点底模匹配）、`image` + `denoise`（img2img，默认 0.6 上下文示例）、`seed`。有 LoRA 训练能力（`LORA_NOT_READY`/`LORA_INCOMPATIBLE` 等错误码）。pipeline 最多 5 阶段，支持 `?dry_run=true` 预估费用。
- 另有 `/video`、`/face-swap`、`/enhance`、`/undress`（undress 需先有真实购买记录，且在美国部分州/受限国家返回 451）。
- **价格**：credits 制，**图像 75 credits/张**；包价 $5/500、$11.99/1,300、$25/2,750、$49.99/8,500（Studio Season 加赠至 11,050）、$100/19,500（加赠至 22,230）；credits 不过期、无订阅（[定价](https://nocensor.ai/pricing)）。→ **最优包单价约 $0.0045/credit，即 ≈$0.34/图**；用 $25 包则是 2750/75 ≈ 36 张 ≈ **$0.68/图**。这是本次调研中单价最高的档位之一。
- 支付：BTC / XMR / USDT / XTR / 法币卡（经 Telegram）。输出侧仍有 `PROMPT_BLOCKED`、`CONTENT_POLICY_VIOLATION` 错误码。

### 4.2 Venice AI

- 官方定位"privacy-first, uncensored"，模型列表中带 `uncensored: true` 标记；图像面同日提供主流闭源模型与无审查开源模型（[API skill 文档](https://docs.venice.ai/skill.md)、[模型列表](https://docs.venice.ai/models/image)）。
- **无审查图像模型与价格**（$ / 图）：`wai-Illustrious`（Anime / WAI）$0.01、`chroma` $0.01、`lustify-sdxl` / `lustify-v7` / `lustify-v8` $0.01、`venice-sd35` $0.01、`z-image-turbo` $0.01、`qwen-edit-uncensored` $0.04（[模型页](https://docs.venice.ai/models/image)）。
- **参数**：`model`、`prompt`、`negative_prompt`、`width`/`height`（像素类模型）、`aspect_ratio` + `resolution`（比例类模型）、`format`、`variants`(1–4)、`return_binary`、**`safe_mode`（默认 true，会模糊成人内容）**、`seed`、`cfg_scale`、`style_preset`、`enhance_prompt`、`enable_web_search`（[图像生成指南](https://docs.venice.ai/guides/media/image-generation)）。**没有 LoRA / ControlNet 参数**。
- 兼容层：`POST /images/generations`（OpenAI 兼容），其 `moderation` 参数 `auto` = 模糊成人内容，`low` = 关闭 Safe Venice（[OpenAI 兼容端点](https://docs.venice.ai/api-reference/endpoint/image/generations)）。
- 定价：订阅 Pro $18/月（1,000 图/天 + $1 credits）、Pro+ $68、Max $200；API 用 credits（100 credits = $1），也支持 x402 钱包（USDC on Base / Solana，最低充值 $5，无需账号）与 DIEM 质押（1 DIEM = $1/天）（[定价页](https://venice.ai/pricing)、[API 规格](https://docs.venice.ai/api-reference/api-spec)）。
- 内容响应头会返回 `x-venice-is-blurred`、`x-venice-is-content-violation`、`x-venice-is-adult-model-content-violation`、`x-venice-contains-minor` 等标记（同 API 规格）。

### 4.3 Siray.ai（"Spicy"线）

- "Spicy"= 默认内容审核解除，仅限合法成人（18+）内容，对 CSAM 零容忍（[说明](https://blog.siray.ai/qwen-image-3-pro-spicy-2/)）。
- 单价（每输出图，与分辨率/比例无关）：`z-image-turbo-t2i` **$0.004**（促销，原价 $0.005）、`qwen-image-3-t2i` $0.030、`qwen-image-3-t2i-spicy` $0.035、`qwen-image-3-edit-spicy` $0.035、`seedream-4.5-t2i-spicy` $0.040、`seedream-5.0-pro-t2i-spicy` $0.045、`qwen-image-3-pro-t2i-spicy` / `-edit-spicy` **$0.046**（[对比文](https://blog.siray.ai/uncensored-image-endpoint-comparison/)）。
- Qwen 系支持 `n`（1–6），按图线性计价；Z-Image / Seedream 无 `n`。
- 一致性方案：`qwen-image-3-edit-spicy` 支持最多 3 张参考图；Seedream Spicy ref2i 类似（[跨模态路由文](https://blog.siray.ai/uncensored-ai-generation/)）。
- 接口：`POST https://api.siray.ai/v1/images/generations/async`（OpenAI 风格），Bearer token（[示例](https://docs.siray.ai/api-reference/model-api/example-usage-image)）。
- 注意：负向提示在 Siray 图像端点与 Wan 3.0 上**已取消**，仅 Wan 2.7 视频保留 `negative_prompt`（[跨模态路由文](https://blog.siray.ai/uncensored-ai-generation/)）。
- 未检索到 ControlNet / LoRA 上传相关文档（Qwen LoRA 是 SpicyAPI 侧的能力）。

### 4.4 SpicyAPI

- 自述"uncensored gateway"，对每个模型标注实测的审查类别：**Uncensored**（转发时不加平台扫描）/ **Softened**（不报错但会被削弱）/ **Filtered**（直接拒绝）（[定价页](https://spicyapi.ai/pricing)）。
- 图像侧单价与标注：
  - Uncensored：`Qwen Image 2.1` $0.024（**支持自带 LoRA 文件 + 15 种宽高比**）、`Qwen Image 2.1 LoRA` $0.03、`Qwen Image 3.0` $0.03、`Qwen Image 3.0 Pro` $0.04、`Qwen Image Edit Spicy` $0.038–0.04、`Qwen Image 2512 LoRA` $0.03、`Seedream 5.0 Lite` $0.035、`Seedream 5.0 Pro` $0.036、`Z-Image Spicy` $0.012–0.013、`Z-Image Spicy Pro` $0.019–0.02、`Z-Image Turbo LoRA` $0.012、`MiniMax H3 Image LoRA` $0.042。
  - Filtered：`GPT Image 2/2.5` 系、`Nano Banana 2`、`Krea 2`。
  - 半开：`Wan 2.7` / `Wan 2.7 Pro`——**图像编辑不审查，文生图被削弱**。
- 评测文（[最佳无审查模型 2026](https://spicyapi.ai/blog/best-nsfw-ai-models-2026)）：Qwen Image 2.1 图像第一（$0.024/1k、$0.048/2k，支持自带 LoRA），Qwen Image 3.0 次之，Z-Image 速度快无负向。**全为厂商自评，二手。**

### 4.5 WaveSpeedAI（Spicy 线主要在视频）

- 图像机型（非 Spicy）：Seedream 5.0 Pro $0.045、Seedream 5.0 Flash $0.027、Nano Banana Pro $0.14、Nano Banana 2 $0.045、GPT Image 2/2.5 $0.01、Qwen Image 3.0 $0.03、**Z-Image Turbo $0.005**（[定价页](https://wavespeed.ai/pricing)）。
- Spicy 命名集中在图生视频：`bytedance/seedance-2.0/image-to-video-spicy` $0.60 起、`alibaba/wan-2.7/image-to-video-spicy` $0.50 起、`vidu/q3/image-to-video-spicy` $0.35 起、`wavespeed-ai/wan-2.2-spicy/image-to-video-lora` $0.20 起（[Spicy 目录](https://wavespeed.ai/spicy-video-api)）。
- 有 `POST /api/v3/model/price` 可先用参数算价（[Pricing API](https://wavespeed.ai/docs/pricing-api)）、按秒/按张计费、无订阅。

### 4.6 Eachlabs

- `enable_safety_checker: false` 可关闭过滤，**当前仅列明支持** `wan-v2-6-text-to-video`、`wan-v2-6-image-to-video`、**`seedream-v4-5-text-to-image`**；其余模型会静默忽略该参数（[NSFW 文档](https://docs.eachlabs.ai/api/nsfw-content)、[llms.txt](https://docs.eachlabs.ai/llms.txt)）。
- 官方声明"安全开关是模型级能力，each::labs 不在模型自身安全系统之上再加一层平台过滤"；定价与上游模型商一致（不加价）；each::sense 编排层免费；经 OpenRouter 走模型时收 5.5% 手续费（[API 概览](https://docs.eachlabs.ai/api/overview)、[llms-full](https://www.eachlabs.ai/llms-full.txt)）。

### 4.7 低可信度来源提到的其他名字（收录但未验证）

以下服务均只在第三方 listicle / 厂商对比站出现，**未找到可独立核实的一手文档**，仅登记不背书：

| 服务 | 声称 | 来源 |
|---|---|---|
| Xavira AI | "API-first"，2.5 美分/图（$25/1,000 credits），两套预调模型（写实/动漫），图生视频 5 credits/5 秒，每张图过分类器、被拦不收费，新账号 25 credits 免卡 | [aichatcompanions](https://aichatcompanions.com/blog/best-ai-porn-apis-2026/) |
| 18models.ai | 有公开发布的内容政策允许虚构成人内容；提供 Wan 2.7/3.0、Seedance 2.5、Qwen-Image、Z-Image、HappyHorse；预付 USD 钱包 + 加密充值 | [18models 对比页](https://18models.ai/compare/replicate) |
| HotAPI | 统一网关（图像/视频/语音），1000 credits = $1 | [HotAPI 博客](https://hotapi.ai/en/blog/uncensored-ai-api-guide) |
| Lewdly | $0.01–0.05/图，10–20 秒出图，含视频 | [Lewdly 博客](https://lewdly.ai/blog/lewdly-vs-tensorart-nsfw-ai-platform-comparison-2025) |
| AtlasCloud / HackAIGC / PixelBunny / ZenCreator / Mage.space | 一份"15 平台横评"称 AtlasCloud $0.004/次、HackAIGC 全 10 提示词通过、PixelBunny 29+ 模型、"多个平台文生图能过但图生图被过滤" | [hackaigc 对比](https://www.hackaigc.com/blog/best-nsfw-ai-image-generators-comparison-2026) |
| NSFW Coders | 企业级 NSFW API，$5,000/月起 25 万张，多模型路由（SDXL/Flux/Pony/Juggernaut）+ LoRA + ControlNet + DreamBooth + PhotoDNA | [NSFW Coders](https://nsfwcoders.com/api/nsfw-image-generation-api) |
| SoulGen / Promptchan | 消费级成人生成器，文档与价格需注册后才能看到 | 同上 aichatcompanions |
| TTAPI | 第三方 NovelAI 中转（`/novelai/...-image`），参数与官方一致 | [TTAPI 文档](https://docs.ttapi.io/api/en/novel/text-to-image) |

---

## 5. 价格横向对照（统一到"每张 1024² 级图像"的口径）

| 服务 / 模型 | 单价（USD/图） | 备注 | 出处 |
|---|---|---|---|
| RunPod 自建 ComfyUI（RTX 4090） | ≈$0.01–0.03 | 单次 workflow；机器活跃 $0.5–0.7/h | [RunPod 成本估算](https://github.com/artokun/comfyui-runpod-serverless/blob/main/README.md) |
| ModelsLab 平铺 | **$0.0047** | 无分辨率加价（宣称 ≤2048²）；$149/月不限量 | [定价页](https://modelslab.com/pricing) |
| Civitai SD1 512² | ≈$0.004 | 4 Buzz | [SD1 recipe](https://developer.civitai.com/orchestration/recipes/sd1) |
| Civitai SDXL 1024² | ≈$0.008 | 8 Buzz（20 步） | [SDXL recipe](https://developer.civitai.com/orchestration/recipes/sdxl) |
| Replicate AnIllustrious 多 CN + LoRA | ≈$0.0052–0.0079 | L40S，按秒 | [模型页](https://replicate.com/mewforest/anillustrious-multi-controlnet-lora) |
| Siray Z-Image Turbo | $0.004–0.005 | 促销价 | [Siray 对比](https://blog.siray.ai/uncensored-image-endpoint-comparison/) |
| SpicyAPI Z-Image Spicy | $0.012–0.013 | Uncensored 标注 | [SpicyAPI 定价](https://spicyapi.ai/pricing) |
| Venice WAI-Illustrious / Chroma / Lustify | $0.01 | 无 LoRA/CN | [Venice 模型页](https://docs.venice.ai/models/image) |
| Together AI SDXL | $0.0019/MP（实测 $0.0033/图） | | [定价页](https://www.together.ai/pricing) |
| Together AI FLUX.2 [dev] | $0.0154 | 支持 LoRA URL、可关 safety checker | 同上 + [API schema](https://docs.together.ai/reference/post-images-generations) |
| fal FLUX.1 dev | ≈$0.025/MP | 平台禁 NSFW | [pricepertoken](https://pricepertoken.com/flux-pricing) |
| fal Pony V7 | $0.03/MP | | [模型页](https://fal.ai/models/fal-ai/pony-v7/llms.txt) |
| Replicate FLUX dev（官方模型） | $0.025 | | [定价页](https://replicate.com/pricing) |
| NovelAI Opus 标准尺寸 | $0（含在 $25/月内） | ≤28 步、单张、Normal 尺寸、不用底图；V5 另有使用上限 | [订阅文档](https://docs.novelai.net/en/subscription/) |
| NovelAI 超额 Anlas | 10,000 Anlas ≈$10–14 | 二手口径不一 | [Hakky](https://book.st-hakky.com/en/data-science/novelai-pricing-plans-comparison-image-generation-tips-and-japanese-settings) |
| SeaArt 站内标准图 | 6 credits（≈$0.006 或 $0.06，官方页自相矛盾） | | [商城页](https://www.seaart.ai/mall) |
| PixAI Tsubaki.2 | Lite 2,200 / Standard 3,200 / Pro 6,800 / Ultimate 7,000 credits | credits 与美元换算未在文档中给出 | [Tsubaki.2 文档](https://docs.pixai.art/docs/models-and-lora/tsubaki2) |
| NoCensor.ai | ≈$0.34–0.68 | 75 credits/图 | [定价](https://nocensor.ai/pricing) |
| SIray Qwen3 Pro Spicy | $0.046 | | [Siray](https://blog.siray.ai/uncensored-image-endpoint-comparison/) |
| OpenRouter（低档模型） | 约 $0.01 起 | 无动漫无审查模型 | [教程](https://openrouter.ai/blog/tutorials/image-generation-models/) |
| AI Horde | $0（志愿者算力） | 队列优先级靠 kudos | [使用说明](https://stablehorde.net/details/usage/) |

---

## 6. 参数能力矩阵（用户点名的六项）

| 服务 | 尺寸 | 步数 | seed | LoRA | ControlNet | img2img / inpaint | 平台是否禁 NSFW |
|---|---|---|---|---|---|---|---|
| ModelsLab | ✅ 任意（口径冲突） | ✅ | ✅ | ✅ 多 LoRA 逗号分隔 + 自训 | ✅ 独立端点，20 类，可多路堆叠 | ✅ 各自独立端点 | ❌ 不禁（有专门营销页） |
| Civitai | ✅ 64–2048 | ✅ 1–150 | ✅（CLI 需 raw graph） | ✅ 任意平台内 LoRA + 自训 | ❌ 文档未暴露 | ✅ createVariant（strength） | ❌ 不禁（yellow Buzz + allowMatureContent） |
| Replicate（社区模型） | ✅ | ✅ 1–500 | ✅ | ✅（URL，最多 2–3 个） | ✅ 最多 3 槽 + 强度/起止步 | ✅ 都有 | ⚠️ 未明文禁止，按模型 |
| Runware | ✅ | ✅ | ✅ | ✅ + LyCORIS + 上传 | ✅ 多路 + start/end + controlMode | ✅（含 inpainting/outpainting） | ⚠️ 据二手为禁止 |
| fal.ai | ✅ | ✅ | ✅ | ✅（flux-general） | ✅（flux-general） | ✅ | ✅ 明确禁止 |
| Together AI | ✅ | ✅ | ✅ | ✅（URL，最多 2） | ❌（Fireworks 的 SDXL CN 是另一家） | ✅ reference_images / image_url | ⚠️ 有 `disable_safety_checker` 开关 |
| Venice AI | ✅ | ❌ | ✅ | ❌ | ❌ | ✅（/image/edit，inpainting） | ❌ 不禁 |
| NovelAI 官方 API | ✅ 档位 | ✅ 1–50 | ✅ | ❌ | ⚠️ 社区客户端有 controlnet 字段，官方未文档化 | ✅ img2img + infill + upscale | ❌ 不禁（禁写实；curated/full 分级） |
| PixAI Platform API | ✅ 比例 | ✅ | ✅ | ✅ 最多 5（会员 15） | ❌（站内有，API 文档未列） | ✅（Reference Pro） | ❓ 未验证 |
| SeaCloud API | ✅ | ❓ | ✅ | ❓ | ❓ | ✅（wan i2i 等） | ❓ 未验证（部分模型有 `safety_tolerance`） |
| NoCensor.ai | ✅ | ❌ | ✅ | ✅ 最多 2 + 自训 | ❌ | ✅ `image` + `denoise` | ❌ 不禁 |
| Siray / SpicyAPI / WaveSpeed Spicy | ✅ | ❓ | ✅ | ⚠️ 仅 Qwen 系 | ❌ | ✅（edit 端点） | ❌ 不禁（合法成人） |
| Chutes | ✅ | ✅ | ✅ | ❓（模型级） | ✅（扩散模板 enable_controlnet） | ✅ txt2img/img2img/inpaint | ⚠️ 可关 safety_checker |
| AI Horde | ✅ | ✅ | ✅ | ❓ | ❓ | ✅ | ⚠️ 取决于志愿者 worker |

---

## 7. 缺口与研究局限（明确未验证项）

1. **SeaArt / PixAI / Yodayo 的 NSFW 政策原文**均未检索到；SeaCloud 只对部分模型暴露 `moderation` / `safety_tolerance` 参数。
2. **Runware、Novita、getimg.ai、RunDiffusion、SiliconFlow 的"禁止 NSFW"结论**来自单一二手政策追踪页（18models.ai），未逐家核对 AUP 原文。
3. **Replicate 被 Cloudflare 收购**的说法仅见于一个第三方目录页。
4. **Civitai 是否在其他 recipe（如 Comfy 自定义图或 `imageGen` 完整 OpenAPI）中暴露 ControlNet**：本报告只核对了 SDXL/SD1 两份 recipe 页；完整的 `imageGen` OpenAPI 规格（`orchestration.civitai.com/v2/consumer/recipes/imageGen/openapi.yaml`）尚未逐字段核对。
5. **NovelAI 的 ControlNet 支持**：只在社区 Rust 客户端结构体里看到字段，官方文档未出现。
6. **SeaArt "Standard Image ≈$0.006 vs ≈$0.06"**：官方商城页同一处两种换算，未解决。
7. **ModelsLab 的 width/height 上限（1024 vs 2048）与 steps 上限（20 vs 50）**：官方文档内部矛盾，未解决。
8. 大量"最佳 NSFW API 2026"类对比站（hackaigc / aichatcompanions / hotapi / spicyapi / siray / lewdly / goongen）**自身即厂商或联盟营销站**，其排名与"实测"无法独立核实，本报告仅登记其披露的接口与价格事实，不建议把其结论当作依据。
9. **Yodayo/Moescape 无官方 API 文档**：仅能确认站内功能（Spells=LoRA、Hires.fix、ControlNet）与货币体系。
10. 未检索 pixiv 系（如 Pixiv 官方）或国内平台（Liblib、无界 AI、通义万相托管端）的 API 与审查细节——本次调研范围未覆盖该方向。

---

## 8. 全部来源链接

**一手（官方文档 / 官方定价 / 官方条款）**
- NovelAI：[api.novelai.net/docs](https://api.novelai.net/docs)、[订阅文档](https://docs.novelai.net/en/subscription/)、[FAQ](https://docs.novelai.net/en/faq/)、[图像文档](https://docs.novelai.net/en/image/)、[采样方法](https://docs.novelai.net/en/image/sampling/)、[Steps & Guidance](https://docs.novelai.net/en/image/stepsguidance/)、[Third-party SDK 文档](https://docs.ttapi.io/api/en/novel/text-to-image)、[novelai-python](https://pypi.org/project/novelai-python/0.7.7/)、[novelai-api 源码](https://github.com/Aedial/novelai-api/blob/main/novelai_api/_low_level.py)、[novelai_bridge (Rust)](https://docs.rs/novelai-bridge/latest/novelai_bridge/struct.GenerateImageRequest.html)
- PixAI：[Platform 首页](https://platform.pixai.art/en)、[Create image](https://platform.pixai.art/en/docs/api-v2/image/createImage)、[Models 参考](https://platform.pixai.art/en/docs/references/models)、[FAQ](https://platform.pixai.art/en/docs/faq)、[会员](https://docs.pixai.art/docs/pricing/membership)、[Credit 成本](https://docs.pixai.art/docs/pricing/credits-cost)、[Tsubaki.2](https://docs.pixai.art/docs/models-and-lora/tsubaki2)、[Model Overview](https://docs.pixai.art/docs/models-and-lora/model-overview)、[Panel Tools](https://docs.pixai.art/docs/tools/panel-tools)、[LoRA 用法](https://docs.pixai.art/docs/models-and-lora/lora-usage)、[官方博客会员指南](https://blog.pixai.art/en/pixai-membership/)
- SeaArt：[SeaCloud SDK 手册](https://cloud.seaart.ai/docs/sdk/operation-manual)、[Create Task](https://cloud.seaart.ai/docs/model-api/multimodal/submit)、[FLUX.2 pro](https://cloud.seaart.ai/docs/api-reference/model-api/blackforest-labs/flux-2-pro)、[Nano Banana](https://cloud.seaart.ai/docs/api-reference/model-api/google/nano-banana)、[GPT Image 2](https://cloud.seaart.ai/docs/api-reference/model-api/openai/gpt-image-2)、[Wan 2.5 i2i](https://cloud.seaart.ai/docs/api-reference/model-api/qwen/wan-2-5-i2i-preview-intl)、[商城定价](https://www.seaart.ai/mall)、[LoRA 文档](https://docs.seaart.ai/guide-1/4-parameters/4-1-model)、[ControlNet 文档](https://docs.seaart.ai/guide-1/2-seaart-ai-basic-function/2-3-controlnet)、[NoobAI XL](https://docs.seaart.ai/guide-1/6-permanent-events/high-quality-models-recommendation/noobai-xl.md)
- Civitai：[提交作业](https://developer.civitai.com/orchestration/guide/submitting-work)、[SDXL recipe](https://developer.civitai.com/orchestration/recipes/sdxl)、[SD1 recipe](https://developer.civitai.com/orchestration/recipes/sd1)、[Flux 2 recipe](https://developer.civitai.com/orchestration/recipes/flux2)、[Flux 1 recipe](http://developer.civitai.com/orchestration/recipes/flux1)、[CLI 生成](https://developer.civitai.com/site/guide/cli-generate)、[生成桥接参考](https://developer.civitai.com/apps/reference/generation)、[Site API](https://developer.civitai.com/site/)、[附加资源定价](https://civitai.com/articles/7929/new-pricing-model-for-additional-resource-usage)
- ModelsLab：[定价](https://modelslab.com/pricing)、[SD API 页](https://modelslab.com/stable-diffusion-api)、[image-generation-api](https://modelslab.com/image-generation-api)、[llms.txt](https://modelslab.com/llms.txt)、[api 对比页](https://modelslab.com/text-to-image-api-pricing-comparison)、[模型选择指南](https://docs.modelslab.com/guides/model-selection)、[llms.txt](https://docs.modelslab.com/llms.txt)、[text2img](https://docs.modelslab.com/enterprise-api/text-to-image/text2img)、[ControlNet](https://docs.modelslab.com/enterprise-api/text-to-image/controlnet-ep)、[ControlNet Main](https://docs.modelslab.com/image-generation/controlnet/controlnet-main)、[inpainting](https://docs.modelslab.com/enterprise-api/text-to-image/inpainting)、[img2img](https://docs.modelslab.com/enterprise-api/text-to-image/img2img)、[Flux t2i](https://docs.modelslab.com/image-generation/flux/flux-text-to-image)、[uncensored 页](https://stablediffusionapi.com/uncensored-image-generator)
- Replicate：[定价](https://replicate.com/pricing)、[billing 文档](https://replicate.com/docs/topics/billing.md)、[官方模型](https://replicate.com/docs/topics/models/official-models)、[AnIllustrious Multi-ControlNet LoRA](https://replicate.com/mewforest/anillustrious-multi-controlnet-lora)、[其 API schema](https://replicate.com/mewforest/anillustrious-multi-controlnet-lora/versions/4eef032459253a00f1eea869a11ce71d004729c57a797c55e06d98d4d81d7c4b/api)、[fofr/sdxl-multi-controlnet-lora](https://replicate.com/fofr/sdxl-multi-controlnet-lora)
- fal.ai：[AUP](https://fal.ai/legal/acceptable-use-policy)、[ToS](https://fal.ai/legal/terms-of-service)、[Trust & Safety](https://fal.ai/legal/trust-and-safety)、[模型参数（safety checker）](https://fal.ai/docs/documentation/model-apis/model-arguments)、[错误码](https://fal.ai/docs/documentation/model-apis/errors)、[FAQ](https://fal.ai/docs/documentation/model-apis/faq.md)、[flux-general inpainting](https://fal.ai/models/fal-ai/flux-general/inpainting/api)、[pony-v7](https://fal.ai/models/fal-ai/pony-v7/llms.txt)、[llms.txt](https://fal.ai/llms.txt)
- Runware：[定价文档](https://runware.ai/docs/platform/pricing)、[定价页](https://runware.ai/pricing)、[图像 API](https://runware.ai/image-generation-api)、[Model Upload](https://runware.ai/docs/platform/model-upload)、[ControlNet](https://runware.ai/docs/learn/controlnet)、[text-to-image](https://runware.ai/docs/learn/text-to-image)、[LoRA 训练](https://runware.ai/lora-training)
- Together AI：[定价](https://www.together.ai/pricing)、[图像 API schema](https://docs.together.ai/reference/post-images-generations)、[图像总览](https://docs.together.ai/docs/inference/images/overview)、[Flux LoRA 快速上手](https://togetherai-migration.mintlify.app/docs/quickstart-flux-lora)
- Venice AI：[模型列表](https://docs.venice.ai/models/image)、[图像生成指南](https://docs.venice.ai/guides/media/image-generation)、[生成端点](https://docs.venice.ai/api-reference/endpoint/image/generate)、[OpenAI 兼容端点](https://docs.venice.ai/api-reference/endpoint/image/generations)、[Models API](https://docs.venice.ai/api-reference/endpoint/models/list)、[编辑端点](https://docs.venice.ai/api-reference/endpoint/image/edit)、[API 规格](https://docs.venice.ai/api-reference/api-spec)、[skill.md](https://docs.venice.ai/skill.md)、[定价](https://venice.ai/pricing)
- NoCensor.ai：[开发者文档](https://nocensor.ai/developers)、[定价](https://nocensor.ai/pricing)、[官方博客](https://nocensor.ai/blog/nocensor-ai-public-rest-api-build-nsfw-ai-applications-with-the-developer-sdk)、[@nocensor/sdk](https://www.npmjs.com/package/@nocensor/sdk)
- Siray：[Z-Image Turbo t2i 规格](https://docs.siray.ai/api-reference/model-api/z-image-turbo-t2i)、[图像示例](https://docs.siray.ai/api-reference/model-api/example-usage-image)、[API 集成](https://docs.siray.ai/model-apis/api-integration)
- SpicyAPI：[定价](https://spicyapi.ai/pricing)
- WaveSpeedAI：[定价](https://wavespeed.ai/pricing)、[Spicy 目录](https://wavespeed.ai/spicy-video-api)、[Pricing API](https://wavespeed.ai/docs/pricing-api)、[计费说明](https://wavespeed.ai/docs/how-pricing-works)
- Eachlabs：[NSFW 内容文档](https://docs.eachlabs.ai/api/nsfw-content)、[llms.txt](https://docs.eachlabs.ai/llms.txt)、[llms-full](https://www.eachlabs.ai/llms-full.txt)、[创建预测](https://docs.eachlabs.ai/api/predictions/create-prediction)、[API 概览](https://docs.eachlabs.ai/api/overview)
- Chutes：[imageclassic](https://chutes.ai/docs/models/vonkaiser-imageclassic)、[扩散模板](https://chutes.ai/docs/templates/diffusion)、[定价](https://chutes.ai/pricing)、[llms.txt](https://chutes.ai/llms.txt)、[starter guide](https://chutes.ai/docs/guides/starter-guide)、[NSFW Classifier](https://chutes.ai/docs/models/vonkaiser-nsfw-classifier)
- Novita AI：[text-to-image](https://novita.ai/docs/api-reference/model-apis-text-to-image)、[txt2img](https://novita.ai/docs/api-reference/model-apis-txt2img)、[img2img](https://novita.ai/docs/api-reference/model-apis-img2img)、[迁移指南](https://novita.ai/docs/guides/model-apis-v2-to-v3-migration)、[自传 LoRA](https://novita.ai/docs/guides/model-apis-custom-model)
- Tensor.Art：[计费](https://tams-docs.tensor.art/docs/use-cases/intro-to-billing/)、[TAMS 首页](https://tams.tensor.art/)、[条款](https://tensor.art/about/terms-of-service-new)、[ComfyUI 节点](https://github.com/Tensor-Art/ComfyUI_TENSOR_ART)、[tams-sdk.js](https://github.com/Tensor-Art/tams-sdk.js)
- OpenRouter：[图像生成文档](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)、[生成端点](https://openrouter.ai/docs/api/api-reference/images/generate-an-image)、[模型列表端点](https://openrouter.ai/docs/api/api-reference/images/list-image-generation-models)、[发布公告](https://openrouter.ai/blog/announcements/image-api/)、[教程](https://openrouter.ai/blog/tutorials/image-generation-models/)、[代码教程](https://openrouter.ai/blog/tutorials/image-generation/)
- RunPod：[ComfyUI serverless 教程](https://docs.runpod.io/tutorials/serverless/comfyui)、[worker-comfyui](https://github.com/runpod-workers/worker-comfyui/blob/main/README.md)、[comfyui-runpod-serverless](https://github.com/artokun/comfyui-runpod-serverless/blob/main/README.md)、[官方博客](https://www.runpod.io/blog/deploy-comfyui-as-a-serverless-api-endpoint)
- AI Horde：[集成文档](https://github.com/Haidra-Org/AI-Horde/blob/main/README_integration.md)、[使用说明](https://stablehorde.net/details/usage/)、[README](https://github.com/Haidra-Org/AI-Horde/blob/main/README.md)、[贡献指南](https://stablehorde.net/contribute/workers/)、[SDK 文档](https://horde-sdk.readthedocs.io/en/latest/getting_started/)
- DeepInfra：[Flux 家族与定价](https://stage.deepinfra.com/flux)
- Fireworks：[FLUX FAQ](https://docs.fireworks.ai/faq/models/image-generation/flux)、[FLUX 发布博文](https://fireworks.ai/blog/flux-launch)
- 其他：[VNCCS ComfyUI 套件（二次元角色精灵流水线）](https://github.com/AHEKOT/ComfyUI_VNCCS)、[VNCCS 模型包](https://huggingface.co/MIUProject/VNCCS_v3.0)、[VNCCS 指南](https://apatero.com/blog/vnccs-visual-novel-character-creation-complete-guide-2025)

**二手 / 第三方（用于交叉验证与补充上下文，可信度见正文标注）**
- [18models NSFW 政策追踪](https://18models.ai/policy-tracker)、[18models vs Replicate](https://18models.ai/compare/replicate)
- [RawSignal: Replicate 政策与定价](https://rawsignalai.com/directory/developer-apis/replicate)
- [wpnews: NovelAI V5 Opus 限额与 Anlas 重置实测](https://wpnews.pro/news/novelai-v5-on-opus-usage-limits-the-2026-09-21-subscription-anlas-reset-and-the)
- [Hakky: NovelAI 套餐与 Anlas 消耗](https://book.st-hakky.com/en/data-science/novelai-pricing-plans-comparison-image-generation-tips-and-japanese-settings)
- [Chapter Blog: NovelAI 定价 2026](https://blog.chapter.pub/novelai-pricing/)
- [AI Dynamic Storytelling Wiki: NovelAI](https://aids.miraheze.org/wiki/NovelAI)
- [pricepertoken: FLUX API 价格全表](https://pricepertoken.com/flux-pricing)
- [Wireflow: Replicate 定价说明](https://www.wireflow.ai/replicate-pricing)
- [UsagePricing: Replicate 计算器](https://www.usagepricing.com/tools/pricing-calculator/replicate)
- [Apatero: 图像 API 成本对比 fal/Replicate/Together](https://apatero.com/blog/ai-image-generator-api-costs-2026-fal-replicate-together)
- [LocalForge: Flux/CHROMA vs SD3 vs Pony 无审查模型对比](https://offlinecreator.com/blog/flux-uncensored-vs-sd3-vs-pony-diffusion-2026)
- [HackAIGC: 最佳无审查模型 2026](https://www.hackaigc.com/blog/best-uncensored-ai-models-2026-mimo-grok-qwen)、[15 平台横评](https://www.hackaigc.com/blog/best-nsfw-ai-image-generators-comparison-2026)
- [Siray 博客：无审查端点价格对比](https://blog.siray.ai/uncensored-image-endpoint-comparison/)、[跨模态路由](https://blog.siray.ai/uncensored-ai-generation/)、[Qwen3 Pro Spicy](https://blog.siray.ai/qwen-image-3-pro-spicy-2/)、[Seedream X Spicy vs Z-Image](https://blog.siray.ai/seedream-x-spicy-vs-z-image/)
- [SpicyAPI: 最佳无审查模型 2026](https://spicyapi.ai/blog/best-nsfw-ai-models-2026)
- [goongen: Tensor.Art NSFW 政策解读](https://goongen.ai/blog/tensor-art-nsfw-policy)
- [Lewdly: vs TensorArt 对比](https://lewdly.ai/blog/lewdly-vs-tensorart-nsfw-ai-platform-comparison-2025)
- [aichatcompanions: 2026 NSFW 图像 API 盘点](https://aichatcompanions.com/blog/best-ai-porn-apis-2026/)
- [HotAPI: 无审查 AI API 开发者指南](https://hotapi.ai/en/blog/uncensored-ai-api-guide)
- [NSFW Coders: 企业级 NSFW 图像 API](https://nsfwcoders.com/api/nsfw-image-generation-api)
- [Flowith: SeaArt 定价 2026](https://flowith.io/blog/seaart-pricing-2026-free-vs-standard-vs-pro/)
- [AI Agents Wiki: Tensor.Art](https://aiagents.wiki/agents/tensor-art)、[AI Tool Graph: Tensor.Art 定价](https://www.aitoolgraph.com/tools/tensor-art)、[AI Gear Base: Tensor.Art 评测](https://aigearbase.com/tool/tensorart)
- [OminiGate: Novita Generate 定价](https://ominigate.ai/en/models/novita/generate)
- [apis.io: Civitai 套餐与 Buzz](https://apis.io/plans/civitai/civitai-plans-pricing/)
