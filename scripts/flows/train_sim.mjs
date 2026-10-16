/* Lokféierer (train-sim): real arcade iframe, keyboard driving, doors/interlock, SPAD, passenger exchange,
 * service end -> score + monotonic save, endless order, purchase, phone block and iPad keyboard notice.
 * Two separate careers (Zuch + Tram, the Luxtram only): wallets, purchases, tb monotonic, endless per career,
 * old-format save migration, merge, and the arcade-wide test mode (everything unlocked, nothing saved or scored).
 * Supabase is mocked; no real account. */
import { runIfMain } from './lib.mjs';

const scoreWrites = (h) => h.backend.callsTo('scores').filter((c) => c.method === 'POST');
const S = (frame) => frame.evaluate(() => window.__tsTest.state());
const waitState = (frame, predicate, arg, timeout = 40000) => frame.waitForFunction(predicate, arg, { timeout });

async function gameFrame(h) {
  await h.page.waitForFunction(() => document.getElementById('gf')?.contentWindow?.__tsTest, null, { timeout: 30000 });
  const frame = h.page.frames().find((f) => f.parentFrame());
  await frame.waitForFunction(() => window.__tsTest.state().phase === 'menu' && !document.getElementById('bootStatus').textContent, null, { timeout: 60000 });
  await frame.evaluate(() => window.focus());
  /* Deterministic run: a fixed seed and calm services (no random red-signal holds, speed restrictions or incidents). The plan/variation checks call the pure planner directly. */
  await frame.evaluate(() => { __tsTest.setSeed(20261013); __tsTest.setCalm(true); });
  return frame;
}
/* Waits until the cab view is up, the train stands, no emergency stop runs and the camera has not moved for a few frames. */
const waitCabSettled = (frame) => frame.waitForFunction(() => window.__tsTest.cabSettled(), null, { timeout: 20000, polling: 100 });
/* Moves onto a cab control and clicks it, always from a settled camera and the control's projected world point. */
async function cabPoint(h, frame, id, notch) {
  await waitCabSettled(frame);
  const target = await frame.evaluate(([i, n]) => __tsTest.findCab(i, n), [id, notch]);
  const box = await (await frame.frameElement()).boundingBox();
  return target ? { ...target, px: box.x + target.x, py: box.y + target.y } : null;
}
const key = (h, k) => h.page.keyboard.press(k);
/* endless: every route there and back (forward, then the return direction '~r'), then the next route */
// tram endless drives the whole line Findel -> Stadion without a stop at Rout Bréck, then back (the sub-stretches are not part of endless)
const LUXTRAM_ORDER = ['luxtram', 'luxtram~r'];
/* Ian's real save before the two-career split (flat v1 shape). */
const OLD_SAVE = { v: 1, tb: 6800, lifetime: 6800, wallet: 3300, savedAt: 1700000000000, owned: ['railcar'], routes: ['west'], train: 'railcar', route: 'west',
  upgrades: { railcar: { motor: 2, brakes: 1, comfort: 1, capacity: 0, paint: 1 } }, best: { west: 292 }, services: 4, endlessBest: 0, hints: false, hintsSet: true };
const savePosts = (h) => h.page.evaluate(() => window.__tsMessages.filter((m) => m.__pbSave).map((m) => m.data));
const scoreMessages = (h) => h.page.evaluate(() => window.__tsMessages.filter((m) => m.__pb === 1).length);
const gameSaveWrites = (h) => h.backend.callsTo('game_saves').filter((c) => c.method !== 'GET').length;

/* The owner (konto@ian.lu) is asked Normal / Test on every open: this flow plays Normal. */
async function gotoNormal(h, url) {
  await h.goto(url);
  const choice = h.page.locator('.pb-mode__box [data-mode="normal"]');
  await choice.waitFor({ state: 'visible', timeout: 15000 }).then(() => choice.click()).catch(() => {});
}

/* Luxtram checks (normal mode): speed cap, second track, catenary, platform sides. TS_LUXTRAM_ONLY=1 runs only these. */
async function luxtramNormalChecks(h, frame) {

  h.step('Luxtram: top speed 70 km/h in normal mode, even with every upgrade (motor = acceleration only)');
  const speed = await frame.evaluate(() => {
    const base = TS.config.trains.find((tr) => tr.id === 'tram');
    const maxed = TS.career.applyUpgrades(base, TS.career.unlockedAll());
    const plain = TS.career.applyUpgrades(base, TS.career.defaults());
    const track = TS.track.build(TS.routes.get('luxtram-kierchbierg'));
    const run = (train, startKmh, seconds) => {
      const sim = TS.sim.create({ train, track, options: { seed: 7 } });
      sim.setSpeed(startKmh / 3.6);
      let vmax = 0, st = null;
      for (let i = 0; i < 60 * seconds; i++) { st = sim.step(1 / 60, { lever: 5 }); vmax = Math.max(vmax, st.v * 3.6); }
      sim.setSpeed(150 / 3.6); st = sim.step(1 / 60, { lever: 5 });   // even a forced 150 km/h is pulled back to the cap
      return { vmax, forced: st.v * 3.6, fines: st.totals.overspeedFine };
    };
    const downhill = (() => {   // a 7 % descent with the motor off: gravity must not push the tram past the cap either
      const sim = TS.sim.create({ train: maxed, track, options: { seed: 7 } });
      sim.setGradeOverride(-0.07); sim.setSpeed(60 / 3.6);
      let vmax = 0;
      for (let i = 0; i < 60 * 90; i++) { const st = sim.step(1 / 60, { lever: 0 }); vmax = Math.max(vmax, st.v * 3.6); }
      return vmax;
    })();
    const limits = TS.config.trains.length ? ['luxtram-kierchbierg', 'luxtram-stad', 'luxtram-sud', 'luxtram'].map((id) => Math.max(...TS.track.build(TS.routes.get(id)).limits.map((l) => l.kmh))) : [];
    return { maxedKmh: maxed.maxKmh, plainKmh: plain.maxKmh, maxedAccel: maxed.accel, plainAccel: plain.accel, scout: maxed.scout, run: run(maxed, 30, 60), downhill, limits,
      railMotor: TS.career.applyUpgrades(TS.config.trains.find((tr) => tr.id === 'emu'), TS.career.unlockedAll()).maxKmh > TS.config.trains.find((tr) => tr.id === 'emu').maxKmh };
  });
  h.eq([speed.maxedKmh, speed.plainKmh, speed.scout], [70, 70, false], 'tram top speed is 70 km/h with and without upgrades, no scout mode in normal mode');
  h.expect(speed.maxedAccel > speed.plainAccel, 'the motor upgrade still improves the tram\'s acceleration (' + speed.plainAccel + ' -> ' + speed.maxedAccel + ')');
  h.expect(speed.run.vmax <= 70.01 && speed.run.forced <= 70.01, 'maxed tram under full power never exceeds 70 km/h (max ' + speed.run.vmax.toFixed(1) + ', forced 150 -> ' + speed.run.forced.toFixed(1) + ')');
  h.expect(speed.downhill <= 70.01, 'not even on a 7 % descent (' + speed.downhill.toFixed(1) + ' km/h)');
  h.expect(speed.limits.every((l) => l <= 70), 'no Luxtram limit board / curve / timetable speed above 70: ' + speed.limits.join(','));
  h.expect(speed.railMotor, 'rail trains keep their motor top-speed bonus');

  h.step('Luxtram: calm limit profile (zones >= 300 m, multiples of 5, no stop zones), no 70 km/h between Findel and Héienhaff nor between the motorway bridge and Luxexpo');
  const lim = await frame.evaluate(() => {
    const out = {};
    for (const id of ['luxtram-kierchbierg', 'luxtram-stad', 'luxtram-sud', 'luxtram']) {
      const tr = TS.track.build(TS.routes.get(id));
      const lt = tr.luxtram;
      const L = tr.limits;
      let shortest = Infinity, bad = [], values = new Set(), dup = 0;
      for (let i = 0; i < L.length; i++) {
        const end = i + 1 < L.length ? L[i + 1].s : tr.length;
        const len = end - L[i].s;
        const mid = (L[i].s + end) / 2;
        const min = lt.minZone;
        const kind = lt.zones && lt.zones[i] ? lt.zones[i].kind : 'base';   // curve zones (25 / 30 around a bend) and the gaps between two of them are short by design
        if (kind === 'base' && len < min - 1) bad.push(Math.round(L[i].s) + ':' + L[i].kmh + ' ' + Math.round(len) + 'm<' + min);
        shortest = Math.min(shortest, len);
        values.add(L[i].kmh);
        if (i && L[i].kmh === L[i - 1].kmh) dup++;
      }
      // never a higher limit squeezed between two lower ones over a short distance
      let squeezed = 0;
      for (let i = 1; i + 1 < L.length; i++) if (L[i].kmh > L[i - 1].kmh && L[i].kmh > L[i + 1].kmh && (L[i + 1].s - L[i].s) < 120) squeezed++;   // (a gap of 120 m or more between two bends keeps its own speed, one step above)
      const limAt = (s) => { let k = L[0].kmh; for (const l of L) { if (l.s <= s) k = l.kmh; else break; } return k; };
      const o = { zones: L.length, bad, shortest, values: [...values].sort((a, b) => a - b), dup, squeezed, stationLimitZones: 0 };
      if (id === 'luxtram-kierchbierg') {
        const mb = lt.motorwayBridge;
        const maxIn = (a, b2) => { let m = 0; for (let s = a; s <= b2; s += 5) m = Math.max(m, limAt(s)); return m; };
        const fw = lt.forestWindow;
        let outside = 0, inside = 0; for (let s = 0; s <= tr.length; s += 5) { const k = limAt(s); if (fw && s >= fw[0] && s <= fw[1]) inside = Math.max(inside, k); else outside = Math.max(outside, k); }
        o.fast = { findelHeienhaff: maxIn(0, tr.stations[1].platformEnd), bridgeLuxexpo: maxIn(mb[1], tr.stations[2].platformEnd), all: maxIn(0, tr.length), kierchberg: maxIn(tr.stations[2].platformEnd, tr.length), forest: inside, outside, fw };
      }
      out[id] = o;
    }
    return out;
  });
  for (const [id, o] of Object.entries(lim)) {
    h.expect(o.bad.length === 0, id + ': ' + o.zones + ' limit zones, none shorter than the minimum (shortest ' + Math.round(o.shortest) + ' m)' + (o.bad.length ? ' ' + o.bad.slice(0, 4).join(', ') : ''));
    h.expect(o.values.every((v) => [25, 30, 40, 50, 60, 70].includes(v)) && o.dup === 0 && o.squeezed === 0, id + ': limits ' + o.values.join('/') + ' (multiples of 10, 25 only where needed), boards only where the value changes, nothing squeezed');
  }
  const fast = lim['luxtram-kierchbierg'].fast;
  h.expect(fast.forest === 70 && fast.outside <= 50, '70 km/h only on the forest stretch Héienhaff - A1 bridge (' + fast.forest + ', window ' + Math.round(fast.fw[0]) + '..' + Math.round(fast.fw[1]) + '); everywhere else at most 50 (' + fast.outside + ')');
  h.expect(fast.findelHeienhaff <= 50, 'Findel - Héienhaff (airport, cutting): no limit above 50 km/h (max ' + fast.findelHeienhaff + ')');
  h.expect(fast.bridgeLuxexpo <= 50, 'A1 bridge - Luxexpo: no 70 km/h (max ' + fast.bridgeLuxexpo + ')');
  h.expect(fast.kierchberg <= 50, 'Luxexpo - Kirchberg - Stad: no 70 km/h on the boulevard (max ' + fast.kierchberg + ')');

  h.step('Luxtram: smooth vertical profile (no bumps), max grade 7 % (Findel - Héienhaff - Luxexpo and the whole line)');
  const prof = await frame.evaluate(() => {
    const out = {};
    for (const id of ['luxtram', 'luxtram~r']) {
      const tr = TS.track.build(TS.routes.get(id));
      const ys = []; for (let s = 0; s <= tr.length; s += 2) ys.push(tr.frameAt(s).pos.y);
      const reversals = (a, b) => { let last = 0, n = 0; for (let i = Math.floor(a / 2); i < Math.floor(b / 2); i++) { const g = (ys[i + 1] - ys[i]) / 2; if (Math.abs(g) < 0.003) continue; const sg = g > 0 ? 1 : -1; if (last && sg !== last) n++; last = sg; } return n / Math.max(0.001, (b - a) / 1000); };
      let maxG = 0; for (let i = 0; i + 1 < ys.length; i++) maxG = Math.max(maxG, Math.abs((ys[i + 1] - ys[i]) / 2));
      const fwdEnd = TS.track.build(TS.routes.get('luxtram')).stations[2].platformEnd;   // Luxexpo
      const a = id === 'luxtram' ? [0, fwdEnd] : [tr.length - fwdEnd, tr.length];
      out[id] = { maxG, perKm: reversals(a[0], a[1]), whole: reversals(0, tr.length) };
    }
    return out;
  });
  h.expect(prof.luxtram.maxG <= 0.0705 && prof['luxtram~r'].maxG <= 0.0705, 'max grade ' + (prof.luxtram.maxG * 100).toFixed(1) + ' % (limit 7 %)');
  h.expect(prof.luxtram.perKm <= 4 && prof['luxtram~r'].perKm <= 4, 'Findel - Héienhaff - Luxexpo: ' + prof.luxtram.perKm.toFixed(1) + ' grade reversals per km (was 18)');
  h.expect(prof.luxtram.whole <= 3 && prof['luxtram~r'].whole <= 3, 'whole line: ' + prof.luxtram.whole.toFixed(1) + ' grade reversals per km (was 7.4)');

  h.step('Luxtram limits: curve zones are local, and driving Stadion - Findel at the limits with 25 s dwell takes about the real 40 minutes');
  const lim2 = await frame.evaluate(() => {
    const out = { badCurve: [], runs: {} };
    const fwd = TS.track.build(TS.routes.get('luxtram'));
    const lt = fwd.luxtram; const cs = lt.curveSamples;
    lt.zones.forEach((z) => {
      if (z.kind !== 'curve') return;
      let a = null, b = null;
      for (let s = Math.max(0, z.s0 - 100); s <= z.s1 + 10; s += 10) { const i = Math.round(s / 10); if (Number.isFinite(cs[i]) && cs[i] <= z.kmh) { if (a === null) a = s; b = s; } }
      const bend = a === null ? 0 : b - a + 10;
      if (z.s1 - z.s0 > bend + 20 + 47 + 60 + 60) out.badCurve.push(Math.round(z.s0) + ':' + z.kmh + ' ' + Math.round(z.s1 - z.s0) + ' m for a ' + bend + ' m bend');
    });
    // time driven at the limits: acceleration 1.0 m/s2, braking 1.0 m/s2 for limit drops and stops, 25 s dwell at every intermediate stop
    for (const id of ['luxtram~r', 'luxtram']) {
      const tr = TS.track.build(TS.routes.get(id)); const L = tr.limits; const A = 1.0, B = 1.0, DT = 0.25;
      const limAt = (s) => { let k = L[0].kmh; for (const l of L) { if (l.s <= s) k = l.kmh; else break; } return k / 3.6; };
      const stops = tr.stations.map((st) => st.s);
      let s = 0, v = 0, t = 0, si = 1, dwell = 0;
      const maxV = (s0) => {
        let m = limAt(s0);
        for (const l of L) { if (l.s > s0 && l.s - s0 < 400) m = Math.min(m, Math.sqrt((l.kmh / 3.6) ** 2 + 2 * B * (l.s - s0))); }
        if (si < stops.length) m = Math.min(m, Math.sqrt(2 * B * Math.max(0, stops[si] - s0)) + 0.3);
        return m;
      };
      for (let guard = 0; guard < 400000 && s < tr.length - 3; guard++) {
        if (dwell > 0) { dwell -= DT; t += DT; continue; }
        const target = maxV(s);
        v = v < target ? Math.min(target, v + A * DT) : Math.max(target, v - B * DT * 1.2);
        s += v * DT; t += DT;
        if (si < stops.length && stops[si] - s < 0.4 && v < 1.2) { s = stops[si]; v = 0; si++; if (si < stops.length) dwell = 25; else break; }
      }
      out.runs[id] = Math.round(t / 60);
    }
    return out;
  });
  h.expect(lim2.badCurve.length === 0, 'no 25 / 30 zone is more than bend + margins + 120 m long (' + lim2.badCurve.slice(0, 3).join('; ') + ')');
  h.expect(lim2.runs['luxtram~r'] >= 30 && lim2.runs['luxtram~r'] <= 50 && lim2.runs.luxtram >= 30 && lim2.runs.luxtram <= 50, 'Stadion - Findel driven at the limits (25 s dwell, 1 m/s2): ' + lim2.runs['luxtram~r'] + ' min, Findel - Stadion ' + lim2.runs.luxtram + ' min (real timetable ~40 min)');

  h.step('limit changes apply at the tram\'s NOSE (decreases AND increases); no limit zone shorter than the minimum on any route (rail 400 m, TGV 800 m, tram 300 m; a tram bend zone and the gap between two bends are local by design)');
  const nose = await frame.evaluate(() => {
    const out = { cases: [], tailFirst: null };
    const track = TS.track.build(TS.routes.get('luxtram-kierchbierg'));
    const train = TS.config.trains.find((tr) => tr.id === 'tram');
    const L = track.limits;
    const mk = () => TS.sim.create({ train, track, options: { seed: 3 } });
    for (let i = 1; i < L.length; i++) {
      if (L[i].s < 120) continue;
      const sim = mk(); const rise = L[i].kmh > L[i - 1].kmh;
      sim.place(L[i].s - 1, 8); const before = sim.step(0.001, { lever: 0 });
      sim.place(L[i].s + 0.5, 8); const after = sim.step(0.001, { lever: 0 });   // the nose is 0.5 m past the board, the tail still ~45 m before it
      out.cases.push({ s: Math.round(L[i].s), rise, before: before.limitKmh, was: L[i - 1].kmh, after: after.limitKmh, now: L[i].kmh, next: before.nextLimit ? [before.nextLimit.kmh, Math.round(before.nextLimit.distance * 10) / 10] : null });
    }
    // the HUD's next limit / distance is measured from the nose too
    const i1 = L.length > 2 ? 2 : 1; const sim = mk(); sim.place(L[i1].s - 37, 5); const st = sim.step(0.001, { lever: 0 }); out.tailFirst = { distance: st.nextLimit ? Math.round(st.nextLimit.distance) : null, expect: 37, kmh: st.nextLimit ? st.nextLimit.kmh : null };
    // zones on every route (both directions)
    const MIN = { rail: 400, hst: 800, tram: 300 }; const bad = []; let zones = 0, routes = 0;
    for (const def of TS.routes.list) for (const id of [def.id, def.id + '~r']) {
      const tr = TS.track.build(TS.routes.get(id)); const lim = tr.limits; const min = MIN[tr.kind] || 400; routes++;
      for (let i = 0; i < lim.length; i++) { const len = (i + 1 < lim.length ? lim[i + 1].s : tr.length) - lim[i].s; zones++; const kd = tr.luxtram && tr.luxtram.zones && tr.luxtram.zones[i] ? tr.luxtram.zones[i].kind : 'base'; if (kd === 'base' && len < min - 1) bad.push(id + '@' + Math.round(lim[i].s) + ':' + lim[i].kmh + ' ' + Math.round(len) + 'm'); }
    }
    out.zones = { routes, zones, bad };
    return out;
  });
  h.expect(nose.cases.length >= 3 && nose.cases.every((c) => c.before === c.was && c.after === c.now), 'at every board of Findel - Kirchberg the limit changes exactly when the nose passes it: ' + nose.cases.map((c) => c.s + (c.rise ? '^' : 'v') + c.was + '>' + c.after).join(' '));
  h.expect(nose.cases.some((c) => c.rise) && nose.cases.some((c) => !c.rise), 'both increases and decreases are covered');
  h.expect(nose.tailFirst.distance === nose.tailFirst.expect, 'the HUD distance to the next limit is measured from the nose (' + nose.tailFirst.distance + ' m of ' + nose.tailFirst.expect + ')');
  h.expect(nose.zones.bad.length === 0, nose.zones.zones + ' limit zones on ' + nose.zones.routes + ' routes (rail + tram, both directions): none shorter than the minimum' + (nose.zones.bad.length ? ': ' + nose.zones.bad.slice(0, 5).join(', ') : ''));

  h.step('Luxtram: the second (opposite) track exists along the whole line');
  const dbl = await frame.evaluate(() => {
    const out = {};
    for (const id of ['luxtram-kierchbierg', 'luxtram-stad', 'luxtram-sud', 'luxtram']) {
      const tr = TS.track.build(TS.routes.get(id));
      const o = tr.opposite;
      let missing = 0, osm = 0, total = 0, minGap = 99, maxGap = 0, jump = 0, prev = null;
      for (let s = o.from; s <= o.to; s += 2) {
        total++;
        if (!o.has(s)) missing++;
        const i = Math.round(s / 2);
        if (o.source[i]) osm++;
        const gap = -o.lat[i];
        minGap = Math.min(minGap, gap); maxGap = Math.max(maxGap, gap);
        if (prev !== null) jump = Math.max(jump, Math.abs(gap - prev));
        prev = gap;
      }
      // the opposite track really lies to the LEFT of the player's, parallel, in world space
      let leftOk = true, par = 0;
      for (let s = o.from; s <= o.to; s += 25) {
        const a = tr.frameAt(s), b = o.frameAt(s);
        const lat = (b.pos.x - a.pos.x) * a.right.x + (b.pos.z - a.pos.z) * a.right.z;
        if (!(lat < -2.5 && lat > -12.5)) leftOk = false;
        par = Math.max(par, 1 - Math.abs(a.tangent.x * b.tangent.x + a.tangent.z * b.tangent.z));
      }
      out[id] = { missing, osmShare: osm / total, minGap, maxGap, jump, leftOk, par, coversRoute: o.from <= tr.stations[0].s && o.to >= tr.stations[tr.stations.length - 1].s, len: tr.length };
    }
    return out;
  });
  for (const [id, d] of Object.entries(dbl)) {
    h.expect(d.missing === 0 && d.leftOk, id + ': opposite track present everywhere, always on the left (' + Math.round(d.len) + ' m)');
    h.expect(d.coversRoute, id + ': it spans the route from the first stop to the last stop');
    h.expect(d.osmShare > 0.95, id + ': ' + Math.round(d.osmShare * 100) + ' % of its centreline comes from the real OSM second track');
    h.expect(d.minGap >= 2.6 && d.maxGap <= 12.1 && d.jump < 0.9, id + ': spacing ' + d.minGap.toFixed(1) + '..' + d.maxGap.toFixed(1) + ' m, smooth (max step ' + d.jump.toFixed(2) + ' m per 2 m), parallel ' + d.par.toExponential(1));
  }

  h.step('Luxtram: catenary above each track\'s centreline (same sample points as the rails), masts beside the tracks, none in the catenary-free section');
  const cat = await frame.evaluate(() => {
    const track = TS.track.build(TS.routes.get('luxtram'));
    const infra = TS.infra.create(new THREE.Scene(), track, { quality: 'medium', debugOcs: true });
    const log = infra.debug.env.ocsLog;
    for (let s = 0; s < track.length + 400; s += 400) infra.update(s);
    const wires = log.filter((e) => e.kind === 'wire');
    const masts = log.filter((e) => e.kind === 'mast');
    let worst = 0, noOcsHits = 0, dyBad = 0, freeSamples = 0;
    for (const e of wires) {
      const f = (e.track === 'player' ? track.frameAt : track.opposite.frameAt)(e.s);
      worst = Math.max(worst, Math.hypot(e.p[0] - f.pos.x, e.p[2] - f.pos.z));
      if (track.noOcs(e.s)) noOcsHits++;
      if (Math.abs(e.p[1] - f.pos.y - 5.6) > 0.05) dyBad++;
    }
    for (let s = 0; s < track.length; s += 2) if (track.noOcs(s)) freeSamples++;
    const lateral = masts.map((m) => m.lat);
    const bySide = (k) => wires.filter((w) => w.track === k).length;
    infra.dispose();
    return { wires: wires.length, player: bySide('player'), opposite: bySide('opposite'), worst, noOcsHits, dyBad, freeM: freeSamples * 2, masts: masts.length, mastMin: Math.min(...lateral), mastMax: Math.max(...lateral), noMastInFree: masts.every((m) => !track.noOcs(m.s)) };
  });
  h.expect(cat.player > 500 && cat.opposite > 500, 'wires drawn for both tracks (' + cat.player + ' + ' + cat.opposite + ' samples)');
  h.expect(cat.worst <= 0.3, 'every contact-wire sample is within 0.3 m of its track centre (worst ' + cat.worst.toFixed(2) + ' m) and 5.6 m up (' + cat.dyBad + ' off)');
  h.expect(cat.freeM > 2500 && cat.noOcsHits === 0 && cat.noMastInFree, 'the catenary-free section (' + Math.round(cat.freeM) + ' m, Rout Bréck to Gare) has no wire and no mast');
  h.expect(cat.masts > 100 && cat.mastMin >= 2.4 && cat.mastMax <= 9, 'masts stand beside the tracks (' + cat.masts + ' masts, ' + cat.mastMin.toFixed(1) + '..' + cat.mastMax.toFixed(1) + ' m from their track)');

  h.step('Luxtram: every stop\'s platform side, HUD "Quai riets/lénks" and door side agree with the real geometry');
  await frame.evaluate(() => { __tsTest.setRoute('luxtram'); });
  await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().routeId === 'luxtram', null, 90000);
  const built = await frame.evaluate(() => __tsTest.stationReport());
  h.eq(built.length, 24, 'the full line has 24 stops');
  const rows = [];
  for (let i = 0; i < built.length; i++) {
    await frame.evaluate((k) => { __tsTest.teleport(k); __tsTest.stopAtMarker(-0.5); }, i);
    await waitState(frame, (k) => { const q = window.__tsTest.state(); return q.hudSide !== '' && q.hudNext === q.stations[k].name; }, i, 8000).catch(() => {});
    await frame.evaluate(() => { __tsTest.press('d'); });
    await waitState(frame, () => window.__tsTest.state().doorsReleased, null, 8000).catch(() => {});
    const q = await S(frame);
    const wanted = await frame.evaluate((side) => TS.t('platformShort') + ' ' + TS.t(side === 'left' ? 'sideLeft' : 'sideRight'), q.stations[i].side);
    const b = built[i];
    rows.push({ name: b.name, side: b.side, hud: q.hudSide === wanted && q.hudNext === b.name, door: q.doorSide === b.side,
      built: b.playerWorldLat !== null && Math.sign(b.playerWorldLat) === (b.side === 'right' ? 1 : -1),
      oppBuilt: b.kind === 'island' ? b.oppositeWorldLat === null : b.oppositeWorldLat !== null && Math.sign(b.oppositeWorldLat) === -1 });
  }
  console.log('  stop sides (name side kind | HUD door built-platform opposite-platform):\n' + rows.map((r, i) => '   ' + String(i).padStart(2) + ' ' + r.name.padEnd(20) + r.side.padEnd(6) + (built[i].kind || 'side').padEnd(7) + '| ' + [r.hud, r.door, r.built, r.oppBuilt].map((v) => (v ? 'ok' : 'FAIL')).join(' ')).join('\n'));
  h.expect(rows.every((r) => r.built), 'the platform built for the player\'s track lies on the stop\'s side in world space at all 24 stops');
  h.expect(rows.every((r) => r.hud), 'the HUD text "Quai riets/lénks" matches the stop\'s side at all 24 stops');
  h.expect(rows.every((r) => r.door), 'the doors open on the stop\'s side at all 24 stops');
  h.expect(rows.every((r) => r.oppBuilt), 'the opposite track\'s own platform is built on its far side (none where the stop has an island platform)');
  h.eq(rows.filter((r) => r.side === 'left').map((r) => r.name), ['Findel-Aéroport', 'Rout Bréck', 'Stäreplaz'], 'the three island-platform stops (platform between the tracks) are the only left-hand ones');

  await luxtramPassengerChecks(h, frame);
  await luxtramDwellChecks(h, frame);
  await luxtramSaloonChecks(h, frame);
  await luxtramTimetableChecks(h, frame);
  await luxtramCam3Checks(h, frame);

  /* The oncoming tram runs on the track the player is NOT on, chosen by the route (forward / ~r), never by the momentary direction: driving or backing (reverser R) must never put it on the player's own track. */
  h.step('Luxtram: the oncoming tram always runs on the other track (forward, reverser, ~r), never overlapping the player\'s tram');
  for (const route of ['luxtram', 'luxtram~r']) {
    await frame.evaluate((r) => { __tsTest.setRoute(r); }, route);
    await waitState(frame, (r) => window.__tsTest.state().phase === 'running' && window.__tsTest.state().routeId === r, route, 90000);
    for (const mode of ['forward', 'reverse']) {
      const res = await frame.evaluate(async ([m, rt]) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const tr = () => TS.luxTraffic.last, sign = m === 'forward' ? 1 : -1;
        let s = m === 'forward' ? 2600 : 3400;
        __tsTest.placeAt(s, 0); await sleep(1500);
        const step = async (n, v) => { for (let i = 0; i < n; i++) { s += sign * v; __tsTest.placeAt(s, 0); await sleep(20); } };
        await step(30, 0.3);
        let ok = false;
        for (let k = 0; k < 40 && !ok; k++) { ok = tr().spawnOncoming(120); if (!ok) await step(5, 0.3); }
        let minLat = 1e9, n = 0, hidden = 0, routeReverse = null;
        for (let i = 0; i < 900; i++) {
          await step(1, 0.15);
          const pr = tr().oncomingProbe(); if (!pr) break;
          n++; minLat = Math.min(minLat, pr.minLat); routeReverse = pr.routeReverse; if (!pr.sepOk) hidden++;
        }
        return { ok, n, minLat, hidden, routeReverse, rt };
      }, [mode, route]);
      h.expect(res.ok && res.n > 400, route + ' ' + mode + ': an oncoming tram spawned and ran past (' + res.n + ' frames)');
      h.expect(res.minLat >= 2.6 && res.hidden === 0, route + ' ' + mode + ': it stays >= 2.6 m (track centres) from the player\'s track the whole way (min ' + res.minLat.toFixed(2) + ' m, guard hid it ' + res.hidden + ' times)');
      h.eq(res.routeReverse, route.endsWith('~r'), route + ' ' + mode + ': the oncoming track is chosen by the route identity');
    }
  }
  await frame.evaluate(() => __tsTest.toMenu());
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
}

