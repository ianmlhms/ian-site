// Supabase Edge Function: deck-ai
// Owner-only outline generation and a hardened presentation-photo proxy.
import { createClient } from "npm:@supabase/supabase-js@2";
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8000;
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_IMAGES = 6;
const MAX_INSTRUCTIONS = 30000;
const MIN_SLIDES = 10;
const MAX_SLIDES = 30;
const HARD_MAX_SLIDES = 60;   // absolute sanity bound; MIN/MAX above are only targets
const MIN_PHOTOS = 7;
const MAX_PHOTOS = 18;
const MAX_SEARCH_COUNT = 8;
const HEARTBEAT_MAX_AGE_MS = 90000;
const STUCK_JOB_AGE_MS = 5 * 60 * 1000;
const IAN_EMAILS = new Set(["konto@ian.lu"]);
const LANGS = new Set(["lb", "de", "en", "fr"]);
const LAYOUTS = new Set([
  "title", "toc", "bullets", "bullets-image", "image-full",
  "photo-numbered", "example", "sources", "closing",
]);
const KEYS = {
  anthropic: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
  pexels: Deno.env.get("PEXELS_API_KEY") ?? "",
};
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

type ImageBlock = { media_type: string; data: string };
type Photo = {
  url: string;
  thumb: string;
  credit: string;
  source: "pexels" | "wikimedia";
  link: string;
};
type UpstreamResult = { photos: Photo[]; isClientError: boolean };
type OutlineRequest = { todayISO: string; instructions: string; lang: string;
  subject: string | null; slideCount: number; presenters: string[]; images: ImageBlock[] };

async function userFromRequest(req: Request): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: (data.user.email ?? "").toLowerCase() };
}

const SYSTEM_PROMPT = `You create presentation outlines for Ian, a multilingual school
student in Luxembourg. Return ONLY one JSON object matching the supplied schema. Never
use markdown fences or commentary.

IAN'S DECK SKELETON:
1. Title: big title plus a tagline such as "Ténérife — L'île des vacances". For group
work subtitle/tagline includes "Von <all presenter names>".
2. Table of contents, titled for the requested language: Inhaltsverzeichnis (de),
Contenu (fr), Contents (en), Inhalt (lb).
3. Section content slides: section heading plus telegraphic bullets.
4. Several numbered, captioned photo slides titled like "1 — …", "2 — …".
5. A slide titled "Beispiel:" with a concrete Luxembourg angle wherever possible and
labelled fields such as Ort · Datum · Windgeschwindegkeet · Folgen.
6. Quellen/Sources: every factual URL and photo credit with an access date formatted
like "www.dwd.de — 2. Juni 2025". Ian is meticulous about sourcing. Use the supplied
todayISO as the access date, written out in the deck's language — never invent one.
7. Closing: the natural equivalent of "Vielen Dank fürs Zuhören, habt ihr noch Fragen?"
or "Thanks for listening".

BULLET VOICE IS CRITICAL:
- Telegraphic fragments, articles dropped, one idea per bullet, never paragraphs.
- Use = for is/equals, e.g. "1 Schweizer Franken = 1,01 €" and "Winter = kalt".
- Use → for consequence or flow.
- Use real, verifiable data. German/Luxembourg number style: . for thousands and , for
decimals, e.g. 180.000 Tonnen, 41 290 km², 12,5 %.
- Use "z.b." for German examples. In French put a space before a colon.
- Exactly 3–6 bullets on applicable slides, each usually under 10 words.

BANNED AI TELLS:
- Never use the rigid German Argumentation template, including phrases such as
"Damit dieses Argument funktioniert, muss…" or "Ein bekanntes Beispiel ist…".
- No flawless elevated essay prose and no elegant em-dashes.
- No markdown syntax such as ### or **bold** in any field.

PRESENTERS:
If there is more than one presenter, split content slides into contiguous blocks with
roughly equal talking time, one block per presenter, and set presenter on every slide.
The title subtitle names everyone. With zero or one presenter, presenter is null on
every slide.

EVERY SLIDE:
- notes: actual spoken script, 2–5 sentences in the requested language, warm, sincere,
slightly informal, never essayistic.
- imageQuery: 2–4 English stock-photo keywords. It must be null on TOC, sources and
closing slides.
- Ensure 7–18 slides have imageQuery across the deck. Images should be frequent and
specific, not decorative.

EXACT JSON SCHEMA:
{"version":1,"title":"string","tagline":"string|null","subject":"string|null",
"lang":"lb|de|en|fr","presenters":["string"],"slides":[{"id":"s1",
"layout":"title|toc|bullets|bullets-image|image-full|photo-numbered|example|sources|closing",
"section":"string|null","presenter":"string|null","title":"string","bullets":["string"],
"caption":"string|null","fields":[{"label":"string","value":"string"}],
"sources":[{"text":"string","accessed":"string"}],"imageQuery":"string|null",
"image":null,"notes":"string"}]}`;

