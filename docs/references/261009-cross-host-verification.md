# 跨线验证矩阵（AIVN 两条发行线）

本文件是**领域级规范**：改了什么，该跑什么验证。两条发行线（独立版 `stage-ai` 与 DSH 插件
`dsh-aivn`）共享 `@aivn/core` 与 `@aivn/stage`，共享包的改动会**静默**传到 DSH（构建期打包进 `lib/`），
所以「改完只跑一边」是这里最贵的失误。

配套阅读：`docs/features/261008-aivn-dual-host/261008-aivn-dual-host.plan.md`（两条线定位与维护规则）。

## 1. 依赖真相（先记住这个）

```
@aivn/core   ─┐
@aivn/stage  ─┴─→ 独立版 apps/*（workspace 依赖，走 dist 类型）
             └──→ dsh-aivn（file: 兄弟仓依赖，**构建期** esbuild 打进 lib/，运行时不依赖）
```

三个直接后果：

1. **改共享包必须重建**：`pnpm -r build`。独立版走 workspace `dist` 类型，不建就是老类型。
2. **改共享包必须重建 DSH 的 `lib/`**：`dsh-aivn` 吃的是自己 `lib/` 里**打包进去的那份**，
   不重建就还在跑旧代码——而且**失败是静默的**（本地看着正常，别人装上才炸）。
3. **`lib/` 是 DSH 的受跟踪构建产物**，改 `src/` 必须 `npm run build` 并同笔提交，
   `node build.mjs --check` 必须绿（`.githooks` 拦）。

## 2. 版本策略（现状，别当漂移）

| 包 | 版本 | 跟谁走 |
| --- | --- | --- |
| 根 `aivn` / `apps/desktop` + `tauri.conf.json` + `Cargo.toml` | 0.3.2 | **产品版本**，发布才动（四处必一起改，`pnpm desktop` 会核对） |
| `@aivn/core` / `@aivn/stage` / `@aivn/server` / `@aivn/web` | 0.3.1 | **内部包**，当前不跟发布走 |

内部包停在 0.3.1 是**有意的**（它们不发公网，见 plan「依赖与版本策略」）。
所以「根 0.3.2 而 core 是 0.3.1」不是漂移，不要顺手对齐。

> 什么时候要变：真出现「要在没有兄弟仓的情况下从源码构建 DSH」的接收方时，
> 先走 `pnpm pack` + `vendor/` tarball 的自包含路；那时共享包才需要真版本号与兼容范围。

## 3. 改动 → 验证对照表

**先划范围再跑**：按下表选，不要无差别全量（本项目宿主是 ARM 手机，
`pnpm -r build` 与全量 e2e 在这台机器上会超时）。

| 改了什么 | 独立版要跑 | DSH 要跑 | 为什么 |
| --- | --- | --- | --- |
| `packages/core` DSL / parser / IR | `pnpm --filter @aivn/core test` + `pnpm -r build` | `npm run build` + `node build.mjs --check` + **离线** `ending` / `rebuild` | DSH 的舞台投影吃 core 的 parser 与 IR，语法改动会静默改投影 |
| `packages/core` 素材/角色契约 | core 测试 + `server` 相关（assetLibrary / playAssets / characterCard） | 离线 `media` | 两边共用同一份 schema |
| `packages/core` 语音纯函数 | core 测试 | `voice`（**真打 Fish，默认不跑**，单点执行） | 契约类改动可离线验，出声验不了 |
| `packages/stage` 组件 / 播放 / CSS | `pnpm --filter @aivn/stage test`（测试在 `src/`，7 个） | `npm run build`（`lib/client.js` 把 stage 打进去）+ 实例 `style` / `stage` | 舞台是两条线共用的渲染层 |
| `apps/server` 编排 / WS / 工坊 | 受影响单测（按文件名指名，**不要 `--`**） | — | 独立版专属 |
| AgentKit（能力目录 / 工具元数据） | `server` 的 `agentkit` + `prompt` + `workshop`；`pnpm check:agent-contract` | 若同时改了 `dsh-aivn` 的 tool-catalog → `injection` / `stagehand` | 契约漂移守卫在独立版侧 |
| 提示词 / persona 章标题 | `server` 的 `prompt` / `workshop` | 若两边同改 → `injection` / `stagehand`（e2e 按章标题与条件句断言） | 改标题会撞 e2e 锚点 |
| skill（`apps/server/skills/**`） | `server` 的 `workshop`（含 skill 可读性与中立性）+ `pnpm check:agent-contract` | — | skill 是独立版随包只读目录 |
| `apps/web` | `pnpm --filter @aivn/web test` | — | 独立版专属 |
| `apps/desktop` | `pnpm typecheck`；打包只能在 Windows | — | sidecar 链路 |
| 版本号 | 四处一起改（见 §2） | 若真发版另说 | 漂了 `pnpm desktop` 直接失败 |

