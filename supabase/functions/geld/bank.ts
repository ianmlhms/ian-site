/* Bank sync actions of the geld function: connect a bank through Enable
 * Banking, pull its transactions and balances, report consent problems.
 * Pure rules are in bank_logic.ts, response checks in bank_validate.ts, the
 * HTTP client in bank_api.ts; this file only wires them to the database. */
import {
  type EbClient, EbError, fetchAllTransactions, type Psu, createEbClient,
} from "./bank_api.ts";
import {
  accountKey, type AccountRow, BANK_LABEL, bankNotes, consentValidUntil, isStateFresh, type KnownAccount,
  mapBankTxs, type NoteAccount, planAccounts, syncWindow,
} from "./bank_logic.ts";
import {
  type BankId, parseBankAuth, parseBankSession, parseBankTx, parseSessionResponse, pickAspsp,
  pickBalance, type BankTx,
} from "./bank_validate.ts";
import { chunk, type TxRow, mergeRow, round2 } from "./logic.ts";
import { admin, categorisePending, loadExisting, loadRules, must, UPSERT_CHUNK } from "./store.ts";

export const OWNER_ID = "a40ba59a-3460-4ef2-a8e8-3db0c91eac66";
const REDIRECT_URL = "https://ian.lu/geld.html";
const COUNTRY = "LU";
const STATE_BYTES = 32;
const STALE_AUTH_DAYS = 2;
const ACCOUNT_COLUMNS =
  "uid, bank, label, iban_last4, iban_hash, name, currency, balance, balance_at, valid_until, last_sync_at, last_error, active";

type Reply = { status: number; body: unknown };
const ok = (body: unknown): Reply => ({ status: 200, body });
const bad = (error: string, status = 400): Reply => ({ status, body: { error } });

type AccountDb = {
  uid: string; bank: BankId; label: string; iban_hash: string | null; iban_last4: string | null;
  currency: string | null; valid_until: string | null; last_sync_at: string | null; active: boolean;
  last_error: string | null;
};

let cachedClient: EbClient | null = null;
function ebClient(): EbClient {
  const appId = Deno.env.get("EB_APP_ID") ?? "";
  const privateKey = Deno.env.get("EB_PRIVATE_KEY") ?? "";
  if (!appId || !privateKey) throw new Error("EB_APP_ID / EB_PRIVATE_KEY not set");
  cachedClient ??= createEbClient({ appId, privateKey });
  return cachedClient;
}

/** Short, secret-free text for geld_accounts.last_error (shown on the page). */
export function friendlyError(error: unknown): string {
  if (error instanceof EbError) return error.code ? `Bank ${error.status} ${error.code}` : `Bank ${error.status}`;
  return "Synchro gescheitert";
}

// ---- bank_auth --------------------------------------------------------

