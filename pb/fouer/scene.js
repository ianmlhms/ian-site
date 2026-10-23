// Schueberfouer Tycoon W5: the bridge between the game state and everything that is drawn.
//  - pitch state -> createFairLayer.setPitch (built / open / locked) and W2's pitch markers (glow / faint / hidden)
//  - build effect: the new attraction grows out of the ground for ~1.1 s (a temporary copy of the model), a gold ring and sparkles
//  - selection ribbon, closed entrance barriers (stars open the doors), screen anchors for the DOM overlay, tap picking
// It never touches the economy; it only reads `game`.
import { PITCHES, PITCH_COUNT, ITEM_BY_ID } from "./data.js";
import { buildModel, hasModel } from "./models/index.js";
import { ENTRANCES } from "./models/props.js";
import { visitSpec } from "./social.js";

const GROW_SECONDS = 1.15;
const RING_SECONDS = 1.0;
const SPARK_SECONDS = 1.25;
const SPARK_COUNT = 56;
const YAW = { "+w": 0, "-w": Math.PI, "+u": Math.PI / 2, "-u": -Math.PI / 2 };
const FACE_VEC = { "+w": [0, 1], "-w": [0, -1], "+u": [1, 0], "-u": [-1, 0] };
const GATE_WIDTH = { gate: 7, portal: 13, boom: 13 };
const GATE_INSET = 3;
const TAP_SEGMENT_PX = 34;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hashStr = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 100000; };
const easeOutBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

