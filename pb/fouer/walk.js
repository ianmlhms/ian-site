/* Schueberfouer Tycoon W6 "Walk": the first-person walk through the fair (DESIGN section 5).
 *
 * Two layers in this file:
 *   1. Pure geometry (no DOM, no THREE, tested by harness.js): the walkable mask (circle-vs-box collision, field polygon + gates + the tram lane),
 *      pitch helpers (front spot, distance to a pitch, "am I on its front side").
 *   2. createWalk(): the controller. Eye 1.65 m, FOV 70, keys / drag / pointer lock / joystick, interaction targets, eating, photo, hooks to the
 *      crowd, the audio and the ride. It takes the builder camera over (r.state.free) and gives it back exactly on exit.
 *
 * Frame convention (same as the builder rig): x = u (NE along the tram), z = w (toward Boulevard de la Foire), y up. A heading `yaw` looks along
 * (cos yaw, sin yaw); the RIGHT hand is (-sin yaw, cos yaw). So D / joystick-right is +right and A / joystick-left is -right: the v1 walk mode
 * had these swapped (vault notes), flows/fouer_walk.mjs checks it by projecting the real movement on the camera's right vector. */

import { isRideable, RIDE_DEFS } from "./rides/catalog.js";

export const WALK = Object.freeze({
  eye: 1.65, fov: 70, near: 0.2, radius: 0.34, speed: 2.0, run: 4.0, accel: 9, pitchLimit: 75 * Math.PI / 180,
  turnKeys: 1.9, lookTouch: 0.0042, lookMouse: 0.0034, bob: 0.028, stickRadius: 56, interactRange: 3.4, sheepRange: 3.6,
});
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FACE = { "+w": [0, 1], "-w": [0, -1], "+u": [1, 0], "-u": [-1, 0] };
export const faceVec = face => FACE[face] ?? FACE["+w"];

/* ------------------------------------------------------------------------------------------------ pure geometry */
/** closest-point test of a circle against an axis aligned box { u0, u1, w0, w1 }: null or { nx, nz, depth } (normal points out of the box) */
export function circleVsBox(cx, cz, r, box) {
  const px = clamp(cx, box.u0, box.u1), pz = clamp(cz, box.w0, box.w1);
  let dx = cx - px, dz = cz - pz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return null;
  if (d2 > 1e-9) { const d = Math.sqrt(d2); return { nx: dx / d, nz: dz / d, depth: r - d }; }
  // the centre is inside: leave through the nearest face
  const left = cx - box.u0, right = box.u1 - cx, down = cz - box.w0, up = box.w1 - cz;
  const m = Math.min(left, right, down, up);
  if (m === left) return { nx: -1, nz: 0, depth: left + r };
  if (m === right) return { nx: 1, nz: 0, depth: right + r };
  if (m === down) return { nx: 0, nz: -1, depth: down + r };
  return { nx: 0, nz: 1, depth: up + r };
}

/** oriented box { u, w, ax, az (unit axis of the long side), hl (half length), hw (half width) } */
export function circleVsObb(cx, cz, r, box) {
  const rx = cx - box.u, rz = cz - box.w;
  const lx = rx * box.ax + rz * box.az, lz = -rx * box.az + rz * box.ax;      // local coordinates
  const hit = circleVsBox(lx, lz, r, { u0: -box.hl, u1: box.hl, w0: -box.hw, w1: box.hw });
  if (!hit) return null;
  return { nx: hit.nx * box.ax - hit.nz * box.az, nz: hit.nx * box.az + hit.nz * box.ax, depth: hit.depth };
}

export function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** box minus hole: up to four boxes (used to carve the Riserad boarding corridor out of its pitch) */
export function subtractBox(box, hole) {
  if (hole.u1 <= box.u0 || hole.u0 >= box.u1 || hole.w1 <= box.w0 || hole.w0 >= box.w1) return [box];
  const out = [];
  if (hole.u0 > box.u0) out.push({ u0: box.u0, u1: hole.u0, w0: box.w0, w1: box.w1 });
  if (hole.u1 < box.u1) out.push({ u0: hole.u1, u1: box.u1, w0: box.w0, w1: box.w1 });
  const u0 = Math.max(box.u0, hole.u0), u1 = Math.min(box.u1, hole.u1);
  if (hole.w0 > box.w0) out.push({ u0, u1, w0: box.w0, w1: hole.w0 });
  if (hole.w1 < box.w1) out.push({ u0, u1, w0: hole.w1, w1: box.w1 });
  return out;
}

/** shortest distance from a point to the pitch rectangle { u, w, du, dw } (0 inside) */
export function distToRect(rect, x, z) {
  const dx = Math.max(Math.abs(x - rect.u) - rect.du / 2, 0), dz = Math.max(Math.abs(z - rect.w) - rect.dw / 2, 0);
  return Math.hypot(dx, dz);
}
/** half the depth of the pitch along its facing direction */
export const halfDepth = (rect, face) => (face === "+u" || face === "-u" ? rect.du : rect.dw) / 2;
/** is the point on the front half of the pitch (the side the attraction faces)? */
export function onFrontSide(rect, face, x, z) {
  const [fu, fw] = faceVec(face);
  return (x - rect.u) * fu + (z - rect.w) * fw >= halfDepth(rect, face) - 0.6;
}
/** where a guest or the player stands to use a pitch: `out` metres in front of the middle of its front edge, `shift` along the front */
export function frontSpot(rect, face, out = 2.5, shift = 0) {
  const [fu, fw] = faceVec(face);
  const h = halfDepth(rect, face);
  return { x: rect.u + fu * (h + out) - fw * shift, z: rect.w + fw * (h + out) + fu * shift };
}

/** the pitch footprint the NPC filler reserved around a pitch (same margins as models/npc.js buildNpcFair) */
function npcReserve(rect, face) {
  let u0 = rect.u - rect.du / 2 - 0.7, u1 = rect.u + rect.du / 2 + 0.7, w0 = rect.w - rect.dw / 2 - 0.7, w1 = rect.w + rect.dw / 2 + 0.7;       // fallback only (the exact stall footprints replace the grid): keep the generous reserve
  if (face === "+w") w1 += 0.8; else if (face === "-w") w0 -= 0.8; else if (face === "+u") u1 += 4; else u0 -= 4;
  return { u0, u1, w0, w1 };
}

