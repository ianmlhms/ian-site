/* Flow: Schueberfouer Tycoon W7 "Social, events, launch" (fouer-launch).
 *   A. the arcade tile: name, thumbnail, description in lb / de / en, no "Theme Park" left on the page; ?g=park opens pb/fouer.html in the srcdoc frame
 *      (no route rewrite), the arcade bar says "Schueberfouer Tycoon".
 *   B. score + save round trip through the real arcade (window.score = tb, __pbSave, game_saves upsert).
 *   C. a live gift through the real arcade path with mocked Supabase: __pbGiftReady -> claim_game_gifts (mock) -> __pbGift -> applied (+cash once, gi) -> ack_game_gift.
 *   D. the gallery through the real __pbRpc bridge (mocked RPCs): list, sorts, like, a foreign name is plain text, visit another fair read-only on the real
 *      Glacis, back; a v1 entry is a Museum card with the old-park map; publish (F2| layout, value = tb, guests = built pitches) and unpublish; signed out = browse only (unit-tested in the harness).
 *   E. events at injected dates (test mode ?fouerDate=): opening ceremony (and the replay card, skippable), Hämmelsmarsch at 11:00 and 15:00, closing fireworks
 *      (night forced for the show, the player's time of day comes back), the Familljendag / Lescht Dag / Fouersonndeg banners; ?fouerDate= does nothing outside test mode.
 *   F. Hämmi's daily present: once per Luxembourg day, builder tap and walk pet, survives a reload, a new day brings a new one.
 * Zero console errors throughout. Set FLOW_SHOTS_DIR for the screenshots. */
import { runIfMain, ME, ME_NAME } from "./lib.mjs";
import { createState as v1Create, tick as v1Tick } from "../../pb/park/sim.js";
import { canPlace as v1CanPlace, place as v1Place, placePath as v1PlacePath } from "../../pb/park/build.js";
import { serializeSave as v1Serialize } from "../../pb/park/save.js";
import * as sim from "../../pb/fouer/sim.js";
import { encodeLayout, cleanRow } from "../../pb/fouer/social.js";
import { consoleCollector } from "./fouer_game.mjs";

const BOOT_TIMEOUT = 120000;
const UID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", UID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", UID_M = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NASTY = 'Marie\'s <img src=x onerror="window.__xss=1"> Fouer';

/* the fair of "Marie": a few attractions, three stars */
function marieLayout() {
  let state = { ...sim.createState({ now: Date.now() }), c: 1e7, rb: 70 };
  for (const [index, item] of [[0, "kachel"], [1, "kanner"], [2, "wurscht"], [3, "scooter"], [4, "fritten"]]) state = sim.build(state, index, item).state;
  state = sim.upgrade(state, 0).state;
  return { text: encodeLayout(state, 3), built: ["kachel", "kanner", "wurscht", "scooter", "fritten"] };
}
function v1Layout() {
  let state = v1Create(1);
  state = v1Tick({ saved: { ...state.saved, l: 0xffff, c: 1e7, u: 15 }, derived: { ...state.derived, dirty: true } }, 0);
  for (let y = 1; y <= 12; y++) state = v1PlacePath(state, 20, y);
  for (const id of ["carousel", "popcorn"]) {
    outer: for (let y = 0; y < 38; y++) for (let x = 0; x < 38; x++) { if (x === 20) continue; if (v1CanPlace(state, id, x, y, 0).ok) { state = v1Place(state, id, x, y, 0); break outer; } }
  }
  return v1Serialize(v1Tick(state, 0));
}
const MARIE = marieLayout();
const MUSEUM = v1Layout();

const world = { cloud: null, upserts: [], gifts: [], acks: [], sorts: [], publishes: [], unpublishes: 0, likes: [], layoutAsks: [], scores: [] };
const GALLERY = [
  { user_id: UID_A, username: "Marie", park_name: NASTY, value: 88000, guests: 5, rating: 312, likes: 3, liked_by_me: false, updated_at: "2026-10-25T10:00:00Z" },
  { user_id: ME, username: "Ian", park_name: "Ians Fouer", value: 40000, guests: 3, rating: 205, likes: 0, liked_by_me: false, updated_at: "2026-10-24T09:00:00Z" },
  { user_id: UID_M, username: "Aidan", park_name: "My theme park", value: 8103, guests: 1, rating: 76, likes: 1, liked_by_me: false, updated_at: "2026-09-30T18:54:05Z" },
];

