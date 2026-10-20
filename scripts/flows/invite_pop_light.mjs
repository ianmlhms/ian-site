/* The invite popup / banner without WebGL, so it also runs in headless WebKit (run_webkit.mjs): home page, arcade hub, lobby, a game page
 * (popup), a game running in the arcade frame (banner), and no console errors on any of them. Full coverage: invite_pop.mjs. */
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, sleep } from "./mp_lobby_lib.mjs";

const until = async (fn, ms = 20000, step = 100) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return false; await sleep(step); } };
const listening = (hub, uid) => [...hub.topics].some(([topic, mem]) => /invites-/.test(topic) && [...mem].some(([conn, m]) => conn.uid === uid && m.pg.some((p) => p.table === "game_invites")));

function sendInvite(world, { game, room, from = USERS.ian, to = USERS.emma }) {
  const row = { id: world.seq++, from_user: from.id, from_name: from.username, to_user: to.id, game, room, status: "pending", created_at: new Date().toISOString() };
  world.invites.push(row);
  world.hub.pushInsert("game_invites", row, to.id);
  return row;
}

export const flow = {
  name: "invites-light",
  async run(h) {
    const hub = createHub();
    const world = createWorld({ hub });
    const players = [];
    try {
      const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma, first: true }); players.push(emma);
      const page = emma.page;
      const popupOn = async (path, label, room, game = "connect4") => {
        h.step(`popup on ${label}`);
        await page.goto(h.origin + path, { waitUntil: "domcontentloaded" });
        h.expect(await until(() => listening(hub, USERS.emma.id)), `${label}: listener up`);
        await sleep(600);
        sendInvite(world, { game, room });
        const shown = await page.locator(".ip-card").waitFor({ timeout: 20000 }).then(() => true, () => false);
        h.expect(shown, `${label}: popup appears`);
        h.eq(await page.locator(".ip-top").count(), 0, `${label}: no banner`);
        if (shown) await page.keyboard.press("Escape");
      };
      await popupOn("/index.html", "home", "wk01");
      await popupOn("/pixelbreak.html", "the arcade hub (no game open)", "wk02", "tictactoe");
      await popupOn("/lobby.html?g=connect4", "the lobby", "wk03", "reversi");
      await popupOn("/tictactoe.html?ai=1", "a game page (vs computer)", "wk04", "checkers");

      h.step("banner while a game runs in the arcade frame");
      await page.goto(h.origin + "/pixelbreak.html?g=snake", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => { const d = document.getElementById("gf")?.contentDocument; return !!d && d.readyState === "complete" && d.body && d.body.children.length > 0; }, null, { timeout: 30000 });
      h.expect(await until(() => listening(hub, USERS.emma.id)), "arcade: listener up");
      await sleep(600);
      const row = sendInvite(world, { game: "connect4", room: "wk05" });
      const bar = await page.locator(".ip-bar").waitFor({ timeout: 20000 }).then(() => true, () => false);
      h.expect(bar, "game running → the slim banner");
      h.eq(await page.locator(".ip-ov").count(), 0, "game running → no popup");
      if (bar) {
        await page.locator(".ip-bar").click();
        await page.getByRole("button", { name: "Bäitrieden" }).click();
        await page.waitForURL(/lobby\.html\?g=connect4&c=WK05/, { timeout: 15000 });
        h.expect(world.invites.find((i) => i.id === row.id)?.status === "accepted", "Join from the banner sheet → lobby, accepted");
      }
      h.eq(players.flatMap((p) => realErrors(p)), [], "no console errors");
    } finally {
      await closePlayers(players);
    }
  },
};

runIfMain(import.meta.url, flow);
