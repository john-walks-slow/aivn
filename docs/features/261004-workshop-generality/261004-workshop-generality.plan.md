# 搭台助手通用化：pi 工具基座（无自研沙箱）

> 计划日期 2026-10-04。分支 `feat/workshop-shell`（worktree `.worktrees/workshop-shell`，从 main `db735bd` 开）。
> **2026-10-04 修订**：删掉自研牢笼方案，改为「复用 pi 的 `NodeExecutionEnv` + 内建工具，不做进程隔离」。修订依据见 §1。

## 一、决策：为什么不上自研沙箱

三条实查事实（本轮重新核对，不是推演）：

| 事实 | 证据 |
|---|---|
| pi 不提供沙箱 | `@earendil-works/pi-agent-core@0.87.1` 全包搜 `sandbox` **零命中**。它只给 `ExecutionEnv` 抽象缝与 `NodeExecutionEnv`（纯 Node、跨平台）。隔离明确归宿主。 |
| 唯一可参照的通用形状是「按平台插后端」 | DSH 自己的沙箱：`ctx.sandbox.confine(argv, policy) → argv'`，模式 read-only / workspace-write / danger-full-access，后端 = bwrap / Landlock / Seatbelt / Windows-ACL，探测不到即 **fail-closed**（`SANDBOX_UNAVAILABLE`，绝不裸跑）。**它也没有、也不可能有「一个通用后端」。** |
| 那些后端在本机一条都不可用 | `unshare -Ur` → EINVAL（内核未开 `CONFIG_USER_NS`）→ bwrap 起不来；内核 `4.19.325` < 5.13 → 无 Landlock；非 root 下 `unshare -m` → EPERM。 |

于是自研牢笼（`unshare -m` + `chroot` + `mount --bind` + `setpriv`）的形状是「Linux-only + 必须 root + 专门为本机缺 user namespace 而写」——正是最不该进代码的那种定制。**结论：不写沙箱。**

bash 以服务进程的权限运行（本机 = root）。隔离是**部署**的事，README 写清；将来真要隔离，`exec` 那道缝只有一个函数宽，届时按平台插后端即可，工具层一行不动。

## 二、目标与判据

搭台助手从「一套自研工具 + 一份手写提示词」变成「一个 pi agent + 一个工作区」。文件读写与命令行全部走 pi 的内建工具与 `ExecutionEnv` 抽象，我们只保留真正属于这个产品的领域工具（生图、资源库、故事树、音色、技能、联网、看图）。

做完用五条判据验收：

1. `agentkit/editText.ts` 删除；`filesTool.ts` 的 `list_files`/`read_file`/`write_file`/`edit_file`/`delete_file` 删除，换成 pi 的 `read`/`write`/`edit`/`bash`。
2. 搭台助手能用 `grep` / `jq` / `sed` / `git diff` 干活。
3. 系统提示词不再复述工具契约：`workshop.ts` 的 `imageGuide` 中画幅、并发、neutral 顺序、失败转述四类内容全部移除（画幅那条当前还是错的，见 §3.2）。
4. **不新增任何配置项**；`bash` 的开关走现有的工具开关（`play.json` 的 `agents.workshop.tools`），默认关。
5. `playEnv.ts` 是对 pi `NodeExecutionEnv` 的**装饰**：只覆写 3 个方法，16 个 `FileSystem` 方法一个都不自己写。

## 三、现状

### 3.1 三处重造（行数为实测）

| pi 已提供 | 我们的做法 | 行数 |
|---|---|---|
| `createReadTool` / `createWriteTool` / `createEditTool`（签名只吃 `ExecutionEnv`） | `filesTool.ts` 自写 + `editText.ts` 移植 pi 的 `edit-diff` | 238 + 241 |
| `withFileMutationQueue` | `fileLocks`（注释自承「pi 的 file-mutation-queue 的最小版」） | 22 |
| `NodeExecutionEnv`（16 个 `FileSystem` 方法，纯 Node） | 原计划手写 `PlayFilesEnv implements ExecutionEnv` | — |
| `createBashTool`（含 2000 行 / 50KB 截断 + 溢写 + 2s checkpoint） | 没有 shell | — |

