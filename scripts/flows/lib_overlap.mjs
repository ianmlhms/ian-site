/* Overlap checker for touch layouts (Lokféierer on an iPad, in the arcade iframe or as its own page).
 *
 * scanLayout(page, options) runs ONE function inside the page and returns { vp, atoms, issues }.
 * An "atom" is anything a finger or an eye meets: buttons / links / inputs, elements with their own text, and
 * boxes with a visible background or border (the glass panels). Only the topmost layer counts: while a modal
 * overlay (menu, loading, pause, help, timetable, summary) is open, only that overlay is checked; the HUD under
 * its dimmed backdrop is covered on purpose. In the arcade the page's own fixed chrome (sign-in / save hint,
 * toasts, the d-pad) is checked together with the game frame, in page coordinates.
 *
 * Issue types:
 *   overlap      two atoms (neither contains the other) share more than a hair of area
 *   covered      an interactive atom whose centre or corner is hit by something else (a finger would miss it)
 *   offscreen    an atom sticks out of the visible viewport (and sits in no scroller)
 *   unsafe       an interactive atom lies in the notch / home-indicator band (safe-area inset)
 *   truncated    text cut off by overflow:hidden / ellipsis (information lost)
 *   spill        text that sticks out of its own panel / button
 *   small-target an interactive atom smaller than 44 px in its short side
 *   scroll-lost  a modal card that needs scrolling to reach its buttons (cut off by the screen)
 * Pure measurement: nothing is changed in the page. */

export const MIN_TARGET_PX = 44;

/* Every selector in here is a pure decoration (ticks, dots, glow): it may overlap its parent's other decoration. */
const DEFAULT_IGNORE = [
  '.tl-ticks i', '#leverBar i', '#stripDots i', '#stripDots b', '#stripTrain', '.sig i', '.spinner', '.loadbar i', '#world',
  '#fade', '#walkKnob', '#tlThumb', '.tl-thumb', '#tlTicks', '.ts-menu__heroTrain', '.ts-menu__heroTrain *', '.ts-menu__rails',
].join(',');

/* Pairs that are meant to sit on each other. [a, b] selectors: an atom matching a overlapping an atom matching b is fine. */
const DEFAULT_ALLOWED = [];

