# stage-ai

AI galgame 引擎：LLM 剧作家（playwriter）流式输出 Stage DSL 增量剧本，服务端解析为 IR 事件经 WS 下发，前端像流式视频一样边生成边演出。玩家兼具演员（入戏表态）与导演（OOC/编辑/分岔/重写）双重身份。

## 快速开始

要求：Node ≥ 22.19，pnpm。

```bash
pnpm install
pnpm -r build          # core 改动后 web/server 走 workspace dist 类型

# 1) 配置环境变量（项目根 .env，不进 git）
cp /dev/null .env      # 然后按下方配置项填写

# 2) 起服务端（REST :8787 + WS）
pnpm --filter @stage-ai/server start

# 3) 起 Web（:5180，/api /plays /ws 代理到 8787）
pnpm --filter @stage-ai/web dev
```

打开 http://127.0.0.1:5180 即可。

## 配置项（.env）

### LLM 网关（必填）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `STAGE_PORT` | `8787` | 服务端端口 |
| `STAGE_PLAYS_ROOT` | `plays` | 剧目库根目录（每子目录一剧目） |
| `STAGE_MODEL_ID` | — | 模型 id（经网关路由的完整 id） |
| `STAGE_MODEL_BASE` | — | pi-ai 内置基础模型（继承 api/元数据） |
| `STAGE_BASE_URL` | — | OpenAI 兼容网关地址（`…/v1`） |
| `STAGE_API_KEY` | — | 网关 API key |
| `STAGE_MAX_TOKENS` | `32768` | 单请求输出上限（max_tokens）。内置元数据的输出上限与网关路由无关（可能虚高超网关限制导致 400），故钳为此值；按网关实际上限调整 |

### 长会话与纪元压缩（可选，默认值适合 128K 窗口的模型）

跑长了以后，对话体不可能无限增长。剧作家只在一个「纪元」内逐轮追加对话；涨到窗口预算时跨过**纪元边界**：早期轮次被压缩成一张 `index/arcs/` 前情提要卡（进 A 区索引），原文早已逐拍落进 `archive/`，仍可用关键词检索到。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `STAGE_CONTEXT_WINDOW` | `131072` | 模型真实上下文窗口。**必须按网关实际限制定**：pi-ai 内置元数据的窗口可能虚高（例如标称 1M 而网关只给 128K） |
| `STAGE_COMPACT_RATIO` | `0.6` | 触发压缩的窗口占比。越小压得越勤（摘要调用更频繁），越大越省调用但单轮 prompt 更贵 |
| `STAGE_KEEP_RECENT_TOKENS` | `20000` | 压缩后保留的最近上下文预算（token）。最近这几轮的原文不进摘要，保留原样 |

约束：`STAGE_KEEP_RECENT_TOKENS` 必须明显小于 `STAGE_CONTEXT_WINDOW × STAGE_COMPACT_RATIO`，否则每轮都判定超标却永远切不出可压段（启动时会告警）。例：窗口 128K 的网关配 `STAGE_CONTEXT_WINDOW=131072`（默认即可）。

压缩失败（网关报错、返回空文本、磁盘写不进去）只打警告并跳过，本节拍照常演出——长会话压缩是省钱的优化，不是演出的前提。

### 语音（可选，不配则无声演出）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `STAGE_TTS_ENABLED` | `true` | 语音总开关（无可用 key 时自动停用） |
| `STAGE_TTS_KEYS` | `~/.config/fish-audio/keys.json` | fish-audio key 列表文件（JSON 数组，多 key 自动轮询 401/402/429） |
| `STAGE_TTS_PROXY` | `http://127.0.0.1:7890` | 访问 api.fish.audio 的代理；留空直连 |
| `STAGE_TTS_BASE_URL` | `https://api.fish.audio` | TTS API 地址 |
| `STAGE_TTS_CONCURRENCY` | `2` | 并发合成上限（句级预取） |

语音行为要点：

