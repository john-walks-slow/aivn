# dsh-aivn 目录结构重构 · 实施计划

> 需求见 `261007-dsh-aivn-structure.research.md`。常青真相源在 dsh-aivn `AGENTS.md`。
> 目标：在**不为审美做大搬迁**的前提下，消除最刺眼的结构错位，并论证其余项目的取舍。

## 目标

1. 消除「共享工具/共享基础设施寄居 `stagehand/`」这一真实错位（方案 ①）。
2. 对其余四个方向给出**做 / 不做**的知情结论（方案 ②③④⑤），避免无收益的大搬迁。
3. 全程**纯移动 + 改 import，不改行为**；`lib/` 重建后同笔提交。

## 非目标

- 不重命名任何**文件**（保活注释里的裸文件名引用）。
- 不改任何**用户可见名字**（页签 `AIVN`、路由 `/aivn`、工具名、`file:` 依赖路径）——本轮不触发
  `AGENTS.md`「改名要连带改的地方」里最痛的那几条。
- 不动提示词内容与分层（方案 ③ 已判定不做）。
- 不动 `@aivn/core` / `@aivn/stage` 与 DSL。

## 硬约束（每期都适用）

1. 改 `src/` 必须 `npm run build` 并把 `lib/index.js`（浏览器半边未被本轮触碰，`lib/client.js`
   应保持不变）同笔提交；`node build.mjs --check` 必须绿。
2. **构建前置**（见 research §4）：在 worktree 里先把主检出 `node_modules` 接入，使 `@aivn/*`
   指向 `/root/projects/stage-ai/packages/*`、且 cwd 深度为 `/root/.kandev/tasks/<x>/dsh-aivn`，
   否则 `lib/index.js` 的路径注释漂移、`--check` 假红。
3. **e2e 的 `.ts` 不在 `tsconfig` 覆盖内**：凡搬到 e2e import 的模块，必须实际跑对应套件，
   不能只靠 `typecheck`。
4. 并发友好：改动尽力压小、能一期完成就一期完成，减少与在飞 dsh-aivn 分支的冲突面。

## 决策总表

| # | 方案 | 收益 | 风险 / 成本 | 触碰面（量） | 结论 |
| --- | --- | --- | --- | --- | --- |
| ① | 共享工具 `stagehand/tools/*` → `src/tools/*`，共享基础设施移出 `stagehand/` | **高**：目录名与真实职责一致；工具面单一入口 | 低：纯移动，无 e2e、无行为变化 | 11 文件移动 + 32 import 改写 + 1 处 AGENTS.md | **做（一期）** |
| ② | `src/` 根 25 个平铺模块归入 `play/ stage/ style/ voice/` | 中：导航/归类 | 中：17 文件移动 + 47 src + 9 e2e import；e2e 不在 typecheck 内 | 大 | **延后 / 可裁**（待并发分支收敛、确有导航痛点再做） |
| ③ | 提示词「散在 10 处」合并 | 低（分层是有意设计，地图已承担发现） | 高：与 AGENTS.md 分层规约冲突 | — | **不做** |
| ④ | 按「能力」纵切 `media/` + 工具 | 低：现有两层已自洽 | 高：打散清晰分层 | — | **不做** |
| ⑤ | `e2e/` 目录分组 | 低：`MODULES` 已分组 | 中：动 run/wrapper/脚本路径 | 小-中 | **只做轻量项**（诊断脚本收进 `e2e/diag/`） |

---

## Phase 1 · 共享工具与基础设施归位（方案 ①，建议单独成笔）

### 1a 共享工具 → `src/tools/`

`git mv`（8 个）：`src/stagehand/tools/{cut,generate-asset,generate-bgm,generate-image,import-asset,list-voices,set-stage-style,web-search}.ts`
→ `src/tools/`。删空目录 `src/stagehand/tools/`。搬迁后 `src/tools/` = `context.ts` `validate-play.ts`
+ 这 8 个 = 10 个文件，是「两预设共用的全部 AIVN 工具」的单一入口。

import 改写（**32** 条）：
- `preset-tools.ts`：8 条 `./stagehand/tools/x` → `./tools/x`。
- 被移动文件内部 26 条中 **24** 条：`../../media/*`→`../media/*`、
  `../../tools/context`→`./context`、`../../play|style-tokens|theme`→`../…`。
  （`list-voices` 的 `../voice-catalog`、`web-search` 的 `../exa` 两条**保持原样**。）

### 1b 共享基础设施移出 `stagehand/`（建议纳入一期）

`git mv`（3 个）：`src/stagehand/{capabilities,exa,voice-catalog}.ts` → `src/` 根。
搬迁后 `src/stagehand/` 只剩 `prompt.ts` + `context.ts`（搭台助手专属），名字终于副实。

import 改写（**7** 条）：`index.ts` 3、`preset-tools.ts` 3、`stagehand/prompt.ts` 的
`./capabilities` → `../capabilities`。`list-voices`/`web-search` 的 `../voice-catalog` / `../exa`
在新位置下**仍解析到同一文件**，无需改。

> 落点选择：放根目录（与 `tts.ts` 同一层，都是宿主级能力服务）。若二期（方案②）启动，再按组归位；
> 现在放根避免与二期耦合、也不把二期前置。

