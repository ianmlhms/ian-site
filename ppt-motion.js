import { animate } from "https://cdn.jsdelivr.net/npm/motion@11/+esm";

const DEFAULT_DURATION = 0.4;
const DEFAULT_BOUNCE = 0;
const FLICK_BOUNCE = 0.2;
const DEFAULT_DECELERATION = 0.998;
const DEFAULT_RUBBERBAND = 0.55;
const DRAG_THRESHOLD_PX = 10;
const VELOCITY_WINDOW_MS = 120;
const REDUCED_FADE_S = 0.16;
const motions = new WeakMap();

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function matrixFor(element) {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none") return { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  try {
    const matrix = new DOMMatrixReadOnly(transform);
    return { x: matrix.m41, y: matrix.m42, scaleX: matrix.a, scaleY: matrix.d };
  } catch {
    return { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  }
}

function transformFor(value) {
  const scaleX = Number.isFinite(value.scale) ? value.scale : value.scaleX;
  const scaleY = Number.isFinite(value.scale) ? value.scale : value.scaleY;
  return `translate3d(${value.x}px, ${value.y}px, 0) scale(${scaleX}, ${scaleY})`;
}

function currentPresentation(element) {
  const matrix = matrixFor(element);
  const opacity = Number.parseFloat(getComputedStyle(element).opacity);
  return { ...matrix, opacity: Number.isFinite(opacity) ? opacity : 1 };
}

function stop(element) {
  const active = motions.get(element);
  if (!active) return currentPresentation(element);
  const current = currentPresentation(element);
  active.cancel();
  motions.delete(element);
  element.style.transform = transformFor(current);
  element.style.opacity = String(current.opacity);
  return current;
}

function targetPresentation(current, props) {
  return {
    x: Number.isFinite(props.x) ? props.x : current.x,
    y: Number.isFinite(props.y) ? props.y : current.y,
    scaleX: Number.isFinite(props.scaleX) ? props.scaleX : current.scaleX,
    scaleY: Number.isFinite(props.scaleY) ? props.scaleY : current.scaleY,
    scale: Number.isFinite(props.scale) ? props.scale : undefined,
    opacity: Number.isFinite(props.opacity) ? props.opacity : current.opacity,
  };
}

function finishMotion(element, controls) {
  if (motions.get(element) !== controls) return;
  motions.delete(element);
  element.style.removeProperty("will-change");
}

/** Interruptible spring that always starts from the on-screen presentation value. */
export function spring(element, props, options = {}) {
  if (!(element instanceof Element)) throw new TypeError("D'Animatiounszil feelt.");
  const current = stop(element);
  const target = targetPresentation(current, props || {});
  element.style.willChange = "transform, opacity";
  if (reducedMotion()) {
    element.style.transform = "none";
    element.style.opacity = String(Math.min(current.opacity, 0.82));
  } else {
    element.style.transform = transformFor(current);
  }
  const keyframes = reducedMotion()
    ? { opacity: target.opacity }
    : { transform: transformFor(target), opacity: target.opacity };
  const settings = reducedMotion()
    ? { duration: REDUCED_FADE_S, ease: "linear" }
    : { type: "spring", duration: options.duration ?? DEFAULT_DURATION,
        bounce: options.bounce ?? DEFAULT_BOUNCE, velocity: options.velocity ?? 0 };
  const controls = animate(element, keyframes, settings);
  motions.set(element, controls);
  controls.finished.then(() => finishMotion(element, controls)).catch(() => finishMotion(element, controls));
  return controls;
}

export function project(velocity, decelerationRate = DEFAULT_DECELERATION) {
  if (reducedMotion()) return 0;
  const inputRate = Number(decelerationRate);
  const rate = Math.min(0.9999, Math.max(0,
    Number.isFinite(inputRate) ? inputRate : DEFAULT_DECELERATION));
  const speed = Number(velocity);
  if (!Number.isFinite(speed)) return 0;
  return (speed / 1000) * rate / (1 - rate);
}

