# list_voices 分页（261009-voice-pagination）

## 需求

用户原话：「list voice应该支持换页，现在只能看到前25条，但也应该支持看25～50 50～75等等」

`list_voices`（dsh-aivn 的 `src/tools/list-voices.ts`）原先固定只列热度前 25 条。
后端 `src/voice/voice-catalog.ts` 按条件抓一个窗口（最多 10 页 × 100 条）并缓存，
实测 `language=ja` 的窗口有 **1000 条**——旧实现下模型最多能看到 2.5% 的候选。

## 改动

分支 `feat/voice-pagination`，worktree `/root/projects/dsh-aivn-voice-pagination`。
已合入 master：`d8ff40d`（变基到 `2a998c6` 之上后 ff-only）。

| 文件 | 改动 |
| --- | --- |
| `src/tools/list-voices.ts` | 加 `page` 参数（integer，默认 1，每页 25）；`LIST_LIMIT` → `VOICES_PER_PAGE`；`execute` 按页切片；末尾统计行给页号与下一页；越界页给专门提示 |
| `README.md` / `README.en.md` | `list_voices` 那一行同步成「一页 25 条，`page` 从 1 起」 |
| `skills/aivn-play-setup/SKILL.md` | 「音色」一节补一句：一页 25 条，第一页不合适就翻页，翻几页仍不理想说明条件该收窄 |
| `lib/index.js` | `npm run build` 产物 |

**页码口径**：页码是**窗口内**的。Fish 自己把 `total` 封顶（实测无过滤 / 按语言 / 按 tag 都报 1000，
按标题报 200），窗口又只抓 1000 条，所以末页文案写「已是本窗口最后一页」而不是「已是最后一页」，
避免模型把它读成「全库到底」。窗口缓存 12h、上限 16 窗，过期重取后页码可能整体重排——
这是注释里写明的已知语义，不写防御代码。

第一页在结果超过一页时额外补一句「先用 language / tags / query 收窄，比一页页翻省预算」，
替代旧文案里那句被换掉的「用条件缩小范围」。

## 验证

- `npm run typecheck`、`npm run build`、`node build.mjs --check`（产物与源码一致）全绿。
- **离线逻辑探针**：用 stub catalog（60 条、带 gender 标签）调真实 `execute`，覆盖
  默认页 / page=2 / 末页 10 条 / page=9 越界 / page=0 夹到 1 / gender 过滤后翻页 六种情形，输出符合预期。
- **真实音色库实测**（真 key，一次调用，无 LLM）：`language=ja` → 1000 条 / 40 页，
  page 1 / 2 / 40 的内容各不相同，page=99 给出越界提示。原始输出：
  `/root/projects/dsh-aivn-voice-pagination/e2e-artifacts/voice-pagination-demo.txt`（未跟踪）。
- 未跑 e2e：`verify-voice.mjs` 测的是 TTS 播放链路，`verify-stagehand.mjs` 只断言门控工具名，
  两者都不覆盖 `list_voices` 的参数行为；为一条分页判据真打 Fish 不划算。

## 检视

报告：`261009-voice-pagination.review.md`（reviewer 子代理）。结论**条件准入**，无阻塞问题。
两条建议已落实：

- **S1（产物路径 churn）**：原 worktree 在 `.worktrees/voice-pagination`，比主检出深两层，
  esbuild 写进 `lib/` 的源码路径注释因此变成 `../../../stage-ai/...`（主检出是 `../stage-ai/...`）。
  `build.mjs --check` 对宿主半边永远硬判，合回主检出后会误报产物过期。**处理**：把 worktree 移到
  `/root/projects/dsh-aivn-voice-pagination`（与主检出同层，同 `dsh-aivn-task-15` 的先例），
  在该处重建，`lib/index.js` 的 diff 里不再有路径 churn。附带删掉了原先为补相对路径而加的
  `.worktrees/stage-ai` 软链——同层之后 `file:../stage-ai` 天然解析得到。
- **S2（末页口径）**：见上「页码口径」。

非阻塞项处理：`VOICES_PER_PAGE` 改名避免与 catalog 的 `PAGE_SIZE` 同名异义；「一页 25 条」
只在参数描述里写一次；去掉死代码 `Math.floor`（`integer` 已严格校验，`Math.max(1, …)` 才是
必需的——schema DSL 没有 `minimum`）；补窗口缓存与页码稳定性的注释；越界消息补回窗口 / 全库数。

## 备注

- `scripts/init-worktree.sh` / `dev-worktree.sh` 按 worktree-dev 技能建在 worktree 里，但**不入库**：
  本仓库是公开的，且 AGENTS.md 已写明 `npm install` / `npm run build` / `dsh-e2e` 的用法，
  这两个只是本次工作的脚手架。
- 本仓库的 worktree **不放 `.worktrees/`**：多两层会改变 `lib/` 里的源码路径注释，
  撞上 `build.mjs --check` 硬判。放仓库父目录下（同层）即可。
- 合并时主检出正有另一个会话的进行中改动（`merge-to-main` 因此以 exit 4 拒绝）。按用户指示
  替它提交为 `2a998c6`（立绘色键底色 `keyColor` + 两个预设不吃宿主的技能与指令；提交前
  `typecheck` 与 `build.mjs --check` 均通过），随后本分支变基到它之上再 ff-only 合入。
  合并后 master 上 `build.mjs --check` 仍一致——`lib/index.js` 两处改动落在 bundle 的
  不相交区段，文本三方合并的结果与重新构建逐字节相同。
