#!/usr/bin/env python3
"""Generate the Burger Rush sprite set with the OpenAI image API.

One-off tool: the sprites it writes are committed, so a normal checkout never
needs to run this. Re-run it only to add an asset or redo one that came out
wrong (`--force patty-cooked`).

The API key is read from the environment or from ~/.config/openai/.env and is
never accepted as a command-line argument -- arguments end up in shell history
and in `ps` output. This repo is PUBLIC: never write the key into a file here.

Each sprite is generated at 1024px on a transparent background, cropped to its
content, downscaled to its display size and saved as WebP, which is roughly a
tenth of the PNG size at the same quality.
"""

import argparse
import base64
import io
import json
import os
import sys
import urllib.error
import urllib.request
from collections import namedtuple
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

API_URL = "https://api.openai.com/v1/images/generations"
MODEL = "gpt-image-2"
SOURCE_SIZE = "1024x1024"
SOURCE_WIDE = "1536x1024"
QUALITY = "medium"
REQUEST_TIMEOUT_S = 240
MAX_PARALLEL = 4

# Content is cropped to its bounding box, then padded by this fraction of the
# longer side so nothing touches the sprite edge when the game scales it.
CROP_MARGIN = 0.03

# Display sizes. Food is drawn small and stacked; stations and characters are
# the largest things on screen and need the extra pixels on a retina iPad.
SIZE_SMALL = 256
SIZE_LARGE = 512
# Scene layers span the whole play area, so they need the width a retina iPad shows.
SIZE_SCENE = 1280

ENV_FILE = os.path.expanduser("~/.config/openai/.env")
ART_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "pb", "burger", "art")

# Held constant across every asset so the set looks like one artist drew it.
STYLE = (
    "Style: cute stylized 2D mobile game asset in the style of Cooking Fever or "
    "Diner Dash. Clean cartoon illustration with smooth cel shading, bold simple "
    "shapes, saturated warm colours, subtle glossy highlight, thin darker outline. "
    "NOT photorealistic, no photography, no realistic texture, no grain. "
    "Single object centred and cut out on a fully transparent background, "
    "no backdrop, no vignette, no glow, no cast shadow, no text, no watermark."
)

CUSTOMER_STYLE = (
    "Style: cute stylized 2D mobile game character in the style of Cooking Fever "
    "or Diner Dash. Head-and-shoulders bust, facing the viewer, friendly smile, "
    "clean cartoon illustration with smooth cel shading, bold simple shapes, "
    "saturated colours, thin darker outline. NOT photorealistic. "
    "Cut out on a fully transparent background, no backdrop, no vignette, "
    "no cast shadow, no text, no watermark."
)

# Scene layers are drawn behind and around the kitchen, so they are painted as a
# room rather than cut out as an object.
SCENE_STYLE = (
    "Style: cute stylized 2D mobile game background art in the style of Cooking "
    "Fever or Diner Dash. Clean cartoon illustration with smooth cel shading, "
    "bold simple shapes, saturated warm colours, warm inviting lighting. "
    "NOT photorealistic, no photography, no realistic texture, no grain, "
    "no text, no watermark, no people."
)

SCENE_CUTOUT_STYLE = (
    "Style: cute stylized 2D mobile game prop in the style of Cooking Fever or "
    "Diner Dash. Clean cartoon illustration with smooth cel shading, bold simple "
    "shapes, saturated warm colours, thin darker outline, warm lighting. "
    "NOT photorealistic, no photography, no grain. Cut out on a fully "
    "transparent background, no backdrop, no vignette, no text, no watermark."
)

Asset = namedtuple("Asset", "subject size style source transparent trim")


def asset(subject, size, style, source=SOURCE_SIZE, transparent=True, trim=True):
    return Asset(subject, size, style, source, transparent, trim)


