#!/usr/bin/env python3
"""Fetch the OpenStreetMap data behind the Lokféierer Luxtram T1 route (stdlib only).

Data (c) OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
Be polite to the Overpass API: a handful of queries, results cached on disk, pauses between calls.

Usage:  python3 scripts/fetch_luxtram_osm.py [RAW_DIR]
Writes (skips files that already exist):
  t1_full.json   route relation 7758418 (T1 Findel -> Stadion) with geometry
  t1_nodes.json  its stop nodes with tags
  tram_ways.json every tram way + tram stop in the corridor (both directions, yards, grass track)
  bld_*.json  road_*.json  land_*.json  tree_*.json  poi_*.json   corridor features, tile unions
Raw dumps are NOT committed; they live in the OneDrive reports folder (default below).
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

RAW_DEFAULT = "/Users/ian/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/train-sim/luxtram-raw"
ENDPOINT = "https://overpass-api.de/api/interpreter"
UA = "ian.lu-luxtram-sim/1.0 (konto@ian.lu)"
RELATION = 7758418
PAUSE_S = 12
TILE_LAT = 0.004  # ~445 m
TILE_LON = 0.006  # ~455 m at 49.6 N
BUFFER_M = 260.0  # keep tiles whose centre is closer than this to the line


def overpass(query, retries=5):
    data = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(ENDPOINT, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=240) as resp:
                body = resp.read()
            if body.lstrip().startswith(b"{"):
                return body
            print("  non-json answer, retry", attempt)
        except Exception as exc:  # noqa: BLE001 - network errors are retried, then re-raised
            print("  error", exc, "retry", attempt)
        time.sleep(25 * attempt)
    raise RuntimeError("Overpass kept failing for: " + query[:80])


def fetch(path, query):
    if os.path.exists(path) and os.path.getsize(path) > 50:
        print("cached", os.path.basename(path))
        return
    print("fetch ", os.path.basename(path))
    body = overpass(query)
    with open(path, "wb") as fh:
        fh.write(body)
    print("  ", len(body) // 1024, "KB")
    time.sleep(PAUSE_S)


def line_points(raw):
    rel = json.load(open(os.path.join(raw, "t1_full.json")))["elements"][0]
    pts = []
    prev = None
    for m in rel["members"]:
        if m["type"] == "way" and m.get("role", "") == "":
            g = [(p["lat"], p["lon"]) for p in m["geometry"]]
            if prev is not None:
                d0 = math.hypot(prev[0] - g[0][0], prev[1] - g[0][1])
                d1 = math.hypot(prev[0] - g[-1][0], prev[1] - g[-1][1])
                if d1 < d0:
                    g.reverse()
            pts.extend(g)
            prev = g[-1]
    return pts


def tile_boxes(pts):
    """Row-merged bounding boxes (south,west,north,east) covering the corridor."""
    lat0 = 49.55
    lon0 = 6.05
    cells = set()
    mlat = 111320.0
    mlon = 111320.0 * math.cos(math.radians(49.6))
    ci = 0
    for lat, lon in pts:
        ci = (int((lat - lat0) / TILE_LAT), int((lon - lon0) / TILE_LON))
        for di in range(-2, 3):
            for dj in range(-2, 3):
                i, j = ci[0] + di, ci[1] + dj
                cl = lat0 + (i + 0.5) * TILE_LAT
                cn = lon0 + (j + 0.5) * TILE_LON
                if math.hypot((cl - lat) * mlat, (cn - lon) * mlon) < BUFFER_M:
                    cells.add((i, j))
    rows = {}
    for i, j in cells:
        rows.setdefault(i, []).append(j)
    boxes = []
    for i, js in sorted(rows.items()):
        js.sort()
        start = prev = js[0]
        for j in js[1:] + [None]:
            if j is not None and j == prev + 1:
                prev = j
                continue
            boxes.append((lat0 + i * TILE_LAT, lon0 + start * TILE_LON, lat0 + (i + 1) * TILE_LAT, lon0 + (prev + 1) * TILE_LON))
            if j is not None:
                start = prev = j
    return boxes


def union(selector_fmt, boxes):
    parts = []
    for s, w, n, e in boxes:
        bb = "(%.5f,%.5f,%.5f,%.5f)" % (s, w, n, e)
        parts.append(selector_fmt.replace("{bb}", bb))
    return "(" + "".join(parts) + ");"


def fetch_dem(raw, pts):
    """Ground elevation on a (s, lateral) grid around the line: EU-DEM v1.1 (25 m, Copernicus, open data) via opentopodata.org.
    The DEM is a surface model (roofs, trees): it is only a guide, the build script smooths it and hand-tunes the line's profile."""
    path = os.path.join(raw, "dem_grid.json")
    if os.path.exists(path):
        print("cached dem_grid.json")
        return
    lat0 = sum(p[0] for p in pts) / len(pts)
    m_lat = 111194.93
    m_lon = m_lat * math.cos(math.radians(lat0))
    # resample the chain every 40 m
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.hypot((b[0] - a[0]) * m_lat, (b[1] - a[1]) * m_lon))
    total = cum[-1]
    samples = []
    k = 1
    s = 0.0
    while s <= total:
        while k < len(cum) - 1 and cum[k] < s:
            k += 1
        a, b = pts[k - 1], pts[k]
        t = (s - cum[k - 1]) / max(1e-6, cum[k] - cum[k - 1])
        lat = a[0] + (b[0] - a[0]) * t
        lon = a[1] + (b[1] - a[1]) * t
        dx = (b[1] - a[1]) * m_lon
        dz = (b[0] - a[0]) * m_lat
        ln = math.hypot(dx, dz) or 1.0
        # right-hand normal on the ground plane (east, north)
        rx, rn = dz / ln, -dx / ln
        samples.append((s, lat, lon, rx, rn))
        s += 40.0
    offsets = [-120, -80, -40, 0, 40, 80, 120]
    coords = []
    for s, lat, lon, rx, rn in samples:
        for off in offsets:
            coords.append((s, off, lat + rn * off / m_lat, lon + rx * off / m_lon))
    elev = []
    for i in range(0, len(coords), 100):
        part = coords[i:i + 100]
        url = "https://api.opentopodata.org/v1/eudem25m?locations=" + "|".join("%.6f,%.6f" % (c[2], c[3]) for c in part)
        for attempt in range(6):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as resp:
                    elev.extend(r["elevation"] for r in json.loads(resp.read())["results"])
                break
            except Exception as exc:  # noqa: BLE001
                print("  dem error", exc)
                time.sleep(8 * (attempt + 1))
        else:
            raise RuntimeError("DEM fetch failed")
        time.sleep(1.3)
    out = {"offsets": offsets, "step": 40.0, "rows": [], "source": "EU-DEM v1.1 (Copernicus) via opentopodata.org"}
    n = len(offsets)
    for j in range(len(samples)):
        out["rows"].append({"s": samples[j][0], "lat": samples[j][1], "lon": samples[j][2], "h": elev[j * n:(j + 1) * n]})
    with open(path, "w") as fh:
        json.dump(out, fh)
    print("dem rows", len(out["rows"]))


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else RAW_DEFAULT
    os.makedirs(raw, exist_ok=True)
    fetch(os.path.join(raw, "t1_full.json"), "[out:json][timeout:120];relation(%d);out geom;" % RELATION)
    fetch(os.path.join(raw, "t1_nodes.json"), "[out:json][timeout:60];relation(%d);node(r);out tags center;" % RELATION)
    box = "(49.565,6.095,49.65,6.235)"
    fetch(
        os.path.join(raw, "tram_ways.json"),
        "[out:json][timeout:120];(way[\"railway\"=\"tram\"]%s;way[\"railway\"=\"construction\"][\"construction\"~\"tram\"]%s;"
        "node[\"railway\"=\"tram_stop\"]%s;);out geom tags;" % (box, box, box),
    )
    boxes = tile_boxes(line_points(raw))
    print(len(boxes), "tile boxes")
    # split the boxes into three groups (west / middle / east) to keep every answer small
    boxes.sort(key=lambda b: b[1])
    third = max(1, len(boxes) // 3)
    groups = {"a": boxes[:third], "b": boxes[third:2 * third], "c": boxes[2 * third:]}
    for gid, bx in groups.items():
        fetch(
            os.path.join(raw, "bld_%s.json" % gid),
            "[out:json][timeout:240];" + union("way[\"building\"]{bb};relation[\"building\"]{bb};way[\"building:part\"]{bb};", bx) + "out geom tags;",
        )
        fetch(
            os.path.join(raw, "road_%s.json" % gid),
            "[out:json][timeout:240];" + union("way[\"highway\"]{bb};", bx) + "out geom tags;",
        )
        fetch(
            os.path.join(raw, "land_%s.json" % gid),
            "[out:json][timeout:240];"
            + union(
                "way[\"landuse\"~\"grass|meadow|forest|recreation_ground|village_green|cemetery|farmland|orchard|allotments|railway|greenfield|brownfield|construction\"]{bb};"
                "way[\"leisure\"~\"park|garden|pitch|playground|sports_centre|stadium|golf_course|track\"]{bb};"
                "way[\"natural\"~\"wood|water|grassland|scrub|tree_row|cliff|bare_rock|heath\"]{bb};"
                "way[\"waterway\"~\"river|stream|canal|riverbank\"]{bb};"
                "relation[\"natural\"=\"water\"]{bb};relation[\"leisure\"=\"park\"]{bb};relation[\"landuse\"~\"forest|grass\"]{bb};",
                bx,
            )
            + "out geom tags;",
        )
        fetch(
            os.path.join(raw, "tree_%s.json" % gid),
            "[out:json][timeout:240];" + union("node[\"natural\"=\"tree\"]{bb};", bx) + "out;",
        )
        fetch(
            os.path.join(raw, "poi_%s.json" % gid),
            "[out:json][timeout:240];"
            + union(
                "node[\"man_made\"~\"tower|chimney|mast|water_tower|flagpole\"]{bb};way[\"man_made\"~\"tower|chimney|bridge|water_tower\"]{bb};"
                "node[\"railway\"~\"funicular|station|halt\"]{bb};way[\"railway\"=\"funicular\"]{bb};way[\"bridge\"=\"yes\"][\"highway\"]{bb};"
                "node[\"highway\"=\"traffic_signals\"]{bb};",
                bx,
            )
            + "out geom tags;",
        )
    fetch_dem(raw, line_points(raw))
    print("DONE")


if __name__ == "__main__":
    main()
