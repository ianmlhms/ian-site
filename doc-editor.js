import { blockText, validateDocument, wordCount } from "./doc-schema.js?v=1";
import { deleteBlock, duplicateBlock, editBlockText, insertBlock, moveBlock, retypeBlock } from "./doc-ops.js?v=1";
import { draggable, FLICK_BOUNCE, prefersReducedMotion, project, rubberband, spring } from "./ppt-motion.js?v=3";

const TYPE_LABELS = Object.freeze({ heading: "Iwwerschrëft", paragraph: "Paragraf", bullets: "Punkten",
  fields: "Felder", quote: "Zitat", sources: "Quellen", vocab: "Vocabulaire" });
const INTENT_LABELS = Object.freeze({ shorter: "Méi kuerz", longer: "Méi laang", simpler: "Méi einfach",
  "more-data": "Méi Donnéeën", rewrite: "Nei schreiwen", custom: "Eegen Uweisung" });
const FLICK_SPEED = 700;
const DRAG_SCALE = 1.015;

export function esc(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  }[character]));
}

function typeOptions(selected) {
  return Object.entries(TYPE_LABELS).map(([value, label]) =>
    `<option value="${value}"${value === selected ? " selected" : ""}>${esc(label)}</option>`).join("");
}

function intentOptions() {
  return Object.entries(INTENT_LABELS).map(([value, label]) =>
    `<option value="${value}">${esc(label)}</option>`).join("");
}

