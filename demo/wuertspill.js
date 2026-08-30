import { WORDLE_COLS, WORDLE_ROWS, WORDS_LB } from "./content.js?v=1";
import { UI } from "./copy.js?v=1";

const KEYBOARD_ROWS = Object.freeze([
  Object.freeze(["A", "Z", "E", "R", "T", "Y", "U", "I", "O", "P"]),
  Object.freeze(["Q", "S", "D", "F", "G", "H", "J", "K", "L", "M"]),
  Object.freeze(["⌫", "W", "X", "C", "V", "B", "N", "Ä", "Ë", "É", "⏎"]),
]);
const BACKSPACE_KEY = "⌫";
const ENTER_KEY = "⏎";
const KEY_STATE_RANK = Object.freeze({ miss: 1, near: 2, hit: 3 });
const VALID_LETTERS = new Set(WORDS_LB.flatMap((word) => [...word]));

export const meta = { badge: null };

// Two passes consume exact matches first so duplicate guesses cannot claim one
// answer letter more than once (for example, five Ls against SPILL).
function scoreGuess(answer, guess) {
  const result = Array(WORDLE_COLS).fill("miss");
  const remaining = new Map();

  for (let index = 0; index < WORDLE_COLS; index += 1) {
    if (guess[index] === answer[index]) {
      result[index] = "hit";
    } else {
      remaining.set(answer[index], (remaining.get(answer[index]) || 0) + 1);
    }
  }

  for (let index = 0; index < WORDLE_COLS; index += 1) {
    if (result[index] === "hit") continue;
    const available = remaining.get(guess[index]) || 0;
    if (available > 0) {
      result[index] = "near";
      remaining.set(guess[index], available - 1);
    }
  }

  return result;
}

export function mount(host, opts = {}) {
  void opts;

  let destroyed = false;
  let answer = pickAnswer();
  let rowIndex = 0;
  let guess = [];
  let roundOver = false;
  let restartButton = null;
  const timers = [];
  const keyStates = new Map();
  const keyButtons = new Map();
  const game = document.createElement("div");
  const grid = document.createElement("div");
  const message = document.createElement("div");
  const keyboard = document.createElement("div");
  const cells = [];

  game.className = "dwordle";
  grid.className = "dwgrid";
  message.className = "dwmsg";
  keyboard.className = "dwkeys";

  for (let row = 0; row < WORDLE_ROWS; row += 1) {
    const rowElement = document.createElement("div");
    const rowCells = [];
    rowElement.className = "dwrow";
    for (let column = 0; column < WORDLE_COLS; column += 1) {
      const cell = document.createElement("div");
      cell.className = "dwcell";
      rowCells.push(cell);
      rowElement.append(cell);
    }
    cells.push(rowCells);
    grid.append(rowElement);
  }

  for (const keys of KEYBOARD_ROWS) {
    const keyRow = document.createElement("div");
    keyRow.className = "dwkrow";
    for (const key of keys) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `dwkey${key === BACKSPACE_KEY || key === ENTER_KEY ? " wide" : ""}`;
      button.dataset.key = key;
      button.textContent = key;
      keyButtons.set(key, button);
      keyRow.append(button);
    }
    keyboard.append(keyRow);
  }

  game.append(grid, message, keyboard);
  host.append(game);

  function pickAnswer() {
    return WORDS_LB[Math.floor(Math.random() * WORDS_LB.length)];
  }

  function renderGuess() {
    const activeCells = cells[rowIndex];
    if (!activeCells) return;
    activeCells.forEach((cell, index) => {
      cell.textContent = guess[index] || "";
      cell.classList.toggle("filled", index < guess.length);
    });
  }

  function updateKeyboard(letter, state) {
    const previousState = keyStates.get(letter);
    if (previousState && KEY_STATE_RANK[previousState] >= KEY_STATE_RANK[state]) return;
    const button = keyButtons.get(letter);
    if (!button) return;
    if (previousState) button.classList.remove(previousState);
    button.classList.add(state);
    keyStates.set(letter, state);
  }

  function showResult(won) {
    roundOver = true;
    message.textContent = won ? `✅ ${UI.won}` : `❌ ${UI.lost} ${answer}.`;
    restartButton = document.createElement("button");
    restartButton.type = "button";
    restartButton.className = "dbtn";
    restartButton.textContent = UI.retry;
    restartButton.addEventListener("click", restart);
    game.append(restartButton);
  }

  function submitGuess() {
    if (guess.length !== WORDLE_COLS) return;
    const guessWord = guess.join("");
    const states = scoreGuess(answer, guessWord);
    states.forEach((state, index) => {
      cells[rowIndex][index].classList.remove("filled");
      cells[rowIndex][index].classList.add(state);
      updateKeyboard(guess[index], state);
    });

    if (guessWord === answer) {
      showResult(true);
      return;
    }
    if (rowIndex === WORDLE_ROWS - 1) {
      showResult(false);
      return;
    }

    rowIndex += 1;
    guess = [];
  }

  function handleKey(key) {
    if (destroyed || roundOver) return;
    if (key === BACKSPACE_KEY) {
      guess = guess.slice(0, -1);
      renderGuess();
      return;
    }
    if (key === ENTER_KEY) {
      submitGuess();
      return;
    }
    if (guess.length >= WORDLE_COLS || !VALID_LETTERS.has(key)) return;
    guess = [...guess, key];
    renderGuess();
  }

  function handleKeyboardClick(event) {
    const button = event.target.closest(".dwkey");
    if (!button || !keyboard.contains(button)) return;
    handleKey(button.dataset.key);
  }

  function handlePhysicalKey(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Backspace") {
      event.preventDefault();
      handleKey(BACKSPACE_KEY);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      handleKey(ENTER_KEY);
      return;
    }
    const letter = event.key.toLocaleUpperCase("lb-LU");
    if ([...letter].length !== 1 || !VALID_LETTERS.has(letter)) return;
    event.preventDefault();
    handleKey(letter);
  }

  function restart() {
    if (destroyed) return;
    answer = pickAnswer();
    rowIndex = 0;
    guess = [];
    roundOver = false;
    message.textContent = "";
    cells.flat().forEach((cell) => {
      cell.textContent = "";
      cell.className = "dwcell";
    });
    keyStates.clear();
    keyButtons.forEach((button) => {
      button.classList.remove("hit", "near", "miss");
    });
    restartButton.removeEventListener("click", restart);
    restartButton.remove();
    restartButton = null;
  }

  keyboard.addEventListener("click", handleKeyboardClick);
  document.addEventListener("keydown", handlePhysicalKey);

  return {
    destroy() {
      destroyed = true;
      timers.splice(0).forEach((timerId) => {
        window.clearTimeout(timerId);
        window.clearInterval(timerId);
      });
      keyboard.removeEventListener("click", handleKeyboardClick);
      document.removeEventListener("keydown", handlePhysicalKey);
      if (restartButton) restartButton.removeEventListener("click", restart);
    },
  };
}
