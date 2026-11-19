/* Pure rules of the bank sync: stable ids, how a bank transaction becomes a
 * geld_tx row, own-account detection, account labels, consent notes. */
import { type BankId, type BankTx, isMainCandidate, type SessionAccount } from "./bank_validate.ts";
import { clean } from "./validate.ts";
import { merchantKey, type TxRow } from "./logic.ts";

export const BANK_LABEL: Record<BankId, string> = { bcee: "Spuerkeess", bdl: "BDL" };
export const BANK_ACCOUNT_SOURCE = "bank";
export const STATE_MAX_AGE_MS = 30 * 60_000;
const CLOCK_SKEW_MS = 2 * 60_000;
const DAY_MS = 86_400_000;
export const MAX_CONSENT_DAYS = 180;
export const FULL_HISTORY_DAYS = 730;
export const OVERLAP_DAYS = 7;
export const EXPIRY_WARNING_DAYS = 14;
const MAX_MERCHANT = 180;
const MAX_REF_IN_ID = 100;
const KEY_LENGTH = 16;
const NOON_UTC = "T12:00:00.000Z";
/* Names that mean "Ian's own money" even when no IBAN matches (Trade Republic
 * has no IBAN here). Same idea as OWN_COUNTERPARTY in logic.ts. */
const OWN_NAME = /trade republic|\bian\b|raoul/i;
const CARD_HINT = /\b(carte|card|visa|mastercard|maestro|debit ?card|apple ?pay|google ?pay|v ?pay|paiement|pos)\b/i;
const CARD_CODES = /^(CCRD|POS|CARD|PMNT-CCRD)/i;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Identity of an account that survives a new consent session (EB's uid does not). */
export async function accountKey(ibanHash: string | null, uid: string): Promise<string> {
  return (ibanHash ?? await sha256Hex(`uid:${uid}`)).slice(0, KEY_LENGTH);
}

export const isStateFresh = (createdAtISO: string, nowMs: number) => {
  const age = nowMs - Date.parse(createdAtISO);
  return Number.isFinite(age) && age >= -CLOCK_SKEW_MS && age < STATE_MAX_AGE_MS;
};

export function consentValidUntil(maxConsentSeconds: number | null, nowMs: number): string {
  const capDays = MAX_CONSENT_DAYS * 86_400;
  const seconds = Math.min(maxConsentSeconds ?? capDays, capDays);
  return new Date(nowMs + seconds * 1000).toISOString();
}

// ---- transactions -----------------------------------------------------

export type MapContext = {
  uid: string; key: string; label: string;
  ownIbanHashes: ReadonlySet<string>; rules: ReadonlyMap<string, string>; nowISO: string;
};

const atOf = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? date + NOON_UTC : new Date(date).toISOString());

/** Bank-given reference, or a hash of the fields that identify the movement. */
export async function txRef(tx: BankTx): Promise<string> {
  const given = tx.entryRef ?? tx.transactionId;
  if (given) return given.length > MAX_REF_IN_ID ? await sha256Hex(given) : given;
  const fields = [tx.bookingDate || tx.date, tx.amount.toFixed(2), tx.kind, tx.remittance.join(" ")];
  return "h" + (await sha256Hex(fields.join("|"))).slice(0, 24);
}

export const counterpartyName = (tx: BankTx) => (tx.kind === "out" ? tx.creditor : tx.debtor);
export const counterpartyIban = (tx: BankTx) => (tx.kind === "out" ? tx.creditorIban : tx.debtorIban);

export function merchantOf(tx: BankTx): string {
  const name = counterpartyName(tx);
  return clean((name || tx.remittance.join(" ")).replace(/\s+/g, " "), MAX_MERCHANT);
}

export function looksLikeCard(tx: BankTx): boolean {
  return CARD_CODES.test(tx.code) || CARD_HINT.test(tx.remittance.join(" "));
}

export async function isOwnTransfer(tx: BankTx, ownIbanHashes: ReadonlySet<string>): Promise<boolean> {
  const iban = counterpartyIban(tx);
  if (iban && ownIbanHashes.has(await sha256Hex(iban))) return true;
  return OWN_NAME.test(counterpartyName(tx));
}

export async function mapBankTx(tx: BankTx, ctx: MapContext, id: string): Promise<TxRow> {
  const own = await isOwnTransfer(tx, ctx.ownIbanHashes);
  const merchant = merchantOf(tx);
  const type = own
    ? (tx.kind === "out" ? "transfer_out" : "transfer_in")
    : looksLikeCard(tx) ? (tx.kind === "out" ? "card" : "card_refund") : "other";
  return {
    id, at: atOf(tx.date), amount: tx.amount, kind: tx.kind, account: ctx.label,
    source: BANK_ACCOUNT_SOURCE, type, merchant, isin: null, shares: null,
    cat: own ? "transfer" : ctx.rules.get(merchantKey(merchant)) ?? null,
    cat_locked: false, is_transfer: own, status: "BOOK", event_type: tx.code || null,
    updated_at: ctx.nowISO,
  };
}

