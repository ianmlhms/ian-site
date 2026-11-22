/* Round 7-B: the stations of every lift and what happens around them (pure: no THREE, no DOM; lifts.js draws exactly these parts, the
 * Node tests check them, modes/freeride.js and modes/liftride.js use the boarding zones, the loading points and the exits).
 *   createLiftSite(path)       both stations of one lift (lift-path.js createLiftPath), by its class:
 *       chair    'platform'  a loading deck flush with the snow, a canopy over the bull-wheel on four posts, the operator's hut on the
 *                            return side, boarding gates on the outer side (the waiting zone is behind them, out of the chairs' lane)
 *       gondola  'hall'      an open hall: roof on posts, a closed back wall behind the wheel and a glazed wall on the return side;
 *                            the cabins run through it, the platform on the outer side
 *       cable    'terminal'  the cabin docks under a roof in front of the machine building
 *       drag     'hut'       the bull-wheel on its mast, the operator's hut beside the track start (rope tows: smaller)
 *       carpet   'belt'      the belt's ends (the belt itself is drawn by lifts.js)
 *       train    'rail'      a platform hall over both tracks with a buffer wall; tunnel lines get a portal where they dive in
 *     Every part is an oriented box in the station's own frame: a along the outward line direction (a > 0 = behind the wheel, away from
 *     the line), b across it (+b = the up lane's side, the outer side where riders board and get off), y above the station ground.
 *     `solid` parts collide (skier, carriers, exits); the rest (decks, wheels, signs) is only drawn.
 *   createLiftWorld(paths)     all sites of a resort: the boarding zone at (x, z), the skier colliders (pylons, posts, huts, walls), the
 *                              exit spot at a top (outside every station and building, on snow, facing downhill, 15 m clear ahead),
 *                              which buildings stand in a station or a lift lane (the village leaves them out), and where trees must
 *                              not stand (the lift aisles, the stations, the pylon bases). */
import { liftClass, BOARD, UNLOAD } from './lift-path.js';

export { BOARD, UNLOAD };
/** Half widths of the tree aisle along the line (m) and the height of the rope over the treetops above which trees may stay. */
export const AISLE = Object.freeze({ chair: 8, gondola: 9, cable: 12, drag: 7, rope: 5.5, carpet: 4.5, train: 8 });
export const AISLE_HIGH = 15;                   // m between the carriers' lowest point and the treetops where the forest may stay
export const TREE_TOP = 17;                     // m: the tallest tree of scatter-view.js (10 m x scale 1.65 + margin)
const PYLON_R = 0.45;                           // m: a pylon column (collider and checks)
const COL = Object.freeze({ concrete: 0xaeaba3, stone: 0x78706a, timber: 0x80563a, glass: 0x33424f, steel: 0x6b7585, wheel: 0x3e4249, snow: 0xf3f5fb, accent: 0xc8332a, deck: 0x8d8478, gate: 0xf2b21c, dark: 0x2b2f36, rubber: 0x23262b, light: 0xfff2c6, batten: 0x5b3d28, plinth: 0x8f8b84, housing: 0xd9dde2, housingDark: 0x5d6570, fascia: 0x23272e });
export { COL as SITE_COLOURS };

/** The station key of a path: the class, but rope tows have their own (smaller) layout. */
export const siteKey = (path) => (path.kind === 'drag' && path.sub === 'rope' ? 'rope' : path.kind);

