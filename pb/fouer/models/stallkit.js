/* Schueberfouer Tycoon, "Looks" wave: one stall composer for the NPC stalls (trailers, booths, kiosks, vans).  The photos (food/*, generic-*) show the same anatomy everywhere:
 * a counter with DEPTH and an overhanging steel shelf, a lift-up AWNING (striped, scalloped valance, propped on poles), a bulb-framed FASCIA with a lit lettered sign above it, goods
 * on the counter and hanging from the awning, a lit display case, a menu board, painted side panels, and for trailers a chassis with wheels, a drawbar and steps.
 *   buildStall(b, r, w, d, spec)    draws a stall centred on the origin, front = +z, inside w x d (the awning and the steps reach 1.2 m beyond the front)
 * spec: { trailer, body, side, roof: 'gable' | 'barrel' | 'hip' | 'flat', roofCol: [c1, c2], accent: [c1, c2], counter, word, signLook, goods: [colours], goodsKind: 'blob' | 'cone' | 'bag',
 *         mural: [kind, seed] | null, menu: text | null, display, pylon, steps, H (body height), lamp (interior colour) }
 * Triangles: ~250-330 near, the `far` form (b.far) ~90. */
import { C, shade, mix } from './kit.js';

const WARM = 0xffd890; const GLASS = 0xffb458; const DARK = 0x2a2420; const TYRE = 0x1d1b1a; const RIM = 0xb9c0c6;

/** striped awning panel: hinged at (zb, yb), outer edge at (zf, yf); n coloured stripes + a scalloped valance on the outer edge */
export function awning(b, w, zb, yb, zf, yf, cols, n, valance, wide = 0.1) {
  const x0 = -w / 2 - wide; const dx = (w + wide * 2) / n;
  for (let i = 0; i < n; i++) b.quad([x0 + i * dx, yb, zb], [x0 + (i + 1) * dx, yb, zb], [x0 + (i + 1) * dx, yf, zf], [x0 + i * dx, yf, zf], cols[i & 1], { dbl: false });
  // the underside is a lit surface: dim by day, a warm glow by night that spills light onto the counter and the alley (looks wave, night)
  for (let i = 0; i < n; i++) b.quad([x0 + (i + 1) * dx, yb - 0.01, zb], [x0 + i * dx, yb - 0.01, zb], [x0 + i * dx, yf - 0.01, zf], [x0 + (i + 1) * dx, yf - 0.01, zf], mix(cols[i & 1], 0xffc070, 0.6), { ch: 'lamp' });
  if (valance && !b.far) fringeZ(b, zf, yf, x0, x0 + n * dx, n, 0.3, cols[0], cols[1]);
  b.bulbRow([x0, yf - 0.03, zf + 0.04], [x0 + n * dx, yf - 0.03, zf + 0.04], 0.9, WARM, 0.12);        // a row of bulbs along the awning's edge
}
/** scalloped fringe along x at (y, z), hanging down, facing +z (the front) */
function fringeZ(b, z, y, x0, x1, n, h, c1, c2) {
  const dx = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * dx; const m = a + dx / 2; const e = a + dx; const cc = i & 1 ? c2 : c1;
    b.tri([a, y, z], [e, y, z], [e - dx * 0.06, y - h * 0.62, z], cc); b.tri([a, y, z], [e - dx * 0.06, y - h * 0.62, z], [a + dx * 0.06, y - h * 0.62, z], cc); b.tri([a + dx * 0.06, y - h * 0.62, z], [e - dx * 0.06, y - h * 0.62, z], [m, y - h, z], cc);
  }
}

