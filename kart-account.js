import * as auth from "./auth.js?v=27";

const USERNAME_SHAPE = /^[A-Za-z0-9_.-]{3,20}$/;
const TOKEN_SHAPE = /^[0-9a-f]{32}$/i;
const MIN_PASSWORD_LENGTH = 8;
const LOCALES = { lb: "lb-LU", de: "de-DE", en: "en-GB" };
const STRINGS = {
  title: { lb: "Mäi Karting", de: "Mein Karting", en: "My karting" },
  intro: { lb: "Deng KartTracker-Sessiounen an deng Garmin-Aueren op enger Plaz.", de: "Deine KartTracker-Sitzungen und Garmin-Uhren an einem Ort.", en: "Your KartTracker sessions and Garmin watches in one place." },
  signIn: { lb: "Umellen", de: "Anmelden", en: "Sign in" },
  create: { lb: "Karting-Kont erstellen", de: "Karting-Konto erstellen", en: "Create karting account" },
  email: { lb: "E-Mail", de: "E-Mail", en: "Email" },
  username: { lb: "Benotzernumm", de: "Benutzername", en: "Username" },
  usernameHint: { lb: "3–20 Zeechen: Buschtawen, Zuelen, Punkt, Bindestréch oder _.", de: "3–20 Zeichen: Buchstaben, Zahlen, Punkt, Bindestrich oder _.", en: "3–20 characters: letters, numbers, dot, dash or _." },
  password: { lb: "Passwuert", de: "Passwort", en: "Password" },
  confirmPassword: { lb: "Passwuert widderhuelen", de: "Passwort wiederholen", en: "Confirm password" },
  passwordHint: { lb: "Op d'mannst 8 Zeechen.", de: "Mindestens 8 Zeichen.", en: "At least 8 characters." },
  forgot: { lb: "Passwuert vergiess?", de: "Passwort vergessen?", en: "Forgot password?" },
  sendReset: { lb: "Reset-Link schécken", de: "Reset-Link senden", en: "Send reset link" },
  back: { lb: "← Zréck", de: "← Zurück", en: "← Back" },
  fullAccount: { lb: "Hues du schonn en normale ian.lu-Kont?", de: "Hast du schon ein normales ian.lu-Konto?", en: "Already have an ian.lu account?" },
  fullSignIn: { lb: "Mat ian.lu umellen", de: "Mit ian.lu anmelden", en: "Sign in with ian.lu" },
  complete: { lb: "Fëll w.e.g. alles aus.", de: "Bitte fülle alles aus.", en: "Please complete every field." },
  invalidUsername: { lb: "De Benotzernumm muss 3–20 erlaabt Zeechen hunn.", de: "Der Benutzername muss 3–20 erlaubte Zeichen haben.", en: "The username must contain 3–20 allowed characters." },
  shortPassword: { lb: "D'Passwuert muss op d'mannst 8 Zeechen hunn.", de: "Das Passwort muss mindestens 8 Zeichen haben.", en: "The password must be at least 8 characters." },
  passwordMismatch: { lb: "D'Passwierder sinn net d'selwecht.", de: "Die Passwörter stimmen nicht überein.", en: "The passwords do not match." },
  signInError: { lb: "D'Umeldung ass net gaangen. Kontrolléier E-Mail a Passwuert.", de: "Die Anmeldung hat nicht geklappt. Prüfe E-Mail und Passwort.", en: "Sign-in failed. Check your email and password." },
  signUpError: { lb: "De Karting-Kont konnt net erstallt ginn. Probéier nach eng Kéier.", de: "Das Karting-Konto konnte nicht erstellt werden. Versuche es erneut.", en: "The karting account could not be created. Try again." },
  checkEmail: { lb: "Kuck an deng E-Mail a confirméier de Kont.", de: "Schau in deine E-Mails und bestätige das Konto.", en: "Check your email to confirm the account." },
  resetSent: { lb: "Wann et e Kont mat dëser E-Mail gëtt, ass de Reset-Link ënnerwee.", de: "Falls es ein Konto mit dieser E-Mail gibt, ist der Reset-Link unterwegs.", en: "If an account uses this email, a reset link is on its way." },
  resetError: { lb: "De Reset-Link konnt net geschéckt ginn. Probéier méi spéit nach eng Kéier.", de: "Der Reset-Link konnte nicht gesendet werden. Versuche es später erneut.", en: "The reset link could not be sent. Try again later." },
  setPassword: { lb: "Neit Passwuert setzen", de: "Neues Passwort setzen", en: "Set new password" },
  recoveryIntro: { lb: "Wiel en neit Passwuert fir däi Karting-Kont.", de: "Wähle ein neues Passwort für dein Karting-Konto.", en: "Choose a new password for your karting account." },
  savePassword: { lb: "Passwuert späicheren", de: "Passwort speichern", en: "Save password" },
  passwordSaved: { lb: "Däin neit Passwuert ass gespäichert.", de: "Dein neues Passwort wurde gespeichert.", en: "Your new password has been saved." },
  passwordSaveError: { lb: "D'Passwuert konnt net gespäichert ginn. Maach de Reset-Link nach eng Kéier op.", de: "Das Passwort konnte nicht gespeichert werden. Öffne den Reset-Link erneut.", en: "The password could not be saved. Open the reset link again." },
  signedInAs: { lb: "Ugemellt als {name}", de: "Angemeldet als {name}", en: "Signed in as {name}" },
  signOut: { lb: "Ofmellen", de: "Abmelden", en: "Sign out" },
  sessions: { lb: "Sessiounen", de: "Sitzungen", en: "Sessions" },
  watches: { lb: "Aueren", de: "Uhren", en: "Watches" },
  loading: { lb: "Lueden…", de: "Laden…", en: "Loading…" },
  loadError: { lb: "Deng Donnéeë konnten net geluede ginn. Probéier nach eng Kéier.", de: "Deine Daten konnten nicht geladen werden. Versuche es erneut.", en: "Your data could not be loaded. Try again." },
  noSessions: { lb: "Nach keng Sessiounen — verbann deng Garmin-Auer: maach KartTracker op der Auer op a scann de QR-Code.", de: "Noch keine Sitzungen — verbinde deine Garmin-Uhr: Öffne KartTracker auf der Uhr und scanne den QR-Code.", en: "No sessions yet — link your Garmin watch: open KartTracker on the watch and scan the QR code." },
  noWatches: { lb: "Nach keng Auer verbonnen — maach KartTracker op der Auer op a scann de QR-Code.", de: "Noch keine Uhr verbunden — öffne KartTracker auf der Uhr und scanne den QR-Code.", en: "No watches linked yet — open KartTracker on the watch and scan the QR code." },
  laps: { lb: "{n} Ronnen", de: "{n} Runden", en: "{n} laps" },
  bestLap: { lb: "Bescht Ronn {time}", de: "Beste Runde {time}", en: "Best lap {time}" },
  view: { lb: "Ukucken", de: "Ansehen", en: "View" },
  rename: { lb: "Ëmbenennen", de: "Umbenennen", en: "Rename" },
  delete: { lb: "Läschen", de: "Löschen", en: "Delete" },
  save: { lb: "Späicheren", de: "Speichern", en: "Save" },
  cancel: { lb: "Ofbriechen", de: "Abbrechen", en: "Cancel" },
  sessionName: { lb: "Numm vun der Streck", de: "Name der Strecke", en: "Track name" },
  renameError: { lb: "De Numm konnt net gespäichert ginn.", de: "Der Name konnte nicht gespeichert werden.", en: "The name could not be saved." },
  deleteConfirm: { lb: "Dës Sessioun wierklech läschen?", de: "Diese Sitzung wirklich löschen?", en: "Delete this session?" },
  deleteError: { lb: "D'Sessioun konnt net geläscht ginn.", de: "Die Sitzung konnte nicht gelöscht werden.", en: "The session could not be deleted." },
  watchDefault: { lb: "Garmin-Auer", de: "Garmin-Uhr", en: "Garmin watch" },
  lastSeen: { lb: "Fir d'lescht gesinn: {date}", de: "Zuletzt gesehen: {date}", en: "Last seen: {date}" },
  neverSeen: { lb: "Nach net gesinn", de: "Noch nicht gesehen", en: "Not seen yet" },
  sessionCount: { lb: "{n} Sessiounen", de: "{n} Sitzungen", en: "{n} sessions" },
  unlink: { lb: "Trennen", de: "Trennen", en: "Unlink" },
  unlinkConfirm: { lb: "Dës Auer trennen? Gespäichert Sessioune bleiwen an dengem Kont.", de: "Diese Uhr trennen? Gespeicherte Sitzungen bleiben in deinem Konto.", en: "Unlink this watch? Saved sessions will stay in your account." },
  unlinkError: { lb: "D'Auer konnt net getrennt ginn.", de: "Die Uhr konnte nicht getrennt werden.", en: "The watch could not be unlinked." },
  untitled: { lb: "Karting-Sessioun", de: "Karting-Sitzung", en: "Karting session" },
  signOutError: { lb: "D'Ofmelle konnt net ofgeschloss ginn.", de: "Die Abmeldung konnte nicht abgeschlossen werden.", en: "Sign-out could not be completed." },
};

