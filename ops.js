/* Status — are brix and the Mac Mini alive, and is Supabase inside its free quota?
 *
 * Three tiles, nothing per-service: if a machine is up, what runs on it is up.
 * The third tile (Supabase) is the free-plan usage watch: egress this billing
 * cycle against 5 GB, with the projection and the last 24 h on its detail line.
 * The page deliberately computes nothing: every verdict arrives already
 * resolved from the `ops` edge function (supabase/functions/ops/health.ts), so
 * there is one place where "is this machine alive" is decided.
 *
 * English rather than Luxembourgish: every term here is technical and
 * translating them would mean inventing vocabulary. The two gate strings are
 * the site's existing reviewed LB ones. */
import * as auth from "./auth.js?v=39";

const OWNER = "konto@ian.lu";
const REFRESH_MS = 20_000;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* Never colour alone: each state has its own glyph and word. `unknown` is not
 * a traffic-light colour — nothing has reported, which is neither good nor bad. */
const STATE = {
  ok: { mark: "●", word: "Up" },
  warn: { mark: "▲", word: "Warning" },
  down: { mark: "✕", word: "Down" },
  unknown: { mark: "○", word: "No report" },
};
/* The Supabase tile reports usage, not liveness, so its words differ: warn =
 * heading for the limit, over = a free-plan limit is already crossed. */
const USAGE_STATE = {
  ok: { mark: "●", word: "OK" },
  warn: { mark: "▲", word: "Warn" },
  down: { mark: "✕", word: "Over" },
  unknown: STATE.unknown,
};
const STALE_STATE = { mark: "✕", word: "No data" };
const SUMMARY = {
  ok: "Everything is up.",
  warn: "Something reports a warning.",
  down: "Something is down.",
  unknown: "Something has not reported yet.",
};

let refreshTimer = null;
let inFlight = false;

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
));

function config() {
  const cfg = window.PB_CONFIG || {};
  if (!cfg.url || !cfg.anonKey) throw new Error("Supabase is not configured on this page.");
  return cfg;
}

async function callOps(body) {
  const cfg = config();
  const token = auth.session()?.access_token;
  if (!token) throw new Error("Not signed in.");
  const response = await fetch(`${cfg.url.replace(/\/$/, "")}/functions/v1/ops`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: cfg.anonKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `The ops service answered ${response.status}.`);
  }
  return data;
}

function gate(title, message, canSignIn = false) {
  $("root").innerHTML = `<section class="gate-panel glass glass--thick">
    <div class="gate-icon">◍</div>
    <h1>${esc(title)}</h1><p>${esc(message)}</p>
    ${canSignIn ? '<button class="primary-button" id="signIn" type="button">Umellen</button>' : ""}
  </section>`;
  if (canSignIn) $("signIn").onclick = () => auth.openAuthModal();
}

/** "last seen 3 min ago", from the server's own age so a wrong phone clock can't skew it. */
function lastSeen(seconds) {
  if (seconds === null || seconds === undefined) return "never seen";
  if (seconds < MINUTE) return "last seen just now";
  if (seconds < HOUR) return `last seen ${Math.floor(seconds / MINUTE)} min ago`;
  if (seconds < DAY) {
    const hours = Math.floor(seconds / HOUR);
    const minutes = Math.floor((seconds % HOUR) / MINUTE);
    return `last seen ${hours} h${minutes ? ` ${minutes} min` : ""} ago`;
  }
  return `last seen ${Math.floor(seconds / DAY)} d ago`;
}

function tile(machine) {
  const states = machine.key === "supabase" ? USAGE_STATE : STATE;
  const state = machine.stale && machine.key === "supabase"
    ? STALE_STATE : (states[machine.health] || STATE.unknown);
  const seen = machine.health === "unknown" ? "nothing has reported yet" : lastSeen(machine.ageSeconds);
  return `<article class="tile tile--${esc(machine.health)}">
    <div class="tile-mark" aria-hidden="true">${state.mark}</div>
    <h2 class="tile-name">${esc(machine.label)}</h2>
    <p class="tile-what">${esc(machine.what)}</p>
    <p class="tile-state"><span class="sr-only">Status: </span>${esc(state.word)}</p>
    <p class="tile-seen">${esc(seen)}</p>
    ${machine.detailText ? `<p class="tile-detail">${esc(machine.detailText)}</p>` : ""}
    ${machine.lastError && machine.health !== "ok"
      ? `<p class="tile-detail tile-detail--error">${esc(machine.lastError)}</p>` : ""}
  </article>`;
}

function render(state) {
  $("root").innerHTML = `
    <section class="ops-summary glass glass--thick ops-summary--${esc(state.overall)}">
      <div>
        <h1>Status</h1>
        <p>${esc(SUMMARY[state.overall] || "")}</p>
      </div>
      <button class="ops-refresh" id="refresh" type="button" title="Refresh now" aria-label="Refresh now">↻</button>
    </section>
    <div class="tiles">${state.machines.map(tile).join("")}</div>
    <p class="ops-stamp">checked ${esc(new Date(state.checkedAt).toLocaleTimeString())}</p>`;
  $("refresh").onclick = () => refresh(true);
}

async function refresh(manual = false) {
  if (inFlight) return;
  inFlight = true;
  try {
    render(await callOps({ action: "status" }));
  } catch (error) {
    if (manual || !document.querySelector(".tiles")) {
      $("root").innerHTML = `<section class="gate-panel glass glass--thick">
        <div class="gate-icon">⚠</div><h1>Could not read status</h1>
        <p>${esc(error.message)}</p></section>`;
    }
  } finally {
    inFlight = false;
  }
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, REFRESH_MS);
}

/* Opening the phone should show current state, not whatever was on screen when
 * it was locked. */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});

let bootNumber = 0;
async function boot() {
  const run = ++bootNumber;
  try {
    await auth.client();
    if (run !== bootNumber) return;
    auth.mountAccountButton($("acctHost"));
    const session = auth.session();
    if (!session?.user) {
      gate("Status", "Mell dech un, fir de Status ze gesinn.", true);
      return;
    }
    if ((session.user.email || "").toLowerCase() !== OWNER) {
      gate("Dësen Outil ass privat", "De Status ass nëmme fir de Besëtzer.");
      return;
    }
    await refresh(true);
    startAutoRefresh();
  } catch (error) {
    gate("Status unavailable", error.message || "Could not start the connection.");
  }
}

auth.onAuth(boot);
boot();
