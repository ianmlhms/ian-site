#!/usr/bin/env python3
"""W4: builds the station patches of the stations abroad (France / Belgium) with `build_station_patch.py --country fr|be` from the layout files of the routes
(pb/train-sim/data/real/<route>-layout.json: lat / lon / heading / declared platform side of the stop on the route's own main track).

The patch frame is the curvilinear one of the Luxembourg patches (straightened real track, real rails, platforms, OSM footprints extruded, painted ground classes), with the
main track chosen as the railway nearest to the layout's lat / lon (the route's own track, `--main-near-node`).  Relief: Copernicus GLO-30 (30 m, open), OSM: the Geofabrik extracts in
$ZUCH_WORK/abroad.  A station that two routes serve on different tracks (Thionville, Metz-Ville: the metz and the paris route) gets one patch per route; the second one is registered in
index-routes.json under "<route>/<Station>" (station-surround.js picks it for that route).

    $PY scripts/zuch/build_abroad_patches.py [--only Name,Name] [--png-dir DIR]
"""
import argparse
import json
import os
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
REAL = os.path.join(REPO, "pb", "train-sim", "data", "real")
OUT = os.path.join(REPO, "pb", "train-sim", "data", "stations")
INDEX = os.path.join(OUT, "index-routes.json")
# route, station name (as in the layout), Geofabrik extract, country
STATIONS = (
    ("metz", "Thionville", "lorraine", "fr"), ("metz", "Metz-Ville", "lorraine", "fr"), ("metz", "Pont-à-Mousson", "lorraine", "fr"), ("metz", "Nancy-Ville", "lorraine", "fr"),
    ("brussels", "Arlon", "belgium", "be"), ("brussels", "Libramont", "belgium", "be"), ("brussels", "Namur", "belgium", "be"), ("brussels", "Bruxelles-Midi", "belgium", "be"),
    ("paris", "Thionville", "lorraine", "fr"), ("paris", "Metz-Ville", "lorraine", "fr"), ("paris", "Champagne-Ardenne TGV", "champagne-ardenne", "fr"),
    ("paris", "Paris-Est", "ile-de-france", "fr"),
)
SHARED = {"paris": {"Thionville", "Metz-Ville"}}      # stations of this route that also exist on an earlier route of STATIONS but on another track: own patch


def key_of(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return "".join(c if c.isalnum() else "-" for c in s).strip("-")


def index_name(route, name):
    return "%s/%s" % (route, name) if name in SHARED.get(route, ()) else name


def patch_key(route, name):
    return key_of(name) + ("-" + route if name in SHARED.get(route, ()) else "")


def load_layout(route):
    with open(os.path.join(REAL, "%s-layout.json" % route), encoding="utf-8") as fh:
        return json.load(fh)["stations"]


def build_one(route, name, pbf, country, png_dir):
    st = load_layout(route)[name]
    key = patch_key(route, name)
    cmd = [sys.executable, "-W", "ignore", os.path.join(HERE, "build_station_patch.py"), key, "--name", index_name(route, name), "--lat", str(st["lat"]), "--lon", str(st["lon"]),
           "--heading-hint", str(st["heading"]), "--country", country, "--pbf", pbf, "--side", st["side"], "--main-near-node", "--index", "index-routes.json"]
    if png_dir:
        os.makedirs(png_dir, exist_ok=True)
        cmd += ["--debug-png", os.path.join(png_dir, key + ".png")]
    print("build", route, name, "->", key, flush=True)
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print("FAILED", name, (res.stderr or res.stdout)[-1200:], flush=True)
        return None
    print((res.stdout.strip().splitlines() or [""])[-1][:300], flush=True)
    return key


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--png-dir", default=None)
    args = ap.parse_args()
    only = {n for n in args.only.split(",") if n}
    done = [k for k in (build_one(r, n, p, c, args.png_dir) for r, n, p, c in STATIONS if not only or n in only or key_of(n) in only) if k]
    if done:
        subprocess.run([sys.executable, os.path.join(HERE, "split_station_patches.py")] + done, check=False)
    print("built", done)


if __name__ == "__main__":
    main()
