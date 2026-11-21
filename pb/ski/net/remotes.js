/* The other skiers on screen: a snapshot buffer per player, shown INTERP_DELAY ms in the past (interpolated between two states, carried
 * on with the velocity for EXTRAP_MAX ms when packets are late, then frozen), posed by the normal figure (skier-model.js), and a name tag.
 * Cheap on purpose: each skier is ONE skinned mesh (every body part bound rigidly to its bone, so one draw call instead of ~16), no blob
 * shadow, culled by distance and view; the name tags are plain DOM (no draw call at all). Ghost-style: nobody collides with anybody. */
import { NET } from './config.js';
import { createSkierModel, OUTFITS } from '../skier-model.js';
import { packState, unpackState } from './wire.js';
import { riderAt, KIND_OF_CODE } from '../modes/liftride.js';
import { createCarrier } from '../modes/carriers.js';
import { declutterTags, tagWidth, TAGS } from './tags.js';

const THREE = window.THREE;
const VIEW_DIST = 900;           // m: farther skiers are not drawn
const TAG_DIST = TAGS.TAG_DIST;
const MAX_BUF = 40;
const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/* ---------- the wire format of one skier state: net/wire.js (round 6: + "riding lift X at s") ---------- */
export { packState, unpackState };

/* ---------- one skinned mesh per skier ---------- */
let sharedMat = null;
const identity = new THREE.Matrix4();
/** The figure of skier-model.js with its per-bone meshes folded into one SkinnedMesh: the bones are the figure's own groups (pose()
 *  keeps moving them), every vertex follows exactly one bone (weight 1). */
