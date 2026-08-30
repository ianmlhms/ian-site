import { DUO_GAMES, DUO_ROOM_PREFIX } from "./content.js?v=1";

export const meta = { badge: "live" };

const ROOM_SUFFIX_LENGTH = 10;

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

export function mount(host, opts = {}) {
  void opts;

  let destroyed = false;
  let selectedGame = DUO_GAMES[0];
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

  const loadGame = (game) => {
    if (destroyed) return;
    selectedGame = game;
    const room = freshRoom();

    frameEntries.forEach(({ role, frame }, index) => {
      frame.title = `${game.name} ${index + 1}`;
      frame.src = gameUrl(game.id, room, role);
    });
    chipButtons.forEach((button, gameId) => {
      button.classList.toggle("on", gameId === game.id);
    });
  };

  const handleChipClick = (event) => {
    const button = event.target.closest(".dchip");
    if (!button || !chips.contains(button)) return;
    const game = DUO_GAMES.find(({ id }) => id === button.dataset.gameId);
    if (game && game !== selectedGame) loadGame(game);
  };

  chips.addEventListener("click", handleChipClick);
  host.append(chips, frames);
  loadGame(selectedGame);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      chips.removeEventListener("click", handleChipClick);
      // Navigating away tears down both Supabase Realtime websocket clients.
      frameEntries.forEach(({ frame }) => {
        frame.src = "about:blank";
      });
    },
  };
}
