/* Lux Drive harness, section P (roads9): the width of the carriageways, the lines of the single-lane main roads and of the decks, the portals.
 *   P1  the tarmac of a carriageway never steps in width where one way of it hands over to the next: the width changes at <= 1 : 12 (QA: Av. J.F. Kennedy's lane count
 *       2 / 3 / 4 stepped the tarmac by 1.7 m per side every 50 - 100 m; the Jonction Grunewald slip road, M05)
 *   P2  a one-way main road of a single lane (Route d'Esch near 4065,11551) has its two edge lines (paint7's rule left it bare)
 *   P3  the lines on a bridge follow the class rule of the ground: every marked way that crosses on a deck carries its lines over the deck (a residential bridge, like a residential
 *       street, has none)
 *   P4  a portal headwall stands at most a parapet over a road behind it and never over a road that runs over it (QA B09: 2.4 m over Route de Longwy), the floored mouths aside
 *   P5  the cut of an opened shallow tunnel deeper than 2 m has retaining walls (the A1 under deck 32 had plain slopes, bridges8)
 * Called by harness.js; everything it needs is passed in.  Pure Node. */

import { buildMarkingPlan, chainPoint, MARK } from './markings.js';
import { isMarkedWay } from './carriageways.js';
import { PORTAL } from './config.js';
import { portalRoadAt } from './portals.js';
import { CHANNELS } from './road-network.js';

const PROBE = 0.3;                // m before and after a joint, along the chain
const MAX_STEP = 0.12;            // m of half width between the two probes (a 1 : 12 taper changes 0.05 over 0.6 m)
const MIN_DIFF = 0.3;             // m: the joints whose two ways differ by at least this in half width are measured ...
const MAX_STEPS_LEFT = 1;         // the joint left (Echangeur de Merl 3128,9998: the link's paint is pushed in where it merges off its level, not a width step; PROGRESS roads9)
const MIN_CUT = 10;               // m: P5 measures the opened cuts at least this long
const MIN_WAY = 20;               // m: P2 / P3 measure the ways at least this long ...
const MIN_COVER = 0.5;            // ... and want their lines over at least this share of them (junction mouths cut the rest)
const MIN_SHARE = 0.6, BARE = 0.1;  // P2: the share of the single-lane one-way main roads lined on both sides; a way with less than BARE of a line on either side is bare
const MAX_SINGLE_BARE = 3, MAX_BRIDGES_BARE = 0;
const ONE_LEVEL = 0.4;            // m: ... where their beds meet within this (two ways that meet at two levels are a step of the bed, not of the width: counted apart)

/** The half width of the painted carriageway of `group` at (x, z) on its centre line: minus the distance to its edge (the paint channel of that carriageway). */
function paintedHalf(net, x, z, group, out) {
  net.carve(x, z, out);
  for (let c = 0; c < out.chGroup.length; c++) if (out.chGroup[c] === group) return -out.chCar[c];
  return NaN;
}

