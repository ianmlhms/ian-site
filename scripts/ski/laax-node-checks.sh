#!/bin/bash
# Laax (resort 10): the Node checks of the HANDOFF that are not in r8c-node-all.sh, in a row (log to stdout).
cd "$(dirname "$0")/../.." || exit 1
run() { echo "== $*"; nice -n 10 "$@" 2>&1 | tail -${TAILN:-3}; }
run node scripts/ski/round7c-check.mjs --rides
run node scripts/ski/round7b-test.mjs
run node scripts/ski/r8c-check.mjs
run node scripts/ski/speed-check.mjs
run node scripts/ski/review-check.mjs
run node scripts/ski/camera-check.mjs
run node scripts/ski/barrier-check.mjs
run node scripts/ski/npc-check.mjs
run node scripts/ski/cliff-check.mjs
run node scripts/ski/floors-check.mjs
run node scripts/ski/security-test.mjs
run node scripts/ski/memory-check.mjs
run node scripts/ski/station-diag.mjs laax zzz
run node scripts/ski/fp-steer-check.mjs
run node scripts/ski/pano-check.mjs
run node scripts/ski/piste_index.mjs --check
run node scripts/ski/cloud-size-test.mjs
run node scripts/ski/street-check.mjs
run node scripts/ski/mp-race-test.mjs
