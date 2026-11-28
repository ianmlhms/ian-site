/* The resort picker: one card per ski area with a picture the game rendered of it (pb/ski/img, scripts/ski/picker_images.py), its
 * facts (picker-stats.js, generated from the baked data) and the player's own progress there (stars, pistes skied). The resort the
 * player skied last (or the one this page loaded) is the big card. Cards render at once; the pictures load lazily and fade in.
 * DOM order = visual order; every card is a <button class="resort ready" data-id> (flows tap `.resort.ready[data-id=..]`). */
import { RESORTS } from './resort-data.js';
import { PICKER_STATS } from './picker-stats.js';
import { createStore } from './progress.js';

const IMG_VERSION = 3;                    // bump when the pictures are rendered again (sw.js keeps ?v= files cache-first)
const IMG_WIDTHS = [640, 1200];
const IMG_RATIO = [16, 10];

/** Names, flags and regions as the cards show them (Luxembourgish). */
const INFO = Object.freeze({
  killy: { title: 'Espace Killy', places: "Val d'Isère · Tignes", flags: ['🇫🇷'], region: 'Savoie, Frankräich' },
  '3vallees': { title: 'Les 3 Vallées', places: 'Courchevel, Méribel, Val Thorens', flags: ['🇫🇷'], region: 'Savoie, Frankräich' },
  zermatt: { title: 'Zermatt · Cervinia', places: 'Ënnert dem Matterhorn', flags: ['🇨🇭', '🇮🇹'], region: 'Wallis an Aostatal' },
  arlberg: { title: 'Ski Arlberg', places: 'St. Anton, Lech, Zürs, Warth, Sonnenkopf', flags: ['🇦🇹'], region: 'Tirol a Vorarlberg' },
  kronplatz: { title: 'Kronplatz', places: 'Plan de Corones, Bruneck', flags: ['🇮🇹'], region: 'Südtirol' },
  vialattea: { title: 'Via Lattea', places: "Sestriere, Sauze d'Oulx, Sansicario, Cesana, Claviere, Montgenèvre", flags: ['🇮🇹', '🇫🇷'], region: 'Piemont an Hautes-Alpes' },
  livigno: { title: 'Livigno', places: 'Mottolino a Carosello 3000', flags: ['🇮🇹'], region: 'Lombardei' },
  davos: { title: 'Davos Klosters', places: 'Parsenn, Jakobshorn, Rinerhorn, Madrisa', flags: ['🇨🇭'], region: 'Graubünden' },
  laax: { title: 'Laax', places: 'Flims, Laax, Falera, Vorab-Gletscher', flags: ['🇨🇭'], region: 'Graubünden' },
  soelden: { title: 'Sölden', places: 'Gaislachkogl, Giggijoch, Hochsölden, Gletscher', flags: ['🇦🇹'], region: 'Tirol' },
  obertauern: { title: 'Obertauern', places: 'Tauernrunde ronderëm de Pass', flags: ['🇦🇹'], region: 'Salzburger Land' },
});

/* the sources of all resorts (scripts/ski/common.py SOURCE_CREDITS + OSM_CREDIT); each resort's own list: its piste map ⓘ */
const CREDITS = [
  'Gelänn: IGN RGE ALTI® 5 m (© IGN, Licence Ouverte / Etalab 2.0), iwwer de Géoplateforme',
  'Gelänn Schwäiz: swissALTI3D 2 m (© swisstopo, Open Government Data, fräi Notzung mat Quellenugab)',
  "Gelänn Italien: DTM 2005/2008 Lidar 2 m (© Regione Autonoma Valle d'Aosta, CC BY 4.0)",
  'Gelänn Italien: Ripresa aerea ICE 2009-2011 DTM 5 m, Lidar (© Regione Piemonte, CC BY 4.0)',
  'Gelänn Italien: DTM 5 m vun der Regione Lombardia (Open Data, Geoportale Lombardia, CC BY 4.0)',
  'Gelänn: Digitaalt Terrainmodell 2,5 m vun der Autonomer Provënz Bozen - Südtirol (Open Data Südtirol, CC0 1.0)',
  'Gelänn: ALS-DTM Éisträich 1 m (Datenquell: BEV - Bundesamt für Eich- und Vermessungswesen, aus de Laserscans vun de Bundesländer, CC BY 4.0)',
  'Bierger an der Distanz: Copernicus DEM GLO-30 (© DLR e.V. 2010-2014 an © Airbus Defence and Space GmbH 2014-2018, ënnert COPERNICUS vun der EU an der ESA)',
  'Pisten, Liften, Haiser, Bësch: © OpenStreetMap-Mataarbechter (ODbL 1.0)',
  'Biller vun de Skigebidder: am Spill selwer gemoolt, keng Fotoen a kee Satellittebild.',
];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const imgUrl = (rid, width) => new URL(`./img/${rid}-${width}.webp?v=${IMG_VERSION}`, import.meta.url).href;
/* the cards' headline count in Luxembourgish (a resort more = no text to touch) */
const COUNT_LB = ['Null', 'Een', 'Zwee', 'Dräi', 'Véier', 'Fënnef', 'Sechs', 'Siwen', 'Aacht', 'Néng', 'Zéng'];
const countWord = (n) => COUNT_LB[n] || String(n);
const bits = (n) => { let c = 0; for (let v = n; v; v &= v - 1) c += 1; return c; };

