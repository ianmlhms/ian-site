#!/usr/bin/env python3
"""Export the ShortsFactory dashboard payload as JSON for the ian.lu live dashboard.

This reuses ShortsFactory's own data builder so the JSON is identical to what the
local HTML dashboard shows. It MUST live inside the ShortsFactory project (next to
the `src/` package) so `from src.dashboard import _build_payload` resolves.

Usage (from the ShortsFactory project, using its venv):
    .venv/bin/python scripts/export_factory_json.py /path/to/ian-site/data/factory.json
    .venv/bin/python scripts/export_factory_json.py out.json --no-social   # use cached social
"""
import json
import os
import sys

# Make the ShortsFactory project importable regardless of cwd (script lives in <project>/scripts).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.dashboard import _build_payload          # noqa: E402
from src.core.config import load_settings         # noqa: E402


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    out = args[0] if args else "factory.json"
    fetch_social = "--no-social" not in sys.argv
    payload = _build_payload(load_settings(), fetch_social=fetch_social)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f"wrote {out}: {len(payload.get('videos', []))} videos, "
          f"{len(payload.get('channels', []))} channels")


if __name__ == "__main__":
    main()
