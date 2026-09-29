# 技术前提核实报告 · 260929-workshop-assets

> 核实对象：`260929-workshop-assets.plan.md`（296 行）
> 核实方式：只读。源码定位 + node 实跑 + flow2api 只读 GET（**未调用 generateContent**）。
> 结论：**0 项不成立，6 项需要改（其中 5 项是事实性错误/缺漏，1 项是安全约束缺漏），1 项成立但需补正 3 处细节。**

| # | 核实项 | 判定 |
| --- | --- | --- |
| 1 | `Type.Union` 是否不支持 | **需要改**（理由写错了：它存在） |
| 2 | `AgentTool.execute` 签名 / `label` | **成立**，但需补正 3 处细节 |
| 3 | `ConfigSchema` 配置机制 | **需要改**（仓库里没有这个东西） |
| 4 | undici `request` vs `fetch` | **需要改**（项目从不写 `request(...)`） |
| 5 | `writeAsset` / `listAssets` 契约 | **需要改**（签名成立，但缺安全约束） |
| 6 | `Limiter` 迁移与回归线 | **需要改**（现有测试测不出槽位转让） |
| 7 | flow2api 端点契约 | **需要改**（响应有未覆盖的 `fileData` 分支） |

---

## 1. `Type.Union` —— 需要改

**计划的说法**（plan.md:166）：

> 扁平参数而非联合类型：`pi-ai` 的 `Type.Union` 在工具 schema 上的支持不确定，扁平 + 运行时校验的错误信息更明确。

**核实结果：`Type.Union` 存在，且能正常序列化成标准 JSON Schema。**

证据链：

1. pi-ai 转出的就是 typebox 本身：
   `node_modules/@earendil-works/pi-ai/dist/index.d.ts` →
   `export type { Static, TSchema } from "typebox";` / `export { Type } from "typebox";`
2. `node_modules/.pnpm/typebox@1.3.27/node_modules/typebox/build/typebox.d.mts` 含
   `export { IsUnion, type TUnion, Union } from './type/types/union.mjs';`
   → `build/type/types/union.d.mts`：
   `Union<Types extends TSchema[]>(anyOf: [...Types], options?: TSchemaOptions): TUnion<Types>`
3. 运行时实跑（`apps/server` 下 `import { Type } from "@earendil-works/pi-ai"`）：

   ```
   typeof Type.Union = function
   Type 导出成员数 = 117
   Type.Union([Type.String(), Type.Number()]) 序列化结果：
   {"anyOf":[{"type":"string"},{"type":"number"}]}
   Type.Object({a: Type.String()}, {additionalProperties: false}) 序列化结果：
   {"type":"object","required":["a"],"properties":{"a":{"type":"string"}},"additionalProperties":false}
   ```

   两条关键结论：
   - `~kind` 判别位**不可枚举**，不会泄漏进发给模型的 JSON Schema——`anyOf` 是干净输出。
   - `Type.Object(props, {additionalProperties:false})` 的两参形式**成立**（`TObjectOptions extends TSchemaOptions`，后者带 `[key: PropertyKey]: unknown` 索引签名，`additionalProperties:false` 合法）。

4. pi-ai 的工具入参校验器**显式实现了 Union 分支**，不是"没测过"：
   `node_modules/@earendil-works/pi-ai/dist/utils/validation.js:145-162` 的 `coerceWithUnionSchema(value, schemas)` 逐分支 `Compile(...).Check(value)` 并对每个分支各做一次 `structuredClone` + 强转重试；文件头 `import { Compile } from "typebox/compile"`。

**需要改的是什么**：不是"要不要用 Union"，而是**理由**。
计划写"支持不确定"，事实是"支持，且校验器有专门实现"。计划选的扁平参数本身是更好的工程选择（错误信息更明确、与现有 `workshop.ts` 风格一致），但**支撑理由必须换成真实理由**，否则后续 agent 会以为 Union 不可用、绕开它重新踩坑。

**唯一真要提防的点**（与 Union 无关）：pi-ai 的 `StringEnum` 工具（`utils/typebox-helpers.d.ts`）注释写明「compatible with providers that don't support anyOf/const patterns」——即**模型侧**对 `anyOf` 的容忍度因 provider 而异。项目当前走 cpa 网关，用 `StringEnum` 规避 `anyOf` 才是有据可依的选择；工具参数用 `anyOf` 不会炸校验，但某些 provider 的约束采样可能退化。**结论：把 plan.md:166 的理由改为「provider 侧对 `anyOf` 约束采样的容忍度因网关而异（见 `StringEnum` 的存在理由），且扁平参数的错误回灌对模型更友好」——这是事实成立的说法。**

