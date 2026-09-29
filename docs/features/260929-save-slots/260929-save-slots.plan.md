# 多周目存档（存档 = 一棵独立的故事树）

> **状态**：已实施并完成实机验证（详见 `260929-save-slots.validation.md`、`260929-save-slots.summary.md`）
> **问题**：「开始游戏」= `startFresh()` → `resetSession()` 把 `session.json` + `lineage.jsonl` 一起 `rm`。
> 一个剧目只有一档，历史被点掉即不可恢复。
> **目标**：存档（周目）= 一棵独立的谱系树；一个剧目下并存 N 棵，开始新周目只新建不覆盖。
> **已对齐的产品决定**（2026-09-29 与用户逐条盘过）：
> 1. 「开始新周目」一键开演，档名自动「第 N 周目」，事后在周目页改。
> 2. 周目列表是独立页面，列表卡显示名称 / 拍数 / 最后一句 / 更新时间 / 当前进行中；可进入、重命名、删除。
> 3. **重命名是独立操作**：就地改档名标签，与「重新开始」无关，不动树、不动 id。

---

## 1. 磁盘布局

```
plays/<id>/
  play.json                  剧目定义（共享）
  assets/                    素材 + 生图 manifest（共享）
  memory/always/ index/      剧目级记忆（共享）
  media-cache/               TTS / 生图缓存（共享）
  workshop/                  工坊线程（共享）
  saves/
    <saveId>/
      meta.json              { id, name, createdAt, updatedAt, beats, preview }
      session.json           { lineage, engine, scene, runtime, savedAt }
      lineage.jsonl          append-only 事件日志
  active.json                { saveId }   当前活动档指针
```

- `saveId` = `s<base36 时间戳>`，与档名解耦——改名不动 id，`active.json` 不会失效。
- `meta.json` 独立于 `session.json`：列列表 / 改名不该读动辄数 MB 的会话文件。
  `beats`（拍数）与 `preview`（当前路径最后一句台词，截 40 字）在 `saveSession` 时顺手写入，
  列表接口因此是 O(档数) 而非 O(全部事件)。
- `active.json` 决定「继续」进哪棵；无指针 = 无档，Title 走冷启动。

## 2. 共享 / 隔离边界（防剧透不能破）

| 共享（剧目级） | 隔离（每档） |
|---|---|
| play.json、assets、memory/always、index/{locations,lore}、media-cache、生图 manifest、工坊线程 | lineage events（独立 id 空间）、engine/scene 快照、index/arcs 引用、archive 切片 |

新档天然不剧透，**不需要额外代码**：

- `index/arcs/` 仍是剧目级目录，但编排器按 `arcIds` 过滤，新档 `arcIds` 为空 → 旧纪元摘要进不了 A 区；
- `archive/` 切片带 `entryId`，`search_archive` 以 `tree.pathSet()` 过滤，新档节点 id 空间不重叠 → 召回不到旧档往事。

## 3. 服务端

### `apps/server/src/store.ts`
- `PlayStore` 增 `saveId` 作用域，路径解析到 `saves/<saveId>/`；`library.store(playId)` 保持不变（工作区级操作），
  新增 `library.saveStore(playId, saveId)`。
- 删 `resetSession()`。
- 新增 `PlaySaves`（`saveStore` 的同级小类，或并入 `PlayLibrary`）：
  `list()` / `create(name?)` / `rename(id, name)` / `remove(id)` / `activate(id)` / `readActive()`。
  `remove` 删整目录；删的是当前档时清 `active.json`。
- `saveSession()` 顺带更新 `meta.json` 的 `updatedAt` / `beats` / `preview`。
- `readiness().hasSession` 语义改为「本剧目有档」，由 `PlaySaves.list().length > 0` 出。

