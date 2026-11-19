import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createEbClient, EbError, fetchAllTransactions } from "./bank_api.ts";
import { jwtParts, pemToDer, signJwt, JWT_TTL_SECONDS } from "./bank_jwt.ts";
import {
  bankNotes, consentValidUntil, isStateFresh, mapBankTxs, planAccounts, sha256Hex, STATE_MAX_AGE_MS,
  syncWindow, txRef, type MapContext,
} from "./bank_logic.ts";
import {
  parseBankAuth, parseBankSession, parseBankTx, parseSessionResponse, pickAspsp, pickBalance, type BankTx,
} from "./bank_validate.ts";

const NOW = Date.parse("2026-11-19T10:00:00Z");
const NOW_ISO = new Date(NOW).toISOString();

// ---- JWT --------------------------------------------------------------

async function testPem() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const body = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}
const decodePart = (part: string) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));

Deno.test("JWT has the Enable Banking header and claims and a valid RS256 signature", async () => {
  const { pem, publicKey } = await testPem();
  const jwt = await signJwt("app-1", pem, 1_800_000_000);
  const [h, c, sig] = jwt.split(".");
  assertEquals(decodePart(h), { typ: "JWT", alg: "RS256", kid: "app-1" });
  const claims = decodePart(c);
  assertEquals([claims.iss, claims.aud, claims.iat], ["enablebanking.com", "api.enablebanking.com", 1_800_000_000]);
  assert(claims.exp - claims.iat <= 3600 && claims.exp > claims.iat);
  assertEquals(claims.exp - claims.iat, JWT_TTL_SECONDS);
  const raw = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(sig.length / 4) * 4, "=")), (ch) => ch.charCodeAt(0));
  assert(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, raw, new TextEncoder().encode(`${h}.${c}`)));
});

