# 动漫风格 VN 立绘素材来源调研报告（补编）

> 调研日期：2026-10-02  
> 调研目的：为 `library/characters/` 补充**日系二次元赛璐璐动画风（anime cel-shading）角色立绘**，要求 **开箱即透明背景、单角色多表情差分**，并对许可做两档处理：
> - **A 档**：CC BY 4.0 等明确允许**原文件再分发**的来源（媒体文件同样不受 `.gitignore` 限制）；  
> - **B 档**：作者自述 "royalty free" 等**禁止原文件再分发**的来源——因 `library/` 进 git、随剧目包导出，**必须将媒体文件置于 `.gitignore` 之外**，仅作本机自用，`meta.json` 仍需记录许可与出处。

## 一、背景回顾

上一轮素材调研（`docs/features/260930-asset-library/galgame-asset-sources.research.md`）已系统梳理 itch.io/OGA 等渠道的立绘包，结论为：
- 免费立绘包**极少提供「开箱即透明」**（常为分层部件或 PSD-only）；
- 极少提供「多表情差分」（常仅 1–3 张）；
- 极少许可明确（常为营销词 "royalty free"，实际按 all-rights-reserved 处理）；
- 画风常为西方写实、厚涂油画或像素风，**不符合日系二次元**。

在 **B 档**（禁止原文件再分发）里，确实存在质量上买的选项（如 Potat0Master、Trines Studio、Violetpixel13），但因当时「资源库必进 git」的理解，被直接排除。

用户在明确后续工作中指出：
> 「禁止再分发的也可以加。（在我们文档记一下）重点：这些**不是**我们会随仓库跟踪的，是gitignore的！重点是modlens确认好适合于日系galgame（而非western）」

即：**只要媒体文件被 `.gitignore` 挡在版本库外，禁再分发的素材亦可入库**；元数据(`meta.json`)仍须写清许可、出处、是否允许再分发。

## 二、调研结果与入库清单

以下 11 个角色（A 档 4 个 + B 档 7 个）经 **modlens_read_image** 逐张确认画风为日本 anime digital illustration（软阴影、大眼、清晰线稿，非西方写实/厚涂/像素风），并用自写 probe 验证 **RGBA 真透明**（alpha 直方图 min=0、max=255）。

所有来源均经由提供的 **itch.io 下载配方**（见 `docs/features/260930-asset-library/galgame-asset-sources.research.md` §5）完整下载、解包，中间无人工修改（仅按出表重命名便于库内引用）。

| 档位 | 角色 ID | 原始出处 | 许可证 | 是否允许原文件再分发 | 角色数 × 表情数 | 分辨率 | 文件格式 | 画风 modlens 判定 |
|------|---------|----------|--------|----------------------|----------------|--------|----------|-------------------|
| A    | platonic_a | Platonic Game Studio「Free Visual Novel Sprites Pack」（art by NURROCHI） | CC BY 4.0 | ✅ 是 | 1 × 3 | 2149×3035 | PNG | Japanese anime digital illustration with soft cel-shading, glasses-wearing schoolgirl |
| A    | platonic_b | 同上 | CC BY 4.0 | ✅ 是 | 1 × 3 | 2149×3035 | PNG | 同上（male） |
| A    | platonic_c | 同上 | CC BY 4.0 | ✅ 是 | 1 × 4 | 2149×3035 | PNG | 同上（hijab girl） |
| A    | platonic_d | 同上 | CC BY 4.0 | ✅ 是 | 1 × 3 | 2149×3035 | PNG | 同上（purple-haired girl) |
| B    | potato_chinatsu | Potat0Master「Free Characters for Visual Novels Set A01 – School Ver.」 | 作者自述 royalty free（禁止原文件再分发） | ❌ 否（媒体 gitignored） | 5 × 17（夏/冬各 1套） | 720×1080 | PNG | Japanese visual novel (galgame) anime style，五人共用白衬衫+深蓝格纹领结的日式夏制服，大眼少鼻嘴 |
| B    | potato_kanako | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 |
| B    | potato_kohaku | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 |
| B    | potato_tomomi | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 |
| B    | potato_ume | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 |
| B    | potato_kioshi | Potat0Master「Free Character Sprite for Visual Novels – Kioshi & Haruo」 | 同上 | 同上 | 28（校服 14×表情 + 毛衣 14×表情） | 580×1080（校服）/ 411×1080（毛衣） | PNG | 日本动画风 + 日式夏季校服/毛衣，偏柔化上色 |
| B    | potato_haruo | 同上 | 同上 | 同上 | 21（校服 7× + 校服alt 7× + 执事 7×） | 580×1080（校服）/ 411×1080（执事） | PNG | 同上（偏硬赛璐璐）|

