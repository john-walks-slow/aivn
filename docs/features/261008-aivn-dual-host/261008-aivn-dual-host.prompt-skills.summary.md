# prompt / skill 契约收敛（P1-9）

> 前置：`261008-aivn-dual-host.plan.md`（两条线定位与维护规则）、
> dsh-aivn 的 `AGENTS.md`（提示词分层规约：机制归工具 DESCRIPTION、食谱归 skill、身份/门控归 persona）。

## 做了什么

**一、把备料流程从常驻提示词下沉成 skill**

独立版原来把「四步备料流程」与「各文件写法」（premise／角色卡／记忆卡／素材表／play.json 字段表）
硬编码在 `workshop.ts` 里，两段合计 3527 字符，**每轮对话都在为它付 token**，
而它只在「起新剧目／改设定」那一刻用得上。DSH 那条线早就下沉了（`aivn-play-setup` 按需加载），
独立版是补课。

下沉后：常驻只剩**指针**（1636 字符，**减 54%**），全文在 `skills/galgame-play-setup/SKILL.md`。

留在提示词里的只有**随实例变化的两件事**——skill 是恒列的、没有能力位门控，所以：

- **门控**：本剧目有没有写口（没开「改剧目文件」时给清单式 fallback，不教它用 `set_craft`）；
- **当前值**：写作参数的生效值由 A 区现读（`craftNow`），skill 里给不了。

这正是 dsh-aivn 的「门控章不能整章下沉」那条规约：正文下沉，指针留门控。

**二、补齐两条线的 skill 缺口**

| | 独立版（改前） | DSH | 独立版（改后） |
|---|---|---|---|
| 备料流程 | 硬编码在 workshop.ts | `aivn-play-setup` | `galgame-play-setup` ✅ |
| 视觉工艺 | `galgame-visual-craft` | `aivn-visual-craft` | 不变 |
| BGM 提示词 | `galgame-bgm` | `aivn-audio`（含选源/授权） | 不变 |
| 免费素材选源与授权 | **缺** | `aivn-audio` | `galgame-audio` ✅ |

`galgame-audio` 是从 DSH 移植的领域知识（40+ 中英日素材源的授权档次、场景→选源映射、
再分发与 AI 训练红线）。移植时改了**两处独立版差异**，不是照抄：

- DSH 版开场说「剧目里没有音频生成工具」——独立版**有** `generate_bgm`，照抄会误导；
- DSH 版说 `generate_bgm` **同步等待**——那是 DSH 的实现，独立版是**后台排产**（发起即返回）。

顺带说明：这类「同一份领域知识在两个宿主下的措辞必须跟着该宿主的工具语义走」，
正是 plan 里「同一用户目标但不同宿主机制，建立契约分别实现」的样子。

## 守卫

新增第 6 项漂移检查：**恒列 skill 的 description 必须能力中立**。

skill 的 `name + description` 恒列进提示词（模型靠它决定要不要读全文），而 skill 没有能力位门控——
description 里点名「没配后端就不注册」的工具，会让没配音乐后端的实例从清单里读到
「用 `generate_bgm` 出曲」，然后去找一个不存在的工具。

首跑即抓到一处既有违规：`galgame-bgm` 的 description 写着「当要给剧目生成 BGM（`generate_bgm`）…」。
已改为「本剧目配了音乐后端时才用得上」。检查器已验证：注入违规立即红，还原转绿。

## 测试

迁移动了三条既有断言，都是**产物漂移**而非回归——它们钉的正文已下沉。按意图改写，不是删守卫：

- 「出图章节只剩职责」：断言提示词里**有指针**（`galgame-play-setup`）；
- 新增配对用例：断言 skill 真能被 `readSkill` 读到，且**迁走的三条关键语义逐条还在**
  （差分键写法、补描述别拿别条目当锚点、重出前先读上一版 prompt）。指针在提示词、语义在 skill，两条配对才防得住「下沉 = 删除」。

> 这就是 P0 检视 S5 的教训的直接应用：那次我把「删信息」误判成「挪层」。
> 这次每一条迁走的语义都有对应断言，且断言的是**它现在在哪**，不是它曾经在哪。

| 项 | 结果 |
| --- | --- |
| `pnpm check:agent-contract` | 6/6（含注入验证） |
| `apps/server` workshop + prompt + agentkit | **123/123** |
| `apps/server` `tsc --noEmit` | 0 |

未跑真实 LLM / 生图 / TTS 后端：本次是提示词与文档结构调整，不触外部服务。

## 没做的

- **没动 `imageGuide` 的职责三条**（谁批准、先出哪张、失败怎么汇报）——那是职责不是食谱，归 persona。
- **没合并两份视觉/BGM skill 的正文**。它们讲的是同一件事，但分别面向两条线的工具语义
  （独立版 `commit_asset` 两步走 vs DSH `generate_asset` 一键），合并会制造第三种说法。
  这份「有意差异」已登记在 `CAPABILITY_MATRIX`。
