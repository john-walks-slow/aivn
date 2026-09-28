# stage-ai MVP 实施摘要（P2：演出层与剧目外壳）

> 状态：P2 完成（server 14/14 + core 45/45 单测、全仓 typecheck 零错误、e2e-tester 浏览器全流程 10 项 9 过 + P0 缺陷修复后浏览器冒烟/WS 探针复验、reviewer 阻塞项与建议项全部修复）。P3（语音管线）待开工。

## 背景

P1 文字直播之上补齐「有画面有门面」：舞台视觉演出（背景/立绘/差分/转场/打字机/二段式点击/自动模式）、剧目库与 Title Screen、就绪门、剧目包导入导出、剧本 log 只读视图、素材管理页。demo 剧目改版为《黄昏教室》。

## 交付内容

| 模块 | 内容 |
| --- | --- |
| `apps/web` | hash 路由（`router.tsx`：useRoute/navigate/replace）+ REST 客户端（`api.ts`，本地 DTO）；views 四屏：LibraryView（卡片+就绪 badge+新建+zip 导入）、TitleView（就绪门/继续/素材配置/导出/删除）、StageScreen（theater/log 双视图，mode=start 一次性消费后 replace 剥参）、AssetsView（四目录上传删除+premise/opening/角色卡 sprites 映射编辑）；stage 层：ScriptBuilder cues 轨道（scene/actor/sfx/cg/line）、usePlayback（打字机 35ms/字、二段式点击、自动模式含自动起播、resume 快进、派生 exhausted）、StageTheater（bg fade 转场/立绘三站位/CG 全屏+caption/sfx/bgm 0.28 loop）、useStageSocket（start 原语/expectFresh 丢旧重放） |
| `apps/server` | prompt 素材清单注入（差分优先角色卡 sprites 键名；bg/bgm/sfx 只能取清单 id）；编排器空拍护栏（provider 失败/零产出 → 显式 error + pause 重试，P0）；OOC 越过 free/choice 停止点时明示「玩家本轮未作回应」；PlayLibrary 剧目包导入两段式防 Zip Slip（先全量校验再落盘，零残留）+ 剧目删除 remove；REST DELETE /api/plays/:id + PlayHouse.deletePlay（停 runtime + 删目录）；list 单剧目损坏不拖垮全库 |
| `packages/core` | PlayConfig/CharacterCard/parsePlayConfig 自 server 迁入（`src/play/config.ts`，跨端契约，web 不得 import server）；premise 容忍空值——就绪门负责判缺 |
| `plays/demo` | 《黄昏教室》（koharu：8 差分立绘映射/8 背景/3 BGM/2 CG，素材取自 `feat/galgame-assets` 分支，blob 去重零仓库增长） |

## E2E 验证（e2e-tester 浏览器自动化 + 真实 LLM）

十项功能 9 过、console 全程零错误：剧目库/空剧目就绪门灰置/demo 开演全流程（bg 渲染、立绘 pos-center 不遮对话框、35ms 打字机、▼、点击推进）/三类停止点 + OOC 三元素精准落实/自动模式/log 视图/刷新 resume 全恢复/素材上传删除映射持久化/导出导入回环（22 文件）/BGM。报告：`260928-stage-ai-mvp.e2e-P2.md`。

**P0 发现**：cpa 网关 DeepSeek-V4.1-Flash 余额耗尽后，LLM 失败被静默吞成空拍循环（beat_end act_end 伪装正常，玩家零感知）。

## Review（review-P2.md）与修复

reviewer 结论不准入 → 阻塞/建议/非阻塞全部修复 + E2E 发现同步修复，双通道复验：

- **B1 自动模式流式卡死**：自动推进 effect 漏 `opts.revision`（cues 稳定引用，新事件不触发定时器）→ 补依赖；顺带支持「无台词时自动起播」
- **B2 停止点过早渲染（剧透 + 违背 D4）**：StopPanel 改为 `!busy && exhausted && lineDone` 才渲染，追赶期显示「演出进行中…」——浏览器实测：演完才弹 3 选项
- **B3 Zip Slip**：导入两段式（全量校验 resolve+sep 前缀检查 → 落盘），恶意 zip 拒绝且零残留（修复了校验中途抛错留半成品的次生问题）；play.id 加 `/^[\w-]+$/`
- **P0 空拍护栏**（E2E）：pi agent 的 provider 失败不抛异常而是 message.errorMessage 正常收束——orchestrator 捕获之；beatEvents===0 且无 stop → error 全文下发 + pause 停止点（可重试）；单测覆盖零产出/抛错两路
- **S1 差分编辑失焦**：CharacterEditor 改本地稳定 id 行状态，blur/离散操作提交回角色卡——实测连续输入焦点保持
- **S2 prompt 差分脱节**：expression 列表优先 `Object.keys(c.sprites)`，未配置才回退磁盘 stem
- **S3 无依赖 useEffect**：exhausted 改派生值（`cues.length <= cursor && (无行或行完)`），删除每 35ms 重渲的隐性竞态
- **S4 顶栏按钮冒泡**：← 标题/剧本 补 stopPropagation——实测打字中点击不再跳行
- **E2E P1-2 mood/立绘不联动**：prompt 演出准则引导「情绪变化发 actor 指令，mood 只是标注」
- **E2E P1-3 OOC 越过 free**：user 轮明示「玩家本轮未作回应」，模型不代打玩家台词，回应机会下一拍回归
- **E2E P2-4/5/6**：createEmpty premise 留空（就绪门列缺项）+ parsePlayConfig 容忍空 premise；DELETE /api/plays/:id + Title 删除按钮（confirm）；首拍等待文案「剧作家正在落笔…」
- **N1-N3**：premise 判空防白屏；素材删除二次确认；mode 剥参改走 router.replace（hashchange 同步 useRoute）

## 复验（修复后）

- WS 探针（V4.1-Flash 冷却期）：error 全文（429 model_cooldown）+ beat_end reason=stop pause ✓
- WS 探针（glm-5.3-flash）：265 事件流式 + 三选项 choice（gentle/tease/honest）收束 ✓
- 浏览器冒烟：URL 剥参/等待文案/背景渲染/立绘登场/BGM/打字机/B2 门控/自动起播+推进/S4 不误推进/S1 焦点保持 ✓
- REST：空 premise 就绪门/恶意 zip 拒绝零残留/DELETE 剧目 ✓
- 单测：core 45/45 + server 14/14（新增 store 4 用例 + 空拍护栏 2 用例）

## 环境备忘

- cpa 网关 `ms/deepseek-ai/DeepSeek-V4.1-Flash` 全凭据余额不足（持续态）；`.env` 的 STAGE_MODEL_ID 已切 `hwvolc/glm-5.3-flash`（DSL 遵循良好）。充值后改回一行即可
- 首拍延迟实测 30~120s（ARM 设备 + 网关），等待期已有「剧作家正在落笔…」指示

## 下一步（P3）

语音管线（D5）：PhraseChunker 句级预取 + fish-audio 合成 + 角色 voice 字段消费；素材管线补 sfx 音效；观察 mood→actor expression 遵循率。
