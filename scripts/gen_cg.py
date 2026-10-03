#!/usr/bin/env python3
"""
scripts/gen_cg.py - Galgame Scene Background & Event CG Generator
================================================================
AIVN Asset Pipeline component for generating 16:9 cinematic visual novel
backgrounds and emotional Event CGs.

Features:
- 10 battle-tested classic Galgame scene & event presets (8 Backgrounds + 2 Event CGs).
- Style anchoring for Japanese anime aesthetics (Makoto Shinkai / Kyoto Animation / Light Novel).
- Automated 16:9 aspect ratio cropping/scaling to standard FHD (1920x1080).
- Metadata manifest export for AIVN engine integration.
"""

import os
import sys
import argparse
import json
import time
import io
import base64
from pathlib import Path
from typing import Dict, Any, Optional

import requests
from PIL import Image

CPA_URL = os.getenv("CPA_URL", "http://127.0.0.1:9999/v1/chat/completions")
CPA_API_KEY = os.getenv("CPA_API_KEY", "sk-1234")
MODEL_NAME = os.getenv("IMAGE_MODEL", "gemini-3.1-flash-image")

STYLE_MODIFIERS = {
    "shinkai": (
        "Makoto Shinkai style, CoMix Wave Films aesthetic, dramatic cloud rendering, "
        "vibrant chromatic gradation, hyper-detailed background art, cinematic volumetric light rays, "
        "atmospheric depth, photorealistic anime textures"
    ),
    "kyoani": (
        "Kyoto Animation aesthetic, soft diffused lighting, delicate pastel color palette, "
        "warm emotional atmosphere, exquisite architectural and nature details, gentle nostalgic blur"
    ),
    "lightnovel": (
        "Contemporary Japanese visual novel official art, vibrant cel-shaded color scheme, "
        "crisp clean line art, high contrast studio lighting, dynamic cinematic angle"
    ),
}