/** Where can feet go. Static layer: NPC stalls (merged runs of the filler's occupancy grid), camelots beside the tram rails. Pitch layer: rebuilt
 * whenever a pitch changes (built and locked pitches are solid, open ones are walkable, the Riserad keeps a boarding corridor). Dynamic layer: the tram.
 * Region: the Glacis polygon + the open gates + the Allée Scheffer lane (reached through the NE portal). */
export function createMask({ fieldPoly, corridors = [], grid = null, rects = [], faces = [], entrances = [], lane = [], radius = WALK.radius, stalls = null, solids = null, boxes = null } = {}) {
  const npc = [];            // boxes of the NPC stalls: the exact footprints when the filler gives them, else runs of its occupancy grid
  const posts = [];          // small round solids { u, w, r }: lamp posts, bins, standing tables, masts
  const obbs = [];           // camelot strips
  let pitchBoxes = [];
  let dynamic = [];          // oriented boxes
  let gateRects = [];
  const ribbon = [];         // lane segments { u, w, ax, az, hl, hw }
  const LANE_HALF = 5.4, CAMELOT_IN = 3.45, CAMELOT_OUT = 6.1, GATE_OUT = 18;

  // ---- polish 2: the filler hands over its exact footprints (`stalls`), the small solids (`solids`: circles, `boxes`: benches / caravans). They ride on the grid array
  // (grid.g.stalls ...) so main.js needs no change; explicit options win.
  const exactStalls = stalls || (grid && grid.g && grid.g.stalls) || null;
  const smallSolids = solids || (grid && grid.g && grid.g.solids) || null;
  const smallBoxes = boxes || (grid && grid.g && grid.g.boxes) || null;
  if (smallSolids) smallSolids.forEach(p => posts.push({ u: p.u, w: p.w, r: p.r }));
  if (smallBoxes) smallBoxes.forEach(b => npc.push({ u0: b.u0, u1: b.u1, w0: b.w0, w1: b.w1 }));
  if (exactStalls) exactStalls.forEach(s => npc.push({ u0: s.u0, u1: s.u1, w0: s.w0, w1: s.w1 }));
  // ---- NPC stalls from the occupancy grid of models/npc.js buildNpcFair (fallback when no exact footprints exist). The filler marks the pitches and the alley corridors first (cells are rounded
  // OUT to whole cells) and only then places stalls on cells that are still free, so "marked and not reserved by a pitch / corridor" is exactly a stall.
  if (!exactStalls && grid && grid.g) {
    const { g, nu, nw, cell, u0, w0 } = grid;
    const reserved = new Uint8Array(nu * nw);
    const markReserved = (a0, a1, b0, b1) => {
      const i0 = Math.max(0, Math.floor((a0 - u0) / cell)), i1 = Math.min(nu - 1, Math.floor((a1 - u0) / cell));
      const j0 = Math.max(0, Math.floor((b0 - w0) / cell)), j1 = Math.min(nw - 1, Math.floor((b1 - w0) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) reserved[j * nu + i] = 1;
    };
    rects.forEach((rect, i) => { const b = npcReserve(rect, faces[i] ?? "+w"); markReserved(b.u0, b.u1, b.w0, b.w1); });
    corridors.forEach(c => markReserved(c.u[0], c.u[1], c.w[0], c.w[1]));
    for (let j = 0; j < nw; j++) {
      let run = -1;
      const flush = end => {
        if (run < 0) return;
        npc.push({ u0: u0 + run * cell, u1: u0 + end * cell, w0: w0 + j * cell, w1: w0 + (j + 1) * cell });
        run = -1;
      };
      for (let i = 0; i < nu; i++) {
        const solid = g[j * nu + i] === 1 && reserved[j * nu + i] === 0;
        if (solid) { if (run < 0) run = i; } else flush(i);
      }
      flush(nu);
    }
    // merge identical vertical runs into taller boxes (fewer boxes to test)
    npc.sort((a, b) => a.u0 - b.u0 || a.u1 - b.u1 || a.w0 - b.w0);
    for (let i = npc.length - 1; i > 0; i--) {
      const a = npc[i - 1], b = npc[i];
      if (a.u0 === b.u0 && a.u1 === b.u1 && Math.abs(a.w1 - b.w0) < 1e-6) { a.w1 = b.w1; npc.splice(i, 1); }
    }
  }

  // ---- the lane: free ribbon plus the camelot stalls on both sides (a gap in front of each NW gate: same half length as models/npc.js GATE_GAP)
  const NW_GATE_GAP = 6.5;
  const nwGateGap = u => entrances.some(e => e.kind === "gate" && e.face === "-w" && Math.abs(u - e.u) < NW_GATE_GAP);
  for (let i = 0; i + 1 < lane.length; i++) {
    const a = lane[i], b = lane[i + 1];
    const dx = b.u - a.u, dz = b.w - a.w, len = Math.hypot(dx, dz) || 1;
    const ax = dx / len, az = dz / len;
    const mid = { u: (a.u + b.u) / 2, w: (a.w + b.w) / 2 };
    ribbon.push({ ...mid, ax, az, hl: len / 2 + 0.05, hw: LANE_HALF });
    if (a.u >= 22 && a.u <= 272 && !nwGateGap(mid.u)) {
      for (const side of [-1, 1]) {
        const lat = side * (CAMELOT_IN + CAMELOT_OUT) / 2;
        obbs.push({ u: mid.u - az * lat, w: mid.w + ax * lat, ax, az, hl: len / 2 + 0.05, hw: (CAMELOT_OUT - CAMELOT_IN) / 2 });
      }
    }
  }

  // ---- gates (open ones only; `setGates` follows the star count)
  function setGates(starCount) {
    gateRects = [];
    for (const e of entrances) {
      if (e.star > starCount) continue;
      const [fu, fw] = faceVec(e.face);
      const half = e.kind === "gate" ? 3.6 : 6.2;
      const out = e.kind === "boom" ? 14 : GATE_OUT;
      const x0 = e.u - fu * 3, z0 = e.w - fw * 3, x1 = e.u + fu * out, z1 = e.w + fw * out;
      const tu = Math.abs(fw) * half, tw = Math.abs(fu) * half;
      gateRects.push({ u0: Math.min(x0, x1) - tu, u1: Math.max(x0, x1) + tu, w0: Math.min(z0, z1) - tw, w1: Math.max(z0, z1) + tw });
    }
  }
  setGates(5);

  function inRegion(x, z) {
    if (fieldPoly && pointInPoly(fieldPoly, x, z)) return true;
    for (const g of gateRects) if (x >= g.u0 && x <= g.u1 && z >= g.w0 && z <= g.w1) return true;
    for (const s of ribbon) {
      const rx = x - s.u, rz = z - s.w;
      if (Math.abs(rx * s.ax + rz * s.az) <= s.hl && Math.abs(-rx * s.az + rz * s.ax) <= s.hw) return true;
    }
    return false;
  }
  const RING = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function regionOk(x, z, r) {
    if (!inRegion(x, z)) return false;
    for (const [dx, dz] of RING) if (!inRegion(x + dx * r, z + dz * r)) return false;
    return true;
  }
  function pushOut(x, z, r) {
    let px = x, pz = z, hit = false;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      const apply = h => { if (h) { px += h.nx * (h.depth + 1e-4); pz += h.nz * (h.depth + 1e-4); moved = hit = true; } };
      for (const b of npc) { if (px + r < b.u0 || px - r > b.u1 || pz + r < b.w0 || pz - r > b.w1) continue; apply(circleVsBox(px, pz, r, b)); }
      for (const p of posts) { const dx = px - p.u, dz = pz - p.w, rr = r + p.r; if (dx * dx + dz * dz >= rr * rr) continue; const d = Math.sqrt(dx * dx + dz * dz) || 1e-6; const k = (rr - d + 1e-4) / d; px += dx * k; pz += dz * k; moved = hit = true; }
      for (const b of pitchBoxes) { if (px + r < b.u0 || px - r > b.u1 || pz + r < b.w0 || pz - r > b.w1) continue; apply(circleVsBox(px, pz, r, b)); }
      for (const b of obbs) { if (Math.abs(px - b.u) > b.hl + b.hw + r || Math.abs(pz - b.w) > b.hl + b.hw + r) continue; apply(circleVsObb(px, pz, r, b)); }
      for (const b of dynamic) { if (Math.abs(px - b.u) > b.hl + b.hw + r || Math.abs(pz - b.w) > b.hl + b.hw + r) continue; apply(circleVsObb(px, pz, r, b)); }
      if (!moved) break;
    }
    return { x: px, z: pz, hit };
  }
  function overlaps(x, z, r) {
    const q = pushOut(x, z, r);
    return q.hit;
  }

  const api = {
    npc, obbs, ribbon, posts,
    get pitchBoxes() { return pitchBoxes; },
    setGates,
    /** boxes of the pitch layer: built or locked pitches are solid, `carve` = [{ index, hole }] removes a rectangle from one pitch */
    setPitches(list) { pitchBoxes = list; },
    setDynamic(list) { dynamic = list; },
    inRegion,
    allowed(x, z, r = radius) { return regionOk(x, z, r) && !overlaps(x, z, r); },
    /** move a walker: push out of solids (so it slides along walls of any angle), never leave the region */
    move(x, z, dx, dz, r = radius) {
      let nx = x + dx, nz = z + dz;
      const out = pushOut(nx, nz, r);
      nx = out.x; nz = out.z;
      let edge = false;                       // the walker presses against the border of the walkable region (not against a stall)
      if (!regionOk(nx, nz, r)) {
        edge = true;
        if (regionOk(x + dx, z, r) && !overlaps(x + dx, z, r)) { nx = x + dx; nz = z; }
        else if (regionOk(x, z + dz, r) && !overlaps(x, z + dz, r)) { nx = x; nz = z + dz; }
        else { nx = x; nz = z; }
      }
      return { x: nx, z: nz, blocked: Math.hypot(nx - (x + dx), nz - (z + dz)) > 1e-3, edge };
    },
    /** nearest point where a walker of radius r fits (spiral search), or null */
    nearestFree(x, z, maxR = 30, step = 0.5, r = radius) {
      if (api.allowed(x, z, r)) return { x, z };
      for (let ring = step; ring <= maxR; ring += step) {
        const n = Math.max(8, Math.round(TAU * ring / step));
        for (let k = 0; k < n; k++) {
          const a = k / n * TAU, px = x + Math.cos(a) * ring, pz = z + Math.sin(a) * ring;
          if (api.allowed(px, pz, r)) return { x: px, z: pz };
        }
      }
      return null;
    },
    /** free width to the left (-1) / right (+1) of a heading at a point, up to `max` metres, in 0.5 m steps (the crowd lanes use it) */
    freeSide(x, z, hx, hz, side, max = 6, r = 0.3) {
      const nx = -hz * side, nz = hx * side;      // (-hz, hx) is the right-hand side for heading (hx, hz)
      let d = 0;
      while (d + 0.5 <= max && api.allowed(x + nx * (d + 0.5), z + nz * (d + 0.5), r)) d += 0.5;
      return d;
    },
    stats: () => ({ npc: npc.length, posts: posts.length, obbs: obbs.length, pitch: pitchBoxes.length, ribbon: ribbon.length, gates: gateRects.length }),
  };
  return api;
}

