#!/usr/bin/env python3
"""Publish the ShortsFactory dashboard:
  • write a SANITIZED, public-safe copy to the ian-site repo (for stats.html), and
  • push the FULL data to Supabase `dashboard_state` (admin-only, for factory.html).

Must live inside the ShortsFactory project (next to src/). Run with its venv.

Env:
  SUPABASE_URL          e.g. https://lvksqmgfwkfbblfsozfk.supabase.co
  SUPABASE_SERVICE_KEY  the service_role secret  (NEVER commit / print this)

Usage:
  PYTHONPATH=<SF_DIR> python scripts/publish_factory.py /path/to/ian-site/data/factory.json
  ... add --no-social to skip the live social fetch.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.dashboard import _build_payload          # noqa: E402
from src.core.config import load_settings         # noqa: E402


def sanitize(f: dict) -> dict:
    """Keep only the fields stats.html needs; drop niche/topics/paths/errors/etc."""
    return {
        "generated_at": f.get("generated_at"),
        "channels": [{"id": c.get("id"), "display_name": c.get("display_name"), "enabled": c.get("enabled")}
                     for c in f.get("channels", [])],
        "videos": [{"id": v.get("id"), "channel_id": v.get("channel_id"), "status": v.get("status"),
                    "youtube_id": v.get("youtube_id"), "duration_s": v.get("duration_s"),
                    "language": v.get("language"), "title": v.get("title"), "created_at": v.get("created_at")}
                   for v in f.get("videos", [])],
        "social": {
            "accounts": [{"channel_id": a.get("channel_id"), "platform": a.get("platform"),
                          "handle": a.get("handle"), "url": a.get("url"), "followers": a.get("followers"),
                          "likes": a.get("likes"), "videos": a.get("videos"), "posts": a.get("posts")}
                         for a in (f.get("social", {}) or {}).get("accounts", [])],
            "fetched_at": (f.get("social", {}) or {}).get("fetched_at"),
        },
    }


def push_supabase(full: dict) -> None:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("! SUPABASE_URL / SUPABASE_SERVICE_KEY not set — skipping private cloud push")
        return
    body = json.dumps({"id": 1, "data": full,
                       "updated_at": datetime.now(timezone.utc).isoformat()}).encode()
    req = urllib.request.Request(
        url + "/rest/v1/dashboard_state?on_conflict=id", data=body, method="POST",
        headers={"apikey": key, "Authorization": "Bearer " + key,
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"})
    with urllib.request.urlopen(req) as r:
        print("private dashboard pushed to Supabase:", r.status)


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    out = args[0] if args else "factory.json"
    full = _build_payload(load_settings(), fetch_social="--no-social" not in sys.argv)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(sanitize(full), fh, ensure_ascii=False)
    print("wrote sanitized public file:", out)
    push_supabase(full)


if __name__ == "__main__":
    main()
