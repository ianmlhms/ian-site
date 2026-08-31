import { DUO_GAMES, DUO_ROOM_PREFIX } from "./content.js?v=1";

export const meta = { badge: "live" };

const ROOM_SUFFIX_LENGTH = 10;
const AUTOPLAY_DELAY_MS = Object.freeze({ min: 1200, max: 1800 });
const EMPTY_TICKS_BEFORE_RESTART = 3;

function freshRoom() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (byte) => byte.toString(36)).join("").slice(0, ROOM_SUFFIX_LENGTH);

  // A fixed room would let unrelated visitors join and alter each other's game.
  return `${DUO_ROOM_PREFIX}${suffix}`.slice(0, 40);
}

function gameUrl(gameId, room, role) {
  const params = new URLSearchParams({ room, role });
  return `/${encodeURIComponent(gameId)}.html?${params}`;
}

function autoplayDelay() {
  const range = AUTOPLAY_DELAY_MS.max - AUTOPLAY_DELAY_MS.min;
  return AUTOPLAY_DELAY_MS.min + Math.round(Math.random() * range);
}

function readFrameDocument(frame) {
  try {
    return { accessible: true, document: frame.contentDocument };
  } catch {
    return { accessible: false, document: null };
  }
}

export function mount(host, opts = {}) {
  void opts;

  let destroyed = false;
  let selectedGame = DUO_GAMES[0];
  let round = 0;
  let autoplayTimer = null;
  let autoplayStopped = false;
  let autoplayHasMoved = false;
  let emptyTicks = 0;
  const chips = document.createElement("div");
  const frames = document.createElement("div");
  const frameEntries = ["host", "guest"].map((role, index) => {
    const device = document.createElement("div");
    const label = document.createElement("span");
    const frame = document.createElement("iframe");

    device.className = "ddevice";
    label.className = "ddevice-label";
    label.textContent = String(index + 1);
    frame.className = "dframe dduo-frame";
    frame.loading = "lazy";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    device.append(label, frame);

    return { role, frame, device };
  });
  const chipButtons = new Map();
  const documentListeners = new Map();

  chips.className = "dchips";
  frames.className = "dduo-frames";
  frameEntries.forEach(({ device }) => frames.append(device));

  for (const game of DUO_GAMES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = game === selectedGame ? "dchip on" : "dchip";
    button.dataset.gameId = game.id;
    button.textContent = `${game.emoji} ${game.name}`;
    chipButtons.set(game.id, button);
    chips.append(button);
  }

  const clearAutoplayTimer = () => {
    if (autoplayTimer === null) return;
    window.clearTimeout(autoplayTimer);
    autoplayTimer = null;
  };

  const removeDocumentListeners = () => {
    documentListeners.forEach(({ document: frameDocument, handleInteraction }) => {
      try {
        frameDocument.removeEventListener("pointerdown", handleInteraction);
        frameDocument.removeEventListener("keydown", handleInteraction);
      } catch {
        // A document can disappear while its iframe is navigating.
      }
    });
    documentListeners.clear();
  };

  const stopAutoplay = () => {
    autoplayStopped = true;
    clearAutoplayTimer();
    removeDocumentListeners();
  };

  const attachInteractionListeners = (frame, activeRound) => {
    const existing = documentListeners.get(frame);
    if (existing) {
      try {
        existing.document.removeEventListener("pointerdown", existing.handleInteraction);
        existing.document.removeEventListener("keydown", existing.handleInteraction);
      } catch {
        // The old document may already have been replaced.
      }
      documentListeners.delete(frame);
    }

    const result = readFrameDocument(frame);
    if (!result.accessible || !result.document) return;

    const handleInteraction = () => {
      if (destroyed || activeRound !== round) return;
      stopAutoplay();
    };

    try {
      result.document.addEventListener("pointerdown", handleInteraction);
      result.document.addEventListener("keydown", handleInteraction);
      documentListeners.set(frame, { document: result.document, handleInteraction });
    } catch {
      // Loading or replacement can make a same-origin document briefly unusable.
    }
  };

  const scheduleAutoplay = (activeRound) => {
    clearAutoplayTimer();
    if (destroyed || autoplayStopped || activeRound !== round) return;
    autoplayTimer = window.setTimeout(() => autoplayTick(activeRound), autoplayDelay());
  };

  const autoplayTick = (activeRound) => {
    autoplayTimer = null;
    if (destroyed || autoplayStopped || activeRound !== round) return;

    const candidates = [];
    for (const { frame } of frameEntries) {
      const result = readFrameDocument(frame);
      if (!result.accessible || !result.document) {
        scheduleAutoplay(activeRound);
        return;
      }
      try {
        candidates.push(...result.document.querySelectorAll(selectedGame.moveSelector));
      } catch {
        scheduleAutoplay(activeRound);
        return;
      }
    }

    if (candidates.length) {
      const candidate = candidates[Math.floor(Math.random() * candidates.length)];
      try {
        candidate.click();
        autoplayHasMoved = true;
        emptyTicks = 0;
      } catch {
        // The game may have re-rendered between selection and the click.
      }
    } else if (autoplayHasMoved) {
      emptyTicks += 1;
      if (emptyTicks >= EMPTY_TICKS_BEFORE_RESTART) {
        loadGame(selectedGame);
        return;
      }
    }

    scheduleAutoplay(activeRound);
  };

  const handleFrameLoad = (event) => {
    if (destroyed) return;
    attachInteractionListeners(event.currentTarget, round);
  };

  const loadGame = (game) => {
    if (destroyed) return;
    clearAutoplayTimer();
    removeDocumentListeners();
    selectedGame = game;
    round += 1;
    autoplayStopped = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    autoplayHasMoved = false;
    emptyTicks = 0;
    const room = freshRoom();

    frameEntries.forEach(({ role, frame }, index) => {
      frame.title = `${game.name} ${index + 1}`;
      frame.src = gameUrl(game.id, room, role);
    });
    chipButtons.forEach((button, gameId) => {
      button.classList.toggle("on", gameId === game.id);
    });
    scheduleAutoplay(round);
  };

  const handleChipClick = (event) => {
    const button = event.target.closest(".dchip");
    if (!button || !chips.contains(button)) return;
    const game = DUO_GAMES.find(({ id }) => id === button.dataset.gameId);
    if (game && game !== selectedGame) loadGame(game);
  };

  chips.addEventListener("click", handleChipClick);
  frameEntries.forEach(({ frame }) => frame.addEventListener("load", handleFrameLoad));
  host.append(chips, frames);
  loadGame(selectedGame);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearAutoplayTimer();
      removeDocumentListeners();
      chips.removeEventListener("click", handleChipClick);
      // Navigating away tears down both Supabase Realtime websocket clients.
      frameEntries.forEach(({ frame }) => {
        frame.removeEventListener("load", handleFrameLoad);
        frame.src = "about:blank";
      });
    },
  };
}
