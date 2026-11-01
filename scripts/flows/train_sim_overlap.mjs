/* Lokféierer (Zuch + Tram Sim) on an iPad: NOTHING may overlap (Ian, 31 Oct 2026: "on the ipad with all the touch elements check that nothing is overlapping").
 *
 * Boots the game as touch devices do (hasTouch + isMobile) in the arcade iframe (pixelbreak.html?g=train-sim / tram-sim)
 * and as its own page (pb/train-sim.html?career=rail|tram), then walks through every screen the player meets:
 * menu, loading, the running HUD in each camera (stress-filled with the longest strings: toasts, exchange counts, guide,
 * reverse and parking lamps, banner), weather popover, pause, help, timetable, summary, the resume card, endless.
 * Every state is measured on every iPad size (10.2", Air 11", mini, Pro 13", both orientations, with and without the
 * Safari toolbar taking ~90 px) in every language, with the notch / home-indicator safe areas faked (see lib_overlap.mjs
 * for what is checked): overlaps, covered buttons, off-screen / unsafe-band elements, cut-off or spilling text, targets < 44 px.
 *
 *   node scripts/flows/train_sim_overlap.mjs                 # the quick matrix (what run_all runs)
 *   OVERLAP_FULL=1 node scripts/flows/train_sim_overlap.mjs  # every device x orientation x toolbar x language x mode x career
 *   OVERLAP_ONLY=arcade-tram,standalone-rail  OVERLAP_STATES=menu,cab  OVERLAP_LANGS=de  OVERLAP_SIZES=ipad-mini   # slices
 *   OVERLAP_REPORT_DIR=/path   JSON report (default ~/Library/Caches/website-overnight/shots/zuchreal/w5/touch for the full run); OVERLAP_SHOTS=all = a screenshot of every case, else only failing cases
 * Supabase is mocked; no real account. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runIfMain } from './lib.mjs';
import { S, waitState } from './train_sim.mjs';
import { scanLayout, issueKey } from './lib_overlap.mjs';

const FULL = process.env.OVERLAP_FULL === '1';
/* reports and screenshots stay on the local disk (never in OneDrive) */
const LOCAL_OUT = path.join(os.homedir(), 'Library/Caches/website-overnight/shots/zuchreal/w5/touch');
const csv = (name) => (process.env[name] ? process.env[name].split(',').map((x) => x.trim()).filter(Boolean) : null);

/* CSS px of the iPad Safari / web-app viewport (portrait w x h) */
const DEVICES = [
  { id: 'ipad-10.2', w: 810, h: 1080 },
  { id: 'ipad-air-11', w: 820, h: 1180 },
  { id: 'ipad-mini', w: 744, h: 1133 },
  { id: 'ipad-pro-13', w: 1032, h: 1376 },
];
const TOOLBAR_PX = 90;
const TIGHT_FOR_OTHER_LANGS = ['ipad-mini-', 'ipad-10.2-'];   // Safari's bottom bar / tab strip: the visible height shrinks by roughly this much
/* env(safe-area-inset-*): iPad status bar + home indicator; the "notch" set is a phone-like worst case to prove the CSS honours all four sides */
const SAFE_IPAD = { t: 24, r: 0, b: 20, l: 0 };
const SAFE_NOTCH = { t: 47, r: 47, b: 34, l: 47 };

/* the quick matrix (run_all): the tightest iPad of each shape; OVERLAP_FULL=1 adds every device, orientation, toolbar and the notch sets */
const QUICK_SIZES = ['ipad-mini-portrait-toolbar', 'ipad-mini-landscape-toolbar', 'ipad-10.2-portrait', 'ipad-10.2-landscape-toolbar', 'ipad-air-11-landscape', 'ipad-pro-13-portrait'];
function sizeList() {
  const only = csv('OVERLAP_SIZES');
  const out = [];
  for (const d of DEVICES) {
    for (const orient of ['portrait', 'landscape']) {
      const [w, h] = orient === 'portrait' ? [d.w, d.h] : [d.h, d.w];
      out.push({ id: `${d.id}-${orient}`, w, h, safe: SAFE_IPAD, tag: 'full' });
      out.push({ id: `${d.id}-${orient}-toolbar`, w, h: h - TOOLBAR_PX, safe: SAFE_IPAD, tag: 'toolbar' });   // Safari's bar takes ~90 px of the height
    }
  }
  for (const d of DEVICES.filter((x) => x.id === 'ipad-mini' || x.id === 'ipad-10.2')) {
    out.push({ id: `${d.id}-portrait-notch`, w: d.w, h: d.h - TOOLBAR_PX, safe: SAFE_NOTCH, tag: 'notch' });
    out.push({ id: `${d.id}-landscape-notch`, w: d.h, h: d.w - TOOLBAR_PX, safe: SAFE_NOTCH, tag: 'notch' });
  }
  if (only) return out.filter((s) => only.some((o) => s.id.includes(o)));
  return FULL ? out : out.filter((s) => QUICK_SIZES.includes(s.id));
}

