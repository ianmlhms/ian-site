/* The mode screens (round 4A, DOM only; plain Luxembourgish): the mode tabs on the piste map (Pisten / Snowpark / Fräi fueren), the
 * stars and the lock of the picked piste, the park card, the lift list and card of the free ride, the stars on the finish card, the
 * park finish card. main.js owns the game; this only draws and calls back. */
import { formatTime } from '../progress.js';
import { STAR, specialText, starCount } from './challenges.js';
import { formatHour, kindName } from './freeride.js';
import { QUALITY_LABEL } from './park.js';
import { SKI_TYPES, BAR_LABEL, skiUnlock, unlockText } from './skis.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
// round 6: free ride is the main game (first tab); the piste list is the challenge list; the ski types have their own tab
export const MODE_TABS = Object.freeze([['freeride', 'Fräi fueren'], ['piste', 'Challengen'], ['park', 'Snowpark'], ['skis', 'Skier']]);
const fmtPts = (n) => Math.round(n).toLocaleString('de-LU');

/** ★★☆ as HTML (won stars gold, the others grey). */
/** R8b: a lift's name in the list: a bare number ("3000", Tignes) gets its kind in front, so it never reads as part of the height. */
const listName = (l) => (/^\d[\d\s.]*$/.test(l.name) ? `${kindName(l.kind)} ${l.name}` : l.name);

export function starRow(mask, size = '') {
  return `<span class="stars ${size}" aria-label="${starCount(mask)} vun 3 Stären">${[STAR.finish, STAR.time, STAR.special].map((b) => `<i class="${mask & b ? 'on' : ''}">★</i>`).join('')}</span>`;
}

/** What the three stars of a piste ask for. */
export function starGoals(c, mask) {
  const rows = [['Ukommen', STAR.finish], [`Ënner ${formatTime(c.targetMs).replace(/(\.\d)\d+$/, '$1')}`, STAR.time], [specialText(c), STAR.special]];
  return `<ul class="goals">${rows.map(([t, b]) => `<li class="${mask & b ? 'on' : ''}"><i>★</i>${esc(t)}</li>`).join('')}</ul>`;
}

