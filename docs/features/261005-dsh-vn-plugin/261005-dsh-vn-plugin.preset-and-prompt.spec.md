# 剧作家预设 · 实施规格

工作区：`/root/projects/dsh-aivn`（git 仓库，分支 main）。**只在这个仓库里改文件。**
参考源码（只读，不要改）：`/root/projects/stage-ai/`（AIVN 本体）。

## 背景

`dsh-aivn` 是把 AIVN 的舞台引擎做成 DSH 插件。宿主半边的真实管线已经跑通：

- `src/session.ts` —— 会话工作区即剧目根，`PLAYWRITER_PRESET = 'aivn-playwriter'`、`STAGEHAND_PRESET = 'aivn-stagehand'` 两个常量已经在这里；
- `src/hub.ts` —— 每会话一条带序号的 IR 流；
- `src/stage-tap.ts` —— **只接 `aivn-playwriter` 预设的会话**，把助手流的文本增量喂进 `@aivn/core` 的 `StageDslParser`，解析出的事件进 hub；
- `src/routes.ts` —— `/aivn/stream`（SSE）、`/aivn/input`、`/aivn/play`。

现在缺的是**剧作家本人**：一个 DSH 预设 + 一份提示词 + 一组工具。做完这一块，用户就能新建一个跑剧作家预设的会话，让它写一场戏，舞台 tab 里逐字长出台词。

## 要做的事

### 1. 注册预设（`src/playwriter/preset.ts`）

用 `ctx.agentPresets.register(definition)` 注册预设（类型见
`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-preset-registry/lib/types/definition.d.ts`）：

```ts
{
  id: 'aivn-playwriter',            // 必须等于 src/session.ts 的 PLAYWRITER_PRESET
  name: '剧作家',
  description: '写 Stage DSL 的剧作家：实时为一部正在直播的视觉小说写剧本',
  plugins: [ ...行... ],
}
```

行（`plugins`）参考 `~/.dsh/.agent-presets/dev/agent.cordis.yml` 的写法，至少包含：

- `@deepseek-ai/dsh-agent-instructions`（config 里给 `dshHome`、`instructionFileCandidates`）
- `@deepseek-ai/dsh-persona`（`config.prefix` = 剧作家提示词，见下）
- `@deepseek-ai/dsh-tool-bash`（非 win32）、`@deepseek-ai/dsh-tool-fs`、`@deepseek-ai/dsh-tool-fs-search`

**绝对不要在预设里列 `dsh-aivn` 自己**：宿主已经装了本插件，预设里再来一行会重复装路由与事件订阅。

同时注册一个 `aivn-stagehand`（搭台助手）预设占位即可——本阶段它只需要存在、有一个能生成素材的最小行集（可先与剧作家同构，提示词写「你负责备料」），工具留给下一阶段。

### 2. 提示词（`src/playwriter/prompt.ts`）

把 AIVN 的剧作家提示词搬过来。源文件与相关模块（**只读**）：

- `/root/projects/stage-ai/apps/server/src/prompt.ts`（524 行，正文来源）
- `/root/projects/stage-ai/apps/server/src/craftParams.ts`
- `/root/projects/stage-ai/apps/server/src/agentkit/*.ts`（工具的 description 与参数，也要搬）
- `/root/projects/stage-ai/packages/core/src/dsl/spec.ts`（DSL 标签规范）

要求：

- **逐节搬运，不要重写、不要压缩掉规则**。那是产品核心资产，改的是宿主事实，不是文风。
- 只改这些 DSH 事实差异：
  - 没有 WS/编排器：停止点由 `beat_done` 工具产出（AIVN 里也是工具，语义照搬）；
  - 工具名保持一致：`beat_done`、`update_state`、`get_readiness`、`list_library`、`set_craft`、`read_skill`（本阶段先实现前四个 + `set_craft`）；
  - 剧目根 = 会话工作目录（`{{cwd}}` 在 persona 里可用），文件系统工具直接可用，凡是「宿主会替你导入素材」这类引擎行为，按 DSH 侧实际存在的能力写，不存在的能力不要写进提示词（**这一条最重要：提示词里不许出现插件没实现的能力**）。
- 提示词里所有示例 id 用通用占位（如 `bg_room`、`alice`），不要出现本机真实剧目内容。
- 动态部分（写作参数、角色表、素材清单、当前状态）**本阶段先不做**，静态部分留给 `persona.prefix`；在文件顶部注释里写明「动态段落待 Phase 2 由插件按会话注入」。

### 3. 工具（`src/playwriter/tools.ts` + 每个工具一个文件）

- 用 `defineTool`（`@deepseek-ai/dsh-tools`）定义，注册时机与范式照抄
  `/root/projects/dsh-live-mode/src/camera-tool.ts`（`ctx.on('agent/created', ...)` 里按预设判断后 `agent.ctx.tools.register(def)`）。
- 本阶段实现：
  - `beat_done` —— 一轮的收束，参数照 AIVN 的 `agentkit/beatTool.ts`；执行时向 `StageHub` 追加 `{kind:'stop', stopType, options, placeholder}`，让舞台出现停止点。
  - `update_state` —— 写记忆卡（照 `memoryTool.ts` 的语义；落盘位置在会话工作目录里，具体文件名照 AIVN 的约定 `memory/…`）。
  - `get_readiness` —— 报「这座剧目还缺什么」（照 `readinessTool.ts`；本阶段素材靠手工放置，检查 `play.json` + `assets/` 目录即可）。
  - `list_library` —— 本阶段可以只列剧目内的素材清单（资源库导入属 Phase 2，提示词里对应的段落要相应删掉或改成剧目内口径）。
  - `set_craft` —— 写回 `play.json` 的写作参数（照 `craftTool.ts`）。
- 工具的 `description` 要写清「调了会发生什么、不调会怎样」，参数用 union/AND 语义明确表达（用户特别强调：**Agent 工具接口是第一等消费者**，形状先按「模型怎么调用它」定）。

### 4. 接线

`src/index.ts` 里把预设注册与工具注册装上：`agentPresets` 是插件要直接访问的 ctx 服务，
**必须加进 `inject` 数组**，否则运行时会抛 `cannot get property X without inject`。

## 验证

1. `npm run typecheck` 与 `npm run build` 通过。
2. 起 e2e 实例（技能 `dsh-e2e`：`dsh-e2e start --wait-ready`，home 在 `.dsh-e2e-home`；
   注意这个 home 冷启时没有可用的 LLM provider，要把你自己 profile 里那条 provider 配置与它用的
   API key 环境变量一起带进去，否则 GUI 会被「Add an API key」挡住），
   确认插件加载后 `~/.dsh` 之外没有报错、预设列表里能看到「剧作家」。
3. **真跑一轮**：新建一个会话选「剧作家」预设，工作目录指到一个含 `play.json` 的目录（可自己造一个最小 `play.json`，字段照
   `@aivn/core` 里 `PlayConfig` 的类型声明），发一句「演一段：雨夜，两个人在便利店门口」，
   确认：舞台 tab（`/aivn/stream?session=<id>`）里逐字长出台词、`beat_done` 让停止点出现。
   真 LLM 只跑这一轮，不要反复重跑。
4. 把你造的测试剧目放在**仓库外**的临时目录（如 `/tmp/aivn-play-test/`），不要提交进 git。

## 交付

回复：新增/改动文件清单、上面四项验证的逐条结果（含关键命令与真实输出摘要）、以及任何你判断需要我知道的偏差。
文字简洁，不要复述规格。
