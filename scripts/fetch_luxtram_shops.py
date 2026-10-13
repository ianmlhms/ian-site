#!/usr/bin/env python3
"""Fetch shop / amenity points along the Luxtram corridor (P-FACADE: which ground floors get shopfronts).
Data (c) OpenStreetMap contributors, ODbL 1.0.  Writes shop_*.json next to the other raw dumps (skips existing)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_luxtram_osm as F  # noqa: E402

RAW = sys.argv[1] if len(sys.argv) > 1 else F.RAW_DEFAULT
SEL = ('nwr["shop"]{bb};nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|bank|pharmacy|bakery|ice_cream|cinema|theatre|post_office|marketplace|bureau_de_change)$"]{bb};'
       'nwr["tourism"~"^(hotel|hostel|gallery|museum)$"]{bb};nwr["craft"]{bb};nwr["office"~"^(travel_agent|estate_agent|insurance|financial|company)$"]{bb};')


def main():
    pts = F.line_points(RAW)
    boxes = F.tile_boxes(pts)
    # 6 chunks of boxes -> shop_a..f
    n = (len(boxes) + 5) // 6
    for k in range(6):
        part = boxes[k * n:(k + 1) * n]
        if not part:
            continue
        q = "[out:json][timeout:180];" + F.union(SEL, part) + "out center tags;"
        F.fetch(os.path.join(RAW, "shop_%s.json" % "abcdef"[k]), q)


main()
