# 261004 打包与发布 · 计划

## 1. 目标

两条要求，合成一次交付：

1. **开箱即用的 Windows 应用**：`AIVN-<version>-x64-setup.exe` 装完双击出窗口、带图标；也提供免安装 zip（解压双击 `aivn.exe` 即可）。两条路都不需要装 Node、不需要编辑任何配置文件；同一实例同时能被局域网里的手机/平板访问。（形态在 P4 由「命令行 exe」升级为「桌面壳 + 内核 exe」，见 §4.5。）
2. **配置面改造**：启动不依赖 `.env`，绝大多数全局设置能在 UI 里改完**立即生效**，不需要重启服务。

外加"准备公开"：仓库补齐开源发布所需的东西（LICENSE、README、示例配置、发布工作流），并做一次隐私/历史扫描。

## 2. 现状审计：全局设置里有多少是环境变量

`apps/server/src/config.ts` 的 `loadConfig(env, repoRoot)` 一次性把 40 个 `STAGE_*` 读成一个**不可变的 `ServerConfig`**，`index.ts` 把它交给 `PlayHouse` / `VoiceCatalogService` / `SettingsFile` / `WebGate`。设置页改的是 `.env` 文件，进程内那份 `ServerConfig` 纹丝不动，所以只能"改完重启生效"。

### 2.1 逐项分类与结论

| 变量 | 现在的作用 | 应该归谁 | 结论 |
| --- | --- | --- | --- |
| `STAGE_PORT` | 监听端口 | 启动参数 | 保持启动期（exe 用默认 8787，占用时自动换口并打印） |
| `STAGE_PLAYS_ROOT` / `STAGE_LIBRARY_ROOT` | 数据根目录 | 启动参数 | 收成单一 `STAGE_DATA_DIR`；exe 默认 `<exe 同级>/data` |
| `STAGE_PASSWORD` | HTTP Basic 访问密码 | 设置项 | 见开放问题 Q1 |
| `STAGE_MODEL_ID` / `STAGE_MODEL_BASE` / `STAGE_MODELS` / `STAGE_BASE_URL` / `STAGE_API_KEY` / `STAGE_MAX_TOKENS` | LLM 网关 | 设置项 | 迁到 `settings.json`，UI 改完**立即生效** |
| `STAGE_CONTEXT_WINDOW` / `STAGE_COMPACT_RATIO` / `STAGE_KEEP_RECENT_TOKENS` | 纪元压缩 | 设置项 | 同上（UI 已有字段） |
| `STAGE_WORKSHOP_*`（3 个） | 工坊线程压缩 | 设置项 | 现在 UI 里根本没有 → 补进"高级"折叠区 |
| `STAGE_BEAT_TIMEOUT_MS` | 单轮超时 | 设置项 | 同上补进高级区 |
| `STAGE_NSFW_MODEL_ID` / `STAGE_NSFW_PROMPT` | 限制级通道 | 设置项 | UI 已有，改为热生效 |
| `STAGE_IMAGE_*`（9 个） | 生图后端 | 设置项 | UI 已有，改为热生效 |
| `STAGE_TTS_*`（5 个） | 语音 | 设置项 | UI 已有，改为热生效 |
| `STAGE_EXA_*`（5 个） | 联网检索 | 设置项 | UI 已有，改为热生效 |
| `STAGE_CUTOUT_*`（5 个） | 抠底算法调参 | 常量/环境 | 不进 UI：属算法调参，README 已有说明 |
| `HTTP_PROXY` / `HTTPS_PROXY` | 出口代理 | 环境 | 保持环境（代理本来就是部署层的事） |
| `STAGE_PLAY_DIR`（`.env` 里有，代码里没人读） | 死键 | 删除 | 顺手清掉 |

**判断**：真正"只能在环境里"的只有**端口、数据目录、出口代理**三项，其余都是用户配置，理应 UI 可改。现状把 30+ 项塞进启动期快照，不合理。

### 2.2 阻碍热更新的几个快照点（必须一起改，否则"改了不起作用"）

