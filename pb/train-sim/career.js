/* Lokféierer: career, pure functions over a save object. Never mutates inputs.
   Save shape: { v, tb (lifetime EUR, monotonic, the server compares this), lifetime, wallet, savedAt,
                 owned:[trainId], routes:[routeId], train, route, upgrades:{[trainId]:{motor,brakes,comfort,capacity,paint}},
                 best:{[routeId]:points}, services, endlessBest } */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const C = TS.config;
  const MAX = Number.MAX_SAFE_INTEGER;
  const FREE_TRAIN = 'railcar';
  const FREE_ROUTE = 'west';
  const MAX_LEVELS = Object.freeze(Object.fromEntries(C.upgradeKinds.map((k) => [k, C.upgrades.railcar[k].length])));

  const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(MAX, Math.floor(n))) : 0);
  const trainById = (id) => C.trains.find((t) => t.id === id) || null;
  const rule = (routeId) => C.routeRules[routeId] || null;
  const unique = (list, allowed) => [...new Set(Array.isArray(list) ? list.filter((x) => allowed.includes(x)) : [])];
  const allRouteIds = () => Object.keys(C.routeRules);

  function emptyUpgrades() {
    return Object.fromEntries(C.trains.map((t) => [t.id, Object.fromEntries(C.upgradeKinds.map((k) => [k, 0]))]));
  }

  function normalize(data) {
    const d = data && typeof data === 'object' ? data : {};
    const lifetime = Math.max(num(d.lifetime), num(d.tb));
    const owned = unique([FREE_TRAIN, ...(Array.isArray(d.owned) ? d.owned : [])], C.trains.map((t) => t.id));
    const freeRoutes = allRouteIds().filter((id) => C.routeRules[id].price === 0);
    const routes = unique([...freeRoutes, ...(Array.isArray(d.routes) ? d.routes : [])], allRouteIds());
    const upgrades = emptyUpgrades();
    for (const t of C.trains) {
      for (const k of C.upgradeKinds) {
        upgrades[t.id][k] = Math.min(MAX_LEVELS[k], num(d.upgrades && d.upgrades[t.id] && d.upgrades[t.id][k]));
      }
    }
    const best = {};
    if (d.best && typeof d.best === 'object') for (const id of allRouteIds()) if (num(d.best[id])) best[id] = num(d.best[id]);
    return {
      v: C.saveVersion, tb: lifetime, lifetime, wallet: Math.min(lifetime, num(d.wallet)), savedAt: num(d.savedAt),
      owned, routes, train: owned.includes(d.train) ? d.train : FREE_TRAIN, route: routes.includes(d.route) ? d.route : FREE_ROUTE,
      upgrades, best, services: num(d.services), endlessBest: num(d.endlessBest),
    };
  }

  const defaults = () => normalize({});

  /* Whole-save winner: higher lifetime wins; tie -> newer savedAt. Spent euros can't be resurrected. */
  function merge(local, cloud) {
    const a = normalize(local);
    const b = normalize(cloud);
    return b.lifetime > a.lifetime || (b.lifetime === a.lifetime && b.savedAt > a.savedAt) ? b : a;
  }

  const withSave = (save, patch) => normalize({ ...save, ...patch });

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
    if (!s.routes.includes(routeId)) return { ok: false, reason: 'needsRoute', needs: trainsForRoute(routeId) };
    const id = trainId || s.train;
    if (!trainById(id)) return { ok: false, reason: 'unknownTrain', needs: trainsForRoute(routeId) };
    if (!s.owned.includes(id)) return { ok: false, reason: 'trainNotOwned', needs: [] };
    if (!trainCompatible(id, routeId)) return { ok: false, reason: 'wrongTrainKind', needs: trainsForRoute(routeId) };
    return { ok: true, reason: '', needs: [] };
  }

  // ---- purchases (return new save or null)
  function buyTrain(save, id) {
    const s = normalize(save);
    const t = trainById(id);
    if (!t || s.owned.includes(id) || s.wallet < t.price) return null;
    return withSave(s, { owned: [...s.owned, id], train: id, wallet: s.wallet - t.price });
  }
  function upgradePrice(save, trainId, kind) {
    const s = normalize(save);
    const table = C.upgrades[trainId] && C.upgrades[trainId][kind];
    if (!table) return undefined;
    return table[s.upgrades[trainId][kind]];
  }
  function buyUpgrade(save, trainId, kind) {
    const s = normalize(save);
    if (!s.owned.includes(trainId) || !C.upgradeKinds.includes(kind)) return null;
    const price = upgradePrice(s, trainId, kind);
    if (price === undefined || s.wallet < price) return null;
    const upgrades = { ...s.upgrades, [trainId]: { ...s.upgrades[trainId], [kind]: s.upgrades[trainId][kind] + 1 } };
    return withSave(s, { upgrades, wallet: s.wallet - price });
  }
  function buyRoute(save, routeId) {
    const s = normalize(save);
    const r = rule(routeId);
    if (!r || s.routes.includes(routeId) || s.wallet < r.price) return null;
    if (!s.owned.some((id) => trainCompatible(id, routeId))) return null; // no point buying a line you can't drive
    return withSave(s, { routes: [...s.routes, routeId], wallet: s.wallet - r.price });
  }
  function select(save, trainId) {
    const s = normalize(save);
    return s.owned.includes(trainId) ? withSave(s, { train: trainId }) : null;
  }
  function selectRoute(save, routeId) {
    const s = normalize(save);
    return s.routes.includes(routeId) ? withSave(s, { route: routeId }) : null;
  }
  /* Why can't I buy? -> { ok, reason, price }. */
  function canBuy(save, kind, id, extra) {
    const s = normalize(save);
    if (kind === 'train') {
      const t = trainById(id);
      if (!t) return { ok: false, reason: 'unknownTrain', price: 0 };
      if (s.owned.includes(id)) return { ok: false, reason: 'owned', price: t.price };
      return { ok: s.wallet >= t.price, reason: s.wallet >= t.price ? '' : 'needsMoney', price: t.price };
    }
    if (kind === 'route') {
      const r = rule(id);
      if (!r) return { ok: false, reason: 'unknownRoute', price: 0 };
      if (s.routes.includes(id)) return { ok: false, reason: 'owned', price: r.price };
      if (!s.owned.some((tid) => trainCompatible(tid, id))) return { ok: false, reason: 'needsTrain', price: r.price };
      return { ok: s.wallet >= r.price, reason: s.wallet >= r.price ? '' : 'needsMoney', price: r.price };
    }
    if (kind === 'upgrade') {
      const trainId = extra || s.train;
      if (!s.owned.includes(trainId)) return { ok: false, reason: 'trainNotOwned', price: 0 };
      const price = upgradePrice(s, trainId, id);
      if (price === undefined) return { ok: false, reason: 'maxLevel', price: 0 };
      return { ok: s.wallet >= price, reason: s.wallet >= price ? '' : 'needsMoney', price };
    }
    return { ok: false, reason: 'unknown', price: 0 };
  }

  // ---- upgrades -> effective train config
  function applyUpgrades(trainConfig, save) {
    const s = normalize(save);
    const base = trainConfig || trainById(s.train);
    if (!base) return null;
    const lv = s.upgrades[base.id] || Object.fromEntries(C.upgradeKinds.map((k) => [k, 0]));
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

  // ---- ranks
  function rank(lifetime) {
    const n = num(lifetime);
    return C.ranks.reduce((best, threshold, i) => (n >= threshold ? i : best), 0);
  }
  function rankInfo(lifetime) {
    const index = rank(lifetime);
    const next = index + 1 < C.ranks.length ? C.ranks[index + 1] : null;
    const from = C.ranks[index];
    return { index, id: C.rankIds[index], next, progress: next === null ? 1 : (num(lifetime) - from) / (next - from) };
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

  /* Apply a finished service to the save. wallet += cash, tb/lifetime += cash (never decreases). */
  function completeService(save, result, mode) {
    const s = normalize(save);
    const rw = reward(result, mode, s);
    const lifetime = Math.min(MAX, s.lifetime + rw.cash);
    const routeId = result && result.routeId;
    const best = { ...s.best };
    if (mode !== 'endless' && rule(routeId) && rw.points > (best[routeId] || 0)) best[routeId] = rw.points;
    const next = withSave(s, {
      lifetime, tb: lifetime, wallet: Math.min(lifetime, s.wallet + rw.cash), services: s.services + 1, best,
      endlessBest: mode === 'endless' ? Math.max(s.endlessBest, rw.points) : s.endlessBest, savedAt: Date.now(),
    });
    return { save: next, reward: rw, rankUp: rank(next.lifetime) > rank(s.lifetime) ? rank(next.lifetime) : -1 };
  }

  TS.career = {
    defaults, normalize, merge, buyTrain, buyUpgrade, buyRoute, select, selectRoute, canBuy, upgradePrice,
    applyUpgrades, routeAvailable, endlessOrder, routeClass, trainCompatible, trainsForRoute, requiredTrain,
    rank, rankInfo, reward, completeService, punctualityScore, accuracyScore, MAX_LEVELS,
  };
})();
