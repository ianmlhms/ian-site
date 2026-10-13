/* Lokféierer: start screen / garage / upgrades. Pure DOM, no framework.
   TS.menu.render(container, { save, lang, onStart(mode, routeId, trainId), onBuy(kind, id, extra), onSelect(trainId), onCareer(careerId), onLang(lang), onEnv(kind 'weather'|'tod', id), env: { weather, tod } })
   kind of onBuy: 'train' | 'route' | 'upgrade' (id = upgrade kind, extra = trainId).
   Callbacks may return the new save; otherwise call TS.menu.update({ save }) after persisting.
   Styles are injected once as <style id="ts-menu-style"> and scoped under .ts-menu. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const C = TS.config;
  const K = TS.career;
  const STYLE_ID = 'ts-menu-style';

  /* ---------------------------------------------------------------- style */
  const CSS = `
.ts-menu{--bg:#0d1a22;--bg2:#17303b;--card:rgba(255,255,255,.065);--card2:rgba(255,255,255,.1);--line:rgba(255,255,255,.14);--ink:#eef4f1;--soft:#a3b7bf;--gold:#ffbc42;--gold2:#ffd27a;--green:#4fd18b;--red:#ff6b5e;--blue:#5aa9ff;
  position:relative;box-sizing:border-box;width:100%;height:100%;overflow-y:auto;overflow-x:hidden;color:var(--ink);font-family:ui-rounded,"SF Pro Rounded",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;
  background:radial-gradient(1200px 500px at 15% -10%,#2b5a6b66,transparent 70%),radial-gradient(900px 500px at 100% 10%,#6b3b2c40,transparent 70%),linear-gradient(180deg,var(--bg2),var(--bg) 60%);scroll-behavior:smooth}
.ts-menu *,.ts-menu *::before,.ts-menu *::after{box-sizing:border-box}
.ts-menu button{font:inherit;color:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.ts-menu button:disabled{cursor:not-allowed}
.ts-menu :focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.ts-menu__inner{max-width:1120px;margin:0 auto;padding:22px 28px 56px;display:flex;flex-direction:column;gap:22px}
.ts-menu h1,.ts-menu h2,.ts-menu h3,.ts-menu p{margin:0}
.ts-menu__top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.ts-menu__stamp{font-size:12px;font-weight:850;letter-spacing:.14em;padding:7px 12px;border:2px solid var(--gold);color:var(--gold);border-radius:8px;transform:rotate(-1.5deg);text-transform:uppercase;background:rgba(255,188,66,.07)}
.ts-menu__langs{display:flex;gap:6px}
.ts-menu__topR{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.ts-menu__hints{min-height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--card);font-weight:750;font-size:13px}
.ts-menu__hints[aria-pressed="true"]{background:rgba(79,209,139,.18);border-color:var(--green);color:var(--green)}
.ts-menu__langs button{min-width:46px;min-height:40px;padding:0 12px;border-radius:12px;border:1px solid var(--line);background:var(--card);font-weight:750;font-size:13px;letter-spacing:.04em}
.ts-menu__langs button[aria-pressed="true"]{background:var(--gold);border-color:var(--gold);color:#2a2112}
.ts-menu__hero{display:grid;grid-template-columns:1.35fr 1fr;gap:22px;align-items:stretch}
.ts-menu__titlebox{position:relative;border:1px solid var(--line);border-radius:26px;padding:26px 28px 20px;background:linear-gradient(135deg,rgba(255,255,255,.1),rgba(255,255,255,.03));overflow:hidden;min-height:300px;display:flex;flex-direction:column;justify-content:space-between}
.ts-menu__eyebrow{font-size:12px;font-weight:800;letter-spacing:.2em;color:var(--gold);text-transform:uppercase}
.ts-menu__title span{display:block}.ts-menu__title2{font-size:.46em;line-height:1.2;letter-spacing:.02em;margin-top:.08em;font-weight:800}
.ts-menu__title{font-size:clamp(42px,5.6vw,72px);line-height:.95;font-weight:900;letter-spacing:-.025em;margin-top:6px;padding-bottom:.08em;background:linear-gradient(180deg,#fff,#cfe0e6);-webkit-background-clip:text;background-clip:text;color:transparent}
.ts-menu__tag{color:var(--soft);font-size:15px;margin-top:8px;max-width:30ch}
.ts-menu__title+.ts-menu__tag{margin-top:14px}
.ts-menu__heroTrain{position:absolute;right:14px;bottom:6px;width:min(72%,580px);pointer-events:none;opacity:.96}
.ts-menu__heroTrain.anim{animation:tsm-roll .9s cubic-bezier(.2,.8,.2,1) both}
.ts-menu__heroTrain svg{display:block;width:100%;height:auto;filter:drop-shadow(0 8px 14px rgba(0,0,0,.45))}
.ts-menu__rails{position:absolute;left:0;right:0;bottom:0;height:16px;background:repeating-linear-gradient(90deg,#3b2f26 0 12px,transparent 12px 30px),linear-gradient(#6b7780,#6b7780) 0 3px/100% 3px no-repeat;opacity:.55}
@keyframes tsm-roll{from{transform:translateX(60px);opacity:0}to{transform:none;opacity:.96}}
.ts-menu__player{border:1px solid var(--line);border-radius:26px;padding:22px 24px;background:var(--card);display:flex;flex-direction:column;gap:12px;justify-content:center}
.ts-menu__rank{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--soft);font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.ts-menu__rankName{font-size:26px;font-weight:850;color:var(--ink);letter-spacing:0;text-transform:none}
.ts-menu__badge{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;font-size:24px;background:linear-gradient(135deg,var(--gold),#e8862f);color:#2a1a08;box-shadow:0 6px 18px rgba(255,160,40,.3);flex:none}
.ts-menu__bar{height:8px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}
.ts-menu__bar>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--green),var(--gold))}
.ts-menu__small{font-size:12px;color:var(--soft)}
.ts-menu__wallet{font-size:40px;font-weight:900;letter-spacing:-.02em;color:var(--gold2);font-variant-numeric:tabular-nums;line-height:1}
.ts-menu__walletRow{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}
.ts-menu__modes{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.ts-menu__mode{position:relative;text-align:left;border:1px solid var(--line);border-radius:22px;padding:22px 24px 20px 24px;background:var(--card);min-height:122px;display:flex;flex-direction:column;gap:6px;transition:transform .15s,background .15s,border-color .15s}
.ts-menu__mode b{font-size:26px;font-weight:850;letter-spacing:-.01em}
.ts-menu__mode small{font-size:13px;color:var(--soft);line-height:1.45;max-width:36ch}
.ts-menu__mode .go{position:absolute;right:20px;top:18px;width:46px;height:46px;border-radius:50%;display:grid;place-items:center;font-size:22px;background:rgba(255,255,255,.12)}
.ts-menu__mode .sub{margin-top:auto;font-size:13px;font-weight:750;color:var(--gold2)}
.ts-menu__mode--career{background:linear-gradient(135deg,#ffbc42,#f19a2c);color:#2a1a08;border-color:#ffd27a;box-shadow:0 14px 34px rgba(255,170,50,.28)}
.ts-menu__mode--career small{color:#4a3511}.ts-menu__mode--career .go{background:rgba(42,26,8,.16)}.ts-menu__mode--career .sub{color:#2a1a08}
.ts-menu__mode--endless{background:linear-gradient(135deg,rgba(90,169,255,.28),rgba(90,169,255,.08));border-color:rgba(90,169,255,.5)}
.ts-menu__mode:not(:disabled):hover,.ts-menu__mode:not(:disabled):focus-visible{transform:translateY(-2px)}
.ts-menu__mode:disabled{opacity:.55;filter:saturate(.5)}
.ts-menu__order{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--soft);margin-top:-6px}
.ts-menu__order span.chip{padding:3px 9px;border-radius:99px;background:var(--card);border:1px solid var(--line);color:var(--ink);font-weight:650}
.ts-menu__env{border:1px solid var(--line);border-radius:22px;padding:16px 20px;background:var(--card);display:flex;flex-direction:column;gap:12px}
.ts-menu__envRow{display:grid;grid-template-columns:130px 1fr;gap:10px 14px;align-items:center}
.ts-menu__envLbl{font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--soft)}
.ts-menu__envOpts{display:flex;gap:8px;flex-wrap:wrap}
.ts-menu__envOpt{min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.06);font-weight:750;font-size:14px;display:inline-flex;align-items:center;gap:7px}
.ts-menu__envOpt:hover{background:var(--card2)}
.ts-menu__envOpt[aria-checked="true"]{background:var(--gold);border-color:var(--gold);color:#2a2112}
.ts-menu__env .ts-menu__small{margin-top:-2px}
.ts-menu__careers{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ts-menu__career{display:flex;align-items:center;gap:14px;text-align:left;padding:14px 18px;border-radius:18px;border:2px solid var(--line);background:var(--card);min-height:76px;transition:transform .15s,background .15s,border-color .15s}
.ts-menu__career .ico{font-size:34px;line-height:1}
.ts-menu__career .txt{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.ts-menu__career .txt b{font-size:22px;font-weight:850;letter-spacing:-.01em}
.ts-menu__career small{font-size:12px;color:var(--soft)}
.ts-menu__career .cash{display:flex;flex-direction:column;align-items:flex-end}
.ts-menu__career .cash b{font-size:18px;font-weight:800;color:var(--gold2)}
.ts-menu__career[aria-selected="true"]{border-color:var(--gold);background:linear-gradient(135deg,rgba(255,188,66,.22),rgba(255,188,66,.06));box-shadow:0 8px 24px rgba(255,170,50,.18)}
.ts-menu__career[data-career="tram"][aria-selected="true"]{border-color:var(--green);background:linear-gradient(135deg,rgba(79,209,139,.24),rgba(79,209,139,.06));box-shadow:0 8px 24px rgba(79,209,139,.16)}
.ts-menu__career:not([aria-selected="true"]):hover{background:var(--card2)}
.ts-menu__careerNote{grid-column:1/-1;margin-top:-2px}
.ts-menu__sec{display:flex;flex-direction:column;gap:12px}
.ts-menu__sec>h2{font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:var(--soft);font-weight:800;display:flex;align-items:center;gap:10px}
.ts-menu__sec>h2::after{content:"";height:1px;flex:1;background:var(--line)}
.ts-menu__grid{display:grid;gap:14px}
.ts-menu__grid--routes{grid-template-columns:repeat(3,minmax(0,1fr))}
.ts-menu__grid--trains{grid-template-columns:repeat(3,minmax(0,1fr))}
.ts-menu__card{position:relative;border:1px solid var(--line);border-radius:20px;background:var(--card);display:flex;flex-direction:column;overflow:hidden;transition:border-color .15s,background .15s}
.ts-menu__card[data-selected="true"]{border-color:var(--gold);background:linear-gradient(180deg,rgba(255,188,66,.14),rgba(255,188,66,.04));box-shadow:0 0 0 1px var(--gold) inset}
.ts-menu__card[data-locked="true"] .ts-menu__pick{opacity:.62}
.ts-menu__dir{all:unset;position:absolute;top:10px;right:10px;width:34px;height:34px;border-radius:99px;display:grid;place-items:center;font-size:18px;cursor:pointer;background:rgba(255,255,255,.08);border:1px solid var(--line);color:var(--ink,#fff);z-index:2}
.ts-menu__dir[aria-pressed="true"]{background:var(--gold,#f4b942);color:#1b1b1b}
.ts-menu__dir:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.ts-menu__rowHead h3{padding-right:42px}
.ts-menu__pick{all:unset;display:flex;flex-direction:column;gap:6px;padding:16px 16px 12px;cursor:pointer;flex:1;box-sizing:border-box}
.ts-menu__pick:focus-visible{outline:3px solid var(--gold);outline-offset:-3px;border-radius:20px}
.ts-menu__card h3{font-size:17px;line-height:1.2;font-weight:800}
.ts-menu__meta{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px;color:var(--soft);align-items:center}
.ts-menu__kind{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;font-size:19px;background:var(--card2);flex:none}
.ts-menu__rowHead{display:flex;gap:10px;align-items:center}
.ts-menu__tagline{font-size:11.5px;color:var(--soft);line-height:1.4}
.ts-menu__badge2{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;letter-spacing:.04em;padding:3px 9px;border-radius:99px;background:rgba(79,209,139,.16);color:var(--green);text-transform:uppercase;width:max-content}
.ts-menu__badge2--warn{background:rgba(255,107,94,.16);color:var(--red)}
.ts-menu__badge2--gold{background:rgba(255,188,66,.18);color:var(--gold2)}
.ts-menu__foot{padding:0 14px 14px;display:flex;gap:8px;align-items:center}
.ts-menu__btn{flex:1;min-height:44px;border-radius:13px;border:1px solid var(--line);background:var(--card2);font-weight:800;font-size:14px;padding:0 14px;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:background .15s,transform .1s}
.ts-menu__btn:not(:disabled):hover{background:rgba(255,255,255,.18)}
.ts-menu__btn:not(:disabled):active{transform:scale(.98)}
.ts-menu__btn--buy{background:var(--gold);border-color:var(--gold);color:#2a1a08}
.ts-menu__btn--buy:not(:disabled):hover{background:var(--gold2)}
.ts-menu__btn:disabled{opacity:.5}
.ts-menu__btn--buy:disabled{background:rgba(255,188,66,.25);border-color:rgba(255,188,66,.3);color:var(--gold2)}
.ts-menu__svg{display:block;width:100%;height:auto;margin:0 0 4px}
.ts-menu__stage{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01));border-radius:14px;padding:8px 8px 2px;border:1px solid rgba(255,255,255,.06)}
.ts-menu__stats{display:grid;grid-template-columns:auto 1fr auto;gap:5px 10px;align-items:center;font-size:12px;color:var(--soft);margin-top:6px}
.ts-menu__stats b{font-weight:750;color:var(--ink);font-variant-numeric:tabular-nums;font-size:12px;text-align:right}
.ts-menu__stats .bar{height:6px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden;position:relative}
.ts-menu__stats .bar i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:var(--blue)}
.ts-menu__stats .bar i.up{background:var(--green);opacity:.95}
.ts-menu__price{font-weight:850;color:var(--gold2);font-variant-numeric:tabular-nums}
.ts-menu__up{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.ts-menu__upRow{display:grid;grid-template-columns:1fr auto;gap:6px 14px;align-items:center;padding:14px 16px;border:1px solid var(--line);border-radius:18px;background:var(--card)}
.ts-menu__upRow h3{font-size:16px;font-weight:800}
.ts-menu__upRow p{font-size:12px;color:var(--soft);line-height:1.4;grid-column:1}
.ts-menu__upRow .pips{display:flex;gap:5px;margin-top:4px}
.ts-menu__upRow .pips i{width:22px;height:8px;border-radius:99px;background:rgba(255,255,255,.14)}
.ts-menu__upRow .pips i.on{background:var(--green)}
.ts-menu__upRow .btnCell{grid-column:2;grid-row:1/span 3;display:flex;flex-direction:column;gap:6px;align-items:stretch;min-width:132px}
.ts-menu__swatches{display:flex;gap:6px;margin-top:6px}
.ts-menu__swatches i{width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.25);display:block}
.ts-menu__swatches i.on{border-color:var(--gold);transform:scale(1.15)}
.ts-menu__help{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 30px;padding:18px 22px;border:1px solid var(--line);border-radius:20px;background:var(--card)}
.ts-menu__key{display:flex;align-items:center;gap:12px;font-size:13px;min-height:30px}
.ts-menu__keys{display:flex;gap:4px;flex:none;min-width:98px}
.ts-menu kbd{font:inherit;font-size:12px;font-weight:800;min-width:30px;height:28px;padding:0 8px;border-radius:8px;display:inline-grid;place-items:center;background:linear-gradient(180deg,#f1f5f4,#c9d4d1);color:#1c2a30;box-shadow:0 2px 0 #7e8f8b,0 3px 6px rgba(0,0,0,.35)}
.ts-menu__tips{grid-column:1/-1;display:flex;gap:10px 22px;flex-wrap:wrap;padding-top:10px;margin-top:6px;border-top:1px solid var(--line);font-size:12.5px;color:var(--soft)}
.ts-menu__tips span::before{content:"▸ ";color:var(--gold)}
.ts-menu__toast{position:sticky;bottom:12px;align-self:center;padding:10px 18px;border-radius:99px;background:var(--green);color:#06281a;font-weight:800;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.4);animation:tsm-pop .25s both;margin-top:-10px}
.ts-menu__toast--bad{background:var(--red);color:#2d0804}
@keyframes tsm-pop{from{transform:translateY(10px) scale(.96);opacity:0}to{transform:none;opacity:1}}
.ts-menu__footer{text-align:center;font-size:12px;color:var(--soft)}
@media (max-width:980px){
  .ts-menu__envRow{grid-template-columns:1fr}
  .ts-menu__inner{padding:16px 18px 48px;gap:18px}
  .ts-menu__hero{grid-template-columns:1fr}
  .ts-menu__grid--routes,.ts-menu__grid--trains{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ts-menu__titlebox{min-height:290px}
  .ts-menu__heroTrain{width:min(54%,430px)}
}
@media (max-width:780px){
  .ts-menu__up,.ts-menu__help,.ts-menu__modes{grid-template-columns:1fr}
  .ts-menu__career{padding:12px 14px;gap:10px}.ts-menu__career .ico{font-size:28px}.ts-menu__career .txt b{font-size:19px}
}
@media (max-height:700px){.ts-menu__titlebox{min-height:170px}.ts-menu__wallet{font-size:32px}}
@media (prefers-reduced-motion:reduce){.ts-menu__heroTrain,.ts-menu__toast{animation:none}.ts-menu *{transition:none!important}.ts-menu{scroll-behavior:auto}}
`;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------- helpers */
  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }
  const t = (key, vars) => TS.t(key, vars);
  const pick = (obj) => TS.pick(obj);
  const trainById = (id) => C.trains.find((x) => x.id === id) || null;

  function money(n) {
    const locale = TS.lang === 'en' ? 'en-GB' : 'de-LU';
    try {
      return new Intl.NumberFormat(locale).format(Math.round(n)) + ' €';
    } catch (_) {
      return Math.round(n) + ' €';
    }
  }

  /* Routes: A1's TS.routes if loaded, otherwise a fallback table (names, stop count). */
  const FALLBACK_ROUTES = {
    west: { name: { lb: 'Lëtzebuerg – Klengbetten', de: 'Luxemburg – Kleinbettingen', en: 'Luxembourg – Kleinbettingen' }, n: 5, km: 16, kind: 'rail' },
    south: { name: { lb: 'Lëtzebuerg – Esch – Rodange', de: 'Luxemburg – Esch – Rodange', en: 'Luxembourg – Esch – Rodange' }, n: 9, km: 38, kind: 'rail' },
    east: { name: { lb: 'Lëtzebuerg – Waasserbëlleg', de: 'Luxemburg – Wasserbillig', en: 'Luxembourg – Wasserbillig' }, n: 7, km: 28, kind: 'rail' },
    north: { name: { lb: 'Lëtzebuerg – Ettelbréck – Clierf', de: 'Luxemburg – Ettelbrück – Clervaux', en: 'Luxembourg – Ettelbruck – Clervaux' }, n: 9, km: 63, kind: 'rail' },
    trier: { name: { lb: 'Lëtzebuerg – Tréier – Koblenz', de: 'Luxemburg – Trier – Koblenz', en: 'Luxembourg – Trier – Koblenz' }, n: 7, km: 190, kind: 'rail' },
    metz: { name: { lb: 'Lëtzebuerg – Metz – Nancy', de: 'Luxemburg – Metz – Nancy', en: 'Luxembourg – Metz – Nancy' }, n: 6, km: 150, kind: 'rail' },
    brussels: { name: { lb: 'Lëtzebuerg – Arlon – Bréissel', de: 'Luxemburg – Arlon – Brüssel', en: 'Luxembourg – Arlon – Brussels' }, n: 6, km: 220, kind: 'rail' },
    paris: { name: { lb: 'TGV Lëtzebuerg – Paris-Est', de: 'TGV Luxemburg – Paris-Est', en: 'TGV Luxembourg – Paris-Est' }, n: 4, km: 370, kind: 'hst' },
  };
  function routeInfo(id) {
    const live = TS.routes && typeof TS.routes.get === 'function' ? safeGet(id) : null;
    const fb = FALLBACK_ROUTES[id] || { name: id, n: 0, km: 0, kind: 'rail' };
    const rule = C.routeRules[K.baseRouteId ? K.baseRouteId(id) : id];
    const kindFromRule = rule && rule.needs.includes('tram') ? 'tram' : rule && rule.needs.every((x) => x === 'hst') ? 'hst' : 'rail';
    const km = live && Number.isFinite(live.lengthKm) ? live.lengthKm : live && Number.isFinite(live.length) ? live.length / 1000 : null;
    return {
      id,
      name: live && live.name ? pick(live.name) : pick(fb.name),
      stops: live && Array.isArray(live.stations) ? live.stations.length : fb.n,
      km: km === null ? null : km,
      kind: live && live.kind ? live.kind : kindFromRule,
    };
  }
  function safeGet(id) {
    try {
      return TS.routes.get(id) || null;
    } catch (e) {
      console.warn('[Lokféierer] TS.routes.get failed', id, e);
      return null;
    }
  }
  const KIND_ICON = { rail: '🚆', tram: '🚋', hst: '🚄' };
  const KIND_KEY = { rail: 'kindRail', tram: 'kindTram', hst: 'kindHst' };
  const RANK_ICON = { rail: ['🔰', '🚆', '⭐', '🎖️', '👑'], tram: ['🔰', '🚋', '⭐', '🎖️', '👑'] };

  /* -------------------------------------------------- train silhouettes */
  const SVG_W = 300;
  const SVG_H = 76;
  const BASE_Y = 64; // rail top
  const SEG_GAP = 2;
  const MODELS = {
    railcar: [{ w: 150, h: 40, l: 'round', r: 'round', exhaust: true }],
    emu: [
      { w: 118, h: 42, l: 'slope', r: 'none' },
      { w: 118, h: 42, l: 'none', r: 'slope', pan: true },
    ],
    tram: [
      { w: 56, h: 30, l: 'slope', r: 'none' },
      { w: 54, h: 30, l: 'none', r: 'none', pan: true },
      { w: 54, h: 30, l: 'none', r: 'none' },
      { w: 54, h: 30, l: 'none', r: 'none', pan: true },
      { w: 56, h: 30, l: 'none', r: 'slope' },
    ],
    kiss: [
      { w: 70, h: 52, l: 'slope', r: 'none', deck: 2 },
      { w: 70, h: 52, l: 'none', r: 'none', deck: 2, pan: true },
      { w: 70, h: 52, l: 'none', r: 'none', deck: 2 },
      { w: 70, h: 52, l: 'none', r: 'slope', deck: 2 },
    ],
    ic: [
      { w: 56, h: 42, l: 'slope', r: 'none', loco: true, pan: true },
      { w: 46, h: 42, l: 'none', r: 'none' },
      { w: 46, h: 42, l: 'none', r: 'none' },
      { w: 46, h: 42, l: 'none', r: 'none' },
      { w: 46, h: 42, l: 'none', r: 'none' },
      { w: 46, h: 42, l: 'none', r: 'slope' },
    ],
    hst: [
      { w: 46, h: 38, l: 'point', r: 'none', power: true },
      { w: 32, h: 38, l: 'none', r: 'none' },
      { w: 32, h: 38, l: 'none', r: 'none' },
      { w: 32, h: 38, l: 'none', r: 'none', pan: true },
      { w: 32, h: 38, l: 'none', r: 'none' },
      { w: 32, h: 38, l: 'none', r: 'none' },
      { w: 32, h: 38, l: 'none', r: 'none' },
      { w: 46, h: 38, l: 'none', r: 'point', power: true },
    ],
  };
  let svgUid = 0;

  function bodyPoints(x, top, w, h, left, right) {
    const bottom = top + h;
    const inset = { none: [0, 0, 0], round: [7, 2, 0], slope: [14, 5, 0], point: [30, 12, 0] };
    const [tl, ml] = inset[left] || inset.none;
    const [tr, mr] = inset[right] || inset.none;
    return [
      [x + tl, top], [x + w - tr, top], [x + w - mr, top + h * 0.5], [x + w, bottom - 2], [x + w, bottom],
      [x, bottom], [x, bottom - 2], [x + ml, top + h * 0.5],
    ]
      .map((p) => p.map((v) => +v.toFixed(1)).join(','))
      .join(' ');
  }

  /* Tram silhouette: low floor, rounded cab ends, continuous glazing, one door per module, bellows between modules, roof pantographs. */
  function tramSvg(liv, opts) {
    const uid = ++svgUid;
    const L = liv || { body: '#f1f1ee', accent: '#d6342e', stripe: '#8a8d93' };
    const widths = [58, 46, 46, 46, 58], gap = 5, h = 32, bottom = BASE_Y - 4, top = bottom - h;
    const total = widths.reduce((a, w) => a + w, 0) + gap * (widths.length - 1);
    let x = (SVG_W - total) / 2;
    const out = [`<defs><linearGradient id="tsg${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".4"/><stop offset=".5" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient></defs>`];
    out.push(`<rect x="4" y="${BASE_Y + 1}" width="${SVG_W - 8}" height="2.5" rx="1" fill="#78848b"/>`, `<rect x="4" y="${BASE_Y + 4}" width="${SVG_W - 8}" height="2" fill="#3a2f28" opacity=".6"/>`);
    widths.forEach((w, i) => {
      const first = i === 0, last = i === widths.length - 1;
      const rl = first ? 12 : 3, rr = last ? 12 : 3;
      out.push(`<path d="M${x + rl},${top} H${x + w - rr} Q${x + w},${top} ${x + w},${top + rr} V${bottom} H${x} V${top + rl} Q${x},${top} ${x + rl},${top} Z" fill="${L.body}"/>`);
      out.push(`<rect x="${x}" y="${bottom - 7}" width="${w}" height="7" fill="${L.accent}" opacity=".92"/>`, `<rect x="${x}" y="${bottom - 9}" width="${w}" height="1.6" fill="${L.stripe}"/>`);
      const gx0 = x + (first ? 14 : 4), gx1 = x + w - (last ? 14 : 4);
      out.push(`<rect x="${gx0}" y="${top + 5}" width="${gx1 - gx0}" height="12" rx="2" fill="#16262f" opacity=".93"/>`);
      for (let k = 1; k < Math.round((gx1 - gx0) / 14); k++) out.push(`<rect x="${gx0 + (k * (gx1 - gx0)) / Math.round((gx1 - gx0) / 14) - 0.6}" y="${top + 5}" width="1.2" height="12" fill="${L.body}"/>`);
      const dx = x + w / 2 - 6;
      out.push(`<rect x="${dx}" y="${top + 5}" width="12" height="${h - 12}" rx="1.5" fill="${L.accent}" opacity=".88"/>`, `<rect x="${dx + 5.4}" y="${top + 5}" width="1.2" height="${h - 12}" fill="#16262f" opacity=".5"/>`);
      if (first) out.push(`<path d="M${x + 3},${top + 6} Q${x + 3},${top + 4} ${x + 8},${top + 4} L${x + 14},${top + 4} V${top + 17} H${x + 3} Z" fill="#0d1a22" opacity=".95"/>`, `<circle cx="${x + 3.5}" cy="${bottom - 11}" r="1.8" fill="#fff6c8"/>`);
      if (last) out.push(`<path d="M${x + w - 3},${top + 6} Q${x + w - 3},${top + 4} ${x + w - 8},${top + 4} L${x + w - 14},${top + 4} V${top + 17} H${x + w - 3} Z" fill="#0d1a22" opacity=".95"/>`, `<circle cx="${x + w - 3.5}" cy="${bottom - 11}" r="1.8" fill="#ff5a4a"/>`);
      out.push(`<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="url(#tsg${uid})"/>`);
      if (i === 1 || i === 3) out.push(`<path d="M${x + w / 2 - 10},${top} L${x + w / 2 - 2},${top - 9} L${x + w / 2 + 7},${top} M${x + w / 2 - 6},${top - 9} H${x + w / 2 + 3}" stroke="#2a2d30" stroke-width="1.6" fill="none" stroke-linecap="round"/>`);
      [0.2, 0.8].forEach((f) => out.push(`<circle cx="${(x + w * f).toFixed(1)}" cy="${BASE_Y - 1.5}" r="3.2" fill="#1a1c1f" stroke="#555d63" stroke-width="1"/>`));
      if (!last) out.push(`<rect x="${x + w}" y="${top + 6}" width="${gap}" height="${h - 9}" fill="#1d2326"/>`);
      x += w + gap;
    });
    const label = opts && opts.label ? ` role="img" aria-label="${String(opts.label).replace(/[<>&"]/g, '')}"` : ' aria-hidden="true"';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="xMidYMax meet"${label}>${out.join('')}</svg>`;
  }

  function trainSvg(modelId, liv, opts) {
    if (modelId === 'tram') return tramSvg(liv, opts);
    const segs = MODELS[modelId] || MODELS.emu;
    const uid = ++svgUid;
    const total = segs.reduce((a, s) => a + s.w, 0) + SEG_GAP * (segs.length - 1);
    let x = (SVG_W - total) / 2;
    const L = liv || { body: '#ddd', accent: '#c33', stripe: '#236' };
    const out = [];
    out.push(`<defs><linearGradient id="tsg${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".45" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient></defs>`);
    out.push(`<rect x="4" y="${BASE_Y + 1}" width="${SVG_W - 8}" height="2.5" rx="1" fill="#78848b"/>`);
    out.push(`<rect x="4" y="${BASE_Y + 4}" width="${SVG_W - 8}" height="2" fill="#3a2f28" opacity=".6"/>`);
    segs.forEach((s, i) => {
      const bottom = BASE_Y - 5;
      const top = bottom - s.h;
      const pts = bodyPoints(x, top, s.w, s.h, s.l, s.r);
      out.push(`<polygon points="${pts}" fill="${L.body}" stroke="${L.body}" stroke-width="1.2" stroke-linejoin="round"/>`);
      if (s.loco || s.power) {
        out.push(`<rect x="${x + 10}" y="${top + s.h * 0.34}" width="${s.w - 20}" height="${s.h * 0.34}" fill="${L.accent}" opacity=".9" rx="2"/>`);
        for (let g = 0; g < 4; g++) out.push(`<rect x="${x + s.w * (0.34 + g * 0.1)}" y="${top + s.h * 0.4}" width="1.6" height="${s.h * 0.2}" fill="#000" opacity=".28"/>`);
      } else {
        const rows = s.deck === 2 ? [0.14, 0.56] : [0.2];
        const wh = s.deck === 2 ? s.h * 0.26 : s.h * (s.h < 34 ? 0.36 : 0.32);
        rows.forEach((r) => {
          const n = Math.max(2, Math.floor((s.w - 22) / (s.h < 34 ? 13 : 15)));
          const slot = (s.w - 22) / n;
          for (let k = 0; k < n; k++) {
            const isDoor = k === 0 || k === n - 1 || (n >= 5 && k === Math.floor(n / 2));
            out.push(`<rect x="${(x + 11 + k * slot + 1.2).toFixed(1)}" y="${(top + s.h * r).toFixed(1)}" width="${(slot - 2.4).toFixed(1)}" height="${wh.toFixed(1)}" rx="1.6" fill="${isDoor && r === rows[rows.length - 1] ? L.accent : '#1b2a34'}" opacity="${isDoor && r === rows[rows.length - 1] ? 0.85 : 0.92}"/>`);
          }
        });
      }
      out.push(`<rect x="${x}" y="${(bottom - s.h * 0.2).toFixed(1)}" width="${s.w}" height="2.4" fill="${L.stripe}"/>`);
      out.push(`<rect x="${x}" y="${bottom - 3}" width="${s.w}" height="3" fill="${L.accent}"/>`);
      out.push(`<polygon points="${pts}" fill="url(#tsg${uid})" stroke="none"/>`);
      if (s.l !== 'none' && s.l !== 'round') {
        const ws = s.l === 'point' ? 16 : 9;
        out.push(`<polygon points="${x + ws},${top + 3} ${x + ws + 14},${top + 3} ${x + ws + 14},${top + s.h * 0.42} ${x + 3},${top + s.h * 0.42}" fill="#10202a" opacity=".9"/>`);
      }
      if (s.r !== 'none' && s.r !== 'round') {
        const ws = s.r === 'point' ? 16 : 9;
        const xr = x + s.w;
        out.push(`<polygon points="${xr - ws},${top + 3} ${xr - ws - 14},${top + 3} ${xr - ws - 14},${top + s.h * 0.42} ${xr - 3},${top + s.h * 0.42}" fill="#10202a" opacity=".9"/>`);
      }
      if (s.l === 'round') out.push(`<rect x="${x + 5}" y="${top + 5}" width="12" height="${s.h * 0.34}" rx="2" fill="#10202a" opacity=".9"/>`);
      if (s.r === 'round') out.push(`<rect x="${x + s.w - 17}" y="${top + 5}" width="12" height="${s.h * 0.34}" rx="2" fill="#10202a" opacity=".9"/>`);
      if (s.pan) {
        const px = x + s.w * 0.5;
        out.push(`<path d="M${px - 9},${top} L${px - 2},${top - 10} L${px + 6},${top} M${px - 6},${top - 10} H${px + 2}" stroke="#2a2d30" stroke-width="1.6" fill="none" stroke-linecap="round"/>`);
      }
      if (s.exhaust) out.push(`<rect x="${x + 100}" y="${top - 4}" width="6" height="5" rx="1" fill="#2a2d30"/>`);
      [0.14, 0.86].forEach((f) => out.push(`<circle cx="${(x + s.w * f).toFixed(1)}" cy="${BASE_Y - 1.5}" r="3.6" fill="#1a1c1f" stroke="#555d63" stroke-width="1"/>`));
      if (s.l === 'slope' || s.l === 'point' || s.l === 'round') out.push(`<circle cx="${x + 2.5}" cy="${bottom - 7}" r="1.8" fill="#fff6c8"/>`);
      if (s.r === 'slope' || s.r === 'point' || s.r === 'round') out.push(`<circle cx="${x + s.w - 2.5}" cy="${bottom - 7}" r="1.8" fill="${s.r === 'round' ? '#fff6c8' : '#ff5a4a'}"/>`);
      x += s.w + SEG_GAP;
    });
    const label = opts && opts.label ? ` role="img" aria-label="${String(opts.label).replace(/[<>&"]/g, '')}"` : ' aria-hidden="true"';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="xMidYMax meet"${label}>${out.join('')}</svg>`;
  }
  function svgNode(modelId, liv, cls, label) {
    const wrap = h('div', { class: cls || 'ts-menu__svg' });
    wrap.innerHTML = trainSvg(modelId, liv, { label }); // generated from our own constants only
    return wrap;
  }

  /* --------------------------------------------------------------- state */
  const ctx = { reverse: {}, container: null, root: null, opts: {}, save: null, career: 'rail', routeId: 'west', trainId: 'railcar', toast: null, toastTimer: 0, heroTrain: null, env: { weather: 'random', tod: 'random' } };

  function setSave(save) {
    ctx.save = K.normalize(save);
  }
  /* The state of the career shown right now (wallet, rank, garage, routes, upgrades). */
  const cs = () => ctx.save[ctx.career];
  const careerRoutes = () => C.routeOrder.filter((id) => K.careerOfRoute(id) === ctx.career);
  const careerTrains = () => C.trains.filter((tr) => K.careerOfTrain(tr) === ctx.career);

  function callHost(name, ...args) {
    const fn = ctx.opts[name];
    if (typeof fn !== 'function') return undefined;
    try {
      return fn(...args);
    } catch (e) {
      console.warn('[Lokféierer] menu callback failed:', name, e);
      return undefined;
    }
  }
  const isSave = (x) => x && typeof x === 'object' && !!x.rail && !!x.tram && typeof x.tb === 'number';

  function showToast(text, bad) {
    ctx.toast = { text, bad: !!bad };
    clearTimeout(ctx.toastTimer);
    ctx.toastTimer = setTimeout(() => {
      ctx.toast = null;
      paint();
    }, 2200);
  }

  /* ------------------------------------------------------------- actions */
  function doBuy(kind, id, extra) {
    const check = K.canBuy(ctx.save, kind, id, extra);
    if (!check.ok) {
      showToast(t(check.reason === 'needsTrain' ? 'needsRoute' : check.reason === 'needsSections' ? 'needsSections' : check.reason === 'needsMoney' ? 'needsMoney' : 'locked'), true);
      paint();
      return;
    }
    const res = callHost('onBuy', kind, id, extra);
    if (isSave(res)) {
      setSave(res);
      if (kind === 'train') ctx.trainId = cs().train;
    }
    showToast(t(kind === 'upgrade' ? 'upgraded' : 'bought'), false);
    paint();
  }
  function doSelectTrain(id) {
    ctx.trainId = id;
    const res = callHost('onSelect', id);
    if (isSave(res)) setSave(res);
    paint();
  }
  /* direction of a route card: the id with '~r' appended when the return direction is chosen (same ownership and price, see TS.routeDir) */
  const routeKey = (id) => (ctx.reverse[id] ? id + '~r' : id);
  function doToggleDir(id) {
    ctx.reverse = Object.assign({}, ctx.reverse, { [id]: !ctx.reverse[id] });
    if (cs().routes.includes(id)) ctx.routeId = id;
    paint();
  }
  function doSelectRoute(id) {
    ctx.routeId = id;
    // Switch to the cheapest owned train that can drive it, so the career button just works.
    if (cs().routes.includes(id) && !K.trainCompatible(ctx.trainId, id)) {
      const fit = cs().owned.find((tid) => K.trainCompatible(tid, id));
      if (fit) {
        ctx.trainId = fit;
        const res = callHost('onSelect', fit);
        if (isSave(res)) setSave(res);
      }
    }
    paint();
  }
  /* Switch between the Zuch and the Tram career (remembered in the save). */
  function doCareer(cid) {
    if (cid === ctx.career) return;
    ctx.career = cid;
    const res = callHost('onCareer', cid);
    if (isSave(res)) setSave(res);
    ctx.routeId = cs().route;
    ctx.trainId = cs().train;
    ctx.heroTrain = null;
    paint();
  }
  function doStart(mode) {
    if (mode === 'endless') {
      const order = K.endlessOrder(ctx.trainId);
      if (!order.length) return;
      callHost('onStart', 'endless', order[0], ctx.trainId);
      return;
    }
    if (!K.routeAvailable(ctx.save, ctx.routeId, ctx.trainId).ok) return;
    callHost('onStart', 'career', routeKey(ctx.routeId), ctx.trainId);
  }
  function doHints() {
    const res = callHost('onHints', !ctx.save.hints);
    if (isSave(res)) setSave(res);
    paint();
  }
  function doEnv(kind, id) {
    ctx.env = Object.assign({}, ctx.env, { [kind]: id });
    callHost('onEnv', kind, id);
    paint();
  }
  function doLang(lang) {
    TS.setLang(lang);
    callHost('onLang', lang);
    paint();
  }

  /* ---------------------------------------------------------- components */
  function langBar() {
    return h('div', { class: 'ts-menu__langs', role: 'group', 'aria-label': t('language') },
      TS.langs.map((l) => h('button', { type: 'button', 'aria-pressed': String(TS.lang === l), 'data-fid': 'lang-' + l, on: { click: () => doLang(l) }, text: l.toUpperCase() })));
  }

  function hintsToggle() {
    return h('button', { type: 'button', class: 'ts-menu__hints', 'aria-pressed': String(!!ctx.save.hints), 'data-fid': 'hints', 'data-test': 'hints-toggle', on: { click: doHints },
      title: t('hintsInfo'), text: '💡 ' + t('hintsLabel') + ': ' + t(ctx.save.hints ? 'on' : 'off') });
  }

  function careerSwitch() {
    const tab = (cid) => {
      const c = ctx.save[cid];
      const info = K.rankInfo(c.lifetime, cid);
      const on = ctx.career === cid;
      return h('button', { type: 'button', class: 'ts-menu__career', role: 'tab', 'aria-selected': String(on), 'data-career': cid, 'data-fid': 'career-' + cid, 'data-test': 'career-' + cid, on: { click: () => doCareer(cid) } },
        h('span', { class: 'ico', 'aria-hidden': 'true', text: C.careers[cid].icon }),
        h('span', { class: 'txt' }, h('b', { text: t(cid === 'tram' ? 'careerTram' : 'careerRail') }), h('small', { text: t('rank_' + info.id) })),
        h('span', { class: 'cash' }, h('small', { text: t('wallet') }), h('b', { 'data-test': 'wallet-' + cid, text: money(c.wallet) })));
    };
    return h('div', { class: 'ts-menu__careers', role: 'tablist', 'aria-label': t('careerSwitch') }, C.careers.order.map(tab), h('p', { class: 'ts-menu__small ts-menu__careerNote', text: t('careerNote') }));
  }

  function hero() {
    const s = cs();
    const info = K.rankInfo(s.lifetime, ctx.career);
    const train = trainById(ctx.trainId) || C.trains[0];
    const eff = K.applyUpgrades(train, ctx.save);
    const animate = ctx.heroTrain !== ctx.trainId;
    ctx.heroTrain = ctx.trainId;
    const toNext = info.next === null ? t('maxRank') : t('nextRank', { n: money(info.next).replace(' €', '') });
    return h('div', { class: 'ts-menu__hero' },
      h('div', { class: 'ts-menu__titlebox' },
        h('div', {}, h('p', { class: 'ts-menu__eyebrow', text: ctx.career === 'tram' ? 'LUXTRAM' : 'LUX RAIL' }), h('h1', { class: 'ts-menu__title', id: 'ts-menu-title', 'aria-label': t('title') }, h('span', { class: 'ts-menu__title1', text: t('title').split(' ')[0] }), h('span', { class: 'ts-menu__title2', text: t('title').split(' ').slice(1).join(' ') })), h('p', { class: 'ts-menu__tag', text: t(ctx.career === 'tram' ? 'taglineTram' : 'tagline') })),
        h('div', { class: 'ts-menu__heroTrain' + (animate ? ' anim' : '') }, svgNode(train.model, eff.livery, 'ts-menu__svg', pick(train.name))),
        h('div', { class: 'ts-menu__rails' })),
      h('div', { class: 'ts-menu__player' },
        h('div', { class: 'ts-menu__rank' }, h('span', { class: 'ts-menu__badge', 'aria-hidden': 'true', text: RANK_ICON[ctx.career][info.index] }),
          h('div', {}, h('div', { text: t('rank') }), h('div', { class: 'ts-menu__rankName', text: t('rank_' + info.id) }))),
        h('div', { class: 'ts-menu__bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(info.progress * 100)) }, h('i', { style: `width:${Math.round(info.progress * 100)}%` })),
        h('p', { class: 'ts-menu__small', text: toNext }),
        h('div', { class: 'ts-menu__walletRow' }, h('div', {}, h('div', { class: 'ts-menu__small', text: t('wallet') }), h('div', { class: 'ts-menu__wallet', 'data-test': 'wallet', text: money(s.wallet) })),
          h('div', {}, h('div', { class: 'ts-menu__small', text: t('lifetime') }), h('b', { text: money(s.lifetime) })))));
  }

  /* Short name for the endless order chips: the terminus for rail lines, the section name for the Luxtram. */
  function chipLabel(id) {
    const name = routeInfo(id).name;
    if (K.careerOfRoute(id) === 'tram') return name.replace(/^Luxtram T1:\s*/, '');
    return name.split(' – ')[name.includes(' – ') ? 1 : 0];
  }

  function modes() {
    const avail = K.routeAvailable(ctx.save, ctx.routeId, ctx.trainId);
    const endlessList = K.endlessOrder(ctx.trainId);
    const route = routeInfo(routeKey(ctx.routeId));
    const train = trainById(ctx.trainId);
    const careerSub = avail.ok ? `${route.name} · ${pick(train.name)}` : t(avail.reason === 'needsRoute' ? 'needsRoute' : avail.reason);
    return [
      h('div', { class: 'ts-menu__modes' },
        h('button', { type: 'button', class: 'ts-menu__mode ts-menu__mode--career', disabled: !avail.ok, 'data-fid': 'mode-career', 'data-test': 'mode-career', on: { click: () => doStart('career') } },
          h('span', { class: 'go', 'aria-hidden': 'true', text: '▶' }), h('b', { text: t('modeCareer') }), h('small', { text: t(ctx.career === 'tram' ? 'modeCareerDescTram' : 'modeCareerDesc') }), h('span', { class: 'sub', text: careerSub })),
        h('button', { type: 'button', class: 'ts-menu__mode ts-menu__mode--endless', disabled: !endlessList.length, 'data-fid': 'mode-endless', 'data-test': 'mode-endless', on: { click: () => doStart('endless') } },
          h('span', { class: 'go', 'aria-hidden': 'true', text: '∞' }), h('b', { text: t('modeEndless') }), h('small', { text: t(ctx.career === 'tram' ? 'modeEndlessDescTram' : 'modeEndlessDesc') }), h('span', { class: 'sub', text: pick(train.name) + ' · ×' + C.economy.endlessMultiplier }))),
      h('div', { class: 'ts-menu__order', 'aria-label': t('endlessRoutes') }, h('span', { text: t('endlessRoutes') }),
        endlessList.map((id, i) => h('span', { class: 'chip' }, (i ? '→ ' : '') + chipLabel(id)))),
    ];
  }

  /* Weather + time of day: remembered per player by the host (localStorage), used by career and endless on every route. */
  function envPanel() {
    const row = (kind, label) => h('div', { class: 'ts-menu__envRow' },
      h('span', { class: 'ts-menu__envLbl', id: 'ts-menu-env-' + kind, text: label }),
      h('div', { class: 'ts-menu__envOpts', role: 'radiogroup', 'aria-labelledby': 'ts-menu-env-' + kind },
        TS.envChoices[kind].map((o) => h('button', { type: 'button', class: 'ts-menu__envOpt', role: 'radio', 'aria-checked': String(ctx.env[kind] === o.id), 'data-fid': 'env-' + kind + '-' + o.id, 'data-test': (kind === 'tod' ? 'tod-' : 'wx-') + o.id, on: { click: () => doEnv(kind, o.id) } },
          h('span', { 'aria-hidden': 'true', text: o.icon }), h('span', { text: t(o.key) })))));
    return h('section', { class: 'ts-menu__env', 'aria-label': t('weather') + ' / ' + t('timeOfDay') }, row('weather', t('weather')), row('tod', t('timeOfDay')), h('p', { class: 'ts-menu__small', text: t('envInfo') }));
  }

  function routeCard(id) {
    const s = cs();
    const rule = C.routeRules[id];
    const info = routeInfo(routeKey(id));
    const owned = s.routes.includes(id);
    const selected = ctx.routeId === id;
    const needNames = K.trainsForRoute(id).map((tid) => pick(trainById(tid).name));
    const needsLabel = needNames.length > 1 ? t('needsTrainOrBetter', { name: needNames[0] }) : t('needsTrain', { name: needNames[0] || '?' });
    const check = K.canBuy(ctx.save, 'route', id);
    const ownsFit = s.owned.some((tid) => K.trainCompatible(tid, id));
    const badge = owned
      ? (ownsFit ? h('span', { class: 'ts-menu__badge2', text: '✓ ' + t('unlocked') }) : h('span', { class: 'ts-menu__badge2 ts-menu__badge2--warn', text: needsLabel }))
      : h('span', { class: 'ts-menu__badge2 ts-menu__badge2--gold', text: '🔒 ' + t('locked') });
    const foot = owned
      ? null
      : h('div', { class: 'ts-menu__foot' },
        h('button', { type: 'button', class: 'ts-menu__btn ts-menu__btn--buy', disabled: !check.ok, 'data-fid': 'buy-route-' + id, 'data-test': 'buy-route-' + id, on: { click: () => doBuy('route', id) },
          title: check.reason === 'needsTrain' ? needsLabel : '' }, check.reason === 'needsTrain' ? needsLabel : check.reason === 'needsSections' ? t('needsSections') : t('unlock') + ' · ' + money(rule.price)));
    return h('article', { class: 'ts-menu__card', 'data-selected': String(selected && owned), 'data-locked': String(!owned), 'data-route': id },
      h('button', { type: 'button', class: 'ts-menu__pick', disabled: !owned, 'aria-pressed': String(selected && owned), 'data-fid': 'route-' + id, 'data-test': 'route-' + id, on: { click: () => doSelectRoute(id) } },
        h('div', { class: 'ts-menu__rowHead' }, h('span', { class: 'ts-menu__kind', 'aria-hidden': 'true', text: KIND_ICON[info.kind] || '🚆' }), h('h3', { text: info.name })),
        h('div', { class: 'ts-menu__meta' }, h('span', { text: t('stationsN', { n: info.stops }) }), info.km ? h('span', { text: Math.round(info.km) + ' km' }) : null, h('span', { text: t(KIND_KEY[info.kind] || 'kindRail') }),
          h('span', { class: 'ts-menu__price', text: owned ? '' : money(rule.price) }), owned && s.best[routeKey(id)] ? h('span', { text: '★ ' + s.best[routeKey(id)] }) : null),
        badge),
      h('button', { type: 'button', class: 'ts-menu__dir', 'aria-pressed': String(!!ctx.reverse[id]), title: t('dirToggle'), 'aria-label': t('dirToggle'), 'data-fid': 'dir-' + id, 'data-test': 'dir-' + id, text: '⇄', on: { click: () => doToggleDir(id) } }),
      foot);
  }

  function statRow(label, value, max, valueText) {
    const pct = Math.max(4, Math.min(100, (value / max) * 100));
    return [h('span', { text: label }), h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })), h('b', { text: valueText })];
  }

  function trainCard(train) {
    const s = cs();
    const owned = s.owned.includes(train.id);
    const selected = ctx.trainId === train.id;
    const eff = K.applyUpgrades(train, ctx.save);
    const check = K.canBuy(ctx.save, 'train', train.id);
    const maxSpeed = 320, maxCap = 750, maxAccel = 1.3, maxBrake = 1.4;
    const stats = h('div', { class: 'ts-menu__stats' },
      statRow(t('statSpeed'), eff.maxKmh, maxSpeed, eff.maxKmh + ' km/h'),
      statRow(t('statCapacity'), eff.capacity, maxCap, String(eff.capacity)),
      statRow(t('statAccel'), eff.accel, maxAccel, eff.accel.toFixed(2) + ' m/s²'),
      statRow(t('statBrake'), eff.brake, maxBrake, eff.brake.toFixed(2) + ' m/s²'));
    let action;
    if (owned) {
      action = h('button', { type: 'button', class: 'ts-menu__btn', disabled: selected, 'aria-pressed': String(selected), 'data-fid': 'select-' + train.id, 'data-test': 'select-' + train.id, on: { click: () => doSelectTrain(train.id) } }, selected ? '✓ ' + t('selected') : t('select'));
    } else {
      action = h('button', { type: 'button', class: 'ts-menu__btn ts-menu__btn--buy', disabled: !check.ok, 'data-fid': 'buy-train-' + train.id, 'data-test': 'buy-train-' + train.id, on: { click: () => doBuy('train', train.id) },
        title: check.ok ? '' : t('needsMoney') }, t('buy') + ' · ' + money(train.price));
    }
    return h('article', { class: 'ts-menu__card', 'data-selected': String(selected && owned), 'data-train': train.id, 'data-owned': String(owned) },
      h('div', { class: 'ts-menu__pick', style: 'cursor:default' },
        h('div', { class: 'ts-menu__stage' }, svgNode(train.model, eff.livery, 'ts-menu__svg', pick(train.name))),
        h('div', { class: 'ts-menu__rowHead' }, h('h3', { text: pick(train.name) }), owned ? h('span', { class: 'ts-menu__badge2', text: t('owned') }) : h('span', { class: 'ts-menu__badge2 ts-menu__badge2--gold', text: '🔒' })),
        h('div', { class: 'ts-menu__meta' }, h('span', { text: t('cars', { n: eff.cars }) }), h('span', { text: t('seats', { n: eff.capacity }) }), h('span', { text: t(KIND_KEY[train.kind === 'tram' ? 'tram' : 'rail']) })),
        stats),
      h('div', { class: 'ts-menu__foot' }, action));
  }

  function upgradesPanel() {
    const s = cs();
    const train = trainById(ctx.trainId);
    if (!train || !s.owned.includes(train.id)) return null;
    const levels = s.upgrades[train.id];
    const rows = C.upgradeKinds.map((kind) => {
      const max = K.MAX_LEVELS[kind];
      const lv = levels[kind];
      const price = K.upgradePrice(ctx.save, train.id, kind);
      const check = K.canBuy(ctx.save, 'upgrade', kind, train.id);
      const isMax = price === undefined;
      const infoKey = kind === 'capacity' && C.extraCarTrains.includes(train.id) ? 'up_capacity_info_car' : kind === 'motor' && train.kind === 'tram' ? 'up_motor_info_tram' : 'up_' + kind + '_info';
      const liveries = train.liveries || [train.livery];
      return h('div', { class: 'ts-menu__upRow', 'data-upgrade': kind },
        h('h3', { text: t('up_' + kind) + '  ' }, h('span', { class: 'ts-menu__small', text: t('level', { n: lv, max }) })),
        h('p', { text: t(infoKey) }),
        h('div', {}, h('div', { class: 'pips', 'aria-hidden': 'true' }, Array.from({ length: max }, (_, i) => h('i', { class: i < lv ? 'on' : '' }))),
          kind === 'paint' ? h('div', { class: 'ts-menu__swatches', 'aria-hidden': 'true' }, liveries.map((l, i) => h('i', { class: i === Math.min(lv, liveries.length - 1) ? 'on' : '', style: `background:linear-gradient(135deg,${l.body} 50%,${l.accent} 50%)` }))) : null),
        h('div', { class: 'btnCell' },
          h('button', { type: 'button', class: 'ts-menu__btn ts-menu__btn--buy', disabled: isMax || !check.ok, 'data-fid': 'up-' + kind, 'data-test': 'up-' + kind, on: { click: () => doBuy('upgrade', kind, train.id) } },
            isMax ? t('maxLevel') : t('upgrade') + ' · ' + money(price))));
    });
    return h('section', { class: 'ts-menu__sec', 'aria-labelledby': 'ts-menu-up' },
      h('h2', { id: 'ts-menu-up', text: t('upgrades') + ' · ' + pick(train.name) }), h('div', { class: 'ts-menu__up' }, rows));
  }

  const KEYS = [
    [['W', '↑'], 'keyPower'], [['S', '↓'], 'keyBrake'], [['X', '⌫'], 'keyEB'], [['D'], 'keyDoors'], [['B'], 'keyParking'],
    [['H', 'Space'], 'keyHorn'], [['L'], 'keyLights'], [['V'], 'keyWeather'], [['A'], 'keyAnnounce'], [['C', '1–4'], 'keyCamera'],
    [['T'], 'keyTimetable'], [['M'], 'keyMute'], [['P', 'Esc'], 'keyPause'], [['F1', '?'], 'keyHelp'],
  ];
  function helpPanel() {
    return h('section', { class: 'ts-menu__sec', 'aria-labelledby': 'ts-menu-help' },
      h('h2', { id: 'ts-menu-help', text: t('controls') }),
      h('div', { class: 'ts-menu__help' },
        KEYS.map(([caps, key]) => h('div', { class: 'ts-menu__key' }, h('span', { class: 'ts-menu__keys' }, caps.map((c) => h('kbd', { text: c }))), h('span', { text: t(key) }))),
        h('div', { class: 'ts-menu__tips' }, [1, 2, 3, 4].map((n) => h('span', { text: t('tip' + n) })))));
  }

  /* --------------------------------------------------------------- paint */
  function paint() {
    if (!ctx.container) return;
    const active = document.activeElement;
    const fid = active && ctx.root && ctx.root.contains(active) ? active.getAttribute('data-fid') : null;
    const scroll = ctx.root ? ctx.root.scrollTop : 0;
    const s = cs();
    if (!s.routes.includes(ctx.routeId)) ctx.routeId = s.route;
    if (!s.owned.includes(ctx.trainId)) ctx.trainId = s.train;

    const root = h('div', { class: 'ts-menu', lang: TS.lang, role: 'main', 'aria-labelledby': 'ts-menu-title' });
    const inner = h('div', { class: 'ts-menu__inner' },
      h('div', { class: 'ts-menu__top' }, h('span', { class: 'ts-menu__stamp', text: C.careers[ctx.career].icon + (ctx.career === 'tram' ? ' LUXTRAM · SIM' : ' LUX RAIL · SIM') }), h('div', { class: 'ts-menu__topR' }, hintsToggle(), langBar())),
      careerSwitch(),
      hero(),
      modes(),
      envPanel(),
      h('section', { class: 'ts-menu__sec', 'aria-labelledby': 'ts-menu-routes' }, h('h2', { id: 'ts-menu-routes', text: t('routes') }),
        h('div', { class: 'ts-menu__grid ts-menu__grid--routes' }, careerRoutes().map(routeCard))),
      h('section', { class: 'ts-menu__sec', 'aria-labelledby': 'ts-menu-garage' }, h('h2', { id: 'ts-menu-garage', text: t('garage') }),
        h('div', { class: 'ts-menu__grid ts-menu__grid--trains' }, careerTrains().map(trainCard))),
      upgradesPanel(),
      helpPanel(),
      h('p', { class: 'ts-menu__footer', text: 'ian.lu · Zuchsimulator Lëtzebuerg' }),
      ctx.toast ? h('div', { class: 'ts-menu__toast' + (ctx.toast.bad ? ' ts-menu__toast--bad' : ''), role: 'status', text: ctx.toast.text }) : null);
    root.append(inner);
    ctx.container.replaceChildren(root);
    ctx.root = root;
    root.scrollTop = scroll;
    if (fid) {
      const again = root.querySelector(`[data-fid="${fid}"]`);
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
  }

  /* --------------------------------------------------------------- public */
  function render(container, opts) {
    if (!container || !container.nodeType) {
      console.warn('[Lokféierer] TS.menu.render needs a container element');
      return;
    }
    ensureStyle();
    ctx.container = container;
    ctx.opts = { ...(opts || {}) };
    if (ctx.opts.lang) TS.setLang(ctx.opts.lang);
    setSave(ctx.opts.save);
    ctx.career = ctx.save.career;
    ctx.routeId = cs().route;
    ctx.trainId = cs().train;
    ctx.env = Object.assign({ weather: 'random', tod: 'random' }, ctx.opts.env || {});
    ctx.toast = null;
    ctx.root = null;
    ctx.heroTrain = null;
    paint();
  }
  /* update({ save?, lang? }) after the host persisted something */
  function update(patch) {
    if (!ctx.container) return;
    const p = patch || {};
    if (p.lang) TS.setLang(p.lang);
    if (p.env) ctx.env = Object.assign({}, ctx.env, p.env);
    if (p.save) {
      setSave(p.save);
      ctx.opts = { ...ctx.opts, save: ctx.save };
      ctx.career = ctx.save.career;
      ctx.trainId = cs().train;
      if (cs().routes.includes(cs().route)) ctx.routeId = cs().route;
    }
    paint();
  }
  function toast(text, bad) {
    showToast(text, bad);
    paint();
  }
  function destroy() {
    clearTimeout(ctx.toastTimer);
    if (ctx.container) ctx.container.replaceChildren();
    ctx.container = null;
    ctx.root = null;
  }

  TS.menu = { render, update, toast, destroy, trainSvg, routeInfo };
})();
