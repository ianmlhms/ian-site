/* Schueberfouer Tycoon, access wave: the debug overlay of the walkway network (?fouerDebug=1, window.__fouerGame.accessOverlay(true)).
 * Alleys blue, entrance lanes red, the service lane orange, forecourts green, the point where a visitor stands to use a pitch white, the entrances as tall red posts.
 * Draped on the terrain, three meshes, never built outside debug sessions. */
import { ALLEYS, ENTRANCES, zones, pitchEntrance } from '../layout.js';

export function createAccessOverlay({ T, root, groundY, pitches }) {
  const group = new T.Group(); group.name = 'fouer-access-overlay'; group.visible = false; root.add(group);
  const LIFT = 0.42; const STEP = 3;
  const mk = (color, opacity) => new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: T.DoubleSide });
  const buckets = { alley: [], lane: [], service: [], forecourt: [] };
  const quadGrid = (out, r) => {
    const nu = Math.max(1, Math.ceil((r.u1 - r.u0) / STEP)), nw = Math.max(1, Math.ceil((r.w1 - r.w0) / STEP));
    for (let j = 0; j < nw; j++) for (let i = 0; i < nu; i++) {
      const a = r.u0 + (r.u1 - r.u0) * i / nu, b = r.u0 + (r.u1 - r.u0) * (i + 1) / nu, c = r.w0 + (r.w1 - r.w0) * j / nw, d = r.w0 + (r.w1 - r.w0) * (j + 1) / nw;
      const p = (u, w) => [u, groundY(u, w) + LIFT, w];
      out.push(...p(a, c), ...p(b, c), ...p(b, d), ...p(a, c), ...p(b, d), ...p(a, d));
    }
  };
  for (const z of zones(pitches)) {
    if (z.kind === 'forecourt') quadGrid(buckets.forecourt, z.rect);
    else if (z.kind === 'service') {
      const [p0, p1, p2, p3] = z.poly; const n = 12;
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n; const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const a = lerp(p0, p1, t0), b = lerp(p0, p1, t1), c = lerp(p3, p2, t1), d = lerp(p3, p2, t0); const P = (q) => [q[0], groundY(q[0], q[1]) + LIFT, q[1]];
        buckets.service.push(...P(a), ...P(b), ...P(c), ...P(a), ...P(c), ...P(d));
      }
    } else quadGrid(z.rect && ALLEYS.find((a) => a.id === z.id)?.kind === 'lane' ? buckets.lane : buckets.alley, z.rect);
  }
  const addMesh = (pos, material, name) => {
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
    const m = new T.Mesh(g, material); m.name = name; m.renderOrder = 50; m.frustumCulled = false; group.add(m);
  };
  addMesh(buckets.alley, mk(0x2f8cff, 0.5), 'alleys'); addMesh(buckets.lane, mk(0xff4a3a, 0.5), 'lanes'); addMesh(buckets.service, mk(0xff9a1a, 0.55), 'service'); addMesh(buckets.forecourt, mk(0x2fd06a, 0.5), 'forecourts');
  // pitch entrance points (white pins) and entrances (red posts)
  const pins = [];
  for (const p of pitches) { const e = pitchEntrance(p); const y = groundY(e.x, e.z); pins.push(e.x - 0.5, y, e.z, e.x + 0.5, y, e.z, e.x, y + 4, e.z); }
  for (const e of ENTRANCES) { const y = groundY(e.u, e.w); pins.push(e.u - 0.8, y, e.w, e.u + 0.8, y, e.w, e.u, y + 14, e.w); }
  addMesh(pins, mk(0xffffff, 0.95), 'pins');
  return { group, show(on) { group.visible = on !== false; }, get visible() { return group.visible; }, dispose() { root.remove(group); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); } };
}