PRESETS: Dict[str, Dict[str, Any]] = {
    # --- Category A: Scene Backgrounds (8 Classic Stages) ---
    "bg_classroom_sunset": {
        "title": "黄昏放学后的高中教室 (Classroom at Sunset)",
        "type": "bg",
        "description": "Empty Japanese high school classroom after school at golden hour sunset.",
        "prompt": (
            "Empty Japanese high school classroom after school at sunset, golden hour. "
            "Warm amber and orange sunlight streaming through tall rectangular windows, "
            "casting long diagonal shadows across rows of empty wooden student desks and chairs. "
            "Light cream-colored curtains gently fluttering in the evening breeze. "
            "Chalkboard at front with faintly erased math formulas, wall clock reading 5:15 PM. "
            "Nostalgic quiet atmosphere, hyper-detailed anime background art, no people."
        ),
    },
    "bg_school_gate_sakura": {
        "title": "飘落樱花的学校坡道校门 (School Gate Slope with Cherry Blossoms)",
        "type": "bg",
        "description": "School entrance slope lined with blooming cherry blossoms in spring.",
        "prompt": (
            "Sloping asphalt road leading up to a Japanese high school iron front gate in spring morning. "
            "Lined with gigantic blooming cherry blossom trees (sakura), soft pink petals swirling and drifting "
            "in the gentle morning breeze, road sprinkled with pink petals. "
            "Clean blue sky with wispy morning clouds, bright crisp sunlight casting leaf shadows on asphalt. "
            "Modern Japanese school building visible in background, no people, masterpiece anime background."
        ),
    },
    "bg_rooftop_breeze": {
        "title": "午后微风徐徐的学校天台 (School Rooftop Breeze)",
        "type": "bg",
        "description": "Open school rooftop overlooking coastal town on a bright summer afternoon.",
        "prompt": (
            "School rooftop overlooking a picturesque coastal town and distant sparkling ocean. "
            "Tall chain-link security fence surrounding the rooftop perimeter, gray concrete floor with utility pipes. "
            "Silver water tower and ventilation ducts in corner. "
            "Brilliant azure summer sky filled with gigantic billowing white cumulus clouds, "
            "vibrant summer sunlight, lens flare, crisp gentle breeze, no people, scenic visual novel background."
        ),
    },
    "bg_starry_breakwater": {
        "title": "夜晚繁星点点的海边防波堤 (Starry Seaside Breakwater)",
        "type": "bg",
        "description": "Seaside breakwater and concrete tetrapods under a starry night sky.",
        "prompt": (
            "Seaside concrete breakwater and tetrapods jutting into the calm night ocean. "
            "Breathtaking celestial sky filled with the luminous Milky Way galaxy, thousands of twinkling stars, "
            "and a shooting star streak. "
            "Gentle ocean waves reflecting silvery starlight and moonlight, distant white lighthouse beam on horizon. "
            "Deep indigo and navy blue color harmony, magical tranquil atmosphere, highly detailed anime scenery, no people."
        ),
    },
    "bg_library_sunlight": {
        "title": "阳光穿透落地窗的图书馆角落 (Library Sunlight Reading Corner)",
        "type": "bg",
        "description": "Peaceful school library reading nook illuminated by afternoon sunbeams.",
        "prompt": (
            "Quiet corner of an old school library with soaring dark oak bookshelves packed with colorful hardcovers. "
            "Tall arched glass windows letting in dramatic slanting sunbeams with visible floating dust motes. "
            "A sturdy polished wooden reading table with a vintage green banker lamp and an open notebook. "
            "Warm amber ambient lighting, cozy serene academic atmosphere, highly detailed interior anime background, no people."
        ),
    },
    "bg_shrine_steps": {
        "title": "夏日蝉鸣的传统神社鸟居与石阶 (Summer Shinto Shrine Stone Steps)",
        "type": "bg",
        "description": "Ancient mossy stone steps and vermilion torii gate in a cedar forest.",
        "prompt": (
            "Ancient stone staircase leading up through a dense emerald green cedar forest to a traditional Shinto shrine. "
            "A magnificent vibrant vermilion red torii gate standing at the landing, stone lantern poles covered with moss. "
            "Dappled golden sunlight filtering through the dense leafy canopy, summer cicada atmosphere. "
            "Clean fallen leaves on steps, sacred and peaceful Japanese rural aesthetic, no people."
        ),
    },
    "bg_rainy_station": {
        "title": "细雨霏霏的电车站台 (Rainy Train Station Platform)",
        "type": "bg",
        "description": "Rural Japanese train station platform on a melancholic rainy afternoon.",
        "prompt": (
            "Rural Japanese railway station outdoor platform under a misty gentle afternoon rain. "
            "Wet concrete ground reflecting yellow tactile safety tiles and platform lights with glossy puddles. "
            "Corrugated metal canopy with rain droplets dripping from edge, railway tracks stretching into distance. "
            "Mist-shrouded green pine mountains across the tracks, cool desaturated blue and slate gray palette, "
            "poetic melancholic solitude, no people."
        ),
    },
    "bg_heroine_bedroom": {
        "title": "暖色灯光的温馨女主角卧室 (Warm Cozy Heroine Bedroom)",
        "type": "bg",
        "description": "Cute and cozy teenage anime girl bedroom at twilight with warm ambient lights.",
        "prompt": (
            "Cozy and aesthetic teenage anime girl bedroom in the evening. "
            "Neatly made bed with pastel mint and pink blankets, cute stuffed plushies propped against pillows. "
            "Wooden study desk with warm fairy string lights, laptop, stationery holder, and small potted succulent. "
            "Bookshelf stocked with manga and light novels, sheer white window curtains partially drawn showing twilight sky outside. "
            "Warm soft indoor lighting, intimate lived-in feel, ultra-detailed anime interior background, no people."
        ),
    },

    # --- Category B: Event CGs (2 Key Climactic Moments) ---
    "cg_rooftop_confession": {
        "title": "天台递告白信的决定性瞬间 (Rooftop Love Letter Confession)",
        "type": "cg",
        "description": "Emotional climax: Heroine Koharu timidly hands over a sealed love letter at sunset.",
        "prompt": (
            "Cinematic 16:9 visual novel Event CG, emotional climax scene. "
            "School rooftop at golden hour sunset with warm orange rim lighting and lens flares. "
            "Cute 17-year-old anime girl Koharu standing close to camera, holding a pastel envelope sealed with a heart sticker with both hands, "
            "timidly extending it forward towards the viewer. "
            "Deep crimson blush on her cheeks, glistening emerald green eyes full of anticipation and vulnerability, "
            "soft pink hair and white uniform ribbons fluttering in the evening breeze. "
            "Cinematic depth of field, blurred sunset background with wire mesh fence and clouds, heart-throbbing romantic atmosphere."
        ),
    },
    "cg_rain_umbrella": {
        "title": "雨夜共撑一把伞避雨 (Sharing Umbrella in the Rain)",
        "type": "cg",
        "description": "Intimate Event CG: Heroine and protagonist huddled together under one umbrella on a rainy night.",
        "prompt": (
            "Cinematic 16:9 visual novel Event CG, intimate romantic scene on a rainy street at night. "
            "Close-up portrait of cute anime girl Koharu standing side-by-side with the protagonist, "
            "huddled closely under a single transparent vinyl umbrella. "
            "Raindrops splashing on the curved umbrella surface, golden streetlights and neon signs reflecting in wet puddles behind them. "
            "Her cheeks flushed pink from cold and closeness, sparkling emerald eyes looking up at viewer with affectionate shy gaze, "
            "breath condensing lightly in cool evening air. "
            "Cinematic dramatic lighting, shallow depth of field, romantic cozy tension."
        ),
    },
}


