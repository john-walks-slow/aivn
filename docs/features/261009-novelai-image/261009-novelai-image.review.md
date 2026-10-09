# NovelAI 生图格式 · 检视报告（261009）

## 概要

检视范围：worktree `.worktrees/novelai-image`（分支 `feat/novelai-image`）相对 `main` 的全部改动——新增
`apps/server/src/novelaiImage.ts`（255 行）与 `apps/server/test/novelaiImage.test.ts`（148 行），改动
`imageFactory.ts` / `imageBackend.ts` / `config.ts` / `apps/web/src/api.ts` / `SettingsScreen.tsx` / `README.md` /
`apps/server/AGENTS.md`，以及 research / plan 两份文档。外部事实按调研文档引到的来源逐条复核（UKB、
dev.to V5 直连实测、NAIWeaver、novelai-bridge 源码、novelai-sdk-unofficial），关键结论与实现一致。

整体评价：结构与既有三款后端同形（构造器注入 fetch、白名单自校验、错误报文带上游 message），注释带出处，
画布「按面积展开 → 对齐 64 → 朝 3,145,728 像素预算收缩」的算法与独立实现 novelai-bridge 的
`normalize_canvas_area` 同构，测试覆盖了分代 / 解包 / 画布 / 多垫图 / 错误报文。可以合并的基础是扎实的；
**唯一硬伤是「img2img 参考图未做任何规范化」这条未经真机验证的假设压在差分主路径上**（见阻塞问题 B1），
其余为文档漏改与若干可查性/预期管理问题。

## 需求对齐

- **计划决策 1–6 全部落地**：img2img 单张垫图且多张报错（决策 2）、按模型名前缀分代且 v4_prompt /
  v4_negative_prompt 成对（决策 4，且与 dev.to 实测「缺一个回 500 而非 400」一致）、档位当面积 + 64 对齐 +
  像素预算（决策 3）、无新增设置项（决策 5）、fflate `unzipSync` 解 ZIP 且解不出即报错（决策 6）、
  未走只支持 V4.5 的 Precise Reference（决策 1，与 novelai-sdk 特性表「Character Reference 仅 V4.5」一致）。
- **端点与认证复核通过**：`POST {base}/ai/generate-image` + `Authorization: Bearer <pst- token>` + JSON body，
  响应是内含 `image_0.png` 的 ZIP；`api.novelai.net` 对生图回 `model must be a valid enum value` 的说法有
  两个独立来源支撑。字面像素必须 64 的倍数、单图 3,145,728 像素，与官方 2023 公告及 novelai-bridge 的
  `MAX_IMAGE_PIXELS` 逐值相同。
- **落点清单基本命中**：`configApi.ts` 经复核确实不需改（`image` 整块复用 `ServerConfig["image"]`）；
  `config.test.ts` / `configApi.test.ts` 里的 format 用例不枚举白名单，不会被这次扩展打红。
- **偏差**：plan 的落点清单写了 `docs/features/261009-novelai-image/*` 要产出 `summary`，目前只有
  research / plan（非阻塞 N6）。plan 里的用户侧验收项「设置页字段提示与示例自洽」当前**不成立**——设置页
  「垫图策略」hint 还写着「gemini 与 modelslab 格式有效」（建议修改 S2）。
- **未越界**：未触碰 `packages/core` / `packages/stage` / `ImageRequest` 契约 / `PlayAssets`，因此不触发双边验证。

