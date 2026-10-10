# dsh-aivn 工具组合与架构独立评审

## 结论先行

当前最值得保留的方向是：**文件是剧目的事实源，专用工具只承担文件工具无法可靠完成的副作用；长流程与领域知识放进可按需加载的 skill；舞台状态由会话面重建，而不是另养一份脚本状态。** 这比继续增加 `create_play`、`set_craft`、`update_state` 一类“替模型写一个文件”的工具更容易维护，也更符合 DSH 的能力边界。

但当前实现正处在一个危险的中间态：工具表看起来已经收敛，权限边界和内部实现却仍然偏宽。最优雅的下一步不是继续扩充工具，而是做三件事：

1. 把“搭台助手”和“剧作家”的最小权限重新分开；
2. 把 `generate_image` 的多种语义收敛成清晰的资源生命周期；
3. 把约 1100 行的 `PlayAssets` 拆成用例服务、资源解析、持久化仓和提示词策略四层，并补上真正的并发契约测试。

## 一、现状判断

### 1. 总体设计是正确的

`src/preset-tools.ts` 已经明确区分了两类能力：文件工具负责 `play.json`、状态和角色卡；AIVN 工具负责外部调用、图像处理、台账和实时广播。这是正确的职责划分。`validate_play` 与 `readiness.ts` 共用同一份报告，避免“提示词说一套、工具报另一套”；`set_stage_style` 通过白名单、事务式校验和广播完成了文件写入之外的真实副作用；`web-image.ts` 对 URL、重定向、DNS 内网地址、大小和超时做了较完整的边界防护。

动态提示词的分层也合理：静态 persona、每轮剧目上下文、能力门控章节分别放在宿主合适的注入位置。`skills/` 不把三份长文全文塞进每轮上下文，而是只暴露目录供模型按需读取，这是控制上下文成本的正确做法。

### 2. e2e 关注点选得对，但更像“装配验收”

`verify-injection.mjs`、`verify-stagehand.mjs` 和 `verify-media.ts` 覆盖了提示词是否真实注入、工具是否按能力出现、媒体字节是否落盘、画幅与立绘身份约束是否成立。尤其媒体套件使用真实 PNG、真实 sharp 和错误路径负例，价值高于只测 mock 返回值。

不过目前测试主要验证“名称和字符串是否出现”。这能抓住装配回归，却不能充分证明权限、资源生命周期和并发写入在真实边界下成立。后续应把工具契约、文件状态迁移和持久化并发提升为一等测试对象。

## 二、必须重新审视的结构问题

### P0：两个预设共享完整 AIVN 工具面，违反最小权限原则

当前 `install()` 对两个预设装上同一套 `validate_play`、`set_stage_style`、`import_asset`、`recut_sprite`、生图、配乐、检索和音色工具。README 也明确写成“工具面完全一致”。这会导致：

- 剧作家可以改舞台皮肤、覆盖素材、导入远程图片、生成 BGM，并承担本应属于备料阶段的持久化副作用；
- “剧作家只输出 Stage DSL”的提示词契约与实际能力不一致；
- 任何提示词误判都会让一次演出轮修改剧目资产，而不是只写剧本；
- 未来新增一个搭台工具时，很容易因为“两个预设同构”继续扩大剧作家的权限。

仓库 `AGENTS.md` 仍写着“剧作家专属工具只剩配了生图才有的同步 `generate_image`”，这与当前源码和 README 已经冲突，说明权限模型没有一个单一真相源。

**建议：** 明确采用 capability profile，而不是 `preset === ...` 后共享数组：

- `playwriter`：文件读工具、必要的 skill、`generate_image`（仅在剧本确实需要缺图时启用）以及只读校验；不应有 `set_stage_style`、`import_asset`、`recut_sprite`、`generate_bgm`、`web_search`、`list_voices`。
- `stagehand`：文件读写、`validate_play`、素材导入/重抠、出图、配乐、音色和检索；`set_stage_style` 可保留在这里。
- 对确实需要两边共用的工具，显式标记为 `shared`，不要靠两个分支碰巧相同。

这不是为了隐藏能力，而是让“哪类 Agent 能产生哪种持久化副作用”成为可审计的代码事实。

### P0：`generate_image` 是四个概念压成一个入口，模型容易走错状态

当前一个工具同时表示：剧目素材出图、通用图片出图、默认直接入库、`draft: true` 候选、立绘自动补 neutral、参考图下载和目标字段覆盖。它的 schema 很完整，但完整性已经转化为状态空间：`kind` 是否存在、`draft` 是否存在、候选是否带意图、外部导入是否补齐 target，都会改变后续语义。

尤其“默认出图即入库”与技能中“先给用户看、点头后再入库”存在张力。剧作家在缺图时默认直接入库，搭台助手在备料时默认先草稿；同名工具通过描述文字解释差异，长期会比两个明确的生命周期 API 更脆弱。

**建议：** 内部统一为四个显式用例：

