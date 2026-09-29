# 检视报告：P5 生图管线（stage-ai-mvp）

## 概要

本轮检视针对 P5 生图管线的全套代码改动（包含协议层、服务端 cpa 生图客户端与资产管理层、编排器预发射拦截、HTTP 静态路由、前端生成资产台账与骨架淡入渲染等）。整体架构设计清晰，文字先行、静态素材优先、sha1 内容寻址缓存和预解码淡入机制契合计划规范；但在重连与降级边界上存在**骨架占位永久停留（死锁于 Shimmer 状态）**的阻塞性缺陷，此外在并发去重与信号量控制上存在若干健壮性建议。准入结论为**不准入**。

## 需求对齐

检视代码与计划文档（`docs/features/260928-stage-ai-mvp/260928-stage-ai-mvp.plan.md` §D6 及 P5 阶段要求）对照情况如下：

- **提前发射与文字先行**：`<preload_asset>` 由编排器在后台异步发起，不阻塞 DSL 事件流与打字机演出；前端在未就绪时以骨架 shimmer 占位，台词照常推进，满足要求。
- **静态素材优先**：编排器在发起前先排查 `assets/backgrounds` 与 `assets/cg`；前端解析索引也优先查找静态文件，满足要求。
- **素材复用**：以 `sha1(type + "\0" + prompt)` 内容寻址落盘，串行生成和重启重放可有效复用，满足要求。
- **降级与骨架超时**：规范明文要求「**骨架/模糊占位禁止永久停留（超时即走降级）**」。实测发现：当发生**断线重连/刷新**（历史 events 重放）、或**服务端关闭生图**（`STAGE_IMAGE_ENABLED=false`）、或**生图服务异常死锁**时，前端无任何超时兜底与重放过滤，会导致舞台永久陷入骨架闪烁态，与规范要求不符。

---

## 阻塞问题

Must fix before admission.

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| BLK-01 | `apps/web/src/stage/director.ts:89-92`<br>`apps/web/src/stage/StageTheater.tsx:85-87`<br>`apps/server/src/playhouse.ts:136` | **骨架占位在历史重放、生图未启用或单图异常时永久停留（Shimmer 假死）**<br>1. 客户端完全没有超时守卫计时器，完全依赖外部调用 `settleAssets` 清理 `pending` 字典。<br>2. 页面刷新或重连时（`mode === "continue"`），历史 events 会被重放，包含历史上的 `<preload_asset id="x">`，导致 `visual.pending["x"]` 被重新置为 true。若该资产在历史上曾生成失败（或在重连前已广播过 `asset_failed`/`asset_ready`，因瞬态消息不进重放缓冲），客户端重连后永远无法收到通知，舞台将永久显示骨架 shimmer 动画，无法回退到纯色氛围背景。<br>3. 当服务端 `STAGE_IMAGE_ENABLED=false` 时，`playhouse.preloadAsset` 命中 `if (!runtime?.images) return;` 静默退出，既不发 ready 也不发 failed；前端却照常将 `preload` cue 放入 `pending`，同样造成永久骨架。<br>4. 服务端超时高达 150 秒，若网关死锁或断网，前端用户需面对长达 2.5 分钟的骨架 shimmer。 | 1. **客户端增加超时降级兜底**：在 `director` 或 `StageScreen` 中维护定时器（如 30–45s），超时未到货自动从 `pending` 移除并告警回退。<br>2. **历史重放过滤**：在重连快进历史事件时，对于不在 `hello.assets`（manifest）中的历史 preload，不要将其作为活跃状态压入 `visual.pending`。<br>3. **服务端关闭时显式失败**：`playhouse.preloadAsset` 在 `!runtime?.images` 时向客户端广播 `{ type: "asset_failed", id, message: "生图未启用" }`，避免前端死等。 |

---

## 建议修改

