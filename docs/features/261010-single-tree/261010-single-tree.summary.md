# 单树模型：实施总结

日期：2026-10-10
分支：`feat/single-tree`

## 已完成

- 一个剧目只保留一棵谱系树。
- `session.json`、`lineage.jsonl`、`meta.json` 移到剧目根目录。
- 删除 `PlaySaves`、`saves/`、`active.json`、切档/删档/改名 API、周目页和周目 UI 状态。
- `hello` 删除 `saveId` / `saveName`；保留 `start` 作为空树首次开演动作。
- 标题页已有历史时仍显示 `START / 新的开始`。
- “新的开始”通过 `?new=1` 传递一次性意图，舞台连接空闲后发送 `restart`。
- 服务端 `restartFromRoot()` 复用 root fork + resume，从 `play.initialState` / `play.initialScene` 开始，不复用旧路线。
- 根节点状态回写补上 `state.scene` 兜底。
- 工坊故事树只读根目录 `lineage.jsonl`、`session.json`、`meta.json`。
- `memory` 未做物理隔离；剧作家提示词改用 `rules / lores` 的用户语义，保留 `memory/index` 物理路径，并提醒当前路线优先、其他分支事实不得带入。
- 删除旧周目页面样式、旧测试与无用保存模块。

## 仍然保留的边界

- `memory/index/**` 仍是剧目级文件，暂不做分支级物理隔离。
- `memory/always/state/*` 仍是工作文件，分支状态真相源是谱系快照。
- 历史设计文档中关于多周目的记录保留作为历史，不代表当前实现。
- 不做旧版 `plays/<id>/saves/<saveId>/` 运行数据迁移；当前项目尚未正式上线，按项目约定处理。

## 验证

- `pnpm --filter @aivn/core build`
- `pnpm --filter @aivn/agent build`
- `pnpm --filter @aivn/stage build`
- `pnpm --filter @aivn/server typecheck`
- `pnpm --filter @aivn/web typecheck`
- `pnpm --filter @aivn/web build`
- `pnpm check:agent-contract`：9 项通过
- server 受影响测试：11 个文件、277 条用例通过
- web 单树相关测试：3 个文件、6 条用例通过
- core 测试：15 个文件、273 条用例通过
- reviewer 复核：准入，报告见 `261010-single-tree.review.md`

未启动真实 LLM、TTS、生图或开发服务器；本次改动的核心是存储、协议、状态机和 UI 路由，自动化测试覆盖了受影响路径。