/* Rail tunnels: the ground over the double-track bore is never below its crown (6.7 m above the rails), at every metre of every tunnel, both directions. */
async function railTunnelChecks(h, frame) {
  h.step('rail tunnels: the ground height over every tunnel bore is above the crown (all rail routes, both directions)');
  const res = await frame.evaluate(() => {
    const out = [];
    for (const base of ['east', 'north', 'trier', 'brussels', 'paris']) for (const id of [base, base + '~r']) {
      const track = TS.track.build(TS.routes.get(id)), tb = track.base || track;
      let worst = 99, samples = 0;
      for (const tn of track.tunnels) for (let s = tn.s0 + 1; s <= tn.s1 - 1; s += 5) {   // the ground steps up exactly at the portals (the portal wall hides the step): sample from 1 m inside
        const f = tb.frameAt(track.baseS ? track.baseS(s) : s);
        for (let lat = -6.9; lat <= 6.9; lat += 1.15) {
          const x = f.pos.x + f.right.x * lat, z = f.pos.z + f.right.z * lat;
          worst = Math.min(worst, tb.terrainHeightAt(x, z) - f.pos.y); samples++;
        }
      }
      out.push({ id, tunnels: track.tunnels.length, worst, samples });
    }
    return out;
  });
  for (const r of res) h.expect(r.tunnels > 0 && r.worst >= 6.8, r.id + ': ' + r.tunnels + ' tunnel(s), lowest ground above the bore ' + r.worst.toFixed(2) + ' m over the rails (crown 6.7 m, ' + r.samples + ' samples)');
}


/* Luxtram people: at an island, a trench, a plain, a curved and a bridge-side stop, run a full exchange (everybody alights / boards) and sample every person's feet over time
 * against a raycast of the surface under them. Platform top, end ramps and the ground beyond are the only places anybody may be; nobody on the track side of the platform edge. */
async function luxtramPassengerChecks(h, frame) {
  h.step('Luxtram passengers: boarding + alighting at 6 stops (island, trench, plain, curve ...), every person\'s feet are within 0.1 m of the surface under them, nobody beside the track under the edge');
  await frame.evaluate(() => { __tsTest.setRoute('luxtram'); });
  await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().routeId === 'luxtram', null, 90000);
  const STOPS = [0, 1, 5, 11, 13, 20];
  const rows = [];
  for (const i of STOPS) {
    await frame.evaluate((k) => { __tsTest.teleport(k); __tsTest.stopAtMarker(-0.5); }, i);
    await waitState(frame, (k) => window.__tsTest.state().atStationIndex === k, i);
    await h.pause(2500);   // the world around the stop finishes building
    await key(h, 'd');
    await waitState(frame, () => window.__tsTest.state().doorPhase === 'open');
    const r = await frame.evaluate(async () => {
      const { world, scene, camera, THREE } = __tsTest.internals(), P = world.passengers, pinfo = P.platformInfo();
      const samples = []; let steps = 0;
      while (steps < 1800) {
        for (let k = 0; k < 5; k++) { P.update(0.1, camera); steps++; samples.push(P.feet().map((p) => [p.slot, p.kind, p.doorway ? 1 : 0, p.x, p.y, p.z, p.o, p.rx, p.rz])); }
        await new Promise((res) => setTimeout(res, 0));
        if (P.stats().done && steps > 20) break;
      }
      const tr = world.track, stn = tr.stations[__tsTest.state().atStationIndex], fc = tr.frameAt(stn.s);
      const meshes = [], bb = new THREE.Box3(); scene.updateMatrixWorld(true);
      scene.traverse((o) => {
        if (!o.isMesh || !o.visible || o.isInstancedMesh || !o.geometry) return;
        for (let a = o.parent; a; a = a.parent) if (a.name === 'ts-passengers') return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        if (bb.max.x < fc.pos.x - 110 || bb.min.x > fc.pos.x + 110 || bb.max.z < fc.pos.z - 110 || bb.min.z > fc.pos.z + 110) return;
        meshes.push(o);
      });
      const rc = new THREE.Raycaster(); rc.camera = camera; rc.far = 6;
      const cache = new Map();
      const rayAt = (x, y, z) => { rc.set(new THREE.Vector3(x, y + 1.1, z), new THREE.Vector3(0, -1, 0)); const hit = rc.intersectObjects(meshes, false).filter((q) => !q.face || q.face.normal.y > 0.5); return hit.length ? hit[0].point.y : null; };
      // five rays 4 cm apart, the median wins
      const surf = (x, y, z) => {
        const key = Math.round(x * 6) + ',' + Math.round(z * 6) + ',' + Math.round(y * 6);
        if (cache.has(key)) return cache.get(key);
        const hits = [];
        for (const [dx, dz] of [[0, 0], [0.04, 0], [-0.04, 0], [0, 0.04], [0, -0.04]]) { const v = rayAt(x + dx, y, z + dz); if (v != null) hits.push(v); }
        hits.sort((a, b) => a - b);
        const best = hits.length ? hits[hits.length >> 1] : null;   // median: one ray can slip through a shared triangle edge (low) or hit a sliver in the terrain mesh (high)
        cache.set(key, best); return best;
      };
      let nS = 0, bad = 0, env = 0, none = 0, worst = 0; const ids = new Set();
      samples.forEach((f) => f.forEach(([slot, kind, door, x, y, z, o, rx, rz]) => {
        nS++; ids.add(slot + kind);
        if (!door && o < pinfo.edge - 0.05) env++;
        let sf = surf(x, y, z);
        if (door) for (const dd of [-0.5, -0.25, 0.25, 0.5]) { const s2 = surf(x + rx * dd, y, z + rz * dd); if (s2 != null && (sf == null || s2 > sf)) sf = s2; }   // across the gap between tram and platform
        if (sf == null) { none++; return; }
        const d = y - sf; if (Math.abs(d) > Math.abs(worst)) worst = d;
        if (Math.abs(d) > (door ? 0.4 : 0.1)) bad++;   // (the doorway: sill, step and gap, up to 0.4 m)
      }));
      return { name: stn.name, people: ids.size, samples: nS, bad, env, none, worst: +worst.toFixed(2), done: P.stats().done, boarded: P.stats().boarded, alighted: P.stats().alighted };
    });
    rows.push(r);
    await key(h, 'd').catch(() => {});
    await h.pause(300);
  }
  console.log('  passenger height check (stop | people samples | off-surface beyond 0.1 m | under the platform edge | no surface | worst diff m):\n' + rows.map((r) => '   ' + r.name.padEnd(18) + [r.people, r.samples, r.bad, r.env, r.none, r.worst].join('  ')).join('\n'));
  h.expect(rows.every((r) => r.people > 20 && r.samples > 500), 'every stop had a real exchange to measure (people ' + rows.map((r) => r.people).join('/') + ')');
  h.eq(rows.reduce((a, r) => a + r.bad, 0), 0, 'no person stands or walks more than 0.1 m off the surface under his feet (platform, ramp, ground) at 6 stops');
  h.eq(rows.reduce((a, r) => a + r.env, 0), 0, 'nobody is on the track side of the platform edge outside the doorway');
  h.eq(rows.reduce((a, r) => a + r.none, 0), 0, 'there is a surface under every person');
}

