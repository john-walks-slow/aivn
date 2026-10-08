# dsh-aivn 目录结构重构 · 现状调研

> 需求（2026-10-07）：刚做完「提示词透明化」（`../261007-aivn-prompt-clarity/`），评估仓库目录结构
> 有哪些值得重构。本文件是**证据快照**：结构快照、逐项触碰面量化、环境前置。常青真相源在
> dsh-aivn `AGENTS.md`（「结构」表、「提示词地图」、「改名要连带改的地方」）。
>
> 基线：dsh-aivn `master` / `91fed41`（本次任务 worktree `feature/dsh-aivn-7fh`）。

## 1. 结构快照

- `src/` 共 **59** 个文件（`.ts`/`.tsx`），其中**根平铺 25 个 `.ts`**；子目录 6 个：
  `client/` `media/` `playwriter/` `stagehand/` `tools/` `types/`。
- 构建入口只有两个：`src/index.ts`（宿主半边）与 `src/client/index.tsx`（浏览器半边，
  `build.mjs`）。其余文件对**包外不可见**——没有公共 API 面，重构只影响本仓内部引用。
- 25 个平铺文件按关注点可分四类（任务书给的分法，逐文件核对后成立）：

| 类 | 文件（25） |
| --- | --- |
| 宿主接线 | `index` `routes` `session` `hub` `preset-tools` `tool-catalog` `commands` `injected`（8） |
| 剧目领域 | `play` `play-context` `play-files` `play-state` `craft` `readiness` `scaffold` `ledger` `assets`（9） |
| 演出投影 | `stage-log` `stage-tap` `director`（3） |
| 样式 / 语音 | `style-tokens` `theme` `tts` `voice` `voice-host`（5） |

## 2. 量化方法

用脚本静态解析全部相对 import（`from './…'` / `from '../…'`，含多行 `} from`），把每个 specifier
解析到真实文件，再按「候选搬迁映射」标记会断的引用。计数口径：

- **触碰文件面** = 需要改动的文件数（被移动的 + 改 import 的 + 改文档注释的）；
- **import 改写数** = 需要改写路径的 import specifier 条数；
- **e2e 覆盖** = 该改动是否被 `npm run typecheck` 覆盖（**否**，见 §4）。

全仓相对 import 共 141 条。

## 3. 逐项证据

### 3.1 共享工具寄居在 `src/stagehand/tools/`（最高性价比）

- `src/tool-catalog.ts` 的单一真相源明确写着「两个预设默认装**同一套**」；`preset-tools.ts:17-24`
  也确认 2026-10-07 起不再有「某工具只给搭台助手」的分叉。8 个工具
  （`cut` `generate-asset` `generate-bgm` `generate-image` `import-asset` `list-voices`
  `set-stage-style` `web-search`）对**两个预设**都装，却住在 `stagehand/` 下。
- 搬迁触碰面（`stagehand/tools/*` → `src/tools/*`）：
  - `git mv` 8 个文件；`src/tools/` 由 2 → 10 个文件（并入既有 `validate-play.ts` / `context.ts`）。
  - `preset-tools.ts` 8 行 import 改路径。
  - 被移动文件内部 **26** 条相对 import，其中 **24** 条要改（`../../media/*`→`../media/*`、
    `../../tools/context`→`./context`、`../../play|style-tokens|theme`→`../…`）；
    另 2 条（`list-voices` 的 `../voice-catalog`、`web-search` 的 `../exa`）**恰好不变**。
  - **e2e 零影响**：没有任何 e2e 脚本 import 这些工具（工具面断言走工具**名**，不是路径）。
- **关键修正**：仅搬 `tools/` 不足以让目录名「副实」。`stagehand/` 里另有三个模块**也是两预设共用**：

| 模块 | 被谁用（证据） |
| --- | --- |
| `capabilities.ts` | `index.ts:30`、`preset-tools.ts:55`（两个预设的能力面） |
| `exa.ts` | `index.ts:31`、`preset-tools.ts:57`、`web-search.ts:12` |
| `voice-catalog.ts` | `index.ts:32`、`preset-tools.ts:67`、`list-voices.ts:12` |

  三者都不 import 任何 `stagehand/` 内文件（`exa.ts`/`voice-catalog.ts` 零内部 import，
  `capabilities.ts` 零 import），是名副其实的**宿主级能力服务**——与根目录的 `tts.ts` 同一层。
  只搬工具、留下这三个，`stagehand/` 仍会「名不副实」。把它们一并移到 `src/` 根后，
  `stagehand/` 只剩 `prompt.ts` + `context.ts`（这两者才真是搭台助手专属）。
  该子搬迁另加 **7** 条 import 改写（`index.ts` 3、`preset-tools.ts` 3、`stagehand/prompt.ts` 1）。

### 3.2 `src/` 根平铺 25 个 `.ts`

- 归置方案（任务书建议）：`play/`(9) `stage/`(3) `style/`(2) `voice/`(3)，宿主接线 8 个留根。
- 触碰面：**移动 17 个文件**（缓冲基线不含 3.1 的基础设施搬迁）+ src 内 **47** 条跨组 import 改写
  （受影响最多：`index` 6、`routes` 6、`stage-tap` 5、`play-context` 4、`stagehand/context` 4、
  `voice-host` 4）**+ e2e 9 条**（`verify-ending` 4、`verify-rebuild` 5 里的对应项、
  `verify-media` 的 `readiness`、`style-tokens.check` 2）。
