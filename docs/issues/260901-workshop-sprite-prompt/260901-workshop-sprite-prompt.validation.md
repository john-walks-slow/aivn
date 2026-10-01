# 验证：工坊出立绘的提示词与留痕

## 用户可验的部分（工坊真机）

| 场景 | 怎么验 | 期望 |
| --- | --- | --- |
| 立绘外貌跟角色卡一致 | 工坊「对话」里说「按角色卡给 <角色> 出一张 neutral 定妆照」，出图后看图 | 发色 / 发型 / 瞳色 / 脸上记号 / 上衣 / 领巾 / 裙 / 袜 / 鞋 / 手持物逐条对得上；agent 的汇报是逐条核对结论，不是一句「已按设定完成」 |
| 后缀不再改发型 | prompt 明写「腰际长直发」，出的图仍是长直发 | 不出现双马尾 |
| neutral 不覆盖 normal | 已经有过 normal 的角色再出一次 neutral | play.json 多一个 `neutral` 键，两张图并存；`normal` 不被动 |
| 出图记录留痕 | 出完图看剧目目录 `assets/generated.json` | 有 `koharu/neutral` 一条，含当次实际发给模型的 prompt 原文与时间；工坊补完中文描述后这条仍在 |
| 出图记录能被 agent 读到 | 工坊里说「重出小春的 neutral」 | agent 先 `read_file assets/generated.json`，在上一版 prompt 基础上改 |
| 失败转述 | 把生图地址改成一个会失败的（如空 token 的网关）再出图 | agent 把接口原文（状态码 + 原文）转述给用户，不只是「服务不可用」 |
| CG 台账摊开 prompt | 工坊生成一张 CG 后打开 CG 视图 | 那张卡的角标是「站内生成」，并摊开 prompt 原文 |

## 已验（2026-10-01）

- **单测**：apps/server `playAssets` 20 例（含新增 4 例：台账键与内容、台账与描述表互不覆盖、并发出 6 个差分记账一条不少、后缀不含任何发型词）、`http` 12 例（新增 2 例：台账 prompt 进 CG 台账、图删了的条目不算数）、`prompt` 22 例（新增：两套键约定按字段合并）、`workshop` 39 例（新增：四条硬规则 + 台账规则都在提示词里）、`store` 10 例、`provider` 3 例（新增：api 恒为 OpenAI 兼容面）；apps/web 64 例；packages/core `assets` 12 例。全绿。
- **类型检查**：`pnpm -r typecheck` 三包 Done；`node scripts/check-encoding.mjs <改动文件>` 通过。
- **真机（无头驱动工坊 WS）**：
  - 小春 neutral 重出（覆盖）——图与角色卡逐条对上：粉发腰际长直发、白缎带、琥珀褐眼、泪痣、藏青水手服 + 藏青领巾、白百褶裙、黑过膝袜、棕色乐福鞋、颈上银黑相机、2D 平涂（读图核对，非 agent 自述）。
  - agent 按新规则先 `read_file assets/generated.json` 再出图。
  - 网关 429（额度耗尽）时，agent 原话转述：「生图失败：Gemini 出图失败 HTTP 429：`You have exhausted your capacity on this model. Your quota will reset after 1h39m5s.`」
  - **出图留痕（换成 flow2api 生图后端重跑一次）**：`plays/demo/assets/generated.json` 落盘一条 `koharu/neutral`，含当次实际用的 prompt 原文（含拼上去的定妆照后缀）；同轮 `git diff plays/demo/assets/manifest.json` 为空——工坊补描述不再冲掉引擎的记录。两条要求都在真链路上成立。
  - **视觉模型自查闭环**：工坊模型设为 `gemini-3-flash` 后跑一轮——出第 1 版 → `inspect_asset` 看图 → 指出泪痣位置偏、相机挂带断、领巾简陋 → 改 prompt 出第 2 版 → 再看图 → 交出逐条对照表。它能看到图上才有的细节（泪痣在哪只眼下方），闭环成立。
  - **舞台观感**：1280x800 与 412x839 两个视口截图，立绘站位/比例/台词条关系正常，无穿帮；抠底边缘按批次波动（半透明边缘像素占比 0.9%–3.8%，最差那批出现白色衣袖半透明渗漏）。

## 待验

- 真机生成一张 CG，确认 CG 视图摊开的是 `assets/generated.json` 那条 prompt。
- 工坊补描述后素材页副标题显示该差分的描述（裸键回落那条路径在真机上还没走过）。