/* mp-lobby.js — the shared multiplayer lobby for the online games (mounted by lobby.html).
 *
 *   import { mountLobby } from "./mp-lobby.js";   mountLobby(rootElement)
 *
 * What a player sees: create a lobby (4-letter code + link), add people (the group-chat picker), join by code / link /
 * invite / quick match, a roster with ready state, host settings the GAME declares (mp-games.js), then Start.
 * The game itself is NOT loaded here: Start hands everybody to the game's page with the link it always understood
 * (page?room=code&role=host|guest&lb=CODE) plus a small context (roster, settings) in sessionStorage, read by mp-gate.js.
 *
 * Network budget (Supabase egress is tight): no polling anywhere.
 *   Realtime only:  one lobby channel while the lobby screen is open (presence = the roster, 1 broadcast = start/kick),
 *                   one directory channel ONLY while the "open lobbies" panel is shown or a public lobby is hosted.
 *   REST, on demand: my_game_invites (entry screen, signed in), one profiles read for my avatar (cached per tab),
 *                    my_friends + name search while the picker is open, mp_invite when the host confirms.
 * The lobby channel is closed when the game starts. Rematch = back to lobby.html?...&back=1 (mp-gate.js button).
 *
 * Everything that arrives over Realtime is untrusted: names, avatars, settings are sanitised before they are rendered. */
import {
  gameInfo, CODE_ALPHABET, CODE_LEN, cleanCode, isCode, lobbyUrl, gameUrl, offlineUrl, sanitizeCfg, defaultCfg,
} from "./mp-games.js?v=4";

/* ------------------------------------------------------------------ constants */
const CTX_KEY = "mpl.ctx";               // handed to mp-gate.js in the game page
const RECENT_KEY = "mpl.recent";         // people met in lobbies (this device only): [{id, username, avatar}]
const AVATAR_KEY = "mpl.avatar:";        // + uid, sessionStorage
const NAME_KEY = "playerName";           // the games read the same key
const CH_PREFIX = "mpl:";
const DIR_PREFIX = "mpl-dir:";
const MAX_NAME = 16;
const MAX_RECENT = 12;
const MAX_EMPTY_SLOTS = 2;              // placeholder rows under the roster (a lobby for 8 should not be a mile long)
const MAX_INVITE_BATCH = 8;
const SUBSCRIBE_TIMEOUT_MS = 8000;
const CLAIM_WAIT_MS = 450;               // after creating: let the presence snapshot arrive before claiming the code
const HOST_SEARCH_MS = 1600;             // after joining: how long to look for the host's presence entry
const BACK_WAIT_MS = 120000;             // returning from a game: how long a guest waits for the host to reopen the lobby
const QUICK_WAIT_MS = 1600;
const START_GRACE_MS = 250;              // between telling everybody and leaving the page
const CREATE_TRIES = 6;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^[a-z0-9]{4,12}$/;
const STATUS_TEXT = { already_invited: "invAlready", not_allowed: "invNotAllowed", unknown_user: "invUnknown", rate_limited: "invRate", self: "invUnknown" };

