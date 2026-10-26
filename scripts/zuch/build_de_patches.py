#!/usr/bin/env python3
"""Build the station patches of the German stops of the RB 83 (Rheinland-Pfalz) with `build_station_patch.py --country de`.

    /Users/Ian/Library/Caches/luxtram-work/.venv/bin/python scripts/zuch/build_de_patches.py [key ...] [--png-dir DIR] [--stage 1|2]

Stage 1 = the 14 stops of the Weststrecke / Mosel line, stage 2 = Kreuz Konz, Trier Sued, Trier Hbf.  Station node coordinates are the OSM
railway=station|halt nodes of rlp.osm.pbf (Geofabrik, 25 Oct 2026); heading hints = bearing of the line between the neighbouring stops
in the direction of the service (Luxembourg -> Trier -> Wittlich).  Key = ascii game name, name = the game's station name (index.json).
"""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# key, game name, lat, lon, heading hint (compass deg), stage
STATIONS = [
    ("igel", "Igel", 49.70753, 6.55012, 82, 1),
    ("trier-zewen", "Tréier-Zewen", 49.72004, 6.58097, 53, 1),
    ("trier-euren", "Tréier-Euren", 49.73807, 6.61227, 41, 1),
    ("trier-west", "Tréier West", 49.75140, 6.62359, 24, 1),
    ("trier-pallien", "Tréier-Pallien", 49.76391, 6.62986, 43, 1),
    ("trier-hafenstrasse", "Tréier Hafestrooss", 49.79181, 6.68261, 40, 1),
    ("ehrang-ort", "Ehrang Ort", 49.80935, 6.68829, 23, 1),
    ("quint", "Quint", 49.82590, 6.70457, 57, 1),
    ("schweich", "Schweich", 49.83118, 6.74064, 52, 1),
    ("foehren", "Föhren", 49.85726, 6.76763, 38, 1),
    ("hetzerath", "Hetzerath", 49.87805, 6.79833, 36, 1),
    ("sehlem", "Sehlem", 49.90742, 6.82344, 31, 1),
    ("salmtal", "Salmtal", 49.92179, 6.83955, 50, 1),
    ("wittlich", "Wittlich", 49.97299, 6.94355, 53, 1),
    ("kreuz-konz", "Kreuz Konz", 49.70385, 6.57659, 100, 2),
    ("trier-sued", "Tréier Süd", 49.74441, 6.63647, 40, 2),
    ("trier-hbf", "Tréier Hbf", 49.75697, 6.65200, 40, 2),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("keys", nargs="*")
    ap.add_argument("--png-dir", default=None)
    ap.add_argument("--stage", type=int, default=0)
    ap.add_argument("--out-dir", default=None)
    a = ap.parse_args()
    todo = [s for s in STATIONS if (not a.keys or s[0] in a.keys) and (not a.stage or s[5] == a.stage)]
    for key, name, lat, lon, hint, _ in todo:
        cmd = [sys.executable, "-W", "ignore", os.path.join(HERE, "build_station_patch.py"), key, "--name", name, "--lat", str(lat), "--lon", str(lon),
               "--heading-hint", str(hint), "--country", "de"]
        if a.png_dir:
            os.makedirs(a.png_dir, exist_ok=True)
            cmd += ["--debug-png", os.path.join(a.png_dir, key + ".png")]
        if a.out_dir:
            cmd += ["--out", os.path.join(a.out_dir, key + ".json")]
        print("==", key, flush=True)
        subprocess.run(cmd, check=False)


if __name__ == "__main__":
    main()
