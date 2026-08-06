import * as auth from "./auth.js?v=5";

const DECK_VERSION = 1;
const DEFAULT_LANG = "de";
const DEFAULT_LAYOUT = "bullets";
const DEFAULT_SLIDE_TITLE = "Ouni Titel";
const MAX_INSTRUCTIONS = 30000;
const JOB_POLL_MS = 2000;
const MIN_SLIDES = 1;
const MAX_SLIDES = 60;
const ALLOWED_LANGS = new Set(["lb", "de", "en", "fr"]);
const ALLOWED_LAYOUTS = new Set([
  "title", "toc", "bullets", "bullets-image", "image-full",
  "photo-numbered", "example", "sources", "closing",
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function stringValue(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function nullableString(value) {
  const text = stringValue(value);
  return text || null;
}

function stringArray(value, maximum = 100) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean).slice(0, maximum);
}

function pairArray(value, first, second, maximum) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const left = stringValue(item[first]);
    const right = stringValue(item[second]);
    if (!left && !right) return [];
    return [{ [first]: left, [second]: right }];
  }).slice(0, maximum);
}

function httpUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : "";
  } catch { return ""; }
}

function normaliseImage(value) {
  if (!value || typeof value !== "object") return null;
  const url = httpUrl(value.url);
  const thumb = httpUrl(value.thumb) || url;
  const link = httpUrl(value.link) || url;
  const credit = stringValue(value.credit);
  const source = value.source === "pexels" || value.source === "wikimedia" ? value.source : null;
  if (!url || !thumb || !link || !credit || !source) return null;
  return { url, thumb, credit, source, link };
}

function stableId(rawId, index, usedIds) {
  const candidate = stringValue(rawId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  if (candidate && !usedIds.includes(candidate)) return candidate;
  let id = `s${index + 1}`;
  let suffix = 1;
  while (usedIds.includes(id)) { suffix += 1; id = `s${index + 1}-${suffix}`; }
  return id;
}

function normaliseSlide(raw, index, usedIds) {
  const source = raw && typeof raw === "object" ? raw : {};
  const id = stableId(source.id, index, usedIds);
  return {
    id,
    layout: ALLOWED_LAYOUTS.has(source.layout) ? source.layout : DEFAULT_LAYOUT,
    section: nullableString(source.section),
    presenter: nullableString(source.presenter),
    title: stringValue(source.title, DEFAULT_SLIDE_TITLE) || DEFAULT_SLIDE_TITLE,
    bullets: stringArray(source.bullets, 12),
    caption: nullableString(source.caption),
    fields: pairArray(source.fields, "label", "value", 10),
    sources: pairArray(source.sources, "text", "accessed", 40),
    imageQuery: nullableString(source.imageQuery),
    image: normaliseImage(source.image),
    notes: stringValue(source.notes),
  };
}

function sourceDeck(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("D'AI huet keng gëlteg Präsentatioun zeréckginn.");
  }
  if (!Array.isArray(raw.slides)) throw new Error("D'AI-Äntwert enthält keng Slides.");
  if (raw.slides.length < MIN_SLIDES) throw new Error("D'AI-Äntwert enthält keng Slide.");
  if (raw.slides.length > MAX_SLIDES) throw new Error("D'AI-Äntwert enthält ze vill Slides.");
  const invalidIndex = raw.slides.findIndex((slide) =>
    !slide || typeof slide !== "object" || Array.isArray(slide) || typeof slide.title !== "string"
  );
  if (invalidIndex >= 0) throw new Error(`Slide ${invalidIndex + 1} ass ongëlteg.`);
  return raw;
}

/** Strict boundary validator that returns a normalised, recursively frozen deck. */
export function validateDeck(raw) {
  const source = sourceDeck(raw);
  const title = stringValue(source.title);
  if (!title) throw new Error("D'Präsentatioun huet keen Titel.");
  const normalised = source.slides.reduce((state, slide, index) => {
    const next = normaliseSlide(slide, index, state.ids);
    return { slides: [...state.slides, next], ids: [...state.ids, next.id] };
  }, { slides: [], ids: [] });
  const deck = {
    version: DECK_VERSION,
    title,
    tagline: nullableString(source.tagline),
    subject: nullableString(source.subject),
    lang: ALLOWED_LANGS.has(source.lang) ? source.lang : DEFAULT_LANG,
    presenters: stringArray(source.presenters, 12),
    slides: normalised.slides,
  };
  return deepFreeze(deck);
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
    images: images.filter((image) => typeof image?.media_type === "string" && typeof image?.data === "string").slice(0, 6),
  };
  return input?.force === "api" || input?.force === "mini" ? { ...request, force: input.force } : request;
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

async function waitForMini(config, token, jobId, options) {
  const startedAt = Date.now();
  while (true) {
    reportProgress(options.onProgress, { mode: "mini", status: "waiting", jobId, elapsedMs: Date.now() - startedAt });
    await wait(JOB_POLL_MS, options.signal);
    const data = await postFunction(config, token, { action: "job", jobId }, options.signal);
    if (data?.status === "done") return validateDeck(data.deck);
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
  if (data?.mode === "api") return Object.freeze({ deck: validateDeck(data.deck), engine: "api" });
  if (data?.mode !== "mini" || typeof data.jobId !== "string") {
    throw new Error("D'Server-Äntwert huet en onbekannte Modus.");
  }
  return Object.freeze({ deck: await waitForMini(config, token, data.jobId, options), engine: "mini" });
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
