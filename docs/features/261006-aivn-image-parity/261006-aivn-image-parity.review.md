# 检视报告

## 概要

检视范围涵盖 `dsh-aivn` 插件（master 分支未提交改动）与 `@aivn/stage` 抽取分支（`stage-ai/.worktrees/dsh-vn-stage`），对标 `261006-aivn-image-parity.audit.md` 未受益清单与 `261006-aivn-image-parity.plan.md` 实施规划。整体评价：改动架构清晰、对标严密，高质量清空了生图与抠底相关的遗留缺陷，删除了冗余工具 `list_assets` 并规范了提示词与回归测试。发现 1 处微小描述建议（非阻塞），无阻塞性架构与安全缺陷，整体达成高标准准入。

## 需求对齐

变更完整满足了指令「解决全部」以及计划文档中的各项决策：
1. **未受益清单逐项闭环**：
   - 2.2：立绘提示词后缀补齐四段（`SPRITE_FRAMING_SHOT` 景别、`POSE_TAIL` 头顶留白、`PROP_TAIL` 非人主体留白、`identitySuffix` 差分身份锁与定妆照外部垫图尾注）。
   - 2.3：背景与插图（CG）垫图实现顺序编号锚点（`referenceSuffix` 与 `genericReferenceSuffix`），并能通过 `characterNames` 从角色卡/素材表反查角色显示名。
   - 2.4：剧作家路径支持 `ensureNeutral` 自动补定妆照（并防范已有差分时的静默换脸风险），回执正确透传 `autoNeutral` 与 markdown 预览。
   - 2.5：实现 `exists()` 守卫及 `existingNote()` 回执，剧作家重复出图时直接跳过并引导直接引用。
   - 2.7：`draft()` 支持按「显式参数 > `play.json` 的 `image` 段 > 部署配置」优先级覆盖模型与画幅档位。
   - 2.8：新增 `fetchWebImage()` 支持 http(s) 网址垫图，具备完善的 SSRF 防护（每跳重判公网、回环/云元数据/CGNAT 封禁、20MB 流式截断、字节头嗅探）。
2. **`list_assets` 清除与工具面瘦身**：
   - 成功删除 `src/tools/list-assets.ts`，将 `validate-play` 提为基础层共用工具，提示词全面对齐「看 A 区注入清单 / 读 manifest.json」。
   - `e2e/verify-injection.mjs` 与 `e2e/verify-stagehand.mjs` 测试断言正确反转。
3. **舞台层能力同步（audit 2.10）**：
   - 舞台包 `director.ts`、`script.ts`、`StageTheater.tsx` 搬入了 `orderSeq`（入场次序与 z-index 叠压、说话人置顶）以及 `<scene clear/>` 清场。
   - `packages/core` 副本同步了 `clear` DSL 支持，新增 21 条单测覆盖核心行为。
4. **有意偏离 AIVN 的设计核查**：
   - **webImage 不落本地磁盘缓存**：站得住脚。插件内垫图直接作为内存 Buffer 提交生图后端，没有工坊 `view_image` 的前端二次拉取需求，避免了缓存膨胀和生命周期管理负担。
   - **出图工具不暴露 model/size 参数**：站得住脚。模型与画幅覆盖由 `play.json` 剧目配置定义，不增加 Agent 参数认知负担。
   - **`list_assets` 彻底删除而非保留**：站得住脚。A 区每轮已自动注入素材表，且文件系统 `read` 能直读 `manifest.json`，符合「只提供文件工具做不到的工具」原则。

## 阻塞问题

无。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |

## 建议修改

无。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N01 | `src/playwriter/prompt.ts:246-247` | 剧作家提示词中仍保留了「非 neutral 的差分自动垫该主体的 neutral 定妆照，所以那个主体得先有 neutral」的描述，但代码底层已通过 `ensureNeutral()` 实现了无差分时自动补定妆照。 | 建议在后续迭代中微调此处提示词，说明「若该主体未曾出图，引擎会自动先出一张 neutral 定妆照；已有差分但缺 neutral 时则需显式补充」，使模型对自动出两张图的行为预期更准确。 |

## 准入结论

**结论**：`准入`

**说明**：全部对标项均已高水准实现，SSRF 防护严密，自动补定妆照、编号锚点与分层覆盖等关键逻辑均有端到端测试与单测锁定，舞台包同步完备，准予交付与合并。
