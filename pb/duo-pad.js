/* DuoPad: two on-screen control clusters so two people can play one game on ONE touch screen (multi-touch).
 * Used by the 2-player games (tank-wars, fighters) in "Zu zweet, een Apparat". Each cluster is a set of square
 * buttons; a finger may slide from one button to the next, and every finger is tracked on its own, so both players
 * can hold buttons at the same time. Hidden while a hardware keyboard is in use (kit class .arcade-hardware-keyboard).
 *
 *   const pad = DuoPad.mount(stageElement, { p1: { label, buttons }, p2: { label, buttons } });
 *   pad.state.p1.l  -> true while P1's "l" button is held     pad.show(true|false)     pad.clear()
 * A button is { k:'l', text:'◀', x:0, y:1, w:1, h:1, primary:true }, positions in button cells (1 cell = --dp). */
(function () {
  "use strict";
  const GAP = 0.12;       // space between buttons, in cells
  const HIT_SLOP_PX = 3;  // a finger a hair outside a button still counts for it
  const CSS = `
    .dp-cluster{position:absolute;bottom:max(8px,env(safe-area-inset-bottom));z-index:3;display:none;touch-action:none;
      user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;--dp:48px}
    .dp-cluster.dp-on{display:block}
    .dp-left{left:max(8px,env(safe-area-inset-left))}.dp-right{right:max(8px,env(safe-area-inset-right))}
    .dp-tag{position:absolute;left:0;top:-18px;font:500 11px/1 var(--font-mono,ui-monospace,monospace);letter-spacing:.06em;
      color:var(--g-muted,#62656a);text-transform:uppercase;pointer-events:none}
    .dp-right .dp-tag{left:auto;right:0}
    .dp-btn{position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
      border:1px solid var(--g-ink,#16171a);background:var(--g-white,#fcfcfa);color:var(--g-ink,#16171a);opacity:.86;
      font:700 16px/1 var(--font,system-ui,sans-serif);pointer-events:none}
    .dp-btn.dp-primary{background:var(--g-green,#1f7a4d);border-color:var(--g-green,#1f7a4d);color:var(--g-on-green,#fff)}
    .dp-btn.on{background:var(--g-ink,#16171a);border-color:var(--g-ink,#16171a);color:var(--g-paper,#f6f6f3);opacity:1}
    .arcade-hardware-keyboard .dp-cluster{display:none!important}
  `;
  function injectCss() {
    if (document.getElementById("duo-pad-css")) return;
    const style = document.createElement("style");
    style.id = "duo-pad-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  function extent(buttons) {
    return buttons.reduce((acc, b) => ({ w: Math.max(acc.w, b.x + (b.w || 1)), h: Math.max(acc.h, b.y + (b.h || 1)) }), { w: 0, h: 0 });
  }
  function buildCluster(host, side, spec) {
    const state = {};
    const root = document.createElement("div");
    root.className = "dp-cluster dp-" + side;
    root.setAttribute("data-arcade-touch-controls", "");
    const size = extent(spec.buttons);
    root.style.width = "calc(var(--dp) * " + size.w + ")";
    root.style.height = "calc(var(--dp) * " + size.h + ")";
    if (spec.label) {
      const tag = document.createElement("span");
      tag.className = "dp-tag";
      tag.textContent = spec.label;
      root.appendChild(tag);
    }
    const buttons = spec.buttons.map((b) => {
      const el = document.createElement("span");
      el.className = "dp-btn" + (b.primary ? " dp-primary" : "");
      el.textContent = b.text;
      const x = b.x;   // both clusters share one layout so every arrow points the way it says
      el.style.left = "calc(var(--dp) * " + (x + GAP / 2) + ")";
      el.style.top = "calc(var(--dp) * " + (b.y + GAP / 2) + ")";
      el.style.width = "calc(var(--dp) * " + ((b.w || 1) - GAP) + ")";
      el.style.height = "calc(var(--dp) * " + ((b.h || 1) - GAP) + ")";
      if (b.label) el.setAttribute("aria-label", b.label);
      root.appendChild(el);
      state[b.k] = false;
      return { k: b.k, el };
    });
    const fingers = new Map();   // pointerId -> key under that finger (or null)
    const pick = (x, y) => {
      for (const b of buttons) {
        const r = b.el.getBoundingClientRect();
        if (x >= r.left - HIT_SLOP_PX && x <= r.right + HIT_SLOP_PX && y >= r.top - HIT_SLOP_PX && y <= r.bottom + HIT_SLOP_PX) return b.k;
      }
      return null;
    };
    const apply = () => {
      const held = new Set(fingers.values());
      for (const b of buttons) {
        const on = held.has(b.k);
        if (state[b.k] !== on) { state[b.k] = on; b.el.classList.toggle("on", on); }
      }
    };
    const release = (e) => { if (fingers.delete(e.pointerId)) apply(); };
    root.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { root.setPointerCapture(e.pointerId); } catch (error) { console.warn("[DuoPad] pointer capture failed", error); }
      fingers.set(e.pointerId, pick(e.clientX, e.clientY));
      apply();
    });
    root.addEventListener("pointermove", (e) => { if (fingers.has(e.pointerId)) { fingers.set(e.pointerId, pick(e.clientX, e.clientY)); apply(); } });
    root.addEventListener("pointerup", release);
    root.addEventListener("pointercancel", release);
    root.addEventListener("lostpointercapture", release);
    host.appendChild(root);
    return { root, state, clear() { fingers.clear(); apply(); } };
  }
  function mount(host, spec) {
    injectCss();
    const left = buildCluster(host, "left", spec.p1);
    const right = buildCluster(host, "right", spec.p2);
    const size = () => {
      const dp = Math.max(40, Math.min(58, Math.floor((host.clientWidth - 24) / 9.4)));
      for (const c of [left.root, right.root]) c.style.setProperty("--dp", dp + "px");
    };
    if (window.ResizeObserver) new ResizeObserver(size).observe(host);
    size();
    const touchScreen = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches) || navigator.maxTouchPoints > 0;
    return Object.freeze({
      state: { p1: left.state, p2: right.state },
      touchScreen,
      show(visible) {
        const on = Boolean(visible) && touchScreen;
        left.root.classList.toggle("dp-on", on);
        right.root.classList.toggle("dp-on", on);
        if (!on) { left.clear(); right.clear(); }
      },
      clear() { left.clear(); right.clear(); },
    });
  }
  window.DuoPad = Object.freeze({ mount });
})();
