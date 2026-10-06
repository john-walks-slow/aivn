# dsh-aivn 插件设置进入 DSH 设置界面 —— 实施计划

调研日期：2026-10-06。DSH 安装包版本：`0.1.7-rc.2`。
下文「包根」= `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`；「插件仓库」= `/root/projects/dsh-aivn`。所有行号按当日安装包/仓库实测。

---

## 1. 机制的准确形状（全部已核实）

### 1.1 `.volatile()`：schemastery 的 API

- 属于 `@deepseek-ai/schemastery@3.18.4`（插件仓库已依赖同版本）。
  - 接口声明：包根 `schemastery/src/index.ts:165-166` ——「Parse this config field as a stable reference containing immutable data; its type and UI metadata remain unchanged」，返回的 schema 输出支持 `get()`，**字段缺省时也有 `get()`**。
  - 实现：`schemastery/src/index.ts:480-483`（`extra('volatile', true)`，只置 `meta.volatile` 标志，见 `:115-117`）。
  - 解析包装：`schemastery/src/index.ts:516-527` —— 解析时先按内层 schema 正常取值（含 default），再 `createVolatile(value)` 包成稳定引用。
  - 嵌套限制：`schemastery/src/index.ts:488-513` —— volatile 字段必须落在固定对象路径上；外层 volatile 的子节点不得再标 volatile；数组/dict 的 **元素 schema** 内也不能再标（`sKey`/`inner`/`list` 子节点一律 blocked）。数组字段本身可以整体 volatile（`dsh-llm-deepseek` 的 `models` 就是：包根 `dsh-llm-deepseek/lib/index.js:321`）。
- 引用类型 `Volatile<T>`：包根 `cosmokit/src/volatile.ts:8-12` —— 只有一个 `get(): VolatileSnapshot<T>`；快照深冻结只读（`:18-32`）。cordis 再导出该类型：包根 `cordis/lib/types/index.d.ts:16`。
- **语义要点**：引用对象在插件整个生命周期内保持同一身份，装载后改值只换快照（cosmokit `updateVolatile`，`volatile.ts:84-86`）。所以宿主代码可以 `const tts = config.tts` 拿住引用，之后每次 `tts.get()` 都是现值。

### 1.2 变更怎么提交：loader 不重挂、发事件

- `cordis-plugin-loader/src/config/entry.ts:143-152`：Entry.update 发现**只有 config 变**、fiber 活跃、且 `equalExceptVolatile`（`src/config/diff.ts:43`）判定差异全在 volatile 字段时，走「不 remount」分支。
- `entry.ts:158-194` `_commitVolatile`：把新 config 重解析后写进**运行中 fiber 的既有引用**，然后 `fiber.ctx.emit(self, 'loader/volatile-update', paths)`。事件声明：`cordis-plugin-loader/src/index.ts:28-34` ——「dispatched to the owning fiber only」，参数是变更路径数组，**值在派发前已提交**。监听器抛异常只记日志、不影响提交（`entry.ts:190-193`）。
- 概览文档：包根 `cordis-plugin-loader/README.md:50-52`「Volatile configuration」节。
- in-tree 订阅范例：
  - `dsh-experimental-speech-to-text/lib/index.js:21-23`：`ctx.on("loader/volatile-update", () => this.changed())`。
  - `dsh-llm-deepseek/lib/index.js:2264-2275`：订阅后重读 options、值没变就跳过、变了就 `registration.replace(...)`。

### 1.3 插件怎么读、怎么知道变了

- 读：每次使用时 `config.<field>.get()`。范例 `dsh-agent-preset-registry/lib/index.js:472-474`（声明 `selectedDefault: z.string().volatile()`）与 `:493-495`（`get defaultId() { return this.config.selectedDefault.get() ?? this.config.default }`）；`dsh-web-search-deepseek/lib/index.js:285-286`（`config.apiKey.get()`）。
- 订阅：在插件自己的 `apply(ctx, config)` 里 `ctx.on('loader/volatile-update', (paths) => ...)`（事件只派给拥有者 fiber，我们的 ctx 就是）。
- 只想「用到时拿新值」的路径（工具执行、提示词组装）不需要订阅，`.get()` 现读即可。

### 1.4 dsh-settings 服务：表单从哪来、写到哪、怎么防冲突