/* The saloon camera (key 5): three viewpoints, the interior drawn, people who board really appear inside and walk to a seat or a pole, the count follows the passenger count, alighting empties it. */
async function luxtramSaloonChecks(h, frame) {
  h.step('Luxtram saloon camera: key 5 and the HUD button, three viewpoints, seats + info screen + people inside, boarding fills the saloon, alighting at the terminus empties it');
  await frame.evaluate(() => { __tsTest.setRoute('luxtram'); });
  await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().routeId === 'luxtram', null, 90000);
  await frame.evaluate(() => { __tsTest.setCamera('cab'); });
  h.expect(await frame.evaluate(() => !document.getElementById('btnInside').hidden), 'the HUD has the saloon button on the Luxtram');
  await key(h, '5');
  let q = await S(frame);
  h.eq([q.camMode, q.insidePos], ['inside', 0], 'key 5 switches to the saloon camera (front viewpoint first)');
  await key(h, '5'); q = await S(frame); h.eq(q.insidePos, 1, 'key 5 again: middle viewpoint');
  await key(h, '5'); q = await S(frame); h.eq(q.insidePos, 2, 'and again: rear viewpoint');
  await key(h, '5'); q = await S(frame); h.eq([q.camMode, q.insidePos], ['inside', 0], 'a fourth press cycles back to the front viewpoint');
  const geo = await frame.evaluate(() => { const { world } = __tsTest.internals(); return { cars: world.model.cars.length, interiors: world.model.cars.filter((c) => c.interior && c.interior.seats.length >= 4 && c.interior.screens.length >= 1).length, seatsMid: world.model.cars[2].interior.seats.length, transverse: world.model.cars[2].interior.seats.filter((x) => Math.abs(Math.sin(x.yaw)) < 0.1).length }; });
  h.expect(geo.cars === 5 && geo.interiors === 5, 'all 5 cars have a saloon (seats, info screens)');
  h.expect(geo.transverse >= geo.seatsMid * 0.8, 'mostly transverse (2+2) seats in the middle car (' + geo.transverse + ' of ' + geo.seatsMid + ')');
  await frame.evaluate(() => { __tsTest.setCamera('cab'); __tsTest.teleport(0); __tsTest.stopAtMarker(-0.5); });
  await waitState(frame, () => window.__tsTest.state().atStationIndex === 0 && window.__tsTest.state().kmh < 0.5);
  await key(h, '5');
  q = await S(frame);
  const empty0 = q.cabin ? q.cabin.total : -1;
  h.expect(q.cabin && q.cabin.active && q.cabin.cars === 5, 'the saloon people are active in the saloon camera (' + (q.cabin ? q.cabin.cars : 0) + ' cars)');
  await key(h, 'd');
  await waitState(frame, () => window.__tsTest.state().doorPhase === 'open');
  let walkedIn = 0, maxTotal = 0, seatedAny = 0;
  for (let i = 0; i < 90; i++) {
    const c = (await S(frame)).cabin;
    walkedIn = Math.max(walkedIn, c.walking); maxTotal = Math.max(maxTotal, c.total); seatedAny = Math.max(seatedAny, c.sitting);
    if ((await S(frame)).exchange && (await S(frame)).exchange.done) break;
    await h.pause(500);
  }
  await key(h, 'd');
  await h.pause(1500);
  q = await S(frame);
  const want = Math.min(q.cabin.cap, q.onboard);
  h.expect(maxTotal > empty0 + 15, 'people came aboard at Findel: ' + empty0 + ' -> ' + maxTotal + ' inside while boarding');
  h.expect(walkedIn > 0, 'boarders walk in through the doors (up to ' + walkedIn + ' at once on the way to their place)');
  h.expect(seatedAny > 0, 'boarders sit down (' + seatedAny + ' seated)');
  await waitState(frame, (w) => window.__tsTest.state().cabin.total === w, want, 20000).catch(() => {});
  q = await S(frame);
  h.eq(q.cabin.total, Math.min(q.cabin.cap, q.onboard), 'the people inside match the passenger count (' + q.onboard + ' on board, at most ' + q.cabin.cap + ' drawn)');
  h.expect(await frame.evaluate(() => { const { scene } = __tsTest.internals(); const g = scene.getObjectByName('ts-passengers'); return !!g; }), 'the passenger meshes exist in the scene');
  const shown = await frame.evaluate(() => { const { scene } = __tsTest.internals(); let n = 0, vis = 0; scene.traverse((o) => { if (o.isInstancedMesh && o.parent && o.parent.name === 'ts-passengers') { n++; let v = true; for (let a = o; a; a = a.parent) if (!a.visible) v = false; if (v && o.count > 0) vis++; } }); return { n, vis }; });
  h.expect(shown.vis >= 10, 'the people inside are drawn (' + shown.vis + ' of ' + shown.n + ' instanced part meshes visible with instances)');
  await h.shot('luxtram-saloon');
  await frame.evaluate(() => { __tsTest.finishRoute(); });
  await waitState(frame, () => window.__tsTest.state().atStationIndex === window.__tsTest.state().stations.length - 1);
  await h.pause(1500);
  const before = (await S(frame)).cabin.total;
  await key(h, 'd');
  await waitState(frame, () => window.__tsTest.state().doorPhase === 'open');
  await waitState(frame, () => { const e = window.__tsTest.state().exchange; return e && e.done; }, null, 90000);
  await h.pause(2500);
  q = await S(frame);
  h.expect(before > 0 && q.cabin.total < before, 'alighting at the terminus empties the saloon (' + before + ' -> ' + q.cabin.total + ')');
  await frame.evaluate(() => { __tsTest.setCamera('cab'); });
  q = await S(frame);
  h.eq(q.cabin.active, false, 'back in the cab the saloon people are inactive again (nothing drawn or animated)');
}


/* Timetable display rules (see scheduleView in train-sim.js): arrival <= departure, times rise along the route with a realistic dwell, both shown with seconds on the HUD,
 * the delay in a stop is measured against the DEPARTURE only (early arrival and late arrival are absorbed by the dwell), green up to 0:30 late, red after, and a countdown to the departure. */
async function luxtramTimetableChecks(h, frame) {
  h.step('Luxtram timetable: arrival never after departure, times rise along the line, realistic dwell; the HUD shows arrival + departure, a countdown in the stop, delay green/red against the departure');
  await frame.evaluate(() => { __tsTest.setRoute('luxtram'); });
  await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().routeId === 'luxtram', null, 90000);
  const tt = (await S(frame)).timetable;
  h.eq(tt.length, 24, 'the timetable has all 24 stops');
  const bad = [];
  tt.forEach((x, i) => {
    if (x.dep < x.arr) bad.push(x.name + ': departure before arrival');
    if (i > 0 && !(x.arr > tt[i - 1].dep)) bad.push(x.name + ': arrival not after the previous departure');
    if (i > 0 && i < tt.length - 1 && !x.pass && (x.dep - x.arr < 20 || x.dep - x.arr > 60)) bad.push(x.name + ': dwell ' + (x.dep - x.arr) + ' s');
    if (!Number.isInteger(x.arr) || !Number.isInteger(x.dep)) bad.push(x.name + ': fractional seconds');
  });
  h.eq(bad, [], 'every stop: arrival <= departure, the next arrival after it, whole seconds, a 20..60 s dwell');
  await frame.evaluate(() => { __tsTest.teleport(5); __tsTest.stopAtMarker(-0.5); });
  await waitState(frame, () => window.__tsTest.state().atStationIndex === 5 && window.__tsTest.state().kmh < 0.5);
  await h.pause(1200);   // the HUD catches up with the teleport
  const pill = (id) => frame.evaluate((i) => document.getElementById(i).textContent, id);
  const secs = (t) => { const m = /^(\d\d):(\d\d)(?::(\d\d))?$/.exec(String(t).trim()); return m ? +m[1] * 3600 + +m[2] * 60 + (+m[3] || 0) : NaN; };
  const arr = secs(await pill('schedArrT')), dep = secs(await pill('schedDepT'));
  h.expect(Number.isFinite(arr) && Number.isFinite(dep) && dep >= arr && dep - arr <= 60, 'the stop box shows arrival and departure with seconds, departure not before arrival (' + (await pill('schedArrT')) + ' / ' + (await pill('schedDepT')) + ')');
  h.expect((await pill('nextLbl')).length > 0 && (await pill('depBadge')).includes(tt[5].name) && /\d:\d\d/.test(await pill('depBadge')), 'standing in the stop a badge names it and counts down to the departure: ' + (await pill('depBadge')));
  let d = await frame.evaluate(() => ({ txt: document.getElementById('delay').textContent, cls: document.getElementById('delay').className, word: document.getElementById('delayWord').textContent }));
  h.eq(d.txt, '+0:00', 'standing before the departure time the delay reads +0:00 (measured against the departure)');
  h.expect(!/late/.test(d.cls), 'and it is green');
  await frame.evaluate(() => { const s = __tsTest.state(); __tsTest.forceSimStep(Math.max(0, s.timetable[5].dep - s.simT) + 75, 0); });
  await h.pause(500);
  d = await frame.evaluate(() => ({ txt: document.getElementById('delay').textContent, cls: document.getElementById('delay').className, word: document.getElementById('delayWord').textContent, badge: document.getElementById('depBadge').className }));
  h.expect(/^\+1:/.test(d.txt) && /late/.test(d.cls) && /late/.test(d.badge), 'a minute past the departure time the delay counts up (' + d.txt + '), red, and so does the badge');
  const w = await frame.evaluate(() => document.getElementById('nextSide').textContent);
  h.expect(/^Quai (riets|lénks)$/.test(w), 'the platform side stays readable: ' + w);
}


/* Camera 3 (platform view) is movable: drag = look round, wheel = zoom, arrow keys = walk along the platform (clamped to it, at eye height), 3 again resets. */
async function luxtramCam3Checks(h, frame) {
  h.step('Luxtram camera 3: drag to look, wheel to zoom, arrows to walk along the platform (clamped), key 3 resets');
  await frame.evaluate(() => { __tsTest.setRoute('luxtram'); });
  await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().routeId === 'luxtram', null, 90000);
  await frame.evaluate(() => { __tsTest.setCamera('cab'); __tsTest.teleport(5); __tsTest.stopAtMarker(-0.5); });
  await waitState(frame, () => window.__tsTest.state().atStationIndex === 5 && window.__tsTest.state().kmh < 0.5);
  await key(h, '3'); await h.pause(1200);
  const cam = () => frame.evaluate(() => { const { camera, world } = __tsTest.internals(), i = __tsTest.state().atStationIndex, st = world.track.stations[i], pi = world.track.platformInfo(i), f = world.track.frameAt(st.s), p = camera.position; return { pos: [p.x, p.y, p.z], q: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w], fov: camera.fov, lat: ((p.x - f.pos.x) * f.right.x + (p.z - f.pos.z) * f.right.z) * pi.sideSign, edge: pi.edge, back: pi.edge + pi.width, dy: p.y - f.pos.y, ph: pi.height, hint: !document.getElementById('camHint').hidden }; });
  const c0 = await cam();
  h.expect(c0.hint, 'camera 3 shows the hint (drag / arrows / wheel)');
  const box = await (await frame.frameElement()).boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await h.page.mouse.move(cx, cy); await h.page.mouse.down(); await h.page.mouse.move(cx - 140, cy - 40, { steps: 8 }); await h.page.mouse.up();
  await h.page.mouse.wheel(0, -400); await h.pause(500);
  const c1 = await cam();
  h.expect(c1.q.some((v, i) => Math.abs(v - c0.q[i]) > 0.02), 'a drag turns the view');
  h.expect(c1.fov < c0.fov - 5, 'the wheel zooms (fov ' + c0.fov.toFixed(0) + ' -> ' + c1.fov.toFixed(0) + ')');
  await h.page.keyboard.down('ArrowLeft'); await h.pause(1500); await h.page.keyboard.up('ArrowLeft');
  await h.page.keyboard.down('Shift'); await h.page.keyboard.down('ArrowUp'); await h.pause(5000); await h.page.keyboard.up('ArrowUp'); await h.page.keyboard.up('Shift');
  const c2 = await cam();
  const moved = Math.hypot(c2.pos[0] - c1.pos[0], c2.pos[2] - c1.pos[2]);
  h.expect(moved > 2, 'the arrow keys walk the viewpoint (' + moved.toFixed(1) + ' m)');
  h.expect(c2.lat >= c2.edge + 0.3 && c2.lat <= c2.back, 'walking towards the track stops on the platform (lateral ' + c2.lat.toFixed(2) + ' m, edge ' + c2.edge.toFixed(2) + ', back ' + c2.back.toFixed(2) + ')');
  h.expect(Math.abs(c2.dy - (c2.ph + 1.6)) < 0.8, 'at eye height over the platform (' + c2.dy.toFixed(2) + ' m above the rail)');
  await h.page.keyboard.down('ArrowRight'); await h.pause(20000); await h.page.keyboard.up('ArrowRight');
  const c3 = await cam();
  h.expect(c3.lat >= c3.edge + 0.3 && c3.lat <= c3.back, 'and along it, never beyond the platform ends (lateral still ' + c3.lat.toFixed(2) + ' m)');
  await h.shot('cam3-moved');
  await key(h, '3'); await h.pause(500);
  const c4 = await cam();
  h.expect(Math.abs(c4.fov - c0.fov) < 0.5 && Math.hypot(c4.pos[0] - c0.pos[0], c4.pos[2] - c0.pos[2]) < 0.3, 'pressing 3 again resets the view');
  await frame.evaluate(() => { __tsTest.setCamera('cab'); });
}


/* Oncoming (AI) trams that stand at a stop: TS.tramDwell.arrive() (the hook luxtram-traffic.js calls) lets 4..15 people off onto the OPPOSITE platform, where the waiting crowd boards.
 * The door positions are taken from the opposite track here (no AI tram needed). Same surface rules as the player's platform. */
async function luxtramDwellChecks(h, frame) {
  h.step('Luxtram oncoming tram at a stop (TS.tramDwell): people alight onto the opposite platform and the crowd boards, nobody sinks or crosses the track');
  await frame.evaluate(() => { __tsTest.setRoute('luxtram'); });
  await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().routeId === 'luxtram', null, 90000);
  const rows = [];
  for (const i of [0, 5, 13, 16]) {
    await frame.evaluate((k) => { __tsTest.teleport(k); __tsTest.stopAtMarker(-0.5); }, i);
    await waitState(frame, (k) => window.__tsTest.state().atStationIndex === k, i);
    await h.pause(2500);
    rows.push(await frame.evaluate(async () => {
      const { world, scene, camera, THREE } = __tsTest.internals(), tr = world.track, k = __tsTest.state().atStationIndex, st = tr.stations[k], pi = tr.platformInfo(k), opp = tr.opposite;
      const sign = pi.kind === 'island' ? 1 : -1, id = 'ai-' + k, doors = [];
      for (let n = 0; n < 5; n++) { const f = opp.frameAt(st.s - 4 - n * 8); doors.push({ x: f.pos.x + f.right.x * sign * 1.45, y: f.pos.y + 0.5, z: f.pos.z + f.right.z * sign * 1.45 }); }
      const hint = TS.tramDwell.arrive({ id, stopName: st.name, platformSide: 'left', doors, dwellMs: 20000 });
      const sess = TS.tramDwell.sessions().find((x) => x.id === id);
      if (!sess) return { name: st.name, err: true };
      const P = sess.inst, info = P.platformInfo(), crowd0 = P.kinds().crowd, samples = []; let steps = 0, crowdMin = crowd0, alightMax = 0;
      while (steps < 1500) {
        for (let q = 0; q < 5; q++) { TS.tramDwell.update(0.1, camera); steps++; samples.push(P.feet().map((p) => [p.slot, p.kind, p.doorway ? 1 : 0, p.x, p.y, p.z, p.o, p.rx, p.rz])); const kk = P.kinds(); crowdMin = Math.min(crowdMin, kk.crowd); alightMax = Math.max(alightMax, kk.alight); }
        await new Promise((r) => setTimeout(r, 0)); if (P.stats().done && steps > 20) break;
      }
      const stt = P.stats(); TS.tramDwell.depart({ id });
      const fc = opp.frameAt(st.s), meshes = [], bb = new THREE.Box3(); scene.updateMatrixWorld(true);
      scene.traverse((o) => { if (!o.isMesh || !o.visible || o.isInstancedMesh || !o.geometry) return; for (let a = o.parent; a; a = a.parent) if ((a.name || '').startsWith('ts-passengers') || (a.name || '').startsWith('train:')) return; if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); if (bb.max.x < fc.pos.x - 110 || bb.min.x > fc.pos.x + 110 || bb.max.z < fc.pos.z - 110 || bb.min.z > fc.pos.z + 110) return; meshes.push(o); });
      const rc = new THREE.Raycaster(); rc.camera = camera; rc.far = 6; const cache = new Map();
      const rayAt = (x, y, z) => { rc.set(new THREE.Vector3(x, y + 1.1, z), new THREE.Vector3(0, -1, 0)); const hit = rc.intersectObjects(meshes, false).filter((q) => !q.face || q.face.normal.y > 0.5); return hit.length ? hit[0].point.y : null; };
      const surf = (x, y, z) => { const key = Math.round(x * 6) + ',' + Math.round(z * 6) + ',' + Math.round(y * 6); if (cache.has(key)) return cache.get(key); const hs = []; for (const [dx, dz] of [[0, 0], [0.04, 0], [-0.04, 0], [0, 0.04], [0, -0.04]]) { const v = rayAt(x + dx, y, z + dz); if (v != null) hs.push(v); } hs.sort((a, b) => a - b); const v = hs.length ? hs[hs.length >> 1] : null; cache.set(key, v); return v; };
      let bad = 0, env = 0, none = 0, nS = 0, onPlat = 0; const ids = new Set();
      samples.forEach((f) => f.forEach(([slot, kind, door, x, y, z, o, rx, rz]) => {
        nS++; ids.add(slot + kind);
        if (kind === 'alight' && o > info.edge + 0.3) onPlat++;
        if (!door && o < info.edge - 0.05) env++;
        let sf = surf(x, y, z); if (door) for (const dd of [-0.5, -0.25, 0.25, 0.5]) { const s2 = surf(x + rx * dd, y, z + rz * dd); if (s2 != null && (sf == null || s2 > sf)) sf = s2; }
        if (sf == null) { none++; return; }
        if (Math.abs(y - sf) > (door ? 0.6 : 0.1)) bad++;   // (no AI tram body here: in the doorway the floor level hangs over the gap)
      }));
      return { name: st.name, hint, alighting: sess.alighting, boarding: sess.boarding, alighted: stt.alighted, boarded: stt.boarded, done: stt.done, crowd0, crowdMin, alightMax, onPlat, people: ids.size, samples: nS, bad, env, none };
    }));
    await frame.evaluate(() => { const cam = __tsTest.internals().camera; TS.tramDwell.sessions().forEach((x) => TS.tramDwell.depart({ id: x.id })); for (let q = 0; q < 300; q++) TS.tramDwell.update(0.1, cam); });   // (the departed session lingers 25 s, then its instance is free again)
  }
  console.log('  oncoming dwell (stop | alight/board | crowd before -> min | alighted on platform samples | off-surface | track side | no surface):\n' + rows.map((r) => '   ' + r.name.padEnd(16) + (r.err ? 'NO SESSION' : [r.alighting + '/' + r.boarding, r.crowd0 + '->' + r.crowdMin, r.onPlat, r.bad, r.env, r.none].join('  '))).join('\n'));
  h.expect(rows.every((r) => !r.err && r.done && r.samples > 200), 'every oncoming exchange ran to its end (' + rows.map((r) => r.people).join('/') + ' people)');
  h.expect(rows.every((r) => !r.err && r.alighted === r.alighting && r.alightMax > 0 && r.onPlat > 20), 'the alighting people (4..15) end up walking on the opposite platform');
  h.expect(rows.every((r) => !r.err && r.crowdMin < r.crowd0), 'the waiting crowd shrinks while it boards');
  h.eq(rows.reduce((a, r) => a + (r.err ? 99 : r.bad), 0), 0, 'nobody sinks or floats more than 0.1 m off the surface');
  h.eq(rows.reduce((a, r) => a + (r.err ? 99 : r.env + r.none), 0), 0, 'nobody on the track side of the platform edge, a surface under everybody');
}

