# 批判报告：工坊生图能力 + 就绪门放开

日期：2026-09-29
对象：`260929-workshop-assets.plan.md`
代码基线：`.worktrees/workshop-assets`（HEAD `feat/workshop-assets`）

结论先行：计划的**方向**是对的（工坊能生图、就绪门不该用素材数量卡人），但**五个已确认决策里有四个在当前代码下会引入语义倒挂或数据损坏**，其中 6 条属于「不改会出事」级别。核心发现是：计划把三个本该独立的东西（素材落点优先级、角色身份锚、闸门归属）各自压进了一个已有概念里，代价是铁律在实现层面被绕过而不是被实现。

---

## 阻塞问题（6 条）

### B1. 落 `assets/` 直接违反 D6 铁律②「静态素材优先于生成资产」，且违反方式不可检测

**问题是什么**
计划 §3.3 让工坊生图写 `assets/backgrounds/<name>.jpg` / `assets/sprites/<charId>/<expr>.jpg`，与用户导入素材同一目录、同一命名空间。而铁律②是「用户导入的是最终资产，生图只补缺不覆盖」。

关键在于这个倒挂不是理论上的。`orchestrator.ts:1173-1182`：

```ts
const kind = event.type === "bg" ? "backgrounds" : "cg";
const owned = (this.opts.assets?.[kind] ?? []).some(
  (file) => file.replace(/\.\w+$/, "") === event.id,
);
if (!owned) this.opts.onPreloadAsset?.(event.type, event.prompt, event.id);
```

`assets` 就是 `store.listAssets()`，扫描的就是 `assets/` 磁盘目录。所以工坊写完一张图进 `assets/backgrounds/x.jpg` 之后，playwriter 后续对 id `x` 的 `preload_asset` 会被 `owned` 判定为「已有同名导入素材」而**静默跳过预发射**——这个短路逻辑本身是对的（省配额），但它现在对「用户导入的最终资产」和「AI 生成的图」一视同仁。后果链条是：

1. 用户在素材页导入了一张精心挑的 `bg_rooftop_dusk.jpg`。
2. 用户在工坊说「屋顶的背景再画一张更好看的」。
3. 计划 §3.3 的「同 id 再次生成会覆盖旧图」直接盖掉用户导入的最终资产。
4. 铁律②「生图不覆盖」被彻底击穿，且 `WorkshopAssets` **没有任何手段区分**这个已存在的文件是用户导入的还是上一次 AI 生成的——目录里没有 provenance 记录，覆盖时无法判断是否该拒绝。
5. 覆盖后 `replaced: true` 只在工具返回文本里告诉模型「已替换」，用户看不到、也没有撤销（计划风险表承认「生图产物不可撤销」，但没意识到丢的可能是**用户自己的图**，那是不可再生的手工资产）。

**为什么是问题**
这不是「优先级语义」这种抽象说法——是**用户手工资产被静默销毁且不可恢复**。铁律②的存在意义就是防止这个，现在它被落点选择从实现层抽掉了。

**具体怎么改（三选一，按推荐排序）**

- **推荐：目录不动，加 provenance 清单。** 保持落 `assets/`，但新增 `assets/.provenance.json`（随 assets 进 git、随 exportZip 走），记录每个 AI 生成文件的 `{ path, prompt, origin: "generated", createdAt, backend }`；用户导入的文件不在表里 = 视为 `origin: "user"`。`WorkshopAssets` 落盘前先查表：**目标文件的 origin 是 `user` 就直接拒绝并回给模型**（"这个文件是你导入的最终资产，我不能覆盖；换个 id 或你先删掉它"）。这把铁律②从「靠目录约定」变成「靠显式记录」，也顺带给将来「AI 图 vs 人工图」的混合管理留了位置。
- **备选：落在 `assets/generated/` 子树。** 物理隔离两类来源，`listAssets`/`buildAssetIndex`/`ASSET_KINDS` 各加一处，静态优先顺序由目录结构天然保证。代价是要动 `http.ts:25` 的白名单、`store.ts` 的 `listAssets` 遍历和 `buildAssetIndex` 的四处 `byStem`——改动面比上一条大，但语义最干净，且 `PlayFiles` 现有的 `assets/** 只读` 规则可以顺势改成「`assets/generated/**` 工坊可写、其余只读」，铁律②的文本也不用改。
- **不要做的**：只加一句「工坊图优先级低于用户导入图」的提示词约束。工具层是唯一的强制点，提示词层挡不住一次 `writeFile`。

