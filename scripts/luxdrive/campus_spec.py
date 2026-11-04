"""What the buildings of Campus Geesseknäppchen are made of (read by campus_bake.py).

A building is a list of PARTS: a region (a shapely polygon) cut out of the real footprint (OSM way, traced on the same orthophoto
the colours are read from), with its own roof elevation (from the LiDAR surface model unless `top` is given), wall colour and
facade style.  The facade styles (fx) and their parameters (fp) are drawn by pb/lux-drive/campus-facades.js, the roof extras (rf)
by campus-roofs.js.  Colours are painted flat colours chosen from the reference photos (Wikimedia Commons, see SURVEY.md).
Coordinates: world frame (x east, z south, metres)."""
import json
import math
import os
from shapely.geometry import Polygon, Point, box
from shapely import affinity

from campus_osm import OSM, REFS
NEVER_HIDE = set()
CAMPUS_WAY = 26245561
HIDDEN_PATH_BLOCKS = set()      # LOD2 blocks that also cut the paths (none: the building parts do


def OV(way, *idx):
    """A polygon through the given vertices of an OSM way; an entry may also be an explicit (x, z) point (a cut through the building)."""
    pts = OSM[way]["pts"]
    return Polygon([pts[i] if isinstance(i, int) else i for i in idx])


def P(*pts):
    return Polygon(pts)


def rect(cx, cz, length, width, deg=0.0):
    """A rectangle: `length` along the direction deg (0 = +x/east, 90 = +z/south), centred on (cx, cz)."""
    r = box(-length / 2, -width / 2, length / 2, width / 2)
    r = affinity.rotate(r, deg, origin=(0, 0))
    return affinity.translate(r, cx, cz)


def wedge(cx, cz, a0, a1, radius=400.0, n=12):
    """The sector between the directions a0 and a1 (degrees, 0 = east, 90 = south) around (cx, cz)."""
    pts = [(cx, cz)]
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        pts.append((cx + math.cos(a) * radius, cz + math.sin(a) * radius))
    return Polygon(pts)


def whole(way):
    return Polygon(OSM[way]["pts"])


# ---- colours (painted, from the photos; see SURVEY.md) ------------------------------------------------------------------
CREAM = [0.94, 0.89, 0.72]            # Athénée: the pale yellow render
SANDSTONE = [0.80, 0.72, 0.55]        # Athénée: the rough sandstone of the hall wall and the retaining walls
CONCRETE = [0.72, 0.71, 0.68]
CONCRETE_DARK = [0.52, 0.52, 0.51]
WHITE = [0.93, 0.92, 0.88]
BEIGE = [0.84, 0.78, 0.64]            # Lycée Michel Rodange: beige concrete
GLASS = [0.36, 0.50, 0.64]
GLASS_DARK = [0.30, 0.38, 0.48]
RED_FRAME = [0.70, 0.12, 0.10]
YELLOW = [0.92, 0.76, 0.18]

# the part of the campus a building belongs to: it decides which mesh (draw call) the building is in
BUILDINGS = []


def building(key, name, zone, parts, lod2=(), footprint=None, custom=None):
    BUILDINGS.append({"key": key, "name": name, "zone": zone, "parts": parts, "lod2": list(lod2), "footprint": footprint, "custom": custom})


def part(key, poly, wall, fx="blank", fp=None, top=None, roof=None, rf=None, clip=False, order=0, pct=35, dtop=0.0, dh=None, ft=None):
    """ft: the features that stand on the walls of the part (signs, entrance recesses, canopies, logos: campus-wallfx.js), with world positions."""
    return {"key": key, "poly": poly, "wall": wall, "fx": fx, "fp": fp or {}, "top": top, "roof": roof, "rf": rf or {}, "clip": clip, "order": order, "pct": pct, "dtop": dtop, "dh": dh, "ft": ft or []}


# things that stand free on the campus (not on a wall): signs on their own boards, bridges, pergolas, seats ...; drawn by campus-free.js
FREE = []


# ====================================================================================================================
# ATHÉNÉE DE LUXEMBOURG (OSM way 29050030; the LOD2 block 21024 also covers the sports plaza, which is ground: not built)
ATH = 29050030
ORANGE = [0.96, 0.56, 0.10]           # Athénée: the sun blinds
RIBBON_ATH = {"gf": {"h": 4.0, "depth": 1.6, "glass": [0.18, 0.26, 0.34], "pier": [0.80, 0.74, 0.58], "pitch": 3.6}, "floorH": 3.5, "sill": 0.8, "h": 2.0, "pier": 1.0, "mull": 2.6,
              "glass": GLASS, "frame": [0.90, 0.86, 0.70], "blind": ORANGE, "blindDrops": [0.7, 1.1, 1.5, 2.0], "blindShare": 0.72}
# the big glazed block (photo Luxembourg_Athénée_101): two storeys of blue reflective panes in white frames over a dark spandrel, standing on a recessed ground floor
CURTAIN_ATH = {"floorH": 4.2, "inset": 0.3, "pitch": 3.4, "spandrel": 0.9, "glass": [0.30, 0.44, 0.72], "dark": [0.10, 0.16, 0.32], "frameColor": [0.95, 0.95, 0.92],
               "gf": {"h": 4.2, "depth": 2.6, "glass": [0.20, 0.28, 0.36], "pier": [0.84, 0.78, 0.60], "pitch": 3.4, "every": 2, "mullion": [0.9, 0.9, 0.88]}}
