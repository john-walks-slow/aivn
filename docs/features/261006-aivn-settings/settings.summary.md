# 插件设置面 —— 实施小结

日期：2026-10-06。仓库：`dsh-aivn`（master）。设计依据：[settings.plan.md](settings.plan.md)。

## 做了什么

1. **配置面扁平化**：`src/index.ts` 的 `Config` 从嵌套（`tts.keys` / `image.baseUrl` …）改成**顶层 17 个字段**，每个都 schemastery `.volatile()`。为什么扁平：DSH 设置界面的表单控件生成的写路径只有单段（`path: ['字段名']`），嵌套字段在界面上寻址不到。
2. **四个密钥字段**（`ttsKeys` / `searchKeys` / `imageApiKey` / `musicApiKey`）带 `.role('secret')`，宿主管线上全程脱敏：描述与响应里只报「配没配」，明文不出宿主。两个数组密钥写成 `union([array, const(undefined)])`——schemastery 的数组默认是 `[]`，空数组会让边车误报「已配置」（e2e 抓到并修掉）。
3. **客户端配置卡**（新 `src/client/settings-card.tsx`）：注册进侧边栏 **Plugins → dsh-aivn** 的详情页（`plugins.bundle.config` 槽，key = 包名）。表单不自绘，用 DSH 自己的 `SettingsForm` / `SettingsValueField` / `SettingsSecretField` / `Switch`；分 P0（决定能力开不开）与 P1（口味项）两段，顶部一行能力状态灯，密钥另有「清除已存 Key」。
4. **就地生效**：宿主订阅 `loader/volatile-update` → 重建运行期面（TTS / Exa / 音色表 / 生图与配乐后端）→ 工具面重扫（`installed` 的登记键改成 `preset@revision` 签名）→ shell 翻转时重注册搭台助手预设。能力位门控的 persona 章从「装载时拼死」改成活段（`aivn:stagehand-guide`），`play-context` 的 `can.image` 与 `voice-host` 的 tts/并发也改成现读。
5. **不再需要手改配置**：保存经 `dsh-settings` 落进当前 profile 的 `cordis.patch.yml`（`configEditor.edit`），loader 判 volatile-only 差异后**不 remount**、原位提交进运行中的引用。手改文件仍然有效（同一份配置）。
6. README 配置面章节重写：扁平字段表、界面入口、环境变量兜底、就地生效口径与 shell 的例外。

## 生效口径（e2e 实测）

| 改动 | 已存在的会话 | 新会话 | 证据 |
|---|---|---|---|
| `ttsKeys` / `ttsBaseUrl` / `ttsModel` / `ttsConcurrency` | 下一句台词生效 | 生效 | `verify-settings` S8：不重启时 `/aivn/play` 的 `voice` 由 `false` 变 `true` |
| `searchKeys` / `searchBaseUrl` | 下一轮工具面 + persona 章生效 | 生效 | `verify-settings` + 验收报告 |
| 生图七字段 / 配乐四字段 | 同上 | 生效 | 同上 |
| `shell` | **不生效**（预设行集在活 Agent 上代际保留） | 生效 | 卡片 hint 与 README 都写明「只对新会话生效」 |

## 全局设置项总表（就是界面上的那两段）

P0 = 决定能力开不开；P1 = 默认可用、按口味调。全部 17 项都有界面，没有「只能改文件」的项。

