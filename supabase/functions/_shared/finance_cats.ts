// Shared by finance-ai (money.html) and geld (geld.html): the one spending
// taxonomy, the categoriser prompt and the pure batch helpers around it.
// Keep the slugs in sync with the TAX tables in money.html and geld.js.

export const CATS = [
  "food", "groceries", "transport", "shopping", "subscription",
  "leisure", "health", "education", "income", "investment",
  "dividend", "fees", "cash", "transfer", "other",
];
export const CATSET = new Set(CATS);

export const SYS =
  "You categorise bank-account transactions for a teenager in Luxembourg. " +
  "Each transaction has a free-text note (a merchant name or bank label, often " +
  "in French/German/English), an amount, a direction (in=money received, " +
  "out=money spent) and the account it is on. Assign EXACTLY ONE category slug " +
  "to each, chosen ONLY from this list:\n" +
  "food (restaurants, cafes, fast food, snacks), " +
  "groceries (supermarkets: Cactus, Auchan, Delhaize, Aldi, Lidl…), " +
  "transport (bus, train CFL, fuel, parking, Uber/Bolt, flights), " +
  "shopping (clothes, electronics, Amazon, Zalando, general retail), " +
  "subscription (Spotify, Netflix, iCloud, YouTube, app stores, SaaS), " +
  "leisure (cinema, games, hobbies, sports, entertainment), " +
  "health (pharmacy, doctor, dentist), " +
  "education (school, books, courses), " +
  "income (salary, pocket money/allowance, gifts of money received), " +
  "investment (buying/selling stocks or ETFs), " +
  "dividend (dividends, interest, investment rewards), " +
  "fees (bank/card fees, charges), " +
  "cash (ATM withdrawals, cash), " +
  "transfer (moving money between the person's OWN accounts), " +
  "other (anything that does not clearly fit).\n" +
  "Bank labels often look like 'PAIEMENT VISA <merchant> <city>', " +
  "'DOMICILIATION <company>' or 'Achat <merchant>' — judge by the merchant or " +
  "company name inside the label, not the payment-method words around it. " +
  "Money RECEIVED (in) that pays back a specific purchase named in the note " +
  "(a restaurant, shop, ticket or item, e.g. 'Osteria', 'Leclerc', 'Kino', " +
  "'Brëll', or a merchant refund 'REMBOURSEMENT …') gets the category of that " +
  "purchase (food, groceries, leisure, health…), NOT income: it is a refund. " +
  "Money received with no such purchase (pocket money, 'Taeschegeld', birthday, " +
  "gift, payment for work) is income.\n" +
  "Use 'other' ONLY as a true last resort: an unfamiliar merchant name still " +
  "deserves your best guess from the specific categories above.\n" +
  "Return ONLY minified JSON of the form {\"cats\":[{\"id\":\"<id>\"," +
  "\"cat\":\"<slug>\"}]} with one entry per input id, no prose, no code fences.";

// pull the first {...} JSON object out of a model reply
// deno-lint-ignore no-explicit-any
export function extractJson(s: string): any {
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

export type CatItem = { id: unknown; note?: unknown; amount?: unknown; kind?: unknown; account?: unknown };
export type PreparedBatch = {
  realIds: string[];
  payload: { id: string; note: string; amount: number; dir: string; account: string }[];
};

/** The model sees small positional ids (0,1,2…) instead of the real ids:
 * far fewer output tokens (no truncation) and no chance of a mistyped id. */
export function prepareBatch(items: CatItem[], maxItems: number): PreparedBatch {
  const source = items.filter((it) => it && it.id != null).slice(0, maxItems);
  return {
    realIds: source.map((it) => String(it.id)),
    payload: source.map((it, i) => ({
      id: String(i),
      note: String(it.note ?? "").slice(0, 140),
      amount: Number(it.amount) || 0,
      dir: it.kind === "in" ? "in" : "out",
      account: String(it.account ?? "").slice(0, 40),
    })),
  };
}

/** Map a model reply back to real ids; unknown slugs become "other". */
export function parseCats(reply: string, realIds: string[]): { id: string; cat: string }[] {
  const parsed = extractJson(reply);
  const rows = Array.isArray(parsed?.cats) ? parsed.cats : [];
  if (!rows.length) console.error("categorise: unparseable reply", reply.slice(0, 200));
  const out: { id: string; cat: string }[] = [];
  for (const r of rows) {
    const idx = Number(r?.id);
    if (!Number.isInteger(idx) || idx < 0 || idx >= realIds.length) continue;
    out.push({ id: realIds[idx], cat: CATSET.has(r?.cat) ? r.cat : "other" });
  }
  return out;
}
