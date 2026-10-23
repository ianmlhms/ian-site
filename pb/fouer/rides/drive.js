/* Autoscooter ride (rides wave): you drive bumper car 0 on the hall floor for about a minute (WASD / arrows / joystick), the other cars are driven by the AI of
 * rides/bumper.js. The hall model calls ud.drive(j, matrix) for every car while this rig runs. Hits shake the camera, flash the screen, play a bump and
 * throw sparks from the poles at the ceiling grid. */
import { createBumper } from "./bumper.js";
import { createSmoother } from "./rigs.js";
import { makeBuilder, makeTexBuilder, glowTexture, steelFloorTexture, airbrushTexture } from "./mesh.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** the driver's eye in the car's frame (metres): 1.5 above the floor, 0.42 behind the car centre (over the seat), looking a little down.  The wheel (CENTER, R 0.115) is 0.72 m ahead and 0.38 m
 * below the eye, so it fills about 18 % of the screen height at the bottom (the old 0.21 m wheel 0.67 m in front of a 1.25 m eye took half the screen); the bonnet is a slim band behind it. */
const EYE_UP = 1.5, EYE_BACK = 0.42, PITCH = -0.05;
export const WHEEL = { center: [0, 1.1, 0.32], r: 0.09, ax: [1, 0, 0], ay: [0, 0.87, 0.5], maxTurn: 0.95 };