`agentkit/` 合计 2159 行，其中约 590 行属于这一类。已正确复用的：`skills.ts`（`loadSkills` + `formatSkillsForSystemPrompt` + `NodeExecutionEnv`）与 `compaction.ts` 的 token 计量。

### 3.2 提示词复述工具契约，且已漂移

`workshop.ts` 的 `imageGuide`（第 180 行）写着「背景 16:9、CG 16:9、立绘 **9:16** 竖构图全身」，而引擎与工具早已是三档 framing（`full` 9:16 / `half` 3:4 / `square` 1:1，SSOT = `play/framing.ts`）。同一批内容（画幅、一次一张、neutral 先出、失败原话转述）在 `imageTool.ts` 的 `SYNC_DESCRIPTION` 里又写了一遍。AGENTS.md 写着「工具知识只写在工具描述里，系统提示词不复述」——这条规矩在工坊提示词上没执行。

### 3.3 同步点靠人记

`TOOL_CATALOG`（kit.ts）/ `ROLE_INSTALLABLE`（role.ts）/ `DEFAULT_ENABLED`（kit.ts）/ 两个角色工厂，四处要一起改，靠 `agentkit.test.ts` 一条用例兜。

## 四、设计

### 4.1 `PlayEnv`：装饰 `NodeExecutionEnv`，不重写

pi 的 read/write/edit/bash 实际只用 7 个 env 成员（实测 `dist/harness/tools/*.js`）：`absolutePath`（read/write/edit 的唯一路径入口，经 `path-utils.js` 的 `resolveToolPath` 调用）、`exists`、`readBinaryFile`、`readTextFile`、`fileInfo`、`writeFile`、`exec` + `cwd`。

`NodeExecutionEnv` 把这 16 个方法**全实现好了**（纯 `node:fs` + `child_process`，跨平台）。所以新文件 `agentkit/playEnv.ts` 是它的子类，只覆写三处：

```
class PlayEnv extends NodeExecutionEnv {
  // 读面白名单：absolutePath 是 read/write/edit 的唯一路径入口
  absolutePath(p, ctx)  → PlayFiles 可见性不过 → err(new FileError("permission_denied", …))
                          （pi 的 resolveToolPath 会 getOrThrow 抛出，模型看到一条可恢复的错误）
  // 写面：走 PlayFiles.write（已含白名单），play.json 先过 parsePlayConfig，再挂撤销条
  writeFile(p, c, ctx)  → play.json 校验不过 → err(invalid)
                          否则 before = 读旧内容 → files.write(rel, c) → onWrite({path, before, after})
  // shell：cwd 已由构造参数设为剧目目录；这里显式覆写，把「将来插隔离后端」的位置留在明面上
  exec(cmd, opts, ctx)  → super.exec(cmd, opts, ctx)
}
```

其余方法全部继承。`fileLocks` 随之删除——pi 的 `withFileMutationQueue` 已在 `write.js` / `edit.js` 内部使用。

`absolutePath` 只做**读面**判定：写面判定发生在 `writeFile` 里，那里知道这是一次写。`play.json` 在两面都可见，`edit` 的读→改→写链路因此通得过。

### 4.2 适配器 `piTools.ts`（约 15 行）

pi 的内建工具是 `AgentHarnessTool`，`execute` 比 `AgentTool` 多三个参数（`onUpdate` 在前、`toolContext`、`invocation`、`context`）。用一层包装函数把 `{ env }` 当 `toolContext`、`withAbortSignal(signal, BACKGROUND_CONTEXT)` 当 `context` 传进去即可；`invocation` 用不到（这几个工具都不读它）。

**pi 的工具描述是英文**，且 `read`/`write`/`edit`/`bash` 都没有覆写 description 的入口。接受——设置页显示的 `label` 仍从 `TOOL_CATALOG` 取中文，模型侧中英混排无碍。这是「不 fork pi 工具」的价钱，写在这里免得日后当 bug 查。

### 4.3 工具清单变化（搭台助手）

