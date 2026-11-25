// Which organisation a network belongs to, from its public register entry (RDAP).
// Pure functions, tested in org_test.ts.

export type Org = { org: string; kind: "company" | "provider"; country: string };

const MAX_NAME = 80;
/* Internet, mobile, hosting and cloud providers: they say nothing about who is visiting. */
const PROVIDER =
  /\b(telecom|telekom|telefon\w*|telco|mobile|mobil|broadband|cable|internet|isp|dsl|adsl|vdsl|fib(er|re)|ftth|dynamic|dyn|pool|dhcp|pppoe|residential|customers?|clients?|subscribers?|hosting|hosted|hoster|server|cloud|datacent(er|re)|data cent(er|re)|colo\w*|vpn|proxy|cdn|akamai|cloudflare|fastly|amazon|aws|google|microsoft|azure|apple|oracle|ovh|hetzner|digitalocean|linode|contabo|ionos|strato|leaseweb|m247|post luxembourg|postgroup|p\s*&\s*t|luxonline|tango|orange|proximus|eltrona|visual online|cegecom|join wireless|free sas|sfr|bouygues|vodafone|unitymedia|o2|1&1|versatel|fastweb|tim|wind tre|iliad|tiscali|swisscom|sunrise|salt|a1|magenta|drei|kpn|ziggo|odido|telenet|voo|starlink|spacex|tailscale|mullvad|nordvpn|proton|private relay)\b/i;
const NETNAME_PROVIDER = /(^|[-_])(dsl|adsl|vdsl|dyn|dynamic|pool|dhcp|ppp|cust|customers|residential|mobile|gprs|lte|ftth|fttx|broadband|infra|backbone)([-_0-9]|$)/i;
const LEGAL =
  /(gmbh|\bag\b|\bkg\b|\bse\b|\bs\.?\s?a\.?\b|s\.?\s?[àa]\.?\s?r\.?\s?l|\bsàrl|\bsarl|\bsas\b|\bsasu\b|\bs\.?p\.?a\b|\bs\.?r\.?l\b|\bltd\b|\blimited\b|\bllc\b|\binc\b|\bcorp|\bbv\b|\bb\.v\.|\bnv\b|\bn\.v\.|\bplc\b|\ba\/s\b|\baps\b|\boy\b|\bhotel|\bresort|\bgroup|\bgruppe|\bbank|\bassurance|\bversicherung|\buniversit|\bschool|\bschule|\blyc[ée]e|\bminist|\bcommune|\bgemeinde|\bstadt|\bville de|\bverein|\basbl|\bfoundation|\bstiftung|\binstitut|\bhospital|\bh[ôo]pital|\bklinik|\bconsult|\bcompany|\bsolutions|\bservices|\bsystems|\btechnolog|\bgovernment|\bparliament|\bcommission|\brestena|\bholding|\bpartners|\badvisor|\blaw|\bavocat|\bmedia|\bverlag|\bairline|\bluxair)/i;
/* "Jean Dupont": a private line may be registered under its owner's own name. Never store that. */
const PERSON = /^\p{Lu}[\p{L}'’.-]+(\s+\p{Lu}[\p{L}'’.-]*){1,3}$/u;

const clean = (value: unknown) =>
  String(value ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);

export function isPublicIp(ip: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (ip.split(".").some((part) => Number(part) > 255)) return false;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168));
  }
  return /^[23][0-9a-f]{3}:[0-9a-f:]+$/i.test(ip);
}

/* Only the network is asked for, not the visitor: the last 3 bits (IPv4, a /29 is the
 * usual company block) or the last 80 bits (IPv6, /48) are dropped before the lookup. */
export function maskIp(ip: string): string {
  if (ip.includes(".") && !ip.includes(":")) {
    const parts = ip.split(".").map(Number);
    return [...parts.slice(0, 3), parts[3] & 0xf8].join(".");
  }
  const [head] = ip.split("::");
  const groups = head.split(":").filter(Boolean).slice(0, 3);
  return `${groups.join(":")}::`;
}

function entityNames(data: Record<string, unknown>): string[] {
  const entities = Array.isArray(data.entities) ? data.entities : [];
  return entities.flatMap((entity) => {
    const card = Array.isArray(entity?.vcardArray?.[1]) ? entity.vcardArray[1] : [];
    const field = (name: string) => card.find((item: unknown[]) => Array.isArray(item) && item[0] === name)?.[3];
    return field("kind") === "org" && Array.isArray(entity.roles) && entity.roles.includes("registrant")
      ? [clean(field("fn"))]
      : [];
  }).filter(Boolean);
}

function remarks(data: Record<string, unknown>): string[] {
  const list = Array.isArray(data.remarks) ? data.remarks : [];
  return list.flatMap((item) => Array.isArray(item?.description) ? item.description : [])
    .map(clean).filter(Boolean);
}

export function orgFromRdap(value: unknown): Org | null {
  if (value === null || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const netname = clean(data.name);
  const country = /^[A-Z]{2}$/.test(String(data.country)) ? String(data.country) : "";
  const type = String(data.type ?? "").toUpperCase();
  const orgs = entityNames(data);
  const notes = remarks(data);
  const provider = (): Org | null => {
    const name = orgs.find((item) => !PERSON.test(item) || LEGAL.test(item) || PROVIDER.test(item)) ?? netname;
    return name ? { org: name, kind: "provider", country } : null;
  };
  // A whole allocation belongs to the provider itself; companies get an assignment out of it.
  const texts = [netname, ...notes, ...orgs];
  if (type.startsWith("ALLOCATED") || type.startsWith("DIRECT ALLOCATION")) {
    const named = orgs.find((item) => LEGAL.test(item) && !PROVIDER.test(item));
    const isProvider = texts.some((text) => PROVIDER.test(text)) || !named;
    return isProvider || !named ? provider() : { org: named, kind: "provider", country };
  }
  if (NETNAME_PROVIDER.test(netname) || texts.some((text) => PROVIDER.test(text))) return provider();
  const candidate = [...orgs, ...notes].find((text) => LEGAL.test(text)) ??
    notes.find((text) => text.length > 2 && !PERSON.test(text) && !/\d{3,}|@|https?:/i.test(text));
  return candidate ? { org: candidate, kind: "company", country } : null;
}
