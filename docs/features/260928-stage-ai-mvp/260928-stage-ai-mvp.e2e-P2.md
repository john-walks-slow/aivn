# stage-ai P2 前端 E2E 测试报告

- **日期**：2026-09-28 16:30 – 17:25
- **被测**：P2 演出层与剧目外壳（web :5180 → server :8787，真 LLM 编排）
- **方法**：camoufox-cli（Firefox）双 tab 浏览器自动化 + REST/磁盘交叉验证；console error/unhandledrejection/console.error 全程 hook 监控
- **结论**：**10 项功能测试 9 项通过、1 项受阻（基础设施故障 + 错误静默缺陷）**；全程 console 零错误；发现 1 个 P0 级错误处理缺陷（LLM 失败被静默吞成空拍）

## 测试环境事实

- demo 剧目《黄昏教室》就绪（8 立绘差分/8 背景/3 BGM/2 CG），开局时无会话
- LLM：cpa 网关（127.0.0.1:9999）`ms/deepseek-ai/DeepSeek-V4.1-Flash`
- 真实首拍生成实测 ~3.5 分钟（30–120s 预估偏乐观，ARM 设备上更慢）

---

## 一、功能测试结果

### 1. 剧目库首页 ✅

- demo 卡片：标题「黄昏教室」+ 绿色「可开演」badge + premise 摘要 + `id: demo`，未就绪剧目卡片显示「未就绪 + 缺：角色立绘映射、背景图」
- 新建表单：id（字母数字_-）+ 标题两字段，创建后自动跳转 Title；取消正常
- 「导入剧目包」zip 入口存在（file input accept=.zip）

### 2. 空剧目就绪门 ✅

- 新建 `e2e-empty` → Title 页「开始游戏」disabled 灰置
- 缺项提示明确：「就绪门未过（缺：角色立绘映射、背景图）——请到素材与配置补齐」+「（空剧目：请在素材与配置中补全 premise 与角色卡）」
- REST 交叉验证一致：`readiness {ready:false, premise:true, characterSprites:false, background:false}`
- ⚠️ 观察项：空剧目创建时 premise 被自动填占位文案「（空剧目：请在素材与配置中补全…）」，readiness.premise 因此判 true。只补立绘+背景即可点亮「开始游戏」而 premise 仍是占位符。UI 文案有引导，但就绪门本身不校验占位内容（见问题 4）

### 3. demo 开演全流程 ✅（核心路径完整走通）

- Title「开始游戏」→ `#/play/demo/stage`（mode=start，会话清空重开）→「（点击开始演出）」手势遮罩 → 首拍 ~3.5 分钟到达
- 背景渲染：`bg_classroom_sunset.jpg`（素材库真实背景，黄昏教室插画）铺满舞台区 ✅
- 立绘登场：`koharu/smile.png`，`pos-center` 站位，位于舞台区下方中央，**不遮挡对话框**（对话框为独立面板）✅
- 打字机逐字：连续采样文本长度 2→4→6→8→10→12→15→17，~35ms/字 ✅
- 行末 ▼ 指示（`.dialog-hint`）✅；行完点击舞台推进正常 ✅
- 生成中 ●●● 呼吸点出现在对话框尾部 ✅
- Title 有进度后出现「继续」按钮（resume 入口）✅；重开局的「开始游戏」清会话生效（lineage 重置）✅

### 4. 停止点交互 ✅（三类停止点 + OOC 全部遇到）

| 停止点 | 表现 | 验证结果 |
|---|---|---|
| choice | 3 个选项按钮 | 拍 1/3/5 停在 choice，点选后触发下一拍 ✅ |
| free | 输入框 + 「说」按钮（空值 disabled） | 输入「两罐草莓牛奶，其中一罐递给我」→ 提交 → 拍 3 LLM 正确演进剧情（草莓牛奶、买二送一、塞进手里）✅ |
| pause/幕完 | 「下一幕」继续按钮 | 拍 5 后出现 ✅ |
| 导演备注 OOC | 「对剧作家说（不改剧情走向的即时指令）」输入框 + 发送/收起 | 发送「加一段环境描写：窗外的夕阳、渐弱的蝉鸣、粉笔灰在光柱中漂浮」→ 下一拍出现「粉笔灰悬在光柱里，缓慢地打着旋」「蝉声比刚才低了些」「夕阳沉到了教学楼背后」——**三元素全部精准落实** ✅ |

### 5. 自动模式 + 剧本 log ✅