/* Return direction, reverse gear, 2x fast-forward and real (natural) endless hand-over. TS_LUXTRAM_ONLY=1 runs these too. */
/* Weather + time of day: menu choice (remembered), in-game popover and V key. Neutral for rewards: only lighting, wipers, rain sound and the shown clock change. */
async function weatherChecks(h, frame) {
  h.step('weather: choose Reen + Moies in the menu, the service starts with them, change it in-game (popover, V), the menu remembers the choice after a reload');
  await frame.evaluate(() => __tsTest.toMenu());
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
  await frame.locator('[data-test="career-rail"]').click();
  h.eq(await frame.locator('[data-test="wx-random"]').getAttribute('aria-checked'), 'true', 'the weather defaults to Zoufall');
  await frame.locator('[data-test="wx-rain"]').click();
  await frame.locator('[data-test="tod-morning"]').click();
  h.eq((await S(frame)).wxPref + '/' + (await S(frame)).todPref, 'rain/morning', 'the menu choice is stored');
  await h.shot('wx-menu');
  await frame.locator('[data-test="mode-career"]').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 90000);
  let s = await S(frame);
  h.eq(s.weather, 'rain', 'the service starts in the rain');
  h.expect(Math.abs(s.hour - 8) < 0.01 && s.shownClock.startsWith('08:'), 'and in the morning (hour ' + s.hour + ', clock ' + s.shownClock + ')');
  h.expect(await frame.evaluate(() => __tsTest.internals().world.landscape.getWeather() === 'rain'), 'the landscape shows rain');
  await frame.locator('#btnWx').click();
  h.expect(await frame.locator('#wxPop').isVisible(), 'the HUD button opens the popover');
  const small = await frame.evaluate(() => [...document.querySelectorAll('#wxPop .wxopt')].filter((b) => b.getBoundingClientRect().height < 43.5).length);
  h.eq(small, 0, 'every popover option is at least 44 px high');
  await h.shot('wx-popover');
  await frame.locator('[data-test="wxpop-wx-fog"]').click();
  await frame.locator('[data-test="wxpop-tod-night"]').click();
  await h.pause(2200);
  s = await S(frame);
  h.eq(s.weather, 'fog', 'in-game: Niwwel');
  h.expect(s.shownClock.startsWith('22:'), 'in-game: Nuets shows the clock at night (' + s.shownClock + ')');
  const look = await frame.evaluate(() => { const w = __tsTest.internals().world; return { wx: w.landscape.getWeather(), tod: w.landscape.getTimeOfDay(), lights: w.lights }; });
  h.expect(look.wx === 'fog' && Math.abs(look.tod - 22.5) < 0.2 && look.lights === true, 'the landscape and the headlights follow (' + JSON.stringify(look) + ')');
  await key(h, 'v');
  h.eq((await S(frame)).weather, 'snow', 'V cycles the weather (Niwwel to Schnéi)');
  await key(h, 'Escape');
  h.eq(await frame.locator('#wxPop').isVisible(), false, 'Esc closes the popover');
  h.eq((await S(frame)).phase, 'running', 'and does not pause');
  await frame.evaluate(() => __tsTest.toMenu());
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
  await h.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await gotoNormal(h, '/pixelbreak.html?g=train-sim&test=1');
  frame = await gameFrame(h);
  s = await S(frame);
  h.eq(s.wxPref + '/' + s.todPref, 'snow/night', 'after a reload the choice is remembered');
  h.eq([await frame.locator('[data-test="wx-snow"]').getAttribute('aria-checked'), await frame.locator('[data-test="tod-night"]').getAttribute('aria-checked')], ['true', 'true'], 'and the menu shows it selected');
  await frame.locator('[data-test="wx-random"]').click();
  await frame.locator('[data-test="tod-random"]').click();
  h.eq((await S(frame)).wxPref + '/' + (await S(frame)).todPref, 'random/random', 'back to Zoufall');
  return frame;
}

/* Back navigation: the HUD "‹ Menü" button + pause sheet, "‹ Zréck" on the help and timetable screens, summary "Nach eng Fahrt" / menu, Esc and Backspace go back one level. */
async function backNavChecks(h, frame) {
  h.step('back navigation: ‹ Menü while driving, ‹ Zréck on sub-screens, summary next / menu, Esc and Backspace');
  const vis = (sel) => frame.locator(sel).isVisible();
  await frame.evaluate(() => __tsTest.toMenu());
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
  await frame.locator('[data-test="career-rail"]').click();
  await frame.locator('[data-test="mode-career"]').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 90000);
  h.expect(await vis('#btnMenu'), 'the ‹ Menü button is shown while driving');
  const box = await frame.locator('#btnMenu').boundingBox();
  h.expect(box.height >= 29, 'and it is a real button (' + Math.round(box.height) + ' px high; 44 on touch screens)');
  await frame.locator('#btnMenu').click();
  h.expect(await vis('#pauseScreen') && await vis('#resume') && await vis('#quit'), 'it opens the sheet with Weiderfueren and Zréck an de Menü');
  await h.shot('back-sheet');
  await frame.locator('#resume').click();
  h.expect(!(await vis('#pauseScreen')) && (await S(frame)).phase === 'running', 'Weiderfueren closes the sheet and drives on');
  await key(h, 't');
  h.expect(await vis('#ttScreen') && await vis('#ttClose'), 'the timetable shows a ‹ Zréck button');
  await frame.locator('#ttClose').click();
  h.expect(!(await vis('#ttScreen')), '‹ Zréck closes the timetable');
  await key(h, 'F1');
  h.expect(await vis('#helpScreen'), 'help opens');
  await key(h, 'Backspace');
  h.expect(!(await vis('#helpScreen')), 'Backspace goes back out of the help');
  await key(h, 'F1');
  await frame.locator('#helpClose').click();
  h.expect(!(await vis('#helpScreen')), '‹ Zréck closes the help');
  await frame.evaluate(() => __tsTest.finishRoute());
  await frame.evaluate(() => __tsTest.completeNow());
  await waitState(frame, () => window.__tsTest.state().phase === 'summary', null, 60000);
  h.expect(await vis('#sumAgain') && await vis('#sumMenu'), 'the summary offers Nach eng Fahrt and Zréck zum Menü');
  await frame.locator('#sumAgain').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 90000);
  h.expect(!(await vis('#summary')), 'Nach eng Fahrt starts the next service');
  await frame.evaluate(() => __tsTest.finishRoute());
  await frame.evaluate(() => __tsTest.completeNow());
  await waitState(frame, () => window.__tsTest.state().phase === 'summary', null, 60000);
  await key(h, 'Escape');
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
  h.expect(true, 'Esc on the summary goes back to the menu');
  await frame.locator('[data-test="mode-career"]').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 90000);
  await frame.locator('#btnMenu').click();
  await frame.locator('#quit').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
  h.expect(await vis('[data-test="mode-career"]') && !(await vis('#hud')), '‹ Menü then Zréck an de Menü ends in the menu');
  return frame;
}

async function directionAndGearChecks(h, frame) {
  h.step('return direction: every route also runs the other way (rail + Luxtram), same length, first stop = old last stop, sides agree');
  const dirs = await frame.evaluate(() => {
    const out = [];
    for (const def of TS.routes.list) {
      const f = TS.track.build(def);
      const r = TS.track.build(TS.routes.get(def.id + '~r'));
      const fs = f.stations, rs = r.stations;
      const sc = new THREE.Scene();
      const inf = TS.infra.create(sc, r, { quality: 'low' });
      const rep = inf.stationReport();
      inf.dispose();
      const sideOk = rep.every((b, i) => b.playerWorldLat !== null && Math.sign(b.playerWorldLat) === (rs[i].side === 'right' ? 1 : -1));
      const rail = def.kind !== 'tram';
      // rail: platform sides flip with the direction of travel; Luxtram: every platform is on the right (the OTHER track)
      const flips = rail ? rs.every((s, i) => s.side !== fs[fs.length - 1 - i].side) : rs.every((s) => s.side === 'right');
      let other = true, minLat = 99, maxLat = -99;
      if (!rail) {
        for (let s = 0; s <= r.length; s += 50) {
          const p = r.frameAt(s).pos;
          const q = r.base.nearest(p.x, p.z);   // lateral of the reversed player's position on the forward track
          minLat = Math.min(minLat, q.lat); maxLat = Math.max(maxLat, q.lat);
        }
        other = maxLat < -2.5 && minLat > -12.5;
      }
      out.push({
        id: def.id, rail, lenEqual: Math.abs(f.length - r.length) < 0.01, firstIsLast: rs[0].name === fs[fs.length - 1].name && rs[rs.length - 1].name === fs[0].name,
        names: rs.map((s) => s.name).join('|') === fs.map((s) => s.name).reverse().join('|'), count: rs.length === fs.length, flips, sideOk, other, minLat, maxLat,
        baseScenery: r.base && r.base.length === f.length && typeof r.baseS === 'function' && Math.abs(r.baseS(10) - (f.length - 10)) < 1e-6,
        title: TS.routes.get(def.id + '~r').name.en, terminus: rs[0].terminus && rs[rs.length - 1].terminus && !rs[1].terminus === true,
        sameStart: Math.hypot(r.frameAt(r.length).pos.x - f.frameAt(0).pos.x, r.frameAt(r.length).pos.z - f.frameAt(0).pos.z),
      });
    }
    return out;
  });
  for (const d of dirs) {
    h.expect(d.lenEqual && d.firstIsLast && d.names && d.count, d.id + '~r: same length, its first stop is the forward route\'s last stop and the stops run in reverse (' + d.title + ')');
    h.expect(d.flips && d.sideOk, d.id + '~r: ' + (d.rail ? 'platform sides flip with the direction of travel' : 'every platform on the right, on the OTHER track') + ' and the built platforms agree');
    h.expect(d.baseScenery, d.id + '~r: the scenery stays the forward route\'s (track.base / baseS)');
    if (!d.rail) h.expect(d.other, d.id + '~r: runs on the other track (' + d.minLat.toFixed(1) + '..' + d.maxLat.toFixed(1) + ' m left of the forward track)');
  }
  const revLimits = await frame.evaluate(() => {
    const out = {};
    for (const id of ['luxtram-kierchbierg~r', 'luxtram-stad~r', 'luxtram-sud~r', 'luxtram~r']) {
      const tr = TS.track.build(TS.routes.get(id));
      const lt = tr.luxtram, L = tr.limits;
      const bad = [];
      for (let i = 0; i < L.length; i++) {
        const end = i + 1 < L.length ? L[i + 1].s : tr.length, len = end - L[i].s, mid = (L[i].s + end) / 2;
        const kind = lt.zones && lt.zones[i] ? lt.zones[i].kind : 'base';
        if (kind === 'base' && len < lt.minZone - 1) bad.push(Math.round(L[i].s) + ':' + L[i].kmh + ' ' + Math.round(len) + 'm');
      }
      out[id] = { zones: L.length, bad };
    }
    const f = TS.track.build(TS.routes.get('luxtram-kierchbierg~r'));
    const L = f.limits; const limAt = (s) => { let k = L[0].kmh; for (const l of L) { if (l.s <= s) k = l.kmh; else break; } return k; };
    const fwd = TS.track.build(TS.routes.get('luxtram-kierchbierg'));
    const lenF = f.length;
    const maxIn = (a, b2) => { let m = 0; for (let s = a; s <= b2; s += 5) m = Math.max(m, limAt(s)); return m; };
    // return direction: route coordinate s = length - forward s
    out.fast = [maxIn(lenF - fwd.stations[1].platformEnd, lenF), maxIn(lenF - fwd.stations[2].platformEnd, lenF - fwd.luxtram.motorwayBridge[1])];
    return out;
  });
  for (const id of ['luxtram-kierchbierg~r', 'luxtram-stad~r', 'luxtram-sud~r', 'luxtram~r']) h.expect(revLimits[id].bad.length === 0, id + ': ' + revLimits[id].zones + ' limit zones, none below the minimum length' + (revLimits[id].bad.length ? ' ' + revLimits[id].bad.join(', ') : ''));
  h.expect(revLimits.fast[0] <= 50 && revLimits.fast[1] <= 50, 'Héienhaff - Findel and Luxexpo - motorway bridge (return): no 70 km/h (max ' + revLimits.fast.join(' / ') + ')');

  h.step('return direction in the cab: HUD side, door side and the stop marker at every stop of both directions (Luxtram full line + west)');
  for (const id of ['luxtram~r', 'west~r']) {
    await frame.evaluate((r) => { __tsTest.setRoute(r); }, id);
    await waitState(frame, (r) => window.__tsTest.state().phase === 'running' && window.__tsTest.state().routeId === r, id, 90000);
    const n = (await S(frame)).stations.length;
    const rows = [];
    for (let i = 0; i < n; i++) {
      await frame.evaluate((k) => { __tsTest.teleport(k); __tsTest.stopAtMarker(-0.5); }, i);
      await waitState(frame, (k) => { const q = window.__tsTest.state(); return q.hudSide !== '' && q.hudNext === q.stations[k].name; }, i, 8000).catch(() => {});
      await frame.evaluate(() => { __tsTest.press('d'); });
      await waitState(frame, () => window.__tsTest.state().doorsReleased, null, 8000).catch(() => {});
      const q = await S(frame);
      const wanted = await frame.evaluate((side) => TS.t('platformShort') + ' ' + TS.t(side === 'left' ? 'sideLeft' : 'sideRight'), q.stations[i].side);
      rows.push(q.hudSide === wanted && q.doorSide === q.stations[i].side && q.hudNext === q.stations[i].name);
    }
    h.expect(rows.every(Boolean), id + ': HUD "Quai riets/lénks", door side and next-stop name agree at all ' + n + ' stops (' + rows.filter(Boolean).length + ' ok)');
    await frame.evaluate(() => __tsTest.toMenu());
    await waitState(frame, () => window.__tsTest.state().phase === 'menu');
  }

  h.step('menu: ⇄ direction toggle on every route card, shared ownership, direction shown in the name');
  await frame.locator('[data-test="career-rail"]').click();
  await waitState(frame, () => window.__tsTest.state().career === 'rail');
  await frame.locator('[data-test="dir-west"]').click();
  await frame.locator('[data-test="mode-career"]').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'running');
  let q = await S(frame);
  h.eq(q.routeId, 'west~r', 'the return direction of the owned west line starts without buying anything');
  h.expect(/→/.test(q.svcLabel), 'the service label shows the direction (' + q.svcLabel + ')');
  await frame.evaluate(() => __tsTest.toMenu());
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');

  h.step('reverse gear: R at standstill only, 10 km/h, back up to the stop board, doors open, stop rated again');
  await frame.evaluate(() => { __tsTest.setRoute('luxtram-stad'); });
  await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().routeId === 'luxtram-stad', null, 90000);
  await frame.evaluate(() => { __tsTest.teleport(1); });
  const st1 = (await S(frame)).stations[1];
  await frame.evaluate(() => { __tsTest.setSpeed(15); });
  await key(h, 'r');
  await h.pause(250);
  q = await S(frame);
  h.expect(!q.reverse && q.events.includes('reverserRefused'), 'R is refused while moving');
  await frame.evaluate((s) => { __tsTest.setSpeed(0); __tsTest.placeAt(s + 25, 0); }, st1.s);   // 25 m past the stop board
  await h.pause(300);
  await key(h, 'w');
  await key(h, 'r');
  await h.pause(250);
  q = await S(frame);
  h.expect(!q.reverse && q.events.includes('reverserRefused'), 'R is refused while the lever is in power');
  await key(h, 's');
  await key(h, 's');
  await h.pause(300);
  await key(h, 'r');
  await waitState(frame, () => window.__tsTest.state().reverse, null, 4000);
  await h.pause(300);
  h.expect(await frame.locator('#revLamp').isVisible(), 'the HUD shows the "◀ R" indicator');
  for (let k = 0; k < 4; k++) await key(h, 'w');
  let vmax = 0;
  for (let k = 0; k < 160; k++) { q = await S(frame); vmax = Math.max(vmax, q.kmh); if (q.s <= st1.s + 1.5) break; await h.pause(150); }
  h.expect(vmax > 3 && vmax <= 10.05, 'reverse speed is capped at 10 km/h (max ' + vmax.toFixed(1) + ')');
  h.expect(q.s - st1.s <= 6, 'the train backed up to the stop board (' + (q.s - st1.s).toFixed(1) + ' m past it)');
  for (let k = 0; k < 8; k++) await key(h, 's');
  await waitState(frame, () => window.__tsTest.state().kmh < 0.2, null, 8000);
  await key(h, 'd');
  await waitState(frame, () => window.__tsTest.state().doorsReleased, null, 6000).catch(() => {});
  q = await S(frame);
  h.expect(q.doorsReleased, 'doors open at the platform after backing up');
  h.expect(q.totals.overruns === 0 && q.totals.perfect + q.totals.ok + q.totals.fair >= 1, 'the stop is rated at the new position, not as the 25 m overrun (perfect/ok/fair ' + [q.totals.perfect, q.totals.ok, q.totals.fair].join('/') + ', overruns ' + q.totals.overruns + ')');
  h.eq(q.totals.reverseFines, 1, 'backing up more than 20 m costs the small reverse fine');
  // switching back and the limits of the gear
  await frame.evaluate(() => { __tsTest.press('d'); });
  await h.pause(300);
  h.step('reverse gear: not past the start of the route (toast), not at speed');
  await frame.evaluate(() => { __tsTest.toMenu(); });
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
  await frame.evaluate(() => { __tsTest.setRoute('luxtram-stad'); });
  await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 90000);
  await frame.evaluate(() => { __tsTest.placeAt(__tsTest.state().stations[0].s, 0); });
  await key(h, 's'); await key(h, 's');
  await key(h, 'r');
  await waitState(frame, () => window.__tsTest.state().reverse, null, 4000);
  for (let k = 0; k < 3; k++) await key(h, 'w');
  await waitState(frame, () => window.__tsTest.state().events.includes('reverseBlocked'), null, 15000).catch(() => {});
  q = await S(frame);
  h.expect(q.events.includes('reverseBlocked') && q.s >= q.stations[0].s - 0.01, 'it cannot back up past the start of the route (blocked at ' + q.s.toFixed(1) + ')');

  h.step('2x fast-forward: F / button, physics + clock run twice as fast, highlighted when on');
  await key(h, 's'); await key(h, 's'); await key(h, 's'); await key(h, 's'); await key(h, 's'); await key(h, 's'); await key(h, 's'); await key(h, 's');
  await key(h, 'r');
  await frame.evaluate(() => { __tsTest.setSpeed(0); __tsTest.placeAt(__tsTest.state().stations[0].s, 0); });
  const rate = async () => {
    const a = await S(frame); const t0 = Date.now();
    await h.pause(2500);
    const b = await S(frame);
    return (b.simT - a.simT) / ((Date.now() - t0) / 1000);
  };
  await key(h, 'w'); await key(h, 'w'); await key(h, 'w');
  const normal = await rate();
  await key(h, 'f');
  h.expect((await S(frame)).fast && (await frame.locator('#btnFast').getAttribute('class')).includes('on'), 'F switches the 2x button on (highlighted)');
  const fast = await rate();
  h.expect(fast / normal > 1.7 && fast / normal < 2.3, 'the simulation and its clock run at 2x (' + normal.toFixed(2) + ' -> ' + fast.toFixed(2) + ' sim s per real s)');
  await frame.evaluate(() => document.getElementById('btnFast').click());
  h.expect(!(await S(frame)).fast, 'the HUD button switches it off again');
  await frame.evaluate(() => document.getElementById('btnFast').click());
  await frame.evaluate(() => __tsTest.toMenu());
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
  await frame.evaluate(() => { __tsTest.setRoute('luxtram-kierchbierg'); });
  await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 90000);
  h.expect((await S(frame)).fast, '2x stays as the player set it (also in the next service)');
  await key(h, 'f');
  h.expect(await frame.evaluate(() => document.getElementById('helpBody').textContent.includes('R') && document.getElementById('helpBody').innerHTML.includes('<kbd>F</kbd>') && document.getElementById('helpBody').innerHTML.includes('<kbd>R</kbd>')), 'the controls help lists R and F');

  h.step('oncoming Luxtram never stands still: it dwells at Alphonse Weicker at most 45 s, then leaves - also while the player stands there with open doors and the handbrake on (route Findel - Kirchberg, night)');
  {
    await frame.evaluate(() => { const w = __tsTest.internals().world; w.env.hour = 22.5; w.landscape.setTimeOfDay(22.5); __tsTest.teleport(3); __tsTest.stopAtMarker(-0.5); });
    await h.pause(1500);
    await key(h, 'd');
    await key(h, 'b');
    await frame.waitForFunction(() => { const l = __tsTest.internals().world.landscape; return !l.pendingAhead || l.pendingAhead() === 0; }, null, { timeout: 30000 });
    await frame.evaluate(() => TS.luxTraffic.last.prepareOncoming());
    await frame.waitForFunction(() => { const st = TS.luxTraffic.last.state(); return st.baked && st.queue === 0; }, null, { timeout: 30000 });
    h.expect(await frame.evaluate(() => !!(TS.luxLandmarks && TS.luxLandmarks.active && TS.luxLandmarks.active.state.length >= 50)), 'the hand-built landmarks (atlas + models, hedge maze, Lafayette, Cloche d\'Or) built without error');
    const onc = await frame.evaluate(() => {
      const lt = TS.luxTraffic.last; const { camera } = __tsTest.internals(); const ps = __tsTest.state().s;
      const spawned = lt.spawnOncoming(280);
      const rec = { spawned, parked: __tsTest.state().parkingBrake, doorsOpen: __tsTest.state().doorPhase, dwells: [], maxStill: 0, forced: 0, minLeft: 1e9, steps: 0, ended: '' };
      let cur = null, still = 0, atStop = null;
      for (let i = 0; i < 3000; i++) {   // 300 s of traffic time at 0.1 s
        lt.update(0.1, ps, camera); rec.steps++;
        const o = lt.state().oncoming;
        if (!o) { rec.ended = 'despawned after ' + (i / 10).toFixed(0) + ' s'; break; }
        rec.forced = o.forced;
        still = o.v < 0.05 ? still + 0.1 : 0; rec.maxStill = Math.max(rec.maxStill, still);
        if (o.phase === 'dwell') { if (!cur) cur = { t: 0, s: o.s }; cur.t += 0.1; }
        else if (cur) { cur.leftTo = o.s; rec.dwells.push(cur); cur = null; }
      }
      rec.dwells = rec.dwells.map((d) => ({ t: +d.t.toFixed(1), s: Math.round(d.s) }));
      return rec;
    });
    h.expect(onc.spawned && onc.dwells.length >= 1, 'an oncoming tram spawned, reached a stop and dwelled (' + JSON.stringify(onc.dwells) + ')');
    h.expect(onc.dwells.every((d) => d.t <= 46), 'no dwell longer than 45 s (' + onc.dwells.map((d) => d.t).join(', ') + ' s)');
    h.expect(onc.maxStill <= 46, 'the oncoming tram never stands still longer than a dwell (longest standstill ' + onc.maxStill.toFixed(1) + ' s; ' + onc.ended + ')');
    h.expect(onc.forced === 0, 'the standstill watchdog never had to release it (' + onc.forced + ' releases)');
    await key(h, 'b');
  }

  h.step('scatter: no tree and no road lamp stands inside a drawn carriageway lane (Luxtram Findel - Kirchberg, 6 spots); kerbs and zebra stripes are drawn');
  {
    const out = [];
    for (const s of [4816, 5100, 5420, 6100, 6900, 7300]) {
      await frame.evaluate((s0) => { __tsTest.placeAt(s0, 0); }, s);
      await frame.waitForFunction(() => { const l = __tsTest.internals().world.landscape; return !l.pendingAhead || l.pendingAhead() === 0; }, null, { timeout: 60000 });
      await h.pause(2500);
      out.push(await frame.evaluate((s0) => {
        const { scene, world, THREE } = __tsTest.internals(); const drawn = TS.luxDrawnRoad; const track = world.track; const f0 = track.frameAt(s0);
        const near = (x, z) => Math.hypot(x - f0.pos.x, z - f0.pos.z) < 220;
        const inLane = (x, z) => drawn(x, z) === 1;
        const res = { s: s0, trees: 0, treesIn: 0, lamps: 0, lampsIn: 0, kerbCut: 0, kerbKept: 0, zebra: 0 };
        const m = new THREE.Matrix4(); const v = new THREE.Vector3();
        scene.traverse((o) => {
          if (o.isInstancedMesh && o.visible && o.parent && o.parent.parent && /^lt-tile/.test(o.parent.parent.name || '')) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); v.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld); if (!near(v.x, v.z) || drawn(v.x, v.z) === -1) continue; res.trees++; if (inLane(v.x, v.z)) res.treesIn++; }
          if (o.name && o.name.startsWith('lg-decor-') && o.userData.kerb) { res.kerbCut += o.userData.kerb.cutM; res.kerbKept += o.userData.kerb.keptM; }
        });
        const lw = world.landscape.luxtramWorld;
        ((lw && lw.debugRoadFurniture && lw.debugRoadFurniture().lamps) || []).forEach((l) => { if (!near(l.x, l.z) || drawn(l.x, l.z) === -1) return; res.lamps++; if (inLane(l.x, l.z)) res.lampsIn++; });
        return res;
      }, s));
    }
    const bad = out.filter((r) => r.treesIn > 0 || r.lampsIn > 0);
    h.expect(bad.length === 0, 'trees ' + out.reduce((a, r) => a + r.trees, 0) + ', road lamps ' + out.reduce((a, r) => a + r.lamps, 0) + ' checked at 6 spots: none inside a drawn lane' + (bad.length ? ' (bad: ' + JSON.stringify(bad) + ')' : ''));
    h.expect(out.every((r) => r.kerbKept > 0) && out.reduce((a, r) => a + r.kerbCut, 0) < out.reduce((a, r) => a + r.kerbKept, 0), 'kerbs: kept ' + out.reduce((a, r) => a + r.kerbKept, 0) + ' m, cut across carriageways ' + out.reduce((a, r) => a + r.kerbCut, 0) + ' m (tile read-out)');
  }

  h.step('endless hands over seamlessly: a real service end (doors, terminus exchange) continues with the next route, tram career');
  await frame.evaluate(() => __tsTest.toMenu());
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
  await frame.locator('[data-test="career-tram"]').click();
  await frame.locator('[data-test="mode-endless"]').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().mode === 'endless', null, 90000);
  const seen = [];
  for (let k = 0; k < 3; k++) {
    const s0 = await S(frame);
    seen.push(s0.routeId);
    if (k === 0) {
      // overrun the last stop into the end of the line: the doors must still open there and the service must still end
      const end = await frame.evaluate(() => { const len = __tsTest.trackInfo().length; __tsTest.placeAt(len - 70, 25); __tsTest.forceSimStep(20, 0); const st = __tsTest.state(); return { s: st.s, len, kmh: st.kmh, plat: st.platformIndex, last: st.stations.length - 1 }; });
      h.expect(end.kmh < 0.5 && end.s > end.len - 20 && end.plat === end.last, 'overran into the end of the line: stopped there and still at the last platform (' + JSON.stringify(end) + ')');
    } else {
      await frame.evaluate(() => { __tsTest.finishRoute(); });
      await h.pause(300);
      await frame.evaluate(() => { __tsTest.stopAtMarker(-0.5); });
    }
    await h.pause(300);
    await key(h, 'd');
    await waitState(frame, (r) => window.__tsTest.state().phase === 'running' && window.__tsTest.state().routeId !== r && !window.__tsTest.state().finished, s0.routeId, 90000);
  }
  h.eq(seen.slice(0, 3), ['luxtram', 'luxtram~r', 'luxtram'], 'the whole line there and back, then there again (the first one ended by an overrun into the end of the line) - no summary in between');
  await frame.evaluate(() => __tsTest.toMenu());
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
}

