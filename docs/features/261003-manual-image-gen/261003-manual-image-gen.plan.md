# 手动生图：舞台 CG 与工坊立绘共用一条链

需求（2026-10-03）：
1. 舞台「生图」按钮：可选**参考角色立绘**（多选、有序），可勾**基于历史**（默认勾上）。
2. 工坊也能**手动**生图：不跟搭台助手对话，在角色卡上直接生成 / 重生成立绘差分。
3. 做成通用设计：三种目标（立绘 / 背景 / CG）共用同一条「指令 → 英文提示词 → 出图」链，入口只是薄壳。

## 现状

- 舞台生图：`StageTheater` 生图 Modal（只有指令输入框）→ WS `generate_cg`
  → `playhouse.requestCg()`：`recentScript()` 最近 12 句 + 当前场景 + 角色卡 + craft
  交给剧作家的模型合成英文提示词（`CG_PROMPT_SYSTEM`）→ `preloadAsset` 出图。
- 工坊生图：只有 agent 一条路——对话里调 `generate_image` 工具（sync 等图，气泡贴进对话流）。
  用户自己想出一张，只能上传现成文件或央求 agent。
- **垫图链路已通**：`PlayAssets` 的 `AssetTarget.referenceCharacters` 对 background/cg 生效
  （读角色 neutral 定妆照垫图 + 提示词末尾拼「第 N 张图是谁」编号锚），`generate_image` 工具在用。
- 手动出图**没有** REST 通道：舞台走 WS（要落时间线节点 + 骨架占位），工坊对话走 agent 工具。

## 架构：一个内核，两个服务端入口，三个前端入口

```
                    ┌─ WS generate_cg（舞台：落时间线节点 + 骨架占位 + asset_ready）
指令(中文) ──> 组装提示词 ──> PlayAssets.generate（唯一出图层，已在）
                    └─ REST POST /api/plays/:id/images（工坊：手动，发起即返回）

前端：RefCharacterPicker（参考立绘多选，共用）
      舞台 cg Modal / 工坊 ImageGenDialog（角色卡·立绘 / 素材页·背景与CG）
```

「通用」落在三处，其余各自为政，不做大统一：

1. **提示词组装**（`imagePrompt.ts`，新模块）：按 kind 取系统提示词（立绘写手 / 插图写手），
   上下文由调用方收集（舞台带剧情，工坊带角色卡）。`CG_PROMPT_SYSTEM` 从 playhouse 搬过去。
2. **参考立绘校验**（`PlayAssets.assertReferences`，新公开方法）：
   `resolveReferences` + `referenceSpriteOf` 原样提升，`resolve` 内部继续调同一份。
3. **前端选人控件**（`ui/RefCharacterPicker.tsx`，新组件）：缩略图 chip 多选，
   勾选顺序即提示词编号顺序（①②③），舞台 Modal 与工坊对话框共用。

## 决定

### 舞台生图（原需求，不变）

- 参考立绘：只列**有立绘**的角色；默认全不选（垫图让单张 69s→138s，不替玩家默认开）。
- 「基于历史」勾掉 = 提示词里去掉【刚才演到的】+【当前场景】；角色卡与 craft 留着
  （画风锚点是剧目设定，不是历史）。不勾历史且没指令 = 没东西可画，前端禁提交、服务端守卫。
- 参考立绘校验**前置到落时间线节点之前**：现在 `preloadAsset` 把失败吞成 `asset_failed`
  通用文案，「角色 X 没有立绘」这种玩家能修的问题被盖住、还留一个等不到图的空节点。
  改成 `requestCg` 先 `assertReferences`，失败抛出走 `error` 帧（toast 显原文），节点不落。

### 工坊手动生图（新需求）

- **入口在角色卡**（CharacterEditor 立绘差分区）：
  - 「生成立绘」按钮 → 对话框：差分名（新差分填，重生成固定）+ 取景 + 想要什么样的描述；
  - 已有差分行加「重生成」→ 同一对话框，差分名锁定。
  - 没有任何立绘的角色，差分名预填 `neutral`（出图层的定妆照逻辑：非 neutral 且无既有差分
    会自动先出一张 neutral，等于一次烧两张；先出 neutral 是正路）。
