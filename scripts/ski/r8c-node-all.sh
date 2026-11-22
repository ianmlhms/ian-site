#!/bin/bash
# R8c: every Node check of the ski game in a row (log to stdout): the round tests, the R8c checks, the harness per resort.
cd "$(dirname "$0")/../.." || exit 1
for t in round7b-test round7-test round6-test look7d-check r7d-test r8c-check round7c-check speed-check; do
  echo "== $t"; nice -n 10 node "scripts/ski/$t.mjs" 2>&1 | tail -3
done
for r in killy 3vallees zermatt arlberg kronplatz; do
  echo "== harness $r"; nice -n 10 node pb/ski/harness.js "$r" 2>&1 | tail -1
done