---

## 2. `AgentTool.execute` 签名 —— 成立，但需补正 3 处

**核实结果**：计划的 `(id, params) => Promise<{content, details}>` 方向对，但漏了三处会直接编译不过或行为不对的细节。

真实定义，`node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:366-397`：

```ts
export interface AgentToolResult<T = JsonValue | undefined> {
    content: (TextContent | ImageContent)[];   // ① 必须是数组，且元素是 TextContent | ImageContent
    details: T;                                 // ② 必填（不是可选）
    usage?: Usage;
    terminate?: boolean;
}
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
    label: string;                              // ③ 必填，不是可选
    prepareArguments?: (args: unknown) => Static<TParameters>;
    execute: (toolCallId: string, params: Static<TParameters>, signal?: AbortSignal,
              onUpdate?: AgentToolUpdateCallback<TDetails>) => Promise<AgentToolResult<TDetails>>;
    replay?: "never" | "safe";
    executionMode?: ToolExecutionMode;
}
```

逐条对照：

| 计划说法 | 事实 | 处理 |
| --- | --- | --- |
| `execute(id, params)` | 4 个形参 `(toolCallId, params, signal?, onUpdate?)` | 用前两个没问题（少写可选参数合法），但要写全 |
| 首参 `id` | 是 `toolCallId: string`（**不是对象**） | 现有 `workshop.ts:66,81` 写作 `async (_id, params)`，与事实一致 |
| `label` 字段存在 | ✅ 存在且**必填** | 直接给 `generate_asset` 写 `label: "生成素材"` |
| 返回 `{content, details}` | `content` 是 `TextContent \| ImageContent` **数组** | 用 `workshop.ts:35-37` 已有的 `textResult()` 模式 |

**一个计划没提到、但对本需求直接相关的发现**：
`AgentToolResult.content` 支持 `ImageContent`（`pi-ai/dist/types.d.ts:242-260`：`{type:"image"; data: string; mimeType: string}`，`data` 是 base64 字符串）。这意味着**方案 B 是现成的**——`generate_asset` 可以直接把生成的图作为 tool result 回给模型看，不必只靠 WS 消息推缩略图。计划选的 WS 消息通道（plan.md:179-187）没有问题，两者可以并存，但计划应至少知道这个选项存在（模型能看到自己刚生成的图，对"重画/不满意"的迭代质量影响很大）。

**现有代码佐证**：`apps/server/src/workshop.ts:28-33` 用 `Type.Object({}, { additionalProperties: false })` 与 `Type.Object({...}, { additionalProperties: false })`——与计划在 `generate_asset` 上的用法完全一致，**这一项不需要改**。

---

## 3. `ConfigSchema` —— 需要改（仓库里不存在这个东西）

**核实结果：全仓库没有任何 `ConfigSchema`。**

```
grep -rn "ConfigSchema" . --include=*.ts（排除 node_modules）→ 0 命中
```

真实机制，`apps/server/src/config.ts`（117 行）：

| 关注点 | 事实 | 行号 |
| --- | --- | --- |
| 声明方式 | 手写 `export interface ServerConfig` | 5 |
| 嵌套形状 | `image: {enabled, model, size, concurrency, timeoutMs}` / `tts: {enabled, keysPath, proxy, baseUrl, concurrency}` | 22-32 / 34-40 |
| 读取方式 | `export function loadConfig(env = process.env, repoRoot = process.cwd())` 返回**字面量对象** | 67 |
| 默认值 | 就地 `??` / 三元 | 78-107 |
| 数值容错 | `parsePositiveInt(name, raw, fallback)`（非法值 → warn + 回退默认） | 44 |
| 比例容错 | `parseRatio(...)` 同上 | 56 |
| schema 库 | **无**（无 zod / valibot / ajv） | — |

现有 `image` 块（config.ts:86-96）：

```ts
image: {
  enabled: env.STAGE_IMAGE_ENABLED !== "false",
  model: env.STAGE_IMAGE_MODEL ?? "gpt-image-2",
  size: env.STAGE_IMAGE_SIZE ?? "1536x1024",
  concurrency: parsePositiveInt("STAGE_IMAGE_CONCURRENCY", env.STAGE_IMAGE_CONCURRENCY, 2),
  timeoutMs: parsePositiveInt("STAGE_IMAGE_TIMEOUT_MS", env.STAGE_IMAGE_TIMEOUT_MS, 150_000),
},
```

