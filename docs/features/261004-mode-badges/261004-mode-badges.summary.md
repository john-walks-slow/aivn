# 常驻模式标识（限制级通道 / 静音 / 自动）

## 需求

用户原话两轮：

1. 「是否处在 nsfw 模式也在 pending 栏展示」
2. 「那就常驻标识吧。静音模式、自动模式也加上。放在左上角 sidebar 展开按钮下面（和 pending panel 平齐）」
3. 「样式改成无边框、淡图标。nsfw 的图标就用 NSFW 英文字母」

## 结论

不做进 pending 栏（那是「正在生成的事」的账本，行会退场），改成舞台内容区左上角的常驻标识：

- 三种模式各一枚，只报状态不做开关（语音与自动的开关本来就在对话框右下角那一排，这里再摆一份就是同一动作两个控件）。
- 三种全关时整行不渲染——常驻的空行只是给画面添 chrome。
- 位置：`top: calc(60px + env(safe-area-inset-top))`、`left: 12px`，与右上角 pending 面板同一条水平线；纵向让开左上角那枚侧栏唤出键（10~42px）。
- 样式：无边框、无底色的一行淡痕（`--dialog-ink-faint` + `--dialog-text-shadow`），限制级用 `NSFW` 四个字母，静音/自动用 lucide 字形（`volume-off` / `play`），可读名交给 `title`。

## 实现

- `packages/core/src/ws/protocol.ts`：hello 加可选 `nsfw?: boolean`；新增 ServerMessage 变体 `{ type: "nsfw"; active: boolean }`（只在翻转时发，接上之前的实况以 hello.nsfw 为准）。
- `apps/server/src/orchestrator.ts`：`nsfwChannel` getter 与事件打标同口径（`nsfwActive || nsfwPendingEnter`）；`nsfwSignalled` 记账 + `broadcastNsfw()`（值没变不发）；调用点 = onEnterNsfw 回调、runBeatTurn 兑现进入、closeNsfwBeat 熄灭、cancelBeat 腰斩、restoreBranchState 分支回退；构造函数恢复时把记账对齐，避免读档续演白发一条。
- `apps/server/src/playhouse.ts`：helloPayload 带 `nsfw: runtime.orchestrator.nsfwChannel`。
- `apps/web/src/stage/useStageSocket.ts`：`nsfw` 状态（hello 初始化 + `nsfw` 增量）。
- `apps/web/src/stage/StageModes.tsx` + `views/StageScreen.tsx` + `app.css`。
- 窄屏避让：`@media (max-width: 520px)` 下用兄弟选择器 `.stage-modes ~ .prompt-queue` 把展开的排队面板下移一行（60px → 96px）。360px 手机上标识到 x=192、面板从 x=68 起，同一条线上必然压住；面板不透明底会把标识盖死。收起态徽标（约 50~60px 宽）横向本来就跟标识错开，不动它；标识不存在时面板照旧在 60px，不留空洞。

## 验证

- `pnpm typecheck` 干净。
- `pnpm --filter @aivn/server test test/orchestrator.test.ts test/playhouse.test.ts` → 93 passed（含新增的「腰斩正在请求进入限制级的那一轮：标识跟着熄灭」；「跳回段内」那条补了逆向跳转的广播断言）。
- `pnpm --filter @aivn/web test test/stageModes.test.tsx` → 4 passed。
- dev 实例实拍：点 MUTED / AUTO 出标识；限制级那枚用一个 `runtime.nsfw.active=true` 的临时周目驱动（真进限制级要跑一轮真模型并调 `enter_nsfw`，代价不划算），切回原周目后立刻消失——标识确实跟服务端通道走。临时周目已删，原周目存档未改。
- 窄屏/宽屏定位用 DOM 实测：360px 下标识 12~192、面板 96 起（避让生效）；1440px 下两者同在 y=60（平齐）。

## 遗留

- 横屏刘海机的 `safe-area-inset-left/right` 未加（竖屏恒为 0；加了只会让标识与面板不再严格平齐，暂不加）。
- 标识行 `flex-wrap: wrap`，将来模式变多或大字号缩放下换行，仍可能与排队面板重叠——真要扩到四五枚时把顶栏左右两组浮层收进同一个容器排布。
