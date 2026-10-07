# 检视报告

## 概要

对 dsh-aivn「提示词透明化与可维护性整理」改动（feature/c1ade845-d257-4bf7-9-28b）做检视：三层提示词的分层规约与单一真相源已落成 AGENTS.md 常青地图，persona 端的 `IMAGE_CHAPTER` / `STYLE` 章与「引入新角色」「配乐」/「出图要点」做法正文已按计划下沉到 skill / 工具描述；离线套件（`verify-media` 48/48、`rebuild` 13/13、`build --check`、typecheck）全绿。设计意图、实现与测试三者一致。

## 需求对齐

- **三层分层**：plan §硬约束 1-4 与 research §1 「PG/S/M 判据」逐章归属全部落实（见 research §2.1/§2.2 表 vs 实际改动）。唯一一处表里写 P、实际下沉到 skill 的是 `PLAY_FILES`（共用），与 plan 一致。
- **门控强度（rule (i)+(ii)）**：plan 与 research §4 取 (i)+(ii) 拒绝 (iii)——
  - (i) 三份 skill 的 `description`（恒列进 `<available_skills>`）已检过不含 `generate_asset` / `generate_image` / `generate_bgm` / `list_voices` / `web_search`（M21b、S12b 双锁）。
  - (ii) `aivn-visual-craft` §7、`aivn-play-setup` §四均写「配了生图后端」/「没配生图后端」两支（M21c 锁住）；`aivn-audio` §8.5 明确「配了音乐后端才注册」，对应文案是条件化的。
- **不做**：plan「明确不做」全数遵守——没改 A 区渲染、没改剧目文件格式、没动 `@aivn/core`、没新增 skill。
- **常青地图**：AGENTS.md 「提示词地图」新增，且 e2e 锚点说明（plan §硬约束 4 的「e2e 锚点」）已写入 AGENTS.md 「e2e 锚点」一节。

## 阻塞问题