- 挂载：**dsh-base bundle 自带**，插件不用加任何行——包根 `dsh-base/cordis.patch.yml:97-98`（config-editor 行）与 `:101-102`（settings 行）。任何 dsh-base 打底的剖面（含 e2e 实例）都有。
- 服务面（包根 `dsh-settings/lib/types/index.d.ts`）：
  - `SettingsForms.describe(options)` `:96`：返回按 **profile entry id**（= namespace）索引的描述符，只含 volatile 字段派生出的表单 schema。
  - `update / replace / mutate` `:102-114`：三种写法；`mutate` 接受路径算子（`set`/`unset`），专为「客户端只见脱敏视图」设计——`SettingsPathOp` 文档 `:45-60`。
  - `configure({ auto: false }, ctx.fiber)` `:80-82`：自带页面的插件注册「不要自动生成页」策略。
- 写入落点：`dsh-settings/lib/index.js:501-541` `write()` —— 找 `row.options.id === ns` 的 Loader 行，经 `ctx.configEditor.edit(entry, ...)` 落盘。config-editor（包根 `dsh-config-editor/lib/types/index.d.ts:34`）把结果**原子写进 active profile 的 cordis.patch.yml**（对 e2e 实例即 `.dsh-e2e-home/profiles/web/cordis.patch.yml` 的 `dsh-aivn` 行 `config:` 段；README「Save plugin configuration in the active profile's patch and apply it immediately」）。随后 loader 走 1.2 的 volatile 提交，全程不重启。
- 写入校验：`write()` 里 `isVolatilePath` 检查（`lib/index.js:505`、实现 `lib/types/schema.js:78-84`）——**非 volatile 路径直接抛错**；secret 字段允许 set（volatile 叶子路径跳过 validatePaths，`lib/index.js:508-518`）。
- 未改字段的保留：`mutate` 把 ops 应用在**未脱敏**的当前投影上再整体合并（`lib/index.js:488-499` + `:535-541` 的 `strip`+`mergeLayers`）——改 `ttsBaseUrl` 不会动到已存的 `ttsKeys`。web-search 页面改端点不丢 key 即此机制。
- 冲突拒绝：描述符带单调 `revision`，写时对不上抛 `SettingsConflictError`（`lib/types/index.d.ts:30-44`）。
- 变更广播：宿主侧 `settings/document-updated` 事件（`lib/types/types.d.ts:64-74`），客户端镜像据此刷新（客户端无需我们写代码）。

### 1.5 密钥字段怎么处理（不回传明文）

- 声明：字段上 `.role('secret')`（可与 `.volatile()` 叠加，范例 `dsh-web-search-deepseek/lib/index.js:237` `z.string().role("secret").volatile()`）。
- 脱敏：`redactSecrets`（`dsh-settings/lib/types/redact.d.ts:28-37`，实现 `redact.js` 的 `walk()`，判 `node.meta?.role === 'secret'`）把该字段从 value、继承层、user 覆盖层、schema default 里全部移除，只发 `{ path, set: boolean }` 边车（`SettingsSecretView`，`dsh-settings/lib/types/types.d.ts:7-12`）。客户端从 describe 镜像读边车（`dsh-client-ui-settings/lib/types/client/settings-mirror.d.ts:8-24`；`SettingsNamespaceView.secrets` 在 `types.d.ts:34`）。
- **secret 字段不要带 `.default()`**：边车 `set` 判的是「值是否存在」（`redact.js` `set: value !== undefined`）——`default('')` 会让空串永远报「已配置」。web-search 的 `apiKey` 就没带 default。空值语义（如 imageApiKey 缺省=不带鉴权头）在宿主侧 `?? ''` 兜。
- 写：普通表单算子即可（`{op:'set', path:['ttsKeys'], value:[...]}` 整组替换；`{op:'unset', path:['ttsKeys']}` 清除回默认）。web-search 把 key 走 credentials 域是因为它的 key 与 Models 页共用同一个引用（`dsh-client-ui-settings-web-search/lib/client.js:136-153` 注释），dsh-aivn 的 key 是插件私有的，**留在配置文件 + role('secret') 脱敏即可，不接 credentials**。

### 1.6 客户端表单：namespace、槽位、表单模型