| 位置 | 问题 |
| --- | --- |
| `provider.ts:40` `envApiKeyAuth("cpa", ["STAGE_API_KEY"])` | 网关 key 走 **env**，改设置页的 key 对已发出的请求无效 |
| `webAuth.ts:36-40` `WebGate(password)` | 构造时快照密码 |
| `voiceCatalog.ts:84` `new ProxyAgent(config.tts.proxy)` | 构造时快照 TTS 代理 |
| `playhouse.ts:125` `private readonly config: ServerConfig` | 持有整份启动快照；按剧目缓存的 runtime 亦引用它 |
| `index.ts:17` `repoRoot = new URL("../../../", import.meta.url)` | 打包后指向快照虚拟路径 |
| `index.ts:23,27` `media-cache/voices.json`、`apps/web/dist` | 同上，打包后找不到可写/只读目录 |
| `skills.ts:19` `join(dirname(import.meta.url), "..", "skills")` | 同上 |

## 3. 方案 A：配置面改造（工作区 `config-store`）

### 3.1 存储：`<dataDir>/settings.json`

- 单一真相源。JSON、嵌套结构与 `SettingsView` 对齐，原子写（临时文件 + rename，权限 0600）。
- **`.env` 只当一次性迁移来源**：首次启动时若 `settings.json` 不存在而 `.env` 存在 → 把认识的键导入 `settings.json`，日志打印一句"`.env` 已导入 settings.json，此后以设置页为准"。之后 `.env` 不再参与解析（避免"两个地方都能改、只改一个然后发现没生效"的历史坑）。
- 手改 `settings.json` 也能生效：`fs.watch` + 去抖重载。
- `.env` 仍保留三个启动期键（`STAGE_PORT` / `STAGE_DATA_DIR` / `STAGE_HOST`）与标准 `HTTP(S)_PROXY`，它们不进 UI。

### 3.2 运行期：`ConfigStore` 取代不可变 `ServerConfig`

```
ConfigStore.current(): ResolvedConfig        // 每次调用拿当前快照
ConfigStore.update(patch): {changed[]}       // 校验 → 落盘 → 换快照 → 广播
ConfigStore.subscribe(fn)                    // 供 playhouse / voiceCatalog 重建实例
```

- 校验与 `.env` 版共用同一套解析器，非法值**直接报错给 UI**（不再静默回退）。
- 换快照后通过 WS 广播 `config_changed`，所有打开的页面（含设置页）刷新，多标签页不再各自持旧值。
- 需要重建的持有者订阅 `subscribe`：`VoiceCatalogService`（代理/keys）、`PlayHouse`（不再持有 config，改为持有 store）。
- 按剧目缓存的 runtime 在**轮边界**重建，与既有的 `rebuildAtBeatBoundary` 同一条路，不腰斩演出。

### 3.3 前端

- 设置页四处文案从"重启服务端生效"改为"立即生效"；保存后用 `PUT /api/config` 的返回值直接刷新 draft，不再需要整页回读。
- 新增「高级」折叠区：单轮超时、工坊压缩三项、出图并发/超时（现在在 UI 里但混在生图组）。原则：**默认收起来，不影响普通用户**。
- 启动期字段（端口、数据目录）显示为只读信息 + "重启生效"标识，仅此两项。
- 首次运行引导（见 3.4）。

### 3.4 零配置可用（首次运行路径）

1. 无 `settings.json`、无 `.env` → 用内置默认启动：端口 8787，数据目录 = 启动位置。
2. 前端首屏若读不到网关模型清单（`GET /api/agents/models` 400），在剧目库页顶部出一条引导条 →「设置模型网关」，直达设置页；填 base URL + API key + 选模型（下拉，来自网关）。
3. 生图/TTS/Exa 在新装默认**关闭**（`enabled=false`），配好并点"启用"才生效；避免默认对着 `127.0.0.1:9999` 打无人应答的请求。

## 4. 方案 B：Windows 打包（工作区 `windows-package`）

### 4.1 选型：`@yao-pkg/pkg`

已在真机验证：把 `apps/server` 用 esbuild 打成 CJS 单文件、交给 `@yao-pkg/pkg` 产出**单个可执行文件**，在本机（node22-linux-arm64）**能起服务、`/api/plays` 正常返回、sharp 正常加载**（pkg 把 `.node`/DLL 在运行时释放到缓存目录）。

对比：

| 方案 | 结论 |
| --- | --- |
| **`@yao-pkg/pkg`** | ✅ 选它。支持 Node 22/24、原生模块（sharp）、虚拟文件系统里能 `fs.readFile` 读打包进快照的 `web/dist` 与 `skills/`，可在 Windows 本机构建 |
| Node SEA（官方） | ❌ 只吃 CJS 单脚本、不支持从 node_modules 加载原生模块、无文件系统快照——本项目三样都踩 |
| `bun build --compile` | ❌ sharp 需要 `cwd/node_modules` 才能加载（实测），拿不到真正单文件 |
| Electron | ❌ 200MB+、形态是桌面窗口，与"浏览器 + 局域网"的产品形态不符 |

