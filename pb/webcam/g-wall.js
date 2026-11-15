/* D'Mauer: a wall with a cut-out silhouette rushes towards you. Strike the pose so your body fits through the hole. */
import { BodyRef, poseMetrics, text, pill, sfx, clamp, TAU } from "./core.js?v=1";

const LIVES = 3;
const WALLS_PER_LEVEL = 4;
const PASS_HOLD_S = 0.2;        // how long the pose must have fitted just before the wall arrives
const CROUCH_DROP = 0.45;       // shoulders this many torso lengths lower than standing = squatting
const STAND_DROP = 0.3;
const WIDE_LEGS = 2.0;          // ankle distance in shoulder widths
const BASE_POINTS = 10;
const EARLY_BONUS = 5;
const RESULT_PAUSE_S = 0.9;
const SHAPES = [
  { id: "t", name: "T-Pose", armL: 90, armR: 90, level: 1 },
  { id: "y", name: "Y", armL: 155, armR: 155, level: 1 },
  { id: "lup", name: "Lénken Aarm erop", armL: 165, armR: 15, level: 1 },
  { id: "rup", name: "Riets Aarm erop", armL: 15, armR: 165, level: 1 },
  { id: "diag", name: "Diagonal", armL: 150, armR: 40, level: 3 },
  { id: "squat", name: "Hock dech", armL: 30, armR: 30, crouch: 1, level: 3 },
  { id: "star", name: "Stär", armL: 130, armR: 130, wide: 1, level: 5, legs: true },
];

const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** How well does the player's body fit the shape? Arm angles within a tolerance, crouch and (when the legs are visible) wide legs. */
export function fitPose(m, ref, shape, tol) {
  if (!m || !ref.ready) return { ok: false, armL: false, armR: false, crouch: false, wide: true };
  const drop = -ref.rise(m);
  const armL = m.armL !== null && angDiff(m.armL, shape.armL) <= tol;
  const armR = m.armR !== null && angDiff(m.armR, shape.armR) <= tol;
  const crouch = shape.crouch ? drop >= CROUCH_DROP : drop < STAND_DROP;
  const wide = shape.wide ? (m.ankleSpan !== null && m.ankleSpan >= WIDE_LEGS) : true;
  return { ok: armL && armR && crouch && wide, armL, armR, crouch, wide };
}

/** The silhouette (also used for the player's ghost). u = shoulder width in pixels; mode "fill" draws thick limbs. */
function figure(c, cx, floorY, u, spec, scale = 1) {
  const crouch = spec.crouch || 0, wide = spec.wide || 0;
  const shY = floorY - 3.9 * u + crouch * 1.25 * u;
  const hipY = shY + 1.4 * u * (1 - 0.12 * crouch);
  const arm = (side, deg) => {
    const a = deg * Math.PI / 180, sx = cx + side * 0.5 * u;
    c.beginPath(); c.moveTo(sx, shY); c.lineTo(sx + side * Math.sin(a) * 1.65 * u, shY + Math.cos(a) * 1.65 * u); c.stroke();
  };
  c.lineCap = "round"; c.lineJoin = "round";
  c.lineWidth = 0.62 * u * scale; arm(-1, spec.armL); arm(1, spec.armR);
  c.lineWidth = 1.05 * u * scale; c.beginPath(); c.moveTo(cx, shY + 0.05 * u); c.lineTo(cx, hipY); c.stroke();
  c.lineWidth = 0.6 * u * scale;
  [-1, 1].forEach((side) => {
    const ankOut = (0.3 + wide * 1.1 + crouch * 0.25) * u, kneeOut = ankOut * 0.55 + crouch * 0.3 * u;
    c.beginPath(); c.moveTo(cx + side * 0.25 * u, hipY); c.lineTo(cx + side * (0.25 * u + kneeOut), (hipY + floorY) / 2); c.lineTo(cx + side * (0.25 * u + ankOut), floorY); c.stroke();
  });
  c.beginPath(); c.arc(cx, shY - 0.95 * u, 0.52 * u * scale, 0, TAU); c.fill();
}