const $ = (id) => document.getElementById(id);
const app = $("app");
const query = new URLSearchParams(location.search);
const initialRecovery = new URLSearchParams(location.hash.replace(/^#/, "")).get("type") === "recovery";
let sb = null;
let mode = "signin";
let recoveryMode = initialRecovery;
let renderVersion = 0;
let navigating = false;
let flashMessage = "";

function text(key, values = {}) {
  const entry = STRINGS[key];
  const template = entry?.[window.I18N?.lang] || entry?.en || key;
  return Object.entries(values).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
    template,
  );
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function validRelativePath(raw) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "";
  try {
    const parsed = new URL(raw, location.origin);
    if (parsed.origin !== location.origin) return "";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (error) {
    console.error("Invalid kart account next path", error);
    return "";
  }
}

const nextPath = validRelativePath(query.get("next"));
const deviceToken = TOKEN_SHAPE.test(query.get("t") || "")
  ? query.get("t").toLowerCase()
  : "";
const kept = new URLSearchParams();
if (nextPath) kept.set("next", nextPath);
if (deviceToken) kept.set("t", deviceToken);
const keepQuery = kept.size ? `?${kept.toString()}` : "";
const destination = nextPath || (deviceToken ? `/kart-link.html?t=${deviceToken}` : "");

function locale() {
  return LOCALES[window.I18N?.lang] || LOCALES.lb;
}

function fmtDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale(), {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtLap(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "—";
  const minutes = Math.floor(value / 60);
  const rest = (value - minutes * 60).toFixed(3).padStart(6, "0");
  return `${minutes}:${rest}`;
}

function setFormMessage(message, kind = "") {
  const element = $("formMessage");
  if (!element) return;
  element.className = `msg${kind ? ` ${kind}` : ""}`;
  element.textContent = message;
}

function heroMarkup() {
  return `<section class="ui-card ui-card--accent hero">
    <div class="hero-ico" aria-hidden="true">🏁</div>
    <div><h1 class="ui-title">${esc(text("title"))}</h1><p>${esc(text("intro"))}</p></div>
  </section>`;
}

function field(id, label, type, autocomplete, extra = "") {
  return `<div class="field"><label for="${id}">${esc(label)}</label>
    <input class="ui-input" id="${id}" name="${id}" type="${type}" autocomplete="${autocomplete}" ${extra}></div>`;
}

function signedOutMarkup() {
  const signup = mode === "signup";
  return `${heroMarkup()}<section class="ui-card auth-card">
    <div class="tabs" role="tablist">
      <button class="tab${signup ? "" : " on"}" type="button" data-mode="signin" role="tab" aria-selected="${!signup}">${esc(text("signIn"))}</button>
      <button class="tab${signup ? " on" : ""}" type="button" data-mode="signup" role="tab" aria-selected="${signup}">${esc(text("create"))}</button>
    </div>
    <form class="form" id="accountForm">
      ${field("email", text("email"), "email", "email", "required")}
      ${signup ? `${field("username", text("username"), "text", "username", 'required minlength="3" maxlength="20" pattern="[A-Za-z0-9_.-]{3,20}"')}<p class="msg">${esc(text("usernameHint"))}</p>` : ""}
      ${field("password", text("password"), "password", signup ? "new-password" : "current-password", `${signup ? 'minlength="8"' : ""} required`)}
      ${signup ? `${field("passwordConfirm", text("confirmPassword"), "password", "new-password", 'minlength="8" required')}<p class="msg">${esc(text("passwordHint"))}</p>` : ""}
      <div class="actions"><button class="ui-btn ui-btn--primary" type="submit" id="submitButton">${esc(text(signup ? "create" : "signIn"))}</button>
      ${signup ? "" : `<button class="link-button" type="button" id="forgotButton">${esc(text("forgot"))}</button>`}</div>
      <p class="msg" id="formMessage" role="status" aria-live="polite"></p>
    </form>
    <p class="small-link">${esc(text("fullAccount"))} <button type="button" id="fullSignIn">${esc(text("fullSignIn"))}</button></p>
  </section>`;
}

function wireSignedOut() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      mode = button.dataset.mode;
      render();
    });
  });
  $("fullSignIn").addEventListener("click", auth.openAuthModal);
  $("forgotButton")?.addEventListener("click", renderForgot);
  $("accountForm").addEventListener("submit", submitAccount);
}

