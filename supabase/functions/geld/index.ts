// Supabase Edge Function: geld
// Backend of geld.html, the Trade Republic money tracker. The brix worker
// (ian-stack TRSync) posts what it fetched from Trade Republic; the owner page
// reads the tables directly through RLS, so there are no page actions here.
//
// Auth: every request carries header `x-sync-secret` (= GELD_SYNC_SECRET),
// compared in constant time. With the secret unset the function fails closed.
// Exception: the page-facing bank_* actions below accept the owner's JWT.
//
// Contract (POST, JSON, body.action):
//   sync    {events:[Ev], positions:[Pos]|null, cash:number|null, daily:[{day,depot_value,invested,cash}]|null}
//           -> {ok, inserted, updated, categorised}
//   status  {ok:bool, error?:string, needs_login?:bool}   -> {ok:true}
//   report  {date:"YYYY-MM-DD"}                            -> numbers for the morning summary
//   alerts  {}                                             -> {alerts:[{cat,level,spent,limit}]}
//   bank_auth    (owner login) {bank:"bcee"|"bdl"|"tr"}  -> {url}   start a bank login (Enable Banking)
//   bank_session (owner login) {code,state}         -> {accounts,inserted}   finish it, full-history sync
//   bank_sync    (x-sync-secret from cron, or owner login) {} -> {ok,accounts,inserted,categorised}
//   report also returns bank_notes: [{label, problem:"expires"|"expired"|"error", days_left?, error?}]
//
// Auth for the bank_* actions: bank_auth/bank_session need the owner's Supabase
// JWT (`Authorization: Bearer`, verified with auth.getUser, id must be the owner).
//
// Deploy:
//   supabase functions deploy geld --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
// Secrets: GELD_SYNC_SECRET (new), ANTHROPIC_API_KEY (already set),
// EB_APP_ID + EB_PRIVATE_KEY (Enable Banking application id + PKCS#8 PEM key);
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.
import { secretsMatch } from "../_shared/secrets.ts";
import { dedupeTrBank, handleBankAuth, handleBankSession, handleBankSync, loadBankNotes, OWNER_ID } from "./bank.ts";
import type { Psu } from "./bank_api.ts";
import { admin, categorisePending, loadExisting, loadRules, must, selectAll, UPSERT_CHUNK } from "./store.ts";
import {
  type Alert, type Budget, changeBetween, chunk, dedupeEvents, eventToRow,
  mergeRow, planAlerts, round2, type SpendRow, spendingByCat, TOTAL_KEY, todayDailyRow,
  topMerchants, type TxRow,
} from "./logic.ts";
import { dayRange, lbMonth, monthRange } from "./time.ts";
import {
  MAX_BODY_BYTES, parseReportDate, parseStatus, parseSync, type SyncInput,
} from "./validate.ts";

