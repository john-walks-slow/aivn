# 立绘即素材：角色卡与立绘解绑（sprite-entity）

日期：2026-10-04
分支：`feat/sprite-entity`
状态：实施中

## 一、要解决的问题

引擎里立绘是角色卡的附件：生图硬要 `characterId`（没卡就自动建空壳卡）、取景只写在卡上、差分靠卡上的映射表、资源库没有「非角色立绘」这一类。结果是机甲、道具、武器这些「不是人但有立绘」的主体没有位置。

同时有三处概念叠在一起：

- `expression`（表情）与 `state`（非人状态）是同一个槽位的两个名字，两个都写时后者被静默丢掉（舞台取 `expression ?? state`），而它们本来就都落到「换哪个差分文件」。
- `framing` 一档同时管出图画幅、提示词措辞、舞台摆位、主体类别（`square` 实为「非人主体」），而「台上站多大」无处声明。
- 卡上的取景与 `assets/manifest.json` 里导入时写下的取景是两份，舞台只读卡那一份。

## 二、概念模型

**台上的一切都由一个 id 寻址**：人、机甲、猫、武器都一样。它有两件可选附件，同名即绑定，互不依赖：

- 角色卡 `characters/<id>.md`：名字、人设、音色。
- 立绘 `assets/sprites/<id>/`：一组差分图 + 呈现声明。

`<actor id>` / `<say id>` / 生图 `spriteId` / CG 垫图引用都按这个 id 解析。会说话的机甲就是一张只填 name/voice 的卡；纯道具就是连卡都没有的目录。名牌回落链：卡 `name` → `<say name>` → 立绘 `title` → id；无卡主体 TTS 走剧目的 `defaultVoiceId`。

**命名恒等**：id = 目录名，variant = 文件名 stem，取景声明在 manifest。中间不再有映射表。

**分层命名**：剧本层叫 `id`（主体）与 `variant`（此刻的样子）；资产层叫 `spriteId`（哪张立绘）。

**呈现五轴**：`framing`（图里画到哪，素材声明）× `stature`（台上站多大，素材声明）× `shot`（这一句多近，DSL）× `anchor`（垂直对齐，素材声明 + DSL 覆盖）× `pos`（横向站位，自动排布 + DSL）。

机甲 = `framing: full` + `stature: huge`；猫 = `square` + `small`。

## 三、契约

DSL：

```xml
<actor id="xiaoyu" variant="smile" pos="center" shot="close" />
<actor id="mecha" variant="damaged" />
```

`expression` / `state` 作为旧写法由解析器收下（`bust → half` 同款降级），不再往外冒新名字。

素材声明（`assets/manifest.json`，库条目同 schema）：

```json
{
  "mecha":         { "title": "试验机·壹式", "framing": "full", "stature": "huge" },
  "mecha/damaged": { "framing": "half" },
  "cat":           { "framing": "square", "stature": "small", "anchor": "bottom" }
}
```

`AssetMeta` 增 `stature` / `anchor`；`expressions` 字段改名 `variants`（旧键读回落）。

舞台预设表进 core：`spriteStagePreset(framing, stature, anchor) → { top, height, origin }`，横竖屏两列；StageTheater 发 CSS 变量，`app.css` 只留一条式子。

资源库 kind 增 `sprites`（`library/sprites/<id>/{meta.json, 差分图}`）；`characters` 仍是「卡 + 可选捆绑立绘」的包，导入时拆开落位。

## 四、改动清单（按层）

### core

- `play/framing.ts`：加 `stature` 枚举（small/normal/large/huge）、显示名、`spriteStagePreset` 与预设表。
- `play/assets.ts`：`SpriteExpression → SpriteVariant`、`AssetMeta.expressions → variants`（旧键读回落）、加 `stature` / `anchor`。
- `dsl/spec.ts`：`ActorAttrs.expression`/`state` → `variant`（旧属性名常量留作解析别名）。
- `dsl/parser.ts`、`lineage/replay.ts`：产出与重放都写 `variant`，读旧 key 退回。
- `play/characterCard.ts`、`play/config.ts`：角色卡只剩 `id/name/voice/voiceId`（`sprites`/`spriteFraming`/`framing` 下线）。
- `dsl/events.ts`：preload id 注释改为 `<spriteId>:<variant>`。

### server

- `agentkit/imageTool.ts`：`characterId → spriteId`、`expression → variant`、加 `stature` / `title`，删 `characterName` 自动建卡。
- `playAssets.ts`：立绘出图不再要求角色卡；取景读 manifest（差分覆盖 → 立绘级 → 缺省）；出图后写 manifest（不再回写角色卡）；`ensureNeutral` 按立绘级取景。
- `assetImport.ts`：`sprites` kind 只落图；`characters` 有 `character` 字段才写卡；删空壳卡分支。
- `store.ts`：立绘就绪门改查目录。
- `http.ts` / `playhouse.ts`：REST 与预发射参数改名，preload id 用 spriteId。
- `agentkit/libraryTool.ts`、`recutTool.ts`、`imagePrompt.ts`、`library.ts`、`rebuild.ts`、`orchestrator.ts`：随名字与 manifest 走。

### web

- `stage/assets.ts`：`sprite(id, variant)` 按目录 stem 找图（退回第一张）；`spriteFraming` 改从 manifest 读，返回 `{framing, stature, anchor}`。
- `stage/StageTheater.tsx` + `app.css`：预设由 core 表算成行内 CSS 变量，删 `.framing-*` 高度规则。
- `stage/director.ts` / `script.ts`：slot 字段 `expression`/`state` → `variant`。
- `workshop/CharacterEditor.tsx`：立绘编辑整段移出角色卡，只留人设与音色。
- `workshop/AssetsPanel.tsx`：新增「立绘」类别（一目录一卡、差分缩略图、framing/stature/anchor 下拉、上传、生成、从资源库导入）。
- `workshop/ImageGenDialog.tsx`、`LibraryBrowser.tsx`、`CharacterPane.tsx`、`api.ts`：参数与文案同步。

### 文档与提示词

- `agentkit/imageTool.ts` 规则句、`prompt.ts` 剧作家提示词（DSL 表、NPC 引入、角色卡模板）。
- `workshop.ts` 角色卡 frontmatter 说明、README（DSL 节、立绘取景节、素材页节、角色卡节）、`apps/server/AGENTS.md`、`apps/web/AGENTS.md`。

## 五、迁移（一次性脚本，不留运行时回落）

- 各 play 卡上的 `framing` / `spriteFraming` 抄进 manifest 对应键，然后删卡上字段。
- manifest 的 `expressions` 键改写 `variants`；谱系/存档里的 actor `expression`/`state` 属性重写为 `variant`（解析器同时留别名兜底）。
- 导入过的立绘 manifest 键 `<id>/<variant>` 本来就带 framing，直接生效。

## 六、不做的

- 画幅自由覆盖；DSL 逐句体量；显式 `sprite:` 绑定字段；图层 z 轴；服装套装轴。

## 七、验收要点

1. 机甲 / 道具不带卡上台：`<actor id="mecha">` 有图、有体量；机甲顶天立地、猫小而落地。
2. 一次性 NPC 有名字牌、有默认音色；常驻角色有卡（人设/音色）与同名立绘。
3. 角色页不再管立绘；素材页立绘类别能上传、声明三轴、从库导入、站内生图。
4. 存量剧目站位与今天一致（缺省 full/normal）。
5. `expression` / `state` 旧剧本与旧存档照常演出。
