# 国内可购买 · 二次元生图 API 调研（人民币 / 支付宝微信 / 免费额度 / 审查尺度）

- 调研时间：2026-10-04
- 调研目标：找出「人在国内、人民币/支付宝/微信可直接付款、不折腾外币卡」前提下，有免费额度或羊毛可薅、适合二次元风格、审查尺度宽松（或无审查）、提供 API 的生图服务；并整理国内二次元生图实践者实际在用的方案。
- 与上一份的关系：上一份 `261004-anime-image-api.research.md` 按「全球无审查 × 全参数控制」维度扫了 ModelsLab / Civitai / Replicate / NovelAI / PixAI / SeaArt / Venice 等服务；本份换维度，聚焦**支付可达性**与**免费/低成本起步**，对同一批服务只补充其支付与国内可达性信息。
- 证据标注：凡官方文档、官方定价页、官方博客标为【一手】；第三方评测、导航站、聚合站、论坛帖标为【二手】，其中带明显 SEO/AI 生成痕迹者单独标注。
- **读取提醒**：搜索引擎聚合站（如 yangmao.ai、baipiaoji、171host、codex789 等）内容存在时效与准确性风险，凡涉及价格/额度的关键数字，本报告优先采用官方源，并把口径冲突处显式列出。

---

## 0. 结论速览（事实对照，不含推荐）

### 0.1 一句话结构

国内生图 API 生态在支付维度上分成**三个不相交的圈**：

| 圈层 | 代表 | 能否人民币直付 | 二次元能力 | 审查尺度 |
|---|---|---|---|---|
| **A. 国内大厂云** | 阿里百炼、腾讯混元、火山引擎（即梦）、百度千帆、智谱、快手可灵 | ✅ 支付宝/微信/网银，可开票 | 中（通义万相/混元轻量版偏写实；即梦、可灵动漫尚可） | 最严：政治/暴力/色情/真人全拦，有明确错误码 |
| **B. 国内社区与中转** | LiblibAI、吐司、海艺、触手；302.AI、API易、AiHubMix、DMXAPI、APIMart 等 | ✅ 支付宝/微信/USDT | 高（LiblibAI/吐司可直接调 Illustrious 系 checkpoint + LoRA） | 平台级审核；中转站看上游模型（调 Gemini/GPT-Image 会带 Google/OpenAI 审核） |
| **C. 境外站（人民币可达）** | **PixAI（官方支持支付宝/微信）**、NovelAI（淘宝代充）、Civitai（加密货币）、Shakker、TensorHub | ⚠️ 间接：官方支付通道 / 代充 / 虚拟卡 | 最高（Illustrious/NoobAI/Pony 原生生态） | 相对最松；PixAI 被 NGA 用户称为「唯一还能免费 NSFW 的大型站」 |

### 0.2 核心事实（逐条，附出处）