---

### B2. `neutral` 被用户删掉后，垫图会静默重建，角色身份漂移——已画的所有差分全部作废

**问题是什么**
计划 §3.5 的流程是：`neutral` 存在 → 以它为垫图生成差分；`neutral` 不存在 → **先按本次 prompt 生成 `neutral.jpg`**。这个分支在正常路径下是合理的（没有定妆照就没法保证一致性），但在「用户删了 neutral」这个完全正常的场景下是**破坏性**的。

`neutral` 不是可丢弃的差分，它是这个角色**所有差分的生成条件**。用户在素材页删掉 `neutral.jpg`（或者只删了这一个，或者换了别的文件进来导致排序变化）之后：

- `play.json` 的 `sprites: { neutral: "neutral.jpg", smile: "smile.jpg", angry: "angry.jpg" }` **还指向它**（工坊写 play.json 是手写 JSON，删素材不会改这张映射表）。
- `assets.ts:46-52` 的 `sprite(charId, "neutral")` 走 `mapped` 分支返回 `/assets/sprites/mio/neutral.jpg` → 404 → 舞台上一张裂图。
- 下次工坊要补 `angry` 差分 → 发现 neutral 不存在 → **按「生一张普通立绘」重新生成 neutral** → 新图和旧的 `smile`/`angry` 不是同一个人。
- 用户拿到的是：一张新的 neutral + 一组长相完全不同的旧差分。角色在演出中会在表情之间「换脸」，而且是静默的。

**为什么是问题**
`store.ts:110-115` 的 `Readiness.characterSprites` 要求 `Object.values(c.sprites).every(file => existsSync(...))`——neutral 缺失会让 `characterSprites` 直接变 false。计划 §2 放开就绪门后，这个信号从「阻断」降级为「建议」，用户根本不会知道发生了什么，等看到演出里换脸才会发现。角色身份一致性是这个项目立绘生图存在的**唯一理由**（D6 铁律① 明确说 sprite 差分不做生图就是「一致性不足」），而这个方案在成本最高（8 次生成）的地方开了个静默崩口。

**具体怎么改**
1. **`neutral` 必须是 `play.json` 里每个角色的强制项，且不可删。** `WorkshopAssets` 生成 sprite 时先校验 `c.sprites.neutral` 存在且文件在盘；不在 → 明确报错回给模型，不要「先生成一张」。
2. **provenance 清单（承接 B1）顺便记录 `role: "identity-anchor"`。** 删 neutral 前检查清单，若是锚点就拒绝，或至少要连带列出「同角色其他差分也会随之失配」。
3. **`sprite()` 的 fallback 现在是静默给错图**（`assets.ts:50-51`：映射缺失就 `files[0]`）。一旦 `neutral` 文件缺失但映射还在，`files[0]` 兜底只在「映射整个为空」时生效，映射存在但文件被删的情况直接 404。至少在 `buildAssetIndex` 里对「映射指向的文件不在 `assets` 清单里」的情况返回 `null`（走角色不上台）而不是返回一个 404 URL——这比裂图好。
4. 素材页删 `neutral` 之前，UI 上给一个确认：「这是该角色的定妆照，其他差分都靠它保持一致，删除后重新生成的定妆照会与现有差分不一致」。

---

### B3. §3.2 的「每剧目一个 Limiter」与 §3.7 的「reload 复用同一 WorkshopSession」直接冲突，reload 一次并发就翻倍

**问题是什么**
计划 §3.2 说：`PlayHouse` 每个剧目建**一个** `Limiter`，同时交给 `ImageAssets` 与 `WorkshopAssets`，理由是「各自建闸门会让实际并发翻倍」。

但 §3.7 与工坊铁律④说：runtime 重建时**复用同一 `WorkshopSession` 实例**（线程现场与进行中的对话不能被自己打断）。而 §5 改动清单把 `WorkshopAssets` 放在 `playhouse.ts` 的 runtime 构造里：

```ts
// playhouse.ts createRuntime 内部
const images = this.imageGen ? new ImageAssets(play.id, store, this.imageGen, this.config.image.concurrency) : undefined;
const workshop = new WorkshopSession({ store, streamFn, model, ..., onFilesChanged: () => this.reloadAfterWorkshopWrite(play.id) });
```