- **REST 发起、异步完成，不做长挂请求**：`POST /api/plays/:id/images` 同步做
  目标校验（快）+ 提示词组装（一次短 LLM 调用，与 `polish` 同等待遇），
  然后 kick 出图、立即返回 `{ target, path, prompt }`。出图那 70–140s 不挂在 HTTP 上——
  手机走 CF 隧道时源站 100s 无响应就被掐，同步等图在那条路上必挂。
- **完成态不进工坊对话流**（2026-10-03 用户拍板：只刷新列表，对话流保持纯净）：
  - `AssetNotify` 加第三档 `"manual"`：`onWrite` / `onAsset` 只认 `"workshop"`（自动跳过），
    `onPlayConfigChanged` 只认 `"silent"`（自动跳过）——手动路径不产生对话气泡、
    不写撤销条、不排队重复重建。
  - 新增 ServerMessage `image_result`：`{ type: "image_result"; target: string; ok: true; url; path }
    | { type: "image_result"; target: string; ok: false; message }`，手动生图完成/失败的唯一通道，
    按 play 广播。舞台侧无消费者（useStageSocket 的 default 分支自然忽略），工坊对话框按
    `target`（`sprites/<角色>/<差分>` / `backgrounds|cg/<name>`）匹配收口。
  - 完成后调一次 `reloadAfterWorkshopWrite`（等节拍边界再重建 runtime——素材上传走的同一条；
    立绘映射要重建才进 cast，背景/CG 要重建才进 hello 的 assets 清单）。因为 `"manual"`
    不触发 mapSprite 里的自动重建，这次 rebuild 是唯一一次，不重复。
  - 对话框：发起后停在「生成中…」，收到匹配 `image_result` 就亮图（或亮错误原文），
    随后由所在面板刷新自己的列表（角色页/素材页的既有 reload，与资源库导入完成同路）。
  - 在途可见性顺带成立：`pending.begin` 无条件记账，舞台的排队面板会照常显示这一行。
- **背景 / CG 同一个对话框**（素材页 backgrounds / cg 上传格旁加「生成」，2026-10-03 用户拍板一起做）：
  name + 描述 + 参考立绘（RefCharacterPicker）。

### 一致性修一处

`referenceSpriteOf` 只认角色卡映射或按差分名找文件；舞台 `index.sprite` 兜底「目录里任意一张」。
上传了立绘文件但还没建映射的角色，前端选人器说有、服务端说没有。给 `referenceSpriteOf`
补同样的兜底（按文件名排序取第一张），两头对齐。

## 实现

### core

`packages/core/src/ws/protocol.ts` — `generate_cg` 加可选字段，并新增一条下行消息：

```ts
| { type: "generate_cg"; instruction?: string;
    referenceCharacters?: string[];  // 垫图角色，按序点名
    useHistory?: boolean }           // 默认 true

| { type: "image_result";
    target: string;                  // "sprites/<charId>/<expr>" | "backgrounds/<name>" | "cg/<name>"
    ok: true; url: string; path: string }
| { type: "image_result"; target: string; ok: false; message: string }
```

### server

- `src/imagePrompt.ts`（新）：`composeImagePrompt(deps, kind, ctx)` + 按 kind 的系统提示词
  （`CG_PROMPT_SYSTEM` / `BG_PROMPT_SYSTEM` / `SPRITE_PROMPT_SYSTEM`）+ `MIN_IMAGE_PROMPT_WORDS`。
  ctx：`instruction` / `craft` / `targetCharacter`（立绘=该角色整卡）/ `referenceCharacters`
  （按序点名「参考图 N」）/ `allCharacters` / 舞台额外带 `lines` + `scene` + `useHistory`。
- `src/playAssets.ts`：`assertReferences(ids)` 公开（原 resolveReferences + referenceSpriteOf
  逻辑收口）；`referenceSpriteOf` 兜底目录任意文件（未绑差分映射的上传立绘也算数）；
  `AssetNotify` 加 `"manual"`（不产工坊气泡、不进撤销条、不自动重建）。
