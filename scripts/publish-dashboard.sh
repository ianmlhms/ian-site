#!/usr/bin/env bash
# Publish the ShortsFactory dashboard data to the public ian-site repo (GitHub Pages).
# Call this at the END of each ShortsFactory run so the live dashboard refreshes.
#
# Setup (once, on the Mac mini):
#   1. Clone the site:   gh repo clone ianmlhms/ian-site ~/ian-site
#   2. Auth git push:    gh auth login && gh auth setup-git
#   3. Copy publish_factory.py into the ShortsFactory project's scripts/ folder.
#   4. Export SUPABASE_URL + SUPABASE_SERVICE_KEY (service_role secret) for the
#      private dashboard push. Keep the service key OUT of the repo (use the env /
#      launchd plist). Adjust SF_DIR / REPO_DIR / PY below or export them.
#
# NOTE: SF_DIR/PY default to the LOCAL run copy + venv (~/.shortsfactory), not the
# OneDrive source — the OneDrive .venv is a dataless stub and OneDrive can't be read
# under launchd. The local copy imports `src` and reads the same state DB.
#
# It pushes the dashboard data to the admin-only dashboard_state table
# (read by factory.html, me.html and the briefing Edge Function).
#
# Then run:  scripts/publish-dashboard.sh
set -euo pipefail

SF_DIR="${SF_DIR:-$HOME/.shortsfactory/app}"
REPO_DIR="${REPO_DIR:-$HOME/ian-site}"
PY="${PY:-$HOME/.shortsfactory/venv/bin/python}"

# 1) Pull first, on a clean tree, so we never diverge from the remote.
#    Name origin + branch explicitly so this works even if the branch has no
#    upstream tracking configured (e.g. after a fresh clone or history rewrite).
cd "$REPO_DIR"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git pull --quiet --rebase --autostash origin "$BRANCH" || true

# 2) Push the dashboard data to Supabase (admin-only dashboard_state).
#    Nothing is written to the repo any more: the public data/factory.json
#    was removed on 23 Sep 2026 because it exposed the channels' handles.
PYTHONPATH="$SF_DIR" "$PY" "$SF_DIR/scripts/publish_factory.py"
echo "dashboard: pushed to Supabase"
