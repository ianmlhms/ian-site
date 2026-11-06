/* Lux Drive harness, section U (city12): the city centre a player who knows Luxembourg drives through first (QA3 section 3 and the walls of section 4).
 *   U1  the Gare Centrale stands (the bake has no block for the station): a stone building on the OSM outline with a clock tower of at least 35 m, standing on the
 *       ground at every corner (nothing floats), no baked block inside it, collision walls on its whole outline, and no road for cars (other than the
 *       pedestrian forecourt) inside it
 *   U2  the Pont Rouge reads as the Red Bridge from the deck: safety screens of slats on both sides, at least 3 m over the deck
 *   U3  the Place de la Gare is paved (no lawn blobs): the cells of the paved squares are paved stone and city in the GPU cover
 *   U4  the dense-centre rule (no lawn between the pavement and the shop fronts of Bd Royal) does not reach the lawns of Kirchberg / the JFK verges: none of
 *       their cells is changed by it, and the Bd Royal strip is city
 *   U5  the walls look finished: the pale coping is at most WALL_LOOK.copingBack deep, everything behind it (the bank, the back, the end behind the coping) is
 *       the earth kind, and no stone of a wall stands more than the coping's depth behind its face (no beige box, no dark tombstone)
 * Called by harness.js; everything it needs is passed in.  Pure Node. */
import { WALL_LOOK, WALL_PART_KIND as WALL_KIND, wallQuads, drawnWalls } from './retaining-walls.js';
import { GARE_OUTLINES } from './landmark-gare.js';
import { PAVED_SQUARES } from './paved-squares.js';
import { CLASS_CELL, DENSE_CENTRE, builtCover, urbanLook2 } from './world-map.js';
import { insidePoly, footprintOf } from './landmark-util.js';

const TOWER_MIN = 35;                     // U1: m, the clock tower over the ground (the photographs: about 40 m to the vane)
const SCREEN_MIN = 3.0;                   // U2: m over the deck
const SLATS_MIN = 400;                    // U2: per side (380 m of bridge)
const LAWNS = [[5700, 7930], [5600, 7960], [6000, 7880], [8350, 6170], [6500, 7400]];      // U4: lawns of Kirchberg and the JFK verges (the QA3 frames f06 - f09)
const ROYAL = [[4744, 8744], [4752, 8744], [4736, 8744], [4760, 8650]];                       // U4: the strip between Bd Royal's pavement and the shop fronts (f27 - f33)
const STONE_TOL = 0.06;                   // U5: m

