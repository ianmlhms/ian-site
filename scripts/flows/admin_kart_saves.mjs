/* Flow — admin tabs "🏎️ Kart" and "💾 Saves" (admin-kart.js, admin-saves.js).
 *
 * Kart: latest online races render, a row expands to the players table (badges, connection, dropped, bot-driven),
 *   filter by player and by day, "load older races" (bigger p_limit), empty and error state, name → Saves tab.
 * Saves: search a user, pick a game, live summary + presence, history with a diff against live, Restore with the
 *   confirmation dialog and the "close their game first" helper (close_game command, waits for an idle save and a
 *   player who left the game, then restores), restore now, stop waiting, Gift (amount parsing, safe recipe), live gift
 *   (admin_gift_live, polling until the open game applied it, timeout, the gift list with Cancel; no polling once the dialog is closed).
 * Nothing is fetched until a tab is opened (no polling). Supabase is entirely mocked; all names are made up. */
import { runIfMain } from "./lib.mjs";

const MIN = 60_000;
const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const TRACKS = ["villehaute", "kirchberg", "grund", "belval", "zockerland", "aisbierg", "vulkan", "geeschterschlass"];

function makeRaces() {
  return Array.from({ length: 60 }, (_, i) => {
    const players = [
      { name: i % 3 === 0 ? "Emma" : "Noah", user_id: i % 3 === 0 ? "u-emma" : "u-noah", guest: false, bot: false, place: 1, time_ms: 83456, best_lap_ms: 27500, driver: "jean", link: "p2p" },
      i % 5 === 0
        ? { name: "Lena", user_id: "u-lena", guest: false, bot: false, place: 3, time_ms: 99001, best_lap_ms: 30100, driver: "mia", link: "relay", dropped_at_s: 42, away_s: 12.5 }
        : { name: "Gast42", user_id: null, guest: true, bot: false, place: 3, time_ms: 101222, best_lap_ms: 31000, driver: "tom", link: "mixed", away_s: 0 },
      { name: "Bot Alpha", user_id: null, guest: false, bot: true, place: 2, time_ms: 90000, best_lap_ms: 29000, driver: "bot1" },
    ];
    return {
      id: 1000 - i, created_at: iso(i * 40 * MIN), room: `AB${String(i).padStart(2, "0")}Q`, race_key: `k${i}`, track: TRACKS[i % TRACKS.length],
      mode: i % 4 === 1 ? "gp" : "race", cup: i % 4 === 1 ? "letzebuerg" : null, gp_round: i % 4 === 1 ? 2 : null, laps: 3, weather: "day",
      human_count: 3, reporter: null, players,
    };
  });
}

const USERS = [
  { user_id: "u-emma", username: "Emma", class: "4C6", avatar: "🙂", account_kind: "full", save_games: 3 },
  { user_id: "u-emmi", username: "Emmi", class: null, avatar: "🦊", account_kind: "kart", save_games: 1 },
];

const idleSave = (cash, lifetime, extra = {}) => ({
  v: 1, cash, lifetime, tb: lifetime, rb: lifetime, investors: 2, st: 4, rbc: 3, gd: "", sc: 0, rs: 1, ts: 1, savedAt: 1,
  owned: { shop: 5, cafe: 3 }, managers: { shop: true, cafe: false }, ...extra,
});
const HISTORY = [
  { id: 101, game_id: "idle-empire", saved_at: iso(130 * MIN), recorded_at: iso(120 * MIN), reason: "drop", size_bytes: 280, data: idleSave(8.4e11, 7.5e12, { investors: 12, st: 30, rbc: 9, owned: { shop: 200, cafe: 150 }, managers: { shop: true, cafe: true } }) },
  { id: 102, game_id: "idle-empire", saved_at: iso(26 * 60 * MIN), recorded_at: iso(25 * 60 * MIN), reason: "rolling", size_bytes: 270, data: idleSave(5e10, 6e12, { investors: 8, st: 20, rbc: 6 }) },
  { id: 103, game_id: "idle-empire", saved_at: iso(50 * 60 * MIN), recorded_at: iso(49 * 60 * MIN), reason: "before-restore", size_bytes: 260, data: idleSave(100, 50) },
  { id: 201, game_id: "cookie-clicker", saved_at: iso(5 * 60 * MIN), recorded_at: iso(4 * 60 * MIN), reason: "rolling", size_bytes: 120, data: { v: 1, c: 900, tb: 40000, tc: 800, st: 1, rbc: 0, savedAt: 1, u: [3, 2, 1], cu: [1] } },
  { id: 301, game_id: "train-sim", saved_at: iso(6 * 60 * MIN), recorded_at: iso(5 * 60 * MIN), reason: "rolling", size_bytes: 400, data: { v: 1, tb: 12, career: "c1", hints: true, savedAt: 1, rail: { a: 1, b: 2 }, tram: {} } },
];

