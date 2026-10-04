# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)，格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### 变更

- **默认代理留空直连**：`tts.proxy` / `exa.proxy` 此前默认写死一个本机代理端口，没跑代理的机器上语音与联网检索会先连过去再失败；现在默认空、要用自己填（`STAGE_TTS_PROXY` / `STAGE_EXA_PROXY` 照旧可用）。

### 移除

- 素材与样例剧目彻底不进仓库：`library/` 素材、`assets/` 立绘与音频、`plays/` 样例剧目连同其历史一并剥离（数据目录本来就不进 Git）。
- 一次性素材生成脚本改为从环境变量读凭据与网关地址，不再内置任何真实 Key。
- 一次性的内部排障记录移出仓库，只保留面向使用者的网关配置说明。

## [0.1.0] - 2026-10-04

第一次公开发布。

### 新增

- **Windows 桌面版**：Tauri 2 桌面壳（`apps/desktop/`）+ 自包含服务端 exe 作 sidecar。装完双击出窗口、带图标，标题栏里直接显示局域网地址，手机连同一个 Wi-Fi 就能接着玩。同时发布免安装 zip。
- **配置面改为 `settings.json` + 设置页**：`<数据目录>/settings.json` 是运行期设置的唯一真相源，页面保存即落盘并**立即生效**（不用重启，正在演的剧目在本轮写完之后换用新设置）；手工编辑该文件同样即时生效。首次启动时若存在旧 `.env`，按旧语义一次性迁移过来。
- 新装默认：网关留空并给一条直达设置页的引导，生图 / 语音 / 联网检索默认关闭。
- 打包链路：`scripts/build-exe.mjs`（单文件 exe + 免安装 zip）、`scripts/build-desktop.mjs`（+ NSIS 安装包）、`scripts/make-app-icon.mjs`（图标全套）。
- `--selftest`：逐条体检打包后的前端产物、技能库、数据目录与 sharp，一条命令定位「双击没反应」。
- GitHub Actions 发布工作流：打 tag 自动出安装包与 zip，挂到 Release。
- **局域网访问收进设置页**：新装默认只听 `127.0.0.1`（此前默认 `0.0.0.0`，能不能连全看用户在 Windows 防火墙弹窗上点没点「允许」，点了取消还会留下一条阻止规则）。设置页新增「局域网访问」：开关打开即改听 `0.0.0.0`（端口不变、就地生效）、列出手机该连的地址；「允许局域网访问（Windows 防火墙）」按钮替用户提权写一条**按程序**放行的入站规则，**并清掉点「取消」时系统自己写下的同程序阻止规则**（显式阻止优先于放行，只加放行救不回来），给点过取消、或根本没弹窗的情况兜底。`--host` / `STAGE_HOST` 仍然优先。

### 变更

- **改名 AIVN**：包名 `@stage-ai/*` → `@aivn/*`、根包 `stage-ai` → `aivn`（exe / zip / 解压目录名随之变）、日志前缀、Basic realm、cookie 与 localStorage 前缀、页面标题一并换掉。舞台语义（Stage DSL / StageTheater / `STAGE_*` 环境变量）保持不动。
- **新装不再随包发任何样例剧目**：装完打开就是一座空剧场，由「新建剧目」/「导入剧目包」起步。此前随包一份《黄昏教室》样例，第一次启动时解到数据目录；打包又跟着把开发机上该剧目的存档与 930 个 TTS 缓存一起打进安装包——新装的剧目卡直接写着别人的「1 周目」，Windows 安装包还多背 35MB。
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