/** the low red-white barrier round a free plot (models/plots.js: three sides + the front with a gate opening in the middle): thin boxes in world metres */
export function plotFence(rect, face) {
  if (rect.size === "W") return [];
  const hx = rect.du / 2 - 0.35, hz = rect.dw / 2 - 0.35, t = 0.2, gate = Math.min(4.2, rect.du * 0.4);
  const s = face === "-w" ? -1 : 1;
  const wb = rect.w - s * hz, wf = rect.w + s * hz, wlo = Math.min(wb, wf), whi = Math.max(wb, wf);
  return [
    { u0: rect.u - hx, u1: rect.u + hx, w0: wb - t, w1: wb + t },
    { u0: rect.u - hx - t, u1: rect.u - hx + t, w0: wlo, w1: whi },
    { u0: rect.u + hx - t, u1: rect.u + hx + t, w0: wlo, w1: whi },
    { u0: rect.u - hx, u1: rect.u - gate / 2, w0: wf - t, w1: wf + t },
    { u0: rect.u + gate / 2, u1: rect.u + hx, w0: wf - t, w1: wf + t },
  ];
}

/** Solid boxes of the pitch layer from the game state: built / locked / growing pitches block, open ones do not (but their plot barrier does, `fenceAt` + `faces`).
 * `holes[index]` carves a corridor. */
