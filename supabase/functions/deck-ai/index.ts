// Supabase Edge Function: deck-ai
// Owner-only outline generation and a hardened presentation-photo proxy.
import { createClient } from "npm:@supabase/supabase-js@2";
import { photoSearch } from "./photos.ts";
import { anthropicJson } from "./model.ts";
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
const SCHOOL_YEARS = new Set(["7e", "6e", "5e", "4e"]);
const LAYOUTS = new Set([
  "title", "toc", "bullets", "bullets-image", "image-full",
  "photo-numbered", "example", "sources", "closing", "chart", "quiz", "section",
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
type VoiceSelection = { schoolYear?: unknown; lang?: unknown; authenticity?: unknown };
type OutlineRequest = { action: "outline"; kind: "outline"; todayISO: string;
  instructions: string; lang: string; subject: string | null; slideCount: number;
  presenters: string[]; images: ImageBlock[]; schoolYear: string; authenticity: number; voice: string };

const VOICE_LEVELS = Object.freeze({
  "7e": { lb: "mother tongue", de: "B1", en: "A2–B1", fr: "A2–B1" },
  "6e": { lb: "mother tongue", de: "B1+/B2", en: "B1", fr: "B1" },
  "5e": { lb: "mother tongue", de: "C1", en: "B2", fr: "B2" },
  "4e": { lb: "mother tongue", de: "C1", en: "B2+", fr: "B2+" },
});

/** Resolve trusted selections into model instructions; clients never supply prompt text. */
export function resolveVoice(selection: VoiceSelection): string {
  const schoolYear = SCHOOL_YEARS.has(selection?.schoolYear as string) ? selection.schoolYear as keyof typeof VOICE_LEVELS : "4e";
  const lang = LANGS.has(selection?.lang as string) ? selection.lang as "lb" | "de" | "en" | "fr" : "de";
  const raw = Number(selection?.authenticity);
  const authenticity = Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : 75;
  const level = VOICE_LEVELS[schoolYear][lang];
  const strength = lang === "de" ? "German is Ian's strongest written language."
    : lang === "fr" ? "French is Ian's weakest language; never write above the stated level."
      : lang === "lb" ? "Luxembourgish is native and natural for notes and slide bullets." : "";
  const authentic = "Telegraphic, warm and sincere; z.b. in German, a French-style space before :, an occasional comma splice, and an occasional Luxembourgish word in German are natural. Never manufacture errors.";
  const tone = authenticity >= 85 ? `Use Ian's most authentic, slightly informal voice. ${authentic}`
    : authenticity >= 60 ? `Write mostly like Ian, with light cleanup. ${authentic}`
      : "Use cleaner, more formal phrasing, while staying recognisably Ian and strictly within the stated level; never manufacture errors or become uniformly elevated.";
  return `Write ${lang} at the normal ${schoolYear} level (${level}). ${strength} Authenticity ${authenticity}/100. ${tone} Never output raw markdown or the banned AI templates.`;
}

async function userFromRequest(req: Request): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: (data.user.email ?? "").toLowerCase() };
}

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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasPairArray(value: unknown, keys: string[]): boolean {
  return Array.isArray(value) && value.every((item) =>
    item && typeof item === "object" && keys.every((key) => typeof (item as Record<string, unknown>)[key] === "string")
  );
}

function isValidChart(chart: any): boolean {
  if (!chart || !["bar", "line", "pie"].includes(chart.type)) return false;
  if (typeof chart.title !== "string" || typeof chart.unit !== "string" || !isStringArray(chart.categories)) return false;
  if (chart.type === "pie" && chart.series?.length !== 1) return false;
  return chart.categories.length > 0 && Array.isArray(chart.series) && chart.series.length > 0
    && chart.series.every((series: any) => typeof series?.name === "string"
      && Array.isArray(series.values) && series.values.length === chart.categories.length
      && series.values.every((value: unknown) => typeof value === "number" && Number.isFinite(value)));
}

function isValidQuiz(quiz: any): boolean {
  return quiz && typeof quiz.question === "string" && isStringArray(quiz.options)
    && quiz.options.length >= 3 && quiz.options.length <= 4 && Number.isInteger(quiz.answerIndex)
    && quiz.answerIndex >= 0 && quiz.answerIndex < quiz.options.length;
}

function isValidImage(image: any): boolean {
  return image === null || image && ["url", "thumb", "credit", "source", "link"]
    .every((key) => typeof image[key] === "string");
}