async function submitAccount(event) {
  event.preventDefault();
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) {
    setFormMessage(text("complete"), "err");
    return;
  }
  const button = $("submitButton");
  button.disabled = true;
  setFormMessage("…");
  try {
    if (mode === "signin") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      goToDestination();
      return;
    }
    const username = $("username").value.trim();
    const confirmation = $("passwordConfirm").value;
    if (!USERNAME_SHAPE.test(username)) {
      setFormMessage(text("invalidUsername"), "err");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormMessage(text("shortPassword"), "err");
      return;
    }
    if (password !== confirmation) {
      setFormMessage(text("passwordMismatch"), "err");
      return;
    }
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { username, account_kind: "kart" },
        emailRedirectTo: `${location.origin}/kart-account.html${keepQuery}`,
      },
    });
    if (error) throw error;
    if (data.session) {
      goToDestination();
      return;
    }
    setFormMessage(text("checkEmail"), "ok");
  } catch (error) {
    console.error(`Kart account ${mode} failed`, error);
    setFormMessage(text(mode === "signup" ? "signUpError" : "signInError"), "err");
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

function renderForgot() {
  app.innerHTML = `${heroMarkup()}<section class="ui-card auth-card">
    <h2 class="ui-title">${esc(text("forgot"))}</h2>
    <form class="form" id="resetForm">
      ${field("resetEmail", text("email"), "email", "email", "required")}
      <div class="actions"><button class="ui-btn ui-btn--primary" type="submit" id="resetButton">${esc(text("sendReset"))}</button>
      <button class="link-button" type="button" id="backButton">${esc(text("back"))}</button></div>
      <p class="msg" id="formMessage" role="status" aria-live="polite"></p>
    </form>
  </section>`;
  $("backButton").addEventListener("click", render);
  $("resetForm").addEventListener("submit", submitReset);
}

async function submitReset(event) {
  event.preventDefault();
  const email = $("resetEmail").value.trim();
  if (!email) {
    setFormMessage(text("complete"), "err");
    return;
  }
  const button = $("resetButton");
  button.disabled = true;
  setFormMessage("…");
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/kart-account.html`,
    });
    if (error) throw error;
    setFormMessage(text("resetSent"), "ok");
  } catch (error) {
    console.error("Kart account password reset failed", error);
    setFormMessage(text("resetError"), "err");
  } finally {
    button.disabled = false;
  }
}

function recoveryMarkup() {
  return `${heroMarkup()}<section class="ui-card auth-card">
    <h2 class="ui-title">${esc(text("setPassword"))}</h2>
    <p class="msg">${esc(text("recoveryIntro"))}</p>
    <form class="form" id="recoveryForm">
      ${field("newPassword", text("password"), "password", "new-password", 'minlength="8" required')}
      ${field("newPasswordConfirm", text("confirmPassword"), "password", "new-password", 'minlength="8" required')}
      <button class="ui-btn ui-btn--primary" type="submit" id="recoveryButton">${esc(text("savePassword"))}</button>
      <p class="msg" id="formMessage" role="status" aria-live="polite"></p>
    </form>
  </section>`;
}

async function submitRecovery(event) {
  event.preventDefault();
  const password = $("newPassword").value;
  const confirmation = $("newPasswordConfirm").value;
  if (password.length < MIN_PASSWORD_LENGTH) {
    setFormMessage(text("shortPassword"), "err");
    return;
  }
  if (password !== confirmation) {
    setFormMessage(text("passwordMismatch"), "err");
    return;
  }
  const button = $("recoveryButton");
  button.disabled = true;
  setFormMessage("…");
  try {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw error;
    recoveryMode = false;
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    flashMessage = text("passwordSaved");
    render();
  } catch (error) {
    console.error("Kart account password update failed", error);
    setFormMessage(text("passwordSaveError"), "err");
    button.disabled = false;
  }
}

function dashboardMarkup() {
  const name = auth.username() || auth.session()?.user?.email || "";
  const flash = flashMessage;
  flashMessage = "";
  return `${heroMarkup()}<section class="ui-card dash-head">
    <div><h2 class="ui-title">${esc(text("title"))}</h2><p>${esc(text("signedInAs", { name }))}</p></div>
    <button class="ui-btn ui-btn--ghost" type="button" id="signOutButton">${esc(text("signOut"))}</button>
  </section>
  ${flash ? `<p class="msg ok" role="status">${esc(flash)}</p>` : ""}
  <section class="ui-card"><div class="section-head"><h2>${esc(text("sessions"))}</h2><span class="count" id="sessionCount"></span></div><div id="sessions"><div class="loading">${esc(text("loading"))}</div></div></section>
  <section class="ui-card"><div class="section-head"><h2>${esc(text("watches"))}</h2><span class="count" id="watchCount"></span></div><div id="watches"><div class="loading">${esc(text("loading"))}</div></div></section>`;
}

function emptyMarkup(icon, message) {
  return `<div class="empty"><div class="empty-ico" aria-hidden="true">${icon}</div><p>${esc(message)}</p></div>`;
}

function sessionMarkup(row) {
  const name = row.track_name || text("untitled");
  const details = [
    fmtDate(row.session_date || row.created_at),
    text("laps", { n: Number(row.lap_count) || 0 }),
    text("bestLap", { time: fmtLap(row.best_lap) }),
  ].filter(Boolean);
  return `<article class="item" data-session-id="${esc(row.id)}">
    <div class="item-main"><div class="item-title" data-session-title>${esc(name)}</div><div class="item-sub">${details.map((part) => `<span>${esc(part)}</span>`).join("")}</div></div>
    <div class="item-actions">
      <a class="ui-btn ui-btn--ghost" href="kart.html?s=${encodeURIComponent(row.id)}">${esc(text("view"))}</a>
      <button class="ui-btn ui-btn--ghost" type="button" data-rename>${esc(text("rename"))}</button>
      <button class="ui-btn ui-btn--ghost danger" type="button" data-delete>${esc(text("delete"))}</button>
    </div>
  </article>`;
}

function watchMarkup(row) {
  const seen = row.last_seen_at
    ? text("lastSeen", { date: fmtDate(row.last_seen_at) })
    : text("neverSeen");
  return `<article class="item" data-device-id="${esc(row.id)}">
    <div class="item-main"><div class="item-title">${esc(row.name || text("watchDefault"))}</div>
      <div class="item-sub"><span>${esc(seen)}</span><span>${esc(text("sessionCount", { n: Number(row.session_count) || 0 }))}</span></div></div>
    <div class="item-actions"><button class="ui-btn ui-btn--ghost danger" type="button" data-unlink>${esc(text("unlink"))}</button></div>
  </article>`;
}

function renderSessions(rows) {
  $("sessionCount").textContent = String(rows.length);
  $("sessions").innerHTML = rows.length
    ? `<div class="stack">${rows.map(sessionMarkup).join("")}</div>`
    : emptyMarkup("🏎️", text("noSessions"));
  $("sessions").querySelectorAll("[data-rename]").forEach((button) => {
    button.addEventListener("click", () => beginRename(button.closest("[data-session-id]")));
  });
  $("sessions").querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteSession(button));
  });
}

function renderWatches(rows) {
  $("watchCount").textContent = String(rows.length);
  $("watches").innerHTML = rows.length
    ? `<div class="stack">${rows.map(watchMarkup).join("")}</div>`
    : emptyMarkup("⌚", text("noWatches"));
  $("watches").querySelectorAll("[data-unlink]").forEach((button) => {
    button.addEventListener("click", () => unlinkWatch(button));
  });
}

function renderSectionError(id, error) {
  console.error(`Kart account ${id} load failed`, error);
  $(id).innerHTML = `<div class="section-error" role="alert">${esc(text("loadError"))}</div>`;
}

async function loadDashboard(version) {
  const [sessionsResult, devicesResult] = await Promise.all([
    sb.rpc("kart_my_sessions"),
    sb.rpc("kart_my_devices"),
  ]);
  if (version !== renderVersion || !auth.session()) return;
  if (sessionsResult.error) renderSectionError("sessions", sessionsResult.error);
  else renderSessions(sessionsResult.data || []);
  if (devicesResult.error) renderSectionError("watches", devicesResult.error);
  else renderWatches(devicesResult.data || []);
}

function beginRename(card) {
  if (!card || card.querySelector(".rename-form")) return;
  const currentName = card.querySelector("[data-session-title]").textContent;
  const form = document.createElement("form");
  form.className = "rename-form";
  form.innerHTML = `<input class="ui-input" name="name" maxlength="60" aria-label="${esc(text("sessionName"))}" value="${esc(currentName)}">
    <button class="ui-btn ui-btn--primary" type="submit">${esc(text("save"))}</button>
    <button class="ui-btn ui-btn--ghost cancel" type="button">${esc(text("cancel"))}</button>
    <p class="msg" role="status"></p>`;
  card.appendChild(form);
  form.querySelector(".cancel").addEventListener("click", () => form.remove());
  form.addEventListener("submit", (event) => renameSession(event, card));
  form.elements.name.focus();
  form.elements.name.select();
}

async function renameSession(event, card) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const message = form.querySelector(".msg");
  button.disabled = true;
  message.textContent = "…";
  try {
    const { data, error } = await sb.rpc("kart_rename_session", {
      p_id: card.dataset.sessionId,
      p_name: form.elements.name.value.trim(),
    });
    if (error) throw error;
    if (data !== true) throw new Error("Session rename was not accepted");
    await refreshDashboard();
  } catch (error) {
    console.error("Kart session rename failed", error);
    message.className = "msg err";
    message.textContent = text("renameError");
    button.disabled = false;
  }
}

async function deleteSession(button) {
  if (!confirm(text("deleteConfirm"))) return;
  button.disabled = true;
  try {
    const card = button.closest("[data-session-id]");
    const { data, error } = await sb.rpc("kart_delete_my_session", {
      p_id: card.dataset.sessionId,
    });
    if (error) throw error;
    if (data !== true) throw new Error("Session delete was not accepted");
    await refreshDashboard();
  } catch (error) {
    console.error("Kart session delete failed", error);
    alert(text("deleteError"));
    button.disabled = false;
  }
}

async function unlinkWatch(button) {
  if (!confirm(text("unlinkConfirm"))) return;
  button.disabled = true;
  try {
    const card = button.closest("[data-device-id]");
    const { data, error } = await sb.rpc("kart_unlink_device", {
      p_device_id: card.dataset.deviceId,
    });
    if (error) throw error;
    if (data !== true) throw new Error("Device unlink was not accepted");
    await refreshDashboard();
  } catch (error) {
    console.error("Kart watch unlink failed", error);
    alert(text("unlinkError"));
    button.disabled = false;
  }
}

async function refreshDashboard() {
  const version = ++renderVersion;
  if ($("sessions")) $("sessions").innerHTML = `<div class="loading">${esc(text("loading"))}</div>`;
  if ($("watches")) $("watches").innerHTML = `<div class="loading">${esc(text("loading"))}</div>`;
  await loadDashboard(version);
}

async function signOut() {
  const button = $("signOutButton");
  button.disabled = true;
  try {
    await auth.signOut();
    render();
  } catch (error) {
    console.error("Kart account sign out failed", error);
    alert(text("signOutError"));
    button.disabled = false;
  }
}

function goToDestination() {
  if (!destination || navigating || recoveryMode) return false;
  navigating = true;
  location.assign(destination);
  return true;
}

function render() {
  const version = ++renderVersion;
  if (recoveryMode) {
    app.innerHTML = recoveryMarkup();
    $("recoveryForm").addEventListener("submit", submitRecovery);
    return;
  }
  if (!auth.session()) {
    app.innerHTML = signedOutMarkup();
    wireSignedOut();
    return;
  }
  if (goToDestination()) return;
  app.innerHTML = dashboardMarkup();
  $("signOutButton").addEventListener("click", signOut);
  void loadDashboard(version);
}

async function boot() {
  try {
    sb = await auth.client();
    sb.auth.onAuthStateChange((event) => {
      if (event !== "PASSWORD_RECOVERY") return;
      recoveryMode = true;
      render();
    });
    auth.onAuth(() => render());
    document.addEventListener("i18n:change", render);
    render();
  } catch (error) {
    console.error("Kart account initialization failed", error);
    app.innerHTML = `${heroMarkup()}<div class="ui-card section-error" role="alert">${esc(text("loadError"))}</div>`;
  }
}

void boot();