/** Mode tabs + the park / free ride panes inside the piste map screen. Returns the controller. */
export function attachModePanel(mapEl, { onMode, onParkStart, onFreeStart, onPickLift }) {
  const side = mapEl.querySelector('.side');
  const pick = mapEl.querySelector('.pick');
  const tabs = el(`<div class="seg modetabs" role="tablist">${MODE_TABS.map(([id, label]) => `<button type="button" role="tab" data-mode="${id}">${label}</button>`).join('')}</div>`);
  side.insertBefore(tabs, side.firstChild);
  const starsBox = el('<div class="pkstars" id="pkStars"></div>');
  pick.insertBefore(starsBox, pick.querySelector('.bestline'));
  const pane = el('<div class="modepane" id="modePane" hidden></div>');
  pick.insertBefore(pane, pick.firstChild);
  const list = el('<div class="list modelist" id="modeList" hidden></div>');
  side.insertBefore(list, pick);
  let mode = 'piste';
  const setMode = (m) => {
    mode = m;
    mapEl.dataset.mode = m;
    tabs.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.mode === m); b.setAttribute('aria-selected', b.dataset.mode === m ? 'true' : 'false'); });
    pane.hidden = m === 'piste';
    list.hidden = m !== 'freeride';
  };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.mode !== mode) { setMode(b.dataset.mode); onMode(b.dataset.mode); } });
  setMode('piste');
  return {
    get mode() { return mode; },
    setMode,
    /** Stars, goals and the lock of the picked piste. */
    showPiste({ challenge, mask, lock, resortStars }) {
      const goals = challenge ? starGoals(challenge, mask) : '';
      const lockLine = lock && !lock.open ? `<div class="lock">🔒 Gespaart: ${lock.need} ★ an dësem Skigebitt maachen se op (du hues ${lock.have}).</div>` : '';
      starsBox.innerHTML = `<div class="starline">${starRow(mask)}<span class="m">${resortStars} ★ hei</span></div>${goals}${lockLine}`;
    },
    /** The park pane. */
    showPark({ layout, best, ready }) {
      if (!layout) { pane.innerHTML = '<p class="m">Dëst Skigebitt huet nach kee Snowpark.</p>'; return; }
      const k = layout.kickers.map((x) => x.size).join(' ');
      pane.innerHTML = `<h2><span class="chip park"></span>${esc(layout.name)}</h2>
        <div class="facts">${Math.round(layout.len)} m · Sprongschanzen ${k} · ${layout.rails.filter((r) => r.kind === 'rail').length} Rails · ${layout.rails.filter((r) => r.kind === 'box').length} Boxen${layout.pipe ? ' · Halfpipe' : ''}</div>
        <div class="bestline">${best ? `Bescht Punkten: <b>${fmtPts(best)}</b>` : 'Nach keng Punkten hei.'}</div>
        <div class="how">An der Luucht: <b>steieren</b> = dréinen (180 bis 1080), <b>Trick</b> halen = Grab, Trick + <b>erop / erof</b> = Flip (grouss Schanzen). Op Rails a Boxen rutschen; steieren = quer. Propper landen fir Kombo-Punkten.</div>
        <div class="status" id="parkStatus">${ready ? 'Prett.' : 'Park gëtt gelueden …'}</div>
        <button type="button" class="btn primary big" id="parkStart" ${ready ? '' : 'disabled'}>Start Snowpark</button>`;
      pane.querySelector('#parkStart').addEventListener('click', (e) => { if (!e.currentTarget.disabled) onParkStart(); });
    },
    parkReady(ready) { const b = pane.querySelector('#parkStart'); if (b) { b.disabled = !ready; pane.querySelector('#parkStatus').textContent = ready ? 'Prett.' : 'Park gëtt gelueden …'; } },
    /** The free ride pane and the lift list. */
    showFree({ lifts, selected, ready }) {
      if (!list.childElementCount) {
        const sorted = [...lifts.list].sort((a, b) => b.top.y - a.top.y);
        list.innerHTML = `<div class="grp">Bei e Lift (${sorted.length})</div>${sorted.map((l) => `<button type="button" class="prow lrow" data-lift="${l.id}"><span class="chip lift"></span><span class="n">${esc(listName(l))}</span><span class="m" title="uewen">↑ ${Math.round(l.top.y)} m</span></button>`).join('')}`;
        list.addEventListener('click', (e) => { const b = e.target.closest('[data-lift]'); if (b) onPickLift(lifts.byId.get(b.dataset.lift)); });
      }
      // R8b: the picked lift's row in view (scrolled inside the list only, after the layout: scrollIntoView ran before it and scrolled nothing)
      list.querySelectorAll('.lrow').forEach((b) => {
        const on = !!selected && b.dataset.lift === selected.id;
        b.classList.toggle('sel', on);
        if (on) requestAnimationFrame(() => { const top = b.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop; if (top < list.scrollTop || top + b.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, top - (list.clientHeight - b.offsetHeight) / 2); });
      });
      pane.innerHTML = `<h2><span class="chip lift"></span>${selected ? esc(selected.name) : 'Fräi fueren'}</h2>
        <div class="facts">${selected ? `${kindName(selected.kind, selected.sub)} · ënnen ${Math.round(selected.bottom.y)} m · uewen ${Math.round(selected.top.y)} m · ${Math.round(selected.len)} m laang` : 'Tipp op e Lift op der Kaart oder an der Lëscht.'}</div>
        <div class="how">Keng Auer: fuer vu Pist zu Pist an och nieft de Pisten. Ënnen um Lift: <b>Astegen</b> (L / Enter). Op der Pist: e Startpaart = eng Challenge.</div>
        <div class="status" id="freeStatus">${selected ? (ready ? 'Prett.' : 'Gëtt gelueden …') : ''}</div>
        <button type="button" class="btn primary big" id="freeStart" ${selected && ready ? '' : 'disabled'}>Bei de Lift</button>`;
      pane.querySelector('#freeStart').addEventListener('click', (e) => { if (!e.currentTarget.disabled) onFreeStart(); });
    },
    /** Round 6: the ski types (the Skier tab). */
    showSkis(opts) {
      pane.innerHTML = `<h2>Skier</h2>${skiCardsHtml(opts)}`;
      bindSkiCards(pane, opts);
    },
    freeReady(ready) { const b = pane.querySelector('#freeStart'); const st = pane.querySelector('#freeStatus'); if (b && st && st.textContent) { b.disabled = !ready; st.textContent = ready ? 'Prett.' : 'Gëtt gelueden …'; } },
  };
}

