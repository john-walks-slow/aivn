# AIVN 生图对标：清完「未受益」清单 + 删掉 list_assets

2026-10-06。依据 [`261006-aivn-image-parity.audit.md`](261006-aivn-image-parity.audit.md) 第 2 节的未受益清单，
以及用户当轮的两条指令：「解决全部」「list_assets 听着也像是现在可以不需要的东西」。

## 决策

1. **生图侧能搬的全搬**：audit 2.2 / 2.3 / 2.4 / 2.5 / 2.7 / 2.8 六条（2.1 / 2.6 / 2.9 已在上一轮 `6ce0208` 修掉）。
2. **删掉 `list_assets`**。它是纯"读一读就有"的视图：`assets/` 目录 + `assets/manifest.json` 的描述 +
   `characters/` 角色卡，`glob` / `read` 三下就拿到。而描述本来就在每个角色的提示词里——剧作家的 A 区
   每轮注入《素材清单》与《角色表》（id + 描述），搭台助手看《当前状态》的文件清单、要描述就读它自己
   写过的 `manifest.json`。这与 2026-10-06 定下的口径一致：**工具只做文件工具做不到的事**
   （引擎状态机、外部调用、图像处理与台账、写完要推给已打开舞台的写入）。
3. **2.10 舞台分叉**：本轮按"搬改动 + 补测试"处理，不动 stage-ai 的仓库结构。分叉与 main 的漂移是
   结构性问题，处置建议写在文末。
4. **2.11 的"媒体层无回归用例"落在既有的 `e2e/verify-media.ts`**，不给插件新引一套 vitest：
   那个套件本来就是"生图后端是桩、抠底是真的"的离线套件，正好是这几条断言的家。
5. 2.11 的"无本地抠底调参脚本"不做：`recut_sprite` 就是那个入口，AIVN 那个 CLI 在插件里没有对应场景。

## 逐条改动

### 1. 立绘提示词后缀补齐四段（audit 2.2，`src/media/assets.ts`）

原后缀只有"公共段 + 色键底 + 手臂留白"，现在照 AIVN `playAssets.ts:1108-1213` 拆成四套并按取景分流：

- `SPRITE_FRAMING_SHOT[framing]`（core 已有）——`half` 的 3:4 不写 "medium shot, waist-up"，模型照样画全身；
- `POSE_TAIL` 补第二句头顶留白（舞台按统一头顶留白摆位，不点明就全体顶到画幅上沿）；
- `PROP_TAIL`——`square`（猫 / 道具）才拼，说的是"完整入画 + 四周留空"，不套人形的手臂留白；
- 差分走 `identitySuffix()`：`HUMAN_IDENTITY` / `PROP_IDENTITY`（"只改表情 / 只改状态"）+ 景别 +
  `IDENTITY_TAIL`（与定妆照一字不差的画风与底色要求）——垫图之外的第二道锁。
- 定妆照垫外部图时补 `neutralReferenceTail()`（"就是参考图里那个人"）。

### 2. 背景 / CG 垫图的编号锚点（audit 2.3，`src/media/assets.ts` + `src/assets.ts`）

`suffixFor()` 对非立绘目标分流：全部垫图都有名字时走 `referenceSuffix()`，把 `references` 的顺序写成
`The attached reference images are, in this exact order: 1) 七濑, 2) 澪 … Do not merge them into one person.`；
混着路径 / 网址（没有名字的）时走 `genericReferenceSuffix()`，能报名字的报名字、剩下的叫
`reference image`。名字的来源是新的 `characterNames(dir)`（角色卡 `name`，走 `sprite:` 绑定后的立绘目录；
没写退回卡 id），再退回素材表 `title`，最后退回 id 本身。

多人 CG 垫两张立绘时，不点明也会出图——不报错、图还挺好看，只是七濑长成了澪。

### 3. 剧作家路径自动补定妆照（audit 2.4，`src/media/assets.ts`）

`ensureNeutral()` 从 `draft()` 提到 `generate()`：

- 差分目标没有已入库的 `neutral`，且该主体**一个差分都没有** → 先自动出一张 `neutral`
  （`NEUTRAL_LEAD` 中性前置描述压住表情词，取景按**立绘级** `baseFraming` 走），结果挂在新字段
  `GeneratedAsset.autoNeutral` 上，`generatedResult()` 在回执里连同 markdown 图片一起给;
- 已有别的差分却没有 `neutral` → 照旧报错（那条差分是拿别的脸锚定的，补一张等于静默换脸）。

一批并发补同一张靠 `inflight` 去重（目标都是 `sprites/<id>/neutral` 这个 key）。
`draft()` 那一侧不变，仍然硬抛——"一次出三张候选"的流程里不该偷偷生成一张没人过目的基准图。

同时修掉一处存量不一致：`resolve()` 原来只读素材表的**立绘级**声明，`declareSprite` 写的
`<主体id>/<差分名>` 覆盖键没人读（上一轮改成"只有差分不同才写"之后更是白写）。现在两级合并，
差分级优先；`baseFraming` 单记立绘级那一个，供自动补的定妆照用。

### 4. 已有同名素材就跳过（audit 2.5，`src/media/assets.ts` + `src/playwriter/tools/generate-image.ts`）

`PlayAssets` 暴露 `exists(target)`（内部 `existing()` 的公开形态），剧作家的 `generate_image` 在
发起前问一次：已有就直接返回"已经有了，直接 `<actor …>` / `<scene bg="…">` 引用它"，不覆盖旧图、
不烧配额。搭台助手那条两步路不加这道守卫——草稿本来就允许反复出候选。

