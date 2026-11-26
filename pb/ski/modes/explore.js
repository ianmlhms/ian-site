/* Round 7-C: discovery + map teleport + the first lift, glued to the game (main.js keeps only small hooks marked "R7-C").
 *   discovery  the cells round the skier while skiing (HUD rate), the stations he reaches, the line of every lift he rides; saved per
 *              resort locally (progress.disc) and in the cloud record (cloud.js `d`), the cloud copy is merged in (union)
 *   first lift the resort's first lift (config FIRST_LIFT) and its boarding spot (clear.js liftSpot); always discovered
 *   map        the fog over the undiscovered cells (map.js setFog), a tap -> "Nach net entdeckt" or "Hei hin teleportéieren?" (Jo / Nee)
 *              -> the nearest safe spot (clear.js safeSpot), the "Bei den éischte Lift" button; launch: a tap on ANY lift (line or
 *              bottom dot) and the lift list's "Bei de Lift" go to that lift's boarding zone, discovered or not */
import { createObstacles, firstLift, liftSpot, safeSpot } from './clear.js';
import { createDiscovery } from './discovery.js';
import { DISCOVERY, BUS_AREAS } from '../config.js';
import { kindName } from './freeride.js';

const SAVE_EVERY = 4;            // s between saves of a changed discovery
const LIFT_TAP = 12;             // CSS px round a lift's line / bottom dot on the map: a tap there teleports to that lift
const STATION_REACH = 45;        // m from a station = reached
const DIFF_LB = { green: 'Gréng', blue: 'Blo', red: 'Rout', black: 'Schwaarz' };

const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
/** Map card (map clarity): a piste's name, colour, length, drop and heights. */
export function pisteInfo(p) {
  const src = p.src || {};
  const drop = Number.isFinite(src.drop) ? ` · ↓ ${Math.round(src.drop)} m` : '';
  const hts = Number.isFinite(src.top) && Number.isFinite(src.bottom) ? ` · ${Math.round(src.top)} → ${Math.round(src.bottom)} m` : '';
  return { chip: p.diff, name: p.name, facts: `${DIFF_LB[p.diff] || ''} Pist · ${km(p.length)}${drop}${hts}` };
}
/** Map card: a lift's name, kind, length, rise and heights. */
export function liftInfo(l) {
  return { chip: 'lift', name: l.name, facts: `${kindName(l.kind, l.sub)} · ${km(l.len)} · ↑\u00a0${Math.round(l.top.y - l.bottom.y)}\u00a0m · ${Math.round(l.bottom.y)}\u00a0→\u00a0${Math.round(l.top.y)}\u00a0m` };
}

/** The valley lifts of the resort's ski-bus areas (config BUS_AREAS), by name; always discovered. */
export function busLifts(rid, lifts) {
  return (BUS_AREAS[rid] || []).map((name) => lifts.list.find((q) => q.name === name && !q.tunnel)).filter(Boolean);
}

