import { layoutSlide, slideForLayout } from "./ppt-layout.js?v=3";
import { renderSlide } from "./ppt-render-dom.js?v=3";
import { validateDeck } from "./ppt-ai.js?v=3";
import { draggable, prefersReducedMotion, spring } from "./ppt-motion.js?v=3";

const CSS_PIXELS_PER_INCH = 96;
const SLIDE_WIDTH_IN = 13.333;
const SLIDE_HEIGHT_IN = 7.5;
const TIMER_INTERVAL_MS = 250;
const SWIPE_DISTANCE_RATIO = 0.2;
const SWIPE_VELOCITY_PX_S = 350;
const SPRING_DURATION_S = 0.42;
const TRANSITION_BOUNCE = 0;
const FORWARD = 1;
const BACK = -1;
const KEY_FORWARD = new Set(["ArrowRight", " ", "PageDown"]);
const KEY_BACK = new Set(["ArrowLeft", "PageUp"]);
const HELP_TEXT = "N · Notizen  B · Schwaarz  F · Vollbild  Esc · Enn";
const PRESENTER_MARKUP = `<div class="ppt-present-viewport">
  <div class="ppt-present-slides"></div><div class="ppt-present-blank" hidden></div>
</div>
<aside class="ppt-present-notes material-panel" hidden aria-label="Notizen">
  <div class="ppt-present-meta"><span><small>Zäit</small><strong data-present-time>00:00</strong></span>
    <span><small>Slide</small><strong data-present-counter></strong></span></div>
  <p class="ppt-present-speaker" data-present-speaker></p>
  <h2>Notizen</h2><div class="ppt-present-script" data-present-notes></div>
  <div class="ppt-present-next"><small>Nächst Slide</small><strong data-present-next></strong></div>
</aside>
<div class="ppt-present-help" aria-hidden="true">${HELP_TEXT}</div>
<div class="ppt-present-live" aria-live="polite"></div>`;

function clampIndex(index, length) {
  return Math.max(0, Math.min(length - 1, Number.isFinite(index) ? Math.round(index) : 0));
}

