/* The edges of the ground paint as lines, and how straight they are (harness gate W, paint15).
 *
 * Every boundary of the paint (tarmac / kerb / pavement / land, one material or tone of tarmac / another) is the zero of a field the shader interpolates per pixel.  The fields
 * are sampled on a fine grid, their zero is traced (marching squares, the zero linearly interpolated along the cell sides: exact for the piecewise-linear fields of the lattice),
 * the pieces that are a VISIBLE boundary (the paint differs on its two sides) are joined into lines, and every line is measured for the lateral WOBBLE that a staircase of the
 * lattice makes: at each point the deviation from the chord over +-WOBBLE_CHORD m, and the wobble is the smaller of the largest deviations to the left and to the right within
 * +-WOBBLE_SPAN m.  A straight or evenly curved edge, and a corner, bend one way only (wobble ~ 0); a sawtooth bends both ways every metre.
 * Pure (no THREE): `traceEdges(sample, box, opts)` with a sampler of the paint returns the lines and their numbers. */

export const EDGE = Object.freeze({
  grid: 0.2,               // m: the sampling grid of the fields (a fifth of the 1 m lattice: its creases are resolved)
  probe: 0.12,             // m: the paint is compared this far either side of a piece of edge (is it a visible boundary?)
  resample: 0.05,          // m: the lines are resampled at this spacing along their length
  chord: 0.5,              // m: the deviation of a point is taken from the chord over +- this
  span: 1.0,               // m: ... and the wobble from the deviations within +- this
  minLine: 1.5,            // m: shorter pieces of line are not measured (a speck of paint)
  jagged: 0.02,            // m: a point of a line wobbles when its wobble exceeds this
});

/**
 * Traces the zero lines of the fields of a paint sampler over a box.
 *   sample(x, z) -> { label, fields: { name: value } }  (label: what the shader paints there, any comparable value; fields: the signed fields whose zeros are the boundaries)
 *   box: { x0, z0, x1, z1 }
 * Returns [{ field, pts: [[x, z], ...] }]: the visible boundary lines (the pieces of a field's zero across which the label changes), each a polyline.
 */
export function traceEdges(sample, box, opts = {}) {
  const g = opts.grid || EDGE.grid;
  const nx = Math.max(2, Math.round((box.x1 - box.x0) / g) + 1), nz = Math.max(2, Math.round((box.z1 - box.z0) / g) + 1);
  const vals = new Map();               // field -> Float32Array of the grid
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const s = sample(box.x0 + i * g, box.z0 + j * g);
      for (const [k, v] of Object.entries(s.fields)) {
        let arr = vals.get(k);
        if (!arr) { arr = new Float32Array(nx * nz).fill(NaN); vals.set(k, arr); }
        arr[j * nx + i] = v;
      }
    }
  }
  const lines = [];
  for (const [field, arr] of vals) {
    const segs = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const o = j * nx + i;
        const c = [arr[o], arr[o + 1], arr[o + nx + 1], arr[o + nx]];           // corners counter-clockwise: (i, j), (i+1, j), (i+1, j+1), (i, j+1)
        if (c.some((v) => !Number.isFinite(v))) continue;
        const cx = [box.x0 + i * g, box.x0 + (i + 1) * g, box.x0 + (i + 1) * g, box.x0 + i * g];
        const cz = [box.z0 + j * g, box.z0 + j * g, box.z0 + (j + 1) * g, box.z0 + (j + 1) * g];
        const cuts = [];
        for (let e = 0; e < 4; e++) {
          const a = c[e], b = c[(e + 1) % 4];
          if ((a < 0) === (b < 0)) continue;
          const t = a / (a - b);
          cuts.push([cx[e] + (cx[(e + 1) % 4] - cx[e]) * t, cz[e] + (cz[(e + 1) % 4] - cz[e]) * t]);
        }
        if (cuts.length === 2) segs.push(cuts[0], cuts[1]);
        else if (cuts.length === 4) { segs.push(cuts[0], cuts[1]); segs.push(cuts[2], cuts[3]); }     // (a saddle: either pairing is a fine line at this grid)
      }
    }
    // the visible pieces: the label differs across the middle of the piece
    const keep = [];
    for (let k = 0; k < segs.length; k += 2) {
      const [ax, az] = segs[k], [bx, bz] = segs[k + 1];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
      if (l < 1e-6) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, nxp = -dz / l * EDGE.probe, nzp = dx / l * EDGE.probe;
      if (sample(mx + nxp, mz + nzp).label === sample(mx - nxp, mz - nzp).label) continue;
      keep.push(segs[k], segs[k + 1]);
    }
    for (const pts of joinSegments(keep)) lines.push({ field, pts });
  }
  return lines;
}

