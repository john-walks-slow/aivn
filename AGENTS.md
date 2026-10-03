# AIVN —— 项目级指引

本项目的模块级指引按目录分开放；动手改某个模块前，先读那一份。

## 模块指引

- `apps/server/` —— 后端：REST + WS 舞台广播 + 演出编排、工坊会话、模型与素材。见 [`apps/server/AGENTS.md`](apps/server/AGENTS.md)。

- `apps/web/` —— 舞台演出层（React 19 + vite）与工坊界面。见 [`apps/web/AGENTS.md`](apps/web/AGENTS.md)。

- `library/` —— 应用级素材资源库，**整个目录不进 git**，放不了模块级指引；说明见下方「素材资源库」一节。

- 其他：`packages/core` —— Stage DSL 规范、流式解析器、IR 事件、WS 协议与谱系数据模型；`plays/` —— 剧目数据，只有 `plays/demo` 这个样例进 git；`scripts/` —— 开发脚本；`skills/` —— 跨剧目的通用做法速查（只给工坊的 `read_skill`）；`docs/` —— 需求、问题与规范记录。

## 素材资源库（library/）

- `library` —— 应用级素材资源库（`STAGE_LIBRARY_ROOT`，**整个不进 git**）：`<kind>/<id>/{meta.json, 素材文件}`，kind ∈ `backgrounds`/`cg`/`characters`/`bgm`/`sfx`，**目录名即素材 id**。
- 服务端只读（增删改由用户在本地目录做，UI 不管这块）。
- `characters/` 是唯一可以零媒体的类别——`meta.character` 就是一张角色卡，立绘是它的可选附件。
- 种子的出处与逐条许可见 `docs/features/260930-asset-library/seed-sources.research.md`。