function isValidSlide(slide: any): boolean {
  if (!slide || typeof slide !== "object" || !LAYOUTS.has(slide.layout)) return false;
  if (typeof slide.id !== "string" || typeof slide.title !== "string") return false;
  if (!isStringArray(slide.bullets) || !hasPairArray(slide.fields, ["label", "value"])) return false;
  if (!hasPairArray(slide.sources, ["text", "accessed"])) return false;
  const nullable = ["section", "presenter", "caption", "imageQuery"];
  if (!nullable.every((key) => slide[key] === null || typeof slide[key] === "string")) return false;
  if (slide.layout === "chart" && !isValidChart(slide.chart)) return false;
  if (slide.layout === "quiz" && !isValidQuiz(slide.quiz)) return false;
  if (slide.chart != null && !isValidChart(slide.chart)) return false;
  if (slide.quiz != null && !isValidQuiz(slide.quiz)) return false;
  return isValidImage(slide.image) && typeof slide.notes === "string";
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

function normalisedDeckResult(result: any): any | null {
  if (!result || !Array.isArray(result.slides)) return null;
  const slides = result.slides.map((slide: any) => slide?.layout === "chart" && !isValidChart(slide.chart)
    ? { ...slide, layout: "bullets", chart: null } : slide);
  const deck = { ...result, slides };
  return isValidDeck(deck) ? deck : null;
}

function sanitisedOutline(payload: any): OutlineRequest {
  const lang = LANGS.has(payload?.lang) ? payload.lang : "de";
  const schoolYear = SCHOOL_YEARS.has(payload?.schoolYear) ? payload.schoolYear : "4e";
  const rawAuthenticity = Number(payload?.authenticity);
  const authenticity = Number.isFinite(rawAuthenticity)
    ? Math.min(100, Math.max(0, Math.round(rawAuthenticity))) : 75;
  return {
    action: "outline", kind: "outline",
    todayISO: new Date().toISOString().slice(0, 10),
    instructions: cleanString(payload?.instructions, MAX_INSTRUCTIONS),
    lang,
    subject: cleanString(payload?.subject, 120) || null,
    slideCount: Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, Number(payload?.slideCount) || 12)),
    presenters: isStringArray(payload?.presenters) ? payload.presenters
      .map((name) => cleanString(name, 80)).filter(Boolean) : [],
    images: requestImages(payload?.images),
    schoolYear, authenticity, voice: resolveVoice({ schoolYear, lang, authenticity }),
  };
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

async function queueMiniJob(request: any, userId: string): Promise<string> {
  const { data, error } = await admin.from("deck_jobs")
    .insert({ user_id: userId, status: "queued", request }).select("id").single();
  if (error || !data?.id) throw new Error(error?.message || "The job could not be queued");
  return data.id;
}

async function apiResult(request: any, normalise: (result: any) => unknown | null): Promise<Response> {
  try {
    const result = normalise(await anthropicJson(request, KEYS.anthropic));
    if (!result) return json({ error: "The model returned JSON that did not match the required schema." }, 502);
    return json(request.action === "outline" ? { mode: "api", result, deck: result } : { mode: "api", result });
  } catch (error) {
    console.error(`deck-ai ${request.action}`, (error as Error)?.message);
    return json({ error: `The presentation could not be generated: ${(error as Error)?.message || "AI error"}.` }, 502);
  }
}

async function routeRequest(request: any, payload: any, userId: string,
  normalise: (result: any) => unknown | null): Promise<Response> {
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
  return apiResult(request, normalise);
}

async function handleOutline(payload: any, userId: string): Promise<Response> {
  const request = sanitisedOutline(payload);
  if (!request.instructions && !request.images.length) {
    return json({ error: "Add instructions or a source image first." }, 400);
  }
  return routeRequest(request, payload, userId, normalisedDeckResult);
}

function voiceFields(payload: any, lang: string) {
  const schoolYear = SCHOOL_YEARS.has(payload?.schoolYear) ? payload.schoolYear : "4e";
  const raw = Number(payload?.authenticity);
  const authenticity = Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : 75;
  return { schoolYear, authenticity, voice: resolveVoice({ schoolYear, lang, authenticity }) };
}

function preservedSlide(result: any, target: any): any | null {
  if (!result || typeof result !== "object") return null;
  const safeResult = result.layout === "chart" && !isValidChart(result.chart)
    ? { ...result, layout: "bullets", chart: null } : result;
  const slide = { ...safeResult, id: target.id, presenter: target.presenter,
    image: target.image, imageQuery: target.imageQuery };
  return isValidSlide(slide) ? slide : null;
}

