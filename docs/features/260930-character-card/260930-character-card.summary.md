# 角色卡 · 交付总结

## 做了什么

两件事，看起来是一件：**让资源库能存「只有人设、图还没画」的角色**，以及**把剧目内部几处「同一件事存两份」收敛掉**。

起因是一个具体的挫败：想从资源库拿一个角色时，发现库只认「一整套立绘包」。但搭台的常态是先定人设、让剧作家写起来、立绘慢半拍——这个中间态在库里根本表达不了。而真正让人不安的是角色卡这件事本身在系统里被拆成了几块：库里一套（`meta.character`）、`play.json` 一套（`CharacterCard`）、UI 上又是一堆立绘格子。

## 1. 角色条目 = 一张卡 + 可选立绘

`library/sprites/` 改名为 `library/characters/`（`git mv`，历史保留）。一个角色条目 = `meta.character`（角色卡）+ 目录里的立绘文件（可选）。

- **角色条目允许零媒体**：只有 `meta.json` 的目录是合法条目。这是之前缺的闸门——`entry()` 的空目录检查把它判成了无效条目。
- **`meta.character.protagonist: true`** 标记玩家角色，主角卡的导入入口只列这些。
- 立绘仍是立绘：落在剧目的 `assets/sprites/<id>/` 不变，剧本引用方式不变。

库里新加两个示例条目验证这条路径：`aoi`（主角、纯卡片）和 `haru`（配角、纯卡片）。

### 导入是一条流程，不分种类

之前 `assetImport.ts` 有两条并行路径（单文件 / 立绘包），合并规则不对称（"人设覆盖、差分合并"），靠分支维护。收敛成单一流程，判据只有一个：**库里声明了什么就兑现什么，没声明的不动**。

角色卡的每个字段都是同一条规则，不给差异编理由：

```ts
for (const key of ["name", "persona", "voice", "voiceId"] as const) {
  const v = card[key];
  if (v) character[key] = v;   // 库里有值才覆盖
}
```

`ImportPlan.sprites` 这个中间态随之删除——它只是两条路径的分叉产物。

### UI：入口跟着对象走

- **角色卡**和**主角卡**各自有一个「从资源库导入」按钮，共用同一个 `LibraryBrowser`（可选 `filter` 谓词，不是新的 "mode" 概念）。已存在时按钮显示「覆盖」。
- **素材页**删掉了独立的 `sprites/<角色id>` 上传格；立绘只在角色卡里管（上传 + 差分映射一行）。

## 2. 收敛：premise 与记忆卡

### `premise` 只认 `memory/always/premise.md`

`PlayConfig.premise` 删掉了。它和 `memory/always/premise.md` 双存，注入时 `|| play.premise` 决定谁生效——用户改 UI、工坊改文件、最后写的赢，没有单一真相源。

删字段后只认 memory 那一份，与 `craft.md` 同层（A 区注入用的正是它）。配套：

- `PlayStore.premise()` / `savePremise()`，`readiness()` 只看这份。
- REST `GET|PUT /api/plays/:id/premise`（照 `craft.md` 的模式，走工坊 `writeFile` → 撤销条 → 节拍边界重建 runtime）。
- 素材页的 premise 框有自己的草稿态和「保存前提」按钮，不再混在 play.json 表单里。
- demo 剧目的前提已迁进 `plays/demo/memory/always/premise.md`。

### `index/` 收任意子目录，`arcs/` 独立

- `index/` 递归扫描，`layer` = 相对 `index/` 的子目录路径（顶层卡为空串，提示词里就不打 `[分类]` 前缀）。`locations/`、`lore/` 只是工坊提示词里的**软性建议**，不是约束。
- `arcs/` 移到 `memory/arcs/`。理由是机器契约：它的文件名就是谱系快照引用的 arcId，跟用户可写的设定卡混在一个目录里，手工放东西进去会绕过按分支过滤的防剧透。

## 验证

- `pnpm typecheck` 三个包全绿。
- `pnpm test`：core 92 / web 31 / server 253（新增 4 条：纯角色卡导入、字段级合并、`target=protagonist` 落点、嵌套子目录 + arcs 独立过滤）。
- 测试抓到过一个真 bug：让「没声明 character 就不碰 play.json」后，只有立绘图的角色无处安放差分映射——已修为按目录名建空壳卡。

**未做实机验证**：`acquire-port` 因本机内存不足（可用 1541MB < 需要的 2048MB，其余三个服务是别的 agent 起的）拒绝放行，起不了 dev 服务，界面行为没有截图验证。逻辑层由测试覆盖，但「素材页长什么样、覆盖按钮什么时候变字」需要用户在服务可起时看一眼。

## 影响的存量数据

- 库目录 `sprites/*` 需改名为 `characters/*`（本仓库已改完）。
- `memory/index/arcs/*` 需移到 `memory/arcs/*`。
- 旧剧目的 `play.json` 若有 `premise`，需手工搬进 `memory/always/premise.md`（server 读旧文件不报错，只是前提会读成空 → 就绪门拦下）。
