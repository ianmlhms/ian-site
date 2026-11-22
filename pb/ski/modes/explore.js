/* Round 7-C: discovery + map teleport + the first lift, glued to the game (main.js keeps only small hooks marked "R7-C").
 *   discovery  the cells round the skier while skiing (HUD rate), the stations he reaches, the line of every lift he rides; saved per
 *              resort locally (progress.disc) and in the cloud record (cloud.js `d`), the cloud copy is merged in (union)
 *   first lift the resort's first lift (config FIRST_LIFT) and its boarding spot (clear.js liftSpot); always discovered
 *   map        the fog over the undiscovered cells (map.js setFog), a tap -> "Nach net entdeckt" or "Hei hin teleportéieren?" (Jo / Nee)
 *              -> the nearest safe spot (clear.js safeSpot), the "Bei den éischte Lift" button, undiscovered lifts in the list locked */
import { createObstacles, firstLift, liftSpot, safeSpot } from './clear.js';
import { createDiscovery } from './discovery.js';
import { DISCOVERY } from '../config.js';

const SAVE_EVERY = 4;            // s between saves of a changed discovery
const STATION_REACH = 45;        // m from a station = reached

export function createExplore({ rid, resort, store, cloud, field, scatter, density = 1, lifts, pistes, height }) {
  const obs = createObstacles({ resort, field, scatter, density });
  const disc = createDiscovery({ width: resort.width, depth: resort.depth, saved: (store.get().disc || {})[rid] || '' });
  const first = firstLift(rid, lifts, resort.places, null);
  if (first) disc.reveal(first.bottom.x, first.bottom.z, DISCOVERY.spawn);
  let lastSaved = (store.get().disc || {})[rid] || '', saveT = 0;
  let buildingsReady = false, resolveBuildings = null;
  const buildingsPromise = new Promise((res) => { resolveBuildings = res; });

  function save(force = false) {
    if (!force && !disc.takeDirty()) return;
    const text = disc.encode();
    if (text === lastSaved) return;
    lastSaved = text;
    const p = store.get();
    store.set({ ...p, disc: { ...(p.disc || {}), [rid]: text } });
    if (cloud) cloud.push(store.get());
  }
  /** HUD rate (0.1 s): the cells round the skier, the lift stations reached; the cloud copy merged in; a throttled save. */
  function tick(st, dt) {
    if (st) {
      disc.reveal(st.x, st.z);
      for (const l of lifts.list) {
        for (const e of [l.bottom, l.top]) {
          if (Math.abs(e.x - st.x) < STATION_REACH && Math.abs(e.z - st.z) < STATION_REACH && Math.hypot(e.x - st.x, e.z - st.z) < STATION_REACH) disc.reveal(e.x, e.z, DISCOVERY.station);
        }
      }
    }
    const stored = (store.get().disc || {})[rid];
    if (stored && stored !== lastSaved && disc.absorb(stored)) lastSaved = '';          // a cloud merge brought cells: absorb, save back
    saveT += dt;
    if (saveT >= SAVE_EVERY) { saveT = 0; save(); }
  }
  /** A lift ridden: its line and both stations are discovered. */
  function rode(lift) {
    const src = resort.lifts[lift.index];
    if (src) disc.revealLine(src.pts);
    disc.reveal(lift.bottom.x, lift.bottom.z, DISCOVERY.station);
    disc.reveal(lift.top.x, lift.top.z, DISCOVERY.station);
    save(true);
  }
  const liftOpen = (l) => !!l && (disc.has(l.bottom.x, l.bottom.z) || disc.has(l.top.x, l.top.z));

  // ---- the map overlay ----
  let map = null;
  function attachMap({ mapEl, pisteMap, onTeleport, onFirstLift }) {
    detachMap();
    const box = mapEl.querySelector('.mapbox');
    const ui = document.createElement('div');
    ui.className = 'tpui';
    ui.innerHTML = `<button type="button" class="btn tpfirst" id="tpFirst">⌂ Bei den éischte Lift</button>
      <div class="tptoast" id="tpToast" hidden></div>
      <div class="tpconfirm" id="tpConfirm" hidden><b>Hei hin teleportéieren?</b><span id="tpWhere"></span>
        <div class="acts"><button type="button" class="btn primary" id="tpYes">Jo</button><button type="button" class="btn" id="tpNo">Nee</button></div></div>`;
    box.appendChild(ui);
    const $ = (s) => ui.querySelector(s);
    let pending = null, toastTimer = 0;
    const toast = (text) => {
      const t = $('#tpToast'); t.textContent = text; t.hidden = false;
      clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
    };
    const close = () => { pending = null; $('#tpConfirm').hidden = true; pisteMap.setPin(null); document.documentElement.dataset.skiTeleport = ''; };
    pisteMap.setFog(disc);
    pisteMap.setTapWorld((x, z) => {
      if (!disc.has(x, z)) {
        close(); pisteMap.setPin({ x, z, ok: false }); toast('Nach net entdeckt');
        document.documentElement.dataset.skiTeleport = 'refused';
        setTimeout(() => { if (!pending) pisteMap.setPin(null); }, 1200);
        return;
      }
      const spot = safeSpot(x, z, { obs, pistes, lifts, height, isOpen: disc.has });
      if (!spot) { close(); toast('Hei ass keng sécher Plaz'); document.documentElement.dataset.skiTeleport = 'nospot'; return; }
      pending = spot;
      pisteMap.setPin({ x, z, ok: true, spot });
      const near = spot.kind === 'lift' ? (lifts.byId.get(spot.lift) || {}).name : (pistes.byId.get(spot.piste) || {}).name;
      $('#tpWhere').textContent = near ? `${spot.kind === 'lift' ? 'Beim Lift' : 'Op der Pist'} ${near}` : '';
      $('#tpConfirm').hidden = false;
      document.documentElement.dataset.skiTeleport = 'confirm';
    });
    $('#tpYes').addEventListener('click', () => { const s = pending; close(); if (s) { document.documentElement.dataset.skiTeleport = 'go'; onTeleport(s); } });
    $('#tpNo').addEventListener('click', close);
    $('#tpFirst').addEventListener('click', () => { close(); onFirstLift(); });
    map = { ui, pisteMap, close };
  }
  function detachMap() { if (map) { map.ui.remove(); map = null; } }

  return {
    obs, disc, first, rode, tick, save, liftOpen, attachMap, detachMap,
    /** The buildings arrived (loadExtras): the obstacle checks know the houses now. */
    setBuildings(rows) { obs.setBuildings(rows); buildingsReady = true; resolveBuildings(); },
    buildings: () => (buildingsReady ? Promise.resolve() : buildingsPromise),
    /** The boarding spot of any lift (round 6 boardSpot, now with the obstacle and the open-view checks). */
    liftSpot: (l) => liftSpot(l, obs, height),
    /** Debug / flows: discover the whole resort (or a box). */
    discoverAll() { for (let j = 0; j < disc.nz; j++) for (let i = 0; i < disc.nx; i++) disc.reveal((i + 0.5) * disc.cell, (j + 0.5) * disc.cell, 1); save(true); },
  };
}