`WorkshopSession` 是在 `createRuntime` 里 `new` 的，它的 `this.tools` 在构造函数里闭包捕获了 `this.files` 和 `deps`（`workshopSession.ts:46-50`）。reload 时旧 `WorkshopSession` 被复用，它的 tools 里闭包着的 `WorkshopAssets` 仍然是**上一次 runtime 的那个实例**——如果 `Limiter` 是在 `createRuntime` 里随 `ImageAssets` 一起 `new Limiter(...)` 的，那么：

- 存活的 `WorkshopAssets` 持有 **Limiter-A**；
- reload 后的新 `ImageAssets` 拿到 **Limiter-B**；
- **两把闸门，实际并发 = 4（2+2），正是 §3.2 要避免的那件事**。

而且这个 bug 触发条件是**最频繁的那个动作**：计划 §3.7 自己规定「生图后 `dirtyDuringTurn=true`，收束时 `reloadAfterWorkshopWrite`」。也就是说「工坊生了一张图」→ reload → 闸门从一把裂成两把 → 下一张图在 4 并发下跑 → 再 reload → ……单调发散。用户每生一张图，并发上限就翻一倍。

**为什么是问题**
§3.2 存在的唯一理由就是防止并发翻倍，而 §3.7 的 reload 路径在结构上必然让它翻倍。这不是边界情况，是**每次生图后的常态**。

**具体怎么改**
把 `Limiter` 的所有权从 `createRuntime` 提到 `PlayHouse` 自身，按 `playId` 存一张 map：

```ts
// PlayHouse 字段（构造时建立，跨 runtime 存活）
private readonly limiters = new Map<string, Limiter>();

private limiterFor(playId: string): Limiter {
  let l = this.limiters.get(playId);
  if (!l) { l = new Limiter(this.config.image.concurrency, MAX_QUEUE); this.limiters.set(playId, l); }
  return l;
}
```

`buildRuntime` 与 `removePlay` 里分别取/删。`ImageAssets` 与 `WorkshopAssets` 都接收 `limiterFor(playId)`。**验收要加一条测试**：连续两次 `reload` 之后断言 `ImageAssets` 与 `WorkshopAssets` 拿到的是同一个 `Limiter` 实例（`toBe`），否则这个 bug 会静默复发。

同样的道理适用于 `ImageBackend` 实例：计划说「共用同一个后端实例」是对的，但要显式说明它由 `PlayHouse` 构造期持有（现状 `this.imageGen = createImageGen(config)` 已经是这样，只需把类型换成 `ImageBackend | null`），不要在 `createRuntime` 里造。

---

### B4. 共用闸门 + 就绪门放开 = preload_asset 从「锦上添花」变成承重结构，而它被一个真人节奏的消费者挤在队尾

**问题是什么**
单看 §3.2（共闸门）没问题；单看就绪门放开也没问题。放在一起就有问题。

铁律①说 preload 只后台发起不 await，所以「共闸门不会卡住播放」——这在**有静态素材兜底**的前提下成立：图没到，`byStem` 命中静态文件，舞台正常。计划 §2 放开就绪门后，**静态素材可能一张都没有**，`preload_asset` 成了剧目唯一的背景来源。这时它就是承重结构。

而闸门是共享的，`STAGE_IMAGE_CONCURRENCY` 默认 **2**（`config.ts:90-94`），计划 §3.1 的示例配置里也是 2。队列里现在有两个人在抢：

- playwriter：提示词要求「提前 3–5 句发射」，一波预发射就是 3–5 张；
- 工坊：用户在聊天框里说「画 3 个表情」，模型很可能**在一个 tool batch 里并发调 3 次 `generate_asset`**（pi 支持并行工具调用），或者按 §3.5 的依赖链「先生成 neutral 再生成 3 个差分」占着槽位串行跑。

单图 10–30s。工坊一口气 3 张 × 25s = 75s 独占 2 个槽位，这期间 playwriter 预发射全部排队。用户视角：「我正看着澪在教室里说话，背景刷不出来」——而且他什么都没做错，只是刚才在工坊里说了句话。

更糟的是 `MAX_QUEUE = 12`（`imageAssets.ts:25`）现在也是共享的。工坊单轮就能把队列推过 12，之后 playwriter 的预发射直接吃 `生图队列已满` → `asset_failed` → 骨架被摘掉。错误文案「生图队列已满」在用户那里完全没有意义。

