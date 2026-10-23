/* Flow: Schueberfouer Tycoon W5, the migration of Theme Park Tycoon (v1) players (DESIGN 7), inside the real arcade
 * (pixelbreak.html, the park tile opens pb/fouer.html in the srcdoc frame, Supabase mocked).
 * The v1 blobs are built in Node with the frozen v1 kernel (the same recipe as the W1 harness golden blobs).
 *   1. median park via __pbSave (localStorage pb_save_park): the letter "Bréif vum Hämmi" shows the exact numbers of the report, the old park
 *      as a 2D map, the vouchers and the golden carousel; "Op d'Fouer!" starts the 3-step pioneer tutorial (place a voucher, see the crowd, upgrade);
 *      vouchers are placeable on an open pitch, on a LOCKED pitch (kanner free, Riserad half price), and are spent once;
 *      reopening does not migrate twice, pb_park_v1_backup exists and is the untouched original, an old v1 client overwriting the local save is ignored;
 *   2. corrupt blob: thank-you (cash 1,350, golden carousel, pioneer badge);
 *   3. stub only (the cloud holds {v:2, stub:1, pv}): the letter arrives after the cloud save, numbers from pv only;
 *   4. top-up: a pioneer who finds a richer v1 park on a second device gets the difference once. */
import { runIfMain } from "./lib.mjs";
import { createState as v1Create, tick as v1Tick } from "../../pb/park/sim.js";
import { canPlace as v1CanPlace, place as v1Place, placePath as v1PlacePath } from "../../pb/park/build.js";
import { serializeSave as v1Serialize } from "../../pb/park/save.js";
import * as legacy from "../../pb/fouer/legacy.js";
import * as sim from "../../pb/fouer/sim.js";
import { encodeSave } from "../../pb/fouer/save.js";
import { consoleCollector } from "./fouer_game.mjs";

const BOOT_TIMEOUT = 120000;

/* ------------------------------------------------------------ blobs, built with the frozen kernel (same helper as the harness) */
function v1Park(objects, { cash = null, roads = true } = {}) {
  let state = v1Create(1);
  state = v1Tick({ saved: { ...state.saved, l: 0xffff, c: 1e7, u: 15 }, derived: { ...state.derived, dirty: true } }, 0);
  if (roads) for (let y = 1; y <= 18; y++) state = v1PlacePath(state, 20, y);
  for (const id of objects) {
    outer: for (let y = 0; y < 38; y++) for (let x = 0; x < 38; x++) {
      if (x === 20 && roads) continue;
      if (v1CanPlace(state, id, x, y, 0).ok) { state = v1Place(state, id, x, y, 0); break outer; }
    }
  }
  const base = v1Tick(state, 0);
  if (cash !== null) {
    const fixed = base.derived.parkValue - base.saved.c;
    state = v1Tick({ saved: { ...base.saved, c: cash - fixed }, derived: { ...base.derived, dirty: true } }, 0);
    if (state.derived.parkValue !== cash) state = v1Tick({ saved: { ...base.saved, c: base.saved.c + (cash - base.derived.parkValue) }, derived: { ...base.derived, dirty: true } }, 0);
  } else state = base;
  return state;
}
const MEDIAN_OBJECTS = ["ghost-train", "wheel", "burgers", "carousel", "popcorn", "toilet", "bin", "flowers", "tree", "lemonade"];
const MEDIAN = v1Serialize(v1Park(MEDIAN_OBJECTS, { cash: 10259 }));
const UNTOUCHED = v1Serialize(v1Create(1));
const CORRUPT = JSON.stringify({ version: 1, g: [1, 2, 3], o: [], v: "" });
const STUB = { v: 2, stub: 1, pv: 10259 };
const NAMES = { geister: "Geeschterbunn", wheel: "Riserad", wurscht: "Grillwurscht", kanner: "Kannerkarussell", mandel: "Mandelen & Magenbrout" };