| 工具 | 变化 | 说明 |
|---|---|---|
| `list_files` | **删** | 提示词每轮已经注入文件清单，`ls` 也能干 |
| `read_file` / `write_file` / `edit_file` | **换成 pi 的 `read` / `write` / `edit`** | 名字、描述、schema 全部用 pi 的 |
| `delete_file` | **删** | `rm` 覆盖。**注意：删除保护随之消失**——bash 是全权的，这是不写沙箱的直接代价（§6.2） |
| `bash` | **新增** | 本计划的主角；默认关 |
| `view_image` | 保留 | 它多了「读网址 + 缓存」这一支，pi 的 read 没有；强行合并会让 `read` 身兼两职 |
| `get_readiness` / `generate_image` / `recut_sprite` / `read_skill` / `list_saves` / `read_lineage` / `list_library` / `import_asset` / `list_voices` / `web_search` | 不动 | 领域工具 |

净变化：16 → 15 个（删 5、加 4）。剧作家的清单**一个都不动**：它是在 240 秒预算里流式写 DSL 的，要的是稳定的 KV 前缀与最少的分叉，不是通用性。

- `TOOL_GROUPS` 新增 `shell: "命令行"`；`read`/`write`/`edit` 归入现有的 `files: "剧目文件"`。
- `TOOL_CATALOG`：21 → 20 条。
- `DEFAULT_ENABLED.workshop` **从 `[...ROLE_INSTALLABLE.workshop]` 改成显式的 14 条**（去掉 `bash`）。「搭台全开」的口径变为「全开，除 bash」，`AGENTS.md` 与 README 同步改。
- `AgentCapabilities` 新增 `shell` 位（`has("bash")`）。

### 4.4 提示词收敛

1. **删** `imageGuide` 里与 `imageTool.ts` 重复的四类内容：画幅数字（**那行现在还写着「立绘 9:16 竖构图全身」，与 framing 三档矛盾——是个已漂移的 bug**）、「一次调用一张、同批并行」、「先出 neutral 再出差分」、「失败把接口原话带给用户」。留下的只有角色职责：什么时候该出图、要不要用户批准、`generate_image` 的图要给用户看。
2. **新增**一节「工作区」（约 5 行，按 `canShell` 注入）：bash 以服务进程的权限运行，能碰这台机器上该进程能碰的一切；`read`/`write`/`edit` 仍限在剧目目录的白名单内；改文件优先用 `write`/`edit`（有结构校验与撤销条），bash 的改动不进撤销条。**工具本身的用法（cwd、输出截断、超时）在 pi 的 bash 描述里，不复述。**
3. **`can*` 收成一个对象**：`WorkshopPromptContext` 现在摆着 `canGenerate`/`canSearch`/`canBrowseLibrary`/`canVoices` 四个布尔，而 `workshopSession.ts:373-376` 已经在做 `kit.can.image → canGenerate` 这种逐项改名。改成直接收 `can: AgentCapabilities`——加 `shell` 位时就不必再动两处。

### 4.5 协议与前端（薄）

- bash 跑起来时复用现有的 `workshop_tool`（`packages/core/src/ws/protocol.ts:220`）显示「正在运行 bash…」，先跑通。
- **P2（可选）**：新增 `workshop_tool_output` 消息 + `runWorkshopTurn` 订阅 pi 的 `tool_execution_update`，把 pi 每 2 秒一次的 checkpoint 回显到对话流。没有它，一条 60 秒的命令对用户就是 60 秒黑屏。
- **bash 改盘要触发重建**：`runWorkshopTurn` 增订阅 `tool_execution_end`（`pi-agent-core/dist/types.d.ts:455`），`toolName === "bash"` 就置 `changedDuringTurn = true`，收束时照旧 `onFilesChanged()`。
- `AgentPane` 的工具开关自动列出 `bash`（走 `GET /api/agents/tools`），不需要额外前端改动。

### 4.6 不做的事