- namespace = **profile entry id** = `dsh-aivn`（插件仓库 `cordis.patch.yml` 的 `- id: dsh-aivn`）。客户端 `ctx.configForms.get('dsh-aivn')` 拿到该条目的读/写面：包根 `dsh-client-ui-settings/lib/types/client/config-form.d.ts:145-150`（`get(entryId)`）；`ConfigForm` 的 `getSnapshot/subscribe/mutate/set/unset` 见 `config-form-types.d.ts:36-77`。
- 表单模型与控件（包根 `dsh-client-ui-primitives/lib/types/settings-form/`）：
  - `SettingsFormModel(scope, specs, secretSpecs?)`：`form-model.d.ts:148-163`。save 先发一段 revision-fenced 的 `mutate`，再跑外置 secret 写（`lib/index.js:7066-7090`）。
  - 现成字段 spec 只有 `settingsTextField` / `settingsNumberField`（`form-model.d.ts:133-140`）。**自定义 spec 的 `parse` 可返回任意 JSON 值**（`SettingsFieldWrite.value: unknown`，`form-model.d.ts:58-76`）——表单字段不是只能标量。
  - **真正的形状约束**：`plan()` 生成的算子路径永远是单段 `path: [field]`（`lib/index.js:7121`、`:7133`、`:7140`）——**字段必须位于 namespace 顶层**。这就是 Config 必须扁平化的依据（见 §2.1）。
  - 控件：`SettingsValueField`（文本/数字，带 Overridden 徽标与 Reset）、`SettingsSecretField`（只写控件：永不回显、只报 configured 状态，`fields.d.ts:57-69`）、外框 `SettingsForm`（`SettingsForm.d.ts:23-36`）。
  - 两个客户端小坑（已核实，方案里要处理）：
    1. secret 字段的 user 层被脱敏 → `stored(field)` 恒 false（`lib/index.js:7170-7173`）→ 标准的 resetField **发不出 unset**。清除密钥要卡片自己加「清除」按钮直接 `scope.mutate([{op:'unset', path:['ttsKeys']}])`。
    2. 空白草稿不产生写（`plan()` 里 `staged.text === spec.format(sectionValue)` 即跳过，`lib/index.js:7129`）——密钥留空=保持现状，正好是要的语义。
- 槽位与页面：
  - 插件管理页（Plugins）声明三个配置槽（包根 `dsh-client-ui-plugin-manager/lib/types/client/slot-contract.d.ts:82-107`）：`plugins.item`（官方伙伴页占位，注释明说「a bundle's configuration belongs in `plugins.bundle.config` or `plugins.row.config` instead」）、`plugins.bundle.config`（**按 npm 包名 keyed**，渲染在 bundle 详情页描述与行列表之间，只出 `view:'page'`）、`plugins.row.config`（按 `包名#行id` keyed）。
  - dsh-aivn 是 profile 里自装的 bundle → 配置卡注册进 **`plugins.bundle.config`，key = `"dsh-aivn"`**。同包自带配置页的 in-tree 范例：`dsh-experimental-client-ui-voice-input/lib/client.js:5798-5803`（`ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({ name, key: "<包名>", locale, inject }, Component))`）。
  - 注册建议裹 `ctx.configForms.whileServed(['dsh-aivn'], ...)`（API：`config-form.d.ts:152-156`；范例 `dsh-client-ui-settings-web-search/lib/client.js:307-314`）：宿主半边停用或还没装载时不出卡。插件停用时同包客户端是否仍加载——未验，whileServed 两种情况都兜住。
  - 页面可达性：Plugins 页 Installed 组列出 profile 的 bundle（`PluginManagerPage.d.ts:2-7`），dsh-web-app bundle 已带 ui-settings / ui-plugin-manager 行（`dsh-web-app/cordis.patch.yml:282-295`），e2e 实例（dsh-base + dsh-web-app + 插件）开箱即有该页。
- 客户端注入声明：模块内 `inject` 数组加 `'configForms'`（服务由 `@deepseek-ai/dsh-client-ui-settings` 客户端提供，声明见 `config-form.d.ts:92-98`；范例 `dsh-client-ui-settings-web-search/lib/client.js:283-289`）；`package.json` 的 `dsh.client.inject` 加 `"@deepseek-ai/dsh-client-ui-settings"` 与 `"@deepseek-ai/dsh-client-ui-plugin-manager"`。`require('@deepseek-ai/dsh-client-ui-primitives')` 在 web-search 客户端未声明依赖也用（`lib/client.js:8`），说明走共享模块注册表解析——e2e 里再实测一遍（未验项）。

### 1.7 宿主插件要不要动依赖

- 不用挂 dsh-settings 行、不用加运行时依赖：服务由 dsh-base 提供。
- 要加的两样：
  1. devDependency `@deepseek-ai/dsh-settings`（`ctx.settings` 的 TS 声明来自它，`lib/types/index.d.ts:24-29` 的 `declare module`）。
  2. devDependency `@deepseek-ai/cordis-plugin-loader`（`loader/volatile-update` 的事件类型声明来自它，`src/index.ts:28-34`；in-tree 订阅方都把它列为 peer，如 `dsh-experimental-speech-to-text/package.json`）。两者都是类型引用，运行时从 DSH 安装树解析（宿主 bundle 的 external 已含 `@deepseek-ai/*`，`build.mjs:26`）。
