# 工坊附件：把人给的原作递进去（交付记录）

> 分支 `feat/workshop-attachments-v2`（基于 `a09cb969`，已并入 10-16 的两个提交）。
> 旧分支 `feat/workshop-attachments` 作废：它切在 `git reset --hard origin/main` 之后那截旧基线上
> （老界面外壳 + 老 `packages/` 布局），迁移时按新界面重写了一遍前端。

## 交付了什么

1. **工坊收图片与文件**：拖进输入框 / 粘贴 / 选文件（多选）三入口，草稿条可摘。
2. **`resource-parsing` 技能**：教 agent 清点 `resources/` → 按格式抽取成纯文本 → 分段读 → 落笔记 → 收成改编纲要。
3. **框架侧前置能力**：协议、存储、路由、读面、多模态通路、提示词章节全部就位。

## 实现落点

| 层 | 文件 | 做了什么 |
|---|---|---|
| core | `packages/core/src/ws/protocol.ts` | `WorkshopAttachment` 契约；`WorkshopChatMessage.attachments`；`workshop_chat.attachments?: string[]`（全为纯新增字段） |
| server | `apps/server/src/resources.ts`（新） | 文件名消毒 `safeResourceName` / 去重 `uniqueResourceName` / 路径判定 `resourceNameOf`·`isResourceName` / 附件视图 `readResource` / 图片内联 `inlineImages` / 注脚 `attachmentNote`·`withAttachmentNotes` |
| server | `store.ts` | `resourceDir()` / `resourcePath()` / `writeResource()` / `resourceNames()`；`createEmpty` 建目录 |
| server | `http.ts` | `POST /api/plays/:id/resources?name=`（raw body 直写）；`GET /plays/:id/resources/<file>`（图片音频内联、文本 text/plain、其余下载） |
| server | `playFiles.ts` | `resources/` 进 `DIR_ROOTS`（文件页看得见）与 `READONLY_PREFIXES`（agent 改不动原件） |
| server | `workshop.ts` | `WorkshopMessage.attachments`；提示词《用户送来的附件》一章；`historyToMessages` 拼注脚；`runWorkshopTurn(..., images)` |
| server | `workshopSession.ts` | `chat(text, threadId, attachments)`：读盘算视图 → 内联图片进这一轮 → 消息落盘 → 历史投影带上附件 |
| server | `transport.ts` | 把 `msg.attachments` 递进会话 |
| web | `api.ts` / `useWorkshop.ts` / `WorkshopPane.tsx` / `app.css` | 上传与草稿条、拖拽与粘贴、消息里的附件条（缩略图点开走灯箱） |
| stage | `packages/stage/src/ui/Icon.tsx` | `attach`（回形针）与 `file` 两个字形 |
| skill | `apps/server/skills/resource-parsing/SKILL.md` | 分层兜底：pandoc → 纯 stdlib Python（zipfile/HTMLParser）→ unzip + perl 按 spine 排序；pdf 走 pdftotext |

## 为什么是这三条设计

- **原件落剧目目录的 `resources/`**：agent 的 `read` / `bash` 都以剧目目录为根（bash 的 cwd 就是它），
  放这里才既看得见又够得着，且随剧目导出一起走。
- **解析不新增工具，只写技能**：epub/docx/pdf 的抽取靠现成命令行工具，命令行能力仍默认关、由用户现开；
  没开时技能负责如实回话。这样「多一种格式」不必动服务端代码。
- **图片当轮进模型、历史只留注脚**：一张 3MB 的图 base64 进来就是几万 token，历史回灌要每轮重付一次；
  当轮要看图有两条路——模型按路径自己读，或用户重发。

## 验证

- 受影响单测：`resources`(10) / `http`(26) / `playFiles`(4) / `workshop`(52) / `workshopPrompt`(14) /
  `transport`(5) / `store`(13) 全绿；`pnpm check:agent-contract` 9 项全绿。
- 实拍（`tmp/e2e-attachments.mjs`）：选文件 + 粘贴 → 草稿条、发送 → 消息附件条、文件页里 `resources/` 三项俱在。
- 模型侧实证：那一轮助手准确描述了附上的截图内容（证明图片当轮真的进了模型），用 `read` 读了 epub，
  并按提示词如实说明「解 epub 要命令行，本剧目没开」。

## 已知边界

- 单文件上限 20MB（`inlineImages` 用 `MAX_WEB_IMAGE_BYTES` 卡内联），超过就不当图片送模型、仍可按路径读。
- 附件不可编辑、也不进剧目记忆：它是用户的资料，不是剧目事实。
- 图片在历史里只剩一行注脚，旧对话里的图需要模型自己按路径重读（这是刻意的）。