const world = { cloud: null, upserts: [] };
const frameOf = page => page.frames().find(f => f.parentFrame());
const gameState = frame => frame.evaluate(() => { const s = window.__fouerGame.game.state; return { c: s.c, tb: s.tb, tu: s.tu, pi: s.pi, mg: s.mg, rb: s.rb, vo: s.vo, pu: s.pu, lg: s.lg, built: s.pitches.map((e, i) => e && { i, k: e.k, lv: e.lv, fl: e.fl }).filter(Boolean) }; });

async function openArcade(h) {
  await h.goto("/pixelbreak.html?g=park&fouerDebug=1");
  await h.page.waitForFunction(() => { const d = document.getElementById("gf")?.contentWindow?.document?.documentElement; return d && (d.dataset.fouerReady === "1" || d.dataset.bootError); }, null, { timeout: BOOT_TIMEOUT });
  await h.pause(1200);
  return frameOf(h.page);
}
async function wipe(h) {
  await h.goto("/robots.txt");
  await h.page.evaluate(() => localStorage.clear());
}
async function seed(h, entries) {
  await h.goto("/robots.txt");
  await h.page.evaluate((e) => { localStorage.clear(); Object.entries(e).forEach(([k, v]) => localStorage.setItem(k, v)); }, entries);
}
const letterText = frame => frame.evaluate(() => document.querySelector(".paper")?.innerText || "");
async function tapLocator(h, locator) {
  await locator.waitFor({ state: "visible", timeout: 8000 });
  await h.pause(380);
  const box = await locator.boundingBox();
  await h.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await h.pause(260);
}
async function tapPitch(h, frame, index) {
  await frame.evaluate((i) => { const G = window.__fouerGame; G.scene.focus(i, { dist: 110, seconds: 0 }); }, index);
  await h.pause(500);
  if (process.env.FOUER_DEBUG) console.log("    focus", index, JSON.stringify(await frame.evaluate((i) => ({ cam: window.__fouerGame.r.performanceSnapshot().camera, pos: window.__fouerGame.r.camera.position.toArray(), rect: window.__fouerGame.scene.rects[i], a: window.__fouerGame.scene.anchor(i, 0.4) }), index)));
  const p = await frame.evaluate((i) => { const a = window.__fouerGame.scene.anchor(i, 0.4); return a && { x: a.x, y: a.y }; }, index);
  const frameBox = await h.page.locator("#gf").boundingBox();       // the arcade's game bar sits above the frame: frame coordinates + its offset
  await h.page.touchscreen.tap(frameBox.x + p.x, frameBox.y + p.y);
  await h.pause(500);
  if (process.env.FOUER_DEBUG) console.log("    tapPitch", index, JSON.stringify(p), JSON.stringify(await frame.evaluate(() => ({ sel: window.__fouerGame.ui.selected, cam: window.__fouerGame.r.performanceSnapshot().camera }))));
}

