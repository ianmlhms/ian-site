#!/bin/zsh
# Runs flows x configs through measure.py (and so through ~/Library/Caches/browser-slot.py), one job at a time.
#   FLOWS_DIR=<checkout with the flows>  OUT=<results.jsonl>  zsh scripts/power/matrix.sh "<flow files>" "<configs>"
# configs: base novideo full econ econ-dsf1 shell shell-gpu fps20 fps30 shell-gpu-econ
set -u
HERE=${0:A:h}
FLOWS_DIR=${FLOWS_DIR:-$PWD}
OUT=${OUT:-$HOME/Library/Caches/ski-work/power-test/results.jsonl}
VIDEOS=${VIDEOS:-$TMPDIR/power-videos}
TAG=${TAG:-}
mkdir -p $VIDEOS
for flow in ${=1}; do
  for cfg in ${=2}; do
    envs=(--env FLOW_VIDEO_DIR=$VIDEOS)
    case $cfg in
      base) ;;
      novideo) envs+=(--env FLOW_NO_VIDEO=1) ;;
      full) envs+=(--env FLOW_NO_VIDEO=1 --env FLOW_CHROME=full) ;;
      econ) envs+=(--env FLOW_NO_VIDEO=1 --env FLOW_ECONOMY=1) ;;
      econ-dsf1) envs+=(--env FLOW_NO_VIDEO=1 --env FLOW_ECONOMY=1 --env FLOW_ECONOMY_DSF=1) ;;
      fps20) envs+=(--env FLOW_NO_VIDEO=1 --env FLOW_ECONOMY=1 --env FLOW_FPS=20) ;;
      shell) envs+=(--env FLOW_NO_VIDEO=1 --env FLOW_CHROME=shell) ;;
      shell-gpu) envs+=(--env FLOW_NO_VIDEO=1 --env FLOW_CHROME=shell "--env=FLOW_SHELL_ARGS=--use-angle=metal --enable-gpu --ignore-gpu-blocklist") ;;
      fps30) envs+=(--env FLOW_NO_VIDEO=1 --env FLOW_FPS=30) ;;
      shell-gpu-econ) envs+=(--env FLOW_NO_VIDEO=1 --env FLOW_ECONOMY=1 --env FLOW_CHROME=shell "--env=FLOW_SHELL_ARGS=--use-angle=metal --enable-gpu --ignore-gpu-blocklist") ;;
      *) echo "unknown config $cfg"; continue ;;
    esac
    python3 $HERE/measure.py --label "$cfg:${flow%.mjs}$TAG" --out $OUT --cwd $FLOWS_DIR $envs -- node scripts/flows/$flow
  done
done