- 自动模式开关：「自动 关」↔「自动 开」；开启后**无任何点击**连续自动推进 4+ 行（行完 delay 后自动下一行，打字机照常逐字）✅
- log 视图：「剧本 log（只读）」标题 + 「返回舞台」按钮；场景指示行 `◈ bg_classroom_sunset · bgm_warm_daily`；全文含说话人标注、旁白、心声；来回切换舞台视图状态不丢 ✅

### 6. 刷新 resume ✅

- 停在 choice 时刷新：选项面板恢复可选 + 背景图/立绘/当前台词行/播放进度**全部恢复**（恢复到停止前最后一行，非从头）✅
- 生成中刷新：重连后 stop 状态恢复（「下一幕」按钮再现）✅
- 有会话后 Title 显示「继续」按钮 ✅

### 7. 素材管理页 ✅（在导入副本剧目上测试，未污染 demo）

- 路由 `#/play/:id/assets`；顶部「就绪门：可开演」实时 badge
- 剧目配置：标题/premise/opening 编辑表单
- 角色卡：角色名/persona 编辑 + 8 行 sprites 映射（expression 输入框 + 文件下拉，下拉列全 sprites/koharu/ 文件）+ 添加映射/添加角色/移除角色
- **上传**：ImageMagick 生成 800×450 测试图 → 上传到 backgrounds → 列表即时出现 + 磁盘落盘 ✅
- **删除**：上传的测试图删除 → 列表移除 + 磁盘文件消失 ✅
- **sprites 映射编辑持久化**：normal→shy.png → 保存（「已保存」提示）→ `play.json` 落盘 `normal: "shy.png"` → reload 后下拉显示 shy.png [selected] ✅（已恢复原值）
- 四类素材目录（backgrounds/cg/sfx/bgm）+ `sprites/<角色id>` 上传 cell 齐全

### 8. 剧目包导出/导入回环 ✅

- Title 页「导出剧目包」链接（`/api/plays/demo/export`）→ zip 含 22 文件（play.json + 8 背景 + 3 BGM + 2 CG + 8 立绘）✅
- 剧目库导入（浏览器 file input → 前端 importPlay → POST /api/plays/import 全链路）：
  - 同 id 冲突：正确报错，页面显示 error banner「剧目已存在: demo」✅
  - 改 id 后导入：成功 → **自动跳转新剧目 Title** → readiness ready:true（premise/立绘/背景全绿）→ 可进入、可开演 ✅

### 9. BGM ✅

- scene 指令带 bgm 时：`bgm_warm_daily.ogg` 实际播放（`paused:false, volume:0.28, loop:true, readyState:4`）✅
- log 视图切换时 theater 卸载、audio 移除；返回舞台重新挂载继续播放 ✅

### 10. 演出中稳定性 ✅（有保留）

- **console 零错误**：两个 tab 全程 hook（error/unhandledrejection/console.error）均捕获 0 条，无报错刷屏 ✅
- 保留：演出后段（17:00 后）LLM 凭据耗尽，长时间运行的后半程实际处于生成失败状态（见问题 1）

---

## 二、问题清单

### 🔴 P0-1：LLM 调用失败被静默吞成「空拍」，玩家完全无感知

- **现象**：17:00 起（拍 6 开始，lineage turn 66–73 共 8 拍）每次玩家动作（choice 回应/「下一幕」/OOC steer）后，LLM 生成全部失败，但前端表现一切「正常」——每拍瞬间结束、显示「下一幕」继续按钮、点继续又立即「下一幕」，剧情无限停滞；OOC 也无法拉回；**重开局（清会话 startFresh）第一拍同样直接空拍**。玩家侧没有任何错误提示。
- **根因**（已定位到基础设施层）：cpa 网关 `ms/deepseek-ai/DeepSeek-V4.1-Flash` 全部凭据 `insufficient balance` 进入 cooldown（`reset_time 16m46s`），LLM 请求返回错误。
- **产品缺陷**：编排器把 LLM 失败/空流处理成正常 beat 结束（lineage 仅记 `beat_end {reason:"act_end"}`），**错误没有作为 error 事件下发前端**，也无连续空拍熔断。建议：provider 抛错时向 WS 下发显式 error 停止点（或 error banner），连续 N 拍空内容时告警。
- **复现**：`curl http://127.0.0.1:9999/v1/chat/completions`（Bearer key 见 .env，model=STAGE_MODEL_ID）在余额耗尽期间返回 `model_cooldown/insufficient balance`；此时浏览器任意玩家动作 → 空拍循环。
- **证据**：`/tmp/stageai-p2/evidence/{session.json,lineage.jsonl}`（17:11 备份）；`plays/demo/lineage.jsonl` 当前为重开局后仅 1 行 `beat_end turn 0 act_end`。

### 🟡 P1-2：台词语气标注与立绘差分不联动

