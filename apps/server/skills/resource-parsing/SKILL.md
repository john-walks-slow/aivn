---
name: resource-parsing
description: 读用户投进剧目里的原作时的做法：清点 resources/ → 按格式抽成纯文本 → 按章分段读、边读边落笔记 → 收成改编纲要。含 epub/docx/html/pdf/txt 各自的抽取命令与无外部工具时的兜底、分段读取的尺寸、笔记与改编纲要点落哪。当用户发来附件（小说、电子书、网页、剧本）要改编成视觉小说、或要基于某部作品做同人时使用。
user-invocable: true
---

# resource-parsing（把用户给的原作读进来）

用户发来的附件落在剧目目录的 `resources/`（消息里带 `[附件] 名字（大小，格式）→ resources/…`）。
**原件只读**：别覆盖、别改名，一切派生文件写到 `resources/derived/<原名>/`。

一条铁律：**正文只在文件里流转**。进你上下文的永远只有目录、分段正文和笔记——
一本 30 万字的小说整篇读进对话，这一轮就直接撑爆了。

## 0. 先看命令行有没有开

抽 epub/docx/pdf 要命令行。没开（消息里没有命令行那一章、或 `bash` 调不动）就先停下，
让用户去工坊「Agent」页打开「命令行」——转成 `.txt` 的纯文本资源另说，那种直接 read 就行。

开工先探一次手上有什么工具：

```bash
for t in pandoc unzip python3 tar pdftotext ebook-convert; do
  command -v "$t" >/dev/null && echo "有 $t" || echo "没有 $t"
done
```

三者至少有一个就能覆盖绝大多数格式：`pandoc`（最省事）/ `python3`（兜底最广）/ `unzip`（只解容器）。

## 1. 清点：先看是什么，再决定怎么拆

```bash
ls -l resources/
file resources/*            # 没有 file 就看扩展名
head -c 300 "resources/某本书.epub" | strings | head -5
```

同时量一下体量——这个数决定要分几段：`wc -c resources/某本书.txt`，或者抽出纯文本后再 `wc -l`。
**十万字以上就当长篇处理**：先出目录/章节索引，再一章一章读，别指望两三次读完。

## 2. 抽成纯文本

```bash
mkdir -p "resources/derived/某本书"
```

### 路线 A：有 pandoc（一行一条）

```bash
pandoc -f epub -t plain     "resources/某本书.epub" -o "resources/derived/某本书/full.txt"
pandoc -f docx -t markdown  "resources/某本书.docx" -o "resources/derived/某本书/full.md"
pandoc -f html -t plain     "resources/某页.html"   -o "resources/derived/某页/full.txt"
```

pandoc 认 epub / docx / html / markdown / txt，**不认 pdf 与 mobi**。它给的 plain 会保留章节标题行，
拿来当章节索引正合适。

### 路线 B：有 python3（没有 pandoc 时用这段）

把它存成 `resources/derived/extract.py` 再跑（只依赖标准库）：

