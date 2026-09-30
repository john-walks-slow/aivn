#!/usr/bin/env python3
"""把 OtoLogic 下载的 BGM 整理成 stage-ai 资源库条目。
"""
import json, re, subprocess, sys
from pathlib import Path

SRC = Path("/tmp/itd/oto/bgm_extracted")
DST = Path("./library/bgm")

SOURCE = "OtoLogic(https://otologic.jp) / CC BY 4.0"
TERMS = "https://otologic.jp/free/license.html"

# slug -> (id, 中文标题, 描述, 标签, 情绪, 场景, 默认时长秒, 音量)
REG = {
    "haru_no_kyousitu": ("haru_no_kyousitu", "春天的教室",
        "日系校园日常钢琴曲。中速、伴奏克制。开场与日常对话的默认垫底。",
        ["日系","钢琴","校园","日常","明亮"], ["温暖","清新","日常"], ["教室","日常","开场"], 168, 0.42),
    "anata_wo_siritakute": ("anata_wo_siritakute", "想要了解你",
        "钢琴与竖琴的抒情推进，缓慢上行。告白、心意萌动、升温段。",
        ["日系","钢琴","竖琴","抒情"], ["心动","温柔","惆怅"], ["告白","独白","回忆"], 145, 0.40),
    "namida_no_imi": ("namida_no_imi", "泪的含义",
        "纯钢琴，克制的小调。分别、遗憾、说不出口的话。",
        ["日系","钢琴","伤感","安静"], ["难过","不舍","安静"], ["别离","回忆","独白"], 148, 0.38),
    "kanasimi_ni_sakuhana": ("kanasimi_ni_sakuhana", "悲伤之花",
        "钢琴+合成器铺底，偏暗。比《泪的含义》更厚，适合整场压着的失落。",
        ["日系","钢琴","合成器","伤感"], ["难过","沉重","寂寥"], ["悲剧","回忆","独白"], 172, 0.38),
    "heisarenai": ("heisarenai", "无法言说的爱",
        "钢琴独奏，暗色，缓慢。压抑的告白、说不出口的心里话。",
        ["日系","钢琴","暗色","抒情"], ["压抑","痛苦","隐忍"], ["压抑","独白","回忆"], 175, 0.38),
    "goraku_iinkai": ("goraku_iinkai", "娱乐委员会",
        "钢琴、木琴与贝斯轻快节奏。社团活动、课间打闹、日常活泼段。",
        ["日系","钢琴","木琴","轻快"], ["轻快","俏皮","日常"], ["社团","校园日常","过场"], 155, 0.45),
    "Puzzle": ("puzzle", "拼图",
        "钢琴与低音提琴加轻打击，点状推进。日常里的悬而未决、心思绕圈。",
        ["日系","钢琴","低音提琴","推理"], ["微妙","疑惑","日常"], ["悬疑","内心戏","推理"], 165, 0.42),
    "ra_ra_ra_ragtime": ("ra_ra_ra_ragtime", "らららラグタイム",
        "钢琴+钢片琴+贝斯，南国氛围轻快 ragtime。放学、转角、日常小跳跃。",
        ["日系","钢琴","钢片琴","拉格泰姆"], ["轻快","俏皮","异域"], ["放学","日常","过场"], 145, 0.44),
    "Beside_You": ("beside_you", "在你身旁",
        "八音盒 Slow 版极慢。回忆闪回、结局、告别后独处。",
        ["八音盒","日系","回忆","抒情"], ["怀念","温柔","不舍"], ["回忆","结局","别离"], 190, 0.36),
    "Omoide_Ha_Zutto": ("omoide_ga_zutto", "回忆永远",
        "八音盒 Slow 版，长且克制。回忆独白与片尾，音量压到最低也不违和。",
        ["八音盒","日系","回忆","安静"], ["怀念","寂寥","温柔"], ["回忆","片尾","独白"], 230, 0.35),
    "Hoshi_O_Kazoete": ("hoshi_o_kazoete", "数着星星",
        "八音盒，童谣般的简单旋律。夜晚场景、儿童回忆、安静的温情。",
        ["八音盒","日系","童谣","温柔"], ["温柔","纯真","安静"], ["夜晚","回忆","温情"], 155, 0.38),
    "Nostalgia": ("nostalgia", "怀旧",
        "八音盒 Fast 版，节奏稍快。放学路上、夕阳、放学后一个人。",
        ["八音盒","日系","轻快","怀旧"], ["怀旧","轻松","温暖"], ["放学","日常","回忆"], 150, 0.40),
    "Ayamachi_No_Daisho": ("ayamachi_no_daishou", "将暮的代价",
        "八音盒 Slow 版，旋律下行为主。分别后的空、失去之后的安静。",
        ["八音盒","日系","伤感","慢"], ["寂寥","不舍","沉重"], ["别离","结局","独白"], 200, 0.36),
    "Kokyo_No_Yuhi": ("kokyo_no_yuhi", "故郷の夕日",
        "八音盒单曲，故乡黄昏的意境。乡愁、放学后的操场、回不去的时光。",
        ["八音盒","日系","黄昏","乡愁"], ["怀念","温暖","惆怅"], ["黄昏","回忆","放学"], 175, 0.38),
    "Kunou_No_Sakini": ("kunou_no_saki_ni", "苦恼的先处",
        "八音盒 Slow 版，缓慢且克制。压抑、说不出口、心事重重。",
        ["八音盒","日系","慢","压抑"], ["压抑","痛苦","安静"], ["压抑","独白","回忆"], 210, 0.35),
    "Seijaku_Ni_Tsutsumarete": ("seijaku_ni_tsutsumarete", "被寂静包围",
        "八音盒 Fast 版，清淡。安静的对白、图书馆、放学后空教室。",
        ["八音盒","日系","安静","轻快"], ["安静","清爽","孤独"], ["安静","图书馆","空教室"], 155, 0.38),
    "Tsumetai_Kehai": ("tsumetai_kehai", "冷たい 계획",
        "八音盒 Slow 版，冷调。拒绝、距离感、心墙立起来的时候。",
        ["八音盒","日系","冷","慢"], ["冷淡","距离","孤独"], ["冷战","独白","回忆"], 185, 0.36),
    "gomenne": ("gomenne", "ごめんね",
        "八音盒单曲，日常的歉意与和解。道歉、别别扭扭的和好。",
        ["八音盒","日系","日常","温柔"], ["歉意","温柔","日常"], ["道歉","日常","和解"], 150, 0.40),
    "hamabe_de_ragtime": ("hamabe_de_ragtime", "滨边的拉格泰姆",
        "钢琴+钢片琴，海边氛围的 ragtime。夏天、假期、沿海街道。",
        ["日系","钢琴","钢片琴","海边"], ["轻快","夏日","悠闲"], ["海边","夏天","假期"], 92, 0.44),
    "ra_ra_ra_ragtime_GB": ("ra_ra_ra_ragtime_steelpan", "らららラグタイム（鋼片琴版）",
        "steel pan 音色版，更明亮的南国感。放学路、教室里的骚动。",
        ["日系","钢片琴","轻快","异域"], ["轻快","俏皮","明亮"], ["放学","日常","过场"], 89, 0.44),
}

