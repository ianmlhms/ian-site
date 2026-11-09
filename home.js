/* ian.lu homepage (Gitter look, Nov 2026): greeting + clock, the ⌘K search
 * button, who sees which entry, and the arcade's game of the week.
 *
 * Who sees what (Ian's decisions, 6 Nov 2026):
 *   everyone          Noten, Messenger, Frënn (tagged "Kont" when signed out), Bus & Zuch
 *   class 4C6         Tester            (profiles.class, as class-gate.js / quick-open.js read it)
 *   studio accounts   PPT + Word Builder (studio-allow.js, the list ppt-app.js / doc-app.js enforce)
 *   Ian (is_admin)    Hotel-Simulator, Mäin Dashboard, the Admin row
 *   Ian + kart accts  KartTracker       (auth.isKartAccount, i.e. user_metadata.account_kind === "kart")
 * The pages keep their own gates; this only decides what the homepage lists. */
import { client, session, onAuth, openAuthModal, isKartAccount } from "./auth.js?v=41";
import { isStudioEmail } from "./studio-allow.js?v=1";
import { loadWeekly, countdownText, weeklyGameLabel } from "./arcade-weekly.js?v=12";
import "./quick-open.js?v=12"; // same URL theme.js loads, so this is the same module instance

const TESTER_CLASS = "4C6";
const GATES_KEY = "homeGates";
const WEEKLY_TIMEOUT_MS = 5000;
const MINUTE_MS = 60_000;
const GAME_ID = /^[a-z0-9-]{1,40}$/;
const USAGE_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
const USAGE_KEEP = 40;
const LB_DAYS = ["Sonndeg", "Méindeg", "Dënschdeg", "Mëttwoch", "Donneschdeg", "Freideg", "Samschdeg"];
const LB_MONTHS = ["Januar", "Februar", "Mäerz", "Abrëll", "Mee", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const NO_GATES = Object.freeze({ uid: null, admin: false, studio: false, cls: "", kart: false });

const $ = (id) => document.getElementById(id);
const t = (key) => (window.I18N ? window.I18N.t(key) : key);
const lang = () => window.I18N?.lang || "lb";

/* The GoTrue session in localStorage, read synchronously (like theme.js does) so
 * the first frame already greets a returning user by name. auth.js has the
 * truth a moment later and every render after that uses it. */
function storedSession() {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!/^sb-.+-auth-token$/.test(key)) continue;
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      const stored = parsed?.currentSession || parsed;
      if (stored?.access_token && typeof stored.user?.id === "string") return stored;
    }
  } catch { /* private mode: nothing stored */ }
  return null;
}

let clientReady = false;
const currentSession = () => (clientReady ? session() : storedSession());

/* ---------------- greeting, date, clock ---------------- */
function greetingKey(hour) {
  if (hour < 11) return "home.hi.morning";
  if (hour < 14) return "home.hi.noon";
  if (hour < 18) return "home.hi.afternoon";
  if (hour < 23) return "home.hi.evening";
  return "home.hi.night";
}

function displayName(current) {
  const user = current?.user;
  if (!user) return "";
  return String(user.user_metadata?.username || (user.email || "").split("@")[0] || "").slice(0, 24);
}

function renderGreeting() {
  const name = displayName(currentSession());
  const hello = t(greetingKey(new Date().getHours()));
  $("gtHello").textContent = name ? `${hello}, ${name}` : hello;
  const acct = $("gtAcct");
  if (name) {
    acct.removeAttribute("data-i18n");
    acct.textContent = name;
  } else {
    acct.setAttribute("data-i18n", "auth.signinShort");
    acct.textContent = t("auth.signinShort");
  }
}

function formatDate(date) {
  if (lang() === "lb") return `${LB_DAYS[date.getDay()]}, ${date.getDate()}. ${LB_MONTHS[date.getMonth()]}`;
  const locale = lang() === "de" ? "de-LU" : "en-GB";
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function startClock() {
  const pad = (n) => String(n).padStart(2, "0");
  let shownDay = "";
  const tick = () => {
    const now = new Date();
    $("gtClock").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const day = `${lang()}:${now.toDateString()}`;
    if (day !== shownDay) { shownDay = day; $("gtDate").textContent = formatDate(now); }
    setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  };
  tick();
  document.addEventListener("i18n:change", () => { shownDay = ""; $("gtDate").textContent = formatDate(new Date()); });
}

/* ---------------- search: opens the site's ⌘K quick-open ---------------- */
function wireSearch() {
  const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  $("gtKeys").textContent = isApple ? "⌘ K" : "Ctrl K";
  // quick-open.js only exposes its keyboard shortcut, so the button presses it.
  $("gtSearch").addEventListener("click", () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: !isApple, bubbles: true }));
  });
}

/* ---------------- usage (feeds the ⌘K ranking, same store as quick-open.js) ---------------- */
function recordUsage(app) {
  try {
    const now = Date.now();
    const parsed = JSON.parse(localStorage.getItem("appUsage") || "{}");
    const usage = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const decayed = (entry) => (entry && Number.isFinite(entry.score) && Number.isFinite(entry.ts)
      ? entry.score * Math.pow(0.5, (now - entry.ts) / USAGE_HALF_LIFE_MS) : 0);
    const next = { ...usage, [app]: { score: decayed(usage[app]) + 1, ts: now } };
    const kept = Object.entries(next).sort(([, a], [, b]) => decayed(b) - decayed(a)).slice(0, USAGE_KEEP);
    localStorage.setItem("appUsage", JSON.stringify(Object.fromEntries(kept)));
  } catch (error) {
    console.warn("[home] could not record app usage", error);
  }
}

/* ---------------- visibility ---------------- */

