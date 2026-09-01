/* Control Room — health of the services on the server.
 *
 * The page deliberately computes nothing: every verdict, reason and age string
 * arrives already resolved from the `ops` edge function, so there is one place
 * where "is this service healthy" is decided. See supabase/functions/ops/health.ts.
 *
 * English rather than Luxembourgish: every term here is technical (heartbeat,
 * daemon, launchd) and translating them would mean inventing vocabulary. The
 * two gate strings are the site's existing reviewed LB ones. */
import * as auth from "./auth.js?v=12";

const OWNER = "konto@ian.lu";
/* OpsAgent reports on every other service's behalf, so its own health decides
 * whether any of the other verdicts are worth believing. See render(). */
const WATCHER_KEY = "opsagent";
const REFRESH_MS = 20_000;
const COMMAND_POLL_MS = 1500;
const COMMAND_TIMEOUT_MS = 90_000;

const HEALTH_LABEL = {
  ok: "healthy", warn: "warning", missed: "missed a run",
  down: "down", unknown: "no report",
};
/* Not a traffic light: `unknown` must not read as either good or bad. */
const HEALTH_MARK = { ok: "●", warn: "▲", missed: "▲", down: "✕", unknown: "○" };

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
  const session = auth.session();
  const token = session?.access_token;
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

function detailChips(detail) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return "";
  const chips = Object.entries(detail).slice(0, 6).map(([key, value]) =>
    `<span class="chip"><b>${esc(key)}</b> ${esc(
      typeof value === "object" ? JSON.stringify(value) : value,
    )}</span>`);
  return chips.length ? `<div class="chips">${chips.join("")}</div>` : "";
}

function serviceCard(service, watcherSilent) {
  /* No agent means nothing will ever claim the command, so the button would
   * spin for COMMAND_TIMEOUT_MS and then fail. Don't offer it. */
  const canRestart = service.health !== "unknown" && !watcherSilent;
  return `<article class="svc svc--${esc(service.health)}">
    <header class="svc-head">
      <span class="svc-mark" aria-hidden="true">${HEALTH_MARK[service.health] || "○"}</span>
      <span class="svc-name">${esc(service.label)}</span>
      <span class="svc-kind">${esc(service.kind)}</span>
    </header>
    <p class="svc-what">${esc(service.what)}</p>
    <p class="svc-reason"><span class="sr-only">Status: </span>${
      esc(HEALTH_LABEL[service.health] || service.health)} — ${esc(service.reason)}</p>
    ${service.lastError && service.health !== "ok"
      ? `<p class="svc-error">${esc(service.lastError)}</p>` : ""}
    ${detailChips(service.detail)}
    <div class="svc-actions">
      ${canRestart
        ? `<button class="svc-btn" type="button" data-restart="${esc(service.key)}"
             data-label="${esc(service.label)}">Restart</button>`
        : `<span class="svc-hint">${watcherSilent
            ? "no agent to restart it" : "nothing has reported yet"}</span>`}
      <span class="svc-msg" id="msg-${esc(service.key)}" role="status"></span>
    </div>
  </article>`;
}

function alertsList(alerts) {
  if (!alerts.length) return "";
  const rows = alerts.slice(0, 8).map((alert) => `<li>
      <time datetime="${esc(alert.created_at)}">${
        esc(new Date(alert.created_at).toLocaleString())}</time>
      <span>${esc(alert.message)}</span>
    </li>`).join("");
  return `<section class="ops-alerts glass"><h2>Recent changes</h2><ul>${rows}</ul></section>`;
}

