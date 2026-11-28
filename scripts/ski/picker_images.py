#!/usr/bin/env python3
"""The resort picker's pictures: one GPU shot of each resort (rendered by the game itself, never a photo or satellite image),
cropped to 16:10 and saved as two small WebPs (pb/ski/img/<rid>-1200.webp and <rid>-640.webp, each <= 80 KB).

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/picker_images.py killy=/path/killy.png zermatt=/path/z.png:0.3 ...

`:<f>` after a path = where the 16:10 crop sits vertically when the shot is taller (0 top, 0.5 middle, 1 bottom; default 0.5).
The shots: scripts/ski/shot.mjs --gpu --dpr 2 --size 1200x750 --script <hide the UI, setCamera per pose> (poses in HANDOFF.md).
"""
import io
import os
import sys

from PIL import Image, ImageFilter

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, "pb", "ski", "img")
MAX_BYTES = 80 * 1024
SIZES = (1200, 640)
RATIO = 16 / 10


def crop_16_10(im, fy):
    w, h = im.size
    if w / h > RATIO:                                   # too wide: cut the sides evenly
        nw = round(h * RATIO)
        x = (w - nw) // 2
        return im.crop((x, 0, x + nw, h))
    nh = round(w / RATIO)
    y = round((h - nh) * fy)
    return im.crop((0, y, w, y + nh))


def encode(im, width):
    small = im.resize((width, round(width / RATIO)), Image.LANCZOS)
    for q in range(82, 30, -4):
        buf = io.BytesIO()
        small.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() <= MAX_BYTES:
            return buf.getvalue(), q
    return None, 0


def main():
    os.makedirs(OUT, exist_ok=True)
    for arg in sys.argv[1:]:
        rid, spec = arg.split("=", 1)
        path, _, fy = spec.partition(":")
        im = crop_16_10(Image.open(path).convert("RGB"), float(fy or 0.5))
        for width in SIZES:
            data, q = encode(im, width)
            for blur in (1.0, 1.6, 2.2):                # too detailed for 80 KB (far forests): soften a little, like Laax's picture
                if data is not None:
                    break
                data, q = encode(im.filter(ImageFilter.GaussianBlur(blur * width / 640)), width)
            if data is None:
                raise SystemExit(f"cannot get {width} px under {MAX_BYTES} bytes")
            name = f"{rid}-{width}.webp"
            with open(os.path.join(OUT, name), "wb") as f:
                f.write(data)
            print(f"{name}: {len(data) // 1024} KB (q {q})")


if __name__ == "__main__":
    main()