/* ------------------------------------------------------------------ text (lb default, then de, en) */
const S = {
  lb: {
    lobby: "Lobby", create: "Lobby opmaachen", createD: "Du kriss e Code a kanns Leit invitéieren", joinTitle: "Mat engem Code bäitrieden",
    codePh: "ABCD", codeLabel: "Code vun de Frënn", join: "Bäitrieden", quick: "Schnellspill", quickD: "Direkt an eng oppen Lobby",
    openLobbies: "Oppe Lobbyen", noOpen: "Grad keng oppe Lobby. Maach selwer eng op!", openN: "{n} vu {m} Spiller", vsAi: "Géint de Computer",
    invitesTitle: "Invitatiounen", invitedBy: "{name} huet dech invitéiert", decline: "Ofleenen", yourName: "Däin Numm", signedInAs: "Ugemellt als {name}",
    signInHint: "Mell dech un, fir Leit anzelueden.", signIn: "Umellen",
    code: "Code", copyLink: "Link kopéieren", copied: "Link kopéiert!", copyFailed: "Link konnt net kopéiert ginn", share: "Deelen",
    addPeople: "Leit derbäisetzen", players: "Spiller", hostTag: "Host", you: "du", ready: "Prett!", notReady: "Net méi prett",
    isReady: "prett", isWaiting: "waart…", kick: "Ewechhuelen", kickAria: "{name} aus der Lobby huelen", empty: "Waart op e Spiller…", invitedTag: "invitéiert…",
    start: "Spill starten", leave: "Verloossen", waitHost: "Waart bis den Host d'Spill start…", waitReady: "Waart bis all Spiller prett sinn…",
    needMore: "Et brauch mindestens {n} Spiller.", readyToGo: "Alleguer prett — du kanns starten!", publicLbl: "Oppen fir Schnellspill", settings: "Astellungen",
    hostNow: "{name} ass elo Host.", joined: "{name} ass bäikomm.", left: "{name} ass fortgaang.", starting: "D'Spill fänkt un…",
    connecting: "Verbindung mam Server…", creating: "Lobby gëtt opgemaach…", joining: "Trëtt der Lobby bäi…", finding: "Sich eng Lobby…",
    waitingBack: "Waart bis den Host zréck an der Lobby ass…", back: "Zréck",
    eNoServer: "Online-Modus ass grad net erreechbar.", eNotFound: "Dës Lobby gëtt et net (méi) — oder d'Spill huet schonn ugefaangen.", eFull: "D'Lobby ass voll.",
    eStarted: "D'Spill huet schonn ugefaangen.", eKicked: "Du goufs aus der Lobby geholl.", eBadCode: "Dee Code gesäit net richteg aus (4 Buschtawen).", eUnknownGame: "Dat Spill kennen ech net.",
    pickTitle: "Leit derbäisetzen", pickOk: "Invitéieren", pickN: "{n} invitéieren", pickWho: "Wien soll derbäi sinn?", pickPh: "Numm sichen", pickNone: "Nach keen ausgewielt.",
    pickNoMatch: "Keen fonnt.", pickRemove: "Ewechhuelen", pickFriends: "Frënn", pickRecent: "Rezent Spiller", close: "Zoumaachen",
    invSent: "{n} invitéiert.", invAlready: "{name} ass scho invitéiert.", invNotAllowed: "{name} ass net verfügbar.", invUnknown: "{name} gouf net fonnt.",
    invRate: "Zevill Invitatiounen — probéier et gläich nach eng Kéier.", invUnavailable: "Invitéieren ass nach net verfügbar. Deel de Link.", invFailed: "Invitatioun ass net ukomm. Deel de Link.",
    guestNote: "Gäscht kënnen iwwer de Code oder de Link matmaachen.",
  },
  de: {
    lobby: "Lobby", create: "Lobby erstellen", createD: "Du bekommst einen Code und kannst Leute einladen", joinTitle: "Mit einem Code beitreten",
    codePh: "ABCD", codeLabel: "Code von Freunden", join: "Beitreten", quick: "Schnellspiel", quickD: "Direkt in eine offene Lobby",
    openLobbies: "Offene Lobbys", noOpen: "Gerade keine offene Lobby. Mach selbst eine auf!", openN: "{n} von {m} Spielern", vsAi: "Gegen den Computer",
    invitesTitle: "Einladungen", invitedBy: "{name} hat dich eingeladen", decline: "Ablehnen", yourName: "Dein Name", signedInAs: "Angemeldet als {name}",
    signInHint: "Melde dich an, um Leute einzuladen.", signIn: "Anmelden",
    code: "Code", copyLink: "Link kopieren", copied: "Link kopiert!", copyFailed: "Link konnte nicht kopiert werden", share: "Teilen",
    addPeople: "Leute hinzufügen", players: "Spieler", hostTag: "Host", you: "du", ready: "Bereit!", notReady: "Doch nicht bereit",
    isReady: "bereit", isWaiting: "wartet…", kick: "Entfernen", kickAria: "{name} aus der Lobby entfernen", empty: "Warte auf einen Spieler…", invitedTag: "eingeladen…",
    start: "Spiel starten", leave: "Verlassen", waitHost: "Warte, bis der Host das Spiel startet…", waitReady: "Warte, bis alle Spieler bereit sind…",
    needMore: "Es braucht mindestens {n} Spieler.", readyToGo: "Alle bereit — du kannst starten!", publicLbl: "Offen für Schnellspiel", settings: "Einstellungen",
    hostNow: "{name} ist jetzt Host.", joined: "{name} ist beigetreten.", left: "{name} ist gegangen.", starting: "Das Spiel beginnt…",
    connecting: "Verbinde mit dem Server…", creating: "Lobby wird erstellt…", joining: "Trete der Lobby bei…", finding: "Suche eine Lobby…",
    waitingBack: "Warte, bis der Host wieder in der Lobby ist…", back: "Zurück",
    eNoServer: "Der Online-Modus ist gerade nicht erreichbar.", eNotFound: "Diese Lobby gibt es nicht (mehr) — oder das Spiel läuft schon.", eFull: "Die Lobby ist voll.",
    eStarted: "Das Spiel hat schon begonnen.", eKicked: "Du wurdest aus der Lobby entfernt.", eBadCode: "Der Code sieht nicht richtig aus (4 Buchstaben).", eUnknownGame: "Dieses Spiel kenne ich nicht.",
    pickTitle: "Leute hinzufügen", pickOk: "Einladen", pickN: "{n} einladen", pickWho: "Wer soll dabei sein?", pickPh: "Namen suchen", pickNone: "Noch niemand ausgewählt.",
    pickNoMatch: "Niemand gefunden.", pickRemove: "Entfernen", pickFriends: "Freunde", pickRecent: "Zuletzt gespielt mit", close: "Schließen",
    invSent: "{n} eingeladen.", invAlready: "{name} ist schon eingeladen.", invNotAllowed: "{name} ist nicht verfügbar.", invUnknown: "{name} wurde nicht gefunden.",
    invRate: "Zu viele Einladungen — versuch es gleich nochmal.", invUnavailable: "Einladen ist noch nicht verfügbar. Teile den Link.", invFailed: "Die Einladung ist nicht angekommen. Teile den Link.",
    guestNote: "Gäste können über den Code oder den Link mitspielen.",
  },
  en: {
    lobby: "Lobby", create: "Create lobby", createD: "You get a code and can invite people", joinTitle: "Join with a code",
    codePh: "ABCD", codeLabel: "Code from a friend", join: "Join", quick: "Quick match", quickD: "Straight into an open lobby",
    openLobbies: "Open lobbies", noOpen: "No open lobby right now. Open one yourself!", openN: "{n} of {m} players", vsAi: "Play the computer",
    invitesTitle: "Invitations", invitedBy: "{name} invited you", decline: "Decline", yourName: "Your name", signedInAs: "Signed in as {name}",
    signInHint: "Sign in to invite people.", signIn: "Sign in",
    code: "Code", copyLink: "Copy link", copied: "Link copied!", copyFailed: "Could not copy the link", share: "Share",
    addPeople: "Add people", players: "Players", hostTag: "Host", you: "you", ready: "Ready!", notReady: "Not ready",
    isReady: "ready", isWaiting: "waiting…", kick: "Remove", kickAria: "Remove {name} from the lobby", empty: "Waiting for a player…", invitedTag: "invited…",
    start: "Start game", leave: "Leave", waitHost: "Waiting for the host to start the game…", waitReady: "Waiting until every player is ready…",
    needMore: "At least {n} players are needed.", readyToGo: "Everyone is ready — you can start!", publicLbl: "Open for quick match", settings: "Settings",
    hostNow: "{name} is the host now.", joined: "{name} joined.", left: "{name} left.", starting: "The game is starting…",
    connecting: "Connecting to the server…", creating: "Creating the lobby…", joining: "Joining the lobby…", finding: "Looking for a lobby…",
    waitingBack: "Waiting for the host to come back to the lobby…", back: "Back",
    eNoServer: "Online mode is not reachable right now.", eNotFound: "That lobby does not exist (any more), or the game has already started.", eFull: "The lobby is full.",
    eStarted: "The game has already started.", eKicked: "You were removed from the lobby.", eBadCode: "That code does not look right (4 letters).", eUnknownGame: "I do not know that game.",
    pickTitle: "Add people", pickOk: "Invite", pickN: "Invite {n}", pickWho: "Who should join?", pickPh: "Search a name", pickNone: "Nobody picked yet.",
    pickNoMatch: "Nobody found.", pickRemove: "Remove", pickFriends: "Friends", pickRecent: "Played with recently", close: "Close",
    invSent: "{n} invited.", invAlready: "{name} is already invited.", invNotAllowed: "{name} is not available.", invUnknown: "{name} was not found.",
    invRate: "Too many invitations — try again in a moment.", invUnavailable: "Inviting is not available yet. Share the link instead.", invFailed: "The invitation did not go through. Share the link instead.",
    guestNote: "Guests can join with the code or the link.",
  },
};
const readLang = () => { try { const v = localStorage.getItem("site_lang"); return S[v] ? v : "lb"; } catch { return "lb"; } };
const lang = readLang();
const t = (key, vars) => {
  let s = (S[lang] && S[lang][key]) || S.en[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace("{" + k + "}", String(vars[k]));
  return s;
};

/* ------------------------------------------------------------------ small helpers */
/** DOM builder: h("button", { class: "x", onclick: fn }, "text", child) — text is always a text node (no innerHTML). */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const rid = () => Math.random().toString(36).slice(2, 10);
const warn = (...a) => console.warn("[mp-lobby]", ...a);
const cleanName = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>&"`]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
function genCode() { let s = ""; for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]; return s; }
const store = {
  get(k, session = false) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch { return null; } },
  set(k, v, session = false) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch { /* private mode / blocked: the lobby works without it */ } },
};
function loadRecent() {
  try {
    const list = JSON.parse(store.get(RECENT_KEY) || "[]");
    return (Array.isArray(list) ? list : []).filter((p) => p && UUID_RE.test(p.id) && typeof p.username === "string").slice(0, MAX_RECENT)
      .map((p) => ({ id: p.id.toLowerCase(), username: cleanName(p.username), avatar: safeAvatar(p.avatar) }));
  } catch { return []; }
}
function rememberPlayers(members, myUid) {
  const fresh = members.filter((m) => m.uid && m.uid !== myUid).map((m) => ({ id: m.uid, username: m.name, avatar: m.avatar }));
  if (!fresh.length) return;
  const keep = loadRecent().filter((p) => !fresh.some((f) => f.id === p.id));
  store.set(RECENT_KEY, JSON.stringify([...fresh, ...keep].slice(0, MAX_RECENT)));
}
/** emoji (short) or an uploaded photo from this project's public storage; anything else is dropped */
function safeAvatar(a) {
  const v = String(a ?? "");
  if (!v) return "";
  if (/^https:\/\//.test(v)) {
    const base = String(window.PB_CONFIG?.url || "").replace(/\/$/, "");
    return base && v.startsWith(base + "/storage/v1/object/public/") && v.length <= 300 ? v : "";
  }
  return v.length <= 8 && !/[<>&"'`]/.test(v) ? v : "";
}
const hue = (name) => { let n = 0; for (const c of String(name)) n = (n * 31 + c.codePointAt(0)) % 360; return n; };
function avatarEl(name, avatar) {
  const a = safeAvatar(avatar);
  if (/^https:/.test(a)) return h("span", { class: "mpl-av", "aria-hidden": "true" }, h("img", { src: a, alt: "" }));
  if (a) return h("span", { class: "mpl-av", "aria-hidden": "true" }, a);
  const el = h("span", { class: "mpl-av mpl-av-letter", "aria-hidden": "true" }, [...String(name || "?")][0]?.toUpperCase() || "?");
  el.style.setProperty("--h", String(hue(name)));
  return el;
}

/* ------------------------------------------------------------------ identity + clients */
async function loadIdentity() {
  const id = { sb: null, uid: "", username: "", signedIn: false, avatar: "", auth: null };
  try {
    const auth = await import("./auth.js?v=34");
    id.auth = auth;
    if (auth.authConfigured) {
      id.sb = await auth.client();
      const s = auth.session();
      if (s?.user?.id && s.user.user_metadata?.account_kind !== "kart") {
        id.uid = s.user.id.toLowerCase();
        id.username = cleanName(auth.username() || "");
        id.signedIn = true;
      }
    }
  } catch (e) { warn("auth unavailable, playing as a guest", e); }
  if (id.signedIn) {
    id.avatar = safeAvatar(store.get(AVATAR_KEY + id.uid, true) || "");
    if (!id.avatar && store.get(AVATAR_KEY + id.uid, true) == null) {
      try {
        const { data } = await id.sb.from("profiles").select("avatar").eq("id", id.uid).maybeSingle();   // one read per tab
        id.avatar = safeAvatar(data?.avatar || "");
        store.set(AVATAR_KEY + id.uid, id.avatar, true);
      } catch (e) { warn("avatar read failed", e); }
    }
  }
  return id;
}
function realtimeClient() {
  const cfg = window.PB_CONFIG;
  if (!cfg || !window.supabase) throw new Error("realtime unavailable");
  // Realtime-only client: never persist / refresh auth (it would race the shared signed-in client)
  return window.supabase.createClient(cfg.url.replace(/\/$/, ""), cfg.anonKey,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
/** resolves when the channel is joined; `later(status)` keeps receiving every later status (re-joins after a reconnect).
 *  (realtime-js allows exactly one subscribe() per channel, so the reconnect hook has to ride on this call.) */
function subscribe(ch, later) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error("subscribe timeout")); } }, SUBSCRIBE_TIMEOUT_MS);
    ch.subscribe((status) => {
      if (done) { if (later) later(status); return; }
      if (status === "SUBSCRIBED") { done = true; clearTimeout(timer); resolve(); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { done = true; clearTimeout(timer); reject(new Error("channel " + status)); }
    });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ presence → members */
const byJoin = (a, b) => (a.t - b.t) || (a.id < b.id ? -1 : 1);
function readMembers(ch, game) {
  const out = new Map();
  for (const [key, metas] of Object.entries(ch.presenceState())) {
    const m = Array.isArray(metas) ? metas[metas.length - 1] : null;
    if (!m || typeof m !== "object") continue;
    const id = String(m.i || key).toLowerCase();
    if (!ID_RE.test(id)) continue;
    out.set(id, {
      id, name: cleanName(m.n) || "?", uid: UUID_RE.test(m.u) ? String(m.u).toLowerCase() : "", avatar: safeAvatar(m.a),
      ready: m.r === 1, t: Number.isFinite(m.t) ? m.t : 0, host: m.h === 1, pub: m.p === 1, starting: m.s === "start",
      cfg: m.c && typeof m.c === "object" ? sanitizeCfg(game, m.c) : null,
    });
  }
  return [...out.values()].sort(byJoin);
}
/** the member flagged host; if nobody is (the host left) the one who joined first is next in line */
function hostOf(members) {
  return members.filter((m) => m.host).sort(byJoin)[0] || members[0] || null;
}

/* ------------------------------------------------------------------ the lobby */
export async function mountLobby(root, options = {}) {
  const params = new URLSearchParams(options.search ?? location.search);
  const gameId = params.get("g") || "";
  const game = gameInfo(gameId);
  root.classList.add("mpl");
  if (!game || !game.lobby) {
    root.append(h("p", { class: "mpl-msg", role: "alert" }, t("eUnknownGame")), h("a", { class: "mpl-btn", href: "pixelbreak.html" }, "‹ Arcade"));
    return null;
  }
  document.title = `${game.name} — ${t("lobby")} — ian.lu`;
  document.documentElement.lang = lang;

  const ident = await loadIdentity();
  const myId = rid();
  const me = { name: "", ready: false };
  const S0 = {
    rt: null, ch: null, dir: null, dirWatch: null, code: "", joinedAt: 0, joined: false, starting: false, left: false,
    members: [], hostId: "", lastCfg: defaultCfg(game.id), lastPub: false, cfg: defaultCfg(game.id), pub: false,
    invited: new Map(), knownIds: null, wantHostWait: false, onHostSeen: null,
  };
  const st = S0;
  if (ident.signedIn) me.name = ident.username || "";
  if (!me.name) me.name = cleanName(store.get(NAME_KEY) || "") || "Gast" + (100 + Math.floor(Math.random() * 900));

  /* ---------- skeleton ---------- */
  const live = h("div", { class: "mpl-sr", role: "status", "aria-live": "polite" });
  const toastEl = h("div", { class: "mpl-toast", role: "status", "aria-live": "polite" });
  const entry = h("section", { class: "mpl-card", "aria-labelledby": "mplEntryTitle" });
  const lobby = h("section", { class: "mpl-card", "aria-labelledby": "mplLobbyTitle", hidden: true });
  const busy = h("section", { class: "mpl-card mpl-busy", role: "status", hidden: true });
  root.append(entry, lobby, busy, live, toastEl);

  const say = (text) => { live.textContent = ""; setTimeout(() => { live.textContent = text; }, 40); };
  let toastTimer = 0;
  const toast = (text, kind) => {
    toastEl.textContent = text; toastEl.dataset.kind = kind || ""; toastEl.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("on"), 5000);
  };
  function show(which, text) {
    entry.hidden = which !== "entry"; lobby.hidden = which !== "lobby"; busy.hidden = which !== "busy";
    if (which === "busy") busy.replaceChildren(h("span", { class: "mpl-spin", "aria-hidden": "true" }), h("b", {}, text || ""));
  }

  /* ---------- teardown ---------- */
  function closeChannel(which) {
    const ch = st[which]; st[which] = null;
    if (ch && st.rt) { try { ch.untrack(); } catch { /* closing */ } try { st.rt.removeChannel(ch); } catch { /* closing */ } }
  }
  function closeRealtime() {
    const rt = st.rt; st.rt = null; st.ch = null; st.dir = null; st.dirWatch = null;
    if (!rt) return;
    try { rt.removeAllChannels(); } catch { /* closing */ }
    try { rt.realtime.disconnect(); } catch { /* closing */ }
  }
  function leaveToEntry(message) {
    st.left = true; st.joined = false;
    closeRealtime();
    st.members = []; st.code = ""; st.invited = new Map(); st.starting = false; st.left = false; st.knownIds = null;
    history.replaceState(null, "", location.pathname + "?" + new URLSearchParams({ g: game.id }));
    renderEntry(message);
  }
  addEventListener("pagehide", () => { if (st.ch && !st.starting) { try { st.ch.untrack(); } catch { /* unloading */ } closeRealtime(); } });

  /* ---------- tracked presence meta ---------- */
  const isHost = () => st.hostId === myId;
  function myMeta() {
    const meta = { i: myId, n: me.name, u: ident.uid, a: ident.avatar, r: me.ready ? 1 : 0, t: st.joinedAt };
    if (isHost() || st.claimHost) { meta.h = 1; meta.c = st.cfg; if (st.pub) meta.p = 1; }
    if (st.starting) meta.s = "start";
    return meta;
  }
  async function retrack() {
    if (!st.ch || !st.joined) return;
    try { await st.ch.track(myMeta()); } catch (e) { warn("track failed", e); }
  }

  /* ---------- directory (public lobbies) ---------- */
  async function startPublishing() {
    if (st.dir || !st.rt) return;
    try {
      const dir = st.rt.channel(DIR_PREFIX + game.id, { config: { broadcast: { self: false }, presence: { key: myId } } });
      st.dir = dir;
      await subscribe(dir);
      await publishDir();
    } catch (e) { warn("directory unavailable", e); closeChannel("dir"); }
  }
  async function publishDir() {
    if (!st.dir) return;
    try { await st.dir.track({ c: st.code, n: st.members.length, x: game.max, h: me.name }); } catch (e) { warn("directory track failed", e); }
  }
  function stopPublishing() { closeChannel("dir"); }
  const shouldPublish = () => isHost() && st.pub && st.joined && !st.starting && st.members.length < game.max;
  function syncPublishing() {
    if (shouldPublish()) { if (st.dir) void publishDir(); else void startPublishing(); }
    else if (st.dir) stopPublishing();
  }

  /* ---------- presence sync: the roster ---------- */
  function onSync() {
    if (!st.ch || st.left) return;
    const members = readMembers(st.ch, game.id);
    if (st.onHostSeen && members.some((m) => m.host)) { const f = st.onHostSeen; st.onHostSeen = null; f(); }
    if (!st.joined) { st.members = members; return; }
    const prevIds = st.knownIds;
    st.members = members;
    const host = hostOf(members);
    const prevHost = st.hostId;
    st.hostId = host ? host.id : "";
    if (host && host.cfg) st.lastCfg = host.cfg;
    if (host) st.lastPub = host.pub;
    if (host && host.id !== myId) st.cfg = host.cfg || st.cfg;
    if (st.starting === false && host && host.starting && host.id !== myId) { /* the broadcast is authoritative; presence is only a fallback */ }

    // I was just elected (the host left): claim the lobby and carry the settings over
    if (host && host.id === myId && !host.host) {
      st.cfg = sanitizeCfg(game.id, st.lastCfg); st.pub = st.lastPub; st.claimHost = true;
      void retrack();
    }
    if (host && host.id === myId && host.host) st.claimHost = false;
    if (prevHost && prevHost !== st.hostId && host) {
      const msg = t("hostNow", { name: host.id === myId ? t("you") : host.name });
      say(msg); toast(msg);
    }
    if (prevIds) {
      const arrived = members.filter((m) => !prevIds.has(m.id));
      for (const m of arrived) say(t("joined", { name: m.name }));
      if (arrived.length) rememberPlayers(arrived, ident.uid);
      for (const id of prevIds.keys()) if (!members.some((m) => m.id === id)) say(t("left", { name: prevIds.get(id) }));
    }
    st.knownIds = new Map(members.map((m) => [m.id, m.name]));
    for (const m of members) if (m.uid) st.invited.delete(m.uid);
    if (!members.some((m) => m.id === myId) && !st.starting) void retrack();     // my entry dropped (reconnect): announce again
    renderLobby();
    syncPublishing();
    if (isHost()) void publishDirIfOpen();
  }
  const publishDirIfOpen = async () => { if (st.dir) await publishDir(); };

  /* ---------- broadcast handlers ---------- */
  function onBroadcast(kind, payload) {
    if (!payload || typeof payload !== "object") return;
    if (kind === "kick") { if (payload.to === myId) { leaveToEntry(t("eKicked")); } return; }
    if (kind === "start") {
      if (!st.joined || st.starting || payload.from !== st.hostId) return;
      onStartMessage(payload);
    }
  }

  /* ---------- joining / creating ---------- */
  function makeChannel(code) {
    st.rt = realtimeClient();
    const ch = st.rt.channel(CH_PREFIX + game.id + ":" + code.toLowerCase(), { config: { broadcast: { self: false }, presence: { key: myId } } });
    ch.on("presence", { event: "sync" }, onSync)
      .on("broadcast", { event: "kick" }, ({ payload }) => onBroadcast("kick", payload))
      .on("broadcast", { event: "start" }, ({ payload }) => onBroadcast("start", payload));
    st.ch = ch;
    return ch;
  }
  /** presence is lost on a reconnect: announce myself again whenever the channel re-joins */
  const onLater = (status) => { if (status === "SUBSCRIBED" && st.joined && !st.starting) void retrack(); };
  async function enterLobby(code) {
    st.code = code; st.joined = true;
    history.replaceState(null, "", location.pathname + "?" + new URLSearchParams({ g: game.id, c: code }));
    store.set(NAME_KEY, me.name);
    await retrack();
    st.members = readMembers(st.ch, game.id);
    st.knownIds = new Map(st.members.map((m) => [m.id, m.name]));
    rememberPlayers(st.members, ident.uid);
    const host = hostOf(st.members);
    st.hostId = host ? host.id : myId;
    show("lobby");
    renderLobby();
    lobby.querySelector(".mpl-code")?.focus?.();
    syncPublishing();
  }

  async function createLobby({ code: wanted = "", pub = false, invite = [], cfg = null } = {}) {
    show("busy", t("creating"));
    resetSession();
    st.pub = !!pub; st.cfg = cfg ? sanitizeCfg(game.id, cfg) : defaultCfg(game.id); st.claimHost = true; st.joinedAt = Date.now();
    try {
      let code = isCode(wanted) && wanted.length === CODE_LEN ? cleanCode(wanted) : genCode();
      for (let tries = 0; tries < CREATE_TRIES; tries++) {
        const ch = makeChannel(code);
        await subscribe(ch, onLater);
        await sleep(CLAIM_WAIT_MS);                                   // let the presence snapshot arrive before claiming
        const taken = readMembers(ch, game.id).some((m) => m.host && m.id !== myId);
        if (!taken) { await enterLobby(code); if (invite.length) void sendInvites(invite, { quiet: true }); return; }
        closeRealtime();
        if (wanted && tries === 0) return joinLobby(code, { fromCreate: true });
        code = genCode();
      }
      throw new Error("no free code");
    } catch (e) { warn("create failed", e); closeRealtime(); renderEntry(t("eNoServer")); }
  }

  async function joinLobby(rawCode, { fromCreate = false, waitForHost: waitLong = false } = {}) {
    const code = cleanCode(rawCode);
    if (!isCode(code)) { renderEntry(t("eBadCode")); return; }
    show("busy", waitLong ? t("waitingBack") : t("joining"));
    if (!fromCreate) resetSession();
    st.claimHost = false; st.joinedAt = Date.now();
    try {
      const ch = makeChannel(code);
      await subscribe(ch, onLater);
      let host = await waitForHost(ch, waitForHost_ms(waitLong));
      if (waitLong && host) await sleep(300);                      // let the host's roster settle
      host = readMembers(ch, game.id).find((m) => m.host) || host;
      if (!host) { closeRealtime(); renderEntry(t("eNotFound")); return; }
      if (host.starting) { closeRealtime(); renderEntry(t("eStarted")); return; }
      if (readMembers(ch, game.id).length >= game.max) { closeRealtime(); renderEntry(t("eFull")); return; }
      st.cfg = host.cfg || defaultCfg(game.id);
      await enterLobby(code);
    } catch (e) { warn("join failed", e); closeRealtime(); renderEntry(t("eNoServer")); }
  }
  const waitForHost_ms = (long) => (long ? BACK_WAIT_MS : HOST_SEARCH_MS);
  /** event-driven (no polling): resolves with the host's entry as soon as presence shows one, or null after `ms` */
  function waitForHost(ch, ms) {
    return new Promise((resolve) => {
      const have = () => readMembers(ch, game.id).find((m) => m.host) || null;
      const now = have();
      if (now) { resolve(now); return; }
      const timer = setTimeout(() => { st.onHostSeen = null; resolve(null); }, ms);
      st.onHostSeen = () => { clearTimeout(timer); st.onHostSeen = null; resolve(have()); };
    });
  }

  async function quickMatch() {
    show("busy", t("finding"));
    resetSession();
    let found = null;
    try {
      const rt = realtimeClient(); st.rt = rt;
      const dir = rt.channel(DIR_PREFIX + game.id, { config: { broadcast: { self: false }, presence: { key: myId } } });
      const pick = () => {
        const open = dirEntries(dir).filter((e) => e.n < e.x);
        return open.length ? open[Math.floor(Math.random() * open.length)] : null;
      };
      let resolveFound;
      const foundP = new Promise((res) => { resolveFound = res; });
      dir.on("presence", { event: "sync" }, () => { const p = pick(); if (p) resolveFound(p); });   // handlers before subscribe()
      await subscribe(dir);
      const timer = setTimeout(() => resolveFound(pick()), QUICK_WAIT_MS);
      found = await foundP;
      clearTimeout(timer);
      closeRealtime();
    } catch (e) { warn("quick match search failed", e); closeRealtime(); renderEntry(t("eNoServer")); return; }
    if (found) return joinLobby(found.code);
    return createLobby({ pub: true });
  }
  function dirEntries(dir) {
    const out = [];
    for (const metas of Object.values(dir.presenceState())) {
      const m = Array.isArray(metas) ? metas[metas.length - 1] : null;
      if (m && typeof m.c === "string" && isCode(m.c) && Number.isInteger(m.n) && Number.isInteger(m.x)) out.push({ code: cleanCode(m.c), n: m.n, x: Math.min(m.x, 16), host: cleanName(m.h) });
    }
    return out;
  }

  function resetSession() {
    closeRealtime();
    Object.assign(st, { code: "", joined: false, starting: false, left: false, members: [], hostId: "", invited: new Map(), knownIds: null,
      claimHost: false, onHostSeen: null, pub: false, ch: null, dir: null });
    me.ready = false;
  }

  /* ---------- start ---------- */
  const canStart = () => {
    const n = st.members.length;
    return isHost() && n >= game.min && n <= game.max && st.members.every((m) => m.id === myId || m.ready) && !st.starting;
  };
  async function startGame() {
    if (!canStart()) return;
    st.starting = true;
    const order = [st.members.find((m) => m.id === myId), ...st.members.filter((m) => m.id !== myId)].filter(Boolean).slice(0, game.max);
    const roster = order.map((m) => ({ i: m.id, n: m.name, u: m.uid, a: m.avatar }));
    stopPublishing();
    try { await st.ch.send({ type: "broadcast", event: "start", payload: { from: myId, roster, cfg: st.cfg } }); } catch (e) { warn("start broadcast failed", e); }
    await retrack();
    renderLobby();
    await sleep(START_GRACE_MS);
    launch(roster, st.cfg);
  }
  function onStartMessage(p) {
    const roster = Array.isArray(p.roster) ? p.roster.slice(0, game.max).map((r) => ({
      i: String(r?.i || "").toLowerCase(), n: cleanName(r?.n) || "?", u: UUID_RE.test(r?.u) ? String(r.u).toLowerCase() : "", a: safeAvatar(r?.a),
    })).filter((r) => ID_RE.test(r.i)) : [];
    if (!roster.some((r) => r.i === myId)) return;                      // not in the line-up (joined too late): stay here
    st.starting = true;
    renderLobby();
    launch(roster, sanitizeCfg(game.id, p.cfg));
  }
  function launch(roster, cfg) {
    const code = st.code;
    const role = roster[0]?.i === myId ? "host" : "guest";
    const ctx = {
      v: 1, game: game.id, code, room: code.toLowerCase(), role, me: myId, cfg, at: Date.now(),
      roster: roster.map((r, i) => ({ id: r.i, name: r.n, uid: r.u, avatar: r.a, role: i === 0 ? "host" : "guest" })),
    };
    store.set(CTX_KEY, JSON.stringify(ctx), true);
    say(t("starting"));
    closeRealtime();
    location.assign(gameUrl(game.id, ctx.room, role, code));
  }

  /* ---------- invites ---------- */
  async function openPicker() {
    if (!ident.signedIn) {
      toast(t("signInHint"));
      try { ident.auth?.openAuthModal?.(); } catch (e) { warn("sign-in dialog failed", e); }
      return;
    }
    let picker, restriction;
    try {
      picker = await import("./people-picker.js?v=1");
      restriction = await picker.loadViewerRestriction(ident.sb);
    } catch (e) { warn("picker failed to load", e); toast(t("invFailed"), "bad"); return; }
    let friends = [];
    try {
      const { data } = await ident.sb.rpc("my_friends");
      friends = (data || []).map((f) => ({ id: String(f.user_id).toLowerCase(), username: f.username }));
    } catch (e) { warn("friends unavailable", e); }
    const taken = new Set([ident.uid, ...st.members.map((m) => m.uid).filter(Boolean), ...st.invited.keys()]);
    const res = await picker.openPeoplePicker({
      sb: ident.sb, title: t("pickTitle"), okText: t("pickOk"), exclude: taken, allow: restriction.allow, friends, recent: loadRecent(),
      maxPick: MAX_INVITE_BATCH,
      text: { close: t("close"), who: t("pickWho"), placeholder: t("pickPh"), none: t("pickNone"), noMatch: t("pickNoMatch"), remove: t("pickRemove"), addN: t("pickN"), friends: t("pickFriends"), recent: t("pickRecent") },
    });
    if (res && res.people.length) await sendInvites(res.people);
  }
  async function sendInvites(people, { quiet = false } = {}) {
    if (!ident.signedIn || !st.code) return;
    const batch = people.slice(0, MAX_INVITE_BATCH);
    const names = new Map(batch.map((p) => [p.id, p.username]));
    try {
      const { data, error } = await ident.sb.rpc("mp_invite", { p_game: game.id, p_room: st.code.toLowerCase(), p_to: batch.map((p) => p.id) });
      if (error) throw error;
      let sent = 0;
      const problems = [];
      for (const r of data || []) {
        const name = names.get(r.user_id) || "";
        if (r.status === "sent") { sent++; st.invited.set(r.user_id, { username: name || "…" }); }
        else if (r.status === "already_invited") { st.invited.set(r.user_id, { username: name || "…" }); problems.push(t("invAlready", { name })); }
        else problems.push(t(STATUS_TEXT[r.status] || "invFailed", { name }));
      }
      if (sent && !quiet) { const msg = t("invSent", { n: sent }); say(msg); toast(msg, "ok"); }
      if (problems.length) toast(problems[0], "bad");
      renderLobby();
    } catch (e) {
      warn("invite failed", e);
      const missing = e && (e.code === "PGRST202" || /could not find the function|does not exist/i.test(String(e.message)));
      toast(missing ? t("invUnavailable") : t("invFailed"), "bad");
    }
  }

  /* ---------- link sharing ---------- */
  const origin = () => (location.origin && location.origin !== "null" ? location.origin : "https://ian.lu");
  const inviteLink = () => new URL(lobbyUrl(game.id, st.code), origin() + "/").href;
  async function copyLink() {
    try { await navigator.clipboard.writeText(inviteLink()); toast(t("copied"), "ok"); say(t("copied")); }
    catch { toast(inviteLink()); }
  }
  async function shareLink() {
    try { await navigator.share({ title: `${game.name} — ian.lu`, url: inviteLink() }); } catch { /* cancelled */ }
  }

  /* ---------- rendering: the entry screen ---------- */
  let dirPanelOpen = false;
  function renderEntry(message) {
    closeRealtime(); dirPanelOpen = false;
    show("entry");
    const nameInput = h("input", { id: "mplName", name: "player-name", type: "text", value: me.name, maxlength: MAX_NAME, autocomplete: "nickname", autocapitalize: "words", spellcheck: "false", readonly: ident.signedIn });
    nameInput.addEventListener("input", () => { me.name = cleanName(nameInput.value) || me.name; });
    const codeInput = h("input", { id: "mplCode", name: "lobby-code", type: "text", maxlength: 10, placeholder: t("codePh"), "aria-label": t("codeLabel"), autocapitalize: "characters", autocorrect: "off", autocomplete: "off", spellcheck: "false", enterkeyhint: "go" });
    const joinNow = () => { if (!ident.signedIn) me.name = cleanName(nameInput.value) || me.name; const c = cleanCode(codeInput.value); if (!isCode(c)) { msg.textContent = t("eBadCode"); return; } void joinLobby(c); };
    codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); joinNow(); } });
    codeInput.addEventListener("input", () => { codeInput.value = cleanCode(codeInput.value); });
    const msg = h("p", { class: "mpl-msg", id: "mplMsg", role: message ? "alert" : "status" }, message || "");
    msg.hidden = !message;
    const invitesBox = h("div", { class: "mpl-invites", id: "mplInvites", hidden: true });
    const dirBox = h("div", { class: "mpl-dir", id: "mplDir", hidden: true });
    const takeName = () => { if (!ident.signedIn) me.name = cleanName(nameInput.value) || me.name; };

    entry.replaceChildren(
      h("h2", { id: "mplEntryTitle" }, `${game.emoji} ${game.name}`),
      msg,
      h("div", { class: "mpl-field" },
        h("label", { for: "mplName" }, t("yourName")), nameInput,
        ident.signedIn ? h("small", {}, t("signedInAs", { name: ident.username })) : h("small", {}, t("guestNote"))),
      invitesBox,
      h("div", { class: "mpl-actions" },
        h("button", { class: "mpl-btn mpl-primary", id: "mplCreate", type: "button", onclick: () => { takeName(); void createLobby(); } }, h("b", {}, t("create")), h("small", {}, t("createD"))),
        h("button", { class: "mpl-btn", id: "mplQuick", type: "button", onclick: () => { takeName(); void quickMatch(); } }, h("b", {}, t("quick")), h("small", {}, t("quickD")))),
      h("div", { class: "mpl-join" },
        h("label", { for: "mplCode" }, t("joinTitle")),
        h("div", { class: "mpl-joinrow" }, codeInput, h("button", { class: "mpl-btn", id: "mplJoin", type: "button", onclick: joinNow }, t("join")))),
      h("div", { class: "mpl-more" },
        h("button", { class: "mpl-link", id: "mplOpenList", type: "button", "aria-expanded": "false", onclick: (e) => toggleDirectory(e.currentTarget, dirBox) }, t("openLobbies")),
        game.ai ? h("a", { class: "mpl-link", href: offlineUrl(game.id) }, "🤖 " + t("vsAi")) : null,
        h("a", { class: "mpl-link", href: "pixelbreak.html" }, "‹ Arcade")),
      dirBox,
    );
    document.getElementById("mplCreate")?.focus?.();
    if (ident.signedIn) void loadInvites(invitesBox);
  }

  async function loadInvites(box) {
    try {
      const { data, error } = await ident.sb.rpc("my_game_invites");     // one read when this screen opens
      if (error) throw error;
      const mine = (data || []).filter((i) => i.game === game.id && isCode(i.room));
      if (!mine.length || box.isConnected === false) return;
      box.hidden = false;
      box.replaceChildren(h("h3", {}, t("invitesTitle")), ...mine.map((i) => h("div", { class: "mpl-inv" },
        h("span", {}, "🎮 ", t("invitedBy", { name: cleanName(i.from_name) || "?" })),
        h("button", { class: "mpl-btn mpl-small mpl-primary", type: "button", onclick: () => { void markInvite(i.id, "accepted"); void joinLobby(i.room); } }, t("join")),
        h("button", { class: "mpl-btn mpl-small", type: "button", onclick: () => { void markInvite(i.id, "declined"); void loadInvites(box); } }, t("decline")))));
    } catch (e) { warn("invites unavailable", e); }
  }
  async function markInvite(id, status) {
    if (!ident.signedIn || !Number.isFinite(+id)) return;
    try { await ident.sb.from("game_invites").update({ status }).eq("id", +id); } catch (e) { warn("invite status not saved", e); }
  }

  async function toggleDirectory(btn, box) {
    dirPanelOpen = !dirPanelOpen;
    btn.setAttribute("aria-expanded", String(dirPanelOpen));
    box.hidden = !dirPanelOpen;
    if (!dirPanelOpen) { closeRealtime(); return; }
    box.replaceChildren(h("p", { class: "mpl-hint" }, "…"));
    try {
      st.rt = realtimeClient();
      const dir = st.rt.channel(DIR_PREFIX + game.id, { config: { broadcast: { self: false }, presence: { key: myId } } });
      st.dirWatch = dir;
      const paint = () => {
        const list = dirEntries(dir);
        box.replaceChildren(...(list.length ? list.map((e) => h("div", { class: "mpl-inv" },
          h("span", {}, `${e.host || "?"} · `, h("code", {}, e.code), ` · ${t("openN", { n: e.n, m: e.x })}`),
          e.n < e.x ? h("button", { class: "mpl-btn mpl-small mpl-primary", type: "button", onclick: () => { if (!ident.signedIn) me.name = cleanName(document.getElementById("mplName")?.value) || me.name; void joinLobby(e.code); } }, t("join")) : null))
          : [h("p", { class: "mpl-hint" }, t("noOpen"))]));
      };
      dir.on("presence", { event: "sync" }, paint);
      await subscribe(dir);
      paint();
    } catch (e) { warn("directory unavailable", e); box.replaceChildren(h("p", { class: "mpl-hint" }, t("eNoServer"))); }
  }

  /* ---------- rendering: the lobby screen ---------- */
  let built = false;
  const els = {};
  function buildLobby() {
    built = true;
    els.code = h("b", { class: "mpl-code", tabindex: "-1" });
    els.copy = h("button", { class: "mpl-btn", id: "mplCopy", type: "button", onclick: copyLink }, t("copyLink"));
    els.share = navigator.share ? h("button", { class: "mpl-btn", id: "mplShare", type: "button", onclick: shareLink }, t("share")) : null;
    els.add = h("button", { class: "mpl-btn mpl-primary", id: "mplAdd", type: "button", onclick: () => void openPicker() }, "＋ " + t("addPeople"));
    els.list = h("ul", { class: "mpl-roster", id: "mplRoster", "aria-label": t("players") });
    els.count = h("span", { class: "mpl-count" });
    els.settings = h("div", { class: "mpl-settings", id: "mplSettings" });
    els.pubRow = h("label", { class: "mpl-check", id: "mplPubRow" });
    els.pub = h("input", { type: "checkbox", id: "mplPublic", onchange: () => { st.pub = els.pub.checked; void retrack(); syncPublishing(); } });
    els.pubRow.append(els.pub, " ", t("publicLbl"));
    els.hint = h("p", { class: "mpl-hint", id: "mplHint" });
    els.ready = h("button", { class: "mpl-btn mpl-primary", id: "mplReady", type: "button", "aria-pressed": "false", onclick: () => { me.ready = !me.ready; void retrack(); renderLobby(); } });
    els.start = h("button", { class: "mpl-btn mpl-primary", id: "mplStart", type: "button", onclick: () => void startGame() }, t("start"));
    els.leave = h("button", { class: "mpl-btn", id: "mplLeave", type: "button", onclick: () => leaveToEntry() }, t("leave"));
    lobby.replaceChildren(
      h("header", { class: "mpl-head" },
        h("div", {}, h("h2", { id: "mplLobbyTitle" }, `${game.emoji} ${game.name} — ${t("lobby")}`),
          h("div", { class: "mpl-codebox" }, h("small", {}, t("code")), els.code)),
        h("div", { class: "mpl-headbtns" }, els.copy, els.share, els.add)),
      h("div", { class: "mpl-cols" },
        h("div", {}, h("h3", {}, t("players"), " ", els.count), els.list),
        h("div", {}, els.settings, els.pubRow)),
      els.hint,
      h("div", { class: "mpl-foot" }, els.leave, els.ready, els.start));
  }
  function renderLobby() {
    if (!st.joined) return;
    if (!built) buildLobby();
    const members = st.members, n = members.length, host = isHost();
    els.code.textContent = st.code;
    els.code.setAttribute("aria-label", `${t("code")}: ${st.code.split("").join(" ")}`);
    els.count.textContent = `${n}/${game.max}`;
    // roster rows: members, invited-but-not-here, empty slots
    const rows = members.map((m) => {
      const isMe = m.id === myId, isH = m.id === st.hostId;
      return h("li", { class: "mpl-row", "data-id": m.id, "data-ready": m.ready || isH ? "1" : "0" },
        avatarEl(m.name, m.avatar),
        h("span", { class: "mpl-name" }, m.name, isMe ? h("em", {}, ` (${t("you")})`) : null, isH ? " " : null, isH ? h("span", { class: "mpl-tag" }, "👑 " + t("hostTag")) : null),
        h("span", { class: "mpl-state" }, isH ? "" : (m.ready ? "✓ " + t("isReady") : t("isWaiting"))),
        host && !isMe ? h("button", { class: "mpl-x", type: "button", "aria-label": t("kickAria", { name: m.name }), title: t("kick"), onclick: () => kick(m) }, h("span", { "aria-hidden": "true" }, "✕")) : null);
    });
    for (const [uid, inv] of st.invited) {
      rows.push(h("li", { class: "mpl-row mpl-invited", "data-uid": uid }, avatarEl(inv.username, ""), h("span", { class: "mpl-name" }, inv.username || "…"), h("span", { class: "mpl-state" }, t("invitedTag"))));
    }
    for (let i = rows.length, shown = 0; i < game.max && shown < MAX_EMPTY_SLOTS; i++, shown++) rows.push(h("li", { class: "mpl-row mpl-empty" }, h("span", { class: "mpl-av mpl-av-empty", "aria-hidden": "true" }), h("span", { class: "mpl-name" }, t("empty"))));
    els.list.replaceChildren(...rows);
    renderSettings(host);
    els.pubRow.hidden = !host;
    els.pub.checked = st.pub;
    // footer
    els.ready.hidden = host;
    els.ready.textContent = me.ready ? t("notReady") : t("ready");
    els.ready.setAttribute("aria-pressed", String(me.ready));
    els.start.hidden = !host;
    els.start.disabled = !canStart();
    let hint = "";
    if (st.starting) hint = t("starting");
    else if (host) hint = n < game.min ? t("needMore", { n: game.min }) : (canStart() ? t("readyToGo") : t("waitReady"));
    else hint = me.ready ? t("waitHost") : "";
    els.hint.textContent = hint;
    if (!ident.signedIn) els.hint.textContent = (hint ? hint + " " : "") + t("guestNote");
  }
  function renderSettings(host) {
    const defs = game.settings;
    els.settings.hidden = !defs.length;
    if (!defs.length) return;
    const sig = JSON.stringify([st.cfg, host]);
    if (els.settings.dataset.sig === sig) return;
    els.settings.dataset.sig = sig;
    els.settings.replaceChildren(h("h3", {}, t("settings")), ...defs.map((d) => {
      const label = d.label[lang] || d.label.en;
      const cur = st.cfg[d.key];
      const chips = d.options.map((o) => {
        const on = d.type === "multi" ? cur.includes(o.v) : cur === o.v;
        return h("button", { class: "mpl-chip", type: "button", "aria-pressed": String(on), disabled: !host, "data-v": o.v,
          onclick: () => setSetting(d, o.v) }, o.label);
      });
      return h("div", { class: "mpl-setting", role: "group", "aria-label": label }, h("h4", {}, `${label}${d.type === "multi" ? ` (${cur.length})` : ""}`), h("div", { class: "mpl-chips" }, chips));
    }));
  }
  function setSetting(def, v) {
    if (!isHost()) return;
    const cur = st.cfg[def.key];
    let next;
    if (def.type === "multi") {
      const has = cur.includes(v);
      if (has && cur.length <= (def.min || 1)) return;
      next = has ? cur.filter((x) => x !== v) : [...cur, v];
    } else next = v;
    st.cfg = sanitizeCfg(game.id, { ...st.cfg, [def.key]: next });
    renderLobby();
    void retrack();
  }
  function kick(m) {
    if (!isHost() || m.id === myId) return;
    try { st.ch.send({ type: "broadcast", event: "kick", payload: { to: m.id } }); } catch (e) { warn("kick failed", e); }
    say(t("left", { name: m.name }));
  }

  /* ---------- boot ---------- */
  const code = cleanCode(params.get("c") || "");
  const back = params.get("back") === "1";
  // ?invite=uid~name,uid~name  (from the friends page chooser: create the lobby and invite that friend straight away)
  const inviteIds = (params.get("invite") || "").split(",").map((x) => x.split("~")).filter(([id]) => UUID_RE.test(id))
    .map(([id, name]) => ({ id: id.toLowerCase(), username: cleanName(name || "") })).slice(0, MAX_INVITE_BATCH);
  if (params.get("c") === "new") {
    await createLobby({ invite: inviteIds });
  } else if (code && isCode(code)) {
    const wasHost = back && params.get("host") === "1";             // mp-gate.js adds host=1 for the player who hosted the game
    if (wasHost) await createLobby({ code, cfg: storedCfg(game.id, code) });   // the settings of the match that just ended
    else await joinLobby(code, { waitForHost: back });
  } else {
    renderEntry();
  }
  return { state: st, leave: () => leaveToEntry() };
}


/** the settings the last match of this lobby was started with (the rematch lobby opens with them) */
function storedCfg(gameId, code) {
  try {
    const c = JSON.parse(store.get(CTX_KEY, true) || "null");
    return c && c.game === gameId && c.code === code && c.cfg && typeof c.cfg === "object" ? c.cfg : null;
  } catch { return null; }
}