/* ---------------------------------------------------------------- safe areas */
/* env(safe-area-inset-*) cannot be faked from outside, so the served CSS / JS / HTML is rewritten to read custom properties instead */
const ENV_RE = /env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^)]*)?\)/g;
const ENV_VAR = { top: '--ts-sat', right: '--ts-sar', bottom: '--ts-sab', left: '--ts-sal' };
async function fakeSafeAreas(context) {
  await context.route(/\/(pixelbreak\.html|pixelbreak-records\.js|pb\/[^?]*\.(css|js|html))(\?|$)/, async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    body = body.replace(ENV_RE, (_m, side) => `var(${ENV_VAR[side]},0px)`);
    await route.fulfill({ response, body });
  });
}
/* The page gets the full insets; the game frame only the part of them it really touches (the arcade bar below the status bar owns the top inset,
   the iframe still reaches the home-indicator band at the bottom). */
async function setSafe(h, safe) {
  const apply = (s) => { const r = document.documentElement.style; r.setProperty('--ts-sat', s.t + 'px'); r.setProperty('--ts-sar', s.r + 'px'); r.setProperty('--ts-sab', s.b + 'px'); r.setProperty('--ts-sal', s.l + 'px'); };
  await h.page.evaluate(apply, safe);
  await h.page.evaluate(() => window.dispatchEvent(new Event('resize')));   // the arcade measures the sign-in hint on resize: let it see the new insets
  const gf = await h.page.evaluate(() => { const g = document.getElementById('gf'); if (!g || getComputedStyle(document.getElementById('overlay')).display === 'none') return null; const r = g.getBoundingClientRect(); return { top: r.top, bottom: innerHeight - r.bottom, left: r.left, right: innerWidth - r.right }; });
  for (const f of h.page.frames()) {
    if (f === h.page.mainFrame()) continue;
    const inner = gf ? { t: Math.max(0, safe.t - gf.top), b: Math.max(0, safe.b - gf.bottom), l: Math.max(0, safe.l - gf.left), r: Math.max(0, safe.r - gf.right) } : safe;
    await f.evaluate(apply, inner).catch(() => {});
  }
}

/* ---------------------------------------------------------------- booting */
async function open(h, mode, career, lang) {
  if (mode !== 'arcade' || process.env.OVERLAP_SIGNED === '1') await h.signIn();   // arcade: signed out, so the sign-in / save hint sits at the bottom like on a fresh iPad
  await h.page.goto(h.origin + '/pb/lock.js', { waitUntil: 'domcontentloaded' });   // any page of the origin: localStorage is per origin
  await h.page.evaluate((l) => { try { localStorage.setItem('site_lang', l); } catch (_) { /* ignore */ } }, lang);
  const url = mode === 'arcade' ? `/pixelbreak.html?g=${career === 'tram' ? 'tram-sim' : 'train-sim'}&test=1` : `/pb/train-sim.html?career=${career}&test=1`;
  await h.goto(url);
  let frame;
  if (mode === 'arcade') {
    await h.page.waitForFunction(() => document.getElementById('gf')?.contentWindow?.__tsTest, null, { timeout: 40000 });
    frame = h.page.frames().find((f) => f.parentFrame());
  } else {
    await h.page.waitForFunction(() => window.__tsTest, null, { timeout: 40000 });
    frame = h.page.mainFrame();
  }
  await frame.waitForFunction(() => window.__tsTest.state().phase === 'menu' && !document.getElementById('bootStatus').textContent, null, { timeout: 90000 });
  await frame.evaluate(() => { __tsTest.setSeed(20261031); __tsTest.setCalm(true); });
  return frame;
}

/* ---------------------------------------------------------------- staging (all inside the game frame) */
const freeze = (frame) => frame.evaluate(() => {   // HUD text is rewritten every tick: pause (no overlay) so the stress content stays put
  const paused = __tsTest.state().paused;
  if (!paused) document.getElementById('btnPause').click();
  document.getElementById('pauseScreen').hidden = true;
});
const unfreeze = (frame) => frame.evaluate(() => { if (__tsTest.state().paused) document.getElementById('resume').click(); document.querySelectorAll('#toasts .toast,#banner').forEach((e) => { if (e.id === 'banner') e.hidden = true; else e.remove(); }); });