export function rubberband(overshoot, dimension, constant = DEFAULT_RUBBERBAND) {
  const distance = Number(overshoot) || 0;
  const size = Math.max(1, Number(dimension) || 1);
  const inputStrength = Number(constant);
  const strength = Math.max(0, Number.isFinite(inputStrength) ? inputStrength : DEFAULT_RUBBERBAND);
  return (distance * size * strength) / (size + strength * Math.abs(distance));
}

function releaseVelocity(history, axis) {
  if (history.length < 2) return 0;
  const latest = history[history.length - 1];
  const earliest = history.find((entry) => latest.time - entry.time <= VELOCITY_WINDOW_MS) || history[0];
  const elapsed = Math.max(1, latest.time - earliest.time);
  return (latest[axis] - earliest[axis]) / elapsed * 1000;
}

function detail(state, event) {
  const latest = state.history[state.history.length - 1];
  return {
    event, x: event.clientX, y: event.clientY,
    dx: event.clientX - state.startX, dy: event.clientY - state.startY,
    velocityX: releaseVelocity(state.history, "x"),
    velocityY: releaseVelocity(state.history, "y"),
    reducedMotion: reducedMotion(), elapsed: latest.time - state.startedAt,
  };
}

class PointerDrag {
  constructor(element, handlers) {
    if (!(element instanceof Element)) throw new TypeError("D'Drag-Zil feelt.");
    this.element = element;
    this.handlers = handlers;
    this.state = null;
    this.pointerDown = this.pointerDown.bind(this);
    this.pointerMove = this.pointerMove.bind(this);
    this.pointerUp = this.pointerUp.bind(this);
    this.pointerCancel = this.pointerCancel.bind(this);
  }

  pointerDown(event) {
    if (event.button !== 0 || this.state) return;
    const time = performance.now();
    stop(this.element);
    this.state = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      startedAt: time, committed: false, history: [{ x: event.clientX, y: event.clientY, time }] };
    this.element.setPointerCapture(event.pointerId);
    this.handlers.onPress?.(detail(this.state, event));
  }

  pointerMove(event) {
    if (!this.state || event.pointerId !== this.state.pointerId) return;
    const time = performance.now();
    this.state.history = [...this.state.history, { x: event.clientX, y: event.clientY, time }]
      .filter((entry) => time - entry.time <= VELOCITY_WINDOW_MS * 2);
    const data = detail(this.state, event);
    if (!this.state.committed && Math.hypot(data.dx, data.dy) < DRAG_THRESHOLD_PX) return;
    if (!this.state.committed) { this.state.committed = true; this.handlers.onStart?.(data); }
    event.preventDefault();
    this.handlers.onMove?.(data);
  }

  finish(event, cancelled = false) {
    if (!this.state || event.pointerId !== this.state.pointerId) return;
    const time = performance.now();
    this.state.history = [...this.state.history, { x: event.clientX, y: event.clientY, time }]
      .filter((entry) => time - entry.time <= VELOCITY_WINDOW_MS * 2);
    const data = detail(this.state, event);
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
    if (this.state.committed) (cancelled ? this.handlers.onCancel : this.handlers.onEnd)?.(data);
    else this.handlers.onTap?.(data);
    this.state = null;
  }

  pointerUp(event) {
    this.finish(event);
  }

  pointerCancel(event) {
    this.finish(event, true);
  }

  attach() {
    this.element.addEventListener("pointerdown", this.pointerDown);
    this.element.addEventListener("pointermove", this.pointerMove);
    this.element.addEventListener("pointerup", this.pointerUp);
    this.element.addEventListener("pointercancel", this.pointerCancel);
  }

  dispose() {
    stop(this.element);
    this.element.removeEventListener("pointerdown", this.pointerDown);
    this.element.removeEventListener("pointermove", this.pointerMove);
    this.element.removeEventListener("pointerup", this.pointerUp);
    this.element.removeEventListener("pointercancel", this.pointerCancel);
  }
}

/** Pointer drag with capture, grab-offset-preserving deltas, threshold and velocity. */
export function draggable(element, handlers = {}) {
  const drag = new PointerDrag(element, handlers);
  drag.attach();
  return () => drag.dispose();
}

export { FLICK_BOUNCE, reducedMotion as prefersReducedMotion };
