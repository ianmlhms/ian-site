/* Thin Enable Banking client. All I/O goes through an injected fetch so the
 * paging and error handling are unit-tested with a mock. Tokens, session ids
 * and keys are never logged; errors carry only the HTTP status and EB's
 * upper-case error code. */
import { signJwt } from "./bank_jwt.ts";

export const EB_BASE = "https://api.enablebanking.com";
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_PAGES = 60;
const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{1,60}$/;

export type Psu = { ip?: string; userAgent?: string };
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type EbConfig = { appId: string; privateKey: string; fetchImpl?: FetchLike; nowMs?: () => number };

export class EbError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`enable banking ${status}${code ? " " + code : ""}`);
  }
}

type Obj = Record<string, unknown>;
type Query = Record<string, string | undefined>;

export function createEbClient(config: EbConfig) {
  const doFetch: FetchLike = config.fetchImpl ?? fetch;
  const nowMs = config.nowMs ?? Date.now;

  async function request(method: "GET" | "POST", path: string, opts: { query?: Query; body?: Obj; psu?: Psu } = {}): Promise<Obj> {
    const url = new URL(EB_BASE + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
    const headers: Record<string, string> = {
      authorization: `Bearer ${await signJwt(config.appId, config.privateKey, Math.floor(nowMs() / 1000))}`,
      accept: "application/json",
    };
    if (opts.body) headers["content-type"] = "application/json";
    if (opts.psu?.ip) headers["psu-ip-address"] = opts.psu.ip;
    if (opts.psu?.userAgent) headers["psu-user-agent"] = opts.psu.userAgent;
    const response = await doFetch(url.toString(), {
      method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let data: unknown = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
    if (!response.ok) throw new EbError(response.status, errorCode(data));
    if (typeof data !== "object" || data === null || Array.isArray(data)) throw new EbError(502, "BAD_RESPONSE");
    return data as Obj;
  }

  return {
    listAspsps: (country: string) => request("GET", "/aspsps", { query: { country } }),
    startAuth: (body: Obj, psu?: Psu) => request("POST", "/auth", { body, psu }),
    createSession: (code: string, psu?: Psu) => request("POST", "/sessions", { body: { code }, psu }),
    balances: (uid: string, psu?: Psu) => request("GET", `/accounts/${encodeURIComponent(uid)}/balances`, { psu }),
    transactionsPage: (uid: string, query: Query, psu?: Psu) =>
      request("GET", `/accounts/${encodeURIComponent(uid)}/transactions`, { query, psu }),
  };
}
export type EbClient = ReturnType<typeof createEbClient>;

function errorCode(data: unknown): string {
  const code = (data as Obj | null)?.error;
  return typeof code === "string" && ERROR_CODE_RE.test(code) ? code : "";
}

export type TxQuery = { dateFrom: string; dateTo?: string; strategy?: "longest" };

/** Every transaction of the range. The continuation_key is followed with the
 * other parameters unchanged; a bank that never stops paging is cut off. */
export async function fetchAllTransactions(
  client: Pick<EbClient, "transactionsPage">, uid: string, q: TxQuery, psu?: Psu,
): Promise<unknown[]> {
  const base: Query = { date_from: q.dateFrom, date_to: q.dateTo, strategy: q.strategy };
  const all: unknown[] = [];
  let key: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await client.transactionsPage(uid, { ...base, continuation_key: key }, psu);
    if (!Array.isArray(data.transactions)) throw new EbError(502, "BAD_RESPONSE");
    all.push(...data.transactions);
    const next = data.continuation_key;
    if (typeof next !== "string" || !next) return all;
    key = next;
  }
  throw new EbError(502, "TOO_MANY_PAGES");
}