- `createImageDraft`：只生成候选，永不写入 `assets/`；
- `adoptImageDraft`：把候选采用为剧目素材；
- `generateAndAdoptAsset`：仅作为一个明确命名的快捷用例，适合搭台助手的确认后批量备料；
- `createGenericImageDraft`：通用图片候选，不带剧目目标。

对模型暴露时可以保留较少工具，但必须让每个工具对应单一状态迁移。若为了兼容现有 UX 继续保留 `generate_image`，至少让 `draft` 与 `kind` 组合由 schema 互斥约束表达，并让执行层返回结构化的 `draft/adopted/rejected` 状态，而不是仅靠回执自然语言传递。

### P1：`PlayAssets` 同时承担领域策略、提示词编译和文件数据库

`src/media/assets.ts` 已超过 1100 行，里面同时包含：目标解析、立绘身份策略、提示词后缀、URL/路径解析、图像画幅校验、草稿生命周期、入库、manifest 合并、generated ledger、BGM 写入、原片留存、重抠和文件锁。这不是单纯“文件太长”，而是变化原因已经明显不同：

- 生图策略会随模型能力和视觉规范变化；
- 资源领域规则会随 Stage 契约变化；
- 文件持久化会随并发、崩溃恢复和格式变化变化。

**推荐目标分层：**

```text
media/use-cases/
  create-image-draft.ts
  adopt-asset.ts
  generate-and-adopt.ts
  recut-sprite.ts
  generate-bgm.ts
media/domain/
  asset-target.ts
  sprite-identity.ts
  prompt-policy.ts
media/storage/
  draft-store.ts
  asset-store.ts
  manifest-store.ts
  generation-ledger.ts
  play-file-lock.ts
media/backends/
  image/ ... music/ ...
```

工具文件只做参数校验、调用一个用例、格式化回执；不直接知道 manifest、ledger 或抠底的组合细节。这样未来增加视频、音效或新的图片协议时，不会继续把所有逻辑塞进 `PlayAssets`。

### P1：当前“并发去重”与实例生命周期不一致

`PlayAssets` 的 `inflight` 是实例字段，但 `playAssetsOf()` 每次工具调用都会新建一个 `PlayAssets`。因此同一工作区中两个并发工具调用不会共享这张 `inflight` 表，注释所说的“同一最终目标只跑一次”在跨调用场景下并不成立。manifest/ledger 的文件队列是模块级的，能保护同一 Node 进程内的读改写，但不能替代目标级作业去重。

此外，`persist()` 对同一目标没有与 manifest 一样的共享锁；两个进程或两个并发请求可能各自判断不存在后覆盖同一文件。原子 rename 能避免半写文件，却不能避免最后写者覆盖或 manifest 与素材文件短暂不一致。

**建议：** 把工作区级 `AssetRepository`/`PlayAssetRuntime` 按剧目目录缓存，或把目标锁提升为按绝对路径共享的锁；同时明确系统只保证“单进程并发”还是需要跨进程保证。若只支持单进程，应在代码与文档中写清；若需要跨进程，则应使用 lockfile/SQLite，而不是内存 Map。

### P1：资源落盘缺少可恢复的事务边界

一次导入会依次写素材文件、原片、manifest、ledger 和草稿状态。中途进程退出时，可能出现文件已存在但 manifest 未登记，或 manifest 已更新但 ledger 缺失。当前 `markCommitted` 是 best-effort，这对“补一条留痕”合理，但核心资源元数据不应依赖调用顺序和进程不被杀死。

**建议：** 先写一个带版本和状态的 adoption record，再以原子 rename 提交各文件；或者将 manifest、ledger、asset metadata 合并进一个小型 SQLite/JSONL 事件源，启动时重放/修复。短期至少提供 `reconcile_assets` 的内部检查逻辑，并让 `validate_play` 报出“文件存在但未登记”的不一致。

### P1：配置能力是部署级，但提示词与工具看起来像剧目级

`Capabilities` 从插件配置推导，工具按部署能力注册；`play.json` 的 `craft.assets.*` 仍保留 `generate/library/off` 等剧目语义，但 README 又说明本插件没有跨剧目素材库。现在模型需要同时理解“能力是否存在”和“本剧目偏好是否允许使用”，两套开关没有统一决策层。

**建议：** 明确分两层：

- `deploymentCapabilities`：后端、密钥、shell 是否可用；
- `playPolicy`：当前剧目是否允许生成、是否偏好现成素材、是否允许覆盖。

最终工具可用性和提示词章节由 `effectivePolicy = deployment ∩ playPolicy` 推导。若暂时不实现剧目级策略，就从 `play.json` 删除或明确标记暂不生效的字段，避免模型把“写了但不执行”的配置当成契约。

## 三、建议保留但应加固的部分

### `validate_play` 应成为一致性检查，而不只是 readiness

现在它主要报告 play.json、缺项和坏值。随着媒体链路变复杂，最有价值的检查应加入：manifest 中声明的文件是否存在、assets 中未登记的文件、sprite neutral 是否缺失、generated ledger 是否指向存在文件、草稿是否已采用但未标记等。这样它才真正成为“剧目健康检查”，而不是只检查骨架。