/** Rows for a list of transactions. Ids are stable across syncs; two movements
 * that share an id inside one response are kept apart with a counter. */
export async function mapBankTxs(txs: BankTx[], ctx: MapContext): Promise<TxRow[]> {
  const seen = new Map<string, number>();
  const rows: TxRow[] = [];
  for (const tx of txs) {
    const base = `eb:${ctx.key}:${await txRef(tx)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push(await mapBankTx(tx, ctx, n === 1 ? base : `${base}~${n}`));
  }
  return rows;
}

// ---- sync window ------------------------------------------------------

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** First sync: two years, longest strategy. Later: last sync minus an overlap. */
export function syncWindow(lastSyncAt: string | null, nowMs: number): { dateFrom: string; strategy?: "longest" } {
  const last = lastSyncAt ? Date.parse(lastSyncAt) : NaN;
  if (!Number.isFinite(last)) return { dateFrom: ymd(nowMs - FULL_HISTORY_DAYS * DAY_MS), strategy: "longest" };
  return { dateFrom: ymd(last - OVERLAP_DAYS * DAY_MS) };
}

// ---- accounts ---------------------------------------------------------

export type AccountRow = {
  uid: string; bank: BankId; label: string; iban_last4: string | null; iban_hash: string | null;
  name: string; currency: string; valid_until: string | null; active: true;
  last_sync_at: null; last_error: null;
};
export type KnownAccount = { uid: string; label: string; iban_hash: string | null };

/** Labels for the accounts of a fresh session. An account already known at this
 * bank (same IBAN hash) keeps its label. Otherwise the main account (a current
 * account, else the first) gets the bare bank label so it continues the legacy
 * rows; further accounts get "Label · name" (or ••last4). */
export async function planAccounts(
  bank: BankId, accounts: SessionAccount[], known: KnownAccount[], validUntil: string | null,
): Promise<AccountRow[]> {
  const base = BANK_LABEL[bank];
  const hashes = await Promise.all(accounts.map((a) => (a.iban ? sha256Hex(a.iban) : Promise.resolve(null))));
  const reused = accounts.map((_, i) => known.find((k) => hashes[i] && k.iban_hash === hashes[i])?.label ?? null);
  const mainIndex = Math.max(0, accounts.findIndex(isMainCandidate));
  const baseTaken = reused.includes(base);
  const used = new Set(reused.filter((l): l is string => !!l));
  return accounts.map((a, i) => {
    const last4 = a.iban ? a.iban.slice(-4) : null;
    let label = reused[i];
    if (!label) {
      const wantsBase = i === mainIndex && !baseTaken;
      label = wantsBase ? base : `${base} · ${a.name || (last4 ? `••${last4}` : String(i + 1))}`;
      while (used.has(label)) label += ` ••${last4 ?? i + 1}`;
    }
    used.add(label);
    return {
      uid: a.uid, bank, label, iban_last4: last4, iban_hash: hashes[i], name: a.name, currency: a.currency,
      valid_until: validUntil, active: true, last_sync_at: null, last_error: null,
    };
  });
}

// ---- notes for the report ---------------------------------------------

export type NoteAccount = { label: string; valid_until: string | null; last_error: string | null; active: boolean };
export type BankNote = { label: string; problem: "expires" | "expired" | "error"; days_left?: number; error?: string };

export function daysLeft(validUntil: string | null, nowMs: number): number | null {
  const until = validUntil ? Date.parse(validUntil) : NaN;
  return Number.isFinite(until) ? Math.ceil((until - nowMs) / DAY_MS) : null;
}

export function bankNotes(accounts: NoteAccount[], nowMs: number): BankNote[] {
  const notes: BankNote[] = [];
  for (const a of accounts.filter((x) => x.active)) {
    const left = daysLeft(a.valid_until, nowMs);
    const expired = left !== null && Date.parse(a.valid_until as string) <= nowMs;
    if (expired) notes.push({ label: a.label, problem: "expired" });
    else if (left !== null && left <= EXPIRY_WARNING_DAYS) notes.push({ label: a.label, problem: "expires", days_left: left });
    if (a.last_error) notes.push({ label: a.label, problem: "error", error: a.last_error });
  }
  return notes;
}
