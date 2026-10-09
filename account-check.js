/* One-time account check + account merge card. Loaded lazily by auth.js once a
 * session exists (and by profile.html's merge button).
 *
 *   startAccountCheck(sb, getSession)   shows the card once per account
 *                                       (profiles.account_checked_at is null)
 *   openAccountCheck({ startWithMerge }) opens the card on demand
 *
 * Views of the one card: main -> edit (username + class), or
 * search -> prove -> pick -> done (merge a second account into this one).
 * Escape / the close button mean "later": the card closes without stamping. */
import * as auth from "./auth.js?v=27";
import { avatarHtml, searchPeople } from "./people-search.js?v=1";

const STYLE_ID = "account-check-style";
const OVERLAY_ID = "account-check";
const BLOCKING_MODALS = "#class-gate, .site-notice, .auth-modal.open";
const FIRST_CHECK_DELAY_MS = 3000;
const RETRY_DELAY_MS = 4000;
const MAX_TRIES = 10;
const SAVED_CLOSE_DELAY_MS = 900;
const MERGED_RELOAD_DELAY_MS = 1500;
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 6;
const LANGS = ["lb", "de", "en"];
const USERNAME_SHAPE = /^[A-Za-z0-9_]{3,20}$/;
const PG_FORBIDDEN = "42501";
const PG_INVALID = "22023";
const FOCUSABLE = "button:not([disabled]), input:not([disabled]), a[href]";

// Same specific-class rule as class-gate.js / profile.html (kept local: class-gate
// is a side-effect script and doesn't export it).
const normClass = (raw) => String(raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const YEAR_ONLY = /^\d{1,2}(E|È|EME|ÈME|IEME|IÈME)?$/;
const CLASS_SHAPE = /^\d{1,2}[A-Z]{1,4}\d{0,2}$/;
const validClass = (raw) => {
  const value = normClass(raw);
  return CLASS_SHAPE.test(value) && !YEAR_ONLY.test(value);
};

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const skipKey = (uid) => `classGateSkip:${uid}`;
const laterKey = (uid) => `accountCheckLater:${uid}`;

function lang() {
  if (LANGS.includes(window.I18N?.lang)) return window.I18N.lang;
  try {
    const saved = localStorage.getItem("site_lang");
    if (LANGS.includes(saved)) return saved;
  } catch (error) {
    console.warn("[account-check] site language", error);
  }
  return "lb";
}

/** Text from the shared i18n dict; Luxembourgish when a language is missing. */
function tr(key, params = {}) {
  const entry = window.I18N_DICT?.[key];
  const text = entry?.[lang()] ?? entry?.lb ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name) => params[name] ?? whole);
}

function readFlag(storage, key) {
  try {
    return Boolean(storage.getItem(key));
  } catch {
    return false;
  }
}

function writeFlag(storage, key) {
  try {
    storage.setItem(key, "1");
  } catch (error) {
    console.warn("[account-check] could not remember the choice", error);
  }
}

/* ---------- data ---------- */
async function loadProfile(sb, uid) {
  const { data, error } = await sb.from("profiles")
    .select("username, class, account_checked_at").eq("id", uid).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return Object.freeze({
    username: data.username || auth.username() || "",
    class: data.class ? String(data.class).trim() : "",
    checkedAt: data.account_checked_at || null,
  });
}

async function markChecked(sb) {
  const { error } = await sb.rpc("mark_account_checked");
  if (error) throw error;
}

/** Resolves to the stored name, or null when it is invalid or taken. */
async function saveUsername(sb, name) {
  const { data, error } = await sb.rpc("set_username", { p_name: name });
  if (error) throw error;
  return data || null;
}

async function saveClass(sb, value) {
  const { error } = await sb.rpc("set_class", { p_class: value });
  if (error) throw error;
}

/** Keeps the session's metadata (the account button label) on the new name. */
async function syncAuthUsername(sb, name) {
  try {
    const { error } = await sb.auth.updateUser({ data: { username: name } });
    if (error) throw error;
  } catch (error) {
    console.warn("[account-check] could not sync the account button", error);
  }
}

