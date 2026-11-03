/* The play area of Lux Drive: the buffered rings of the two communes (Luxembourg and Niederanven) as a limit the car may
 * not leave. The car is pushed back in when it comes too close to the border, so the player can never drive into the void
 * beyond the baked data.
 *
 * Pure maths on plain numbers (no THREE): the same code runs in the game and in the harness. */

const CELL = 64;                 // m, the cell of the spatial hash of the ring segments

/** The signed area of a ring (positive = counter-clockwise in the x/z plane). */
function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % n];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/**
 * area: { ring: [[x, z], ...], holes: [[[x, z], ...], ...] }
 * Returns { collide(x, z, radius), inside(x, z), rings }.
 */
export function createPlayArea(area) {
  const rings = [];
  const add = (points, hole) => {
    const pts = points.map((p) => [p[0], p[1]]);
    const area2 = ringArea(pts);
    const ccw = area2 >= 0;
    // the segments of the ring, with their bounding boxes
    const segs = [];
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      segs.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], i });
    }
    rings.push({ pts, segs, ccw, hole, cells: new Map() });
  };
  add(area.ring, false);
  for (const hole of area.holes || []) add(hole, true);

  // the spatial hash of the segments
  const cellKey = (cx, cz) => cx * 8192 + cz;
  for (const ring of rings) {
    for (const s of ring.segs) {
      const minX = Math.min(s.ax, s.bx), maxX = Math.max(s.ax, s.bx);
      const minZ = Math.min(s.az, s.bz), maxZ = Math.max(s.az, s.bz);
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
          const key = cellKey(cx, cz);
          const list = ring.cells.get(key);
          if (list) list.push(s); else ring.cells.set(key, [s]);
        }
      }
    }
  }

  /** The nearest segment of a ring to (x, z): { d, qx, qz, nx, nz, side }. nx/nz is the normal towards the allowed side. */
  function nearest(ring, x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = null;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = ring.cells.get(cellKey(cx + dx, cz + dz));
        if (!list) continue;
        for (const s of list) {
          const ex = s.bx - s.ax, ez = s.bz - s.az;
          const ll = ex * ex + ez * ez;
          let t = ll > 1e-9 ? ((x - s.ax) * ex + (z - s.az) * ez) / ll : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = s.ax + ex * t, qz = s.az + ez * t;
          const ddx = x - qx, ddz = z - qz;
          const d = Math.hypot(ddx, ddz);
          if (!best || d < best.d) {
            const len = Math.sqrt(ll) || 1;
            // the left normal of the segment: for a counter-clockwise ring it points into the ring
            const sign = ring.ccw ? 1 : -1;
            best = { d, qx, qz, nx: (-ez / len) * sign, nz: (ex / len) * sign, side: (ex * ddz - ez * ddx) * sign };
          }
        }
      }
    }
    return best;
  }

  /** Is the point inside the area (in the outer ring and outside every hole)? */
  function inside(x, z) {
    const outer = nearest(rings[0], x, z);
    if (!outer || outer.side <= 0) return false;
    for (const ring of rings) {
      if (!ring.hole) continue;
      const h = nearest(ring, x, z);
      if (h && h.side >= 0) return false;             // in a hole
    }
    return true;
  }

  /**
   * The push back: { nx, nz, pen } when the circle of the radius around (x, z) crosses the border, otherwise null.
   * The normal points into the allowed area.
   */
  function collide(x, z, radius) {
    let best = null;
    for (const ring of rings) {
      const n = nearest(ring, x, z);
      if (!n) continue;
      if (n.side >= 0) {
        // on the allowed side: it may still be too close to the border
        const pen = radius - n.d;
        if (pen > 0 && (!best || pen > best.pen)) best = { nx: n.nx, nz: n.nz, pen, border: true };
      } else {
        // on the forbidden side: it has to be pushed back over the border
        const d = Math.max(n.d, 1e-4);
        const pen = radius + d;
        if (!best || pen > best.pen) best = { nx: -((x - n.qx) / d), nz: -((z - n.qz) / d), pen, border: true };
      }
    }
    return best;
  }

  return { collide, inside, rings, cell: CELL };
}
