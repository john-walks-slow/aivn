# 检视报告

## 概要

本轮检视针对 DSH 插件 `dsh-aivn`（分支 master）最新实施的两项核心功能改动：**剧目舞台皮肤**（`set_stage_style` 工具、17 键白名单双闸校验、SSE style 帧与客户端作用域样式注入）与**插件设置面**（`Config` 扁平化与全字段 `.volatile()`、运行时持有人热替换、Plugins 页设置卡与密钥脱敏边车）。整体架构设计精巧、与 DSH 平台底座能力（cordis loader、volatile 配置提交、`@deepseek-ai/dsh-settings` 表单面）高度对齐，工程质量过硬，测试覆盖充分。

## 需求对齐

检视代码与需求计划（`settings.plan.md`、`stage-style.plan.md`）及端到端验收证据（`stage-style.e2e.md`、自动化套件 25+12 项）严格比对：
1. **舞台皮肤**：
   - 17 键白名单、双闸校验（写闸原子事务拒绝 vs 读闸丢弃坏键回退）、空参对照回显与三态语义（省略/赋值/null）完全满足计划要求。
   - 样式注入方式经实测踩坑后优化为 `<style data-aivn-theme>` 双 `.stage-root` 作用域规则，成功克服了内部组件变量重声明遮蔽问题，默认无 `theme.json` 时零样式规则注入、零视觉差异。
   - 跨会话广播（`PlayContext.broadcastStyle`）与 SSE `style` 全量快照保证了搭台助手操作后已打开舞台免刷新即时换装。
2. **插件设置面**：
   - `Config` 扁平化为 17 字段并全部声明 `.volatile()`，实现了改配置完全不重挂插件的就地生效架构。
   - 四个密钥字段通过 `.role('secret')` 脱敏，数组密钥采用 `union([array, const(undefined)])` 避免空数组误标为已配置。
   - 运行期对象（TTS、Exa、音色表、生图/配乐网关）由无状态 `Runtime` 持有并在 `loader/volatile-update` 下无缝平滑重构。
   - Plugins 页配置卡以 `plugins.bundle.config` 注册，卡片能力状态灯、密钥清除操作和字段校验逻辑完备。

**需求差异**：无遗漏、无偏离，架构设计甚至就地解决了一系列实机边界小坑（如脱敏字段 reset 无法发出 unset、数组密钥默认空数组导致边车误判等）。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | `src/preset-tools.ts:184-188` | `broadcastStyle` 中通过 `ctx.agents.list()` 遍历会话并以 `other.session?.header?.cwd !== dir` 判断同剧目。若某个打开舞台的剧作家会话处于惰性/非活跃状态，其 `LiveAgent` 对象的 `session` 属性可能未即时加载或 `cwd` 缺省（见 `sessionWorkspace` 内的判空），可能在极其边缘的多窗口/多会话场景下漏推 style 帧。 | 可考虑在 `broadcastStyle` 中复用 `sessionWorkspace(ctx, id)` 作为安全取 `cwd` 的兜底访问器，确保跨会话判定逻辑在各种代理类型下行为一致。 |
| S2 | `src/client/settings-card.tsx:283` | `writeSecret` 中对逗号/空白切分的 key 数组处理时，使用 `field.field.endsWith('Keys')` 作为硬编码启发式判断。若将来新增带 `Keys` 后缀但非数组形态的字段，或非 `Keys` 结尾的数组密钥，存在潜在线性耦合。 | 建议直接基于 `field.field === 'ttsKeys' \|\| field.field === 'searchKeys'`（或在 `Field` 接口中显式增加 `multiple?: boolean`）进行显式分发，降低认知负荷与后续字段拓展风险。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `src/style-tokens.ts:466` | `describeTheme` 回执中的每一行输出格式为 `- \`${token.param}\` （已改/默认） ${value}`，对于 `font_ui` 较长字体栈或换行渐变时，回显文本单行较长。 | 当前设计排版清晰且便于模型直接对照复制，若后续回执展示在移动端或较窄终端，可考虑对长字符串稍作换行或折叠展示。 |
| N2 | `src/index.ts:237` | `shell` 字段翻转时调用 `presets.restage(after.shell)`，注释已明确标注仅对新建会话生效。 | 建议在 README 与设置项 hint 的基础上，在用户调整该开关后的日志中输出显式提示，便于开发者联调与故障排查时快速定位。 |

## 准入结论

**结论**：`准入`

**说明**：本次提交的代码设计严密、逻辑严谨，无论是底层事件总线、数据流转、安全双闸机制，还是客户端 React 渲染层与 DSH 设置界面的宿主适配，均具备非常高的成熟度和稳定性。自动化测试全绿且真实端到端体验优秀，无任何阻塞性缺陷，同意准入。
