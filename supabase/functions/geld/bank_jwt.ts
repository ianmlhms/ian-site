/* Enable Banking request signing: a short-lived RS256 JWT built with WebCrypto
 * from the application's PKCS#8 private key. Nothing here is logged. */
const encoder = new TextEncoder();
export const JWT_TTL_SECONDS = 3000; // API allows up to 3600 for this app type
const JWT_ISSUER = "enablebanking.com";
const JWT_AUDIENCE = "api.enablebanking.com";
const PEM_PKCS8 = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (value: unknown) => b64url(encoder.encode(JSON.stringify(value)));

/** DER bytes of a PKCS#8 PEM. A secret pasted with literal "\n" is accepted. */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const match = PEM_PKCS8.exec(pem.replace(/\\n/g, "\n"));
  if (!match) throw new Error("EB_PRIVATE_KEY must be a PKCS#8 PEM (BEGIN PRIVATE KEY)");
  const bin = atob(match[1].replace(/\s+/g, ""));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function importKey(pem: string): Promise<CryptoKey> {
  const cached = keyCache.get(pem);
  if (cached) return cached;
  const imported = crypto.subtle.importKey(
    "pkcs8", pemToDer(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  keyCache.set(pem, imported);
  imported.catch(() => keyCache.delete(pem));
  return imported;
}

export type JwtParts = { header: Record<string, string>; claims: Record<string, unknown> };

export function jwtParts(appId: string, nowSec: number): JwtParts {
  return {
    header: { typ: "JWT", alg: "RS256", kid: appId },
    claims: { iss: JWT_ISSUER, aud: JWT_AUDIENCE, iat: nowSec, exp: nowSec + JWT_TTL_SECONDS },
  };
}

export async function signJwt(appId: string, privateKeyPem: string, nowSec: number): Promise<string> {
  const { header, claims } = jwtParts(appId, nowSec);
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const key = await importKey(privateKeyPem);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}
