#!/usr/bin/env python3
"""Write data/game-plays.json — how often each PixelBreak game was opened.

The arcade already records this: pixelbreak.html counts a GoatCounter hit at
/pixelbreak.html?g=<id> every time a game opens, for signed-out visitors too.

Run it whenever the ordering should be refreshed:

    python3 scripts/fetch_game_plays.py

The API token is read from ~/.config/goatcounter/.env and is never printed,
never passed as an argument and never written into the repo, which is public.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timezone, datetime

SITE = "https://ianm.goatcounter.com"
STATS_ENDPOINT = SITE + "/api/v0/stats/hits"
TOKEN_FILE = os.path.expanduser("~/.config/goatcounter/.env")
TOKEN_KEY = "GOATCOUNTER_TOKEN"
OUTPUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "data", "game-plays.json")
STATS_START = "2026-06-01"
PAGE_LIMIT = 100          # the API caps a page at 100 whatever you ask for
MAX_PAGES = 40            # guard against an unbounded loop if `more` never clears
PAUSE_SECONDS = 0.3
REQUEST_TIMEOUT = 90

GAME_PATH = re.compile(r"^/pixelbreak\.html\?g=([A-Za-z0-9_-]+)$")

# The online games are `href:` entries: they navigate to their own page instead of
# opening in the arcade's iframe, so they never produce a /pixelbreak.html?g= hit.
# Their real usage is the page's own traffic. Counted here so they can be ranked
# alongside the rest -- see the caveat in the generated file.
ONLINE_GAME_PAGES = {
    "/connect4.html": "o-connect4", "/slf.html": "o-slf",
    "/battleship.html": "o-battleship", "/color.html": "o-color",
    "/draw.html": "o-draw", "/intro.html": "o-intro",
    "/reversi.html": "o-reversi", "/dots.html": "o-dots",
    "/tictactoe.html": "o-tictactoe", "/meme.html": "o-meme",
    "/checkers.html": "o-checkers", "/maumau.html": "o-maumau",
    "/dice-duel.html": "o-dice-duel", "/wordle.html": "o-wordle",
}

# Removed from the arcade in Aug 2026; the recorded path is history, not a game.
STALE_GAME_IDS = frozenset({"casino"})


def read_token():
    """Return the API token, or exit with an explanation of how to make one."""
    try:
        with open(TOKEN_FILE, encoding="utf-8") as handle:
            for line in handle:
                key, separator, value = line.partition("=")
                if separator and key.strip() == TOKEN_KEY and value.strip():
                    return value.strip()
    except FileNotFoundError:
        pass
    sys.exit(
        "No GoatCounter token.\n"
        "  Create one at %s/user/api (tick 'Read statistics'), then:\n"
        "    mkdir -p ~/.config/goatcounter\n"
        "    echo '%s=<token>' > %s && chmod 600 %s\n"
        % (SITE, TOKEN_KEY, TOKEN_FILE, TOKEN_FILE)
    )


def fetch_page(token, seen_path_ids):
    """One page of hits. Pagination is by excluding what we already have.

    The endpoint rejects any parameter it does not know with a 400, so `offset`,
    `after` and `page` are all errors -- `exclude_paths` (a comma-separated
    string, not a repeated parameter) is the mechanism that works.
    """
    params = {"start": STATS_START, "end": date.today().isoformat(), "limit": PAGE_LIMIT}
    if seen_path_ids:
        params["exclude_paths"] = ",".join(str(path_id) for path_id in seen_path_ids)
    request = urllib.request.Request(
        STATS_ENDPOINT + "?" + urllib.parse.urlencode(params),
        headers={"Authorization": "Bearer " + token},
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        detail = "check the token is valid and has 'Read statistics'" if error.code == 401 \
            else "the API rejected the request"
        sys.exit("GoatCounter returned HTTP %d - %s." % (error.code, detail))
    except urllib.error.URLError as error:
        sys.exit("Could not reach GoatCounter: %s" % error.reason)
    return payload.get("hits", []), bool(payload.get("more"))


def collect_plays(token):
    """Map game id -> opens, walking every page of stats."""
    plays = {}
    seen_path_ids = []
    for _ in range(MAX_PAGES):
        hits, has_more = fetch_page(token, seen_path_ids)
        if not hits:
            break
        for hit in hits:
            seen_path_ids.append(hit["path_id"])
            path = hit.get("path", "")
            count = hit.get("count", 0)
            match = GAME_PATH.match(path)
            game_id = match.group(1) if match else ONLINE_GAME_PAGES.get(path.split("?")[0])
            if game_id and game_id not in STALE_GAME_IDS:
                plays[game_id] = plays.get(game_id, 0) + count
        if not has_more:
            break
        time.sleep(PAUSE_SECONDS)
    return plays


def main():
    plays = collect_plays(read_token())
    if not plays:
        sys.exit("No game hits found - refusing to write an empty ranking.")
    document = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "since": STATS_START,
        "note": ("Opens per game, from GoatCounter. The o-* games navigate to their own "
                 "page rather than opening in the arcade iframe, so their figure is that "
                 "page's traffic and counts visits that did not come via the arcade."),
        "plays": dict(sorted(plays.items(), key=lambda item: (-item[1], item[0]))),
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=1)
        handle.write("\n")
    print("Wrote %s - %d games, %d opens." % (OUTPUT_PATH, len(plays), sum(plays.values())))


if __name__ == "__main__":
    main()
