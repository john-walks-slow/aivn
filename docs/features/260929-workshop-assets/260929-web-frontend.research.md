# 工坊生图 + 就绪门放开 —— 前端现状调研（只读）

> 范围：`apps/web/` + `packages/core/src/ws/protocol.ts`（契约）+ 少量 server 侧只为回答"前端分支的另一半是什么"。
> 目标：给工坊 agent 加生图能力、放宽就绪门，前端要动哪里。

---

## 0. 一页速览

| 关注点 | 现状 | 改造成本 |
| --- | --- | --- |
| 工坊面板消息流 | 7 条 `workshop_*` 下行 + 5 条上行，状态机集中在 `useWorkshop.ts` 一个 switch | 加消息只改 1 处 switch + 1 处类型 |
| 工具名中文映射 | `TOOL_LABEL` 一张 5 项硬表（`useWorkshop.ts:38-44`） | 加生图工具 = 加一行 |
| 写盘可撤销 | 纯前端：拿 `before` 反向调 REST `saveFile`/`deleteFile`，**没有** `workshop_undo` 消息 | 新增能力可沿用同一模式 |
| FileBrowser | 纯文本浏览器，无任何二进制/图片渲染 | 需新增图片分支 |
| 就绪门 | 4 处呈现点，缺项判定在**前端各写一遍**（Title/Library），不是纯服务端 | 放开只需删 2 行 × 2 处 |
| 舞台素材解析 | 静态素材 > 生成资产；sprite 不走生成资产 | 无需改 |
| 缺图降级 | bg → 氛围渐变底色 + 骨架 shimmer；sprite → **角色直接不上台** | 需产品决策 |
| 图片预览/灯箱 | **全项目零个**，只有舞台 3 个 `<img>` | 需从零做 |
| 新增一条 WS 消息 | 4 处：core protocol → server emit/route → web 类型 → UI 渲染 | — |

---

## 1. 工坊前端全貌

### 1.1 两条 WS 通道（工坊与演出共用协议、不同连接）

| 形态 | 入口 | 通道 | 特点 |
| --- | --- | --- | --- |
| 抽屉 | `StageScreen.tsx:207-216` | 复用 `useStageSocket` 的连接，`subscribeWorkshop` 分发表 → `onWorkshop` 回调（`useStageSocket.ts:188-191`） | 演出进行中也能开，与演出共享一条 socket |
| 全屏 | `views/WorkshopScreen.tsx` | 独立 `useWorkshopSocket` 连接，URL 带 `&workshop=1`（`useWorkshopSocket.ts:31`） | 服务端据此跳过 autostart，逛工坊不会把戏开起来 |

`WorkshopPanel` 本身是**传输无关**的：只吃 `subscribe` + `send` 两个 prop，两种形态复用同一个组件（`WorkshopPanel.tsx:20-31`）。**这是新增消息的最省力接入点**。

- 订阅时机：`WorkshopPanel.tsx:40-44` 挂载即 `subscribe(onMessage)` + `open()`，注释明确「先订阅再报到（StrictMode 下走两遍，报到幂等）」。
- `useWorkshopSocket` 只转发 `msg.type.startsWith("workshop_")` 和 `error`（`useWorkshopSocket.ts:42-46`）。**注意**：若新增的消息名不以 `workshop_` 开头（如 `workshop_image_ready` ✅ / `asset_ready` ❌），全屏页会静默丢弃。`useStageSocket` 同理（`useStageSocket.ts:190`）。
- 重连退避 `500 * 2^n` 上限 4s，两处实现一致（`useWorkshopSocket.ts:51`、`useStageSocket.ts:197-198`）。

### 1.2 状态机（`useWorkshop.ts`）

`WorkshopState` 9 个字段（`useWorkshop.ts:13-25`）：`threads / activeId / messages / streaming / activity / writes / busy / error`。

下行消息 → 状态收敛，全部在一个 `switch`（`useWorkshop.ts:51-85`）：

| 消息 | 处理 | 行号 |
| --- | --- | --- |
| `workshop_threads` | 写 `threads` + `activeId`（含 `activeRef`） | 54-56 |
| `workshop_history` | **整段替换** `messages`；**故意不动 `busy`**（服务端开跑前先发 history，提前解锁会让用户重发） | 57-61 |
| `workshop_chunk` | 累加 `streaming`，置 `busy=true` | 62-63 |
| `workshop_tool` | `activity = TOOL_LABEL[name] ?? name` | 64-65 |
| `workshop_write` | 追加一条 `WorkshopWriteRecord{path, before, at}` | 66-70 |
| `workshop_done` | assistant 消息入 `messages`，清 `streaming/activity`，`busy=false` | 71-78 |
| `workshop_error` | 置 `error`，`busy=false` | 79-80 |

