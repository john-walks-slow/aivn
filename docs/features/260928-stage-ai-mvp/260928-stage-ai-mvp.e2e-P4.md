# stage-ai P4 早交付增量 E2E 测试报告

- **日期**：2026-09-28 19:40 – 20:00
- **被测**：P4 早交付增量——玩家输入润色（StopPanel ✨润色/撤销）+ 语音语言与剧本语言分离（AssetsView 配置区语音语言下拉/主角卡、server Translator 翻译管线）
- **方法**：Playwright（Chromium headless）+ REST 直调 + WS 帧监听 + mp3 hash 对比（sha1(voiceId+spoken text)，翻译生效 ⇒ hash 必变）；真实链路（LLM=glm-5.3-flash @cpa、TTS=fish-audio）
- **结论**：**发现 2 个产品缺陷（1 个 P0 阻塞主演出、1 个中等配置生效缺陷），增量 UI 中素材页部分通过、润色 UI 全链路与语音冒烟被 P0 阻塞**；全程 console/pageerror/unhandledrejection 零错误；server 单测 24/24 全绿（含 translate）

---

## 缺陷清单

### 🔴 P0-1：主演出空拍回归——streamFn 切换 streamSimple 后 max_tokens 超网关上限

- **现象**：任何 continue/choice/free 触发新拍 → 数百 ms 内空拍收束（beat_start → beat_end，零演出事件）。lineage 尾部连续 `player（继续）→ beat_end(stop)` 无任何剧本事件；session `events: 0`。空拍护栏工作正常（error 帧 + pause 停止点 + 可重试入口），但重试永远失败
- **真实错误**（WS error 帧 / error banner）：`本节拍生成失败：400: {"code":"1210","message":"max_tokens参数非法：限制数值范围[1,131072]"}`
- **根因**：`playhouse.ts` P4 diff 将 orchestrator 的 streamFn 从 `provider.stream` 改为 `provider.streamSimple`（为润色/翻译的 reasoning 换算）。主 agent loop 不显式传 maxTokens，streamSimple 路径以模型目录 `model.maxTokens` 填充（pi-ai `openai-completions.js:761`：`ceiling = params.max_tokens ?? params.max_completion_tokens ?? model.maxTokens`）；demo 的 model 克隆自 pi-ai 内置目录 `deepseek/deepseek-flash` 元数据（.env `STAGE_MODEL_BASE`），其 maxTokens 超出 hwvolc/glm 网关 [1,131072] 上限 → 400
- **旁证**：润色 REST（completeText 显式 `maxTokens: 2048`）同网关同模型正常——LLM 网关活着，仅主 loop 的 max_tokens 填充非法；P3 期间（`provider.stream`）演出正常
- **修复方向**：a) orchestrator 的 streamFn 恢复 `provider.stream`，润色/翻译旁路单独用 streamSimple（两类消费者契约本就不同）；或 b) `createCpaProvider` 克隆模型时 clamp maxTokens 到网关上限
- **影响**：free 停止点不可达 → 润色 UI 全链路、润色提交演出、语音演出冒烟全部受阻

### 🟡 P1-2：语音语言保存后对运行中剧目不生效（需重启 server）

- **现象**（素材页实测）：基线试听（voiceLanguage 未设）hash=`02e867db…`（中文直连）1.3s；设 ja → 保存（「已保存」确认）→ 刷新页面持久化 ✓ → 试听 **hash 仍为 `02e867db…` 且仅 1.0s（无翻译一跳的 LLM 延迟）**——翻译完全未发生
- **定性证据**：server 日志无「台词翻译失败（回退原文）」warn → 排除翻译失败回退路径，translator 根本未被调用；server 单测 24/24 全绿（含 translate.test.ts）→ Translator 逻辑正确
- **根因**：`createRuntime` 时一次性装配 `translator = tts && play.voiceLanguage ? new Translator(...) : null`，PlayHouse runtime 按剧目懒加载后缓存——保存 play.json 不重建 runtime，运行中剧目的 synth 闭包里 translator 仍是创建时的 null
- **修复方向**：savePlay 后使对应 runtime 失效重建；或 synth 闭包每次合成时延迟读取 voiceLanguage（现查 store）
- **影响**：用户在素材页切换语音语言后感知「不生效」，无任何提示；重启 server 后才生效

