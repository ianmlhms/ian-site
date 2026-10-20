#!/usr/bin/env python3
"""Tests for supabase_usage_watch.py. Run:  python3 scripts/ops/test_supabase_usage_watch.py

No network, no Slack, no real state: every path the script writes is redirected to
a temp dir and every outgoing call is replaced."""

import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import supabase_usage_watch as w  # noqa: E402

NOON = datetime(2026, 10, 25, 12, 30, tzinfo=timezone.utc)


def quiet_hours(now, per_hour_requests=900, bytes_per_response=10):
    """30 days of an idle site."""
    hours = {}
    moment = w.floor_hour(now) - timedelta(days=30)
    while moment <= now:
        hours[w.hour_key(moment)] = {"rest": [per_hour_requests, per_hour_requests,
                                              per_hour_requests * bytes_per_response, 0, 0]}
        moment += timedelta(hours=1)
    return hours


class Harness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.saved = {name: getattr(w, name) for name in
                      ("STATE_DIR", "STATE_PATH", "LOG_PATH", "BEAT_ENV_PATH", "post_slack", "api_call",
                       "utc_now", "top_paths")}
        w.STATE_DIR, w.STATE_PATH = base, base / "state.json"
        w.LOG_PATH, w.BEAT_ENV_PATH = base / "log", base / "no-env"
        self.posts = []
        w.post_slack = lambda text, dry: self.posts.append(text) or True
        w.top_paths = lambda *args, **kwargs: "POST /rest/v1/rpc/x x1"
        w.utc_now = lambda: self.now
        self.now = NOON

    def tearDown(self):
        for name, value in self.saved.items():
            setattr(w, name, value)
        self.tmp.cleanup()


class CycleTests(unittest.TestCase):
    def test_cycle_starts_on_the_21st(self):
        start, end = w.cycle_bounds(datetime(2026, 10, 20, 23, tzinfo=timezone.utc))
        self.assertEqual((start.month, start.day, end.month, end.day), (9, 21, 10, 21))
        start, end = w.cycle_bounds(datetime(2026, 10, 21, 0, tzinfo=timezone.utc))
        self.assertEqual((start.month, start.day, end.month, end.day), (10, 21, 11, 21))
        start, end = w.cycle_bounds(datetime(2027, 1, 5, tzinfo=timezone.utc))
        self.assertEqual((start.year, start.month, end.year, end.month), (2026, 12, 2027, 1))


class AnalysisTests(Harness):
    def state_with(self, hours):
        return {**w.empty_state(), "hours": hours, "fetched_until": w.hour_key(self.now)}

    def test_idle_site_is_quiet(self):
        report = w.analyse(self.state_with(quiet_hours(self.now)), self.now, None)
        conditions = w.evaluate_conditions(report, {})
        self.assertFalse(any(c["active"] for c in conditions.values()), conditions)
        # 900 req/h * 1.5 KB overhead * 24 h is ~32 MB/day
        self.assertAlmostEqual(report["last24"]["egress"] / w.MIB, 33, delta=3)

    def test_runaway_loop_trips_the_3h_spike_within_hours(self):
        hours = quiet_hours(self.now)
        for back in range(3):                       # 0.8 s score sync = 4500 req/h per client
            hours[w.hour_key(self.now - timedelta(hours=back))]["rest"][w.N_ALL] += 40_000
        report = w.analyse(self.state_with(hours), self.now, None)
        conditions = w.evaluate_conditions(report, {})
        self.assertTrue(conditions["spike3h"]["active"])
        self.assertIn("requests", conditions["spike3h"]["text"])

    def test_projection_alerts_before_the_limit_is_reached(self):
        hours = quiet_hours(self.now)
        for key in list(hours)[-24 * 5:]:           # five heavy days: ~150 k requests/day
            hours[key]["rest"][w.N_ALL] = 6_500
        report = w.analyse(self.state_with(hours), self.now, None)
        self.assertGreater(report["projected"], 0.7 * w.LIMIT_EGRESS)
        self.assertLess(report["cycle"]["egress"], 0.8 * w.LIMIT_EGRESS)
        self.assertTrue(w.evaluate_conditions(report, {})["projection"]["active"])

    def test_realtime_events_ignore_counter_resets(self):
        snaps = [[100, 1000], [200, 1500], [300, 20], [400, 70]]
        since = datetime.fromtimestamp(0, timezone.utc)
        self.assertEqual(w.realtime_events(snaps, since), 500 + 0 + 50)


class AlertFlowTests(Harness):
    def conditions(self, active):
        return {"projection": {"active": active, "text": "egress on track for 4 GB", "ok_text": "back to 2 GB"}}

    def step(self, active, previous):
        alerts, fire, clear = w.plan_alerts(self.conditions(active), previous, self.now, False)
        return alerts, fire, clear

    def test_alert_once_then_all_clear_after_two_quiet_runs(self):
        alerts, fire, clear = self.step(True, {})
        self.assertEqual(len(fire), 1)
        alerts = w.mark_announced(alerts, ["projection"], w.local_day(self.now))
        alerts, fire, clear = self.step(True, alerts)           # still on: silent
        self.assertEqual((fire, clear), ([], []))
        alerts, fire, clear = self.step(False, alerts)          # first quiet run: wait
        self.assertEqual((fire, clear), ([], []))
        alerts, fire, clear = self.step(False, alerts)          # second: all clear
        self.assertEqual(clear, ["back to 2 GB"])
        alerts, fire, clear = self.step(False, alerts)
        self.assertEqual((fire, clear), ([], []))

    def test_a_flapping_condition_alerts_once_per_day(self):
        alerts, fire, _ = self.step(True, {})
        alerts = w.mark_announced(alerts, ["projection"], w.local_day(self.now))
        for _ in range(2):
            alerts, _, clear = self.step(False, alerts)
        self.assertEqual(len(clear), 1)
        alerts, fire, _ = self.step(True, alerts)               # trips again the same day
        self.assertEqual(fire, [])
        self.now += timedelta(days=1)
        alerts, fire, _ = self.step(True, alerts)               # next day: allowed again
        self.assertEqual(len(fire), 1)


class RunTests(Harness):
    def test_watchdog_failing_three_runs_alerts_exactly_once(self):
        def broken(*args, **kwargs):
            raise w.WatchError("HTTP 500 from analytics/endpoints/logs")
        w.api_call = broken
        w.time.sleep = lambda *_: None
        for attempt in range(1, 6):
            self.now += timedelta(hours=1)
            w.run(False, False)
            watchdog_posts = [p for p in self.posts if "watchdog has failed" in p]
            self.assertEqual(len(watchdog_posts), 0 if attempt < 3 else 1, (attempt, self.posts))

    def test_first_run_is_silent_even_when_over_quota(self):
        hours = quiet_hours(self.now)
        for key in list(hours)[-24 * 8:]:
            hours[key]["rest"][w.N_ALL] = 40_000
        w.save_state({**w.empty_state(), "hours": hours, "fetched_until": w.hour_key(self.now)})
        w.api_call = lambda *args, **kwargs: {"result": []}
        w.run(False, False)
        self.assertEqual(self.posts, [])
        self.assertTrue(w.load_state()["baselined"])


if __name__ == "__main__":
    unittest.main()
