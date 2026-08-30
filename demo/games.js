import { GAMES } from "./content.js?v=1";
import { UI } from "./copy.js?v=1";

export const meta = { badge: null };

export function mount(host, opts = {}) {
  void opts;

  let destroyed = false;
  const featuredGame = GAMES.find((game) => game.feature) ?? GAMES[0];
  const chips = document.createElement("div");
  const frame = document.createElement("iframe");
  const description = document.createElement("p");
  const openLink = document.createElement("a");
  const chipButtons = new Map();

  chips.className = "dchips";
  frame.className = "dframe";
  frame.title = featuredGame.name;
  frame.loading = "lazy";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.src = `/pb/${featuredGame.id}.html`;
  description.className = "dmuted";
  description.textContent = featuredGame.desc;
  openLink.className = "dbtn";
  openLink.href = `/pixelbreak.html?g=${encodeURIComponent(featuredGame.id)}`;
  openLink.textContent = UI.openApp;

  for (const game of GAMES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = game === featuredGame ? "dchip on" : "dchip";
    button.dataset.gameId = game.id;
    button.textContent = `${game.emoji} ${game.name}`;
    chipButtons.set(game.id, button);
    chips.append(button);
  }

  const selectGame = (game) => {
    if (destroyed) return;
    frame.src = `/pb/${game.id}.html`;
    frame.title = game.name;
    description.textContent = game.desc;
    openLink.href = `/pixelbreak.html?g=${encodeURIComponent(game.id)}`;
    chipButtons.forEach((button, gameId) => {
      button.classList.toggle("on", gameId === game.id);
    });
  };

  const handleChipClick = (event) => {
    const button = event.target.closest(".dchip");
    if (!button || !chips.contains(button)) return;
    const game = GAMES.find((candidate) => candidate.id === button.dataset.gameId);
    if (game) selectGame(game);
  };

  chips.addEventListener("click", handleChipClick);
  host.append(chips, frame, description, openLink);

  return {
    destroy() {
      destroyed = true;
      chips.removeEventListener("click", handleChipClick);
      frame.src = "about:blank";
    },
  };
}
