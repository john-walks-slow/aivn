# 工坊出立绘：prompt 与角色卡对不上

2026-10-01 让工坊 agent 给 plays/demo 的小春（koharu）出一张 neutral 定妆照，走完新流程后把暴露的缺漏记在这里。
一轮实跑（`/tmp/koharu-ws.mjs` 无头驱动工坊 WS）暴露六条，前四条是引擎的，后两条是提示词层的。

## 现象与根因

### 1. 定妆照后缀写死了发型（引擎）

`playAssets.ts` 的 `NEUTRAL_SUFFIX` 里有一句 `clear empty white space between the twin tails and between the arms and the body`。
它的本意是抠底要的构图——发梢与身体之间要有纯白留白，剪影连成一片就分不开人物与底色。但后缀的每个词都会被模型当成设定印进图里，
于是**所有角色的定妆照都长出双马尾**：同一轮的手动对照实验里 prompt 明写 `pink long straight hair`，出来的仍是双马尾。

修法：后缀只说哪里要留白（`between the arms and the body and between the hair and the arms`），不碰任何人物特征。
`IDENTITY_SUFFIX`（差分）没问题，它说的是「与垫图一致」，不是「长什么样」。

### 2. 角色卡的外貌没进 prompt（提示词）

出图的人设写了白百褶裙 + 黑过膝袜 + 颈上拍立得，图里是藏青裙 + 白色中短袜 + 肩上包 + 没有相机。
同一天用同一条规则手动直调网关做对照组，把角色卡的锚点逐条写进 prompt——粉发、琥珀眼、泪痣、藏青领巾、白裙、黑袜、乐福鞋、相机全部对上。
所以模型是听话的，漏的是 agent 没把角色卡翻译进 prompt：出图章节没有一条规则要求它带上外貌锚点。

修法：`workshop.ts` 的 `imageGuide` 加一条硬规则，逐项点名（发色 / 发型长度 / 发饰 / 瞳色 / 脸上记号 / 上衣 / 领巾 / 裙 / 袜 / 鞋 / 手持物），
并写明「角色卡没写的不要自己发明」「只写 a girl with pink hair 把衣服留给模型默认，出来的人就不是卡上那个人」。

### 3. 把 neutral 当成 normal 的覆盖（提示词）

agent 汇报「会覆盖 normal.png」，实际新建了 `assets/sprites/koharu/neutral.png` 并往 play.json 的 `sprites` 加了一个键，
demo 里 `normal` 与 `neutral` 从此指向两张不同的人。差分名就是文件名，出 `neutral` 只会多出一个差分。

修法：出图章节写明 neutral 与其它差分名是两个名字，要改 `normal` 就再出一次 `normal`。

### 4. 出图 prompt 不留痕（引擎）

工坊这路 `generate_image` 的 prompt 既不落盘，工具调用也不回灌进工坊线程（`WorkshopMessage` 只存 user/assistant 文本）。
唯一能摊开 prompt 的地方是剧作家预发射那一路（`media-cache/img/manifest.json` + CG 视图的「站内生成」角标）。
换了台机器 clone 下来，只有一张 PNG，说不出它当初是怎么生成的。

第一版修法把 prompt 写进 `assets/manifest.json` 的同名条目（进 git、CG 页本来就会摊开它）。**实跑直接把这个方案否掉了**：
工坊补中文描述时用 `edit_file` 把那一条整个替换成了字符串，引擎记的 prompt 当场消失——同一张表两个写者就是这个结果，
而且引擎的 JSON 重写还会把手写表格里的空行分组冲掉。

最终修法：新开一张 `assets/generated.json`，引擎写、其余只读（`assets/` 下除 `manifest.json` 外都不可写，工坊 `read_file` 读得到）。
一条表一个写者：描述是人话归人写，出图 prompt 是原样留档归引擎写。立绘差分的键用 `<角色id>/<差分名>`，与 `prompt.ts` 查表同一种。
并发出 6 个差分同时记账要走剧目锁（`withPlayConfigLock`），否则读改写会互相冲掉。

### 5. 出图后的自查变成了点头（提示词）

agent 调了 `inspect_asset` 看过图，仍汇报「已严格按照设定完成……白色百褶裙」，而图里是藏青裙；单独追问才承认看错。
自查章节只说了「真抠坏了就重出」，没有核对清单。

修法：出图章节要求逐条核对（发色 / 发型 / 瞳色 / 脸上记号 / 上衣 / 领巾 / 裙 / 袜 / 鞋 / 手持物 / 表情 / 画风 / 抠底），
并点名禁止「已严格按设定完成」这种没有逐条结论的汇报。

### 6. 素材描述表没跟上（提示词 + 键约定）

`assets/manifest.json` 里没有 `neutral` 条目，剧作家看到的差分没有说明。实跑里 agent 补了描述，但键写成了裸 `neutral`。
剧作家查表先试 `<角色id>/<差分名>`，裸键只在回落时才用到——两套约定并存是现实。

修法：出图同轮补描述（提示词），键用 `<角色id>/<差分名>`（提示词）；服务端与素材页改成**按字段合并**两套键，
规范键自己的字段赢、裸键补空，别让一条把另一条挡掉。

顺带：那次实跑里 agent 拿 `normal` 那一行当 `oldText` 锚点，把 `normal` 的描述整行替换掉了。
提示词因此补了一条「oldText 抄那一个键所在的完整一行，别拿别的条目的行当锚点」。

### 7. 出图失败只说一句「服务不可用」（提示词）

网关返回 503「没有可用的 Token」时，agent 的转述是「生图服务暂时不可用」。用户无法判断是自己的额度还是网关挂了。

修法：出图失败把接口原话带给用户（状态码 / token / 额度 / 模型名 / 被拒的尺寸）。

## 与环境有关的（不是代码问题）

- `STAGE_IMAGE_SIZE=1K` 曾经会被判为非法大小写；main 的 d5f4a72 之后 `1K` 正是 Gemini 官方原词（K 必须大写），配置不用改。
- flow2api 的 token 库为空（`/opt/flow2api/data/flow2api.db` 的 `tokens` 表 0 行），接口 503；worktree 的 `.env` 副本改走 cpa 网关。
- 2026-10-01 19:00 左右 cpa 的 `gemini-3.1-flash-image` 返回 429（额度耗尽，约 1h39m 后重置），最后一轮实跑因此没能出图。