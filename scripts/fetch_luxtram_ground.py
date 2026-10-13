#!/usr/bin/env python3
"""Extra OpenStreetMap layers for the painted Luxtram ground (stdlib only; data (c) OpenStreetMap contributors, ODbL).

Adds to the raw cache (same tile unions as fetch_luxtram_osm.py):  ground_<a|b|c>.json
  parking areas, area:highway, pedestrian areas, non-tram railways + platforms, all water (ways + relations), built-up landuse (for the far ring),
  crossing nodes, bus-stop nodes, man_made bridges / piers / retaining walls.
Usage: python3 scripts/fetch_luxtram_ground.py [RAW_DIR]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_luxtram_osm as F  # noqa: E402


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else F.RAW_DEFAULT
    boxes = F.tile_boxes(F.line_points(raw))
    boxes.sort(key=lambda b: b[1])
    third = max(1, len(boxes) // 3)
    groups = {"a": boxes[:third], "b": boxes[third:2 * third], "c": boxes[2 * third:]}
    for gid, bx in groups.items():
        F.fetch(
            os.path.join(raw, "ground_%s.json" % gid),
            "[out:json][timeout:240];"
            + F.union(
                'way["amenity"~"parking|parking_space|bicycle_parking|fountain"]{bb};relation["amenity"="parking"]{bb};'
                'way["area:highway"]{bb};way["highway"~"pedestrian|footway|service|living_street"]["area"="yes"]{bb};'
                'relation["highway"="pedestrian"]{bb};'
                'way["railway"~"rail|light_rail|narrow_gauge|abandoned|disused|razed|platform|funicular"]{bb};'
                'way["natural"~"water|bay|wetland|beach|sand|mud"]{bb};relation["natural"="water"]{bb};'
                'way["waterway"]{bb};relation["waterway"~"riverbank|river"]{bb};'
                'way["landuse"~"residential|commercial|industrial|retail|military|education|institutional|garages|religious|cemetery|basin|quarry|plant_nursery|flowerbed|farmyard|port|depot"]{bb};'
                'way["leisure"~"swimming_pool|pitch|track|golf_course|dog_park|picnic_table|nature_reserve|marina"]{bb};'
                'way["man_made"~"bridge|pier|embankment|dyke|retaining|groyne|storage_tank"]{bb};way["barrier"~"retaining_wall|wall"]{bb};'
                'way["surface"~"grass|sand|gravel|compacted|fine_gravel|unpaved|dirt|ground|earth|paving_stones|sett|cobblestone|concrete|asphalt"]["area"="yes"]{bb};'
                'node["highway"~"crossing|bus_stop|stop|give_way"]{bb};node["railway"~"level_crossing|crossing"]{bb};',
                bx,
            )
            + "out geom tags;",
        )
    print("DONE")


if __name__ == "__main__":
    main()