/** Extra HTML for the finish card of a timed run: the stars of this run, the new ones, what is left. */
export function finishStarsHtml({ challenge, runMask, totalMask, gained, unlocked }) {
  if (!challenge) return '';
  const lines = [];
  if (gained) lines.push(`<div class="new">${starCount(gained) === 1 ? 'Neie Stär!' : `${starCount(gained)} nei Stären!`}</div>`);
  for (const u of unlocked || []) lines.push(`<div class="new">Op: ${esc(u)}</div>`);
  return `<div class="finstars">${starRow(totalMask, 'big')}${lines.join('')}${starGoals(challenge, runMask)}</div>`;
}

/** The park finish card: points, best, the best tricks; again / map. */
export function showParkFinish(root, { name, points, best, improved, tricks, assisted, onAgain, onMap, onFree = null }) {
  const top = [...tricks].sort((a, b) => b.points - a.points).slice(0, 5);
  const c = el(`<div class="card" id="finishCard" role="dialog" aria-label="Snowpark Resultat">
    <h2><span class="chip park"></span>${esc(name)}</h2>
    <div class="time">${fmtPts(points)} <small>Punkten</small></div>
    ${improved && !assisted ? '<div class="new">Neie Rekord!</div>' : ''}
    ${assisted ? '<div class="warn">Automatesch gefuer: dës Punkten zielen net.</div>' : ''}
    <div class="rows"><span>Bescht</span><span>${best ? fmtPts(best) : '–'}</span><span>Tricks</span><span>${tricks.length}</span></div>
    ${top.length ? `<ol class="tricks">${top.map((t) => `<li><b>${esc(t.name)}</b> <span>${QUALITY_LABEL[t.quality]}</span> <span class="m">+${fmtPts(t.points)}${t.combo > 1 ? ` (x${t.combo})` : ''}</span></li>`).join('')}</ol>` : '<p class="m">Keen Trick gelant. Probéier eng Schanz!</p>'}
    <div class="acts">${onFree ? '<button type="button" class="btn primary" data-a="free">Weider fräi fueren</button>' : ''}<button type="button" class="btn${onFree ? '' : ' primary'}" data-a="again">Nach eng Kéier</button><button type="button" class="btn ghost" data-a="map">Pistekaart</button></div>
  </div>`);
  root.appendChild(c);
  const on = { again: onAgain, map: onMap, free: onFree };
  c.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { c.remove(); on[b.dataset.a](); }));
  return { el: c, close() { c.remove(); } };
}

