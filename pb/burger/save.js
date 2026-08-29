import {VERSION} from "/pb/burger/data.js?v=1";
import {createGameState} from "/pb/burger/sim.js?v=1";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const cleanInteger = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
};

const cleanLevels = (value) => {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce((result, [key, level]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) return result;
    const cleanLevel = cleanInteger(level);
    return {...result, [key]:cleanLevel};
  }, {});
};

export function snapshot(state) {
  return {
    v:1,
    day:state.day,
    coins:state.coins,
    lifetimeCoins:state.lifetimeCoins,
    stars:state.stars,
    kit:{...state.kit},
    int:{...state.int},
    prem:{...state.prem},
  };
}

const normalizeSave = (save) => ({
  v:VERSION,
  day:Math.max(1, cleanInteger(save.day, 1)),
  coins:cleanInteger(save.coins),
  lifetimeCoins:cleanInteger(save.lifetimeCoins),
  stars:cleanInteger(save.stars),
  kit:cleanLevels(save.kit),
  int:cleanLevels(save.int),
  prem:cleanLevels(save.prem),
});

/* Persistence mirrors PixelBreak's canonical progress-game contract: local save
 * is injected before modules run, cloud save arrives by postMessage, and only
 * the snapshot with strictly more lifetime progress may replace this state. */
export function applySave(current, sv) {
  if(!sv||sv.v!==1||!(sv.lifetimeCoins>current.lifetimeCoins))return current;
  if (!isRecord(sv)) return current;
  return createGameState(normalizeSave(sv));
}

export function createPersistence({getState, onState, onError = console.warn}) {
  const reportError = (message, error) => onError(`[Burger Rush] ${message}`, error);

  const applyIncoming = (incoming) => {
    try {
      const current = getState();
      const next = applySave(current, incoming);
      if (next === current) return false;
      window.score = next.lifetimeCoins;
      onState(next);
      return true;
    } catch (error) {
      reportError("Could not apply saved progress.", error);
      return false;
    }
  };

  function pushSave() {
    try {
      const current = getState();
      window.score = current.lifetimeCoins;
      parent.postMessage({__pbSave:1, data:snapshot(current)}, "*");
    } catch (error) {
      reportError("Could not send saved progress.", error);
    }
  }

  const receiveSave = (event) => {
    const data = event.data;
    if (data && data.__pbLoadSave === 1) applyIncoming(data.data);
  };

  window.addEventListener("message", receiveSave);
  applyIncoming(window.__pbSave);
  window.score = getState().lifetimeCoins;
  try {
    parent.postMessage({__pbWantSave:1}, "*");
  } catch (error) {
    reportError("Could not request cloud progress.", error);
  }
  setInterval(pushSave,5000);
  window.addEventListener('pagehide',pushSave);

  return {applyIncoming, pushSave};
}
