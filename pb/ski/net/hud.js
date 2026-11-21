/* The screens of an online race (DOM only, Gitter look of ui.css, Luxembourgish): the live table next to the clock, a banner for
 * waiting / connecting, the results of a run with the standings, the final standings, and the small pause card (no "again", no piste
 * map: a race is paced for everybody). Names come from the lobby and are only ever set as textContent. */
import { formatTime } from '../progress.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const DIFF_LB = { green: 'Gréng', blue: 'Blo', red: 'Rout', black: 'Schwaarz' };

export function resText(res, status) {
  if (!res) return status === 'gone' ? 'fort' : status === 'away' ? '…?' : '';
  if (res.dnf) return status === 'gone' ? 'fort' : 'net am Zil';
  if (!res.valid) return 'ongëlteg';
  return formatTime(res.ms);
}

export function createMpHud(root) {
  const box = el('div', 'mp-hud');
  const board = el('div', 'mp-board'); board.setAttribute('aria-label', 'Klassement live');
  const banner = el('div', 'mp-banner'); banner.setAttribute('role', 'status'); banner.hidden = true;
  const bar = el('div', 'mp-bar'); bar.hidden = true;
  box.append(board, banner, bar);
  root.appendChild(box);
  let card = null;

  function closeCard() { if (card) { card.remove(); card = null; } }

  return {
    el: box,
    show(v) { box.hidden = !v; },
    banner(text) { banner.hidden = !text; banner.textContent = text || ''; },
    /** rows: [{ name, me, state ('race' | 'done' | 'wait'), text, place, away }] in display order */
    board(title, rows) {
      board.replaceChildren(el('div', 'mp-bt', title), ...rows.map((r, i) => {
        const row = el('div', `mp-row${r.me ? ' me' : ''}${r.away ? ' away' : ''}`);
        row.append(el('span', 'p', String(i + 1)), el('span', 'n', r.name), el('span', 't', r.text || ''));
        return row;
      }));
    },
    /** the bar at the bottom after my own finish: text + buttons [{label, on}] */
    bar(text, buttons = []) {
      bar.hidden = !text;
      if (!text) return;
      bar.replaceChildren(el('span', 'tx', text), ...buttons.map((b) => { const x = el('button', 'btn', b.label); x.type = 'button'; x.addEventListener('click', b.on); return x; }));
    },
    /** results of a run (or the final standings): table = runTable rows, stand = standings rows, foot = text under it */
    results({ title, piste, table, stand, final, foot, me, statusOf }) {
      closeCard();
      card = el('div', 'card mp-card');
      card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', title);
      const h = el('h2', '', title);
      card.append(h);
      if (piste) card.append(el('div', 'mp-sub', `${piste.name} · ${DIFF_LB[piste.diff] || ''} · ${(piste.length / 1000).toFixed(1)} km`));
      if (final && stand.length) {
        const win = el('div', 'time', stand[0].id === me ? 'Gewonnen!' : `${stand[0].name} gewënnt`);
        card.append(win);
      }
      if (table) {
        const t = el('div', 'mp-table');
        t.append(el('span', 'hd', '#'), el('span', 'hd', 'Spiller'), el('span', 'hd r', 'Zäit'), el('span', 'hd r', 'Pkt'));
        for (const r of table) {
          const cls = r.id === me ? ' me' : '';
          t.append(el('span', `c${cls}`, r.place ? String(r.place) : '–'), el('span', `c n${cls}`, r.name), el('span', `c r${cls}`, resText(r.res, statusOf(r.id))), el('span', `c r${cls}`, r.points ? `+${r.points}` : ''));
        }
        card.append(t);
      }
      if (stand && stand.length) {
        card.append(el('h3', '', final ? 'Schlussklassement' : 'Klassement'));
        const t = el('div', 'mp-table');
        t.append(el('span', 'hd', '#'), el('span', 'hd', 'Spiller'), el('span', 'hd r', 'Zäit'), el('span', 'hd r', 'Pkt'));
        stand.forEach((r, i) => {
          const cls = r.id === me ? ' me' : '';
          t.append(el('span', `c${cls}`, String(i + 1)), el('span', `c n${cls}`, r.name + (statusOf(r.id) === 'gone' ? ' (fort)' : '')), el('span', `c r${cls}`, r.finished ? formatTime(r.totalMs) : '–'), el('span', `c r${cls}`, String(r.points)));
        });
        card.append(t);
      }
      const f = el('div', 'mp-foot', foot || '');
      card.append(f);
      root.appendChild(card);
      return { setFoot(text) { f.textContent = text || ''; } };
    },
    closeCard,
    /** pause card: [{label, on, primary}] + extra rows (DOM) */
    pause({ rows = [], buttons }) {
      closeCard();
      card = el('div', 'card mp-card');
      card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Menü');
      card.append(el('h2', '', 'Online-Rennen'), ...rows);
      const acts = el('div', 'acts');
      for (const b of buttons) { const x = el('button', `btn${b.primary ? ' primary' : b.ghost ? ' ghost' : ''}`, b.label); x.type = 'button'; x.dataset.a = b.id || ''; x.addEventListener('click', () => { closeCard(); b.on(); }); acts.append(x); }
      card.append(acts);
      root.appendChild(card);
    },
    get cardOpen() { return !!card; },
  };
}