```bash
cat > resources/derived/extract.py <<'PY'
#!/usr/bin/env python3
"""epub / docx / html / txt → 纯文本。用法：extract.py <输入> [输出]"""
import html, re, sys, zipfile
from pathlib import Path

BLOCK = re.compile(r"</(?:[\w-]+:)?(?:p|div|h[1-6]|li|tr|section|blockquote)\s*>", re.I)
BREAK = re.compile(r"<(?:(?:\w+:)?br|(?:\w+:)?p)\b[^>]*/?>", re.I)
DROP = re.compile(r"<(head|script|style)\b.*?</\1\s*>", re.I | re.S)
TAG = re.compile(r"<[^>]+>")


def to_text(markup: str) -> str:
    markup = DROP.sub("", markup)
    markup = BLOCK.sub("\n", BREAK.sub("\n", markup))
    text = html.unescape(TAG.sub("", markup))
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    return re.sub(r"\n\s*\n\s*\n+", "\n\n", text).strip()


def xhtml_in_spine(zf: zipfile.ZipFile) -> list[str]:
    names = zf.namelist()
    fallback = sorted(n for n in names if n.lower().endswith((".xhtml", ".html", ".htm")))
    container = next((n for n in names if n.lower().endswith("meta-inf/container.xml")), None)
    if container is None:
        return fallback
    root = re.search(r'full-path="([^"]+)"', zf.read(container).decode("utf-8", "replace"))
    opf_name = root.group(1) if root else ""
    if opf_name not in names:
        return fallback
    opf = zf.read(opf_name).decode("utf-8", "replace")
    href_of = {}
    for tag in re.findall(r"<item\b[^>]*>", opf):
        i, h = re.search(r'\bid="([^"]+)"', tag), re.search(r'\bhref="([^"]+)"', tag)
        if i and h:
            href_of[i.group(1)] = h.group(1)
    base = opf_name.rsplit("/", 1)[0] + "/" if "/" in opf_name else ""
    out = []
    for tag in re.findall(r"<itemref\b[^>]*>", opf):
        if 'linear="no"' in tag:
            continue
        ref = re.search(r'\bidref="([^"]+)"', tag)
        href = href_of.get(ref.group(1)) if ref else None
        if href and base + href in names:
            out.append(base + href)
    return out or fallback


def extract(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in (".epub", ".docx", ".zip"):
        with zipfile.ZipFile(path) as zf:
            if suffix == ".docx":
                return to_text(zf.read("word/document.xml").decode("utf-8", "replace"))
            return "\n\n".join(
                t for t in (to_text(zf.read(n).decode("utf-8", "replace")) for n in xhtml_in_spine(zf)) if t
            )
    return to_text(path.read_text(encoding="utf-8", errors="replace"))


if __name__ == "__main__":
    text = extract(Path(sys.argv[1]))
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
PY
python3 resources/derived/extract.py "resources/某本书.epub" "resources/derived/某本书/full.txt"
```

它按 `content.opf` 的 spine 顺序抽正文（跳过 `linear="no"` 的封面/书名页），docx 取 `word/document.xml`。
epub 与 docx 都是 zip，所以 `.zip` 也能直接喂给它。

### 路线 C：只有 unzip（解容器 + 去标签）

```bash
mkdir -p out && unzip -o -q "resources/某本书.epub" -d out
OPF=$(sed -n 's/.*full-path="\([^"]*\)".*/\1/p' out/META-INF/container.xml | head -1)
SPINE=$(perl -0777 -e '
my $opf=<>; my (%h,@s);
while ($opf =~ /<item\b[^>]*>/g) { my $t=$&; my ($i)=$t=~/\bid="([^"]+)"/; my ($h)=$t=~/\bhref="([^"]+)"/; $h{$i}=$h if $i && $h }
while ($opf =~ /<itemref\b[^>]*>/g) { my $t=$&; next if $t=~/linear="no"/; my ($r)=$t=~/\bidref="([^"]+)"/; push @s,$h{$r} if $r && $h{$r} }
print "$_\n" for @s' "out/$OPF")
{ for f in $SPINE; do perl -0777 -pe 's/<(head|script|style)\b.*?<\/\1\s*>//gsi; s/<br\s*\/?>/\n/gi; s/<\/(?:p|div|h[1-6]|li|tr|section|blockquote)\s*>/\n/gi; s/<[^>]+>//g; s/&nbsp;/ /g; s/&amp;/&/g; s/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/[ \t]+/ /g; s/\n\s*\n\s*\n+/\n\n/g' "out/$(dirname "$OPF")/$f"; echo; done; } > "resources/derived/某本书/full.txt"
```

注意 `$OPF` 的目录名（上例是 `EPUB/`）——正文相对它寻址，拼错就是空文件（用 `wc -l` 验一下再往下走）。
Windows 上没有 `unzip` 时，系统自带的 `tar.exe`（bsdtar）与 PowerShell 的 `Expand-Archive` 都能解 zip/epub：

```bash
/c/Windows/System32/tar.exe -xf "resources/某本书.epub" -C out
powershell -NoProfile -Command "Expand-Archive -LiteralPath 'resources\某本书.epub' -DestinationPath out"
```

### 各格式速查

