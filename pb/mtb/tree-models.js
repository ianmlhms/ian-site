/* Painted tree models, built from code (vertex colours carry the bark, leaf-card clusters carry the foliage). Unit size: a tree is 1 m tall at scale 1,
 * the instance scale carries the real height.
 *   buildBroadleaf(species, variant, detail)  beech (light grey bark, tall clear trunk, forking limbs) or oak (dark rugged bark, wide crown)
 *        detail 0 = full: trunk + limbs + twigs + about 22 leaf clusters of 7 alpha-tested cards each (volumetric crown, light comes through)
 *        detail 1 = mid:  trunk + 3 limbs + 9 clusters of 3 cards
 *   buildSapling(variant)         a young tree with a thin trunk and a few clusters
 *   buildBlobTree(species, detail) the far model: a few lumpy blobs on a trunk (the ground shader paints the canopy beyond it)
 *   buildSpruce(detail)           stacked cones (needle forest only)
 *   buildShrub(kind)              holly / bramble bush: clusters of cards close to the ground
 *   buildFern()                   a fern: 7 arching fronds
 *   buildLog(), buildStump(), buildRoot()   dead wood and roots
 * Every model sits on y = 0 with its trunk base slightly below (the instance is placed 0.15 m into the ground). */
import { Builder, M, V3, tube, bezier, card, randomUnit } from './geo-builder.js';
import { createRng, valueNoise } from './noise.js';
import { TILE_ID, tileRect } from './leaf-textures.js';

const THREE = window.THREE;
const BEECH_BARK = [0.56, 0.58, 0.52];
const OAK_BARK = [0.44, 0.38, 0.31];
const BARK_BEECH = -3, BARK_DARK = -2;      // aLeaf: >= 0 a leaf atlas tile, -1 plain vertex colours, -2 painted dark furrowed bark (oak, dead wood), -3 painted smooth grey beech bark
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const SPECIES_STYLE = Object.freeze({
  beech: { bark: BEECH_BARK, fork: 0.5, crownR: 0.235, trunkR: 0.0148, limbs: 5, tile: TILE_ID.beech, tint: [1.0, 1.0, 0.94], clusterSize: 0.1, lean: 0.03 },
  oak: { bark: OAK_BARK, fork: 0.34, crownR: 0.34, trunkR: 0.0175, limbs: 6, tile: TILE_ID.oak, tint: [0.96, 0.98, 0.86], clusterSize: 0.105, lean: 0.03 },
});

function barkColor(species, rng) {
  const base = SPECIES_STYLE[species].bark;
  return (v, n, i, h) => {
    const streak = valueNoise(v.x * 90 + v.z * 70, v.y * 7, 3);
    const ring = species === 'beech' ? 0.92 + 0.08 * Math.sin(v.y * 140 + streak * 3) : 0.78 + 0.34 * streak;
    const moss = Math.max(0, valueNoise(v.x * 40 - v.z * 30, v.y * 18, 9) - 0.5) * Math.max(0, 1 - v.y * 7) * 2.2;    // moss on the foot of the trunk
    const ao = 0.72 + 0.28 * clamp01(v.y * 9);                                                                          // dark at the ground
    const k = ring * ao * (0.92 + 0.12 * streak);
    return [base[0] * k * (1 - moss * 0.45) , base[1] * k * (1 + moss * 0.1), base[2] * k * (1 - moss * 0.5)];
  };
}

