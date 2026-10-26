# Game worlds on the device (gamecache)

Ian, 26 Oct: "make it so that you can save the world on the iPad, so that it doesn't have to load again on each open, also Schueberfouer."

## What happens now

The big data files of a game (`pb/<game>/data/**`: MTB 5.5 MB, Schueberfouer 620 KB, Zuchsimulator 53 MB of tiles and station patches) are kept on the device by the
service worker (`sw.js`, cache `ianlu-gamedata-v1`) and are only downloaded again when the file itself changed.

1. `scripts/gamedata_manifest.py` writes `pb/<game>/data-hashes.json`: `{"v":1,"files":{"<path below data/>":"<first 10 hex of SHA-256>"}}`, one line per file.
2. `sw.js` reads that manifest network-first (a small conditional request; offline: the stored copy). It is re-read whenever the game page (`/pb/<game>.html`) is
   requested and at least every 5 minutes. A data request is answered from the cache **only if the stored copy's hash equals the manifest's**. Otherwise the worker fetches
   `/pb/<game>/data/<file>?v=<hash>` (revalidated), checks the SHA-256 of the body against the manifest, stores it, and deletes every older copy of the same path.
   Files the manifest does not list, `Range` requests and non-200 answers go to the network as before. A copy that does not match its hash is served but never stored.
3. When a manifest changes, the worker also prunes the cache of that game (paths that vanished, old hashes).
4. `pb/game-data.js` (loaded by `mtb.html`, `fouer.html`, `train-sim.html`) calls `navigator.storage.persist()` once per page (Safari may evict a site's storage after
   7 days without use unless it is persistent) and shows "vum Apparat gelueden" (lb/de/en/fr, the game's language key, else `site_lang`) for ~3 s when every data file of
   this open came from the device. The worker tells the page with a `postMessage` (`{type:"ianlu-gamedata", hits, misses, missBytes}`).
5. The code (HTML, JS modules, CSS) stays **network-first**, as before: that is what un-freezes a rewritten game. Only `data/` files are cache-first.

### Why the hash lives in a manifest and not in `?v=` on every request

The brief suggested `?v=<content hash>` on each data URL. The games request their data in many places (MTB: one `reader()`, the train sim: ~10 `fetch` sites with hand-set
`?v=` / `DATA_VERSION` constants, `syncJson` / XHR in luxtram-world.js, 2200 files), and two other agents are editing those files. With the manifest the worker is the only
place that knows the version, no game file needs a call-site change, and a wrong hand-set `?v=` can no longer freeze data (the request's own `?v=` is ignored). The worker
itself fetches the data with `?v=<hash>`, so even the browser's HTTP cache can only ever hold the right bytes under that URL.

## Call sites touched in the games

Only one line each, a deferred script tag after `arcade-kit.js`:

| file | change |
| --- | --- |
| `pb/mtb.html` | `<script src="/pb/game-data.js?v=1" defer></script>` |
| `pb/fouer.html` | same |
| `pb/train-sim.html` | same |

No `fetch` / loader code of any game was changed. `pb/mtb/*.js`, `pb/train-sim/*.js` and `pb/fouer/*.js` are untouched.

## For the people who change data

* Changed, added or removed a file below `pb/<game>/data/`? Run `python3 scripts/gamedata_manifest.py` and commit the `pb/<game>/data-hashes.json` with it.
  `scripts/check_site.py` (rule `gamedata`) fails when a data file changed without its hash changing, when a file has no hash, or when a hash belongs to a deleted file.
* Merge conflict in a `data-hashes.json`? Take either side and re-run the command: the file is generated.
* A new game with a `data/` folder: add its folder name to `GAMEDATA_GAMES` in `sw.js` (the check tells you), run the command, add the script tag. Bump `CACHE` in `sw.js`
  only for changes to the site cache; the data cache has its own name (`GAMEDATA_CACHE`), bump that only to throw every stored world away.
* The manifest of the Zuchsimulator is 83 KB (2200 files, ~30 KB brotli'd, revalidated with a 304 when unchanged).

## Gates

* Flow `game-cache` (`node scripts/flows/game_cache.mjs`, also in `run_all.mjs`): cold vs warm bytes of MTB / Schueberfouer / the train sim from the flow server's own log,
  a simulated deploy of one changed data file (exactly that file is downloaded, the page gets the new content, one cache entry per path), `storage.persist()` once,
  the "vum Apparat" note only on a warm open, network-first code, unlisted files never stored. `scripts/flows/lib.mjs` got two optional arguments for it
  (`startServer(root, {log, overrides})`, flow option `serviceWorkers: "allow"`).
* `python3 scripts/check_site.py`, `cv_head.py` (PROBLEMS: 0).

## Not done, on purpose

* **Derived data in IndexedDB (MTB terrain / forest, ...).** Measured warm MTB (WebKit, Mac mini): code + data 0.44 s, `buildPureWorld` 0.84 s (height field 0.19, world maps 0.24,
  houses 0.36 which is mostly the first lazy `surface.height` evaluations), views and first frame 0.5 s. The results are object graphs with closures over the height field, not
  typed arrays, and they depend on ~15 modules that other agents are editing: a cache keyed by the data hash alone would serve a world built by the OLD algorithm after a code
  change. Keying it on a code version needs a manifest of the code too. Not worth it before Ian has timed it on the real iPad (see the report).
* **JS modules** (MTB 61, Schueberfouer 84 requests per open) are still revalidated on every open (304, no body). Making them cache-first by hash is possible with the same
  manifest idea, but every code edit would then need a regenerated manifest; that is the freeze problem in a new coat, so it is left alone.
* Kart Lëtzebuerg and Paket Express have no `data/` folder (their data is small JS: `kart-letzebuerg/data-*.js`, 450 KB, code path, network-first).