### `apps/server/src/playhouse.ts`
- `buildRuntime(playId, saveId)`。
- `get(playId)`：现读 `active.json` → 解析 saveId；无档则懒建一个空档（Title 的「开始新周目」会先建，兜底只防直连 `/ws`）。
- 新增 `switchSave(playId, saveId)`：复用 `reloadAfterWorkshopWrite` 的套路
  —— `await old.orchestrator.whenIdle()` → `dispose` → `buildRuntime(新档)` → 广播 `hello` + `stoppedReplay`。
  活连接靠 epoch 不一致自动清缓冲全量重放，不断线。
- 删 `startFresh()`。

### `apps/server/src/http.ts`
| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/plays/:id/saves` | 列档（含 current 标记） |
| POST | `/api/plays/:id/saves` | 新建（body.name?）并设为当前 |
| PATCH | `/api/plays/:id/saves/:saveId` | 重命名 |
| DELETE | `/api/plays/:id/saves/:saveId` | 删除 |
| PUT | `/api/plays/:id/active` | 切档（body.saveId）→ 重建 runtime |

### `packages/core/src/ws/protocol.ts` + `apps/server/src/transport.ts`
- 删 `ClientMessage.start` —— 破坏性路径从协议里彻底消失。新档为空树，舞台连接时 `autostart()` 自己开拍，
  不需要额外的 start 握手。
- `transport` 删 `msg.type === "start"` 分支。
- `hello` 载荷加 `saveId` / `saveName`（舞台顶部要显示当前周目名）。

## 4. 前端

- `TitleView`：主按钮「开始新周目」→ `POST /saves` → 跳 `#/play/:id/stage`（不带 mode）；
  有档时显示「继续」；新增「周目」入口；删掉「尚无进度（开始即新档）」那句。
- 新 `apps/web/src/views/SavesView.tsx` + 路由 `#/play/:id/saves`：
  列表卡（进行中 / 拍数 / 最后一句 / 更新时间 / 操作：进入 · 重命名 · 删除）。
  删除走 `window.confirm`。`busy` 时（正在演出）切档按钮禁用并提示「等这一拍结束再切档」。
- `StageScreen`：删 `?mode=start` 的消费逻辑；顶部显示当前档名。
- `useStageSocket`：删 `expectFreshRef` 与 `start` 发送分支。
- `api.ts`：加 `listSaves` / `createSave` / `renameSave` / `deleteSave` / `activateSave`。

## 5. 已有数据

`plays/demo`、`plays/mh` 根目录现存的 `session.json` / `lineage.jsonl` 在新布局下不再被读到。
实施时手工 `mv` 进 `saves/<id>/` 并补 `active.json`（一次性操作，**不写迁移代码**）。

## 6. 测试

- `store`：建档 / 列档 / 改名 / 删档 / 切档指针 / `meta.json` 与 `session.json` 同步 / 无 active 时的冷启动。
- `playhouse`：`switchSave` 后 runtime 指向新树，旧档文件不动（回归线：切档不 rm 任何东西）。
- `playFiles`：`saves/**` 与 `active.json` 对工坊不可见（改现有断言的路径）。
- 回归：`orchestrator` / `lineage-ops` / `transport` 现有用例按影响面跑，不全量。
- 手动：Title 开始新周目 → 演几拍 → 回周目页看到两棵 → 进旧档续演 → 改名 → 删除。

## 7. 文档

- `AGENTS.md`：改「剧目运行时数据不进 git」条目（`plays/*/saves/`、`plays/*/active.json`）；
  铁律补一条「存档 = 一棵树，只增不删：开始新周目只新建，切档只改指针」。
- `README.md`：新增「周目（存档）」用户说明——是什么、怎么用、怎么改名/删除。
- 本目录补 `validation.md`（用户实机确认）与 `summary.md`。

## 8. 已知限制（写进 UI 提示，不做过度设计）

- 一个剧目同时只有一个 runtime。切档会 dispose 当前编排器，拍中途切档会丢掉这一拍未收束的演出
  （与直接关网页同构）。故周目页在 `busy` 时禁用切档。
- 旧 `session.json` 若忘记手工 `mv`，旧进度看起来会消失。