/** Adds one leaf cluster: `cards` cards in a ball of radius `size` around `c`. `crown` = { cx, cy, cz, rad } shades by depth in the crown. */
function addCluster(b, rng, c, size, cards, crown, style, shadeBoost = 1) {
  const rect = tileRect(style.tile);
  const out = V3(c.x - crown.cx, c.y - crown.cy, c.z - crown.cz);
  const depth = clamp01(out.length() / crown.rad);
  const outN = out.clone().normalize();
  const ao = (0.5 + 0.5 * depth) * (0.8 + 0.3 * clamp01((c.y - crown.cy) / crown.rad + 0.5)) * shadeBoost;
  const hash = rng();
  const tint = [style.tint[0] * (0.92 + rng() * 0.16) * ao, style.tint[1] * (0.94 + rng() * 0.14) * ao, style.tint[2] * (0.9 + rng() * 0.18) * ao];
  for (let k = 0; k < cards; k++) {
    const dir = randomUnit(rng);
    const centre = V3(c.x + dir.x * size * 0.55, c.y + dir.y * size * 0.45, c.z + dir.z * size * 0.55);
    // the card's up axis leans outward-and-up (sprigs reach out), its right axis is random in the horizontal plane
    const up = V3(dir.x * 0.5 + outN.x * 0.4, 0.55 + dir.y * 0.35 + outN.y * 0.3, dir.z * 0.5 + outN.z * 0.4).normalize();
    const right = V3(-up.z * 0.4 + (rng() - 0.5), (rng() - 0.5) * 0.4, up.x * 0.4 + (rng() - 0.5)).cross(up).normalize();
    const half = size * (0.8 + rng() * 0.3);
    const ln = V3(dir.x * 0.5 + outN.x, dir.y * 0.5 + outN.y + 0.2, dir.z * 0.5 + outN.z).normalize();
    const q = card(centre, right, up, half, half, ln, rect);
    // the sprig grows from the bottom edge of its tile: shift the card up so the pivot sits at its centre of mass
    b.addArrays(q.pos, q.nor, q.idx, () => tint, q.uvs, style.tile + hash * 0.49);
  }
}

function limbPoint(fork, azimuth, reach, rise) {
  return V3(fork.x + Math.cos(azimuth) * reach, fork.y + rise, fork.z + Math.sin(azimuth) * reach);
}

export function buildBroadleaf(species, variant, detail) {
  const style = SPECIES_STYLE[species];
  const rng = createRng((species === 'oak' ? 7000 : 3000) + variant * 131 + detail * 17);
  const b = new Builder();
  const bark = barkColor(species, rng);
  const fork = V3(style.lean * (rng() - 0.5) * 2, style.fork * (0.92 + rng() * 0.16), style.lean * (rng() - 0.5) * 2);
  // --- trunk: a gentle curve, a flared foot, tapering to the fork
  const rings = detail === 0 ? 9 : 5;
  const pts = [], radii = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const yy = -0.012 + (fork.y + 0.012) * t;
    pts.push(V3(fork.x * t * t, yy, fork.z * t * t));
    radii.push(style.trunkR * (1 + 1.0 * Math.exp(-(yy + 0.012) / 0.035)) * (1 - 0.26 * t));
  }
  const tr = tube(pts, radii, detail === 0 ? 9 : 6, true);
  const BARK = species === 'oak' ? BARK_DARK : BARK_BEECH;
  b.addArrays(tr.pos, tr.nor, tr.idx, (v, n, i) => bark(v, n, i), null, BARK);
  // --- primary limbs and twigs
  const crownH = 1 - fork.y;
  const crown = { cx: fork.x, cy: fork.y + crownH * 0.52, cz: fork.z, rad: style.crownR };
  const limbCount = detail === 0 ? style.limbs : 3;
  const ends = [], mids = [];
  const baseAz = rng() * 6.28;
  for (let j = 0; j < limbCount; j++) {
    const az = baseAz + j * (6.28 / limbCount) + (rng() - 0.5) * 0.6;
    const reach = style.crownR * (0.55 + rng() * 0.5), rise = crownH * (0.38 + rng() * 0.5);
    const start = V3(fork.x, fork.y - 0.01, fork.z);
    const end = limbPoint(fork, az, reach, rise);
    const c1 = V3(start.x + Math.cos(az) * reach * 0.12, start.y + rise * 0.45, start.z + Math.sin(az) * reach * 0.12);
    const c2 = V3(end.x - Math.cos(az) * reach * 0.35, end.y - rise * 0.25, end.z - Math.sin(az) * reach * 0.35);
    const steps = detail === 0 ? 5 : 3;
    const path = bezier(start, c1, c2, end, steps);
    const r0 = radii[radii.length - 1] * (0.62 + rng() * 0.2);
    const lr = path.map((_, i) => Math.max(0.0016, r0 * (1 - i / steps) * (1 - 0.15 * i / steps)));
    const lt = tube(path, lr, detail === 0 ? 5 : 4, true);
    b.addArrays(lt.pos, lt.nor, lt.idx, (v, n, i) => { const c = bark(v, n, i); return [c[0] * 0.95, c[1] * 0.95, c[2] * 0.95]; }, null, BARK);
    ends.push(end); mids.push(path[Math.floor(steps * 0.62)]);
    if (detail === 0) {
      for (const t of [0.5, 0.78]) {                                          // twigs
        const p = path[Math.round(steps * t)];
        const az2 = az + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.6), len = 0.07 + rng() * 0.06;
        const e2 = V3(p.x + Math.cos(az2) * len, p.y + len * (0.3 + rng() * 0.5), p.z + Math.sin(az2) * len);
        const tw = tube(bezier(p, V3(p.x + Math.cos(az2) * len * 0.3, p.y + len * 0.2, p.z + Math.sin(az2) * len * 0.3), V3(e2.x - Math.cos(az2) * len * 0.3, e2.y - len * 0.1, e2.z - Math.sin(az2) * len * 0.3), e2, 3), [0.0034, 0.003, 0.0022, 0.0014], 3, true);
        b.addArrays(tw.pos, tw.nor, tw.idx, (v, n, i) => { const c = bark(v, n, i); return [c[0] * 0.9, c[1] * 0.9, c[2] * 0.9]; }, null, BARK);
        ends.push(e2);
      }
    }
  }
  // --- leaf clusters: at the limb ends, along the limbs, and scattered through the crown volume
  const size = style.clusterSize;
  const cards = detail === 0 ? 6 : 3;
  const cardSize = detail === 0 ? size : size * 1.45;
  for (const e of ends) addCluster(b, rng, e, cardSize, cards, crown, style);
  if (detail === 0) for (const m of mids) addCluster(b, rng, m, cardSize * 0.9, cards, crown, style);
  const fill = detail === 0 ? 9 : 3;
  for (let i = 0; i < fill; i++) {
    const a = rng() * 6.28, rr = Math.sqrt(rng()) * style.crownR * 0.9, yy = crown.cy + (rng() - 0.35) * crownH * 0.6;
    addCluster(b, rng, V3(crown.cx + Math.cos(a) * rr, yy, crown.cz + Math.sin(a) * rr), cardSize, cards, crown, style, 0.95);
  }
  return b.build();
}

