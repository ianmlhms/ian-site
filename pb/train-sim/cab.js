/* Lokféierer: driver's cab interior (TS.cab). Procedural, no assets. Controls are clickable via hitTest().
   cab.group lives in the FRONT car's local frame: x right, y up, forward = -Z, y = 0 at rail top.
   Public: TS.cab.create(trainConfig, { quality }) -> { group, update(state), snap(), dispose(),
     hitTest(raycaster), pickNotch(raycaster), setHover(id|null), getControlWorldPoint(id, notch?), controlIds }
   group.userData: eye (Vector3), eyeLookAt (Vector3), frame { zF, floor, ... }. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;

  const DEG = Math.PI / 180;
  const MFD_INTERVAL_MS = 100;          // MFD canvases redraw at most 10x per second
  const BLINK_PERIOD_MS = 500;          // door-ready buttons blink at 2 Hz
  const LEVER_MIN = -8;
  const LEVER_MAX = 5;
  const NOTCH_EB = -8;
  const LEVER_RATE = 16;                // 1/s smoothing rate of the lever
  const NEEDLE_RATE = 9;                // 1/s smoothing rate of the speedometer needle
  const DESK_FRONT_MIN = 0.35;          // desk front edge: min metres behind the cap plane
  const DESK_DEPTH = 0.6;               // front edge -> rear edge
  const DESK_DROP = 0.08;               // desk surface falls this much over its depth (tilts toward the driver)
  const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const GLASS_OPACITY = 0.14;
  const HOOD_X0 = -0.385;   // tram console fascia: left end (m from the centre line),
  const HOOD_FACE_L = 0.36, HOOD_ALPHA = 55 * DEG;   // length of its face (m, along the slope) and slope
  const SIGN_FONT_SCALE = 0.62;
  const NIGHT_MATTE0 = new THREE.Color('#171a1f'), NIGHT_MATTE1 = new THREE.Color('#2b3544'), NIGHT_METAL0 = new THREE.Color('#0d0f12'), NIGHT_METAL1 = new THREE.Color('#1c2430');
  const NIGHT_MATTE_WARM = new THREE.Color('#2e2e30');   // tram cab at night: the white panelling takes the warm light of the cab lamp
  const NIGHT_DIAL = new THREE.Color('#ffe7c2'), NIGHT_ONE = new THREE.Color(1, 1, 1);
  const HOVER_TINT = '#ffd27a';          // emissive tint of a hovered control
  const HOVER_EMISSIVE = 0.75;           // emissive floor of a hovered control
  const HIT_W = 0.092;                   // width of a button hit box (m), a bit larger than the button + sticker
  const CONTROL_IDS = ['lever', 'doorLeft', 'doorRight', 'horn', 'lights', 'eb', 'parking', 'wipers', 'announce'];

  /* Fallback geometry per model when TS.trains.specs is not there. */
  const FALLBACK = {
    railcar: { frontL: 22.0, floor: 1.05, W: 2.85, windHW: 1.05, windY0: 1.95, windY1: 3.15 },
    emu: { frontL: 25.0, floor: 1.00, W: 2.88, windHW: 0.95, windY0: 1.85, windY1: 3.15 },
    kiss: { frontL: 25.0, floor: 1.00, W: 2.80, windHW: 0.95, windY0: 1.85, windY1: 3.15 },
    tram: { frontL: 8.8, floor: 0.62, W: 2.40, windHW: 0.95, windY0: 1.40, windY1: 2.75 },
    ic: { frontL: 19.0, floor: 1.35, W: 3.0, windHW: 0.98, windY0: 2.2, windY1: 3.5 },
    hst: { frontL: 22.0, floor: 1.45, W: 2.9, windHW: 0.82, windY0: 2.3, windY1: 3.35 },
  };

  /* Per-type look and layout. x positions are on the desk (m), hw = desk half width. */
  const STYLES = {
    railcar: {
      old: true, hw: 0.80, top: '#4c3f2e', body: '#2f3a32', ramp: '#3a4439', metal: '#b69a52', trim: '#2a2824',
      leverX: -0.52, joystick: false, seat: 'old', retro: true,
      dials: [{ kind: 'speedo', x: 0.0, r: 0.1 }, { kind: 'gauge', x: -0.27, r: 0.055, idx: 0 }, { kind: 'gauge', x: 0.26, r: 0.055, idx: 1 }],
      mfds: [{ x: 0.5, w: 0.17, h: 0.125, role: 'main' }],
    },
    emu: {
      hw: 0.85, top: '#7d848c', body: '#3c4148', ramp: '#23272d', metal: '#9aa3ad', trim: '#171a1e', accent: '#c8312b',
      leverX: -0.46, joystick: false, seat: 'modern',
      dials: [{ kind: 'speedo', x: -0.21, r: 0.075 }],
      mfds: [{ x: 0.12, w: 0.34, h: 0.212, role: 'main' }],
    },
    kiss: {
      hw: 0.85, top: '#6f767e', body: '#353a41', ramp: '#1f2328', metal: '#98a1ab', trim: '#15181c', accent: '#1b4f9c',
      leverX: -0.46, joystick: false, seat: 'modern',
      dials: [{ kind: 'speedo', x: -0.2, r: 0.072 }],
      mfds: [{ x: 0.1, w: 0.28, h: 0.18, role: 'main' }],
    },
    tram: {
      hw: 0.8, top: '#33373d', body: '#22252a', ramp: '#14171a', metal: '#aab1b8', trim: '#101215', accent: '#19a9c4',
      leverX: -0.52, joystick: true, seat: 'modern', low: true,
      dials: [{ kind: 'speedo', x: -0.28, r: 0.064, v: 0.2 }],
      mfds: [{ x: -0.065, w: 0.32, h: 0.2, v: 0.205, role: 'main' }, { x: 0.225, w: 0.2, h: 0.125, v: 0.215, role: 'aux' }],
      hood: true,
    },
    ic: {
      hw: 0.92, top: '#555b63', body: '#2c3036', ramp: '#1c1f24', metal: '#929ba5', trim: '#121417', accent: '#e9742c',
      leverX: -0.6, joystick: false, seat: 'modern',
      dials: [{ kind: 'speedo', x: -0.01, r: 0.068 }],
      mfds: [{ x: -0.26, w: 0.26, h: 0.17, role: 'main' }, { x: 0.27, w: 0.26, h: 0.17, role: 'aux' }],
    },
    hst: {
      hw: 1.0, top: '#4a5059', body: '#272b31', ramp: '#1a1d22', metal: '#8d96a0', trim: '#101215', accent: '#2f6fcf',
      leverX: -0.58, joystick: false, seat: 'modern',
      dials: [{ kind: 'speedo', x: 0.0, r: 0.058 }],
      mfds: [{ x: -0.21, w: 0.28, h: 0.19, role: 'main' }, { x: 0.21, w: 0.28, h: 0.19, role: 'aux' }],
    },
  };

  /* Lever geometry per kind: angles in degrees toward the driver (+), per notch step. */
  const LEVER_KINDS = {
    stick: { len: 0.25, pStep: 8, bStep: 6, ebGap: 14, neutral: 3 },
    joystick: { len: 0.22, pStep: 9, bStep: 6.5, ebGap: 12, neutral: 2 },
  };

  const SIGNAL_ORDER = ['red', 'yellow', 'green'];

  /* ---------------------------------------------------------------- small helpers */
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, fallback) => (typeof v === 'number' && isFinite(v) ? v : fallback);
  const pick = (obj, keys, fallback) => {
    if (!obj) return fallback;
    for (const k of keys) if (typeof obj[k] === 'number' && isFinite(obj[k])) return obj[k];
    return fallback;
  };

  const NOSE_FALLBACK = {
    railcar: { yb: 0.6, rake: 0.05, capSx: 0.88 }, emu: { yb: 0.6, rake: 0.2, capSx: 0.78 }, kiss: { yb: 0.6, rake: 0.12, capSx: 0.8 },
    tram: { yb: 0.3, rake: 0.1, capSx: 0.86 }, ic: { yb: 0.75, rake: 0.1, capSx: 0.8 }, hst: { yb: 0.62, rake: 0, capSx: 0.4 },
  };

  /* Geometry of the cab opening: from TS.trains.specs when present, else the fallback tables. */
  function resolveFrame(cfg) {
    const type = STYLES[cfg && cfg.cab] ? cfg.cab : 'emu';
    const fb = FALLBACK[type], nf = NOSE_FALLBACK[type];
    const model = (cfg && (cfg.model || cfg.cab)) || type;
    const specs = TS.trains && TS.trains.specs;
    const raw = specs && specs[model];
    const spec = raw && type === 'ic' && raw.loco ? raw.loco : raw;
    let frontL = fb.frontL;
    try { if (TS.trains && typeof TS.trains.frontCarLength === 'function') frontL = num(TS.trains.frontCarLength(cfg), frontL); } catch (e) { console.warn('[Lokféierer] cab: frontCarLength failed', e); }
    const scr = (spec && spec.scr) || null, nose = (spec && spec.nose) || null;
    const cabFrame = (raw && raw.cabFrame) || (spec && spec.cabFrame) || null;
    return {
      type, frontL,
      floor: pick(spec, ['cabFloor', 'floor'], fb.floor),
      W: pick(spec, ['W'], fb.W),
      windHW: pick(scr, ['hw'], fb.windHW),
      windY0: pick(scr, ['y0'], fb.windY0),
      windY1: pick(scr, ['y1'], fb.windY1),
      yb: pick(spec, ['yb'], nf.yb),
      rake: pick(cabFrame, ['rake'], pick(nose, ['rake'], nf.rake)),
      capSx: pick(cabFrame, ['capSx'], pick(nose, ['capSx'], nf.capSx)),
      twin: !!(scr && scr.kind === 'twin'),
    };
  }

  function colorize(g, hex) {
    const c = new T.Color(hex);
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(a, 3));
    return g;
  }

  /* vertex colours from a top and a bottom colour by height (after the geometry sits in its final place): a cheap painted-plastic shading */
  function colorizeV(g, topHex, botHex) {
    g.computeBoundingBox();
    const y0 = g.boundingBox.min.y, y1 = g.boundingBox.max.y, top = new T.Color(topHex), bot = new T.Color(botHex || topHex), c = new T.Color();
    const pos = g.attributes.position, n = pos.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const k = y1 - y0 > 1e-5 ? (pos.getY(i) - y0) / (y1 - y0) : 1;
      c.copy(bot).lerp(top, k);
      a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new T.BufferAttribute(a, 3));
    return g;
  }

  /* Tiny stand-in for BufferGeometryUtils.mergeGeometries (not in the three core build). */
  function mergeGeos(list) {
    const gs = list.map((g) => (g.index ? g.toNonIndexed() : g));
    let total = 0;
    for (const g of gs) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2), col = new Float32Array(total * 3);
    let o = 0;
    for (const g of gs) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      col.set(g.attributes.color.array, o * 3);
      o += n;
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.BufferAttribute(uv, 2));
    out.setAttribute('color', new T.BufferAttribute(col, 3));
    for (const g of gs) g.dispose();
    for (const g of list) g.dispose();
    return out;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function canvasTexture(canvas, anisotropy) {
    const t = new T.CanvasTexture(canvas);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
    t.minFilter = T.LinearMipmapLinearFilter;
    return t;
  }

  /* ---------------------------------------------------------------- lever angle model */
  function leverAngleDeg(kind, n) {
    const k = LEVER_KINDS[kind];
    const v = clamp(n, LEVER_MIN, LEVER_MAX);
    if (v >= 0) return k.neutral - v * k.pStep;
    if (v >= -7) return k.neutral - v * k.bStep;
    return k.neutral + 7 * k.bStep + (-v - 7) * k.ebGap;
  }

  /* ---------------------------------------------------------------- MFD drawing */
  const PAL_MODERN = { bg: '#0a111e', panel: '#14203a', fg: '#f2f5fa', dim: '#7f8da6', ok: '#35e08a', warn: '#ffc233', bad: '#ff4b4b', blue: '#4fa3ff', line: '#2a3a5c' };
  const PAL_RETRO = { bg: '#040b06', panel: '#0a1c0f', fg: '#9bff9b', dim: '#3f9a45', ok: '#9bff9b', warn: '#ffd24a', bad: '#ff7050', blue: '#9bff9b', line: '#1f5a27' };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function formatDelay(sec) {
    const s = Math.round(Math.abs(sec));
    return (sec < 0 ? '-' : '+') + pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }

  function formatDistance(m) {
    if (!(m >= 0)) return '-- m';
    if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
    if (m < 200) return Math.round(m) + ' m';
    return Math.round(m / 10) * 10 + ' m';
  }

  function fitText(ctx, text, maxW, size, weight) {
    let s = size;
    ctx.font = weight + ' ' + s + 'px ' + FONT;
    while (ctx.measureText(text).width > maxW && s > 12) { s -= 2; ctx.font = weight + ' ' + s + 'px ' + FONT; }
  }

  function drawSignal(ctx, cx, top, aspect, pal, lampR) {
    const gap = lampR * 2.5;
    roundRect(ctx, cx - lampR * 1.4, top - lampR * 0.7, lampR * 2.8, gap * 3 - lampR * 0.2, lampR * 0.8);
    ctx.fillStyle = '#05080e'; ctx.fill();
    ctx.strokeStyle = pal.line; ctx.lineWidth = 3; ctx.stroke();
    const cols = { red: '#ff3b3b', yellow: '#ffc933', green: '#35e08a' };
    SIGNAL_ORDER.forEach((name, i) => {
      const cy = top + lampR + i * gap;
      ctx.beginPath(); ctx.arc(cx, cy, lampR, 0, Math.PI * 2);
      const lit = name === aspect;
      ctx.fillStyle = lit ? cols[name] : '#1a2030';
      if (lit) { ctx.shadowColor = cols[name]; ctx.shadowBlur = 18; }
      ctx.fill(); ctx.shadowBlur = 0;
    });
  }

  function drawDoorIcon(ctx, x, y, w, h, phase, side, pal) {
    const col = phase === 'open' ? pal.warn : phase === 'released' ? pal.warn : pal.ok;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 4;
    roundRect(ctx, x, y, w, h, 5); ctx.stroke();
    const gap = phase === 'open' ? w * 0.34 : phase === 'released' ? w * 0.12 : 0;
    const pw = (w - 8 - gap) / 2;
    ctx.fillRect(x + 4, y + 4, pw, h - 8);
    ctx.fillRect(x + 4 + pw + gap, y + 4, pw, h - 8);
    if (side === 'left' || side === 'right') {
      const dir = side === 'left' ? -1 : 1;
      const ax = x + w / 2 + dir * (w / 2 + 16);
      ctx.beginPath();
      ctx.moveTo(ax + dir * 10, y + h / 2); ctx.lineTo(ax - dir * 8, y + h / 2 - 11); ctx.lineTo(ax - dir * 8, y + h / 2 + 11);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawPowerBar(ctx, x, y, w, h, brake01, power01, pal) {
    ctx.fillStyle = '#0d1424'; roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
    ctx.strokeStyle = pal.line; ctx.lineWidth = 2; ctx.stroke();
    const mid = x + w / 2;
    ctx.fillStyle = pal.bad; ctx.fillRect(mid - (w / 2 - 4) * brake01, y + 4, (w / 2 - 4) * brake01, h - 8);
    ctx.fillStyle = pal.ok; ctx.fillRect(mid, y + 4, (w / 2 - 4) * power01, h - 8);
    ctx.fillStyle = pal.fg; ctx.fillRect(mid - 1.5, y - 3, 3, h + 6);
  }

  function drawMain(ctx, v, pal) {
    ctx.clearRect(0, 0, 512, 320);
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, 512, 320);
    ctx.fillStyle = pal.panel; ctx.fillRect(0, 0, 512, 48);
    ctx.textBaseline = 'alphabetic';
    // clock + delay
    ctx.textAlign = 'left'; ctx.fillStyle = pal.fg; ctx.font = '700 36px ' + FONT;
    ctx.fillText(v.clock, 16, 36);
    ctx.textAlign = 'right';
    const late = v.delay;
    ctx.fillStyle = Math.abs(late) < 60 ? pal.ok : Math.abs(late) < 180 ? pal.warn : pal.bad;
    ctx.font = '700 36px ' + FONT;
    ctx.fillText(formatDelay(late), 496, 36);
    // speed
    ctx.textAlign = 'left'; ctx.fillStyle = v.over ? pal.bad : pal.fg; ctx.font = '700 132px ' + FONT;
    ctx.fillText(String(v.speed), 16, 178);
    ctx.fillStyle = pal.dim; ctx.font = '600 26px ' + FONT; ctx.fillText('km/h', 20, 210);
    // limit sign
    ctx.beginPath(); ctx.arc(320, 118, 54, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.lineWidth = 12; ctx.strokeStyle = '#e0261f'; ctx.stroke();
    ctx.fillStyle = '#10131a'; ctx.textAlign = 'center'; ctx.font = '700 ' + (v.limit >= 100 ? 46 : 54) + 'px ' + FONT;
    ctx.fillText(v.limit > 0 ? String(v.limit) : '--', 320, 136);
    // target
    ctx.beginPath(); ctx.arc(320, 204, 24, 0, Math.PI * 2); ctx.fillStyle = pal.panel; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = pal.blue; ctx.stroke();
    ctx.fillStyle = pal.fg; ctx.font = '700 ' + (v.target >= 100 ? 21 : 25) + 'px ' + FONT;
    ctx.fillText(v.target > 0 ? String(v.target) : '--', 320, 213);
    // signal repeater
    drawSignal(ctx, 448, 62, v.aspect, pal, 19);
    // door icon
    drawDoorIcon(ctx, 396, 206, 58, 34, v.doorPhase, v.doorSide, pal);
    // power / brake
    drawPowerBar(ctx, 16, 232, 330, 22, v.brake01, v.power01, pal);
    // station + distance
    ctx.fillStyle = pal.panel; ctx.fillRect(0, 266, 512, 54);
    ctx.textAlign = 'left'; ctx.fillStyle = pal.fg;
    fitText(ctx, v.station || '--', 290, 36, '700');
    ctx.fillText(v.station || '--', 16, 304);
    ctx.textAlign = 'right'; ctx.fillStyle = pal.warn; ctx.font = '700 40px ' + FONT;
    ctx.fillText(formatDistance(v.dist), 498, 304);
  }

  function drawAux(ctx, v, pal) {
    ctx.clearRect(0, 0, 512, 320);
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, 512, 320);
    ctx.textAlign = 'center'; ctx.fillStyle = pal.fg; ctx.font = '700 120px ' + FONT;
    ctx.fillText(v.clock, 256, 120);
    const late = v.delay;
    ctx.fillStyle = Math.abs(late) < 60 ? pal.ok : Math.abs(late) < 180 ? pal.warn : pal.bad;
    ctx.font = '700 72px ' + FONT; ctx.fillText(formatDelay(late), 256, 205);
    drawSignal(ctx, 62, 100, v.aspect, pal, 17);
    drawDoorIcon(ctx, 400, 118, 70, 42, v.doorPhase, v.doorSide, pal);
    ctx.textAlign = 'left'; ctx.fillStyle = pal.fg; fitText(ctx, v.station || '--', 300, 34, '700');
    ctx.fillText(v.station || '--', 16, 302);
    ctx.textAlign = 'right'; ctx.fillStyle = pal.warn; ctx.font = '700 36px ' + FONT;
    ctx.fillText(formatDistance(v.dist), 498, 302);
    drawPowerBar(ctx, 16, 238, 480, 20, v.brake01, v.power01, pal);
  }

  /* ---------------------------------------------------------------- speedometer face */
  function dialScale(maxKmh) {
    const major = maxKmh <= 100 ? 10 : maxKmh <= 200 ? 20 : 40;
    const minor = major / 2;
    const scaleMax = Math.ceil(maxKmh / major) * major;
    return { major, minor, scaleMax };
  }

  function dialAngle(scale, kmh) { return (-135 + 270 * clamp(kmh / scale.scaleMax, 0, 1.04)) * DEG; }

  function drawDialFace(canvas, scale, old) {
    const s = canvas.width, c = s / 2, R = c * 0.97, ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, s, s);
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fillStyle = old ? '#e9e2c9' : '#0b0d11'; ctx.fill();
    const ink = old ? '#1d1a14' : '#f4f6f8';
    const at = (ang, r) => [c + r * Math.sin(ang), c - r * Math.cos(ang)];
    for (let v = 0; v <= scale.scaleMax + 0.01; v += scale.minor) {
      const ang = (-135 + 270 * v / scale.scaleMax) * DEG;
      const isMajor = Math.abs(v / scale.major - Math.round(v / scale.major)) < 0.01;
      const a = at(ang, R * 0.94), b = at(ang, R * (isMajor ? 0.78 : 0.86));
      ctx.strokeStyle = ink; ctx.lineWidth = s * (isMajor ? 0.018 : 0.01);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      if (isMajor) {
        const p = at(ang, R * 0.6);
        ctx.fillStyle = ink; ctx.font = '700 ' + Math.round(s * (scale.scaleMax >= 300 ? 0.095 : 0.11)) + 'px ' + FONT;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.round(v)), p[0], p[1]);
      }
    }
    ctx.fillStyle = old ? '#4a3d26' : '#9aa5b3'; ctx.font = '700 ' + Math.round(s * 0.075) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('km/h', c, c + R * 0.42);
  }

  function drawGaugeAtlas(canvas, old) {
    const ctx = canvas.getContext('2d'), s = canvas.height;
    ctx.clearRect(0, 0, canvas.width, s);
    const faces = [{ max: 10, major: 2, red: 8 }, { max: 120, major: 20, red: 100 }];
    faces.forEach((f, i) => {
      const c = s / 2, R = c * 0.96, ox = i * s;
      ctx.beginPath(); ctx.arc(ox + c, c, R, 0, Math.PI * 2); ctx.fillStyle = old ? '#e9e2c9' : '#0b0d11'; ctx.fill();
      const ink = old ? '#1d1a14' : '#f4f6f8';
      for (let v = 0; v <= f.max + 0.01; v += f.major / 2) {
        const ang = (-135 + 270 * v / f.max) * DEG, isMajor = Math.abs(v / f.major - Math.round(v / f.major)) < 0.01;
        const a = [ox + c + R * 0.94 * Math.sin(ang), c - R * 0.94 * Math.cos(ang)];
        const b = [ox + c + R * (isMajor ? 0.76 : 0.84) * Math.sin(ang), c - R * (isMajor ? 0.76 : 0.84) * Math.cos(ang)];
        ctx.strokeStyle = v >= f.red ? '#c0281f' : ink; ctx.lineWidth = s * 0.02;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        if (isMajor) {
          ctx.fillStyle = ink; ctx.font = '700 ' + Math.round(s * 0.1) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(Math.round(v)), ox + c + R * 0.58 * Math.sin(ang), c - R * 0.58 * Math.cos(ang));
        }
      }
      ctx.fillStyle = ink; ctx.font = '700 ' + Math.round(s * 0.09) + 'px ' + FONT; ctx.textAlign = 'center';
      ctx.fillText(i === 0 ? 'bar' : '°C', ox + c, c + R * 0.42);
    });
  }

  /* ---------------------------------------------------------------- sticker atlas (key labels) */
  const STICKER_LABELS = ['W/S', 'D', 'H', 'L', 'X', 'B', 'A'];
  const STK = { lever: 0, door: 1, horn: 2, lights: 3, eb: 4, parking: 5, announce: 6 };
  const STICKER_CELL = 128;

  function drawStickerAtlas(canvas, cell) {
    const ctx = canvas.getContext('2d'), k = cell / STICKER_CELL;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    STICKER_LABELS.forEach((label, i) => {
      const x = i * cell;
      roundRect(ctx, x + 4 * k, 18 * k, 120 * k, 92 * k, 18 * k);
      ctx.fillStyle = '#f6f2e6'; ctx.fill();
      ctx.lineWidth = 6 * k; ctx.strokeStyle = '#15171b'; ctx.stroke();
      ctx.fillStyle = '#101216'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 ' + Math.round((label.length > 1 ? 52 : 70) * k) + 'px ' + FONT;
      ctx.fillText(label, x + 64 * k, 66 * k);
    });
  }

  /* ---------------------------------------------------------------- gate plate (notch labels) */
  function notchLabel(n) { return n === NOTCH_EB ? 'EB' : n < 0 ? 'B' + (-n) : n === 0 ? '0' : 'P' + n; }

  function drawGatePlate(canvas, kind, uOf, uMin, uMax) {
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#16181c'; ctx.fillRect(0, 0, w, h);
    const yOf = (n) => ((uOf(n) - uMin) / (uMax - uMin)) * h;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let n = LEVER_MAX; n >= LEVER_MIN; n--) {
      const y = yOf(n);
      const power = n > 0, eb = n === NOTCH_EB, zero = n === 0;
      const col = eb ? '#ff4a3d' : power ? '#4df08f' : zero ? '#ffffff' : '#ffb347';
      ctx.fillStyle = col; ctx.fillRect(w * 0.04, y - 2, w * (zero ? 0.2 : 0.14), 4);
      ctx.font = '800 ' + Math.round(w * (eb ? 0.27 : 0.24)) + 'px ' + FONT;
      ctx.fillText(notchLabel(n), w * 0.34, y);
    }
    ctx.strokeStyle = '#3c4048'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  }

  /* ---------------------------------------------------------------- create */
  function create(trainConfig, opts) {
    const cfg = trainConfig || {};
    const quality = (opts && opts.quality) || 'high';
    const isLow = quality === 'low';
    const fr = resolveFrame(cfg);
    const S = STYLES[fr.type];
    const zF = -fr.frontL / 2;
    const floor = fr.floor;
    const eyeY = floor + 1.22, eyeZ = zF + 1.55;
    const eyeDz = eyeZ - zF;
    const maxKmh = num(cfg.maxKmh, 140);
    const scale = dialScale(maxKmh);
    const aniso = isLow ? 1 : 4;

    const own = { geos: [], mats: [], texs: [] };
    const track = (list, o) => { list.push(o); return o; };
    const geo = (g) => track(own.geos, g);
    const mat = (m) => track(own.mats, m);
    const tex = (t) => track(own.texs, t);

    const group = new T.Group();
    group.name = 'cab';
    const interior = new T.Group();
    interior.name = 'cabInterior';
    group.add(interior);

    /* ---- shared materials: vertex coloured, so a handful of merged meshes cover the whole static cab */
    const matMatte = mat(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05, emissive: '#171a1f' }));
    const matMetal = mat(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.75, emissive: '#0d0f12' }));
    const matGlass = mat(new T.MeshStandardMaterial({ color: '#9fb8c4', roughness: 0.1, metalness: 0.1, transparent: true, opacity: GLASS_OPACITY, depthWrite: false }));
    const matLed = mat(new T.MeshStandardMaterial({ vertexColors: true, color: '#ffffff', emissive: '#fff4dc', emissiveIntensity: 0.25, roughness: 0.5 }));   // cab ceiling LED strip + backlit parts (lit at night)
    const matLens = mat(new T.MeshBasicMaterial({ vertexColors: true, color: '#ffffff', toneMapped: false }));   // coloured button lenses: unlit, brighter when it is dark
    const lampDefs = {
      green: { color: '#1d6a3a', emissive: '#4dff91' }, amber: { color: '#7a5a12', emissive: '#ffbf33' },
      red: { color: '#7a1a14', emissive: '#ff4636' }, blue: { color: '#1b4a8a', emissive: '#5aa8ff' },
      white: { color: '#8a8f94', emissive: '#f4f8ff' },
    };
    const lampMat = (name, intensity) => mat(new T.MeshStandardMaterial({ color: lampDefs[name].color, emissive: lampDefs[name].emissive, emissiveIntensity: intensity, roughness: 0.35, metalness: 0.1 }));

    /* ---- hover highlight: per control id the materials that glow (their own materials, never shared ones) */
    const hoverable = {};
    const hoverFloor = new Map();
    const baseEm = new Map();
    const hoverMat = (id, m, floor) => { (hoverable[id] = hoverable[id] || []).push({ m, floor: floor == null ? HOVER_EMISSIVE : floor }); baseEm.set(m, m.emissiveIntensity); return m; };
    const metalOwn = (id, floor) => hoverMat(id, mat(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.75, emissive: HOVER_TINT, emissiveIntensity: 0 })), floor);

    /* ---- buckets of static geometry */
    const buckets = { matte: [], metal: [], glass: [], sticker: [], lampStatic: [], led: [], lens: [] };
    const addTo = (bucket, g, matrix, hex, hexBottom) => {
      g.applyMatrix4(matrix);
      if (hexBottom) colorizeV(g, hex || '#ffffff', hexBottom); else colorize(g, hex || '#ffffff');
      buckets[bucket].push(g);
    };
    const box = (w, h, d) => new T.BoxGeometry(w, h, d);
    const cyl = (rt, rb, h, seg) => new T.CylinderGeometry(rt, rb, h, seg || 20);
    const compose = (px, py, pz, rx, ry, rz) => new T.Matrix4().compose(
      new T.Vector3(px, py, pz), new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0, 'XYZ')), new T.Vector3(1, 1, 1));
    const boxAt = (bucket, w, h, d, px, py, pz, hex, rx, ry, rz, hexBottom) => addTo(bucket, box(w, h, d), compose(px, py, pz, rx, ry, rz), hex, hexBottom);

    /* ---- desk frame: x right, y out of the desk surface, z toward the driver (u) */
    const deskTilt = Math.atan2(DESK_DROP, DESK_DEPTH);
    const capZ = (y) => zF + fr.rake * (y - fr.yb);                 // raked cap plane (top further back)
    const glassZ0 = capZ(fr.windY0), glassZ1 = capZ(fr.windY1);
    const rakeAng = Math.atan(fr.rake);
    const capHW = fr.W / 2 * fr.capSx;
    const DESK_FRONT_U = Math.max(DESK_FRONT_MIN, capZ(floor + 0.84) - zF + 0.12);

    const hw = Math.max(0.55, Math.min(S.hw, capHW * 0.95 - 0.1, fr.W / 2 - 0.2));
    // y of the sight line eye -> bottom edge of the glass, at u metres behind the desk front edge
    const sightY = (u) => fr.windY0 + (eyeY - fr.windY0) * ((zF + u - glassZ0) / (eyeZ - glassZ0));
    const yFront = Math.min(floor + (S.low ? 0.8 : 0.84), sightY(DESK_FRONT_U) - 0.02);
    const deskY = (u) => yFront - u * (DESK_DROP / DESK_DEPTH);
    // how far behind the desk front edge the desk is still inside the lower frame of a 65 degree view
    const uVisMax = (0.637 * (eyeDz - DESK_FRONT_U) - (eyeY - yFront)) / (DESK_DROP / DESK_DEPTH + 0.637);
    const uVis = uVisMax - 0.045;
    const LK = Math.min(1, uVis / 0.46);
    const deskOrigin = new T.Vector3(0, yFront, zF + DESK_FRONT_U);
    const deskQuat = new T.Quaternion().setFromEuler(new T.Euler(deskTilt, 0, 0, 'XYZ'));
    const deskFrame = new T.Matrix4().compose(deskOrigin, deskQuat, new T.Vector3(1, 1, 1));
    const deskM = (x, u, lift, ry, rx) => deskFrame.clone().multiply(
      compose(x, lift || 0, u, rx || 0, ry || 0, 0));
    const deskBox = (bucket, w, h, d, x, u, hex, lift, ry) => addTo(bucket, box(w, h, d), deskM(x, u, (lift || 0) + h / 2, ry), hex);
    const deskCyl = (bucket, rt, rb, h, x, u, hex, lift, seg) => addTo(bucket, cyl(rt, rb, h, seg), deskM(x, u, (lift || 0) + h / 2), hex);

    /* ---- ramp that carries the instruments (rises away from the driver, below the sight line) */
    const rampBottomU = 0.3 * LK;
    const dials = S.dials, mfds = S.mfds;
    let tallest = 0.15;
    for (const d of dials) tallest = Math.max(tallest, d.r * 2 + 0.02);
    for (const m of mfds) tallest = Math.max(tallest, m.h + 0.03);
    const rampLen = S.hood ? HOOD_FACE_L : tallest;
    let rampAlpha = S.hood ? HOOD_ALPHA : 42 * DEG;
    for (; !S.hood && rampAlpha > 14 * DEG; rampAlpha -= 1 * DEG) {
      const topU = rampBottomU - rampLen * Math.cos(rampAlpha);
      const topY = deskY(rampBottomU) + rampLen * Math.sin(rampAlpha);
      if (topY <= sightY(DESK_FRONT_U + topU) - 0.02) break;
    }
    const rampTopU = rampBottomU - rampLen * Math.cos(rampAlpha);
    const rampTopY = deskY(rampBottomU) + rampLen * Math.sin(rampAlpha);
    const rampBase = new T.Vector3(0, deskY(rampBottomU), zF + DESK_FRONT_U + rampBottomU);
    const panelM = (px, py, pz) => new T.Matrix4().compose(
      rampBase, new T.Quaternion().setFromEuler(new T.Euler(rampAlpha - Math.PI / 2, 0, 0, 'XYZ')), new T.Vector3(1, 1, 1))
      .multiply(compose(px, py, pz || 0));

    /* ---- desk body: extruded (z,y) profiles. Centre block carries the ramp, the wings stay flat. */
    const rearZ = zF + DESK_FRONT_U + DESK_DEPTH;
    const cowlZ = glassZ0 + 0.04, cowlY = fr.windY0 - 0.015;
    let rx0 = hw, rx1 = -hw;
    for (const d of dials) { rx0 = Math.min(rx0, d.x - d.r * 1.12); rx1 = Math.max(rx1, d.x + d.r * 1.12); }
    for (const m of mfds) { rx0 = Math.min(rx0, m.x - m.w / 2 - 0.02); rx1 = Math.max(rx1, m.x + m.w / 2 + 0.02); }
    rx0 = Math.max(rx0 - 0.015, -hw); rx1 = Math.min(rx1 + 0.015, hw);
    if (S.hood) { rx0 = HOOD_X0; rx1 = hw + 0.04; }
    const prismX = (profile, xa, xb, hex) => {
      const shape = new T.Shape();
      profile.forEach((p, i) => (i === 0 ? shape.moveTo(-p[0], p[1]) : shape.lineTo(-p[0], p[1])));
      shape.closePath();
      const g = new T.ExtrudeGeometry(shape, { depth: xb - xa, bevelEnabled: false });
      g.rotateY(Math.PI / 2);
      g.translate(xa, 0, 0);
      addTo('matte', g, new T.Matrix4(), hex);
    };
    const rampProfile = [
      [cowlZ, floor + 0.02], [cowlZ, cowlY], [zF + DESK_FRONT_U + rampTopU, rampTopY],
      [zF + DESK_FRONT_U + rampBottomU, deskY(rampBottomU) - 0.004], [rearZ, deskY(DESK_DEPTH) - 0.004], [rearZ, floor + 0.02],
    ];
    const flatProfile = [
      [cowlZ, floor + 0.02], [cowlZ, cowlY - 0.004], [zF + DESK_FRONT_U, yFront - 0.004], [rearZ, deskY(DESK_DEPTH) - 0.004], [rearZ, floor + 0.02],
    ];
    /* tram console: a lofted fascia (smooth along x, crisp across): tall over the screens, sweeping down toward the right-hand end. Profile ring per x:
       cowl foot, cowl top, top rim front, top rim rear, base of the face, desk rear, desk rear foot. */
    const fasciaL = (x) => {
      const sm = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
      if (x < HOOD_X0 + 0.11) return 0.1 + (HOOD_FACE_L - 0.1) * sm((x - HOOD_X0) / 0.11);
      if (x < 0.2) return HOOD_FACE_L;
      return HOOD_FACE_L - (HOOD_FACE_L - 0.07) * sm((x - 0.2) / (rx1 - 0.2));
    };
    const loftFascia = (hexTop, hexBot) => {
      const N = 40, xs = [];
      for (let i = 0; i <= N; i++) xs.push(rx0 + (rx1 - rx0) * i / N);
      const zFb = zF + DESK_FRONT_U + rampBottomU, yFb = deskY(rampBottomU) - 0.004;
      const ringOf = (x) => {
        const L = fasciaL(x), zT = zFb - L * Math.cos(rampAlpha), yT = yFb + L * Math.sin(rampAlpha);
        const zR = Math.max(capZ(yT) + 0.025, zT - 0.06);
        return [[cowlZ, floor + 0.02], [cowlZ, cowlY], [zR, yT + 0.012], [zT, yT], [zFb, yFb], [rearZ, deskY(DESK_DEPTH) - 0.004], [rearZ, floor + 0.02]];
      };
      const rings = xs.map(ringOf), nv = rings[0].length, pos = [], idx = [];
      for (let e = 0; e < nv; e++) {
        const base = pos.length / 3;
        for (let i = 0; i < xs.length; i++) { const a = rings[i][e], b = rings[i][(e + 1) % nv]; pos.push(xs[i], a[1], a[0], xs[i], b[1], b[0]); }
        for (let i = 0; i < xs.length - 1; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      for (const end of [0, xs.length - 1]) {   // end caps
        const base = pos.length / 3, ring = rings[end];
        ring.forEach((q) => pos.push(xs[end], q[1], q[0]));
        const tris = T.ShapeUtils.triangulateShape(ring.map((q) => new T.Vector2(q[0], q[1])), []);
        for (const [a, b, c] of tris) {
          const ay = ring[a][1], az = ring[a][0], nx = (ring[b][1] - ay) * (ring[c][0] - az) - (ring[b][0] - az) * (ring[c][1] - ay);   // x component of the triangle normal
          if ((nx > 0) === (end === xs.length - 1)) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b);
        }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      addTo('matte', g, new T.Matrix4(), hexTop, hexBot);
    };
    if (S.hood) loftFascia('#363b43', '#191c21'); else prismX(rampProfile, rx0, rx1, S.body);
    const wingXs = [[-hw - 0.04, rx0], [rx1, hw + 0.04]];
    for (const [xa, xb] of wingXs) {
      if (xb - xa < 0.01) continue;
      prismX(flatProfile, xa, xb, S.body);
      deskBox('matte', xb - xa, 0.008, DESK_DEPTH + 0.02, (xa + xb) / 2, DESK_DEPTH / 2 - 0.01, S.top, -0.007);
      // dark cowl strip between the glass and the desk front edge
      const len = Math.hypot(zF + DESK_FRONT_U - cowlZ, yFront - cowlY), ang = Math.atan2(yFront - cowlY, zF + DESK_FRONT_U - cowlZ);
      addTo('matte', box(xb - xa, 0.012, len), compose((xa + xb) / 2, (yFront + cowlY) / 2 + 0.004, (zF + DESK_FRONT_U + cowlZ) / 2, -ang), '#14171a');
    }
    // centre flat top and ramp plate
    deskBox('matte', rx1 - rx0, 0.008, DESK_DEPTH - rampBottomU + 0.02, (rx0 + rx1) / 2, (rampBottomU + DESK_DEPTH) / 2 - 0.01, S.top, -0.007);
    if (!S.hood) addTo('matte', box(rx1 - rx0, rampLen, 0.008), panelM((rx0 + rx1) / 2, rampLen / 2, 0.0), S.ramp);
    if (!S.hood) {
      const z0 = cowlZ, y0 = cowlY, z1 = zF + DESK_FRONT_U + rampTopU, y1 = rampTopY;
      const len = Math.hypot(z1 - z0, y1 - y0), ang = Math.atan2(y1 - y0, z1 - z0);
      addTo('matte', box(rx1 - rx0, 0.012, len), compose((rx0 + rx1) / 2, (y0 + y1) / 2 + 0.004, (z0 + z1) / 2, -ang, 0, 0), '#14171a');
    }
    // front rubber/metal trim along the desk rear edge and a thin chrome nose strip
    deskBox('metal', hw * 2, 0.012, 0.016, 0, DESK_DEPTH - 0.006, S.metal, -0.004);
    deskBox('matte', hw * 2, 0.02, 0.05, 0, DESK_DEPTH + 0.024, S.trim, -0.03);

    /* ---- speedometer dials ------------------------------------------------------------------ */
    const dialCanvasSize = isLow ? 256 : 512;
    const dialFaceTex = tex(canvasTexture(makeCanvas(dialCanvasSize, dialCanvasSize), aniso));
    drawDialFace(dialFaceTex.image, scale, !!S.old);
    const needleParts = [];
    const markerGroups = [];
    let needlePivot = null, limitPivot = null, targetPivot = null;
    const dialFaceMat = mat(new T.MeshBasicMaterial({ map: dialFaceTex, toneMapped: true }));
    const gaugeAtlasTex = tex(canvasTexture(makeCanvas(isLow ? 256 : 512, isLow ? 128 : 256), aniso));
    drawGaugeAtlas(gaugeAtlasTex.image, !!S.old);
    const gaugeFaceMat = mat(new T.MeshBasicMaterial({ map: gaugeAtlasTex }));
    const dialGroup = new T.Group();
    dialGroup.name = 'dials';
    interior.add(dialGroup);
    const bezelHex = S.old ? '#b69a52' : '#20242a';

    for (const d of dials) {
      const cy = d.v != null ? d.v : rampLen / 2;
      const M = panelM(d.x, cy, 0.006);
      // bezel ring + back can
      const ringG = new T.TorusGeometry(d.r * 1.0, d.r * 0.075, 8, isLow ? 20 : 36);
      addTo('metal', ringG, M.clone().multiply(compose(0, 0, d.r * 0.04)), bezelHex);
      addTo('matte', cyl(d.r * 1.05, d.r * 1.05, 0.02, isLow ? 20 : 32).rotateX(Math.PI / 2), M.clone().multiply(compose(0, 0, -0.016)), '#15171a');
      if (d.kind === 'speedo') {
        const face = new T.Mesh(geo(new T.CircleGeometry(d.r * 0.98, isLow ? 24 : 40)), dialFaceMat);
        face.applyMatrix4(M.clone().multiply(compose(0, 0, 0.0)));
        dialGroup.add(face);
        // needle pivot + markers live in the same frame
        const pivotHost = new T.Group();
        pivotHost.applyMatrix4(M.clone().multiply(compose(0, 0, 0.004)));
        dialGroup.add(pivotHost);
        needlePivot = new T.Group(); pivotHost.add(needlePivot);
        const nl = d.r * 0.86;
        needleParts.push(colorize(box(d.r * 0.045, nl, d.r * 0.012).translate(0, nl / 2 - d.r * 0.08, 0.002), S.old ? '#14110c' : '#ff7a1a'));
        needleParts.push(colorize(cyl(d.r * 0.09, d.r * 0.09, d.r * 0.03, 14).rotateX(Math.PI / 2).translate(0, 0, 0.004), '#c8ccd2'));
        const needleMesh = new T.Mesh(geo(mergeGeos(needleParts)), matMetal);
        needlePivot.add(needleMesh);
        // red limit marker (outer rim) and target marker (inner)
        limitPivot = new T.Group(); pivotHost.add(limitPivot);
        const lim = new T.Mesh(geo(new T.PlaneGeometry(d.r * 0.07, d.r * 0.2)), mat(new T.MeshBasicMaterial({ color: '#e0261f' })));
        lim.position.set(0, d.r * 0.88, 0.003); limitPivot.add(lim);
        const limTip = new T.Mesh(geo(new T.CircleGeometry(d.r * 0.07, 3)), lim.material);
        limTip.position.set(0, d.r * 0.74, 0.003); limitPivot.add(limTip);
        targetPivot = new T.Group(); pivotHost.add(targetPivot);
        const tgtShape = new T.Shape(); tgtShape.moveTo(0, d.r * 0.69); tgtShape.lineTo(-d.r * 0.06, d.r * 0.56); tgtShape.lineTo(d.r * 0.06, d.r * 0.56); tgtShape.closePath();
        const tgt = new T.Mesh(geo(new T.ShapeGeometry(tgtShape)), mat(new T.MeshBasicMaterial({ color: '#35c8ff', side: T.DoubleSide })));
        tgt.position.z = 0.003; targetPivot.add(tgt);
        markerGroups.push(limitPivot, targetPivot);
      } else {
        // small static gauge from the atlas
        const g = new T.PlaneGeometry(d.r * 1.96, d.r * 1.96);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, d.idx * 0.5 + uv.getX(i) * 0.5);
        const face = new T.Mesh(geo(g), gaugeFaceMat);
        face.applyMatrix4(M);
        dialGroup.add(face);
        const ang = (d.idx === 0 ? -135 + 270 * 0.52 : -135 + 270 * 0.58) * DEG;
        addTo('metal', box(d.r * 0.04, d.r * 0.82, 0.003), M.clone().multiply(compose(0, 0, 0.003, 0, 0, -ang)).multiply(compose(0, d.r * 0.35, 0)), '#14110c');
      }
    }

    /* ---- MFD screens -------------------------------------------------------------------------- */
    const mfdW = isLow ? 320 : 512;
    const mfdList = [];
    const mfdGroup = new T.Group();
    mfdGroup.name = 'mfd';
    interior.add(mfdGroup);
    for (const m of mfds) {
      const canvas = makeCanvas(mfdW, Math.round(mfdW * 0.625));
      const texture = tex(canvasTexture(canvas, aniso));
      const material = mat(new T.MeshBasicMaterial({ map: texture, toneMapped: false }));
      const M = panelM(m.x, m.v != null ? m.v : rampLen / 2, 0.009);
      const screen = new T.Mesh(geo(new T.PlaneGeometry(m.w, m.h)), material);
      screen.applyMatrix4(M);
      mfdGroup.add(screen);
      addTo('matte', box(m.w + 0.03, m.h + 0.03, 0.02), panelM(m.x, m.v != null ? m.v : rampLen / 2, -0.004), '#0a0b0d');
      addTo('metal', box(m.w + 0.034, 0.004, 0.008), panelM(m.x, (m.v != null ? m.v : rampLen / 2) + (m.h + 0.03) / 2, 0.008), S.metal);
      mfdList.push({ canvas, texture, role: m.role, sig: '' });
    }
    // Urbos console: framed screens + glass sheen + round backlit buttons along the lower edge of the panel + the radio / door-key block on the right
    if (S.hood) {
      const sheenCanvas = makeCanvas(64, 64);
      { const c = sheenCanvas.getContext('2d'); const g = c.createLinearGradient(0, 0, 64, 64); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.35, 'rgba(255,255,255,0.0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.13)'); g.addColorStop(0.62, 'rgba(255,255,255,0.0)'); g.addColorStop(1, 'rgba(255,255,255,0.05)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); }
      const sheenMat = mat(new T.MeshBasicMaterial({ map: tex(canvasTexture(sheenCanvas, 1)), transparent: true, depthWrite: false, toneMapped: false }));
      for (const m of mfds) {
        const fm = panelM(m.x, m.v != null ? m.v : rampLen / 2, 0.0);
        const bw = m.w + 0.03, bh = m.h + 0.03;
        // frame: four bars standing 6 mm proud of the panel, inner lip lighter
        for (const [w, hh, x, y] of [[bw + 0.016, 0.012, 0, bh / 2 + 0.002], [bw + 0.016, 0.012, 0, -bh / 2 - 0.002], [0.012, bh, -bw / 2 - 0.002, 0], [0.012, bh, bw / 2 + 0.002, 0]]) {
          addTo('matte', box(w, hh, 0.014), fm.clone().multiply(compose(x, y, 0.006)), '#191c20', '#101215');
        }
        for (const [w, hh, x, y] of [[m.w + 0.004, 0.003, 0, m.h / 2 + 0.001], [m.w + 0.004, 0.003, 0, -m.h / 2 - 0.001]]) addTo('metal', box(w, hh, 0.004), fm.clone().multiply(compose(x, y, 0.0105)), '#3a4047');
        const sheen = new T.Mesh(geo(new T.PlaneGeometry(m.w, m.h)), sheenMat);
        sheen.applyMatrix4(panelM(m.x, m.v != null ? m.v : rampLen / 2, 0.0105));
        mfdGroup.add(sheen);
      }
      // dial: sheen + a black screw-down bezel ring
      for (const d of dials) {
        const sheen = new T.Mesh(geo(new T.CircleGeometry(d.r * 0.97, 28)), sheenMat);
        sheen.applyMatrix4(panelM(d.x, d.v != null ? d.v : rampLen / 2, 0.0105));
        dialGroup.add(sheen);
        addTo('matte', new T.TorusGeometry(d.r * 1.12, d.r * 0.07, 6, 28), panelM(d.x, d.v != null ? d.v : rampLen / 2, 0.003), '#16181c');
      }
      // round backlit buttons: two short rows under the aux screen + a column at the far left of the panel
      const C = { w: '#e8e6de', g: '#2c9a58', a: '#e8b23a', r: '#d23a2a', b: '#2f6fd0' };
      const rows = [   // x0, v (along the face from its foot), n, dx, colours: a long row under the main screen, a short one under the aux screen, two switch groups on the right wing
        { x0: -0.345, y: 0.042, n: 8, dx: 0.046, cols: [C.w, C.g, C.a, C.r, C.g, C.b, C.a, C.w] },
        { x0: 0.045, y: 0.042, n: 6, dx: 0.046, cols: [C.g, C.r, C.b, C.a, C.w, C.g] },
        { x0: 0.36, y: 0.042, n: 7, dx: 0.062, cols: [C.a, C.w, C.b, C.r, C.g, C.a, C.w] },
        { x0: 0.4, y: 0.09, n: 3, dx: 0.062, cols: [C.b, C.g, C.r] },
      ];
      {   // slim camera / side monitor standing on the right wing of the console, tilted back to the driver
        const mx = 0.63, L = fasciaL(mx), zT = zF + DESK_FRONT_U + rampBottomU - L * Math.cos(rampAlpha), yT = deskY(rampBottomU) + L * Math.sin(rampAlpha), tilt = -0.42;
        const my = yT + 0.1, mz = zT + 0.02;
        boxAt('matte', 0.13, 0.215, 0.035, mx, my, mz, '#14161a', tilt);
        boxAt('matte', 0.05, 0.03, 0.06, mx, yT + 0.01, mz - 0.01, '#14161a');
        const face = compose(mx, my, mz, tilt).multiply(compose(0, 0.004, 0.0185));
        addTo('lens', new T.PlaneGeometry(0.108, 0.17), face, '#1d4a66');
        addTo('lens', new T.PlaneGeometry(0.1, 0.012), face.clone().multiply(compose(0, 0.07, 0.001)), '#8fd4ff');
        addTo('lens', new T.PlaneGeometry(0.06, 0.012), face.clone().multiply(compose(-0.02, 0.045, 0.001)), '#5aa8d8');
        addTo('lens', new T.PlaneGeometry(0.075, 0.07), face.clone().multiply(compose(0, -0.012, 0.001)), '#2b6f8f');
      }
      for (const row of rows) for (let i = 0; i < row.n; i++) {
        const x = row.x0 + i * row.dx, col = row.cols[i];
        addTo('matte', cyl(0.015, 0.016, 0.01, 16).rotateX(Math.PI / 2), panelM(x, row.y, 0.005), '#25282d');
        addTo('lens', cyl(0.0105, 0.0105, 0.008, 16).rotateX(Math.PI / 2), panelM(x, row.y, 0.011), col);
      }
    }

    /* ---- sticker atlas material (key labels) ------------------------------------------------- */
    const cellPx = isLow ? 64 : STICKER_CELL;
    const stickerCanvas = makeCanvas(cellPx * STICKER_LABELS.length, cellPx);
    const stickerTex = tex(canvasTexture(stickerCanvas, aniso));
    drawStickerAtlas(stickerCanvas, cellPx);
    stickerTex.needsUpdate = true;
    const matSticker = mat(new T.MeshStandardMaterial({
      map: stickerTex, emissiveMap: stickerTex, emissive: '#ffffff', emissiveIntensity: 0.38, roughness: 0.6,
      transparent: true, alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, vertexColors: true,
    }));
    const stickerGeo = (cell, w, h) => {
      const g = new T.PlaneGeometry(w, h);
      const uv = g.attributes.uv, n = STICKER_LABELS.length;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (cell + uv.getX(i)) / n);
      return g;
    };
    const STICKER_W = 0.066, STICKER_H = STICKER_W * (92 / 120) * 1.0;
    /* flat sticker on the desk surface, text readable from the driver */
    const deskSticker = (cell, x, u, lift, scaleK) => {
      const k = scaleK || 1;
      const g = stickerGeo(cell, STICKER_W * k, STICKER_W * k * (128 / 120)).rotateX(-Math.PI / 2);
      addTo('sticker', g, deskM(x, u, lift == null ? 0.0025 : lift), '#ffffff');
    };

    /* ---- gate plate + lever -------------------------------------------------------------------- */
    const lk = LEVER_KINDS[S.joystick ? 'joystick' : 'stick'];
    const kindName = S.joystick ? 'joystick' : 'stick';
    const leverU = Math.min(S.joystick ? 0.3 : 0.27, uVis - (S.joystick ? 0.19 : 0.22));
    const leverX = Math.max(S.leverX, -(hw - 0.08));
    const tipU = (n) => leverU + lk.len * Math.sin(leverAngleDeg(kindName, n) * DEG);
    const uMinNotch = tipU(LEVER_MAX), uMaxNotch = tipU(LEVER_MIN);
    const platePad = 0.028;
    const plateU0 = uMinNotch - platePad, plateU1 = uMaxNotch + platePad;
    const plateW = 0.096;
    const plateX = leverX + 0.085;
    const gateCanvas = makeCanvas(isLow ? 96 : 160, Math.round((isLow ? 96 : 160) * (plateU1 - plateU0) / plateW));
    drawGatePlate(gateCanvas, kindName, tipU, plateU0, plateU1);
    const gateTex = tex(canvasTexture(gateCanvas, aniso));
    const gateMat = mat(new T.MeshStandardMaterial({ map: gateTex, emissiveMap: gateTex, emissive: '#ffffff', emissiveIntensity: 0.4, roughness: 0.7 }));
    const gateMesh = new T.Mesh(geo(new T.PlaneGeometry(plateW, plateU1 - plateU0).rotateX(-Math.PI / 2)), gateMat);
    const deskGroup = new T.Group();
    deskGroup.name = 'deskFrame';
    deskGroup.matrixAutoUpdate = false;
    deskGroup.matrix.copy(deskFrame);
    deskGroup.matrixWorldNeedsUpdate = true;
    interior.add(deskGroup);
    gateMesh.position.set(plateX, 0.003, (plateU0 + plateU1) / 2);
    deskGroup.add(gateMesh);
    // slot guide along the lever path + frame of the plate
    deskBox('matte', 0.02, 0.004, plateU1 - plateU0 + 0.02, leverX, (plateU0 + plateU1) / 2, '#050607', 0.0);
    deskBox('metal', plateW + 0.014, 0.006, plateU1 - plateU0 + 0.014, plateX, (plateU0 + plateU1) / 2, S.metal, -0.004);
    // moving amber pointer on the plate (follows the lever)
    const markerMat = mat(new T.MeshStandardMaterial({ color: '#7a5a12', emissive: '#ffbf33', emissiveIntensity: 1.4, roughness: 0.4 }));
    const marker = new T.Mesh(geo(box(0.012, 0.006, 0.012)), markerMat);
    marker.position.set(plateX - plateW / 2 + 0.002, 0.007, tipU(0));
    deskGroup.add(marker);

    // lever mount (boot) static, pivot dynamic
    deskCyl('matte', S.joystick ? 0.045 : 0.034, S.joystick ? 0.05 : 0.04, S.joystick ? 0.03 : 0.022, leverX, leverU, S.trim, 0, 20);
    deskCyl('metal', S.joystick ? 0.034 : 0.026, S.joystick ? 0.034 : 0.026, 0.01, leverX, leverU, S.metal, S.joystick ? 0.03 : 0.022, 20);
    const leverPivot = new T.Group();
    leverPivot.position.set(leverX, S.joystick ? 0.03 : 0.03, leverU);
    deskGroup.add(leverPivot);
    {
      const parts = [];
      const L = lk.len;
      if (S.joystick) {
        // Urbos combined power / brake controller: satin shaft in a ribbed rubber boot, a palm grip with a finger rest, a chrome collar and a thumb pad in the accent colour
        parts.push(colorize(cyl(0.011, 0.014, L - 0.06, 14).translate(0, (L - 0.06) / 2, 0), '#9aa3ad'));
        for (let i = 0; i < 3; i++) parts.push(colorize(cyl(0.03 - i * 0.005, 0.034 - i * 0.005, 0.011, 18).translate(0, 0.008 + i * 0.011, 0), i % 2 ? '#25282c' : '#17191c'));
        parts.push(colorize(cyl(0.02, 0.02, 0.008, 16).translate(0, L - 0.055, 0), '#c8ced4'));
        parts.push(colorize(new T.SphereGeometry(0.032, 20, 14).scale(0.95, 0.8, 1.35).translate(0, L - 0.018, 0.006), '#1b1e23'));
        parts.push(colorize(new T.SphereGeometry(0.014, 12, 8).scale(1, 0.55, 1.4).translate(0, L - 0.018, 0.045), '#2a2e34'));
        parts.push(colorize(cyl(0.012, 0.012, 0.006, 14).translate(0, L + 0.004, -0.004), S.accent));
      } else if (S.old) {
        parts.push(colorize(cyl(0.008, 0.011, L - 0.03, 12).translate(0, (L - 0.03) / 2, 0), '#d6d2c4'));
        parts.push(colorize(new T.SphereGeometry(0.03, 18, 14).translate(0, L, 0), '#16130f'));
        parts.push(colorize(cyl(0.017, 0.017, 0.012, 14).translate(0, L - 0.075, 0), '#b69a52'));
      } else {
        parts.push(colorize(cyl(0.013, 0.016, L - 0.12, 14).translate(0, (L - 0.12) / 2, 0), '#8f98a3'));
        parts.push(colorize(box(0.05, 0.115, 0.042).translate(0, L - 0.06, 0), '#191c21'));
        parts.push(colorize(box(0.052, 0.014, 0.044).translate(0, L - 0.02, 0), S.accent));
        parts.push(colorize(box(0.046, 0.012, 0.038).translate(0, L - 0.115, 0), '#2d3138'));
      }
      leverPivot.add(new T.Mesh(geo(mergeGeos(parts)), metalOwn('lever', 0.16)));
      // W/S sticker on the grip face toward the driver
      const gripY = S.joystick ? L - 0.012 : S.old ? L - 0.002 : L - 0.062;
      const gripZ = S.joystick ? 0.034 : S.old ? 0.031 : 0.0225;
      const stk = new T.Mesh(geo(stickerGeo(0, 0.056, 0.04)), matSticker);
      const stkCol = new Float32Array(4 * 3).fill(1);
      stk.geometry.setAttribute('color', new T.BufferAttribute(stkCol, 3));
      stk.position.set(0, gripY, gripZ);
      stk.rotation.x = -0.15;
      leverPivot.add(stk);
    }

    /* ---- buttons, switches, lamps ------------------------------------------------------------ */
    const btnU = 0.4 * LK;
    const stickerU = 0.465 * LK;
    const doorX = Math.min(hw - 0.2, 0.6);
    const narrow = hw < 0.8 || -doorX < plateX + 0.09;
    const doorLX = narrow ? plateX + 0.125 : -doorX;
    const ebX = narrow ? doorLX + 0.14 : leverX + 0.27;
    const lightX = ebX + 0.2;
    const hornX = lightX + 0.28;
    const wiperX = hornX + 0.14;
    const parkingX = (ebX + lightX) / 2;
    const announceX = (lightX + hornX) / 2;

    // door buttons (square, lit)
    const doorMats = {}, doorMeshes = {};
    for (const side of ['left', 'right']) {
      const x = side === 'left' ? doorLX : doorX;
      deskBox('matte', 0.074, 0.01, 0.062, x, btnU, S.trim, 0);
      const m = hoverMat(side === 'left' ? 'doorLeft' : 'doorRight', mat(new T.MeshStandardMaterial({ color: '#2a8a4c', emissive: '#55ff8a', emissiveIntensity: 0.05, roughness: 0.3 })));
      doorMats[side] = m;
      const lens = new T.Mesh(geo(box(0.054, 0.016, 0.044)), m);
      lens.position.set(x, 0.018, btnU);
      deskGroup.add(lens);
      deskSticker(STK.door, x, stickerU, 0.0025);
      // direction arrow marker: small triangle on the plate edge
      const dir = side === 'left' ? -1 : 1;
      const tri = new T.CircleGeometry(0.012, 3).rotateZ(side === 'left' ? Math.PI : 0).rotateX(-Math.PI / 2);
      addTo('metal', tri, deskM(x + dir * 0.045, btnU, 0.002), '#e8e8e0');
    }

    // horn (round, black with ring)
    deskCyl('metal', 0.038, 0.04, 0.008, hornX, btnU, S.metal, 0, 24);
    const hornMat = hoverMat('horn', mat(new T.MeshStandardMaterial({ color: '#202428', emissive: '#ffb347', emissiveIntensity: 0, roughness: 0.4 })));
    const hornCap = new T.Mesh(geo(cyl(0.029, 0.033, 0.016, 24)), hornMat);
    hornCap.position.set(hornX, 0.016, btnU);
    deskGroup.add(hornCap);
    deskSticker(STK.horn, hornX, stickerU);

    // light switch: rotary knob + indicator
    deskCyl('metal', 0.03, 0.03, 0.006, lightX, btnU, S.metal, 0, 20);
    const knobMat = metalOwn('lights', 0.4);
    const knobGeo = geo(mergeGeos([
      colorize(cyl(0.021, 0.024, 0.02, 18).translate(0, 0.01, 0), '#1c1f24'),
      colorize(box(0.006, 0.004, 0.022).translate(0, 0.021, -0.008), '#f4f4ee'),
    ]));
    const lightKnob = new T.Mesh(knobGeo, knobMat);
    lightKnob.position.set(lightX, 0.006, btnU);
    deskGroup.add(lightKnob);
    deskSticker(STK.lights, lightX, stickerU);

    // emergency brake mushroom
    deskCyl('matte', 0.044, 0.046, 0.012, ebX, btnU, '#e6b800', 0, 28);
    deskCyl('matte', 0.038, 0.038, 0.012, ebX, btnU, '#1a1a1a', 0.012, 28);
    const ebMat = hoverMat('eb', mat(new T.MeshStandardMaterial({ color: '#b4160f', emissive: '#ff2a1a', emissiveIntensity: 0.12, roughness: 0.28, metalness: 0.1 })), 0.7);
    const ebCap = new T.Mesh(geo(new T.SphereGeometry(0.036, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1)), ebMat);
    ebCap.position.set(ebX, 0.024, btnU);
    deskGroup.add(ebCap);
    {
      const g = stickerGeo(STK.eb, 0.05, 0.05 * (128 / 120)).rotateX(-Math.PI / 2);
      addTo('sticker', g, deskM(ebX, btnU, 0.0505), '#ffffff');
    }

    // wiper rotary + extra dummy switches (non-low only)
    deskCyl('metal', 0.022, 0.022, 0.005, wiperX, btnU, S.metal, 0, 16);
    const wiperKnob = new T.Mesh(geo(mergeGeos([
      colorize(cyl(0.016, 0.018, 0.016, 14).translate(0, 0.008, 0), '#1c1f24'),
      colorize(box(0.004, 0.003, 0.016).translate(0, 0.0165, -0.006), '#f4f4ee'),
    ])), metalOwn('wipers', 0.4));
    wiperKnob.position.set(wiperX, 0.005, btnU);
    deskGroup.add(wiperKnob);
    if (!isLow) {
      for (let i = 0; i < 4; i++) {
        const x = lightX + 0.1 + i * 0.045;
        if (x > hornX - 0.07) break;
        if (Math.abs(x - announceX) < 0.065) continue;
        deskBox('matte', 0.026, 0.008, 0.022, x, btnU - 0.02, S.trim, 0);
        deskBox('metal', 0.012, 0.016, 0.006, x, btnU - 0.02, i % 2 ? '#d8d8d0' : '#9aa2ac', 0.004);
      }
      for (let i = 0; i < 3; i++) {
        const x = leverX + 0.19 + i * 0.05;
        deskCyl('matte', 0.012, 0.014, 0.014, x, btnU - 0.075, i === 1 ? '#7a1a14' : '#262a30', 0, 12);
      }
      // ticket tray (right) and paper holder (left)
      const trayX = S.hood ? hw - 0.17 : Math.max(rx1 + 0.12, hw - 0.17);
      deskBox('matte', 0.2, 0.022, 0.1, trayX, 0.27, '#1a1c20', 0);
      deskBox('matte', 0.18, 0.004, 0.08, trayX, 0.27, '#0c0d0f', 0.022);
      addTo('matte', box(0.17, 0.01, 0.1), deskM(trayX, 0.1, 0.045, 0, 0.55), '#9ea4a8');
      addTo('metal', box(0.17, 0.012, 0.01), deskM(trayX, 0.13, 0.03, 0, 0.55), S.metal);
    }

    // indicator lamps (cluster behind the buttons)
    const lampU = 0.345 * LK;
    const lampX0 = ebX - 0.04;
    const lampStep = 0.05;
    const dynLamps = {};
    const lampSlots = [['green', 'traction'], ['amber', 'brake'], ['red', 'eb'], ['blue', 'head'], ['white', 'door'], ['blue', 'wiper'], ['amber', null], ['green', null], ['red', 'parking']];
    deskBox('matte', lampSlots.length * lampStep + 0.02, 0.008, 0.045, lampX0 + (lampSlots.length - 1) * lampStep / 2, lampU, S.trim, 0);
    lampSlots.forEach(([color, role], i) => {
      const x = lampX0 + i * lampStep;
      if (role) {
        const m = lampMat(color, 0.04);
        const lamp = new T.Mesh(geo(cyl(0.014, 0.016, 0.012, 14)), m);
        lamp.position.set(x, 0.014, lampU);
        deskGroup.add(lamp);
        dynLamps[role] = m;
      } else if (!isLow) {
        deskCyl('matte', 0.014, 0.016, 0.012, x, lampU, i === 6 ? '#4a3a12' : i === 7 ? '#14402a' : '#4a1612', 0.0, 14);
      }
    });

    /* ---- parking brake + announcement buttons ------------------------------------------------- */
    const parkMat = hoverMat('parking', mat(new T.MeshStandardMaterial({ color: '#8a2a1a', emissive: '#ff5a2a', emissiveIntensity: 0.05, roughness: 0.3 })), 0.7);
    deskCyl('metal', 0.036, 0.038, 0.008, parkingX, btnU, S.metal, 0, 24);
    const parkCap = new T.Mesh(geo(cyl(0.027, 0.03, 0.016, 22)), parkMat);
    parkCap.position.set(parkingX, 0.016, btnU);
    deskGroup.add(parkCap);
    deskSticker(STK.parking, parkingX, stickerU);
    const announceMat = hoverMat('announce', mat(new T.MeshStandardMaterial({ color: '#2a5fa8', emissive: '#5aa8ff', emissiveIntensity: 0.05, roughness: 0.3 })), 0.7);
    deskBox('matte', 0.07, 0.01, 0.06, announceX, btnU, S.trim, 0);
    const announceLens = new T.Mesh(geo(box(0.05, 0.016, 0.042)), announceMat);
    announceLens.position.set(announceX, 0.018, btnU);
    deskGroup.add(announceLens);
    deskSticker(STK.announce, announceX, stickerU);

    /* ---- clickable controls: invisible hit meshes (a bit larger than the controls) + hover halos --- */
    const ctrlAt = {};                 // id -> desk-local point { x, y, u } (centre of the control)
    const hitMeshes = [];
    const halos = {};
    const hitMat = mat(new T.MeshBasicMaterial({ visible: false }));
    const addHit = (id, w, h, d, x, y, u, parent, extra) => {
      const m = new T.Mesh(geo(box(w, h, d)), hitMat);
      m.position.set(x, y, u);
      m.name = 'hit-' + id;
      m.userData = { ctrl: id, ...(extra || {}) };
      (parent || deskGroup).add(m);
      hitMeshes.push(m);
      return m;
    };
    const haloCanvas = makeCanvas(64, 64);
    {
      const c = haloCanvas.getContext('2d');
      c.shadowColor = '#ffffff'; c.shadowBlur = 10; c.fillStyle = '#ffffff';
      roundRect(c, 14, 14, 36, 36, 9); c.fill();
    }
    const haloMat = mat(new T.MeshBasicMaterial({
      map: tex(canvasTexture(haloCanvas, 1)), color: HOVER_TINT, transparent: true, opacity: 0.75,
      blending: T.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    const gateHaloMat = mat(haloMat.clone());
    gateHaloMat.opacity = 0.2;                 // the gate carries printed labels: keep its halo faint
    const addHalo = (id, w, d, x, y, u) => {
      const m = new T.Mesh(geo(new T.PlaneGeometry(w, d).rotateX(-Math.PI / 2)), id === 'lever' ? gateHaloMat : haloMat);
      m.position.set(x, y, u);
      m.visible = false;
      m.renderOrder = 6;
      deskGroup.add(m);
      halos[id] = m;
    };
    const btnHitU = (btnU + stickerU) / 2, btnHitD = stickerU - btnU + 0.075;
    const buttonCtl = [['doorLeft', doorLX], ['doorRight', doorX], ['horn', hornX], ['lights', lightX], ['eb', ebX], ['parking', parkingX], ['announce', announceX], ['wipers', wiperX]];
    for (const [id, x] of buttonCtl) {
      const withSticker = id !== 'wipers';
      const uC = withSticker ? btnHitU : btnU, d = withSticker ? btnHitD : 0.075;
      addHit(id, HIT_W, 0.07, d, x, 0.035, uC);
      addHalo(id, 0.09, d + 0.012, x, 0.012, uC);
      ctrlAt[id] = { x, y: 0.03, u: btnU };
    }
    // the gate (notch plate + slot) and the lever grip: one control, picks a notch
    {
      const hu0 = plateU0 - 0.025, hu1 = plateU1 + 0.025;
      const hx0 = leverX - 0.045, hx1 = plateX + plateW / 2 + 0.02;
      addHit('lever', hx1 - hx0, 0.02, hu1 - hu0, (hx0 + hx1) / 2, 0.012, (hu0 + hu1) / 2, deskGroup, { gate: true });
      addHit('lever', 0.09, 0.16, 0.09, 0, lk.len - 0.07, 0, leverPivot, { grip: true });
      addHalo('lever', plateW + 0.05, plateU1 - plateU0 + 0.05, plateX, 0.0055, (plateU0 + plateU1) / 2);
      ctrlAt.lever = { x: plateX, y: 0.003, u: tipU(0) };
    }
    const notchAtU = (u) => {
      let best = 0, bestD = Infinity;
      for (let n = LEVER_MIN; n <= LEVER_MAX; n++) { const dd = Math.abs(tipU(n) - u); if (dd < bestD) { bestD = dd; best = n; } }
      return best;
    };

    /* ---- pillars, seals, visor (all follow the raked cap plane) ---------------------------------- */
    if (fr.type === 'tram') buildTramFrame();
    else {
      const pillar = '#3b4047';
      const innerHW = fr.windHW;
      const h = fr.windY1 - fr.windY0;
      const ym = (fr.windY0 + fr.windY1) / 2;
      const rk = rakeAng;
      for (const sx of [-1, 1]) {
        boxAt('matte', 0.09, h + 0.1, 0.07, sx * (innerHW - 0.02), ym, capZ(ym) + 0.06, pillar, rk, 0, sx * 0.03);
        boxAt('matte', 0.03, h + 0.05, 0.4, sx * (innerHW + 0.012), ym, capZ(ym) + 0.22, '#6d737a', rk);
        boxAt('matte', 0.018, h, 0.02, sx * (innerHW - 0.065), ym, capZ(ym) + 0.035, '#050607', rk);
      }
      boxAt('matte', innerHW * 2 + 0.04, 0.07, 0.07, 0, fr.windY1 - 0.01, capZ(fr.windY1) + 0.06, pillar);
      boxAt('matte', innerHW * 2 + 0.04, 0.04, 0.3, 0, fr.windY1 + 0.025, capZ(fr.windY1) + 0.2, '#5a6068');
      boxAt('matte', innerHW * 2, 0.018, 0.02, 0, fr.windY1 - 0.058, capZ(fr.windY1) + 0.035, '#050607');
      boxAt('matte', innerHW * 2, 0.02, 0.026, 0, fr.windY0 + 0.012, capZ(fr.windY0) + 0.04, '#050607');
      if (fr.type === 'railcar' || fr.twin) {
        const px = innerHW * 0.52; // divider offset to the right, so the driver looks through clear glass
        boxAt('matte', 0.05, h, 0.06, px, ym, capZ(ym) + 0.05, pillar, rk);
        boxAt('matte', 0.012, h, 0.012, px, ym, capZ(ym) + 0.015, '#050607', rk);
      }
      // flip-up sun visor and hinge
      const vw = Math.min(innerHW * 2 - 0.2, 1.05);
      boxAt('matte', vw, 0.014, 0.3, -vw * 0.05, fr.windY1 + 0.16, capZ(fr.windY1) + 0.25, '#4a5057', -0.5);
      boxAt('metal', vw, 0.02, 0.02, -vw * 0.05, fr.windY1 + 0.05, capZ(fr.windY1) + 0.12, S.metal);
    }

    /* The CAF Urbos cab frame (Luxtram): warm-white painted A-pillars and side panels, a black rubber gasket round the screen, the cream roller sun blind in its
       header cassette, the interior mirror on the right pillar, a grab handle on the left one, and a white ceiling with its LED strip (lit when it is dark).
       Proportions from the Wikimedia Commons photos of the Urbos 3 cab (Budapest, Kaohsiung) and the Luxtram saloon. */
    function buildTramFrame() {
      const cream = '#e6e4dc', creamLo = '#cbc9c0', shade = '#a9a79f', rubber = '#07080a', dark = '#2a2d32';
      const innerHW = fr.windHW, h = fr.windY1 - fr.windY0, ym = (fr.windY0 + fr.windY1) / 2, rk = rakeAng;
      const sideX = Math.min(fr.W / 2 * 0.92, fr.W / 2 - 0.12);
      for (const sx of [-1, 1]) {
        // A-pillar: a slim, slightly bowed white tube (painted steel) with a thin black rubber lip along the glass
        {
          const y0 = fr.windY0 - 0.08, y1 = fr.windY1 + 0.06, bow = 0.035;
          const pts = [0, 0.25, 0.5, 0.75, 1].map((t) => { const y = y0 + (y1 - y0) * t; return new T.Vector3(sx * (innerHW + 0.03 + bow * Math.sin(Math.PI * t) - 0.03 * t), y, capZ(y) + 0.075); });
          addTo('matte', new T.TubeGeometry(new T.CatmullRomCurve3(pts), 12, 0.027, 10, false), new T.Matrix4(), '#f1efe9', '#d3d1c9');
          boxAt('matte', 0.022, h + 0.02, 0.022, sx * (innerHW - 0.04), ym, capZ(ym) + 0.035, rubber, rk);
        }
        // side panel between pillar and cab door: a short cream return behind the pillar, dark dado below; the side window follows (below)
        const zA = capZ(ym) + 0.12, zB = Math.min(zF + 1.12, zA + 0.1), zD = zF + 1.12;
        if (zB > zA) boxAt('matte', 0.035, fr.windY1 - fr.windY0 + 0.25, zB - zA, sx * (sideX + 0.01), ym + 0.1, (zA + zB) / 2, '#e2e0d8', 0, 0, 0, creamLo);
        if (zD > zA) boxAt('matte', 0.04, fr.windY0 - floor - 0.05, zD - zA, sx * (sideX + 0.01), (fr.windY0 + floor + 0.05) / 2 - 0.02, (zA + zD) / 2, dark, 0, 0, 0, '#1a1c20');
        // gasket round the lower and upper screen edge continues into the pillar
        boxAt('matte', 0.015, h, 0.012, sx * (innerHW - 0.07), ym, capZ(ym) + 0.012, '#050607', rk);
      }
      // black rubber gasket along the bottom and top edge of the glass
      boxAt('matte', innerHW * 2 + 0.08, 0.035, 0.03, 0, fr.windY0 + 0.012, capZ(fr.windY0) + 0.035, rubber);
      boxAt('matte', innerHW * 2 + 0.08, 0.035, 0.03, 0, fr.windY1 - 0.045, capZ(fr.windY1) + 0.035, rubber);
      // header: cream roof panel over the screen with the roller blind cassette (blind rolled up, bottom bar showing)
      boxAt('matte', innerHW * 2 + 0.3, 0.11, 0.38, 0, fr.windY1 + 0.02, capZ(fr.windY1) + 0.2, cream, 0, 0, 0, creamLo);
      addTo('matte', cyl(0.034, 0.034, innerHW * 2 + 0.08, 14).rotateZ(Math.PI / 2), compose(0, fr.windY1 - 0.085, capZ(fr.windY1) + 0.075), '#efe9d6', '#cfc8b2');
      // the blind half rolled down: a cream sheet with a stiff bottom bar (the sun visor of the real cab)
      boxAt('matte', innerHW * 2 + 0.05, 0.07, 0.006, 0, fr.windY1 - 0.155, capZ(fr.windY1) + 0.075, '#e8e2cf', rk, 0, 0, '#d4ccb4');
      boxAt('matte', innerHW * 2 + 0.06, 0.024, 0.022, 0, fr.windY1 - 0.2, capZ(fr.windY1) + 0.07, '#b9b19b', rk);
      // ceiling above the driver, white, with a long LED strip
      const zC0 = capZ(fr.windY1) + 0.1, zC1 = zF + 2.5, yC = fr.windY1 + 0.07;
      boxAt('matte', fr.W - 0.3, 0.04, zC1 - zC0, 0, yC, (zC0 + zC1) / 2, '#ece9e2');
      boxAt('led', 0.12, 0.014, zC1 - zC0 - 0.5, 0, yC - 0.03, (zC0 + zC1) / 2, '#ffffff');
      // interior mirror on the right pillar: dark housing, mirror glass, swivel arm
      {
        const mx = innerHW + 0.18, my = fr.windY0 + h * 0.62, mz = capZ(my) + 0.34;
        boxAt('matte', 0.05, 0.03, 0.05, innerHW + 0.07, my, capZ(my) + 0.16, '#1a1c20', rk);
        boxAt('matte', 0.2, 0.2, 0.035, mx, my, mz, '#17191c', 0, -0.5);
        boxAt('metal', 0.17, 0.17, 0.008, mx - 0.004, my, mz + 0.02, '#6f7c86', 0, -0.5);
      }
      // grab handle on the left pillar and a coat hook
      boxAt('metal', 0.026, 0.4, 0.026, -(innerHW + 0.12), ym - 0.1, capZ(ym) + 0.22, '#c7ccd1', rk);
    }

    /* ---- side windows, cab doors, details ------------------------------------------------------ */
    {
      const xs = Math.min(fr.W / 2 * 0.92, fr.W / 2 - 0.12);
      const z0 = zF + 1.15, z1 = zF + 2.25;
      for (const sx of [-1, 1]) {
        const x = sx * xs;
        // door outline
        boxAt('matte', 0.012, 0.016, z1 - z0, x, floor + 0.06, (z0 + z1) / 2, '#0d0e10');
        boxAt('matte', 0.012, 0.016, z1 - z0, x, floor + 2.0, (z0 + z1) / 2, '#0d0e10');
        boxAt('matte', 0.012, 1.96, 0.016, x, floor + 1.03, z0, '#0d0e10');
        boxAt('matte', 0.012, 1.96, 0.016, x, floor + 1.03, z1, '#0d0e10');
        boxAt('metal', 0.03, 0.03, 0.14, x - sx * 0.01, floor + 1.05, z0 + 0.1, S.metal);
        // window frame + glass
        const wy0 = floor + 0.85, wy1 = floor + 1.95, wz0 = fr.type === 'tram' ? capZ((fr.windY0 + fr.windY1) / 2) + 0.45 : z0 + 0.1, wz1 = z1 - 0.1;
        const fh = '#17191c', fw = fr.type === 'tram' ? 0.026 : 0.045;   // (the Urbos cab door window has a slim frame)
        boxAt('matte', 0.03, fw, wz1 - wz0, x - sx * 0.01, wy0, (wz0 + wz1) / 2, fh);
        boxAt('matte', 0.03, fw, wz1 - wz0, x - sx * 0.01, wy1, (wz0 + wz1) / 2, fh);
        boxAt('matte', 0.03, wy1 - wy0, fw, x - sx * 0.01, (wy0 + wy1) / 2, wz0, fh);
        boxAt('matte', 0.03, wy1 - wy0, fw, x - sx * 0.01, (wy0 + wy1) / 2, wz1, fh);
        boxAt('glass', 0.006, wy1 - wy0 - 0.04, wz1 - wz0 - 0.04, x - sx * 0.006, (wy0 + wy1) / 2, (wz0 + wz1) / 2, '#ffffff');
      }
      if (!isLow) {
        // handrail along the left wall, cable duct under the desk, key-box style plate
        if (fr.type !== 'tram') boxAt('metal', 0.035, 0.035, 0.9, -(xs - 0.07), floor + 1.15, zF + 0.7, S.metal);
        boxAt('matte', 0.04, 0.12, 0.55, hw + 0.02, floor + 0.2, zF + 0.9, '#2b2e33');
        // coiled cable from the desk to the floor
        const curve = new T.CatmullRomCurve3([
          new T.Vector3(hw - 0.05, floor + 0.6, zF + 1.0), new T.Vector3(hw + 0.02, floor + 0.35, zF + 1.07),
          new T.Vector3(hw - 0.04, floor + 0.2, zF + 1.0), new T.Vector3(hw + 0.1, floor + 0.04, zF + 1.1)]);
        addTo('matte', new T.TubeGeometry(curve, 16, 0.01, 6, false), new T.Matrix4(), '#101113');
      }
    }

    /* ---- driver's seat and dead-man pedal ------------------------------------------------------- */
    {
      const old = S.seat === 'old';
      const cushion = old ? '#5b3a22' : '#2f3a52', back = old ? '#6a4529' : '#2b3447';
      const sz = zF + 1.78;
      addTo('matte', cyl(0.05, 0.07, 0.4, 12), compose(0, floor + 0.22, sz), '#1b1c1f');
      addTo('matte', cyl(0.22, 0.22, 0.02, 18), compose(0, floor + 0.03, sz), '#1b1c1f');
      boxAt('matte', 0.5, 0.1, 0.5, 0, floor + 0.49, sz, cushion);
      boxAt('matte', 0.5, 0.62, 0.1, 0, floor + 0.88, sz + 0.27, back, -0.12);
      if (!old) {
        boxAt('matte', 0.3, 0.16, 0.08, 0, floor + 1.32, sz + 0.33, back, -0.12);
        for (const sx of [-1, 1]) boxAt('matte', 0.05, 0.05, 0.36, sx * 0.3, floor + 0.7, sz + 0.0, '#1b1c1f');
      } else {
        boxAt('matte', 0.5, 0.06, 0.08, 0, floor + 1.22, sz + 0.31, back, -0.12);
      }
      if (!isLow) {
        // footrest and dead-man pedal
        boxAt('metal', 0.34, 0.012, 0.22, 0.0, floor + 0.06, zF + 1.12, S.metal, 0.22);
        boxAt('matte', 0.2, 0.03, 0.16, 0.17, floor + 0.05, zF + 1.2, '#15171a', 0.12);
        boxAt('metal', 0.14, 0.004, 0.1, 0.17, floor + 0.068, zF + 1.2, '#7c838c', 0.12);
      }
    }

    /* ---- build merged static meshes ------------------------------------------------------------- */
    const addMerged = (bucket, material) => {
      if (!buckets[bucket].length) return;
      const m = new T.Mesh(geo(mergeGeos(buckets[bucket])), material);
      m.name = 'cab-' + bucket;
      interior.add(m);
    };
    addMerged('matte', matMatte);
    addMerged('metal', matMetal);
    addMerged('lampStatic', matMatte);
    addMerged('led', matLed);
    addMerged('lens', matLens);
    addMerged('sticker', matSticker);
    addMerged('glass', matGlass);

    group.userData.eye = new T.Vector3(0, eyeY, eyeZ);
    group.userData.eyeLookAt = new T.Vector3(0, eyeY, eyeZ - 10);
    group.userData.frame = {
      type: fr.type, zF, floor, eyeY, eyeZ, windHW: fr.windHW, windY0: fr.windY0, windY1: fr.windY1,
      deskFrontY: yFront, deskRearZ: rearZ,
    };

    /* ---------------------------------------------------------------- update */
    const rt = {
      last: 0, leverDisp: 0, needle: 0, mfdAt: 0, snapNext: true, hornLit: 0, powerMax: 500,
      night: -1, applied: { lever: null, head: null, horn: null, door: {}, lamp: {} },
    };
    const palette = S.retro ? PAL_RETRO : PAL_MODERN;

    const setEmissive = (m, v) => {
      baseEm.set(m, v);
      const e = Math.max(v, hoverFloor.get(m) || 0);
      if (m.emissiveIntensity !== e) m.emissiveIntensity = e;
    };

    function snapshotForMfd(state) {
      const speed = Math.round(Math.max(0, num(state.speedKmh, 0)));
      const limit = Math.round(num(state.limitKmh, 0));
      const target = Math.round(num(state.targetKmh, 0));
      const releasedPhase = state.doorsOpen01 > 0.5 ? 'open' : state.doorsReleased ? 'released' : 'closed';
      const brake01 = clamp(num(state.brakePct, 0) / 100, 0, 1);
      const pk = Math.max(0, num(state.powerKw, 0));
      if (pk > rt.powerMax) rt.powerMax = pk;
      const power01 = clamp(pk / rt.powerMax, 0, 1);
      return {
        speed, limit, target, over: limit > 0 && speed > limit + 1,
        aspect: state.signalAspect === 'red' || state.signalAspect === 'yellow' || state.signalAspect === 'green' ? state.signalAspect : 'green',
        delay: Math.round(num(state.delaySec, 0)), clock: typeof state.clock === 'string' ? state.clock : '--:--',
        dist: Math.round(num(state.distanceToStopM, -1)), station: typeof state.nextStationName === 'string' ? state.nextStationName : '',
        brake01: Math.round(brake01 * 40) / 40, power01: Math.round(power01 * 40) / 40,
        doorPhase: releasedPhase, doorSide: state.doorSide === 'left' || state.doorSide === 'right' ? state.doorSide : null,
      };
    }

    function refreshMfds(state, now, force) {
      if (!mfdList.length) return;
      if (!force && now - rt.mfdAt < MFD_INTERVAL_MS) return;
      rt.mfdAt = now;
      const v = snapshotForMfd(state);
      const sigMain = [v.speed, v.limit, v.target, v.aspect, v.delay, v.clock, v.dist, v.station, v.brake01, v.power01, v.doorPhase, v.doorSide].join('|');
      for (const m of mfdList) {
        if (m.sig === sigMain) continue;
        m.sig = sigMain;
        const ctx = m.canvas.getContext('2d');
        ctx.setTransform(m.canvas.width / 512, 0, 0, m.canvas.width / 512, 0, 0);
        if (m.role === 'aux') drawAux(ctx, v, palette); else drawMain(ctx, v, palette);
        m.texture.needsUpdate = true;
      }
    }

    function applyDoorLamps(state, now) {
      const blinkOn = Math.floor(now / (BLINK_PERIOD_MS / 2)) % 2 === 0;
      const released = !!state.doorsReleased;
      const open = num(state.doorsOpen01, 0) > 0.5;
      for (const side of ['left', 'right']) {
        const active = state.doorSide === side || (!state.doorSide && (released || open));
        let v = 0.04;
        if (active && open) v = 1.9;
        else if (active && released) v = blinkOn ? 1.9 : 0.1;
        setEmissive(doorMats[side], v);
      }
    }

    function update(state) {
      const s = state || {};
      const now = performance.now();
      const dt = rt.snapNext ? 1 : clamp((now - rt.last) / 1000, 0, 0.1);
      rt.last = now;
      const snap = rt.snapNext;
      rt.snapNext = false;

      // lever
      const target = clamp(Math.round(num(s.lever, 0)), LEVER_MIN, LEVER_MAX);
      const k = snap ? 1 : 1 - Math.exp(-dt * LEVER_RATE);
      rt.leverDisp += (target - rt.leverDisp) * k;
      if (Math.abs(target - rt.leverDisp) < 0.002) rt.leverDisp = target;
      leverPivot.rotation.x = leverAngleDeg(kindName, rt.leverDisp) * DEG;
      marker.position.z = tipU(rt.leverDisp);

      // speedo
      const speed = Math.max(0, num(s.speedKmh, 0));
      rt.needle += (speed - rt.needle) * (snap ? 1 : 1 - Math.exp(-dt * NEEDLE_RATE));
      if (needlePivot) {
        needlePivot.rotation.z = -dialAngle(scale, rt.needle);
        const lim = num(s.limitKmh, 0), tgt = num(s.targetKmh, 0);
        limitPivot.visible = lim > 0;
        if (lim > 0) limitPivot.rotation.z = -dialAngle(scale, lim);
        targetPivot.visible = tgt > 0;
        if (tgt > 0) targetPivot.rotation.z = -dialAngle(scale, tgt);
      }

      // buttons / lamps
      applyDoorLamps(s, now);
      setEmissive(ebMat, target <= NOTCH_EB ? 1.7 : 0.12);
      const hl = s.headlights === true ? 2 : clamp(Math.round(num(s.headlights, 0)), 0, 2);   // 0 off, 1 dipped, 2 full beam
      lightKnob.rotation.y = -0.45 * hl;
      const night = Math.round(clamp(num(s.night, 0), 0, 1) * 50) / 50;
      if (night !== rt.night) {   // instrument glow: the desk, labels and dial faces pick up a dim cool backlight when it is dark
        rt.night = night;
        matMatte.emissive.copy(NIGHT_MATTE0).lerp(S.hood ? NIGHT_MATTE_WARM : NIGHT_MATTE1, night); matMetal.emissive.copy(NIGHT_METAL0).lerp(NIGHT_METAL1, night);
        matSticker.emissiveIntensity = 0.38 + 0.7 * night; gateMat.emissiveIntensity = 0.4 + 0.6 * night;
        matLed.emissiveIntensity = 0.25 + 1.5 * night; matLens.color.setScalar(0.62 + 0.38 * night);
        dialFaceMat.color.setScalar(1 - 0.22 * night).multiply(NIGHT_DIAL.clone().lerp(NIGHT_ONE, 1 - night));
      }
      setEmissive(dynLamps.eb, target <= NOTCH_EB ? 1.9 : 0.04);
      setEmissive(dynLamps.traction, target > 0 ? 1.6 : 0.04);
      setEmissive(dynLamps.brake, target < 0 && target > NOTCH_EB ? 1.6 : 0.04);
      setEmissive(dynLamps.head, hl === 2 ? 1.7 : hl === 1 ? 0.75 : 0.04);
      setEmissive(dynLamps.door, num(s.doorsOpen01, 0) < 0.02 && !s.doorsReleased ? 1.6 : 0.04);
      setEmissive(dynLamps.wiper, s.wiper ? 1.6 : 0.04);
      setEmissive(hornMat, s.horn ? 1.3 : 0);
      setEmissive(parkMat, s.parkingBrake ? 1.8 : 0.05);
      setEmissive(dynLamps.parking, s.parkingBrake ? 1.9 : 0.04);
      setEmissive(announceMat, s.announce ? 1.6 : 0.05);
      wiperKnob.rotation.y = s.wiper ? -0.9 : 0;
      hornCap.position.y = s.horn ? 0.011 : 0.016;

      refreshMfds(s, now, snap);
    }

    /* Make the next update() jump straight to the state (no smoothing). */
    function snapNow() { rt.snapNext = true; }

    function dispose() {
      if (group.parent) group.parent.remove(group);
      for (const g of own.geos) g.dispose();
      for (const m of own.mats) m.dispose();
      for (const t of own.texs) t.dispose();
      own.geos.length = 0; own.mats.length = 0; own.texs.length = 0;
    }

    /* ---------------------------------------------------------------- clicking / hovering */
    let hovered = null;
    const tmpA = new T.Vector3(), tmpB = new T.Vector3();
    const tmpPlane = new T.Plane();
    const chainVisible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

    function applyHover() {
      for (const id of Object.keys(hoverable)) {
        for (const { m, floor } of hoverable[id]) {
          const f = id === hovered ? floor : 0;
          hoverFloor.set(m, f);
          m.emissiveIntensity = Math.max(baseEm.get(m) || 0, f);
        }
      }
      for (const id of Object.keys(halos)) halos[id].visible = id === hovered;
    }

    /* Subtle emissive highlight + halo on one control (id from controlIds) or none (null). */
    function setHover(id) {
      const next = CONTROL_IDS.includes(id) ? id : null;
      if (next === hovered) return;
      hovered = next;
      applyHover();
    }

    /* Raycaster -> { id, notch? } | null. notch (-8..5) only for 'lever'. */
    function hitTest(raycaster) {
      if (!raycaster || !chainVisible(group)) return null;
      try {
        group.updateWorldMatrix(true, true);
        const hits = raycaster.intersectObjects(hitMeshes, false);
        if (!hits.length) return null;
        const h = hits[0], id = h.object.userData.ctrl;
        if (id !== 'lever') return { id };
        if (h.object.userData.grip) return { id, notch: clamp(Math.round(rt.leverDisp), LEVER_MIN, LEVER_MAX) };
        // the notch comes from the ray's point on the plate itself (not the taller hit box), so it matches the printed labels
        const n = notchOnPlate(raycaster);
        return { id, notch: n == null ? notchAtU(deskGroup.worldToLocal(tmpA.copy(h.point)).z) : n };
      } catch (e) {
        console.warn('[Lokféierer] cab: hitTest failed', e);
        return null;
      }
    }

    function notchOnPlate(raycaster) {
      tmpA.set(0, 1, 0).transformDirection(deskGroup.matrixWorld);
      tmpB.set(0, 0.003, 0).applyMatrix4(deskGroup.matrixWorld);
      tmpPlane.setFromNormalAndCoplanarPoint(tmpA, tmpB);
      const p = raycaster.ray.intersectPlane(tmpPlane, tmpA);
      return p ? notchAtU(deskGroup.worldToLocal(tmpA).z) : null;
    }

    /* Raycaster -> nearest notch (-8..5) along the gate, for dragging: intersects the ray with the gate plane
       (clamped to the ends), so it keeps working when the pointer leaves the hit mesh. null if the ray misses the plane. */
    function pickNotch(raycaster) {
      if (!raycaster || !chainVisible(group)) return null;
      try {
        group.updateWorldMatrix(true, true);
        return notchOnPlate(raycaster);
      } catch (e) {
        console.warn('[Lokféierer] cab: pickNotch failed', e);
        return null;
      }
    }

    /* World position of a control's centre (for tests / pointer hints). Lever: the notch's spot on the gate. */
    function getControlWorldPoint(id, notch) {
      const c = ctrlAt[id];
      if (!c) return null;
      group.updateWorldMatrix(true, true);
      const u = id === 'lever' && typeof notch === 'number' ? tipU(clamp(Math.round(notch), LEVER_MIN, LEVER_MAX)) : c.u;
      return deskGroup.localToWorld(new T.Vector3(c.x, c.y, u));
    }

    update({});
    return { group, update, snap: snapNow, dispose, hitTest, pickNotch, setHover, getControlWorldPoint, controlIds: CONTROL_IDS.slice() };
  }

  TS.cab = { create, STYLES, FALLBACK };
})();