export async function handleBankAuth(body: Record<string, unknown>, psu: Psu): Promise<Reply> {
  const parsed = parseBankAuth(body);
  if ("error" in parsed) return bad(parsed.error);
  const { bank } = parsed.value;
  const eb = ebClient();
  const aspsp = pickAspsp(await eb.listAspsps(COUNTRY), bank);
  if (!aspsp) return bad(`${BANK_LABEL[bank]} not offered by Enable Banking`, 502);
  const state = [...crypto.getRandomValues(new Uint8Array(STATE_BYTES))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const staleBefore = new Date(Date.now() - STALE_AUTH_DAYS * 86_400_000).toISOString();
  must(await admin.from("geld_bank_auth").delete().lt("created_at", staleBefore), "stale states");
  must(await admin.from("geld_bank_auth").insert({ state, bank }), "state store");
  const started = await eb.startAuth({
    access: { valid_until: consentValidUntil(aspsp.maxConsentSeconds, Date.now()) },
    aspsp: { name: aspsp.name, country: COUNTRY },
    state, redirect_url: REDIRECT_URL, psu_type: "personal",
  }, psu);
  const url = typeof started.url === "string" ? started.url : "";
  if (!url.startsWith("https://")) throw new Error("auth: no https url returned");
  return ok({ url });
}

// ---- bank_session -----------------------------------------------------

async function claimState(state: string): Promise<{ bank: BankId; created_at: string } | null> {
  const rows = must<{ bank: BankId; created_at: string }[]>(
    await admin.from("geld_bank_auth").delete().eq("state", state).select("bank, created_at"), "state claim",
  );
  return rows[0] ?? null;
}

/** Store the session and its accounts; accounts of an earlier session at the
 * same bank are replaced (the new rows carry their labels over). */
async function storeSession(
  bank: BankId, sessionId: string, validUntil: string | null, rows: AccountRow[], known: KnownAccount[],
): Promise<void> {
  must(await admin.from("geld_bank_sessions").upsert({
    session_id: sessionId, bank, valid_until: validUntil, uids: rows.map((r) => r.uid), revoked: false,
  }, { onConflict: "session_id" }), "session store");
  must(await admin.from("geld_accounts").upsert(rows, { onConflict: "uid" }), "accounts store");
  const fresh = new Set(rows.map((r) => r.uid));
  const old = known.filter((k) => !fresh.has(k.uid)).map((k) => k.uid);
  if (old.length) must(await admin.from("geld_accounts").delete().in("uid", old), "old accounts remove");
}

async function knownAccounts(bank: BankId): Promise<KnownAccount[]> {
  return must<KnownAccount[]>(
    await admin.from("geld_accounts").select("uid, label, iban_hash").eq("bank", bank), "accounts read",
  );
}

export async function handleBankSession(body: Record<string, unknown>, psu: Psu): Promise<Reply> {
  const parsed = parseBankSession(body);
  if ("error" in parsed) return bad(parsed.error);
  const claimed = await claimState(parsed.value.state);
  if (!claimed) return bad("state unknown or already used");
  if (!isStateFresh(claimed.created_at, Date.now())) return bad("state expired, start again");
  const session = parseSessionResponse(await ebClient().createSession(parsed.value.code, psu));
  if ("error" in session) throw new Error(`session response: ${session.error}`);
  const { sessionId, validUntil, accounts } = session.value;
  if (!accounts.length) return bad("no accounts were shared, link them in Enable Banking and retry", 422);
  const known = await knownAccounts(claimed.bank);
  const rows = await planAccounts(claimed.bank, accounts, known, validUntil);
  await storeSession(claimed.bank, sessionId, validUntil, rows, known);
  const summary = await syncAccounts(rows.map((r) => r.uid), psu);
  return ok({ accounts: rows.map((r) => ({ label: r.label, iban_last4: r.iban_last4 })), inserted: summary.inserted });
}

// ---- bank_sync --------------------------------------------------------

type AccountSummary = { label: string; fetched: number; inserted: number; updated: number; error?: string };

async function ownIbanHashes(): Promise<Set<string>> {
  const rows = must<{ iban_hash: string | null }[]>(await admin.from("geld_accounts").select("iban_hash"), "own ibans");
  return new Set(rows.map((r) => r.iban_hash).filter((h): h is string => !!h));
}

async function storeRows(rows: TxRow[]): Promise<{ inserted: number; updated: number }> {
  const existing = await loadExisting(rows.map((r) => r.id));
  const merged = rows.map((r) => mergeRow(r, existing.get(r.id)) as TxRow);
  for (const part of chunk(merged, UPSERT_CHUNK)) {
    must(await admin.from("geld_tx").upsert(part, { onConflict: "id" }), "bank tx upsert");
  }
  const updated = merged.filter((r) => existing.has(r.id)).length;
  return { inserted: merged.length - updated, updated };
}

async function syncOne(
  eb: EbClient, acct: AccountDb, shared: { own: Set<string>; rules: Map<string, string> }, psu: Psu | undefined, nowMs: number,
): Promise<AccountSummary> {
  const window = syncWindow(acct.last_sync_at, nowMs);
  const raw = await fetchAllTransactions(eb, acct.uid, { dateFrom: window.dateFrom, strategy: window.strategy }, psu);
  const txs = raw.map(parseBankTx).filter((t): t is BankTx => t !== null);
  const rows = await mapBankTxs(txs, {
    uid: acct.uid, key: await accountKey(acct.iban_hash, acct.uid),
    label: acct.label, ownIbanHashes: shared.own, rules: shared.rules, nowISO: new Date(nowMs).toISOString(),
  });
  const counts = await storeRows(rows);
  const balance = pickBalance(await eb.balances(acct.uid, psu));
  const patch: Record<string, unknown> = { last_sync_at: new Date(nowMs).toISOString(), last_error: null };
  if (balance) Object.assign(patch, { balance: round2(balance.amount), balance_at: balance.at ?? patch.last_sync_at });
  must(await admin.from("geld_accounts").update(patch).eq("uid", acct.uid), "account update");
  return { label: acct.label, fetched: raw.length, ...counts };
}

async function recordFailure(acct: AccountDb, error: unknown): Promise<AccountSummary> {
  console.error("geld bank sync failed:", acct.label, (error as Error)?.message);
  const message = friendlyError(error);
  const { error: dbError } = await admin.from("geld_accounts").update({ last_error: message }).eq("uid", acct.uid);
  if (dbError) console.error("geld bank: could not store error", dbError.message);
  return { label: acct.label, fetched: 0, inserted: 0, updated: 0, error: message };
}

/** Sync the given accounts (default: every active one with a valid consent).
 * One account failing never stops the others. */
export async function syncAccounts(uids: string[] | null, psu?: Psu) {
  const nowMs = Date.now();
  let query = admin.from("geld_accounts").select(ACCOUNT_COLUMNS).eq("active", true);
  if (uids) query = query.in("uid", uids);
  const accounts = must<AccountDb[]>(await query, "accounts read")
    .filter((a) => a.valid_until !== null && Date.parse(a.valid_until) > nowMs);
  const summaries: AccountSummary[] = [];
  if (accounts.length) {
    const eb = ebClient();
    const shared = { own: await ownIbanHashes(), rules: await loadRules() };
    for (const acct of accounts) {
      try { summaries.push(await syncOne(eb, acct, shared, psu, nowMs)); }
      catch (e) { summaries.push(await recordFailure(acct, e)); }
    }
  }
  const categorised = summaries.some((s) => s.inserted > 0) ? await categorisePending() : 0;
  return {
    ok: summaries.every((s) => !s.error), accounts: summaries, categorised,
    inserted: summaries.reduce((n, s) => n + s.inserted, 0),
  };
}

export async function handleBankSync(psu: Psu | undefined): Promise<Reply> {
  return ok(await syncAccounts(null, psu));
}

// ---- report -----------------------------------------------------------

export async function loadBankNotes(nowMs: number) {
  const rows = must<NoteAccount[]>(
    await admin.from("geld_accounts").select("label, valid_until, last_error, active"), "bank notes read",
  );
  return bankNotes(rows, nowMs);
}