function elapsedLabel(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function transformX(element, x) {
  element.style.transform = `translate3d(${x}px, 0, 0)`;
}

function presenterRoot() {
  const root = document.createElement("section");
  root.className = "ppt-presenter-root";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Presentatioun");
  root.tabIndex = -1;
  root.innerHTML = PRESENTER_MARKUP;
  return root;
}

function scaleFor(viewport) {
  const bounds = viewport.getBoundingClientRect();
  return Math.min(bounds.width / (SLIDE_WIDTH_IN * CSS_PIXELS_PER_INCH),
    bounds.height / (SLIDE_HEIGHT_IN * CSS_PIXELS_PER_INCH));
}

function slideImage(deck, slide, tokens, index) {
  const layout = layoutSlide(slideForLayout(deck, slide), tokens, index + 1);
  return layout.boxes.find((box) => box.kind === "image" && box.url)?.url || "";
}

class Presenter {
  constructor(deck, tokens, startIndex) {
    this.deck = deck;
    this.tokens = tokens;
    this.index = clampIndex(startIndex, deck.slides.length);
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root = presenterRoot();
    document.body.append(this.root);
    this.viewport = this.root.querySelector(".ppt-present-viewport");
    this.slidesHost = this.root.querySelector(".ppt-present-slides");
    this.notesPanel = this.root.querySelector(".ppt-present-notes");
    this.blank = this.root.querySelector(".ppt-present-blank");
    this.live = this.root.querySelector(".ppt-present-live");
    this.currentLayer = null;
    this.dragNeighbor = null;
    this.dragDirection = 0;
    this.timerStarted = performance.now();
    this.timerId = 0;
    this.stopped = false;
    this.hadFullscreen = false;
    this.keepAfterFullscreenExit = false;
    this.animationNumber = 0;
    this.preloadedImage = null;
    this.onResize = () => this.fitCurrent();
    this.onFullscreenChange = () => this.fullscreenChanged();
    this.onKeydown = (event) => this.keydown(event);
  }

  start() {
    this.currentLayer = this.newLayer(this.index);
    this.updateMeta();
    this.updateTimer();
    this.timerId = window.setInterval(() => this.updateTimer(), TIMER_INTERVAL_MS);
    window.addEventListener("resize", this.onResize);
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
    document.addEventListener("keydown", this.onKeydown, true);
    this.disposeDrag = draggable(this.viewport, {
      onMove: (data) => this.moveDrag(data), onEnd: (data) => this.endDrag(data),
      onCancel: () => this.cancelDrag(), onTap: (data) => this.tap(data),
    });
    this.root.focus();
    this.requestFullscreen();
  }

  layoutAt(index) {
    return layoutSlide(slideForLayout(this.deck, this.deck.slides[index]), this.tokens, index + 1);
  }

  newLayer(index) {
    const layer = document.createElement("div");
    layer.className = "ppt-present-slide";
    renderSlide(this.layoutAt(index), layer, scaleFor(this.viewport));
    this.slidesHost.append(layer);
    return layer;
  }

  preloadNext() {
    const next = this.deck.slides[this.index + 1];
    const url = next ? slideImage(this.deck, next, this.tokens, this.index + 1) : "";
    if (!url) { this.preloadedImage = null; return; }
    const image = new Image();
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.src = url;
    this.preloadedImage = image;
  }

  updateMeta() {
    const slide = this.deck.slides[this.index];
    this.root.querySelector("[data-present-counter]").textContent = `${this.index + 1} / ${this.deck.slides.length}`;
    this.root.querySelector("[data-present-speaker]").textContent = slide.presenter || this.deck.presenters[0] || "";
    this.root.querySelector("[data-present-notes]").textContent = slide.notes || "—";
    this.root.querySelector("[data-present-next]").textContent = this.deck.slides[this.index + 1]?.title || "—";
    this.preloadNext();
  }

  clearStaleLayers() {
    this.slidesHost.querySelectorAll(".ppt-present-slide").forEach((layer) => {
      if (layer !== this.currentLayer && layer !== this.dragNeighbor) layer.remove();
    });
  }

  fitCurrent() {
    if (this.stopped || !this.currentLayer) return;
    this.animationNumber += 1;
    this.dragNeighbor?.remove();
    this.dragNeighbor = null;
    this.clearStaleLayers();
    renderSlide(this.layoutAt(this.index), this.currentLayer, scaleFor(this.viewport));
    this.currentLayer.style.removeProperty("transform");
    this.currentLayer.style.opacity = "1";
  }

  finishTransition(oldLayer, nextLayer, run) {
    if (this.stopped || this.animationNumber !== run) return;
    oldLayer.remove();
    nextLayer.style.removeProperty("transform");
    nextLayer.style.removeProperty("opacity");
    this.clearStaleLayers();
  }

  reducedTransition(oldLayer, nextLayer, run) {
    nextLayer.style.opacity = "0";
    const enter = spring(nextLayer, { opacity: 1 }, { bounce: TRANSITION_BOUNCE });
    const exit = spring(oldLayer, { opacity: 0 }, { bounce: TRANSITION_BOUNCE });
    Promise.allSettled([enter.finished, exit.finished])
      .then(() => this.finishTransition(oldLayer, nextLayer, run));
  }

  transitionLayers(oldLayer, nextLayer, direction, run, wasPrepared) {
    if (prefersReducedMotion()) { this.reducedTransition(oldLayer, nextLayer, run); return; }
    const distance = this.viewport.getBoundingClientRect().width;
    if (!wasPrepared) transformX(nextLayer, direction * distance);
    const settings = { duration: SPRING_DURATION_S, bounce: TRANSITION_BOUNCE };
    const enter = spring(nextLayer, { x: 0, opacity: 1 }, settings);
    const exit = spring(oldLayer, { x: -direction * distance, opacity: 1 }, settings);
    Promise.allSettled([enter.finished, exit.finished])
      .then(() => this.finishTransition(oldLayer, nextLayer, run));
  }

  navigate(nextIndex, direction, prepared = null) {
    const target = clampIndex(nextIndex, this.deck.slides.length);
    if (target === this.index || this.stopped) {
      if (this.currentLayer) spring(this.currentLayer, { x: 0, opacity: 1 }, { bounce: TRANSITION_BOUNCE });
      return false;
    }
    const oldLayer = this.currentLayer;
    const nextLayer = prepared || this.newLayer(target);
    const wasPrepared = Boolean(prepared);
    const run = ++this.animationNumber;
    this.index = target;
    this.currentLayer = nextLayer;
    this.dragNeighbor = null;
    this.dragDirection = 0;
    this.updateMeta();
    this.transitionLayers(oldLayer, nextLayer, direction, run, wasPrepared);
    return true;
  }

  ensureDragNeighbor(direction) {
    const target = this.index + direction;
    if (target < 0 || target >= this.deck.slides.length) {
      this.dragNeighbor?.remove();
      this.dragNeighbor = null;
      this.dragDirection = 0;
      return null;
    }
    if (this.dragNeighbor && this.dragDirection === direction) return this.dragNeighbor;
    this.dragNeighbor?.remove();
    this.dragDirection = direction;
    this.dragNeighbor = this.newLayer(target);
    return this.dragNeighbor;
  }

  moveDrag(data) {
    const direction = data.dx < 0 ? FORWARD : BACK;
    const neighbor = this.ensureDragNeighbor(direction);
    const width = this.viewport.getBoundingClientRect().width;
    transformX(this.currentLayer, data.dx);
    if (neighbor) transformX(neighbor, data.dx + direction * width);
  }

  cancelDrag() {
    const width = this.viewport.getBoundingClientRect().width;
    spring(this.currentLayer, { x: 0 }, { bounce: TRANSITION_BOUNCE });
    if (!this.dragNeighbor) return;
    const neighbor = this.dragNeighbor;
    const direction = this.dragDirection;
    this.dragNeighbor = null;
    spring(neighbor, { x: direction * width }, { bounce: TRANSITION_BOUNCE }).finished
      .then(() => neighbor.remove()).catch(() => neighbor.remove());
  }

  endDrag(data) {
    const fast = Math.abs(data.velocityX) >= SWIPE_VELOCITY_PX_S;
    const direction = fast ? (data.velocityX < 0 ? FORWARD : BACK) : (data.dx < 0 ? FORWARD : BACK);
    const far = Math.abs(data.dx) >= this.viewport.getBoundingClientRect().width * SWIPE_DISTANCE_RATIO;
    if ((fast || far) && this.dragNeighbor && this.dragDirection === direction) {
      this.navigate(this.index + direction, direction, this.dragNeighbor);
      return;
    }
    this.cancelDrag();
  }

  tap(data) {
    const bounds = this.viewport.getBoundingClientRect();
    const direction = data.x < bounds.left + bounds.width / 2 ? BACK : FORWARD;
    this.navigate(this.index + direction, direction);
  }

  toggleNotes() {
    const visible = this.notesPanel.hidden;
    this.notesPanel.hidden = !visible;
    this.root.classList.toggle("has-present-notes", visible);
    this.live.textContent = visible ? "Notize gewisen." : "Notize verstoppt.";
  }

  toggleBlank() {
    this.blank.hidden = !this.blank.hidden;
    this.root.classList.toggle("is-blank", !this.blank.hidden);
  }

  resetTimer() {
    this.timerStarted = performance.now();
    this.root.querySelector("[data-present-time]").textContent = "00:00";
    this.live.textContent = "Zäit zeréckgesat.";
  }

  updateTimer() {
    if (this.stopped) return;
    this.root.querySelector("[data-present-time]").textContent = elapsedLabel(performance.now() - this.timerStarted);
  }

  requestFullscreen() {
    if (typeof this.root.requestFullscreen !== "function") {
      this.fullscreenFailed("Vollbild ass net disponibel; d'Presentatioun leeft am Browser.");
      return;
    }
    this.root.requestFullscreen().then(() => {
      if (this.stopped) { document.exitFullscreen?.().catch(() => {}); return; }
      this.hadFullscreen = true;
      this.root.classList.remove("is-fullscreen-fallback");
      this.root.querySelector(".ppt-present-help").textContent = HELP_TEXT;
      this.fitCurrent();
    }).catch((error) => {
      if (this.stopped) return;
      console.warn("[ppt] Vollbild refuséiert:", error instanceof Error ? error.message : error);
      this.fullscreenFailed("Vollbild gouf net erlaabt; d'Presentatioun leeft am Browser.");
    });
  }

  fullscreenFailed(message) {
    this.root.classList.add("is-fullscreen-fallback");
    this.live.textContent = message;
    this.root.querySelector(".ppt-present-help").textContent = message;
    this.fitCurrent();
  }

  toggleFullscreen() {
    if (document.fullscreenElement === this.root) {
      this.keepAfterFullscreenExit = true;
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    this.requestFullscreen();
  }

  fullscreenChanged() {
    if (document.fullscreenElement === this.root) { this.hadFullscreen = true; this.fitCurrent(); return; }
    if (this.keepAfterFullscreenExit) { this.keepAfterFullscreenExit = false; this.fitCurrent(); return; }
    if (this.hadFullscreen) this.stop();
  }

  keydown(event) {
    if (KEY_FORWARD.has(event.key)) { event.preventDefault(); this.navigate(this.index + 1, FORWARD); return; }
    if (KEY_BACK.has(event.key)) { event.preventDefault(); this.navigate(this.index - 1, BACK); return; }
    if (event.key === "Home") { event.preventDefault(); this.navigate(0, BACK); return; }
    if (event.key === "End") { event.preventDefault(); this.navigate(this.deck.slides.length - 1, FORWARD); return; }
    if (event.key === "Escape") { event.preventDefault(); this.stop(); return; }
    if (event.key.toLowerCase() === "f") { event.preventDefault(); this.toggleFullscreen(); return; }
    if (event.key.toLowerCase() === "b") { event.preventDefault(); this.toggleBlank(); return; }
    if (event.key.toLowerCase() === "n") { event.preventDefault(); this.toggleNotes(); return; }
    if (event.key.toLowerCase() === "t") { event.preventDefault(); this.resetTimer(); }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.animationNumber += 1;
    clearInterval(this.timerId);
    this.disposeDrag?.();
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    document.removeEventListener("keydown", this.onKeydown, true);
    this.root.remove();
    if (document.fullscreenElement === this.root) document.exitFullscreen?.().catch(() => {});
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
}

/** Start the browser presenter and return its complete teardown function. */
export function startPresenting(deck, tokens, startIndex = 0) {
  const safeDeck = validateDeck(deck);
  if (!tokens || typeof tokens !== "object") throw new Error("De Präsentatiounsstil feelt.");
  const presenter = new Presenter(safeDeck, tokens, startIndex);
  try { presenter.start(); }
  catch (error) {
    presenter.stop();
    console.error("[ppt] Presentatioun", error);
    throw new Error("D'Presentatioun konnt net gestart ginn.");
  }
  return () => presenter.stop();
}
