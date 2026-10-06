---
name: galgame-visual-craft
description: 视觉小说 / Galgame 角色立绘与事件 CG 的商业级提示词最佳实践指南。覆盖 Google Flow / flow2api 选模实测、有色细线消除粗黑边、通透水彩上色、动态姿态解构、体型与骨架硬锁、经典社团画风配方 Cookbook（Madosoft / Shiratamaco 实测验证），以及 Stage-AI 三层视觉管线落地标准。
user-invocable: true
---

# galgame-visual-craft（商业 Galgame 立绘与 CG 提示词最佳实践）

> 本技能总结自基于 flow2api / Google Flow 生成商业级 Galgame 立绘与 CG 的多轮迭代实测，解决了 AI 出图“油腻塑料感”、“线条死黑粗硬”、“姿势僵硬对称”、“体型擅自成人化”等核心顽疾。

## 何时使用

- 工坊 Craft Agent 或剧作家需要为剧目生成角色立绘（Sprite / Tachie）或事件 CG 时；
- 需要模仿特定 Galgame 社团/名作（如 Madosoft 宇都宮つみれ、Shiratamaco しらたま等）的标志性画风时；
- 编写剧目 `memory/always/art_style.md` 画风记忆或角色卡外观定义时；
- 解决出图发油、描边过粗、动作像木偶或脸型崩坏问题时。

---

## 一、引擎基底与模型选型铁律

| 模型别名 | 底模内核 | 动漫原画理解力 | 推荐场景 |
|---|---|---|---|
| **`gemini-3.0-pro-image`** | **GEM_PIX_2 (Nano Banana Pro)** | **极高（SOTA）** | **唯一指定主力**：线条细腻、通透度高、体型与五官不易跑偏 |
| `gemini-3.1-flash-image` | NARWHAL (Nano Banana 2) | 中等 | 快速草稿；容易丢失二次元细线，易擅自将幼态角色成人化/写实化 |
| `gemini-3.1-flash-lite-image`| HARBOR_SEAL | 较低 | 仅用于低成本纯文本草图测试 |

**铁律**：商业级 Galgame 产出**必须显式指定 `gemini-3.0-pro-image`**。

---

## 二、立绘与 CG 通用四大铁律

### 1. 线条控制：有色极细发丝线（彻底清除纯黑粗描边）
- ❌ **错误**：`bold lineart`, `ink outlines`, `black lines`（会导致粗硬美漫/赛璐珞描边）
- ✅ **正解**：
  - `ultra-fine whisper-light colored outlines (soft reddish-brown on skin/clothes, pale lilac on hair)`
  - `exquisite hairline contouring`
  - `feather-weight line weight, zero harsh black outlines`
- **机理**：指定“浅棕色/浅紫粉色”的有色细线，迫使模型将边缘与周围色块柔和融合。

### 2. 皮相与光影：空气通透感与微渐变（彻底去油）
- ❌ **错误**：`glossy skin`, `shiny`, `airbrushed gradients`, `plastic 3D`（导致像塑料人偶或涂满机油）
- ✅ **正解**：
  - `clean translucent galgame coloring`, `translucent porcelain skin`
  - `soft subsurface scattering with cherry undertones`
  - `intricate micro-gradients on fabrics and skin`
  - `multi-layered sheer ruffles, soft diffuse ambient occlusion`
- **机理**：用“次表面散射”和“微渐变”替代“高光/airbrush”，既保留了肌肤红润的通透透光感，又杜绝了刺目的反光点。

### 3. 动态与仪态：打破对称与正面直立（彻底破除僵硬）
- ❌ **错误**：`front view`, `standing straight`, `hands behind back`（没有角度约束时，必然生成呆板人偶站姿）
- ✅ **正解**：
  - `relaxed contrapposto stance, body angled slightly three-quarters`
  - `head tilted a few degrees to the side, chin lowered gently`
  - `weight on one leg, knees soft and turned slightly inward`
  - `asymmetric arm placement (one hand shyly touching collar/bow, other arm hanging naturally)`

### 4. 负面干扰词黑名单（反向直觉）
- ❌ **禁用词**：`Masterpiece`, `ultra-detailed`, `8k`, `hyper-realistic`
- **机理**：在现代多模态大模型中，这些传统泛用质量大词会诱发**写实渲染倾向**，导致人体骨骼拉长、肌肉成熟化、失去纯净二次元平涂与半透光的美感。

---

## 三、角色外貌与体型锚定原则

