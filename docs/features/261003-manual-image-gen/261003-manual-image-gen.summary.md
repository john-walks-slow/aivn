# 总结：手动生图（舞台 CG 参考立绘 + 工坊手动出图）

## 做了什么

原来生图只有两条路：剧作家自己调 `generate_image`（或舞台「生图」按当前剧情出 CG）。玩家想**指定参考角色**、或想在工坊里**手动出一张立绘/背景/CG**，都没有入口。

这次把出图收成一条链：**一个提示词内核 + 一个出图层 + 两个服务端入口 + 三个前端入口**。

| 层 | 位置 | 职责 |
| -- | ---- | ---- |
| 提示词内核 | `apps/server/src/imagePrompt.ts`（新） | `composeImagePrompt(deps, kind, ctx)`：按 `sprite` / `background` / `cg` 选系统提示词，拼「指令 + 创作口径 + 角色卡 + 剧情/场景 + 参考图编号」 |
| 出图层 | `apps/server/src/playAssets.ts` | `assertReferences(ids)` 公开；`referenceSpriteOf` 兜底目录任意立绘；`AssetNotify` 加 `"manual"` |
| 舞台入口 | WS `generate_cg` → `PlayHouse.requestCg` | 落时间线节点前先校验参考立绘；`useHistory=false` 时不带剧情与场景 |
| 工坊入口 | REST `POST /api/plays/:id/images` → `PlayHouse.generateImage` | 同步校验 + 组装，立刻返回 `{target, path, prompt}`；异步出图 |

三者前端入口：舞台「生图」面板（参考立绘多选 + 基于历史开关）、工坊角色卡（生成立绘 / 逐行重生成）、工坊素材页（背景 / CG 生成）。共用同一个 `ImageGenDialog` 与 `RefCharacterPicker`。

## 关键设计决定

**1. 完成态走 WebSocket，不走 HTTP 响应。**

生图要 70–140s，而 CF quick tunnel 100s 内无响应字节就断连。REST 端点**同步返回**（校验 + 提示词组装），出图在后台跑，完成/失败一律广播 `image_result`：

```ts
{ type: "image_result"; target: string;
  ok: true; url: string; path: string }
| { type: "image_result"; target: string;
  ok: false; message: string }
```

对话框按 `target` 匹配，拿到自己的那一张。`target` 是 `sprites/<charId>/<expr>` / `backgrounds/<name>` / `cg/<name>`，与 `assets/` 下的路径一一对应。

**2. 校验前置，不留空节点。**

舞台生图会在时间线上落一个 CG 节点。参考立绘若不存在，必须**在落节点之前**抛错（走已有的 `error` 帧 → toast），否则会留下一个永远填不上的骨架。同理，未勾「基于历史」又没写指令时直接拒绝——没有上下文也没有指令，模型只能瞎猜。

**3. `notify: "manual"` 是第三条通知路径。**

`PlayAssets` 原本只有 `"workshop"`（产对话气泡 + 撤销条）与 `"silent"`（剧作家预埋，什么都不产）。手动出图两者都不对：它要刷新列表，但不该往对话里插气泡、也不该进撤销条。于是加了第三个值，`onWrite` / `onAsset` 都对它不响应，只保留 `reloadAfterWorkshopWrite` 刷新。

**4. 参考立绘的顺序就是图序。**

点选顺序映射到提示词里的「参考图 1 / 2 / 3」，与 Gemini `inlineData` 的排列一一对应。这是**唯一的身份锚**——不写清楚第几张是谁，模型会把两张脸混在一起。UI 上序号徽标必须可见，否则用户无法校对。

**5. 立绘兜底到目录任意文件。**

`referenceSpriteOf` 原先只认角色卡里的差分映射。用户刚上传立绘、还没绑映射时，舞台立绘能显示（`AssetIndex.sprite` 兜底目录），但参考图校验说不存在——两边不一致。现在服务端也兜底目录任意文件，行为对齐。

## 改动清单

**core**（`packages/core/src/ws/protocol.ts`）
- `generate_cg` 加 `referenceCharacters?: string[]`、`useHistory?: boolean`
- 新增下行消息 `image_result`

**server**
- `src/imagePrompt.ts`（新）
- `src/playAssets.ts`：`assertReferences` 公开、`referenceSpriteOf` 兜底、`AssetNotify` 加 `"manual"`
- `src/playhouse.ts`：`requestCg` 前置校验 + 参数透传；`generateImage` 手动入口
- `src/http.ts`：`POST /api/plays/:id/images`
- `src/transport.ts`：`generate_cg` 透传新字段

**web**
- `src/ui/RefCharacterPicker.tsx`（新）、`src/stage/cgOptions.ts`（新）
- `src/workshop/ImageGenDialog.tsx`（新）
- `src/stage/StageTheater.tsx`、`src/views/StageScreen.tsx`、`src/stage/useStageSocket.ts`
- `src/workshop/CharacterEditor.tsx`、`CharacterPane.tsx`、`AssetsPanel.tsx`、`WorkshopPane.tsx`
- `src/api.ts`、`src/app.css`

**文档**
- `README.md`：导演生图补两条；新增「工坊手动生图」一节

## 验证

自动化（不碰真生图，backend 与 LLM 全 mock）：

| 文件 | 例数 | 覆盖 |
| ---- | ---- | ---- |
| `apps/server/test/imagePrompt.test.ts` | 5 | 三种 kind 的组装；`useHistory=false` 丢剧情；参考图编号；空响应抛错 |
| `apps/server/test/playhouse.test.ts` | +4 | 无立绘角色前置抛错；未勾历史且无指令拒绝；`generateImage` 返回与 `image_result` 广播 |
| `apps/web/test/cgOptions.test.ts` | 4 | 勾选顺序；提交门槛 |

全量 `pnpm -r build` 通过（core / server / web 三个包）。

实机验收项见同目录 `261003-manual-image-gen.validation.md`。

## 遗留

- **样式**：`.ref-picker-*` / `.image-gen-*` 是照着既有变量写的克制版本，没有引入新的视觉语言；若要调手感，改这三处即可。
- **不做**：拖拽排序（顺序 = 点选顺序）、提示词手写入口（CG 页台账已有原文）、勾选状态持久化（每次打开回默认）。

## 相关

- 计划：[261003-manual-image-gen.plan.md](./261003-manual-image-gen.plan.md)
- 检视：[261003-manual-image-gen.review.md](./261003-manual-image-gen.review.md)
- 验证：[261003-manual-image-gen.validation.md](./261003-manual-image-gen.validation.md)
