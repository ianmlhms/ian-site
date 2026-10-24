/* Small mesh and texture helpers of the ride interiors (ghost train, bumper-car hall): merged vertex-colour meshes, textured quads, procedural canvas textures.
 * THREE comes in as `T`; nothing here runs in the node harness. */

export function makeBuilder(T) {
  const pos = [], col = [], c = new T.Color();
  const tri = (a, b, d, color) => { c.set(color); for (const p of [a, b, d]) { pos.push(p[0], p[1], p[2]); col.push(c.r, c.g, c.b); } };
  const quad = (a, b, d, e, color) => { tri(a, b, d, color); tri(a, d, e, color); };
  const ca = new T.Color(), cb = new T.Color(), cc = new T.Color();
  /** a triangle with a colour per corner (the light cones fade to black) */
  const triC = (a, b, d, c1, c2, c3) => { ca.set(c1); cb.set(c2); cc.set(c3); [[a, ca], [b, cb], [d, cc]].forEach(([p, k]) => { pos.push(p[0], p[1], p[2]); col.push(k.r, k.g, k.b); }); };
  /** an open light cone from the apex (bright) to a ring of radius r around the base centre (black), n sides */
  const cone = (apex, base, r, n, color) => {
    const ring = i => { const a = (i / n) * 6.2832; return [base[0] + Math.cos(a) * r, base[1], base[2] + Math.sin(a) * r]; };
    const apexC = new T.Color(color).multiplyScalar(0.3); for (let i = 0; i < n; i++) triC(apex, ring(i), ring(i + 1), apexC, 0x000000, 0x000000);
  };
  const box = (x, y, z, w, h, d, color) => {
    const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h / 2, y1 = y + h / 2, z0 = z - d / 2, z1 = z + d / 2;
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color); quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color); quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], color); quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color);
  };
  const ball = (x, y, z, r, color, seg = 6) => {
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg / 2; j++) {
      const a0 = (i / seg) * 6.2832, a1 = ((i + 1) / seg) * 6.2832, b0 = (j / (seg / 2)) * Math.PI, b1 = ((j + 1) / (seg / 2)) * Math.PI;
      const P = (a, b) => [x + Math.cos(a) * Math.sin(b) * r, y + Math.cos(b) * r, z + Math.sin(a) * Math.sin(b) * r];
      quad(P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1), color);
    }
  };
  const mesh = (material) => {
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(new Float32Array(pos), 3)); g.setAttribute("color", new T.BufferAttribute(new Float32Array(col), 3));
    g.computeBoundingSphere(); return new T.Mesh(g, material);
  };
  /** a box between two points (w x h cross-section) */
  const beam = (a, b2, w, h, color) => {
    const d = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]]; const L = Math.hypot(d[0], d[1], d[2]) || 1e-6; const n = [d[0] / L, d[1] / L, d[2] / L];
    const ref = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let u = [n[1] * ref[2] - n[2] * ref[1], n[2] * ref[0] - n[0] * ref[2], n[0] * ref[1] - n[1] * ref[0]]; const ul = Math.hypot(...u) || 1; u = u.map(q => q / ul * w / 2);
    let v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]; const vl = Math.hypot(...v) || 1; v = v.map(q => q / vl * h / 2);
    const P = (p, su, sv) => [p[0] + u[0] * su + v[0] * sv, p[1] + u[1] * su + v[1] * sv, p[2] + u[2] * su + v[2] * sv];
    const A = [P(a, -1, -1), P(a, 1, -1), P(a, 1, 1), P(a, -1, 1)], B = [P(b2, -1, -1), P(b2, 1, -1), P(b2, 1, 1), P(b2, -1, 1)];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(A[i], A[j], B[j], B[i], color); }
    quad(A[3], A[2], A[1], A[0], color); quad(B[0], B[1], B[2], B[3], color);
  };
  /** a closed polygon ring of beams (centre c, plane spanned by ax / ay, radius r, n segments) */
  const ring = (c, ax, ay, r, n, w, h, color) => {
    const pt = i => { const a = (i / n) * 6.2832; return [c[0] + (ax[0] * Math.cos(a) + ay[0] * Math.sin(a)) * r, c[1] + (ax[1] * Math.cos(a) + ay[1] * Math.sin(a)) * r, c[2] + (ax[2] * Math.cos(a) + ay[2] * Math.sin(a)) * r]; };
    for (let i = 0; i < n; i++) beam(pt(i), pt(i + 1), w, h, color);
  };
  return { tri, triC, cone, quad, box, ball, beam, ring, mesh, get count() { return pos.length / 9; } };
}


