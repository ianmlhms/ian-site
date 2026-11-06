/* Lux Drive harness, section T (drive12): nothing stops the car where it may drive (QA round 3).
 *   T1  the centre of every lane of every car road, every metre, at the level of that road: no retaining wall's collision block touches the car's body there (QA3 N3-W01 /
 *       N3-W02: wall 52 across both lanes of the A1 at viaduct deck 23, 34 road / wall pairs with the lane centre inside a block; a road never ends in a wall)
 *   T2  the lanes of every bridge way at the level of its deck: no house, landmark wall, lamp, bench or tree under or beside the deck touches the car (QA3 N3-B01: the
 *       houses of Pfaffenthal 60 m under the Pont Rouge stopped the car on the deck; a 23-storey tower and five more blocks under other decks)
 *   T3  every car deck driven end to end both ways in EVERY lane (and on its axis) with the game's own collider (car-collide.js) probing the car's body: nothing touches it
 *       (the QA's lane drives saw what the axis run did not); a ratchet on the runs left (T3_MAX_PUSHED)
 *   T4  the QA's verified invisible-wall stops (wall 52 A1 deck 23, 98 A6 Croix de Gasperich, 72 A6 link, 44 four-lane road, 5 motorway link, 18 Kirchberg trunk link,
 *       57 Rue de Luxembourg, 13 Bd Robert Schuman, 80 Bd F.D. Roosevelt; qa3/jobs/wallpairs.json) driven with the game's car and collider: no stop, no wall touched
 *   T5  the car at its level: a car on the Pont Rouge over the Pfaffenthal houses is clear of them, a car on the ground beside the same house is stopped
 * Called by harness.js; everything it needs is passed in.  Pure Node. */
import { createCar } from './car.js';
import { CAR, TRAM } from './config.js';
import { createWallCollider } from './wall-collider.js';
import { createPropCollider } from './props.js';
import { placeStreetLights } from './street-lights.js';
import { placeParkBenches } from './park-benches.js';
import { createCarCollider, LAMP_POST_RADIUS, LAMP_POST_HEIGHT, BENCH_RADIUS, BENCH_HEIGHT } from './car-collide.js';
import { laneClearanceScan, groupHits, LANE } from './lane-clearance.js';
import { createRoadIndex } from './road-index.js';
import { placeClear } from './placement.js';
import { deckDriveScan } from './harness-decks.js';

const T_SPEED = 13;            // m/s: the QA drive test
const T_DT = 1 / 60;
const T3_MAX_PUSHED = 13;      // runs of T3 in which something touches the car (drive12: 13 - deck 59 the Buchler car park spiral with no car park deck in the data, its bank;
                               // deck 169 Hondhausbréck: wall 41 at its free end on a bank; deck 197 service deck at 5693,9852 into building 6763).  A ratchet: lower it, never raise it
const T_STUCK = 4;             // s without progress along the route = stopped (the QA's rule)
const segDist = (x, z, a, b) => { const ex = b[0] - a[0], ez = b[1] - a[1], ll = ex * ex + ez * ez || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / ll)); return Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t); };
/** The QA's verified invisible-wall routes (qa3/jobs/wallpairs.json: the wall's way from 45 m before the first hit, on into the next ways): [name, [[x, z, lane offset to the
 *  left], ...]], the offsets snapped to the lanes of the wall's way (lane-clearance.js laneOffsets).  (drive12b: the first table's polylines did not follow their ways - 5 to 90 m
 *  off them; p09 and p12 ran over the bank beside the A4 and across the field beside Rue In Bouler, the Kirchberg route p06 never touched 9423's lanes.) */
