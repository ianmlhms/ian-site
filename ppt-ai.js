import * as auth from "./auth.js?v=5";
import { validateDeck, validateSlide } from "./ppt-ai-schema.js?v=5";
export { validateDeck } from "./ppt-ai-schema.js?v=5";

const DEFAULT_LANG = "de";
const MAX_INSTRUCTIONS = 30000;
const JOB_POLL_MS = 2000;
const ALLOWED_LANGS = new Set(["lb", "de", "en", "fr"]);
const SCHOOL_YEARS = new Set(["7e", "6e", "5e", "4e"]);
const SLIDE_INTENTS = new Set(["rewrite", "shorter", "longer", "more-data", "simpler", "custom"]);

function stringValue(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function stringArray(value, maximum = 100) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean).slice(0, maximum);
}

function authenticityValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : 75;
}

function configuration() {
  const config = window.PB_CONFIG || {};
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(config.url || "") || !config.anonKey) {
    throw new Error("D'Supabase-Konfiguratioun feelt.");
  }
  return config;
}

function validatedRequest(input) {
  const instructions = stringValue(input?.instructions).slice(0, MAX_INSTRUCTIONS);
  const images = Array.isArray(input?.images) ? input.images : [];
  if (!instructions && !images.length) throw new Error("Gëff Instruktiounen oder eng Datei derbäi.");
  const request = {
    action: "outline",
    instructions,
    lang: ALLOWED_LANGS.has(input?.lang) ? input.lang : DEFAULT_LANG,
    subject: stringValue(input?.subject).slice(0, 120),
    slideCount: Number.isFinite(Number(input?.slideCount)) ? Number(input.slideCount) : 12,
    presenters: stringArray(input?.presenters, 12),
    schoolYear: SCHOOL_YEARS.has(input?.schoolYear) ? input.schoolYear : "4e",
    authenticity: authenticityValue(input?.authenticity),
    images: images.filter((image) => typeof image?.media_type === "string" && typeof image?.data === "string").slice(0, 6),
  };
  return input?.force === "api" || input?.force === "mini" ? { ...request, force: input.force } : request;
}

function voiceSelection(input) {
  return {
    schoolYear: SCHOOL_YEARS.has(input?.schoolYear) ? input.schoolYear : "4e",
    authenticity: authenticityValue(input?.authenticity),
  };
}