/** a half-cylinder (barrel) roof along x: n stripes round the arc, end caps; covers x in [-w/2, w/2], depth d centred at zc, springs from yb, rises `rise` */
export function barrel(b, w, d, zc, yb, rise, cols, n) {
  const pt = (k, x) => { const t = Math.PI * k / n; return [x, yb + Math.sin(t) * rise, zc + Math.cos(t) * d / 2]; };
  for (let k = 0; k < n; k++) {
    const c = cols[k & 1];
    b.quad(pt(k, -w / 2), pt(k, w / 2), pt(k + 1, w / 2), pt(k + 1, -w / 2), c, { dbl: true });
  }
  for (const [x, fl] of [[w / 2, 1], [-w / 2, -1]]) for (let k = 0; k < n; k++) b.tri([x, yb, zc], fl > 0 ? pt(k, x) : pt(k + 1, x), fl > 0 ? pt(k + 1, x) : pt(k, x), cols[2] !== undefined ? cols[2] : cols[0]);
}

/** a stack of goods on the counter: kind 'blob' (round items), 'cone' (candy floss / ice cream cones), 'bag' (bags of sweets) */
function goodsRow(b, r, w, y, z, cols, kind, n) {
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.4 + (w - 0.8) * (i + 0.5) / n; const c = cols[i % cols.length];
    if (kind === 'cone') { b.cyl(x, y, z, 0.01, 0.1, 0.2, 5, 0xe0a860); b.blob(x, y + 0.3, z, 0.15, 0.15, 0.15, c); }
    else if (kind === 'bag') b.box(x, y, z, 0.18, 0.28, 0.1, c);
    else b.blob(x, y + 0.1, z, 0.13, 0.1, 0.13, c);
  }
}

