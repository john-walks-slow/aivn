#!/usr/bin/env python3
"""
scripts/gen_sprite.py - Galgame Character Sprite Generator & Pipeline
=====================================================================
Stage-AI Asset Pipeline script for generating multi-expression anime character
sprites with two battle-tested paradigms:
  1. Paradigm A: Sheet Slicing (Single prompt 2x3 grid -> automated cell slice + matting)
  2. Paradigm B: Iterative Reference (Base normal render -> multimodal image-to-image
     locking character features while mutating expressions)

Outputs production-ready transparent RGBA PNGs compliant with Stage-AI VN standards.
"""

import os
import sys
import argparse
import json
import time
import io
import base64
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests
from PIL import Image

# Import sibling matting tool
sys.path.append(str(Path(__file__).resolve().parent))
from make_transparent import process_image_transparency

CPA_URL = os.getenv("CPA_URL", "http://127.0.0.1:9999/v1/chat/completions")
CPA_API_KEY = os.getenv("CPA_API_KEY", "sk-1234")
MODEL_NAME = os.getenv("IMAGE_MODEL", "gemini-3.1-flash-image")

DEFAULT_CHARACTER = {
    "name": "koharu",
    "description": (
        "17-year-old Japanese high school girl, long pastel pink hair with twin white silk ribbons, "
        "sparkling emerald green expressive eyes, fair skin, wearing neat high school sailor suit "
        "(navy blue collar, white shirt, red silk ribbon tie)."
    ),
}

STANDARD_EXPRESSIONS: Dict[str, str] = {
    "normal": "calm gentle neutral normal expression, natural eyes, slight gentle mouth, looking at viewer",
    "smile": "happy cheerful radiant smiling expression, curved sparkling eyes, open smiling mouth",
    "shy": "shy blushing red cheeks, embarrassed cute expression, timid gaze looking slightly sideways, cute pouty shy smile",
    "angry": "angry tsundere annoyed expression, furrowed eyebrows, cute indignant pouting mouth, sharp gaze",
    "sad": "sad sorrowful heartbroken expression, teary glistening eyes with tears, downcast gaze, trembling lips",
    "surprised": "shocked surprised startled expression, wide open eyes with dilated pupils, slightly open mouth in gasp 'O'",
    "thinking": "closed eyes serene contemplative expression, thoughtful peaceful smile, head slightly tilted in thought",
}


def call_image_generation(
    prompt: str,
    reference_image: Optional[Image.Image] = None,
    timeout: int = 120,
    max_retries: int = 3,
) -> bytes:
    """Calls the image generation backend via chat completions stream with automatic 429 retry."""
    if reference_image is not None:
        # Downscale reference image for fast network transmission (max 512px)
        ref_thumb = reference_image.copy()
        ref_thumb.thumbnail((512, 512))
        buf = io.BytesIO()
        ref_thumb.convert("RGB").save(buf, format="JPEG", quality=85)
        b64_ref = base64.b64encode(buf.getvalue()).decode("utf-8")
        user_content = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64_ref}"}},
        ]
    else:
        user_content = prompt

    payload = {
        "model": MODEL_NAME,
        "messages": [{"role": "user", "content": user_content}],
        "stream": True,
        "max_tokens": 300,
    }

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
                wait_sec = 8 * (attempt + 1)
                print(f"[Transient HTTP {resp.status_code}] Waiting {wait_sec}s before retry ({attempt + 1}/{max_retries})...")
                time.sleep(wait_sec)
                continue
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
            time.sleep(5)

    raise RuntimeError("No image data returned from generation API after retries.")