building("athenee", "Athénée de Luxembourg", "N", [
    part("ath-west", OV(ATH, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21), CREAM, "ribbon", RIBBON_ATH,
         rf={"solar": [[3606, 9586, 44, 11, -26]]}),
    part("ath-spine", OV(ATH, 21, 22, 23, 24, 25, 26, 33, 34, (3700, 9648), 2, 3, 4, 5, 6, 7, 8, 9, 10), CREAM, "ribbon", RIBBON_ATH),
    part("ath-green", OV(ATH, 26, 27, 28, 29, 30, 31, 32, 33), CREAM, "curtain", CURTAIN_ATH, top=293.0),
    part("ath-sewing", OV(ATH, 34, 35, 36, 37, 38, 39, 40) , CREAM, "ribbon", RIBBON_ATH, rf={"solar": [[3726, 9630, 28, 7, -30]]}),
    part("ath-link", OV(ATH, 41, 42, 43, 56, 57, 58), CONCRETE, "blank", top=None),
    part("ath-gym", OV(ATH, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56), CONCRETE, "blank"),
], lod2=[21024])



# ====================================================================================================================
# BLUMM (OSM way 195220843): the star-shaped temporary building of several lycées (Athénée de Luxembourg, École internationale Gaston
# Thorn, ENAD): five arms clad in red, blue, yellow and green panels, around a glazed entrance hall.  The LOD2 block is 16312.
BL = 195220843
BLC = (3609.0, 9686.0)                      # the middle of the star
PAN_RED = [[0.80, 0.14, 0.12], [0.62, 0.10, 0.12], [0.86, 0.30, 0.16], [0.18, 0.28, 0.62]]
PAN_BLUE = [[0.16, 0.30, 0.70], [0.93, 0.78, 0.18], [0.16, 0.30, 0.70], [0.20, 0.60, 0.34]]
PAN_GREEN = [[0.20, 0.62, 0.34], [0.93, 0.78, 0.18], [0.16, 0.30, 0.70], [0.20, 0.60, 0.34]]
PAN_MIX = [[0.80, 0.14, 0.12], [0.16, 0.30, 0.70], [0.93, 0.78, 0.18], [0.20, 0.62, 0.34]]
def blumm_arm(key, a0, a1, palette):
    return part(key, wedge(BLC[0], BLC[1], a0, a1), [0.66, 0.66, 0.66], "panels",
                {"floorH": 3.3, "pitch": 2.2, "palette": palette, "w": 1.0, "sill": 1.0, "h": 1.5, "glass": GLASS_DARK, "windowEvery": 2, "pier": 0.6, "columns": True, "colorSeed": len(key), "slab": [0.55, 0.55, 0.56], "frame": [0.9, 0.9, 0.88]},
                clip=True, order=0)
building("blumm", "Blumm (Athénée, Gaston Thorn, ENAD)", "N", [
    blumm_arm("blumm-w", 124, 199, PAN_RED),
    blumm_arm("blumm-nnw", 199, 272.5, PAN_MIX),
    blumm_arm("blumm-ne", 272.5, 336.5, PAN_RED),
    blumm_arm("blumm-ese", 336.5, 407, PAN_BLUE),
    blumm_arm("blumm-s", 47, 124, PAN_GREEN),
    part("blumm-core", Point(BLC).buffer(11.5, 5), [0.62, 0.62, 0.62], "glass", {"floorH": 3.3, "pitch": 3.0, "glass": [0.20, 0.30, 0.38], "pier": 0.5, "mullion": [0.86, 0.87, 0.86]}, clip=True, order=2),
], lod2=[16312], footprint=whole(BL).buffer(1.5))

# the white fascia of the entrance hall with its name (photo Athénée_structure_provisoire): on the hall between the west and the north-west arm, facing the paved square
FREE.append({"k": "sign", "x": 3597.6, "z": 9682.6, "nx": -0.945, "nz": -0.326, "y": 3.3, "text": "ATHÉNÉE DE LUXEMBOURG", "cap": 0.42, "color": [0.12, 0.13, 0.14], "weight": 0.13,
             "board": {"color": [0.95, 0.95, 0.93], "pad": 0.45}})

