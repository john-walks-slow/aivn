# 调研任务：可再分发的日系赛璐璐风 VN 立绘（立ち絵）来源

> 发起日期：2026-10-01
> 背景：stage-ai 资源库现有立绘画风不对口，需要补一批**真正的日系二次元赛璐璐动画风**（大眼、清晰线稿、平涂+二值阴影）角色立绘当示例。

## 1. 现有素材为什么被判「不够日系二次元」

已入库的两家（见 `../260930-asset-library/galgame-asset-sources.research.md` §3）：

| 来源 | 许可 | 画风问题 |
|---|---|---|
| **Breezy** `breezy-the-cat.itch.io/visual-novel-sprites` | CC0 | 画风偏欧美/厚涂向的成年向 galgame 角色，无学生制服 |
| **onboroo** `onboroo.itch.io/visual-novel-sprite-pack` | CC-BY-4.0 | 原调研已自评「**画风偏厚涂写实而非纯赛璐璐**」，2200×3500 但上色是 painterly |
| 本项目自生成（nanase） | 自有 | AI 生成味重，构图/光影不是赛璐璐 |

## 2. 硬约束（不满足即出局，按顺序筛）

1. **许可必须允许「原始素材文件本身」被再分发。** stage-ai 的 `library/` 进 git、随剧目包导出 = 素材文件被原样再分发。
   - ✅ 接受：CC0、CC-BY 3.0/4.0、OGA-BY 3.0、以及**明确写了「可自由再分发 / no strings attached / feel free to use for whatever purpose」的作者自然语言许可**
   - ⚠️ 慎用：CC-BY-SA（会让整库被迫同许可）
   - ❌ 排除：「royalty free」「free to use」这类营销词（itch.io 官方明确说它没有法律定义，默认按 all-rights-reserved 处理）、禁止转载的日文站（ぴぽや/みんちりえ/Monochi/Tyrano/BOOTH）、booru 系、rip 自商业游戏的合集（The Spriters Resource、DDLC、Ren'Py the_question demo）
2. **画风必须是日系二次元赛璐璐**（anime cel / 赛璐璐上色、大眼、平涂阴影、清晰线稿）。纯欧美写实、厚涂油画、3D 渲染、像素风一律排除。
3. **开箱即透明背景 PNG 或 WebP**，RGBA 真透明（alpha 有 0 和 255）。**不接受分层部件（body/eyes/hair 拆件）**——本项目要的是开箱差分。也不接受只有 PSD 的。
4. **多表情差分**（一个角色 ≥4 个表情），单张立绘价值低。
5. 分辨率 **≥ 900px 高**（不要 400×500 那种）。
6. 加分：日式学生制服；日本画师风格的原创角色（非转写已有商业作品角色，避免 IP 问题）。
7. 加分：标注了 `No generative AI was used`。
8. **不要 AI 生成的**（本项目画风锚点是手绘赛璐璐，AI 味素材会把整个库带偏）。

## 3. 已知但已被排除的上游，别重复提

- Potat0Master（`potat0master.itch.io/free-characters-for-visual-novels-set-a01`）：画风最对口（夏/冬校服 × 17 表情），但条款禁原文件再分发 → 排除
- Selavi Games：$20 + 禁再分发
- residentrabbit：CC0 但是分层部件
- Machaon Maackii：分辨率过低；cucurbitapepo：PSD-only；ratarios Mei 免费版：CC BY-NC 禁商用
- Uncle Mugen / Alte：那是背景不是立绘

## 4. 前序工作

本项目在 2026-09-30 做过一轮素材来源调研，报告在
`docs/features/260930-asset-library/galgame-asset-sources.research.md`
（670 行，涵盖背景与立绘全部候选、逐条许可分析、下载配方、排除理由）。
那份报告是本轮调研的起点，请先读它，再在其基础上推进——已有的结论不必重复验证，
但**画风不对口这一条要重新审视**：立绘那节（§3）推荐的 Breezy 与 onboroo，
用户实际看过后判定「太不日系二次元」。

## 5. 本项目已验证可用的 itch.io 下载配方

itch.io 完全可脚本化（上一轮实测批量下载 12 个包）。给需要实测的候选直接可用的配方：

