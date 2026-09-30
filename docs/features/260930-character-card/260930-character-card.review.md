# 检视记录

检视者：reviewer 子代理。首轮结论 **不准入**，两个阻塞 + 若干建议；全部处理后复跑全量测试通过。

## 阻塞

### BLK-01 · 保存配置会静默冲掉未保存的 premise 草稿

`AssetsPanel` 的底部「保存配置」只提交 `play.json`，成功后 `reload()` 用服务端的旧前提覆盖 `premiseDraft`——用户在同一面板里改了标题和前提、点底部保存，手写的前提就没了。

**修**：`save()` 现在连同 premise 一起提交（脏才提交），并保留一个「只存前提」的小按钮走同一条路径。premise 就在这块面板里，不跟着同一个保存动作走才是 bug。

### BLK-02 · 导主角卡时复制立绘 → 孤儿文件 + 回执撒谎

`target=protagonist` 时文件照复制、manifest 照写，但 `applyCharacter` 的主角分支直接 return，`spriteMap` 被丢弃。素材页已删掉独立的 sprites 上传格，这批文件在前台彻底不可见不可删。

更要紧的是回执写着「差分映射挂在同 id 的角色上」——根本没挂。

**查证**：`protagonist` 在 `apps/web/src/stage/**` 里零引用，舞台只画 `characters`，`ProtagonistCard` 契约也只有 name/persona。所以这不是 bug 是**契约**：主角没有立绘位。

**修**：`target=protagonist` 时不复制任何图片、不写 manifest；回执改成「主角没有立绘位（舞台只画角色），所以这次没有复制图片」。修的过程中测试抓到一次分支漏洞——`copyMedia=false` 掉进了单文件分支，把第一张图复制成了 `assets/characters/rio.png`，改成显式的 `else if (!isCharacter)`。

## 建议项

| 项 | 问题 | 处置 |
| --- | --- | --- |
| SUG-01 | 角色卡上的导入按钮 tooltip 说「导入 `${char.id}` 的角色卡」，实际是按条目 id 新建/覆盖，不是填这张卡 | 改 tooltip 如实说明 |
| SUG-02 | `layer === "arcs"` 认纪元卡 → 用户自己建的 `index/arcs/` 设定卡会被分支过滤静默杀掉 | `IndexCard` 加显式 `arc: boolean`，过滤只认它。**这是 index 开放任意子目录的直接代价** |
| SUG-03 | `parseCard` 丢掉了原有的「无 `# 标题` 回退文件名」 | 恢复回退（重构引入的回归） |
| SUG-04 | `readCard` 丢了纯文件名匹配——子目录卡传 `school` 命中不了 | 匹配条件加 basename；补了一条文件名≠标题的用例（原用例两者恰好同名，是假绿） |
| SUG-05 | 主角分支用 `??`，空串 `""` 会覆盖已有名字 | 统一真值判据（与普通角色分支一致） |
| SUG-06 | 存量剧目（`plays/mh`）前提只在 play.json 里，就绪门直接拦死 | `premise()` 文件缺失时只读回退到旧字段。**只读不自动搬**——不静默改用户数据，但也不让升级把别人的剧目判死 |
| INF-01 | `read_memory_detail` 描述举例 `lore/结界` 是目录不是卡，会引导模型传错参 | 换成 `locations/旧校舍` |
| INF-02 | `relative()` 在 Windows 吐反斜杠 | `.replace(/\\/g, "/")` 归一 |
| INF-03 | 主角卡带立绘、并发场景没测 | 补了主角不复制媒体的用例 |

## 未处理的取舍

- **旧剧目迁移**：只做了读回退，没写自动迁移脚本。理由：play.json 是用户数据，升级不该替用户改文件；UI 里能看到原文并一键存进 memory 即可。
- **角色卡导入按钮的语义**（SUG-01）：按用户明确要求「主角卡和角色卡右边也应该有自己的从资源库导入按钮」保留在卡片上，只改了 tooltip。挪到角色列表顶部会让「从库里挑角色」更直观，但那是另一个交互设计决定，不在本次范围。

## 复检

`pnpm typecheck` 三个包通过；`pnpm test`：core 92 / web 31 / server 257 全绿（3 例生图 e2e 默认 skip）。

UI 层仍无实机截图（见 summary 的说明），检视只覆盖到代码与测试层。
