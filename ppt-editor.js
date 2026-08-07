import { layoutSlide, slideForLayout } from "./ppt-layout.js?v=5";
import { renderSlide, renderThumb, esc } from "./ppt-render-dom.js?v=5";
import { resolveTokens } from "./ppt-style-packs.js?v=6";
import { spring, draggable, project, rubberband, FLICK_BOUNCE, prefersReducedMotion } from "./ppt-motion.js?v=3";
import { moveSlide, insertSlide, duplicateSlide, deleteSlide, updateSlide, setDeckMeta } from "./ppt-deck-ops.js?v=8";
import { reconcilePhotoCredits } from "./ppt-images.js?v=8";
import { openImagePicker } from "./ppt-image-picker.js?v=9";
import { mountSlideControls } from "./ppt-slide-controls.js?v=5";

const SLIDE_WIDTH_PX = 13.333 * 96;
const SLIDE_HEIGHT_PX = 7.5 * 96;
const PREVIEW_PADDING_PX = 24;
const PREVIEW_MAX_SCALE = 0.76;
const FOOTER_START_IN = 7;
const FLICK_THRESHOLD = 350;
const DRAG_SCALE = 1.035;

function filmstripMarkup(deck, selected) {
  const slides = deck.slides.map((slide, index) => `<span class="thumb-wrap">
    <button class="add-slide add-slide--between" type="button" data-insert="${index}" aria-label="Slide derbäisetzen">＋</button>
    <button class="thumb${index === selected ? " is-selected" : ""}" type="button" data-slide="${index}"
      aria-label="Slide ${index + 1}: ${esc(slide.title)}"><span class="thumb-canvas"></span><small>${index + 1}</small></button></span>`).join("");
  return `${slides}<button class="add-slide add-slide--end" type="button" data-insert="${deck.slides.length}">
    <span>＋</span>Slide derbäisetzen</button>`;
}

function matrixX(element) {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none") return 0;
  try { return new DOMMatrixReadOnly(transform).m41; }
  catch { return 0; }
}

function nearestSlot(centres, position) {
  return centres.reduce((best, centre, index) =>
    Math.abs(centre - position) < Math.abs(centres[best] - position) ? index : best, 0);
}

function boundedDrag(raw, minimum, maximum, dimension) {
  if (raw < minimum) return minimum + rubberband(raw - minimum, dimension);
  if (raw > maximum) return maximum + rubberband(raw - maximum, dimension);
  return raw;
}

function partThumbs(thumbs, from, target, distance) {
  thumbs.forEach((thumb, index) => {
    if (index === from) return;
    const left = target > from && index > from && index <= target;
    const right = target < from && index >= target && index < from;
    spring(thumb, { x: left ? -distance : right ? distance : 0, scale: 1, opacity: 1 });
  });
}

function directDrag(element, x) {
  if (prefersReducedMotion()) { element.style.opacity = "0.72"; return; }
  element.style.transform = `translate3d(${x}px, 0, 0) scale(${DRAG_SCALE})`;
}

function unionBoxes(boxes) {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}

function visibleText(layout) {
  return layout.boxes.filter((box) => box.kind === "text" && box.y < FOOTER_START_IN);
}

function takeBox(boxes, text, used) {
  const index = boxes.findIndex((box, boxIndex) => !used.has(boxIndex) && box.text === text);
  if (index < 0) return null;
  used.add(index);
  return boxes[index];
}