- 注释里的引用大多是**裸文件名**（`director.ts` / `play-context.ts` …），目录级搬迁**不改文件名**
  即天然保活；只有少量全限定引用要动（`src/client/stage-view.tsx` 的 `src/stage-log.ts` /
  `src/hub.ts` / `src/director.ts`、`src/client/settings-card.tsx` 的 `src/index.ts`、
  `src/media/assets.ts` 的 `src/media/cutout.ts`、`src/media/web-image.ts` 的 `stagehand/exa.ts`）。
- 判定：收益是**导航/归类**，风险与验证成本显著高于 3.1，且存在「先搬一次、二期再搬」的重复搬迁风险。

### 3.3 提示词散在 10 处

- 这是 `261007-aivn-prompt-clarity` **有意落成的分层**（见其 research §4 与 dsh-aivn `AGENTS.md`
  「提示词地图」）：机制→工具 `DESCRIPTION`、食谱→skill、身份/契约/门控指针→persona、
  数据渲染模板→`play-context.ts`/`stagehand/context.ts`/`craft.ts`。**不是**缺乏整理的散沙。

### 3.4 `src/media/` 与工具分家

- 后端客户端在 `src/media/`（`image`/`music`/`gemini-image`/`openai-image`/`modelslab-image`/
  `web-image`/`cutout`/`assets`/`backends`/`generate-tool`），对应工具在 `stagehand/tools/`。
- `generate-tool.ts` 是工具侧的公共管道（`textOutput`/`genericResult`/`generatedResult`），
  与工具强耦合、与后端弱耦合——它更像是「工具层」的东西，现在却住在 `media/`。
- 3.1 落地后，「能力工具在 `src/tools/`、能力后端在 `src/media/`」的分层本身已自洽；再按「能力」
  纵深切（`image/`、`audio/` 各含后端+工具）会**打散现有清晰的两层**，churn 大、收益模糊。

### 3.5 `e2e/` 平铺 19 个脚本

- 分组已由 `e2e/run.mjs` 的 `MODULES`（9 个模块）承担；`run.mjs` 按**名字** spawn `e2e/<suite>.mjs`。
- 三类文件：
  - **套件**（11 个 `verify-*`，其中 `verify-rebuild`/`verify-ending`/`verify-media` 是 `.ts` +
    薄 `.mjs` 包装，用 esbuild 就地打包）；
  - **夹具**：`style-tokens.check.ts`（由 `verify-style.mjs:78` 打包调用，**不是诊断脚本**）；
  - **诊断/截图**（不在 `MODULES` 里，手动跑）：`css-diag.mjs`、`shot-tabs.mjs`、`shot-voice.mjs`、
    `b1-probe.sh`。
- 搬运代价：所有套件用 `./lib/boot.mjs`、`./lib/fixture.mjs`（相对），进子目录要改 `../lib/`；
  `run.mjs` 的 spawn 路径、`package.json` 的 `e2e:media` 路径、`.mjs` 包装里 `join(here, …)` 都要跟着动。
- 判定：**全量目录分组收益低**（分组已存在）；把诊断脚本收进 `e2e/diag/` 是低成本可选项。

## 4. 环境与前置（影响验证可行性）

1. **`lib/index.js` 的路径注释随构建目录深度漂移**（reviewer 在 prompt-clarity 小结里已记）。
   实测已提交产物含 `// ../../../../projects/stage-ai/packages/core/dist/dsl/spec.js`——这是相对
   **构建 cwd** 的路径，`/root/.kandev/tasks/<x>/dsh-aivn`（root 下 4 层）才解析得到
   `/root/projects/stage-ai/…`。`build.mjs --check` 对宿主半边**硬判字节**，所以：
   - 必须在**同样深度**的 worktree 里构建（本任务 worktree 恰好是 4 层，匹配）；
   - `node_modules` 的 `@aivn/*` 必须指向 `/root/projects/stage-ai/packages/*`（与本仓主检出一致）。
2. **本任务 worktree 没有 `node_modules`**，且 `package.json` 的 `file:../stage-ai/packages/core`
   在 worktree 里**解析不到**（`../stage-ai` 不存在）。构建前必须先把主检出
   `/root/projects/dsh-aivn/node_modules`（其 `@aivn/*` 已是指向 `/root/projects/stage-ai` 的软链）
   链接进 worktree，否则路径注释会漂、`--check` 会假红。
3. 实例级 e2e 另需：`/root/projects/dsh-patch/apply.sh` 已打（dsh 升级会覆盖）、worktree 的
   `.dsh-e2e-home` 备好 provider（给 profile 的 `cordis.patch.yml` 补 `llm-pi-ai` 行）。
4. **多 Agent 并发**：dsh-aivn 有多个活 worktree / 分支（`agent_8t5w9dv9` 在 `3ff1414`、
   `90hwizuu` 在 `5e66c02`、`skill-hardcode` 在 `91fed41`），且分支里含 `lib` 重建。大爆炸式搬迁
   会给在飞分支制造冲突——倾向于把改动压小、尽快合并。

## 5. 参考约定

- 本仓不放开发记录：需求/计划/检视/验证记在主仓 `stage-ai/docs/features/`。
- `lib/` 是**受跟踪构建产物**：改 `src/` 必须 `npm run build` 并把 `lib/index.js` 同笔提交
  （`.githooks` 的 `build.mjs --check` 拦）。
- 本仓**无单元测试**，可信验证是 e2e；`tsconfig.json` 只 include `src/**`——**e2e 的 `.ts`
  不被 typecheck 覆盖**，目录搬迁漏改 e2e import 只有跑到该套件才暴露。
