# e2e

集中的浏览器验收脚本目录。

## 为什么集中

此前浏览器脚本散落在 `docs/features/<feature>/` 下，每个自带 `chromium.launch(...)`。
后果有两个：

1. **无法统一审查 headless**：是否无头取决于各自有没有写 `headless` 字段。
2. **无法统一施加资源闸门**：散落脚本没有必经入口，内存保护无处挂载。

收敛到本目录 + `e2e/lib/browser.mjs` 后，headless 与启动参数只有一处需要审查。

## 使用

```bash
pnpm e2e:chat-scroll <web 地址> [输出前缀]
```

各脚本的参数含义见脚本头部注释。

## 约定

- **默认 headless**。一律通过 `e2e/lib/browser.mjs` 的 `launchChromium()` 启动，
  不要直接 `chromium.launch()`；直接调用会绕过统一审查点。
- **需要人眼看 VNC 时才用 headed**：`launchChromium({ headed: true })`，且要求
  `DISPLAY` 已设置（VNC 桌面通常为 `:1`）。若未设置会直接报错，避免静默退回。
- **不复用持久 profile**：本目录的脚本是回归验收，不承担反检测职责。
  需要反检测/过验证码的场景走 camoufox（见下）。
- 截图写入调用方指定的输出前缀，默认落 `/tmp`。

## 与其它浏览器路径的关系

本目录只覆盖 **headless 回归验收**。机器上还有两条 headed 路径，属刻意选择，
不收敛到这里：

| 路径 | 位置 | 形态 | 用途 |
| --- | --- | --- | --- |
| camoufox MCP | `~/.config/camoufox-mcp/settings.json` | `headless: false` + VNC | 反检测、人工协同过验证码 |
| flowcli-api | `.worktrees/flowcli-api/src/engine.py` | `--headed --persistent` | FlowCLI 抓取，按需拉起 |

内存量级参考（项目实测）：camoufox headed 单标签约 320MB、3 标签约 403MB；
patchright headed 约 1286MB / 1450MB。headless Chromium 一组进程约 500MB。

## 并发与内存保护

- 走 `dsh-e2e run` 的插件 GUI E2E：受 `dsh-e2e` 的**全局实例槽位**限制
  （默认最多 2 个实例，`DSH_E2E_MAX_INSTANCES` 可调）。
- 直接跑本目录脚本（不经 `dsh-e2e`）：可用 `e2e-memory-gate` 包装，
  它会在内存不足或已有浏览器运行时拒绝启动：

  ```bash
  e2e-memory-gate -- pnpm e2e:chat-scroll http://127.0.0.1:40774
  ```

背景与实测数据见 `docs/issues/261008-device-memory-management/261009-stage-ai-e2e-assessment.md`。