**需要改的是什么**：计划改动清单写「`src/config.ts` | 新增 `image.backend` / `flow.*` 配置项」——这句话本身没错，但它没说**改哪里**。实现者容易误以为存在一个集中的 schema 注册处。实际是**两处必改、缺一即类型不过**：

1. `ServerConfig` interface 里加 `image.backend: "flow2api" | "cpa"` 与 `flow: { baseUrl, apiKey, model, size, timeoutMs }`；
2. `loadConfig` 返回的字面量里加同名字段 —— **少改第 2 处 `pnpm typecheck` 直接报错**，这是好事，会被拦住。

**顺带三条实现约束**（计划未提）：

- `flow.timeoutMs`（180000）应该走 `parsePositiveInt`，与 `image.timeoutMs` 一致，否则 `.env` 里误填 `180000abc` 会静默变成 `NaN` 并被当 0 用。
- `flow.model`（别名名）**不适合**用 `parseRatio` 那类容错：模型名写错时 flow2api 不会报错，只会静默按 `DEFAULT_ASPECT = "landscape"` 出图（`/opt/flow2api/src/core/model_resolver.py:111`）——写错名字的代价是"出图了但画幅全错"。建议在 `createImageBackend()` 里对照 `IMAGE_BASE_MODELS` 白名单校验一次，模型名不合法直接抛配置错误。这是 flow2api 特有的坑（skill 文档"降级行为"一节也写了）。
- `flow.baseUrl` 默认 `http://127.0.0.1:38000` 属于本机地址，可以照写；`flow.apiKey` 在 README 里**必须用占位符**（如 `<your-flow2api-key>`），按项目脱敏铁律。

---

## 4. undici 调用形式 —— 需要改

**核实结果：项目全链路只用 undici 的 `fetch`，从不写 `request(...)`。**

| 文件 | 证据 | 行号 |
| --- | --- | --- |
| `apps/server/src/imagegen.ts` | `import { fetch as undiciFetch } from "undici";` | 1 |
| 同上 | `type UpstreamResponse = Awaited<ReturnType<typeof undiciFetch>>` | 4 |
| 同上 | 构造注入 `private readonly fetchImpl: typeof undiciFetch = undiciFetch` | 32 |
| 同上 | `signal: AbortSignal.timeout(this.opts.timeoutMs)` | 56, 94 |
| `apps/server/src/tts.ts` | `import { fetch as undiciFetch, ProxyAgent } from "undici";` | 5 |
| 同上 | `signal: AbortSignal.timeout(this.opts.timeoutMs)` | 73-89 |

超时是**以 `signal: AbortSignal.timeout(ms)` 传入**的，不是 `request({ timeout })` 选项——`request()` 的 `headersTimeout`/`bodyTimeout` 语义完全不同，混用会得到不同的失败行为。

undici 版本 `8.11.2`（`apps/server` 依赖）。

**需要改的是什么**：`flowImage.ts` 必须用 `undiciFetch`，**并且**照 `imagegen.ts:32` 的模式把 `fetchImpl` 做成构造注入的默认形参：

```ts
constructor(opts: FlowImageOptions, private readonly fetchImpl: typeof undiciFetch = undiciFetch) {}
```

理由不是风格洁癖，是**测试策略**。计划 test 表里写着 `test/flowImage.test.ts`「stub fetch」——没有注入点就只能 `vi.mock("undici")`，那是全模块 mock，比注入点脆得多。`imagegen.ts` 已经趟过这条路（`fetchImpl` 就是为这个存在的），照抄即可。

顺带：计划 L3.1 说「`STAGE_FLOW_TIMEOUT_MS=180000`」，而 L3.6 又把 `TURN_TIMEOUT_MS` 从 180s 提到 420s（plan.md:175）。两处是**嵌套关系**（turn 420s ⊃ 单图 180s × 最多 2–3 张 + LLM 往返），数字自洽，不算冲突，但值得在计划里点明这层嵌套关系，否则实现者容易把 420 误当成也要同步改单图超时。

---

## 5. `writeAsset` / `listAssets` 契约 —— 需要改（缺安全约束）

