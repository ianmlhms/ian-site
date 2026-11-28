/* The skier: a figure of our own (no brand, no likeness), painted / stylised: a shaped ski jacket (yoke, chest stripe, zip, stand-up
 * collar) over ski trousers that fall over the boot cuffs, a helmet with goggles (a frame and a mirrored, tinted lens) and a neck gaiter,
 * padded gloves with gauntlets, ski boots with buckles and a power strap, poles with grips and baskets, shaped skis (sidecut, a turned-up
 * shovel, a tail kick, bindings, painted top sheet) or a snowboard (bindings with highbacks and straps). The outfit colours are the
 * player's choice (OUTFITS, saved in pb_ski_outfit).
 * 28 Nov 2026 (look round): the same bones (groups) and poses as before, only the parts changed: lathed / lofted shapes instead of boxes
 * and capsules (full ~4.3k triangles, the near others 'mid' ~1.7k, the crowd 'low' ~0.4k; scripts/ski/figure-stats.mjs).
 * pose() drives it from the physics state every frame with a small two-bone leg solve (the feet stay on the skis):
 *   carve   the body leans into the turn by the edge angle, the hips more than the shoulders (angulation), the inside leg bends more,
 *           the skis tip onto their edges; a pole plant when the turn changes side
 *   tuck    deep crouch, back flat, hands forward in front of the face, poles under the arms
 *   plough  tips together, tails out, knees in, a little back
 *   jump    knees pulled up at the top, arms out for balance; landing: a deep absorb
 *   crash   a tumble: rolls over and slides, skis and poles flailing, then lies still until the respawn
 * Snowboard (setBoard): sideways on the board (regular: the left foot forward), heel- / toe-side carving, crouch, jump + grab, skid stop,
 * crash; on lifts the board rests on the footrest, strapped to the front foot (chair), is held (cabin, walking) or ridden with the front foot strapped (drag).
 * Niddreg: a soft blob shadow under the skis (setBlob); Mëttel / Héich: the skier casts a real shadow (shadows.js). The ghost is the same
 * figure, translucent. */
import { BELT_TOP } from './lift-path.js';

const THREE = window.THREE;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const THIGH = 0.46, SHIN = 0.46, ANKLE = 0.11;
const CRASH_S = 1.6;
/** Snowboard (28 Nov 2026): binding centres from the board's middle (m, regular stance: the left foot at +x = the nose), angles (rad). */
export const BOARD = Object.freeze({ foot: 0.27, front: 0.21, back: -0.1, halfWidth: 0.13 });

/* jacket, accent (yoke, cuffs, gauntlets, collar trim), trousers (+ the chest stripe and gaiter), helmet, skis */
export const OUTFITS = Object.freeze([
  { id: 'rout', name: 'Rout', jacket: 0xd23a2e, accent: 0xf4f1ea, trousers: 0x1f2a3a, helmet: 0xf3f3f1, ski: 0x2a5bd7 },
  { id: 'blo', name: 'Blo', jacket: 0x2c6fd6, accent: 0xf2c230, trousers: 0x1b1f26, helmet: 0x1d2530, ski: 0xe8e8e4 },
  { id: 'giel', name: 'Giel', jacket: 0xf2b21c, accent: 0x1b1d22, trousers: 0x2b2f36, helmet: 0x1b1d22, ski: 0xd23a2e },
  { id: 'greng', name: 'Gréng', jacket: 0x2f8f5b, accent: 0xf28a1c, trousers: 0x23262b, helmet: 0xf3f3f1, ski: 0xf28a1c },
  { id: 'rosa', name: 'Rosa', jacket: 0xe85d9c, accent: 0xffffff, trousers: 0x3b3f6e, helmet: 0xf6f2f4, ski: 0x6e4fd0 },
  { id: 'schwaarz', name: 'Schwaarz', jacket: 0x22252b, accent: 0xff6a1a, trousers: 0x22252b, helmet: 0xff6a1a, ski: 0x9aa3ad },
  // round 4A: unlocked by the total of stars over all resorts (modes/challenges.js outfitOpen)
  { id: 'neon', name: 'Neon', jacket: 0xc6f01e, accent: 0xff2e88, trousers: 0x1b1d22, helmet: 0xff2e88, ski: 0xc6f01e, stars: 10 },
  { id: 'retro', name: 'Retro', jacket: 0x6a3fb5, accent: 0x31c4c9, trousers: 0xf0e6d2, helmet: 0xf0e6d2, ski: 0xf2a21c, stars: 30 },
  { id: 'gold', name: 'Gold', jacket: 0xd9a520, accent: 0x1b1d22, trousers: 0x1b1d22, helmet: 0xe8c25a, ski: 0x1b1d22, stars: 60 },
  { id: 'weltcup', name: 'Weltcup', jacket: 0xffffff, accent: 0xd0352c, trousers: 0xd0352c, helmet: 0xd0352c, ski: 0xffffff, stars: 120 },
]);
const OUTFIT_KEY = 'pb_ski_outfit';
export function readOutfit() {
  try { const v = localStorage.getItem(OUTFIT_KEY); if (OUTFITS.some((o) => o.id === v)) return v; } catch (error) { console.warn('[ski] storage blocked', error); }
  return OUTFITS[0].id;
}
export function writeOutfit(id) {
  try { localStorage.setItem(OUTFIT_KEY, id); } catch (error) { console.warn('[ski] could not store the outfit', error); }
}
/** The outfit colour each colour slot takes for the other skiers (npc-view.js): 1 jacket, 2 accent, 3 trousers, 4 helmet, 5 skis /
 *  board; 0 = the slot keeps its own fixed colour (boots, goggles, gloves ...). */
export function slotOutfitIndex(name) {
  if (name === 'jacket') return 1;
  if (name === 'accent') return 2;
  if (name === 'trousers') return 3;
  if (name === 'helmet') return 4;
  if (name === 'ski' || name === 'skiTip' || name === 'board' || name.startsWith('cell')) return 5;
  if (name === 'boardArt') return 2;
  return 0;
}

/* ---------- geometry (28 Nov 2026 look round): lathed and lofted shapes ---------- */
/** A lathe round +y from a profile [[r, y], ...] listed bottom to top; seg sides; sx / sz scale the depth (x) / width (z);
 *  phi 0 = +z, pi / 2 = +x (the front). */
