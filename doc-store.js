import * as auth from "./auth.js?v=17";
import { validateDocument } from "./doc-schema.js?v=1";

const TABLE = "documents";
const AUTOSAVE_DELAY_MS = 1_200;
const MAX_SOURCE_TEXT = 100_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIST_COLUMNS = "id,title,subject,lang,kind,updated_at";
const FULL_COLUMNS = "id,title,subject,lang,kind,source_text,blocks,settings,engine,updated_at";
let database = null;
let activeId = null;
let activeSourceText = "";
let activeEngine = "api";
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
  if (!auth.session()?.user?.id) throw new Error("Mell dech un, fir Dokumenter ze späicheren.");
}

function requireId(id) {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new Error("D'Dokument-ID ass ongëlteg.");
  return id;
}

function engineValue(engine) {
  return engine === "mini" ? "mini" : "api";
}

function rowPayload(document, settings, engine, sourceText) {
  return { title: document.title, subject: document.subject, lang: document.lang, kind: document.kind,
    source_text: (sourceText || "").slice(0, MAX_SOURCE_TEXT) || null,
    blocks: document.blocks.map((block) => ({ ...block })), settings: { ...(settings || {}) },
    engine: engineValue(engine), updated_at: new Date().toISOString() };
}

function storedDocument(row) {
  const document = validateDocument({ version: 1, title: row?.title, subject: row?.subject,
    lang: row?.lang, kind: row?.kind, blocks: row?.blocks });
  return deepFreeze({ id: row.id, document,
    settings: row?.settings && typeof row.settings === "object" ? { ...row.settings } : {},
    sourceText: typeof row.source_text === "string" ? row.source_text : "",
    engine: typeof row.engine === "string" ? row.engine : null, updatedAt: row.updated_at || null });
}

function announceError(error) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent("doc:store-error", {
    detail: Object.freeze({ message: error.message || "Späicherfeeler" }),
  }));
}

export function startNewDocument(sourceText = "", engine = "api") {
  activeId = null;
  activeSourceText = typeof sourceText === "string" ? sourceText : "";
  activeEngine = engineValue(engine);
  cancelAutosave();
}

export async function listDocuments() {
  requireSession();
  const sb = await client();
  const { data, error } = await sb.from(TABLE).select(LIST_COLUMNS).order("updated_at", { ascending: false });
  if (error) throw readableError("D'Lëscht lueden", error);
  return deepFreeze((Array.isArray(data) ? data : []).map((row) => ({ id: row.id,
    title: row.title || "Ouni Titel", subject: row.subject || null, lang: row.lang || "de",
    kind: row.kind || "free", updatedAt: row.updated_at || null })));
}

export async function loadDocument(id) {
  requireSession();
  const sb = await client();
  const { data, error } = await sb.from(TABLE).select(FULL_COLUMNS).eq("id", requireId(id)).single();
  if (error) throw readableError("D'Dokument lueden", error);
  const stored = storedDocument(data);
  activeId = stored.id; activeSourceText = stored.sourceText; activeEngine = engineValue(stored.engine);
  return stored;
}

/* Writes to an EXPLICIT row. Everything this needs is passed in, because the
 * module-level `activeId`/`activeSourceText`/`activeEngine` all move the moment
 * another document is opened — and a save already in flight must still land on
 * the document it was started for. */
async function writeDocument(targetId, document, settings, engine, sourceText) {
  requireSession();
  const safe = validateDocument(document);
  const sb = await client();
  const payload = rowPayload(safe, settings, engine, sourceText);
  const query = targetId ? sb.from(TABLE).update(payload).eq("id", targetId) : sb.from(TABLE).insert(payload);
  const { data, error } = await query.select(FULL_COLUMNS).single();
  if (error) throw readableError("D'Dokument späicheren", error);
  return storedDocument(data);
}

export async function saveDocument(document, settings, engine = activeEngine) {
  activeEngine = engineValue(engine);
  const stored = await writeDocument(activeId, document, settings, activeEngine, activeSourceText);
  activeId = stored.id;
  return stored;
}

export async function deleteDocument(id) {
  requireSession();
  const validId = requireId(id);
  const sb = await client();
  const { error } = await sb.from(TABLE).delete().eq("id", validId);
  if (error) throw readableError("D'Dokument läschen", error);
  if (activeId === validId) startNewDocument();
  return true;
}

export function cancelAutosave() {
  autosaveRevision += 1;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

export function scheduleAutosave(document, settings, onSaved = null, onError = null) {
  cancelAutosave();
  const revision = autosaveRevision;
  /* Bind the row, the text and the engine this save is FOR. Opening another
   * document moves the module-level versions, so without this an autosave
   * scheduled for A and fired after B was opened wrote A's content over B. */
  const targetId = activeId;
  const targetSourceText = activeSourceText;
  const targetEngine = activeEngine;
  autosaveTimer = setTimeout(async () => {
    if (revision !== autosaveRevision) return;
    autosaveTimer = null;
    try {
      const stored = await writeDocument(targetId, document, settings, targetEngine, targetSourceText);
      /* Only adopt the new id if this autosave created the document AND nothing
       * else has been opened in the meantime. */
      if (targetId === null && activeId === null) activeId = stored.id;
      if (typeof onSaved === "function") onSaved(stored);
    } catch (error) {
      const readable = error instanceof Error ? error : new Error("Späicherfeeler");
      announceError(readable);
      if (typeof onError === "function") onError(readable);
    }
  }, AUTOSAVE_DELAY_MS);
}
