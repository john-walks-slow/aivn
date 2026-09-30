# 统一 agent 基座 + DSL 工具化 + Agent 设置

> 计划日期 2026-09-30。分支 `feat/agent-kit`（从 main `52994d6` 开）。
> 前置调研：`feat/dsl-tools` 分支的 `docs/features/260930-dsl-tools/260930-dsl-tools.research.md`（同题：DSL 标签与工具的边界）。本文在其结论上继续，并按用户要求把「统一基座」一并做掉。

## 一、要解决的

1. **两个 agent 各写一套**：工坊 agent（`workshop.ts` 11 工具）与剧作家（`orchestrator.ts` 5 工具）没有共同基座。生图这条路上它们已经各写了一份——`preloadAsset`/`preloadSprite` 在 `playhouse.ts` 里现搭一套 `WorkshopAssets` 去干活，工坊那边则是正经的工坊工具。同一件事两套实现，其中一套还挂在 playhouse 上、reload 会漏。
2. **DSL 里混着三类东西**：
   - 会在时间线上出现的（`scene`/`actor`/`cg`/`sfx`/`say`/`narrate`/`thought`/`comment`）——需要 seq、流式、停止点截断；
   - 只对宿主说话的（`update_state`/`write_memory`/…）——已经全是工具；
   - **卡在中间的**（`beat_done` 之外的 `<stop>`、`<preload_asset>`）：控制信号 + 载荷，却写成文本标签，于是要靠提示词约束「stop 之后别再说话」+ 解析器 `stopped` 闸门双兜底。
3. **临时角色画不出立绘**：`preloadSprite` 要求角色已在 `play.json` 里，剧作家路上遇到一个路人就没法给 ta 画图。
4. **两个 agent 的模型/思考档位写死**：只有一个 `STAGE_MODEL_ID`，两边共用；`thinkingLevel` 硬编码 `off`。用户没法让工坊用便宜模型、剧作家用强模型。

## 二、边界原则（沿用调研 §四，并按用户意见调整）

> **DSL 是时间线，工具是副作用。**

用户要求把「beat 结束 / 出选项 / 生图」三项从 DSL 挪进工具。取舍：

| 能力 | 原形态 | 新形态 | 理由 |
| --- | --- | --- | --- |
| 轮收束 | `beat_done` 空参数工具 | `beat_done(options?, placeholder?)` | 已经是工具，只需把停止点载荷并进去 |
| 停止点 | `<stop type>` + `<option>` | 同上（`beat_done` 参数） | 它不对应舞台上任何东西，是「交给玩家」的控制指令 + 载荷 |
| 生图预发射 | `<preload_asset>` 标签 | `generate_image` 工具 | 纯宿主副作用；且能和工坊共用同一个实现 |

**工具产出的 IR 事件与解析器产出的 IR 事件走同一条路**（`emitStageEvent` → 加 seq → 广播 `events` → 落谱系）。所以 `preload_asset` 与 `stop` 仍留在 `StageEvent` 里——它们是**时间线上可见的 IR 事件**（骨架占位出现在那个位置、停止点重放要靠它），只是不再由文本解析产生。client 侧 `ScriptBuilder`/`director` 一行不用改。

## 三、设计

### 3.1 统一基座 `apps/server/src/agentkit/`

```
agentkit/
  role.ts        AgentRole（playwriter | workshop）+ 角色元数据
  deps.ts        两套依赖类型（判别联合）
  result.ts      textResult / reason 共享小工具
  beatTool.ts    beat_done（仅剧作家）：停止点载荷 → IR stop 事件
  imageTool.ts   generate_image（两个角色共用实现，按 mode 换描述与等待策略）
  skillTool.ts   read_skill（共用）
  searchTool.ts  web_search（共用）
  filesTool.ts   list_files/read_file/write_file/delete_file/get_readiness（仅工坊）
  memoryTool.ts  update_state/write_memory/read_memory_detail/search_archive（仅剧作家，从 orchestrator 搬来）
  libraryTool.ts list_library/import_asset（仅工坊）
  lineageTool.ts list_saves/read_lineage（仅工坊）+ 故事树渲染
  kit.ts         createAgentKit(deps)：按 role 装配 → { tools, can, catalog }
```

