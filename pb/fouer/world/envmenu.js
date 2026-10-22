/* Schueberfouer Tycoon, W2: the weather / time-of-day controls (Ian's standing rule: player-choosable in a menu AND an in-game button, Random is the default,
 * the choice is remembered per device).  Mounts into the stage page: #envBtn + #envPop (in-game popover), #menuBtn + #menu (menu panel with the same
 * controls plus quality and pitch markers), #frameBtn (frame the field).  Strings lb / de / en, language from localStorage.site_lang (default lb). */
const TXT = {
  lb: { weather: 'Wieder', time: 'Zäit vum Dag', quality: 'Qualitéit', markers: 'Plazmarkéierungen', camera: 'Kamera', menu: 'Menü', frame: 'Ganze Festplaz weisen', look: 'Aussiicht',
    random: 'Zoufall', clear: 'Sonneschäin', cloudy: 'Wolleg', rain: 'Reen', fog: 'Niwwel', morning: 'Moien', noon: 'Mëtteg', evening: 'Owend', night: 'Nuecht', live: 'Live',
    low: 'Niddreg', medium: 'Mëttel', high: 'Héich', off: 'Aus', outline: 'Linnen', glow: 'Gëllen', envLabel: 'Wieder an Zäit', hint: 'Net verbonnen mam Akommes.', close: 'Zou' },
  de: { weather: 'Wetter', time: 'Tageszeit', quality: 'Qualität', markers: 'Platzmarkierungen', camera: 'Kamera', menu: 'Menü', frame: 'Ganzen Festplatz zeigen', look: 'Ansicht',
    random: 'Zufall', clear: 'Sonnig', cloudy: 'Bewölkt', rain: 'Regen', fog: 'Nebel', morning: 'Morgen', noon: 'Mittag', evening: 'Abend', night: 'Nacht', live: 'Live',
    low: 'Niedrig', medium: 'Mittel', high: 'Hoch', off: 'Aus', outline: 'Linien', glow: 'Golden', envLabel: 'Wetter und Tageszeit', hint: 'Hat keinen Einfluss auf die Einnahmen.', close: 'Schließen' },
  en: { weather: 'Weather', time: 'Time of day', quality: 'Quality', markers: 'Pitch markers', camera: 'Camera', menu: 'Menu', frame: 'Frame the whole fair ground', look: 'Look',
    random: 'Random', clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', fog: 'Fog', morning: 'Morning', noon: 'Noon', evening: 'Evening', night: 'Night', live: 'Live',
    low: 'Low', medium: 'Medium', high: 'High', off: 'Off', outline: 'Outline', glow: 'Glow', envLabel: 'Weather and time', hint: 'Does not change your income.', close: 'Close' },
};
const ICON = { random: '🎲', clear: '☀️', cloudy: '⛅', rain: '🌧️', fog: '🌫️', morning: '🌅', noon: '☀️', evening: '🌇', night: '🌙', live: '🕒' };
export function pickLang() { try { const l = localStorage.getItem('site_lang'); if (TXT[l]) return l; } catch (e) { /* ignore */ } const d = (document.documentElement.lang || 'lb').slice(0, 2); return TXT[d] ? d : 'lb'; }