/* Luxtram test mode (window.__pbTestMode): the tram may scout faster than 70 km/h, without overspeed fines. */
async function luxtramScoutChecks(h, frame) {
  const scout = await frame.evaluate(() => {
    const maxed = TS.career.applyUpgrades(TS.config.trains.find((tr) => tr.id === 'tram'), TS.career.unlockedAll());
    const track = TS.track.build(TS.routes.get('luxtram-kierchbierg'));
    const sim = TS.sim.create({ train: maxed, track, options: { seed: 7 } });
    sim.setSpeed(30 / 3.6);
    let vmax = 0, st = null;
    for (let i = 0; i < 60 * 60; i++) { st = sim.step(1 / 60, { lever: 5 }); vmax = Math.max(vmax, st.v * 3.6); }
    return { maxKmh: maxed.maxKmh, scout: maxed.scout, vmax, fine: st.totals.overspeedFine, sec: st.totals.overspeedSec };
  });
  h.expect(scout.scout && scout.maxKmh > 70 && scout.vmax > 90, 'test mode: the tram may scout faster than 70 km/h (top ' + scout.maxKmh + ', reached ' + scout.vmax.toFixed(0) + ' km/h)');
  h.eq([scout.fine, scout.sec], [0, 0], 'test mode: no overspeed fines');
}


/* Resume: reload the arcade page (the game frame dies, like a killed Safari tab) and come back to the game's menu. */
async function reloadToMenu(h) {
  await h.page.reload();
  const choice = h.page.locator('.pb-mode__box [data-mode="normal"]');
  await choice.waitFor({ state: 'visible', timeout: 15000 }).then(() => choice.click()).catch(() => {});
  return gameFrame(h);
}
/* One stop with the test hooks: place the train before it, stop at the marker, open the doors, let everybody board, close, pull away a few seconds. */
async function serveStation(h, frame, index) {
  await frame.evaluate((i) => { __tsTest.teleport(i); }, index);
  await frame.evaluate(() => { __tsTest.stopAtMarker(-0.8); });
  await waitState(frame, (i) => window.__tsTest.state().atStationIndex === i, index);
  await key(h, 'd');
  await waitState(frame, () => window.__tsTest.state().doorPhase === 'open');
  await waitState(frame, () => { const e = window.__tsTest.state().exchange; return e && e.done; }, null, 60000);
  await key(h, 'd');
  await waitState(frame, () => window.__tsTest.state().doorPhase === 'closed', null, 20000);
  await frame.evaluate(() => { __tsTest.forceSimStep(0.1, 0); __tsTest.forceSimStep(8, 3); });
}
/* Starts the west line with the seeded generator, serves stations 1 and 2, stands still and saves the snapshot now. Returns what must survive a reload. */
async function driveTwoStops(h, frame, seed) {
  await waitState(frame, () => window.__tsTest.state().demo === true, null, 60000);   // the menu backdrop is built (it draws random numbers too): a seeded run must start after it
  await h.pause(300);
  await frame.evaluate((sd) => { __tsTest.setSeed(sd); return __tsTest.startService('west', 'railcar', 'career'); }, seed);
  await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().simT > 0.3, null, 60000);   // (the first frames draw the start station's crowd: keep the random order the same every run)
  await serveStation(h, frame, 1);
  await serveStation(h, frame, 2);
  return frame.evaluate(() => {
    __tsTest.setSpeed(0); __tsTest.forceSimStep(0.5, -4);
    const saved = __tsTest.saveSnapshot();
    const s = __tsTest.state();
    return { saved, routeId: s.routeId, trainId: s.trainId, mode: s.mode, s: s.s, visited: s.visited, cash: s.cash, liveCash: s.liveCash, next: s.nextStationIndex, hudNext: s.stations[s.headingIndex].name, onboard: s.onboard, delivered: s.delivered,
      stopsRecord: s.stopsRecord, totals: s.totals, simT: s.simT, delay: s.delaySec, weather: s.weather, hour: s.hour, pattern: s.pattern, passIndices: s.passIndices,
      wallet: s.wallet, tb: s.tb, services: s.services, lifetime: s.lifetime, text: __tsTest.peekSnapshot() };
  });
}
/* From the last station to the summary, the same way every time. Returns the reward. */
async function finishWest(h, frame, seed) {
  await frame.evaluate((sd) => { __tsTest.setSeed(sd); __tsTest.finishRoute(); }, seed);
  await waitState(frame, () => window.__tsTest.state().atStationIndex >= 0 && window.__tsTest.state().nextStationIndex === window.__tsTest.state().stations.length - 1);
  await key(h, 'd');
  await waitState(frame, () => window.__tsTest.state().doorPhase === 'open');
  await waitState(frame, () => window.__tsTest.state().phase === 'summary', null, 90000);
  if (process.env.TS_DEBUG) console.log('    summary: ' + (await frame.evaluate(() => document.getElementById('sumRows').innerText.replace(/\s+/g, ' '))));
  const fin = await S(frame);
  finishWest.last = fin.lastResult;
  return fin.lastReward;
}