- 自带页面的插件注册 `configure({auto:false})`（可选但 canonical）：`ctx.inject(['settings'], (child) => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)))`，范例 `dsh-agent-preset-registry/lib/index.js:485-486`。settings 不在时该子上下文不跑、业务照常（README「the business plugin runs without Settings」）。

---

## 2. 字段清单与分组

### 2.1 形状决定：Config 扁平化 + 全字段 volatile

- 依据：客户端表单模型的算子路径只有单段（§1.6），嵌套字段（`tts.keys` 等）无法寻址；全部 in-tree 范例也都是顶层扁平 volatile（`dsh-web-search-deepseek/lib/index.js:236-243`、`dsh-subagent/lib/index.js:2821-2824`、`dsh-bash-local/lib/index.js:69-76`、`dsh-agent-loop/lib/index.js:1518-1519`）。
- 新 Config（替换 `src/index.ts:63-157` 的接口与 schema）：

```ts
export interface Config {
  ttsKeys: Volatile<string[] | undefined>
  ttsBaseUrl: Volatile<string | undefined>
  ttsModel: Volatile<string | undefined>
  ttsConcurrency: Volatile<number | undefined>
  shell: Volatile<boolean | undefined>
  searchKeys: Volatile<string[] | undefined>
  searchBaseUrl: Volatile<string | undefined>
  imageFormat: Volatile<'gemini' | 'openai' | 'modelslab' | undefined>
  imageBaseUrl: Volatile<string | undefined>
  imageApiKey: Volatile<string | undefined>
  imageModel: Volatile<string | undefined>
  imageSize: Volatile<string | undefined>
  imageTimeoutMs: Volatile<number | undefined>
  musicBaseUrl: Volatile<string | undefined>
  musicApiKey: Volatile<string | undefined>
  musicModel: Volatile<string | undefined>
  musicTimeoutMs: Volatile<number | undefined>
}

export const Config = z.object({
  ttsKeys: z.array(z.string()).role('secret').volatile(),
  ttsBaseUrl: z.string().default('https://api.fish.audio').volatile(),
  ttsModel: z.string().default('s2.1-pro-free').volatile(),
  ttsConcurrency: z.natural().default(2).volatile(),
  shell: z.boolean().default(false).volatile(),
  searchKeys: z.array(z.string()).role('secret').volatile(),
  searchBaseUrl: z.string().default('https://api.exa.ai').volatile(),
  imageFormat: z.union([z.const('gemini'), z.const('openai'), z.const('modelslab')]).default('gemini').volatile(),
  imageBaseUrl: z.string().default('').volatile(),
  imageApiKey: z.string().role('secret').volatile(),
  imageModel: z.string().default('').volatile(),
  imageSize: z.string().default('1K').volatile(),
  imageTimeoutMs: z.natural().default(180_000).volatile(),
  musicBaseUrl: z.string().default('').volatile(),
  musicApiKey: z.string().role('secret').volatile(),
  musicModel: z.string().default('').volatile(),
  musicTimeoutMs: z.natural().default(240_000).volatile(),
})
```

- secret 三字段（`ttsKeys`/`searchKeys`/`imageApiKey`/`musicApiKey`）**不带 default**（§1.5）。
- 环境变量回退保留：`configuredKeys`/`configuredExaKeys` 改读 `config.ttsKeys?.get() ?? []` 后再走 `DSH_AIVN_TTS_KEYS`/`DSH_AIVN_EXA_KEYS`。
- 全字段 volatile 的直接后果：**任何配置改动都不再触发插件 remount**（`equalExceptVolatile` 把差异全部忽略），「改配置要重启 dsh」从此消失。

### 2.2 P0 —— 决定能力开不开（表单上半段，按此序）