上行出口（全部走 `send` 拼 `ClientMessage`）：`open()` → `workshop_open`（88-90）、`chat()` → `workshop_chat`（92-106，带乐观回显）、`activate()`（108-113）、`setArchived()`（115-120）、`remove()`（122-127）、`dismissWrite()`（129-131，纯本地）。

⚠️ **写盘记录在面板关闭即清空**（`writes` 存在 `useState` 里，无持久化、无重放）。工坊线程的 `workshop_history` 只回 `WorkshopChatMessage[]`（纯文本），**不带写盘记录**——重开面板/刷新页面后撤销条就没了。若生图产物也走"可见可撤销"记账，面临同一个取舍。

### 1.3 `workshop_tool` 的中文文案映射

**位置：`apps/web/src/workshop/useWorkshop.ts:38-44`**，一张扁平 `Record<string, string>`，共 5 项：

| 工具名 | 中文文案 |
| --- | --- |
| `list_files` | 查看文件清单 |
| `read_file` | 读取文件 |
| `write_file` | 写入文件 |
| `delete_file` | 删除文件 |
| `get_readiness` | 检查就绪条件 |

未命中走 `?? msg.name`（`:65`）兜底显示裸英文名。新增生图工具（`generate_image` 之类）**在此表加一行**即可。渲染处是 `WorkshopPanel.tsx:162` 的 `<div className="chat-activity">{state.activity}…</div>`，样式 `app.css:986`（灰色斜体小字）。

服务端 `workshop_tool` 由 pi 的 `tool_execution_start` 事件驱动（`server/src/workshop.ts:238-240`），**工具名直接透传，不做翻译**——翻译是前端唯一的职责。

### 1.4 `workshop_write` 的"可见可撤销"渲染与撤销路径

**渲染**：`WorkshopPanel.tsx:186-218`，面板底部固定条 `.workshop-writes`（`app.css:1016-1040`，上限 132px 可滚动），每行 `📝 {path}` + 「撤销」+「知道了」两个按钮。

**撤销（重点）**：**没有 WS 消息，也没有专门的撤销端点**。`WorkshopPanel.tsx:191-211` 是纯前端反向操作：

- `before === null`（新建）→ `api.deleteFile(playId, path)` → `DELETE /api/plays/:id/files?path=…`（`api.ts:123-124`）
- `before !== null`（改写）→ `api.saveFile(playId, path, before)` → `PUT /api/plays/:id/files`（`api.ts:116-121`）
- 成功后 `dismissWrite(at)` 从列表移除；失败**静默保留记录**（`catch {}`，注释"撤销失败保留记录，用户可重试"，`:204-206`）

服务端对应 `WorkshopSession.writeFile/removeFile`（`server/src/workshopSession.ts:141-152`）：**刻意不产生 `workshop_write` 记录**——注释说明这是"agent 改了什么"的账，人手改的不记账，否则撤销会套娃。落盘后触发 `onFilesChanged()` → runtime 重建。

⚠️ 对生图的含义：产物是**二进制图片**，`api.saveFile`/`deleteFile` 只能传字符串。要让"生图产物可撤销"，要么在 `workshop_write` 旁边新增一条带 URL 的记录（前端只删 UI 条，实际删文件要走 `DELETE /api/plays/:id/assets?kind=&name=`，`api.ts:98-101`），要么接受"工坊生图产物不提供撤销"。**这是个待决策点。**

### 1.5 线程列表 / 新建 / 归档

全部在 `WorkshopPanel.tsx:87-131`，由 `showThreads` 布尔开关控制（`☰` 按钮，`:64-66`）。

- **新建**：**没有 `workshop_create` 消息**。「＋ 新线程」只做本地清场——`setTab("chat"); setShowThreads(false); setInput("")`（`:89-98`）。真正的"新建"发生在下一次 `workshop_chat` **不带 `threadId`** 时，由服务端 `chat(text, threadId=undefined)` 隐式建线（`useWorkshop.ts:103`，协议注释"不带 threadId 则新建线程"，`protocol.ts:123`）。
- **切换**：`workshop.activate(id)` → `workshop_activate`（`:104`），服务端回 `workshop_history` 整段替换。
- **归档/取消归档**：图标按钮 `📥 / ↩`，调 `setArchived(id, !archived)`（`:113`）。**列表里归档线程仍然显示**，只加 `[归档]` 前缀（`:108`）——没有"只看未归档"的过滤。
- **删除**：`✕` + `window.confirm` 二次确认（`:118-126`）→ `workshop_delete`。
- 标题显示 `activeThread?.title ?? "新线程"`（`:67`），标题由服务端 `deriveThreadTitle(首条用户消息)` 生成。