export function buildStall(b, r, w, d, spec = {}) {
  const far = b.far; const o = spec; const small = w < 3.6;          // carts and cabinets: no menu board, side panels, hanging goods or counter stripes
  const trailer = !!o.trailer; const y0 = trailer ? 0.72 : 0.06; const Hb = o.H || 2.4;
  const body = o.body !== undefined ? o.body : 0xf3efe2; const side = o.side !== undefined ? o.side : body;
  const acc = o.accent || [0xc8283a, 0xf6ead0]; const rc = o.roofCol || acc; const counter = o.counter !== undefined ? o.counter : 0x6a4a30;
  const zf = d / 2; const roofY = y0 + Hb;

  // ---- chassis (trailer): deck, wheels, drawbar, steps, jack legs
  if (trailer) {
    b.box(0, 0.4, 0, w + 0.16, 0.34, d + 0.12, 0x2c2e34, { cols: { top: C.plate } });
    if (!far) {
      const nw = 1;
      for (let k = 0; k < nw; k++) for (const s of [-1, 1]) {
        const x = (nw === 1 ? -w * 0.1 : (k ? 1 : -1) * w * 0.26) ; const zz = s * (d / 2 - 0.02);
        b.push().translate(x, 0.36, zz).rotX(Math.PI / 2); b.cyl(0, -0.08, 0, 0.36, 0.36, 0.17, 6, TYRE, { cap: true, capColor: RIM }); b.pop();
      }
      b.beam([-w / 2 - 0.05, 0.5, 0.2], [-w / 2 - 1.5, 0.36, 0.2], 0.1, 0x3a3d44);
      b.box(w * 0.28, 0, zf + 0.3, 0.9, 0.24, 0.5, C.plate); b.box(w * 0.28, 0.24, zf + 0.16, 0.9, 0.24, 0.25, C.plate);
    } else b.box(0, 0, 0, w, 0.4, d, 0x2c2e34);
  } else b.box(0, 0, 0, w + 0.06, 0.1, d + 0.06, 0x58504a);

  // ---- body: back + sides (the front is the counter), dark interior with a lit back wall
  b.box(0, y0, -zf + 0.06, w, Hb, 0.12, side, { cols: { front: DARK }, noTop: true, noBack: false });
  for (const s of [-1, 1]) b.box(s * (w / 2 - 0.06), y0, 0, 0.12, Hb, d - 0.12, side, { noTop: true, noBack: true });
  b.quad([-w * 0.42, y0 + 1.15, -zf + 0.13], [w * 0.42, y0 + 1.15, -zf + 0.13], [w * 0.42, y0 + Hb - 0.55, -zf + 0.13], [-w * 0.42, y0 + Hb - 0.55, -zf + 0.13], o.lamp !== undefined ? o.lamp : GLASS, { ch: 'lamp' });
  if (!far) { b.box(0, y0 + 1.7, -zf + 0.3, w * 0.8, 0.05, 0.3, 0x7a5a3a); }

  // ---- roof
  const kind = o.roof || 'gable';
  if (kind === 'barrel') barrel(b, w + 0.3, d + 0.5, 0, roofY, Math.min(0.9, d * 0.28), [rc[0], rc[1], rc[0]], far ? 3 : 6);
  else if (kind === 'hip') b.hip(0, roofY, 0, w + 0.4, d + 0.4, 0.9, rc[0], { over: 0.15, alt: rc });
  else if (kind === 'flat') { b.box(0, roofY, 0, w + 0.3, 0.14, d + 0.5, rc[0]); }
  else b.gable(0, roofY, 0, w + 0.3, d + 0.5, 0.6, o.roofWhite ? [1.7, 1.7, 1.64] : rc[0], { over: 0.12, ridge: 'x', ch: o.roofWhite ? 'fabric' : 'solid', back: o.roofWhite ? [1.4, 1.4, 1.35] : undefined });

  // ---- counter with depth, the steel shelf, a painted front
  b.box(0, y0, zf - 0.28, w - 0.12, 1.06, 0.5, counter, { cols: { top: C.steel } });
  b.box(0, y0 + 1.06, zf + 0.12, w + 0.12, 0.05, 0.56, C.steel);
  if (!far && !small) {
    const ns = Math.max(3, Math.round(w / 1.0)); const sw = (w - 0.3) / ns;
    for (let i = 0; i < ns; i++) b.quad([-w / 2 + 0.15 + i * sw, y0 + 0.18, zf - 0.025 + 0.0], [-w / 2 + 0.15 + (i + 1) * sw - 0.04, y0 + 0.18, zf - 0.025], [-w / 2 + 0.15 + (i + 1) * sw - 0.04, y0 + 0.9, zf - 0.025], [-w / 2 + 0.15 + i * sw, y0 + 0.9, zf - 0.025], acc[i & 1]);
    goodsRow(b, r, w * 0.7, y0 + 1.11, zf + 0.1, o.goods || [0xee6fa8, 0xf4c430, 0x41c4d8, 0xd8433a], o.goodsKind || 'blob', Math.max(3, Math.round(w * 0.6)));
    if (o.display !== false) b.box(w * 0.3, y0 + 1.11, zf + 0.0, w * 0.24, 0.32, 0.4, 0xfff0c8, { ch: 'lamp', noBack: true });
  }

  // ---- awning (lift-up) on two props, with hanging goods
  const aw = Math.max(4, Math.round(w / 1.0));
  awning(b, w, zf - 0.05, roofY - 0.2, zf + 1.05, roofY - 0.62, acc, aw, true);
  if (!far) {
    for (const s of [-1, 1]) b.cyl(s * (w / 2 - 0.05), y0 + 1.1, zf + 1.0, 0.03, 0.03, roofY - 0.62 - y0 - 1.1, 4, 0x333333);
    for (let i = 0; i < 2; i++) { const x = -w * 0.2 + i * w * 0.4; b.wire([x, roofY - 0.62, zf + 1.04], [x, roofY - 1.05, zf + 1.04], 0.02, 0x333333); b.blob(x, roofY - 1.12, zf + 1.04, 0.1, 0.12, 0.08, (o.goods || [0xee6fa8, 0xf4c430, 0x41c4d8])[i % (o.goods || [0, 0, 0]).length]); }
  }

  // ---- fascia, lit sign in a bulb frame, optional pylon sign over the roof
  b.box(0, roofY - 0.05, zf - 0.12, w + 0.16, 0.62, 0.16, acc[0]);
  if (!far) b.sign(o.word || 'KAFFI', 0, roofY + 0.26, zf - 0.02, Math.min(w * 0.88, 4.0), 0.46, { look: o.signLook || 0, kind: 'main', lit: true, frame: false, back: false });
  b.bulbRow([-w / 2, roofY + 0.62, zf - 0.02], [w / 2, roofY + 0.62, zf - 0.02], 0.42, WARM, 0.14);
  b.bulbRow([-w / 2, roofY - 0.1, zf - 0.02], [w / 2, roofY - 0.1, zf - 0.02], 0.42, WARM, 0.14);
  for (const sx of [-1, 1]) b.bulbRow([sx * w / 2, roofY - 0.1, zf - 0.02], [sx * w / 2, roofY + 0.62, zf - 0.02], 0.38, WARM, 0.13);
  if (o.pylon && !far) {
    for (const s of [-1, 1]) b.cyl(s * (w * 0.34), roofY, zf - 0.5, 0.04, 0.04, 1.0, 4, 0x333333);
    b.sign(o.pylonWord || o.word || 'KAFFI', 0, roofY + 1.35, zf - 0.5, Math.min(w * 0.75, 3.4), 0.7, { look: (o.signLook || 0) === 2 ? 0 : 2, kind: 'main', lit: true, frameW: 0.06, frame: 0x3a2a20 });
  }

  // ---- menu board, side mural
  if (!far && !small && o.menu !== null) { b.box(-w / 2 + 0.55, y0 + 1.4, zf + 0.02, 0.6, 0.85, 0.05, 0x23262a, { noBack: true, noTop: true }); b.sign(o.menu || 'MENÜ', -w / 2 + 0.55, y0 + 1.42, zf + 0.06, 0.52, 0.76, { look: 0, kind: 'plate', lit: true, frame: false, back: false }); }
  // the side walls are seen from the cross alleys and from every angle in the walk: a painted panel (a mural, or the accent colour with a lit name plate), two bulbs
  if (!far && !small) {
    for (const [sx, k] of [[1, 0], [-1, 1]]) {
      const x = sx * (w / 2 + 0.07); const dz = Math.min(d * 0.7, 2.4);
      if (o.mural && k === 0) { b.push().translate(x, y0 + 1.25, -0.1).rotY(Math.PI / 2); b.mural(o.mural[0], o.mural[1], 0, 0, 0, dz, 1.3, { frame: false, back: false, lit: true }); b.pop(); }
      else {
        const zA = -zf + 0.35, zB = zf - 0.35; const y1 = y0 + 0.35, y2 = roofY - 0.3;
        const q = (z0, z1, ya, yb, c) => b.quad(sx > 0 ? [x - 0.04, ya, z1] : [x + 0.04, ya, z0], sx > 0 ? [x - 0.04, ya, z0] : [x + 0.04, ya, z1], sx > 0 ? [x - 0.04, yb, z0] : [x + 0.04, yb, z1], sx > 0 ? [x - 0.04, yb, z1] : [x + 0.04, yb, z0], c);
        q(zA, zB, y1, y2, acc[k & 1]);
        b.push().translate(x + sx * 0.01, 0, 0).rotY(sx * Math.PI / 2); b.sign(o.word || 'KAFFI', 0, y0 + 1.5, 0, Math.min(d * 0.62, 1.9), 0.4, { look: o.signLook || 0, kind: 'plate', lit: true, frame: false, back: false }); b.pop();
      }
      b.bulb(sx * (w / 2 + 0.06), roofY - 0.15, zf - 0.3, WARM, 0.12); b.bulb(sx * (w / 2 + 0.06), roofY - 0.15, -zf + 0.4, WARM, 0.12);
    }
  }
}