### 4.2 产物形态

```
aivn-<version>-<platform>-<arch>.zip
└─ aivn/
   ├─ aivn.exe            ← 免安装版双击即用（安装版则由桌面壳 aivn.exe 拉起）
   ├─ README.txt          ← 三步上手（解压/双击/浏览器）
   └─ data/               ← 首次运行自动创建
      ├─ settings.json    ← 设置页写这里
      ├─ plays/           ← 含随包附带的 demo 剧目
      ├─ library/         ← 空素材库
      └─ media-cache/
```

- 数据目录放 exe 同级 `data/`：便携、可见、可直接备份/拷贝；`--data-dir` 可改。
- `plays/demo` 随包附带（首次启动时若 `data/plays` 为空则解开内置副本），保证"双击就有东西可看"。
- exe 启动后：打印本机 URL 与局域网 URL → 自动打开默认浏览器（`--no-open` 关闭）。
- 监听 `0.0.0.0`；默认 8787，被占用则自动换口并打印实际端口。
- Windows 防火墙首次弹窗要允许（README 写清楚，并给一条管理员命令）。

### 4.3 构建链（可复现）

`scripts/build-windows.mjs`：

1. `pnpm install` → `pnpm -r build`（Windows 上装到的是 `@img/sharp-win32-x64`）
2. esbuild 把 `apps/server/dist/index.js` 打成 CJS 单文件（`--external:sharp`），
   用 `__importMetaUrl` 垫片替换 `import.meta.url`（打包后 ESM 语义丢失）
3. 与代码改造配套：新增 `apps/server/src/paths.ts`，集中回答三个问题——
   资源(只读，在快照里) / 数据(可写，在 exe 同级) / 是否打包态（`process.pkg` 存在）
4. `@yao-pkg/pkg` 打 exe（资产：`apps/web/dist/**`、`skills/**`、`plays/demo/**`）
5. 组装 zip

两条执行通道：
- **本机验证**：Windows PC（`X:/Coding/stage-ai`，与手机仓库用 git 镜像同步）上跑，产出的 exe 就在那台机器上真跑一遍。
- **正式发布**：GitHub Actions `windows-latest` 打 tag 触发，产物挂 Release。

### 4.4 验证

在 Windows PC 上：解压 → 双击 → 浏览器打开 → 建/开一个 demo 剧目 → 跑通一轮（需配置网关）→ 手机连局域网 URL 打开同一实例 → 立绘抠底（sharp）真跑一次。全部在真机做，不靠推断。

### 4.5 交付形态变更（2026-10-04 定案）：Tauri 2 桌面壳 + pkg 服务端作 sidecar

**改的是壳，不是内核。** §4.1–4.3 那条 pkg 链原样保留——它产出的 `aivn.exe` 从"用户双击的东西"降级为**内核进程**，由桌面壳拉起。

用户当时的话是「不要命令行服务器，要真正的、窗口化的、有图标的 Windows 应用」，并明确排除 Electron。选型：

| 方案 | 结论 |
| --- | --- |
| **Tauri 2 + 既有 pkg exe 作 sidecar** | ✅ 选它。壳只负责「拉服务 → 等就绪 → 开窗口指向它 → 收摊」，Rust 侧全部逻辑约 300 行；安装包 ~5MB 量级（服务端 exe 本身 147MB 走 sidecar 计入）；Windows 上直接用系统 WebView2（Win10 1803+ 自带/自动装），不额外背一个浏览器内核 |
| Electron | ❌ 用户明确不要，且 200MB+ 的壳与"服务端已经是单文件 exe"重复 |
| Tauri 2 + 把服务端 Rust 化 | ❌ 服务端是 5 万行 TS + sharp 原生模块，重写没有任何收益 |

壳的行为契约（`apps/desktop/src-tauri/src/main.rs`）：

