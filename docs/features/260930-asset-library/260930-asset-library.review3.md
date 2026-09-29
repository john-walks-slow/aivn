# 检视报告（第三轮复检）

## 概要

本次对 `feat/asset-library` 分支（worktree: `.worktrees/asset-library`）第二轮修复后的状态进行了深入的代码检视与并发时序推演。
上一轮提出的 2 项阻塞问题（WeakMap 实例隔离导致锁失效、manifest 裸写与 TOCTOU 窗口）及 3 项建议修改、1 项测试改进已**全部彻底修复**：配置读改写队列已迁移至底层的 `store.ts` 并按剧目目录路径严格锁定；`assetImport.ts` 重构为两阶段 `ImportPlan`，大文件 I/O 在锁外执行，配置读写与撤销条记录在锁内原子闭环；音量空串过滤与无变动撤销条抑制均已补齐对应单测。
本次未发现新的阻塞性缺陷，整体设计边界清晰、生命周期管理严密，满足合并准入要求。

---

## 需求对齐

| 需求 / 上轮缺陷 | 预期行为 | 本轮修复实现 | 对齐结论 |
| --- | --- | --- | --- |
| **BLOCKER-01: 锁 Key 失效** | 解决 `PlayLibrary.store()` 每次创建新实例击穿 WeakMap 的问题 | `apps/server/src/store.ts` 引入模块级 `configWrites = new Map<string, Promise<unknown>>()`，以剧目目录绝对路径（`store.dir`）为键排队 | ✅ 完全解决 |
| **BLOCKER-02: manifest 裸写与 TOCTOU** | 消除并发导入 manifest 覆盖，确保撤销条精确 | `apps/server/src/assetImport.ts` 重构为 `ImportPlan` 两阶段，文件复制在锁外，manifest 与 `play.json` 的读-改-写以及 `before` 捕获均在锁内执行 | ✅ 完全解决 |
| **SUGGEST-01: 分层倒置** | 消除 `workshopAssets` 反向依赖边缘模块 `assetImport` | 队列锁抽取到存储层 `store.ts:withPlayConfigLock`，由各业务模块统一引用 | ✅ 完全解决 |
| **SUGGEST-02: 无改动记撤销条** | 重复导入相同素材不产生无意义的撤销项 | `assetImport.ts:120` 增加 `if (manifestBefore !== content)` 判断 | ✅ 完全解决 |
| **SUGGEST-03: 空串音量解析** | 避免 `Number("") === 0` 将空串误判定为静音 0 | `packages/core/src/lineage/replay.ts:216` 增加 `raw === undefined \|\| raw.trim() === ""` 过滤 | ✅ 完全解决 |
| **INFO-01: 真实实例并发测试** | 单测模拟真实 REST 路径的不同 store 实例 | `apps/server/test/assetLibrary.test.ts` 改为每次调用 `plays.store("p1")` 取新实例，并增加了反向破坏验证与铁律文档固化 | ✅ 完全解决 |

---

## 重点问题专项核查与技术推演

### 1. 新锁的正确性：以剧目目录路径为 Key 是否可靠？
- **同一剧目的 `dir` 恒等性**：
  在 `apps/server/src/store.ts:304-317` 中，无论是 `store(playId)` 还是 `saveStore(playId, saveId)`，其目录都是通过私有方法 `dirOf(playId) => join(this.root, playId)` 计算得到。由于 `playId` 受 `^[\w-]+$` 白名单正则保护，且服务端运行期间 `this.root` 恒定，因此同一剧目的所有 `PlayStore` 实例其 `dir` 属性在字符串层面严格相同，彻底解决了 WeakMap 对象身份隔离的致命缺陷。
- **`saveStore()`（带 `saveId`）进队列的语义合理性**：
  `withPlayConfigLock` 保护的是**剧目级全局配置**（`play.json` 与 `assets/manifest.json`）。工坊会话持有的是带 `saveId` 的 `PlayStore` 实例，但当工坊出图（`mapSprite`）自动更新差分映射时，修改的依然是跨周目共享的剧目配置 `play.json`；此时它与外部 REST 导入请求竞争的是同一份文件，**理应进入同一条互斥队列**。而存档私有数据（`session.json`、`lineage.jsonl`）由 `PlayStore.saveSession` / `loadSession` 独立维护，完全不经过此锁，不会引入任何不必要的阻塞或副作用。