/** Stars and pistes skied per resort, read from the save (never written here). */
function progressOf(progress, rid) {
  const prefix = `${rid}/`;
  const own = (obj) => Object.keys(obj || {}).filter((k) => k.startsWith(prefix));
  const stars = own(progress.stars).reduce((sum, k) => sum + bits(progress.stars[k]), 0);
  const skied = new Set([...own(progress.best), ...own(progress.runs)]).size;
  return { stars, skied };
}

function readProgress() {
  try { return createStore().get(); } catch (error) { console.warn('[ski] picker: save unreadable', error); return null; }
}

function picture(rid, sizes) {
  const [w, h] = IMG_RATIO;
  const srcset = IMG_WIDTHS.map((x) => `${imgUrl(rid, x)} ${x}w`).join(', ');
  return `<span class="rp-pic" aria-hidden="true"><img alt="" width="${w * 40}" height="${h * 40}" loading="lazy" decoding="async" fetchpriority="low" sizes="${sizes}" data-srcset="${srcset}" data-src="${imgUrl(rid, IMG_WIDTHS[0])}"></span>`;
}

function progressLine(p) {
  const parts = [];
  if (p.stars) parts.push(`<span class="rp-stars">★ ${p.stars} ${p.stars === 1 ? 'Stär' : 'Stären'}</span>`);
  if (p.skied) parts.push(`<span>${p.skied} ${p.skied === 1 ? 'Pist' : 'Pisten'} gefuer</span>`);
  if (!parts.length) return '';
  return `<span class="rp-prog">${parts.join('')}</span>`;
}

function card(r, { isHero, isCurrent, kicker, progress }) {
  const info = INFO[r.id] || { title: r.name, places: r.short, flags: [], region: '' };
  const s = PICKER_STATS[r.id];
  const p = progress ? progressOf(progress, r.id) : { stars: 0, skied: 0 };
  const flags = info.flags.length ? `<span class="rp-flag">${info.flags.join(' ')}</span>` : '';
  const action = isCurrent ? 'Lass fueren' : 'Lueden';
  const label = `${info.title}, ${info.places}${s ? `: ${s.km} km Pisten, ${s.lifts} Liften, bis ${s.top} m` : ''}${p.stars ? `, ${p.stars} Stären` : ''}. ${action}`;
  if (!r.ready) {
    return `<button type="button" class="resort soon rp-card" data-id="${r.id}" disabled aria-disabled="true">${picture(r.id, '25vw')}
      <span class="rp-body"><span class="rp-name"><b>${esc(info.title)}</b>${flags}</span><span class="rp-places">Kënnt an enger nächster Versioun.</span></span></button>`;
  }
  const facts = s ? (isHero
    ? `<span class="rp-stats"><span><b>${s.km}<i> km</i></b><small>Pisten</small></span><span><b>${s.lifts}</b><small>Liften</small></span><span><b>${s.top}<i> m</i></b><small>héchste Punkt</small></span></span>`
    : `<span class="rp-facts"><span>${s.km}&nbsp;km</span><span>${s.lifts}&nbsp;Liften</span><span>${s.top}&nbsp;m</span></span>`) : '';
  const sizes = isHero ? '(min-width: 900px) 50vw, 100vw' : '(min-width: 900px) 25vw, (min-width: 600px) 50vw, 140px';
  return `<button type="button" class="resort ready rp-card${isHero ? ' rp-hero' : ''}" data-id="${r.id}" aria-label="${esc(label)}">
    ${picture(r.id, sizes)}
    <span class="rp-body">
      ${isHero && kicker ? `<span class="rp-kicker">${esc(kicker)}</span>` : ''}
      <span class="rp-name"><b>${esc(info.title)}</b>${flags}${!isHero && p.stars ? `<span class="rp-stars" title="Stären">★ ${p.stars}</span>` : ''}</span>
      <span class="rp-places">${esc(info.places)}${isHero && info.region ? `<span class="rp-region">${esc(info.region)}</span>` : ''}</span>
      ${facts}
      ${isHero ? progressLine(p) : ''}
      ${isHero ? `<span class="rp-sp"></span><span class="btn primary big rp-go">${action}<i aria-hidden="true">→</i></span>` : `<span class="rp-arrow" aria-hidden="true">→</span>`}
    </span>
  </button>`;
}