| 字段 | 界面标签 | 默认 | 一句话后果 |
|---|---|---|---|
| `ttsKeys` | Fish Audio Key（多把用逗号分隔） | 未配 | 配了才有台词语音与 `list_voices`；留空可走 `DSH_AIVN_TTS_KEYS`。只写不回显 |
| `searchKeys` | Exa 检索 Key（多把用逗号分隔） | 未配 | 配了搭台助手才有 `web_search`；留空可走 `DSH_AIVN_EXA_KEYS` |
| `imageFormat` | 生图接口格式 | `gemini` | `gemini` / `openai` / `modelslab` 三选一（协议形状，非产品名） |
| `imageBaseUrl` | 生图接口地址 | 空 | 与生图模型**都给齐**才算配好生图，只给其一等于没有 |
| `imageModel` | 生图模型 | 空 | 同上；配齐后搭台助手多 `generate_image`/`commit_asset`/`recut_sprite`，剧作家多同步 `generate_image` |
| `imageApiKey` | 生图 API Key | 未配 | 本机网关不校验就不填（不带鉴权头）。只写不回显 |
| `musicBaseUrl` | 音乐接口地址 | 空 | 与音乐模型都给齐才有 `generate_bgm`（只有 Gemini 形状） |
| `musicModel` | 音乐模型 | 空 | 同上 |
| `musicApiKey` | 音乐 API Key | 未配 | 可不填。只写不回显 |
| `shell` | 搭台助手命令行（bash） | 关 | 开了才给搭台助手真装 `tool-bash` 行。**只对新会话生效**（见 §3.4），hint 里写明 |

### 2.3 P1 —— 默认可用、按口味调（表单下半段）

| 字段 | 界面标签 | 默认 | 一句话后果 |
|---|---|---|---|
| `ttsBaseUrl` | TTS 接口地址 | `https://api.fish.audio` | 换自建网关时改 |
| `ttsModel` | TTS 模型 | `s2.1-pro-free` | 换模型后同一句话不再命中旧音频缓存（缓存键含模型） |
| `ttsConcurrency` | TTS 并发上限 | `2` | 同时合成的上限：摊往返又不打空额度 |
| `searchBaseUrl` | Exa 接口地址 | `https://api.exa.ai` | 换代理/镜像时改 |
| `imageSize` | 生图档位 | `1K` | `1K`/`2K`/`4K`（K 大写）或字面像素 `1536x1024`；gemini 只认档位 |
| `imageTimeoutMs` | 生图超时（毫秒） | `180000` | 出图慢就调大 |
| `musicTimeoutMs` | 配乐超时（毫秒） | `240000` | 一首曲子实测约 84 秒 |

卡片顶部加一行只读能力状态（语音 / 检索 / 生图 / 配乐 开关灯，从 `scope.getSnapshot().value` 现算），让人不试工具也能看见能力面。

### 2.4 keys 数组的界面形状

- 自定义字段 spec：`format` 恒返回 `''`（secret 字段本来就拿不到值）、`parse` 按逗号/换行切分、trim、去空 → `{kind:'set', value: string[]}`；**纯空白输入返回 `undefined`（invalid，挡保存）**，避免「手滑清空」——清除走专门的「清除已存 Key」按钮（§1.6 坑 1）。「已配置 N 把」徽标读 secrets 边车 + user 层数组长度——边车只有 `set`，数量不可知，徽标只报「已配置/未配置」。
- 控件复用 `SettingsSecretField`（只写形态），不用 `SettingsValueField`（它带 Overridden/Reset，对 secret 无意义）。

### 2.5 不上界面的字段

- 无。现有 17 个配置字段全部上界面；`format` 之外的取值约束（`imageFormat`/`imageSize`）在 spec 的 `parse` 里校验，非法输入挡保存（表单框架原生行为，`form-model.d.ts:99`）。

---

## 3. 就地生效的架构

### 3.1 总体：runtime holder + 变更重扫

`src/index.ts` 的 `apply` 改为：

```
buildRuntime(config) → { capabilities, tts, voices, exa, media }   // 纯函数，现读全部 .get()
const runtime = { current: buildRuntime(config) }
ctx.on('loader/volatile-update', (paths) => {
  const next = buildRuntime(config)
  const capsChanged = 能力位对比(next.capabilities, runtime.current.capabilities)
  const shellFlipped = next.capabilities.shell !== runtime.current.capabilities.shell
  runtime.current = next
  if (capsChanged) resyncAgents()          // 重装/卸工具（§3.2）
  if (shellFlipped) reRegisterStagehand()  // 行集重拼（§3.4）
})
```

- 客户端对象（`FishTts`/`Exa`/音色表/生图与配乐 backend）都是无状态 HTTP 包装，整体重建零成本；在飞请求握旧实例跑完，无中断。
- 能力位计算 `resolveCapabilities` 不动（`src/stagehand/capabilities.ts:35-48`），输入由 `buildRuntime` 喂。

### 3.2 工具装/卸：已存在会话**可以**补上

