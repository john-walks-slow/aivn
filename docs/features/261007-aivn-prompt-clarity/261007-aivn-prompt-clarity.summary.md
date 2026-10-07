# dsh-aivn 提示词透明化与可维护性整理 · 小结

> 需求（2026-10-07）：盘点提示词分布，让提示词更透明、易于维护。
> 相关：`261007-aivn-prompt-clarity.research.md`（审计）、`.plan.md`、`.review.md`（条件准入）。
> 常青真相源：dsh-aivn `AGENTS.md`「提示词地图」。

## 做了什么

1. **提示词地图（常青）**：dsh-aivn `AGENTS.md` 新增「## 提示词地图」——三层定义、分层规约
   （机制→工具 DESCRIPTION / 食谱→skill / 每轮契约与门控指针→persona / 数据渲染模板→代码）、
   逐处提示词位置表、门控规则、e2e 锚点。
2. **去重（单一真相源）**：
   - 删 stagehand `STYLE` 章（细节全在 `set_stage_style` 的工具描述里）。
   - `assetGuide` 瘦身为 4 条每轮写盘规则 + 指向 `aivn-visual-craft` 的条件化指针。
   - `MUSIC` 瘦身为契约 + 指向 `aivn-audio` 的条件化指针。
   - 剧作家 `IMAGE_CHAPTER` / `newCharacterRules` 正文下沉，persona 只留指针。
3. **下沉到 skill**：
   - `aivn-visual-craft` 新增「八、演出中缺图（剧作家在演出中）」，§7 改成「配了/没配生图后端」条件化。
   - `aivn-play-setup` 新增「四、演出中引入新主体」（唯一家：建档 / 立绘 / 临时角色）。
   - 三份 skill 的 `description` 更新且保持能力中立。
4. **门控保真**：门控章不能整章下沉（skill 无能力位门控）——保留同名标题的门控指针；skill 描述能力中立、
   正文门控工具条件化。见 research §4。
5. **验证同步**：`e2e/verify-injection.mjs`（A14b）、`e2e/verify-stagehand.mjs`（S12b、S17）、
   `e2e/verify-media.ts`（M19/M20、M21b/M21c）同步；双语 README 更新。

## 验证结果

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` + `node build.mjs --check` | 通过（lib 与源码一致） |
| `npm run e2e:media`（离线静态） | **48/48**（含新增 M21b/M21c） |
| `node e2e/run.mjs rebuild` | **13/13** |
| 实例级 `e2e/verify-injection.mjs` | **18/18**（含新增 A14b；本实例未配生图，走门控指针消失分支） |
| 实例级 `e2e/verify-stagehand.mjs` | **22/22**（含新增 S12b；persona 结构、门控措辞、技能清单中立） |

跑通实例级 e2e 的两个前置（都是本机环境，不在仓库里）：

1. **重打 dsh 部署补丁**：dsh 升级到 0.2.0 覆盖了 `/root/projects/dsh-patch` 的全部补丁，其中 0004
   （`DSH_TOKEN` 固定启动 token）是 e2e harness 的前提——不重打则 `dsh web` 每次随机 token，套件 401。
   `./apply.sh` 已全部重打（0001/0004/0005/0006/0007）。
2. **给 worktree 的 `.dsh-e2e-home` 喂 provider**：profile 的 `cordis.patch.yml` 补 `llm-pi-ai` 行
   （cpa 网关 + CPA_API_KEY）并把 `welcomeNoticeVersion` 提到 `2026-09-28.1` 压掉欢迎弹窗。

## 顺带修的三处 e2e 基建问题（提交 91fed41）

跑实例套件时暴露，均与提示词改动正交，但会挡住验证：

- **会话 slug 折叠点号**：6 个 e2e 脚本用 `replace(/[/.]/g,'-')` 算 sessions 目录名，而 dsh 只折 `/`。
  路径含点（如 `.kandev` 下的 task worktree）时目录名对不上 → 必然 ENOENT。改为只折 `/`。
- **重名常量**：verify-stagehand 新增的 `gatedToolNames` 与既有 `gatedTools` 重名（SyntaxError）。
- **AGENTS.md 误撞技能清单锚**：提示词地图里写了字面量 `<available_skills>`，而 e2e 靠它定位技能清单；
  AGENTS.md 被注入会话后，提取器命中了 AGENTS.md 而非真正的清单。把该字面量从 AGENTS.md 去掉。

## 检视

`reviewer` 结论 **条件准入**，无阻塞问题。已按建议处理：N3（persona/skill 标题对齐为「演出中引入新主体」）、
S2（assetGuide JSDoc 注明 cut/import_asset 不门控）、S4（A14b 耦合锚点注释）、S5（地图行注明在 tail 段内）、
S6（skill §四 镜像 §七 的「cut/import_asset 始终可用」）。其余（S1 persona 契约数字与 skill 重复、S3 e2e 数组抽取、
N2/N4/N6 等）为工程体验备忘，不阻塞，留后续迭代。

## 已知残留

- 配置了生图后端那一支（剧作家演出中真出图）与配乐章的人工验证仍未做（e2e 实例无生图/音乐后端）；
  见 validation.md 的待验证项。
- dsh 每次升级都会覆盖补丁——升级后必须重跑 `/root/projects/dsh-patch/apply.sh`，否则固定 token 等修补失效。
- reviewer 提到的 `lib/index.js` esbuild 路径注释随 build host 漂移，与本次无关。