| 格式 | 首选 | 没有工具时 |
| --- | --- | --- |
| `.txt` / `.md` | 不用转，直接分段读 | — |
| `.html` / `.htm` | `pandoc -f html -t plain` | 路线 B 或 C 的去标签 |
| `.epub` | `pandoc -f epub -t plain` | 路线 B（python3）→ 路线 C（unzip） |
| `.docx` | `pandoc -f docx -t markdown` | 路线 B：解容器取 `word/document.xml` |
| `.pdf` | `pdftotext -layout in.pdf out.txt`（poppler-utils） | 没有就如实回话；扫描版**没有文本层**，抽出来是空的，要 OCR（本机没配）——别硬凑 |
| `.mobi` / `.azw3` | `ebook-convert in.mobi out.epub`（calibre） | 让用户用 calibre 转成 epub 再发 |
| 图片（截图/封面） | 当轮已经看过；要再看用 `view_image` | — |

工具都没有、也没法装：**如实说清楚是什么格式、缺什么工具、让他转成 `.txt`/`.epub` 再发**，
不要拿 `strings` 的输出硬当正文（那是乱码级的东西，改编会全错）。

## 3. 分段读：一章一章来，边读边落笔记

抽完先立目录，别一上来就 `read` 全文：

```bash
wc -l -c "resources/derived/某本书/full.txt"      # 体量
grep -n "^#\|^第.章\|^Chapter" "resources/derived/某本书/full.txt" | head -60   # 章节索引
```

- **一次 2000 行 / 50KB 是 read 的硬上限**，按上面那张索引给的行号用 `offset` + `limit` 一段一段读：
  `read(path="resources/derived/某本书/full.txt", offset=1200, limit=800)`。
- **一段读完就落一次笔记**，别憋到最后（上下文会被下一段挤掉）。笔记写哪儿：
  `resources/derived/某本书/notes.md`，一节一段：

  ```markdown
  ## 第 3 章（行 1200-1980）
  - 人物：谁登场、与主角的关系、可用的口癖/称呼
  - 场景：地点、时间、气氛（后面要出背景图的那几个）
  - 事件：发生了什么、推动了什么
  - 伏笔/钩子：值得在改编里保留或改写的点
  ```

  派生文件一律用 bash 写（`write` 工具写不进 `resources/`，它在那儿是只读面）。
- 长篇分几次会话读完也正常：下次接着读之前**先读 `notes.md`**，别从头再来一遍。
- 用户改过主意（「只要第一章」「跳过日常」）就照他的范围读，不要坚持读完。

## 4. 收成改编纲要（这才是目的）

读完之后（或按用户指定的章节范围读完之后）产出一份纲要，**先给用户看、再落盘**：

1. **故事骨架**：一条主线 + 几个转折，几句话能说清。
2. **改编裁量**：哪些留、哪些合、哪些删——原作几十万字塞不进一部视觉小说，取舍要摆出来让用户点头。
3. **人物**：出场角色表，每人一句人设要点与关系（对应后面的角色卡）。
4. **场景清单**：要哪几张背景、哪几张插图（对应素材清单与出图顺序）。
5. **结构**：切成几幕/几条线，每幕的落点与停止点密度。

落盘位置（这就是视觉小说剧目的标准件，别另造一套）：

- 故事骨架与世界设定 → `memory/always/premise.md`
- 文风与禁忌（原作的语感、叙述视角、称呼） → `memory/always/craft.md`
- 角色 → `characters/<id>.md`（先 `read_skill("galgame-play-setup")` 看卡怎么写）
- 节奏与素材来源 → `set_craft`

**接着走 `galgame-play-setup` 的四步流程**：先问清骨架 → 给完整提案等点头 → 列图单 → 落盘后同步记忆。
这份纲要就是那一步里的「提案」。

## 5. 边界

- 只处理用户自己投进来的文件（`resources/` 里有什么读什么），不去网上另找同一部作品来替代。
- 版权与授权的判断归用户；他决定了改编范围，你照着做，不替他表态。
- `resources/` 里的原件只读：派生文本、笔记、拆出来的中间文件一律放 `resources/derived/`。
- 清出来的中间目录（解容器出来的 `out/`）留在 `resources/derived/` 下或随手删掉，别散在剧目根目录。
- 抽出来的全文是**中间产物**：改编完成后可以留着（用户要回查），但别把它当剧目文件到处引用。
