/* Steen, Pabeier, Schéier: best-of-N against the computer. The gesture is read from the hand landmarks. */
import { classifyHand, text, pill, sfx, TAU } from "./core.js?v=1";

const BEAT_S = 0.75;          // 3 beats (Steen, Pabeier, Schéier), then the shoot moment
const SAMPLE_BEFORE_S = 0.4;  // the hand is read over a short window around the shoot moment
const SAMPLE_AFTER_S = 0.2;
const MIN_VOTES = 2;
const REVEAL_S = 1.9;
const WIN_SCORE = 10;
const MATCH_BONUS = 20;
const WORD = { rock: "Steen", paper: "Pabeier", scissors: "Schéier", unknown: "?" };
const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };   // key beats value
const KINDS = ["rock", "paper", "scissors"];

/** Vector hand sign: fist, flat hand or two fingers. */
function drawSign(c, kind, cx, cy, size, color, alpha = 1) {
  c.save(); c.translate(cx, cy); c.globalAlpha = alpha; c.fillStyle = color; c.strokeStyle = color; c.lineCap = "round"; c.lineJoin = "round";
  const u = size / 100;
  const finger = (x, len, w, ang = 0) => { c.save(); c.translate(x * u, -10 * u); c.rotate(ang); c.lineWidth = w * u; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -len * u); c.stroke(); c.restore(); };
  if (kind === "rock") {
    c.beginPath(); c.roundRect(-34 * u, -30 * u, 68 * u, 62 * u, 20 * u); c.fill();
    c.fillStyle = "rgba(0,0,0,.28)"; [-17, 0, 17].forEach((x) => { c.beginPath(); c.moveTo(x * u, -30 * u); c.lineTo(x * u, -6 * u); c.lineWidth = 3 * u; c.strokeStyle = "rgba(0,0,0,.28)"; c.stroke(); });
    c.fillStyle = color; c.beginPath(); c.ellipse(-36 * u, 6 * u, 12 * u, 18 * u, -0.4, 0, TAU); c.fill();
  } else if (kind === "paper") {
    c.beginPath(); c.roundRect(-30 * u, -8 * u, 60 * u, 52 * u, 14 * u); c.fill();
    finger(-22, 52, 14, -0.1); finger(-7, 62, 14); finger(8, 58, 14); finger(22, 46, 13, 0.1);
    c.save(); c.translate(-30 * u, 18 * u); c.rotate(-0.9); c.lineWidth = 14 * u; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -36 * u); c.stroke(); c.restore();
  } else if (kind === "scissors") {
    c.beginPath(); c.roundRect(-26 * u, -4 * u, 52 * u, 48 * u, 14 * u); c.fill();
    finger(-10, 70, 14, -0.28); finger(10, 70, 14, 0.28);
    c.beginPath(); c.arc(-4 * u, 12 * u, 9 * u, 0, TAU); c.fillStyle = "rgba(0,0,0,.25)"; c.fill();
  } else {
    c.font = `800 ${Math.round(size * 0.9)}px system-ui`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("?", 0, 0);
  }
  c.restore();
}

