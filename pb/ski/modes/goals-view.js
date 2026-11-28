/* Goals and badges on screen (28 Nov 2026, DOM only; plain Luxembourgish): the small badge pop when a goal is reached, the goals pane of
 * the map ("Ziler"), the daily challenge card (also on the resort picker). The numbers come from modes/goals.js and modes/daily.js. */
import { dayOf, dailyFor, dailyText, dailyProgress, streakNow } from './daily.js';
import { badgeCount, badgeTotals, goalProgress } from './goals.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const POP_MS = 3600, POP_MAX = 3;
export const SERIE = (n) => `${n} ${n === 1 ? 'Dag' : 'Deeg'}`;

/** A medal as HTML (earned = gold, else grey). */
export const medal = (on) => `<i class="medal${on ? ' on' : ''}" aria-hidden="true"></i>`;

/** The small pop in the corner (never blocks, never takes a click): items = [{ text, sub }], they stack and fade by themselves. */
export function createBadgePop(parent) {
  const box = document.createElement('div');
  box.className = 'badgepop';
  box.id = 'badgePop';
  box.setAttribute('aria-live', 'polite');
  parent.appendChild(box);
  let count = 0;
  return {
    show(items) {
      for (const it of items) {
        const el = document.createElement('div');
        el.className = 'bp';
        el.innerHTML = `${medal(true)}<span><small>${esc(it.sub || 'Neie Badge')}</small><b>${esc(it.text)}</b></span>`;
        box.appendChild(el);
        while (box.childElementCount > POP_MAX) box.firstElementChild.remove();
        count += 1;
        document.documentElement.dataset.skiBadge = String(count);
        document.documentElement.dataset.skiBadgeLast = it.text;
        setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, POP_MS);
      }
    },
    destroy() { box.remove(); },
  };
}

/** The daily challenge card: text, area, status, streak. `areaName(rid)` gives the name of an area. */
export function dailyCardHtml(progress, areaName, day = dayOf()) {
  const ch = dailyFor(day);
  if (!ch) return '';
  const pr = dailyProgress(progress, ch), streak = streakNow(progress, day);
  const bar = ch.type === 'stars' || ch.type === 'combo' ? `<span class="dbar"><i style="width:${Math.round(100 * pr.have / pr.need)}%"></i></span><span class="m">${pr.have} / ${pr.need}${ch.type === 'combo' ? (pr.step ? ' · Lift gefuer' : ' · éischt de Lift') : ''}</span>` : '';
  return `<div class="dailycard${pr.done ? ' done' : ''}" data-daily="${esc(ch.rid)}" data-type="${ch.type}">
    <span class="dk">Dagesfuerderung</span>
    <b class="dt">${esc(dailyText(ch, areaName(ch.rid)))}</b>
    <span class="dm">${pr.done ? '<span class="dok">Gemaach!</span>' : bar}<span class="dstreak" title="Deeg an enger Rei">Serie: ${esc(SERIE(streak))}</span></span>
  </div>`;
}

/** The goals pane of one area: the badge count, the daily card (when it is this area), one bar per goal. */
export function goalsPaneHtml({ progress, rid, areaName, extra = {} }) {
  const rows = goalProgress(progress, rid, extra), count = badgeCount(progress, rid), all = badgeTotals(progress);
  const day = dayOf(), ch = dailyFor(day);
  const fmt = (n) => Math.round(n).toLocaleString('de-LU');
  const row = (r) => `<li class="goal${r.done ? ' done' : ''}" data-goal="${r.id}">${medal(r.done)}<span class="gl">${esc(r.label)}</span><span class="gbar"><i style="width:${Math.round(100 * r.have / r.need)}%"></i></span><span class="gn">${r.id === 'top' || r.id === 'park' ? (r.done ? 'Jo' : 'Nach net') : r.id === 'disc' ? `${Math.round(100 * r.have / r.need)} %` : `${fmt(r.have)} / ${fmt(r.need)}`}</span></li>`;
  return `<h2>Ziler · ${esc(areaName(rid))}</h2>
    <div class="gsum"><b id="gCount">${count.earned} / ${count.total}</b> Badges hei <span class="m">· ${all.earned} / ${all.total} insgesamt</span></div>
    ${ch && ch.rid === rid ? dailyCardHtml(progress, areaName, day) : ch ? `<div class="dailyhint m">Dagesfuerderung haut: ${esc(areaName(ch.rid))}</div>` : ''}
    <ul class="glist" id="goalList">${rows.map(row).join('')}</ul>
    <p class="m how2">Eng Pist zielt, wann s de se eng Kéier gefuer hues (Stär 1). E Badge geet ni verluer.</p>`;
}
