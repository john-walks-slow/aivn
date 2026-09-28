# stage-ai MVP 用户验证（P2：演出层与剧目外壳）

## 验证说明

- 验证对象：P2 交付——舞台渲染（背景/立绘三站位/差分切换/fade 转场/打字机/二段式点击/自动模式）+ 剧目库 / Title Screen / 就绪门 + 剧目包导入导出 + 剧本 log 只读视图 + 素材管理页 + 剧目删除
- 素材决策：demo 剧目改用 `feat/galgame-assets` 分支生成的通用素材套件（koharu 8 差分立绘 / 8 背景 / 3 BGM / 2 CG），不再等待 AI 生图专线产出（seedream 网关下线、gemini 配额限制）；demo 剧目从《黄昏的走廊》（mio）改版为《黄昏教室》（koharu）
- 环境/前置条件：`.env` 配置 cpa 网关；`pnpm --filter @stage-ai/server start`（:8787）+ `pnpm --filter @stage-ai/web dev`（:5180）；浏览器开 `http://127.0.0.1:5180`
- **模型现状（2026-09-28）**：cpa 网关 `ms/deepseek-ai/DeepSeek-V4.1-Flash` 全凭据余额不足（insufficient balance，持续态）。验证期间 `.env` 的 `STAGE_MODEL_ID` 已切到 `hwvolc/glm-5.3-flash`（实测 DSL 遵循良好、265 事件 + 三选项 choice 正常收束）。V4.1-Flash 充值后可切回，仅改 `.env` 一行
- 说明：Agent 已完成两轮全链路验证——①e2e-tester 浏览器自动化 + 真实 LLM 十项全流程（报告 `260928-stage-ai-mvp.e2e-P2.md`）；②review 阻塞项与 E2E 发现问题修复后（review-P2.md 的 B1/B2/B3/S1-S4/N1-N3 + E2E P0/P1/P2 项），以浏览器冒烟 + WS 探针 + REST 复验。下表为用户抽查复验项

## 验证项

| 验证步骤 | 预期结果 | Agent 复验结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- |
| 打开 `#/` 剧目库 | demo《黄昏教室》卡片 + 就绪 badge；新建表单与 zip 导入入口可用 | ✓ e2e 全过；premise 空剧目显示「（premise 待补）」不白屏 | 待验证 | |
| 新建一个空剧目，进入其 Title | 「开始游戏」灰置，缺项提示 | ✓ e2e；修复后 premise 占位文案不再判真——空 premise 正确列入缺项 | 待验证 | |
| 回 demo Title，「开始游戏」 | 舞台开演：背景渲染、立绘登场、打字机逐字、行末 ▼、点击推进 | ✓ 浏览器冒烟：bg_classroom_sunset 渲染、koharu 立绘登场、BGM 0.28 循环；首拍等待期显示「剧作家正在落笔…」 | 待验证 | 首拍真实 LLM 30~120s（ARM 设备偏慢） |
| 等到 choice 停止点，点选项 | 选项面板可点，下一拍开演 | ✓ 修复后：打字机未消费完时面板显示「演出进行中…」，演完才弹 3 选项（B2） | 待验证 | |
| free 停止点输入回应；「导演备注」发一条 OOC | 玩家台词并入剧本续演；OOC 在下一拍体现 | ✓ e2e：OOC 三元素（粉笔灰/蝉声/夕阳）全部落实；修复后 OOC 越过 free 时明示「玩家本轮未作回应」，模型不代打玩家台词 | 待验证 | |
| 切「自动 开」；切「剧本」log 视图再切回 | 自动推进；log 只读全文 | ✓ 修复后：自动模式无需点击自动起播 + 行完自动推进（B1）；顶栏按钮点击不再误推进台词（S4） | 待验证 | |
| 演出中/停在 choice 时刷新页面（F5） | 剧本与舞台状态恢复；choice 面板恢复 | ✓ e2e 全恢复；mode=start 后地址栏 ?mode 被剥除且路由同步（N3） | 待验证 | |
| 素材管理页：上传背景、删除；编辑 sprites 映射保存 | 列表即时更新；映射保存后重进页面仍生效 | ✓ e2e 上传/删除/持久化；修复后映射编辑连续输入不再失焦（S1），删除有二次确认（N2） | 待验证 | |
| Title 导出 demo zip → 剧目库导入该 zip | 新剧目卡片出现、就绪、可进入 | ✓ e2e 回环 22 文件；恶意 zip（路径穿越）被拒且零残留（B3，单测覆盖） | 待验证 | |
| Title「删除剧目」 | 确认后剧目从库中消失（含素材与会话） | ✓ REST DELETE + 确认弹窗已验证（本地冒烟） | 待验证 | 不可恢复操作，有 confirm |
| **拔掉 LLM（或网关故障）后点选项/继续** | **显式错误提示 + 「继续」可重试，不再静默空拍循环** | ✓ WS 探针实测（V4.1-Flash 冷却期）：error 全文下发 + pause 停止点；单测覆盖零产出/抛错两路 | 待验证 | P0 修复，e2e 报告问题 1 |
| 听觉与转场 | BGM 轻量循环；背景 0.6s 淡入 | ✓ e2e：bgm_warm_daily 0.28 loop；fade 转场在 | 待验证 | |
| 视觉风格 | plain / clean / 浅色 / 实用 | ✓ e2e 体验评估一致 | 待验证 | |

## 验证结论

待用户验证。

## 未做项（遗留）

| 项 | 现状 | 后续 |
| --- | --- | --- |
| sfx 音效素材 | DSL/舞台/静态服务均已支持，但素材管线未产出音效文件；prompt 不列 sfx 段，模型不会引用不存在的 id | 素材管线补音效生成后即生效，无代码改动 |
| 语音管线（D5） | 角色卡 `voice` 字段与 prompt 注入已就位 | P3 实现 fish-audio 合成 |
| preload_asset 生图管线（D6 时延掩蔽） | 标签在 DSL v1 白名单内，解析并记入谱系日志，web 忽略该 cue | 演出层接入生图 provider 后消费 |
| demo 专属 AI 素材（走廊黄昏 bg 等） | 以 galgame-assets 分支通用套件替代（教室黄昏 bg + koharu 全套） | 需要时用 flow2api/flow-cli 生成专属素材替换文件即可 |
| 移动端适配 | 桌面浏览器为主 | P6（100dvh/软键盘/安全区） |
| 舞台顶栏场景名显示 bg id | `bg_classroom_sunset` 偏调试信息 | P3+ 引入场景表（id → 中文名）后替换 |
| say 的 mood 与立绘差分联动 | prompt 已引导 LLM 情绪变化时发 actor 指令；mood 仍是纯文字标注 | 观察 LLM 遵循率，不足时考虑前端 mood→expression 映射 |
