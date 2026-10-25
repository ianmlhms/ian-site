#!/usr/bin/env python3
"""Generate the painted texture set of MTB Mëllerdall with the OpenAI image API (gpt-image-2).

Rerunnable: every texture that already exists in pb/mtb/data/tex/ is skipped (`--force name ...` redoes one, `--only name ...` limits the run).
The API key is read from the environment or from ~/.config/openai/.env, never from an argument (this repo is PUBLIC: never write the key anywhere).
Raw API pictures are kept OUTSIDE the repo (~/Library/Caches/mtb-texgen/raw), so a re-cut or re-tile costs no new image.

Pipeline per texture
  tile    : 1024 px painting -> made seamless (offset + cross-fade, one axis after the other) -> shrunk -> WebP
  sprites : a sheet of foliage on a plain background -> Apple Vision cut-out (cutout.swift, a compiled CLI in the depalma-promo folder) -> split into the
            cells of the sheet -> each cell trimmed and fitted into a 256 px atlas tile; the colour of transparent texels is filled with the average leaf
            colour so mip-mapping never pulls dark fringes into the leaves -> one RGBA WebP atlas
Everything is painted (gpt-image-2 prompted for a hand-painted game look), never a photograph and never a satellite picture.
Cost: one image per texture (`--list` prints the plan); the number of API calls of a run is printed at the end and appended to data/tex/COST.txt."""

import argparse
import base64
import io
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image, ImageFilter

API_URL = "https://api.openai.com/v1/images/generations"
MODEL = "gpt-image-2"
QUALITY = "medium"
SIZE = "1024x1024"
TIMEOUT_S = 300
MAX_PARALLEL = 3
ENV_FILE = os.path.expanduser("~/.config/openai/.env")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(ROOT, "pb", "mtb", "data", "tex")
RAW_DIR = os.path.expanduser("~/Library/Caches/mtb-texgen/raw")
CUTOUT = os.path.expanduser("~/Library/CloudStorage/OneDrive-Mulheims/depalma-promo/cutout")
WEBP_QUALITY = 80
SEAM_WIDTH = 0.14            # width of the transition at the wandering seam of the tiling step (in ramp units)
ATLAS_TILE = 256

# One shared style string: this is what makes the set look like one artist painted it.
STYLE = (
    "Style: hand-painted stylised game texture, painterly gouache and soft digital brush strokes, rich saturated natural colours, "
    "readable simple shapes with a little fine detail, like a high-quality indie game (Ghibli background art meets Sea of Thieves materials). "
    "NOT a photograph, NOT photorealistic, no real-photo noise. Even flat lighting, no cast shadows, no vignette, no perspective, "
    "no border, no frame, no text, no watermark, no people, no animals."
)
TILE_STYLE = " The picture is a seamless tileable material swatch that fills the whole square edge to edge."
SPRITE_STYLE = (
    " Each item is a separate painted cut-out sprite on a plain flat pale grey-white background (#e8e8e8), nothing touching, "
    "clear gaps between the items and the picture edges, no ground, no shadow."
)


def tile_spec(subject, size=512, kind="tile"):
    return {"kind": kind, "subject": subject, "size": size}


