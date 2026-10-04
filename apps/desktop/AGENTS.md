# apps/desktop AGENTS.md

## 职责

桌面壳：**一层窗口，加上一个由它拉起、也由它收掉的服务端**。业务一行都不在这里——前端在 `apps/web`，后端在 `apps/server`。这个模块存在的唯一理由是：双击出来的是「一个有图标的窗口」，不是一个黑色命令行窗口。

```
apps/desktop/
├── package.json        # @aivn/desktop，private，devDep 只有 @tauri-apps/cli
├── icon.svg            # 图标源（改动后跑 `pnpm icon` 重生成全套）
├── icon.png            # 1024，`tauri icon` 的输入
├── ui/index.html       # 启动页：服务端起好之前先显示它，失败时显示 stderr 尾巴
└── src-tauri/
    ├── Cargo.toml            # package name = aivn（写进 exe 资源段）
    ├── build.rs
    ├── tauri.conf.json       # 窗口、bundle、externalBin、NSIS 配置
    ├── capabilities/default.json
    ├── icons/                # tauri icon 生成的全套（android/ios 目录已删）
    └── src/main.rs           # 全部壳逻辑，单文件无 lib.rs
```

## 壳的行为契约（`src/main.rs`）

1. `tauri-plugin-single-instance` **必须第一个注册**，否则第二次双击会起第二个实例。第二次双击只 unminimize / show / set_focus 已有窗口。
2. `setup` 里 spawn 线程跑 `boot(app)`，别阻塞事件循环。
3. **拉起 sidecar**：路径 = `current_exe().parent()/aivn-server.exe`，参数 `--no-open --exit-on-stdin-close`，stdin/stdout/stderr 全 piped；Windows 上 `CommandExt::creation_flags(0x0800_0000)`（CREATE_NO_WINDOW）防黑框闪。
4. **不用固定端口**：服务端 `--port` 缺省 8787 但被占会往后让，壳子从 stdout 里认第一个 `http://127.0.0.1:<digits>`（90s 超时），再 `window.navigate(url)`。壳子不许猜端口。
5. **stdout 必须一直被抽干**：就绪之后另起一个线程 `while lines.recv().is_ok() {}`。不抽干的话服务端写满管道就会卡死。
6. 就绪后 5s 内捡含「局域网」且含 `http://` 的那一行，写进窗口标题——桌面形态下没人看得见 stdout，不写出来局域网访问这个能力等于不存在。
7. **收摊双保险**：`RunEvent::Exit` 先 take 掉 stdin（断管道）再 kill + wait；同时服务端侧 `--exit-on-stdin-close` 读到 EOF 自杀。壳子被强杀时只剩后一条路，而它由内核回收管道保证，不依赖壳子执行任何代码。
8. **失败可见**：`window.eval("window.aivnFailed(...)")`（用 `serde_json::to_string` 转义）把 stderr 尾巴（最多 40 行）摊在启动页上。所有 sidecar 输出追加到 `<exe 同级>/data/desktop.log`。
9. `#[cfg(test)] mod tests` 覆盖 `ready_url` / `lan_url` 的解析。

## 图标

`icon.svg` = 冷蓝圆角底 + 一颗纸白空心菱形（2026-10-04 换掉了原来的上下两块实心尖块）。尖角走默认的 miter 接头、不描圆角——圆角会把尖角磨没；线宽 80（1024 的 7.8%），再细 32px 下糊成一圈灰，再粗孔径就收没了、空心白说。**刻意无外描边**：黑描边会被深色任务栏吞掉造成视觉尺寸跳变。

改图标后把 16 / 32 / 128 三档渲染出来给用户过目，别只看 1024 那张——审美判断归用户，不要转手交给视觉模型。

同一版图标由 `scripts/make-app-icon.mjs` 拷一份 `favicon.ico` 给 `apps/web/public/`——web 与桌面共用一个记号。

`tauri.conf.json` 里 NSIS 的 `installerIcon` / `uninstallerIcon` 显式指向 `icons/icon.ico`：不写的话安装包与卸载项用的是 NSIS 自带的那张图，跟应用图标不是一回事（2026-10-04 实测：装完的 `aivn.exe` 是新记号，而 `aivn-0.1.0-x64-setup.exe` 还是 NSIS 默认的）。

## 构建（`scripts/build-desktop.mjs`，根目录 `pnpm desktop`）

`build-exe.mjs` 先出服务端 exe 与免安装 zip → 按 `rustc --print host-tuple` 把 exe 拷成 `src-tauri/binaries/aivn-server-<triple>.exe`（`externalBin` 就是按这个后缀找文件的）→ `tauri build` → NSIS 安装包拷成 `build/aivn-<版本>-x64-setup.exe` → **删掉 sidecar 副本**（147MB，留着会让下次 `tauri build` 误判为最新）。

- **只能在 Windows 上跑**：Tauri 不能交叉编译到 Windows（要 MSVC 工具链与 WebView2），非 Windows 直接抛错。发布走 `.github/workflows/release.yml` 的 `windows-latest`。
- 版本号四处必须一致（根 `package.json`、`apps/desktop/package.json`、`tauri.conf.json`、`Cargo.toml`），脚本开跑就核对。
- 为什么不走 `tauri-plugin-shell` 的 sidecar API：它要过 capabilities 权限表才肯动，而我们要的只是「spawn 一个自己带的 exe、读它的 stdout」，std 就够了。少一层 ACL 就少一类「为什么没权限」的运行时故障。

## 本机怎么查语法

宿主 rustc 可能远低于 `rust-version`、也没有 tauri crate。那种情况下只能 `rustc --edition 2021 --emit=metadata src/main.rs` 过一遍语法，报错里清一色的 E0432/E0433「找不到 tauri crate」是正常的——**真编译只能在 Windows 上做**。