**核实结果：签名与排序判断都对，但计划漏了一条会让工具变成路径穿越入口的约束。**

`apps/server/src/store.ts:159-163`：

```ts
async writeAsset(kindPath: string, name: string, data: Buffer): Promise<void> {
  const target = join(this.dir, "assets", kindPath, name);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, data);
}
```

实测（node）：

```
join('/p/assets/backgrounds/x.jpg', '..')                          → '/p/assets/backgrounds'   ✅ 可靠
join(join('/p/assets','sprites/mio'),'smile.jpg','..')             → '/p/assets/sprites/mio'   ✅ 可靠
join('/p/assets','backgrounds/../../etc','x.jpg','..')             → '/p/etc'                  ⚠️ 越界
```

→ `join(target, "..")` **可靠**（计划这点是对的）；但 `writeAsset` **不做任何路径穿越校验**，且**不是原子写**（无 tmp+rename，与 `imageAssets.ts` 的 manifest 写盘不同）。

`listAssets()`（store.ts:163-181）用 `readdir(kindDir, {withFileTypes:true})`，**无 sort**；嵌套层再 `readdir(join(kindDir, char.name))`，同样无 sort。实测 `plays/demo/assets/sprites/koharu` 在本机恰好返回字母序（`angry, normal, sad, shy, smile, surprised, thinking, winking`）——**巧合，不是保证**。

**需要改的是什么**：

1. **必须显式写进计划**：`WorkshopAssets` 负责命名白名单是对的，但白名单 regex 只能挡 `name`，挡不住 `kindPath`——而 `kindPath` 是 `WorkshopAssets` 自己按 `target.kind` 拼的（`backgrounds` / `cg` / `sprites/<characterId>`），所以**只要 `characterId` 过了 `^[a-z][a-z0-9_]{0,39}$`，穿越就不可能**。这一点计划隐含做到了，但**没有说明它为什么安全**——将来若有人加一个"任意 kindPath"入口就会破。建议计划里补一句：`kindPath` 只由服务端从已校验的枚举拼装，绝不接受模型直传。
2. **建议改用 `store.assetPath(kindPath)`**（store.ts:96-98：`join(this.dir, "assets", ...kindPath.split("/"))`）而不是自己 `join`，与静态服务路由共用同一套拼接，避免两处漂移。
3. **原子写**：`writeAsset` 不是 tmp+rename。若同一剧目两个窗口同时 `generate_asset` 同名素材（工坊对话串行，但工坊对话与素材管理页的删除/上传不串行），可能读到半张图。建议 `WorkshopAssets` 自己 tmp+rename，或接受现状并在计划里显式记为已知限制。

`listAssets` 无序这条**计划已经写对了**（plan.md:140「顺手修的既有 bug」），且影响面确认成立：`apps/web/src/stage/assets.ts:51` 的 `files[0]` 兜底确实会随机选一张差分。

---

## 6. `Limiter` 迁移 —— 需要改

### 6.1 现状确认

`apps/server/src/imageAssets.ts`：

```ts
25:  const MAX_QUEUE = 12;                              // 模块级常量
139: private async acquire(): Promise<void> {
140:   if (this.running < this.concurrency && this.queue.length === 0) { this.running += 1; return; }
144:   if (this.queue.length >= MAX_QUEUE) throw new Error("生图队列已满");
145:   await new Promise<void>((resolve) => this.queue.push(resolve));
146: }
149: private release(): void {
151:   const next = this.queue.shift();
152:   if (next) next();          // ← running 不动，槽位直接转让
153:   else this.running -= 1;
154: }
```

### 6.2 最小迁移方案

```ts
// apps/server/src/limiter.ts
export class Limiter {
  private running = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number, private readonly maxQueue: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();                 // ① 必须 try 之外
    try { return await fn(); }             // ② 直接 await 委托
    finally { this.release(); }            // ③ 原样搬，不许先 this.running -= 1
  }
  // acquire / release 代码从 imageAssets.ts:139-154 逐字搬过来
}
```

`ImageAssets` 侧：把 `concurrency` 形参与 `MAX_QUEUE` 换成构造注入的 `Limiter`，`generate()`（imageAssets.ts:122-136）里的 `await this.acquire()` / `finally { this.release() }` 换成 `await this.limiter.run(async () => { ...原逻辑... })`。
`PlayHouse` 侧：在 `playhouse.ts:312-316` 构造 `ImageAssets` 的**同一个位置**建 `new Limiter(config.image.concurrency, 12)`，同时传给 `ImageAssets` 与 `WorkshopSession`→`WorkshopAssets`。

