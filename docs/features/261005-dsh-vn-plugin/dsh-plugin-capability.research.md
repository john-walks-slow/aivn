# DSH 客户端插件 UI 能力面调研（对话页贡献 UI / 可切换整屏视图）

> 目的：弄清「一个 DSH 客户端插件能怎样在对话页（chat page）里贡献 UI、能否新增一个整页 / 整栏 / 可切换的整屏自定义渲染视图」。
>
> 证据基准（本次实测的安装实例）：
>
> - 安装包根：`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（下文中「包名/文件:行」均相对此目录）
> - 插件开发技能：`dsh-agent-preset/skills/cordis-plugin-development/`
> - 本机真实插件：`/root/projects/dsh-live-mode`、`/root/projects/dsh-proactive`、`/root/projects/dsh-notify` 等
> - 时间：2026-10-05

---

## 0. 结论速览（TL;DR）

| 问题 | 结论 | 关键证据 |
|---|---|---|
| 客户端插件能否在对话页加 UI？ | 能。机制是**槽位（slot）注册**：`ctx.slots.inject(key, () => ctx.slots.register({...}, Component))` | `dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:36`；模板 `templates/decoration/client.js:16-18` |
| 能否加一个**可切换的整屏自定义视图（对话主区）**？ | **能，且这是官方一等公民能力。** 往 `conversation.view`（`list` / session 作用域）注册一条，就在会话头部出现一个 **tab**，选中时整块主区（滚动视口）渲染你的组件 | 契约 `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:183-188`；渲染点 `dsh-client-ui-conversation/lib/client.js:16338-16343`；tab 表 `dsh-client-ui-conversation/lib/client.js:17897-17905` |
| 有没有现成先例？ | 有 4 个：内置 `chat`（order 0）、内置 `trajectory`（order 10）、本机 `dsh-proactive`（order 20）、本机 `dsh-live-mode`（Live2D 整屏视图，order 10） | `dsh-client-ui-chat/lib/client.js:12303-12309`；`dsh-client-ui-trajectory/lib/client.js:8736-8742`；`/root/projects/dsh-proactive/packages/dsh-proactive/src/client/index.ts:95-105`；`/root/projects/dsh-live-mode/src/client/index.ts:36-47` |
| 能否加一个**整页**（左侧栏出现一个新图标，切走整个中栏）？ | 能。`main`（`keyed` / root 作用域，key = 面板 id）+ `sidebar.panellist`（`list` / root，同 id）成对注册 | `dsh-client-ui-layout/lib/types/client/index.d.ts:53-56`；`dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:42-50`；先例 `dsh-client-ui-plugin-manager/lib/client.js:3435-3440,3485-3491`，`dsh-client-ui-schedule/lib/client.js:6794,6804` |
| 能否**替换/覆盖**既有区域？ | 部分能：`single` / `keyed` / `list` 三类都支持**优先级遮蔽**（priority 越小越优先渲染；同 cell 同 priority 会抛错）。`chain` 是选举制、不遮蔽 | `dsh-client-ui-slots/lib/index.js:167-183,221`；`dsh-client-ui-slots/lib/types/index.d.ts:823-834`；`dsh-client-ui-renderer/lib/types/client/registry.d.ts:18-37` |
| 视图能否被插件**程序化切换**？ | 不能直接切。`ctx.conversation` 没有选视图的方法；公开手段只有 slot owner props 里的 `openView(view, focus)`、header 的 `selectView`，或 `ctx.layout.selectPanel(id)`（那是 main 面板，不是会话视图） | `dsh-client-ui-conversation/lib/types/client/service.d.ts:26-56`（无 openView）；`.../contract/slots.d.ts:383-393`；`dsh-client-ui-layout/lib/types/client/service.d.ts:24-32` |
| 客户端插件标准产物形态 | `package.json` 声明 `dsh.bundle.patch` + `dsh.client{platform:'web', immediately?, inject?, external?}` + `exports["./client"]`；客户端 bundle 必须是 `window.__ModuleLoader__.load({id, factory})` 包装的 lazy-CJS | `templates/decoration/package.json:6-14`；`dsh-client-modules/lib/index.js:170-180`；`dsh-client-modules/README.md`（Lazy-CJS 模型段） |

**一句话**：对话页加「可切换的整屏自定义渲染视图」是这个框架的正规扩展点，成本极低（一个 `conversation.view` 注册），本机已有 Live2D 这样的重型先例；限制只在「无法从插件侧程序化切 tab」和一个「视图 tab 栏只在 ≥2 个视图时显示」的 UI 规则。

---

## 1. 客户端插件的标准写法

### 1.1 技能文档给的标准路径

`dsh-agent-preset/skills/cordis-plugin-development/SKILL.md` 规定的流程（`:8-30`）：

1. 用工作区文件写一个 **bundle**（包），再用 `plugin_manager` 的 `action: install_bundle` 安装到当前 profile；改动对 profile 下所有会话生效并跨重启存活（`SKILL.md:8`）。
2. 不要手写 profile 的 `package.json` / `cordis.patch.yml`，不要在 `$DSH_HOME` 下建包，不要在 profile 目录跑 pnpm（`SKILL.md:10`）。
3. UI 类需求先 `cordis_inspect_query` 查 **Client `Slots.listSubTree`** 和目标 slot 的注册选项与 props（`SKILL.md:19,26`）。
4. 未知的可视化目的地 = 当前 Harness Web UI；**不允许**用独立 HTML / iframe 交差（`SKILL.md:18`、`practices.md:33`）。

### 1.2 最小可运行的客户端插件（官方模板，四文件）

模板目录 `dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/`：

- `package.json:6-14`：`exports["./client"] = "./client.js"`；`dsh.bundle.patch`；`dsh.client = { platform: "web", immediately: true, inject: ["@deepseek-ai/dsh-client-ui-conversation"] }`。
- `cordis.patch.yml:1-3`：YAML patch 只做 `insert` 一行，`id` 与 `name` 都是包名。
- `index.js:1-2`：宿主半边可以是空 `export function apply() {}` —— **纯 UI 插件不需要宿主逻辑**。
- `client.js:1-22`：核心是

  ```js
  window.__ModuleLoader__.load({
    id: '@local/my-decoration',
    factory(require) {
      const React = require('react');
      return { inject: ['slots'], apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'my-decoration', order: 5 }, Decoration));
      }};
    }});
  ```

  即：**bundle 只注册一个 lazy factory**（id = 包名），模块体副作用延迟到首次 materialize（`dsh-client-modules/README.md` Lazy-CJS 段）。

### 1.3 `references/` 里和 UI 直接相关的硬约束

- `references/ui-plugin.md:1-11`：客户端 module lazily 注册 factory；React 来自浏览器 module table，**不要**重复装 React / CDN / UMD；编译型源码要用部署的 Client 构建工具产出这个格式，非 baseline 的运行时 import 写进 `dsh.client.external`。
- `references/ui-plugin.md:11`：改 slot 前先按 `Slots.listSubTree` 看该 slot 的 props 与 options。
- `references/practices.md:31-38`（UI 段）：
  - `:33` **不要**用宿主 HTML + iframe —— iframe 拿不到主题 token、明暗切换和 `ctx.locale`。
  - `:34` 只用 `Theme` 列出的 `--dsw-alias-*` token 上色；字面色只用于 artwork；间距/字号/行模式抄同类宿主页面（管理列表以 Plugin Manager 页为参考）。
  - `:35` **不要** `require('@deepseek-ai/dsh-client-ui-primitives')` 或任何其他 Harness Client 包当模块用（`dsh.client.inject` 只排激活顺序）。组件抛异常会 `slot entry crashed in '<slot>'` 并让该槽位空白。
  - `:36` **统一通过槽位贡献**：`ctx.slots.inject(ownerKey, () => ctx.slots.register(...))`；注册随 owner declaration 折叠而注销、恢复而重装。数据通过 slot props 的 selector hooks 读取，**不要**在组件外写 DOM / 往 `document.body` 追加。
  - `:37` 加一条 Chat 行：`ctx.uiConversation.events.register()` 注册 event definition，再把视图注册到 `conversation.chat.node` 槽、key 用 definition 的 `kind`（= renderer key）。
  - `:38` 客户端需要「派生自 session 的值」时，在宿主 projection 上声明 `wire.view`，值算好后下发（客户端不自己 fold session events）。
- `references/verification.md:3`：没有浏览器控制权时，验证只能到「JS 语法 + manifest 校验 + live Client slot 存在」，必须显式声明「视觉效果未验证」；**不许**为了截图去找光栅化器/模拟 React/做 mock 页。

---

## 2. `dsh-client-ui-slots`：槽位注册 API 的完整形状

### 2.1 四种 kind 与三种 scope

- `SlotKind = 'single' | 'list' | 'keyed' | 'chain'`（`dsh-client-ui-slots/lib/types/index.d.ts:83`）
- `SlotScope = 'root' | 'session-maybe' | 'session'`（同文件 `:85`）
- `SlotMap` 在本包里是**空接口**，由各 UI 包 `declare module` 合并（本包 README「Declaration discipline」段）。本次实测合并出 **89 个**槽位（见 §2.4）。

### 2.2 注册签名

`dsh-client-ui-slots/lib/types/index.d.ts`：

- `BaseOptions`（`:597-613`）：`{ name, children?, store?, locale?, registrant? }`。
- `KindOptions`（`:560-583`）按 kind 分派：
  - `keyed` → `{ key, priority? }`
  - `list` → `{ id, order?, label?, priority? }`（`label` 可传字符串或 thunk，随语言变化：`SlotLabel` 定义在 `:555`，读取用 `resolveSlotLabel` `:648`）
  - `chain` → `{ select, priority? }`
  - `single` → `{ priority? }`
- 两个 `register` 重载（`:789-791` 无 inject / `:802-804` 带 inject 工厂）；inject 工厂的参数由声明决定：session 槽拿到 `sessionId`，session-maybe 拿到 `sessionId | undefined`，带 `store` 时追加 `actions`（`InjectParams` `:483`）。**返回 disposer**。
- 组件拿到「五份 props」：runtime（owner + scope 标准 kit）/ 子槽渲染权 `renderSlot` / `renderFactorySlot` / store 钩子 / inject 业务面（本包 README「The five framework props shares」段）。

### 2.3 遮蔽（能否替换既有区域）

- 注册实现：`dsh-client-ui-slots/lib/index.js:167` `const priority = options.priority ?? 0;`
  - `:171` single 同 cell 同 priority → 抛错，报错文案明确写 **"register at a different priority to shadow it (lowest renders)"**
  - `:177` keyed：同 `key` + 同 priority → 抛错
  - `:183` list：同 `id` + 同 priority → 抛错
  - `:221` 排序：list 按 `priority` 升序、再按 `order` 升序；其他 kind 按 `priority` 升序
- 渲染选择：`entriesOfSlot` —— single 一个 cell；keyed 每 key 一个 cell；list 每 `id` 一个 cell；**chain 返回原始 entries，不遮蔽**（`dsh-client-ui-slots/lib/types/index.d.ts:823-834`）。
- 官方对 `root` 槽位的警告文案（`dsh-client-ui-renderer/lib/types/client/registry.d.ts:18-37`）：
  > "…a second entry does not sit beside the frame — it shadows it, and a dynamically registered entry is assigned a lower priority than the shipped one, which makes it the winner: the page would render your component alone, with every seat the frame declares gone. For a surface of your own that floats over the whole app, register into `shell.overlay` instead."

  ⚠️ 注意：这段注释声称「动态注册的条目自动获得比内置条目更低的 priority」（因而胜出），但代码里 `priority ?? 0` 对两边一视同仁，同 cell 同 priority 直接抛错。**要覆盖既有条目，请显式传更小的 `priority`（如 `-1`）**，不要依赖注释里的自动降级说法。
- `keyed` 槽位的占位者可以通过同 key 覆盖：例如 `main` 的保留 key `conversation` 由 `dsh-client-ui-conversation` 注册（`dsh-client-ui-conversation/lib/client.js:18358-18366`，未显式给 priority）。

### 2.4 实测槽位全表（89 个，从各包 `lib/types/**/*.d.ts` 的 `SlotMap` 合并块抽取）

格式：`槽位名 — kind / scope — 声明包`

**应用骨架（layout）**

| 槽位 | kind/scope | 说明 |
|---|---|---|
| `root` | single/root | 唯一由 shell `renderSlot('root')` 渲染；被 ui-layout 的 AppFrame 占据，**不要注册**（见上） |
| `sidebar` | single/root | 整条左栏；被 ui-sidebar 占据，注册即替换 |
| `main` | keyed/root | 中栏面板，**key = 面板 id**；保留 key `conversation` |
| `rightbar` | single/root | 整条右栏；被右侧栏占据 |
| `shell.overlay` | list/root | 全应用浮层，click-through，最安全的「自带表面」 |
| `shell.leading` | single/root | 窗口左上角 chrome 位（侧栏全隐藏时） |

**侧栏（sidebar）**

`sidebar.toggle.badge`(single/root)、`sidebar.brand.mark`(single/root)、`sidebar.brand.name`(single/root)、`sidebar.panellist`(list/root)、`sidebar.workspaces`(single/root)、`sidebar.settings`(single/root)、`sidebar.footer.action`(list/root)、`sidebar.workspaces.directoryFlow`(single/root)、`sidebar.session.row.leading`(list/root)、`sidebar.session.row.hover`(list/root)、`sidebar.workspaces.session.row.action`(list/root)、`sidebar.workspaces.session.menu.item`(list/root)、`sidebar.chat.conversation`(single/session)

**对话（conversation）**

| 槽位 | kind/scope |
|---|---|
| `main.conversation` | single/session-maybe |
| `conversation.header` | single/session-maybe |
| `conversation.header.leading` | single/root |
| `conversation.session` | single/session |
| `conversation.session.header` | single/session |
| `conversation.session.header.lineage` | single/session |
| `conversation.session.header.actions` | list/session |
| `conversation.session.header.utilities` | list/session |
| `conversation.session.header.corner` | single/session |
| **`conversation.view`** | **list/session** ← 整屏视图 tab |
| `conversation.composer` | chain/session（唯一带 `overlay` 语义的 chain，可临时接管 composer） |
| `conversation.composer.bar` | single/session-maybe |
| `conversation.composer.dock` | list/session |
| `conversation.input.dock` | list/session |
| `conversation.input.overlay` | list/session |
| `conversation.input.left` | list/session |
| `conversation.input.right` | list/session |
| `conversation.input.activity` | single/session |
| `conversation.input.attachments` | single/session-maybe |
| `conversation.input.plan` | single/session |
| `conversation.input.permission` | single/session |
| `conversation.input.model` | single/session |
| `conversation.hero.workspace` | single/root |
| `conversation.hero.workspace.directoryFlow` | single/root |
| `conversation.hero.brand.mark` | single/root |
| `conversation.hero.agentPreset` | single/session-maybe |
| `conversation.plan-review.actions` | list/session |
| `conversation.approval.detail` | single/session |

**Chat 渲染（chat / tool / trajectory / deliverables）**

`conversation.chat.node`(keyed/session，**key = ChatNodeKind，复用 key 即替换该行渲染器**)、`conversation.chat.commandview`(keyed/session)、`conversation.chat.turnTail`(list/session)、`conversation.chat.assistant-actions`(list/session)、`conversation.message.images`(single/session)、`conversation.trajectory.images`(single/session)、`tool.call.toolview`(keyed/session)、`tool.call.images`(single/session)、`tool.view.cordis`(keyed/session)、`deliverables.file.actions`(list/session)、`deliverables.review.file.actions`(list/session)、`shell.quota-notice`(chain/root)

**右侧栏（sidebar-right / 文档预览）**

`rightbar.session`(single/session)、`sidebar.right.pane.tab`(keyed/session)、`sidebar.right.pane.tab.title`(keyed/session)、`sidebar.right.tab.guide`(chain/session)、`sidebar.right.tab.guide.entry`(keyed/session)、`sidebar.right.tab.menu.item`(list/session)、`sidebar.right.tab.document`(keyed/session)、`sidebar.right.tab.document.action`(keyed/session)、`sidebar.right.tab.document.actions`(list/session)、`sidebar.right.tab.document.office.pdf`(keyed/session)、`sidebar.right.tab.document.unpreviewable`(list/session)

**设置（settings）**

`settings.trigger`(single/root)、`settings.launcher`(single/root)、`settings.header`(single/root)、`settings.close`(single/root)、`settings.action`(list/root)、`settings.section`(list/root)、`settings.general.item`(list/root)、`settings.onboarding`(list/root)、`settings.plugins.tab`(list/root)

**插件管理（plugin-manager）**

`plugins.item`(list/root)、`plugins.detail.section`(list/root)、`plugins.detail.actions`(list/root)、`plugins.detail.badge`(list/root)、`plugins.bundle.activation`(keyed/root)、`plugins.bundle.config`(keyed/root)、`plugins.row.config`(keyed/root)

**模型设置**：`settings.models.footer`(list/root)、`settings.models.provider-card`(keyed/root)、`settings.models.sign-in`(single/root)

> 另有 `SlotFactoryMap`（可复用 Component Factory），当前只有一条：`conversation.content`（`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:280-327`）。

### 2.5 `ctx.slots` 服务面（除 register 外）

`dsh-client-ui-renderer/lib/types/client/registry.d.ts`：

- `inject(key, callback)`（`:111`）：**按 declaration 生命周期**安装 effect —— 槽位已声明则同步执行；未声明则等声明提交后执行；折叠则注销、再声明则重跑。这是插件注册 UI 的**标准入口**（解决插件加载早于父槽位声明的竞态）。
- `install(renderer)` `:118`、`installLocale(face)` `:126`、`provideRoot(...)` `:133`、`installScope(...)` `:140` —— 都是 shell 级基础设施，业务插件不用。
- 只读观察：`entries(key)`、`entriesOfSlot(key)`、`spec/specDynamic`、`snapshot(root)`、`declarationEpoch`、`subscribe`、`subscribeDeclaration`、`getVersion`、`onMutate`（`dsh-client-ui-slots/lib/types/index.d.ts:812-897`）。

---

## 3. `dsh-client-ui-conversation`：对话主区如何渲染、view-registry 是什么

### 3.1 组件与职责链

- `ConversationPanel`（`lib/types/client/skeleton/ConversationPanel.d.ts:1-8`）：root 级 `main` 槽 occupant，绑定 Session 的区域在它的子级。
- `ConversationRoot` → `ConversationMainPanel`（`ConversationMainPanel.d.ts:1-7`）→ `ConversationContent`（Factory 体，:1-7）→ `ConversationSession`（:7-19）→ `DefaultConversationViews`（`DefaultConversationViews.d.ts:1-8`，返回「active view area」）。
- 主区渲染点（实测 bundle）：
  ```
  dsh-client-ui-conversation/lib/client.js:16338-16343
    const viewId = view ?? active?.id;
    return <div className={viewArea}>
      { viewId !== undefined && renderSlot("conversation.view",
          { inspectCall, viewRequest, openView, completeViewRequest },
          { only: viewId }) }
    </div>;
  ```
  → **一次只渲染一个 `conversation.view` 条目，占满整个滚动视口**。
- tab 表就是槽位条目表：
  ```
  dsh-client-ui-conversation/lib/client.js:17897-17905
    for (const entry of slots.entries("conversation.view")) {
      if (entry.options.id === undefined) continue;
      if (!developerTools.enabled && entry.options.id === "trajectory") continue;  // 硬编码仅隐藏 trajectory
      tabs.push({ id: entry.options.id, label: resolveSlotLabel(entry.options.label) ?? entry.options.id });
    }
  ```
  并以 `slots.subscribe("conversation.view", refreshViews)`（`:17936`）增量刷新 roster。
- `conversation.view` 槽位声明：`contract/slots.d.ts:183-188`（list / session），owner props `ConvViewOwnerProps`（`:383-393`）：`inspectCall`、`viewRequest`、`openView(view, focus)`、`completeViewRequest`。
- 每个视图还拿到 session 标准 kit：`useConversation`、`useInput`、`inputActions`（`contract/slots.d.ts:332-347`）。

### 3.2 view-registry 是什么（和「tab」不是一回事）

`lib/types/client/conversation/view-registry.d.ts:1-11` 的 `ConversationViewRegistry` 注册的是 **`ConversationViewDefinition`**（`contract/conversation.d.ts:250-266`）：每个 target 一个 **per-Session 增量 snapshot builder**（`create(): ConversationViewBuilder`，`replace/apply`，可选 `toolCallFocus`/`isActive`）。

- 它是**数据管道**，不是 UI：把 session 事件流 fold 成某个 target 的只读快照（`ConversationViewSnapshotMap`，`contract/conversation.d.ts:116-129`）。
- 对外开放：`ctx.uiConversation.views.register(def)`（`conversation/assembly.d.ts:37-44`）。
- 与 tab 的关系：**松耦合**。`conversation.view` 槽位条目决定「有没有这个 tab、tab 画什么」；`views.register` 决定「这个 target 的数据快照从哪来」。Trajectory 两条都注册（`dsh-client-ui-trajectory/lib/client.js:8731,8736`）；本机 Live2D 视图**只注册了 tab、没有注册 target**，照样工作（`/root/projects/dsh-live-mode/src/client/index.ts:36-47`，该包 client 源码无 `uiConversation` 引用）。
- 相关注册表：`ctx.uiConversation.events`（`ConversationEventRegistry`，`event-registry.d.ts:1-23`，可注册 fallback）、`ctx.uiConversation.groups`（`group-registry.d.ts:1-29`，group 注册要求 target 已存在）、`ctx.uiConversation.binding(sessionId)`（`assembly.d.ts:46-60`）、`ctx.uiConversation.imageUrl(...)`（`:66`）。

### 3.3 「视图选择」的语义与限制

- 持久化状态：`ConversationStoreState` = `{ draft, view: string | null, viewRequest }`（`contract/views.d.ts:17-25`）——**per-session**，`view` 是首选视图 id。
- 选择算法（README `:65`）："a registered persisted selection wins, otherwise registered `chat` wins, otherwise no View renders. It never chooses the first registered View."
- tab 栏显示规则（README `:51,63`）：**少于 2 个视图时隐藏 tab 栏**；空白 Session 连 `conversation.view` 槽都不声明（README `:67`）。
- 插件侧无法程序化切换：`ctx.conversation`（`service.d.ts:26-56`）只有 `send/updateQueue/cancel/loadOlder/input/blocks`，**没有 selectView**。可用的公开入口：
  - 视图组件自己的 owner prop `openView(view, focus)`（切到**别的**视图）；
  - `conversation.session` 注册的 inject face `openView`（package-private，只有声明该槽位的包能拿）；
  - `conversation.session.header` 的 `selectView`（同上，package-private）；
  - `ctx.layout.selectPanel(id)`（那是 main 面板，不切会话视图）。
  - 本机 `dsh-live-mode` 的绕法：把「进入 Live 模式」按钮放在 `conversation.input.right`，然后 **DOM 查 `[role="tab"]` 匹配文本并 `.click()`**（`/root/projects/dsh-live-mode/lib/client.js` 中 `Vl()/wL()/yw()`；源码 `src/client/live-button.tsx`）。这是 workaround，不建议在新插件里复制。

---

## 4. 各包职责与「session 数据 → React 组件」的流向

| 包 | 职责（一句话） | 关键类型证据 |
|---|---|---|
| `dsh-client-ui-slots` | React-free 的槽位注册内核（声明=渲染授权=运行时 spec）、Factory、store seat、renderer 安装契约 | `lib/types/index.d.ts:96-118`、`renderer.d.ts:244-252` |
| `dsh-client-ui-renderer` | **唯一**把 ctx 接到 React 的地方：实现 `SlotRenderer`，`mount(container)` 挂载整个应用，做唯一的 `renderSlot('root')`；把 runtime 的裸 observable 绑成 selector hooks | `lib/types/client/registry.d.ts:18-37`、README「What mounting does」 |
| `dsh-client-ui-layout` | 提供 `ctx.layout`（面板选择 + 几何），声明 `sidebar`/`main`/`rightbar`/`shell.overlay`/`shell.leading`，投影主题到 `document.body` | `lib/types/client/index.d.ts:33-106`、`service.d.ts:14-50` |
| `dsh-client-ui-session` | Session Controller 的 React/Slot 适配：`useSessions`/`useSession`、`SessionProvider`、per-binding 标准 props、pending interaction 与未读完成策略 | `lib/types/client/index.d.ts:1-70`、README Summary |
| `dsh-client-ui-conversation` | target-neutral 的会话装配与浏览器外壳：`events`/`views`/`groups` 注册表、`binding()`、输入状态机、composer、以及 §3 的槽位与 tab 渲染 | `conversation/assembly.d.ts:37-60`、`contract/slots.d.ts:119-348` |
| `dsh-client-ui-chat` | Chat **target**：注册 `conversation.view`(`id:'chat'`) + Chat Definition/Node 渲染器 + store + 统计/详情 | `lib/client.js:12303-12321`、`contract/slots.d.ts:186-217` |

数据流（以 Chat 为例）：

1. `dsh-api-session-controller`（`ctx.sessions`）从 Host 拉 `SessionEventLikeEntry` 流（durable + client-only transient），向 React 暴露 `SessionBinding`（object layer，React-free）。证据：`dsh-client-ui-conversation/README.md`「Conversation assembly」段。
2. `dsh-client-ui-conversation` 的 assembler 把事件喂给每个已注册 Definition 的 `match/start/update`，同时解析 Turn/Step `ConversationLocation`，再让 `buildViewNode()` 产出 target-owned Node，交给该 target 的 `ConversationViewBuilder.replace/apply` 做增量 fold。证据：`contract/conversation.d.ts:163-266`。
3. 结果按 `ConversationViewSnapshotMap` 合并键发布为**引用稳定的 observable 快照**；`binding.target(targetId)` 读它（`assembly.d.ts:46-60`）。增量性由「`apply` 对无关事件返回同一引用 → 零下游工作」保证（`dsh-client-ui-slots`/practices.md:26-27）。
4. 视图组件通过 session 标准 kit 的 selector hook 读数据：`useChat`（`dsh-client-ui-chat/lib/types/client/contract/slots.d.ts:16`）、`useTrajectory`（`dsh-client-ui-trajectory/lib/types/client/trajectory-contract.d.ts:66`）、`useConversation`/`useInput`/`inputActions`（conversation `contract/slots.d.ts:332-339`）。组件不自己订阅、不自己写 DOM（`practices.md:9,36`）。
5. Chat 的每条记录再走 `conversation.chat.node` **keyed** 槽渲染，key = `ChatNodeKind`（`dsh-client-ui-chat/lib/types/client/contract/chat-nodes.d.ts:13`）；「Reusing a key replaces that node renderer; a kind with no occupant renders no row.」（`contract/slots.d.ts:232-245`）。
6. **跨宿主-客户端**的值：宿主侧 `ctx.sessionProjections` 声明 `wire.view`，值算好经 wire 下发；客户端不 fold 事件（`practices.md:38`；`dsh-session-projection/lib/types/index.d.ts:57-68`）。

---

## 5. 先例：自定义标签页 / 整页 / 整栏

### 5.1 可切换整屏视图（`conversation.view`）——四个先例

| 来源 | 注册代码 | id / order / label |
|---|---|---|
| 内置 Chat | `dsh-client-ui-chat/lib/client.js:12303-12321` | `chat` / `0` / `t("view.chat")`；声明子槽 `conversation.chat.node`(keyed)、`conversation.message.images`(single)，带 `store: chatStore` |
| 内置 Trajectory | `dsh-client-ui-trajectory/lib/client.js:8736-8746` | `trajectory` / `10` / `() => t("view.trajectory")`；带 `children: {conversation.trajectory.images}` 与 `inject(sessionId)` 业务面；注释明确「register the trajectory view tab」（`lib/types/client/index.d.ts:11-15`） |
| 本机 dsh-proactive | `/root/projects/dsh-proactive/packages/dsh-proactive/src/client/index.ts:95-105`（文件头注释 `:6-7` 写明「conversation.view tab …alongside Chat / Trajectory」） | `proactive` / `20` / `() => t("tabLabel")` |
| 本机 dsh-live-mode（Live2D 整屏） | `/root/projects/dsh-live-mode/src/client/index.ts:36-47`；组件 `src/client/view.tsx`（顶部注释：「The Live2D conversation view (conversation.view slot entry)」） | `live2d` / `10` / 字面量 `"Live2D"` |

> 结论：**「对话页加一个可切换的整屏自定义渲染视图」有 4 个可直接抄的样本，其中 2 个是纯第三方插件（不需要任何宿主改动、不需要注册数据 target）。**

### 5.2 整页（左侧栏图标 + 整个中栏）

成对注册：

- `main`（keyed/root，key = 面板 id）：`dsh-client-ui-plugin-manager/lib/client.js:3435-3440`（`name:"main", key: PANEL_ID`），`dsh-client-ui-schedule/lib/client.js:6794`。
- `sidebar.panellist`（list/root，`id` 必须等于 main key）：`dsh-client-ui-plugin-manager/lib/client.js:3485-3491`，`dsh-client-ui-schedule/lib/client.js:6804`。
- 契约：`SidebarPanelMetadata { id: MainPanelId; order; label }` —— 注释写明 **"List id and matching main panel key"**（`dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:100-108`），owner props 是 `{ size, active }`（`:94-99`）。
- 程序化切换：`ctx.layout.selectPanel(panelId | null)`（`dsh-client-ui-layout/lib/types/client/service.d.ts:24-32`；`null` = 回到 Conversation；未注册的 key 抛错）。挂载位置由 `usePanelInfo` 驱动（同文件 `:17-20`）。
- 运行时无关性：`main` 是 keyed/root，**不绑定 Session**；只有保留 key `conversation` 才拿到 Session 绑定（`dsh-client-ui-layout/lib/types/client/index.d.ts:49-56`）。

### 5.3 整栏 / 其它形态

- **整条左栏**：`sidebar`（single/root，已被 ui-sidebar 占据，注册即替换整条导航栏并连带其子槽消失 —— 见 `dsh-client-ui-layout/lib/types/client/index.d.ts:34-48` 的警告）。想加东西应注册进它的子槽（`sidebar.workspaces` / `sidebar.settings` / `sidebar.footer.action` / `sidebar.panellist`）。
- **整条右栏**：`rightbar`（single/root，被 ui-sidebar-right 占据）；想加「右栏里的一个 tab 类型」应走 `ctx.sidebarRightTabs` 注册 tab type，标签体画在 `sidebar.right.pane.tab`（keyed，key = type 定义 id），标题在 `sidebar.right.pane.tab.title`（`dsh-client-ui-sidebar-right/lib/types/client/contract/slots.d.ts:1-20,60-110`）。README 明说：「adding a type is a registration, never an edit here. The key domain stays the open string space because a tab type may ship from outside this repository.」
- **全应用浮层**：`shell.overlay`（list/root，click-through）——本机 `dsh-notify/src/client.ts:47-49`、`dsh-hybrid-notify/src/client.ts:48-49` 的 toast 容器。
- **会话头部控件**：`conversation.session.header.actions|utilities|corner`（list/single，session）。
- **composer 接管**：`conversation.composer` 是唯一带 `overlay` 语义的 chain —— 选举失败时 owner fallback 保持挂载（`display:none`），用户草稿不丢（`dsh-client-ui-slots/lib/types/index.d.ts:232-245`）。

---

## 6. 主题 token

- 服务：`ctx.theme`（`ThemeRuntime`），发布不可变 `ThemeSnapshot { preference, fontSize, active{id,colorScheme,tokens}, themes, revision }`；`ui-layout` 的 presenter 把快照写到 `document.body`（`dsh-client-ui-theme/lib/types/client/index.d.ts:1-8,56-80`；README Summary）。
- 第三方主题可 `ctx.theme` 注册 alias-token override（每 token 必须同时给 light/dark：`ThemeTokenModes`，`:40-56`）。
- 插件侧规则：**只用 `--dsw-alias-*`**（`practices.md:34`）。实测本实例存在的 token 前缀包括：
  `--dsw-alias-bg-base|-layer-1/2/3|-overlay|-mask-*`、`--dsw-alias-border-l1..l4`、`--dsw-alias-brand-primary|-text`、`--dsw-alias-button-*`、`--dsw-alias-label-primary|-secondary|-caption|-dimmed|-tertiary`、`--dsw-alias-interactive-bg-*`、`--dsw-alias-state-*`、`--dsw-alias-code-diff-*`、`--dsw-alias-file-diff-*` 等（从 `dsh-client-ui-theme/lib/client.js` 抽取，共 60+）。
  还可见共享的 `--dsw-menu-surface-fill`、`--dsw-specific-menu`、`--dsw-radius-lg`、`--dsw-elevation-panel`、`--dsw-font-*`。
- 取值方式：`cordis_inspect_query` 的 `Theme` 查询会列出 token 与可见性（`SKILL.md:26`）。

---

## 7. 客户端 ↔ 宿主通信

DSH 里没有「客户端插件直接调宿主插件函数」的通道，实际有 4 条：

1. **同一 Cordis 树内的 ctx 服务**（客户端半边）：插件须在 `inject` 数组里声明要用的服务，否则运行时报 "cannot get property X without inject"。常用：`slots`、`sessions`、`layout`、`theme`、`locale`、`conversation`、`uiConversation`、`configForms`。
   - 证据：模板 `templates/decoration/client.js:14`；本机 `dsh-proactive/src/client/index.ts:34` `inject = ["slots","remote","connection","locale"]`；本机 `dsh-live-mode/src/client/index.ts:15` `inject = ["slots","sessions"]`。
   - `ctx.slots.inject` 是「等父槽位声明」的等待式注入（`registry.d.ts:111`、`lib/client.js:1343-1385`）。
   - ⚠️ 不要用 `ctx.get("x", false)` 试探式取服务当作规范做法（`dsh-proactive/src/client/index.ts:71-78` 是容错写法，不是推荐范式）。
2. **`ctx.remote.<namespace>.<method>`**：由 Typert Remote 描述符生成的**类型化宿主 RPC**（`dsh-api-gateway/lib/types/client/index.d.ts:1-45`）。还提供 `ctx.remote.$stream(options)`（独立可取消、可重连的逻辑流，`:20-27`）与 `ctx.remote.$host`（`home` / `isLoopback`，`:29-39`）。所有 Host RPC/WS 都需浏览器会话（launch token → 签名 cookie；`dsh-client-connection/README.md`「Browser authentication and request trust」段）。
3. **宿主注册的精确 HTTP 路由 + SSE**：宿主半边用 `ctx.webServer`（或 `ctx.get("webServer", false)` 容忍 headless）注册精确 GET/POST/SSE，客户端用 `fetch` / `EventSource` 拉。实例：`dsh-proactive/packages/dsh-proactive/src/panel/routes.ts:62-72` + `src/client/host-api.ts:124,149,176,236`（一个 snapshot GET、一个 action POST、一个 SSE）；`dsh-live-mode/src/index.ts`（`installRoutes(ctx, ...)`）+ `src/client/api.ts`。
4. **宿主 projection 的 `wire.view`**：客户端需要的 session 派生值由宿主 projection 算好下发，客户端不 fold session 事件（`references/practices.md:38`；`dsh-session-projection/lib/types/index.d.ts:57-68` 定义 `wire.viewSchema` / `view(state)`）。

> 关于「package-private call」：在 DSH 的类型注释里这个词指**包内可见、不对外导出的内部 API**（如 `dsh-subagent/lib/types/lifecycle.d.ts:8` 的 `ActivationObserver`）。对客户端插件而言，同类现象是 `ComposerBarInjected`（`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:446-477`，注释即「Package-private operations injected into the resident composer bar」）和 `conversation.session` 的 `openView/selectView` —— 只有声明该槽位的包能拿到，第三方插件不能引用。

---

## 8. 客户端 bundle 的构建与加载

### 8.1 声明入口（不在 `cordis.patch.yml` 里）

- `cordis.patch.yml` 只负责**宿主侧 Loader 行**（`- insert: [{id, name, config?}]`），不声明客户端入口。证据：`templates/decoration/cordis.patch.yml:1-3`、`templates/host-plugin.md:20-27`。
- 客户端入口在 `package.json`：
  - `exports["./client"]` → 浏览器 bundle 路径（`dsh-client-modules/lib/index.js:170-180` 明确解析 `exports["./client"]`，接受 string 或一层 conditional 的 string default）；
  - `dsh.bundle.patch` → 宿主补丁文件；
  - `dsh.client = { platform, inject?, immediately?, external? }`（`dsh-package-manifest/lib/types/types.d.ts:76-89`；`platform` 由 Web 消费者选 `web`；`immediately` = 启动第一阶段注册屏障，缺省进共享 application batch；`inject` 只是**信息性包名依赖，不是 Cordis 服务注入**；`external` = 基线之外要走的精确 module-table 请求）。
  - 实测样例：`dsh-client-ui-trajectory/package.json`（`main`/`exports["./client"]`/`dsh.client.inject` 五项，无 `dsh.bundle`——因为它是随 dsh 发行、由内置 bundle patch 引用的包）；`/root/projects/dsh-live-mode/package.json`（`dsh.bundle.patch` + `dsh.client{platform:"web", inject:[...]}` + `exports["./client"]`）。

### 8.2 宿主侧：扫描 → 组合 boot graph → 组合 combo 路由

`dsh-client-modules/README.md`（Use/Understand 段）：

- Node 半边扫 Loader entries 里声明了 `dsh.client` 的包，合成 boot graph（`window.__DSH_BOOT__`，`<` 已转义），由 Web carrier 在 `/plugins` 下服务；每个包快照 `client.js` 后生成 combo 描述符，分组为 `/plugins/??...&rev=...`（各自 ≤3 KiB），**首次 GET 时才拼 body**。
- revision 取自 `mtimeMs/ctimeMs/size`（不哈希内容），因此未改动的产物跨宿主重启保持同一 revision。
- 没有 web server 时 `fetchBundle()` 仍可用（shell-owned carrier）。

### 8.3 浏览器侧：`__ModuleLoader__` + lazy-CJS + combo

- `<head>` 注入序列：`window.__ModuleLoader__` 队列 facade → 每个 application combo 的 advisory preload → parser-blocking 的 bootstrap combo → 再注入 boot graph，供 shell 读取（README「Boot manifest injection」段）。
- **module table**：shell 预置冻结的 `PLATFORM_MODULES`（React、Cordis、静态 UI 库）；动态 bundle 的 external 只在这张基线表 + 自身声明的 `external` 行里解析，否则抛错（README「Sharing modules」段）。
- **lazy-CJS**：执行 bundle 只注册 factory，模块体副作用（含 CSS 注入）在 `factory(require)` 首次 materialize 时执行并 memoize；require 环会抛（`lib/index.js:20-26` 注释、`:466-472`）。
- 失败基线：batch combo 加载失败重试一次；「loaded without registering」不再重放；缺行各自走单资源 combo URL；Web boot audit 按行报告最后一次 import 失败（README「What the browser loads」段；`lib/client.js:625,739` 是这两条报错文案）。
- HMR：变更行切到带 revision 的单资源 combo；启用/停用普通插件跟随宿主 module graph，等异步 effect 收敛后再驱逐模块与样式。
- **手写 bundle 的包装格式**（无构建工具的纯 JS 插件直接写；编译型插件在构建脚本里包）：
  ```
  window.__ModuleLoader__.load({ id: "<package-name>", factory: (require) => { ... return module.exports; } });
  ```
  证据：模板 `templates/decoration/client.js:1-2`；`/root/projects/dsh-live-mode/build.mjs`（esbuild 打 CJS → 手动包 `__ModuleLoader__.load`，`external: ["react","react-dom/*","react/jsx-runtime","@deepseek-ai/*"]`，id 用**包名** `dsh-live2d-voice`）。
- `<id>/client` 与裸 id 解析到同一 exports（一个插件的 bundle 就是它的 client 半边）。

### 8.4 必须遵守的构建/安装事实

- **宿主服务的是构建产物**：launch 前必须已产出每个 `lib/client.js`，缺一个就大声失败并给出包/路径清单（README「Build requirements」段）。本机 skill `dev-dsh-plugin` 记录的实际症状：`Failed to load plugins` / `bootstrap facade missing`。
- 安装/启用/观察：用 `plugin_manager` 的 `install_bundle`，不要用 shell 复刻；`application: applied` 才算生效；`restart-required` 表示没生效；**替换已安装包需要重启**才能加载新的 JS 模块代（`references/host-plugin.md:54-59`）。
- 包显示元数据：`package.json` 顶层 `meta.title/description`（或 `locale/*.json`）与 `icon`（`references/host-plugin.md:29-45`）。

---

## 9. 落地方案（针对「对话页加一个可切换的整屏自定义渲染视图」）

最小可行（照抄模板 + trajectory）：

```jsonc
// package.json
{ "name": "@local/my-view", "version": "1.0.0", "private": true, "type": "module",
  "exports": { ".": "./index.js", "./client": "./client.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" },
           "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-conversation"] } } }
```

```js
// client.js
window.__ModuleLoader__.load({ id: '@local/my-view', factory(require) {
  const React = require('react');
  return { inject: ['slots'], apply(ctx) {
    ctx.slots.inject('conversation.view', () => ctx.slots.register(
      { name: 'conversation.view', id: 'my-view', order: 30, label: () => '我的视图' },
      MyView));
  }};
}});
```

要点清单：

1. `id` 必须全局唯一；`order` 决定 tab 顺序（chat 0 / trajectory 10 / 想排后面用 >20）。
2. 组件拿到 `useConversation`/`useInput`/`inputActions`（session 标准 kit）与 owner props `openView/inspectCall/viewRequest/completeViewRequest`；**用 `--dsw-alias-*` 上色**。
3. 需要结构化数据时**再**加 `ctx.uiConversation.views.register({target, create})`；不需要就别加（Live2D 证明了非必需）。
4. tab 栏仅在 ≥2 个视图时出现 —— Chat 恒在，所以插件视图注册后 tab 栏必然出现。
5. 不要试图从别处程序化切到这个 tab（无公开 API）；若必须有入口按钮，放在 `conversation.input.right` 并接受 DOM 点击 tab 的 workaround，或改用 §9 之外的 `main` 整页方案（`ctx.layout.selectPanel('my-panel')` 有公开 API）。
6. 打包时 `@deepseek-ai/*` 保持 external（类型导入会被擦除，运行时不要真的 require Harness Client 包）。

---

## 10. 风险与坑（已核实）

| 坑 | 证据 |
|---|---|
| 用 iframe / 独立 HTML 交差 → 拿不到主题、明暗、locale | `practices.md:33` |
| `require('@deepseek-ai/dsh-client-ui-primitives')` → 版本漂移 + 无类型检查 + 抛异常空槽 | `practices.md:35` |
| 组件抛异常只吞掉该槽位并打印 `slot entry crashed in '<slot>'` | `practices.md:35` |
| 注册早于父槽位声明 → 静默不挂载；必须用 `ctx.slots.inject` | 本机 `dsh-proactive/src/client/index.ts:83-85` 注释 |
| 同 cell 同 priority 二次注册 → 抛错；覆盖必须显式更小 priority | `dsh-client-ui-slots/lib/index.js:171,177,183` |
| 覆盖 `root` / `sidebar` / `rightbar` / `main:conversation` 会把内置子槽一起干掉 | `dsh-client-ui-renderer/.../registry.d.ts:18-31`；`dsh-client-ui-layout/.../index.d.ts:34-48` |
| 客户端插件 `inject` 漏声明服务 → 运行时 "cannot get property X without inject" | 本机 skill `dev-dsh-plugin`；本机插件均显式声明 `inject` |
| 缺 `lib/client.js` 构建产物 → 整个 web 端 `Failed to load plugins` / `bootstrap facade missing` | `dsh-client-modules/README.md`「Build requirements」；本机 skill `dev-dsh-plugin` |
| 替换已安装包不重启看不到新代码 | `references/host-plugin.md:59` |
| 视图 tab 的隐藏规则是硬编码的（只有 `trajectory` 受 developerTools 控制），插件无法自带条件隐藏 | `dsh-client-ui-conversation/lib/client.js:17900` |
| 预览/截图不能用 mock 页或光栅化工具替代 | `references/verification.md:3` |

---

## 附录 A：本次使用的检索方法（可复现）

```bash
BASE=/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai

# 1) 抽出全部 SlotMap 声明（89 个）
python3 - <<'EOF'
import re, glob
files = glob.glob('dsh-*/lib/types/**/*.d.ts', recursive=True)
# ... 见本次会话脚本：定位 interface SlotMap {} 块，按嵌套配对提取顶层 'key': { kind, scope }
EOF