# ====================================================================================================================
# ÉCOLE DE COMMERCE ET DE GESTION (OSM way 26737970, the hall 41424144): yellow panels between grey pebbled pilasters with red window
# frames, a row of sawtooth skylights in the roof, the lecture theatre as a glazed fan on the west side.
ECG = 26737970
ECG_FP = {"floorH": 3.3, "pitch": 3.6, "pilaster": [0.66, 0.66, 0.62], "panel": [0.94, 0.76, 0.14], "frame": [0.72, 0.12, 0.10], "glass": [0.30, 0.38, 0.46], "sill": 0.9, "h": 1.7, "pier": 0.4}
building("ecg", "École de Commerce et de Gestion", "N", [
    part("ecg-main", whole(ECG).buffer(1.0), [0.66, 0.66, 0.62], "ecg", ECG_FP, clip=True, rf={"sawtooth": [[3530, 9756, 8, 36, 90, 2.4]]},
         ft=[{"k": "canopy", "x": 3551.0, "z": 9738.7, "w": 8.0, "depth": 2.8, "y": 3.1, "t": 0.7, "color": [0.80, 0.10, 0.10], "post": [0.26, 0.26, 0.28],
              "sign": {"text": "ECG", "cap": 0.36, "color": [0.96, 0.94, 0.90], "weight": 0.13, "y": 0.0}},
             {"k": "logo", "x": 3520.0, "z": 9738.7, "w": 7.2, "h": 4.6, "y": 4.2}]),
    part("ecg-fan", P((3470, 9738), (3500, 9738), (3500, 9760), (3470, 9760)), [0.66, 0.66, 0.62], "glass", {"floorH": 3.3, "pitch": 3.0, "glass": [0.45, 0.58, 0.66]}, clip=True, dh=7.0, roof=[0.55, 0.65, 0.70]),
], lod2=[20060], footprint=whole(ECG).buffer(1.0))
building("ecg-hall", "ECG hall", "N", [
    part("ecg-hall", whole(41424144), [0.80, 0.80, 0.78], "ribbon", {"floorH": 3.0, "pitch": 4.0, "h": 1.0, "sill": 2.2, "glass": GLASS, "frame": CONCRETE}),
], lod2=[17558])

# ====================================================================================================================
# COMPLEXE SPORTIF LMAL (232278824) and the PISCINE (41424117): big grey halls, the pool with a skylight band; both in LOD2 block 22106
building("complexe", "Complexe sportif LMAL", "N", [
    part("complexe", whole(232278824), [0.64, 0.64, 0.62], "ribbon", {"floorH": 4.5, "pitch": 5.0, "h": 1.0, "sill": 3.0, "glass": [0.35, 0.40, 0.46], "frame": CONCRETE}),
], lod2=[])
building("piscine", "Piscine", "C", [
    part("piscine", whole(41424117), [0.62, 0.66, 0.70], "ribbon", {"floorH": 4.5, "pitch": 5.0, "h": 1.2, "sill": 3.2, "glass": [0.35, 0.42, 0.50], "frame": CONCRETE},
         rf={"sawtooth": [[3798, 9853, 76, 12, 0, 3.0]]}),
], lod2=[22106])

# ====================================================================================================================
# LYCÉE MICHEL RODANGE (OSM way 37764513): beige concrete, deep window bays with red frames and white / orange blinds,
# brown flat roofs with solar panels (LOD2 block 21934)
LM = 37764513
LM_FP = {"floorH": 3.2, "pitch": 2.6, "w": 1.5, "h": 1.7, "sill": 0.75, "frame": [0.64, 0.46, 0.22], "pane": [0.22, 0.32, 0.42], "blind": [0.93, 0.92, 0.88], "blindEdge": [0.82, 0.28, 0.20], "blindShare": 0.45, "pier": 0.5, "slab": [0.80, 0.74, 0.58], "sillColor": [0.80, 0.74, 0.58]}
def lm(key, rc, order, **kw):
    return part(key, rect(*rc), BEIGE, "punched", LM_FP, clip=True, order=order, **kw)
fp_lm = whole(LM).buffer(0.5)
building("lmrl", "Lycée Michel Rodange", "C", [
    part("lmrl-nw1", rect(3621, 9803, 21, 19), BEIGE, "punched", LM_FP, clip=True, order=1, rf={"solar": [[3621, 9803, 14, 12, 90]]}),
    part("lmrl-nw2", rect(3621, 9831, 22, 24), BEIGE, "punched", LM_FP, clip=True, order=1, rf={"solar": [[3621, 9829, 15, 16, 90]]}),
    part("lmrl-main", rect(3646, 9864, 86, 27), BEIGE, "punched", LM_FP, clip=True, order=1, rf={"solar": [[3642, 9860, 70, 12, 0]]}),
    part("lmrl-sw", rect(3621, 9912, 48, 46), BEIGE, "punched", LM_FP, clip=True, order=0),
    part("lmrl-se1", rect(3668.5, 9898, 21, 19), BEIGE, "punched", LM_FP, clip=True, order=1, rf={"solar": [[3668, 9898, 15, 16, 90]]}),
    part("lmrl-se2", rect(3670.5, 9925.5, 21, 18), BEIGE, "punched", LM_FP, clip=True, order=1, rf={"solar": [[3671, 9926, 14, 14, 90]]}),
    part("lmrl-rest", whole(LM), BEIGE, "punched", LM_FP, clip=False, order=-1),
], lod2=[21934], footprint=fp_lm)

# ====================================================================================================================
# the halls between the Athénée and the Lycée Michel Rodange: the Gymnasium (41424146) and the building 41424150
building("gymnasium", "Gymnasium", "C", [
    part("gymnasium", whole(41424146), [0.78, 0.78, 0.75], "ribbon", {"floorH": 4.0, "pitch": 5.0, "h": 1.0, "sill": 2.8, "glass": GLASS, "frame": CONCRETE}),
], lod2=[19913])
building("hall-150", "Hall 41424150", "C", [
    part("hall-150", whole(41424150), [0.60, 0.58, 0.54], "ribbon", {"floorH": 3.0, "pitch": 5.0, "h": 1.0, "sill": 1.8, "glass": GLASS_DARK, "frame": CONCRETE}),
], lod2=[20482])

