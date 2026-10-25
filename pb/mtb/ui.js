/* The screens of the game, all DOM on top of the canvas (no THREE): HUD, start card, animated hint, 3-2-1-Go, split toasts, finish screen, menu (trails with the painted map,
 * bikes, settings, help). The shell (main.js) owns the state and passes plain data in; the screens call back through `handlers`.
 * Text comes from i18n.js (lb / de / en / fr); everything that can be tapped is >= 44 px. */
import { t as translate, trailName, trailBlurb, formatTime, formatSplit, LANGS, LANG_NAMES } from './i18n.js';
import { BIKES, BIKE_IDS } from './config.js';
import { paintValleyMap, hitTestTrail } from './map-paint.js';

const GRADE_COLOURS = { green: '#3fbf5a', blue: '#3d8bff', red: '#e5483f', black: '#2a2a2a' };
const MEDAL_ICON = ['—', '🥉', '🥈', '🥇'];
const MEDAL_KEYS = ['none', 'bronze', 'silver', 'gold'];
const TIME_IDS = ['random', 'dawn', 'morning', 'noon', 'evening', 'dusk', 'night'];
const WEATHER_IDS = ['random', 'clear', 'cloudy', 'fog', 'rain'];
const SEASON_IDS = ['random', 'summer', 'autumn'];
const QUALITY_IDS = ['auto', 'low', 'medium', 'high'];
const HINT_STEPS = ['pedal', 'steer', 'brake', 'jump'];
const HINT_STEP_MS = 1500;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createUi({ root, lang, trails, handlers, touch = false }) {
  let L = lang;
  const T = (key, params) => translate(L, key, params);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const on = (node, type, fn) => node.addEventListener(type, fn);
  const btn = (cls, html, fn, label) => { const b = el('button', cls, html); b.type = 'button'; if (label) b.setAttribute('aria-label', label); on(b, 'click', (e) => { e.stopPropagation(); fn(e); }); return b; };
  const state = { card: null, menuTab: 'trails', menuOpen: false, data: null, hintTimer: 0, hintStep: 0, toastTimer: 0, lastSplit: 0 };

  // ---------------------------------------------------------------- HUD
  const hud = el('div', 'mhud');
  hud.innerHTML = `
    <div class="hud-tl"><div class="trail-line"><span class="grade" id="hudGrade"></span><span id="hudTrail"></span></div><div class="bar"><i id="hudBar"></i></div><div id="hudCp" class="sub"></div></div>
    <div class="hud-tc"><div id="hudTime" class="clock">0:00.0</div><div id="hudSplit" class="split" aria-live="polite"></div></div>
    <div class="hud-tr"><div class="speed"><b id="hudSpeed">0</b><small id="hudSpeedUnit">km/h</small></div><div class="hud-btns" id="hudBtns"></div></div>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <div id="banner" class="banner"></div>`;
  root.appendChild(hud);
  const q = (id) => hud.querySelector(`#${id}`);
  const hudBtns = q('hudBtns');
  const hudButtons = {
    menu: btn('hbtn', '☰', () => handlers.onMenu(), 'menu'),
    reset: btn('hbtn', '↺', () => handlers.onReset(), 'reset'),
    camera: btn('hbtn', '🎥', () => handlers.onCamera(), 'camera'),
    time: btn('hbtn', '🕐', () => handlers.onTime(), 'time of day'),
    weather: btn('hbtn', '🌦', () => handlers.onWeather(), 'weather'),
    sound: btn('hbtn', '🔊', () => handlers.onSound(), 'sound'),
  };
  for (const b of Object.values(hudButtons)) hudBtns.appendChild(b);

  // ---------------------------------------------------------------- start card
  const card = el('div', 'mcard hidden');
  card.setAttribute('role', 'dialog');
  root.appendChild(card);

  // ---------------------------------------------------------------- hint (animated)
  const hint = el('div', 'mhint hidden');
  hint.innerHTML = HINT_STEPS.map((k) => `<div class="hi" data-k="${k}"><span class="ico">${{ pedal: '🦵', steer: '↔', brake: '✋', jump: '⤒' }[k]}</span><span class="cap" data-cap="${k}"></span><span class="keys" data-keys="${k}"></span></div>`).join('');
  root.appendChild(hint);

  // ---------------------------------------------------------------- countdown
  const count = el('div', 'mcount hidden');
  root.appendChild(count);

  // ---------------------------------------------------------------- finish
  const finish = el('div', 'mfinish hidden');
  finish.setAttribute('role', 'dialog');
  root.appendChild(finish);

  // ---------------------------------------------------------------- menu
  const menu = el('div', 'mmenu hidden');
  menu.setAttribute('role', 'dialog');
  root.appendChild(menu);

  const orient = el('div', 'morient hidden');
  root.appendChild(orient);

  function medalBadge(m) { return `<span class="medal m${m}" title="${esc(T(`medal.${MEDAL_KEYS[m]}`))}">${MEDAL_ICON[m]}</span>`; }
  const gradeDot = (g) => `<span class="grade ${g}"></span>`;

  // ================================================================ HUD API
  function setHud(d) {
    q('hudSpeed').textContent = Math.round(d.speedKmh);
    if (d.timeMs !== undefined) q('hudTime').textContent = formatTime(d.timeMs);
    if (d.progress !== undefined) q('hudBar').style.width = `${Math.round(d.progress * 100)}%`;
    if (d.cp) q('hudCp').textContent = T('hud.cp', d.cp);
    if (d.found) q('hudCp').textContent = `🦊 ${T('free.count', d.found)}`;
  }
  function setHudMode(mode, trail, d = {}) {
    hud.dataset.mode = mode;
    q('hudTrail').textContent = trail ? trailName(trail, L) : T('free.title');
    q('hudGrade').className = `grade ${trail ? trail.grade : 'green'}`;
    q('hudSpeedUnit').textContent = T('hud.speed');
    hudButtons.reset.hidden = mode === 'card' || mode === 'countdown';
    q('hudTime').parentElement.hidden = mode !== 'run' && mode !== 'finished' && mode !== 'countdown';
    hud.querySelector('.hud-tl').hidden = mode === 'card';
  }
  function setHudButtons(d) {
    hudButtons.sound.textContent = d.muted ? '🔇' : '🔊';
    hudButtons.weather.textContent = { clear: '☀️', cloudy: '☁️', fog: '🌫', rain: '🌧' }[d.weather] || '🌦';
    hudButtons.time.textContent = d.night ? '🌙' : '🕐';
    for (const [k, b] of Object.entries(hudButtons)) b.title = { menu: T('hud.menu'), reset: T('hud.reset'), camera: T('hud.camera'), time: `${T('hud.timeOfDay')}: ${d.timeLabel || ''}`, weather: `${T('hud.weather')}: ${d.weatherLabel || ''}`, sound: T('hud.sound') }[k];
  }
  function toast(text, kind = '') {
    const e = q('toast');
    e.textContent = text; e.className = `toast show ${kind}`;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { e.className = 'toast'; }, 2400);
  }
  function banner(text, kind = '', ms = 1800) {
    const e = q('banner');
    e.textContent = text; e.className = `banner show ${kind}`;
    setTimeout(() => { if (e.textContent === text) e.className = 'banner'; }, ms);
  }
  function split(delta, n) {
    const e = q('hudSplit');
    if (delta === null || delta === undefined) { e.textContent = T('toast.split', { n }); e.className = 'split show'; }
    else { e.textContent = formatSplit(delta); e.className = `split show ${delta <= 0 ? 'good' : 'bad'}`; }
    clearTimeout(state.lastSplit);
    state.lastSplit = setTimeout(() => { e.className = 'split'; }, 3200);
  }

  // ================================================================ start card
  /** d = { trail, bestMs, bestMedal, medals {gold, silver, bronze} s, locked, unlockText, daily, canGhost, bike, points } */
  function showCard(d) {
    state.card = d;
    const tr = d.trail;
    const med = d.medals;
    const km = (tr.length / 1000).toFixed(1);
    card.innerHTML = `
      <div class="card-head">${gradeDot(tr.grade)}<div><b class="ct">${esc(trailName(tr, L))}</b><div class="cs">${d.daily ? `<span class="tag">${esc(T('card.daily'))}</span> ` : ''}${esc(trailBlurb(tr, L))}</div></div></div>
      <div class="card-stats"><span>${esc(T('card.length'))} <b>${km} km</b></span><span>${esc(T('card.drop'))} <b>${Math.round(tr.descent)} m</b></span><span class="gl">${esc(T(`grade.${tr.grade}`))}</span></div>
      <div class="card-medals">
        <span class="mt">${medalBadge(3)} ${med ? formatTime(med.gold * 1000) : '–'}</span><span class="mt">${medalBadge(2)} ${med ? formatTime(med.silver * 1000) : '–'}</span><span class="mt">${medalBadge(1)} ${med ? formatTime(med.bronze * 1000) : '–'}</span>
      </div>
      <div class="card-best">${esc(T('card.best'))}: <b>${d.bestMs ? formatTime(d.bestMs, true) : esc(T('card.none'))}</b> ${d.bestMs ? medalBadge(d.bestMedal || 0) : ''}${d.canGhost ? ` <span class="ghost">👻 ${esc(T('card.ghost'))}</span>` : ''}</div>
      ${d.locked ? `<div class="locked">🔒 ${esc(T('card.locked'))}: ${esc(d.unlockText || '')}</div>` : ''}
      <div class="card-go"></div>
      <div class="card-sub"></div>`;
    const go = card.querySelector('.card-go');
    const bigStart = btn('bigstart', esc(T('start')), () => handlers.onStart(), T('start'));
    if (d.locked) bigStart.disabled = true;
    go.appendChild(bigStart);
    const sub = card.querySelector('.card-sub');
    sub.appendChild(btn('sbtn', `🗺 ${esc(T('card.trails'))}`, () => handlers.onMenu('trails')));
    sub.appendChild(btn('sbtn', `🦊 ${esc(T('card.ride'))}`, () => handlers.onFree()));
    sub.appendChild(btn('sbtn', `📅 ${esc(T('card.daily'))}`, () => handlers.onDaily()));
    sub.appendChild(btn('sbtn', `🚲 ${esc(T(`bike.${d.bike}`))}`, () => handlers.onMenu('bikes')));
    card.classList.remove('hidden');
    setTimeout(() => { try { bigStart.focus({ preventScroll: true }); } catch (error) { /* focus is a nicety */ } }, 50);
  }
  const hideCard = () => { card.classList.add('hidden'); state.card = null; };

  // ================================================================ animated hint
  function showHint(isTouch) {
    clearInterval(state.hintTimer);
    const keyText = isTouch
      ? { pedal: T('touch.pedal'), steer: T('touch.steer'), brake: T('touch.brake'), jump: T('touch.jump') }
      : { pedal: 'W ↑', steer: 'A D ← →', brake: 'S ↓', jump: 'Space' };
    for (const k of HINT_STEPS) { hint.querySelector(`[data-cap="${k}"]`).textContent = T(`hint.${k}`); hint.querySelector(`[data-keys="${k}"]`).textContent = keyText[k]; }
    hint.classList.remove('hidden', 'gone');
    hint.classList.toggle('touch', isTouch);
    state.hintStep = 0;
    const tick = () => { hint.querySelectorAll('.hi').forEach((n, i) => n.classList.toggle('on', i === state.hintStep % HINT_STEPS.length)); state.hintStep++; };
    tick(); state.hintTimer = setInterval(tick, HINT_STEP_MS);
  }
  function hideHint(fade = true) {
    clearInterval(state.hintTimer);
    if (fade) { hint.classList.add('gone'); setTimeout(() => hint.classList.add('hidden'), 900); } else hint.classList.add('hidden');
  }

  // ================================================================ countdown
  function showCount(n) {
    count.classList.remove('hidden');
    count.innerHTML = `<div class="lights"><i class="${n >= 3 ? 'r' : ''}"></i><i class="${n >= 2 ? 'r' : ''}"></i><i class="${n >= 1 ? 'r' : ''}"></i></div><div class="num">${n === 0 ? esc(T('go')) : n}</div>`;
    count.classList.toggle('go', n === 0);
    count.classList.remove('pop'); void count.offsetWidth; count.classList.add('pop');
    if (n === 0) setTimeout(() => count.classList.add('hidden'), 900);
  }
  const hideCount = () => count.classList.add('hidden');

  // ================================================================ finish
  /** d = { trail, ms, medal, isBest, bestMs, crashes, splits, bestSplits, nextMedal {medal, seconds}, unlocks [{text}], beatGhost, hasNext, daily } */
  function showFinish(d) {
    const rows = d.splits.map((ms, i) => { const best = d.bestSplits[i]; const delta = best ? ms - best : null; return `<span class="sp ${delta === null ? '' : delta <= 0 ? 'good' : 'bad'}">${i + 1}: ${formatTime(ms)}${delta === null ? '' : ` (${formatSplit(delta)})`}</span>`; }).join('');
    finish.innerHTML = `
      <div class="fin-box">
        <div class="fin-title">${esc(T('finish.title'))}</div>
        <div class="fin-trail">${gradeDot(d.trail.grade)} ${esc(trailName(d.trail, L))}${d.daily ? ` · ${esc(T('card.daily'))}` : ''}</div>
        <div class="fin-medal">${medalBadge(d.medal)}<span class="mn">${esc(T(`medal.${MEDAL_KEYS[d.medal]}`))}</span></div>
        <div class="fin-time">${esc(T('finish.time'))} <b>${formatTime(d.ms, true)}</b>${d.isBest ? ` <span class="newbest">${esc(T('finish.newBest'))}</span>` : ''}</div>
        <div class="fin-best">${esc(T('finish.best'))}: ${formatTime(d.isBest ? d.ms : d.bestMs, true)}${d.crashes ? ` · ${esc(T('finish.crashes'))}: ${d.crashes}` : ''}</div>
        ${d.beatGhost ? `<div class="fin-ghost">👻 ${esc(T('finish.ghostWon'))}</div>` : d.ghostLost ? `<div class="fin-ghost lost">👻 ${esc(T('finish.ghostLost'))}</div>` : ''}
        ${d.nextMedal ? `<div class="fin-next">${esc(T('finish.nextMedal', { medal: T(`medal.${MEDAL_KEYS[d.nextMedal.medal]}`), time: formatTime(d.nextMedal.seconds * 1000) }))}</div>` : ''}
        ${(d.unlocks || []).map((u) => `<div class="fin-unlock"><span class="okmark">✓</span> ${esc(T('finish.unlocked', { what: u }))}</div>`).join('')}
        ${d.valid === false ? `<div class="fin-invalid">${esc(T('finish.invalid'))}</div>` : ''}
        ${d.daily ? `<div class="fin-daily" id="finDaily"></div>` : ''}
        <div class="fin-splits">${rows}</div>
        <div class="fin-btns"></div>
      </div>`;
    const bar = finish.querySelector('.fin-btns');
    bar.appendChild(btn('bigstart', esc(T('finish.again')), () => handlers.onAgain()));
    if (d.hasNext) bar.appendChild(btn('sbtn', esc(T('finish.next')), () => handlers.onNext()));
    bar.appendChild(btn('sbtn', `👻 ▶`, () => handlers.onReplay(), 'replay'));
    bar.appendChild(btn('sbtn', esc(T('finish.menu')), () => handlers.onMenu('trails')));
    finish.classList.remove('hidden');
  }
  const setFinishNote = (text) => { const n = finish.querySelector('#finDaily'); if (n) n.textContent = text; };
  const hideFinish = () => finish.classList.add('hidden');

  // ================================================================ menu
  /** d = { progress info for the menu: trails [{trail, locked, unlockText, medal, bestMs}], bikes [{id, locked, points}], points, current {trailId, bike}, settings {...}, daily {...}, viewpoints, map } */
  function openMenu(tab, d) {
    state.menuOpen = true; state.menuTab = tab || state.menuTab; state.data = d;
    renderMenu();
    menu.classList.remove('hidden');
  }
  function closeMenu() { state.menuOpen = false; menu.classList.add('hidden'); }
  const isMenuOpen = () => state.menuOpen;
  function refreshMenu(d) { state.data = d; if (state.menuOpen) renderMenu(); }

  function renderMenu() {
    const d = state.data, tab = state.menuTab;
    const tabs = ['trails', 'bikes', 'settings', 'help'];
    menu.innerHTML = `
      <div class="menu-box">
        <div class="menu-head"><b>${esc(T('menu.title'))}</b><div class="menu-tabs">${tabs.map((k) => `<button type="button" class="tab ${k === tab ? 'on' : ''}" data-tab="${k}">${esc(T(`menu.${k}`))}</button>`).join('')}</div><button type="button" class="x" aria-label="${esc(T('menu.close'))}">✕</button></div>
        <div class="menu-body"></div>
      </div>`;
    on(menu.querySelector('.x'), 'click', () => handlers.onCloseMenu());
    menu.querySelectorAll('.tab').forEach((b) => on(b, 'click', () => { state.menuTab = b.dataset.tab; renderMenu(); }));
    const body = menu.querySelector('.menu-body');
    ({ trails: renderTrails, bikes: renderBikes, settings: renderSettings, help: renderHelp })[tab](body, d);
  }

  function renderTrails(body, d) {
    body.innerHTML = `<div class="trails-grid"><div class="map-wrap"><canvas class="valley" width="420" height="460" aria-label="${esc(T('map.title'))}"></canvas><div class="map-cap">${esc(T('map.title'))} · ${esc(T('map.pick'))}</div></div><div class="trail-list"></div></div>
      <div class="menu-extra"></div>`;
    const list = body.querySelector('.trail-list');
    for (const it of d.trails) {
      const tr = it.trail;
      const row = el('button', `trail-row ${it.locked ? 'locked' : ''} ${d.current.trailId === tr.id ? 'cur' : ''}`);
      row.type = 'button';
      row.innerHTML = `${gradeDot(tr.grade)}<span class="tn"><b>${esc(trailName(tr, L))}</b><small>${(tr.length / 1000).toFixed(1)} km · ${Math.round(tr.descent)} m ${it.locked ? `· 🔒 ${esc(it.unlockText)}` : it.bestMs ? `· ${formatTime(it.bestMs, true)}` : ''}</small></span>${it.locked ? '' : medalBadge(it.medal)}`;
      on(row, 'click', () => handlers.onPickTrail(tr.id));
      list.appendChild(row);
    }
    const extra = body.querySelector('.menu-extra');
    extra.appendChild(btn('sbtn wide', `🦊 ${esc(T('menu.ride'))}<small>${esc(T('menu.rideInfo'))} · ${esc(T('free.count', { n: d.viewpoints.found, total: d.viewpoints.total }))}</small>`, () => handlers.onFree()));
    const dl = d.daily;
    extra.appendChild(btn('sbtn wide', `📅 ${esc(T('menu.daily'))}<small>${esc(T('menu.dailyInfo', { trail: dl.trailName, time: T(`time.${dl.time}`), weather: T(`weather.${dl.weather}`) }))}${dl.bestMs ? ` · ${esc(T('menu.dailyDone', { time: formatTime(dl.bestMs, true) }))}` : ''}</small>`, () => handlers.onDaily()));
    if (dl.canBoard) extra.appendChild(btn('sbtn', `🏆 ${esc(T('menu.dailyBoard'))}`, () => handlers.onBoard(), 'board'));
    extra.appendChild(btn('sbtn', `🏆 ${esc(T('hud.menu'))} · Arcade`, () => handlers.onBoard('trail'), 'board'));
    // the painted map
    const canvas = body.querySelector('canvas.valley');
    paintValleyMap(canvas, d.map, { trails: d.trails.map((it) => ({ id: it.trail.id, grade: it.trail.grade, line: it.trail.line, locked: it.locked, current: d.current.trailId === it.trail.id })), viewpoints: d.map.viewpoints, found: d.map.found, rider: d.map.rider });
    on(canvas, 'click', (e) => {
      const r = canvas.getBoundingClientRect();
      const id = hitTestTrail(canvas, d.map, d.trails.map((it) => ({ id: it.trail.id, line: it.trail.line })), (e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height);
      if (id) handlers.onPickTrail(id);
    });
  }

  function renderBikes(body, d) {
    body.innerHTML = `<div class="bike-points">${esc(T('bike.points', { n: d.points }))}</div><div class="bikes"></div>`;
    const wrap = body.querySelector('.bikes');
    const maxOf = (k) => Math.max(...BIKE_IDS.map((id) => k(BIKES[id])));
    const bar = (v) => `<i style="width:${Math.round(v * 100)}%"></i>`;
    for (const it of d.bikes) {
      const b = BIKES[it.id];
      const row = el('div', `bike ${it.locked ? 'locked' : ''} ${d.current.bike === it.id ? 'cur' : ''}`);
      row.innerHTML = `<div class="bn"><span class="sw" style="background:${b.color}"></span><b>${esc(T(`bike.${it.id}`))}</b>${it.locked ? `<small>🔒 ${esc(T('bike.unlockAt', { n: it.points }))}</small>` : ''}</div>
        <p>${esc(T(`bike.${it.id}.info`))}</p>
        <div class="bars"><label>${esc(T('bike.travel'))}<span class="b">${bar(b.travel / 0.2)}</span></label><label>${esc(T('bike.weight'))}<span class="b">${bar(b.mass / 92)}</span></label><label>${esc(T('bike.grip'))}<span class="b">${bar((b.grip - 0.85) / 0.3)}</span></label><label>${esc(T('bike.climb'))}<span class="b">${bar(b.powerK / 1.06)}</span></label><label>${esc(T('bike.landing'))}<span class="b">${bar((b.crashImpact - 8) / 8)}</span></label></div>`;
      if (!it.locked) { row.tabIndex = 0; on(row, 'click', () => handlers.onPickBike(it.id)); }
      wrap.appendChild(row);
    }
    void maxOf;
  }

  function renderSettings(body, d) {
    const s = d.settings;
    const select = (id, label, ids, value, fmt) => `<label class="srow"><span>${esc(label)}</span><select data-set="${id}">${ids.map((v) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(fmt(v))}</option>`).join('')}</select></label>`;
    body.innerHTML = `<div class="settings">
      ${select('time', T('set.time'), TIME_IDS, s.time, (v) => (v === 'random' ? T('set.random') : T(`time.${v}`)))}
      ${select('weather', T('set.weather'), WEATHER_IDS, s.weather, (v) => (v === 'random' ? T('set.random') : T(`weather.${v}`)))}
      ${select('season', T('set.season'), SEASON_IDS, s.season, (v) => (v === 'random' ? T('set.random') : T(`season.${v}`)))}
      ${select('quality', T('set.quality'), QUALITY_IDS, s.quality, (v) => (v === 'auto' ? `${T('set.auto')} (${T(`quality.${d.autoQuality}`)})` : T(`quality.${v}`)))}
      ${select('lang', T('set.language'), LANGS, s.lang, (v) => LANG_NAMES[v])}
      ${select('sound', T('set.sound'), ['on', 'off'], s.muted ? 'off' : 'on', (v) => T(`set.${v}`))}
      <p class="note">${esc(T('set.note'))}</p>
      <p class="note">${esc(d.cloud ? T('save.cloud') : T('save.local'))}</p></div>`;
    body.querySelectorAll('select').forEach((sel) => on(sel, 'change', () => handlers.onSetting(sel.dataset.set, sel.value)));
  }

  function renderHelp(body) {
    body.innerHTML = `<div class="help">
      <h4>${esc(T('help.keys'))}</h4><ul><li>${esc(T('help.pedal'))}</li><li>${esc(T('help.steer'))}</li><li>${esc(T('help.brake'))}</li><li>${esc(T('help.jump'))}</li><li>${esc(T('help.other'))}</li></ul>
      <h4>${esc(T('help.touch'))}</h4><ul><li>${esc(T('help.touch1'))}</li></ul>
      <ul class="tips"><li>💡 ${esc(T('help.tip1'))}</li><li>💡 ${esc(T('help.tip2'))}</li><li>💡 ${esc(T('help.tip3'))}</li></ul></div>`;
  }

  function setLang(l) { L = l; document.documentElement.lang = l; }
  function setOrientation(show) { orient.textContent = T('orient.rotate'); orient.classList.toggle('hidden', !show); }

  return {
    setHud, setHudMode, setHudButtons, toast, banner, split, showCard, hideCard, showHint, hideHint, showCount, hideCount, showFinish, hideFinish, setFinishNote,
    openMenu, closeMenu, refreshMenu, isMenuOpen, setLang, setOrientation, hud, T: (k, p) => T(k, p), get lang() { return L; },
  };
}
