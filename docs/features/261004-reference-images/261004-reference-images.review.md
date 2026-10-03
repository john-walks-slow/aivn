# 通用垫图入口 检视报告

检视对象：`feat/reference-images` 分支（worktree `.worktrees/reference-images`）对 `generate_image` 垫图入口的改动。
检视方式：reviewer 子代理两轮检视。

## 第一轮：不准入

| ID | 级别 | 问题 |
|---|---|---|
| BLK-01 | 阻塞 | 剧作家 queued 排产链路的 `references` 被丢弃：`runQueued` 的 `kickSprite` 不带参考图，`playhouse` 的 `kick` / `kickSprite` 装配处也没转发第 4/5 参，导致排产生图全部退化为纯文生图。 |
| BLK-02 | 阻塞 | 非 neutral 差分传入显式 `references` 会在 `referencesFor` 里被无条件优先加载，顶掉作为身份基准的 neutral 定妆照，破坏「差分恒以 neutral 为基准」的不变式。 |
| REC-01 | 建议 | `loadReference` 对本地图嗅探失败时兜底 `image/jpeg`，非图片文件会被伪装后发给后端。 |
| REC-02 | 建议 | 定妆照垫图后缀拼接产生连续句号 `..`。 |
| REC-03 | 建议 | `neutralReferenceLead` 命名与「拼在末尾」的实际行为相反。 |
| REC-04 | 建议 | `resolveRefs` 合并两个字段后没有封顶，可能超过 6 项。 |
| MIN-01/02 | 非阻塞 | 文件头注释残留 `< ` 脏字符；接口参数名与注释未统一到 `references`。 |

## 第二轮：条件准入

上一轮全部阻塞项与建议项已闭环，无新增阻塞问题。评审确认：

- BLK-01 链路从 `runQueued` → `deps.kick` / `kickSprite` → `orchestrator.imageTools` → `playhouse.preloadAsset` / `preloadSprite` → `playAssets.generate` 全通，签名与透传一致无遗漏。
- BLK-02 的不变式已在 `referencesFor` 中以显式报错拦截，无法被绕过（即使触发 neutral 递归补定，返回后仍会抛错）。
- 参数设计判定为**统一入口**而非膏药：`referenceCharacters` 仅作兼容别名，经 `resolveRefs` 归一化为单一 `references: string[]` 后进入业务核心，不存在双轨。

保留两条改进建议：

| ID | 级别 | 问题 | 处理 |
|---|---|---|---|
| SUG-01 | 建议 | 剧目内路径不容错前导斜杠，agent 直接复制 `/plays/<id>/assets/...` 静态 URL 会报「未知参考图」。 | 已修：解析前 `replace(/^\/+/, "")`，并补一条用例。 |
| SUG-02 | 建议 | `workshop.ts` 的素材来源指引仍写 `referenceCharacters`，会让搭台助手在 craft.md 里沿用旧名。 | 已修：改为 `references`，并写明给角色 id / 剧目内路径 / 网址都行。 |

## 结论

**条件准入**（两条建议已在合并前一并处理）。无遗留阻塞项。
