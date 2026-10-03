# 看图工具通用化 —— 交付小结

## 做了什么

工坊原来那个只能读 `assets/**` 的 `inspect_asset`，变成 `view_image`：`source` 一个参数同时吃剧目内相对路径
和 http(s) 图片网址，网址经 `webImage.ts` 下载后读成 image attachment 交给模型，按 URL 摘要缓存到
`plays/<id>/media-cache/web-images/`（同址再看一次不再下载，先写 `.part` 再 rename）。

同时把工坊系统提示词里「立绘出完逐条核对再汇报」那条强制看图流程删掉了——看图变成模型自己判断的灵活动作。
`sprite-differences` 技能里那节从「出完立刻看一遍」改成「看图能看出什么」：判断清单（白边晕 / 抠得干不干净 /
是不是同一个人）保留，触发条件去掉。

## 出网边界（这是本次真正的技术活）

地址是模型给的——页面正文里写一句「参考 http://127.0.0.1:8787/api/config」就可能真的去取。所以：

- 下载前解析域名，逐个地址判公网；`localhost` / `.local` 在解析之前就拒；
- `::ffff:` 映射与 `::/96` 兼容两种 v4 内嵌写法都还原成 v4 再判（点分与十六进制两种形式都认）；
- 每跳重定向重判，上限 3 跳；
- 非 http(s) 协议直接拒（`file:` / `data:` 各是一条读本机的路）；
- 20MB 上限**在收流的过程中**判：读到上限立刻断流，不等收完——`content-length` 只是一条声明，chunked
  响应根本没有这个头。

## 验证

- `test/webImage.test.ts`（10 例）：内网/回环/链路本地/云元数据/v4 内嵌的各种写法全拒；`file:`/`data:`/`gopher:`
  拒；DNS 失败照实说；缓存名同址同值异址不同；收流截断（拉取次数不超上限 + 底层 `cancel()` 真被调用）。
- `test/workshop.test.ts`：本地路径读成 attachment 且字节一致；非图片字节不塞进模型；网址分支下载→读进模型→
  落 `media-cache/web-images/`→同址再看不再下载；没装配下载器时回「未启用」；超大本地文件被挡。
- prompt 用例改成**反向**断言：出图章节里不再出现 `view_image` / `inspect_asset` /「逐条核对再汇报」。
- 真机单点（走 `HTTPS_PROXY` 环境变量里的代理）：`httpbin.org/image/png` 直出 8090B PNG；`picsum.photos/200/300` 经 302 拿到
  14742B JPEG——重定向链路真的通。

## 已知未覆盖 / 未做

- **302 跳内网、超过 3 跳**两条没有自动化用例：要测就得在本地起 HTTP 服务器，而本地地址恰好被自己的规则先拒了，
  造不出「第一跳合法、第二跳转内网」的场景。为覆盖它给下载器加 DNS 注入缝不划算（循环本身读代码即可确认）。
- **DNS rebinding 的 TOCTOU 窗口**没修：把解析结果钉进连接需要每次请求新建 undici Agent，而默认部署走代理、
  域名由代理解析，本地钉 IP 对默认配置无效。正确的收口位置在代理那一侧。
- **端口不做白名单**：会误伤非标准端口的真实图床，而私网地址已经挡住了。
- 顺手把三份 skill 与 `imageBackend.ts` 注释里的旧工具名 `generate_asset` 改成真名 `generate_image`——
  模型照着调一个不存在的工具，是白烧一轮 token 的那种错。

## 相关文档

- 计划与取舍：`261003-view-image.plan.md`
- 检视与整改：`261003-view-image.review.md`（第一轮不准入 → 整改后准入）
- 用户验证清单：`261003-view-image.validation.md`
- 上一需求（抠底调参）：`../261003-sprite-recut/`