# ====================================================================================================================
# LYCÉE ALINE MAYRISCH (OSM way 37764733): a long white block on a concrete plinth along the boulevard, ribbon windows, pilotis entrance
LA = 37764733
LAML_FP = {"floorH": 3.78, "inset": 0.25, "pitch": 3.0, "sill": 0.85, "h": 2.2, "pier": 2.0, "mull": 2.4, "surround": 0.25, "groups": [9, 12, 15, 18], "gapMin": 2.4, "gapMax": 4.6,
           "band": [0.66, 0.66, 0.64], "frame": [0.60, 0.62, 0.64], "glass": [0.42, 0.58, 0.78], "mullion": [0.92, 0.92, 0.90],
           "plinth": {"h": 5.0, "color": [0.70, 0.70, 0.68], "facing": "south", "holes": 5.5},
           "gf": {"h": 3.85, "lift": 3.9, "depth": 1.8, "facing": "north", "glass": [0.30, 0.40, 0.50], "pier": [0.84, 0.84, 0.80], "pitch": 4.5, "every": 2, "rail": [0.56, 0.60, 0.62]}}
building("laml", "Lycée Aline Mayrisch", "S", [
    part("laml", whole(LA), [0.97, 0.96, 0.92], "laml", LAML_FP,
         ft=[{"k": "recess", "x": 3725.0, "z": 9966.5, "w": 12.0, "h": 7.7, "lift": 3.9, "depth": 3.2, "glass": [0.30, 0.42, 0.54], "frame": [0.82, 0.84, 0.82], "doors": 6.0,
              "transoms": [2.5, 5.4], "cheek": [0.95, 0.95, 0.92], "soffit": [1.0, 1.0, 0.98],
              "sign": {"text": "Lycée Aline Mayrisch", "cap": 0.36, "y": 2.9, "color": [0.97, 0.97, 0.97], "weight": 0.14, "board": {"color": [0.10, 0.44, 0.72], "pad": 0.3}}},
             {"k": "panel", "x": 3792.0, "z": 9966.5, "w": 3.4, "y0": 7.8, "y1": 15.1, "color": [0.93, 0.62, 0.14]},
             {"k": "sign", "x": 3654.0, "z": 9985.0, "text": "Lycée Aline Mayrisch Luxembourg", "cap": 0.2, "y": 2.6, "color": [0.30, 0.32, 0.34], "weight": 0.14}]),
], lod2=[19798])
FREE.append({"k": "bridge", "x": 3725.0, "z0": 9952.5, "z1": 9966.5, "w": 6.0, "wall": [0.72, 0.72, 0.70]})

# FORUM (OSM way 29050032): the round hall with its solar petals (custom model campus-custom.js)
building("forum", "Forum Geesseknäppchen", "S", [
    part("forum", whole(29050032), [0.62, 0.66, 0.70], "glass", {"floorH": 4.0, "pitch": 3.0, "glass": GLASS_DARK}, roof=[0.62, 0.66, 0.70]),
], lod2=[19625], custom="forum")



# ====================================================================================================================
# WEST: the Conservatoire de la Ville de Luxembourg (OSM way 37826860: brick ring with an octagonal hall under a green roof) and the
# International School of Luxembourg (grey and cream panels with a red stair tower)
CO = 37826860
BRICK = [0.60, 0.37, 0.27]
CO_FP = {"floorH": 3.4, "pitch": 3.4, "w": 1.6, "h": 1.5, "sill": 0.9, "frame": [0.32, 0.30, 0.30], "pane": [0.22, 0.27, 0.32], "blind": [0.55, 0.50, 0.45], "blindShare": 0.2, "pier": 0.8, "sillColor": [0.55, 0.52, 0.48]}
building("conservatoire", "Conservatoire", "W", [
    part("cons-ring", whole(CO), BRICK, "punched", CO_FP, order=-1),
    part("cons-hall", Point(3380, 9783).buffer(17.5, 2), [0.72, 0.68, 0.60], "glass", {"floorH": 4.0, "pitch": 4.0, "glass": [0.28, 0.34, 0.38]}, order=2, clip=True,
         rf={"hip": {"rise": 4.0, "inset": 0.45, "color": [0.40, 0.52, 0.47]}}),
    part("cons-east", rect(3410, 9795, 24, 26), BRICK, "punched", CO_FP, order=1, clip=True),
], lod2=[15944], footprint=whole(CO).buffer(1.0))
# the long steel pergola on the west side of the Conservatoire (OSM building=roof 1010952448; photo Conservatoire_de_musique_entrée)
FREE.append({"k": "pergola", "x0": 3321.5, "z0": 9800.0, "x1": 3352.5, "z1": 9800.0, "w": 4.6, "h": 3.3, "color": [0.24, 0.26, 0.28]})

