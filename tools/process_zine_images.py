"""
Process zine scan images:
1. Extract black lines with transparent background -> transparent bg/
2. Separate individual drawings -> images/
"""

import os
import sys
import cv2
import numpy as np
from PIL import Image

SCANS_DIR = os.path.join(os.path.dirname(__file__), "..", "IGNORE", "img", "pictoral elements", "scans", "scans-cropped")
BASE_DIR = os.path.dirname(SCANS_DIR)  # = scans/
TRANSPARENT_DIR = os.path.join(BASE_DIR, "transparent-bg-V2")
IMAGES_DIR = os.path.join(BASE_DIR, "images-V2")

# Tuning parameters
THRESHOLD = 200          # Pixels darker than this (0-255) are considered ink
DILATION_PX = 15         # Dilation kernel radius (px) to cluster nearby strokes
MIN_BBOX_AREA = 4000     # Minimum bounding-box area (px²) to count as a drawing
MIN_INK_PX = 200         # Minimum number of ink pixels inside a contour
MAX_PAGE_FRACTION = 0.50 # Reject bboxes covering more than this fraction of the page
MAX_ASPECT_RATIO = 5.0   # Reject very elongated strip artifacts
PADDING = 40             # Extra pixels around each cropped drawing
EDGE_MARGIN = 15         # Ignore ink within this many px of the paper border


def make_transparent(gray_img):
    """Return RGBA image: ink stays black, white/near-white becomes transparent."""
    h, w = gray_img.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    # Smooth alpha: fully opaque at 0, fully transparent at THRESHOLD+
    alpha = np.clip((THRESHOLD - gray_img.astype(np.int32)) * 255 // THRESHOLD, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = alpha
    return rgba


def get_paper_mask(gray_img):
    """
    Detect the paper rectangle and return a binary mask (255 = inside paper).
    The scans have a grey shadow outside the paper area.
    """
    _, paper_mask = cv2.threshold(gray_img, 230, 255, cv2.THRESH_BINARY)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 40))
    paper_mask = cv2.morphologyEx(paper_mask, cv2.MORPH_CLOSE, kernel)
    paper_mask = cv2.morphologyEx(paper_mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(paper_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return np.ones_like(gray_img, dtype=np.uint8) * 255
    largest = max(contours, key=cv2.contourArea)
    mask = np.zeros_like(gray_img, dtype=np.uint8)
    cv2.drawContours(mask, [largest], -1, 255, -1)
    # Shrink by EDGE_MARGIN to exclude binding marks and page borders
    shrink_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (EDGE_MARGIN * 2, EDGE_MARGIN * 2))
    mask = cv2.erode(mask, shrink_kernel)
    return mask


def find_drawing_contours(gray_img, paper_mask):
    """
    Return a list of (contour, filled_mask) for each detected drawing.
    Uses dilation to cluster nearby strokes, then filters by size.
    """
    h, w = gray_img.shape
    page_area = h * w

    # Binary ink mask
    _, binary = cv2.threshold(gray_img, THRESHOLD, 255, cv2.THRESH_BINARY_INV)
    binary = cv2.bitwise_and(binary, paper_mask)

    # Dilate to merge strokes within the same drawing
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (DILATION_PX * 2 + 1, DILATION_PX * 2 + 1))
    dilated = cv2.dilate(binary, kernel, iterations=1)

    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    results = []
    for cnt in contours:
        x, y, cw, ch = cv2.boundingRect(cnt)
        bbox_area = cw * ch

        # Size filters
        if bbox_area < MIN_BBOX_AREA:
            continue
        if bbox_area > MAX_PAGE_FRACTION * page_area:
            continue

        # Aspect ratio filter — reject very elongated strips (binding lines etc.)
        aspect = max(cw, ch) / max(min(cw, ch), 1)
        if aspect > MAX_ASPECT_RATIO:
            continue

        # Count actual ink pixels inside this contour
        cnt_mask = np.zeros((h, w), dtype=np.uint8)
        cv2.drawContours(cnt_mask, [cnt], -1, 255, -1)
        ink_count = cv2.countNonZero(cv2.bitwise_and(binary, cnt_mask))
        if ink_count < MIN_INK_PX:
            continue

        results.append((cnt, cnt_mask))

    # Sort top-to-bottom, left-to-right
    results.sort(key=lambda r: (cv2.boundingRect(r[0])[1] // 200, cv2.boundingRect(r[0])[0]))
    return results, binary


def process_image(jpg_path):
    name = os.path.splitext(os.path.basename(jpg_path))[0]
    print(f"\n=== Processing: {name} ===")

    img_bgr = cv2.imread(jpg_path)
    if img_bgr is None:
        print(f"  ERROR: Could not read {jpg_path}")
        return

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    # ─── Task 1: Transparent background (full page) ────────────────────────────
    rgba_arr = make_transparent(gray)
    rgba_img = Image.fromarray(rgba_arr, "RGBA")
    out_transparent = os.path.join(TRANSPARENT_DIR, f"{name}.png")
    rgba_img.save(out_transparent)
    print(f"  Transparent bg -> {os.path.relpath(out_transparent, SCANS_DIR)}")

    # ─── Task 2: Separate individual drawings ─────────────────────────────────
    paper_mask = get_paper_mask(gray)
    drawing_contours, binary = find_drawing_contours(gray, paper_mask)
    print(f"  Found {len(drawing_contours)} drawing(s)")

    for i, (cnt, cnt_mask) in enumerate(drawing_contours, start=1):
        x, y, cw, ch = cv2.boundingRect(cnt)

        # Tight bounding box of actual ink (from original binary) clipped to contour
        ink_in_cnt = cv2.bitwise_and(binary, cnt_mask)
        ink_coords = np.where(ink_in_cnt > 0)
        if len(ink_coords[0]) == 0:
            continue
        iy1 = max(0, int(ink_coords[0].min()) - PADDING)
        iy2 = min(h, int(ink_coords[0].max()) + PADDING)
        ix1 = max(0, int(ink_coords[1].min()) - PADDING)
        ix2 = min(w, int(ink_coords[1].max()) + PADDING)

        # Crop the gray image and apply transparency
        crop_gray = gray[iy1:iy2, ix1:ix2]
        rgba_crop = make_transparent(crop_gray)

        # Mask out ink that belongs to OTHER drawings (outside this contour)
        crop_cnt_mask = cnt_mask[iy1:iy2, ix1:ix2]
        # Where the contour mask is 0, force full transparency
        rgba_crop[:, :, 3] = np.where(crop_cnt_mask > 0, rgba_crop[:, :, 3], 0).astype(np.uint8)

        out_path = os.path.join(IMAGES_DIR, f"{name}-{i:02d}.png")
        Image.fromarray(rgba_crop, "RGBA").save(out_path)
        print(f"    [{i}] ({ix1},{iy1})→({ix2},{iy2})  -> {os.path.basename(out_path)}")


def main():
    os.makedirs(TRANSPARENT_DIR, exist_ok=True)
    os.makedirs(IMAGES_DIR, exist_ok=True)

    jpgs = sorted([
        os.path.join(SCANS_DIR, f)
        for f in os.listdir(SCANS_DIR)
        if f.lower().endswith(".jpg")
    ])

    if not jpgs:
        print("No .jpg files found in", SCANS_DIR)
        sys.exit(1)

    for jpg in jpgs:
        process_image(jpg)

    print("\nDone.")


if __name__ == "__main__":
    main()