### 6.3 迁移中三条最容易踩的语义（必须逐条守住）

| # | 坑 | 后果 |
| --- | --- | --- |
| **A** | ③ 里写成 `this.running -= 1; const next = this.queue.shift(); if (next) next();` | **直接违反生图铁律⑥**，并发翻倍烧配额（见下方实测） |
| **B** | ① 把 `acquire()` 挪进 `try` | 队列满时 `acquire` throw → `finally` 执行 `release()` → 凭空给一个从未运行的请求发槽，闸门计数漂移，越跑越松 |
| **C** | ② 写成 `return fn().finally(() => this.release())` | 这条其实等价、可行；但若顺手再加一层 `try/catch` 把异常吞掉转成 `undefined`，调用方会拿到"没图"而非错误，破坏「失败向上抛由调用方降级」的既有约定 |

**坑 A 的实测证据**（`/tmp/limcheck/t.mjs`，两种 release 实现对拍，`max=1`）：

```
direct-transfer :  +a -a +b -b +c        ← 严格串行，任意时刻最多 1 个在跑
decrement-first :  +a -a +b +c -b -c      ← b 与 c 重叠，max=1 却并发了 2 个
```

**结论：铁律⑥ 确实有可观测后果，不是玄学。** 但注意坑 B（队列满时 `acquire` 抛错）当前代码路径**不可达**（`queue.length >= MAX_QUEUE` 时新请求根本进不了 `acquire` 之前——实际上可达，因为 `acquire` 是异步的，但当前 `imageAssets.ts` 只有一个调用方），所以**坑 B 同样需要新测试**（`test/limiter.test.ts` 的"超队列拒绝"用例要同时断言"拒绝后 running 计数未被污染"：连拒 13 次后，第 13 次 reject，第 14 次应仍在 `running === 0` 的状态下立刻成功）。

### 6.4 回归线：现有测试测不出这个语义（计划需改）

计划说（plan.md:91）：

> `ImageAssets` 改用 `Limiter`，行为不变（槽位转让语义在 `Limiter.run` 里对测试可见）。

以及 test 表（plan.md:264）：

> `test/limiter.test.ts` | 槽位转让排队（并发恰好等于 max）、超队列拒绝

**核实结论：`test/image.test.ts:94-112`「并发闸门不超发」不能作为这个语义的回归线。**

现有用例形状：5 个不同 prompt 在**同一 tick** 内 `Promise.all` 一起进闸门，`concurrency=2`，断言 `peak === 2`。因为 5 个请求全部在第一次 `await` 之前就抵达，`release()` 的微任务间隙里**没有任何新请求可插队**，所以「先减 running 再转让」和「直接转让」两种实现**都会通过**。实测：

```
peak(good) = 2    peak(bad) = 2        ← 两种实现同样通过，现有断言无法区分
```

**需要改的是什么**：计划必须新增一条**专门**钉住转让语义的用例，且用例形状必须是「在 release 之后、waiter 续体之前插入新请求」：

```ts
// test/limiter.test.ts —— 钉住「槽位直接转让」
const lim = new Limiter(1, 8);
const events: string[] = [];
const a = lim.run(async () => { events.push("+a"); await sleep(5); events.push("-a"); });
await tick();                       // a 已占槽
const b = lim.run(async () => { events.push("+b"); await sleep(1); events.push("-b"); });
a.then(() => lim.run(async () => { events.push("+c"); }).catch(() => {}));  // 插在 release 之后
await Promise.allSettled([a, b]);
assert.deepEqual(events, ["+a", "-a", "+b", "-b", "+c"]);   // bad 实现会得到 [..., "+b", "+c", ...]
```

plan.md:269 那行「`test/image.test.ts`（增量）| 改用 `Limiter` 后 D6 缓存与预发射行为不变（回归线）」**可以保留**（它守住的是缓存与在飞去重，确有价值），但要**删掉** plan.md:91 里"槽位转让语义对测试可见"的那半句承诺——除非同时补上这条新用例。

### 6.5 附带：一个字段名对不上

计划（plan.md:187、改动清单 plan.md:232）说要让 `generate_asset` 置位 `dirtyDuringTurn`。实际字段叫 **`wroteDuringTurn`**（`apps/server/src/workshopSession.ts:41`，私有；`chat()` 在 L106 置 false、L131 收束后判真）。

