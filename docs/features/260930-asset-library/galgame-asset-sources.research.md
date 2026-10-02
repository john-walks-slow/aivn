# Galgame / Visual-Novel 素材来源调研报告

> 调研日期：2026-09-30  
> 调研目标：为 stage-ai 应用级素材资源库（`library/{backgrounds,cg,characters}`）寻找**可合法获取、可再分发、高质量的免费二次元 / galgame 风格素材**。  
> 覆盖两类需求：**① 动漫风格 16:9 场景背景（无人/空景）**、**② 透明背景人物立绘（立ち絵）含多表情差分**。  
> 所有结论中标注 **[实测]** 的条目均由本轮实际下载、解包、逐字节读取验证（PNG IHDR 色彩类型、WebP VP8X alpha 标志、alpha 直方图、目录树），非仅凭页面描述。

---
**2026-10-02 补充**：  
用户后来明确：**禁止原文件再分发的素材亦可入库，但须将媒体文件（*.png、*.jpg 等）置于 `.gitignore` 之外**，仅作本机自用，元数据(`meta.json`)仍需完整记录许可、出处、是否允许再分发。  
因此原报告中因「禁止再分发」而直接排除的立绘包（如 Potat0Master、Trines Studio、Violetpixel13 等）可重新评估为 **B 档可用**，具体见  
`docs/features/261001-anime-sprites/261001-anime-sprites.summary.md` 中的许可档位说明与入库清单。  
以下正文为原调研结论，未改动，供历史参考。

---