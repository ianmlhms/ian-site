/* Bus Tycoon: passengers are the single currency. Balance: scripts/BUS-TYCOON.md. */
(function () {
  'use strict';
  const SAVE_VERSION = 1, SAVE_MS = 5000, TICK_MS = 250;
  const REBIRTH_THRESHOLD = 1e12, COST_GROWTH = 1.15, MAX_OWNED = 1000;
  const LIMIT = Number.MAX_SAFE_INTEGER, DRIVER_LIMIT = 18;
  const MILESTONES = Object.freeze([10, 25, 50, 100, 200]);
  const LINES = Object.freeze([
    { id: 'school', name: 'Schoulbus', icon: '🚌', cost: 15, rate: .5 },
    { id: 'city', name: 'City Bus Lëtzebuerg', icon: '🏘️', cost: 180, rate: 2 },
    { id: 'gare', name: 'Line to Gare', icon: '🚉', cost: 2160, rate: 6 },
    { id: 'kirchberg', name: 'Kirchberg line', icon: '🏢', cost: 25920, rate: 15 },
    { id: 'belval', name: 'Belval line', icon: '🏭', cost: 311040, rate: 40 },
    { id: 'night', name: 'Night bus', icon: '🌙', cost: 3732480, rate: 100 },
    { id: 'electric', name: 'Electric fleet', icon: '🔋', cost: 44789760, rate: 250 },
    { id: 'tram', name: 'Tram line', icon: '🚋', cost: 537477120, rate: 600 },
    { id: 'border', name: 'Trier · Metz · Arlon coach', icon: '🌍', cost: 6449725440, rate: 1500 },
    { id: 'findel', name: 'Airport express Findel', icon: '✈️', cost: 77396705280, rate: 4000 },
    { id: 'hyperloop', name: 'Hyperloop (one day…)', icon: '🚀', cost: 928760463360, rate: 10000 },
  ].map(Object.freeze));
  const UPGRADES = Object.freeze([
    { id: 'lanes', name: 'Dedicated bus lanes', desc: 'Skip the traffic. Double all line production.', cost: 500 },
    { id: 'free', name: 'Free public transport boost', desc: 'No fares, more riders! Double all line production.', cost: 50000 },
    { id: 'dispatch', name: 'Smart dispatch', desc: 'Perfect connections. Double all line production.', cost: 5e6 },
    { id: 'charging', name: 'Green charging depots', desc: 'Keep the fleet moving. Double all line production.', cost: 5e8 },
    { id: 'network', name: 'One connected country', desc: 'Every village on the map. Double all line production.', cost: 5e10 },
  ].map(Object.freeze));
  const formatter = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const format = value => formatter.format(value);
  const $ = id => document.getElementById(id);
  const zeroOwned = () => Object.fromEntries(LINES.map(line => [line.id, 0]));
  const initial = () => ({ v: SAVE_VERSION, p: 0, tb: 0, rb: 0, st: 0, rbc: 0, gd: '',
    savedAt: Date.now(), owned: zeroOwned(), upgrades: [], drivers: 0 });
  let state = initial(), loaded = false, rewards = null, lastTick = Date.now(), busCount = -1;
  const lineRefs = new Map(), upgradeRefs = new Map();

  function warn(context, error) { console.warn('[Bus Tycoon] ' + context, error); }
  function number(value, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(LIMIT, value) : fallback;
  }
  function bounded(value) { return Math.min(LIMIT, Math.max(0, value)); }
  function multiplier(save = state) { return 2 ** save.upgrades.length * IdleExtras.multiplier(save.st); }
  function lineRate(line, save = state) {
    const count = save.owned[line.id];
    return bounded(line.rate * count * 2 ** MILESTONES.filter(n => count >= n).length * multiplier(save));
  }
  function production(save = state) { return bounded(LINES.reduce((sum, line) => sum + lineRate(line, save), 0)); }
  function cost(line) { return bounded(line.cost * COST_GROWTH ** state.owned[line.id]); }
  function driverCost() { return bounded(100 * 5 ** state.drivers); }
  function tapPower() { return bounded((1 + 2 * state.drivers ** 2) * IdleExtras.multiplier(state.st)); }
  function score() { window.score = Math.floor(state.tb); Arcade.score(window.score); }
  function earn(amount) {
    if (!(amount > 0) || !Number.isFinite(amount)) return;
    state = { ...state, p: bounded(state.p + amount), tb: bounded(state.tb + amount), rb: bounded(state.rb + amount) };
    score();
  }
  function settle(now = Date.now()) {
    const elapsed = Math.max(0, (now - lastTick) / 1000);
    if (elapsed > 10) {
      const result = IdleExtras.offline(state.st, lastTick, production(), now);
      earn(result.credited); rewards?.notice(result);
    } else earn(elapsed * production() * IdleExtras.activityRate(state.st));
    lastTick = Math.max(now, lastTick);
  }
  function snapshot() {
    return { ...state, owned: { ...state.owned }, upgrades: [...state.upgrades], savedAt: Date.now() };
  }
  function post(message) {
    try { parent.postMessage(message, '*'); }
    catch (error) { warn('Could not send save message', error); }
  }
  function pushSave() {
    settle();
    const save = snapshot();
    // Standalone play also persists; the Arcade parent owns cloud saves in an iframe.
    if (parent === window) {
      try { localStorage.setItem('pb_save_bus-tycoon', JSON.stringify(save)); }
      catch (error) { warn('Could not store local progress', error); }
    }
    post({ __pbSave: 1, data: save });
  }
  function normalize(raw) {
    if (!raw || raw.v !== SAVE_VERSION || !raw.owned || typeof raw.owned !== 'object' || Array.isArray(raw.owned)) return null;
    if (typeof raw.tb !== 'number' || !Number.isFinite(raw.tb) || raw.tb < 0) return null;
    return { v: SAVE_VERSION, p: number(raw.p), tb: number(raw.tb), rb: Math.min(number(raw.rb, raw.tb), number(raw.tb)),
      st: Math.floor(number(raw.st)), rbc: Math.floor(number(raw.rbc)),
      gd: typeof raw.gd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.gd) ? raw.gd : '',
      savedAt: number(raw.savedAt, Date.now()), drivers: Math.min(DRIVER_LIMIT, Math.floor(number(raw.drivers))),
      owned: Object.fromEntries(LINES.map(line => [line.id, Math.min(MAX_OWNED, Math.floor(number(raw.owned[line.id])))])),
      upgrades: UPGRADES.filter(up => Array.isArray(raw.upgrades) && raw.upgrades.includes(up.id)).map(up => up.id) };
  }
  function applySave(raw) {
    const save = normalize(raw);
    if (!save) { if (raw != null) warn('Ignored invalid progress', 'Unknown version or malformed save'); return false; }
    settle();
    if (save.rbc < state.rbc) {
      if (save.tb > state.tb) { state = { ...state, tb: save.tb }; score(); refresh(); pushSave(); }
      return false;
    }
    if (save.rbc === state.rbc && (save.tb < state.tb || (loaded && save.tb === state.tb))) return false;
    loaded = true;
    const now = Date.now(), away = IdleExtras.offline(save.st, save.savedAt, production(save), now);
    state = { ...save, st: Math.max(state.st, save.st), tb: Math.max(state.tb, save.tb), gd: save.gd > state.gd ? save.gd : state.gd, savedAt: now };
    lastTick = now;
    earn(away.credited); rewards?.notice(away); score(); refresh(); pushSave();
    return true;
  }
  function buyLine(line) {
    settle();
    const price = cost(line), count = state.owned[line.id];
    if (state.p < price || count >= MAX_OWNED) return;
    state = { ...state, p: state.p - price, owned: { ...state.owned, [line.id]: count + 1 } };
    $('welcome').textContent = 'Next stop: ' + line.name + '!';
    refresh(); pushSave();
  }
  function buyUpgrade(up) {
    settle();
    if (state.upgrades.includes(up.id) || state.p < up.cost) return;
    state = { ...state, p: state.p - up.cost, upgrades: [...state.upgrades, up.id] };
    refresh(); pushSave();
  }
  function buyDriver() {
    settle();
    const price = driverCost();
    if (state.drivers >= DRIVER_LIMIT || state.p < price) return;
    state = { ...state, p: state.p - price, drivers: state.drivers + 1 };
    refresh(); pushSave();
  }
  function rebirth() {
    settle();
    const stars = Math.floor(Math.sqrt(state.rb / REBIRTH_THRESHOLD));
    if (stars < 1) return;
    state = { ...initial(), tb: state.tb, st: state.st + stars, rbc: state.rbc + 1, gd: state.gd };
    lastTick = Date.now(); score(); refresh();
  }
  function buildShop() {
    for (const line of LINES) {
      const card = document.createElement('article'); card.className = 'line'; card.dataset.id = line.id;
      card.innerHTML = `<div class="line-head"><span class="line-icon" aria-hidden="true">${line.icon}</span><div><h3>${line.name}</h3><p class="rate"></p></div><span class="owned"></span></div><button type="button"></button><span class="milestone"></span>`;
      const refs = { owned: card.querySelector('.owned'), rate: card.querySelector('.rate'), buy: card.querySelector('button'), milestone: card.querySelector('.milestone') };
      refs.buy.addEventListener('click', () => buyLine(line)); lineRefs.set(line.id, refs); $('lines').append(card);
    }
    for (const up of UPGRADES) {
      const card = document.createElement('article'); card.className = 'upgrade'; card.dataset.id = up.id;
      card.innerHTML = `<h3>${up.name}</h3><p>${up.desc}</p><button type="button"></button>`;
      const button = card.querySelector('button'); button.addEventListener('click', () => buyUpgrade(up));
      upgradeRefs.set(up.id, button); $('upgrades').append(card);
    }
    const driver = document.createElement('article'); driver.className = 'upgrade';
    driver.innerHTML = '<h3>🧑‍✈️ Hire drivers</h3><p>A friendly wave goes further. Improve passengers per tap.</p><button id="drivers" type="button"></button>';
    $('upgrades').prepend(driver); $('drivers').addEventListener('click', buyDriver);
  }
  function refreshBuses() {
    const count = Math.min(3, LINES.filter(line => state.owned[line.id] > 0).length);
    if (count === busCount) return;
    busCount = count; $('road').replaceChildren();
    for (let i = 0; i < count; i++) {
      const bus = document.createElement('span'); bus.className = 'bus'; bus.textContent = '🚌'; $('road').append(bus);
    }
  }
  function refresh() {
    $('passengers').textContent = format(state.p) + ' 🧍'; $('income').textContent = format(production()); $('lifetime').textContent = format(state.tb);
    $('tap-power').textContent = '+' + format(tapPower()) + (tapPower() === 1 ? ' passenger' : ' passengers');
    for (const line of LINES) {
      const refs = lineRefs.get(line.id), count = state.owned[line.id], next = MILESTONES.find(n => n > count);
      refs.owned.textContent = '×' + count; refs.rate.textContent = format(lineRate(line)) + ' passengers / sec';
      refs.buy.textContent = 'Open line · ' + format(cost(line)) + ' 🧍'; refs.buy.disabled = state.p < cost(line) || count >= MAX_OWNED;
      refs.buy.setAttribute('aria-label', refs.buy.textContent + ': ' + line.name);
      refs.milestone.textContent = next ? `At ${next} lines: double this route's production` : 'All milestones reached · 32× route production';
    }
    for (const up of UPGRADES) {
      const button = upgradeRefs.get(up.id), bought = state.upgrades.includes(up.id);
      button.textContent = bought ? '✓ Upgraded' : 'Upgrade · ' + format(up.cost) + ' 🧍'; button.disabled = bought || state.p < up.cost;
    }
    $('drivers').textContent = state.drivers >= DRIVER_LIMIT ? '✓ All drivers hired' : `Hire · ${format(driverCost())} 🧍 · tap +${format((1 + 2 * (state.drivers + 1) ** 2) * IdleExtras.multiplier(state.st))}`;
    $('drivers').disabled = state.drivers >= DRIVER_LIMIT || state.p < driverCost();
    refreshBuses(); rewards?.refresh();
  }
  function theme() {
    try { document.body.classList.toggle('bus-light', JSON.parse(localStorage.getItem('site_theme') || '{}').mode === 'light'); }
    catch (error) { warn('Could not read theme', error); }
  }
  buildShop(); theme();
  window.addEventListener('storage', theme);
  rewards = IdleExtras.mount({ host: $('rewards-host'), threshold: REBIRTH_THRESHOLD, read: () => state, format,
    resets: 'passengers to invest, all lines (including gifted lines), drivers and network upgrades.',
    production, currency: '🧍', rebirth, save: pushSave, earn: amount => { earn(amount); refresh(); },
    gift: (day, amount) => { state = { ...state, gd: day }; earn(amount); refresh(); } });
  let local = window.__pbSave;
  if (parent === window && !local) {
    try { local = JSON.parse(localStorage.getItem('pb_save_bus-tycoon') || 'null'); }
    catch (error) { warn('Could not restore progress', error); }
  }
  applySave(local); refresh(); score(); post({ __pbWantSave: 1 });
  $('wave').addEventListener('click', () => { settle(); earn(tapPower()); refresh(); pushSave(); });
  window.addEventListener('message', event => {
    if (event.source === parent && event.data?.__pbLoadSave === 1) applySave(event.data.data);
  });
  window.addEventListener('pagehide', pushSave);
  document.addEventListener('visibilitychange', () => { settle(); refresh(); pushSave(); });
  setInterval(() => { settle(); refresh(); }, TICK_MS); setInterval(pushSave, SAVE_MS);
})();
