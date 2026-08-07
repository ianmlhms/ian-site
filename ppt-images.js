import * as auth from "./auth.js?v=5";
import { validateDeck } from "./ppt-ai.js?v=6";

const MAX_CONCURRENCY = 4;
const SEARCH_COUNT = 1;
const PICKER_SEARCH_COUNT = 8;
const MAX_SOURCES_PER_SLIDE = 40;
const EDGE_ACTION = "images";
const PHOTO_SOURCES = new Set(["pexels", "wikimedia"]);
const LANG_LOCALES = Object.freeze({
  lb: "lb-LU",
  de: "de-DE",
  en: "en-GB",
  fr: "fr-FR",
});

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function httpUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : "";
  } catch { return ""; }
}

function configuration() {
  const config = window.PB_CONFIG || {};
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(config.url || "") || !config.anonKey) {
    throw new Error("D'Supabase-Konfiguratioun feelt.");
  }
  return config;
}

function headers(config) {
  const token = auth.session()?.access_token;
  if (!token) throw new Error("Mell dech un, fir Fotoen ze sichen.");
  return {
    "content-type": "application/json",
    apikey: config.anonKey,
    Authorization: `Bearer ${token}`,
  };
}

function validPhoto(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = httpUrl(raw.url);
  const thumb = httpUrl(raw.thumb) || url;
  const link = httpUrl(raw.link) || url;
  const credit = stringValue(raw.credit);
  const source = PHOTO_SOURCES.has(raw.source) ? raw.source : null;
  if (!url || !thumb || !link || !credit || !source) return null;
  return Object.freeze({ url, thumb, credit, source, link });
}

export async function searchPhotos(query, count = PICKER_SEARCH_COUNT) {
  const cleanQuery = stringValue(query);
  const requested = Math.min(PICKER_SEARCH_COUNT, Math.max(1, Number(count) || PICKER_SEARCH_COUNT));
  if (!cleanQuery) throw new Error("Gëff e Sichbegrëff fir d'Foto an.");
  const config = configuration();
  let response;
  try {
    response = await fetch(`${config.url.replace(/\/$/, "")}/functions/v1/deck-ai`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({ action: EDGE_ACTION, query: cleanQuery, count: requested }),
    });
  } catch { throw new Error(`Keng Verbindung fir d'Fotosich: ${cleanQuery}`); }
  if (!response.ok) throw new Error(`Fotosich net disponibel (HTTP ${response.status}).`);
  const data = await response.json().catch(() => null);
  if (!data || !Array.isArray(data.photos)) throw new Error("Ongëlteg Äntwert vun der Fotosich.");
  return Object.freeze(data.photos.map(validPhoto).filter(Boolean));
}

async function searchPhoto(query) {
  const photos = await searchPhotos(query, SEARCH_COUNT);
  return photos[0] || null;
}

function indexedQueries(deck) {
  return deck.slides.flatMap((slide, index) =>
    slide.imageQuery && !slide.image ? [{ index, query: slide.imageQuery }] : []
  );
}

async function searchBatch(batch) {
  return batch.reduce(async (pending, target) => {
    const results = await pending;
    try {
      const photo = await searchPhoto(target.query);
      return [...results, { index: target.index, photo }];
    } catch (error) {
      console.warn("[ppt] Fotosich", error instanceof Error ? error.message : error);
      return [...results, { index: target.index, photo: null }];
    }
  }, Promise.resolve([]));
}

async function concurrentResults(targets) {
  const workerCount = Math.min(MAX_CONCURRENCY, targets.length);
  if (!workerCount) return [];
  const batches = Array.from({ length: workerCount }, (_, workerIndex) =>
    targets.filter((_, index) => index % workerCount === workerIndex)
  );
  return (await Promise.all(batches.map(searchBatch))).flat();
}

function photoMap(results) {
  return new Map(results.filter((result) => result.photo).map((result) => [result.index, result.photo]));
}

function slidesWithPhotos(deck, photos) {
  return deck.slides.map((slide, index) => {
    const photo = photos.get(index);
    return photo ? { ...slide, image: photo } : { ...slide };
  });
}

