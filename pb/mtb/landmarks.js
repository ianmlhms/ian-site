/* The real landmarks that shape the world beyond the OSM geometry. Pure data and small pure functions, shared by the game and the harness.
 *   Schiessentümpel (OSM node, wikidata Q2529613): the Black Ernz drops over a staircase of three small falls into a pool; an arched stone footbridge with a wooden
 *   railing crosses the river just upstream. The other mapped waterfalls become two-step cascades. */
export const SCHIESSENTUEMPEL = Object.freeze({
  x: 1545.7, z: 5784.6,
  cascade: { length: 19, steps: 3, pool: 0.0 },
  bridge: { upstream: 8, span: 5.4, width: 2.2, rise: 2.0, archRadius: 1.75, abutment: 3.6 },      // metres: distance upstream of the falls, clear span, deck width, hump above the banks
});
const OTHER_FALL = Object.freeze({ length: 11, steps: 2, pool: 0.0 });

/** Marks the stream way that passes each waterfall with a cascade (the bed is built as a staircase there, see trails.js channelBed). Returns new way objects. */
export function attachCascades(streams, falls) {
  const spots = [{ x: SCHIESSENTUEMPEL.x, z: SCHIESSENTUEMPEL.z, ...SCHIESSENTUEMPEL.cascade }];
  for (const f of falls) if (Math.hypot(f.x - SCHIESSENTUEMPEL.x, f.z - SCHIESSENTUEMPEL.z) > 160) spots.push({ x: f.x, z: f.z, ...OTHER_FALL });
  return streams.map((way) => {
    let best = null, bd = 25 * 25;
    for (const spot of spots) for (const [px, pz] of way.pts) { const d = (px - spot.x) ** 2 + (pz - spot.z) ** 2; if (d < bd) { bd = d; best = spot; } }
    return best ? { ...way, cascade: best } : way;
  });
}

/** Where the footbridge stands: on the river just upstream of the falls, across the flow. Pure (needs the carved network and the surface).
 *  Returns { x, z, yaw, water, deck, endL, endR, span, width, rise, ring } (all metres; heights absolute) or null when the river is not found. */
export function placeBridge(network, surface) {
  const S = network.samples;
  const B = SCHIESSENTUEMPEL.bridge;
  let way = null, best = 1e18, at = -1;
  for (const info of network.ways) {
    if (info.kind !== 'river') continue;
    for (let i = info.first; i < info.first + info.count; i++) {
      const d = (S.px[i] - SCHIESSENTUEMPEL.x) ** 2 + (S.pz[i] - SCHIESSENTUEMPEL.z) ** 2;
      if (d < best) { best = d; way = info; at = i; }
    }
  }
  if (!way || best > 40 * 40) return null;
  // upstream = lower index (the way direction is the flow direction); walk B.upstream metres back along the samples
  let i = at;
  while (i > way.first && S.s[at] - S.s[i] < B.upstream) i--;
  const x = S.px[i], z = S.pz[i];
  const tx = -S.nz[i], tz = S.nx[i];                      // flow direction (the tangent, see water.js)
  const cx = S.nx[i], cz = S.nz[i];                       // across the river
  const half = B.span / 2 + B.abutment * 0.55;
  const bankL = surface.height(x - cx * half, z - cz * half), bankR = surface.height(x + cx * half, z + cz * half);
  const water = S.water[i];
  const deck = Math.max(water + B.rise + 0.95, Math.max(bankL, bankR) + 0.35);
  return { x, z, yaw: Math.atan2(-cz, cx), water, deck, endL: bankL + 0.12, endR: bankR + 0.12, span: B.span, width: B.width, abutment: B.abutment, rise: B.rise, flow: [tx, tz], across: [cx, cz] };
}
