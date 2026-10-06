---
name: galgame-visual-craft
description: 剧目要出图（立绘 / 背景 / CG）时读这个。含画风锚点怎么定、写在哪一格、提示词怎么写才有商业 Galgame 的观感（有色细线、通透上色、破对称姿态、体型锁定、负面词黑名单）、立绘的纯色键底与 neutral 定妆照垫图、差分命名、抠底失败怎么调参，以及背景与 CG 的构图约定。
user-invocable: true
---

# 出图：画风、立绘、场景

## 一、画风没有默认值，先定再画

**不要替用户预设画风。** 用户没说就问，一轮里和故事基调、时代地点一起问掉，并给出你的具体提案。
理由：画风决定整部剧目的观感，事后改等于全部素材重出（每次 15–140 秒，还要钱）。

用户说「随便」「你定」时，选一个**和故事基调自洽**的锚点，明确告诉他你选了哪个、为什么。

定下来之后写进 **`memory/always/craft.md`**（画风 + 文风）——`craft.md` 是画风的真相源，
每轮原样注入，比对话里说过的话可靠。**不要另起一个文件放画风**：`always/` 下只有
`craft.md` / `nsfw.md` / `premise.md` 三个会被读到，别的文件名写了也没人看。

| 锚点 | 提示词写法 | 适合 |
| --- | --- | --- |
| 赛璐珞动画 | `cel-shaded anime, clean line art, flat color blocks, crisp outlines` | 校园、日常、轻松喜剧。galgame 最常见的一档 |
| 厚涂写实 | `painterly semi-realistic illustration, soft brush strokes, detailed lighting` | 奇幻、末世、严肃叙事 |
| 摄影写实 | `photorealistic, cinematic lighting, shallow depth of field, 35mm film` | 现代、悬疑、都市。**注意**：这类风格几乎出不来二次元角色，角色卡和立绘的风格描述要跟着改 |
| 水彩手绘 | `watercolor illustration, soft washes, paper texture, delicate linework` | 治愈、回忆、散文 |
| 复古胶片 | `retro film aesthetic, muted palette, grain, 1980s photography` | 昭和、复古、悬疑怀旧 |

`generate_image` 有个可选的 `style` 参数，就是上面这些短语，**英文短句，不要整段**。
完整的画面描述放 `prompt`，风格词放 `style`，两者不要互相重复。

## 二、提示词工艺：四条铁律

这四条是从多轮商业 Galgame 复刻实测里出来的，违反哪条就掉哪一档观感。

### 1. 线条要有色且极细，不要「描边」

- ❌ `bold lineart`、`ink outlines`、`black lines` → 出粗硬的美漫/赛璐珞黑边；
- ✅ `ultra-fine whisper-light colored outlines`（肌肤浅棕、发丝淡紫）、`feather-weight line weight`、`zero harsh black outlines`。

机理：指定有色细线，模型会把边缘与周围色块柔和融合，而不是画一圈黑边。

### 2. 皮相要通透，靠次表面散射与微渐变，不靠高光

- ❌ `glossy skin`、`shiny`、`airbrushed gradients`、`plastic 3D` → 像塑料人偶或涂满机油；
- ✅ `clean translucent galgame coloring`、`translucent porcelain skin`、`soft subsurface scattering with cherry undertones`、`intricate micro-gradients on fabrics and skin`。

### 3. 姿态要破对称，不要正面直立

没有角度约束时，模型必然给一个呆板的人偶站姿。

- ❌ `front view`、`standing straight`、`hands behind back`；
- ✅ `relaxed contrapposto stance, body angled slightly three-quarters`、`head tilted a few degrees to the side, chin lowered gently`、`weight on one leg, knees soft`、`asymmetric arm placement`。

注意立绘有个例外：**手臂要离开身体**（见 §三），破对称和「剪影分得开」要一起满足。

### 4. 负面词黑名单（反直觉，但实测如此）

❌ 禁用 `Masterpiece`、`ultra-detailed`、`8k`、`hyper-realistic`。

机理：这些传统泛用质量大词会诱发**写实渲染倾向**——骨骼拉长、肌肉成熟化、失去二次元平涂与半透光的美感。

### 体型必须量化锁死

模型在未声明时默认脑补成 7~8 头身的成人女性体态。要维持年龄段气质就得给数字：

- 萌系 / 幼态：`strictly 5 to 5.5 heads tall child-like anime proportions`、`completely flat chest`、`narrow delicate shoulders`；
- 标准高中生：`6 to 6.5 heads tall slender anime proportions`、`delicate frame`。

