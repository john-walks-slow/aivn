# AI 立绘抠图：边缘 alpha 精修方案调研

> ⚠️ **本文的推荐方案已按建议实现并实测，结论是「不管用，已回退」。先读这一段再读下面。**
>
> **实测结果**（3 张真图，指标与口径见文末「实测复核」）：
>
> | 指标 | 旧公式 | color-unmixing 闭式解 |
> |---|---|---|
> | 轮廓 alpha 抖动（用户说的「刺」，越低越平） | 35.1 / 38.6 / 31.9 | **45.4 / 42.7 / 37.8（更差）** |
> | 轮廓几何粗糙度（源图 / 旧 / 新） | 0.487/0.487、0.482/0.478、0.459/0.489 | 0.487、**0.474**、**0.457** |
>
> 闭式解在几何上**更忠实**（61 那张 0.457 对上源图 0.459，旧的偏到 0.489），
> 但忠实地还原了模型自己画的锯齿，**看起来反而更刺**。它去掉的是另一种瑕疵——
> 旧公式 `max(色差项, dist/2)` 给边界带垫了 128 的地板，深色背景上有一圈白边晕——
> 那是用户没提过的症状。拿「去晕」换「更刺」，对本需求是净负，已回退到 `c5d6509`。
>
> **真正的原因**：立绘边上的锯齿是模型在 768px 画幅上画的线稿本身带的，
> 再被抠底管线 1.406 倍放大到 1080（768x1376 → 1080x1920）。
> 证据是几何粗糙度里**旧抠底与源图完全相等**（0.487 = 0.487）——抠底从未在几何上丢过东西。
> 要真正解决只有提高出图分辨率（更小的放大倍率、更细的原始线稿），
> 或者主动平滑轮廓（会啃掉 1px 发丝，未采用）。
>
> 下面保留完整调研：文献仍然成立（背景已知纯色 ⇒ alpha 有逐像素闭式解），
> **只是「量出来解决的是另一个问题」**。第十章的代码不要照抄。

---

> 调研日期：2026-09-30　目标机：ARM64 Linux / 8GB / 无 GPU / Node.js 22 / 已有 `sharp`(libvips)
> 场景：2D 平涂赛璐璐动漫立绘，**纯白底**，角色有**黑色描边**，轮廓处有 1–3px 抗锯齿灰阶过渡带
> 目标：输出透明 PNG，边缘干净

---

## 〇、TL;DR（先看结论）

1. **根因判断正确**：二值掩膜把过渡带像素全留或全丢，等于把「覆盖率」这个连续量量化成了 0/1。1px 锯齿是量化误差的直接表现，**不是距离场斜坡宽度的问题**。
2. **背景已知纯色 ⇒ alpha matting 有一个逐像素闭式解**，文献里叫 **color unmixing / chroma(luma)-keying**。它比闭式解（closed-form matting）便宜几个数量级，且**能直接吃掉锯齿**：它从原始抗锯齿像素里反解真实覆盖率，而二值掩膜 + 距离场是「照着量化后的锯齿描一遍」，只会忠实复现锯齿。
3. **推荐主路线（最小改动，见第十章）**：形态学开运算去毛刺 → 逐像素 color-unmixing 反解 α → 一次性 un-mix 修前景色 → 沿轮廓做一次小半径平滑 → 现有 resize 流程。**不需要 GPU、不需要 Python、不需要任何新依赖，约 60–90 行 TS。**
4. **不推荐**为这个场景引入 RMBG-1.4 / U²-Net / BiRefNet / SAM。理由：它们是**语义分割**，而你已经有了正确的掩膜；剩余缺陷是**亚像素几何问题**，不是语义问题。详见第七章 Q4。
5. **闭式解 matting（erode-N 做 trimap + 稀疏全局求解）在这个场景是「高成本、低边际收益」**，且有已记录的失败模式（小孔洞/细沟发光、trimap 必须极窄）。仅在你要冲「最佳质量」且能接受 8GB 内存下几十秒耗时、引入 Python 依赖时才考虑。

---

## 一、场景复述与关键约束

| 项 | 值 |
|---|---|
| 平台 | aarch64 Linux, 8GB RAM, **无 GPU** |
| 运行时 | Node.js 22.23.2（已在本机 `uname -m` = `aarch64` 核实） |
| 已有依赖 | `sharp`（libvips 绑定） |
| 禁止 | Python venv、CUDA |
| 输入 | 2D 平涂赛璐璐动漫立绘，**纯白底 255,255,255**，黑色描边，1–3px AA 灰阶带 |
| 现状 | 6 步管线，大形状正确，仅边缘脏 |

现状管线（据描述）：

1. 全边框环带逐通道中位数 → 基准色（得到纯白 255,255,255）
2. 强阈值（色差 ≤1）作种子，弱阈值（≤8）8 邻域 flood fill → 全局背景色键
3. 4 连通标记：触边或面积 ≥200px 的连通域判为背景
4. 只保留最大前景连通域
5. 边缘 alpha 软化（**chamfer 距离场**，0.12 比例梯度带）+ un-mix 基准色（去污染）
6. 等比 resize + 居中贴到 1080×1920 透明画布

**观测到的缺陷**：边缘「毛刺」，大量 1px 尖刺与小台阶（jaggies），另有局部细白边。

---

## 二、合成方程与「为什么二值掩膜必然丢信息」

所有 alpha matting 建立在同一个方程上：

```
I = α·F + (1 − α)·B
```

其中 `I` 观测颜色、`F` 真实前景色、`B` 真实背景色、`α` 覆盖不透明度。

Levin 等人原文的定性：

