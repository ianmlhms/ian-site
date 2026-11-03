/* Texts of Lux Drive. Luxembourgish first, then German, English and French (the same four languages as the other arcade games).
 * `t(lang, key, params)` fills {name} placeholders. The harness checks that every key exists in all four languages and that every
 * placeholder of the Luxembourgish text is present in the others. */
export const LANGS = ['lb', 'de', 'en', 'fr'];
export const LANG_NAMES = Object.freeze({ lb: 'Lëtzebuergesch', de: 'Deutsch', en: 'English', fr: 'Français' });

const STR = {
  lb: {
    title: 'Lux Drive', loading: 'Luxemburg gëtt gelueden …', 'load.terrain': 'Gelände', 'load.roads': 'Stroossen', 'load.city': 'Stad', 'load.build': 'D\'Welt gëtt gebaut …', 'load.hills': 'Hiwwelen', 'load.bridges': 'Brücken', 'load.canopy': 'Bësch', 'load.classes': 'Land',
    'load.done': 'Fäerdeg', 'load.slow': 'Et dauert méi laang wéi gewinnt …', 'load.retry': 'Nei probéieren', 'load.error': 'D\'Spill konnt net gelueden ginn. Iwwerpréif d\'Verbindung.',
    'hud.speed': 'km/h', 'hud.gear': 'Gang', 'hud.road': 'Strooss', 'hud.menu': 'Menü', 'hud.weather': 'Wieder', 'hud.timeOfDay': 'Dageszäit', 'hud.camera': 'Kamera', 'hud.sound': 'Toun', 'hud.quality': 'Qualitéit', 'hud.reset': 'Zréck op den Ueufank', 'hud.area': 'Gebäit',
    'menu.title': 'Menü', 'menu.drive': 'Féieren', 'menu.settings': 'Astellungen', 'menu.help': 'Hëllef', 'menu.close': 'Zou', 'menu.resume': 'Weider', 'menu.start': 'Start', 'menu.restart': 'Nei starten', 'menu.language': 'Sprooch', 'menu.map': 'Kaart',
    'set.time': 'Dageszäit', 'set.weather': 'Wieder', 'set.quality': 'Qualitéit', 'set.language': 'Sprooch', 'set.sound': 'Toun', 'set.random': 'Zoufall', 'set.auto': 'Automatesch', 'set.on': 'un', 'set.off': 'aus',
    'time.dawn': 'Moies fréi', 'time.morning': 'Moien', 'time.noon': 'Mëttes', 'time.evening': 'Owes', 'time.dusk': 'Owendämmerung', 'time.night': 'Nuecht',
    'weather.clear': 'Klor', 'weather.cloudy': 'Bedeckt', 'weather.fog': 'Niwwel', 'weather.rain': 'Reen',
    'quality.low': 'Niddereg', 'quality.medium': 'Mëttel', 'quality.high': 'Héich',
    'set.note': 'D\'Wieder an d\'Dageszäitänneren den Aspects an de Gripp, ni d\'Punkten.',
    'help.keys': 'Tastatur', 'help.touch': 'Touch', 'help.other': 'R zréck op den Ueufank · C Kamera · T Dageszäit · G Wieder · M Toun · Esc Menü',
    'help.drive': 'W / ↑ acceleréieren · S / ↓ bremsen (a géint bei enger Standgrond réckgängeg) · A D / ← → lenken · Espace Handbrems',
    'touch.throttle': 'Gas', 'touch.brake': 'Brems', 'touch.handbrake': 'Handbrems', 'touch.steer': 'Lenken',
    'map.title': 'Kaart', 'map.legend': 'Stroossen', 'speed.limit': 'Vitesslimit', 'toast.reset': 'Zréck op Place de l\'Europe', 'orient.rotate': 'Dréi den iPad ze Quer fir besser Sicht', 'fs.enter': 'Ganze Schierm',
    'hud.crash': 'Hoppla!', 'hud.onRoad': 'Op de Strooss', 'hud.offRoad': ' ausserhalb vun der Strooss',
  },
  de: {
    title: 'Lux Drive', loading: 'Luxemburg wird geladen …', 'load.terrain': 'Gelände', 'load.roads': 'Straßen', 'load.city': 'Stadt', 'load.build': 'Die Welt wird gebaut …', 'load.hills': 'Hügel', 'load.bridges': 'Brücken', 'load.canopy': 'Wald', 'load.classes': 'Land',
    'load.done': 'Fertig', 'load.slow': 'Dauert länger als sonst …', 'load.retry': 'Nochmal versuchen', 'load.error': 'Das Spiel konnte nicht geladen werden. Prüfe die Verbindung.',
    'hud.speed': 'km/h', 'hud.gear': 'Gang', 'hud.road': 'Straße', 'hud.menu': 'Menü', 'hud.weather': 'Wetter', 'hud.timeOfDay': 'Tageszeit', 'hud.camera': 'Kamera', 'hud.sound': 'Ton', 'hud.quality': 'Qualität', 'hud.reset': 'Zurück zum Start', 'hud.area': 'Gebiet',
    'menu.title': 'Menü', 'menu.drive': 'Fahren', 'menu.settings': 'Einstellungen', 'menu.help': 'Hilfe', 'menu.close': 'Schließen', 'menu.resume': 'Weiter', 'menu.start': 'Start', 'menu.restart': 'Neu starten', 'menu.language': 'Sprache', 'menu.map': 'Karte',
    'set.time': 'Tageszeit', 'set.weather': 'Wetter', 'set.quality': 'Qualität', 'set.language': 'Sprache', 'set.sound': 'Ton', 'set.random': 'Zufall', 'set.auto': 'Automatisch', 'set.on': 'an', 'set.off': 'aus',
    'time.dawn': 'Früher Morgen', 'time.morning': 'Morgen', 'time.noon': 'Mittag', 'time.evening': 'Abend', 'time.dusk': 'Dämmerung', 'time.night': 'Nacht',
    'weather.clear': 'Klar', 'weather.cloudy': 'Bewölkt', 'weather.fog': 'Nebel', 'weather.rain': 'Regen',
    'quality.low': 'Niedrig', 'quality.medium': 'Mittel', 'quality.high': 'Hoch',
    'set.note': 'Wetter und Tageszeit ändern Aussicht und Grip, nie die Punkte.',
    'help.keys': 'Tastatur', 'help.touch': 'Touch', 'help.other': 'R zurück zum Start · C Kamera · T Tageszeit · G Wetter · M Ton · Esc Menü',
    'help.drive': 'W / ↑ beschleunigen · S / ↓ bremsen (im Stand rückwärts) · A D / ← → lenken · Leertaste Handbremse',
    'touch.throttle': 'Gas', 'touch.brake': 'Brems', 'touch.handbrake': 'Handbremse', 'touch.steer': 'Lenken',
    'map.title': 'Karte', 'map.legend': 'Straßen', 'speed.limit': 'Tempolimit', 'toast.reset': 'Zurück zur Place de l’Europe', 'orient.rotate': 'Drehe das iPad quer für bessere Sicht', 'fs.enter': 'Vollbild',
    'hud.crash': 'Hoppla!', 'hud.onRoad': 'Auf der Straße', 'hud.offRoad': ' neben der Straße',
  },
  en: {
    title: 'Lux Drive', loading: 'Loading Luxembourg …', 'load.terrain': 'Terrain', 'load.roads': 'Roads', 'load.city': 'City', 'load.build': 'Building the world …', 'load.hills': 'Hills', 'load.bridges': 'Bridges', 'load.canopy': 'Trees', 'load.classes': 'Land',
    'load.done': 'Done', 'load.slow': 'Taking longer than usual …', 'load.retry': 'Try again', 'load.error': 'The game could not be loaded. Check your connection.',
    'hud.speed': 'km/h', 'hud.gear': 'Gear', 'hud.road': 'Road', 'hud.menu': 'Menu', 'hud.weather': 'Weather', 'hud.timeOfDay': 'Time of day', 'hud.camera': 'Camera', 'hud.sound': 'Sound', 'hud.quality': 'Quality', 'hud.reset': 'Back to the start', 'hud.area': 'Area',
    'menu.title': 'Menu', 'menu.drive': 'Drive', 'menu.settings': 'Settings', 'menu.help': 'Help', 'menu.close': 'Close', 'menu.resume': 'Resume', 'menu.start': 'Start', 'menu.restart': 'Restart', 'menu.language': 'Language', 'menu.map': 'Map',
    'set.time': 'Time of day', 'set.weather': 'Weather', 'set.quality': 'Quality', 'set.language': 'Language', 'set.sound': 'Sound', 'set.random': 'Random', 'set.auto': 'Automatic', 'set.on': 'on', 'set.off': 'off',
    'time.dawn': 'Early morning', 'time.morning': 'Morning', 'time.noon': 'Midday', 'time.evening': 'Evening', 'time.dusk': 'Dusk', 'time.night': 'Night',
    'weather.clear': 'Clear', 'weather.cloudy': 'Cloudy', 'weather.fog': 'Fog', 'weather.rain': 'Rain',
    'quality.low': 'Low', 'quality.medium': 'Medium', 'quality.high': 'High',
    'set.note': 'The weather and the time of day change the look and the grip, never the points.',
    'help.keys': 'Keyboard', 'help.touch': 'Touch', 'help.other': 'R back to the start · C camera · T time of day · G weather · M sound · Esc menu',
    'help.drive': 'W / ↑ accelerate · S / ↓ brake (reverse when standing) · A D / ← → steer · Space handbrake',
    'touch.throttle': 'Gas', 'touch.brake': 'Brake', 'touch.handbrake': 'Handbrake', 'touch.steer': 'Steer',
    'map.title': 'Map', 'map.legend': 'Roads', 'speed.limit': 'Speed limit', 'toast.reset': 'Back to Place de l’Europe', 'orient.rotate': 'Turn the iPad sideways for a better view', 'fs.enter': 'Fullscreen',
    'hud.crash': 'Oops!', 'hud.onRoad': 'On the road', 'hud.offRoad': ' off the road',
  },
  fr: {
    title: 'Lux Drive', loading: 'Chargement du Luxembourg …', 'load.terrain': 'Relief', 'load.roads': 'Routes', 'load.city': 'Ville', 'load.build': 'Construction du monde …', 'load.hills': 'Collines', 'load.bridges': 'Ponts', 'load.canopy': 'Arbres', 'load.classes': 'Terrain',
    'load.done': 'Prêt', 'load.slow': 'Cela prend plus de temps que d’habitude …', 'load.retry': 'Réessayer', 'load.error': 'Le jeu n’a pas pu être chargé. Vérifie la connexion.',
    'hud.speed': 'km/h', 'hud.gear': 'Vitesse', 'hud.road': 'Route', 'hud.menu': 'Menu', 'hud.weather': 'Météo', 'hud.timeOfDay': 'Heure du jour', 'hud.camera': 'Caméra', 'hud.sound': 'Son', 'hud.quality': 'Qualité', 'hud.reset': 'Retour au départ', 'hud.area': 'Zone',
    'menu.title': 'Menu', 'menu.drive': 'Rouler', 'menu.settings': 'Réglages', 'menu.help': 'Aide', 'menu.close': 'Fermer', 'menu.resume': 'Continuer', 'menu.start': 'Départ', 'menu.restart': 'Recommencer', 'menu.language': 'Langue', 'menu.map': 'Carte',
    'set.time': 'Heure du jour', 'set.weather': 'Météo', 'set.quality': 'Qualité', 'set.language': 'Langue', 'set.sound': 'Son', 'set.random': 'Aléatoire', 'set.auto': 'Automatique', 'set.on': 'oui', 'set.off': 'non',
    'time.dawn': 'Aube', 'time.morning': 'Matin', 'time.noon': 'Midi', 'time.evening': 'Soir', 'time.dusk': 'Crépuscule', 'time.night': 'Nuit',
    'weather.clear': 'Dégagé', 'weather.cloudy': 'Nuageux', 'weather.fog': 'Brouillard', 'weather.rain': 'Pluie',
    'quality.low': 'Basse', 'quality.medium': 'Moyenne', 'quality.high': 'Haute',
    'set.note': 'La météo et l’heure du jour changent l’aspect et l’adhérence, jamais les points.',
    'help.keys': 'Clavier', 'help.touch': 'Tactile', 'help.other': 'R retour au départ · C caméra · T heure du jour · G météo · M son · Échap menu',
    'help.drive': 'W / ↑ accélérer · S / ↓ freiner (marche arrière à l’arrêt) · A D / ← → diriger · Espace frein à main',
    'touch.throttle': 'Accélérateur', 'touch.brake': 'Frein', 'touch.handbrake': 'Frein à main', 'touch.steer': 'Direction',
    'map.title': 'Carte', 'map.legend': 'Routes', 'speed.limit': 'Limite de vitesse', 'toast.reset': 'Retour à la Place de l’Europe', 'orient.rotate': 'Tourne l’iPad en paysage pour mieux voir', 'fs.enter': 'Plein écran',
    'hud.crash': 'Oups !', 'hud.onRoad': 'Sur la route', 'hud.offRoad': ' hors de la route',
  },
};

/** The text of a key in a language, with {placeholders} filled. */
export function t(lang, key, params) {
  const table = STR[lang] || STR.lb;
  let s = table[key];
  if (s === undefined) s = STR.lb[key];
  if (s === undefined) throw new Error(`i18n: unknown key "${key}"`);
  if (params) for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]));
  return s;
}

export const keysOf = (lang) => Object.keys(STR[lang] || {});
export const placeholders = (lang, key) => ((STR[lang] && STR[lang][key]) || '').match(/\{\w+\}/g) || [];

/** The speed in km/h, as a whole number. */
export const kmh = (mps) => Math.round(Math.abs(mps) * 3.6);