function editRegions(deck, slide, layout) {
  const boxes = visibleText(layout);
  const used = new Set();
  const regions = [];
  const title = takeBox(boxes, slide.title, used);
  if (title) regions.push({ key: "title", value: slide.title, box: title });
  if (slide.layout === "title" && deck.tagline != null) {
    const tagline = takeBox(boxes, deck.tagline, used);
    if (tagline) regions.push({ key: "deck:tagline", value: deck.tagline, box: tagline, multiline: true });
  }
  const bullets = boxes.filter((box) => box.bullet);
  bullets.forEach((box) => used.add(boxes.indexOf(box)));
  if (bullets.length) regions.push({ key: "bullets", value: slide.bullets.join("\n"), box: unionBoxes(bullets), multiline: true });
  const caption = slide.caption ? takeBox(boxes, slide.caption, used) : null;
  if (caption) regions.push({ key: "caption", value: slide.caption, box: caption, multiline: true });
  if (slide.quiz) {
    const question = takeBox(boxes, slide.quiz.question, used);
    if (question) regions.push({ key: "quiz:question", value: slide.quiz.question, box: question, multiline: true });
    slide.quiz.options.forEach((option, index) => {
      const box = boxes.find((candidate, boxIndex) => !used.has(boxIndex) && candidate.text.endsWith(option));
      if (!box) return;
      used.add(boxes.indexOf(box));
      regions.push({ key: `quiz:option:${index}`, value: option, box });
    });
  }
  slide.fields.forEach((field, index) => ["label", "value"].forEach((part) => {
    const box = takeBox(boxes, field[part], used);
    if (box) regions.push({ key: `fields:${index}:${part}`, value: field[part], box, multiline: part === "value" });
  }));
  slide.sources.forEach((source, index) => {
    const box = boxes.find((candidate, boxIndex) => !used.has(boxIndex) && candidate.text.startsWith(source.text));
    if (!box) return;
    used.add(boxes.indexOf(box));
    regions.push({ key: `sources:${index}`, value: `${source.text}\n${source.accessed}`, box, multiline: true });
  });
  return regions;
}

function patchForRegion(slide, region, value) {
  if (region.key === "bullets") return { bullets: value.split("\n").map((line) => line.trim()).filter(Boolean) };
  if (region.key === "quiz:question") return { quiz: { ...slide.quiz, question: value } };
  if (region.key.startsWith("quiz:option:")) {
    const index = Number(region.key.split(":")[2]);
    return { quiz: { ...slide.quiz, options: slide.quiz.options.map((option, itemIndex) =>
      itemIndex === index ? value : option) } };
  }
  if (!region.key.includes(":")) return { [region.key]: value };
  const [group, rawIndex, part] = region.key.split(":");
  const index = Number(rawIndex);
  if (group === "fields") return { fields: slide.fields.map((field, itemIndex) =>
    itemIndex === index ? { ...field, [part]: value } : field) };
  const lines = value.split("\n");
  return { sources: slide.sources.map((source, itemIndex) => itemIndex === index
    ? { text: lines[0] || "", accessed: lines.slice(1).join(" ").trim() } : source) };
}

function deckForTextEdit(deck, index, slide, region, value) {
  if (region.key === "deck:tagline") return setDeckMeta(deck, { tagline: value });
  const updated = updateSlide(deck, index, patchForRegion(slide, region, value));
  if (slide.layout === "title" && region.key === "title") {
    return setDeckMeta(updated, { title: updated.slides[index].title });
  }
  return updated;
}

function positionEditor(input, box, scale) {
  Object.assign(input.style, { left: `${box.x * 96 * scale}px`, top: `${box.y * 96 * scale}px`,
    width: `${box.w * 96 * scale}px`, height: `${box.h * 96 * scale}px` });
}

class DeckEditor {
  constructor(config) {
    const { previewHost, filmstrip, controlsHost } = config;
    if (![previewHost, filmstrip, controlsHost].every((item) => item instanceof Element)) {
      throw new Error("Den Designer kann net gestart ginn.");
    }
    Object.assign(this, config);
    this.selected = 0;
    this.dragDisposers = [];
  }

  scale() {
    const width = Math.max(1, this.previewHost.clientWidth - PREVIEW_PADDING_PX * 2);
    const height = Math.max(1, this.previewHost.clientHeight - PREVIEW_PADDING_PX * 2);
    return Math.min(PREVIEW_MAX_SCALE, width / SLIDE_WIDTH_PX, height / SLIDE_HEIGHT_PX);
  }

  change(nextDeck, meta, nextSelected = this.selected) {
    this.selected = Math.max(0, Math.min(nextSelected, nextDeck.slides.length - 1));
    this.onChange(nextDeck, meta, this.selected);
  }

  openEditor(region, scale) {
    const deck = this.getDeck();
    const slide = deck.slides[this.selected];
    const stage = this.previewHost.querySelector(".ppt-dom-stage");
    if (!stage) return;
    const input = document.createElement(region.multiline ? "textarea" : "input");
    input.className = "inline-slide-editor";
    input.value = region.value;
    positionEditor(input, region.box, scale);
    stage.append(input);
    input.focus(); input.select();
    this.bindInlineCommit(input, region, deck, slide);
  }