export function createExplore({ rid, resort, store, cloud, field, scatter, density = 1, lifts, pistes, height }) {
  const obs = createObstacles({ resort, field, scatter, density, liftWorld: () => lifts.world });      // R8b: R7-B's stations too
  obs.setPistes(pistes.list);                                              // R8e: start banners clear of other pistes
  const disc = createDiscovery({ width: resort.width, depth: resort.depth, saved: (store.get().disc || {})[rid] || '' });
  const first = firstLift(rid, lifts, resort.places, null);
  if (first) disc.reveal(first.bottom.x, first.bottom.z, DISCOVERY.spawn);
  const bus = busLifts(rid, lifts);                                                    // R8d: Sonnenkopf & co. (ski bus areas)
  for (const l of bus) disc.reveal(l.bottom.x, l.bottom.z, DISCOVERY.spawn);
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
  // launch (Ian: "teleport to every lift"): every lift is open for fast travel from the start (the fog stays for other places)
  const liftOpen = (l) => !!l;

  // ---- the map overlay ----
  let map = null;
  function attachMap({ mapEl, pisteMap, onTeleport, onFirstLift }) {
    detachMap();
    const box = mapEl.querySelector('.mapbox');
    const ui = document.createElement('div');
    ui.className = 'tpui';
    ui.innerHTML = `<button type="button" class="btn tpfirst" id="tpFirst">⌂ Bei den éischte Lift</button>
      <div class="tptoast" id="tpToast" hidden></div>
      <div class="mapcard" id="mapCard" role="dialog" aria-label="Op der Kaart" hidden>
        <button type="button" class="mcclose" id="mcClose" aria-label="Zoumaachen">✕</button>
        <div class="mcinfo" id="tpInfo" hidden><h3><span class="chip" id="mcChip"></span><span id="mcName"></span></h3><div class="mcfacts" id="mcFacts"></div></div>
        <div class="mcnote" id="tpNote" hidden></div>
        <div class="tpconfirm" id="tpConfirm" hidden><b>Hei hin teleportéieren?</b><span id="tpWhere"></span>
          <div class="acts"><button type="button" class="btn primary" id="tpYes">Jo</button><button type="button" class="btn" id="tpDown" hidden>⬇ Erof</button><button type="button" class="btn" id="tpNo">Nee</button></div></div>
      </div>`;
    box.appendChild(ui);
    const $ = (s) => ui.querySelector(s);
    let pending = null, toastTimer = 0;
    const toast = (text) => {
      const t = $('#tpToast'); t.textContent = text; t.hidden = false;
      clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
    };
    // map clarity: the card under the map: what was tapped (piste / lift info), a note, the teleport question (where === null: none)
    const card = ({ info = null, note = '', where = null }) => {
      $('#tpInfo').hidden = !info;
      if (info) { $('#mcChip').className = `chip ${info.chip}`; $('#mcName').textContent = info.name; $('#mcFacts').textContent = info.facts; }
      $('#tpNote').hidden = !note; $('#tpNote').textContent = note;
      $('#tpConfirm').hidden = where === null;
      if (where !== null) $('#tpWhere').textContent = where;
      $('#mapCard').hidden = !info && !note && where === null;
    };
    let pendingDown = null;                              // ride down: the tapped lift's top descent mat ("Erof")
    const close = () => { pending = null; pendingDown = null; $('#tpDown').hidden = true; card({}); pisteMap.setPin(null); document.documentElement.dataset.skiTeleport = ''; };
    pisteMap.setFog(disc);
    /** The lift drawn under a tap (its bottom dot or its line, LIFT_TAP CSS px), discovered or not. */
    const liftTapped = (x, z) => {
      const [px, py] = pisteMap.screenXY(x, z);
      let best = null, bd = LIFT_TAP;
      for (const l of lifts.list) {
        const [x0, y0] = pisteMap.screenXY(l.top.x, l.top.z), [x1, y1] = pisteMap.screenXY(l.bottom.x, l.bottom.z);
        const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2));
        const d = Math.min(Math.hypot(px - x1, py - y1) * 0.8, Math.hypot(px - x0 - dx * t, py - y0 - dy * t) + 4);
        if (d < bd) { bd = d; best = l; }
      }
      return best;
    };
    pisteMap.setTapWorld((x, z, liftHit = null) => {
      const tl = liftHit || liftTapped(x, z);
      if (tl) {                     // a lift: always (its boarding zone, lift-site.js), whether discovered or not
        const w = lifts.boardAt(tl);
        pending = { x: w.x, z: w.z, heading: w.heading, kind: 'lift', lift: tl.id };
        pisteMap.setPin({ x: w.x, z: w.z, ok: true, spot: pending });
        card({ info: liftInfo(tl), where: `Beim Lift ${tl.name}` });
        const d = tl.down && lifts.downAt ? lifts.downAt(tl) : null;
        pendingDown = d ? { x: d.x, z: d.z, heading: d.heading, kind: 'liftdown', lift: tl.id } : null;
        $('#tpDown').hidden = !pendingDown;
        document.documentElement.dataset.skiTeleport = 'confirm';
        return;
      }
      const under = pisteMap.pisteAt ? pisteMap.pisteAt(x, z) : null;          // the piste drawn under the finger (for the card)
      if (!disc.has(x, z)) {
        close(); pisteMap.setPin({ x, z, ok: false }); toast('Nach net entdeckt');
        if (under) card({ info: pisteInfo(under), note: 'Nach net entdeckt: fuer do hin oder huel e Lift an déi Géigend.' });
        document.documentElement.dataset.skiTeleport = 'refused';
        setTimeout(() => { if (!pending) pisteMap.setPin(null); }, 1200);
        return;
      }
      pendingDown = null; $('#tpDown').hidden = true;
      const spot = safeSpot(x, z, { obs, pistes, lifts, height, isOpen: disc.has });
      if (!spot) { close(); toast('Hei ass keng sécher Plaz'); if (under) card({ info: pisteInfo(under) }); document.documentElement.dataset.skiTeleport = 'nospot'; return; }
      pending = spot;
      pisteMap.setPin({ x, z, ok: true, spot });
      const spotLift = spot.kind === 'lift' ? lifts.byId.get(spot.lift) : null, spotPiste = spot.kind === 'lift' ? null : pistes.byId.get(spot.piste);
      const near = (spotLift || spotPiste || {}).name;
      const info = under ? pisteInfo(under) : spotLift ? liftInfo(spotLift) : spotPiste ? pisteInfo(spotPiste) : null;
      card({ info, where: near ? `${spot.kind === 'lift' ? 'Beim Lift' : 'Op der Pist'} ${near}` : '' });
      document.documentElement.dataset.skiTeleport = 'confirm';
    });
    $('#tpYes').addEventListener('click', () => { const s = pending; close(); if (s) { document.documentElement.dataset.skiTeleport = 'go'; onTeleport(s); } });
    $('#tpDown').addEventListener('click', () => { const s = pendingDown; close(); if (s) { document.documentElement.dataset.skiTeleport = 'go'; onTeleport(s); } });
    $('#tpNo').addEventListener('click', close);
    $('#mcClose').addEventListener('click', close);
    $('#tpFirst').addEventListener('click', () => { close(); onFirstLift(); });
    map = { ui, pisteMap, close };
  }
  function detachMap() { if (map) { map.ui.remove(); map = null; } }

  return {
    obs, disc, first, bus, rode, tick, save, liftOpen, attachMap, detachMap,
    /** The buildings arrived (loadExtras): the obstacle checks know the houses now. */
    setBuildings(rows) { obs.setBuildings(rows); buildingsReady = true; resolveBuildings(); },
    buildings: () => (buildingsReady ? Promise.resolve() : buildingsPromise),
    /** The boarding spot of any lift (round 6 boardSpot, now with the obstacle and the open-view checks). */
    liftSpot: (l) => liftSpot(l, obs, height),
    /** Debug / flows: discover the whole resort (or a box). */
    discoverAll() { for (let j = 0; j < disc.nz; j++) for (let i = 0; i < disc.nx; i++) disc.reveal((i + 0.5) * disc.cell, (j + 0.5) * disc.cell, 1); save(true); },
  };
}