# 2) 找所有 conversation.view 的注册与渲染点
grep -rn "conversation\.view" $BASE/dsh-client-ui-*/lib/client.js
grep -rn "conversation\.view" /root/projects/*/src /root/projects/*/packages/*/src

# 3) 找 main / sidebar.panellist 先例
grep -rn "name: \"main\"" $BASE/dsh-client-ui-*/lib/client.js
grep -rn "sidebar.panellist" $BASE/dsh-client-ui-*/lib/client.js
```

## 附录 B：关键文件索引

- 技能：`dsh-agent-preset/skills/cordis-plugin-development/{SKILL.md, references/ui-plugin.md, references/practices.md, references/host-plugin.md, references/verification.md, templates/decoration/*}`
- 槽位内核：`dsh-client-ui-slots/lib/types/index.d.ts`、`.../lib/index.js`
- 渲染器：`dsh-client-ui-renderer/lib/types/client/registry.d.ts`、`README.md`
- 布局：`dsh-client-ui-layout/lib/types/client/{index.d.ts, service.d.ts}`
- 会话：`dsh-client-ui-session/lib/types/client/index.d.ts`
- 会话装配：`dsh-client-ui-conversation/lib/types/client/{contract/slots.d.ts, contract/views.d.ts, contract/conversation.d.ts, conversation/assembly.d.ts, conversation/view-registry.d.ts, service.d.ts}`、`lib/client.js`
- Chat：`dsh-client-ui-chat/lib/types/client/contract/{slots.d.ts, chat-nodes.d.ts}`、`lib/client.js`
- 主题：`dsh-client-ui-theme/lib/types/client/index.d.ts`、`lib/client.js`
- 模块加载：`dsh-client-modules/{README.md, lib/index.js, lib/client.js}`、`dsh-package-manifest/lib/types/types.d.ts`
- 通信：`dsh-api-gateway/lib/types/client/index.d.ts`、`dsh-client-connection/README.md`、`dsh-session-projection/lib/types/index.d.ts`
- 本机先例：`/root/projects/dsh-live-mode/{src/client/index.ts, src/client/view.tsx, build.mjs, package.json, cordis.patch.yml}`、`/root/projects/dsh-proactive/packages/dsh-proactive/src/client/{index.ts, host-api.ts}`、`/root/projects/dsh-notify/src/client.ts`