export function createSceneBridge({ T, r, world, fair, markers, game, quality = "medium", onGates = () => {} }) {
  const root = r.gameRoot;
  const camera = r.camera;
  const tmp = new T.Vector3();
  const applied = new Map();            // pitch index -> spec key
  const growing = new Map();            // pitch index -> effect (the fair pitch is held back until it ends)
  const effects = [];                   // rings and sparkles
  let night = 0;
  let selected = -1;
  let selectMesh = null;
  let selectT = 0;
  let gateMesh = null;
  let gateStars = 0;
  let visit = null;                     // W7: a published fair shown read-only instead of the player's own (social.js layout)
  const rects = PITCHES.map((pitch, index) => ({ index, ...(markers.rect(pitch.id) ?? { u: pitch.u, w: pitch.w, du: 8, dw: 8, y: world.groundY(pitch.u, pitch.w), size: pitch.size }) }));

  // ---- shared sparkle texture ----
  const sparkTexture = (() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(0.35, "rgba(255,226,140,0.9)"); gradient.addColorStop(1, "rgba(255,200,80,0)");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 32, 32);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    return texture;
  })();

  // ---- spec of one pitch ----
  function specFor(index) {
    const entry = game.state.pitches[index];
    if (entry) return { state: "built", item: entry.k, look: entry.look, level: entry.lv + 1 };
    return { state: game.pitchStatus(index) === "locked" ? "locked" : "open" };
  }
  const keyOf = spec => spec.state === "built" ? `b|${spec.item}|${spec.look}|${spec.level}` : spec.state;

  function applyPitch(index) {
    if (visit) return;
    const spec = specFor(index);
    const key = keyOf(spec);
    if (applied.get(index) === key) return;
    applied.set(index, key);
    fair.setPitch(PITCHES[index].id, spec);
  }

  function syncMarkers() {
    if (visit) { for (const pitch of PITCHES) markers.setState(pitch.id, "built"); return; }
    const glow = new Set(game.glowPitches());
    for (let i = 0; i < PITCH_COUNT; i++) {
      const status = game.pitchStatus(i);
      // built or still locked (a padlock stall stands there): no outline; open but not glowing: faint outline; glowing: gold
      const hidden = Boolean(game.state.pitches[i]) || growing.has(i) || (status === "locked" && !glow.has(i));
      markers.setState(PITCHES[i].id, hidden ? "built" : glow.has(i) ? "open" : "locked");
    }
  }

  /** Brings the drawn fair in line with the state. Pitches that are mid-animation are applied when it ends. */
  function sync() {
    if (visit) return;
    for (let i = 0; i < PITCH_COUNT; i++) if (!growing.has(i)) applyPitch(i);
    syncMarkers();
    syncGates();
  }

  /** Visit another player's fair: the fair layer shows their pitches until endVisit() (the economy and the save are not touched). */
  function showVisit(layout) {
    visit = layout;
    select(-1);
    PITCHES.forEach((pitch, i) => { const spec = visitSpec(layout, i); applied.set(i, `v|${keyOf(spec)}`); fair.setPitch(pitch.id, spec); });
    syncMarkers();
  }
  function endVisit() {
    if (!visit) return;
    visit = null;
    applied.clear();
    sync();
  }

  // ---- build / upgrade effects ----
  function ground(index) { const rect = rects[index]; return rect.y; }
  function heightOf(index) {
    const pit = fair.pits.get(PITCHES[index].id);
    const h = pit?.near?.userData?.height ?? pit?.cur?.userData?.height;
    return clamp(h || 5, 3, 60);
  }

  function addRing(index, color = 0xffd36a) {
    const rect = rects[index];
    const geometry = new T.RingGeometry(0.82, 1, 56);
    geometry.rotateX(-Math.PI / 2);
    const material = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending, fog: false, side: T.DoubleSide });
    const mesh = new T.Mesh(geometry, material);
    mesh.position.set(rect.u, rect.y + 0.5, rect.w); mesh.renderOrder = 6;
    root.add(mesh);
    effects.push({ t: 0, d: RING_SECONDS, mesh, update(k) {
      const s = 0.4 + 1.1 * (1 - Math.pow(1 - k, 3));
      mesh.scale.set(rect.du * 0.62 * s, 1, rect.dw * 0.62 * s); material.opacity = 0.9 * (1 - k);
    }, dispose() { root.remove(mesh); geometry.dispose(); material.dispose(); } });
  }

  function addSparkles(index, lift = 2) {
    const rect = rects[index];
    const positions = new Float32Array(SPARK_COUNT * 3);
    const velocity = new Float32Array(SPARK_COUNT * 3);
    const hue = new Float32Array(SPARK_COUNT * 3);
    for (let i = 0; i < SPARK_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 7;
      positions[i * 3] = rect.u + (Math.random() - 0.5) * rect.du * 0.5; positions[i * 3 + 1] = rect.y + lift; positions[i * 3 + 2] = rect.w + (Math.random() - 0.5) * rect.dw * 0.5;
      velocity[i * 3] = Math.cos(angle) * speed; velocity[i * 3 + 1] = 5 + Math.random() * 9; velocity[i * 3 + 2] = Math.sin(angle) * speed;
      const warm = Math.random();
      hue[i * 3] = 1; hue[i * 3 + 1] = 0.78 + warm * 0.22; hue[i * 3 + 2] = 0.3 + warm * 0.6;
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new T.BufferAttribute(hue, 3));
    const material = new T.PointsMaterial({ map: sparkTexture, size: 2.6, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false });
    const points = new T.Points(geometry, material); points.frustumCulled = false; points.renderOrder = 7;
    root.add(points);
    effects.push({ t: 0, d: SPARK_SECONDS, mesh: points, update(k, dt) {
      for (let i = 0; i < SPARK_COUNT; i++) {
        velocity[i * 3 + 1] -= 16 * dt;
        positions[i * 3] += velocity[i * 3] * dt; positions[i * 3 + 1] += velocity[i * 3 + 1] * dt; positions[i * 3 + 2] += velocity[i * 3 + 2] * dt;
      }
      geometry.attributes.position.needsUpdate = true; material.opacity = 1 - k * k;
    }, dispose() { root.remove(points); geometry.dispose(); material.dispose(); } });
  }

  function growIn(index) {
    const entry = game.state.pitches[index];
    if (!entry) return;
    const spec = specFor(index);
    const rect = rects[index];
    const finish = () => { growing.delete(index); applyPitch(index); syncMarkers(); };
    if (!hasModel(spec.item)) { addRing(index); addSparkles(index); return; }
    applied.set(index, "open"); fair.setPitch(PITCHES[index].id, { state: "open" });   // the old attraction (replace) or bare pitch stays out until the new one has grown
    let model = null;
    try { model = buildModel(spec.item, { look: spec.look, level: spec.level, quality, seed: (hashStr(PITCHES[index].id) % 997) + 1, far: false }); }
    catch (error) { console.warn("[fouer] grow-in model failed", error); return; }
    if (model.userData.setNight) model.userData.setNight(night);
    const holder = new T.Group();
    holder.position.set(rect.u, rect.y, rect.w); holder.rotation.y = YAW[PITCHES[index].face] ?? 0;
    holder.add(model); root.add(holder); holder.scale.set(0.6, 0.02, 0.6);
    growing.set(index, true);
    syncMarkers();
    effects.push({ t: 0, d: GROW_SECONDS, mesh: holder, update(k, dt, total) {
      const g = easeOutBack(clamp(k * 1.05, 0, 1));
      holder.scale.set(0.55 + 0.45 * g, Math.max(0.02, g), 0.55 + 0.45 * g);
      if (model.userData.animate) model.userData.animate(total, dt, night);
    }, dispose() {
      root.remove(holder);
      if (model.userData.dispose) model.userData.dispose(); else model.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      finish();
    } });
    addRing(index); addSparkles(index, 1);
  }

  // ---- selection ribbon ----
  function ribbon(rect) {
    const pad = 0.6, step = 2.5, half = 0.7;
    const u0 = rect.u - rect.du / 2 - pad, u1 = rect.u + rect.du / 2 + pad, w0 = rect.w - rect.dw / 2 - pad, w1 = rect.w + rect.dw / 2 + pad;
    const points = [];
    const edge = (a, b, c, d, nu, nw) => { const n = Math.max(1, Math.ceil(Math.hypot(c - a, d - b) / step)); for (let k = 0; k < n; k++) points.push({ u: a + (c - a) * k / n, w: b + (d - b) * k / n, nu, nw }); };
    edge(u0, w0, u1, w0, 0, 1); edge(u1, w0, u1, w1, -1, 0); edge(u1, w1, u0, w1, 0, -1); edge(u0, w1, u0, w0, 1, 0);
    const positions = [], index = [];
    points.forEach((p, i) => {
      positions.push(p.u, world.groundY(p.u, p.w) + 0.45, p.w);
      const iu = p.u + p.nu * half, iw = p.w + p.nw * half;
      positions.push(iu, world.groundY(iu, iw) + 0.45, iw);
      const n = i * 2, m = ((i + 1) % points.length) * 2;
      index.push(n, m, n + 1, m, m + 1, n + 1);
    });
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3)); geometry.setIndex(index);
    return geometry;
  }

  function select(index) {
    if (selectMesh) { root.remove(selectMesh); selectMesh.geometry.dispose(); selectMesh.material.dispose(); selectMesh = null; }
    selected = index;
    if (index < 0) return;
    const material = new T.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, depthWrite: false, fog: false, side: T.DoubleSide, blending: T.AdditiveBlending });
    selectMesh = new T.Mesh(ribbon(rects[index]), material); selectMesh.frustumCulled = false; selectMesh.renderOrder = 6; selectMesh.name = "fouer-selection";
    root.add(selectMesh);
  }

  // ---- closed entrances: red-white barriers + a board with as many gold diamonds as stars needed ----
  function barrierBoxes(entrance) {
    const [fu, fw] = FACE_VEC[entrance.face];
    const width = GATE_WIDTH[entrance.kind] ?? 7;
    const baseU = entrance.u - fu * GATE_INSET, baseW = entrance.w - fw * GATE_INSET;
    const tu = -fw, tw = fu;                                   // along the barrier
    const boxes = [];
    const panels = Math.round(width / 1.3);
    for (let k = 0; k < panels; k++) {
      const s = (k + 0.5) / panels - 0.5;
      const u = baseU + tu * s * width, w = baseW + tw * s * width;
      boxes.push({ u, w, y: 0.12, sx: Math.abs(tu) > 0 ? width / panels - 0.12 : 0.1, sy: 0.9, sz: Math.abs(tw) > 0 ? width / panels - 0.12 : 0.1, color: k % 2 ? 0xf2f2ee : 0xd8283a });
    }
    for (const side of [-0.5, 0.5]) {
      boxes.push({ u: baseU + tu * side * width, w: baseW + tw * side * width, y: 0, sx: 0.25, sy: 1.5, sz: 0.25, color: 0x45484f });
    }
    // sign board on two posts, diamonds for the stars
    const boardW = 0.9 + entrance.star * 0.55;
    boxes.push({ u: baseU - fu * 0.2, w: baseW - fw * 0.2, y: 1.5, sx: Math.abs(tu) > 0 ? boardW : 0.12, sy: 0.7, sz: Math.abs(tw) > 0 ? boardW : 0.12, color: 0x3a2a20 });
    for (let k = 0; k < entrance.star; k++) {
      const s = (k - (entrance.star - 1) / 2) * 0.55;
      boxes.push({ u: baseU - fu * 0.3 + tu * s, w: baseW - fw * 0.3 + tw * s, y: 1.62, sx: 0.32, sy: 0.32, sz: 0.32, color: 0xffcf4a, rot: true });
    }
    return boxes;
  }

  function syncGates() {
    const stars = game.stars();
    if (gateMesh && stars === gateStars) return;
    const opened = stars > gateStars && gateMesh ? ENTRANCES.filter(e => e.star > gateStars && e.star <= stars) : [];
    gateStars = stars;
    if (gateMesh) { root.remove(gateMesh); gateMesh.geometry.dispose(); gateMesh.material.dispose(); gateMesh = null; }
    const closed = ENTRANCES.filter(e => e.star > stars);
    if (closed.length) {
      const base = new T.BoxGeometry(1, 1, 1);
      const parts = [];
      let vertices = 0;
      const all = closed.flatMap(entrance => barrierBoxes(entrance).map(box => ({ ...box, face: entrance.face })));
      for (const box of all) {
        const geometry = base.clone().toNonIndexed();
        const matrix = new T.Matrix4().compose(new T.Vector3(box.u, world.groundY(box.u, box.w) + box.y + box.sy / 2, box.w),
          new T.Quaternion().setFromEuler(new T.Euler(0, box.rot ? Math.PI / 4 : 0, box.rot ? Math.PI / 4 : 0)), new T.Vector3(box.sx, box.sy, box.sz));
        geometry.applyMatrix4(matrix);
        const color = new T.Color(box.color);
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        for (let i = 0; i < geometry.attributes.position.count; i++) { colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b; }
        geometry.setAttribute("color", new T.BufferAttribute(colors, 3));
        parts.push(geometry); vertices += geometry.attributes.position.count;
      }
      const position = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3), color = new Float32Array(vertices * 3);
      let offset = 0;
      for (const part of parts) {
        position.set(part.attributes.position.array, offset * 3); normal.set(part.attributes.normal.array, offset * 3); color.set(part.attributes.color.array, offset * 3);
        offset += part.attributes.position.count; part.dispose();
      }
      base.dispose();
      const merged = new T.BufferGeometry();
      merged.setAttribute("position", new T.BufferAttribute(position, 3)); merged.setAttribute("normal", new T.BufferAttribute(normal, 3)); merged.setAttribute("color", new T.BufferAttribute(color, 3));
      merged.computeBoundingSphere();
      gateMesh = new T.Mesh(merged, new T.MeshLambertMaterial({ vertexColors: true })); gateMesh.name = "fouer-closed-gates"; gateMesh.frustumCulled = false;
      root.add(gateMesh);
    }
    if (opened.length) onGates(opened);
  }

  // ---- screen anchors and picking ----
  const canvas = r.renderer.domElement;
  function toScreen(u, y, w) {
    tmp.set(u, y, w).project(camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + (tmp.x + 1) / 2 * rect.width, y: rect.top + (1 - tmp.y) / 2 * rect.height, z: tmp.z, visible: tmp.z < 1 && tmp.z > -1 && Math.abs(tmp.x) < 1.15 && Math.abs(tmp.y) < 1.15 };
  }
  /** Screen position of a point `lift` metres above the ground of a pitch (null if it is behind the camera). */
  function anchor(index, lift = 0) {
    const rect = rects[index];
    const point = toScreen(rect.u, rect.y + lift, rect.w);
    return point.z >= 1 ? null : point;
  }

  /** Which pitch is under a tap: the ground rectangle first, then tall attractions by their screen line. */
  function pick(clientX, clientY, ground) {
    let best = -1, bestD = Infinity;
    if (ground) {
      const id = markers.pick(ground.u, ground.w, 1.5);
      if (id) { best = PITCHES.findIndex(p => p.id === id); bestD = 0; }
    }
    for (let i = 0; i < PITCH_COUNT; i++) {
      const built = Boolean(game.state.pitches[i]);
      if (!built && !game.pitchUsable(i) && game.pitchStatus(i) !== "locked") continue;
      const rect = rects[i];
      const h = built ? heightOf(i) : 0.5;
      const a = toScreen(rect.u, rect.y, rect.w), b = toScreen(rect.u, rect.y + h, rect.w);
      if (a.z >= 1 && b.z >= 1) continue;
      const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy || 1;
      const t = clamp(((clientX - a.x) * vx + (clientY - a.y) * vy) / len2, 0, 1);
      const d = Math.hypot(clientX - (a.x + vx * t), clientY - (a.y + vy * t));
      const limit = TAP_SEGMENT_PX + Math.min(26, Math.hypot(vx, vy) * 0.12);
      if (d < limit && d < bestD - 4) { best = i; bestD = d; }
    }
    return best;
  }

  /** Move the camera so a pitch sits in the upper part of the screen (above a bottom sheet). */
  function focus(index, { dist, lift = 0.17, seconds = 0.7 } = {}) {
    const rect = rects[index];
    const d = clamp(dist ?? Math.min(Math.max(r.rig.dist, 70), 150), 60, 300);
    const yaw = r.rig.yaw;
    const k = d * lift;
    r.rig.flight = null;                                  // an instant jump (seconds 0) must also end a flight that is still running
    r.flyTo({ tu: rect.u - Math.cos(yaw) * k, tw: rect.w - Math.sin(yaw) * k, yaw, dist: d, tilt: r.rig.tilt }, seconds);
  }

  function update(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i];
      fx.t += dt;
      const k = clamp(fx.t / fx.d, 0, 1);
      fx.update(k, dt, fx.t);
      if (k >= 1) { fx.dispose(); effects.splice(i, 1); }
    }
    if (selectMesh) { selectT += dt; selectMesh.material.opacity = 0.55 + 0.4 * Math.sin(selectT * 5); }
  }

  game.on("change", event => {
    if ((event.kind === "build" || event.kind === "replace") && event.index !== undefined) growIn(event.index);
    sync();
  });
  game.on("upgraded", ({ index }) => { addRing(index, 0xfff2b0); addSparkles(index, heightOf(index) * 0.35); });
  game.on("looked", ({ index }) => { addSparkles(index, 2); });

  return {
    sync, update, select, anchor, pick, focus, heightOf, rects, effects, showVisit, endVisit,
    get visiting() { return visit !== null; }, get selected() { return selected; }, get growing() { return growing.size; },
    setNight(k) { night = k; },
    addRing, addSparkles,
    dispose() { effects.splice(0).forEach(fx => fx.dispose()); select(-1); if (gateMesh) { root.remove(gateMesh); gateMesh.geometry.dispose(); gateMesh.material.dispose(); } },
  };
}