- 机制：工具注册在各 agent 自己的 ctx 上（`src/preset-tools.ts:161-163` `agent.ctx.tools.register`），注册表是活的；提示词组装按次读 `ctx.tools.schemas(scope)`（`dsh-tools/lib/types/index.d.ts:708-711`「one deep-cloned schema per visible tool」，注释明说 assembly 时读取）。插件今天就依赖这一点做 `agent-preset/selected` 的卸旧装新（`preset-tools.ts:72-83`），说明生命周期中途注册是被踩实的路径。
- 改法（`src/preset-tools.ts`）：
  1. `installed` WeakMap 的登记键从 `preset` 扩为 `preset + 能力位串`；`sync()` 两者任一变了就 `off()` 后重装。
  2. 新增 `resyncAll(ctx)`：`ctx.agents.list()`（`dsh-agent/lib/types/index.d.ts:357`）全量过一遍 `sync()`，只碰我们两个预设的会话。
  3. `ToolDeps` 从持有实例改为持有 `() => runtime.current`（或直接传 runtime holder），重装自然拿到新 backend/新 exa。
- 结论：tts/search/image/music 四类能力位的工具面（`list_voices`、`web_search`、`generate_image`/`commit_asset`/`recut_sprite`、`generate_bgm`、剧作家同步 `generate_image`、`list_assets` 的 image 位）**已存在会话在下一轮就生效**。

### 3.3 persona 章节：拆「静态前缀 + 活段」，已存在会话也生效

- 现状：stagehand 的 persona 由 `stagehandPrompt(capabilities)` 在注册时拼死进预设行（`src/playwriter/preset.ts:107-112`），persona 行的 `prefix` 又被 dsh-persona 装载时烘焙成静态文本（`dsh-persona/lib/index.js:23-27,39`）——直接改不可行；重注册预设也只影响新会话（§3.4）。
- 方案：`systemPrompt.section` 的 `text` 支持**函数**（每次组装现求值；本插件已在用：`src/stagehand/context.ts:94-103`、`src/play-context.ts:130-143`）。
  1. `src/stagehand/prompt.ts` 拆两半：静态章（IDENTITY、NEW_PLAY、RESPONSIBILITY、TALK、SKILLS）留在 persona 行 prefix；能力位门控章（setupFlow 第 3 步、assetGuide、writingPoints 的音色段、MUSIC、SHELL、SEARCH）拼成 `stagehandGuide(can)`。
  2. `preset-tools.ts` 的 stagehand 分支加挂一个 `aivn:stagehand-guide` 段（`order: 40`，落在 persona prefix（order 0，`dsh-system-prompt/lib/index.js:12`）之后、language（100）之前），`text: () => stagehandGuide(capabilitiesOf())` 现读 runtime。
  3. 剧作家侧同理：`registerPlayContext` 的 `can` 参数从 `{image}` 改成 `() => {image}`（`src/play-context.ts:116-128`，快照与 `playwriterTail` 的调用点跟着现取）。
- 结论：**两个预设的能力位门控文本，已存在会话下一次组装即生效**；persona 行 prefix 只剩永不变化的章，不再需要按配置重拼。

### 3.4 shell 与行集：半就地，如实标注

- `tool-bash` 是预设**行**（`src/playwriter/preset.ts:62-63`），不是我们装的工具。预设定义重注册（dispose 后 register；register 同 id 重复直接抛错，`dsh-agent-preset-registry/lib/index.js` 的 register 实现 `Duplicate agent preset`）只影响新绑定的会话——**live Agent 保留其绑定代的行集**（`dsh-agent-preset-registry/lib/types/index.d.ts:15`「the revisions live Agents retain」；retired 代只要还有 users 就不回收）。
- 结论：shell 翻转 → 重注册 stagehand 预设（仅 shell 位翻转时做，别的能力位变化不重注册）→ **新会话生效**；已存在搭台助手会话的 bash 行保持原状，做不到补装/卸——UI 的 hint 与 README 都写明「已开的会话需新建」。
- skills 行恒在、persona 行静态化后无配置依赖 → 其余行不受配置影响。

### 3.5 VoiceHost 与 PlayAssets

- `VoiceHost` 现在构造时抓死 `tts` 与 `concurrency`（`src/voice-host.ts:31-36`），`forSession` 的 synth 闭包又捕获 `this.tts`（`:52-68`）。改法：两个字段换成 `() => FishTts | null` / `() => number` 现读访问器，`available` 与 synth 闭包都走访问器。管线按会话缓存不动，在飞合成跑完，磁盘缓存内容寻址无损失。**可以就地生效**。
- `createMediaBackends`（`src/media/backends.ts:49-78`）随 `buildRuntime` 重建，工具重装拿新实例（`generate_image` 等工具构造时收 `deps.media`，`src/preset-tools.ts:143-158`）。**可以就地生效**。

