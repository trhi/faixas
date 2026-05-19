#!/usr/bin/env python3
"""
Batch-vectorize public/img/pictoral/ PNGs → SVG using potrace.

Pipeline per image:
  1. Load RGBA PNG; use alpha channel as ink mask (alpha > THRESHOLD → black)
  2. Save ink mask as grayscale PGM (potrace input)
  3. Run potrace to trace clean Bezier paths → SVG
  4. Strip any potrace-inserted background <rect> so SVGs have transparent backgrounds

Output: IGNORE/img/pictoral elements/images-V2-vectors/

Requirements:
  brew install potrace
  pip install Pillow numpy  (already in .venv)
"""

import re
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

SRC_DIR = Path(__file__).parent.parent / "public" / "img" / "pictoral"
OUT_DIR = (
    Path(__file__).parent.parent
    / "IGNORE"
    / "img"
    / "pictoral elements"
    / "images-V2-vectors"
)

# Alpha threshold: pixels with alpha > this are treated as ink
ALPHA_THRESHOLD = 64

# Potrace tuning
TURDSIZE    = "4"    # discard isolated regions ≤ N pixels² (removes scan specks)
ALPHAMAX    = "1.0"  # corner rounding (0 = sharp corners, 1.33 = all curves)
OPTTOLERANCE = "0.3" # curve fitting tolerance (lower = more accurate, more nodes)


def png_to_pgm(png_path: Path, pgm_path: Path) -> None:
    """Extract ink mask from RGBA PNG and save as 8-bit grayscale PGM."""
    img = Image.open(png_path).convert("RGBA")
    alpha = np.array(img)[:, :, 3]
    # Hard threshold: ink pixel = 0 (black), background = 255 (white)
    bw = np.where(alpha > ALPHA_THRESHOLD, 0, 255).astype(np.uint8)
    Image.fromarray(bw, mode="L").save(str(pgm_path))


def strip_bg_rect(svg_path: Path) -> None:
    """Remove any potrace-inserted background <rect> so the SVG is transparent."""
    text = svg_path.read_text(encoding="utf-8")
    cleaned = re.sub(r"<rect\b[^>]*/>\s*", "", text)
    svg_path.write_text(cleaned, encoding="utf-8")


def vectorize(png_path: Path, svg_path: Path) -> bool:
    with tempfile.NamedTemporaryFile(suffix=".pgm", delete=False) as f:
        pgm = Path(f.name)
    try:
        png_to_pgm(png_path, pgm)
        result = subprocess.run(
            [
                "potrace", "-s",                    # SVG output
                "--color",        "#000000",         # pure black paths
                "--turdsize",     TURDSIZE,
                "--alphamax",     ALPHAMAX,
                "--opttolerance", OPTTOLERANCE,
                "-o", str(svg_path),
                str(pgm),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"FAILED: {result.stderr.strip()}")
            return False
        strip_bg_rect(svg_path)
        return True
    finally:
        pgm.unlink(missing_ok=True)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pngs = sorted(SRC_DIR.glob("*.png"))
    if not pngs:
        print(f"No PNGs found in {SRC_DIR}")
        return

    print(f"Vectorizing {len(pngs)} images → {OUT_DIR}\n")
    ok = fail = 0
    for png in pngs:
        svg = OUT_DIR / (png.stem + ".svg")
        print(f"  {png.name} ...", end=" ", flush=True)
        if vectorize(png, svg):
            print("✓")
            ok += 1
        else:
            print("✗")
            fail += 1

    print(f"\n{ok} ok, {fail} failed")


if __name__ == "__main__":
    main()