/* Runs in the page. Keep it self-contained (no outer references): Playwright serialises it. */
function inPageScan(cfg) {
  const MIN = cfg.minTarget, PAIR_TOL = 1.5;
  const issues = [];
  const seen = new Set();
  const push = (type, a, b, detail) => {
    const key = type + '|' + a + '|' + (b || '');
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ type, a, b: b || null, detail: detail || '' });
  };
  const topDoc = document;
  const topVp = { w: innerWidth, h: innerHeight };
  const overlay = topDoc.getElementById('overlay');
  const gf = topDoc.getElementById('gf');
  const inArcade = !!(gf && overlay && getComputedStyle(overlay).display !== 'none' && gf.contentDocument && gf.contentDocument.getElementById('hud'));
  const gameDoc = inArcade ? gf.contentDocument : topDoc;
  const gfRect = inArcade ? gf.getBoundingClientRect() : { left: 0, top: 0, width: topVp.w, height: topVp.h };
  const off = { x: inArcade ? gfRect.left : 0, y: inArcade ? gfRect.top : 0 };

  const describe = (el) => {
    if (!el) return '?';
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue.trim()).join(' ').replace(/\s+/g, ' ').slice(0, 26);
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return (id || el.tagName.toLowerCase() + cls) + (own ? ' "' + own + '"' : '');
  };

  const isInteractive = (el, cs) => {
    if (el.matches('button,a[href],input,select,textarea,summary,[role="button"],[role="slider"],[role="radio"],[role="tab"],[role="switch"],.chipbtn,.tbtn,.walkpad,.tl-rail')) return true;
    return false;
  };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return 0; const p = m[1].split(',').map((x) => parseFloat(x)); return p.length > 3 ? p[3] : 1; };
  const isPanel = (cs, r) => {
    if (r.width * r.height < 300) return false;
    if (alpha(cs.backgroundColor) > 0.04 || cs.backgroundImage !== 'none') return true;
    if (cs.backdropFilter && cs.backdropFilter !== 'none') return true;
    return parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > 0.04;
  };

  /* clip box from ancestors that cut their content; "scroller" = one that scrolls */
  const clipOf = (el, doc, win) => {
    let clip = null, scroller = false;
    for (let p = el.parentElement; p && p !== doc.documentElement; p = p.parentElement) {
      const cs = win.getComputedStyle(p);
      if (cs.position === 'fixed') { /* its containing block is the viewport: ancestors above no longer clip */ }
      const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
      if (!clips) continue;
      const r = p.getBoundingClientRect();
      if (p === doc.body || p.id === 'game' || p.id === 'hud') continue;
      const canScroll = (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) || (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1);
      if (canScroll) scroller = true;
      clip = clip ? { left: Math.max(clip.left, r.left), top: Math.max(clip.top, r.top), right: Math.min(clip.right, r.right), bottom: Math.min(clip.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    return { clip, scroller };
  };

  const textRect = (el) => {
    let u = null;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      const rg = el.ownerDocument.createRange();
      rg.selectNodeContents(n);
      for (const q of rg.getClientRects()) {
        if (q.width < 0.5 || q.height < 0.5) continue;
        u = u ? { left: Math.min(u.left, q.left), top: Math.min(u.top, q.top), right: Math.max(u.right, q.right), bottom: Math.max(u.bottom, q.bottom) } : { left: q.left, top: q.top, right: q.right, bottom: q.bottom };
      }
    }
    return u;
  };

  const collect = (doc, win, roots, ox, oy, layer) => {
    const atoms = [];
    const seenEl = new Set();
    for (const root of roots) {
      const list = [root, ...root.querySelectorAll('*')];
      for (const el of list) {
        if (seenEl.has(el)) continue;
        seenEl.add(el);
        if (/^(SCRIPT|STYLE|CANVAS|LINK|META|BR|HEAD|TITLE|NOSCRIPT|OPTION|COL|COLGROUP|TBODY|THEAD|TR)$/.test(el.tagName)) continue;
        if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
        if (cfg.ignore && el.matches(cfg.ignore)) continue;
        if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const cs = win.getComputedStyle(el);
        if (cs.display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const interactive = isInteractive(el, cs);
        const text = ownText(el);
        const panel = isPanel(cs, r);
        if (!interactive && !text && !panel && !/^(IMG|SVG|INPUT)$/i.test(el.tagName)) continue;
        const { clip, scroller } = clipOf(el, doc, win);
        let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        if (text && !interactive && !panel) {   // a block-level label is as wide as its parent: what counts is where its text really is
          const tr = textRect(el);
          if (tr) box = { left: Math.max(box.left, tr.left), top: Math.max(box.top, tr.top), right: Math.min(box.right, tr.right), bottom: Math.min(box.bottom, tr.bottom) };
        }
        let vis = { ...box };
        if (clip) vis = { left: Math.max(vis.left, clip.left), top: Math.max(vis.top, clip.top), right: Math.min(vis.right, clip.right), bottom: Math.min(vis.bottom, clip.bottom) };
        if (vis.right - vis.left < 0.5 || vis.bottom - vis.top < 0.5) continue;   // scrolled out of its container
        atoms.push({
          el, doc, win, layer, name: describe(el), interactive, text, panel, scroller, cs,
          r: { left: box.left + ox, top: box.top + oy, right: box.right + ox, bottom: box.bottom + oy },
          v: { left: vis.left + ox, top: vis.top + oy, right: vis.right + ox, bottom: vis.bottom + oy },
          ox, oy,
        });
      }
    }
    return atoms;
  };

  /* --- which roots count --- */
  const gameRoots = [];
  const overlays = [...gameDoc.querySelectorAll('.overlay')].filter((o) => !o.hidden && getComputedStyle(o).display !== 'none');
  let modal = null;
  for (const o of overlays) {
    const z = parseInt(getComputedStyle(o).zIndex, 10) || 0;
    if (!modal || z >= modal.z) modal = { el: o, z };
  }
  const wxPop = gameDoc.getElementById('wxPop');
  if (modal) {
    gameRoots.push(modal.el);
  } else if (wxPop && !wxPop.hidden) {
    gameRoots.push(wxPop, gameDoc.getElementById('btnWx'));
    // an overlay that is only a sheet behind the HUD (none today) would be listed here
  } else {
    for (const sel of ['#hud', '#toasts', '#banner']) { const e = gameDoc.querySelector(sel); if (e && !e.hidden) gameRoots.push(e); }
  }
  // standalone page: the arcade bar and the fixed chrome live in the same document
  const chromeRoots = [];
  const addChrome = (doc) => {
    for (const sel of ['.arcade-bar', '.arcade-context']) { const e = doc.querySelector(sel); if (e) chromeRoots.push({ el: e, doc }); }
    for (const e of doc.querySelectorAll('body *')) {
      const cs = getComputedStyle(e);
      if (cs.position !== 'fixed') continue;
      if (e === overlay || e === gf || (overlay && overlay.contains(e) && !inArcade)) continue;
      if (overlay && (e === overlay)) continue;
      if (e.closest('#world')) continue;
      chromeRoots.push({ el: e, doc });
    }
  };
  addChrome(topDoc);
  if (!inArcade) { /* game doc === top doc, game roots already include #hud etc. */ }

  let atoms = collect(gameDoc, inArcade ? gf.contentWindow : window, gameRoots, off.x, off.y, 'game');
  if (inArcade) {
    // chrome of the arcade page: only what is really in front (hit test) and not part of the overlay itself
    const chromeAtoms = [];
    for (const c of chromeRoots) {
      if (overlay && overlay.contains(c.el)) { if (c.el.id !== 'tc' && !c.el.closest('#tc')) continue; }
      const sub = collect(topDoc, window, [c.el], 0, 0, 'chrome');
      for (const a of sub) {
        const cx = (a.v.left + a.v.right) / 2, cy = (a.v.top + a.v.bottom) / 2;
        const hit = topDoc.elementFromPoint(cx, cy);
        if (hit && (a.el.contains(hit) || hit.contains(a.el))) chromeAtoms.push(a);
      }
    }
    atoms = atoms.concat(chromeAtoms);
  } else {
    for (const c of chromeRoots) {
      if (gameRoots.some((g) => g.contains(c.el) || c.el.contains(g))) continue;
      if (c.el.closest('.overlay')) continue;
      atoms = atoms.concat(collect(topDoc, window, [c.el], 0, 0, 'chrome'));
    }
  }
  // de-duplicate (nested fixed chrome roots collected twice)
  const uniq = new Map();
  for (const a of atoms) if (!uniq.has(a.el)) uniq.set(a.el, a);
  atoms = [...uniq.values()];

  /* --- per atom checks --- */
  const safe = cfg.safe || { t: 0, r: 0, b: 0, l: 0 };
  for (const a of atoms) {
    const { el, name, cs } = a;
    const w = a.r.right - a.r.left, h = a.r.bottom - a.r.top;
    const clipByScreen = a.r.left < -0.5 || a.r.top < -0.5 || a.r.right > topVp.w + 0.5 || a.r.bottom > topVp.h + 0.5;
    if (!a.scroller && clipByScreen) push('offscreen', name, null, `[${Math.round(a.r.left)},${Math.round(a.r.top)},${Math.round(a.r.right)},${Math.round(a.r.bottom)}] in ${topVp.w}x${topVp.h}`);
    if (a.interactive) {
      if (Math.min(w, h) < MIN - 0.5 && !a.cfgSmallOk) push('small-target', name, null, `${Math.round(w)}x${Math.round(h)}`);
      if (!a.scroller && (a.r.left < safe.l - 0.5 || a.r.top < safe.t - 0.5 || a.r.right > topVp.w - safe.r + 0.5 || a.r.bottom > topVp.h - safe.b + 0.5) && !clipByScreen) {
        push('unsafe', name, null, `safe band t${safe.t} r${safe.r} b${safe.b} l${safe.l}: [${Math.round(a.r.left)},${Math.round(a.r.top)},${Math.round(a.r.right)},${Math.round(a.r.bottom)}]`);
      }
      // hit test: centre + four inset corners must reach this element (or something inside / around it)
      const pts = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];   // inside a circle too
      for (const [fx, fy] of pts) {
        const ax = a.v.left + (a.v.right - a.v.left) * fx, ay = a.v.top + (a.v.bottom - a.v.top) * fy;
        if (ax < 0 || ay < 0 || ax >= topVp.w || ay >= topVp.h) continue;
        let hit = null;
        if (inArcade && a.layer === 'game') {
          const th = topDoc.elementFromPoint(ax, ay);
          if (th && th !== gf) { hit = th; }
          else hit = a.doc.elementFromPoint(ax - a.ox, ay - a.oy);
        } else hit = a.doc.elementFromPoint(ax - a.ox, ay - a.oy);
        if (hit && !(el.contains(hit) || hit.contains(el))) { push('covered', name, describe(hit), `at ${Math.round(ax)},${Math.round(ay)}`); break; }
      }
    }
    if (a.text) {
      const trunc = (/(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) || (/(hidden|clip)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1);
      if (trunc) push('truncated', name, null, `scroll ${el.scrollWidth}x${el.scrollHeight} > box ${el.clientWidth}x${el.clientHeight}`);
      const tr = textRect(el);
      if (tr) {
        const host = el.closest('.glass,.card,.loadcard,button,.toast,.pill,.chip,.depbadge,.guide,.hint,[class*="__"]') || el;
        const hr = host.getBoundingClientRect();
        const tolX = 1.5, tolY = Math.max(1.5, parseFloat(cs.fontSize) * 0.25);   // line boxes of tight line-heights stick out of their box a little
        if (tr.left < hr.left - tolX || tr.right > hr.right + tolX || tr.top < hr.top - tolY || tr.bottom > hr.bottom + tolY) {
          const hs = win_cs(host);
          if (!/(auto|scroll)/.test(hs.overflowY)) push('spill', name, describe(host), `text [${Math.round(tr.left)},${Math.round(tr.top)},${Math.round(tr.right)},${Math.round(tr.bottom)}] box [${Math.round(hr.left)},${Math.round(hr.top)},${Math.round(hr.right)},${Math.round(hr.bottom)}]`);
        }
      }
    }
  }
  function win_cs(e) { return e.ownerDocument.defaultView.getComputedStyle(e); }

  /* --- pairs --- */
  const allowed = cfg.allowed || [];
  const isAllowed = (x, y) => allowed.some(([s1, s2]) => (x.el.matches(s1) && y.el.matches(s2)) || (x.el.matches(s2) && y.el.matches(s1)));
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const x = atoms[i], y = atoms[j];
      if (x.doc === y.doc && (x.el.contains(y.el) || y.el.contains(x.el))) continue;
      const ix = Math.min(x.v.right, y.v.right) - Math.max(x.v.left, y.v.left);
      const iy = Math.min(x.v.bottom, y.v.bottom) - Math.max(x.v.top, y.v.top);
      if (ix <= PAIR_TOL || iy <= PAIR_TOL) continue;
      if (isAllowed(x, y)) continue;
      push('overlap', x.name, y.name, `${Math.round(ix)}x${Math.round(iy)} px`);
    }
  }

  /* --- a modal card must not hide its buttons behind a scroll --- */
  if (modal) {
    const cards = modal.el.querySelectorAll('.card,.loadcard');
    for (const c of cards) {
      if (c.scrollHeight > c.clientHeight + 2) {
        push('scroll-lost', describe(modal.el), describe(c), `content ${c.scrollHeight}px in ${c.clientHeight}px`);
      }
    }
  }

  return { vp: topVp, layer: modal ? modal.el.id || 'overlay' : 'hud', inArcade, atoms: atoms.length, issues };
}

/* page: Playwright Page (main frame). options: { safe, ignore, allowed, minTarget } */
export async function scanLayout(page, options = {}) {
  const cfg = {
    minTarget: options.minTarget ?? MIN_TARGET_PX,
    safe: options.safe || { t: 0, r: 0, b: 0, l: 0 },
    ignore: [DEFAULT_IGNORE, options.ignore].filter(Boolean).join(','),
    allowed: [...DEFAULT_ALLOWED, ...(options.allowed || [])],
  };
  return page.evaluate(inPageScan, cfg);
}

export const issueKey = (i) => `${i.type}: ${i.a}${i.b ? '  x  ' + i.b : ''}${i.detail ? '  (' + i.detail + ')' : ''}`;