### 命令速查（含本项目特有的坑）

```bash
# 独立版
pnpm --filter @aivn/core test                              # 共享领域层
pnpm --filter @aivn/stage test                             # 共享舞台层
pnpm --filter @aivn/server test test/agentkit.test.ts      # 指名用例：文件名直接跟，不要写 `--`
pnpm check:agent-contract                                  # 提示词/工具/能力位漂移守卫

# DSH（在 dsh-aivn 仓）
npm run typecheck && npm run build && node build.mjs --check
node e2e/run.mjs rebuild                                   # 唯一不需要实例的套件
node e2e/run.mjs media                                     # 离线
dsh-e2e start --wait-ready && npm run e2e:stage && dsh-e2e stop   # 实例级
```

**两个坑**（写在 `AGENTS.md` 里也在这里重复一次，因为它们在 CI 之外很难自查）：

- `pnpm test -- <文件>` **不生效**：pnpm 把 `--` 原样拼进命令行，vitest 把其后一切当非选项参数丢掉——
  过滤器不生效、静默跑全量、看起来还全绿。
- DSH 改过 `lib/` 之后要 `dsh-e2e stop` 再 `start`，否则跑的还是旧模块。

## 4. 不默认执行的部分

按项目约定，涉及**真实外部 API** 的验证默认不跑，优先 Mock / 假流 / 缓存：

| 套件 / 测试 | 依赖 | 何时才跑 |
| --- | --- | --- |
| DSH `voice` | 真实 Fish Audio（要 `DSH_AIVN_TTS_KEYS`） | 改动触到语音链路时**单点**跑，不批量重跑 |
| 真实生图 / 音乐后端 | 各后端凭据与配额 | 同上 |
| 真实 LLM 演出 | 模型网关 | 只在最终验收单点执行；日常用转写与假流 |

离线可覆盖的**替代手段**：DSH 的 `rebuild` 套件手写转写、直接调真实的 `rebuildStage()`
（真模型跑不出「这一拍用 `<stop/>` 收尾」，转写可以）；独立版用假流与 `stubBackend`。

## 5. 跨线契约的单一记录（改契约时同步）

| 记录 | 位置 | 谁消费 |
| --- | --- | --- |
| 能力矩阵 + 工具副作用元数据 | `apps/server/src/agentkit/contract.ts` | 独立版装配；DSH 对照登记 |
| 素材生命周期（pending/draft/adopted/expired/failed） | `packages/core/src/play/assetLifecycle.ts` | 两条线的状态语义 |
| 漂移守卫 | `scripts/check-agent-contract.mjs` | 独立版提示词/工具/能力位 |

**新增能力或工具时**：改契约 + 更新对应矩阵行 + 跑守卫。契约是「两边各自承诺了什么」的唯一记录，
不是第二份工具注册表——别在 DSH 复制一份独立版的实现。

## 6. 已知有意差异（不是待修项）

| 领域 | 独立版 | DSH | 为什么 |
| --- | --- | --- | --- |
| 传输 | REST + WS | host route + SSE | 宿主不同，统一 IR 语义即可 |
| 会话真相 | PlayHouse / LineageTree / saves | DSH session / workspace / 历史 | 产品定位不同 |
| 媒体作业 | pending jobs、异步排队 | 同步等待或宿主 jobs | 体验各随宿主 |
| stop 来源 | 编排器 / 工具 | 剧本末行 `<stop>` 标签 | 都归一为同一 IR |
| 路线能力 | 分支 / 重写 / CG 台账 | 线性优先，用 DSH 原生 fork | 不是缺失 |
| 设置 | `settings.json` | 插件 Config | 各自真相源 |

目标写在这里，免得后来人把它当成 bug 去「修」：
**减少无意分歧，不是消灭所有分歧。**
