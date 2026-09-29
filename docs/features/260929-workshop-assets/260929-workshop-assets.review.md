# 工坊生图能力与静态素材落盘 · 代码检视报告

## 概要

本轮检视针对 `feat/workshop-assets` 分支（工坊生图、角色立绘差分垫图、就绪门放开及相关全栈改动）。
总体评价：**架构清晰、工程防御意识极强**。将生图抽象为 `ImageBackend`（cpa 与 flow2api 双实现）、引入带槽位转让与优先级的共享 `Limiter` 解决并发超发问题、在 `PlayFiles` 设立受限二进制写入通道、用 `neutral` 兼任定妆照与垫图锚点、并在服务端增加画幅回执硬核校验（防 flow2api 静默横图）等关键设计非常扎实，绝大部分历史踩坑点和 Critique 风险均被妥善处理。
然而，在角色一致性链路、多立绘并发写盘以及错误处理流中，发现了 **3 处阻塞问题**（自动生成的 neutral 未广播上屏、并发 mapSprite 丢失更新、错误时已生成图片被冲刷清空），须修复后方可准入。

---

## 需求对齐

| 需求目标 | 实现情况 | 偏差/说明 |
| --- | --- | --- |
| 1. 工坊能调生图 API 并落盘 `assets/` | ✅ 已实现 | 新增 `generate_asset` 工具，落盘 `assets/{backgrounds,cg,sprites}/` |
| 2. 没有图也支持开始演出（就绪门只卡 premise） | ✅ 已实现 | `store.readiness` 与前端 `api.ts` 同步改动，无图时展示弱提示不阻塞开演 |
| 3. 立绘差分角色一致性（neutral 垫图 + 自动补写 sprites） | ⚠️ 部分阻塞 | 核心逻辑闭环，但自动先出的 neutral 漏广播前端，且并发补写 `play.json` 有竞态风险 |
| 4. 设定过程多询问、出图前先确认 | ✅ 已实现 | 工坊 system prompt 完整落地四步设定流程与出图前确认铁律 |

---

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| **B1** | `apps/server/src/workshopAssets.ts:203`<br>`apps/server/src/workshop.ts:178` | **自动定妆生成的 `neutral` 资产未触发 `onAsset` 广播，导致对话流与历史中丢失该图**<br>当角色首次生成差分（如 smile）且无 neutral 时，`ensureNeutral` 递归调用 `this.generate` 成功落盘了 neutral 并写了 `play.json`，但其返回值被丢弃，未触发 `onAsset` 回调。前端只收到 smile 的 `workshop_asset` 广播，`pendingAssets` 与消息的 `images` 均无 neutral。用户花钱出了一张至关重要的定妆照，在界面气泡与灯箱中却完全看不见。 | 将 `onAsset` 回调作为依赖注入 `WorkshopAssets`（或由 `ensureNeutral` 将生成的定妆照资产向上返回），在生成 neutral 落盘后立即调用 `onAsset` 广播给会话，使其进入 `pendingAssets` 并持久化进消息 `images`。 |
| **B2** | `apps/server/src/workshopAssets.ts:216-229` | **并发生成多个立绘时 `mapSprite` 读写 `play.json` 存在竞态丢失更新（Lost Update）**<br>`STAGE_IMAGE_CONCURRENCY=2`，当工坊在同一次对话中并发触发 2 个不同差分生成（如 smile 与 sad）时，两者并行出图后几乎同时进入 `mapSprite`。任务 A 与 B 分别读取磁盘上的 `play.json`，修改自己的字段后再写回磁盘，后完成者会把先完成者的 sprite 映射彻底覆盖冲掉。 | 在 `WorkshopAssets` 内部对 `mapSprite`（或对 `play.json` 的写操作）引入简单的串行互斥锁（如 Promise 链排队锁），确保 Read-Modify-Write 过程严格串行原子化。 |
| **B3** | `apps/server/src/workshopSession.ts:150-162`<br>`apps/web/src/workshop/useWorkshop.ts:69-80` | **`workshop_error` 分支下生成的 `images` 被随后的 `snapshot` 瞬间冲刷丢失**<br>对话中若先成功生成第 1 张图，第 2 步发生异常进入 catch 块，虽然发出了带 `images` 的 `workshop_error`，但服务端未向 `threads` 追加任何 assistant 消息。随后 `session.chat` 必然执行的 `await this.snapshot()` 会下发 `workshop_history`，前端收到后立即清空 `pendingAssets`，导致界面上的图闪现即逝，重连/刷新后更彻底消失。 | 在 catch 块中，若 `images.length > 0`，向 `threads` 记录一条失败摘要消息（例如 `[生成中断] ${message}`）并将 `images` 挂在该消息上，确保其持久化并能被 `snapshot` 正确回放。 |