**为什么是问题**
铁律①的原文是「预发射**绝不能卡住播放**」。共闸门确实没让 preload 变成 await，但放开就绪门之后，**preload 变成了播放的输入**——它拿不到槽位就等于播放缺素材。「不 await」这条字面约束守住了，「不能卡住播放」这条意图没守住。

**具体怎么改（三选一）**
- **推荐：闸门共享，但按优先级分池。** `Limiter` 加一个 `priority` 入参，或更简单——拆成两个闸门但**总闸门在 PlayHouse 层**：`WorkshopAssets` 拿 `max=1` 的分池 + 一个「全局最多 N 个在飞」的硬上限；`ImageAssets` 保留 `max=concurrency` 且**不排在工坊之后**（工坊任务启动时若 `ImageAssets` 有在飞，延后开工）。这样并发仍然受控（D6 铁律⑥ 的目的没丢），但真人节奏的工坊让位给正在播出的剧。
- **更简单：工坊生图完全串行 + 独占窗口。** `WorkshopAssets` 的 `generate` 强制串行（`max=1` 的内部队列），并且**在该剧目的 orchestrator 处于 engaged 状态时不发起**（`orchestrator.engaged` 已经是现成的只读 getter）。用户正在看戏时不生图，戏停了再生——语义清晰，代价是工坊在演出中看起来「不干活」，需要在 UI 上说一句「演出进行中，出图已排队」。
- **最低成本止血：只做这条。** `MAX_QUEUE` 拆成两个计数，工坊与预发射各自有独立配额，且 `asset_failed` 的文案在预发射路径上换成「背景图排队超时，先用氛围色顶上」而不是内部术语。这一条不解决争抢，但至少让失败可读。

无论选哪条，**验收标准要写成可测的**：`STAGE_IMAGE_CONCURRENCY=2` 下，工坊挂 3 张生图任务的同时让 playwriter 预发射一张，断言预发射在 `max(单图耗时 × 2)` 内拿到槽位。

---

### B5. 放开就绪门后，模型「引用了但没预发射」会得到永久白底——`PENDING_TTL_MS` 兜底覆盖不到这条路径

**问题是什么**
这条是我读代码后最担心的一个，它比「15–30s 延迟」严重得多，而且**计划完全没有覆盖**。

顺着链路走一遍零素材剧目的开演：

1. `Readiness.ready = premise !== ""`（`store.ts:117-121` 改造后），`TitleView.tsx:60` 的 `disabled={!readiness?.ready` 变绿 → 可开演。
2. playwriter 起手，`buildSystemPrompt` 的 `assetSection`（`prompt.ts:37-42`）**整段塌陷**——四行都是 `xx.length > 0 ? ... : ""`，一个素材都没有时这 12 行输出 0 字符。模型拿到的 A 区里「可用背景 bg / 已有插图 cg / 可用音乐 bgm」这些锚点**全部消失**。
3. 唯一指导生图的是 `prompt.ts:77-87` 的「缺素材时自己画」小节，而它的措辞是「**可用清单里没有**、但剧情需要的背景」——**预设了清单存在**。模型现在看到的是「连清单都没有」，更容易直接脑补一个 id 写进 `<scene bg="classroom">` 而不发 `preload_asset`（它有样例：示例里 `<scene bg="bg_classroom_dusk" .../>   ← 3–5 句台词之后才引用` 紧跟在 preload 后面，格式上很像「先写 scene 再说」）。
4. 客户端 `script.ts:64-65` 只在**收到 `preload_asset` 事件时**才 `push({ kind: "preload", id, type })`；`director.ts:103-106` 只从这个 cue 填 `visual.pending`。
5. `StageTheater.tsx:87`：`const bgPending = !bgUrl && !!visual.bg && visual.pending[visual.bg]?.type === "bg"`。模型没预发射 → `pending` 里没有这个 key → `bgPending === false` → **不显示骨架，直接落 `theater-bg-fallback`**。
6. `app.css:314` + `.theater` 容器 `background: linear-gradient(180deg, #f2efe9, #e8e4dc)` —— 米白渐变。没有任何东西会到达，**这个 id 在整个 session 里永远不会变成图**。`PENDING_TTL_MS=45s` 摘的是「已登记 pending 但 45s 没到货」的骨架，它对「压根没登记」零作用。

所以真实结局不是「一整幕在白底上飘字然后好了」，而是「**一整幕、乃至于后面几十幕，都在米白渐变上飘字，因为模型从来没生过这张图**」。而且这个状态没有任何 UI 提示、没有 `asset_failed`、日志里干干净净。

