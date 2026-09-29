# 检视报告：P5 生图管线（Round 2 复检）

## 概要

本轮复检针对 P5 生图管线在首轮检视中发现的问题修复进行全面核验（涵盖客户端骨架占位超时守卫、重连与未启用生图时的状态解脱、按内容指纹在飞去重、信号量槽位无缝交接、解码异常平滑降级与 manifest 原子写盘等）。经核查，上一轮的阻塞问题（BLK-01）与三项建议修改（SUG-01、SUG-02、SUG-03）、一项非阻塞修改（MIN-01）均已完整且严谨地修复，针对性新增单测（并发去重、并发闸门峰值上限）全部通过，全链路符合 D6 生图管线与铁律规范。准入结论为**准入**。

## 需求对齐

复检各项修复与规范（`docs/features/260928-stage-ai-mvp/260928-stage-ai-mvp.plan.md` §D6、§6.2 及 AGENTS.md 铁律）完全对齐：

1. **骨架禁止永久停留（BLK-01 已彻底解决）**：
   - 客户端 `apps/web/src/stage/director.ts` 引入 `PENDING_TTL_MS = 45_000` 并以 5 秒周期轮询清理过期占位，到点自动回退至氛围底色；
   - 服务端 `apps/server/src/playhouse.ts` 在 `!runtime?.images`（未启用生图）时显式广播 `{ type: "asset_failed", id, message: "生图未启用" }`，前端收到后立即摘除占位并呈现警告条；
   - 重连断线窗口下即便丢失瞬态通知，45 秒超时兜底亦能防止舞台永久处于 Shimmer 闪烁态；对于已成功生成的资产，`hello.assets` 保证在重连初期即刻预加载并挂载，不闪烁骨架。
2. **内容指纹在飞去重与双重检查锁（SUG-01 已彻底解决）**：
   - 服务端 `apps/server/src/imageAssets.ts` 统一以 `fileName(type, prompt)`（sha1 哈希）作为文件与在飞生成任务的复用键；
   - `ensure()` 在任何 `await` 之前同步登记 `this.generating`，彻底杜绝并发同描述请求穿透至生成器的空隙；
   - `generate()` 内部在获取并发槽位后执行了二次 `existsSync` 磁盘存在性检查，排队唤醒后已有产物直接复用，不重复消耗模型配额。
3. **并发闸门槽位直接转让（SUG-02 已彻底解决）**：
   - `acquire()` 改为 `this.running < this.concurrency && this.queue.length === 0`，有余位且无人排队时才直通，杜绝排队等待期间被新请求插队；
   - `release()` 在队列非空时直接唤醒等待者并保持 `running` 计数不变（槽位所有权直接交接），彻底规避微任务间隙导致的瞬时超发。
4. **预解码容错处理（SUG-03 已彻底解决）**：
   - `apps/web/src/stage/generatedAssets.ts` 中 `decode()` 无论成功与否，均在完成时将 `ready` 置为 `true`，把最终展示判定交给原生 `<img>` 加载器；即使预解码异常也不会因 `ready === false` 死锁在骨架状态。
5. **manifest 原子落盘（MIN-01 已彻底解决）**：
   - `save()` 采用 `.tmp` 随机临时文件写入后原子 `rename`，消除了进程被异常终止时残留损坏 JSON 的隐患。

---

## 阻塞问题

无。

---

## 建议修改

无。

---

## 非阻塞问题

Nice to have；记录备忘。

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| MIN-02 | `apps/server/src/imageAssets.ts:29`<br>`apps/server/src/http.ts:101-104` | **图片后缀名与 MIME 类型硬编码为 `.jpg` / `image/jpeg`**<br>首轮记录备忘，当前两种接入模型均返回 JPEG 格式。目前保持未修符合实用主义原则，后续若接入 PNG/WebP 等模型再引入动态扩展名推导。 | 保持跟踪。未来支持多模型输出格式时，在 `GeneratedAsset` 或 manifest 中记录扩展名并动态映射 MIME 类型。 |
| MIN-03 | `apps/web/src/stage/director.ts:225-233` | **`settleAssets` 清理无匹配键时产生空置对象重绘**<br>`settleAssets` 中如果传入的 `ids` 均不在 `prev.pending` 中，仍会执行解构复制并返回新引用 `{ ...prev, pending }`，触发一次不必要的 React 组件重渲染。 | （可选）在删除前检查 `ids.some(id => id in prev.pending)`，若无匹配项则直接返回 `prev`。 |

---

## 准入结论

**结论**：`准入`

**说明**：上一轮发现的阻塞问题及架构/并发风险已全部彻底修复，代码设计清晰、状态机流转严密，新增针对性测试（内容指纹并发去重、并发闸门峰值控制）已全部固化且通过。符合准入标准，可进入下一阶段。
