/* The interface of Lux Drive: the start menu, the pause menu, the settings, the weather / time chooser, the HUD and the
 * container of the full-screen Kaart.
 *
 * The DOM is built here (no template files), the texts come from i18n.js, and every control reports back through
 * `onAction(action, value)` so that the game loop stays in charge of the state.  Weather and time of day are chosen with
 * chips; "Random" comes first and is the default (Ian's rule: always customisable, random by default).
 * The language changes live (no reload). */
import { t, LANG_NAMES, LANGS } from './i18n.js';
import { TIME_PRESETS, WEATHER_IDS } from './env.js';
import { CAR_COLOURS, CAR_COLOUR_IDS } from './config.js';

const TIME_IDS = Object.keys(TIME_PRESETS);
const QUALITY_IDS = ['auto', 'low', 'medium', 'high'];
const CAMERA_IDS = ['chase', 'far', 'bonnet'];
const WEATHER_ICON = Object.freeze({ random: '🎲', clear: '☀️', cloudy: '☁️', fog: '🌫️', rain: '🌧️' });
const TIME_ICON = Object.freeze({ random: '🎲', dawn: '🌅', morning: '🌄', noon: '☀️', evening: '🌇', dusk: '🌆', night: '🌙' });
const CAMERA_ICON = Object.freeze({ chase: '🚗', far: '🔭', bonnet: '👁️' });
const TOAST_S = 2.4;
const CHOOSER_IDLE_MS = 12000;         // the in-game chooser closes itself after this long without a tap (0 = never: the flows)
const OVERLAYS = ['start', 'pause', 'settings', 'help'];       // the overlays that stop the car

const chip = (group, value, icon, key) =>
  `<button type="button" class="chip" data-group="${group}" data-value="${value}" aria-pressed="false"><span class="ico">${icon}</span><span class="lbl" data-i18n="${key}"></span></button>`;
const chipRow = (group, ids, iconOf, keyOf) => ids.map((id) => chip(group, id, iconOf(id), keyOf(id))).join('');
const weatherChips = (g) => chipRow(g, ['random', ...WEATHER_IDS], (id) => WEATHER_ICON[id], (id) => `weather.${id}`);
const timeChips = (g) => chipRow(g, ['random', ...TIME_IDS], (id) => TIME_ICON[id], (id) => `time.${id}`);
const langChips = (g) => LANGS.map((l) => `<button type="button" class="chip" data-group="${g}" data-value="${l}" aria-pressed="false"><span class="lbl">${LANG_NAMES[l]}</span></button>`).join('');
const qualityChips = (g) => chipRow(g, QUALITY_IDS, () => '', (id) => (id === 'auto' ? 'set.auto' : `quality.${id}`));
const soundChips = (g) => chip(g, 'on', '🔊', 'set.on') + chip(g, 'off', '🔇', 'set.off');
const cameraChips = (g) => chipRow(g, CAMERA_IDS, (id) => CAMERA_ICON[id], (id) => `cam.${id}`);
const colourDots = (g) => CAR_COLOUR_IDS.map((id) => `<button type="button" class="dot" data-group="${g}" data-value="${id}" aria-pressed="false" aria-label="${id}" style="--c:${CAR_COLOURS[id]}"></button>`).join('');