export function createDriveRig(env) {
  const { T, ud, def, id, fx, snd, audio, calm, walk, group } = env;
  const floor = ud.floor, floorY = ud.floorY ?? 0.45, ceilY = ud.ceilY ?? 3.9;
  const sim = createBumper({ floor, count: ud.carCount ?? 8, seed: (env.pitch | 0) + 11 });
  const out = { position: new T.Vector3(), forward: new T.Vector3(0, 0, 1), up: new T.Vector3(0, 1, 0) };
  const smoother = createSmoother(T);
  const st = { rt: 0, over: false, zap: 1, bumps: 0, input: { throttle: 0, steer: 0 }, bob: 0 };
  const tmp = new T.Vector3(), tmpF = new T.Vector3();
  let sparks = null, sparkPos = null, sparkLife = null;
  const extras = [];                                  // everything this rig adds to the model group (removed in stop())
  const mats = [];
  let cockpit = null, bulbs = null, wheelG = null, wheelAxis = null, wheelAngle = 0;
  const carc = ud.carColors ?? { body: 0x9fb4c8, acc: 0xf08a22, pole: [0xb8212e, 0xefe3c2], uv: [0.55, 0.25, 1] };
  const basic = o => { const m = new T.MeshBasicMaterial({ fog: false, ...o }); mats.push(m); return m; };
  const add = o => { group.add(o); extras.push(o); return o; };

  /** the hall, brighter and festive: a real dark-steel floor (plates, scuffs, sheen of the light bars and the UV pools), airbrush / mirror walls, rows of bulbs under the ceiling and on the barrier */
  function buildHall() {
    const fl = ud.floor, w = fl.x1 - fl.x0 + 0.6, d = fl.z1 - fl.z0 + 0.6;
    const floorTex = steelFloorTexture(T); mats.push(floorTex);
    const floorMesh = new T.Mesh(new T.PlaneGeometry(w, d), basic({ map: floorTex }));
    floorMesh.rotation.x = -Math.PI / 2; floorMesh.position.set((fl.x0 + fl.x1) / 2, floorY + 0.012, (fl.z0 + fl.z1) / 2); floorMesh.name = "ride-floor"; add(floorMesh);
    // side walls: an airbrush mural on one, a mirror wall on the other
    const tb = [makeTexBuilder(T), makeTexBuilder(T)]; const y0 = floorY + 0.35, y1 = ceilY + 0.15, xs = [fl.x0 - 0.75, fl.x1 + 0.75];
    const walls = [airbrushTexture(T, "fun", 3), airbrushTexture(T, "mirror", 5)]; walls.forEach(t => mats.push(t));
    tb[0].quad([xs[0], y0, fl.z1], [xs[0], y0, fl.z0], [xs[0], y1, fl.z0], [xs[0], y1, fl.z1], 0, 0, 1, 1);
    tb[1].quad([xs[1], y0, fl.z0], [xs[1], y0, fl.z1], [xs[1], y1, fl.z1], [xs[1], y1, fl.z0], 0, 0, 1, 1);
    tb.forEach((b, i) => { const m = b.mesh(basic({ map: walls[i], side: T.DoubleSide })); m.name = "ride-wall"; add(m); });
    // bulbs: three rows under the light bars, a row along the barrier rail
    const pos = [], col = [], c = new T.Color(); const palette = [0xfff0c0, 0xff6ad0, 0x6ae8ff, 0xffd060];
    const push = (x, y, z, k) => { pos.push(x, y, z); c.set(palette[k % palette.length]); col.push(c.r, c.g, c.b); };
    let n = 0;
    for (const k of [0.125, 0.375, 0.625, 0.875]) for (const dz of [-0.55, 0.55]) for (let x = fl.x0 + 0.4; x <= fl.x1 - 0.4; x += 0.55) push(x, ceilY - 0.12, fl.z0 + k * (fl.z1 - fl.z0) + dz, n++);       // under the four UV bars of the hall model
    for (let x = fl.x0; x <= fl.x1; x += 0.5) { push(x, floorY + 1.32, fl.z0 - 0.05, n++); if (Math.abs(x) > 2) push(x, floorY + 1.32, fl.z1 + 0.05, n++); }
    for (let z = fl.z0; z <= fl.z1; z += 0.5) { push(fl.x0 - 0.05, floorY + 1.32, z, n++); push(fl.x1 + 0.05, floorY + 1.32, z, n++); }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(new Float32Array(pos), 3)); g.setAttribute("color", new T.BufferAttribute(new Float32Array(col), 3));
    const gt = glowTexture(T); mats.push(gt);
    bulbs = new T.Points(g, new T.PointsMaterial({ size: 0.26, map: gt, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); mats.push(bulbs.material);
    bulbs.frustumCulled = false; bulbs.name = "ride-bulbs"; bulbs.renderOrder = 4; add(bulbs);
  }

  /** your own car in first person (car 0 of the model is hidden): a slim sloping bonnet with a stripe, the dashboard, the rubber bumper ring, a small steering wheel (it turns with the stick),
   * your two hands in orange sleeves on the rim, the pole behind.  Everything below the horizon line of the screen's bottom fifth. */
  function buildCockpit() {
    const b = makeBuilder(T), body = carc.body, acc = carc.acc;
    // the bonnet: from just behind the wheel down to the nose, kept slim (the wheel stands in front of its rear half)
    b.quad([-0.5, 0.98, 0.34], [0.5, 0.98, 0.34], [0.62, 0.6, 1.3], [-0.62, 0.6, 1.3], body);
    b.quad([-0.05, 0.985, 0.34], [0.05, 0.985, 0.34], [0.07, 0.605, 1.3], [-0.07, 0.605, 1.3], acc);
    for (const sx of [-1, 1]) { b.quad([sx * 0.5, 0.98, 0.34], [sx * 0.62, 0.6, 1.3], [sx * 0.62, 0.3, 1.3], [sx * 0.5, 0.3, 0.34], 0x7d8da0); }
    b.quad([-0.62, 0.6, 1.3], [0.62, 0.6, 1.3], [0.62, 0.3, 1.3], [-0.62, 0.3, 1.3], 0x8898ac);
    b.box(0, 1.0, 0.22, 1.24, 0.1, 0.34, 0x2a2e36); b.box(0, 1.055, 0.3, 1.0, 0.02, 0.1, 0x3a3f46);          // the dashboard under the wheel
    for (const x of [-0.42, 0.42]) b.box(x, 1.057, 0.3, 0.06, 0.012, 0.05, 0xffb030);                           // dash lamps
    // the rubber ring (a rounded rectangle) around the car
    const N = 24, ring = [];
    for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a); ring.push([0.85 * Math.sign(cs) * Math.abs(cs) ** 0.7, 1.3 * Math.sign(sn) * Math.abs(sn) ** 0.7]); }
    const outward = v => { const l = Math.hypot(v[0] / 0.85, v[1] / 1.3) || 1; return [v[0] / 0.85 / l, v[1] / 1.3 / l]; };
    const at = (v, k, y) => { const o = outward(v); return [v[0] + o[0] * k, y, v[1] + o[1] * k]; };
    for (let i = 0; i < N; i++) {
      const p = ring[i], q = ring[(i + 1) % N], r = 0.12;
      b.quad(at(p, -r, 0.36), at(q, -r, 0.36), at(q, r, 0.36), at(p, r, 0.36), 0x4a4e58);
      b.quad(at(p, r, 0.36), at(q, r, 0.36), at(q, r, 0.1), at(p, r, 0.1), 0x2a2d34);
      b.quad(at(p, -r * 0.2, 0.37), at(q, -r * 0.2, 0.37), at(q, r * 0.2, 0.37), at(p, r * 0.2, 0.37), 0xc4cad4);
    }
    // the column and your hands: on the rim at 3 and 9 o'clock, sleeves back to the shoulders
    const C = WHEEL.center, ax = WHEEL.ax, ay = WHEEL.ay, R = WHEEL.r;
    b.beam([0, 1.0, 0.22], [C[0], C[1] - 0.02, C[2] - 0.02], 0.05, 0.05, 0x23262a);
    for (const sx of [-1, 1]) {
      const a = sx > 0 ? 0.25 : Math.PI - 0.25, hand = [C[0] + (ax[0] * Math.cos(a) + ay[0] * Math.sin(a)) * R, C[1] + (ax[1] * Math.cos(a) + ay[1] * Math.sin(a)) * R, C[2] + (ax[2] * Math.cos(a) + ay[2] * Math.sin(a)) * R];
      b.ball(hand[0], hand[1], hand[2], 0.04, 0xf0c4a0, 6);                                                  // the hand
      b.beam([hand[0], hand[1] - 0.01, hand[2] - 0.03], [sx * 0.3, 0.98, -0.26], 0.038, 0.034, 0xe0601c);       // sleeve
      b.beam([hand[0], hand[1], hand[2] - 0.02], [hand[0] + sx * 0.015, hand[1] - 0.02, hand[2] - 0.06], 0.055, 0.045, 0xf0c4a0);
    }
    // the pole behind the seat with its flag
    b.beam([0, 0.9, -0.8], [0, ceilY - floorY - 0.05, -0.8], 0.06, 0.06, carc.pole[0]);
    cockpit = new T.Group(); cockpit.name = "ride-cockpit"; cockpit.add(b.mesh(basic({ vertexColors: true, side: T.DoubleSide }))); add(cockpit);
    // the wheel: a thin rim, a gold hub, three spokes, in its own group at the hub so that it can turn about the column
    const w = makeBuilder(T), o = [0, 0, 0];
    w.ring(o, ax, ay, R, 18, 0.026, 0.034, 0x15161a); w.ball(0, 0, 0, 0.035, 0xd8a830, 6);
    for (const a of [Math.PI / 2, Math.PI * 0.5 + 2.1, Math.PI * 0.5 - 2.1]) w.beam(o, [(ax[0] * Math.cos(a) + ay[0] * Math.sin(a)) * R, (ax[1] * Math.cos(a) + ay[1] * Math.sin(a)) * R, (ax[2] * Math.cos(a) + ay[2] * Math.sin(a)) * R], 0.022, 0.022, 0x15161a);
    wheelG = new T.Group(); wheelG.name = "ride-wheel"; wheelG.position.set(C[0], C[1], C[2]); wheelG.add(w.mesh(basic({ vertexColors: true, side: T.DoubleSide })));
    wheelAxis = new T.Vector3(ax[1] * ay[2] - ax[2] * ay[1], ax[2] * ay[0] - ax[0] * ay[2], ax[0] * ay[1] - ax[1] * ay[0]).normalize();
    cockpit.add(wheelG);
  }


  function makeSparks() {
    const n = sim.cars.length * 3;
    const geo = new T.BufferGeometry(); sparkPos = new Float32Array(n * 3); sparkLife = new Float32Array(n);
    geo.setAttribute("position", new T.BufferAttribute(sparkPos, 3));
    const c = document.createElement("canvas"); c.width = c.height = 32; const g = c.getContext("2d");
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16); grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.35, "rgba(170,210,255,.9)"); grad.addColorStop(1, "rgba(120,160,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    const mat = new T.PointsMaterial({ size: 1.0, map: new T.CanvasTexture(c), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, color: 0xcfe4ff });
    sparks = new T.Points(geo, mat); sparks.frustumCulled = false; sparks.name = "ride-sparks"; sparks.renderOrder = 5;
    group.add(sparks);
  }
  function updateSparks(dt) {
    const poleTop = ceilY - floorY - 0.1;
    for (let i = 0; i < sim.cars.length; i++) {
      const c = sim.cars[i];
      const px = c.x - Math.sin(c.yaw) * 0.8, pz = c.z - Math.cos(c.yaw) * 0.8;       // the pole stands 0.8 m behind the car centre
      for (let k = 0; k < 3; k++) {
        const n = i * 3 + k; sparkLife[n] -= dt;
        if (sparkLife[n] <= 0 && Math.random() < dt * (c.speed > 0.5 ? 9 : 3)) sparkLife[n] = 0.05 + Math.random() * 0.1;
        const on = sparkLife[n] > 0; if (i === 0 && on) env.fx.spark(0.9);
        sparkPos[n * 3] = on ? px + (Math.random() - 0.5) * 0.5 : 0; sparkPos[n * 3 + 1] = on ? floorY + poleTop + 0.05 : -50; sparkPos[n * 3 + 2] = on ? pz + (Math.random() - 0.5) * 0.4 : 0;
      }
    }
    sparks.geometry.attributes.position.needsUpdate = true;
  }
  function frameOf(dt) {
    const c = sim.cars[0];
    st.bob += dt * (6 + c.speed * 2);
    const bob = calm() ? 0 : Math.sin(st.bob) * 0.012 * clamp(c.speed / 5, 0, 1);
    const fx_ = Math.sin(c.yaw), fz_ = Math.cos(c.yaw);
    group.updateWorldMatrix(true, false);
    tmp.set(c.x - fx_ * EYE_BACK, floorY + EYE_UP + bob, c.z - fz_ * EYE_BACK).applyMatrix4(group.matrixWorld);
    tmpF.set(fx_, PITCH, fz_).normalize().transformDirection(group.matrixWorld);
    out.position.copy(tmp); out.forward.copy(tmpF);
    // lean into the corner a little (roll the up vector sideways): lateral slip of the tyres
    const lean = calm() ? 0 : clamp(-c.slip * 0.015, -0.08, 0.08);
    out.up.set(Math.cos(c.yaw) * lean, 1, -Math.sin(c.yaw) * lean).transformDirection(group.matrixWorld);
    smoother.apply(out, dt, calm() ? 0.18 : 0.03);
  }
  return {
    kind: "drive", id,
    start() {
      if (ud.setAnimated) ud.setAnimated(true); if (ud.setLOD) ud.setLOD(1);
      ud.drive = (j, m) => { const c = sim.cars[j]; if (!c || j === 0) return false; m.makeRotationY(c.yaw); m.setPosition(c.x, floorY, c.z); return true; };      // car 0 is drawn by the cockpit
      buildHall(); buildCockpit(); makeSparks();
      snd.startBed("scooter"); snd.startMusic();
      frameOf(0);
      fx.hint(env.T_("drive.hint"), 8);
      fx.score(env.T_("drive.score", { n: 0 }));
    },
    update(dt) {
      if (st.over) return true;
      st.rt += dt;
      const c = walk.driveControls ? walk.driveControls() : { throttle: 0, steer: 0 };
      st.input.throttle = c.throttle; st.input.steer = c.steer;
      const events = sim.step(dt, st.input);
      for (const e of events) {
        const player = e.type === "wall" ? e.i === 0 : e.player;
        const power = clamp(e.impulse / 5, 0.25, 1);
        if (player) { snd.bump(power); snd.zap(0.5 * power); fx.shake(clamp(e.impulse / 4.5, 0.2, 1)); fx.flashHit(0.35 * power); st.bumps++; fx.score(env.T_("drive.score", { n: sim.stats.playerBumps })); }
        else if (Math.random() < 0.5) snd.bump(power * 0.25);
      }
      st.zap -= dt; if (st.zap <= 0) { st.zap = 0.8 + Math.random() * 1.6; snd.zap(0.35); }
      const p = sim.cars[0];
      snd.setBed(clamp(p.speed / 6.4, 0, 1), clamp(p.speed / 12, 0, 0.5));
      updateSparks(dt);
      frameOf(dt);
      cockpit.position.set(p.x, floorY, p.z); cockpit.rotation.y = p.yaw;
      wheelAngle += (st.input.steer * WHEEL.maxTurn - wheelAngle) * clamp(dt * 9, 0, 1); if (wheelG) wheelG.quaternion.setFromAxisAngle(wheelAxis, wheelAngle);       // the wheel follows the stick
      snd.tickMusic();
      if (st.rt >= def.dur) { st.over = true; return true; }
      return false;
    },
    get frame() { return out; },
    get progress() { return clamp(st.rt / def.dur, 0, 1); },
    get left() { return Math.max(0, def.dur - st.rt); },
    get speed() { return sim.cars[0].speed; },
    debug() { const c = sim.cars[0]; return { x: c.x, z: c.z, yaw: c.yaw, speed: c.speed, bumps: sim.stats.playerBumps, allBumps: sim.stats.bumps, carBumps: sim.stats.carBumps, wallBumps: sim.stats.wallBumps, rt: st.rt, others: sim.cars.slice(1).map(o => [o.x, o.z]), arena: sim.arena }; },
    sim,
    stop() {
      ud.drive = null;
      if (sparks) { group.remove(sparks); sparks.geometry.dispose(); sparks.material.map.dispose(); sparks.material.dispose(); sparks = null; }
      snd.stopBed(); snd.stopMusic(); fx.score("");
      for (const o of extras) { group.remove(o); o.traverse(q => { if (q.geometry) q.geometry.dispose(); }); }
      mats.forEach(m => m.dispose());
    },
  };
}