Should fix；不影响基本通路但强烈建议在合并前或紧随其后修复。

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| SUG-01 | `apps/server/src/imageAssets.ts:29-30, 71-78, 84-95` | **相同 Prompt 并发未在飞去重，且排队获取锁后缺失二次存在性检查（Double-Checked Locking 遗漏）**<br>1. `inflight` 的 Key 仅为 `id`，而非内容指纹 `sha1(type + prompt)`。若剧作家短时间内为不同 id 发射了相同 prompt 的生图（单图需 15–30s），两个请求会并发进入 `run` 并分别排队调用 `gen.generate`。<br>2. 在 `run` 中，执行 `await this.acquire()` 被唤醒后，未再次检查 `if (existsSync(target))`。导致排队等待相同目标文件的后续请求在获取锁后，仍会重复调用一次生图 API，重复消耗模型配额并覆盖目标文件。 | 1. `inflight` 去重改以内容指纹 `fileKey`（或直接使用生成的 target 文件名）为键；<br>2. 在 `await this.acquire()` 返回后，增加第二次 `if (!existsSync(target))` 判定，已有文件直接跳过生成并释放锁。 |
| SUG-02 | `apps/server/src/imageAssets.ts:107-120` | **并发闸门（信号量）存在微任务时序漏洞与插队竞争**<br>`release()` 实现了 `this.running -= 1` 后唤醒 `queue.shift()?.()`。在被唤醒的 waiter 执行 `this.running += 1` 之前的微任务间隙中，如果有新请求调用 `acquire()`，由于 `running < concurrency` 会直接插队执行；随后 waiter 也执行加 1，导致并发数短时突破 `concurrency` 阈值。 | 采用标准的 Semaphore 槽位直接交接机制：`release()` 时若 `queue.length > 0`，直接触发 `queue.shift()!()`（槽位转让，`running` 保持不变）；仅在队列为空时才将 `running` 减 1。`acquire()` 判定改为 `running < concurrency && queue.length === 0`。 |
| SUG-03 | `apps/web/src/stage/generatedAssets.ts:37-45`<br>`apps/web/src/stage/assets.ts:38` | **预解码失败处理与代码注释矛盾**<br>代码注释称「生图解码失败，交给 img 自身重试」，但实现中在 `!ok` 时直接 `return;`，使对应资产的 `ready` 永久为 `false`。而在 `buildAssetIndex` 中，非 ready 资产返回 `null`，导致舞台根本不会挂载 `<img>` 标签，所谓的「自身重试」实际上变成了静默降级为纯色背景，用户与 DOM 均无感知。 | 若确实希望原生 `<img>` 尝试加载，应将 `ready` 标记为 true 让 DOM 挂载标签；若确定解码失败属于不可恢复异常，应派发失败事件并显示错误告警条。 |

---

## 非阻塞问题

Nice to have；记录备忘。

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| MIN-01 | `apps/server/src/imageAssets.ts:138` | **manifest.json 未使用原子写盘**<br>`save()` 中直接使用 `writeFile` 覆盖写入 `manifest.json`。若高频保存中途遇到进程被终止，可能产生残缺的 JSON 文件导致重启解析失败。 | 参照图片落盘逻辑，使用 `.tmp` + `rename` 进行原子落盘。 |
| MIN-02 | `apps/server/src/imageAssets.ts:82`<br>`apps/server/src/http.ts:101-104` | **图片后缀名与 MIME 类型硬编码为 `.jpg` / `image/jpeg`**<br>当前全链路强绑定 `.jpg`，若未来接入返回 PNG/WebP 的其他生图模型，静态路由与缓存扩展名需要修改。 | 可在 `GeneratedAsset` 或 manifest 中记录实际文件扩展名，静态路由根据扩展名映射 MIME。 |

---

## 准入结论

**结论**：`不准入`

**说明**：代码整体架构良好，核心通路完整且有针对性单测；但存在阻塞性问题 **BLK-01**（重连历史重放、生图未启用或长超时场景下骨架占位永久停留，直接违反 D6 核心铁律），须完成超时兜底与重连过滤修复后再行准入。
