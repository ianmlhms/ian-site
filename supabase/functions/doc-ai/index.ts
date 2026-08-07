// Supabase Edge Function: doc-ai — owner-only document generation and rewriting.
import { anthropicDocument } from "./model.ts";
import {
  CORS, cleanString, json, miniIsAlive, ownerFromRequest, queueMiniJob,
  readMiniJob, resolveVoice,
} from "../_shared/studio.ts";

const MAX_IMAGES = 6;
const MAX_INSTRUCTIONS = 30_000;
const MIN_WORDS = 80;
const MAX_WORDS = 5_000;
const MAX_BLOCKS = 200;
const LANGS = new Set(["lb", "de", "en", "fr"]);
const KINDS = new Set(["argumentation", "research", "script", "summary", "review", "steckbrief", "free"]);
const TYPES = new Set(["heading", "paragraph", "bullets", "fields", "quote", "sources", "vocab"]);
const YEARS = new Set(["7e", "6e", "5e", "4e", "3e", "2e", "1ère"]);
const INTENTS = new Set(["rewrite", "shorter", "longer", "simpler", "more-data", "custom"]);
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

type Pair = { label?: string; value?: string; text?: string; accessed?: string };
type ImageBlock = { media_type: string; data: string };

function stringArray(value: unknown, maximum = 100): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item, 4_000)).filter(Boolean).slice(0, maximum);
}

function pairArray(value: unknown, keys: [string, string], maximum = 100): any[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: Pair) => {
    if (!item || typeof item !== "object") return [];
    const first = cleanString((item as any)[keys[0]], 4_000);
    const second = cleanString((item as any)[keys[1]], 500);
    return first || second ? [{ [keys[0]]: first, [keys[1]]: second }] : [];
  }).slice(0, maximum);
}

function stableId(raw: unknown, index: number, used: string[]): string {
  const candidate = cleanString(raw, 40).replace(/[^a-zA-Z0-9_-]/g, "");
  if (candidate && !used.includes(candidate)) return candidate;
  let id = `b${index + 1}`;
  let suffix = 1;
  while (used.includes(id)) { suffix += 1; id = `b${index + 1}-${suffix}`; }
  return id;
}

function normaliseBlock(raw: any, index: number, used: string[]): any | null {
  if (!raw || typeof raw !== "object" || !TYPES.has(raw.type)) return null;
  const id = stableId(raw.id, index, used);
  if (raw.type === "heading") return { id, type: "heading", level: raw.level === 2 ? 2 : 1,
    text: cleanString(raw.text, 8_000) };
  if (raw.type === "paragraph") return { id, type: "paragraph", text: cleanString(raw.text, 20_000) };
  if (raw.type === "bullets" || raw.type === "vocab") return { id, type: raw.type,
    items: stringArray(raw.items) };
  if (raw.type === "fields") return { id, type: "fields", items: pairArray(raw.items, ["label", "value"]) };
  if (raw.type === "sources") return { id, type: "sources", items: pairArray(raw.items, ["text", "accessed"]) };
  return { id, type: "quote", text: cleanString(raw.text, 20_000), source: cleanString(raw.source, 2_000) };
}

function normaliseDocument(raw: any): any | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.blocks)) return null;
  const state = raw.blocks.slice(0, MAX_BLOCKS).reduce((result: any, block: any, index: number) => {
    const next = normaliseBlock(block, index, result.ids);
    return next ? { blocks: [...result.blocks, next], ids: [...result.ids, next.id] } : result;
  }, { blocks: [], ids: [] });
  const title = cleanString(raw.title, 500);
  if (!title || !state.blocks.length) return null;
  return { version: 1, kind: KINDS.has(raw.kind) ? raw.kind : "free", title,
    subject: cleanString(raw.subject, 120) || null, lang: LANGS.has(raw.lang) ? raw.lang : "de",
    blocks: state.blocks };
}

function requestImages(raw: unknown): ImageBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is ImageBlock => typeof item?.media_type === "string"
    && item.media_type.startsWith("image/") && typeof item?.data === "string" && item.data.length > 0)
    .slice(0, MAX_IMAGES);
}

function voiceFields(payload: any, lang: string) {
  const schoolYear = YEARS.has(payload?.schoolYear) ? payload.schoolYear : "4e";
  const raw = Number(payload?.authenticity);
  const authenticity = Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : 75;
  return { schoolYear, authenticity, voice: resolveVoice({ schoolYear, lang, authenticity }) };
}

function outlineRequest(payload: any): any {
  const lang = LANGS.has(payload?.lang) ? payload.lang : "de";
  return { action: "outline", kind: "document", todayISO: new Date().toISOString().slice(0, 10),
    instructions: cleanString(payload?.instructions, MAX_INSTRUCTIONS),
    documentType: KINDS.has(payload?.documentType) ? payload.documentType : "free", lang,
    subject: cleanString(payload?.subject, 120) || null,
    targetWords: Math.min(MAX_WORDS, Math.max(MIN_WORDS, Number(payload?.targetWords) || 500)),
    images: requestImages(payload?.images), ...voiceFields(payload, lang) };
}