| 级别 | 字段 | 界面标签 | 默认 | 一句话后果 | 界面 |
|---|---|---|---|---|---|
| P0 | `ttsKeys` | Fish Audio Key | 未配 | 配了才有台词语音与 `list_voices`；多把逗号分隔；留空走 `DSH_AIVN_TTS_KEYS` | 只写不回显 + 清除按钮 |
| P0 | `searchKeys` | Exa 检索 Key | 未配 | 配了搭台助手才有 `web_search`；留空走 `DSH_AIVN_EXA_KEYS` | 同上 |
| P0 | `imageFormat` | 生图接口格式 | `gemini` | `gemini` / `openai` / `modelslab`（协议形状，不是产品名） | 文本（枚举校验，写错挡保存） |
| P0 | `imageBaseUrl` | 生图接口地址 | 空 | 与模型都给齐才算配好生图 | 文本 |
| P0 | `imageModel` | 生图模型 | 空 | 同上；配齐后两台都多出图工具 | 文本 |
| P0 | `imageApiKey` | 生图 API Key | 未配 | 本机网关不校验就不填 | 只写不回显 + 清除按钮 |
| P0 | `musicBaseUrl` | 配乐接口地址 | 空 | 与模型都给齐才有 `generate_bgm` | 文本 |
| P0 | `musicModel` | 配乐模型 | 空 | 同上 | 文本 |
| P0 | `musicApiKey` | 配乐 API Key | 未配 | 可留空 | 只写不回显 + 清除按钮 |
| P0 | `shell` | 搭台助手命令行（bash） | 关 | 开了才给搭台助手装 `tool-bash`；**只对新会话生效** | 开关 |
| P1 | `ttsBaseUrl` | TTS 接口地址 | `https://api.fish.audio` | 换自建网关时改 | 文本 |
| P1 | `ttsModel` | TTS 模型 | `s2.1-pro-free` | 换模型后旧音频缓存不再命中（缓存键含模型） | 文本 |
| P1 | `ttsConcurrency` | TTS 并发上限 | `2` | 同时合成的上限 | 数字 |
| P1 | `searchBaseUrl` | Exa 接口地址 | `https://api.exa.ai` | 换代理 / 镜像时改 | 文本 |
| P1 | `imageSize` | 生图档位 | `1K` | `1K`/`2K`/`4K` 或字面像素 | 文本 |
| P1 | `imageTimeoutMs` | 生图超时（毫秒） | `180000` | 出图慢就调大 | 数字 |
| P1 | `musicTimeoutMs` | 配乐超时（毫秒） | `240000` | 一首实测约 84 秒 | 数字 |

## play 级设置项总表（不进 DSH 设置界面）

play 级的东西是**剧目的工作区文件**，不是插件 Config——`dsh-settings` 的表单只编辑插件条目，装不下工作区文件。它们的编辑口是 Agent 工具 + 文件工具（用户偏好：Agent 工具是第一等消费者，界面其次）。

| 位置 | 项 | 级别 | 谁在改 | 说明 |
|---|---|---|---|---|
| `play.json` | `id` / `title` | P0 | `create_play` 写，之后手改 | 缺任一个剧目解析不了 |
| `play.json` | `opening` | P0 | `create_play` 写 | 空舞台上「开演」按钮发出去的那句话 |
| `play.json` | `scriptLanguage` | P1 | 手改（本轮无工具） | 决定给演出看的内容用哪种语言 |
| `play.json` | `craft.beatLength` / `stopOptions` / `assets.*` | P1 | `set_craft` 工具 + 手改 | 每轮篇幅、停止点选项数、四类素材来源意向 |
| `play.json` | `characters` | P0/P1 | 角色卡文件（`characters/<id>.md`） | 卡上有 `name` / `sprite` / `voiceId` |
| `play.json` | `voiceLanguage` / `defaultVoiceId` / `image.model` / `image.size` | — | — | **插件不读**：音色只从角色卡取，生图尺寸走插件配置 |
| `assets/manifest.json` | 逐素材 `framing` / `stature` / `anchor` / `title` | P1 | `commit_asset` / `recut_sprite` 写 | 逐素材的呈现声明，属于素材面，不做界面 |
| `theme.json`（本轮新增） | 17 个舞台皮肤键 | P1 | `set_stage_style` 工具 + 手改 | 见 [stage-style.plan.md](stage-style.plan.md) |
| `memory/always/` | `premise.md` | P0 | `create_play` 写 | 世界观前提 |
| `memory/always/` | `craft.md` | P1 | 手写 | 文风、禁忌、称呼习惯这类只能拿话说的口径 |
| `memory/always/state/` | 好感度 / flags / 场次 / 线索 | P1 | 剧作家 `update_state` | 运行期状态，不该手改 |

**为什么不做 play 级界面**：`play.json` 与素材表是剧目自己带着走的文件（跟剧目一起进 git、被别的工具读写），把它们的编辑器塞进设置页等于在设置里再做一个文件浏览器；舞台 tab 上的「剧目设置」面板是可选的一刀，本轮没做。

## 验证

- `dsh-e2e run e2e/run.mjs settings`：12/12（配置卡渲染、默认值、写入落点、不重启即生效、脱敏、清除、字段保留）。
- 端到端验收（子代理）：[settings.e2e.md](settings.e2e.md)。
- 检视：[aivn-settings-style.review.md](aivn-settings-style.review.md)。
