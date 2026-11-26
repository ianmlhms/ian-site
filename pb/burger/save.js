/* Burger-Restaurant saves.
 *
 * Format (unchanged since the game shipped, v:1): {v:1, day, coins, lifetimeCoins, stars, kit:{id:level}, int:{...}, prem:{...}}
 * plus, since the Nov 2026 rework, tb (= lifetimeCoins). tb is what the server's keep-progress trigger
 * (scripts/game-saves-guard-rebirth.sql) compares, so from the first new save on an older, lower save can no longer replace the
 * cloud row. Old saves without tb load as they are; nothing else was renamed or removed.
 *
 * Which save is better: more lifetimeCoins, then more coins spent on upgrades, then more stars spent, then the later day.
 * A purchase leaves lifetimeCoins alone, so without the second rule a reload could drop what was just bought.
 *
 * Arcade protocol: the hub injects the local save as window.__pbSave before any script runs; the game asks {__pbWantSave:1};
 * the hub answers {__pbLoadSave:1,data} with the cloud copy and then with the newest save this session pushed (either may be
 * older than what the game has). The game posts {__pbSave:1,data} only when its progress changed. */
import {GAME_LIMITS, UPGRADE_TABLES, VERSION} from "/pb/burger/data.js?v=2";
import {spentOn} from "/pb/burger/sim.js?v=3";

const SAVE_KEY = "pb_save_burger";     // the hub's local copy; in test mode the arcade maps it to pb_testsave_burger
const PUSH_DELAY_MS = 15_000;          // sales during a day: one save message at most every 15 s (the day end, a purchase,
                                       // leaving or hiding the page send at once)

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const cleanInt = (value, min, max) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
};

/* Only known upgrades, each within its own range (a hand-edited or corrupt level cannot unlock more than exists). */
const cleanLevels = (category, value) => {
  if (!isRecord(value)) return {};
  return UPGRADE_TABLES[category].reduce((levels, upgrade) => {
    const level = cleanInt(value[upgrade.id], 0, upgrade.max);
    return level > 0 ? {...levels, [upgrade.id]:level} : levels;
  }, {});
};

/* Any save the game ever wrote -> clean progress, or null if it is not a burger save. */
export function migrate(save) {
  if (!isRecord(save)) return null;
  if (save.v !== undefined && save.v !== VERSION) return null;
  if (save.lifetimeCoins === undefined && save.day === undefined) return null;
  const coins = cleanInt(save.coins, 0, Number.MAX_SAFE_INTEGER);
  return {
    day:cleanInt(save.day, 1, GAME_LIMITS.maxDay),
    coins,
    lifetimeCoins:Math.max(cleanInt(save.lifetimeCoins, 0, Number.MAX_SAFE_INTEGER), cleanInt(save.tb, 0, Number.MAX_SAFE_INTEGER)),
    stars:cleanInt(save.stars, 0, Number.MAX_SAFE_INTEGER),
    kit:cleanLevels("kit", save.kit),
    int:cleanLevels("int", save.int),
    prem:cleanLevels("prem", save.prem),
  };
}

export const emptyProgress = () => migrate({v:VERSION, day:1});

export const snapshot = (progress) => ({
  v:VERSION,
  day:progress.day,
  coins:progress.coins,
  lifetimeCoins:progress.lifetimeCoins,
  stars:progress.stars,
  kit:{...progress.kit},
  int:{...progress.int},
  prem:{...progress.prem},
  tb:progress.lifetimeCoins,
});

const rank = (progress) => [progress.lifetimeCoins, spentOn(progress, "coins"), spentOn(progress, "stars"), progress.day];

/* true when `candidate` has strictly more progress than `current` */
export function isBetter(candidate, current) {
  const a = rank(candidate), b = rank(current);
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

const sameProgress = (a, b) => JSON.stringify(snapshot(a)) === JSON.stringify(snapshot(b));

function readLocal() {
  try { return JSON.parse(window.localStorage.getItem(SAVE_KEY) || "null"); }
  catch (error) { console.warn("[Burger] could not read the local save", error); return null; }
}

/* The best of: the save the hub injected, and the hub's local copy. The local copy matters after the arcade's restart
 * button: the frame reloads with the save injected when the game was OPENED, while the hub kept writing newer ones. */
export function bootProgress() {
  return [window.__pbSave, readLocal()].map(migrate).filter(Boolean)
    .reduce((best, progress) => (isBetter(progress, best) ? progress : best), emptyProgress());
}

/* getProgress / onBetter: the game's current progress, and what to do when a better save arrives.
 * Returns {changed(), flush(), stop()}: changed() after every progress change, flush() to send now. */
export function createPersistence({getProgress, onBetter, isTestMode = false}) {
  const isFramed = window.parent !== window;
  let lastSent = getProgress();
  let timer = 0;

  const send = () => {
    window.clearTimeout(timer);
    timer = 0;
    const progress = getProgress();
    if (sameProgress(progress, lastSent)) return;
    lastSent = progress;
    const data = snapshot(progress);
    try {
      if (isFramed) window.parent.postMessage({__pbSave:1, data}, "*");
      else window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));   // opened as its own page: no hub to keep it
    } catch (error) {
      console.warn("[Burger] could not save", error);
    }
  };

  const onMessage = (event) => {
    if (event.source !== window.parent || !isRecord(event.data) || event.data.__pbLoadSave !== 1) return;
    const incoming = migrate(event.data.data);
    if (!incoming || !isBetter(incoming, getProgress())) return;
    lastSent = incoming;            // it came from the hub: no need to send it back
    onBetter(incoming);
  };

  const onHidden = () => { if (document.visibilityState === "hidden") send(); };
  window.addEventListener("message", onMessage);
  window.addEventListener("pagehide", send);
  document.addEventListener("visibilitychange", onHidden);
  if (isFramed && !isTestMode) {
    try { window.parent.postMessage({__pbWantSave:1}, "*"); }
    catch (error) { console.warn("[Burger] could not ask for the cloud save", error); }
  }

  return {
    changed() { if (!timer) timer = window.setTimeout(send, PUSH_DELAY_MS); },
    flush: send,
    stop() {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", send);
      document.removeEventListener("visibilitychange", onHidden);
    },
  };
}
