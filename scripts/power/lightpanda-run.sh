#!/bin/zsh
# Runs one flow against Lightpanda (CDP, no WebGL) instead of Chromium:
#   zsh scripts/power/lightpanda-run.sh scripts/flows/home_page.mjs
# Binary: ~/Library/Caches/lightpanda/lightpanda-aarch64-macos (github.com/lightpanda-io/browser releases, no install / sudo).
# Video recording does not exist over CDP to Lightpanda, so FLOW_NO_VIDEO=1 is forced.
set -u
LP=${LIGHTPANDA:-$HOME/Library/Caches/lightpanda/lightpanda-aarch64-macos}
PORT=${LP_PORT:-9333}
export LIGHTPANDA_DISABLE_TELEMETRY=true
$LP serve --host 127.0.0.1 --port $PORT --disable-metrics > ${LP_LOG:-/dev/null} 2>&1 &
LP_PID=$!
trap 'kill $LP_PID 2>/dev/null' EXIT
for i in {1..50}; do curl -s -o /dev/null http://127.0.0.1:$PORT/json/version && break; sleep 0.1; done
FLOW_NO_VIDEO=1 FLOW_CDP=ws://127.0.0.1:$PORT node "$@"