function render(state) {
  /* The honesty rule. OpsAgent reports on every other service's behalf, so its
   * own silence is the one verdict that invalidates all the others: a stale
   * `down` is then only the age of whatever the agent last wrote, not evidence
   * that the service stopped. Four confident red crosses are the same lie as
   * four green ticks.
   *
   * This used to test `every(health === "unknown")`, which is true only when no
   * rows exist at all. Rows left behind by a retired host are stale rather than
   * absent, so they slipped past it and the page reported services as down that
   * were in fact healthy on the new host (1 Sep 2026). Ask about the watcher,
   * not about the rows. */
  const watcher = state.services.find((service) => service.key === WATCHER_KEY);
  const watcherSilent = !watcher || watcher.health !== "ok";
  const neverReported = state.services.every((service) => service.health === "unknown");
  const frozenAt = watcher?.lastBeatISO
    ? new Date(watcher.lastBeatISO).toLocaleString() : null;

  const banner = watcherSilent
    ? `<section class="ops-banner glass">
         <h2>${neverReported ? "No reports yet" : "No agent is reporting"}</h2>
         <p>${neverReported
           ? "Nothing has ever written a heartbeat."
           : `Nothing has reported since <b>${esc(frozenAt || "the last run")}</b>.`}
            OpsAgent reports for all of these, so while it is silent the
            verdicts below are <b>frozen, not measured</b> — a service shown as
            down may be running perfectly well. Restarting is disabled until an
            agent is reporting again.</p>
       </section>`
    : "";

  const healthy = state.services.filter((service) => service.health === "ok").length;
  $("root").innerHTML = `
    <section class="ops-summary glass glass--thick ops-summary--${esc(state.overall)}">
      <div>
        <h1>Server</h1>
        <p>${watcherSilent ? "no agent reporting"
          : `${healthy} of ${state.services.length} healthy`}</p>
      </div>
      <button class="ops-refresh" id="refresh" type="button" title="Refresh now">↻</button>
    </section>
    ${banner}
    <div class="ops-grid">${state.services.map((service) => serviceCard(service, watcherSilent)).join("")}</div>
    ${alertsList(state.alerts || [])}
    <p class="ops-stamp">checked ${esc(new Date(state.checkedAt).toLocaleTimeString())}</p>`;

  $("refresh").onclick = () => refresh(true);
  for (const button of document.querySelectorAll("[data-restart]")) {
    button.onclick = () => restart(button.dataset.restart, button.dataset.label, button);
  }
}

async function refresh(manual = false) {
  if (inFlight) return;
  inFlight = true;
  try {
    render(await callOps({ action: "status" }));
  } catch (error) {
    if (manual || !document.querySelector(".ops-grid")) {
      $("root").innerHTML = `<section class="gate-panel glass glass--thick">
        <div class="gate-icon">⚠</div><h1>Could not read status</h1>
        <p>${esc(error.message)}</p></section>`;
    }
  } finally {
    inFlight = false;
  }
}

async function restart(key, label, button) {
  if (!confirm(`Restart ${label} on the server?`)) return;
  const message = $(`msg-${key}`);
  button.disabled = true;
  message.textContent = "queued…";
  try {
    const { command } = await callOps({ action: "command", service: key, verb: "restart" });
    await followCommand(command.id, message);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    refresh();
  }
}

/* The command sits in a table until OpsAgent claims it, so the only honest
 * thing the page can do is watch the row. If nothing claims it, say so —
 * "queued forever" is exactly the symptom of an agent that is not running. */
async function followCommand(id, message) {
  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, COMMAND_POLL_MS));
    const { command } = await callOps({ action: "commandStatus", id });
    if (command.status === "done") {
      message.textContent = command.result || "done";
      return;
    }
    if (command.status === "error") {
      message.textContent = command.error || "failed";
      return;
    }
    message.textContent = command.status === "running" ? "running…" : "queued…";
  }
  message.textContent = "still queued — is OpsAgent running?";
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
      gate("Server", "Mell dech un, fir de Kontrollraum opzemaachen.", true);
      return;
    }
    if ((session.user.email || "").toLowerCase() !== OWNER) {
      gate("Dësen Outil ass privat", "De Kontrollraum ass nëmme fir de Besëtzer.");
      return;
    }
    await refresh(true);
    startAutoRefresh();
  } catch (error) {
    gate("Control room unavailable", error.message || "Could not start the connection.");
  }
}

auth.onAuth(boot);
boot();