---

## 2. FileBrowser（剧目文件浏览器）

`apps/web/src/workshop/FileBrowser.tsx`（176 行）。

**数据源全部是 REST，不是 WS**（`api.ts:111-124`，服务端 `http.ts:220-241`）：

| 动作 | 调用 | 说明 |
| --- | --- | --- |
| 列目录树 | `api.listFiles(playId)` → `GET /api/plays/:id/files` | 服务端一次性返回**扁平** `PlayFile[]`（含 `path / dir[] / size / writable`），前端按 `dir.join("/")` 分组成一层的分组列表（`FileBrowser.tsx:96-105`）。**不是真正的递归树**，只有一层目录分组 |
| 读 | `api.readFile(playId, path)` → `GET .../files?path=` | 返回 `{ path, content }`，`content` 是**字符串** |
| 存 | `api.saveFile` → `PUT .../files`，body `{path, content}` | 保存后 `reload()` 重列 |
| 新建 | `window.prompt` 要路径 → 直接 `saveFile` 写模板内容（`:62-74`） | prompt 文案："新文件路径（可写：play.json、memory/** 的 .md/.json/.txt）" |
| 删 | `window.confirm` → `api.deleteFile` → `DELETE .../files?path=` | 仅 `writable && path !== "play.json"` 时显示 ✕（`:134-138`） |

**外部写盘联动**：父组件传 `revision={state.writes.length}`（`WorkshopPanel.tsx:143`），`useEffect(reload, [reload, revision])` 在工坊 agent 每次写盘后重列（`FileBrowser.tsx:30`）。`onSaved` 目前是 `() => undefined` 空实现（`WorkshopPanel.tsx:144`）。

**白名单（服务端裁定，前端只读 `writable` 标志）**：`server/src/playFiles.ts:15-46`
- 可写：`play.json` + `memory/**` 的 `.md/.json/.txt`
- 只读可见：`assets/**`（`READONLY_PREFIXES`）
- 完全不可见：`session.json` / `lineage.jsonl` / `media-cache`
- 根层 `memory` / `assets` 目录本身不可见但可下钻（`isTraversableDir`）

### 非文本文件展示能力：**完全没有**

- 唯一的编辑器是 `<textarea className="file-editor">`（`FileBrowser.tsx:159-164`），纯文本。
- `api.readFile` 返回 `content: string`，服务端 `files.read()` 按 UTF-8 读——**点开一张 PNG 会拿到乱码字符串**（不是报错，是塞满 textarea 的乱码）。这是当前的一个真实缺陷/坑点。
- 全项目无任何缩略图、`<img>` 预览、灯箱组件（见 §5）。
- `assets/**` 下的图片在列表里只是文件名文本（`basename`，`FileBrowser.tsx:174-176`），标「只读」。

**改造含义**：若工坊生图产物落 `assets/`，FileBrowser 会立刻把它们列出来（只读），但点开是乱码。需要加一个"按扩展名分流"：`.png/.jpg/.jpeg/.webp/.gif` → `<img src={assetUrl(playId, dir, name)}>` 预览（`api.ts:154-156` 已有 `assetUrl` helper），其余走 textarea。

---

## 3. 就绪门在前端的全部呈现点

就绪门数据源是**服务端** `PlayStore.readiness()`（`server/src/store.ts:102-124`），结构 `Readiness`（`api.ts:4-10`）：

```
ready = premise非空 && characterSprites && (backgrounds/ 下有 ≥1 张 png/jpg/jpeg/webp)
```

⚠️ **但缺项文案在前端被重复实现了两遍**，不是纯服务端下发：
- `TitleView.tsx:19-24`（内联 `missing` 数组）
- `LibraryView.tsx:6-12`（独立 `missingItems(r)` 函数）

两处逻辑逐字相同（`premise` / `角色立绘映射` / `背景图`）。**放开就绪门必须同时改这两处，漏一处就出现"剧目库说可开演、Title 说缺东西"。**

### 3.1 TitleView（`views/TitleView.tsx`）

**disabled 条件与缺项提示原文：**

