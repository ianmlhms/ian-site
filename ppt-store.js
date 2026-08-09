import * as auth from "./auth.js?v=11";
import { validateDeck } from "./ppt-ai.js?v=10";

const TABLE = "decks";
const DEFAULT_ENGINE = "api";
const AUTOSAVE_DELAY_MS = 1200;
const MAX_SOURCE_TEXT = 100000;
const STYLE_META_TAGLINE = "_deckTagline";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIST_COLUMNS = "id,title,subject,lang,presenters,updated_at";
const FULL_COLUMNS = "id,title,subject,lang,presenters,source_text,slides,style,engine,updated_at";

let database = null;
let activeDeckId = null;
let activeSourceText = "";
let activeEngine = DEFAULT_ENGINE;
let autosaveTimer = null;
let autosaveRevision = 0;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function readableError(action, error) {
  const detail = error?.message ? ` ${error.message}` : "";
  return new Error(`${action} ass feelgeschloen.${detail}`);
}

async function client() {
  if (database) return database;
  try { database = await auth.client(); }
  catch (error) { throw readableError("D'Verbindung mat der Datebank", error); }
  return database;
}

function requireSession() {
  if (!auth.session()?.user?.id) throw new Error("Mell dech un, fir Präsentatiounen ze späicheren.");
}

function requireId(id) {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new Error("D'Präsentatiouns-ID ass ongëlteg.");
  return id;
}

function styleValue(style, tagline = null) {
  const source = style && typeof style === "object" && !Array.isArray(style) ? style : {};
  return { ...source, [STYLE_META_TAGLINE]: tagline };
}

function publicStyle(style) {
  if (!style || typeof style !== "object" || Array.isArray(style)) return {};
  return Object.fromEntries(Object.entries(style).filter(([key]) => key !== STYLE_META_TAGLINE));
}

function engineValue(engine) {
  return engine === "mini" ? "mini" : "api";
}

function rowPayload(deck, style, engine) {
  return {
    title: deck.title,
    subject: deck.subject,
    lang: deck.lang,
    presenters: [...deck.presenters],
    source_text: activeSourceText.slice(0, MAX_SOURCE_TEXT) || null,
    slides: deck.slides.map((slide) => ({ ...slide })),
    style: styleValue(style, deck.tagline),
    engine: engineValue(engine),
    updated_at: new Date().toISOString(),
  };
}

function storedDeck(row) {
  const style = row?.style && typeof row.style === "object" ? row.style : {};
  const deck = validateDeck({
    version: 1,
    title: row?.title,
    tagline: style[STYLE_META_TAGLINE] ?? null,
    subject: row?.subject,
    lang: row?.lang,
    presenters: row?.presenters,
    slides: row?.slides,
  });
  return deepFreeze({
    id: row.id,
    deck,
    style: publicStyle(style),
    sourceText: typeof row.source_text === "string" ? row.source_text : "",
    engine: typeof row.engine === "string" ? row.engine : null,
    updatedAt: row.updated_at || null,
  });
}

function announceError(error) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent("ppt:store-error", {
    detail: Object.freeze({ message: error.message || "Späicherfeeler" }),
  }));
}

/** Start an insert workflow and remember the source text for subsequent autosaves. */
export function startNewDeck(sourceText = "", engine = DEFAULT_ENGINE) {
  activeDeckId = null;
  activeSourceText = typeof sourceText === "string" ? sourceText : "";
  activeEngine = engineValue(engine);
  cancelAutosave();
}

export async function listDecks() {
  requireSession();
  const sb = await client();
  const { data, error } = await sb.from(TABLE).select(LIST_COLUMNS).order("updated_at", { ascending: false });
  if (error) throw readableError("D'Lëscht lueden", error);
  const rows = Array.isArray(data) ? data : [];
  return deepFreeze(rows.map((row) => ({
    id: row.id,
    title: row.title || "Ouni Titel",
    subject: row.subject || null,
    lang: row.lang || "de",
    presenters: Array.isArray(row.presenters) ? [...row.presenters] : [],
    updatedAt: row.updated_at || null,
  })));
}

export async function loadDeck(id) {
  requireSession();
  const sb = await client();
  const { data, error } = await sb.from(TABLE).select(FULL_COLUMNS).eq("id", requireId(id)).single();
  if (error) throw readableError("D'Präsentatioun lueden", error);
  const stored = storedDeck(data);
  activeDeckId = stored.id;
  activeSourceText = stored.sourceText;
  activeEngine = engineValue(stored.engine);
  return stored;
}

export async function saveDeck(deck, style, engine = activeEngine) {
  requireSession();
  const safeDeck = validateDeck(deck);
  const sb = await client();
  activeEngine = engineValue(engine);
  const payload = rowPayload(safeDeck, style, activeEngine);
  const query = activeDeckId
    ? sb.from(TABLE).update(payload).eq("id", activeDeckId)
    : sb.from(TABLE).insert(payload);
  const { data, error } = await query.select(FULL_COLUMNS).single();
  if (error) throw readableError("D'Präsentatioun späicheren", error);
  activeDeckId = data.id;
  return storedDeck(data);
}

export async function deleteDeck(id) {
  requireSession();
  const validId = requireId(id);
  const sb = await client();
  const { error } = await sb.from(TABLE).delete().eq("id", validId);
  if (error) throw readableError("D'Präsentatioun läschen", error);
  if (activeDeckId === validId) startNewDeck();
  return true;
}

export function cancelAutosave() {
  autosaveRevision += 1;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

/** Debounce immutable deck snapshots; stale callbacks never save newer-overwritten state. */
export function scheduleAutosave(deck, style, onSaved = null, onError = null) {
  cancelAutosave();
  const revision = autosaveRevision;
  autosaveTimer = setTimeout(async () => {
    if (revision !== autosaveRevision) return;
    autosaveTimer = null;
    try {
      const stored = await saveDeck(deck, style);
      if (typeof onSaved === "function") onSaved(stored);
    } catch (error) {
      const readable = error instanceof Error ? error : new Error("Späicherfeeler");
      announceError(readable);
      if (typeof onError === "function") onError(readable);
    }
  }, AUTOSAVE_DELAY_MS);
}

export const STORE_ENGINE = DEFAULT_ENGINE;