**为什么是问题**
这正是铁律⑤「骨架禁止永久停留」想消灭的那类状态，但走的是它没覆盖的旁路。零素材剧目是**就绪门放开后唯一的新常态**——旧门禁下 `background: true` 保证至少有一张静态背景，玩家最坏看到「没生成出来但有底图」；新门禁下零张底图是合法起点。

**具体怎么改**
1. **`buildSystemPrompt` 在零素材时不能塌陷。** 最小改法：`assetSection` 换成「# 可用背景 bg\n（暂无导入素材。缺背景请用 preload_asset 先发射，3–5 句后再在 scene 里引用；premise 未提及的场景请先写一句旁白过渡。）」，把「清单为空」这个事实**显式告诉模型**，而不是让它自己从沉默里推断。
2. **客户端兜底：`visual.bg` 指向的 id 既没解析出 URL、也不在 `pending` 里时，挂一个 `preload` 记录。** 这是根治——不管模型发没发 `preload_asset`、也不管那个事件是不是在重连窗口里丢了，只要 stage 想用一个没见过的背景 id，就把它记进 `pending`，45s 后 `PENDING_TTL_MS` 至少能摘掉。代价是需要区分「正在飞」和「已经放弃」，但 `settleAssets` 已经在做类似的合并。
3. **服务端兜底（更彻底）：`orchestrator` 解析 `scene` 事件时，若 `bg` 不在 `this.opts.assets` 里也没有对应 `preload` 谱系记录，就用 `bg` 当 prompt 派生一个 `onPreloadAsset` 调用。** 这样「引用即生图」成为不变式，模型漏发 `preload_asset` 只是少了个提前量，而不是完全失败。注意这会削弱「提前 3–5 句」的价值，所以要保留提示词的提前发射写法作为**优化**而非**正确性依赖**。
4. **Stage 侧的持续提示。** 计划 §5 说 TitleView 给「角色可能不上台」加一条 45s 弱提示——那个位置几乎没有用（用户看到就点「开始游戏」了）。真正需要提示的地方是舞台：常驻一个可点掉的状态条，写「背景图生成中…」「本剧目暂无背景素材，可用氛围色」。这跟铁律③「失败/超时一律抛错由调用方降级（氛围背景 + **可点掉的告警条**）」是同一个东西，只是计划只在 TitleView 加了弱提示，在 StageTheater 加零。

---

### B6. `PlayFiles` 与 AGENTS.md 工坊铁律② 均未被计划修改，规则与实现直接矛盾

**问题是什么**
`playFiles.ts:38-43`：

```ts
function isEditable(rel: string): boolean {
  if (rel === "play.json") return true;
  if (!rel.startsWith("memory/")) return false;
  return EDITABLE_EXT.has(extOf(rel));
}
```

`assets/**` 走 `READONLY_PREFIXES` 只读可见，`isEditable` 恒 false。`pathOf(rel, "write")` 会对任何 `assets/...` 抛「路径不在工坊可写范围」。AGENTS.md 工坊铁律②原文：「工坊的读写在 `PlayFiles` 白名单内——`play.json` + `memory/**` 的 .md/.json/.txt 可写、**`assets/**` 只读可见**」。

计划 §5 的改动清单里**没有 `playFiles.ts`**，但 §3.3/§3.7 又要求工坊往 `assets/` 写。这意味着实现只有两条路，两条都破坏现状：

- 走 `PlayFiles.write` → 直接抛错，工坊生图根本不工作；
- 让 `WorkshopAssets` 直接 `store.writeAsset()` 绕过 `PlayFiles` → 工坊铁律②的文本从此是假的，而且**白名单层不再是「面向用户的可编辑面」的唯一权威**（`workshopSession.ts:141-148` 的 REST 路径也走 `PlayFiles`），agent 能写的面比人能在浏览器里写的面大，违反这条铁律想保证的「人和 agent 看到同一张脸」。

计划 §5 的「两处缺项逻辑重复」一栏说明作者意识到了重复，但没意识到这条**权限面**的重复。

