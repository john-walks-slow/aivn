#!/usr/bin/env python3
"""
scripts/make_transparent.py - Galgame Character Sprite Alpha Matting Tool
========================================================================
Stage-AI Asset Pipeline component for converting solid/white background
character renders into production-ready RGBA transparent PNGs.

Key Features:
1. Flood-fill border connectivity: Only outer background pixels are keyed out;
   internal white details (sailor collars, eye highlights, teeth, shirts) are safely preserved.
2. Soft-edge alpha falloff: Linear color-distance gradient for natural anti-aliased hair strands.
3. Fringe Despill / Decontamination: Mathematically subtracts background color bleed
   from semi-transparent edges, preventing white/green halos on dark game backgrounds.
4. Galgame sprite standard canvas placement: Auto-trim, padding, and bottom-center alignment.
"""

import os
import sys
import argparse
import glob
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw


def parse_color(color_str: str) -> np.ndarray:
    """Parses color string ('white', 'green', '#RRGGBB', 'auto') into RGB numpy array."""
    color_str = color_str.lower().strip()
    if color_str == "white":
        return np.array([255.0, 255.0, 255.0], dtype=np.float32)
    elif color_str == "green":
        return np.array([0.0, 255.0, 0.0], dtype=np.float32)
    elif color_str.startswith("#"):
        hex_c = color_str.lstrip("#")
        if len(hex_c) == 6:
            r = int(hex_c[0:2], 16)
            g = int(hex_c[2:4], 16)
            b = int(hex_c[4:6], 16)
            return np.array([r, g, b], dtype=np.float32)
    return None


