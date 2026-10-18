/* Kart Lëtzebuerg — texts (lb default, de, en). KL.t(key, {vars}) */
(function () {
  'use strict';
  const KL = window.KL;
  const TXT = {
    lb: {
      title: 'Kart Lëtzebuerg', tagline: "Drift duerch d'Stad, schnapp d'Boxen a gewënn d'Rennen.",
      play: 'Rennen', playDesc: 'Solo géint 7 Bots', gp: 'Grand Prix', gpDesc: '4 Rennen, Punkten', tt: 'Zäitfueren', ttDesc: 'Géint däin Geescht', online: 'Online', onlineDesc: 'Mat Frënn',
      track: 'Streck', weather: 'Wieder', difficulty: 'Schwieregkeet', driver: 'Fuerer', laps: 'Ronnen', start: 'Lass!', back: 'Zréck', soon: 'Kënnt geschwënn',
      w_random: 'Zoufall', w_day: 'Dag', w_sunset: 'Sonnenënnergang', w_night: 'Nuecht', w_rain: 'Reen', w_fog: 'Niwwel',
      d_easy: 'Einfach', d_normal: 'Mëttel', d_hard: 'Schwéier',
      t_villehaute: 'Uewerstad', t_geeschterschlass: 'Geeschterschlass',
      t_villehaute_d: 'Gëlle Fra, Kathedral an Place Guillaume II duerch d\'Alstad', t_geeschterschlass_d: 'En ale Schlass am Niwwel: Kierfecht, Käerbessen a Fliedermais',
      cup_letzebuerg: 'Lëtzebuerg Cup', cup_fantasy: 'Fantasy Cup',
      lap: 'Ronn', place: 'Plaz', time: 'Zäit', best: 'Beschte', speed: 'km/h', go: 'LASS!', wrong: 'Falsch Richtung!', lastlap: 'Lescht Ronn!', newbest: 'Nei Bestzäit!',
      item_oil: 'Uelleg', item_orb: 'Kugel', item_rocket: 'Rakéit', item_shield: 'Schëld', item_boost: 'Turbo', item_boost3: '3× Turbo', item_comet: 'Komet',
      cometWarn: 'Komet kënnt!', rocketStart: 'Rakéitestart!',
      pause: 'Paus', resume: 'Weiderfueren', restart: 'Nei starten', quit: 'Zréck an de Menü', quality: 'Qualitéit', q_auto: 'Auto', q_low: 'Niddreg', q_medium: 'Mëttel', q_high: 'Héich',
      sound: 'Toun', sound_on: 'Toun un', sound_off: 'Toun aus', language: 'Sprooch', reset: 'Zréck op d\'Strooss',
      results: 'Resultat', raceTime: 'Rennzäit', bestLap: 'Beschte Ronn', again: 'Nach eng Kéier', menu: 'Menü', calc: 'Resultater gi berechent…',
      you: 'Du', dnf: 'net fäerdeg',
      controls: 'Pfeiltasten / WASD fueren · Leertaste Drift · E Objet · R Reset · P Paus · C Wieder',
      touchHint: 'Lénks wëschen = steieren',
      btn_drift: 'Drift', btn_item: 'Objet', btn_brake: 'Brems', btn_gas: 'Gas',
      loading: "D'Stad gëtt opgebaut…", engineError: "Den 3D-Motor konnt net starten. Probéier d'Säit nei ze lueden.",
      place1: '1.', fin: 'Am Zil!', hintDrift: 'Halt Drift an dréi: laang drifte gëtt e Turbo.', changeWeather: 'Wieder änneren',
    },
    de: {
      title: 'Kart Lëtzebuerg', tagline: 'Driftе durch die Stadt, schnapp dir die Boxen und gewinne das Rennen.',
      play: 'Rennen', playDesc: 'Solo gegen 7 Bots', gp: 'Grand Prix', gpDesc: '4 Rennen, Punkte', tt: 'Zeitfahren', ttDesc: 'Gegen deinen Geist', online: 'Online', onlineDesc: 'Mit Freunden',
      track: 'Strecke', weather: 'Wetter', difficulty: 'Schwierigkeit', driver: 'Fahrer', laps: 'Runden', start: 'Los!', back: 'Zurück', soon: 'Kommt bald',
      w_random: 'Zufall', w_day: 'Tag', w_sunset: 'Sonnenuntergang', w_night: 'Nacht', w_rain: 'Regen', w_fog: 'Nebel',
      d_easy: 'Leicht', d_normal: 'Mittel', d_hard: 'Schwer',
      t_villehaute: 'Oberstadt', t_geeschterschlass: 'Geisterschloss',
      t_villehaute_d: 'Gëlle Fra, Kathedrale und Place Guillaume II durch die Altstadt', t_geeschterschlass_d: 'Ein altes Schloss im Nebel: Friedhof, Kürbisse und Fledermäuse',
      cup_letzebuerg: 'Luxemburg-Cup', cup_fantasy: 'Fantasy-Cup',
      lap: 'Runde', place: 'Platz', time: 'Zeit', best: 'Beste', speed: 'km/h', go: 'LOS!', wrong: 'Falsche Richtung!', lastlap: 'Letzte Runde!', newbest: 'Neue Bestzeit!',
      item_oil: 'Öl', item_orb: 'Kugel', item_rocket: 'Rakete', item_shield: 'Schild', item_boost: 'Turbo', item_boost3: '3× Turbo', item_comet: 'Komet',
      cometWarn: 'Komet im Anflug!', rocketStart: 'Raketenstart!',
      pause: 'Pause', resume: 'Weiterfahren', restart: 'Neu starten', quit: 'Zurück zum Menü', quality: 'Qualität', q_auto: 'Auto', q_low: 'Niedrig', q_medium: 'Mittel', q_high: 'Hoch',
      sound: 'Ton', sound_on: 'Ton an', sound_off: 'Ton aus', language: 'Sprache', reset: 'Zurück auf die Straße',
      results: 'Ergebnis', raceTime: 'Rennzeit', bestLap: 'Beste Runde', again: 'Noch einmal', menu: 'Menü', calc: 'Ergebnisse werden berechnet…',
      you: 'Du', dnf: 'nicht im Ziel',
      controls: 'Pfeiltasten / WASD fahren · Leertaste Drift · E Item · R Reset · P Pause · C Wetter',
      touchHint: 'Links wischen = lenken',
      btn_drift: 'Drift', btn_item: 'Item', btn_brake: 'Bremse', btn_gas: 'Gas',
      loading: 'Die Stadt wird aufgebaut…', engineError: 'Die 3D-Engine konnte nicht starten. Lade die Seite neu.',
      place1: '1.', fin: 'Im Ziel!', hintDrift: 'Halte Drift und lenke: langes Driften gibt einen Turbo.', changeWeather: 'Wetter ändern',
    },
    en: {
      title: 'Kart Lëtzebuerg', tagline: 'Drift through the city, grab the boxes and win the race.',
      play: 'Race', playDesc: 'Solo against 7 bots', gp: 'Grand Prix', gpDesc: '4 races, points', tt: 'Time trial', ttDesc: 'Against your ghost', online: 'Online', onlineDesc: 'With friends',
      track: 'Track', weather: 'Weather', difficulty: 'Difficulty', driver: 'Driver', laps: 'Laps', start: 'Go!', back: 'Back', soon: 'Coming soon',
      w_random: 'Random', w_day: 'Day', w_sunset: 'Sunset', w_night: 'Night', w_rain: 'Rain', w_fog: 'Fog',
      d_easy: 'Easy', d_normal: 'Normal', d_hard: 'Hard',
      t_villehaute: 'Upper Town', t_geeschterschlass: 'Ghost Castle',
      t_villehaute_d: 'Gëlle Fra, the cathedral and Place Guillaume II through the old town', t_geeschterschlass_d: 'An old castle in the fog: graveyard, pumpkins and bats',
      cup_letzebuerg: 'Luxembourg Cup', cup_fantasy: 'Fantasy Cup',
      lap: 'Lap', place: 'Place', time: 'Time', best: 'Best', speed: 'km/h', go: 'GO!', wrong: 'Wrong way!', lastlap: 'Final lap!', newbest: 'New best!',
      item_oil: 'Oil', item_orb: 'Orb', item_rocket: 'Rocket', item_shield: 'Shield', item_boost: 'Boost', item_boost3: '3× Boost', item_comet: 'Comet',
      cometWarn: 'Comet incoming!', rocketStart: 'Rocket start!',
      pause: 'Pause', resume: 'Resume', restart: 'Restart', quit: 'Back to menu', quality: 'Quality', q_auto: 'Auto', q_low: 'Low', q_medium: 'Medium', q_high: 'High',
      sound: 'Sound', sound_on: 'Sound on', sound_off: 'Sound off', language: 'Language', reset: 'Back on the road',
      results: 'Results', raceTime: 'Race time', bestLap: 'Best lap', again: 'Race again', menu: 'Menu', calc: 'Calculating results…',
      you: 'You', dnf: 'did not finish',
      controls: 'Arrow keys / WASD drive · Space drift · E item · R reset · P pause · C weather',
      touchHint: 'Swipe on the left to steer',
      btn_drift: 'Drift', btn_item: 'Item', btn_brake: 'Brake', btn_gas: 'Gas',
      loading: 'Building the city…', engineError: 'The 3D engine could not start. Reload the page.',
      place1: '1st', fin: 'Finished!', hintDrift: 'Hold drift and steer: long drifts give a boost.', changeWeather: 'Change weather',
    },
  };
  TXT.de.tagline = 'Drifte durch die Stadt, schnapp dir die Boxen und gewinne das Rennen.';
  let lang = 'lb';
  KL.lang = () => lang;
  KL.setLang = (l) => { if (TXT[l]) { lang = l; document.documentElement.lang = l; try { localStorage.setItem('site_lang', l); } catch (e) { /* storage may be blocked */ } } };
  KL.t = (key, vars) => {
    let s = (TXT[lang] && TXT[lang][key]) || TXT.en[key] || key;
    if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
    return s;
  };
  KL.copy = TXT;
  try { const l = localStorage.getItem('site_lang'); if (TXT[l]) lang = l; } catch (e) { /* ignore */ }
  document.documentElement.lang = lang;
})();