export const flow = {
  name: "fouer-migration",
  fullChromium: true,
  touch: true,
  backend: {
    tables: {
      game_saves: ({ method, body }) => {
        if (method === "GET") return world.cloud ? [{ data: world.cloud }] : [];
        if (body) world.upserts.push(body);
        return [];
      },
    },
  },
  async run(h) {
    const { page, context } = h;
    const errors = consoleCollector(page);
    await h.signIn();
    await context.addInitScript(() => { localStorage.setItem("pb_fouer_time", "evening"); localStorage.setItem("pb_fouer_weather", "clear"); localStorage.setItem("site_lang", "lb"); localStorage.setItem("playerName", "Ian"); });

    /* what W1 says the numbers must be (the letter has to show exactly these) */
    const plan = await legacy.migrate(MEDIAN, null, { now: Date.now(), name: "Ian" });
    h.eq([plan.report.cash, plan.report.rb, plan.report.tb0, plan.report.stars, plan.report.vouchers], [4649, 68, 34472, 2, ["geister", "wheel", "wurscht", "kanner", "mandel"]], "W1 golden numbers of the median blob (kernel built in Node)");

    /* ------------------------------------------------------------ 1. median park */
    h.step("median v1 park in localStorage (__pbSave): the letter shows the exact numbers");
    world.cloud = null; world.upserts = [];
    await seed(h, { pb_save_park: MEDIAN });
    let frame = await openArcade(h);
    h.eq(await frame.evaluate(() => document.documentElement.dataset.bootError || ""), "", "boots");
    await frameOf(page).locator(".paper").waitFor({ timeout: 15000 });
    await h.pause(700);
    const text = await letterText(frame);
    h.expect(text.includes("Bréif vum Hämmi"), "the letter is titled 'Bréif vum Hämmi'");
    h.expect(text.includes("Däi Park ass op de Glacis geplënnert!"), "...and says the park moved to the Glacis");
    h.expect(text.includes("34,472"), "Pionéier-Wäert +34,472 (tb0)");
    h.expect(text.includes("€4,649"), "Cash €4,649");
    h.expect(/\+68 \(⭐2\)/.test(text), "Rating-Bonus +68 (⭐2)");
    for (const id of plan.report.vouchers) h.expect(text.includes(NAMES[id]), `voucher chip: ${NAMES[id]}`);
    h.expect(text.includes("Gëllent Karussell") && text.includes("Mäin ale Park"), "the golden carousel and the old-park kiosk are listed");
    const mapPixels = await frame.evaluate(() => {
      const c = document.querySelector(".paper canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const seen = new Set();
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return seen.size;
    });
    h.expect(mapPixels >= 6, `the old park is drawn as a 2D map (${mapPixels} colours: grass, parcels, paths, rides, stalls, gate)`);
    await h.shot("letter-median");
    const backup = await page.evaluate(() => localStorage.getItem("pb_park_v1_backup"));
    h.eq(backup, MEDIAN, "pb_park_v1_backup is the untouched original blob");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("pb_save_park")));
    h.expect(saved.v === 2 && saved.pi === 1 && saved.mg === 4059 && saved.tb === 34472, `the arcade now holds the v2 save (pi ${saved.pi}, mg ${saved.mg}, tb ${saved.tb})`);
    h.expect(saved.c === 4649 || Math.abs(saved.c - 4649) < 5, `...with cash ${saved.c}`);

    h.step("Op d'Fouer!: the pioneer tutorial (voucher, crowd, upgrade) with real taps");
    await tapLocator(h, frameOf(page).locator(".paper [data-go]"));
    await h.pause(600);
    h.eq(await frameOf(page).locator(".modal").count(), 0, "the letter closes");
    let tut = await frame.evaluate(() => window.__fouerGame.game.tutorial());
    h.eq([tut.mode, tut.step, tut.stage], ["pioneer", 1, "pitch"], "pioneer tutorial step 1");
    h.expect((await frame.evaluate(() => document.querySelector(".bubble .txt")?.textContent || "")).includes("Gutschäin"), "Hämmi: Setz däi Gutschäin op déi gëllen Plaz.");
    h.eq(await frame.evaluate(() => window.__fouerGame.game.glowPitches().length), 1, "one pitch glows for the voucher");
    await h.shot("pioneer-step1");
    const fingerBox = await frameOf(page).locator(".finger").boundingBox();
    await page.touchscreen.tap(fingerBox.x + fingerBox.width / 2, fingerBox.y + 8);
    await frameOf(page).locator(".sheet.build").waitFor({ timeout: 8000 });
    h.eq(await frameOf(page).locator(".sheet .card").count(), 1, "one card: the voucher");
    h.expect((await frameOf(page).locator(".sheet .card").first().innerText()).includes("Gutschäin"), "it is marked as a voucher");
    await h.shot("pioneer-voucher-card");
    await tapLocator(h, frameOf(page).locator('.sheet .card [data-tut="build"]'));
    await frameOf(page).waitForFunction(() => window.__fouerGame.game.builtCount() === 1);
    let st = await gameState(frame);
    h.eq(st.built.map((b) => [b.k, b.fl & 3 ? "voucher" : "paid"]), [["wurscht", "voucher"]], "the first affordable voucher (Grillwurscht, free) is placed");
    h.eq(st.vo, ["geister", "wheel", "kanner", "mandel"], "that voucher is spent, four are left");
    await frameOf(page).waitForFunction(() => window.__fouerGame.game.tutorial().stage === "crowd", null, { timeout: 8000 });
    h.expect((await frame.evaluate(() => document.querySelector(".bubble .txt").textContent)).includes("D'Leit komme"), "step 2: see the crowd");
    await tapLocator(h, frameOf(page).locator('.bubble [data-tut="ok"]'));
    await frameOf(page).waitForFunction(() => window.__fouerGame.game.tutorial().stage === "upgrade");
    await frame.evaluate(() => window.__fouerGame.game.advance(300));
    await h.pause(400);
    const f2 = await frameOf(page).locator(".finger").boundingBox();
    await page.touchscreen.tap(f2.x + f2.width / 2, f2.y + 8);
    await tapLocator(h, frameOf(page).locator('.sheet.manage [data-tut="upgrade"]'));
    await frameOf(page).waitForFunction(() => window.__fouerGame.game.state.tu === 8);
    h.eq((await gameState(frame)).tu, 8, "step 3: the upgrade ends the tutorial");
    await h.shot("pioneer-done");

    h.step("vouchers on a LOCKED pitch: kanner (free) on P31 (star 5), the Riserad (half price) on P24 (star 3)");
    await frame.evaluate(() => window.__fouerGame.ui.closeSheet());
    await frame.evaluate(() => { const G = window.__fouerGame; G.game.debugSetState({ ...G.game.state, rb: 30 }); });   // the tutorial upgrade pushed the park to ⭐3: bring it back to ⭐2
    h.eq(await frame.evaluate(() => window.__fouerGame.game.stars()), 2, "the park is at ⭐2");
    h.eq(await frame.evaluate(() => window.__fouerGame.game.pitchStatus(30)), "locked", "P31 is locked (⭐5)");
    h.expect(await frame.evaluate(() => window.__fouerGame.game.glowPitches().includes(23)), "P24 (the wheel pitch, locked until ⭐3) glows because a Riserad voucher fits it");
    await tapPitch(h, frame, 30);
    await frameOf(page).locator(".sheet.build").waitFor({ timeout: 8000 });
    const lockedCards = await frameOf(page).locator(".sheet .card b").allInnerTexts();
    h.eq(lockedCards.sort(), ["Kannerkarussell", "Mandelen & Magenbrout"], "a locked pitch offers only the vouchers that fit (S size)");
    await h.shot("voucher-on-locked-pitch");
    await tapLocator(h, frameOf(page).locator('.sheet .card:has-text("Kannerkarussell") [data-tut="build"]'));
    await frameOf(page).waitForFunction(() => window.__fouerGame.game.state.pitches[30] !== null);
    st = await gameState(frame);
    h.expect(st.built.some((b) => b.i === 30 && b.k === "kanner" && (b.fl & 3)), "the kids' carousel stands on the locked pitch P31");
    h.eq(await frame.evaluate(() => window.__fouerGame.game.pitchStatus(30)), "built", "...which the voucher opened");
    h.eq(st.vo, ["geister", "wheel", "mandel"], "voucher spent");
    await frame.evaluate(() => window.__fouerGame.ui.closeSheet());
    h.eq(await frame.evaluate(() => window.__fouerGame.game.pitchStatus(23)), "locked", "P24 is locked at ⭐2");
    await tapPitch(h, frame, 23);
    await frameOf(page).locator(".sheet.build").waitFor({ timeout: 8000 });
    const wheelCard = frameOf(page).locator('.sheet .card:has-text("Riserad")');
    h.eq(await wheelCard.count(), 1, "the Riserad voucher card is offered on the wheel pitch");
    h.expect(/22,500/.test(await wheelCard.innerText()), "...at half price (€22,500)");
    h.expect(await wheelCard.locator("button").isDisabled(), "...disabled while the cash is short");
    await frame.evaluate(() => { const G = window.__fouerGame; G.game.debugSetState({ ...G.game.state, c: 60000 }); });
    await h.pause(500);
    await tapLocator(h, wheelCard.locator("button"));
    await frameOf(page).waitForFunction(() => window.__fouerGame.game.state.pitches[23] !== null);
    st = await gameState(frame);
    h.expect(st.built.some((b) => b.i === 23 && b.k === "wheel"), "the Riserad stands on its (locked) pitch");
    h.expect(Math.abs(st.c - (60000 - 22500)) < 60, `it cost half the price (cash ${Math.round(st.c)} = 60,000 - 22,500 + a few ticks of income)`);
    await h.pause(1400);
    await h.shot("wheel-built");

    h.step("reopening does not migrate twice; pb_park_v1_backup survives");
    await frame.evaluate(() => window.__fouerGame.game.flushSave());
    await h.pause(600);
    const before = await gameState(frame);
    frame = await openArcade(h);
    h.eq(await frameOf(page).locator(".paper").count(), 0, "no second letter");
    const after = await gameState(frame);
    h.eq([after.pi, after.mg, after.vo, after.built.length], [1, 4059, before.vo, before.built.length], "state is the same (pi, mg, vouchers, attractions)");
    h.expect(after.tb >= before.tb && after.tb < before.tb + 50, `tb did not jump (${Math.floor(before.tb)} -> ${Math.floor(after.tb)}): no second grant of 34,472`);
    h.eq(await page.evaluate(() => localStorage.getItem("pb_park_v1_backup")), MEDIAN, "the v1 backup is still the original");
    // an old cached v1 client opens the park later and overwrites the local save with the v1 blob: the v2 backup (pb_fouer_bak) wins, nothing is granted again
    await frame.evaluate(() => window.__fouerGame.game.flushSave());
    await h.pause(500);
    await page.evaluate((blob) => localStorage.setItem("pb_save_park", blob), MEDIAN);
    frame = await openArcade(h);
    const afterOld = await gameState(frame);
    h.eq(await frameOf(page).locator(".paper").count(), 0, "an old v1 client overwriting the save does not trigger a second migration");
    h.eq([afterOld.pi, afterOld.vo, afterOld.built.length], [1, before.vo, before.built.length], "the v2 progress is restored from the rolling backup");
    h.expect(afterOld.tb >= before.tb, "lifetime value not reset");

    /* ------------------------------------------------------------ 2. untouched park */
    h.step("untouched v1 park: pioneer badge, golden carousel, kiosk, no cash bonus");
    world.cloud = null;
    await seed(h, { pb_save_park: UNTOUCHED });
    frame = await openArcade(h);
    await frameOf(page).locator(".paper").waitFor({ timeout: 15000 });
    const ut = await letterText(frame);
    h.expect(ut.includes("€350") && ut.includes("2,000") && ut.includes("Gëllent Karussell"), `untouched: cash €350, value +2,000, golden carousel (${ut.replace(/\n/g, " ").slice(0, 160)})`);
    await tapLocator(h, frameOf(page).locator(".paper [data-go]"));
    h.eq(await frame.evaluate(() => window.__fouerGame.game.tutorial().item), "gold", "the pioneer tutorial uses the free golden carousel");

    /* ------------------------------------------------------------ 3. corrupt blob */
    h.step("corrupt v1 blob: a thank-you (cash 1,350, golden carousel), no crash");
    await seed(h, { pb_save_park: CORRUPT });
    frame = await openArcade(h);
    await frameOf(page).locator(".paper").waitFor({ timeout: 15000 });
    const ct = await letterText(frame);
    h.expect(ct.includes("Mir konnten däi ale Park net liesen") && ct.includes("€1,350"), `corrupt: apology + €1,350 (${ct.replace(/\n/g, " ").slice(0, 140)})`);
    st = await gameState(frame);
    h.eq([st.pi, Math.round(st.c), st.tb, st.vo], [1, 1350, 2000, []], "pioneer badge, cash 1,350, tb0 2,000, no vouchers");
    h.eq(await page.evaluate(() => localStorage.getItem("pb_park_v1_backup")), CORRUPT, "the corrupt blob is kept as the backup too");
    await h.shot("letter-corrupt");

    /* ------------------------------------------------------------ 4. stub only (the cloud knows the score, the device has nothing) */
    h.step("stub only: the cloud row {v:2, stub:1, pv}, no local save; the letter arrives after the cloud save");
    world.cloud = STUB; world.upserts = [];
    await wipe(h);
    frame = await openArcade(h);
    await frameOf(page).locator(".paper").waitFor({ timeout: 20000 });
    const stubText = await letterText(frame);
    h.expect(stubText.includes("Däi ale Park ass op dësem Apparat net méi do"), "stub letter text");
    h.expect(stubText.includes("34,472") && stubText.includes("€4,409") && /\+68/.test(stubText), "numbers from pv only: +34,472, €4,409, rating +68");
    st = await gameState(frame);
    h.eq([st.pi, Math.round(st.c), st.tb, st.rb, st.vo], [1, 4409, 34472, 68, []], "pioneer from the score alone, no object vouchers");
    await h.shot("letter-stub");
    const deadline = Date.now() + 9000;
    while (Date.now() < deadline && !world.upserts.some((row) => row.data && row.data.v === 2 && !row.data.stub)) await h.pause(250);
    h.expect(world.upserts.some((row) => row.data && row.data.pi === 1 && row.data.tb === 34472), "the migrated v2 save replaces the stub in the cloud (game_saves upsert)");

    /* ------------------------------------------------------------ 5. top-up */
    h.step("top-up: a pioneer opens the game on a second device with a richer v1 park in the cloud");
    const pioneer = (() => {
      const base = sim.createState({ name: "Ian", now: Date.now() });
      return encodeSave({ ...base, pi: 1, mg: 0, tb: 2000, c: 350, rb: 0, tu: 8, t: Math.floor(Date.now() / 1000) });
    })();
    world.cloud = JSON.parse(MEDIAN); world.upserts = [];
    await seed(h, { pb_save_park: JSON.stringify(pioneer) });
    frame = await openArcade(h);
    await frameOf(page).locator(".paper").waitFor({ timeout: 20000 });
    const topText = await letterText(frame);
    h.expect(topText.includes("Däi zweete Park gouf och matgeholl"), "the second park came along");
    st = await gameState(frame);
    h.eq([st.pi, st.mg, st.vo.length, Math.round(st.c)], [1, 4059, 5, 350 + 4059], "progress P 4,059 added once: cash +4,059, five vouchers");
    await tapLocator(h, frameOf(page).locator(".paper [data-go]"));
    // opening again does not top up twice
    await frame.evaluate(() => window.__fouerGame.game.flushSave());
    await h.pause(600);
    const c1 = (await gameState(frame)).c;
    frame = await openArcade(h);
    h.eq(await frameOf(page).locator(".paper").count(), 0, "no second top-up");
    h.expect(Math.abs((await gameState(frame)).c - c1) < 30, "cash unchanged on reopening");

    h.eq(errors.filter((e) => !/lost|restor/i.test(e)), [], "zero console errors in the whole migration run");
  },
};

runIfMain(import.meta.url, flow);
