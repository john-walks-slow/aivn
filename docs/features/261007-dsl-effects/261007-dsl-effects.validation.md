# DSL 动效 / 转场（Phase 1）用户验证

## 验证说明

- 验证对象：Stage DSL 新的舞台效果原语 `<fx>`（舞台级全局效果）与背景换层过渡
  （cut / dissolve / fade / fade-white），以及画面抖动、闪光、letterbox、暗角；并验证旧 bug——
  `<scene transition="cut">` 过去只落在无图占位、真背景固定走淡入——已修复。
- 环境/前置条件：本机起后端（`pnpm --filter @aivn/server start`），浏览器打开舞台；
  选一个有背景与立绘的剧目（无现成的可让剧作家用一段剧本铺一个场景）。
- 无法用单元测试可靠验证的部分：真实渲染的交叉溶解/硬切观感、抖动不位移布局、遮罩层叠与
  reduced-motion 行为。以下场景需实机确认。

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- |
| 让剧本连续写两场不同背景，先写 `<scene bg="A" transition="cut"/>`，下一句再 `<scene bg="B" transition="cut"/>` | 背景**硬切**、无淡入淡出；不再出现「cut 无效」的淡入 | | 通过 | 用户实机验收 |
| 同上改用 `transition="dissolve"` | 新背景从旧背景上**交叉溶解**盖上来（不是从黑/透明淡入） | | 通过 | 用户实机验收 |
| 同上改用 `transition="fade"` | 画面**经黑场**淡出再淡入新背景 | | 通过 | 用户实机验收 |
| 同上改用 `transition="fade-white"` | 画面**经白场**淡出再淡入 | | 通过 | 用户实机验收 |
| 写 `<fx effect="flash" trigger value="red"/>` | 全屏红闪一下即消失；连写两条会各闪一次 | | 通过 | 用户实机验收 |
| 写 `<fx effect="shake" trigger value="heavy"/>` | 整个画面抖一下；**立绘相对布局不位移**（不出现立绘错位的残影） | | 通过 | 用户实机验收 |
| 写 `<fx effect="letterbox" on/>` 与 `<fx effect="vignette" on/>` | 出现上下黑边与暗角，持续存在 | | 通过 | 用户实机验收 |
| 接着分别写 `<fx effect="letterbox" off/>` 与 `<fx effect="vignette" off/>` | 黑边与暗角各自消失（互不影响） | | 通过 | 用户实机验收 |
| 写 `<fx effect="flash" on value="red"/>`，之后 `<fx effect="flash" off/>` | 画面常亮一层红（盖住立绘/CG）直到 off 撤掉 | | 通过 | 用户实机验收 |
| 写 `<fx effect="shake" on/>`，之后 `<fx effect="shake" off/>` | 画面持续抖动直到 off 停 | | 通过 | 用户实机验收 |
| 写 `<actor id="x" shot="close"/>` | 该角色推近特写（actor 属性，与 `<fx>` 无关） | | 通过 | 用户实机验收 |
| 演到有 flash/shake 之后，滚轮回看几句再回到最新 | 回看中不重放闪光/抖动；回到最新**不补放**一次闪光/抖动 | | 通过 | 用户实机验收 |
| 上述状态下刷新页面 | 持续效果（黑边/暗角/镜头景别）按谱系还原；过渡与闪光不重放 | | 通过 | 用户实机验收 |
| 系统开启「减弱动态效果」（prefers-reduced-motion）后重跑上面几条 | 无补间、无闪光、无抖动；状态直达终态 | | 通过 | 用户实机验收 |

## 验证结论

**通过**（用户 2026-10-07 实机验收）。

## 待跟进

无。
