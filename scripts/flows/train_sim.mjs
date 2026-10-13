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
const LUXTRAM_ORDER = ['luxtram-kierchbierg', 'luxtram-stad', 'luxtram-sud', 'luxtram'].flatMap((id) => [id, id + '~r']);
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

  h.step('Luxtram: calm limit profile (zones >= 150 m, >= 80 m in the centre, multiples of 10, no stop zones), Findel - Luxexpo is 70 except the motorway bridge');
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
        const min = mid >= lt.centre[0] && mid <= lt.centre[1] ? lt.minZoneCentre : lt.minZone;
        if (len < min - 1) bad.push(Math.round(L[i].s) + ':' + L[i].kmh + ' ' + Math.round(len) + 'm<' + min);
        shortest = Math.min(shortest, len);
        values.add(L[i].kmh);
        if (i && L[i].kmh === L[i - 1].kmh) dup++;
      }
      // never a higher limit squeezed between two lower ones over a short distance
      let squeezed = 0;
      for (let i = 1; i + 1 < L.length; i++) if (L[i].kmh > L[i - 1].kmh && L[i].kmh > L[i + 1].kmh && (L[i + 1].s - L[i].s) < 150) squeezed++;
      const limAt = (s) => { let k = L[0].kmh; for (const l of L) { if (l.s <= s) k = l.kmh; else break; } return k; };
      const o = { zones: L.length, bad, shortest, values: [...values].sort((a, b) => a - b), dup, squeezed, stationLimitZones: 0 };
      if (id === 'luxtram-kierchbierg') {
        const mb = lt.motorwayBridge;
        const seen = new Set();
        let outsideBridge = 0;
        for (let s = 0; s <= lt.fastEnd; s += 5) {
          const k = limAt(s);
          seen.add(k);
          const inBridge = s >= mb[0] - 60 - 125 && s <= mb[1] + 71;
          if (k !== 70 && !(inBridge && k === 50)) outsideBridge++;
        }
        o.fast = { values: [...seen], outsideBridge, bridgeMid: limAt((mb[0] + mb[1]) / 2), atLuxexpoPlatform: limAt(tr.stations[2].platformStart + 10), atPlatformEnd: limAt(tr.stations[2].platformEnd - 1), atHeienhaff: limAt(tr.stations[1].s) };
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
  h.expect(fast.outsideBridge === 0 && fast.values.every((v) => v === 70 || v === 50), 'Findel - Héienhaff - Luxexpo: 70 km/h the whole way except the motorway bridge (values ' + fast.values.join('/') + ')');
  h.eq([fast.bridgeMid, fast.atLuxexpoPlatform, fast.atPlatformEnd, fast.atHeienhaff], [50, 70, 70, 70], 'the bridge is 50; Héienhaff and the Luxexpo platform stay at 70');

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
  await frame.evaluate(() => __tsTest.toMenu());
  await waitState(frame, () => window.__tsTest.state().phase === 'menu');
}

/* Return direction, reverse gear, 2x fast-forward and real (natural) endless hand-over. TS_LUXTRAM_ONLY=1 runs these too. */
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
        const min = mid >= lt.centre[0] && mid <= lt.centre[1] ? lt.minZoneCentre : lt.minZone;
        if (len < min - 1) bad.push(Math.round(L[i].s) + ':' + L[i].kmh + ' ' + Math.round(len) + 'm');
      }
      out[id] = { zones: L.length, bad };
    }
    const f = TS.track.build(TS.routes.get('luxtram-kierchbierg~r'));
    const L = f.limits; const limAt = (s) => { let k = L[0].kmh; for (const l of L) { if (l.s <= s) k = l.kmh; else break; } return k; };
    const fwd = TS.track.build(TS.routes.get('luxtram-kierchbierg'));
    const seen = new Set();
    for (let s = 0; s <= f.length; s += 5) { const abs = f.length - s; if (abs <= fwd.luxtram.fastEnd) seen.add(limAt(s)); }
    out.fast = [...seen];
    return out;
  });
  for (const id of ['luxtram-kierchbierg~r', 'luxtram-stad~r', 'luxtram-sud~r', 'luxtram~r']) h.expect(revLimits[id].bad.length === 0, id + ': ' + revLimits[id].zones + ' limit zones, none below the minimum length' + (revLimits[id].bad.length ? ' ' + revLimits[id].bad.join(', ') : ''));
  h.expect(revLimits.fast.every((v) => v === 70 || v === 50), 'Luxexpo - Héienhaff - Findel (return): 70 km/h except the motorway bridge (' + revLimits.fast.join('/') + ')');

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
    await frame.evaluate(() => { __tsTest.finishRoute(); });
    await h.pause(300);
    await frame.evaluate(() => { __tsTest.stopAtMarker(-0.5); });
    await h.pause(300);
    await key(h, 'd');
    await waitState(frame, (r) => window.__tsTest.state().phase === 'running' && window.__tsTest.state().routeId !== r && !window.__tsTest.state().finished, s0.routeId, 90000);
  }
  h.eq(seen.slice(0, 3), ['luxtram-kierchbierg', 'luxtram-kierchbierg~r', 'luxtram-stad'], 'Findel - Kierchbierg, then back, then the next route - no summary in between');
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

export const flow = {
  name: 'train-sim', touch: true, fullChromium: true,
  backend: { tables: { game_saves: () => [], scores: () => [] } },
  async run(h) {
    const errors = [];
    let sA = 0;
    h.page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
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
    await frame.evaluate(() => { __tsTest.finishRoute(); });
    await frame.evaluate(() => { __tsTest.completeNow(); });
    await waitState(frame, () => window.__tsTest.state().phase === 'summary', null, 60000);
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
runIfMain(import.meta.url, flow);
