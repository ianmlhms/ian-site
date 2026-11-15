/* Loftmolerei: draw in the air by pinching thumb and index. Shape mode asks for a shape and scores your drawing; free mode just draws (save as PNG). */
import { HAND, isPinching, text, pill, sfx, clamp, TAU } from "./core.js?v=1";

const ROUNDS = 5;
const DRAW_TIME_S = 30;
const SUBMIT_IDLE_S = 1.5;
const MIN_POINTS = 14;
const MIN_SIZE = 0.16;          // of the height: smaller drawings score 0
const RESULT_S = 2.8;
const SCORE_FALLOFF = 0.2;     // normalized chamfer distance that scores 0
const SMOOTH = 0.55;
const MIN_STEP = 2.5;
const COLORS = ["#ffffff", "#6df0b0", "#ffd23f", "#ff6b8a", "#7aa2ff", "#c77dff"];

const circle = Array.from({ length: 49 }, (_, i) => ({ x: Math.cos(i / 48 * TAU), y: Math.sin(i / 48 * TAU) }));
const star10 = Array.from({ length: 11 }, (_, i) => { const a = -Math.PI / 2 + (i % 10) * Math.PI / 5, rad = i % 2 ? 0.42 : 1; return { x: Math.cos(a) * rad, y: Math.sin(a) * rad }; });
const pentagram = Array.from({ length: 6 }, (_, i) => { const a = -Math.PI / 2 + (i % 5) * 4 * Math.PI / 5; return { x: Math.cos(a), y: Math.sin(a) }; });
const heart = Array.from({ length: 61 }, (_, i) => { const a = i / 60 * TAU; return { x: 16 * Math.sin(a) ** 3, y: -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) }; });
const P = (...xy) => xy.map(([x, y]) => ({ x, y }));

/** Every shape has one or more acceptable reference drawings (each a list of polylines). */
export const SHAPES = Object.freeze([
  { id: "circle", name: "Krees", refs: [[circle]] },
  { id: "star", name: "Stär", refs: [[star10], [pentagram]] },
  { id: "house", name: "Haus", refs: [[P([0, 0.45], [0.5, 0], [1, 0.45], [1, 1], [0, 1], [0, 0.45])], [P([0, 0.45], [0.5, 0], [1, 0.45], [0, 0.45], [0, 1], [1, 1], [1, 0.45])]] },
  { id: "heart", name: "Häerz", refs: [[heart]] },
  { id: "L", name: "De Buschtaf L", refs: [[P([0, 0], [0, 1], [0.6, 1])]] },
  { id: "triangle", name: "Dräieck", refs: [[P([0.5, 0], [1, 1], [0, 1], [0.5, 0])]] },
  { id: "arrow", name: "Feil", refs: [[P([0, 0.5], [1, 0.5]), P([0.7, 0.2], [1, 0.5], [0.7, 0.8])], [P([0, 0.5], [1, 0.5], [0.7, 0.2]), P([1, 0.5], [0.7, 0.8])]] },
  { id: "bolt", name: "Blëtz", refs: [[P([0.6, 0], [0.2, 0.55], [0.5, 0.55], [0.35, 1], [0.8, 0.4], [0.5, 0.4], [0.6, 0])]] },
]);

const segLen = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** n points spread evenly along the polylines (segments between separate polylines are not part of the path). */
export function resample(polylines, n) {
  const segs = [];
  polylines.forEach((pl) => { for (let i = 1; i < pl.length; i += 1) segs.push([pl[i - 1], pl[i]]); });
  const total = segs.reduce((s, [a, b]) => s + segLen(a, b), 0);
  if (!segs.length || total === 0) return polylines.flat().slice(0, n);
  const step = total / n, out = [];
  let acc = 0, target = 0;
  segs.forEach(([a, b]) => {
    const len = segLen(a, b);
    while (target <= acc + len && out.length < n) { const f = len ? (target - acc) / len : 0; out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }); target += step; }
    acc += len;
  });
  return out;
}

const bboxOf = (pts) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY, size: Math.max(maxX - minX, maxY - minY, 1e-6), cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
};
const normalizeBy = (pts, b) => pts.map((p) => ({ x: (p.x - b.cx) / b.size, y: (p.y - b.cy) / b.size }));

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
const distToPolylines = (p, polylines) => {
  let best = Infinity;
  polylines.forEach((pl) => { for (let i = 1; i < pl.length; i += 1) best = Math.min(best, distToSegment(p, pl[i - 1], pl[i])); if (pl.length === 1) best = Math.min(best, Math.hypot(p.x - pl[0].x, p.y - pl[0].y)); });
  return best;
};