export function makeWorld() {
  return {
    races: makeRaces(),
    live: {
      "idle-empire": idleSave(15000, 2.1e6),
      "cookie-clicker": { v: 1, c: 1200, tb: 56000, tc: 900, st: 1, rbc: 0, savedAt: 1, u: [4, 2, 1], cu: [1] },
      "train-sim": { v: 1, tb: 15, career: "c1", hints: true, savedAt: 1, rail: { a: 1, b: 2, c: 3 }, tram: {} },
    },
    history: HISTORY,
    // what the mocked player is doing: before the close_game command he is in the game with a fresh save,
    // afterwards every poll moves one step on
    idleS: 4, page: "/pixelbreak.html?g=idle-empire", seenS: 20,
    script: null, commands: [], restored: [], gifts: [], saveReads: 0,
    liveGifts: [], giftRows: [], giftSteps: null, giftReads: 0, cancelled: [],
  };
}

export function backendFor(world) {
  const userSaves = ({ p_user, p_game }) => {
    world.saveReads += 1;
    if (world.script) {
      const step = world.script.length > 1 ? world.script.shift() : world.script[0];
      world.idleS = step.idleS; world.page = step.page; world.seenS = step.seenS;
    }
    const games = [...new Set([...Object.keys(world.live), ...world.history.map((row) => row.game_id)])].sort()
      .map((game_id) => ({ game_id, updated_at: world.live[game_id] ? iso(world.idleS * 1000) : null, history_count: world.history.filter((row) => row.game_id === game_id).length }));
    if (p_user === "u-emmi") return { now: new Date().toISOString(), user: { id: "u-emmi", username: "Emmi", class: null, avatar: "🦊" }, presence: null, games: [], live: null };
    return {
      now: new Date().toISOString(),
      user: { id: p_user, username: "Emma", class: "4C6", avatar: "🙂" },
      presence: world.page ? { page: world.page, last_seen: iso(world.seenS * 1000), started_at: iso(30 * MIN) } : null,
      games,
      live: p_game && world.live[p_game] ? { game_id: p_game, updated_at: iso(world.idleS * 1000), data: world.live[p_game] } : null,
    };
  };
  return {
    rpc: {
      is_admin: () => true,
      admin_groups: () => [],
      admin_online: () => [],
      leaderboard_tags: () => [],
      admin_user_ids: () => [],
      admin_kart_races: ({ p_limit }) => world.races.slice(0, p_limit),
      admin_find_users: ({ p_query }) => USERS.filter((user) => user.username.toLowerCase().includes(String(p_query).toLowerCase())),
      admin_user_saves: userSaves,
      admin_game_save_history: ({ p_game }) => world.history.filter((row) => row.game_id === p_game),
      issue_client_command: (body) => { world.commands.push(body); return world.commands.length; },
      admin_restore_game_save: ({ p_id }) => {
        const row = world.history.find((item) => item.id === p_id);
        if (!row) return { error: { message: "unknown history entry" } };
        world.restored.push(p_id);
        world.live[row.game_id] = row.data;
        return null;
      },
      admin_gift_live: (body) => {
        if (world.failLive) return { error: { message: world.failLive } };
        world.liveGifts.push(body);
        const row = { id: 500 + world.liveGifts.length, user_id: body.p_user, game_id: body.p_game, amount: body.p_amount, created_by: "admin", created_at: new Date().toISOString(),
          status: "pending", claimed_at: null, applied_at: null, expires_at: iso(-7 * 24 * 60 * MIN) };
        world.giftRows = [row, ...world.giftRows];
        return { id: row.id, game: body.p_game, amount: body.p_amount };
      },
      admin_game_gifts: () => {
        world.giftReads += 1;
        if (world.giftSteps && world.giftRows.length) {
          const status = world.giftSteps.length > 1 ? world.giftSteps.shift() : world.giftSteps[0];
          world.giftRows = world.giftRows.map((row, index) => (index === 0 ? { ...row, status, applied_at: status === "applied" ? new Date().toISOString() : null } : row));
        }
        return { now: new Date().toISOString(), gifts: world.giftRows };
      },
      admin_cancel_gift: ({ p_id }) => {
        const row = world.giftRows.find((item) => item.id === p_id);
        if (!row || row.status !== "pending") return { error: { message: "gift not pending" } };
        world.cancelled.push(p_id);
        world.giftRows = world.giftRows.map((item) => (item.id === p_id ? { ...item, status: "cancelled" } : item));
        return { id: p_id, status: "cancelled" };
      },
      admin_gift_idle: (body) => {
        world.gifts.push(body);
        if (world.failGift) return { error: { message: world.failGift } };
        const live = world.live[body.p_game];
        const field = body.p_game === "idle-empire" ? "cash" : "c";
        const before = live[field];
        world.live[body.p_game] = { ...live, [field]: before + body.p_amount };
        return { game: body.p_game, field, amount: body.p_amount, bump: 1e4, history_id: 999, before, after: before + body.p_amount };
      },
    },
  };
}

