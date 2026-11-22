#!/usr/bin/env python3
"""Before | after sheet of scripts/ski/camera-shots.mjs:  python3 scripts/ski/camera_sheet.py SHOTS_DIR OUT.jpg [scene ...]
Each row one scene (before left, after right) with the measured camera numbers of <tag>.json under the picture."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

shots, out = Path(sys.argv[1]), Path(sys.argv[2])
scenes = sys.argv[3:] or ["blue", "black", "village", "kicker"]
data = {tag: json.loads((shots / f"{tag}.json").read_text()) for tag in ("before", "after")}
W = 760
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 20)
except OSError:
    font = ImageFont.load_default()
rows = []
for scene in scenes:
    pair = []
    for tag in ("before", "after"):
        im = Image.open(shots / f"{tag}-{scene}.png").convert("RGB")
        im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
        r = data[tag].get(scene, {})
        label = f"{tag.upper()}  {scene}: {r.get('kmh', '?')} km/h, {r.get('pitch', '?')} deg down, {r.get('up', '?')} m up, {r.get('dist', '?')} m back, {r.get('clear', '?')} m over its snow"
        cell = Image.new("RGB", (W, im.height + 30), "white")
        cell.paste(im, (0, 0))
        ImageDraw.Draw(cell).text((6, im.height + 4), label, fill="black", font=font)
        pair.append(cell)
    row = Image.new("RGB", (W * 2 + 8, pair[0].height), "white")
    row.paste(pair[0], (0, 0))
    row.paste(pair[1], (W + 8, 0))
    rows.append(row)
sheet = Image.new("RGB", (W * 2 + 8, sum(r.height for r in rows) + 8 * (len(rows) - 1)), "white")
y = 0
for r in rows:
    sheet.paste(r, (0, y))
    y += r.height + 8
sheet.save(out, quality=88)
print(out, sheet.size)