神态同理，放空/天然呆写 `clueless innocent expression`、`large round unblinking doe eyes`、`soft baby cheeks`；
慵懒/娇弱写 `drooping half-closed sleepy eyes with soft reflections`。

### 两个可以直接抄的社团配方

**まどそふと（宇都宮つみれ）**——现代明亮、空气感、微侧身：

```text
2010s-2020s commercial galgame official art, Madosoft bishoujo style.
Clean translucent galgame coloring, delicate airbrushed skin shading with subtle soft sheen,
fresh transparent color palette, fine sharp hairline lineart, bright luminous pastel tones.
Natural relaxed pose in slight three-quarter view, head tilted slightly, weight on one leg,
silky pastel hair with translucent feathered tips and subtle chromatic rim light.
No thick black outlines, no oily shine, no 3D shading.
```

**しらたまこ（しらたま）**——软糯棉花糖质感、极细有色线、水彩透明度：

```text
Pristine high-end Japanese visual novel official art, Shiratamaco soft watercolor aesthetic.
Soft-edge digital painting with barely visible micro-fine colored contours,
feather-light line weight, ultra-thin soft reddish-brown and pale lilac outlines, zero black ink lines.
Translucent milky porcelain skin with delicate rose undertones, intricate micro-gradients on layered sheer ruffles,
large drooping half-closed sleepy eyes with luminous violet-magenta gradient irises and crystalline reflections,
airy transparent digital watercolor shading, ethereal gentle lighting, sweet fragile innocent presence.
```

> 这两个名字是**照着出图归纳的归属**，不是原始素材里写的事实；当配方用，不用当引用。

### 模型选型

商用级产出**显式指定 `gemini-3.0-pro-image`**（GEM_PIX_2 内核）：线条细腻、通透度高、体型与五官不易跑偏。
flash 档容易丢二次元细线、把幼态角色画成人。模型在**剧目设置**与**服务端设置**里配，不在这里传参。

## 三、立绘与表情差分

### 一次一张，但可以并行

一次 `generate_image` 只出一张图。**同一个批次里调多次就是并行的**（闸门放 6 个），
所以要出 6 个差分，就在同一批里调 6 次，不要一个一个串行等——串行要等 6×100 秒。
超过 6 个分两批。

### 同一个人怎么保证：neutral 定妆照垫图

角色外观**只从角色卡来**——`characters/<id>.md` 的正文里写清发色、瞳色、体型、服装，
出图时把这些外观特征放进 `prompt`，换差分时一句都不改。
（卡头部的 frontmatter 只认 `id` / `name` / `sprite` / `voice` / `voiceId` 五个键，
**认不出的键会被静默丢掉**，所以外观写在正文，不要塞进 frontmatter。）

系统会自动挂两重保险：非 neutral 的立绘**自动拿该角色的 `neutral` 当垫图**传进去，
提示词再追加 `identical hairstyle, hair color, eye color, outfit and body type`。

### 出图与入库是两步

`generate_image` 只产**草稿**（回执给 `draftId` 与预览，不写 `assets/`、不碰素材表），
`commit_asset(draftId)` 才把它变成正式素材。候选因此可以放心出——没被采用的那些只待在草稿区，
一周后自动清，素材页里看不到。

**首次定妆先出 3 张候选供用户挑**：按同一个 `variant="neutral"` 调 3 次 `generate_image`（prompt 各不相同），
三张预览一起贴给用户，他挑中哪张就 `commit_asset` 哪一张。

节奏是**两轮对话**：

1. 第一轮：同批出 3 张风格/姿态微调的候选定妆照，贴给用户（markdown 图片对比），请他挑一张。
2. 用户选定后：`commit_asset` 采用那张作为正式 `neutral`，再以它为唯一身份基准，在同一批里并行出其余差分。

**没有入库的 `neutral` 就不能出差分**（草稿当不了身份基准）：系统会直接报错让你先定妆——
不这么做的话，新出的图和旧差分不是同一个人，演出中会静默换脸。

### 把图贴给用户

回执里带草稿预览 URL，**直接写成 markdown 图片贴进回复**：

```
![<角色id> 定妆照候选](/plays/<剧目id>/drafts/<draftId>/image.png)
```

用户要亲眼看到才谈得上验收。只回一句「已生成」等于让人凭空点头——「这张可以吗」必须配着图。

### 纯色键底是硬要求

