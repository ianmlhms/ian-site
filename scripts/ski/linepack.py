#!/usr/bin/env python3
"""R7-D: compact piste lines in resort.json (the decoder is pb/ski/linepack.js, which the game and the Node scripts use).

    python3 scripts/ski/linepack.py [rid ...]     packs pb/ski/data/<rid>/resort.json in place (all resorts without arguments)

pistes[].line -> "lz", network[].p -> "pz": decimetres, second differences, zigzag varints, base64. Lossless at 0.1 m (the bake writes
one decimal). bake.py calls pack_resort() before it writes resort.json. A file that is already packed stays as it is."""
import base64
import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def pack_line(arr):
    out = bytearray()
    prev, prev_d = [0, 0], [0, 0]
    for j, v in enumerate(arr):
        k = j % 2
        q = int(round(v * 10))
        d = q - prev[k]
        dd = d - prev_d[k]
        prev[k], prev_d[k] = q, d
        z = -2 * dd - 1 if dd < 0 else 2 * dd
        while True:
            b = z & 0x7F
            z >>= 7
            if z:
                out.append(b | 0x80)
            else:
                out.append(b)
                break
    return base64.b64encode(bytes(out)).decode("ascii")


def unpack_line(s):
    data = base64.b64decode(s)
    out, prev, prev_d, k, i = [], [0, 0], [0, 0], 0, 0
    while i < len(data):
        z, shift = 0, 0
        while True:
            b = data[i]
            i += 1
            z |= (b & 0x7F) << shift
            shift += 7
            if b < 0x80:
                break
        dd = -(z + 1) // 2 if z & 1 else z // 2
        d = prev_d[k] + dd
        q = prev[k] + d
        prev_d[k], prev[k] = d, q
        out.append(q / 10)
        k ^= 1
    return out


def pack_resort(r):
    """in place: pistes[].line -> lz, network[].p -> pz (checked by a round trip)"""
    for p in r.get("pistes", []):
        if "line" in p:
            lz = pack_line(p["line"])
            assert all(abs(a - b) < 0.051 for a, b in zip(unpack_line(lz), p["line"])), p.get("id")
            p["lz"] = lz
            del p["line"]
    for n in r.get("network", []):
        if "p" in n:
            n["pz"] = pack_line(n["p"])
            del n["p"]
    return r


def unpack_resort(r):
    """in place: the Python readers that need the lines (lz -> line, pz -> p)"""
    for p in r.get("pistes", []):
        if "lz" in p and "line" not in p:
            p["line"] = unpack_line(p.pop("lz"))
    for n in r.get("network", []):
        if "pz" in n and "p" not in n:
            n["p"] = unpack_line(n.pop("pz"))
    return r


def main():
    rids = sys.argv[1:] or sorted(d for d in os.listdir(os.path.join(REPO, "pb", "ski", "data")) if os.path.exists(os.path.join(REPO, "pb", "ski", "data", d, "resort.json")))
    for rid in rids:
        path = os.path.join(REPO, "pb", "ski", "data", rid, "resort.json")
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        r = json.loads(text)
        pack_resort(r)
        out = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(out)
        print(f"{rid}: resort.json {len(text) / 1e6:.2f} -> {len(out.encode('utf-8')) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
