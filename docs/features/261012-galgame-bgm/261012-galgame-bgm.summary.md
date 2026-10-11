# 261012 视觉小说/日系 Galgame BGM 生成最佳实践与 Ambience 拓展 · 交付摘要

## 1. 调研与理论成果
针对视觉小说 (Visual Novel / Galgame) 音乐学特征与声学机理进行了深度解构，产出详尽的调研报告：
- **[261012-galgame-bgm.research.md](docs/features/261012-galgame-bgm/261012-galgame-bgm.research.md)**

### 核心解构点：
1. **三大声学物理约束**：
   - **频段留白（Frequency Masking Avoidance）**：女声/男声台词主要集中在 1kHz–4kHz。Galgame 配乐必须采用稀疏中频编曲（单件乐器独奏 + 弱铺底），避免密集大和弦或管弦乐填满人声区。
   - **平坦动态（Flat Dynamics）**：严禁影视化 Crescendo（渐强爬坡）、突然 Risers 或爆音高潮，保持全程恒定能量级，防止循环播放时在同一接缝处反复突变出戏。
   - **无缝循环（Seamless Loop）**：无前后奏、无淡入淡出台阶、无强起止终止式。
2. **和声底座与修辞转译**：
   - 将日系经典进行转译为模型能精准理解的英文声学词：王道进行 (Royal road 4536) → `maj7 and add9 chords, secondary dominant feel`；物哀与泪点 → `minor key with major 7th resolution, wistful chromatic passing chords`；和风 → `pentatonic scale, traditional Japanese folk touch`；梦幻感 → `Lydian brightness`。
3. **模型偏见与陷阱规避**：
   - 模型天然存在向中性愉悦回归（Positivity Bias），悲伤场景单写 `sad` 极易失效，需通过配器、音区与留白冗余表达。
   - 负向词陷阱：`nostalgic` 会引来 Lo-fi Hip-hop 鼓点；`anime` 会引来 J-Rock 燃曲；`epic` 会引来好莱坞大片。首尾必须做双重纯器乐锚定（`pure acoustic instrumental only, no drums, no vocals`）。

---

## 2. 工坊技能落地 (`galgame-bgm`)
面向搭台助手（工坊），在 `apps/server/skills/galgame-bgm/SKILL.md` 中重构了完整的通用实践指南：
- **[SKILL.md](apps/server/skills/galgame-bgm/SKILL.md)**
- 涵盖六段式 Prompt 黄金蓝图（首尾双重纯器乐锚定）、配器选型表、和声修辞词典、七大经典场景可直接复制范例（校园日常、心动独处、夕阳怀旧、泪点别离、悬疑暗流、梦幻序章、真爱救赎）、负向避坑表、既有 61 首素材库 `mood`/`scene`/`tags` 对齐词表、`volume` (0.35–0.45) 范围及五步调优法。

---

## 3. 实做交付：剧作全套 Original BGM
在真实示范剧目 `plays/mio-observatory`（《星轨尽头的观测记录》）中，使用 `flow2api` 后端严格按照最佳规范实做生成了 5 首原创定制 BGM，并完整补齐了素材表与元数据：
- `bgm_starlit_night.m4a`（星夜观测·日常探索）— 1.99MB，钢琴 + 钢片琴点缀星光，平坦动态微凉夜色
- `bgm_telescope_whisper.m4a`（望远镜侧的私语·独处心动）— 2.45MB，轻柔弦乐与和弦铺底，留出人声频段
- `bgm_lost_constellation.m4a`（失落的星图·物哀八音盒）— 2.30MB，复古八音盒 + 慢速三拍子
- `bgm_cloudy_melancholy.m4a`（秋风残云·哀婉钢琴）— 2.28MB，高音区单音留白，完全避让人声频段
- `bgm_orbit_resolve.m4a`（星轨重现之时·卡农救赎高潮）— 2.30MB，大调卡农和声，真爱升华与释怀

元数据均已严格校准为技能所声明的封闭枚举词表，写入 `plays/mio-observatory/assets/manifest.json`。

---

## 4. 新能力：Ambience（环境氛围音）双轨拓展
1. **引擎既有机制确认**：舞台原生具备独立的 `LoopChannel(ambient)`，音量默认 0.16，与 `bgm` 独立并行循环并支持淡入淡出；`assetRef.ts` 优先在 `sfx/` 中寻址 `ambient` 资源。
2. **素材库扩充（库级准备）**：在通用素材库 `library/sfx/` 中预置了 4 类视觉小说核心 Ambience 素材（无突兀重音、平稳铺底、30s 平滑循环，含完整 `meta.json`）：
   - `sfx_wind_night`（秋夜山风·天台/高空）
   - `sfx_rain_gentle_loop`（窗外绵绵细雨·室内）
   - `sfx_night_crickets_loop`（夏夜虫鸣·静谧街巷）
   - `sfx_clock_ticking_loop`（静谧钟摆滴答·深夜独处）
3. **剧目实做引入**：剧目 `mio-observatory` 已将 `sfx_wind_night.mp3` 正式引入 `assets/sfx/` 并在 `manifest.json` 登记，用于与开场星空 BGM 双轨协同。

---

## 5. 现有剧本改写与升级
已彻底改写 `mio-observatory` 的剧本谱系（`session.json` 与 `lineage.jsonl`），将原有的单一通用 `bgm_piano_soft_loop` 升级为层次分明的剧情声学设计：
- **开篇（天台星空远眺）**：
  `<scene bg="observatory_rooftop" bgm="bgm_starlit_night" bgm_volume="0.38" ambient="sfx_wind_night" ambient_volume="0.18" transition="fade"/>`
  （星夜钢琴 + 秋夜山风双轨铺底）
- **室内探寻（发现父亲的刻度卡纸）**：
  `<scene bg="observatory_interior" bgm="bgm_lost_constellation" bgm_volume="0.36" ambient="none" transition="fade"/>`
  （切入物哀感强烈的八音盒《失落的星图》，并淡出室外风声环境音）

所有分支的活跃 Scene 事件均已升级落地，回放与演出已生效。

---

## 6. 验证与守卫
- `pnpm check:agent-contract`：全部 9 项检查全绿。
- `pnpm --filter @aivn/server test test/assetRef.test.ts`：12 项测试全绿。
- 检视闭环：已针对 Reviewer 提出的 4 个阻塞项（B-001 谱系落盘、B-002 词表对齐、B-003 Ambience 边界说明、B-004 来源标注）完成闭环修复。
