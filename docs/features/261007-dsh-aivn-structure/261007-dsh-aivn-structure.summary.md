# dsh-aivn 目录结构重构 · 小结

> 需求（2026-10-07）：在「提示词透明化」之后评估目录结构、消除错位、避免为审美大搬迁。
> 计划：`261007-dsh-aivn-structure.plan.md`；调研：`.research.md`；检视：`.review.md`（条件准入）。
> 实施范围经用户确认：方案 1、2、5。

## 做了什么

**一期 · 共享工具与基础设施归位（方案 1）**
- 8 个共享工具 `src/stagehand/tools/*` → `src/tools/`；`src/stagehand/` 从此只剩 `prompt.ts` + `context.ts`
  （搭台助手专属），名实相符。
- 关键修正（相对任务书）：`capabilities.ts` / `exa.ts` / `voice-catalog.ts` **也是两预设共用**，一并移出
  `stagehand/`：前两者 → `src/` 根（与 `tts.ts` 同层的宿主级服务），`voice-catalog.ts` → `src/voice/`。

**二期 · `src/` 根平铺归组（方案 2）**
- `src/play/`（play / play-context / play-files / play-state / craft / readiness / scaffold / ledger / assets）
- `src/stage/`（stage-log / stage-tap / director）；`src/style/`（style-tokens / theme）
- `src/voice/`（tts / voice / voice-host / voice-catalog）
- 宿主接线与宿主级服务（index / routes / session / hub / preset-tools / tool-catalog / commands /
  injected / capabilities / exa）留根。

**三期 · e2e 轻量整理（方案 5）**
- `css-diag.mjs` / `shot-tabs.mjs` / `shot-voice.mjs` / `b1-probe.sh` → `e2e/diag/`（脚本内相对路径与 ROOT 上溯已适配）；
  `style-tokens.check.ts` 作为 `verify-style` 的夹具留在 `e2e/` 根。**未**做全量 `verify-*` 子目录化。

**实现方式**：一次性脚本按「新旧位置自动重算相对 import」（见研究阶段设计），共
**32 个文件移动**（git 识别为 rename）、**92 条 import 改写**；除 import 与注释外**零内容改动**
（`git diff -M` 抽查移动文件只有 import 行变化）。

**文档**：`AGENTS.md` 结构表重写 + 提示词地图路径更新 + e2e 段补 `e2e/diag/` 说明；
`.gitignore` 新增 `/endings.json`（e2e 以仓库根为剧目时的运行期数据，与 `/play.json` 同类，防误提交）；
若干注释里的全限定路径与 `voice/`、`stage/`、`play/` 前缀统一（检视建议 S1–S5）。

## 验证结果

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` + `node build.mjs --check` | 通过（lib 与源码逐字节一致；`lib/index.js` 的 `// src/...` 路径注释随位置更新） |
| 离线 `npm run e2e:media` | **48/48** |
| 离线 `node e2e/run.mjs rebuild` | 通过 |
| 离线 `node e2e/run.mjs ending` | **8/8** |
| 实例 `injection` | **18/18** |
| 实例 `stagehand`（verify-stagehand） | **22/22** |
| 实例 `stagehand`（verify-handmade-play） | **4/4** |
| 实例 `stage`（verify-stage + verify-opening） | **2/2** |
| 实例 `style` | **25/25** |
| 实例 `settings` | **12/12** |
| 实例 `director` | 通过 |

`voice` 套件**未跑**：它真打 Fish Audio，按项目约定涉及真实外部 API 的测试默认不执行；被搬动的
`voice/` 四个模块为纯移动、行为未变。

## 检视

`reviewer` 结论 **条件准入**，无阻塞问题。建议的 5 处注释路径一致性问题（S1–S5）均已顺手修正；
N1（`/endings.json` 同笔入库）、N2（提交用 `git add -A` 保原子性）按建议处理。

## 环境备注（不在提交内）

本机实例级 e2e 的可用性依赖两处本地前置（`.dsh-e2e-home` 不在仓库里）：
1. 主检出的 `node_modules` 接入 worktree；`@deepseek-ai/*` 需要能解析到宿主 dsh 树（缺 `dsh-sandbox`
   会导致插件 `failed to import`），typecheck 另需 devDeps 版本（`dsh-client-runtime` 等），两套组合分别用于
   类型检查与实例运行。
2. profile 的 `cordis.patch.yml` 补 `llm-pi-ai`（cpa 网关 + `apiKeyEnv: CPA_API_KEY`），并以
   `CPA_API_KEY=…` 起实例；`welcomeNoticeVersion` 提到 `2026-09-28.1` 压掉欢迎弹窗。
   （dsh 升级会覆盖 `/root/projects/dsh-patch` 的补丁，需重打。）

## 已知残留

- 带**真实生图 / 音乐 / 语音后端**的路径未在本次 e2e 中执行（实例未配这些后端）；因是纯搬迁，
  风险仅限「移动后 import 断裂」，而该风险已由 build/typecheck 全绿排除。详见 `validation.md`。