function cleanString(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function requestImages(raw: unknown): ImageBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is ImageBlock =>
    typeof item?.media_type === "string" && item.media_type.startsWith("image/") &&
    typeof item?.data === "string" && item.data.length > 0
  ).slice(0, MAX_IMAGES);
}

function balancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let isString = false;
  let isEscaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (isEscaped) { isEscaped = false; continue; }
    if (character === "\\" && isString) { isEscaped = true; continue; }
    if (character === '"') { isString = !isString; continue; }
    if (isString) continue;
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasPairArray(value: unknown, keys: string[]): boolean {
  return Array.isArray(value) && value.every((item) =>
    item && typeof item === "object" && keys.every((key) => typeof (item as Record<string, unknown>)[key] === "string")
  );
}

function isValidSlide(slide: any): boolean {
  if (!slide || typeof slide !== "object" || !LAYOUTS.has(slide.layout)) return false;
  if (typeof slide.id !== "string" || typeof slide.title !== "string") return false;
  if (!isStringArray(slide.bullets) || !hasPairArray(slide.fields, ["label", "value"])) return false;
  if (!hasPairArray(slide.sources, ["text", "accessed"])) return false;
  const nullable = ["section", "presenter", "caption", "imageQuery"];
  if (!nullable.every((key) => slide[key] === null || typeof slide[key] === "string")) return false;
  return slide.image === null && typeof slide.notes === "string";
}

function isValidDeck(deck: any): boolean {
  if (!deck || typeof deck !== "object" || deck.version !== 1) return false;
  if (typeof deck.title !== "string" || !LANGS.has(deck.lang)) return false;
  if (!(deck.tagline === null || typeof deck.tagline === "string")) return false;
  if (!(deck.subject === null || typeof deck.subject === "string")) return false;
  if (!isStringArray(deck.presenters) || !Array.isArray(deck.slides)) return false;
  if (!deck.slides.length || deck.slides.length > HARD_MAX_SLIDES) return false;
  if (!deck.slides.every(isValidSlide)) return false;
  const photoCount = deck.slides.filter((slide: any) => slide.imageQuery).length;
  if (deck.slides.length < MIN_SLIDES || deck.slides.length > MAX_SLIDES) {
    console.warn("deck-ai slide count off target", deck.slides.length);
  }
  if (photoCount < MIN_PHOTOS || photoCount > MAX_PHOTOS) {
    console.warn("deck-ai photo count off target", photoCount);
  }
  return true;
}

function sanitisedOutline(payload: any): OutlineRequest {
  return {
    todayISO: new Date().toISOString().slice(0, 10),
    instructions: cleanString(payload?.instructions, MAX_INSTRUCTIONS),
    lang: LANGS.has(payload?.lang) ? payload.lang : "de",
    subject: cleanString(payload?.subject, 120) || null,
    slideCount: Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, Number(payload?.slideCount) || 12)),
    presenters: isStringArray(payload?.presenters) ? payload.presenters
      .map((name) => cleanString(name, 80)).filter(Boolean) : [],
    images: requestImages(payload?.images),
  };
}

function outlinePrompt(request: OutlineRequest): string {
  const { images: _images, ...prompt } = request;
  return JSON.stringify({ task: "Create the complete deck JSON now.", ...prompt });
}

