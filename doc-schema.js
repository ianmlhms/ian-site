const DOCUMENT_VERSION = 1;
const DEFAULT_LANG = "de";
const DEFAULT_KIND = "free";
const MAX_BLOCKS = 200;
const ALLOWED_LANGS = new Set(["lb", "de", "en", "fr"]);
const ALLOWED_KINDS = new Set(["argumentation", "research", "script", "summary", "review", "steckbrief", "free"]);
const ALLOWED_TYPES = new Set(["heading", "paragraph", "bullets", "fields", "quote", "sources", "vocab"]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function nullableText(value) {
  return text(value) || null;
}

function strings(value, maximum = 100) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean).slice(0, maximum);
}

function pairs(value, first, second, maximum = 100) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const left = text(item[first]);
    const right = text(item[second]);
    return left || right ? [{ [first]: left, [second]: right }] : [];
  }).slice(0, maximum);
}

function stableId(rawId, index, usedIds) {
  const candidate = text(rawId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  if (candidate && !usedIds.includes(candidate)) return candidate;
  let id = `b${index + 1}`;
  let suffix = 1;
  while (usedIds.includes(id)) { suffix += 1; id = `b${index + 1}-${suffix}`; }
  return id;
}

function normaliseBlock(raw, index, usedIds) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !ALLOWED_TYPES.has(raw.type)) return null;
  const id = stableId(raw.id, index, usedIds);
  if (raw.type === "heading") return { id, type: "heading", level: raw.level === 2 ? 2 : 1, text: text(raw.text) };
  if (raw.type === "paragraph") return { id, type: "paragraph", text: text(raw.text) };
  if (raw.type === "bullets" || raw.type === "vocab") return { id, type: raw.type, items: strings(raw.items) };
  if (raw.type === "fields") return { id, type: "fields", items: pairs(raw.items, "label", "value") };
  if (raw.type === "sources") return { id, type: "sources", items: pairs(raw.items, "text", "accessed") };
  return { id, type: "quote", text: text(raw.text), source: text(raw.source) };
}

function sourceDocument(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("D'AI huet keen notzbaart Dokument zeréckginn.");
  }
  if (!Array.isArray(raw.blocks)) throw new Error("D'Dokument enthält keng Bléck.");
  if (raw.blocks.length > MAX_BLOCKS) throw new Error("D'Dokument enthält ze vill Bléck.");
  return raw;
}

/** Lenient boundary validator: fills arrays, drops unknown blocks, then deeply freezes. */
export function validateDocument(raw) {
  const source = sourceDocument(raw);
  const title = text(source.title);
  if (!title) throw new Error("D'Dokument huet keen Titel.");
  const state = source.blocks.reduce((result, block, index) => {
    const next = normaliseBlock(block, index, result.ids);
    return next ? { blocks: [...result.blocks, next], ids: [...result.ids, next.id] } : result;
  }, { blocks: [], ids: [] });
  if (!state.blocks.length) throw new Error("D'Dokument enthält kee benotzbare Block.");
  return deepFreeze({ version: DOCUMENT_VERSION,
    kind: ALLOWED_KINDS.has(source.kind) ? source.kind : DEFAULT_KIND,
    title, subject: nullableText(source.subject),
    lang: ALLOWED_LANGS.has(source.lang) ? source.lang : DEFAULT_LANG,
    blocks: state.blocks });
}

export function blockText(block) {
  if (!block) return "";
  if (block.type === "heading" || block.type === "paragraph") return block.text;
  if (block.type === "bullets" || block.type === "vocab") return block.items.join("\n");
  if (block.type === "fields") return block.items.map((item) => `${item.label} : ${item.value}`).join("\n");
  if (block.type === "sources") return block.items.map((item) =>
    [item.text, item.accessed].filter(Boolean).join(" — ")).join("\n");
  return [block.text, block.source ? `— ${block.source}` : ""].filter(Boolean).join("\n");
}

export function documentText(document, includeCount = false) {
  const safe = validateDocument(document);
  const body = safe.blocks.map((block) => {
    const value = blockText(block);
    if (block.type === "bullets" || block.type === "vocab") return value.split("\n").map((line) => `- ${line}`).join("\n");
    if (block.type === "fields") return value.split("\n").map((line) => `- ${line}`).join("\n");
    return value;
  }).filter(Boolean).join("\n\n");
  const count = wordCount(safe);
  return [safe.title, body, includeCount ? `Words: ${count}` : ""].filter(Boolean).join("\n\n");
}

export function words(value) {
  return String(value || "").match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
}

export function wordCount(document) {
  const safe = validateDocument(document);
  return safe.blocks.reduce((total, block) => total + words(blockText(block)).length, 0);
}

export const DOCUMENT_KINDS = Object.freeze([...ALLOWED_KINDS]);
export const DOCUMENT_TYPES = Object.freeze([...ALLOWED_TYPES]);
