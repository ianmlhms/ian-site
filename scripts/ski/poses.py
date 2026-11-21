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
        "face": (6.9800, 45.4475, 4, 6.9640, 45.4530, 150, 55),             # Face de Bellevarde from the village
        "faceup": (6.9925, 45.4440, 250, 6.9640, 45.4545, 100, 50),
        "chevril": (6.9180, 45.5130, 30, 6.9360, 45.5020, 0, 60),           # Lac du Chevril from Les Brévières side
        "dam": (6.9475, 45.5085, 25, 6.9349, 45.5036, 0, 55),
        "tignes": (6.9290, 45.4720, 300, 6.9200, 45.4560, 0, 60),
    },
    "3vallees": {
        "vt": (6.5820, 45.3010, 20, 6.5640, 45.2860, 150, 55),              # Val Thorens and its rock bands
        "vt2": (6.5900, 45.3080, 60, 6.5700, 45.2820, 200, 60),
    },
    "zermatt": {
        "riffelberg": (7.7543, 45.9930, 20, 7.6586, 45.9763, -200, 40),     # the Matterhorn from Riffelberg
        "zermatt": (7.7480, 46.0215, 20, 7.6586, 45.9763, -500, 35),
        "kleinmh": (7.7215, 45.9500, 40, 7.7295, 45.9385, 0, 50),           # Klein Matterhorn summit station
        "kleinmh2": (7.7350, 45.9520, 30, 7.7298, 45.9382, -10, 45),
    },
    "arlberg": {
        "valluga": (10.2290, 47.1440, 20, 10.2133, 47.1577, 0, 45),         # Valluga summit + station
        "valluga2": (10.2180, 47.1530, 20, 10.2133, 47.1577, 0, 50),
        "galzig": (10.2260, 47.1300, 15, 10.23089, 47.13082, 10, 55),       # Galzig top station
        "galzig2": (10.2370, 47.1335, 30, 10.23089, 47.13082, 10, 50),
    },
    "kronplatz": {
        "summit": (11.9625, 46.7365, 4, 11.9575, 46.7392, 5, 60),           # the summit plateau, the bell, the MMM
        "mmm": (11.9520, 46.7360, 6, 11.9544, 46.7373, 5, 55),
        "plateau": (11.9660, 46.7420, 3, 11.9580, 46.7385, 8, 60),
        "far": (11.9900, 46.7300, 120, 11.9575, 46.7390, 0, 40),
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