def detect_background_color(arr: np.ndarray) -> np.ndarray:
    """Samples corners and edge borders to determine dominant background color."""
    h, w, _ = arr.shape
    patch_size = max(4, min(h, w) // 40)
    corners = [
        arr[0:patch_size, 0:patch_size],
        arr[0:patch_size, w - patch_size:w],
        arr[h - patch_size:h, 0:patch_size],
        arr[h - patch_size:h, w - patch_size:w],
        arr[0:patch_size, w // 2 - patch_size // 2:w // 2 + patch_size // 2],
    ]
    samples = np.vstack([c.reshape(-1, 3) for c in corners])
    median_c = np.median(samples, axis=0)
    return median_c.astype(np.float32)


def process_image_transparency(
    img: Image.Image,
    bg_color_mode: str = "auto",
    tolerance: float = 32.0,
    feather: float = 24.0,
    despill: float = 1.0,
    trim: bool = False,
    padding: int = 20,
    target_canvas: str = None,
) -> Image.Image:
    """
    Core matting pipeline converting an RGB image into a transparent RGBA image.
    """
    img_rgb = img.convert("RGB")
    arr = np.array(img_rgb, dtype=np.float32)
    h, w, _ = arr.shape

    # 1. Determine background color
    explicit_color = parse_color(bg_color_mode)
    if explicit_color is not None:
        bg_color = explicit_color
    else:
        bg_color = detect_background_color(arr)

    # 2. Compute Euclidean color distance to background
    color_dist = np.sqrt(np.sum((arr - bg_color) ** 2, axis=2))

    # 3. Candidate background mask (pixels whose distance is below tolerance + feather)
    tol_low = max(5.0, tolerance)
    tol_high = tol_low + max(2.0, feather)
    is_candidate = (color_dist < tol_high).astype(np.uint8) * 255

    # 4. Connected Components Floodfill from Outer Borders
    mask_img = Image.fromarray(is_candidate, mode="L").copy()
    
    # Top border
    for x in range(w):
        if mask_img.getpixel((x, 0)) == 255:
            ImageDraw.floodfill(mask_img, (x, 0), 128)
            
    # Left and Right borders
    for y in range(h):
        if mask_img.getpixel((0, y)) == 255:
            ImageDraw.floodfill(mask_img, (0, y), 128)
        if mask_img.getpixel((w - 1, y)) == 255:
            ImageDraw.floodfill(mask_img, (w - 1, y), 128)

    # Bottom border corners moving inwards until non-candidate
    for x in range(min(w // 4, 100)):
        if mask_img.getpixel((x, h - 1)) == 255:
            ImageDraw.floodfill(mask_img, (x, h - 1), 128)
        rx = w - 1 - x
        if mask_img.getpixel((rx, h - 1)) == 255:
            ImageDraw.floodfill(mask_img, (rx, h - 1), 128)

    is_connected_bg = np.array(mask_img) == 128

    # 5. Compute Alpha Channel
    alpha = np.ones((h, w), dtype=np.float32) * 255.0
    ramp = np.clip((color_dist - tol_low) / (tol_high - tol_low), 0.0, 1.0) * 255.0
    alpha[is_connected_bg] = ramp[is_connected_bg]

    # Clean extreme noise
    alpha[alpha < 10.0] = 0.0
    alpha[alpha > 250.0] = 255.0

    # 6. Color Fringe Despill / Decontamination
    alpha_norm = np.clip(alpha / 255.0, 0.001, 1.0)[:, :, None]
    if despill > 0.0:
        # Foreground estimation: (C_obs - (1 - a) * C_bg) / a
        estimated_fg = np.clip((arr - (1.0 - alpha_norm) * bg_color) / alpha_norm, 0.0, 255.0)
        # Blend with original according to despill factor
        despilled_rgb = despill * estimated_fg + (1.0 - despill) * arr
    else:
        despilled_rgb = arr

    rgba_arr = np.dstack([despilled_rgb.astype(np.uint8), alpha.astype(np.uint8)])
    result_img = Image.fromarray(rgba_arr, mode="RGBA")

    # 7. Optional Trim Bounding Box
    if trim:
        bbox = result_img.getbbox()
        if bbox:
            min_x = max(0, bbox[0] - padding)
            min_y = max(0, bbox[1] - padding)
            max_x = min(w, bbox[2] + padding)
            max_y = min(h, bbox[3] + padding)
            result_img = result_img.crop((min_x, min_y, max_x, max_y))

    # 8. Optional Galgame Standard Canvas Placement (e.g. 1080x1920, bottom-centered)
    if target_canvas:
        try:
            cw, ch = map(int, target_canvas.lower().split("x"))
            canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
            # Scale result_img to fit canvas height while keeping aspect ratio
            orig_w, orig_h = result_img.size
            scale = min((cw * 0.95) / orig_w, (ch * 0.95) / orig_h)
            new_w = int(orig_w * scale)
            new_h = int(orig_h * scale)
            resized_sprite = result_img.resize((new_w, new_h), Image.Resampling.LANCZOS)
            # Position at bottom-center
            pos_x = (cw - new_w) // 2
            pos_y = ch - new_h
            canvas.paste(resized_sprite, (pos_x, pos_y), resized_sprite)
            result_img = canvas
        except Exception as e:
            print(f"Warning: Failed to apply target-canvas '{target_canvas}': {e}", file=sys.stderr)

    return result_img


def main():
    parser = argparse.ArgumentParser(
        description="Galgame Sprite Background Transparency & Matting Tool"
    )
    parser.add_argument("input", help="Input image file path or directory")
    parser.add_argument("-o", "--output", help="Output PNG file path or output directory")
    parser.add_argument(
        "--bg-color",
        default="auto",
        help="Background color to remove: 'auto' (default), 'white', 'green', or '#RRGGBB'",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=32.0,
        help="Background color distance threshold (default: 32.0)",
    )
    parser.add_argument(
        "--feather",
        type=float,
        default=24.0,
        help="Soft edge transition width in color distance (default: 24.0)",
    )
    parser.add_argument(
        "--despill",
        type=float,
        default=1.0,
        help="Color fringe decontamination factor 0.0 ~ 1.0 (default: 1.0)",
    )
    parser.add_argument(
        "--trim",
        action="store_true",
        help="Auto-trim transparent margins around the character bounding box",
    )
    parser.add_argument(
        "--padding",
        type=int,
        default=20,
        help="Margin padding when trimming (default: 20px)",
    )
    parser.add_argument(
        "--target-canvas",
        help="Target Galgame canvas specification 'WIDTHxHEIGHT' (e.g. '1080x1920') for bottom-centered alignment",
    )

    args = parser.parse_args()

    input_path = Path(args.input)
    if input_path.is_file():
        files = [input_path]
    elif input_path.is_dir():
        files = [
            p
            for p in input_path.iterdir()
            if p.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp"]
            and not p.stem.endswith("_transparent")
        ]
    else:
        # Try glob pattern
        files = [Path(p) for p in glob.glob(args.input)]

    if not files:
        print(f"Error: No matching files found for input: {args.input}", file=sys.stderr)
        sys.exit(1)

    print(f"Processing {len(files)} image(s)...")

    for file_path in sorted(files):
        try:
            with Image.open(file_path) as img:
                res = process_image_transparency(
                    img,
                    bg_color_mode=args.bg_color,
                    tolerance=args.tolerance,
                    feather=args.feather,
                    despill=args.despill,
                    trim=args.trim,
                    padding=args.padding,
                    target_canvas=args.target_canvas,
                )

                if args.output:
                    out_path = Path(args.output)
                    if out_path.is_dir() or len(files) > 1:
                        out_path.mkdir(parents=True, exist_ok=True)
                        dest_file = out_path / f"{file_path.stem}.png"
                    else:
                        out_path.parent.mkdir(parents=True, exist_ok=True)
                        dest_file = out_path
                else:
                    dest_file = file_path.with_name(f"{file_path.stem}_transparent.png")

                res.save(dest_file, format="PNG")
                print(f"[OK] {file_path.name} -> {dest_file} ({res.size[0]}x{res.size[1]} RGBA)")
        except Exception as e:
            print(f"[FAILED] {file_path.name}: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