### 5. 读 `play.json` 的 `image` 段（audit 2.7，`src/media/assets.ts`）

`draft()` 里按"调用方显式给 > `play.json` 的 `image.model` / `image.size` > 部署级设置"取模型与档位。
管线本来就是通的（`AssetTarget.model/size` → `ImageRequest.model/size` → 三个后端），缺的只是读盘这一步。
不给工具加 `model` / `size` 参数：逐剧目的生图设置属于剧目文件，不属于模型的每次选择。

### 6. 垫图收 http(s) 网址（audit 2.8，新增 `src/media/web-image.ts`）

新增 `fetchWebImage(url)`：只认 http/https，`redirect: 'manual'` 手动跟跳**每跳重判公网地址**，
边收边判大小（20MB 上限），字节头嗅探 mime，内网 / 回环 / 链路本地 / 云元数据 / CGNAT / v6 映射写法
一律拒。出口代理不自己配（与 `tts.ts` / `exa.ts` 同一口径：DSH 进程带 `NODE_USE_ENV_PROXY`）。

与 AIVN 的差别只有一处：**不落 `media-cache/web-images/` 缓存**——那张缓存是给工坊 `view_image`
复用同一个网址用的，这里下载完直接当垫图字节交给生图后端。

### 7. 舞台层两处改进搬进 `@aivn/stage` 分叉（audit 2.10）

分叉 worktree `/root/projects/stage-ai/.worktrees/dsh-vn-stage`（分支 `feat/dsh-vn-stage`）：

- `packages/stage/src/director.ts`：`SpriteSlot.orderSeq`（入场次序，已在台上的保持不变、退场后重登场递增）
  + `applyVisualCue` 认 `cue.clear` 清空在场表；
- `packages/stage/src/script.ts`：Cue 的 scene 分支接 `clear`；
- `packages/stage/src/StageTheater.tsx`：`zIndex = orderSeq + (说话中 ? 1000 : 0)`，进场图与退场图都带上；
- 顺带把这两处改动依赖的 **core** 部分（`packages/core` 的 `spec.ts` / `parser.ts` / `lineage/replay.ts`
  的 `clear` 支持）也从 main 搬进分叉——分叉自带一份 core 的副本，不搬的话 `packages/stage` 编译不过
  （它的 `@aivn/core` 走 workspace 软链指向那份副本，而插件运行时用的是 main 的 core）；
- 新增 `packages/stage/src/actorCue.test.ts`（21 条）：站位自动分配、属性累积、行为词、`orderSeq`、
  `<scene clear/>` 五种情形。

插件侧：剧作家提示词的《剧本格式》补上 `<scene … clear/>` 的用法与 `leave` 那一行（功能得让模型知道），
两个 README 不动（README 没有 DSL 明细表）。

### 8. `list_assets` 的拆除面

删 `src/tools/list-assets.ts`；`preset-tools.ts` 的基础层只剩 `validate_play`，并把这轮口径写进文件头；
提示词（剧作家《缺图怎么办》、搭台助手两处、`generate_bgm` 描述、随包技能 `galgame-audio`）改成
"看 A 区清单 / 读 `assets/manifest.json`"；`src/play-files.ts` 补一节《素材与描述表 assets/》
（路径即引用名、manifest 的键怎么写、哪些字段可以手写）；两个 README 的工具表删掉那一行、
English 版同步；`e2e/verify-injection.mjs` 的 A12 反转为"不在工具面"，
`e2e/verify-stagehand.mjs` 的 forbidden 里加上它。

### 9. 媒体层回归用例（audit 2.11，`e2e/verify-media.ts`）

新增 17 条断言：四段后缀各一条、编号锚点两条、自动补定妆照三条、`exists` 一条、`play.json` 覆盖两条、
网址拒答一条，外加从 AIVN `apps/server/test/cutout.test.ts` 搬来的四条抠底回归夹（封闭同色块 /
容差是唯一旋钮 / 边界 alpha 是真覆盖率而不是 128 地板 / 绿底亮色前景的分母带符号与 unblend）。

## 留作结构性问题的：`@aivn/stage` 分叉会继续漂

分叉分支 `feat/dsh-vn-stage` 是从 main 的 `ef1ccbfe` 切出去做的"把舞台渲染层抽成包"，
它在 `packages/stage` 里放的是 `apps/web/src/stage/` 在那一刻的**副本**（git 认成 rename，
原文件在分支上是删掉的）。此后 main 每改一次 `apps/web/src/stage/*`，分叉都不会自动跟上，
只能像本轮这样手工搬——而分叉里那份 `packages/core` 副本同样在漂。

两条出路（本轮都没做，因为都超出"修插件的生图"这件事）：

- 把 `packages/stage` 的抽包做进 main：`apps/web` 改成从 `@aivn/stage` 引，分叉与副本一起消失，
  舞台层的每处改进自动到达插件；
- 或者给 dsh-aivn 换一个构建期步骤：从 main 的 `apps/web/src/stage/` 直接生成包（脚本已有一半，
  `scripts/port-stage-css.py` 就是同类的搬运）。

在此之前，每次 AIVN 动舞台层，都得有人记得往分叉搬一次——本轮把这条写进审计文档，
下次核对 `git log main -- apps/web/src/stage` 即可看出漏没漏。
