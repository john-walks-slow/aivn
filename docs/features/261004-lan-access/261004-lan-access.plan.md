# 局域网访问开关与一键放行（261004-lan-access）

## 背景

打包版装完默认监听 `0.0.0.0`，局域网能不能连全看用户有没有在 Windows 弹窗上点「允许」。点了取消会留下一条阻止规则、从此不再弹，用户只会觉得软件坏了——README 里那条 `netsh` 就是救这个的，而它要管理员权限，对普通用户等于劝退。

本机实测（2026-10-04）：改防火墙必须管理员；我们是 per-user 安装（不弹 UAC），安装时静默写规则这条路走不通（改 perMachine 会让数据目录落到 Program Files、写不进去）。

## 目标

设置页里有一块「局域网访问」：一个开关、一串手机该连的地址、一个替他写防火墙规则的按钮。

## 设计

### 1. 新设置项 `lanAccess`（默认 `false`）

- `config.ts`：`ServerConfig.lanAccess: boolean`；`freshSettings()` 里 `false`；`settingsFromEnv()` 不设（仍走 fresh 默认）；校验按布尔收（手写 settings.json 里给了非法值时退回默认，与其余字段同一套写法）。
- `configApi.ts`：读视图加 `lanAccess`；写映射加一行。
- 新增设置项的四处（`ServerConfig` + `freshSettings` + 校验 / 读写视图 / 设置页表单 / README 字段总表）一处都不能少。

### 2. 监听地址 = 显式覆盖 > `lanAccess`

- `loadBootstrap` 的 host 默认值从写死的 `"0.0.0.0"` 改成 `undefined`（三态：显式给了就是它，没给就交给 `lanAccess`）。
- 解析函数（放 `lanAccess.ts`）：`resolveHost(explicit, lanAccess) => explicit?.trim() || (lanAccess ? "0.0.0.0" : "127.0.0.1")`。
- `--host` / `STAGE_HOST` 仍然赢（dev 与脚本的老习惯不变），README 里说明这条优先级。

### 3. 改动即生效：重绑 listener

- `SettingsStore.subscribe` 里盯 `lanAccess`：解析出的 host 变了就 `server.close()` + `server.closeAllConnections()`，再 `listenWithFallback(server, 同一个 port, 新 host)`。
- 端口必须保持原样（桌面窗口与已打开的页面都在这个端口上，换端口等于把人踢下线）；本机页面会掉一次 WS 再自动连回，这是可接受的代价，日志里写一行说明。
- 只重绑一次、不排队：订阅回调里比对「当前 host」与「目标 host」，相同即返回。

### 4. 地址与端口回显

- `GET /api/config` 的 `bootstrap` 加 `lanUrls: string[]`：host 是 `0.0.0.0` 时给 `lanAddresses().map(ip => \`http://${ip}:${port}\`)`，否则空数组。
- 顺手修既有 bug：`bootstrap.port` 现在回的是**配置值**，8787 被占实际漂到 8789 时设置页显示的是错的。`index.ts` 在 `listenWithFallback` 之后把实际端口写回 `bootstrap.port`（`SettingsApi` 持有同一个对象引用）。

### 5. 一键放行防火墙

- 新端点 `POST /api/lan/open-firewall`：
  - 只接受来自**回环地址**的请求（`req.socket.remoteAddress` 是 `127.0.0.1` / `::1` / `::ffff:127.0.0.1`），其余一律 403——局域网上的任何人都不能远程把 UAC 弹窗糊到用户脸上。
  - 非 Windows 或非打包态（`isPackaged()` 为假，即 dev 的 node 进程）直接 501 + 一句人话：这条只在装好的应用里有意义。
  - 实现（`lanAccess.ts`）：`netsh advfirewall firewall add rule name="AIVN 局域网访问" dir=in action=allow program="<process.execPath>" enable=yes profile=any`，用 `powershell Start-Process -Verb RunAs -Wait` 提权执行；**先 `delete rule` 同名再 `add`**（幂等，重复点不会堆规则）。
  - 返回值 `{ ok, message }`：用户点了 UAC 的「否」要当成失败回报一句人话，别静默。
  - 程序路径只来自 `process.execPath`，不拼接任何请求输入。
- 为什么按程序而不是按端口：服务端端口会漂（`listenWithFallback`），按端口写的规则换个端口就失效。

### 6. 设置页

「访问与启动」组下面新增一组「局域网访问」：

- 开关：允许局域网访问（写 `lanAccess`，与其余字段一样走「保存」按钮）。
- 地址：开着时列出 `lanUrls`（没有就说明「这台机器没有可用的局域网地址」），每条带复制；关着时该行只说「打开后这里会显示手机该连的地址」。
- 按钮「允许局域网访问（Windows 防火墙）」+ 两行说明：打开开关时系统会自己弹一次窗、点「允许」就够了；按钮是给「点过取消 / 没弹窗」的情况兜底的。
- 只读的「监听地址」那一行的 hint 要改口（现在写的是「改它要写 .env 再重启」）。

### 7. dev 行为不变

`scripts/dev-worktree.sh` 起服务端时显式带上 `STAGE_HOST=0.0.0.0`——dev 是开发工具，局域网直连是日常用法，不该跟着产品的默认值走。

### 8. 文档

- README：「设置页字段总表」加 `lanAccess` 一行；「局域网访问」那节改口（默认不开、去设置页打开、系统弹窗与那个按钮各管什么）；`--host` 行补优先级。
- `apps/web/AGENTS.md` 的 SettingsScreen 分组描述补「局域网访问」。
- `CHANGELOG.md` 0.1.0 段落补一条。

## 验收

1. `pnpm typecheck` + 受影响的 server 用例。
2. 全新数据目录起服务：默认只听 127.0.0.1（`GET /api/config` 的 `host` 是 `127.0.0.1`、`lanUrls` 为空）；打开开关后同一进程内改听 `0.0.0.0`、`lanUrls` 出地址，且**端口没变**。
3. Windows 打包版实机：开关打开 → 手机能连；点放行按钮 → UAC → 规则出现在「入站规则」里；重复点是同一条。
4. 默认关时，局域网里的另一台设备连不上（这是本次要建立的新默认）。