## 阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B1 | `apps/server/src/novelaiImage.ts:125-130`（`parameters.image = refs[0]!.data.toString("base64")`） | **参考图既不按目标画布 fit，也不区分光栅格式**，而这正是差分主路径的垫图。三点证据：① 本次调研文档自己写明「官方与主流客户端都会先把源图缩放到目标画布再发」，实现没做；② 独立实现 novelai-bridge 在 `build_img2img_wire_parts` 里明确调用 `fit_source_image("img2img.image", …, params.core.size)`，其文档注释写着 "fits image inputs to the requested canvas"；③ NovelAI 文档把 `parameters.image` 定义为 base64-encoded **PNG**，而实现只把字节 base64、完全不看 `ref.mimeType`。而实际传入的参考图很可能两头都对不上：立绘差分的首选垫图是 `media-cache/sprite-sources/<id>/neutral.jpg`（后端回来的原片多为 JPEG），背景/CG 的显式参考图还可能是 webp/gif（`PlayAssets.loadReference` 用 `sniffImageMime` 认四种格式）。现有测试用 1×1 的 PNG 假数据，把这两个差异全遮住了。 | 二选一，别停在假设上：①（推荐）发请求前做规范化——用已在 `apps/server/package.json` 依赖里的 `sharp` 把参考图按画布缩放（cover）并统一编码 PNG 再 base64，与 novelai-bridge 同形，顺手把 mimeType 差异一起消化，代码约 10 行、落在 `generate()` 的 `refs.length === 1` 分支里；② 如果刻意不规范化，就用一次真实请求验证「JPEG 源图 + 与画布不同尺寸」上游照常出图，把结论写进类注释与 README，并至少用 `sniffImageMime`（`src/imageMime.ts`）在发请求前拒掉非 PNG 参考图、给出可读报错。若真机确认上游自己会 fit 且收 JPEG，本条可降级为建议修改。 |

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | `README.md:401`（「工坊出图」小节 · 垫图那一条） | 同一份 README 里两处口径打架：字段总表与新增的对比表都写了 `novelai` 能垫图，这一节却仍写「`gemini` 与 `modelslab` 格式下可用」。用户判断「我选的格式能不能垫图」时会读到错答案。 | 改成「`gemini` / `modelslab` / `novelai` 格式下可用」，并按 novelai 的实际口径补一句：只吃一张、走 `img2img`（不是参考图入参）、出图画布仍由我们定（与 modelslab 的「画幅随垫图走」正相反）。 |
| S2 | `apps/web/src/views/SettingsScreen.tsx:375`（垫图策略 hint）；同页 `:385`（出图档位 hint） | 设置页两个 hint 都没跟上新格式：垫图策略仍写「gemini 与 modelslab 格式有效」——这条正是 plan 里点名的用户验收项，现在照截图验收就是不合格；档位 hint 也没提 novelai 的字面像素必须 64 的倍数（用户照提示填 `1920x1080` 会在等图前报错）。 | 垫图策略补 `novelai`（并带一句「novelai 走 img2img，一致性强度弱于 gemini」的预期管理）；档位 hint 补「novelai 要求两边都是 64 的倍数」。 |
| S3 | `README.md`（novelai 示例段附近） | **没有提 NovelAI 官方 API 的自动化限制**。调研引用的官方 UKB 原文写明「requests should be sent by users, and never automatically through a script」「all requests should be done one request at a time」，并列出账号永久终止的后果；而本引擎恰恰是全自动发起（剧作家预发射 + 立绘差分自动派生），且 `image.concurrency` 默认 6。用户拿自己的官方账号接上去，是「不知道自己踩了什么」的那种风险。 | 在 README 的 novelai 示例/对比表附近用一两句写清这条约束（不自动、一次一个请求、违规后果），并提示这一格式下应把 `image.concurrency` 压到 1、只在自己动手的操作里出图；是否进一步做「novelai 格式强制串行」由你决定（本报告不要求实现）。 |
| S4 | `apps/server/src/novelaiImage.ts:240-243`（`unpackImage` 的返回值） | 两个小隐患：① `mimeType` 无条件写死 `"image/png"`，而落盘扩展名由 `extOf(mimeType)` 决定——上游哪天回 JPEG（或 ZIP 里放的不是 PNG），就会写出「`.png` 后缀 + JPEG 字节」的裂图，且看不出错因；② 取文件用 `Object.keys(files).sort()[0]`，ZIP 里若混入目录项或别的文件会照取第一个。 | 用仓库现成的 `sniffImageMime`（`src/imageMime.ts`）认了字节再决定 mimeType（认不出退回 `image/png`），并把取文件改成显式找 `image_0.png`（找不到再退回排序第一个），把「为什么这么取」写进注释。 |
| S5 | `apps/server/src/novelaiImage.ts:166-175`（`promptStructure` 的 V4+ 分支） | V4+ 只发 `v4_negative_prompt`，没发 `uc`。调研说 V4+ 读的是 v4 结构，但成熟客户端 NAIWeaver 对 V4.5 是 `uc` 与 `v4_negative_prompt` **同时发**。若上游实际读 `uc`，我们的负面词会被静默忽略——正是那种「不报错、只是画质差一点」的错。 | 两处都带上（`promptStructure` 的 V4+ 分支里加 `uc: NEGATIVE_PROMPT`，与 V4 结构共存无害），或真机用同一 seed 各出一张比对后把结论写回注释。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `apps/server/test/novelaiImage.test.ts:102` | 用例名「只取第一张且多张直接报错」名实不符（实现是 >1 张直接报错，不取第一张），后来者按名字读会误判行为。 | 改成「多张垫图直接在请求前报错」。 |
| N2 | `novelaiImage.test.ts` 整体 | 两个最容易出事的分支没有用例：参考图是 JPEG（当前实现忽略 mimeType）、ZIP 里含目录项/非 `image_0.png` 文件。 | 补两条假 fetch 用例；顺带覆盖「字面像素优先于 opts.size 档位」。 |
| N3 | 枚举书写顺序 | 四处不一致：`config.ts` / `apps/server/AGENTS.md` 写 `gemini\|openai\|modelslab\|novelai`，README 对比表列序与设置页下拉是 `gemini\|modelslab\|novelai\|openai`。无功能影响，但逐项对照时容易看漏一格。 | 统一一个顺序（建议与设置页下拉一致），四处照抄。 |
| N4 | `apps/server/src/novelaiImage.ts:57-61` | 常量注释写「官方站点默认：采样器 k_euler_ancestral、**28 步**、CFG 5、karras」，而调研文档自己写了 V5 默认 23 步（novelai-sdk 实测默认也是 23）。注释与调研轻微打架。 | 注释写成「V4/V4.5 官方 28 步、V5 官方 23 步；本层统一 28（≤28 步落在 Opus 免费带内）」。 |
| N5 | `apps/server/src/novelaiImage.ts:113`（`qualityToggle: true`） | 上游会据此在提示词后追加 `masterpiece, best quality, very aesthetic, absurdres`，而工坊提示词本身常已带 quality tag；dev.to 实测的官方 V5 body 用的是 `qualityToggle: false`。重复不会报错，但会稀释 tag 权重。 | 真机出一张带与不带各一张比对，按结果把它固定下来并写明理由。 |
| N6 | `apps/server/src/novelaiImage.ts:64`（`IMG2IMG_STRENGTH = 0.7`） | 0.7 对「表情差分」偏激进（差分要的是同一个人微调表情，0.4–0.5 通常更能锁住身份），且 img2img 的一致性强度与 V4.5 的 Precise Reference 不是一个量级。常量本身是刻意的设计决策，但用户容易期待过高。 | README 的 novelai 段补一句预期管理（差分一致性会明显弱于 gemini 的 `inlineData` 路线）；strength 值可留待真机调一次再定。 |
| N7 | `README.md` novelai 示例段 | 没提成本：立绘固定 `minTier: 2K` → novelai 画布 1152x2048 = 2,359,296 像素，超出 Opus 免费带（≤1,048,576 像素且 ≤28 步），**每张立绘都会烧 Anlas**（1K 背景/CG 恰好 1,032,192 像素，仍在免费带内）。 | 示例段补一句「立绘 2K 会消耗 Anlas，1K 背景/CG 在免费带内」。 |
| N8 | `docs/features/261009-novelai-image/` | plan 的落点清单里写了 `summary`，目录下只有 research / plan；按项目文档规范还应有一份 `validation.md`（本需求涉及真实外部 API，正是需要用户实机验收的那类）。 | 检视通过后补 `validation.md`（含 B1 的真机验证项）与 `summary.md`。 |
| N9 | 兄弟发行线 `dsh-aivn` | DSH 侧的生图后端是另一份实现（`src/media/*-image.ts`，见 `docs/features/261006-aivn-image-parity/`）。本次只在 AIVN 侧加了第四种格式，两条线的格式面从此不对齐。 | 仅记备忘：是否同步属另一条发行线的决定；若不同步，建议在 parity 审计文档里记一笔「AIVN 已支持 novelai，DSH 未支持」。 |

