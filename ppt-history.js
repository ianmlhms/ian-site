const DEFAULT_LIMIT = 50;
const TEXT_COALESCE_MS = 600;

function snapshot(state) {
  if (!state?.deck || !state?.style) {
    throw new Error("Deck a Stil si fir d'Historik néideg.");
  }
  return Object.freeze({
    deck: state.deck,
    style: state.style,
  });
}

function sameState(left, right) {
  return left?.deck === right?.deck
    && left?.style === right?.style;
}

function coalesceKey(meta) {
  if (meta?.kind !== "text") return null;
  if (!meta.slideId || !meta.field) return null;
  return `${meta.slideId}:${meta.field}`;
}

function timestamp(meta) {
  const provided = Number(meta?.timestamp);
  return Number.isFinite(provided) && provided > 0
    ? provided
    : Date.now();
}

class HistoryStore {
  constructor(initialState, limit) {
    this.limit = Math.max(1, Number(limit) || DEFAULT_LIMIT);
    this.past = [];
    this.present = initialState ? snapshot(initialState) : null;
    this.future = [];
    this.lastText = null;
  }

  reset(state = null) {
    this.past = [];
    this.present = state ? snapshot(state) : null;
    this.future = [];
    this.lastText = null;
    return this.present;
  }

  shouldCoalesce(key, time) {
    if (!key || !this.lastText) return false;
    return this.lastText.key === key
      && time - this.lastText.time <= TEXT_COALESCE_MS;
  }

  push(state, meta = null) {
    const next = snapshot(state);
    if (!this.present) return this.reset(next);
    if (sameState(this.present, next)) return this.present;
    const key = coalesceKey(meta);
    const time = timestamp(meta);
    if (!this.shouldCoalesce(key, time)) {
      this.past = [...this.past, this.present].slice(-this.limit);
    }
    this.present = next;
    this.future = [];
    this.lastText = key ? { key, time } : null;
    return this.present;
  }

  undo() {
    if (!this.canUndo() || !this.present) return null;
    const previous = this.past[this.past.length - 1];
    this.past = this.past.slice(0, -1);
    this.future = [this.present, ...this.future].slice(0, this.limit);
    this.present = previous;
    this.lastText = null;
    return this.present;
  }

  redo() {
    if (!this.canRedo() || !this.present) return null;
    const next = this.future[0];
    this.past = [...this.past, this.present].slice(-this.limit);
    this.present = next;
    this.future = this.future.slice(1);
    this.lastText = null;
    return this.present;
  }

  canUndo() {
    return this.past.length > 0;
  }

  canRedo() {
    return this.future.length > 0;
  }

  current() {
    return this.present;
  }

  api() {
    return Object.freeze({
      push: (state, meta) => this.push(state, meta),
      undo: () => this.undo(),
      redo: () => this.redo(),
      reset: (state) => this.reset(state),
      canUndo: () => this.canUndo(),
      canRedo: () => this.canRedo(),
      current: () => this.current(),
    });
  }
}

/** Create an isolated bounded timeline of immutable deck and style references. */
export function createHistory(initialState = null, limit = DEFAULT_LIMIT) {
  return new HistoryStore(initialState, limit).api();
}

// The studio uses an isolated history. Named exports additionally provide the exact
// singleton-shaped API from the module contract for small consumers and tests.
const sharedHistory = createHistory();

export function push(state, meta = null) {
  return sharedHistory.push(state, meta);
}

export function undo() {
  return sharedHistory.undo();
}

export function redo() {
  return sharedHistory.redo();
}

export function canUndo() {
  return sharedHistory.canUndo();
}

export function canRedo() {
  return sharedHistory.canRedo();
}

export function reset(state = null) {
  return sharedHistory.reset(state);
}

export function current() {
  return sharedHistory.current();
}

export {
  DEFAULT_LIMIT,
  TEXT_COALESCE_MS,
};
