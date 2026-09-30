#!/usr/bin/env python3
"""把 OGA 下载的 VN 角色主题曲 / 校园日常变体 / 翻书铅笔音整理进资源库。

许可：
- Some character themes (originally for visual novel) —— CC0
- School day / Rain / Sun —— CC0
- Upbeat Visual Novel Music（Visual Novel Concept Album）—— CC BY 3.0 + CC BY-SA 3.0
- Pencil Sounds / 10 Book Page Flips —— CC0
"""
import json, shutil, subprocess, zipfile
from pathlib import Path

SRC = Path("/tmp/itd/oga")
BGM = Path("./library/bgm")
SFX = Path("./library/sfx")

def dur(p: Path) -> int:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(p)],
            capture_output=True, text=True, timeout=30).stdout.strip()
        return int(float(out)) if out else 0
    except Exception:
        return 0

def put(dst_dir: Path, eid: str, src: Path, title: str, desc: str,
        tags, mood, scene, source, license_name, volume, loop=True,
        attribution=None, license_url=None, source_url=None, ext=None):
    entry = dst_dir / eid
    if entry.exists():
        print(f"  已存在: {eid}")
        return
    entry.mkdir(parents=True, exist_ok=True)
    ext = ext or src.suffix
    dst = entry / f"{eid}{ext}"
    shutil.copyfile(src, dst)
    meta = {
        "title": title,
        "description": desc,
        "tags": tags,
        "source": source,
        "sourceUrl": source_url or "",
        "license": license_name,
        "mood": mood,
        "scene": scene,
        "durationSec": dur(dst),
        "loop": loop,
        "volume": volume,
    }
    if license_url:
        meta["licenseUrl"] = license_url
    if attribution:
        meta["attribution"] = attribution
    (entry / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  {eid}  {meta['durationSec']}s  {dst.stat().st_size // 1024}KB")

# ---------------------------------------------------------------- BGM
print("=== BGM: Some character themes (originally for visual novel) · CC0 ===")
VN_SRC = "OpenGameArt / some character themes (originally for visual novel) / CC0"
VN_URL = "https://opengameart.org/content/some-character-themes-music-originally-visual-novel"
put(BGM, "vn_theme_judgement", SRC / "judgement_0.mp3",
    "审判", "VN 角色主题曲。沉着的弦乐与钢琴，人物决意/对峙的场面。",
    ["角色主题曲", "弦乐", "钢琴", "西式"], ["决意", "紧张", "宏大"],
    ["对峙", "决意", "名场面"], VN_SRC, "CC0", 0.40, True,
    "Music: some character themes (originally for visual novel) (CC0), OpenGameArt", source_url=VN_URL)
put(BGM, "vn_theme_principal_matter", SRC / "principalmatter_0.mp3",
    "主要之物", "VN 角色主题曲。庄重的钢琴与弦乐，重要人物登场或关键决定。",
    ["角色主题曲", "钢琴", "弦乐", "西式"], ["庄重", "紧张", "宿命"],
    ["登场", "决定", "名场面"], VN_SRC, "CC0", 0.40, True,
    "Music: some character themes (originally for visual novel) (CC0), OpenGameArt", source_url=VN_URL)
put(BGM, "vn_theme_ojou_lamentation", SRC / "ojouslamentation_0.mp3",
    "少女的哀叹", "VN 角色主题曲。哀婉的钢琴与弦乐，悲伤/离别的高潮段。",
    ["角色主题曲", "钢琴", "弦乐", "悲伤"], ["悲伤", "不舍", "哀婉"],
    ["离别", "悲剧", "高潮"], VN_SRC, "CC0", 0.40, True,
    "Music: some character themes (originally for visual novel) (CC0), OpenGameArt", source_url=VN_URL)
put(BGM, "vn_theme_clumsy_girl", SRC / "clumsygirl_0.mp3",
    "笨拙的女孩", "VN 角色主题曲。轻快的钢琴，天然/搞笑/可爱角色。",
    ["角色主题曲", "钢琴", "轻快", "可爱"], ["俏皮", "轻快", "天然"],
    ["日常", "搞笑", "角色登场"], VN_SRC, "CC0", 0.42, True,
    "Music: some character themes (originally for visual novel) (CC0), OpenGameArt", source_url=VN_URL)

print("\n=== BGM: School day / Rain / Sun · CC0 ===")
SD_SRC = "OpenGameArt / School day (Rain/Sun/Loop) / CC0"
SD_URL = "https://opengameart.org/content/school-day-rain-sun-loop"
put(BGM, "school_day", SRC / "SchoolDay_0.ogg",
    "校园的一天", "校园日常的明亮钢琴曲。上课、课间、放学路上的轻松段落。",
    ["校园", "钢琴", "日常", "明亮"], ["轻快", "温暖", "日常"],
    ["校园", "日常", "上课"], SD_SRC, "CC0", 0.42, True,
    "School day (CC0), OpenGameArt", source_url=SD_URL)
put(BGM, "school_day_rain", SRC / "SchoolDayRain.ogg",
    "校园的一天（雨）", "同上，雨天变体。窗外在下雨，教室里的安静。",
    ["校园", "钢琴", "雨", "安静"], ["安静", "忧郁", "日常"],
    ["雨天", "教室", "日常"], SD_SRC, "CC0", 0.40, True,
    "School day Rain (CC0), OpenGameArt", source_url=SD_URL)
put(BGM, "school_day_sun", SRC / "SchoolDaySun.ogg",
    "校园的一天（晴）", "同上，晴天变体。更明亮外放，适合放学与周末。",
    ["校园", "钢琴", "明亮", "日常"], ["轻快", "温暖", "雀跃"],
    ["放学", "周末", "户外"], SD_SRC, "CC0", 0.42, True,
    "School day Sun (CC0), OpenGameArt", source_url=SD_URL)

print("\n=== BGM: Upbeat Visual Novel Music（Concept Album）· CC BY 3.0 / BY-SA 3.0 ===")
VNCA_SRC = "OpenGameArt / Upbeat Visual Novel Music / CC BY 3.0"
VNCA_URL = "https://opengameart.org/content/upbeat-visual-novel-music"
with zipfile.ZipFile(SRC / "Visual Novel Concept Album.zip") as zf:
    album = {Path(n).stem.replace("01 - ", "").replace("02 - ", "")
              .replace("03 - ", "").replace("04 - ", "").replace("05 - ", ""): n
             for n in zf.namelist() if n.endswith(".ogg")}
    CONCEPT = {
        "Dynamic Horizon": ("concept_dynamic_horizon", "动态地平线",
            "概念原声的一首。开阔的合成器与钢琴，卷起一场冒险的序幕。",
            ["概念原声", "合成器", "钢琴", "开阔"], ["期待", "宏大", "启程"],
            ["开场", "冒险", "转折"]),
        "Dynamic Daydreams": ("concept_dynamic_daydreams", "动态白日梦",
            "概念原声的一首。轻快的合成器，日常里的小小幻想。",
            ["概念原声", "合成器", "轻快"], ["轻快", "幻想", "俏皮"],
            ["日常", "幻想", "校园"]),
        "Dynamic School Days": ("concept_dynamic_school_days", "动态校园时光",
            "概念原声的一首。明亮的校园日常曲，上课与课间的底噪级配乐。",
            ["概念原声", "校园", "轻快", "明亮"], ["轻快", "温暖", "日常"],
            ["校园", "日常", "上课"]),
        "After School": ("concept_after_school", "放学后",
            "概念原声的一首。DownTempo 的放学路，节奏放缓的黄昏。",
            ["概念原声", "校园", "放克", "黄昏"], ["悠闲", "温暖", "放学"],
            ["放学", "黄昏", "校园"]),
        "DownTempo Avenue": ("concept_downtempo_avenue", "慢拍街道",
            "概念原声的一首。DownTempo 的大街，缓慢的散步感。",
            ["概念原声", "放克", "悠闲"], ["悠闲", "都市", "日常"],
            ["街道", "散步", "日常"]),
    }
    for stem, (eid, title, desc, tags, mood, scene) in CONCEPT.items():
        if stem not in album:
            print(f"  缺: {stem}")
            continue
        entry = BGM / eid
        if entry.exists():
            print(f"  已存在: {eid}")
            continue
        entry.mkdir(parents=True, exist_ok=True)
        with zf.open(album[stem]) as src, open(entry / f"{eid}.ogg", "wb") as out:
            shutil.copyfileobj(src, out)
        d = dur(entry / f"{eid}.ogg")
        meta = {
            "title": title, "description": desc, "tags": tags,
            "source": VNCA_SRC, "sourceUrl": VNCA_URL,
            "license": "CC BY 3.0 或 CC BY-SA 3.0（双许可）",
            "attribution": "Upbeat Visual Novel Music (CC BY 3.0), OpenGameArt",
            "mood": mood, "scene": scene, "durationSec": d,
            "loop": True, "volume": 0.42,
        }
        (entry / "meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"  {eid}  {d}s  {(entry / f'{eid}.ogg').stat().st_size // 1024}KB")

# ---------------------------------------------------------------- SFX
print("\n=== SFX: Pencil Sounds（CC0）===")
with zipfile.ZipFile(SRC / "pencil.zip") as zf:
    for stem, (eid, title, desc) in {
        "pencil_write": ("write_pencil_og", "写字（铅笔·实录）",
            "铅笔在纸上书写的实录声，干净无环境底噪。比 OtoLogic 版更贴近。"),
        "pencil_erase": ("erase_pencil_og", "橡皮擦（实录）",
            "铅笔橡皮擦纸的实录声，修改笔记时用。"),
    }.items():
        entry = SFX / eid
        if entry.exists():
            print(f"  已存在: {eid}"); continue
        entry.mkdir(parents=True, exist_ok=True)
        with zf.open(f"ogg/{stem}.ogg") as src, open(entry / f"{eid}.ogg", "wb") as out:
            shutil.copyfileobj(src, out)
        d = dur(entry / f"{eid}.ogg")
        meta = {
            "title": title, "description": desc,
            "tags": ["写字", "铅笔", "橡皮", "拟音", "实录"],
            "source": "OpenGameArt / Pencil Sounds / CC0（freesound: damsur, NachtmahrTV）",
            "sourceUrl": "https://opengameart.org/content/pencil-sounds",
            "license": "CC0", "mood": ["安静", "日常"],
            "scene": ["上课", "笔记", "修改"], "durationSec": d,
            "loop": False, "volume": 0.55,
        }
        (entry / "meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"  {eid}  {d}s")

print("\n=== SFX: 10 Book Page Flips（CC0）===")
with zipfile.ZipFile(SRC / "book_flips_-_starninjas.zip") as zf:
    names = sorted(n for n in zf.namelist() if n.endswith(".ogg"))
    for n in names:
        idx = n.split(".")[1].zfill(2)
        eid = f"book_flip_{idx}"
        entry = SFX / eid
        if entry.exists():
            print(f"  已存在: {eid}"); continue
        entry.mkdir(parents=True, exist_ok=True)
        with zf.open(n) as src, open(entry / f"{eid}.ogg", "wb") as out:
            shutil.copyfileobj(src, out)
        d = dur(entry / f"{eid}.ogg")
        meta = {
            "title": f"翻书（细碎·{idx}）",
            "description": "10 个翻书音的其中一个，纸张摩擦声干净短促。上课翻书、翻资料夹。",
            "tags": ["书", "翻页", "拟音", "校园"],
            "source": "OpenGameArt / 10 Book Page Flips / CC0（freesound: starninjas）",
            "sourceUrl": "https://opengameart.org/content/10-book-page-flips",
            "license": "CC0", "mood": ["日常", "安静"],
            "scene": ["读书", "上课", "图书馆"], "durationSec": d,
            "loop": False, "volume": 0.6,
        }
        (entry / "meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"  {eid}  {d}s")