const WALL_ROUTES = [
  ["p06_w18_r9423", [[8586.9, 5961.3, -7.48], [8574.4, 5965.5, -7.48], [8549.9, 5978.3, -7.48], [8526.5, 5994.3, -7.48], [8504.6, 6004.9, -7.48], [8473.5, 6030.5, -7.48], [8462.2, 6037.1, -7.48], [8446.3, 6042.6, -7.48], [8438.2, 6043.8, -7.48], [8429.4, 6043.9, -7.48], [8421.6, 6042.6, -7.48], [8413.9, 6040.6, -7.48], [8402.9, 6035.3, -7.48], [8378.5, 6017, -7.48]]],
  ["p09_w98_r241", [[1946.5, 11590.3, -2.45], [1974.6, 11624.9, -2.45], [2009.4, 11665.3, -2.45], [2021, 11678.2, -2.45]]],
  ["p11_w13_r11619", [[4817.4, 8144.2, 7.12], [4862, 8134.3, 7.12], [4912.1, 8127.1, 7.12], [4968.7, 8115.9, 7.12]]],
  ["p12_w44_r301", [[4873.8, 12248.8, -1.73], [4829.7, 12207.2, -1.73], [4798.4, 12178.3, -1.73], [4765.3, 12146.2, -1.73], [4756.5, 12133.3, -1.73], [4746.4, 12110.9, -1.73]]],
  ["p14_w72_r1104", [[4652, 12628.3, -2.45], [4682.3, 12638.2, -2.45], [4725, 12652.2, -2.45], [4793.4, 12675.8, -2.45]]],
  ["p16_w44_r11417", [[4826.1, 12211.4, -1.73], [4870.1, 12253.2, -1.73], [4898, 12276.8, -1.73], [4931.9, 12303.5, -1.73], [4973.1, 12329.7, -1.73]]],
  ["p18_w52_r11837", [[8723.5, 7303, -2.45], [8727.6, 7292.2, -2.45], [8776.7, 7146.9, -2.45], [8786.9, 7111.8, -2.45], [8794.8, 7080.2, -2.45], [8799.3, 7058.8, -2.45], [8810.1, 7007.2, -2.45], [8816.9, 6963.3, -2.45], [8822.5, 6916.4, -2.45]]],
  ["p19_w52_r11837", [[8723.5, 7303, 2.45], [8727.6, 7292.2, 2.45], [8776.7, 7146.9, 2.45], [8786.9, 7111.8, 2.45], [8794.8, 7080.2, 2.45], [8799.3, 7058.8, 2.45], [8810.1, 7007.2, 2.45], [8816.9, 6963.3, 2.45], [8822.5, 6916.4, 2.45]]],
  ["p24_w98_r11984", [[1968.2, 11714.5, 2.45], [1967.2, 11650.3, 2.45], [1967.3, 11534.8, 2.45], [1971.9, 11401.5, 2.45], [1977.8, 11320.4, 2.45], [1983.9, 11266, 2.45], [1990.6, 11212.9, 2.45], [1998.9, 11159.5, 2.45], [2005.2, 11111.6, 2.45], [2018.6, 11053.6, 2.45], [2045.3, 10942.5, 2.45]]],
  ["p26_w72_r434", [[4654.6, 12617.4, 2.45], [4668.2, 12621.8, 2.45], [4684.7, 12627.2, 2.45], [4727.5, 12641.3, 2.45], [4798.8, 12665.7, 2.45]]],
  ["p27_w80_r1057", [[5280.4, 9225.3, 0], [5282.3, 9227.7, 0], [5284.8, 9229.3, 0], [5287.8, 9230.1, 0], [5290.8, 9229.8, 0], [5302.1, 9226.3, 0], [5334.9, 9214.5, 0]]],
  ["p30_w5_r1045", [[1940, 11770, 0], [1968.8, 11794.6, 0], [1992.4, 11809.3, 0], [2014.7, 11820.2, 0], [2048.7, 11833.4, 0], [2150, 11862.6, 0], [2183.1, 11874.9, 0], [2200.9, 11882.5, 0], [2225.2, 11893.9, 0], [2261.3, 11919.2, 0], [2334.2, 11972.8, 0], [2367, 11993.6, 0]]],
  ["p31_w57_r1806", [[1399.6, 9610.9, 1.6], [1393.3, 9588.1, 1.6], [1392.4, 9572.4, 1.6], [1392.1, 9535.6, 1.6]]],
];
/** The half width of way r as the network draws it at the centre-line sample nearest (x, z): its OSM half width with the width taper (road-network.js taperDhw). */
function drawnHalfWidth(net, r, x, z) {
  const hw = Math.max(0.8, r.width / 2), taper = net.taperDhw[r.id], ch = taper ? net.chains.find((c) => c.road === r.id) : null;
  if (!ch) return hw;
  let j = 0, best = Infinity;
  for (let i = 0; i < ch.x.length; i++) { const d = (ch.x[i] - x) ** 2 + (ch.z[i] - z) ** 2; if (d < best) { best = d; j = i; } }
  return hw + taper[j];
}
/** T5: a Pfaffenthal house under the Pont Rouge (QA3 N3-B01: the car stopped on the deck at 5209,8052.8). */
const ROUGE_POSE = [5209.0, 8052.8, 3.0], ROUGE_HOUSE = 7233;