def run_sheet_mode(
    char_name: str,
    char_desc: str,
    out_dir: Path,
    target_canvas: Optional[str] = "1080x1920",
    rows: int = 2,
    cols: int = 3,
) -> List[str]:
    """
    Paradigm A: Generate 2x3 multi-expression sheet in one prompt, slice into individual sprites,
    and process transparency.
    """
    print(f"\n[Paradigm A: Sheet Mode] Generating expression sheet for '{char_name}'...")
    expr_keys = ["normal", "smile", "shy", "angry", "sad", "surprised"]
    
    sheet_prompt = f"""
Masterpiece anime official visual novel character art, character expression sheet.
6 expressions of the SAME character arranged in a clean {rows}x{cols} grid ({rows} rows, {cols} columns).
Row 1: normal calm expression, cheerful smiling expression, blushing shy expression.
Row 2: angry pouting expression, sad crying expression, shocked surprised expression.
Character appearance: {char_desc}.
Pure solid white background, clean white borders between cells, front view bust portrait, consistent character design and colors, highest quality anime illustration.
""".strip()

    sheet_raw = call_image_generation(sheet_prompt)
    sheet_path = out_dir / "sheet_raw.jpg"
    sheet_path.write_bytes(sheet_raw)
    print(f"[OK] Saved composite sheet to {sheet_path}")

    sheet_img = Image.open(sheet_path).convert("RGB")
    sw, sh = sheet_img.size
    cell_w = sw // cols
    cell_h = sh // rows

    generated_files = []
    idx = 0
    for r in range(rows):
        for c in range(cols):
            if idx >= len(expr_keys):
                break
            expr_name = expr_keys[idx]
            box = (c * cell_w, r * cell_h, (c + 1) * cell_w, (r + 1) * cell_h)
            cell_img = sheet_img.crop(box)
            
            # Save raw cropped cell
            cell_raw_path = out_dir / f"{expr_name}_raw.jpg"
            cell_img.save(cell_raw_path, format="JPEG", quality=95)

            # Matte background to transparent PNG
            trans_img = process_image_transparency(
                cell_img,
                bg_color_mode="auto",
                tolerance=35.0,
                feather=22.0,
                despill=0.9,
                trim=True,
                padding=25,
                target_canvas=target_canvas,
            )
            out_png = out_dir / f"{expr_name}.png"
            trans_img.save(out_png, format="PNG")
            print(f"  -> Generated {out_png.name} ({trans_img.size[0]}x{trans_img.size[1]} RGBA)")
            generated_files.append(str(out_png))
            idx += 1

    # Also generate the 7th classic expression "thinking" using Paradigm B reference iteration
    print("\nGenerating 7th classic expression 'thinking' (closed-eyes contemplative) via reference...")
    base_cell = Image.open(out_dir / "normal_raw.jpg")
    thinking_prompt = f"""
Visual novel character sprite modification of {char_name}.
Keep the EXACT same character face, hairstyle, hair ribbons, clothing and front view bust pose.
Change expression to: {STANDARD_EXPRESSIONS['thinking']}.
Pure solid white background, high quality anime art style.
""".strip()

    thinking_raw = call_image_generation(thinking_prompt, reference_image=base_cell)
    thinking_raw_path = out_dir / "thinking_raw.jpg"
    thinking_raw_path.write_bytes(thinking_raw)
    thinking_img = Image.open(thinking_raw_path)
    thinking_trans = process_image_transparency(
        thinking_img,
        bg_color_mode="auto",
        tolerance=35.0,
        feather=22.0,
        despill=0.9,
        trim=True,
        padding=25,
        target_canvas=target_canvas,
    )
    thinking_png = out_dir / "thinking.png"
    thinking_trans.save(thinking_png, format="PNG")
    print(f"  -> Generated {thinking_png.name} ({thinking_trans.size[0]}x{thinking_trans.size[1]} RGBA)")
    generated_files.append(str(thinking_png))

    return generated_files


