#!/usr/bin/env python3
"""Aggregate ian.lu's GoatCounter pageviews into public.site_traffic.

/api/v0/stats/total and /stats/hits return a single `count` per day or path, and
that count is **unique visitors**, not pageviews -- verified against the export
on seven consecutive days, where it matched the first-visit count exactly and
was about half the row count. So the figure the API hands back has always been
visitors; what it gives no way to reach is the pageview total.

The export carries both: each row is one pageview, and rows flagged FirstVisit
are the unique visitors. That is why this runs off the export rather than the
much cheaper stats endpoint.

Only aggregates are stored. The raw export (which contains session ids, user
agents and coarse locations) is written to a temporary file and deleted.

    python3 scripts/fetch_visitors.py

Hourly by launchd (lu.ian.visitors). That agent runs a copy kept outside
OneDrive, because launchd cannot read ~/Library/CloudStorage; this file is the
source of truth, so reinstall after editing it:

    cp scripts/fetch_visitors.py \
       "$HOME/Library/Application Support/ian-visitors/fetch_visitors.py"

The token is read from ~/.config/goatcounter/.env and never printed or passed as
an argument. Rows go to Postgres, not to a file under data/, because the site is
static and public -- a committed file would make the private page cosmetic.
"""
import csv
import glob
import gzip
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

SITE = "https://ianm.goatcounter.com"
# Checked in order, so a host can keep both keys in one file (brix) or the
# GoatCounter token on its own (the Mac, which uses the Supabase CLI instead).
CONFIG_FILES = (os.path.expanduser("~/.config/goatcounter/.env"),
                os.path.expanduser("~/.config/ianlu/traffic.env"),
                "/workspace/ian-traffic/.env")
TOKEN_KEY = "GOATCOUNTER_TOKEN"
DATABASE_URL_KEY = "TRAFFIC_DB_URL"
# Addressed by ref rather than by being run inside the repo: a launchd agent
# cannot read ~/Library/CloudStorage (macOS refuses it with "Operation not
# permitted"), so the hourly copy of this script lives outside OneDrive.
PROJECT_REF = "lvksqmgfwkfbblfsozfk"
EXPORT_POLL_SECONDS = 4
EXPORT_MAX_POLLS = 45
REQUEST_TIMEOUT = 120
TOP_PAGES_PER_DAY = 10
SITE_TZ = ZoneInfo("Europe/Luxembourg")  # the day boundary traffic.html shows
RATE_LIMITED_EXIT = 0   # a scheduled run that is rate limited is not a failure
LOOP_DEFAULT_SECONDS = 3600  # GoatCounter's export limit; no point going faster


def read_config(key):
    """Look a key up in the env file, or return None. Values are never logged."""
    for path in CONFIG_FILES:
        try:
            with open(path, encoding="utf-8") as handle:
                for line in handle:
                    name, separator, value = line.partition("=")
                    if separator and name.strip() == key and value.strip():
                        return value.strip()
        except FileNotFoundError:
            continue
    return None


def read_token():
    token = os.environ.get(TOKEN_KEY) or read_config(TOKEN_KEY)
    if token:
        return token
    sys.exit("No GoatCounter token. Create one at %s/user/api and save it to %s"
             % (SITE, CONFIG_FILES[0]))