- **不写任何沙箱**（§1）。
- **不新增任何配置项**：`STAGE_SHELL_ENABLED` 删（工具开关就是它）、`STAGE_SHELL_NETWORK` 删（没有牢笼就没有 `--net`）、`STAGE_SHELL_MAX_PROCS` / `_MAX_FSIZE` 删、`STAGE_JAVAIL_ROOT` 删。`config.ts` 本轮一行不动。
- **不上 `AgentHarness`**：它带 session / lane / navigation / hooks 一整套控制流，与现在的 WS + 线程 + 纪元模型正面冲突。只取它的叶子件（`ExecutionEnv`、内建工具、`truncate`、`file-mutation-queue`）。
- **不给剧作家 shell**，也不动它的工具清单。
- **不迁移 `plays/` 目录**：`plays/demo` 是进 git 的种子剧目，搬出去要另造一套「模板 → 运行时」的机制，收益不抵改动。
- **不改 `PlayFiles` 的白名单语义**：`write`/`edit` 仍走它。

## 五、实现步骤

1. `agentkit/playEnv.ts`（新）：`PlayEnv extends NodeExecutionEnv`，覆写 `absolutePath` / `writeFile`（含 play.json 的 `parsePlayConfig` 校验与 `onWrite` 撤销条）。带单测。
2. `agentkit/piTools.ts`（新）：`AgentHarnessTool → AgentTool` 适配器 + `createPiFileTools(env)`、`createPiBashTool(env)`。
3. `agentkit/kit.ts` / `role.ts`：目录换新（删 5 加 4），`TOOL_GROUPS` 加 `shell`，`ROLE_INSTALLABLE.workshop` 同步，`DEFAULT_ENABLED.workshop` 改显式 14 条，`AgentCapabilities` 加 `shell`。
4. `agentkit/filesTool.ts` → `readinessTool.ts`（只留 `get_readiness`）；删 `editText.ts` 与 `fileLocks`。
5. `workshop.ts`：删 `imageGuide` 的重复段落（含那行错的画幅）、加「工作区」一节、`WorkshopPromptContext` 的四个 `can*` 换成 `can: AgentCapabilities`；`workshopSession.ts` 同步。
6. `workshop.ts` 的 `runWorkshopTurn`：订阅 `tool_execution_end`，bash 完成置脏。
7. 测试：`agentkit.test.ts` 目录表更新；新增 `playEnv.test.ts`（越界路径拒绝、play.json 校验拦截、onWrite 的 before/after）；跑 server 受影响用例。
8. 文档：README（新工具 + bash 的权限边界 + 怎么开）、`AGENTS.md` 的 agentkit 段（工具清单、「搭台默认全开，除 bash」）。

## 六、风险与边界

1. **bash 不是沙箱**。它以服务进程权限运行。本机 `~/.cloudflared` 是 0777、`~/.cli-proxy-api` 是 0755，world-readable，读得到。默认关守住了默认状态，但某个剧目一旦勾上 bash，它就是**常开的**；公网面板免密（用户 2026-10-04 拍板维持），所以「知道 URL 的人 + 已勾 bash 的剧目」＝ 这台机器上的一个 root shell。这是本方案的已知代价，写进 README。
2. **删除保护消失**：`delete_file` 的白名单约束换成 `rm`，没了。
3. **bash 写坏 `play.json` 不会被拦**：`write`/`edit` 有 `parsePlayConfig` 校验，bash 没有。兜底：bash 结束后若 `play.json` 的 mtime 变了，跑一次 `parsePlayConfig`，失败就在对话流里广播一条告警（只告警，不回滚）。
4. **单条命令没有自身超时**：pi 的 bash 只有模型给的 `timeout` 参数、无默认值；实际边界是工坊单轮的 `TURN_TIMEOUT_MS`（7 分钟），到点 abort 并杀子进程。
5. **pi 的工具描述是英文**（§4.2）。

## 七、验证

- 单测：`playEnv`（越界路径拒绝、play.json 校验拦截、`onWrite` 的 before/after）、`piTools` 适配器。
- 实机冒烟（worktree 起 dev，让搭台助手真跑一次）：`grep -rn` 命中 memory、`jq` 读 manifest、`write`/`edit` 改一个 memory 文件并在前端看到撤销条、bash 的写不产生撤销条。
- 回归范围：`agentkit` / `workshop` / `workshopPrompt` / `editFile`（改为 pi edit 后删或改写）相关用例，不跑全量。
- 不做浏览器 e2e（用户 2026-10-02 明确：改完让他自己在开着的 dev 里看）。