ISL_GREY = [0.44, 0.48, 0.53]
ISL_FP = {"floorH": 3.4, "pitch": 3.0, "w": 1.1, "sill": 0.9, "h": 1.6, "glass": [0.24, 0.30, 0.38], "windowEvery": 2, "pier": 0.6, "band": [0.80, 0.80, 0.78], "bandAt": 1.5, "bandH": 1.0, "joints": 3.0}
IL = 195220844
building("isl-lower", "International School of Luxembourg (Lower)", "W", [
    part("isl-lower-low", whole(IL), ISL_GREY, "bands", ISL_FP, order=-1, pct=50),
    part("isl-lower-tall", rect(3288, 9917, 84, 28), ISL_GREY, "bands", ISL_FP, order=1, clip=True),
    part("isl-lower-west", rect(3222, 9918, 52, 30), ISL_GREY, "bands", ISL_FP, order=0, clip=True, rf={"solar": [[3212, 9915, 36, 10, 24]]}),
], lod2=[19243], footprint=whole(IL).buffer(0.5))

building("isl-upper", "International School of Luxembourg (Upper)", "W", [
    part("isl-upper", whole(26481167), ISL_GREY, "bands", ISL_FP),
], lod2=[18817, 21604])
# the red concrete stair tower of the Lower School with its round windows (photo ISL 101): its middle is read off the orthophoto (a red roof at 3334, 9942)
building("isl-tower", "ISL stair tower", "W", [
    part("isl-tower", rect(3334.0, 9942.5, 8.0, 8.0), [0.78, 0.16, 0.10], "portholes", {"floorH": 3.4, "pitch": 4.0, "r": 1.0, "hole": [0.20, 0.26, 0.34], "white": [0.92, 0.92, 0.90], "pier": 0.0, "inset": 0.4, "rail": [0.30, 0.32, 0.34]}, top=None, dtop=2.0,
         ft=[{"k": "sign", "x": 3334.0, "z": 9947.0, "text": "WELCOME", "cap": 0.5, "y": 3.0, "color": [0.12, 0.30, 0.70], "weight": 0.15, "board": {"color": [0.97, 0.97, 0.97], "pad": 0.3}}]),
], lod2=[])
building("isl-admin", "ISL Administration", "W", [
    part("isl-admin", whole(151609630), [0.84, 0.82, 0.76], "ribbon", {"floorH": 3.4, "pitch": 3.0, "sill": 0.9, "h": 1.6, "glass": GLASS, "frame": CONCRETE}),
], lod2=[19393])
building("tent", "Hall 193599947", "W", [
    part("tent", whole(193599947), [0.92, 0.92, 0.90], "blank"),
], lod2=[18383])
building("skate", "Skate Park Hollerich", "S", [
    part("skate", whole(171231027), [0.60, 0.62, 0.66], "blank"),
], lod2=[])


# ====================================================================================================================
# THE NEIGHBOURS (zone E): the Quilvest bank west of the Conservatoire (OSM way 97672784) and the apartment blocks of the Rue de Merl east of the
# campus, which the LOD2 of the bake draws as plain blocks.  Their own styles: an office with a stone skin and ribbon glazing, render with balconies.
LOD2_BLOCKS = {b["id"]: b for b in json.load(open(os.path.join(REFS, "lod2_campus.json")))}


def lod2_poly(block_id):
    return Polygon(LOD2_BLOCKS[block_id]["pts"]).buffer(0)


QUILVEST = [(3313.4, 9753.3), (3331.2, 9741.9), (3327.6, 9736.3), (3333.1, 9732.8), (3326.5, 9723.5), (3325.9, 9722.7), (3324.0, 9723.5), (3321.6, 9716.0), (3327.5, 9712.9),
            (3319.6, 9690.6), (3311.2, 9696.5), (3289.8, 9711.2), (3285.9, 9713.8)]
building("quilvest", "Quilvest Banque Privée", "E", [
    part("quilvest", Polygon(QUILVEST), [0.80, 0.77, 0.70], "curtain", {"floorH": 3.7, "inset": 0.4, "pitch": 3.4, "spandrel": 1.2, "glass": [0.36, 0.48, 0.58], "dark": [0.30, 0.31, 0.32],
                                                                       "frameColor": [0.32, 0.33, 0.35]}),
], lod2=[15925, 21561])
APT_FP = {"floorH": 3.0, "inset": 0.3, "pitch": 3.2, "sill": 0.9, "h": 1.5, "w": 1.4, "glass": [0.34, 0.44, 0.56], "rail": [0.62, 0.72, 0.76], "slab": [0.82, 0.82, 0.80]}
for key, lod, wall in (("apt-a", 16796, [0.92, 0.90, 0.82]), ("apt-b", 20511, [0.90, 0.80, 0.62]), ("apt-c", 17891, [0.90, 0.88, 0.84]), ("apt-d", 18618, [0.80, 0.70, 0.60]),
                       ("apt-e", 20802, [0.88, 0.86, 0.80])):
    building(key, "Apartments (Rue de Merl)", "E", [part(key, lod2_poly(lod), wall, "balcony", APT_FP)], lod2=[lod])