TEXTURES = {
    "sandstone": tile_spec(
        "Front view of a weathered Luxembourg sandstone cliff face (Luxembourg sandstone, Mullerthal): warm ochre, cream and pale yellow-grey layers, "
        "clear horizontal bedding bands, thin vertical joint cracks, honeycomb weathering pits, a few dark rusty-brown water streaks, "
        "sparse tiny moss specks. Orthographic wall view, strata run horizontally."),
    "sandstone_moss": tile_spec(
        "Front view of a sandstone cliff face in the Mullerthal forest, mostly covered in thick bright green moss and lichen patches, "
        "with ochre sandstone showing through in cracks and ledges, damp dark streaks, tiny ferns. Orthographic wall view, strata run horizontally."),
    "wet_rock": tile_spec(
        "Dark wet mossy sandstone boulder surface beside a waterfall: nearly black-green and dark grey-brown stone, glossy wet highlights, "
        "deep green moss cushions, tiny droplets, slime streaks. Close orthographic view of the stone surface."),
    "bark_beech": tile_spec(
        "Smooth grey beech tree bark seen straight on, silvery grey with a faint green tint, soft horizontal wrinkles and eye-shaped scars, "
        "light green-grey lichen patches, very smooth. The trunk grows vertically (the pattern runs vertically).", 512),
    "bark_oak": tile_spec(
        "Old oak tree bark seen straight on: deep vertical furrows and thick ridges, dark brown and grey, a few mossy green patches. "
        "The trunk grows vertically (ridges run vertically).", 512),
    "litter_summer": tile_spec(
        "Top-down view of a beech forest floor in summer: last year's brown and tan beech leaves, little twigs, a few tiny green sprouts, "
        "scattered pale fleck highlights, sun-warmed brown with some lighter patches. Bright, fresh, not muddy."),
    "litter_autumn": tile_spec(
        "Top-down view of a forest floor covered in freshly fallen beech and oak leaves in autumn: copper orange, golden yellow, russet red and brown, "
        "a few twigs and acorns."),
    "moss": tile_spec(
        "Top-down view of a lush moss carpet on a forest floor: bright emerald and yellow-green cushion moss, tiny fern sprouts, a few small leaves, "
        "soft fluffy painted texture."),
    "dirt_roots": tile_spec(
        "Top-down view of a packed sandy-brown mountain bike trail: compacted sand and fine gravel, small pebbles, a few thin tree roots "
        "crossing the surface, faint tyre-fine streaks, warm light brown with some darker damp patches."),
    "foam": tile_spec(
        "Top-down view of churned white foaming water at the foot of a waterfall: bright white foam streaks, bubbles and swirls over dark "
        "green-brown water, lots of white, painterly.", 512),
    "grass": tile_spec(
        "Top-down view of a sunny meadow: fresh green grass blades painted in soft strokes, a few tiny yellow and white flowers, "
        "light yellow-green and mid green variation, calm and even.", 512),
    "sky": tile_spec(
        "A soft painted summer sky seen straight on: gentle blue gradient with fluffy white painterly cumulus clouds with lilac-grey undersides, "
        "calm and even", 512, kind="sky"),
    # sprite sheets (cut out and packed into the leaf atlas, see ATLAS_SLOTS)
    "sheet_beech": {"kind": "sheet", "grid": (2, 2), "subject":
        "A sheet of FOUR different branch sprigs of beech tree leaves (Fagus sylvatica), each sprig a dense leafy cluster of about 15 oval glossy "
        "fresh spring-green beech leaves with visible veins and wavy edges, some leaves lighter yellow-green where the sun shines through, "
        "some darker green, arranged in a 2 by 2 grid, each sprig filling its quarter of the picture, seen flat from the front."},
    "sheet_oak": {"kind": "sheet", "grid": (2, 2), "subject":
        "A sheet of FOUR different branch sprigs of oak tree leaves, each a leafy cluster of about 10 lobed oak leaves in fresh mid and dark green "
        "with lighter yellow-green highlights, arranged in a 2 by 2 grid, each sprig filling its quarter of the picture, seen flat from the front."},
    "sheet_fern": {"kind": "sheet", "grid": (2, 2), "subject":
        "A sheet of FOUR different fresh green fern fronds (male fern, finely divided feathery leaflets), arching upright, bright and dark green, "
        "arranged in a 2 by 2 grid, each frond filling its quarter of the picture, seen flat from the front."},
    "sheet_ivy": {"kind": "sheet", "grid": (2, 2), "subject":
        "A sheet of FOUR different trailing ivy sprigs and holly-green leafy shrub twigs, dark glossy green heart-shaped ivy leaves with pale veins, "
        "arranged in a 2 by 2 grid, each sprig filling its quarter of the picture, seen flat from the front."},
}

# Which sheet cell lands in which tile of the 4 x 4 leaf atlas (ids match pb/mtb/leaf-textures.js TILE_ID: beech 0, oak 1, fern 2, shrub 3, ... painted extras 8..15).
ATLAS_COLS, ATLAS_ROWS = 4, 4
ATLAS_SLOTS = {
    "sheet_beech": [0, 8, 9, 10],
    "sheet_oak": [1, 11, 12, 13],
    "sheet_fern": [2, 14, 15, None],
    "sheet_ivy": [3, None, None, None],
}


def read_api_key():
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if key:
        return key
    try:
        with open(ENV_FILE, encoding="utf-8") as handle:
            for line in handle:
                name, _, value = line.strip().partition("=")
                if name == "OPENAI_API_KEY" and value:
                    return value
    except OSError:
        pass
    sys.exit(f"No OPENAI_API_KEY in the environment or {ENV_FILE}")


