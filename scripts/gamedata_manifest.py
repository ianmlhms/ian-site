#!/usr/bin/env python3
"""Content hashes of the big game data files (pb/<game>/data/**).

The service worker (sw.js) keeps these files on the device and trusts
pb/<game>/data-hashes.json to say which version of each file is current:

    {"v":1,"files":{
    "terrain.bin":"3fa9c0d2b1",
    ...
    }}

The keys are paths below pb/<game>/data/, the values the first HASH_LEN hex
characters of the SHA-256 of the file. A changed file therefore gets a new
hash, the worker downloads it once, and the old copy is deleted. A file that is
not listed is never cached (the worker goes to the network for it).

    python3 scripts/gamedata_manifest.py            # rewrite the manifests
    python3 scripts/gamedata_manifest.py --check    # exit 1 when one is stale

scripts/check_site.py runs the same check, so a data file that changed without
its hash changing fails the pre-push check. After a merge conflict in a
data-hashes.json, just run the command without --check: it is generated.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PB = os.path.join(REPO, "pb")
MANIFEST_NAME = "data-hashes.json"
FORMAT_VERSION = 1
HASH_LEN = 10                       # must match HASH_LEN in sw.js
SKIP_SUFFIXES = (".md", ".txt")     # notes next to the data, never fetched by a game
READ_BLOCK = 1 << 20


def hash_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(READ_BLOCK), b""):
            digest.update(block)
    return digest.hexdigest()[:HASH_LEN]


def data_files(game: str) -> list:
    """Relative paths (below pb/<game>/data/) of every cacheable file, sorted."""
    data_dir = os.path.join(PB, game, "data")
    found = []
    for root, dirs, files in os.walk(data_dir):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for name in files:
            if name.startswith(".") or name.endswith(SKIP_SUFFIXES):
                continue
            found.append(os.path.relpath(os.path.join(root, name), data_dir).replace(os.sep, "/"))
    return sorted(found)


def games_with_data() -> list:
    """Game folder names that have a data/ directory with at least one cacheable file."""
    return [name for name in sorted(os.listdir(PB))
            if os.path.isdir(os.path.join(PB, name, "data")) and data_files(name)]


def compute_hashes(game: str) -> dict:
    """{relative path below pb/<game>/data/: hash} for every cacheable file, sorted by path."""
    data_dir = os.path.join(PB, game, "data")
    return {path: hash_file(os.path.join(data_dir, path)) for path in data_files(game)}


def render(hashes: dict) -> str:
    """One entry per line, so that diffs and merges stay readable."""
    lines = [f'{json.dumps(path)}:{json.dumps(value)}' for path, value in hashes.items()]
    return '{"v":%d,"files":{\n%s\n}}\n' % (FORMAT_VERSION, ",\n".join(lines))


def manifest_path(game: str) -> str:
    return os.path.join(PB, game, MANIFEST_NAME)


def read_manifest(game: str) -> dict | None:
    """The hashes stored in the manifest, or None when it is missing or unreadable."""
    try:
        with open(manifest_path(game), encoding="utf-8") as handle:
            parsed = json.load(handle)
        files = parsed["files"]
        return files if isinstance(files, dict) else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def stale_entries(game: str) -> list:
    """Human readable problems of one game's manifest; empty when it is current."""
    stored = read_manifest(game)
    actual = compute_hashes(game)
    prefix = f"pb/{game}/data/"
    if stored is None:
        return [f"pb/{game}/{MANIFEST_NAME} is missing or unreadable (run scripts/gamedata_manifest.py)"]
    problems = []
    for path, value in actual.items():
        if path not in stored:
            problems.append(f"{prefix}{path} has no hash in {MANIFEST_NAME}")
        elif stored[path] != value:
            problems.append(f"{prefix}{path} changed but its hash did not ({stored[path]} -> {value})")
    for path in stored:
        if path not in actual:
            problems.append(f"{MANIFEST_NAME} lists {prefix}{path}, which no longer exists")
    return problems


def check_all() -> list:
    problems = []
    games = games_with_data()
    for game in games:
        problems.extend(stale_entries(game))
    for name in sorted(os.listdir(PB)):   # a manifest whose data folder is gone
        if os.path.exists(manifest_path(name)) and name not in games:
            problems.append(f"pb/{name}/{MANIFEST_NAME} belongs to a game without data files")
    return problems


def write_all() -> list:
    written = []
    for game in games_with_data():
        text = render(compute_hashes(game))
        path = manifest_path(game)
        try:
            with open(path, encoding="utf-8") as handle:
                if handle.read() == text:
                    continue
        except OSError:
            pass
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(text)
        written.append(game)
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="only report stale manifests (exit 1)")
    args = parser.parse_args()
    if args.check:
        problems = check_all()
        for line in problems:
            print(line)
        print("game data hashes: " + ("STALE (%d)" % len(problems) if problems else "current"))
        sys.exit(1 if problems else 0)
    written = write_all()
    print("updated: " + (", ".join(written) if written else "nothing (all manifests were current)"))


if __name__ == "__main__":
    main()