const text = (page, selector) => page.locator(selector).first().innerText().then((value) => value.replace(/\s+/g, " ").trim());

async function setTheme(h, mode) {
  await h.page.evaluate((m) => localStorage.setItem("site_theme", JSON.stringify({ mode: m })), mode);
}

async function noOverflow(h, message) {
  const overflow = await h.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  h.expect(!overflow, message);
}

const world = makeWorld();
export const flow = {
  name: "admin-kart-saves",
  backend: backendFor(world),
  async run(h) {
    const { page, backend } = h;
    const consoleErrors = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    // fresh world per run (the object is shared with the backend closures)
    Object.assign(world, makeWorld());
    await h.signIn();
    await page.setViewportSize({ width: 820, height: 1180 });

    h.step("opening the admin page loads nothing from the new tabs");
    await h.goto("/admin.html?pollms=150&waitms=4000&livepollms=150&livems=1500");
    await page.waitForSelector("#tabKart", { state: "visible", timeout: 10000 });
    h.eq(await text(page, "#tabKart"), "🏎️ Kart", "Kart tab label");
    h.eq(await text(page, "#tabSaves"), "💾 Saves", "Saves tab label");
    h.eq(backend.callsTo("admin_kart_races").length + backend.callsTo("admin_find_users").length + backend.callsTo("admin_user_saves").length, 0, "no request for the new tabs before they are opened");

    h.step("Kart tab: latest races, newest first");
    await page.click("#tabKart");
    await page.waitForSelector(".kt-race", { timeout: 8000 });
    h.eq(backend.callsTo("admin_kart_races").map((call) => call.body), [{ p_limit: 25 }], "first load asks for 25 races");
    h.eq(await page.locator(".kt-race").count(), 25, "25 races listed");
    const first = await text(page, ".kt-race");
    h.expect(/AB00Q/.test(first) && /Uewerstad/.test(first) && /3 Mënschen/.test(first), `first row: room, friendly track name, humans (${first})`);
    const second = await page.locator(".kt-race").nth(1).innerText();
    h.expect(/Grand Prix/.test(second) && /Lëtzebuerg Cup/.test(second) && /Ronn 2/.test(second), `GP row shows cup and round (${second.replace(/\s+/g, " ")})`);
    h.expect(/Verbindungsprobleemer/.test(first), "race with a dropped player is flagged");
    h.eq(await page.locator("#panel").evaluate((el) => el.classList.contains("wide-mode")), true, "tab uses the wide layout");
    h.eq(await page.isVisible("#glist"), false, "old list hidden");
    await noOverflow(h, "Kart: no horizontal scroll");
    await h.shot("kart-list-ipad");

    h.step("expand a race: players table");
    await page.click(".kt-race:first-child .kt-head");
    await page.waitForSelector(".kt-players table");
    h.eq(await page.getAttribute(".kt-race:first-child .kt-head", "aria-expanded"), "true", "aria-expanded true");
    const rows = await page.$$eval(".kt-players tbody tr", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    h.eq(rows.length, 3, "three players");
    h.expect(/^1 Emma .*1:23\.456 0:27\.500 P2P/.test(rows[0]), `place 1: name, time, best lap, p2p (${rows[0]})`);
    h.expect(/^2 Bot Alpha Bot /.test(rows[1]), `bot badge (${rows[1]})`);
    h.expect(/^3 Lena .*Relay bei 42 s 12.5 s/.test(rows[2]), `relay player: dropped at 42 s, 12.5 s bot-driven (${rows[2]})`);
    h.eq(await page.locator(".kt-players .kt-user").count(), 2, "account links only for players with an account");
    await h.shot("kart-expanded-ipad");
    await page.click(".kt-race:first-child .kt-head");
    h.eq(await page.locator(".kt-players").count(), 0, "collapses again");

    h.step("a guest shows the guest badge and the mixed connection");
    await page.click(".kt-race:nth-child(2) .kt-head");
    const guestRow = await page.locator(".kt-race:nth-child(2) tbody tr").nth(2).innerText();
    h.expect(/Gast42/.test(guestRow) && /Gaascht/.test(guestRow) && /Gemëscht/.test(guestRow), `guest row (${guestRow.replace(/\s+/g, " ")})`);
    await page.click(".kt-race:nth-child(2) .kt-head");

    h.step("filter by player name");
    const loaded = world.races.slice(0, 25);
    await page.fill("#kartFilterName", "emma");
    const emma = loaded.filter((race) => race.players.some((player) => /emma/i.test(player.name))).length;
    h.eq(await page.locator(".kt-race").count(), emma, `only the ${emma} races with Emma`);
    h.expect(new RegExp(`${emma} vun 25 gelueden Rennen`).test(await text(page, "#kartCount")), "count line");
    await page.click(".kt-race:first-child .kt-head");
    h.eq(await page.locator(".kt-players tr.match").count(), 1, "the matching player is highlighted");
    await page.click(".kt-race:first-child .kt-head");
    await page.fill("#kartFilterName", "zzz");
    h.expect(/Kee Rennen passt/.test(await text(page, ".kt-empty")), "no match message");
    await page.fill("#kartFilterName", "");

    h.step("filter by day");
    const yesterday = new Date(NOW - 24 * 60 * MIN);
    const yesterdayCount = loaded.filter((race) => dayKey(new Date(race.created_at)) === dayKey(yesterday)).length;
    await page.fill("#kartFilterDay", dayKey(yesterday));
    h.eq(await page.locator(".kt-race").count(), yesterdayCount, `${yesterdayCount} races yesterday`);
    await page.fill("#kartFilterName", "lena");
    const both = loaded.filter((race) => dayKey(new Date(race.created_at)) === dayKey(yesterday) && race.players.some((player) => /lena/i.test(player.name))).length;
    h.eq(await page.locator(".kt-race").count(), both, "day and name together");
    await page.click("[data-kart-clear]");
    h.eq(await page.locator(".kt-race").count(), 25, "clear filters shows all again");

    h.step("load older races = bigger p_limit; no extra requests while filtering");
    const callsBefore = backend.callsTo("admin_kart_races").length;
    await page.fill("#kartFilterName", "emma");
    await page.fill("#kartFilterName", "");
    h.eq(backend.callsTo("admin_kart_races").length, callsBefore, "filters are client-side");
    await page.click("[data-kart-more]");
    await page.waitForFunction(() => document.querySelectorAll(".kt-race").length === 60);
    h.eq(backend.callsTo("admin_kart_races").at(-1).body, { p_limit: 75 }, "second request asks for 75");
    h.eq(await page.locator("[data-kart-more]").count(), 0, "no more button once everything is loaded");

    h.step("leaving and coming back does not refetch; Refresh does");
    await page.click("#tabOnline");
    await page.click("#tabKart");
    await page.waitForSelector(".kt-race");
    h.eq(backend.callsTo("admin_kart_races").length, callsBefore + 1, "tab switch does not refetch");
    await page.click("[data-kart-refresh]");
    await h.pause(300);
    h.eq(backend.callsTo("admin_kart_races").length, callsBefore + 2, "Refresh fetches again");

    h.step("empty state and error state");
    const keepRaces = world.races;
    world.races = [];
    await page.click("[data-kart-refresh]");
    await page.waitForSelector(".kt-empty");
    h.expect(/Nach keng Online-Rennen/.test(await text(page, ".kt-empty")), "empty state text");
    await h.shot("kart-empty-ipad");
    world.races = keepRaces;
    const errorsBefore = consoleErrors.length;
    const okRpc = backend.rpc.admin_kart_races;
    backend.rpc.admin_kart_races = () => ({ error: { message: "boom" } });
    await page.click("[data-kart-refresh]");
    await page.waitForSelector(".wide-note.bad");
    h.expect(/konnten net gelueden/.test(await text(page, ".wide-note.bad")), "error message shown");
    backend.rpc.admin_kart_races = okRpc;
    consoleErrors.length = errorsBefore;   // the logged failure above is the intended one
    await page.click("[data-kart-refresh]");
    await page.waitForSelector(".kt-race");

    h.step("name with an account opens the Saves tab for that user");
    await page.click(".kt-race:first-child .kt-head");
    await page.click(".kt-players .kt-user >> text=Emma");
    await page.waitForSelector(".sv-game");
    h.eq(backend.callsTo("admin_user_saves").at(-1).body, { p_user: "u-emma" }, "saves of Emma requested");
    h.eq(await page.locator("#tabSaves").evaluate((el) => el.classList.contains("active")), true, "Saves tab active");
    h.eq(await page.locator(".sv-game").count(), 3, "games with saves listed");

    h.step("Saves tab: search");
    await page.click("#tabKart");
    await page.click("#tabSaves");
    await page.fill("#svSearch", "em");
    await page.click("#svSearchBtn");
    await page.waitForSelector(".sv-result");
    h.eq(backend.callsTo("admin_find_users").at(-1).body, { p_query: "em" }, "search sent");
    h.eq(await page.locator(".sv-result").count(), 2, "two matches");
    const resultText = await page.locator(".sv-results").innerText();
    h.expect(/Emma/.test(resultText) && /3 Spiller/.test(resultText) && /Kart/.test(resultText) && /1 Spill/.test(resultText), `results show games count and kart tag (${resultText.replace(/\s+/g, " ")})`);
    await page.fill("#svSearch", "nobody");
    await page.click("#svSearchBtn");
    await page.waitForSelector("#svResults .wide-note:has-text('Kee Benotzer')");
    h.expect(/Kee Benotzer fonnt/.test(await text(page, "#svResults")), "no user found");
    await page.fill("#svSearch", "em");
    await page.click("#svSearchBtn");
    await page.waitForSelector(".sv-result");

    h.step("pick a user (no saves) and a user with saves");
    await page.click('.sv-result[data-name="Emmi"]');
    await page.waitForSelector(".sv-user .wide-note:has-text('keng Späicherstänn')");
    h.expect(/keng Späicherstänn/.test(await text(page, ".sv-user")), "user without saves: clear message");
    await page.click('.sv-result[data-name="Emma"]');
    await page.waitForSelector(".sv-game");
    h.eq(backend.callsTo("admin_user_saves").filter((call) => call.body.p_game).length, 0, "a user with several games loads no game until one is picked");
    const gamesBefore = backend.callsTo("admin_game_save_history").length;

    h.step("pick a game: live summary, presence, history with diff");
    await page.click('.sv-game[data-game="idle-empire"]');
    await page.waitForSelector(".sv-row");
    h.eq(backend.callsTo("admin_game_save_history").length, gamesBefore + 1, "history fetched once for the game");
    h.eq(backend.callsTo("admin_game_save_history").at(-1).body, { p_user: "u-emma", p_game: "idle-empire" }, "history request");
    const live = await text(page, ".sv-card");
    h.expect(/Business Empire/.test(live) && /Cash 15 K/.test(live) && /Insgesamt 2,1 M/.test(live) && /Stären 4/.test(live) && /Rebirths 3/.test(live) && /Besëtz \(Total\) 8/.test(live) && /Manager 1/.test(live), `live summary of Business Empire (${live})`);
    h.expect(/Investisseuren 2/.test(live), "investors");
    const presence = await text(page, ".sv-presence");
    h.expect(/pixelbreak|Arcade · idle-empire/.test(presence) && /um Spill/.test(presence), `presence: on the game page (${presence})`);
    h.eq(await page.locator(".sv-row").count(), 3, "three history rows");
    const row0 = await text(page, ".sv-row");
    h.expect(/grousse Réckgang/.test(row0) && /Cash 840 B/.test(row0) && /Stären 30/.test(row0), `drop row summary (${row0})`);
    h.expect(/live méi niddreg/.test(row0) && /Cash 840 B → 15 K/.test(row0) && /Investisseuren 12 → 2/.test(row0) && /Rebirths 9 → 3/.test(row0), `diff vs live lists what dropped (${row0})`);
    const row2 = await text(page, ".sv-row:nth-child(3)");
    h.expect(/virum Restore/.test(row2) && /live méi héich/.test(row2), `old low state: live is higher (${row2})`);
    h.eq(await page.locator("#svGiftForm").count(), 1, "gift card for an idle game");
    await noOverflow(h, "Saves: no horizontal scroll");
    await h.shot("saves-game-ipad");

    h.step("restore with 'close their game first'");
    await page.click('[data-restore="101"]');
    await page.waitForSelector("dialog[open]");
    const dlg = await text(page, "dialog[open]");
    h.expect(/Späicherstand zeréckspillen/.test(dlg) && /Opgepasst/.test(dlg) && /offen|oppen/.test(dlg) && /lokal/.test(dlg), `confirmation explains the device caveat (${dlg.slice(0, 140)})`);
    h.expect(await page.isVisible("#svCloseFirst") && await page.isVisible("#svNow") && await page.isVisible("#svCancel"), "three choices");
    await h.shot("saves-dialog-ipad");
    world.script = [
      { idleS: 20, page: "/pixelbreak.html?g=idle-empire", seenS: 10 },
      { idleS: 60, page: "/pixelbreak.html?g=idle-empire", seenS: 5 },
      { idleS: 120, page: "/index.html", seenS: 4 },
    ];
    const readsBefore = world.saveReads;
    await page.click("#svCloseFirst");
    await page.waitForSelector(".sv-progress progress");
    h.expect(/Kommando «Spill zoumaachen» geschéckt/.test(await text(page, "#svProgress")), "progress: command sent");
    h.eq(world.commands.length, 1, "one close_game command issued");
    h.eq(world.commands[0], { p_action: "close_game", p_user: "u-emma", p_game: "idle-empire", p_reason: null, p_minutes: 15 }, "command targets the player and the game");
    h.eq(world.restored, [], "nothing restored while the player is still in the game");
    await page.waitForSelector("#svDone", { timeout: 8000 });
    h.expect(/Restore gemaach/.test(await text(page, "#svProgress")), "restore reported");
    h.eq(world.restored, [101], "restore of the chosen entry");
    const names = backend.calls.filter((call) => ["issue_client_command", "admin_restore_game_save"].includes(call.name)).map((call) => call.name);
    h.eq(names, ["issue_client_command", "admin_restore_game_save"], "command first, restore after");
    h.expect(world.saveReads - readsBefore >= 3, `waited with several small status reads (${world.saveReads - readsBefore})`);
    await h.shot("saves-restored-ipad");
    await page.click("#svDone");
    await page.waitForSelector("dialog[open]", { state: "detached" });
    await page.waitForSelector(".wide-note.good");
    h.expect(/Cash 840 B/.test(await text(page, ".sv-card")), "live summary refreshed after the restore");
    h.expect(await page.locator(".sv-row").count() === 3, "history reloaded");

    h.step("player already out of the game: no command, restores right away");
    world.script = null; world.idleS = 600; world.page = "/index.html"; world.seenS = 400;
    const commandsBefore = world.commands.length;
    await page.click('[data-restore="102"]');
    await page.click("#svCloseFirst");
    await page.waitForSelector("#svDone", { timeout: 8000 });
    h.eq(world.commands.length, commandsBefore, "no command when the save is idle and the player is elsewhere");
    h.eq(world.restored, [101, 102], "second restore done");
    await page.click("#svDone");

    h.step("restore now (no waiting) and stop waiting");
    await page.click('[data-restore="103"]');
    await page.click("#svNow");
    await page.waitForSelector("#svDone");
    h.eq(world.restored, [101, 102, 103], "direct restore");
    h.eq(world.commands.length, commandsBefore, "still no command");
    await page.click("#svDone");
    world.idleS = 3; world.page = "/pixelbreak.html?g=idle-empire"; world.seenS = 10;
    world.script = [{ idleS: 5, page: "/pixelbreak.html?g=idle-empire", seenS: 5 }];
    await page.click('[data-restore="101"]');
    await page.click("#svCloseFirst");
    await page.waitForSelector("#svCancel:has-text('Waarden ofbriechen')");
    await page.click("#svCancel");
    await page.waitForFunction(() => /Ofgebrach/.test(document.querySelector("#svProgress")?.innerText || ""));
    h.eq(world.restored, [101, 102, 103], "stop waiting restores nothing");
    h.eq(world.commands.length, commandsBefore + 1, "the command had been sent");
    await page.click("#svCancel");
    await page.waitForSelector("dialog[open]", { state: "detached" });
    // the wait times out (waitms=4000) if the player never leaves
    await page.click('[data-restore="101"]');
    await page.click("#svCloseFirst");
    await page.waitForFunction(() => /Zäitiwwerschreidung/.test(document.querySelector("#svProgress")?.innerText || ""), null, { timeout: 12000 });
    h.eq(world.restored, [101, 102, 103], "timeout restores nothing");
    await page.click("#svCancel");
    world.script = null;

    h.step("gift: amount checks");
    await page.fill("#svGiftAmount", "abc");
    await page.click("#svGiftForm button[type=submit]");
    h.expect(/Ongültege Betrag/.test(await text(page, "#svGiftErr")), "text is not an amount");
    await page.fill("#svGiftAmount", "1e31");
    await page.click("#svGiftForm button[type=submit]");
    h.expect(/Ongültege Betrag/.test(await text(page, "#svGiftErr")), "above 1e30 refused");
    await page.fill("#svGiftAmount", "0");
    await page.click("#svGiftForm button[type=submit]");
    h.expect(/Ongültege Betrag/.test(await text(page, "#svGiftErr")), "zero refused");
    h.eq(world.gifts.length, 0, "nothing sent");

    h.step("gift: close first (already quiet), then admin_gift_idle");
    world.idleS = 900; world.page = null;
    await page.fill("#svGiftAmount", "2,5M");
    await page.click("#svGiftForm button[type=submit]");
    await page.waitForSelector("dialog[open]");
    h.expect(/Kaddo schécken/.test(await text(page, "dialog[open]")) && /2,5 M/.test(await text(page, "dialog[open]")) && /Leaderboard/.test(await text(page, "dialog[open]")), "gift dialog names the amount and the leaderboard effect");
    await h.shot("saves-gift-dialog-ipad");
    const cmds = world.commands.length;
    await page.click("#svCloseFirst");
    await page.waitForSelector("#svDone", { timeout: 8000 });
    h.eq(world.gifts, [{ p_user: "u-emma", p_game: "idle-empire", p_amount: 2500000 }], "gift RPC with the parsed amount");
    h.eq(world.commands.length, cmds, "quiet player: no command");
    h.expect(/Kaddo geschéckt/.test(await text(page, "#svProgress")), "gift reported");
    await page.click("#svDone");
    await page.waitForSelector("dialog[open]", { state: "detached" });
    h.expect(/Cash 2,5 M/.test(await text(page, ".sv-card")), `live cash after the gift (${await text(page, ".sv-card")})`);

    h.step("gift: server refusal is shown, nothing else changes");
    world.failGift = "player is on the game page";
    const errorsBeforeGift = consoleErrors.length;
    await page.fill("#svGiftAmount", "5000");
    await page.click("#svGiftForm button[type=submit]");
    await page.click("#svNow");
    await page.waitForSelector("#svDone");
    h.expect(/De Spiller ass um Spill/.test(await text(page, "#svProgress")), "friendly server error");
    await page.click("#svDone");
    world.failGift = null;
    consoleErrors.length = errorsBeforeGift;   // the logged failure is intended

    h.step("live gift: dialog offers «Direkt schécken (live)», the game picks it up, delivered");
    await page.fill("#svGiftAmount", "1,5M");
    await page.click("#svGiftForm button[type=submit]");
    await page.waitForSelector("dialog[open]");
    const liveDialog = await text(page, "dialog[open]");
    h.expect(/während d'Spill oppen ass/.test(liveDialog) && /1,5 M/.test(liveDialog) && /Oder bei zouenem Spill/.test(liveDialog), `live dialog explains both ways (${liveDialog.slice(0, 120)})`);
    h.expect(await page.locator("#svLive.primary").count() === 1 && await page.locator("#svCloseFirst.primary").count() === 0, "«live» is the primary button");
    h.expect(await page.isVisible("#svCloseFirst") && await page.isVisible("#svNow"), "the closed-game ways stay available");
    await h.shot("saves-live-gift-dialog");
    world.giftSteps = ["pending", "pending", "claimed", "applied"];
    const readsBeforeLive = world.giftReads;
    const idleGiftsBefore = world.gifts.length;
    await page.click("#svLive");
    await page.waitForFunction(() => /Waart, bis d'Spill/.test(document.querySelector("#svProgress")?.innerText || ""));
    h.eq(world.liveGifts, [{ p_user: "u-emma", p_game: "idle-empire", p_amount: 1500000 }], "admin_gift_live got the parsed amount");
    h.eq(world.gifts.length, idleGiftsBefore, "the old write-into-the-save RPC was not used");
    await page.waitForFunction(() => /Geliwwert ✓/.test(document.querySelector("#svProgress")?.innerText || ""), null, { timeout: 8000 });
    h.expect(/1,5 M/.test(await text(page, "#svProgress")), "delivery message names the amount");
    h.expect(world.giftReads - readsBeforeLive >= 3, "polled until the status turned applied");
    await page.click("#svDone");
    await page.waitForSelector("dialog[open]", { state: "detached" });
    h.expect(/geliwwert/.test(await text(page, ".sv-gifts")) && /1,5 M/.test(await text(page, ".sv-gifts")), `gift list shows the delivered gift (${await text(page, ".sv-gifts")})`);
    const readsDone = world.giftReads;
    await h.pause(700);
    h.eq(world.giftReads, readsDone, "no polling once the dialog is closed");

    h.step("live gift: nobody picks it up -> stays pending, can be cancelled from the list");
    world.giftSteps = ["pending"];
    await page.fill("#svGiftAmount", "300");
    await page.click("#svGiftForm button[type=submit]");
    await page.click("#svLive");
    await page.waitForFunction(() => /Nach net ofgeholl/.test(document.querySelector("#svProgress")?.innerText || ""), null, { timeout: 8000 });
    h.expect(/d'nächst Kéier/.test(await text(page, "#svProgress")), "timeout text promises delivery on the next open");
    await page.click("#svDone");
    await page.waitForSelector("dialog[open]", { state: "detached" });
    h.eq(await page.locator("[data-cancel-gift]").count(), 1, "only the pending gift has a Cancel button");
    h.expect(/ausstoend/.test(await text(page, ".sv-gift-row")), `pending gift is first in the list (${await text(page, ".sv-gift-row")})`);
    world.giftSteps = null;   // from here the mocked server keeps what it has
    await page.click("[data-cancel-gift]");
    await page.waitForFunction(() => document.querySelectorAll("[data-cancel-gift]").length === 0);
    h.eq(world.cancelled, [502], "admin_cancel_gift for the pending gift");
    h.expect(/ofgebrach/.test(await text(page, ".sv-gifts")), "list shows it cancelled");

    h.step("live gift: stop waiting keeps the gift pending; server refusal is shown");
    world.giftSteps = ["pending"];
    await page.fill("#svGiftAmount", "10");
    await page.click("#svGiftForm button[type=submit]");
    await page.click("#svLive");
    await page.waitForFunction(() => /Waart, bis d'Spill/.test(document.querySelector("#svProgress")?.innerText || ""));
    await page.click("#svCancel");
    await page.waitForFunction(() => /Mam Waarden opgehalen/.test(document.querySelector("#svProgress")?.innerText || ""));
    await page.click("#svDone");
    await page.waitForSelector("dialog[open]", { state: "detached" });
    h.eq(world.giftRows[0].status, "pending", "stopping the wait does not cancel the gift");
    world.failLive = "game not allowed";
    const errorsBeforeLive = consoleErrors.length;
    await page.fill("#svGiftAmount", "10");
    await page.click("#svGiftForm button[type=submit]");
    await page.click("#svLive");
    await page.waitForSelector("#svDone");
    h.expect(/game not allowed/.test(await text(page, "#svProgress")), "server error shown");
    await page.click("#svDone");
    world.failLive = null;
    consoleErrors.length = errorsBeforeLive;   // the logged failure is intended

    h.step("generic summary for other games; no gift card");
    await page.click('.sv-game[data-game="train-sim"]');
    await page.waitForFunction(() => /Train Sim/.test(document.querySelector(".sv-card")?.innerText || ""));
    const generic = await text(page, ".sv-card");
    h.expect(/tb 15/.test(generic) && /rail 3/.test(generic), `generic fallback: top-level numbers and sizes (${generic})`);
    h.eq(await page.locator("#svGiftForm").count(), 0, "no gift card for a game that is not an idle game");
    await page.click('.sv-game[data-game="cookie-clicker"]');
    await page.waitForFunction(() => /Cookie Clicker/.test(document.querySelector(".sv-card")?.innerText || ""));
    const cookie = await text(page, ".sv-card");
    h.expect(/Gebak \(insgesamt\) 56 K/.test(cookie) && /Cookien 1,2 K/.test(cookie) && /Gebaier \(Total\) 7/.test(cookie), `Cookie Clicker summary (${cookie})`);
    h.expect(/Gläich wéi de live|live méi/.test(await text(page, ".sv-row")), "diff line on the cookie history row");

    h.step("desktop and mobile layouts, de/en texts, light theme");
    await page.setViewportSize({ width: 1440, height: 900 });
    await h.shot("saves-game-desktop");
    await page.click("#tabKart");
    await page.waitForSelector(".kt-race");
    await page.click(".kt-race:first-child .kt-head");
    await h.shot("kart-expanded-desktop");
    await page.setViewportSize({ width: 375, height: 800 });
    await noOverflow(h, "Kart: no horizontal scroll on a phone");
    await h.shot("kart-expanded-phone");
    await page.click("#tabSaves");
    await noOverflow(h, "Saves: no horizontal scroll on a phone");
    await h.shot("saves-game-phone");
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.evaluate(() => localStorage.setItem("site_lang", "en"));
    await setTheme(h, "light");
    await h.goto("/admin.html#kart");
    await page.waitForSelector(".kt-race");
    h.eq(await text(page, "#tabKart"), "🏎️ Kart", "English tab label");
    h.expect(/Upper Town/.test(await text(page, ".kt-race")) && /3 humans/.test(await text(page, ".kt-race")), "English race row");
    await h.shot("kart-light-ipad");
    await page.evaluate(() => localStorage.setItem("site_lang", "de"));
    await h.goto("/admin.html?de=1#saves");
    await page.waitForSelector("#svSearch");
    h.expect(/Spielstände eines Benutzers/.test(await text(page, ".wide-bar h2")), "German texts");
    await h.shot("saves-search-de-light-ipad");
    await setTheme(h, "dark");
    await page.evaluate(() => localStorage.setItem("site_lang", "lb"));

    h.step("the old Groups layout still fits the six tabs");
    await page.setViewportSize({ width: 1440, height: 900 });
    await h.goto("/admin.html?groups=1");
    await page.waitForSelector("#tabSaves", { state: "visible" });
    await noOverflow(h, "Groups: no horizontal scroll with six tabs");
    h.eq(await page.locator(".tabs .tab").count(), 6, "six tabs");
    await h.shot("groups-desktop");

    h.eq(consoleErrors, [], "0 console errors");
  },
};

runIfMain(import.meta.url, flow);
