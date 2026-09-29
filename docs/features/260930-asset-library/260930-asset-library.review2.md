# 检视报告（第二轮复检）

## 概要

本次对 `feat/asset-library` 分支（worktree: `.worktrees/asset-library`）在上一轮审查后的修复进行了第二轮详细代码复检。
上一轮提出的 BLOCKER-01（音量重放丢失）、BLOCKER-02（音频停止语义不一致）、SUGGEST-01（快速换曲切音时序）、SUGGEST-02（ambient 跨目录寻址）、SUGGEST-03（sfx volume 还原）、SUGGEST-04（静态路由层级限制）、INFO-01（分类 Tab 计数）及测试覆盖均已得到高质量的修复与覆盖；
然而针对 BLOCKER-03（写竞态与撤销），当前使用的 `WeakMap<PlayStore, ...>` 队列锁存在由于 `PlayLibrary.store()` 每次创建全新对象而导致的**队列击穿漏洞**（REST API 并发导入及 REST 与工坊出图并发时锁完全失效），且 `assets/manifest.json` 缺乏串行保护与存在 TOCTOU 窗口。因此本次检视结论为 **`不准入`**。

---

## 需求对齐

| 需求 / 上轮缺陷 | 预期行为 | 本轮修复实现 | 对齐结论 |
| --- | --- | --- | --- |
| **BLOCKER-01: 音量重放丢失** | 重放及分岔时还原 `bgm_volume` 与 `ambient_volume` | `lineage/replay.ts` 在 `case "scene"` 合并了 `pickVolume`，并补充了测试 | ✅ 完全解决 |
| **BLOCKER-02: 空串停止语义退化** | 空串归一化为 `"none"`，缺省属性不补键 | `orchestrator.ts:1212-1214` 精确判断 `event[key] !== undefined && trim() === ""` 归一化为 `"none"`，未声明字段保持 undefined | ✅ 完全解决 |
| **BLOCKER-03: play.json 读改写竞态与撤销** | 跨通路串行互斥，工坊导入带撤销条 | 实现了 `enqueuePlayJsonWrite` 并接入工坊 `onWrite`；但存在 WeakMap 对象隔离与 manifest 裸写漏洞 | ❌ 未彻底解决 |
| **SUGGEST-01: 快速换曲 pop** | 掐掉最老淡出曲，刚退下曲从头淡出 | `LoopChannel.retire()` 与 `discard()` 重构，经时序推演完全正确 | ✅ 完全解决 |
| **SUGGEST-02: ambient 跨目录** | 优先查 sfx 目录，未命中回落查 bgm | `AssetIndex.ambient` 组合 `byStem(sfx) ?? byStem(bgm)`，StageTheater 改调新方法 | ✅ 完全解决 |
| **SUGGEST-03: sfx volume 丢失** | sfx 音量写入谱系并在重放时还原 | `orchestrator.ts` 记录 `volume`，`replay.ts` 还原为数字 | ✅ 完全解决 |
| **SUGGEST-04: 静态路由校验** | `/library/...` 严格限制路径段长度 | `http.ts:135` 增加 `parts.length !== 4` 判定返回 404 | ✅ 完全解决 |
| **INFO-01: 分类 Tab 计数** | 筛选或搜索时不丢失全局类别总数 | 服务端全量计算 `counts`，前端接口与组件绑定服务端计数值 | ✅ 完全解决 |
| **INFO-03: 回归测试覆盖** | 补充谱系重放、编排器归一化、导入并发的测试 | 新增 `lineageAudio.test.ts` (5例)、编排器测试 (3例)、导入测试 (3例) | ⚠️ 部分有效（单测未暴露 WeakMap 缺陷） |

---

## 重点关注问题专项分析

### 1. BLOCKER-03 的修法是否真的封住了竞态？
**结论：未完全封住，存在严重的队列失效与 TOCTOU 漏洞。**
- **WeakMap 键失效（致命缺陷）**：`assetImport.ts:47` 声明了 `const playJsonWrites = new WeakMap<PlayStore, Promise<unknown>>()`。
  - 在 `apps/server/src/store.ts:288-290` 中：
    ```ts
    store(playId: string): PlayStore {
      return new PlayStore(this.dirOf(playId));
    }
    ```
  - 当通过 REST API `POST /api/plays/:id/assets/import` 导入素材时，`http.ts:288` 每次请求都执行 `const store = library.store(playId)`，从而每次生成一个**全新**的 `PlayStore` 对象实例。
  - 此外，工坊持有的 `store` 是在剧目运行时构建时通过 `library.saveStore(...)` 创建的另一个独立对象实例。
  - **后果**：因为 WeakMap 依赖严格的对象引用相等性（Object Identity），两次并发的 HTTP 导入请求，或者 HTTP 导入与工坊内部的出图（`workshopAssets.mapSprite`），它们传入的 `store` 根本不是同一个实例！`playJsonWrites.get(store)` 每次都返回 `undefined`，**所谓的串行队列被彻底穿透，并发覆盖依然会发生**。