async function anthropicOutline(request: OutlineRequest): Promise<unknown> {
  if (!KEYS.anthropic) throw new Error("Anthropic key missing");
  const content = [
    ...request.images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } })),
    { type: "text", text: outlinePrompt(request) },
  ];
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEYS.anthropic, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, messages: [{ role: "user", content }] }),
  });
  if (!response.ok) {
    console.error("deck-ai anthropic", response.status, (await response.text()).slice(0, 300));
    throw new Error(`Anthropic returned ${response.status}`);
  }
  const data = await response.json();
  const text = (data?.content ?? []).filter((block: any) => block.type === "text").map((block: any) => block.text).join("");
  const objectText = balancedObject(text);
  if (!objectText) throw new Error("The model did not return a JSON object");
  try { return JSON.parse(objectText); }
  catch { throw new Error("The model returned malformed JSON"); }
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

async function pexelsPhotos(query: string, count: number): Promise<UpstreamResult> {
  if (!KEYS.pexels) return { photos: [], isClientError: false };
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(count));
  url.searchParams.set("orientation", "landscape");
  const response = await timedFetch(url.href, { headers: { Authorization: KEYS.pexels } });
  if (!response.ok) return { photos: [], isClientError: response.status >= 400 && response.status < 500 };
  const data = await response.json();
  const photos = (Array.isArray(data?.photos) ? data.photos : []).flatMap((item: any) => {
    const full = httpUrl(item?.src?.large2x || item?.src?.large);
    const thumb = httpUrl(item?.src?.medium);
    const link = httpUrl(item?.url);
    const author = cleanString(item?.photographer, 160);
    return full && thumb && link && author ? [{ url: full, thumb, link, credit: `Photo: ${author} / Pexels`, source: "pexels" as const }] : [];
  });
  return { photos: photos.slice(0, count), isClientError: false };
}

function plainArtist(value: unknown): string {
  return cleanString(value, 300).replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'") || "Unknown author";
}

async function wikimediaPhotos(query: string, count: number): Promise<UpstreamResult> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  const params = {
    action: "query", format: "json", generator: "search", gsrsearch: query,
    gsrnamespace: "6", gsrlimit: String(count), prop: "imageinfo", iiprop: "url|extmetadata",
    iiurlwidth: "1600", origin: "*",
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await timedFetch(url.href);
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) return { photos: [], isClientError: true };
    throw new Error(`Wikimedia returned ${response.status}`);
  }
  const data = await response.json();
  const pages = Object.values(data?.query?.pages ?? {}) as any[];
  const photos = pages.flatMap((page) => {
    const info = page?.imageinfo?.[0];
    const full = httpUrl(info?.thumburl || info?.url);
    const thumb = httpUrl(info?.thumburl || info?.url);
    const link = httpUrl(info?.descriptionurl);
    if (!full || !thumb || !link) return [];
    const author = plainArtist(info?.extmetadata?.Artist?.value);
    return [{ url: full, thumb, link, credit: `Photo: ${author} / Wikimedia Commons`, source: "wikimedia" as const }];
  });
  return { photos: photos.slice(0, count), isClientError: false };
}

async function photoSearch(query: string, count: number): Promise<Photo[]> {
  try {
    const pexels = await pexelsPhotos(query, count);
    if (pexels.photos.length) return pexels.photos;
  } catch (error) { console.error("deck-ai pexels", (error as Error)?.message); }
  try {
    const commons = await wikimediaPhotos(query, count);
    if (commons.isClientError) return [];
    return commons.photos;
  } catch (error) {
    console.error("deck-ai wikimedia", (error as Error)?.message);
    throw new Error("Photo providers are unavailable");
  }
}

async function miniIsAlive(): Promise<boolean> {
  try {
    const { data, error } = await admin.from("service_heartbeats").select("beat_at")
      .eq("service", "deckworker").maybeSingle();
    if (error || !data?.beat_at) return false;
    const beatAt = Date.parse(data.beat_at);
    return Number.isFinite(beatAt) && beatAt > Date.now() - HEARTBEAT_MAX_AGE_MS;
  } catch (error) {
    console.error("deck-ai heartbeat", (error as Error)?.message);
    return false;
  }
}

