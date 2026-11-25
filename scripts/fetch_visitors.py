#!/usr/bin/env python3
"""Aggregate ian.lu's GoatCounter pageviews into public.site_traffic.

site_traffic.unique_visitors holds real VISITS since 25 Nov 2026: the number of
distinct GoatCounter sessions that day. A session is one browser's visit (it ends
after some hours without a hit), however many pages it opens.

It used to hold the rows flagged FirstVisit, and that is NOT a count of people:
GoatCounter sets the flag once per session AND PATH, so somebody opening three
pages counted three times (/api/v0/stats/total is the same sum over all paths;
verified 25 Nov 2026). The session id exists only in the export, which is why
this runs off the export rather than the much cheaper stats endpoint.

Sessions are keyed on IP + user agent, so identical iPads behind one school IP
can still merge into a single visit: read the figure as a lower bound.

Only aggregates are stored: totals per page, hour, referrer host, browser, system,
region, screen and the shape of the visits (entry, exit, steps, length). Never a
session id or a user agent, so no single visitor can be followed. The raw export (which contains session ids, user
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
import collections
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
MAX_PAGES_PER_DAY = 200
MAX_LABELS_PER_DAY = 25
MAX_LABEL = 160
LABEL_LISTS = ("refs", "browsers", "browser_versions", "systems", "system_versions",
               "countries", "regions", "screens", "screen_sizes", "entries", "exits", "steps")
BREAKDOWNS = ("pages", "hours") + LABEL_LISTS
DURATION_STEPS = ((10, "<10 s"), (60, "10-60 s"), (300, "1-5 min"), (900, "5-15 min"),
                  (3600, "15-60 min"))
SCREEN_CLASSES = ((600, "phone"), (1400, "tablet / small laptop"))
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


def tally():
    """label -> [views, sessions]; the two figures every breakdown carries."""
    return collections.defaultdict(lambda: [0, set()])


def hit_hour(stamp):
    """UTC export timestamp -> Luxembourg hour 0-23, or None when unreadable."""
    try:
        moment = datetime.fromisoformat(stamp.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(SITE_TZ).hour


def screen_class(value):
    """'1180,820,2' -> a size class, so no odd screen can single anybody out."""
    digits = "".join(ch if ch.isdigit() else " " for ch in str(value)).split()
    width = int(digits[0]) if digits else 0
    if not width:
        return "?"
    for limit, label in SCREEN_CLASSES:
        if width < limit:
            return label
    return "desktop"


def family(value):
    """'iOS 18.6' -> 'iOS', 'Safari 18' -> 'Safari': versions are dropped."""
    words = [w for w in str(value).split() if not any(ch.isdigit() for ch in w)]
    return " ".join(words) or "?"


def ref_host(value):
    """A referrer reduced to its host, so no private link or query is stored."""
    text = str(value).strip()
    if not text:
        return ""
    host = urllib.parse.urlsplit(text if "//" in text else "//" + text).hostname or ""
    return host.removeprefix("www.")[:80]


def top_list(counts, key, limit):
    """[{key, views, visits}] by visits; ties by label so runs are stable."""
    ranked = sorted(counts.items(), key=lambda i: (-len(i[1][1]), -i[1][0], i[0]))
    return [{key: label, "views": views, "visits": len(sessions) or None}
            for label, (views, sessions) in ranked[:limit]]


def seconds_between(first, last):
    try:
        return (datetime.fromisoformat(last.replace("Z", "+00:00"))
                - datetime.fromisoformat(first.replace("Z", "+00:00"))).total_seconds()
    except ValueError:
        return 0


def visit_figures(entry):
    """Entry / exit pages, page-to-page steps, length and depth of the day's visits.

    Works on the visits in memory and keeps totals only: no single visit is stored.
    """
    durations = collections.Counter()
    depth = collections.Counter()
    total_seconds = 0
    for session, hits in entry["trails"].items():
        hits = sorted(hits)
        paths = [path for _, path in hits]
        for name, label in (("entries", paths[0]), ("exits", paths[-1])):
            entry[name][label][0] += 1
            entry[name][label][1].add(session)
        for before, after in zip(paths, paths[1:]):
            if before != after:
                step = entry["steps"]["%s -> %s" % (before[:70], after[:70])]
                step[0] += 1
                step[1].add(session)
        seconds = seconds_between(hits[0][0], hits[-1][0])
        total_seconds += seconds
        depth["5+" if len(hits) > 4 else str(len(hits))] += 1
        if len(hits) > 1:
            durations[next((label for limit, label in DURATION_STEPS if seconds < limit),
                           "> 1 h")] += 1
    visits = len(entry["trails"])
    return {
        "pages_per_visit": round(entry["pageviews"] / visits, 2) if visits else 0,
        "one_page_visits": depth["1"],
        "average_seconds": round(total_seconds / visits) if visits else 0,
        "durations": dict(durations),
        "depth": dict(depth),
    }


def aggregate(rows):
    """day -> {unique_visitors (= visits), pageviews, top_pages, details}."""
    days = {}
    for row in rows:
        stamp = column(row, "Date", "date", "created_at")
        day = local_day(stamp)
        if not day:
            continue
        entry = days.setdefault(day, {
            "pageviews": 0, "sessions": set(), "first_visits": 0, "bots": 0, "events": 0, "trails": {},
            **{name: tally() for name in BREAKDOWNS}})
        if is_true(column(row, "Bot", "bot")):
            entry["bots"] += 1
            continue
        path = column(row, "Path", "path") or "/"
        session = column(row, "Session", "session")
        entry["pageviews"] += 1
        entry["events"] += is_true(column(row, "Event"))
        if session:
            entry["sessions"].add(session)
            entry["trails"].setdefault(session, []).append((stamp, path[:MAX_LABEL]))
        if is_true(column(row, "FirstVisit", "first_visit")):
            entry["first_visits"] += 1
        labels = {
            "pages": path[:MAX_LABEL],
            "hours": hit_hour(stamp),
            "refs": ref_host(column(row, "Referrer", "ref")),
            "browsers": family(column(row, "Browser")),
            "browser_versions": str(column(row, "Browser"))[:40],
            "systems": family(column(row, "System")),
            "system_versions": str(column(row, "System"))[:40],
            "countries": str(column(row, "Location")).split("-")[0][:2] or "?",
            "regions": str(column(row, "Location"))[:12],
            "screens": screen_class(column(row, "Screen size", "size")),
            "screen_sizes": str(column(row, "Screen size", "size"))[:20],
        }
        for name, label in labels.items():
            if label in ("", None):
                continue
            entry[name][label][0] += 1
            if session:
                entry[name][label][1].add(session)

    result = {}
    for day, entry in days.items():
        # One session = one visit. FirstVisit (once per session and path) is only
        # the fallback for days without session ids.
        unique = len(entry["sessions"]) or entry["first_visits"]
        visit_totals = visit_figures(entry)
        pages = top_list(entry["pages"], "path", MAX_PAGES_PER_DAY)
        by_views = sorted(pages, key=lambda p: (-p["views"], p["path"]))
        result[day] = {
            "unique_visitors": unique,
            "pageviews": entry["pageviews"],
            "top_pages": [{"path": p["path"], "views": p["views"]}
                          for p in by_views[:TOP_PAGES_PER_DAY]],
            "details": {
                "page_visitors": entry["first_visits"],   # GoatCounter's own figure
                "bots": entry["bots"],
                "events": entry["events"],
                **visit_totals,
                "pages": pages,
                "hours": [[entry["hours"][h][0], len(entry["hours"][h][1])]
                          if h in entry["hours"] else [0, 0] for h in range(24)],
                **{name: top_list(entry[name], "name", MAX_LABELS_PER_DAY)
                   for name in LABEL_LISTS},
            },
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
        "  (day, unique_visitors, pageviews, top_pages, details, updated_at)\n"
        "select (r->>'day')::date, (r->>'unique_visitors')::int,\n"
        "       (r->>'pageviews')::int, r->'top_pages', r->'details', now()\n"
        "from jsonb_array_elements($gcpayload$%s$gcpayload$::jsonb) as r\n"
        "on conflict (day) do update set\n"
        "  unique_visitors = excluded.unique_visitors,\n"
        "  pageviews = excluded.pageviews,\n"
        "  top_pages = excluded.top_pages,\n"
        "  details = excluded.details,\n"
        "  updated_at = now()\n"
        # Old days do not change: rewriting 144 rows every hour only made bloat.
        "where (site_traffic.unique_visitors, site_traffic.pageviews,\n"
        "       site_traffic.top_pages, site_traffic.details)\n"
        "   is distinct from (excluded.unique_visitors, excluded.pageviews,\n"
        "       excluded.top_pages, excluded.details)\n"
        "   or site_traffic.day >= current_date - 1;\n" % json.dumps(payload)
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
    print("Stored %d days from %d pageviews. Latest %s: %d visits, %d views."
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
