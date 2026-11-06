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
import { laneClearanceScan, groupHits } from './lane-clearance.js';
import { createRoadIndex } from './road-index.js';
import { placeClear } from './placement.js';
import { deckDriveScan } from './harness-decks.js';

const T_SPEED = 13;            // m/s: the QA drive test
const T_DT = 1 / 60;
const T3_MAX_PUSHED = 13;      // runs of T3 in which something touches the car (drive12: 13 - deck 59 the Buchler car park spiral with no car park deck in the data, its bank;
                               // deck 169 Hondhausbréck: wall 41 at its free end on a bank; deck 197 service deck at 5693,9852 into building 6763).  A ratchet: lower it, never raise it
const T_STUCK = 4;             // s without progress along the route = stopped (the QA's rule)
const segDist = (x, z, a, b) => { const ex = b[0] - a[0], ez = b[1] - a[1], ll = ex * ex + ez * ez || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / ll)); return Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t); };
/** The QA's verified invisible-wall routes (qa3/jobs/wallpairs.json): [name, [[x, z, lane offset to the left], ...]]. */
const WALL_ROUTES = [
  ["p06_w18_r9423", [[8608.2, 5949.2, -7.48], [8604.3, 5951.3, -7.48], [8595.9, 5955.8, -7.48], [8582.7, 5962.5, -7.48], [8568.7, 5969.7, -7.48], [8556.4, 5975.9, -7.48], [8544.4, 5982.0, -7.48], [8533.0, 5988.0, -7.48], [8522.2, 5993.9, -7.48], [8512.5, 5999.4, -7.48], [8502.2, 6005.5, -7.48], [8494.5, 6010.4, -7.48], [8487.4, 6015.3, -7.48], [8480.2, 6020.7, -7.48]]],
  ["p09_w98_r241", [[1966.3, 11566.1, -2.45], [1971.3, 11597.7, -2.45], [1970.2, 11660.6, -2.45], [1965.5, 11707.4, -2.45]]],
  ["p11_w13_r11619", [[4835.0, 8104.9, 7.12], [4825.6, 8136.9, 7.12], [4818.5, 8163.8, 7.12], [4813.6, 8186.7, 7.12]]],
  ["p12_w44_r301", [[4904.1, 12224.7, -1.73], [4886.8, 12236.0, -1.73], [4872.9, 12245.9, -1.73], [4858.0, 12256.9, -1.73], [4844.9, 12267.6, -1.73], [4830.0, 12280.0, -1.73]]],
  ["p14_w72_r1104", [[4659.9, 12584.3, -2.45], [4652.6, 12633.8, -2.45], [4646.6, 12676.2, -2.45], [4640.3, 12720.4, -2.45]]],
  ["p16_w44_r11417", [[4897.3, 12222.5, -1.73], [4882.4, 12232.2, -1.73], [4866.9, 12243.6, -1.73], [4851.9, 12255.2, -1.73], [4838.6, 12266.3, -1.73]]],
  ["p18_w52_r11837", [[8701.5, 7343.3, -2.45], [8708.8, 7328.0, -2.45], [8715.5, 7314.3, -2.45], [8722.3, 7300.8, -2.45], [8727.6, 7290.9, -2.45], [8733.0, 7281.2, -2.45], [8743.1, 7263.8, -2.45], [8754.4, 7245.8, -2.45], [8765.1, 7229.6, -2.45]]],
  ["p19_w52_r11837", [[8701.5, 7343.3, 2.45], [8708.8, 7328.0, 2.45], [8715.5, 7314.3, 2.45], [8722.3, 7300.8, 2.45], [8727.6, 7290.9, 2.45], [8733.0, 7281.2, 2.45], [8743.1, 7263.8, 2.45], [8754.4, 7245.8, 2.45], [8765.1, 7229.6, 2.45]]],
  ["p24_w98_r11984", [[1975.8, 11577.6, -2.45], [1975.4, 11589.2, -2.45], [1974.4, 11598.4, -2.45], [1972.7, 11607.3, -2.45], [1971.3, 11617.2, -2.45], [1970.1, 11628.6, -2.45], [1969.6, 11640.1, -2.45], [1969.8, 11650.1, -2.45], [1970.5, 11659.0, -2.45], [1971.8, 11668.2, -2.45], [1972.7, 11676.6, -2.45]]],
  ["p26_w72_r434", [[4664.3, 12579.4, -2.45], [4659.5, 12603.6, -2.45], [4653.4, 12633.0, -2.45], [4647.5, 12669.6, -2.45], [4642.8, 12695.5, -2.45]]],
  ["p27_w80_r1057", [[5300.0, 9187.8, -3.53], [5296.4, 9197.2, -3.53], [5292.7, 9207.6, -3.53], [5288.4, 9219.4, -3.53], [5284.2, 9231.6, -3.53], [5279.4, 9245.2, -3.53], [5274.3, 9259.8, -3.53]]],
  ["p30_w5_r1045", [[1910.1, 11736.2, -1.6], [1914.6, 11741.6, -1.6], [1920.0, 11747.6, -1.6], [1924.8, 11752.6, -1.6], [1929.6, 11757.9, -1.6], [1934.4, 11763.3, -1.6], [1939.2, 11769.5, -1.6], [1943.8, 11776.0, -1.6], [1947.6, 11782.4, -1.6], [1951.5, 11789.8, -1.6], [1954.5, 11796.4, -1.6], [1957.6, 11804.0, -1.6]]],
  ["p31_w57_r1806", [[1384.5, 9585.6, 1.6], [1394.0, 9601.6, 1.6], [1404.6, 9617.1, 1.6], [1416.9, 9632.6, 1.6]]],
];
/** T5: a Pfaffenthal house under the Pont Rouge (QA3 N3-B01: the car stopped on the deck at 5209,8052.8). */
const ROUGE_POSE = [5209.0, 8052.8, 3.0], ROUGE_HOUSE = 7233;