> **说明**：
> - **A 档**（Platonic）来源页明确标注 **CC BY 4.0** 许可证，并在 README 写「Please Credit us when you use our art.」，允许商用、修改、再分发，唯一要求署名。  
> - **B 档**（Potat0Master）作者在条款页写明：  
>   > “These character sprites have a **royalty free** license. Meaning, you can use these character sprites for both personal and commercial projects, as many times as you want. Giving credit is not necessary but would be appreciated.  
>    You can edit and modify these images. However, you **cannot resell or distribute the images in the form that it is downloaded or even when it is modified**.”  
>   因 `library/` 进 git、随剧目包导出＝素材原文件被再分发，故需将媒体文件（*.png）置于 `.gitignore` 之外，仅作本机自用。

## 三、许可档位记录（与资源库对应关系）

在 `library/characters/<id>/meta.json` 中，已使用以下字段作存档：

```jsonc
{
  "license": "CC-BY-4.0" | "Royalty Free（作者自定条款）",
  "licenseUrl": "https://creativecommons.org/licenses/by/4.0/" | "https://lemmasoft.renai.us/forums/viewtopic.php?t=61937",
  "attribution": "...",               // 仅 A 档有，B 档为空或写明作者自述条款
  "licenseTier": "A" | "B",          // 自定字段，供审计快速查证
  "source": "https://...",          // 原始出处 URL
  "redistributable": true | false,   // 自定字段，A 档 true，B 档 false
  ...
}
```

`licenseTier`、`redistributable` 为项目本地约定，**不参与官方 AssetMeta 解析**，仅落在磁盘文件中，便于：
- 人工审计：`grep -r "licenseTier" library/characters/` 一眼看出哪些是 B 档；
- 脚本核验：确认所有 B 档条目媒体文件确实被 `.gitignore` 挡住；
- 向用户说明：**我们确实入了「禁止再分发」的素材，但媒体文件未进版本库**，符合「在我们文档记一下」的要求。

## 四、后续可行方向

1. **继续补 B 档**：Potat0Master 同作者的 Nozomi、Keiko、Starter Bundle（Shion/Daiki）等均符合同一许可模型，表情更丰富、服装更多，可按相同流程下载并写 meta.json。
2. **OGA 种子回溯**：`lemmasoft-assets-portraits` 中列的 Kainico、Kyuu、RLinZ 等 CC BY 画师若能绕过 Lemma Soft Cloudflare 挡（403），可尝试使用 `camoufox` 与额外反爬手段（如更换 UA、加 cookie）进行验证下载；目前因网络层面不可达而未纳入本轮入库。
3. **背景图二次元化**：现有背景库仍以实拍照片/视差图为主，如需真正的日系二次元背景，可参考 `docs/features/260930-asset-library/galgame-asset-sources.research.md` 中已验证可用的 Uncle Mugen、Pandita Studio、Unicorn Creates 等来源（背景图亦分 A/B 档，其中 Uncle Mugen 为作者自然语言许可、可再分发）。

---  
报告完毕。接下去请见：
- `library/characters/` 下新建的 11 个角色条目（含 meta.json 与 PNG）；
- `git status --short --untracked-files=all library/characters/` 可见仅 11 个 meta.json 未进版本库，全部 .png 已被 `.gitignore` 挡住；
- 对 B 档媒体执行 `git add` 会被挡下并提示：
  ```
  The following paths are ignored by one of your .gitignore files:
  library/characters/potato_chinatsu/chinatsu_summer_angry.png
  hint: Use -f if you really want to add them.
  ```

> **⚠️ 这层保护是约定，不是硬闸**：`.gitignore` 挡的是误提交，`git add -f` 随时能绕过。B 档素材因此**不能**被当作可自由再分发的资产对外打包——剧目包导出（`assets/` 拷贝）仍然是把素材文件分发出去，这一条在对外分发剧目时依然受限。