---

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| **S1** | `apps/server/src/playhouse.ts:188-196` | **`deletePlay` 遗漏清理 `this.limiters` 缓存**<br>删除剧目时销毁了 `runtimes` 和客户端集合，但未删除 `this.limiters.delete(playId)`，存在轻微内存泄露。 | 在 `deletePlay` 方法中补充 `this.limiters.delete(playId)`。 |
| **S2** | `apps/server/src/playFiles.ts:20, 180-183` | **`PlayFiles.isBinaryWritable` 白名单前缀对 `sprites/` 校验过宽**<br>`BINARY_WRITE_PREFIXES` 包含 `"assets/sprites/"`，匹配了 `assets/sprites/foo.png`（缺少角色子目录）。而在 `store.listAssets()` 中，sprites 根目录下的文件会被忽略，造成孤儿文件。 | 将前缀约束细化为三段结构，或在 `isBinaryWritable` 中对 `sprites/` 强制要求至少包含两级路径（`assets/sprites/<charId>/<expression>.<ext>`）。 |
| **S3** | `apps/server/src/workshopAssets.ts:203, 250-253` | **`autoNeutral` 自动补定妆照时的 Prompt 语义冲突**<br>`ensureNeutral` 递归调用时直接透传了本次差分的原始 prompt（如 "crying bitterly, tears streaming down"），拼上后缀后变成 "crying bitterly..., neutral expression..."，存在提示词冲突。 | 自动定妆时过滤或覆盖掉强烈的表情描述词，使用角色基础外貌特征作为定妆照 prompt。 |
| **S4** | `apps/server/src/workshopAssets.ts:134-135` | **`assertCanvas` 对未知图片尺寸放行而非断言**<br>当遇到未识别格式或损坏头部的图片导致 `sizeOfImage` 返回 `null` 时，当前逻辑直接放行。 | 增加 warning 日志记录，避免未知的静默异常流过校验。 |

---

## 非阻塞问题（备忘）

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| **N1** | `apps/server/src/playFiles.ts:151` | **`writeBinary` 未使用 tmp+rename 原子写入**<br>直接 `writeFile` 在进程异常崩溃时可能在磁盘留下半截损坏图片文件。 | 建议在后续迭代中参考 `ImageAssets` 的写入模式改造为原子写入。 |
| **N2** | `apps/server/src/playFiles.ts:140-153` | **缺少 Magic Number 真实文件类型核验**<br>仅通过后缀名判断文件类型，若传入非图像字节可能被落盘。 | 可结合已有的 `sizeOfImage` 在落盘前校验文件头魔数。 |
| **N3** | `apps/server/src/workshopAssets.ts:115-117` | **缺乏素材来源溯源（Provenance）标记**<br>工坊生成的图与用户手动导入的图在同名覆盖时无法区分，覆盖不可逆。 | 计划已知取舍。后续建议引入 `.provenance.json` 清单管理人工资产与生成资产。 |

---

## 针对用户关切重点的专门检视

1. **画幅与 `assertCanvas`**：
   - 决策非常务实。flow2api 的静默降级是其固有特性，立绘 9:16（768x1376）与 Galgame 现代竖版构图相契合。在落盘前通过读取 IHDR/SOF0/VP8 尺寸计算实际画幅比，不符即抛错阻断，有效避免了坏图污染 git 历史和舞台表现。
2. **并发/限流（Limiter）**：
   - `Limiter` 的槽位直接转让（`next.grant()`）彻底杜绝了微任务间隙插队超发现象；
   - 挂在 `PlayHouse` 级别并以 `playId` 隔离是保证 reload 时复用的 `WorkshopSession` 与新 `ImageAssets` 闸门不裂开的关键基石，设计完全成立。
3. **落盘通道**：
   - `PlayFiles.writeBinary` 保持了工坊读写面向用户的白名单收敛，`normalizePath` 与 `startsWith` 防逃逸双保险有效。
4. **角色一致性**：
   - neutral 垫图、已有其它差分却缺 neutral 时的报错提示逻辑严密，杜绝了静默换脸风险。

---

## 准入结论

**结论**：`不准入`

**说明**：核心架构与大部分逻辑非常扎实，但存在 3 处阻塞问题（B1: 自动生成 neutral 漏广播上屏、B2: 并发立绘补写 play.json 存在丢失更新竞态、B3: 错误分支已生成图片被随后的 snapshot 抹除），须修复后重新检视。