```bash
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

# 配方 A：免费直下
curl -s -c jar -A "$UA" "https://<user>.itch.io/<slug>" -o page.html
CSRF=$(grep -oE 'csrf_token" value="[^"]*"' page.html | head -1 | sed 's/.*value="//;s/"//')
UP=$(grep -oE 'data-upload_id="[0-9]+"' page.html | head -1 | grep -oE '[0-9]+')
URL=$(curl -s -b jar -X POST "https://<user>.itch.io/<slug>/file/$UP?source=view_game&as_props=1" \
      -H "X-Requested-With: XMLHttpRequest" -A "$UA" \
      --data-urlencode "csrf_token=$CSRF" \
      | python3 -c "import sys,json;print(json.load(sys.stdin)['url'])")
curl -s -A "$UA" "$URL" -o out.zip     # R2 预签名 URL，60 秒内必须取回

# 配方 B：PWYW（Name your own price），$0 跳过购买
curl -s -c jar -A "$UA" "https://<user>.itch.io/<slug>/purchase" -o purchase.html
CSRF=$(grep -oE 'csrf_token" value="[^"]*"' purchase.html | head -1 | sed 's/.*value="//;s/"//')
DURL=$(curl -s -b jar -X POST "https://<user>.itch.io/<slug>/download_url" \
       -H "X-Requested-With: XMLHttpRequest" -A "$UA" \
       --data-urlencode "csrf_token=$CSRF" \
       | python3 -c "import sys,json;print(json.load(sys.stdin)['url'])")
curl -s -b jar -A "$UA" -e "https://<user>.itch.io/<slug>/purchase" "$DURL" -o list.html
# 再对 list.html 里的每个 upload_id 重复配方 A 的 /file/<upload_id>
```

环境与坑（本机已装 `unar`、`convert`、`python3`；出站需走 `http_proxy=http://127.0.0.1:7890`）：

| 坑 | 解法 |
|---|---|
| RAR5 包 | `unar -q -f x.rar`（`7z` 23.01 对 RAR5 报 `Unsupported Method` 并**静默生成 0 字节文件**） |
| itch.io 429 | 45 秒冷却 + 真实 Chrome UA + 请求间隔 `sleep 2`+ |
| CSRF token 含 `+` `/` | 必须 `--data-urlencode`，用 `-d` 会 `invalid token` |
| CSRF 与 cookie 必须同会话 | 抓页 `curl -c jar`，POST `curl -b jar` |
| PWYW 别用 `/purchase?skip_purchase=true` | 会报 `Please select a valid payment method`，正确端点是 `/download_url` |
| WebP 透明度 | VP8X 标志位 `0x10` |
| PNG 透明度 | IHDR offset 25 字节：`6`=RGBA / `4`=灰度+alpha；**别只看色彩类型**，要 zlib 解 IDAT 统计 alpha 直方图（min=0 且 max=255 才是真透明） |
| OGA 伪 502 | 重试即可，不要据此判断站点挂了 |
| 磁盘 | 下载完解包后清 `/tmp`，别把 `/` 顶满 |

## 6. 交付要求

**输出一份 markdown 报告到 `docs/features/261001-anime-sprites/261001-anime-sprite-sources.research.md`，并在回复里只给这个文件的链接 + 一段 5 行以内的结论摘要。**

报告需覆盖：

1. **推荐入库的来源（最多 5 个）**，每个给完整表格：下载页 URL、许可原文引用、是否允许原文件再分发、**你实测到的**文件清单与数量、角色数 × 表情数、分辨率、格式、alpha 真伪实测数据、画风描述（基于你实际看到的图，不是页面宣传语）、内容适宜性。
2. **已排除的来源**及排除理由（逐条对 §2 的硬约束）。
3. **下载脚本**：如果报告里的推荐来源需要下载，把可复现的脚本写进同目录的 `fetch-sprites.sh`（或 .py），本轮会直接执行。
4. 所有结论区分 **[实测]** 与 **[页面声明]**。

**要求实测**：对每个推荐来源，实际下载、解包、读 PNG IHDR / WebP VP8X、zlib 解 IDAT 统计 alpha 直方图，并在视觉上确认画风。真拿不准画风的就别推荐。