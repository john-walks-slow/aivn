# 舞台左上角切换器与右上角导演栏配色及宽度对齐

## 现象与原因

1. 宽屏下工坊侧 `.studio-rail-switch .stage-view-segmented` 设置了 `display: flex; width: 100%` 且按钮 `flex: 1`，被撑满 210px 侧栏宽度（189px），而舞台侧 `.stage-view-segmented` 为 `inline-flex` 内容宽（139.47px），切换时两侧宽度不一致。
2. 舞台左上角切换器原本使用 `--stage-chrome-bg` 深蓝渐变玻璃底，深色模式下 `--accent` 提亮后导致底槽与选中胶囊撞色，且浅色模式下右半边未选中底槽为深蓝而非白底。
3. 舞台右上角导演栏 `.theater-director` 使用掺蓝渐变与 `opacity: 0.94`，导致浅色下的白与深色下的黑同左上角切换器不一致。

## 修复

- `apps/web/src/app.css`：
  - 移除 `.studio-rail-switch .stage-view-segmented` 的 `display: flex; width: 100%` 与 `.stage-seg-btn` 的 `flex: 1`，使宽屏下工坊侧与舞台侧切换器尺寸完全一致（`139.47px × 30px`）。
  - `.stage-view-segmented` 统一采用 `var(--bg)` 底槽、`var(--border)` 描边、`var(--muted)` 未选中文字色与 `var(--accent)` / `var(--accent-ink)` 选中胶囊（浅色模式 `#ffffff` 白底、深色模式 `#0d1117` 黑底）。
- `packages/stage/src/stage.css`：
  - 将 `--stage-chrome-quiet-*` 对齐为浅色 `#ffffff` 底 / `#e2e8f0` 边 / `#64748b` 字、深色 `#0d1117` 底 / `#30363d` 边 / `#8b949e` 字，移除 `.theater-director` 的 `opacity: 0.94` 与内发光，使右上角导演栏与左上角切换器的黑/白完全统一。