---

## 修复记录（2026-09-29 第二轮）

检视报告针对的是**表情面板与抠底落地之前**的代码；下列问题在新代码中复核后依然成立，已全部修复。
每条修复都配了**能证明它真的被覆盖**的用例——先把修复撤掉、用例必须红，再装回去。

| ID | 修复 | 落点 | 回归用例 |
| --- | --- | --- | --- |
| **B1** | `ensureNeutral` 原来只回一个 `true` 标记，自动补出的定妆照对象被丢弃，压根没进 `onAsset` 广播——用户花钱出的定妆照在气泡和灯箱里根本看不见。改为返回资产本身，`runSingle` 返回 `[自动定妆照, 用户点名的差分]`，工具层 `for (const asset of assets) deps.onAsset(asset)` 自然把两张都广播出去 | `workshopAssets.ts` `ensureNeutral`/`runSingle` | `差分自动先定妆照` 断言返回两条且顺序正确 |
| **B2** | `mapSprite` 的 read-modify-write 没有任何串行化。一次对话里模型并发调两次 `generate_asset`（同角色两个差分），两条各自读到旧 `play.json`，后写的把先写的映射整个覆盖——用户看到的是「刚出的表情在角色卡里消失了」。加 Promise 链排队锁；锁本身不把失败传染给后续排队者，但调用方仍能看见自己那次写失败 | `workshopAssets.ts` `mapSprite` | `并发出两个差分`：撤掉锁 → 红（`smile` 丢失），装回 → 绿 |
| **B3** | 错误分支只发 `workshop_error` 瞬态消息、不往 `threads` 落任何东西，而收束后必然执行的 `snapshot()` 会下发 `workshop_history`，前端收到即清空 `pendingAssets`——已出的图闪一下就没，刷新后连闪的资格都没有。改为：有图时往 `threads` 追加一条带图的中断说明，让图随 history 一起持久化重放 | `workshopSession.ts` catch 分支 | `半途失败：已出的图必须落进线程历史`：撤掉修复 → 红，装回 → 绿 |
| **S1** | `deletePlay` 漏清 `limiters` 缓存，删剧目后限流闸门常驻（轻微内存泄露） | `playhouse.ts` | 行为无变化，随代码审查修正 |
| **S3** | 自动补定妆照时直接透传了本次差分的 prompt，会变成「哭得很凶但表情中性」的自相矛盾指令。改为前置一条中性描述压住表情词，角色外观描述留在后面 | `workshopAssets.ts` `ensureNeutral` | 由既有定妆照用例覆盖 |
| **S4** | `assertCanvas` 读不出尺寸时静默放行。改为放行但打 warn 日志，格式没识别属于我们没覆盖到的情况，留痕好排查（不硬失败——后面 sprite 还要过一遍解码，真坏了会在这里炸） | `workshopAssets.ts` `assertCanvas` | 行为无变化，仅补日志 |

### 顺带修掉的一个真 bug（非检视项）

`ImageAssets.preload` 是 fire-and-forget 落 manifest 的（预发射不能被磁盘写阻塞，这是对的），
但 `test/image.test.ts` 里用 `setTimeout(10)` 去等它——根目录 `pnpm test` 并行跑时必红，单跑又必绿。
**这不是 flaky，是被 sleep 掩盖的真竞态**：preload 返回时 manifest 还没进盘，此刻进程被杀会丢掉这个条目
（图在盘上但没有索引，等于孤儿文件）。给 `ImageAssets` 补了 `flush()`，用例改为显式等落盘。
根目录连续三轮 `pnpm test` 全绿。

### 未采纳的检视建议

- **N1 `writeBinary` 未用 tmp+rename**：属实，但 `assets/` 是用户可见的手工资产目录，写坏一次的代价远小于
  引入临时文件管理复杂度；抠底后的 PNG 落盘前已经在内存里解码过一次。此项记为备忘。
- **N2 魔数校验**：`assertCanvas` 已按真实格式解析尺寸，读不出头部的图本来就过不了抠底/落盘。
- **N3 provenance 清单**：上一轮已明确取舍——走「覆盖前大声告知」，不引入额外清单文件。
- **S2 `sprites/` 前缀过宽**：属实但当前不可达——`resolveSprite` 强制差分路径为 `assets/sprites/<charId>/<stem>`，
  角色 id 还要过 play.json 成员校验。记为备忘，不动白名单。

### 准入结论（第二轮）

**准入。** 3 处阻塞问题已修并各自有可证伪的回归用例；4 条建议中 3 条已修、1 条（S2）经核实当前不可达已记为备忘。
