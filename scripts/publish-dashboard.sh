#!/usr/bin/env bash
# Publish the ShortsFactory dashboard data to the public ian-site repo (GitHub Pages).
# Call this at the END of each ShortsFactory run so the live dashboard refreshes.
#
# Setup (once, on the Mac mini):
#   1. Clone the site:   gh repo clone ianmlhms/ian-site ~/ian-site
#   2. Auth git push:    gh auth login && gh auth setup-git
#   3. Copy export_factory_json.py into the ShortsFactory project's scripts/ folder.
#   4. Adjust SF_DIR / REPO_DIR below (or export them as env vars).
#
# Then run:  scripts/publish-dashboard.sh
set -euo pipefail

SF_DIR="${SF_DIR:-$HOME/Library/CloudStorage/OneDrive-Mulheims/Shortsfactory}"
REPO_DIR="${REPO_DIR:-$HOME/ian-site}"
PY="${PY:-$SF_DIR/.venv/bin/python}"

# 1) Export fresh data straight from the local ShortsFactory state DB.
PYTHONPATH="$SF_DIR" "$PY" "$SF_DIR/scripts/export_factory_json.py" "$REPO_DIR/data/factory.json"

# 2) Commit + push only if the data actually changed.
cd "$REPO_DIR"
git pull --quiet --rebase || true
git add data/factory.json
if git diff --cached --quiet; then
  echo "dashboard: no change, nothing to publish"
  exit 0
fi
git commit --quiet -m "stats: refresh dashboard data ($(date -u +%FT%TZ))"
git push --quiet
echo "dashboard: published to ian-site"