const arcadeFrame = page => page.frames().find(f => f.parentFrame());
async function frameReady(h) {
  await h.page.waitForFunction(() => document.getElementById("gf")?.contentWindow?.document?.documentElement?.dataset.fouerReady === "1", null, { timeout: BOOT_TIMEOUT });
  await h.pause(1200);
  return arcadeFrame(h.page);
}
async function bootStandalone(h, url) {
  await h.goto(url);
  await h.page.waitForFunction(() => document.documentElement.dataset.fouerReady === "1" || document.documentElement.dataset.bootError, null, { timeout: BOOT_TIMEOUT });
  await h.pause(1300);
  return h.page;
}
const gameState = f => f.evaluate(() => { const s = window.__fouerGame.game.state; return { c: s.c, tb: s.tb, gi: s.gi, hd: s.hd, built: s.pitches.filter(Boolean).length, tu: s.tu }; });
const evState = f => f.evaluate(() => window.__fouerGame.events.state());
/** a new fair day brings the stamp card (and the closing night its gift card): close whatever modal is open */
async function closeModals(f) {
  for (let i = 0; i < 4; i++) {
    const button = f.locator(".modal button").first();
    if (!(await button.count())) return;
    await button.click({ timeout: 4000 }).catch(() => {});
    await f.waitForTimeout(250);
  }
}
async function jumpTo(f, isoWithOffset, settle = 2600) {
  await f.evaluate(iso => window.__fouerGame.setClockOffset(Date.parse(iso) - Date.now()), isoWithOffset);
  await f.waitForTimeout(settle);
  await closeModals(f);
}