function slideRequest(payload: any): any | null {
  const target = payload?.target;
  const deck = payload?.deck;
  if (!isValidSlide(target) || !deck || typeof deck.title !== "string" || !LANGS.has(deck.lang)) return null;
  const intents = new Set(["rewrite", "shorter", "longer", "more-data", "simpler", "custom"]);
  const intent = intents.has(payload?.intent) ? payload.intent : "rewrite";
  return { action: "slide", kind: "slide", deck: { title: deck.title,
    subject: cleanString(deck.subject, 120) || null, lang: deck.lang },
    section: cleanString(payload?.section, 200) || null,
    neighbours: isStringArray(payload?.neighbours)
      ? payload.neighbours.slice(0, 2).map((item) => cleanString(item, 300)) : [],
    target, intent, custom: intent === "custom" ? cleanString(payload?.custom, 1200) : "",
    ...voiceFields(payload, deck.lang) };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function safeTranslation(before: any, after: any, targetLang: string): boolean {
  if (!isValidDeck(after) || after.lang !== targetLang || before.slides.length !== after.slides.length) return false;
  if (!sameJson(before.presenters, after.presenters)) return false;
  if ((before.tagline === null) !== (after.tagline === null)
    || (before.subject === null) !== (after.subject === null)) return false;
  return before.slides.every((slide: any, index: number) => {
    const next = after.slides[index];
    const stable = ["id", "layout", "presenter", "image", "imageQuery"]
      .every((key) => sameJson(slide[key], next[key]));
    const chart = Boolean(slide.chart) === Boolean(next.chart) && (slide.chart == null
      || slide.chart.type === next.chart.type
      && sameJson(slide.chart.series.map((item: any) => item.values), next.chart.series.map((item: any) => item.values)));
    const quiz = Boolean(slide.quiz) === Boolean(next.quiz)
      && (slide.quiz == null || slide.quiz.answerIndex === next.quiz.answerIndex
        && slide.quiz.options.length === next.quiz.options.length);
    const textShape = ["bullets", "fields", "sources"].every((key) => slide[key].length === next[key].length)
      && (slide.section === null) === (next.section === null)
      && (slide.caption === null) === (next.caption === null)
      && (slide.chart == null || slide.chart.categories.length === next.chart.categories.length);
    return stable && chart && quiz && textShape;
  });
}

async function handleSlide(payload: any, userId: string): Promise<Response> {
  const request = slideRequest(payload);
  if (!request || request.intent === "custom" && !request.custom) return json({ error: "Invalid slide request." }, 400);
  return routeRequest(request, payload, userId, (result) => preservedSlide(result, request.target));
}

async function handleTranslate(payload: any, userId: string): Promise<Response> {
  const deck = payload?.deck;
  const targetLang = LANGS.has(payload?.targetLang) ? payload.targetLang : null;
  if (!isValidDeck(deck) || !targetLang) return json({ error: "Invalid translation request." }, 400);
  const request = { action: "translate", kind: "translate", deck, targetLang,
    ...voiceFields(payload, targetLang) };
  return routeRequest(request, payload, userId,
    (result) => safeTranslation(deck, result, targetLang) ? result : null);
}

function normalisedJobResult(request: any, result: any): any | null {
  if (request?.action === "slide") return preservedSlide(result, request.target);
  if (request?.action === "translate") {
    return safeTranslation(request.deck, result, request.targetLang) ? result : null;
  }
  return normalisedDeckResult(result);
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
  const { data, error } = await admin.from("deck_jobs").select("status,result,error,request")
    .eq("id", jobId).eq("user_id", userId).maybeSingle();
  if (error) return json({ error: "The job could not be read." }, 502);
  if (!data) return json({ error: "Job not found." }, 404);
  const result = data.status === "done" ? normalisedJobResult(data.request, data.result) : null;
  if (data.status === "done" && !result) {
    const message = "The Mac mini returned JSON that did not match the required schema.";
    await admin.from("deck_jobs").update({ status: "error", error: message, updated_at: new Date().toISOString() })
      .eq("id", jobId).eq("user_id", userId).eq("status", "done");
    return json({ status: "error", result: null, error: message });
  }
  const deck = !data.request?.action || data.request.action === "outline" ? result : null;
  return json({ status: data.status, result, deck, error: data.error || null });
}

async function handleImages(payload: any): Promise<Response> {
  const query = cleanString(payload?.query, 160);
  const count = Math.min(MAX_SEARCH_COUNT, Math.max(1, Number(payload?.count) || 1));
  if (!query) return json({ photos: [] });
  try { return json({ photos: await photoSearch(query, count, KEYS.pexels) }); }
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
  if (payload?.action === "slide") return handleSlide(payload, user.id);
  if (payload?.action === "translate") return handleTranslate(payload, user.id);
  if (payload?.action === "job") return handleJob(payload, user.id);
  if (payload?.action === "images") return handleImages(payload);
  return json({ error: "Unknown action." }, 400);
});
