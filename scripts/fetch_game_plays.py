#!/usr/bin/env python3
"""Refresh the usage numbers in arcade-catalogue.js: how often each arcade game was opened.

The order of the games on the home page ("Meescht gespillt" and inside every group) and in the arcade comes from them.
Every game opened in the arcade is a GoatCounter hit at /pixelbreak.html?g=<id>; a game with its own page (href / go in the
catalogue) is counted by that page's traffic, which includes visits that did not come via the arcade.

    python3 scripts/fetch_game_plays.py                     # from the GoatCounter API (token in ~/.config/goatcounter/.env)
    python3 scripts/fetch_game_plays.py --usage FILE.json   # from a list of [opens90, opens30, id, ..., [players, rows, last]]

Writes the lines between <usage> and </usage>: id -> [opens in 90 days, opens in 30 days, players on the score board].
The API knows no players: those numbers are kept from the file. Afterwards bump arcade-catalogue.js?v= in index.html and
pixelbreak.html. The API token is never printed, never passed as an argument and never written into the repo, which is public.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta

SITE = "https://ianm.goatcounter.com"
STATS_ENDPOINT = SITE + "/api/v0/stats/hits"
TOKEN_FILE = os.path.expanduser("~/.config/goatcounter/.env")
TOKEN_KEY = "GOATCOUNTER_TOKEN"
CATALOGUE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "arcade-catalogue.js")
WINDOWS_DAYS = (90, 30)
PAGE_LIMIT = 100          # the API caps a page at 100 whatever you ask for
MAX_PAGES = 40            # guard against an unbounded loop if `more` never clears
PAUSE_SECONDS = 0.3
REQUEST_TIMEOUT = 90

GAME_PATH = re.compile(r"^/pixelbreak\.html\?g=([A-Za-z0-9_-]+)$")

USAGE_BLOCK = re.compile(r"(/\* <usage> .*?\*/\n)(.*?)(\n/\* </usage> \*/)", re.S)
OPENS_LINE = re.compile(r'^"([^"]+)":\[(\d+),(\d+),(\d+)\]', re.M)


def catalogue_games():
    """id -> page of its own (None when the game opens in the arcade)."""
    source = open(CATALOGUE, encoding="utf-8").read()
    games = source[source.index("var GAMES=["):source.index("var DESC_I18N=")]
    result = {}
    for line in games.split("\n"):
        game = re.match(r'\{id:"([^"]+)"', line)
        if game:
            page = re.search(r'[,{](?:href|go):"([^"]+)"', line)
            result[game.group(1)] = "/" + page.group(1) if page else None
    return result


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


def fetch_page(token, seen_path_ids, start):
    """One page of hits. Pagination is by excluding what we already have.

    The endpoint rejects any parameter it does not know with a 400, so `offset`,
    `after` and `page` are all errors -- `exclude_paths` (a comma-separated
    string, not a repeated parameter) is the mechanism that works.
    """
    # `end` is exclusive, so today counts only with end = tomorrow
    params = {"start": start.isoformat(), "end": (date.today() + timedelta(days=1)).isoformat(), "limit": PAGE_LIMIT}
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


def collect_plays(token, days, games):
    """Map game id -> opens in the last `days` days, walking every page of stats."""
    by_page = {page: game_id for game_id, page in games.items() if page}
    plays = {}
    seen_path_ids = []
    for _ in range(MAX_PAGES):
        hits, has_more = fetch_page(token, seen_path_ids, date.today() - timedelta(days=days))
        if not hits:
            break
        for hit in hits:
            seen_path_ids.append(hit["path_id"])
            path = hit.get("path", "")
            match = GAME_PATH.match(path)
            game_id = match.group(1) if match else by_page.get(path.split("?")[0])
            # a game with its own page is counted there, not a second time by its ?g= link
            if game_id in games and (not match or not games[game_id]):
                plays[game_id] = plays.get(game_id, 0) + hit.get("count", 0)
        if not has_more:
            break
        time.sleep(PAUSE_SECONDS)
    return plays


def usage_from_api(games, players):
    token = read_token()
    long_plays, short_plays = (collect_plays(token, days, games) for days in WINDOWS_DAYS)
    if not long_plays:
        sys.exit("No game hits found - refusing to write an empty ranking.")
    return {i: (long_plays.get(i, 0), short_plays.get(i, 0), players.get(i, 0)) for i in games}


def usage_from_file(path, games, players):
    with open(path, encoding="utf-8") as handle:
        rows = {row[2]: row for row in json.load(handle)}
    return {i: (int(rows[i][0]), int(rows[i][1]), int(rows[i][6][0]) if rows[i][6] else 0) if i in rows else (0, 0, players.get(i, 0))
            for i in games}


def main():
    games = catalogue_games()
    with open(CATALOGUE, encoding="utf-8") as handle:
        source = handle.read()
    block = USAGE_BLOCK.search(source)
    if not block or not games:
        sys.exit("arcade-catalogue.js: the games or the <usage> block were not found.")
    players = {m.group(1): int(m.group(4)) for m in OPENS_LINE.finditer(block.group(2))}
    args = sys.argv[1:]
    usage = usage_from_file(args[1], games, players) if len(args) == 2 and args[0] == "--usage" else usage_from_api(games, players)
    lines = ",\n".join('"%s":[%d,%d,%d]' % (i, *u) for i, u in sorted(usage.items(), key=lambda item: -sum(item[1])))
    body = "/* generated %s */\nvar OPENS={\n%s\n};" % (date.today().isoformat(), lines)
    with open(CATALOGUE, "w", encoding="utf-8") as handle:
        handle.write(source[:block.start(2)] + body + source[block.end(2):])
    print("arcade-catalogue.js: usage of %d games, %d opens in 90 days. Bump its ?v= in index.html and pixelbreak.html."
          % (len(usage), sum(u[0] for u in usage.values())))


if __name__ == "__main__":
    main()