export function buildSapling(variant) {
  const rng = createRng(5100 + variant * 71);
  const style = { ...SPECIES_STYLE.beech, tint: [1.02, 1.04, 0.9] };
  const b = new Builder();
  const top = V3((rng() - 0.5) * 0.06, 1, (rng() - 0.5) * 0.06);
  const pts = [V3(0, -0.02, 0), V3(top.x * 0.3, 0.3, top.z * 0.3), V3(top.x * 0.7, 0.65, top.z * 0.7), top];
  const tr = tube(pts, [0.016, 0.012, 0.008, 0.004], 5, true);
  const bark = barkColor('beech', rng);
  b.addArrays(tr.pos, tr.nor, tr.idx, (v, n, i) => { const c = bark(v, n, i); return [c[0] * 0.92, c[1] * 1.0, c[2] * 0.85]; }, null, BARK_BEECH);
  const crown = { cx: 0, cy: 0.62, cz: 0, rad: 0.4 };
  for (let i = 0; i < 7; i++) {
    const a = rng() * 6.28, rr = 0.1 + rng() * 0.22, y = 0.34 + rng() * 0.64;
    addCluster(b, rng, V3(Math.cos(a) * rr * (y > 0.8 ? 0.4 : 1), y, Math.sin(a) * rr * (y > 0.8 ? 0.4 : 1)), 0.2, 4, crown, style, 1.05);
  }
  return b.build();
}

export function buildShrub(kind) {
  const rng = createRng(kind === 'holly' ? 6100 : 6200);
  const b = new Builder();
  const style = { tile: kind === 'holly' ? TILE_ID.shrub : TILE_ID.bramble, tint: kind === 'holly' ? [0.9, 0.95, 0.9] : [1, 1, 0.95] };
  const crown = { cx: 0, cy: 0.45, cz: 0, rad: 0.55 };
  const n = kind === 'holly' ? 9 : 7;
  for (let i = 0; i < n; i++) {
    const a = rng() * 6.28, rr = Math.sqrt(rng()) * (kind === 'holly' ? 0.38 : 0.5), y = (kind === 'holly' ? 0.28 : 0.2) + rng() * (kind === 'holly' ? 0.62 : 0.5);
    addCluster(b, rng, V3(Math.cos(a) * rr, y, Math.sin(a) * rr), kind === 'holly' ? 0.22 : 0.27, 4, crown, style, 0.95);
  }
  return b.build();
}