PROMPTS = {
    "bun-bottom":    asset("The bottom half of a soft golden burger bun, seen from a slight three-quarter top-down angle.", SIZE_SMALL, STYLE),
    "bun-top":       asset("The domed top half of a golden burger bun covered in sesame seeds, seen from a slight three-quarter top-down angle.", SIZE_SMALL, STYLE),
    "patty-raw":     asset("A single raw pink-red ground beef burger patty, flat and uncooked, seen from a slight three-quarter top-down angle.", SIZE_SMALL, STYLE),
    "patty-cooked":  asset("A single perfectly cooked brown beef burger patty with dark grill marks, seen from a slight three-quarter top-down angle.", SIZE_SMALL, STYLE),
    "patty-burnt":   asset("A single badly burnt black charred beef burger patty with a thin wisp of smoke, seen from a slight three-quarter top-down angle.", SIZE_SMALL, STYLE),
    "cheese":        asset("A single square slice of bright orange melting cheddar cheese with softly drooping corners, seen from a slight three-quarter top-down angle.", SIZE_SMALL, STYLE),
    "lettuce":       asset("A single ruffled fresh green lettuce leaf shaped to sit on a burger, seen from a slight three-quarter top-down angle.", SIZE_SMALL, STYLE),
    "tomato":        asset("Two round slices of ripe red tomato overlapping slightly, seen from a slight three-quarter top-down angle.", SIZE_SMALL, STYLE),
    "fries-raw":     asset("A small pile of pale uncooked potato fries in a wire fryer basket, seen from a slight three-quarter angle.", SIZE_SMALL, STYLE),
    "fries-cooked":  asset("A red carton of golden crispy french fries, seen from a slight three-quarter angle.", SIZE_SMALL, STYLE),
    "fries-burnt":   asset("A red carton of badly burnt black overcooked french fries with a thin wisp of smoke, seen from a slight three-quarter angle.", SIZE_SMALL, STYLE),
    "cola":          asset("A tall takeaway paper cup of dark cola with a domed lid and a red striped straw, seen from the front.", SIZE_SMALL, STYLE),
    "lemonade":      asset("A tall takeaway paper cup of pale yellow lemonade with a domed lid and a yellow striped straw, seen from the front.", SIZE_SMALL, STYLE),
    "shake":         asset("A tall takeaway cup of thick pink milkshake topped with whipped cream and a wide straw, seen from the front.", SIZE_SMALL, STYLE),
    "plate":         asset("An empty round white ceramic plate seen from a steep three-quarter top-down angle.", SIZE_SMALL, STYLE),
    "coin":          asset("A single shiny gold coin standing upright, seen from the front, with a simple star embossed on its face.", SIZE_SMALL, STYLE),
    "star":          asset("A single glossy five-pointed golden star, seen from the front.", SIZE_SMALL, STYLE),
    "grill":         asset("A stainless steel commercial kitchen flat-top grill unit with dark grill bars on top and a chrome body, empty, seen from a three-quarter front angle.", SIZE_LARGE, STYLE),
    "fryer":         asset("A stainless steel commercial deep fryer unit with two empty wire baskets and a chrome body, seen from a three-quarter front angle.", SIZE_LARGE, STYLE),
    "drink-machine": asset("A red and chrome fountain soda dispensing machine with three nozzles and no cups, seen from the front.", SIZE_LARGE, STYLE),
    "counter":       asset("A long polished wooden diner service counter section with a light stone top, empty, seen from the front.", SIZE_LARGE, STYLE),
    "floor":         asset("A seamless square tile of black and white checkerboard diner floor, seen straight from above.", SIZE_LARGE, STYLE),
    "customer-1":    asset("A cheerful teenage boy with short brown hair wearing a blue hoodie.", SIZE_LARGE, CUSTOMER_STYLE),
    "customer-2":    asset("A smiling young woman with long red hair wearing a yellow jacket.", SIZE_LARGE, CUSTOMER_STYLE),
    "customer-3":    asset("A friendly older man with grey hair, glasses and a green sweater.", SIZE_LARGE, CUSTOMER_STYLE),
    "customer-4":    asset("A happy girl with black curly hair in a pink t-shirt.", SIZE_LARGE, CUSTOMER_STYLE),
    "customer-5":    asset("A businessman with blond hair in a grey suit and a loosened tie.", SIZE_LARGE, CUSTOMER_STYLE),
    "customer-6":    asset("A cheerful woman with a dark ponytail wearing a purple sports top.", SIZE_LARGE, CUSTOMER_STYLE),

    # --- perspective scene layers, drawn back to front ---
    "room-back": asset(
        "The interior of a warm, busy 1950s American diner seen from behind the "
        "service counter looking out into the dining room. A back wall with tall "
        "windows showing a sunny street with parked cars and trees outside, "
        "wood panelling, warm hanging pendant lamps, an empty dining room with "
        "red booth seating and tables receding in perspective. Completely empty "
        "of people. The bottom third of the image is clear open floor.",
        SIZE_SCENE, SCENE_STYLE, source=SOURCE_WIDE, transparent=False, trim=False),
    "counter-persp": asset(
        "A long polished diner service counter with a light speckled stone top "
        "and a wood front, running straight across the full width of the image "
        "and seen from slightly above from the kitchen side, empty, nothing on it.",
        SIZE_SCENE, SCENE_CUTOUT_STYLE, source=SOURCE_WIDE, trim=False),
    "guests-seated": asset(
        "A row of three cheerful cartoon diner customers sitting at separate "
        "tables eating burgers, seen from the front at a distance, small in frame, "
        "spread evenly across the full width of the image.",
        SIZE_SCENE, SCENE_CUTOUT_STYLE, source=SOURCE_WIDE, trim=False),

    # --- interior upgrades: each appears in the room once bought ---
    "deco-plants":  asset("Two tall leafy green potted houseplants in terracotta pots, side by side.", SIZE_LARGE, SCENE_CUTOUT_STYLE),
    "deco-chairs":  asset("A pair of shiny red vinyl diner bar stools with chrome legs, side by side.", SIZE_LARGE, SCENE_CUTOUT_STYLE),
    "deco-tv":      asset("A flat wall-mounted television screen showing a colourful sports match, seen straight from the front.", SIZE_LARGE, SCENE_CUTOUT_STYLE),
    "deco-neon":    asset("A glowing pink and blue neon sign shaped like a hamburger, seen straight from the front.", SIZE_LARGE, SCENE_CUTOUT_STYLE),
    "deco-music":   asset("A classic chrome and red 1950s jukebox glowing softly, seen from a three-quarter front angle.", SIZE_LARGE, SCENE_CUTOUT_STYLE),
    "deco-floor":   asset("A seamless square tile of polished golden herringbone parquet floor, seen straight from above.", SIZE_LARGE, SCENE_STYLE, transparent=False, trim=False),
}


