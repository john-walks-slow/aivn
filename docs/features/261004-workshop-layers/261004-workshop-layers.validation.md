# workshop-layers 用户验证

## 验证说明

- 验证对象：三件事的分层调整——① 角色卡迁到剧目顶层 `characters/`；② 工坊「设定与记忆」拆成「剧目」「记忆」两个页签（剧目排在角色之前）；③ 主角升格为一张普通角色卡（`characters/protagonist.md`，能上台/立绘/音色，只是不给删）。
- 环境/前置条件：
  - 本 worktree 的 dev 实例（`./scripts/dev-worktree.sh`，server 与 web 两端口）。
  - `plays/demo` 已用 `node scripts/migrate-play-layout.mjs --only demo --apply` 迁移过。
  - 主角「上台 / 配音」这条要真跑一轮 LLM 演出，会消耗剧作家的模型额度。
  - 资源库导入主角那条需要 `library/characters/` 里有 `meta.character.protagonist: true` 的条目（仓库自带种子里的 `aoi`）。

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- |
| 1. 打开工坊，看顶部页签 | 八个页签、顺序为 对话 / **剧目** / 角色 / 记忆 / 素材 / 文件 / Agent / 设置 | | 待验证 | 已由实机截图初筛通过（见下「已完成的初筛」） |
| 2. 点「剧目」页，改标题后保存 | 只有这一页写 `play.json`；保存后刷新仍在；此页不再出现任何角色/记忆条目 | | 待验证 | |
| 3. 点「记忆」页 | 只剩 `memory/**` 的卡片（常驻设定在前、设定卡在后）；不列出任何 `characters/` 文件，也不再出现剧目字段（标题/封面那些已搬到「剧目」页） | | 待验证 | |
| 4. 点「角色」页 | 主角卡（id `protagonist`，显示「玩家扮演」）与别的角色并排、同一个编辑器；主角卡没有「移除角色」按钮；底部路径显示 `角色卡：characters/protagonist.md` | | 待验证 | 已由实机截图初筛通过 |
| 5. 在角色页改主角人设并保存，再改一个普通角色的音色并保存 | 两处都保存成功，且 `play.json` 一个字节不变（可 `git diff plays/demo/play.json` 核对） | | 待验证 | |
| 6. 在角色页给主角传一张立绘，或点「生成立绘」 | 立绘落 `assets/sprites/protagonist/`，差分映射写进 `characters/protagonist.md` | | 待验证 | 生图会消耗配额 |
| 7. 主角卡点「从资源库导入」，选 `aoi` 这类 `protagonist: true` 的条目 | 只列出标了主角的条目；导入后 `characters/protagonist.md` 被更新，**立绘与差分映射一起导**（挂到 `protagonist` 名下） | | 待验证 | |
| 8. 让剧作家演一幕主角登场（对白 + 立绘）的戏 | 主角能上台、能用立绘、能出声（音色配了的话）；主角与普通角色表现一致 | | 待验证 | 真跑 LLM，消耗额度；是否上台/配音最终由 `memory/always/craft.md` 决定 |
| 9. 文件页打开 `characters/` 下的卡改一句话保存 | 保存成功并挂撤销条；`assets/**` 仍只读 | | 待验证 | |
| 10. 迁移自己的本地剧目：先 `node scripts/migrate-play-layout.mjs --only <id>`（dry-run，默认可直接跑 `node scripts/migrate-play-layout.mjs` 看全部剧目），确认后加 `--apply` | dry-run 只打印计划；`--apply` 后角色卡从 `memory/always/characters/*.md` 移到 `characters/`，`play.json` 的 `protagonist` 字段变成 `characters/protagonist.md`，空目录被删；软链剧目被跳过 | | 待验证 | 用户自行迁移本地剧目 |

## 验证结论

待验证。

## 待跟进

无。