/* Last answer per account, so Ian's own entries are there on the first frame
 * instead of popping in after the is_admin round-trip. UI only, never trusted. */
function cachedGates(uid) {
  if (!uid) return NO_GATES;
  try {
    const cached = JSON.parse(localStorage.getItem(GATES_KEY) || "null");
    if (cached && cached.uid === uid) {
      return Object.freeze({ uid, admin: cached.admin === true, studio: cached.studio === true,
        cls: typeof cached.cls === "string" ? cached.cls : "", kart: cached.kart === true });
    }
  } catch { /* ignore a broken cache */ }
  return NO_GATES;
}

function saveGates(gates) {
  try {
    if (gates.uid) localStorage.setItem(GATES_KEY, JSON.stringify(gates));
    else localStorage.removeItem(GATES_KEY);
  } catch { /* private mode */ }
}

async function readGates(sb, current) {
  const uid = current?.user?.id;
  if (!sb || !uid) return NO_GATES;
  const [adminResult, profileResult] = await Promise.allSettled([
    sb.rpc("is_admin"),
    sb.from("profiles").select("class").eq("id", uid).maybeSingle(),
  ]);
  const adminOk = adminResult.status === "fulfilled" && !adminResult.value.error;
  const profileOk = profileResult.status === "fulfilled" && !profileResult.value.error;
  if (!adminOk) console.warn("[home] is_admin failed", adminResult.reason || adminResult.value?.error);
  if (!profileOk) console.warn("[home] profile class failed", profileResult.reason || profileResult.value?.error);
  return Object.freeze({
    uid,
    admin: adminOk && adminResult.value.data === true,
    studio: isStudioEmail(current.user.email),
    cls: profileOk ? String(profileResult.value.data?.class || "").trim().toUpperCase() : "",
    kart: isKartAccount(current),
  });
}

function allowed(gate, gates) {
  if (gate === "class") return gates.cls === TESTER_CLASS;
  if (gate === "studio") return gates.studio;
  if (gate === "ian") return gates.admin;
  if (gate === "kart") return gates.admin || gates.kart;
  return true;
}

function applyGates(gates) {
  document.querySelectorAll("[data-gate]").forEach((node) => { node.hidden = !allowed(node.dataset.gate, gates); });
  // Ian gets the all-sessions view, a karting account its own sessions.
  $("gtKart").href = gates.admin ? "karts.html" : "kart-account.html";
  document.querySelectorAll("#gtIndex [data-col]").forEach((col) => {
    col.hidden = ![...col.querySelectorAll("a")].some((link) => !link.hidden);
  });
}

/* ---------------- arcade: game of the week ---------------- */
let weekly = null;

function gameName(id) {
  // The label is "<emoji> <name>"; the homepage shows the name only.
  return weeklyGameLabel(id).replace(/^[^\p{L}\p{N}]+/u, "") || id;
}

function renderWeek() {
  if (!weekly) return;
  const url = `pixelbreak.html?g=${encodeURIComponent(weekly.gameId)}`;
  const img = $("gtWeekImg");
  img.onerror = () => { img.onerror = null; img.removeAttribute("src"); };
  img.src = `pb/thumbs/${weekly.gameId}.webp`;
  $("gtWeekShot").href = url;
  $("gtWeekPlay").href = url;
  $("gtWeekName").textContent = gameName(weekly.gameId);
  $("gtWeekKick").setAttribute("data-i18n", "home.weekKick");
  $("gtWeekKick").textContent = t("home.weekKick");
  $("gtWeekMeta").removeAttribute("data-i18n");
  $("gtWeekMeta").textContent = countdownText(weekly.endsAt);
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms))]);
}

async function loadWeek(sbPromise) {
  try {
    const sb = await sbPromise;
    if (!sb) throw new Error("no Supabase client");
    // Signed-out read on purpose: the homepage needs the game, not the board.
    const result = await withTimeout(loadWeekly(sb, null), WEEKLY_TIMEOUT_MS);
    if (!result || !GAME_ID.test(result.gameId)) throw new Error(`unusable weekly game ${JSON.stringify(result?.gameId)}`);
    weekly = result;
    renderWeek();
  } catch (error) {
    // The cell already shows the train simulator as "My pick".
    console.warn("[home] game of the week unavailable, keeping the fallback", error);
  } finally {
    $("gtWeek").classList.remove("loading");
  }
}

function renderAllGames() {
  const count = Number($("gtAll").dataset.count);
  $("gtAllText").textContent = t("home.allGames").replace("{n}", String(count));
}

/* ---------------- boot ---------------- */
let refreshRun = 0;

async function refresh(sbPromise) {
  const run = ++refreshRun;
  const sb = await sbPromise;
  const current = session();
  renderGreeting();
  if (!current) { applyGates(NO_GATES); saveGates(NO_GATES); return; }
  const gates = await readGates(sb, current);
  if (run !== refreshRun) return;
  applyGates(gates);
  saveGates(gates);
}

function boot() {
  applyGates(cachedGates(storedSession()?.user?.id));
  renderGreeting();
  renderAllGames();
  startClock();
  wireSearch();

  $("gtAcct").addEventListener("click", openAuthModal);
  $("gtFree").addEventListener("click", openAuthModal);
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[data-app]");
    if (link) recordUsage(link.dataset.app);
  });
  document.addEventListener("i18n:change", () => { renderGreeting(); renderAllGames(); renderWeek(); });
  setInterval(() => { renderGreeting(); renderWeek(); }, MINUTE_MS);

  const sbPromise = client().catch((error) => {
    console.warn("[home] Supabase client unavailable", error);
    return null;
  }).finally(() => { clientReady = true; });
  onAuth(() => { void refresh(sbPromise); });
  void refresh(sbPromise);
  void loadWeek(sbPromise);
}

boot();