/** Starts the pictures once the cards are on screen (lazy: the browser fetches only what is visible, at low priority). */
function loadPictures(root) {
  root.querySelectorAll('.rp-pic img').forEach((img) => {
    const done = () => img.classList.add('ok');
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', () => { img.classList.add('failed'); console.warn('[ski] picker picture missing', img.dataset.src); }, { once: true });
    img.srcset = img.dataset.srcset;
    img.src = img.dataset.src;
    if (img.complete && img.naturalWidth) done();
  });
}

function showCredits(screen) {
  if (screen.querySelector('#creditsCard')) return;
  const c = el(`<div class="card" id="creditsCard" role="dialog" aria-modal="true" aria-label="Quellen"><h2>Quellen</h2>
    <div class="credits">${CREDITS.map((t) => `<p>${esc(t)}</p>`).join('')}</div>
    <div class="acts"><button type="button" class="btn primary" data-a="ok">OK</button></div></div>`);
  const close = () => { c.remove(); screen.querySelector('#skiCredits')?.focus(); };
  c.querySelector('[data-a="ok"]').addEventListener('click', close);
  c.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  screen.appendChild(c);
  c.querySelector('[data-a="ok"]').focus();
}

/**
 * The picker screen in `root`. onPick(id) on a tap; onOnline opens the lobby (null: no button).
 * Returns { el, close() } like the other screens.
 */
export function showResorts(root, { onPick, current = null, onOnline = null, music = null }) {
  const progress = readProgress();
  const last = progress && progress.last && progress.last.resort;
  const heroId = RESORTS.some((r) => r.id === current && r.ready) ? current : (RESORTS.find((r) => r.ready) || RESORTS[0]).id;
  const ordered = [...RESORTS.filter((r) => r.id === heroId), ...RESORTS.filter((r) => r.id !== heroId)];
  const kicker = last === heroId ? 'Zulescht gefuer' : 'Fir unzefänken';
  const small = ordered.length - 1;          // the small cards: landscape = 2 rows of ceil(small / 2), an odd last card spans both rows
  const s = el(`<section class="screen rp" id="resortScreen" aria-label="Skigebitt wielen">
    <div class="rp-scroll">
      <div class="rp-head">
        <div class="rp-title"><h1>Wiel e Skigebitt</h1><p>${countWord(RESORTS.filter((r) => r.ready).length)} richteg Skigebidder an 3D. Fuer fräi, mat de richtege Liften erop, an d'Challengen um Bierg.</p></div>
        <div class="rp-acts">
          ${onOnline ? '<button type="button" class="btn" id="skiOnline">👥 Online-Rennen</button>' : ''}
          ${music ? '<button type="button" class="btn ghost" id="skiMusic" aria-pressed="false"></button>' : ''}
          <button type="button" class="btn ghost" id="skiCredits" aria-label="Quellen">ⓘ<span class="rp-hide-s"> Quellen</span></button>
        </div>
      </div>
      <div class="resorts rp-grid${small % 2 ? ' rp-odd' : ''}${small >= 9 ? ' rp-dense' : ''}" style="--rp-cols:${Math.max(2, Math.ceil(small / 2))};--rp-rows:${Math.max(2, Math.ceil(small / 2))}">${ordered.map((r) => card(r, { isHero: r.id === heroId, isCurrent: r.id === current, kicker, progress })).join('')}</div>
    </div>
  </section>`);
  s.querySelectorAll('.resort.ready').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.id)));
  if (onOnline) s.querySelector('#skiOnline').addEventListener('click', onOnline);
  if (music) {
    const mb = s.querySelector('#skiMusic');
    const paint = () => { const on = music.on(); mb.textContent = on ? '♪ Musek un' : '♪ Musek aus'; mb.setAttribute('aria-pressed', String(on)); };
    mb.addEventListener('click', () => { music.set(!music.on()); paint(); });
    paint();
  }
  s.querySelector('#skiCredits').addEventListener('click', () => showCredits(s));
  root.appendChild(s);
  loadPictures(s);
  return { el: s, close() { s.remove(); } };
}