export function runCity12Checks({ check, section, stats, data, surface, landmarks, maps, buildingsRaw }) {
  section('U city12: the Gare, the Pont Rouge, the squares and the boulevards, the walls');
  const groundAt = (x, z) => surface.height(x, z);

  // ---- U1: the Gare
  const gare = landmarks.list.find((l) => l.id === 'gare-centrale');
  check('U1 the Gare Centrale is built (a landmark: the bake has no block for the station)', !!gare, gare ? JSON.stringify(gare.info) : 'missing');
  if (gare) {
    const st = GARE_OUTLINES.station;
    const lowest = Math.min(...st.map(([x, z]) => groundAt(x, z)));
    const pos = gare.soup.pos;
    let floating = 0;
    for (const [x, z] of st) {                                   // a wall vertex at every corner reaches under the ground there
      let low = Infinity;
      for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i] - x) < 0.05 && Math.abs(pos[i + 2] - z) < 0.05) low = Math.min(low, pos[i + 1]);
      if (!(low <= groundAt(x, z) + 1e-3)) floating++;
    }
    const tower = gare.top - lowest;
    check(`U1 the station stands on the ground at all ${st.length} corners and its tower is >= ${TOWER_MIN} m`, floating === 0 && tower >= TOWER_MIN, `${floating} corners floating, top ${tower.toFixed(1)} m over the lowest corner`);
    const inside = buildingsRaw.filter((b) => { const pts = footprintOf(b); const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]); return insidePoly(st, c[0], c[1]); });
    check('U1 no baked block stands inside the station', inside.length === 0, inside.map((b) => b.id).join(',') || 'none');
    const walls = landmarks.walls.filter((w) => w.id === 'gare');
    const covered = st.filter((p, i) => { const q = st[(i + 1) % st.length]; return walls.some((w) => Math.hypot(w.ax - p[0], w.az - p[1]) < 0.05 && Math.hypot(w.bx - q[0], w.bz - q[1]) < 0.05); }).length;
    check('U1 collision walls on every edge of the station outline', covered === st.length, `${covered} of ${st.length} edges`);
    const roadsIn = [];
    for (const r of data.roads) {
      if (r.kind === 'pedestrian' || r.kind === 'footway' || r.kind === 'steps' || r.kind === 'path' || r.kind === 'platform' || r.kind === 'corridor') continue;
      if (r.pts.some(([x, z]) => insidePoly(st, x, z))) roadsIn.push(`${r.id} ${r.kind}`);
    }
    check('U1 no road for cars runs inside the station', roadsIn.length === 0, roadsIn.join('; ') || 'none');
    stats.gare = { tris: gare.soup.triangleCount, tower: +tower.toFixed(1) };
  }

  // ---- U2: the Pont Rouge
  const rouge = landmarks.list.find((l) => l.id === 'pont-rouge');
  const sc = rouge?.info?.screens;
  check(`U2 the Pont Rouge has its safety screens on both sides (>= ${SLATS_MIN} slats a side, >= ${SCREEN_MIN} m over the deck)`, !!sc && sc.slats[0] >= SLATS_MIN && sc.slats[1] >= SLATS_MIN && sc.height >= SCREEN_MIN,
    sc ? `slats ${sc.slats.join(' / ')}, ${sc.height} m` : 'no screens');

  // ---- U3: the paved squares
  const nx = maps.nx;
  let cells = 0, notPaved = 0;
  for (const sq of PAVED_SQUARES) {
    const xs = sq.pts.map((p) => p[0]), zs = sq.pts.map((p) => p[1]);
    for (let z = Math.ceil(Math.min(...zs) / CLASS_CELL) * CLASS_CELL; z <= Math.max(...zs); z += CLASS_CELL) {
      for (let x = Math.ceil(Math.min(...xs) / CLASS_CELL) * CLASS_CELL; x <= Math.max(...xs); x += CLASS_CELL) {
        if (!insidePoly(sq.pts, x, z)) continue;
        cells++;
        const o = ((z / CLASS_CELL) * nx + x / CLASS_CELL) * 4;
        if (maps.coverGpu[o] !== 255 || maps.coverGpu[o + 2] !== 255) notPaved++;
      }
    }
  }
  check('U3 every cell of the paved squares (Place de la Gare, Parvis) is paved stone and city', cells > 100 && notPaved === 0, `${notPaved} of ${cells} cells not paved`);

  // ---- U4: the dense-centre rule stays in the centre
  const gpuUrban = (x, z) => maps.coverGpu[((Math.round(z / CLASS_CELL)) * nx + Math.round(x / CLASS_CELL)) * 4 + 2];
  const lawnsCity = LAWNS.filter(([x, z]) => gpuUrban(x, z) > 0);
  const royalLawn = ROYAL.filter(([x, z]) => gpuUrban(x, z) < 255);
  // the cells OUTSIDE the centre (one cell of growth allowed) the dense rule raised over the rule of look2 (the near cover x the 72 m density), and inside it
  let raised = 0, raisedCentre = 0;
  const near = builtCover(buildingsRaw, nx, maps.nz, 1);
  const [bx0, bz0, bx1, bz1] = DENSE_CENTRE.map((v) => Math.round(v / CLASS_CELL));
  for (let j = 0; j < maps.nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (maps.classData[j * nx + i] !== 4 || maps.square?.[j * nx + i]) continue;
      if (maps.coverGpu[(j * nx + i) * 4 + 2] <= urbanLook2(maps.density[j * nx + i], near[j * nx + i]) + 1) continue;
      if (i >= bx0 - 1 && i <= bx1 + 1 && j >= bz0 - 1 && j <= bz1 + 1) raisedCentre++; else raised++;
    }
  }
  check('U4 the dense-centre rule stays in the centre (Kirchberg lawns, JFK verges, suburban gardens untouched) and paves Bd Royal to the shop fronts', lawnsCity.length === 0 && royalLawn.length === 0 && raised === 0,
    `lawns made city ${lawnsCity.length} of ${LAWNS.length}, Bd Royal strip cells not city ${royalLawn.length} of ${ROYAL.length}, cells raised outside the centre ${raised} (inside ${raisedCentre})`);
  stats.city12Squares = { cells, notPaved, raisedCentre, raisedOutside: raised };

  // ---- U5: the walls look finished
  let copingDeep = 0, stoneBehind = 0, earthWrong = 0, quads = 0;
  for (const w of drawnWalls(data.walls)) {
    const qs = wallQuads(w, groundAt);
    const P = w.pts;
    const depthBehind = (v) => {                               // how far behind the face line (toward the high ground) a vertex lies, from the nearest point of the wall
      let best = Infinity, d = 0;
      for (const p of P) { const dd = Math.hypot(v[0] - p.x, v[2] - p.z); if (dd < best) { best = dd; d = (v[0] - p.x) * p.nx + (v[2] - p.z) * p.nz; } }
      return d;
    };
    for (const q of qs) {
      quads++;
      const kind = q.a[0][1];
      const behind = Math.max(...q.q.map(depthBehind));
      if (q.part === 'top' && behind > WALL_LOOK.copingBack + STONE_TOL) copingDeep++;
      if ((q.part === 'bank' || q.part === 'back' || q.part === 'endBank') && kind !== WALL_KIND.back) earthWrong++;
      if (kind < WALL_KIND.coping && behind > WALL_LOOK.copingBack + STONE_TOL) stoneBehind++;
    }
  }
  check(`U5 walls: the coping is at most ${WALL_LOOK.copingBack} m deep, behind it earth, no stone deeper than the coping (no box, no tombstone)`, quads > 1000 && copingDeep === 0 && earthWrong === 0 && stoneBehind === 0,
    `${quads} quads: coping too deep ${copingDeep}, earth parts of another kind ${earthWrong}, stone behind the coping ${stoneBehind}`);
}
