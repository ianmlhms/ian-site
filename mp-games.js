/* mp-games.js — the one list of online games the lobby, the friends page and the invite toasts agree on.
 * ES module (import it; classic pages use import()). Keep in step with the `mp_games` table in scripts/mp-lobby-v1.sql —
 * the server only accepts invites for ids that exist there; this file decides how each id looks and how it is joined.
 *
 *   id        the page slug used by game_invites.game (NOT the arcade id "o-connect4")
 *   lobby     true  = starts through lobby.html (code, add people, ready, settings)
 *             false = still the old  page?room=CODE&role=host|guest  link (migrate later by flipping this + the SQL row)
 *   min/max   players the game supports; the lobby enforces both
 *   settings  host options shown in the lobby, declarative so the lobby page never needs the game's code:
 *               { key, type: "multi",  label:{lb,de,en}, options:[{v,label}], min, def:[v...] }
 *               { key, type: "choice", label:{lb,de,en}, options:[{v,label}], def:v }
 *             the chosen values reach the game as ctx.cfg (see mp-gate.js)
 */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";   // no I / O: easy to read out loud
export const CODE_LEN = 4;
export const LOBBY_PAGE = "lobby.html";

// slf.html CATALOG order (index = value). A flow test compares this list with the page.
const SLF_CATEGORIES = ["Stadt", "Land", "Fluss", "Name", "Tier", "Beruf", "Pflanze", "Farbe", "Sportart", "Essen", "Getränk", "Automarke", "Film", "Band", "Körperteil"];

const G = (o) => Object.freeze({ lobby: false, ai: false, settings: Object.freeze([]), ...o });

export const MP_GAMES = Object.freeze({
  connect4: G({ id: "connect4", name: "Connect 4", emoji: "🔴", page: "connect4.html", min: 2, max: 2, lobby: true, ai: true }),
  slf: G({
    id: "slf", name: "Stadt-Land-Fluss", emoji: "🔤", page: "slf.html", min: 2, max: 8, lobby: true,
    settings: Object.freeze([{
      key: "cats", type: "multi", min: 2, def: Object.freeze([0, 1, 2, 3, 4, 5]),
      label: { lb: "Kategorien", de: "Kategorien", en: "Categories" },
      options: Object.freeze(SLF_CATEGORIES.map((label, v) => Object.freeze({ v, label }))),
    }]),
  }),
  // ---- migrated in the second batch (2-player GameCommon games) ----
  tictactoe: G({ id: "tictactoe", name: "Tic-Tac-Toe", emoji: "❌", page: "tictactoe.html", min: 2, max: 2, lobby: true, ai: true }),
  battleship: G({ id: "battleship", name: "Battleship", emoji: "🚢", page: "battleship.html", min: 2, max: 2, lobby: true, ai: true }),
  reversi: G({ id: "reversi", name: "Reversi", emoji: "⚪", page: "reversi.html", min: 2, max: 2, lobby: true, ai: true }),
  dots: G({ id: "dots", name: "Dots & Boxes", emoji: "🟦", page: "dots.html", min: 2, max: 2, lobby: true, ai: true }),
  checkers: G({ id: "checkers", name: "Checkers", emoji: "🟠", page: "checkers.html", min: 2, max: 2, lobby: true, ai: true }),
  maumau: G({ id: "maumau", name: "Mau-Mau Cards", emoji: "🃏", page: "maumau.html", min: 2, max: 2, lobby: true, ai: true }),
  "dice-duel": G({ id: "dice-duel", name: "Kniffel", emoji: "🎲", page: "dice-duel.html", min: 2, max: 2, lobby: true, ai: true }),
  color: G({
    id: "color", name: "Colour Guess", emoji: "🎨", page: "color.html", min: 2, max: 8, lobby: true, ai: true,
    settings: Object.freeze([
      { key: "rounds", type: "choice", def: 5, label: { lb: "Ronnen", de: "Runden", en: "Rounds" }, options: Object.freeze([1, 3, 5, 7, 10].map((v) => Object.freeze({ v, label: String(v) }))) },
      { key: "mode", type: "choice", def: "visible", label: { lb: "Modus", de: "Modus", en: "Mode" }, options: Object.freeze([{ v: "visible", label: "👁 Stays visible" }, { v: "flash", label: "⚡ Flash (memory)" }]) },
    ]),
  }),
  // ---- not migrated yet: the lobby is off, links stay  page?room=CODE&role=guest ----
  draw: G({ id: "draw", name: "Draw & Guess", emoji: "✏️", page: "draw.html", min: 2, max: 8 }),
  meme: G({ id: "meme", name: "Meme Caption Party", emoji: "😂", page: "meme.html", min: 2, max: 8 }),
  intro: G({ id: "intro", name: "Guess the Song", emoji: "🎵", page: "intro.html", min: 2, max: 8 }),
  "kart-letzebuerg": G({ id: "kart-letzebuerg", name: "Kart Lëtzebuerg", emoji: "🏎️", page: "pb/kart-letzebuerg.html", min: 2, max: 8 }),
});