# slug -> (id, 中文标题, 描述, 标签, 情绪, 场景, 时长, 音量)
SE_REG = {}

def dur(path: Path) -> int:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=30,
        ).stdout.strip()
        return int(float(out)) if out else 0
    except Exception:
        return 0

def make_meta(entry_id, title, desc, tags, mood, scene, duration, volume,
              source=SOURCE, kind="bgm", suffix_note=""):
    loop = kind == "bgm"
    meta = {
        "title": title + (f"（{suffix_note}）" if suffix_note else ""),
        "description": desc,
        "tags": tags,
        "source": source,
        "sourceUrl": "https://otologic.jp/free/bgm/pop-music-piano01.html" if kind == "bgm" else "",
        "license": "CC BY 4.0",
        "licenseUrl": TERMS,
        "attribution": "BGM by OtoLogic(https://otologic.jp)" if kind == "bgm" else "SE by OtoLogic(https://otologic.jp)",
        "mood": mood,
        "scene": scene,
        "durationSec": duration,
        "loop": loop,
        "volume": volume,
    }
    return meta

def process(kind, src_dir, dst_dir, reg):
    dst_dir.mkdir(parents=True, exist_ok=True)
    made = 0
    done = set()
    # 预做小写化后的注册表
    norm_reg = {re.sub(r"[\s_]+", "_", k.lower()).strip("_"): k for k in reg}
    for src in sorted(src_dir.glob("*.mp3")):
        stem = src.stem
        norm = re.sub(r"[\s_]+", "_", stem.lower()).strip("_")
        base_norm = None
        for nk in norm_reg:
            if norm == nk or norm.startswith(nk + "_") or norm.startswith(nk + "-"):
                if base_norm is None or len(nk) > len(base_norm):
                    base_norm = nk
        if base_norm is None:
            print(f"  跳过未登记: {src.name}", file=sys.stderr)
            continue
        base = norm_reg[base_norm]
        eid, title, desc, tags, mood, scene, def_dur, vol = reg[base]
        suffix = ""
        rest = norm[len(base_norm):]
        rest = re.sub(r"^[-_()]+", "", rest).strip("-_()")
        if rest:
            # 简化 rest：只留字母数字下划线
            rkey = re.sub(r"[^a-z0-9]", "", rest)
            suffix_map = {
                "1slow": "slow", "2fast": "fast", "narr": "narr",
                "puzzle": "",
                "hamabederagtime": "beach_variant",
                "rarararagtimegb": "steelpan_variant",
            }
            suffix = suffix_map.get(rkey, rkey)
            if suffix and suffix != "puzzle":
                eid = f"{eid}_{suffix}"
        if eid in done:
            print(f"  跳过重复: {src.name} -> {eid}")
            continue
        done.add(eid)
        entry = dst_dir / eid
        entry.mkdir(parents=True, exist_ok=True)
        dst = entry / f"{eid}.mp3"
        import shutil; shutil.move(str(src), str(dst))
        real = dur(dst) or def_dur
        suffix_note = {"slow": "慢速版", "fast": "快速版", "narr": "旁白版",
                       "beach_variant": "海边版", "steelpan_variant": "钢片琴版"}.get(suffix, "")
        meta = make_meta(eid, title, desc, tags, mood, scene, real, vol,
                         kind=kind, suffix_note=suffix_note)
        (entry / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"  {eid}  {real}s  {dst.stat().st_size // 1024}KB")
        made += 1
    print(f"入库 {made} 条 ({kind})")

print("=== BGM ===")
process("bgm", SRC, DST, REG)
print("\n=== SE (待下载完成) ===")
print("跳过")
