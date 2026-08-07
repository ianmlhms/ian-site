// Supabase Edge Function: deck-ai
// Owner-only presentation generation and a hardened presentation-photo proxy.
import { photoSearch } from "./photos.ts";
import { anthropicJson } from "./model.ts";
import {
  CORS, cleanString, json, miniIsAlive, ownerFromRequest, queueMiniJob,
  readMiniJob, resolveVoice,
} from "../_shared/studio.ts";

const MAX_IMAGES = 6;
const MAX_INSTRUCTIONS = 30_000;
const MIN_SLIDES = 10;
const MAX_SLIDES = 30;
const HARD_MAX_SLIDES = 60;
const MIN_PHOTOS = 7;
const MAX_PHOTOS = 18;
const MAX_SEARCH_COUNT = 8;
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

type ImageBlock = { media_type: string; data: string };
type OutlineRequest = { action: "outline"; kind: "deck"; todayISO: string;
  instructions: string; lang: string; subject: string | null; slideCount: number;
  presenters: string[]; images: ImageBlock[]; schoolYear: string; authenticity: number; voice: string };

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
    item && typeof item === "object" && keys.every((key) =>
      typeof (item as Record<string, unknown>)[key] === "string")
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
  warnTargets(deck);
  return true;
}

function warnTargets(deck: any): void {
  const photoCount = deck.slides.filter((slide: any) => slide.imageQuery).length;
  if (deck.slides.length < MIN_SLIDES || deck.slides.length > MAX_SLIDES) {
    console.warn("deck-ai slide count off target", deck.slides.length);
  }
  if (photoCount < MIN_PHOTOS || photoCount > MAX_PHOTOS) {
    console.warn("deck-ai photo count off target", photoCount);
  }
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
  const voice = voiceFields(payload, lang);
  return {
    action: "outline", kind: "deck", todayISO: new Date().toISOString().slice(0, 10),
    instructions: cleanString(payload?.instructions, MAX_INSTRUCTIONS), lang,
    subject: cleanString(payload?.subject, 120) || null,
    slideCount: Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, Number(payload?.slideCount) || 12)),
    presenters: isStringArray(payload?.presenters)
      ? payload.presenters.map((name) => cleanString(name, 80)).filter(Boolean) : [],
    images: requestImages(payload?.images), ...voice,
  };
}

function voiceFields(payload: any, lang: string) {
  const schoolYear = SCHOOL_YEARS.has(payload?.schoolYear) ? payload.schoolYear : "4e";
  const raw = Number(payload?.authenticity);
  const authenticity = Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : 75;
  return { schoolYear, authenticity, voice: resolveVoice({ schoolYear, lang, authenticity }) };
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
  const alive = force === "api" ? false : await miniIsAlive("deck-ai");
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
  return before.slides.every((slide: any, index: number) => safeTranslatedSlide(slide, after.slides[index]));
}

function safeTranslatedSlide(slide: any, next: any): boolean {
  const stable = ["id", "layout", "presenter", "image", "imageQuery"]
    .every((key) => sameJson(slide[key], next[key]));
  const chart = Boolean(slide.chart) === Boolean(next.chart) && (slide.chart == null
    || slide.chart.type === next.chart.type && sameJson(slide.chart.series.map((item: any) => item.values),
      next.chart.series.map((item: any) => item.values)));
  const quiz = Boolean(slide.quiz) === Boolean(next.quiz) && (slide.quiz == null
    || slide.quiz.answerIndex === next.quiz.answerIndex && slide.quiz.options.length === next.quiz.options.length);
  const shape = ["bullets", "fields", "sources"].every((key) => slide[key].length === next[key].length)
    && (slide.section === null) === (next.section === null)
    && (slide.caption === null) === (next.caption === null)
    && (slide.chart == null || slide.chart.categories.length === next.chart.categories.length);
  return stable && chart && quiz && shape;
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
  const request = { action: "translate", kind: "deck", deck, targetLang, ...voiceFields(payload, targetLang) };
  return routeRequest(request, payload, userId,
    (result) => safeTranslation(deck, result, targetLang) ? result : null);
}

function normalisedJobResult(request: any, result: any): any | null {
  if (request?.action === "slide") return preservedSlide(result, request.target);
  if (request?.action === "translate") return safeTranslation(request.deck, result, request.targetLang) ? result : null;
  return normalisedDeckResult(result);
}

async function handleJob(payload: any, userId: string): Promise<Response> {
  return readMiniJob(payload, userId, normalisedJobResult, {
    stopped: "The Mac mini stopped responding while generating the presentation.",
    invalid: "The Mac mini returned JSON that did not match the required schema.",
    logPrefix: "deck-ai",
    response: (row, result) => ({ status: row.status, result,
      deck: !row.request?.action || row.request.action === "outline" ? result : null,
      error: row.error || null }),
  });
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
  const owner = await ownerFromRequest(req);
  if (owner.response) return owner.response;
  let payload: any;
  try { payload = await req.json(); }
  catch { return json({ error: "bad json" }, 400); }
  if (payload?.action === "outline") return handleOutline(payload, owner.user!.id);
  if (payload?.action === "slide") return handleSlide(payload, owner.user!.id);
  if (payload?.action === "translate") return handleTranslate(payload, owner.user!.id);
  if (payload?.action === "job") return handleJob(payload, owner.user!.id);
  if (payload?.action === "images") return handleImages(payload);
  return json({ error: "Unknown action." }, 400);
});
