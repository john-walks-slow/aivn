# 检视报告

## 概要

本次检视覆盖 `dsh-aivn` 插件（对标 AIVN 工坊角色能力与提示词机制审视）**阶段 1** 的全部工作区改动（包含能力面模型、搭台助手 persona、系统提示词注入段、Fish 音色库客户端与工具、Exa 检索客户端与工具、随包技能库、工具迁移与重命名、剧作家提示词审视、README 双语更新及端到端测试）。
总体评价：**实现规范、边界清晰、需求对齐完整**。代码重构符合模块职责划分，双角色预设及提示词中的机制承诺均能精确对齐到真实工具与注入点，且已通过全套 TypeScript 编译、esbuild 打包及真实 e2e 套件验证。检视中未发现阻塞级缺陷，仅发现若干处利于长期维护与提示词自文档性的建议及非阻塞项。

## 需求对齐

检视核对了计划文档（`261006-workshop-parity.plan.md`）与验证记录（`261006-workshop-parity.validation.md`），变更严格满足阶段 1 目标：
1. **能力面与预设**：`resolveCapabilities` 收敛为 `shell` / `voice` / `search` 三个动态配置位，预设行集按能力组装，剧作家与搭台助手工具完全隔离。
2. **工具迁移与去歧义**：`get_readiness` 与 `set_craft` 成功移至搭台助手；原剧作家 `list_library` 正式重命名为 `list_assets` 并向双角色开放，消除了跨剧目资源库的歧义。
3. **提示词与机制审视**：剧作家提示词中 4 处无对应机制的悬空承诺已按计划彻底剥离；搭台助手 14 章 persona 均按 DSH 插件运行环境事实重写，未引入虚构界面或机制。
4. **范围控制**：严格按拍板决策将应用级素材库、周目与分支树（lineage）排除在外，生图与 BGM 亦如期留待阶段 2。

## 阻塞问题

无。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| - | - | 无 | 无 |

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1  | `src/stagehand/prompt.ts:125-126` | **搭台助手 persona 中提及了角色卡上的 `voice` 字段，但在配置了 `voice` 能力时未引导调用 `list_voices` 工具**。persona 中仅在角色卡说明里提到 `voice` 是音色 id，并在末尾提到“最后配素材与音色”，但并未像 `set_craft` 或 `list_assets` 那样明确告知“挑音色用 `list_voices` 查询”，导致模型可能仅从已有上下文猜测音色 id。 | 建议在 `stagehandPrompt` 的角色卡或音色相关段落中，当 `can.voice` 为真时，追加一句话提醒：“挑音色用 `list_voices` 查询（id 是 hex 串，按人设挑），填进角色卡 frontmatter 的 `voice` 字段”。 |
| S2  | `src/stagehand/prompt.ts:75`, `src/tools/list-assets.ts:66` | **「现在没有生图工具」文案在阶段 2 将面临修改扩散**。当前在 persona `setupFlow`、`assetGuide` 以及 `list_assets` 工具回执中均硬编码了“现在/本阶段没有生图工具”。进入阶段 2 引入 `generate_image` 后，如果遗漏工具回执等散落文本，会导致回执与能力矛盾。 | 建议在阶段 2 重构出图部分时，统一将素材引导文案与能力位（如 `can.image`）关联，避免工具回执与提示词出现多处硬编码。 |
| S3  | `src/stagehand/exa.ts:47-48`, `src/stagehand/voice-catalog.ts:127-133` | **网络请求超时 AbortSignal 建议统一防护未捕获的 TimeoutError**。`AbortSignal.timeout(TIMEOUT_MS)` 超时在 Node.js 中会抛出 `TimeoutError`（继承自 `DOMException`），`Exa.search` 的轮询逻辑将其捕获并归入 `lastError` 后重试其他 key，但对于纯网络超时，换 key 依然可能全部耗时较长（30s * N）。 | 建议在多 key 轮询遇到连续超时或非 key 认证相关错误时，若已探测到是网络不通/DNS 解析失败，可做短路或明确日志记录，避免无效耗时。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1  | `src/stagehand/tools/get-readiness.ts` | **搭台助手的 `get_readiness` 在静态 persona 中未显式提及**。虽然在《当前状态》注入段中每轮都会自动带上就绪自查报告（`readiness`），且工具本身已注册给搭台助手，但搭台助手的 persona 文本并未提及这个工具名（而剧作家之前曾教过它调用）。虽然模型在工具列表能看到它，但 persona 中稍微点一句（例如“备料过程中随时可调用 `get_readiness` 检查开演条件”）会更符合直觉。 | 可在 persona《设定流程》或《职责边界》顺手提一句 `get_readiness`，强化主动调用意图。 |
| N2  | `src/stagehand/context.ts:68` | **工作区目录扫描深度硬编码为 3**。`walk(..., depth = 0)` 中注释写明 `depth < 3` 足够看清 `assets/sprites/<主体id>/<差分>.png`。但若用户在 `memory/index/<层>/<子目录>/` 下有多级嵌套，或者素材子目录较深，第 4 层文件会被跳过。 | 阶段 1 目前结构足够；若未来支持用户自定义任意深度记忆卡层级，可考虑将深度放宽至 4 或对 `memory/` 与 `assets/` 分开设置。 |
| N3  | `package.json:26-27` | **`package.json` 中的 e2e 脚本可补充 stagehand 入口**。当前脚本有 `"e2e:stage"`，可考虑补充 `"e2e:stagehand": "dsh-e2e run e2e/run.mjs stagehand"`，方便日常一键单跑新套件。 | 在 `package.json` 的 `scripts` 顺手加一条 `e2e:stagehand`。 |

## 准入结论

**结论**：`准入`

**说明**：阶段 1 改造严格达成了架构解耦、工具分权、提示词真机制映射和随包技能注入的目标，代码实现干净扎实，无任何阻塞问题；建议修改项均属于提示词体验细节与后续阶段可顺手完善的点，不阻碍本阶段合入与交付。