async function queueMiniJob(request: OutlineRequest, userId: string): Promise<string> {
  const { data, error } = await admin.from("deck_jobs")
    .insert({ user_id: userId, status: "queued", request }).select("id").single();
  if (error || !data?.id) throw new Error(error?.message || "The job could not be queued");
  return data.id;
}

async function apiOutline(request: OutlineRequest): Promise<Response> {
  try {
    const deck = await anthropicOutline(request);
    if (!isValidDeck(deck)) return json({ error: "The model returned a deck that did not match the required schema." }, 502);
    return json({ mode: "api", deck });
  } catch (error) {
    console.error("deck-ai outline", (error as Error)?.message);
    return json({ error: `The presentation could not be generated: ${(error as Error)?.message || "AI error"}.` }, 502);
  }
}

async function handleOutline(payload: any, userId: string): Promise<Response> {
  const request = sanitisedOutline(payload);
  if (!request.instructions && !request.images.length) {
    return json({ error: "Add instructions or a source image first." }, 400);
  }
  const force = payload?.force === "api" || payload?.force === "mini" ? payload.force : null;
  const alive = force === "api" ? false : await miniIsAlive();
  if (force === "mini" && !alive) return json({ error: "The Mac mini is not responding." }, 503);
  if (alive) {
    try { return json({ mode: "mini", jobId: await queueMiniJob(request, userId) }, 202); }
    catch (error) {
      console.error("deck-ai queue", (error as Error)?.message);
      if (force === "mini") return json({ error: "The Mac mini job could not be queued." }, 503);
    }
  }
  return apiOutline(request);
}

async function handleJob(payload: any, userId: string): Promise<Response> {
  const jobId = cleanString(payload?.jobId, 80);
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "Invalid job id." }, 400);
  const cutoff = new Date(Date.now() - STUCK_JOB_AGE_MS).toISOString();
  const stopped = "The Mac mini stopped responding while generating the presentation.";
  const { error: reclaimError } = await admin.from("deck_jobs")
    .update({ status: "error", error: stopped, updated_at: new Date().toISOString() })
    .eq("id", jobId).eq("user_id", userId).eq("status", "running").lt("updated_at", cutoff);
  if (reclaimError) console.error("deck-ai reclaim", reclaimError.message);
  const { data, error } = await admin.from("deck_jobs").select("status,result,error")
    .eq("id", jobId).eq("user_id", userId).maybeSingle();
  if (error) return json({ error: "The job could not be read." }, 502);
  if (!data) return json({ error: "Job not found." }, 404);
  if (data.status === "done" && !isValidDeck(data.result)) {
    const message = "The Mac mini returned a deck that did not match the required schema.";
    await admin.from("deck_jobs").update({ status: "error", error: message, updated_at: new Date().toISOString() })
      .eq("id", jobId).eq("user_id", userId).eq("status", "done");
    return json({ status: "error", deck: null, error: message });
  }
  return json({ status: data.status, deck: data.status === "done" ? data.result : null, error: data.error || null });
}

async function handleImages(payload: any): Promise<Response> {
  const query = cleanString(payload?.query, 160);
  const count = Math.min(MAX_SEARCH_COUNT, Math.max(1, Number(payload?.count) || 1));
  if (!query) return json({ photos: [] });
  try { return json({ photos: await photoSearch(query, count) }); }
  catch { return json({ error: "Photo search is temporarily unavailable." }, 502); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const user = await userFromRequest(req);
  if (!user) return json({ error: "sign in first" }, 401);
  if (!IAN_EMAILS.has(user.email)) return json({ error: "This tool is private." }, 403);
  let payload: any;
  try { payload = await req.json(); }
  catch { return json({ error: "bad json" }, 400); }
  if (payload?.action === "outline") return handleOutline(payload, user.id);
  if (payload?.action === "job") return handleJob(payload, user.id);
  if (payload?.action === "images") return handleImages(payload);
  return json({ error: "Unknown action." }, 400);
});