`TitleView.tsx:19-24`（缺项收集）：
```tsx
  const missing: string[] = [];
  if (readiness) {
    if (!readiness.premise) missing.push("premise");
    if (!readiness.characterSprites) missing.push("角色立绘映射");
    if (!readiness.background) missing.push("背景图");
  }
```

`TitleView.tsx:58-65`（开始按钮）：
```tsx
            <button
              className="primary"
              disabled={!readiness?.ready}
              title={readiness?.ready ? "" : `缺：${missing.join("、")}`}
              onClick={() => navigate(`/play/${playId}/stage?mode=start`)}
            >
              开始游戏
            </button>
```
disabled 条件 = `!readiness?.ready`（服务端 `ready` 的整体取反）。tooltip = `缺：{premise、角色立绘映射、背景图}` 顿号连接。

`TitleView.tsx:82-94`（缺项提示块原文）：
```tsx
          {!readiness?.ready && missing.length > 0 && (
            <p className="title-gate">
              就绪门未过（缺：{missing.join("、")}）——请到
              <button className="link-btn" onClick={() => navigate(`/play/${playId}/workshop`)}>
                工坊
              </button>
              与 AI 共创补齐，或到
              <button className="link-btn" onClick={() => navigate(`/play/${playId}/assets`)}>
                素材与配置
              </button>
              手动补齐。
            </p>
          )}
```

> **放开到"只要 premise"后**：这段 `title-gate` 提示块只在 premise 缺失时才会出现，逻辑天然自洽（改 `missing` 数组即可）。但 `disabled={!readiness?.ready}` 依赖**服务端** `ready`——**只改前端不够**，必须同时改 `server/src/store.ts:120` 的 `ready` 计算，否则按钮永远灰着。这是最容易漏的一处。

其他：`继续` 按钮仅在 `hasSession` 时出现（`:69-71`）；`工坊`（`:72`）与 `素材与配置`（`:73`）**不受就绪门限制**——`premise` 缺失时也能进工坊，这对"AI 帮你写 premise"是通的。

### 3.2 LibraryView（`views/LibraryView.tsx`）

`LibraryView.tsx:6-12`：
```tsx
function missingItems(r: PlaySummary["readiness"]): string[] {
  const items: string[] = [];
  if (!r.premise) items.push("premise");
  if (!r.characterSprites) items.push("角色立绘映射");
  if (!r.background) items.push("背景图");
  return items;
}
```

呈现点：
- badge 文案：`play.readiness.ready ? "可开演" : "未就绪"`（`:69-71`，类名 `badge ok` / `badge warn`，样式 `app.css:94-104`）
- 卡片副行：`缺：${missing.join("、")}` 或 `id: ${play.id}`（`:74-76`）
- premise 预览：`play.premise ? play.premise.slice(0,90)+"…" : "（premise 待补）"`（`:73`）
- 点击卡片**总是**跳 Title 页，不直接开演（`:66`）——所以 Library 的 badge 不会绕过就绪门，不存在绕过风险。

### 3.3 AssetsView（`views/AssetsView.tsx`）

- **就绪门 badge**：`:74-78`，文案 `就绪门：可开演` / `就绪门：未就绪`（比 Library 多"就绪门："前缀），同一 `badge ok/warn` 类。
- **素材上传 UI**（`:178-246`）：
  - `KINDS = ["backgrounds","cg","sfx","bgm"]`（`:7`）四宫格，每格一个 `<input type="file" hidden>` + `label.btn-as-label` 包「上传」；列表项只有文件名 + 「删除」链接，**无缩略图**。
  - sprites 单独一格（`:208-244`）：先在文本框输入角色 id，再选文件上传到 `sprites/<id>`（`accept="image/*"`）。
  - 上传 → `api.uploadAsset(playId, kind, file.name, file)`（`api.ts:92-96`）→ 服务端 `playhouse.reload(playId)`（`http.ts`）→ 前端 `reload()` 重拉。
- **角色立绘映射编辑器**（`CharacterEditor`，`:258-382`）：
  - 行模型 `SpriteRow{id, expression, file}`，**用本地自增 id 作 key**——注释说明是为避免以可变 `expression` 作 key 导致每击键重挂载失焦（`:251-252`）。
  - 每行：`expression` 文本框（`onBlur` 才 commit，`:362`）+ `file` 下拉（选项来自 `assets['sprites/<charId>']`，`:364-370`）+ 「删」。
  - commit 逻辑 `Object.fromEntries(rows.filter(expression非空).map(...))` 写回 `char.sprites`（`:295-301`）。
  - 「＋ 添加映射」默认 `file: files[0] ?? ""`（`:315-317`）。
  - 提示文案："立绘差分映射（expression → 文件）——差分文件需先上传到 sprites/{char.id}/"（`:352`）。
  - 音色下拉 + 「试听」（`:333-351`，`VOICE_PRESETS` 来自 core）。
