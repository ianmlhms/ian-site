const encoder = new TextEncoder();

/** Constant-time string equality. Both sides are hashed first so the loop
 * length is fixed and a length mismatch leaks nothing. Fails closed when the
 * expected secret is empty (i.e. the env var is unset). Same algorithm as
 * secretsMatch in ops/beat.ts. */
export async function secretsMatch(expected: string, given: string | null): Promise<boolean> {
  if (!expected || given === null) return false;
  const [a, b] = await Promise.all([expected, given].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))
  ));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