立绘落盘前会**自动抠底成透明 PNG**（引擎靠 alpha 把角色叠在背景上，不抠底就是一块矩形挂在画面中央）。
抠底是**全局纯色键 + 闭式覆盖率反解 + 限色（despill）**：先取整圈边框的逐通道中位数当底色 B，
按色键判背景，在边界带上逐像素反解真实覆盖率 `a = (B−I)/(B−F)`，并由限色通道压制渗进发丝的溢色。

所以：

- 要求模型出**纯绿幕色键底**（`#00FF00`；对深色线条、暖色皮肤和深发色的色距最大，配合限色后边缘最利落。
  **仅当角色本身是绿色系**发色/服装时换纯品红 `#FF00FF`）；
- **不能有渐变、不能有投影、不能有地面、不能有描边光晕**；
- 这段串必须带上：`single flat pure green solid background (#00FF00) for chroma key, no text, no shadow, no gradient`；
- **要 2D 平涂**（赛璐珞 / Galgame 动漫原画，干净线条 + 通透微渐变，明确排除 3D 渲染与厚重塑料感）；
- 手臂**离开身体**、双马尾**中间留空**：剪影连成一片就没法分割人物与底色。

抠底失败会直接报错、这张图不落盘。把报错原因如实转告用户，别当成「出图失败」含糊过去——
通常就是底色不干净，让用户决定重出还是换要求。

抠完会等比缩放落到 1080x1920 满高，所以**同一角色的所有差分在舞台上的身高必然一样**，
落盘时统一拉齐，不用手动平衡。

### 看图能看出什么

`view_image` 把图读进来给你自己看（真的看图，不是读路径）；剧目内的路径和图片网址都吃。
**要不要看、什么时候看，你自己判断**——不用每出一张都看，那只是白烧一轮。

真要看，看三件事：

1. **有没有白边晕**——深色底上最刺眼的一圈亮边，有就是反解没生效；
2. **抠得干不干净**——发梢/手指啃缺、内部有没剪断的空洞、底色残留；
3. **是不是想要的那个人**——和该角色的 `neutral` 比对脸、发色、瞳色、服装。

看过就把判断写进汇报（「抠得干净」还是「边缘有脏边，我重抠了一版」）；**没看过就不要写成看过**。
用户是验收方，他只看得见图好不好，不知道你调没调参。

**轮廓的锯齿不用你管。** 模型在 768px 上画的线稿自带的 1px 阶梯，等比放大到 1080 才显出来，
不是抠底的锅（实测抠底后的轮廓几何与源图逐位相同）。想改善只有换更高的出图分辨率，
也别去平滑输出——那会啃掉 1px 发丝。但**缺口（被挖成全透明的一片）**是你的问题：
那是源图 JPEG 环纹把掩膜咬掉了，默认已开一档掩膜降噪（`keySmooth` = 0.8）治它，还是成片缺就往上加。

### 抠底调参：默认别动，看图不对才动

`recut_sprite` 的 `cutout` 参数。出图那一刻没人看过图，所以这些参数**不在 `generate_image` 上**——
填它得先看过成图，而看图发生在出图之后。`tolerance` / `spill` 是 0–255 的通道色差，
`keySmooth` 是高斯半径，`edgeBand` 是像素宽度：

| 参数 | 默认 | 调大 | 调小 |
|---|---|---|---|
| `tolerance` | 48 | 离底色更远的像素也算背景 → 抠得更狠，**人物内部与腿间的一块底色也被吃掉** | 更保守；底色带噪点时残留更多 |
| `spill` | 20 | 把底色的峰值通道压得更低，溢色（绿边/品红晕）消得更彻底；**代价是发丝上那点底色被一起压掉** | 溢色留得更多 |
| `keySmooth` | 0.8 | 色键在一张更模糊的副本上跑，JPEG 环纹咬出的轮廓缺口更少；**代价是边缘略毛、零散半透明点变多** | 0 = 不降噪。轮廓上的缺口原样留着 |
| `edgeBand` | 4 | 抗锯齿过渡带更宽，深色底上的白块更少；**但浅色区被过度反解，洞反而变多** | 带子不够宽，落在带外的渐变像素被钉成实心，深色底上是一圈白块 |
| `solidResidual` | 48 | 胶着带里离「底色↔邻近前景色」这条线更远的像素被当成实心 → **轮廓上的细描边（1–2px 的黑线）留得住**；代价是抗锯齿斜坡也可能被压实、边缘发硬 | 更信混合模型；调到 0 = 关掉这条，比反解带还窄的深色描边会被当成「覆盖率 0.1 的底色」而整条消失 |