- 单实例：`tauri-plugin-single-instance` **必须第一个注册**，第二次双击只把已有窗口顶到前台。
- 拉起：`<exe 同级>/aivn-server.exe --no-open --exit-on-stdin-close`，stdin/stdout/stderr 全 piped，Windows 上 `CREATE_NO_WINDOW` 防黑框闪。
- 就绪：stdout 里找首个 `http://127.0.0.1:<digits>`（90s 超时）→ `window.navigate(url)`。**不用固定端口**：服务端 `--port 0` 语义 + 从 stdout 读实际端口，避免和开发服务器/其他实例抢 8787。
- 局域网提示：就绪后 5s 内找含「局域网」且含 `http://` 的行 → 写进窗口标题。
- 收摊：`RunEvent::Exit` 先 take 掉 stdin（断管道）再 kill+wait；服务端侧 `--exit-on-stdin-close` 读到 EOF 自杀。双保险，且壳崩掉时内核回收管道这一路仍然生效。
- 失败可见：启动页 `window.aivnFailed(message)` 显示 stderr 尾巴（最多 40 行）；所有 sidecar 输出追加到 `<exe 同级>/data/desktop.log`。
- 图标：`apps/desktop/icon.svg` —— 冷蓝圆角底 + 两块纸白实心三角（上 `^` 下 `v` = AiVn 缩写）。刻意无外描边、无台口横线：黑描边会被深色任务栏吞掉造成视觉尺寸跳变，横线在 16–24px 糊成噪点。<br>由 `scripts/make-app-icon.mjs` 生成全套（`tauri icon` 顺手产出 android/ios 目录，已删）并拷一份 `favicon.ico` 给 web。

**新增/改动的构建脚本**：

- `scripts/build-desktop.mjs`（`pnpm desktop`）：非 Windows 直接抛错（Tauri 不能交叉编译到 Windows）→ 核对根 `package.json` / `tauri.conf.json` / `Cargo.toml` 三处版本一致 → 跑 `scripts/build-exe.mjs`（一趟出 exe + 免安装 zip）→ 按 `rustc --print host-tuple` 把 exe 拷成 `src-tauri/binaries/aivn-server-<triple>.exe` → `tauri build` → 把 NSIS 安装包拷成 `build/aivn-<version>-x64-setup.exe` → **删掉 sidecar 副本**（147MB，留着会让下次 `tauri build` 误判为最新）→ 打印路径/大小/sha256。
- `scripts/make-app-icon.mjs`（`pnpm icon`）：sharp 渲染 svg → png → `tauri icon` → 清理 → 拷 favicon。

**两条产物**（都挂 Release，各有适用场景）：

| 产物 | 适用 |
| --- | --- |
| `aivn-<version>-x64-setup.exe` | 要图标、要开始菜单项、要"像个应用"的普通用户。NSIS `currentUser` 模式装到 `%LOCALAPPDATA%\AIVN`，界面中英双语 |
| `aivn-<version>-win-x64.zip` | 要绿色免安装、U 盘带走、丢在任意目录就跑的用户 |

**已记录的坑**：NSIS 卸载会连 exe 同级的 `data/`（含剧目、素材库、settings.json、媒体缓存）一起删 → README 与本文件都要写明「卸载前先备份 `data/`」。

## 5. 方案 C：公开发布准备

- **LICENSE**：MIT（见 Q4）。
- **README 重写"安装"与"配置"两章**：面向 Windows 用户的 zip 安装 + 设置页配置为主，`.env`/源码运行收进"开发者"一节；逐项核对 README 覆盖全部配置面。
- **`docs/` 隐私清理**：`apps/web/vite.config.ts` 的 `allowedHosts` 含私人域名、`docs/issues/.../troubleshoot.md` 含公网站点地址 → 换占位符。
- **`.env.example`**：迁到 `settings.example.json` + 环境变量说明。
- **版本号** 0.0.1 → 0.1.0，加 CHANGELOG。
- **`.github/workflows/release.yml`**：tag → Windows 构建 → Release 附件。
- **发布前扫描**：按 `before-publish-repo` 阶段 A 走一遍（git 历史逐提交扫密钥/私人域名/宿主拓扑，统一提交者身份）。

## 6. 实施阶段

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| P1 ✅ | 方案 A 全部（配置面改造）+ `paths.ts`（原计划挂在 P2） | server 528 例 / web 154 例全绿；起实例改模型后不重启即生效；设置页与首启引导截图（§8） |
| P2 ✅ | 方案 B：pkg 打包成单文件 exe + 免安装 zip（§9） | Windows PC 真机跑通：selftest 全过、局域网手机访问通 |
| P3 ✅ | 改名 AIVN + 衬线字体改无衬线（§10） | `pnpm -r build` 全绿；web 157 例 / server 542 例全绿；本机产出 `build/aivn` + zip |
| P4 | 桌面壳：Tauri 2 + sidecar（§4.5、§11） | Windows PC 真机：安装包能装、双击出图标窗口、标题显示局域网地址、手机能连、失败有可读报错 |
| P5 | 方案 C：公开发布准备（LICENSE / README / CHANGELOG / Release 工作流 / AGENTS.md 校准 / 隐私扫描） | 逐项清单核对 + `before-publish-repo` 全流程 |

