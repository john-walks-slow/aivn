# 工坊写路径统一 · 实施记录

## 来源

2026-10-04 设计债清单第 1、4 条（用户选定本轮修 1~4、6，5 不做）。
工作区 `.worktrees/workshop-shell`，分支 `refactor/workshop-write-path`，基线 `main@4281ad7`。

## 债 1：play.json 三个写入口只有一个校验

**事实更正**：债单里写「白名单策略写了两遍（`playFiles.ts` 的 `isEditable`/`isVisible` vs
`playEnv.ts` 的 `denial()`）」——**不成立**。`denial()` 并没有重新实现白名单，它调用的就是
`PlayFiles.pathOf`，只是为错误消息多分了一种「不在剧目目录内」。真正的问题只有校验覆盖面：

| 写入口 | 白名单 | play.json 结构校验（改前） |
|---|---|---|
| agent `write`/`edit` → `PlayEnv.writeFile` | `pathOf` | ✅ 在 `PlayEnv` 里 |
| 文件页 → `WorkshopSession.writeFile` → `PlayFiles.write` | `pathOf` | ❌ 无 |
| 引用即导入（主角卡）、`PlayAssets` → `PlayFiles.write` | `pathOf` | ❌ 无 |
| bash | 无（进程内无沙箱，见 README） | ❌ 无 |

`PlayFiles.write` 才是**所有文本写口的收口**，所以校验搬到那里，`PlayEnv` 委派：

- `playFiles.ts` 新增 `assertPlayConfig(rel, text)`（`PLAY_CONFIG` 常量 + `parsePlayConfig`），
  在 `write()` 落盘前调用；失败抛 `play.json 结构校验不过，未落盘：<原因>`，文件一个字节不动。
- `playEnv.ts` 删掉自己那份 `parsePlayConfig`，只保留「早拒一次白名单」与「记撤销条」；
  写失败统一从 `files.write` 的异常转成 `FileError`（play.json → `invalid`，其余 I/O → `permission_denied`）。
- bash 仍然拦不住（它不走这一层），继续由收束时的读盘检查兜底——这条边界写在 README 里，不是遗漏。

## 债 4：「剧目被改动了」五条互不知情的路

改前有五个地方各自置旗或各自直接 `onFilesChanged()`：
`broadcastWrite` / `broadcastAsset` / `onToolDone("bash")` 各置 `changedDuringTurn`，
`writeFile` / `removeFile` 各自直接触发重建。

现在收成一个置脏口 + 一个收束口：

- `markChanged()` —— 唯一的置脏入口（四条路都从这儿过）。
- `applyChanges()` —— 唯一的收束出口：真有改动才跑；攒下的改动里跑过 bash 就先补一次
  play.json 读盘检查，坏了只告警不重建，否则触发 `onFilesChanged()`。
- 回合内攒着、收束时重建一次；文件页保存没有收束可等，`writeFile`/`removeFile` 就地兑现。
- `playConfigBrokenByBash()` 跟着收窄成 `playConfigBrokenReason()`：只负责读盘判定，
  「本轮跑没跑过 bash」这个前提交给 `applyChanges`（它得顺手把旗清掉）。

## 行为变化

1. 文件页 / 引用即导入写 play.json 时，结构不合法会**拒绝落盘**并以 400 返回原因
   （原来会写进去，然后在下一次 runtime 重建时炸在 `void` 的 promise 里）。
2. 回合内用文件页保存改动，重建由「立即 + 回合末各一次」变成「就地一次」——不再腰斩两次演出。
   回合外的保存照旧立即生效。
3. 其它文本文件（记忆卡、theme.css、素材表）不受结构校验影响。

## 验证

```
cd apps/server && npx tsc -b --force                 # exit 0
npx vitest run test/playEnv.test.ts test/workshop.test.ts test/agentkit.test.ts
    → 3 files / 78 tests passed
npx vitest run test/assetLibrary.test.ts test/playAssets.test.ts test/http.test.ts \
    test/store.test.ts test/workshopPrompt.test.ts test/voiceTool.test.ts
    → 6 files / 98 tests passed
```

新增用例：`workshop.test.ts` 的「play.json 的结构校验长在唯一的文本写口上（文件页手写也绕不过）」
——非法 JSON 与「合法 JSON 但缺 title」都被拦，盘上的 play.json 逐字未变；其它文本文件照写。

## 未做

- 债 5（`PlayFiles.pathOf` 抛中文串当 API）：用户明确本轮不做。
- `denial()` 与 `pathOf` 的边界判定仍有一次重叠（三个 `resolve`/`sep` 检查散在 `playFiles.ts` 里），
  量小且各自服务不同的错误消息，本轮不动。