**为什么是问题**
铁律②的价值不是「今天不让写」，而是「工坊的写权限和用户的写权限是同一个可枚举的白名单」。一旦工坊多出一条旁路，FileBrowser 里不可见的文件被 agent 改了，用户在界面上完全无感（`WorkshopWrite` 只对文本文件设计，`before` 是字符串——**二进制图的 `before` 是什么？** 计划没说。按现状 `write_file` 的实现 `before = await deps.files.read(path)` 是 utf8 解码，2MB 二进制会被解成乱码字符串再 JSON 序列化传给前端。）

**具体怎么改**
1. **走 `PlayFiles` 扩展，而不是绕过。** 在 `playFiles.ts` 加一条精确的写规则（例：`assets/generated/**` 白名单，或 `assets/backgrounds|cg/sprites` + 合法扩展名 + 尺寸上限），并把二进制写与文本写分开：`writeBinary(rel, buffer): Promise<void>`，不进 `WorkshopWrite` 的 `before/after` 文本模型。
2. **同批更新 AGENTS.md 工坊铁律②的文本**，把「`assets/**` 只读可见」改成新事实。否则下一次任何人（包括 agent）读 AGENTS.md 都会被误导。计划的 §5 改动清单漏了这一项。
3. **`WorkshopWrite` 对二进制要么不报、要么报 `{ path, kind: "binary", size }`。** 前端 `useWorkshop.ts:66-70` 的撤销按钮会对二进制调 `saveFile` 写回乱码——必须显式不给撤销。
4. 素材页（`AssetsView`）的「删除」要能看到工坊生成的图（`listAssets` 本来就看得到，无需改动），这样 B1 提到的覆盖风险至少有人工发现渠道。

---

## 建议（非阻塞但建议改）

### S1. `generate_asset` 扁平参数：判别联合可用，TypeBox 1.3.27 确实导出 `Type.Union`
`pi-ai` 的 `Type` 是 `export { Type } from "typebox"`（`node_modules/@earendil-works/pi-ai/dist/index.d.ts:2`），typebox 1.3.27 的 `build/typebox.d.mts` 里明确有 `export { IsUnion, type TUnion, Union }`。所以计划里「不确定 typebox 是否支持」这一条可以直接结案：**支持**。

真正的成本在网关是否接受 `parameters` 顶层的 `anyOf`。建议**先花 10 分钟验证**（拿 cpa 网关打一发带 `anyOf` 的 tool schema），而不是保留扁平参数。判别联合能消掉整类「模型把 `name` 和 `characterId` 一起传」的错误，这正是扁平方案最常见的失败模式。

若网关拒绝，退而求其次的扁平方案也有两条明确的加固：
- **`characterId` 不要正则校验。** 计划 §3.3 的 `^[a-z][a-z0-9_]{0,39}$` 会误伤 `play.json` 里合法存在的 id——`parsePlayConfig`（`packages/core/src/play/config.ts:37-45`）**完全不校验 character id 格式**，而工坊自己写 play.json 时完全可能写 `Koharu` 或 `koharu-2`。正确做法是**从 `play.json` 的 `characters[].id` 取值集合做成员校验**，并在报错里附上现有 id 列表（§3.5 已经有这一步了，但 §3.3 的白名单先拦下来了，两条路径互相遮蔽，模型拿到的是正则错误而不是「角色不存在」）。
- **错误回灌要给出可操作的下一步。** 现在的「缺少 name」是一句死路。改成「kind=background 需要 name（如 bg_rooftop_dusk）；kind=sprite 需要 characterId + expression；当前剧目的角色有：mio, koharu」。pi 的 tool result 是纯文本，模型能读懂；成本是一次往返，收益是不用猜。

### S2. `WorkshopAssets` 缺 target 级 in-flight 去重，且与 `replaced` 判定互为漏洞
计划说「不做 in-flight 去重（缓存键天然是输出路径，且覆盖正是要的能力）」——这个理由把**内容寻址缓存**和**并发写冲突**混为一谈了。`ImageAssets` 的 `generating` map 去重的是**内容指纹**（同描述不重复烧配额），`WorkshopAssets` 需要的是 **target 锁**（同路径不并发写）。两者目的不同。

具体故障：模型在一个 tool batch 里并发调 `generate_asset(kind=background, name="bg_x")` 两次。`STAGE_IMAGE_CONCURRENCY=2` 让两者真的并发跑 → 两份 2MB 都烧了配额 → 两个 `writeFile` 竞态写同一路径 → 最终内容不确定 → 两个气泡各推一张图 → 用户以为生了两张不同的，实则一张随机胜出，而且 `replaced` 标记也是竞态的（两个都可能在 `existsSync` 检查后、写入前通过）。