export function runDrive12Checks({ check, section, stats, data, field, surface, ground, net, buildings, landmarks, portals, forest, playArea, maps, deckNetwork }) {
  section('T nothing stops the car where it may drive (drive12, QA round 3)');
  const isOpen = (r) => !!(net.roads[r.id] && net.roads[r.id].openCut);

  // ---- the game's collider (main.js), the props placed as the game places them
  const props = createPropCollider();
  const lamps = placeStreetLights({ roads: data.roads, network: net, buildings, map: maps, walls: data.walls });
  for (let i = 0; i < lamps.count; i++) props.add(lamps.x[i], lamps.z[i], LAMP_POST_RADIUS, surface.height(lamps.x[i], lamps.z[i]), LAMP_POST_HEIGHT);
  const benches = placeParkBenches({ roads: data.roads, network: net, buildings, map: maps });
  for (let i = 0; i < benches.count; i++) props.add(benches.x[i], benches.z[i], BENCH_RADIUS, surface.height(benches.x[i], benches.z[i]), BENCH_HEIGHT);
  const gameWalls = createWallCollider(data.walls, (x, z) => ground.height(x, z));
  const game = createCarCollider({ buildings, landmarks, walls: gameWalls, portals, ground, forest, props, trams: null, playArea, surface, deckNetwork });

  // ---- T1: the walls and every lane (the probe's own level: a wall collider without a ground function reads the level it is given)
  const probeWalls = createWallCollider(data.walls, null);
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
    // the QA's route carries its lane offset on into the next ways, where that lane may lie off the carriageway (a narrower way): judged on the wall's own way only
    const way = data.roads[Number(name.split('_r')[1])];
    let keep = 0;
    while (keep < all.length && nearWay(way, all[keep][0], all[keep][1])) keep++;
    const pts = all.slice(0, Math.max(4, keep + 1));
    const poly = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az, off] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az);
      if (l < 1e-3) continue;
      const dx = (bx - ax) / l, dz = (bz - az) / l;
      for (let s = 0; s < l; s += 1) poly.push([ax + dx * s - dz * off, az + dz * s + dx * off]);
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
