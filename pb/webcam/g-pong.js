/* Hand-Pong: two paddles, one camera. The hand on the left of the picture moves the left paddle, the hand on the right the right paddle.
 * Two friends side by side, or one player with both hands. No score is saved. */
import { palmCenter, text, pill, sfx, clamp, TAU } from "./core.js?v=1";

const WIN_POINTS = 7;
const PADDLE_H = 0.24;          // of the height
const PADDLE_W = 0.022;         // of the width
const START_SPEED = 0.62;       // widths per second
const MAX_SPEED = 1.35;
const SPEEDUP = 1.06;
const FOLLOW = 14;              // paddle easing per second
const LOST_PAUSE_S = 1.2;       // the ball waits when a human hand has been missing this long
const SERVE_S = 1.1;
const AI_SPEED = 0.55;          // heights per second

export default {
  id: "pong", name: "Hand-Pong", emoji: "🏓", needs: "hands", noScore: true,
  desc: "Two players, two hands, one camera",
  howto: ["Zwee Spiller niewentenee: déi lénks Hand steiert déi lénks Rakett, déi riets Hand déi riets.", "Oder ee Spiller mat béiden Hänn. Beweeg d'Hand erop an erof.", "Wien als éischt 7 Punkten huet, gewënnt."],
  options: [{ key: "mode", label: "Modus", values: ["2 Spiller", "Géint Computer"], def: "2 Spiller" }],
  board: () => null,
  create(env) {
    const { W, H } = env;
    const k = H / 720;
    const ai = env.opts.mode === "Géint Computer";
    const ph = PADDLE_H * H, pw = PADDLE_W * W, r = 13 * k;
    let phase = "wait", t = 0, left = 0, right = 0, ly = H / 2, ry = H / 2, tl = H / 2, tr = H / 2, servedTo = 1, speed = START_SPEED, lostFor = 0;
    let ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 }, trail = [], seen = { l: false, r: false }, hands = 0, who = "", flash = 0;

    const serve = (dir) => {
      const angle = (env.rand() - 0.5) * 0.7;
      speed = START_SPEED;
      ball = { x: W / 2, y: H / 2, vx: Math.cos(angle) * dir * speed * W, vy: Math.sin(angle) * speed * W };
      trail = [];
    };
    const countdown = () => { phase = "serve"; t = 0; ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 }; trail = []; };

    return {
      update(dt, frame) {
        t += dt; flash = Math.max(0, flash - dt);
        const found = frame.hands.map((h) => palmCenter(h)).sort((a, b) => a.x - b.x);
        hands = found.length;
        let leftHand = null, rightHand = null;
        if (ai) { leftHand = found[0] || null; }
        else if (found.length >= 2) { leftHand = found[0]; rightHand = found[found.length - 1]; }
        else if (found.length === 1) { if (found[0].x < 0.5) leftHand = found[0]; else rightHand = found[0]; }
        if (leftHand) { tl = leftHand.y * H; seen.l = true; }
        if (rightHand) { tr = rightHand.y * H; seen.r = true; }
        if (ai) {
          const dy = ball.y - tr, maxStep = AI_SPEED * H * dt;
          if (phase === "play" && ball.vx > 0) tr += clamp(dy, -maxStep, maxStep);
          else tr += clamp(H / 2 - tr, -maxStep * 0.4, maxStep * 0.4);
          seen.r = true; rightHand = { y: tr / H };
        }
        const ease = 1 - Math.exp(-FOLLOW * dt);
        ly += (tl - ly) * ease; ry += (tr - ry) * ease;
        ly = clamp(ly, ph / 2, H - ph / 2); ry = clamp(ry, ph / 2, H - ph / 2);
        const needLeft = !leftHand, needRight = !rightHand;
        who = needLeft && needRight ? "Hänn" : needLeft ? "lénks" : needRight ? "riets" : "";
        if (phase === "wait") {
          if (seen.l && seen.r && !needLeft && !needRight) { countdown(); }
          return;
        }
        if (phase === "serve") {
          if (t >= SERVE_S + 2) { phase = "play"; serve(servedTo); sfx.go(); }
          else if (Math.ceil(SERVE_S + 2 - t) !== Math.ceil(SERVE_S + 2 - t + dt)) sfx.tick();
          return;
        }
        if (phase === "play") {
          if (needLeft || needRight) lostFor += dt; else lostFor = 0;
          if (lostFor > LOST_PAUSE_S) return;   // wait for the missing hand
          trail.push({ x: ball.x, y: ball.y }); if (trail.length > 10) trail.shift();
          ball.x += ball.vx * dt; ball.y += ball.vy * dt;
          if (ball.y < r) { ball.y = r; ball.vy = Math.abs(ball.vy); sfx.tick(); }
          if (ball.y > H - r) { ball.y = H - r; ball.vy = -Math.abs(ball.vy); sfx.tick(); }
          const lx = 26 * k + pw, rx = W - 26 * k - pw;
          const bounce = (paddleY, dir) => {
            const rel = clamp((ball.y - paddleY) / (ph / 2), -1, 1);
            speed = Math.min(MAX_SPEED, speed * SPEEDUP);
            const angle = rel * 0.95;
            ball.vx = Math.cos(angle) * dir * speed * W; ball.vy = Math.sin(angle) * speed * W;
            sfx.pop(); flash = 0.12;
          };
          if (ball.vx < 0 && ball.x - r <= lx && ball.x > lx - pw - r && Math.abs(ball.y - ly) <= ph / 2 + r) { ball.x = lx + r; bounce(ly, 1); }
          if (ball.vx > 0 && ball.x + r >= rx && ball.x < rx + pw + r && Math.abs(ball.y - ry) <= ph / 2 + r) { ball.x = rx - r; bounce(ry, -1); }
          if (ball.x < -r || ball.x > W + r) {
            if (ball.x < 0) { right += 1; servedTo = -1; } else { left += 1; servedTo = 1; }
            sfx.bad();
            if (left >= WIN_POINTS || right >= WIN_POINTS) {
              phase = "over";
              const leftWon = left > right;
              env.over({ score: 0, title: ai ? (leftWon ? "Du gewënns!" : "De Computer gewënnt") : (leftWon ? "De lénke Spiller gewënnt!" : "De riets Spiller gewënnt!"), lines: [`${left} : ${right}`], hideScore: true });
            } else countdown();
          }
        }
      },
      draw(c) {
        const lx = 26 * k, rx = W - 26 * k - pw;
        c.strokeStyle = "rgba(255,255,255,.3)"; c.lineWidth = 3 * k; c.setLineDash([14 * k, 14 * k]); c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.stroke(); c.setLineDash([]);
        const paddle = (x, y, color, active) => { c.fillStyle = color; c.globalAlpha = active ? 1 : 0.45; c.beginPath(); c.roundRect(x, y - ph / 2, pw, ph, pw / 2); c.fill(); c.globalAlpha = 1; };
        paddle(lx, ly, "#6df0b0", seen.l && who !== "lénks" && who !== "Hänn");
        paddle(rx, ry, "#ffb84d", seen.r && who !== "riets" && who !== "Hänn");
        trail.forEach((p, i) => { c.globalAlpha = (i + 1) / trail.length * 0.4; c.fillStyle = "#fff"; c.beginPath(); c.arc(p.x, p.y, r * (i + 1) / trail.length, 0, TAU); c.fill(); });
        c.globalAlpha = 1; c.fillStyle = flash > 0 ? "#fff6a8" : "#fff"; c.beginPath(); c.arc(ball.x, ball.y, r, 0, TAU); c.fill();
        text(c, String(left), W / 2 - 90 * k, 80 * k, { size: 72 * k, align: "center", color: "#6df0b0" });
        text(c, String(right), W / 2 + 90 * k, 80 * k, { size: 72 * k, align: "center", color: "#ffb84d" });
        if (phase === "wait") {
          text(c, ai ? "Weis mir deng Hand" : "Zwou Hänn an d'Bild, eng lénks an eng riets", W / 2, H / 2 - 10 * k, { size: 38 * k, align: "center" });
        } else if (phase === "serve") {
          text(c, String(Math.max(1, Math.ceil(SERVE_S + 2 - t))), W / 2, H / 2 + 40 * k, { size: 120 * k, align: "center" });
        } else if (phase === "play" && lostFor > LOST_PAUSE_S) {
          pill(c, W / 2 - 230 * k, H - 70 * k, 460 * k, 48 * k);
          text(c, who === "Hänn" ? "Ech gesinn keng Hand" : `Déi ${who} Hand feelt`, W / 2, H - 70 * k + 33 * k, { size: 24 * k, align: "center", color: "#ffd23f" });
        }
        text(c, ai ? "Du" : "Lénks", 30 * k, H - 52 * k, { size: 22 * k, color: "#6df0b0" });
        text(c, ai ? "Computer" : "Riets", W - 30 * k, H - 52 * k, { size: 22 * k, align: "right", color: "#ffb84d" });
      },
      debug() { return { phase, left, right, ball: { x: ball.x / W, y: ball.y / H, vx: ball.vx / W, vy: ball.vy / W }, paddles: { l: ly / H, r: ry / H }, hands, who, ai }; },
    };
  },
};
