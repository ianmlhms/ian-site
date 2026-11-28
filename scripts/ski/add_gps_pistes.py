#!/usr/bin/env python3
"""Adds two Via Lattea ski routes the owner really skied but the official map does not print (28 Nov 2026), from his GPS tracks.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/add_gps_pistes.py [--dry]

Owner's decision: the game has them as ski routes / links (flag `route` / `link`), not as official numbered pistes. Surgical like add_lift.py:
only resort.json changes (`pistes` + `network` get new rows, every other byte stays); ids are new, so the piste index (append-only), goals
data and the ski_board_floors rows (additive INSERT, scripts/ski-vialattea-routes-v1.sql) get one more entry each. Idempotent.

  verbindung-pariol-cesana  Pariol -> Cesana (1548 -> 1360 m) under the Cesana - Ski Lodge gondola, skied 31 Dec 2025 ~10:43-10:48 (UTC+1):
                            starts at the end of "71 bassa" (a short link to where his track passes the Pariol station), then his line down to
                            the bottom station of the gondola 1 (Cesana).
  34-vecchia                The 34 along his real line (3 Jan 2026 13:53-14:00 from the Cote Faure top; 30 Dec and the other 3 Jan run
                            agree): the game's 34 down to where he left it (18110, 4245), his dogleg south along x ~ 18070 and west
                            along z ~ 4800, and the game's 34 again from where he rejoined it to its end on the 41. Only the dogleg is
                            painted as a new network way (the shared parts are the 34's own)."""
import datetime as dt
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bake import Dem, Frame, apply_drawdown, dp_simplify, flat, load_mosaic, load_osm, polyline_len, resample, smooth_line  # noqa: E402
from common import RESORTS  # noqa: E402
from linepack import pack_line, unpack_line  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
RID = "vialattea"
TRACKS = os.path.expanduser("~/Library/Caches/ski-work/ian-tracks/")
UTC1 = 3600


def load_track(name, t0, t1):
    """world-frame points (x, z) of the track between two local clock times (UTC+1) HH:MM:SS, stationary duplicates dropped"""
    frame = Frame(RID)
    out = []
    for row in open(TRACKS + name):
        t, la, lo, _al = row.strip().split(",")
        clock = dt.datetime.fromtimestamp(int(t) + UTC1, dt.timezone.utc).strftime("%H:%M:%S")
        if t0 <= clock <= t1:
            x, z = frame.to_world(float(lo), float(la))
            if not out or math.hypot(x - out[-1][0], z - out[-1][1]) > 1.0:
                out.append((x, z))
    return np.array(out)


def clean(p, passes=3):
    """resampled to 10 m and smoothed (GPS jitter), end points kept"""
    p = resample(p, 10.0)
    for _ in range(passes):
        p = smooth_line(p, 2)
    return p


def nearest_index(line, q):
    return int(np.argmin(np.hypot(line[:, 0] - q[0], line[:, 1] - q[1])))


def main():
    dry = "--dry" in sys.argv
    cfg = RESORTS[RID]
    frame = Frame(RID)
    frame.rid = RID
    raw = load_mosaic(RID, frame)
    raw, _, _ = apply_drawdown(frame, cfg, raw, load_osm(RID, "areas"))
    dem = Dem(raw)
    path = os.path.join(REPO, "pb", "ski", "data", RID, "resort.json")
    r = json.load(open(path, encoding="utf-8"))
    by_id = {p["id"]: p for p in r["pistes"]}
    line_of = lambda i: np.array(unpack_line(by_id[i]["lz"])).reshape(-1, 2)
    new_pistes, new_net = [], []

    def make(pid, name, diff, hw, pts, flags):
        pts = np.array(pts)
        h = dem(pts[:, 0], pts[:, 1])
        row = {"id": pid, "name": name, "ref": "", "diff": diff, "len": round(polyline_len(pts)), "drop": round(float(h[0] - h[-1])),
               "top": round(float(h[0])), "bottom": round(float(h[-1])), "hw": hw, "slalom": False, "lz": pack_line(flat(pts))}
        for f in flags:
            row[f] = True
        return row, h

    # --- a: Pariol -> Cesana
    track = load_track("vl-17988120093.csv", "10:43:29", "10:47:58")
    m71 = line_of("71-bassa")[-1]
    gondola1 = r["lifts"][38]["bottom"]
    assert r["lifts"][38]["name"] == "Cesana-Ski Lodge 1", r["lifts"][38]["name"]
    core = clean(np.vstack([track, [gondola1["x"], gondola1["z"]]]))
    link = np.linspace(m71, core[0], max(2, int(math.hypot(*(core[0] - m71)) / 10) + 1))[:-1]
    a = np.vstack([link, core])
    a = smooth_line(a, 1)
    row_a, h_a = make("verbindung-pariol-cesana", "Verbindung Pariol → Cesana", "blue", 12.6, a, ("link", "route"))
    new_pistes.append(row_a)
    new_net.append({"d": "b", "w": 12.6, "r": 1, "pz": pack_line(flat(dp_simplify(a, 1.5)))})

    # --- b: 34 vecchia
    base = line_of("34")
    gps = clean(load_track("vl-18017394911.csv", "13:53:37", "14:00:25"))
    # where his line leaves the game's 34 (first point > 12 m away, after the top) and where it comes back (last point > 12 m away)
    d34 = np.array([np.min(np.hypot(base[:, 0] - x, base[:, 1] - z)) for x, z in gps])
    off = np.nonzero(d34 > 12.0)[0]
    i_out, i_back = int(off[0]) - 1, int(off[-1]) + 1
    k_out, k_back = nearest_index(base, gps[i_out]), nearest_index(base, gps[i_back])
    dogleg = gps[i_out:i_back + 1]
    b = np.vstack([base[:k_out + 1], dogleg, base[k_back:]])
    print("34 vecchia: leaves the 34 at index %d (%.0f, %.0f), back at %d (%.0f, %.0f), dogleg %d m" % (
        k_out, *base[k_out], k_back, *base[k_back], polyline_len(dogleg)))
    row_b, h_b = make("34-vecchia", "34 vecchia", "red", 10.5, b, ("route",))
    new_pistes.append(row_b)
    new_net.append({"d": "r", "w": 10.5, "r": 1, "pz": pack_line(flat(dp_simplify(dogleg, 1.5)))})

    for row, h in ((row_a, h_a), (row_b, h_b)):
        if os.environ.get("PROFILE"):
            print([int(v) for v in h[::3]])
        print("%-26s %-28s %s %4d m, %3d m drop (%d -> %d), %d pts, max uphill step %.1f m, mean slope %.0f %%" % (
            row["id"], row["name"], row["diff"], row["len"], row["drop"], row["top"], row["bottom"], len(unpack_line(row["lz"])) // 2,
            float(np.max(np.diff(h))), 100.0 * row["drop"] / row["len"]))
    if dry:
        return
    assert not any(p["id"] in by_id for p in new_pistes), "already added"
    r["pistes"] = r["pistes"] + new_pistes
    r["network"] = r["network"] + new_net
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(r, separators=(",", ":"), ensure_ascii=False))
    print("resort.json: pistes %d, network %d" % (len(r["pistes"]), len(r["network"])))


if __name__ == "__main__":
    main()