### 3.6 逐能力结论表

| 改动 | 已存在会话 | 新会话 | 手段 |
|---|---|---|---|
| tts 四字段 | ✅ 下一句台词生效 | ✅ | runtime 重建 + VoiceHost 访问器 |
| search 两字段 | ✅ 下一轮工具面 + persona 章生效 | ✅ | 同上 + 工具重扫 + 活段 |
| image 七字段 | ✅ 同上 | ✅ | 同上 |
| music 四字段 | ✅ 同上 | ✅ | 同上 |
| shell | ❌ bash 行不可变（代际保留） | ✅ 重注册预设 | §3.4 |

---

## 4. play 级设置（结论）

- **`craft` 与 `scriptLanguage`：上，上在 AIVN 舞台 tab 里的「剧目设置」面板**（P1 第二刀）。理由：它们是**每座剧目**的工作区文件（`play.json`），不是 profile 级插件配置——dsh-settings 的表单只编辑插件 Config，装不下工作区文件；舞台 tab 按会话绑定了剧目（`src/client/index.tsx` 只给剧作家会话挂 tab），是唯一有「当前剧目」语境的界面。
- 共用服务端路径：把 `src/stagehand/tools/set-craft.ts:111-148` 的执行体（readFile → `parsePlayConfig` → `mergeCraftParams` → 单键写回 → 回执文案）抽成 `src/craft-service.ts` 的 `readCraft(playDir)` / `writeCraft(playDir, patch)`；`set_craft` 工具与新增的 `GET/POST /aivn/play-config?session=` 路由（挂进 `src/routes.ts` 现有的 `/aivn/*` 家族，参照 `/aivn/voice` 的 POST 形状 `:111-113`）同源调用。`scriptLanguage` 的写回同走这个服务（改 `play.json` 的对应键，同样只动一个键）。UI 面板做在 `stage-view.tsx`，读写都打这个路由，不另起写路径。
- **`framing` / `stature` / `anchor` / `title`：不上界面，明确不做。** 它们是 `assets/manifest.json` 里**逐素材**的呈现声明（`AssetMeta`，`stage-ai/packages/core/src/play/assets.ts:50-77`），属于素材管理面（`commit_asset`/`recut_sprite` 出图时已写它们）；拿设置表单装它们等于把文件浏览器塞进设置页。将来的素材面板再谈。

---

## 5. 实施步骤

### 阶段一：宿主半边（配置面 + 就地生效）

1. **`src/index.ts`** —— Config 扁平化 + volatile + role('secret')（§2.1 代码）；`Config` 接口换 `Volatile<...>` 形状（类型从 `@deepseek-ai/cordis` 导入，`cordis/lib/types/index.d.ts:16`）；`configuredKeys`/`configuredExaKeys` 改 `.get()` 读法；`apply` 改 runtime holder + `ctx.on('loader/volatile-update')` + `ctx.inject(['settings'])` 注册 `configure({auto:false}, ctx.fiber)`（§1.7）。
   - 测试点：node 里 `Config({})` 解析 —— 各字段 `.get()` 回默认、secret 字段 `undefined`；`Config({ttsKeys:['a']})` 后引用身份不变、`get()` 换值。
2. **`src/voice-host.ts`** —— tts/concurrency 换现读访问器（§3.5）。
3. **`src/preset-tools.ts`** —— sync 键扩展 + `resyncAll` + `ToolDeps` 改持 runtime；stagehand 分支加挂 `aivn:stagehand-guide` 活段（§3.2/§3.3）。
4. **`src/stagehand/prompt.ts`** —— 拆 `stagehandStatic` / `stagehandGuide(can)`（§3.3）。
5. **`src/play-context.ts`** —— `registerPlayContext` 的 `can` 改 getter；`readPlaySnapshot`/`playwriterTail` 调用点现取。
6. **`src/playwriter/preset.ts`** —— persona prefix 用静态章；导出 `reRegisterStagehand(shell)`（dispose + register，仅 shell 翻转时调）。
7. **`package.json`** —— devDeps 加 `@deepseek-ai/dsh-settings`、`@deepseek-ai/cordis-plugin-loader`（类型）。
8. **`README.md` / `README.en.md`** —— 配置面章节重写：新扁平字段表、界面入口（Plugins → dsh-aivn）、env 回退、shell 只对新会话生效的口径。