无。

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1  | `src/playwriter/prompt.ts:283` | `IMAGE_POINTER`（`can.image` 门控的 persona 章）里仍把「出图是同步的（70–140 秒）…一轮预算 240 秒 — 只为这一轮真的要引用的东西出」这条**契约**留在 persona；同时 `aivn-visual-craft` §八「演出中缺图」也写了同样的时间数字。两者措辞高度相似——这是分层规约 §「数据渲染模板」与「机制 → 工具 DESCRIPTION」相邻处容易越界的地方。`aivn-visual-craft` 的同款描述是「做法」，persona 的同款描述是「契约」，分工能讲得通（plan 没把这块当 §P/§S 切干净）。 | **建议**：要么 persona 这条契约数字去 skill、只留指路，要么 skill 删数字、让 persona 守契约。可二选一，不必强制改；若决定保留，可在 persona 那行加一句「这条数字约定按 `aivn-visual-craft` §八，模型按需加载校准」，把唯一真相源指给 skill 的人——这样数字变化只改一处。 |
| S2  | `src/stagehand/prompt.ts:91-92`（`assetGuide`） | `assetGuide` 的两支都点到了工具名（`generate_asset` / `generate_image` / `import_asset` / `cut`）。该章恒在、按 `can.image` 分措辞——当前写法「先讲清配没配后端」是 (ii) 的条件化措辞，从分层规约上讲是合规的（persona 不受 catalog 恒列约束，且每支都标了门控状态）。但「cut / import_asset」在 `can.image=false` 的支里也被点到——它们不门控、始终可用，这里没问题，标出来是给读者安心。 | **无强制要求**。建议在 `assetGuide` 上方那段 JSDoc 顺手补一句：`can.image=false` 那一支之所以还能点 `cut` / `import_asset`，是因为这两个工具不门控——避免后人误以为「无条件点名 = 谎报」。 |
| S3  | `e2e/verify-stagehand.mjs:161` 与 `e2e/verify-media.ts:285` | 两份 e2e 各定义了一份 `gatedTools` / `gatedToolNames` 数组。内容相同、未来增/改门控工具时容易漏改一份。 | **建议**：抽到 `e2e/lib/gating.mjs`（或加到现有 fixture）统一导出，e2e 三处都 import；改门控工具名只改一个数组。 |
| S4  | `e2e/verify-injection.mjs:176`（A14b） | 断言用「`「演出中缺图」一节`」这个精准子串来判定门控指针出现/消失——它**只在 `IMAGE_POINTER` 里出现**，不在 skill description 里（已用脚本核过），所以不假红。但这个字串是**带 §八标题里没有的「一节」二字**的特化串，万一未来 §八标题改成「缺图」或别的写法，A14b 就会假红。 | **建议**：要么把 §八的标题写成「## 演出中缺图（剧作家在演出中）」并在 persona 指针里只引用「## 演出中缺图」短串（不带「一节」）；要么在 e2e 里加注释，明确「这是和 §八标题的耦合锚点，改 §八标题时同步改这条」——后者改动小、对现状兜底到位。 |
| S5  | `AGENTS.md:75` | 「引入新角色（指针）/ 缺图怎么办（指针）」与「剧本格式（Stage DSL）/ 结局 / 记忆卡 / 演出契约」在地图里分两行，但 `playwriterTail` 里它们其实是同一段（`aivn:playwriter-tail` section，order 200）。读起来像是两段。 | **建议**：合并成一行写「`aivn:playwriter-tail` section」整段，或在「提示词位置」表注脚里说「引入新角色/缺图怎么办 是该 section 内的门控字段」。 |
| S6  | `skills/aivn-visual-craft/SKILL.md:135-142` §七 / `skills/aivn-play-setup/SKILL.md:73-87` §四 | 两份 skill 在「配了生图后端」「没配生图后端」措辞上轻微不一致：§七开门用「`cut` 与 `import_asset` 不依赖生图后端、始终可用」强调不门控；§四开门用「立绘：」+ 列表，没复述「cut/import_asset 始终可用」。两边互相引用但口径稍错位——读者翻两个 skill 时需自己拼。 | **建议**：在 §四「立绘」那段加一句「`cut` 与 `import_asset` 不依赖生图后端、始终可用」，把 §七的开场白镜像过来；或者干脆把 §四的「立绘」三行也写成与 §七相同的「先按当前有没有生图后端选路」开头（与 §七的写法一致）。**不强制**——§四的精简形态也讲得通，只是不够对称。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1  | `skills/aivn-visual-craft/SKILL.md:135` §七 标题 | 标题里包含「`generate_asset` / `generate_image` / `cut` / `import_asset`」四个反引号工具名。skill description 不包含这些（已核），但 §七标题被任何**引用 skill** 的工具流读到时都会带工具名。research §4 「要求 skill 正文完全不含工具名过度」已明示这是 trade-off，不强制要求。但读者用 `grep` 翻这个标题时确实一眼看到工具名。 | **无要求**。这是一致性 vs 主动性的权衡，研究里已经论证过。 |
| N2  | `README.md:382` 「静态后半」行（与 EN `README.en.md:332`） | 「外加两句指针——引入新角色（指向 `aivn-play-setup`）、缺图怎么办（指向 `aivn-visual-craft`，配了生图才在）」只点出两条；实际 persona 还有「配乐」指针（stagehand 的 `MUSIC` 章、`can.music` 门控）。**README 是用户文档，但用户接触不到 stagehand 的章——只有搭台助手的对话里能看到。** 用户用 `set_stage_style` 改皮肤的注释也在另一节讲。 | **建议**：在 README「剧作家」段不动；可在「搭台助手」段（角色描述那一节）顺手补一句「改皮肤调 `set_stage_style`；配乐在配了音乐后端时启用，提示词会自动出现『加载技能 aivn-audio』的指引」。**不强制**——这两块在 README 其他地方（设置、工具表）已覆盖。 |
| N3  | `src/playwriter/prompt.ts:188-200` 行（`NEW_CHARACTER_POINTER`） | 标题仍是 `## 引入新角色`，而正文说「先加载技能 `aivn-play-setup` 的『演出中引入新主体』一节」。**两个标题对不上**——persona 这边是「引入新角色」，skill 那边是「引入新主体」。读 persona 看到「## 引入新角色」以为会讲怎么引入角色，加载 skill 后看到的是「## 演出中引入新主体」——名字的视角差（角色 vs 主体）会让模型疑惑。 | **建议**：把 persona 的标题从 `## 引入新角色` 改成 `## 引入新主体（角色、机甲、猫、道具）` 或 `## 演出中引入新主体`，与 skill §四对齐；或者把 skill §四标题改成「## 引入新角色」与 persona 对齐。**不强制**——两种标题都讲得通，模型通常不会卡这里；但既然 plan §把这件事标成「单一真相源」，名字至少应一致。 |
| N4  | `lib/index.js` 顶部 esbuild 注释里的 `../stage-ai/...` 被改成 `../../../../projects/stage-ai/...` | 这是上一次 build 的 esbuild 路径推断的产物，**会随 build host 路径漂移**。这本身不破坏构建——`build.mjs --check` 通过——但放进 git diff 噪音里。 | **建议**：要么在 `build.mjs` 里把 esbuild 的 `sourceRoot` 调成相对仓库根（这样注释里写的就是仓库内路径），要么在 `build.mjs --check` 输出里把这种注释差异白名单化（仅校验 `DSL_*` 等实质常量）。**不强制**——这是构建产物细节问题，与本次需求无关。 |
| N5  | `src/stagehand/prompt.ts:1-22` 文件头注释 | 文件头那串注释（`与 AIVN 的三处结构性差异`、`备料流程与各文件写法`）是 2026-10-05 写下的，现在 `STYLE` 章删除、`STAGE_PARITY` 的描述（2026-10-07 「提示词文档·整理」）也都覆盖进来了**——** 上一段仍讲「四处按配置门控」、`出图要点` 在三处里现在只剩「按 can.image 分措辞」。这两段并存且略有重复（文件头上一段说「四处门控」、下一段说「三处门控」——`'set_stage_style'` 这一项走了工具描述而非 persona 是「四处变三处」的主因）。 | **建议**：把「四处按配置门控」整段删掉，只保留 2026-10-07「提示词地图」整理那段的最新版（章归位逻辑已涵盖）。**不强制**——历史注释本身也是文档，看团队偏好。 |
| N6  | `src/stagehand/prompt.ts:131` `stagehandStatic` JSDoc | 「它们进 persona 行的 `prefix`——那一段被 dsh-persona 在装载时烘焙成静态文本，改了得重挂预设」这条仍然重要，但已与文件头那段 JSDoc 部分重复。 | 同 N5——**不强制**。 |

## 准入结论

**结论**：`条件准入`

**说明**：分层规约与门控规则全部落实、离线套件 48/48 + 13/13 全绿、e2e 锚点（`A14b` / `M21b` / `M21c` / `S12b`）正确反映新结构——本次需求的设计意图与验证证据一致。建议修改项均为工程体验（命名一致性、e2e 抽公共数组、README 写法分歧提示）而非正确性或设计偏离，可放后续迭代处理，不阻塞准入。建议**在合并前顺手把 N3（persona/skill 标题不一致）处理掉**——它属于「分层规约 · 单一真相源」的边界与延伸，与本次需求正交。