# ====================================================================================================================
# THE GROUNDS: paved squares, car parks, sports grounds (flat coloured areas draped on the terrain), their painted lines, the bus
# shelters and the small furniture.  Polygons are traced on the orthophoto (SURVEY.md); the OSM ones are used where OSM has them.
PAVE = [0.40, 0.39, 0.38]
PAVE_LIGHT = [0.50, 0.49, 0.47]
ASPHALT = [0.22, 0.22, 0.24]
TURF = [0.10, 0.19, 0.14]
TRACK = [0.66, 0.31, 0.23]
COURT = [0.40, 0.58, 0.53]
LINE = [0.92, 0.92, 0.88]
FOREST_CENTER = (3873.0, 9966.0)            # the Forum


def circle(cx, cz, r, n=40, a0=0.0, a1=360.0):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cz + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def hatch(poly, deg, spacing, offset=0.0):
    """Parallel lines across a polygon at `deg` (0 = along x), every `spacing` m, clipped to it: [[(x, z), (x, z)], ...]."""
    from shapely.geometry import LineString, MultiLineString
    minx, minz, maxx, maxz = poly.bounds
    reach = math.hypot(maxx - minx, maxz - minz)
    cx, cz = (minx + maxx) / 2, (minz + maxz) / 2
    a = math.radians(deg)
    ux, uz, vx, vz = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
    out = []
    k = -reach
    while k < reach:
        line = LineString([(cx + vx * k - ux * reach, cz + vz * k - uz * reach), (cx + vx * k + ux * reach, cz + vz * k + uz * reach)])
        cut = line.intersection(poly)
        parts = list(cut.geoms) if isinstance(cut, MultiLineString) else [cut]
        for seg in parts:
            if seg.geom_type == "LineString" and seg.length > 1.0:
                out.append([tuple(c) for c in seg.coords])
        k += spacing
    return out


def box_outline(x0, z0, x1, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1), (x0, z0)]


def pitch_lines(x0, z0, x1, z1):
    """The markings of a football pitch lying along z (x0..x1 wide, z0..z1 long): outline, halfway line, circle, boxes, arcs."""
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    L = [box_outline(x0, z0, x1, z1), [(x0, cz), (x1, cz)], circle(cx, cz, 9.15)]
    for end, sgn in ((z0, 1), (z1, -1)):
        L.append([(cx - 20.2, end), (cx - 20.2, end + sgn * 16.5), (cx + 20.2, end + sgn * 16.5), (cx + 20.2, end)])
        L.append([(cx - 9.2, end), (cx - 9.2, end + sgn * 5.5), (cx + 9.2, end + sgn * 5.5), (cx + 9.2, end)])
        a0, a1 = (37.0, 143.0) if sgn > 0 else (217.0, 323.0)
        L.append(circle(cx, end + sgn * 11.0, 9.15, 16, a0, a1))
    return L


def mesh_area(poly, spacing):
    """A triangle mesh of a polygon (no holes): the boundary cut into pieces of at most `spacing`, a grid of inner points, Delaunay, and every
    triangle whose middle is inside kept.  The game drapes it on the ground, so the triangles must be small enough to follow the terrain
    but not many: about two per `spacing` x `spacing` m."""
    import shapely
    from shapely.geometry import MultiPoint
    edge = shapely.segmentize(poly.exterior, spacing)
    pts = [tuple(c) for c in list(edge.coords)[:-1]]
    minx, minz, maxx, maxz = poly.bounds
    inner = poly.buffer(-spacing * 0.45)
    x = minx + spacing / 2
    while x < maxx:
        z = minz + spacing / 2
        while z < maxz:
            if not inner.is_empty and inner.contains(Point(x, z)):
                pts.append((x, z))
            z += spacing
        x += spacing
    tris = []
    grown = poly.buffer(0.4)
    for t in shapely.delaunay_triangles(MultiPoint(pts)).geoms:
        c = t.centroid
        if poly.contains(c) and grown.contains(t):
            ids = [pts.index(tuple(co)) for co in list(t.exterior.coords)[:3]]
            tris.append(ids)
    return [[round(x, 1), round(z, 1)] for x, z in pts], tris


