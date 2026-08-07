import { blockText, validateDocument } from "./doc-schema.js?v=1";

const DEFAULTS = Object.freeze({
  heading: Object.freeze({ type: "heading", level: 1, text: "Nei Iwwerschrëft" }),
  paragraph: Object.freeze({ type: "paragraph", text: "Neien Text" }),
  bullets: Object.freeze({ type: "bullets", items: Object.freeze(["Neie Punkt"]) }),
  fields: Object.freeze({ type: "fields", items: Object.freeze([{ label: "Feld", value: "Wäert" }]) }),
  quote: Object.freeze({ type: "quote", text: "Zitat", source: "" }),
  sources: Object.freeze({ type: "sources", items: Object.freeze([{ text: "Quell", accessed: "" }]) }),
  vocab: Object.freeze({ type: "vocab", items: Object.freeze(["Vocabulaire"]) }),
});

function nextId(document, base = "b") {
  const ids = document.blocks.map((block) => block.id);
  let suffix = document.blocks.length + 1;
  let candidate = `${base}${suffix}`;
  while (ids.includes(candidate)) { suffix += 1; candidate = `${base}${suffix}`; }
  return candidate;
}

function withBlocks(document, blocks) {
  return validateDocument({ ...document, blocks });
}

function indexFor(document, blockId) {
  return document.blocks.findIndex((block) => block.id === blockId);
}

function lineItems(value) {
  return String(value || "").split(/\n+/).map((item) => item.replace(/^\s*[-•]\s*/, "").trim()).filter(Boolean);
}

function splitPair(line, separator) {
  const index = line.indexOf(separator);
  if (index < 0) return [line.trim(), ""];
  return [line.slice(0, index).trim(), line.slice(index + separator.length).trim()];
}

function fieldsFromText(value) {
  return lineItems(value).map((line) => {
    const [label, fieldValue] = splitPair(line, " : ");
    return { label, value: fieldValue };
  });
}

function sourcesFromText(value) {
  return lineItems(value).map((line) => {
    const [text, accessed] = splitPair(line, " — ");
    return { text, accessed };
  });
}

function quoteFromText(value) {
  const lines = String(value || "").split("\n");
  const sourceLine = lines.findLast((line) => /^\s*[—-]\s*/.test(line));
  return { text: lines.filter((line) => line !== sourceLine).join("\n").trim(),
    source: sourceLine?.replace(/^\s*[—-]\s*/, "").trim() || "" };
}

function contentForType(type, value, previous = null) {
  if (type === "heading") return { type, level: previous?.level === 2 ? 2 : 1, text: String(value || "").trim() };
  if (type === "paragraph") return { type, text: String(value || "").trim() };
  if (type === "bullets" || type === "vocab") return { type, items: lineItems(value) };
  if (type === "fields") return { type, items: fieldsFromText(value) };
  if (type === "sources") return { type, items: sourcesFromText(value) };
  return { type: "quote", ...quoteFromText(value) };
}

export function updateDocumentMeta(document, patch) {
  const safe = validateDocument(document);
  return validateDocument({ ...safe, ...patch, blocks: safe.blocks });
}

export function updateBlock(document, blockId, patch) {
  const safe = validateDocument(document);
  const index = indexFor(safe, blockId);
  if (index < 0) return safe;
  const blocks = safe.blocks.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch, id: block.id } : block);
  return withBlocks(safe, blocks);
}

export function editBlockText(document, blockId, value) {
  const safe = validateDocument(document);
  const block = safe.blocks.find((item) => item.id === blockId);
  if (!block) return safe;
  return updateBlock(safe, blockId, contentForType(block.type, value, block));
}

export function retypeBlock(document, blockId, type) {
  const safe = validateDocument(document);
  const block = safe.blocks.find((item) => item.id === blockId);
  if (!block || !DEFAULTS[type]) return safe;
  return updateBlock(safe, blockId, contentForType(type, blockText(block), block));
}

export function insertBlock(document, afterId = null, type = "paragraph") {
  const safe = validateDocument(document);
  const template = DEFAULTS[type] || DEFAULTS.paragraph;
  const block = { id: nextId(safe), ...template };
  const index = afterId ? indexFor(safe, afterId) + 1 : safe.blocks.length;
  const target = index > 0 ? index : safe.blocks.length;
  return withBlocks(safe, [...safe.blocks.slice(0, target), block, ...safe.blocks.slice(target)]);
}

export function deleteBlock(document, blockId) {
  const safe = validateDocument(document);
  const remaining = safe.blocks.filter((block) => block.id !== blockId);
  if (remaining.length) return withBlocks(safe, remaining);
  return withBlocks(safe, [{ id: nextId(safe), ...DEFAULTS.paragraph }]);
}

export function duplicateBlock(document, blockId) {
  const safe = validateDocument(document);
  const index = indexFor(safe, blockId);
  if (index < 0) return safe;
  const source = safe.blocks[index];
  const copy = { ...source, id: nextId(safe, `${source.id}-copy-`) };
  return withBlocks(safe, [...safe.blocks.slice(0, index + 1), copy, ...safe.blocks.slice(index + 1)]);
}

export function moveBlock(document, fromIndex, toIndex) {
  const safe = validateDocument(document);
  const from = Math.max(0, Math.min(safe.blocks.length - 1, Number(fromIndex) || 0));
  const to = Math.max(0, Math.min(safe.blocks.length - 1, Number(toIndex) || 0));
  if (from === to) return safe;
  const moving = safe.blocks[from];
  const without = safe.blocks.filter((_, index) => index !== from);
  return withBlocks(safe, [...without.slice(0, to), moving, ...without.slice(to)]);
}

export function replaceBlock(document, blockId, replacement) {
  const safe = validateDocument(document);
  const index = indexFor(safe, blockId);
  if (index < 0 || !replacement || typeof replacement !== "object") return safe;
  const blocks = safe.blocks.map((block, blockIndex) => blockIndex === index
    ? { ...replacement, id: block.id } : block);
  return withBlocks(safe, blocks);
}

export function replaceDocument(document) {
  return validateDocument(document);
}

export const BLOCK_DEFAULTS = DEFAULTS;