Deno.test("PEM with escaped newlines works, other key formats are refused", async () => {
  const { pem } = await testPem();
  assert(pemToDer(pem.replace(/\n/g, "\\n")).length > 100);
  assertEquals(jwtParts("a", 5).claims.exp, 5 + JWT_TTL_SECONDS);
  try { pemToDer("-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----"); throw new Error("no"); }
  catch (e) { assert(/PKCS#8/.test((e as Error).message)); }
});

// ---- request validation ----------------------------------------------

Deno.test("bank_auth and bank_session inputs are validated", () => {
  assertEquals(parseBankAuth({ bank: "bcee" }), { value: { bank: "bcee" } });
  assert("error" in parseBankAuth({ bank: "tr" }));
  const state = "ab".repeat(32);
  assertEquals(parseBankSession({ code: " c0de ", state }), { value: { code: "c0de", state } });
  assert("error" in parseBankSession({ code: "", state }));
  assert("error" in parseBankSession({ code: "x", state: "short" }));
  assert("error" in parseBankSession({ code: "a b", state }));
});

Deno.test("ASPSP names are resolved by pattern, with consent validity", () => {
  const list = { aspsps: [
    { name: "Banque de Luxembourg Business", maximum_consent_validity: 100 },
    { name: "Banque de Luxembourg", maximum_consent_validity: 7_776_000 },
    { name: "Banque et Caisse d’Épargne de l’État", maximum_consent_validity: 15_552_000, psu_types: ["personal", "business"] },
  ] };
  assertEquals(pickAspsp(list, "bdl"), { name: "Banque de Luxembourg", maxConsentSeconds: 7_776_000 });
  assertEquals(pickAspsp(list, "bcee")?.name, "Banque et Caisse d’Épargne de l’État");
  assertEquals(pickAspsp({ aspsps: [] }, "bdl"), null);
  assertEquals(pickAspsp("junk", "bcee"), null);
});

Deno.test("consent validity is capped at 180 days", () => {
  assertEquals(consentValidUntil(30 * 86400, NOW), new Date(NOW + 30 * 86_400_000).toISOString());
  assertEquals(consentValidUntil(365 * 86400, NOW), new Date(NOW + 180 * 86_400_000).toISOString());
  assertEquals(consentValidUntil(null, NOW), new Date(NOW + 180 * 86_400_000).toISOString());
});

Deno.test("state expires after 30 minutes", () => {
  assert(isStateFresh(new Date(NOW - 5 * 60_000).toISOString(), NOW));
  assert(!isStateFresh(new Date(NOW - STATE_MAX_AGE_MS).toISOString(), NOW));
  assert(!isStateFresh("garbage", NOW));
  assert(!isStateFresh(new Date(NOW + 60 * 60_000).toISOString(), NOW));
});

// ---- transaction parsing and mapping ---------------------------------

const rawTx = (over: Record<string, unknown> = {}) => ({
  entry_reference: "E1", transaction_amount: { amount: "12.50", currency: "EUR" }, credit_debit_indicator: "DBIT",
  status: "BOOK", booking_date: "2026-11-10", value_date: "2026-11-10",
  creditor: { name: "Cactus  Belle Etoile" }, remittance_information: ["Paiement par carte"], ...over,
});
const parsed = (over: Record<string, unknown> = {}): BankTx => parseBankTx(rawTx(over))!;
const OWN_IBAN = "LU280019400644750000";
async function ctx(over: Partial<MapContext> = {}): Promise<MapContext> {
  return {
    uid: "uid-1", key: "k".repeat(16), label: "Spuerkeess",
    ownIbanHashes: new Set([await sha256Hex(OWN_IBAN)]), rules: new Map(), nowISO: NOW_ISO, ...over,
  };
}

Deno.test("only booked, well-formed EUR rows are parsed", () => {
  assertEquals(parseBankTx(rawTx({ status: "PDNG" })), null);
  assertEquals(parseBankTx(rawTx({ credit_debit_indicator: "XXXX" })), null);
  assertEquals(parseBankTx(rawTx({ transaction_amount: { amount: "abc", currency: "EUR" } })), null);
  assertEquals(parseBankTx(rawTx({ transaction_amount: { amount: "5", currency: "USD" } })), null);
  assertEquals(parseBankTx(rawTx({ booking_date: undefined, value_date: "nope" })), null);
  assertEquals(parseBankTx("junk"), null);
  assertEquals(parsed().amount, 12.5);
});

Deno.test("card payment becomes a positive out row at noon UTC with a cleaned merchant", async () => {
  const [row] = await mapBankTxs([parsed()], await ctx());
  assertEquals(
    [row.id, row.at, row.amount, row.kind, row.account, row.source, row.type, row.merchant, row.is_transfer, row.cat, row.cat_locked, row.status],
    [`eb:${"k".repeat(16)}:E1`, "2026-11-10T12:00:00.000Z", 12.5, "out", "Spuerkeess", "bank", "card", "Cactus Belle Etoile", false, null, false, "BOOK"],
  );
});

Deno.test("income uses the debtor; remittance text is the fallback merchant; refunds are card_refund", async () => {
  const [inc] = await mapBankTxs([parsed({ credit_debit_indicator: "CRDT", debtor: { name: "Employer SA" }, creditor: undefined, remittance_information: ["Salaire"] })], await ctx());
  assertEquals([inc.kind, inc.merchant, inc.type, inc.cat], ["in", "Employer SA · Salaire", "other", null]);
  const [text] = await mapBankTxs([parsed({ creditor: undefined, remittance_information: ["Loyer", "novembre"] })], await ctx());
  assertEquals(text.merchant, "Loyer novembre");
  const [refund] = await mapBankTxs([parsed({ credit_debit_indicator: "CRDT", debtor: { name: "Shop" }, creditor: undefined })], await ctx());
  assertEquals(refund.type, "card_refund");
});

Deno.test("merchant is clipped to 180 characters and rules apply", async () => {
  const [long] = await mapBankTxs([parsed({ creditor: { name: "x".repeat(300) } })], await ctx());
  assertEquals(long.merchant.length, 180);
  const [ruled] = await mapBankTxs([parsed()], await ctx({ rules: new Map([["cactus belle etoile", "groceries"]]) }));
  assertEquals(ruled.cat, "groceries");
});

Deno.test("transfer to an own account (IBAN or name) is flagged and categorised", async () => {
  const [byIban] = await mapBankTxs([parsed({ creditor: { name: "Whatever" }, creditor_account: { iban: OWN_IBAN } })], await ctx());
  assertEquals([byIban.type, byIban.is_transfer, byIban.cat], ["transfer_out", true, "transfer"]);
  const [byName] = await mapBankTxs([parsed({ credit_debit_indicator: "CRDT", debtor: { name: "TRADE REPUBLIC BANK" }, creditor: undefined })], await ctx());
  assertEquals([byName.type, byName.is_transfer, byName.cat, byName.kind], ["transfer_in", true, "transfer", "in"]);
  const [other] = await mapBankTxs([parsed({ creditor: { name: "Maxime" }, creditor_account: { iban: "LU000000000000000000" } })], await ctx());
  assertEquals(other.is_transfer, false);
});

Deno.test("ids are stable across syncs: reference first, hash fallback otherwise", async () => {
  const withRef = await mapBankTxs([parsed()], await ctx());
  const again = await mapBankTxs([parsed()], await ctx({ nowISO: "2027-01-01T00:00:00.000Z" }));
  assertEquals(withRef[0].id, again[0].id);
  assertEquals((await mapBankTxs([parsed({ entry_reference: undefined, transaction_id: "T9" })], await ctx()))[0].id, `eb:${"k".repeat(16)}:T9`);
  const bare = { entry_reference: undefined };
  const a = await txRef(parsed(bare));
  assertEquals(a, await txRef(parsed(bare)));
  assert(a.startsWith("h") && a !== await txRef(parsed({ ...bare, transaction_amount: { amount: "12.51", currency: "EUR" } })));
  assertEquals((await mapBankTxs([parsed(bare)], await ctx()))[0].id, (await mapBankTxs([parsed(bare)], await ctx()))[0].id);
});

Deno.test("two identical movements in one response keep distinct ids", async () => {
  const bare = { entry_reference: undefined };
  const rows = await mapBankTxs([parsed(bare), parsed(bare)], await ctx());
  assertEquals(new Set(rows.map((r) => r.id)).size, 2);
});

Deno.test("sync window: first time two years, later last sync minus 7 days", () => {
  assertEquals(syncWindow(null, NOW), { dateFrom: "2024-11-19", strategy: "longest" });
  assertEquals(syncWindow("2026-11-18T05:45:00Z", NOW), { dateFrom: "2026-11-11" });
});

// ---- accounts and notes ----------------------------------------------

Deno.test("main account gets the bare label, others a suffix, known IBANs keep theirs", async () => {
  const accts = [
    { uid: "a", iban: "LU110000000000000001", name: "Sparkonto", currency: "EUR", cashType: "SVGS" },
    { uid: "b", iban: "LU110000000000000002", name: "", currency: "EUR", cashType: "CACC" },
  ];
  const rows = await planAccounts("bcee", accts, [], "2027-01-01T00:00:00.000Z");
  assertEquals(rows.map((r) => r.label), ["Spuerkeess · Sparkonto", "Spuerkeess"]);
  assertEquals(rows[1].iban_last4, "0002");
  assertEquals(rows[1].iban_hash, await sha256Hex("LU110000000000000002"));
  const known = [{ uid: "old", label: "Spuerkeess", iban_hash: await sha256Hex("LU110000000000000001") }];
  const again = await planAccounts("bcee", accts, known, null);
  assertEquals(again.map((r) => r.label), ["Spuerkeess", "Spuerkeess · ••0002"]);
  const bdl = await planAccounts("bdl", [accts[0]], [], null);
  assertEquals(bdl[0].label, "BDL");
});

Deno.test("bank notes: expiring, expired and failed accounts; inactive ones are ignored", () => {
  const day = 86_400_000;
  const acct = (label: string, days: number | null, error: string | null = null, active = true) => ({
    label, active, last_error: error, valid_until: days === null ? null : new Date(NOW + days * day).toISOString(),
  });
  assertEquals(bankNotes([
    acct("A", 30), acct("B", 5), acct("C", -1), acct("D", 30, "Bank 429"), acct("E", 3, null, false),
  ], NOW), [
    { label: "B", problem: "expires", days_left: 5 },
    { label: "C", problem: "expired" },
    { label: "D", problem: "error", error: "Bank 429" },
  ]);
});

Deno.test("session and balance responses are checked", () => {
  const ok = parseSessionResponse({
    session_id: "S", access: { valid_until: "2027-01-01T00:00:00Z" },
    accounts: [{ uid: "u1", account_id: { iban: "lu28 0019 4006 4475 0000" }, name: "Main", currency: "EUR" }, { nouid: 1 }],
  });
  assert("value" in ok);
  if ("value" in ok) {
    assertEquals(ok.value.accounts.length, 1);
    assertEquals(ok.value.accounts[0].iban, "LU280019400644750000");
  }
  assert("error" in parseSessionResponse({ accounts: [] }));
  assertEquals(pickBalance({ balances: [
    { balance_type: "OTHR", balance_amount: { amount: "1", currency: "EUR" } },
    { balance_type: "ITAV", balance_amount: { amount: "50.00" } },
    { balance_type: "CLBD", balance_amount: { amount: "40.25" }, reference_date: "2026-11-18" },
  ] }), { amount: 40.25, at: "2026-11-18T00:00:00.000Z" });
  assertEquals(pickBalance({ balances: [] }), null);
});

// ---- paging with a mock fetch ----------------------------------------

Deno.test("transactions follow the continuation_key with identical other params and forward PSU headers", async () => {
  const { pem } = await testPem();
  const calls: { url: URL; headers: Headers }[] = [];
  const pages: Record<string, unknown> = {
    "": { transactions: [{ n: 1 }, { n: 2 }], continuation_key: "K1" },
    K1: { transactions: [{ n: 3 }], continuation_key: "K2" },
    K2: { transactions: [{ n: 4 }], continuation_key: null },
  };
  const client = createEbClient({
    appId: "app", privateKey: pem, nowMs: () => NOW,
    fetchImpl: (input, init) => {
      const url = new URL(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      return Promise.resolve(new Response(JSON.stringify(pages[url.searchParams.get("continuation_key") ?? ""]), { status: 200 }));
    },
  });
  const all = await fetchAllTransactions(client, "uid/1", { dateFrom: "2024-11-19", strategy: "longest" }, { ip: "1.2.3.4", userAgent: "UA" });
  assertEquals(all.length, 4);
  assertEquals(calls.length, 3);
  for (const call of calls) {
    assertEquals(call.url.pathname, "/accounts/uid%2F1/transactions");
    assertEquals([call.url.searchParams.get("date_from"), call.url.searchParams.get("strategy")], ["2024-11-19", "longest"]);
    assertEquals(call.headers.get("psu-ip-address"), "1.2.3.4");
    assertEquals(call.headers.get("psu-user-agent"), "UA");
    assert(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(call.headers.get("authorization") ?? ""));
  }
  assertEquals(calls.map((c) => c.url.searchParams.get("continuation_key")), [null, "K1", "K2"]);
});

Deno.test("an unattended request sends no PSU headers; errors carry status and code only", async () => {
  const { pem } = await testPem();
  let headers = new Headers();
  const client = createEbClient({
    appId: "app", privateKey: pem,
    fetchImpl: (_u, init) => {
      headers = new Headers(init?.headers);
      return Promise.resolve(new Response(JSON.stringify({ error: "ASPSP_RATE_LIMIT_EXCEEDED", message: "secret detail" }), { status: 429 }));
    },
  });
  const err = await assertRejects(() => client.balances("u"), EbError);
  assertEquals([err.status, err.code], [429, "ASPSP_RATE_LIMIT_EXCEEDED"]);
  assert(!err.message.includes("secret detail"));
  assertEquals(headers.get("psu-ip-address"), null);
});

Deno.test("an endless continuation_key is cut off", async () => {
  const client = { transactionsPage: () => Promise.resolve({ transactions: [], continuation_key: "again" }) };
  await assertRejects(() => fetchAllTransactions(client, "u", { dateFrom: "2026-01-01" }), EbError, "TOO_MANY_PAGES");
});

Deno.test("money from Raoul is not an own transfer (pocket money = income side)", async () => {
  const tx = parsed({
    credit_debit_indicator: "CRDT", creditor: undefined,
    debtor: { name: "M. ET/OU MME RAOUL MULHEIMS - WIWINIUS" }, remittance_information: ["Taeschegeld"],
  });
  const [row] = await mapBankTxs([tx], await ctx());
  assertEquals(row.is_transfer, false);
  assertEquals(row.type, "other");
});

Deno.test("parents paying back the canteen card is tagged parents", async () => {
  const tx = parsed({ credit_debit_indicator: "CRDT", creditor: undefined, debtor: { name: "M. ET/OU MME RAOUL MULHEIMS" }, remittance_information: ["cantineskaart"] });
  const [row] = await mapBankTxs([tx], await ctx());
  assertEquals(row.cat, "parents");
});
