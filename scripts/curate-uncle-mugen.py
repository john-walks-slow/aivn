#!/usr/bin/env python3
"""把 Uncle Mugen 免费背景包拆成 AIVN 资源库的条目（每条一个目录）。

来源与许可：https://alte.itch.io/uncle-mugens-backgrounds
作者在 Lemma Soft 帖子里的自然语言许可（非标准 CC），原文见 TERMS_URL：
「Feel free to use for whatever purpose it may serve best... Just take them...
no strings attached.」——允许商用、允许改动、未设原文件再分发限制。

原包按 pack1/pack2 分子类，全是 WebP，文件名带时段后缀（_day/_night/…）。
资源库的约定是「一个目录 = 一条素材」，所以每张图各建一个目录：
    <输出目录>/<场景>_<时段>_<序号>/{ 图片.webp, meta.json }
分类靠文件名里的地点词而不是包内目录——「School Science Lab」这个包里
装的是礼堂、操场、图书室、音乐室，按目录一刀切会把礼堂标成实验室。

用法：python3 scripts/curate-uncle-mugen.py <解压后的 pack 根目录> <输出目录>
"""
import json
import re
import shutil
import sys
from pathlib import Path

SKIP_DIRS = {"Bar Photos", "Shower Toilet"}

SKIP_WORDS = (
    "shit_happens", "boring_tomb", "holding_cell", "future_office", "nuclear",
    "battlefield", "war_", "ruins", "dungeon", "prison", "slum", "ghetto",
    "shipwreck", "alien", "zombie", "horror", "creepy", "janet_lim",
    "philippine_jeepney", "dust_storm", "tomb", "deep_dark_fantasy",
)

# 场景判定按此顺序，命中第一个即算。键是规范化后的文件名子串。
SCENES = (
    ("classroom", "school_classroom", "教室", ["学校", "教室", "室内"]),
    ("auditorium", "school_auditorium", "礼堂", ["学校", "礼堂", "室内"]),
    ("basketball", "school_gym", "篮球场", ["学校", "操场", "室外"]),
    ("football", "school_field", "操场", ["学校", "操场", "室外"]),
    ("library", "school_library", "图书室", ["学校", "图书室", "室内"]),
    ("music", "school_music_room", "音乐室", ["学校", "音乐室", "室内"]),
    ("applegate", "school_gate", "校门", ["学校", "校门", "室外"]),
    ("school_building", "school_building", "校舍外景", ["学校", "建筑", "室外"]),
    ("science_lab", "school_lab", "理科实验室", ["学校", "实验室", "室内"]),
    ("school", "school_misc", "校园", ["学校", "室内"]),
    ("megalopolitan", "school_misc", "校园", ["学校", "室内"]),
    ("cafe_memoria", "cafe", "咖啡厅", ["咖啡厅", "室内", "现代"]),
    ("train_station", "train_station", "车站", ["车站", "室外", "现代"]),
    ("kitchen", "kitchen", "厨房", ["厨房", "住宅", "室内"]),
    ("interiors", "apartment", "公寓室内", ["公寓", "住宅", "室内"]),
    ("bathroom", "bathroom", "浴室", ["浴室", "住宅", "室内"]),
    ("hospital", "hospital", "医院", ["医院", "室内"]),
    ("childrens_park", "park", "公园", ["公园", "室外", "现代"]),
    ("park", "park", "公园", ["公园", "室外", "现代"]),
    ("modern_urban", "city", "城市街道", ["街道", "城市", "室外", "现代"]),
    ("nature", "nature", "野外", ["自然", "室外"]),
    ("beach", "beach", "海边", ["海边", "室外", "自然"]),
    ("room", "bedroom", "卧室", ["卧室", "住宅", "室内"]),
)

# 时段后缀 → (中文标签, 情绪)。长后缀必须排在短前缀前，
# 否则 almost_dusk 会被 evening 抢走、early_morning 会被 morning 抢走。
TIMES = {
    "early_morning": ("清晨", ["清新", "静谧"]),
    "almost_dusk": ("将暮", ["不舍", "寂寥"]),
    "morning": ("早晨", ["清新", "希望"]),
    "afternoon": ("午后", ["温暖", "日常"]),
    "evening": ("傍晚", ["温暖", "寂寥"]),
    "sunset": ("日落", ["不舍", "温暖"]),
    "dusk": ("薄暮", ["寂寥", "不舍"]),
    "night": ("夜晚", ["安静", "神秘", "不安"]),
    "noon": ("正午", ["明亮", "日常"]),
    "day": ("白天", ["日常", "明亮"]),
}

SOURCE = "Uncle Mugen 免费 VN 背景包（Alte 整理）https://alte.itch.io/uncle-mugens-backgrounds"
TERMS_URL = "https://lemmasoft.renai.us/forums/viewtopic.php?f=52&t=17302#p226871"
LICENSE = (
    "作者自然语言许可（非标准 CC），原文：Feel free to use for whatever purpose it may "
    "serve best. OK for both Commercial and Free projects. Modifications are OK. "
    "Just take them... no strings attached."
)


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def time_of(stem: str) -> tuple[str, str, list[str]]:
    """返回 (英文时段 key, 中文标签, 情绪)。英文 key 用来拼素材 id——目录名即
    剧本引用名，必须是 ASCII，不能把中文时段写进去。"""
    for suffix, (label, mood) in TIMES.items():
        if stem.endswith(f"_{suffix}"):
            return suffix, label, mood
    return "unknown", "未知时辰", []


def scene_of(path: Path) -> tuple[str, str, list[str]] | None:
    """先按文件名判具体地点，再按所在目录判大类。

    「School Science Lab」包里装的是礼堂/操场/图书室，只看目录会全标成实验室；
    而「Megalopolitan Education」里全是 afternoon01.webp 这种无名文件，只看文件名
    又一个都匹配不上——所以两级都试，文件名优先。
    """
    stem = norm(path.stem)
    for source in (stem, norm(path.parent.name)):
        for needle, scene_id, title, tags in SCENES:
            if needle in source:
                return scene_id, title, tags
    return None


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    src = Path(sys.argv[1])
    out = Path(sys.argv[2])
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    kept = 0
    taken: set[str] = set()
    for path in sorted(src.rglob("*.webp")):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        stem = norm(path.stem)
        if any(word in stem for word in SKIP_WORDS):
            continue
        found = scene_of(path)
        if found is None:
            continue
        scene_id, scene_title, tags = found
        time_key, time_label, mood = time_of(stem)

        entry_id = f"{scene_id}_{time_key}" if time_key != "unknown" else scene_id
        # 同名加序号，保证目录名唯一（资源库按目录名当素材 id）
        final_id, suffix = entry_id, 1
        while final_id in taken:
            suffix += 1
            final_id = f"{entry_id}_{suffix:02d}"
        taken.add(final_id)

        entry = out / final_id
        entry.mkdir(parents=True)
        shutil.copy2(path, entry / f"{final_id}.webp")

        meta = {
            "title": f"{scene_title}·{time_label}",
            "description": f"{scene_title}，{time_label}。空景无人。",
            "tags": tags + [time_label],
            "mood": mood,
            "source": SOURCE,
            "license": LICENSE,
            "licenseUrl": TERMS_URL,
            "originFile": path.name,
        }
        (entry / "meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        kept += 1

    print(f"整理 {kept} 条")


if __name__ == "__main__":
    main()