function createRemoteFigure(outfit) {
  const model = createSkierModel({ outfit });
  model.setBlob(false);
  const bones = [], parts = [];
  model.root.traverse((o) => { if (o.isMesh && o.geometry.userData.slots) parts.push(o); });
  for (const m of parts) { bones.push(m.parent); }
  const pos = [], nrm = [], col = [], si = [], sw = [], idx = [];
  let base = 0;
  parts.forEach((m, bi) => {
    const g = m.geometry, P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(C.getX(i), C.getY(i), C.getZ(i));
      si.push(bi, 0, 0, 0); sw.push(1, 0, 0, 0);
    }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    base += P.count;
    m.parent.remove(m); g.dispose();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(idx);
  if (!sharedMat) sharedMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.SkinnedMesh(geo, sharedMat);
  mesh.bind(new THREE.Skeleton(bones, bones.map(() => identity.clone())), identity);
  mesh.frustumCulled = false;            // culled by hand (the bind-pose bounds sit at the world origin)
  mesh.castShadow = true;
  model.root.add(mesh);
  return { model, mesh };
}

/* liftPath(index) = the line of a resort lift (lifts.js pathOf) once the lifts are built: a friend riding one sits in his own carrier */
export function createRemotes({ scene, camera, surface, overlay, liftPath = () => null }) {
  const list = new Map();
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), 2.5), v3 = new THREE.Vector3();
  const tagBox = document.createElement('div');
  tagBox.className = 'mp-tags';
  overlay.appendChild(tagBox);
  let castShadow = false;

  function add(id, name, outfit) {
    if (list.has(id)) return list.get(id);
    const o = OUTFITS.find((x) => x.id === outfit) || OUTFITS[(list.size + 1) % OUTFITS.length];
    const { model, mesh } = createRemoteFigure(o.id);
    mesh.castShadow = castShadow;
    model.setVisible(false);
    scene.add(model.root);
    const tag = document.createElement('div');
    tag.className = 'mp-tag';
    const dot = document.createElement('i'); dot.style.background = `#${o.jacket.toString(16).padStart(6, '0')}`;
    const label = document.createElement('span'); label.textContent = String(name || '?').slice(0, 16);
    tag.append(dot, label);
    tag.hidden = true;
    tagBox.appendChild(tag);
    const r = { id, name, outfit: o.id, model, mesh, tag, tagW: tagWidth(label.textContent), buf: [], state: null, shown: false, delay: NET.INTERP_DELAY, extrap: NET.EXTRAP_MAX, away: false, run: -1 };
    list.set(id, r);
    return r;
  }
  function remove(id) {
    const r = list.get(id);
    if (!r) return;
    scene.remove(r.model.root); r.mesh.geometry.dispose(); r.tag.remove();
    if (r.carrier) r.carrier.dispose();
    list.delete(id);
  }
  /** a state of player id for run `run`, stamped with its local arrival-corrected time t (ms) */
  function push(id, run, t, a) {
    const r = list.get(id);
    const st = r && unpackState(a);
    if (!st || !Number.isFinite(t)) return;
    if (run !== r.run) { r.buf = []; r.run = run; }
    if (r.buf.length && t <= r.buf[r.buf.length - 1].t) return;            // late or doubled: the unreliable channel reorders
    r.buf.push({ t, s: st });
    if (r.buf.length > MAX_BUF) r.buf.shift();
  }
  function setLink(id, relay) { const r = list.get(id); if (r) { r.delay = relay ? NET.RELAY_INTERP_DELAY : NET.INTERP_DELAY; r.extrap = relay ? NET.RELAY_EXTRAP_MAX : NET.EXTRAP_MAX; } }
  function setAway(id, away) { const r = list.get(id); if (r) { r.away = away; r.tag.classList.toggle('away', away); } }
  function clearRun() { for (const r of list.values()) { r.buf = []; r.state = null; } }

  /* the state at local time t: between two snapshots, else carried on (velocity) for at most extrap ms, else the last one */
  function sample(r, t) {
    const b = r.buf;
    if (!b.length) return null;
    if (t <= b[0].t) return { ...b[0].s };
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= t && t <= b[i].t) {
        const A = b[i - 1].s, B = b[i].s, k = (t - b[i - 1].t) / Math.max(1, b[i].t - b[i - 1].t);
        if (Math.abs(B.x - A.x) + Math.abs(B.z - A.z) > 80) return { ...(k < 0.5 ? A : B) };      // round 7: a jump (fast travel, a lift top): no slide across the map
        const L = (p) => A[p] + (B[p] - A[p]) * k;
        const out = { ...B, x: L('x'), y: L('y'), z: L('z'), heading: A.heading + wrapAngle(B.heading - A.heading) * k, speed: L('speed'), edge: L('edge'), tuck: L('tuck'), brake: L('brake'), air: L('air'), progress: L('progress'), grounded: k < 0.5 ? A.grounded : B.grounded, crash: B.crash };
        if (A.ride && B.ride && A.rideLift === B.rideLift) out.rideS = L('rideS');
        return out;
      }
    }
    const last = b[b.length - 1], dt = Math.min(t - last.t, r.extrap) / 1000, s = last.s;
    if (s.crash > 0 || s.finished) return { ...s };
    return { ...s, x: s.x + s.vx * dt, z: s.z + s.vz * dt, y: s.y + s.vy * dt };
  }

  /** every frame: pose, cull, tags. now = local ms, time = the game clock (s) for the figure's own smoothing */
  function update(now, time, width, height) {
    camera.updateMatrixWorld();
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    const cx = camera.position.x, cz = camera.position.z;
    const tagged = [], boxes = [];
    for (const r of list.values()) {
      const st = sample(r, now - r.delay);
      r.state = st;
      if (!st) { r.model.setVisible(false); r.tag.hidden = true; continue; }
      if (st.grounded && st.crash <= 0 && !st.ride) { const g = surface.height(st.x, st.z); if (st.y < g + 0.6) st.y = g; }
      // round 6: riding a lift: in his own chair / cabin on the real line (the figure sits where the carrier holds him)
      const path = st.ride ? liftPath(st.rideLift) : null;
      if (path) {
        const kind = KIND_OF_CODE[st.rideKind] || path.kind;
        if (!r.carrier || r.carrier.kind !== kind) { if (r.carrier) r.carrier.dispose(); r.carrier = createCarrier({ scene, kind, seats: path.seats }); }
        const w = riderAt(path, st.rideS, (x, z) => surface.height(x, z));
        r.carrier.place(w); r.carrier.setVisible(true);
        st.x = w.x; st.y = w.y; st.z = w.z; st.heading = w.heading;
      } else if (r.carrier) r.carrier.setVisible(false);
      const d = Math.hypot(st.x - cx, st.z - cz);
      sphere.center.set(st.x, st.y + 0.9, st.z);
      const visible = d < VIEW_DIST && frustum.intersectsSphere(sphere);
      r.model.setVisible(visible);
      if (visible) r.model.pose(st, (x, z, out) => surface.normal(x, z, out), time, (x, z) => surface.height(x, z));
      // the name tag over the helmet
      v3.set(st.x, st.y + 2.15, st.z).project(camera);
      const onScreen = visible && d < TAG_DIST && v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
      if (!onScreen) { r.tag.hidden = true; continue; }
      const sc = Math.max(0.7, Math.min(1, 60 / Math.max(d, 1)));
      tagged.push({ r, sc }); boxes.push({ x: (v3.x * 0.5 + 0.5) * width, y: (-v3.y * 0.5 + 0.5) * height, w: r.tagW * sc, h: TAGS.HEIGHT_PX * sc, d });
    }
    // round 7: decluttered, nearest first: stacked over each other, the far ones faded, the overlapping rest hidden
    const place = declutterTags(boxes);
    tagged.forEach(({ r, sc }, i) => {
      const p = place[i], b = boxes[i];
      r.tag.hidden = !p.show;
      if (!p.show) return;
      r.tag.style.transform = `translate(${Math.round(b.x)}px, ${Math.round(b.y - p.dy)}px) translate(-50%, -100%) scale(${sc.toFixed(2)})`;
      r.tag.style.opacity = p.alpha.toFixed(2);
    });
    lastTags = place.filter((p) => p.show).length;
  }
  let lastTags = 0;
  function setShadows(on) { castShadow = !!on; for (const r of list.values()) r.mesh.castShadow = castShadow; }
  function setVisible(v) { tagBox.hidden = !v; if (!v) for (const r of list.values()) r.model.setVisible(false); }

  return { add, remove, push, update, setLink, setAway, clearRun, setShadows, setVisible, get: (id) => list.get(id), all: () => [...list.values()], get tagsShown() { return lastTags; } };
}