export function pitchSolids(rects, solidAt, holes = {}, { fenceAt = null, faces = [] } = {}) {
  const out = [];
  rects.forEach((rect, i) => {
    if (!solidAt(i)) { if (fenceAt && fenceAt(i)) out.push(...plotFence(rect, faces[i] ?? "+w")); return; }
    let boxes = [{ u0: rect.u - rect.du / 2 - 0.2, u1: rect.u + rect.du / 2 + 0.2, w0: rect.w - rect.dw / 2 - 0.2, w1: rect.w + rect.dw / 2 + 0.2 }];
    if (holes[i]) boxes = boxes.flatMap(b => subtractBox(b, holes[i]));
    out.push(...boxes);
  });
  return out;
}

/** step an angle towards a target the short way */
export const angleDelta = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

/* ------------------------------------------------------------------------------------------------ the controller */
const FOOD = new Set(["kachel", "fritten", "wurscht", "zocker", "mandel", "waffel", "fesch", "crepes", "tent"]);
const GAMES = new Set(["lous", "lukas", "schiess"]);
export const isFood = id => FOOD.has(id);
const FOOD_ICON = { kachel: "🥔", fritten: "🍟", wurscht: "🌭", zocker: "🍭", mandel: "🌰", waffel: "🧇", fesch: "🐟", crepes: "🥞", tent: "🍺" };
const EAT_SECONDS = 2.0;
const NE_EDGE_U = 288, NE_BACK_U = 262;        // walking beyond the NE portal: where the soft border starts, where the nudge points to (a point inside the fair)