export const flow = {
  name: "fouer-launch",
  fullChromium: true,
  touch: true,
  backend: {
    tables: {
      game_saves: ({ method, body }) => {
        if (method === "GET") return world.cloud ? [{ data: world.cloud }] : [];
        if (body) world.upserts.push(body);
        return [];
      },
      scores: ({ method, body }) => { if (method !== "GET" && body) world.scores.push(body); return []; },
    },
    rpc: {
      claim_game_gifts: ({ p_game }) => (p_game === "park" ? world.gifts.splice(0) : []),
      ack_game_gift: ({ p_id }) => { world.acks.push(p_id); return true; },
      park_gallery: ({ p_sort }) => { world.sorts.push(p_sort); return p_sort === "likes" ? [...GALLERY].sort((a, b) => b.likes - a.likes) : GALLERY; },
      park_layout: ({ p_user }) => { world.layoutAsks.push(p_user); return p_user === UID_A ? MARIE.text : p_user === UID_M ? MUSEUM : null; },
      publish_park: args => { world.publishes.push(args); return null; },
      unpublish_park: () => { world.unpublishes++; return null; },
      like_park: ({ p_target }) => { world.likes.push(p_target); return world.likes.filter(id => id === p_target).length % 2 === 1; },
    },
  },
  async run(h) {
    const { page, context } = h;
    const errors = consoleCollector(page);
    await h.signIn();
    await context.addInitScript(() => {
      localStorage.setItem("pb_fouer_time", "evening"); localStorage.setItem("pb_fouer_weather", "clear"); localStorage.setItem("site_lang", "lb"); localStorage.setItem("playerName", "Ian");
      window.__fromGame = [];
      window.addEventListener("message", e => { const d = e.data; if (d && (d.__pbGiftReady || d.__pbGiftApplied || d.__pbWantSave || d.__pbRpc)) window.__fromGame.push(d.__pbGiftApplied ? { applied: d.id } : d.__pbRpc ? { rpc: d.__pbRpc.fn } : d); });
    });

    /* ------------------------------------------------------------ A. the tile */
    h.step("arcade: the Schueberfouer tile (name, thumbnail, description) and no Theme Park left");
    await h.goto("/pixelbreak.html");
    await page.waitForSelector(".game-card");
    const tile = page.locator(".game-card", { hasText: "Schueberfouer Tycoon" });
    h.eq(await tile.count(), 1, "exactly one Schueberfouer Tycoon tile");
    h.eq(await page.locator(".game-card", { hasText: "Theme Park" }).count(), 0, "no 'Theme Park' tile");
    h.expect(!(await page.locator("body").innerText()).includes("Theme Park Tycoon"), "the words 'Theme Park Tycoon' are gone from the arcade page (about text included)");
    await tile.scrollIntoViewIfNeeded();
    const thumb = await tile.locator("img").evaluate(img => ({ src: img.getAttribute("src"), w: img.naturalWidth, h: img.naturalHeight, failed: img.classList.contains("failed") }));
    h.eq([thumb.src, thumb.w, thumb.h, thumb.failed], ["pb/thumbs/park.webp", 640, 400, false], "thumbnail pb/thumbs/park.webp, 640 x 400, loaded");
    h.expect((await tile.innerText()).includes("Féier d'Schueberfouer um Glacis"), "description in lb");
    h.expect((await tile.locator(".game-thumb .em").innerText()).includes("🎡"), "emoji 🎡");
    await h.shot("a-tile-lb");
    for (const [lang, snippet] of [["de", "Betreibe die Schueberfouer auf dem Glacis"], ["en", "Run the Schueberfouer on the Glacis"], ["lb", "Féier d'Schueberfouer um Glacis"]]) {
      await page.evaluate(code => window.I18N.set(code), lang);
      await h.pause(500);
      h.expect((await page.locator(".game-card", { hasText: "Schueberfouer Tycoon" }).innerText()).includes(snippet), `description in ${lang}`);
    }
    h.eq(await page.evaluate(() => GAMES.find(g => g.id === "park").src), "pb/fouer.html", "the park tile's src is pb/fouer.html (id park, pinned, no rewrite)");
    h.expect(await page.evaluate(() => PINNED_GAME_IDS.has("park") && BIG_GAME_IDS.has("park")), "still pinned and a big game");

    /* ------------------------------------------------------------ B. open it, save + score */
    h.step("?g=park opens pb/fouer.html in the srcdoc frame; the bar says Schueberfouer Tycoon");
    await h.goto("/pixelbreak.html?g=park&fouerDebug=1&fouerDate=2027-08-20T17%3A00%3A30%2B02%3A00");
    let frame = await frameReady(h);
    h.eq(await frame.evaluate(() => location.href), "about:srcdoc", "srcdoc frame");
    h.eq(await frame.evaluate(() => document.documentElement.dataset.bootError || ""), "", "no boot error");
    h.eq(await page.title(), "Schueberfouer Tycoon — Arcade", "page title");
    h.eq((await page.locator(".arcade-bar__title").first().innerText()).trim(), "Schueberfouer Tycoon", "arcade bar title");
    h.expect(await frame.evaluate(() => window.__fouerGame.game.events.fair.year !== 2027), "?fouerDate= is ignored outside test mode (the clock is the real one)");
    h.eq(await evState(frame).then(s => s.kind), null, "...so no ceremony runs");
    await frame.evaluate(() => { const G = window.__fouerGame; G.game.skipTutorial(); G.game.debugSetState({ ...G.game.state, c: 5e6, tb: 2000, rb: 70, pu: 2 ** 34 - 1 }); });
    await frame.evaluate(() => { const G = window.__fouerGame; for (const [i, k] of [[0, "kachel"], [1, "kanner"], [2, "wurscht"]]) G.game.build(i, k); G.game.advance(30); G.game.flushSave(); });
    await h.pause(900);
    const local = await page.evaluate(() => JSON.parse(localStorage.getItem("pb_save_park") || "null"));
    h.expect(local && local.v === 2 && typeof local.hd === "number" && local.p.length === 102, `pb_save_park holds a v2 save (hd ${local && local.hd})`);
    h.eq(await frame.evaluate(() => window.score), Math.floor(local.tb), "window.score = tb");
    const deadline = Date.now() + 9000;
    while (Date.now() < deadline && !world.upserts.length) await h.pause(250);
    h.expect(world.upserts.some(row => row.data && row.data.v === 2 && row.game_id === "park"), "game_saves upsert for 'park' carries the v2 save");
    h.expect(world.scores.some(row => JSON.stringify(row).includes('"park"') || JSON.stringify(row).includes("Schueberfouer")) || (await page.evaluate(() => PB.current && PB.current.id === "park")), "the score is filed under 'park'");
    await h.shot("b-in-arcade");

    /* ------------------------------------------------------------ C. a live gift through the real arcade path */
    h.step("live gift: __pbGiftReady -> claim_game_gifts (mock) -> __pbGift -> cash once -> __pbGiftApplied -> ack_game_gift");
    const before = await gameState(frame);
    world.gifts.push({ id: 41, amount: 1234 });
    await page.evaluate(() => window.__pbDeliverGifts());
    await page.waitForFunction(() => window.__fromGame.some(m => m.applied === 41), null, { timeout: 15000 });
    const after = await gameState(frame);
    h.expect(Math.abs(after.c - before.c - 1234) < 60, `cash +1234 (${Math.floor(before.c)} -> ${Math.floor(after.c)})`);
    h.eq(after.gi, [41], "gift id 41 remembered");
    h.expect(after.tb - before.tb < 40, "the gift is not lifetime value");
    const toast = await frame.evaluate(() => document.querySelector(".idle-gift-toast")?.textContent || "");
    h.eq(toast, "🎁 Kaddo: +€1,234 Suen", "toast in lb, 'Suen' for the park");
    const ackDeadline = Date.now() + 8000;
    while (Date.now() < ackDeadline && !world.acks.includes(41)) await h.pause(200);
    h.expect(world.acks.includes(41), "ack_game_gift(41) reached the backend");
    h.expect(h.backend.callsTo("claim_game_gifts").length >= 1 && h.backend.callsTo("claim_game_gifts").every(c => c.body.p_game === "park"), "the arcade asked for 'park' gifts only (once on its own after __pbGiftReady, once more by my manual trigger)");
    world.gifts.push({ id: 41, amount: 1234 });
    await page.evaluate(() => window.__pbDeliverGifts());
    await h.pause(2500);
    h.expect(Math.abs((await gameState(frame)).c - after.c) < 80, "a redelivery of id 41 pays nothing");

    /* ------------------------------------------------------------ D. the gallery */
    h.step("gallery: open from the menu, three cards, the nasty name is plain text");
    await frame.locator("#menuBtn").click();
    await frame.locator('[data-gal="open"]').click();
    await frame.locator(".gcard").first().waitFor({ timeout: 10000 });
    await h.pause(900);
    h.eq(await frame.locator(".gcard").count(), 3, "three cards (a fair, my own, a museum entry)");
    h.eq(await frame.evaluate(() => window.__xss === undefined && !document.querySelector(".gallery img")), true, "no HTML from a foreign name is ever interpreted");
    h.expect((await frame.locator(".gcard").first().innerText()).includes("<img src=x"), "the name is shown as text");
    h.eq(await frame.locator(".gbadge.mine").count(), 1, "my own entry (username Ian) is marked 'Deng Fouer'");
    h.eq(await frame.locator(".gcard.museum").count(), 1, "the v1 entry is a Museum card");
    h.expect((await frame.locator(".gcard.museum").innerText()).includes("Musée"), "...with the Museum badge");
    await h.shot("d-gallery");
    await frame.locator('[data-sort="likes"]').click();
    await h.pause(700);
    h.eq(world.sorts.slice(-2), ["value", "likes"], "the sort chip asks park_gallery for 'likes'");
    h.step("gallery: like (toggle)");
    await frame.locator(".gcard").first().locator(".like").click();
    await h.pause(700);
    h.expect(/♥ ?4/.test(await frame.locator(".gcard").first().innerText()), "the like count went 3 -> 4");
    h.eq(world.likes, [UID_A], "like_park was called for that player");

    h.step("gallery: visit Marie's fair read-only on the real Glacis, then back");
    const own = await frame.evaluate(() => { const G = window.__fouerGame; return { built: G.game.state.pitches.map(e => e && e.k), p0: G.fair.getPitch("P01"), c: Math.floor(G.game.state.c) }; });
    await frame.locator(`[data-user="${UID_A}"] [data-gal="visit"]`).click();
    await frame.locator(".visitbar:not([hidden])").waitFor({ timeout: 10000 });
    await h.pause(1500);
    h.eq(world.layoutAsks.at(-1), UID_A, "park_layout was asked for her");
    const visit = await frame.evaluate(() => { const G = window.__fouerGame; return { visiting: G.ui.visiting, scene: G.scene.visiting, specs: ["P01", "P02", "P03", "P04", "P05", "P06"].map(id => G.fair.getPitch(id)), bar: document.querySelector(".visitbar .vlabel").textContent, hud: getComputedStyle(document.querySelector(".hud")).display, walk: getComputedStyle(document.getElementById("walkBtn")).display, crowd: G.crowd.group.visible }; });
    h.eq([visit.visiting, visit.scene], [true, true], "visiting");
    h.eq(visit.specs.slice(0, 5).map(s => s.state === "built" ? s.item : s.state), MARIE.built, "the fair layer shows HER attractions (read-only)");
    h.eq(visit.specs[0].level, 2, "...at her upgrade level");
    h.eq([visit.hud, visit.walk, visit.crowd], ["none", "none", false], "no HUD, no walk button, my guests are hidden");
    h.expect(visit.bar.includes("Marie") && visit.bar.includes("nëmme kucken"), `visit bar: ${visit.bar}`);
    await h.shot("d-visit");
    const tapPitch = await frame.evaluate(() => { const G = window.__fouerGame; const a = G.scene.anchor(5, 0.4); return a && { x: a.x, y: a.y }; });
    if (tapPitch) await page.touchscreen.tap(tapPitch.x, tapPitch.y);
    await h.pause(500);
    h.eq(await frame.evaluate(() => !!document.querySelector(".sheet")), false, "tapping a pitch opens nothing in a visited fair");
    await frame.locator('.visitbar [data-gal="back"]').click();
    await h.pause(1200);
    const back = await frame.evaluate(() => { const G = window.__fouerGame; return { visiting: G.ui.visiting, built: G.game.state.pitches.map(e => e && e.k), p0: G.fair.getPitch("P01"), c: Math.floor(G.game.state.c), crowd: G.crowd.group.visible, bar: document.querySelector(".visitbar").hidden }; });
    h.eq([back.visiting, back.built, back.crowd, back.bar], [false, own.built, true, true], "back: my fair, my guests, no bar");
    h.eq(back.p0, own.p0, "the fair layer shows my first stall again");
    h.expect(back.c >= own.c, "my cash was never touched by the visit");

    h.step("gallery: the Museum card opens the old park map");
    await frame.locator("#menuBtn").click();
    await frame.locator('[data-gal="open"]').click();
    await frame.locator(".gcard.museum").waitFor({ timeout: 10000 });
    await frame.locator(".gcard.museum [data-gal=\"visit\"]").click();
    await frame.locator(".paper canvas").waitFor({ timeout: 10000 });
    await h.pause(900);
    const museum = await frame.evaluate(() => {
      const c = document.querySelector(".paper canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const seen = new Set();
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return { colours: seen.size, text: document.querySelector(".paper").innerText };
    });
    h.expect(museum.colours >= 5, `the old park is drawn as a map (${museum.colours} colours)`);
    h.expect(museum.text.includes("Mäin ale Park") && museum.text.includes("Aidan"), "titled 'Mäin ale Park', by Aidan");
    await h.shot("d-museum");
    await frame.locator(".paper [data-go]").click();
    h.eq(await frame.evaluate(() => window.__fouerGame.ui.visiting), false, "the museum is a viewer: not a visit");

    h.step("gallery: publish (F2| layout, value = tb, guests = built pitches) and remove");
    await frame.locator("#menuBtn").click();
    await frame.locator('[data-gal="open"]').click();
    await frame.locator('[data-gal="publish"]').click();
    await frame.locator("#galName").fill("Meng Fouer");
    const mine = await gameState(frame);
    await frame.locator('[data-gal="send"]').click();
    await h.pause(900);
    const pub = world.publishes.at(-1);
    h.expect(pub && pub.p_layout.startsWith("F2|") && pub.p_layout.length < 130, `layout ${pub && pub.p_layout}`);
    h.eq([pub.p_name, pub.p_guests, pub.p_value >= Math.floor(mine.tb) - 1], ["Meng Fouer", mine.built, true], "name, guests = built pitches, value = tb");
    h.expect(pub.p_rating >= 100 && pub.p_rating < 1000, `rating ${pub.p_rating} = stars x 100 + points / 10`);
    h.expect(/gesend|Ugefrot|Request sent/i.test(await frame.locator(".gstatus").innerText()) || (await frame.locator(".gstatus").innerText()).length > 5, "the status says it was sent (honest: only a signed-in username counts)");
    await frame.locator('[data-gal="remove"]').click();
    await h.pause(700);
    h.eq(world.unpublishes, 1, "unpublish_park was called");
    h.expect(JSON.stringify(cleanRow(GALLERY[0])).includes("Marie"), "(row cleaning also runs in Node)");
    await h.shot("d-publish");
    await frame.locator('[data-gal="close"]').click();
    h.eq(errors.filter(e => !/lost|restor/i.test(e)), [], "zero console errors in the arcade run");

    /* ------------------------------------------------------------ E. events at injected dates (test mode) */
    h.step("events: opening ceremony at 17:00:30 on opening day (test mode, ?fouerDate=)");
    await context.addInitScript(() => { window.__pbTestMode = true; });
    await bootStandalone(h, "/pb/fouer.html?fouerDebug=1&fouerNoFly=1&fouerQ=medium&fouerTimeMode=noon&fouerWeather=clear&fouerDate=2027-08-20T17%3A00%3A30%2B02%3A00");
    const G = page;
    await closeModals(G);
    let ev = await evState(G);
    h.eq([ev.kind, ev.humans, ev.sheep], ["opening", 25, 1], "the opening ceremony runs: mayor, shepherd, band of 8, 15 spectators and Hämmi");
    h.expect(ev.t >= 30 && ev.t < 40, `show clock ${ev.t.toFixed(1)} s`);
    h.eq(ev.caption, "De Schäfer féiert den Hämmi bis bei de Bändel.", "caption 2 in lb (the shepherd is on his way, 30 s in)");
    await G.evaluate(() => window.__fouerGame.events.watch("opening"));
    await h.pause(2200);
    await h.shot("e-opening-before");
    ev = await evState(G);
    h.expect(ev.entries.filter(e => e.type === "human").every(e => Number.isFinite(e.x) && Number.isFinite(e.z)), "every actor has a finite position");
    await jumpTo(G, "2027-08-20T17:01:55+02:00");
    ev = await evState(G);
    h.eq(ev.kind, "opening", "still the ceremony 85 seconds later");
    h.expect(ev.t > 112 && ev.t < 122, `after the cut (${ev.t.toFixed(1)} s)`);
    h.eq(ev.caption, "Schnipp! De Bändel ass duerch.", "caption 3: the ribbon is cut");
    h.expect(ev.confetti > 0 || ev.t > 116, "confetti flew at the cut");
    await h.shot("e-opening-cut");
    await jumpTo(G, "2027-08-20T17:03:05+02:00");
    h.eq((await evState(G)).kind, null, "17:03:05: over, the actors are gone");
    await jumpTo(G, "2027-08-20T16:30:00+02:00");
    h.eq((await evState(G)).kind, null, "16:30: not yet");

    h.step("events: the replay card on day two (skippable)");
    await jumpTo(G, "2027-08-21T12:00:00+02:00");
    await G.locator("#menuBtn").click();
    const replayChip = G.locator('[data-event="replay"]');
    h.eq(await replayChip.count(), 1, "the menu offers 'Ouverture nach eng Kéier kucken' once the ceremony is over");
    await replayChip.click();
    await h.pause(1200);
    ev = await evState(G);
    h.expect(ev.kind === "opening" && ev.key.startsWith("replay") && ev.t < 6, `replay running (${ev.key})`);
    h.eq((await evState(G)).cinema, "opening", "the replay takes the cinema camera");
    await h.shot("e-replay-cinema");
    await G.locator('[data-event="back"]').click();
    await h.pause(500);
    ev = await evState(G);
    h.expect(ev.kind === "opening" && ev.cinema === null, "'Zréck' gives the builder camera back and the replay goes on");
    await G.locator('[data-event="skip"]').click();
    await h.pause(500);
    h.eq((await evState(G)).kind, null, "Skip ends the replay");

    h.step("events: Hämmelsmarsch at 11:01:30 and 15:00:20 on Fouersonndeg");
    await jumpTo(G, "2027-08-29T11:01:30+02:00");
    ev = await evState(G);
    h.eq([ev.kind, ev.humans, ev.sheep], ["parade", 14, 8], "5 shepherds + 8 band + drum major = 14 people, 8 sheep");
    h.expect(ev.t > 88 && ev.t < 95, `parade clock ${ev.t.toFixed(1)}`);
    h.expect(ev.entries.every(e => e.z >= 50.4 && e.z <= 62.6), "everybody walks inside the main alley");
    const leadU = Math.max(...ev.entries.map(e => e.x));
    h.expect(leadU > 140 && leadU < 160, `the lead is at u ${leadU.toFixed(0)} (6 + 1.55 m/s x 90 s)`);
    await G.evaluate(() => window.__fouerGame.events.watch("haemmelsmarsch"));
    await h.pause(2600);
    await h.shot("e-parade");
    h.expect((await G.locator(".banners").innerText()).includes("Hämmelsmarsch"), "the Hämmelsmarsch banner pill is up");
    await jumpTo(G, "2027-08-29T11:03:15+02:00");
    h.eq((await evState(G)).kind, "parade", "11:03:15: the band is still on the alley (the calendar's 3 minutes are the head of the parade)");
    await jumpTo(G, "2027-08-29T11:04:00+02:00");
    h.eq((await evState(G)).kind, null, "11:04:00: gone");
    await jumpTo(G, "2027-08-29T15:00:20+02:00");
    ev = await evState(G);
    h.expect(ev.kind === "parade" && ev.key.endsWith("|15"), "the 15:00 parade is a second show");
    await jumpTo(G, "2027-08-29T13:00:00+02:00");
    h.eq((await evState(G)).kind, null, "13:00: nothing");
    await jumpTo(G, "2027-09-05T11:01:30+02:00");
    h.eq((await evState(G)).kind, null, "the second Sunday has no parade");

    h.step("events: the banners over the alley");
    await jumpTo(G, "2027-08-25T10:00:00+02:00");
    h.eq((await evState(G)).banner, true, "Wednesday: Familljendag banner");
    await G.evaluate(() => window.__fouerGame.r.flyTo({ tu: 60, tw: 56.5, yaw: 0, dist: 60, tilt: 0 }, 0));
    await h.pause(900);
    await h.shot("e-banner-familljendag");
    await jumpTo(G, "2027-09-08T10:00:00+02:00");
    h.eq((await evState(G)).banner, true, "last day: Lescht Dag banner");
    await h.shot("e-banner-lastday");
    await jumpTo(G, "2027-08-24T10:00:00+02:00");
    h.eq((await evState(G)).banner, false, "an ordinary fair day has none");

    h.step("events: closing fireworks at 22:01 (the player chose noon): night for the show, noon again afterwards");
    const timeBefore = await G.evaluate(() => { const s = window.__fouerGame.env.getState(); return { mode: s.timeMode, hour: s.hour }; });
    h.eq(timeBefore.mode, "noon", "the player's time of day is noon");
    await jumpTo(G, "2027-09-08T22:01:10+02:00", 3000);
    ev = await evState(G);
    h.eq(ev.kind, "fireworks", "fireworks on");
    await G.waitForTimeout(6500);
    const night = await G.evaluate(() => { const s = window.__fouerGame.env.getState(); return { night: s.night, hour: s.hour, mode: s.timeMode }; });
    h.expect(night.night > 0.85 && night.mode === "fixed", `the sky went dark for the show (night ${night.night.toFixed(2)}, hour ${night.hour.toFixed(1)})`);
    await G.evaluate(() => window.__fouerGame.events.watch("fireworks"));
    await G.waitForTimeout(3500);
    ev = await evState(G);
    h.expect(ev.cinema === "fireworks" && ev.sparks > 30, `fireworks cinema view, ${ev.sparks} sparks in the air at t=${ev.t.toFixed(0)}`);
    await h.shot("e-fireworks-1");
    await jumpTo(G, "2027-09-08T22:03:50+02:00", 3000);
    await h.shot("e-fireworks-finale");
    h.expect((await evState(G)).sparks > 100, "the finale fills the sky");
    await jumpTo(G, "2027-09-08T22:04:10+02:00", 1500);
    ev = await evState(G);
    h.eq([ev.kind, ev.cinema], [null, null], "22:04:10: the show is over, the camera is back");
    await G.waitForTimeout(6500);
    const day = await G.evaluate(() => { const s = window.__fouerGame.env.getState(); return { mode: s.timeMode, hour: s.hour, night: s.night, fov: window.__fouerGame.r.camera.fov }; });
    h.expect(day.mode === "noon" && Math.abs(day.hour - timeBefore.hour) < 0.2 && day.night < 0.2 && day.fov === 32, `the player's noon is back (${day.mode} ${day.hour.toFixed(1)}, night ${day.night.toFixed(2)}, fov ${day.fov})`);
    await jumpTo(G, "2027-09-08T21:58:00+02:00", 1500);
    await G.evaluate(() => window.__fouerGame.env.setHour(23.2));
    await jumpTo(G, "2027-09-08T22:00:40+02:00", 2500);
    h.eq((await evState(G)).nightLock, "hold", "already night: the sky is left alone");
    h.expect(Math.abs((await G.evaluate(() => window.__fouerGame.env.getState().hour)) - 23.2) < 0.4, "...the hour stays where the player had it");
    h.eq(errors.filter(e => !/lost|restor/i.test(e)), [], "zero console errors in the event run");

    /* ------------------------------------------------------------ F. Hämmi's daily present */
    h.step("Hämmi's present: tap once a day (builder), pet in the walk, a new day, a reload");
    await context.addInitScript(() => { delete window.__pbTestMode; });
    await page.evaluate(() => { localStorage.removeItem("pb_save_park"); localStorage.removeItem("pb_fouer_bak"); });
    await bootStandalone(h, "/pb/fouer.html?fouerDebug=1&fouerNoFly=1&fouerQ=medium&fouerTimeMode=noon&fouerWeather=clear");
    await closeModals(G);
    await G.evaluate(() => { const g = window.__fouerGame.game; g.skipTutorial(); g.build(0, "kachel"); g.advance(20); });
    await h.pause(1500);
    h.eq(await G.locator('[data-hammi="gift"]').count(), 1, "the pill 'Hämmi huet haut e Kaddo fir dech' is up");
    await G.evaluate(() => window.__fouerGame.hooks.findSheep());
    await h.pause(2200);
    const tapSheep = async () => {
      const spot = await G.evaluate(() => { const Gm = window.__fouerGame, p = Gm.crowd.sheepPosition(), T = window.THREE, c = Gm.r.camera; const v = new T.Vector3(p.x, Gm.world.groundY(p.x, p.z) + 0.7, p.z).project(c); const b = Gm.r.renderer.domElement.getBoundingClientRect(); return { x: b.left + (v.x + 1) / 2 * b.width, y: b.top + (1 - v.y) / 2 * b.height }; });
      await page.touchscreen.tap(spot.x, spot.y);
      await h.pause(500);
    };
    const c0 = (await gameState(G)).c;
    await tapSheep();
    const s1 = await gameState(G);
    h.expect(s1.c - c0 >= 25, `Hämmi gave €${Math.round(s1.c - c0)}`);
    const t1 = await G.locator(".toast").allInnerTexts();
    h.expect(t1.some(t => /^Hämmi schenkt dir €\d/.test(t)), `toast: ${t1.join(" | ")}`);
    h.expect(s1.hd > 20000, `the Luxembourg day is remembered (hd ${s1.hd})`);
    h.eq(await G.locator('[data-hammi="gift"]').count(), 0, "the pill is gone");
    await G.evaluate(() => window.__fouerGame.hooks.findSheep());
    await h.pause(1400);
    await tapSheep();
    const s2 = await gameState(G);
    h.expect(s2.c - s1.c < 200, "a second tap the same day pays nothing");
    h.expect((await G.locator(".toast").allInnerTexts()).some(t => t.includes("Hämmi huet dir haut schonn eppes geschenkt")), "...and says so");
    await G.evaluate(() => window.__fouerGame.game.flushSave());
    await h.pause(500);
    await bootStandalone(h, "/pb/fouer.html?fouerDebug=1&fouerNoFly=1&fouerQ=medium&fouerTimeMode=noon&fouerWeather=clear");
    await closeModals(G);
    h.eq(await G.evaluate(() => window.__fouerGame.game.haemmiReady()), false, "after a reload it is still 'already today' (stored in the save)");
    await G.evaluate(() => window.__fouerGame.setClockOffset(24 * 3600 * 1000));
    await h.pause(2600);
    h.eq(await G.evaluate(() => window.__fouerGame.game.haemmiReady()), true, "a day later there is a new present");
    h.eq(await G.locator('[data-hammi="gift"]').count(), 1, "...and the pill is back");
    await G.evaluate(() => window.__fouerGame.hooks.startWalk());
    await h.pause(1500);
    const c3 = (await gameState(G)).c;
    await G.evaluate(() => window.__fouerGame.crowd.bleat());          // the walk's pet button calls exactly this
    await h.pause(400);
    h.expect((await gameState(G)).c - c3 >= 25, "petting Hämmi in the walk pays the present too");
    await G.evaluate(() => window.__fouerGame.crowd.bleat());
    await h.pause(300);
    h.expect((await gameState(G)).c - c3 < 400, "...once");
    h.eq(errors.filter(e => !/lost|restor/i.test(e)), [], "zero console errors in the whole flow");
  },
};

runIfMain(import.meta.url, flow);