**工作区收拢**：P1/P2 原本各占一个 worktree。P3 期间把三条线并成一条分支 `feat/packaging-release`（单一 worktree `.worktrees/packaging-release`），后续 P4/P5 都在这里做，不再开新分支——桌面壳要同时碰服务端、根构建脚本和 web 图标，拆开只会制造合并冲突。

## 8. P1 实施记录（已落地）

- 运行期设置落在 **`<dataRoot>/settings.json`**（原子写 + 0600 + fs.watch 手改即生效）；
  首次启动没有该文件而环境里有旧 `STAGE_*` 时，按旧语义迁移一次并落盘，此后 `.env` 不再参与运行期配置。
- 留在环境变量里的只有三项：`STAGE_PORT` / `STAGE_HOST` / `STAGE_DATA_DIR`
  （打包后从 **exe 同级的 `.env`** 读，开发时从仓库根读；都不配也能直接跑）。
- 设置的读取一律「每次现取」：`playhouse` / `voiceCatalog` / `webAuth` / provider 都持 store；
  设置一变就重建进程级客户端，并让已加载的剧目在**下一个轮边界**换用新设置（复用写盘重建那条既有路径）。
- `provider.ts` 的网关密钥不再来自 `envApiKeyAuth(["STAGE_API_KEY"])` 快照——那正是「界面上改 key 完全没用」的原因。
- 新装默认：网关留空、生图/语音/联网全关；剧目库页在网关没配好时给一条直达设置页的引导（`/api/agents/models` 400 的文案已改成说人话）。
- 设置页新增：访问密码（掩码语义同凭据）、工坊压缩三项、单轮超时、只读启动参数；文案改为「保存后立即生效」。
- 数据目录语义变化：`plays/` `library/` `media-cache/` 从仓库根改为 **`<dataRoot>/`** 之下
  （开发时 dataRoot 仍是仓库根，行为不变；打包后是 exe 同级 `data/`）。
- 死键清理：`STAGE_PLAYS_ROOT` / `STAGE_LIBRARY_ROOT` / `STAGE_PLAY_DIR` 不再是配置项。
- 仍未做（原属 P1 的收尾）：README 的「配置」章节重写，随 P3 一起做。

## 9. P2 实施记录（已落地）

提交：`b279c85` 打包成开箱即用的单文件 exe、`aa545c4` 批准三个必须跑构建脚本的依赖、`a63ff15` Windows 上 spawn npm 要带 shell、`0800cd7` 端口支持 0。

- **构建链落成 `scripts/build-exe.mjs`**：esbuild 把 `apps/server/dist/index.js` 打成 CJS 单文件（`--external:sharp`、`import.meta.url` 垫片）→ `@yao-pkg/pkg` 出单文件 exe → 组装免安装 zip。exe 名与 zip 名由根 `package.json` 的 `name`/`version` 派生，改名后自动跟着变。
- **资源定位收敛到 `apps/server/src/paths.ts`**：一处回答「只读资源（快照里）/ 可写数据（exe 同级）/ 是否打包态」。`selftest.ts` 逐条体检前端产物、技能库、样例剧目、数据目录、sharp。
- **`cli.ts` 补全启动开关**：`--port` `--host` `--data-dir` `--open/--no-open` `--selftest` `--help`，打包版默认开浏览器。
- **随包说明 `scripts/packaging/exe-readme.txt`**：模板占位 `{{name}}` / `{{version}}`，打包时替换。写清了防火墙放行、`--selftest` 自查、杀软误报、数据目录位置。
- **踩到的坑**：
  - Windows 上 `spawn("npm")` 必须带 `shell: true`（`.cmd` 不是可执行文件）。
  - pnpm 11 默认拒绝跑依赖的构建脚本 → `pnpm.onlyBuiltDependencies` 显式批准 sharp 等三个，否则安装"成功"但原生模块是空的。
- **真机验证（Windows PC）**：`aivn.exe --selftest` 全过；双击启动后手机 `curl --noproxy '*' http://<局域网IP>:8901/` → 200，局域网访问通（`<局域网IP>` 是本机在 `192.168.0.0/16` 里的地址）。

## 10. P3 实施记录（已落地）

