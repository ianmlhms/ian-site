/* Shared pieces for the lobby flows (mp_lobby_*.mjs): several signed-in / signed-out players in ONE browser, each in its own
 * context, talking through the in-process Realtime hub (mp_hub.mjs) and a small shared "database" (the world).
 * Nothing reaches the live Supabase project. */
import fs from "node:fs";
import path from "node:path";
import { createBackend, mockSupabase, profilesTable, ilikeRegExp, VIEWPORT } from "./lib.mjs";
import { createHub } from "./mp_hub.mjs";

export { createHub };
export const SESSION_KEY = "sb-lvksqmgfwkfbblfsozfk-auth-token";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* the people of the test world */
export const USERS = {
  ian: { id: "11111111-1111-4111-8111-111111111111", username: "tester", avatar: "🦁" },
  emma: { id: "22222222-2222-4222-8222-222222222222", username: "Emma", avatar: "🙂" },
  max: { id: "33333333-3333-4333-8333-333333333333", username: "Max", avatar: "🚲" },
  lena: { id: "44444444-4444-4444-8444-444444444444", username: "Lena", avatar: "📚" },
  emmi: { id: "55555555-5555-4555-8555-555555555555", username: "Emmi", avatar: "🦊" },
};

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const fakeJwtFor = (u) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: u.id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`;
const userJson = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: `${u.username.toLowerCase()}@example.test`, user_metadata: { username: u.username }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" });
const sessionFor = (u) => ({ access_token: fakeJwtFor(u), refresh_token: "refresh-mock", token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: userJson(u) });

/** The shared "database": who is friends with whom, and the game_invites rows that mp_invite creates. */
export function createWorld({ hub, friends = {} } = {}) {
  const world = { hub, invites: [], seq: 1, friends, mpInviteCalls: [] };
  world.friendsOf = (uid) => (friends[uid] || []).map((id) => Object.values(USERS).find((u) => u.id === id)).filter(Boolean);
  return world;
}

/** A player = one browser context. `user` null = signed-out guest. first: reuse the flow's own context/page (it gets the video). */
export async function newPlayer(h, world, { label, user = null, first = false, viewport = VIEWPORT, extraRpc = {} } = {}) {
  const context = first ? h.context : await h.context.browser().newContext({ viewport, serviceWorkers: "block" });
  const page = first ? h.page : await context.newPage();
  const player = { label, user, context, page, http: [], errors: [], warnings: [], backend: null, first };
  const uid = user ? user.id : "";
  const backend = createBackend({
    rpc: {
      has_pin: () => true, is_view_restricted: () => false, visible_user_ids: () => [],
      client_commands_since: () => ({ now: new Date().toISOString(), commands: [] }),
      leaderboard_tags: () => [], touch_presence: () => null,
      my_friends: () => world.friendsOf(uid).map((u) => ({ user_id: u.id, username: u.username })),
      my_game_invites: () => world.invites.filter((i) => i.to_user === uid && i.status === "pending"),
      mp_invite: ({ p_game, p_room, p_to }) => {
        world.mpInviteCalls.push({ by: label, p_game, p_room, p_to });
        return (p_to || []).map((to) => {
          const target = Object.values(USERS).find((u) => u.id === to);
          if (!target) return { user_id: to, status: "unknown_user" };
          if (to === uid) return { user_id: to, status: "self" };
          if (world.invites.some((i) => i.from_user === uid && i.to_user === to && i.game === p_game && i.room === p_room)) return { user_id: to, status: "already_invited" };
          const row = { id: world.seq++, from_user: uid, from_name: user.username, to_user: to, game: p_game, room: p_room, status: "pending", created_at: new Date().toISOString() };
          world.invites.push(row);
          world.hub.pushInsert("game_invites", row, to);
          return { user_id: to, status: "sent" };
        });
      },
      ...extraRpc,
    },
    tables: {
      profiles: (req) => {
        const username = req.url.searchParams.get("username");
        if (username && username.startsWith("ilike.")) {
          const re = ilikeRegExp(username);
          return Object.values(USERS).filter((u) => re.test(u.username) && u.id !== uid).sort((a, b) => a.username.localeCompare(b.username));
        }
        const select = req.url.searchParams.get("select") || "";
        if (select === "avatar") return user ? [{ avatar: user.avatar }] : [];
        return profilesTable(req);
      },
      game_invites: ({ url, method, body }) => {
        if (method === "PATCH") {
          const id = +String(url.searchParams.get("id") || "").replace("eq.", "");
          const row = world.invites.find((i) => i.id === id && i.to_user === uid);
          if (row && body && typeof body.status === "string") row.status = body.status;
          return [];
        }
        return [];
      },
    },
    functions: { "auth-pin": () => ({ hasPin: true, isLegacy: false }) },
  });
  player.backend = backend;
  await mockSupabase(context, backend);
  if (user) {
    // later routes win: answer the auth endpoints for THIS user, not the default tester
    await context.route(/\.supabase\.co\/auth\/v1\//, (route) => {
      const url = new URL(route.request().url());
      const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "access-control-expose-headers": "*" };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (url.pathname.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(userJson(user)) });
      if (url.pathname.startsWith("/auth/v1/token") || url.pathname.startsWith("/auth/v1/verify")) return route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(sessionFor(user)) });
      if (url.pathname.startsWith("/auth/v1/logout")) return route.fulfill({ status: 204, headers });
      return route.fulfill({ status: 200, contentType: "application/json", headers, body: "{}" });
    });
    await context.addInitScript(([key, session, name]) => { localStorage.setItem(key, JSON.stringify(session)); localStorage.setItem("playerName", name); }, [SESSION_KEY, sessionFor(user), user.username]);
  }
  await world.hub.attach(context, label, uid);
  page.on("request", (r) => {
    const u = r.url();
    if (/supabase\.co/.test(u) && r.resourceType() !== "websocket" && r.method() !== "OPTIONS") { const url = new URL(u); const sel = url.searchParams.get("select"); player.http.push(`${r.method()} ${url.pathname.replace("/rest/v1/", "")}${sel ? "?select=" + sel.slice(0, 30) : ""}`); }
  });
  page.on("console", (m) => { if (m.type() === "error") player.errors.push(m.text()); if (m.type() === "warning") player.warnings.push(m.text()); });
  page.on("pageerror", (e) => player.errors.push("pageerror: " + e.message));
  return player;
}

/** console errors that are not ours: blocked third-party hosts in the sandbox */
export const realErrors = (p) => p.errors.filter((e) => !/goatcounter|gc\.zgo\.at|fonts\.(googleapis|gstatic)|Failed to load resource/i.test(e));

export async function closePlayers(players) {
  for (const p of players) { if (!p.first) { try { await p.context.close(); } catch { /* gone */ } } }
}

export function shotter(flowName) {
  return async (player, label) => {
    const dir = process.env.FLOW_SHOTS_DIR;
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    await player.page.screenshot({ path: path.join(dir, `${flowName}.${label}.png`) });
  };
}

/* ---- small page helpers ---- */
export const text = async (page, sel) => ((await page.textContent(sel).catch(() => "")) || "").replace(/\s+/g, " ").trim();
export async function rosterNames(page) {
  return page.$$eval("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited) .mpl-name", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
}
export const lobbyCode = (page) => text(page, ".mpl-code");
export const countHttp = (p, re) => p.http.filter((x) => re.test(x)).length;
