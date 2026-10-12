/* Lokféierer: career, pure functions over a save object. Never mutates inputs.
   Two separate careers live in one save: 'rail' (Zuch) and 'tram' (the Luxtram). Each has its own wallet, lifetime EUR,
   rank, services, bests, owned vehicles, routes and upgrades. Money earned in one career can't be spent in the other.
   Save shape (v2):
     { v:2, tb, savedAt, career:'rail'|'tram' (last chosen), hints, hintsSet,
       rail: CareerState, tram: CareerState }
     CareerState = { lifetime, wallet, owned:[trainId], routes:[routeId], train, route,
                     upgrades:{[trainId]:{motor,brakes,comfort,capacity,paint}}, best:{[routeId]:points}, services, endlessBest }
   tb = rail.lifetime + tram.lifetime: monotonic (the server drops saves with a lower tb) and what the arcade compares.
   Old flat saves (v1: lifetime/wallet/owned/... at the top level) become the rail career unchanged; tram vehicles/routes they
   owned move to the tram career, which otherwise starts fresh (see normalize). */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const C = TS.config;
  const MAX = Number.MAX_SAFE_INTEGER;
  const CAREERS = C.careers.order;
  const DEFAULT_CAREER = 'rail';
  const TEST_MODE_EUROS = 5000000;
  const MAX_LEVELS = Object.freeze(Object.fromEntries(C.upgradeKinds.map((k) => [k, C.upgrades.railcar[k].length])));

  const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(MAX, Math.floor(n))) : 0);
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const trainById = (id) => C.trains.find((t) => t.id === id) || null;
  const rule = (routeId) => C.routeRules[routeId] || null;
  const unique = (list, allowed) => [...new Set(Array.isArray(list) ? list.filter((x) => allowed.includes(x)) : [])];

  // ---- which career does a vehicle / route belong to
  const careerOfTrain = (trainOrId) => {
    const train = typeof trainOrId === 'string' ? trainById(trainOrId) : trainOrId;
    return train ? (train.kind === 'tram' ? 'tram' : 'rail') : null;
  };
  const careerOfRoute = (routeId) => {
    const r = rule(routeId);
    return r ? (r.needs.includes('tram') ? 'tram' : 'rail') : null;
  };
  const trainIdsOf = (cid) => C.trains.filter((t) => careerOfTrain(t) === cid).map((t) => t.id);
  const routeIdsOf = (cid) => C.routeOrder.filter((id) => careerOfRoute(id) === cid);
  const freeTrainsOf = (cid) => C.trains.filter((t) => careerOfTrain(t) === cid && t.price === 0).map((t) => t.id);
  const freeRoutesOf = (cid) => routeIdsOf(cid).filter((id) => C.routeRules[id].price === 0);

  function normalizeCareer(cid, input) {
    const d = isObj(input) ? input : {};
    const trainIds = trainIdsOf(cid);
    const routeIds = routeIdsOf(cid);
    const freeTrains = freeTrainsOf(cid);
    const freeRoutes = freeRoutesOf(cid);
    const lifetime = num(d.lifetime);
    const owned = unique([...freeTrains, ...(Array.isArray(d.owned) ? d.owned : [])], trainIds);
    const routes = unique([...freeRoutes, ...(Array.isArray(d.routes) ? d.routes : [])], routeIds);
    const upgrades = {};
    for (const id of trainIds) {
      upgrades[id] = {};
      for (const k of C.upgradeKinds) upgrades[id][k] = Math.min(MAX_LEVELS[k], num(d.upgrades && d.upgrades[id] && d.upgrades[id][k]));
    }
    const best = {};
    if (isObj(d.best)) for (const id of routeIds) if (num(d.best[id])) best[id] = num(d.best[id]);
    return {
      lifetime, wallet: Math.min(lifetime, num(d.wallet)), owned, routes,
      train: owned.includes(d.train) ? d.train : freeTrains[0], route: routes.includes(d.route) ? d.route : freeRoutes[0],
      upgrades, best, services: num(d.services), endlessBest: num(d.endlessBest),
    };
  }

  /* Old flat save -> { rail, tram, career }. Rail keeps everything unchanged (normalizeCareer drops what isn't rail);
     tram vehicles/routes/upgrades the old save already owned move to the tram career, whose money starts at zero.
     Routes that no longer exist (the old fictional `tram` line) are ignored. */
  function migrateLegacy(d) {
    const lifetime = Math.max(num(d.lifetime), num(d.tb));
    const shared = { owned: d.owned, routes: d.routes, train: d.train, route: d.route, upgrades: d.upgrades, best: d.best };
    return {
      rail: normalizeCareer('rail', { ...shared, lifetime, wallet: d.wallet, services: d.services, endlessBest: d.endlessBest }),
      tram: normalizeCareer('tram', { ...shared, lifetime: 0, wallet: 0 }),
      career: careerOfTrain(d.train) === 'tram' ? 'tram' : DEFAULT_CAREER,
    };
  }

  function normalize(data) {
    const d = isObj(data) ? data : {};
    const nested = isObj(d.rail) || isObj(d.tram);
    const parts = nested
      ? { rail: normalizeCareer('rail', d.rail), tram: normalizeCareer('tram', d.tram), career: CAREERS.includes(d.career) ? d.career : DEFAULT_CAREER }
      : migrateLegacy(d);
    return {
      v: C.saveVersion, tb: parts.rail.lifetime + parts.tram.lifetime, savedAt: num(d.savedAt), career: parts.career,
      rail: parts.rail, tram: parts.tram,
      hints: d.hints !== false, hintsSet: d.hintsSet === true,
    };
  }

  const defaults = () => normalize({});

  /* A career's state inside a save (default: the one last chosen). */
  function of(save, cid) {
    const s = normalize(save);
    return s[CAREERS.includes(cid) ? cid : s.career];
  }

  /* Whole-save winner: higher total progress (tb) wins; tie -> newer savedAt. Spent euros can't be resurrected. */
  function merge(local, cloud) {
    const a = normalize(local);
    const b = normalize(cloud);
    return b.tb > a.tb || (b.tb === a.tb && b.savedAt > a.savedAt) ? b : a;
  }

  const withTop = (save, patch) => normalize({ ...save, ...patch });
  function withCareer(save, cid, patch) {
    const s = normalize(save);
    return normalize({ ...s, [cid]: { ...s[cid], ...patch } });
  }
  const setHints = (save, on) => withTop(normalize(save), { hints: !!on, hintsSet: true });
  const setCareer = (save, cid) => (CAREERS.includes(cid) ? withTop(normalize(save), { career: cid }) : null);

  /* Everything unlocked, lots of EUR, in both careers. Only for the arcade test mode: never persist the result. */
  function unlockedAll() {
    const everything = (cid) => ({
      lifetime: TEST_MODE_EUROS, wallet: TEST_MODE_EUROS, owned: trainIdsOf(cid), routes: routeIdsOf(cid),
      upgrades: Object.fromEntries(trainIdsOf(cid).map((id) => [id, { ...MAX_LEVELS }])),
    });
    return normalize({ career: DEFAULT_CAREER, rail: everything('rail'), tram: everything('tram') });
  }

  // ---- compatibility
  function trainMatches(train, token) {
    return !!train && (token === train.id || token === train.kind);
  }
  function trainCompatible(trainId, routeId) {
    const train = trainById(trainId);
    const r = rule(routeId);
    return !!train && !!r && r.needs.some((tok) => trainMatches(train, tok));
  }
  function trainsForRoute(routeId) {
    const r = rule(routeId);
    return r ? C.trains.filter((t) => r.needs.some((tok) => trainMatches(t, tok))).map((t) => t.id) : [];
  }
  /* Cheapest train that can run a route (for "needs X" hints). */
  function requiredTrain(routeId) {
    const ids = trainsForRoute(routeId);
    return ids.length ? ids[0] : null;
  }

  function routeAvailable(save, routeId, trainId) {
    const s = normalize(save);
    const r = rule(routeId);
    if (!r) return { ok: false, reason: 'unknownRoute', needs: [] };
    const cid = careerOfRoute(routeId);
    const c = s[cid];
    if (!c.routes.includes(routeId)) return { ok: false, reason: 'needsRoute', needs: trainsForRoute(routeId) };
    const id = trainId || c.train;
    if (!trainById(id)) return { ok: false, reason: 'unknownTrain', needs: trainsForRoute(routeId) };
    if (careerOfTrain(id) !== cid || !trainCompatible(id, routeId)) return { ok: false, reason: 'wrongTrainKind', needs: trainsForRoute(routeId) };
    if (!c.owned.includes(id)) return { ok: false, reason: 'trainNotOwned', needs: [] };
    return { ok: true, reason: '', needs: [] };
  }

  const hasRequired = (c, routeId) => (rule(routeId).requires || []).every((id) => c.routes.includes(id));

  // ---- purchases (return new save or null). Each one spends the wallet of the career the item belongs to.
  function buyTrain(save, id) {
    const s = normalize(save);
    const t = trainById(id);
    if (!t) return null;
    const cid = careerOfTrain(t);
    const c = s[cid];
    if (c.owned.includes(id) || c.wallet < t.price) return null;
    return withCareer(s, cid, { owned: [...c.owned, id], train: id, wallet: c.wallet - t.price });
  }
  function upgradePrice(save, trainId, kind) {
    const s = normalize(save);
    const table = C.upgrades[trainId] && C.upgrades[trainId][kind];
    const cid = careerOfTrain(trainId);
    if (!table || !cid) return undefined;
    return table[s[cid].upgrades[trainId][kind]];
  }
  function buyUpgrade(save, trainId, kind) {
    const s = normalize(save);
    const cid = careerOfTrain(trainId);
    if (!cid || !s[cid].owned.includes(trainId) || !C.upgradeKinds.includes(kind)) return null;
    const c = s[cid];
    const price = upgradePrice(s, trainId, kind);
    if (price === undefined || c.wallet < price) return null;
    const upgrades = { ...c.upgrades, [trainId]: { ...c.upgrades[trainId], [kind]: c.upgrades[trainId][kind] + 1 } };
    return withCareer(s, cid, { upgrades, wallet: c.wallet - price });
  }
  function buyRoute(save, routeId) {
    const s = normalize(save);
    const r = rule(routeId);
    if (!r) return null;
    const cid = careerOfRoute(routeId);
    const c = s[cid];
    if (c.routes.includes(routeId) || c.wallet < r.price || !hasRequired(c, routeId)) return null;
    if (!c.owned.some((id) => trainCompatible(id, routeId))) return null; // no point buying a line you can't drive
    return withCareer(s, cid, { routes: [...c.routes, routeId], wallet: c.wallet - r.price });
  }
  function select(save, trainId) {
    const s = normalize(save);
    const cid = careerOfTrain(trainId);
    return cid && s[cid].owned.includes(trainId) ? withCareer(s, cid, { train: trainId }) : null;
  }
  function selectRoute(save, routeId) {
    const s = normalize(save);
    const cid = careerOfRoute(routeId);
    return cid && s[cid].routes.includes(routeId) ? withCareer(s, cid, { route: routeId }) : null;
  }
  /* Why can't I buy? -> { ok, reason, price }. */
  function canBuy(save, kind, id, extra) {
    const s = normalize(save);
    if (kind === 'train') {
      const t = trainById(id);
      if (!t) return { ok: false, reason: 'unknownTrain', price: 0 };
      const c = s[careerOfTrain(t)];
      if (c.owned.includes(id)) return { ok: false, reason: 'owned', price: t.price };
      return { ok: c.wallet >= t.price, reason: c.wallet >= t.price ? '' : 'needsMoney', price: t.price };
    }
    if (kind === 'route') {
      const r = rule(id);
      if (!r) return { ok: false, reason: 'unknownRoute', price: 0 };
      const c = s[careerOfRoute(id)];
      if (c.routes.includes(id)) return { ok: false, reason: 'owned', price: r.price };
      if (!c.owned.some((tid) => trainCompatible(tid, id))) return { ok: false, reason: 'needsTrain', price: r.price };
      if (!hasRequired(c, id)) return { ok: false, reason: 'needsSections', price: r.price };
      return { ok: c.wallet >= r.price, reason: c.wallet >= r.price ? '' : 'needsMoney', price: r.price };
    }
    if (kind === 'upgrade') {
      const trainId = extra || s[s.career].train;
      const cid = careerOfTrain(trainId);
      if (!cid || !s[cid].owned.includes(trainId)) return { ok: false, reason: 'trainNotOwned', price: 0 };
      const price = upgradePrice(s, trainId, id);
      if (price === undefined) return { ok: false, reason: 'maxLevel', price: 0 };
      return { ok: s[cid].wallet >= price, reason: s[cid].wallet >= price ? '' : 'needsMoney', price };
    }
    return { ok: false, reason: 'unknown', price: 0 };
  }

  // ---- upgrades -> effective train config
  function applyUpgrades(trainConfig, save) {
    const s = normalize(save);
    const base = trainConfig || trainById(s[s.career].train);
    if (!base) return null;
    const cs = s[careerOfTrain(base) || s.career];
    const lv = cs.upgrades[base.id] || Object.fromEntries(C.upgradeKinds.map((k) => [k, 0]));
    const fx = C.upgradeEffects;
    const atMaxCapacity = lv.capacity >= MAX_LEVELS.capacity;
    const extraCar = atMaxCapacity && fx.capacity.extraCarAtMax && C.extraCarTrains.includes(base.id);
    const cars = base.cars + (extraCar ? 1 : 0);
    const capacity = Math.round(base.capacity * (1 + fx.capacity.capacityPerLevel * lv.capacity) * (cars / base.cars));
    const liveries = base.liveries || [base.livery];
    return {
      ...base,
      maxKmh: Math.round(base.maxKmh * (1 + fx.motor.speedPerLevel * lv.motor)),
      accel: +(base.accel * (1 + fx.motor.accelPerLevel * lv.motor)).toFixed(3),
      brake: +(base.brake * (1 + fx.brakes.brakePerLevel * lv.brakes)).toFixed(3),
      emergency: +(base.emergency * (1 + fx.brakes.emergencyPerLevel * lv.brakes)).toFixed(3),
      cars,
      capacity,
      livery: liveries[Math.min(lv.paint, liveries.length - 1)],
      fareMult: +(1 + fx.comfort.fareMultPerLevel * lv.comfort).toFixed(3),
      harshMult: +Math.max(C.economy.comfortHarshFloor, 1 - fx.comfort.complaintsPerLevel * lv.comfort).toFixed(3),
      upgradeLevels: { ...lv },
    };
  }

  // ---- routes
  function routeOrder() {
    const list = TS.routes && Array.isArray(TS.routes.list) ? TS.routes.list.map((r) => r.id) : [];
    return list.length ? list : C.routeOrder.slice();
  }
  /* Route class: 'tram' | 'hst' (hst-only) | 'rail'. Endless uses classes only, so the tier gating
     (kiss/ic/hst for the long lines) applies to career purchases but not to endless. */
  function routeClass(routeId) {
    const r = rule(routeId);
    if (!r) return null;
    if (r.needs.includes('tram')) return 'tram';
    if (r.needs.every((tok) => tok === 'hst')) return 'hst';
    return 'rail';
  }
  function trainDrivesClass(train, cls) {
    if (!train || !cls) return false;
    if (cls === 'tram') return train.kind === 'tram';
    if (cls === 'hst') return train.id === 'hst';
    return train.kind === 'rail';
  }
  /* All routes the train can drive in endless mode (regardless of purchase), in route-list order. */
  function endlessOrder(trainId) {
    const train = trainById(trainId);
    return routeOrder().filter((id) => trainDrivesClass(train, routeClass(id)));
  }

  // ---- ranks (per career)
  function rank(lifetime, cid) {
    const n = num(lifetime);
    return C.careers[CAREERS.includes(cid) ? cid : DEFAULT_CAREER].ranks.reduce((best, threshold, i) => (n >= threshold ? i : best), 0);
  }
  function rankInfo(lifetime, cid) {
    const career = C.careers[CAREERS.includes(cid) ? cid : DEFAULT_CAREER];
    const index = rank(lifetime, career.id);
    const next = index + 1 < career.ranks.length ? career.ranks[index + 1] : null;
    const from = career.ranks[index];
    return { index, id: career.rankIds[index], next, progress: next === null ? 1 : (num(lifetime) - from) / (next - from) };
  }

  // ---- reward
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

  function punctualityScore(delaySec) {
    const p = C.economy.punctuality;
    const d = Number.isFinite(delaySec) ? delaySec : 0;
    if (d <= p.onTimeSec) return 1;
    if (d <= p.okSec) return 1 - (d - p.onTimeSec) / (p.okSec - p.onTimeSec);
    return -clamp((d - p.okSec) / (p.lateMaxSec - p.okSec), 0, 1);
  }
  function accuracyScore(errorM) {
    const a = C.economy.accuracy;
    const e = Math.abs(Number.isFinite(errorM) ? errorM : 0);
    if (e <= a.perfectM) return a.perfectScore;
    if (e <= a.okM) return a.okScore;
    if (e <= a.overrunM) return 0;
    return a.overrunScore;
  }
  const gradeFor = (ratio) => (ratio >= 0.92 ? 'S' : ratio >= 0.78 ? 'A' : ratio >= 0.6 ? 'B' : ratio >= 0.4 ? 'C' : 'D');

  function reward(result, mode, save) {
    const r = result && typeof result === 'object' ? result : {};
    const E = C.economy;
    const rr = rule(r.routeId) || { fareBase: 20 };
    const effective = save && trainById(r.trainId) ? applyUpgrades(trainById(r.trainId), save) : null;
    const comfortLevel = effective ? effective.upgradeLevels.comfort : 0;
    const fareMult = effective ? effective.fareMult : num(r.fareMult) ? r.fareMult : 1;
    const harshMult = effective ? effective.harshMult : 1;

    const baseFare = num(r.passengersDelivered) * rr.fareBase + (Number.isFinite(r.passengerKm) ? Math.max(0, r.passengerKm) : 0) * E.farePerPassengerKm;
    const punctualityAvg = avg((r.delaySecAtStations || []).map(punctualityScore));
    const accuracyAvg = avg((r.stopErrors || []).map(accuracyScore));

    const puncValue = baseFare * (punctualityAvg >= 0 ? punctualityAvg * E.punctuality.maxBonus : punctualityAvg * E.punctuality.maxPenalty);
    const accValue = baseFare * accuracyAvg * E.accuracy.maxBonus;
    const overValue = -baseFare * Math.min(E.overspeed.maxFrac, num(Math.round((r.overspeedSeconds || 0) * 1000)) / 1000 * E.overspeed.fracPerSecond);
    const spads = Math.min(E.spad.maxCount, num(r.spads));
    const spadValue = -spads * (E.spad.flat + baseFare * E.spad.frac);
    const harshValue = -baseFare * Math.min(E.harsh.maxFrac, num(r.harshEvents) * E.harsh.fracEach) * harshMult;
    const comfortValue = baseFare * (fareMult - 1);

    const lines = [
      ['fares', baseFare], ['comfort', comfortValue], ['punctuality', puncValue], ['accuracy', accValue],
      ['overspeed', overValue], ['spad', spadValue], ['harsh', harshValue],
    ].map(([key, value]) => ({ key, value: Math.round(value) }));
    let subtotal = lines.reduce((a, l) => a + l.value, 0);
    const breakdown = lines.filter((l) => l.value !== 0 || l.key === 'fares');
    if (subtotal < 0) {
      breakdown.push({ key: 'floor', value: -subtotal });
      subtotal = 0;
    }
    let cash = subtotal;
    if (mode === 'endless') {
      cash = Math.round(subtotal * E.endlessMultiplier);
      breakdown.push({ key: 'endless', value: cash - subtotal });
    }
    const points = Math.max(0, Math.round(cash * E.pointsPerEuro));
    const ratio = clamp(((punctualityAvg + 1) / 2) * 0.5 + ((accuracyAvg + 0.5) / 1.5) * 0.4 + (spads ? 0 : 0.1), 0, 1);
    return {
      cash, points, breakdown,
      metrics: { punctuality: punctualityAvg, accuracy: accuracyAvg, comfortLevel, grade: gradeFor(ratio) },
    };
  }

  /* Apply a finished service to the save: the career of the vehicle that drove it gets wallet += cash and
     lifetime += cash (so tb never decreases). */
  function completeService(save, result, mode) {
    const s = normalize(save);
    const cid = careerOfTrain(result && result.trainId) || s.career;
    const c = s[cid];
    const rw = reward(result, mode, s);
    const lifetime = Math.min(MAX, c.lifetime + rw.cash);
    const routeId = result && result.routeId;
    const best = { ...c.best };
    if (mode !== 'endless' && careerOfRoute(routeId) === cid && rw.points > (best[routeId] || 0)) best[routeId] = rw.points;
    const totalServices = s.rail.services + s.tram.services + 1;
    const next = normalize({
      ...s, savedAt: Date.now(),
      hints: s.hintsSet ? s.hints : totalServices < C.coachServices,   // the coach retires itself after the first few services unless the player chose
      [cid]: {
        ...c, lifetime, wallet: Math.min(lifetime, c.wallet + rw.cash), services: c.services + 1, best,
        endlessBest: mode === 'endless' ? Math.max(c.endlessBest, rw.points) : c.endlessBest,
      },
    });
    return { save: next, reward: rw, rankUp: rank(next[cid].lifetime, cid) > rank(c.lifetime, cid) ? rank(next[cid].lifetime, cid) : -1, career: cid };
  }

  TS.career = {
    defaults, normalize, merge, of, setCareer, setHints, buyTrain, buyUpgrade, buyRoute, select, selectRoute, canBuy, upgradePrice,
    applyUpgrades, routeAvailable, endlessOrder, routeClass, trainCompatible, trainsForRoute, requiredTrain,
    careerOfTrain, careerOfRoute, trainIdsOf, routeIdsOf, unlockedAll, CAREERS,
    rank, rankInfo, reward, completeService, punctualityScore, accuracyScore, MAX_LEVELS,
  };
})();
