"""
scripts/gen_flow2api_assets.py - Full pipeline using Flow2API for:
1. Two original characters in Pillow-soft (枕社 / 樱之诗 / 终之空 / 狗神煌) style:
   - Character 1: 鹿岛抚子 (Nadeshiko Kashima) - 文艺/紫瞳银发 -> [常服/水手服] + [私服/秋日针织开衫]
   - Character 2: 桐原七海 (Nanami Kirihara) - 元气/金瞳茶发 -> [常服/学院西装背心] + [私服/露肩针织私服]
2. Audio BGM Track generation via Flow2API (flow-music / Lyria)
3. Matting & Transparency via scripts/make_transparent.py
"""
import os
import sys
import re
import json
import base64
import time
from pathlib import Path
import requests
from PIL import Image

sys.path.append(str(Path(__file__).resolve().parent))
from make_transparent import process_image_transparency

FLOW_API_URL = "http://127.0.0.1:38000/v1/chat/completions"
FLOW_API_KEY = "test-key"
IMAGE_MODEL = "gemini-3.1-flash-image-portrait-2k"
MUSIC_MODEL = "flow-music"
PROXY = "http://127.0.0.1:7890"

# Makura / Pillow soft aesthetic: ethereal lighting, delicate pastel translucent colors, starry eyes
PILLOW_STYLE = (
    "masterpiece, official visual novel character sprite art by Makura (Pillow soft) and SCA-DI, "
    "art by Inugami Kira and Motoyon, ethereal translucent soft coloring, delicate glowing lighting, "
    "fine intricate hair strands, expressive anime eyes with starry depth, "
    "subtle pastel watercolor undertones, clean white background, front view bust portrait, highest quality illustration"
)

CHARACTERS = {
    "nadeshiko": {
        "name": "鹿岛抚子 (Nadeshiko Kashima)",
        "features": (
            "17-year-old ethereal literary girl, long flowing silver-lilac hair with a small pale-blue silk ribbon clip on left bangs, "
            "deep crystalline violet-purple anime eyes with delicate starry sparkle, soft pale porcelain skin, gentle tranquil expression"
        ),
        "uniform": (
            "wearing traditional elite private academy sailor seifuku, crisp snow-white short-sleeve shirt with deep navy blue sailor collar, "
            "two thin white stripes on collar, neat navy blue pleated silk necktie, pristine and elegant schoolgirl appearance"
        ),
        "casual": (
            "wearing cozy aesthetic autumn private date clothes, soft oversized cream-beige knitted cable cardigan over a delicate lavender chiffon blouse, "
            "tiny silver locket necklace, warm charming feminine elegance"
        ),
    },
    "nanami": {
        "name": "桐原七海 (Nanami Kirihara)",
        "features": (
            "16-year-old lively cheerful girl, long warm chestnut-tea hair styled in low loose side-twintails with black velvet ribbons, "
            "bright sparkling amber-golden eyes, playful cat-like gentle smile, soft peach-blushing cheeks"
        ),
        "uniform": (
            "wearing prestigious academy blazer uniform, tailored beige knitted vest over a white collared dress shirt, "
            "smart dark pleated skirt, vivid crimson plaid bowtie at collar, lively neat school uniform"
        ),
        "casual": (
            "wearing stylish spring casual outfit, off-shoulder pastel sky-blue knit top showing delicate collarbone, "
            "white camisole underneath, small star-shaped silver earring, playful fashionable youthfulness"
        ),
    },
}


def download_with_proxy(url: str, retries: int = 3) -> bytes:
    session = requests.Session()
    session.proxies = {'http': PROXY, 'https': PROXY}
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    for i in range(retries):
        try:
            resp = session.get(url, headers=headers, timeout=45)
            resp.raise_for_status()
            return resp.content
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(3)


def call_flow2api_image(prompt: str) -> bytes:
    payload = {
        "model": IMAGE_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True
    }
    headers = {
        "Authorization": f"Bearer {FLOW_API_KEY}",
        "Content-Type": "application/json"
    }

    print(f"Submitting image task to Flow2API ({IMAGE_MODEL})...")
    resp = requests.post(FLOW_API_URL, headers=headers, json=payload, stream=True, timeout=180)
    resp.raise_for_status()

    img_url = None
    for line in resp.iter_lines():
        if not line:
            continue
        line_str = line.decode("utf-8", errors="ignore")
        if line_str.startswith("data:") and "[DONE]" not in line_str:
            try:
                data = json.loads(line_str[5:].strip())
                delta = data.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                match = re.search(r'\((https://flow-content\.google/[^)]+)\)', content)
                if match:
                    img_url = match.group(1)
                    break
                elif "https://flow-content.google/" in content:
                    m2 = re.search(r'https://flow-content\.google/[^\s"\'>)]+', content)
                    if m2:
                        img_url = m2.group(0)
                        break
            except Exception:
                pass

    if not img_url:
        raise RuntimeError("Flow2API did not return a valid flow-content image URL.")

    print(f"Downloading official Google Flow render: {img_url[:60]}...")
    return download_with_proxy(img_url)