  bindInlineCommit(input, region, deck, slide) {
    let finished = false;
    const close = (commit) => {
      if (finished) return;
      finished = true;
      if (commit && input.value !== region.value) {
        const meta = { kind: "text", slideId: slide.id, field: region.key };
        this.change(deckForTextEdit(deck, this.selected, slide, region, input.value), meta);
      } else this.renderPreview();
    };
    input.onblur = () => close(true);
    input.onkeydown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(false); }
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); close(true); }
    };
  }

  mountHotspots(stage, slide, layout, scale) {
    editRegions(this.getDeck(), slide, layout).forEach((region) => {
      const hotspot = document.createElement("button");
      hotspot.type = "button";
      hotspot.className = "edit-hotspot";
      hotspot.setAttribute("aria-label", `${region.key} änneren`);
      positionEditor(hotspot, region.box, scale);
      hotspot.onclick = () => this.openEditor(region, scale);
      stage.append(hotspot);
    });
  }

  renderPreview() {
    const deck = this.getDeck();
    if (!deck?.slides.length) return;
    this.selected = Math.min(this.selected, deck.slides.length - 1);
    const slide = deck.slides[this.selected];
    const scale = this.scale();
    const layout = layoutSlide(slideForLayout(deck, slide), resolveTokens(this.getStyle()), this.selected + 1);
    const stage = renderSlide(layout, this.previewHost, scale);
    this.mountHotspots(stage, slide, layout, scale);
    this.mountControls(deck, slide);
  }

  settleDrag(element, thumbs, from, target, centres, velocity) {
    const offset = centres[target] - centres[from];
    const bounce = Math.abs(velocity) >= FLICK_THRESHOLD ? FLICK_BOUNCE : 0;
    const motion = spring(element, { x: offset, scale: 1, opacity: 1 }, { bounce, velocity });
    const spacing = Math.abs(centres[1] - centres[0]) || element.offsetWidth;
    partThumbs(thumbs, from, target, spacing);
    motion.finished.then(() => {
      if (target === from) { this.select(from); return; }
      this.change(moveSlide(this.getDeck(), from, target), { kind: "move" }, target);
    }).catch(() => null);
  }

  dragPosition(data, element, from, centres, baseX) {
    const dimension = Math.max(element.offsetWidth, centres.at(-1) - centres[0]);
    return boundedDrag(baseX + data.dx, centres[0] - centres[from],
      centres.at(-1) - centres[from], dimension);
  }

  bindThumbDrag(element, from, thumbs) {
    let centres = [];
    let baseX = 0;
    let target = from;
    return draggable(element, {
      onPress: () => {
        centres = thumbs.map((thumb) => {
          const rect = thumb.getBoundingClientRect();
          return rect.left + rect.width / 2 - matrixX(thumb);
        });
        baseX = matrixX(element);
        partThumbs(thumbs, from, from, Math.abs(centres[1] - centres[0]) || element.offsetWidth);
      },
      onStart: () => element.classList.add("is-dragging"),
      onMove: (data) => {
        const x = this.dragPosition(data, element, from, centres, baseX);
        directDrag(element, x);
        target = nearestSlot(centres, centres[from] + x + project(data.velocityX));
        this.filmstrip.dataset.dropSlot = String(target);
        partThumbs(thumbs, from, target, Math.abs(centres[1] - centres[0]) || element.offsetWidth);
      },
      onEnd: (data) => {
        const x = this.dragPosition(data, element, from, centres, baseX);
        target = nearestSlot(centres, centres[from] + x + project(data.velocityX));
        element.classList.remove("is-dragging"); delete this.filmstrip.dataset.dropSlot;
        this.settleDrag(element, thumbs, from, target, centres, data.velocityX);
      },
      onCancel: () => this.cancelDrag(element, thumbs, from),
      onTap: () => { spring(element, { x: 0, scale: 1, opacity: 1 }); this.select(from); },
    });
  }

  cancelDrag(element, thumbs, from) {
    element.classList.remove("is-dragging");
    delete this.filmstrip.dataset.dropSlot;
    spring(element, { x: 0, scale: 1, opacity: 1 });
    partThumbs(thumbs, from, from, element.offsetWidth);
  }

  bindFilmstrip() {
    this.dragDisposers.forEach((dispose) => dispose());
    const thumbs = [...this.filmstrip.querySelectorAll("[data-slide]")];
    this.dragDisposers = thumbs.map((thumb, index) => this.bindThumbDrag(thumb, index, thumbs));
    thumbs.forEach((thumb, index) => thumb.onkeydown = (event) => this.keyboardMove(event, index, thumbs.length));
    this.filmstrip.querySelectorAll("[data-insert]").forEach((button) => button.onclick = () => {
      const index = Number(button.dataset.insert);
      this.change(insertSlide(this.getDeck(), index, "bullets"), { kind: "insert" }, index);
    });
  }

  keyboardMove(event, index, count) {
    const modifier = event.metaKey || event.ctrlKey || event.altKey;
    if (!modifier || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -1 : 1;
    const target = Math.max(0, Math.min(count - 1, index + delta));
    if (target !== index) this.change(moveSlide(this.getDeck(), index, target), { kind: "move" }, target);
  }

  renderFilmstrip() {
    const deck = this.getDeck();
    this.filmstrip.innerHTML = filmstripMarkup(deck, this.selected);
    this.filmstrip.querySelectorAll("[data-slide]").forEach((button) => {
      const index = Number(button.dataset.slide);
      const slide = slideForLayout(deck, deck.slides[index]);
      const layout = layoutSlide(slide, resolveTokens(this.getStyle()), index + 1);
      renderThumb(layout, button.querySelector(".thumb-canvas"));
    });
    this.bindFilmstrip();
  }

  editNotes() {
    const region = { key: "notes", value: this.getDeck().slides[this.selected].notes,
      box: { x: 1, y: 1.4, w: 11.3, h: 4.8 }, multiline: true };
    this.openEditor(region, this.scale());
  }

  choosePhoto(slide, image, query) {
    const updated = updateSlide(this.getDeck(), this.selected, { image, imageQuery: query || slide.imageQuery });
    this.change(reconcilePhotoCredits(updated, [slide.image]), { kind: "image" });
  }

  mountControls(deck, slide) {
    mountSlideControls(this.controlsHost, { deck, slide, index: this.selected,
      onLayout: (layout) => {
        const quiz = layout === "quiz" && !slide.quiz
          ? { question: "Wéi eng Äntwert ass richteg?", options: ["Äntwert A", "Äntwert B", "Äntwert C"], answerIndex: 0 }
          : slide.quiz;
        this.change(updateSlide(deck, this.selected, { layout, quiz }), { kind: "layout" });
      },
      onPresenter: (presenter) => this.change(updateSlide(deck, this.selected, { presenter }), { kind: "presenter" }),
      onMove: (delta) => this.change(moveSlide(deck, this.selected, this.selected + delta), { kind: "move" }, this.selected + delta),
      onDuplicate: () => this.change(duplicateSlide(deck, this.selected), { kind: "duplicate" }, this.selected + 1),
      onDelete: () => this.removeSelected(deck), onNotes: () => this.editNotes(),
      onPhoto: (event) => openImagePicker({ slide, anchor: event.currentTarget,
        onSelect: (image, query) => this.choosePhoto(slide, image, query) }),
      onRewrite: (intent, custom) => this.onRewrite?.(this.selected, intent, custom),
    });
  }

  removeSelected(deck) {
    try {
      const removedImage = deck.slides[this.selected].image;
      const deleted = deleteSlide(deck, this.selected);
      this.change(reconcilePhotoCredits(deleted, [removedImage]), { kind: "delete" }, this.selected);
    }
    catch (error) { alert(error.message); }
  }

  select(index) {
    this.selected = Math.max(0, Math.min(index, this.getDeck().slides.length - 1));
    this.onSelect?.(this.selected);
    this.render();
  }

  render(index = this.selected) {
    this.selected = index;
    this.renderPreview();
    this.renderFilmstrip();
  }

  dispose() {
    this.dragDisposers.forEach((dispose) => dispose());
    this.dragDisposers = [];
  }
}

export function createEditor(config) {
  const editor = new DeckEditor(config);
  return Object.freeze({
    render: (index) => editor.render(index),
    renderPreview: () => editor.renderPreview(),
    select: (index) => editor.select(index),
    selectedIndex: () => editor.selected,
    dispose: () => editor.dispose(),
  });
}