export function buildFern() {
  const rng = createRng(6300);
  const b = new Builder();
  const rect = tileRect(TILE_ID.fern);
  const fronds = 7;
  for (let k = 0; k < fronds; k++) {
    const az = (k / fronds) * 6.28 + rng() * 0.4, pitch = 0.5 + rng() * 0.5, len = 0.8 + rng() * 0.35;
    // an arching frond: two quads, the second one bent down
    const dir = V3(Math.cos(az), 0, Math.sin(az));
    const side = V3(-dir.z, 0, dir.x);
    const p0 = V3(0, 0.02, 0);
    const p1 = V3(dir.x * len * 0.55, 0.02 + Math.sin(pitch) * len * 0.5, dir.z * len * 0.55);
    const p2 = V3(dir.x * len, 0.02 + Math.sin(pitch) * len * 0.4 - len * 0.18, dir.z * len);
    const w = len * 0.2;
    const tint = [0.86 + rng() * 0.2, 0.9 + rng() * 0.16, 0.82 + rng() * 0.2];
    const hash = rng();
    const verts = [], uvs = [];
    const [u0, v0, u1, v1] = rect;
    const rows = [p0, p1, p2], vv = [v0, v0 + (v1 - v0) * 0.5, v1];
    for (let r = 0; r < 3; r++) {
      const wr = w * (r === 0 ? 0.35 : r === 1 ? 1 : 0.55);
      verts.push(rows[r].x - side.x * wr, rows[r].y, rows[r].z - side.z * wr, rows[r].x + side.x * wr, rows[r].y, rows[r].z + side.z * wr);
      uvs.push(u0, vv[r], u1, vv[r]);
    }
    const nrm = V3(0, 1, 0).add(dir.clone().multiplyScalar(-0.2)).normalize();
    const nor = []; for (let i = 0; i < 6; i++) nor.push(nrm.x, nrm.y, nrm.z);
    b.addArrays(verts, nor, [0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5], (v) => [tint[0] * (0.6 + 0.55 * Math.min(1, v.y / 0.5 + 0.2)), tint[1] * (0.6 + 0.55 * Math.min(1, v.y / 0.5 + 0.2)), tint[2] * 0.7], uvs, TILE_ID.fern + hash * 0.49);
  }
  return b.build();
}

/** Grass tuft: three crossed cards (the near-camera meadow blades). */
export function buildTuft(tile = TILE_ID.grass) {
  const rng = createRng(6400 + tile);
  const b = new Builder();
  const rect = tileRect(tile);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI + rng() * 0.3, dir = V3(Math.cos(a), 0, Math.sin(a));
    const q = card(V3(0, 0.5, 0), dir, V3(0, 1, 0), 0.5, 0.5, V3(0, 1, 0), rect);
    const tint = [1.05 + rng() * 0.2, 1.1 + rng() * 0.16, 0.9 + rng() * 0.2];
    b.addArrays(q.pos, q.nor, q.idx, (v) => [tint[0] * (0.8 + 0.5 * v.y), tint[1] * (0.8 + 0.5 * v.y), tint[2] * (0.75 + 0.3 * v.y)], q.uvs, tile + rng() * 0.49);
  }
  return b.build();
}

/** Hedge segment: a long dense bush 1 m long (x), scaled by the instance. */
export function buildHedge() {
  const rng = createRng(6500);
  const b = new Builder();
  const crown = { cx: 0, cy: 0.5, cz: 0, rad: 0.7 };
  const style = { tile: TILE_ID.shrub, tint: [1.0, 1.05, 0.88] };
  for (let i = 0; i < 6; i++) addCluster(b, rng, V3((i / 5 - 0.5) * 1.1, 0.3 + rng() * 0.4, (rng() - 0.5) * 0.3), 0.3, 5, crown, style, 1.25);
  return b.build();
}

