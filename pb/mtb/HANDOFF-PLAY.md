# HANDOFF-PLAY (W3-play agent, worktree website-mtb-play, branch mtb-play) - updated at the stop

Brief: `/private/tmp/claude-502/-Users-Ian/abcb6fad-0a58-415e-9a86-e860154b9872/scratchpad/brief-mtb-play.md`. Lane: bike/input/camera/trails/main/config/i18n/ui/mtb.html + new modules + scripts/mtb. No push, no deploy, no SQL run. Read `W3-PLAY-NOTES.md` first (what was built, tuning notes, decisions).

## Verified (numbers)
- `node pb/mtb/harness-play.js`: PASS 160 checks (physics 36, trails, reference rider finishes all 6 trails 0 crashes 0 rescues with trunks and rocks on, medal times match, game loop, i18n lb/de/en/fr).
- `node pb/mtb/harness.js` (zero holes): PASS 79 checks in 59 s (before the last small physics change: soft speed cap; rerun it).
- `harness-save.js` 298 and `harness-audio.js` 167 checks pass (helper-agent modules).
- Flows (Chromium, last full run): mtb-world PASS, mtb-holes PASS (0 hole pixels), mtb-ride PASS after the R-reset fix (game.js `pending` events), mtb-touch PASS (iPad portrait + landscape, controls 2.9 % of the screen, 64 px, 44 px HUD buttons), mtb-menu: all pass except the enduro pick (flow fixed since: uses `persistence.applyIncoming`, because cloud messages are ignored on a top-level page), mtb-trails: all six trails finished in the real loop, only the ghost-count assertion was wrong (fixed). Both fixed flows NOT re-run yet.
- `check_site.py`: no new warnings (arcade-kit.js ?v=34 -> 35 in 50 pages). Draw calls at the start card: low 138 (budget 140), medium 156, high 174.

## Not done / next (in order)
1. Re-run `node scripts/flows/run_all.mjs mtb` (expect 6/6), then `node scripts/flows/run_webkit.mjs mtb-world mtb-ride mtb-menu mtb-touch mtb-trails` (not run at all), `node pb/mtb/harness.js`, `REPO=$PWD BASE=origin/main python3 ~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/tools/cv_head.py` (not run; must say PROBLEMS: 0).
2. Montage into `~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/mtb/w3-play/`: use `node scripts/mtb/play-tour.mjs OUT --trail <id> --only card,count,run,finish,menu,bikes` for every trail (ids in W3-PLAY-NOTES), `--touch --size 820x1180` and `1180x820` for the iPad layout; join with PIL from the luxtram venv. A first set of screenshots exists in the scratchpad `play/shots/` (card, countdown, run, finish, menu with painted map, bikes, settings, iPad). Crash tumble and free-ride flag screenshots still to take.
3. Thumbnail `pb/thumbs/mtb.webp` (640x400, like the other tiles; the tile CSS is 16:10) from a real in-game screenshot (the tile entry and DESC_I18N are already in pixelbreak.html and point at it, so the file MUST be added).
4. Recompute the pump numbers in W3-PLAY-NOTES (they were measured at 210 W, now 270 W) and the speed-cap sentence (now soft cap 15.5 m/s + 0.5/s drag: 30 % descent tops out near 63 km/h); regenerate medals only if harness-play reports drift (`--rides --write-medals`).
5. Report to the reviewer: `scripts/mtb.sql` (daily board only, not run), `pixelbreak-records.js` `mtb` score format, the 3 art rocks on the Marathon path, the Schiessentuempel trail ending 100 m before the falls, the Marathon being 10.25 km point to point (only that much of the GPX is inside the box).
