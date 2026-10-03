# 通用垫图入口 实施总结

## 做了什么

给 `generate_image` 加了一个**统一的参考图入口 `references`**，把原先「只有非 neutral 差分才会自动垫本角色 neutral 定妆照」这条硬编码特例，泛化成通用能力。

每项参考图可以是：

- **角色 id**（`"alice"`）——自动取该角色立绘（优先 `neutral`，否则任意差分）；
- **剧目内相对路径**（`"assets/refs/x.png"`，容错前导斜杠与 `plays/<id>/` 前缀）；
- **http(s) 网址**（走 `webImage.ts` 下载，内网地址被挡死）。

`referenceCharacters` 保留为**只吃角色 id 的兼容别名**，两者在工具层由纯函数 `resolveRefs` 合并去重、封顶 6 项，进入业务核心时已归一化为单一 `references`。

## 为什么这么做

原本的实现里，参考图是两套东西：CG 走 `referenceCharacters`（仅角色立绘），sprite 差分走一个隐式约定（自动套 neutral）。想支持「用户发一张既有角色图 → 工坊垫它出定妆照」，在 `referenceCharacters` 旁边再加一个 `referenceImages` 就是并列的第二套入口——正是用户点名的「狗皮膏药」。正确做法是**把参考图收成一个入口**，并解掉 `referencesFor` 里 `if (expression === NEUTRAL) return []` 这条让 neutral 无法垫图的特例。

## 行为契约

| 出图类型 | 参考图来源 |
|---|---|
| `sprite` + `neutral` | 带 `references` 就垫它（首次定妆、外部既有角色图都走这条）；不带则纯文生图 |
| `sprite` + 差分 | **恒为该角色的 `neutral` 定妆照**；调用方带参考图直接报错（换基准会与既有差分不是同一个人，演出中静默换脸） |
| `background` / `cg` | 按 `references` 垫图（角色 id / 路径 / 网址均可） |

`STAGE_IMAGE_REFERENCE=none` 仍是全局开关，显式指定的参考图同样归它管。

## 改动范围

- `apps/server/src/agentkit/imageTool.ts` —— schema 加 `references`；`resolveRefs` 归一化；`REFERENCE_RULE` 与工具描述改写；queued 的 `kickSprite` 补传。
- `apps/server/src/playAssets.ts` —— `ResolvedReference` 模型、`resolveReferences` 解析、`referencesFor` 装配与不变式、`loadReference` 本地/URL 双路、`genericReferenceSuffix` 与 `neutralReferenceTail`。
- `apps/server/src/{playhouse,orchestrator}.ts`、`apps/server/src/agentkit/deps.ts` —— `kick` / `kickSprite` 透传 `references`；注入 `fetchImage`。
- `apps/server/src/workshop.ts` —— 素材来源指引改用新入口名。
- `AGENTS.md` —— 模块说明同步。

## 验证

- **单元/集成**：`pnpm --filter @stage-ai/server test` 全绿（471 passed / 3 skipped）。新增 5 条用例：neutral 垫图、URL 垫图、差分带参考图报错、CG 通用参考图、带前导斜杠的静态 URL。
- **真实生图**：拿库里既有角色立绘当 `references`，真实跑通一次 neutral 定妆照（91s）。视觉核对为**同一个角色**——荧光玫粉同心环瞳、尖刺下眼线、暖棕肤色、酒红落肩灯笼袖、蓝红拼接格纹裙、新月吊坠项圈全部保持。
- **检视**：reviewer 两轮，第一轮 2 个阻塞项（queued 链路丢参数、差分基准可被顶掉）已修，第二轮**条件准入**；两条建议（前导斜杠容错、提示词旧名）已顺手处理。

## 未做（用户明确要求先不做）

- 工坊对话框直接收图；
- 角色卡记录参考图来源字段；
- 参考图验收工具。

## 已知遗留（非本次引入）

本机 flow2api 对 `3:4`（`framing: half`）会静默回横图，`PlayAssets.assertCanvas` 会拦下并报错。这是既有的画幅兼容问题，与参考图无关。