/** The game's collider as main.js builds it (car-collide.js), the props placed as the game places them (no trams: they move).  Returns { game, gameWalls }. */
export function buildGameCollider({ data, surface, ground, net, buildings, landmarks, portals, forest, playArea, maps, deckNetwork }) {
  const props = createPropCollider();
  const lamps = placeStreetLights({ roads: data.roads, network: net, buildings, map: maps, walls: data.walls });
  for (let i = 0; i < lamps.count; i++) props.add(lamps.x[i], lamps.z[i], LAMP_POST_RADIUS, surface.height(lamps.x[i], lamps.z[i]), LAMP_POST_HEIGHT);
  const benches = placeParkBenches({ roads: data.roads, network: net, buildings, map: maps });
  for (let i = 0; i < benches.count; i++) props.add(benches.x[i], benches.z[i], BENCH_RADIUS, surface.height(benches.x[i], benches.z[i]), BENCH_HEIGHT);
  const gameWalls = createWallCollider(data.walls, (x, z) => ground.height(x, z), (x, z) => surface.height(x, z));
  const game = createCarCollider({ buildings, landmarks, walls: gameWalls, portals, ground, forest, props, trams: null, playArea, surface, deckNetwork, roads: data.roads });
  return { game, gameWalls };
}

export function runDrive12Checks({ check, section, stats, data, field, surface, ground, net, buildings, landmarks, portals, forest, playArea, maps, deckNetwork }) {
  section('T nothing stops the car where it may drive (drive12, QA round 3)');
  const isOpen = (r) => !!(net.roads[r.id] && net.roads[r.id].openCut);

  const { game, gameWalls } = buildGameCollider({ data, surface, ground, net, buildings, landmarks, portals, forest, playArea, maps, deckNetwork });

  // ---- T1: the walls and every lane (the probe's own level: a wall collider without a ground function reads the level it is given)
  const probeWalls = createWallCollider(data.walls, null, (x, z) => surface.height(x, z));          // (as the game's: a lane on a deck over a wall rides over it)
  const t1 = laneClearanceScan({ roads: data.roads, parts: [['wall', (x, z, r, y) => probeWalls.collide(x, z, r, y)]], ground, surface, isOpen });
  const g1 = groupHits(t1.hits);
  stats.laneWalls = { samples: t1.samples, hits: t1.hits.length, pairs: g1.length, list: g1.slice(0, 8).map((e) => `wall ${e.id} on ${e.name} (way ${e.road}) ${e.n} x at ${e.first}`) };
  check(`T1 no retaining wall's collision block reaches a lane (${t1.samples} lane samples, every lane of every car road at its level)`, g1.length === 0, stats.laneWalls.list.join('; '));

  // ---- T2: the lanes of the bridges, everything but the walls (T1) and the tram
  const t2 = laneClearanceScan({ roads: data.roads, parts: game.parts.filter(([n]) => ['building', 'landmark', 'prop', 'tree'].includes(n)), ground, surface, isOpen, only: (r) => !!(r.bridge || r.over) });
  // (a way that ENDS at a house - a dead end, no other car road goes on from there - stops the car at the house: that is right)
  const g2 = groupHits(t2.hits).filter((e) => !(e.end && e.part === 'building'));
  stats.deckLanes = { samples: t2.samples, pairs: g2.length, list: g2.slice(0, 10).map((e) => `${e.part} ${e.id} on ${e.name} (way ${e.road}) ${e.n} x at ${e.first}`) };
  check(`T2 nothing under or beside a bridge touches a car in its lanes at deck level (${t2.samples} samples: houses, landmark walls, lamps, benches, trees)`, g2.length === 0, stats.deckLanes.list.join('; '));

  // ---- T3: every car deck in every lane, the game's collider probing the body
  // (the edge of the play area is no deck bug: decks 154 / 157 run out of the area at Croix de Gasperich)
  const named = (x, z, r, y) => { for (const [n, f] of game.parts) { if (n === 'area') continue; const h = f(x, z, r, y); if (h) return { ...h, id: `${n}${h.id !== undefined ? ' ' + h.id : ''}` }; } return null; };
  const scan = deckDriveScan({ ground, surface, roads: data.roads, carCollide: named, allLanes: true });
  stats.deckLaneDrive = { decks: scan.decks, runs: scan.runs, pushed: scan.pushed.length, list: scan.pushed.slice(0, 10).map((p) => `deck ${p.deck} lane ${p.off.toFixed(1)} ${p.id ?? ''} at ${p.at.map(Math.round).join(',')}`), stepFailing: scan.failing.length,
    steps: scan.failing.slice(0, 12).map((f) => `deck ${f.deck} ${(f.step * 100).toFixed(0)} cm${f.air ? ` air ${f.air}` : ''} at ${f.at ? f.at.map(Math.round).join(',') : '-'}`) };
  check(`T3 every car deck driven end to end in every lane both ways (${scan.runs} runs over ${scan.decks} decks): nothing solid touches the car (ratchet <= ${T3_MAX_PUSHED} runs)`, scan.decks > 100 && scan.pushed.length <= T3_MAX_PUSHED, `${scan.pushed.length} runs: ${stats.deckLaneDrive.list.join('; ')}`);

  // ---- T4: the QA's verified wall stops
  const car = createCar({ ground, roadInfoAt: (x, z, o) => surface.roadInfoAt(x, z, o), collide: game.collide });
  const roadIndex = createRoadIndex(data.roads);
  const blockedAt = (x, z, yaw, hint) => { const lv = ground.levelAt(x, z, hint); return CAR.bodyCircles.concat(0).some((o) => !!game.collide(x + Math.cos(yaw) * o, z + Math.sin(yaw) * o, CAR.bodyRadius + 0.12, lv)); };
  const stopped = [];
  const nearWay = (r, x, z) => r.pts.some((q, i) => i + 1 < r.pts.length && segDist(x, z, q, r.pts[i + 1]) <= 1);
  for (const [name, all] of WALL_ROUTES) {
    // the QA's route carries its lane offset on into the next ways, where that lane may lie off the carriageway (a narrower way): judged on the wall's own way only (its points
    // on that way), and the lane kept LANE.edgeClear inside the carriageway as it is DRAWN - where a width taper narrows the way (a lane drop: Kirchberg 9423, 5 lanes -> 3) the
    // outer lane ends with the tarmac, as laneOffsets keeps it inside the OSM width
    const way = data.roads[Number(name.split('_r')[1])];
    let keep = 0;
    while (keep < all.length && nearWay(way, all[keep][0], all[keep][1])) keep++;
    const pts = all.slice(0, Math.max(2, keep));
    const poly = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az, off] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az);
      if (l < 1e-3) continue;
      const dx = (bx - ax) / l, dz = (bz - az) / l;
      for (let s = 0; s < l; s += 1) {
        const lim = Math.max(0, drawnHalfWidth(net, way, ax + dx * s, az + dz * s) - LANE.edgeClear), o = Math.max(-lim, Math.min(lim, off));
        poly.push([ax + dx * s - dz * o, az + dz * s + dx * o]);
      }
    }
    const st = car.state;
    // the QA's start: the game's teleport to the road nearest the first point (main.js teleportNear: placeClear, landCar), then the car put on the first point at that level
    const hit = roadIndex.nearest(poly[0][0], poly[0][1], 14);
    if (hit) { const p = placeClear(roadIndex, hit, st.heading, (x, z) => surface.height(x, z), blockedAt); ground.hint(p.hint); car.reset(p.x, p.z, p.yaw); ground.hint(st.y); }
    car.reset(poly[0][0], poly[0][1], Math.atan2(poly[3][1] - poly[0][1], poly[3][0] - poly[0][0]));
    ground.hint(st.y);
    let idx = 0, last = 0, stuck = 0, wallTouch = null;
    for (let t = 0; t < 40 && idx < poly.length - 3; t += T_DT) {
      const d2 = (k) => (poly[k][0] - st.x) ** 2 + (poly[k][1] - st.z) ** 2;
      while (idx < poly.length - 3 && d2(idx) >= d2(idx + 1)) idx++;
      const la = Math.min(poly.length - 1, idx + Math.round(Math.max(6, Math.abs(st.speed) * 0.7)));
      let e = Math.atan2(poly[la][1] - st.z, poly[la][0] - st.x) - st.heading;
      while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
      ground.hint(st.y);
      car.update(T_DT, { throttle: Math.max(0, Math.min(1, (T_SPEED - st.speed) * 0.5)), brake: 0, steer: Math.max(-1, Math.min(1, e * 1.6)), handbrake: false });
      if (!wallTouch) for (const o of CAR.bodyCircles) { const w = gameWalls.collide(st.x + Math.cos(st.heading) * o, st.z + Math.sin(st.heading) * o, CAR.bodyRadius); if (w) { wallTouch = `wall ${w.id} at ${st.x.toFixed(0)},${st.z.toFixed(0)}`; break; } }
      if (idx > last) { last = idx; stuck = 0; } else if ((stuck += T_DT) > T_STUCK) break;
    }
    const by = stuck > T_STUCK ? game.parts.filter(([, f]) => CAR.bodyCircles.some((o) => f(st.x + Math.cos(st.heading) * o, st.z + Math.sin(st.heading) * o, CAR.bodyRadius + 0.1, st.y - CAR.rideHeight))).map(([n]) => n) : [];
    // (a stop at the portal of a closed tunnel at the end of the wall's way is the game's rule - portals.js; Rue de Luxembourg runs into the 18 m tunnel under Route de Longwy)
    if (wallTouch || (stuck > T_STUCK && !(by.length === 1 && by[0] === 'portal'))) {
      stopped.push(`${name}: ${stuck > T_STUCK ? `stopped at ${st.x.toFixed(0)},${st.z.toFixed(0)} by ${by.join('+') || 'nothing (the ground)'}` : ''} ${wallTouch || ''}`.trim());
    }
  }
  stats.wallRoutes = { routes: WALL_ROUTES.length, stopped };
  check(`T4 the QA's ${WALL_ROUTES.length} verified invisible-wall stops (A1 deck 23, A6 Croix de Gasperich, A6 link, 4-lane road, Kirchberg link, Rue de Luxembourg, Bd Schuman, Bd Roosevelt) drive through`, stopped.length === 0, stopped.join('; '));

  // ---- T5: the level rule itself
  ground.hint(1e9);
  const deckY = ground.height(ROUGE_POSE[0], ROUGE_POSE[1]);
  const house = data.buildings[ROUGE_HOUSE];
  const hx = (house.pts[0] + house.pts[2]) / 2, hz = (house.pts[1] + house.pts[3]) / 2;        // (the middle of a wall of the house: the footprint is solid along its edges)
  const onDeck = buildings.collide(ROUGE_POSE[0], ROUGE_POSE[1], CAR.bodyRadius, deckY);
  const atHouse = buildings.collide(hx, hz, CAR.bodyRadius, surface.height(hx, hz));
  check('T5 a house stops the car at its own height only: clear of the car on the Pont Rouge over it, solid for a car on the ground at it', !onDeck && !!atHouse && deckY - surface.height(hx, hz) > 40,
    `deck ${deckY.toFixed(1)} m, on deck ${onDeck ? 'blocked' : 'clear'}, at the house ${atHouse ? 'blocked' : 'clear'}`);
}
