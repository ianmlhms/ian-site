import * as auth from "./auth.js?v=5";
import { validateDocument } from "./doc-schema.js?v=1";

const DEFAULT_LANG = "de";
const MAX_INSTRUCTIONS = 30_000;
const JOB_POLL_MS = 2_000;
const ALLOWED_LANGS = new Set(["lb", "de", "en", "fr"]);
const DOCUMENT_KINDS = new Set(["argumentation", "research", "script", "summary", "review", "steckbrief", "free"]);
const SCHOOL_YEARS = new Set(["7e", "6e", "5e", "4e", "3e", "2e", "1ère"]);
const REWRITE_INTENTS = new Set(["rewrite", "shorter", "longer", "simpler", "more-data", "custom"]);

function stringValue(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function authenticityValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : 75;
}

function targetWords(value) {
  const number = Number(value);
  return Math.min(5_000, Math.max(80, Number.isFinite(number) ? Math.round(number) : 500));
}

function configuration() {
  const config = window.PB_CONFIG || {};
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(config.url || "") || !config.anonKey) {
    throw new Error("D'Supabase-Konfiguratioun feelt.");
  }
  return config;
}

function voiceSelection(input) {
  return { schoolYear: SCHOOL_YEARS.has(input?.schoolYear) ? input.schoolYear : "4e",
    authenticity: authenticityValue(input?.authenticity) };
}

function outlineRequest(input) {
  const instructions = stringValue(input?.instructions).slice(0, MAX_INSTRUCTIONS);
  const images = Array.isArray(input?.images) ? input.images : [];
  if (!instructions && !images.length) throw new Error("Gëff Instruktiounen oder eng Datei derbäi.");
  const request = { action: "outline", instructions,
    documentType: DOCUMENT_KINDS.has(input?.documentType) ? input.documentType : "free",
    lang: ALLOWED_LANGS.has(input?.lang) ? input.lang : DEFAULT_LANG,
    subject: stringValue(input?.subject).slice(0, 120), targetWords: targetWords(input?.targetWords),
    images: images.filter((image) => typeof image?.media_type === "string" && typeof image?.data === "string").slice(0, 6),
    ...voiceSelection(input) };
  return withForce(request, input?.force);
}

function withForce(request, force) {
  return force === "api" || force === "mini" ? { ...request, force } : request;
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
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function postFunction(config, token, body, signal) {
  let response;
  try {
    response = await fetch(`${config.url.replace(/\/$/, "")}/functions/v1/doc-ai`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", apikey: config.anonKey, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw abortError();
    throw new Error("Netzwierkfeeler — d'Dokument konnt net generéiert ginn.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const fallback = response.status === 403 ? "Dësen Outil ass privat." : "D'AI konnt keen Dokument erstellen.";
    throw new Error(stringValue(data?.error, fallback) || fallback);
  }
  return data;
}

function context() {
  const config = configuration();
  const token = auth.session()?.access_token;
  if (!token) throw new Error("Mell dech fir d'éischt un.");
  return { config, token };
}

function report(callback, details) {
  if (typeof callback !== "function") return;
  try { callback(Object.freeze(details)); }
  catch (error) { console.error("doc-ai progress callback", error); }
}

async function waitForMini(config, token, jobId, options, validate) {
  const startedAt = Date.now();
  while (true) {
    report(options.onProgress, { mode: "mini", status: "waiting", jobId, elapsedMs: Date.now() - startedAt });
    await wait(JOB_POLL_MS, options.signal);
    const data = await postFunction(config, token, { action: "job", jobId }, options.signal);
    if (data?.status === "done") return validate(data.result ?? data.document);
    if (data?.status === "error") throw new Error(stringValue(data.error, "De Mac mini konnt d'Dokument net erstellen."));
    if (data?.status !== "queued" && data?.status !== "running") throw new Error("De Job huet en onbekannte Status.");
  }
}

async function run(request, options, validate) {
  const { config, token } = context();
  const data = await postFunction(config, token, request, options.signal);
  if (data?.mode === "api") return { value: validate(data.result ?? data.document), engine: "api" };
  if (data?.mode !== "mini" || typeof data.jobId !== "string") throw new Error("D'Server-Äntwert huet en onbekannte Modus.");
  return { value: await waitForMini(config, token, data.jobId, options, validate), engine: "mini" };
}

export async function generateDocument(input, options = {}) {
  const result = await run(outlineRequest(input), options, validateDocument);
  return Object.freeze({ document: result.value, engine: result.engine });
}

export async function rewriteDocument(document, blockId, intent, custom, controls, options = {}) {
  const safe = validateDocument(document);
  const resolved = REWRITE_INTENTS.has(intent) ? intent : "rewrite";
  const scope = blockId ? "block" : "document";
  const request = withForce({ action: "rewrite", scope, document: safe, blockId: blockId || null,
    intent: resolved, custom: resolved === "custom" ? stringValue(custom).slice(0, 1_200) : "",
    targetWords: targetWords(controls?.targetWords), ...voiceSelection(controls) }, controls?.force);
  const validate = scope === "document" ? validateDocument : (raw) => {
    const candidate = validateDocument({ ...safe, blocks: [{ ...raw, id: blockId }] });
    return candidate.blocks[0];
  };
  const result = await run(request, options, validate);
  return Object.freeze({ result: result.value, engine: result.engine });
}

function asksForStructure(instruction) {
  const action = "add|ajout|derb[aä]i|insert|remove|delete|ewech|supprim|reorder|r[ée]organis|verr[eé]ck";
  const item = "block|blocks|paragraph|paragraphs|paragraf|paragrafen";
  return new RegExp(`(?:${action})[\\s\\S]{0,32}(?:${item})|(?:${item})[\\s\\S]{0,32}(?:${action})`, "i")
    .test(instruction);
}

function validateRevision(before, raw, instruction) {
  if (!raw || !Array.isArray(raw.blocks)) throw new Error("D'AI huet keng komplett Dokument-Revisioun zeréckginn.");
  if (!asksForStructure(instruction)) {
    if (raw.blocks.length !== before.blocks.length) {
      throw new Error("D'AI huet onerwaart d'Zuel vun de Bléck geännert; d'Revisioun gouf verworf.");
    }
    const sameIds = before.blocks.every((block, index) => raw.blocks[index]?.id === block.id);
    if (!sameIds) throw new Error("D'AI huet onerwaart Block-IDen oder hir Reiefolleg geännert; d'Revisioun gouf verworf.");
  }
  return validateDocument(raw);
}

/** Apply one instruction across the complete document as one undoable result. */
export async function reviseDocument(document, instruction, controls, options = {}) {
  const safe = validateDocument(document);
  const text = stringValue(instruction).slice(0, 1_200);
  if (!text) throw new Error("Gëff eng Uweisung fir dat ganzt Dokument an.");
  const request = withForce({ action: "revise", kind: "document", document: safe,
    instruction: text, targetWords: targetWords(controls?.targetWords),
    ...voiceSelection(controls) }, controls?.force);
  const result = await run(request, options, (raw) => validateRevision(safe, raw, text));
  return Object.freeze({ result: result.value, engine: result.engine });
}

export function createDocumentGeneration(input, options = {}) {
  const controller = new AbortController();
  const mirror = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", mirror, { once: true });
  const promise = generateDocument(input, { ...options, signal: controller.signal })
    .finally(() => options.signal?.removeEventListener("abort", mirror));
  return Object.freeze({ promise, cancel: () => controller.abort(), signal: controller.signal });
}