**建议**：`WorkshopAssets` 加一个 `Map<targetPath, Promise<GeneratedImage>>`（key 是输出路径，不是 prompt），命中就挂同一个 Promise 并在返回文本里注明「与同批请求共用同一次生成」。这不是缓存，是**幂等**。

### S3. `mimeType` 被采集后丢弃，扩展名硬编码 `.jpg`
计划新增的 `GeneratedImage { data, mimeType }` 拿到了 MIME，`WorkshopAssets` 却把文件名写死 `<name>.jpg`。这不是新引入的 bug（`imagegen.ts:53-59,86` 的 `ext: "jpg"|"png"` 在 `imageAssets.ts:128` 就被解构丢掉了，`fileName()` 也写死 `.jpg`），但这次落 `assets/` 让它**第一次产生正确性后果**：

- `store.ts:117` 的 `Readiness.background` 用 `/\.(png|jpe?g|webp)$/i` 过滤目录内容——扩展名不对不影响这个（`.jpg` 匹配得上），但**内容**对不上；
- `http.ts:11-22` 的 MIME 表按扩展名决定 `content-type`。PNG 字节装在 `.jpg` 里 → 服务端发 `image/jpeg`。Chrome/Firefox 对 `<img>` 会嗅探内容所以能显示，**Safari 不嗅探**，会显示裂图。
- 将来 flow2api 返回 WEBP（`imageConfig` 下完全可能）就是全平台裂图。

**建议**：两处都改成 `extOf(mimeType)`，并让 `ImageAssets.fileName()` 把扩展名纳入指纹（`sha1(type + prompt + aspect + ext)`），否则同一个 prompt 先出 png 后出 jpg 会命中同一个旧文件。这和计划 §3.1 已经要改的「指纹扩为 `sha1(type+prompt+画幅)`」是同一次改动，一起做。

### S4. git 体积：真正的成本不是「进不进 git」，是「覆盖重画在 git 历史里不可回收」
计划风险表说「2K 单图约 1–3MB，一张剧目 10 张约 20MB；接受」。这个算术本身对，但低估了两点：

- demo 剧目的实测体积是 **16MB / 16 张**（8 背景 ~0.5–1MB + 8 立绘 ~1.2MB PNG）。10 张 × 3MB 是**下限不是上限**。
- 更关键的是**重画循环**。计划 §7 明确支持「用户直接说重画 neutral」，§3.3 说「同 id 再次生成会覆盖旧图」。git 里每次覆盖 = 一个新 blob，旧 blob **永久留在历史里**（除非 rewrite history，而用户明令禁止 git 的破坏性操作）。用户为了满意重画 5 次一张背景 = 5 × 3MB = 15MB 永久进历史，界面上只看得见最新那张。这个「不可见的历史膨胀」才是不可逆的那部分——它不会因为后来 `git rm` 而消失。

**具体怎么改（按性价比排序）**
1. **写盘前重编码。** 计划从不提这一步，但收益最大：flow2api 的 `imageSize=2k` 出的 master 直接落盘是 ~2MB；重编码到长边 1920 / JPEG q80 大约 250–400KB，**5–8 倍缩减**，客户端 decode 成本也一起降。demo 里的 1.2MB PNG 立绘说明仓库里已经存在同类的未优化文件，这是一个顺手的清理机会。`sharp` 一行 `resize().jpeg({quality:80})` 解决。
2. **`.gitattributes` 对 `plays/*/assets/**` 做压缩**。对已经压缩过的 JPEG/PNG 收益有限（~2%），**不要指望这个**——如果打算靠它省体积，先实测。
3. **接受，但把阈值写进计划**：单个剧目 assets 超过 N MB 时提示用户「这批 AI 素材在 git 里，建议改用网图导入」。这条只是让用户知情，不是解决。

如果做 B1 的 provenance 清单，第 1 条（重编码）应该和它一起进本轮，因为两者都改写盘路径。

### S5. 关于「第三种落点」的直接回答
计划的两个选项（`assets/` vs `media-cache/img/`）其实都不是最优解，因为它们在**「可管理性」和「优先级语义」之间二选一**：

- `assets/` 有管理性和跨机持久（`exportZip` 排除 `media-cache/`，生成图不会跟着剧目包走——这是 §2 选 `assets/` 的真正理由，但计划没写出来），代价是丢了优先级信息；
- `media-cache/img/` 保留优先级（`buildAssetIndex` 的 `byStem` 本来就是「静态优先、生成兜底」），代价是不可管理、不随包走。

