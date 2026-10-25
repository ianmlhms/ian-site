/* Flow: MTB Mëllerdall W3 "Menu". The first minute of a new player and the menus: the animated hint after Go, the HUD buttons, the trail map, bikes, settings (weather and time are always choosable,
 * Random is the default, the choice is stored), language switch in all four languages, free ride with viewpoints, the daily challenge. */
import { runIfMain } from "./lib.mjs";

const PAGE = "/pb/mtb.html?debug=1&q=low";
const ready = (page) => page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
const TABS = { lb: ["Trailen", "Vëloen", "Astellungen", "Hëllef"], de: ["Trails", "Räder", "Einstellungen", "Hilfe"], en: ["Trails", "Bikes", "Settings", "Help"], fr: ["Pistes", "Vélos", "Réglages", "Aide"] };

export const flow = {
  name: "mtb-menu",
  fullChromium: true,
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await h.goto(PAGE + "&time=noon&weather=clear");
    await ready(page);

    h.step("first open: one big button, then 3-2-1-Go and the short animated hint (pedal, steer, brake, jump)");
    const card = await page.evaluate(() => ({ btn: document.querySelectorAll(".mcard .bigstart").length, text: document.querySelector(".mcard .bigstart").textContent, w: document.querySelector(".mcard .bigstart").getBoundingClientRect().width, h: document.querySelector(".mcard .bigstart").getBoundingClientRect().height, medals: document.querySelectorAll(".mcard .card-medals .mt").length }));
    h.expect(card.btn === 1 && card.h >= 50 && card.w >= 200 && card.medals === 3, `one big start button (${card.w.toFixed(0)} x ${card.h.toFixed(0)} px) and the three medal times`);
    await h.shot("card");
    await page.click(".bigstart");
    await page.waitForFunction(() => window.__mtb.game.mode === "countdown", null, { timeout: 5000 });
    await h.shot("countdown");
    await page.waitForFunction(() => window.__mtb.game.mode === "run", null, { timeout: 8000 });
    await h.pause(600);
    const hint1 = await page.evaluate(() => { const hi = [...document.querySelectorAll(".mhint .hi")]; return { visible: !document.querySelector(".mhint").classList.contains("hidden"), count: hi.length, on: hi.findIndex((e) => e.classList.contains("on")), caps: hi.map((e) => e.querySelector(".cap").textContent) }; });
    h.expect(hint1.visible && hint1.count === 4 && hint1.on >= 0, `the hint shows four steps and lights one (${hint1.caps.join(" / ")})`);
    await h.pause(1800);
    const hint2 = await page.evaluate(() => [...document.querySelectorAll(".mhint .hi")].findIndex((e) => e.classList.contains("on")));
    h.expect(hint2 !== hint1.on, `the lit step moves on (${hint1.on} -> ${hint2})`);
    await h.shot("hint");
    await page.keyboard.down("KeyW"); await h.pause(7500); await page.keyboard.up("KeyW");
    h.expect(await page.evaluate(() => document.querySelector(".mhint").classList.contains("gone") || document.querySelector(".mhint").classList.contains("hidden")), "the hint fades once the rider pedals");
    h.expect(await page.evaluate(() => /\d:\d\d\.\d/.test(document.querySelector("#hudTime").textContent) && document.querySelector("#hudTime").textContent !== "0:00.0"), "the clock runs");
    await h.shot("run");

    h.step("HUD buttons: menu, weather, time of day, camera, sound");
    const w0 = await page.evaluate(() => window.__mtb.env.state.weatherId);
    await page.keyboard.press("KeyG");
    const w1 = await page.evaluate(() => window.__mtb.env.state.weatherId);
    await page.keyboard.press("KeyT");
    h.expect(w0 !== w1, `G changes the weather (${w0} -> ${w1})`);
    await page.click('.hud-btns .hbtn[title^="Wieder"], .hud-btns .hbtn:nth-child(5)');
    h.expect(await page.evaluate(() => window.__mtb.env.state.weatherId) !== w1, "the HUD weather button changes it too");
    await page.keyboard.press("KeyC");
    await h.pause(300);
    h.expect(await page.evaluate(() => !!window.__mtb.camera.position.length()), "C cycles the camera without breaking the view");
    await page.keyboard.press("KeyC"); await page.keyboard.press("KeyC");
    await page.keyboard.press("Escape");
    await h.pause(400);
    h.expect(await page.evaluate(() => window.__mtb.ui.isMenuOpen()), "Escape opens the menu");
    await h.shot("menu");

    h.step("the menu in all four languages: tabs, trail list, settings");
    for (const lang of ["de", "en", "fr", "lb"]) {
      await page.evaluate(() => window.__mtb.openMenu("settings"));
      await page.selectOption('select[data-set="lang"]', lang);
      await h.pause(200);
      const names = await page.evaluate(() => [...document.querySelectorAll(".menu-tabs .tab")].map((b) => b.textContent));
      h.eq(names, TABS[lang], `${lang}: the four tabs`);
      const raw = await page.evaluate(() => /\b(menu|set|bike|card|hud|finish|help|free|time|weather)\.[a-z]+/i.test(document.querySelector(".mmenu").textContent));
      h.expect(!raw, `${lang}: no untranslated key shows`);
      h.eq(await page.evaluate(() => localStorage.getItem("pb_mtb_lang")), lang, `${lang}: the language is stored`);
    }

    h.step("weather and time: the choice is applied and stored, Random stays available");
    await page.evaluate(() => window.__mtb.openMenu("settings"));
    await page.selectOption('select[data-set="weather"]', "rain");
    await page.selectOption('select[data-set="time"]', "dusk");
    await page.selectOption('select[data-set="season"]', "autumn");
    const choice = await page.evaluate(() => { const c = window.__mtb.env.getChoice(); return { w: c.weatherId, t: c.timeId, s: c.seasonId, stored: [localStorage.getItem("pb_mtb_weather"), localStorage.getItem("pb_mtb_time"), localStorage.getItem("pb_mtb_season")] }; });
    h.eq(choice, { w: "rain", t: "dusk", s: "autumn", stored: ["rain", "dusk", "autumn"] }, "rain, dusk, autumn applied and stored");
    await page.selectOption('select[data-set="weather"]', "random");
    h.eq(await page.evaluate(() => window.__mtb.env.getChoice().weatherMode), "random", "Random can be chosen again");
    await page.selectOption('select[data-set="quality"]', "medium");
    h.eq(await page.evaluate(() => window.__mtb.quality.id), "medium", "the quality setting switches live");
    await page.selectOption('select[data-set="quality"]', "low");

    h.step("the trail map and the bikes");
    await page.evaluate(() => window.__mtb.openMenu("trails"));
    const rows = await page.evaluate(() => [...document.querySelectorAll(".trail-row")].map((r) => ({ locked: r.classList.contains("locked"), name: r.querySelector("b").textContent })));
    h.expect(rows.length === 6 && rows.filter((r) => r.locked).length === 5, `six trails, five locked at the start (${rows.map((r) => r.name).join(", ")})`);
    await h.shot("map");
    const canvasOk = await page.evaluate(() => { const c = document.querySelector("canvas.valley"); const ctx = c.getContext("2d"); const d = ctx.getImageData(0, 0, c.width, c.height).data; let varied = new Set(); for (let i = 0; i < d.length; i += 4 * 997) varied.add(d[i] >> 4); return varied.size; });
    h.expect(canvasOk > 6, `the painted map has colour (${canvasOk} tones)`);
    await page.click(".trail-row.locked");
    await h.pause(300);
    h.expect(await page.evaluate(() => !!document.querySelector(".mcard .locked") && document.querySelector(".mcard .bigstart").disabled), "a locked trail shows its card with the reason and a disabled button");
    await page.evaluate(() => window.__mtb.openMenu("bikes"));
    const bikes = await page.evaluate(() => [...document.querySelectorAll(".bike")].map((b) => ({ locked: b.classList.contains("locked"), cur: b.classList.contains("cur") })));
    h.expect(bikes.length === 4 && bikes[0].cur && bikes.slice(1).every((b) => b.locked), "four bikes: the hardtail is chosen, the rest are locked at the start");
    await h.shot("bikes");
    await page.evaluate(async () => { const m = window.__mtb; window.postMessage({ __pbLoadSave: 1, data: { ...m.progress, m: "333333", tb: 99999 } }, "*"); await new Promise((r) => setTimeout(r, 300)); m.openMenu("bikes"); });
    await page.click('.bike:nth-child(3)');
    h.eq(await page.evaluate(() => window.__mtb.progress.bk), "enduro", "an unlocked bike can be chosen (enduro) and the rider model is rebuilt");
    await page.evaluate(() => window.__mtb.closeMenu());

    h.step("free ride: viewpoints are collected once; the daily challenge opens a card");
    await page.evaluate(() => window.__mtb.startFree());
    const free = await page.evaluate(async () => {
      const m = window.__mtb;
      const v = m.viewpoints[0];
      m.teleport(v.x, v.z + 1);
      await new Promise((r) => setTimeout(r, 700));
      return { mode: m.game.mode, found: m.progress.vp, count: m.viewpoints.length, banner: document.querySelector(".banner").textContent, fox: document.querySelector("#hudCp").textContent };
    });
    h.expect(free.mode === "free" && free.found !== "0" && free.count >= 20, `free ride: ${free.count} viewpoints, the first one is found (${free.banner})`);
    await h.shot("free");
    await page.evaluate(() => window.__mtb.startDaily());
    const daily = await page.evaluate(() => ({ mode: window.__mtb.game.mode, kind: window.__mtb.kind, tag: !!document.querySelector(".mcard .tag") }));
    h.eq(daily, { mode: "card", kind: "daily", tag: true }, "the daily challenge shows its card with the daily tag");
    h.eq(errors, [], "zero console errors");
  },
};

runIfMain(import.meta.url, flow);
