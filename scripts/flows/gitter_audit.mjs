/* Audit for the Gitter look: GITTER_PAGES="a.html,b.html" [GITTER_SIGNED=1] [GITTER_CLICK="selector,selector"].
 * Lists visible elements with border-radius, box-shadow, backdrop-filter or gradient backgrounds (computed style). */
import { runIfMain } from "./lib.mjs";
import { flow as shots } from "./gitter_shots.mjs";
const PAGES = (process.env.GITTER_PAGES || "").split(",").filter(Boolean);
const CLICK = (process.env.GITTER_CLICK || "").split("|").filter(Boolean);
export const flow = {
  name: "gitter-audit", backend: shots.backend,
  async run(h) {
    const { page } = h;
    if (process.env.GITTER_SIGNED === "1") await h.signIn();
    for (const p of PAGES) {
      try {
        await h.goto("/" + p); await h.pause(900);
        for (const sel of ["", ...CLICK]) {
          if (sel) { try { await page.click(sel, { timeout: 1500 }); await h.pause(500); } catch { console.log("   (no click " + sel + ")"); continue; } }
          const rows = await page.evaluate(() => {
            const out = new Map();
            for (const el of document.querySelectorAll("body *")) {
              const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
              const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") continue;
              const bad = [];
              const rad = cs.borderTopLeftRadius; if (rad && rad !== "0px") bad.push("r=" + rad);
              if (cs.boxShadow && cs.boxShadow !== "none") {
                // pure hairlines (0 offset, 0 blur, spread <= 2px) are fine; glow, drop and highlight shadows are not
                const stripped = cs.boxShadow.replace(/(rgba?|color)\([^)]*\)/g, "").trim();
                const parts = stripped.split(/\s*,\s*/).filter(Boolean);
                const loud = parts.some((s) => { const n = (s.match(/-?[\d.]+px/g) || []).map(parseFloat); return n[0] || n[1] || n[2] || (n[3] || 0) > 2; });
                if (loud) bad.push("sh=" + cs.boxShadow.slice(0, 90));
              }
              if ((cs.backdropFilter && cs.backdropFilter !== "none") || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== "none")) bad.push("blur");
              if (/gradient/.test(cs.backgroundImage)) bad.push("grad");
              if (!bad.length) continue;
              const id = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "");
              const k = id + " " + bad.join(" ");
              out.set(k, (out.get(k) || 0) + 1);
            }
            return [...out.entries()].map(([k, n]) => k + (n > 1 ? " x" + n : ""));
          });
          console.log(`== ${p} ${sel ? "[" + sel + "]" : ""}\n  ` + (rows.join("\n  ") || "(clean)"));
        }
      } catch (e) { console.log("FAIL " + p + " " + String(e).slice(0, 120)); }
    }
  },
};
runIfMain(import.meta.url, flow);
