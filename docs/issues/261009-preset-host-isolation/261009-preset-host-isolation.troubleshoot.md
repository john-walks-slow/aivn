# 261009 预设看到宿主全局 skill 与指令 —— 根因

## 现象

dsh-aivn 的两个 Agent 预设（`aivn-playwriter` 剧作家 / `aivn-stagehand` 搭台助手）在真实会话里看到了**宿主的全局面**：

- 技能清单（`<available_skills>` 那条 user 角色的上下文消息）里出现宿主全局层的技能 `dsh-subagent-registry-config`（由第三方插件 `@aiwayds/dsh-subagent-registry` 用 `ctx.skills.registerProvider` 注册，不在磁盘任何 skill 根下）；
- 第一条消息里被注入 `<system-reminder> … Instructions from: ~/.dsh/AGENTS.md`（整台机器的运维通例），工作区落在仓库里时还会带上那个仓库的 `AGENTS.md`。

实机证据（线上 `web` profile，`/root/plays/demo` 的一个「搭台助手」会话，日志 `~/.dsh/sessions/--root-plays-demo--/session-08ff71d5-*`）：

- `<available_skills>` 实际列了 4 条：随包的 `aivn-audio` / `aivn-play-setup` / `aivn-visual-craft` + **`dsh-subagent-registry-config`**；
- `user/message` 第 12 条就是那份 `~/.dsh/AGENTS.md` 的注入；模型当场回了一句「这份 AGENTS.md 是全局的……跟我这个搭台助手的职责关系不大」。

## 根因

### 一、指令：那一行是预设自己装的

`src/playwriter/preset.ts` 的 `rows()` 里装了一行 `@deepseek-ai/dsh-agent-instructions`。它按设计会在会话第一条消息里注入「用户全局 `$DSH_HOME/AGENTS.md` + 项目链（`.git` 根 → cwd 的 `AGENTS.md`）」。

web 部署里**宿主那一行是关的**（`dsh-web-app/cordis.patch.yml` 的 `agent-instructions: disabled`，注释写明「presets own local discovery」），所以这一行只可能来自预设自己——装上就一定会注入，没有别的开关。

### 二、技能：公开注册表无条件并全局层

`@deepseek-ai/dsh-skill` 的 `SkillRegistry.collectFresh()`：

```js
const layers = [this.layers.global, ...this.layers.chainLayers(options.scope)];
```

**每一次读取都把注册表自身的 global layer 排在最前**，再按作用域链覆盖。落在 global layer 里的是「部署级 provider」：宿主行（`dsh-base` 的 `skill-filesystem`）、以及**仓库插件在代码里注册的 runtime skill**。

预设层（`isolate` 之外的普通行）只能对**同名**技能做覆盖，删不掉一条全局技能。所以：

- `includeDefaultRoots: false` 只挡住了「根」——项目 `<root>/.dsh/skills`、`.agents/skills`、用户 `~/.dsh/skills`、`~/.agents/skills`、`$DSH_BUNDLED_SKILL_DIR`；
- **挡不住代码注册进来的 provider**。`dsh-subagent-registry-config` 就是这么漏进来的。

## 修法

1. **不装 `dsh-agent-instructions`**：删掉那一行（连同 `DSH_HOME` / `INSTRUCTION_BYTES` 常量）。这两个预设的上下文只有 persona + A 区注入 + 随包技能，宿主的 `AGENTS.md` 一条都不进。
2. **技能库收进 `isolate` realm**：把 `dsh-skill`（注册表）、`dsh-skill-filesystem`、`dsh-tool-skill` 三行放进同一个 `{ name: 'cordis:group', group: true, isolate: { skills: true } }` 组。组内 `ctx.skills` 解析到**预设自己的一份注册表实例**——它的 global layer 是**空的**（`layers` 是实例字段），只有组内这几行往里注册，于是清单里只剩随包的三份。

   这条链的两端也自动跟着走：`skill` 工具用插件自己的 `ctx`（在 realm 内）读那份私有注册表；浏览器侧的技能清单走 `sessionSkillCatalog` 远程，它用 `presets.serviceFor(agent, 'skills')`（即 `serviceForAgent`）**按 fiber 归属**找实现在哪份注册表里，同样命中 realm 内那份。

   反过来，如果只把 `dsh-skill` 挂进预设而**不加 isolate**：宿主那份 `skills` 已经注册过的剖面（web 就是）会先撞 `service "skills" has been registered`；宿主没注册 `skills` 的剖面，则由 `mountPreset` 的 root-realm 泄漏检查（`leakedServices`）拒绝装配。两条路都装不上——所以「预设能正常装配且有技能清单」本身就是 realm 生效的证据。

## 已知残差（本次不动的）

- **冷会话的 `/skill` 菜单**：`sessionSkillCatalog.list`（`dsh-api-session-controller`）取注册表的写法是 `presets.serviceFor(live, 'skills') ?? this.ctx.get('skills')`——`live`（该会话的 Agent）还没起来时回落到**宿主那份**注册表。于是「会话已打开、Agent 未 resume」这个窗口里，菜单会列出宿主的全局技能、却不含三份 aivn-*（改动前那个窗口是「宿主技能 + aivn 技能都在」）。这是上游的取法，插件侧没有能同时满足「隔离」和「补上冷窗口」的干净手法（往宿主全局层注册 runtime skill 会污染所有其它预设的菜单）。命中后 `skill` 工具的 user 调用路径按 realm 解析、找不到就不注入，属静默无操作，不损坏数据。
- **非 web 剖面**：`dsh-agent-instructions` 的注入是宿主平面的 `agent/pre-step` 监听器，预设层无从阻止。默认 `dsh-base` 剖面里宿主那一行是开着的，所以只有 web（或自行关掉那一行的剖面）才是「一条指令都不进」。
- **宿主平面的全局提示词段仍在**（「You are an AI agent powered by DeepSeek Harness」、Web GUI 段、deliverable-file-references 等）：这是既有状况，与本次的 skill/指令隔离无关，本轮不动。