/** The free ride HUD block (under the piste name): the day clock, distance, vertical, lifts; and the lift button. */
export function createFreeHud(hudEl, { onLift, onSkis = null }) {
  const box = el('<div class="freehud" id="freeHud" hidden><div class="day" id="fDay"></div><div class="fstats" id="fStats"></div></div>');
  hudEl.querySelector('.tl').appendChild(box);
  const lift = el('<button type="button" class="liftbtn" id="liftBtn" hidden>⬆ <span></span></button>');
  hudEl.appendChild(lift);
  lift.addEventListener('click', (e) => { e.currentTarget.blur(); onLift(); });
  // round 6: at a lift station the skis can be changed (a small card)
  const skiBtn = el('<button type="button" class="skibtn" id="skiSwap" hidden aria-label="Ski wiesselen">🎿 Ski</button>');
  hudEl.appendChild(skiBtn);
  skiBtn.addEventListener('click', (e) => { e.currentTarget.blur(); if (onSkis) onSkis(); });
  return {
    show(v) { box.hidden = !v; if (!v) lift.hidden = true; },
    set({ hour, stats, fixedTime }) {
      box.querySelector('#fDay').textContent = `${fixedTime ? '' : '🕘 '}${formatHour(hour)}`;
      box.querySelector('#fStats').textContent = `${(stats.distance / 1000).toFixed(1)} km · ↓ ${Math.round(stats.vertical)} m · ${stats.lifts} Lift${stats.lifts === 1 ? '' : 'en'}`;
    },
    lift(liftObj) { lift.hidden = !liftObj; if (liftObj) lift.querySelector('span').textContent = `Astegen: ${liftObj.name}`; skiBtn.hidden = !liftObj; },
  };
}

/** The park HUD line: points and the open combo. */
export const parkHudText = (judge) => `${fmtPts(judge.score)} Punkten${judge.combo > 1 ? ` · Kombo x${judge.combo}` : ''}`;
export const trickToast = (ev) => `${ev.name} · ${QUALITY_LABEL[ev.quality]} +${fmtPts(ev.points)}${ev.combo > 1 ? ` (x${ev.combo})` : ''}`;

/* ---------------- round 6 ---------------- */
const dots = (n) => `${'●'.repeat(n)}${'○'.repeat(5 - n)}`;
/** A ski drawn in CSS: the base colour, its pattern, the tips (twin: both ends), its width / length. */
export function skiDrawing(look) {
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const a = hex(look.art);
  const pat = {
    stripe: `linear-gradient(${a}, ${a}) 10% 50% / 62% 22% no-repeat`,
    chevron: `repeating-linear-gradient(60deg, transparent 0 9px, ${a} 9px 13px)`,
    race: `linear-gradient(${a}, ${a}) 0 22% / 100% 16% no-repeat, linear-gradient(${a}, ${a}) 0 78% / 100% 16% no-repeat`,
    dots: `radial-gradient(circle, ${a} 30%, transparent 34%) 0 0 / 14px 100%`,
    zigzag: `repeating-linear-gradient(-55deg, transparent 0 8px, ${a} 8px 12px)`,
  }[look.pattern] || 'none';
  return `<span class="skidraw${look.twin ? ' twin' : ''}" style="--base:${hex(look.base)};--tip:${hex(look.tip)};--len:${Math.round(look.length * 88)}%;--wid:${Math.round(10 * look.width)}px"><i style="background:${pat}, var(--base)"></i></span>`;
}
/** The ski cards: drawing, name, handling, the unlock (with progress) and the pick button. opts = { stats, selected } */
export function skiCardsHtml({ stats, selected }) {
  return `<p class="m fairnote">Zäitleef (Challengen, Bestenlëschten), Snowpark-Punkten an Online-Rennen: all Ski fuere gläich (All-Mountain), fir datt et fair bleift. Beim fräie Fueren mécht de Ski den Ënnerscheed.</p>
  <div class="skis">${SKI_TYPES.map((t) => {
    const u = skiUnlock(t, stats);
    const on = t.id === selected;
    const need = u.parts.map((p) => `<span class="${p.done ? 'ok' : ''}">${esc(p.label)}: ${p.have} / ${p.need} ${esc(p.unit)}</span>`).join('');
    return `<div class="skicard${on ? ' sel' : ''}${u.open ? '' : ' locked'}" data-ski="${t.id}">
      ${skiDrawing(t.look)}
      <div class="sk"><b>${esc(t.name)}</b> <span class="m">${esc(t.short)}</span></div>
      <div class="sktext">${esc(t.text)}</div>
      <div class="bars">${Object.entries(t.bars).map(([k, v]) => `<span>${BAR_LABEL[k]} <i>${dots(v)}</i></span>`).join('')}</div>
      ${u.open ? `<button type="button" class="btn${on ? ' primary' : ''}" data-pick="${t.id}" ${on ? 'disabled' : ''}>${on ? 'Gewielt' : 'Wielen'}</button>` : `<div class="lock">🔒 ${esc(unlockText(t))}</div><div class="need">${need}</div>`}
    </div>`;
  }).join('')}</div>`;
}
export function bindSkiCards(root, { onPick }) {
  root.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => { if (!b.disabled) onPick(b.dataset.pick); }));
}
/** The ski card at a lift station (an overlay; picking closes it). */
export function showSkiCard(root, opts) {
  const c = el(`<div class="card skicardbox" id="skiCard" role="dialog" aria-label="Ski wielen"><h2>Ski wielen</h2>${skiCardsHtml(opts)}<div class="acts"><button type="button" class="btn ghost" data-a="close">Zou</button></div></div>`);
  root.appendChild(c);
  const close = () => { c.remove(); if (opts.onClose) opts.onClose(); };
  bindSkiCards(c, { onPick: (id) => { opts.onPick(id); close(); } });
  c.querySelector('[data-a="close"]').addEventListener('click', close);
  return { el: c, close };
}

