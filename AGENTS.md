# AIVN —— 项目级指引

本项目的模块级指引按目录分开放；动手改某个模块前，先读那一份。

## 模块指引

- `apps/server/` —— 后端：REST + WS 舞台广播 + 演出编排、工坊会话、模型与素材。见 [`apps/server/AGENTS.md`](apps/server/AGENTS.md)。

- `apps/web/` —— 舞台演出层（React 19 + vite）与工坊界面。见 [`apps/web/AGENTS.md`](apps/web/AGENTS.md)。

- `apps/desktop/` —— 桌面壳（Tauri 2）：一层窗口 + 一个由它拉起的服务端 sidecar。见 [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md)。

- 数据目录（打包态 = exe 同级 `data/`，开发态 = 仓库根）—— `plays/` 剧目、`library/` 素材库、`media-cache/` 可重建缓存、`settings.json` 运行期设置。**整个数据目录不进 git**；仓库也不发任何样例剧目，新装打开就是一座空剧场，由「新建剧目」/「导入剧目包」起步。

- 其他：`packages/core` —— Stage DSL 规范、流式解析器、IR 事件、WS 协议与谱系数据模型；`scripts/` —— 开发与打包脚本；`apps/server/skills/` —— 跨剧目的通用做法速查（只给工坊的 `read_skill`，随包只读，**技能库只此一处**）；`docs/` —— 需求、问题与规范记录。

- **两条发行线**：本仓是 AIVN 的领域与完整产品线；`dsh-aivn`（兄弟仓）是同一套领域在 DSH 宿主上的适配线。两仓共享 `packages/core` 与 `packages/stage`——**改共享包会静默传到 DSH**（构建期打进它的 `lib/`），所以改完必须双边验证。**改了什么该跑什么**见 [`docs/references/261009-cross-host-verification.md`](docs/references/261009-cross-host-verification.md)。

- 提示词/工具/能力位的漂移守卫：`pnpm check:agent-contract`（改 `prompt.ts`、`workshop.ts`、`agentkit/**` 或 `apps/server/skills/**` 后跑）。

## 开发与调试

```bash
pnpm -r build          # core 改动后 web/server 走 workspace dist 类型，必须重建
pnpm typecheck
pnpm test
pnpm --filter @aivn/server start    # 起后端（顺带把 apps/web/dist 挂在同一个端口）
pnpm --filter @aivn/web dev         # 开发态前端 :5180，代理到 8787
```

只跑指名的用例时**不要写 `pnpm test -- <文件>`**：pnpm 会把那个 `--` 原样拼进命令行（回显是 `$ vitest run -- test/x.test.ts`），而 vitest 把 `--` 之后的一切当成非选项参数丢掉——过滤器不生效、静默跑全量，看起来还全绿，没人会发现范围没生效。正确写法是直接跟在脚本名后面：

```bash
pnpm --filter @aivn/server test test/config.test.ts       # 文件名直接跟，不要 -- 分隔
```

打包（**只能在 Windows 上跑**，Tauri 不支持交叉编译到 Windows）：

```bash
pnpm exe               # 服务端单文件 exe + 免安装 zip → build/
pnpm desktop           # 上面那份 exe 当 sidecar，再出 NSIS 安装包 → build/
pnpm icon              # 改了 apps/desktop/icon.svg 之后重生成图标全套
```

版本号有四处必须一起改：根 `package.json`、`apps/desktop/package.json`、`apps/desktop/src-tauri/tauri.conf.json`、`apps/desktop/src-tauri/Cargo.toml`（`pnpm desktop` 会核对，漂了直接报错）。

## 配置面

- 运行期设置的唯一真相源是 **`<数据目录>/settings.json`**，`apps/server/src/settingsStore.ts` 持有它的内存镜像并监听手改。设置页只是它的编辑器。
- 改设置**必须就地生效**：持有者每次使用时从 store 现取，不要在构造时把字段拷进局部变量——那正是「改完要重启」的来源。需要重建的订阅 `store.subscribe`，且只在**轮边界**重建，不腰斩演出。
- 留在环境变量里的只有启动参数（`STAGE_PORT` / `STAGE_HOST` / `STAGE_DATA_DIR`）与出口代理（`HTTP_PROXY` / `HTTPS_PROXY`），以及不进 UI 的抠底调参 `STAGE_CUTOUT_*`。
- 新增一个设置项要同时动四处：`config.ts` 的 `ServerConfig` + `freshSettings` + 校验、`configApi.ts` 的读视图与写映射、设置页表单、README 的「设置页字段总表」。

## 素材资源库（library/）

- `library` —— 应用级素材资源库（数据目录下的 `library/`，**整个不进 git**）：`<kind>/<id>/{meta.json, 素材文件}`，kind ∈ `backgrounds`/`cg`/`characters`/`sprites`/`bgm`/`sfx`，**目录名即素材 id**。
- 服务端只读（增删改由用户在本地目录做，UI 不管这块）。
- `characters/` 与 `sprites/` 是**多文件类目**：前者是「一张角色卡 + 可选立绘」（导入时立绘落 `assets/sprites/<条目 id>/`，之后可被卡上的 `sprite:` 绑到别的目录），后者是「只有立绘、没有卡」（机甲、道具、猫）。一个主体（舞台上的一个 id）就这么两张**各自可选**的附件，谁也不依赖谁——`characters/` 条目可以零媒体，`sprites/` 条目一张卡都没有。
- 种子的出处与逐条许可见 `docs/features/260930-asset-library/seed-sources.research.md`。