function lathe(profile, seg, sx = 1, sz = 1, phiStart = 0, phiLen = Math.PI * 2) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg, phiStart, phiLen);
  if (sx !== 1 || sz !== 1) g.scale(sx, 1, sz);
  return g;
}
/** The part of a profile between the heights y0 and y1 (ends interpolated): colour bands of one shape line up exactly. */
function band(profile, y0, y1, grow = 1) {
  const at = (y) => {
    for (let i = 1; i < profile.length; i++) {
      const [r0, a] = profile[i - 1], [r1, b] = profile[i];
      if (y <= b) return [(r0 + (r1 - r0) * clamp((y - a) / (b - a || 1), 0, 1)) * grow, y];
    }
    return [profile[profile.length - 1][0] * grow, y];
  };
  return [at(y0), ...profile.filter(([, y]) => y > y0 && y < y1).map(([r, y]) => [r * grow, y]), at(y1)];
}
const qb = new THREE.Vector3(), qd = new THREE.Vector3(), qn = new THREE.Vector3();
/** Quads [[a, b, c, d], ...] -> one geometry with flat normals ((b - a) x (d - a) = the outside). */
function quadGeo(quads) {
  const pos = [], nrm = [];
  for (const [a, b, c, d] of quads) {
    qb.subVectors(b, a); qd.subVectors(d, a); qn.crossVectors(qb, qd).normalize();
    for (const p of [a, b, c, a, c, d]) { pos.push(p.x, p.y, p.z); nrm.push(qn.x, qn.y, qn.z); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}
/** A plank (ski, snowboard) along +x from its sections [x, y, w, h] (x rising; y = the base line, w = width, h = thickness, every
 *  section square to the curve, so a turned-up tip keeps its thickness). The top is cut into cols columns (painted cells).
 *  Returns { top: [{ q, i, c }], rest: [quad] } (rest = both sides, the base and the two ends). Pure: firstperson.js uses it too. */
export function plankQuads(secs, cols = 1) {
  const n = secs.length;
  const S = secs.map(([x, y, w, h], i) => {
    const p = secs[Math.max(0, i - 1)], q = secs[Math.min(n - 1, i + 1)];
    const tx = q[0] - p[0], ty = q[1] - p[1], l = Math.hypot(tx, ty) || 1;
    return { x, y, w, tx: x - (ty / l) * h, ty: y + (tx / l) * h };
  });
  const at = (i, top, z) => { const s = S[i]; return new THREE.Vector3(top ? s.tx : s.x, top ? s.ty : s.y, z * s.w); };
  const top = [], rest = [];
  for (let i = 0; i < n - 1; i++) {
    for (let c = 0; c < cols; c++) {
      const z0 = -0.5 + c / cols, z1 = -0.5 + (c + 1) / cols;
      top.push({ q: [at(i, 1, z0), at(i, 1, z1), at(i + 1, 1, z1), at(i + 1, 1, z0)], i, c });
    }
    rest.push([at(i, 0, -0.5), at(i, 1, -0.5), at(i + 1, 1, -0.5), at(i + 1, 0, -0.5)]);
    rest.push([at(i, 0, 0.5), at(i + 1, 0, 0.5), at(i + 1, 1, 0.5), at(i, 1, 0.5)]);
    rest.push([at(i, 0, 0.5), at(i, 0, -0.5), at(i + 1, 0, -0.5), at(i + 1, 0, 0.5)]);
  }
  rest.push([at(0, 0, -0.5), at(0, 0, 0.5), at(0, 1, 0.5), at(0, 1, -0.5)]);
  rest.push([at(n - 1, 0, 0.5), at(n - 1, 0, -0.5), at(n - 1, 1, -0.5), at(n - 1, 1, 0.5)]);
  return { top, rest };
}
/** One coloured, non-indexed geometry of a plank (first person, firstperson.js): colourOf(i, c) = the hex of a top cell, rest = the
 *  hex of the sides, base and ends. */
export function plankGeometry(secs, cols, colourOf, rest) {
  const { top, rest: other } = plankQuads(secs, cols);
  const parts = [...top.map((t) => [t.q, colourOf(t.i, t.c)]), ...other.map((q) => [q, rest])];
  const g = quadGeo(parts.map(([q]) => q));
  const col = new Float32Array(parts.length * 18), c = new THREE.Color();
  parts.forEach(([, hex], k) => { c.setHex(hex); for (let v = 0; v < 6; v++) col.set([c.r, c.g, c.b], k * 18 + v * 3); });
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
/* The ski, tail to tip ([x, y, w, h]): sidecut (wide shovel and tail, narrow waist), thicker under the binding, a shovel that turns up,
 * a small tail kick. TAIL is drawn as its own group (a park ski swaps it for TWIN, the shovel mirrored). */
export const SKI_MAIN = [[-0.62, 0, 0.088, 0.018], [-0.5, 0, 0.085, 0.019], [-0.38, 0, 0.082, 0.02], [-0.26, 0, 0.078, 0.022], [-0.13, 0, 0.074, 0.024], [0, 0, 0.072, 0.026],
  [0.13, 0, 0.075, 0.024], [0.26, 0, 0.079, 0.022], [0.38, 0, 0.083, 0.02], [0.5, 0, 0.087, 0.019], [0.62, 0, 0.093, 0.018], [0.76, 0.003, 0.1, 0.016],
  [0.85, 0.018, 0.1, 0.014], [0.915, 0.044, 0.091, 0.013], [0.96, 0.077, 0.074, 0.012], [0.99, 0.108, 0.048, 0.011]];
export const SKI_TAIL = [[-0.86, 0.048, 0.05, 0.012], [-0.83, 0.022, 0.078, 0.014], [-0.77, 0.005, 0.092, 0.016], [-0.62, 0, 0.088, 0.018]];
const SKI_TWIN = SKI_MAIN.slice(10).map(([x, y, w, h]) => [-x, y, w, h]).reverse();
const SKI_MID = [[-0.84, 0.04, 0.062, 0.014], [-0.77, 0.005, 0.09, 0.016], [0, 0, 0.074, 0.024], [0.76, 0.003, 0.1, 0.016], [0.9, 0.036, 0.094, 0.013], [0.965, 0.08, 0.072, 0.012], [0.99, 0.108, 0.048, 0.011]];
const SKI_LOW = [[-0.82, 0.02, 0.07, 0.016], [0.8, 0, 0.09, 0.02], [0.99, 0.1, 0.05, 0.012]];
/* the top-sheet patterns of the ski types (modes/skis.js look.pattern) as painted cells of the main ski (s = the segment from the tail
 * end of SKI_MAIN, 0 .. 14; c = the column, 0 left, 1 middle, 2 right); the shovel (s >= 11) takes the tip colour */
export const SKI_ART = Object.freeze({
  stripe: (s, c) => c === 1 && s >= 1 && s <= 9,
  chevron: (s, c) => (c !== 1 && (s === 1 || s === 7)) || (c === 1 && (s === 2 || s === 8)),
  race: (s, c) => (c !== 1 && s <= 9) || (c === 1 && s === 10),
  dots: (s, c) => c === 1 && (s === 0 || s === 2 || s === 7 || s === 9),
  zigzag: (s, c) => s <= 9 && c === [0, 1, 2, 1][s % 4],
});
const ART_BIT = Object.fromEntries(Object.keys(SKI_ART).map((k, i) => [k, 1 << i]));
/* The snowboard, tail to nose (symmetric twin): rounded ends that rise, sidecut between the contact points. */
const BOARD_HALF = [[0, 0, 0.248], [0.2, 0, 0.252], [0.4, 0, 0.262], [0.58, 0, 0.272], [0.66, 0.012, 0.262], [0.72, 0.032, 0.235], [0.76, 0.055, 0.19], [0.785, 0.072, 0.12]];
const mirrorHalf = (half, h) => [...half.slice(1).reverse().map(([x, y, w]) => [-x, y, w, h]), ...half.map(([x, y, w]) => [x, y, w, h])];
export const BOARD_FULL = mirrorHalf(BOARD_HALF, 0.013);
const BOARD_MIDS = mirrorHalf([BOARD_HALF[0], BOARD_HALF[3], BOARD_HALF[5], BOARD_HALF[7]], 0.014);
const BOARD_LOW = mirrorHalf([[0, 0, 0.25], [0.6, 0, 0.27], [0.785, 0.06, 0.15]], 0.016);

/* detail (other skiers, npc-view.js): 'full' = the player's figure; 'mid' = fewer segments, no ski art / buckles (~1.7k triangles);
 * 'low' = the crowd figure (~0.4k triangles: few sides, the small parts left out). The bones and pose() are the same. */
export function createSkierModel({ outfit = OUTFITS[0].id, ghost = false, skinned = false, detail = 'full' } = {}) {
  const LOW = detail === 'low', MID = detail === 'mid', FULL = !LOW && !MID;
  let skiLookOf = null;                      // round 6: set once setSki exists (the outfit no longer picks the ski colour then)
  const mat = (color) => (ghost
    ? new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false })
    : new THREE.MeshLambertMaterial({ color }));
  const M = {
    jacket: mat(0xffffff), accent: mat(0xffffff), trousers: mat(0xffffff), helmet: mat(0xffffff), ski: mat(0xffffff),
    dark: mat(0x1b1d22), boot: mat(0x2a2d34), buckle: mat(0xc3c9d1), lens: mat(0xf2922e), lensTop: mat(0x4a3f9e), skin: mat(0xe2ad8c),
    pole: mat(0xb4bcc6), grip: mat(0x15171b), glove: mat(0x26292f), bootCuff: mat(0x4d5463), binding: mat(0x30343c), skiTip: mat(0xffffff),
    board: mat(0xffffff), boardArt: mat(0xffffff), boardTip: mat(0xffffff),
  };
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const mesh = (g, m) => new THREE.Mesh(g, m);
  const sph = (r, w, h, ...rest) => new THREE.SphereGeometry(r, LOW ? 4 : MID ? Math.max(5, Math.round(w * 0.55)) : w, LOW ? 3 : MID ? Math.max(4, Math.round(h * 0.6)) : h, ...rest);
  const only = (ok, ...meshes) => (ok ? meshes : []);              // parts a coarser detail leaves out
  const SEG = { body: FULL ? 14 : MID ? 8 : 5, limb: FULL ? 10 : MID ? 6 : 4, small: FULL ? 8 : MID ? 5 : 3 };
  /** a lathed part along y (profile bottom to top); low keeps the first and last point only */
  const limb = (profile, m, seg = SEG.limb) => mesh(lathe(LOW ? [profile[0], profile[profile.length - 1]] : profile, seg), m);
  /** a plank's quads split by colour slot: cellMat(i, c) for the top cells, restMat for the rest */
  const plankMeshes = (secs, cols, cellMat, restMat) => {
    const { top, rest } = plankQuads(secs, cols);
    const bySlot = new Map();
    for (const t of top) { const m = cellMat(t.i, t.c); if (!bySlot.has(m)) bySlot.set(m, []); bySlot.get(m).push(t.q); }
    const out = [...bySlot].map(([m, qs]) => mesh(quadGeo(qs), m));
    out.push(mesh(quadGeo(rest), restMat));
    return out;
  };
  const root = new THREE.Group();            // feet position, heading (+x forward, +z right, +y up)
  const tilt = new THREE.Group();            // slope pitch
  const lean = new THREE.Group();            // roll into the turn (whole body)
  const stance = new THREE.Group();          // the body over the skis (identity) or sideways on the snowboard
  root.add(tilt); tilt.add(lean); lean.add(stance);

  // ---- skis: the main plank (painted top cells), the tail kick (or the twin tip of a park ski), the binding on a plate
  const cellSlots = new Map();               // pattern mask -> its colour slot (setSki paints it the art or the base colour)
  const cellMat = (s, c) => {
    if (s >= 11) return M.skiTip;
    let mask = 0;
    for (const [k, f] of Object.entries(SKI_ART)) if (f(s, c)) mask |= ART_BIT[k];
    if (!mask) return M.ski;
    if (!cellSlots.has(mask)) { const m = mat(0xffffff); M[`cell${mask}`] = m; cellSlots.set(mask, m); }
    return cellSlots.get(mask);
  };
  const skis = [];
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    const edge = new THREE.Group();          // the ski's own edge angle
    const tail = new THREE.Group(), twin = new THREE.Group();
    if (FULL) {
      edge.add(...plankMeshes(SKI_MAIN, 3, cellMat, M.dark));
      tail.add(...plankMeshes(SKI_TAIL, 1, () => M.ski, M.dark));
      twin.add(...plankMeshes(SKI_TWIN, 1, () => M.skiTip, M.dark));
      const plate = box(0.44, 0.012, 0.064, M.binding); plate.position.set(0, 0.032, 0);
      const toe = box(0.075, 0.04, 0.07, M.binding); toe.position.set(0.215, 0.056, 0);
      const toeCap = box(0.05, 0.012, 0.054, M.buckle); toeCap.position.set(0.222, 0.08, 0);
      const heel = box(0.1, 0.056, 0.072, M.binding); heel.position.set(-0.178, 0.064, 0);
      const lever = box(0.07, 0.012, 0.044, M.buckle); lever.position.set(-0.2, 0.094, 0); lever.rotation.z = -0.28;
      edge.add(plate, toe, toeCap, heel, lever);
    } else {
      edge.add(...plankMeshes(MID ? SKI_MID : SKI_LOW, 1, (s) => (s >= (MID ? 4 : 1) ? M.skiTip : M.ski), M.dark));
      if (MID) {
        const toe = box(0.075, 0.04, 0.07, M.binding); toe.position.set(0.215, 0.056, 0);
        const heel = box(0.1, 0.056, 0.072, M.binding); heel.position.set(-0.178, 0.064, 0);
        edge.add(toe, heel);
      }
    }
    twin.visible = false;
    edge.add(tail, twin);
    g.add(edge);
    g.position.z = side * 0.13;
    lean.add(g); skis.push({ g, edge, twin, tail });
  }
  // ---- snowboard (28 Nov 2026): the board along +x (the nose), the toe edge at +z; two bindings (plate, highback, straps), angled
  const board = new THREE.Group();
  {
    const secs = FULL ? BOARD_FULL : MID ? BOARD_MIDS : BOARD_LOW;
    const last = secs.length - 1;
    board.add(...plankMeshes(secs, FULL ? 3 : 1, (i, c) => {
      const x = (secs[i][0] + secs[i + 1][0]) / 2;
      if (Math.abs(x) > 0.6 || (i === 0 || i === last - 1)) return M.boardTip;
      return FULL && c === 1 ? M.boardArt : M.board;
    }, M.boardArt));                                         // the base and the sides in the art colour
    if (!LOW) {
      for (const [x, yaw] of [[BOARD.foot, BOARD.front], [-BOARD.foot, BOARD.back]]) {
        const b = new THREE.Group(); b.position.set(x, 0.013, 0); b.rotation.y = yaw;
        const plate = box(0.13, 0.016, 0.25, M.binding); plate.position.set(0, 0.008, 0);
        const high = box(0.12, 0.17, 0.022, M.binding); high.position.set(0, 0.1, -0.118); high.rotation.x = -0.22;
        b.add(plate, high);
        if (FULL) {
          const ankle = box(0.135, 0.045, 0.1, M.accent); ankle.position.set(0, 0.105, -0.025); ankle.rotation.x = 0.35;
          const toeS = box(0.125, 0.03, 0.055, M.accent); toeS.position.set(0, 0.055, 0.085);
          b.add(ankle, toeS);
        }
        b.updateMatrix();
        for (const m of [...b.children]) { m.applyMatrix4(b.matrix); board.add(m); }
      }
    }
  }
  board.visible = false;
  lean.add(board);
  // ---- legs: hip -> thigh -> knee -> shin (the trousers fall over the boot cuff) -> boot (level on the ski)
  const BOOT = [[-0.125, -0.074], [0.165, -0.074], [0.19, -0.064], [0.19, -0.048], [0.155, -0.042], [0.125, -0.008], [0.075, 0.03],
    [0.085, 0.13], [0.072, 0.212], [-0.088, 0.218], [-0.1, 0.08], [-0.118, 0.0], [-0.132, -0.05]];
  const BOOT_SHELL = [[-0.125, -0.074], [0.165, -0.074], [0.19, -0.064], [0.19, -0.048], [0.155, -0.042], [0.125, -0.008], [0.078, 0.034], [-0.104, 0.04], [-0.118, 0.0], [-0.132, -0.05]];
  const BOOT_CUFF = [[0.07, 0.02], [0.085, 0.13], [0.072, 0.212], [-0.088, 0.218], [-0.1, 0.08], [-0.108, 0.02]];
  const extrude = (pts, depth) => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: FULL, bevelThickness: 0.011, bevelSize: 0.009, bevelSegments: 1, curveSegments: 1 });
    g.translate(0, 0, -depth / 2);
    return g;
  };
  const bootGeo = () => {
    if (LOW) { const g = new THREE.BoxGeometry(0.29, 0.13, 0.11); g.translate(0.03, -0.01, 0); return g; }
    return extrude(FULL ? BOOT_SHELL : BOOT, FULL ? 0.098 : 0.12);
  };
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    const thigh = limb([[0.08, -0.46], [0.087, -0.3], [0.097, -0.12], [0.1, 0.03]], M.trousers);
    const knee = new THREE.Group(); knee.position.y = -THIGH;
    const kneePad = mesh(sph(0.083, 9, 7), M.trousers);
    const shin = limb([[0.07, -0.352], [0.092, -0.344], [0.094, -0.33], [0.086, -0.26], [0.078, -0.15], [0.079, -0.04], [0.083, 0.03]], M.trousers);
    const ankle = new THREE.Group(); ankle.position.y = -SHIN;
    const boot = mesh(bootGeo(), M.boot);
    const cuff = FULL ? mesh(extrude(BOOT_CUFF, 0.104), M.bootCuff) : null;
    const strap = box(0.17, 0.03, 0.128, M.dark); strap.position.set(-0.008, 0.19, 0);
    const buckles = [[0.112, -0.012], [0.086, 0.07], [0.082, 0.135]].map(([x, y]) => { const b = box(0.022, 0.02, 0.136, M.buckle); b.position.set(x, y, 0); return b; });
    ankle.add(boot, ...only(FULL, cuff, strap, ...buckles));
    knee.add(...only(!LOW, kneePad), shin, ankle); hip.add(thigh, knee);
    stance.add(hip); legs.push({ hip, knee, ankle, side });
  }
  // ---- torso: pelvis, the jacket (one lathed shape in colour bands: body, chest stripe, yoke), zip, collar; head: helmet, goggles, gaiter
  const torso = new THREE.Group();
  const JACKET = [[0.18, -0.06], [0.192, -0.015], [0.186, 0.1], [0.184, 0.2], [0.2, 0.3], [0.212, 0.4], [0.214, 0.47], [0.2, 0.53], [0.15, 0.585], [0.085, 0.615]];
  const JX = 0.74;                            // the jacket's depth / width
  const jk = (y0, y1, m) => mesh(lathe(band(JACKET, y0, y1), SEG.body, JX, 1), m);
  const pelvis = mesh(sph(1, 12, 8), M.trousers); pelvis.position.y = 0.0; pelvis.scale.set(0.126, 0.118, 0.17);
  const jacketParts = LOW
    ? [mesh(lathe([[0.172, -0.05], [0.21, 0.4], [0.17, 0.55]], SEG.body, JX, 1), M.jacket), mesh(lathe([[0.17, 0.55], [0.085, 0.61]], SEG.body, JX, 1), M.accent)]
    : [jk(-0.06, 0.29, M.jacket), jk(0.29, 0.325, M.trousers), jk(0.325, 0.41, M.jacket), jk(0.41, 0.61, M.accent)];
  const zip = mesh(lathe(band(JACKET, 0.0, 0.58, 1.012), 1, JX, 1, Math.PI / 2 - 0.022, 0.044), M.dark);
  const collar = mesh(lathe([[0.09, 0.575], [0.1, 0.62], [0.096, 0.648]], SEG.body), M.jacket);
  const collarTrim = mesh(lathe([[0.096, 0.644], [0.098, 0.656]], SEG.body), M.accent);
  const neck = new THREE.Group(); neck.position.y = 0.62;
  const face = mesh(sph(0.088, 12, 9), M.skin); face.position.set(0.03, 0.09, 0); face.scale.set(0.95, 1.05, 0.86);
  const gaiter = mesh(lathe([[0.072, -0.03], [0.088, 0.02], [0.096, 0.05], [0.09, 0.062]], SEG.body, 1.12, 0.96), M.trousers); gaiter.position.x = 0.018;
  const HELMET = [[0.15, 0.148], [0.155, 0.17], [0.148, 0.2], [0.128, 0.232], [0.094, 0.258], [0.05, 0.272], [0.0, 0.276]];
  const helmet = mesh(lathe(LOW ? [HELMET[0], HELMET[3], HELMET[6]] : MID ? [HELMET[0], HELMET[2], HELMET[4], HELMET[6]] : HELMET, SEG.body, 1.1, 0.98), M.helmet);
  // the shell's lower band round the back and the ears (the face side is open: goggles)
  const shell = mesh(lathe([[0.136, 0.035], [0.15, 0.06], [0.153, 0.11], [0.15, 0.15]], SEG.body, 1.1, 0.98, Math.PI / 2 + 0.92, Math.PI * 2 - 1.84), M.helmet);
  const GOG = { r: 0.157, y: 0.118, h: 0.074, a: 1.0 };
  const gogBand = (r, y0, y1, a, m, seg) => { const g = new THREE.CylinderGeometry(r, r, y1 - y0, seg, 1, true, Math.PI / 2 - a, a * 2); g.translate(0, (y0 + y1) / 2, 0); g.scale(1.1, 1, 0.98); return mesh(g, m); };
  const frame = gogBand(GOG.r, GOG.y - GOG.h / 2, GOG.y + GOG.h / 2, GOG.a, M.dark, SEG.body);
  const lensTop = gogBand(GOG.r + 0.006, GOG.y, GOG.y + GOG.h / 2 - 0.009, GOG.a - 0.1, M.lensTop, SEG.body);
  const lensLow = gogBand(GOG.r + 0.006, GOG.y - GOG.h / 2 + 0.009, GOG.y, GOG.a - 0.1, M.lens, SEG.body);
  const gStrap = gogBand(0.162, GOG.y - 0.019, GOG.y + 0.019, Math.PI - GOG.a - 0.05, M.dark, SEG.body); gStrap.rotation.y = Math.PI;
  const lowLens = box(0.06, 0.07, 0.25, M.lens); lowLens.position.set(0.13, 0.12, 0);
  const lowFace = mesh(new THREE.SphereGeometry(0.09, 5, 3), M.skin); lowFace.position.set(0.02, 0.09, 0);
  const lowNeck = mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.09, 5, 1, true), M.trousers); lowNeck.position.y = 0.0;
  neck.add(...only(!LOW, face, gaiter, shell, frame, lensTop, lensLow), ...only(FULL, gStrap), helmet, ...only(LOW, lowLens, lowFace, lowNeck));
  torso.add(...only(!LOW, pelvis), ...jacketParts, ...only(FULL, zip, collarTrim), ...only(!LOW, collar), neck);
  // ---- arms: shoulder -> upper arm -> elbow -> forearm, cuff, glove (gauntlet + padded hand + thumb), pole (grip, shaft, basket, tip)
  const arms = [], poles = [];
  for (const side of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(0, 0.52, side * 0.26);
    const ball = mesh(sph(0.06, 10, 8), M.accent);                   // the yoke goes over the shoulder
    const upper = limb([[0.056, -0.3], [0.061, -0.22], [0.068, -0.09]], M.jacket);
    const upperTop = limb([[0.068, -0.09], [0.066, -0.05], [0.058, 0.0]], M.accent);
    const elbow = new THREE.Group(); elbow.position.y = -0.3;
    const elbowBall = mesh(sph(0.056, 8, 6), M.jacket);
    const fore = limb([[0.051, -0.215], [0.056, -0.12], [0.058, 0.0]], M.jacket);
    const gauntlet = limb([[0.05, -0.3], [0.064, -0.262], [0.066, -0.2]], M.accent, SEG.small + 2);
    const hand = mesh(sph(0.05, 10, 8), M.glove); hand.position.set(0.006, -0.322, 0); hand.scale.set(1.02, 1.22, 0.86);
    const thumb = mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.055, SEG.small), M.glove); thumb.position.set(0.04, -0.3, -side * 0.012); thumb.rotation.z = 0.75;
    const pole = new THREE.Group(); pole.position.y = -0.3;
    const grip = limb([[0.018, -0.085], [0.021, -0.03], [0.022, 0.03], [0.027, 0.05], [0.004, 0.064]], M.grip, SEG.small);
    const shaft = mesh(new THREE.CylinderGeometry(0.0095, 0.0072, 1.08, LOW ? 3 : 5), M.pole); shaft.position.y = -0.62;
    const basket = limb([[0.008, -1.085], [0.05, -1.072], [0.05, -1.064], [0.012, -1.045]], M.dark, SEG.small);
    const tip = mesh(new THREE.ConeGeometry(0.008, 0.05, 4), M.buckle); tip.position.y = -1.17; tip.rotation.x = Math.PI;
    pole.add(...only(!LOW, grip), shaft, ...only(!LOW, basket), ...only(FULL, tip));
    poles.push(pole);
    elbow.add(...only(!LOW, elbowBall), fore, gauntlet, hand, ...only(!LOW, thumb), pole); sh.add(...only(!LOW, ball, upperTop), upper, elbow);
    torso.add(sh); arms.push({ sh, elbow, pole, side });
  }
  stance.add(torso);
  // blob shadow (Niddreg)
  const blobTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x33405e, alphaMap: blobTex, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  blob.scale.set(1.25, 1, 0.55);
  blob.visible = false;
  blob.renderOrder = 3;
  // one draw call per bone: the parts of each group are merged into a single vertex-coloured mesh (slot per vertex, so the outfit can
  // be recoloured); ~16 draw calls for the whole figure instead of ~50
  const SLOTS = Object.keys(M);
  const slotOf = new Map(SLOTS.map((k, i) => [M[k], i]));
  const shared = ghost ? new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false }) : new THREE.MeshLambertMaterial({ vertexColors: true });
  const merged = [];
  const groups = [];
  root.traverse((o) => { if (o.isGroup || o === root) groups.push(o); });
  for (const g of groups) {
    const kids = g.children.filter((c) => c.isMesh);
    if (!kids.length) continue;
    const pos = [], nrm = [], idx = [], slots = [];
    let base = 0;
    for (const m of kids) {
      m.updateMatrix();
      const geo = m.geometry.clone().applyMatrix4(m.matrix);
      const P = geo.attributes.position, N = geo.attributes.normal, sl = slotOf.get(m.material) || 0;
      for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i)); slots.push(sl); }
      if (geo.index) for (let i = 0; i < geo.index.count; i++) idx.push(geo.index.getX(i) + base);
      else for (let i = 0; i < P.count; i++) idx.push(base + i);
      base += P.count;
      g.remove(m); m.geometry.dispose(); geo.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(slots.length * 3), 3));
    geo.setIndex(idx);
    geo.userData.slots = Uint8Array.from(slots);
    const mesh = new THREE.Mesh(geo, shared);
    mesh.castShadow = !ghost; mesh.receiveShadow = !ghost; mesh.frustumCulled = false;
    g.add(mesh);
    merged.push(mesh);
  }
  // R8b (Niddreg draw calls, D's note): skinned = the per-bone meshes become ONE skinned mesh (bones = their groups, bind identity, like
  // net/remotes.js createRemoteFigure): 1 draw call (+1 shadow) instead of ~16. A hidden group (poles in a cabin, the twin tips, first
  // person: all but the gear) gets a zero bone matrix, so its vertices collapse (no fragments). The per-bone meshes stay for remotes.js.
  let skin = null;
  if (skinned && merged.length) {
    const bones = merged.map((m) => m.parent);
    const pos = [], nrm = [], si = [], sw = [], idx = [], slots = [];
    let base = 0;
    merged.forEach((m, bi) => {
      const g = m.geometry, P = g.attributes.position, N = g.attributes.normal;
      for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i)); si.push(bi, 0, 0, 0); sw.push(1, 0, 0, 0); slots.push(g.userData.slots[i]); }
      for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
      base += P.count;
      m.visible = false;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(slots.length * 3), 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setIndex(idx);
    geo.userData.slots = Uint8Array.from(slots);
    const I = new THREE.Matrix4();
    const mesh = new THREE.SkinnedMesh(geo, shared);
    mesh.name = ghost ? 'ski-ghost-figure' : 'ski-skier-figure';
    const skeleton = new THREE.Skeleton(bones, bones.map(() => I.clone()));
    mesh.bind(skeleton, I);
    mesh.frustumCulled = false; mesh.castShadow = !ghost; mesh.receiveShadow = !ghost;
    if (!ghost) mesh.renderOrder = 2;                                     // after the snow decals (drag tracks)
    // a bone counts as hidden when it or any group above it (up to the root) is invisible, or (first person) it is not gear
    const up = bones.map((b) => { const chain = []; for (let o = b; o && o !== root; o = o.parent) chain.push(o); return chain; });
    const update = skeleton.update.bind(skeleton);
    skeleton.update = () => {
      update();
      const M = skeleton.boneMatrices;
      for (let i = 0; i < bones.length; i++) {
        const hidden = (skin && skin.fp && !gearGroups.has(bones[i])) || up[i].some((o) => !o.visible);
        if (hidden) M.fill(0, i * 16, i * 16 + 16);
      }
    };
    root.add(mesh);
    skin = { mesh, fp: false };
    merged.push(mesh);                   // recolour() paints it too (the hidden per-bone meshes keep their colours as well)
  }
  function recolour() {
    for (const mesh of merged) {
      const col = mesh.geometry.attributes.color, sl = mesh.geometry.userData.slots;
      for (let i = 0; i < sl.length; i++) { const c = M[SLOTS[sl[i]]].color; col.setXYZ(i, c.r, c.g, c.b); }
      col.needsUpdate = true;
    }
  }
  blob.castShadow = false; blob.receiveShadow = false;
  if (ghost) root.renderOrder = 5;
  const group = new THREE.Group();
  group.add(root, blob);

  function setOutfit(id) {
    const o = OUTFITS.find((x) => x.id === id) || OUTFITS[0];
    outfit = o.id;
    M.jacket.color.setHex(o.jacket); M.accent.color.setHex(o.accent); M.trousers.color.setHex(o.trousers); M.helmet.color.setHex(o.helmet);
    M.ski.color.setHex(ghost ? 0x9ad1ff : skiLookOf ? skiLookOf().base : o.ski);
    if (ghost) for (const k of ['jacket', 'accent', 'trousers', 'helmet']) M[k].color.lerp(new THREE.Color(0x9ad1ff), 0.5);
    if (merged.length) recolour();
  }
  setOutfit(outfit);
  /** Round 6: the ski type's look { base, art, tip, length, width, twin, pattern } (modes/skis.js SKI_TYPES). */
  let skiLook = null;
  function setSki(look) {
    skiLook = look || null;
    const base = ghost ? 0x9ad1ff : look ? look.base : (OUTFITS.find((x) => x.id === outfit) || OUTFITS[0]).ski;
    M.ski.color.setHex(base);
    M.skiTip.color.setHex(look && !ghost ? look.tip : base);
    const bit = look && !ghost ? ART_BIT[look.pattern] || 0 : 0;
    for (const [mask, m] of cellSlots) m.color.setHex(mask & bit ? look.art : base);
    // the snowboard's own colours (its type's look when it is the board, else a plain board in the ski colour)
    M.board.color.setHex(base); M.boardArt.color.setHex(look && !ghost && look.board ? look.art : base); M.boardTip.color.setHex(look && !ghost && look.board ? look.tip : base);
    for (const sk of skis) {
      sk.edge.scale.set(look && !look.board ? look.length : 1, 1, look && !look.board ? look.width : 1);
      sk.twin.visible = !!(look && look.twin);
      sk.tail.visible = !sk.twin.visible;
    }
    if (merged.length) recolour();
  }
  /** 28 Nov 2026: a snowboard instead of the skis (the poles stay away); the board's colours come from setSki(look). */
  let boarding = false;
  function setBoard(on) {
    boarding = !!on;
    board.visible = boarding;
    for (const sk of skis) sk.g.visible = !boarding;
    stance.rotation.set(0, 0, 0); stance.position.set(0, 0, 0);
    for (const L of legs) L.ankle.rotation.y = 0;
    gearHidden = null;                                     // pose() shows / hides the poles again
  }
  setSki(null);
  skiLookOf = () => skiLook || { base: (OUTFITS.find((x) => x.id === outfit) || OUTFITS[0]).ski };
  recolour();

  let gearHidden = false;
  /** Seated (chair lift): the root is the seat under the pelvis; thighs forward, shins hanging, skis dangling, hands on the bar. */
  function poseSit(t) {
    tilt.rotation.set(0, 0, 0); tilt.position.set(0, 0, 0); lean.rotation.set(0, 0, 0);
    const swing = Math.sin(t * 1.3) * 0.05;
    for (let i = 0; i < 2; i++) {
      const L = legs[i], sk = skis[i];
      const shin = 0.22 + swing * (i ? 1 : -1);
      L.hip.position.set(0, 0.1, L.side * 0.12);
      L.hip.rotation.set(0, 0, Math.PI / 2);
      L.knee.rotation.set(0, 0, -(Math.PI / 2 - shin));
      L.ankle.rotation.set(0, 0, -shin);
      const ax = THIGH + SHIN * Math.sin(shin), ay = 0.1 - SHIN * Math.cos(shin);
      sk.g.position.set(ax, ay - ANKLE, L.side * 0.13);
      sk.g.rotation.set(0, 0, 0);
      sk.edge.rotation.set(0, 0, -0.02 + swing * 0.2);                // R8e: the skis lie on the chair's footrest bar (carriers.js), level
    }
    torso.position.set(-0.04, 0.1, 0);
    torso.rotation.set(0, 0, 0.08);
    neck.rotation.set(0, Math.sin(t * 0.4) * 0.25, -0.05);
    for (let i = 0; i < 2; i++) {
      const A = arms[i];
      A.sh.rotation.set(-A.side * 0.12, 0, 1.0);
      A.elbow.rotation.set(0, 0, 0.55);
      A.pole.rotation.set(A.side * 0.1, 0, -1.45);
    }
  }
  /** Standing in a cabin or a carriage: upright, looking out; round 7: the skis are carried, upright beside him in the right hand
   *  (tips up, bases together), the poles stay hidden (they would poke through the floor). */
  function poseStand(t) {
    tilt.rotation.set(0, 0, 0); tilt.position.set(0, 0, 0); lean.rotation.set(0, 0, 0);
    torso.rotation.set(0, 0, -0.04);
    neck.rotation.set(0, Math.sin(t * 0.35) * 0.35, 0.05);
    for (let i = 0; i < 2; i++) {
      const A = arms[i];
      if (A.side > 0) { A.sh.rotation.set(-0.32, 0, 0.42); A.elbow.rotation.set(0, 0, 0.95); }      // the right hand round the skis
      else { A.sh.rotation.set(0.1, 0, 0.12); A.elbow.rotation.set(0, 0, 0.35); }
    }
    for (let i = 0; i < 2; i++) {
      const sk = skis[i];
      sk.g.position.set(0.3, 0.9, 0.4 + i * 0.05);
      sk.g.rotation.set(0, 0, Math.PI / 2 - 0.05);
      sk.edge.rotation.set(Math.PI / 2, 0, 0);
    }
  }
  /** R7-B: walking with the skis on the right shoulder (boarding a cabin, in it, out of the top station); walk = metres walked (gait). */
  function poseCarry(t, walk) {
    poseStand(t);
    const ph = walk * 2.6;
    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      const sw = walk > 0 ? Math.sin(ph + (i ? Math.PI : 0)) * 0.38 : 0;
      L.hip.rotation.z += sw;
      L.knee.rotation.z -= walk > 0 ? Math.max(0, -Math.sin(ph + (i ? Math.PI : 0))) * 0.5 : 0;
      L.ankle.rotation.z -= sw * 0.6;
      // the skis on the shoulder, base to base, tips forward and up
      const sk = skis[i];
      sk.g.position.set(0.02, 1.52 + i * 0.03, 0.2 + i * 0.035);
      sk.g.rotation.set(0, 0, 0.5);
      sk.edge.rotation.set(1.5, 0, 0);
    }
    root.position.y += walk > 0 ? Math.abs(Math.sin(ph)) * 0.035 : 0;
    const A = arms.find((a) => a.side > 0) || arms[1];
    A.sh.rotation.set(-0.25, 0, 2.35);                 // the right hand up on the skis
    A.elbow.rotation.set(0, 0, 1.75);
    const B = arms.find((a) => a !== A);
    B.pole.rotation.set(0.05, 0, -0.1);                 // the poles in the other hand, pointing down
  }
  /** Pulled up a drag lift (round 7): STANDING upright in the track, leaning back a little against the bar, both skis flat on the
   *  snow along the slope (the body does not tilt with the slope: that looked like sitting), knees soft, a small sideways wobble; one hand
   *  on the bar's pole, the poles in the other hand. slopePitch = the track's pitch (rad, + = climbing). */
  /** R8e: the arm A's hand on a world point (two-bone IK in the torso frame: the shoulder's roll picks the arm's plane, then the
   *  shoulder and elbow bends in it; upper arm and forearm 0.3 m each). */
  const ikV = new THREE.Vector3();
  function reachHand(A, target) {
    root.updateMatrixWorld(true);
    ikV.set(target.x, target.y, target.z);
    torso.worldToLocal(ikV);
    const dx = ikV.x - A.sh.position.x, dy = ikV.y - A.sh.position.y, dz = ikV.z - A.sh.position.z;
    const q = Math.hypot(dy, dz) || 1e-6, rx = Math.atan2(-dz, -dy);
    const px = dx, py = -q, r = Math.min(0.595, Math.max(0.12, Math.hypot(px, py)));
    const e = Math.acos(clamp((r * r - 0.18) / 0.18, -1, 1)), phi = Math.atan2(px, -py);
    A.sh.rotation.set(rx, 0, phi - e / 2);
    A.elbow.rotation.set(0, 0, e);
  }
  /* Standing lifts (28 Nov 2026; Ian, iPad: "on a T-bar the skis stay level with the world, they stick into the mountain"): pulled up a
   * drag lift or carried on a belt the body stays upright (leaning into the pull), each ski lies on the snow under it: its pitch and
   * roll come from the ground at its tip, tail and edges (slopeUnder), the knee takes the height (legLift), the boot follows the ski.
   * (Before, the skis were pitched by the slope with the wrong sign: on a 24 deg T-bar the tips sat 0.9 m deep in the snow.)
   * ground(x, z) = the snow (a carpet: the belt's top), heading = the rider's. */
  const SKI_HALF = 0.8, SKI_WIDE = 0.14, gp = new THREE.Vector3(), slope = { pitch: 0, roll: 0 };
  /** The ground's pitch (rad, + = rising ahead) and roll (rad, + = the right (+z) side lower) under a ski / the board at (x, z). */
  function slopeUnder(x, z, heading, half, wide, ground, out) {
    const fx = Math.cos(heading), fz = Math.sin(heading), rx = -fz, rz = fx;     // forward and the lean frame's +z in the world
    out.pitch = Math.atan2(ground(x + fx * half, z + fz * half) - ground(x - fx * half, z - fz * half), 2 * half);
    out.roll = -Math.atan2(ground(x + rx * wide, z + rz * wide) - ground(x - rx * wide, z - rz * wide), 2 * wide);
    return out;
  }
  /** Both skis on the ground under them (see above): legs from legH / legZ (legLift found here), hips shifted by hipShift m. */
  function plantStanding(ground, heading, hipShift = 0) {
    const rollFix = lean.rotation.x;
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < 2; i++) {
        const L = legs[i], sk = skis[i];
        setLeg(i, 0);
        L.hip.position.x += hipShift; sk.g.position.x += hipShift;
        sk.g.updateWorldMatrix(true, false);
        gp.setFromMatrixPosition(sk.g.matrixWorld);
        slopeUnder(gp.x, gp.z, heading, SKI_HALF, SKI_WIDE, ground, slope);
        sk.g.rotation.set(0, 0, slope.pitch);
        sk.edge.rotation.set(slope.roll - rollFix, 0, 0);
        L.ankle.rotation.x += slope.roll - rollFix; L.ankle.rotation.z += slope.pitch;       // the boot with its ski
        if (pass === 3) continue;
        sk.edge.updateWorldMatrix(true, false);
        legLift[i] = clamp(legLift[i] - (skiClear(i, ground) - 0.006), -0.15, 0.5);          // the knee takes it
      }
    }
    root.updateMatrixWorld(true);
    lastClear = Math.min(skiClear(0, ground), skiClear(1, ground));
    if (lastClear < -0.004) { root.position.y -= lastClear - 0.002; root.updateMatrixWorld(true); lastClear = Math.min(skiClear(0, ground), skiClear(1, ground)); }
  }
  /** Standing on the skis on a lift: pull = on a drag lift (leaning back against the bar, one hand on it, the pole hanging from it),
   *  else on a carpet's belt (upright, poles in the hands). */
  function poseDrag(t, ground, heading, hand = null, pull = true) {
    tilt.rotation.set(0, 0, 0); tilt.position.set(0, 0, 0);
    lean.rotation.set(Math.sin(t * 1.7) * (pull ? 0.03 : 0.012), 0, 0);
    for (let i = 0; i < 2; i++) { legH[i] = pull ? 0.84 : 0.86; legLift[i] = 0; legZ[i] = legs[i].side * 0.12; }
    plantStanding(ground, heading, pull ? -0.04 : 0);
    torso.position.set(pull ? -0.08 : -0.03, pull ? 0.84 : 0.86, 0);
    torso.rotation.set(0, 0, pull ? 0.12 : -0.08);           // leaning back against the bar / a little forward on the belt
    neck.rotation.set(0, 0, pull ? -0.05 : 0.12);
    const A = arms[1];
    // R8 (early QA: the hand was raised over the head): the hand holds the bar's stem at chest height, the ski pole hangs down from it
    if (pull) { A.sh.rotation.set(-0.3, 0, 0.85); A.elbow.rotation.set(0, 0, 1.0); A.pole.rotation.set(0.1, 0, -1.6); }
    else { A.sh.rotation.set(-0.15, 0, 0.45); A.elbow.rotation.set(0, 0, 0.6); A.pole.rotation.set(0.12, 0, -1.1); }     // (the tips back, over the belt)
    const B = arms[0];
    B.sh.rotation.set(0.15, 0, pull ? 0.35 : 0.45); B.elbow.rotation.set(0, 0, pull ? 0.5 : 0.6); B.pole.rotation.set(-0.1, 0, pull ? -0.6 : -1.1);
    if (pull && hand) reachHand(A, hand);                    // R8e: the hand on the rod (liftride.js riderAt: hand)
  }

  /** Two-bone leg: hip at height h above the ankle; returns [hip angle (forward), knee bend, hip x offset]. */
  function solveLeg(h) {
    const d = clamp(h, 0.35, THIGH + SHIN - 0.02);
    const a1 = Math.acos(clamp((d * d + THIGH * THIGH - SHIN * SHIN) / (2 * d * THIGH), -1, 1));
    const kb = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1));
    return [a1, kb];
  }

  /* round 7: one leg from its hip height (lean frame) with its foot lifted by legLift[i] (the terrain IK below): the hip stays, the knee
   * bends more, the ski rises; the skis never cut into the snow when the body leans into a carve */
  const legH = [0.88, 0.88], legLift = [0, 0], legZ = [-0.11, 0.11];
  // R8e (3V QA: plough at 0-7 km/h "parallel / crossed"; R8b sheets: at a stop "one ski across beside him"): the old V turned skis
  // 0.29 m out by 0.34 rad (the tips crossed: 0.29 - 0.95 sin 0.34 < 0) while the boots stayed ~0.18 m out, off the bindings. Now the
  // legs spread in the plough (the hip rolls the leg out round the forward axis, the knees a little in) and each ski sits exactly under
  // its boot (forward kinematics of hip -> knee -> ankle below); feet ~0.29 m out, skis turned 0.24 rad: tips ~12 cm apart, tails
  // ~0.95 m, a 27 deg V
  const PLOUGH_FOOT = 0.29, PLOUGH_YAW = 0.24, PLOUGH_KNEE = 0.16;
  const fkA = new THREE.Matrix4(), fkB = new THREE.Matrix4(), fkE = new THREE.Euler(), fkV = new THREE.Vector3(), fkT = new THREE.Vector3();
  /** The ankle relative to the hip (lean frame axes) for hip roll a, hip bend a1, knee roll k, knee bend kb (the Euler order of the groups). */
  function footOffset(a, a1, k, kb, out) {
    fkA.makeRotationFromEuler(fkE.set(a, 0, a1));
    fkB.makeRotationFromEuler(fkE.set(k, 0, -kb));
    out.set(0, -SHIN, 0).applyMatrix4(fkB).add(fkT.set(0, -THIGH, 0)).applyMatrix4(fkA);
    return out;
  }
  /** footZ (28 Nov 2026, the snowboard): the foot this far out from the middle (the hip rolls the leg out to it, like the plough). */
  function setLeg(i, plough = 0, footZ = null) {
    const L = legs[i], sk = skis[i];
    const reach = legH[i] - ANKLE - legLift[i];
    const [a1, kb] = solveLeg(reach);
    const hipX = -(THIGH * Math.sin(a1) + SHIN * Math.sin(a1 - kb));
    L.hip.position.set(hipX, legH[i], legZ[i]);
    let roll = 0, knee = 0;
    if (plough > 0.01 || footZ !== null) {
      // the roll that puts the foot PLOUGH_FOOT out (the leg's height shrinks a little as it rolls: two refinements), knees in
      knee = footZ !== null ? 0 : -L.side * plough * PLOUGH_KNEE;
      const want = footZ !== null ? footZ - legZ[i] : L.side * (Math.abs(legZ[i]) + (PLOUGH_FOOT - Math.abs(legZ[i])) * plough) - legZ[i];
      for (let it = 0; it < 3; it++) {
        footOffset(roll, a1, knee, kb, fkV);
        const h = Math.max(0.2, -fkV.y);
        roll += Math.asin(clamp((fkV.z - want) / h, -0.9, 0.9));
      }
    }
    L.hip.rotation.set(roll, 0, a1);
    L.knee.rotation.set(knee, 0, -kb);
    L.ankle.rotation.set(-(roll + knee) * 0.85, 0, -(a1 - kb));          // the boot back level across
    footOffset(roll, a1, knee, kb, fkV);
    sk.g.position.set(hipX + fkV.x, legH[i] + fkV.y - ANKLE, legZ[i] + fkV.z);
  }
  const SKI_PTS = [[0.8, 0, 0.04], [0.8, 0, -0.04], [0, 0, 0.04], [0, 0, -0.04], [-0.78, 0, 0.04], [-0.78, 0, -0.04]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const wv = new THREE.Vector3();
  let lastClear = 0;
  /** Lowest point of ski i against the ground (m, < 0 = in the snow). */
  function skiClear(i, ground) {
    let m = Infinity;
    for (const p of SKI_PTS) { wv.copy(p).applyMatrix4(skis[i].edge.matrixWorld); m = Math.min(m, wv.y - ground(wv.x, wv.z)); }
    return m;
  }
  /** Plants both skis on the terrain: a ski under the snow (lean, edge, a cross slope, a bump under the tip) is lifted by bending its
   *  knee more; two passes (a lift changes the ski's tilt only a little). */
  function plantSkis(ground, plough) {
    const k = Math.max(0.5, Math.cos(lean.rotation.x) * Math.cos(tilt.rotation.z));
    for (let pass = 0; pass < 4; pass++) {
      root.updateMatrixWorld(true);
      let moved = false;
      for (let i = 0; i < 2; i++) {
        const c = skiClear(i, ground);
        if (c < -0.004) { legLift[i] = Math.min(0.55, legLift[i] - c / k + 0.006); setLeg(i, plough); moved = true; }
      }
      if (!moved) break;
    }
    root.updateMatrixWorld(true);
    lastClear = Math.min(skiClear(0, ground), skiClear(1, ground));
    // a knee can only bend so far (a hard edge set on a steep side slope): what is left lifts the whole figure a little
    if (lastClear < -0.004) { root.position.y -= lastClear - 0.002; root.updateMatrixWorld(true); lastClear = Math.min(skiClear(0, ground), skiClear(1, ground)); }
  }
  /* ---------- the snowboard (28 Nov 2026) ---------- */
  const bv = new THREE.Vector3(), bX = new THREE.Vector3(), bY = new THREE.Vector3(), bZ = new THREE.Vector3(), bM = new THREE.Matrix4();
  const BOARD_PTS = [[0.76, 0.09], [0.76, -0.09], [0.5, 0.135], [0.5, -0.135], [0, 0.124], [0, -0.124], [-0.5, 0.135], [-0.5, -0.135], [-0.76, 0.09], [-0.76, -0.09]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  function boardClear(ground) { let m = Infinity; for (const p of BOARD_PTS) { bv.copy(p).applyMatrix4(board.matrixWorld); m = Math.min(m, bv.y - ground(bv.x, bv.z)); } return m; }
  /** The board on the snow: its lowest point (the edge that bites when he leans) touches it; the whole figure lifts with it. */
  function plantBoard(ground) {
    root.updateMatrixWorld(true);
    const c = boardClear(ground);
    if (c < -0.002) { root.position.y -= c - 0.001; root.updateMatrixWorld(true); }
    lastClear = boardClear(ground);
  }
  /** The board by a basis (X = the nose, Y = the top, Z = the toe edge; lean frame) with its point p (its own frame) at lean-frame w. */
  function placeBoard(X, Y, Z, p, w) {
    bM.makeBasis(X, Y, Z);
    board.quaternion.setFromRotationMatrix(bM);
    bv.set(p[0], p[1], p[2]).applyQuaternion(board.quaternion);
    board.position.set(w.x - bv.x, w.y - bv.y, w.z - bv.z);
  }
  const lw = new THREE.Vector3();
  /** a point of the board (its own frame) in world space */
  const boardWorld = (x, y, z, out) => { board.updateMatrixWorld(true); return out.set(x, y, z).applyMatrix4(board.matrixWorld); };
  /** Sideways on the board: the feet in the bindings (regular: the left foot forward), knees flexed, the body facing the toe edge
   *  (+z), the chest a little open to the nose, the head looking down the line. edge > 0 = toe side (turning right), < 0 = heel side
   *  (sitting back, arms over the toes). plough = a skid (the board across, on the heel edge). Pushing on a flat: the back foot steps. */
  function poseBoardRide(state, t, edge, crouch, plough, air, popping) {
    stance.rotation.set(0, -Math.PI / 2, 0);
    board.position.set(0, 0, 0); board.rotation.set(0, 0, 0);
    const toe = Math.max(0, edge), heel = Math.max(0, -edge) + plough * 0.6;
    const shuffle = state.grounded && (state.push || 0) > 0 && state.speed < 3.5 ? 1 : 0;
    const tuckAir = popping ? -0.05 : air * (1 - crouch) * 0.26;
    const baseH = 0.85 - crouch * 0.3 - heel * 0.12 - toe * 0.05;
    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      legH[i] = baseH - tuckAir - (L.side > 0 ? toe * 0.04 : 0);
      legLift[i] = L.side > 0 && shuffle ? 0.08 * Math.max(0, Math.sin(t * 7)) : 0;      // the back foot out of its binding, stepping
      legZ[i] = L.side * 0.115;
      setLeg(i, 0, L.side * BOARD.foot);
      L.ankle.rotation.y = L.side < 0 ? BOARD.front : BOARD.back;
    }
    const hipY = baseH - tuckAir - 0.015;
    const [ta1, tkb] = solveLeg(hipY - ANKLE);
    torso.position.set(-(THIGH * Math.sin(ta1) + SHIN * Math.sin(ta1 - tkb)), hipY, 0);
    torso.rotation.set(0, 0.4 - heel * 0.12, -(0.2 + crouch * 0.72 + heel * 0.34 - toe * 0.04 + air * 0.08 + shuffle * 0.1));
    neck.rotation.set(0, 1.0 + heel * 0.1, 0.12 + crouch * 0.45 - heel * 0.1);
    for (let i = 0; i < 2; i++) {
      const A = arms[i], front = A.side < 0;
      // the front arm out towards the nose, the back arm low over the tail; heel side: both reach over the toes; air: wide
      A.sh.rotation.set(-A.side * ((front ? 0.6 : 0.4) + air * 0.45), 0, (front ? 0.32 : 0.12) + heel * 0.8 + crouch * 0.55 - toe * 0.12);
      A.elbow.rotation.set(0, 0, 0.42 + crouch * 0.45 + Math.sin(t * 2.2 + i) * 0.03);
    }
    if (smGrab > 0.35) reachHand(arms[1], boardWorld(0.02, 0.02, 0.135, lw));      // the grab: the back hand on the toe edge
  }
  /** Board on a drag lift: the front foot strapped, the free back foot on the board near it, sideways, leaning back on the bar. */
  /*  Standing lifts (28 Nov 2026): the board lies on the snow under it (pitch + roll from the ground at its nose, tail and edges), the
   *  feet go to it (the front one higher on a climb), the boots follow it; on a belt (pull false) he stands, hands low. */
  function poseBoardDrag(t, ground, heading, hand, pull = true) {
    tilt.rotation.set(0, 0, 0); tilt.position.set(0, 0, 0);
    lean.rotation.set(Math.sin(t * 1.7) * (pull ? 0.025 : 0.01), 0, 0);
    stance.rotation.set(0, -Math.PI / 2, 0);
    slopeUnder(root.position.x, root.position.z, heading, 0.7, BOARD.halfWidth, ground, slope);
    board.position.set(0, 0, 0); board.rotation.set(slope.roll - lean.rotation.x, 0, slope.pitch);
    for (let i = 0; i < 2; i++) {
      const L = legs[i], front = L.side < 0;
      const footZ = L.side * (front ? BOARD.foot : BOARD.foot * 0.55);
      legH[i] = 0.84; legLift[i] = clamp(-footZ * Math.tan(slope.pitch), -0.15, 0.5);   // (the stance's z is the board's -x)
      legZ[i] = L.side * 0.115;
      setLeg(i, 0, footZ);
      L.ankle.rotation.y = front ? BOARD.front : 0;
      L.ankle.rotation.x += slope.pitch;                                                // the boot with the board
    }
    root.updateMatrixWorld(true);
    const c = boardClear(ground);
    if (c < -0.002) { root.position.y -= c - 0.001; root.updateMatrixWorld(true); }
    lastClear = boardClear(ground);
    torso.position.set(-0.05, 0.84, 0);
    torso.rotation.set(0, 0.55, pull ? 0.1 : -0.04);      // turned up the track, leaning back against the bar (a belt: upright)
    neck.rotation.set(0, 0.9, -0.05);
    arms[0].sh.rotation.set(0.35, 0, 0.3); arms[0].elbow.rotation.set(0, 0, 0.5);
    if (pull) { arms[1].sh.rotation.set(-0.3, 0, 0.85); arms[1].elbow.rotation.set(0, 0, 1.0); }
    else { arms[1].sh.rotation.set(-0.3, 0, 0.3); arms[1].elbow.rotation.set(0, 0, 0.5); }
    if (pull && hand) reachHand(arms[1], hand);
  }
  /** On a lift without riding it: strapped to the front foot on a chair, lying across on the footrest (like the skis), upright in
   *  the right hand in a cabin, held by its top edge walking. */
  function placeBoardRide(ride) {
    if (ride === 'sit') {
      legs[0].ankle.getWorldPosition(lw); lean.worldToLocal(lw); lw.y -= ANKLE;
      placeBoard(bX.set(0, 0, -1), bY.set(0, 1, 0), bZ.set(1, 0, 0), [BOARD.foot, 0, 0], lw);     // across the chair on the footrest
    } else if (ride === 'stand' || ride === 'carry') {
      const walking = ride === 'carry';
      lw.set(walking ? 0.04 : 0.2, walking ? 0.7 : 0.82, walking ? 0.36 : 0.42);
      if (walking) placeBoard(bX.set(Math.cos(0.12), Math.sin(0.12), 0), bY.set(0, 0, -1), bZ.set(-Math.sin(0.12), Math.cos(0.12), 0), [0, 0, 0], lw);
      else placeBoard(bX.set(0, 1, 0), bY.set(0, 0, 1), bZ.set(1, 0, 0), [0, 0, 0], lw);
      reachHand(arms[1], boardWorld(walking ? 0.05 : 0.25, 0.01, walking ? 0.13 : 0.1, bv));
    }
  }
  const tmp = { x: 0, y: 1, z: 0 };
  const qN = new THREE.Quaternion(), qH = new THREE.Quaternion(), nv = new THREE.Vector3(), Y_AXIS = new THREE.Vector3(0, 1, 0);
  let lastEdge = 0, plant = 0, plantSide = 1, prevT = 0, smEdge = 0, smCrouch = 0, smPlough = 0, smAir = 0, lastGrab = 0, smGrab = 0;
  const HIP_PIVOT = 0.85;                    // flips turn the body round the hips, not the feet
  /* standing lifts: the ground the skis stand on (pose(): the snow, else the plane by the slope normal under him; a carpet: its belt) */
  let standX = 0, standY = 0, standZ = 0, baseGround = null, beltFx = 1, beltFz = 0, beltTan = 0;
  const planeGround = (x, z) => standY - (tmp.x * (x - standX) + tmp.z * (z - standZ)) / Math.max(0.2, tmp.y);
  const beltGround = (x, z) => baseGround(x, z) + BELT_TOP;
  // (the local rider on a carpet: state.beltPitch = the belt's own pitch (liftride.js): a plane through his feet, level across)
  const beltPlane = (x, z) => standY + ((x - standX) * beltFx + (z - standZ) * beltFz) * beltTan;
  /** state = physics state; normal(x, z, out) = slope normal; t = time (s); ground(x, z) = snow height (for the blob in the air). */
  function pose(state, normal, t, ground) {
    const dt = clamp(t - prevT, 0, 0.1); prevT = t;
    const k = 1 - Math.exp(-dt * 12);
    root.position.set(state.x, state.y, state.z);
    root.rotation.set(0, -state.heading, 0);
    normal(state.x, state.z, tmp);
    const fx = Math.cos(state.heading), fz = Math.sin(state.heading);
    const along = tmp.x * fx + tmp.z * fz;                          // > 0 when the slope falls away ahead
    const across = -tmp.x * fz + tmp.z * fx;
    tilt.rotation.set(0, 0, -Math.atan2(along, tmp.y) * (state.grounded ? 1 : 0.4));
    // round 4A tricks: a flip pitches the whole figure round the hips; a grab (the trick button held in the air) pulls the knees up
    // and one hand down to the ski
    const flip = !state.grounded && state.flip ? -state.flip : 0;
    if (flip) { tilt.rotation.z += flip; tilt.position.set(HIP_PIVOT * Math.sin(flip), HIP_PIVOT * (1 - Math.cos(flip)), 0); } else tilt.position.set(0, 0, 0);
    const grabbing = !state.grounded && (state.grab || 0) > lastGrab;
    lastGrab = state.grounded ? 0 : state.grab || 0;
    smGrab += ((grabbing ? 1 : 0) - smGrab) * Math.min(1, dt * 14);
    // smoothed drivers
    smEdge += (clamp(state.edge, -1.1, 1.1) - smEdge) * k;
    const landing = state.landed > 0 ? Math.sin(Math.min(1, state.landed / 0.35) * Math.PI) : 0;
    // launch fix: the jump's crouch (state.jumpWind) dips fast, the first ~0.3 s after the pop the legs stretch (then knees up)
    const winding = (state.jumpWind || 0) > 0 && state.grounded;
    smCrouch += (clamp(state.tuck * 0.95 + landing * 0.8 + smGrab + (state.stop || 0) * 0.25 + (winding ? 0.9 : 0), 0, 1) - smCrouch) * (winding ? 1 - Math.exp(-dt * 40) : k);
    // round 7: the hockey stop is no plough; R8e: standing on the brake (held at 0 km/h) keeps the V (R8 dropped it there because the V
    // crossed its tips); a placed / waiting skier (brake released) stands parallel
    smPlough += (clamp(state.brake, 0, 1) * (1 - clamp(state.stop || 0, 0, 1)) - smPlough) * k;
    smAir += ((state.grounded ? 0 : Math.min(1, state.air * 2.5)) - smAir) * k;
    const edge = smEdge, crouch = smCrouch, plough = smPlough, air = smAir;
    // pole plant when the turn changes side at speed
    if (Math.sign(edge) !== Math.sign(lastEdge) && Math.abs(edge) > 0.15 && state.speed > 4 && state.grounded) { plant = 1; plantSide = edge > 0 ? 1 : -1; }
    lastEdge = Math.abs(edge) > 0.15 ? edge : lastEdge;
    plant = Math.max(0, plant - dt * 2.6);
    // whole-body lean into the turn (and the slope's own side tilt), skis on edge
    // R8e: standing (the end of a hockey stop) the body is over the skis, the edges set by the knees (angulation), not leaning 35 deg
    const leanK = 0.35 + 0.65 * smoothstep(0.5, 5, state.speed);
    lean.rotation.set(edge * 0.62 * leanK + Math.atan2(across, tmp.y) * 0.2 * (state.grounded ? 1 : 0) - (boarding ? plough * 0.22 : 0), 0, 0);
    const skiEdge = edge * 0.45;
    const ride = state.ride || '';
    const popping = !state.grounded && (state.jumpCd || 0) > 0.3;          // just popped (jumpCooldown 0.6): legs long
    // 28 Nov 2026: on the board (riding, on the snow at a station, on a drag lift / a belt); seated / in a cabin / walking: the ski stance
    const boardStance = boarding && ride !== 'sit' && ride !== 'stand' && ride !== 'carry';
    if (boardStance) {
      poseBoardRide(state, t, edge, crouch, plough, air, popping);
      if (!ride) root.rotation.y += plough * 1.15;                            // a skid: the board across, the rider facing down the line
    } else {
    stance.rotation.set(0, 0, 0);
    // legs
    const baseH = 0.88 - crouch * 0.36 - plough * 0.19;       // athletic stance: knees and ankles flexed (round 7: lower in the plough)
    const tuckAir = popping ? -0.05 : air * (1 - crouch) * 0.22;           // knees pulled up in the air
    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      const inside = Math.sign(edge) === L.side ? 1 : 0;     // the leg on the inside of the turn (edge > 0: turning right, the right leg)
      legH[i] = baseH - inside * Math.abs(edge) * 0.2 - tuckAir;
      legLift[i] = 0;
      legZ[i] = L.side * (0.11 + plough * 0.07 + (state.speed < 5 && state.grounded && !plough ? 0.03 : 0));
      setLeg(i, plough);
      const sk = skis[i];
      sk.g.rotation.set(0, L.side * plough * PLOUGH_YAW, 0);             // tips in, tails out (Ry(+) turns the +x tip towards -z)
      sk.edge.rotation.set(skiEdge - L.side * plough * 0.2, 0, air * 0.12);       // on the inside edges
    }
    // torso: forward bend with the crouch, counter-roll against the lean (angulation), a little back in the plough
    const hipY = baseH - Math.abs(edge) * 0.1 - tuckAir;
    const [ta1, tkb] = solveLeg(hipY - ANKLE);
    const pelvisX = -(THIGH * Math.sin(ta1) + SHIN * Math.sin(ta1 - tkb));
    torso.position.set(pelvisX, hipY, 0);
    torso.rotation.set(-edge * 0.32, 0, -(0.22 + crouch * 0.95 + plough * 0.24 + air * 0.1));      // round 7: forward in the plough, not back
    neck.rotation.set(edge * 0.15, 0, 0.25 + crouch * 0.75);          // keep the eyes on the slope ahead
    // arms: forward and out; tuck: hands in front of the face, poles back under the arms; air: wide; plant: the inside pole reaches forward
    for (let i = 0; i < 2; i++) {
      const A = arms[i];
      const p = plant * (A.side === plantSide ? 1 : 0);
      A.sh.rotation.set(-A.side * (0.18 + air * 0.7 + plough * 0.1 - crouch * 0.12), 0, 0.55 + crouch * 1.05 + p * 0.45 + air * 0.25);
      A.elbow.rotation.set(0, 0, 0.55 + crouch * 0.85 - air * 0.3 + Math.sin(t * 2.6 + i) * 0.02);
      if (smGrab > 0.05 && A.side > 0) {                         // the grab hand reaches down the outside of the right ski
        A.sh.rotation.set(-0.35 * smGrab, 0, A.sh.rotation.z + (1.9 - A.sh.rotation.z) * smGrab);
        A.elbow.rotation.z += (0.15 - A.elbow.rotation.z) * smGrab;
      }
      A.pole.rotation.set(A.side * 0.12, 0, -(0.95 + crouch * 1.25) + p * 0.75);       // poles trail back, tips near the snow
    }
    }
    // crash: roll over and slide, then lie still
    if (state.crash > 0) {
      const ct = CRASH_S - state.crash;                         // 0 .. 1.6 s since the fall
      const tumbling = ct < 0.85;
      // first a cartwheel over the shoulder (lifted clear of the snow), then lying face down the slope, sliding to a stop
      lean.rotation.set(tumbling ? ct * 8.4 : 0.35, 0, 0);
      tilt.rotation.set(0, Math.sin(ct * 5) * 0.4 * Math.exp(-ct), tumbling ? -0.6 : -1.38);
      for (const A of arms) { A.sh.rotation.set(-A.side * (1.3 + Math.sin(ct * 11 + A.side) * 0.5), 0, 1.6); A.pole.rotation.z = -0.4 + Math.sin(ct * 9) * 0.8; }
      if (!boarding) for (let i = 0; i < 2; i++) skis[i].g.rotation.set(Math.sin(ct * 13 + i) * 0.5, (i ? 0.5 : -0.4) * Math.min(1, ct * 3), 0);
      root.position.y += tumbling ? 0.75 * Math.sin(Math.min(1, ct / 0.85) * Math.PI) + 0.25 : 0.3;
    }
    // round 6: riding a lift: seated on a chair, standing in a cabin (skis and poles in the rack), pulled up a drag lift
    const hideGear = ride === 'stand' || boarding;
    if (hideGear !== gearHidden) { gearHidden = hideGear; for (const p of poles) p.visible = !hideGear; }      // round 7: skis carried, poles away
    if (ride === 'sit') poseSit(t);
    else if (ride === 'stand') poseStand(t);
    else if (ride === 'drag' || ride === 'belt') {
      // standing lifts (28 Nov 2026): the skis / the board on the snow (a carpet: on its belt) under them, the body upright
      standX = state.x; standY = state.y; standZ = state.z; baseGround = ground || planeGround;
      const onBelt = ride === 'belt', planar = onBelt && Number.isFinite(state.beltPitch);
      if (planar) { beltFx = Math.cos(state.heading); beltFz = Math.sin(state.heading); beltTan = Math.tan(state.beltPitch); }
      const g = planar ? beltPlane : onBelt ? beltGround : baseGround, pull = ride === 'drag';
      if (boarding) poseBoardDrag(t, g, state.heading, state.dragHand, pull); else poseDrag(t, g, state.heading, state.dragHand, pull);
    } else if (ride === 'carry') poseCarry(t, state.walk || 0);         // R7-B ('skisdown' / 'clickin': the skis on the snow, standing)
    if (boarding && !boardStance) placeBoardRide(ride);
    // round 7: both skis on the snow (carving, plough, tuck, landing, a traverse): the leg IK against the real terrain
    // (standing lifts: also while putting the skis down / clicking in at the top of a cabin ride)
    if (ground && state.grounded && state.crash <= 0 && (!ride || ride === 'skisdown' || ride === 'clickin')) { if (boarding) plantBoard(ground); else plantSkis(ground, plough); }
    else if (ride !== 'drag' && ride !== 'belt') lastClear = 0;           // (a standing lift's pose planted them above)
    // blob under the skis
    if (blob.visible) {
      const gy = ground ? ground(state.x, state.z) : state.y;
      blob.position.set(state.x, gy + 0.06, state.z);
      qN.setFromUnitVectors(Y_AXIS, nv.set(tmp.x, tmp.y, tmp.z));          // lie on the slope
      qH.setFromAxisAngle(Y_AXIS, -state.heading);
      blob.quaternion.copy(qN).multiply(qH);
      const up = clamp(state.y - gy, 0, 6);
      blob.material.opacity = 0.38 * (1 - up / 7);
      blob.scale.set(1.25 * (1 + up * 0.08), 1, 0.55 * (1 + up * 0.08));
    }
  }
  /** Round 7: first person: only what the skier sees of himself, the skis (their merged meshes under the ski groups) and the poles. */
  const gearGroups = new Set();
  for (const sk of skis) { sk.g.traverse((o) => gearGroups.add(o)); }
  for (const p of poles) p.traverse((o) => gearGroups.add(o));
  let firstPerson = false;
  function setFirstPerson(on) {
    firstPerson = !!on;
    if (skin) skin.fp = firstPerson;
    else for (const mesh of merged) mesh.visible = !firstPerson || gearGroups.has(mesh.parent);
    if (firstPerson) blob.visible = false;
  }
  /** Round 7 (A), tests: the world tips and tails of both skis [{ tip: {x, y, z}, tail: {x, y, z} }] after the last pose. */
  function skiEnds() {
    root.updateMatrixWorld(true);
    return skis.map((sk) => {
      const tip = new THREE.Vector3(0.95, 0, 0).applyMatrix4(sk.edge.matrixWorld), tail = new THREE.Vector3(-0.8, 0, 0).applyMatrix4(sk.edge.matrixWorld);
      return { tip: { x: tip.x, y: tip.y, z: tip.z }, tail: { x: tail.x, y: tail.y, z: tail.z } };
    });
  }
  const r3 = (e) => [e.x, e.y, e.z].map((v) => +v.toFixed(2));
  const bwA = new THREE.Vector3(), bwB = new THREE.Vector3();
  /** R8e, tests: world points of the gear after the last pose: { skis: [[x, y, z] x 12 per ski: the base corners + middle line], poles:
   *  [[x, y, z] every 0.2 m down each shaft], hands: [[x, y, z]], board: [[x, y, z] x 10: its edges, only on the snowboard] }. */
  function gearPoints() {
    root.updateMatrixWorld(true);
    const out = { skis: [], poles: [], hands: [], board: [] }, v = new THREE.Vector3();
    if (boarding) for (const p of BOARD_PTS) { v.copy(p).applyMatrix4(board.matrixWorld); out.board.push([v.x, v.y, v.z]); }      // 28 Nov 2026
    for (const sk of skis) for (const x of [0.95, 0.8, 0.5, 0.2, 0, -0.3, -0.6, -0.78]) for (const z of [-0.04, 0.04]) { v.set(x, 0, z).applyMatrix4(sk.edge.matrixWorld); out.skis.push([v.x, v.y, v.z]); }
    for (const p of poles) {
      if (!p.visible) continue;
      for (let y = 0.1; y <= 1.15; y += 0.2) { v.set(0, -y, 0).applyMatrix4(p.matrixWorld); out.poles.push([v.x, v.y, v.z]); }
      p.getWorldPosition(v); out.hands.push([v.x, v.y, v.z]);
    }
    return out;
  }
  /** R8e, tests: the largest distance (m) of a boot (ankle) from straight above its ski's binding, in the ski's frame, after the last pose. */
  function bootGap() {
    root.updateMatrixWorld(true);
    let m = 0;
    for (let i = 0; i < 2; i++) { legs[i].ankle.getWorldPosition(bwA); skis[i].g.worldToLocal(bwA); m = Math.max(m, Math.hypot(bwA.x, bwA.z)); }      // in the ski's own frame (above the binding)
    return m;
  }
  return { root: group, slots: SLOTS, pose, setOutfit, setSki, setBoard, get board() { return boarding; }, setFirstPerson, skiEnds, bootGap, gearPoints, debugSkis: () => skis.map((sk) => ({ g: r3(sk.g.rotation), gp: r3(sk.g.position), e: r3(sk.edge.rotation) })), get skiClearance() { return lastClear; }, get firstPerson() { return firstPerson; }, setBlob(on) { blob.visible = !!on && !ghost && !firstPerson; }, setVisible(v) { group.visible = v; } };
}