LLM 习惯在 speaker 名里写语气/表情标注（「小春（winking）」「小春（笑嘻嘻）」「小春（明亮）」），但立绘切换只认 DSL sprite 指令的 expression。实测台词标「（winking）」时立绘仍停留 smile.png（上一差分），标「（明亮）/（笑嘻嘻）/（轻快）」等非差分名时也无从映射。观感：嘴上说 winking、脸还是 smile。建议 prompt 层引导 LLM 输出 `<sprite expression>` 指令，或 speaker 标注归一化到差分名。

### 🟡 P1-3：free 停止点与 OOC 并发时 free 被静默跳过

free 面板与「导演备注」面板同时可用；在 free 待回应时发 OOC，free 停止点被直接绕过（server 立即开下一拍），LLM 自行脑补续演（本次演出剧情连贯未崩，但玩家失去了回应机会）。四原语正交原则下，建议 OOC 发送时若 stop pending 给出提示或排队。

### 🟢 P2-4：就绪门 premise 占位文案判真

空剧目 premise 自动填占位文案 → `readiness.premise=true`。补齐立绘+背景即可点亮「开始游戏」而 premise 仍是占位符。建议校验占位内容或标记 placeholder。

### 🟢 P2-5：无剧目删除入口

剧目库 UI 与 REST 均无删除剧目能力（DELETE 仅支持素材）。测试清理只能 rm 目录。剧目多了之后管理不便。

### 🟢 P2-6：首拍等待期遮罩无进度感

「（点击开始演出）」静态文案贯穿 3.5 分钟首拍等待（●●● 呼吸点只在首行文本开始流式后出现于对话框）。建议等待期给出「剧作家正在创作开场…」类指示。

---

## 三、体验评估（plain/clean/浅色/实用）

- **整体**：白/米白底、黑白灰层级、系统字体栈、无花哨动画——与预期风格完全一致 ✅
- **舞台布局**：背景铺满舞台区；立绘 pos-center 居中不遮对话框（对话框为舞台下方独立面板）；choice 按钮垂直列表清晰可点 ✅
- **打字机与手感**：~35ms/字节奏舒适；▼ 指示明确；点击推进响应即时（受空拍 bug 影响前一切正常）。二段式快进（打字中点击→立即全文）因后段空拍未能显式验证，行完点击推进已验证
- **log 视图**：说话人标注、◈ 场景指示行、只读全文可读性好
- **信息层级**：剧目库（卡片网格）→ Title（标题/premise/角色/操作按钮）→ 素材页（配置/角色卡/素材目录三段式）层次分明，无冗余
- **小观察**：舞台 banner 显示当前背景名（bg_classroom_sunset）偏调试信息，正式产品可考虑收纳

## 四、截图索引（/tmp/stageai-p2/）

| 文件 | 内容 |
|---|---|
| 01-library.png | 剧目库首页（demo 卡片 + 新建/导入） |
| 02-empty-title.png | 空剧目 Title（开始游戏灰置 + 缺项提示） |
| 03-demo-title.png | demo Title（premise/角色/开始游戏/导出） |
| 04-stage-firstbeat.png | 首拍舞台（背景渲染 + 台词 + ▼ + choice） |
| 05-stage-sprite.png | 小春立绘登场（smile 差分 pos-center） |
| 06-assets.png | 素材管理页（配置/角色卡/sprites 映射） |
| 07-stage-nextact.png | 幕完「下一幕」停止点（空拍状态） |
| 08-logview.png | 剧本 log 只读视图 |

## 五、清理与环境恢复

- 测试创建的 `plays/e2e-empty`、`plays/demo-import` 已删除（无 UI/API 删除途径，直接 rm；`plays/` 现仅剩 demo）
- demo 留有测试会话：`plays/demo/session.json` + `lineage.jsonl`（重开局后仅 1 行空拍记录；运行时数据不进 git，含问题 1 现场，建议排查后由开发方清理）
- git 工作区未受测试污染（git status 中的改动均为开发方 P2 工作内容）
- 浏览器 tab 已关闭；临时 CORS 文件服务（:18999）已停止

## 六、方法注记

- camoufox-cli 无原生文件上传命令：zip 导入与素材上传通过页面环境注入实现（fetch 同源取 blob → DataTransfer 构造 File → 原型 setter 赋 files → 直接调用 React onChange handler），走完整前端处理链（importZip/uploadAsset → fetch → server 落盘），非绕过前端直调 REST
- 备注：React 19.3 + Firefox 下合成 `change` 事件不被委托监听消费（untrusted click 正常），故采用直调 onChange；不影响被测应用判定
