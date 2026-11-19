/* Boundary checks for the bank_* actions: the page's request bodies and every
 * Enable Banking response. Each parser returns a fresh typed value or null /
 * {error}; nothing is trusted because it came from a bank. Pure. */
import { clean } from "./validate.ts";

export type BankId = "bcee" | "bdl";
export const BANK_IDS: readonly BankId[] = ["bcee", "bdl"];
const STATE_RE = /^[0-9a-f]{64}$/;
const MAX_CODE = 2000;
const MAX_ABS_AMOUNT = 1e12;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REMITTANCE_LINES = 8;
const MAX_ACCOUNTS = 20;
const CASH_ACCOUNT = "CACC";

type Obj = Record<string, unknown>;
type Result<T> = { value: T } | { error: string };
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200) => clean(v, max);

export function parseBankAuth(body: Obj): Result<{ bank: BankId }> {
  return BANK_IDS.includes(body.bank as BankId)
    ? { value: { bank: body.bank as BankId } }
    : { error: "bank must be bcee or bdl" };
}

export function parseBankSession(body: Obj): Result<{ code: string; state: string }> {
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code || code.length > MAX_CODE || /\s/.test(code)) return { error: "code invalid" };
  if (typeof body.state !== "string" || !STATE_RE.test(body.state)) return { error: "state invalid" };
  return { value: { code, state: body.state } };
}

// ---- ASPSP list -------------------------------------------------------

export type Aspsp = { name: string; maxConsentSeconds: number | null };
const BANK_MATCH: Record<BankId, RegExp> = {
  bcee: /caisse d.?[ée]pargne|spuerkeess/i,
  bdl: /^banque de luxembourg$/i,
};

/** The ASPSP of a bank, resolved by name from EB's list (never hardcoded). */
export function pickAspsp(raw: unknown, bank: BankId): Aspsp | null {
  const list = isObj(raw) && Array.isArray(raw.aspsps) ? raw.aspsps : [];
  for (const item of list) {
    if (!isObj(item) || typeof item.name !== "string" || !BANK_MATCH[bank].test(item.name.trim())) continue;
    if (Array.isArray(item.psu_types) && !item.psu_types.includes("personal")) continue;
    const max = item.maximum_consent_validity;
    return {
      name: item.name,
      maxConsentSeconds: typeof max === "number" && Number.isFinite(max) && max > 0 ? max : null,
    };
  }
  return null;
}

// ---- session ----------------------------------------------------------

export type SessionAccount = {
  uid: string; iban: string | null; name: string; currency: string; cashType: string | null;
};
export type SessionInfo = { sessionId: string; validUntil: string | null; accounts: SessionAccount[] };

export function normalizeIban(value: unknown): string | null {
  const iban = typeof value === "string" ? value.replace(/\s+/g, "").toUpperCase() : "";
  return /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban) ? iban : null;
}

export function parseSessionResponse(raw: unknown): Result<SessionInfo> {
  if (!isObj(raw) || typeof raw.session_id !== "string" || !raw.session_id) return { error: "session_id missing" };
  if (!Array.isArray(raw.accounts)) return { error: "accounts missing" };
  const accounts: SessionAccount[] = [];
  for (const a of raw.accounts.slice(0, MAX_ACCOUNTS)) {
    if (!isObj(a) || typeof a.uid !== "string" || !a.uid || a.uid.length > 200) continue;
    accounts.push({
      uid: a.uid,
      iban: normalizeIban(isObj(a.account_id) ? a.account_id.iban : null),
      name: str(a.name, 80),
      currency: str(a.currency, 8) || "EUR",
      cashType: typeof a.cash_account_type === "string" ? a.cash_account_type : null,
    });
  }
  const access = isObj(raw.access) ? raw.access.valid_until : null;
  const validUntil = typeof access === "string" && !Number.isNaN(Date.parse(access)) ? new Date(access).toISOString() : null;
  return { value: { sessionId: raw.session_id, validUntil, accounts } };
}

