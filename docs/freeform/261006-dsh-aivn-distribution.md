# dsh-aivn 的分发形态与发布可行性诊断

日期：2026-10-06 ｜ 作者：主工程师

## 1. 今天到底谁在克隆 dsh-aivn、克隆到哪台机器、卡在哪一步

**结论：今天没有任何人在任何机器上克隆 dsh-aivn，也没有任何人在任何一步失败。**

证据链：

1. **dsh-aivn 没有 git remote**：`git -C dsh-aivn remote -v` 为空。它只存在于这台手机的 `/root/projects/dsh-aivn`，公网上没有任何一个地方能 `git clone` 它。
2. **dsh-aivn 不在 npm 上**：`npm view dsh-aivn` 404；`package.json` 声明了 `"private": true`。
3. **唯一的外部消费者克隆的是 stage-ai，不是 dsh-aivn**：局域网 Windows 电脑（`192.168.71.90`）上有一份 `stage-ai-mirror.git`，用来跑 Windows 专有的 Tauri 打包（`pnpm exe` / `pnpm desktop`）。在 stage-ai 里，`@aivn/core` 与 `@aivn/stage` 是 workspace 依赖（`workspace:*`），自身代码就在同一棵源码树下，根本不需要 npm。
4. **所谓的「发布卡在这一条」是预先焦虑**：源自 dsh-aivn 的 README 在规划发布流程时，假定「将来发布到 DSH 市场时别人要能克隆并构建」，于是把「依赖需要发到 npm」当成了前置阻塞。今天没有任何真实的外部接收方在跑这一步。

主路径工作量归零：**不需要为了一个假设的克隆者把两个内部包发到公网 npm。**

## 2. 若未来确实有外部接收方，三条路的可行性与代价

| 维度 | 路径 1：私有 GitHub 仓库 | 路径 2：vendor/ tarball + `file:`（自包含） | 路径 3：公网 npm |
|---|---|---|---|
| **公开程度** | 私有，不触发公开 | 私有（跟随仓库），不公开内部包 | **完全公开**，DSL 规范与舞台实现暴露公网 |
| **外部克隆能否构建** | 能，但需要同时克隆兄弟仓 stage-ai（同现在的本地开发布局） | **能，完全自包含**：`pnpm pack` 把构建好的 `@aivn/core` / `@aivn/stage` 放进 `vendor/`，`file:vendor/…` 引用 | 能，`npm install` 自动从 registry 拉 |
| **前置仪式** | GitHub 建 private repo + push，约 2 分钟 | `pnpm pack` 生成两份 tgz + 提交，约 3 分钟 | 确认 `@aivn` scope 所有权（403 需确认/建 org）+ 补两个包的 README / LICENSE / 元数据 + 用户 noVNC 指纹授权 |
| **可逆性** | 随时可删/改 | 随时可删/换 | **不可逆**（24 小时后不可撤销，scope 一旦占用无法无痕注销） |
| **隐私扫描范围** | **换成 dsh-aivn 仓库本身**（见下） | **换成 dsh-aivn 仓库本身**（见下） | 扫的是 core / stage 的 tarball（已完成，0 命中） |

### 关键：包和仓库形态改变带来的隐私扫描位移

如果走路径 3，扫描对象是 core / stage 的两份 tarball——这层已经扫过，纯代码 + dist，零泄漏。

但若走路径 1 或 路径 2（真正要把 dsh-aivn 放到 GitHub 上）：**被扫的对象就换成了 dsh-aivn 自己的仓库历史**。
dsh-aivn 里面有：
- `AGENTS.md` 里提到了 `.dsh-e2e-home`、`dsh-base`、宿主环境叙述
- `e2e/verify-opening.mjs` 从会话日志里 dump 出过包含宿主环境的系统提示词片段（含 `127.0.0.1:55002`、token `e2etest`）
- 历史提交里有多次 `lib/` 产物（里面有打包前的环境痕迹）

要 push 到 GitHub（哪怕是私有，更别提公开），按 `before-publish-repo` 阶段 A，必须对 dsh-aivn 做完整的全历史扫描与清洗——这才是真正的大活。今天不做发布，这笔成本完全不必付。

### 推荐路径：路径 2（如果真需要独立克隆构建）

如果未来真的要把 dsh-aivn 拷到别的机器（例如一台新的开发机）：
不用注册 npm，用 `pnpm pack` 出两份 tgz，放进 dsh-aivn 的 `vendor/`，package.json 写 `"@aivn/core": "file:vendor/aivn-core-0.3.1.tgz"`。
自包含、不依赖兄弟目录、不惊动公网 npm、不需要指纹、随时可换。

## 3. 现场 Nit 修复

`e2e/verify-rebuild.ts` 头部注释写了 `npm run e2e:rebuild`，但 package.json 里并没有这个 script（它走的是 `node e2e/run.mjs rebuild`）。已修：注释对齐为真实命令，不给 dirty 的 package.json 叠改动。