/** Score 0..100: how close the strokes are to the shape, whatever the position or size (symmetric chamfer distance on size-normalised paths). */
export function scoreShape(strokes, shape) {
  const clean = strokes.filter((s) => s.length > 1);
  const all = clean.flat();
  if (all.length < MIN_POINTS) return { score: 0, distance: 1 };
  const userBox = bboxOf(all);
  const userNorm = clean.map((s) => normalizeBy(s, userBox));
  const userDense = resample(userNorm, 110);
  let best = Infinity;
  shape.refs.forEach((ref) => {
    const refBox = bboxOf(ref.flat());
    const refNorm = ref.map((pl) => normalizeBy(pl, refBox));
    const refDense = resample(refNorm, 160);
    // root mean square: a missing part of the shape (the head of an arrow) hurts more than a wobbly line
    const a = Math.sqrt(userDense.reduce((s, p) => s + distToPolylines(p, refNorm) ** 2, 0) / userDense.length);
    const b = Math.sqrt(refDense.reduce((s, p) => s + distToPolylines(p, userNorm) ** 2, 0) / refDense.length);
    best = Math.min(best, Math.max(a, b));
  });
  return { score: Math.round(100 * Math.pow(clamp(1 - best / SCORE_FALLOFF, 0, 1), 1.2)), distance: best };
}

const strokeLength = (s) => { let l = 0; for (let i = 1; i < s.length; i += 1) l += segLen(s[i - 1], s[i]); return l; };