export function buildLog() {
  const rng = createRng(6600);
  const b = new Builder();
  const pts = [], radii = [];
  for (let i = 0; i <= 6; i++) { pts.push(V3(i / 6 - 0.5, 0.05 * Math.sin(i * 0.9), 0)); radii.push(0.075 + 0.012 * Math.sin(i * 2.1) - 0.01 * i / 6); }
  const t = tube(pts, radii, 8, true);
  const bark = barkColor('oak', rng);
  b.addArrays(t.pos, t.nor, t.idx, (v, n, i) => { const c = bark(new THREE.Vector3(v.z * 3, v.x * 4 + 2, v.y * 3), n, i); const moss = Math.max(0, n.y) * (0.5 + 0.5 * valueNoise(v.x * 9, 3, 4)); return [c[0] * 0.8 * (1 - moss * 0.3), c[1] * 0.85 * (1 + moss * 0.25), c[2] * 0.75 * (1 - moss * 0.35)]; }, null, BARK_DARK);
  return b.build();
}

export function buildStump() {
  const rng = createRng(6700);
  const b = new Builder();
  const pts = [V3(0, -0.1, 0), V3(0, 0.3, 0), V3(0.01, 0.7, 0), V3(0.03, 1.0, 0)], radii = [1.25, 1.0, 0.92, 0.88];
  const t = tube(pts, radii, 9, true);
  const bark = barkColor('oak', rng);
  b.addArrays(t.pos, t.nor, t.idx, (v, n, i) => { const c = bark(new THREE.Vector3(v.x * 2, v.y * 1.4 + 0.02, v.z * 2), n, i); const top = clamp01((v.y - 0.88) * 12); return [c[0] * (1 - top * 0.1) * (1 + top * 0.5), c[1] * (1 + top * 0.4), c[2] * (1 + top * 0.1)]; }, null, BARK_DARK);
  return b.build();
}

/** A root arching out of a trunk foot: length 1 along +x (the trunk end at x = 0), arch height 0.06 m per unit scale of the instance. */
export function buildRoot() {
  const b = new Builder();
  const pts = [], radii = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(V3(t, Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.5 - 0.02, 0)); radii.push(0.5 * (1 - 0.8 * t) + 0.05); }
  const t = tube(pts, radii, 6, true);
  b.addArrays(t.pos, t.nor, t.idx, (v) => [0.4 * (0.85 + 0.2 * valueNoise(v.x * 14, 2, 2)), 0.36 * (0.9 + 0.12 * valueNoise(v.x * 10, 5, 6)), 0.28], null, BARK_DARK);
  return b.build();
}

// ---- far models (no cards): lumpy blobs on a trunk
function tint3(base, rng, amount) { return [base[0] * (1 + (rng() - 0.5) * amount), base[1] * (1 + (rng() - 0.5) * amount), base[2] * (1 + (rng() - 0.5) * amount)]; }
function blob(radius, detail, lump, flatten) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + lump * (valueNoise(x * 3.1 + 5, z * 3.1 + y * 2.3, 3) - 0.5);
    p.setXYZ(i, x * k, y * k * flatten, z * k);
  }
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { const nx = p.getX(i), ny = p.getY(i) / flatten, nz = p.getZ(i); const l = Math.hypot(nx, ny, nz) || 1; n.setXYZ(i, nx / l, ny / l, nz / l); }
  return g;
}

