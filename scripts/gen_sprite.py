#!/usr/bin/env python3
"""
scripts/gen_sprite.py - Galgame Character Sprite Generator & Pipeline
=====================================================================
AIVN Asset Pipeline script for generating multi-expression anime character
sprites with two battle-tested paradigms:
  1. Paradigm A: Sheet Slicing (Single prompt 2x3 grid -> automated cell slice + matting)
  2. Paradigm B: Iterative Reference (Base normal render -> multimodal image-to-image
     locking character features while mutating expressions)

Outputs production-ready transparent RGBA PNGs compliant with AIVN VN standards.
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


def detect_sheet_grid(img: Image.Image, max_rows: int = 4, max_cols: int = 6) -> Tuple[int, int]:
    """
    Automatically detects the grid layout (rows, cols) of an expression sheet
    by analyzing background gutter density along horizontal and vertical projections.
    """
    import numpy as np
    arr = np.array(img.convert("L"), dtype=np.float32)
    h, w = arr.shape
    bg_val = float(np.median([arr[0, 0], arr[0, w - 1], arr[h - 1, 0], arr[h - 1, w - 1]]))
    fg = np.abs(arr - bg_val) > 25.0

    col_density = fg.sum(axis=0) / h
    row_density = fg.sum(axis=1) / w

    best_c = 1
    min_c_score = 999.0
    for c in range(2, max_cols + 1):
        dividers = [int(w * i / c) for i in range(1, c)]
        gutter_scores = [np.min(col_density[max(0, d - 15) : min(w, d + 15)]) for d in dividers]
        avg_score = float(np.mean(gutter_scores))
        if avg_score < 0.1 and avg_score <= min_c_score:
            min_c_score = avg_score
            best_c = c

    best_r = 1
    min_r_score = 999.0
    for r in range(2, max_rows + 1):
        dividers = [int(h * i / r) for i in range(1, r)]
        gutter_scores = [np.min(row_density[max(0, d - 15) : min(h, d + 15)]) for d in dividers]
        avg_score = float(np.mean(gutter_scores))
        if avg_score < 0.1 and avg_score <= min_r_score:
            min_r_score = avg_score
            best_r = r

    return (best_r if best_r > 1 else 2), (best_c if best_c > 1 else 4)


def run_sheet_mode(
    char_name: str,
    char_desc: str,
    out_dir: Path,
    target_canvas: Optional[str] = "1080x1920",
    rows: Optional[int] = None,
    cols: Optional[int] = None,
) -> List[str]:
    """
    Paradigm A: Generate multi-expression sheet with auto-adaptive or custom grid,
    slice into individual sprites, and process transparency.
    """
    print(f"\n[Paradigm A: Sheet Mode] Generating expression sheet for '{char_name}'...")
    expr_keys = ["normal", "smile", "shy", "angry", "sad", "surprised", "thinking", "winking", "custom1", "custom2"]
    
    req_rows = rows or 2
    req_cols = cols or 4
    sheet_prompt = f"""
Masterpiece anime official visual novel character art, character expression sheet.
Multiple expressions of the SAME character arranged in a clean {req_rows}x{req_cols} grid ({req_rows} rows, {req_cols} columns).
Character appearance: {char_desc}.
Pure solid white background, clean white margins between cells, front view bust portrait, consistent character design and colors, highest quality anime illustration.
""".strip()

    sheet_raw = call_image_generation(sheet_prompt)
    sheet_path = out_dir / "sheet_raw.jpg"
    sheet_path.write_bytes(sheet_raw)
    print(f"[OK] Saved composite sheet to {sheet_path}")

    sheet_img = Image.open(sheet_path).convert("RGB")
    sw, sh = sheet_img.size

    # Auto-detect grid or use specified
    if rows is None or cols is None:
        det_r, det_c = detect_sheet_grid(sheet_img)
        act_rows = rows or det_r
        act_cols = cols or det_c
        print(f"[Auto Grid Detection] Detected layout: {act_rows} rows x {act_cols} cols")
    else:
        act_rows = rows
        act_cols = cols
        print(f"[Grid Configuration] Using explicit layout: {act_rows} rows x {act_cols} cols")

    cell_w = sw // act_cols
    cell_h = sh // act_rows

    generated_files = []
    idx = 0
    for r in range(act_rows):
        for c in range(act_cols):
            if idx >= len(expr_keys):
                break
            expr_name = expr_keys[idx]
            # Inset by 4px to avoid separator lines
            box = (c * cell_w + 4, r * cell_h + 4, (c + 1) * cell_w - 4, (r + 1) * cell_h - 4)
            cell_img = sheet_img.crop(box)
            
            # Save raw cropped cell
            cell_raw_path = out_dir / f"{expr_name}_raw.jpg"
            cell_img.save(cell_raw_path, format="JPEG", quality=95)

            # Matte background to transparent PNG
            trans_img = process_image_transparency(
                cell_img,
                bg_color_mode="auto",
                tolerance=30.0,
                feather=16.0,
                despill=0.9,
                trim=True,
                padding=20,
                target_canvas=target_canvas,
                sprite_type="bust",
            )
            out_png = out_dir / f"{expr_name}.png"
            trans_img.save(out_png, format="PNG")
            print(f"  -> Generated {out_png.name} ({trans_img.size[0]}x{trans_img.size[1]} RGBA)")
            generated_files.append(str(out_png))
            idx += 1

    return generated_files

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
    """Generates AIVN sprite manifest file."""
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
        description="AIVN Galgame Multi-Expression Character Sprite Generator"
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
    parser.add_argument(
        "--rows",
        type=int,
        default=None,
        help="Number of rows in expression sheet (default: auto-detect)",
    )
    parser.add_argument(
        "--cols",
        type=int,
        default=None,
        help="Number of columns in expression sheet (default: auto-detect)",
    )

    args = parser.parse_args()

    char_desc = args.desc or DEFAULT_CHARACTER["description"]
    worktree_root = Path(__file__).resolve().parent.parent
    out_dir = Path(args.output_dir) if args.output_dir else worktree_root / "assets" / "sprites" / args.character
    out_dir.mkdir(parents=True, exist_ok=True)

    expr_list = [e.strip() for e in args.expressions.split(",") if e.strip()]

    print(f"=== AIVN Character Sprite Generation ===")
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
            rows=args.rows,
            cols=args.cols,
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