function itemList(items, className = "") {
  return `<ul class="${className}">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function visibleBlock(block) {
  if (block.type === "heading") return `<h${block.level + 1}>${esc(block.text)}</h${block.level + 1}>`;
  if (block.type === "paragraph") return `<p>${esc(block.text)}</p>`;
  if (block.type === "bullets") return itemList(block.items);
  if (block.type === "vocab") return itemList(block.items, "vocab-list");
  if (block.type === "fields") return `<ul class="field-list">${block.items.map((item) =>
    `<li><span>- ${esc(item.label)} : </span>${esc(item.value)}</li>`).join("")}</ul>`;
  if (block.type === "sources") return `<ul class="source-list">${block.items.map((item) =>
    `<li>${esc(item.text)}${item.accessed ? ` — ${esc(item.accessed)}` : ""}</li>`).join("")}</ul>`;
  return `<blockquote>${esc(block.text)}${block.source ? `<cite>— ${esc(block.source)}</cite>` : ""}</blockquote>`;
}

function blockMarkup(block, selected) {
  const editor = selected ? `<textarea class="block-inline-editor" data-edit="${esc(block.id)}"
    aria-label="Block änneren">${esc(blockText(block))}</textarea>` : visibleBlock(block);
  return `<section class="doc-block${selected ? " is-selected" : ""}" data-block="${esc(block.id)}" tabindex="0">
    <button class="drag-handle" type="button" data-drag="${esc(block.id)}" aria-label="Block verréckelen">⠿</button>
    ${editor}</section>`;
}

function pageMarkup(document, selectedId) {
  return `<article class="doc-paper" aria-label="Dokumentvirschau">
    <h1 class="doc-title">${esc(document.title)}</h1>
    <div class="doc-body">${document.blocks.map((block) => blockMarkup(block, block.id === selectedId)).join("")}</div>
    <p class="doc-word-count">Words: ${wordCount(document)}</p></article>`;
}

function boundedY(raw, minimum, maximum, dimension) {
  if (raw < minimum) return minimum + rubberband(raw - minimum, dimension);
  if (raw > maximum) return maximum + rubberband(raw - maximum, dimension);
  return raw;
}

function nearest(centres, value) {
  return centres.reduce((best, centre, index) =>
    Math.abs(centre - value) < Math.abs(centres[best] - value) ? index : best, 0);
}

function directDrag(element, y) {
  if (prefersReducedMotion()) { element.style.opacity = "0.72"; return; }
  element.style.transform = `translate3d(0, ${y}px, 0) scale(${DRAG_SCALE})`;
}

class DocumentEditor {
  constructor(options) {
    Object.assign(this, options);
    this.selectedId = null;
    this.dragDisposers = [];
  }

  selectedBlock() {
    const document = this.getDocument();
    return document?.blocks.find((block) => block.id === this.selectedId) || document?.blocks[0] || null;
  }

  render() {
    const document = this.getDocument();
    if (!document) return;
    const safe = validateDocument(document);
    if (this.selectedId && !safe.blocks.some((block) => block.id === this.selectedId)) this.selectedId = null;
    this.host.innerHTML = pageMarkup(safe, this.selectedId);
    this.renderControls();
    this.bindBlocks();
  }

  renderControls() {
    const block = this.selectedBlock();
    this.controls.innerHTML = block ? `<label>Typ<select id="docBlockType">${typeOptions(block.type)}</select></label>
      <button type="button" data-doc-action="add">＋ Block</button>
      <button type="button" data-doc-action="duplicate">Duplizéieren</button>
      <button type="button" data-doc-action="delete">Läschen</button>
      <span class="control-spacer"></span><select id="rewriteIntent" aria-label="AI-Uweisung">${intentOptions()}</select>
      <button type="button" data-doc-action="rewrite">Mat AI änneren</button>` : "";
    if (!block) return;
    this.controls.querySelector("#docBlockType").onchange = (event) =>
      this.change(retypeBlock(this.getDocument(), block.id, event.target.value), { kind: "type" });
    this.controls.querySelectorAll("[data-doc-action]").forEach((button) =>
      button.onclick = () => this.controlAction(button.dataset.docAction, block));
  }

  controlAction(action, block) {
    if (action === "add") this.change(insertBlock(this.getDocument(), block.id), { kind: "insert" });
    if (action === "duplicate") this.change(duplicateBlock(this.getDocument(), block.id), { kind: "duplicate" });
    if (action === "delete") this.change(deleteBlock(this.getDocument(), block.id), { kind: "delete" });
    if (action !== "rewrite") return;
    const intent = this.controls.querySelector("#rewriteIntent").value;
    const custom = intent === "custom" ? prompt("Wéi soll dëse Block geännert ginn?") || "" : "";
    if (intent === "custom" && !custom.trim()) return;
    this.onRewrite?.(block.id, intent, custom);
  }

  bindBlocks() {
    this.dragDisposers.forEach((dispose) => dispose());
    const blocks = [...this.host.querySelectorAll("[data-block]")];
    blocks.forEach((element) => {
      element.onclick = (event) => {
        if (event.target.closest(".drag-handle") || event.target.matches("textarea")) return;
        this.selectedId = element.dataset.block; this.render(); this.focusEditor();
      };
      element.onkeydown = (event) => { if (event.key === "Enter" && !event.target.matches("textarea")) {
        event.preventDefault(); this.selectedId = element.dataset.block; this.render(); this.focusEditor();
      } };
    });
    const editor = this.host.querySelector("[data-edit]");
    if (editor) editor.onblur = () => this.commitEditor(editor);
    this.dragDisposers = blocks.map((element, index) => this.bindDrag(element, index, blocks));
  }

  focusEditor() {
    const editor = this.host.querySelector("[data-edit]");
    if (!editor) return;
    editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length);
  }

  commitEditor(editor) {
    const next = editBlockText(this.getDocument(), editor.dataset.edit, editor.value);
    this.change(next, { kind: "text", slideId: editor.dataset.edit, field: "content" });
  }

  bindDrag(element, from, blocks) {
    const handle = element.querySelector("[data-drag]");
    let centres = [];
    let target = from;
    return draggable(handle, {
      onPress: () => { centres = blocks.map((item) => { const rect = item.getBoundingClientRect(); return rect.top + rect.height / 2; }); },
      onStart: () => element.classList.add("is-dragging"),
      onMove: (data) => {
        const dimension = Math.max(element.offsetHeight, centres.at(-1) - centres[0]);
        const y = boundedY(data.dy, centres[0] - centres[from], centres.at(-1) - centres[from], dimension);
        directDrag(element, y); target = nearest(centres, centres[from] + y + project(data.velocityY));
      },
      onEnd: (data) => this.finishDrag(element, from, target, centres, data.velocityY),
      onCancel: () => { element.classList.remove("is-dragging"); spring(element, { y: 0, scale: 1, opacity: 1 }); },
      onTap: () => { this.selectedId = element.dataset.block; spring(element, { y: 0, scale: 1, opacity: 1 }); this.render(); },
    });
  }

  finishDrag(element, from, target, centres, velocity) {
    element.classList.remove("is-dragging");
    const offset = centres[target] - centres[from];
    const motion = spring(element, { y: offset, scale: 1, opacity: 1 }, {
      bounce: Math.abs(velocity) >= FLICK_SPEED ? FLICK_BOUNCE : 0, velocity,
    });
    motion.finished.then(() => this.change(moveBlock(this.getDocument(), from, target), { kind: "move" })).catch(() => null);
  }

  change(document, meta) {
    this.onChange(document, meta);
  }

  dispose() {
    this.dragDisposers.forEach((dispose) => dispose());
    this.dragDisposers = [];
  }
}

export function createDocumentEditor(options) {
  return new DocumentEditor(options);
}
