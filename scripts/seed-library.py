#!/usr/bin/env python3
"""把调研清单里的可再分发素材下载、转码、落进 library/<kind>/<id>/。

清单来源：docs/features/260930-asset-library/seed-sources.research.md 的 §2.1/§2.2/§2.3，
素材 id 与调研文档保持一致（id 一旦发布就是剧目里的引用名，不能另起）。

三条硬约束都写在这个脚本里，不要在别处再实现一遍：
- BGM 全部 mp3 128k；incompetech 全长曲裁成 60s 片段并做首尾 300ms 交叉淡化，循环不爆音。
- 背景统一 1920×1080 JPG，单张压在 400KB 以内。
- upload.wikimedia.org 必须带描述性 UA 且请求间留间隔，否则会随机 429。

幂等：目标媒体文件与 meta.json 都在就跳过（`--force` 重做）。
下载失败的条目跳过并记进报告，绝不落一个空壳或占位文件。

    python3 scripts/seed-library.py                 # 补齐缺的
    python3 scripts/seed-library.py --kind bgm      # 只补 bgm
    python3 scripts/seed-library.py --force         # 全部重做
    python3 scripts/seed-library.py --cache /data/d # 换下载缓存目录
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "library"
OGA = "https://opengameart.org/sites/default/files"
COMMONS = "https://upload.wikimedia.org/wikipedia/commons"
INC = "https://incompetech.com/music/royalty-free/mp3-royaltyfree"

# 调研文档 §4.4 实测：浏览器 UA 连续打 upload.wikimedia.org 会 429，描述性 UA 全 200。
UA = "aivn-asset-library/1.0 (local seed library build; https://github.com/john-walks-slow/aivn) curl/8"
WIKI_PAUSE = 3.0  # Commons 请求间隔（秒）

BGM_BITRATE = "128k"
BGM_FADE = 0.3  # 裁片首尾交叉淡化（秒）
FULL_FADE = 0.03  # 未裁的循环：只压 30ms，够消掉接缝的直流突变又不吃掉起音
SFX_BITRATE = "96k"
BG_MAX_BYTES = 400_000
BG_QUALITIES = (2, 4, 6, 8, 11, 14, 17)  # mjpeg -q:v，从高往低试到压进体积线（实测量阶梯很陡，森林大图要走到 14+）


@dataclass
class Source:
    url: str
    zip_member: str = ""  # 压缩包内成员（按路径后缀匹配，容忍包内多一层目录）


@dataclass
class Entry:
    kind: str
    id: str
    source: Source
    meta: dict
    clip: float | None = None  # 音频裁片秒数；None = 整段
    fade: float = 0.0  # 裁片首尾交叉淡化秒数（未裁的循环另走 30ms 短淡化）
    audio: dict = field(default_factory=dict)  # ffmpeg 编码参数
    layers: list[Source] = field(default_factory=list)  # 背景：多图层合成
    image_filter: str = ""  # 背景：ffmpeg filter_complex（[0] 指 layers[0]）


def bgm(meta: dict) -> Entry:
    """meta 里两个内部键：`_url` 直链、`clip` 裁片秒数（不写进 meta.json）。"""
    return Entry("bgm", meta.pop("id"), Source(meta.pop("_url")), meta,
                 clip=meta.pop("clip", None), fade=BGM_FADE,
                 audio={"b": BGM_BITRATE, "ac": 2})


# ---------------------------------------------------------------- 清单

BGM_ENTRIES = [
    bgm({
        "id": "bgm_piano_soft_loop", "_url": f"{OGA}/Piano%20Loop.wav",
        "title": "轻柔钢琴循环",
        "description": "二十几秒的钢琴短循环，音量克制、没有人声，不会盖住对白。最适合当整场戏的垫底音乐——温馨日常、回忆独白、安静对话都能用。",
        "tags": ["钢琴", "轻音乐", "对白垫底"],
        "source": "OpenGameArt / extenz / CC0",
        "mood": ["温暖", "安静", "治愈"], "scene": ["日常", "回忆", "独白"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_snowfall_loop", "_url": f"{OGA}/Snowfall%20%28Looped%20ver.%29_0.ogg",
        "title": "落雪",
        "description": "作者标注 Looped 的无缝循环，冬日轻音。适合雪景、回忆闪回、年末，或是离别前的一段独白。",
        "tags": ["冬日", "轻音乐", "循环"],
        "source": "OpenGameArt / kistol / CC0",
        "mood": ["清冷", "怀念", "安静"], "scene": ["回忆", "离别", "日常"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_forest_ambience", "_url": f"{OGA}/Forest_Ambience.mp3",
        "title": "林间",
        "description": "林间环境音式的配乐，人声空、空气感重。适合郊外、神社参道、走进自然的那一段。",
        "tags": ["自然", "环境音", "郊外"],
        "source": "OpenGameArt / tinyworlds / CC0",
        "mood": ["空灵", "安静"], "scene": ["郊外", "日常", "回忆"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_loading_loop", "_url": f"{OGA}/TremLoadingloopl.wav",
        "title": "等待的节拍",
        "description": "二十秒的待机循环，音型简单、不抢注意力。适合菜单待机、读档界面、等待演出推进的空档。",
        "tags": ["待机", "循环", "菜单"],
        "source": "OpenGameArt / haeldb / CC0",
        "mood": ["平静", "中性"], "scene": ["界面", "等待"], "loop": True, "volume": 0.4,
    }),
    bgm({
        "id": "bgm_next_to_you", "_url": f"{OGA}/Next%20to%20You.mp3", "clip": 35,
        "title": "在你身边",
        "description": "中速抒情，弦乐与钢琴渐进推进。适合告白、并肩、两个人独处的升温段。",
        "tags": ["抒情", "弦乐", "钢琴"],
        "source": "OpenGameArt / joth / CC0",
        "mood": ["温柔", "心动"], "scene": ["告白", "日常", "升温"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_searching_loop", "_url": f"{OGA}/Searching.ogg", "clip": 30,
        "title": "探索进行曲",
        "description": "探索感循环，节奏稳、不喧哗，像在一条没走完的路上往前走。适合日常推进、翻找线索、场景转场。",
        "tags": ["探索", "推进", "循环"],
        "source": "OpenGameArt / yd / CC0",
        "mood": ["轻快", "专注"], "scene": ["调查", "日常", "转场"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_town_theme", "_url": f"{OGA}/TownTheme.mp3", "clip": 30,
        "title": "小镇的一天",
        "description": "明亮的小镇主题，吉他配轻鼓，脚步停不下来的那种轻快。适合街道、放学路上、集市、初遇。",
        "tags": ["小镇", "吉他", "明亮"],
        "source": "OpenGameArt / cynicmusic / CC0",
        "mood": ["轻快", "温暖"], "scene": ["街道", "日常", "初遇"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_bossa_nova_8bit", "_url": f"{OGA}/8bit%20Bossa.mp3", "clip": 30,
        "title": "八位拿骚",
        "description": "8-bit 拿骚风，轻松俏皮。适合咖啡馆、约会、校园闲聊、放学后的闲散时光。",
        "tags": ["8bit", "拿骚", "轻松"],
        "source": "OpenGameArt / joth / CC0",
        "mood": ["俏皮", "悠闲"], "scene": ["日常", "咖啡馆", "闲聊"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_insistent_loop", "_url": f"{OGA}/Insistent.ogg", "clip": 30,
        "title": "步步逼近",
        "description": "持续推进的紧张循环，压迫感一段一段往上垒。适合被跟踪、倒计时、危机升级。",
        "tags": ["紧张", "推进", "循环"],
        "source": "OpenGameArt / yd / CC0",
        "mood": ["紧张", "压迫"], "scene": ["悬疑", "危机", "追逐"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_creepy", "_url": f"{OGA}/CrEEP_0.mp3", "clip": 30,
        "title": "不安",
        "description": "怪而不谐的 creeps 音型，不搞笑、只是让人后颈发凉。适合诡异、怪谈、不可名状的东西出场。",
        "tags": ["诡异", "怪奇"],
        "source": "OpenGameArt / CC0",
        "mood": ["不安", "诡异"], "scene": ["怪谈", "悬疑"], "loop": True, "volume": 0.42,
    }),
    bgm({
        "id": "bgm_night_prowler", "_url": f"{OGA}/S31-Night%20Prowler.ogg", "clip": 30,
        "title": "夜行者",
        "description": "潜行夜行曲，脚步一样往前推。适合跟踪、潜入、深夜行动。",
        "tags": ["潜行", "夜晚", "悬疑"],
        "source": "OpenGameArt / CC0",
        "mood": ["潜伏", "冷峻"], "scene": ["潜行", "追踪", "夜"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_rainy_night", "_url": f"{OGA}/Dark_Rainy_Night%28ambience%29.ogg", "clip": 30,
        "title": "雨夜",
        "description": "雨夜长环境音，几乎没有旋律，适合压在人声下面。适合独处的夜、压抑、剧情之间的过渡。",
        "tags": ["雨", "环境音", "夜晚"],
        "source": "OpenGameArt / kindland / CC0",
        "mood": ["压抑", "孤独"], "scene": ["夜", "独处", "转场"], "loop": True, "volume": 0.45,
    }),
    # —— incompetech / Kevin MacLeod：CC BY 4.0，必须署名。整曲 2–5 分钟，一律裁 60s + 300ms 交叉淡化 ——
    bgm({
        "id": "bgm_eternight_club", "_url": f"{INC}/Ethernight%20Club.mp3", "clip": 60,
        "title": "凌晨两点",
        "description": "凌晨两点、雨中的拉面店、下一段楼梯透出暗红霓虹。夜都市、打工人、失眠——孤独但不冷的夜。",
        "tags": ["夜都市", "爵士", "孤独"],
        "source": "Music by Kevin MacLeod (incompetech.com), Licensed under CC BY 4.0 — Ethernight Club",
        "mood": ["孤独", "温柔", "夜色"], "scene": ["夜", "都市", "失眠"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_bittersweet", "_url": f"{INC}/Bittersweet.mp3", "clip": 60,
        "title": "酸甜",
        "description": "酸甜交织，作者自己说「我可能有点想哭」。青春回忆、遗憾、错过的那句告白。",
        "tags": ["青春", "钢琴", "回忆"],
        "source": "Music by Kevin MacLeod (incompetech.com), Licensed under CC BY 4.0 — Bittersweet",
        "mood": ["遗憾", "酸涩", "温柔"], "scene": ["回忆", "青春", "离别"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_carefree", "_url": f"{INC}/Carefree.mp3", "clip": 60,
        "title": "无忧",
        "description": "96bpm 尤克里里，「一切都会好起来」的那种明亮释然。适合治愈日常、结局回收、和解之后。",
        "tags": ["尤克里里", "治愈", "轻快"],
        "source": "Music by Kevin MacLeod (incompetech.com), Licensed under CC BY 4.0 — Carefree",
        "mood": ["释然", "温暖", "轻快"], "scene": ["治愈", "结局", "日常"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_night_vigil", "_url": f"{INC}/Night%20Vigil.mp3", "clip": 60,
        "title": "守夜",
        "description": "54bpm 的守夜曲，亡者行进般的肃穆庄严。适合悲伤高潮、葬礼、异世界仪式、牺牲场景。",
        "tags": ["肃穆", "葬礼", "仪式"],
        "source": "Music by Kevin MacLeod (incompetech.com), Licensed under CC BY 4.0 — Night Vigil",
        "mood": ["肃穆", "悲伤", "庄严"], "scene": ["悲伤", "仪式", "高潮"], "loop": True, "volume": 0.42,
    }),
    bgm({
        "id": "bgm_send_for_the_horses", "_url": f"{INC}/Send%20for%20the%20Horses.mp3", "clip": 60,
        "title": "遣马",
        "description": "飘渺空灵，作者说「适合梦境序列，或 sad people standing in the rain 的蒙太奇」。适合梦境、雨中告别。",
        "tags": ["空灵", "梦境", "雨"],
        "source": "Music by Kevin MacLeod (incompetech.com), Licensed under CC BY 4.0 — Send for the Horses",
        "mood": ["飘渺", "忧伤", "梦境"], "scene": ["梦境", "告别", "回忆"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_ishikari_lore", "_url": f"{INC}/Ishikari%20Lore.mp3", "clip": 60,
        "title": "石狩",
        "description": "东方民谣调式的旋律。适合和风、妖怪题材、异世界、神社场景。",
        "tags": ["东方", "民谣", "和风"],
        "source": "Music by Kevin MacLeod (incompetech.com), Licensed under CC BY 4.0 — Ishikari Lore",
        "mood": ["古意", "悠远"], "scene": ["和风", "异世界", "神话题材"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_deliberate_thought", "_url": f"{INC}/Deliberate%20Thought.mp3", "clip": 60,
        "title": "沉思",
        "description": "69bpm 环绕合成器配人声垫，沉着冷静。适合犹豫、思考、独白、心理戏。",
        "tags": ["电子", "独白", "思考"],
        "source": "Music by Kevin MacLeod (incompetech.com), Licensed under CC BY 4.0 — Deliberate Thought",
        "mood": ["冷静", "沉思"], "scene": ["独白", "犹豫", "心理"], "loop": True, "volume": 0.45,
    }),
    bgm({
        "id": "bgm_sneaky_snitch", "_url": f"{INC}/Sneaky%20Snitch.mp3", "clip": 60,
        "title": "鬼鬼祟祟",
        "description": "双簧管加小鼓的俏皮「偷偷摸摸」。适合吐槽、恶作剧、搞笑日常、潜行小动作。",
        "tags": ["俏皮", "喜剧", "木管"],
        "source": "Music by Kevin MacLeod (incompetech.com), Licensed under CC BY 4.0 — Sneaky Snitch",
        "mood": ["俏皮", "滑稽"], "scene": ["吐槽", "搞笑", "恶作剧"], "loop": True, "volume": 0.45,
    }),
]

def sfx(eid: str, url: str, member: str, meta: dict, clip: float | None = None) -> Entry:
    return Entry("sfx", eid, Source(url, member), meta, clip=clip,
                 fade=BGM_FADE if clip is not None else 0.0,
                 audio={"b": SFX_BITRATE, "ac": 1})


UI_ZIP = f"{OGA}/kenney_interfaceSounds.zip"
RPG_ZIP = f"{OGA}/RPGsounds_Kenney.zip"
STEP_ZIP = f"{OGA}/%5Bkdd%5DDifferentSteps_0.zip"
YD_ZIP = f"{OGA}/yd-Sounds.zip"
RETRO_ZIP = f"{OGA}/The%20Essential%20Retro%20Video%20Game%20Sound%20Effects%20Collection%20%5B512%20sounds%5D.zip"

# 环境音/长拟音统一裁到 10 秒并做交叉淡化：既保住「可以一直响」的听感，又把 SFX 总量压进预算
AMBIENT_CLIP = 10.0

SFX_ENTRIES = [
    sfx("sfx_ui_click", UI_ZIP, "Audio/click_003.ogg", {
        "title": "界面点击", "description": "短促清脆的按键点击，没有环境底噪。选项按钮与文字推进的主力音。",
        "tags": ["UI", "点击"], "source": "OpenGameArt / Kenney / CC0", "mood": ["中性"], "scene": ["界面", "交互"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_ui_confirm", UI_ZIP, "Audio/confirmation_001.ogg", {
        "title": "确认", "description": "上扬的双音确认音。提交、达成、同意。",
        "tags": ["UI", "确认"], "source": "OpenGameArt / Kenney / CC0", "mood": ["轻快"], "scene": ["界面", "达成"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_ui_back", UI_ZIP, "Audio/back_002.ogg", {
        "title": "返回", "description": "下降音。返回、取消、退出菜单。",
        "tags": ["UI", "返回"], "source": "OpenGameArt / Kenney / CC0", "mood": ["中性"], "scene": ["界面", "返回"],
        "loop": False, "volume": 0.65}),
    sfx("sfx_ui_close", UI_ZIP, "Audio/close_002.ogg", {
        "title": "收束", "description": "收束音。面板关闭、对话窗收起。",
        "tags": ["UI", "关闭"], "source": "OpenGameArt / Kenney / CC0", "mood": ["中性"], "scene": ["界面", "收束"],
        "loop": False, "volume": 0.65}),
    sfx("sfx_page_flip", RPG_ZIP, "OGG/bookFlip2.ogg", {
        "title": "翻页", "description": "纸张翻动的干脆声。文字推进、内心独白翻页。",
        "tags": ["翻页", "纸"], "source": "OpenGameArt / Kenney / CC0", "mood": ["安静"], "scene": ["独白", "推进"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_book_open", RPG_ZIP, "OGG/bookOpen.ogg", {
        "title": "书翻开", "description": "书被翻开的声音。掀开日记、档案、笔记本。",
        "tags": ["书", "开"], "source": "OpenGameArt / Kenney / CC0", "mood": ["安静"], "scene": ["回忆", "调查"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_book_close", RPG_ZIP, "OGG/bookClose.ogg", {
        "title": "书合上", "description": "书合上的闷响。收束一段回忆或对话。",
        "tags": ["书", "合"], "source": "OpenGameArt / Kenney / CC0", "mood": ["安静"], "scene": ["回忆", "收束"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_page_place", RPG_ZIP, "OGG/bookPlace1.ogg", {
        "title": "书落桌", "description": "书落回桌面的轻响，给翻页动作一个收尾。",
        "tags": ["书", "落桌"], "source": "OpenGameArt / Kenney / CC0", "mood": ["安静"], "scene": ["日常", "收束"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_belt_handle", RPG_ZIP, "OGG/beltHandle1.ogg", {
        "title": "拉链", "description": "拉链/皮带扣的细碎声。换衣、收拾道具、准备出门。",
        "tags": ["换衣", "道具"], "source": "OpenGameArt / Kenney / CC0", "mood": ["日常"], "scene": ["准备", "出门"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_door_creak", f"{COMMONS}/7/74/Door_handle_creaking.ogg", "", {
        "title": "门把手", "description": "门把手转动的细碎吱声。犹豫着推开门的质感，比游戏音效真实得多。",
        "tags": ["门", "拟音"], "source": "Wikimedia Commons / Public domain", "mood": ["犹豫", "真实"], "scene": ["进门", "悬疑"],
        "loop": False, "volume": 0.75}),
    sfx("sfx_door_open", f"{COMMONS}/1/15/Squeaky_door.ogg", "", {
        "title": "开门", "description": "门轴吱呀的开门声。日常推门进屋。",
        "tags": ["门", "拟音"], "source": "Wikimedia Commons / Public domain", "mood": ["日常"], "scene": ["进门"],
        "loop": False, "volume": 0.75}),
    sfx("sfx_door_close_heavy", f"{COMMONS}/c/c2/Garage_door_closing.ogg", "", {
        "title": "重门落下", "description": "沉重金属门落下。宣告结束、把人隔绝在外。",
        "tags": ["门", "沉重"], "source": "Wikimedia Commons / Public domain", "mood": ["压迫", "沉重"], "scene": ["结束", "隔绝"],
        "loop": False, "volume": 0.75}),
    sfx("sfx_door_knock", f"{COMMONS}/7/7c/Door_knocker_audio.ogg", "", {
        "title": "敲门", "description": "门环敲击声。访客到访，引出对话里那个人。",
        "tags": ["门", "到访"], "source": "Wikimedia Commons / Mx. Granger / CC0", "mood": ["意外", "期待"], "scene": ["到访", "对话"],
        "loop": False, "volume": 0.75}),
    sfx("sfx_door_open_retro", RETRO_ZIP, "Movement/Opening Doors/sfx_movement_dooropen1.wav", {
        "title": "开门（8-bit）", "description": "8-bit 开门音，风格统一的游戏化版本。",
        "tags": ["门", "8bit", "游戏化"], "source": "OpenGameArt / Juhani Junkala / CC0", "mood": ["游戏化"], "scene": ["进门", "转场"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_step_wood", STEP_ZIP, "wood01.ogg", {
        "title": "木地板脚步", "description": "木地板上的脚步。教室、老宅走廊。",
        "tags": ["脚步", "木地板"], "source": "OpenGameArt / tinyworlds / CC0", "mood": ["日常"], "scene": ["教室", "走廊"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_step_stone", STEP_ZIP, "stone01.ogg", {
        "title": "石板脚步", "description": "石板路上的脚步。庭院、地下通道。",
        "tags": ["脚步", "石板"], "source": "OpenGameArt / tinyworlds / CC0", "mood": ["冷硬"], "scene": ["庭院", "地下"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_step_leaves", STEP_ZIP, "leaves01.ogg", {
        "title": "落叶脚步", "description": "踩在落叶上的声音。秋日林道。",
        "tags": ["脚步", "落叶"], "source": "OpenGameArt / tinyworlds / CC0", "mood": ["秋日"], "scene": ["林道", "郊外"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_step_gravel", STEP_ZIP, "gravel.ogg", {
        "title": "碎石脚步", "description": "碎石路上的脚步。山路、河滩。",
        "tags": ["脚步", "碎石"], "source": "OpenGameArt / tinyworlds / CC0", "mood": ["空旷"], "scene": ["山路", "郊外"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_step_mud", STEP_ZIP, "mud02.ogg", {
        "title": "泥泞脚步", "description": "踩在泥里的声音。雨后的乡道。",
        "tags": ["脚步", "泥泞"], "source": "OpenGameArt / tinyworlds / CC0", "mood": ["潮湿"], "scene": ["雨后", "乡道"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_step_stairs", YD_ZIP, "yd-Sounds/steps_stairs.ogg", {
        "title": "上楼梯", "description": "上楼梯的脚步。上学、回家、走进公寓。",
        "tags": ["脚步", "楼梯"], "source": "OpenGameArt / yd / CC0", "mood": ["日常"], "scene": ["回家", "上学"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_step_chain", YD_ZIP, "yd-Sounds/steps_chain.ogg", {
        "title": "铁链脚步", "description": "拖着铁链的脚步。监牢、地牢。",
        "tags": ["脚步", "铁链"], "source": "OpenGameArt / yd / CC0", "mood": ["阴冷", "压迫"], "scene": ["地牢", "囚禁"],
        "loop": False, "volume": 0.75}),
    sfx("sfx_heartbeat_slow", f"{OGA}/heartbeat_slow_0.wav", "", {
        "title": "慢心跳", "description": "一秒多一下的慢心跳。平静之下的暗涌、告白前的心悸。",
        "tags": ["心跳", "生理"], "source": "OpenGameArt / bart / CC0", "mood": ["心跳", "暗涌"], "scene": ["告白", "紧张"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_heartbeat_fast", f"{OGA}/heartbeat_fast_0.wav", "", {
        "title": "快心跳", "description": "急促心跳。紧张、恐惧、濒死。",
        "tags": ["心跳", "生理"], "source": "OpenGameArt / bart / CC0", "mood": ["恐惧", "急促"], "scene": ["恐惧", "危机"],
        "loop": False, "volume": 0.75}),
    sfx("sfx_heartbeat_reverb", f"{OGA}/heartbeat_slow_reverb.wav", "", {
        "title": "回响心跳", "description": "带回响的心跳，像隔着水听到的。闪回、幻听、记忆抽离。",
        "tags": ["心跳", "回响"], "source": "OpenGameArt / bart / CC0", "mood": ["恍惚", "幻听"], "scene": ["闪回", "幻听"],
        "loop": False, "volume": 0.7}),
    sfx("sfx_typing_medium", f"{COMMONS}/3/34/Typing_medium_speed.ogg", "", {
        "title": "打字（真实）", "description": "中速真实打字声。手机消息、终端输入、聊天界面。",
        "tags": ["打字", "键盘"], "source": "Wikimedia Commons / Public domain", "mood": ["日常"], "scene": ["聊天", "输入"],
        "loop": True, "volume": 0.6}, clip=AMBIENT_CLIP),
    sfx("sfx_typing_keyboard", f"{COMMONS}/5/51/Typing_-_Model_M13_1999.ogg", "", {
        "title": "机械键盘", "description": "清脆的机械键盘敲击。工位、深夜写代码。",
        "tags": ["打字", "机械键盘"], "source": "Wikimedia Commons / CC0", "mood": ["清脆"], "scene": ["工位", "输入"],
        "loop": True, "volume": 0.6}, clip=AMBIENT_CLIP),
    sfx("sfx_clock_tick", f"{COMMONS}/5/56/Clock_ticking.ogg", "", {
        "title": "钟表滴答", "description": "钟表的滴答声。空教室、时间流逝的压迫。",
        "tags": ["钟", "时间"], "source": "Wikimedia Commons / natalie / Public domain", "mood": ["流逝", "空旷"], "scene": ["教室", "等待"],
        "loop": True, "volume": 0.6}, clip=AMBIENT_CLIP),
    sfx("sfx_wind_chime", f"{COMMONS}/2/28/Windchime.ogg", "", {
        "title": "风铃", "description": "实地录的风铃长音。夏日庭院、神社、午后的闲适。",
        "tags": ["风铃", "夏日"], "source": "Wikimedia Commons / stephan / Public domain", "mood": ["闲适", "夏日"], "scene": ["庭院", "日常"],
        "loop": True, "volume": 0.6}, clip=AMBIENT_CLIP),
    sfx("sfx_rain", f"{COMMONS}/0/0e/Rain_%281%29.ogg", "", {
        "title": "雨声", "description": "稳定的雨声底。窗外在下雨、屋檐下避雨。",
        "tags": ["雨", "环境音"], "source": "Wikimedia Commons / Public domain", "mood": ["安静", "潮湿"], "scene": ["雨", "独处"],
        "loop": True, "volume": 0.6}, clip=AMBIENT_CLIP),
    sfx("sfx_rain_thunder", f"{COMMONS}/4/42/Rain_and_thunder.ogg", "", {
        "title": "雨夹雷", "description": "雨里夹着雷声。天气突变、剧情转折。",
        "tags": ["雨", "雷", "天气"], "source": "Wikimedia Commons / Public domain", "mood": ["转折", "不安"], "scene": ["天气", "转折"],
        "loop": True, "volume": 0.65}, clip=AMBIENT_CLIP),
    sfx("sfx_wave", f"{OGA}/wave_01_cc0-11505__transitking__wavesound.flac", "", {
        "title": "海浪", "description": "海浪拍岸。海边、港口、回忆闪回。",
        "tags": ["海", "水", "环境音"], "source": "OpenGameArt / transitking / CC0", "mood": ["辽阔", "怀旧"], "scene": ["海边", "回忆"],
        "loop": True, "volume": 0.6}, clip=AMBIENT_CLIP),
    sfx("sfx_fire_crackle", f"{OGA}/fire.wav", "", {
        "title": "壁炉噼啪", "description": "壁炉/篝火的噼啪声。冬夜、营火、祖父家。",
        "tags": ["火", "冬夜", "环境音"], "source": "OpenGameArt / pagdev / CC0", "mood": ["温暖", "冬夜"], "scene": ["冬夜", "回忆", "室内"],
        "loop": True, "volume": 0.6}, clip=AMBIENT_CLIP),
    sfx("sfx_water_drip", f"{OGA}/atmosbasement.mp3_.flac", "", {
        "title": "地下水滴", "description": "地下水滴的回响。地下室、地牢、密室。",
        "tags": ["水滴", "地下", "环境音"], "source": "OpenGameArt / CC0", "mood": ["潮湿", "幽闭"], "scene": ["地下室", "地牢"],
        "loop": True, "volume": 0.65}, clip=AMBIENT_CLIP),
]

FOREST_ZIP = f"{OGA}/parallax_forest_pack.zip"
MOUNTAIN_ZIP = f"{OGA}/parallax_mountain_pack.zip"
MAGIC_ZIP = f"{OGA}/Magic-Cliffs-Environment.zip"

BG_ENTRIES = [
    Entry("backgrounds", "bg_photo_night_city", Source(f"{COMMONS}/a/aa/Melbourne_at_night_from_the_International_Space_Station.jpg"), {
        "title": "夜城灯火",
        "description": "从国际空间站拍下的夜间城市灯火天际线。实拍照片质感，不是二次元画。适合都市夜景、终章、俯瞰全城的那一幕。",
        "tags": ["夜景", "都市", "实拍照片"],
        "source": "Wikimedia Commons / NASA (Melbourne at night from the ISS) / CC0",
    }, image_filter="[0]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1"),
    Entry("backgrounds", "bg_photo_forest_path", Source(f"{COMMONS}/2/26/Forest_path%2C_%C3%85nnaboda.jpg"), {
        "title": "林间小径",
        "description": "林间土路的实拍照片，原图 6016×4000。适合郊外远足、记忆闪回、走到林子深处。",
        "tags": ["树林", "郊外", "实拍照片"],
        "source": "Wikimedia Commons / Ånnaboda forest path / CC0",
    }, image_filter="[0]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1"),
    Entry("backgrounds", "bg_photo_sunset", Source("https://live.staticflickr.com/6040/6249263074_2e411529e6_b.jpg"), {
        "title": "落日",
        "description": "落日天空的实拍照片。原始素材只有 1024×594，放大到 1920×1080 后细节偏软，适合天空/地平线类的空景。",
        "tags": ["黄昏", "天空", "实拍照片"],
        "source": "Openverse 检索（license=cc0）/ Flickr / CC0",
    }, image_filter="[0]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1"),
    Entry("backgrounds", "bg_photo_corridor", Source(
        f"{COMMONS}/9/98/Tejgaon_Government_High_School_Corridor_of_the_North_Building_%282025%29.jpg"), {
        "title": "学校走廊",
        "description": "中学教学楼走廊的实拍照片（原图竖幅 3072×4096，取中部横带裁成 16:9）。是热带国家的高中走廊，不是日式校园；适合上学、放学、课间的走廊戏。",
        "tags": ["走廊", "学校", "实拍照片"],
        "source": "Wikimedia Commons / Sajid Ahmed Nijhu / CC0",
    }, image_filter="[0]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1"),
    # —— 以下三个是像素/视差素材包：原包是多张图层 PNG，条目只允许一个文件，所以按 z 序压平成一张 ——
    Entry("backgrounds", "bg_parallax_forest", Source(FOREST_ZIP, "parallax-forest-back-trees.png"), {
        "title": "林间（像素视差合成）",
        "description": "像素画风的视差森林背景，由原包四张图层（后树/中树/前树/光晕）压平而成，再用最近邻放大到 1920×1080——是刻意的粗颗粒像素质感，不是二次元手绘。适合林道、郊外、童话式森林。",
        "tags": ["像素画", "森林", "视差合成"],
        "source": "OpenGameArt / Luis Zuno (ansimuz) / CC0",
    }, layers=[
        Source(FOREST_ZIP, "parallax-forest-back-trees.png"),
        Source(FOREST_ZIP, "parallax-forest-middle-trees.png"),
        Source(FOREST_ZIP, "parallax-forest-front-trees.png"),
        Source(FOREST_ZIP, "parallax-forest-lights.png"),
    ], image_filter="[0][1]overlay[a];[a][2]overlay[b];[b][3]overlay,scale=1920:1080:flags=neighbor,setsar=1"),
    Entry("backgrounds", "bg_parallax_mountain", Source(MOUNTAIN_ZIP, "parallax-mountain-bg.png"), {
        "title": "山夜（像素视差合成）",
        "description": "像素画风的视差山景背景，由原包五张图层（天/远山/山/树/前景树）压平而成，最近邻放大到 1920×1080，保留粗颗粒像素感。适合山道、露营、月夜场景。",
        "tags": ["像素画", "山", "夜景", "视差合成"],
        "source": "OpenGameArt / Luis Zuno (ansimuz) / CC0",
    }, layers=[
        Source(MOUNTAIN_ZIP, "parallax-mountain-bg.png"),
        Source(MOUNTAIN_ZIP, "parallax-mountain-montain-far.png"),
        Source(MOUNTAIN_ZIP, "parallax-mountain-mountains.png"),
        Source(MOUNTAIN_ZIP, "parallax-mountain-trees.png"),
        Source(MOUNTAIN_ZIP, "parallax-mountain-foreground-trees.png"),
    ], image_filter="[0]scale=544:160:flags=neighbor[z0];[1]scale=544:160:flags=neighbor[z1];"
                    "[z0][z1]overlay[a];[a][2]overlay[b];[b][3]overlay[c];[c][4]overlay,"
                    "scale=1920:1080:flags=neighbor,setsar=1"),
    Entry("backgrounds", "bg_magic_cliffs", Source(MAGIC_ZIP, "PNG/sky.png"), {
        "title": "魔法悬崖（像素合成）",
        "description": "奇幻悬崖环境的像素画背景，由原包的天空/云/远景三层拉成 16:9 合成的。适合异世界、悬崖、天与地平线分层的奇幻场景。",
        "tags": ["像素画", "奇幻", "天空", "悬崖"],
        "source": "Magic Cliffs Environment by Luis Zuno (ansimuz.com), Licensed under CC BY 3.0",
    }, layers=[
        Source(MAGIC_ZIP, "PNG/sky.png"),
        Source(MAGIC_ZIP, "PNG/clouds.png"),
        Source(MAGIC_ZIP, "PNG/far-grounds.png"),
    ], image_filter="[0]scale=1920:1080:flags=lanczos[sk];[1]scale=1920:834:flags=neighbor[cl];"
                    "[2]scale=1920:343:flags=neighbor[fg];[sk][cl]overlay=0:40[a];[a][fg]overlay=0:737,setsar=1"),
]

# bg_hd_parallax_glitch 故意不收：Glitch parallex BG sampler 是 Starling 工程的图层包，
# 图层要靠包内 XML 的 staging 参数对位，硬压平会露出大面积色块空洞（已实测两种压法都坏）。
# 宁可不放，也不放一张看着是坏的图。详见 260930-asset-library/seed-sources.research.md §2.3。
SKIPPED = {
    "bg_hd_parallax_glitch": "Glitch 视差包是多图层 Starling 工程，缺 staging 参数无法正确对位，"
                             "压平后底部有大面积空洞；不入库等有单张成图再补。",
}

ALL_ENTRIES = BGM_ENTRIES + SFX_ENTRIES + BG_ENTRIES


# ---------------------------------------------------------------- 工具

def run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{cmd[0]} 失败：{result.stderr.strip()[:400]}")


def fetch(url: str, cache: Path) -> Path:
    """下载到缓存（命中即复用），返回本地路径。"""
    key = hashlib.sha1(url.encode()).hexdigest()[:16]
    name = urllib.parse.unquote(url.rsplit("/", 1)[-1]) or "download"
    name = "".join(c for c in name if c.isalnum() or c in "._- ")[:80]
    dest = cache / f"{key}-{name}"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    cache.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    cmd = ["curl", "-sSL", "--fail", "--max-time", "600", "--retry", "2", "-A", UA, "-o", str(tmp), url]
    try:
        run(cmd)
        if not tmp.exists() or tmp.stat().st_size == 0:
            raise RuntimeError("下载到空文件")
        tmp.replace(dest)
    finally:
        if tmp.exists():
            tmp.unlink()
    if "upload.wikimedia.org" in url:
        time.sleep(WIKI_PAUSE)  # 描述性 UA 之外还得压频率，否则照样随机 429
    return dest


def extract_member(archive: Path, member: str, out_dir: Path) -> Path:
    """从 zip 里按路径后缀取一个成员；跳过 macOS 资源叉与 .DS_Store。"""
    import zipfile

    with zipfile.ZipFile(archive) as zf:
        names = [n for n in zf.namelist()
                 if "__MACOSX" not in n and not n.split("/")[-1].startswith("._")
                 and not n.split("/")[-1].endswith(".DS_Store") and not n.endswith("/")]
        match = next((n for n in names if n.endswith(member)), None)
        if match is None:
            raise RuntimeError(f"{archive.name} 里没有成员 {member}（现有 {len(names)} 个）")
        out_dir.mkdir(parents=True, exist_ok=True)
        dest = out_dir / f"{hashlib.sha1(match.encode()).hexdigest()[:8]}-{Path(match).name}"
        if not dest.exists():
            dest.write_bytes(zf.read(match))
        return dest


def probe_duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True)
    return round(float(result.stdout.strip()), 2)


def encode_audio(entry: Entry, src: Path, dest: Path) -> None:
    clip = entry.clip
    filters = []
    if clip is not None:
        filters.append(f"atrim=0:{clip:.3f},asetpts=N/SR/TB")
    fade = entry.fade
    if entry.clip is not None and entry.fade > 0:
        filters.append(f"afade=t=in:st=0:d={fade}")
        filters.append(f"afade=t=out:st={entry.clip - fade:.3f}:d={fade}")
    elif entry.meta.get("loop") and fade > 0:
        filters.append(f"afade=t=in:st=0:d={FULL_FADE}")
        filters.append("areverse,afade=t=in:st=0:d=0.03,areverse")
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src)]
    if filters:
        cmd += ["-af", ",".join(filters)]
    # incompetech 的 mp3 内嵌封面 PNG：ffmpeg 默认流选择会把它一起拷进输出，单这一条就多几百 KB，
    # 实测 night_vigil 因此从 128k 涨到 196k。只取第一条音轨并显式禁掉视频，体积才等于码率×时长。
    cmd += ["-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", entry.audio["b"],
            "-ac", str(entry.audio["ac"]), str(dest)]
    run(cmd)


def encode_image(entry: Entry, inputs: list[Path], dest: Path) -> None:
    cmd = ["ffmpeg", "-y", "-v", "error"]
    for path in inputs:
        cmd += ["-i", str(path)]
    cmd += ["-filter_complex", entry.image_filter, "-frames:v", "1"]
    for quality in BG_QUALITIES:
        tmp = dest.with_suffix(".tmp.jpg")
        run(cmd + ["-q:v", str(quality), str(tmp)])
        if tmp.stat().st_size <= BG_MAX_BYTES or quality == BG_QUALITIES[-1]:
            tmp.replace(dest)
            return
        tmp.unlink()


def write_meta(entry: Entry, duration: float | None) -> None:
    meta = dict(entry.meta)
    if duration is not None:
        meta["durationSec"] = int(round(duration))
    order = ["title", "description", "tags", "source", "mood", "scene",
             "durationSec", "loop", "volume", "character", "expressions"]
    ordered = {k: meta[k] for k in order if k in meta}
    ordered.update({k: v for k, v in meta.items() if k not in ordered})
    target = LIBRARY / entry.kind / entry.id / "meta.json"
    target.write_text(json.dumps(ordered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- 主流程

def process(entry: Entry, cache: Path, work: Path, force: bool) -> tuple[bool, str]:
    out_dir = LIBRARY / entry.kind / entry.id
    ext = ".jpg" if entry.kind == "backgrounds" else ".mp3"
    media = out_dir / f"{entry.id}{ext}"
    meta_file = out_dir / "meta.json"

    if not force and media.exists() and meta_file.exists() and media.stat().st_size > 0:
        return True, "skip"

    sources = entry.layers or [entry.source]  # 多图层包走 layers，单图走 source
    resolved: list[Path] = []
    for index, src in enumerate(sources):
        local = fetch(src.url, cache)
        resolved.append(extract_member(local, src.zip_member, work) if src.zip_member else local)
        if index < len(sources) - 1 and "upload.wikimedia.org" in src.url:
            time.sleep(WIKI_PAUSE)

    out_dir.mkdir(parents=True, exist_ok=True)
    tmp_media = work / f"{entry.id}{ext}"
    if entry.kind == "backgrounds":
        encode_image(entry, resolved, tmp_media)
    else:
        encode_audio(entry, resolved[0], tmp_media)
    shutil.move(str(tmp_media), str(media))
    write_meta(entry, probe_duration(media) if entry.kind != "backgrounds" else None)
    return True, "done"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=["bgm", "sfx", "backgrounds"], action="append")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--cache", default="/tmp/aivn-seed-cache")
    args = parser.parse_args()

    cache = Path(args.cache)
    work = cache / f"work-{os.getpid()}"  # 按进程隔离：并发跑不同 kind 时别互删临时目录
    work.mkdir(parents=True, exist_ok=True)

    try:
        entries = [e for e in ALL_ENTRIES if not args.kind or e.kind in args.kind]
        results: dict[str, list[str]] = {"bgm": [], "sfx": [], "backgrounds": []}
        failures: list[tuple[str, str]] = []

        for entry in entries:
            try:
                _, how = process(entry, cache, work, args.force)
                results[entry.kind].append("skipped" if how == "skip" else "ok")
                print(f"  {how:>5}  {entry.kind}/{entry.id}", flush=True)
            except Exception as exc:  # 单条失败不该拖垮整批
                results[entry.kind].append("fail")
                failures.append((f"{entry.kind}/{entry.id}", str(exc)[:200]))
                print(f"  FAIL  {entry.kind}/{entry.id}: {exc}", flush=True)
            finally:
                shutil.rmtree(work, ignore_errors=True)
                work.mkdir(parents=True, exist_ok=True)

        print("\n=== 落盘统计 ===")
        grand = 0
        for kind, states in results.items():
            ext = ".jpg" if kind == "backgrounds" else ".mp3"
            landed = [e.id for e in ALL_ENTRIES if e.kind == kind
                      and (LIBRARY / kind / e.id / f"{e.id}{ext}").exists()]
            total = sum((LIBRARY / kind / i / f"{i}{ext}").stat().st_size for i in landed)
            grand += total
            done = states.count("ok")
            print(f"  {kind:<12} {len(landed):>3} 条（本轮新做 {done}，已存在 {states.count('skipped')}，"
                  f"失败 {states.count('fail')}）  {total / 1e6:8.2f} MB")
        print(f"  {'合计':<11} {'':>3}                        {grand / 1e6:8.2f} MB")
    finally:
        shutil.rmtree(work, ignore_errors=True)  # 退出时清干净，别把临时目录留在缓存里

    if SKIPPED:
        print("\n=== 主动不收（清单里列出但本次不做） ===")
        for eid, why in SKIPPED.items():
            print(f"  {eid}: {why}")

    if failures:
        print("\n=== 失败（已跳过，未落任何文件） ===")
        for eid, why in failures:
            print(f"  {eid}: {why}")
        return 1
    print("\n全部条目处理完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