由于它在 `WorkshopSession` 内部是 `private`，`generate_asset` 工具**不能**直接置位——只能像现在一样通过 `createWorkshopTools({ files, store, onWrite })` 的回调模式。实现上二选一：
- 复用现有 `onWrite` 回调链路（工具内部发一条 `workshop_write`）——但二进制产物没有 `before` 字符串，语义不匹配；
- 在 `WorkshopToolDeps` 上另加一个 `onAssetsChanged: () => void`，由 `WorkshopSession` 构造时绑到 `this.wroteDuringTurn = true`。

推荐后者。计划里把 `dirtyDuringTurn` 改成 `wroteDuringTurn`，并写明走新回调而不是硬改私有字段。

---

## 7. flow2api 端点契约 —— 需要改（一处未覆盖分支）

> **安全声明**：本次核实对 `http://127.0.0.1:38000` **只发过 `GET /v1beta/models` 与 `GET /v1/models/aliases` 两个只读请求**。`generateContent` 从未调用，无计费。响应结构与字段拼写全部通过读 `/opt/flow2api` 源码确认。

### 7.1 逐条核对结果

| 计划说法（plan.md:53-57） | 源码事实 | 判定 |
| --- | --- | --- |
| `POST {base}/v1beta/models/{alias}:generateContent` | `src/api/routes.py:971-975`：`@router.post("/v1beta/models/{model}:generateContent")` | ✅ |
| 头 `x-goog-api-key` | `src/core/auth.py:50`：`x_goog_api_key: Optional[str] = Header(None, alias="x-goog-api-key")` | ✅ |
| **铁律：必须传别名模型名** | `src/core/model_resolver.py:672` 起：`if model in IMAGE_BASE_MODELS:` 才走 `generationConfig` 拼接；命中 `MODEL_CONFIG` 的完整名在 L768「直接返回」，`generationConfig` 被忽略 | ✅ **铁律成立** |
| `generationConfig.responseModalities=["IMAGE"]` | `src/core/models.py:274`：`responseModalities: Optional[List[str]] = None  # ["IMAGE", "TEXT"]` | ✅ 拼写正确 |
| `generationConfig.imageConfig={aspectRatio,imageSize}` | `src/core/models.py:261-268`：`class ImageConfig` — `aspectRatio: Optional[str]`（注释 `"16:9","9:16","1:1","4:3","3:4"`）、`imageSize: Optional[str]`（注释 `"2k","4k"`） | ✅ 拼写与取值全对 |
| `contents[0].parts = [{text}, ...references.map(inlineData)]` | `src/core/models.py:294-301`：`class GeminiPart {text?, inlineData?{mimeType,data}, fileData?}` | ✅ 顺序不敏感 |
| `STAGE_FLOW_MODEL=gemini-3.1-flash-image` | `src/core/model_resolver.py:40`：`IMAGE_BASE_MODELS` 含 `"gemini-3.1-flash-image"`；实跑 `GET /v1/models/aliases` **200，命中** | ✅ |
| 画幅 `16:9`（背景/cg）、`3:4`（sprite） | `ASPECT_RATIO_MAP`（model_resolver.py:49-58）把 `16:9`→`landscape`、`3:4`→`three-four`；`MODEL_SUPPORTED_ASPECTS["gemini-3.1-flash-image"]`（L80-86）含 `landscape` 与 `three-four` | ✅ 两个画幅都支持 |
| `STAGE_FLOW_SIZE=2k` | `MODEL_SUPPORTED_SIZES["gemini-3.1-flash-image"] = ["2k","4k"]`（L93） | ✅ |
| 响应 `candidates[0].content.parts[].inlineData.{mimeType,data}` | **⚠️ 只覆盖了主路径**（`routes.py:637` / `647-652`），**漏了降级路径** | **需要改** |

### 7.2 需要改：响应的 `fileData` 降级分支

`src/api/routes.py:631-663`：

```python
async def _build_image_parts_from_uri(uri):
    if uri.startswith("data:image"):  ... return [{"inlineData": {...}}]           # 主路径
    image_bytes = await retrieve_image_data(uri)
    if image_bytes:                 ... return [{"inlineData": {...}}]           # 主路径
    return [                                                                              # ← 降级路径，计划未覆盖
        {"fileData": {"mimeType": _guess_mime_type(uri, "image/png"), "fileUri": uri}},
        {"text": uri},
    ]
```