/* ---------- styles ---------- */
function injectCss() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .acct-ov{position:fixed;inset:0;z-index:100001;display:flex;align-items:center;justify-content:center;padding:16px;background:color-mix(in srgb,#000 56%,transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font-family:var(--font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif)}
    .acct-card{position:relative;box-sizing:border-box;width:min(440px,100%);max-height:calc(100dvh - 32px);overflow-x:hidden;overflow-y:auto;padding:22px;border-radius:18px;border:1px solid var(--border,#2a2a4a);background:var(--glass-solid,var(--card-opaque,var(--card,#141426)));color:var(--text,#e8e8f0);box-shadow:0 20px 60px rgba(0,0,0,.35);overflow-wrap:anywhere}
    .acct-card *{box-sizing:border-box}
    .acct-x{position:absolute;top:8px;right:8px;width:44px;height:44px;border:0;border-radius:12px;background:none;color:var(--muted,#9a9ab8);font-size:26px;line-height:1;cursor:pointer}
    .acct-ico{font-size:34px;line-height:1;margin-bottom:10px}
    .acct-title{margin:0 40px 6px 0;font-size:18px;font-weight:800;line-height:1.3}
    .acct-sub{margin:0 0 14px;color:var(--muted,#9a9ab8);font-size:13.5px;line-height:1.45}
    .acct-facts{display:grid;gap:8px;margin:0 0 16px}
    .acct-facts>div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-radius:12px;background:var(--card2,rgba(127,127,127,.12))}
    .acct-facts dt{margin:0;color:var(--muted,#9a9ab8);font-size:13px}
    .acct-facts dd{margin:0;font-size:15px;font-weight:750;text-align:right}
    .acct-tag{display:inline-block;padding:2px 10px;border-radius:999px;background:rgba(92,200,255,.15);color:#5cc8ff;box-shadow:inset 0 0 0 1px rgba(92,200,255,.4);font-size:13px;font-weight:800}
    html[data-theme="light"] .acct-tag{color:#075985;background:rgba(14,116,144,.12);box-shadow:inset 0 0 0 1px rgba(14,116,144,.4)}
    .acct-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
    .acct-btn{flex:1 1 140px;min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--border,rgba(255,255,255,.14));background:transparent;color:inherit;font:inherit;font-size:15px;font-weight:750;cursor:pointer}
    .acct-btn--primary{border-color:transparent;background:var(--accent,#4ea6ff);color:var(--accent-foreground,#04121f)}
    .acct-btn--small{flex:none;min-width:0;padding:0 12px;font-size:14px}
    .acct-btn:disabled,.acct-x:disabled{opacity:.5;cursor:default}
    .acct-link{display:block;width:100%;min-height:44px;margin-top:8px;padding:4px;border:0;background:none;color:var(--muted,#8a8ab0);font:inherit;font-size:13px;text-decoration:underline;cursor:pointer}
    .acct-label{display:block;margin:0 0 6px;color:var(--muted,#9a9ab8);font-size:13px}
    .acct-input{width:100%;min-height:46px;margin-bottom:12px;padding:10px 14px;border-radius:12px;border:1px solid var(--border,#33335a);background:var(--card2,#0e0e1c);color:var(--text,#fff);font:inherit;font-size:16px;outline:none}
    .acct-input:focus-visible{border-color:var(--accent,#4ea6ff)}
    .acct-hint{margin:-6px 0 12px;color:var(--muted,#8888aa);font-size:12px}
    .acct-hits{display:grid;gap:6px;margin:0 0 8px;padding:0;list-style:none}
    .acct-hit{display:flex;align-items:center;gap:10px;min-height:48px;padding:4px 4px 4px 10px;border-radius:12px;background:var(--card2,rgba(127,127,127,.12))}
    .acct-av{display:inline-flex;flex:none;width:28px;height:28px;border-radius:50%;overflow:hidden;align-items:center;justify-content:center;font-size:18px}
    .acct-av img{width:100%;height:100%;object-fit:cover}
    .acct-hit__name{flex:1 1 auto;min-width:0;font-weight:700}
    .acct-empty{padding:8px 4px;color:var(--muted,#8888aa);font-size:13px}
    .acct-opts{display:grid;gap:8px;margin:0 0 12px;padding:0;border:0}
    .acct-opt{display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 14px;border-radius:12px;border:2px solid var(--border,#33335a);cursor:pointer}
    .acct-opt.is-on{border-color:var(--accent,#4ea6ff);background:color-mix(in srgb,var(--accent,#4ea6ff) 12%,transparent)}
    .acct-opt input{flex:none;width:20px;height:20px;margin:0;accent-color:var(--accent,#4ea6ff)}
    .acct-opt b{display:block;font-size:16px}
    .acct-opt small{color:var(--muted,#9a9ab8);font-size:12.5px}
    .acct-warn{margin:0 0 12px;font-size:13.5px;font-weight:750;color:color-mix(in srgb,#ff5a5a 55%,var(--text,#ff7b86))}
    .acct-msg{min-height:18px;margin-top:10px;font-size:13px;color:var(--muted,#9a9ab8)}
    .acct-msg.is-err{color:color-mix(in srgb,#ff5a5a 55%,var(--text,#ff7b86))}
    .acct-msg.is-ok{color:var(--accent-text,var(--accent,#4ea6ff));font-weight:750}
    .acct-done{padding:10px 0;text-align:center}
    .acct-done .acct-title{margin:0}
    .acct-card :focus-visible{outline:3px solid var(--accent2,#74b9ff);outline-offset:2px}
    @media(prefers-reduced-motion:no-preference){.acct-card{animation:acct-in .18s ease-out}@keyframes acct-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}
  `;
  document.head.appendChild(style);
}

/* ---------- view html ---------- */
const closeButton = () =>
  `<button type="button" class="acct-x" data-act="later" aria-label="${esc(tr("acct.close"))}">&times;</button>`;
const backLink = (act) =>
  `<button type="button" class="acct-link" data-act="${act}">${esc(tr("acct.back"))}</button>`;

function msgHtml(notice) {
  const text = notice?.text || "";
  const kind = notice?.isError ? " is-err" : "";
  return `<div class="acct-msg${kind}" id="acctMsg" role="status" aria-live="polite">${esc(text)}</div>`;
}

function viewMain(ctx, notice) {
  const { username, class: cls } = ctx.profile;
  const classHtml = cls ? `<span class="acct-tag">${esc(cls)}</span>` : "—";
  return `${closeButton()}
    <div class="acct-ico" aria-hidden="true">🪪</div>
    <h2 class="acct-title" id="acctTitle">${esc(tr("acct.title"))}</h2>
    <p class="acct-sub">${esc(tr("acct.sub"))}</p>
    <dl class="acct-facts">
      <div><dt>${esc(tr("acct.username"))}</dt><dd>${esc(username || "—")}</dd></div>
      <div><dt>${esc(tr("acct.class"))}</dt><dd>${classHtml}</dd></div>
    </dl>
    <div class="acct-actions">
      <button type="button" class="acct-btn acct-btn--primary" data-act="yes" data-autofocus>${esc(tr("acct.yes"))}</button>
      <button type="button" class="acct-btn" data-act="edit">${esc(tr("acct.change"))}</button>
    </div>
    <button type="button" class="acct-link" data-act="merge">${esc(tr("acct.mergeLink"))}</button>
    ${msgHtml(notice)}`;
}

function viewEdit(ctx, notice) {
  const { username, class: cls } = ctx.profile;
  return `${closeButton()}
    <h2 class="acct-title" id="acctTitle">${esc(tr("acct.change"))}</h2>
    <form data-form="save" novalidate>
      <label class="acct-label" for="acctName">${esc(tr("acct.username"))}</label>
      <input class="acct-input" id="acctName" name="username" type="text" maxlength="20" value="${esc(username)}"
        autocomplete="off" autocapitalize="none" spellcheck="false" data-autofocus>
      <label class="acct-label" for="acctClass">${esc(tr("acct.class"))}</label>
      <input class="acct-input" id="acctClass" name="class" type="text" maxlength="12" value="${esc(cls)}"
        placeholder="${esc(tr("class.ph"))}" autocomplete="off" autocapitalize="characters" spellcheck="false">
      <div class="acct-actions">
        <button type="submit" class="acct-btn acct-btn--primary">${esc(tr("acct.save"))}</button>
        <button type="button" class="acct-btn" data-act="back">${esc(tr("acct.back"))}</button>
      </div>
    </form>
    ${msgHtml(notice)}`;
}

function viewSearch(ctx, notice) {
  return `${closeButton()}
    <div class="acct-ico" aria-hidden="true">🔗</div>
    <h2 class="acct-title" id="acctTitle">${esc(tr("acct.mergeTitle"))}</h2>
    <p class="acct-sub">${esc(tr("acct.mergeIntro"))}</p>
    <form data-form="search" novalidate>
      <label class="acct-label" for="acctSearch">${esc(tr("acct.mergeSearch"))}</label>
      <input class="acct-input" id="acctSearch" name="q" type="text" maxlength="24" autocomplete="off"
        autocapitalize="none" spellcheck="false" data-autofocus>
    </form>
    <ul class="acct-hits" id="acctHits"></ul>
    ${backLink("back")}
    ${msgHtml(notice)}`;
}

function viewProve(ctx, notice) {
  return `${closeButton()}
    <div class="acct-ico" aria-hidden="true">🔑</div>
    <h2 class="acct-title" id="acctTitle">${esc(tr("acct.proveTitle", { name: ctx.picked.username }))}</h2>
    <form data-form="prove" novalidate>
      <label class="acct-label" for="acctSecret">${esc(tr("acct.proveLabel"))}</label>
      <input class="acct-input" id="acctSecret" name="secret" type="password" autocomplete="off" data-autofocus>
      <div class="acct-actions">
        <button type="submit" class="acct-btn acct-btn--primary">${esc(tr("acct.proveGo"))}</button>
        <button type="button" class="acct-btn" data-act="toSearch">${esc(tr("acct.back"))}</button>
      </div>
    </form>
    ${msgHtml(notice)}`;
}

function optionHtml(value, name, caption, isOn) {
  return `<label class="acct-opt${isOn ? " is-on" : ""}">
      <input type="radio" name="keep" value="${value}"${isOn ? " checked" : ""}>
      <span><b>${esc(name)}</b><small>${esc(caption)}</small></span>
    </label>`;
}

function viewPick(ctx, notice) {
  return `${closeButton()}
    <div class="acct-ico" aria-hidden="true">🔗</div>
    <h2 class="acct-title" id="acctTitle">${esc(tr("acct.pickTitle"))}</h2>
    <div class="acct-opts" role="radiogroup" aria-labelledby="acctTitle">
      ${optionHtml("mine", ctx.profile.username, tr("acct.keepMine"), true)}
      ${optionHtml("other", ctx.picked.username, tr("acct.keepOther"), false)}
    </div>
    <p class="acct-warn">⚠ ${esc(tr("acct.warn"))}</p>
    <div class="acct-actions">
      <button type="button" class="acct-btn acct-btn--primary" data-act="confirm" data-autofocus>${esc(tr("acct.mergeGo"))}</button>
      <button type="button" class="acct-btn" data-act="toProve">${esc(tr("acct.back"))}</button>
    </div>
    ${msgHtml(notice)}`;
}

function viewDone() {
  return `<div class="acct-done" role="status">
      <div class="acct-ico" aria-hidden="true">✅</div>
      <h2 class="acct-title" id="acctTitle">${esc(tr("acct.done"))}</h2>
    </div>`;
}

const VIEWS = Object.freeze({
  main: viewMain,
  edit: viewEdit,
  search: viewSearch,
  prove: viewProve,
  pick: viewPick,
  done: viewDone,
});

/* ---------- card controller ---------- */
let openCtx = null;

function setMsg(ctx, text, kind = "error") {
  const element = ctx.card.querySelector("#acctMsg");
  if (!element) return;
  element.textContent = text;
  element.classList.toggle("is-err", kind === "error");
  element.classList.toggle("is-ok", kind === "ok");
}

function focusFirst(ctx) {
  const target = ctx.card.querySelector("[data-autofocus]") || ctx.card.querySelector(FOCUSABLE);
  target?.focus({ preventScroll: true });
}

function show(ctx, name, notice = null) {
  ctx.view = name;
  ctx.busy = false;
  ctx.card.innerHTML = VIEWS[name](ctx, notice);
  if (name === "search") wireSearch(ctx);
  if (name === "pick") wirePick(ctx);
  focusFirst(ctx);
}

function setBusy(ctx, isBusy) {
  ctx.busy = isBusy;
  if (isBusy) ctx.busyFocus = document.activeElement;
  ctx.card.querySelectorAll("button, input").forEach((element) => { element.disabled = isBusy; });
  if (!isBusy && ctx.busyFocus?.isConnected) ctx.busyFocus.focus({ preventScroll: true });
}

/** Runs one async step with the card locked; `onError` decides what the user sees. */
async function guarded(ctx, step, onError) {
  setBusy(ctx, true);
  let finished = false;
  try {
    finished = (await step()) === true;
  } catch (error) {
    onError(error);
  } finally {
    if (!finished) setBusy(ctx, false);
  }
}

const failSave = (ctx) => (error) => {
  console.error("[account-check] save failed", error);
  setMsg(ctx, tr("acct.errSave"));
};

function closeCard(ctx, { later = false } = {}) {
  if (later && ctx.isAuto) writeFlag(sessionStorage, laterKey(ctx.uid));
  document.removeEventListener("keydown", ctx.onKey, true);
  ctx.overlay.remove();
  openCtx = null;
  if (ctx.returnFocus?.isConnected) ctx.returnFocus.focus({ preventScroll: true });
}

/* ---------- main + edit actions ---------- */
async function actYes(ctx) {
  await guarded(ctx, async () => {
    await markChecked(ctx.sb);
    closeCard(ctx);
    return true;
  }, failSave(ctx));
}

/** Returns the i18n key of the first problem, or null when the input can be saved. */
function editProblem(profile, name, rawClass) {
  if (!USERNAME_SHAPE.test(name)) return "acct.errNameShape";
  const wanted = normClass(rawClass);
  if (wanted === normClass(profile.class)) return null;
  if (!wanted) return "acct.errClass";
  return validClass(wanted) ? null : "acct.errClass";
}

async function saveEdits(ctx, name, rawClass) {
  if (name !== ctx.profile.username) {
    const saved = await saveUsername(ctx.sb, name);
    if (!saved) {
      setMsg(ctx, tr("acct.errName"));
      return false;
    }
    ctx.profile = { ...ctx.profile, username: saved };
    await syncAuthUsername(ctx.sb, saved);
  }
  const wanted = normClass(rawClass);
  if (wanted !== normClass(ctx.profile.class)) {
    await saveClass(ctx.sb, wanted);
    ctx.profile = { ...ctx.profile, class: wanted };
  }
  await markChecked(ctx.sb);
  return true;
}

async function actSave(ctx, form) {
  const name = form.elements.username.value.trim();
  const rawClass = form.elements.class.value;
  const problem = editProblem(ctx.profile, name, rawClass);
  if (problem) {
    setMsg(ctx, tr(problem));
    return;
  }
  await guarded(ctx, async () => {
    if (!(await saveEdits(ctx, name, rawClass))) return false;
    setMsg(ctx, tr("acct.saved"), "ok");
    await sleep(SAVED_CLOSE_DELAY_MS);
    closeCard(ctx);
    if (location.pathname.endsWith("/profile.html")) location.reload();
    return true;
  }, failSave(ctx));
}

/* ---------- merge: search ---------- */
function hitHtml(person, index) {
  return `<li class="acct-hit">
      <span class="acct-av">${avatarHtml(person.avatar)}</span>
      <span class="acct-hit__name">${esc(person.username)}</span>
      <button type="button" class="acct-btn acct-btn--small" data-act="pick" data-i="${index}">${esc(tr("acct.mergePick"))}</button>
    </li>`;
}

function paintHits(ctx, text) {
  const list = ctx.card.querySelector("#acctHits");
  if (!list) return;
  list.innerHTML = ctx.hits.length
    ? ctx.hits.map(hitHtml).join("")
    : (text ? `<li class="acct-empty">${esc(text)}</li>` : "");
}

async function runSearch(ctx, query, ticketNumber) {
  if (!query) {
    ctx.hits = [];
    paintHits(ctx, "");
    return;
  }
  try {
    const found = await searchPeople(ctx.sb, query, { exclude: new Set([ctx.uid]), limit: SEARCH_LIMIT });
    if (ticketNumber !== ctx.searchSeq || ctx.view !== "search") return;
    ctx.hits = found;
    paintHits(ctx, tr("acct.mergeNoHits"));
  } catch (error) {
    console.warn("[account-check] people search failed", error);
    if (ticketNumber !== ctx.searchSeq || ctx.view !== "search") return;
    ctx.hits = [];
    paintHits(ctx, "");
    setMsg(ctx, tr("acct.mergeSearchFail"));
  }
}

function wireSearch(ctx) {
  const input = ctx.card.querySelector("#acctSearch");
  let timer = null;
  ctx.hits = [];
  input.addEventListener("input", () => {
    clearTimeout(timer);
    ctx.searchSeq += 1;
    const ticketNumber = ctx.searchSeq;
    timer = setTimeout(() => void runSearch(ctx, input.value.trim(), ticketNumber), SEARCH_DEBOUNCE_MS);
  });
}

function actPick(ctx, index) {
  const person = ctx.hits[Number(index)];
  if (!person) return;
  ctx.picked = person;
  ctx.ticket = null;
  show(ctx, "prove");
}

/* ---------- merge: prove, pick, confirm ---------- */
function proofMessage(error) {
  if (error?.code === "wrong_credentials") return tr("acct.errWrong");
  if (error?.code === "cannot_merge") return tr("acct.errCannot");
  return tr("acct.errLater");
}

async function actProve(ctx, form) {
  const secret = form.elements.secret.value;
  if (!secret) {
    setMsg(ctx, tr("acct.errWrong"));
    return;
  }
  await guarded(ctx, async () => {
    ctx.ticket = await auth.proveOtherAccount(ctx.picked.username, secret);
    show(ctx, "pick");
    return true;
  }, (error) => {
    if (error?.code !== "wrong_credentials") console.error("[account-check] proof failed", error);
    setMsg(ctx, proofMessage(error));
  });
}

function wirePick(ctx) {
  ctx.card.querySelectorAll('input[name="keep"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      ctx.card.querySelectorAll(".acct-opt").forEach((label) => {
        label.classList.toggle("is-on", label.contains(radio) && radio.checked);
      });
    });
  });
}

function mergeFailure(ctx, error) {
  console.error("[account-check] merge failed", error);
  if (error?.code === PG_FORBIDDEN) {
    show(ctx, "search", { text: tr("acct.errCannot"), isError: true });
  } else if (error?.code === PG_INVALID) {
    ctx.ticket = null;
    show(ctx, "prove", { text: tr("acct.errExpired"), isError: true });
  } else {
    setMsg(ctx, tr("acct.errLater"));
  }
}

async function finishMerge(ctx, keptName) {
  await syncAuthUsername(ctx.sb, keptName);
  try {
    await markChecked(ctx.sb);
  } catch (error) {
    console.warn("[account-check] could not stamp the check after the merge", error);
  }
}

async function actConfirm(ctx) {
  const choice = ctx.card.querySelector('input[name="keep"]:checked')?.value === "other" ? "other" : "mine";
  await guarded(ctx, async () => {
    const { data, error } = await ctx.sb.rpc("merge_accounts", {
      p_ticket: ctx.ticket,
      p_username_from: choice,
    });
    if (error) throw error;
    const fallbackName = choice === "other" ? ctx.picked.username : ctx.profile.username;
    const keptName = data?.username || fallbackName;
    ctx.profile = { ...ctx.profile, username: keptName };
    show(ctx, "done");
    await Promise.all([finishMerge(ctx, keptName), sleep(MERGED_RELOAD_DELAY_MS)]);
    location.reload();
    return true;
  }, (error) => mergeFailure(ctx, error));
}

/* ---------- event wiring ---------- */
const ACTIONS = Object.freeze({
  later: (ctx) => { if (!ctx.busy && ctx.view !== "done") closeCard(ctx, { later: true }); },
  yes: actYes,
  edit: (ctx) => show(ctx, "edit"),
  back: (ctx) => show(ctx, "main"),
  merge: (ctx) => show(ctx, "search"),
  toSearch: (ctx) => show(ctx, "search"),
  toProve: (ctx) => show(ctx, "prove"),
  pick: (ctx, element) => actPick(ctx, element.dataset.i),
  confirm: actConfirm,
});

const FORMS = Object.freeze({
  save: actSave,
  prove: actProve,
  search: (ctx, form) => {
    ctx.searchSeq += 1;
    return runSearch(ctx, form.elements.q.value.trim(), ctx.searchSeq);
  },
});

function onCardClick(ctx, event) {
  const element = event.target.closest("[data-act]");
  if (!element || ctx.busy) return;
  void ACTIONS[element.dataset.act]?.(ctx, element);
}

function onCardSubmit(ctx, event) {
  event.preventDefault();
  if (ctx.busy) return;
  void FORMS[event.target.dataset.form]?.(ctx, event.target);
}

function trapTab(ctx, event) {
  const items = [...ctx.card.querySelectorAll(FOCUSABLE)];
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !ctx.card.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !ctx.card.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function onKeydown(ctx, event) {
  if (event.key === "Escape") {
    event.preventDefault();
    ACTIONS.later(ctx);
  } else if (event.key === "Tab") {
    trapTab(ctx, event);
  }
}

function openCard({ sb, uid, profile, startWithMerge, isAuto }) {
  if (openCtx || !document.body) return;
  injectCss();
  const overlay = document.createElement("div");
  overlay.className = "acct-ov";
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = '<div class="acct-card" role="dialog" aria-modal="true" aria-labelledby="acctTitle"></div>';
  const ctx = {
    sb, uid, profile, isAuto, overlay,
    card: overlay.firstElementChild,
    returnFocus: document.activeElement,
    view: "main", busy: false, busyFocus: null,
    picked: null, ticket: null, hits: [], searchSeq: 0,
  };
  ctx.onKey = (event) => onKeydown(ctx, event);
  ctx.card.addEventListener("click", (event) => onCardClick(ctx, event));
  ctx.card.addEventListener("submit", (event) => onCardSubmit(ctx, event));
  document.addEventListener("keydown", ctx.onKey, true);
  document.body.appendChild(overlay);
  openCtx = ctx;
  show(ctx, startWithMerge ? "search" : "main");
}

/* ---------- public api ---------- */
function isKart(current) {
  return current?.user?.user_metadata?.account_kind === "kart";
}

/** True when the profile still needs the check and nothing else should go first. */
function readyToShow(profile, uid) {
  if (!profile || profile.checkedAt) return false;
  if (profile.class) return true;
  return readFlag(localStorage, skipKey(uid));   // classless users answer the class gate first
}

async function attemptAutoShow(sb, getSession, uid) {
  for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
    if (getSession()?.user?.id !== uid) return;
    if (document.body && !openCtx && !document.querySelector(BLOCKING_MODALS)) {
      const profile = await loadProfile(sb, uid);
      if (profile?.checkedAt) return;
      if (readyToShow(profile, uid)) {
        openCard({ sb, uid, profile, startWithMerge: false, isAuto: true });
        return;
      }
    }
    await sleep(RETRY_DELAY_MS);
  }
}

let scheduledUid = null;

/** Called by auth.js whenever the session may have changed; schedules once per user per page. */
export async function startAccountCheck(sb, getSession) {
  const current = getSession();
  const uid = current?.user?.id || null;
  if (!uid || uid === scheduledUid || !sb?.rpc || window.top !== window || isKart(current)) return;
  scheduledUid = uid;
  if (readFlag(sessionStorage, laterKey(uid))) return;
  try {
    await sleep(FIRST_CHECK_DELAY_MS);
    await attemptAutoShow(sb, getSession, uid);
  } catch (error) {
    console.warn("[account-check] check failed", error);
  }
}

/** Opens the card on demand, even when the account was already checked. */
export async function openAccountCheck({ startWithMerge = false } = {}) {
  const current = auth.session();
  if (!current) {
    auth.openAuthModal();
    return;
  }
  if (isKart(current)) return;
  try {
    const sb = await auth.client();
    const uid = current.user.id;
    const profile = await loadProfile(sb, uid);
    if (!profile) throw new Error("profile not found");
    openCard({ sb, uid, profile, startWithMerge, isAuto: false });
  } catch (error) {
    console.error("[account-check] could not open", error);
  }
}
