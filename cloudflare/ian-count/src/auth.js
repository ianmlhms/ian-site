// /stats is for Ian only: the caller sends his Supabase access token and the Worker asks Supabase's `is_admin` with it.
// The verdict is cached 5 minutes per SHA-256 of the token (the token itself is never kept or logged).
export const VERDICT_MS = 5 * 60_000;
const MAX_CACHE = 50;
const verdicts = new Map();

async function digest(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function bearer(request) {
  const match = /^Bearer ([A-Za-z0-9._-]{20,4000})$/.exec(request.headers.get('authorization') ?? '');
  return match ? match[1] : '';
}

export async function isAdmin(token, env, fetcher = fetch, now = Date.now()) {
  if (!token) return false;
  const key = await digest(token);
  const cached = verdicts.get(key);
  if (cached && now - cached.at < VERDICT_MS) return cached.ok;
  let ok = false;
  try {
    const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/is_admin`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(4000),
    });
    ok = response.ok && (await response.json()) === true;
  } catch { return false; }                    // Supabase unreachable: no verdict is cached, the next call asks again
  if (verdicts.size >= MAX_CACHE) verdicts.delete(verdicts.keys().next().value);
  verdicts.set(key, { ok, at: now });
  return ok;
}

export const clearVerdicts = () => verdicts.clear();
