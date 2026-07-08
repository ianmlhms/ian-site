#!/usr/bin/env python3
"""Rebuild the two static transit indexes bus.html ships with, from the official
Luxembourg GTFS on data.public.lu.

  moien-stops.json : [[stopId, "City, Stop", lat, lon], ...]  (all ~2800 stops,
                     sorted by name; stopId is the national id with leading zeros
                     stripped — bus.html re-pads to 12 digits via motisStopId()).
  moien-lines.json : { "<line>": [ {h:headsign, o:originStopId(12-digit),
                     s:[stop names]}, ... ] }  — one entry per direction, rail
                     excluded (trains carry no line number in this feed). Each
                     direction is represented by its LONGEST trip.

Usage:
    python scripts/build-transit-index.py            # auto-fetch latest GTFS
    python scripts/build-transit-index.py <gtfs.zip> # use a local zip

Run it whenever data.public.lu publishes a newer GTFS (roughly weekly). The
output is deterministic: if the source release is unchanged, the files are
byte-identical, so a no-op commit means you were already current.
"""
from __future__ import annotations

import csv
import io
import json
import os
import sys
import urllib.request
import zipfile

DATASET = "horaires-et-arrets-des-transport-publics-gtfs"
API = f"https://data.public.lu/api/1/datasets/{DATASET}/"
OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root
csv.field_size_limit(10 ** 7)


def latest_gtfs_url() -> str:
    with urllib.request.urlopen(API, timeout=60) as r:
        meta = json.load(r)
    zips = [x for x in meta.get("resources", []) if (x.get("url") or "").endswith(".zip")]
    zips.sort(key=lambda x: x.get("last_modified") or "", reverse=True)
    if not zips:
        raise SystemExit("No GTFS zip found in the dataset resources.")
    print("Latest GTFS:", zips[0].get("title"), "-", zips[0]["url"])
    return zips[0]["url"]


def load_zip(src: str) -> zipfile.ZipFile:
    if os.path.exists(src):
        return zipfile.ZipFile(src)
    print("Downloading", src)
    with urllib.request.urlopen(src, timeout=300) as r:
        data = r.read()
    print(f"  {len(data):,} bytes")
    return zipfile.ZipFile(io.BytesIO(data))


def rows(zf: zipfile.ZipFile, name: str):
    with zf.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"))


def build_stops(zf: zipfile.ZipFile) -> list:
    stops = [[str(int(r["stop_id"])), r["stop_name"],
              round(float(r["stop_lat"]), 5), round(float(r["stop_lon"]), 5)]
             for r in rows(zf, "stops.txt")]
    stops.sort(key=lambda x: (x[1], x[0]))
    return stops


def build_lines(zf: zipfile.ZipFile) -> dict:
    # route_id -> short_name, excluding rail (route_type 2)
    routes = {r["route_id"]: r["route_short_name"]
              for r in rows(zf, "routes.txt") if r["route_type"] != "2"}

    # trip_id -> (line, direction_id, headsign) for kept routes only
    trip_meta = {}
    for r in rows(zf, "trips.txt"):
        line = routes.get(r["route_id"])
        if line:
            trip_meta[r["trip_id"]] = (line, r.get("direction_id", ""), r.get("trip_headsign", ""))

    # ordered stop_ids per kept trip (streamed — stop_times.txt is ~32 MB)
    trip_stops: dict[str, list] = {}
    with zf.open("stop_times.txt") as f:
        rd = csv.reader(io.TextIOWrapper(f, encoding="utf-8"))
        header = next(rd)
        ti, si, qi = (header.index(c) for c in ("trip_id", "stop_id", "stop_sequence"))
        for row in rd:
            tid = row[ti]
            if tid in trip_meta:
                trip_stops.setdefault(tid, []).append((int(row[qi]), row[si]))

    # longest representative trip per (line, direction)
    best: dict[tuple, tuple] = {}
    for tid, (line, d, _hs) in trip_meta.items():
        seq = trip_stops.get(tid)
        if not seq:
            continue
        key = (line, d)
        if key not in best or len(seq) > best[key][0]:
            best[key] = (len(seq), tid)

    stopname = {r["stop_id"]: r["stop_name"] for r in rows(zf, "stops.txt")}

    lines: dict[str, list] = {}
    for (line, _d), (_n, tid) in best.items():
        _, _, hs = trip_meta[tid]
        seq = sorted(trip_stops[tid])
        lines.setdefault(line, []).append({
            "h": hs,
            "o": seq[0][1],
            "s": [stopname.get(sid, "") for _, sid in seq],
        })
    for line in lines:
        lines[line].sort(key=lambda x: x["h"])
    return lines


def write(name: str, obj) -> None:
    path = os.path.join(OUT_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {name}: {os.path.getsize(path):,} bytes")


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else latest_gtfs_url()
    zf = load_zip(src)
    stops = build_stops(zf)
    lines = build_lines(zf)
    write("moien-stops.json", stops)
    write("moien-lines.json", lines)
    print(f"done: {len(stops)} stops, {len(lines)} lines "
          f"(rail excluded). Commit only if git shows a diff.")


if __name__ == "__main__":
    main()
