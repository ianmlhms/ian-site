/* Sprangen: an endless runner you control with your body. Really jump to clear blocks, squat under bars. */
import { BodyRef, poseMetrics, text, pill, sfx, clamp, TAU } from "./core.js?v=1";

const JUMP_RISE = 0.22;        // shoulders this many torso lengths above standing = a jump
const JUMP_REARM = 0.1;
const DUCK_DROP = 0.35;        // this many torso lengths lower = squatting
const DUCK_RELEASE = 0.2;
const AIR_S = 0.7;
const JUMP_PEAK = 210;         // px at H=720
const START_SPEED = 360;
const MAX_SPEED = 820;
const PX_PER_M = 60;
const STAND_H = 150, DUCK_H = 78, PLAYER_W = 46;
const BLOCK_H_MIN = 60, BLOCK_H_MAX = 88;

export default {
  id: "jump", name: "Sprangen", emoji: "🦘", needs: "pose",
  desc: "Jump and duck to run as far as you can",
  howto: ["Stell dech sou wäit zréck, dass däi ganze Kierper am Bild ass, a stéi roueg fir ze kalibréieren.", "Spréng wierklech, fir iwwer d'Këschten ze kommen. Hock dech, fir ënner de Balken duerchzekommen.", "Eng Kollisioun a fäerdeg. D'Meter zielen."],
  board: () => ({ id: "webcam-jump", name: "Sprangen" }),
  create(env) {
    const { W, H } = env;
    const k = H / 720;
    const ref = new BodyRef();
    let phase = "calib", clock = 0, calibProgress = 0, count = 3, dist = 0, speed = START_SPEED, airT = -1, ducking = false, armed = true, obstacles = [], nextGap = 0, over = false, flashT = 0;
    let metrics = null, rise = 0, lost = false, lastType = "", scroll = 0, lastReport = 0;
    const ground = () => H * 0.8;
    const px = () => W * 0.22;
    const playerTop = () => ground() - (ducking ? DUCK_H : STAND_H) * k - jumpY();
    const jumpY = () => (airT < 0 ? 0 : 4 * JUMP_PEAK * k * (airT / AIR_S) * (1 - airT / AIR_S));

    const spawn = () => {
      const bar = env.rand() < 0.38 && lastType !== "bar";
      lastType = bar ? "bar" : "block";
      const w = (bar ? 120 : 54 + env.rand() * 26) * k, h = (bar ? 0 : BLOCK_H_MIN + env.rand() * (BLOCK_H_MAX - BLOCK_H_MIN)) * k;
      obstacles.push({ type: bar ? "bar" : "block", x: W + 60, w, h, bottom: (bar ? 112 : 0) * k });
      nextGap = (speed * (0.95 + env.rand() * 0.75)) + w;
    };

    const hitTest = () => {
      const left = px() - PLAYER_W * k / 2 + 6 * k, right = px() + PLAYER_W * k / 2 - 6 * k;
      const top = playerTop(), bottom = ground() - jumpY();
      return obstacles.some((o) => {
        if (o.x > right || o.x + o.w < left) return false;
        const oTop = o.type === "bar" ? ground() - 560 * k : ground() - o.h, oBottom = ground() - o.bottom;
        return !(bottom <= oTop + 4 * k || top >= oBottom - 2 * k);
      });
    };

    return {
      update(dt, frame) {
        clock += dt;
        metrics = poseMetrics(frame.pose, frame.aspect);
        lost = !metrics;
        if (phase === "calib") {
          calibProgress = ref.calibrate(metrics, clock * 1000);
          if (ref.ready) { phase = "count"; clock = 0; count = 3; sfx.tick(); }
          return;
        }
        ref.adapt(metrics, dt);
        rise = metrics ? ref.rise(metrics) : 0;
        if (phase === "count") {
          const left = 3 - clock;
          if (Math.ceil(left) !== count && left > 0) { count = Math.ceil(left); sfx.tick(); }
          if (left <= 0) { phase = "run"; sfx.go(); spawn(); obstacles[0].x = W + 300 * k; }
          return;
        }
        if (phase !== "run") return;
        if (metrics) {
          if (airT < 0 && armed && rise >= JUMP_RISE && !ducking) { airT = 0; armed = false; sfx.jump(); }
          if (rise < JUMP_REARM) armed = true;
          if (airT < 0) { if (!ducking && -rise >= DUCK_DROP) ducking = true; else if (ducking && -rise <= DUCK_RELEASE) ducking = false; }
          else ducking = false;
        }
        if (airT >= 0) { airT += dt; if (airT >= AIR_S) airT = -1; }
        speed = Math.min(MAX_SPEED, START_SPEED + dist * 0.8 * k);
        const step = speed * k * dt;
        dist += step / (PX_PER_M * k); scroll += step;
        obstacles.forEach((o) => { o.x -= step; });
        obstacles = obstacles.filter((o) => o.x + o.w > -40);
        nextGap -= step;
        if (nextGap <= 0) spawn();
        if (hitTest()) {
          phase = "over"; sfx.hit(); flashT = 0.4;
          const score = Math.floor(dist);
          env.report(score, true);
          env.over({ score, title: "Autsch!", lines: [`${score} Meter gelaf`] });
          return;
        }
        if (Math.floor(dist) - lastReport >= 5) { lastReport = Math.floor(dist); env.report(lastReport, false); }
      },
      draw(c) {
        const g = ground(), cx = W / 2;
        if (phase === "calib") {
          text(c, "Steh gerued a roueg", cx, H * 0.18, { size: 46 * k, align: "center" });
          text(c, "Ee ganze Kierper soll am Bild sinn.", cx, H * 0.18 + 40 * k, { size: 24 * k, align: "center", weight: 600, color: "#e0e3e5" });
          c.strokeStyle = "rgba(255,255,255,.25)"; c.lineWidth = 10 * k; c.beginPath(); c.arc(cx, H * 0.5, 70 * k, 0, TAU); c.stroke();
          c.strokeStyle = "#6df0b0"; c.beginPath(); c.arc(cx, H * 0.5, 70 * k, -Math.PI / 2, -Math.PI / 2 + TAU * calibProgress); c.stroke();
        }
        // ground
        c.fillStyle = "rgba(20,26,30,.78)"; c.fillRect(0, g, W, H - g);
        c.strokeStyle = "#6df0b0"; c.lineWidth = 4 * k; c.beginPath(); c.moveTo(0, g); c.lineTo(W, g); c.stroke();
        c.strokeStyle = "rgba(255,255,255,.18)"; c.lineWidth = 3 * k;
        for (let x = -((scroll) % (90 * k)); x < W; x += 90 * k) { c.beginPath(); c.moveTo(x, g + 24 * k); c.lineTo(x + 40 * k, g + 24 * k); c.stroke(); }
        // obstacles
        obstacles.forEach((o) => {
          if (o.type === "block") {
            c.fillStyle = "#ff8a3d"; c.fillRect(o.x, g - o.h, o.w, o.h);
            c.fillStyle = "rgba(255,255,255,.28)"; c.fillRect(o.x, g - o.h, o.w, 8 * k);
            c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = 3 * k; c.strokeRect(o.x, g - o.h, o.w, o.h);
          } else {
            c.fillStyle = "#c77dff"; c.fillRect(o.x, g - 560 * k, o.w, 560 * k - o.bottom);
            c.fillStyle = "rgba(255,255,255,.3)"; c.fillRect(o.x, g - o.bottom - 14 * k, o.w, 14 * k);
            c.fillStyle = "#9b59d0"; c.fillRect(o.x + o.w * 0.4, g - 560 * k, o.w * 0.2, 450 * k);
          }
        });
        // runner
        const top = playerTop(), bottom = g - jumpY(), height = bottom - top, pxx = px();
        c.save(); c.lineCap = "round"; c.lineJoin = "round";
        c.fillStyle = "rgba(0,0,0,.3)"; c.beginPath(); c.ellipse(pxx, g + 4 * k, 30 * k * (1 - jumpY() / (280 * k)), 7 * k, 0, 0, TAU); c.fill();
        c.fillStyle = phase === "over" ? "#ff6b6b" : "#6df0b0"; c.strokeStyle = c.fillStyle;
        const run = Math.sin(clock * 16) * 10 * k;
        c.lineWidth = 9 * k;
        c.beginPath(); c.arc(pxx, top + 16 * k, 16 * k, 0, TAU); c.fill();
        c.beginPath(); c.moveTo(pxx, top + 32 * k); c.lineTo(pxx, top + height * 0.62); c.stroke();
        c.beginPath(); c.moveTo(pxx, top + height * 0.62); c.lineTo(pxx - 14 * k + (airT < 0 ? run : -8 * k), bottom); c.moveTo(pxx, top + height * 0.62); c.lineTo(pxx + 14 * k - (airT < 0 ? run : -8 * k), bottom); c.stroke();
        c.lineWidth = 7 * k; c.beginPath(); c.moveTo(pxx, top + height * 0.3); c.lineTo(pxx - 22 * k, top + height * 0.5 - run); c.moveTo(pxx, top + height * 0.3); c.lineTo(pxx + 22 * k, top + height * 0.5 + run); c.stroke();
        c.restore();
        if (flashT > 0) { c.fillStyle = `rgba(255,70,70,${flashT})`; c.fillRect(0, 0, W, H); flashT = Math.max(0, flashT - 0.03); }
        if (phase === "count") text(c, String(Math.max(1, count)), cx, H / 2 - 30 * k, { size: 140 * k, align: "center" });
        pill(c, 14, 14, 220 * k, 46 * k); text(c, Math.floor(dist) + " m", 30, 14 + 32 * k, { size: 26 * k });
        if (phase === "run") {
          pill(c, W - 14 - 260 * k, 14, 260 * k, 46 * k);
          text(c, ducking ? "Hock" : airT >= 0 ? "Sprong" : "Lafen", W - 30, 14 + 32 * k, { size: 22 * k, align: "right", color: "#cfd3d6", weight: 600 });
        }
      },
      debug() {
        return { phase, dist, speed, airborne: airT >= 0, ducking, rise, ready: ref.ready, lost, calibProgress, obstacles: obstacles.map((o) => ({ type: o.type, x: o.x / W, w: o.w / W })) };
      },
    };
  },
};