- **注意**：立绘映射编辑器的 `file` 下拉**只列磁盘上已有文件**（`:365`）。若工坊生图产物落在 `media-cache/img/`（不进 `assets/`），这里看不到——必须确认产物落点。

---

## 4. 舞台侧素材解析

### 4.1 解析链路

`StageScreen.tsx:115-118` 建索引：
```tsx
  const index: AssetIndex | null = useMemo(
    () => (detail ? buildAssetIndex(playId, detail.play, assets, generated.images) : null),
    [detail, assets, playId, generated.images],
  );
```
输入三份：`playDetail`（角色卡含 `sprites` 映射）、`api.listAssets`（`Record<kind, filename[]>`）、`useGeneratedAssets()` 的 `images`（生成资产台账）。`generated.images` 变化 → 索引重建 → 舞台重渲染（这就是"到货后自动淡入"的机制）。

`buildAssetIndex`（`stage/assets.ts:22-53`）：

- `stemMap(files)`（`:13-20`）：`文件名去扩展名 → 文件名` 的 Map。支持 `<scene bg="rooftop">` 写 stem 也写 `rooftop.png`。
- URL 拼装：`/plays/${playId}/assets/${dir}/${file}`（`:32`）——**静态素材**。
- `byStem` 闭包（`:33-39`）—— **bg / cg / bgm / sfx 统一逻辑**：
  1. 先查静态 stemMap → 命中则返回 `/plays/:id/assets/<dir>/<file>`
  2. 未命中 → 查 `generated[stem]`，且必须 `ready === true` → 返回 `gen.url`（`/plays/:id/media/img/<hash>.jpg`）
  3. 都没有 → `null`（走降级）
  4. 注释原文：`// 静态素材优先（用户导入的是最终资产），缺了才用站内生成的同名 id（D6）`
- **sprite 例外**（`:46-52`）：
  ```tsx
    sprite: (charId, expression) => {
      const character = play.characters.find((c) => c.id === charId);
      const mapped = expression ? character?.sprites?.[expression] : undefined;
      if (mapped) return url(`sprites/${charId}`, mapped);
      const files = assets[`sprites/${charId}`] ?? [];
      return files[0] ? url(`sprites/${charId}`, files[0]!) : null;
    },
  ```
  **不查 `generated`**。三级降级：① 角色卡 `sprites[expression]` 映射 → `sprites/<charId>/<file>`；② 无映射时回退该目录**第一个文件**（`files[0]`，文件名排序，不保证是中性表情）；③ 都没有 → `null`。

### 4.2 差分切换逻辑

事件流：`StageEvent.actor` → `Cue{kind:"actor", id, pos, expression, action}`（`stage/script.ts:67`）→ `applyVisual`（`stage/director.ts:107-122`）→ `visual.sprites[id] = {pos, expression}` → `StageTheater.tsx:207-218` 渲染时调 `index.sprite(id, slot.expression)`。

- `expression` 来自 DSL 里的 `<actor id mood>`（`cue.expression`），**每次 actor cue 覆盖**（`director.ts:119`），旧表情自然被替换 —— 这就是差分切换。
- `action === "exit" | "leave"` → 从 `visual.sprites` 删除该角色（`director.ts:108-112`）。
- 每次切换**不做预解码**（只有生成资产走 `generatedAssets.add` 的 decode 预热）；`<img key={id}>` 用的是角色 id，**URL 变了不 remount，浏览器自己换 src**。
- 位置：`POS_CLASS = {left:"pos-left", center:"pos-center", right:"pos-right"}`（`StageTheater.tsx:28`），CSS 固定 `bottom:0; height:88%; left:18%/50%/82%`（`app.css:328-345`）。

**所以「立绘不做生图」是硬约束**：`director.ts:104` 的 `case "preload": if (cue.type === "sprite") return prev;` —— sprite 类型的 preload cue 被整个丢弃，不产生 `pending` 占位。协议注释也写明 `type: bg | cg（sprite 不做生图，见计划 D6）`（`protocol.ts:39`）。**若本次要给工坊加"生成立绘"，需要推翻这条（会牵动 `generatedAssets` 的 `type` 联合类型、`assets.ts` 的 sprite 分支、`StageTheater` 的 pending 逻辑三处）。**

### 4.3 缺图降级（★ 重点确认）