const SYNC_SECRET = Deno.env.get("GELD_SYNC_SECRET") ?? "";
const TOP_MERCHANTS = 5;
const TRADE_TYPES = ["buy", "sell", "savings_plan"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-sync-secret, apikey, content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

// ---- sync -------------------------------------------------------------

async function upsertEvents(input: SyncInput, nowISO: string) {
  const events = dedupeEvents(input.events);
  const rules = await loadRules();
  const existing = await loadExisting(events.map((e) => e.id));
  const rows: TxRow[] = events.map((ev) => mergeRow(eventToRow(ev, rules, nowISO), existing.get(ev.id)));
  for (const part of chunk(rows, UPSERT_CHUNK)) {
    must(await admin.from("geld_tx").upsert(part, { onConflict: "id" }), "tx upsert");
  }
  const updated = rows.filter((r) => existing.has(r.id)).length;
  return { inserted: rows.length - updated, updated };
}

async function replacePositions(positions: NonNullable<SyncInput["positions"]>, nowISO: string) {
  if (positions.length) {
    const rows = positions.map((p) => ({ ...p, updated_at: nowISO }));
    must(await admin.from("geld_positions").upsert(rows, { onConflict: "isin" }), "positions upsert");
    const keep = `(${positions.map((p) => `"${p.isin}"`).join(",")})`;
    must(await admin.from("geld_positions").delete().not("isin", "in", keep), "positions prune");
  } else {
    must(await admin.from("geld_positions").delete().neq("isin", ""), "positions clear");
  }
}

async function writeDaily(input: SyncInput, nowMs: number) {
  const rows = input.daily ??
    (input.positions ? [todayDailyRow(input.positions, input.cash, nowMs)] : []);
  for (const part of chunk(rows, UPSERT_CHUNK)) {
    must(await admin.from("geld_daily").upsert(part, { onConflict: "day" }), "daily upsert");
  }
}

async function markSyncOk(nowISO: string) {
  const { count, error } = await admin.from("geld_tx").select("id", { count: "exact", head: true }).eq("source", "tr");
  if (error) console.error("geld: events count", error.message);
  must(
    await admin.from("geld_sync").upsert({
      id: 1, last_ok_at: nowISO, last_attempt_at: nowISO, last_error: null,
      needs_login: false, events_total: count ?? null,
    }, { onConflict: "id" }),
    "sync status",
  );
}

async function handleSync(body: Record<string, unknown>) {
  const parsed = parseSync(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const input = parsed.value;
  const now = new Date();
  const nowISO = now.toISOString();
  const counts = await upsertEvents(input, nowISO);
  if (input.positions) await replacePositions(input.positions, nowISO);
  await writeDaily(input, now.getTime());
  await dedupeTrBank();
  const categorised = await categorisePending();
  await markSyncOk(nowISO);
  return json({ ok: true, ...counts, categorised });
}

// ---- status -----------------------------------------------------------

async function handleStatus(body: Record<string, unknown>) {
  const parsed = parseStatus(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const { ok, error, needsLogin } = parsed.value;
  const nowISO = new Date().toISOString();
  const row: Record<string, unknown> = ok
    ? { id: 1, last_ok_at: nowISO, last_attempt_at: nowISO, last_error: null, needs_login: false }
    : { id: 1, last_attempt_at: nowISO, last_error: error ?? "unknown error", needs_login: needsLogin };
  must(await admin.from("geld_sync").upsert(row, { onConflict: "id" }), "status write");
  return json({ ok: true });
}

// ---- alerts and report ------------------------------------------------

const SPEND_COLUMNS = "at, amount, kind, type, cat, is_transfer, merchant";

const loadMonthRows = (month: string) => {
  const [start, end] = monthRange(month);
  return selectAll<SpendRow>(
    () => admin.from("geld_tx").select(SPEND_COLUMNS)
      .gte("at", new Date(start).toISOString()).lt("at", new Date(end).toISOString())
      .order("at").order("id"),
    "month read",
  );
};

async function loadBudgets(): Promise<Budget[]> {
  return must<Budget[]>(await admin.from("geld_budgets").select("cat, monthly_limit"), "budgets read");
}

/** Budget thresholds of the current Luxembourg month not announced yet. Each
 * (month, cat, level) is claimed by an insert that ignores duplicates, so two
 * callers at once cannot both announce the same alert. */
async function dueAlerts(): Promise<Alert[]> {
  const month = lbMonth(Date.now());
  const budgets = await loadBudgets();
  if (!budgets.length) return [];
  const { total, byCat } = spendingByCat(await loadMonthRows(month));
  const sentRows = must<{ cat: string; level: number }[]>(
    await admin.from("geld_alerts_sent").select("cat, level").eq("month", month), "alerts read",
  );
  const sent = new Set(sentRows.map((r) => `${r.cat}|${r.level}`));
  const plan = planAlerts(total, byCat, budgets, sent);
  if (!plan.toMark.length) return [];
  const claimed = must<{ cat: string; level: number }[]>(
    await admin.from("geld_alerts_sent")
      .upsert(plan.toMark.map((m) => ({ month, ...m })), { onConflict: "month,cat,level", ignoreDuplicates: true })
      .select("cat, level"),
    "alerts claim",
  );
  const won = new Set(claimed.map((r) => `${r.cat}|${r.level}`));
  return plan.alerts.filter((a) => won.has(`${a.cat}|${a.level}`));
}

async function handleAlerts() {
  return json({ alerts: await dueAlerts() });
}

async function dailyAround(day: string) {
  const rows = must<{ day: string; depot_value: number | null; cash: number | null }[]>(
    await admin.from("geld_daily").select("day, depot_value, cash").lte("day", day)
      .order("day", { ascending: false }).limit(2),
    "daily read",
  );
  return { latest: rows[0] ?? null, previous: rows[1] ?? null };
}

async function handleReport(body: Record<string, unknown>) {
  const parsed = parseReportDate(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const day = parsed.value;
  const [dayStart, dayEnd] = dayRange(day);
  const monthRows = await loadMonthRows(day.slice(0, 7));
  const dayRows = monthRows.filter((r) => Date.parse(r.at) >= dayStart && Date.parse(r.at) < dayEnd);
  const budgets = await loadBudgets();
  const monthBudget = budgets.find((b) => b.cat === TOTAL_KEY)?.monthly_limit ?? null;
  const { latest, previous } = await dailyAround(day);
  const daySpend = spendingByCat(dayRows);
  const trades = dayRows.filter((r) => TRADE_TYPES.includes(r.type ?? "")).map((r) => ({
    type: r.type, merchant: r.merchant ?? "", amount: round2(Number(r.amount)),
  }));
  return json({
    day,
    spent_day: daySpend.total,
    top: topMerchants(dayRows, TOP_MERCHANTS),
    by_cat_day: daySpend.byCat,
    month_spent: spendingByCat(monthRows).total,
    month_budget: monthBudget === null ? null : Number(monthBudget),
    depot_value: latest?.depot_value ?? null,
    depot_change_day: changeBetween(latest?.depot_value ?? null, previous?.depot_value ?? null),
    cash: latest?.cash ?? null,
    trades,
    alerts: await dueAlerts(),
    bank_notes: await loadBankNotes(Date.now()),
  });
}

// ---- entry ------------------------------------------------------------

type Handler = (body: Record<string, unknown>) => Promise<Response>;
const ACTIONS: Record<string, Handler> = {
  sync: handleSync, status: handleStatus, report: handleReport, alerts: () => handleAlerts(),
};

type Caller = { kind: "secret" } | { kind: "owner"; psu: Psu };
type BankHandler = (body: Record<string, unknown>, caller: Caller) => Promise<{ status: number; body: unknown }>;
/* Bank actions and who may call them. bank_sync is also called by cron with
 * the sync secret; the two others need the owner's own login. */
const BANK_ACTIONS: Record<string, { allowSecret: boolean; run: BankHandler }> = {
  bank_auth: { allowSecret: false, run: (b, c) => handleBankAuth(b, psuOf(c)) },
  bank_session: { allowSecret: false, run: (b, c) => handleBankSession(b, psuOf(c)) },
  bank_sync: { allowSecret: true, run: (_b, c) => handleBankSync(c.kind === "owner" ? c.psu : undefined) },
};
const psuOf = (caller: Caller): Psu => (caller.kind === "owner" ? caller.psu : {});

/** PSU headers of an attended request: client IP (first x-forwarded-for hop) and user agent. */
function psuFrom(req: Request): Psu {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 300);
  return { ...(ip ? { ip } : {}), ...(userAgent ? { userAgent } : {}) };
}

/** Is the bearer token the owner's Supabase session? Fails closed. */
async function isOwner(req: Request): Promise<boolean> {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!match) return false;
  const { data, error } = await admin.auth.getUser(match[1]);
  return !error && data.user?.id === OWNER_ID;
}

async function authenticate(req: Request, allowOwner: boolean): Promise<Caller | null> {
  if (await secretsMatch(SYNC_SECRET, req.headers.get("x-sync-secret"))) return { kind: "secret" };
  if (allowOwner && await isOwner(req)) return { kind: "owner", psu: psuFrom(req) };
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  /* Cheap early refusal: neither the sync secret header nor a bearer token. */
  if (!req.headers.has("x-sync-secret") && !req.headers.has("authorization")) return json({ error: "unauthorized" }, 401);

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "body too large" }, 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ error: "bad json" }, 400); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return json({ error: "body must be an object" }, 400);
  }
  const payload = body as Record<string, unknown>;
  const action = typeof payload.action === "string" ? payload.action : "";
  const bank = Object.hasOwn(BANK_ACTIONS, action) ? BANK_ACTIONS[action] : null;
  if (!bank && !Object.hasOwn(ACTIONS, action)) {
    /* Unknown actions look the same as before to unauthenticated callers. */
    return await authenticate(req, false) ? json({ error: "unknown action" }, 400) : json({ error: "unauthorized" }, 401);
  }

  const caller = await authenticate(req, bank !== null);
  if (!caller || (caller.kind === "secret" && bank && !bank.allowSecret)) return json({ error: "unauthorized" }, 401);

  try {
    if (bank) {
      const reply = await bank.run(payload, caller);
      return json(reply.body, reply.status);
    }
    return await ACTIONS[action](payload);
  } catch (e) {
    console.error("geld:", action, (e as Error)?.message);
    return json({ error: "server error" }, 500);
  }
});
