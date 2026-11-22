#!/usr/bin/env python3
"""results.jsonl (measure.py) -> one markdown table per flow: config | wall s | peak tree MB | CPU s | avg CPU % | pass.

    python3 scripts/power/summarize.py ~/Library/Caches/ski-work/power-test/results.jsonl
The last run of each label wins (a re-run replaces an earlier one)."""
import json
import sys
from collections import OrderedDict


def main(path):
    runs = OrderedDict()
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                r = json.loads(line)
                runs[r["label"]] = r
    flows = OrderedDict()
    for label, r in runs.items():
        cfg, _, flow = label.partition(":")
        flows.setdefault(flow, []).append((cfg, r))
    for flow, rows in flows.items():
        base = next((r for c, r in rows if c == "base"), None)
        print(f"\n**{flow}**\n")
        print("| config | wall s | peak tree MB | CPU s | avg CPU % | pass |")
        print("|---|---:|---:|---:|---:|---|")
        for cfg, r in rows:
            cpu = r.get("cpu_s")
            rel = f" ({100 * (cpu - base['cpu_s']) / base['cpu_s']:+.0f} %)" if base and cpu is not None and base.get("cpu_s") and cfg != "base" else ""
            mem_rel = f" ({100 * (r['peak_tree_mb'] - base['peak_tree_mb']) / base['peak_tree_mb']:+.0f} %)" if base and base.get("peak_tree_mb") and cfg != "base" else ""
            ok = "yes" if r["pass"] else ("**KILLED**" if r.get("killed_by_guard") else "**no**")
            print(f"| {cfg} | {r.get('real_s', 0):.1f} | {r['peak_tree_mb']}{mem_rel} | {cpu}{rel} | {r.get('cpu_avg_pct')} | {ok} |")


if __name__ == "__main__":
    main(sys.argv[1])