def read_api_key() -> str:
    """Environment first, then ~/.config/openai/.env. Never an argument."""
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


def request_image(key: str, prompt: str, spec: Asset) -> bytes:
    body = json.dumps({
        "model": MODEL,
        "prompt": prompt,
        "size": spec.source,
        "background": "transparent" if spec.transparent else "opaque",
        "quality": QUALITY,
        "n": 1,
    }).encode("utf-8")
    request = urllib.request.Request(API_URL, data=body, headers={
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
        payload = json.load(response)
    return base64.b64decode(payload["data"][0]["b64_json"])


def trim_and_resize(raw: bytes, spec: Asset) -> Image.Image:
    """Crop away the empty transparent border, pad slightly, fit the display size."""
    image = Image.open(io.BytesIO(raw)).convert("RGBA")
    if not spec.trim:
        # A scene layer keeps its full frame -- cropping it would break the
        # alignment every other layer is positioned against.
        image.thumbnail((spec.size, spec.size), Image.LANCZOS)
        return image
    box = image.getbbox()
    if box:
        image = image.crop(box)
    margin = int(max(image.size) * CROP_MARGIN)
    padded = Image.new("RGBA", (image.width + 2 * margin, image.height + 2 * margin), (0, 0, 0, 0))
    padded.paste(image, (margin, margin))
    padded.thumbnail((spec.size, spec.size), Image.LANCZOS)
    return padded


def generate(name: str, key: str, force: set) -> str:
    spec = PROMPTS[name]
    path = os.path.join(ART_DIR, name + ".webp")
    if os.path.exists(path) and name not in force:
        return f"skip  {name} (exists)"
    try:
        raw = request_image(key, spec.subject + " " + spec.style, spec)
        trim_and_resize(raw, spec).save(path, "WEBP", quality=88, method=6)
    except urllib.error.HTTPError as error:
        return f"FAIL  {name}: HTTP {error.code} {error.read()[:200].decode('utf-8', 'replace')}"
    except (urllib.error.URLError, OSError, KeyError, ValueError) as error:
        return f"FAIL  {name}: {type(error).__name__} {error}"
    return f"ok    {name} -> {os.path.getsize(path) // 1024} KB"


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Burger Rush sprites.")
    parser.add_argument("--force", nargs="*", default=[],
                        help="regenerate these assets even if they exist ('all' for every asset)")
    parser.add_argument("--only", nargs="*", default=[], help="generate only these assets")
    args = parser.parse_args()

    unknown = set(args.only) | (set(args.force) - {"all"})
    unknown -= set(PROMPTS)
    if unknown:
        sys.exit("Unknown asset(s): " + ", ".join(sorted(unknown)))

    force = set(PROMPTS) if "all" in args.force else set(args.force)
    names = args.only or sorted(PROMPTS)
    os.makedirs(ART_DIR, exist_ok=True)
    key = read_api_key()

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
        results = list(pool.map(lambda name: generate(name, key, force), names))

    for line in results:
        print(line)
    failed = [line for line in results if line.startswith("FAIL")]
    print(f"\n{len(results) - len(failed)}/{len(results)} written to {ART_DIR}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