`createAgentKit` 单一入口，依赖是判别联合（`role: "playwriter" | "workshop"`），TS 按 role 收窄。**同一个工具在两个角色下只有「描述 + 等待策略 + 可选依赖」不同，实现与 schema 同一份**——这就是「仅仅暴露内容不同」。

`kit.can` 是能力位（image/search/library/…），提示词按它决定注不注某一章（沿用「装一个必然失败的工具只会诱使模型空转」）。

`kit.catalog` 是工具目录（`{id, label, roles, group}`），供 Agent 设置页渲染开关。

### 3.2 `generate_image` 的两种暴露

| | 工坊 | 剧作家 |
| --- | --- | --- |
| 描述 | 同步出图，图片回执用 markdown 贴给用户看 | 后台排队，发起即返回；引用请留到 3–5 句之后 |
| 落点 | `assets/`（进 git，素材页可见） | bg/cg 落 `media-cache/`（内容寻址）；立绘走 `assets/` |
| 等待 | await，回执带图片 | 立即返回排产回执（跳过已有素材 / 已在飞 / 已排队） |
| 立绘角色 | 必须已在 `play.json`（成员校验） | 不在则自动注册 stub（**临时角色生图**） |
| 抠底参数 | 描述里教怎么用 | 不提（模型不该在拍内调抠底） |

立绘那条两边现在共用同一个 `PlayAssets`（原 `WorkshopAssets` 改名）：`neutral` 垫图、抠底、`play.json` 差分映射补写、画幅校验、inflight 去重，全在一处。剧作家侧不产工坊撤销记录（`onWrite` 不传），`play.json` 变更标记「需要在轮边界重建 runtime」，**不在拍内 reload**（现状 `preloadSprite` 直接 `reload`，会在拍进行中把编排器换掉——本次一并修掉）。

### 3.3 `beat_done` 承载停止点

```jsonc
{
  "name": "beat_done",
  "parameters": {
    "type": "object",
    "properties": {
      "options":     { "type": "array", "items": {"type":"string"}, "minItems": 2, "maxItems": 4 },
      "placeholder": { "type": "string" }
    },
    "additionalProperties": false
  }
}
```

- 给 `options` → `stopType: "choice"`；只给 `placeholder` → `"free"`；都不给 → `no_stop`。
- `minItems: 2` 由 pi 的 `validateToolArguments` 兜住：只写一个选项会拿到校验错误回执并重试，编排器那条「choice 无选项降级 free」的护栏随之删除。
- 载荷直接 emit 成 `stop` IR 事件（进事件缓冲 + 落谱系），与今天的 `<stop>` 完全同构。
- 闸门随之消失：工具 `terminate: true` 之后没有文本位置可写，提示词里那条「stop 之后不要再输出任何内容」的约束整段删掉。

**纪元压缩**：选项搬进工具参数后，`compaction.ts` 的 `renderTranscript` 只写 `[调用 beat_done]` 会把玩家当时面对的选项从剧作家的记忆里抹掉——必须单独给这个工具渲染 args。

### 3.4 DSL 收缩

`DSL_TAGS` 10 → 8：去掉 `stop`、`preload_asset`。

解析器里随之消失的状态机：`stopParse` 三态、`stopped` 闸门、`gated` warning、`emitStop`、`closeOption`、`<option>` 白名单。

两个旧标签保留为**静默降级**（`LEGACY_TAGS`）：命中即丢弃并挂一条 `malformed_tag` warning，不按未知标签原样输出——原样输出会把 `<stop type="choice">` 当台词念到舞台上，比丢掉更糟。模型有旧习惯时它的一次调用静默失效、下轮自己改正，比吐一屏标签强。

`dsl/spec.ts` 不再是停止点类型的家：`StopType`/`STOP_TYPES`/`OptionAttrs` 迁到 `ws/protocol.ts`（`StopPayload` 所在处，谱系投影与 beat 工具都要用）。

### 3.5 Agent 设置（P0/P1 → 落成工坊页签）