**默认 `48/20/0.8/4/48` 是对着真实立绘量出来的**，标签语义别记反：
`keySmooth` 只糊「喂给色键的那份副本」，alpha 仍从原图像素解，所以它修的是轮廓**形状**、不动颜色；
`spill` 动的是颜色不是 alpha——**它一根发丝都不会少**。

**重抠不是重新出图**：它拿抠底前留的那张原片本地重跑一遍抠底，覆盖 `assets/sprites/` 里那张 PNG——
画面一个像素不变、几秒出结果、不烧出图配额。`generate_image` 出来的是**另一张画**，
用户刚点头的那张会被顶掉，所以「图挺好、抠得脏」只有 `recut_sprite` 能救。

**判断口诀**（每条只动一档，看完回执里那张图再决定要不要继续）：

- 头顶/两鬓**成片被挖走的缺口**（源图 JPEG 环纹咬掉的）→ `keySmooth` 加到 1.0~1.2。
  实测默认档相对不降噪：头部缺口 −31%，零散半透明点约翻倍。
- 人物内部、腿间或腋下**该透出的地方还糊着一块底色** → `tolerance` 加 4~8。
- 角色身上**被啃掉一块**（那块颜色本就与底色接近）→ `tolerance` 减 4~8。
- 深色底上**一圈白块/白边晕**、块状不是均匀一圈 → `edgeBand` 加 1~2。
- 边缘**一圈绿（或品红）毛边** → `spill` 加 10~20；再加还不行就是底色不纯，回提示词。
- **描边被压成硬边、边缘发毛**（手绘感强的图容易这样）→ `solidResidual` 减到 24~32；还不自然就设 0（退回纯混合模型，细描边会丢）。
- 深色底上**一圈均匀的白边晕** → 不是参数问题，是底色不纯（渐变/投影）导致 B 取歪了，回提示词。
- 整张图抠不动 → 基本是底色不纯，**调参救不了非纯色底**。

参数只影响这一张图，不改全局默认值。调完仍然不干净就老实告诉用户「这张底色/画质有问题，建议重出」。
留底原片在**入库时**落进 `media-cache/sprite-sources/`：更早出的图、用户自己上传的立绘没有留底，
`recut_sprite` 会直接报错——那种只能重新出图，如实转告，别偷偷重画。

### 差分命名

小写字母开头，`a-z` / 数字 / 下划线，最长 40 字符，会直接当文件名。

固定用 `neutral`（定妆照，其余差分都从它派生）。其余按剧本用得上的来，先给这批：
`smile` `shy` `angry` `sad` `surprised` `thinking`。

**别按编号起名**（`emotion1`、`pose2`）——半年后没人知道那是哪个表情。

入库时引擎会自动把取景（`framing`）、体量（`stature`）与名牌写进 `assets/manifest.json`，不用手动改。

## 四、背景与事件 CG

### 画幅是硬约束

背景与 CG 固定 **16:9 横幅**，立绘固定 **9:16 竖构图**。系统会核对模型回执的画幅，
不对就直接报错、这张图作废。所以**不要**为了「竖一点更有戏剧感」去改画幅——
竖构图给立绘，横构图给场景，位置不同不代表构图自由度大。

### 背景：给角色留位置

背景是**角色站在上面**的舞台，不是独立插画。

- **人物站位侧不要放主体**。舞台把立绘压在中下部，背景的中心区域会被挡住。
  主要视觉元素（窗、门、招牌、黑板）放在左右两侧或画面上半部。
- **地平线要低**（画面下三分之一附近）。地平线太高，立绘就站在半空里。
- **给光留方向**。背景的光源方向要和角色卡的描述一致；逆光立绘压深色背景会糊成一团。
- **不要画人物**。背景里有个人，玩家会以为是另一个角色。

### CG：事件的那一瞬间

CG 是剧情高光的定格，不是风景。

- 抓**动作进行中**的瞬间（挥刀、张口、回头），不要抓动作结束后的静止；
- 构图上人物偏离中心，留出放置台词的余地；
- 同一事件的多个 CG 要能连着看：机位、配色、光线保持同一套。

### 出图前先把场景清单摆给用户

按搭台流程，出图前要拿到批准。清单按这个格式写，一行一个，别只报数量：

```
背景 classroom_dusk —— 黄昏教室，靠窗空座，逆光，暖橙色调，立绘站位在画面中下方
CG   confrontation   —— 天台上两人对峙，风吹起头发，低角度仰拍
```

用户点头之后再 `generate_image`。
