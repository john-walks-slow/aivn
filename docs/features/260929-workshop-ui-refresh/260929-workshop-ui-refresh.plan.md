# 工坊界面翻新（图片预览 · 图标化 · 创作口径可调）

> **状态**：已对齐产品决定，待实施
> **范围**：`apps/web` 工坊界面 + 工坊内嵌的剧目配置面 + 一处服务端提示词外置
> **worktree**：`.worktrees/workshop-ui`（分支 `feat/workshop-ui`）

---

## 0. 调研结论（精简）

两份详查见 [playwriter-config.research.md](./playwriter-config.research.md) / [workshop-ui.research.md](./workshop-ui.research.md)。

**playwriter 现在有哪些配置？**

| 层 | 状态 |
|---|---|
| 模型级（`ServerConfig`，20 个 `STAGE_*`） | 全 env 化且被设置面板全覆盖，改完要重启 |
| 剧目级行为旋钮 | **一个都没有**：每拍 `3~8` 行（[prompt.ts:149](../../apps/server/src/prompt.ts#L149)，纯提示词无校验）、生图提前 `3–5` 句、好感度 `5`/`100`（[orchestrator.ts:58](../../apps/server/src/orchestrator.ts#L58)）、choice 选项条数无上限（parser 只判空）——全是裸常量 |
| 剧目级风格 | 只有 `memory/always/craft.md` 这个自由文本软口，且被命名与定位绑死在「剧艺守则」上 |
| 图标 | 全站无图标库，纯 emoji/Unicode 符号直写 JSX |
| 素材页 | 独立路由 `/play/:id/assets`，与工坊各管各的，剧目级配置被劈成两处 |

## 1. 已对齐的产品决定（2026-09-29）

1. **创作口径 = 自由文本，不做数值旋钮。** 人和工坊 agent 共用 `memory/always/craft.md` 一个口子编辑。
2. **只外置「创作口径」，不外置硬约束。** DSL 9 标签规范、工具名、`beat_done` 独占批次等留在代码里——改错了照样能演出。引擎事实类准则（信任【状态】区、【玩家表态】语义等）同样内置。
3. **素材页并进工坊。** 工坊变四 tab：对话 / 文件 / 素材 / 创作口径。`AssetsView` 整体内嵌，原 `/play/:id/assets` 路由删除。
4. **图标全站统一**，不止工坊。
5. **图片预览 = FileBrowser 右侧预览区 + 点击灯箱放大。**

## 2. 服务端

### 2.1 创作口径外置（`prompt.ts`）

现状：`# 演出准则`（[prompt.ts:145-156](../../apps/server/src/prompt.ts#L145)）是 10 条硬编码，注入位置在 DSL 格式规范之后、模板末尾——KV cache 友好但用户碰不到。`# 剧艺守则（craft）`（:77）已经是外置的自由文本，但命名与定位都偏窄。

改法：把 10 条按「引擎契约 / 创作口径」拆开。

```
# 演出契约（内置，用户不可改）
1. 指令先于台词…2. 表情差分同步…5. 信任【状态】区…6. 【玩家表态】/【导演注】语义…8. 未作回应不编造…

# 创作口径（可改，来自 memory/always/craft.md）
3. 一拍 3~8 行…4. 展示而非陈述…7. 表态简短时保持推进…9. 好感度通过演出体现…10. 不出现引擎状态语…
（+ 用户在 craft.md 里追加的自由段）
```

- `DEFAULT_CRAFT`：上面 5 条的默认正文，常量随 `craft.md` 语义一起收归「创作口径」。
- 取值：`memory.craft.trim() || DEFAULT_CRAFT`——文件缺失/为空时回退默认，用户不会因为误删就丢掉全部口径（既有 `craftSection` 就是这个 `||` 结构，零额外分支）。
- `buildWorkshopPrompt` 的工坊侧提示词同步改名与说明：告诉搭台 agent `craft.md` 就是「创作口径，你可以改」。
- **A 区变更即 Agent 重建**（`AgentState.systemPrompt` 是只读 getter）——已有的 `playhouse.reload` 路径承担，见 2.2。

### 2.2 runtime 重建保留对话尾（`orchestrator.ts` / `playhouse.ts`）

**问题**：`reloadAfterWorkshopWrite` 重建 runtime 时对话体整个丢弃。用户反复调创作口径 = 每存一次就失忆一次，这是 2.1 的直接代价，不解决会让新功能本身没法用。

**改法**（复用纪元压缩那套已验证的机制，不发明第二套）：

- `Orchestrator` 新增 `carryOver(): { messages; note } | undefined`——`measureContext` + `pickCutIndex` 取最近一段（落点仍在 `user` 消息上），复用 `withSeed` 装一条「剧目设定已更新，按新口径继续」的 seed。
- `OrchestratorOptions.seed?`，构造函数 `buildAgent(seed ? withSeed(...) : [])`。
- `playhouse.buildRuntime(playId, saveId, seed?)` 透传；`reloadAfterWorkshopWrite` 与 `reload` 都从旧实例取 carryover。

效果：改创作口径 = 换 A 区 + 保留最近若干拍的对话，历史细节靠 `search_archive` 检索回来（本来就有）。

### 2.3 创作口径 API（`http.ts`）

`GET/PUT /api/plays/:id/craft`：

- `GET` → `{ content, isDefault }`（文件缺失/空则 `content = DEFAULT_CRAFT`、`isDefault = true`）
- `PUT` → 走 `runtime.workshop.writeFile("memory/always/craft.md", body)`，复用既有的白名单 + reload 链路，**不新增写入路径**

单独开一路而不是让前端拼通用文件 API：创作口径是一等公民，UI 要「恢复默认」，得知道默认长什么样。

### 2.4 `PlayFile` 二进制感知（`playFiles.ts` / `api.ts`）

现状：`list()` 对 `assets/` 前缀一律放行，图片条目混进文件树；点开走 `readFile(abs, "utf8")` 把乱码灌进 textarea（[playFiles.ts:116](../../apps/server/src/playFiles.ts#L116)）。

- `PlayFile` 增 `binary: boolean`（按 `MIME` 表的扩展名判定），`api.ts` 同步。
- `read()` 遇二进制路径直接抛错（"这是图片，用预览看"），不再返回乱码。
- 静态路由已就绪（`/plays/:id/assets/**`，[http.ts:90](../../apps/server/src/http.ts#L90)），**预览不需要新增任何后端路由**。

## 3. Web 端

### 3.1 图标化

- `pnpm --filter @stage-ai/web add lucide-react`（tree-shake，装一次进 lockfile，之后离线可构建）。
- 新建 `apps/web/src/ui/Icon.tsx`：统一 `<Icon name size />`，`stroke-width` 跟随 `currentColor`，尺寸走 CSS 变量而不是像素硬写。
- 替换范围（~30 处，符号→图标语义对照见 workshop-ui.research.md 第 2 节）：工坊面板/文件浏览器、StageTheater、StopPanel、LineagePanel、RouteCanvas、AssetsView、SavesView、SettingsScreen、LibraryView、TitleView、WorkshopScreen。
- **同步调 `.small-btn` / `.tiny-btn` 的 padding**：现在靠字符宽度撑着，换成 SVG 后按钮会塌。
- 服务端 `renderReadiness()` 的 `✗` 是测试断言（`workshop.test.ts:128`），**不动**。

### 3.2 图片预览（FileBrowser）

- 选中 `binary` 文件 → 不进 textarea，右侧渲染 `.file-preview`：自适应缩放 + 尺寸/体积 + 原图路径。
- 点击 → `.image-lightbox` 灯箱（Esc / 点击空白关闭），全屏查看。
- 文件树里图片条目加小图标区分，音频类（`sfx`/`bgm`）给个播放按钮——白名单里它们也是二进制，同一个坑。
- 素材 tab 的立绘差分映射也复用同一套预览。

### 3.3 工坊四 tab

| tab | 内容 | 来源 |
|---|---|---|
| 对话 | 现 chat 视图 | `WorkshopPanel` 现有 |
| 文件 | 现文件树 + 编辑器 + 图片预览 | `FileBrowser` 扩 |
| 素材 | 剧目配置（premise/角色卡/主角卡/音色/试听）+ 素材上传删除 + 就绪门 | `AssetsView` 拆成 `workshop/AssetsPanel.tsx` |
| 创作口径 | 一个大 textarea + 保存 + 恢复默认 + 「下一拍生效」提示 | 新增 |

- `AssetsView` 组件体搬进 `AssetsPanel`（props: `playId`），`WorkshopScreen` 传 `initialTab`，`TitleView` 的「素材与配置」按钮改指工坊。
- `App.tsx` 删 `assets` 路由。
- 抽屉宽度 `min(460px,100vw)` 对素材 tab 太窄：素材 tab 在抽屉形态下给一个「展开全屏」提示，够用就留，不为此改布局。
- 提示词侧工坊每轮现取文件清单（`WorkshopSession.systemPrompt()`），`craft.md` 本来就在清单里 → **工坊 agent 无需新工具即可改创作口径**。

## 4. 测试

| 用例 | 位置 |
|---|---|
| 创作口径回退默认 / 自定义注入 A 区 | `test/workshop.test.ts` 或新 `test/prompt.test.ts` |
| `GET /api/plays/:id/craft` 缺文件回退默认 | `test/http.test.ts`（如有）或 `test/playfiles.test.ts` |
| carryover：重建后 tail 消息仍在、切点落 user 消息 | `test/orchestrator.test.ts` |
| `PlayFile.binary` 判定 + 二进制 read 抛错 | `test/playfiles.test.ts` |
| 现有 `workshop.test.ts` 的 `✗` 断言保持绿 | 回归线 |

不跑真实 LLM/生图/TTS。

## 5. 风险

| 风险 | 处置 |
|---|---|
| 改创作口径仍在拍边界重建 runtime | 2.2 的 carryover 保住对话尾；UI 明写「下一拍生效」 |
| craft.md 被清空 | 回退 `DEFAULT_CRAFT` |
| lucide 装不上（网络） | 退路：`ui/Icon.tsx` 内联 path 兜底，接口形状不变 |
| 抽屉 460px 放不下素材表单 | 素材 tab 给全屏提示，不改全局布局 |
| 删 `/assets` 路由 | 无迁移需求（项目未上线）；旧 hash 落回 TitleView |

## 6. 文档

- README 补：创作口径是什么/在哪改/工坊 agent 也能改；工坊四 tab 是什么。
- `AGENTS.md` 工坊铁律补第 ⑤ 条：创作口径 = `memory/always/craft.md`，A 区变更走 reload + carryover。
