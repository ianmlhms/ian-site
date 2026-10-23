/* Screen effects of the rides (DOM only, created lazily inside the walk HUD): the ride info pill (name, time left), a controls hint, a white strobe, spray
 * on the lens (2D canvas), a dark vignette (g-forces, the ghost train's darkness), a red hit flash, and the camera shake value.
 * Nothing here touches the 3D scene. */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createFx({ hud, reduce = () => false }) {
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; };
  const root = el("div", "rd"); root.hidden = true;
  root.innerHTML = `
    <div class="rd-dark"></div>
    <div class="rd-black"></div>
    <div class="rd-vig"></div>
    <canvas class="rd-spray" width="360" height="640"></canvas>
    <div class="rd-hit"></div>
    <div class="rd-spark"></div>
    <div class="rd-strobe"></div>
    <div class="rd-info"><b></b><span></span><i><u></u></i></div>
    <div class="rd-hint" hidden></div>
    <div class="rd-score" hidden></div>`;
  const fade = hud.querySelector(".wk-fade");
  if (fade) hud.insertBefore(root, fade); else hud.append(root);
  const q = sel => root.querySelector(sel);
  const nodes = { dark: q(".rd-dark"), black: q(".rd-black"), vig: q(".rd-vig"), spray: q(".rd-spray"), hit: q(".rd-hit"), spark: q(".rd-spark"), strobe: q(".rd-strobe"), info: q(".rd-info"), hint: q(".rd-hint"), score: q(".rd-score") };
  const g = nodes.spray.getContext("2d");
  const drops = [];
  const st = { spark: 0, black: 0, shake: 0, strobe: 0, hit: 0, vig: 0, dark: 0, hintUntil: 0, clock: 0 };

  function show(name, icon) {
    root.hidden = false; document.body.classList.add("rd-on");
    nodes.info.querySelector("b").textContent = `${icon} ${name}`;
    nodes.info.querySelector("span").textContent = "";
    nodes.info.querySelector("u").style.width = "0%";
    st.shake = 0; st.strobe = 0; st.hit = 0; st.vig = 0; st.dark = 0; st.black = 0; st.spark = 0; drops.length = 0; g.clearRect(0, 0, nodes.spray.width, nodes.spray.height);
    nodes.score.hidden = true; nodes.hint.hidden = true;
    apply();
  }
  function hide() { document.body.classList.remove("rd-on"); root.hidden = true; nodes.hint.hidden = true; nodes.score.hidden = true; }
  function setProgress(p, left) {
    nodes.info.querySelector("u").style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
    nodes.info.querySelector("span").textContent = left === null ? "" : formatLeft(left);
  }
  const formatLeft = s => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
  function hint(text, seconds = 6) { nodes.hint.textContent = text; nodes.hint.hidden = !text; st.hintUntil = st.clock + seconds; }
  function score(text) { nodes.score.textContent = text; nodes.score.hidden = !text; }

  const lastStyle = {};
  const setOpacity = (name, value) => { const v = value.toFixed(3); if (lastStyle[name] !== v) { lastStyle[name] = v; nodes[name].style.opacity = v; } };
  function apply() {
    const calm = reduce();
    setOpacity("strobe", clamp(st.strobe * (calm ? 0.35 : 1), 0, 1));
    setOpacity("hit", clamp(st.hit, 0, 1));
    setOpacity("spark", clamp(st.spark, 0, 1));
    setOpacity("vig", clamp(st.vig, 0, 1) * (calm ? 0.6 : 1));
    setOpacity("dark", clamp(st.dark, 0, 1));
    setOpacity("black", clamp(st.black, 0, 1));
  }

  /** a burst of water on the lens: n drops fly up and run down */
  function spray(n = 60, power = 1) {
    const w = nodes.spray.width, h = nodes.spray.height;
    for (let i = 0; i < n; i++) {
      drops.push({ x: Math.random() * w, y: h * (0.35 + Math.random() * 0.65), vx: (Math.random() - 0.5) * 60 * power, vy: -(80 + Math.random() * 380) * power, r: 3 + Math.random() * 9, life: 1.1 + Math.random() * 1.6, age: 0, run: Math.random() < 0.4 });
    }
  }
  function update(dt) {
    st.clock += dt;
    if (!nodes.hint.hidden && st.clock > st.hintUntil) nodes.hint.hidden = true;
    st.strobe = Math.max(0, st.strobe - dt * 4.2);
    st.hit = Math.max(0, st.hit - dt * 3); st.spark = Math.max(0, st.spark - dt * 9);
    st.shake = Math.max(0, st.shake - dt * 1.6);
    if (drops.length || st.clock - (update.last || 0) > 0.5) {
      update.last = st.clock;
      const w = nodes.spray.width, h = nodes.spray.height;
      g.clearRect(0, 0, w, h);
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i]; d.age += dt;
        if (d.age > d.life) { drops.splice(i, 1); continue; }
        d.vy += 520 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.run && d.age > 0.5) { d.vy = Math.min(d.vy, 30); d.vx *= 0.9; }
        const a = clamp(1 - d.age / d.life, 0, 1);
        g.fillStyle = `rgba(214,238,255,${(0.55 * a).toFixed(3)})`; g.beginPath(); g.ellipse(d.x, d.y, d.r, d.r * (d.run ? 1.7 : 1), 0, 0, 6.283); g.fill();
        g.fillStyle = `rgba(255,255,255,${(0.7 * a).toFixed(3)})`; g.beginPath(); g.arc(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.28, 0, 6.283); g.fill();
      }
    }
    apply();
  }
  return {
    root, show, hide, setProgress, hint, score, spray, update,
    strobe(k = 1) { st.strobe = Math.max(st.strobe, k); apply(); },
    flashHit(k = 0.6) { st.hit = Math.max(st.hit, k); apply(); },
    shake(k) { st.shake = Math.max(st.shake, clamp(k, 0, 1)); },
    setVignette(k) { st.vig = k; },
    setDark(k) { st.dark = k; },
    setBlack(k) { st.black = k; },
    /** the pole of your own car sparks on the ceiling grid: a blue-white flicker at the top edge */
    spark(k = 1) { st.spark = Math.max(st.spark, k); },
    get shakeValue() { return st.shake; },
    get dropCount() { return drops.length; },
    get strobeValue() { return st.strobe; },
    get visible() { return !root.hidden; },
    dispose() { root.remove(); },
  };
}