`StageTheater.tsx:84-89` 计算：
```tsx
  const bgUrl = index.bg(visual.bg);
  const cgUrl = index.cg(visual.cg?.id ?? null);
  const bgPending = !bgUrl && !!visual.bg && visual.pending[visual.bg]?.type === "bg";
  const cgPending = !cgUrl && !!cgId && visual.pending[cgId]?.type === "cg";
```

**① 某个角色没有立绘 → 该角色直接不上台。**
`StageTheater.tsx:207-218`：
```tsx
        {Object.entries(visual.sprites).map(([id, slot]) => {
          const url = index.sprite(id, slot.expression);
          if (!url) return null;
```
`index.sprite` 返回 `null` → **`return null`，整个角色静默消失**。没有占位、没有立绘位置留白、没有对话框人名以外的提示。对话照常演出（`dialog-name` 仍显示角色名，`StageTheater.tsx:236`），但舞台上就是空无一人。**无任何用户可见信号**——这是本轮最值得改进的降级表现。

（注意：即使角色卡 `sprites[expression]` 映射指向了磁盘上不存在的文件，也会得到一个 404 的 `<img src>`，表现是破图图标，不是 null。）

**② 某个 scene 没有背景 → 舞台显示氛围渐变底色（米灰），非黑色/非空。**
`StageTheater.tsx:197-205`：
```tsx
        {bgUrl ? (
          <img key={bgUrl} className="theater-bg theater-bg-in" src={bgUrl} alt="" />
        ) : (
          <div
            className={`theater-bg theater-bg-fallback ${bgPending ? "theater-bg-pending" : ""} ${
              visual.transition === "cut" ? "cut" : ""
            }`}
          />
        )}
```
- `bgUrl === null` → 渲染一个空 `div`，底色来自父容器 `.theater-stage` 的 `background: linear-gradient(180deg, #f2efe9, #e8e4dc)`（`app.css:299-300`）—— **米白→浅灰的垂直渐变**。
- 若该 bg 正在生成中（`bgPending`）→ 额外叠加 `.theater-bg-pending` 的深蓝灰 shimmer 骨架（`app.css:691-699`，`asset-shimmer` 1.6s 无限动画，底色 `#1d2330 → #2a3243`）。
- **背景永久缺失（非 pending）就是纯米灰渐变，永久占位，永不超时摘除**（`pending` 表里没有它）。台词照演。
- **CG 缺失同理**：`.theater-cg` 是 `position:absolute; inset:0; background:#111` 的**全屏黑幕**（`app.css:347-352`）。`cgPending` 时渲染黑底 + shimmer + caption（`StageTheater.tsx:226-230`）；**永久缺失时 `cgUrl && ...` 与 `cgPending && ...` 都不成立 → 什么都不渲染 → 露出下层背景**。所以"cg 缺图"的表现取决于当时有没有底图。

**③ 骨架 TTL 兜底**：`director.ts:20` `PENDING_TTL_MS = 45_000`；`director.ts:230-245` 每 5s 扫一次 `visual.pending`，超 45s 的直接摘掉 → 从"深蓝 shimmer 骨架"退回"米灰底色"。

**④ 台词永不阻塞**：这是 P3「文字先行」铁律。所有生图状态（pending/失败/超时）都不影响 `usePlayback` 的打字机与推进（`director.ts` 里 `settleAssets` 只删 `pending` 表项，不碰 `cursorRef`）。

### 4.4 服务端交给 playwriter 的素材清单（对应"客户端找不到图"的另一半）

`server/src/prompt.ts:13-42` 构造 A 区的素材清单：
- 角色块：`**id: ${c.id}**` + persona + `立绘差分 expression：a | b | c`——**优先取 `c.sprites` 的键名**（角色卡映射），无映射时回退磁盘文件名 stem（`:22-25`）
- `# 可用背景 bg` / `# 可用音乐 bgm` / `# 可用音效 sfx` / `# 已有插图 cg`，**全部只在对应目录非空时才输出该段**（`:37-42`）
- 所以**没有背景图时，playwriter 根本不知道有哪些背景 id**，它写 `<scene bg="xxx">` 是自由发挥 → 客户端必然 `null` → 米灰底。
- 生图入口是 DSL 标签 `<preload_asset type="bg|cg" prompt="英文生图描述" id="资源id"/>`（`:75`），铁律：先发射后使用，约 15-30 秒。
- **这条清单只注入 playwriter，工坊 agent 的 system prompt 是另一套**（`server/src/workshopSession.ts:172+` 的 `systemPrompt()`，取 `play / files.list() / readiness`）。工坊 agent 目前**看不到**生成资产台账，也不知道 playwriter 已有哪些生成 bg/cg id —— 这是新增工坊生图时的一个信息缺口。

