# dsh-aivn 提示词透明化 · 现状审计（研究）

> 需求（2026-10-07）：「现在有多少提示词是写在 skill 里，有多少提示词是 hardcode 在代码，有多少提示词
> 是以某些形式可以编辑的？我希望提示词更加透明，易于维护…」
>
> 本文件是**证据快照**：三层盘点、逐章归属、三方重复点。**常青真相源（分层规约 / 门控规则 / 提示词地图）
> 在 dsh-aivn 的 `AGENTS.md`「提示词地图」一节**——改提示词先看那里，本文件只用于回溯当次的判断依据。

## 1. 三层盘点（结论）

| 层 | 可编辑性 | 位置 | 生效条件 |
| --- | --- | --- | --- |
| **Skill**（3 份，约 376 行） | 纯 markdown，改完即生效 | `skills/aivn-play-setup/`、`aivn-visual-craft/`、`aivn-audio/` | 宿主把 name+description 列进 `<available_skills>`，模型按需 `skill` 加载全文 |
| **persona + 注入段** | 硬编码 TS，改完必须 `npm run build` | 见 §2 | 经 `lib/index.js` 装载；`persona.prefix` 装载时烘焙，`systemPrompt.section` 每轮现读 |
| **运行期剧目文件** | 用户直接编辑 | `premise.md` / `craft.md` / `play.json` / `characters/*` / `memory/*` / `assets/manifest.json` / `theme.json` | 条件化渲染进 A 区注入；属**内容**不是提示词本体 |

**没有任何提示词可由插件 config 覆盖**：`src/index.ts` 的 `Config`（L85-139）只有 TTS / 生图 / 音乐 /
检索 / 命令行 / 工具禁用项，无提示词项。

## 2. 逐章归属（当次判断依据）

判据：**P=留 persona**（每轮必读 / 身份契约 / 被引用锚）｜**S=正文下沉 skill，persona 留门控指针**｜
**M=合并删除**。

### 2.1 剧作家 `aivn-playwriter`（`src/playwriter/prompt.ts`）

| 章 | 位置 | 门控 | 每轮 | 结论 | 落点 |
| --- | --- | --- | --- | --- | --- |
| ROLE_INTRO | :19 | — | ✓ | P | 身份 |
| WHERE_THE_PLAY_IS | :24 | — | ✓ | P | A 区锚、空目录建剧目 |
| PLAY_FILES | `src/play-files.ts:11` | — | ✓ | P（共用） | 建/改文件通用 |
| HOW_I_WORK | :37 | — | ✓ | P | 轮循环 |
| FORMAT_RULES | :45 | — | ✓ | P（不下沉） | Stage DSL 每轮契约 |
| ENDING_RULES | :137 | — | 偶发 | P | 结局正确性关键 |
| MEMORY_RULES | :164 | — | ✓ | P | 每轮写 `memory/always/state/*` |
| newCharacterRules | :195 | 部分（内部读 can.image） | 按需 | S | 唯一落点 `aivn-play-setup`「演出中引入新主体」 |
| CONTRACT_RULES | :229 | — | ✓ | P | 每轮硬规则 |
| IMAGE_CHAPTER | :281 | ✓ can.image | 按需 | S | 下沉 `aivn-visual-craft`「演出中缺图」 |

### 2.2 搭台助手 `aivn-stagehand`（`src/stagehand/prompt.ts`）

| 章 | 位置 | 门控 | 每轮 | 结论 | 落点 |
| --- | --- | --- | --- | --- | --- |
| IDENTITY | :24 | — | ✓ | P | 身份 |
| PLAY_FILES | `play-files.ts` | — | ✓ | P | 共用 |
| RESPONSIBILITY | :44 | — | ✓ | P | 职责边界 |
| TALK | :55 | — | ✓ | P | 读写行为准则 |
| assetGuide | :69 | 恒在，按 can.image 分措辞 | 按需 | S | 正文下沉 `aivn-visual-craft`；persona 留 4 条写盘规则 + 指针 |
| STYLE | :147 | — | 按需 | M（删） | 与 `set_stage_style` DESCRIPTION 重复 |
| MUSIC | :129 | ✓ can.music | 按需 | S | 正文下沉 `aivn-audio`；persona 留契约 + 指针 |
| SHELL | :115 | ✓ can.shell | 偶发 | P | 纯规则 |
| SEARCH | :122 | ✓ can.search | 偶发 | P | 纯规则 |
| SKILLS | :140 | — | ✓ | P | 技能库指引 |

### 2.3 A 区注入 / 工具描述 / 引擎消息

| 项 | 位置 | 结论 |
| --- | --- | --- |
| A 区段 | `src/play-context.ts` | P（数据渲染模板） |
| `AUDIO_RULES` | `play-context.ts:283` | P（去重） |
| 写作参数措辞 | `src/craft.ts:51-149` | P |
| 搭台《当前状态》 | `src/stagehand/context.ts:37` | P |
| 9 个工具 DESCRIPTION | `src/stagehand/tools/*`、`src/tools/validate-play.ts` | P=机制真相源 |
| 导演消息壳 / 收束指令 | `src/director.ts`、`src/stage-tap.ts:369` | P |

## 3. 三方重复点（证据）

| 主题 | persona 里 | 工具 DESCRIPTION | skill 里 |
| --- | --- | --- | --- |
| 出图/入库（一键 vs 原子三件套） | `IMAGE_CHAPTER`（playwriter）、`assetGuide`（stagehand） | `generate-asset.ts` / `generate-image.ts` / `import-asset.ts` / `cut.ts` | `aivn-visual-craft` §7 |
| 候选挑图流程 | `assetGuide` | `import-asset.ts`「登记前摆给用户看」 | `aivn-visual-craft` §7 候选流程 |
| 配乐怎么写 prompt | `MUSIC`（stagehand） | `generate-bgm.ts` | `aivn-audio` §8.5 |
| 舞台皮肤怎么改 | `STYLE`（stagehand） | `set-stage-style.ts`（完整） | — |
| 角色外形 / 差分 | `newCharacterRules` 交叉引用 | — | `aivn-visual-craft` §三/§六 |

## 4. 门控强度的分析与结论（expert cross-check）

**问题**：skill 恒列、恒可加载；persona 门控章（缺图章 `can.image`、配乐章 `can.music`）随能力位整章消失。
把 recipe 正文从 persona 搬进恒列 skill 后，如何保住「未配后端不谎报能力」？

**关键事实**：现状**已经是部分的**——恒列的 `aivn-visual-craft` §7（原第 135-161 行）今天就无条件点名
`generate_asset` / `generate_image` / `cut` / `import_asset`，而它不受能力位影响。

**结论（取 (i)+(ii)，拒绝 (iii)）**：

- **(i)** skill 的 `name`+`description`（恒可见）必须**能力中立**：不点名任何门控工具
  （`generate_asset` / `generate_image` / `generate_bgm` / `list_voices` / `web_search`）。
- **(ii)** skill 正文可以点名门控工具，但必须**条件化措辞**（先讲清「本剧目配了 / 没配 X 后端」，两支各走哪条路）。
- **(iii)** 「靠工具不存在兜底」**不作为唯一机制**：它只是运行时兜底。
- persona 门控指针是主 gate：保留同名标题、随能力位出现/消失；e2e 据此判定。
- 要求 skill 正文完全不含工具名**过度**（削弱可用性且与现状不一致），不做。

## 5. 关联

- 计划：`261007-aivn-prompt-clarity.plan.md`
- 常青真相源：dsh-aivn `AGENTS.md`「提示词地图」
- 检视 / 验证 / 小结：同目录其余文档