### `set_stage_style` 应继续保持专用工具

这是一个很好的专用工具例子：文件工具能写 JSON，但不能安全完成 CSS token 白名单、整次事务拒绝和跨会话广播。它的边界清楚，应作为“何时值得增加工具”的标准样板。只需把它放回搭台助手权限，不要让权限共享成为默认。

### URL 与外部输入的安全策略应独立成共享边界模块

`web-image.ts` 的 SSRF 防护目前做得比普通实现扎实，但未来音频导入、视频参考图、网页抓取若各自复制一份，仍会产生漏洞。建议提取统一的 `external-source-policy`：协议白名单、DNS/IP 重判、重定向次数、大小、超时、mime sniff 和审计信息统一定义，所有外部资源入口复用。

### 技能内容需要版本与事实治理

`aivn-audio` 含有强时效的站点改名、数量、授权和平台规则断言。技能适合作为操作指南，不适合作为未经校验的法律/授权真相源。建议每份技能 frontmatter 增加 `reviewedAt`、`sourceUrls` 和适用范围；对授权结论写成“落地前复核”，并在 CI 或发布检查中扫描过期条目。不要让 `web_search` 的结果直接变成可商用结论。

## 四、推荐目标架构

```text
Preset capability profiles
  ├─ playwriter: read-only context + controlled image request + validate
  └─ stagehand: setup/write + asset/media operations + style/search/voice

Tool adapters
  └─ 参数 schema → use case → typed result → renderer

Domain use cases
  ├─ PlayValidation
  ├─ StyleMutationAndBroadcast
  ├─ ImageDraft / AssetAdoption
  ├─ SpriteRecut
  ├─ BgmGeneration
  └─ ExternalReferenceFetch

Domain policies
  ├─ effective capability/policy
  ├─ asset target and identity rules
  ├─ prompt construction
  └─ overwrite/adoption policy

Persistence
  ├─ DraftStore
  ├─ AssetStore
  ├─ ManifestStore
  ├─ GenerationLedger
  └─ workspace lock / reconciliation
```

关键原则是：

- 工具是薄适配器，不在工具描述里承担状态机；
- 用例返回结构化结果，中文回执只是最后一层渲染；
- 所有“会覆盖什么、何时入库、是否需要用户确认”的策略集中在 policy/use case；
- 预设权限由声明式 profile 生成，e2e 从 profile 断言工具面；
- 文件格式仍是用户可读的事实源，不因拆层而引入不可见数据库。

## 五、实施顺序

### 阶段 1：先修权限与契约，不改用户流程

1. 建立 `PresetToolProfile`，把两预设工具面显式列出。
2. 修正 `AGENTS.md`、README、提示词和 e2e 的权限断言，使其只有一个事实。
3. 给每个工具增加 `sideEffects` 元数据，测试“剧作家不可写资产/皮肤”。
4. 保留现有用户可见工具名，先只改变装配边界。

### 阶段 2：拆媒体用例与持久化

1. 把 `PlayAssets` 的目标解析、prompt policy、draft/adoption、BGM、recut 分离。
2. 引入工作区级 runtime，修复 `inflight` 失效问题。
3. 为 manifest、ledger、asset 文件增加统一锁和一致性检查。
4. 增加中途失败、重复采用、同目标并发、跨扩展名替换和重启恢复测试。

### 阶段 3：收敛工具语义

1. 内部先使用显式的 draft/adopt 用例。
2. 再决定是否保留一个兼容性的 `generate_image` 外壳；若保留，严格限制合法参数组合。
3. 将回执从自由文本升级为结构化结果后再渲染 markdown 预览。
4. 将 `craft.assets.*` 与部署能力统一成 effective policy，删除未生效的配置暗示。

### 阶段 4：测试与技能治理

1. 用 profile/schema 生成工具清单断言，减少 e2e 中硬编码工具名散落。
2. 增加直接的 domain/storage 测试，e2e 继续负责 DSH 装配、日志和真实浏览器边界。
3. 为技能增加来源、复核日期和过期检查；对授权内容保持人工复核。
4. 发布前把 README、英文 README、技能和工具 schema 做一致性检查。

## 最终判断

不建议回到“每个文件一个工具”或“把所有功能做成一个万能工坊工具”。当前文件工具 + 少量领域工具 + skill 的方向是对的，问题在于权限面和内部媒体实现还没有跟上这个原则。

最优雅、可维护的版本应当是：**剧作家是受控的演出写作者，搭台助手是唯一的资产编排者；图片从候选到入库是显式生命周期；媒体文件由可恢复的工作区仓管理；工具只暴露稳定用例，提示词和 e2e 都从同一份能力契约派生。** 这样未来增加视频、音效、更多图片后端或新的舞台资源时，新增的是一个用例和一个 profile 能力，而不是继续扩大 `PlayAssets`、工具 schema 和两套提示词之间的隐式耦合。
