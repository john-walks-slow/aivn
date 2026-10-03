# 检视报告

## 概要

本次检视涵盖将剧作家创作口径从系统提示词完全剥离至 `memory/always/craft.md`、生图「提前 3–5 句」彻底移除、`<comment>` 去邀请化、以及工坊搭台助手支持自定义提示词段的全链路改动。整体实现克制精准、架构边界清晰，彻底解决了引擎硬编码台词风格与用户个性化创作偏好冲突的历史包袱，并在工坊 agent 引导与单剧目定制之间建立了清晰的协作闭环。

## 需求对齐

本次改动完全满足并对齐了全部既定决策，无遗漏与过度设计：

1. **生图提示词撤掉「提前 3–5 句发起」**：
   - [prompt.ts:114, 275](apps/server/src/prompt.ts#L114) 及相关注释中的三处「3–5 句」全数清理，改为「照常引用」与「若干句台词」。
   - [imageTool.ts:108-114](apps/server/src/agentkit/imageTool.ts#L108-L114) 将排产描述改为客观事实陈述（到货需一分多钟，先上骨架占位，到货自动淡入，无需为了等图停下）。
   - [imageTool.ts:219-237](apps/server/src/agentkit/imageTool.ts#L219-L237) 工具回执文案彻底移除「3–5 句之后再…」等误导性时序指引。
2. **选项数、每轮长度、交互密度、写作风格彻底移入 craft.md 并由工坊引导**：
   - [prompt.ts](apps/server/src/prompt.ts) 删除了常驻常量 `CRAFT_RULES`、「# 单轮该写多长」整节、以及演出契约第 6、7 条硬性长度约束；流程指引明确交代「一轮该写多长、多久给一次停止点，都照剧目的创作口径」。
   - [beatTool.ts:22](apps/server/src/agentkit/beatTool.ts#L22) 将 `options` maxItems 放宽到 8，删除了诱导性的「2~4 条」与「主角必须表态/行动那一刻给」策略说辞，定位回归为仅拦截无效载荷的纯护栏。
   - [workshop.ts:71-99](apps/server/src/workshop.ts#L71-L99) 在设定流程与写作要点中详尽补充了「节奏」偏好引导，指导工坊 agent 在与用户对齐后将创作口径写进 `craft.md`，并明确了必须覆盖的四个核心维度（每轮多长、选项给几条、交还主导权密度、文风与禁忌）。
3. **`<comment>` 标签去邀请化**：
   - [prompt.ts:203-207](apps/server/src/prompt.ts#L203-L207) 小节更名为「## 注释（不产生活动内容）」，正文仅保留事实定义，删除了「记录打算、提醒自己后面要收的伏笔」等鼓励使用的措辞；演出契约和 beat_done 中推荐使用 `<comment>` 的旁白均已移除。测试验证全局仅保留格式定义处 1 处出现。
4. **工坊 Agent 自定义提示词配置**：
   - [config.ts:48-58, 181](packages/core/src/play/config.ts#L48-L58) 为 `AgentSettings` 增加了 `prompt?: string` 并实现解析归一化。
   - [workshopSession.ts:280](apps/server/src/workshopSession.ts#L280) 在 `systemPrompt()` 中实时从 `loadPlay()` 读取 `play.agents?.workshop?.prompt`，保证 Agent 设置修改后下一轮对话即时生效。
   - [workshop.ts:143](apps/server/src/workshop.ts#L143) `customSection` 将补充要求原样追加至固定提示词末尾，空值不留痕迹。
   - [AgentPane.tsx:194-209](apps/web/src/workshop/AgentPane.tsx#L194-L209) 在搭台助手卡片展示「补充要求」输入框并清晰说明与 `craft.md` 的职责分工；剧作家卡片不显示该字段。
   - [README.md:432-460](README.md#L432-L460) 补全了配置表格说明与新增章节「剧作家怎么写，由剧目的创作口径定」。

## 阻塞问题

无。

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S-01 | [apps/web/src/workshop/AgentPane.tsx:225-233](apps/web/src/workshop/AgentPane.tsx#L225-L233) | `setOrClear` 中仅判断 `value === ""`，若用户输入全空格或多个换行，`settings.prompt` 会暂存纯空白字符。在用户清空文本时若误留空白，前端 `Object.keys(settings).length === 0` 无法将其判断为空对象，导致在发送至服务端前 `settings` 无法被自动清理。 | 建议在 `setOrClear` 中对文本字段增加空白判定（如 `value.trim() === ""` 时执行 `delete settings[key]`），保证状态清理的彻底性。 |
| S-02 | [packages/core/src/play/config.ts:173-191](packages/core/src/play/config.ts#L173-L191) | `parseAgentConfig` 遍历了 `["playwriter", "workshop"]` 两个角色，若用户直接在 `play.json` 中给 `playwriter` 手写了 `prompt` 字段，该字段会被读取保留，但剧作家运行时（`buildSystemPrompt`）永远不会读取它。虽然注释和文档已有明确说明，但服务端保留无用配置可能会给手工配置的用户带来“已生效”的假象。 | 建议在 `parseAgentConfig` 中增加限制：仅当 `role === "workshop"` 时才保留 `prompt` 字段；若 `role === "playwriter"` 存在该字段则予以丢弃或忽略。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | [AGENTS.md:3](AGENTS.md#L3) / [.worktrees/craft-style/AGENTS.md:3](.worktrees/craft-style/AGENTS.md#L3) | 项目级与 worktree 级架构速记中仍残留有历史陈述（如「通用创作准则改由 prompt.ts 的 CRAFT_RULES 常驻系统提示词」以及「beat_done ... options 2~4 条」），与当前彻底移除 CRAFT_RULES 及 options 放宽至 8 的现状不一致。 | 建议后续随手更新 `AGENTS.md` 对应的模块速记，避免后续 Agent 查阅时产生认知干扰。 |
| N-02 | [apps/server/src/workshop.ts:143](apps/server/src/workshop.ts#L143) | `customSection` 追加的标题为一级标题 `# 本剧目的补充要求`。当前作为末尾章节能很好地体现优先级，但若用户自定义内容本身包含多级 markdown 标题，可在此处保持格式自由度。 | 保持现状即可，当前设计简单清晰，足以应对绝大多数提示词注入场景。 |

## 准入结论

**结论**：`准入`

**说明**：本次需求改动目标高度明确，所有修改点均严格契约化落地。引擎内置口径完全移除且通过了完备的负向单测验证；工坊指导、设置界面与文档同步严谨扎实，无任何阻塞问题，可以直接准入交付。