/** One lift's stations (path = createLiftPath). */
export function createLiftSite(path) {
  const key = siteKey(path);
  const { side, back, len } = path;
  const cb = path.carrier;
  const R = path.wheelR || 0, C = path.wheelC || 0;
  const wheelOf = (which) => (path.kind === 'train' || path.kind === 'carpet' ? 0 : path.cableY(which ? path.len : 0) - path.ground(which ? path.len : 0));
  const loop = !path.shuttle;
  const bIn = -back - cb.hw - 0.6, bOut = side + cb.hw + 0.6;          // the carriers' lanes (and their swing)
  const aBack = loop ? R + cb.hl + 0.6 : 0.6;                          // how far the loop bulges behind the end
  const boardS = Math.min(BOARD[key], len * 0.2), unloadS = Math.min(UNLOAD[key], len * 0.2);
  const ends = [makeEnd(0), makeEnd(1)];

  function makeEnd(which) {
    const s = which ? len : 0;
    const q = path.at(s, {});
    const fx = which ? q.dx : -q.dx, fz = which ? q.dz : -q.dz;          // outward
    const rx = -q.dz * path.sign, rz = q.dx * path.sign;                  // the up lane's side (the same at both ends)
    const wheel = wheelOf(which);
    const front = -Math.min(len * 0.42, 40);                              // the farthest a station reaches along the line
    const parts = [];
    const add = (a0, a1, b0, b1, y0, y1, col, solid = true, extra = {}) => parts.push({ a0: Math.max(front, Math.min(a0, a1)), a1: Math.max(front + 0.3, Math.max(a0, a1)), b0: Math.min(b0, b1), b1: Math.max(b0, b1), y0, y1, col, solid, ...extra });
    const post = (a, b, y1, r = 0.2, col = COL.steel) => add(a - r, a + r, b - r, b + r, 0, y1, col, true, { post: true });
    // R8 detail (coordinator review: 'plain grey box' stations): drawn only, never a collider, cut with a neighbour's carrier path like
    // the caps; all of it lands in the same merged station chunk (no extra draw call)
    const det = (a0, a1, b0, b1, y0, y1, col, extra = {}) => add(a0, a1, b0, b1, y0, y1, col, false, { cap: true, detail: true, ...extra });
    /** The drive housing over a bull-wheel (centre a = 0, b = C) sitting on a roof at y: the motor house, its darker base, vents. */
    const housing = (y, len, wid, high) => {
      const ha0 = -Math.min(len, Math.max(1.6, R + 0.6)), ha1 = Math.min(len, Math.max(1.6, R + 0.6));
      det(ha0, ha1, C - wid, C + wid, y, y + 0.35, COL.housingDark);
      det(ha0 + 0.1, ha1 - 0.1, C - wid + 0.1, C + wid - 0.1, y + 0.35, y + high, COL.housing);
      det(ha0 + 0.05, ha1 - 0.05, C - wid + 0.05, C + wid - 0.05, y + high, y + high + 0.18, COL.housingDark);
      det(ha0 + 0.05, ha1 - 0.05, C - wid + 0.05, C + wid - 0.05, y + high * 0.72, y + high * 0.86, COL.accent);       // the lift company's red band
      for (const db of [-wid + 0.6, wid - 0.6]) det(ha0 + 0.6, ha1 - 0.6, C + db - 0.25, C + db + 0.25, y + high * 0.55, y + high * 0.8, COL.dark);
    };
    /** A lift-name sign board (lifts.js writes the name on it): face = +1 / -1 along b, the board's centre a, its y. */
    const nameSign = (a, b, y, w, h, face) => det(a - w / 2, a + w / 2, b - 0.06, b + 0.06, y - h / 2, y + h / 2, COL.fascia, { sign: { face, w, h } });
    const at = (board) => (which ? -unloadS : -boardS) + (board ? 0 : 0);
    const work = at(true);
    let type = 'hut';
    if (key === 'chair') {
      type = 'platform';
      const roof = wheel + 0.9;
      add(-9, aBack + 1.5, bIn - 1.6, bOut + 4.4, -0.35, 0.04, COL.deck, false, { deck: true });
      add(-5, aBack + 1.2, bIn - 0.9, bOut + 0.9, roof, roof + 0.4, COL.steel, true, { roof: true });
      add(-5.2, aBack + 1.4, bIn - 1.1, bOut + 1.1, roof + 0.4, roof + 0.72, COL.snow, false, { cap: true });
      for (const a of [-4.6, aBack + 0.8]) for (const b of [bIn - 0.5, bOut + 0.5]) post(a, b, roof);
      housing(roof + 0.72, aBack + 0.6, 1.25, 1.35);                                                     // R8: the drive on the canopy
      det(-5, aBack + 1.2, bOut + 0.9, bOut + 1.0, roof - 0.35, roof + 0.4, COL.accent);                 // R8: a red fascia
      nameSign(-0.6, bOut + 1.08, roof + 0.02, Math.min(4.6, aBack + 3.6), 0.62, 1);
      add(-4.4, -1.2, bIn - 4.4, bIn - 1.6, 0, 2.6, COL.timber, true, { hut: true });
      add(-4.6, -1.0, bIn - 4.6, bIn - 1.4, 2.6, 2.95, COL.snow, false, { cap: true });
      add(-4.3, -1.3, bIn - 1.58, bIn - 1.56, 1.2, 2.1, COL.glass, false);
      if (!which) {           // the boarding gates: posts with a gap where the rider passes, yellow bars, a sign
        for (const da of [-2.4, -0.8, 0.8, 2.4]) post(work + da, bOut + 0.6, 1.05, 0.06, COL.dark);
        for (const da of [-1.6, 1.6]) add(work + da - 0.7, work + da + 0.7, bOut + 0.57, bOut + 0.63, 0.82, 0.9, COL.gate, false);
        add(work - 2.5, work + 2.5, bOut + 0.55, bOut + 0.65, 1.05, 1.1, COL.dark, false);
      }
    } else if (key === 'gondola') {
      type = 'hall';
      const roof = wheel + 1.1, a0 = -14.5, a1 = aBack + 1.6, b0 = bIn - 2.2, b1 = bOut + 4.4;
      add(a0, a1, b0, b1, -0.35, 0.04, COL.deck, false, { deck: true });
      add(-11, -2, bOut + 0.2, bOut + 3.9, 0.04, 0.12, COL.concrete, false, { deck: true });          // the platform
      add(a0, a1 + 0.2, b0, b1, roof, roof + 0.55, COL.concrete, true, { roof: true });
      add(a0 - 0.2, a1 + 0.4, b0 - 0.2, b1 + 0.2, roof + 0.55, roof + 0.9, COL.snow, false, { cap: true });
      add(a1 - 0.4, a1, b0, b1, 0, roof, COL.concrete, true, { wall: true });                         // back wall
      add(a0 + 4, a1 - 0.4, b0, b0 + 0.4, 0, roof * 0.42, COL.timber, true, { wall: true });           // return side: low wall,
      add(a0 + 4, a1 - 0.4, b0 + 0.05, b0 + 0.35, roof * 0.42, roof, COL.glass, true, { wall: true });  // glazed above
      for (const a of [a0 + 0.3, a1 - 1.0]) post(a, b1 - 0.4, roof, 0.25, COL.concrete);       // (the platform side stays open)
      post(a0 + 0.3, b0 + 0.3, roof, 0.25, COL.concrete);
      add(a1 - 0.6, a1 - 0.4, bOut + 1, bOut + 3.5, 2.2, 3.4, COL.accent, false);                    // a sign board on the back wall
      // R8 detail: the roof reaches out over the platform and the front, a dark fascia with the lift's name on the platform side
      det(a0 - 1.4, a1 + 0.2, b1, b1 + 1.6, roof + 0.1, roof + 0.55, COL.concrete);
      det(a0 - 1.4, a0, b0, b1, roof + 0.1, roof + 0.55, COL.concrete);
      det(a0 - 1.6, a1 + 0.4, b1, b1 + 1.8, roof + 0.55, roof + 0.85, COL.snow);
      det(a0 - 1.6, a0, b0 - 0.2, b1, roof + 0.55, roof + 0.85, COL.snow);
      det(a0 - 1.4, a1 + 0.2, b1 + 1.5, b1 + 1.62, roof - 0.5, roof + 0.55, COL.fascia);
      det(a0 - 1.52, a0 - 1.4, b0, b1 + 1.62, roof - 0.5, roof + 0.55, COL.fascia);
      det(a0 - 1.4, a1 + 0.2, b1 + 1.62, b1 + 1.66, roof - 0.14, roof - 0.06, COL.accent);              // a red line along it
      nameSign((a0 + a1) / 2 - 1.5, b1 + 1.72, roof + 0.02, Math.min(9, (a1 - a0) * 0.55), 0.8, 1);
      // the drive: the motor house on the roof over the bull-wheel, the shaft down to the wheel
      housing(roof + 0.85, a1 - 0.6, 2.1, 2.2);
      det(-0.22, 0.22, C - 0.22, C + 0.22, wheel + 0.2, roof, COL.dark);
      // the back wall clad: a stone plinth, the upper part timber with dark battens, a window band (outside face, a = a1)
      det(a1, a1 + 0.12, b0, b1, -0.2, 1.1, COL.plinth);
      det(a1, a1 + 0.06, b0, b1, 1.1, roof, COL.timber);
      for (let b = b0 + 0.55; b < b1 - 0.3; b += 1.1) det(a1 + 0.06, a1 + 0.13, b - 0.06, b + 0.06, 1.1, roof - 1.6, COL.batten);
      det(a1 + 0.06, a1 + 0.1, b0 + 0.8, b1 - 0.8, roof - 1.55, roof - 0.5, COL.glass);
      for (let b = b0 + 0.8; b <= b1 - 0.8 + 1e-6; b += Math.max(1.2, (b1 - b0 - 1.6) / 6)) det(a1 + 0.1, a1 + 0.16, b - 0.05, b + 0.05, roof - 1.55, roof - 0.5, COL.fascia);
      // the glazed return side: mullions and a transom
      for (let a = a0 + 4.3; a < a1 - 0.5; a += 2.2) det(a - 0.06, a + 0.06, b0 - 0.04, b0 + 0.44, roof * 0.42, roof, COL.fascia);
      det(a0 + 4, a1 - 0.4, b0 - 0.04, b0 + 0.44, roof * 0.42 - 0.1, roof * 0.42 + 0.06, COL.fascia);
      // lights under the roof along the platform
      for (let a = a0 + 1.5; a < a1 - 1; a += 4) det(a - 0.45, a + 0.45, b1 - 0.9, b1 - 0.6, roof - 0.12, roof, COL.light);
      if (!which) {             // the entry gates at the platform's outer edge, open where the boarding zone is
        const za0 = -boardS - 2.6, za1 = -boardS + 2.6;
        for (let a = -12; a <= -1; a += 1.1) {
          if (a > za0 && a < za1) continue;
          det(a - 0.05, a + 0.05, b1 - 0.35, b1 - 0.25, 0, 1.0, COL.dark);
          if (a + 1.1 <= -1 && !(a + 1.1 > za0 && a + 1.1 < za1)) det(a, a + 1.1, b1 - 0.33, b1 - 0.27, 0.82, 0.9, COL.gate);
        }
      }
    } else if (key === 'cable') {
      type = 'terminal';
      const roof = wheel + 1.3, b0 = bIn - 3.6, b1 = bOut + 3.6;
      add(-13.5, 1.0, b0, b1, -0.4, 0.04, COL.deck, false, { deck: true });
      add(-11.4, 1.0, b0, b1, roof, roof + 0.6, COL.steel, true, { roof: true });              // over the docked cabin only
      add(-11.6, 1.2, b0 - 0.2, b1 + 0.2, roof + 0.6, roof + 0.95, COL.snow, false, { cap: true });
      for (const b of [b0 + 0.3, b1 - 0.3, -0.0]) post(-11.1, b, roof, 0.3, COL.concrete);
      // the machine building behind the dock (the track ropes are anchored in it)
      add(1.0, 9, b0 + 1.2, b1 - 1.2, 0, roof + 3.5, COL.concrete, true, { wall: true, building: true });
      add(0.9, 9.1, b0 + 1.1, b1 - 1.1, roof + 3.5, roof + 3.9, COL.snow, false, { cap: true });
      add(0.95, 1.0, b0 + 1, b1 - 1, wheel - 1.2, wheel + 0.8, COL.glass, false);
      nameSign(5, b1 - 1.1, roof + 2.4, 6.5, 0.9, 1);                                                    // R8
      for (const tr of [side, -back]) add(-0.2, 1.0, tr - 0.9, tr + 0.9, wheel - 0.6, wheel + 0.6, COL.wheel, false);
    } else if (key === 'drag' || key === 'rope') {
      type = 'hut';
      const big = key === 'drag';
      post(0, C, wheel + 0.25, big ? 0.28 : 0.15, COL.steel);                                          // the wheel's mast
      add(-0.3, 0.3, C - 0.3, C + 0.3, wheel + 0.25, wheel + 0.55, COL.accent, false);
      const hutA0 = which ? 1.5 : -4.6, hutA1 = which ? 4.3 : -1.6;
      if (big || !which) {
        const hb0 = side + (big ? 2.4 : 1.6), hb1 = hb0 + (big ? 2.8 : 1.8);
        add(hutA0, hutA1, hb0, hb1, 0, big ? 2.6 : 2.1, COL.timber, true, { hut: true });
        add(hutA0 - 0.25, hutA1 + 0.25, hb0 - 0.25, hb1 + 0.25, big ? 2.6 : 2.1, big ? 2.95 : 2.4, COL.snow, false, { cap: true });
        add(hutA0 + 0.3, hutA1 - 0.3, hb0 - 0.03, hb0 - 0.01, 1.1, 1.9, COL.glass, false);
      }
      if (!which) add(work - 0.6, work - 0.4, side - 1.2, side + 1.2, 0, 0.02, COL.accent, false, { deck: true });     // the start line on the snow (R8b: stood on, like a deck)
    } else if (key === 'carpet') {
      type = 'belt';
      add(-0.4, 1.6, -0.7, 0.7, -0.2, 0.12, COL.steel, false, { deck: true });
    } else if (key === 'train') {
      type = 'rail';
      // the roof over the highest rail under the hall (the track climbs through it)
      let rail = 0.35;
      for (let d = 0; d <= Math.min(27, len); d += 1.5) rail = Math.max(rail, path.cableY(which ? len - d : d) - path.ground(s));
      const roof = rail + 4.25, b0 = bIn - 3.4, b1 = bOut + 3.4, a0 = -18;
      add(a0, 1.6, b0, b1, -0.4, 0.04, COL.deck, false, { deck: true });
      add(a0 + 2, -2, bOut + 0.1, b1 - 0.4, 0.04, 0.14, COL.concrete, false, { deck: true });         // the platform edge
      add(a0, 2.2, b0, b1, roof, roof + 0.45, COL.timber, true, { roof: true });
      add(a0 - 0.2, 2.4, b0 - 0.2, b1 + 0.2, roof + 0.45, roof + 0.8, COL.snow, false, { cap: true });
      add(1.6, 2.2, b0, b1, 0, roof, COL.stone, true, { wall: true });                                // buffer wall
      for (const a of [a0 + 0.3, (a0 + 1.6) / 2]) for (const b of [b0 + 0.3, b1 - 0.3]) post(a, b, roof, 0.25, COL.stone);
      add(0.6, 1.6, -side - 0.6, -side + 0.6, 0, 1.0, COL.accent, false);
      add(0.6, 1.6, side - 0.6, side + 0.6, 0, 1.0, COL.accent, false);
    }
    // the whole footprint (for the exits, the buildings, the trees)
    let A0 = Infinity, A1 = -Infinity, B0 = Infinity, B1 = -Infinity;
    for (const p of parts) { A0 = Math.min(A0, p.a0); A1 = Math.max(A1, p.a1); B0 = Math.min(B0, p.b0); B1 = Math.max(B1, p.b1); }
    if (!parts.length) { A0 = -1; A1 = 1; B0 = -1; B1 = 1; }
    const end = {
      which, s, x: q.x, z: q.z, fx, fz, rx, rz, type, parts, rect: { a0: A0, a1: A1, b0: B0, b1: B1 },
      toWorld(a, b, out = {}) { out.x = q.x + fx * a + rx * b; out.z = q.z + fz * a + rz * b; return out; },
      toLocal(x, z, out = {}) { const dx = x - q.x, dz = z - q.z; out.a = dx * fx + dz * fz; out.b = dx * rx + dz * rz; return out; },
    };
    return end;
  }
  // where riders wait (bottom) and get off (top), in the end's frame; the loading point is where the carrier picks the rider up
  const zoneB = key === 'drag' ? { a0: -boardS - 1.8, a1: -boardS + 1.2, b0: side - 0.75, b1: side + 0.75 }
    : key === 'rope' ? { a0: -boardS - 1.6, a1: -boardS + 1.0, b0: side - 1.1, b1: side - 0.1 }
      : key === 'carpet' ? { a0: 0.2, a1: 2.0, b0: -0.6, b1: 0.6 }
        : key === 'chair' ? { a0: -boardS - 1.6, a1: -boardS + 1.6, b0: bOut + 1.2, b1: bOut + 3.4 }
          : { a0: -boardS - 2.2, a1: -boardS + 2.2, b0: bOut + 0.9, b1: bOut + 2.9 };
  const bottom = ends[0], top = ends[1];
  const zc = bottom.toWorld((zoneB.a0 + zoneB.a1) / 2, (zoneB.b0 + zoneB.b1) / 2, {});
  const upHeading = Math.atan2(-bottom.fz, -bottom.fx);
  const off = key === 'carpet' ? null : top.toWorld(key === 'drag' || key === 'rope' ? -unloadS + 0.5 : -unloadS, bOut + (key === 'drag' || key === 'rope' ? 0.9 : 1.4), {});
  const site = {
    path, key, kind: path.kind, ends, bottom, top, boardS, unloadS, zone: zoneB,
    /** The waiting spot in the zone (fast travel lands here): facing up the line. */
    wait: { x: zc.x, z: zc.z, heading: upHeading },
    /** The rider's feet where the carrier picks him up (the loading line on the up lane). */
    load: (() => { const b = key === 'rope' ? side - 0.45 : key === 'carpet' ? 0 : side; const w = bottom.toWorld(-boardS, b, {}); return { x: w.x, z: w.z, heading: upHeading }; })(),
    /** At the top: where he stands after getting off, on the outer side of the up lane (drag lifts: the track itself). */
    off: off ? { x: off.x, z: off.z } : (() => { const b = key === 'carpet' ? 0 : side + 1.2; const w = top.toWorld(key === 'carpet' ? 0.6 : -unloadS + 0.5, b, {}); return { x: w.x, z: w.z }; })(),
    inZone(x, z) { const l = bottom.toLocal(x, z, {}); return l.a >= zoneB.a0 && l.a <= zoneB.a1 && l.b >= zoneB.b0 && l.b <= zoneB.b1; },
  };
  // tunnel portals: where an underground line dives in (bottom) and comes out (top)
  site.portals = [];
  if (path.tunnel) {
    // where the vault dives under the ground (lift-path.js TUNNEL_RAMP: 10 m level at the platform, then 15 m deeper per 70 m): a fixed
    // arc, so the drawn portal (5 m heights) and the colliders (far grid) agree
    const sIn = Math.min(36, len * 0.3), sOut = len - sIn;
    for (const [s, outward] of [[sIn, -1], [sOut, 1]]) {
      if (s === null) continue;
      const q = path.at(s, {});
      const fx = q.dx * outward, fz = q.dz * outward, rx = -q.dz, rz = q.dx;
      const parts = [];
      const w = bOut + 0.4, wi = bIn - 0.4;
      const ry = path.cableY(s) - path.ground(s);                         // the rail under the portal's ground (negative)
      const P = (a0, a1, b0, b1, y0, y1, col, solid = true) => parts.push({ a0, a1, b0, b1, y0, y1, col, solid });
      P(-1.2, 1.2, w, w + 1.4, ry - 0.5, ry + 6.2, COL.concrete);
      P(-1.2, 1.2, wi - 1.4, wi, ry - 0.5, ry + 6.2, COL.concrete);
      P(-1.2, 1.2, wi - 1.4, w + 1.4, ry + 4.6, ry + 7.4, COL.concrete);
      P(-1.4, 1.4, wi - 1.6, w + 1.6, ry + 7.4, ry + 7.8, COL.stone, false);
      P(-0.5, -0.45, wi + 0.4, w - 0.4, ry + 3.9, ry + 4.3, COL.light, false);
      site.portals.push({ s, x: q.x, z: q.z, fx, fz, rx, rz, parts, rect: { a0: -1.4, a1: 1.4, b0: wi - 1.6, b1: w + 1.6 },
        toWorld(a, b, out = {}) { out.x = q.x + fx * a + rx * b; out.z = q.z + fz * a + rz * b; return out; },
        toLocal(x, z, out = {}) { const dx = x - q.x, dz = z - q.z; out.a = dx * fx + dz * fz; out.b = dx * rx + dz * rz; return out; } });
    }
  }
  // mid stations only where the data has them (a train's stops): a platform with a shelter on the outer side
  site.stops = [];
  for (const [s, name] of path.src.stops || []) {
    if (s < 30 || s > len - 30) continue;
    const q = path.at(s, {});
    const fx = q.dx, fz = q.dz, rx = -q.dz, rz = q.dx;
    const parts = [];
    parts.push({ a0: -14, a1: 14, b0: bOut + 0.1, b1: bOut + 3.2, y0: 0.0, y1: 0.55, col: COL.concrete, solid: false, deck: true });
    parts.push({ a0: -4, a1: 4, b0: bOut + 2.2, b1: bOut + 3.3, y0: 0.55, y1: 3.0, col: COL.timber, solid: true });
    parts.push({ a0: -4.3, a1: 4.3, b0: bOut + 1.0, b1: bOut + 3.5, y0: 3.0, y1: 3.35, col: COL.snow, solid: false });
    site.stops.push({ s, name, x: q.x, z: q.z, fx, fz, rx, rz, parts, rect: { a0: -14, a1: 14, b0: bOut + 0.1, b1: bOut + 3.5 },
      toWorld(a, b, out = {}) { out.x = q.x + fx * a + rx * b; out.z = q.z + fz * a + rz * b; return out; },
      toLocal(x, z, out = {}) { const dx = x - q.x, dz = z - q.z; out.a = dx * fx + dz * fz; out.b = dx * rx + dz * rz; return out; } });
  }
  return site;
}