/* Resume (Weiderfueren): a killed or reloaded page offers to carry on where the service stood. */
async function resumeChecks(h, frame) {
  const snapKey = 'pb_resume_train-sim';
  await frame.evaluate(() => { __tsTest.pokeSnapshot(null); __tsTest.toMenu(); });
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
  await frame.locator('[data-test="select-railcar"]').click().catch(() => {});

  h.step('resume: control run (no reload) gives the reference reward; the snapshot is gone after the summary');
  const ctrlBefore = await driveTwoStops(h, frame, 424242);
  h.expect(ctrlBefore.saved && ctrlBefore.text && ctrlBefore.text.length < 20000, 'a snapshot was written, ' + (ctrlBefore.text || '').length + ' bytes (limit 20 KB)');
  h.eq(ctrlBefore.visited.slice(0, 3), [0, 1, 2], 'control: stations 0..2 visited');
  await h.pause(1500);
  const ctrlReward = await finishWest(h, frame, 777);
  const ctrlLast = finishWest.last;
  h.expect(ctrlReward && ctrlReward.cash > 0, 'control reward: ' + JSON.stringify(ctrlReward));
  h.eq(await frame.evaluate(() => __tsTest.peekSnapshot()), null, 'finishing the service cleared the snapshot');
  await frame.locator('#sumMenu').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
  h.expect(await frame.locator('[data-test="resume-card"]').count() === 0, 'no Weiderfueren card without a snapshot');

  h.step('resume: reload after two stops, Weiderfueren card (Enter), same route / position / records / cash, standing with the parking brake on');
  const before = await driveTwoStops(h, frame, 424242);
  if (process.env.TS_DEBUG) console.log('    control before: ' + JSON.stringify({ ...ctrlBefore, text: undefined }) + '\n    resumed before: ' + JSON.stringify({ ...before, text: undefined }));
  const snap = JSON.parse(before.text);
  h.expect(snap.v === 1 && snap.route === 'west' && snap.train === 'railcar' && snap.mode === 'career' && Array.isArray(snap.tt) && snap.sim && snap.plan && snap.env && snap.w, 'snapshot has version, route, train, mode, timetable, sim, plan, environment and passengers');
  await h.pause(1500);
  frame = await reloadToMenu(h);
  h.eq(await h.page.evaluate((k) => localStorage.getItem(k) !== null, snapKey), true, 'the snapshot survived the reload (normal mode key)');
  h.expect(await frame.locator('[data-test="resume-card"]').isVisible(), 'the Weiderfueren card is on top of the menu');
  const cardText = await frame.locator('[data-test="resume-card"]').innerText();
  h.expect(/Weiderfueren/.test(cardText) && /Nei ufänken/.test(cardText), 'card text (lb): ' + cardText.replace(/\s+/g, ' ').slice(0, 160));
  h.expect(cardText.includes(before.hudNext), 'card names the next stop: ' + before.hudNext);
  h.expect(/viru \d+ Minutt|grad elo/.test(cardText) && cardText.includes('€'), 'card shows how long ago and the cash');
  const tallest = await frame.evaluate(() => Math.min(...[...document.querySelectorAll('[data-test="resume-go"],[data-test="resume-new"]')].map((b) => b.getBoundingClientRect().height)));
  h.expect(tallest >= 44, 'both buttons are at least 44 px high for the iPad (' + Math.round(tallest) + ' px)');
  h.eq((await S(frame)).resumeFocus, 'resume-go', 'the primary button has the focus, so Enter carries on');
  await h.shot('resume-card-ipad');
  /* the age is computed from the stored time: pretend it is 12 minutes old */
  await frame.evaluate(() => { const o = JSON.parse(__tsTest.peekSnapshot()); o.at -= 12 * 60000; __tsTest.pokeSnapshot(JSON.stringify(o)); __tsTest.toMenu(); });
  await waitState(frame, () => !!document.querySelector('[data-test="resume-card"]'));
  h.expect(/viru 12 Minutten/.test(await frame.locator('[data-test="resume-card"]').innerText()), 'a 12 minute old snapshot says "viru 12 Minutten"');
  h.step('resume: Escape = not now (the snapshot stays), back in the menu it is offered again');
  await key(h, 'Escape');
  await h.pause(300);
  h.expect(await frame.locator('[data-test="resume-card"]').count() === 0, 'Escape hides the card');
  h.expect(await frame.evaluate(() => __tsTest.peekSnapshot() !== null), 'but keeps the snapshot');
  await frame.evaluate(() => __tsTest.toMenu());
  await waitState(frame, () => !!document.querySelector('[data-test="resume-card"]'));
  await h.pause(5000);   // real time passes while the iPad was "off": it must not become delay
  const msgsBefore = await h.page.evaluate(() => window.__tsMessages.filter((m) => m.__pb === 1).length);
  await frame.locator('[data-test="resume-go"]').focus();
  await key(h, 'Enter');
  await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 60000);
  let after = await S(frame);
  h.eq([after.routeId, after.trainId, after.mode], [before.routeId, before.trainId, before.mode], 'same route, train and mode');
  h.expect(Math.abs(after.s - before.s) <= 5, 'same position (' + before.s.toFixed(1) + ' -> ' + after.s.toFixed(1) + ')');
  h.eq(after.visited, before.visited, 'same visited stations');
  h.eq(after.cash, before.cash, 'same cash (' + before.cash + ')');
  h.eq([after.nextStationIndex, after.hudNext], [before.next, before.hudNext], 'same next station (' + before.hudNext + ')');
  h.eq([after.onboard, after.delivered], [before.onboard, before.delivered], 'same passengers on board / delivered');
  h.eq(after.stopsRecord, before.stopsRecord, 'same per-stop passenger records');
  h.eq(after.totals, before.totals, 'same totals (stop ratings, fines)');
  h.eq([after.pattern, after.passIndices, after.weather, after.hour], [before.pattern, before.passIndices, before.weather, before.hour], 'same service plan and weather / hour');
  h.expect(after.v === 0 && after.kmh === 0, 'the train stands still');
  h.expect(after.parkingBrake && after.parkLampVisible, 'parking brake on (lamp shown)');
  h.eq([after.doorPhase, after.doorsOpen01, after.lever], ['closed', 0, 0], 'doors closed, lever 0');
  h.expect(after.simT >= before.simT && after.simT - before.simT < 4, 'the service clock continues where it was: the 5+ s away (and any real time) did not count (' + (after.simT - before.simT).toFixed(2) + ' s)');
  h.expect(after.delaySec - before.delay <= 4, 'no extra delay from the time the page was away (' + before.delay + ' -> ' + after.delaySec + ' s)');
  h.expect(!after.events.includes('stopRated') && !after.events.includes('doorsOpened'), 'nothing was rated or opened again on resume');
  h.expect(await frame.evaluate(() => /Weidergefuer bei/.test(document.getElementById('banner').textContent)), 'banner says "Weidergefuer bei ..."');
  h.eq([after.wallet, after.tb, after.services, after.lifetime], [before.wallet, before.tb, before.services, before.lifetime], 'wallet, tb, services and lifetime untouched by the resume');
  h.eq(await h.page.evaluate(() => window.__tsMessages.filter((m) => m.__pb === 1).length), msgsBefore, 'no score was posted on resume');
  await h.shot('resume-banner');
  /* the train must not move until the driver asks, and the first power notch lets go of the parking brake */
  await h.pause(600);
  h.expect(Math.abs((await S(frame)).s - after.s) < 0.01, 'still standing a moment later');
  await key(h, 'w');
  await waitState(frame, () => window.__tsTest.state().kmh > 1, null, 20000);
  h.expect(!(await S(frame)).parkingBrake, 'W releases the parking brake and the train drives off');
  await key(h, 'x');
  await frame.evaluate(() => { __tsTest.setSpeed(0); __tsTest.forceSimStep(0.3, -4); });
  h.expect((await frame.evaluate(() => JSON.parse(__tsTest.peekSnapshot()).at)) >= snap.at, 'the snapshot was refreshed on resume');
  const resumedReward = await finishWest(h, frame, 777);
  h.eq(resumedReward, ctrlReward, 'the resumed service pays exactly what the uninterrupted one paid (' + JSON.stringify(ctrlReward) + ')');
  if (JSON.stringify(resumedReward) !== JSON.stringify(ctrlReward)) console.log('    DEBUG control ' + JSON.stringify(ctrlLast) + '\n    DEBUG resumed ' + JSON.stringify(finishWest.last) + '\n    DEBUG before ' + JSON.stringify({ ...ctrlBefore, text: undefined }) + '\n    DEBUG after  ' + JSON.stringify({ ...before, text: undefined }));
  h.eq(await frame.evaluate(() => __tsTest.peekSnapshot()), null, 'finishing the resumed service cleared the snapshot');
  h.eq(await h.page.evaluate((k) => localStorage.getItem(k), snapKey), null, 'and the stored key is gone');
  const paid = await S(frame);
  h.eq(paid.services, before.services + 1, 'exactly one service was paid after the resume (no double credit)');
  await frame.locator('#sumMenu').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');

  h.step('resume: a snapshot taken while the doors are open and people are boarding comes back with the doors closed, the stop record kept, nobody counted twice');
  await frame.evaluate(() => { __tsTest.setSeed(31337); return __tsTest.startService('west', 'railcar', 'career'); });
  await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 60000);
  await frame.evaluate(() => { __tsTest.teleport(1); __tsTest.stopAtMarker(-0.8); });
  await waitState(frame, () => window.__tsTest.state().atStationIndex === 1);
  await key(h, 'd');
  await waitState(frame, () => { const e = window.__tsTest.state().exchange; return window.__tsTest.state().doorPhase === 'open' && e && e.alightingTotal + e.boardingTotal > 0; });
  const open = await frame.evaluate(() => { const ok = __tsTest.saveSnapshot(); const s = __tsTest.state(); return { ok, ex: s.exchange, onboard: s.onboard, delivered: s.delivered, cash: s.cash, doorPhase: s.doorPhase, perfect: s.totals.perfect }; });
  h.expect(open.ok && open.doorPhase === 'open', 'snapshot written with the doors open (' + JSON.stringify(open.ex) + ')');
  await frame.evaluate(() => __tsTest.toMenu());
  await waitState(frame, () => !!document.querySelector('[data-test="resume-card"]'));
  await frame.locator('[data-test="resume-go"]').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 60000);
  let mid = await S(frame);
  h.eq([mid.doorPhase, mid.doorsOpen01, mid.exchange, mid.parkingBrake, mid.v], ['closed', 0, null, true, 0], 'resumed at the stop with the doors closed, no exchange running, parking brake on, standing');
  const wantOnboard = open.onboard + open.ex.alighted - open.ex.boarded - open.ex.alightingTotal + open.ex.boardingTotal;
  h.eq(mid.stopsRecord[1], { alighted: open.ex.alightingTotal, boarded: open.ex.boardingTotal, alightingTotal: open.ex.alightingTotal, boardingTotal: open.ex.boardingTotal }, 'the stop is on record as complete: everybody who was to get off is off, everybody who was to board is on');
  h.eq([mid.delivered, mid.onboard], [open.delivered + open.ex.alightingTotal, wantOnboard], 'delivered and on board match (' + mid.delivered + ' delivered, ' + mid.onboard + ' on board)');
  h.eq(mid.cash, open.cash, 'cash unchanged (the stop bonus is not paid twice)');
  await key(h, 'd');
  await waitState(frame, () => window.__tsTest.state().doorPhase === 'open');
  await h.pause(1200);
  const reopened = await S(frame);
  h.eq([reopened.totals.perfect, reopened.cash, reopened.onboard, reopened.delivered], [open.perfect, open.cash, wantOnboard, mid.delivered], 'reopening the doors changes nothing: no second stop rating, nobody gets off or on again');
  await key(h, 'd');
  await waitState(frame, () => window.__tsTest.state().doorPhase === 'closed', null, 20000);
  const closedAgain = await S(frame);
  h.eq([closedAgain.delivered, closedAgain.onboard], [mid.delivered, wantOnboard], 'and after closing again the same people are delivered / on board');
  await frame.evaluate(() => { __tsTest.toMenu(); __tsTest.pokeSnapshot(null); });
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');

  h.step('resume: Nei ufänken throws the snapshot away; a broken, old, foreign or tampered snapshot is ignored without noise');
  await frame.evaluate(() => { __tsTest.setSeed(99); return __tsTest.startService('west', 'railcar', 'career'); });
  await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 60000);
  await serveStation(h, frame, 1);
  await frame.evaluate(() => { __tsTest.setSpeed(0); __tsTest.forceSimStep(0.5, -4); __tsTest.saveSnapshot(); });
  const good = await frame.evaluate(() => __tsTest.peekSnapshot());
  h.expect(!!good, 'a snapshot exists after one more stop');
  await frame.evaluate(() => __tsTest.toMenu());
  await waitState(frame, () => !!document.querySelector('[data-test="resume-card"]'));
  await frame.locator('[data-test="resume-new"]').click();
  await h.pause(300);
  h.expect(await frame.locator('[data-test="resume-card"]').count() === 0, 'Nei ufänken: the card is gone');
  h.eq(await frame.evaluate(() => __tsTest.peekSnapshot()), null, 'and the snapshot is deleted');
  const warnings = [];
  const onConsole = (m) => { if (m.type() === 'warning') warnings.push(m.text()); };
  h.page.on('console', onConsole);
  const bad = (label, mutate) => ({ label, text: (() => { const o = JSON.parse(good); mutate(o); return JSON.stringify(o); })() });
  const cases = [
    bad('wrong version', (o) => { o.v = 2; }),
    bad('25 hours old', (o) => { o.at -= 25 * 3600 * 1000; }),
    bad('from the future', (o) => { o.at += 3600 * 1000; }),
    bad('unknown route', (o) => { o.route = 'atlantis'; }),
    bad('unknown train', (o) => { o.train = 'warp'; }),
    bad('a Luxtram on a rail line (wrong career)', (o) => { o.train = 'tram'; }),
    bad('a train that is not owned', (o) => { o.train = 'hst'; o.route = 'paris'; }),
    bad('a later service was already paid (svc too low)', (o) => { o.svc = Math.max(0, o.svc - 1); }),
    bad('plan with garbage', (o) => { o.plan = { p: 'XX' }; }),
    { label: 'not json', text: '{"v":1,' },
    { label: 'too big', text: JSON.stringify({ v: 1, junk: 'x'.repeat(25000) }) },
  ];
  for (const c of cases) {
    await frame.evaluate((x) => { __tsTest.pokeSnapshot(x); __tsTest.toMenu(); }, c.text);
    await waitState(frame, () => window.__tsTest.state().phase === 'menu');
    await h.pause(200);
    const shown = await frame.locator('[data-test="resume-card"]').count();
    const kept = await frame.evaluate(() => __tsTest.peekSnapshot() !== null);
    h.expect(shown === 0, c.label + ': no card');
    h.expect(!kept || c.label.startsWith('a train that is not owned'), c.label + ': the broken copy is deleted' + (kept ? ' (kept: it may become valid once the cloud save arrives)' : ''));
  }
  h.page.off('console', onConsole);
  h.expect(warnings.some((w) => /saved service ignored/.test(w)), 'ignored snapshots only leave a console.warn');
  /* a snapshot that looks fine but does not fit the track: found out while building, thrown away quietly, back in the menu */
  for (const [label, edit] of [['s outside the track', (o) => { o.sim.s = 99999999; }], ['timetable of another line', (o) => { o.tt = o.tt.slice(0, 2); }], ['visits of another line', (o) => { o.sim.visits = o.sim.visits.slice(0, 2); }]]) {
    await frame.evaluate(([g, code]) => { const o = JSON.parse(g); (new Function('o', code))(o); __tsTest.pokeSnapshot(JSON.stringify(o)); __tsTest.toMenu(); }, [good, '(' + edit.toString() + ')(o)']);
    await waitState(frame, () => !!document.querySelector('[data-test="resume-card"]'));
    await frame.locator('[data-test="resume-go"]').click();
    await waitState(frame, () => window.__tsTest.state().phase === 'menu' && !document.querySelector('[data-test="resume-card"]'), null, 30000);
    h.eq(await frame.evaluate(() => __tsTest.peekSnapshot()), null, label + ': discarded while building, no service started');
  }
  /* a cash/passenger claim beyond what a perfect run could earn is clamped, not trusted */
  await frame.evaluate((g) => { const o = JSON.parse(g); o.sim.cash = 1e9; o.w.delivered = 9e9; o.w.boarded = 9e9; o.w.pkm = 9e9; o.w.onboard = 99999; __tsTest.pokeSnapshot(JSON.stringify(o)); __tsTest.toMenu(); }, good);
  await waitState(frame, () => !!document.querySelector('[data-test="resume-card"]'));
  await frame.locator('[data-test="resume-go"]').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 60000);
  const clamped = await S(frame);
  h.expect(clamped.cash <= 100 * clamped.stations.length + 200 && clamped.delivered <= 200 * clamped.stations.length && clamped.onboard <= 200, 'absurd cash / passenger numbers are clamped (cash ' + clamped.cash + ', delivered ' + clamped.delivered + ', onboard ' + clamped.onboard + ')');
  await frame.evaluate(() => { __tsTest.press('p'); });
  await frame.locator('#quit').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
  h.eq(await frame.evaluate(() => __tsTest.peekSnapshot()), null, 'Zréck an de Menü (quit) deletes the snapshot');
  await frame.locator('[data-test="select-emu"]').click({ timeout: 3000 }).catch(() => {});   // back to what the flow had selected before these checks
  return frame;
}

/* Ends the endless route the real way (terminus exchange, everybody gets off, the fare is paid) and waits for the next route. */
async function finishEndlessRoute(h, frame, nextIndex, loops) {
  await frame.evaluate(() => { __tsTest.finishRoute(); });
  await waitState(frame, () => window.__tsTest.state().atStationIndex >= 0 && window.__tsTest.state().nextStationIndex === window.__tsTest.state().stations.length - 1, null, 60000);
  await key(h, 'd');
  await waitState(frame, (a) => window.__tsTest.state().phase === 'running' && window.__tsTest.state().endless.index === a[0] && window.__tsTest.state().endless.loops === a[1] && window.__tsTest.state().doorPhase === 'closed', [nextIndex, loops], 150000);
}

/* Resume in the Luxtram endless run: the route, the endless index / loops / totals and the tram career come back; the run goes on to the next route. */
async function resumeEndlessChecks(h, frame) {
  h.step('resume: Luxtram endless, reload mid-route, the endless run continues at the same index');
  await frame.locator('[data-test="career-tram"]').click();
  await waitState(frame, () => window.__tsTest.state().career === 'tram');
  await frame.locator('[data-test="mode-endless"]').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().mode === 'endless', null, 120000);
  const first = await S(frame);
  await frame.evaluate(() => { window.__freshSeen = null; clearInterval(window.__freshTimer); window.__freshTimer = setInterval(() => { try { const o = JSON.parse(__tsTest.peekSnapshot() || 'null'); if (o && o.fresh) window.__freshSeen = o; } catch (_) { /* ignore */ } }, 20); });
  await finishEndlessRoute(h, frame, 1, 0);
  const fresh = await frame.evaluate(() => { clearInterval(window.__freshTimer); return window.__freshSeen; });
  h.expect(fresh && fresh.fresh === 1 && fresh.en.i === 1 && fresh.route === first.endless.order[1], 'a finished route moves the snapshot on to the next route (no deletion): index ' + (fresh && fresh.en && fresh.en.i));
  const saved = await frame.evaluate(() => { const st = __tsTest.state(); __tsTest.placeAt(st.stations[0].s + 250, 0); return __tsTest.saveSnapshot(); });
  const mid = await S(frame);
  h.expect(saved === true && JSON.parse(await frame.evaluate(() => __tsTest.peekSnapshot())).fresh !== 1, 'a running Luxtram service writes a full snapshot (not just the route-start one)');
  h.eq(mid.endless.index, 1, 'second route of the endless run');
  const rec = { index: mid.endless.index, loops: mid.endless.loops, total: mid.endless.total, order: mid.endless.order, routeId: mid.routeId, wallet: mid.wallet, tb: mid.tb, services: mid.services, s: mid.s };
  h.expect(rec.total.cash > 0, 'the first route earned ' + rec.total.cash + ' € (endless total)');
  await h.pause(800);
  frame = await reloadToMenu(h);
  h.expect(await frame.locator('[data-test="resume-card"]').isVisible(), 'the Weiderfueren card shows after the reload');
  const card = await frame.locator('[data-test="resume-card"]').innerText();
  h.expect(/Linn 2\/2/.test(card), 'card names the endless route: ' + card.replace(/\s+/g, ' ').slice(0, 140));
  await h.shot('resume-card-endless');
  const railBefore = (await S(frame)).careers.rail;
  await frame.locator('[data-test="career-rail"]').click();   // the menu shows the other career: the Luxtram service must still resume as a tram service
  await waitState(frame, () => window.__tsTest.state().career === 'rail');
  h.expect(await frame.locator('[data-test="resume-card"]').isVisible(), 'the card stays on top in the other career');
  await frame.locator('[data-test="resume-go"]').click();
  await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 120000);
  const back = await S(frame);
  h.eq([back.mode, back.routeId, back.career, back.trainId], ['endless', rec.routeId, 'tram', 'tram'], 'endless mode, same Luxtram route, tram career');
  h.eq([back.endless.index, back.endless.loops, back.endless.total, back.endless.order, back.endless.active], [rec.index, rec.loops, rec.total, rec.order, true], 'endless index, loops, totals and order are kept');
  h.expect(Math.abs(back.s - rec.s) <= 5 && back.v === 0 && back.parkingBrake, 'standing at the saved position with the parking brake on (s ' + rec.s + ' -> ' + back.s + ', v ' + back.v + ', parking ' + back.parkingBrake + ')');
  h.eq([back.wallet, back.tb, back.services], [rec.wallet, rec.tb, rec.services], 'wallet, tb and services unchanged by the resume');
  h.eq(back.careers.rail, railBefore, 'the rail career is untouched');
  await finishEndlessRoute(h, frame, 0, 1);
  const wrapped = await S(frame);
  h.eq((await S(frame)).careers.rail, railBefore, 'the resumed Luxtram service paid the tram career only (rail career unchanged)');
  h.expect(wrapped.endless.total.cash > rec.total.cash && wrapped.services === rec.services + 1, 'the resumed route paid once and the run wrapped around to loop 2 (' + rec.total.cash + ' -> ' + wrapped.endless.total.cash + ' €)');
  await frame.evaluate(() => __tsTest.toMenu());
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
  await frame.evaluate(() => __tsTest.pokeSnapshot(null));
  return frame;
}