`_build_gemini_success_payload`（routes.py:735-752）把这些 part 原样塞进 `candidates[0].content.parts`。

**后果**：当 flow2api 拿不到图片字节（`retrieve_image_data` 失败——临时地址过期、`cache.base_url` 未配、媒体代理不通），返回体**合法但没有 `inlineData`**。客户端如果只按计划写"找 `inlineData` 找不到就报错"，用户看到的是"生成失败"；而实际上服务端**有图**，只是给的是地址。两种错误处理的用户体验差别很大。

**必须改**：解析器要分三种情况返回明确的不同错误：

1. 有 `inlineData` → 正常返回 `{data: Buffer.from(b64, "base64"), mimeType}`；
2. 只有 `fileData.fileUri` → 报「网关返回了图片地址但未内联（mime=… uri=…），检查 flow2api 的 `image_prefer_media_proxy` / `cache.base_url` 配置」——**这是配置问题不是生成失败**；
3. 只有 `text` → 报「网关返回的是文本：<前 200 字>」，很可能是提示词被拒或被当成普通对话处理了。

### 7.3 附带：别名不在 `/v1beta/models` 里

实跑（只读 GET，key 从 `/opt/flow2api/config/setting.toml` 读，未写入本报告）：

```
GET /v1beta/models    → 200，71 个模型
   models/gemini-3.1-flash-image-landscape
   models/gemini-3.1-flash-image-portrait
   models/gemini-3.1-flash-image-square
   models/gemini-3.1-flash-image-four-three
   models/gemini-3.1-flash-image-three-four
   models/gemini-3.1-flash-image-*-{2k,4k}      （共 15 个 flash-image 条目）
   —— 全部是「完整名」，**没有裸别名 gemini-3.1-flash-image**

GET /v1/models/aliases → 200，67 个别名
   gemini-3.1-flash-image | Image generation (alias) - aspects: landscape, portrait,
                           square, four-three, three-four; sizes: 2k, 4k
```

源码解释：`/v1beta/models` 枚举的是 `MODEL_CONFIG` 的 key（`routes.py:140-150` `_get_gemini_model_catalog`），别名是另一张表（`routes.py:884-901` 走 `get_base_model_aliases()`）。

**对计划的影响**：`test/flowImage.test.ts` 用 stub，不受影响。但如果后续有人写 live 测试断言"别名能在 `/v1beta/models` 里查到"，**会失败**。建议在计划的 e2e 用例（plan.md:270）里把模型可达性检查指向 `/v1/models/aliases`，或干脆跳过（stub 已覆盖）。另外 `/v1beta/models` 返回 71 个模型这个数字可以写进注释当基线，防网关升级后别名体系改名。

### 7.4 附带：降级是静默的

`model_resolver.py:687-705`：画幅不在支持列表 → **静默降级 `DEFAULT_ASPECT="landscape"`**；尺寸不支持 → **静默忽略**。只在 debug 日志里 warn，不报错。

这意味着一次打错的 `aspectRatio`（比如写成 `3:4 ` 带尾空格之外的任何变体）不会让请求失败，而是**默默出 16:9 的图**。立绘差分要 `3:4`，默默出 `16:9` 的图会直接毁掉角色站位。

**建议**：`WorkshopAssets` 在调后端前**自己**做一次白名单校验（`"16:9" | "3:4"` + `"2k" | "4k"`），非法值直接抛中文错误回给模型，让它自我修正——不要依赖网关的静默降级。这与计划已有的"命名白名单"是同一个防御思路，值得写进计划。

---

## 附：核实中额外确认的、计划里的正确判断（不必改）

为免父代理误以为要推翻计划，把核实过且**完全成立**的条目列一下：