/** Joins segments (a flat list of [x, z] pairs, two per segment) that share end points into polylines. */
function joinSegments(segs) {
  const key = (p) => `${Math.round(p[0] * 1e4)}:${Math.round(p[1] * 1e4)}`;
  const at = new Map();
  for (let k = 0; k < segs.length; k += 2) {
    for (const e of [k, k + 1]) { const kk = key(segs[e]); const l = at.get(kk); if (l) l.push(k); else at.set(kk, [k]); }
  }
  const used = new Uint8Array(segs.length / 2);
  const out = [];
  const extend = (pts, from) => {
    let cur = from;
    for (;;) {
      const next = (at.get(key(cur)) || []).find((k) => !used[k / 2]);
      if (next === undefined) return;
      used[next / 2] = 1;
      const other = key(segs[next]) === key(cur) ? segs[next + 1] : segs[next];
      pts.push(other);
      cur = other;
    }
  };
  for (let k = 0; k < segs.length; k += 2) {
    if (used[k / 2]) continue;
    used[k / 2] = 1;
    const fwd = [segs[k], segs[k + 1]];
    extend(fwd, segs[k + 1]);
    const back = [segs[k]];
    extend(back, segs[k]);
    out.push([...back.slice(1).reverse(), ...fwd]);
  }
  return out;
}

/** The polyline resampled every `step` m along its length. */
function resampleLine(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let k = 1; k < pts.length; k++) {
    const [ax, az] = pts[k - 1], [bx, bz] = pts[k];
    const l = Math.hypot(bx - ax, bz - az);
    let s = step - carry;
    while (s <= l) { out.push([ax + (bx - ax) * s / l, az + (bz - az) * s / l]); s += step; }
    carry = l - (s - step);
  }
  return out;
}

/**
 * The wobble of a line: per resampled point the lateral deviation from its chord (+-EDGE.chord) and the wobble (the smaller of the largest deviations either side within
 * +-EDGE.span).  Returns { length, points: [{ x, z, wobble }] } (the points that have the full chord and span).
 */
export function wobbleOf(pts) {
  const p = resampleLine(pts, EDGE.resample);
  const k = Math.round(EDGE.chord / EDGE.resample), w = Math.round(EDGE.span / EDGE.resample);
  const dev = new Float32Array(p.length).fill(NaN);
  for (let i = k; i < p.length - k; i++) {
    const [ax, az] = p[i - k], [bx, bz] = p[i + k];
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
    if (l < 1e-6) continue;
    dev[i] = (dx * (p[i][1] - az) - dz * (p[i][0] - ax)) / l;
  }
  const points = [];
  for (let i = k + w; i < p.length - k - w; i++) {
    let pos = 0, neg = 0;
    for (let j = i - w; j <= i + w; j++) { const d = dev[j]; if (d > pos) pos = d; if (-d > neg) neg = -d; }
    points.push({ x: p[i][0], z: p[i][1], wobble: Math.min(pos, neg) });
  }
  return { length: (p.length - 1) * EDGE.resample, points };
}

/**
 * The numbers of a set of lines: total measured length, the length that wobbles (> EDGE.jagged), the 99th percentile and the worst wobble (m) and where.
 * Lines shorter than EDGE.minLine are not measured.
 */
export function edgeStats(lines) {
  let length = 0, jaggedLen = 0, worst = 0, worstAt = null;
  const all = [];
  for (const ln of lines) {
    const { length: L, points } = wobbleOf(ln.pts);
    if (L < EDGE.minLine) continue;
    length += L;
    for (const q of points) {
      all.push(q.wobble);
      if (q.wobble > EDGE.jagged) jaggedLen += EDGE.resample;
      if (q.wobble > worst) { worst = q.wobble; worstAt = { x: q.x, z: q.z, field: ln.field }; }
    }
  }
  all.sort((a, b) => a - b);
  return { length, jaggedLen, p99: all.length ? all[Math.floor(all.length * 0.99)] : 0, worst, worstAt };
}