- **`assets/manifest.json` 缺乏串行保护与 TOCTOU 窗口**：
  - `importFromLibrary`（`assetImport.ts:112-130`）中，`assets/manifest.json` 的读与写完全在 `enqueuePlayJsonWrite` 之外。
  - `manifestBefore` 是在文件复制开始前异步读取的；随后执行了耗时较长的文件复制（`copyInto`、`removeStaleSiblings`）；最后无条件执行 `files.write("assets/manifest.json", content)`。
  - 当并发导入两个素材时（例如同时导入背景 A 和背景 B），它们会同时读到旧的 manifest，后完成的写操作会直接覆盖冲掉先完成者的 manifest 条目；且 `manifestBefore` 记录的是陈旧状态，撤销条将导致数据回滚错误。

### 2. `enqueuePlayJsonWrite` 的模块归属与循环依赖
- **循环依赖分析**：`assetImport.ts` 对 `workshop.ts` 是 `import type { WorkshopWrite }`，在编译为 JavaScript 运行时已被完全擦除，因此运行时没有循环引用。
- **分层倒置与设计归属**：`play.json` 是剧目的核心全局配置。一个用于协调全局 `play.json` 写入互斥的队列，挂在一个只负责素材导入的边缘模块 `assetImport.ts` 中，被工坊核心模块 `workshopAssets.ts` 反向引用，属于明显的分层倒置与坏味道。更合乎架构设计的做法是挂载到 `PlayStore` 自身或 `PlayLibrary`（按剧目目录路径做锁管理）。

### 3. BLOCKER-02 的归一化位置对不对？
- **结论：位置与逻辑完全正确。**
- `orchestrator.ts:1212-1214`:
  ```ts
  for (const key of ["bgm", "ambient"] as const) {
    if (event[key] !== undefined && String(event[key]).trim() === "") attrs[key] = "none";
  }
  ```
  - 当模型未输出 `bgm` 属性时，`event.bgm` 是 `undefined`，`if` 条件不满足，`attrs` 中不会包含 `bgm` 键。重放时该属性依然缺省，完美映射为「保持当前」。
  - 当模型输出 `bgm=""` 时，`event.bgm` 为 `""`，经过判定后赋予 `"none"`。重放时提取出 `"none"`，驱动前端音频组件停止播放。
  - 真正实现了「缺省=保持、空串/none=停止」的三态穿透。

### 4. `loopAudio.ts` 新 `retire()` 的两段式时序分析
- **结论：时序推演在三种场景下均完全正确。**
  - **连换 3 首（曲 1 -> 曲 2 -> 曲 3，间隔 < 1200ms）**：
    换曲 3 时，`this.retired`（曲 1）被 `this.discard()` 立即掐断、取消定时器并清除引用；正在播放的 `this.active`（曲 2）变为新的 `this.retired` 并平滑淡出到 0；曲 3 成为 `this.active` 平滑淡入。彻底杜绝了 pop 爆音。
  - **淡出中途 dispose**：
    `dispose()` 对 `[this.active, this.retired]` 调用 `discard()`，立即清除 `ramps` 定时器，暂停音频，清除 `src`，不会发生回调悬挂或泄漏。
  - **dispose 时还有 active**：
    `active` 音轨同上被安全取消并销毁。

### 5. 新增测试的有效性评估
- `packages/core/test/lineageAudio.test.ts` 与 `apps/server/test/orchestrator.test.ts` 编写了扎实且针对行为本质的断言（包括边界分支、空串归一化、非数字属性过滤），能可靠防止回归。
- **但是**，`apps/server/test/assetLibrary.test.ts:267-271` 的并发测试：
  ```ts
  const store = plays.store("p1");
  await Promise.all([
    importFromLibrary(library, store, { kind: "sprites", entryId: "mio" }),
    importFromLibrary(library, store, { kind: "sprites", entryId: "rio" }),
  ]);
  ```
  由于单测中显式复用了同一个 `store` 变量，恰好掩盖了上述 WeakMap 实例不一致的真实缺陷。如果单测模拟真实运行环境，写成分别调用 `plays.store("p1")`，该测试将当场失败。