export function buildBlobTree(species, detail) {
  const rng = createRng(101 + detail + (species === 'oak' ? 50 : 0));
  const b = new Builder();
  const style = SPECIES_STYLE[species];
  const fork = style.fork;
  const trunkG = new THREE.CylinderGeometry(style.trunkR * 0.7, style.trunkR * 1.05, fork + 0.2, 4, 1, true).translate(0, (fork + 0.2) / 2 - 0.02, 0);
  const bark = barkColor(species, rng);
  b.add(trunkG.toNonIndexed(), M(0, 0, 0), (v, n, i) => bark(v, n, i));
  const cy = fork + (1 - fork) * 0.5, r = style.crownR * 1.35, h = (1 - fork) * 0.5;
  const crowns = detail === 0 ? [[0, cy, 0, r * 1.05], [r * 0.55, cy - h * 0.25, 0.1 * r, r * 0.7]] : [[0, cy, 0, r], [r * 0.5, cy - h * 0.25, 0.1 * r, r * 0.72], [-r * 0.45, cy - h * 0.1, -0.2 * r, r * 0.74]];
  const green = tint3(species === 'oak' ? [0.3, 0.44, 0.16] : [0.32, 0.5, 0.18], rng, 0.4);
  for (const [x, y, z, rad] of crowns) {
    const geo = blob(rad, 0, 0.45, 0.78);
    b.add(geo, M(x, y, z, 1, 1, 1, rng() * 6), (v, n) => {
      const top = clamp01((v.y - (y - rad)) / (2 * rad));
      const shade = 0.5 + 0.55 * top + 0.12 * n.y;
      const gold = Math.max(0, valueNoise(v.x * 9, v.z * 9 + v.y * 4, 5) - 0.62) * 1.3;
      return [(green[0] + gold * 0.5) * shade, (green[1] + gold * 0.2) * shade, green[2] * shade * (1 - gold * 0.3)];
    }, -1);
  }
  return b.build();
}

/** Spruce: drooping tiers of twig cards around a straight trunk (detail 0 = far: stacked cones; 1 = mid: 5 tiers of 6 cards; 2 = near: 9 tiers of 8 cards). Only used where OSM says needle forest. */
export function buildSpruce(detail) {
  const rng = createRng(202 + detail);
  const b = new Builder();
  const bark = [0.36, 0.27, 0.21];
  const trunkG = new THREE.CylinderGeometry(0.0065, 0.011, detail === 0 ? 0.35 : 0.9, 5, 1, true).translate(0, detail === 0 ? 0.17 : 0.45, 0);
  b.add(trunkG, M(0, 0, 0), (v) => mul3(bark, 0.8 + 0.4 * valueNoise(v.y * 20, v.x * 90, 2)));
  if (detail === 0) {
    for (let i = 0; i < 3; i++) {
      const f = i / 2, radius = 0.17 - 0.1 * f, height = 0.5 - 0.12 * f, y = 0.14 + f * 0.5;
      const g = new THREE.ConeGeometry(radius, height, 6, 1, true);
      const green = tint3([0.16, 0.34, 0.22], rng, 0.3);
      b.add(g, M(0, y + height / 2 - 0.06, 0, 1, 1, 1, rng() * 6), (v, n) => { const low = clamp01((v.y - y) / height); const shade = 0.55 + 0.55 * low + 0.12 * n.y; return [green[0] * shade, green[1] * shade, green[2] * shade]; }, -1);
    }
    return b.build();
  }
  const rect = tileRect(TILE_ID.spruce);
  const tiers = detail === 1 ? 6 : 10, per = detail === 1 ? 6 : 8;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1), y = 0.22 + f * 0.74;
    const reach = (0.105 * Math.pow(1 - f, 0.9) + 0.015) * (detail === 1 ? 1.1 : 1.0);
    const a0 = rng() * 6.28;
    for (let k = 0; k < per; k++) {
      const az = a0 + (k / per) * 6.28 + (rng() - 0.5) * 0.3;
      const droop = 0.5 + rng() * 0.25 - 0.25 * f;                                   // branches hang, the top ones point up
      const dir = V3(Math.cos(az) * Math.cos(droop), -Math.sin(droop) + 0.15, Math.sin(az) * Math.cos(droop)).normalize();
      const len = reach * (0.85 + rng() * 0.3);
      const centre = V3(dir.x * len * 0.5, y + dir.y * len * 0.5, dir.z * len * 0.5);
      const right = V3(-dir.z, 0, dir.x).normalize();
      const ln = V3(dir.x * 0.4, 0.8, dir.z * 0.4).normalize();
      const q = card(centre, right, dir, len * 0.5, len * 0.5, ln, rect);
      const ao = 0.62 + 0.45 * f + 0.15 * rng();
      b.addArrays(q.pos, q.nor, q.idx, () => [0.82 * ao, 0.95 * ao, 0.85 * ao], q.uvs, TILE_ID.spruce + rng() * 0.49);
    }
  }
  return b.build();
}
const mul3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
