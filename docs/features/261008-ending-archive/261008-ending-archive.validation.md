# `<ending>` 退化为纯归档标签 用户验证

## 验证说明

- 验证对象：Stage DSL 的 `<ending/>` 从「自带结局卡」退化为**纯归档标签**（不产生任何画面）、
  `title` 改名 `name` 并新增 `summary`、`<epilogue>` 标签与收束轮次整体删除，以及支撑这轮改动
  **引号感知定界**（属性值里出现 `>` 不再截断标签）。

- 环境/前置条件：
  - 本仓库 `pnpm -r typecheck`；core / stage 单测（全绿）。
  - 起应用：本 worktree 的 `./scripts/dev-worktree.sh`。
  - ⚠️ **本仓应用里无法验证终局态**：`apps/web` 从来没有接过 `ending`——`git log -S'EndingCard' -- apps/web/src/`
    无结果，`StageScreen.tsx` 从不传 `ended`，`apps/server` 的提示词里**没有 `<ending>` 这一章**，
    本地 `plays/` 里也没有任何结局脚本。整套终局行为（不摆停止点、不记第二遍账、分支/冷开重建）
    只存在于 **dsh-aivn**。所以下表里的终局场景**只能等 dsh-aivn 侧任务落地后在插件实例上验**。

- **自动化已覆盖、不列入下表的部分**（这些不必再请用户实机确认）：
  - 解析器的全部行为：引号定界（含撕裂喂入、引号未闭合等待、含 `>` 的既有标签）、旧 `<epilogue>`
    降级（独立 / 嵌在 `<say>` 内 / 内含游离标签）、`title=` 告警、`content_after_ending` 丢弃 ——
    `packages/core/test/parser.golden.test.ts` 68 条。
  - 终局态不出出口的判定逻辑：`stopAffordance` 的 `ended` 闸（含 no_stop / 继续卡 / pause 四种组合）——
    `packages/stage/src/playbackState.test.ts` 4 条。
  - `EndingCard` 的删除与导出面收窄：`pnpm -r typecheck` 全绿即证明无残留引用。
  - 本地 `plays/` 无任何 `<ending>` / `<epilogue>` 脚本（已 grep），故**本仓没有存量剧本要迁移**。

## 验证项

| # | 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- | --- |
| 1 | 打开本 worktree 实例的舞台，演任意一轮普通戏（`<scene>` / `<say>` / `<stop>` 那套）。 | 与改动前完全一致：背景切换、台词打字机、停止点选项/自由输入都正常；无报错、无解析告警。 | | 待验证 | 引号感知定界动的正是标签头的定界，这是它唯一的回归面 |
| 2 | 【待 dsh-aivn 落地后】让剧作家用 `<scene>` / `<title>` / `<narrate>` 搭终幕，末行写 `<ending id="v1" name="测试结局" summary="归档摘要。"/>`。 | 终幕画面**完全按剧本自己搭的内容**演，**没有任何「— 剧终 —」卡片浮出来**；结局标签本身不上屏。 | | 待验证 | 本仓 app 无 ending 概念，须在插件实例上验 |
| 3 | 【待 dsh-aivn 落地后】接上一步看这一轮演完后的舞台。 | 不出现「点击舞台继续」提示，点画面也不推进；这一轮不再摆选项面板或自由输入框。 | | 待验证 | 闸的判定逻辑已有单测，这里验的是 dsh-aivn 真的把 `ended` 传进来了 |
| 4 | 【待 dsh-aivn 落地后】让剧作家写一条 `summary` 里**含 `>` 号**的结局；以及一条数百字、含中文引号「」的结局。 | 结局正常落档、进入终局态；**不出现「结局整条消失、还能点继续」**这种静默走过结局的现象；长摘要不卡顿、不上屏。 | | 待验证 | 引号定界修的就是这条链路；解析层已有单测，这里验端到端 |

## 验证结论

待验证。

## 待跟进

- **终局场景（上表 2–4）依赖 dsh-aivn 侧任务**：那边落地后需回到本表补验。dsh-aivn 的跟进项
  （提示词 `title`→`name`、删 `<epilogue>` 收束轮次、删 `EndingCard` 接线、账本 `summary` 取值路径）
  见 `261008-ending-archive.summary.md` 的「遗留 / 交接到 dsh-aivn 任务」。
- **worktree 预览实例的两个环境问题都已修**，实例现在开箱可用：
  1. `PlayLibrary.list()` 不认软链目录（`readdir(withFileTypes)` 报链接自身类型的坑）→ 已改为跟随链接再判类型，
     剧目列表正常显示 8 个剧目（均为软链）。回归用例见 `apps/server/test/store.test.ts`。
  2. vite 起不来（`EMFILE: too many open files, watch …`）→ 根因是 inotify **instance** 上限（128）被容器
     常驻进程吃光，与 `ulimit -n` 无关；已在容器侧 `/opt/start-services.sh` 加 `apply_inotify_tuning()`
     （每次 boot 重设 `max_user_instances=1024`）。细节见 summary 与 `container-ops` 技能 §4.5。
- `apps/web` 有 5 条既有测试失败（`useWorkshopTurn.test.tsx` / `useWorkshopNewThread.test.tsx`），
  已在主干 `2f70dee1` 复现，与本次改动无关，不在本次验证范围。