---

## 5. 现成的图片预览 / 灯箱组件：**没有**

全 `apps/web/src` grep `lightbox|灯箱|preview|<img|Image()|thumbnail|缩略图` 只命中 11 处，全部是：

| 位置 | 用途 |
| --- | --- |
| `stage/generatedAssets.ts:53` | `new Image()` + `decode()`——**预解码工具**，不是 UI |
| `stage/generatedAssets.ts:36` | 注释里提到 `<img>` |
| `stage/StageTheater.tsx:198, 211, 222` | 舞台三个 `<img>`：bg / sprite / cg |
| `api.ts:105` | `tts-preview` 端点（音频，不是图） |
| `views/AssetsView.tsx:272-350` | `previewing` 是**音色试听**状态，与图片无关 |

**结论：没有可复用的图片预览组件、灯箱、缩略图网格。** 唯一可复用的是：

1. **CSS 惯例**（`app.css`）：
   - 骨架 shimmer：`.theater-bg-pending, .theater-cg-pending` + `@keyframes asset-shimmer`（`app.css:691-710`）——"图在途"的视觉语言，气泡里的图可以直接复用。
   - 淡入：`.theater-bg-in { animation: bg-fade .6s ease }` / `.theater-cg-in { animation: bg-fade .5s ease }`（`app.css:687-702`）。
   - 圆角变量 `--radius`、底色 `--bg`、弱化文字 `--ink-faint`。
2. **气泡容器**：`.chat-bubble`（`app.css:966-973`，`padding:8px 11px; border-radius:10px; white-space:pre-wrap; max-width:88%`）+ `.chat-user` / `.chat-assistant`（用户右对齐 accent 实心 / assistant 左对齐 `#f4f3ef` 浅灰）。在气泡里塞 `<img>` 需注意 `white-space:pre-wrap` 和 `max-width:88%` 的约束。
3. **URL helper**：`assetUrl(playId, dir, name)`（`api.ts:154-156`）。
4. **preload 预热**：`generatedAssets.ts:52-60` 的 `decode(url)` 函数可抽出来复用（避免贴上来时白闪）。

建议做法：抽一个 `<ImageLightbox>`（单图 + 点击放大 + Esc 关闭 + `object-fit: contain` + 复用 `bg-fade` 动画）到 `apps/web/src/ui/`，气泡内先渲染缩略图。**需新建目录 `apps/web/src/ui/`（当前没有）。**

---

## 6. 消息类型契约与"新增一条消息要动哪些地方"

### 6.1 契约位置

**唯一定义处：`packages/core/src/ws/protocol.ts`（128 行）**

- `ServerMessage` 联合类型 `:43-97`（27 个成员）
- `ClientMessage` 联合类型 `:99-126`（21 个成员）
- 辅助类型：`StopPayload` `:4-8`、`BeatEndPayload` `:10-15`、`WorkshopThreadInfo` `:18-24`、`WorkshopChatMessage` `:27-31`、`GeneratedAsset` `:34-41`

`workshop_*` 下行（`:86-96`）：
```ts
  | { type: "workshop_threads"; threads: WorkshopThreadInfo[]; activeId: string | null }
  | { type: "workshop_history"; threadId: string; messages: WorkshopChatMessage[] }
  | { type: "workshop_chunk"; threadId: string; delta: string }
  | { type: "workshop_tool"; threadId: string; name: string }
  | { type: "workshop_write"; threadId: string; path: string; before: string | null }
  | { type: "workshop_done"; threadId: string; text: string }
  | { type: "workshop_error"; threadId: string | null; message: string }
```
`workshop_*` 上行（`:118-126`）：`workshop_open` / `workshop_activate` / `workshop_chat` / `workshop_archive` / `workshop_delete`。

`asset_*` 相关（**注意命名不统一**）：
- `hello.assets?: GeneratedAsset[]`（`:52`）—— manifest 全集快照
- `asset_ready { asset: GeneratedAsset }`（`:65`）—— 瞬态，不进事件缓冲
- `asset_failed { id, message }`（`:67`）—— 瞬态

⚠️ **前缀不一致**：生图消息用 `asset_*`，工坊用 `workshop_*`。若工坊生图产物要做成消息，**必须用 `workshop_` 前缀**才能被 `useWorkshopSocket.ts:42` 和 `useStageSocket.ts:190` 的 `startsWith("workshop_")` 分发捕获。用 `asset_*` 会被全屏工坊页静默吞掉。