export function mountEnvUi({ env, r, pitches, lang = pickLang() }) {
  const t = TXT[lang] || TXT.en;
  const $ = (id) => document.getElementById(id);
  const envBtn = $('envBtn'); const envPop = $('envPop'); const menuBtn = $('menuBtn'); const menu = $('menu'); const frameBtn = $('frameBtn');
  document.documentElement.lang = lang;
  envBtn.setAttribute('aria-label', t.envLabel); frameBtn.setAttribute('aria-label', t.frame); menuBtn.setAttribute('aria-label', t.menu); frameBtn.title = t.frame;

  const chips = [];       // { el, group, value }
  function chip(group, value, label, onPick, sub) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.group = group; b.dataset.value = value;
    b.innerHTML = '<span aria-hidden="true">' + (ICON[value] || '') + '</span> ' + label + (sub ? '<small>' + sub + '</small>' : '');
    b.addEventListener('click', () => { onPick(value); refresh(); });
    chips.push({ el: b, group, value });
    return b;
  }
  function section(parent, title, group, values, onPick, labelOf = (v) => t[v]) {
    const h = document.createElement('h3'); h.textContent = title; parent.appendChild(h);
    const row = document.createElement('div'); row.className = 'row'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', title);
    values.forEach((v) => row.appendChild(chip(group, v, labelOf(v), onPick)));
    parent.appendChild(row);
  }
  const buildEnvControls = (parent, tag) => {
    section(parent, t.weather, 'weather' + tag, env.WEATHER_MODES, (v) => env.setWeather(v));
    section(parent, t.time, 'time' + tag, env.TIME_MODES, (v) => env.setTime(v));
  };
  // in-game popover
  envPop.innerHTML = ''; buildEnvControls(envPop, '');
  const hint = document.createElement('small'); hint.textContent = t.hint; hint.style.cssText = 'display:block;color:var(--muted);font-size:11px;margin-top:2px'; envPop.appendChild(hint);
  // menu panel
  menu.innerHTML = '';
  const title = document.createElement('h3'); title.textContent = t.look; menu.appendChild(title);
  buildEnvControls(menu, 'M');
  section(menu, t.quality, 'quality', ['low', 'medium', 'high'], (v) => r.setQuality(v));
  if (pitches) section(menu, t.markers, 'markers', ['off', 'outline', 'glow'], (v) => pitches.setMode(v));
  const camRow = document.createElement('div'); camRow.className = 'row';
  const fb = document.createElement('button'); fb.type = 'button'; fb.className = 'chip'; fb.textContent = '⤢ ' + t.frame; fb.addEventListener('click', () => { r.frameField(true); }); camRow.appendChild(fb);
  const h3 = document.createElement('h3'); h3.textContent = t.camera; menu.appendChild(h3); menu.appendChild(camRow);

  function refresh() {
    const s = env.getState();
    chips.forEach(({ el, group, value }) => {
      let on = false;
      if (group.startsWith('weather')) on = s.weatherMode === value; else if (group.startsWith('time')) on = s.timeMode === value;
      else if (group === 'quality') on = r.state.quality === value; else if (group === 'markers') on = pitches && pitches.mode === value;
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // the in-game button shows what the sky is doing right now
    const night = s.night > 0.5;
    envBtn.textContent = s.weather === 'rain' ? '🌧️' : s.weather === 'fog' ? '🌫️' : s.weather === 'cloudy' ? (night ? '☁️' : '⛅') : night ? '🌙' : s.hour < 10 ? '🌅' : s.hour > 18.2 ? '🌇' : '☀️';
    envBtn.dataset.weather = s.weather; envBtn.dataset.night = night ? '1' : '0';
  }
  const toggle = (pop, btn, other, otherBtn) => { const open = pop.hidden; pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) { other.hidden = true; otherBtn.setAttribute('aria-expanded', 'false'); refresh(); const first = pop.querySelector('button'); if (first) first.focus({ preventScroll: true }); } };
  envBtn.addEventListener('click', () => toggle(envPop, envBtn, menu, menuBtn));
  menuBtn.addEventListener('click', () => toggle(menu, menuBtn, envPop, envBtn));
  frameBtn.addEventListener('click', () => r.frameField(true));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { [envPop, menu].forEach((p) => { p.hidden = true; }); envBtn.setAttribute('aria-expanded', 'false'); menuBtn.setAttribute('aria-expanded', 'false'); } });
  document.getElementById('fouerCanvas').addEventListener('pointerdown', () => { envPop.hidden = true; menu.hidden = true; envBtn.setAttribute('aria-expanded', 'false'); menuBtn.setAttribute('aria-expanded', 'false'); });
  env.onChange(() => refresh());
  r.on('quality', refresh);
  refresh();
  return { refresh, t, lang };
}