export default {
  id: "wall", name: "D'Mauer", emoji: "🧱", needs: "pose",
  desc: "Strike the pose to fit through the wall",
  howto: ["Stell dech sou wäit zréck, dass däi ganze Kierper am Bild ass, a stéi 1–2 Sekonnen roueg fir ze kalibréieren.", "Eng Mauer mat engem Lach (Silhouette) kënnt op dech zou. Maach déi selwecht Pose, sou dass däi Kierper duerch d'Lach passt.", "3 Liewen. D'Mauere ginn ëmmer méi séier."],
  board: () => ({ id: "webcam-wall", name: "D'Mauer" }),
  create(env) {
    const { W, H } = env;
    const k = H / 720;
    const ref = new BodyRef();
    const wallCanvas = document.createElement("canvas");
    wallCanvas.width = W; wallCanvas.height = H;
    const wc = wallCanvas.getContext("2d");
    let phase = "calib", clock = 0, lives = LIVES, score = 0, passed = 0, shape = null, lastShapeId = "", t = 0, approach = 5, okRun = 0, early = false, resultT = 0, result = "", count = 3;
    let calibProgress = 0, fullBody = false, metrics = null, fit = { ok: false }, lost = false, shake = 0;

    const level = () => 1 + Math.floor(passed / WALLS_PER_LEVEL);
    const tolerance = () => Math.max(24, 42 - (level() - 1) * 2.5);
    const nextShape = () => {
      const pool = SHAPES.filter((s) => s.level <= level() && s.id !== lastShapeId && (!s.legs || fullBody));
      shape = pool[Math.floor(env.rand() * pool.length)]; lastShapeId = shape.id;
      t = 0; okRun = 0; early = false; result = ""; approach = Math.max(1.8, 5.2 - (level() - 1) * 0.5); phase = "wall";
    };

    const unit = () => H * 0.118;
    const floorY = () => H * 0.5 + 2.6 * unit();   // feet of the wall figure; the body is centred on the wall

    return {
      update(dt, frame) {
        clock += dt;
        metrics = poseMetrics(frame.pose, frame.aspect);
        lost = !metrics;
        if (phase === "calib") {
          calibProgress = ref.calibrate(metrics, clock * 1000);
          if (ref.ready) { fullBody = metrics.ankleSpan !== null; phase = "count"; count = 3; clock = 0; sfx.tick(); }
          return;
        }
        ref.adapt(metrics, dt);
        fit = fitPose(metrics, ref, shape || SHAPES[0], tolerance());
        if (phase === "count") {
          const left = 3 - clock;
          if (Math.ceil(left) !== count && left > 0) { count = Math.ceil(left); sfx.tick(); }
          if (left <= 0) { sfx.go(); nextShape(); }
          return;
        }
        if (phase === "wall") {
          if (lost) return;   // the wall waits while the camera cannot see the player
          t += dt / approach;
          if (fit.ok) { okRun += dt; if (t < 0.72 && okRun >= PASS_HOLD_S) early = true; } else okRun = Math.max(0, okRun - dt * 2);
          if (t >= 1) {
            t = 1;
            const pass = okRun >= PASS_HOLD_S * 0.85;
            result = pass ? "pass" : "hit"; phase = "result"; resultT = 0;
            if (pass) { passed += 1; score += BASE_POINTS * level() + (early ? EARLY_BONUS : 0); sfx.win(); env.report(score, false); }
            else { lives -= 1; shake = 0.4; sfx.hit(); }
          }
        } else if (phase === "result") {
          resultT += dt; shake = Math.max(0, shake - dt);
          if (resultT >= RESULT_PAUSE_S) {
            if (lives <= 0) { phase = "over"; env.report(score, true); env.over({ score, title: "D'Mauer huet dech", lines: [`${passed} Mauere gepasst`] }); }
            else nextShape();
          }
        }
      },
      draw(c) {
        const u = unit(), cx = W / 2;
        if (phase === "wall" || phase === "result") {
          const s = 0.3 + 0.82 * Math.pow(t, 1.6);
          const cy = H * 0.5;
          const ww = W * 0.86 * s, wh = u * 7.2 * s;
          wc.save(); wc.setTransform(1, 0, 0, 1, 0, 0); wc.clearRect(0, 0, W, H); wc.globalCompositeOperation = "source-over";
          const g = wc.createLinearGradient(0, cy - wh / 2, 0, cy + wh / 2); g.addColorStop(0, "#6a7882"); g.addColorStop(1, "#3c464e");
          wc.fillStyle = g; wc.fillRect(cx - ww / 2, cy - wh / 2, ww, wh);
          wc.strokeStyle = "rgba(0,0,0,.28)"; wc.lineWidth = Math.max(1, 2 * s);
          const bh = u * 0.62 * s;
          for (let row = 0, y = cy - wh / 2; y < cy + wh / 2; row += 1, y += bh) {
            wc.beginPath(); wc.moveTo(cx - ww / 2, y); wc.lineTo(cx + ww / 2, y); wc.stroke();
            for (let x = cx - ww / 2 + (row % 2 ? bh : 0); x < cx + ww / 2; x += bh * 2.2) { wc.beginPath(); wc.moveTo(x, y); wc.lineTo(x, y + bh); wc.stroke(); }
          }
          const hs = u * s, hy = cy + 2.6 * hs;
          wc.fillStyle = wc.strokeStyle = "rgba(255,255,255,.95)";
          figure(wc, cx, hy, hs * 1.0, shape, 1.16);   // pale rim
          wc.globalCompositeOperation = "destination-out"; wc.fillStyle = wc.strokeStyle = "#000";
          figure(wc, cx, hy, hs, shape, 1);
          wc.restore();
          c.save();
          if (shake > 0) c.translate((Math.random() - 0.5) * 18 * shake * 3, (Math.random() - 0.5) * 18 * shake * 3);
          c.globalAlpha = result === "pass" ? clamp(1 - resultT / RESULT_PAUSE_S, 0, 1) : 1;
          c.drawImage(wallCanvas, 0, 0);
          c.restore();
          if (result === "pass") { c.fillStyle = `rgba(109,240,176,${0.3 * clamp(1 - resultT / RESULT_PAUSE_S, 0, 1)})`; c.fillRect(0, 0, W, H); }
          if (result === "hit") { c.fillStyle = `rgba(255,70,70,${0.35 * clamp(1 - resultT / RESULT_PAUSE_S, 0, 1)})`; c.fillRect(0, 0, W, H); }
          // the player's own body as a ghost in the same frame as the hole
          if (metrics && ref.ready) {
            const spec = { armL: metrics.armL === null ? 12 : metrics.armL, armR: metrics.armR === null ? 12 : metrics.armR, crouch: clamp(-ref.rise(metrics) / 0.9, 0, 1), wide: metrics.ankleSpan !== null ? clamp((metrics.ankleSpan - 1.1) / 2.2, 0, 1) : 0 };
            c.save(); c.globalAlpha = 0.62; c.fillStyle = c.strokeStyle = fit.ok ? "#6df0b0" : "#ff9d6e";
            figure(c, cx, floorY(), u * 0.78, spec, 0.35);
            c.restore();
          }
          text(c, shape.name, cx, H - 26 * k, { size: 30 * k, align: "center", color: "#fff" });
        }
        if (phase === "calib") {
          text(c, "Steh gerued a roueg", cx, H * 0.18, { size: 46 * k, align: "center" });
          text(c, "Ee ganze Kierper soll am Bild sinn.", cx, H * 0.18 + 40 * k, { size: 24 * k, align: "center", weight: 600, color: "#e0e3e5" });
          c.strokeStyle = "rgba(255,255,255,.25)"; c.lineWidth = 10 * k; c.beginPath(); c.arc(cx, H * 0.5, 70 * k, 0, TAU); c.stroke();
          c.strokeStyle = "#6df0b0"; c.beginPath(); c.arc(cx, H * 0.5, 70 * k, -Math.PI / 2, -Math.PI / 2 + TAU * calibProgress); c.stroke();
        }
        if (phase === "count") text(c, String(Math.max(1, count)), cx, H / 2 + 40 * k, { size: 140 * k, align: "center" });
        pill(c, 14, 14, 200 * k, 46 * k); text(c, "Punkten " + score, 30, 14 + 32 * k, { size: 24 * k });
        pill(c, W - 14 - 250 * k, 14, 250 * k, 46 * k); text(c, `Niveau ${level()}   ${"♥".repeat(Math.max(0, lives))}`, W - 30, 14 + 32 * k, { size: 24 * k, align: "right" });
      },
      debug() {
        return {
          phase, level: level(), lives, score, passed, t, okRun, lost, ready: ref.ready, fullBody, calibProgress, result, fit,
          shape: shape ? { id: shape.id, armL: shape.armL, armR: shape.armR, crouch: shape.crouch || 0, wide: shape.wide || 0 } : null,
          metrics: metrics ? { armL: metrics.armL, armR: metrics.armR, ankleSpan: metrics.ankleSpan, rise: ref.ready ? ref.rise(metrics) : 0 } : null,
        };
      },
    };
  },
};