**第三种：`assets/` + 稳定命名 + provenance 清单**（B1 的推荐项）。文件名用**目标 id** 而不是内容哈希（`bg_rooftop_dusk.jpg` 而不是 `sha1.jpg`），provenance 清单记录哪些是生成的。这样同时拿到：进 git ✓、随包走 ✓、素材页可管可删 ✓、优先级可判定 ✓、playwriter 的 `owned` 检查仍然有效 ✓。唯一不满足的是内容寻址去重（同描述不同 id 会各出一张），但工坊生图本来就是「一个 id 一张图」的语义，去重价值不大——真要保留，把 prompt 记进清单、生成前查清单即可。

### S6. `MAX_QUEUE` 满了的文案在两条路径上都不可读
`imageAssets.ts:144` 抛 `生图队列已满`。这个字符串今天只在预发射路径出现，用户会在告警条上看到它；共用闸门后它会**因为工坊占满队列**而出现在演出路径上，用户会困惑「我什么都没干怎么就队列满了」。文案要区分发起方：「背景图排队超时，先用氛围色顶上」/「素材队列忙，稍后再试」。

---

## 非阻塞（记录，不必在本轮改）

- **`workshop_asset` 广播到全剧目客户端。** `WorkshopSession.opts.emit` 走 `this.broadcast(play.id, msg)`，舞台视图的 `useStageSocket` 也会收到。`useStageSocket.ts` 只 dispatch `workshop_` 前缀，暂无害。但满屏生图时舞台上会有无谓的 WS 流量，可考虑按连接是否开着工坊面板过滤。
- **420s 硬上限的归属没说清。** 计划 §7 提「提到 420s 硬上限」——是单轮 `runWorkshopTurn` 的上限，还是单次生图的上限？`STAGE_FLOW_TIMEOUT_MS=180000` 和 420s 的关系（后者是否包含前者 × N）需要写明，否则模型连出 3 张必超时。
- **`Readiness` 字段保留但不再 gate，`api.ts` 的 `Readiness` 与 `store.ts` 同步改。** 计划 §5 提到了 `api.ts`，注意 `TitleView.tsx:19-24` 和 `LibraryView.tsx:6-11` 两处 `missing` 逻辑也要改，别只提 `api.ts` 的 `missingItems`。
- **`premise` 的实际取值源有两处**：`store.ts` 的 `readiness()` 读 `play.premise`，`prompt.ts:44` 读 `memory?.premise || play.premise`。工坊如果只改 `memory/always/premise.md` 而没改 `play.json`，就绪门会**仍然红着**（`store.readiness` 不看 memory）。计划说工坊「写 `play.json` 与记忆卡」，需要确认这两处保持同步，否则会出现「工坊说已经写好了但门还是灰的」。
- **`generate_asset` 的 `prompt` 由模型自由撰写。** 没有长度上限的话，一次 10KB 的 prompt 进 `ImageRequest`，指纹、manifest、日志都跟着涨。加个 `maxLength: 2000` 和 `minLength: 10`（顺便挡住模型传空串烧配额）。计划 §3.3 的 `kindPath` 白名单是对的，但四个字符串参数都需要长度上限。
- **`CpaImageGen` 忽略 `references`。** 计划 §3.1 说「cpa 走文生图」。那么在 `STAGE_IMAGE_BACKEND=cpa` 时，**角色一致性完全没有**——工坊每次生成的差分都是不同的人。这个降级必须显式告诉用户和模型（`kind=sprite` 时返回「当前后端不支持垫图，角色一致性无保证」），否则用户会拿到一批各自独立的立绘而不知道原因。
- **`flow2api` 本机依赖。** `STAGE_FLOW_BASE_URL=http://127.0.0.1:38000` 是本机托管服务。这个项目是要分发的，`STAGE_IMAGE_BACKEND=flow2api` 作为**默认值**（计划 §3.1 的示例配置）意味着任何没有 flow2api 的环境默认开演即报错。建议默认仍是 `cpa`，或默认 `flow2api` 但在探活失败时自动回落到 cpa 并 warn——AGENTS.md 说「对于大多数异常不要考虑失败降级策略」，但这里是**默认配置指向一个非本项目管理的进程**，属于配置默认值选错，不属于异常降级。
