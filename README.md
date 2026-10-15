# AIVN

AI 驱动的视觉小说引擎，结合文本生成、图像生成、语音和音乐生成能力。

由“工坊”和“舞台”两部分组成：
- 工坊中，用户与 Agent 设计世界观、角色，生成游戏素材。
- 舞台中，用户与 Agent 共同演绎故事。Agent 流式输出 Stage DSL 增量剧本，用户选择选项或自由输入。

---

## 安装与快速上手

服务端是一个内含 Node 运行时与前端产物的自包含可执行文件，无需额外部署数据库或运行环境。

### 1. 启动应用

* **方式一：Windows 安装包（推荐）**
  从 [Releases](https://github.com/john-walks-slow/aivn/releases) 下载 `aivn-<版本>-x64-setup.exe` 安装并启动（安装路径 `%LOCALAPPDATA%\AIVN`，无需管理员权限；若遇系统拦截点「更多信息 → 仍要运行」）。
* **方式二：Windows 免安装版**
  下载 `aivn-<版本>-win-x64.zip`，解压至**有写权限**的目录（勿放 `C:\Program Files`），双击 `aivn.exe`。数据全部存放在同级 `data\` 目录下，整体复制即可迁移。
* **方式三：从源码运行（macOS / Linux / 开发者）**
  环境要求：Node ≥ 22.19、pnpm。
  ```bash
  pnpm install
  pnpm -r build
  pnpm --filter @aivn/server start   # 服务端：默认 [http://127.0.0.1:8787](http://127.0.0.1:8787)
  pnpm --filter @aivn/web dev        # 开发态前端：[http://127.0.0.1:5180](http://127.0.0.1:5180)
  ```

> ⚠️ **卸载备份提示**：Windows 安装版卸载时会一并清除 `%LOCALAPPDATA%\AIVN\data\`，卸载前请务必备份 `data/` 目录。

### 2. 上手三步

1. **配置模型网关**：进入「⚙ 设置 → 模型网关」，填写 OpenAI 兼容网关地址（至 `…/v1`）与 API Key，从下拉列表中选择模型 ID。
2. **创建剧目**：在剧目库点击「新建剧目」，进入**工坊**与搭台助手对话，生成世界观前提（`premise.md`）与角色卡。
3. **开始演出**：进入舞台，通过底部选项或「自由发挥…」推进剧情。

### 3. 局域网访问（手机 / 平板游玩）

新装默认仅监听 `127.0.0.1`。如需在同 Wi-Fi 的移动设备上接着玩：
1. 在「⚙ 设置 → 局域网访问」中开启**允许局域网访问**，手机浏览器打开显示的局域网地址即可同步进度。
2. **Windows 防火墙放行**：若系统弹窗时误点「取消」导致无法连接，可点击设置页的「允许局域网访问（Windows 防火墙）」按钮自动清理阻止规则并添加放行，或手动执行：
   ```powershell
   netsh advfirewall firewall add rule name="AIVN" dir=in action=allow program="C:\path\to\aivn.exe" enable=yes profile=any
   ```

---

## 核心机制

### 演出与玩家输入

* **选肢与插话**：停在停止点时可点选预设台词或自由输入（支持按 `characters/protagonist.md` 人设一键润色）。演出进行中发送的内容会进入右上角排队面板，在下一轮自动注入。
* **导演指示（`OOC：`）**：输入以 `OOC：` 开头的内容不会写进剧本正文，仅作为给剧作家的幕后导演指令调整后续走向。
* **导演生图**：点击舞台「🖼 生图」可结合当前上下文、指定参考立绘与附加指令，实时生成当前幕的 CG 插图。

### 路线树与周目（存档）

不设传统存读档，每次选择与重演均保留在路线树（`lineage`）上，记忆与世界状态随分支严格隔离（不跨分支剧透）：

| 导演操作 | 作用 | 旧内容处理 |
| --- | --- | --- |
| **✎ 改台词** | 原地修改当前台词文本，不调模型、不重演 | 作为旁注保留，可随时再改 |
| **↺ 重演这一轮** | 从本轮开头分岔并保留上次玩家输入，立即重新生成 | 留在旧分支 |
| **⑂ 分岔** | 从选定节点开启新分支 | 原路线完整保留 |
| **⤴ 跳转** | 将世界线游标挂到指定节点，瞬时重演至该状态 | — |

* **多周目**：一个剧目可创建多棵独立的故事树（周目），互不覆盖。
* **原始历史**：在「回顾」面板开启「原始历史」，可查看最近 20 次生成的完整上下文、思考过程、原始 DSL 与工具调用记录。

### 工坊（搭台助手）

工坊是独立于剧作家的 Meta-Agent，通过对话或面板管理剧目资产：
* **八大面板**：对话（多会话管理）、剧目（全局配置与写作参数）、角色（角色卡与音色库）、记忆（三层设定）、素材（立绘/背景/CG/音乐/音效上传与生成）、文件（在线编辑器）、Agent（模型与能力开关）、设置。
* **操作边界**：默认通过白名单工具（`read` / `write` / `edit`）修改剧目文件并经过结构校验，修改在本轮演出结束后热重载生效。工坊可只读检索各周目的故事树（`session.json`），但分支操作需由玩家在舞台路线视图中执行。

---

## 配置指南

### 启动参数（命令行 / `.env`）

仅在进程启动时读取，优先级：**命令行参数 > exe 同级 `.env` > 默认值**。

| 命令行 | `.env` 键 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `-p, --port <端口>` | `STAGE_PORT` | `8787` | 监听端口（被占用时自动向后顺延 20 个；`0` 为随机空闲端口） |
| `--host <地址>` | `STAGE_HOST` | 未设置 | 监听地址。未设置时跟随设置页「局域网访问」开关；显式设置时强制覆盖 |
| `--data-dir <目录>` | `STAGE_DATA_DIR` | `./data` | 数据目录路径（开发态默认为仓库根目录） |
| `--open` / `--no-open` | — | 打包开 / 开发关 | 启动后是否自动打开浏览器 |
| `--selftest` | — | — | 校验打包资源、数据目录与 `sharp` 依赖后退出 |

外部请求支持标准 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量。

### 运行期设置（`data/settings.json`）

在页面「⚙ 设置」中修改或直接编辑 `data/settings.json`，保存即热生效：

| 分组 | JSON 键 | 默认值 | 说明 |
| --- | --- | --- | --- |
| **模型网关** | `baseUrl` / `apiKey` | 空 | OpenAI 兼容网关地址（至 `/v1`）与密钥 |
| | `modelId` | 空 | 默认主模型 ID（取自网关 `/v1/models`） |
| | `models` | 空 | 允许在剧目 Agent 页选择的模型白名单（逗号分隔，留空则显示网关全部） |
| | `nsfwModelId` / `nsfwPrompt` | 空 | 剧作家调用 `enter_nsfw` 时切换的模型与追加提示词 |
| | `modelBase` | `deepseek/deepseek-flash` | 模型不在内置目录时的元数据回退基座 |
| | `maxTokens` | `32768` | 单次请求最大输出 token |
| | `contextWindow` | `262144` | 上下文窗口上限（请按网关实际限制填写） |
| | `compactRatio` / `keepRecentTokens` | `0.6` / `20000` | 触发纪元压缩的窗口比例与保留的最近原文 token 预算（需满足 `keepRecentTokens < contextWindow × compactRatio`） |
| | `beatTimeoutMs` | `240000` | 单轮生成超时（毫秒） |
| **工坊上下文** | `workshopContext.*` | 跟随主模型 | 工坊专属的 `contextWindow`、`compactRatio`、`keepRecentTokens` |
| **生图** | `image.enabled` | `false` | 生图总开关 |
| | `image.format` | `gemini` | 接口协议：`gemini` \| `openai` \| `modelslab` |
| | `image.baseUrl` / `image.apiKey` | 空 | 生图服务根地址（勿带 `/v1` 或 `/v1beta`，`modelslab` 填至 `/api/v6`）与密钥 |
| | `image.model` / `image.size` | 空 / `1K` | 模型名与档位（`1K`/`2K`/`4K` 或字面像素如 `1536x1024`） |
| | `image.reference` | `neutral` | 派生立绘差分或指定角色 CG 时的垫图策略：`neutral`（使用定妆照垫图保一致性）\| `none`（纯文生图） |
| | `image.concurrency` / `image.timeoutMs` | `6` / `180000` | 并发上限与单图超时 |
| **音乐生成** | `music.enabled` | `false` | BGM 生成开关（仅工坊可用，产物为 `.m4a`） |
| | `music.model` | `flow-music-lyria-3.5` | 音频模型名（如 `flow-music-lyria-3.5` / `flow-music-lyria-3-pro` / `musicfx`） |
| | `music.baseUrl` / `music.apiKey` | 空 | 留空则复用 `image.baseUrl` 与 `image.apiKey` |
| | `music.timeoutMs` | `300000` | 单曲生成超时 |
| **语音 (TTS)** | `tts.enabled` | `false` | 语音总开关 |
| | `tts.baseUrl` / `tts.proxy` | `https://api.fish.audio` / 空 | Fish Audio 兼容端点与独立代理 |
| | `tts.keys` / `tts.concurrency` | 空 / `2` | 逗号分隔的 API Key 列表（自动轮询 401/402/429）与并发数 |
| **联网检索** | `exa.enabled` | `false` | Exa 语义检索开关 |
| | `exa.baseUrl` / `exa.proxy` | `https://api.exa.ai` / 空 | Exa 端点与独立代理 |
| | `exa.keys` / `exa.timeoutMs` | 空 / `20000` | 逗号分隔的 Exa Key 列表与超时 |
| **安全与网络** | `password` | 空 | HTTP Basic 访问密码（用户名任意） |
| | `lanAccess` | `false` | 是否监听 `0.0.0.0` 允许局域网访问 |

> ⚠️ **安全警告**：工坊在剧目「Agent」页勾选「命令行（`bash`）」后，Agent 将拥有服务进程所在操作系统的真实 Shell 权限（绕过文件白名单）。**公网部署时请务必设置 `password`，或切勿开启 `bash` 能力。**

### 生图协议差异与立绘抠底

| 特性 | `gemini` | `modelslab` | `openai` |
| --- | --- | --- | --- |
| **端点** | `POST {base}/v1beta/models/{model}:generateContent` | `POST {base}/images/text2img` 及 `/img2img` | `POST {base}/v1/images/generations` |
| **画幅与尺寸** | 原生支持 `aspectRatio` 与 `1K`/`2K`/`4K` | 按画幅换算 `width`/`height`，长边封顶 1024 | 画幅折算为 `WxH` 传入 `size`（16 倍数对齐，上限 `3840x2160`） |
| **垫图支持** | 支持多图（`inlineData`） | 仅支持单张（`init_image`，画幅随垫图） | 不支持（调用垫图直接报错） |

**立绘抠底**：生成的纯色底立绘会自动抠底为透明 PNG 并存入 `assets/sprites/`，抠底前的原图留底在 `plays/<id>/media-cache/sprite-sources/`。若单张立绘抠底不净，可在工坊对话中让 AI 调用 `recut_sprite` 调整参数本地重抠（不消耗生图配额）。进程级默认色键参数可通过环境变量微调：
* `STAGE_CUTOUT_TOLERANCE`（默认 `48`，范围 `0–128`）：色键容差，越大抠除越激进。
* `STAGE_CUTOUT_KEY_SMOOTH`（默认 `0.8`，范围 `0–8`）：掩膜降噪高斯半径，修复 JPEG 块噪声导致的边缘缺口。
* `STAGE_CUTOUT_EDGE_BAND`（默认 `4`，范围 `1–32`）：边缘半透明 alpha 反解带宽（像素）。

---

## 数据与剧目结构

### 目录总览

```text
data/
├── settings.json              # 全局运行期配置
├── library/                   # 跨剧目复用的本地素材库（背景/CG/角色/立绘/BGM/音效）
├── media-cache/               # 全局媒体缓存
└── plays/<id>/                # 单个剧目目录
    ├── play.json              # 剧目配置、写作参数与 Agent 设定（进 git）
    ├── characters/            # 角色卡：<id>.md，玩家固定为 protagonist.md（进 git）
    ├── memory/                # 剧目记忆（always/ 与 index/ 进 git，archive/ 为运行时切片）
    ├── assets/                # 剧目素材（进 git）
    │   ├── backgrounds/       # 16:9 背景
    │   ├── cg/                # 16:9 插图
    │   ├── sprites/<id>/      # 透明 PNG 立绘差分（如 neutral.png, smile.png）
    │   ├── bgm/ & sfx/        # 音乐与音效
    │   ├── manifest.json      # 素材描述、标签与立绘呈现声明
    │   └── generated.json     # 站内出图的 Prompt 台账（引擎自动维护，只读）
    ├── saves/<saveId>/        # 周目存档（lineage.jsonl / session.json / meta.json，不进 git）
    ├── active.json            # 当前激活周目指针（不进 git）
    ├── workshop/              # 工坊对话记录（不进 git）
    └── media-cache/           # 剧目级 TTS 缓存与立绘留底原片（不进 git）
```

### 剧目配置与写作参数（`play.json`）

剧作家的创作行为拆分为结构化的**写作参数**（`play.json` 的 `craft`）与自由文本的**创作口径**（`memory/always/craft.md`）：

```json
{
  "id": "my-play",
  "title": "示例剧目",
  "scriptLanguage": "zh",
  "voiceLanguage": "ja",
  "craft": {
    "beatLength": "medium",
    "choices": "three",
    "assets": {
      "background": "library-first",
      "cg": "generate",
      "sprite": "generate",
      "sfx": "library"
    }
  },
  "agents": {
    "playwriter": {
      "model": "gemini-3.5-flash-lite",
      "thinking": "off",
      "capabilities": ["memory", "image", "library", "search", "nsfw"]
    },
    "workshop": {
      "model": "claude-3-7-sonnet",
      "thinking": "high",
      "capabilities": ["files", "voice", "image", "library", "search", "lineage", "skill", "view", "readiness"],
      "prompt": "慢热悬疑风格，不要一次性抛出所有设定。"
    }
  }
}
```

* **`craft.beatLength`**：每轮篇幅，`short`（3~6 句）/ `medium`（8~15 句，默认）/ `long`（20~30 句）。
* **`craft.choices`**：停止点选项数，`two` / `three`（默认）/ `four` / `free`（仅自由输入框）。
* **`craft.assets`**：素材来源策略（`library-first` 优先查库无则生图、`library` 仅查库、`generate` 自行生图、`off` 不用）。
* **`scriptLanguage` / `voiceLanguage`**：剧本正文语言与 TTS 配音语言（支持写中文剧本、由 LLM 自动翻译为日语后送 TTS 合成）。

### 角色卡（`characters/<id>.md`）

角色卡与立绘解耦（有卡无图、有图无卡均合法）：

```markdown
---
name: 澪
sprite: mio                              # 可选：显式绑定 assets/sprites/ 下的目录，缺省与 id 同名
voice: 清冷少女声
voiceId: aaa111bbb222ccc333ddd444eee555ff # 可选：32 位 Fish Audio 音色 ID
---

高二学生，话少、观察细致，冷幽默。
```

* 一次性无卡角色可在剧本中直接写 `<say id="passerby" name="路人甲">台词</say>`，并在工坊「剧目」页为其指定全局兜底的「无名角色音色」。

### 记忆层（`memory/`）

1. **`always/premise.md`**：世界观与开局前提（**必填**，为空则无法开演），每轮常驻注入。
2. **`always/craft.md`**：文风、禁忌、称呼与叙事视角等定性要求，每轮常驻注入。
3. **`index/**/*.md`**：按需召回的设定卡（如 `locations/`、`lore/`）。首行 `# 标题`，次行一句话摘要，其余为正文。剧作家每轮仅见「标题 + 摘要」，按需调用工具读取全文。
4. **`archive/`**：引擎自动归档的逐轮历史切片。跨过纪元压缩边界后，旧轮次压为路线级前情提要，剧作家通过关键词检索当前分支的 `archive/` 召回细节。

### 素材元数据与立绘呈现（`assets/manifest.json`）

剧作家依靠 `manifest.json` 中的文字描述理解音画内容并决定何时调用，立绘的舞台摆放同样在此声明：

```json
{
  "bg_classroom_sunset": {
    "description": "放学后空无一人的旧教室，落日余晖斜照",
    "tags": ["教室", "黄昏", "室内"]
  },
  "koharu": {
    "title": "小春",
    "framing": "full",
    "stature": "normal",
    "anchor": "bottom"
  },
  "koharu/pout": "鼓着腮帮子，嗔怒傲娇",
  "bgm_bittersweet": {
    "description": "酸甜交织的钢琴弦乐",
    "mood": ["酸甜", "遗憾"],
    "scene": ["回忆", "告白"],
    "durationSec": 73,
    "loop": true
  }
}
```

* **立绘三轴声明**（可写在 `<id>` 主体级或 `<id>/<差分名>` 差分级）：
  * `framing`（取景与出图画幅）：`full`（全身，`9:16`，默认）\| `half`（腰上半身，`3:4`）\| `square`（非人主体/道具/宠物，`1:1`）。
  * `stature`（体量）：`small` \| `normal`（默认）\| `large` \| `huge`。
  * `anchor`（对齐锚点）：`bottom`（贴底，默认）\| `center`（居中悬浮）\| `top`（挂顶）。

### 素材资源库（`library/`）与引用即导入

`data/library/` 下按 `backgrounds/`、`cg/`、`characters/`、`sprites/`、`bgm/`、`sfx/` 分类存放跨剧目素材（一个条目一个子目录，内含媒体文件与 `meta.json`）。
* **引用即导入**：剧本中写下 `<scene bg="xxx" />`、`<actor id="xxx" />`、`<scene bgm="xxx" />` 等标签时，若当前剧目不存在该 ID，宿主会自动从 `library/` 查找同名条目异步复制进剧目并写入 `manifest.json`。
* **BGM 与音效编排**：BGM 与 `ambient`（环境音）跨场景缺省续播，传入 `"none"` 停止；切曲自动做 1.2 秒交叉淡入淡出；音效最多同时叠播 6 轨。

### 特殊舞台标签：全屏标题卡与纯色场

支持章节标题、独白或诗歌的全屏展示（期间自动隐藏底部对话框，点击推进）：

```xml
<scene bg="black" transition="fade"/>
<title align="center" mode="lines">床前明月光
疑是地上霜</title>
```
* `<scene bg>` 支持 `"black"`、`"white"` 或十六进制色值（如 `"#1a1a2e"`）绘制纯色背景。
* `<title>`：`align` 支持 `center` / `top-left` / `top-right` / `bottom-left` / `bottom-right`；`mode` 支持 `lines`（逐行点击揭示）与 `block`（整段显示）。

---

## 两种宿主形态

AIVN 与 `dsh-aivn` 共享核心引擎（`packages/core` 与 `packages/stage`），按使用场景选择：

| 维度 | **AIVN（本仓库独立版）** | **[`dsh-aivn`](https://github.com/john-walks-slow/dsh-aivn)（DSH 插件）** |
| --- | --- | --- |
| **形态** | 自包含桌面应用 / 独立 Web 站 | 挂载于 DSH 的插件（`dsh plugin add github:john-walks-slow/dsh-aivn`） |
| **独有能力** | 路线树、分支/重写、多周目存档、完整工坊面板、独立桌面壳 | 复用 DSH 原生会话历史、文件侧栏、技能机制与后台任务 |
| **适用人群** | 追求完整 Galgame 游玩与创作体验的用户（推荐） | 深度 DSH 用户 |

---

## 开发与构建

```bash
# 测试与类型检查
pnpm test                  # 运行 vitest (core + server)
pnpm typecheck             # 全仓类型检查
pnpm -r build              # 编译全部 workspace 包
bash scripts/verify-fresh-clone.sh  # 验证全新 clone 构建完整性

# 打包（需在 Windows 环境下执行）
pnpm exe                   # 构建单文件服务端 build/aivn.exe 及免安装 zip
pnpm desktop               # 构建 Tauri 桌面版 NSIS 安装包
pnpm icon                  # 根据 apps/desktop/icon.svg 重新生成应用图标

# 稳定性压测（Soak Test）
pnpm soak                                  # 零开销预检（检查服务、就绪门与模型配置）
pnpm soak -- --play=<剧目id> --minutes=20  # 实跑压测，报告输出至 plays/<id>/soak/
```

* **内置技能库**：位于 `apps/server/skills/<name>/SKILL.md`（随包内置 `galgame-visual-craft` 与 `galgame-bgm`），供工坊 Agent 按需调用 `read_skill` 查阅提示词工程规范。新增技能需放在该目录下并重启服务端。