/** Every station-like frame of a site (both ends, the portals, the stops). */
export const frames = (site) => [...site.ends, ...site.portals, ...site.stops];

/* ---------------- the resort's lift world ---------------- */
const CELL = 60;
/** The exit search's directions (rad in a top station's frame, 0 = straight out of the outer side), nearest to it first. */
const ANGLES = [0, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].flatMap((k) => [k * Math.PI / 12, -k * Math.PI / 12]), Math.PI];
/**
 * paths = Map(lift index -> createLiftPath) (any height function: the layout is x / z; heights only rate the lanes).
 * opts.buildings = buildings.json rows (optional): the ones in a station or a low lift lane are left out (`keepBuilding`), the rest
 * blocks the exits. opts.cutsFrom = a world over the same lifts whose pruning is copied (no second pass).
 */
export function createLiftWorld(paths, opts = {}) {
  const sites = new Map();
  for (const [i, p] of paths) if (p) sites.set(i, createLiftSite(p));
  if (opts.cutsFrom) copyCuts(sites, opts.cutsFrom);
  else pruneCrossings(sites);
  // grid of station frames, pylons and lane segments
  const grid = new Map();
  const key = (i, j) => i * 100003 + j;
  const put = (x0, z0, x1, z1, item) => {
    for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      let c = grid.get(key(i, j));
      if (!c) grid.set(key(i, j), (c = []));
      c.push(item);
    }
  };
  const near = (x, z, r) => {
    const out = new Set();
    for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      const c = grid.get(key(i, j));
      if (c) for (const it of c) out.add(it);
    }
    return out;
  };
  for (const [index, site] of sites) {
    for (const f of frames(site)) {
      const corners = [[f.rect.a0, f.rect.b0], [f.rect.a1, f.rect.b0], [f.rect.a0, f.rect.b1], [f.rect.a1, f.rect.b1]].map(([a, b]) => f.toWorld(a, b, {}));
      put(Math.min(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.z)), Math.max(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.z)), { t: 'frame', index, f });
    }
    const p = site.path;
    for (const sp of p.supports) {
      if (!sp.tower) continue;
      const q = p.at(sp.s, {});
      put(q.x - 2, q.z - 2, q.x + 2, q.z + 2, { t: 'pylon', index, x: q.x, z: q.z, r: PYLON_R });
    }
    // lane segments (for the exits: never in a carrier's path where it hangs low; for the trees: the aisle)
    const step = 20;
    for (let s = 0; s < p.len; s += step) {
      const s1 = Math.min(p.len, s + step);
      const a = p.at(s, {}), b = p.at(s1, {});
      const w = Math.max(AISLE[site.key], Math.max(p.side, p.back) + p.carrier.hw + 4.2);
      put(Math.min(a.x, b.x) - w, Math.min(a.z, b.z) - w, Math.max(a.x, b.x) + w, Math.max(a.z, b.z) + w, { t: 'lane', index, s0: s, s1, ax: a.x, az: a.z, bx: b.x, bz: b.z });
    }
  }
  const tmpL = {};
  /** Inside a station frame's footprint (+ margin m)? Returns the frame or null. */
  function inStation(x, z, margin = 0, skip = null) {
    for (const it of near(x, z, margin + 2)) {
      if (it.t !== 'frame' || it.f === skip) continue;
      const l = it.f.toLocal(x, z, tmpL);
      if (l.a >= it.f.rect.a0 - margin && l.a <= it.f.rect.a1 + margin && l.b >= it.f.rect.b0 - margin && l.b <= it.f.rect.b1 + margin) return it.f;
    }
    return null;
  }
  /** Solid station parts and pylons overlapping a disc (x, z, r) up to height y (feet; y = -Infinity: any height): for the skier. */
  const hitOut = { nx: 0, nz: 0, pen: 0, kind: 'lift' };
  function hit(x, z, r, y = -Infinity, ground = null, body = 1.8) {        // body (R8): the height above y that counts (camera: a small box)
    let best = null;
    for (const it of near(x, z, r + 1)) {
      if (it.t === 'pylon') {
        const dx = x - it.x, dz = z - it.z, d = Math.hypot(dx, dz), pen = r + it.r - d;
        if (pen > 0 && (!best || pen > best.pen)) { best = hitOut; best.nx = d > 1e-6 ? dx / d : 1; best.nz = d > 1e-6 ? dz / d : 0; best.pen = pen; }
        continue;
      }
      if (it.t !== 'frame') continue;
      const f = it.f, l = f.toLocal(x, z, tmpL);
      if (l.a < f.rect.a0 - r || l.a > f.rect.a1 + r || l.b < f.rect.b0 - r || l.b > f.rect.b1 + r) continue;
      const g0 = ground ? ground(f.x, f.z) : 0;
      for (const p of f.parts) {
        if (!p.solid) continue;
        if (y !== -Infinity && ground && (y > g0 + p.y1 || y + body < g0 + p.y0)) continue;         // flying over / walking under it
        const ca = Math.max(p.a0, Math.min(p.a1, l.a)), cbb = Math.max(p.b0, Math.min(p.b1, l.b));
        const da = l.a - ca, db = l.b - cbb, d = Math.hypot(da, db);
        let pen, na, nb;
        if (d > 1e-6) { pen = r - d; na = da / d; nb = db / d; }
        else {                                                         // the centre inside the box: out by the nearest face
          const m = [[l.a - p.a0, -1, 0], [p.a1 - l.a, 1, 0], [l.b - p.b0, 0, -1], [p.b1 - l.b, 0, 1]].sort((u, v) => u[0] - v[0])[0];
          pen = r + m[0]; na = m[1]; nb = m[2];
        }
        if (pen > 0 && (!best || pen > best.pen)) {
          best = hitOut; best.pen = pen; best.nx = f.fx * na + f.rx * nb; best.nz = f.fz * na + f.rz * nb;
        }
      }
    }
    return best;
  }
  /** Is (x, z) in a lift lane where the carriers hang lower than `clear` m over the ground (or on a drag lift's track / belt)? */
  function inLowLane(x, z, height, clear = 3.2, skipIndex = -1, lanesOut = null) {
    for (const it of near(x, z, 14)) {
      if (it.t !== 'lane' || it.index === skipIndex || (skipIndex instanceof Set && skipIndex.has(it.index))) continue;
      const p = sites.get(it.index).path;
      const dx = it.bx - it.ax, dz = it.bz - it.az, L2 = dx * dx + dz * dz || 1;
      const tu = ((x - it.ax) * dx + (z - it.az) * dz) / L2, Ls = Math.sqrt(L2);
      const ext = (p.shuttle ? 0 : p.wheelR) + p.carrier.hl + 1;             // the loop's bulge round the wheel beyond the line's end
      if (tu < 0 && (it.s0 > 0 || -tu * Ls > ext)) continue;                 // (an inner joint: the segment before covers it)
      if (tu > 1 && (it.s1 < p.len || (tu - 1) * Ls > ext)) continue;
      const t = Math.max(0, Math.min(1, tu));
      const s = it.s0 + (it.s1 - it.s0) * t;
      const px = it.ax + dx * t, pz = it.az + dz * t;
      const lat = p.sign * ((x - px) * -dz + (z - pz) * dx) / Math.sqrt(L2);    // + = the up side
      if (lat < -p.back - p.carrier.hw - 1 || lat > p.side + p.carrier.hw + 1) continue;
      if (p.kind === 'drag' || p.kind === 'carpet' || (p.kind === 'train' && !p.tunnel)) { if (lanesOut) lanesOut.add(it.index); else return true; continue; }
      if (p.kind === 'train') continue;
      if (p.cableY(s) - p.carrier.drop - height(x, z) < clear) { if (lanesOut) lanesOut.add(it.index); else return true; }
    }
    return false;
  }
  // buildings: oriented boxes [cx, cz, L, W, angle, eave, ridge, ground, ...]; out when in a station or a low lane
  const rows = opts.buildings || [];
  const boxes = [];
  const bGrid = new Map();
  const keep = rows.map((row) => {
    const [cx, cz, L, W, ang] = row;
    const c = Math.cos(ang), s = Math.sin(ang), hx = L / 2, hz = W / 2;
    const corners = [[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]);
    // in a station footprint (corners or centre)?
    if (inStation(cx, cz, 1.5) || corners.some(([x, z]) => inStation(x, z, 1.0))) return false;
    // under a lift lane where the carriers would touch its roof
    const top = (row[7] || 0) + (row[6] || row[5] || 8);
    for (const it of near(cx, cz, Math.max(L, W))) {
      if (it.t !== 'lane') continue;
      const p = sites.get(it.index).path;
      const dx = it.bx - it.ax, dz = it.bz - it.az, L2 = dx * dx + dz * dz || 1;
      for (const [x, z] of [[cx, cz], ...corners]) {
        const t = Math.max(0, Math.min(1, ((x - it.ax) * dx + (z - it.az) * dz) / L2));
        const lat = p.sign * ((x - it.ax - dx * t) * -dz + (z - it.az - dz * t) * dx) / Math.sqrt(L2);
        if (lat < -p.back - p.carrier.hw - 1.5 || lat > p.side + p.carrier.hw + 1.5) continue;
        if (t <= 0 || t >= 1) continue;
        const sAt = it.s0 + (it.s1 - it.s0) * t;
        if (p.kind === 'train' && p.tunnel) continue;
        const low = p.kind === 'train' || p.kind === 'carpet' ? p.cableY(sAt) + p.carrier.top + 0.5 : p.cableY(sAt) - p.carrier.drop - 1.0;
        if (p.kind === 'train' || p.kind === 'carpet' || p.kind === 'drag' ? true : top > low) return false;
      }
    }
    return true;
  });
  // a big building round a station (a summit complex) whose box holds any of the station's own points goes too (the station is it)
  const keyPts = [];
  for (const [, site] of sites) {
    for (const f of [site.bottom, site.top]) {
      const r = f.rect;
      for (const [a, b] of [[(r.a0 + r.a1) / 2, (r.b0 + r.b1) / 2], [r.a0, r.b0], [r.a1, r.b0], [r.a0, r.b1], [r.a1, r.b1], [0, 0], [r.a0, 0], [0, r.b1]]) keyPts.push(f.toWorld(a, b, {}));
    }
    keyPts.push(site.wait, site.load, site.off);
  }
  const kGrid = new Map();
  for (const q of keyPts) { const kk = key(Math.floor(q.x / CELL), Math.floor(q.z / CELL)); if (!kGrid.has(kk)) kGrid.set(kk, []); kGrid.get(kk).push(q); }
  rows.forEach((row, i) => {
    if (!keep[i]) return;
    const [cx, cz, L, W, ang] = row;
    const c = Math.cos(ang), s = Math.sin(ang), r = Math.hypot(L, W) / 2 + 2;
    for (let j = Math.floor((cz - r) / CELL); j <= Math.floor((cz + r) / CELL) && keep[i]; j++) for (let ii = Math.floor((cx - r) / CELL); ii <= Math.floor((cx + r) / CELL) && keep[i]; ii++) {
      for (const q of kGrid.get(key(ii, j)) || []) {
        const dx = q.x - cx, dz = q.z - cz, u = dx * c + dz * s, v = -dx * s + dz * c;
        if (Math.abs(u) <= L / 2 + 1 && Math.abs(v) <= W / 2 + 1) { keep[i] = false; break; }
      }
    }
  });
  // R8 (early QA: cabins through hotels / OSM station buildings, up to 17 m): a building whose roof reaches into a carrier's path (its
  // lowest point every 5 m round the loop, 1 m margin) goes too: the lift was there first in the data
  {
    const bx = new Map();
    rows.forEach((row, i) => {
      if (!keep[i]) return;
      const [cx, cz, L, W] = row, r = Math.hypot(L, W) / 2 + 2;
      for (let j = Math.floor((cz - r) / CELL); j <= Math.floor((cz + r) / CELL); j++) for (let ii = Math.floor((cx - r) / CELL); ii <= Math.floor((cx + r) / CELL); ii++) { const kk = key(ii, j); if (!bx.has(kk)) bx.set(kk, []); bx.get(kk).push(i); }
    });
    const w = {};
    for (const [, site] of sites) {
      const p = site.path;
      if (!p.loopAt || p.kind === 'carpet' || p.kind === 'train') continue;
      const cb = p.carrier, rr = Math.max(cb.hw, cb.hl) + 1;
      for (let u = 0; u < p.loopLen; u += 2) {
        p.loopAt(u, w);
        for (const i of bx.get(key(Math.floor(w.x / CELL), Math.floor(w.z / CELL))) || []) {
          if (!keep[i]) continue;
          const [cx, cz, L, W, ang, eave, ridge] = rows[i];
          if (Math.max(eave || 0, ridge || 0) < w.y - cb.drop - p.ground(w.s) - 3) continue;      // heights over each one's own ground (far grid vs tiles)
          const c = Math.cos(ang), sn = Math.sin(ang), dx = w.x - cx, dz = w.z - cz;
          if (Math.abs(dx * c + dz * sn) <= L / 2 + rr && Math.abs(-dx * sn + dz * c) <= W / 2 + rr) keep[i] = false;
        }
      }
    }
  }
  rows.forEach((row, i) => {
    if (!keep[i]) return;
    const [cx, cz, L, W, ang] = row;
    const b = { cx, cz, hx: L / 2, hz: W / 2, c: Math.cos(ang), s: Math.sin(ang) };
    boxes.push(b);
    const r = Math.hypot(L, W) / 2;
    for (let j = Math.floor((cz - r) / CELL); j <= Math.floor((cz + r) / CELL); j++) for (let ii = Math.floor((cx - r) / CELL); ii <= Math.floor((cx + r) / CELL); ii++) {
      let c = bGrid.get(key(ii, j));
      if (!c) bGrid.set(key(ii, j), (c = []));
      c.push(b);
    }
  });
  function inBuilding(x, z, margin = 0) {
    const c = bGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!c) return false;
    for (const b of c) {
      const dx = x - b.cx, dz = z - b.cz;
      const u = dx * b.c + dz * b.s, v = -dx * b.s + dz * b.c;
      if (Math.abs(u) <= b.hx + margin && Math.abs(v) <= b.hz + margin) return true;
    }
    return false;
  }
  const nearPylon = (x, z, r) => { for (const it of near(x, z, r + 1)) if (it.t === 'pylon' && Math.hypot(x - it.x, z - it.z) < r + it.r) return true; return false; };

  /** Must a tree at (x, z) (its foot at ground y) go? Stations (+4 m), pylon bases (5 m) and the lift aisles where the carriers pass
   *  less than AISLE_HIGH m over the treetops. path heights: the far grid (stable while tiles stream; the margin covers it). */
  function treeBlocked(x, z, y) {
    for (const it of near(x, z, 14)) {
      if (it.t === 'pylon') { if (Math.hypot(x - it.x, z - it.z) < 5) return true; continue; }
      if (it.t === 'frame') {
        const l = it.f.toLocal(x, z, tmpL);
        if (l.a >= it.f.rect.a0 - 4 && l.a <= it.f.rect.a1 + 4 && l.b >= it.f.rect.b0 - 4 && l.b <= it.f.rect.b1 + 4) return true;
        continue;
      }
      const site = sites.get(it.index), p = site.path;
      const dx = it.bx - it.ax, dz = it.bz - it.az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - it.ax) * dx + (z - it.az) * dz) / L2));
      const d = Math.hypot(it.ax + dx * t - x, it.az + dz * t - z);
      const half = Math.max(AISLE[site.key], Math.max(p.side, p.back) + p.carrier.hw + 4.2);      // the lane + the widest crown
      if (d > half) continue;
      if (p.kind === 'train' && p.tunnel) {
        const s = it.s0 + (it.s1 - it.s0) * t;
        if (p.ground(s) - p.cableY(s) < 4) return true;          // only where the line is still at the surface
        continue;
      }
      if (p.kind === 'drag' || p.kind === 'carpet' || p.kind === 'train') return true;
      const s = it.s0 + (it.s1 - it.s0) * t;
      if (p.cableY(s) - p.carrier.drop - (y + TREE_TOP) < AISLE_HIGH) return true;
    }
    return false;
  }

  /** The exit at a lift's top: { x, z, heading, from: { x, z } (where he gets off) }. height = the snow; tree(x, z) = a tree there?
   *  Outside every station, building and low lane (2 m), on snow, facing down the fall line with 15 m clear ahead, the nearest such
   *  spot to where he got off (a piste start nearby is preferred). */
  function exitOf(index, height, tree = null, pisteStarts = null, why = null) {
    const no = (r) => { if (why) why[r] = (why[r] || 0) + 1; };
    const site = sites.get(index);
    if (!site) return null;
    const top = site.top, from = site.off;
    const fall = (x, z) => {
      const g = 30;
      const gx = (height(x + g, z) - height(x - g, z)) / (2 * g), gz = (height(x, z + g) - height(x, z - g)) / (2 * g);
      return Math.hypot(gx, gz) > 0.03 ? Math.atan2(-gz, -gx) : null;
    };
    const blocked = (x, z, m) => inStation(x, z, m) || inBuilding(x, z, m) || nearPylon(x, z, m + 0.4) || inLowLane(x, z, height, 3.2);
    const lc = {};
    const toL = top.toLocal(from.x, from.z, lc);
    // the lanes he gets off in (a drag track / belt; a station shared with the next lift: its cabins dock there) do not block the way
    // out of them (the exit itself must be outside every lane)
    const own = new Set();
    inLowLane(from.x, from.z, height, 2.6, -1, own);
    if (site.path.kind === 'drag' || site.path.kind === 'carpet') own.add(index);
    // the candidates: straight lines out of the station in 24 directions, and points down a piste that starts at this top
    const candidates = [];
    for (const ang of ANGLES) {
      const da = Math.sin(ang), db = Math.cos(ang);
      for (const dist of [4, 7, 10, 14, 19, 25, 33, 44, 58, 75, 95, 120]) candidates.push({ P: top.toWorld(toL.a + da * dist, toL.b + db * dist, {}), dist, ang, da, db });
    }
    for (const ps of pisteStarts || []) {
      if (!ps.at || Math.hypot(ps.top.x - from.x, ps.top.z - from.z) > 80) continue;
      for (const s0 of [6, 10, 15, 20, 30, 45, 60, 80]) {
        if (s0 > ps.length * 0.6) break;
        const q = ps.at(s0, {});
        const l2 = top.toLocal(q.x, q.z, {});
        const dist = Math.hypot(l2.a - toL.a, l2.b - toL.b) || 1;
        // the way out runs down the piste itself (it may pass under a lift near the station: the pistes are made for that)
        // (joining it where it passes nearest to where he got off)
        let tj = 0, dj = Infinity;
        for (let t = 0; t < s0; t += 1) { const w = ps.at(t, {}); const d = Math.hypot(w.x - from.x, w.z - from.z); if (d < dj) { dj = d; tj = t; } }
        const way = [{ x: from.x, z: from.z }];
        for (let t = tj; t < s0; t += 2) { const w = ps.at(t, {}); way.push({ x: w.x, z: w.z }); }
        way.push({ x: q.x, z: q.z });
        let L = 0;
        for (let k = 1; k < way.length; k++) L += Math.hypot(way[k].x - way[k - 1].x, way[k].z - way[k - 1].z);
        candidates.push({ P: { x: q.x, z: q.z }, dist: L, ang: 0, heading: Math.atan2(q.dz, q.dx), piste: true, way });
      }
    }
    // R8 (early QA: summit exits facing a cliff): how steeply the ground falls over the next 40 m along a heading (worst average from P)
    const dropAhead = (P, h) => { let d = 0; for (let m = 5; m <= 40; m += 5) d = Math.max(d, (height(P.x, P.z) - height(P.x + Math.cos(h) * m, P.z + Math.sin(h) * m)) / m); return d; };
    const search = (maxSlope, ahead = 15, laneClear = 2.6, maxDrop = Infinity) => {
      let best = null, bs = Infinity;
      for (const cand of candidates) {
        {
          const { P, dist, ang } = cand;
          if (blocked(P.x, P.z, 2)) { no(inStation(P.x, P.z, 2) ? 'station' : inBuilding(P.x, P.z, 2) ? 'building' : nearPylon(P.x, P.z, 2.4) ? 'pylon' : 'lane'); continue; }
          const sl = Math.hypot(height(P.x + 2, P.z) - height(P.x - 2, P.z), height(P.x, P.z + 2) - height(P.x, P.z - 2)) / 4;
          if (sl > maxSlope) { no('slope'); continue; }                    // walkable: no exit on a steep face
          // the way out from where he got off: clear of every solid part, building, tree and low lane on the way (his own deck is fine)
          let wayOk = true;
          const legs = cand.way || [from, P];
          for (let g = 1; g < legs.length && wayOk; g++) {
            const A = legs[g - 1], B = legs[g], d = Math.hypot(B.x - A.x, B.z - A.z), n = Math.max(1, Math.ceil(d / 0.5));
            for (let k = 1; k <= n && wayOk; k++) {
              const x = A.x + (B.x - A.x) * k / n, z = A.z + (B.z - A.z) * k / n;
              if (hit(x, z, 0.55, height(x, z), height)) { wayOk = false; no('way-part'); }
              else if (inBuilding(x, z, 0.5)) { wayOk = false; no('way-building'); }
              else if (!cand.way && inLowLane(x, z, height, laneClear, own)) { wayOk = false; no('way-lane'); }
              else if (tree && tree(x, z)) { wayOk = false; no('way-tree'); }
            }
          }
          if (!wayOk) continue;
          let heading = cand.heading !== undefined ? cand.heading : fall(P.x, P.z);
          const flat = heading === null;
          if (flat) heading = Math.atan2(P.z - from.z, P.x - from.x);
          // facing downhill over the next 15 m too (a 30 m gradient can hide a small rise): else the local fall line, else skip it
          const rises = (h) => height(P.x + Math.cos(h) * 15, P.z + Math.sin(h) * 15) > height(P.x - Math.cos(h) * 15, P.z - Math.sin(h) * 15) + 0.3;
          if (rises(heading)) {
            const g = 8, gx = (height(P.x + g, P.z) - height(P.x - g, P.z)) / (2 * g), gz = (height(P.x, P.z + g) - height(P.x, P.z - g)) / (2 * g);
            heading = Math.atan2(-gz, -gx);
            if (rises(heading)) { no('uphill'); continue; }
          }
          // R8: no drop ahead: the fall line first, else a traverse up to 75 degrees off it (never uphill), else skip the spot
          if (maxDrop < Infinity && dropAhead(P, heading) > maxDrop) {
            const h0 = heading;
            heading = null;
            for (const off of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.3, -1.3]) { const h = h0 + off; if (!rises(h) && dropAhead(P, h) <= maxDrop) { heading = h; break; } }
            if (heading === null) { no('drop'); continue; }
          }
          // 15 m clear ahead
          let clear = true;
          const hx = Math.cos(heading), hz = Math.sin(heading);
          for (let m = 1; m <= ahead && clear; m += 1) {
            const x = P.x + hx * m, z = P.z + hz * m;
            if (blocked(x, z, 0.8) || hit(x, z, 0.4, height(x, z), height) || (tree && tree(x, z))) clear = false;
          }
          if (!clear) { no('ahead'); continue; }
          let score = dist + (flat ? 25 : 0) + Math.abs(ang) * 2 + sl * 20;
          if (pisteStarts) { let d0 = 1e9; for (const ps of pisteStarts) { const t = ps.top || ps; d0 = Math.min(d0, Math.hypot(t.x - P.x, t.z - P.z)); } score += Math.min(60, d0) * 0.25; }
          if (cand.piste) score -= 4;
          if (score < bs) { bs = score; best = { x: P.x, z: P.z, heading, from: { x: from.x, z: from.z }, dist, slope: sl, via: cand.way ? cand.way.slice(1, -1) : null }; }
        }
      }
      return best;
    };
    // walkable snow first; at a summit station on a steep ridge (Valluga, Klein Matterhorn) the gentlest spot that is still skiable
    // (and on the two tightest summits of the data, Vallugagrat and the Leisee shuttle's top in the Sunnegga station: 10 m clear,
    // under the carriers where they still pass 1.5 m over the snow)
    let best = search(0.47, 15, 2.6, 0.7) || search(0.6, 15, 2.6, 0.8);
    if (best && best.slope > 0.47) best.steep = true;
    if (!best) { best = search(0.6) || search(1.0) || search(1.25, 10, 1.5) || search(9, 5, 1.0); if (best) best.steep = true; }
    if (!best) {                                    // nothing clear (never in the data so far): 30 m out of the outer side
      const P = top.toWorld(toL.a, toL.b + 30, {});
      best = { x: P.x, z: P.z, heading: fall(P.x, P.z) ?? Math.atan2(top.fz, top.fx), from: { x: from.x, z: from.z }, dist: 30, fallback: true };
    }
    return best;
  }
  /** The lift whose boarding zone holds (x, z), or null (indices of `sites`). */
  function boardingAt(x, z) {
    for (const it of near(x, z, 6)) {
      if (it.t !== 'frame' || it.f !== sites.get(it.index).bottom) continue;
      if (sites.get(it.index).inZone(x, z)) return it.index;
    }
    return null;
  }
  /** R8b (3V QA: skis sank into every boarding platform): the top of the station deck / platform at (x, z), or -Infinity off every deck.
   *  The decks are flat boxes at their frame's ground (ground(f.x, f.z)), so on a slope they stand above the snow: the skier stands
   *  on them (main.js standHeight = max(snow, deck)). */
  function deckTop(x, z, ground) {
    let top = -Infinity;
    for (const it of near(x, z, 1)) {
      if (it.t !== 'frame') continue;
      const f = it.f, l = f.toLocal(x, z, tmpL);
      if (l.a < f.rect.a0 || l.a > f.rect.a1 || l.b < f.rect.b0 || l.b > f.rect.b1) continue;
      let g0 = null;
      for (const p of f.parts) {
        if (!p.deck || p.cut || l.a < p.a0 || l.a > p.a1 || l.b < p.b0 || l.b > p.b1) continue;
        if (g0 === null) g0 = ground(f.x, f.z);
        top = Math.max(top, g0 + p.y1);
      }
    }
    return top;
  }
  return { sites, inStation, inBuilding, inLowLane, hit, treeBlocked, exitOf, boardingAt, keepBuilding: (i) => keep[i] !== false, nearPylon, deckTop };
}

