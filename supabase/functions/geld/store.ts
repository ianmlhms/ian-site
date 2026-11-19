/* Database access shared by the TR sync and the bank sync: the service-role
 * client, query helpers, merchant rules and the AI categoriser. Moved out of
 * index.ts unchanged so bank.ts can use it too. */
import { createClient } from "npm:@supabase/supabase-js@2";
import { BATCH_SIZE, categoriseBatch } from "./ai.ts";
import { chunk, type ExistingTx } from "./logic.ts";

export const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
export const UPSERT_CHUNK = 500;
const LOOKUP_CHUNK = 200;
const PAGE_SIZE = 1000;
/* Rows sent to the model per sync call, so a first backfill stays well inside
 * the function's time limit; the rest is picked up by the next sync. */
const MAX_AI_ROWS = 480;
const AI_PARALLEL = 3;

export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);


/** Unwrap a supabase-js result or throw with context (details go to the log). */
// deno-lint-ignore no-explicit-any
export function must<T>(result: { data: T | null; error: any }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return (result.data ?? ([] as unknown)) as T;
}

/** All rows of a query, paging past PostgREST's 1000-row cap. */
// deno-lint-ignore no-explicit-any
export async function selectAll<T>(build: () => any, what: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0;; from += PAGE_SIZE) {
    const page = must<T[]>(await build().range(from, from + PAGE_SIZE - 1), what);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function loadRules(): Promise<Map<string, string>> {
  const rows = must<{ merchant_key: string; cat: string }[]>(
    await admin.from("geld_rules").select("merchant_key, cat"), "rules read",
  );
  return new Map(rows.map((r) => [r.merchant_key, r.cat]));
}

export async function loadExisting(ids: string[]): Promise<Map<string, ExistingTx>> {
  const found = new Map<string, ExistingTx>();
  for (const part of chunk(ids, LOOKUP_CHUNK)) {
    const rows = must<ExistingTx[]>(
      await admin.from("geld_tx").select("id, cat, cat_locked, is_transfer").in("id", part), "tx lookup",
    );
    for (const row of rows) found.set(row.id, row);
  }
  return found;
}

type PendingRow = { id: string; merchant: string; amount: number; kind: string; type: string | null; account: string };

/** Ask the model for rows that still have no category and store the answers.
 * A model failure is logged and leaves the rows empty for the next sync. */
export async function categorisePending(): Promise<number> {
  if (!ANTHROPIC_KEY) { console.error("geld: ANTHROPIC_API_KEY unset, skipping categorisation"); return 0; }
  const pending = must<PendingRow[]>(
    await admin.from("geld_tx").select("id, merchant, amount, kind, type, account")
      .is("cat", null).eq("cat_locked", false).eq("is_transfer", false).neq("merchant", "")
      .order("at", { ascending: false }).limit(MAX_AI_ROWS),
    "pending read",
  );
  const batches = chunk(pending, BATCH_SIZE);
  let done = 0;
  for (let i = 0; i < batches.length; i += AI_PARALLEL) {
    const results = await Promise.allSettled(batches.slice(i, i + AI_PARALLEL).map(async (batch) => {
      /* A refund is categorised by its merchant, so the model sees it as money out. */
      const items = batch.map((r) => ({
        id: r.id, note: r.merchant, amount: r.amount, account: r.account,
        kind: r.type === "card_refund" ? "out" : r.kind,
      }));
      return await storeCats(await categoriseBatch(ANTHROPIC_KEY, items));
    }));
    for (const result of results) {
      if (result.status === "fulfilled") done += result.value;
      else console.error("geld: categorise batch failed", result.reason?.message);
    }
  }
  return done;
}

async function storeCats(answers: { id: string; cat: string }[]): Promise<number> {
  const byCat = new Map<string, string[]>();
  for (const a of answers) byCat.set(a.cat, [...(byCat.get(a.cat) ?? []), a.id]);
  let stored = 0;
  for (const [cat, ids] of byCat) {
    must(
      await admin.from("geld_tx").update({ cat, updated_at: new Date().toISOString() })
        .in("id", ids).is("cat", null).eq("cat_locked", false),
      "cat update",
    );
    stored += ids.length;
  }
  return stored;
}