def fit_to_16_9(img: Image.Image, target_size=(1920, 1080)) -> Image.Image:
    """
    Crops and resizes image to exact 16:9 widescreen FHD (1920x1080)
    using center crop and high-quality Lanczos resampling.
    """
    tw, th = target_size
    target_ratio = tw / th
    w, h = img.size
    current_ratio = w / h

    if current_ratio > target_ratio:
        # Image is wider: crop sides
        new_w = int(h * target_ratio)
        offset_x = (w - new_w) // 2
        cropped = img.crop((offset_x, 0, offset_x + new_w, h))
    else:
        # Image is taller: crop top/bottom slightly
        new_h = int(w / target_ratio)
        offset_y = (h - new_h) // 2
        cropped = img.crop((0, offset_y, w, offset_y + new_h))

    return cropped.resize((tw, th), Image.Resampling.LANCZOS)


def call_siliconflow_generation(prompt: str, size: str = "1024x576") -> bytes:
    """Fallback generator using SiliconFlow API when CPA gateway is unavailable or rate-limited."""
    import subprocess
    try:
        sf_key = subprocess.check_output(["api-vault", "get", "siliconflow", "key"], text=True).strip()
    except Exception:
        sf_key = os.getenv("SILICONFLOW_API_KEY", "")

    if not sf_key:
        raise RuntimeError("No SiliconFlow API key available in api-vault or environment.")

    print(f"[Fallback] Generating via SiliconFlow (Tongyi-MAI/Z-Image-Turbo, {size})...")
    resp = requests.post(
        "https://api.siliconflow.cn/v1/images/generations",
        headers={"Authorization": f"Bearer {sf_key}", "Content-Type": "application/json"},
        json={
            "model": "Tongyi-MAI/Z-Image-Turbo",
            "prompt": prompt,
            "image_size": size,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    img_url = data["images"][0]["url"]
    img_resp = requests.get(img_url, timeout=30)
    img_resp.raise_for_status()
    return img_resp.content


def call_image_generation(prompt: str, timeout: int = 120, max_retries: int = 2) -> bytes:
    """Calls image generation endpoint via SSE streaming with automatic fallback to SiliconFlow."""
    payload = {
        "model": MODEL_NAME,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
        "max_tokens": 300,
    }

    try:
        for attempt in range(max_retries):
            try:
                resp = requests.post(
                    CPA_URL,
                    headers={"Authorization": f"Bearer {CPA_API_KEY}", "Content-Type": "application/json"},
                    json=payload,
                    stream=True,
                    timeout=timeout,
                )
                if resp.status_code in (429, 500, 502, 503, 504):
                    print(f"[CPA Gateway HTTP {resp.status_code}] Switching to SiliconFlow fallback...")
                    return call_siliconflow_generation(prompt)
                resp.raise_for_status()

                for line in resp.iter_lines():
                    if not line:
                        continue
                    line_str = line.decode("utf-8", errors="ignore")
                    if not line_str.startswith("data:"):
                        continue
                    data_str = line_str[5:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        obj = json.loads(data_str)
                        imgs = obj.get("choices", [{}])[0].get("delta", {}).get("images", [])
                        for im in imgs:
                            url = im.get("image_url", {}).get("url", "")
                            if url.startswith("data:image/jpeg;base64,"):
                                raw = base64.b64decode(url.split(",", 1)[1])
                                return raw
                    except Exception:
                        pass
            except requests.exceptions.RequestException:
                if attempt == max_retries - 1:
                    raise
                time.sleep(3)
    except Exception as e:
        print(f"[CPA Gateway Exception: {e}] Falling back to SiliconFlow...")
        return call_siliconflow_generation(prompt)

    return call_siliconflow_generation(prompt)


def generate_scene(
    preset_id: str,
    style: str = "shinkai",
    extra_prompt: str = "",
    output_dir: Optional[str] = None,
) -> Path:
    """Generates a single background or event CG by preset ID."""
    if preset_id not in PRESETS:
        raise ValueError(f"Unknown preset id: '{preset_id}'. Run with --list to view all available presets.")

    preset = PRESETS[preset_id]
    style_text = STYLE_MODIFIERS.get(style, STYLE_MODIFIERS["shinkai"])

    full_prompt = (
        f"Masterpiece 16:9 cinematic widescreen illustration. "
        f"{preset['prompt']} "
        f"{style_text}. "
        f"{extra_prompt}".strip()
    )

    worktree_root = Path(__file__).resolve().parent.parent
    if output_dir:
        dest_dir = Path(output_dir)
    else:
        dest_dir = worktree_root / "assets" / ("backgrounds" if preset["type"] == "bg" else "cg")
    dest_dir.mkdir(parents=True, exist_ok=True)

    dest_file = dest_dir / f"{preset_id}.jpg"

    print(f"\n[Generating {preset['type'].upper()}] {preset_id}: {preset['title']}")
    print(f"Style: {style}")
    print(f"Destination: {dest_file}")

    start_t = time.time()
    raw_bytes = call_image_generation(full_prompt)

    # Process and crop to exact 1920x1080 16:9
    with Image.open(io.BytesIO(raw_bytes)) as img:
        fitted = fit_to_16_9(img, (1920, 1080))
        fitted.convert("RGB").save(dest_file, format="JPEG", quality=95)

    print(f"[OK] Saved {dest_file.name} (1920x1080 FHD) in {time.time()-start_t:.1f}s")
    return dest_file


def list_presets():
    """Prints all 10 presets cleanly."""
    print("\n=== AIVN Galgame 10 Classic Background & Event CG Presets ===")
    print("\n--- Category A: Scene Backgrounds (无人物舞台背景) ---")
    for pid, p in PRESETS.items():
        if p["type"] == "bg":
            print(f"  • {pid:<24} | {p['title']}")
            print(f"    Desc: {p['description']}")
    print("\n--- Category B: Event CGs (含关键角色剧情高潮CG) ---")
    for pid, p in PRESETS.items():
        if p["type"] == "cg":
            print(f"  • {pid:<24} | {p['title']}")
            print(f"    Desc: {p['description']}")
    print("=" * 66 + "\n")


def write_manifest(worktree_root: Path):
    """Writes an aggregated manifest file of all available scene presets."""
    manifest_data = {
        "version": "1.0.0",
        "aspect_ratio": "16:9",
        "standard_resolution": [1920, 1080],
        "styles": list(STYLE_MODIFIERS.keys()),
        "presets": PRESETS,
    }
    manifest_path = worktree_root / "assets" / "scene_presets.json"
    manifest_path.write_text(json.dumps(manifest_data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[OK] Scene presets manifest written to {manifest_path}")


def main():
    parser = argparse.ArgumentParser(
        description="AIVN Galgame Scene Background & Event CG Generator"
    )
    parser.add_argument("--list", action="store_true", help="List all 10 classic presets and exit")
    parser.add_argument(
        "--id",
        help="Preset identifier to generate (e.g. bg_classroom_sunset, cg_rooftop_confession, or 'all')",
    )
    parser.add_argument(
        "--style",
        choices=["shinkai", "kyoani", "lightnovel"],
        default="shinkai",
        help="Visual style anchor (default: shinkai)",
    )
    parser.add_argument("--extra-prompt", default="", help="Additional custom prompt modifiers")
    parser.add_argument("--output-dir", help="Custom output directory")

    args = parser.parse_args()

    worktree_root = Path(__file__).resolve().parent.parent

    if args.list:
        list_presets()
        return

    if not args.id:
        list_presets()
        parser.print_help()
        sys.exit(0)

    write_manifest(worktree_root)

    if args.id.lower() == "all":
        for pid in PRESETS.keys():
            generate_scene(pid, style=args.style, extra_prompt=args.extra_prompt, output_dir=args.output_dir)
    else:
        generate_scene(args.id, style=args.style, extra_prompt=args.extra_prompt, output_dir=args.output_dir)


if __name__ == "__main__":
    main()
