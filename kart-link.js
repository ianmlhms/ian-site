import * as auth from "./auth.js?v=25";

const TOKEN_SHAPE = /^[0-9a-f]{32}$/i;
const STRINGS = {
  title: { lb: "KartTracker-Auer verbannen", de: "KartTracker-Uhr verbinden", en: "Link a KartTracker watch" },
  intro: { lb: "Dëse QR-Code verbënnt deng Garmin-Auer mat dengem Kont. Fréier Sessioune vun dëser Auer ginn dobäi iwwerholl.", de: "Dieser QR-Code verbindet deine Garmin-Uhr mit deinem Konto. Frühere Sitzungen dieser Uhr werden dabei übernommen.", en: "This QR code links your Garmin watch to your account and adds earlier sessions from the watch." },
  invalidTitle: { lb: "Ongültege QR-Code", de: "Ungültiger QR-Code", en: "Invalid QR code" },
  invalidToken: { lb: "Dëse Link huet kee gültegen Auer-Code. Scann de QR-Code op der Auer nach eng Kéier.", de: "Dieser Link enthält keinen gültigen Uhr-Code. Scanne den QR-Code auf der Uhr erneut.", en: "This link does not contain a valid watch code. Scan the QR code on the watch again." },
  signedOut: { lb: "Mell dech un oder erstall e Karting-Kont, fir dës Auer ze verbannen.", de: "Melde dich an oder erstelle ein Karting-Konto, um diese Uhr zu verbinden.", en: "Sign in or create a karting account to link this watch." },
  accountButton: { lb: "Umellen / Karting-Kont erstellen", de: "Anmelden / Karting-Konto erstellen", en: "Sign in / create karting account" },
  fullButton: { lb: "Mat ian.lu-Kont umellen", de: "Mit ian.lu-Konto anmelden", en: "Sign in with ian.lu account" },
  signedInAs: { lb: "Ugemellt als {name}", de: "Angemeldet als {name}", en: "Signed in as {name}" },
  watchName: { lb: "Numm vun der Auer (optional)", de: "Name der Uhr (optional)", en: "Watch name (optional)" },
  watchPlaceholder: { lb: "z. B. Meng Garmin", de: "z. B. Meine Garmin", en: "e.g. My Garmin" },
  linkButton: { lb: "Dës Auer verbannen", de: "Diese Uhr verbinden", en: "Link this watch" },
  linkError: { lb: "D'Auer konnt net verbonne ginn. Probéier nach eng Kéier.", de: "Die Uhr konnte nicht verbunden werden. Versuche es erneut.", en: "The watch could not be linked. Try again." },
  signInError: { lb: "Du bass net méi ugemellt. Mell dech nach eng Kéier un.", de: "Du bist nicht mehr angemeldet. Melde dich erneut an.", en: "You are no longer signed in. Sign in again." },
  success: { lb: "Verbonnen! {n} fréier Sessioune bäigesat.", de: "Verbunden! {n} frühere Sitzungen hinzugefügt.", en: "Linked! {n} earlier sessions added." },
  myKarting: { lb: "Bei Mäi Karting", de: "Zu Mein Karting", en: "Go to My karting" },
  loadError: { lb: "D'Umeldung konnt net geluede ginn. Probéier nach eng Kéier.", de: "Die Anmeldung konnte nicht geladen werden. Versuche es erneut.", en: "Sign-in could not be loaded. Try again." },
};

const app = document.getElementById("app");
const rawToken = new URLSearchParams(location.search).get("t") || "";
const token = TOKEN_SHAPE.test(rawToken) ? rawToken.toLowerCase() : "";
let sb = null;
let linkedCount = null;

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

function shell(icon, title, content) {
  return `<section class="ui-card hero"><div class="hero-ico" aria-hidden="true">${icon}</div>
    <h1 class="ui-title">${esc(title)}</h1>${content}</section>`;
}

function renderInvalid() {
  app.innerHTML = shell("⚠️", text("invalidTitle"), `<p role="alert">${esc(text("invalidToken"))}</p>`);
}

function accountUrl() {
  const current = `${location.pathname}${location.search}`;
  return `kart-account.html?next=${encodeURIComponent(current)}`;
}

function renderSignedOut() {
  app.innerHTML = shell("⌚", text("title"), `<p>${esc(text("intro"))}</p><p>${esc(text("signedOut"))}</p>
    <div class="actions"><a class="ui-btn ui-btn--primary" href="${esc(accountUrl())}">${esc(text("accountButton"))}</a>
    <button class="ui-btn ui-btn--ghost" type="button" id="fullSignIn">${esc(text("fullButton"))}</button></div>`);
  document.getElementById("fullSignIn").addEventListener("click", auth.openAuthModal);
}

function renderLinkForm() {
  const name = auth.username() || auth.session()?.user?.email || "";
  app.innerHTML = shell("⌚", text("title"), `<p>${esc(text("intro"))}</p><p>${esc(text("signedInAs", { name }))}</p>
    <form class="form" id="linkForm">
      <div class="field"><label for="watchName">${esc(text("watchName"))}</label>
      <input class="ui-input" id="watchName" name="watchName" maxlength="40" autocomplete="off" placeholder="${esc(text("watchPlaceholder"))}"></div>
      <button class="ui-btn ui-btn--primary" type="submit" id="linkButton">${esc(text("linkButton"))}</button>
      <p class="msg" id="message" role="status" aria-live="polite"></p>
    </form>`);
  document.getElementById("linkForm").addEventListener("submit", linkWatch);
}

function renderSuccess() {
  app.innerHTML = shell("✅", text("title"), `<p class="msg ok" role="status">${esc(text("success", { n: linkedCount }))}</p>
    <div class="success-link"><a class="ui-btn ui-btn--primary" href="kart-account.html">${esc(text("myKarting"))}</a></div>`);
}

function plainError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("token") || message.includes("32 hex")) return text("invalidToken");
  if (message.includes("sign in") || message.includes("jwt") || error?.code === "42501") {
    return text("signInError");
  }
  return text("linkError");
}

async function linkWatch(event) {
  event.preventDefault();
  const button = document.getElementById("linkButton");
  const message = document.getElementById("message");
  const name = document.getElementById("watchName").value.trim();
  button.disabled = true;
  message.className = "msg";
  message.textContent = "…";
  try {
    const { data, error } = await sb.rpc("kart_link_device", {
      p_token: token,
      p_name: name || null,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    linkedCount = Number(result?.adopted_sessions) || 0;
    renderSuccess();
  } catch (error) {
    console.error("Kart watch link failed", error);
    message.className = "msg err";
    message.textContent = plainError(error);
    button.disabled = false;
  }
}

function render() {
  if (!token) {
    renderInvalid();
    return;
  }
  if (linkedCount !== null) {
    renderSuccess();
    return;
  }
  if (!auth.session()) {
    renderSignedOut();
    return;
  }
  renderLinkForm();
}

async function boot() {
  if (!token) {
    renderInvalid();
    document.addEventListener("i18n:change", render);
    return;
  }
  try {
    sb = await auth.client();
    auth.onAuth(render);
    document.addEventListener("i18n:change", render);
    render();
  } catch (error) {
    console.error("Kart link initialization failed", error);
    app.innerHTML = shell("⚠️", text("title"), `<p role="alert">${esc(text("loadError"))}</p>`);
  }
}

void boot();
