# 261012 视觉小说/日系 Galgame BGM 生成最佳实践与工坊 Skill · 规划与设计方案

## 1. 目标与背景

AIVN (Stage AI) 拥有工坊会话助手（搭台助手）与剧作家两个 Agent。
目前在 `apps/server/src/agentkit/musicTool.ts` 中已有 `generate_bgm` 工具，并由 `galgame-bgm` skill 提供提示词速查。
然而现有技能指南偏向简单四段式与基本词汇表，缺乏对：
1. **日系 Galgame 音乐特征的声学与和声机理深度解析**（王道进行 4536、丸之内进行、卡农进行、小室进行；单件独奏 + 微弱铺底声学留白；平坦动态 flat dynamics 防出戏；物哀/哀愁感 和声与调式构建）；
2. **频率避让（Frequency Masking Avoidance）与台词垫底工程原则**（1kHz~4kHz 人声清晰度保留，避免多件管弦乐与重击鼓组把配音淹没）；
3. **音乐生成模型（Google Lyria 3.5 / Suno / Udio / MusicGen）提示词工程精准触发词典与陷阱规避**（防止偏向动漫 OP 燃曲、影视大片、Lo-fi Hip-hop 鼓点、劣质 Chiptune、人声或歌词泄漏）；
4. **场景化矩阵（7 大核心 Galgame 戏种）的标准提示词模板与元数据对齐**（与素材库 61 条现有 BGM 词表无缝协同，使剧作家能准确检索到生成的 BGM 并合理分配到 `<scene bgm="...">`）；
5. **工坊助手（搭台者）全流程工作流（需求分析 -> 意图与场景锚定 -> 提示词结构化装配 -> 生成与验证 -> 元数据入库）**。

本方案旨在将上述调研成果与实测经验提炼升级为一套兼具音乐学底蕴、工程实操性、即查即用的工坊通用技能文档 `apps/server/skills/galgame-bgm/SKILL.md`，并在 DSH 全局 Agent Skills (`~/.agents/skills/galgame-bgm`) 与相关参考文档中同步更新。

---

## 2. 核心架构与模块设计

### 2.1 消费者与接口契约
- **第一等消费者**：工坊搭台 Agent（调用 `read_skill(name="galgame-bgm")`）、剧作家（了解音乐库与配乐风格分类）。
- **工具调用面**：
  ```ts
  generate_bgm({
    name: "bgm_spring_afternoon",
    prompt: "solo upright piano, gentle and warm Japanese visual novel daily background music, key of C major, royal road progression, delicate touch, sparse arrangement, steady tempo 84 bpm, seamless loop, pure instrumental only, no drums, no vocals",
    title: "春日闲暇",
    tags: ["日系", "钢琴", "日常", "校园", "明亮"],
    mood: ["温暖", "清新", "日常"],
    scene: ["教室", "日常", "闲聊"],
    loop: true,
    volume: 0.40,
    description: "午后放学后的日常对话垫底，触键轻柔不盖台词；无前后奏，可无限循环。"
  })
  ```
- **素材表与台账**：落盘至 `assets/bgm/<id>.m4a`，元数据写入 `assets/manifest.json`，确保 `list_library` / 素材列表与剧作家 `<scene bgm="...">` 零阻碍对接。

### 2.2 技能文档结构设计 (`galgame-bgm/SKILL.md`)
技能文档必须简洁明了、信息密度极高、摒弃空洞的说教与冗余废话，分为以下 8 个模块：

1. **核心声学铁律（Galgame 配乐的物理约束）**：
   - 频段留白（在中频 1k-4kHz 削减，杜绝盖过角色配音）；
   - 平坦动态（禁止影视化 Crescendo/高潮突变/爬坡，保持背景音量恒定）；
   - 无缝循环（头尾无渐入渐出、无爆音、无特定尾奏、无强起止点）。

2. **六段式提示词黄金结构（Prompt Blueprint）**：
   - `[核心主奏配器]` + `[日系风格与和声色彩]` + `[情绪走向与氛围]` + `[节奏/速度/动态]` + `[循环与声学留白]` + `[绝对负向约束]`。

3. **配器与和声色彩库（日系味的核心密码）**：
   - 配器选择（立式钢琴 Solo、尼龙指弹吉他、高音区钢片琴/八音盒、温暖弦乐 Pad 等）；
   - 和声走向与调式词（Royal Road progression / 4536, Canon progression, Marunouchi / 4-3-6-2-5, Lydian brightness, Minor key with major 7th resolution, Pentatonic / Yonanuki 和风）。

4. **七大经典场景风格矩阵（可直接取用的成熟 Prompt 范例）**：
   - ① 校园日常/闲聊放学 (Slice of Life / Daily Comedy)
   - ② 心动/初恋萌动/独处 (Romance / Gentle Hesitation)
   - ③ 黄昏归途/怀旧物哀 (Sunset Nostalgia / Bittersweet)
   - ④ 泪点/别离/雨中哀婉 (Melancholy Rain / Tearjerker)
   - ⑤ 悬疑/暗流/推理调查 (Suspense / Tension / Mystery)
   - ⑥ 梦幻/序章/概念八音盒 (Ethereal Fantasy / Music Box)
   - ⑦ 终章救赎/真爱誓言 (True End / Emotional Climax Piano)

5. **模型负向与陷阱词避坑表（陷阱词 vs 替代词）**：
   - 针对 `nostalgic` 引来 lo-fi hip-hop 鼓点的规避；
   - 针对 `anime` 引来 J-rock 燃曲的规避；
   - 针对 `orchestral` 引来好莱坞大片的规避；
   - 纯器乐三重强化（`pure acoustic instrumental only, no drums, no percussion, no vocals, no singing`）。

6. **元数据填法与素材库对齐（mood / scene / tags / volume / loop）**：
   - 严格映射现有 61 首既有库词表，杜绝孤岛标签；
   - volume 黄金区间（0.35~0.42）。

7. **模型生成偏差与迭代调优步骤**：
   - 面对模型正向偏移（Positivity Bias）时的加权补正；
   - 84 秒生成周期的快速定位策略（换配器 -> 改和声走向 -> 加负向 -> 调情绪词）。

---

## 3. 实施与交付计划

1. **Phase 1: 计划对齐**：使用 auto_human 进行自主决策对齐；
2. **Phase 2: 规范撰写**：
   - 根据用户 profile 准则（内容型交付物由 expert 子代理从零撰写，主 agent 不代写草稿，避免 AI 腔）；
   - 调度 `expert` 子代理基于调研成果与设计方案从零起草高质量的 `SKILL.md`；
3. **Phase 3: 技能验证与部署**：
   - 验证 `apps/server/skills/galgame-bgm/SKILL.md`；
   - 同步至宿主全局技能目录 `~/.agents/skills/galgame-bgm`；
   - 运行契约守卫 `pnpm check:agent-contract` 确保技能库无漂移；
4. **Phase 4: 汇总与交付**：
   - 产出交付摘要文档，向 `auto_human` 汇报并完成闭环。
