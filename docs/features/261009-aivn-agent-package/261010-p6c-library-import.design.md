# P6-c 设计 · 库导入统一：`library_import` → `import_asset(source="library:<kind>/<entryId>")`

日期：2026-10-10 · 状态：**设计稿**（goal ③；P6 计划里原本「移出 P6、另议」）
上游：`261009-aivn-agent-package.p6.plan.md` 第 10 行。

---

## 0. 一句话

服务端不再有第二个导入动词：**入库只有一个工具 `import_asset`**，来源是它的一格参数
（剧目内路径 / http(s) / `draft:<id>` / **`library:<kind>/<entryId>`**）。引擎那份
`importFromLibrary` 原样保留（HTTP 面与「引用即导入」照用），只是不再单独暴露成工具。

---

## 1. 现状（实读）

| 面 | 今天 | 谁在用 |
| --- | --- | --- |
| `import_asset`（工坊） | 登记**一张外来图**：`source` = 剧目内路径 / http(s) / `draft:<id>`；落位七格显式给 | 模型（两宿主同一份参数真相源：`@aivn/agent` 的 `asset.register`） |
| `library_import`（工坊） | 把库条目复制进剧目：`kind` + `entryId`（可数组） + `variants` + `target=protagonist` | 模型（仅服务端有） |
| `importFromLibrary(kind, entryId, {variants, target})` | 真正的导入引擎：单文件类别复制一个文件 + 写素材表；立绘类目按差分复制多张 + 写角色卡（`assets/sprites/<spriteId>/…`） | `library_import`、`assetRef.ts`（**引用即导入**，剧作家那条自动路）、HTTP `POST …/library/import`（工坊素材页那个按钮） |
| `list_library` | 浏览库（只读） | 两个角色都装（P6 ⑤ 重审：**保留**） |

两个问题：**入库有两个动词**（同一个语义两种表达，模型要挑）；**插件没有 `library_import`**
（它没有资源库），于是两宿主的工具面差一位（P6 表里那一行「不一致」）。

---

## 2. 设计

### 2.1 模型可见面只剩一个动词

`import_asset` 的 `source` 多认一种写法：**`library:<kind>/<entryId>`**（`kind` ∈
backgrounds / cg / sprites / characters / bgm / sfx，就是 `list_library` 回的那些类别）。

- **单文件类别**（backgrounds / cg / bgm / sfx）：把条目里那个文件复制进
  `assets/<kind>/<id><ext>` + 写素材表 —— 与今天 `library_import` 的单文件分支逐字同一条路。
- **立绘类目**（sprites / characters）：按 `assets/sprites/<spriteId>/<variant><ext>` 复制**全部差分**
  + 写素材表 +（条目带 `meta.character` 时）写 `characters/<spriteId>.md`。
  `spriteId` 取落位那七格里已经有的 `spriteId`（缺省用条目 id）——**主角就是给它主角 id**，
  于是原来那个 `target=protagonist` 参数从模型面上消失（它本来就是「改个名字」）。
- **批量**：不再有数组参数。一次往返能发多个调用（工具本来就是并发的），所以「不要一个一个导」
  这条约束照旧成立；一次调用一个条目，回执各自清楚。

### 2.2 引擎那份不动

`importFromLibrary(kind, entryId, {variants, target})` **保留全部能力**（它服务三种调用方）：

- HTTP `POST …/library/import`（工坊素材页按钮）继续传 `variants` / `target` —— 那是**界面**的参数，
  不归模型面管；
- `assetRef.ts` 的「引用即导入」继续按引用自动导（剧作家写 `<actor id="mio">`，宿主去库里搬整包）；
- `import_asset` 的新分支调它时走**缺省**：`variants` 不给（= 条目里有哪些差分就导哪些）、
  `target` 不给，`spriteId` 用它自己那格。

### 2.3 落位与来源要对得上

