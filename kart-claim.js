import * as auth from "./auth.js?v=24";

const STRINGS = {
  prompt: { lb: "Späicher dës Sessioun an dengem Karting-Kont.", de: "Speichere diese Sitzung in deinem Karting-Konto.", en: "Save this session to your karting account." },
  save: { lb: "A mengem Kont späicheren", de: "In meinem Konto speichern", en: "Save to my account" },
  signIn: { lb: "Umelle fir dës Sessioun ze späicheren", de: "Anmelden, um diese Sitzung zu speichern", en: "Sign in to save this session" },
  saved: { lb: "An dengem Kont gespäichert.", de: "In deinem Konto gespeichert.", en: "Saved to your account." },
  unavailable: { lb: "Dës Sessioun gehéiert zu enger Auer — verbann déi Auer fir se ze späicheren (oder si ass scho gespäichert).", de: "Diese Sitzung gehört zu einer Uhr — verbinde diese Uhr, um sie zu speichern (oder sie ist bereits gespeichert).", en: "This session belongs to a watch — link that watch to save it (or it's already saved)." },
  error: { lb: "D'Sessioun konnt net gespäichert ginn. Probéier nach eng Kéier.", de: "Die Sitzung konnte nicht gespeichert werden. Versuche es erneut.", en: "The session could not be saved. Try again." },
};

const sessionId = new URLSearchParams(location.search).get("s") || "";
let sb = null;
let result = "";

function text(key) {
  const entry = STRINGS[key];
  return entry?.[window.I18N?.lang] || entry?.en || key;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function signInUrl() {
  const next = `${location.pathname}${location.search}`;
  return `kart-account.html?next=${encodeURIComponent(next)}`;
}

function mount() {
  const host = document.getElementById("claimHost");
  if (!host || !sessionId) return;
  if (result) {
    host.innerHTML = `<section class="ui-card claim-box"><p class="${result === "saved" ? "ok" : result === "error" ? "err" : ""}" role="status">${esc(text(result))}</p></section>`;
    return;
  }
  if (!auth.session()) {
    host.innerHTML = `<section class="ui-card claim-box"><p>${esc(text("prompt"))}</p><a class="claim-link" href="${esc(signInUrl())}">${esc(text("signIn"))}</a></section>`;
    return;
  }
  host.innerHTML = `<section class="ui-card claim-box"><p>${esc(text("prompt"))}</p><button class="ui-btn ui-btn--primary" type="button" id="claimButton">${esc(text("save"))}</button></section>`;
  document.getElementById("claimButton").addEventListener("click", claimSession);
}

async function claimSession() {
  const button = document.getElementById("claimButton");
  button.disabled = true;
  try {
    const { data, error } = await sb.rpc("kart_claim", { p_id: sessionId });
    if (error) throw error;
    result = data === true ? "saved" : "unavailable";
  } catch (error) {
    console.error("Kart session claim failed", error);
    result = "error";
  }
  mount();
}

async function boot() {
  if (!sessionId) return;
  try {
    sb = await auth.client();
    auth.onAuth(mount);
    document.addEventListener("kart:rendered", mount);
    document.addEventListener("i18n:change", mount);
    mount();
  } catch (error) {
    console.error("Kart session claim initialization failed", error);
    result = "error";
    mount();
  }
}

void boot();