- `src/playhouse.ts`：
  - `requestCg(playId, instruction?, opts?)`：校验前置（参考角色先 `assertReferences`，
    未勾历史且无指令直接拒）+ `useHistory` 分支 + 参考角色进组装上下文
    （标「参考图 N」，与编号锚对齐）+ `preloadAsset` 透传 referenceCharacters。
  - `generateImage(playId, req)`（手动入口，REST 调）：校验 → 组装 → 返回
    `{ target, path, prompt }`；`void assets.generate(..., { notify: "manual" })` 异步出图，
    完成/失败一律广播 `image_result`，成功后再 `reloadAfterWorkshopWrite`。
- `src/http.ts`：`POST /api/plays/:id/images`（body 校验 + 400 带人话错误；同步返回，
  不 await 出图——CF 隧道 100s 无字节即断，长生成绝不能压在 HTTP 连接上）。
- `src/transport.ts`：`generate_cg` 透传两个新字段。

### web

- `src/ui/RefCharacterPicker.tsx`（新）：`candidates: {id,name,spriteUrl}[]`、
  `selected: string[]`、`onToggle`；选中项带序号徽标。
- `src/stage/cgOptions.ts`（新，纯函数）：`toggleReference` / `cgCanSubmit`。
- `src/stage/StageTheater.tsx`：cg Modal 加参考立绘区 + 「基于刚才演到的剧情与场景」checkbox
  （默认勾上，每次打开重置）；`onGenerateCg(instruction, opts)` 带上两个字段。
- `src/views/StageScreen.tsx`：塞进 `generate_cg` 帧；新增 `subscribeImageResult` 订阅表
  并把结果下发到工坊（`useStageSocket.onImageResult`）。
- `src/workshop/ImageGenDialog.tsx`（新）：按 kind 出字段
  （立绘：差分名 + 取景；背景/CG：name + 参考立绘），描述输入，发起 → 生成中 →
  按 `target` 匹配 `image_result` 亮图。
- `src/workshop/CharacterEditor.tsx`：立绘差分区加「生成立绘」与逐行「重生成」。
- `src/workshop/AssetsPanel.tsx`：backgrounds / cg 上传格加「生成」。
- `src/api.ts`：`generateImage(id, body)`。
- `src/app.css`：`.ref-picker-*` / `.image-gen-*` 与对话框三条；不动既有样式。

## 测试

- `apps/server/test/imagePrompt.test.ts`（已落地，5 例）：按 kind 组装（mock streamFn）——
  `useHistory=false` 丢台词与场景、参考角色带编号、立绘 kind 带整卡、背景 kind 走背景提示词、
  空响应抛错。
- `apps/server/test/playhouse.test.ts` 扩（已落地，新增 4 例）：
  无立绘角色在落节点前抛错；未勾历史且无指令直接拒；`generateImage` 立绘端点返回
  `{target, path}` 并广播 `image_result`。
- `apps/web/test/cgOptions.test.ts`（已落地，4 例）：勾选序 / 提交门槛。
- 不跑真生图：backend 与 LLM 全 mock。

## 文档

- README：「导演生图」补两条（参考立绘、基于历史）；新增「工坊手动生图」一节。
- AGENTS.md：apps/web（新组件与入口）、apps/server（imagePrompt、手动入口、
  assertReferences 前置）各补一段。
- 本目录：plan / validation / summary。

## 待确认（已定）

1. 素材页的「生成背景 / CG」入口这期做不做 → **做**（对话框是同一个，入口约 30 行）。
2. 工坊手动生图的完成态走工坊对话流气泡 → **不走**：只刷新列表，不产生对话气泡。

## 不做

- 不做拖拽排序：参考立绘顺序 = 勾选顺序，序号可见、可取消重选。
- 不做提示词原文的手写入口（进阶用户看 CG 页的台账即可）。
- 不做生成历史的持久化勾选状态（每次打开回默认）。
- 不给剧作家/搭台助手的工具面任何改动。