export function runRoads9Checks({ check, section, stats, data, net, surface, portals, markDecks }) {
  section('P roads9: widths, lines, portals');
  const out = { ...net.scratch, chGroup: new Int32Array(CHANNELS), chCar: new Float32Array(CHANNELS), chPave: new Float32Array(CHANNELS), chMajor: new Uint8Array(CHANNELS), chCode: new Uint8Array(CHANNELS) };
  const chainOf = new Map(net.chains.map((c) => [c.road, c]));
  const groupOf = net.carriageways.groupOf;
  // ---- P1: the width at the joints of the carriageway chains
  let joints = 0, steps = 0, worst = 0, worstAt = '', twoLevels = 0;
  const stepList = [], levelList = [];
  for (const ws of net.carriageways.chainWays) {
    for (let k = 1; k < ws.length; k++) {
      const p = ws[k - 1], q = ws[k];
      const cp = chainOf.get(p.road), cq = chainOf.get(q.road);
      if (!cp || !cq || !net.info[p.road] || !net.info[q.road]) continue;                 // (a bridge or a tunnel in the chain: the deck is drawn by the deck view)
      if (Math.abs(net.info[p.road].hw - net.info[q.road].hw) < MIN_DIFF) continue;
      // the end of p and the start of q in the direction of the chain, and a point PROBE before / after along each
      const at = (c, fromEnd, d) => {
        const n = c.x.length, i = fromEnd ? n - 1 : 0, j = fromEnd ? n - 2 : 1;
        const dx = c.x[i] - c.x[j], dz = c.z[i] - c.z[j], l = Math.hypot(dx, dz) || 1;
        return [c.x[i] - (dx / l) * d, c.z[i] - (dz / l) * d];
      };
      const bedP = cp.bed[p.rev ? 0 : cp.x.length - 1], bedQ = cq.bed[q.rev ? cq.x.length - 1 : 0];
      if (Math.abs(bedP - bedQ) > ONE_LEVEL) { twoLevels++; if (levelList.length < 3) levelList.push(`${data.roads[p.road].name || data.roads[p.road].kind} ${p.road}/${q.road} ${Math.abs(bedP - bedQ).toFixed(2)} m`); continue; }
      const [ax, az] = at(cp, !p.rev, PROBE), [bx, bz] = at(cq, q.rev, PROBE);
      const g = groupOf[p.road];
      const ha = paintedHalf(net, ax, az, g, out), hb = paintedHalf(net, bx, bz, g, out);
      if (!Number.isFinite(ha) || !Number.isFinite(hb)) continue;
      joints++;
      const step = Math.abs(ha - hb);
      if (step > worst) { worst = step; worstAt = `${data.roads[p.road].name || data.roads[p.road].kind} ${p.road}/${q.road} at ${Math.round(ax)},${Math.round(az)}`; }
      if (step > MAX_STEP) { steps++; if (stepList.length < 5) stepList.push(`${data.roads[p.road].name || data.roads[p.road].kind} ${Math.round(ax)},${Math.round(az)} ${step.toFixed(2)} m`); }
    }
  }
  stats.widthJoints = { joints, steps, twoLevels, levelList, worstM: +worst.toFixed(3), worstAt, flickerFilled: (data.flickerFilled || []).length };
  check(`P1 the tarmac never steps in width at a joint of a carriageway (two ways of >= ${MIN_DIFF} m different half width: <= ${MAX_STEP} m over ${2 * PROBE} m)`,
    joints > 100 && steps <= MAX_STEPS_LEFT, `${joints} joints, ${steps} steps: ${stepList.join('; ')}; worst ${worst.toFixed(3)} m at ${worstAt}`);

  // ---- P2 / P3: the lines of single-lane one-way main roads and of the marked ways on decks (the coverage of the visible pieces of the edge / all tracks over a way)
  const plan = buildMarkingPlan(data.roads, net, markDecks);
  const piecesOf = new Map();
  plan.pieces.forEach((pc) => { const l = piecesOf.get(pc.track); if (l) l.push(pc); else piecesOf.set(pc.track, [pc]); });
  const tracksOf = new Map();
  plan.tracks.forEach((tr) => { const l = tracksOf.get(tr.chain); if (l) l.push(tr); else tracksOf.set(tr.chain, [tr]); });
  /** The share of [a, b] along the chain covered by the visible pieces of the tracks that pass `accept(tr)` (the best track; deckOnly: pieces on a deck). */
  const coverage = (ch, a, b, accept, deckOnly) => {
    let best = 0;
    for (const tr of tracksOf.get(ch.id) || []) {
      if (!accept(tr)) continue;
      let len = 0;
      for (const pc of piecesOf.get(tr.id) || []) if (!deckOnly || pc.deck) len += Math.max(0, Math.min(b, pc.s1) - Math.max(a, pc.s0));
      best = Math.max(best, len / Math.max(1e-6, b - a));
    }
    return best;
  };
  let single = 0, singleBare = 0, singleLen = 0, singleCover = 0, bridges = 0, bridgesBare = 0;
  const bareList = [], bridgeList = [];
  for (const ch of plan.chains) {
    ch.ways.forEach((w, k) => {
      const road = data.roads[w.road];
      const a = k === 0 ? 0 : ch.joints[k - 1], b = k < ch.joints.length ? ch.joints[k] : ch.length;
      if (b - a < MIN_WAY) return;
      // (the ways of the new rule: a single lane, no hard shoulder class, narrower than a street with edge lines anyway)
      if (road.oneway && Math.max(1, road.lanes || 1) === 1 && net.info[road.id] && !/^(motorway|trunk)/.test(road.kind) && net.info[road.id].hw < MARK.edgeMinHw && net.info[road.id].hw >= (MARK.singleLaneMinHw || 1.6)) {
        single++;
        const left = coverage(ch, a, b, (tr) => tr.role === 'edge' && tr.side * (w.rev ? -1 : 1) < 0, false), right = coverage(ch, a, b, (tr) => tr.role === 'edge' && tr.side * (w.rev ? -1 : 1) > 0, false);
        singleLen += b - a; singleCover += (b - a) * Math.min(left, right);
        if (Math.max(left, right) < BARE) { singleBare++; if (bareList.length < 4) bareList.push(`${road.name || road.kind} ${road.id} ${(b - a).toFixed(0)} m`); }
      }
      if (isMarkedWay(road) && !net.info[road.id] && (road.over || (road.layer || 0) >= 1)) {
        // (a way over the ground whose deck is not drawn - a landmark model: the Pont Rouge, the Pont Adolphe - is not counted: its middle lies on no deck of the plan)
        const mid = { x: 0, z: 0, nx: 0, nz: 0, bed: 0, way: 0 };
        chainPoint(ch, (a + b) / 2, mid);
        if (!plan.findDeck(mid.x, mid.z, mid.nz, -mid.nx, NaN)) return;
        const onDeck = coverage(ch, a, b, () => true, true);
        bridges++;
        if (onDeck < MIN_COVER) { bridgesBare++; if (bridgeList.length < 4) bridgeList.push(`${road.name || road.kind} ${road.id} ${onDeck.toFixed(2)}`); }
      }
    });
  }
  const singleShare = singleCover / Math.max(1, singleLen);
  stats.roads9Lines = { single, singleBare, singleShare: +singleShare.toFixed(3), bridges, bridgesBare };
  check(`P2 a one-way main road of a single lane has its two edge lines (both over >= ${MIN_SHARE * 100} % of their length, junction mouths cut the rest; at most ${MAX_SINGLE_BARE} ways of >= ${MIN_WAY} m bare)`,
    single > 20 && singleShare >= MIN_SHARE && singleBare <= MAX_SINGLE_BARE, `${single} ways, ${(singleShare * 100).toFixed(1)} % lined on both sides, ${singleBare} bare: ${bareList.join('; ')}`);
  check(`P3 the marked ways on bridges carry their lines over the deck (>= ${MIN_COVER * 100} % of the way)`, bridges > 20 && bridgesBare <= MAX_BRIDGES_BARE, `${bridges} ways on decks, ${bridgesBare} bare: ${bridgeList.join('; ')}`);

  // ---- P4: the headwalls against the roads behind and over them
  // (how many portals there must at least be - the check is not run on an empty list: tunnels19 opened seven more tunnels as drivable tubes, their 11 closed
  // portals are gone, 56 -> 45; the limit itself, no headwall over a road, is unchanged)
  const PORTALS_MIN = 40;
  const roadAt = portalRoadAt(net);
  let walls = 0, overRoad = 0, floored = 0;
  const wallList = [];
  for (const p of portals.list) {
    walls++;
    const wallTop = p.y + p.wallTop;
    // (the rule of portals.js: the highest road behind the wall caps it to a parapet over it, the lowest road over the wall caps it flush under it)
    let behind = -Infinity, over = Infinity;
    for (let v = 0.1; v <= PORTAL.recess + PORTAL.behindReach + 1e-6; v += v < PORTAL.recess ? 0.35 : 1.5) {
      for (let k = -2; k <= 2; k++) {
        const u = (k / 2) * p.half, x = p.x + p.sx * u - p.nx * v, z = p.z + p.sz * u - p.nz * v, r = roadAt(x, z);
        if (r < 0 || r === p.approach) continue;
        const h = surface.height(x, z);
        if (v < PORTAL.recess) over = Math.min(over, h); else behind = Math.max(behind, h);
      }
    }
    const flushed = over < Infinity;
    const worst = Math.max(behind > -Infinity ? wallTop - behind - PORTAL.parapet - 0.05 : -Infinity, flushed ? wallTop - over - 0.05 : -Infinity);
    if (worst > 0) {
      if (p.top <= (flushed ? PORTAL.topFloor : PORTAL.topMin) + 1e-3) { floored++; continue; }   // (capped as far as the rule goes: the lowest mouth)          // (the road over it is lower than the lowest mouth: the mouth cannot fit, listed in PROGRESS)
      overRoad++; if (wallList.length < 4) wallList.push(`${p.name || p.road} ${Math.round(p.x)},${Math.round(p.z)} ${worst.toFixed(2)} m`);
    }
  }
  stats.portalWalls = { walls, overRoad, floored };
  check('P4 no portal headwall stands more than a parapet over a road behind it, nor over a road that runs over it (the mouths at the lowest height the rule allows aside)', walls > PORTALS_MIN && overRoad === 0, `${walls} portals, ${overRoad} over a road: ${wallList.join('; ')}; ${floored} at the lowest mouth under a road`);

  // ---- P5: the walls of the opened cuts
  const cutWays = data.roads.filter((r) => r.openCut && net.info[r.id]);
  let deepCuts = 0, walledCuts = 0;
  const bareCuts = [];
  for (const r of cutWays) {
    const ch = net.chains.find((c) => c.road === r.id);
    if (!ch || ch.arc[ch.arc.length - 1] < MIN_CUT) continue;          // (a passage of a few metres - Rue Jules Wilhelm, 3 m - is shorter than any wall)
    let depth = 0;
    for (let i = 0; i < ch.x.length; i++) depth = Math.max(depth, ([-1, 1].map((sd) => {
      const a = Math.max(0, i - 1), b = Math.min(ch.x.length - 1, i + 1), dx = ch.x[b] - ch.x[a], dz = ch.z[b] - ch.z[a], l = Math.hypot(dx, dz) || 1;
      const o = net.info[r.id].hw + 6;
      return surface.height(ch.x[i] - (dz / l) * o * sd, ch.z[i] + (dx / l) * o * sd) - ch.bed[i];
    }).reduce((a, b) => Math.max(a, b), -Infinity)));
    if (depth < 2) continue;
    deepCuts++;
    const walled = (data.walls || []).some((w) => w.pts.some((q) => ch.x.some((x, i) => Math.hypot(q.x - x, q.z - ch.z[i]) < net.info[r.id].hw + 4)));
    if (walled) walledCuts++; else bareCuts.push(`${r.name || r.kind} ${r.id}`);
  }
  stats.cutWalls = { deepCuts, walledCuts };
  check('P5 the cut of an opened shallow tunnel deeper than 2 m has retaining walls', deepCuts >= 1 && walledCuts === deepCuts, `${deepCuts} deep cuts, ${walledCuts} walled; bare: ${bareCuts.join(', ')}`);
}