`library:<kind>/<entryId>` 已经带类别，落位七格里的 `kind` 也带类别——两者要一致
（`library:backgrounds/x` + `kind=background`）。不一致时说清哪个是哪个，别猜。
`name` / `spriteId` 决定落进来的名字（与今天 `import_asset` 同义），条目自己的 `meta` 只补进素材表。

### 2.4 共享正文怎么改（`packages/agent`）

`asset.register` 的 `source` 说明与 `ASSET_REGISTER_DOC` 补一句：
「或**宿主资源库里的条目** `library:<kind>/<entryId>`（`kind` 见浏览资源库那两个工具的类别；
本实例没配资源库时不认这个写法）」。措辞保持宿主中立 + 条件化（仓库里门控章的既有口径）。

服务端那一面在 `import_asset` 的描述里补 `library:` 这一条（与 `draft:` 同一位置：宿主独有机制）。

---

## 3. 迁移面

**共享包**：`packages/agent/src/capabilities/asset/register.ts`（字段说明 + doc）。
**服务端**：
- `agentkit/libraryTool.ts`：删 `library_import`（参数、描述、回执渲染、`importAsset` 依赖开关），
  文件保留 `list_library`（改名 `libraryTool.ts` 不动）；
- `agentkit/kit.ts`：`TOOL_CATALOG` 删 `library_import` 一行、能力位 `library` 的 `tools` 少一位；
- `agentkit/contract.ts`：副作用目录删那一行、矩阵里 `library` 那行重写（不再「不一致」）；
- `agentkit/registerTool.ts`（`import_asset`）：`source` 分支加 `library:` → 调 `importFromLibrary`
  （需要把 library 传进来：`ImportAssetDeps` 加一格）；
- `playAssets.ts`：`register()` 里认出 `library:` 前缀时改走库那条路（或在 `registerTool` 里分叉——
  设计取后者：**库的解析属于工具面，`playAssets` 只认图/路径**）。
**文档**：`apps/server/AGENTS.md`（工具面清单）、`apps/server/README.md`（若有）、
`docs/features/…/p6.plan.md`（第 10 行改「已统一」）、契约矩阵。
**测试**：`test/agentkit.test.ts`（工具面/能力目录）、`test/workshop.test.ts` 或 library 相关用例
（`library_import` 的用例改成 `import_asset(source="library:…")`）、`test/http.test.ts`（HTTP 那条不动）。

**插件侧**：不需要改代码（它没有资源库，`import_asset` 的 `library:` 分支走不到），
但**共享正文变了** → 插件要重建 `lib/` 并提交（`@aivn/agent` 是构建期依赖）。

---

## 4. 风险

| # | 风险 | 对策 |
| --- | --- | --- |
| R1 | 立绘整包导入把「只导某几个差分」这条能力从模型面上拿掉了 | 认账：界面（素材页按钮）照旧能挑差分；模型面导整包更不容易出错。写进计划文档 |
| R2 | `library:` 与落位 `kind` 不一致时的行为 | 明确报错（说清哪个字段是哪个），不猜、不静默 |
| R3 | 主角改名这条（`target` → `spriteId`）会不会漏写角色卡的 id | 角色卡写到 `spriteId` 名下（与素材表同一格），判据盯住 |
| R4 | 插件 `lib/` 忘了重建（共享正文变了） | `build.mjs --check` 会拦；落地流程里带一次重建 |

---

## 5. 验收判据

1. `import_asset(source="library:backgrounds/x", kind="background", name="school")` →
   `assets/backgrounds/school.<ext>` + 素材表一条 + 台账一条；
2. `import_asset(source="library:characters/mio", kind="sprite", spriteId="mio")` →
   `assets/sprites/mio/<variant>.<ext>`（全部差分）+ `characters/mio.md`；
3. `kind` 与 `library:` 里的类别不一致 → 报错且不落盘；
4. **工具面**：工坊装 `import_asset` + `list_library`，**没有** `library_import`；剧作家照旧没有 `import_asset`
   （角色表决定）也没有 `library_import`；
5. 契约守卫 9/9；矩阵里 `library` 那行不再写「不一致」。