def bake_grounds(osm, ortho_color):
    from shapely.geometry import Polygon as Pg
    areas, lines, furniture, walls = [], [], [], []

    def area(key, poly, color, lift=0, spacing=8.5):
        poly = poly if isinstance(poly, Pg) else Pg(poly)
        poly = poly.buffer(0)
        geoms = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]
        for g in geoms:
            if g.area < 4:
                continue
            pts, tris = mesh_area(g.simplify(0.15), spacing)
            areas.append({"key": key, "pts": pts, "tris": tris, "c": color, "lift": lift})

    def line(pts, w=0.14, color=LINE, lift=1):
        lines.append({"pts": [[round(x, 1), round(z, 1)] for x, z in pts], "w": w, "c": color, "lift": lift})

    # -- the big schoolyard in front of the Lycée Aline Mayrisch (above the underground car park) ------------------------------
    plaza = Pg([(3687, 9906), (3702, 9906), (3702, 9898), (3722, 9898), (3722, 9909), (3860, 9909), (3868, 9925), (3866, 9950), (3838, 9955), (3690, 9955), (3687, 9930)])
    plaza = plaza.difference(Point(FOREST_CENTER).buffer(41))
    area("schoolyard", plaza, PAVE)
    for ln in ([(3721, 9918), (3733, 9918), (3733, 9929), (3721, 9929), (3721, 9918)], [(3745, 9928), (3745, 9940), (3757, 9940), (3757, 9928), (3745, 9928)]):
        line(ln, 0.1, [0.88, 0.88, 0.8])
    # -- the plaza of the Athénée (tiled concrete over the sports hall), its west courtyard, the paved square at the Blumm ----------
    ath_plaza = Pg([(3664, 9568), (3694, 9560), (3752, 9620), (3744, 9634), (3700, 9640)])
    area("athenee-plaza", ath_plaza, [0.66, 0.66, 0.65])
    for seg in hatch(ath_plaza, 58, 10.0) + hatch(ath_plaza, 148, 10.0):
        line(seg, 0.3, [0.76, 0.76, 0.75], 1)
    court = Pg([(3598, 9612), (3640, 9585), (3660, 9600), (3672, 9660), (3650, 9672), (3620, 9648), (3600, 9632)])
    area("athenee-court", court, [0.38, 0.38, 0.38])
    for seg in hatch(court, 20, 8.0) + hatch(court, 110, 9.0):
        line(seg, 0.4, [0.58, 0.58, 0.56], 1)
    # the grand staircase from the boulevard up to the plaza (the lighter diagonal band of the orthophoto), drawn as a strip with a step line every 1.3 m
    stairs = Pg([(3696, 9562), (3753, 9621), (3760, 9614), (3703, 9555)])
    area("athenee-steps", stairs, [0.62, 0.61, 0.58], lift=1)
    for seg in hatch(stairs, 47, 1.3):
        line(seg, 0.14, [0.78, 0.77, 0.74], 2)
    square = Pg([(3535, 9640), (3580, 9640), (3598, 9668), (3598, 9690), (3560, 9690), (3545, 9672), (3532, 9655)])
    area("blumm-square", square, PAVE_LIGHT)
    for seg in hatch(square, 0, 6.0) + hatch(square, 90, 7.0):
        line(seg, 0.22, [0.92, 0.92, 0.90], 1)
    # -- car parks ---------------------------------------------------------------------------------------------------------
    ne = Pg(osm[25329453]["pts"][:-1])
    area("car-park-ne", ne, ASPHALT)
    for seg in hatch(ne, 62, 2.6):
        line(seg, 0.1, LINE, 1)
    for way in (1011039832, 1011039831):
        cp = Pg(osm[way]["pts"][:-1]).buffer(0)
        area("car-park-laml", cp, ASPHALT)
        for seg in hatch(cp, 8 if way == 1011039832 else 22, 2.6):
            line(seg, 0.1, LINE, 1)
    # -- sports grounds ----------------------------------------------------------------------------------------------------
    pitch = Pg(osm[31693578]["pts"][:-1])
    area("football", pitch, TURF)
    for ln in pitch_lines(3458, 9796, 3508, 9886):
        line(ln, 0.12)
    for ln in (box_outline(3436, 9842, 3453, 9884), [(3436, 9863), (3453, 9863)], box_outline(3436, 9852, 3441, 9874), box_outline(3448, 9852, 3453, 9874)):
        line(ln, 0.1)
    infield = Pg(osm[391241266]["pts"][:-1])
    area("track", infield.buffer(7.5).difference(infield), TRACK)
    for k in (1.25, 2.5, 3.75, 5.0, 6.25):
        ring = infield.buffer(k).exterior
        line(list(ring.coords), 0.08, [0.90, 0.86, 0.80], 1)
    area("track-court", Pg([(3752, 9692), (3806, 9692), (3806, 9738), (3752, 9738)]).intersection(infield), COURT, lift=1)
    area("track-sand", Pg([(3768, 9700), (3790, 9700), (3790, 9710), (3768, 9710)]).intersection(infield), [0.78, 0.66, 0.50], lift=2)
    bb = Pg(osm[1125855948]["pts"][:-1])
    area("basketball", bb, [0.50, 0.55, 0.62])
    line(box_outline(3683.6, 9877.0, 3701.0, 9892.6), 0.1, [0.95, 0.95, 0.9])
    # -- the stone wall and the hedge in front of the Athénée ---------------------------------------------------------------
    walls.append({"pts": [(3694, 9558), (3706, 9572), (3730, 9602), (3752, 9622)], "h": 1.1, "w": 0.7, "c": [0.58, 0.54, 0.44], "hedge": [0.34, 0.48, 0.24]})
    # -- the bus stops of the campus: a shelter where OSM says shelter=yes, otherwise a pole with the sign ---------------------------
    stops = [(n, osm[n]) for n in osm if osm[n]["type"] == "node" and osm[n]["tags"].get("public_transport") == "platform"]
    positions = [(osm[n]["pts"][0], osm[n]["tags"].get("name")) for n in osm if osm[n]["type"] == "node" and osm[n]["tags"].get("public_transport") == "stop_position"]
    for n, st in stops:
        x, z = st["pts"][0]
        if not (3150 < x < 4000 and 9450 < z < 10060):
            continue
        same = [p for p, nm in positions if nm == st["tags"].get("name")]
        if not same:
            continue
        sx, sz = min(same, key=lambda p: (p[0] - x) ** 2 + (p[1] - z) ** 2)
        yaw = math.atan2(sz - z, sx - x)
        furniture.append({"k": "shelter" if st["tags"].get("shelter") == "yes" else "pole", "x": round(x, 1), "z": round(z, 1), "yaw": round(yaw, 3), "bench": st["tags"].get("bench") == "yes"})
    for n in osm:
        o = osm[n]
        if o["type"] == "node" and o["tags"].get("amenity") == "bicycle_parking":
            x, z = o["pts"][0]
            if 3150 < x < 4000 and 9450 < z < 10060:
                furniture.append({"k": "rack", "x": round(x, 1), "z": round(z, 1), "yaw": 0.0})
    furniture.extend(bake_furniture(osm))
    return {"areas": areas, "lines": lines, "furniture": furniture, "walls": walls}


