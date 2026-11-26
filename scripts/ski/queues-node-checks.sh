#!/bin/bash
# Lift lines round (26 Nov 2026): the Node checks the lift lines / boarding touch, in a row (log to stdout).
cd "$(dirname "$0")/../.." || exit 1
for t in queue-check npc-check round7b-test deadend-check review-check camera-check; do
  echo "== $t"; nice -n 10 node "scripts/ski/$t.mjs" 2>&1 | tail -4
done
for r in killy 3vallees zermatt arlberg kronplatz vialattea obertauern livigno davos laax; do
  echo "== station-diag $r"; nice -n 10 node scripts/ski/station-diag.mjs "$r" 'nomatch^' 2>&1 | tail -3
done
