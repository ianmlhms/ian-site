#!/usr/bin/env python3
"""R8c: HUD text contrast on a game screenshot: per text box (CSS px, JSON {name: [x0, y0, x1, y1]}), the WCAG contrast ratio between
the text (the brightest 12 % of the box: white glyphs) and what is behind it (the darkest 55 %: backdrop, halo, scene).
    python scripts/ski/r8c-hud.py shot.png '{"clock": [12, 92, 80, 118]}' [scale]      (scale = device pixels per CSS px)"""
import json
import sys

import numpy as np
from PIL import Image


def lum(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def contrast(path, boxes, scale=1.0):
    im = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    out = {}
    for k, (x0, y0, x1, y1) in boxes.items():
        a = lum(im[int(y0 * scale):int(y1 * scale), int(x0 * scale):int(x1 * scale)]).ravel()
        if a.size < 10:
            continue
        a.sort()
        text = a[int(a.size * 0.88):].mean()
        back = a[:int(a.size * 0.55)].mean()
        out[k] = round((text + 0.05) / (back + 0.05), 2)
    return out


if __name__ == "__main__":
    print(json.dumps(contrast(sys.argv[1], json.loads(sys.argv[2]), float(sys.argv[3]) if len(sys.argv) > 3 else 1.0)))