BENCH_GREEN = [0.20, 0.38, 0.28]
BENCH_BROWN = [0.50, 0.36, 0.22]
BENCH_GREY = [0.56, 0.57, 0.58]
SEAT_COLORS = [[0.20, 0.62, 0.32], [0.80, 0.18, 0.16], [0.16, 0.34, 0.78], [0.95, 0.78, 0.15]]    # the zig-zag seats of the Forum square (photo Forum_Geesseknäppchen_101)
FURNITURE_BOX = (3150.0, 9450.0, 4120.0, 10062.0)                                                  # the campus and the edge of the Parc de Merl


def path_directions():
    """The segments of the footpaths of the game's own network (roads_campus.json) as [(x0, z0, x1, z1), ...]: a bench stands along the path it is beside."""
    out = []
    for r in json.load(open(os.path.join(REFS, "roads_campus.json"))):
        if r["kind"] in ("footway", "path", "pedestrian", "cycleway"):
            pts = r["pts"]
            out.extend((pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) for i in range(len(pts) - 1))
    return out


def along_nearest(segs, x, z):
    """The direction (radians, atan2(dz, dx)) of the nearest path segment to (x, z); 0 when there is none within 25 m."""
    best, ang = 25.0, 0.0
    for x0, z0, x1, z1 in segs:
        dx, dz = x1 - x0, z1 - z0
        ll = dx * dx + dz * dz
        t = 0.0 if ll < 1e-9 else max(0.0, min(1.0, ((x - x0) * dx + (z - z0) * dz) / ll))
        d = math.hypot(x - (x0 + dx * t), z - (z0 + dz * t))
        if d < best:
            best, ang = d, math.atan2(dz, dx)
    return ang


def bake_furniture(osm):
    """Benches, picnic tables, bins and the playgrounds of OSM inside the campus and the park edge; the coloured seats and the bollards of the Forum square."""
    segs = path_directions()
    x0, z0, x1, z1 = FURNITURE_BOX
    out = []
    for o in osm.values():
        if o["type"] != "node":
            continue
        x, z = o["pts"][0]
        if not (x0 < x < x1 and z0 < z < z1):
            continue
        t = o["tags"]
        if t.get("amenity") == "bench":
            color = BENCH_GREEN if t.get("colour") == "green" else BENCH_BROWN if t.get("colour") == "brown" else BENCH_GREY
            out.append({"k": "bench", "x": round(x, 1), "z": round(z, 1), "yaw": round(along_nearest(segs, x, z), 3), "color": color})
        elif t.get("leisure") == "picnic_table":
            out.append({"k": "table", "x": round(x, 1), "z": round(z, 1), "yaw": round(along_nearest(segs, x, z), 3)})
        elif t.get("amenity") == "waste_basket":
            out.append({"k": "bin", "x": round(x, 1), "z": round(z, 1)})
        elif t.get("leisure") == "playground":
            out.append({"k": "playground", "bounds": [round(x - 9, 1), round(z - 6, 1), round(x + 9, 1), round(z + 6, 1)]})
    for o in osm.values():                                        # the playgrounds of the park are mapped as areas
        if o["type"] == "way" and o["tags"].get("leisure") == "playground":
            xs, zs = [p[0] for p in o["pts"]], [p[1] for p in o["pts"]]
            if x0 < sum(xs) / len(xs) < x1:
                out.append({"k": "playground", "bounds": [round(min(xs), 1), round(min(zs), 1), round(max(xs), 1), round(max(zs), 1)]})
    # the seats in front of the Forum: groups of three slabs on the schoolyard side, in the four colours of the photo (positions read off the orthophoto, approximate)
    fx, fz = FOREST_CENTER
    for i, ang in enumerate([196, 204, 212, 221, 229, 238]):
        a = math.radians(ang)
        r = 44.0 + (3.0 if i % 2 else 0.0)
        out.append({"k": "seat", "x": round(fx + math.cos(a) * r, 1), "z": round(fz + math.sin(a) * r, 1), "yaw": round(a + math.pi / 2, 3), "color": SEAT_COLORS[i % 4]})
    for i in range(14):                                           # the concrete cubes along the edge of the plaza
        a = math.radians(184 + i * 5.5)
        out.append({"k": "bollard", "x": round(fx + math.cos(a) * 41.5, 1), "z": round(fz + math.sin(a) * 41.5, 1)})
    return out