export default {
  id: "draw", name: "Loftmolerei", emoji: "🖌️", needs: "hands",
  desc: "Draw shapes in the air by pinching",
  howto: ["Halt eng Hand an d'Kamera. Kniff Daum an Zeigefanger zesummen fir ze molen, loos lass fir ze stoppen.", "Formen: d'Spill freet no enger Form (Krees, Stär, Haus …). Zeechne se, dann kriss de Punkten.", "Fräi: einfach molen a nom Zeechnen als PNG späicheren."],
  options: [{ key: "mode", label: "Modus", values: ["Formen", "Fräi"], def: "Formen" }],
  board: (opts) => (opts.mode === "Formen" ? { id: "webcam-draw", name: "Loftmolerei" } : null),
  create(env) {
    const { W, H } = env;
    const k = H / 720;
    const free = env.opts.mode === "Fräi";
    let strokes = [], current = null, pinching = false, cursor = null, smooth = null, color = COLORS[0], width = 8 * k, idle = 0, hoverChip = -1, hoverT = 0;
    let phase = free ? "free" : "intro", clock = 0, round = 0, deck = [], shape = null, timeLeft = DRAW_TIME_S, total = 0, results = [], resultT = 0, last = null;
    if (!free) { deck = [...SHAPES].sort(() => env.rand() - 0.5).slice(0, ROUNDS); shape = deck[0]; }

    const clear = () => { strokes = []; current = null; idle = 0; };
    const start = () => { shape = deck[round]; clear(); timeLeft = DRAW_TIME_S; phase = "draw"; sfx.go(); };
    const submit = () => {
      if (phase !== "draw") return;
      const tooSmall = !strokes.length || bboxOf(strokes.flat()).size < MIN_SIZE * H;
      const r = tooSmall ? { score: 0, distance: 1 } : scoreShape(strokes, shape);
      last = { ...r, small: tooSmall, shape, strokes: strokes.map((s) => s.map((p) => ({ ...p }))) };
      total += r.score; results.push(r.score); phase = "result"; resultT = 0;
      if (r.score >= 70) sfx.win(); else if (r.score >= 40) sfx.gold(); else sfx.bad();
      env.report(total, false);
    };
    const chipPos = (i) => ({ x: 34 * k, y: 110 * k + i * 58 * k, r: 20 * k });

    const exportPng = () => new Promise((resolve) => {
      const out = document.createElement("canvas"); out.width = W; out.height = H;
      const c = out.getContext("2d"); c.fillStyle = "#101214"; c.fillRect(0, 0, W, H); c.lineCap = "round"; c.lineJoin = "round";
      strokes.forEach((s) => { c.strokeStyle = s.color || "#fff"; c.lineWidth = s.width || width; c.beginPath(); s.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); if (s.length === 1) c.lineTo(s[0].x + 0.1, s[0].y); c.stroke(); });
      if (out.toBlob) out.toBlob((blob) => resolve(blob), "image/png"); else resolve(null);
    });
    const savePng = async () => {
      const blob = await exportPng();
      if (!blob) { env.toast("Späicheren net méiglech"); return; }
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "loftmolerei.png"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      env.toast("PNG gespäichert");
    };

    const toolbar = free
      ? [...COLORS.map((col) => ({ label: "", color: col, title: "Faarf", onClick: () => { color = col; } })), { label: "Dënn/Déck", onClick: () => { width = width > 10 * k ? 6 * k : 14 * k; } }, { label: "Zréck", onClick: () => { strokes.pop(); } }, { label: "Läschen", onClick: clear }, { label: "PNG späicheren", onClick: savePng, primary: true }]
      : [{ label: "Nei zeechnen", onClick: () => { if (phase === "draw") clear(); } }, { label: "Fäerdeg", onClick: submit, primary: true }];

    return {
      toolbar, exportPng, savePng,
      update(dt, frame) {
        clock += dt;
        const hand = frame.hands[0];
        if (hand) {
          const a = hand[HAND.THUMB_TIP], b = hand[HAND.INDEX_TIP];
          const raw = { x: (a.x + b.x) / 2 * W, y: (a.y + b.y) / 2 * H };
          smooth = smooth ? { x: smooth.x + (raw.x - smooth.x) * SMOOTH, y: smooth.y + (raw.y - smooth.y) * SMOOTH } : raw;
          cursor = pinching ? smooth : { x: hand[HAND.INDEX_TIP].x * W, y: hand[HAND.INDEX_TIP].y * H };
          const was = pinching;
          pinching = isPinching(hand, pinching, frame.aspect);
          if (pinching && !was) smooth = raw;
        } else { pinching = false; cursor = null; smooth = null; }
        const canDraw = phase === "free" || phase === "draw";
        if (canDraw && pinching && smooth) {
          if (!current) { current = [{ ...smooth }]; current.color = color; current.width = width; strokes.push(current); }
          else if (segLen(current[current.length - 1], smooth) >= MIN_STEP * k) current.push({ ...smooth });
          idle = 0;
        } else if (current) { current = null; }
        if (free) {
          hoverChip = -1;
          if (cursor && !pinching) COLORS.forEach((_, i) => { const p = chipPos(i); if (Math.hypot(cursor.x - p.x, cursor.y - p.y) < p.r + 14 * k) hoverChip = i; });
          hoverT = hoverChip >= 0 ? hoverT + dt : 0;
          if (hoverChip >= 0 && hoverT > 0.45) { color = COLORS[hoverChip]; hoverT = 0; }
          return;
        }
        if (phase === "intro") { if (clock > 2.2 || (hand && clock > 1)) { clock = 0; start(); } return; }
        if (phase === "draw") {
          timeLeft -= dt;
          const points = strokes.reduce((s, st) => s + st.length, 0);
          if (!pinching && points >= MIN_POINTS) idle += dt; else if (pinching) idle = 0;
          if (idle >= SUBMIT_IDLE_S || timeLeft <= 0) submit();
        } else if (phase === "result") {
          resultT += dt;
          if (resultT >= RESULT_S) {
            round += 1;
            if (round >= ROUNDS) { phase = "over"; env.report(total, true); env.over({ score: total, title: "Fäerdeg!", lines: [results.join(" + ") + " = " + total, "Maximal 500"] }); }
            else { clock = 0; phase = "intro"; shape = deck[round]; }
          }
        }
      },
      draw(c) {
        const drawStroke = (s, col, wd, alpha = 1) => {
          if (!s.length) return;
          c.save(); c.globalAlpha = alpha; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = col; c.lineWidth = wd; c.shadowColor = col; c.shadowBlur = 12 * k;
          c.beginPath(); s.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); if (s.length === 1) c.lineTo(s[0].x + 0.1, s[0].y); c.stroke(); c.restore();
        };
        strokes.forEach((s) => drawStroke(s, s.color || "#fff", s.width || width));
        const ref = (sh, ox, oy, size, col, wd, dash) => {
          const refs = sh.refs[0], box = bboxOf(refs.flat());
          c.save(); c.strokeStyle = col; c.lineWidth = wd; c.lineCap = "round"; c.lineJoin = "round"; if (dash) c.setLineDash(dash);
          refs.forEach((pl) => { c.beginPath(); pl.forEach((p, i) => { const x = ox + (p.x - box.cx) / box.size * size, y = oy + (p.y - box.cy) / box.size * size; if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke(); });
          c.restore();
        };
        if (cursor) {
          c.save(); c.strokeStyle = pinching ? color : "#fff"; c.lineWidth = 4 * k; c.beginPath(); c.arc(cursor.x, cursor.y, (pinching ? 11 : 18) * k, 0, TAU); c.stroke();
          if (pinching) { c.fillStyle = color; c.beginPath(); c.arc(cursor.x, cursor.y, 6 * k, 0, TAU); c.fill(); }
          c.restore();
        }
        if (free) {
          COLORS.forEach((col, i) => {
            const p = chipPos(i);
            c.fillStyle = col; c.beginPath(); c.arc(p.x, p.y, p.r, 0, TAU); c.fill();
            c.strokeStyle = col === color ? "#6df0b0" : "rgba(0,0,0,.5)"; c.lineWidth = col === color ? 5 * k : 2 * k; c.beginPath(); c.arc(p.x, p.y, p.r + 4 * k, 0, TAU); c.stroke();
            if (i === hoverChip) { c.strokeStyle = "#fff"; c.lineWidth = 4 * k; c.beginPath(); c.arc(p.x, p.y, p.r + 9 * k, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(hoverT / 0.45, 0, 1)); c.stroke(); }
          });
          pill(c, W / 2 - 260 * k, 14, 520 * k, 46 * k);
          text(c, pinching ? "Du moles" : "Kniff Daum + Zeigefanger fir ze molen", W / 2, 14 + 32 * k, { size: 22 * k, align: "center", weight: 600 });
          return;
        }
        pill(c, 14, 14, 200 * k, 46 * k); text(c, "Punkten " + total, 30, 14 + 32 * k, { size: 24 * k });
        pill(c, W - 14 - 200 * k, 14, 200 * k, 46 * k); text(c, `Form ${Math.min(round + 1, ROUNDS)}/${ROUNDS}`, W - 30, 14 + 32 * k, { size: 24 * k, align: "right" });
        if (phase === "intro" && shape) {
          text(c, "Zeechen:", W / 2, H * 0.28, { size: 38 * k, align: "center", weight: 600 });
          text(c, shape.name, W / 2, H * 0.28 + 64 * k, { size: 64 * k, align: "center", color: "#6df0b0" });
          ref(shape, W / 2, H * 0.62, 190 * k, "rgba(255,255,255,.85)", 6 * k);
        }
        if (phase === "draw" && shape) {
          pill(c, W / 2 - 190 * k, 14, 380 * k, 46 * k);
          text(c, `${shape.name}  ·  ${Math.ceil(timeLeft)} s`, W / 2, 14 + 32 * k, { size: 24 * k, align: "center" });
          ref(shape, W - 70 * k, 120 * k, 80 * k, "rgba(255,255,255,.55)", 3 * k);
          if (idle > 0.2) { c.strokeStyle = "#ffd23f"; c.lineWidth = 6 * k; c.beginPath(); c.arc(W / 2, H - 50 * k, 22 * k, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(idle / SUBMIT_IDLE_S, 0, 1)); c.stroke(); text(c, "Fäerdeg …", W / 2 + 40 * k, H - 42 * k, { size: 22 * k, weight: 600 }); }
        }
        if (phase === "result" && last) {
          const box = last.strokes.length ? bboxOf(last.strokes.flat()) : { cx: W / 2, cy: H / 2, size: H * 0.4 };
          if (!last.small) ref(last.shape, box.cx, box.cy, box.size, "rgba(109,240,176,.9)", 4 * k, [12 * k, 10 * k]);
          const grade = last.small ? "Ze kleng" : last.score >= 85 ? "Fantastesch!" : last.score >= 65 ? "Super!" : last.score >= 40 ? "Net schlecht" : "Nach eng Kéier";
          pill(c, W / 2 - 220 * k, H - 130 * k, 440 * k, 90 * k, "rgba(10,12,14,.78)");
          text(c, `${last.score} / 100`, W / 2, H - 130 * k + 46 * k, { size: 44 * k, align: "center", color: last.score >= 65 ? "#6df0b0" : "#ffd23f" });
          text(c, grade, W / 2, H - 130 * k + 78 * k, { size: 22 * k, align: "center", weight: 600 });
        }
      },
      debug() {
        return { phase, free, round, total, results, shape: shape && shape.id, pinching, strokes: strokes.length, points: strokes.reduce((s, st) => s + st.length, 0), timeLeft, last: last && { score: last.score, small: last.small }, color, length: strokes.reduce((s, st) => s + strokeLength(st), 0) };
      },
    };
  },
};

