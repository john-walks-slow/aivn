# 待注入队列落进台词条底缘

## 需求

用户原话：

> 把 pending panel 指示符和触发器完全融入消息框右下角的现在放 spinner 的位置，
> （并且也改成通过点击那里展开 pending panel）

即：舞台的待注入队列面板不再从画面右上角浮出来，它的「指示符 + 触发器」那枚徽标
搬进台词条（消息框）底缘——就是现在画 spinner 的那个槽位；点它展开面板。

## 现状

- 待注入面板（`PromptQueuePanel`，宿主 `apps/web`）在舞台视图里是一枚 **absolute
  浮在画面右上角**、导演栏正下方的徽标（`.prompt-queue-badge`），点开长出一列详情。
- 台词条底缘 `.dialog-foot` 有两个区：左边 `.dialog-hint-foot`（spinner + ▼ +
  「点击舞台继续生成」），右下角 `.dialog-options`（快捷菜单胶囊）。
  spinner 是 `packages/stage` 的 `StageTheater` 在 `live` 时画的，意思是「剧作家正在写」。

实拍量的坐标：

| 视口 | spinner | 快捷菜单胶囊 |
| --- | --- | --- |
| 1440×900 | x≈257（台词条底缘**左侧**，对齐正文左边缘） | x≈1036~1440（右下角） |
| 390×844 | x≈246~378（底缘那一行独占一行且**右对齐**，即右下角） | 下一行，同样右对齐 |

所以「消息框右下角现在放 spinner 的位置」在手机上是字面成立的，宽屏上 spinner 在左下。
裁决（full-auto 下问的 auto_human）：**取 A 方案——徽标原位替换 spinner 的槽位，
不额外移动现有提示，宽屏留在左下、手机在右下**。理由是宽屏右下角已经被快捷菜单胶囊
占着，硬塞过去会互相挤；而「没明确要求的视觉不顺手改」是用户一贯的要求。

## 方案

1. **舞台包开一个槽位**：`StageTheater` 新增可选 prop `dialogStatus?: ReactNode`，
   在 `.dialog-hint-foot` 里**顶掉**内置 spinner（宿主给了槽位就不画 spinner）。
   `dsh-aivn` 那条线不传这个 prop，照旧画 spinner——共享包不引入待注入队列的概念。
2. **徽标改成底缘的芯片**：`PromptQueuePanel` 的舞台形态从「浮层徽标」改成
   「台词条底缘的一枚芯片」——透明底、走 `--dialog-ink*` 令牌（跟底缘那行同源），
   悬停浮出一层薄底，与快捷菜单按钮同一套手感；点它展开面板。
3. **展开的面板锚在芯片上**：面板 `createPortal` 到 body、`position: fixed`，
   开的时候量一次芯片的位置写进内联样式。走 portal 的两个理由：
   ① 台词条在窄屏是 `overflow-y: auto` 的滚动区，留在里面会被裁掉；
   ② 台词条 z-index 12 自成层叠上下文，留里面压不过舞台顶部那几条 chrome。
4. **工坊那一路不动**：`dock` 形态（内容区底部一条）保持原样。两态改用
   `variant: "dialog" | "dock"` 表达，替掉原来的 `dock?: boolean`。
5. 舞台右上角那枚浮层徽标整块撤掉（就是「完全融入」）。

## 影响面

- `packages/stage`（共享包，构建期打进 `dsh-aivn` 的 `lib/`）→ 需双边验证。
- 宿主 `apps/web` 的 `PromptQueuePanel` / `StageScreen` / `app.css`。
- 测试：`apps/web/test/pendingPanel.test.tsx` 按新类名与行为更新。