export function createWalk({ T, r, world, fair, game, scene, ui, sfx, audio, crowd, ride, mask, env, hooks, rects, items, tram = null, translate }) {
  const camera = r.camera;
  const canvas = r.renderer.domElement;
  const root = document.getElementById("ui");
  const view = { x: 0, z: 0, y: 0, yaw: 0, pitch: 0 };
  const motion = { vx: 0, vz: 0, bob: 0, speed: 0 };
  const input = { keys: new Set(), stick: { x: 0, y: 0, id: null }, look: null, locked: false, touchSeen: false };
  const state = { edgeT: 0, active: false, saved: null, targets: [], target: null, eating: 0, eatItem: null, clock: 0, scan: 0, lastBuilt: -1, flash: 0, hintShown: false, photoBusy: false };
  const T_ = (key, params) => translate(ui.lang, key, params);
  const tmpF = new T.Vector3();

  // remember where the player built last (the walk starts there)
  game.on("built", ({ index }) => { state.lastBuilt = index; });
  game.on("upgraded", ({ index }) => { state.lastBuilt = index; });

  /* ---------------------------------------------------------------- pitch layer of the mask */
  function rebuildMask() {
    const holes = {};
    const wheel = state.wheelIndex();
    if (wheel >= 0) { const hole = ride.boardingHole(wheel); if (hole) holes[wheel] = hole; }
    mask.setPitches(pitchSolids(rects, i => Boolean(game.state.pitches[i]) || game.pitchStatus(i) === "locked", holes, { fenceAt: () => true, faces: items.faceOf ? rects.map((_, i) => items.faceOf(i)) : [] }));
    mask.setGates(game.stars());
  }
  state.wheelIndex = () => game.state.pitches.findIndex(entry => entry && entry.k === "wheel");
  game.on("change", rebuildMask);
  rebuildMask();

  /* ---------------------------------------------------------------- DOM (walk HUD) */
  const el = (tag, className, html) => { const node = document.createElement(tag); if (className) node.className = className; if (html !== undefined) node.innerHTML = html; return node; };
  const hud = el("div", "wk"); hud.hidden = true;
  hud.innerHTML = `
    <button class="wk-exit" type="button"><span>←</span><b></b></button>
    <div class="wk-cash"><i>€</i><b></b></div>
    <div class="wk-foodie" hidden></div>
    <button class="wk-photo" type="button">📷</button>
    <div class="wk-dot"></div>
    <div class="wk-stick" hidden><i></i></div>
    <button class="wk-act" type="button" hidden><span class="ic"></span><small></small></button>
    <div class="wk-keys"></div>
    <div class="wk-eat" hidden><div class="hand"></div><div class="steam"><i></i><i></i><i></i><i></i><i></i></div></div>
    <div class="wk-think" hidden></div>
    <div class="wk-stamp" hidden><div class="ic"></div><b></b><span></span></div>
    <div class="wk-fade"></div>
    <div class="wk-flash"></div>`;
  root.append(hud);
  const q = sel => hud.querySelector(sel);
  const exitBtn = q(".wk-exit"), cashEl = q(".wk-cash b"), foodieEl = q(".wk-foodie"), photoBtn = q(".wk-photo"), stickEl = q(".wk-stick"), knob = q(".wk-stick i"),
    stampEl = q(".wk-stamp"), actBtn = q(".wk-act"), keysEl = q(".wk-keys"), eatEl = q(".wk-eat"), thinkEl = q(".wk-think"), fadeEl = q(".wk-fade"), flashEl = q(".wk-flash");

  function labels() {
    exitBtn.querySelector("b").textContent = T_("walk.exit");
    exitBtn.setAttribute("aria-label", T_("walk.exit"));
    photoBtn.setAttribute("aria-label", T_("walk.photo"));
    keysEl.textContent = T_("walk.keys");
  }

  /* ---------------------------------------------------------------- input */
  function onKeyDown(e) {
    if (!state.active) return;
    if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;
    const code = e.code;
    let handled = true;
    if (code === "Escape") { if (ride.active) ride.abort(); else end(); }
    else if (code === "KeyE" || code === "Enter" || code === "Space") { if (!e.repeat) interact(); }
    else if (code === "KeyP") photo();
    else if (code === "KeyL") togglePointerLock();
    else if (code === "ArrowLeft") input.keys.add("tl");
    else if (code === "ArrowRight") input.keys.add("tr");
    else if (code === "ShiftLeft" || code === "ShiftRight") input.keys.add("run");
    else if (code === "KeyW" || code === "ArrowUp") input.keys.add("f");
    else if (code === "KeyS" || code === "ArrowDown") input.keys.add("b");
    else if (code === "KeyA") input.keys.add("l");
    else if (code === "KeyD") input.keys.add("r");
    else handled = false;
    if (handled) { e.stopImmediatePropagation(); e.preventDefault(); input.touchSeen = false; }
    else e.stopImmediatePropagation();       // the builder's own keys (F = frame the field ...) must not fire while walking
  }
  function onKeyUp(e) {
    const code = e.code;
    if (code === "ArrowLeft") input.keys.delete("tl"); else if (code === "ArrowRight") input.keys.delete("tr");
    else if (code === "ShiftLeft" || code === "ShiftRight") input.keys.delete("run");
    else if (code === "KeyW" || code === "ArrowUp") input.keys.delete("f");
    else if (code === "KeyS" || code === "ArrowDown") input.keys.delete("b");
    else if (code === "KeyA") input.keys.delete("l");
    else if (code === "KeyD") input.keys.delete("r");
    if (state.active) e.stopImmediatePropagation();
  }
  function onBlur() { input.keys.clear(); }

  /** look: yaw / pitch from a drag; the ride keeps its own base orientation and only adds this */
  function look(dx, dy, scale) {
    view.yaw += dx * scale; view.pitch = clamp(view.pitch - dy * scale, -WALK.pitchLimit, WALK.pitchLimit);
  }
  let tapStart = null;
  function onPointerDown(e) {
    if (!state.active || e.target !== canvas) return;
    e.stopImmediatePropagation();
    if (e.pointerType === "touch") input.touchSeen = true;
    audio.unlock(); sfx.unlock();
    if (input.look && input.look.id !== e.pointerId) return;            // one look finger
    input.look = { id: e.pointerId, x: e.clientX, y: e.clientY, mouse: e.pointerType === "mouse" };
    tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, type: e.pointerType, button: e.button };
    try { canvas.setPointerCapture(e.pointerId); } catch (error) { /* ignore */ }
  }
  function onPointerMove(e) {
    if (!state.active) return;
    if (input.locked && document.pointerLockElement === canvas && e.target === canvas) { e.stopImmediatePropagation(); look(e.movementX, e.movementY, WALK.lookMouse); return; }
    if (!input.look || input.look.id !== e.pointerId) return;
    e.stopImmediatePropagation();
    const dx = e.clientX - input.look.x, dy = e.clientY - input.look.y;
    if (tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 9) tapStart.moved = true;
    input.look.x = e.clientX; input.look.y = e.clientY;
    look(dx, dy, input.look.mouse ? WALK.lookMouse : WALK.lookTouch);
  }
  function onPointerUp(e) {
    if (!state.active) return;
    if (input.look && input.look.id === e.pointerId) {
      e.stopImmediatePropagation();
      input.look = null;
      if (tapStart && !tapStart.moved && e.type === "pointerup" && performance.now() - tapStart.t < 420) onTap(e.clientX, e.clientY, tapStart.type);
      tapStart = null;
    }
  }
  function onTap(x, y, type) {
    if (crowd.tapSheep(x, y)) { petSheep(); return; }
    if (type === "mouse") interact();           // a click is E (touch uses the round button)
  }
  function togglePointerLock() {
    if (document.pointerLockElement === canvas) { document.exitPointerLock(); input.locked = false; return; }
    try { const p = canvas.requestPointerLock(); input.locked = true; if (p && p.catch) p.catch(() => { input.locked = false; }); } catch (error) { input.locked = false; }
  }
  document.addEventListener("pointerlockchange", () => { input.locked = document.pointerLockElement === canvas; });

  // joystick (left thumb): the base follows the first touch in the lower left, the knob is limited to WALK.stickRadius
  let stickOrigin = null;
  stickEl.addEventListener("pointerdown", e => {
    if (input.stick.id !== null) return;
    e.preventDefault(); e.stopPropagation(); audio.unlock(); sfx.unlock();
    input.touchSeen = true; input.stick.id = e.pointerId;
    const box = stickEl.getBoundingClientRect(); stickOrigin = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    try { stickEl.setPointerCapture(e.pointerId); } catch (error) { /* ignore */ }
    moveStick(e);
  });
  function moveStick(e) {
    if (!stickOrigin) return;
    let dx = e.clientX - stickOrigin.x, dy = e.clientY - stickOrigin.y;
    const len = Math.hypot(dx, dy), max = WALK.stickRadius;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    input.stick.x = dx / max; input.stick.y = dy / max;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  stickEl.addEventListener("pointermove", e => { if (e.pointerId === input.stick.id) { e.preventDefault(); moveStick(e); } });
  const endStick = e => { if (e.pointerId !== input.stick.id) return; input.stick = { x: 0, y: 0, id: null }; knob.style.transform = ""; stickOrigin = null; };
  stickEl.addEventListener("pointerup", endStick); stickEl.addEventListener("pointercancel", endStick);

  actBtn.addEventListener("click", () => { audio.unlock(); sfx.unlock(); interact(); });
  exitBtn.addEventListener("click", () => { sfx.click(); if (ride.active) ride.abort(); else end(); });
  photoBtn.addEventListener("click", () => { audio.unlock(); photo(); });
  // the walk owns the keyboard and the canvas while it runs: the builder's handlers (registered earlier, bubbling) never see these events
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  window.addEventListener("wheel", e => { if (state.active && e.target === canvas) { e.stopImmediatePropagation(); e.preventDefault(); } }, { capture: true, passive: false });

  function moveVector() {
    let f = 0, s = 0;
    if (input.keys.has("f")) f += 1; if (input.keys.has("b")) f -= 1;
    if (input.keys.has("r")) s += 1; if (input.keys.has("l")) s -= 1;
    const keysUsed = f !== 0 || s !== 0;
    let analog = false;
    if (input.stick.id !== null && !keysUsed) {
      const sx = input.stick.x, sy = input.stick.y, len = Math.hypot(sx, sy);
      if (len > 0.12) {
        // direction from the thumb, magnitude 0.35 .. 1 from how far it is pushed (a light push still walks)
        const k = Math.min(1, (len - 0.12) / 0.8), m = 0.35 + 0.65 * k;
        f = -sy / len * m; s = sx / len * m; analog = true;
      }
    }
    const l = Math.hypot(f, s);
    if (l > 1) { f /= l; s /= l; }
    const run = input.keys.has("run") || (analog && Math.hypot(input.stick.x, input.stick.y) > 0.93);
    return { f, s, run };
  }

  /* ---------------------------------------------------------------- start / end */
  function startSpot() {
    const index = state.lastBuilt >= 0 && game.state.pitches[state.lastBuilt] ? state.lastBuilt : game.state.pitches.findIndex(Boolean);
    const target = index >= 0 ? index : 0;
    const rect = rects[target], face = items.faceOf(target);
    const spot = frontSpot(rect, face, 7.5);
    const free = mask.nearestFree(spot.x, spot.z, 40) ?? { x: spot.x, z: spot.z };
    return { x: free.x, z: free.z, yaw: Math.atan2(rect.w - free.z, rect.u - free.x) };
  }

  function start(spot = null) {
    if (state.active) return;
    const rig = r.rig;
    state.saved = { rig: { ...rig }, fov: camera.fov, near: camera.near, pos: camera.position.clone(), quat: camera.quaternion.clone(), free: r.state.free };
    rig.flight = null;
    r.state.free = { walk: true };
    state.active = true;
    const s = spot ?? startSpot();
    view.x = s.x; view.z = s.z; view.yaw = s.yaw ?? 0; view.pitch = -0.02;
    view.y = world.groundY(view.x, view.z) + WALK.eye;
    motion.vx = motion.vz = 0;
    camera.fov = WALK.fov; camera.near = WALK.near; camera.updateProjectionMatrix();
    hud.hidden = false;
    labels();
    state.hintShown = false;
    rebuildMask();
    crowd.setMode("walk"); audio.setMode("walk");
    if (fair.setTiled) fair.setTiled(true);                  // polish 2: spatial tiles of the base + pitch batches (frustum culling at eye level)
    hooks.walking = true;
    hooks.onWalkChange(true);
    document.body.classList.add("wk-on");
    fadeEl.classList.remove("on"); fadeEl.style.transition = "none"; fadeEl.style.opacity = "1"; void fadeEl.offsetWidth; fadeEl.style.transition = ""; fadeEl.style.opacity = "0";
    applyCamera(0.016);
    ui.toast(T_(input.touchSeen || matchMedia("(pointer: coarse)").matches ? "walk.hintTouch" : "walk.hintKeys"), 4200);
    return s;
  }

  function end() {
    if (!state.active) return;
    if (ride.active) ride.abort(true);
    state.active = false;
    state.eating = 0; eatEl.hidden = true; thinkEl.hidden = true;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    input.keys.clear(); input.stick = { x: 0, y: 0, id: null }; input.look = null; knob.style.transform = "";
    const saved = state.saved; state.saved = null;
    Object.assign(r.rig, saved.rig); r.rig.flight = null;
    r.state.free = saved.free ?? null;
    camera.fov = saved.fov; camera.near = saved.near; camera.updateProjectionMatrix();
    r.setPose({}, true);
    hud.hidden = true;
    document.body.classList.remove("wk-on");
    crowd.setMode("builder"); audio.setMode("builder");
    if (fair.setTiled) fair.setTiled(false);
    hooks.walking = false;
    hooks.onWalkChange(false);
  }

  /* ---------------------------------------------------------------- camera */
  const rideBasis = { f: new T.Vector3(), u: new T.Vector3(), rgt: new T.Vector3() };
  const quat = new T.Quaternion(), qy = new T.Quaternion(), qx = new T.Quaternion(), m4 = new T.Matrix4();
  function applyCamera(dt) {
    const frame = ride.active ? ride.frame() : null;
    if (frame) {
      // ride: base orientation from the ride (upright wheel gondola / coaster frame), the drag-look rotates relative to it
      rideBasis.f.copy(frame.forward).normalize(); rideBasis.u.copy(frame.up).normalize();
      rideBasis.rgt.crossVectors(rideBasis.f, rideBasis.u).normalize();
      m4.makeBasis(rideBasis.rgt, rideBasis.u, rideBasis.f.clone().negate());      // camera looks down its -z
      quat.setFromRotationMatrix(m4);
      qy.setFromAxisAngle(rideBasis.u, -view.yaw); qx.setFromAxisAngle(new T.Vector3(1, 0, 0), view.pitch);
      camera.quaternion.copy(qy.multiply(quat).multiply(qx));
      camera.position.copy(frame.position);
      camera.updateMatrixWorld(true);
      return;
    }
    const bob = Math.sin(motion.bob) * WALK.bob * Math.min(1, motion.speed / 1.5);
    camera.position.set(view.x, view.y + bob, view.z);
    const cp = Math.cos(view.pitch);
    camera.up.set(0, 1, 0);
    camera.lookAt(view.x + Math.cos(view.yaw) * cp, view.y + bob + Math.sin(view.pitch), view.z + Math.sin(view.yaw) * cp);
    camera.updateMatrixWorld(true);
  }

  /* ---------------------------------------------------------------- interaction targets */
  function frontOk(i, x, z) { return onFrontSide(rects[i], items.faceOf(i), x, z); }
  function scanTargets() {
    const list = [];
    const px = view.x, pz = view.z;
    game.state.pitches.forEach((entry, i) => {
      if (!entry) return;
      const rect = rects[i];
      const d = distToRect(rect, px, pz);
      if (isFood(entry.k)) { if (d <= WALK.interactRange && frontOk(i, px, pz)) list.push({ kind: "eat", i, item: entry.k, d, icon: "🍴", label: "act.eat" }); }
      else if (entry.k === "wheel") {
        const b = ride.boardInfo(i);
        if (b) { const bd = Math.hypot(px - b.u, pz - b.w); if (bd <= b.radius) list.push({ kind: "wheel", i, d: bd * 0.6, icon: "🎡", label: "act.ride" }); }
      } else if (isRideable(entry.k)) { if (d <= WALK.interactRange + 0.8 && frontOk(i, px, pz) && ride.canRide(i)) list.push({ kind: "ride", i, item: entry.k, d, icon: RIDE_DEFS[entry.k].icon, label: "act.ride" }); }
      else if (GAMES.has(entry.k)) { if (d <= WALK.interactRange && frontOk(i, px, pz)) list.push({ kind: "play", i, item: entry.k, d, icon: entry.k === "lukas" ? "🔨" : entry.k === "schiess" ? "🎯" : "🎟️", label: "act.play" }); }
    });
    const probe = ride.probeSpot();
    if (probe) { const d = Math.hypot(px - probe.x, pz - probe.z); if (d <= 5.5) list.push({ kind: "probe", i: probe.i, d, icon: "🎡", label: "act.probe" }); }
    const sheep = crowd.sheepPosition();
    if (sheep) { const d = Math.hypot(px - sheep.x, pz - sheep.z); if (d <= WALK.sheepRange) list.push({ kind: "pet", d: d * 0.8, icon: "🐑", label: "act.pet" }); }
    list.sort((a, b) => a.d - b.d);
    state.targets = list;
    state.target = list[0] ?? null;
  }

  function refreshButton() {
    const show = ride.active || (state.target !== null && state.eating <= 0);
    actBtn.hidden = !show;
    if (!show) return;
    if (ride.active) { actBtn.querySelector(".ic").textContent = "✕"; actBtn.querySelector("small").textContent = T_("act.leave"); actBtn.dataset.kind = "leave"; return; }
    actBtn.querySelector(".ic").textContent = state.target.icon;
    actBtn.querySelector("small").textContent = T_(state.target.label);
    actBtn.dataset.kind = state.target.kind;
  }

  function interact() {
    if (!state.active) return;
    if (ride.active) { ride.abort(); return; }
    if (state.eating > 0) return;
    const target = state.target;
    if (!target) return;
    switch (target.kind) {
      case "eat": eat(target.i, target.item); break;
      case "wheel": ride.boardWheel(target.i); break;
      case "probe": ride.probe(); break;
      case "ride": ride.board(target.i); break;
      case "play": playGame(target); break;
      case "pet": petSheep(); break;
      default: break;
    }
  }

  /* ---------------------------------------------------------------- eating */
  function say(text, ms = 3200) {
    thinkEl.textContent = text; thinkEl.hidden = false; thinkEl.classList.remove("show"); void thinkEl.offsetWidth; thinkEl.classList.add("show");
    clearTimeout(say.timer); say.timer = setTimeout(() => { thinkEl.hidden = true; thinkEl.classList.remove("show"); }, ms);
  }
  function eat(index, itemId) {
    const result = game.eat(itemId);
    state.eating = EAT_SECONDS; state.eatItem = itemId;
    eatEl.querySelector(".hand").innerHTML = handSvg(FOOD_ICON[itemId] ?? "🍴");
    eatEl.hidden = false; eatEl.classList.remove("go"); void eatEl.offsetWidth; eatEl.classList.add("go");
    audio.eat(); sfx.coin();
    const key = `eat.${itemId}`;
    say(T_(key));
    if (result.granted) ui.toast(T_("foodie.gain", { mult: foodieText(result.mult), n: result.stacks }), 4200);
    else if (result.known) ui.toast(T_("foodie.known"), 3000);
    else if (result.full) ui.toast(T_("foodie.full"), 3000);
    refreshFoodie();
    scene.addSparkles(index, 2.4);
  }
  const foodieText = mult => (Math.round(mult * 100) / 100).toFixed(2).replace(/0$/, "");
  function handSvg(emoji) {
    return `<svg viewBox="0 0 240 200" aria-hidden="true"><path d="M20 200 C30 130 70 96 120 96 C170 96 205 130 216 200 Z" fill="#e8b48a"/><path d="M52 200 C58 150 84 118 120 118 C156 118 182 150 190 200 Z" fill="#f2c9a4"/><rect x="62" y="70" width="116" height="40" rx="8" fill="#f6efe0" stroke="#d8c7a2" stroke-width="3"/><path d="M62 86 L178 86" stroke="#c8283a" stroke-width="3" opacity=".5"/></svg><div class="food">${emoji}</div>`;
  }
  function refreshFoodie() {
    const f = game.foodie();
    foodieEl.hidden = f.stacks === 0 && !f.fun;
    const parts = [];
    if (f.stacks) parts.push(`<b>🍴 ${esc(T_("foodie.title"))} ×${foodieText(f.mult)}</b><small>${esc(formatSeconds(f.left))}</small>`);
    if (f.fun) parts.push(`<b>🎠 ${esc(T_("fun.title"))} +3%</b><small>${esc(formatSeconds(f.funLeft))}</small>`);
    if (parts.length) foodieEl.innerHTML = parts.join("");
  }
  const esc = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const formatSeconds = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  /* ---------------------------------------------------------------- small interactions */
  function playGame(target) {
    audio.playGame(target.item);
    say(T_(`play.${target.item}`));
    const rect = rects[target.i];
    scene.addSparkles(target.i, 2.4);
    void rect;
  }
  function petSheep() {
    crowd.bleat();
    audio.bleat();
    say(T_("sheep.say"), 2600);
  }

  /** the achievement card ("Op der Spëtzt") */
  function showStamp(icon, title, text) {
    stampEl.querySelector(".ic").textContent = icon; stampEl.querySelector("b").textContent = title; stampEl.querySelector("span").textContent = text;
    stampEl.hidden = false; stampEl.classList.remove("go"); void stampEl.offsetWidth; stampEl.classList.add("go");
    clearTimeout(showStamp.timer); showStamp.timer = setTimeout(() => { stampEl.hidden = true; }, 4200);
    sfx.star();
  }

  /* ---------------------------------------------------------------- photo */
  function photo() {
    if (state.photoBusy || !state.active) return;
    state.photoBusy = true;
    hud.classList.add("shoot");
    audio.shutter();
    flashEl.classList.remove("go"); void flashEl.offsetWidth; flashEl.classList.add("go");
    requestAnimationFrame(() => {
      r.renderOnce();
      try {
        canvas.toBlob(blob => {
          state.photoBusy = false; hud.classList.remove("shoot");
          if (!blob) { ui.toast(T_("walk.photoFail")); return; }
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url; link.download = `schueberfouer-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.png`;
          document.body.append(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          state.lastPhoto = { bytes: blob.size, at: Date.now() };
          ui.toast(T_("walk.photoSaved"));
        }, "image/png");
      } catch (error) { state.photoBusy = false; hud.classList.remove("shoot"); console.warn("[fouer] photo failed", error); ui.toast(T_("walk.photoFail")); }
    });
  }

  /* ---------------------------------------------------------------- tram as a moving obstacle */
  const tramBox = { u: 0, w: 0, ax: 1, az: 0, hl: 22.4, hw: 1.5 };
  function tramObstacle() {
    if (!tram) return;
    const st = tram.debug.state();
    if (!st.visible) { mask.setDynamic([]); return; }
    const c = tram.track.at(st.pos);
    const a = world.toGame(c.x, c.z), b = world.toGame(c.x + c.tx, c.z + c.tz);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    mask.setDynamic([{ ...tramBox, u: a[0], w: a[1], ax: (b[0] - a[0]) / l, az: (b[1] - a[1]) / l, hl: (st.length || 44.8) / 2 + 0.3 }]);
  }

  /* ---------------------------------------------------------------- frame update */
  function update(dt) {
    if (!state.active) return;
    state.clock += dt;
    if (!ride.steering) {
      if (input.keys.has("tl")) view.yaw -= WALK.turnKeys * dt;
      if (input.keys.has("tr")) view.yaw += WALK.turnKeys * dt;
    }
    const rideOn = ride.active;
    if (fair.setTiled) fair.setTiled(!(rideOn && ride.untiled));      // the wheel shows the whole field: merged meshes there; the other rides keep the tiles (frustum culling)
    if (!rideOn) {
      const mv = moveVector();
      const locked = state.eating > 0;
      // keys: full speed at once; the joystick scales the speed by how far the thumb is pushed (the last 7 % of the stick is "run")
      const top = mv.run ? WALK.run : WALK.speed;
      const fx = Math.cos(view.yaw), fz = Math.sin(view.yaw), rx = -Math.sin(view.yaw), rz = Math.cos(view.yaw);
      let tx = (fx * mv.f + rx * mv.s) * top, tz = (fz * mv.f + rz * mv.s) * top;
      if (locked) { tx = 0; tz = 0; }
      const a = 1 - Math.exp(-WALK.accel * dt);
      motion.vx += (tx - motion.vx) * a; motion.vz += (tz - motion.vz) * a;
      // also when standing still: the tram (a moving obstacle) or a new stall can push the walker out of its way
      const res = mask.move(view.x, view.z, motion.vx * dt, motion.vz * dt);
      view.x = res.x; view.z = res.z;
      if (res.blocked) { motion.vx *= 0.6; motion.vz *= 0.6; }
      // beyond the NE portal the world ends at the road: a gentle nudge turns a walker who keeps pushing against that border back towards the fair
      if (res.edge && view.x > NE_EDGE_U && Math.hypot(tx, tz) > 0.3) { state.edgeT += dt; if (state.edgeT > 0.3) view.yaw += angleDelta(view.yaw, Math.atan2(56 - view.z, NE_BACK_U - view.x)) * Math.min(1, dt * 1.8); }
      else state.edgeT = Math.max(0, state.edgeT - dt * 2);
      motion.speed = Math.hypot(motion.vx, motion.vz);
      motion.bob += motion.speed * dt * 4.2;
      const gy = world.groundY(view.x, view.z) + WALK.eye;
      view.y += (gy - view.y) * (1 - Math.exp(-dt * 14));
    } else motion.speed = 0;
    state.scan -= dt;
    if (state.scan <= 0) { state.scan = 0.15; tramObstacle(); scanTargets(); refreshButton(); cashEl.textContent = ui.money(game.state.c); refreshFoodie(); }
    if (state.eating > 0) { state.eating -= dt; if (state.eating <= 0) { eatEl.hidden = true; eatEl.classList.remove("go"); } }
    stickEl.hidden = !(input.touchSeen || matchMedia("(pointer: coarse)").matches) || (ride.active && !ride.steering);      // a passive ride has nothing to steer: only the bumper cars keep the stick
    keysEl.hidden = !stickEl.hidden || ride.active;
    applyCamera(dt);
  }

  /* ---------------------------------------------------------------- fades for the rides */
  function fade(to, ms = 450) {
    return new Promise(resolve => {
      fadeEl.style.transition = `opacity ${ms}ms`;
      fadeEl.style.opacity = String(to);
      setTimeout(resolve, ms);
    });
  }

  const api = {
    start, end, update, interact, photo, eat, fade, say, showStamp, rebuildMask, scanTargets,
    get active() { return state.active; },
    get view() { return view; },
    get targets() { return state.targets; },
    get target() { return state.target; },
    get speed() { return motion.speed; },
    get eating() { return state.eating; },
    get lastPhoto() { return state.lastPhoto ?? null; },
    /** debug / tests: put the walker somewhere */
    teleport(x, z, yaw = view.yaw) { view.x = x; view.z = z; view.yaw = yaw; view.y = world.groundY(x, z) + WALK.eye; motion.vx = motion.vz = 0; crowd.repopulate(); applyCamera(0); },
    setLook(yaw, pitch) { view.yaw = yaw; view.pitch = clamp(pitch, -WALK.pitchLimit, WALK.pitchLimit); },
    addLook: look, hud, labels,
    refreshLabels() { labels(); },
    inputState: () => ({ keys: [...input.keys], stick: { ...input.stick } }),
    /** the bumper-car controls: throttle (W / stick up = +1) and steer (D / arrow right / stick right = +1, a right turn) */
    driveControls() {
      const mv = moveVector();
      const turn = (input.keys.has("tr") ? 1 : 0) - (input.keys.has("tl") ? 1 : 0);
      return { throttle: clamp(mv.f, -1, 1), steer: clamp(mv.s + turn, -1, 1) };
    },
    setInputKeys(keys) { input.keys = new Set(keys); },
    setStick(x, y) { input.stick.id = x === 0 && y === 0 ? null : -1; input.stick.x = x; input.stick.y = y; },
    movementProbe() { return { vx: motion.vx, vz: motion.vz }; },
  };
  return api;
}