---

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| BLOCKER-01 (NEW) | [assetImport.ts:47-55](apps/server/src/assetImport.ts#L47-L55)<br>[store.ts:288-290](apps/server/src/store.ts#L288-L290)<br>[http.ts:288](apps/server/src/http.ts#L288) | **`playJsonWrites` 以 `WeakMap<PlayStore, ...>` 为 Key 导致并发锁失效，REST API 导入与工坊出图并发时仍会发生 `play.json` 覆盖**。<br>由于 `PlayLibrary.store(playId)` 每次被调用都实例化一个新的 `PlayStore` 对象，因此每一个 HTTP 请求持有的 `store` 引用均不相同；工坊内部持有的 `store` 亦由 `saveStore` 独立创建。`WeakMap` 无法跨对象引用建立关联，导致针对同一剧目的并发写操作根本没有进入同一条 Promise 队列，并发竞态依然存在。 | 弃用以对象引用为键的 `WeakMap<PlayStore>`，改用以**剧目目录绝对路径**（`store.dir`，即 `string`）为键的全局 `Map<string, Promise<unknown>>`；或者在 `PlayLibrary` / `PlayStore` 内部统一定义该队列锁，确保同一个剧目的读改写严格互斥。 |
| BLOCKER-02 (NEW) | [assetImport.ts:112-130](apps/server/src/assetImport.ts#L112-L130) | **`assets/manifest.json` 在 `importFromLibrary` 中裸读裸写，缺乏并发串行保护，且存在 TOCTOU 窗口**。<br>1. 导入素材时，`assets/manifest.json` 未加入任何串行队列，并发导入两个素材时，先完成者写入的 manifest 元数据会被后完成者完全覆盖丢失；<br>2. `manifestBefore` 在复制大文件前提前读取，若复制期间有其他写入，写盘时记录的 `before` 为陈旧状态，导致工坊撤销条失真。 | 将 `assets/manifest.json` 的读改写同样纳入串行队列（或与 `play.json` 一并作为事务性串行任务）；并在队列执行体内（即所有文件复制完成、真正写 manifest 前）读取 `before` 与当前最新的 manifest。 |

---

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUGGEST-01 | [assetImport.ts:49](apps/server/src/assetImport.ts#L49)<br>[workshopAssets.ts:5](apps/server/src/workshopAssets.ts#L5) | **`enqueuePlayJsonWrite` 放置在 `assetImport.ts` 存在分层倒置**。<br>`play.json` 属于剧目核心配置层，工坊资产层 `workshopAssets.ts` 反向 import 素材导入模块的内部工具函数，职责倒置且易引发耦合坏味道。 | 将剧目级配置文件互斥队列迁移至 `PlayStore`、`PlayLibrary` 或 `playFiles.ts` 等存储/配置管理层，由相关业务模块统一引用。 |
| SUGGEST-02 | [assetImport.ts:130](apps/server/src/assetImport.ts#L130) | **`manifest.json` 未发生变化时仍然记录撤销条**。<br>若重复导入相同素材，`manifestBefore` 与 `content` 一致，但 `result.writes` 仍 push 了该条目（而在 `importSpritePack:211` 中对 `play.json` 做了 `if (before !== after)` 校验）。 | 增加 `if (manifestBefore !== content)` 判定，避免向工坊广播多余的无改动撤销条。 |
| SUGGEST-03 | [lineage/replay.ts:214-218](packages/core/src/lineage/replay.ts#L214-L218) | **`pickVolume` 对空字符串防御不足**。<br>在 JS 中 `Number("") === 0` 且 `Number.isFinite(0)` 为 true。若历史脏数据中存在 `bgm_volume=""`，会被误解析为静音 `0` 而非缺省保持。 | 在 `pickVolume` 中增加 `if (raw === undefined || raw.trim() === "") continue;` 的严格校验。 |

---

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| INFO-01 | [assetLibrary.test.ts:267-271](apps/server/test/assetLibrary.test.ts#L267-L271) | **并发导入单元测试未模拟不同的 `PlayStore` 实例**。<br>单测中声明 `const store = plays.store("p1")` 并在多个 Promise 间复用，未能覆盖真实 HTTP 请求下不同 store 实例的并发场景。 | 在单测中改为 `importFromLibrary(library, plays.store("p1"), ...)` 与 `importFromLibrary(library, plays.store("p1"), ...)` 并发，以真实验证跨实例排队锁。 |

---

## 准入结论

**结论**：`不准入`

**说明**：上一轮审查的音频重放、停止语义、淡出 pop 等问题已完全修复，但针对核心数据读改写竞态（原 BLOCKER-03），本轮使用的 `WeakMap<PlayStore>` 机制由于 `store` 实例非单例而被彻底穿透，且 `assets/manifest.json` 仍存在并发覆盖与 TOCTOU 漏洞。须将锁机制改为以剧目路径为键，并将 manifest 纳入串行保护后，方可准入。
