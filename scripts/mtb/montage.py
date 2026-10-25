#!/usr/bin/env python3
"""Joins pictures into one contact sheet. usage: montage.py OUT.jpg COLUMNS WIDTH IMG[:caption] ... (run with the luxtram venv python)"""
import sys
from PIL import Image, ImageDraw

out, cols, width = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
items = [a.split(":", 1) + [""] for a in sys.argv[4:]]
cells = []
for item in items:
    im = Image.open(item[0]).convert("RGB")
    im = im.resize((width, round(im.height * width / im.width)))
    cells.append((im, item[1]))
rows = [cells[i:i + cols] for i in range(0, len(cells), cols)]
row_h = [max(c[0].height for c in r) + 22 for r in rows]
sheet = Image.new("RGB", (cols * width + (cols - 1) * 6, sum(row_h)), (16, 22, 18))
y = 0
for r, h in zip(rows, row_h):
    for i, (im, cap) in enumerate(r):
        sheet.paste(im, (i * (width + 6), y))
        ImageDraw.Draw(sheet).text((i * (width + 6) + 6, y + im.height + 5), cap, fill=(210, 220, 210))
    y += h
sheet.save(out, quality=88)