用户授权「若属 P0/P1 即可加 agent 设置 tab」。判定：

| 设置项 | 级别 | 理由 |
| --- | --- | --- |
| 每个 agent 的模型 | **P0** | 网关按量计费，工坊（长对话、可便宜）与剧作家（要文笔）用同一个模型是硬伤；今天写死在 env |
| 思考档位 | **P0** | pi 原生支持，代价为零，今天硬编码 `off` |
| 工具开关 | **P1** | 「仅仅暴露内容不同」本来就是基座能力；用户能按剧目关掉生图/联网 |

落点：`play.json` 的 `agents` 字段（core 契约新增，`parsePlayConfig` 白名单式构造必须同步——不加字段会被静默丢弃）。写盘走既有 `PUT /api/plays/:id/play` → `playhouse.reload` → 轮边界重建 runtime，**当轮不腰斩**。

前端：工坊第六个页签「Agent」，两张卡（剧作家 / 搭台助手）。模型下拉的数据来自新端点 `GET /api/agents/models`（网关 `/v1/models`），工具开关来自 `GET /api/agents/tools`（`kit.catalog`）。网关读不到就报错，不静默退化。

## 四、文件清单

| 文件 | 动作 |
| --- | --- |
| `packages/core/src/dsl/spec.ts` | 去 `stop`/`preload_asset`/`option`/停止点类型，迁 protocol |
| `packages/core/src/dsl/parser.ts` | 删停止点状态机，旧标签转静默降级 |
| `packages/core/src/dsl/events.ts` | StageEvent 保留 stop/preload_asset（改由工具产出），`PreloadAssetAttrs` 迁 agentkit |
| `packages/core/src/ws/protocol.ts` | 增 `StopType`/`StopOption` |
| `packages/core/src/play/config.ts` | 增 `AgentSettings` / `PlayConfig.agents` |
| `apps/server/src/agentkit/**` | 新增（11 个文件） |
| `apps/server/src/orchestrator.ts` | 记忆工具搬走、`beat_done` 接载荷、工具从 kit 取 |
| `apps/server/src/workshop.ts` | 工具搬到 kit、提示词改名 |
| `apps/server/src/workshopAssets.ts` → `playAssets.ts` | 改名 + 立绘角色可自动注册 |
| `apps/server/src/playhouse.ts` | `PlayAssets` 提到剧目级、去掉 `preloadSprite` 现场造实例、模型按剧目解析、目录端点 |
| `apps/server/src/prompt.ts` | 停止点/预发射段改写成工具说明 |
| `apps/server/src/compaction.ts` | `beat_done` 渲染 args |
| `apps/server/src/http.ts` | `GET /api/agents/models`、`GET /api/agents/tools` |
| `apps/web/src/workshop/**` | 新增 `AgentPane`，`view.ts` 加页签 |

## 五、验证

- core：golden（撕裂等价 chunk=1/2/3/5/7 + 消息边界 + 旧标签降级）、lineage 回归。
- server：`orchestrator.test.ts`（beat_done 载荷 → stop 事件/停止点/谱系）、`workshop.test.ts`（工坊 kit 装配）、`workshopAssets.test.ts` → `playAssets.test.ts`（自动注册 stub）、`compaction.test.ts`（选项仍在）、`http.test.ts`（两个目录端点）、`prompt.test.ts`。
- 真机 e2e：起 dev worktree，跑一条完整演出（有选项、有生图）+ 工坊改设定 + Agent 页签改模型。

## 六、风险

| 风险 | 对策 |
| --- | --- |
| 剧作家模型仍在写 `<stop>`（习惯） | 旧标签静默降级；提示词把工具写法讲透；beat 收束完全依赖 `beat_done`，忘了调用会走到空轮护栏（已有） |
| 预发射时机从「解析到即发起」变成「工具回合」 | 图更晚一点发出；回执变长了（模型知道有没有跳过），这正是工具化的真收益 |
| `no_stop` 率可能上升 | 工具比标签好写；上升本身不坏（更自然的节奏），真出问题再议 |
| 改 `play.json` 契约影响老档 | `agents` 可选，缺省即默认行为；老档读出来不变 |
