#!/usr/bin/env python3
"""R8c: thin bright line score of a game screenshot (the "circuit board" lines on rock / snow): the share of pixels in a box that are a
1-2 px bright ridge (brighter than both neighbours 2 px away, across x or across y, by > DELTA). Clean snow ~0.2-0.6 %, the old lines 2-6 %.
    python scripts/ski/r8c-lines.py shot.png [x0 y0 x1 y1] [...more shots]   (box in fractions of the image, default the lower 2/3)"""
import sys

import numpy as np
from PIL import Image

DELTA = 22


def score(path, box=(0.0, 0.4, 0.82, 0.98)):
    im = np.asarray(Image.open(path).convert("L"), dtype=np.int16)
    h, w = im.shape
    x0, y0, x1, y1 = int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)
    a = im[y0:y1, x0:x1]
    c = a[2:-2, 2:-2]
    rx = (c - a[2:-2, :-4] > DELTA) & (c - a[2:-2, 4:] > DELTA)
    ry = (c - a[:-4, 2:-2] > DELTA) & (c - a[4:, 2:-2] > DELTA)
    return float((rx | ry).mean() * 100)


if __name__ == "__main__":
    args = sys.argv[1:]
    box = None
    if len(args) > 4 and all(s.replace(".", "", 1).isdigit() for s in args[1:5]):
        box = tuple(float(v) for v in args[1:5])
        args = [args[0]] + args[5:]
    for p in args:
        print("%6.2f %%  %s" % (score(p, box) if box else score(p), p))
