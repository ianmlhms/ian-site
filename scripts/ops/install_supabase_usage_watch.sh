#!/bin/bash
# Install (or update) the Supabase usage watchdog on the Mac Mini.
#
#   scripts/ops/install_supabase_usage_watch.sh
#
# Copies supabase_usage_watch.py next to the brix watchdog, OUTSIDE OneDrive
# (launchd cannot read OneDrive files), and loads the LaunchAgent
# lu.ian.supabase-usage, which runs it once an hour. A separate agent rather than
# part of the 5-minute brix watchdog: a first backfill or a slow logs query must
# never delay restarting a crashed bot container, and the two fail independently.
# Needs ~/.supabase/access-token and ~/.claude-notify/notify.py.
set -euo pipefail

LABEL="lu.ian.supabase-usage"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$HOME/Library/Application Support/ian-watchdog"
DEST="$DEST_DIR/supabase_usage_watch.py"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/ian-watchdog-usage.log"
DOMAIN="gui/$(id -u)"

[ -r "$HOME/.supabase/access-token" ] || { echo "missing ~/.supabase/access-token" >&2; exit 1; }
mkdir -p "$DEST_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$HERE/supabase_usage_watch.py" "$DEST"
chmod 755 "$DEST"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$DEST</string>
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PYTHONUNBUFFERED</key><string>1</string>
    <key>PYTHONDONTWRITEBYTECODE</key><string>1</string>
  </dict>
</dict>
</plist>
PLISTEOF
plutil -lint "$PLIST" >/dev/null

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "installed $LABEL (hourly). log: $LOG"
