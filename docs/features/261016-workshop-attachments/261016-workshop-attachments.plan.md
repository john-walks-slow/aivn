# 工坊附件：把人给的原作递进去

> 状态：已完成。分支 `feat/workshop-attachments-v2`（旧分支切在 reset 前的旧基线上，已作废）。
> 交付记录与验证见 [summary](261016-workshop-attachments.summary.md)。

## 需求

改编别的媒介（小说 / 电子书 / 网页 / 剧本）时，用户手里先有的是**原作**。工坊现在只收一行文字，
人要写东西进来只有「复述一遍」这一条路。要补的是三件事：

1. 工坊会话支持上传 / 贴入图片与文件；
2. 新增 `resource-parsing` 技能，教 agent 分段读取这些资源（各类常见电子书格式）；
3. 除技能之外，框架侧的前置能力要齐。

## 落点（已与用户对齐）

- **附件落在剧目目录的 `resources/`**，随剧目走：导出剧目包会带上原件。选择它的理由是
  agent 的 `read` / `bash` / `view_image` 全部以剧目目录为根（bash 的 cwd 就是剧目目录），
  文件放在这里才「看得见、够得着」。
- **解析路线 = 纯技能 + 现成命令行工具**，不新增提取工具：epub/docx 靠 `unzip` + 去标签或
  `pandoc`，pdf 靠 `pdftotext`，纯文本直接 `read` 分段。因此「命令行」能力是这条链路的硬前置，
  它仍默认关（用户现开），无 bash 时技能负责如实回话。

## 勘察：缺的是什么

| 环节 | 现状 |
|---|---|
| 工坊输入框 | 只有 textarea；`onPaste` / drop / `type="file"` 全仓零命中 |
| `workshop_chat` | `{threadId?, text}`——协议里没有附件位 |
| 工坊会话 | `chat(text)` → `{role:"user", text}` → `historyToMessages()` 的 `content: string`，三层纯文本 |
| 图片进模型 | 通路本来就有：`view_image` 返回 `{type:"image", data, mimeType}`，`agent.prompt(text, images)` 也收图片 |
| 素材上传 | `POST /api/plays/:id/assets`（raw body + query）是现成的约定 |
| agent 的文件面 | `PlayFiles` 白名单锁在剧目目录内；新目录不加白名单，agent 读不到 |
| 技能 | `apps/server/skills/<name>/SKILL.md`，`read_skill` 按需读全文；`read` 自带 offset/limit（分段读取的底座） |

## 改动

### 1. 协议（`packages/core/src/ws/protocol.ts`）

- 新增 `WorkshopAttachment { path, name, size, kind, url }`，`kind: "image" | "file"`
  （image = 模型能直接看的那几档，由字节头嗅探定，不看扩展名）。
- `WorkshopChatMessage.attachments?: WorkshopAttachment[]`（用户消息上的附件）。
- `workshop_chat` 加 `attachments?: string[]`——**客户端只报路径**，尺寸 / kind / url 一律服务端
  重算，客户端说的不算数。

### 2. 落盘与静态服务（`apps/server`）

- `POST /api/plays/:id/resources?name=<文件名>`：raw body 写 `resources/<文件名>`，
  文件名过一遍消毒（去路径段、控制字符、前导点，限长），重名加 `-2` 后缀；
  返回 `WorkshopAttachment`。上限沿用 HTTP 的 64MB。
- `GET /plays/:id/resources/<文件名>`：图片 / 音频 inline，`.txt` / `.md` 走 `text/plain`，
  其余一律 `application/octet-stream` + `Content-Disposition: attachment`
  （用户传进来的 html 不能以同源 `text/html` 直出）。
- `PlayFiles`：`resources` 进 `DIR_ROOTS`（文件树能下钻）与 `isVisible`（agent 的 read / view_image
  读得到），**不进写面**——原件只读；派生文本由 bash 写（bash 本就不走这层）。
- 新剧目建出空的 `resources/`。

### 3. 会话（`apps/server/src/workshopSession.ts` / `workshop.ts`）

- `chat(text, threadId, attachments)`：附件路径逐个校验落在 `resources/` 内、存在、读字节头定 kind；
  落进 user 消息的 `attachments`；只有附件没有文字也允许发。
- 回灌：`historyToMessages` 把附件渲染成一行注脚（路径 + 大小 + 格式）跟在正文后，
  **不带 base64**——历史里留一份图的字节，等于每轮都重新付一次 token。
- 当前轮：`agent.prompt(text, images)`，图片附件当轮随消息直接送进模型（用户贴张图，模型当场看见）。
- 图片体积上限沿用 `MAX_WEB_IMAGE_BYTES`（20MB），超了不内联，注脚里指路 `view_image`。

### 4. 提示词（`apps/server/src/workshop.ts`）

新增一节：附件在哪、图片当轮可见、长资源先 `read_skill("resource-parsing")` 再动手。
技能指针按 `can.skill` 收条件。

### 5. 前端（`apps/web`）

- 输入区：回形针选文件、粘贴图片、拖拽——挑中即上传，草稿条里给缩略图 / 文件名 + 大小 + 删除。
- 用户消息渲染：正文下方一排附件（图片缩略图可点开放大，文件给名字 + 大小）。
- `api.ts` 加 `uploadResource`。

### 6. 技能 `apps/server/skills/resource-parsing/SKILL.md`

做法（不是工具说明）：先落清单 → 按格式转成可分段读的纯文本（各格式的命令与工具探测）→
按章分段读并落笔记 → 收成改编纲要（接 `galgame-play-setup`）→ 边界（命令行没开 / 没有可用工具 /
扫描版 pdf）怎么办。命令以本机实测为准。

## 明确不做

- 不做服务端内置提取工具（用户选的路线），PDF / mobi 这类冷门格式交给命令行那一侧如实报错。
- 不改「命令行」的默认开关。
- 不给 `resources/` 开写面：agent 用通用 `write` 改不到原件（bash 想写是它自己的事）。
- 不做分片上传 / 断点续传：单文件 ≤64MB，一次性 POST。

## 测试

- `apps/server/test/attachments.test.ts`（新）：文件名消毒与重名、路径越界拒绝、注脚文本、kind 嗅探。
- `apps/server/test/playFiles.test.ts`：`resources/` 可见、不可写。
- `apps/server/test/http.test.ts`：上传路由往返（写盘 + 返回体 + 越界 400）。
- `apps/server/test/workshop.test.ts`：带附件的 user 消息进模型是「文字 + 图片块」，历史回灌不带 base64。
- `pnpm check:agent-contract`（改 `workshop.ts` 与技能库后必跑）。
- 端到端：worktree 起 dev 实例，真贴一张图 + 传一个 epub 走一遍，截图给用户。