def run_iterative_mode(
    char_name: str,
    char_desc: str,
    out_dir: Path,
    expressions: List[str],
    target_canvas: Optional[str] = "1080x1920",
) -> List[str]:
    """
    Paradigm B: Generate a standalone base sprite, then iteratively produce expression variants
    by feeding the base image as visual reference.
    """
    print(f"\n[Paradigm B: Iterative Mode] Generating base sprite for '{char_name}'...")
    base_prompt = f"""
Masterpiece anime official visual novel character sprite, front view standing bust portrait.
Character: {char_desc}.
Expression: {STANDARD_EXPRESSIONS['normal']}.
Pure solid white background, clean sharp anime line art, studio lighting, extremely detailed.
""".strip()

    base_raw = call_image_generation(base_prompt)
    base_path = out_dir / "base.jpg"
    base_path.write_bytes(base_raw)
    print(f"[OK] Saved base sprite to {base_path}")

    base_img = Image.open(base_path).convert("RGB")
    generated_files = []

    # Process base normal PNG
    base_trans = process_image_transparency(
        base_img,
        bg_color_mode="auto",
        tolerance=35.0,
        feather=22.0,
        despill=0.9,
        trim=True,
        padding=25,
        target_canvas=target_canvas,
    )
    base_png = out_dir / "normal.png"
    base_trans.save(base_png, format="PNG")
    print(f"  -> Generated {base_png.name} ({base_trans.size[0]}x{base_trans.size[1]} RGBA)")
    generated_files.append(str(base_png))

    # Iteratively generate requested expressions
    for expr in expressions:
        if expr == "normal":
            continue
        expr_desc = STANDARD_EXPRESSIONS.get(expr, expr)
        print(f"\n[Iterative] Mutating expression -> '{expr}'...")
        variant_prompt = f"""
Visual novel character sprite modification of {char_name}.
Reference image provided. Keep the EXACT same character face, hairstyle, hair accessories, clothes and posture.
ONLY CHANGE the facial expression: {expr_desc}.
Pure solid white background, half-body front view portrait.
""".strip()

        variant_raw = call_image_generation(variant_prompt, reference_image=base_img)
        raw_path = out_dir / f"{expr}_raw.jpg"
        raw_path.write_bytes(variant_raw)

        var_img = Image.open(raw_path)
        trans_img = process_image_transparency(
            var_img,
            bg_color_mode="auto",
            tolerance=35.0,
            feather=22.0,
            despill=0.9,
            trim=True,
            padding=25,
            target_canvas=target_canvas,
        )
        out_png = out_dir / f"{expr}.png"
        trans_img.save(out_png, format="PNG")
        print(f"  -> Generated {out_png.name} ({trans_img.size[0]}x{trans_img.size[1]} RGBA)")
        generated_files.append(str(out_png))

    return generated_files


def write_manifest(char_name: str, char_desc: str, out_dir: Path, expressions: List[str]):
    """Generates Stage-AI sprite manifest file."""
    manifest = {
        "character": char_name,
        "description": char_desc,
        "anchor": [0.5, 1.0],  # Bottom center pivot for Galgame engine
        "canvas_size": [1080, 1920],
        "default_expression": "normal",
        "expressions": {
            k: {
                "file": f"{k}.png",
                "description": STANDARD_EXPRESSIONS.get(k, k),
            }
            for k in expressions
        },
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "pipeline_version": "1.0.0",
    }
    manifest_path = out_dir / "sprite_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[OK] Wrote sprite manifest to {manifest_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Stage-AI Galgame Multi-Expression Character Sprite Generator"
    )
    parser.add_argument("--character", default="koharu", help="Character identifier (default: koharu)")
    parser.add_argument("--desc", help="Character appearance description prompt")
    parser.add_argument(
        "--mode",
        choices=["sheet", "iterative"],
        default="sheet",
        help="Generation paradigm: 'sheet' (2x3 sheet slice) or 'iterative' (base + image reference)",
    )
    parser.add_argument(
        "--expressions",
        default="normal,smile,shy,angry,sad,surprised,thinking",
        help="Comma-separated list of expressions to generate",
    )
    parser.add_argument(
        "--output-dir",
        help="Target output directory (default: assets/sprites/<character>)",
    )
    parser.add_argument(
        "--target-canvas",
        default="1080x1920",
        help="Standard canvas size 'WIDTHxHEIGHT' (default: 1080x1920)",
    )

    args = parser.parse_args()

    char_desc = args.desc or DEFAULT_CHARACTER["description"]
    worktree_root = Path(__file__).resolve().parent.parent
    out_dir = Path(args.output_dir) if args.output_dir else worktree_root / "assets" / "sprites" / args.character
    out_dir.mkdir(parents=True, exist_ok=True)

    expr_list = [e.strip() for e in args.expressions.split(",") if e.strip()]

    print(f"=== Stage-AI Character Sprite Generation ===")
    print(f"Character: {args.character}")
    print(f"Mode: {args.mode}")
    print(f"Output: {out_dir}")

    start_t = time.time()
    if args.mode == "sheet":
        gen_files = run_sheet_mode(
            args.character,
            char_desc,
            out_dir,
            target_canvas=args.target_canvas,
        )
    else:
        gen_files = run_iterative_mode(
            args.character,
            char_desc,
            out_dir,
            expressions=expr_list,
            target_canvas=args.target_canvas,
        )

    all_exprs = ["normal", "smile", "shy", "angry", "sad", "surprised", "thinking"]
    write_manifest(args.character, char_desc, out_dir, all_exprs)
    print(f"\n[DONE] Completed in {time.time()-start_t:.1f}s. Generated {len(gen_files)} sprites.")


if __name__ == "__main__":
    main()
