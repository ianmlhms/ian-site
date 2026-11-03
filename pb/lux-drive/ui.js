/* The interface of Lux Drive: the loading screen, the menu (with the settings) and the HUD with the Kaart (the minimap).
 *
 * The DOM is built here (no template files), the texts come from i18n.js, and every control reports back through `onAction`
 * so that the game loop stays in charge of the state. */
import { t, LANG_NAMES, LANGS } from './i18n.js';
import { TIME_PRESETS, WEATHER_IDS } from './env.js';

const TIME_IDS = Object.keys(TIME_PRESETS);
const QUALITY_IDS = ['auto', 'low', 'medium', 'high'];

export function createUI({ root, lang = 'lb', onAction = () => {} }) {
  const el = document.createElement('div');
  el.id = 'ui';
  el.innerHTML = `
    <div id="hud" hidden>
      <div id="speedo">
        <div class="row"><span id="speedValue">0</span><small id="speedUnit">km/h</small></div>
        <div class="row"><span id="gearValue">1</span><small id="gearLabel">Gang</small></div>
      </div>
      <canvas id="minimap" width="240" height="240"></canvas>
      <div id="roadName"></div>
      <div id="toast"></div>
      <div id="hudButtons">
        <button type="button" data-act="menu" class="hbtn">☰</button>
        <button type="button" data-act="weather" class="hbtn" id="btnWeather">☂</button>
        <button type="button" data-act="time" class="hbtn" id="btnTime">☀</button>
        <button type="button" data-act="camera" class="hbtn">◎</button>
        <button type="button" data-act="reset" class="hbtn">⟲</button>
      </div>
    </div>
    <div id="menu" hidden>
      <div class="panel">
        <h1>Lux Drive</h1>
        <div class="settings">
          <label><span data-i18n="set.language"></span>
            <select id="setLang">${LANGS.map((l) => `<option value="${l}">${LANG_NAMES[l]}</option>`).join('')}</select>
          </label>
          <label><span data-i18n="set.quality"></span>
            <select id="setQuality">${QUALITY_IDS.map((q) => `<option value="${q}">${q === 'auto' ? 'auto' : q}</option>`).join('')}</select>
          </label>
          <label><span data-i18n="set.weather"></span>
            <select id="setWeather">${['random', ...WEATHER_IDS].map((w) => `<option value="${w}">${w}</option>`).join('')}</select>
          </label>
          <label><span data-i18n="set.time"></span>
            <select id="setTime">${['random', ...TIME_IDS].map((h) => `<option value="${h}">${h}</option>`).join('')}</select>
          </label>
        </div>
        <p class="note" data-i18n="set.note"></p>
        <div class="buttons">
          <button type="button" data-act="drive" class="primary" data-i18n="menu.drive"></button>
          <button type="button" data-act="help" data-i18n="menu.help"></button>
          <button type="button" data-act="close" data-i18n="menu.close"></button>
        </div>
      </div>
    </div>
    <div id="help" hidden>
      <div class="panel">
        <h2 data-i18n="menu.help"></h2>
        <p data-i18n="help.drive"></p>
        <p data-i18n="help.other"></p>
        <div class="buttons"><button type="button" data-act="closeHelp" data-i18n="menu.close"></button></div>
      </div>
    </div>`;
  root.appendChild(el);

  const q = (sel) => el.querySelector(sel);
  const hud = q('#hud'), menu = q('#menu'), help = q('#help');
  const speedValue = q('#speedValue'), gearValue = q('#gearValue'), gearLabel = q('#gearLabel');
  const roadName = q('#roadName'), toastEl = q('#toast');
  const minimap = q('#minimap');
  const settings = { lang, quality: 'auto', weather: 'random', time: 'random' };
  let toastTimer = 0;

  /** Fills every element with a data-i18n key and writes the selects. */
  function applyLang(next) {
    settings.lang = next;
    for (const node of el.querySelectorAll('[data-i18n]')) node.textContent = t(next, node.dataset.i18n);
    q('#speedUnit').textContent = t(next, 'hud.speed');
    gearLabel.textContent = t(next, 'hud.gear');
    q('#setLang').value = next;
    // the options of the selects are translated too
    const fill = (select, ids, prefix) => {
      for (const option of select.options) {
        const id = option.value;
        option.textContent = id === 'random' ? t(next, 'set.random') : id === 'auto' ? t(next, 'set.auto') : t(next, `${prefix}.${id}`);
      }
      void ids;
    };
    fill(q('#setQuality'), QUALITY_IDS, 'quality');
    fill(q('#setWeather'), WEATHER_IDS, 'weather');
    fill(q('#setTime'), TIME_IDS, 'time');
    document.documentElement.lang = next;
  }
  applyLang(lang);

  // the controls
  el.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-act]');
    if (!button) return;
    onAction(button.dataset.act);
  });
  q('#setLang').addEventListener('change', (e) => { applyLang(e.target.value); onAction('language', e.target.value); });
  q('#setQuality').addEventListener('change', (e) => { settings.quality = e.target.value; onAction('quality', e.target.value); });
  q('#setWeather').addEventListener('change', (e) => { settings.weather = e.target.value; onAction('weather', e.target.value); });
  q('#setTime').addEventListener('change', (e) => { settings.time = e.target.value; onAction('time', e.target.value); });

  return {
    el, settings, minimap,
    /** The HUD appears when the world is ready (the loading screen is the page's own). */
    showHud() { hud.hidden = false; },
    showMenu(v) { menu.hidden = !v; },
    showHelp(v) { help.hidden = !v; },
    isMenuOpen: () => !menu.hidden,
    setSpeed(value, gear) {
      speedValue.textContent = String(Math.round(value));
      gearValue.textContent = gear > 0 ? String(gear) : 'N';
    },
    setRoad(name) { roadName.textContent = name || ''; },
    setToast(text, seconds = 2.4) {
      toastEl.textContent = text;
      toastEl.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('on'), seconds * 1000);
    },
    /** The settings of the menu, read back after a change. */
    getSettings() { return { ...settings }; },
    setQualityValue(v) { settings.quality = v; q('#setQuality').value = v; },
    setWeatherValue(v) { settings.weather = v; q('#setWeather').value = v; },
    setTimeValue(v) { settings.time = v; q('#setTime').value = v; },
    setLanguage(v) { applyLang(v); },
  };
}
