const UPSTREAM_TIMEOUT_MS = 8000;

export type Photo = { url: string; thumb: string; credit: string;
  source: "pexels" | "wikimedia"; link: string };
type UpstreamResult = { photos: Photo[]; isClientError: boolean };

function cleanString(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function timedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function httpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : ""; }
  catch { return ""; }
}

async function pexelsPhotos(query: string, count: number, key: string): Promise<UpstreamResult> {
  if (!key) return { photos: [], isClientError: false };
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query); url.searchParams.set("per_page", String(count));
  url.searchParams.set("orientation", "landscape");
  const response = await timedFetch(url.href, { headers: { Authorization: key } });
  if (!response.ok) return { photos: [], isClientError: response.status >= 400 && response.status < 500 };
  const data = await response.json();
  const photos = (Array.isArray(data?.photos) ? data.photos : []).flatMap((item: any) => {
    const full = httpUrl(item?.src?.large2x || item?.src?.large);
    const thumb = httpUrl(item?.src?.medium); const link = httpUrl(item?.url);
    const author = cleanString(item?.photographer, 160);
    return full && thumb && link && author ? [{ url: full, thumb, link,
      credit: `Photo: ${author} / Pexels`, source: "pexels" as const }] : [];
  });
  return { photos: photos.slice(0, count), isClientError: false };
}

function plainArtist(value: unknown): string {
  return cleanString(value, 300).replace(/<[^>]*>/g, "").replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'") || "Unknown author";
}

async function wikimediaPhotos(query: string, count: number): Promise<UpstreamResult> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  const params = { action: "query", format: "json", generator: "search", gsrsearch: query,
    gsrnamespace: "6", gsrlimit: String(count), prop: "imageinfo", iiprop: "url|extmetadata",
    iiurlwidth: "1600", origin: "*" };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await timedFetch(url.href);
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) return { photos: [], isClientError: true };
    throw new Error(`Wikimedia returned ${response.status}`);
  }
  const data = await response.json();
  const pages = Object.values(data?.query?.pages ?? {}) as any[];
  const photos = pages.flatMap((page) => {
    const info = page?.imageinfo?.[0]; const full = httpUrl(info?.thumburl || info?.url);
    const thumb = httpUrl(info?.thumburl || info?.url); const link = httpUrl(info?.descriptionurl);
    if (!full || !thumb || !link) return [];
    const author = plainArtist(info?.extmetadata?.Artist?.value);
    return [{ url: full, thumb, link, credit: `Photo: ${author} / Wikimedia Commons`,
      source: "wikimedia" as const }];
  });
  return { photos: photos.slice(0, count), isClientError: false };
}

export async function photoSearch(query: string, count: number, pexelsKey: string): Promise<Photo[]> {
  try {
    const pexels = await pexelsPhotos(query, count, pexelsKey);
    if (pexels.photos.length) return pexels.photos;
  } catch (error) { console.error("deck-ai pexels", (error as Error)?.message); }
  try {
    const commons = await wikimediaPhotos(query, count);
    return commons.isClientError ? [] : commons.photos;
  } catch (error) {
    console.error("deck-ai wikimedia", (error as Error)?.message);
    throw new Error("Photo providers are unavailable");
  }
}