def api(token, path, method="GET", payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        SITE + path, data=body, method=method,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
        raw = response.read()
        return json.loads(raw) if raw else {}


def start_export(token):
    """Kick off a full export, or None when the hourly rate limit is in force."""
    try:
        return api(token, "/api/v0/export", "POST",
                   {"format": "csv", "start_from_hit_id": 0})
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        if error.code == 429 or "rate limited" in detail.lower():
            print("Rate limited (GoatCounter allows one export per hour); "
                  "leaving the existing figures in place.")
            return None
        sys.exit("Export request failed: HTTP %d %s" % (error.code, detail[:200]))


def wait_for_export(token, export_id):
    for _ in range(EXPORT_MAX_POLLS):
        status = api(token, "/api/v0/export/%s" % export_id)
        if status.get("error"):
            sys.exit("GoatCounter could not build the export: %s" % status["error"])
        if status.get("finished_at"):
            return status
        time.sleep(EXPORT_POLL_SECONDS)
    sys.exit("Export did not finish in %d seconds." % (EXPORT_POLL_SECONDS * EXPORT_MAX_POLLS))


def download_rows(token, export_id):
    """Yield the export's CSV rows as dicts, from a temp file that is removed."""
    request = urllib.request.Request(
        SITE + "/api/v0/export/%s/download" % export_id,
        headers={"Authorization": "Bearer " + token})
    handle, temp_path = tempfile.mkstemp(prefix="gc-export-", suffix=".csv.gz")
    os.close(handle)
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response, \
                open(temp_path, "wb") as out:
            out.write(response.read())
        try:
            with gzip.open(temp_path, "rt", encoding="utf-8", errors="replace") as text:
                return list(csv.DictReader(text))
        except (OSError, EOFError):
            with open(temp_path, "rt", encoding="utf-8", errors="replace") as text:
                return list(csv.DictReader(text))
    finally:
        os.remove(temp_path)


def is_true(value):
    return str(value).strip().lower() in {"true", "1", "yes", "t"}


def normalise_header(name):
    """'2Path' -> 'path', 'First visit' -> 'firstvisit', 'created_at' -> 'createdat'.

    GoatCounter prefixes the export's FIRST header with its format version, so
    the path column is literally named "2Path". Matching exact spellings missed
    it and every hit fell back to "/", leaving top_pages with a single entry.
    """
    return "".join(ch for ch in str(name).lstrip("0123456789").lower() if ch.isalnum())


def column(row, *names):
    """Fetch a column by any of its spellings, ignoring version prefix/case/spacing."""
    wanted = {normalise_header(name) for name in names}
    for key, value in row.items():
        if normalise_header(key) in wanted and value not in (None, ""):
            return value
    return ""


def local_day(stamp):
    """UTC export timestamp -> the Luxembourg calendar day it belongs to.

    The export is in UTC, but traffic.html's "today" is the viewer's local
    day. Slicing the UTC string put everything between 00:00 and 02:00 local
    time (01:00 in winter) on the previous day, so "Today" read 0 for the
    first two hours after midnight.
    """
    if not stamp:
        return ""
    try:
        moment = datetime.fromisoformat(stamp.strip().replace("Z", "+00:00"))
    except ValueError:
        return ""  # skip the row: a non-date key would fail the whole upsert
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(SITE_TZ).date().isoformat()


def aggregate(rows):
    """day -> {unique_visitors, pageviews, top_pages}."""
    days = {}
    for row in rows:
        stamp = column(row, "Date", "date", "created_at")
        day = local_day(stamp)
        if not day:
            continue
        if is_true(column(row, "Bot", "bot")):
            continue
        entry = days.setdefault(day, {"pageviews": 0, "sessions": set(),
                                      "first_visits": 0, "paths": {}})
        path = column(row, "Path", "path") or "/"
        entry["pageviews"] += 1
        entry["paths"][path] = entry["paths"].get(path, 0) + 1
        session = column(row, "Session", "session")
        if session:
            entry["sessions"].add(session)
        if is_true(column(row, "FirstVisit", "first_visit")):
            entry["first_visits"] += 1

    result = {}
    for day, entry in days.items():
        # FirstVisit is what the dashboard counts; distinct sessions is the
        # fallback for exports that predate the flag.
        unique = entry["first_visits"] or len(entry["sessions"])
        top = sorted(entry["paths"].items(), key=lambda item: (-item[1], item[0]))
        result[day] = {
            "unique_visitors": unique,
            "pageviews": entry["pageviews"],
            "top_pages": [{"path": p, "views": n} for p, n in top[:TOP_PAGES_PER_DAY]],
        }
    return result


def store(daily):
    """Upsert into public.site_traffic through the Supabase CLI.

    The payload is passed as one dollar-quoted JSON literal so that paths
    containing quotes cannot break or inject into the statement.
    """
    payload = [{"day": day, **values} for day, values in sorted(daily.items())]
    statement = (
        "insert into public.site_traffic\n"
        "  (day, unique_visitors, pageviews, top_pages, updated_at)\n"
        "select (r->>'day')::date, (r->>'unique_visitors')::int,\n"
        "       (r->>'pageviews')::int, r->'top_pages', now()\n"
        "from jsonb_array_elements($gcpayload$%s$gcpayload$::jsonb) as r\n"
        "on conflict (day) do update set\n"
        "  unique_visitors = excluded.unique_visitors,\n"
        "  pageviews = excluded.pageviews,\n"
        "  top_pages = excluded.top_pages,\n"
        "  updated_at = now();\n" % json.dumps(payload)
    )
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False,
                                     encoding="utf-8") as handle:
        handle.write(statement)
        sql_path = handle.name
    try:
        # Two hosts, two clients. brix has psql but not the Supabase CLI, and it
        # connects as `traffic_writer`, a role granted nothing beyond insert,
        # select and update on this one table. The Mac has the CLI and no psql.
        database_url = os.environ.get(DATABASE_URL_KEY) or read_config(DATABASE_URL_KEY)
        if database_url:
            command = ["psql", database_url, "--quiet", "--no-psqlrc",
                       "-v", "ON_ERROR_STOP=1", "-f", sql_path]
        else:
            command = ["supabase", "db", "query", "--linked",
                       "--project-ref", PROJECT_REF, "-f", sql_path]
        result = subprocess.run(command, capture_output=True, text=True, timeout=180)
        if result.returncode != 0:
            sys.exit("Writing to the database failed:\n%s"
                     % (result.stderr or result.stdout)[:400])
    finally:
        os.remove(sql_path)


def run_once():
    token = read_token()
    export = start_export(token)
    if export is None:
        return RATE_LIMITED_EXIT
    export_id = export.get("id")
    if not export_id:
        sys.exit("GoatCounter did not return an export id: %s" % json.dumps(export)[:200])
    wait_for_export(token, export_id)
    rows = download_rows(token, export_id)
    if not rows:
        sys.exit("The export was empty - refusing to overwrite the stored figures.")
    daily = aggregate(rows)
    if not daily:
        sys.exit("No dated rows in the export - refusing to overwrite.")
    store(daily)
    newest = max(daily)
    print("Stored %d days from %d pageviews. Latest %s: %d unique, %d views."
          % (len(daily), len(rows), newest,
             daily[newest]["unique_visitors"], daily[newest]["pageviews"]))
    return 0


def main(argv):
    """One shot by default; --loop keeps running for the container on brix.

    Looping in-process rather than adding cron or supercronic keeps the image to
    python plus psql, and `restart: unless-stopped` already covers a crash.
    """
    if "--loop" not in argv:
        return run_once()
    index = argv.index("--loop")
    interval = LOOP_DEFAULT_SECONDS
    if index + 1 < len(argv):
        try:
            interval = max(60, int(argv[index + 1]))
        except ValueError:
            sys.exit("--loop takes a number of seconds")
    while True:
        try:
            run_once()
        except SystemExit as stop:
            # One bad hour must not kill the daemon; the next run rebuilds
            # every day from the full export anyway.
            print("run failed: %s" % stop, flush=True)
        except Exception as error:  # noqa: BLE001 - keep the loop alive
            print("unexpected failure: %r" % error, flush=True)
        time.sleep(interval)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
