#!/usr/bin/env python3
"""Publish the ShortsFactory dashboard:
  • push the FULL data to Supabase `dashboard_state` (admin-only; read by
    factory.html, me.html and the briefing Edge Function). There is no public
    copy any more -- data/factory.json was removed on 23 Sep 2026.

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
    # Private only since 23 Sep 2026. The "sanitized public file" still listed
    # every channel's social handles, so anyone could tie those accounts to
    # ian.lu; me.html, factory.html and the briefing function all read the
    # admin-only dashboard_state row instead. A path argument is ignored.
    full = _build_payload(load_settings(), fetch_social="--no-social" not in sys.argv)
    push_supabase(full)


if __name__ == "__main__":
    main()
