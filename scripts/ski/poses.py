#!/usr/bin/env python3
"""The look-check cameras of every resort, by lon / lat, as pose strings for shot.mjs --poses:

    python3 scripts/ski/poses.py <rid> [name,name,...]   ->  name:x,z,above,tx,tz,above2,fov;...
    node scripts/ski/shot.mjs OUT --url "/pb/ski.html?resort=<rid>&auto=1&bot=1&debug=1&q=high&weather=sun&time=midday" \
        --poses "$(python3 scripts/ski/poses.py <rid>)"

`above` = camera metres above the ground, `above2` = the target's metres above its ground (negative: look below a summit).
The same names are used for the photo comparisons (round 3: $SKI_WORK/round3).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Frame  # noqa: E402

# name: (cam lon, lat, above, target lon, lat, above2, fov)
POSES = {
    "killy": {
        "face": (6.9810, 45.4470, 45, 6.9640, 45.4530, 150, 55),             # Face de Bellevarde from the village
        "faceup": (6.9925, 45.4440, 250, 6.9640, 45.4545, 100, 50),
        "chevril": (6.9380, 45.4890, 4, 6.9530, 45.4740, 30, 60),           # on the frozen Lac du Chevril, looking up the lake
        "dam": (6.9400, 45.4890, 50, 6.9315, 45.4950, -30, 55),            # the dam from the lake side
        "giant": (6.9318, 45.5000, 80, 6.9312, 45.4950, 40, 50),            # the painted giant on the downstream face
        "tignes": (6.9290, 45.4720, 300, 6.9200, 45.4560, 0, 60),
    },
    "3vallees": {
        "vt": (6.5820, 45.3010, 20, 6.5640, 45.2860, 150, 55),              # Val Thorens and its rock bands
        "vt2": (6.5900, 45.3080, 60, 6.5700, 45.2820, 200, 60),
    },
    "zermatt": {
        "riffelberg": (7.7543, 45.9930, 20, 7.6586, 45.9763, -200, 40),     # the Matterhorn from Riffelberg
        "zermatt": (7.7480, 46.0215, 60, 7.6586, 45.9763, -500, 35),
        "kleinmh": (7.7262, 45.9408, 60, 7.72950, 45.93927, 10, 50),          # Klein Matterhorn summit station
        "kleinmh2": (7.7340, 45.9420, 40, 7.72989, 45.93836, 0, 45),
    },
    "arlberg": {
        "valluga": (10.2290, 47.1440, 20, 10.2133, 47.1577, 0, 45),         # Valluga summit + station
        "valluga2": (10.21460, 47.15640, 15, 10.21301, 47.15759, 5, 50),
        "galzig": (10.2330, 47.1290, 25, 10.23089, 47.13082, 10, 55),      # Galzig top station
        "galzig2": (10.2370, 47.1335, 30, 10.23089, 47.13082, 10, 50),
    },
    "kronplatz": {
        "summit": (11.96128, 46.73693, 30, 11.95852, 46.73907, 8, 55),          # the summit plateau, the bell, the MMM
        "mmm": (11.95331, 46.73657, 8, 11.95441, 46.73730, 4, 55),
        "plateau": (11.96054, 46.74010, 3, 11.95827, 46.73876, 10, 55),
        "far": (11.9900, 46.7300, 120, 11.9575, 46.7390, 0, 40),
        "bell": (11.95937, 46.73779, 3, 11.95827, 46.73876, 12, 55),           # the Concordia bell from the plateau, the summit buildings behind
    },
}


def main():
    rid = sys.argv[1]
    names = sys.argv[2].split(",") if len(sys.argv) > 2 and sys.argv[2] else list(POSES[rid])
    frame = Frame(rid)
    out = []
    for n in names:
        lon, lat, above, tlon, tlat, above2, fov = POSES[rid][n]
        x, z = frame.to_world(lon, lat)
        tx, tz = frame.to_world(tlon, tlat)
        out.append("%s:%.0f,%.0f,%g,%.0f,%.0f,%g,%g" % (n, x, z, above, tx, tz, above2, fov))
    print(";".join(out))


if __name__ == "__main__":
    main()