export const gameInfo = (id) => (typeof id === "string" && Object.hasOwn(MP_GAMES, id) ? MP_GAMES[id] : null);
export const gameName = (id) => gameInfo(id)?.name || String(id || "");
export const isLobbyGame = (id) => gameInfo(id)?.lobby === true;
/** arcade ids ("o-connect4") and slugs ("connect4") both resolve */
export const gameByArcadeId = (arcadeId) => gameInfo(String(arcadeId || "").replace(/^o-/, ""));

const CODE_RE = /^[A-Za-z0-9]{4,10}$/;
export const cleanCode = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
export const isCode = (s) => CODE_RE.test(String(s ?? ""));

/** lobby.html link. code = "new" creates a lobby; a 4-letter code joins it. extra: { invite: [{id, name}...], back: true } */
export function lobbyUrl(id, code = "new", extra = {}) {
  const q = new URLSearchParams({ g: id, c: code === "new" ? "new" : cleanCode(code) });
  if (extra.back) q.set("back", "1");
  if (Array.isArray(extra.invite) && extra.invite.length) q.set("invite", extra.invite.map((p) => `${p.id}~${String(p.name || "").slice(0, 16)}`).join(","));
  return `${LOBBY_PAGE}?${q}`;
}
/** where an invite to `room` for game `id` leads (invites store the code lowercase) */
export function joinUrl(id, room) {
  const g = gameInfo(id);
  if (!g) return null;
  return g.lobby ? lobbyUrl(id, room) : `${g.page}?room=${encodeURIComponent(room)}&role=guest`;
}
/** the page a lobby hands the players to when the game starts: the same link the game always understood */
export function gameUrl(id, room, role, code) {
  const g = gameInfo(id);
  if (!g) return null;
  const q = new URLSearchParams({ room: String(room).toLowerCase(), role: role === "host" ? "host" : "guest" });
  if (code) q.set("lb", cleanCode(code));
  return `${g.page}?${q}`;
}

/** Validate a host-chosen config (it travels through Realtime presence, so peers treat it as untrusted). */
export function sanitizeCfg(id, raw) {
  const g = gameInfo(id);
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const s of g?.settings || []) {
    const values = new Set(s.options.map((o) => o.v));
    if (s.type === "multi") {
      const list = Array.isArray(src[s.key]) ? [...new Set(src[s.key].filter((v) => values.has(v)))].sort((a, b) => a - b) : [];
      out[s.key] = list.length >= (s.min || 1) ? list : [...s.def];
    } else {
      out[s.key] = values.has(src[s.key]) ? src[s.key] : s.def;
    }
  }
  return out;
}
export const defaultCfg = (id) => sanitizeCfg(id, {});