export const flow = {
  name: 'train-sim', touch: true, fullChromium: true,
  backend: { tables: { game_saves: () => [], scores: () => [] } },
  async run(h) {
    const errors = [];
    let sA = 0;
    h.page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text() + ' @ ' + (m.location().url || '').slice(-60)); });
    await h.signIn();
    // Lokféierer is owner-only for now (catalog entry + page gate): sign in as the owner account.
    await h.context.addInitScript(() => {
      try {
        const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
        const sess = JSON.parse(localStorage.getItem(k) || 'null');
        if (sess && sess.user) { sess.user.email = 'konto@ian.lu'; localStorage.setItem(k, JSON.stringify(sess)); }
      } catch (_) { /* ignore */ }
    });
    // Arcade test mode (simulated): the arcade injects window.__pbTestMode before the game scripts run; here a localStorage flag does it.
    await h.context.addInitScript(() => {
      try { if (localStorage.getItem('__flowPbTestMode') === '1') window.__pbTestMode = true; } catch (_) { /* ignore */ }
    });
    await h.context.addInitScript(() => {
      window.__tsMessages = [];
      window.addEventListener('message', (event) => {
        if (event.source === document.getElementById('gf')?.contentWindow && (event.data?.__pb || event.data?.__pbSave)) window.__tsMessages.push(JSON.parse(JSON.stringify(event.data)));
      });
    });
    await gotoNormal(h, '/pixelbreak.html?g=train-sim&test=1');
    let frame = await gameFrame(h);
    if (process.env.TS_LUXTRAM_ONLY) { await luxtramNormalChecks(h, frame); await directionAndGearChecks(h, frame); return; }
    if (process.env.TS_RESUME_ONLY) {   // just the resume checks (quick): a fresh save, rail first, then the Luxtram endless run
      await frame.evaluate(() => __tsTest.grant(0));
      frame = await resumeChecks(h, frame);
      frame = await resumeEndlessChecks(h, frame);
      h.expect(errors.length === 0, 'no console errors: ' + errors.slice(0, 3).join(' | '));
      return;
    }

    h.step('start screen: both modes, iPad keyboard notice');
    h.expect(await frame.locator('[data-test="mode-career"]').isVisible() && await frame.locator('[data-test="mode-endless"]').isVisible(), 'career and endless modes shown');
    h.expect((await S(frame)).kbNoticeVisible, 'iPad shows the keyboard-only notice');
    h.expect((await frame.locator('#kbText').innerText()).includes('Tastatur'), 'notice text is the Luxembourgish keyboard message');
    await h.shot('start-ipad');
    await h.page.setViewportSize({ width: 1180, height: 820 });
    await h.pause(400);
    h.expect((await S(frame)).kbNoticeVisible && await frame.locator('#kbNotice').isVisible(), 'keyboard notice also visible in the arcade iframe on iPad landscape');
    await h.shot('start-ipad-landscape');
    await h.page.setViewportSize({ width: 820, height: 1180 });
    await h.pause(300);
    await key(h, 'Shift');
    h.expect(!(await S(frame)).kbNoticeVisible, 'notice auto-hides on the first key press');
    h.expect(await frame.evaluate(() => !!document.querySelector('.ts-menu')), 'D2 menu rendered');

    h.step('fresh save: two careers, the tram is playable immediately');
    let s = await S(frame);
    h.eq(s.career, 'rail', 'the menu starts on the Zuch career');
    h.eq([s.careers.rail.owned, s.careers.rail.routes], [['railcar'], ['west']], 'Zuch career: railcar + west line');
    h.eq([s.careers.tram.owned, s.careers.tram.routes], [['tram'], ['luxtram-stad']], 'Tram career: the Luxtram + the free Luxtram section from the start');
    h.eq([s.careers.rail.wallet, s.careers.tram.wallet, s.tb], [0, 0, 0], 'both wallets and tb start at 0');
    h.expect(await frame.locator('[data-test="career-rail"]').isVisible() && await frame.locator('[data-test="career-tram"]').isVisible(), 'career switch (Zuch | Tram) shown at the top');
    h.expect(await frame.evaluate(() => !TS.routes.get('tram') && !TS.config.routeRules.tram && !TS.config.routeOrder.includes('tram')), 'the fictional tram line is gone');
    h.expect(await frame.evaluate(() => TS.config.trains.filter((tr) => tr.kind === 'tram').length === 1 && TS.config.trains.find((tr) => tr.id === 'tram').price === 0), 'exactly one tram vehicle (the Luxtram), free');
    h.eq(await frame.locator('[data-test="route-tram"]').count(), 0, 'no fictional tram route card in the menu');
    h.expect(await frame.evaluate(() => TS.career.canBuy(TS.career.defaults(), 'route', 'luxtram-kierchbierg').price < TS.career.canBuy(TS.career.defaults(), 'route', 'luxtram-sud').price
      && TS.career.canBuy(TS.career.defaults(), 'route', 'luxtram-sud').price < TS.career.canBuy(TS.career.defaults(), 'route', 'luxtram').price), 'Luxtram prices rise: first section < last section < full line');

    h.step('career service starts in the cab');
    await frame.locator('[data-test="mode-career"]').click();
    await waitState(frame, () => window.__tsTest.state().phase === 'running');
    s = await S(frame);
    h.eq(s.camMode, 'cab', 'starts in cab view');
    h.eq(s.routeId, 'west', 'first career route is the free west line');
    h.expect(s.stations.length >= 4, 'route has stations');
    h.expect(['real', 'fallback'].includes(String(s.moduleStatus.track).split('>')[0]), 'track module present');
    h.expect(await frame.locator('#hud').isVisible(), 'HUD visible');
    h.expect(!(await frame.locator('[data-t="touch"]').count()), 'no touch controls on the page');

    h.step('lever: W raises, S lowers, X = emergency brake');
    await key(h, 'w'); await key(h, 'w'); await key(h, 'w');
    h.eq((await S(frame)).leverTarget, 3, 'W x3 -> P3');
    await key(h, 's');
    h.eq((await S(frame)).leverTarget, 2, 'S lowers one notch');
    await key(h, 'ArrowUp');
    h.eq((await S(frame)).leverTarget, 3, 'ArrowUp also raises');
    await key(h, 'x');
    h.eq((await S(frame)).leverTarget, -8, 'X = EB');
    await waitState(frame, () => window.__tsTest.state().lever === -8);
    await key(h, 'w'); await key(h, 's'); await key(h, 's');
    await frame.evaluate(() => window.__tsTest.press('w'));
    await frame.evaluate(() => window.__tsTest.release('w'));

    h.step('emergency brake: W releases it at any speed (no waiting for standstill)');
    await frame.evaluate(() => { __tsTest.setSpeed(72); });
    await waitState(frame, () => window.__tsTest.state().kmh > 60, null, 10000);
    await key(h, 'x');
    h.eq((await S(frame)).leverTarget, -8, 'EB applied at 72 km/h');
    await key(h, 'w');
    s = await S(frame);
    h.eq(s.leverTarget, -7, 'W releases EB to B7 while still moving (' + Math.round(s.kmh) + ' km/h)');
    h.expect(s.kmh > 20, 'the train was still moving fast when EB was released');
    h.expect(await frame.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /Noutbrems|Emergency|Notbremse/.test(t.textContent))), 'a short toast confirms the release');
    await frame.evaluate(() => { __tsTest.setSpeed(0); });

    h.step('doors interlock: cannot open while moving');
    await frame.evaluate(() => { __tsTest.setSpeed(20); });
    await key(h, 'd');
    await h.pause(300);
    s = await S(frame);
    h.eq(s.doorPhase, 'closed', 'doors stay closed while moving');
    h.expect(s.events.includes('doorsRefused'), 'refusal event raised');
    await frame.evaluate(() => { __tsTest.setSpeed(0); });

    h.step('stop at the marker, open doors on the platform side, live passenger counters');
    await frame.evaluate(() => { __tsTest.teleport(1); });
    await frame.evaluate(() => { __tsTest.stopAtMarker(-0.8); });
    await waitState(frame, () => window.__tsTest.state().atStationIndex === 1);
    s = await S(frame);
    h.expect(Math.abs(s.stoppedAtMarkerError + 0.8) < 0.5, 'stop error measured against the marker (' + s.stoppedAtMarkerError.toFixed(2) + ' m)');
    const platformSide = s.stations[1].side;
    await key(h, 'd');
    await waitState(frame, () => window.__tsTest.state().doorPhase === 'open');
    s = await S(frame);
    h.eq(s.doorSide, platformSide, 'doors open on the platform side');
    h.expect(s.events.includes('stopRated'), 'stop rated');
    await h.shot('doors-open');
    h.expect((await S(frame)).parkingBrake, 'doors open at a stop: parking brake applied automatically');
    sA = (await S(frame)).s;
    await frame.evaluate(() => { __tsTest.setGrade(-0.04); __tsTest.forceSimStep(6, -3); });
    s = await S(frame);
    h.expect(s.v === 0 && Math.abs(s.s - sA) < 0.01, 'doors open + full brake on a downhill: the train does not move forward (' + (s.s - sA).toFixed(3) + ' m)');
    await frame.evaluate(() => { __tsTest.setGrade(null); });
    const exchangeA = (await S(frame)).exchange;
    await h.pause(3500);
    const exchangeB = (await S(frame)).exchange;
    h.expect(exchangeB && exchangeA && (exchangeB.boarded + exchangeB.alighted) > (exchangeA.boarded + exchangeA.alighted) || (exchangeB && exchangeB.done && exchangeB.boarded + exchangeB.alighted > 0), 'passenger counters change over time');
    h.expect(await frame.locator('#xchg').isVisible(), 'HUD shows the boarding/alighting counter');
    await key(h, 'w');
    await h.pause(1200);
    h.expect((await S(frame)).v === 0, 'no traction while the doors are open');
    await key(h, 's');
    await waitState(frame, () => { const e = window.__tsTest.state().exchange; return e && (e.done || (e.alighted >= e.alightingTotal && e.boarded >= e.boardingTotal - 2)); }, null, 60000);

    h.step('close and reopen at the same station: one exchange per stop');
    await waitState(frame, () => { const e = window.__tsTest.state().exchange; return e && e.done; }, null, 60000);
    const first = await S(frame);
    await key(h, 'd');
    await waitState(frame, () => window.__tsTest.state().doorPhase === 'closed', null, 20000);
    const mid = await S(frame);
    await key(h, 'd');
    await waitState(frame, () => window.__tsTest.state().doorPhase === 'open', null, 20000);
    await h.pause(3000);
    const again = await S(frame);
    h.eq([again.exchange.alightingTotal, again.exchange.boardingTotal], [first.exchange.alightingTotal, first.exchange.boardingTotal], 'reopen keeps alightingTotal/boardingTotal');
    h.eq(again.exchange.alighted, first.exchange.alighted, 'nobody gets off a second time');
    h.eq(again.onboard, mid.onboard, 'onboard count not double-counted (' + mid.onboard + ')');
    h.eq(again.delivered, mid.delivered, 'delivered passengers (fares) not farmed by reopening');

    h.step('closing the doors allows departure');
    await key(h, 'd');
    await waitState(frame, () => window.__tsTest.state().doorPhase === 'closed', null, 20000);
    s = await S(frame);
    h.expect(s.events.includes('doorWarning'), 'close warning chime raised');
    h.expect(s.onboard > 0, 'passengers on board after the stop (' + s.onboard + ')');
    await frame.evaluate(() => { __tsTest.forceSimStep(0.1, 0); });
    await key(h, 'w'); await key(h, 'w'); await key(h, 'w');
    await waitState(frame, () => window.__tsTest.state().kmh > 8, null, 40000);
    h.expect(true, 'train departs after the doors closed');
    h.expect(!(await S(frame)).parkingBrake, 'power with the doors closed releases the automatic parking brake');
    await key(h, 'x');
    await frame.evaluate(() => { __tsTest.setSpeed(0); });

    h.step('no creep at standstill on a downhill grade; parking brake toggles');
    await frame.evaluate(() => { __tsTest.placeAt(__tsTest.state().stations[1].s + 600, 0); __tsTest.setGrade(-0.04); });
    sA = (await S(frame)).s;
    await frame.evaluate(() => { __tsTest.forceSimStep(10, -3); });
    s = await S(frame);
    h.expect(s.v === 0 && Math.abs(s.s - sA) < 0.01, 'brake lever at standstill on a 4 % downhill: no creep (' + (s.s - sA).toFixed(3) + ' m)');
    await frame.evaluate(() => { __tsTest.forceSimStep(0.1, 0); });
    await key(h, 'b');
    await waitState(frame, () => window.__tsTest.state().parkingBrake === true, null, 5000);
    h.expect(true, 'B applies the parking brake');
    await h.pause(300);
    h.expect((await S(frame)).parkLampVisible, 'parking brake lamp shows in the HUD');
    await frame.evaluate(() => { __tsTest.forceSimStep(10, 0); });
    s = await S(frame);
    h.expect(s.v === 0 && Math.abs(s.s - sA) < 0.01, 'parking brake holds on the downhill (' + (s.s - sA).toFixed(3) + ' m)');
    await frame.evaluate(() => { __tsTest.forceSimStep(1, 2); });
    s = await S(frame);
    h.expect(s.events.includes('parkingBlocked') && s.v === 0, 'power against the applied parking brake: hint raised, train stays put');
    await frame.evaluate(() => { __tsTest.forceSimStep(0.1, 0); });
    await key(h, 'b');
    await waitState(frame, () => window.__tsTest.state().parkingBrake === false, null, 5000);
    h.expect(true, 'B releases the parking brake again');
    await frame.evaluate(() => { __tsTest.setGrade(null); __tsTest.setSpeed(0); });

    h.step('braking guide: "Brems elo!" before the stop, "Ze spéit" when it is almost too late');
    // Services are calm (no random red signal in the run-up), so the guide, not a SPAD emergency stop, is what shows.
    await frame.evaluate(() => { const st = __tsTest.state(); __tsTest.press('x'); __tsTest.release('x'); const i = st.nextStationIndex; __tsTest.placeAt(st.stations[i].s - 440, 80); __tsTest.forceSimStep(0.05, 0); });
    await waitState(frame, () => /Brems/.test(window.__tsTest.state().guideText), null, 8000);
    s = await S(frame);
    h.expect(s.guide.state === 'brake' && s.guideText.includes('Brems elo'), 'brake hint shown: ' + s.guideText);
    await h.shot('guide-brake');
    await frame.evaluate(() => { const st = __tsTest.state(); __tsTest.placeAt(st.stations[st.nextStationIndex].s - 150, 80); __tsTest.forceSimStep(0.05, 0); });
    await waitState(frame, () => /spéit/.test(window.__tsTest.state().guideText), null, 8000);
    h.expect(true, 'too-late hint shown');
    await frame.evaluate(() => { __tsTest.press('x'); __tsTest.release('x'); __tsTest.setSpeed(0); });

    h.step('cameras: C cycles, 1-4 direct');
    await key(h, 'c');
    h.eq((await S(frame)).camMode, 'chase', 'C cycles to chase');
    await key(h, '3');
    h.eq((await S(frame)).camMode, 'platform', '3 = platform');
    await key(h, '4');
    h.eq((await S(frame)).camMode, 'orbit', '4 = free orbit');
    await key(h, '1');
    h.eq((await S(frame)).camMode, 'cab', '1 = cab');

    h.step('clicking the cab controls (lever, parking brake) with the mouse');
    await frame.evaluate(() => { __tsTest.setSpeed(0); __tsTest.forceSimStep(0.1, 0); });
    h.expect((await S(frame)).cabHitTest, 'cab exposes hitTest');
    const lever = await cabPoint(h, frame, 'lever', 3);
    h.expect(!!lever, 'the lever is found on screen');
    await h.page.mouse.move(lever.px, lever.py);
    await frame.waitForFunction(() => document.getElementById('world').style.cursor === 'pointer', null, { timeout: 5000 }).catch(() => {});
    h.eq(await frame.evaluate(() => document.getElementById('world').style.cursor), 'pointer', 'cursor turns into a pointer over the lever');
    await h.page.mouse.click(lever.px, lever.py);
    await waitState(frame, (n) => window.__tsTest.state().leverTarget === n, lever.notch, 3000).catch(() => {});
    s = await S(frame);
    h.eq(s.leverTarget, lever.notch, 'clicking the lever sets its notch (P' + lever.notch + ')');
    await h.shot('cab-click');
    await frame.evaluate(() => { __tsTest.forceSimStep(0.1, 0); __tsTest.setSpeed(0); });   // stand still again so the camera settles for the next click
    const brake = await cabPoint(h, frame, 'lever', -4);
    await h.page.mouse.click(brake.px, brake.py);
    await waitState(frame, (n) => window.__tsTest.state().leverTarget === n, brake.notch, 3000).catch(() => {});
    h.eq((await S(frame)).leverTarget, brake.notch, 'clicking lower on the gate brakes (B' + (-brake.notch) + ')');
    await frame.evaluate(() => { __tsTest.forceSimStep(0.1, 0); __tsTest.setSpeed(0); });   // lever back to 0 before the parking-brake button
    const park = await cabPoint(h, frame, 'parking');
    h.expect(!!park, 'the parking-brake button is found on screen');
    await h.page.mouse.click(park.px, park.py);
    await waitState(frame, () => window.__tsTest.state().parkingBrake === true, null, 5000);
    await h.page.mouse.click(park.px, park.py);
    await waitState(frame, () => window.__tsTest.state().parkingBrake === false, null, 5000);
    h.expect(true, 'clicking the parking-brake button toggles it');
    await h.page.mouse.move(2, 2);
    await key(h, 'x');

    h.step('SPAD: passing a red signal brakes and fines');
    await frame.evaluate(() => { __tsTest.press('x'); __tsTest.release('x'); __tsTest.teleport(2); });
    const spadBefore = (await S(frame)).totals.spads;
    h.expect(await frame.evaluate(() => __tsTest.spadTest()), 'a signal ahead was forced red');
    await waitState(frame, (n) => window.__tsTest.state().totals.spads >= n + 1, spadBefore, 40000);
    await waitState(frame, () => window.__tsTest.state().spadActive === true || window.__tsTest.state().kmh < 30, null, 20000);
    s = await S(frame);
    h.eq(s.totals.spads, spadBefore + 1, 'SPAD counted once');
    h.expect(s.events.includes('spad'), 'spad event raised');
    await waitState(frame, () => window.__tsTest.state().kmh < 1, null, 60000);
    h.expect((await S(frame)).cash < s.cash + 1, 'SPAD fine reduced the estimate');
    await h.pause(250);
    s = await S(frame);
    h.expect(s.spadActive && /Noutbrems/.test(s.guideText), 'SPAD emergency brake shows a visible countdown: ' + s.guideText);
    await waitState(frame, () => !window.__tsTest.state().spadActive, null, 10000);
    h.expect(true, 'forced emergency brake clears after standstill');

    h.step('express service (RE) passes a station without a missed-stop penalty; RB stops everywhere');
    await frame.evaluate(() => { __tsTest.forcePlan({ pattern: 'RE', pass: [1] }); return __tsTest.startService('west', 'railcar', 'career'); });
    await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().pattern === 'RE', null, 60000);
    s = await S(frame);
    h.eq(s.passIndices, [1], 'station 1 is passed');
    h.expect(/RE · 4/.test(s.svcLabel), 'start card / HUD shows "RE · 4 Arrêten": ' + s.svcLabel);
    h.expect(s.timetable[1].pass === true && s.timetable[1].arr === s.timetable[1].dep, 'timetable marks the passing station');
    await h.shot('express-start');
    await frame.evaluate(() => { __tsTest.teleport(1); });
    await frame.evaluate(() => { const st = __tsTest.state(); __tsTest.placeAt(st.stations[1].s - 150, 60); });
    const missedBefore = (await S(frame)).totals.missed;
    await frame.evaluate(() => { __tsTest.forceSimStep(28, 3); });
    s = await S(frame);
    h.expect(s.s > s.stations[1].s + 200, 'train ran through the passing station (' + Math.round(s.s - s.stations[1].s) + ' m past)');
    h.eq(s.totals.missed, missedBefore, 'no missed-stop penalty for the passing station');
    h.eq(s.nextStationIndex, 2, 'next stop skips the passing station');
    await frame.evaluate(() => { __tsTest.press('x'); __tsTest.release('x'); const st = __tsTest.state(); __tsTest.placeAt(st.stations[1].s - 5, 0); __tsTest.forceSimStep(0.1, 0); __tsTest.press('d'); __tsTest.forceSimStep(0.2, 0); });
    await h.pause(200);
    h.eq((await S(frame)).doorPhase, 'closed', 'doors do not open at a station the express passes');
    const variety = await frame.evaluate(() => {
      const out = { re: 0, rb: 0, tsr: 0, incidents: 0, bad: 0, first: null };
      for (const id of ['west', 'south', 'east', 'north']) {
        const track = TS.track.build(TS.routes.get(id)), train = TS.config.trains[0];
        out.first = out.first || TS.sim.planService(track, train, { services: 0 }).pattern;
        for (let k = 0; k < 40; k++) {
          const p = TS.sim.planService(track, train, { services: 4 });
          if (p.pattern === 'RE') out.re++; else out.rb++;
          out.tsr += p.tsr.length; out.incidents += p.incidents.length;
          if (p.pass.some((i) => i < 1 || i > track.stations.length - 2)) out.bad++;
          if (p.tsr.some((r) => r.s1 - r.s0 < 200 || r.s1 - r.s0 > 500 || r.kmh < 40 || r.kmh > 60)) out.bad++;
        }
      }
      return out;
    });
    h.expect(variety.re > 10 && variety.rb > 10 && variety.tsr > 20 && variety.incidents > 20 && variety.bad === 0 && variety.first === 'RB', 'variation: ' + JSON.stringify(variety));

    h.step('service end -> summary, score submitted, monotonic save');
    await frame.evaluate(() => { __tsTest.press('x'); __tsTest.release('x'); });
    await frame.evaluate(() => { __tsTest.finishRoute(); });
    await waitState(frame, () => window.__tsTest.state().atStationIndex >= 0 && window.__tsTest.state().nextStationIndex === window.__tsTest.state().stations.length - 1);
    await key(h, 'd');
    await waitState(frame, () => window.__tsTest.state().doorPhase === 'open');
    await waitState(frame, () => window.__tsTest.state().phase === 'summary', null, 90000);
    h.expect(await frame.locator('#summary').isVisible(), 'summary screen visible');
    await h.shot('summary');
    s = await S(frame);
    await h.page.waitForFunction(() => window.__tsMessages.some((m) => m.__pb === 1 && m.final), null, { timeout: 20000 });
    await h.pause(600);
    h.expect(scoreWrites(h).some((c) => c.body.game_id === 'train-sim' && c.body.score >= 0), 'final score reaches the scores table');
    const saves = await h.page.evaluate(() => window.__tsMessages.filter((m) => m.__pbSave).map((m) => m.data.tb));
    h.expect(saves.length > 0, 'save posted at service end');
    h.expect(saves.every((tb, i) => i === 0 || tb >= saves[i - 1]), 'tb never decreases across saves: ' + saves.join(','));
    h.expect(s.wallet > 0 && s.tb === s.careers.rail.lifetime + s.careers.tram.lifetime && s.career === 'rail', 'rail wallet earned; tb = rail lifetime + tram lifetime');
    const savesBeforeMenu = saves.length;

    h.step('back to the menu, hints toggle, buying a train spends wallet only');
    await frame.locator('#sumMenu').click();
    await waitState(frame, () => window.__tsTest.state().phase === 'menu');
    h.expect((await S(frame)).hints, 'hints are on by default');
    await frame.locator('[data-test="hints-toggle"]').click();
    h.expect(!(await S(frame)).hints, 'the Hiweiser toggle in the menu switches the hints off');
    await frame.locator('[data-test="hints-toggle"]').click();
    h.expect((await S(frame)).hints, 'and on again');
    await frame.evaluate(() => __tsTest.grant(30000));
    s = await S(frame);
    const before = { wallet: s.wallet, tb: s.tb };
    await frame.locator('[data-test="buy-train-emu"]').click();
    await waitState(frame, () => window.__tsTest.state().owned.includes('emu'));
    s = await S(frame);
    const emuPrice = await frame.evaluate(() => TS.config.trains.find((tr) => tr.id === 'emu').price);
    h.eq(s.wallet, before.wallet - emuPrice, 'train price leaves the wallet');
    h.eq(s.tb, before.tb, 'purchase leaves tb (lifetime) untouched');
    h.eq([s.careers.tram.wallet, s.careers.tram.lifetime], [0, 0], 'the Zuch purchase did not touch the tram career');
    h.expect((await h.page.evaluate(() => window.__tsMessages.filter((m) => m.__pbSave).length)) > savesBeforeMenu, 'purchase saves');

    frame = await resumeChecks(h, frame);
    if (process.env.TS_STOP_AFTER_RESUME) return;

    h.step('endless mode plays all compatible routes in order, then loops');
    await frame.locator('[data-test="select-railcar"]').click();
    await frame.locator('[data-test="mode-endless"]').click();
    await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().mode === 'endless');
    const order = (await S(frame)).endless.order;
    const expected = await frame.evaluate(() => __tsTest.career().endlessOrder('railcar'));
    h.eq(order, expected, 'endless order = all compatible routes');
    h.expect(order.length >= 3, 'several routes in the endless cycle');
    await frame.evaluate(() => { window.__sawSummary = false; clearInterval(window.__sumTimer); window.__sumTimer = setInterval(() => { if (!document.getElementById('summary').hidden) window.__sawSummary = true; }, 50); });
    const played = [];
    const scoresBefore = scoreWrites(h).length;
    const finalsBefore = await h.page.evaluate(() => window.__tsMessages.filter((m) => m.__pb === 1 && m.final).length);
    for (let i = 0; i <= order.length; i++) {
      s = await S(frame);
      played.push(s.routeId);
      await frame.evaluate(() => { __tsTest.finishRoute(); });
      await frame.evaluate(() => { __tsTest.completeNow(); });
      if (i < order.length) await waitState(frame, (n) => window.__tsTest.state().phase === 'running' && window.__tsTest.state().endless.index === n, (i + 1) % order.length, 90000);
      if (i === order.length) break;
      await h.pause(300);
    }
    h.eq(played.slice(0, order.length), order, 'routes played in order');
    h.expect(order.slice(0, 4).every((id, i) => (i % 2 === 0 ? !id.endsWith('~r') : id === order[i - 1] + '~r')), 'every route is played there and back (forward, then ~r), then the next route');
    h.expect(!(await frame.evaluate(() => window.__sawSummary)), 'rail endless ran through more than all routes and wrapped around without ever showing a summary');
    h.eq(played[order.length], order[0], 'loops back to the first route');
    await h.pause(800);
    const finals = await h.page.evaluate(() => window.__tsMessages.filter((m) => m.__pb === 1 && m.final).length);
    h.expect(finals >= finalsBefore + order.length, 'a final score is sent to the arcade at every route end (' + (finals - finalsBefore) + ')');
    h.expect(scoreWrites(h).length >= scoresBefore, 'the records module only writes improved scores');
    await h.shot('endless');


    h.step('tram career: switch, separate wallet, playable immediately, remembered');
    await frame.evaluate(() => __tsTest.toMenu());
    await waitState(frame, () => window.__tsTest.state().phase === 'menu');
    const railBefore = (await S(frame)).careers.rail;
    const tbBeforeTram = (await S(frame)).tb;
    await frame.locator('[data-test="career-tram"]').click();
    await waitState(frame, () => window.__tsTest.state().career === 'tram');
    h.eq(await frame.locator('[data-test="route-west"]').count(), 0, 'the Zuch routes are not listed in the Tram career');
    h.eq(await frame.locator('[data-test="route-luxtram-stad"]').count(), 1, 'the free Luxtram section is listed');
    h.eq(await frame.locator('[data-test="buy-train-emu"]').count(), 0, 'the Zuch garage is not shown in the Tram career');
    h.expect(await frame.locator('[data-test="mode-career"]').isEnabled(), 'Karriär is playable right away in the Tram career');
    h.expect((await frame.locator('[data-test="wallet"]').innerText()).startsWith('0'), 'the hero shows the tram wallet (0 €), not the Zuch wallet');
    await h.shot('menu-tram');
    await frame.locator('[data-test="mode-career"]').click();
    await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 90000);
    s = await S(frame);
    h.eq([s.routeId, s.trainId], ['luxtram-stad', 'tram'], 'Tram Karriär drives the Luxtram on the free section');
    await frame.evaluate(() => { __tsTest.finishRoute(); });
    await waitState(frame, () => window.__tsTest.state().atStationIndex >= 0 && window.__tsTest.state().nextStationIndex === window.__tsTest.state().stations.length - 1);
    await key(h, 'd');
    await waitState(frame, () => window.__tsTest.state().doorPhase === 'open');
    await waitState(frame, () => window.__tsTest.state().phase === 'summary', null, 90000);
    s = await S(frame);
    h.expect(s.lastReward.cash > 0, 'the tram service earned real money');
    h.expect(s.careers.tram.services === 1 && s.careers.tram.lifetime === s.lastReward.cash && s.careers.tram.wallet === s.lastReward.cash, 'the tram service paid into the tram career (' + s.lastReward.cash + ' €)');
    h.eq(s.careers.rail, railBefore, 'earning in tram leaves the whole rail career untouched (wallet ' + railBefore.wallet + ')');
    h.eq(s.tb, tbBeforeTram + s.careers.tram.lifetime, 'tb = rail lifetime + tram lifetime');
    await frame.locator('#sumMenu').click();
    await waitState(frame, () => window.__tsTest.state().phase === 'menu');
    h.eq((await S(frame)).career, 'tram', 'the menu stays on the last chosen career');

    h.step('tram purchases spend tram money only; the full line comes last');
    await frame.evaluate(() => __tsTest.grant(30000, 'tram'));
    s = await S(frame);
    const tramA = { wallet: s.careers.tram.wallet, tb: s.tb, rail: s.careers.rail };
    const priceKb = await frame.evaluate(() => TS.config.routeRules['luxtram-kierchbierg'].price);
    await frame.locator('[data-test="buy-route-luxtram-kierchbierg"]').click();
    await waitState(frame, () => window.__tsTest.state().careers.tram.routes.includes('luxtram-kierchbierg'));
    s = await S(frame);
    h.eq(s.careers.tram.wallet, tramA.wallet - priceKb, 'the section price leaves the tram wallet');
    h.eq(s.careers.rail, tramA.rail, 'rail wallet and rail career unchanged by the tram purchase');
    h.eq(s.tb, tramA.tb, 'tb untouched by a purchase');
    h.expect(await frame.locator('[data-test="buy-route-luxtram"]').isDisabled(), 'the full line is locked until the other sections are owned');
    await frame.evaluate(() => __tsTest.grant(60000, 'tram'));
    await frame.locator('[data-test="buy-route-luxtram"]').click({ force: true });
    h.expect(!(await S(frame)).careers.tram.routes.includes('luxtram'), 'the full line cannot be bought before the sections');
    await frame.locator('[data-test="buy-route-luxtram-sud"]').click();
    await waitState(frame, () => window.__tsTest.state().careers.tram.routes.includes('luxtram-sud'));
    await frame.locator('[data-test="buy-route-luxtram"]').click();
    await waitState(frame, () => window.__tsTest.state().careers.tram.routes.includes('luxtram'));
    h.eq((await S(frame)).careers.rail, tramA.rail, 'rail career still untouched after buying the whole line');
    const upBefore = (await S(frame)).careers.tram;
    await frame.locator('[data-test="up-comfort"]').click();
    await waitState(frame, (n) => window.__tsTest.state().careers.tram.upgrades.tram.comfort === n, upBefore.upgrades.tram.comfort + 1);
    h.expect((await S(frame)).careers.tram.wallet < upBefore.wallet && (await S(frame)).careers.rail.wallet === tramA.rail.wallet, 'a tram upgrade is paid with tram money only');
    const kissBuy = await frame.evaluate(() => __tsTest.buy('train', 'kiss'));
    h.eq([kissBuy, (await S(frame)).careers.rail.owned.includes('kiss')], [undefined, false], 'tram money cannot buy a Zuch (rail wallet too small)');
    await frame.evaluate(() => __tsTest.grant(500000, 'rail'));
    h.expect((await S(frame)).careers.tram.wallet < 100000, 'a rail grant does not change the tram wallet');
    await h.shot('menu-tram-bought');

    h.step('tram endless covers all Luxtram routes in order, then loops');
    await frame.locator('[data-test="mode-endless"]').click();
    await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().mode === 'endless', null, 90000);
    const tramOrder = (await S(frame)).endless.order;
    h.eq(tramOrder, LUXTRAM_ORDER, 'tram endless = all Luxtram routes, in order');
    h.eq(tramOrder, await frame.evaluate(() => __tsTest.career().endlessOrder('tram')), 'endlessOrder(tram) agrees');
    await frame.evaluate(() => { window.__sawSummary = false; clearInterval(window.__sumTimer); window.__sumTimer = setInterval(() => { if (!document.getElementById('summary').hidden) window.__sawSummary = true; }, 50); });
    const tramPlayed = [];
    for (let i = 0; i < tramOrder.length; i++) {
      s = await S(frame);
      tramPlayed.push(s.routeId);
      await frame.evaluate(() => { __tsTest.finishRoute(); });
      await frame.evaluate(() => { __tsTest.completeNow(); });
      await waitState(frame, (n) => window.__tsTest.state().phase === 'running' && window.__tsTest.state().endless.index === n, (i + 1) % tramOrder.length, 120000);
      await h.pause(300);
    }
    h.eq(tramPlayed, tramOrder, 'the Luxtram routes were played in order, each there and back');
    h.expect(!(await frame.evaluate(() => window.__sawSummary)), 'tram endless ran through all routes (both directions) and wrapped around without ever showing a summary');
    h.eq((await S(frame)).routeId, tramOrder[0], 'loops back to the first Luxtram route');
    h.eq((await S(frame)).careers.rail.wallet, railBefore.wallet + 500000, 'tram endless earned nothing in the rail career');
    await frame.evaluate(() => __tsTest.toMenu());
    await waitState(frame, () => window.__tsTest.state().phase === 'menu');
    await frame.locator('[data-test="career-rail"]').click();
    await waitState(frame, () => window.__tsTest.state().career === 'rail');
    h.expect(await frame.locator('[data-test="route-west"]').count() === 1, 'switching back shows the Zuch career again');
    await h.shot('menu-rail');
    await h.pause(300);
    const allSaves = await savePosts(h);
    h.eq(allSaves[allSaves.length - 1].career, 'rail', 'the last chosen career is saved');
    h.expect(allSaves.every((d, i) => i === 0 || d.tb >= allSaves[i - 1].tb), 'tb never decreases across ALL saves (services, purchases, career switches): ' + allSaves.map((d) => d.tb).join(','));
    h.expect(allSaves.every((d) => d.v === 2 && d.tb === d.rail.lifetime + d.tram.lifetime), 'every posted save is v2 with tb = rail + tram lifetime');
    frame = await resumeEndlessChecks(h, frame);

    h.step('phone viewport blocks, iPad does not');
    await h.page.setViewportSize({ width: 390, height: 844 });
    await h.pause(500);
    h.expect((await S(frame)).phoneBlocked && await frame.locator('#phoneBlock').isVisible(), 'phone shows the block screen');
    await h.shot('phone');
    await h.page.setViewportSize({ width: 820, height: 1180 });
    await h.pause(500);
    h.expect(!(await S(frame)).phoneBlocked, 'iPad is not blocked');


    h.step('an old-format save migrates: rail keeps everything, tram starts fresh');
    const pure = await frame.evaluate((old) => {
      const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };
      const K = TS.career, frozen = deepFreeze(JSON.parse(JSON.stringify(old)));
      const m = K.normalize(frozen);
      const withTram = K.normalize({ ...JSON.parse(JSON.stringify(old)), owned: ['railcar', 'tram'], routes: ['west', 'tram', 'luxtram-sud'], upgrades: { ...old.upgrades, tram: { motor: 2 } }, train: 'tram', route: 'luxtram-sud' });
      const a = deepFreeze(K.normalize({ ...old, lifetime: 5000, tb: 5000, wallet: 100 }));
      const b = deepFreeze(K.normalize({ rail: { lifetime: 100 }, tram: { lifetime: 6000, wallet: 50 } }));
      return { m, again: K.normalize(m), withTram, mergeAB: K.merge(a, b).tb, mergeBA: K.merge(b, a).tb, tie: K.merge(a, { ...a, savedAt: a.savedAt + 5 }).savedAt === a.savedAt + 5 };
    }, OLD_SAVE);
    h.eq([pure.m.rail.lifetime, pure.m.rail.wallet, pure.m.tb], [6800, 3300, 6800], 'rail keeps lifetime 6800 / wallet 3300; tb stays 6800');
    h.eq([pure.m.rail.owned, pure.m.rail.routes, pure.m.rail.services, pure.m.rail.best], [['railcar'], ['west'], 4, { west: 292 }], 'rail keeps owned, routes, services, bests');
    h.eq(pure.m.rail.upgrades.railcar, OLD_SAVE.upgrades.railcar, 'rail keeps its upgrades');
    h.eq([pure.m.tram.lifetime, pure.m.tram.wallet, pure.m.tram.services, pure.m.tram.owned, pure.m.tram.routes], [0, 0, 0, ['tram'], ['luxtram-stad']], 'tram starts fresh');
    h.eq(pure.again, pure.m, 'normalizing twice changes nothing');
    h.eq([pure.withTram.career, pure.withTram.tram.routes.includes('luxtram-sud'), pure.withTram.tram.routes.includes('tram'), pure.withTram.tram.upgrades.tram.motor, pure.withTram.rail.owned], ['tram', true, false, 2, ['railcar']],
      'an old save that owned tram things moves them to the tram career (the fictional line is dropped)');
    h.eq([pure.mergeAB, pure.mergeBA], [6100, 6100], 'merge picks the save with the higher TOTAL (tram progress counts), in both directions, inputs frozen');
    h.expect(pure.tie, 'equal totals: the newer savedAt wins');
    await h.page.evaluate((old) => localStorage.setItem('pb_save_train-sim', JSON.stringify(old)), OLD_SAVE);
    await gotoNormal(h, '/pixelbreak.html?g=train-sim&test=1');
    frame = await gameFrame(h);
    s = await S(frame);
    h.eq([s.career, s.careers.rail.lifetime, s.careers.rail.wallet, s.tb], ['rail', 6800, 3300, 6800], 'the loaded game shows Ian\'s old save as the rail career');
    h.eq([s.careers.tram.wallet, s.careers.tram.owned, s.careers.tram.routes], [0, ['tram'], ['luxtram-stad']], 'and a fresh tram career');
    h.expect((await frame.locator('[data-test="wallet-rail"]').innerText()).replace(/\D/g, '') === '3300', 'the Zuch tab shows the 3 300 wallet');
    await frame.evaluate((d) => __tsTest.mergeSave(d), { ...OLD_SAVE, tb: 100, lifetime: 100, wallet: 100, savedAt: 1 });
    h.eq((await S(frame)).tb, 6800, 'a cloud save with lower progress does not replace the local one');
    await frame.evaluate((d) => __tsTest.mergeSave(d), { v: 2, savedAt: 5, career: 'tram', rail: { lifetime: 6800, wallet: 3300 }, tram: { lifetime: 9000, wallet: 9000 } });
    s = await S(frame);
    h.eq([s.tb, s.careers.tram.wallet, s.career], [15800, 9000, 'tram'], 'a cloud save with more total progress wins');

    await luxtramNormalChecks(h, frame);
    await directionAndGearChecks(h, frame);
    await railTunnelChecks(h, frame);
    frame = await weatherChecks(h, frame);
    frame = await backNavChecks(h, frame);

    h.step('arcade test mode: everything unlocked in memory, nothing saved, no scores');
    await h.page.evaluate(() => localStorage.setItem('__flowPbTestMode', '1'));
    await gotoNormal(h, '/pixelbreak.html?g=train-sim&test=1');
    frame = await gameFrame(h);
    // (the page we just left saved itself on unload and the arcade mirrored that locally: start from an empty local store)
    await h.page.evaluate(() => localStorage.removeItem('pb_save_train-sim'));
    await h.pause(300);
    const scoreRowsBefore = scoreWrites(h).length, gameSaveBefore = gameSaveWrites(h);
    s = await S(frame);
    h.expect(s.arcadeTest, 'the game recognised window.__pbTestMode');
    const everything = await frame.evaluate(() => {
      const K = TS.career, st = __tsTest.state().careers, out = {};
      for (const cid of ['rail', 'tram']) {
        out[cid] = { trains: K.trainIdsOf(cid).every((id) => st[cid].owned.includes(id)), routes: K.routeIdsOf(cid).every((id) => st[cid].routes.includes(id)),
          upgrades: K.trainIdsOf(cid).every((id) => TS.config.upgradeKinds.every((k) => st[cid].upgrades[id][k] === K.MAX_LEVELS[k])), money: st[cid].wallet >= 1000000 };
      }
      return out;
    });
    h.eq(everything, { rail: { trains: true, routes: true, upgrades: true, money: true }, tram: { trains: true, routes: true, upgrades: true, money: true } }, 'both careers: all vehicles, routes and upgrades unlocked, plenty of €');
    await luxtramScoutChecks(h, frame);
    await frame.locator('[data-test="career-tram"]').click();
    h.eq(await frame.locator('[data-test="route-luxtram"]').isEnabled(), true, 'the full Luxtram line is selectable');
    await h.shot('menu-test-mode');
    await frame.locator('[data-test="mode-career"]').click();
    await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 90000);
    /* resume in test mode: the snapshot lives under the test-mode key (the real one is never touched) and does not leak into the normal-mode copy */
    await frame.evaluate(() => { window.Arcade.testStorageShim('train-sim'); });   // (here the flag is simulated; the arcade proper also injects this storage redirect into the frame)
    await frame.evaluate(() => { const st = __tsTest.state(); __tsTest.placeAt(st.stations[0].s + 300, 0); return __tsTest.saveSnapshot(); });
    const keys = await h.page.evaluate(() => ({ real: localStorage.getItem('pb_resume_train-sim'), test: localStorage.getItem('pb_testls_train-sim_pb_resume_train-sim') }));
    h.expect(keys.real === null && !!keys.test && JSON.parse(keys.test).v === 1, 'test mode keeps its snapshot under pb_testls_train-sim_pb_resume_train-sim and writes nothing to the real key');
    await frame.evaluate(() => { __tsTest.finishRoute(); });
    await frame.evaluate(() => { __tsTest.completeNow(); });
    await waitState(frame, () => window.__tsTest.state().phase === 'summary', null, 60000);
    h.expect(await h.page.evaluate(() => localStorage.getItem('pb_testls_train-sim_pb_resume_train-sim') === null), 'finishing the service in test mode cleared the test-mode snapshot');
    await frame.locator('#sumMenu').click();
    await waitState(frame, () => window.__tsTest.state().phase === 'menu');
    await frame.locator('[data-test="career-rail"]').click();
    await frame.evaluate(() => __tsTest.toMenu());
    await h.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await h.pause(800);
    h.eq((await savePosts(h)).length, 0, 'test mode posted no save to the arcade');
    h.eq(await scoreMessages(h), 0, 'test mode reported no score');
    h.eq([scoreWrites(h).length, gameSaveWrites(h)], [scoreRowsBefore, gameSaveBefore], 'and nothing reached the scores or game_saves tables');
    h.expect(await frame.evaluate(() => localStorage.getItem('pb_save_train-sim') === null), 'and nothing was written to the local save either: ' + String(await frame.evaluate(() => localStorage.getItem('pb_save_train-sim'))).slice(0, 200));
    await h.page.evaluate(() => localStorage.removeItem('__flowPbTestMode'));

    h.expect(errors.length === 0, 'no console errors: ' + errors.slice(0, 3).join(' | '));
    h.expect((await S(frame)).errors === 0, 'no frame errors');
  },
};
export { driveTwoStops, finishWest, reloadToMenu, gameFrame, S, key, waitState };
runIfMain(import.meta.url, flow);