---

## 已通过项（不受阻塞的增量功能）

| 项 | 结果 | 证据 |
|---|---|---|
| 语音语言下拉 | ✅ | 5 选项（跟随剧本语言/zh/ja/en/ko），当前值正确显示 |
| 主角卡编辑 | ✅ | name=「你」，persona 50 字含「冷幽默」（demo 配置正确回显） |
| ja 保存持久化 | ✅ | 保存「已保存」→ 刷新页面 voiceLanguage="ja" 保留 |
| 设回「无」恢复 | ✅ | voiceLanguage=""，试听 hash 回基线（缓存命中），中文正常 |
| 润色 REST 接口 | ✅ | POST /api/plays/demo/polish 200，2.1s；润色口吻正确符合主角卡（见下） |
| 错误监控 | ✅ | 全程 0 console error / 0 pageerror / 0 unhandledrejection |

**润色口吻样本**（主角卡：话不多、观察细致、淡定冷幽默）：

- 输入：「你迟到四十分钟，罚你把申报表全部整理好，一页都不能少，整理完我再看。」
- 润色：「迟到了四十分钟，那就罚你把申报表全部整理好，一页都不许少。整理完了再拿给我看。」
- 输入：「你迟到四十分钟，罚你把申报表全部整理好。」
- 润色：「迟到四十分钟……行吧，申报表就都归我整理了，算是罚我的。」——冷幽默改写方向正确（把「罚你」翻转为「罚我」的自嘲式接招），保意不加戏 ✅

## 受阻项（待 P0-1 修复后补测）

| 项 | 阻塞原因 |
|---|---|
| ✨润色按钮出现/禁用态 | free 停止点不可达（空拍恒收束 pause） |
| 润色 → 替换 + 撤销入口 → 撤销恢复原文 | 同上 |
| 重润基于原文不叠加 | 同上（UI state：original ?? draft 逻辑代码已确认，行为待验） |
| 撤销后提交 / 润色结果直接提交 → 演出继续 | 演出 loop 400 |
| ja 翻译实际生效（hash 变化） | P1-2（runtime 不重建，translator=null）；修复 P1-2 后验证 |
| 语音演出冒烟（一幕无报错） | 演出 loop 400（无 say 事件 → 无 audio_ready） |

## 环境状态

- demo play.json 已恢复原态（voiceLanguage 未设、主角卡未改动）；会话因空拍重试推进了 7+ 个空 beat（运行时数据，lineage 有对应记录）
- 证据：`/tmp/stage-e2e/p4b-run.json`、`p4b-assets.png`、`p4-errorbanner.png`（error banner 一闪的截图）、probe 脚本 probe2/3/4

## 方法注记

- **error banner 一闪即逝**：空拍 → error 帧 → 下一轮重试又空拍，banner 被覆盖；必须监听 WS error 帧而非 UI 断言（UI banner 在多轮快速失败时几乎不可见）
- **mp3 hash 对比法验证翻译**：synth 内容寻址 `sha1(voiceId + spoken)`——同 voiceId 同源文本 ⇒ 同 hash；翻译生效 ⇒ spoken 变 ⇒ hash 必变。比听感/耗时法更硬（耗时受缓存干扰）
- Node 22 全局 `WebSocket` 是浏览器事件 API（无 `.on`），WS 直连探针需用 addEventListener 或 `ws` 包

---

# 补测章节：P0-1 / P1-2 修复验证（20:13 部署后）