/** textured quads merged into one mesh per texture: quad(a, b, c, d, u0, v0, u1, v1) with corners in order (bottom-left, bottom-right, top-right, top-left) */
export function makeTexBuilder(T) {
  const pos = [], uv = [];
  const quad = (a, b, c, d, u0 = 0, v0 = 0, u1 = 1, v1 = 1) => {
    for (const [p, q] of [[a, [u0, v0]], [b, [u1, v0]], [c, [u1, v1]], [a, [u0, v0]], [c, [u1, v1]], [d, [u0, v1]]]) { pos.push(p[0], p[1], p[2]); uv.push(q[0], q[1]); }
  };
  const mesh = material => {
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(new Float32Array(pos), 3)); g.setAttribute("uv", new T.BufferAttribute(new Float32Array(uv), 2));
    g.computeBoundingSphere(); return new T.Mesh(g, material);
  };
  return { quad, mesh, get count() { return pos.length / 18; } };
}

export const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; };
export const rnd = seed => { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
export const tex = (T, c, o = {}) => { const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; if (o.repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); } t.anisotropy = 4; return t; };

/** a soft round glow (additive sprites): rgb "r,g,b" */
export function glowTexture(T, rgb = "255,255,255") {
  const [c, g] = canvas(64, 64); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.3, `rgba(${rgb},.55)`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return tex(T, c);
}

/** the bumper-car floor: dark steel plates with seams and rivets, scuffs and rubber marks, sheen of the ceiling lights (long streaks at the three UV bars) and coloured UV blobs.
 *  u = along the hall (the texture repeats twice, 13 m each), v = across (the whole depth) */
