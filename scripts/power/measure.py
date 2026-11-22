#!/usr/bin/env python3
"""Measures one browser test job on the Mac mini: wall time, peak real memory of the whole process tree, CPU.

    python3 scripts/power/measure.py --label baseline:ski --out results.jsonl [--cwd DIR] [--env K=V ...] -- node scripts/flows/ski.mjs

The job runs through the shared guard (python3 ~/Library/Caches/browser-slot.py), wrapped in /usr/bin/time -l, so:
- wall / CPU seconds come from /usr/bin/time (user + sys of the whole reaped tree; slot waiting is not counted),
- peak memory is the sum of top's MEM (real footprint incl. compressed; ps rss under-counts Chrome ~3x) over the tree,
  sampled every ~2 s (top -l 2: the second sample also gives a real %CPU per process),
- pass = exit code 0. One JSON line per run is appended to --out; the job's output goes to <out dir>/logs/<label>.log.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

SLOT = os.path.expanduser("~/Library/Caches/browser-slot.py")
LOAD_MAX = 30          # task rule: never start a browser job while the 1-min load is above 30
UNITS = {"K": 1 / 1024, "M": 1, "G": 1024, "B": 1 / 1048576}


def parse_mem(value):
    value = value.rstrip("+-")
    try:
        return float(value[:-1]) * UNITS[value[-1]] if value[-1] in UNITS else float(value) / 1048576
    except (ValueError, IndexError, KeyError):
        return 0.0


def top_sample():
    """{pid: (ppid, mem_mb, cpu_pct, command)} from the second of two top samples (the first has no %CPU)."""
    out = subprocess.run(["top", "-l", "2", "-s", "1", "-stats", "pid,ppid,mem,cpu,command"],
                         capture_output=True, text=True, timeout=60).stdout
    blocks = out.split("PID ")
    rows = {}
    for line in blocks[-1].splitlines()[1:]:
        parts = line.split(None, 4)
        if len(parts) < 4:
            continue
        try:
            rows[int(parts[0])] = (int(parts[1]), parse_mem(parts[2]), float(parts[3]), parts[4] if len(parts) > 4 else "")
        except ValueError:
            continue
    return rows


def tree(root, rows):
    kids = {}
    for pid, (ppid, *_rest) in rows.items():
        kids.setdefault(ppid, []).append(pid)
    todo, seen = [root], []
    while todo:
        pid = todo.pop()
        seen.append(pid)
        todo.extend(kids.get(pid, []))
    return [pid for pid in seen if pid in rows]


def wait_for_load():
    while os.getloadavg()[0] > LOAD_MAX:
        print("[measure] load %.0f > %d, waiting ..." % (os.getloadavg()[0], LOAD_MAX), file=sys.stderr, flush=True)
        time.sleep(30)


def time_l(text):
    """real / user / sys seconds and max rss from /usr/bin/time -l output (macOS format)."""
    found = {}
    match = re.search(r"([\d.]+) real\s+([\d.]+) user\s+([\d.]+) sys", text)
    if match:
        found["real_s"], found["user_s"], found["sys_s"] = (float(g) for g in match.groups())
    match = re.search(r"(\d+)\s+maximum resident set size", text)
    if match:
        found["max_single_rss_mb"] = int(match.group(1)) / 1048576
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--cwd", default=os.getcwd())
    parser.add_argument("--env", action="append", default=[])
    parser.add_argument("--no-slot", action="store_true", help="Node-only jobs (no browser) may skip the browser slot")
    parser.add_argument("cmd", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    cmd = args.cmd[1:] if args.cmd[:1] == ["--"] else args.cmd
    env = dict(os.environ)
    env.update(kv.split("=", 1) for kv in args.env)
    log_dir = os.path.join(os.path.dirname(os.path.abspath(args.out)), "logs")
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, re.sub(r"[^\w.-]+", "_", args.label) + ".log")

    wait_for_load()
    full = ([] if args.no_slot else ["python3", SLOT]) + ["/usr/bin/time", "-l"] + cmd
    load_start = os.getloadavg()[0]
    with open(log_path, "w") as log:
        proc = subprocess.Popen(full, cwd=args.cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
        peak_mb, peak_procs, cpu_samples, peak_top = 0.0, 0, [], []
        while proc.poll() is None:
            rows = top_sample()
            pids = tree(proc.pid, rows)
            if len(pids) > (1 if args.no_slot else 3):          # slot + time + node (+ browser) are up: the job runs
                mem = sum(rows[p][1] for p in pids)
                cpu_samples.append(sum(rows[p][2] for p in pids))
                if mem > peak_mb:
                    peak_mb, peak_procs = mem, len(pids)
                    peak_top = sorted(((rows[p][1], rows[p][3][:40]) for p in pids), reverse=True)[:4]
            time.sleep(0.5)
    with open(log_path) as log:
        text = log.read()
    result = {
        "label": args.label, "cmd": " ".join(cmd), "env": args.env, "exit": proc.returncode, "pass": proc.returncode == 0,
        "peak_tree_mb": round(peak_mb), "peak_procs": peak_procs,
        "cpu_avg_pct_top": round(sum(cpu_samples) / len(cpu_samples)) if cpu_samples else None,
        "samples": len(cpu_samples), "load_start": round(load_start, 1), "load_end": round(os.getloadavg()[0], 1),
        "peak_top": [[round(m), c] for m, c in peak_top], "log": log_path, "at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "killed_by_guard": "[browser-slot] KILLED" in text,
    }
    result.update(time_l(text))
    if result.get("real_s"):
        result["cpu_avg_pct"] = round(100 * (result["user_s"] + result["sys_s"]) / result["real_s"])
        result["cpu_s"] = round(result["user_s"] + result["sys_s"], 1)
    passes = re.findall(r"(\d+)/(\d+) passed", text)
    if passes:
        result["flows_passed"] = "%s/%s" % passes[-1]
    with open(args.out, "a") as out:
        out.write(json.dumps(result) + "\n")
    print(json.dumps({k: result.get(k) for k in ("label", "pass", "real_s", "peak_tree_mb", "cpu_avg_pct", "cpu_avg_pct_top", "cpu_s", "flows_passed")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