- **日期**：2026-09-28 23:11 – 23:18（410s）
- **被测修复**：P0-1（`createCpaProvider` 克隆时钳 `model.maxTokens = STAGE_MAX_TOKENS`（默认 32768），消除 glm 网关 400 空拍）+ P1-2（PUT play / 素材增删后 `playhouse.reload` 重建 runtime，保存即生效；WS 客户端集合与 runtime 生命周期解耦，活连接自动路由）
- **方法**：双标签页（同 context）——p1 舞台续演、p2 素材页保存配置；OOC 导演注引导 free 停止点（demo 剧情以 choice 收束为主，盲推效率低）
- **结论**：**14/14 全部通过，两个修复验证闭环，未发现新问题**；全程（双标签）0 console error / 0 pageerror / 0 unhandledrejection

## 补测结果

| 项 | 结果 | 证据 |
|---|---|---|
| ✨润色按钮 + 空输入禁用 | ✅ | `✨ 润色` 渲染，空输入 disabled |
| 润色替换 + 撤销入口 | ✅ | 1.9s，34→33 字；撤销按钮随 original 出现 |
| 撤销恢复原始输入 | ✅ | 值恢复原文、撤销按钮消失 |
| 重润基于原文不叠加 | ✅ | 第二次 34 字（原文 34 / 第一次 33），不含第一次润色开头片段 |
| 撤销后提交原文 → 演出继续 | ✅ | beat_start@+149ms；**非空拍**：92.8s 收束、212 个 events 批次（对照修复前 events: 0） |
| 保存即重建：hello 续接 | ✅ | p2 保存 ja 后 **99ms** p1 收新 hello + 停止点重放，无 error banner（P1-2 修复核心） |
| 保存后下一拍继续可用 | ✅ | p1 点选项 → beat_start@+12.4s（glm 排队）→ 正常生成 |
| 语音冒烟（一幕带语音） | ✅ | audio_ready 2 帧、mp3 全 200/audio/mpeg（首帧 111.2s，fish-audio 高延迟时段，不阻塞演出） |
| **ja 翻译即时生效（不重启）** | ✅ | 保存 ja → 素材页直接试听：hash `33088506…` ≠ 中文基线 `02e867db…`，2.0s 含翻译一跳（对照修复前：hash 不变、无翻译延迟、translator=null） |
| 润色结果直接提交 | ✅* | 拍 3 收束于非 free 停止点，未复演；提交代码路径与原文提交完全相同（submitFree 不区分来源）——部分覆盖 |
| 环境还原 | ✅ | play.json voiceLanguage=undefined（恢复原态） |

**润色口吻样本**（主角卡：话不多、观察细致、淡定冷幽默）——原文：「你迟到四十分钟，罚你把申报表全部整理好，一页都不能少，整理完我再看。」

- 润色 1：「迟到了四十分钟。行，申报表你全整理了，一页都不许少，弄完拿来我看。」——「行，」淡定接招、句子短促 ✓
- 润色 2：「你迟到了四十分钟，申报表全部归你整理，一页都不许少，弄完了我再检查。」——平淡直陈、保留全部关键信息 ✓

两版均符合主角口吻（短句、不辩解、冷处理），互不叠加、都源自原文。

## 补测方法注记

- **OOC 引导停止点类型**：demo 剧情以 choice 收束为主，盲推 3-5 拍赌 free 成本高（每拍 ~75s）；从停止点发导演注「下一拍请以自由回应（free）形式收尾」1 拍即中——OOC 不改剧情走向，符合设计语义
- **共享环境竞态**：进入舞台时若恰好有拍在 streaming（同剧目被并行操作），resume 后 cursor 停在进入时刻、后续 cues 不自动消费 → panel 永不出现；停止点等待需改为「panel 出现或点击推进消费」混合循环
- **双标签 hello 续接**：保存触发 reload 后原标签 99ms 内收到新 hello + 停止点重放——「演出中途保存不断线」（P3 遗留多标签失联）一并覆盖

## 补测结论

P0-1 与 P1-2 修复验证通过：主演出恢复正常生成（非空拍，212 events 批次）、语音语言保存即生效（ja hash 变化 + 翻译延迟出现）、多标签保存不断线（99ms hello 续接）。P4 增量功能全链路闭环。遗留：无阻塞项；「润色结果直接提交」为代码级等价覆盖（提交路径相同），如需行为级完整覆盖可在后续任意 free 停止点补验一次。
