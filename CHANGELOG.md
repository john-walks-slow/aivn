# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)，格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [0.1.0] - 2026-10-04

第一次公开发布。

### 新增

- **Windows 桌面版**：Tauri 2 桌面壳（`apps/desktop/`）+ 自包含服务端 exe 作 sidecar。装完双击出窗口、带图标，标题栏里直接显示局域网地址，手机连同一个 Wi-Fi 就能接着玩。同时发布免安装 zip。
- **配置面改为 `settings.json` + 设置页**：`<数据目录>/settings.json` 是运行期设置的唯一真相源，页面保存即落盘并**立即生效**（不用重启，正在演的剧目在本轮写完之后换用新设置）；手工编辑该文件同样即时生效。首次启动时若存在旧 `.env`，按旧语义一次性迁移过来。
- 新装默认：网关留空并给一条直达设置页的引导，生图 / 语音 / 联网检索默认关闭。
- 打包链路：`scripts/build-exe.mjs`（单文件 exe + 免安装 zip）、`scripts/build-desktop.mjs`（+ NSIS 安装包）、`scripts/make-app-icon.mjs`（图标全套）。
- `--selftest`：逐条体检打包后的前端产物、技能库、样例剧目、数据目录与 sharp，一条命令定位「双击没反应」。
- GitHub Actions 发布工作流：打 tag 自动出安装包与 zip，挂到 Release。

### 变更

- **改名 AIVN**：包名 `@stage-ai/*` → `@aivn/*`、根包 `stage-ai` → `aivn`（exe / zip / 解压目录名随之变）、日志前缀、Basic realm、cookie 与 localStorage 前缀、页面标题一并换掉。舞台语义（Stage DSL / StageTheater / `STAGE_*` 环境变量）保持不动。
- **全站去衬线字体**，界面统一一套无衬线。
- 数据目录语义收成一处：`plays/`、`library/`、`media-cache/`、`settings.json` 全在**数据目录**下（打包态 = exe 同级 `data/`，开发态 = 仓库根）。`STAGE_PLAYS_ROOT` / `STAGE_LIBRARY_ROOT` / `STAGE_PLAY_DIR` 不再是配置项。
- 端口 `0` = 交给系统挑一个空闲口，并把实际端口打印出来 / 报给桌面壳。
- 留在环境变量里的只剩启动参数（`STAGE_PORT` / `STAGE_HOST` / `STAGE_DATA_DIR`）与出口代理（`HTTP_PROXY` / `HTTPS_PROXY`）。
- 设置页补齐两项此前只存在于接口的配置：「限制级专属提示词」与「垫图策略」。

### 修复

- 桌面壳与内核对齐：内核读到 stdin EOF 即退出，桌面上关窗口不会留下一个占着端口、并在下次启动时和新实例抢同一份 `data/` 的孤儿进程。
- Windows 上 spawn `npm` 需带 `shell`（`.cmd` 不是可执行文件）；pnpm 11 默认拒绝跑依赖构建脚本，已显式批准必需的三项。
- 端口的 `0` 语义在 `startup.ts` 里不再被注释误导为「桌面壳专用」。

[Unreleased]: https://github.com/john-walks-slow/aivn/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/john-walks-slow/aivn/releases/tag/v0.1.0