### 2. `configWrites` Map 的生命周期与时序分析
- **队尾清理（`delete`）的正确性**：
  ```ts
  const next = (configWrites.get(playDir) ?? Promise.resolve()).then(task);
  const tail = next.catch(() => {});
  configWrites.set(playDir, tail);
  void tail.finally(() => {
    if (configWrites.get(playDir) === tail) configWrites.delete(playDir);
  });
  return next;
  ```
  通过 `if (configWrites.get(playDir) === tail)` 严格校验，只有当当前任务依然位于队尾时才从 Map 中移除键。若在任务执行期间有后续任务进队，`configWrites.get(playDir)` 会被更新为后续任务的 `tail`，当前任务的 `finally` 将跳过 `delete`。当最后一个排队任务完成时，Map 条目被彻底释放，**无内存泄漏风险**。
- **异常隔离与容错（Task Reject）**：
  排队链条依赖的是 `tail = next.catch(() => {})`。即使某个任务抛出异常（例如 JSON 格式错误），`tail` 仍会解析为成功的 Promise（fulfilled），后续排队任务能够顺畅执行而不会被上游异常破坏；同时由于返回的是原始的 `next`，当前调用方能精准捕获到自身的异常，不会静默吞错。

### 3. 重构后的 `assetImport.ts`：两阶段划分与 TOCTOU 防御
- **消除 TOCTOU 窗口**：
  原本 `manifestBefore` 是在文件复制开始前异步读取的，在复制大文件期间若有其他写操作，会导致状态陈旧。新实现将 `manifestBefore`、当前 `manifest`、`play.json` 的 `before` 全部移至 `withPlayConfigLock` 锁内现取，并在锁内一次性完成校验、合并、写盘与撤销条收集，读写完全原子化。
- **并发导入同条目与 `removeStaleSiblings` 幂等性**：
  在 `removeStaleSiblings` 中，通过 `if (name === keep || stemOf(name) !== stem) continue;` 保证了当前正在写入的目标文件（`keep`）绝对不会被删除。并发两次导入同一个素材（例如 `hall.png`），`keep` 均为 `hall.png`，两者均跳过删除；旧格式文件（如 `hall.jpg`）使用 `rm(..., { force: true })`，并发删除具有幂等性，不会抛错，更不会误删对方的目标文件。

### 4. `ImportPlan` 的职责边界清晰度
- `copySingleFile` 与 `copySpritePack` 纯粹负责磁盘 I/O（读取源文件、清理旧扩展名、复制目标文件、收集生成路径），将要写入配置的内容抽象为轻量的纯内存结构 `ImportPlan`。
- 大文件复制耗时不占用全局配置锁；锁内仅做耗时毫秒级的纯内存 JSON 解析、合并与写入。职责划分边界极佳，兼顾了并发吞吐与数据一致性。

---

## 阻塞问题

无。

---

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUGGEST-01 | [apps/server/src/http.ts:289-295](apps/server/src/http.ts#L289-L295) | **`PUT /api/plays/:id/play` 全量保存剧目配置未接入 `withPlayConfigLock`**。<br>在 HTTP REST API 中，用户在前端剧目设置页面提交保存整份 `play.json` 时，直接执行了 `await store.savePlay(play)`。虽然用户手工点保存与素材导入/出图撞车的概率较低，但为了保证系统内所有对 `play.json` 的读写严格走统一互斥锁，建议将其包裹在锁内。 | 在 `http.ts:292` 改为：<br>`await withPlayConfigLock(store.dir, () => store.savePlay(play));`。 |

---

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| INFO-01 | [apps/server/src/store.ts:49](apps/server/src/store.ts#L49) | **`withPlayConfigLock` 的 `playDir` 参数可增加路径规范化防御**。<br>当前所有调用方均传入 `store.dir`，由 `PlayLibrary.dirOf` 产生规范绝对路径。但若未来有其他模块直接传入相对路径或带尾部斜杠的路径（如 `plays/p1/` vs `plays/p1`），可能产生 Map Key 不一致。 | 在 `withPlayConfigLock` 开头增加 `const key = resolve(playDir);`，强化键的唯一性防御。 |

---

## 准入结论

**结论**：`准入`

**说明**：上一轮评审提出的 2 项阻塞性架构缺陷（WeakMap 实例锁穿透、manifest 裸写与 TOCTOU 竞态）已彻底通过「路径队列锁 + ImportPlan 两阶段事务」解决，测试验证扎实有效，代码设计边界清晰，生命周期严密无泄漏，无遗留阻塞问题，准予合并交付。
