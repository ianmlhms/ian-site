import { spring } from "./ppt-motion.js?v=3";
import { searchPhotos } from "./ppt-images.js?v=3";
import { esc } from "./ppt-render-dom.js?v=3";

const OPEN_SCALE = 0.94;
const OPEN_OFFSET_PX = 18;
const EXIT_DURATION_S = 0.28;

function pickerMarkup(query) {
  return `<div class="image-picker-backdrop" data-picker-close></div>
    <section class="image-picker material-panel" role="dialog" aria-modal="true" aria-labelledby="pickerTitle">
      <header><div><span class="eyebrow">Foto</span><h2 id="pickerTitle">Foto sichen</h2></div>
        <button class="icon-button" type="button" data-picker-close aria-label="Zoumaachen">×</button></header>
      <form class="image-search" data-image-search>
        <label class="field-label">Sichbegrëff<input name="query" value="${esc(query)}" autocomplete="off"></label>
        <button class="primary-button" type="submit">Sichen</button>
      </form>
      <button class="clear-image-button" type="button" data-clear-image>kee Bild</button>
      <div class="image-results" data-image-results aria-live="polite">
        <p class="picker-state">Nach keng Sich gestart.</p>
      </div>
    </section>`;
}

function originFor(panel, anchor) {
  if (!(anchor instanceof Element)) return "50% 0%";
  const panelRect = panel.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const x = anchorRect.left + anchorRect.width / 2 - panelRect.left;
  const y = anchorRect.top + anchorRect.height / 2 - panelRect.top;
  return `${x}px ${y}px`;
}

function resultMarkup(photos) {
  if (!photos.length) return '<p class="picker-state">Keng Fotoe fonnt. Probéier en anere Begrëff.</p>';
  return photos.map((photo, index) => `<button class="image-choice" type="button" data-photo="${index}">
    <img src="${esc(photo.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">
    <span>${esc(photo.credit)}</span></button>`).join("");
}

function loadingMarkup() {
  return '<div class="picker-loading" role="status"><i></i><span>Fotoe gi gesicht…</span></div>';
}

function errorMarkup(error) {
  const message = error instanceof Error ? error.message : "D'Fotosich ass feelgeschloen.";
  return `<p class="picker-state is-error">${esc(message)}</p>`;
}

function animateOpen(root, panel, backdrop) {
  panel.style.transform = `translate3d(0, ${OPEN_OFFSET_PX}px, 0) scale(${OPEN_SCALE})`;
  panel.style.opacity = "0";
  backdrop.style.opacity = "0";
  requestAnimationFrame(() => {
    spring(panel, { y: 0, scale: 1, opacity: 1 });
    spring(backdrop, { opacity: 1 });
    root.classList.add("is-open");
  });
}

function closeAnimation(root, panel, backdrop) {
  root.classList.remove("is-open");
  const panelMotion = spring(panel, { y: OPEN_OFFSET_PX, scale: OPEN_SCALE, opacity: 0 }, {
    duration: EXIT_DURATION_S,
  });
  spring(backdrop, { opacity: 0 }, { duration: EXIT_DURATION_S });
  return panelMotion.finished.catch(() => null).then(() => root.remove());
}

function focusSearch(root) {
  const input = root.querySelector('input[name="query"]');
  requestAnimationFrame(() => input?.focus());
}

function focusableElements(root) {
  return [...root.querySelectorAll("button:not([disabled]), input:not([disabled])")]
    .filter((element) => !element.hidden && element.offsetParent !== null);
}

function keepFocusInside(event, root) {
  if (event.key !== "Tab") return;
  const focusable = focusableElements(root);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

class ImagePicker {
  constructor({ slide, anchor, onSelect }) {
    if (!slide || typeof onSelect !== "function") throw new Error("D'Fotoauswiel ass net prett.");
    this.slide = slide;
    this.anchor = anchor;
    this.onSelect = onSelect;
    this.query = slide.imageQuery || slide.title || "";
    this.photos = Object.freeze([]);
    this.closing = false;
    this.keydown = this.keydown.bind(this);
    this.search = this.search.bind(this);
  }

  mount() {
    document.querySelector(".image-picker-root")?.remove();
    this.root = document.createElement("div");
    this.root.className = "image-picker-root";
    this.root.innerHTML = pickerMarkup(this.slide.imageQuery || this.slide.title || "");
    document.body.append(this.root);
    this.panel = this.root.querySelector(".image-picker");
    this.backdrop = this.root.querySelector(".image-picker-backdrop");
    this.results = this.root.querySelector("[data-image-results]");
    this.form = this.root.querySelector("[data-image-search]");
    this.panel.style.transformOrigin = originFor(this.panel, this.anchor);
    this.bind();
    animateOpen(this.root, this.panel, this.backdrop);
    focusSearch(this.root);
    this.form.requestSubmit();
  }

  bind() {
    this.form.addEventListener("submit", this.search);
    this.root.querySelectorAll("[data-picker-close]").forEach((button) => {
      button.onclick = () => this.close();
    });
    this.root.querySelector("[data-clear-image]").onclick = () => this.choose(null);
    document.addEventListener("keydown", this.keydown);
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    document.removeEventListener("keydown", this.keydown);
    await closeAnimation(this.root, this.panel, this.backdrop);
  }

  async choose(image) {
    try {
      await this.onSelect(image, this.query);
      await this.close();
    } catch (error) {
      this.results.innerHTML = errorMarkup(error);
    }
  }

  bindChoices() {
    this.results.querySelectorAll("[data-photo]").forEach((button) => {
      button.onclick = () => this.choose(this.photos[Number(button.dataset.photo)]);
    });
  }

  async search(event) {
    event.preventDefault();
    this.query = String(new FormData(this.form).get("query") || "").trim();
    this.results.innerHTML = loadingMarkup();
    try {
      this.photos = await searchPhotos(this.query);
      this.results.innerHTML = resultMarkup(this.photos);
      this.bindChoices();
    } catch (error) {
      this.photos = Object.freeze([]);
      this.results.innerHTML = errorMarkup(error);
    }
  }

  keydown(event) {
    keepFocusInside(event, this.root);
    if (event.key !== "Escape") return;
    event.preventDefault();
    this.close();
  }
}

/** Open the authenticated photo search panel for one immutable slide snapshot. */
export function openImagePicker(config) {
  const picker = new ImagePicker(config);
  picker.mount();
  return Object.freeze({ close: () => picker.close() });
}
