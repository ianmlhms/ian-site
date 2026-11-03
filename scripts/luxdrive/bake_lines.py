#!/usr/bin/env python3
"""Bake the tram and rail lines and the public transport stops of Lux Drive.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/bake_lines.py

  lines.bin   the tram and rail ways (the rails the tram runs on, the railway tracks)
  stops.bin   the tram stops, the train stations and the bus stops (with their names)

lines.bin layout (little endian):
    u32 count
    per line:
      u8  kind      0 = tram, 1 = rail, 2 = the main tram line (the Luxtram)
      u8  flags     bit0 = the line runs in a street (no separate reservation)
      u16 npts
      i32 x0 (decimetres), i32 z0 (decimetres)
      varint zigzag deltas of x and z (decimetres)

stops.bin layout:
    u32 count
    per stop:
      u8  kind      0 = tram stop, 1 = train station, 2 = bus stop
      u16 nameId    (index into stopnames.json)
      i32 x (decimetres), i32 z (decimetres)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT_DIR, RAW_DIR, lonlat_to_luref, luref_to_world  # noqa: E402

KIND_TRAM, KIND_RAIL, KIND_TRAM_MAIN = 0, 1, 2
FLAG_IN_STREET = 1


def varint(n, out):
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)


def zigzag(n):
    return (n << 1) ^ (n >> 63)


def main():
    osm = json.load(open(os.path.join(RAW_DIR, "osm.json"), encoding="utf-8"))

    def world_points(way):
        lons, lats = [], []
        for nid in way["n"]:
            p = osm["nodes"].get(str(nid))
            if p:
                lons.append(p[0])
                lats.append(p[1])
        if len(lons) < 2:
            return []
        e, n = lonlat_to_luref(lons, lats)
        wx, wz = luref_to_world(e, n)
        return list(zip(wx.tolist(), wz.tolist()))

    lines = []
    for w in osm["ways"]:
        t = w["t"]
        rail = t.get("railway")
        if rail not in ("tram", "light_rail", "subway", "rail", "narrow_gauge", "disused", "abandoned"):
            continue
        if t.get("service") in ("yard", "siding", "spur"):
            continue
        pts = world_points(w)
        if len(pts) < 2:
            continue
        kind = KIND_RAIL if rail in ("rail", "narrow_gauge", "disused", "abandoned") else KIND_TRAM
        flags = 0
        if t.get("embedded") == "yes" or not t.get("tunnel"):
            flags |= FLAG_IN_STREET      # the tram rails share the street
        lines.append({"kind": kind, "flags": flags, "pts": pts, "id": w["id"]})

    # the main tram line: the tram network's biggest connected piece (the Luxtram)
    tram_edges = {}
    for i, l in enumerate(lines):
        if l["kind"] != KIND_TRAM:
            continue
        for a, b in zip(l["pts"], l["pts"][1:]):
            ka = (round(a[0] * 2), round(a[1] * 2))
            kb = (round(b[0] * 2), round(b[1] * 2))
            tram_edges.setdefault(ka, set()).add(kb)
            tram_edges.setdefault(kb, set()).add(ka)
    seen = set()
    best = None
    for start in tram_edges:
        if start in seen:
            continue
        stack = [start]
        comp = []
        seen.add(start)
        while stack:
            k = stack.pop()
            comp.append(k)
            for nb in tram_edges[k]:
                if nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
        if best is None or len(comp) > len(best):
            best = comp
    main_nodes = set(best) if best else set()
    if main_nodes:
        for l in lines:
            if l["kind"] != KIND_TRAM:
                continue
            if any((round(p[0] * 2), round(p[1] * 2)) in main_nodes for p in l["pts"]):
                l["kind"] = KIND_TRAM_MAIN
    tram_km = sum(sum(((l["pts"][i][0] - l["pts"][i - 1][0]) ** 2 + (l["pts"][i][1] - l["pts"][i - 1][1]) ** 2) ** 0.5
                       for i in range(1, len(l["pts"]))) for l in lines if l["kind"] != KIND_RAIL) / 1000.0
    rail_km = sum(sum(((l["pts"][i][0] - l["pts"][i - 1][0]) ** 2 + (l["pts"][i][1] - l["pts"][i - 1][1]) ** 2) ** 0.5
                       for i in range(1, len(l["pts"]))) for l in lines if l["kind"] == KIND_RAIL) / 1000.0
    print("lines %d (tram %.1f km, rail %.1f km), main tram network %d nodes" %
          (len(lines), tram_km, rail_km, len(main_nodes)))

    blob = bytearray()
    blob += (len(lines)).to_bytes(4, "little")
    for l in lines:
        pts = l["pts"]
        blob += l["kind"].to_bytes(1, "little")
        blob += l["flags"].to_bytes(1, "little")
        blob += len(pts).to_bytes(2, "little")
        px, pz = round(pts[0][0] * 10), round(pts[0][1] * 10)
        blob += px.to_bytes(4, "little", signed=True)
        blob += pz.to_bytes(4, "little", signed=True)
        for x, z in pts[1:]:
            qx, qz = round(x * 10), round(z * 10)
            varint(zigzag(qx - px), blob)
            varint(zigzag(qz - pz), blob)
            px, pz = qx, qz
    with open(os.path.join(OUT_DIR, "lines.bin"), "wb") as fh:
        fh.write(blob)
    print("lines.bin %.1f kB" % (len(blob) / 1024.0))

    # ---- the stops --------------------------------------------------------
    names = []
    name_ids = {}
    stops = []
    for p in osm["pois"]:
        t = p["t"]
        name = t.get("name") or t.get("name:lb") or ""
        kind = None
        if t.get("railway") in ("tram_stop", "stop") and t.get("public_transport") in ("stop_position", "platform"):
            kind = 0
        elif t.get("railway") in ("station", "halt"):
            kind = 1
        elif t.get("highway") == "bus_stop" or t.get("public_transport") == "stop_position":
            kind = 2
        if kind is None or not name:
            continue
        if name not in name_ids:
            name_ids[name] = len(names)
            names.append(name)
        x, z = luref_to_world(*lonlat_to_luref(p["lon"], p["lat"]))
        stops.append({"kind": kind, "nameId": name_ids[name], "x": float(x), "z": float(z)})
    blob = bytearray()
    blob += (len(stops)).to_bytes(4, "little")
    for s in stops:
        blob += s["kind"].to_bytes(1, "little")
        blob += s["nameId"].to_bytes(2, "little")
        blob += int(round(s["x"] * 10)).to_bytes(4, "little", signed=True)
        blob += int(round(s["z"] * 10)).to_bytes(4, "little", signed=True)
    with open(os.path.join(OUT_DIR, "stops.bin"), "wb") as fh:
        fh.write(blob)
    with open(os.path.join(OUT_DIR, "stopnames.json"), "w", encoding="utf-8") as fh:
        json.dump(names, fh, ensure_ascii=False, separators=(",", ":"))
    from collections import Counter
    print("stops %d %s, stops.bin %.1f kB" %
          (len(stops), Counter(s["kind"] for s in stops), len(blob) / 1024.0))


if __name__ == "__main__":
    main()