## 准入结论

**结论**：`不准入`

**说明**：实现质量与文档完成度整体不错，计划决策逐条落地，外部契约也复核得住；但 B1（img2img 参考图既不按画布 fit、
也不区分 PNG/JPEG）是**未经任何真机验证的假设，且正压在本次功能的主路径（立绘差分垫图）上**，而实际传入的
参考图很可能就是 JPEG 且与画布不同尺寸。请先用 `sharp` 把参考图规范化（约 10 行，依赖已在）**或**用一次真实请求
确认上游自己会 fit、也收 JPEG，二者完成其一后重新检视；同时把 S1/S2 两处漏改的文档与设置页提示一并修掉（这两条
直接对应 plan 里点名的用户验收项）。改完 B1 且 S1/S2 落地即可转为准入。

---

## 复审（第 2 轮）

复审对象：第 1 轮 B1 / S1–S5 的处置，以及对新增改动的检视。范围 = 当前 `git diff main`（`README.md` 55 行、
`SettingsScreen.tsx` 7 行、`novelaiImage.ts` 与 `novelaiImage.test.ts` 的新增内容）。

### 逐条复核

| ID | 结论 | 复核依据 |
| --- | --- | --- |
| B1 | **已修复** | `novelaiImage.ts:132-137` 的 img2img 分支改为 `parameters.image = await fitToCanvas(refs[0]!.data, canvas)`；`fitToCanvas`（:242-251）走 `sharp().resize(canvas.w, canvas.h, { fit: "contain", background: {r:0,g:0,b:0,alpha:1} }).png()`——先算画布再发请求、等比缩放、居中、补不透明黑、统一编码 PNG，正是我要求的「按画布规范化 + 收格式差异」。测试从假数据升级为真断言（1×1 PNG 垫图 → 出来必须是 1344×768 且 `sniffImageMime` 认作 PNG；JPEG 垫图也必须变 PNG），遮住问题的那个缺口补上了。补一句证据边界：parent 引的 novelai-bridge `fit_image_to_canvas` 注释原文我没能独立取到（docs.rs 源码页只回 JS 壳、crates.io API 403），但这条修复不依赖它——官方文档把 `parameters.image` 定义为 base64 **PNG**、调研文档自己写了「客户端都会先把源图缩放到目标画布再发」、而实际垫图确实是 JPEG 原片，三点足以支撑「发请求前规范化」这个动作；我在 novelai-bridge 的 `generate.rs` 源码里也确认了 `build_img2img_wire_parts` 会按 `params.core.size` 调 `fit_source_image`。 |
| S1 | **已修复** | `README.md:407` 改成「`gemini` / `modelslab` / `novelai` 格式下可用」，并补了 novelai 与 modelslab 的**相反**口径（modelslab 画幅随垫图走 / novelai 画布仍由我们定、引擎会把垫图缩放补边）。 |
| S2 | **已修复** | 设置页「垫图策略」hint 补上 novelai（`SettingsScreen.tsx:375`）、「出图档位」hint 补上「novelai 格式要求两边都是 64 的倍数」（:391）——plan 里那条用户验收项现在站得住了。 |
| S3 | **已修复** | README 的 novelai 注记后补了两段：官方《Using the API》的**自动化限制**（请求应由用户发起、一次一个请求、违规可能终止账号，并给出「跑批量实验把出图并发调到 1」的可操作结论）与 **Anlas 免费带**（1K 背景/CG ≈1,032,192 像素在带内、立绘 2K ≈2,359,296 像素每张必扣）。风险提示与可操作口径同时到位。 |
| S4 | **已修复** | `unpackImage`（:258-277）改成：ZIP 解出的条目**按扩展名挑图片**、mime 用现成的 `sniffImageMime` 从字节认（不再写死 `image/png`），不是 ZIP 时退回「整段就是一张图」，两者都不是才报错；测试覆盖了 ZIP 内无图片条目、整段是图、垃圾字节三条分支。落盘扩展名错配（`.png` 装 JPEG 字节）的隐患消除。 |
| S5 | **复核后接受保留原样** | parent 给的对，我撤回第 1 轮的担心。独立验证：novelai-bridge 的 `build_prompt_wire_parts` 里，`uses_v4_prompt()` 的模型 return `legacy_uc: None`（`generate.rs:800`），而 wire 字段 `uc: prompt.legacy_uc`（:602）只有 legacy 分支才被填成 `Some(negative_prompt)`（:830）——即 V4/V4.5/V5 **都不发 `uc`**；V5 直连实测的官方 200 请求体里同样只有 `negative_prompt` 而没有 `uc`。我们的实现与官方客户端 + 一个成熟第三方实现一致，负面词也经 `negative_prompt` 与 `v4_negative_prompt` 两路发出，「会被忽略」缺证据。保留原样是正确的。 |