function abortError() {
  const error = new Error("D'Generéierung gouf ofgebrach.");
  error.name = "AbortError";
  return error;
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function postFunction(config, token, body, signal) {
  let response;
  try {
    response = await fetch(`${config.url.replace(/\/$/, "")}/functions/v1/deck-ai`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", apikey: config.anonKey, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw abortError();
    throw new Error("Netzwierkfeeler — d'Präsentatioun konnt net generéiert ginn.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const fallback = response.status === 403 ? "Dësen Outil ass privat." : "D'AI konnt keng Präsentatioun erstellen.";
    throw new Error(stringValue(data?.error, fallback) || fallback);
  }
  return data;
}

function reportProgress(callback, details) {
  if (typeof callback !== "function") return;
  try { callback(Object.freeze(details)); }
  catch (error) { console.error("ppt-ai progress callback", error); }
}

async function waitForMini(config, token, jobId, options, validate) {
  const startedAt = Date.now();
  while (true) {
    reportProgress(options.onProgress, { mode: "mini", status: "waiting", jobId, elapsedMs: Date.now() - startedAt });
    await wait(JOB_POLL_MS, options.signal);
    const data = await postFunction(config, token, { action: "job", jobId }, options.signal);
    if (data?.status === "done") return validate(data.result ?? data.deck);
    if (data?.status === "error") throw new Error(stringValue(data.error, "De Mac mini konnt d'Präsentatioun net erstellen."));
    if (data?.status !== "queued" && data?.status !== "running") throw new Error("De Job huet en onbekannte Status.");
  }
}

/** Generate a deck through the owner-only edge function using the shared auth session. */
export async function generateDeck(input, options = {}) {
  const config = configuration();
  const token = auth.session()?.access_token;
  if (!token) throw new Error("Mell dech fir d'éischt un.");
  const data = await postFunction(config, token, validatedRequest(input), options.signal);
  if (data?.mode === "api") return Object.freeze({ deck: validateDeck(data.result ?? data.deck), engine: "api" });
  if (data?.mode !== "mini" || typeof data.jobId !== "string") {
    throw new Error("D'Server-Äntwert huet en onbekannte Modus.");
  }
  return Object.freeze({ deck: await waitForMini(config, token, data.jobId, options, validateDeck), engine: "mini" });
}

function authContext() {
  const config = configuration();
  const token = auth.session()?.access_token;
  if (!token) throw new Error("Mell dech fir d'éischt un.");
  return { config, token };
}

async function runAction(request, options, validate) {
  const { config, token } = authContext();
  const data = await postFunction(config, token, request, options.signal);
  if (data?.mode === "api") return validate(data.result ?? data.deck ?? data.slide);
  if (data?.mode !== "mini" || typeof data.jobId !== "string") {
    throw new Error("D'Server-Äntwert huet en onbekannte Modus.");
  }
  return waitForMini(config, token, data.jobId, options, validate);
}

function slideContext(deck, index) {
  const target = deck.slides[index];
  if (!target) throw new Error("D'Slide gouf net fonnt.");
  return {
    deck: { title: deck.title, subject: deck.subject, lang: deck.lang },
    section: target.section,
    neighbours: [deck.slides[index - 1]?.title, deck.slides[index + 1]?.title].filter(Boolean),
    target,
  };
}

/** Rewrite exactly one slide; the caller applies it through updateSlide for undo. */
export async function rewriteSlide(deck, index, intent, custom, style, options = {}) {
  const safeDeck = validateDeck(deck);
  const resolvedIntent = SLIDE_INTENTS.has(intent) ? intent : "rewrite";
  const context = slideContext(safeDeck, index);
  const request = { action: "slide", ...context, intent: resolvedIntent,
    custom: resolvedIntent === "custom" ? stringValue(custom).slice(0, 1200) : "",
    ...voiceSelection(style) };
  return runAction(request, options, (raw) => validateSlide(raw, context.target.id));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function translationIsSafe(before, after, targetLang) {
  if (after.lang !== targetLang || before.slides.length !== after.slides.length) return false;
  if (!sameJson(before.presenters, after.presenters)) return false;
  if ((before.tagline === null) !== (after.tagline === null)
    || (before.subject === null) !== (after.subject === null)) return false;
  return before.slides.every((slide, index) => {
    const next = after.slides[index];
    const stable = ["id", "layout", "presenter", "imageQuery"]
      .every((key) => sameJson(slide[key], next[key]));
    const chart = Boolean(slide.chart) === Boolean(next.chart) && (!slide.chart
      || slide.chart.type === next.chart.type
      && sameJson(slide.chart.series.map((series) => series.values), next.chart.series.map((series) => series.values)));
    const quiz = Boolean(slide.quiz) === Boolean(next.quiz)
      && (!slide.quiz || slide.quiz.answerIndex === next.quiz.answerIndex
        && slide.quiz.options.length === next.quiz.options.length);
    const textShape = ["bullets", "fields", "sources"].every((key) => slide[key].length === next[key].length)
      && (slide.section === null) === (next.section === null)
      && (slide.caption === null) === (next.caption === null)
      && (!slide.chart || slide.chart.categories.length === next.chart.categories.length);
    return stable && chart && quiz && textShape && sameJson(slide.image, next.image);
  });
}

/** Translate all words while rejecting any structural or media changes. */
export async function translateDeck(deck, targetLang, style, options = {}) {
  const safeDeck = validateDeck(deck);
  if (!ALLOWED_LANGS.has(targetLang)) throw new Error("D'Zilsprooch ass ongëlteg.");
  const request = { action: "translate", deck: safeDeck, targetLang, ...voiceSelection(style) };
  const translated = await runAction(request, options, validateDeck);
  if (!translationIsSafe(safeDeck, translated, targetLang)) {
    throw new Error("D'Iwwersetzung huet d'Slide-Struktur geännert a gouf verworf.");
  }
  return translated;
}

/** Start a cancellable generation; an optional caller AbortSignal is mirrored. */
export function createDeckGeneration(input, options = {}) {
  const controller = new AbortController();
  const mirrorAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", mirrorAbort, { once: true });
  const promise = generateDeck(input, { ...options, signal: controller.signal });
  const cleanup = () => options.signal?.removeEventListener("abort", mirrorAbort);
  void promise.then(cleanup, cleanup);
  return Object.freeze({ promise, signal: controller.signal, cancel: () => controller.abort() });
}