/** Where lifts share ground (twin drag lifts, a line passing a neighbour's station): a station part standing in another lift's
 *  carrier lane (at the carriers' height) is left out (`cut`: not drawn, not solid), with the snow on it. */
function pruneCrossings(sites) {
  const list = [...sites.values()];
  // the station frames in a 40 m grid (each in every cell its footprint + 5 m touches)
  const G = 40, fgrid = new Map();
  const gk = (i, j) => i * 100003 + j;
  for (const site of list) {
    for (const f of frames(site)) {
      const r = f.rect, cs = [[r.a0, r.b0], [r.a1, r.b0], [r.a0, r.b1], [r.a1, r.b1]].map(([a, b]) => f.toWorld(a, b, {}));
      const x0 = Math.min(...cs.map((c) => c.x)) - 5, x1 = Math.max(...cs.map((c) => c.x)) + 5, z0 = Math.min(...cs.map((c) => c.z)) - 5, z1 = Math.max(...cs.map((c) => c.z)) + 5;
      for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) {
        let c = fgrid.get(gk(i, j));
        if (!c) fgrid.set(gk(i, j), (c = []));
        c.push({ site, f });
      }
    }
  }
  const l = {};
  /** A carrier (or the rider) of `owner` at (x, z) heading h with half sizes hw / hl: cut every other lift's part it overlaps (by the
   *  ground plan only, so the drawn stations (5 m heights) and the colliders (far grid) always agree), with the snow on it. */
  const test = (x, z, h, hw, hl, owner) => {
    const cell = fgrid.get(gk(Math.floor(x / G), Math.floor(z / G)));
    if (!cell) return;
    const c = Math.cos(h), sn = Math.sin(h);
    for (const { site, f } of cell) {
      if (site === owner) continue;
      f.toLocal(x, z, l);
      const ca = Math.abs(c * f.fx + sn * f.fz), cr = Math.abs(c * f.rx + sn * f.rz);
      const ea = ca * hl + cr * hw, eb = cr * hl + ca * hw;
      if (l.a + ea < f.rect.a0 || l.a - ea > f.rect.a1 || l.b + eb < f.rect.b0 || l.b - eb > f.rect.b1) continue;
      for (const p of f.parts) {
        if (p.deck || p.cut || (!p.solid && !p.cap)) continue;
        if (l.a + ea < p.a0 || l.a - ea > p.a1 || l.b + eb < p.b0 || l.b - eb > p.b1) continue;
        p.cut = true; p.solid = false;
        for (const cp of f.parts) if (cp.cap && Math.abs(cp.y0 - p.y1) < 0.05 && cp.a0 < p.a1 && cp.a1 > p.a0 && cp.b0 < p.b1 && cp.b1 > p.b0) cp.cut = true;
      }
    }
  };
  const w = {};
  for (const site of list) {
    const p = site.path;
    // every carrier position 2 m apart round the loop (drag bars, chairs, cabins, trains; not under the ground)
    if (!(p.kind === 'carpet' || (p.kind === 'drag' && p.sub === 'rope'))) {
      const cb = p.carrier, hw = cb.hw + cb.drop * 0.035 + 0.3, hl = cb.hl + 0.3;
      for (let u = 0; u < p.loopLen; u += 2) {
        p.loopAt(u, w);
        if (p.tunnel && p.ground(w.s) - w.y > 6) continue;
        test(w.x, w.z, w.heading, hw, hl, site);
      }
    }
    // the rider's walks in the stations (the waiting spot to the loading line, the carrier to where he gets off): two lifts
    // sharing a station (Matterhorn Express 2 / 3, Falkenkopf) must not have the other's posts on them
    const tq = p.at(Math.max(0, p.len - site.unloadS), {});
    const carAt = { x: tq.x - tq.dz * p.side * p.sign, z: tq.z + tq.dx * p.side * p.sign };
    for (const [a, b] of [[site.wait, site.load], [carAt, site.off]]) {
      const d = Math.hypot(b.x - a.x, b.z - a.z), h = Math.atan2(b.z - a.z, b.x - a.x);
      for (let m = 0; m <= d; m += 0.5) test(a.x + Math.cos(h) * m, a.z + Math.sin(h) * m, h, 0.6, 0.6, site);
    }
  }
}

/** Copy the cuts of another world built over the same lifts (lifts.js: the 5 m heights; the game's world: the far grid). */
function copyCuts(sites, from) {
  for (const [i, site] of sites) {
    const o = from.sites.get(i);
    if (!o) continue;
    const fa = frames(site), fb = frames(o);
    fa.forEach((f, k) => { const g = fb[k]; if (!g || g.parts.length !== f.parts.length) return; f.parts.forEach((p, n) => { if (g.parts[n].cut) { p.cut = true; p.solid = false; } }); });
  }
}

/** For the scatter (scatter.js): a tree guard from the resort's lifts (any height function, the far grid is fine).
 *  R8c: one per resort object (the far forest cards of forest-far.js use the same guard: no second build of every lift path). */
const treeGuards = new WeakMap();
export function liftTreeGuard(resort, createPath, height) {
  const known = treeGuards.get(resort);
  if (known) return known;
  const paths = new Map();
  resort.lifts.forEach((src, i) => { if (liftClass(src.kind) || liftClass(src.type)) paths.set(i, createPath(src, height)); });
  const world = createLiftWorld(paths);
  const guard = (x, z, y) => world.treeBlocked(x, z, y);
  treeGuards.set(resort, guard);
  return guard;
}