### 1c 文档与注释

- `AGENTS.md:82`：「9 个工具描述 | `src/stagehand/tools/*`、`src/tools/validate-play.ts`」
  → 「`src/tools/*`」。
- `AGENTS.md`「结构」表：`src/tools/` 一行补「两预设共用的全部 AIVN 工具」；如需，补一行 `src/stagehand/`。
- 连带注释：`src/media/web-image.ts:12` 里的 `stagehand/exa.ts` → `exa.ts`。
- 双语 README 不涉及这些路径（只引 `src/tool-catalog.ts`、`src/media/cutout.ts`，均不动），**无需改**。

### 1d 验证（Phase 1）

离线：`npm run typecheck` → `npm run build` → `node build.mjs --check` → `npm run e2e:media`
（静态 48 项）→ `node e2e/run.mjs rebuild`（13 项）。
实例级（需按前置准备好）：`dsh-e2e stop && dsh-e2e start --wait-ready` 后跑 `injection` 与
`stagehand`（两者断言工具面/注入），再跑 `stage`（演出闭环）。
预期：除 `lib/index.js` 的路径注释按新源码位置变化外**无行为差异**。

**回滚**：整体 `git revert` 或按逆映射 `git mv` 回来即可（纯移动，无数据/接口破坏）。

---

## Phase 2 · `src/` 根归组（方案 ②，延后 / 可裁）

仅在「并发分支已收敛」且团队确认导航痛点后启动。映射：

| 新目录 | 文件 |
| --- | --- |
| `src/play/` | `play` `play-context` `play-files` `play-state` `craft` `readiness` `scaffold` `ledger` `assets` |
| `src/stage/` | `stage-log` `stage-tap` `director` |
| `src/style/` | `style-tokens` `theme` |
| `src/voice/` | `tts` `voice` `voice-host`（+ 若 1b 归位，可含 `voice-catalog`） |
| 留根（宿主接线） | `index` `routes` `session` `hub` `preset-tools` `tool-catalog` `commands` `injected` `capabilities` `exa` |

- 触碰：17 文件移动（缓冲基线，不含 1b）+ 47 src import + 9 e2e import（`verify-ending`、
  `verify-rebuild`、`verify-media`、`style-tokens.check`）+ `AGENTS.md` 结构表 + 少量全限定注释。
- **本方案与方案④不同**：只按「领域/层」归组，不纵切能力。
- 停做条件：若 Phase 1 完成后团队认为「工具有了单一入口、stagehand 名实相符」已足够，则**不做**。

---

## Phase 3 · e2e 轻量整理（方案 ⑤，可裁）

- 新建 `e2e/diag/`，把 `css-diag.mjs`、`shot-tabs.mjs`、`shot-voice.mjs`、`b1-probe.sh` 移入，
  并把它们对 `./lib/*` 的 import 改为 `../lib/*`；`css-diag.mjs` 里 `OUT` 相对路径核对一遍。
- `style-tokens.check.ts` **不搬**（它是 `verify-style.mjs` 的夹具，不是诊断脚本）。
- **不做**全量 `verify-*` 子目录化（`run.mjs` 按名 spawn，分组已由 `MODULES` 表达，收益低）。
- 验证：`e2e/run.mjs style` + 手动 `node` 跑一次移动后的诊断脚本冒烟。

---

## 废弃方案的理由（知情记录）

- **方案 ③（提示词合并）**：`261007-aivn-prompt-clarity` 刚把分层确立为单一真相源，`AGENTS.md`
  「提示词地图」就是它的发现入口。合并会破坏该规约，**拒绝**。
- **方案 ④（能力纵切）**：3.1 落地后 `src/tools/`（工具）与 `src/media/`（后端）两层已清晰；
  纵切会把后端与工具混进同一能力目录、打散现有分层，**拒绝**（如需，仅在 `generate-tool.ts`
  的归属上做微调，可并入 Phase 2 一起评估）。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| `lib/index.js` 路径注释漂移导致 `--check` 假红 | 严格按前置接入 `node_modules`、保持 worktree 深度；构建后逐字节 `--check` |
| 漏改 e2e import（不在 typecheck 内） | Phase 1 无 e2e import；Phase 2 显式跑 `media`/`rebuild`/`ending`/`style` + 实例套件 |
| 与在飞 dsh-aivn 分支冲突 | 一期压小、尽快合并；Phase 2 延后至分支收敛 |
| 多 Agent 并发改同一文件 | 遵守「提交自家改动」技能；提交前 `git diff` 确认范围 |

## 验收标准

- Phase 1：`typecheck` / `build` / `build.mjs --check` / `e2e:media` / `rebuild` 全绿；
  `injection`+`stagehand`+`stage` 实例套件全绿；`src/stagehand/` 只剩 `prompt.ts`+`context.ts`；
  `src/tools/` 含全部 9 个工具 + `context.ts`；无行为变化。
- Phase 2（若做）：上述全套 + e2e 全体（stage/injection/stagehand/voice/style/director/settings/
  ending/rebuild）绿；`AGENTS.md` 结构表同步。
- Phase 3（若做）：`node e2e/run.mjs style` 绿；诊断脚本冒烟通过。