模型在未严格声明时，默认会脑补成 7~8 头身的欧美/成人女性体态。要维持特定年龄段气质，必须**量化锁定**：

1. **头身比硬锁**：
   - 萌系/幼态少女：`strictly 5 to 5.5 heads tall child-like anime proportions`, `completely flat chest`, `narrow delicate shoulders`, `small compact torso`
   - 标准高中生少女：`6 to 6.5 heads tall slender anime proportions`, `delicate frame`
2. **五官与神态**：
   - 懵懂/放空/天然呆：`clueless innocent expression`, `large round unblinking doe eyes`, `facial features clustered low on face`, `soft baby cheeks`, `tiny parted lips`
   - 迷茫/慵懒/娇弱：`drooping half-closed sleepy eyes with soft reflections`, `dazed gentle breath`

---

## 四、名作与社团画风 Cookbook & References

### Case 1: まどそふと（Madosoft）《Hamidashi Creative》风格
> **原画**：宇都宮つみれ
> **视觉特征**：现代明亮、清爽通透、空气感强、微偏侧身灵动姿态、发梢微透光渐变、极干净的萌系色彩。

```text
2010s-2020s commercial galgame official art, Madosoft bishoujo style.
Clean translucent galgame coloring, delicate airbrushed skin shading with subtle soft sheen,
fresh transparent color palette, fine sharp hairline lineart, bright luminous pastel tones.
Natural relaxed pose in slight three-quarter view, head tilted slightly, weight on one leg,
silky pastel hair with translucent feathered tips and subtle chromatic rim light.
No thick black outlines, no oily shine, no 3D shading.
```

### Case 2: しらたまこ（Shiratamaco）《星空鉄道とシロの旅》风格
> **原画**：しらたま（白玉）
> **视觉特征**：软糯棉花糖质感、极细有色发丝线（完全无黑线）、半阖下垂迷离粉紫眼眸、淡粉紫水彩般透明度、多层荷叶边薄纱质感、诗意冷暖光影。

```text
Pristine high-end Japanese visual novel official art, Shiratamaco soft watercolor aesthetic.
Soft-edge digital painting with barely visible micro-fine colored contours,
feather-light line weight, ultra-thin soft reddish-brown and pale lilac outlines, zero black ink lines.
Translucent milky porcelain skin with delicate rose undertones, intricate micro-gradients on layered sheer ruffles,
large drooping half-closed sleepy eyes with luminous violet-magenta gradient irises and crystalline reflections,
airy transparent digital watercolor shading, ethereal gentle lighting, sweet fragile innocent presence.
```

---

## 五、Stage-AI 三层落地流水线规范

为了确保剧目中每一个角色、每一张 CG、每一拍演出风格高度统一，执行以下三层组装：

### 1. 剧目画风基调：`plays/<id>/memory/always/art_style.md`
在剧目的 always 记忆中持久固化本剧的美术总纲，生图工具每次出图必读：
```markdown
# 剧目视觉基调 (Visual Anchor)
- Style: high-end Japanese visual novel official art, Shiratamaco soft watercolor aesthetic
- Lineart: ultra-fine whisper-light colored outlines, zero harsh black outlines
- Coloring: clean translucent coloring, airy pastel palette, soft diffuse ambient occlusion
- Lighting & Mood: quiet snowy winter atmosphere, dim cool ambient light, soft bokeh
```

### 2. 角色外观固化：`plays/<id>/memory/always/characters/<char_id>.md`
在角色卡元数据中扩展固定的外貌咒语（锁定特征件与体型）：
```yaml
---
id: shiro
name: 白
appearance:
  proportions: strictly 5 heads tall child-like anime anatomy, flat chest, narrow frame
  hair: silky pale silver-white hair with faint lilac tint, twin tails with large white ribbon bow, black "X" hairpin on bangs
  eyes: drooping half-closed sleepy magenta-pink eyes with soft dreamy reflections
  default_outfit: dark chocolate brown hooded capelet with white ruffle trim and black pompoms, red chest bow, layered frilly dress, dark tights, brown lace-up boots
---
```

### 3. 生图时的组装公式
最终发送给 `gemini-3.0-pro-image` 的提示词按以下次序拼装：
$$\text{Prompt} = \text{[art\_style 风格锚点]} + \text{[角色 appearance 固有特征]} + \text{[当前分镜动作/表情/差分]} + \text{[环境与光影]} + \text{[通用去油去粗线后缀]}$$