> "for a three channel color image, at each pixel, there are **three equations and seven unknowns**. Obviously, this is a **severely underconstrained** problem, and user interaction is required to extract a good matte."
> —— [Levin, Lischinski, Weiss, "A Closed Form Solution to Natural Image Matting", IEEE TPAMI 30(6), 2008](https://people.csail.mit.edu/alevin/papers/Matting-Levin-Lischinski-Weiss-PAMI.pdf)

**这是本报告的逻辑起点**（标注为**我的推断**，但基于上引事实）：二值掩膜的隐含假设是 `α ∈ {0,1}`，也就是强行把 7 个未知量里最容易估的那个也量化掉了。AA 过渡带里 `I` 携带的正是「这个像素被前景覆盖了百分之几」的信息；丢掉它，后面无论用距离场还是引导滤波，都只能在**错误的量化结果上做插值**，无法还原真相。所以：

- 距离场线性斜坡 / guided feathering **能消除视觉上的硬边**，但**不能消除锯齿**——因为它们忠实还原了掩膜自身的边界形状。
- 只有能读回 `I` 的方法（unmixing / matting / 引导滤波以 `I` 为引导）才有机会修掉锯齿。

---

## 三、Q1：算法族谱系

### 3.1 分类总览

按 [He et al., CVPR 2011, "A Global Sampling Method for Alpha Matting"](http://mmlab.ie.cuhk.edu.hk/archive/2011/cvpr11matting.pdf) 的原文分类：

> "Existing matting methods can be categorized as **propagation-based** or **sampling-based**. Propagation-based methods treat the problem as interpolating the unknown alpha values from the known regions. ... **They mainly rely on the image's continuity to estimate the alpha matte, and do not explicitly account for the foreground and background colors.** They have shown success in many cases, but **may fail when the foreground has long and thin structures or holes**."

| 族 | 代表 | 输入 | 原理 | 计算量 | 适配本场景 |
|---|---|---|---|---|---|
| **传播式** | Closed-form (Levin 2008) | trimap | 解析消去 F/B，得到 α 的二次代价 `(L+Λ)α = Λβ`，解稀疏线性系统 | 原论文 6MP 约 2 分钟 | ⚠️ trimap 须极窄；小孔洞/细沟会「发光」 |
| 传播式 | Laplacian matting (Bai & Sapiro, IJCV 2008) | 无需 trimap | 对 **C/F/B 各自做 Laplacian 平滑约束** | 中等 | ⚠️ 假设前景**硬边不透明**，与 AA 带半透明相反 |
| 传播式 | KNN matting (Chen/Li/Tang, TPAMI 2013) | trimap | 非局部近邻 + 稀疏 | 高 | ❌ |
| 传播式 | Info-flow matting (Aksoy et al., CVPR 2017) | trimap | 显式设计 alpha 沿路径的传播（单边/双边/环绕） | 中 | ❌ |
| 采样式 | Bayesian matting (Chuang et al., CVPR 2001) | trimap | 局部定向高斯混合分布 | 迭代，很慢 | ❌ 且原文说「当 FG/BG 颜色分布不重叠、unknown 区很小时才好用」 |
| 采样式 | Global matting (He et al., CVPR 2011) | trimap | 用**全图**已知 FG/BG 像素作样本，patch-match 式对应搜索 | 高 | ❌ |
| 采样式 | Shared matting (Gastal & Oliveira, CGF 2010) | trimap | 邻域共享样本对 | 「up to two orders of magnitude」加速 | ❌ |
| 采样式 | **Color unmixing / keying** (Yaksoy et al., TOG 2016) | **B 已知** | 能量最小化求 unmixing | 低-中 | ✅ **本场景天然匹配** |
| **滤波式** | Guided filtering (He/Sun/Tang, ECCV 2010) | I + p | 局部线性模型 `q = aI + b` | O(N)，与核大小无关 | ✅ 二值掩膜→alpha 的「官方」做法 |

### 3.2 关键：背景已知 ⇒ matting 退化为逐像素可解

**这是本场景最重要的结构性事实。**

IPOL 预印本（[Ranjbar, Abdelaziz, Jauhar, "A Closed Form Solution to Natural Image Matting"](http://www.ipol.im/pub/pre/532/preprint.pdf)）明确指出：

> "the assumption that **the background is known** (e.g., it is a constant blue or green), **removes some of the ambiguity**"
> —— 转述其对已知背景的讨论

NUS 的 *Theory of Matting* 课程材料给出了这个退化的**完整解析推导**：

> 记 `Cf = α_o·C_o + (1 − α_o)·C_k`，`C_k` 为已知幕布色。逐通道展开得
> `R_f = α_o R_o`、`G_f = α_o G_o`、`B_f = α_o B_o + (1 − α_o) B_k`。
> **"There is no blue in C_o, i.e., B_o = 0. And B_k ≠ 0. In this case, there are only 3 unknowns R_o, G_o, α_o, with 3 equations. Then, from Eq. 3, we obtain α_o = 1 − B_f / B_k."**
> —— [NUS CS5245, Theory of Matting](https://www.comp.nus.edu.sg/~cs5245/lecture/matte.pdf)

即：**当幕布色在某通道上非零、而前景在该通道上为零时，α 有逐像素闭式解。** 这正是绿幕/蓝幕 keying 的数学本质。

更一般地，把合成方程按通道解：

```
α = (I_c − B_c) / (F_c − B_c)      对每个通道 c ∈ {R,G,B}
```

**我的推断（已核对代数）**：由 `I − B = α(F − B)` 两边取 L2 范数，直接得到一个**与通道无关、只除一次**的等价形式：

```
        ‖I − B‖
α  =  ─────────────          （B 已知为常量向量）
        ‖F − B‖
```

这个形式**比逐通道除法稳健得多**，原因（**我的推断**）：
- 逐通道形式在 `F_c ≈ B_c` 的通道上会除以接近 0 的数而爆掉；范数形式只有一个标量分母 `‖F − B‖`，只有当 `F = B`（即根本没有前景）时才为 0，这在过渡带上不可能发生。
- 范数形式等价于三通道的加权最小二乘解（NUS 原文对「加和三方程」的处理，见其 Eq. 16），对单通道噪声不敏感。
- 3D 颜色空间里度量到幕布色的距离，正是 FFmpeg `colorkey` 文档描述的量：

> "The computed distance is related to the **unit fractional distance in 3D space** between the RGB values of the key color and the pixel's color."
> —— [FFmpeg `colorkey`](https://ffmpeg.org/ffmpeg-filters.html)

**GIMP 的 Color to Alpha 就是这个公式的生产实现**（算法作者 clahey 的原始推导，完整保留在 GEGL 的提交说明里）：

> "so if a1 > c1, a2 > c2, and a3 > c2 and a1 - c1 > a2-c2, a3-c3, then **a1 = b1·alpha + c1·(1−alpha)**. So, maximizing alpha without taking b1 above 1 gives a1 = alpha + c1(1−alpha) and therefore **alpha = (a1 − c1) / (1 − c1)**."
> "**b2 = (a1 − c2)/alpha + c2**" ← 这就是 un-mix（去污染）
> "Next if a1 < c1, a2 < c2, a3 < c3 ... we maximize alpha without taking b1 negative gives **alpha = 1 − a1/c1**."
> —— [GEGL `color-to-alpha` 提交（clahey 的算法说明）](https://mail.gnome.org/archives/commits-list/2011-August/msg08655.html)

GIMP 官方文档把这个操作的定位说得非常清楚：

> "The Color to Alpha command makes transparent all pixels of the active layer that have a selected color. **It attempts to preserve anti-aliasing information by using a partially intelligent algorithm that replaces weak color information with weak alpha information.**"
> —— [GIMP 3.2 文档, Color to Alpha](https://docs.gimp.org/3.2/en/gimp-filter-color-to-alpha.html)

同一文档还给出了两个与本场景直接相关的阈值语义：
- **Opacity 阈值**：「the default values work well for removing a white background from a **black** object, but **if the object is gray** instead it will become semi-transparent, since gray is midway between white and black. **Lowering the opacity threshold to 0.5 fixes that**」——**这条正好是本场景的风险点**：描边如果不是纯黑而是深灰/彩色，α 会整体偏低。
- **Transparency 阈值**：「when the transparency threshold is above 0, **recomposing the result against the background color no longer reproduces the exact same image**」——即 clip 会引入不可逆的信息损失。

### 3.3 学术上最严肃的「已知背景」解法：Color Unmixing

[Yaksoy, Matusik, Guttag, "Interactive High-Quality Green-Screen Keying via Color Unmixing", ACM TOG 35(6), 2016](https://yaksoy.github.io/papers/TOG16-keying.pdf) 明确指出这个问题的定位，以及**为什么不能直接拿自然图像 matting 的 benchmark 分数来判断 keying 质量**：

> "our experiments with the state-of-the-art natural matting methods show that **their performance in the alpha matting benchmark does not necessarily carry over to green-screen keying challenges**."

以及它对「只评估 alpha、不评估前景色」的批评：

> "performance based only on **alpha masks** and not **foreground layer colors**. Figure 2 shows two seemingly high-quality alpha maps with significantly different corresponding foreground layers: while one is almost perfect, the other has significant color artifacts."

> **我的推断**：本报告的配方必须**同时**输出正确的 α 和正确的 un-mix 后的前景色，否则会出现「alpha 看着对、边缘发灰」的情况——这正是你观测到的「局部细白边」的另一种可能来源。

### 3.4 引导滤波：二值掩膜 → alpha 的「教科书做法」

[He, Sun, Tang, "Guided Image Filtering", ECCV 2010](https://people.csail.mit.edu/kaiming/publications/eccv10guidedfilter.pdf) 的核心：把滤波建模成引导图 `I` 与输入 `p` 之间的**局部线性模型** `q_i = a_k I_i + b_k`，解正规方程得

```
a_k = ( mean_I p − μ_k p̄_k ) / ( σ_k² + ε )
b_k = p̄_k − a_k μ_k
q_i = ā_i I_i + b̄_i
```

其中（原文）："**ε is a regularization parameter preventing a_k from being too large**"。

**这与 matting 的关系是论文明确给出的**（He 等人自己说明：matting Laplacian 的一次 Jacobi 迭代 ≈ 一步 guided filter），且论文 Figure 9 给出的正是 **"guided feathering"：拿一张二值 mask 作为 p，用原图作为引导 I，得到连续 alpha**。论文把这与 Photoshop CS4 的 "Refine Edge" 并列讨论——也就是说，**「二值掩膜 + 引导滤波 = alpha」是被研究界和工业界同时承认的 canonical 做法**。

**参数出处（重要，不要凭空编数字）**：

| 用途 | r | ε | 出处 |
|---|---|---|---|
| **Guided feathering**（二值 mask→matte，6MP 图） | **60** | **1e-6** | Kaiming He 官方代码 `img_feathering/toy.bmp` 示例，被广泛移植的版本：[atilimcetin/guided-filter](https://github.com/atilimcetin/guided-filter) 中 `r = 60; double eps = 1e-6; eps *= 255*255;` |
| 图像增强示例 | 16 | 0.1² = 0.01 | 同上 `img_enhancement/tulips.bmp` |
| 去雾示例 | 8 | 0.02² | 同上 `img_flash/cave-flash.bmp` |
| **Fast Guided Filter** 默认 | 4 | 0.2² = 0.04 | [He & Sun, arXiv:1505.00996](https://arxiv.org/abs/1505.00996) 原文 |
| FFmpeg `guided` 滤镜默认 | 3 | 0.01 | [FFmpeg 滤镜文档](https://ffmpeg.org/ffmpeg-filters.html#guided) + **本机实测** `ffmpeg -h filter=guided` |

> ⚠️ **单位陷阱（已核实）**：He 的 C++ 参考实现里 `eps` 是以 **0–1 归一化**定义的，实际传给函数前要 `eps *= 255*255` 转成 8bit 强度尺度。**FFmpeg 的 `eps` 选项范围是 0–1，属于归一化尺度**（文档原文：`Set regularization parameter (with square). Allowed range is 0 to 1.`），而 atilimcetin 的移植版注释里写着 `// Because the intensity range of our images is [0, 255]` 然后再乘 255²。**跨工具搬参数时必须先确认单位**，这是最容易踩的坑（见第八章 Q5.4）。

**Fast Guided Filter**（He & Sun, 2015）通过把 I 和 p 降采样 s 倍再算均值把复杂度降到 `O(N/s²)`，论文实测 >10× 加速，参数 `r=4, ε=0.2², s=4`。对本场景（掩膜 + 小半径）意义不大，但如果哪天图很大可以考虑。

### 3.5 距离场 / SDF 线性斜坡

**GPU/字体渲染里的标准做法**（Chlumský 的 MSDF，通过 msdfgen 传播）：

> "we need to choose a threshold value t, and for distance values in the interval ⟨−t, t⟩, use the weighted average of the two colors: ... The value of t should be chosen so that the interval ⟨−t, t⟩ in signed distance units is **about as wide as a ... pixel in the target**"
>
> ```glsl
> float screenPxDistance = screenPxRange()*(sd - 0.5);
> float opacity = clamp(screenPxDistance + 0.5, 0.0, 1.0);
> ```
> —— [Fractolog: MSDF Fragment Shader Antialiasing](https://www.fractolog.com/2025/01/msdf-fragment-shader-antialiasing/)（含 msdfgen README 原文引用）

以及 Edaqa Mortoray 的等价式：

> ```python
> pixel_opacity = clamp(0.5 - distance_to_edge, 0, 1)
> ```
> "suppose we have a 'perfect case' … the signed distance from the edge will be 0.5 for the outside pixel and −0.5 for the inside pixel. Now considering the most 'imperfect' case, where a pixel is exactly half-covered by the shape, the signed distance will be 0 as the edge passes directly through the pixel's center."
> —— 同上，转引 Edaqa Mortoray, *Antialiasing with a signed distance field*

**精确欧氏距离变换**（如果你要实现，不是用当前的手写 chamfer）：[Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled Functions", Theory of Computing 8(23), 2012](https://theoryofcomputing.org/articles/v008a019/v008a019.pdf)：

> "Our main result is a new **linear-time** algorithm for computing the distance transform of a sampled function when distance is measured by the squared Euclidean distance. This in turn provides a new technique for computing the **exact EDT of a binary image**"
>
> 原理：1D 先解「抛物线下包络」，再按维可分离。**这个算法在 JS 里约 40 行即可实现**，两趟即可。

> **我的推断**：chamfer（3-4 邻域整数权重）与精确 EDT 的最大差异出现在**斜边**上——chamfer 会把斜边量化成阶梯，这本身也是你看到「小台阶」的一部分来源。如果保留几何路线，升级到 Felzenszwalb 两趟精确 EDT 是低风险高回报的改动。

### 3.6 形态学：去 1px 毛刺

libvips 文档对形态学的定位写得非常直白：

> "The morphological functions search images for particular patterns of pixels, specified with the mask argument, either adding or removing pixels when they find a match. **They are useful for cleaning up images — for example, you might threshold an image, and then use one of the morphological functions to remove all single isolated pixels from the result.**"
> —— [libvips morphology 文档](https://www.libvips.org/API/8.16/libvips-morphology.html)

**sharp ≥ 0.34.0 已经原生暴露了 `erode()` / `dilate()`**（这是本次调研的一个意外收获）：

- 版本证据：[sharp v0.34.0 changelog, 2025-04-04, "Expose erode and dilate operations. #4243"](https://sharp.pixelplumbing.com/changelog/v0.34.0/)，源自 [issue #1719](https://github.com/lovell/sharp/issues/1719)（2019 年提出，2025 年才合）。
- **实现细节（我解包 `sharp@0.34.5` 的 npm 包，读 `src/operations.cc:479-497` 确认）**：

```cpp
VImage Dilate(VImage image, int const width) {
  int const maskWidth = 2 * width + 1;
  VImage mask = VImage::new_matrix(maskWidth, maskWidth);   // 全零矩阵
  return image.morph(mask, VIPS_OPERATION_MORPHOLOGY_DILATE).invert();
}
// Erode 同构，用 VIPS_OPERATION_MORPHOLOGY_ERODE
```

即 `erode(w)` / `dilate(w)` = **(2w+1)×(2w+1) 的全实心方块结构元**（不是圆盘），最后 `invert()` 是因为 libvips 用**反极性**约定（0=背景/黑，255=物体；见 [libvips 文档](https://www.libvips.org/API/8.16/libvips-morphology.html) "Note that this is the reverse of the usual convention"）。所以 `erode(1)` 就是 3×3 方阵腐蚀。

- ⚠️ **注意**：`unflatten()` 也在同版本可用（[sharp 0.32.1 起](https://sharp.pixelplumbing.com/api-operation/)），语义是「Ensure the image has an alpha channel with **all white pixel values made fully transparent**」——这是一次**硬阈值版**的 color-to-alpha，可以当一行 baseline 对照物。

**开运算的正确用法与副作用**：
- `opening = erode → dilate`，用方块 SE 时等价于「2×2 邻域最小值后再最大值」，能消掉**宽度 < 2px 的凸出和宽度 < 2px 的凹陷**。你的 1px 尖刺正好命中。
- **副作用（已记录的陷阱）**：开运算会**削掉细长结构**。scikit-image 的 `diameter_opening` 文档明确指出「long thin structures are **not** removed by diameter_opening」（即 bbox 太长就不删），而普通 `opening` 没有这个豁免——**1px 宽的发丝会被开运算直接抹掉**。动漫立绘的头发尖梢正是这种结构。
- **替代方案：3×3 中值滤波**。二值图上的 3×3 中值同样能去盐椒/1px 毛刺，但保形性优于同半径开运算。sharp 的 `.median(3)` 对应 `vips_median`（[libvips 算子列表](https://www.libvips.org/API/8.16/libvips-morphology.html) 有 `vips_median`），你**当前管线已经在用 median**（第 1 步），所以它一定可用。

### 3.7 去污染 / 前景色估计

α 已知后反解前景色：

```
F = ( I − (1 − α)·B ) / α
```

这就是 GEGL 源码里那一行：

```c
ratio = FGalpha / (OUTalpha + eps);
OUT   = OUT * ratio + BG * (1 - ratio);
```

（GIMP 文档描述更直白：「**the background color becoming fully transparent**」——即把观察色按 α 比例向背景色混合，反过来就是从观察色里去掉背景分量。）

**Photoshop 的对应功能叫 "Decontaminate Colors"**，社区文档描述：

> "For **edge spill**, check **Decontaminate Colors** in the Output Settings of Select and Mask, which **samples clean color from inside the subject and paints over the contaminated edge**."
> "**Halos** are fixed by contracting the mask; **fringing needs the contaminated color replaced**, using Decontaminate Colors or a clipped Hue/Saturation desaturation."
> —— [Adobe 社区（Photoshop Select and Mask / Edge cleanup）](https://forums.autodesk.com/t5/maya-shading-lighting-and/white-fringe-around-object-rendered/td-p/6812386)

> **我的推断**：`F = (I − (1−α)B)/α` 在 α→0 时分母爆掉。必须设 α 下限（如 `α < 0.3` 时直接取「掩膜内部最近的颜色」而不做除法），这与 Photoshop「samples clean color from inside the subject」的做法一致。

**你当前管线第 5 步已经在做 un-mix**，方向是对的；问题在于**它的 α 来自距离场（错的），所以 un-mix 也在解一个错误的前提**。α 修正后这一步几乎不用改。

### 3.8 动漫/线稿专用分割值不值得

**结论：不值得**（针对本场景）。理由与证据：

- 存在且确实有效的动漫专用模型：[ToonOut, arXiv:2509.06839](https://arxiv.org/abs/2509.06839) 用 1,228 张动漫图微调 BiRefNet，像素级精度 95.3% → 99.5%；[BEN/BEN2](https://huggingface.co/PramaLLC/BEN) 用 Confidence Guided Matting 做边缘精修；rembg 有 `isnet-animate` 模型。
- 但这些全部是**语义分割 / 抠图模型**——它们的工作是「从零判断哪些像素是角色」。**你已经有了这一步且做对了。** 让 BiRefNet 重新分割，你能得到的最好结果就是「追平你现有的掩膜」，而剩下的亚像素边缘质量它们也帮不上（它们的 1024×1024 输入本身会引入重采样模糊）。
- 有一条**反向证据**支持 ToonOut 论文的观察：DIS 类模型在动漫头发/半透明区域会退化——因为它们的训练目标不是「干净的 AA 带」。

> **我的推断**：如果哪天你的问题变成「大形状也错了」（多部件、飘散发丝把脸切碎、道具被吞），那时再上 ToonOut/BEN2。现在不是。

---

## 四、Q2：路线判定

你问的是：**「掩膜腐蚀 N px 造 unknown 区 → 跑 closed-form / global matting」** vs **「更简单的等价物（纯距离场线性斜坡）」**。

我的判定，按你给的具体约束排序：

### 路线 A：闭式解 matting（erode-N trimap + 稀疏全局求解）

**不适合。** 三条已记录的失败模式：

1. **trimap 必须极窄**。Levin 原文：「for good results, **the unknown regions in the trimap must be as small as possible**」；「trimap-based approaches typically experience difficulty handling images with a significant portion of mixed pixels or when the foreground object has many holes」。你的 unknown 区就是 1–3px 的 AA 带，理想；但一旦轮廓有**凹陷/孔洞**（动漫立绘的镂空发丝间空隙、袖口与身体的缝隙）就会出问题。NUS 材料记录了 closed-form 的典型症状：「**glows in small holes and thin grooves**」。
2. **前提假设全被破坏**。Laplacian matting 面向「硬边不透明物体」；闭式解面向自然图像的 F/B 平滑性。你的轮廓是**1px 内从纯白到近黑**的剧烈跳变，正好是平滑性假设最差的地方——而**引导图只有 1–3px 有效信息**时，matting Laplacian 的每一项都在跨越这条跳变。
3. **成本与依赖**。原论文 6MP 约 2 分钟；MarcoForte 的 Python 实现（[github.com/MarcoForte/closed-form-matting](https://github.com/MarcoForte/closed-form-matting)）需要 `scipy + opencv-python + numpy`；PyMatting 更重，依赖 **numba**（→ llvmlite/scikit-image 在 aarch64 无 wheel 时要源码编译，rembg 在 ARM 上装不上的经典原因，见 [rembg issue #131](https://github.com/danielgatis/rembg/issues)）。**违背「无 Python」约束。**

### 路线 B：纯距离场线性斜坡（你现在的做法）

**不推荐作为终态。** 它确实能软化硬边，但：

- 斜坡的**位置**完全由二值掩膜的边界决定 → **忠实复现掩膜的 1px 锯齿**。这是它的结构性上限，不是调参能解决的。
- 你已经实测到「毛刺」，就是这条路线走到头的表现。
- 但它**不是没用的**：它给了 alpha 一个**拓扑正确的初值**，且在轮廓附近 1px 内 alpha 是单调的。作为 fallback / 兜底 / 与路线 C 做加权，保留。

### 路线 C：已知背景色的逐像素 color unmixing ← **推荐**

**为什么它是「更简单的等价物」，而且严格更好**（**我的推断**，但可核对）：

| 维度 | 距离场斜坡 | Color unmixing |
|---|---|---|
| α 的信息来源 | 掩膜几何（已量化） | **原图像素值**（未量化，含真实覆盖率） |
| 能否修掉 1px 锯齿 | ❌ 只能忠实复现 | ✅ 二值化丢掉的信息在这里被找回 |
| 能否修掉白边 | ❌ | ✅ un-mix 天然去背景污染 |
| 是否需要全局求解 | ❌ | ❌ 逐像素，**O(N)，无矩阵** |
| 对「掩膜边界错 1px」鲁棒性 | ❌ 错就是错 | ✅ 只要像素值在过渡带上就对 |
| 需要 trimap | ❌ | ❌（但建议只在过渡带内应用） |
| 新依赖 | 无 | **无** |

**唯一的技术风险**：需要一个可信的 `F`。下一节给出解法。

### 路线 D：Guided feathering（引导滤波）

**次推荐，作为路线 C 的平滑/兜底层**。它是唯一同时用到 `I` 和掩膜 `p` 的低阶方法，可以自动抑制 unmixing 沿轮廓的抖动（正是你的 Q3）。但**不要用它替代 unmixing**——它本质是启发式的局部线性拟合，在 1–3px 尺度上它能做的只是「把锯齿抹圆」，做不到「把锯齿纠正」。

> **我的推断**：C → D 的顺序（先解真值、再平滑）比 D → C 的顺序好，因为 D 的输出会污染 C 的输入估计。

---

## 五、Q3：可落地配方

### 5.1 总流程

```
[0] raw() 取出 RGB
[1] 去毛刺：erode(1) → dilate(1)   （开运算，3×3 方块 SE）  ← 或 median(3)
[2] 估计 F_global：取「掩膜内、紧邻边界带」的像素中位数
[3] 逐像素 α = clamp( ‖I − B‖ / max(‖F_local − B‖, δ), 0, 1 )
     约束：只在「掩膜膨胀 2px − 掩膜腐蚀 2px」的环带内生效；带外 α=0 或 1
[4] （可选·更强）按轮廓分段细化 F，见 5.4
[5] 沿轮廓平滑 α：ffmpeg guided=r=2..4,eps=0.01..0.1 / 或手写 3×3 中值
[6] un-mix 前景色：F = (I − (1−α)B)/α，α < α_min 时改用 F_global
[7] 组装 RGBA → resize → 贴画布（保持现有流程）
```

### 5.2 每一步的参数与出处

| 步 | 参数 | 取值 | 出处 |
|---|---|---|---|
| **1** | 开运算半径 | `erode(1).dilate(1)`（3×3） | libvips 文档明说形态学用于「remove all single isolated pixels from the result」；sharp ≥0.34.0 原生支持（[changelog](https://sharp.pixelplumbing.com/changelog/v0.34.0/)）。半径 1 是最小可用值，专门针对 1px 毛刺 |
| **1'** | 备选 | `.median(3)` | 二值图 3×3 中值，同级去毛刺但更保形；`vips_median` 已在用 |
| **1''** | 备选（CLI） | `ffmpeg -vf "morpho=mode=open:structure=..."` | **本机实测可用**：`morpho` 支持 `erode/dilate/open/close/gradient/tophat/blackhat` 七种模式，结构元由第二个输入流给出（[FFmpeg 文档](https://ffmpeg.org/ffmpeg-filters.html) + `ffmpeg -h filter=morpho`）。**只有它能给圆盘结构元**（生成为 `color=c=black:s=NxN,format=gray` 之类） |
| **2** | 采样半径 | 掩膜**内** 2–3px 环带 | **我的推断**。取 2px 是为了既贴近轮廓（拿到描边色）又不被大面积填充色污染。`rembg` 的 trimap 用 `erode_structure_size=10` 建 unknown 区（[rembg `bg.py`](https://github.com/danielgatis/rembg)），那是给神经网络预测用的 1024×1024 掩膜，尺度不同，**不可直接照搬** |
| **3** | 除零保护 δ | `δ = 8`（8bit 强度单位） | **我的推断**。给自定：8bit 下 8/255 ≈ 3%，与现有管线「弱阈值 ≤8」的量级一致，保证视觉上不可见。数学上 `‖F−B‖ < δ` 时 α 无意义，直接回退到 α=1（该像素确定是前景） |
| **3** | 过渡带宽度 | 掩膜 `dilate(2)` 与 `erode(2)` 之间 | **我的推断**。2px 覆盖你观测到的 1–3px AA 带；再宽会让算法去动已经有把握的像素 |
| **5** | 引导滤波 r | **2–4** | FFmpeg 默认 `radius=3`（[文档](https://ffmpeg.org/ffmpeg-filters.html#guided) + 本机实测）；He 的 feathering 用 r=60 是因为输入是 6MP 的自然图像边界，**尺度完全不同，不可照搬** |
| **5** | 引导滤波 ε | **0.01（FFmpeg 归一化尺度）** | FFmpeg 默认 `eps=0.01`（同上）。若改用 atilimcetin 移植版（8bit 尺度），对应值是 `0.01 × 255² ≈ 650` |
| **6** | α 下限 | `α_min = 0.3` | **我的推断**，对应 Photoshop "Decontaminate Colors ... samples clean color from inside the subject"（不做除法，改采样） |
| **7** | resize 插值核 | `lbb`(locally bounded bicubic) 或 `nohalo` | sharp 内部支持（[sharp interpolators](https://sharp.pixelplumbing.com/api-output/#interpolators)）：`lbb`「Prevents **'acutance'**」、`nohalo`「Prevents acutance but typically reduces performance by a factor of 3」。`nohalo` 专为消除振铃/光晕设计 |

### 5.3 关键实现片段（可直接改）

```ts
// ── 1) 去毛刺：开运算（sharp ≥ 0.34.0）
//     erode(1) = 3×3 方块腐蚀，dilate(1) = 3×3 方块膨胀
const clean = await sharp(maskPng).erode(1).dilate(1).png().toBuffer();

// 若担心削掉 1px 宽发丝，换中值：
// const clean = await sharp(maskPng).median(3).png().toBuffer();

// ── 2) 估计 F：取掩膜内 2px 环带的中位色
//     （从 raw 缓冲直接算；sharp 无「带状区域中值」，手写更省事）

// ── 3) 逐像素 color unmixing
const B = [255, 255, 255];                 // 已知纯白
const F = fgMedian;                        // 步骤 2 的结果
const denom = Math.hypot(F[0]-B[0], F[1]-B[1], F[2]-B[2]);  // 单个标量
for (let i = 0; i < n; i++) {
  const num = Math.hypot(I[i*3]-B[0], I[i*3+1]-B[1], I[i*3+2]-B[2]);
  const a = num / Math.max(denom, 8);     // δ=8 见 5.2
  alpha[i] = inBand[i] ? Math.min(255, Math.round(a * 255)) : (fg[i] ? 255 : 0);
}

// ── 6) un-mix 前景色
for (let i = 0; i < n; i++) {
  const a = alpha[i] / 255;
  if (a < 0.3) { outRGB[i] = F; continue; }             // 不做除法
  outRGB[i] = [
    (I[i*3]   - (1 - a) * B[0]) / a,
    (I[i*3+1] - (1 - a) * B[1]) / a,
    (I[i*3+2] - (1 - a) * B[2]) / a,
  ].map(v => Math.max(0, Math.min(255, Math.round(v))));
}
```

### 5.4 进阶：F 的局部细化（可选）

**背景**：全局 `F` 假设「整条轮廓的描边颜色一致」。对纯黑描边成立，对**彩色描边 / 深灰描边 / 渐变边缘**不成立，α 会系统性偏低（GIMP 文档警告的正是这个：「if the object is gray instead it will become semi-transparent... Lowering the opacity threshold to 0.5 fixes that」）。

**做法**（**我的推断**，无直接文献对应）：
1. 用全局 `F` 得到 α₁
2. 在 α₁ ∈ (0.1, 0.9) 的带内像素上做 `F_local = (I − (1−α₁)B) / α₁`（这就是 un-mix，此时分母不小，安全）
3. 对 `F_local` 做一次 3×3 邻域**中值**（不是均值——中值抗离群值）
4. 用 `F_local` 重算 α₂
5. 一次即可收敛；不要迭代超过 2 次

> **我的推断**：这正是 [Yaksoy et al. TOG 2016](https://yaksoy.github.io/papers/TOG16-keying.pdf) 所说的「energy minimization-based color unmixing」的**极简版本**——那篇论文做的是把整张图的 unmixing 写成能量泛函做全局优化（因为生产绿幕的幕布有褶皱、脏污，F 本身不是常量）。你的白底是真常量，所以那个复杂度**完全不需要**。

---

## 六、Q4：可用实现盘点（ARM64 / 无 GPU / 无 Python）

### 6.0 本机实测环境（刚跑的，非推测）

```
uname -m   → aarch64
node -v    → v22.23.2
ffmpeg     → 6.1.1-3ubuntu5  (--arch=arm64)
             filters: guided, colorkey, despill, morpho, dilation, erosion,
                      alphamerge, alphaextract  ✅ 全部在
convert     → ImageMagick 6.9.12-98 Q16 aarch64
vips CLI   → 不存在
python3    → 存在
```

**这是一个重要发现：你的机器上已经装着 ffmpeg（arm64 原生），带 `guided` 和 `morpho` 滤镜。** 这两条都能省掉手写代码。

### 6.1 `sharp`（已装，**首选**）

我解包 `sharp@0.34.5` 的 npm 包读了 `lib/index.d.ts` 与 `src/operations.cc`，逐条核实可用方法：

**与本任务直接相关（确认可用）**
`erode(w)` / `dilate(w)` · `median(size)` · `threshold(t,{greyscale})` · `boolean(op,{raw})` · `bandbool(op)` · `recomb(M3x3|M4x4)` · `linear(a,b)` · `gamma(g,gOut)` · `negate()` · `convolve(kernel)` · `blur(sigma)` · `sharpen({sigma})` · `clahe()` · `normalise()` · `stats()` · `raw({depth,channels})` · `joinChannel()` · `ensureAlpha()` · `unflatten()` · `extractChannel()` · `extract()` · `composite()` · `trim({background,threshold})` · `resize({kernel})` · `cache()` · `tile()`

**确认不可用**
- ❌ 距离变换 / EDT（我在 libvips 算子索引与 morphology 页都没找到对应算子；libvips 唯一与距离相关的是 `vips_fill_nearest` 的可选输出 band，不是通用 EDT）
- ❌ 开/闭运算作为单步 API（需 `erode().dilate()` 组合；且**结构元只能是实心方块**）
- ❌ Guided filter
- ❌ 骨架化 / 分支剪枝

**resize 插值核（软 alpha 缩放相关，完整列表见 [sharp API](https://sharp.pixelplumbing.com/api-output/)）**
`nearest` · `cubic` · `mitchell` · `lanczos2/3` · `lbb`（locally bounded bicubic，"Prevents 'acutance'"）· `nohalo`（"Prevents acutance"，慢约 3×）· `mks2013` · `mks2021` · `vsqbs`（"Prevents 'staircasing' when enlarging"）

### 6.2 FFmpeg CLI（**本机已装，arm64 原生**）—— 最省事的两条捷径

**（a）Guided feathering，一行搞定「二值掩膜 → 连续 alpha」**

```bash
ffmpeg -i mask.png -i source.png \
  -filter_complex "[1:v]format=gray[guide];[0:v]format=gray[mask];\
                   [mask][guide]guided=mode=fast:radius=3:eps=0.01:planes=1[out]" \
  -map "[out]" alpha.png
```

实测可用参数（本机 `ffmpeg -h filter=guided`）：
```
radius  <int>   1..20   default 3
eps     <float> 0..1    default 0.01      ← 注意是「with square」，归一化尺度
mode    basic | fast     default basic
sub     2..64            default 4        （fast 模式降采样比）
planes  0..15            default 1        （默认只滤第一个 plane）
```
出处：[FFmpeg 滤镜文档 §11.116 guided](https://ffmpeg.org/ffmpeg-filters.html#guided)

**（b）Colorkey with blend —— 一行搞定「已知背景色的软抠图」**

```bash
ffmpeg -i in.png -vf "format=rgb24,colorkey=0xFFFFFF:0.01:0.6" out.png
```

文档语义（[§11.34 colorkey](https://ffmpeg.org/ffmpeg-filters.html#colorkey)）：
- `similarity`（1e-5..1，默认 0.01）：到 key 色的 3D 单位距离半径，圈内 α=0
- `blend`（0..1，默认 **0**）：**「Higher values result in semi-transparent pixels, with greater transparency the more similar the pixel color is to the key color」** —— 这就是 Q1 里那条「差值映射到 α」的公式，一行实现

> **我的推断**：`colorkey=0xFFFFFF:0.0X:0.6` 是本场景**最好的 5 分钟 baseline**，成本 0 行代码。但它的 α 上限被 `similarity` 圈死（圈外直接 α=1），所以它无法表达「半透明带」——带内只有 0→1 线性。要真正用到你的 1–3px AA 带，`similarity` 要设得比 AA 带宽大（≈0.1），代价是会把浅色的内部区域误判。**所以它适合当 sanity check，不适合当终态。**

**（c）`morpho` 开放/闭运算（本机实测）**——`mode=erode|dilate|open|close|gradient|tophat|blackhat`，结构元由**第二个输入流**给。这是在 CLI 侧做**圆盘**开运算的唯一途径（sharp 的方块 SE 会削得更狠）。

**（d）`despill`**（[§11.66](https://ffmpeg.org/ffmpeg-filters.html#despill)）——为绿幕/蓝幕设计，目标是去掉前景边缘的反色溢出。你的背景是白色、溢出方向相反，**不适用**。

### 6.3 ImageMagick（本机已装，IM6 语法）

```bash
convert in.png -alpha set -fuzz 8% -transparent white out.png     # 硬阈值抠白底
convert mask.png -morphology Open Disk:1 cleaned.png              # 圆盘开运算
```
- `-alpha set` + `-transparent <color>` + `-fuzz <pct>`：IM6 标准抠色。注意这是**硬阈值**（fuzz 内全透明），**不会**产生过渡带 alpha。
- `-morphology Open Disk:1` 提供了 sharp 没有的**圆盘**结构元。
- ⚠️ IM 6.9.12-98 **有已知 CVE**（[CVE-2026-55595](https://app.opencve.io/cve/CVE-2026-55595) connected-components 死循环；[CVE-2026-56370](https://nvd.nist.gov/vuln/detail/CVE-2026-56370) `ConnectedComponentsImage()` 越界），虽都与本场景无关，但别用 `-connected-components` 处理不可信输入。

### 6.4 ONNX / 预训练模型

| 模型 | 大小 | 输入 | ARM64 CPU 可行性 | 对本场景 |
|---|---|---|---|---|
| **RMBG-1.4** (Bria) | 44,046,790 params ≈ 176MB | 1024×1024 | 可（`onnxruntime-node` 有 Linux arm64 CPU 预编译） | ❌ 语义模型，大形状你已做对 |
| **U²-Net / isnet-animate** | ~176MB | 1024×1024 | 同上 | ❌ 同上 |
| **BiRefNet / BEN2** | 数百 MB | 高分辨率 | 可但慢 | ❌ 同上 |
| **MODNet** | trimap-free，参数最小 | 512×512 | 可 | ❌ 同上 |
| **SAM** | 2.4GB (vit-h) / 375MB (vit-b) | 1024 | 可但**极慢**（CPU 数十秒～分钟级） | ❌❌ 严重过剩 |

**可行性判断依据（逐项）**：
- `onnxruntime-node` **官方预编译矩阵包含 Linux arm64 CPU EP**（[unpkg 上的 v1.26.0 README](https://unpkg.com/onnxruntime-node@1.26.0/README.md)）：Windows x64/arm64、**Linux x64**、**Linux arm64 ✔**、macOS x64/arm64 均支持；WebGPU 在 Linux arm64 不可用；Linux x64 额外有 CUDA/TensorRT。要求 Node ≥16。
- `@imgly/background-removal-node` 依赖 `onnxruntime-node ~1.17.0` + `sharp ~0.32.4`，可 `model: 'small' | 'medium'`（[仓库](https://github.com/imgly/background-removal-js)）。⚠️ **两个坑**：(1) 它 pin 了 `sharp ~0.32.4`，会和你的 sharp 版本打架；(2) ONNX 模型托管在 IMG.LY CDN，生产环境要自托管（`publicPath`），首次运行还要下载 wasm。
- Python 路线（`rembg` / `pymatting`）在 aarch64 上**依赖地狱**：`pymatting` 依赖 **numba** → llvmlite → 无 aarch64 wheel 时源码编译，rembg 有公开的 ARM64 安装失败记录（[issue #131](https://github.com/danielgatis/rembg/issues)）。`onnxruntime` 的 aarch64 wheel 需从 [piwheels](https://piwheels.org/) 取；`onnxruntime-gpu` 是 x86-only（[microsoft/onnxruntime#27760](https://github.com/microsoft/onnxruntime/pull/27760) 仍在加 aarch64 CUDA wheel）。

### 6.5 过度杀伤的量化论证（**我的推断**）

| 方案 | 新增磁盘 | ARM64 CPU 单张耗时 | 能修「1px 锯齿 + 白边」吗 |
|---|---|---|---|
| Color unmixing（推荐） | **0 MB** | <50ms（几百万像素的一次 sqrt） | ✅ 从根上修 |
| Guided filter via ffmpeg | 0 MB | ~200ms | ⚠️ 只能抹圆，不能纠正 |
| 闭式解 matting | +200MB（Python 栈） | 秒级～分钟级 | ⚠️ 可能引入新伪影 |
| RMBG-1.4 | +176MB | 数秒 | ❌ 分割问题，不是边缘问题 |

---

## 七、Q5：陷阱清单

### 7.1 平涂纯色上跑 alpha matting 会不会比二值更差？

**会，但只在两种情况下**，两种都能避免：

1. **前景色估计错了。** GIMP 文档的原话：「the default values work well for removing a white background from a **black** object, but **if the object is gray** instead it will become semi-transparent, since gray is midway between white and black. **Lowering the opacity threshold to 0.5 fixes that**」。→ 你的描边如果不是纯黑，α 会整体偏低。**缓解：用第 5.4 节的局部 F 细化。**
2. **阈值太紧导致不可逆。** GIMP 文档：「when the transparency threshold is above 0, **recomposing the result against the background color no longer reproduces the exact same image**」。→ **缓解：不要加硬 clip**，用 clamp 到 [0,1] 而不是把带内压成 0/1。

反过来说，二值法在这个场景**必然更差**：它把 AA 带的信息全部丢弃了，你观测到的 1px 锯齿就是丢弃的证据。

### 7.2 Guided filter 的 ε 怎么选

**ε 的物理含义**（He 原文）："a regularization parameter **preventing a_k from being too large**" —— `a_k` 是局部线性模型的斜率，ε 越大越抑制斜率、输出越接近窗口均值（越平滑、越丢失边缘）。

**必须先解决单位问题**（见 3.4 的 ⚠️）：
- He 的 C++ 参考实现：ε 定义在 **[0,1] 归一化**尺度，传参前 `eps *= 255*255`
- atilimcetin 移植版：`r=60, eps=1e-6` 且 `eps *= 255*255` → 实际 8bit 值 0.065
- **FFmpeg `guided`**：选项范围 `0..1` = **归一化尺度**，直接填 0.01
- **OpenCV / MATLAB `imguidedfilter`**：不同移植版本单位不一致，必须逐个确认

**给本场景的取值（我的推断）**：
- 只想**轻微**平滑 1px 抖动：`eps = 0.01`（FFmpeg 归一化）≈ He 的 8bit 尺度 650
- 想**强力**抹平（会把 1px 发丝也抹掉）：`eps = 0.1`
- `radius`：2–4。**不要用 He 的 60**——那是 6MP 自然图像的尺度，1080×1920 的立绘上 r=60 等于把整个头都糊了

**快速判据（我的推断）**：把 `eps` 调大到 alpha 沿轮廓变成一条完全平坦的曲线，就说明过度了，退回上一个量级。

### 7.3 背景色估计不准的后果

- **B 估偏（不是纯白而是 254 或 253）** → 整个 α 有一个小的常数偏置 → 边缘整体「发灰」或整体「过冲」。你现有管线用「边框环带逐通道中位数」已经很好（对纯白底会精确得到 255），**保持不变**。
- **F 估偏** → 见 7.1，且误差被 `1/‖F−B‖` 放大。**‖F−B‖ 越小误差越致命**——所以 δ 下限是必须的。
- **un-mix 时 α 估小** → `F = (I−(1−α)B)/α` 减不够，残留背景白 → **细白边**。这是你观测到的第二个症状的另一个候选成因。
- **un-mix 时 α 估大** → 减过头 → 前景色偏暗/偏饱和 → 边缘「发黑」。

> **我的推断**：由于 α 和 F 是耦合的（α 由 F 算、F 由 α 反解），**必须同时监控 un-mix 的结果**。一个廉价的一致性检查：un-mix 后把 RGB 与 α 重新合成 `αF+(1−α)B`，与原图 `I` 逐像素比对，误差大就说明 α/F 不自洽。这个往返测试（round-trip）几行代码就能写，是**最有价值的单元测试**。

### 7.4 软 alpha 在后续 resize 时怎么处理

- **libvips/sharp 在 resize 时内部做 premultiply**（ unpremultiply → resize → repremultiply ），这是正确做法；否则透明像素的 RGB（通常是 0 或残留背景色）会渗进边缘。
- 已知问题是**锯齿条纹**：libvips PR #1675 记录了 logo 文字上出现的 "jagged stripe" 问题，原因是整数量化。可用的缓解：sharp 内部用浮点 premultiply 精度更高；或自己在 resize 前把 alpha 从 8bit 提到 16bit。
- **`nohalo` / `lbb` 插值核**是 sharp 为「防振铃/光晕」提供的（[sharp interpolators](https://sharp.pixelplumbing.com/api-output/#interpolators)）。你的场景从「纯白底」变「透明底」，是最容易出现 halo 的情形——**建议试 `lbb`**。
- **更根本的顺序问题（我的推断）**：**应该在原始尺寸上把 alpha 和颜色都算对，再做最后一次 resize**。如果先 resize 原始图（丢掉 AA 带）再抠图，就再也回不去了。你当前流程是「先抠后缩放」，顺序正确。

### 7.5 其它已记录的坑

- **白边的两个不同成因**，别混为一谈（[Adobe 社区](https://forums.autodesk.com/t5/maya-shading-lighting-and/white-fringe-around-object-rendered/td-p/6812386)）：
  > "**Halos** are fixed by contracting the mask; **fringing** needs the contaminated color replaced, using Decontaminate Colors"
  
  **halo（晕）** = mask 收得太外，边缘有一圈本该全透明的像素被留成了半透明 → 收缩 mask；**fringing（色边）** = alpha 对但 RGB 被背景污染 → 换色。你描述的「局部细白边」两者都可能是，**先做 round-trip 测试区分**。
- **开运算会吃掉 1px 发丝**（见 3.6）。立绘的头发尖梢、睫毛是细长结构，**先在 1–2 张典型图上对比开运算前后的发丝末端**。
- **trimap 宽度不能太宽**（Levin 原文），你若保留闭式解路线，erode N 不要超过 3。

---

## 八、直接回答你提的 4 个问题

### Q1：已知纯色背景下，alpha matting 有没有闭式简化？叫什么？多通道怎么合成？分母很小怎么办？

**有。** 三个名字指向同一件事：

| 名称 | 出处 | 形态 |
|---|---|---|
| **Luminance/Chroma/Difference keying** | [NUS CS4340 Digital Compositing](https://www.comp.nus.edu.sg/~cs4340/lecture/compositing.pdf) | 工程口术语：「Compute difference between foreground and background (based on luma, chroma, or color). Map difference value to α. **Very small diff ⇒ α = 0. Very large diff ⇒ α = 1. Intermediate diff ⇒ intermediate α.**」Keylight 的 **Clip Black / Clip White** 就是这两个阈值 |
| **Color to Alpha** | [GIMP 文档](https://docs.gimp.org/3.2/en/gimp-filter-color-to-alpha.html) / [GEGL 源码](https://mail.gnome.org/archives/commits-list/2011-August/msg08655.html) | 逐通道解析：前景比背景亮时 `α = (a₁−c₁)/(1−c₁)`，暗时 `α = 1 − a₁/c₁`；再按 `b = (a₂−c₂)/α + c₂` 反解前景色 |
| **Color Unmixing** | [Yaksoy, Matusik, Guttag, TOG 2016](https://yaksoy.github.io/papers/TOG16-keying.pdf) | 学术口术语：把 unmixing 写成能量泛函全局优化（应对幕布不干净） |

**你的推导 `α = (B−I)/(B−F)` 完全正确**，是合成方程的逐通道解。

**多通道合成（推荐写法，我的推断 + NUS 佐证）：**

不要逐通道各算一个 α 再平均。用**范数形式**：

```
α = ‖I − B‖ / max(‖F − B‖, δ)
```

理由（**我的推断**）：
- 数学等价：`I − B = α(F − B)` ⟹ `‖I − B‖ = α‖F − B‖`，**这是精确恒等式，不是近似**
- 只有一个标量分母 → **不存在逐通道除零问题**。只要 `F ≠ B`（过渡带上必然成立）就不会爆
- 逐通道平均会给「前景在该通道上与背景色接近」的通道分配不合理权重（NUS 原文对类似情形给的做法是「Add up the three equations」，见其 Eq. 16，结构上就是求和而非平均）

**NUS 教材里的特解**（当背景色在某通道非零、而前景在该通道为零时）：

```
α = 1 − B_f / B_k
```

来源：[NUS CS5245 Theory of Matting, Eq. 4](https://www.comp.nus.edu.sg/~cs5245/lecture/matte.pdf)

**防爆的 clamp / 平滑（我的推断，有文献锚点）：**
- 分母下限：`max(‖F−B‖, δ)`，`δ` 取 **8**（8bit）——与现有管线弱阈值 ≤8 同量级，视觉不可见
- 分子不用额外 clamp（`‖I−B‖ ≥ 0` 天然有界）
- 输出 clamp 到 `[0,1]`，**不要**用 clip 把带内压成 0/1（GIMP 文档明确警告那样会不可逆）
- 若要更强的稳健性：**先沿轮廓做一次 3×3 中值**再除（中值抗离群），而不是均值

### Q2：F 用「最近邻前景像素」会不会带进噪声？中值/均值？半径取多少？

**会。最近邻是最差的选择。**（**我的推断**，但有间接文献支持）

原因：最近邻取到的是**单个像素**，它可能是压缩噪点、抗锯齿残值、或轮廓上的一个亮/暗异常点。单个 F 误差 e 会被 `1/‖F−B‖` 直接放大进 α，且这个误差**沿轮廓随机分布** → 正是你观测到的「沿轮廓 alpha 剧烈抖动」。

**文献锚点：**
- [Roch et al., "Optimized Color Sampling for Robust Matting", CVPR 2007](https://www.computer.org/csdl/proceedings-article/cvpr/2007/04270031/12OmNAolGZH) 的核心论点就是「**分析样本的置信度，只有高置信度的样本才参与计算**」——即单点样本不可信。
- 中值 vs 均值：**中值**。理由是 un-mix/outlier 场景下中值是标准选择（scikit-image 的形态学文档、`skimage.filters.rank.median` 的定位都是抗噪）。**均值会被描边上的抗锯齿亮像素污染。**

**半径（我的推断，给出理由）**：
- **首选：全局单一 F**。对「黑描边 + 纯白底」的赛璐璐动漫风，轮廓内侧的颜色**几乎处处一致**（就是描边色）。取「掩膜内 2–3px 环带」的全部像素求**逐通道中位数**，得到一个全局 `F_global`。**这一步就把「最近邻」换成了「几百个像素的统计量」，噪声问题直接消失。**
- **仅当描边颜色不均匀时才做局部细化**（见 5.4），此时用 **3×3 邻域中值**，不要更大——再大就跨过 1–3px 的描边宽度取到填充色了。
- ❌ 不要照搬 rembg 的 `erode_structure_size=10`：那是针对 1024×1024 神经网络掩膜设计的，你的图尺度与内容性质都不同（[rembg bg.py](https://github.com/danielgatis/rembg)）。

**一句话**：`F` 用**全局中位数**，不用最近邻。

### Q3：spiky / ragged alpha edge 有没有已知名字和标准修法？

**没有一个专门叫「spiky alpha edge」的术语。** 但它的成因和标准修法是明确的，分两种，要分开处理：

| 现象 | 术语 | 成因 | 标准修法 | 你的场景 |
|---|---|---|---|---|
| 轮廓上 1px 硬性凹凸 | **jaggies / staircasing / aliasing on silhouettes** | 二值化把连续覆盖率量化 | **几何**：开运算 / 中值滤波去毛刺；**信息**：从原图反解覆盖率 | ✅ 两个都存在 |
| alpha 沿轮廓剧烈抖动 | （无专名，属 **noise in matting**） | 逐像素估计的方差 | 沿轮廓低通（guided filter / 中值） | ✅ 存在 |
| 硬边无过渡 | （无专名） | 掩膜二值化的直接后果 | **feathering**：距离场斜坡或 guided feathering | ✅ 存在 |

**标准修法的三个层级**（按本场景适配度排序）：

1. **【根治】用原图像素反解覆盖率，而不是用掩膜几何。** 依据：SDF anti-aliasing 的全部理论都建立在「边缘的亚像素位置信息必须从别处获得」上——[Chlumský/msdfgen](https://www.fractolog.com/2025/01/msdf-fragment-shader-antialiasing/) 的做法是先生成距离场，`t` 的区间宽度「about as wide as a ... pixel」。在图像 matting 里，「距离场」的等价物就是**原始抗锯齿像素**。你手上正好有它（二值化之前的 `I`），而当前管线把它扔了。**这是本报告最主要的建议。**

2. **【治标·几何】开运算 / 中值滤波去 1px 毛刺。**
   - `sharp().erode(1).dilate(1)`（3×3 方块开运算，sharp ≥ 0.34.0）
   - 或 `sharp().median(3)`
   - 或 CLI：`ffmpeg -vf morpho=mode=open`（可用圆盘 SE），`convert -morphology Open Disk:1`
   - 风险：**会削掉 1px 宽的发丝/睫毛**。必须实测对比。
   - 结构性替代方案（**我的推断**）：**把掩膜上采样 2× 再降采样**（即 2×2 box 超采样）。1px 尖刺会变成 50% 灰阶 alpha 而不是硬性的 in/out，锯齿自然消失，且 1px 发丝保留为半透明。代价只是 4× 的布尔运算。

3. **【平滑】沿轮廓低通 α。**
   - `ffmpeg -vf guided=mode=fast:radius=3:eps=0.01`（本机实测参数见 6.2a）
   - 顺序：**在 unmixing 之后**做，不是在之前。
   - 幅度要克制（见 7.2），r=3 / eps=0.01 是本机默认，也是我推荐的起点。

> **我的推断**：你现在感觉「毛刺是距离场斜坡的锅」，但更准确的说法是——**毛刺是二值掩膜的锅，距离场只是忠实地把它画了出来**。把 `erode/dilate` 或 `median` 加上去能让毛刺变少，但只要 α 仍然由「掩膜边界位置」决定，斜坡的宽度参数怎么调都无法消除它。必须让 α 由 `I` 决定。

### Q4：有没有比闭式解更合适的、同样是「已知背景色 + 粗掩膜」的轻量方案？

**有，就是你在 Q1 里自己推的那个 —— color unmixing / keying。** 它不是闭式解的近似，它**就是**这个特例的精确解（3 方程 3 未知）。

**方案对比（针对你的约束：Node.js ARM64、几十行 JS、无新依赖）**

| 方案 | 是否需要额外依赖 | 代码量 | 能否修 1px 锯齿 | 质量 |
|---|---|---|---|---|
| **逐像素 color unmixing** | ❌ 无 | ~60–90 行 TS | ✅ 能（读回被丢弃的覆盖率） | ⭐⭐⭐⭐ |
| Guided feathering（ffmpeg 1 行） | ❌ ffmpeg 已装 | 1 行 | ⚠️ 抹圆，不纠正 | ⭐⭐⭐ |
| Color unmixing + guided 兜底 | ❌ 无 | ~90 行 | ✅ | ⭐⭐⭐⭐⭐ |
| 距离场精确 EDT 斜坡（Felzenszwalb 两趟） | ❌ 无 | ~40 行（算法） | ❌ 只改斜坡形状 | ⭐⭐ |
| 闭式解 matting | ✅ Python 栈 +200MB | — | ⚠️ 引入新伪影 | ⭐⭐⭐（但有风险） |
| colorkey（ffmpeg 1 行） | ❌ ffmpeg 已装 | 1 行 | ❌（带外硬 alpha） | ⭐⭐（当 baseline） |

**我建议的实现顺序**：

1. **先跑 baseline 对照**（5 分钟，0 代码）：`ffmpeg -i in.png -vf "format=rgb24,colorkey=0xFFFFFF:0.1:0.6" out.png`，和当前输出放一起看。这能立刻验证「unmixing 方向是对的」这个假设——如果 colorkey 的边缘明显比你现在的干净，方案就对了。
2. **再上 JS 版 unmixing**（半天，~80 行）。这是终态。
3. **可选：叠一层 guided filter**（1 行 ffmpeg 或 20 行 JS）收尾。

---

## 九、事实与推断的分界（重要）

### 属于**文献/官方文档/实测**的陈述

- 3 方程 7 未知、trimap 必须窄、trimap 法在大量 mixed pixel / 孔洞上困难 — Levin TPAMI 2008 原文
- 「背景已知会消除一部分歧义」 — IPOL 预印本原文
- `α_o = 1 − B_f / B_k` 的特解推导 — NUS CS5245 教材原文
- 逐通道 unmix 公式 `α=(a₁−c₁)/(1−c₁)` / `α=1−a₁/c₁` 与 un-mix `b=(a₂−c₂)/α+c₂` — clahey 在 GEGL 提交中的原始推导
- 「差值映射到 α；clip black/clip white」 — NUS CS4340
- guided filter 的 a/b 公式、ε 的作用、r=60/ε=1e-6（feathering）、r=16/ε=0.01（增强）、r=4/ε=0.04/s=4（fast） — He 等人原文与其官方代码
- FFmpeg `guided`/`colorkey`/`despill`/`morpho`/`dilation`/`erosion` 的全部参数与语义 — FFmpeg 官方文档 + **本机 `ffmpeg -h filter=...` 实测**
- sharp `erode`/`dilate` 自 v0.34.0 起提供、底层是 `(2w+1)²` 全零矩阵 + `vips_morph` + `invert()` — sharp changelog + **我解包 npm tarball 读 `src/operations.cc:479-497` 实测**
- sharp 缺距离变换/开闭单步 API — **我通读 `sharp@0.34.5` 的 `lib/index.d.ts` 全量方法列表确认**
- libvips 形态学的极性约定与「去单像素」用途 — libvips 官方 morphology 文档
- SDF anti-aliasing 的 `clamp(d/fwidth(d)+0.5,0,1)` 与 `clamp(screenPxDistance+0.5,0,1)`、`t` 区间约一像素宽 — msdfgen README / Chlumský 论文，经 Fractolog 引用
- 精确 EDT 的 O(n) 抛物线下包络算法 — Felzenszwalb & Huttenlocher, Theory of Computing 2012
- onnxruntime-node 支持 Linux arm64 CPU EP — unpkg 上的 v1.26.0 README
- pymatting 的 numba→llvmlite 在 aarch64 上的编译问题 — rembg issue #131
- GIMP 关于「灰前景会变半透明 / opacity threshold 0.5」和「transparency>0 不可逆」的警告 — GIMP 官方文档
- Photoshop Decontaminate Colors / halo vs fringing 的区分 — Adobe 社区文档
- rembg 的 `estimate_alpha_cf` + `erode_structure_size=10` + post_process(`opening(disk(1))`→`gaussian(2)`→threshold 127) — rembg `bg.py` 源码
- ToonOut 在 1,228 张动漫图上把像素精度从 95.3% 提到 99.5% — arXiv:2509.06839
- 本机 ffmpeg 6.1.1 arm64 / ImageMagick 6.9.12-98 arm64 / 无 vips CLI — **本机实测**
- ImageMagick CVE-2026-55595、CVE-2026-56370 — NVD / OpenCVE

### 属于**我的推断**的陈述（无直接文献对应，请自行验证）

1. `α = ‖I−B‖/‖F−B‖` 与逐通道解的等价性推导，以及「比逐通道稳健」的论证（代数正确，稳健性论证是推理）
2. 「二值掩膜无法修锯齿，距离场只是忠实复现」——基于 Levin 的欠约束性 + SDF AA 原理的推理
3. 所有具体数值：δ=8、α_min=0.3、采样半径 2–3px、过渡带 `dilate(2)/erode(2)`、guided r=2–4 / eps=0.01
4. 「赛璐璐动漫的轮廓描边色近似全局常量」——基于该画风的常识，**建议你先在几张图上统计验证**
5. F_local 迭代细化（un-mix → 中值 → 重算 α）的两轮收敛方案
6. 「2×2 超采样掩膜」作为保发丝的去毛刺替代方案
7. 全部耗时估算（`<50ms`、数秒等）
8. 过度杀伤的量化对比表

---

## 十、最终建议

### 最小改动版（约 15 行改动，1 小时内可完成）

**保留现有全部 6 步，只替换第 5 步。**

```
第 5 步：距离场斜坡  →  逐像素 color unmixing
```

```ts
// 1) F：掩膜内 2–3px 环带逐通道中位数
// 2) 逐像素：a = ‖I−B‖ / max(‖F−B‖, 8)，仅在 dilate(2)/erode(2) 环带内生效
// 3) un-mix：α<0.3 用 F，其余用 (I−(1−α)B)/α
// 4) .median(3) 收尾
```

**预期收益**：消除白边（un-mix 天然）、α 显著更准、**锯齿改善但不彻底**。
**风险**：几乎没有。不引入新依赖，不改管线结构。
**适合**：先验证假设是否成立。

### 最佳质量版（约 90 行，半到一天）

```
最小改动版
  + .erode(1).dilate(1) 去 1px 毛刺（先实测发丝是否被削）
  + ffmpeg guided=r=3,eps=0.01 或手写沿轮廓平滑
  + F_local 迭代细化（若描边色不均匀）
  + resize 换 kernel: lbb（防 halo）
  + round-trip 一致性单元测试
```

**预期收益**：锯齿 + 白边同时解决，接近 Photoshop "Refine Edge" 观感。
**风险**：中（发丝被削）。用「中值 vs 开运算」二选一 + 2× 超采样备选来控制。

### 明确不推荐的路

| 路线 | 不推荐理由 |
|---|---|
| 闭式解 matting（erode-N trimap） | 违背无 Python 约束；trimap 法在孔洞/凹陷处已记录有伪影；1–3px 有效信息下平滑性假设最差；成本秒级～分钟级，收益边际 |
| RMBG-1.4 / U²-Net / BiRefNet / BEN2 | 语义分割模型，而你的大形状已经对了；+176MB～数百 MB；ARM64 CPU 数秒；**只能追平现有掩膜** |
| SAM | 2.4GB，ARM64 CPU 数十秒起，严重过剩 |
| 引入 `colorkey` 作为终态 | 圈外硬 alpha，无法表达你的 1–3px AA 带 |
| `despill` 滤镜 | 为绿/蓝幕设计，溢出方向与白底相反 |

### 一句话

> **背景已知 ⇒ matting 就退化成一次逐像素的除法。** 别用求解稀疏线性系统的方式去解一个已经可以逐像素精确解出来的方程。把二值化扔掉的覆盖率从原图像素里读回来，锯齿自然消失——因为锯齿本来就是量化误差的化石。

---

## 附录：全部来源

**Matting 理论**
- Levin, Lischinski, Weiss. *A Closed Form Solution to Natural Image Matting*. TPAMI 30(6), 2008. https://people.csail.mit.edu/alevin/papers/Matting-Levin-Lischinski-Weiss-PAMI.pdf
- He, Rhemann, Rother, Tang, Sun. *A Global Sampling Method for Alpha Matting*. CVPR 2011. http://mmlab.ie.cuhk.edu.hk/archive/2011/cvpr11matting.pdf
- Ranjbar, Abdelaziz, Jauhar. *A Closed Form Solution to Natural Image Matting* (IPOL preprint). http://www.ipol.im/pub/pre/532/preprint.pdf
- NUS CS5245. *Theory of Matting*. https://www.comp.nus.edu.sg/~cs5245/lecture/matte.pdf
- NUS CS4340. *Digital Compositing*. https://www.comp.nus.edu.sg/~cs4340/lecture/compositing.pdf
- Aksoy, Aydin, Pollefeys. *Designing Effective Inter-Pixel Information Flow for Natural Image Matting*. CVPR 2017. https://openaccess.thecvf.com/content_cvpr_2017/papers/Aksoy_Designing_Effective_Inter-Pixel_CVPR_2017_paper.pdf
- Gastal, Oliveira. *Shared Sampling for Real-Time Alpha Matting*. CGF 29(2), 2010. https://www.inf.ufrgs.br/~eslgastal/SharedMatting/
- Chuang et al. *A Bayesian Approach to Digital Matting*. CVPR 2001.
- Bai, Sapiro. *Laplacian Matting*. IJCV 2008.

**Keying / Color Unmixing**
- Yaksoy, Matusik, Guttag. *Interactive High-Quality Green-Screen Keying via Color Unmixing*. ACM TOG 35(6), 2016. https://yaksoy.github.io/papers/TOG16-keying.pdf
- GIMP 3.2. *Color to Alpha*. https://docs.gimp.org/3.2/en/gimp-filter-color-to-alpha.html
- GEGL `color-to-alpha`（含 clahey 的算法推导）. https://mail.gnome.org/archives/commits-list/2011-August/msg08655.html
- Porter, Duff. *Compositing Digital Images*. SIGGRAPH 1984. https://keithp.com/~keithp/porterduff/p253-porter.pdf
- Smith & Blinn. *Blue Screen Matting*. 1996.

**滤波 / 抗锯齿 / 距离变换**
- He, Sun, Tang. *Guided Image Filtering*. ECCV 2010. https://people.csail.mit.edu/kaiming/publications/eccv10guidedfilter.pdf
- He, Sun. *Fast Guided Filter*. arXiv:1505.00996. https://arxiv.org/abs/1505.00996
- atilimcetin/guided-filter（He 官方代码的广泛移植，含各示例参数）. https://github.com/atilimcetin/guided-filter
- Felzenszwalb, Huttenlocher. *Distance Transforms of Sampled Functions*. Theory of Computing 8(23), 2012. https://theoryofcomputing.org/articles/v008a019/v008a019.pdf
- Fractolog. *MSDF Fragment Shader Antialiasing*（含 msdfgen README 原文）. https://www.fractolog.com/2025/01/msdf-fragment-shader-antialiasing/
- Chan. *Antialiasing*（prefiltered lines）. https://people.csail.mit.edu/ericchan/articles/prefilter/

**工具 / 库**
- sharp API: https://sharp.pixelplumbing.com/api-operation/ ; interpolators: https://sharp.pixelplumbing.com/api-output/
- sharp v0.34.0 changelog: https://sharp.pixelplumbing.com/changelog/v0.34.0/ ; issue #1719: https://github.com/lovell/sharp/issues/1719
- libvips morphology: https://www.libvips.org/API/8.16/libvips-morphology.html ; 函数索引: https://www.libvips.org/API/current/function-list.html
- FFmpeg 滤镜文档: https://ffmpeg.org/ffmpeg-filters.html （guided / colorkey / despill / morpho / dilation / erosion / alphamerge / alphaextract）
- onnxruntime-node v1.26.0 README: https://unpkg.com/onnxruntime-node@1.26.0/README.md
- @imgly/background-removal-node: https://github.com/imgly/background-removal-js
- rembg 源码 `bg.py`: https://github.com/danielgatis/rembg ; ARM64 安装问题 #131: https://github.com/danielgatis/rembg/issues/131
- pymatting alpha estimation 文档: https://pymatting.github.io/alpha.html ; issue #21 (block artifacts / epsilon): https://github.com/pymatting/pymatting/issues/21
- MarcoForte/closed-form-matting: https://github.com/MarcoForte/closed-form-matting
- prbach/closed-form-matting (sparse CG 实现): https://github.com/prbach/closed-form-matting
- Roch et al. *Optimized Color Sampling for Robust Matting*. CVPR 2007. https://www.computer.org/csdl/proceedings-article/cvpr/2007/04270031/12OmNAolGZH
- Chen, Li, Tang. *KNN Matting*. TPAMI 2013.

**模型**
- ToonOut. arXiv:2509.06839. https://arxiv.org/abs/2509.06839
- BEN / BEN2: https://huggingface.co/PramaLLC/BEN
- Bria RMBG-1.4 (HuggingFace model card)
- microsoft/onnxruntime#27760 (aarch64 CUDA wheels): https://github.com/microsoft/onnxruntime/pull/27760
- piwheels: https://piwheels.org/

**CVE（本机 IM 6.9.12-98 相关，非本场景）**
- https://app.opencve.io/cve/CVE-2026-55595
- https://nvd.nist.gov/vuln/detail/CVE-2026-56370

---

## 实测复核（2026-09-30，读完上面再看这段）

**样本**：`/tmp/senren-raw/{2d-a,60,61}.png`，真实后端出的三张立绘原始下载字节。
`2d-a.png` 实际是 JPEG 套了 `.png` 后缀（A/B 两侧都用同一份 round-trip 后的 buffer，coverage 才能对齐）。

**指标 1 · 轮廓 alpha 抖动**：沿每条竖直轮廓段取「第一个半透明像素」的 alpha 连成序列，算标准差。

```
2d-a.png   旧 35.1  闭式解 45.4     段数 440 / 848
60.png     旧 38.6  闭式解 42.7     段数 900 / 1188
61.png     旧 31.9  闭式解 37.8     段数 787 / 1041
```

**指标 2 · 轮廓几何粗糙度**：逐行取最左/最右前景像素的 x，算二阶差分绝对值的均值（角点 |Δ|>3 跳过）。
这个量只反映「轮廓线走得多不平」，与 alpha 灰阶无关。

```
2d-a.png   源图 0.487   旧 0.487   闭式解 0.487
60.png     源图 0.482   旧 0.478   闭式解 0.474
61.png     源图 0.459   旧 0.489   闭式解 0.457
```

#### 三个坑（都是本机实打实踩的）

1. **一开始的 −44% 是假的。** 实现里 `solveAlpha` 返回 0..1 的比例，调用方直接写进 0..255 的
   `Uint8Array`，覆盖率 < 0.6 的边界像素被截断成 **alpha 0（整条半透明带被抹掉）**。
   边界带消失 ⇒ 「第一个半透明像素」变少 ⇒ 抖动指标下降。修成 `Math.round(255 * ratio)` 后，
   指标从 19.6 反弹到 45.4，**比旧的还差**。指标自身被改动「偷」了，必须对照几何指标看。

2. **合成夹具在缩放面前会说谎。** 1px 宽的抗锯齿列经 8x / 13.3x lanczos 后被过冲和展宽，
   单列探针读出来的值与覆盖率无关（旧新都读 172 / 255）。要量 alpha 就得让
   `scale = min(画布宽/bbox宽, 画布高/bbox高)` **恰好等于 1**——
   造一个「200x1920 的人形放在 400x2120 的白底上」即可，bbox 200x1920 落 1080x1920 画布，
   `scale = min(5.4, 1.0) = 1`，完全不过重采样。

3. **查文献给的推荐要自己量。** 本文第十章推荐的 F = 全局中位数（取内圈 2–3px 环带）实测是反效果：
   毛刺 2d-a 10.51→11.90、60 11.31→11.88、61 9.94→10.47。原因是立绘有**白衣**，
   白衣最外圈本身就是白的，环带中位数被拽向底色，`B−F → 0`，反解整个塌掉。
   同理，**3x3 中值滤波**两种都试过：滤 alpha 带 → 抖动 19.6→29.0（更差，它把第一个部分覆盖像素拉离真值）；
   滤二值掩膜 → 粗糙度 0.621→0.612、抖动 29.0→29.1（更差，中值去的是孤立毛刺不是对角阶梯）。

#### 结论

文献没错，**闭式解确实在几何上更忠实**（61 那张 0.457 对上源图 0.459 是三张里最贴的一次）。
但「忠实」在这里是负资产：模型在 768px 上画的线本来就有锯齿，忠实还原 = 把锯齿也忠实放大 1.406 倍。
旧公式之所以抖动低，是因为 `max(色差项, dist/2)` 给边界带垫了 128 的地板压方差——
代价是深色背景上一圈白边晕。用户抱怨的是刺，不是晕，拿晕换刺是净负。

**要真解决只有两条路**：① 提高出图分辨率（`imageSize: "4k"`，未测）；
② 主动平滑轮廓（会啃掉 1px 发丝，用户已否决）。