### 新增 / 遗留问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| R1 | `apps/server/AGENTS.md:162`（「生图配置」一节） | 模块指引只写了 novelai 的「Bearer 持久化 token、响应是 ZIP、画布必须 64 的倍数」，**没写第 2 轮才补上的那条铁律**——「图生图源图必须先 fit 到目标画布并编码 PNG」正是那种「不写下来、下一个人就会踩」的上游约束（modelslab 那三条口子就是这么被记下来的）。目前它只活在 `novelaiImage.ts` 的类注释与 README 的一个 bullet 里。 | 在那句后面补半句：「`novelaiImage.ts` 的垫图会先用 sharp 把源图 contain 到画布、补不透明黑并转 PNG——上游要的是与画布同尺寸的 base64 PNG，我们的垫图常是 JPEG 原片」。 |
| R2 | `apps/server/src/novelaiImage.ts:242-251` | `fitToCanvas` 用 **contain 补边**，补边只在「参考图画幅 ≠ 本次画布」时生效；生效时那圈黑边会被 img2img 带进成图，而立绘路径最终要过纯色键抠底（键色是绿/品红）——**黑边同样是一种「会被当成底色抠掉」的颜色**（黑发/黑衣可能被抠穿），只是概率远低于第 1 轮那个「完全不规范化」的场景（差分路径的参考图与画布通常同为 9:16，补边量为 0；只有用户拿一张异画幅图当 neutral 基准时才会出现）。 | 不必现在改。建议把这条限制写进 `fitToCanvas` 的注释（说明「补边色是折中：补边只发生在异画幅参考图上」），供日后真出问题时定位；真要根治可对 sprite 路径改用 `fit: "cover"` 裁切（无补边，代价是裁掉边缘内容）。 |
| R3 | 四处枚举书写顺序 | **第 1 轮 N3 未处理**：`config.ts:65` / `apps/server/AGENTS.md:162` 写 `gemini\|openai\|modelslab\|novelai`，README 对比表列序与设置页下拉是 `gemini\|modelslab\|novelai\|openai`。无功能影响。 | 统一一个顺序，四处照抄（下次改这块时顺手做即可）。 |
| R4 | `novelaiImage.ts:64`、`:120` | **第 1 轮 N4 / N5 未处理**：注释写「官方站点默认…28 步」，而 V5 官方默认 23 步（调研文档与 novelai-sdk 都是 23）；`qualityToggle: true` 与官方实测的 V5 请求体（`qualityToggle: false`）相反。两者都不会报错、只影响成图细节。 | 注释补「V4/V4.5 官方 28 步、V5 官方 23 步，本层统一 28」；`qualityToggle` 留待真机各出一张比对后固定并写明理由。 |
| R5 | 设置页垫图策略 hint / README novelai 注记 | **第 1 轮 N6 的预期管理只做了一半**：README 对比表写了「强度固定 0.7」、也写了没走 Precise Reference，但没有一句直白的「novelai 的差分一致性会明显弱于 gemini（img2img 0.7 vs 参考图入参）」。用户从 gemini 切过来时这是最可能的预期落差。 | 在那两处任选一处补一句，例如「要最强的角色一致性还是 gemini / V4.5 的 Precise Reference」。 |
| R6 | `docs/features/261009-novelai-image/` | **第 1 轮 N8 未处理**：目录下仍只有 research / plan / review，缺 `validation.md` 与 `summary.md`。本需求碰真实外部 API，`validation.md` 尤其必要（第 1 轮 B1 的教训就是「不打真 API 就无法自证」）。 | 补 `validation.md`：至少包含「真机出一张 1K 背景」「真机出一张 2K 立绘差分（JPEG 原片垫图）」两条用户可执行的验收项。 |
| R7 | 兄弟发行线 `dsh-aivn` | **第 1 轮 N9 未处理**（备忘）：DSH 侧生图后端是另一份实现，格式面从此不对齐。 | 仅记备忘，不属本需求。 |

