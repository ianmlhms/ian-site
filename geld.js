/* Geld — Trade Republic tracker (owner only, konto@ian.lu).
 * Reads geld_* tables directly through RLS with the signed-in session; the
 * brix worker fills them via the `geld` edge function. UI text is Luxembourgish.
 * State is one immutable object replaced by update(); render() redraws from it. */
import * as auth from "./auth.js?v=47";

const OWNER = "konto@ian.lu";
const TZ = "Europe/Luxembourg";
const CURRENCY_SUFFIX = " €";
const PAGE_SIZE = 1000;
const ACCOUNT_COLUMNS = "uid,bank,label,iban_last4,name,currency,balance,balance_at,valid_until,last_sync_at,last_error";
const LIST_STEP = 60;
const REFRESH_MS = 5 * 60 * 1000;
const TOTAL_KEY = "_total";
/* "parents": paid for by Mum/Dad (school canteen) — neither Ian's spending nor income. */
const NON_SPENDING = new Set(["investment", "transfer", "parents"]);
/* Incoming money in these categories is income, not a refund. */
const NOT_REFUND_CATS = new Set(["income", "dividend", "other", "parents"]);
const TRADE_TYPES = ["buy", "sell", "savings_plan"];
const RULE_TYPES = "type.is.null,type.in.(card,card_refund,other,transfer_out)";
const CHART_RANGES = [["1M", 30], ["3M", 91], ["1J", 365], ["Alles", 0]];
const CHART = { w: 640, h: 220, padL: 8, padR: 8, padT: 14, padB: 22 };
const MONTHS = ["Januar", "Februar", "Mäerz", "Abrëll", "Mee", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONTHS_SHORT = ["Jan", "Feb", "Mäe", "Abr", "Mee", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const BANK_FUNCTION = "geld";
const BANKS = { bcee: "Spuerkeess", bdl: "BDL", tr: "Trade Republic" };
const EXPIRY_WARNING_DAYS = 14;
const DAY_MS = 86400000;
const TR_ACCOUNT = "Trade Republic";
const TRADE_LABEL = { buy: "Kaf", sell: "Verkaf", savings_plan: "Spuerplang" };

/* slug → [emoji, LB label]. Keep in sync with money.html and _shared/finance_cats.ts. */
const TAX = {
  food: ["🍔", "Iessen"], groceries: ["🛒", "Akaf"], transport: ["🚌", "Transport"],
  shopping: ["🛍️", "Shopping"], subscription: ["📱", "Abo"], leisure: ["🎮", "Fräizäit"],
  health: ["💊", "Gesondheet"], education: ["📚", "Schoul"], income: ["💼", "Rakomm"],
  investment: ["📈", "Investéieren"], dividend: ["💰", "Dividend/Zënsen"], fees: ["💳", "Gebüren"],
  cash: ["🏧", "Boergeld"], transfer: ["🔁", "Transfer"], parents: ["👪", "Elteren bezuelen"], other: ["⭐", "Aneres"],
};
const SPEND_CATS = ["food", "groceries", "transport", "shopping", "subscription", "leisure", "health", "education", "fees", "cash", "other"];
const PICK_CATS = Object.keys(TAX);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const catIcon = (c) => (TAX[c] || TAX.other)[0];
const catLabel = (c) => (TAX[c] || TAX.other)[1];

/* ---------- formatting & time ---------- */
const numFmt = new Intl.NumberFormat("de-LU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const euro = (n) => numFmt.format(Number(n) || 0) + CURRENCY_SUFFIX;
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + numFmt.format(Math.abs(Number(n) || 0)) + CURRENCY_SUFFIX;
const pct = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + numFmt.format(Math.abs(n)) + " %";
const round2 = (n) => Math.round(n * 100) / 100;
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const lbDay = (value) => dayFmt.format(new Date(value));
const lbMonth = (value) => lbDay(value).slice(0, 7);
const monthLabel = (m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const dayLabel = (d) => `${Number(d.slice(8))}. ${MONTHS_SHORT[Number(d.slice(5, 7)) - 1]}`;
const shiftMonth = (m, delta) => {
  const index = Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

function ago(iso) {
  if (!iso) return "nach ni";
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 1) return "grad elo";
  if (mins < 60) return `viru ${mins} Min.`;
  if (mins < 1440) return `viru ${Math.floor(mins / 60)} Std.`;
  return `viru ${Math.floor(mins / 1440)} Deeg`;
}

/* ---------- state ---------- */
let sb = null;
let state = {
  month: lbMonth(Date.now()), txMonth: [], positions: [], daily: [], trades: [], budgets: [], sync: null, accounts: [],
  bankBusy: "", loaded: false, filter: "all", shown: LIST_STEP, range: 365, picking: null, msg: "", msgErr: false,
};
const update = (patch) => { state = { ...state, ...patch }; render(); };

/* ---------- spending rules (same as the edge function's spendOf) ---------- */
function spendOf(row) {
  if (row.is_transfer) return null;
  const cat = row.cat || "other";
  if (NON_SPENDING.has(cat)) return null;
  if (row.kind === "out") return { cat, value: Number(row.amount) };
  /* Money back for a purchase ("Réckbezuelung"): any incoming row that carries a
   * spending category, or a card refund, lowers that category. */
  if (row.kind === "in" && (row.type === "card_refund" || !NOT_REFUND_CATS.has(cat))) return { cat, value: -Number(row.amount) };
  return null;
}
function spending(rows) {
  const byCat = {};
  let total = 0;
  for (const row of rows) {
    const s = spendOf(row);
    if (!s) continue;
    byCat[s.cat] = round2((byCat[s.cat] || 0) + s.value);
    total = round2(total + s.value);
  }
  return { total, byCat };
}
const budgetOf = (cat) => {
  const found = state.budgets.find((b) => b.cat === cat);
  return found ? Number(found.monthly_limit) : null;
};

/* ---------- data ---------- */
function cfgClient() { return auth.client(); }

async function selectAll(build, what) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}
async function one(query, what) {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function loadMonth(month) {
  /* Fetch a day either side, then keep exactly the Luxembourg month: the DB
   * stores UTC and the page must not guess the offset. */
  const from = new Date(Date.parse(`${month}-01T00:00:00Z`) - 86400000).toISOString();
  const to = new Date(Date.parse(`${shiftMonth(month, 1)}-01T00:00:00Z`) + 86400000).toISOString();
  const rows = await selectAll(
    () => sb.from("geld_tx").select("*").gte("at", from).lt("at", to).order("at", { ascending: false }).order("id"),
    "Buchungen",
  );
  return rows.filter((r) => lbMonth(r.at) === month);
}

async function loadAll() {
  const [txMonth, positions, daily, trades, budgets, sync, accounts] = await Promise.all([
    loadMonth(state.month),
    one(sb.from("geld_positions").select("*").order("value", { ascending: false }), "Positiounen"),
    selectAll(() => sb.from("geld_daily").select("*").order("day"), "Depot-Verlaf"),
    one(sb.from("geld_tx").select("*").in("type", TRADE_TYPES).order("at", { ascending: false }).limit(12), "Handel"),
    one(sb.from("geld_budgets").select("*"), "Budgeten"),
    one(sb.from("geld_sync").select("*").eq("id", 1).maybeSingle(), "Synchro"),
    one(sb.from("geld_accounts").select(ACCOUNT_COLUMNS).eq("active", true).order("label"), "Konten"),
  ]);
  update({ txMonth, positions, daily, trades, budgets, sync, accounts, loaded: true });
}

function fail(userMessage, error) {
  console.error("geld:", userMessage, error);
  update({ msg: userMessage, msgErr: true });
}

/* ---------- actions ---------- */
async function changeMonth(month) {
  try {
    const txMonth = await loadMonth(month);
    update({ month, txMonth, shown: LIST_STEP });
  } catch (error) { fail("D'Buchunge konnten net gelueden ginn.", error); }
}

const escLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function setCategory(tx, cat) {
  update({ picking: null });
  const key = (tx.merchant || "").trim().toLowerCase();
  try {
    await one(sb.from("geld_tx").update({
      cat, cat_locked: true, is_transfer: cat === "transfer", updated_at: new Date().toISOString(),
    }).eq("id", tx.id), "Kategorie");
    if (key && tx.kind === "out") {
      await one(sb.from("geld_rules").upsert({ merchant_key: key, cat }, { onConflict: "merchant_key" }), "Regel");
      await one(
        sb.from("geld_tx").update({ cat, updated_at: new Date().toISOString() })
          .ilike("merchant", escLike(key)).eq("cat_locked", false).neq("id", tx.id).or(RULE_TYPES),
        "Regel uwenden",
      );
    }
    update({ txMonth: await loadMonth(state.month), msg: "", msgErr: false });
  } catch (error) { fail("D'Kategorie konnt net gespäichert ginn.", error); }
}

async function saveBudgets(values) {
  try {
    const existing = new Set(state.budgets.map((b) => b.cat));
    const upserts = Object.entries(values).filter(([, v]) => v !== null).map(([cat, monthly_limit]) => ({ cat, monthly_limit }));
    const removes = Object.entries(values).filter(([cat, v]) => v === null && existing.has(cat)).map(([cat]) => cat);
    if (upserts.length) await one(sb.from("geld_budgets").upsert(upserts, { onConflict: "cat" }), "Budget");
    if (removes.length) await one(sb.from("geld_budgets").delete().in("cat", removes), "Budget läschen");
    update({ budgets: await one(sb.from("geld_budgets").select("*"), "Budgeten"), msg: "Budgeten gespäichert ✓", msgErr: false });
  } catch (error) { fail("D'Budgeten konnten net gespäichert ginn.", error); }
}

/* ---------- bank sync (Enable Banking via the geld edge function) ---------- */
/* functions.invoke hides a non-2xx body in error.context (the Response). */
async function callBank(body) {
  const { data, error } = await sb.functions.invoke(BANK_FUNCTION, { body });
  if (!error) return data;
  let detail = "";
  try { detail = (await error.context?.json?.())?.error || ""; } catch { /* no body */ }
  throw new Error(`${body.action}: ${detail || error.message}`);
}

const daysLeft = (iso) => (iso ? Math.ceil((Date.parse(iso) - Date.now()) / DAY_MS) : null);

/* Same rules as bankNotes in the edge function: what needs Ian's attention. */
function bankProblems(accounts) {
  const out = [];
  for (const a of accounts) {
    const left = daysLeft(a.valid_until);
    if (left !== null && left <= 0) out.push({ bank: a.bank, label: a.label, kind: "expired" });
    else if (left !== null && left <= EXPIRY_WARNING_DAYS) out.push({ bank: a.bank, label: a.label, kind: "expires", left });
    if (a.last_error) out.push({ bank: a.bank, label: a.label, kind: "error", error: a.last_error });
  }
  return out;
}

async function connectBank(bank) {
  if (!BANKS[bank] || state.bankBusy) return;
  update({ bankBusy: bank, msg: "", msgErr: false });
  try {
    const data = await callBank({ action: "bank_auth", bank });
    const target = new URL(String(data?.url || ""));
    if (target.protocol !== "https:" && target.origin !== window.location.origin) throw new Error("bank_auth: unexpected url");
    window.location.assign(target.toString());
  } catch (error) {
    update({ bankBusy: "" });
    fail("D'Bank konnt net verbonne ginn. Probéier et méi spéit nach eng Kéier.", error);
  }
}

async function refreshBanks() {
  if (state.bankBusy) return;
  update({ bankBusy: "sync", msg: "", msgErr: false });
  try {
    const result = await callBank({ action: "bank_sync" });
    const failed = (result?.accounts || []).filter((a) => a.error);
    await loadAll();
    update({
      bankBusy: "",
      msg: failed.length ? `Synchro mat Feeler bei: ${failed.map((a) => a.label).join(", ")}` : `Aktualiséiert ✓ (${result?.inserted ?? 0} nei Buchungen)`,
      msgErr: failed.length > 0,
    });
  } catch (error) {
    update({ bankBusy: "" });
    fail("D'Synchro huet net geklappt.", error);
  }
}

/* The bank sends Ian back as ?code&state (or ?error). Read it once and clean the URL. */
function takeBankCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const stateParam = params.get("state");
  const error = params.get("error");
  if (!(code && stateParam) && !error) return null;
  window.history.replaceState(null, "", window.location.pathname);
  if (error) return { error };
  return { code, state: stateParam };
}

async function finishBankConnect(callback) {
  if (callback.error) {
    state = { ...state, msg: callback.error === "access_denied" ? "Du hues d'Verbindung mat der Bank ofgebrach." : "D'Bank huet d'Verbindung refuséiert. Probéier et nach eng Kéier.", msgErr: true };
    return;
  }
  gate("Bank gëtt verbonnen…");
  try {
    const result = await callBank({ action: "bank_session", code: callback.code, state: callback.state });
    const names = (result?.accounts || []).map((a) => a.label).join(", ");
    state = { ...state, msg: `${names || "Bank"} verbonnen ✓ (${result?.inserted ?? 0} Buchungen geluecht)`, msgErr: false };
  } catch (error) {
    console.error("geld: bank_session failed", error);
    state = { ...state, msg: "D'Bank konnt net verbonne ginn. Probéier et nach eng Kéier.", msgErr: true };
  }
}

/* ---------- render: pieces ---------- */
function headerCards() {
  const { total } = spending(state.txMonth);
  const budget = budgetOf(TOTAL_KEY);
  const ratio = budget ? total / budget : 0;
  const positionsValue = state.positions.reduce((s, p) => s + (Number(p.value) || 0), 0);
  const cost = state.positions.reduce((s, p) => s + (Number(p.buy_cost) || 0), 0);
  const lastDaily = state.daily[state.daily.length - 1];
  const depot = state.positions.length ? positionsValue : Number(lastDaily?.depot_value) || 0;
  const gain = state.positions.length ? positionsValue - cost : 0;
  const gainPct = cost > 0 ? (gain / cost) * 100 : null;
  /* The Trade Republic bank feed is the same money as the pytr cash: use it
   * only while pytr has no cash figure, and never add both. */
  const trFeed = state.accounts.find((a) => a.bank === "tr" && a.balance !== null && a.balance !== undefined);
  const cash = lastDaily?.cash ?? (trFeed ? Number(trFeed.balance) : lastDaily?.cash);
  const bankTotal = state.accounts.filter((a) => a.bank !== "tr").reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const cashAll = state.accounts.length ? bankTotal + (Number(cash) || 0) : null;
  return `<div class="g-cards">
    <div class="g-metric"><span>Ausginn ${esc(monthLabel(state.month))}</span><b>${euro(total)}</b>
      ${budget ? `<div class="g-meter${ratio >= 1 ? " over" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(ratio * 100))}" aria-label="Budget"><i style="width:${Math.min(100, ratio * 100)}%"></i></div>
      <small>${Math.round(ratio * 100)} % vun ${euro(budget)}</small>` : `<small>Kee Budget gesat</small>`}</div>
    <div class="g-metric"><span>Depot</span><b>${euro(depot)}</b>
      ${state.positions.length ? `<small class="${gain >= 0 ? "g-pos" : "g-neg"}">${signed(gain)}${gainPct === null ? "" : ` (${pct(gainPct)})`} insgesamt</small>` : `<small>Nach keng Positiounen</small>`}</div>
    <div class="g-metric"><span>Cash</span><b>${cash === null || cash === undefined ? "—" : euro(cash)}</b><small>op Trade Republic</small></div>
    ${cashAll === null ? "" : `<div class="g-metric" id="cashAll"><span>Cash insgesamt</span><b>${euro(cashAll)}</b><small>Banken ${euro(bankTotal)} + Trade Republic ${euro(Number(cash) || 0)}</small></div>`}
  </div>`;
}

function accountRow(a) {
  const left = daysLeft(a.valid_until);
  const consent = left === null ? "" : left <= 0 ? `<span class="g-neg">Zougang ofgelaf</span>` : `Zougang nach ${left} ${left === 1 ? "Dag" : "Deeg"}`;
  return `<div class="g-row" data-acct="${esc(a.uid)}"><div class="main"><div class="t">${esc(a.label)}${a.iban_last4 ? ` <span class="g-iban">••${esc(a.iban_last4)}</span>` : ""}</div>
    <div class="s">Lescht Synchro: ${esc(ago(a.last_sync_at))}${consent ? ` · ${consent}` : ""}</div></div>
    <div class="amt mut">${a.balance === null || a.balance === undefined ? "—" : euro(a.balance)}</div></div>`;
}

function accountsSection() {
  const busy = state.bankBusy;
  const connect = Object.entries(BANKS).map(([id, name]) =>
    `<button type="button" class="g-ghost" data-connect="${id}" ${busy ? "disabled" : ""}>${esc(name)} verbannen</button>`).join("");
  return `<h2 class="g-h2">Konten</h2>
    <div class="g-card" id="accounts">${state.accounts.length ? state.accounts.map(accountRow).join("") : '<div class="g-hint">Nach keng Bank verbonnen.</div>'}
      <div class="g-actions">${connect}
        ${state.accounts.length ? `<button type="button" class="g-btn" id="syncBanks" ${busy ? "disabled" : ""}>${busy === "sync" ? "Lueden…" : "Aktualiséieren"}</button>` : ""}</div></div>`;
}

function bankBanners() {
  const names = { expired: "Zougang ofgelaf", expires: "Zougang leeft of", error: "Synchro-Feeler" };
  return bankProblems(state.accounts).map((p) => {
    const detail = p.kind === "expires" ? `${names.expires} an ${p.left} ${p.left === 1 ? "Dag" : "Deeg"}`
      : p.kind === "error" ? `${names.error}: ${esc(p.error)}` : names.expired;
    const action = p.kind === "error" ? "" : ` <button type="button" class="g-ghost" data-connect="${esc(p.bank)}">${esc(BANKS[p.bank] || p.label)} nei confirméieren</button>`;
    return `<div class="g-banner" role="alert">🏦 ${esc(p.label)}: ${detail}${action}</div>`;
  }).join("");
}

function categoryBars(byCat) {
  const entries = Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const withBudget = SPEND_CATS.filter((c) => budgetOf(c) && !(c in byCat));
  const max = Math.max(...entries.map(([, v]) => v), 1);
  const bars = [...entries, ...withBudget.map((c) => [c, 0])].map(([cat, value]) => {
    const limit = budgetOf(cat);
    const share = limit ? value / limit : value / max;
    const over = limit && value >= limit;
    return `<div class="g-catbar${over ? " over" : ""}"><div class="top">
      <span class="lab">${catIcon(cat)} ${esc(catLabel(cat))}</span>
      <span class="val">${euro(value)}${limit ? ` / ${euro(limit)}` : ""}</span></div>
      <div class="track"><div class="fill" style="width:${Math.min(100, share * 100)}%"></div></div></div>`;
  });
  return bars.length ? bars.join("") : `<div class="g-hint">Keng Ausginn an dësem Mount.</div>`;
}

const ACCT_PREFIX = "acct:";
function filteredTx() {
  const labels = new Set(state.accounts.map((a) => a.label));
  const isTR = (t) => t.account === TR_ACCOUNT;
  if (state.filter === "tr") return state.txMonth.filter(isTR);
  if (state.filter === "other") return state.txMonth.filter((t) => !isTR(t) && !labels.has(t.account));
  if (state.filter.startsWith(ACCT_PREFIX)) return state.txMonth.filter((t) => t.account === state.filter.slice(ACCT_PREFIX.length));
  return state.txMonth;
}

function txRow(t) {
  const cls = t.kind === "in" ? "in" : spendOf(t) ? "out" : "mut";
  const cat = t.is_transfer ? "transfer" : t.cat;
  const chip = cat
    ? `<button type="button" class="g-catchip" data-pick="${esc(t.id)}" aria-label="Kategorie änneren: ${esc(catLabel(cat))}">${catIcon(cat)} <span class="n">${esc(catLabel(cat))}</span>${t.cat_locked ? '<span class="g-lock" title="Vun Hand gesat">●</span>' : ""}</button>`
    : `<button type="button" class="g-catchip none" data-pick="${esc(t.id)}" aria-label="Kategorie wielen">＋ <span class="n">Kategorie</span></button>`;
  return `<div class="g-row"><div class="main"><div class="t">${esc(t.merchant || TRADE_LABEL[t.type] || "—")}</div>
    <div class="s">${esc(dayLabel(lbDay(t.at)))} · ${esc(t.account)}${t.kind === "in" && spendOf(t) ? " · ↩ Réckbezuelung" : ""}</div></div>
    <div class="amt ${cls}">${t.kind === "in" ? "+" : "−"}${numFmt.format(Number(t.amount))}${CURRENCY_SUFFIX}</div>${chip}</div>`;
}

function spendingSection() {
  const { byCat } = spending(state.txMonth);
  const rows = filteredTx();
  const isCurrent = state.month === lbMonth(Date.now());
  const accountChips = state.accounts.map((a) => [ACCT_PREFIX + a.label, a.label]);
  const chips = [["all", "Alles"], ["tr", "Trade Republic"], ...accountChips, ["other", "Aner Kontoen"]].map(([k, l]) =>
    `<button type="button" class="g-ghost${state.filter === k ? " on" : ""}" data-filter="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join("");
  return `<h2 class="g-h2">Ausginn</h2>
    <div class="g-card">
      <div class="g-monthbar"><button type="button" class="g-ghost" id="prevM" aria-label="Läschte Mount">‹</button>
        <b>${esc(monthLabel(state.month))}</b>
        <button type="button" class="g-ghost" id="nextM" aria-label="Nächste Mount" ${isCurrent ? "disabled" : ""}>›</button></div>
      <div style="margin-top:12px">${categoryBars(byCat)}</div>
    </div>
    <div class="g-chips" id="filters">${chips}</div>
    <div class="g-card" id="txList">${rows.length ? rows.slice(0, state.shown).map(txRow).join("") : '<div class="g-hint">Keng Buchungen.</div>'}
      ${rows.length > state.shown ? `<button type="button" class="g-ghost" id="more" style="margin-top:10px;width:100%">Méi weisen (${rows.length - state.shown})</button>` : ""}</div>`;
}

/* ---------- chart ---------- */
function chartSeries() {
  if (!state.range) return state.daily;
  const cutoff = lbDay(Date.now() - state.range * 86400000);
  return state.daily.filter((d) => d.day >= cutoff);
}

function chartSvg(series) {
  const { w, h, padL, padR, padT, padB } = CHART;
  const vals = series.flatMap((d) => [Number(d.depot_value), Number(d.invested)]).filter((v) => Number.isFinite(v) && v > 0);
  if (!series.length || !vals.length) return `<div class="g-hint">Nach keng Depot-Daten.</div>`;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || hi || 1;
  const x = (i) => padL + (series.length === 1 ? (w - padL - padR) / 2 : (i / (series.length - 1)) * (w - padL - padR));
  const y = (v) => padT + (1 - (v - (lo - span * 0.08)) / (span * 1.16)) * (h - padT - padB);
  const line = (key) => series.map((d, i) => (Number.isFinite(Number(d[key])) && d[key] !== null ? `${x(i).toFixed(1)},${y(Number(d[key])).toFixed(1)}` : null)).filter(Boolean).join(" ");
  const valPts = line("depot_value");
  const first = x(0).toFixed(1), last = x(series.length - 1).toFixed(1), base = (h - padB).toFixed(1);
  const single = series.length === 1;
  return `<svg class="g-chart" id="chart" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="chartT">
    <title id="chartT">Depotwäert iwwer d'Zäit, vu ${esc(dayLabel(series[0].day))} bis ${esc(dayLabel(series[series.length - 1].day))}</title>
    <line class="grid" x1="${padL}" x2="${w - padR}" y1="${y(hi).toFixed(1)}" y2="${y(hi).toFixed(1)}"/>
    <line class="grid" x1="${padL}" x2="${w - padR}" y1="${y(lo).toFixed(1)}" y2="${y(lo).toFixed(1)}"/>
    ${single ? "" : `<polygon class="area" points="${first},${base} ${valPts} ${last},${base}"/>`}
    ${single ? "" : `<polyline class="inv" points="${line("invested")}"/><polyline class="val" points="${valPts}"/>`}
    <circle class="dot" id="dot" cx="${x(series.length - 1).toFixed(1)}" cy="${y(Number(series[series.length - 1].depot_value) || lo).toFixed(1)}" r="4"/>
    <line class="cursor" id="cursor" x1="0" x2="0" y1="${padT}" y2="${h - padB}" visibility="hidden"/>
    <text x="${padL}" y="${h - 6}">${esc(dayLabel(series[0].day))}</text>
    <text x="${w - padR}" y="${h - 6}" text-anchor="end">${esc(dayLabel(series[series.length - 1].day))}</text>
    <text x="${padL}" y="${(y(hi) - 4).toFixed(1)}">${esc(euro(hi))}</text>
    <text x="${padL}" y="${(y(lo) - 4).toFixed(1)}">${esc(euro(lo))}</text>
  </svg>`;
}

function wireChart(series) {
  const svg = $("chart");
  if (!svg || series.length < 2) return;
  const { w, padL, padR } = CHART;
  const out = $("readout");
  const show = (event) => {
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * w;
    const i = Math.min(series.length - 1, Math.max(0, Math.round(((px - padL) / (w - padL - padR)) * (series.length - 1))));
    const d = series[i];
    const cx = padL + (i / (series.length - 1)) * (w - padL - padR);
    const cur = $("cursor");
    cur.setAttribute("x1", cx); cur.setAttribute("x2", cx); cur.setAttribute("visibility", "visible");
    out.textContent = `${dayLabel(d.day)}: ${euro(d.depot_value)}${Number(d.invested) ? ` · investéiert ${euro(d.invested)}` : ""}`;
  };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", () => { $("cursor")?.setAttribute("visibility", "hidden"); out.textContent = ""; });
}

function portfolioSection() {
  const rows = state.positions.map((p) => {
    const gain = (Number(p.value) || 0) - (Number(p.buy_cost) || 0);
    const gp = Number(p.buy_cost) > 0 ? (gain / Number(p.buy_cost)) * 100 : null;
    return `<tr><td>${esc(p.name || p.isin)}</td><td>${euro(p.value)}</td><td class="${gain >= 0 ? "g-pos" : "g-neg"}">${signed(gain)}${gp === null ? "" : `<br><small>${pct(gp)}</small>`}</td></tr>`;
  }).join("");
  const trades = state.trades.map((t) => `<div class="g-row"><div class="main"><div class="t">${esc(t.merchant || "—")}</div>
    <div class="s">${esc(dayLabel(lbDay(t.at)))} · ${esc(TRADE_LABEL[t.type] || t.type)}${t.shares ? ` · ${numFmt.format(Number(t.shares))} Stécker` : ""}</div></div>
    <div class="amt mut">${euro(t.amount)}</div></div>`).join("");
  const ranges = CHART_RANGES.map(([l, d]) => `<button type="button" data-range="${d}" class="${state.range === d ? "on" : ""}" aria-pressed="${state.range === d}">${l}</button>`).join("");
  return `<h2 class="g-h2">Portfolio</h2>
    <div class="g-card"><div class="g-seg" id="ranges" role="group" aria-label="Zäitraum" style="margin-bottom:10px">${ranges}</div>
      <div class="g-readout" id="readout" role="status" aria-live="polite"></div>
      <div class="g-chartwrap">${chartSvg(chartSeries())}</div>
      <div class="g-legend"><span><i></i>Wäert</span><span><i class="d"></i>Investéiert</span></div></div>
    <div class="g-card">${rows ? `<table class="g-table"><thead><tr><th>Position</th><th>Wäert</th><th>Gewënn</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="g-hint">Nach keng Positiounen.</div>'}</div>
    <div class="g-card"><div class="g-hint" style="margin-bottom:4px">Läscht Keef, Verkeef a Spuerpläng</div>${trades || '<div class="g-hint">Nach näischt.</div>'}</div>`;
}

function budgetSection() {
  const field = (cat, label) => `<label for="b_${cat}">${label}</label><input id="b_${cat}" data-bcat="${cat}" inputmode="decimal" placeholder="—" value="${budgetOf(cat) ?? ""}">`;
  return `<details class="g-details"><summary>Budgeten</summary><div class="g-card">
    <div class="g-hint">Monatslimit pro Kategorie (leet = keen). Bei 80 % an 100 % kënnt eng Message an #geld.</div>
    <div class="g-bform">${field(TOTAL_KEY, "Ganzen Mount")}${SPEND_CATS.map((c) => field(c, `${catIcon(c)} ${esc(catLabel(c))}`)).join("")}</div>
    <div style="margin-top:12px;display:flex;gap:10px;align-items:center"><button type="button" class="g-btn" id="saveB">Späicheren</button><span class="g-msg" id="bMsg" role="status"></span></div>
  </div></details>`;
}

function footer() {
  const s = state.sync;
  const err = s?.last_error ? `<br>Lesch Feeler: ${esc(s.last_error)}` : "";
  return `<div class="g-foot">Lescht Synchro: ${s?.last_ok_at ? `${esc(ago(s.last_ok_at))} (${esc(new Date(s.last_ok_at).toLocaleString("de-LU"))})` : "nach ni"}
    ${s?.events_total != null ? `· ${s.events_total} Buchungen` : ""}${err}</div>`;
}

function pickerDialog() {
  const tx = state.picking && state.txMonth.find((t) => t.id === state.picking);
  if (!tx) return "";
  const current = tx.is_transfer ? "transfer" : tx.cat;
  return `<dialog class="g-pick" id="pick" aria-label="Kategorie wielen"><h3>Kategorie wielen</h3>
    <div class="who">${esc(tx.merchant || "—")} · ${euro(tx.amount)}</div>
    <div class="g-pickgrid">${PICK_CATS.map((c) => `<button type="button" data-cat="${c}" class="${c === current ? "on" : ""}">${catIcon(c)} ${esc(catLabel(c))}</button>`).join("")}</div>
    <div class="g-hint" style="margin-top:10px">Gëllt och fir déi nächst Buchungen vun deem Händler.</div>
    <button type="button" class="g-ghost" id="pickCancel">Ofbriechen</button></dialog>`;
}

/* ---------- render ---------- */
function render() {
  const wrap = $("wrap");
  if (!wrap) return;
  const banner = state.sync?.needs_login
    ? `<div class="g-banner" role="alert">🔐 Confirméier de Login an der Trade Republic App — schreif <code>!login</code> an #geld</div>` : "";
  const msg = state.msg ? `<div class="g-msg${state.msgErr ? " err" : ""}" role="status">${esc(state.msg)}</div>` : "";
  const openBudgets = document.querySelector(".g-details")?.open;
  wrap.innerHTML = `${banner}${bankBanners()}${msg}${headerCards()}${accountsSection()}${spendingSection()}${portfolioSection()}${budgetSection()}${footer()}${pickerDialog()}`;
  if (openBudgets) document.querySelector(".g-details").open = true;
  wire();
}

function parseAmount(text) {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function wire() {
  for (const btn of document.querySelectorAll("[data-connect]")) btn.onclick = () => connectBank(btn.dataset.connect);
  const syncBtn = $("syncBanks");
  if (syncBtn) syncBtn.onclick = refreshBanks;
  $("prevM").onclick = () => changeMonth(shiftMonth(state.month, -1));
  $("nextM").onclick = () => changeMonth(shiftMonth(state.month, 1));
  $("filters").onclick = (e) => { const k = e.target.closest("[data-filter]")?.dataset.filter; if (k) update({ filter: k, shown: LIST_STEP }); };
  $("ranges").onclick = (e) => { const r = e.target.closest("[data-range]"); if (r) update({ range: Number(r.dataset.range) }); };
  $("more")?.addEventListener("click", () => update({ shown: state.shown + LIST_STEP }));
  $("txList").onclick = (e) => { const id = e.target.closest("[data-pick]")?.dataset.pick; if (id) update({ picking: id }); };
  wireChart(chartSeries());
  $("saveB").onclick = () => {
    const values = {};
    for (const input of document.querySelectorAll("[data-bcat]")) values[input.dataset.bcat] = parseAmount(input.value);
    if (Object.values(values).some(Number.isNaN)) { $("bMsg").textContent = "Ongültege Betrag."; $("bMsg").classList.add("err"); return; }
    saveBudgets(values);
  };
  const dlg = $("pick");
  if (dlg) {
    const tx = state.txMonth.find((t) => t.id === state.picking);
    dlg.addEventListener("close", () => { if (state.picking) update({ picking: null }); });
    dlg.onclick = (e) => {
      if (e.target === dlg) return dlg.close();
      const cat = e.target.closest("[data-cat]")?.dataset.cat;
      if (cat && tx) setCategory(tx, cat);
    };
    $("pickCancel").onclick = () => dlg.close();
    dlg.showModal();
  }
}

/* ---------- boot ---------- */
function gate(html) {
  $("wrap").innerHTML = `<div class="g-gate" role="status">${html}</div>`;
}

let bootNumber = 0;
async function boot() {
  const run = ++bootNumber;
  try {
    sb = await cfgClient();
    if (run !== bootNumber) return;
    const session = auth.session();
    if (!session?.user) {
      gate(`Mell dech un fir deng Suen ze gesinn.<br><button type="button" class="g-btn" id="si">Umellen</button>`);
      $("si").onclick = () => auth.openAuthModal();
      return;
    }
    if ((session.user.email || "").toLowerCase() !== OWNER) {
      gate("Dës Säit ass nëmme fir den Ian.");   /* no data request for anyone else */
      return;
    }
    const callback = takeBankCallback();
    if (callback) await finishBankConnect(callback);
    await loadAll();
  } catch (error) {
    console.error("geld: boot failed", error);
    gate("D'Daten konnten net gelueden ginn. Probéier et méi spéit nach eng Kéier.");
  }
}

auth.onAuth(boot);
boot();
setInterval(() => { if (document.visibilityState === "visible" && state.loaded && !state.picking) loadAll().catch((e) => console.error("geld: refresh", e)); }, REFRESH_MS);
