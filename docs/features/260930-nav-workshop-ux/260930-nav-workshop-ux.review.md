# 检视：导航与工坊界面一轮收口

范围：`apps/web/**`、`README.md`、`AGENTS.md`、本目录文档。前端单方面改动，服务端与 core 零改动。

## 删掉的东西

| 删除 | 理由 |
| --- | --- |
| `views/WorkshopScreen.tsx` | 工坊有了自己的路由页 = 两个外壳两份连接，也是「顶栏跳变」的第 11 条源头 |
| `workshop/useWorkshopSocket.ts` | 工坊复用舞台那条连接，第二条连接是 P4c 铁律 ④的破坏（自己打断正在进行的对话） |
| `workshop/WorkshopPanel.tsx` | `drawer | full` 双形态已无意义 |
| `workshop/CraftPanel.tsx` | 被 `MemoryPanel` 覆盖（一份文件 vs 整个 `memory/**`） |
| CSS：`.stop-panel*` / `.drawer` / `.workshop-drawer` / `.screen-bar` 等 | 随之无引用的样式 |

## 留下的结构

```
App ─ <StageScreen key={query}>   ← 连接、runtime、作品集、视角
     └ <StageShell>                ← 侧栏四视图 / 视图栏 / 周目切换
         ├ StageTheater            ← 画面 + 选肢层（.theater-stage 内）+ 导演栏
         ├ RouteCanvas             ← 回顾 / 路线
         └ WorkshopPane            ← 五页签，订阅 stage 的 workshop 通道
```

## 值得记的三件事

1. **同路由改 hash 不会重挂组件**——`useState(() => 从 query 取值)` 只在挂载时跑。想靠 URL 表达「落在哪个视图 + 这条连接开不开演」，就必须把 query 放进 `key`。
2. **方块图标键的 `padding: 0` 不是洁癖**：全局 `button` 内边距会把 32px 键的内容框压到 4px，图标右偏 7px——肉眼表现为「图标没居中」，根因在 CSS 而不在图标或 flex。
3. **浮层的作用域要跟「它要挡住什么」对齐**：选肢要挡住的是「点画面继续」这个手势，不是整个应用。盖全屏会把导演动词在最需要的时候一起关掉。

## 复查结论

- 纯函数（`stage/view.ts`、`workshop/memoryFiles.ts`）有单测且先红后绿。
- 状态与连接的真源仍是 `StageScreen`，工坊/视图切换不新建连接；`workshop=1` 才换。
- 服务端契约零改动，`?workshop=1` 与 `view=`/`tab=` 都是既有能力。
- 未覆盖项见 `260930-nav-workshop-ux.validation.md` 末节（DSL `free` 停止点、`no_stop` 继续卡实机触发）。