1. **国内平台在审查上没有"宽松档"**。NGA 二次元版的一份在线生成平台教程（2026-01 更新）直接写：「国内平台连擦边（比如露个胖次）都做不到，生成结果都显示不出来」【二手，[NGA](https://nga.178.com/read.php?tid=43606229)】。
2. **LiblibAI 是唯一被官方明示"出图含内容审核"的国内 API 平台**，其 API 开放平台页面在「星流 Star-3」与「LiblibAI 自定义模型」两栏都标注了这一条【一手，[liblib.art/apis](https://www.liblib.art/apis)】。
3. **PixAI 官方支持支付宝与微信支付**（Web 端，不支持自动续费）——这是本次调研中最关键的支付可达性发现【一手，[PixAI 支付方式指南](https://blog.pixai.art/en/the-complete-guide-to-pixai-payment-methods/)，2026-06-30】。
4. **Civitai 主站（含 NSFW 的黄色 Buzz）只能加密货币**；信用卡只能买 civitai.green 的绿色 Buzz（仅 SFW）【一手，[Buzz 指南](https://education.civitai.com/civitais-guide-to-on-site-currency-buzz-%E2%9A%A1/)】。
5. **阿里云百炼的免费额度按模型独立计算、有效期 90 天**，且目前只有特定地域的模型享有；官方文档以「模型详情页是否显示额度条」为准【一手，[新人免费额度](https://help.aliyun.com/zh/model-studio/new-free-quota)】。
6. **模力方舟（Gitee AI）每日 100 次免费 API 调用**，其中 Z-Image-Turbo 被第三方描述为「每天免费 100 张 2K 高清生图」【一手站点 [ai.gitee.com](https://ai.gitee.com) + 二手描述，[CSDN](https://blog.csdn.net/aosky/article/details/155577662)】。
7. **中转站行业在 2026 年遭遇合规整治**：国家安全部 2026-06-08 发布风险提示；上海一名 AI 中转站站长被公安机关刑事拘留【二手，[中新网](https://www.chinanews.com.cn/cj/2026/06-22/10644787.shtml)】。
8. **国内平台的审核错误码是明确可查的**：阿里 `DataInspectionFailed` / `IPInfringementSuspect`；腾讯 `OperationDenied.TextIllegalDetected` / `FailedOperation.GenerateImageFailed`（生成图片审核不通过）。见 §5。

---

## 1. 支付可达性的工作分解

"不折腾外币卡"在国内有几条实际路径，本报告按这五条组织事实：

| 路径 | 机制 | 代表 | 代价 |
|---|---|---|---|
| P1 国内厂商直付 | 支付宝/微信/网银直接充平台账户 | 阿里百炼、腾讯云、火山引擎、智谱、LiblibAI、吐司、海艺 | 审查最严 |
| P2 中转/聚合平台 | 平台用官转/官逆通道代购海外模型，人民币按量计费 | 302.AI、API易、AiHubMix、DMXAPI、APIMart、块乐 Encore… | 合规灰区、上游审核仍生效、有跑路与"掺水"风险 |
| P3 海外站已接支付宝/微信 | 站点自己接了本地收单 | **PixAI** | 较少见，是可遇不可求的一档 |
| P4 虚拟卡 / 代充 | 支付宝→虚拟卡→绑海外站；或淘宝/闲鱼代充成品号 | WildCard（野卡）、HUTAO、Speed4Card、账号星球、淘宝/闲鱼 | 开卡费+3.5% 手续费；代充有封号/跑路风险 |
| P5 加密货币 | USDT/USDC 换平台内货币 | Civitai 主站黄色 Buzz、Router One | 需先有加密资产 |

---

## 2. 国内大厂 / 云厂商生图 API

### 2.1 阿里云百炼（通义万相 Wan / 千问 Qwen-Image / Z-Image）

**购买方式**：阿里云账号 → 开通百炼 → 支付宝/网银充值账户余额，主账号统一付费（RAM 子账号不能独立计费）【一手，[图像 API 常见问题](https://help.aliyun.com/zh/model-studio/image-faq)】。

**免费额度**【一手，[新人免费额度](https://help.aliyun.com/zh/model-studio/new-free-quota)】：
- 首次开通阿里云百炼时**系统自动发放**，无需手动领取、无需实名认证即可获取和使用。
- **按模型独立计算**，不同模型（含同一模型的不同快照版本）额度互不共享。
- 有效期 **90 天**，从「开通百炼 / 模型发布 / 模型申请通过」中较晚者起算。
- 仅特定地域的模型享有额度（北京地域 / 新加坡地域文档口径不同，以控制台模型广场详情页的「免费额度」蓝色额度条为准）。
- 额度耗尽后自动转按量付费；可提前开启「免费额度用完即停」。

**具体额度数字存在口径冲突（务必注意）**：
- 官方 wanx-v1 参考页写 **500 张**免费额度【一手，[万相文生图 API 参考](https://help.aliyun.com/zh/model-studio/text-to-image-api-reference)】。
- 阿里云开发者社区文章写 wan2.6-t2i **50 张**、文生视频/图生视频各 50 秒【二手，[阿里云开发者社区](https://developer.aliyun.com/article/1695854)】。
- GitHub 上的科普帖也写 万相2.6 文生图 50 张，并强调「免费额度按模型分别计算，不同模型不共享」【二手，[rtcjgipa/aliyun-image-generation](https://github.com/rtcjgipa/aliyun-image-generation)】。
→ **结论：额度数字随模型版本与地域变，接入前必须以控制台详情页为准。**

**价格**（官方参考页与文档）：
| 模型 | 单价 | 出处 |
|---|---|---|
| wanx-v1 | 0.16 元/张 | [text-to-image-api-reference](https://help.aliyun.com/zh/model-studio/text-to-image-api-reference) |
| wan2.6-t2i | 0.2 元/张 | [开发者社区文章](https://developer.aliyun.com/article/1695854) |
| 图像 API 通用示例 | 0.02 元/张（示例值） | [image-faq](https://help.aliyun.com/zh/model-studio/image-faq) |
| 通义万相 wan2.6 | ~0.2 元/张 | 二手对比文 [DeepBlog](https://www.mxphp.com/post/api) |

**模型清单与能力**【一手，[图片生成与编辑](https://help.aliyun.com/zh/model-studio/image-model/)、[文生图使用方式](https://help.aliyun.com/zh/model-studio/text-to-image)】：
- `qwen-image-3.0-pro` / `qwen-image-3.0`：复杂版面、小字渲染、多语言字体；最大输出 6 张；最大 2048×2048。
- `wan2.7-image-pro`：文字渲染、品牌色、角色一致性多图生成、多图编辑；最大 4 张（连续 12）；文生图最高 **4096×4096**。
- `wan2.7-image`：同上，更快，最高 2K。
- `wan2.6-t2i` / `wan2.6-image`：最高 1440×1440。
- `z-image-turbo`：追求速度与性价比，写实人像与产品图，**不支持编辑**，最大 2048×2048。
- 选型口径（官方页）：`qwen-image-3.0-pro` 擅长文本渲染；`wan2.7-image-pro` 功能最全；`z-image-turbo` 最快最便宜。

**参数面**【一手，[万相文生图 V2 API 参考](https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference)、[万相图像生成与编辑 2.7](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference)】：
- `size`：支持档位关键字 `1K`/`2K`/`4K` 或自定义 `"宽*高"`；wan2.5+ 总像素在 [1280², 1440²] 之间且宽高比 [1:4, 4:1]（wan2.7 扩展到 [768², 4096²]，比例 [1:8, 8:1]）。
- `n`：1–4（组图模式 1–12）。
- `negative_prompt`、`seed`（[0, 2147483647]）、`watermark`（默认 false，开启后固定「AI生成」字样）、`prompt_extend`（默认 true）。
- wan2.7 专有：`enable_sequential`（组图）、`thinking_mode`（默认 true，增强推理）、`color_palette`（3–10 种色值+占比，总和须 100.00%）。
- wan2.6-image：`enable_interleave`（图文混排 vs 图像编辑）、`max_images`（1–5）。
- **无 LoRA、无 ControlNet**。
- 调用形态：异步必须带 `X-DashScope-Async: enable`；wan2.6+ 与 qwen-image-3.0 支持同步。task_id 查询有效期 24 小时。
- 图像 URL 有效期 24 小时，需及时转存。

**审查尺度（有明确错误码）**【一手，[万相文生图 V2 文档](https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference)、[image-faq](https://help.aliyun.com/zh/model-studio/image-faq)】：
- `prompt_extend` 开启后，改写生成的提示词**可能引入受版权保护的内容，从而触发内容审核**，返回 `IPInfringementSuspect` 或 `DataInspectionFailed`。
- 若提示词本身直接包含受版权保护的角色名或作品名，关闭智能改写仍会报错，需修改提示词本身。
- 即：**动漫角色名（版权 IP）是明确的拦截触发点**。

**已知漏洞历史**：2026-02 有报道称阿里千问存在可绕过审核生成暴露图片的漏洞，仅需常规提示词即可「零拦截直出」，事后平台已补救并对相关提示词拦截【二手，[CN-SEC](https://cn-sec.com/archives/5037501.html)】。

**促销**：阿里云面向产品新用户有 AI 免费试用活动（超 30 款 AI 产品、7000 万 tokens），官网另提「百炼按量达标返券，先用后返，最高返 200 元」【二手，[阿里云开发者社区](https://developer.aliyun.com/article/1733984)】。

---

### 2.2 腾讯云 混元生图 / 大模型图像创作引擎

**购买方式**：腾讯云账号 + 实名认证 → 控制台开通 → 付费使用 API，或用控制台可视化界面【一手，[腾讯云产品页](https://cloud.tencent.com.cn/product/aiart)】。

**免费额度**：
- 首次开通「大模型图像创作引擎」自动发放一次性免费资源包，**有效期为 1 年**，结算时优先扣减【一手，[免费额度](https://intl.cloud.tencent.com/zh/document/product/1238/63497)】。
- 文档列出的示例：**图像风格化（图生图）50 次**；资源包耗尽或到期后**不会自动转入后付费**，需手动开通，否则报计费异常。
- 混元生图 FAQ 亦写明提供免费测试额度【二手，[腾讯云 FAQ](https://cloud.tencent.cn/document/faq/1668/86251)】。
- 另有 TokenHub 新人免费体验包（语言/多模态各 100 万 tokens、视频生成 50 积分、混元生 3D 100 积分），活动截至 2026-12-31【一手，[TokenHub 新人免费体验包](https://cloud.tencent.cn/document/product/1823/130053)】。

**价格**【一手，[混元生图计费概述](https://cloud.tencent.cn/document/product/1668/90896)】：

预付费资源包（元）：
| 接口 | 1000 张 | 1 万张 | 10 万张 | 100 万张 |
|---|---|---|---|---|
| 混元生图（3.0） | 200 | 2000 | 20000 | 200000 |
| 混元生图（2.0） | 400 | 3500 | 30000 | 280000 |
| 混元生图（极速版） | **99** | 900 | 8500 | 80000 |
| 图像风格化（图生图） | 99 | 900 | 8500 | 80000 |
| 百变头像 | 99 | 900 | 8500 | 80000 |
| AI 写真-生成相关 | 260 | 2400 | 23000 | 220000 |
| 模特换装 | 400 | 3500 | 30000 | 280000 |
| 商品背景生成 / 线稿生图 | 100 | 850 | 7500 | 65000 |

后付费（阶梯到达）：
| 接口 | 0<月用量<1万 | 1万≤x<10万 | 10万≤x<100万 | ≥100万 |
|---|---|---|---|---|
| 混元生图（3.0） | 0.2 元/张 | 同 | 同 | 同 |
| 混元生图（2.0） | 0.5 元/张 | 同 | 同 | 同 |
| 混元生图（极速版） | 0.099 | 0.094 | 0.088 | **0.066** |
| 图像风格化（图生图） | 0.099 | 0.094 | 0.088 | 0.066 |
| 百变头像 | 0.099 | 0.094 | 0.088 | 0.066 |
| AI 写真-生成 | 0.28 | 0.26 | 0.25 | 0.24 |
| 模特换装 | 0.5 | 同 | 同 | 同 |
| 商品背景生成 / 线稿生图 | 0.12 | 0.10 | 0.08 | 0.07 |

> 二手对比文把「混元生图（轻量版）」的价格区间写作 **0.066~0.099 元/张**，与上表极速版一致【[DeepBlog](https://www.mxphp.com/post/api)】。

**并发**：默认 1 个并发（图像风格化 3 个），主子账号共享；**并发叠加包 500 元/并发/天 或 10000 元/并发/月**【一手，同上】。

**参数面与能力**【一手，[提交混元生图（3.0）任务](https://cloud.tencent.cn/document/api/1668/124632)、[文生图轻量版](https://cloud.tencent.com/document/product/1729/108738)】：
- `Prompt`（最多 8192 utf-8 字符，推荐中文）、`Images.N`（参考图最多 3 张，Base64 或 URL）、`Resolution`（支持尺寸列表枚举，如 1024:1024、1344:704、1280:720…）、`Seed`（1–4294967295）、`LogoAdd`（默认 1 = 添加水印）、`LogoParam`（可换成自定义标识图）、`Revise`（prompt 改写，默认开启）。
- 文生图轻量版：`Style` 枚举，**不传默认使用 201（日系动漫风格）**；分辨率 768:768 / 768:1024 / 1024:1024 / 720:1280 / 1080:1920 等；`RspImgType`（base64 或 url，url 有效期 1 小时）。
- 接口域名：`aiart.tencentcloudapi.com`（Version 2022-12-29）、`hunyuan.tencentcloudapi.com`（轻量版，Version 2023-09-01，仅 ap-guangzhou）。
- 另有：图像风格化（图生图）、百变头像、AI 写真、模特换装、商品背景生成、线稿生图、局部消除（限时免费）、扩图（限时免费）。
- **无 LoRA / ControlNet**。

**审查尺度（有明确错误码）**【一手，[错误码表](https://cloud.tencent.cn/document/api/1668/124632)】：
- `FailedOperation.GenerateImageFailed` =「生成图片审核不通过，请重试」
- `OperationDenied.ImageIllegalDetected` =「图片包含违法违规信息，审核不通过」
- `OperationDenied.TextIllegalDetected` =「文本包含违法违规信息，审核不通过」
- 官方建议：使用显著标识提示结果图使用了 AI 绘画技术。

**动态**：2026-09-22 发布的混元图像 3.5 预览版（Hy Image3.5 preview）已明确按图计费；更早开源的混元图像 3.0 仍可免费使用，但官方网页入口逐步迁移至腾讯云 TokenHub 平台，**未实名认证将无法提交任务**【二手，[php.cn](https://www.php.cn/faq/3223600.html)】。

---

### 2.3 火山引擎 · 即梦 AI API / 豆包 Seedream

**购买方式**【一手/二手混合，[ChooseAI 接入教程](https://www.chooseai.net/news/6540/)】：
- 主体是字节跳动即梦 AI，API 能力托管在火山引擎；入口 `volcengine.com/product/jimeng`，控制台 `console.volcengine.com/ai/overview`，文档 `docs.volcengine.com/docs/85621`。
- **鉴权是 AK/SK 签名（AccessKey ID + AccessKey Secret），不是 API Key**，调用地址 `visual.volcengineapi.com`。这是与走火山方舟的豆包 API 最大的认知错位。
- **即梦 API 与豆包（火山方舟）分属两套体系**：鉴权方式、模型前缀、调用地址均不同；网页端积分制与 API 按量计费账号互通但额度独立。

**价格**【二手转述官方计费文档，[ChooseAI](https://www.chooseai.net/news/6540/)】：
| 能力 | 价格 |
|---|---|
| 即梦AI-图像生成 3.0 系列（文生图 3.0/3.1、图生图 3.0 智能参考、AI 营销商品图 3.0） | 0.2 元/张 |
| 即梦AI-图片生成 4.0 / 4.6 | 0.22 元/张（按生成张数，单次有概率出图多张） |
| 即梦AI-交互编辑 inpainting | 0.2 元/张 |
| 即梦AI-智能超清 | 0.4 元/张 |
| 视频生成 3.0 Pro | 1 元/秒 |
| 视频生成 3.0 1080p | 0.63 元/秒 |
| 视频生成 3.0 720P | 0.28 元/秒 |
| 动作模仿 | 0.5 元/秒 |

**免费额度**：开通时选「免费试用」含 **200 次体验额度**，并发限制 1；正式调用并发提升至 2。图片与视频能力分别按各自免费策略计算【二手，同上】。

**计费规则**：只有调用成功（正常返回图片或视频）才计费；资源包支持按秒/按次购买，有效期 1 年、可叠加，用完后不禁止调用，转按量计费。

**能力**【一手/二手，[即梦图片生成 4.0 文档](https://www.volcengine.com/docs/85621/1817044)、[极客智坊文档](https://docs.geekai.co/cn/docs/image/jimeng/jimeng_t2i_v40)】：
- 即梦 4.0 在统一框架内集成文生图、图像编辑及多图组合生成；单次最多输入 10 张图像；一次最多输出 15 张内容关联图像；支持 4K。
- `size` 默认 2048×2048，宽高像素值在 [1024×1024, 4096×4096] 之间；`strength` 可替代官方 `scale` 控制文本影响程度（[0,1]，默认 0.5）。
- 适用场景：电商营销、商业设计、专业海报、影视动漫。

**促销**：2025-09 上线时新用户限时 3 折【二手，[AITOP100](https://www.aitop100.cn/infomation/details/28908.html)】；资源包分 200 次 / 1000 次档【二手，[php.cn](https://www.php.cn/faq/1696899.html)】。

**审查尺度**：检索到的资料普遍描述 Seedream/Seedance 系列审核**中等偏严**，对政治敏感人物/事件/符号、暴力血腥、色情性暗示与裸露、真人肖像直接拦截【二手，[AI优尚网](https://jxysys.com/post/20903.html)】。该站点为 AI 生成痕迹明显的 SEO 内容，**需谨慎采信**，但方向与国内合规要求一致。

**Seedream 经由中转站的价格对照**（供比价）：
- API易（声称与 BytePlus 官方同价）：`seedream-5-0-260128` $0.035/张（约 ¥0.245）、`seedream-4-5-251128` $0.04/张、`seedream-4-0-250828` $0.03/张；官方提供 200 张免费图片测试额度【一手，[API易 Seedream 文档](https://docs.apiyi.com/api-capabilities/seedream-image/overview)】。
- 数眼智能：`doubao-seedream-5-0-260128`，OpenAI 兼容 `/v1/images/generations`，按输出 token 计费，要求总像素 ≥ 3,686,400（1920×1920）且 ≤ 16,777,216【一手，[图像生成接口文档](https://doc.shuyanai.com/doc-8993141)】。

---

### 2.4 百度智能云 · 文心一格 / AI 作画

**价格**【一手，[百度智能云产品价格](https://cloud.baidu.com/doc/NLP/s/rla2bfacx)】：
- 按量后付费：AI作画-iRAG版 0.03 元/点；AI作画-基础版 0.3 元/点；AI作画-高级版 0.3 元/点；AI作画-极速版 0.3 元/点；画面扩展 0.3 元/点；主体一致图像生成与调整 0.3 元/点。
- 点数按尺寸消耗：AI作画-高级版 基础尺寸 3 点/张、高级尺寸 6 点/张、4K 尺寸 9 点/张；基础版 1 点/张；iRAG 版 6 点/张。
- 资源包阶梯：主体一致图像生成与调整 200 点 40 元（0.2 元/点）→ 2000 点 360 元（0.18）→ 2 万点 3200 元（0.16）→ 20 万点 28000 元（0.14）。
- 各家口径写作「文心一格 Pro 约 0.5 元/张」【二手，[DeepBlog](https://www.mxphp.com/post/api)】。

**免费额度**：各 API 在免费额度用完后超出部分需额外购买，否则接口报错；采用后付费与预付费两种方式【一手，同上】。
**网页版**：未实名每天 50 次，实名后 100 次；签到送电量，连签电量累加；免费版带百度水印【二手，[FlowPix](https://www.flowpixai.com/tutorials/how-to-use-ai-painting-free.html)】。
**会员**：约 ¥69/月含 1000 张，超出 ¥0.5/张【二手，[提效录](https://www.tixiaolu.com/posts/kw-51a4e5de/)】。

---

### 2.5 智谱 BigModel（CogView / GLM-Image）

**价格**【一手，[CogView-4 文档](https://docs.bigmodel.cn/cn/guide/models/image-generation/cogview-4)、[TheRouter 汇总](https://therouter.ai/zh/models/zhipu--cogview-4/)】：
- `cogview-4` / `cogview-4-250304`：**0.06 元/张**（0.01 PTC/次 在 302.AI 网关口径下）。
- `glm-image`：0.016 PTC/次（约 ¥0.12/张，hd 模式，最高 2048×2048，仅支持 hd）。
- **`CogView-3-Flash` 免费（¥0）**——前代模型，零成本原型验证用。

**能力**【一手，[bigmodel 图片生成 API](https://s.apifox.cn/apidoc/docs-site/4012774/270362258e0)】：
- `model`：`glm-image` / `cogview-4-250304` / `cogview-4`。
- `size`：cogview-4 推荐 1024x1024 默认，及 768x1344 / 864x1152 / 1344x768 / 1152x864 / 1440x720 / 720x1440；自定义 512–2048px、16 整除、最大像素 2²¹。glm-image 推荐 1280x1280 默认，及 1568×1056 / 1056×1568 / 1472×1088 / 1088×1472 / 1728×960 / 960×1728；自定义 1024–2048px、32 整除、最大像素 2²²。
- `quality`：`hd`（约 20 秒）/ `standard`（约 5–10 秒）。
- `user_id`（6–128 字符）：官方说明用途是「协助平台对终端用户的违规行为、生成违法及不良信息或其他滥用行为进行干预」——即**审核追溯机制**。
- `watermark_enabled`：默认 true，同时加显式水印与隐式数字水印（官方称「符合政策要求」）；可设 false 关闭。
- 输出是图片 URL，有效期 30 天；CogView-4 **不支持图生图/编辑**。

**免费额度**：CogView-4 无免费额度（首次送体验）；智谱开放平台新用户赠送 **2000 万 tokens**（LLM 口径），标注为「永久额度」【二手，[CSDN 汇总](https://blog.csdn.net/weixin_55062269/article/details/158925835)】。

---

### 2.6 快手可灵

- 定位偏视频；图像生成、视频生成、虚拟试穿三项能力已全面开放 API【二手，[腾讯新闻](https://news.qq.com/rain/a/20241119A07JDI00)】。
- 下单页面提供测试额度；企业用户和个人开发者均可登录「API 调用」进入购买页选资源包。
- 网页版免费：**每天 66 积分**；会员黄金 66 元/月（660 灵感值）、铂金 266 元/月（3000）、钻石 666 元/月（8000）【二手，[AI 地带](https://www.aididai.cn/sites/4898.html)】。
- 视频 API 价格（第三方网关口径）：kling-v3 std 0.6~0.9 元/视频秒、pro 0.8~1.2 元/视频秒；kling-3.0-turbo 720p 0.8 元、1080p 1 元、4k 3 元【二手，[智增增 API](https://doc.zhizengzeng.com/doc-9123364)】。
- 二手对比文结论：**可灵偏视频，不推荐纯图片用途**【[DeepBlog](https://www.mxphp.com/post/api)】。

---

### 2.7 其他国内厂商（信息较少）

| 厂商 | 事实 |
|---|---|
| **商汤秒画 SenseMirage** | 面向 B 端开放；自研 AIGC 文生图大模型超 10 亿参数，**支持二次元、三次元等多种生成风格**；可一键导入本地模型及第三方开源模型，导入后自动用其模型编译技术加速（实测本地 RTX3070 需 10 秒的图可缩到 2 秒）【二手，[新民网](https://wap.xinmin.cn/content/32359846.html)、[中证网](https://www.cs.com.cn/ssgs/gsxw/202304/t20230413_6337042.html)】。**未检索到公开 API 定价。** |
| **阶跃星辰（跃问）** | 支持图片生成；API 注册送额度（记录为 ¥10 / 无明确限制 / 5 RPM）【二手，[yangmao.ai 数据集](https://yangmao.ai/zh/data/ai-free-tiers/)】。**定价未查证。** |
| **MiniMax（海螺）** | 海螺 AI 免费使用；API 注册送额度【二手，[yangmao.ai](https://yangmao.ai/zh/providers/)】。**图像 API 细节未查证。** |
| **模力方舟 / Gitee AI（MoArk，开源中国）** | `base_url=https://ai.gitee.com/v1`，OpenAI 兼容；**每日 100 次免费 API 调用**；Z-Image-Turbo 每日免费 100 张 2K（二手描述）；覆盖 70+~100+ 开源模型【一手 [ai.gitee.com](https://ai.gitee.com)、[文生图文档](https://ai.gitee.com/docs/products/apis/images-vision/text2image)、二手 [CSDN](https://blog.csdn.net/aosky/article/details/155577662)、[iGetoken](https://igetoken.com/models/moark)】。 |
| **硅基流动 SiliconFlow** | 注册送 ¥14；**Kwai-Kolors 文生图模型免费**；收费的 Tongyi-MAI/Z-Image-Turbo 与 Qwen/Qwen-Image-Edit-2509 约 0.1~0.3 元/张；支持文生图 + 图生图（图像变体）两种方式；支付支持支付宝/微信，充值需实名，未消费余额 360 天内可申请退款【一手 [定价页](https://www.siliconflow.com/zh/pricing)、[图片生成文档](https://docs.siliconflow.cn/cn/userguide/capabilities/images)、二手 [Zone.ci](https://zone.ci/secarticles/wx/573191.html)、[ComputeUnion](https://www.computeunion.net/zh/api-pricing/cn-relay)】。 |

**国产大模型生图 API 横向对比表（二手汇总，供快速定位）**——来源 [DeepBlog](https://www.mxphp.com/post/api)：

| 厂商 | 模型 | 参考单价（元/张） | 免费额度 | 中文出字 |
|---|---|---|---|---|
| 阿里百炼 | 通义万相 wan2.6 | ~0.2 | 50 张 | 一般 |
| 智谱 | CogView-4 | ~0.06 | 无（首次送体验） | 强 |
| 腾讯云 | 混元生图（轻量版） | 0.066~0.099 | 50 次 | 中等 |
| 百度智能云 | 文心一格 Pro | ~0.5 | 无 | 一般 |
| 火山引擎 | 即梦 / Seedream | 订阅制+每日免费 | 每日免费额度 | 中等 |
| 快手 | 可灵 | 参考视频生成 | 试用 | 弱 |

---

## 3. 国内 AI 绘画社区 / 平台的 API

### 3.1 LiblibAI（哩布哩布 / 星流）——最接近"国内可用的 Illustrious 生态 API"

**API 开放平台**：`https://www.liblib.art/apis`【一手】

官方对照表（两条产品线）：

| | 星流 Star-3 大模型 | LiblibAI 自定义模型 |
|---|---|---|
| 底模 | 星流自研，搭载 LoRA 推荐算法 | 基于 F.1 / XL / v3 / v1.5 等 |
| 定位 | 无需复杂控制，适合通用风格 | 高度自由、精准控制和特定风格 |
| **可加 checkpoint/LoRA** | ❌ 不可添加 | ✅ 可添加全站可商用模型和个人已发布模型 |
| ControlNet | 仅可添加 **4 款** | 可添加全站所有和最新开源插件 |
| 风格预设 | 含 | 不含 |
| 商用 | 可出售生成图片或用于商业目的，**含 F.1 商用使用权** | 同 |
| **内容审核** | **出图含内容审核** | **出图含内容审核** |

**计费**【多源】：
- 官方：「非固定消耗，与生成图片使用的模型和参数有关，查看计费规则」；**API 积分与 LiblibAI 生图/会员的积分不通用，是两套体系**；API 积分为虚拟商品，一经充值不支持退款。
- 二手（2025-08，[苏米客](https://www.xmsumi.com/detail/1406)）：印有免费计划，**注册就送 7 天免费试用 500 积分**；正式使用 **￥10 / 1000 积分**。支持星流 Star-3 Alpha 文生图和图生图。
- 二手（[游乐网](https://www.youleyou.com/wenzhang/3101012.html)）：「100 积分 = 1 点算力」；花 50 积分可启用高优先级队列跳过排队；API 费用可 100% 用积分抵扣，需在 API 控制台「调用管理」开启「积分优先支付」；积分不足请求直接失败返回 `INSUFFICIENT_CREDITS`，**不会转扣微信或支付宝**；API 调用明细不显示积分抵扣记录。
- 二手（[liblibaicn.com/price.html](https://www.liblibaicn.com/price.html)，**该域名非官方，可信度低**）：SaaS 年费套餐起订 18 万元/年含 50 万点；API 标准接口 0.15 元/次（1000 次起购）。

**认证**：API 开放平台用 `AccessKey` + `SecretKey`；官方文档在 `liblibai.feishu.cn`，第三方评价「使用方法比较复杂，要生成签名」（[苏米客](https://www.xmsumi.com/detail/1406)）。

**站内（非 API）价格**【一手/二手】：
- 免费用户登录每日赠送 **20 积分**，云端存储空间 3GB；订阅积分每 31 天重置【一手，[liblib.art/viphome](https://www.liblib.art/viphome)】。
- 星流 AI：免费会员登录每日领 150 点数（[aididai](https://www.aididai.cn/sites/11199.html)）或 100 点（[sparkx](https://www.sparkx.zone/tools/xingliu.html)，两处口径冲突）；标准会员 469 元/年（或 59 元/月）含每月 4000 星流点数；高级会员 949 元/年（或 119 元/月）含 12000 点；超级会员 1899 元/年含 24500 点。
- LiblibAI 会员：基础版 VIP 35 元/月、专业版 70 元/月（第三方口径）；免费版每日约 300 张（该数字与其他来源的"每日 20 积分"矛盾，疑似 AI 生成内容，**不建议采信**）【二手，[ai138 对比](https://www.ai138.com/pk/liblib-vs-xingliu)】。

**能力**：站内支持完整文生图/图生图、ControlNet（Canny/Depth/OpenPose 等）、Hires.fix、多 LoRA 同时使用、在线 ComfyUI；LiblibAI 2.0（2025-10）起接入 Qwen-Image、Seedream 4.0、Nano Banana、Midjourney V7 等多模型工作室形态【二手，[量子位](https://www.qbitai.com/2025/10/341697.html)、[腾讯新闻](https://news.qq.com/rain/a/20251015A05W6C00)】。

**内容审查事件（重要）**：
- 2026-04 央视曝光多款 AI 应用涉黄生成漏洞，**哩布哩布 AI 被直接点名**（可用隐晦提示词绕过审核生成半裸女性跳舞视频）。
- 新京报 2026-04-13 实测：输入类似提示词已无法生成「擦边视频」；**将提示词切换为英文后，平台直接提示「生成失败」**。
- 官方 2026-04-14 声明：已第一时间完成技术修复，对风险路径进行全面封堵【一手转述，[新京报](https://www.bjnews.com.cn/detail/1776173795129845.html)】。

### 3.2 吐司 TusiArt（tusi.cn / tusiart.com）

- **API 价格**：算力单价 **0.01 元/点**，无需自建 SD 环境与显卡【二手但标注"官方来源已核实"，[白嫖计](https://baipiaoji.com/tools/tusiart)，核实于 2026-08-06】。
- 该页同时说明：社区端可免费在线出图（支持 SD 1.5 / SDXL / 混元 DiT 等底模与 LoRA、ComfyUI 工作流），但**每日免费算力的具体数额官方未在可核实页面公布**；社区端与 API 是两条线，API 按点计费不受免费额度影响。
- **会员**：Pro 会员 **29 元/月**，享无限生图额度、优先算力通道、高清无水印下载、商用授权；企业版可定制专属模型库、独立算力集群、API 接口调用【二手，[DeepNavi](https://www.deepnavi.cn/si-tusiai)】。
- **支付**：支持微信/支付宝支付；国内服务器无需翻墙【二手，[AIToolsNav](https://aitoolsnav.cn/tool/1463.html)】。
- **能力**：5 万+ 精选模型，涵盖二次元/写实/建筑设计等；支持一键 LoRA 训练、模型下载、C 站模型一键迁移、高清修复、ADetailer；ControlNet 与局部重绘在 2026-08 时仍标注内测中【二手，同上】。
- **内容尺度**：站内可检索到 NSFW 命名的模型（如「月老板-illustrious_NSFW二次元风格-IL」）【一手，[tusi.cn](https://tusi.cn/)】，但平台本身为「国内合规 AI 绘画模型分享社区」（[DeepNavi](https://www.deepnavi.cn/si-tusiai) 描述），实际生成仍有审核。
- **域名注意**：`tusi.qq.com` 是腾讯内部孵化的 vibe coding 产品「腾讯吐司」，与 TusiArt 无关；`tusiartcn.com`、`tusi.ai-kit.cn` 等为第三方导航/仿站。

### 3.3 海艺 SeaArt（seaart.ai / haiyi.art）

- **双版本运营**：`seaart.ai`（国际，定价美元）与 `haiyi.art`（国内，成都海艺互娱科技有限公司，`SUNRISEAI PTE. LTD.` 为国际主体）【一手 [haiyi.art](https://www.haiyi.art)、二手 [爱企查](https://aiqicha.baidu.com/details/ugknowledge?id=89419e23f6b6bbcd5391eb02842b228b)】。
- **会员价格（口径冲突，务必注意）**：
  - 36氪：月卡 **18~348 元**之间，含每日体力、首充赠送算力、创作次数、模型训练等权益；另有开宝箱、超值礼包等游戏化内购【二手，[36氪](https://www.36kr.com/p/3552777239313538)】。
  - 腾讯新闻（2025-12）：月订阅 $5.99 / $25.49 / $50.99 / $127.49【二手，[腾讯新闻](https://news.qq.com/rain/a/20251209A03O6T00)】。
  - Wondershare：$5.99 / $29.99 / $59.99 / $149.99【二手，[Wondershare](https://miao.wondershare.cn/video-editor-review/seaart-ai-review.html)】。
  - 官方商城页自述：「会员定价为不含税价格」「网站商城内显示的为预估价格，由于汇率变动，请以实际支付为准」——说明**国际站以美元计价并按汇率换算**；国内站 `haiyi.art` 才有明确的人民币定价【一手，[SeaArt 商城](https://www.seaart.ai/zhCN/mall)】。
- **两种货币**【一手，[SeaArt 商城](https://www.seaart.ai/zhCN/mall)】：
  - **体力**：每日自动充值，当日有效、不可累计；基础用户每日 150 体力（另一版本文档写 130）。
  - **算力**：活动类算力 2026-04-01 起有效期 90 天~2 年；购买类算力 2026-04-01 起自购买日起 2 年有效；可累积使用。创作时优先消耗体力，不够时自动用算力补。
  - 官方商城页对「Standard Image: 6 Credits」的美元换算同时给出 ≈$0.006 与 ≈$0.06 两种，**同一页面口径冲突**（上一份报告已记录）。
- **SeaCloud API**【一手，`cloud.seaart.ai`】：
  - 统一队列形态：`POST /v1/queue/{modelId}` → 返回 `request_id` / `status_url` / `response_url` / `cancel_url` / `queue_position`。
  - 已文档化模型举例：`gpt_image_2`（含 `moderation` 参数）、`gpt_image_1_5`、`nano_banana`、`flux_2_pro`（**`safety_tolerance` 0–5，0 最严、5 最宽，默认 2**）、`wan25_i2i_preview_intl`。
  - 另有图像/视频/音频多模态：`minimax_hailuo_23_fast_i2v`、`happyhorse_1.0_r2v` 等。
  - 官方 Python SDK（`seaart`）。
- **站内能力**：Checkpoint + 最多 5 个 LoRA 叠加、ControlNet（openpose / lineart realistic & anime / depth / ip_adapter）、VAE（含 `kl-f8-anime2`）、img2img、AI Canvas、ComfyUI；含 SDXL、Anime 系列、Illustrious 系列、NoobAI-XL【一手，[SeaArt 文档](https://docs.seaart.ai/guide-1/4-parameters/4-1-model)、[NOOBAI XL 文档](https://docs.seaart.ai/guide-1/6-permanent-events/high-quality-models-recommendation/noobai-xl.md)】。
- **支付**：官方 FAQ 写「正在积极接入更多本地化支付方式」并引导用户反馈需求——**暗示部分本地化支付方式尚未全线支持**【一手，[SeaArt 商城](https://www.seaart.ai/zhCN/mall)】。国内站 `haiyi.art` 有人民币定价；淘宝有「SeaArt 会员代充 算力充值」服务（¥15 起，12.88 刀月卡代充）【二手，[淘宝](https://www.taobao.com/list/item/OW0vTG5vVk0wSXR0eGNjYWhiK3psUT09.htm)】。
- **NSFW 状态**：NGA 用户称「去年的更新后同样无法 GHS 了」【二手，[NGA](https://nga.178.com/read.php?tid=43606229)】。
- **风险提示**：Trustpilot 上有用户反馈被误扣全年订阅费、3 天试用期内提前自动续费；有 Google Play 用户反馈「选了 0.01 元试用，直接扣了 251 刀」【二手，[Somake 评测](https://www.somake.ai/zh_CN/blog/seaart-ai-review)、[Google Play](https://play.google.com/store/apps/details?hl=zh&id=ai.seaart.app.global)】。

### 3.4 触手 AI（chushou.art）

- 杭州水母智能科技有限公司出品；定位二次元/动漫创作；原域名 `acgnai.art` 已于 2026-07-27 迁移至 `chushou.art`。
- 功能：文生图、图生图/参考生图、**ControlNet 条件生图与局部重绘**、自定义 LoRA 模型训练。
- **定价**：基础功能免费（每日有限次数，最高 1080P）；**专业版 39 元/月**（更多次数、最高 2K、优先队列）；**企业版不限次数、最高 4K、支持 API**【二手，[AI工具宝箱](https://www.aitoollab.cn/tools/chuchu-ai/)】。
- 缺点：免费版每日次数限制，用得勤很快用完；社区分享功能弱【二手，同上】。
- **API 定价与文档未检索到公开页面。**

### 3.5 无界 AI（wujieai.com）

- 定位更偏新手友好，界面简洁，背后也有 SD 模型支撑（[00011000](https://00011000.com/tools/liblib%E5%93%A9%E5%B8%83%E5%93%A9%E5%B8%83)）。
- 每日赠送额度；有「咒语解析器」独家功能；支持桌面端【二手，[diduq](https://diduq.com/)】。
- iOS 会员自动续订说明：**苹果 AI 会员连续包月 128 元/月**【一手转述，[xix.ai 应用说明](https://www.xix.ai/zh/app/ai-app.html)】。
- **公开 API 未检索到。**

### 3.6 堆友（阿里，Draft）

- 定位电商设计（主图/详情页/Banner、AI 模特换装、产品场景化、3D 素材生成）。
- 免费使用基础功能，高级功能/更多额度付费（约 30 元/月）；免费版有水印但可手动裁掉【二手，[171host](https://www.171host.com/801939.html)、[FlowPix](https://www.flowpixai.com/tutorials/ai-painting-free-help-guide.html)】。
- **公开 API 未检索到。**

---

## 4. 人民币中转 / 聚合平台（可调用海外模型）

> **合规提示（重要）**：2026-06-08 国家安全部发布风险提示，指出「AI 中转」市场鱼龙混杂，部分站点运营资质缺失、安全防护薄弱，存在隐私泄露与数据倒卖；部分站点用低配模型冒充高端模型、缩减算力供应。上海一名 AI 中转站站长被公安机关依法刑事拘留。据《计算机信息网络国际联网管理暂行规定》，多数中转站没有跨境通道资质【二手，[中新网](https://www.chinanews.com.cn/cj/2026/06-22/10644787.shtml)、[搜狐](https://www.sohu.com/a/1079320371_122983014)、[知乎](https://zhuanlan.zhihu.com/p/2039746211180171547)】。**本报告仅罗列检索到的事实，不构成对任何中转站的推荐。**

### 4.1 有明确公开生图定价的平台

| 平台 | 生图相关模型与价格 | 支付 | 出处 |
|---|---|---|---|
| **API易**（apiyi.com） | `gpt-image-2` 官转（OpenAI 官转，size/quality 精确控、参考图自动高保真、mask 重绘，按 token 原价）；`gpt-image-2-all` 官逆 **$0.03/张**（约 30–60s）；`gpt-image-2-vip` 官逆 Codex 线 **$0.03/张**（30 档 size 含 4K）；FLUX.2-max $0.07/次、pro $0.03/次、flex $0.06/次；Nano Banana Pro / Nano Banana 2；Seedream 5.0 $0.035 / 4.5 $0.04 / 4.0 $0.03；Wan2.7 视频 $0.084–0.14/秒；另设**零代码「AI 图片大师」** `imagen.apiyi.com` | 微信/支付宝 | 【一手，[图像与视频生成模型](https://apiyillc.mintlify.app/api-capabilities/image-video-models)、[gpt-image-2 文档](https://docs.apiyi.com/api-capabilities/gpt-image-2/overview)、[Seedream 文档](https://docs.apiyi.com/api-capabilities/seedream-image/overview)】 |
| **API易 免费/首充** | 注册即送 **$0.1**（其中 $0.05 可用于体验 Nano Banana 2，约 1–2 次）；**首充加赠**：普通用户 +$1、高校/企业用户 +$2、单次满 $50 额外 +$5、单次满 $100 额外 +15%；$50/$100 档需联系客服手动处理 | 微信/支付宝 | 【二手但含官方活动细节，[GitHub umu02720/apiyi](https://github.com/umu02720/apiyi)、官方博客 [Nano Banana 2 免费体验](https://help.apiyi.com/nano-banana-2-free-trial-apiyi-guide.html)】 |
| **API易 的审核** | 文档明确列出 `403 内容审核拦截` →「调整 prompt 或传 `moderation: low`」；`gpt-image-2` 由 OpenAI 自带内容安全审核，触发审核或参数非法时返回 400 且不计费 | — | 【一手，[gpt-image-2 文档](https://docs.apiyi.com/api-capabilities/gpt-image-2/overview)】 |
| **302.AI** | 图片异步生成 `POST /302/v2/image/generate`（支持 json 与 multipart；支持 webhook、`run_async`；参数含 `prompt`/`model`/`height`/`width`/`negative_prompt`/`aspect_ratio`/`output_format`/`image`（多图）/`mask_image`）；CogView-4 = 0.02 PTC/次；CogView-4-250304 = 0.01 PTC/次；glm-image = 0.016 PTC/次 | 支付宝 · Visa · MC · amex · unionpay | 【一手，[302.AI 图片生成 API 文档](https://doc.302.ai/337661604e0)；二手，[ComputeUnion](https://www.computeunion.net/zh/api-pricing/cn-relay)】 |
| **302.AI 计费条款** | 先充值、按使用扣费、**无月费**；余额不失效且无套餐门槛；**充值到账后通常不退**；平台技术问题造成的异常 PTC 消耗可在 7 个工作日内提交证据申请 | | 【二手，[ComputeUnion](https://www.computeunion.net/zh/api-pricing/cn-relay)、[RouterHubs](https://routerhubs.com/relays/302-ai/)】 |
| **AiHubMix**（推理时代） | OpenAI 兼容；模型管理 API `GET https://aihubmix.com/api/v1/models?types=image_generation`（类型还支持 video/tts/stt/embedding/rerank）；目录含 `Wan2.6 T2i`、`Fx Flux 2 Pro`、`Stable Diffusion 3.5 Large`、`Dall E 3`、`Cogview 3/3 Plus`、`GPT Image Test` 等；自研路由 `model=auto` 按实际命中模型原价计费、不额外收费 | 支付宝/微信（第三方列在支付宝名单内） | 【一手，[AIHubMix 模型管理 API](https://aihubmix.mintlify.app/cn/api/Models-API)、[模型与定价](https://aihubmix.com/models?lang=zh-TW)；二手，[HowToken](https://howtok.net/alipay)】 |
| **APIMart**（apimart.ai） | Midjourney 纯 API（`POST /v1/midjourney/generations`，可在 8.1/7/6.1/5.2/5.1/Niji 7/Niji 6 间切换，支持 stylize/chaos/weird/quality，relax/fast/turbo 三档队列，按成功张数计费、失败不扣费、无需 MJ 月订阅）；**Wan 2.7 图像：pro ￥0.50/张、标准 ￥0.20/张**（按成功张数计费、与分辨率无关、失败不扣费）；wan2.7 支持组图（1–12 张）、`thinking_mode`、`color_palette` | 支付宝（第三方名单） | 【一手，[Midjourney API 页](https://apimart.ai/zh/model/midjourney)、[wan2.7 文档](https://docs.apimart.ai/cn/api-reference/images/wan2.7-image/generation)；二手，[HowToken](https://howtok.net/alipay)】 |
| **块乐 Encore**（stillhappy.cn） | `image2` **¥0.04/张**（约 $0.0056）；宣称满血、不掺水、可开发票 | 支付宝 / 微信 | 【二手，本页系该平台的自述软文，[wwhsipser](https://wwhsipser.com/article/sr5o96ac) 与 [TCO 对比](https://wwhsipser.com/article/niryh0vf)，可信度存疑】 |
| **island AI Coding**（codex789.com） | **Grok Imagine Image 2.0 ¥0.01/张**、Grok Imagine Image Quality ¥0.01/张、GPT-image2 ¥0.03/张、GPT Image 2.5 Flare/Sunburst ¥0.03/张；Grok Imagine Video 1.5 ¥0.05/秒；统一 `https://www.codex789.com/v1` | 微信 / 支付宝 | 【一手，[定价页](https://www.codex789.com/pricing/)、[首页](https://www.codex789.com/)】 |
| **DMXAPI**（dmxapi.cn / .com） | 300+~480+ 模型；文本/图像/视频分别计价；图片按张、音频按时长、视频按帧；Gemini-3-pro-image-preview **0.2/次**（DMXAPI 口径，另有平台标 0.05/次）；Gemini 3.1 Flash Image Preview 0.1 输入 / 26.28 输出（按量）；充 $100 送 15% 等 | 支付宝/微信（国内直连）；国内站 .cn（RMB）、国际站 .com（USD） | 【二手，[EggStriker 测评](https://www.eggstriker.com/ai-api/dmxapi)、[zeeklog 价格对比](https://zeeklog.com/2026nian-zui-zhi-de-guan-zhu-de-6ge-aixin-mo-xing-guo-nei-zhong-zhuan-apijie-ge-quan-mian-dui-bi)】 |
| **Router One**（router.one） | OpenAI 兼容 `https://api.router.one/v1`；生图 `POST /v1/images/generations`、图生图 `POST /v1/images/edits`；模型含 gpt-image-2、GPT Image 2.5 Flare/Sunburst、Gemini 3 Pro Image（Nano Banana Pro）、Gemini 3.1 Flash Image（Nano Banana 2）、Grok Imagine；**媒体模型按件计价，每张图一个固定美元单价**；按 Key 的预算与消费上限（maxSpend）生效 | 支付宝 / 银行卡 / USDT / USDC（6 条链） | 【一手，[生图 API 页](https://router.one/zh/image-generation-api)、[加密支付页](https://router.one/zh/pay-with-crypto)】 |
| **NamiFusion** | `ai/prefect-pony-xl`（**Pony XL 动漫风格**，文生图，默认 1024×1024，支持 seed=-1 随机，输出 jpeg/png/webp）**$0.015/次** | 未在页面披露 | 【一手，[模型页](https://www.namifusion.com/zh/models/prefect-pony-xl/text-to-image)】 |
| **laozhang.ai** | Gemini 2.5 Flash Image $0.025/图（比官方便宜 37.5%）；DALL·E 3 $0.028/图；无最低充值 | 本地支付（未具名） | 【二手，[FastAccess AI](https://fastgptplus.com/zh/posts/cheapest-image-generation-api)】 |
| **好Token**（haotk.cn） | OpenAI 兼容，20+ 模型，官方价 5 折起 | 人民币充值、对公转账、支付宝/微信 | 【一手，[haotk.cn](https://haotk.cn/)】 |
| **ImgAPI**（imgapi.vip） | 宣称「有赔付保障的 AI 生图 API 平台」，支持文字及参考图生成图片 | 未披露 | 【一手站点，[imgapi.vip](https://imgapi.vip)】 |
| **漫小白**（api.manxiaobai.online） | 「专注生图的 API 中转站」 | 未披露 | 【一手站点，[api.manxiaobai.online](https://api.manxiaobai.online)】 |

### 4.2 中转站信息聚合与横向对比资源

| 资源 | 内容 | 出处 |
|---|---|---|
| **HowToken 支付宝名单** | 收录 **192 家**支持支付宝充值的中转站 | [howtok.net/alipay](https://howtok.net/alipay) |
| **ComputeUnion 国内中转站价格对比** | 收录 35 个中转与聚合平台，覆盖 302.AI、硅基流动、云雾 AI 等；含支付方式、已采集报价 | [computeunion.net/zh/api-pricing/cn-relay](https://www.computeunion.net/zh/api-pricing/cn-relay) |
| **RouterHubs 中转站独立监控** | 采集官网/价格页/文档/用户线索，按模型、价格、充值门槛筛选；声明「不代理 API 请求，也不从中转调用中抽成」 | [routerhubs.com](https://routerhubs.com/) |
| **awesome-ai-api 中转站公开排行榜** | 「全球最大的开源双语 AI API 中转站排行榜」，每日探测 `/v1/models` 端点，含引擎指纹、30 天在线率、结构化黑名单 | [claws-zh.github.io/awesome-ai-api/zh](https://claws-zh.github.io/awesome-ai-api/zh) |
| **zeeklog 8 家中转商价格对比** | API易、DMXAPI、No.1-API、一步 API、柏拉图 AI、老张 API、GreatRouter、Grsai 的公开报价横向表（含 Gemini-3-pro-image-preview 分项） | [zeeklog](https://zeeklog.com/2026nian-zui-zhi-de-guan-zhu-de-6ge-aixin-mo-xing-guo-nei-zhong-zhuan-apijie-ge-quan-mian-dui-bi) |
| **AI 中转站 TCO 对比（1000 张图/月）** | 把 VPN（¥70–110/月）、延迟损失（约 ¥126/月）、支付手续费、集成维护摊销算入后的月度总成本对比 | [wwhsipser TCO](https://wwhsipser.com/article/niryh0vf) |

**关于中转站"掺水"风险的第三方描述**（二手，来源为平台自述性软文，仅作现象记录）：低价中转可能限制 token、缩短上下文、用低版本模型冒充高版本；同一 prompt 在不同平台结果可能不同【[wwhsipser](https://wwhsipser.com/article/lmeopv2n)】。

### 4.3 中转站的协议与能力形态（供技术选型）

- **OpenAI 兼容统一端点**：几乎所有平台都提供 `/v1/images/generations` 与 `/v1/images/edits`（部分用自有格式，如 302.AI 的 `/302/v2/image/generate`）。
- **异步与轮询**：生图多为异步任务，返回 `task_id` 后轮询；部分平台支持 webhook / `run_async`（302.AI）。
- **自建网关方案**：开源项目 `new-api`（One API 二次开发，支持 Midjourney-Proxy/Suno/Rerank、易支付在线充值）与 `image2api`（把 Adobe Firefly、OpenAI、Runway、Grok、Leonardo、Krea、Imagine 封装成一套 OpenAI 兼容 API，含积分计费、CDK 充值、邀请奖励、管理后台，基于易支付）——是理解中转站商业形态的直接素材【二手，[GitHub IllTamer/new-api-proxy](https://github.com/IllTamer/new-api-proxy)、[cyi-cc/image2api](https://github.com/cyi-cc/image2api)】。

---

## 5. 境外站点中"人民币 / 支付宝微信可达"的部分（关键章节）

### 5.1 PixAI —— 已知唯一同时满足「二次元原生 + 相对宽松 + 支付宝/微信」的大型平台

**支付方式（一手，官方支付指南，2026-06-30）**【[The Complete Guide to PixAI Payment Methods](https://blog.pixai.art/en/the-complete-guide-to-pixai-payment-methods/)】：

Web 端支持：
| 支付方式 | 自动续费 |
|---|---|
| Visa | ✅ |
| Mastercard | ✅ |
| Discover | ✅ |
| JCB | ✅ |
| American Express | ✅ |
| Google Pay | ✅ |
| **UnionPay（银联）** | ❌ |
| PayPay（日本） | ❌ |
| 便利店支付（日本） | ❌ |
| **WeChat Pay（微信支付）** | ❌ |
| **Alipay（支付宝）** | ❌ |

→ **微信支付与支付宝在列**，但都不支持自动续费，会员到期需手动重新购买。App 端走 App Store / Google Play，价格因平台费略高于 Web。

> ⚠️ 口径冲突：PixAI 较早的 [Payment FAQ](https://blog.pixai.art/en/payment-faq/)（2025-10-21）只列了 Visa / Mastercard / PayPay / Google Pay，未提微信支付宝。以更新的支付方式指南（2026-06-30）为准，但建议下单前在结算页实测确认。

**会员价格（一手）**【[会员文档](https://docs.pixai.art/docs/pricing/membership)】：
| | Free | Starter | Plus | Premium |
|---|---|---|---|---|
| 月付 | 免费 | $9.99 | $29.99 | $49.99 |
| 年付（折算月） | 免费 | $7.99 | $22.99 | $35.99 |
| 每月赠送 credits | — | 300,000 | 1,000,000 | 2,000,000 |
| 每日 credit 加成 | — | +20% | +100% | +200% |
| 购买 credit 加成 | — | +50% | +100% | +150% |
| 免费 LoRA 训练 | — | 3/月 | 5/月 | 10/月 |
| 单次可叠加 LoRA | 最多 3 | 最多 5 | 最多 10 | 最多 15 |

- 官方明确：**已购买的 credits 不过期**；升级即时生效；Web 端**不提供发票**；Web 端原则上**不退款**。
- 一次性优惠包：**$1 一次性优惠包**（每账号一次）+ 每月特别包【一手，[Payment FAQ](https://blog.pixai.art/en/payment-faq/)】。
- API：Platform API 走 `POST https://api.pixai.art/v2/image/create`；会员可即时获取 API Key，非会员需邮件申请（最长 5 个工作日）；API 生成不进入公开历史【一手，[Create image 文档](https://platform.pixai.art/en/docs/api-v2/image/createImage)、[FAQ](https://platform.pixai.art/en/docs/faq)】（上一份报告已详列参数面）。

**审查尺度（社区口径）**：NGA 二次元版教程作者称「目前所有在线网站中，唯一还支持**免费 NSFW/GHS** 的[大型]网站只剩下一个小日子的 PixAI（pixai.art）」，并抱怨「小日子的前端水平一塌糊涂」【二手，[NGA](https://nga.178.com/read.php?tid=43606229)，2026-01 更新】。

### 5.2 NovelAI —— 无官方人民币通道，靠代充/合租

- **官方支付**：通过合作伙伴 **Chargebee** 处理，仅三档订阅 Tablet $10 / Scroll $15 / Opus $25（每 30 天续费）【一手，[订阅文档](https://docs.novelai.net/en/subscription/)】；**不支持支付宝/微信**。
- **免费试用**：一次性提供 **30 次图像 + 50 次文本 + 100 次 TTS** 额度，不刷新【二手转官方，[ChooseAI](https://www.chooseai.net/news/6922/)】。
- **国内实际购买路径（人民币）**：
  - 淘宝：`Novelai AI绘图会员订阅 NAI3 NAI4代充服务 自动发货` **¥55**（25 刀订阅 成品/自动发货）【一手商品页，[淘宝](https://www.taobao.com/list/item/T3l1bGpYZ0Q0SEtPdXJ4ZFlPdTZiQT09.htm)】。
  - 淘宝另一家：`novelai会员订阅 Novel绘画礼品码代充 Vibe Transfer V4独享会员` **¥95**，SKU 含「【发您号】25刀升级版/月【4W贝壳】」「【5人共享】25刀会员/月」「【3人共享】25刀会员/月」「【代充您的号】25刀会员/月」等【一手商品页，[淘宝](https://pcdetail.taobao.com/ZGU5SEVncXlMSlNnQVo5N1Bka3p4dz09.html)】。
  - 账号星球（accountboy.com）：NovelAI Opus（3 人共享一个月）**￥79**、（5 人共享一个月）**￥49**；独享账号含每月 10,000 Subscription ImageAnlas【一手站点，[账号星球](https://www.accountboy.com/zh-cn-cny/buy-NovelAI)】。
  - Speed4Card：NovelAI 人工代购 $40.20（Opus 成品号 / 1w·5w·10w 点 Anlas 代充档位），支持 PayPal、国外信用卡、西联汇款【一手站点，[Speed4Card](https://www.speed4card.com/product/67543.html)】。
- **价格对照（社区）**：25 刀官方约 ¥180，闲鱼代充 ¥95【二手，[百度贴吧 novelai吧](https://tieba.baidu.com/p/9074395396)】；六人拼车约 **45 元/人/月**，但违反服务条款，有封号、车头跑路、排队等风险【二手，[什么值得买](https://post.smzdm.com/p/awwkolkk)】。
- **风险**：官方明确 Anlas 在取消订阅后归零且无法再单独购买【二手转官方，[ChooseAI](https://www.chooseai.net/news/6922/)】；代充/合租违反 ToS。

### 5.3 Civitai —— 人民币路径不存在，只有加密货币与绿站信用卡

【一手，[Buzz 指南](https://education.civitai.com/civitais-guide-to-on-site-currency-buzz-%E2%9A%A1/)、[加密货币购买指南](https://education.civitai.com/civitais-guide-to-purchasing-buzz-with-crypto/)】

- **有 NSFW 的黄色 Buzz 只能加密货币**。支持币种：**BNB、BTC、DOGE、ETH、LTC、PYUDS、SHIB、SOL、TRX、USDC、USDT**；推荐 USDC on Base（gas 最省）。Civitai 自身不收额外手续费。
- **信用卡/借记卡只能买绿色 Buzz**（仅 SFW），且只在 **civitai.green** 上；主站 `civitai.com` 自 2025-05 起因 Visa/Mastercard/PayPal 对托管成人 UGC 的限制已下线信用卡直购。
- **BuyBuzz.io** 提供一次性 Buzz 礼品卡（10,000 / 25,000 / 50,000 Buzz）与 3/6/12 个月会员，**支持 PayPal 和 Venmo**（部分地区不可用）【一手，[公告](https://civitai.com/articles/16798)】。
- 会员只在 Civitai.green 提供：Bronze $10/月（10,000 Buzz、5% 折扣）、Silver $25/月（25,000、10%）、Gold $50/月（50,000、20%）【二手，[Somake 评测](https://www.somake.ai/zh_CN/blog/civitai-review)】。
- 汇率：**1,000 Buzz ≈ $1.00 USD**【一手，[文章](https://civitai.com/articles/33522/the-ultimate-guide-to-earning-for-free-and-buying-yellow-buzz-on-civitai)】。
- 国内可用性推断：若能通过第三方（淘宝/闲鱼）买到加密货币或用代充账户，才可能用人民币；**官方通道无人民币入口**。

### 5.4 Shakker AI（LiblibAI 海外版）

- 官方购买页说明支付由 **Stripe** 处理，支持 Visa / Mastercard / American Express / Discover / Diner's Club 及 Apple Pay / Google Pay；**明确不支持 PayPal、电汇和其他支付方式**；结算时显示所在地可用方式【一手，[Shakker Membership](https://www.shakker.ai/zh-TW/purchase)】。
- NGA 用户评价：Shakker **「可以一定程度上免费 GHS」**【二手，[NGA](https://nga.178.com/read.php?tid=43606229)】。
- 淘宝有「shakker ai 会员订阅 在线 Stable Diffusion 出图」代购【二手，[淘宝](https://www.taobao.com/list/item/808033129186.htm)】。

### 5.5 TensorHub（Tensor.Art 的 NSFW 姊妹站）

- 2025-11-27 起 Tensor.Art 主站转为**纯 SFW**：Workspace 屏蔽 NSFW 提示词，NSFW 判定图自动打码，**被屏蔽的生成所消耗的 credit 不退还**（有实测者称在 prompt 阶段就被拦、未扣费）【一手转述，[goongen](https://goongen.ai/blog/tensor-art-nsfw-policy)、[日文实测](https://tech.eroiai.com/tensorart-eroi-illust/)】。
- 官方给出的原因是**信用卡组织与监管机构的强制性要求**。
- NSFW 迁移至 `tensorhub.art`，同账号体系、内容双向同步；**Token 计费（高于 Credit），无每日免费额度、无任务奖励**；曾提供一次性 credit→token 转换（2:1）【一手转述，同上；二手，[Toolin](https://toolin.ai/tools/tensorhub-art)】。
- 实测：**月额 Pro $29.90**（每日 300 credits + 永续 1,000 奖励 credits）；单张消耗 0.80 credits；Model 可选 Illustrious 系；`nude`、`nipple`、`pussy` 等词可直接写，无需改写【二手实测，[tech.eroiai.com](https://tech.eroiai.com/tensorart-eroi-illust/)，2026-07-29】。
- 绝对禁止：涉及未成年人的性内容、名人/celebrity、针对真实个人的侮辱性/色情内容。
- 支付方式：检索到的日文实测提到购买页有国家/地区选择；**未检索到支付宝支持**。

### 5.6 Atlas Cloud —— 有「无审查」专区，但只接受国际支付

- 站点有专门的分类页：`https://www.atlascloud.ai/zh/models/explore/uncensored`（「NSFW AI 视频生成 — 无审查模型、无内容过滤、API 接入」）。
- 定价示例：GPT Image 2 $0.009/张；GPT Image 1.5 $0.008/张（-15% 后）；Nano Banana 2 $0.080/张（另有 $0.040 开发者档）；Qwen Image 2.0 $0.028/张；Wan-2.7 图像 $0.030/张、视频 $0.100/秒；Seedance 2.0 约 $0.112/秒。
- **支付**：官方 Q&A 明确说明走「国际按需付费 / 普通国际入驻流程 / 控制台结账」，**不需要支付宝或微信**；其定位恰恰是给中国境外用户解决中国模型 API 的支付摩擦【一手，[Atlas Cloud 问答页](https://ask.atlascloud.ai/zh/pay-chinese-ai-apis-no-alipay-wechat)、[主站](https://www.atlascloud.ai/zh)】。
→ 反向说明：Atlas Cloud 不是国内支付方案。

### 5.7 nanobananapro.hk（**证据薄弱，仅作记录**）

- 该站自称「面向亚太创作者与企业」，声称「订阅支持微信支付、支付宝，无需海外信用卡即可开通」【一手站点自述，[nanobananapro.hk](https://nanobananapro.hk/zh-cn/)】。
- **该站点为套壳产品，域名与主体存疑（联系邮箱 `nanobanana@limaxai.com`），未找到任何第三方独立验证，不建议作为技术依赖。**

---

## 6. 免费额度 / 羊毛 / 首单优惠 汇总

### 6.1 官方免费额度总表

| 平台 | 免费额度 | 有效期/规则 | 出处 |
|---|---|---|---|
| 阿里云百炼 | 各模型独立额度；wanx-v1 500 张（官方页）/ wan2.6-t2i 50 张（社区文章） | 90 天；开通自动发放；仅特定地域 | [官方](https://help.aliyun.com/zh/model-studio/new-free-quota) |
| 腾讯云大模型图像创作引擎 | 一次性免费资源包，如图像风格化（图生图）**50 次** | 1 年；耗尽不自动转后付费 | [官方](https://intl.cloud.tencent.com/zh/document/product/1238/63497) |
| 腾讯云 TokenHub 新人包 | 视频生成 50 积分；混元生 3D 100 积分；语言/多模态各 100 万 tokens | 活动截至 2026-12-31；每账号每模型限领一次 | [官方](https://cloud.tencent.cn/document/product/1823/130053) |
| 火山引擎即梦 API | 开通选「免费试用」**200 次体验额度**，并发 1 | — | [二手转官方](https://www.chooseai.net/news/6540/) |
| 百度智能云 | 各 API 有免费额度，用完即报错 | — | [官方](https://cloud.baidu.com/doc/NLP/s/rla2bfacx) |
| 智谱 | `CogView-3-Flash` **免费（¥0）**；CogView-4 首次送体验额度 | — | [TheRouter](https://therouter.ai/zh/models/zhipu--cogview-4/) |
| **模力方舟 Gitee AI** | **每日 100 次免费 API 调用**；Z-Image-Turbo 每日免费 100 张 2K | 登录即得 | [官方站点](https://ai.gitee.com) + [二手](https://blog.csdn.net/aosky/article/details/155577662) |
| 硅基流动 | 注册送 ¥14；**Kwai-Kolors 文生图免费**；9B 以下模型永久免费 | — | [官方定价](https://www.siliconflow.com/zh/pricing) + [二手](https://zone.ci/secarticles/wx/573191.html) |
| LiblibAI | 免费用户登录每日 **20 积分**，云端存储 3GB；星流新用户注册绑手机号得 100 点 + 每日 100 点；**API 免费计划注册送 7 天 500 积分** | 订阅积分每 31 天重置 | [官方](https://www.liblib.art/viphome) + [二手](https://www.xmsumi.com/detail/1406) |
| 吐司 TusiArt | 社区端每日免费算力（数额官方未公布）；新用户注册送免费生图额度；签到/分享/邀请好友加额度 | — | [官方](https://tusi.cn/) + [二手](https://baipiaoji.com/tools/tusiart) |
| 海艺 SeaArt | 每日体力 130~150（当日清零）；新用户注册送额度（有来源称送 300 积分≈100 张 + 每日签到 20 积分） | 体力日清；算力可累积 | [官方](https://www.seaart.ai/zhCN/mall) + [二手](https://www.flowpixai.com/tutorials/ai-painting-free-help-guide.html) |
| 触手 AI | 基础功能免费（每日有限次数，最高 1080P） | 每日重置 | [二手](https://www.aitoollab.cn/tools/chuchu-ai/) |
| 无界 AI | 每日赠送额度 | — | [二手](https://diduq.com/) |
| 堆友 | 免费使用基础功能（有水印，可裁） | — | [二手](https://www.171host.com/801939.html) |
| 即梦（C 端网页版） | **每日 60~100 积分**（约 15–20 张）；新用户额外送 100 积分礼包 | 每日零点重置 | [二手](https://www.flowpixai.com/tutorials/how-to-use-ai-painting-free.html) |
| 通义万相（C 端） | 个人用户**每日 50 张**；企业认证后 500 张/天 | 每日重置 | [二手](https://www.flowpixai.com/tutorials/how-to-use-ai-painting-free.html) |
| 文心一格 | 签到得电量；**未实名 50 次/天，实名 100 次/天**（历史曾 200 次/天） | 连续签到电量累加 | [二手](https://www.flowpixai.com/tutorials/how-to-use-ai-painting-free.html) |
| 可灵 | 每日 **66 积分** | 每日重置 | [二手](https://www.dididai.cn/sites/4898.html) → 实为 [aididai](https://www.aididai.cn/sites/4898.html) |
| PixAI | 免费档每日 credits（具体数额官网动态给出） | — | [官方会员文档](https://docs.pixai.art/docs/pricing/membership) |
| NovelAI | 一次性 **30 次图像 + 50 次文本 + 100 次 TTS** | 仅一次，不刷新 | [二手转官方](https://www.chooseai.net/news/6922/) |
| Civitai | 免费浏览/下载模型；站内生成额度以账号为准（蓝 Buzz 靠互动赚取，仅 SFW） | — | [yangmao.ai](https://yangmao.ai/zh/providers/) |
| Tensor.Art（主站，仅 SFW） | **每日 50 份（SDXL）/ 100 份（SD1.5）credit**，免费版无水印、可商用 | 每日重置 | [二手](https://www.flowpixai.com/tutorials/ai-painting-free-help-guide.html) |
| TensorHub（NSFW） | **无每日免费** | 纯付费 token | [二手](https://tech.eroiai.com/tensorart-eroi-illust/) |
| API易 | 注册即送 **$0.1**（$0.05 可体验 Nano Banana 2） | 无需绑卡 | [官方博客](https://help.apiyi.com/nano-banana-2-free-trial-apiyi-guide.html) |
| 302.AI | 余额不失效、无套餐门槛 | — | [RouterHubs](https://routerhubs.com/relays/302-ai/) |
| 阿里云百炼（活动） | 「按量达标返券，先用后返，最高返 200 元」；AI 产品新用户 7000 万 tokens | — | [二手](https://developer.aliyun.com/article/1733984) |
| 即梦（活动） | 2025-09 新用户限时 3 折 | 限时 | [二手](https://www.aitop100.cn/infomation/details/28908.html) |

### 6.2 首单 / 充值优惠

| 平台 | 优惠 | 出处 |
|---|---|---|
| API易 | 首充普通 +$1、高校/企业 +$2、满 $50 +$5、满 $100 +15%（$50/$100 档需联系客服） | [GitHub umu02720/apiyi](https://github.com/umu02720/apiyi) |
| 钉钉式列举（第三方） | 部分平台提供「单次充值满 $50/$100 加赠」「首月优惠价」 | [HowToken](https://howtok.net/alipay) |
| DMXAPI | 全球模型 7 折（省 30%），主流模型低至 6 折（省 40%）；充值打折、按官方原价计费 | [EggStriker](https://www.eggstriker.com/ai-api/dmxapi) |
| 好Token | 官方价 5 折起；每月 5000 万 Token 专项套餐；超出自动续费 8 折 | [haotk.cn](https://haotk.cn/) |
| 即梦 | 2025-09 限时三折 | [AITOP100](https://www.aitop100.cn/infomation/details/28908.html) |
| 阿里百炼 | 先用后返最高返 200 元券；Qwen3.6 全模型 4.5 折 | [二手](https://developer.aliyun.com/article/1733984) |
| PixAI | Web 端 $1 一次性优惠包（每账号一次）+ 每月特别包 | [官方 FAQ](https://blog.pixai.art/en/payment-faq/) |
| LiblibAI（星流） | 生图算力打五折（2025-10 期间，[量子位](https://www.qbitai.com/2025/10/341697.html) 实测评测提到） | 二手 |
| SeaArt | 首充赠送算力；开宝箱、超值礼包 | [36氪](https://www.36kr.com/p/3552777239313538) |

### 6.3 学生优惠

**检索到的证据非常稀少**：
- API易：「高校/企业用户首充加赠 $2」（比普通用户多 $1）【二手，[GitHub umu02720/apiyi](https://github.com/umu02720/apiyi)】。
- 某中转站「稳明光语纪」（wenming7.cn）自述有「学生专享优惠」【一手站点自述，经 [HowToken 支付宝名单](https://howtok.net/alipay) 索引】。
- **未检索到阿里云、腾讯云、火山引擎、LiblibAI、吐司、海艺等主流国内平台针对学生的公开定价优惠。** 国内学生群体的普遍做法是靠新用户免费额度轮换（见 §6.4）。

### 6.4 社区总结的"多平台轮换"白嫖打法（二手，两篇 FlowPix 教程）

来源：[FlowPix｜怎么使用 AI 绘画免费](https://www.flowpixai.com/tutorials/how-to-use-ai-painting-free.html)、[FlowPix｜AI绘画免费怎么白嫖](https://www.flowpixai.com/tutorials/ai-painting-free-help-guide.html)

作者自述的实操套路：
1. **多平台轮换注册**：手机里同时挂即梦、文心一格、通义万相、Liblib，一家烧光换下一家，一天可出上百张。作者称一天白嫖 150 张以上。
2. **只保留 1 张**：即梦默认一次出 4 张候选，全留就扣 4 份积分。
3. **先用 512×512 低分辨率试提示词方向**，方向对了再上高清，省一半试错额度。
4. **复杂 LoRA 组合先在 Tensor.art 这类免费额度多的平台验证**，确认不翻车再搬到即梦精修。
5. **签到别断**：文心一格连续签到电量会累加，「连签 7 天直接攒够一次 4K 高清」。
6. **家人手机号注册小号**：即梦、文心一格都支持，四口人额度翻四倍（作者注明不要商用）。
7. **任务中心薅币**：通义万相的任务中心（签到、分享、反馈 bug）能攒「万相币」，50 个币换 10 次额外额度。
8. **邀请裂变**：LiblibAI「邀请好友注册双方各加 50 张额度」。

> ⚠️ 该文提到的部分数字与官方口径不一致（如「Liblib 日 100 算力」「即梦每日 66 积分」），属社区实测体验，仅供参考。

### 6.5 免费生图站点目录资源

| 资源 | 内容 |
|---|---|
| [diduq.com](https://diduq.com/) | 「免费 AI 图片 & 视频生成网站清单」，按「完全免费/每日签到/每日积分制」分类，标注每日额度 |
| [yangmao.ai](https://yangmao.ai/zh/providers/) | 追踪 168 家 AI 厂商（160 家有免费额度），含 API 价格与**中国大陆可用性**标注；另有每日更新的 [AI 免费额度数据集](https://yangmao.ai/zh/data/ai-free-tiers/)（JSON/CSV）与 [实时情报站](https://yangmao.ai/zh/intelligence/) |
| [baipiaoji.com](https://baipiaoji.com/) | 「白嫖计」，逐工具核实免费额度并标注核实日期与来源链接 |
| [aifreeplan.com](https://aifreeplan.com/zh) | 「104+ 款 AI 工具免费额度对比」 |
| [ACGFav 二次元 AI 工具导航](https://acgfav.com/ai-acg-tools) | 29 个二次元 AI 站点，站点筛选标准里**明确排除「以盗版下载、成人擦边或高风险内容为主要导向」的站点** |

---

## 7. 审查尺度：可验证的实证与机制

### 7.1 国内平台（可用错误码与官方文案验证）

| 平台 | 拦截表现 | 出处 |
|---|---|---|
| **阿里云百炼** | 返回 `DataInspectionFailed` / `IPInfringementSuspect`；`prompt_extend` 改写会引入版权内容而触发审核 | [官方文档](https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference) |
| **腾讯云混元生图** | `FailedOperation.GenerateImageFailed`（生成图片审核不通过）；`OperationDenied.TextIllegalDetected`（文本违法违规）；`OperationDenied.ImageIllegalDetected`（图片违法违规） | [官方错误码表](https://cloud.tencent.cn/document/api/1668/124632) |
| **智谱** | `user_id` 参数用于「协助平台对终端用户的违规行为、生成违法及不良信息或其他滥用行为进行干预」；水印默认开启，官方称「符合政策要求」 | [API 文档](https://s.apifox.cn/apidoc/docs-site/4012774/270362258e0) |
| **LiblibAI API** | 官方页面两条产品线均标注「**出图含内容审核**」 | [liblib.art/apis](https://www.liblib.art/apis) |
| **LiblibAI 站内** | 2026-04 央视点名；新京报实测：切换为英文提示词后平台直接提示「生成失败」 | [新京报](https://www.bjnews.com.cn/detail/1776173795129845.html) |
| **海艺 SeaArt** | NGA 口径「去年的更新后同样无法 GHS」 | [NGA](https://nga.178.com/read.php?tid=43606229) |
| **国内平台通用** | NGA 教程：「国内平台连擦边（比如露个胖次）都做不到，生成结果都显示不出来」 | 同上 |

**监管背景**（二手，来源为新京报报道的分析段）：国内选择「事前备案 + 事中审核 + 事后追责」全链条治理。2025-04 网信办开展「清朗·整治 AI 技术滥用」专项行动，重点整治利用 AI 制作传播色情低俗内容；2026-04-10 五部门联合公布《人工智能拟人化互动服务管理暂行办法》；2026-01-01 修订后的《网络安全法》施行，首次在法律层面规定 AI 安全风险的法律责任框架【[新京报](https://www.bjnews.com.cn/detail/1776173795129845.html)】。

### 7.2 海外平台的审查机制

- **OpenAI gpt-image-2**：两阶段过滤——先用神经多分类器扫 prompt 文本与参考图，出图后再扫一遍生成图；API 拒绝文案 `code: "moderation_blocked"` / `Your request was rejected by the safety system`；账号有资格时可传 `moderation: "low"` 放松出图后阈值【二手，[AI 工具指南](https://aitoolsguidebook.com/zh/articles/ai-generation-output-blocked-safety/)；一手佐证见 [API易 gpt-image-2 文档](https://docs.apiyi.com/api-capabilities/gpt-image-2/overview) 的 `moderation: low` 说明】。
- **Gemini / Nano Banana**：prompt 与输出双重过滤；中文 prompt 过审比英文严；可用 `safety_settings` 调到 `BLOCK_ONLY_HIGH`，极端情况 `BLOCK_NONE`（需账号权限）【二手，[SegmentFault](https://segmentfault.com/a/1190000047908650)】。
- **Midjourney**：明确 PG-13，禁 NSFW；把试图绕过审核视为可封号行为；被拦的敏感词会影响后续分离放大、重绘、扩图等操作【二手，[山鲸 AI 敏感词说明](https://docs.2sj.ai/midjourney/nono)、[AI 工具指南](https://aitoolsguidebook.com/zh/articles/ai-generation-output-blocked-safety/)】。
- **Civitai**：有「静默封禁」现象——CHIBI（Q 版儿童画风）等提示词的作品被「绿色放逐」，图能上传但不出现在公开信息流，即使是开启了成人内容显示的账号也看不到；系统既不看评级也不单看 NSFW，而是上传阶段对画面做 AI 扫描判定【二手，[MangaFlow](https://mangaflowai.com/news/civitai-chibi-silent-ban)】。
- **Tensor.Art 主站**：2025-11-27 起完全 SFW；**被屏蔽生成消耗的 credit 不退还**【二手，[goongen](https://goongen.ai/blog/tensor-art-nsfw-policy)】。
- **DeepSeek/OpenRouter 类**：检索到 OpenRouter 曾因内容违规大规模封号【二手，[非线智能博客](https://blogs.nonelinear.com/blog/openrouter-ai-api-aggregator-platform-a9d2497e5c27)，属厂商软文】。

### 7.3 一致的结论

1. **审查尺度与支付可达性呈负相关**：国内可直付的平台审查最严；审查最松的平台（Civitai 主站、Atlas Cloud uncensored 区、NovelAI、Shakker）都需要加密货币、代充或国际卡。
2. **两个例外的重叠点**：**PixAI**（支付宝/微信 + 二次元 + 免费 NSFW，社区口径）与 **TensorHub**（Illustrious 系 + 直白 NSFW 提示词，但无支付宝、需国际卡或代充）。
3. **中转站并不等于"绕开审核"**：调 gpt-image-2 仍走 OpenAI 审核（API易文档明示 403 内容审核拦截）；调 Gemini 走 Google 审核。中转站只解决支付与网络，不解决审查。

---

## 8. 国内二次元生图实践者实际在用什么

### 8.1 NGA 二次元版在线平台教程（2026-01 更新）

来源：[NGA 178](https://nga.178.com/read.php?tid=43606229)【二手，原作者自述纯手打，非商业推广】

核心事实摘录：
- **国内平台够用**：「如果你的目的只是生成点角色美图或者磕点 CP，国内 AI 生成平台（如 LiblibAI）已经能满足你的需求。」
- **GHS 必须翻墙**：「但如果你想试试在线 GHS，几乎必须要魔法上网……不翻出去的话国内平台连擦边（比如露个胖次）都做不到，生成结果都显示不出来。」
- **Civitai（C 站）**：全球最大的 AI 绘画开源社区，所有开源模型基本都在上面，**需要翻出去才能用**；「C 站在 2025 年某次更新后，已经没法免费白嫖 NSFW（GHS）的图片了，想生成任何带稍微露一点的服装（包括比基尼、内衣），或者更进一步，都需要使用付费货币（黄色的 BUZZ）」；单张平均消耗 6 点 Buzz。
- **唯一还能免费 NSFW 的大站**：「目前所有在线网站中，唯一还支持免费 NSFW/GHS 的[大型]网站只剩下一个小日子的 PixAI」。
- **Shakker AI**：「LibLibAI 的海外版本，可以一定程度上免费 GHS」。
- **SeaArt**：「去年的更新后同样无法 GHS 了。而且非常喜欢跳脸弹出促销广告……用户体验巨烂。顺带一提，盗模型的速度冠绝所有网站」。
- **推荐底模**：WAI-illustrious-SDXL（v16，2026-01 时），「全 C 站最受欢迎的模型，上手非常简单，GHS 能力非常强悍」；作者个人最喜欢 Cat Tower。
- **推荐参数（Illustrious/光辉系）**：正向 `masterpiece,best quality,amazing quality,1girl,...`；负向 `bad quality,worst quality,worst detail,sketch,censor`；所有光辉系模型自带 VAE，可跳过 VAE 选择。
- **国内可用的提示词汉化工具**：`https://tags.novelai.dev/`（全中文且国内可用，一键中文转英文 tag；角色名与画师名无法汉化，只能英文）。
- **图源 tag 库**：Danbooru wiki（需翻墙），「真·万物起源」。
- 作者也提到有绕过 C 站审核继续用免费蓝 Buzz 的机制，但**貌似只能图生图**。

### 8.2 NGA 二次元生成技术演进讨论帖（2026-02）

来源：[NGA 论坛帖](https://ngabbs.com/read.php?tid=46264308)【二手，社区观点】

- **主流观点**：在「无限制 NSFW + 二次元」两个限定词下，**NovelAI（nai4.5）仍是无敌的**；「比他强的要么不是二次元专精，要么不能色色」。
- 但批评点也明确：**NAI 的角色更新慢**（闭源），「一个题材大火（比如超时空辉夜姬），这时候全靠开源模型来生成对应人物」；本地开源模型在角色新鲜度上胜出。
- **SDXL 仍是二次元社区主力**：光辉（Illustrious）、NoobAI、Pony 是三大系；「重口/欧美风用 Pony，纯正日系/插画用光辉」的双雄格局。
- **Anima**（2B 参数二次元专用模型，CircleStone Labs × Comfy Org）：有帖子称「目前只有预览版，正式版应该会更加好」。
- **画师串（artist tag 串）**仍是风格控制的关键：「现在主流的云端模型画风多样性是一坨，你得先用能吃画师串的模型把风格先定下来才行（比如 nai）」，但作者也坦言「这是妥妥的侵权行为」。
- 对视频的判断：「二次元生图基本不动了，3、5s 的图生视频已经把一般制作水平的动画爆了」。

### 8.3 NGA 二次元模型发展史梳理帖（2026 由用户让 Gemini 生成的梳理）

来源：[NGA](https://bbs.nga.cn/read.php?tid=45666361)【二手，AI 生成内容，社区转载】

时间线要点：
- 2022.10 NovelAI 泄漏（Naifu）→ 启蒙期
- 2022.11–2023.02 Anything V3 / AOM / Counterfeit → SD1.5 融合模型爆发
- 2023.02–2023.06 LoRA + ControlNet（Kohya_ss、A1111）→ 工具化
- 2023.07–2024.01 ComfyUI + AnimateDiff → 流程化
- 2024.01–2024.06 **Pony Diffusion V6 XL** → SDXL 统治二次元，Score 标签体系流行；「2024 年 Pony 及其衍生模型几乎垄断了 Civitai 的二次元榜单，特别是在 NSFW 和 Furry 社区拥有绝对统治力」
- 2024.07–2024.12 **光辉（Illustrious XL）/ NoobAI** → 回归纯正日系画风
- 2024.08–2025 **Flux.1 / Qwen-Image** → DiT 架构与 VLM 引入，实现文字生成与中文原生创作

### 8.4 本地部署路线（国内实践者的另一条主路）

- **硬件门槛已降**：2026 年 RTX 4060（8GB）即可流畅跑 SDXL 和 Flux；6GB 显卡也能跑中等分辨率【二手，[提效录](https://www.tixiaolu.com/v2/posts/v2-340bf818.html)】。
- **Nunchaku（4-bit 量化推理）**：Z-image-Nunchaku 整合包声称 4G 显存即可流畅运行，实测 1024×1024 生成仅需 **8.24 秒**，支持 LoRA 插件【二手，[腾讯云开发者社区](https://cloud.tencent.com/developer/article/2690604)】。
- **ComfyUI + 秋叶整合包**是国内主流工作流；也有观点认为「现在你在 kimi 的指导下都能自行搭建 comfyui 工作流，不需要下什么整合包」【二手，[NGA](https://ngabbs.com/read.php?tid=46264308)】。
- **模型获取**：Civitai 仍是模型中心，但国内访问不稳；LiblibAI / 吐司是"国产平替"，`00011000` 等第三方评价「Civitai 是国内 SD 模型社区的国际标准……哩布哩布是针对国内用户的替代，访问稳定，**内容经过审核**，使用无障碍」【二手，[00011000](https://00011000.com/tools/liblib%E5%93%A9%E5%B8%83%E5%93%A9%E5%B8%83)】。

### 8.5 二次元平台横向对比（二手，多来源）

| 来源 | 结论 |
|---|---|
| [171host](https://www.171host.com/801939.html) | 纯体验/尝试 → 通义万相、文心一格；学习 AI 绘画 → LiblibAI、海艺；二次元创作 → **触手 AI 首选，LiblibAI 备选**；国风 → 文心一格；专业创作 → LiblibAI + 云端 GPU 跑 SD |
| [ai138](https://www.ai138.com/pk/liblib-vs-xingliu) | LiblibAI 是社区型（模型分享+训练），星流 AI 是自研模型一站式平台（侧重电商设计、提供 API）；LiblibAI 免费版每日约 300 张（此数字与其他来源矛盾）、基础版 VIP 35 元/月、专业版 70 元/月 |
| [知乎·二次元ai绘画工具怎么选](https://zhuanlan.zhihu.com/p/2015833168192766332) | 「有技术基础选 SD，追求顶级画质选 MJ，纯二次元专精选吐司/LibLib，零基础或需要图视频一体化选海艺」 |
| [FlowPix](https://www.flowpixai.com/tutorials/how-to-use-ai-painting-free.html) | 零基础白嫖首推即梦；二次元党选 Tensor.art 或 Liblib；概念图/写实选 Leonardo；国产兜底文心一格；通义万相补位 |
| [tusi.cn 站内](https://tusi.cn/) | 热门二次元模型：二次元日系笔触感厚涂、Qwen 二次元|平涂线条风、超精细漫画、krea/Krea-2-Turbo 二次元光污染、月老板-illustrious_NSFW 二次元风格-IL |

### 8.6 转述型/低可信来源（单独标注，不建议采信）

以下内容带有明显 AI 生成或 SEO 痕迹，仅作现象记录：
- [非线智能博客](https://blogs.nonelinear.com.cn/)（nonelinear.com.cn）：多篇「为什么选非线智能」式软文，含「高并发二次元生图 API」「漫剧角色多视角生图 api」等标题，每篇都导向自家产品。
- [wwhsipser.com](https://wwhsipser.com/)：多篇「1000 张图 AI 生成多少钱」「AI 中转站对比」文章，最终结论均导向「块乐 Encore（stillhappy.cn）」。
- [capital-peak.com](https://www.capital-peak.com/news/6359)、[segmentfault 星链4SAPI 文](https://segmentfault.com/a/1190000048052335)：内容结构与结论高度相似，均导向「星链4SAPI」，属同一模式的推广文。
- [jxysys.com](https://jxysys.com/post/20903.html)：Seedance 2.0 审核分析，含大量看似具体的表格，但无法与官方文档核对。

---

## 9. 支付工具与代充渠道（人民币→外币）

| 工具/平台 | 机制 | 费用 | 出处 |
|---|---|---|---|
| **WildCard（野卡）** | 美国虚拟借记卡；支付宝/微信充值；无需 KYC（未实名月限 $100，实名 $3000）；支持 ChatGPT/Claude/Midjourney/Adobe 等 | 开卡 $11.99/年 或 $16.99/2 年；充值手续费 **3.5%**；退款收 2% | 【二手，[野卡说明](https://yeka.xlog.app/vcc-2025?locale=zh)】 |
| **HUTAO 虚拟卡** | 支持 Visa/Mastercard/支付宝充值 | 未查证 | 【二手，[普画网](http://www.puhuajia.com/article-1774-1.html)，该文为软文】 |
| **aipaycards.com** | USDT 固定地址入账；支付宝/微信走人工充值审核 | 未查证 | 【一手站点自述，[aipaycards](https://aipaycards.com/)】 |
| **PAYPRM（payprm.com）** | 代订海外 AI 会员（ChatGPT Plus/Pro、Claude、Gemini、Grok）；「全程无需提供账号密码，仅凭会话信息即可完成充值，充值完成后凭证即时作废」；累计服务 5.7 万用户 | 未查证 | 【一手站点自述，[PAYPRM](https://www.payprm.com/about)】 |
| **2233.ai** | 平台内开通 ChatGPT Plus 等，按天付费 | ¥10/天 | 【二手，[Wildcardhub](https://wildcardhub.com/blog_posts/virtual-card-alternatives.html)，该文为 2233.ai 推广文】 |
| **账号星球（accountboy.com）** | 买卖成品号/共享号 | NovelAI Opus 3 人共享 ¥79、5 人共享 ¥49 | 【一手站点，[账号星球](https://www.accountboy.com/zh-cn-cny/buy-NovelAI)】 |
| **Speed4Card** | 人工代购海外订阅 | NovelAI Opus 代购 $40.20 | 【一手站点，[Speed4Card](https://www.speed4card.com/product/67543.html)】 |
| **buy.ai-mj.cn（AI Draw）** | Midjourney/Banana/GPT-Image 2/Seedance/Kling 的账号与积分自动发货；「免魔法免科学，免封号免换号」 | MJ 独享账号 ¥231.39（30 美金档）～¥845.08（120 美金档）；绘图账号 150 积分/标准月号 ¥25.16 | 【一手站点，[buy.ai-mj.cn](https://buy.ai-mj.cn/)】 |
| **淘宝/闲鱼** | NovelAI、SeaArt、Midjourney、Shakker 代充与成品号 | NovelAI 25 刀 ¥55–95；SeaArt ¥15 起 | 见 §5.2、§3.3 |

**风险**（二手）：账号共享、合租、低价代充普遍违反原平台 ToS，存在封号、二验、地区限制、车位回收风险；建议优先选有 ICP 备案、运营时间长、售后公开的平台，先月付测试 1–2 个周期【[jerrykik 订阅攻略站](https://jerrykik.github.io/ai-subscribe-guide/categories/%E5%90%88%E7%A7%9F)】。另有大量「GPT 代充」诈骗/骗局报道【[知乎避坑指南](https://zhuanlan.zhihu.com/p/2031659472360358489)、[什么值得买](https://post.smzdm.com/p/a5rgd26k)】。

---

## 10. 信息缺口与未验证项（诚实标注）

以下项目在本次检索中**未能取得可靠证据**，使用前需自行核实：

1. **LiblibAI API 的官方积分单价**：`liblib.art/apis` 页面为 JS 渲染，`degoog-cli scrape` 返回 "no extractable content"；官方计费规则页（`liblib.art/calculation`）需登录。目前仅有二手来源的「￥10/1000 积分」与「0.15 元/次」两种说法。
2. **吐司 TusiArt API 的官方定价页**：`tusiart.com/apis` 返回 404；仅有第三方（白嫖计）转述的「算力单价 0.01 元/点」。
3. **触手 AI、无界 AI、堆友、商汤秒画、阶跃星辰、MiniMax 的公开生图 API 定价与文档**：均未检索到公开页面。
4. **PixAI 是否在所有地区都提供支付宝/微信**：官方指南列为支持，但较早的 FAQ 未列；建议在结算页实测。
5. **NovelAI / Yodayo / Lewdly / Diffus / Shakker 的具体支付页面**：Diffus 定价页未披露支付方式；Shakker 购买页 `degoog-cli scrape` 返回 HTTP 500；Yodayo 与 Lewdly 未查证。
6. **国内是否有任何"人民币可直付 + 无审查"的生图 API**：本次检索**未找到任何证据支持存在此类合规服务**。可人民币直付的要么是国内合规平台（有审核），要么是灰产/黑产渠道（9.9 元永久账号、48 元大尺度提示词教程等，见 [新京报](https://www.bjnews.com.cn/detail/1776173795129845.html)），后者存在法律风险。
7. **火山引擎豆包 Seedream 走火山方舟的官方定价页**：本次未取得一手页面，仅有 API易/数眼智能等网关的转述价格。
8. **中转站的真实稳定性和"是否掺水"**：无法在没有实际压测的情况下验证；第三方对比文章多为平台自述软文。
9. **Anima 模型（2B 二次元专用）的正式版状态与可用平台**：仅有社区帖提到预览版。
10. **即梦 API 免费额度 200 次是否仍有效**：该数字来自 2026-09 的第三方教程，未在火山引擎官方文档中直接验证。

---

## 11. 来源索引（按主题）

**国内大厂官方文档**
- 阿里云百炼文生图 API：[text-to-image-api-reference](https://help.aliyun.com/zh/model-studio/text-to-image-api-reference)｜[V2 版](https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference)｜[万相 2.7](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference)｜[图片生成与编辑模型列表](https://help.aliyun.com/zh/model-studio/image-model/)｜[图像 API 常见问题](https://help.aliyun.com/zh/model-studio/image-faq)｜[新人免费额度](https://help.aliyun.com/zh/model-studio/new-free-quota)
- 腾讯云混元：[产品页](https://cloud.tencent.com.cn/product/aiart)｜[计费概述](https://cloud.tencent.cn/document/product/1668/90896)｜[提交混元生图 3.0 任务](https://cloud.tencent.cn/document/api/1668/124632)｜[文生图轻量版](https://cloud.tencent.com/document/product/1729/108738)｜[免费额度](https://intl.cloud.tencent.com/zh/document/product/1238/63497)｜[TokenHub 新人免费体验包](https://cloud.tencent.cn/document/product/1823/130053)
- 火山引擎即梦：[即梦图片生成 4.0](https://www.volcengine.com/docs/85621/1817044)｜[快速入门](https://www.volcengine.com/docs/85621/1995636?lang=zh)
- 百度智能云：[产品价格](https://cloud.baidu.com/doc/NLP/s/rla2bfacx)
- 智谱：[CogView-4 文档](https://docs.bigmodel.cn/cn/guide/models/image-generation/cogview-4)｜[图片生成 API 定义](https://s.apifox.cn/apidoc/docs-site/4012774/270362258e0)
- 模力方舟 Gitee AI：[主站](https://ai.gitee.com)｜[文生图文档](https://ai.gitee.com/docs/products/apis/images-vision/text2image)
- 硅基流动：[定价](https://www.siliconflow.com/zh/pricing)｜[图片生成文档](https://docs.siliconflow.cn/cn/userguide/capabilities/images)

**国内平台/社区官方页**
- LiblibAI：[API 开放平台](https://www.liblib.art/apis)｜[会员页](https://www.liblib.art/viphome)｜[积分明细](https://www.liblib.art/calculation)
- 吐司：[tusi.cn](https://tusi.cn/)
- 海艺：[SeaArt 商城（简）](https://www.seaart.ai/zhCN/mall)｜[haiyi.art](https://www.haiyi.art)｜[SeaCloud API 文档](https://cloud.seaart.ai/docs/zh-hans/api-reference/model-api/minimax/hailuo-2-3-fast-i2v)
- 触手 AI 与无界 AI：无官方 API 页

**海外站官方**
- PixAI：[支付方式指南](https://blog.pixai.art/en/the-complete-guide-to-pixai-payment-methods/)｜[Payment FAQ](https://blog.pixai.art/en/payment-faq/)｜[会员文档](https://docs.pixai.art/docs/pricing/membership)｜[Create image API](https://platform.pixai.art/en/docs/api-v2/image/createImage)
- NovelAI：[订阅文档](https://docs.novelai.net/en/subscription/)｜[API 文档](https://api.novelai.net/docs)
- Civitai：[Buzz 指南](https://education.civitai.com/civitais-guide-to-on-site-currency-buzz-%E2%9A%A1/)｜[加密货币购买指南](https://education.civitai.com/civitais-guide-to-purchasing-buzz-with-crypto/)｜[BuyBuzz.io 公告](https://civitai.com/articles/16798)｜[Yellow Buzz 终极指南](https://civitai.com/articles/33522/the-ultimate-guide-to-earning-for-free-and-buying-yellow-buzz-on-civitai)
- Shakker：[Membership](https://www.shakker.ai/zh-TW/purchase)
- TensorHub：见 [goongen 政策追踪](https://goongen.ai/blog/tensor-art-nsfw-policy)
- Atlas Cloud：[uncensored 专区](https://www.atlascloud.ai/zh/models/explore/uncensored)｜[支付问答](https://ask.atlascloud.ai/zh/pay-chinese-ai-apis-no-alipay-wechat)

**中转/聚合平台官方文档**
- API易：[图像与视频模型](https://apiyillc.mintlify.app/api-capabilities/image-video-models)｜[gpt-image-2](https://docs.apiyi.com/api-capabilities/gpt-image-2/overview)｜[Seedream](https://docs.apiyi.com/api-capabilities/seedream-image/overview)｜[Nano Banana 2 免费体验](https://help.apiyi.com/nano-banana-2-free-trial-apiyi-guide.html)
- 302.AI：[图片生成 API](https://doc.302.ai/337661604e0)
- AiHubMix：[模型管理 API](https://aihubmix.mintlify.app/cn/api/Models-API)｜[模型与定价](https://aihubmix.com/models?lang=zh-TW)
- APIMart：[Midjourney API](https://apimart.ai/zh/model/midjourney)｜[wan2.7 图像](https://docs.apimart.ai/cn/api-reference/images/wan2.7-image/generation)
- Router One：[生图 API](https://router.one/zh/image-generation-api)
- island AI Coding：[定价](https://www.codex789.com/pricing/)
- 好Token：[haotk.cn](https://haotk.cn/)

**社区与第三方**
- NGA：[在线生成平台教程](https://nga.178.com/read.php?tid=43606229)｜[二次元生成技术讨论](https://ngabbs.com/read.php?tid=46264308)｜[发展史梳理](https://bbs.nga.cn/read.php?tid=45666361)
- 新京报：[哩布哩布涉黄实测](https://www.bjnews.com.cn/detail/1776173795129845.html)
- 中新网：[AI 中转站整治风暴](https://www.chinanews.com.cn/cj/2026/06-22/10644787.shtml)
- 量子位：[LiblibAI 2.0 实测](https://www.qbitai.com/2025/10/341697.html)
- 36氪：[SeaArt 增长报道](https://www.36kr.com/p/3552777239313538)
- FlowPix：[免费白嫖攻略](https://www.flowpixai.com/tutorials/how-to-use-ai-painting-free.html)｜[七条免费出图渠道](https://www.flowpixai.com/tutorials/ai-painting-free-help-guide.html)
- yangmao.ai：[厂商目录](https://yangmao.ai/zh/providers/)｜[免费额度数据集](https://yangmao.ai/zh/data/ai-free-tiers/)｜[实时情报站](https://yangmao.ai/zh/intelligence/)
- 白嫖计：[吐司 AI](https://baipiaoji.com/tools/tusiart)
- HowToken：[支持支付宝的中转站（192 家）](https://howtok.net/alipay)
- ComputeUnion：[国内中转站价格对比](https://www.computeunion.net/zh/api-pricing/cn-relay)
- RouterHubs：[302.AI 评测](https://routerhubs.com/relays/302-ai/)
- DexBlog：[国产生图大模型 API 对比](https://www.mxphp.com/post/api)
- zeeklog：[8 家中转商价格对比](https://zeeklog.com/2026nian-zui-zhi-de-guan-zhu-de-6ge-aixin-mo-xing-guo-nei-zhong-zhuan-apijie-ge-quan-mian-dui-bi)
- 苏米客：[3 个国产免费 AI 生图大模型 API 教程](https://www.xmsumi.com/detail/1406)
- 什么值得买：[NovelAI 4 类花钱路线](https://post.smzdm.com/p/awwkolkk)
