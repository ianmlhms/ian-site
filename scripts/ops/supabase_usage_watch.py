#!/usr/bin/env python3
"""Supabase usage watchdog for ian.lu.

The free plan has 5 GB egress per billing cycle (21st to 21st), 2 M Realtime
messages, 500 MB database and 1 GB storage. The 21 Sep - 21 Oct 2026 cycle blew
through it (idle games posted scores every 0.8 s, messenger bridges polled), and
a project that stays over quota gets restricted. This script runs once an hour
on the Mac Mini (LaunchAgent lu.ian.supabase-usage, see
install_supabase_usage_watch.sh) and tells Ian in Slack #claude when usage is
heading for the limit, usually within hours of a bug appearing.

What it measures (all through the Management API with the personal access token
in ~/.supabase/access-token; the org usage endpoint that reports egress in GB
refuses a PAT):
  * Egress: an estimate built from the project's edge logs (REST, Storage, Auth,
    Functions), grouped per hour. Per request it adds up
      - the response body (Content-Length, summed exactly), or for responses
        without one (chunked) the average sized response, at least 1.5 KB;
        body-less ones (101, 204, 304, OPTIONS) count 0 body;
      - RESPONSE_OVERHEAD_BYTES of headers/framing per request. This matters:
        the 21 Sep - 21 Oct overrun was ~9 M tiny RPC calls whose bodies total
        only ~0.3 GB, yet the dashboard billed ~15 GB. 1500 B per request
        reproduces that (and the 2.4 GB peak day, 10 Oct, to within 25 %).
    Cloudflare cache HITs have their body subtracted (billed as cached egress).
    NOT included: Realtime websocket message traffic, which the logs do not size.
    So treat it as an estimate that tracks request volume closely, not the bill.
  * Requests per service, per hour (same logs; usage.api-counts as fallback).
  * Realtime: messages are not exposed to a PAT. Stand-in: row changes
    (insert/update/delete) on tables in the supabase_realtime publication,
    from pg_stat_user_tables, counted per run. That is messages x 1 subscriber,
    so a lower bound, and it only counts from the day the watchdog was installed.
  * Database size and Storage size, from the database itself.

Alerts (Slack #claude through ~/.claude-notify/notify.py; outcome first, short):
  projection  egress projected for the cycle end > 70 % of 5 GB
              (cycle-to-date + remaining days x last 72 h run-rate)
  spike24h    last 24 h egress or requests > 3 x the median of the same window
              over the previous 7 days
  spike3h     the same for the last 3 h (catches a runaway loop within hours)
  hard_*      egress / database / storage / realtime events >= 80 % of the limit
Each condition alerts once when it trips and sends one "all clear" when it has
been back under its release level for two runs in a row. A condition alerts at
most once per calendar day. A short digest goes out at 08:00 local only while
something is noteworthy. If the watchdog itself fails 3 runs in a row it says
so once.

The ops page gets a "supabase" heartbeat every run (status ok/warn/error plus a
one-line detail), shown as the third tile on ian.lu/ops.html.

Stdlib only, Python 3.9. Runs from a copy OUTSIDE OneDrive (launchd cannot read
OneDrive files). State: ~/Library/Application Support/ian-watchdog/usage_state.json,
log: ~/Library/Logs/ian-watchdog-usage.log.

Usage:
    supabase_usage_watch.py              one pass (what launchd runs)
    supabase_usage_watch.py --dry-run    collect + cache data, print what would be
                                         posted/beaten; send nothing, keep alert state
    supabase_usage_watch.py --simulate   no network: replay the cached data with a
                                         synthetic 3 h spike on top, print the alert
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------- configuration

PROJECT_REF = "lvksqmgfwkfbblfsozfk"
API_ROOT = "https://api.supabase.com/v1/projects/" + PROJECT_REF
HOME = Path.home()
TOKEN_PATH = HOME / ".supabase" / "access-token"
BEAT_ENV_PATH = HOME / ".config" / "ops-beat" / ".env"
NOTIFY_SCRIPT = HOME / ".claude-notify" / "notify.py"
STATE_DIR = HOME / "Library" / "Application Support" / "ian-watchdog"
STATE_PATH = STATE_DIR / "usage_state.json"
LOG_PATH = HOME / "Library" / "Logs" / "ian-watchdog-usage.log"

GIB = 1024 ** 3
MIB = 1024 ** 2
LIMIT_EGRESS = 5 * GIB
LIMIT_REALTIME = 2_000_000
LIMIT_DB = 500 * MIB
LIMIT_STORAGE = 1 * GIB

CYCLE_DAY = 21                      # billing cycle starts on the 21st, 00:00 UTC
PROJECTION_TRIP = 0.70              # projected egress / limit
PROJECTION_RELEASE = 0.60
HARD_TRIP = 0.80
HARD_RELEASE = 0.75
SPIKE_TRIP = 3.0                    # x the 7-day median
SPIKE_RELEASE = 2.0
SPIKE_FLOORS = {                    # ignore tiny absolute numbers
    24: {"egress": 100 * MIB, "requests": 50_000},
    3: {"egress": 40 * MIB, "requests": 6_000},
}
BASELINE_DAYS = 7
MIN_BASELINE_SAMPLES = 3
RUN_RATE_HOURS = 72
CLEAR_RUNS = 2
FAIL_ALERT_RUNS = 3
DIGEST_HOUR_LOCAL = 8
DIGEST_PROJECTION_FLOOR = 0.50

CHUNK_HOURS = 24                    # the logs endpoint answers at most 24 h per call
REFETCH_HOURS = 3                   # late-arriving log rows: always re-read the tail
KEEP_DAYS = 45
RUN_BUDGET_SECONDS = 20 * 60        # a first backfill continues on the next run
CHUNK_PAUSE_SECONDS = 2
HTTP_TIMEOUT_SECONDS = 90
HTTP_ATTEMPTS = 3
MAX_DETAIL_CHARS = 200

SERVICES = ("rest", "storage", "auth", "functions", "realtime", "other")
# Used when a service has too few sized responses to average (e.g. every auth
# response is chunked): a GoTrue token response is about 1.2 KB.
DEFAULT_UNSIZED_BYTES = {"rest": 1500, "storage": 20_000, "auth": 1200, "functions": 1000,
                         "realtime": 0, "other": 500}
MIN_SAMPLES_FOR_AVERAGE = 50
# Headers + framing the dashboard bills per response on top of the body. Calibrated
# on the 21 Sep - 21 Oct 2026 cycle: ~15 GB billed (Ian's dashboard screenshot, 18 Oct)
# over 9.1 M logged requests with 0.34 GB of bodies = 1.6 KB; the peak day 10 Oct
# (2.4 GB over 1.95 M requests) = 1.2 KB. Re-calibrate here if a cycle disagrees.
RESPONSE_OVERHEAD_BYTES = 1500
# Slots of one [service] entry in an hour bucket.
N_ALL, N_SIZED, BYTES_SIZED, N_UNSIZED, BYTES_HIT = range(5)

PATH = "log_attributes['request.path']"
CL = "log_attributes['response.headers.content_length']"
STATUS = "log_attributes['response.status_code']"
METHOD = "log_attributes['request.method']"
CACHE = "log_attributes['response.headers.cf_cache_status']"
SERVICE_SQL = (
    "multiIf(startsWith({p},'/rest/v1'),'rest',startsWith({p},'/storage/v1'),'storage',"
    "startsWith({p},'/auth/v1'),'auth',startsWith({p},'/realtime/v1'),'realtime',"
    "startsWith({p},'/functions/v1'),'functions','other')"
).format(p=PATH)
HOURLY_SQL = (
    "select toStartOfHour(timestamp) as h, {svc} as s, count() as n, "
    "countIf({cl}!='') as sized, sum(toUInt64OrZero({cl})) as bytes, "
    "countIf({cl}='' and {st} not in ('101','204','304') and {m} not in ('OPTIONS','HEAD')) as unsized, "
    "sumIf(toUInt64OrZero({cl}), {cache}='HIT') as hit "
    "from logs where {p}!='' group by h, s"
).format(svc=SERVICE_SQL, cl=CL, st=STATUS, m=METHOD, cache=CACHE, p=PATH)
TOP_PATHS_SQL = (
    "select {m} as m, {p} as p, count() as n, sum(toUInt64OrZero({cl})) as bytes "
    "from logs where {p}!='' group by m, p order by n desc limit 40"
).format(m=METHOD, p=PATH, cl=CL)
DB_SQL = (
    "select pg_database_size(current_database()) as db_bytes, "
    "(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects) as storage_bytes, "
    "(select coalesce(sum(s.n_tup_ins + s.n_tup_upd + s.n_tup_del),0) from pg_stat_user_tables s "
    "join pg_publication_tables p on p.schemaname = s.schemaname and p.tablename = s.relname "
    "and p.pubname = 'supabase_realtime') as rt_events"
)

UUID_PATTERN = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
LONG_NUMBER_PATTERN = re.compile(r"(?<=/)\d{3,}(?=/|$)")

State = Dict[str, Any]
Hours = Dict[str, Dict[str, List[int]]]


class WatchError(Exception):
    """A step failed in a way worth reporting; the message is safe to post."""


# -------------------------------------------------------------------- logging

LOG_PREFIX = ""     # "[dry-run] " / "[simulate] " so test runs are not mistaken for real ones in the log


def log(message: str) -> None:
    line = "{} {}{}".format(datetime.now().strftime("%Y-%m-%d %H:%M:%S"), LOG_PREFIX, message)
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass
    if sys.stdout.isatty():
        print(line)


def say(text: str) -> None:
    """Interactive output (dry-run / simulate reports)."""
    print(text)


# ----------------------------------------------------------------------- time

def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def hour_key(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H")


def key_to_dt(key: str) -> datetime:
    return datetime.strptime(key, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)


def floor_hour(moment: datetime) -> datetime:
    return moment.replace(minute=0, second=0, microsecond=0)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def cycle_bounds(now: datetime) -> Tuple[datetime, datetime]:
    """[start, end) of the billing cycle containing `now` (21st 00:00 UTC to the next 21st)."""
    this_month = now.replace(day=CYCLE_DAY, hour=0, minute=0, second=0, microsecond=0)
    start = this_month if now >= this_month else _shift_month(this_month, -1)
    return start, _shift_month(start, 1)


def _shift_month(moment: datetime, delta: int) -> datetime:
    month_index = moment.year * 12 + (moment.month - 1) + delta
    return moment.replace(year=month_index // 12, month=month_index % 12 + 1)


# ------------------------------------------------------------------------ HTTP

def read_token() -> str:
    try:
        token = TOKEN_PATH.read_text(encoding="utf-8").strip()
    except OSError as error:
        raise WatchError("cannot read the Supabase access token: {}".format(error.strerror)) from error
    if not token:
        raise WatchError("the Supabase access token file is empty")
    return token


def api_call(path: str, query: Optional[Dict[str, str]] = None, body: Optional[Dict[str, Any]] = None) -> Any:
    """GET (or POST with a JSON body) against the Management API with retries. Never logs the token."""
    url = API_ROOT + "/" + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    headers = {"Authorization": "Bearer " + read_token(), "User-Agent": "ian-usage-watch/1"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    last_error = "unknown error"
    for attempt in range(1, HTTP_ATTEMPTS + 1):
        request = urllib.request.Request(url, data=data, headers=headers, method="POST" if body is not None else "GET")
        try:
            with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
                payload = json.load(response)
            if isinstance(payload, dict) and payload.get("error"):
                raise WatchError("API said: {}".format(str(payload["error"])[:150]))
            return payload
        except urllib.error.HTTPError as error:
            last_error = "HTTP {} from {}".format(error.code, path.split("?")[0])
            if error.code in (400, 401, 403, 404):
                raise WatchError(last_error) from error     # retrying will not help
        except (urllib.error.URLError, OSError, ValueError) as error:
            last_error = "{}: {}".format(type(error).__name__, str(error)[:100])
        if attempt < HTTP_ATTEMPTS:
            time.sleep(5 * attempt * attempt)
    raise WatchError(last_error)


def query_logs(sql: str, start: datetime, end: datetime) -> List[Dict[str, Any]]:
    payload = api_call("analytics/endpoints/logs", {
        "sql": sql, "iso_timestamp_start": iso(start), "iso_timestamp_end": iso(end)})
    return list(payload.get("result") or [])


def query_database(sql: str) -> Dict[str, Any]:
    rows = api_call("database/query", body={"query": sql})
    if not isinstance(rows, list) or not rows:
        raise WatchError("database query returned no row")
    return rows[0]


# ---------------------------------------------------------------------- state

def empty_state() -> State:
    return {"version": 1, "hours": {}, "fetched_until": None, "snaps": [], "db": None,
            "alerts": {}, "baselined": False, "fail_streak": 0, "fail_alerted": False, "last_digest_day": None,
            "last_run": None, "last_error": None}


def load_state() -> State:
    try:
        loaded = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if isinstance(loaded, dict) and loaded.get("version") == 1:
            return {**empty_state(), **loaded}
    except (OSError, ValueError):
        pass
    return empty_state()


def save_state(state: State) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(dir=str(STATE_DIR), prefix=".usage_state.", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(state, stream, separators=(",", ":"))
        os.replace(temp_name, STATE_PATH)
    except OSError:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
        raise


# ----------------------------------------------------------------- collection

def parse_log_hour(text: str) -> datetime:
    return datetime.strptime(text[:13], "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)


def merge_window(hours: Hours, start: datetime, end: datetime, rows: List[Dict[str, Any]]) -> Hours:
    """New hours dict: every bucket in [start, end) replaced by `rows`."""
    kept = {key: value for key, value in hours.items() if not start <= key_to_dt(key) < end}
    fresh: Hours = {}
    for row in rows:
        service = row.get("s") if row.get("s") in SERVICES else "other"
        bucket = fresh.setdefault(hour_key(parse_log_hour(str(row["h"]))), {})
        slot = bucket.setdefault(service, [0, 0, 0, 0, 0])
        slot[N_ALL] += int(row.get("n") or 0)
        slot[N_SIZED] += int(row.get("sized") or 0)
        slot[BYTES_SIZED] += int(row.get("bytes") or 0)
        slot[N_UNSIZED] += int(row.get("unsized") or 0)
        slot[BYTES_HIT] += int(row.get("hit") or 0)
    return {**kept, **fresh}


def prune(hours: Hours, now: datetime) -> Hours:
    oldest = now - timedelta(days=KEEP_DAYS)
    return {key: value for key, value in hours.items() if key_to_dt(key) >= oldest}


def collect_logs(state: State, now: datetime, deadline: float) -> State:
    """Fetch every hour from the last checkpoint to now, oldest first. Checkpoints after each chunk."""
    cycle_start, _ = cycle_bounds(now)
    if state["fetched_until"]:
        start = key_to_dt(state["fetched_until"]) - timedelta(hours=REFETCH_HOURS)
    else:
        start = min(cycle_start, now - timedelta(days=BASELINE_DAYS + 1))   # cycle-to-date + spike baseline
    start = floor_hour(max(start, now - timedelta(days=KEEP_DAYS)))
    current = state
    while start < now and time.time() < deadline:
        end = min(start + timedelta(hours=CHUNK_HOURS), now)
        rows = query_logs(HOURLY_SQL, start, end)
        hours = merge_window(current["hours"], start, end, rows)
        current = {**current, "hours": hours, "fetched_until": hour_key(end)}
        log("logs {} -> {}: {} rows".format(iso(start), iso(end), len(rows)))
        save_state(current)
        start = end
        if start < now:
            time.sleep(CHUNK_PAUSE_SECONDS)
    return {**current, "hours": prune(current["hours"], now)}


def collect_database(state: State, now: datetime) -> State:
    row = query_database(DB_SQL)
    counter = int(row.get("rt_events") or 0)
    snaps = [snap for snap in state["snaps"] if snap[0] >= (now - timedelta(days=KEEP_DAYS)).timestamp()]
    snaps = snaps + [[int(now.timestamp()), counter]]
    db = {"db_bytes": int(row.get("db_bytes") or 0), "storage_bytes": int(row.get("storage_bytes") or 0)}
    return {**state, "snaps": snaps, "db": db}


def fetch_api_counts() -> Optional[Dict[str, int]]:
    """Requests in the last 24 h as the API counts them (fallback + sanity check)."""
    try:
        payload = api_call("analytics/endpoints/usage.api-counts", {"interval": "1day"})
    except WatchError as error:
        log("api-counts unavailable: {}".format(error))
        return None
    totals = {"rest": 0, "realtime": 0, "auth": 0, "storage": 0}
    for row in payload.get("result", []):
        for name in totals:
            totals[name] += int(row.get("total_{}_requests".format(name)) or 0)
    return totals


# ------------------------------------------------------------------- analysis

def average_unsized(hours: Hours) -> Dict[str, float]:
    sums = {service: [0, 0] for service in SERVICES}
    for bucket in hours.values():
        for service, slot in bucket.items():
            sums[service][0] += slot[BYTES_SIZED]
            sums[service][1] += slot[N_SIZED]
    result: Dict[str, float] = {}
    for service in SERVICES:
        total, count = sums[service]
        measured = total / count if count >= MIN_SAMPLES_FOR_AVERAGE else 0.0
        # Sized responses skew tiny (RPC returning void); chunked ones are usually bigger.
        result[service] = max(measured, float(DEFAULT_UNSIZED_BYTES[service]))
    return result


def window_keys(start: datetime, end: datetime) -> List[str]:
    """Hour keys of every hour bucket overlapping [start, end)."""
    keys, moment = [], floor_hour(start)
    while moment < end:
        keys.append(hour_key(moment))
        moment += timedelta(hours=1)
    return keys


def egress_of(bucket: Dict[str, List[int]], averages: Dict[str, float]) -> Dict[str, float]:
    return {service: max(0.0, slot[BYTES_SIZED] - slot[BYTES_HIT] + slot[N_UNSIZED] * averages[service]
                         + slot[N_ALL] * RESPONSE_OVERHEAD_BYTES)
            for service, slot in bucket.items()}


def window_totals(hours: Hours, start: datetime, end: datetime, averages: Dict[str, float]) -> Dict[str, Any]:
    egress_by_service = {service: 0.0 for service in SERVICES}
    requests_by_service = {service: 0 for service in SERVICES}
    cached = 0
    for key in window_keys(start, end):
        bucket = hours.get(key)
        if not bucket:
            continue
        for service, value in egress_of(bucket, averages).items():
            egress_by_service[service] += value
        for service, slot in bucket.items():
            requests_by_service[service] += slot[N_ALL]
            cached += slot[BYTES_HIT]
    return {"egress": sum(egress_by_service.values()), "egress_by_service": egress_by_service,
            "requests": sum(requests_by_service.values()), "requests_by_service": requests_by_service,
            "cached": cached}


def realtime_events(snaps: List[List[int]], since: datetime) -> int:
    """Row changes on realtime tables since `since`, summing positive counter steps (resets ignored)."""
    total, previous = 0, None
    for stamp, counter in snaps:
        if previous is not None and stamp >= since.timestamp():
            total += max(0, counter - previous)
        previous = counter
    return total


def baseline_median(hours: Hours, now: datetime, window_hours: int, metric: str,
                    averages: Dict[str, float]) -> Optional[float]:
    """Median of the same rolling window ending 24 h, 48 h, ... 7 d ago."""
    samples = []
    for day in range(1, BASELINE_DAYS + 1):
        end = now - timedelta(days=day)
        if hour_key(end - timedelta(hours=window_hours)) < min(hours, default="9"):
            continue                      # the data does not reach back that far
        totals = window_totals(hours, end - timedelta(hours=window_hours), end, averages)
        samples.append(totals[metric])
    return statistics.median(samples) if len(samples) >= MIN_BASELINE_SAMPLES else None


def analyse(state: State, now: datetime, api_counts: Optional[Dict[str, int]]) -> Dict[str, Any]:
    hours = state["hours"]
    averages = average_unsized(hours)
    cycle_start, cycle_end = cycle_bounds(now)
    cycle = window_totals(hours, cycle_start, now, averages)
    last24 = window_totals(hours, now - timedelta(hours=24), now, averages)
    recent = window_totals(hours, now - timedelta(hours=RUN_RATE_HOURS), now, averages)
    elapsed_days = max((now - cycle_start).total_seconds() / 86400, 1e-6)
    remaining_days = max((cycle_end - now).total_seconds() / 86400, 0.0)
    cycle_days = (cycle_end - cycle_start).total_seconds() / 86400
    run_rate_daily = recent["egress"] / (RUN_RATE_HOURS / 24)
    projected = cycle["egress"] + run_rate_daily * remaining_days
    linear = cycle["egress"] / elapsed_days * cycle_days

    spikes = {}
    for window in (24, 3):
        current = window_totals(hours, now - timedelta(hours=window), now, averages)
        for metric in ("egress", "requests"):
            base = baseline_median(hours, now, window, metric, averages)
            spikes[(window, metric)] = {"value": current[metric], "median": base,
                                        "floor": SPIKE_FLOORS[window][metric]}
    first_snap = state["snaps"][0][0] if state["snaps"] else None
    db = state.get("db") or {}
    stale_hours = None
    if state["fetched_until"]:
        stale_hours = (now - key_to_dt(state["fetched_until"])).total_seconds() / 3600
    return {
        "now": now, "cycle_start": cycle_start, "cycle_end": cycle_end, "cycle": cycle, "last24": last24,
        "recent": recent, "elapsed_days": elapsed_days, "remaining_days": remaining_days,
        "run_rate_daily": run_rate_daily, "projected": projected, "linear": linear, "spikes": spikes,
        "rt_events": realtime_events(state["snaps"], cycle_start),
        "rt_tracked_since": datetime.fromtimestamp(first_snap, timezone.utc) if first_snap else None,
        "db_bytes": db.get("db_bytes"), "storage_bytes": db.get("storage_bytes"),
        "stale_hours": stale_hours, "api_counts": api_counts, "averages": averages,
    }


# ----------------------------------------------------------------- conditions

def hysteresis(value: Optional[float], trip: float, release: float, was_active: bool) -> bool:
    if value is None:
        return was_active
    return value > release if was_active else value > trip


def evaluate_conditions(report: Dict[str, Any], alerts: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """key -> {active: bool, text: str, value: float} for every watched condition."""
    def was(key: str) -> bool:
        return bool(alerts.get(key, {}).get("active"))

    conditions: Dict[str, Dict[str, Any]] = {}
    fraction = report["projected"] / LIMIT_EGRESS
    conditions["projection"] = {
        "active": hysteresis(fraction, PROJECTION_TRIP, PROJECTION_RELEASE, was("projection")),
        "value": fraction,
        "text": "egress on track for {} of 5 GB this cycle ({:.0f} %), {} used so far, run-rate {}/day".format(
            fmt_bytes(report["projected"]), fraction * 100, fmt_bytes(report["cycle"]["egress"]),
            fmt_bytes(report["run_rate_daily"])),
        "ok_text": "egress projection back to {} of 5 GB ({:.0f} %)".format(fmt_bytes(report["projected"]), fraction * 100),
    }
    for window in (24, 3):
        key = "spike{}h".format(window)
        worst = None
        for metric in ("egress", "requests"):
            info = report["spikes"][(window, metric)]
            if info["median"] is None:
                continue
            # A floor keeps a near-zero baseline from turning noise into a "100x spike".
            normal = max(info["median"], info["floor"] / SPIKE_TRIP)
            ratio = info["value"] / normal
            if worst is None or ratio > worst[1]:
                worst = (metric, ratio, info, normal)
        active, text, ratio_value = False, "no baseline yet", None
        if worst:
            metric, ratio, info, normal = worst
            active = hysteresis(ratio, SPIKE_TRIP, SPIKE_RELEASE, was(key))
            ratio_value = ratio
            show = fmt_count if metric == "requests" else fmt_bytes
            text = "last {} h {} {} vs {} normal ({:.0f}x)".format(window, show(info["value"]), metric, show(normal), ratio)
        conditions[key] = {"active": active, "value": ratio_value, "text": text,
                           "ok_text": "last {} h back to normal".format(window)}
    hard = (("egress", report["cycle"]["egress"], LIMIT_EGRESS, "egress", True),
            ("db", report["db_bytes"], LIMIT_DB, "database", True),
            ("storage", report["storage_bytes"], LIMIT_STORAGE, "storage", True),
            ("realtime", report["rt_events"], LIMIT_REALTIME, "realtime events", False))
    for name, value, limit, label, is_bytes in hard:
        key = "hard_" + name
        share = (value / limit) if value is not None else None
        shown = fmt_bytes(value) if is_bytes and value is not None else fmt_count(value or 0)
        shown_limit = fmt_bytes(limit) if is_bytes else fmt_count(limit)
        conditions[key] = {
            "active": hysteresis(share, HARD_TRIP, HARD_RELEASE, was(key)), "value": share,
            "text": "{} at {:.0f} % of the free limit ({} of {})".format(label, (share or 0) * 100, shown, shown_limit),
            "ok_text": "{} back to {:.0f} % of the limit".format(label, (share or 0) * 100)}
    return conditions


def overall_status(report: Dict[str, Any], conditions: Dict[str, Dict[str, Any]]) -> Tuple[str, Optional[str]]:
    """('ok'|'warn'|'error', reason) for the ops tile. error = a hard limit is already crossed."""
    shares = [(report["cycle"]["egress"] / LIMIT_EGRESS, "egress"),
              ((report["db_bytes"] or 0) / LIMIT_DB, "database"),
              ((report["storage_bytes"] or 0) / LIMIT_STORAGE, "storage"),
              (report["rt_events"] / LIMIT_REALTIME, "realtime")]
    for share, label in shares:
        if share >= 1.0:
            return "error", "{} over the free limit ({:.0f} %)".format(label, share * 100)
    active = [value["text"] for value in conditions.values() if value["active"]]
    if active:
        return "warn", active[0]
    return "ok", None


# ------------------------------------------------------------------ formatting

def fmt_bytes(value: Optional[float]) -> str:
    if value is None:
        return "n/a"
    if value >= GIB:
        return "{:.2f} GB".format(value / GIB)
    if value >= MIB:
        return "{:.0f} MB".format(value / MIB)
    return "{:.0f} KB".format(value / 1024)


def fmt_count(value: Optional[float]) -> str:
    if value is None:
        return "n/a"
    if value >= 1_000_000:
        return "{:.1f}M".format(value / 1_000_000)
    if value >= 10_000:
        return "{:.0f}k".format(value / 1000)
    if value >= 1000:
        return "{:.1f}k".format(value / 1000)
    return "{:.0f}".format(value)


def tile_detail(report: Dict[str, Any]) -> str:
    text = "egress {}/5 GB, proj {} | 24h {} req, {} | DB {}/500 MB".format(
        fmt_bytes(report["cycle"]["egress"]).replace(" GB", ""), fmt_bytes(report["projected"]),
        fmt_count(report["last24"]["requests"]), fmt_bytes(report["last24"]["egress"]),
        fmt_bytes(report["db_bytes"]).replace(" MB", ""))
    return text[:MAX_DETAIL_CHARS]


def normalise_path(method: str, path: str) -> str:
    path = UUID_PATTERN.sub(":id", path)
    path = LONG_NUMBER_PATTERN.sub(":n", path)
    parts = path.split("/")
    if len(parts) > 6:
        path = "/".join(parts[:6]) + "/..."
    return "{} {}".format(method, path)[:70]


def top_paths(start: datetime, end: datetime, simulated: bool = False) -> str:
    if simulated:
        return "POST /rest/v1/rpc/save_score (simulated)"
    try:
        rows = query_logs(TOP_PATHS_SQL, start, end)
    except WatchError as error:
        return "(top paths unavailable: {})".format(error)
    merged: Dict[str, int] = {}
    for row in rows:
        label = normalise_path(str(row.get("m", "")), str(row.get("p", "")))
        merged[label] = merged.get(label, 0) + int(row.get("n") or 0)
    ranked = sorted(merged.items(), key=lambda pair: -pair[1])[:3]
    return "; ".join("{} x{}".format(label, fmt_count(count)) for label, count in ranked) or "(none)"


def biggest_service(report: Dict[str, Any]) -> str:
    by_service = report["cycle"]["egress_by_service"]
    total = sum(by_service.values()) or 1.0
    name = max(by_service, key=lambda service: by_service[service])
    return "{} {:.0f} %".format(name, by_service[name] / total * 100)


# -------------------------------------------------------------------- outputs

def post_slack(text: str, dry_run: bool) -> bool:
    if dry_run:
        say("WOULD POST TO SLACK #claude:\n  " + text.replace("\n", "\n  "))
        return True
    try:
        result = subprocess.run(["/usr/bin/python3", "-I", str(NOTIFY_SCRIPT), text],
                                capture_output=True, text=True, timeout=90, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        log("slack failed: {}".format(error))
        return False
    if result.returncode != 0:
        log("slack exited {}: {}".format(result.returncode, result.stderr.strip()[:150]))
    return result.returncode == 0


def load_env(path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.strip().partition("=")
        if separator and not key.startswith("#"):
            values[key.strip()] = value.strip().strip('"')
    return values


def send_beat(status: str, detail: str, message: Optional[str], dry_run: bool) -> None:
    if dry_run:
        say("WOULD BEAT supabase: status={} detail={!r} message={!r}".format(status, detail, message))
        return
    try:
        env = load_env(BEAT_ENV_PATH)
        base_url, anon_key, secret = env["SUPABASE_URL"], env["SUPABASE_ANON_KEY"], env["OPS_BEAT_SECRET"]
    except (OSError, KeyError) as error:
        log("beat skipped: {}".format(type(error).__name__))
        return
    body = {"action": "beat", "service": "supabase", "detail": detail, "status": status}
    if message:
        body["message"] = message[:MAX_DETAIL_CHARS]
    request = urllib.request.Request(
        base_url.rstrip("/") + "/functions/v1/ops", data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"apikey": anon_key, "content-type": "application/json", "x-beat-secret": secret})
    try:
        with urllib.request.urlopen(request, timeout=30):
            log("beat ok ({})".format(status))
    except urllib.error.HTTPError as error:
        log("beat refused: HTTP {} (ops function not updated yet?)".format(error.code))
    except (urllib.error.URLError, OSError) as error:
        log("beat failed: {}".format(type(error).__name__))


# ------------------------------------------------------------------ alert flow

def local_day(moment: datetime) -> str:
    return moment.astimezone().strftime("%Y-%m-%d")


def plan_alerts(conditions: Dict[str, Dict[str, Any]], previous: Dict[str, Any], now: datetime,
                simulated: bool) -> Tuple[Dict[str, Any], List[Tuple[str, str]], List[str]]:
    """(new alert state, [(key, alert line)], [all-clear line]). Nothing is marked announced yet."""
    alerts = {key: dict(value) for key, value in previous.items()}
    today = local_day(now)
    fire: List[Tuple[str, str]] = []
    clear: List[str] = []
    for key, condition in conditions.items():
        entry = alerts.get(key) or {"active": False, "clear_runs": 0, "last_sent_day": None, "announced": False}
        if condition["active"]:
            entry["clear_runs"] = 0
            if not entry["active"]:
                entry["active"], entry["since"] = True, iso(now)
            # Once per condition per calendar day, even if it flaps.
            if not entry["announced"] and entry.get("last_sent_day") != today:
                fire.append((key, condition["text"]))
        elif entry["active"]:
            entry["clear_runs"] += 1
            if entry["clear_runs"] >= CLEAR_RUNS:
                entry["active"] = False
                if entry["announced"]:
                    clear.append(condition["ok_text"])
                entry["announced"] = False
        alerts[key] = entry
    return alerts, fire, clear


def alert_line(key: str, text: str, report: Dict[str, Any], now: datetime, simulated: bool) -> str:
    if key.startswith("spike"):
        window = int(key[5:-1])
        return "Supabase spike: {}. Top: {}".format(text, top_paths(now - timedelta(hours=window), now, simulated))
    if key == "projection":
        return "Supabase: {}. Biggest: {}".format(text, biggest_service(report))
    return "Supabase: " + text


def mark_announced(alerts: Dict[str, Any], keys: List[str], today: str) -> Dict[str, Any]:
    updated = {key: dict(value) for key, value in alerts.items()}
    for key in keys:
        updated[key]["announced"] = True
        updated[key]["last_sent_day"] = today
    return updated


def digest_text(report: Dict[str, Any], conditions: Dict[str, Dict[str, Any]]) -> Optional[str]:
    active = [value["text"] for value in conditions.values() if value["active"]]
    noteworthy = bool(active) or report["projected"] / LIMIT_EGRESS >= DIGEST_PROJECTION_FLOOR
    if not noteworthy:
        return None
    lead = "Supabase daily: " + ("; ".join(active) if active else
                                  "egress {} of 5 GB projected".format(fmt_bytes(report["projected"])))
    return "{}\nEgress {} of 5 GB so far (day {} of {}), last 24 h {} / {} requests, DB {}.".format(
        lead, fmt_bytes(report["cycle"]["egress"]), int(report["elapsed_days"]) + 1,
        (report["cycle_end"] - report["cycle_start"]).days, fmt_bytes(report["last24"]["egress"]),
        fmt_count(report["last24"]["requests"]), fmt_bytes(report["db_bytes"]))


def print_report(report: Dict[str, Any], conditions: Dict[str, Dict[str, Any]]) -> None:
    cycle, last24 = report["cycle"], report["last24"]
    say("cycle {} -> {}  (day {:.1f}, {:.1f} left)".format(
        report["cycle_start"].strftime("%d %b"), report["cycle_end"].strftime("%d %b"),
        report["elapsed_days"], report["remaining_days"]))
    say("egress so far : {} of 5 GB ({:.0f} %)   cached (not counted): {}".format(
        fmt_bytes(cycle["egress"]), cycle["egress"] / LIMIT_EGRESS * 100, fmt_bytes(cycle["cached"])))
    say("  by service  : " + ", ".join("{} {}".format(s, fmt_bytes(v)) for s, v in
                                       sorted(cycle["egress_by_service"].items(), key=lambda p: -p[1]) if v))
    say("projection   : {} ({:.0f} %) at the last {} h run-rate of {}/day;  plain linear: {}".format(
        fmt_bytes(report["projected"]), report["projected"] / LIMIT_EGRESS * 100, RUN_RATE_HOURS,
        fmt_bytes(report["run_rate_daily"]), fmt_bytes(report["linear"])))
    say("requests     : cycle " + ", ".join("{} {}".format(s, fmt_count(v)) for s, v in
                                          cycle["requests_by_service"].items() if v))
    say("last 24 h    : {} requests, {} egress; api-counts says {}".format(
        fmt_count(last24["requests"]), fmt_bytes(last24["egress"]),
        "n/a" if not report["api_counts"] else fmt_count(sum(report["api_counts"].values()))))
    since = report["rt_tracked_since"]
    say("realtime     : {} row-change events since {} (lower bound for messages; limit 2M)".format(
        fmt_count(report["rt_events"]), since.strftime("%d %b %H:%M") if since else "n/a"))
    say("database     : {} of 500 MB;  storage {} of 1 GB".format(
        fmt_bytes(report["db_bytes"]), fmt_bytes(report["storage_bytes"])))
    for (window, metric), info in sorted(report["spikes"].items(), reverse=True):
        show = fmt_count if metric == "requests" else fmt_bytes
        say("spike {:>2} h {:<8}: now {:>10}  7-day median {:>10}".format(
            window, metric, show(info["value"]), "n/a" if info["median"] is None else show(info["median"])))
    say("conditions   : " + ", ".join("{}={}".format(k, "ON" if v["active"] else "off") for k, v in conditions.items()))


# ------------------------------------------------------------------- the run

def inject_spike(state: State, now: datetime) -> State:
    """Simulation: three hours of a runaway client (score sync every 0.8 s = 4500 req/h per client)."""
    hours = dict(state["hours"])
    for back in range(3):
        key = hour_key(now - timedelta(hours=back))
        bucket = {service: list(slot) for service, slot in hours.get(key, {}).items()}
        rest = bucket.setdefault("rest", [0, 0, 0, 0, 0])
        rest[N_ALL] += 40_000
        rest[N_SIZED] += 40_000
        rest[BYTES_SIZED] += 40_000 * 1800
        hours[key] = bucket
    return {**state, "hours": hours}


def run(dry_run: bool, simulate: bool) -> int:
    now = utc_now()
    state = load_state()
    deadline = time.time() + RUN_BUDGET_SECONDS
    errors: List[str] = []
    api_counts = None

    if simulate:
        state = inject_spike(state, now)
    else:
        try:
            state = collect_logs(state, now, deadline)
        except WatchError as error:
            errors.append("logs: {}".format(error))
        try:
            state = collect_database(state, now)
        except WatchError as error:
            errors.append("database: {}".format(error))
        api_counts = fetch_api_counts()
        if not state["hours"]:
            errors.append("no usage data collected yet")

    state = {**state, "last_run": iso(now)}
    logs_failed = any(item.startswith("logs:") or item.startswith("no usage") for item in errors)
    state = {**state, "fail_streak": (state["fail_streak"] + 1) if logs_failed else 0,
             "last_error": "; ".join(errors) or None}
    if errors:
        log("problems: " + " | ".join(errors))

    report = analyse(state, now, api_counts)
    if report["stale_hours"] is not None and report["stale_hours"] > 3 and not simulate:
        log("usage data is {:.1f} h old".format(report["stale_hours"]))

    conditions = evaluate_conditions(report, state["alerts"])
    quiet = dry_run or simulate
    if dry_run or simulate:
        print_report(report, conditions)

    alerts, fire, clear = plan_alerts(conditions, state["alerts"], now, simulate)
    today = local_day(now)
    if not state["baselined"] and not simulate:
        # First ever run: whatever is already wrong is known news; the 08:00 digest covers it.
        fire, clear = [], []
        # active + "announced" False + sent today: stays quiet today, and clearing is silent.
        for key, cond in conditions.items():
            if cond["active"]:
                alerts[key] = {**alerts[key], "last_sent_day": today}
        state = {**state, "baselined": True, "last_digest_day": today}
        log("first run: baseline recorded, no alerts sent")
    fired = {key for key, _ in fire}
    # One spike line is enough: the 3 h alert says it sooner and the 24 h one adds nothing.
    shown = [(key, text) for key, text in fire if not (key == "spike24h" and "spike3h" in fired)]
    lines = [alert_line(key, text, report, now, simulate) for key, text in shown]
    lines += ["Supabase all clear: " + text for text in clear]
    sent_ok = True
    if lines:
        sent_ok = post_slack("\n".join(lines), quiet)
    if sent_ok:
        alerts = mark_announced(alerts, [key for key, _ in fire], today)
    else:
        alerts = state["alerts"]                # nothing recorded: the next run retries

    local_now = now.astimezone()
    if (not lines and local_now.hour >= DIGEST_HOUR_LOCAL and state["last_digest_day"] != today
            and not logs_failed):
        digest = digest_text(report, evaluate_conditions(report, alerts))
        if digest and post_slack(digest, quiet):
            state = {**state, "last_digest_day": today}

    if state["fail_streak"] >= FAIL_ALERT_RUNS and not state["fail_alerted"]:
        text = "Supabase usage watchdog has failed {} runs in a row ({}). Log: ~/Library/Logs/ian-watchdog-usage.log".format(
            state["fail_streak"], state["last_error"] or "unknown error")
        if post_slack(text, quiet):
            state = {**state, "fail_alerted": True}
    elif state["fail_streak"] == 0 and state["fail_alerted"]:
        if post_slack("Supabase usage watchdog is working again.", quiet):
            state = {**state, "fail_alerted": False}

    status, reason = overall_status(report, evaluate_conditions(report, alerts))
    if logs_failed:
        status, reason = "warn", "watchdog cannot read usage: {}".format(state["last_error"])
    send_beat(status, tile_detail(report), reason, quiet)
    log("status={} egress={} projected={} 24h_req={} fails={}".format(
        status, fmt_bytes(report["cycle"]["egress"]), fmt_bytes(report["projected"]),
        fmt_count(report["last24"]["requests"]), state["fail_streak"]))

    if simulate:
        return 0
    final = {**state, "alerts": alerts} if not dry_run else \
        {**load_state(), "hours": state["hours"], "fetched_until": state["fetched_until"],
         "snaps": state["snaps"], "db": state["db"]}
    save_state(final)
    return 0


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dry-run", action="store_true",
                        help="collect and cache data, print what would be posted; send nothing, keep alert state")
    parser.add_argument("--simulate", action="store_true",
                        help="no network: replay cached data with a synthetic 3 h spike and print the alert")
    args = parser.parse_args(argv)
    global LOG_PREFIX
    LOG_PREFIX = "[simulate] " if args.simulate else "[dry-run] " if args.dry_run else ""
    try:
        return run(args.dry_run, args.simulate)
    except Exception as error:  # noqa: BLE001 - last-resort: record the failure in state so the streak counts
        log("run crashed: {}: {}".format(type(error).__name__, str(error)[:200]))
        if not args.simulate and not args.dry_run:
            state = load_state()
            state = {**state, "fail_streak": state["fail_streak"] + 1, "last_error": str(error)[:150]}
            if state["fail_streak"] >= FAIL_ALERT_RUNS and not state["fail_alerted"]:
                text = "Supabase usage watchdog has failed {} runs in a row ({}). Log: ~/Library/Logs/ian-watchdog-usage.log".format(
                    state["fail_streak"], state["last_error"])
                if post_slack(text, False):
                    state = {**state, "fail_alerted": True}
            save_state(state)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