### 阶段二：客户端设置卡

9. **`package.json`** —— `dsh.client.inject` 加 `"@deepseek-ai/dsh-client-ui-settings"`、`"@deepseek-ai/dsh-client-ui-plugin-manager"`；devDeps 加 `@deepseek-ai/dsh-client-ui-primitives`（类型 + 本地解析兜底）。
10. **`src/client/settings-card.tsx`（新）** —— `AivnSettingsController`（`new SettingsFormModel(ctx.configForms.get('dsh-aivn'), specs, ...)`；specs = 文本/数字/枚举/keys 列表四种自定义 spec，§2.4）+ `AivnConfigCard` 组件（`SettingsForm` 外框 + 分组标题 + `SettingsSecretField`×4 + `SettingsValueField`×13 + 密钥「清除」按钮 + 能力状态行）；「已配置」徽标订阅 `ctx.configForms.describe()` 的 secrets 边车。
11. **`src/client/index.tsx`** —— `inject` 加 `'configForms'`；`apply` 里 `ctx.effect(() => ctx.configForms.whileServed(['dsh-aivn'], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-aivn', inject: () => card.inject() }, AivnConfigCard))))`。文案硬编码中文，与该客户端现状一致（不引 locale 服务）。
12. `pnpm build && pnpm typecheck`。

### 阶段三（P1 第二刀）：play 级设置

13. **`src/craft-service.ts`（新）** —— 从 `set-craft.ts` 抽读写体；工具与路由共用。
14. **`src/routes.ts`** —— `GET/POST /aivn/play-config`（GET 回 craft 生效值 + scriptLanguage；POST 收 CraftPatch / language）。
15. **`src/client/stage-view.tsx`** —— 「剧目设置」面板（craft 下拉×2 + 素材来源 + 剧本语言），打上面的路由。
16. README 补「剧目设置」一节。

### 测试点与 e2e 断言（新增模块 `settings`，套件 `verify-settings`，进 `e2e/run.mjs` 的 MODULES）

- 单测/手测：Config 解析形状（§5.1 测试点）；keys spec 的 parse/format；`buildRuntime` 的能力位推演（空 key → voice off；baseUrl+model 配齐 → image on）。
- e2e（走 `dsh-e2e run e2e/run.mjs settings`，浏览器断言用 `e2e/lib/boot.mjs` 的 launch/gotoGui）：
  1. Plugins 页 Installed 组出现 dsh-aivn 卡；打开详情出现配置表单（bundle.config 槽生效）。
  2. 默认值渲染正确（ttsBaseUrl 等 P1 字段）。
  3. 保存 `ttsConcurrency=4` → 断言 `.dsh-e2e-home/profiles/web/cordis.patch.yml` 的 dsh-aivn 行 `config.ttsConcurrency: 4`（写入落点）。
  4. 填 `ttsKeys` 保存 → **不重启**：新搭台助手会话的日志里有 `list_voices` 工具与《音色》章（沿用 `verify-stagehand` 的日志断言法）；页面 DOM 与 describe 网络响应里**不含** key 明文（脱敏断言）。
  5. 已存在的搭台助手会话：保存 `searchKeys` 前后各发一轮，工具面出现/消失 `web_search`（重扫断言）。
  6. `shell` 翻转：新会话的行集变化（bash 工具出现）；老会话**不变**（如实断言降级口径）。
  7. 配乐后端从无到有：老会话下一轮的 `aivn:stagehand-guide` 段出现《配乐》章（活段断言，从会话日志取系统提示词）。
- e2e 断言兜底项（未验，跑了才算数）：客户端 `require('@deepseek-ai/dsh-client-ui-primitives')` 的可解析性（§1.6）；插件停用时同包客户端是否仍加载（whileServed 应对，不影响正确性）。

### 明确不做

- framing / stature / anchor / title 的界面（§4）。
- credentials 域接入（key 留在配置 + role('secret')，理由 §1.5）。
- 给已存在会话补装/卸 `tool-bash` 行（代际保留，做不到，§3.4）。
- keys 的逐条列表控件（逗号分隔文本足够；真要列表等上游出列表控件再说）。
- 表单 locale 双语（硬编码中文，与插件客户端现状一致）。
- 修订栅栏冲突的专门 UI（复用 `SettingsForm` 的 saveFailed 文案即可）。
- play 级设置进 dsh-settings 表单（工作区文件不属于插件 Config，§4）。