export function steelFloorTexture(T, glow = ["120,70,255", "40,200,255", "255,70,200"]) {
  const W = 1024, H = 512, [c, g] = canvas(W, H); const R = rnd(7);
  g.fillStyle = "#2a313d"; g.fillRect(0, 0, W, H);
  const plate = 128;                                                            // 1.6 m plates
  for (let y = 0; y < H; y += plate) for (let x = 0; x < W; x += plate) {
    const k = 0.9 + R() * 0.2; g.fillStyle = `rgb(${Math.round(46 * k)},${Math.round(54 * k)},${Math.round(66 * k)})`; g.fillRect(x + 2, y + 2, plate - 4, plate - 4);
    g.strokeStyle = "rgba(10,12,18,.9)"; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, plate - 3, plate - 3);
    g.strokeStyle = "rgba(150,170,200,.25)"; g.lineWidth = 1; g.strokeRect(x + 4.5, y + 4.5, plate - 9, plate - 9);
    g.fillStyle = "rgba(170,185,210,.5)"; for (const [dx, dy] of [[10, 10], [plate - 10, 10], [10, plate - 10], [plate - 10, plate - 10]]) { g.beginPath(); g.arc(x + dx, y + dy, 2.2, 0, 6.3); g.fill(); }
  }
  // scuffs: pale scratches and black rubber arcs
  for (let i = 0; i < 160; i++) { const x = R() * W, y = R() * H, l = 20 + R() * 90, a = R() * 6.28; g.strokeStyle = `rgba(200,210,230,${0.05 + R() * 0.12})`; g.lineWidth = 0.6 + R() * 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  for (let i = 0; i < 46; i++) { const x = R() * W, y = R() * H, r = 25 + R() * 70, a = R() * 6.28; g.strokeStyle = `rgba(6,7,10,${0.18 + R() * 0.3})`; g.lineWidth = 3 + R() * 6; g.beginPath(); g.arc(x, y, r, a, a + 0.5 + R() * 1.3); g.stroke(); }
  // coloured UV light pools
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 14; i++) { const x = R() * W, y = R() * H, r = 90 + R() * 150, col = glow[i % glow.length]; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${col},.30)`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  // reflections of the three ceiling light bars (long soft streaks across the hall) and of the bulb rows (dots)
  for (const [yy, col] of [[0.2, glow[0]], [0.52, glow[1]], [0.82, glow[2]]]) {
    const y = yy * H; const gr = g.createLinearGradient(0, y - 22, 0, y + 22); gr.addColorStop(0, `rgba(${col},0)`); gr.addColorStop(0.5, `rgba(${col},.55)`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(0, y - 22, W, 44);
    g.fillStyle = "rgba(255,255,255,.5)"; g.fillRect(0, y - 2, W, 4);
  }
  g.fillStyle = "rgba(255,230,170,.45)"; for (let x = 0; x < W; x += 26) for (const y of [0.09 * H, 0.37 * H, 0.67 * H, 0.95 * H]) { g.beginPath(); g.arc(x + 6, y, 3.4, 0, 6.3); g.fill(); }
  g.globalCompositeOperation = "source-over";
  const t = tex(T, c); t.wrapS = T.RepeatWrapping; t.repeat.set(2, 1); return t;
}

/** an airbrush mural: kinds 'graveyard', 'vampire', 'flames', 'moon' (horror) and 'fun' (planets, palms, stars for the bumper-car hall) */
export function airbrushTexture(T, kind, seed = 1) {
  const W = 512, H = 256, [c, g] = canvas(W, H); const R = rnd(seed * 31 + kind.length);
  const bg = { graveyard: ["#0b1030", "#3a1a5a", "#b23a6a"], vampire: ["#2a0612", "#8a1426", "#ff7a2a"], flames: ["#14040a", "#a01a10", "#ffc030"], moon: ["#050a24", "#142e68", "#6a8ad8"], fun: ["#2a0a5a", "#c81e8c", "#ffb030"], mirror: ["#16204a", "#5a8ad8", "#e8f4ff"] }[kind];
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, bg[0]); gr.addColorStop(0.55, bg[1]); gr.addColorStop(1, bg[2]); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const glowDot = (x, y, r, col) => { const q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, col); q.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = q; g.fillRect(x - r, y - r, r * 2, r * 2); };
  if (kind === "graveyard") {
    glowDot(380, 70, 110, "rgba(255,230,160,.8)"); g.fillStyle = "#f4ecc8"; g.beginPath(); g.arc(380, 70, 38, 0, 6.3); g.fill();
    g.fillStyle = "#05030c"; for (let i = 0; i < 9; i++) { const x = 20 + i * 56 + R() * 20, h = 40 + R() * 40; g.fillRect(x, H - h - 14, 26, h); g.beginPath(); g.arc(x + 13, H - h - 14, 13, Math.PI, 0); g.fill(); }
    g.fillRect(0, H - 14, W, 14); g.strokeStyle = "#05030c"; g.lineWidth = 5; for (const x of [70, 250, 470]) { g.beginPath(); g.moveTo(x, H - 14); g.lineTo(x - 6, 80); g.lineTo(x - 36, 40); g.moveTo(x - 6, 80); g.lineTo(x + 30, 50); g.stroke(); }
    g.fillStyle = "#05030c"; for (let i = 0; i < 7; i++) { const x = 40 + R() * 420, y = 30 + R() * 90; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y - 10, x + 28, y); g.quadraticCurveTo(x + 14, y + 4, x, y); g.fill(); }
  } else if (kind === "vampire") {
    glowDot(256, 130, 220, "rgba(255,90,40,.6)");
    g.fillStyle = "#e9dcc8"; g.beginPath(); g.ellipse(256, 120, 70, 92, 0, 0, 6.3); g.fill();
    g.fillStyle = "#0a0408"; g.beginPath(); g.moveTo(186, 70); g.lineTo(256, 20); g.lineTo(326, 70); g.lineTo(296, 90); g.lineTo(256, 60); g.lineTo(216, 90); g.fill();
    g.fillStyle = "#d81818"; for (const x of [226, 286]) { g.beginPath(); g.ellipse(x, 112, 18, 9, 0, 0, 6.3); g.fill(); } g.fillStyle = "#000"; for (const x of [226, 286]) { g.beginPath(); g.arc(x, 112, 4, 0, 6.3); g.fill(); }
    g.fillStyle = "#6a0a12"; g.beginPath(); g.ellipse(256, 170, 26, 12, 0, 0, 6.3); g.fill(); g.fillStyle = "#fff"; for (const x of [238, 274]) { g.beginPath(); g.moveTo(x - 5, 164); g.lineTo(x + 5, 164); g.lineTo(x, 190); g.fill(); }
    g.fillStyle = "#050204"; g.beginPath(); g.moveTo(120, H); g.lineTo(190, 150); g.lineTo(256, 215); g.lineTo(322, 150); g.lineTo(392, H); g.fill();
  } else if (kind === "flames") {
    for (let i = 0; i < 14; i++) { const x = (i + 0.5) * W / 14 + (R() - 0.5) * 20, h = 90 + R() * 130; const q = g.createLinearGradient(0, H, 0, H - h); q.addColorStop(0, "#ffee70"); q.addColorStop(0.5, "#ff6a10"); q.addColorStop(1, "rgba(180,20,10,0)"); g.fillStyle = q; g.beginPath(); g.moveTo(x - 36, H); g.quadraticCurveTo(x - 10, H - h * 0.5, x + (R() - 0.5) * 20, H - h); g.quadraticCurveTo(x + 14, H - h * 0.5, x + 36, H); g.fill(); }
    g.fillStyle = "#08030a"; g.beginPath(); g.arc(256, 70, 36, 0, 6.3); g.fill(); g.fillRect(236, 100, 40, 56); g.fillStyle = "#ffe8a0"; for (const x of [244, 268]) { g.beginPath(); g.arc(x, 66, 7, 0, 6.3); g.fill(); }
  } else if (kind === "moon") {
    glowDot(150, 110, 170, "rgba(160,200,255,.7)"); g.fillStyle = "#dfe8ff"; g.beginPath(); g.arc(150, 110, 62, 0, 6.3); g.fill(); g.fillStyle = "rgba(120,150,210,.5)"; for (const [x, y, r] of [[130, 90, 14], [175, 130, 10], [150, 70, 8]]) { g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); }
    g.fillStyle = "#04061a"; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 32) g.lineTo(x, H - 50 - R() * 60); g.lineTo(W, H); g.fill();
    g.fillStyle = "#04061a"; g.beginPath(); g.moveTo(330, H - 60); g.lineTo(330, 90); g.lineTo(350, 60); g.lineTo(370, 90); g.lineTo(370, H - 60); g.fill(); g.fillStyle = "#ffd060"; g.fillRect(344, 110, 12, 18);
    g.fillStyle = "#02030c"; for (let i = 0; i < 5; i++) { const x = 220 + R() * 240, y = 40 + R() * 60; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y - 10, x + 28, y); g.quadraticCurveTo(x + 14, y + 4, x, y); g.fill(); }
  } else if (kind === "fun") {
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + R() * 0.7})`; g.fillRect(R() * W, R() * H * 0.7, 2, 2); }
    glowDot(130, 90, 90, "rgba(255,200,80,.8)"); g.fillStyle = "#ff9a30"; g.beginPath(); g.arc(130, 90, 40, 0, 6.3); g.fill(); g.strokeStyle = "#ffe8a0"; g.lineWidth = 5; g.beginPath(); g.ellipse(130, 90, 70, 14, -0.4, 0, 6.3); g.stroke();
    glowDot(380, 70, 70, "rgba(90,220,255,.8)"); g.fillStyle = "#3ac8ff"; g.beginPath(); g.arc(380, 70, 28, 0, 6.3); g.fill();
    g.fillStyle = "#12041e"; for (const x of [60, 220, 440]) { g.fillRect(x, 130, 8, 126); for (let k = 0; k < 6; k++) { const a = -0.4 + k * 0.4; g.beginPath(); g.ellipse(x + 4 + Math.sin(a) * 28, 130 - Math.cos(a) * 8, 30, 7, a, 0, 6.3); g.fill(); } }
    g.fillRect(0, H - 22, W, 22);
  } else {                                                                           // mirror: diagonal sheen panels
    for (let i = 0; i < 7; i++) { const x = i * 80; const q = g.createLinearGradient(x, 0, x + 50, H); q.addColorStop(0, "rgba(255,255,255,0)"); q.addColorStop(0.5, "rgba(255,255,255,.55)"); q.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = q; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 36, 0); g.lineTo(x + 36 - 90, H); g.lineTo(x - 90, H); g.fill(); }
    g.strokeStyle = "rgba(20,30,60,.8)"; g.lineWidth = 4; for (let x = 0; x <= W; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  }
  // airbrush haze at the edges
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.55)"); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  return tex(T, c);
}

/** a cobweb with an alpha channel (radial threads and sagging rings) */
export function webTexture(T) {
  const [c, g] = canvas(128, 128); g.strokeStyle = "rgba(235,235,250,.9)"; g.lineWidth = 1.2;
  const n = 7; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 180, Math.sin(a) * 180); g.stroke(); }
  for (let r = 18; r < 130; r += 18) { g.beginPath(); for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2, rr = r * (i % 2 ? 0.92 : 1); const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i) g.quadraticCurveTo(Math.cos(a - Math.PI / 2 / n / 2) * rr * 0.82, Math.sin(a - Math.PI / 2 / n / 2) * rr * 0.82, x, y); else g.moveTo(x, y); } g.stroke(); }
  return tex(T, c);
}

/** the vortex tunnel: black / violet / white stripes around the circumference (u) */
export function stripeTexture(T) {
  const [c, g] = canvas(256, 16); const cols = ["#08040c", "#d9d4ff", "#08040c", "#7a2ad8", "#08040c", "#35e6ff", "#08040c", "#ff3fc8"];
  cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 32, 0, 32, 16); });
  const t = tex(T, c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(2, 1); return t;
}