function rewriteRequest(payload: any): any | null {
  const document = normaliseDocument(payload?.document);
  if (!document) return null;
  const scope = payload?.scope === "document" ? "document" : "block";
  const target = scope === "block" ? document.blocks.find((block: any) => block.id === payload?.blockId) : null;
  if (scope === "block" && !target) return null;
  const intent = INTENTS.has(payload?.intent) ? payload.intent : "rewrite";
  const custom = intent === "custom" ? cleanString(payload?.custom, 1_200) : "";
  if (intent === "custom" && !custom) return null;
  return { action: "rewrite", kind: "document", scope, document, target, intent, custom,
    targetWords: Math.min(MAX_WORDS, Math.max(MIN_WORDS, Number(payload?.targetWords) || 500)),
    ...voiceFields(payload, document.lang) };
}

function structuralRevisionRequested(instruction: string): boolean {
  const action = "add|ajout|derb[aä]i|insert|remove|delete|ewech|supprim|reorder|r[ée]organis|verr[eé]ck";
  const item = "block|blocks|paragraph|paragraphs|paragraf|paragrafen";
  return new RegExp(`(?:${action})[\\s\\S]{0,32}(?:${item})|(?:${item})[\\s\\S]{0,32}(?:${action})`, "i")
    .test(instruction);
}

function reviseRequest(payload: any): any | null {
  const document = normaliseDocument(payload?.document);
  const instruction = cleanString(payload?.instruction, 1_200);
  if (!document || !instruction) return null;
  return { action: "revise", kind: "document", document, instruction,
    targetWords: Math.min(MAX_WORDS, Math.max(MIN_WORDS, Number(payload?.targetWords) || 500)),
    ...voiceFields(payload, document.lang) };
}

function safeRevision(request: any, raw: any): any | null {
  if (!raw || !Array.isArray(raw.blocks)) return null;
  const before = request.document;
  if (!structuralRevisionRequested(request.instruction)) {
    if (raw.blocks.length !== before.blocks.length) return null;
    if (!before.blocks.every((block: any, index: number) => raw.blocks[index]?.id === block.id)) return null;
  }
  const document = normaliseDocument(raw);
  if (!document || document.kind !== before.kind || document.lang !== before.lang) return null;
  return document;
}

function normaliseResult(request: any, result: any): any | null {
  if (request?.action === "revise") return safeRevision(request, result);
  if (request?.action !== "rewrite" || request.scope === "document") {
    const document = normaliseDocument(result);
    if (!document) return null;
    if (request?.action === "rewrite" && (document.kind !== request.document.kind
      || document.lang !== request.document.lang)) return null;
    return document;
  }
  const block = normaliseBlock(result, 0, []);
  return block ? { ...block, id: request.target.id } : null;
}

async function apiResult(request: any): Promise<Response> {
  try {
    const result = normaliseResult(request, await anthropicDocument(request, API_KEY));
    if (!result) return json({ error: "The model returned JSON that did not match the document schema." }, 502);
    return json({ mode: "api", result, document: request.action === "outline" ? result : undefined });
  } catch (error) {
    console.error(`doc-ai ${request.action}`, (error as Error)?.message);
    return json({ error: `The document could not be generated: ${(error as Error)?.message || "AI error"}.` }, 502);
  }
}

async function routeRequest(request: any, payload: any, userId: string): Promise<Response> {
  const force = payload?.force === "api" || payload?.force === "mini" ? payload.force : null;
  const alive = force === "api" ? false : await miniIsAlive("doc-ai");
  if (force === "mini" && !alive) return json({ error: "The Mac mini is not responding." }, 503);
  if (alive) {
    try { return json({ mode: "mini", jobId: await queueMiniJob(request, userId) }, 202); }
    catch (error) {
      console.error("doc-ai queue", (error as Error)?.message);
      if (force === "mini") return json({ error: "The Mac mini job could not be queued." }, 503);
    }
  }
  return apiResult(request);
}

async function handleOutline(payload: any, userId: string): Promise<Response> {
  const request = outlineRequest(payload);
  if (!request.instructions && !request.images.length) return json({ error: "Add instructions or a source image first." }, 400);
  return routeRequest(request, payload, userId);
}

async function handleRewrite(payload: any, userId: string): Promise<Response> {
  const request = rewriteRequest(payload);
  if (!request) return json({ error: "Invalid rewrite request." }, 400);
  return routeRequest(request, payload, userId);
}

async function handleRevise(payload: any, userId: string): Promise<Response> {
  const request = reviseRequest(payload);
  if (!request) return json({ error: "Invalid document revision request." }, 400);
  return routeRequest(request, payload, userId);
}

async function handleJob(payload: any, userId: string): Promise<Response> {
  return readMiniJob(payload, userId, normaliseResult, {
    stopped: "The Mac mini stopped responding while generating the document.",
    invalid: "The Mac mini returned JSON that did not match the document schema.",
    logPrefix: "doc-ai",
    response: (row, result) => ({ status: row.status, result,
      document: row.request?.action === "outline" ? result : null, error: row.error || null }),
  });
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
  if (payload?.action === "rewrite") return handleRewrite(payload, owner.user!.id);
  if (payload?.action === "revise") return handleRevise(payload, owner.user!.id);
  if (payload?.action === "job") return handleJob(payload, owner.user!.id);
  return json({ error: "Unknown action." }, 400);
});
