---
name: style-anchors
description: 用户要定画风、或要给 generate_image 传 style 时读这个。含常用画风锚点（赛璐珞动画 / 厚涂写实 / 摄影写实 / 水彩手绘）与「先问用户再定画风」的流程。
---

# 画风锚点

## 没有默认画风

**不要替用户预设画风。** 用户没说画风就问，一轮里和故事基调、时代地点一起问掉，并给出你的具体提案。
理由：画风决定了整部剧目的观感，事后改等于全部素材重出（每次 15–140 秒，还要钱）。问一次的成本远低于返工。

用户说「随便」「你定」时，选一个**和故事基调自洽**的锚点，明确告诉用户你选了哪个、为什么。

定下来之后写进 `memory/always/craft.md`（画风 + 文风），之后每次出图都以它为准——
`craft.md` 是画风的真相源，比对话里说过的话可靠。

## 常用锚点

用户说画风时，往这些锚点上靠；用户描述的画面气质对上哪个就用哪个。

| 锚点 | 提示词写法 | 适合 |
| --- | --- | --- |
| 赛璐珞动画 | `cel-shaded anime, clean line art, flat color blocks, crisp outlines` | 校园、日常、轻松喜剧。galgame 最常见的一档 |
| 厚涂写实 | `painterly semi-realistic illustration, soft brush strokes, detailed lighting` | 奇幻、末世、严肃叙事 |
| 摄影写实 | `photorealistic, cinematic lighting, shallow depth of field, 35mm film` | 现代、悬疑、都市。**注意**：这类风格几乎出不来二次元角色，角色卡和立绘的风格描述要跟着改 |
| 水彩手绘 | `watercolor illustration, soft washes, paper texture, delicate linework` | 治愈、回忆、散文 |
| 复古胶片 | `retro film aesthetic, muted palette, grain, 1980s photography` | 昭和、复古、悬疑怀旧 |

## 怎么把画风传给 generate_image

`generate_image` 有个可选的 `style` 参数，就是上面这些短语，**英文短句，不要整段**。
完整的画面描述放 `prompt`，风格词放 `style`，两者不要互相重复。

## 画风与角色描述的一致性

同一角色必须全剧目一个画风。角色卡（`play.json` 的 `persona`）里描述发色、瞳色、体型时，
把这些外观特征写清楚——它们是出图时保证「同一个人」的唯一依据，比风格词重要得多。
