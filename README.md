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

## 剧目目录

```
plays/<id>/
├── play.json          # 剧目定义（进 git）
├── assets/            # 素材（进 git）：backgrounds/ cg/ sfx/ bgm/ sprites/<charId>/
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