def request_image(key, prompt):
    body = json.dumps({"model": MODEL, "prompt": prompt, "size": SIZE, "quality": QUALITY, "n": 1}).encode("utf-8")
    request = urllib.request.Request(API_URL, data=body, headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        payload = json.load(response)
    return base64.b64decode(payload["data"][0]["b64_json"])


def smooth_noise(shape, scale, seed):
    """Low-frequency noise in 0..1 (random values blurred, tiled copies avoided: it only shapes the seam path)."""
    rng = np.random.default_rng(seed)
    small = rng.random((max(2, shape[0] // scale), max(2, shape[1] // scale))).astype(np.float32)
    img = Image.fromarray((small * 255).astype(np.uint8)).resize((shape[1], shape[0]), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 255


def make_tileable(img, seed=1):
    """Offset + blend along a wandering seam, one axis after the other (the second pass keeps the first one's tiling).
    A straight cross-fade ghosts painted detail; a noisy, narrow transition cuts through the painting like a brush edge instead."""
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    for axis in (1, 0):
        h, w = arr.shape[:2]
        n = arr.shape[axis]
        rolled = np.roll(arr, n // 2, axis=axis)
        x = np.abs(np.linspace(-1, 1, n))                       # 1 at the edges, 0 in the middle
        ramp = (1 - x)[None, :] if axis == 1 else (1 - x)[:, None]   # 1 in the middle of the axis (use the original there), 0 at the edges
        noise = smooth_noise((h, w), 48, seed + axis) - 0.5
        v = ramp + noise * 0.5 - 0.5
        m = np.clip(v / SEAM_WIDTH + 0.5, 0, 1)[..., None]
        m = m * m * (3 - 2 * m)
        arr = arr * m + rolled * (1 - m)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def even_out(img):
    """Remove the large-scale light gradient (a tile must not show a lighter patch every repeat)."""
    arr = np.asarray(img, dtype=np.float32)
    low = np.asarray(img.filter(ImageFilter.GaussianBlur(img.width / 5)), dtype=np.float32)
    mean = low.mean(axis=(0, 1), keepdims=True)
    return Image.fromarray(np.clip(arr * (mean / np.maximum(low, 8)) ** 0.6, 0, 255).astype(np.uint8))


def process_tile(raw, spec, path):
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    img = img.resize((1024, 1024), Image.LANCZOS)
    img = make_tileable(even_out(img)) if spec["kind"] == "tile" else make_tileable(img)
    img = img.resize((spec["size"], spec["size"]), Image.LANCZOS)
    img.save(path, "WEBP", quality=WEBP_QUALITY, method=6)


def cut_out(raw_path):
    out = raw_path.replace(".png", "-cut.png")
    if not os.path.exists(out):
        subprocess.run([CUTOUT, raw_path, out], check=True)
    return Image.open(out).convert("RGBA")


def remove_background(cell):
    """The cut-out keeps the pale background seen through gaps between leaves: drop every near-white desaturated texel, then shave one pixel off the edge (white halo)."""
    arr = np.asarray(cell, dtype=np.uint8).copy()
    rgb = arr[..., :3].astype(np.int16)
    pale = (rgb.min(axis=2) > 196) & ((rgb.max(axis=2) - rgb.min(axis=2)) < 26)
    arr[pale, 3] = 0
    alpha = Image.fromarray(arr[..., 3]).filter(ImageFilter.MinFilter(3))
    arr[..., 3] = np.asarray(alpha)
    return Image.fromarray(arr, "RGBA")


def fit_tile(cell):
    """Crop a cut-out cell to its alpha box, fit it into one atlas tile and fill the colour of transparent texels with the average leaf colour."""
    cell = remove_background(cell)
    box = cell.getbbox()
    if not box:
        return None
    cell = cell.crop(box)
    scale = (ATLAS_TILE - 6) / max(cell.size)
    cell = cell.resize((max(1, round(cell.width * scale)), max(1, round(cell.height * scale))), Image.LANCZOS)
    arr = np.asarray(cell, dtype=np.float32)
    opaque = arr[..., 3] > 200
    mean = arr[opaque][:, :3].mean(axis=0) if opaque.any() else np.array([70, 110, 40.0])
    tile = np.zeros((ATLAS_TILE, ATLAS_TILE, 4), np.uint8)
    tile[..., :3] = mean.astype(np.uint8)
    ox, oy = (ATLAS_TILE - cell.width) // 2, ATLAS_TILE - 3 - cell.height          # the sprig grows from the bottom edge of its tile
    h, w = cell.height, cell.width
    colour = arr[..., :3].copy()
    colour[arr[..., 3] < 8] = mean                                                  # texels with no coverage take the average colour
    tile[oy:oy + h, ox:ox + w, :3] = colour.astype(np.uint8)
    tile[oy:oy + h, ox:ox + w, 3] = arr[..., 3].astype(np.uint8)
    return tile


def process_sheet(name, spec, raw_path, atlas):
    cut = cut_out(raw_path)
    cols, rows = spec["grid"]
    cw, ch = cut.width // cols, cut.height // rows
    for idx, slot in enumerate(ATLAS_SLOTS[name]):
        if slot is None:
            continue
        c, r = idx % cols, idx // cols
        tile = fit_tile(cut.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)))
        if tile is None:
            print(f"  warning: {name} cell {idx} is empty")
            continue
        ac, ar = slot % ATLAS_COLS, slot // ATLAS_COLS
        atlas[ar * ATLAS_TILE:(ar + 1) * ATLAS_TILE, ac * ATLAS_TILE:(ac + 1) * ATLAS_TILE] = tile


def generate(name, key, force):
    spec = TEXTURES[name]
    raw_path = os.path.join(RAW_DIR, name + ".png")
    calls = 0
    if not os.path.exists(raw_path) or name in force:
        style = SPRITE_STYLE if spec["kind"] == "sheet" else TILE_STYLE
        prompt = spec["subject"] + " " + STYLE + style
        try:
            raw = request_image(key, prompt)
        except urllib.error.HTTPError as error:
            return name, 0, f"FAIL  {name}: HTTP {error.code} {error.read()[:200].decode('utf-8', 'replace')}"
        except (urllib.error.URLError, OSError, KeyError, ValueError) as error:
            return name, 0, f"FAIL  {name}: {type(error).__name__} {error}"
        with open(raw_path, "wb") as handle:
            handle.write(raw)
        calls = 1
    return name, calls, f"ok    {name} ({'generated' if calls else 'raw cached'})"


def build_outputs(names):
    os.makedirs(OUT_DIR, exist_ok=True)
    sheets = [n for n in names if TEXTURES[n]["kind"] == "sheet"]
    for name in names:
        spec = TEXTURES[name]
        raw_path = os.path.join(RAW_DIR, name + ".png")
        if spec["kind"] == "sheet" or not os.path.exists(raw_path):
            continue
        with open(raw_path, "rb") as handle:
            process_tile(handle.read(), spec, os.path.join(OUT_DIR, name + ".webp"))
    if sheets:
        atlas_path = os.path.join(OUT_DIR, "leaf-atlas.webp")
        if os.path.exists(atlas_path):
            atlas = np.asarray(Image.open(atlas_path).convert("RGBA")).copy()
        else:
            atlas = np.zeros((ATLAS_TILE * ATLAS_ROWS, ATLAS_TILE * ATLAS_COLS, 4), np.uint8)
        for name in sheets:
            raw_path = os.path.join(RAW_DIR, name + ".png")
            if os.path.exists(raw_path):
                process_sheet(name, TEXTURES[name], raw_path, atlas)
        Image.fromarray(atlas, "RGBA").save(atlas_path, "WEBP", quality=82, method=6, exact=True, alpha_quality=90)


def main():
    parser = argparse.ArgumentParser(description="Generate the painted texture set.")
    parser.add_argument("--force", nargs="*", default=[], help="ask the API again for these textures ('all' for every one)")
    parser.add_argument("--only", nargs="*", default=[], help="limit the run to these textures")
    parser.add_argument("--list", action="store_true", help="print the plan and stop")
    parser.add_argument("--rebuild", action="store_true", help="redo the tiling / packing from the cached raw pictures, no API call")
    args = parser.parse_args()
    unknown = (set(args.only) | (set(args.force) - {"all"})) - set(TEXTURES)
    if unknown:
        sys.exit("Unknown texture(s): " + ", ".join(sorted(unknown)))
    names = args.only or list(TEXTURES)
    force = set(TEXTURES) if "all" in args.force else set(args.force)
    if args.list:
        for n in names:
            print(n, TEXTURES[n]["kind"], os.path.exists(os.path.join(OUT_DIR, n + ".webp")) and "(exists)" or "")
        return 0
    os.makedirs(RAW_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    todo = []
    for n in names:
        done = os.path.join(RAW_DIR, n + ".png") if TEXTURES[n]["kind"] == "sheet" else os.path.join(OUT_DIR, n + ".webp")   # sheets share one atlas file: their cached raw picture says they were fetched
        out_exists = os.path.exists(done)
        if args.rebuild or (out_exists and n not in force):
            continue
        todo.append(n)
    total = 0
    if todo and not args.rebuild:
        key = read_api_key()
        with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
            for n, calls, line in pool.map(lambda n: generate(n, key, force), todo):
                total += calls
                print(line)
    build_outputs(names if args.rebuild else todo or names)
    sizes = {f: os.path.getsize(os.path.join(OUT_DIR, f)) for f in sorted(os.listdir(OUT_DIR)) if f.endswith(".webp")}
    print("\n".join(f"{f}: {s // 1024} KB" for f, s in sizes.items()))
    print(f"total {sum(sizes.values()) / 1048576:.2f} MB; API images this run: {total}")
    if total:
        with open(os.path.join(OUT_DIR, "COST.txt"), "a", encoding="utf-8") as handle:
            handle.write(f"{total} images ({QUALITY}, {SIZE}): {', '.join(todo)}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
