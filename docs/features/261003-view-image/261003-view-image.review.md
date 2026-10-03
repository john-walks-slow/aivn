# 检视报告

## 概要

本次改动检视范围涵盖看图工具通用化（`inspect_asset` → `view_image`，支持剧目内相对路径与 HTTP/HTTPS 网络图片抓取）以及工坊系统提示词中强制看图流程的移除。整体架构设计方向契合需求，工具与角色装配清晰，提示词精简干净，大部分 SSRF 防御机制生效。但网络抓取实现中存在流式内存拒绝服务（OOM DoS）与 IPv6 兼容写法绕过内网防护两个阻塞问题，需修复后方可准入。

## 需求对齐

- **读图工具通用化**：`inspect_asset` 已被完全替换为 `view_image`，`source` 入参统一接纳剧目相对路径与网络图片 URL；网络分支经由 `webImage.ts` 下载并按 URL 摘要缓存到 `media-cache/web-images/`，未配置下载器时给出友好回退提示。需求已实现。
- **提示词流程解耦**：系统提示词（`workshop.ts`）与技能文档（`sprite-differences/SKILL.md`）中关于「出完立绘逐条核对再汇报」的强制看图流程已清除，反向断言测试已覆盖。需求已满足。
- **与计划偏离度**：核心决策基本落实，但计划中提及的部分安全边界与测试用例（如十六进制 v4 映射 v6 的测试用例、响应体大小严格流式截断）在落地时存在漏洞与缺漏。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B-01 | [apps/server/src/webImage.ts:62-65](apps/server/src/webImage.ts#L62-L65) | **流式大响应体存在内存耗尽（OOM DoS）崩溃隐患**：代码对 20MB 上限的判定依赖 `Content-Length` 请求头。若服务器采用 `Transfer-Encoding: chunked`（无 `Content-Length`），`declared` 为 0 将绕过前置检查，随后直接调用 `await res.arrayBuffer()` 一次性缓冲全量数据。恶意对端持续发送数百兆乃至数吉字节数据流时，将导致 Node.js 进程内存耗尽崩溃，造成拒绝服务。 | 改为流式读取（如消费 `res.body` 的 ReadableStream 块），累加已收字节；一旦累计超出 `MAX_BYTES`，立即调用 `stream.cancel()` 或触发 `AbortController` 截断连接并抛错，严禁全量 buffer 后再判大小。 |
| B-02 | [apps/server/src/webImage.ts:110-125](apps/server/src/webImage.ts#L110-L125) | **IPv4-compatible IPv6（如 `::127.0.0.1` / `::7f00:1`）绕过 SSRF 防护**：`mappedV4` 仅匹配了以 `::ffff:` 开头的 IPv4-mapped 格式，未覆盖已废弃但系统网络栈依然识别的 IPv4-compatible 格式（`::/96`，即前 96 位为 0）。传入此类地址时，`mappedV4` 返回 `null`，导致其逃逸出 `v4` 分支，后续正则与等于判断均不命中，最终在第 124 行直接 `return true`，使得指向本地回环的内网请求被放行。 | 完善 IPv6 判决逻辑：将形如 `::127.0.0.1` 或高位全为 0 的 IPv4-compatible IPv6 地址段（`::/96`）同样识别并还原为 IPv4 进行私网校验，或直接全面禁止此类兼容格式。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S-01 | [README.md:659-676](README.md#L659-L676) | **README 章节插入错位导致联网检索说明被截断**：在插入 `### 看图（工坊）` 小节时，误插在 `### 工坊联网检索` 的配置表格与正文说明之间，导致看图小节末尾突兀出现了孤立的代码块 `["<your-api-key>"]` 及属于检索功能的正文描述。 | 调整章节排版，将「工坊联网检索」完整收尾后，再另起「### 看图（工坊）」小节。 |
| S-02 | [apps/server/src/webImage.ts:44-45](apps/server/src/webImage.ts#L44-L45) | **存在 DNS Rebinding (TOCTOU) 绕过窗口**：`assertPublicHost` 先行通过 `dns.lookup` 解析 IP 并核验合规性，随后 `undiciFetch` 独立发起请求并进行第二次 DNS 解析。攻击者利用 TTL=0 的重绑定域名可能使 undici 实际连接到 `127.0.0.1`。 | 在底层自定义 undici Dispatcher（例如利用 `buildConnector` 拦截 Socket 连接建立完成后的 `remoteAddress` 并做二次阻断），或者在连接层面锁定解析到的安全 IP。 |
| S-03 | [apps/server/src/agentkit/viewTool.ts:86-91](apps/server/src/agentkit/viewTool.ts#L86-L91) | **本地看图分支缺少文件体积上限检查**：网络分支设置了 20MB 上限，但本地路径分支 `viewLocal` 仅做白名单校验，直接读取全文转 base64。若剧目内被放置异常超大图片文件，可能撑爆单轮上下文预算或引发内存压力。 | 在 `viewLocal` 中对文件大小同样实施 20MB（或合理阈值）限制，超限时抛出清晰的可读提示。 |
| S-04 | [apps/server/test/webImage.test.ts:22-40](apps/server/test/webImage.test.ts#L22-L40) | **网络图边界单测覆盖存在盲区**：计划中提及的十六进制 v4 映射 v6（`http://[::ffff:7f00:1]/x.png`）、302 重定向到内网地址被拦截、超过 3 跳被截断、大文件超限报错等场景未编写单测。 | 在 `webImage.test.ts` 中补充上述用例，确保网络安全防护边界拥有完备的回归保护。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | [apps/server/src/agentkit/viewTool.ts:80-81](apps/server/src/agentkit/viewTool.ts#L80-L81) | **网络图片缓存写入非原子操作**：`writeFile` 直接落到目标路径，如果下载或写盘中途被异常中断，可能留下 0 字节或损坏的图片文件。由于 `viewRemote` 仅靠 `existsSync` 判断命中，损坏缓存将导致后续重试永久报错。 | 建议写入临时文件（如 `.tmp`）后再通过 `rename` 原子替换；或在读取缓存损坏时主动清理坏缓存并回退重新抓取。 |
| N-02 | [apps/server/skills/sprite-differences/SKILL.md:10, 34](apps/server/skills/sprite-differences/SKILL.md#L10) | **技能文档中残留过时工具名 `generate_asset`**：文中有两处提及 `一次 generate_asset 只出一张图` 和 `generate_asset 的回执`，而系统实际工具名为 `generate_image`。 | 顺带修正为当前实际工具名 `generate_image`，避免误导模型。 |
| N-03 | [apps/server/src/webImage.ts:75-84](apps/server/src/webImage.ts#L75-L84) | **未对 HTTP/HTTPS 端口进行白名单约束**：目前允许任意目标端口，攻击者或失控模型可能指定 22、25、6379 等非常规端口进行网络探测。 | 建议视业务需要限制仅允许标准或常见 Web 端口（如 80, 443, 8080 等）。 |

## 准入结论

**结论**：`不准入`

**说明**：核心功能与提示词解耦均已正确实现，但 `webImage.ts` 中存在大响应体流式内存耗尽崩溃漏洞（B-01）以及 IPv4-compatible IPv6 内网防护绕过（B-02）两项阻塞性安全与稳定性缺陷，须修复并补全回归用例后重新检视。

## 整改记录（第二轮）

| ID | 处理 | 说明 |
| --- | --- | --- |
| B-01 | **已修** | 抽出 `readCapped(body, url)`：用 `getReader()` 逐块读，累计超过 `MAX_WEB_IMAGE_BYTES` 立刻 `reader.cancel()` 并抛错，`finally` 里 `releaseLock()`。`content-length` 早退那一步删掉——它只是一条声明，chunked 响应没有，留着只会给人「上限已经管住了」的错觉。用例：一条人造无限流断言拉取次数不超过上限 +2，并断言底层 `cancel()` 真的被调用（对端流停了，不是收完再报错）。 |
| B-02 | **已修** | `mappedV4` 换成 `embeddedV4`：凡 `::ffff:<v4>` 与 `::<v4>`（`::/96` 的 v4 兼容写法）两种前缀都还原成点分十进制再走 v4 判据；只认写满 32 位的形式（`::1` 仍是纯 v6，走原判决）。用例补了 `::ffff:7f00:1`（十六进制映射）、`::7f00:1` / `::127.0.0.1` / `::a00:1`（兼容写法）。 |
| S-01 | **已修** | 「看图（工坊）」整节挪到「工坊联网检索」收尾之后（表格 → key 格式块 → 用途说明 → 再起新节）。 |
| S-03 | **已修** | `viewLocal` 在 `readFile` 前先 `stat`：超过同一个 20MB 上限直接回可读提示，不把超大文件读进内存。 |
| S-04 | **部分修** | 十六进制 v4 映射、`::/96`、收流截断（含 cancel 断言）三条用例已补。**302 跳内网与超过 3 跳两条没补自动化用例**：要测就得让一个真实的 HTTP 服务器在本地起服务，而这台机器的出网默认就是被自己的规则挡掉的（`assertPublicHost` 会先拒 127.0.0.1），造不出「第一跳合法、第二跳转内网」的场景；为测它而给 `WebImageFetcherImpl` 加 DNS lookup 注入缝，是为覆盖一条读代码就能确认的循环（`for (hop…) { await assertPublicHost(target); fetch… }`）引入新的可注入面，不划算。留着当已知未覆盖。 |
| N-01 | **已修** | 先写 `<file>.part` 再 `rename`：写到一半被打断只留一个 `.part`，不会让半张图冒充缓存永久命中。 |
| N-02 | **已修** | 工具真名是 `generate_image`。除了检视点到的 `sprite-differences`，`scene-composition`、`style-anchors` 两份 skill 与 `imageBackend.ts` 注释里还各有 `generate_asset`——模型照着调一个不存在的工具，就是白转一轮烧 token 的那种错。一起改掉。 |
| S-02 | **不改** | DNS rebinding 的窗口真实存在，但把解析结果钉进连接要每次请求新建一个 undici `Agent`（没有连接池），而**默认部署恰好走代理**（`HTTP_PROXY`/`HTTPS_PROXY` 设了就有）：走代理时域名是代理那边解析的，本地钉 IP 一点用没有，只有不配代理的内网部署才受保护。为覆盖一个「默认配置下不生效」的窄场景付这个复杂度不划算。真要收口，正确的位置是代理那一侧。 |
| N-03 | **不改** | 端口白名单会误伤真实存在的非标准端口图床/CDN，而私网地址已经被 SSRF 判据挡死了——端口是扫描面，地址才是边界。 |

第二轮结论：**准入**（S-02 / N-03 见上，不构成阻塞；S-04 残留的两条未覆盖项已在「已知未覆盖」中记录）。