### 本轮新增检查

- `sharp` 引入到生图后端没有问题：它本来就是 `apps/server` 的依赖、`cutout.ts` / `selftest.ts` 已在用，打包链路与并发（默认 6）都吃得下；`fitToCanvas` 只在 img2img 这一条路上跑一次，相对出图本身的耗时（数十秒）可忽略。
- 新 `unpackImage` 的分支顺序没有回归：ZIP 正常 → 取第一条图片；ZIP 内只有 `readme.txt` → 落到「整段是图」判定失败 → 报「ZIP 里没有图片条目」；HTML/垃圾字节 → 报「既不是图片也不是 ZIP」；Fake 数据与断言一致（未运行测试，按代码与用例逐条推演）。
- 第 1 轮的其余结论未受影响：端点/认证/ZIP、v4 结构成对、前缀分代、64 对齐与 3,145,728 预算、`config.ts` / `api.ts` / 设置页四处同步、未触碰 `packages/core` / `packages/stage`。

## 准入结论（第 2 轮更新）

**结论**：`条件准入`

**说明**：第 1 轮唯一的阻塞项 B1 已按建议修复（img2img 垫图先 contain 到画布、补不透明黑、统一编码 PNG，
并补了会真断言的测试），S1–S3、S4 全部落地，S5 经复核由我撤回（保留原样是正确的）。代码层面已无阻塞问题，
可以合并；剩余 R1–R7 均为文档/注释完备性与预期管理项，其中 **R1（模块指引补记 fit 铁律）与 R6（补 `validation.md`）
建议在合并前后当次处理**——前者防止这条上游约束只活在单个文件里，后者补上「不打真 API」留下的验证缺口
（真机各出一张 1K 背景与 2K 立绘差分即可关闭）。
