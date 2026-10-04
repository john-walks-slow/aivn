# 二次元生图 API 十家候选 — 付款通道 / API 开放度 / 免费额度 / 尺度 逐家核实

- 日期：2026-10-04
- 核实对象：ModelsLab、Civitai、Replicate、Runware、Together AI、Shakker AI、TensorHub、NovelAI、Venice AI、RunPod/Modal
- 与前两份的关系：`261004-anime-image-api.research.md`（方向：全球无审查 × 全参数）与 `261004-anime-image-api-cn.research.md`（方向：国内支付可达性）已扫过这些平台的模型与参数面。**本份不复述前者已核实的参数清单，只做三件事**：① 逐家核实真实付款通道；② 核实 API 的真实开放程度与拿 key 的成本；③ 核实免费额度与"二次元 / NSFW 实际尺度"，并对前两份中经核实有出入的条目做更正（见 §6）。
- 一手性标注：`【一手】` = 本轮直接抓取的官方页面 / 官方文档原文；`【官方转述】` = 官方文档的二手摘要；`【二手】` = 第三方评测 / 聚合站；`【未能核实】` = 本轮拿不到证据。
- 本机对 Cloudflare 挑战页（tensorhub.art）与需登录页（civitai.com/purchase/*）做了 camoufox 实测，未能登录的页面如实标注。

---

## 1. 结论速览

### 1.1 只拿 Visa（无加密货币、无海外实体卡）时的可付款性

| 平台 | Visa/银联可否直接付 | 最低起步成本 | 备注 |
|---|---|---|---|
| **ModelsLab** | ✅ Stripe 卡付（含无头 tokenization） | **$21/月**（无免费额度） | 甚至可用 Agent 全自动开户+订阅，无需浏览器 |
| **Replicate** | ✅ 卡付预付费 credit | **$15 起充**（auto-reload 最低额） | 官方另留"Try for Free"有限免费次数 |
| **Runware** | ✅ Stripe 卡付，**ToS 明确列 UnionPay** | **$20 起充** | 企业邮箱注册送 $2 |
| **Together AI** | ✅ Visa/MC/Amex 信用/借记卡 | **$5 起充** | **明确不支持预付卡与虚拟卡** |
| **Venice AI** | ✅ Dashboard 内 Stripe 卡付 | 需先订 Pro **$18/月** 才可拿 API key | 另有全无账号的 x402 USDC 通道（$5 起） |
| **NovelAI** | ✅ Chargebee 收单（卡/PayPal，官方未列品牌） | **$10/月**（Tablet） | 未订阅调 API 返回 402 |
| **RunPod** | ✅ Stripe 卡付（Visa/MC/Amex 等） | **$10 起充**；起 Pod 需 ≥1 小时算力余额 | 预付卡建议单笔 ≥$100；有风控连拒封 24h |
| **Modal** | ✅（Stripe 托管支付页） | **$0**（Starter 含 $30/月免费算力） | 官方称"必须先绑支付方式"，与第三方口径冲突 |
| **Civitai** | ⚠️ **只能买到 Green Buzz（SFW）**，黄 Buzz 必须加密货币 | 会员 $10/月起（得 Green Buzz） | 域名已重组：civitai.green→civitai.com，unrestricted→civitai.red |
| **Shakker AI** | ✅ Stripe 卡付（Visa/MC/Amex/Discover/Diners + Apple/Google Pay） | 免费档 200 token/天（二手）；订阅 £10/月起 | **不支持 PayPal/电汇**；**未找到官方 API** |
| **TensorHub** | **【未能核实】**，公开页无支付说明，需登录 | 无免费额度 | 与 Tensor.Art 同账号；Token 计费高于 credit |

### 1.2 API 真实开放度

| 平台 | 有公开 API | 拿 key 方式 | 文档完整度 | 认证复杂度 |
|---|---|---|---|---|
| ModelsLab | ✅ | 控制台 或 **Agent 全自动开户**（`/auth/signup`→`/billing/payment-link`→`/subscriptions`→`/api-keys`） | 极高（`llms.txt` 全量、分端点） | Bearer，极简 |
| Civitai Orchestration | ✅ | civitai.com 账号 → API token | 高（含 OpenAPI、JSON Schema、examples） | Bearer |
| Replicate | ✅ | 账号 → API token（`r8_` 前缀） | 高（逐模型 schema，社区模型 schema 由作者定） | `Authorization: Token`/Bearer，极简 |
| Runware | ✅ | 控制台建 key（可分项目/可撤销/可团队共享） | 极高（**模型 index/schema/examples 三个 JSON 端点全量开放，含 `x-pricing`**） | REST 首元素 auth 或 Bearer；另有 WebSocket |
| Together AI | ✅ | 账号 → key | 高 | Bearer（OpenAI 兼容） |
| NovelAI | ✅（官方文档存在） | **只能向用户索取其 Persistent API Token**，无开发者 key 发放体系 | 中（生成文档在独立子域） | Bearer(JWT)，但**未订阅=402** |
| Venice AI | ✅ | 需先买 Pro，再在 settings/api 建 key（INFERENCE / ADMIN 两类） | 高（OpenAPI YAML + 全量 mdx 可下载） | Bearer 或 x402 钱包签名 |
| RunPod | ✅（ComfyUI serverless worker + 官方模板） | 控制台建 endpoint | 高 | Bearer |
| Modal | ✅（Python SDK / 容器） | CLI `modal setup` | 高 | 无 HTTP key 体系，SDK 部署 |
| Shakker | ❌ **未找到任何官方 API 文档** | — | — | — |
| TensorHub | 有站内生成，无公开 API 文档 | — | — | — |

### 1.3 免费额度

| 平台 | 免费额度 | 一次性/每月 | 来源 |
|---|---|---|---|
| Replicate | "Try for Free" 系列模型有限次免费运行，**不给金额也不给次数** | 一次性 | 【一手】官方 FAQ |
| Runware | **$2** | 一次性，需**企业邮箱**注册 | 【一手】官方定价页 FAQ |
| Modal | **$30/月** 算力（Team $100/月） | **每月刷新** | 【一手】官方定价页 |
| Venice | Free 档 10 条文本/天（图像与 API 不在免费内）；Pro 有一次性 500 welcome credits | — | 【一手】官方定价页 |
| NovelAI | 邮箱验证账号 **30 张免费图（≤1024×1024）** | 一次性 | 【一手】官方订阅文档 |
| Shakker | 免费档 200 fast token/天（第三方，可能过时） | 每天 | 【二手】 |
| Tensor.Art | 50–100 credits/天（口径不一） | 每天 | 【二手】 |
| **TensorHub** | **无** | — | 【二手转述官方】 |
| Civitai | Blue Buzz（互动赚，**仅 SFW**）；每日奖励 | 每天 | 【一手】 |
| ModelsLab | **无**（官方 FAQ 明写 paid-only；但 unlimited 页有"Free 10 generations"字样，冲突） | — | 【一手】 |
| RunPod | 无 trial credits；startup 计划 Starter 档 $1,000 / Growth 档 $50K→$75K | — | 【一手】 |
| Together AI | **无免费试用** | — | 【一手】 |

---

## 2. 重点核实项（用户点名的三条）

### 2.1 RunPod / Modal 能否直接刷 Visa 充值、起步成本多少

**RunPod — 能，官方明列 Visa。**

【一手】[Runpod Billing 文档](https://docs.runpod.io/accounts-billing/billing)：

| 方式 | 细节 |
|---|---|
| 信用卡 | **Visa、Mastercard、American Express 及其他 Stripe 支持的卡**；预付卡建议每笔至少 $100 |
| 加密货币 | 通过集成支付处理商；首次加密支付前需完成 KYC |
| 商业开票 | 仅 > $5,000，支持 ACH / 电汇 / 信用卡 |

配套的硬性事实（全部一手）：

- **最低充值 $10**：官方 blog 与 GitHub 文档均写 "You can deposit as little as $10 into your Runpod account by card to fund it"。（[manage-funding blog](https://www.runpod.io/blog/manage-runpod-account-funding)、[billing-information.mdx](https://github.com/runpod/docs/blob/72e717d5/references/billing-information.mdx)）
- **起 Pod 需要 ≥1 小时所选配置的余额**；余额不足 10 秒运行时会停掉所有 Pod 以保护数据卷。（[pods/pricing](https://github.com/runpod/docs/blob/72e717d5/pods/pricing.mdx)）
- **默认消费上限 $80/小时**，提高要联系支持。
- **积分不可退款、不可提现**；官方明确"不提供退款与 trial credits"。
- 拒付处理（这条对国内卡很关键）：Stripe 风控下**连续多次失败会把该账户的支付尝试整体封 24 小时**；官方建议"只用一张卡先试，先试 $10，不行再试 $25 或更高"，不要连试多张卡。（[Troubleshooting Payment Declines](https://contact.runpod.io/hc/en-us/articles/41318080028819-Troubleshooting-Payment-Declines-on-Runpod)）社区解法包括用 Stripe **Link** 通过验证（[answeroverflow 讨论](https://www.answeroverflow.com/m/1466234473816260670)）。
- GPU 价格（2026-10-02/03 抓取）：RTX 4090 Community **$0.34/hr** / Secure **$0.74/hr**；RTX A5000 $0.16/$0.27；A100 PCIe 80GB $1.19/$1.59；H100 80GB「from $1.99/hr」。（[runpod.io/pricing](https://www.runpod.io/pricing)、[computeprices.com/providers/runpod](https://computeprices.com/providers/runpod)）
- Serverless worker 价（官方公告）：4090 Flex **$0.00044/s**、Active **$0.00026/s**；A100 80GB Flex $0.0013/s、Active $0.00078/s。（[serverless pricing update](https://www.runpod.io/blog/serverless-pricing-update)）
- 内容合规是**本轮最大的意外发现**，见 §2.1 末段。

**Modal — 官方口径是"必须先绑支付方式"，但有 $30/月免费算力。**

- 【一手】[Modal Pricing](https://modal.com/pricing)：Starter `$0 + compute/month`，含 **$30/月 compute**；Team `$250/month` 含 $100；Enterprise 定制。Starter 团队最多 3 seat、100 容器、10 GPU 并发；**免费用量每月刷新，不累积**。
- 【一手】[Modal Billing 文档](https://modal.com/docs/guide/billing)原文："**you must have a payment method on file in order to use Modal**"；更新支付方式是点 "Manage payment details" 跳 **Stripe 托管页**；月结自动扣费；发票/国际电汇/拆票等只对 Enterprise 开放。
- 冲突：多篇第三方（[buildaicurrent](https://buildaicurrent.com/credits/modal-free-tier/)、[aicreditmart](https://aicreditmart.com/ai-credits-providers/modal-free-tier-how-to-get-30-month-in-compute-credits-2026/)、[toolfreebie](https://toolfreebie.com/modal-serverless-gpu/)）称"Starter 不需要信用卡即可用 $30"；另有一份（GitHub skill 文档）称"无卡只有 $5/月，绑卡才有 $30"。**官方只给了"必须先有 payment method"这一句，未说明虚拟/预付卡是否接受**。→ 建议实测绑卡。
- 计费方式：按秒，闲置不计费（scale to zero）。

**RunPod / Modal 的 NSFW 可行性 —— 两份前报告都没有覆盖的硬约束（本轮直取原文核实）：**

- **RunPod ToS**：【一手】[runpod.io/legal/terms-of-service](https://www.runpod.io/legal/terms-of-service) 原文：
  > "Among unauthorized Content submitted to the Service includes: intoxicants of any sort; illegal drugs or other illegal products; alcoholic beverages; games of chance; and **pornography or graphic adult content, images, or other adult products**. Postings of any unauthorized products or content may result in **immediate termination of your account and a lifetime ban** from use of the Site."

  即：RunPod 不是"平台无内容策略"，而是把色情/成人内容写进了 unauthorized Content 列表。第三方对该条款有解读空间（[cling-ai 分析](https://cling-ai.com/blog/runpod-nsfw-policy-adult-content-allowed-2026) 认为该节偏向 marketplace 语境、术语未给"NSFW 允许/禁止"的简单句），但**字面条款在**，做商业产品等于把身家押在"平台不执行"上。
- **Modal ToS**：【一手】[modal.com/legal/terms](https://modal.com/legal/terms) 原文：Prohibited Content 包括 "(c) contains **indecent or obscene material**"；Prohibited Purpose 包括 "conduct cryptocurrency mining or related blockchain related activities, denial of service attacks, peer-to-peer file sharing, or general file-hosting or media-serving platform services"。**无任何成人内容豁免或成人内容计划**。第三方 [RawSignal](https://rawsignalai.com/directory/developer-apis/modal) 同样判定"没有 NSFW carve-out"。
  - 附带：Modal 的 AUP 链接 (`/legal/acceptable_use_policy`) 本轮实测 **404**，即没有独立的 AUP 文本，只以 ToS 为准。
- 补充隐私事实（RunPod 侧，对用户有利）：【一手】[docs.runpod.io/references/security-and-compliance](https://docs.runpod.io/references/security-and-compliance)："Runpod's terms of service prohibit hosts from inspecting your Pod/worker data or analyzing your usage patterns."

### 2.2 Civitai 主站：只拿得到 Visa 而没有加密货币，能买到什么

**结论：只能买到 Green Buzz（SFW 范围），NSFW 生成与 Orchestration 的 `allowMatureContent` 路径用不了。**

机制（一手，来自官方 Orchestration 文档）：Civitai 的 Buzz 分三种，[Submitting Work](https://developer.civitai.com/orchestration/guide/submitting-work) 原文表格：

| 币种 | 获取方式 | 可用于 |
|---|---|---|
| Blue | 站内互动赚取 | **仅 SFW** 工作流 |
| Green | 购买（信用卡） | **仅 SFW** 工作流 |
| Yellow | 购买（加密货币） | SFW **与 NSFW** 工作流 |

同页原文：
- "`allowMatureContent: true` **forces payment in yellow Buzz** (the only NSFW-capable currency)."
- 不指定 `currencies` 时扣款顺序为 blue → green → yellow；若用 blue/green 结算但输出被判定为成熟内容，`upgradeMode: "manual"` 会扣住输出等你在 `PUT/PATCH` 时改 `allowMatureContent: true` 并补黄 Buzz，`"automatic"` 则自动补差。

【一手】[2026-09-09 官方《Yellow Buzz 终极指南》](https://civitai.com/articles/33522/the-ultimate-guide-to-earning-for-free-and-buying-yellow-buzz-on-civitai) 原文：
> "**If you buy a Civitai Membership (Bronze, Silver, or Gold) or buy Buzz with a credit/debit card, you receive Green Buzz (used for SFW generation), not Yellow Buzz!** To buy Yellow Buzz, you must purchase it using cryptocurrency."

**2026-10 的域名重组（本轮新观测，前两份报告未覆盖）：**

- `civitai.green` 现在 **301 → civitai.com**；civitai.com 页面内嵌的服务端配置显示 `"domain":"green"`，`serverDomains: { green.primary = "civitai.com", blue.primary = "civitai.red", red.primary = "civitai.red" }`。
- civitai.com 的定价页标题是 "Green Memberships"，横幅写 **"Unrestricted content creation has moved to civitai.red"**，三档会员：**Bronze $10/mo（10,000 Green Buzz）、Silver $25/mo（25,000）、Gold $50/mo（50,000）**，`provider: "Stripe"`，每档都有 "Gift this tier"，支持多币种（usd/eur/gbp/jpy/cad/aud/krw）。
- civitai.red/pricing 则写 **"Yellow memberships are no longer available"**，只留：① "Perks Membership — 用 Buzz 买，只有权限、无每月 Buzz、不自动续费"；② "Green Membership — 用标准支付方式（信用卡经 Stripe）"。
- 服务端 feature flag（本轮从页面内嵌 JSON 提取）：civitai.com 侧有 `isGreen / canBuyBuzz / emerchantpayPayments / giftMemberships / buzzMemberships / prepaidMemberships`；civitai.red 侧有 `isRed / canBuyBuzz / disablePayments / emerchantpayPayments / giftMemberships / buzzMemberships / prepaidMemberships`。→ **`emerchantpayPayments`（一个新的高风险友好型收单通道）已经出现在两端**，但 `.red` 侧另有 `disablePayments: true`。（这是页面埋点级别的观测，不等同于官方公告，解读需谨慎。）
- 另一个可能的例外【待实测】：【一手】[2026-08-19《Gift It or Earn It》](https://civitai.com/articles/33871/gift-it-or-earn-it-two-new-ways-to-get-a-membership) 原文："Gifting a membership is live ... Bronze, Silver or Gold, for 1, 3 or 6 months, **paid with a card**"，且 "A gifted membership is the full thing, **monthly Buzz and badge included**"。公告**没有说明这份 Buzz 的颜色**。结合 2026-09-09 的说明与 /pricing 页面上卡付会员只对应 Green Buzz，合理读法是 Green（即仍不能用于 NSFW），但**值得实测确认**。
- 已死的通道：Coinbase Commerce 集成 **2026-04-01 起下线**；ZKP2P **2025-09-11 起暂停**；礼品码/Kinguin/BuyBuzz 券 **2026-04-01 起停售**（buybuzz.io 仍在，但点进去跳 Civitai 登录，且官方公告已宣布停售）。→ **PayPal/Venmo 事实上不再是可用路径。**
- 加密货币直充（唯一黄 Buzz 通道）：支持 **BNB、BTC、DOGE、ETH、LTC、PYUDS、SHIB、SOL、TRX、USDC、USDT**；推荐 **USDC on Base**；**1,000 Buzz = $1.00**；Civitai 不收额外手续费（只付链上 gas）。可在 PayPal / Venmo / Cash App / Coinbase / Revolut / MoonPay / Kraken / Binance / OKX / Bybit / Bitso / Transak 买币后转入。（[加密货币购买指南](https://education.civitai.com/civitais-guide-to-purchasing-buzz-with-crypto/)）
- 注意 BTC 必须走 Bitcoin 网络，走 Base/Solana 会丢币。
- 成本量级：SDXL 1024² ≈ 8 Buzz（≈$0.008）（上一轮报告，官方 recipe）。

### 2.3 ModelsLab 与 Replicate 的信用卡充值是否畅通

**ModelsLab —— 是，而且可以完全无浏览器自动化；但**没有免费额度**。**

- 【一手】[定价页 FAQ](https://modelslab.com/pricing) 原文："**No. ModelsLab is paid-only — there is no free tier, no free credits and no trial plan.** Plans start at $21/month (Basic)"。
- 冲突点：`modelslab.com/unlimited` 页面有 **"🚀 Free 10 generations to start"** 字样（【一手】），与 FAQ 的"无免费"自相矛盾。→ 以 FAQ/定价表为准，10 张可能是特定落地页的营销话术。
- 价格：Basic **$21/mo**（3,250 calls、5 并发）、Standard **$47/mo**（10,000 calls、10 并发）、Open Source Unlimited **$149/mo**（自有 GPU 上开源模型不限量、15 并发）、Enterprise $249 起；开源出图 **$0.0047/图**、宣称 2048×2048 内不加价；月付年付 **100% refund policy**。
- 支付管线（【一手】[Billing and Wallet 文档](https://docs.modelslab.com/agents-api/billing-and-wallet)）支持三条路：
  1. 取 Stripe publishable key → **headless card tokenization**（卡数据只到 Stripe，拿 `payment_method_id`）→ 直接调 `/wallet/fund` 或 `/subscriptions`；
  2. Stripe-hosted payment link（人机协作，人付完把 `session_id` 交回）；
  3. 传统控制台。
- **Agent 全自动开户**（【一手】定价页 FAQ 原文）：`POST /auth/signup` → `POST /billing/payment-link`（返回 Stripe checkout URL）→ `POST /subscriptions` → `POST /api-keys`，"An agent can go from no account to a working API key without a browser"。
- NSFW 关键证据（**这是本轮对 ModelsLab 最有价值的发现**）：模型页（如 [anime-figure-style-illustrious-pony-sd1-5-v1-0](https://modelslab.com/models/modelslab/anime-figure-style-illustrious-pony-sd1-5-v1-0)、[MeMaXL Flat Anime](https://modelslab.com/models/modelslab/memaxl-flat-anime-style-noob-illustrious-pony-xl-v3-0-a-ponymagine)）原文写着：
  > "NSFW samples are gated ... **The API does not enforce the same NSFW gating as the web playground — content moderation is handled by your account-level policy.**"

  即：网页端有 NSFW 门禁（需登录开开关），**API 侧不做同等门禁，审核按你账户级策略走**。

**Replicate —— 卡付畅通，但门槛在"预付费"而非"能不能刷卡"。**

- 【一手】[Prepaid credit](https://replicate.com/docs/topics/billing/prepaid-credit)：**必须先买 credit 才能用**（2025-07-16 起新账户全部转为 prepaid）；credit **有效期 1 年、不可退**；auto reload 最低阈值 **$5**、最低充值金额 **$15**；余额归零即停新任务并关停基础设施。
- 支付走谁：Replicate 的 subprocessor 清单里 **Stripe = Payment processing（美国）**（【一手】[subprocessors](https://replicate.com/docs/topics/site-policy/subprocessors)）；账单页用 "Manage billing" 跳托管页。**官方没有枚举接受的卡品牌**，也没有像 Runware 那样在 ToS 里列 UnionPay。
- 免费：官方有一整个 [Try for Free 合集](https://replicate.com/collections/try-for-free)，"你可以**不买 credit 就跑**这些模型，但要先建账号"，"**free for a limited number of runs**"——金额与次数官方从不公布。第三方数字互相矛盾：$5（[yangmao.ai](https://yangmao.ai/en/deals/replicate-free-tier/)、itirupati）、$500（[getaiperks](https://www.getaiperks.com/en/ai/free-replicate-credits)）、"未披露"（[aicreditmart](https://aicreditmart.com/ai-credits-providers/replicate-free-credits-how-to-get-free-generations-2026-guide/)）。→ **以官方"有限免费次数、不披露"为准。**
- 官方保留免费层的旁证：Metronome 的客户案例写 Replicate 迁移预付费时 "Preserving their free trial offering"。（[getmetronome.com](https://www.getmetronome.com/customer-stories/replicate)）
- 计费细节（对成本预估很重要，【一手】[billing](https://replicate.com/docs/topics/billing)）：
  - 公开模型只付"active 处理请求"的时间，setup/idle 免费；
  - **私有模型与 deployment 要付 setup + idle + active 全时**（fast-booting fine-tune 例外）；
  - **失败不收费**；**取消官方模型可能仍收费**；
  - 模型会调用下游模型时，下游也算钱。
- 价格（【一手】[replicate.com/pricing](https://replicate.com/pricing)，2026-10-04 抓取）：按秒——L40S $0.000975/s、A100 80GB $0.0014/s、H100 $0.001525/s、T4 $0.000225/s、CPU $0.0001/s；官方模型按输出——FLUX 1.1 Pro ≈$0.04/图、Ideogram v3 Quality ≈$0.09/图。

---

## 3. 其余平台的付款通道与开放度

### 3.1 Runware（参数最全 + **ToS 明确接受 UnionPay**）

**付款（本轮最大更正之一）：**

- 【一手】[runware.ai/terms](https://runware.ai/terms) 第 8 节 "PURCHASES AND PAYMENT" 原文：
  > "We accept the following forms of payment: **Visa / Mastercard / American Express / Discover / JCB / UnionPay**"

  → 这是十家里**唯一在合同文本层面点名 UnionPay 的**。
- 【一手】[帮助中心：Payments and Credits](https://help.runware.ai/articles/7648578038-payments-and-credits)：卡支付经 **Stripe**；**最低充值 $20**（官方解释：多数客户是企业用户，为简化运营）；**已购 credits 不过期**；失败请求不收费。
- 【一手】[定价文档](https://runware.ai/docs/models-api/pricing)：无订阅、无最低消费（"no subscription and no minimum spend"），Dashboard 可开 **auto-reload**、低余额提醒、**备用支付方式**。
- 【一手】[runware.ai/pricing FAQ](https://runware.ai/pricing)：**新用户用企业邮箱注册送 $2 credits**。
- 失败不收费："Failed generations are not charged. You only pay for tasks that returned a result."

**API 开放度（十家里文档最工程化的）：**

- 【一手】[认证文档](https://runware.ai/docs/models-api/authentication)：REST `https://api.runware.ai/v1`（全部 POST，JSON 数组，首元素为 auth 对象或 `Authorization: Bearer <API_KEY>`）；亦支持 WebSocket `wss://ws-api.runware.ai/v1`（长连接，断线 20s 内消息可续）。API key 按项目分、可描述、可撤销、可团队共享。
- 【一手】模型元数据三个 JSON 端点全量开放：`/docs/models/index.json`（全部公开模型 id/AIR/能力/schema URL）、`/docs/models/<model>/schema.json`（OpenAPI，价格在 `info["x-pricing"]`）、`/docs/models/<model>/examples.json`（真实跑过的示例，含请求体与价格）。任何任务加 `includeCost` 会返回该请求扣掉的 USD 金额。
- 【一手】[账户管理文档](https://runware.ai/docs/platform/account-management.md)：Owner/Admin/Developer 三角色权限表（API key 管理、计费与支付方式仅 Owner/Admin）。
- 模型：统一 AIR ID（含 `civitai:4384@128713` 这类直指 Civitai 模型的 ID）、LoRA / ControlNet / IP-Adapter 堆叠、可上传自有 checkpoint / LoRA / LyCORIS / VAE / embedding、有 LoRA 训练 API。

**内容尺度（重要更正）：**

- 本轮**逐条提取**了 runware.ai/terms 的 prohibited use 列表（共 53 条）。其中与成人内容相关的**只有**：
  - "Use the Services to create, distribute, or promote **sexually explicit material involving minors** ... including minor grooming, nudity, or use of any material designed to impersonate a minor"（并附 CSAM 上报义务）；
  - "create, distribute, or share **age-inappropriate material, including material that targets minors** and promotes sexual material, graphic violence, obscenity, or other mature themes"；
  - 禁止无同意地复刻真人身份/外貌（第 39 条）。
  - **没有**任何针对成年人之间的通用色情/成人内容禁令，也没有出现 "obscene, lewd, lascivious, filthy, sexually explicit" 这类泛化措辞（全文对 "obscene" 的两次命中都出现在"用户名不合适/obscene"的账号命名条款里）。
- → 这与 [RawSignal](https://rawsignalai.com/directory/developer-apis/runware)（称其 ToS 禁"obscene, lewd, lascivious... sexually explicit"）以及 [18models 政策追踪](https://18models.ai/policy-tracker)（把 Runware 列为 Prohibited）**不符**，判为错误或基于旧版条款。
- 但**工具层面确有过滤**：【一手】[Content Safety API](https://runware.ai/docs/models/content-safety)（同 `safety.checkContent` 参数，返回 safe/not-safe + 置信度）；帮助中心 [What does a content moderation error mean?](https://help.runware.ai/articles/9032861662-what-does-a-content-moderation-error-mean) 明说 "Explicit or sexual" / "Violent or graphic" 会被拦，措辞是"违反**模型提供商**的安全或内容准则"。→ 实际可用性取决于所调模型（Civitai AIR 直连的模型 vs 官方托管模型可能不同）。

### 3.2 Together AI（付款最"干净"，但对成人内容最不友好）

- 【一手】[Payment methods 文档](https://docs.together.ai/docs/billing-payment-methods) 与 [支持中心](https://support.together.ai/articles/7048797576-what-payment-methods-are-accepted)：
  - 支持 **Visa / Mastercard / American Express** 的**信用/借记卡**；
  - **不支持预付卡（prepaid）与虚拟卡**——会报 "We only accept credit or debit cards"，或 "Your card does not support this type of purchase"；
  - **ACH 仅限在美国银行、且验证美国账单地址**的组织；ACH 单笔上限 $50,000（Scale/Enterprise $100,000）；
  - **组织任何时候都必须保留至少一张有效卡**，即便默认方式是 ACH；
  - 部分地区银行要求**每笔交易授权**，Together 会向注册邮箱发授权链接（要立刻点，否则扣款失败）；
  - 付卡时银行可能显示 **$0 预授权**，属正常。
- 【一手】[Credits 文档](https://docs.together.ai/docs/billing-credits)：**无免费试用**；**最低 $5 起充**；全预付，余额归零即停 API；credits 不过期；auto-recharge 只在默认方式是卡时可用。
- 内容政策：【一手】[Terms of Service](https://www.together.ai/terms-of-service) 第 4 条原文："You are **strictly prohibited** from using the Services to communicate any message or material that (i) is libelous, harmful to minors, **obscene, or constitutes pornography** ..."→ **明确禁 porn，无成人豁免**。[RawSignal](https://rawsignalai.com/directory/developer-apis/together-ai) 称其是 open-model hosts 里最严的一档。另有禁止竞品开发与 benchmark、禁止传金融/医疗/敏感个人数据的条款。
- 图像 API 面（上一轮已核实）：`POST /v1/images/generations` 支持 `image_loras[]`（可指 HF/Civitai 下载链接，最多 2 个）与 `disable_safety_checker`（boolean），但**模型库里没有动漫专用 checkpoint**（底座是 FLUX/SDXL）。
- 账单吐槽（【二手】RawSignal）：$1 卡预授权据说不会退还；多模型成本难预测。

### 3.3 NovelAI（动漫 NSFW 的独立档，但付款通道单一）

- **支付**：【一手】[FAQ](https://docs.novelai.net/en/faq/) 原文 "We use **Chargebee** as our payment processor. As long as your payment method is supported by Chargebee; we can accept your payment."；官方[更新公告](https://novelai.net/updates?id=payment-processor-update)说明此前是 **Paddle**，因"Paddle 不再支持 AI 产品"而迁移。**官方从未列举卡品牌**。
  - 【二手】[checkthat.ai](https://checkthat.ai/brands/novelai/pricing)：支持 PayPal 及 Chargebee 支持的方式，价格仅以 USD 计。
  - 【二手·营销文】[evertry](https://evertry.co/blog/pay-for-novelai-trinidad-and-tobago/)（虚拟卡服务商自营博客，立场不中立）：Visa / Mastercard / 国际借记卡 / 信用卡；USD 计价；每 30 天扣一次。
- **价格**：【一手】$10 Tablet / $15 Scroll / $25 Opus，30 天续费一次，**无年付折扣**。
- **免费额度**：【一手】[订阅文档](https://docs.novelai.net/en/subscription/)原文："You get **30 free Image generations up to 1024x1024 resolution** if you're logged in with an e-mail verified account."（【二手】checkthat 补充：新账号一次性 50 次文本 + 30 张图，不自动刷新，平台大版本更新时可能重置。）
- **API 开放度**：
  - 【一手】[api.novelai.net/docs](https://api.novelai.net/docs)：图像生成端点在 `image.novelai.net`，文本在 `text.novelai.net`；调用 `POST /ai/generate-image`，返回 SSE/ZIP。
  - **未订阅 → 402 "An active subscription is required to access this endpoint"**（OpenAPI 里每个端点都标了这个响应）。
  - 官方对第三方开发者的原话："Third-party API users developing user-facing applications must **ask for a user's Persistent API token**"——即**没有独立开发者 key 体系**，必须让终端用户自己交 token。
  - 取 token 方式【一手】[Account 设置文档](https://docs.novelai.net/en/text/usersettings/account/)：用户设置 → Account → **Get Persistent API Token** → Overwrite → Copy；**token 只显示一次**；**重新生成会使旧 token 立即失效**。
  - 【二手】[agn-ai 文档](https://github.com/luminai-companion/agn-ai/blob/dev/instructions/novel.md)补充：也可从 localStorage 的 `session.auth_token` 取，但该 token **约每月过期一次**。
- **Anlas 规则（成本相关的坑）**：【一手】订阅文档原文——NovelAI Diffusion **V5 发布 31 天后**，订阅 Anlas 在订阅结束的瞬间**清零**（不管剩多少）；取消订阅**无法再购买额外 Anlas**；Opus 的"免 Anlas"只在"单张、无底图、Normal 尺寸、≤28 步"时成立，V5 另有"电池式"上限。
- **尺度**：内部把部分模型限为 `curated`；平台禁止写实向（Photorealism prohibited）。动漫 NSFW 可用（上一轮已核）。
- **不采信的第三方**：有站点宣称"2026 更新 API 访问"并给 `$12/$18/$30` 涨价表，与官方 $10/$15/$25 冲突，**判为疑似 AI 生成内容**。

### 3.4 Venice AI（唯一"无账号也能付"的通道）

- **支付**（【一手】[Crypto RPC / funding 指南](https://docs.venice.ai/guides/integrations/crypto-rpc-agents)）三条：
  1. **Dashboard 内 Stripe（卡）**＋ **Coinbase（加密）**：需要**登录浏览器**操作，credits 永不过期；
  2. **x402 钱包**（[x402 指南](https://docs.venice.ai/guides/integrations/x402-venice-api)、[top-up 端点](https://docs.venice.ai/api-reference/endpoint/x402/top-up)）：**无需账号**，用 EVM/Base 或 Solana 钱包签 `SIGN-IN-WITH-X`，USDC on Base(8453) 或 Solana 主网，**最低充值 $5**，签名头 `PAYMENT-SIGNATURE`（兼容旧名 `X-402-Payment` / `X-PAYMENT`）；
  3. **质押 VVV 换 DIEM**（1 DIEM = $1/天，UTC 00:00 刷新，需累计 ≥0.1 DIEM 才能花）——这是官方口径里**唯一完全无人工介入**的给"已签发 API key"充值的方式。
  - 另有【一手】LinkedIn 公告（2026-03-03）：**Pro 现支持月付 USDC 订阅**（经 Stripe）。
- **免费**：Free 档 10 条文本/天；Pro 档含**一次性 500 welcome credits**；订阅 credit（100 credits = $1）。
- **订阅价**：【一手】[venice.ai/pricing](https://venice.ai/pricing) / [官方公告](https://venice.ai/blog/new-subscription-tiers)：**Pro $18/mo（含 100 credits/月）**、**Pro+ $68/mo（7,500 credits/月，2 个月 credit banking）**、**Max $200/mo（22,500 credits/月，3 个月 banking）**；年付省 10%。
- **API 门槛（关键）**：【一手】[learn.venice.ai 入门指南](https://learn.venice.ai/guides/getting-started-with-the-venice-api-staking-keys-and-pricing) 原文："the Venice API is available **only to Pro users**"——即**必须先订 $18/月的 Pro 才能建 API key**。（Free 档的对比表里 "API Access (pay with credits)" 是 Pro 及以上列。）
- **API 形态**：【一手】[API Reference](https://docs.venice.ai/api-reference/api-spec)：OpenAI 兼容（base URL `https://api.venice.ai/api/v1`）；key 分 `INFERENCE` / `ADMIN`；`GET /models`、`/models/traits`、`/models/compatibility_mapping`、`/image/styles` 无需 key 即可读；响应头返回 `x-venice-balance-usd` / `x-venice-balance-diem` 等；可整包下载 OpenAPI YAML 与全部 mdx 文档（对 RAG 友好）。
- **尺度**：模型带 `uncensored: true` 标记，官方定位"private, unrestricted"；但图像端点有 `safe_mode`（默认 true，会模糊成人内容），OpenAI 兼容端点的 `moderation` 参数 `auto`=模糊、`low`=关 Safe Venice；响应头会返回 `x-venice-is-blurred` / `x-venice-is-content-violation` / `x-venice-is-adult-model-content-violation` / `x-venice-contains-minor`。（上一轮已核）
- **图像参数面**：无 LoRA / ControlNet（上一轮已核）。

### 3.5 Shakker AI（能刷 Visa，但**很可能没有 API**）

- **支付**：【一手】[shakker.ai/purchase 官方 FAQ](https://www.shakker.ai/purchase) 原文："All payments are processed by **Stripe** ... In most places, Stripe supports major credit and debit cards, including **Visa, Mastercard, American Express, Discover, Diner's Club**, and some digital wallets like **Apple Pay and Google Pay**. The payment methods available in your region will be shown during checkout. **PayPal, wire transfer, and other payment methods are not currently supported.**"
- 订阅与 token：【一手】同页——订阅 fast token **每月重置、不累积**；用掉 <50 fast token 可申请退款（billing@shakker.ai，约 15 天）；可随时取消，到期前仍可用；只能升档不能降档。
  - 价格口径不一：【二手】[AIDIRECTORY](https://aidirectory.com/shakker) Basic £10/mo（年付，15,000 tokens/月）、Advanced £24/mo（年付，35,000）；【二手】[aitools.fyi](https://aitools.fyi/shakker-ai) Basic $10/mo（年付）/ $12（月付）15,000 tokens、Advanced $24/$30 35,000 tokens + token 用尽后无限 relaxed 生成；【二手】[toolify](https://www.toolify.ai/ai-news/shakker-ai-unleash-the-power-of-ai-image-generation-for-free-3700728) 给的是较老的 Free 200 token/天、Basic $8/10,000、Advanced $20/30,000。→ **以官网 checkout 为准**。
- **API：【未能核实，倾向否定】**。本轮实测 `https://www.shakker.ai/api` 与 `https://www.shakker.ai/purchase`（直连 + 代理 + 浏览器 UA）**均返回 HTTP 500 "Internal Server Error"**；网站导航只有 Generator / 在线 A1111 WebUI / 在线 ComfyUI / LoRA 训练，**没有任何开发者/文档入口**。仅有 [aidigitalbox](https://aidigitalbox.com/2025/05/21/shakker-aistreaming-image-generator-with-specialized-models/) 与 [toolglade](https://www.toolglade.com/tool/shakker-ai) 这类第三方站声称"有 well-documented REST API / 付费计划可用"，**均未给出文档链接或端点**，不可采信。→ 集成方案不应把 Shakker 当作有 API 的平台。
- **尺度：冲突未解**。
  - 多篇评测称其是"mainstream 平台、条款限制 explicit 内容、不是 NSFW 工具"（【二手】[aiimagegeneratornsfw](https://aiimagegeneratornsfw.com/shakker-ai-nsfw-review-2026/)、[toolify](https://www.toolify.ai/ai-news/shakker-ai-unleash-the-power-of-ai-image-generation-for-free-3700728)）。
  - 但 Shakker **模型库里确实托管**了 [IllusioN-R NSFW Illustrious-XL](https://www.shakker.ai/modelinfo/0a3ff566374d4ecf9c4886d3096154dd/IllusioN-R-NSFW-Illustrious-XL)、[WAI-illustrious-SDXL](https://www.shakker.ai/modelinfo/0f204323a06f40e18f8ffc5b1813df5a/WAI-NSFW-illustrious-SDXL)、[Pony Diffusion V6 XL](https://www.shakker.ai/modelinfo/7b67c100c35f47fc8c39ae3033b82899/Pony-Diffusion-V6-XL)（其模型卡自称"能出 SFW 与 NSFW"，并明确禁止"在允许任何形式变现的站点/应用上跑该模型"）；NGA 用户评价"Shakker 可以一定程度上免费 GHS"（上一轮）。→ **"托管模型" ≠ "允许生成"**，需实测。
- 平台血缘：Shakker = **LiblibAI 的海外版**（上一轮已核）。

### 3.6 TensorHub（NSFW 专属站，但付款路径本轮未能核实）

**是什么**：Tensor.Art 于 **2025-11-27** 宣布转为纯 SFW（理由是**信用卡组织与监管的强制要求**），NSFW 迁至同团队的新站 **tensorhub.art**；同账号体系、内容双向同步（NSFW 内容传 TensorHub 后可见，在 Tensor.Art 保持隐藏）；Tensor.Art 同时**全面禁真人明星**。（【二手】[ai.miraheze.org/wiki/Tensor.art](https://ai.miraheze.org/wiki/Tensor.art)、[goongen 政策分析](https://goongen.ai/blog/tensor-art-nsfw-policy)、[gallery-dl issue #8887](https://github.com/mikf/gallery-dl/issues/8887)）

**计费**（【二手】多源一致）：
- TensorHub 用**独立 Token 体系**，**价格高于** Tensor.Art 的 credit；
- **无每日免费额度**、无任务奖励 → NSFW 生成**从第一张就要钱**；
- 曾在切换前提供**一次性 credit→Token 转换**（2:1，另有 3:1 说法），新用户已无此优惠；
- Reddit 社区口径：单张成本约为 Tensor.Art credit 的 **3 倍**。

**Tensor.Art 侧价格（作为参照，【一手】[官方公告](https://www.tensor.art/event/proupdate) + 【二手】多源）**：Daily Pass **$1**（每人限购一次）、Pro 月付 **$9.9**（送 1k credits）、季付 **$19.9**（送 5k）、年付 **$59.9**（原价 $119.9，送 25k）；credit 包 3k / 10k（官方公告未改价）、10,000 credits $29.90、30,000 credits $59.90；Basic ~$5/月；免费档 **50–100 credits/天**（口径不一，不累积，存储 14 天/7 天说法不一）。**官方公告明确写 "We are pleased to announce that we now support Stripe for a more convenient payment process."**——即 Tensor.Art 侧已接 Stripe（用卡）。

**TensorHub 的支付方式：【未能核实】。** 本轮实测：
- `degoog-cli scrape https://tensorhub.art/` → **HTTP 403**（Cloudflare）；
- 用 camoufox 过挑战后，`/pricing`、`/vip`、`/charge`、`/recharge`、`/token`、`/purchase` **全部 404 或需登录**，公开页面**没有任何支付方式说明**；
- 从首页内嵌的服务端配置里提取到一个 `enableGreenPay` 开关（当前 `false`）——语义不明，不构成证据。
- 【二手】关于 Tensor.Art 的支付描述互相矛盾：sexai.tools 列 "Credit card, PayPal, Crypto"，ainvasion 称 credit 包"支持加密货币"，Pay2.House 直接卖"给 Tensor Art 付款的虚拟卡"（说明确实存在卡付场景）。
→ **结论：TensorHub 实际收单方式（卡 / 加密货币 / 只能先用 Tensor.Art 余额）需要注册登录后实测**；考虑到 Tensor.Art 转向 SFW 的直接动因就是"信用卡组织的强制要求"，NSFW 侧的卡付通道存在高风险，**不能假设 Visa 一定能用**。

**两个必须注意的坑：**
1. **`/models` 等页面是 Cloudflare + SPA，普通抓取拿不到正文**，要过挑战（本轮用 camoufox 成功）。
2. **命名陷阱**：以太坊上有一个**同名加密项目 "TensorHub (THUB)"**（[gitbook 代币文档](https://tensorhub.gitbook.io/documentation/information/tensorhub-tokenomics) 讲 GPU 租赁、5/5 买卖税、96% liquidity），**与 tensorhub.art 完全无关**，搜资料时极容易混。
3. 实测可见的 NSFW 生态证据：tensorhub.art 首页模型流里有 **Sexuality-Krea2Mix-Uncensored（KREA 2 底座）**、**黑犬兽 / BLACK DOG / KUROINU JUU** 等成人向模型，说明 NSFW 内容生态真实存在。

---

## 4. 横向对比

### 4.1 付款通道对照表

| 平台 | 卡（Visa） | 银联 | 加密货币 | 其他 | 最低充值 | 实际收单方 |
|---|---|---|---|---|---|---|
| ModelsLab | ✅ | 未提及 | ❌（未见） | 无头卡 tokenization；Stripe 支付链接 | $21/月订阅 | Stripe |
| Replicate | ✅ | 未提及 | ❌ | 预付 credit + auto-reload | $15 起充 | Stripe（subprocessor 列表） |
| Runware | ✅ | **✅ ToS 明列** | ❌ | auto-reload、备用支付方式 | $20 | Stripe |
| Together AI | ✅（**禁预付/虚拟卡**） | 未提及 | ❌ | ACH（仅美国） | $5 | 未在文档中点名（卡直接扣） |
| Venice | ✅ | 未提及 | ✅ USDC（Base/Solana） | x402 免账号；VVV 质押换 DIEM | 需 Pro $18/月；x402 $5 | Stripe / Coinbase / x402 |
| NovelAI | ✅（未列品牌） | 未提及 | ❌ | PayPal（二手） | $10/月 | Chargebee |
| RunPod | ✅ | 未提及 | ✅（需 KYC） | >$5,000 可 ACH/电汇开票 | **$10** | Stripe |
| Modal | ✅（未列品牌） | 未提及 | ❌ | 无 | $0（含 $30/月算力） | Stripe 托管页 |
| Civitai | ⚠️ 只能买 Green Buzz | 未提及 | ✅ 11 种币（黄 Buzz 唯一通道） | emerchantpay（新，flag 级） | 会员 $10/月 | Stripe / NowPayments / emerchantpay |
| Shakker | ✅ | 未提及 | ❌ | Apple/Google Pay；**不支持 PayPal/电汇** | 未确认 | Stripe |
| TensorHub | 未核实 | 未核实 | 未核实 | — | 无免费 | 未核实 |

### 4.2 二次元 / NSFW 尺度对照

| 平台 | 二次元模型可得性 | NSFW 合同层面 | NSFW 工具层面 | 动漫 NSFW 证据 |
|---|---|---|---|---|
| **ModelsLab** | ⭐⭐⭐ 10,000+ 含 Illustrious/Pony/NoobAI + 自训 | 未禁（主打 uncensored） | **API 不做网页端同等门禁**（官方原文） | 多个"NSFW samples gated"的 Illustrious/Pony 模型页 |
| **Replicate** | ⭐⭐⭐ 社区模型含 AnIllustrious v5、3 ControlNet + 2 LoRA | 灰：AUP 禁 "obscene... offensive content"，ToS 禁非合意/非法 | 逐模型自带 safety checker，部分可关 | [AnIllustrious Multi-ControlNet LoRA](https://replicate.com/mewforest/anillustrious-multi-controlnet-lora) 仍在；[anillustrious-v4](https://replicate.com/aisha-ai-official/anillustrious-v4) 默认 negative 就是 "nsfw, naked"（需自行改写） |
| **Civitai** | ⭐⭐⭐⭐ 动漫 NSFW 生态中心（Illustrious/NoobAI/Pony/Lustify） | Orchestration 有 `allowMatureContent` 明确开关 | 提示词被拦返回 `failed`+`blocked`；反复提交会被 muted | 全站 NSFW 生态 |
| **Runware** | ⭐⭐⭐ 400K 模型 + Civitai AIR 直连 | **未禁**（本轮逐条核对 ToS） | `safety.checkContent` + Content Safety API；拦截按"模型提供商准则" | civitai AIR ID 可直调 |
| **TensorHub** | ⭐⭐⭐ Illustrious/KREA 2 大模型库 | "更开放，但守儿童安全与名人肖像底线" | 未知 | 首页可见 Sexuality-Krea2Mix-Uncensored、黑犬兽等 |
| **NovelAI** | ⭐⭐⭐⭐ 自研动漫模型（nai-diffusion-5-full/curated） | 允许动漫 NSFW；禁写实 | 部分模型限 curated | 社区公认 nai4.5 在"无限制+二次元"下最强（上一轮） |
| **Venice** | ⭐⭐ wai-Illustrious / chroma / lustify 系 | "无内容过滤"官方定位 | `safe_mode` 默认 true 会模糊；`moderation: low` 可关 | $0.01/图的 WAI-Illustrious、Lustify v7/v8 |
| **Shakker** | ⭐⭐⭐ 含 NoobAI/Hassaku/WAI-illustrious 等 | **冲突**（多方称偏 SFW） | 未知 | 模型库托管 NSFW Illustrious 权重 |
| **Together AI** | ⭐ 无动漫 checkpoint（FLUX/SDXL 底座） | **明文禁 porn** | `disable_safety_checker` 开关存在但条款优先 | 无 |
| **RunPod** | ⭐⭐⭐⭐ 可跑任意 ComfyUI + 原版节点 | **ToS 明文禁 pornographic / graphic adult content** | 无平台过滤（但条款在） | 技术上完全可行 |
| **Modal** | ⭐⭐⭐⭐ 同上（Python/容器） | **ToS 禁 indecent or obscene material** | 无平台过滤（但条款在） | 技术上完全可行 |
| Shakker/其他 | — | — | — | — |

---

## 5. 与上一轮报告的口径冲突点（未解，供决策时留意）

1. **ModelsLab 分辨率口径**：文档写 width/height 256–1024 且被 8 整除，站点宣称 2048×2048 内不加价。（上一轮已记录，本轮未推翻）
2. **ModelsLab `safety_checker` 默认值**：不同端点默认值口径自相矛盾（enterprise text2img 示例 `"no"`、CommonImageGenerationParams `default: false`、部分文案写 "Default: yes"）。
3. **ModelsLab 免费额度**：FAQ 说"无免费"，unlimited 落地页写"Free 10 generations"。
4. **Replicate 免费额度**：官方"有限次数，不披露" vs 第三方 $5 / $500 / 未披露三种说法。
5. **Modal 是否必须先绑卡**：官方 billing 文档"必须" vs 多篇第三方"不用卡也能用 $30"（还有一份说无卡只有 $5）。
6. **Shakker 是否允许 NSFW**：评测说"条款限制 explicit"，模型库却托管 NSFW Illustrious 权重与 Pony V6。
7. **Civitai 卡付能否用于 NSFW**：2026-08-19 的"礼品会员可用卡付、含每月 Buzz" vs 2026-09-09 的"卡付只给 Green Buzz"。
8. **TensorHub 付款方式**：完全空白。
9. **Runware 成人内容政策**：RawSignal 与 18models 说"禁"，ToS 原文说"只禁涉未成年与真人无同意"。

---

## 6. 对前两份报告的更正 / 补充

| # | 前报告说法 | 本轮核实结果 | 证据 |
|---|---|---|---|
| 1 | RunPod / Modal 归为"平台无内容策略；由你自己决定" | **不准确**。RunPod ToS 把 "pornography or graphic adult content, images, or other adult products" 列入 unauthorized Content（可致立即终止 + 终身封禁）；Modal ToS 把 "contains indecent or obscene material" 列入 Prohibited Content。两家都**没有**成人内容豁免 | 【一手】两家 ToS 原文 |
| 2 | Runware 标注"18models 列为 Prohibited，未见其 AUP 原文，待复核" | **已复核并推翻**。Runware ToS 逐条核对后**没有**通用成人内容禁令（只有涉未成年、面向未成年人的 age-inappropriate、真人身份侵权）；且 ToS 第 8 节**明确把 UnionPay 列入可接受卡种** | 【一手】runware.ai/terms |
| 3 | Replicate"条款禁 NCII/非法色情/CSAM/极端血腥，**未禁止合意成人内容**；由各模型自带 safety checker 决定" | **需加限定**。Replicate **Acceptable Use Policy 明文禁止 "Distribution of obscene, defamatory, or otherwise offensive content"**；ToS 8.6 承认服务可产出 suggestive/pornographic/lascivious 内容并把责任推给客户；第三方政策追踪列为 "Not guaranteed / no written allowance" | 【一手】AUP + ToS；【二手】18models |
| 4 | Civitai"有 NSFW 需 yellow Buzz，`allowMatureContent` 显式开关" | **仍然正确，且本轮补全了机制细节**：blue→green→yellow 默认扣款顺序；`allowMatureContent:true` 强制黄 Buzz；blue/green 结算出成熟内容时 `upgradeMode` 决定扣住还是自动补差 | 【一手】Orchestration Submitting Work |
| 5 | Civitai"信用卡购买仅限 PG 站 civitai.green" | **域名已重组**：civitai.green 现 301→civitai.com；服务端配置 green.primary=civitai.com、red.primary=civitai.red；civitai.com/pricing 页面横幅写 "Unrestricted content creation has moved to civitai.red"；每档会员带 "Gift this tier" | 【一手】本轮实测 |
| 6 | Tensor.Art"主站转纯 SFW，NSFW 迁到 TensorHub，无每日免费" | **一致，且补充**：官方 Pro 页明确宣布"支持 Stripe"；TensorHub 的支付方式仍无法核实 | 【一手】tensor.art/event/proupdate |
| 7 | （未覆盖） | **新增**：Civitai 服务端出现 `emerchantpayPayments` flag（新的高风险友好型收单通道），但在 civitai.red 上另有 `disablePayments: true` | 【一手】页面内嵌配置 |
| 8 | RunPod 起步成本未量化 | **已量化**：最低充值 $10；起 Pod 需 ≥1 小时算力余额；默认 $80/小时消费上限；积分不可退不可提现；无 trial credits；连拒 3 次封 24h | 【一手】官方文档 + 帮助中心 |

---

## 7. 未核实 / 存疑清单（下一步实测建议）

1. **TensorHub 的实际支付方式** —— 必须注册登录后实测（云侧只看得到 Cloudflare 与 404）。这是十家里唯一完全没有答案的一项。
2. **Civitai「礼品会员用卡付款」拿到的 Buzz 是什么颜色** —— 直接决定"只有 Visa 能否在 Civitai 做 NSFW"。
3. **Civitai 是否真的在接 Emerchantpay 作为 NSFW 侧收单** —— flag 存在但 `.red` 侧 `disablePayments: true`，需要盯官方公告或实测支付页。
4. **Modal 是否接受不带信用卡的方式使用 $30 免费额度** —— 官方 billing 文档与第三方口径直接冲突。
5. **中国发行 Visa 卡在这十家的实测通过率** —— 官方文档只写"Stripe 风控/银行拦截"，无法从文档判断。RunPod 明确提示"连拒会封 24 小时"，**试错本身有代价**，建议优先级：Together（文书最明确）→ Runware（明列 UnionPay）→ Replicate → ModelsLab。
6. **Shakker 是否有未公开的 API** —— 官网 /api 返回 500，但这是服务端错误而非 404，理论上可能存在内部端点；建议直接发邮件问 billing@shakker.ai 或 contact@shakker.ai。
7. **Runware 实际能不能出成人内容** —— 合同层面未禁，但 Content Safety API 与 moderation error 的存在意味着**具体取决于所调模型**；建议用 `civitai:*` AIR ID 做一次小样本实测。
8. **Replicate 社区动画模型的存续风险** —— 官方保留随时移除模型的权利，且 18models 指出"视频模型多数默认开 safety checker"。

---

## 8. 来源清单

**RunPod**
- [Billing overview（支付方式表）](https://docs.runpod.io/accounts-billing/billing)｜[Troubleshoot payment card declines](https://docs.runpod.io/accounts-billing/manage-payment-cards)｜[Troubleshooting Payment Declines（帮助中心）](https://contact.runpod.io/hc/en-us/articles/41318080028819-Troubleshooting-Payment-Declines-on-Runpod)｜[How to Manage Funding Your RunPod Account](https://www.runpod.io/blog/manage-runpod-account-funding)｜[billing-information.mdx（GitHub 官方文档源）](https://github.com/runpod/docs/blob/72e717d5/references/billing-information.mdx)｜[pods/pricing.mdx](https://github.com/runpod/docs/blob/72e717d5/pods/pricing.mdx)
- [GPU 价格页](https://www.runpod.io/pricing)｜[RTX 4090](https://www.runpod.io/gpu-models/rtx-4090)｜[A100](https://www.runpod.io/gpu-models/a100)｜[Serverless 定价更新](https://www.runpod.io/blog/serverless-pricing-update)｜[ComputePrices 第三方价格表](https://computeprices.com/providers/runpod)
- [Terms of Service（成人内容条款原文）](https://www.runpod.io/legal/terms-of-service)｜[Security & compliance](https://docs.runpod.io/references/security-and-compliance)｜[Compliance 页](https://www.runpod.io/legal/compliance)｜[Startup Program](https://www.runpod.io/startup-program)
- [Serverless ComfyUI 教程](https://docs.runpod.io/tutorials/serverless/comfyui)｜[worker-comfyui](https://github.com/runpod-workers/worker-comfyui)｜[answeroverflow 用 Link 通过卡验证](https://www.answeroverflow.com/m/1466234473816260670)

**Modal**
- [Pricing（$30/月 免费算力）](https://modal.com/pricing)｜[Billing 文档（必须有 payment method）](https://modal.com/docs/guide/billing)｜[Budgets](https://modal.com/docs/guide/budgets)｜[Terms of Service（Prohibited Content 原文）](https://modal.com/legal/terms)
- 【二手】[RawSignal：Modal](https://rawsignalai.com/directory/developer-apis/modal)｜[buildaicurrent $30 免费层](https://buildaicurrent.com/credits/modal-free-tier/)｜[aicreditmart](https://aicreditmart.com/ai-credits-providers/modal-free-tier-how-to-get-30-month-in-compute-credits-2026/)｜[toolfreebie](https://toolfreebie.com/modal-serverless-gpu/)

**ModelsLab**
- [Pricing（含 "no free tier" FAQ、Agent 全自动开户）](https://modelslab.com/pricing)｜[Unlimited 页](https://modelslab.com/unlimited)｜[Stable Diffusion API 页](https://modelslab.com/stable-diffusion-api)｜[text-to-image-api-pricing-comparison](https://modelslab.com/text-to-image-api-pricing-comparison)
- [Billing and Wallet（三条支付路径 + 无头卡 tokenization）](https://docs.modelslab.com/agents-api/billing-and-wallet)｜[Subscriptions](https://docs.modelslab.com/agents-api/subscriptions)｜[官方 skills 仓库](https://github.com/ModelsLab/skills/blob/main/billing-subscriptions/SKILL.md)
- NSFW 证据：[anime-figure-style-illustrious-pony-sd1-5-v1-0](https://modelslab.com/models/modelslab/anime-figure-style-illustrious-pony-sd1-5-v1-0)｜[MeMaXL Flat Anime Noob/Illustrious/Pony](https://modelslab.com/models/modelslab/memaxl-flat-anime-style-noob-illustrious-pony-xl-v3-0-a-ponymagine)｜[Takeda Hiromitsu Style](https://modelslab.com/models/modelslab/takeda-hiromitsu-style-illustrious-pony-1-5-goofy-ai-v2-0)

**Replicate**
- [Prepaid credit](https://replicate.com/docs/topics/billing/prepaid-credit)｜[Billing](https://replicate.com/docs/topics/billing)｜[Pricing](https://replicate.com/pricing)｜[Try for Free 合集](https://replicate.com/collections/try-for-free)｜[Terms of Service](https://replicate.com/terms/)｜[Acceptable Use Policy](https://replicate.com/acceptable-use-policy)｜[Community Guidelines](https://replicate.com/community-guidelines)｜[Subprocessors（Stripe）](https://replicate.com/docs/topics/site-policy/subprocessors)
- [Prepaid credit 上线公告](https://replicate.com/changelog/2025-07-29-prepaid-credit)｜[下载发票公告](https://replicate.com/changelog/2025-10-08-download-invoices)｜[Metronome 客户案例](https://www.getmetronome.com/customer-stories/replicate)
- 动漫模型：[mewforest/anillustrious-multi-controlnet-lora](https://replicate.com/mewforest/anillustrious-multi-controlnet-lora)｜[aisha-ai-official/anillustrious-v4](https://replicate.com/aisha-ai-official/anillustrious-v4)
- 【二手】[18models 政策追踪（Replicate: Not guaranteed）](https://18models.ai/policy-tracker)｜[18models vs Replicate](https://18models.ai/compare/replicate)｜[getaiperks $500](https://www.getaiperks.com/en/ai/free-replicate-credits)｜[aicreditmart 免费层](https://aicreditmart.com/ai-credits-providers/replicate-free-credits-how-to-get-free-generations-2026-guide/)｜[yangmao.ai](https://yangmao.ai/en/deals/replicate-free-tier/)

**Civitai**
- [Buzz 官方教育指南（2023-10-16，含"2025-05 起 card 不再可用"）](https://education.civitai.com/civitais-guide-to-on-site-currency-buzz-%E2%9A%A1/)｜[加密货币购买指南（2026-04-01 更新）](https://education.civitai.com/civitais-guide-to-purchasing-buzz-with-crypto/)｜[礼品码指南（2026-04-01 停售）](https://education.civitai.com/civitais-guide-to-buybuzz-io/)｜[Yellow Buzz 终极指南（2026-09-09）](https://civitai.com/articles/33522/the-ultimate-guide-to-earning-for-free-and-buying-yellow-buzz-on-civitai)
- [Civitai Green 升级公告（2025-10-13，Blue 转 SFW-only）](https://civitai.com/articles/20211/civitai-green-gets-an-upgrade-important-changes-to-blue-buzz)｜[信用卡暂停公告（2025-05-20）](https://civitai.com/articles/14945/credit-card-payments-pausing-may-23-2025)｜[BuyBuzz.io 会员上线（2025-07-15）](https://civitai.com/articles/16798)｜[ZKP2P 上线并暂停（2025-09-04）](https://civitai.com/articles/19042)｜[Gift It or Earn It（2026-08-19）](https://civitai.com/articles/33871/gift-it-or-earn-it-two-new-ways-to-get-a-membership)｜[用户抗议文（2026-03-12）](https://civitai.com/articles/27206/removing-payment-options-removes-supporters)｜[红 Buzz 考古文](https://civitai.com/articles/26717/snooping-around-in-the-code-the-mystery-of-red-buzz)
- [Orchestration Submitting Work（三币种与 allowMatureContent）](https://developer.civitai.com/orchestration/guide/submitting-work)｜[Quick start](https://developer.civitai.com/orchestration/guide/getting-started)｜[Workflows](https://developer.civitai.com/orchestration/guide/workflows)｜[Buzz spend limits](https://developer.civitai.com/site/oauth/buzz-limits)｜[Memberships 定价页](https://civitai.com/pricing)（本轮实测抓取）｜[Buzz Terms](https://civitai.com/content/buzz/terms)
- 【二手】[DeepWiki: Civitai Payment Systems](https://deepwiki.com/civitai/civitai/6.3-payment-systems)｜[Decrypt 报道](https://decrypt.co/322197/civitai-crypto-credit-card-processor-ban-ai-explicit-content)

**Runware**
- [Terms of Service（第 8 节卡种含 UnionPay；prohibited use 全表）](https://runware.ai/terms)｜[Pricing（$2 企业邮箱注册额度）](https://runware.ai/pricing)｜[定价文档](https://runware.ai/docs/models-api/pricing)｜[认证文档](https://runware.ai/docs/models-api/authentication)｜[账户管理](https://runware.ai/docs/platform/account-management.md)
- [帮助中心: Payments and Credits（$20 最低充值）](https://help.runware.ai/articles/7648578038-payments-and-credits)｜[帮助中心: 使用限制](https://help.runware.ai/articles/6569725725-are-there-any-restrictions-on-how-i-can-use-runware)｜[帮助中心: content moderation error](https://help.runware.ai/articles/9032861662-what-does-a-content-moderation-error-mean)｜[Content Safety API](https://runware.ai/docs/models/content-safety)
- 【二手】[RawSignal：Runware](https://rawsignalai.com/directory/developer-apis/runware)｜[18models 政策追踪](https://18models.ai/policy-tracker)

**Together AI**
- [Payment methods 文档](https://docs.together.ai/docs/billing-payment-methods)｜[Credits 文档](https://docs.together.ai/docs/billing-credits)｜[Billing troubleshooting](https://docs.together.ai/docs/billing-troubleshooting)｜[Terms of Service（第 4 条禁 porn）](https://www.together.ai/terms-of-service)｜[Pricing](https://www.together.ai/pricing)
- 支持中心：[支付方式](https://support.together.ai/articles/7048797576-what-payment-methods-are-accepted)｜[Credit Packs（禁虚拟卡）](https://support.together.ai/articles/6180701933-what-are-credit-packs)｜[添加支付卡](https://support.together.ai/articles/6210233624-adding-your-payment-card)｜[自动充值](https://support.together.ai/articles/2024277723-how-can-i-auto-recharge-credits)
- 【二手】[RawSignal：Together AI](https://rawsignalai.com/directory/developer-apis/together-ai)｜[AIRIN 政策核查](https://airinetwork.com/platform/together-ai)

**NovelAI**
- [FAQ（Chargebee）](https://docs.novelai.net/en/faq/)｜[订阅文档（$10/$15/$25，30 张免费图，Anlas 清零规则）](https://docs.novelai.net/en/subscription/)｜[API 文档](https://api.novelai.net/docs)｜[Account 设置（Persistent API Token 取法）](https://docs.novelai.net/en/text/usersettings/account/)｜[支付处理商迁移公告](https://novelai.net/updates?id=payment-processor-update)｜[ToS](https://novelai.github.io/terms)
- 【二手】[checkthat.ai 定价与 FAQ 结构化数据](https://checkthat.ai/brands/novelai/pricing)｜[agn-ai 取 token 说明](https://github.com/luminai-companion/agn-ai/blob/dev/instructions/novel.md)｜[novelai-api 源码](https://github.com/Aedial/novelai-api/blob/main/README.md)｜[evertry（虚拟卡营销文）](https://evertry.co/blog/pay-for-novelai-trinidad-and-tobago/)

**Venice AI**
- [API Reference](https://docs.venice.ai/api-reference/api-spec)｜[x402 top-up 端点](https://docs.venice.ai/api-reference/endpoint/x402/top-up)｜[x402 指南](https://docs.venice.ai/guides/integrations/x402-venice-api)｜[Crypto RPC / 资金路径](https://docs.venice.ai/guides/integrations/crypto-rpc-agents)｜[billing/balance](https://docs.venice.ai/api-reference/endpoint/billing/balance)｜[图像生成端点](https://docs.venice.ai/api-reference/endpoint/image/generations)
- [Pricing](https://venice.ai/pricing)｜[新订阅档公告](https://venice.ai/blog/new-subscription-tiers)｜[x402 上线公告](https://venice.ai/blog/venice-now-supports-x402)｜[learn.venice.ai API 入门指南（API 仅 Pro 可用）](https://learn.venice.ai/guides/getting-started-with-the-venice-api-staking-keys-and-pricing)｜[更新日志 2026-03（Coinbase 支付链接）](https://featurebase.venice.ai/changelog/veniceai-change-log-march-7-2026-march-26-2026)｜[LinkedIn：Pro 支持月付 USDC](https://www.linkedin.com/posts/veniceai_venice-pro-now-supports-monthly-usdc-subscriptions-activity-7434691766093668352-3K71)

**Shakker AI**
- [Membership / 购买 FAQ（Stripe 卡种与不支持 PayPal）](https://www.shakker.ai/purchase)｜[Shakker 首页](https://www.shakker.ai/)｜[Shakker Wiki](https://wiki.shakker.ai/en/home)
- 模型页：[IllusioN-R NSFW Illustrious-XL](https://www.shakker.ai/modelinfo/0a3ff566374d4ecf9c4886d3096154dd/IllusioN-R-NSFW-Illustrious-XL)｜[WAI-illustrious-SDXL](https://www.shakker.ai/modelinfo/0f204323a06f40e18f8ffc5b1813df5a/WAI-NSFW-illustrious-SDXL)｜[Pony Diffusion V6 XL](https://www.shakker.ai/modelinfo/7b67c100c35f47fc8c39ae3033b82899/Pony-Diffusion-V6-XL)
- 【二手】[AIDIRECTORY](https://aidirectory.com/shakker)｜[aitools.fyi](https://aitools.fyi/shakker-ai)｜[toolify](https://www.toolify.ai/ai-news/shakker-ai-unleash-the-power-of-ai-image-generation-for-free-3700728)｜[aiimagegeneratornsfw 评测](https://aiimagegeneratornsfw.com/shakker-ai-nsfw-review-2026/)｜[aidigitalbox（称有 REST API，无链接）](https://aidigitalbox.com/2025/05/21/shakker-aistreaming-image-generator-with-specialized-models/)

**TensorHub / Tensor.Art**
- [Tensor.Art Pro 会员调整公告（宣称支持 Stripe）](https://www.tensor.art/event/proupdate)｜[会员条款](https://tensor.art/about/terms-of-vip-membership)｜[tensorhub.art（Cloudflare + SPA，本轮 camoufox 实测）](https://tensorhub.art/)
- 【二手】[ai.miraheze.org: Tensor.art](https://ai.miraheze.org/wiki/Tensor.art)｜[goongen: Tensor.Art NSFW 政策](https://goongen.ai/blog/tensor-art-nsfw-policy)｜[gallery-dl issue #8887](https://github.com/mikf/gallery-dl/issues/8887)｜[Lewdly 对比文](https://lewdly.ai/blog/lewdly-vs-tensorart-nsfw-ai-platform-comparison-2025)｜[GenFindr 评测](https://genfindr.com/review/tensorart)｜[Toolin.ai（中文）](https://toolin.ai/tools/tensorhub-art)｜[sexai.tools](https://sexai.tools/products/tensor-art-nsfw)｜[ainvasion](https://www.ainvasion.com/tensor-art/)｜[Pay2.House](https://pay2.house/payment_services/tensorart?hl=en)
- 同名加密项目（无关）：[TensorHub THUB tokenomics](https://tensorhub.gitbook.io/documentation/information/tensorhub-tokenomics)｜[Phantom 代币页](https://phantom.com/tokens/ethereum/0x7fed466b893c716235e1b8d685c913f7d2797463)

**通用参照**
- [Stripe 支付方式支持表（含 Alipay / WeChat Pay / UnionPay 的位置）](https://docs.stripe.com/payments/payment-methods/payment-method-support.md)
- [18models NSFW 政策追踪总表](https://18models.ai/policy-tracker)