export const isMainCandidate = (a: SessionAccount) => a.cashType === CASH_ACCOUNT;

// ---- balances ---------------------------------------------------------

const BALANCE_PREFERENCE = ["CLBD", "ITAV", "XPCD"];
export type Balance = { amount: number; at: string | null };

/** Closing booked, then interim available, then expected; else the first usable. */
export function pickBalance(raw: unknown): Balance | null {
  const list = isObj(raw) && Array.isArray(raw.balances) ? raw.balances.filter(isObj) : [];
  const usable = list.flatMap((b) => {
    const amount = isObj(b.balance_amount) ? Number(b.balance_amount.amount) : NaN;
    if (!Number.isFinite(amount) || Math.abs(amount) > MAX_ABS_AMOUNT) return [];
    const signed = b.credit_debit_indicator === "DBIT" && amount > 0 ? -amount : amount;
    const ref = typeof b.reference_date === "string" ? b.reference_date : "";
    const at = ref && !Number.isNaN(Date.parse(ref)) ? new Date(ref).toISOString() : null;
    return [{ type: String(b.balance_type ?? ""), balance: { amount: signed, at } }];
  });
  for (const type of BALANCE_PREFERENCE) {
    const hit = usable.find((u) => u.type === type);
    if (hit) return hit.balance;
  }
  return usable[0]?.balance ?? null;
}

// ---- transactions -----------------------------------------------------

export type BankTx = {
  entryRef: string | null; transactionId: string | null; amount: number; kind: "in" | "out";
  date: string; bookingDate: string; creditor: string; debtor: string;
  creditorIban: string | null; debtorIban: string | null; remittance: string[]; code: string;
};

/** A transaction in a form geld can store, or null when it is not a booked,
 * well-formed movement (pending rows and garbage are skipped). */
export function parseBankTx(raw: unknown): BankTx | null {
  if (!isObj(raw) || raw.status !== "BOOK") return null;
  const amountObj = isObj(raw.transaction_amount) ? raw.transaction_amount : null;
  const amount = Number(amountObj?.amount);
  if (!Number.isFinite(amount) || Math.abs(amount) > MAX_ABS_AMOUNT) return null;
  if (amountObj?.currency !== undefined && amountObj.currency !== "EUR") return null;
  const kind = raw.credit_debit_indicator === "DBIT" ? "out" : raw.credit_debit_indicator === "CRDT" ? "in" : null;
  if (!kind) return null;
  const dates = [raw.transaction_date, raw.booking_date, raw.value_date]
    .filter((d): d is string => typeof d === "string" && !Number.isNaN(Date.parse(d)));
  if (!dates.length) return null;
  const booking = typeof raw.booking_date === "string" && DAY_RE.test(raw.booking_date) ? raw.booking_date : "";
  const party = (key: string) => (isObj(raw[key]) ? str((raw[key] as Obj).name, 200) : "");
  const partyIban = (key: string) => (isObj(raw[key]) ? normalizeIban((raw[key] as Obj).iban) : null);
  const remittance = Array.isArray(raw.remittance_information)
    ? raw.remittance_information.slice(0, MAX_REMITTANCE_LINES).map((l) => str(l, 200)).filter(Boolean) : [];
  return {
    entryRef: str(raw.entry_reference, 120) || null,
    transactionId: str(raw.transaction_id, 120) || null,
    amount: Math.abs(amount), kind, date: dates[0], bookingDate: booking,
    creditor: party("creditor"), debtor: party("debtor"),
    creditorIban: partyIban("creditor_account"), debtorIban: partyIban("debtor_account"),
    remittance, code: isObj(raw.bank_transaction_code) ? str((raw.bank_transaction_code as Obj).code ?? (raw.bank_transaction_code as Obj).description, 60) : str(raw.bank_transaction_code, 60),
  };
}