function accessedDate(lang) {
  const locale = LANG_LOCALES[lang] || LANG_LOCALES.de;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(new Date());
}

function sourceEntry(photo, lang) {
  return {
    text: `${photo.credit} · ${photo.link}`,
    accessed: accessedDate(lang),
  };
}

function uniqueEntries(entries) {
  return entries.filter((entry, index, all) =>
    all.findIndex((candidate) => candidate.text === entry.text) === index
  );
}

function splitSourceSlide(slide, sources) {
  const count = Math.max(1, Math.ceil(sources.length / MAX_SOURCES_PER_SLIDE));
  return Array.from({ length: count }, (_, index) => ({
    ...slide,
    id: index ? `${slide.id}-credits-${index + 1}` : slide.id,
    title: index ? `${slide.title} (${index + 1})` : slide.title,
    sources: sources.slice(index * MAX_SOURCES_PER_SLIDE, (index + 1) * MAX_SOURCES_PER_SLIDE),
  }));
}

function uniqueSlideId(slides, stem) {
  const ids = new Set(slides.map((slide) => slide.id));
  if (!ids.has(stem)) return stem;
  let suffix = 2;
  while (ids.has(`${stem}-${suffix}`)) suffix += 1;
  return `${stem}-${suffix}`;
}

function addSourceSlide(slides, credits) {
  const slide = {
    id: uniqueSlideId(slides, "sources-photos"), layout: "sources", section: null,
    presenter: null, title: "Quellen", bullets: [], caption: null, fields: [],
    sources: credits, imageQuery: null, image: null, notes: "",
  };
  const closingIndex = slides.findIndex((item) => item.layout === "closing");
  const index = closingIndex < 0 ? slides.length : closingIndex;
  return [...slides.slice(0, index), ...splitSourceSlide(slide, credits), ...slides.slice(index)];
}

function appendCredits(slides, lang, removedPhotos = []) {
  const photos = slides.map((slide) => slide.image).filter(Boolean);
  const credits = photos.map((photo) => sourceEntry(photo, lang));
  const managed = [...photos, ...removedPhotos].map((photo) => sourceEntry(photo, lang).text);
  const sourceIndex = slides.findIndex((slide) => slide.layout === "sources");
  const cleaned = slides.map((slide) => slide.layout !== "sources" ? { ...slide } : {
    ...slide, sources: (slide.sources || []).filter((source) => !managed.includes(source.text)),
  });
  if (!credits.length) return cleaned;
  if (sourceIndex < 0) return addSourceSlide(cleaned, credits);
  return cleaned.flatMap((slide, index) => {
    if (index !== sourceIndex) return [{ ...slide }];
    const sources = uniqueEntries([...(slide.sources || []), ...credits]);
    return splitSourceSlide(slide, sources);
  });
}

/** Rebuild managed photo credits after a swap or clear and freeze the new deck. */
export function reconcilePhotoCredits(deck, removedPhotos = []) {
  const safeDeck = validateDeck(deck);
  const removed = Array.isArray(removedPhotos) ? removedPhotos.filter(Boolean) : [];
  return validateDeck({ ...safeDeck, slides: appendCredits(safeDeck.slides, safeDeck.lang, removed) });
}

function notifyCompletion(found, requested) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  const detail = Object.freeze({
    found,
    requested,
    message: found === requested
      ? `${found} Fotoe fonnt.`
      : `${found} vu ${requested} Fotoe fonnt; déi aner Plaze bleiwen eidel.`,
  });
  window.dispatchEvent(new CustomEvent("ppt:images-complete", { detail }));
}

/** Fill image slots and return a wholly new, recursively frozen deck. */
export async function fillDeckImages(deck) {
  const safeDeck = validateDeck(deck);
  const targets = indexedQueries(safeDeck);
  const results = await concurrentResults(targets);
  const photos = photoMap(results);
  const populated = slidesWithPhotos(safeDeck, photos);
  const withCredits = appendCredits(populated, safeDeck.lang);
  notifyCompletion(photos.size, targets.length);
  return validateDeck({ ...safeDeck, slides: withCredits });
}