### 6.2 新增一条消息的改动清单（以"工坊生图完成通知"为例）

| # | 文件 | 改什么 |
| --- | --- | --- |
| 1 | `packages/core/src/ws/protocol.ts` | 在 `ServerMessage` 联合里加一条（`workshop_*` 前缀）。若要上行，再在 `ClientMessage` 加 |
| 2 | `packages/core` → **rebuild** | `pnpm --filter @stage-ai/core build`。server/web 走 workspace symlink 的 `dist` 类型，不 rebuild 类型不更新（AGENTS.md 明确要求） |
| 3 | `apps/server/src/workshopSession.ts` | 生图完成后 `this.opts.emit({...})`（现有 emit 集中在 `:118-128`、`:156`） |
| 4 | `apps/server/src/transport.ts` | 若有上行：`case "xxx":` 加分支（现工坊分支 `:138-151`）；否则只 emit 无需动 |
| 5 | `apps/web/src/workshop/useWorkshop.ts` | `onMessage` 的 `switch` 加 case（`:51-85`）；若要展示图，加 `state` 字段（如 `images`）+ `WorkshopState` 接口（`:13-25`）。⚠️ **注意 `switch` 里的 `default: return prev` 是兜底，漏了不会报错只会静默无反应** |
| 6 | `apps/web/src/workshop/WorkshopPanel.tsx` | 在 `.workshop-chat` 容器（`:147-164`）里渲染新状态。⚠️ **当前气泡渲染是扁平的 `state.messages.map`（纯文本 `msg.text`，`:156-160`），不支持结构化内容**——展示图需要改渲染结构（例如消息扩成 `{text, images?}` 或单独一条 `state.images` 流） |
| 7 | `apps/web/src/workshop/useWorkshop.ts:38-44` | 新工具名加进 `TOOL_LABEL`（若新增了 workshop 工具） |
| 8 | `apps/web/src/app.css` | 新样式（可复用 `asset-shimmer` / `bg-fade`） |

**额外注意**：
- 两条传输通道都要通。`useWorkshopSocket`（全屏）**只转发 `workshop_*`**（`:42`），`useStageSocket`（抽屉）在 `default` 分支转发（`:188-191`）——两处筛选条件要一致。
- 瞬态 vs 可重放：工坊消息**全部不在事件缓冲**里（`workshop_*` 没有 `seq`，buffer 只装 `SequencedEvent`），所以重连后工坊现场靠 `workshop_open` → `snapshot()` 重建。**新增消息若携带"图已生成"这类状态，要考虑 snapshot 补发**，否则断线窗口丢消息后前端永久缺图（`workshop_write` 就有这个已存在的问题，见 §1.4）。
- 若图片 URL 走 `/plays/:id/media/img/...`，**舞台全屏页那条连接也会收到**——但舞台侧的 `useGeneratedAssets` 不知道工坊生成的图（`GeneratedAsset.type` 只有 `bg|cg`），需要决定工坊产物是否也进 `generated.images` 台账（会影响 §4.1 的静态/生成优先级）。

---

## 7. 给本轮需求的落点建议（前端）

1. **就绪门放开**：`server/src/store.ts:120` 改 `ready` 计算 + `TitleView.tsx:19-24` 和 `LibraryView.tsx:6-12` **两处 missing 逻辑同步删行**。建议顺手把重复的 missingItems 提到 `api.ts` 或 core 的 `Readiness` 旁边。
2. **工坊生图 UI**：`WorkshopPanel.tsx:156-160` 的消息渲染需要从"纯文本气泡"升级为"可含图气泡"——这是唯一一处结构性改动。样式可直接复用 `asset-shimmer`/`bg-fade`。
3. **新灯箱组件**：新建 `apps/web/src/ui/ImageLightbox.tsx`，从零写。
4. **FileBrowser 图片分支**：`FileBrowser.tsx` 的 `select` 回调按扩展名分流到 `<img src={assetUrl(...)}>`，避免 PNG 被当文本读成乱码。
5. **待决策**：① 工坊生图产物落 `assets/`（会被 FileBrowser 列出、可静态优先）还是 `media-cache/img/`（不进文件树、只在 `generated` 台账）；② 立绘差分是否开放生图（会牵动 D6「sprite 不生图」铁律与 3 处代码）；③ 缺立绘的降级是否要改成"至少显示一个人影/对话框标识"，当前的"静默消失"对玩家是硬伤。
