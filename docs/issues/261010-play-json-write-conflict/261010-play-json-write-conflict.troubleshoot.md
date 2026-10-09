# play.json 的「人 vs 模型」写冲突（未修）

日期：2026-10-10 · 状态：**诊断完成，未修**（从 P6 轴拆出的独立课题）
发现路径：P6 轴复核 `set_craft` 的写锁时暴露（`261009-p6-scope-review.md` §6）

## 一句话

`play.json` 有**四个写者**，它们不是都在同一条队列上；其中两条是「客户端先读、再整份写」，
互相覆盖时会**静默丢掉整份 JSON**（不是丢一个字段）。今天就能发生，与删不删 `set_craft` 无关。

## 现状：谁在写 play.json

| # | 写者 | 入口 | 是否进 `withPlayConfigLock` |
| --- | --- | --- | --- |
| 1 | 剧目设置页保存 | `PUT /api/plays/:id/play` → `store.savePlay`（`apps/server/src/http.ts:397-403`） | ✅ 是 |
| 2 | 工坊文件页保存 | `PUT /api/plays/:id/files` → `workshop.writeFile`（`http.ts:417-429`）→ `workshopSession.ts:401-405` → `PlayFiles.write`（`playFiles.ts:220-240`） | ❌ 否 |
| 3 | 模型 `write` / `edit` | pi 文件工具 → `PlayEnv.writeFile`（`agentkit/playEnv.ts:62-90`）→ 同一个 `PlayFiles.write` | ❌ 否 |
| 4 | （原 `set_craft`） | `agentkit/craftTool.ts:127-143` | ✅ 是（**2026-10-10 已随 P6-b 删除**） |

`withPlayConfigLock`（`apps/server/src/store.ts:57-78`）是按**剧目目录**串行的 promise 队列，注释自己写着
「play.json 与 assets/manifest.json 的写入方散在 http / workshop / playAssets / assetImport 四处，
锁得由最底层的存储面来发」——但它实际上只被**服务端内部的读改写事务**调用：
`set_craft`（已删）、引用即导入（`assetImport.ts:207`）、素材表（`playAssets.ts:1142`）、乐表
（`playMusic.ts:124`）、HTTP 整份保存（`http.ts:401`）。**入口 2 与 3 从来没进过这把锁。**

## 为什么「补一把锁」不等于修好

入口 2 / 3 的形态是「上游先读到一份内容（浏览器编辑器 / 模型的 `read`），再整份写回」——
读发生在锁外。把**写**串行化解决不了 stale read：

```
T0  浏览器打开文件页，读到 craft.beatLength = "short"
T1  模型 edit 了 play.json 的 title（写盘）
T2  浏览器保存，把它 T0 读到的那份整篇写回  → T1 的 title 改动消失
```

丢的是**整份后写的 JSON**（含 `agents`、`image`、`craft`、`cast` 等全部字段），影响高于字段级冲突。
模型侧同理：pi 的 `edit` 是「read → 改 → writeFile」，`read` 与 `writeFile` 之间没有事务。

## 修法（方向，未实施）

**乐观并发（compare-before-write）**：

1. 每个写口在返回内容时附带一个**版本标记**（`mtimeMs + size`，或内容哈希，或单调计数器）；
2. 写回时必须带上它，服务端在同一把 `withPlayConfigLock` 里 compare：
   不一致就 **409 冲突**，把「文件已被别人改过」如实回给调用方，让浏览器/模型重读再改；
3. 浏览器侧把 409 呈现成「文件已在别处改动，请重新加载」，而不是静默覆盖；
   模型侧把 409 回成工具错误（pi 的 `edit` 本来就会把文件级错误回给模型）。

配套：模型自己的 `edit` 若也要参与（read 与 write 之间比版本），得在 `PlayEnv` 上给出读时的版本，
——那是第二步；第一步先保证**人机之间**不互相静默覆盖。

## 不做「写口加枚举校验」的理由

顺带排除一个诱人的替代方案：把 `CRAFT_ENUMS` 加进 `assertPlayConfig`，让写口当场拒非法 `craft` 取值。
技术上可行、错误也能回给模型，但会在**服务端单边**造出一处与插件不同的写口行为，违背「最少机制」；
取值对错仍由 `validate_play`（`readiness/play.ts` 的 `strayCraftValues`）事后报。

## 影响面与验证（修的时候）

- `apps/server/src/store.ts`（版本比较的落点）、`http.ts`（两个 PUT 的响应与 409）、
  `apps/server/src/playFiles.ts`（`read` 是否带回版本）、`agentkit/playEnv.ts`（模型侧第二步）、
  浏览器侧文件页与设置页（冲突提示与重载）。
- 验证：两个并发写者交错写 play.json 的用例（先读 A、写 B、再写 A → A 得 409 且 B 的内容完整）；
  文件页 UI 上要能看到冲突提示而不是静默覆盖。

## 相关

- `docs/features/261009-aivn-agent-package/261009-aivn-agent-package.p6.plan.md`（本课题从 P6 轴拆出）
- `docs/features/261009-aivn-agent-package/261009-p6-scope-review.md` §6（写锁现状的实读证据）
