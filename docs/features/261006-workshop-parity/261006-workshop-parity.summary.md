# 搭台助手对标 AIVN 工坊 —— 交付小结

需求（用户原话，2026-10-06）：「要保证搭台助手具有和现在 aivn 的工坊 agent 的同等能力
（包括专属 skill、各类素材生成和管理工具）」，追加「对搭台助手和 playwriter 的系统提示词做审视和优化，
确保 dsh 架构下能够实现设计的功能」。

计划：[`261006-workshop-parity.plan.md`](261006-workshop-parity.plan.md) ·
验证：[`261006-workshop-parity.validation.md`](261006-workshop-parity.validation.md) ·
检视：[`261006-workshop-parity.review.md`](261006-workshop-parity.review.md)

## 交付面

插件仓库 `dsh-aivn` 分两期落地（阶段 1 = `3498299`，阶段 2 = 见 review 记录）。

| AIVN 工坊能力 | 插件落点 |
| --- | --- |
| `files` 改剧目文件 | `write` / `edit` + `set_craft`（移到搭台助手） |
| `readiness` 开演自查 | `get_readiness`（移到搭台助手） |
| `shell` 命令行 | 预设里一行 `tool-bash`，`shell: true` 才装 |
| `view` 看图 | `read_image`（DSH 文件工具自带） |
| `skill` 技能库 | 随包 `skills/`（两份）+ `dsh-skill-filesystem` + `dsh-tool-skill` |
| `voice` 音色库 | `list_voices`（Fish 窗口语义） |
| `search` 联网检索 | `web_search`（自建 Exa 客户端） |
| `image` 生图 | `generate_image`（搭台助手出草稿 / 剧作家同步入库）+ `commit_asset` + `recut_sprite` |
| `music` 配乐 | `generate_bgm`（只给搭台助手；同步等待） |
| `library` 应用级素材库 | **不做**（用户拍板）；旧 `list_library` 改名 `list_assets` 去歧义 |
| `lineage` 故事树 | **不做**（用户拍板）；persona 走 fallback |

两个角色的 persona 都按 DSH 现实逐条核过（两遍「承诺 ↔ 机制」，结论在 validation 的 §2 与 §7），
不留「提示词里写着、代码里没有」的悬空承诺。

## 关键设计（与 AIVN 有意不同的地方）

1. **能力面按后端是否配全判定**：`can.image` / `can.music` 由 `createMediaBackends` 是否建成决定。
   AIVN 那边后端缺失时 `can.image` 仍为真（工具恒注册、提示词照旧教出图）——插件不这样：
   未配 = 工具不注册 + persona 走 fallback，绝不谎报能力。
2. **剧作家缺图走同步出图**（D3）：一次 70–140 秒、出图即入库、回执给最终路径。AIVN 是后台排产 +
   到货广播 + 舞台骨架占位，插件是 DSH 会话模型、没有回合之外的注入通道，所以宁可等。
3. **候选图走 DSH 原生的呈现机制**：不新增 HTTP 路由，回执与回复里贴工作区内绝对路径的 markdown 图片。
4. **`generate_bgm` 同步等待**（一首实测 ~84 秒）：理由同上，回执至少说的是真话。
5. **抠底整份照搬**，只换环境变量前缀（`DSH_AIVN_CUTOUT_*`）：那套参数是拿真实立绘一格一格量出来的，
   转述只会转丢。

## 验过的 / 没验的

验过：类型与构建；素材链路离线套件 **21/21**（桩后端 + 真 sharp，含三条负例）；
搭台助手 e2e **17/17**、注入 e2e **14/14**、舞台 e2e **14/14**（后两者是回归）。

没验：**真后端出图**——本机 flow2api 的网关上游回 `Flow frontend RPC rejected: rpc=ogiZ0b, code=[5]`，
最小请求也复现；Google 官方 API 从本机不可达。这是网关侧的环境问题，恢复后按 validation §10 补跑一次。
另外「工具回执里的 markdown 图片会不会被渲染成图」也没验（没有真图可出），persona 已按
「回执不渲染也看得到」的写法兜住。

## 用户要用的话

`image` 配 `baseUrl` + `model` 就有生图（本机示例 `http://127.0.0.1:38000` +
`gemini-3.1-flash-image`），`music` 同理（`flow-music-lyria-3.5`）。几个坑：
`image.size` 的 `K` 必须大写；`gemini` 格式只认档位、垫图只在这个格式下走得通；
`media-cache/` 建议进 `.gitignore`（`assets/` 要留）；**改配置要重启 dsh**（能力面装载时定值）。
