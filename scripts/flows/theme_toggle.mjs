/* Flow — dark mode (Nov 2026): gitter-theme.js. Default follows prefers-color-scheme; the header toggle cycles Auto -> Hell -> Daischter,
 * is stored in localStorage "gt-theme", survives a reload, and <html data-theme> is set before the <body> exists (no flash of the
 * wrong theme). Dark paper is #121314, light #f6f6f3; theme-color metas follow; an Arcade game frame receives the resolved theme. */
import { runIfMain } from "./lib.mjs";

const DARK_BG = "rgb(18, 19, 20)";
const LIGHT_BG = "rgb(246, 246, 243)";

const readState = (page) => page.evaluate(() => ({
  theme: document.documentElement.getAttribute("data-theme"),
  pref: document.documentElement.getAttribute("data-theme-pref"),
  stored: (() => { try { return localStorage.getItem("gt-theme"); } catch { return "n/a"; } })(),
  bg: getComputedStyle(document.body).backgroundColor,
  atBody: window.__themeAtBody,
  metas: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => `${m.media}|${m.content}`),
  label: document.getElementById("gtTheme")?.getAttribute("aria-label") || null,
}));

export const flow = {
  name: "theme-toggle",
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      // records what <html data-theme> was at the moment <body> first appeared (= before anything can paint)
      const watch = new MutationObserver(() => {
        if (document.body && window.__themeAtBody === undefined) { window.__themeAtBody = document.documentElement.getAttribute("data-theme"); watch.disconnect(); }
      });
      watch.observe(document, { childList: true, subtree: true });
    });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

    h.step("light device: Auto resolves to light, no flash");
    await page.emulateMedia({ colorScheme: "light" });
    await h.goto("/profile.html");
    await h.pause(400);
    let s = await readState(page);
    h.eq(s.theme, "light", "Auto on a light device = data-theme light");
    h.eq(s.pref, "auto", "preference is auto");
    h.eq(s.atBody, "light", "data-theme was already set when <body> appeared");
    h.eq(s.bg, LIGHT_BG, "paper background in light");
    h.expect(s.metas.length === 2 && s.metas.some((m) => m.includes("light") && m.endsWith("#f6f6f3")) && s.metas.some((m) => m.includes("dark") && m.endsWith("#121314")), `two theme-color metas (${s.metas.join(" ; ")})`);

    h.step("dark device: Auto resolves to dark");
    await page.emulateMedia({ colorScheme: "dark" });
    await h.pause(300);
    s = await readState(page);
    h.eq(s.theme, "dark", "Auto follows the device live (no reload)");
    h.eq(s.bg, DARK_BG, "near-black paper in dark");
    await h.goto("/profile.html");
    await h.pause(400);
    s = await readState(page);
    h.eq(s.atBody, "dark", "dark is set before <body> on a dark device (no flash)");
    h.expect((await page.locator("#gtTheme").count()) === 1, "toggle button is in the header");

    h.step("toggle: Auto -> Hell -> Daischter -> Auto");
    await page.locator("#gtTheme").click();
    s = await readState(page);
    h.eq([s.pref, s.theme, s.stored], ["light", "light", "light"], "first tap = Hell (stays light on a dark device)");
    h.expect(/Hell/.test(s.label || ""), `label says Hell (${s.label})`);
    await page.locator("#gtTheme").click();
    s = await readState(page);
    h.eq([s.pref, s.theme, s.stored], ["dark", "dark", "dark"], "second tap = Daischter");
    h.expect(/Däischter/.test(s.label || ""), `label says Däischter (${s.label})`);

    h.step("choice persists across a reload");
    await page.emulateMedia({ colorScheme: "light" });
    await h.goto("/profile.html");
    await h.pause(400);
    s = await readState(page);
    h.eq([s.pref, s.theme, s.atBody], ["dark", "dark", "dark"], "Daischter survives a reload on a light device, set before <body>");
    h.eq(s.bg, DARK_BG, "dark paper after reload");
    await page.locator("#gtTheme").click();   // dark -> auto
    s = await readState(page);
    h.eq([s.pref, s.theme, s.stored], ["auto", "light", null], "third tap = Auto again (storage cleared)");

    h.step("homepage has the toggle too");
    await h.goto("/index.html");
    await h.pause(500);
    h.expect((await page.locator("#gtTheme").count()) === 1, "toggle on the homepage");

    h.step("a game frame gets the hub's theme");
    await page.emulateMedia({ colorScheme: "dark" });
    await h.goto("/pixelbreak.html?g=2048");
    const frame = page.frameLocator("#gf");
    await frame.locator("body").waitFor({ timeout: 15000 }).catch(() => {});
    await h.pause(1500);
    const inner = await page.evaluate(() => {
      const doc = document.getElementById("gf")?.contentDocument;
      if (!doc) return null;
      return { theme: doc.documentElement.getAttribute("data-theme"), bg: getComputedStyle(doc.documentElement).getPropertyValue("--bg").trim() };
    });
    h.expect(inner && inner.theme === "dark", `game frame <html data-theme> = ${inner && inner.theme}`);
    h.expect(inner && /^#1[0-9a-f]{5}$/i.test(inner.bg), `game board token --bg is dark (${inner && inner.bg})`);

    h.expect(errors.length === 0, "no console errors: " + errors.join(" | ").slice(0, 300));
  },
};
runIfMain(import.meta.url, flow);