- `Type.Object({...}, {additionalProperties:false})` 两参形式与现有 `workshop.ts:28-33` 一致 ✅
- `AgentTool.execute` 首参是未使用的 toolCallId、返回 `content` 数组 + `details` ✅
- `useWorkshopSocket.ts:41` 与 `useStageSocket.ts:189` 确实只按 `workshop_` 前缀分发 → `workshop_asset` 前缀要求成立 ✅
- `useWorkshop.ts:38-44` 的 `TOOL_LABEL` 是 5 项的 `Record`，加第 6 项是机械改动 ✅
- `TitleView.tsx:20-24` 与 `LibraryView.tsx:6` 确实各有一份缺项逻辑（前者是内联 `missing` 数组，后者是 `missingItems` 函数）→ 提取到 `api.ts` 合理 ✅
- `StageTheater.tsx:207-208` 确实是 `if (!url) return null` 静默消失 → 3.9 的问题描述准确 ✅
- `http.ts:111-121` 素材静态路由已支持 `assets/<kind>/<...>` 且 `MIME` 表有 `jpg` → `assets/cg/*.jpg` 开箱可服务，无需改服务端路由 ✅
- `playhouse.ts:312-316` 正是构造 `ImageAssets` 的位置，共享 `Limiter` 在这里建最自然 ✅
- `workshop.ts:183` `TURN_TIMEOUT_MS = 180_000` 存在，提到 420_000 是单行改动 ✅
- 计划 L2 决策「立绘差分用 `neutral` 作垫图」与 flow2api 的 `_infer_aspect_ratio_from_images`（`model_resolver.py:679`）配合无冲突——因为我们**总是显式传 `imageConfig`**（计划 L3.1 自己也说了不依赖推断）✅

## 附：需要父代理在计划里落地的改动清单

| 计划行 | 改法 |
| --- | --- |
| plan.md:166 | 理由从「`Type.Union` 支持不确定」改为「provider 侧对 `anyOf` 约束采样的容忍度因网关而异 + 扁平错误回灌更友好」；`Type.Union` 本身可用（已实跑验证） |
| plan.md:56 | 响应解析补 `fileData.fileUri` 分支与纯 `text` 分支，三种情况给不同错误文案 |
| plan.md:66 | 补一句：`flow.model` 在 `createImageBackend()` 里对照别名白名单校验，写错会静默降级成 `landscape` |
| plan.md:120-122 | `WorkshopAssets` 传前自校验 `aspectRatio` / `imageSize` 白名单，不依赖网关静默降级 |
| plan.md:91 | 删掉"槽位转让语义在 `Limiter.run` 里对测试可见"；改为"新增 `test/limiter.test.ts` 专门钉住转让语义，现有 `image.test.ts:94` 测不出" |
| plan.md:187, 232 | `dirtyDuringTurn` → `wroteDuringTurn`；并写明走 `WorkshopToolDeps` 新增的 `onAssetsChanged` 回调，不硬改私有字段 |
| plan.md:124 | 补一句安全论证：`kindPath` 只由服务端从已校验枚举拼装；建议改用 `store.assetPath()` 而非自己 `join` |
| plan.md:270 | e2e 里的模型可达性检查指向 `/v1/models/aliases`（别名不在 `/v1beta/models`） |
| 改动清单 `src/config.ts` 行 | 写明要改**两处**：`ServerConfig` interface + `loadConfig` 字面量；`flow.timeoutMs` 走 `parsePositiveInt` |
| 改动清单 `src/flowImage.ts` 行 | 写明用 `undiciFetch` + `signal: AbortSignal.timeout()`，并把 `fetchImpl` 做成构造注入形参（对齐 `imagegen.ts:32`） |

---

## 更正：3:4 画幅在真实调用中不成立（2026-09-29，实施期实测）

本文上文的结论「`16:9` / `3:4` / `1:1` 都能被 `model_resolver.py` 正确映射」**只覆盖了「请求被正确组装」，不覆盖「上游认这个画幅」**。真实出图（imageSize=2k）：

| 请求画幅 | 模型 | 实际返回 | 判定 |
| --- | --- | --- | --- |
| `16:9` | gemini-3.1-flash-image | 1376x768 | ✅ |
| `9:16` | gemini-3.1-flash-image | 768x1376 | ✅ |
| `3:4` | gemini-3.1-flash-image | 1200x896 | ❌ 静默退回横图 |
| `3:4` | gemini-3.0-pro-image | 1200x896 | ❌ 同上 |

`flow.db` 的 `request_logs.request_body.model` 记到 `gemini-3.1-flash-image-three-four-2k`，说明别名白名单与 `imageConfig` 管道都没问题，是上游渲染侧只认横竖两档。

**所以「画幅白名单自校验」（上文建议）不够**：拼装正确 ≠ 出图正确。必须再加一道**回执校验**——读返回字节的画幅，与请求画幅比对（容差 12%），不符就报错不落盘。已在 `WorkshopAssets.assertCanvas` 落地，立绘画幅相应改为 `9:16`。
