/* The screens and the HUD (DOM only; main.js owns the game). Plain Luxembourgish, short words.
 *   resort picker -> piste map (+ weather, time of day, Grafik) -> HUD while skiing -> finish card / pause menu */
import { DIFF, DIFF_IDS } from './config.js';
import { RESORTS } from './resort-data.js';
import { TIME_IDS, WEATHER_IDS, TIME_LABEL, WEATHER_LABEL, WEATHER_ICON, TIME_ICON } from './env.js';
import { formatTime, formatClock } from './progress.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export const DIFF_LB = { green: 'Gréng', blue: 'Blo', red: 'Rout', black: 'Schwaarz' };

export function createUi(root) {
  const api = {};

  /* ---------------- resort picker ---------------- */
  api.showResorts = function showResorts({ onPick }) {
    const s = el(`<section class="screen" id="resortScreen" aria-label="Skigebitt wielen">
      <header><h1>Ski Alpen</h1><span class="sub">Wiel e Skigebitt</span></header>
      <p class="intro">Fuer déi richteg Pisten vu richtege Skigebidder erof, géint d'Auer an géint däi Geescht.</p>
      <div class="resorts">${RESORTS.map((r) => `
        <button type="button" class="resort ${r.ready ? 'ready' : 'soon'}" data-id="${r.id}" ${r.ready ? '' : 'disabled aria-disabled="true"'}>
          ${r.ready ? '' : '<span class="tag">geschwënn</span>'}
          <b>${esc(r.name)}</b><span class="c">${esc(r.short)} · ${r.country}</span>
          ${r.ready ? '<span class="btn primary go">Pistekaart</span>' : '<span class="meta">Kënnt an enger nächster Versioun.</span>'}
        </button>`).join('')}</div>
    </section>`);
    s.querySelectorAll('.resort.ready').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.id)));
    root.appendChild(s);
    return { el: s, close() { s.remove(); } };
  };

  /* ---------------- piste map ---------------- */
  api.showMap = function showMap({ resort, pistes, best, env, gfx, onSelect, onStart, onBack }) {
    const groups = DIFF_IDS.map((d) => ({ d, list: pistes.list.filter((p) => p.diff === d).sort((a, b) => a.name.localeCompare(b.name, 'fr')) })).filter((g) => g.list.length);
    const s = el(`<section class="screen" id="mapScreen" aria-label="Pistekaart">
      <header><button type="button" class="btn ghost" data-act="back" aria-label="Zréck">←</button><h1>${esc(resort.name)}</h1><span class="sub">Piste wielen</span></header>
      <div class="mapwrap">
        <div class="mapbox"><canvas id="mapCanvas" aria-label="Pistekaart: tipp op eng Pist"></canvas>
          <div class="zoom"><button type="button" data-z="in" aria-label="Méi no">+</button><button type="button" data-z="out" aria-label="Méi wäit">−</button></div>
          <div class="legend">${DIFF_IDS.map((d) => `<span><i style="background:${DIFF[d].css}"></i>${DIFF_LB[d]}</span>`).join('')}</div>
        </div>
        <div class="side">
          <div class="list">${groups.map((g) => `<div class="grp">${DIFF_LB[g.d]} (${g.list.length})</div>${g.list.map((p) => `
            <button type="button" class="prow" data-id="${p.id}"><span class="chip ${p.diff}"></span><span class="n">${esc(p.name)}</span><span class="m">${(p.length / 1000).toFixed(1)} km${p.src.slalom ? ' · S' : ''}${best(p) ? ' · ★' : ''}</span></button>`).join('')}`).join('')}</div>
          <div class="pick">
            <h2><span class="chip" id="pkChip"></span><span id="pkName">–</span></h2>
            <div class="facts" id="pkFacts"></div>
            <div class="bestline" id="pkBest"></div>
            <div class="setrow"><span>Wieder</span><div class="seg" id="segWeather">${['random', ...WEATHER_IDS].map((w) => `<button type="button" data-v="${w}">${w === 'random' ? '' : WEATHER_ICON[w] + ' '}${WEATHER_LABEL[w]}</button>`).join('')}</div></div>
            <div class="setrow"><span>Zäit</span><div class="seg" id="segTime">${['random', ...TIME_IDS].map((t) => `<button type="button" data-v="${t}">${t === 'random' ? '' : TIME_ICON[t] + ' '}${TIME_LABEL[t]}</button>`).join('')}</div></div>
            <div class="setrow"><span>${esc(gfx.LABELS.title)}</span><div class="seg" id="segGfx">${['auto', ...gfx.LEVELS].map((q) => `<button type="button" data-v="${q}">${esc(gfx.LABELS[q])}</button>`).join('')}</div></div>
            <div class="status" id="pkStatus"></div>
            <button type="button" class="btn primary big" id="startBtn" disabled>Start</button>
          </div>
        </div>
      </div>
    </section>`);
    root.appendChild(s);
    const $ = (sel) => s.querySelector(sel);
    const setSeg = (seg, v) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    setSeg($('#segWeather'), env.state.weatherMode); setSeg($('#segTime'), env.state.timeMode); setSeg($('#segGfx'), gfx.choice());
    $('#segWeather').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; env.setWeather(b.dataset.v); setSeg($('#segWeather'), b.dataset.v); });
    $('#segTime').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; env.setTime(b.dataset.v); setSeg($('#segTime'), b.dataset.v); });
    $('#segGfx').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; gfx.set(b.dataset.v); setSeg($('#segGfx'), b.dataset.v); });
    s.querySelectorAll('.prow').forEach((b) => b.addEventListener('click', () => onSelect(pistes.byId.get(b.dataset.id), true)));
    $('[data-act="back"]').addEventListener('click', onBack);
    $('#startBtn').addEventListener('click', () => { if (!$('#startBtn').disabled) onStart(); });
    return {
      el: s,
      canvas: $('#mapCanvas'),
      zoomButtons: s.querySelectorAll('[data-z]'),
      show(p, bestMs) {
        $('#pkChip').className = `chip ${p.diff}`;
        $('#pkName').textContent = p.name;
        $('#pkFacts').textContent = `${DIFF_LB[p.diff]} · ${(p.length / 1000).toFixed(2)} km · ${Math.round(p.src.drop)} m Héichtenënnerscheed · ${p.src.top} → ${p.src.bottom} m${p.src.slalom ? ' · Slalom' : ''}`;
        $('#pkBest').innerHTML = bestMs ? `Bescht Zäit: <b>${formatTime(bestMs)}</b>` : 'Nach keng Zäit op dëser Pist.';
        s.querySelectorAll('.prow').forEach((b) => { const on = b.dataset.id === p.id; b.classList.toggle('sel', on); if (on) b.scrollIntoView({ block: 'nearest' }); });
      },
      status(text, ready) { $('#pkStatus').textContent = text; $('#startBtn').disabled = !ready; },
      close() { s.remove(); },
    };
  };

  /* ---------------- HUD ---------------- */
  api.createHud = function createHud({ onButton }) {
    const h = el(`<div class="hud" id="hud">
      <div class="tl"><div class="pname"><span class="chip" id="hChip"></span><span id="hName"></span></div><div class="clock" id="hClock"></div><div class="split" id="hSplit"></div><div class="gates" id="hGates"></div></div>
      <div class="tr"><div class="speed"><b id="hSpeed">0</b> <small>km/h</small></div></div>
      <div class="hbtns">
        <button type="button" class="hbtn" data-b="menu" aria-label="Menü">☰</button>
        <button type="button" class="hbtn" data-b="weather" aria-label="Wieder (G)" id="hWeather">☀️</button>
        <button type="button" class="hbtn" data-b="time" aria-label="Zäit vum Dag (T)" id="hTime">🕛</button>
        <button type="button" class="hbtn" data-b="reset" aria-label="Zréck op d'Pist (R)">↺</button>
      </div>
      <div class="toast" id="hToast" style="opacity:0"></div>
      <div class="count" id="hCount" hidden></div>
      <div class="hint" id="hHint" hidden></div>
    </div>`);
    root.appendChild(h);
    h.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', (e) => { e.currentTarget.blur(); onButton(b.dataset.b); }));
    const $ = (id) => h.querySelector('#' + id);
    let toastTimer = 0;
    return {
      el: h,
      setPiste(p, mode) { $('hChip').className = `chip ${p ? p.diff : ''}`; $('hName').textContent = p ? p.name + (mode === 'free' ? ' · Fräi' : '') : ''; },
      setClock(ms, penalty) { const c = $('hClock'); c.textContent = ms === null ? '' : formatClock(ms); c.classList.toggle('pen', penalty > 0); },
      setSplit(text) { $('hSplit').textContent = text || ''; },
      setGates(text) { $('hGates').textContent = text || ''; },
      setSpeed(kmh) { $('hSpeed').textContent = Math.round(kmh); },
      setEnv(weather, time) { $('hWeather').textContent = WEATHER_ICON[weather] || '☀️'; $('hTime').textContent = TIME_ICON[time] || '🕛'; },
      toast(text, ms = 1600) { const t = $('hToast'); t.textContent = text; t.style.opacity = '1'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.opacity = '0'; }, ms); },
      count(text) { const c = $('hCount'); c.hidden = !text; c.textContent = text || ''; c.classList.toggle('go', text === 'Lass!'); },
      hint(text) { const t = $('hHint'); t.hidden = !text; t.textContent = text || ''; },
      show(v) { h.hidden = !v; },
    };
  };

  /* ---------------- finish card ---------------- */
  api.showFinish = function showFinish({ piste, result, bestMs, improved, next, cont, onAgain, onNext, onContinue, onMap }) {
    const rows = [];
    if (result) {
      rows.push(['Zäit', formatTime(result.ms)]);
      if (result.penalty) rows.push(['Strofzäit', `+${(result.penalty / 1000).toFixed(0)} s (${result.missedGates} Paarte verpasst)`]);
      rows.push(['Bescht Zäit', bestMs ? formatTime(bestMs) : '–']);
    }
    const c = el(`<div class="card" id="finishCard" role="dialog" aria-label="Zil">
      <h2><span class="chip ${piste.diff}"></span>${esc(piste.name)}</h2>
      ${result ? `<div class="time">${formatTime(result.ms)}</div>` : '<div class="time">Ënn vun der Pist</div>'}
      ${result && improved && result.valid ? '<div class="new">Nei Bestzäit!</div>' : ''}
      ${result && !result.valid ? `<div class="warn">${result.missedCheckpoints ? 'Du bass vun der Pist ofgefuer: dës Zäit zielt net.' : 'Dës Zäit ass ze séier fir richteg ze sinn: si zielt net.'}</div>` : ''}
      ${rows.length ? `<div class="rows">${rows.map(([a, b]) => `<span>${a}</span><span>${esc(b)}</span>`).join('')}</div>` : ''}
      <div class="acts">
        <button type="button" class="btn primary" data-a="again">Nach eng Kéier</button>
        ${next ? `<button type="button" class="btn" data-a="next">Nächst Pist: ${esc(next.name)}</button>` : ''}
        ${cont ? `<button type="button" class="btn" data-a="cont">Weiderfueren: ${esc(cont.name)}</button>` : ''}
        <button type="button" class="btn ghost" data-a="map">Pistekaart</button>
      </div>
    </div>`);
    root.appendChild(c);
    const on = { again: onAgain, next: onNext, cont: onContinue, map: onMap };
    c.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { c.remove(); on[b.dataset.a](); }));
    return { el: c, close() { c.remove(); } };
  };

  /* ---------------- pause menu ---------------- */
  api.showMenu = function showMenu({ env, gfx, onResume, onAgain, onMap }) {
    const c = el(`<div class="card" id="menuCard" role="dialog" aria-label="Menü">
      <h2>Paus</h2>
      <div class="setrow"><span>Wieder</span><div class="seg" id="mWeather">${['random', ...WEATHER_IDS].map((w) => `<button type="button" data-v="${w}">${WEATHER_LABEL[w]}</button>`).join('')}</div></div>
      <div class="setrow"><span>Zäit</span><div class="seg" id="mTime">${['random', ...TIME_IDS].map((t) => `<button type="button" data-v="${t}">${TIME_LABEL[t]}</button>`).join('')}</div></div>
      <div class="setrow"><span>${esc(gfx.LABELS.title)}</span><div class="seg" id="mGfx">${['auto', ...gfx.LEVELS].map((q) => `<button type="button" data-v="${q}">${esc(gfx.LABELS[q])}</button>`).join('')}</div></div>
      <div class="rows"><span>Steieren</span><span>A D / ◀ ▶</span><span>Hocken</span><span>Leerzeechen</span><span>Bremsen</span><span>S / ▼</span><span>Schreiden</span><span>W / ▲</span><span>Sprangen</span><span>E</span><span>Wieder / Zäit</span><span>G / T</span></div>
      <div class="acts"><button type="button" class="btn primary" data-a="resume">Weider</button><button type="button" class="btn" data-a="again">Nach eng Kéier</button><button type="button" class="btn ghost" data-a="map">Pistekaart</button></div>
    </div>`);
    root.appendChild(c);
    const setSeg = (seg, v) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    const W = c.querySelector('#mWeather'), T = c.querySelector('#mTime'), G = c.querySelector('#mGfx');
    setSeg(W, env.state.weatherMode); setSeg(T, env.state.timeMode); setSeg(G, gfx.choice());
    W.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { env.setWeather(b.dataset.v); setSeg(W, b.dataset.v); } });
    T.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { env.setTime(b.dataset.v); setSeg(T, b.dataset.v); } });
    G.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { gfx.set(b.dataset.v); setSeg(G, b.dataset.v); } });
    const on = { resume: onResume, again: onAgain, map: onMap };
    c.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { c.remove(); on[b.dataset.a](); }));
    return { el: c, close() { c.remove(); } };
  };

  return api;
}

export { formatTime, formatClock };
