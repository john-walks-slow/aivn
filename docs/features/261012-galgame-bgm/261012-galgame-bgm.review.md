# 检视报告

## 概要

本次检视覆盖 `galgame-bgm` 技能、调研/规划/交付文档、`mio-observatory` 的素材清单与 session 谱系，以及 BGM/Ambience 的生成、引用、解析、重放和舞台播放契约。底层 `ambient` 双通道和后台 BGM 生成的架构基本成立，但交付摘要所宣称的“剧本改写升级”没有落到实际 session，且素材元数据与技能约定不一致，因此当前不能按“全套原创 BGM + Ambience + 剧本改写”准入。

## 需求对齐

- **技能建设**：基本满足。技能覆盖纯器乐、对白频段留白、平坦动态、循环、场景模板、元数据和调优流程；但其“六段式”正文实际为用途锚定 + 配器 + 风格/和声 + 情绪 + 速度/动态/循环 + 负向排除，和规划中写的顺序表述存在轻微漂移。
- **原创 BGM 实做**：文件层面已存在 5 个 `.m4a`，且 manifest 有对应条目；但当前剧本谱系仍引用旧的 `bgm_piano_soft_loop`，没有证据表明 5 首新曲已接入可演出的剧情路径。
- **Ambience 能力**：底层契约已具备：`SceneAttrs`、解析器、lineage replay、`LoopChannel`、资源索引和库引用均支持 `ambient`。实际剧目只看到 `sfx_wind_night` 已复制入剧目，没有交付摘要所述的四条环境音都入库/接入。
- **剧本改写**：不满足。交付摘要宣称开篇使用 `bgm_starlit_night + sfx_wind_night`、室内使用 `bgm_lost_constellation`、终章使用 `bgm_orbit_resolve`，但实际 `session.json` 的现有场景仍为 `bgm_piano_soft_loop`，检索不到新 BGM、`ambient` 或 `ambient_volume` 引用。
- **契约核验**：实现契约大体一致，但交付文档与运行数据不一致；此外 manifest 中若干元数据词不在技能声明的既有枚举内，削弱了 `list_library`/剧作家选曲的可检索性。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B-001 | [plays/mio-observatory/session.json:1](plays/mio-observatory/session.json:1)；[261012-galgame-bgm.summary.md:49-59](docs/features/261012-galgame-bgm/261012-galgame-bgm.summary.md:49) | 交付摘要宣称剧本已完成三处 BGM/Ambience 改写，但实际 session 谱系仍引用 `bgm_piano_soft_loop`，检索不到 `bgm_starlit_night`、`bgm_lost_constellation`、`bgm_orbit_resolve`、`ambient` 或 `ambient_volume`。因此新曲只是素材，不是已交付的可播放剧本改写；用户从当前存档演出不会得到摘要描述的声音设计。 | 在谱系/剧本的真实写入口完成改写，并确保所有目标分支的 scene 事件都落入 session/lineage；至少覆盖摘要列出的开篇、室内探寻、终章路径。改写后逐条核对 `<scene>` 的 `bgm`、`ambient`、音量与实际 assets 文件存在性，再更新 summary，避免把计划状态写成完成状态。 |
| B-002 | [plays/mio-observatory/assets/manifest.json:32-182](plays/mio-observatory/assets/manifest.json:32)；[apps/server/skills/galgame-bgm/SKILL.md:205-233](apps/server/skills/galgame-bgm/SKILL.md:205) | 新 BGM 元数据使用了技能枚举之外的词：例如 `清新`、`吉他`、`抒情`、`微妙`（其中 `微妙` 在当前技能枚举中存在，但其余词至少有多项不在对应表），旧条目也有 `对白垫底`。技能明确要求不要创造同义词，而提示词又让剧作家按这些字段检索；这会造成生成曲目无法被既有选曲规则稳定命中，违背“与素材库词表无缝协同”的交付目标。 | 选择一种单一真相：要么把 manifest 全部改成技能声明的 mood/scene/tags 枚举，要么扩充技能枚举并同步 agent 元数据契约、既有素材词表和验证规则。建议优先规范化本次新增条目，并为元数据增加可自动核验的枚举检查，避免人工漏项。 |
| B-003 | [261012-galgame-bgm.summary.md:39-45](docs/features/261012-galgame-bgm/261012-galgame-bgm.summary.md:39)；[/root/projects/stage-ai/library/sfx](../../library/sfx)；[plays/mio-observatory/assets](plays/mio-observatory/assets) | 摘要称素材库“预置了 4 类 Ambience 素材”，事实层应区分“库中存在”与“剧目已导入/可演出”。库中确有 `sfx_wind_night`、`sfx_rain_gentle_loop`、`sfx_night_crickets_loop`、`sfx_clock_ticking_loop`，但剧目 assets 中只有 `sfx_wind_night.mp3`；其余三条没有进入剧目，session 也没有引用。若验收标准是本剧目具备完整 Ambience 实做，则当前交付缺失。 | 明确验收边界并补齐：若要求“能力建设”，在 summary 中写清“库级素材已准备，剧目仅接入风声”；若要求“全套实做”，将其余素材按实际场景导入剧目并在至少一个可达分支中引用。对每个 id 核对 `meta.json`、音频文件、剧目 assets 清单和谱系引用四层状态。 |
| B-004 | [plays/mio-observatory/assets/manifest.json:69,94,119,144,169](plays/mio-observatory/assets/manifest.json:69)；[apps/server/AGENTS.md:100-101](apps/server/AGENTS.md:100) | 新 BGM 的 `source` 记录为 `flow-music-lyria-3.5`，而当前项目运行约束明确指出该模型系列已被 Flow 上游下线，默认应使用 `gemini-3.0-pro-image`（图像配置）且音乐后端的真实模型/来源必须与实际生成链一致。这里至少存在不可复核的来源记录，可能误导后续维护者重复使用已失效模型或误判素材可再生成性。 | 不要凭摘要或旧配置填写来源。按实际生成回执/后端配置校正 `source`，记录可复现的后端名称与日期；若历史产物确实由旧模型生成，标成历史来源并在文档中说明不可重现，而不是把它当当前推荐链路。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| R-001 | [apps/server/src/assetRef.ts:160-166](apps/server/src/assetRef.ts:160)；[packages/stage/src/assets.ts:112-118](packages/stage/src/assets.ts:112) | `ambient` 先查 `sfx` 再查 `bgm`，契约正确，但交付没有明确说明同名 id 冲突时的优先级及用户可观察结果；Ambience 与 BGM 共用 id 时可能导入/播放到错误类别。 | 在技能或资源库文档中明确 ambient 的命名空间与冲突策略，推荐环境音统一使用 `sfx_` 前缀并在导入/选曲界面展示最终命中类别。 |
| R-002 | [apps/server/src/playMusic.ts:121-130](apps/server/src/playMusic.ts:121)；[apps/server/src/agentkit/annotateTool.ts:51-65](apps/server/src/agentkit/annotateTool.ts:51) | 生成和标注分两步是合理的，但后台生成完成后只写来源；如果任务到货后模型没有再次调用 `annotate_asset`，素材会长期缺少标题、mood、scene、loop、volume。交付摘要没有给出到货后的标注证据。 | 在排产回执/工坊工作流中增加可追踪的“待标注”状态或明确人工确认点；至少在交付核验中检查每个新 BGM 的必填选曲元数据，而不只检查文件存在。 |
| R-003 | [apps/server/skills/galgame-bgm/SKILL.md:9-11](apps/server/skills/galgame-bgm/SKILL.md:9)；[261012-galgame-bgm.plan.md:20-36](docs/features/261012-galgame-bgm/261012-galgame-bgm.plan.md:20) | 规划中的 `generate_bgm` 示例包含完整元数据参数，但实现已经将元数据拆到 `annotate_asset`。技能正文已部分更新为两步流程，规划文档仍保留旧契约，容易导致后续按 plan 调用不存在的参数。 | 修订 plan/summary 的接口示例，明确 `generate_bgm(name,prompt,overwrite)` 与 `annotate_asset` 的职责边界，并把后台到货、标注、脚本引用的状态机写成验收清单。 |
| R-004 | [apps/server/src/workshop.ts:322-334](apps/server/src/workshop.ts:322) | 工坊提示词要求首次 neutral 定妆照 3 张候选，并在本段提到 `read_skill("galgame-visual-craft")`；本次变更范围的技能文件是 `galgame-bgm`，且未在本次交付材料中证明该技能名/预载链可用。虽然不直接破坏 BGM，但会让相关工坊轮次出现不可用的技能指针。 | 核对该技能是否真实存在并纳入技能清单；若本次只审 BGM，避免把无关技能名硬编码到交付摘要或相关工作流说明中。 |
| R-005 | [261012-galgame-bgm.research.md:20-25](docs/features/261012-galgame-bgm/261012-galgame-bgm.research.md:20)；[apps/server/skills/galgame-bgm/SKILL.md:15-21](apps/server/skills/galgame-bgm/SKILL.md:15) | 调研明确指出无缝循环通常还需要采样级剪辑和 loop metadata，而技能主要依赖提示词，并将约 176 秒文件直接标记 `loop:true`。这会把“适合循环”误读为“已验证无缝循环”，尤其是八音盒/钢片琴长衰减素材可能在边界处被硬切。 | 将 `loop:true` 定义为创作意图/推荐用法，而不是音频质量证明；交付验收增加首尾波形、相位/响度突变和多次循环的人工或工具检查，并把验证结果记录在素材元数据或 validation 文档中。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-001 | [plays/mio-observatory/assets/manifest.json:51,80,105,130,155,180](plays/mio-observatory/assets/manifest.json:51) | `durationSec: 176` 与技能“上游约 176 秒”一致，但技能元数据字段表没有把 durationSec 列为可填字段；当前它更像事实记录而非标准选曲字段。 | 若客户端/工具不消费该字段，移入生成台账或验证文档；若要用于清单，补入 core 的 AssetMeta 契约和技能字段表。 |
| N-002 | [apps/server/skills/galgame-bgm/SKILL.md:23-29](apps/server/skills/galgame-bgm/SKILL.md:23)；[261012-galgame-bgm.plan.md:46-47](docs/features/261012-galgame-bgm/261012-galgame-bgm.plan.md:46) | plan 称六段结构把“循环与声学留白”作为独立段，技能正文把频段留白放入速度/动态/循环段的示例中，结构命名不完全一致。 | 统一 plan、skill、summary 的蓝图名称，避免模型按不同版本理解提示词顺序。 |
| N-003 | [packages/stage/src/loopAudio.ts:42-55](packages/stage/src/loopAudio.ts:42) | `LoopChannel` 使用裸 `Audio` 并吞掉 `play()` 拒绝；这符合“不阻塞演出”，但浏览器自动播放策略或网络失败时用户只会看到静音，没有可观察诊断。 | 保持不阻塞原则，同时可通过非阻塞状态/日志或素材页播放错误提示区分自动播放限制、404 与 codec 失败。 |
| N-004 | [apps/server/src/assetRef.ts:103-109](apps/server/src/assetRef.ts:103) | 自动导入失败后将目标记入 `done`，同一运行期不重试；这是避免重复副作用的合理选择，但网络/文件瞬态错误会一直保持缺失。 | 在不改变当前默认语义的前提下，考虑把“永久不存在”和“导入失败”分开记录，让用户可显式重试；至少在可观察日志中保留失败原因。 |
| N-005 | [261012-galgame-bgm.summary.md:27-35](docs/features/261012-galgame-bgm/261012-galgame-bgm.summary.md:27) | summary 只给出文件大小和风格描述，没有逐曲 prompt、生成回执、实际音频格式/采样率或循环验收证据，难以复盘“原创”与最佳实践是否真正执行。 | 对每首曲子保留生成台账引用、最终 prompt 摘要、后端回执和人工验收结论；避免把“存在文件”当作“规范已执行”。 |

## 准入结论

**结论**：`不准入`

**说明**：底层 BGM/Ambience 契约基本具备，但本次交付的核心用户可见结果没有闭环：实际 session 未使用新曲或环境音，且元数据词表违反技能约定。修复 B-001 至少要把摘要所述改写真正落入可达谱系，修复 B-002/B-003 后再重新核验素材清单、音频引用和交付文档的一致性。
