#!/usr/bin/env python3
"""Flag the station building of a patch:  patch_flag.py <key> <building id> [--off]   (sets buildings[i].station = 1, file otherwise unchanged, compact JSON)"""
import json, os, sys
key, bid = sys.argv[1], sys.argv[2]
val = 0 if "--off" in sys.argv else 1
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pb", "train-sim", "data", "stations", key + ".json")
raw = open(path, encoding="utf-8").read()
d = json.loads(raw)
hit = [b for b in d["buildings"] if b["id"] == bid]
if len(hit) != 1:
    sys.exit("building id not found: " + bid)
hit[0]["station"] = val
open(path, "w", encoding="utf-8").write(json.dumps(d, separators=(",", ":"), ensure_ascii=False))
print("ok", key, bid, "station =", val, "size", len(raw), "->", os.path.getsize(path))
