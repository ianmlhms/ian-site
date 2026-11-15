/* Ballonen: pop the balloons with your index fingertips. Combos build a multiplier, bombs hurt, 60 seconds. */
import { HAND, TAU, clamp, text, pill, sfx } from "./core.js?v=1";

const ROUND_S = 60;
const COUNTDOWN_S = 3;
const COLORS = ["#ff5d73", "#ffb84d", "#4fd1c5", "#7aa2ff", "#c77dff", "#7be07b"];
const COMBO_WINDOW_S = 1.4;
const MAX_MULTIPLIER = 5;
const BOMB_SCORE = -5;
const BOMB_TIME_S = 3;

export default {
  id: "balloons", name: "Ballonen", emoji: "🎈", needs: "hands",
  desc: "Pop the balloons with your fingertips",
  howto: ["Halt eng oder zwou Hänn an d'Kamera.", "Beréier d'Ballonen mat de Fanger-Spëtzen, dat gëtt Punkten. Gëlle Ballonen zielen 5, séier Pops baue eng Kombo op.", "Pass op déi schwaarz Bomben op!"],
  board: () => ({ id: "webcam-balloons", name: "Ballonen" }),
  create(env) {
    const { W, H } = env;
    const k = H / 720;
    let phase = "ready", phaseT = 0, timeLeft = ROUND_S, score = 0, combo = 0, lastPopT = -99, spawnT = 0.4, clock = 0, popped = 0, shake = 0, flash = 0, bombFlash = 0;
    let balloons = [], parts = [], floaters = [], prevTips = [];
    let lastCount = COUNTDOWN_S + 1;

    const spawn = () => {
      const roll = env.rand();
      const type = roll < 0.13 ? "bomb" : roll < 0.2 ? "gold" : "normal";
      const r = (type === "gold" ? 34 : 44 + env.rand() * 20) * k;
      balloons.push({
        type, r, x: r + env.rand() * (W - 2 * r), y: H + r + 10,
        vy: -(78 + env.rand() * 62 + clock * 0.9) * k * (type === "gold" ? 1.45 : 1),
        sway: 12 + env.rand() * 26, phase: env.rand() * TAU, freq: 0.8 + env.rand() * 1.2,
        color: type === "bomb" ? "#23262b" : type === "gold" ? "#ffd23f" : COLORS[Math.floor(env.rand() * COLORS.length)],
        x0: 0, dead: false,
      });
      balloons[balloons.length - 1].x0 = balloons[balloons.length - 1].x;
    };

    const burst = (b) => {
      const n = b.type === "bomb" ? 22 : 14;
      for (let i = 0; i < n; i += 1) {
        const a = env.rand() * TAU, sp = (120 + env.rand() * 260) * k;
        parts.push({ x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60 * k, life: 0.55 + env.rand() * 0.3, max: 0.85, color: b.type === "bomb" ? (i % 2 ? "#ff7a1a" : "#ffd23f") : b.color, size: (3 + env.rand() * 4) * k });
      }
    };

    const pop = (b) => {
      b.dead = true; burst(b);
      if (b.type === "bomb") {
        score = Math.max(0, score + BOMB_SCORE); combo = 0; timeLeft = Math.max(0, timeLeft + BOMB_TIME_S * -1);
        shake = 0.35; bombFlash = 0.35; sfx.bad();
        floaters.push({ x: b.x, y: b.y, str: `${BOMB_SCORE}  −${BOMB_TIME_S}s`, life: 1, color: "#ff6b6b" });
        env.report(score, false);
        return;
      }
      combo = clock - lastPopT <= COMBO_WINDOW_S ? combo + 1 : 1;
      lastPopT = clock;
      const mult = Math.min(MAX_MULTIPLIER, 1 + Math.floor(combo / 3));
      const gain = (b.type === "gold" ? 5 : 1) * mult;
      score += gain; popped += 1;
      if (b.type === "gold") sfx.gold(); else sfx.pop();
      floaters.push({ x: b.x, y: b.y, str: "+" + gain, life: 0.9, color: b.type === "gold" ? "#ffd23f" : "#fff" });
      env.report(score, false);
    };

    const tipsOf = (frame) => frame.hands.map((h) => ({ x: h[HAND.INDEX_TIP].x * W, y: h[HAND.INDEX_TIP].y * H }));

    return {
      get tips() { return prevTips; },
      update(dt, frame) {
        clock += dt; phaseT += dt;
        const tips = tipsOf(frame);
        if (phase === "ready") {
          if (!tips.length) { phaseT = 0; lastCount = COUNTDOWN_S + 1; }
          const left = COUNTDOWN_S - phaseT;
          const shown = Math.max(1, Math.ceil(left));
          if (tips.length && shown !== lastCount && left > 0) { lastCount = shown; sfx.tick(); }
          if (tips.length && left <= 0) { phase = "play"; phaseT = 0; sfx.go(); }
        } else if (phase === "play") {
          timeLeft -= dt;
          spawnT -= dt;
          if (spawnT <= 0) { spawn(); spawnT = clamp(0.95 - (ROUND_S - timeLeft) * 0.0085, 0.42, 0.95) * (0.7 + env.rand() * 0.6); }
          balloons.forEach((b) => {
            b.y += b.vy * dt;
            b.x = b.x0 + Math.sin(clock * b.freq + b.phase) * b.sway * k;
            tips.forEach((tip, i) => {
              const from = prevTips[i] || tip;
              const dx = tip.x - from.x, dy = tip.y - from.y, len2 = dx * dx + dy * dy;
              const t = len2 ? clamp(((b.x - from.x) * dx + (b.y - from.y) * dy) / len2, 0, 1) : 0;
              if (!b.dead && Math.hypot(from.x + dx * t - b.x, from.y + dy * t - b.y) < b.r + 12 * k) pop(b);
            });
          });
          balloons = balloons.filter((b) => !b.dead && b.y > -b.r - 20);
          if (timeLeft <= 0) {
            phase = "over"; timeLeft = 0;
            env.report(score, true);
            env.over({ score, title: "Zäit eriwwer!", lines: [`${popped} Ballonen gepatzt`] });
          }
        }
        prevTips = tips;
        parts.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * k * dt; p.life -= dt; });
        parts = parts.filter((p) => p.life > 0);
        floaters.forEach((f) => { f.y -= 60 * k * dt; f.life -= dt; });
        floaters = floaters.filter((f) => f.life > 0);
        shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt); bombFlash = Math.max(0, bombFlash - dt);
      },
      draw(c) {
        c.save();
        if (shake > 0) c.translate((Math.random() - 0.5) * 14 * shake * 3, (Math.random() - 0.5) * 14 * shake * 3);
        balloons.forEach((b) => {
          c.save(); c.translate(b.x, b.y);
          c.strokeStyle = "rgba(255,255,255,.45)"; c.lineWidth = 2 * k; c.beginPath(); c.moveTo(0, b.r * 1.05); c.quadraticCurveTo(8 * k, b.r * 1.7, -4 * k, b.r * 2.3); c.stroke();
          c.fillStyle = b.color; c.beginPath(); c.ellipse(0, 0, b.r * 0.86, b.r, 0, 0, TAU); c.fill();
          c.beginPath(); c.moveTo(-5 * k, b.r * 0.98); c.lineTo(5 * k, b.r * 0.98); c.lineTo(0, b.r * 1.16); c.closePath(); c.fill();
          c.fillStyle = "rgba(255,255,255,.34)"; c.beginPath(); c.ellipse(-b.r * 0.3, -b.r * 0.35, b.r * 0.16, b.r * 0.28, -0.5, 0, TAU); c.fill();
          if (b.type === "bomb") {
            c.strokeStyle = "#ffb84d"; c.lineWidth = 3 * k; c.beginPath(); c.moveTo(0, -b.r); c.quadraticCurveTo(10 * k, -b.r - 14 * k, 18 * k, -b.r - 10 * k); c.stroke();
            c.fillStyle = Math.sin(clock * 18) > 0 ? "#ff5d3d" : "#ffd23f"; c.beginPath(); c.arc(18 * k, -b.r - 10 * k, 6 * k, 0, TAU); c.fill();
            c.strokeStyle = "#fff"; c.lineWidth = 4 * k; c.lineCap = "round";
            [-1, 1].forEach((s) => { c.beginPath(); c.moveTo(s * b.r * 0.4 - 7 * k, -4 * k); c.lineTo(s * b.r * 0.4 + 7 * k, 10 * k); c.moveTo(s * b.r * 0.4 + 7 * k, -4 * k); c.lineTo(s * b.r * 0.4 - 7 * k, 10 * k); c.stroke(); });
          }
          if (b.type === "gold") { c.fillStyle = "rgba(255,255,255,.9)"; c.font = `800 ${Math.round(b.r * 0.9)}px system-ui`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("5", 0, 2 * k); }
          c.restore();
        });
        parts.forEach((p) => { c.globalAlpha = clamp(p.life / p.max, 0, 1); c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size, 0, TAU); c.fill(); });
        c.globalAlpha = 1;
        floaters.forEach((f) => { c.globalAlpha = clamp(f.life * 1.4, 0, 1); text(c, f.str, f.x, f.y, { size: 34 * k, color: f.color, align: "center" }); });
        c.globalAlpha = 1;
        prevTips.forEach((tip) => {
          c.strokeStyle = "rgba(255,255,255,.95)"; c.lineWidth = 4 * k; c.beginPath(); c.arc(tip.x, tip.y, 17 * k, 0, TAU); c.stroke();
          c.fillStyle = "rgba(109,240,176,.55)"; c.beginPath(); c.arc(tip.x, tip.y, 12 * k, 0, TAU); c.fill();
        });
        c.restore();
        if (bombFlash > 0) { c.fillStyle = `rgba(255,80,60,${bombFlash})`; c.fillRect(0, 0, W, H); }
        // HUD
        const mult = Math.min(MAX_MULTIPLIER, 1 + Math.floor(combo / 3));
        pill(c, 14, 14, 190 * k + 20, 46 * k); text(c, "Punkten " + score, 30, 14 + 32 * k, { size: 26 * k });
        pill(c, W - 14 - (160 * k + 20), 14, 160 * k + 20, 46 * k); text(c, Math.ceil(timeLeft) + " s", W - 30, 14 + 32 * k, { size: 26 * k, align: "right", color: timeLeft <= 10 ? "#ff8a8a" : "#fff" });
        if (mult > 1 && phase === "play") text(c, `Kombo x${mult}`, W / 2, 46 * k, { size: 30 * k, align: "center", color: "#ffd23f" });
        if (phase === "ready") {
          if (!prevTips.length) text(c, "Weis mir deng Hand", W / 2, H / 2, { size: 44 * k, align: "center" });
          else text(c, String(Math.max(1, Math.ceil(COUNTDOWN_S - phaseT))), W / 2, H / 2 + 30 * k, { size: 120 * k, align: "center" });
        }
      },
      debug() {
        return { phase, score, combo, timeLeft, popped, tips: prevTips.length, balloons: balloons.map((b) => ({ x: b.x / W, y: b.y / H, type: b.type, r: b.r })) };
      },
    };
  },
};