/* the longest real strings of the running language: toasts (ev*), coach hints, guide texts, loading lines */
async function stressFill(frame, { camera }) {
  await frame.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    const copy = TS.copy[TS.lang] || TS.copy.lb;
    const longest = (re, n = 1) => Object.keys(copy).filter((k) => re.test(k) && typeof copy[k] === 'string').sort((a, b) => copy[b].length - copy[a].length).slice(0, n).map((k) => copy[k].replace(/\{\w+\}/g, '88'));
    const st = __tsTest.state();
    const names = st.stations.map((s) => String(s.name));
    $('nextName').textContent = names.sort((a, b) => b.length - a.length)[0] || '–';
    $('nextDist').textContent = '12,8 km';
    $('nextSide').textContent = TS.t('platformShort') + ' ' + TS.t('sideRight'); $('nextSide').className = 'chip right';
    $('sched').hidden = false;
    $('schedArrT').textContent = '17:16:15'; $('schedDepT').textContent = '17:18:45';
    const dep = $('depBadge'); dep.hidden = false; dep.className = 'depbadge late';
    dep.innerHTML = '<small></small><b></b>'; dep.querySelector('small').textContent = names[0] + ' · 17:16:15'; dep.querySelector('b').textContent = TS.t('hudDepLate', { t: '12:08' });
    $('clock').textContent = '23:59'; $('clockSec').textContent = ':59'; $('delay').textContent = '+12:08'; $('delay').className = 'delay late';
    $('delayWord').textContent = TS.t('hudDelay'); $('delayWord').className = 'delayword late';
    $('onboard').textContent = '888'; $('cashHud').textContent = '88 888 888';
    $('svcLabel').textContent = TS.t('endlessLine', { n: 88, total: 88 }) + ' · ' + (names[0] || '') + ' – ' + (names[names.length - 1] || '') + ' · RB';
    $('speedNum').textContent = '888'; $('limitSign').textContent = '888'; $('nextLimit').textContent = '⚠ 888 · 88,8 km';
    $('doorState').textContent = TS.t('hudDoorsReleased');
    $('sigText').replaceChildren(Object.assign(document.createElement('b'), { textContent: TS.t('hudSignalYellow') }), document.createTextNode('88,8 km'));
    const x = $('xchg'); x.hidden = false;
    $('xchgOut').textContent = '↓ ' + TS.t('exchangeOut') + ' 88/88'; $('xchgIn').textContent = '↑ ' + TS.t('exchangeIn') + ' 88/88'; $('xchgOn').textContent = TS.t('hudOnBoard', { n: 888 });
    $('revLamp').hidden = false;
    const pk = $('parkLamp'); pk.hidden = false; pk.textContent = 'B · ' + TS.t('hudParking');
    const g = $('guide'); g.hidden = false; g.className = 'guide late'; g.textContent = TS.t('guideLate');
    $('hint').innerHTML = longest(/^coach.*T$|^coach/, 1)[0] || ''; $('hint').classList.add('coach');
    $('centerBox').classList.remove('empty');
    const al = $('aheadLoad'); al.hidden = false; al.textContent = TS.t('loadingAhead', { n: 88, pct: 88 });
    const toasts = $('toasts'); toasts.replaceChildren();
    longest(/^ev/, 2).forEach((txt, i) => { const d = document.createElement('div'); d.className = 'toast ' + ['bad', 'info', 'good'][i % 3]; d.textContent = txt; toasts.appendChild(d); });
    const b = $('banner'); b.hidden = false; b.innerHTML = '<span></span><small></small>'; b.firstChild.textContent = longest(/^evTerminus|^evSpad|^evOverrun/, 1)[0]; b.querySelector('small').textContent = longest(/^evSpadEmergency|^evOverrunInfo/, 1)[0];
  });
  if (camera === 'platform') await frame.evaluate(() => { const c = document.getElementById('camHint'); c.hidden = false; c.textContent = TS.t('camHint3'); });
}
async function showLoading(frame) {
  await frame.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    const copy = TS.copy[TS.lang] || TS.copy.lb;
    const longest = (re) => Object.keys(copy).filter((k) => re.test(k) && typeof copy[k] === 'string').sort((a, b) => copy[b].length - copy[a].length)[0];
    $('loadingTitle').textContent = copy[longest(/^loading/)].replace(/\{\w+\}/g, '88');
    $('loadingSub').textContent = copy[longest(/^loading/)].replace(/\{\w+\}/g, '88') + ' · 88,8 MB';
    $('loadFill').style.width = '60%';
    $('loading').hidden = false;
  });
}
const hideLoading = (frame) => frame.evaluate(() => { document.getElementById('loading').hidden = true; });