- 角色卡 `voiceId` 填 fish-audio 音色 id（素材与配置页有预置音色库下拉 + 试听）；不填则该角色不配音，旁白默认不配音
- 剧目 `voiceLanguage`（ISO 639-1，如 `ja`）：语音语言可与剧本语言不同，台词自动翻译成该语言后配音（素材与配置页「语音语言」下拉可选）；不设则用剧本语言原文
- 合成结果按内容寻址缓存在 `plays/<id>/media-cache/tts/`（分岔/重演同一句不重复烧配额）
- 舞台顶栏 🔊/🔇 开关持久化在浏览器 localStorage（`stage-voice`）
- 文字永远先行：音频未就绪/失败不阻塞演出

## 玩家输入润色

停止点的自由输入框支持 LLM 润色：点「✨润色」按主角卡口吻改写你的输入，不满意可点「撤销」恢复原文；再次点润色始终基于原文重写，不会叠加。润色失败会在输入框下方提示，不影响直接提交原文。

主角卡在剧目 `play.json` 的 `protagonist` 字段，也可在素材与配置页编辑：

```json
{
  "protagonist": {
    "name": "你",
    "persona": "高二学生，话不多但观察细致，淡定冷幽默"
  }
}
```

不设主角卡时润色为通用中文润色（不改口吻，只顺句）。

## 导演注（OOC）

舞台顶栏常驻「🎬 导演」按钮，随时可对剧作家下指令（例：让澪主动提起天文社、把节奏加快、换一种情绪）：

- **演出进行中点开发送**：导演注入队，当前这一拍演完立即带着指令续写下一拍，不用等停止点；按钮上出现「已注入」即已入队。
- **停在停止点时发送**：立刻开新拍。如果上一个停止点还在等你的回应，指令里会附带「玩家本轮未作回应」提示，剧作家不会替你编台词。

导演注只调整接下来的演出方向，不会被写进剧本正文；它同时记入谱系日志。

## 剧目记忆（memory/ 目录）

剧作家有三层记忆，放在剧目目录的 `memory/` 下，纯 Markdown 手工维护（纪元内冻结；改动保存后自动生效）：

```
plays/<id>/memory/
├── always/
│   ├── craft.md         # 剧艺守则：节奏/视角/人设习惯等通用演出规则（每轮注入，可留空）
│   └── premise.md       # 世界观前提（留空则用 play.json 的 premise）
├── index/               # 记忆索引：标题列表每轮注入，剧作家按需读详情
│   ├── locations/       # 地点卡
│   ├── lore/            # 设定/背景卡
│   └── arcs/            # 纪元前情提要卡（长会话自动压缩产物，运行时不进 git）
└── archive/             # 逐拍历史切片（引擎自动写入，检索式召回，不进 git）
```

`arcs/` 无需手工维护：对话体涨到窗口预算（见上「长会话与纪元压缩」）时自动生成一张卡，记录该纪元发生了什么。它是**路线级**记忆——分岔回到早期分支时，不会读到那条分支上尚未发生的纪元摘要。

index 卡格式：首行 `# 标题`，第二行一句话摘要，其余为详情。

```markdown
# 旧校舍拆除
旧校舍将在文化祭后拆除，具体日期未定。
二楼尽头的教室窗朝西，黄昏时整间教室被染成橙色。
```

剧作家每轮会看到全部卡的「标题 + 摘要」，需要细节时自己调工具读；过往剧情则通过关键词检索历史切片——检索结果只包含**当前路线分支**上发生过的往事，走过的其他分支的剧情不会泄漏进来。

## 剧目目录

```
plays/<id>/
├── play.json          # 剧目定义（进 git）
├── assets/            # 素材（进 git）：backgrounds/ cg/ sfx/ bgm/ sprites/<charId>/
├── memory/            # 剧目记忆（见上：always/ 与 index/locations,lore 进 git）
├── media-cache/       # TTS 等生成缓存（不进 git）
├── session.json       # 运行时会话（不进 git）
└── lineage.jsonl      # 行级谱系事件日志（不进 git）
```

剧目包可从剧目库页导入/导出（zip：play.json + assets）。

## 开发

```bash
pnpm test              # vitest（core + server）
pnpm typecheck         # 全部包
pnpm -r build
```

架构与路线（P0–P7）见 `docs/features/260928-stage-ai-mvp/260928-stage-ai-mvp.plan.md`；模块地图见 `AGENTS.md`。