export function createUI({ root, lang = 'lb', onAction = () => {} }) {
  const el = document.createElement('div');
  el.id = 'ui';
  el.innerHTML = `
    <div id="hud" hidden>
      <div id="hudTL">
        <div id="speedo"><span id="speedValue">0</span><small id="speedUnit">km/h</small></div>
        <div id="limitSign" hidden aria-live="off"><span id="limitValue">50</span></div>
      </div>
      <div id="roadName"></div>
      <div id="hudTR">
        <div id="hudButtons">
          <button type="button" data-act="menu" class="hbtn" id="btnMenu" aria-label="Menu">☰</button>
          <button type="button" data-act="map" class="hbtn" id="btnMap" aria-label="Kaart">🗺️</button>
          <button type="button" data-act="chooser" class="hbtn" id="btnChooser" aria-label="Wieder">⛅</button>
          <button type="button" data-act="camera" class="hbtn" id="btnCamera" aria-label="Kamera">🎥</button>
          <button type="button" data-act="reset" class="hbtn" id="btnReset" aria-label="Reset">⟲</button>
        </div>
        <canvas id="minimap" width="360" height="360" role="button" tabindex="0"></canvas>
      </div>
      <div id="chooser" hidden>
        <div class="chRow"><b data-i18n="set.weather"></b><div class="chips" id="chooseWeather">${weatherChips('weather')}</div></div>
        <div class="chRow"><b data-i18n="set.time"></b><div class="chips" id="chooseTime">${timeChips('time')}</div></div>
      </div>
      <div id="toast" role="status"></div>
      <div id="rainFx" aria-hidden="true"></div>
    </div>

    <div id="start" class="overlay" hidden>
      <div class="box wide">
        <div class="head"><h1>Lux Drive</h1><p class="tagline" data-i18n="start.tagline"></p></div>
        <div class="grid">
          <section><h3 data-i18n="set.language"></h3><div class="chips">${langChips('lang')}</div></section>
          <section><h3 data-i18n="set.weather"></h3><div class="chips">${weatherChips('weather')}</div></section>
          <section><h3 data-i18n="set.time"></h3><div class="chips">${timeChips('time')}</div></section>
          <section><h3 data-i18n="set.quality"></h3><div class="chips">${qualityChips('quality')}</div></section>
        </div>
        <p class="note" data-i18n="start.hint"></p>
        <div class="actions"><button type="button" class="primary big" data-act="drive" data-i18n="menu.drive"></button><button type="button" data-act="help" data-i18n="menu.help"></button></div>
      </div>
    </div>

    <div id="pause" class="overlay" hidden>
      <div class="box narrow">
        <h2 data-i18n="menu.pause"></h2>
        <div class="stack">
          <button type="button" class="primary big" data-act="resume" data-i18n="menu.resume"></button>
          <button type="button" data-act="map" data-i18n="menu.map"></button>
          <button type="button" data-act="chooser" data-i18n="set.weather"></button>
          <button type="button" data-act="settings" data-i18n="menu.settings"></button>
          <button type="button" data-act="help" data-i18n="menu.help"></button>
          <button type="button" data-act="restart" data-i18n="menu.restart"></button>
        </div>
      </div>
    </div>

    <div id="settings" class="overlay" hidden>
      <div class="box wide">
        <h2 data-i18n="menu.settings"></h2>
        <div class="grid">
          <section><h3 data-i18n="set.language"></h3><div class="chips">${langChips('lang')}</div></section>
          <section><h3 data-i18n="set.quality"></h3><div class="chips">${qualityChips('quality')}</div></section>
          <section><h3 data-i18n="set.weather"></h3><div class="chips">${weatherChips('weather')}</div></section>
          <section><h3 data-i18n="set.time"></h3><div class="chips">${timeChips('time')}</div></section>
          <section><h3 data-i18n="set.camera"></h3><div class="chips">${cameraChips('camera')}</div></section>
          <section><h3 data-i18n="set.sound"></h3><div class="chips">${soundChips('sound')}</div></section>
          <section><h3 data-i18n="set.colour"></h3><div class="chips dots">${colourDots('colour')}</div></section>
        </div>
        <p class="note" data-i18n="set.note"></p>
        <div class="actions"><button type="button" class="primary" data-act="back" data-i18n="menu.back"></button><button type="button" data-act="fullscreen" id="btnFullscreen" data-i18n="menu.fullscreen"></button></div>
      </div>
    </div>

    <div id="help" class="overlay" hidden>
      <div class="box narrow">
        <h2 data-i18n="menu.help"></h2>
        <h3 data-i18n="help.keys"></h3><p data-i18n="help.drive"></p><p data-i18n="help.other"></p>
        <h3 data-i18n="help.touch"></h3><p data-i18n="help.touchText"></p>
        <div class="actions"><button type="button" class="primary" data-act="closeHelp" data-i18n="menu.close"></button></div>
      </div>
    </div>

    <div id="mapOverlay" hidden>
      <canvas id="mapCanvas" aria-label="Kaart"></canvas>
      <div class="mapBar"><b data-i18n="map.title"></b><span data-i18n="map.hint"></span><button type="button" class="hbtn" data-act="closeMap" aria-label="Close">✕</button></div>
      <div class="mapZoom"><button type="button" class="hbtn" data-zoom="in" aria-label="+">＋</button><button type="button" class="hbtn" data-zoom="out" aria-label="−">－</button></div>
    </div>

    <div id="orient" hidden data-i18n="orient.rotate"></div>`;
  root.appendChild(el);

  const q = (sel) => el.querySelector(sel);
  const all = (sel) => [...el.querySelectorAll(sel)];
  const hud = q('#hud'), toastEl = q('#toast'), chooser = q('#chooser');
  const settings = { lang, quality: 'auto', weather: 'random', time: 'random', camera: 'chase', colour: 'red', sound: 'on' };
  let toastTimer = 0, chooserTimer = 0, chooserIdleMs = CHOOSER_IDLE_MS;

  /** Marks the chips of a group: the one with `value` is pressed. */
  function markChips(group, value) {
    for (const node of all(`[data-group="${group}"]`)) node.setAttribute('aria-pressed', String(node.dataset.value === value));
  }

  /** Fills every element with a data-i18n key. */
  function applyLang(next) {
    settings.lang = next;
    for (const node of el.querySelectorAll('[data-i18n]')) node.textContent = t(next, node.dataset.i18n);
    q('#speedUnit').textContent = t(next, 'hud.speed');
    q('#btnMenu').setAttribute('aria-label', t(next, 'menu.title'));
    q('#btnMap').setAttribute('aria-label', t(next, 'menu.map'));
    q('#btnChooser').setAttribute('aria-label', `${t(next, 'set.weather')} / ${t(next, 'set.time')}`);
    q('#btnCamera').setAttribute('aria-label', t(next, 'hud.camera'));
    q('#btnReset').setAttribute('aria-label', t(next, 'hud.reset'));
    q('#mapCanvas').setAttribute('aria-label', t(next, 'map.title'));
    q('#limitSign').setAttribute('title', t(next, 'speed.limit'));
    markChips('lang', next);
    document.documentElement.lang = next;
  }
  applyLang(lang);
  for (const group of Object.keys(settings)) if (group !== 'lang') markChips(group, settings[group]);

  // ---- the controls: buttons report their action, chips report (group, value)
  el.addEventListener('click', (e) => {
    const chipNode = e.target.closest('[data-group]');
    if (chipNode) {
      const group = chipNode.dataset.group, value = chipNode.dataset.value;
      if (group === 'lang') applyLang(value);
      settings[group] = value;
      markChips(group, value);
      onAction(group === 'lang' ? 'language' : group, value);
      if (group === 'weather' || group === 'time') armChooserTimer();
      return;
    }
    const button = e.target.closest('button[data-act]');
    if (button) onAction(button.dataset.act);
  });
  q('#minimap').addEventListener('click', () => onAction('map'));
  chooser.addEventListener('pointerdown', () => armChooserTimer());          // a finger on the chooser keeps it open

  function armChooserTimer() {
    clearTimeout(chooserTimer);
    if (!chooser.hidden && chooserIdleMs > 0) chooserTimer = setTimeout(() => { chooser.hidden = true; }, chooserIdleMs);
  }

  // ---- the page must never scroll, zoom or select while it is played (iPad Safari)
  const block = (e) => e.preventDefault();
  document.addEventListener('gesturestart', block);
  document.addEventListener('gesturechange', block);
  document.addEventListener('dblclick', block);
  document.addEventListener('touchmove', (e) => { if (!e.target.closest('.box')) e.preventDefault(); }, { passive: false });
  const orient = q('#orient');
  const checkOrientation = () => { orient.hidden = !(window.innerHeight > window.innerWidth * 1.05 && (navigator.maxTouchPoints > 0)); };
  window.addEventListener('resize', checkOrientation);
  checkOrientation();

  const show = (node, v) => { node.hidden = !v; document.body.classList.toggle(`open-${node.id}`, v); };

  return {
    el, settings, minimap: q('#minimap'),
    mapContainer: q('#mapOverlay'),
    /** The HUD appears when the world is ready (the loading screen is the page's own). */
    showHud() { hud.hidden = false; },
    showStart(v) { show(q('#start'), v); },
    showPause(v) { show(q('#pause'), v); },
    showSettings(v) { show(q('#settings'), v); },
    showHelp(v) { show(q('#help'), v); },
    showChooser(v) { chooser.hidden = !v; armChooserTimer(); },
    isChooserOpen: () => !chooser.hidden,
    /** How long the in-game chooser stays open without a tap (ms, 0 = until the button is tapped again). */
    setChooserIdle(ms) { chooserIdleMs = ms; clearTimeout(chooserTimer); armChooserTimer(); },
    showMap(v) { show(q('#mapOverlay'), v); },
    isMapOpen: () => !q('#mapOverlay').hidden,
    isOpen: (id) => !q(`#${id}`).hidden,
    /** True while an overlay that stops the car is up (the start menu, the pause menu, the settings, the help, the map). */
    isBlocking: () => OVERLAYS.some((id) => !q(`#${id}`).hidden) || !q('#mapOverlay').hidden,
    closeOverlays() { for (const id of OVERLAYS) show(q(`#${id}`), false); },
    setSpeed(kmh, limit) {
      q('#speedValue').textContent = String(Math.round(kmh));
      q('#speedo').classList.toggle('over', limit > 0 && kmh > limit + 6);
    },
    /** The speed-limit sign (0 = off the roads: no sign). */
    setLimit(kmh) {
      const sign = q('#limitSign');
      sign.hidden = !(kmh > 0);
      if (kmh > 0) q('#limitValue').textContent = String(kmh);
    },
    setRoad(name) { q('#roadName').textContent = name || ''; q('#roadName').classList.toggle('on', !!name); },
    setToast(text, seconds = TOAST_S) {
      toastEl.textContent = text;
      toastEl.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('on'), seconds * 1000);
    },
    /** The rain overlay: 0 = dry .. 1 = pouring. */
    setRain(amount) { q('#rainFx').style.opacity = String(Math.min(1, amount)); },
    /** The icon of the weather / time button follows the weather. */
    setChooserIcon(icon) { q('#btnChooser').textContent = icon; },
    /** The settings of the menu, read back after a change. */
    getSettings() { return { ...settings }; },
    setValue(group, value) { settings[group] = value; markChips(group, value); },
    setFullscreenAvailable(v) { q('#btnFullscreen').hidden = !v; },
    setLanguage(v) { applyLang(v); },
  };
}