/* ---------------------------------------------------------------- the sweep */
export async function runOverlapMatrix(h, opts = {}) {
  const only = csv('OVERLAP_ONLY');
  const wantStates = csv('OVERLAP_STATES');
  const langs = csv('OVERLAP_LANGS') || (FULL ? ['lb', 'de', 'en'] : ['de']);
  const sizes = sizeList();
  const reportDir = process.env.OVERLAP_REPORT_DIR || (FULL ? LOCAL_OUT : null);
  const shotAll = process.env.OVERLAP_SHOTS === 'all';
  const cases = [];
  const results = { cases: 0, issues: 0, byType: {} };
  await fakeSafeAreas(h.context);

  async function check(ctx, state, frame) {
    for (const size of sizes) {
      if (FULL && ctx.lang !== 'de' && !TIGHT_FOR_OTHER_LANGS.some((t) => size.id.startsWith(t))) continue;   // the long German strings are tested everywhere, lb / en on the tightest iPads
      await h.page.setViewportSize({ width: size.w, height: size.h });
      await h.pause(280);
      await setSafe(h, size.safe);
      await h.pause(60);
      const scan = await scanLayout(h.page, { safe: size.safe });
      const id = [ctx.mode, ctx.career, ctx.lang, state, size.id].join(' | ');
      cases.push({ id, atoms: scan.atoms, layer: scan.layer, issues: scan.issues });
      results.cases += 1;
      results.issues += scan.issues.length;
      scan.issues.forEach((i) => { results.byType[i.type] = (results.byType[i.type] || 0) + 1; });
      if (scan.issues.length) {
        console.log(`    FAIL ${id}: ${scan.issues.length} problem(s)`);
        scan.issues.slice(0, 8).forEach((i) => console.log('         ' + issueKey(i)));
        h.failures.push(`${id}: ${scan.issues.length} layout problem(s), first: ${issueKey(scan.issues[0])}`);
      }
      if (shotAll || scan.issues.length) {
        const dir = reportDir || process.env.FLOW_SHOTS_DIR || LOCAL_OUT;
        if (dir) {
          fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
          await h.page.screenshot({ path: path.join(dir, 'shots', id.replace(/[ |]+/g, '_') + (scan.issues.length ? '.FAIL' : '') + '.png') }).catch(() => {});
        }
      }
    }
  }
  /* lb / en re-check only the text-heavy states (the German strings are the longest and run through every state) */
  const DENSE_STATES = ['menu', 'cab', 'chase', 'platform', 'wxpop', 'timetable', 'summary', 'resume', 'help'];
  let currentLang = 'de';
  const wants = (name) => (!wantStates || wantStates.some((w) => name.startsWith(w))) && (!FULL || currentLang === 'de' || DENSE_STATES.some((d) => name.startsWith(d)));

  const combos = [];
  for (const mode of ['arcade', 'standalone']) for (const career of ['rail', 'tram']) combos.push({ mode, career });
  for (const combo of combos) {
    if (only && !only.includes(`${combo.mode}-${combo.career}`)) continue;
    for (const lang of langs) {
      const ctx = { ...combo, lang };
      currentLang = lang;
      h.step(`${ctx.mode} / ${ctx.career} / ${lang}: ${sizes.length} sizes per state`);
      await h.page.setViewportSize({ width: 820, height: 1180 });
      const frame = await open(h, ctx.mode, ctx.career, lang);
      const hasCam = async () => (await S(frame)).camMode;
      if (wants('menu')) { await check(ctx, 'menu', frame); }
      // start the career service
      await h.page.setViewportSize({ width: 820, height: 1180 });
      await frame.locator('[data-test="mode-career"]').click();
      await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 150000);
      await waitState(frame, () => window.__tsTest.cabSettled(), null, 45000).catch(() => {});
      if (wants('cab')) await check(ctx, 'cab-station', frame);
      const cams = ['cab', 'chase', 'platform', 'orbit'].concat(ctx.career === 'tram' ? ['inside'] : []);
      for (const cam of cams) {
        if (!wants(cam)) continue;
        await frame.evaluate((c) => __tsTest.setCamera(c), cam);
        await h.pause(400);
        await freeze(frame);
        await stressFill(frame, { camera: cam });
        await check(ctx, cam + '-full', frame);
        if (cam === 'cab' || cam === 'chase') {
          if (wants('wxpop')) {
            await frame.evaluate(() => document.getElementById('btnWx').click());
            await h.pause(200);
            await check(ctx, cam + '-wxpop', frame);
            await frame.evaluate(() => document.getElementById('btnWx').click());
          }
        }
        await unfreeze(frame);
      }
      await frame.evaluate(() => __tsTest.setCamera('chase'));
      await h.pause(300);
      if (wants('pause')) {
        await frame.evaluate(() => document.getElementById('btnPause').click()); await h.pause(250);
        await check(ctx, 'pause', frame);
        await frame.evaluate(() => document.getElementById('resume').click());
      }
      if (wants('help')) {
        await frame.evaluate(() => document.getElementById('btnHelp').click()); await h.pause(250);
        await check(ctx, 'help', frame);
        await frame.evaluate(() => document.getElementById('helpClose').click());
      }
      if (wants('timetable')) {
        await frame.evaluate(() => document.getElementById('tbTimetable').click()); await h.pause(250);
        await check(ctx, 'timetable', frame);
        await frame.evaluate(() => document.getElementById('ttClose').click());
      }
      if (wants('loading')) {
        await showLoading(frame);
        await check(ctx, 'loading', frame);
        await hideLoading(frame);
      }
      if (wants('resume')) {   // the resume card of the menu: leave a service half-driven, come back to the menu, check the card, then go on with the service
        await frame.evaluate(() => { __tsTest.teleport(1); __tsTest.saveSnapshot(); __tsTest.toMenu(); });   // a service that has moved on is what the game offers to resume
        await waitState(frame, () => window.__tsTest.state().phase === 'menu', null, 60000);
        await h.pause(700);
        const offered = (await S(frame)).resumeOffer;
        h.expect(offered, `${ctx.mode} / ${ctx.career}: the menu offers the resume card after leaving a service`);
        if (offered) await check(ctx, 'menu-resume', frame);
        if (offered) {
          await h.page.setViewportSize({ width: 820, height: 1180 });
          await frame.evaluate(() => __tsTest.resumeNow());
          await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 150000);
          await waitState(frame, () => window.__tsTest.cabSettled(), null, 45000).catch(() => {});
        } else {
          await frame.locator('[data-test="mode-career"]').click();
          await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 150000);
        }
      }
      if (wants('summary')) {
        await frame.evaluate(() => { __tsTest.saveSnapshot(); __tsTest.finishRoute(); });
        await frame.evaluate(() => __tsTest.completeNow());
        await waitState(frame, () => window.__tsTest.state().phase === 'summary', null, 60000);
        await h.pause(900);
        await check(ctx, 'summary', frame);
        await frame.evaluate(() => document.getElementById('sumMenu').click());
        await waitState(frame, () => window.__tsTest.state().phase === 'menu', null, 60000);
        await h.pause(600);
      } else {
        await frame.evaluate(() => __tsTest.toMenu());
        await waitState(frame, () => window.__tsTest.state().phase === 'menu', null, 60000);
      }
      if (wants('menu-after')) await check(ctx, 'menu-after-service', frame);
      if (wants('endless')) {
        await frame.evaluate(() => __tsTest.start('endless'));
        await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 150000);
        await h.pause(1500);
        await freeze(frame);
        await stressFill(frame, { camera: await hasCam() });
        await check(ctx, 'endless-full', frame);
        await unfreeze(frame);
      }
    }
  }

  if (reportDir) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'overlap-report.json'), JSON.stringify({ at: new Date().toISOString(), full: FULL, sizes: sizes.map((s) => s.id), results, cases }, null, 1));
  }
  console.log(`    matrix: ${results.cases} cases, ${results.issues} problem(s) ${JSON.stringify(results.byType)}`);
  return results;
}

export const flow = {
  name: 'train-sim-overlap', touch: true, fullChromium: true,
  backend: { tables: { game_saves: () => [], scores: () => [] } },
  async run(h) {
    const errors = [];
    h.page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text() + ' @ ' + (m.location().url || '').slice(-60)); });
    const results = await runOverlapMatrix(h);
    h.eq(results.issues, 0, `no overlap, clipped text, covered or undersized control in ${results.cases} cases`);
    h.expect(errors.length === 0, 'no console errors: ' + errors.slice(0, 3).join(' | '));
  },
};

runIfMain(import.meta.url, flow);
