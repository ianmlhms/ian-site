/* Autoscooter ride (rides wave, "bigger inside"): you drive bumper car 0 for about a minute (WASD / arrows / joystick) in the ride's own interior hall, 40 x 22 m
 * (rides/scooter-hall.js), the other cars (player + 7, every one with a rider) are driven by the AI of rides/bumper.js.  The hall on the map keeps its L pitch (30 x 18 m);
 * while this rig runs the interior stands in the model's frame on its own camera layer, so the real map is not drawn at all (the camera sees layer LAYER only).
 * Hits shake the camera, flash the screen, play a bump and throw sparks from the poles at the ceiling grid. */
import { createBumper } from "./bumper.js";
import { createSmoother } from "./rigs.js";
import { makeBuilder } from "./mesh.js";
import { buildScooterHall, HALL } from "./scooter-hall.js";
import { createFleet } from "./scooter-cars.js";
import { PAL } from "../models/hall-scooter.js";

/** the interior lives on this camera layer; the camera shows nothing else while the ride runs */
export const RIDE_LAYER = 6;
/** the player's car + 7 AI cars (the real hall has 10 - 12 on its smaller floor: this one is meant to feel roomy) */
export const RIDE_CARS = 8;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** the driver's eye in the car's frame (metres): 1.5 above the floor, 0.42 behind the car centre (over the seat), looking a little down.  The wheel (CENTER, R 0.115) is 0.72 m ahead and 0.38 m
 * below the eye, so it fills about 18 % of the screen height at the bottom (the old 0.21 m wheel 0.67 m in front of a 1.25 m eye took half the screen); the bonnet is a slim band behind it. */
const EYE_UP = 1.5, EYE_BACK = 0.42, PITCH = -0.05;
export const WHEEL = { center: [0, 1.1, 0.32], r: 0.09, ax: [1, 0, 0], ay: [0, 0.87, 0.5], maxTurn: 0.95 };

export function createDriveRig(env) {
  const { T, ud, def, id, fx, snd, calm, walk, group, r } = env;
  const floor = HALL.floor, floorY = ud.floorY ?? 0.45, ceilY = ud.ceilY ?? 3.9;
  const sim = createBumper({ floor, count: RIDE_CARS, seed: (env.pitch | 0) + 11 });
  const out = { position: new T.Vector3(), forward: new T.Vector3(0, 0, 1), up: new T.Vector3(0, 1, 0) };
  const smoother = createSmoother(T);
  const st = { rt: 0, over: false, zap: 1, bumps: 0, input: { throttle: 0, steer: 0 }, bob: 0, started: false };
  const tmp = new T.Vector3(), tmpF = new T.Vector3(), carM = new T.Matrix4();
  let sparks = null, sparkPos = null, sparkLife = null;
  const root = new T.Group(); root.name = "scooter-interior";        // the interior, in the hall model's frame, as a child of the scene (not of the model: the map is not drawn)
  const mats = [];
  let cockpit = null, wheelG = null, wheelAxis = null, wheelAngle = 0, hall = null, fleet = null, layerMask = null, exposure = null, offFrame = null;
  const carc = ud.carColors ?? { body: 0x9fb4c8, acc: 0xf08a22, pole: [0xb8212e, 0xefe3c2], uv: [0.55, 0.25, 1] };
  const look = ud.tier ? ud.tier.look : 0;
  const basic = o => { const m = new T.MeshBasicMaterial({ fog: false, ...o }); mats.push(m); return m; };
  const add = o => { root.add(o); return o; };

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
    root.add(sparks);
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
    tmp.set(c.x - fx_ * EYE_BACK, floorY + EYE_UP + bob, c.z - fz_ * EYE_BACK).applyMatrix4(root.matrixWorld);
    tmpF.set(fx_, PITCH, fz_).normalize().transformDirection(root.matrixWorld);
    out.position.copy(tmp); out.forward.copy(tmpF);
    // lean into the corner a little (roll the up vector sideways): lateral slip of the tyres
    const lean = calm() ? 0 : clamp(-c.slip * 0.015, -0.08, 0.08);
    out.up.set(Math.cos(c.yaw) * lean, 1, -Math.sin(c.yaw) * lean).transformDirection(root.matrixWorld);
    smoother.apply(out, dt, calm() ? 0.18 : 0.03);
  }
  function poseCars() {
    for (let j = 1; j < sim.cars.length; j++) { const c = sim.cars[j]; carM.makeRotationY(c.yaw); carM.setPosition(c.x, floorY, c.z); fleet.set(j, carM); }
    fleet.commit();
  }
  /** the interior is built while the screen is black (ride.js fades first); nothing of the map is drawn from here on */
  function build() {
    group.updateWorldMatrix(true, false);
    group.matrixWorld.decompose(root.position, root.quaternion, root.scale);
    const title = String(env.T_("item.scooter")).toUpperCase();
    hall = buildScooterHall(T, { pal: fleetPal(), floorY, ceilY, title, calm });
    root.add(hall.group);
    fleet = createFleet(T, { look, count: sim.cars.length }); fleet.hide(0); root.add(fleet.mesh);
    buildCockpit(); makeSparks();
    r.scene.add(root); root.updateMatrixWorld(true);
    root.traverse(o => o.layers.set(RIDE_LAYER));
    layerMask = r.camera.layers.mask; r.camera.layers.set(RIDE_LAYER);
    exposure = r.renderer.toneMappingExposure; r.renderer.toneMappingExposure = 1;
    offFrame = r.on("frame", () => { r.renderer.toneMappingExposure = 1; });         // after the sky module (it changes the exposure with the hour, also during the fades): the hall is lit by itself
  }
  const fleetPal = () => PAL[Math.max(0, Math.min(2, look | 0))];
  function release() {
    if (offFrame) { offFrame(); offFrame = null; }
    if (layerMask !== null) { r.camera.layers.mask = layerMask; layerMask = null; }
    if (exposure !== null) { r.renderer.toneMappingExposure = exposure; exposure = null; }
    if (root.parent) root.parent.remove(root);
    if (sparks) { sparks.geometry.dispose(); sparks.material.map.dispose(); sparks.material.dispose(); sparks = null; }
    if (hall) { hall.dispose(); hall = null; }
    if (fleet) { fleet.dispose(); fleet = null; }
    root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    mats.forEach(m => m.dispose()); mats.length = 0;
  }
  return {
    kind: "drive", id,
    start() {
      try {
        build();
        poseCars();
        snd.startBed("scooter"); snd.startMusic();
        frameOf(0);
        fx.hint(env.T_("drive.hint"), 8);
        fx.score(env.T_("drive.score", { n: 0 }));
        st.started = true;
      } catch (error) { release(); throw error; }
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
      poseCars();
      hall.update(st.rt);
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
    get root() { return root; },
    debug() { const c = sim.cars[0]; return { x: c.x, z: c.z, yaw: c.yaw, speed: c.speed, bumps: sim.stats.playerBumps, allBumps: sim.stats.bumps, carBumps: sim.stats.carBumps, wallBumps: sim.stats.wallBumps, rt: st.rt, others: sim.cars.slice(1).map(o => [o.x, o.z]), arena: sim.arena,
      floor: { ...HALL.floor }, cars: sim.cars.length, riders: sim.cars.length, interior: true, carTris: fleet ? fleet.tris : 0 }; },
    sim,
    stop() {
      snd.stopBed(); snd.stopMusic(); fx.score("");
      release();
    },
  };
}