/** The lift ride panel: the lift, time to the top, Iwwersprangen and the view toggle. */
export function createRideHud(hudEl, { onSkip, onView }) {
  const box = el(`<div class="ridehud" id="rideHud" hidden><div class="rl"><b id="rName"></b><span class="m" id="rLeft"></span></div>
    <div class="rbar"><i id="rBar"></i></div>
    <div class="rb"><button type="button" class="btn" id="rView" aria-label="Vue wiesselen (V)">👁 Vue</button><button type="button" class="btn primary" id="rSkip" aria-label="Iwwersprangen (Enter)">⏭ Iwwersprangen</button></div></div>`);
  hudEl.appendChild(box);
  box.querySelector('#rSkip').addEventListener('click', (e) => { e.currentTarget.blur(); onSkip(); });
  box.querySelector('#rView').addEventListener('click', (e) => { e.currentTarget.blur(); onView(); });
  return {
    show(lift) { box.hidden = !lift; if (lift) box.querySelector('#rName').textContent = `${kindName(lift.kind, lift.sub)} ${lift.name}`; },
    set({ left, share, view }) {
      const m = Math.floor(left / 60), sec = Math.ceil(left % 60);
      box.querySelector('#rLeft').textContent = left > 0.5 ? `nach ${m ? `${m} min ` : ''}${sec} s bis uewen · ${view === 'window' ? 'Fënster' : 'Vu baussen'}` : 'Uewen!';
      box.querySelector('#rBar').style.transform = `scaleX(${Math.max(0, Math.min(1, share)).toFixed(3)})`;
    },
  };
}

/** The challenge prompt when the skier rides into a start gate (not blocking: it goes away when he skis on). */
export function createChallengePrompt(hudEl, { onStart, onNo }) {
  const box = el(`<div class="chprompt" id="chPrompt" hidden role="dialog" aria-label="Challenge"><div class="t" id="chText"></div><div class="g m" id="chGoal"></div>
    <div class="acts"><button type="button" class="btn primary" id="chStart">Start (Enter)</button><button type="button" class="btn ghost" id="chNo">Nee</button></div></div>`);
  hudEl.appendChild(box);
  let current = null;
  box.querySelector('#chStart').addEventListener('click', (e) => { e.currentTarget.blur(); if (current) onStart(current); });
  box.querySelector('#chNo').addEventListener('click', (e) => { e.currentTarget.blur(); if (current) onNo(current); });
  return {
    get current() { return current; },
    show(marker, { mask = 0, goal = '' } = {}) {
      current = marker;
      box.hidden = !marker;
      if (!marker) return;
      box.querySelector('#chText').innerHTML = marker.park ? `Snowpark: <b>${esc(marker.name)}</b> → Start?` : `Challenge: <b>${esc(marker.name)}</b> ${starRow(mask)} → Start?`;
      box.querySelector('#chGoal').textContent = goal;
    },
  };
}