export default {
  id: "rps", name: "Steen, Pabeier, Schéier", emoji: "✊", needs: "hands",
  desc: "Rock, paper, scissors against the computer",
  howto: ["Halt eng Hand an d'Kamera.", "Nom Countdown (Steen … Pabeier … Schéier … LOS!) weis Steen (Fauscht), Pabeier (oppen Hand) oder Schéier (zwee Fanger).", "Wie fir d'éischt d'Mehrheet vun de Ronnen huet, gewënnt de Match."],
  options: [{ key: "bestOf", label: "Best of", values: [3, 5], def: 3 }],
  board: (opts) => ({ id: "webcam-rps-" + opts.bestOf, name: `Steen Pabeier Schéier (best of ${opts.bestOf})` }),
  create(env) {
    const { W, H } = env;
    const k = H / 720;
    const target = Math.ceil(env.opts.bestOf / 2);
    let phase = "wait", t = 0, you = 0, cpu = 0, round = 1, yourPick = "unknown", cpuPick = "rock", outcome = "", votes = {}, live = "unknown", lastBeat = -1;
    const history = [];

    const chooseCpu = () => {
      if (history.length && env.rand() < 0.4) {
        const counts = { rock: 0, paper: 0, scissors: 0 };
        history.forEach((h) => { counts[h] += 1; });
        const favourite = KINDS.reduce((a, b) => (counts[b] > counts[a] ? b : a), "rock");
        return KINDS.find((kind) => BEATS[kind] === favourite);   // the sign that beats the player's favourite
      }
      return KINDS[Math.floor(env.rand() * 3)];
    };

    const beginCount = () => { phase = "count"; t = 0; votes = {}; lastBeat = -1; cpuPick = chooseCpu(); };

    const resolve = () => {
      const tally = Object.entries(votes).filter(([kind]) => kind !== "unknown").sort((a, b) => b[1] - a[1])[0];
      yourPick = tally && tally[1] >= MIN_VOTES ? tally[0] : "unknown";
      phase = "reveal"; t = 0;
      if (yourPick === "unknown") { outcome = "retry"; sfx.bad(); return; }
      history.push(yourPick);
      if (yourPick === cpuPick) outcome = "draw";
      else if (BEATS[yourPick] === cpuPick) { outcome = "win"; you += 1; sfx.win(); }
      else { outcome = "lose"; cpu += 1; sfx.lose(); }
      env.report(you * WIN_SCORE, false);
    };

    return {
      update(dt, frame) {
        t += dt;
        const hand = frame.hands[0];
        live = hand ? classifyHand(hand, frame.aspect).kind : "unknown";
        if (phase === "wait") {
          if (hand && t > 0.6) beginCount();
          if (!hand) t = 0;
        } else if (phase === "count") {
          const beat = Math.min(3, Math.floor(t / BEAT_S));
          if (beat !== lastBeat) { lastBeat = beat; if (beat < 3) sfx.tick(); else sfx.go(); }
          const shootAt = BEAT_S * 3 + 0.35;
          if (t >= shootAt - SAMPLE_BEFORE_S && t <= shootAt + SAMPLE_AFTER_S && hand) votes[live] = (votes[live] || 0) + 1;
          if (t > shootAt + SAMPLE_AFTER_S) resolve();
        } else if (phase === "reveal" && t > REVEAL_S) {
          const finished = you >= target || cpu >= target;
          if (finished) {
            phase = "over";
            const won = you >= target;
            const score = you * WIN_SCORE + (won ? MATCH_BONUS : 0);
            env.report(score, true);
            env.over({ score, title: won ? "Du hues gewonnen!" : "De Computer gewënnt", lines: [`${you} : ${cpu}`] });
          } else { if (outcome !== "retry") round += 1; beginCount(); }
        }
      },
      draw(c) {
        pill(c, 14, 14, 250 * k, 46 * k); text(c, `Du ${you} : ${cpu} Computer`, 30, 14 + 32 * k, { size: 24 * k });
        pill(c, W - 14 - 190 * k, 14, 190 * k, 46 * k); text(c, `Rued ${round}`, W - 30, 14 + 32 * k, { size: 24 * k, align: "right" });
        // what the camera recognises right now
        pill(c, 14, H - 14 - 46 * k, 300 * k, 46 * k);
        text(c, "Ech gesinn:", 30, H - 14 - 14 * k, { size: 20 * k, weight: 600, color: "#cfd3d6" });
        text(c, WORD[live], 30 + 140 * k, H - 14 - 14 * k, { size: 26 * k, color: live === "unknown" ? "#ff9d9d" : "#6df0b0" });
        const mid = W / 2;
        if (phase === "wait") { text(c, "Weis mir deng Hand", mid, H / 2, { size: 46 * k, align: "center" }); return; }
        if (phase === "count") {
          const beat = Math.min(3, Math.floor(t / BEAT_S));
          const bob = Math.sin((t % BEAT_S) / BEAT_S * Math.PI) * 26 * k;
          drawSign(c, "rock", W * 0.74, H * 0.5 - bob, 230 * k, "#ffb84d");
          text(c, "Computer", W * 0.74, H * 0.5 + 170 * k, { size: 24 * k, align: "center", color: "#ffd9a0" });
          const words = ["Steen", "Pabeier", "Schéier", "LOS!"];
          text(c, words[beat], mid * 0.72, H * 0.5, { size: (beat === 3 ? 110 : 84) * k, align: "center", color: beat === 3 ? "#6df0b0" : "#fff" });
          return;
        }
        if (phase === "reveal" || phase === "over") {
          drawSign(c, yourPick, W * 0.27, H * 0.46, 250 * k, "#6df0b0");
          drawSign(c, cpuPick, W * 0.73, H * 0.46, 250 * k, "#ffb84d");
          text(c, "Du", W * 0.27, H * 0.46 + 175 * k, { size: 26 * k, align: "center" });
          text(c, "Computer", W * 0.73, H * 0.46 + 175 * k, { size: 26 * k, align: "center" });
          const label = { win: "Gewonnen!", lose: "Verluer", draw: "Gläichstand", retry: "Net erkannt, nach eng Kéier" }[outcome] || "";
          text(c, label, mid, H * 0.16 + 10 * k, { size: 60 * k, align: "center", color: outcome === "win" ? "#6df0b0" : outcome === "lose" ? "#ff8a8a" : "#fff" });
          text(c, `${WORD[yourPick]} ${outcome === "win" ? "schléit" : outcome === "lose" ? "verléiert géint" : "="} ${WORD[cpuPick]}`, mid, H * 0.88, { size: 28 * k, align: "center", color: "#e8eaec" });
        }
      },
      debug() { return { phase, you, cpu, round, yourPick, cpuPick, outcome, live, bestOf: env.opts.bestOf, target, t }; },
    };
  },
};