提交：`a8bd189` 改名 AIVN、`607339d` 去衬线字体。

- **改名**：`@stage-ai/*` → `@aivn/*`；根包 `stage-ai` → `aivn`（exe、zip、解压目录名随之变）；日志前缀 `[stage-ai]` → `[aivn]`；Basic realm → `aivn`；cookie `stage_session` → `aivn_session`；`localStorage` / 事件前缀 `stage-ai:` → `aivn:`；测试临时目录 `stageai-` → `aivn-`；页面标题与脚本里的 `Stage-AI` → `AIVN`。共 117 个文件。
- **刻意不改**（后续也别改）：舞台语义（Stage DSL、StageTheater、CSS 类名、`packages/core/src/dsl/spec.ts` 里的历史文档路径）、`STAGE_*` 环境变量、`docs/` 下的历史记录。
- **字体**：`apps/web/src/app.css` 删掉 `--font-serif` 定义，18 处 `font-family` 统一到 `var(--font-ui)`。全站一套无衬线。
- **验证**：`pnpm install`（lockfile 仅 4 行变化）；`pnpm -r build` 全绿；web 157 例、server 542 例（+3 skip）全绿；本机 `node scripts/build-exe.mjs --skip-build` 产出 `build/aivn`（120.8MB）与 `build/aivn-0.0.1-linux-arm64.zip`（57.2MB）。

## 11. P4 实施记录（桌面壳）

- **服务端为壳让出的两个接口**：
  - `--exit-on-stdin-close` → `LaunchOptions.exitOnStdinClose`，`startup.ts` 的 `exitWhenStdinCloses(stdin, onEof)` 挂 `end` 监听并 `resume()`（只挂监听不 resume 的话流停在 paused，`end` 永远不来）。壳子拿 stdin 写端当"我还活着"的信号，一个字节都不写——管道断开只可能是壳子没了。
  - `--port 0` = 交给系统挑空闲口，返回实际端口并打印。壳子从 stdout 里读这个端口，从而不与开发服务器、也不与另一个实例抢 8787。
- **`apps/desktop/` 新模块**：`package.json`（`private`，devDep 只有 `@tauri-apps/cli`，**故意不定义 build 脚本**，否则 `pnpm -r build` 会去跑 `tauri build`）、`ui/index.html`（启动页）、`icon.svg` + `icon.png` + `src-tauri/icons/*`、`src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/default.json,src/main.rs}`。
- **图标定稿**：冷蓝 `#3f6b93` 圆角底 + 两块纸白 `#f7f4ec` 实心三角（上 `^` 下 `v` = AiVn 缩写），刻意无外描边、无台口横线。16px 退化为饱满实心菱形不散架，128px+ 能看清中缝（4 轮视觉视检）。
- **打包配置**：`identifier io.github.johnwalksslow.aivn`、窗口 `main` 1360×860（min 900×600，居中，`backgroundColor "#17130f"` 防白闪）、`bundle.targets ["nsis"]`、`externalBin ["binaries/aivn-server"]`、NSIS `installMode "currentUser"` + 中英双语。Rust release profile 加 `strip` / `lto` / `codegen-units=1`。
- **构建入口 `pnpm desktop`**（§4.5）。
- **踩到的坑**：
  - XML/SVG 注释里不能出现 `--`，sharp/librsvg 直接报 `Comment must not contain '--'`。
  - `tauri icon` 会顺手生成 android/ios 目录，脚本里删掉。
  - sidecar 副本必须在构建后删除：147MB，留着会让下次 `tauri build` 误判为最新。
  - 本机（rustc 1.75，无 tauri crate）只能做语法检查（`--edition 2021`），报错全是 E0432/E0433「找不到 tauri crate」，**无语法错误**——真编译只能在 Windows PC 上做。

## 12. 开放问题（已定案）

- **Q1 访问密码** ✅ 已按倾向落地：保留该功能、默认关闭，设置页可开。公开版会挂到局域网，`STAGE_PASSWORD` 是唯一防线，而搭台助手还带一个可选真 shell；README 明说风险。
- **Q2 数据目录** ✅ 定：exe 同级 `data/`（便携、看得见、可直接备份/拷贝），`--data-dir` 可改。
- **Q3 发布渠道** ✅ 定：GitHub 公开仓库 `john-walks-slow/aivn` + Release 附件（NSIS 安装包与免安装 zip 各一份）。不做 Docker。
- **Q4 LICENSE** ✅ 定：MIT。