def call_flow2api_music(prompt: str) -> bytes:
    payload = {
        "model": MUSIC_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False
    }
    headers = {
        "Authorization": f"Bearer {FLOW_API_KEY}",
        "Content-Type": "application/json"
    }
    print(f"Requesting BGM track from Flow2API ({MUSIC_MODEL})...")
    resp = requests.post(FLOW_API_URL, headers=headers, json=payload, timeout=90)
    resp.raise_for_status()
    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    
    match = re.search(r"src='(http://[^']+)'", content)
    if not match:
        match = re.search(r'\[Download Audio\]\((http://[^)]+)\)', content)
    if not match:
        raise RuntimeError(f"Could not parse audio URL from Flow2API response: {content}")
    
    audio_url = match.group(1)
    print(f"Downloading BGM track from {audio_url}...")
    audio_resp = requests.get(audio_url, timeout=30)
    audio_resp.raise_for_status()
    return audio_resp.content


def generate_single_outfit(char_key: str, outfit_key: str, outfit_desc: str, char_dir: Path):
    info = CHARACTERS[char_key]
    raw_path = char_dir / f"{outfit_key}_raw.jpg"
    png_path = char_dir / f"{outfit_key}.png"

    if png_path.exists() and raw_path.exists():
        print(f"  [Skip] {outfit_key} already exists.")
        return

    prompt = (
        f"{PILLOW_STYLE}, character sprite portrait of {info['features']}, {outfit_desc}, "
        f"clean pure solid white background, front view bust portrait, high quality visual novel sprite"
    )
    print(f"\n--- Generating {info['name']} - {outfit_key} ---")
    img_bytes = call_flow2api_image(prompt)
    raw_path.write_bytes(img_bytes)
    print(f"Saved: {raw_path}")

    with Image.open(raw_path) as img:
        png_img = process_image_transparency(
            img,
            bg_color_mode="auto",
            tolerance=30.0,
            feather=18.0,
            despill=0.9,
            trim=True,
            padding=25,
            target_canvas="1080x1920",
            sprite_type="bust"
        )
        png_img.save(png_path, format="PNG")
        print(f"Matted PNG: {png_path} ({png_img.size})")


def main():
    # 产物落仓库根的 assets/（历史遗留目录名，与 dataRoot 无关）：</n    #   AIVN_ASSETS_DIR 可覆盖
    base_dir = Path(os.environ.get("AIVN_ASSETS_DIR", Path(__file__).resolve().parent.parent / "assets"))
    pillow_sprites_dir = base_dir / "sprites" / "pillow_chars"
    audio_dir = base_dir / "audio" / "tracks"
    pillow_sprites_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)

    # 1. Characters
    for char_key, info in CHARACTERS.items():
        char_dir = pillow_sprites_dir / char_key
        char_dir.mkdir(parents=True, exist_ok=True)
        print(f"\n=======================================================")
        print(f"Processing Character: {info['name']} ({char_key})")
        print(f"=======================================================")

        # Uniform
        generate_single_outfit(char_key, "uniform", info["uniform"], char_dir)
        # Casual
        generate_single_outfit(char_key, "casual", info["casual"], char_dir)

        manifest = {
            "id": char_key,
            "name": info["name"],
            "aesthetic": "Makura / Pillow-soft (Sakura no Uta style, Inugami Kira art direction)",
            "features": info["features"],
            "outfits": {
                "uniform": {
                    "label": "学园常服 (制服)",
                    "raw": "uniform_raw.jpg",
                    "sprite": "uniform.png",
                    "description": info["uniform"]
                },
                "casual": {
                    "label": "休日私服 (便服)",
                    "raw": "casual_raw.jpg",
                    "sprite": "casual.png",
                    "description": info["casual"]
                }
            }
        }
        (char_dir / "character_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))

    # 2. BGM via Flow2API Lyria
    print(f"\n=======================================================")
    print(f"Generating Pillow-style Galgame BGM Track via Flow2API")
    print(f"=======================================================")
    bgm_prompt = (
        "gentle aesthetic visual novel soundtrack, Makura Pillow soft style like Sakura no Uta, "
        "melodic acoustic piano, warm nylon guitar, emotional strings, nostalgic peaceful afternoon breeze"
    )
    bgm_out_path = audio_dir / "flow_lyria_sakura_breeze.mp3"
    if not bgm_out_path.exists():
        bgm_bytes = call_flow2api_music(bgm_prompt)
        bgm_out_path.write_bytes(bgm_bytes)
        print(f"Saved Flow2API BGM: {bgm_out_path} ({len(bgm_bytes)} bytes)")
    else:
        print(f"  [Skip] BGM track already exists: {bgm_out_path}")

    print("\nAll Flow2API generation tasks completed successfully!")


if __name__ == "__main__":
    main()
