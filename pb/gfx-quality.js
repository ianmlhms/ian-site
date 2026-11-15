/* gfx-quality.js — one graphics-quality setting shared by the Arcade's 3D games (15 Nov 2026).
 *
 * Most players are on school iPads (iPad 9-class: A13, 3 GB RAM). The 3D games read the level from here instead of each
 * guessing on its own, so "Grafik: Niddreg" chosen in one game holds in all of them.
 *
 *   ArcadeGfx.level()          "low" | "medium" | "high"   (the player's choice, else the auto guess)
 *   ArcadeGfx.auto()           the auto guess alone
 *   ArcadeGfx.choice()         "auto" | "low" | "medium" | "high"   (what the player picked; "auto" = none)
 *   ArcadeGfx.set(choice)      store a choice ("auto" clears it) and tell listeners
 *   ArcadeGfx.pixelRatio()     the renderer pixel ratio for the level (low 1, medium 1.5, high up to 2)
 *   ArcadeGfx.onChange(fn)     fn(level) after set(), also from other tabs/frames; returns an unsubscribe function
 *   ArcadeGfx.LABELS           Luxembourgish labels for a settings control
 *
 * Auto: touch devices with few cores or little memory (iPads, phones, cheap Chromebooks) start on "low", other touch
 * devices and small laptops on "medium", everything else "high". A game may still lower itself further when its own
 * frame-time watchdog sees slow frames; it must never raise above the player's explicit choice.
 * Classic script: load with <script src="gfx-quality.js?v=1"></script> (or "../gfx-quality.js" one level down) before
 * the game's code. Safe in private mode (storage errors are ignored).
 */
(function () {
  "use strict";
  const KEY = "arcade_gfx";
  const LEVELS = Object.freeze(["low", "medium", "high"]);
  const RATIO = Object.freeze({ low: 1, medium: 1.5, high: 2 });
  const LABELS = Object.freeze({ auto: "Automatesch", low: "Niddreg", medium: "Mëttel", high: "Héich", title: "Grafik" });
  const listeners = new Set();

  function read() {
    try { const v = localStorage.getItem(KEY); return LEVELS.includes(v) ? v : "auto"; } catch { return "auto"; }
  }

  function auto() {
    const nav = navigator;
    const touch = (nav.maxTouchPoints || 0) > 0;
    const iPadOS = /Macintosh/.test(nav.userAgent || "") && touch;   // iPadOS reports itself as a Mac
    const mobile = iPadOS || /iPad|iPhone|Android|Mobile|CrOS/.test(nav.userAgent || "");
    const cores = nav.hardwareConcurrency || 4;
    const memory = nav.deviceMemory || 4;   // Chrome only; Safari leaves it undefined
    if (mobile && (cores <= 6 || memory <= 4)) return "low";
    if (mobile || cores <= 4 || memory <= 4) return "medium";
    return "high";
  }

  function level() { const c = read(); return c === "auto" ? auto() : c; }

  function emit() { const l = level(); listeners.forEach((fn) => { try { fn(l); } catch (error) { console.error("[gfx] listener failed", error); } }); }

  function set(choice) {
    const value = LEVELS.includes(choice) ? choice : "auto";
    try { if (value === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, value); } catch { /* private mode: this page only */ }
    emit();
  }

  window.addEventListener("storage", (event) => { if (event.key === KEY) emit(); });

  window.ArcadeGfx = Object.freeze({
    LEVELS, LABELS,
    auto, level, set,
    choice: read,
    pixelRatio: () => Math.min(window.devicePixelRatio || 1, RATIO[level()]),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  });
})();
