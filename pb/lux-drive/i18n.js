/* Texts of Lux Drive. Luxembourgish first, then German, English and French (the same four languages as the other arcade games).
 * `t(lang, key, params)` fills {name} placeholders. The harness checks that every key exists in all four languages and that every
 * placeholder of the Luxembourgish text is present in the others. */
export const LANGS = ['lb', 'de', 'en', 'fr'];
export const LANG_NAMES = Object.freeze({ lb: 'Lëtzebuergesch', de: 'Deutsch', en: 'English', fr: 'Français' });

const STR = {
  lb: {
    title: 'Lux Drive', loading: 'Lëtzebuerg gëtt gelueden …', 'load.terrain': 'Terrain', 'load.roads': 'Stroossen', 'load.city': 'Stad', 'load.build': 'D\'Welt gëtt gebaut …', 'load.hills': 'Hiwwelen', 'load.bridges': 'Brécken', 'load.canopy': 'Bësch', 'load.trees': 'Beem', 'load.classes': 'Land',
    'load.done': 'Fäerdeg', 'load.slow': 'Et dauert méi laang wéi gewinnt …', 'load.retry': 'Nei probéieren', 'load.error': 'D\'Spill konnt net geluede ginn. Kuck d\'Verbindung no.',
    'hud.speed': 'km/h', 'hud.gear': 'Gang', 'hud.road': 'Strooss', 'hud.menu': 'Menü', 'hud.weather': 'Wieder', 'hud.timeOfDay': 'Dageszäit', 'hud.camera': 'Kamera', 'hud.sound': 'Toun', 'hud.quality': 'Qualitéit', 'hud.reset': 'Zréck op den Ufank', 'hud.area': 'Gebitt',
    'menu.title': 'Menü', 'menu.drive': 'Fueren', 'menu.settings': 'Astellungen', 'menu.help': 'Hëllef', 'menu.close': 'Zoumaachen', 'menu.resume': 'Weider', 'menu.start': 'Start', 'menu.restart': 'Nei starten', 'menu.language': 'Sprooch', 'menu.map': 'Kaart',
    'set.time': 'Dageszäit', 'set.weather': 'Wieder', 'set.quality': 'Qualitéit', 'set.language': 'Sprooch', 'set.sound': 'Toun', 'set.random': 'Zoufall', 'set.auto': 'Automatesch', 'set.on': 'un', 'set.off': 'aus',
    'time.dawn': 'Moies fréi', 'time.morning': 'Moies', 'time.noon': 'Mëttes', 'time.evening': 'Owend', 'time.dusk': 'Dämmerung', 'time.night': 'Nuecht',
    'weather.clear': 'Klor', 'weather.cloudy': 'Wollekeg', 'weather.fog': 'Niwwel', 'weather.rain': 'Reen',
    'quality.low': 'Niddereg', 'quality.medium': 'Mëttel', 'quality.high': 'Héich',
    'set.note': 'Wieder an Dageszäit änneren d\'Sicht an d\'Haftung op der Strooss.',
    'help.keys': 'Tastatur', 'help.touch': 'Touch', 'help.other': 'R zréck op den Ufank · C Kamera · T Dageszäit · G Wieder · M Kaart · Esc Pause',
    'help.drive': 'W / ↑ Gas ginn · S / ↓ bremsen (am Stand réckwärts) · A D / ← → lenken · Espace Handbrems',
    'touch.throttle': 'Gas', 'touch.brake': 'Brems', 'touch.handbrake': 'Handbrems', 'touch.steer': 'Lenken',
    'map.title': 'Kaart', 'map.legend': 'Stroossen', 'speed.limit': 'Vitessebegrenzung', 'toast.reset': 'Zréck op d\'Place de l\'Europe', 'orient.rotate': 'Dréi den iPad op d\'Säit, da gesäis du méi.', 'fs.enter': 'Ganze Bildschierm',
    'set.colour': 'Faarf', 
    'toast.unstuck': 'Zréck op d\'Strooss gesat.', 
    'start.tagline': 'Fuer duerch Lëtzebuerg-Stad an Nidderaanwen.', 'start.hint': 'Wieder an Dageszäit sinn all Kéier anescht, ausser du wiels se.', 'menu.pause': 'Pause', 'menu.settings2': 'Astellungen', 'menu.back': 'Zréck', 'menu.fullscreen': 'Ganze Bildschierm',
    'weather.random': 'Zoufall', 'time.random': 'Zoufall', 'set.camera': 'Kamera', 'cam.chase': 'Hannert dem Auto', 'cam.far': 'Wäit hannendrun', 'cam.bonnet': 'Motorhaub',
    'map.hint': 'Tipp op eng Strooss, fir dohinner ze kommen.', 'map.here': 'Hei bass du', 'map.zoomIn': 'Méi no', 'map.zoomOut': 'Méi wäit', 'map.teleport': 'Elo op {name}', 'map.unnamed': 'Strooss ouni Numm', 'map.noRoad': 'Do ass keng Strooss.',
    'toast.wet': 'Naass Strooss: manner Haftung', 'toast.quality': 'Qualitéit: {q}', 'touch.left': 'Lénks', 'touch.right': 'Riets', 'help.touchText': 'Lénks lenken, riets Gas, Brems an Handbrems.', 'hud.limit': 'Limit',
    'hud.crash': 'Hoppla!', 'hud.onRoad': 'Op der Strooss', 'hud.offRoad': 'Niewent der Strooss',
  },
  de: {
    title: 'Lux Drive', loading: 'Luxemburg wird geladen …', 'load.terrain': 'Gelände', 'load.roads': 'Straßen', 'load.city': 'Stadt', 'load.build': 'Die Welt wird gebaut …', 'load.hills': 'Hügel', 'load.bridges': 'Brécken', 'load.canopy': 'Wald', 'load.trees': 'Bäume', 'load.classes': 'Land',
    'load.done': 'Fertig', 'load.slow': 'Dauert länger als sonst …', 'load.retry': 'Nochmal versuchen', 'load.error': 'Das Spiel konnte nicht geladen werden. Prüfe die Verbindung.',
    'hud.speed': 'km/h', 'hud.gear': 'Gang', 'hud.road': 'Straße', 'hud.menu': 'Menü', 'hud.weather': 'Wetter', 'hud.timeOfDay': 'Tageszeit', 'hud.camera': 'Kamera', 'hud.sound': 'Ton', 'hud.quality': 'Qualität', 'hud.reset': 'Zurück zum Start', 'hud.area': 'Gebiet',
    'menu.title': 'Menü', 'menu.drive': 'Fahren', 'menu.settings': 'Einstellungen', 'menu.help': 'Hilfe', 'menu.close': 'Schließen', 'menu.resume': 'Weiter', 'menu.start': 'Start', 'menu.restart': 'Neu starten', 'menu.language': 'Sprache', 'menu.map': 'Karte',
    'set.time': 'Tageszeit', 'set.weather': 'Wetter', 'set.quality': 'Qualität', 'set.language': 'Sprache', 'set.sound': 'Ton', 'set.random': 'Zufall', 'set.auto': 'Automatisch', 'set.on': 'an', 'set.off': 'aus',
    'time.dawn': 'Früher Morgen', 'time.morning': 'Morgen', 'time.noon': 'Mittag', 'time.evening': 'Abend', 'time.dusk': 'Dämmerung', 'time.night': 'Nacht',
    'weather.clear': 'Klar', 'weather.cloudy': 'Bewölkt', 'weather.fog': 'Nebel', 'weather.rain': 'Regen',
    'quality.low': 'Niedrig', 'quality.medium': 'Mittel', 'quality.high': 'Hoch',
    'set.note': 'Wetter und Tageszeit ändern Aussicht und Grip, nie die Punkte.',
    'help.keys': 'Tastatur', 'help.touch': 'Touch', 'help.other': 'R zurück zum Start · C Kamera · T Tageszeit · G Wetter · M Karte · Esc Pause',
    'help.drive': 'W / ↑ beschleunigen · S / ↓ bremsen (im Stand rückwärts) · A D / ← → lenken · Leertaste Handbremse',
    'touch.throttle': 'Gas', 'touch.brake': 'Brems', 'touch.handbrake': 'Handbremse', 'touch.steer': 'Lenken',
    'map.title': 'Karte', 'map.legend': 'Straßen', 'speed.limit': 'Tempolimit', 'toast.reset': 'Zurück zur Place de l’Europe', 'orient.rotate': 'Drehe das iPad quer für bessere Sicht', 'fs.enter': 'Vollbild',
    'set.colour': 'Farbe', 
    'toast.unstuck': 'Zurück auf die Straße gesetzt.', 
    'start.tagline': 'Fahr durch Luxemburg-Stadt und Niederanven.', 'start.hint': 'Wetter und Tageszeit sind bei jeder Fahrt anders, außer du wählst sie.', 'menu.pause': 'Pause', 'menu.settings2': 'Einstellungen', 'menu.back': 'Zurück', 'menu.fullscreen': 'Vollbild',
    'weather.random': 'Zufall', 'time.random': 'Zufall', 'set.camera': 'Kamera', 'cam.chase': 'Hinter dem Auto', 'cam.far': 'Weit dahinter', 'cam.bonnet': 'Motorhaube',
    'map.hint': 'Tippe auf eine Straße, um dorthin zu fahren.', 'map.here': 'Hier bist du', 'map.zoomIn': 'Näher', 'map.zoomOut': 'Weiter', 'map.teleport': 'Jetzt auf {name}', 'map.unnamed': 'Straße ohne Namen', 'map.noRoad': 'Dort ist keine Straße.',
    'toast.wet': 'Nasse Straße: weniger Grip', 'toast.quality': 'Qualität: {q}', 'touch.left': 'Links', 'touch.right': 'Rechts', 'help.touchText': 'Links lenken, rechts Gas, Bremse und Handbremse.', 'hud.limit': 'Limit',
    'hud.crash': 'Hoppla!', 'hud.onRoad': 'Auf der Straße', 'hud.offRoad': ' neben der Straße',
  },
  en: {
    title: 'Lux Drive', loading: 'Loading Luxembourg …', 'load.terrain': 'Terrain', 'load.roads': 'Roads', 'load.city': 'City', 'load.build': 'Building the world …', 'load.hills': 'Hills', 'load.bridges': 'Bridges', 'load.canopy': 'Trees', 'load.trees': 'Trees', 'load.classes': 'Land',
    'load.done': 'Done', 'load.slow': 'Taking longer than usual …', 'load.retry': 'Try again', 'load.error': 'The game could not be loaded. Check your connection.',
    'hud.speed': 'km/h', 'hud.gear': 'Gear', 'hud.road': 'Road', 'hud.menu': 'Menu', 'hud.weather': 'Weather', 'hud.timeOfDay': 'Time of day', 'hud.camera': 'Camera', 'hud.sound': 'Sound', 'hud.quality': 'Quality', 'hud.reset': 'Back to the start', 'hud.area': 'Area',
    'menu.title': 'Menu', 'menu.drive': 'Drive', 'menu.settings': 'Settings', 'menu.help': 'Help', 'menu.close': 'Close', 'menu.resume': 'Resume', 'menu.start': 'Start', 'menu.restart': 'Restart', 'menu.language': 'Language', 'menu.map': 'Map',
    'set.time': 'Time of day', 'set.weather': 'Weather', 'set.quality': 'Quality', 'set.language': 'Language', 'set.sound': 'Sound', 'set.random': 'Random', 'set.auto': 'Automatic', 'set.on': 'on', 'set.off': 'off',
    'time.dawn': 'Early morning', 'time.morning': 'Morning', 'time.noon': 'Midday', 'time.evening': 'Evening', 'time.dusk': 'Dusk', 'time.night': 'Night',
    'weather.clear': 'Clear', 'weather.cloudy': 'Cloudy', 'weather.fog': 'Fog', 'weather.rain': 'Rain',
    'quality.low': 'Low', 'quality.medium': 'Medium', 'quality.high': 'High',
    'set.note': 'The weather and the time of day change the look and the grip, never the points.',
    'help.keys': 'Keyboard', 'help.touch': 'Touch', 'help.other': 'R back to the start · C camera · T time of day · G weather · M map · Esc pause',
    'help.drive': 'W / ↑ accelerate · S / ↓ brake (reverse when standing) · A D / ← → steer · Space handbrake',
    'touch.throttle': 'Gas', 'touch.brake': 'Brake', 'touch.handbrake': 'Handbrake', 'touch.steer': 'Steer',
    'map.title': 'Map', 'map.legend': 'Roads', 'speed.limit': 'Speed limit', 'toast.reset': 'Back to Place de l’Europe', 'orient.rotate': 'Turn the iPad sideways for a better view', 'fs.enter': 'Fullscreen',
    'set.colour': 'Colour', 
    'toast.unstuck': 'Put back on the road.', 
    'start.tagline': 'Drive through Luxembourg City and Niederanven.', 'start.hint': 'Weather and time of day change every drive, unless you pick them.', 'menu.pause': 'Paused', 'menu.settings2': 'Settings', 'menu.back': 'Back', 'menu.fullscreen': 'Fullscreen',
    'weather.random': 'Random', 'time.random': 'Random', 'set.camera': 'Camera', 'cam.chase': 'Behind the car', 'cam.far': 'Far behind', 'cam.bonnet': 'Bonnet',
    'map.hint': 'Tap a road to drive there.', 'map.here': 'You are here', 'map.zoomIn': 'Closer', 'map.zoomOut': 'Farther', 'map.teleport': 'Now on {name}', 'map.unnamed': 'Unnamed road', 'map.noRoad': 'There is no road there.',
    'toast.wet': 'Wet road: less grip', 'toast.quality': 'Quality: {q}', 'touch.left': 'Left', 'touch.right': 'Right', 'help.touchText': 'Left thumb steers, right thumb gas, brake and handbrake.', 'hud.limit': 'Limit',
    'hud.crash': 'Oops!', 'hud.onRoad': 'On the road', 'hud.offRoad': ' off the road',
  },
  fr: {
    title: 'Lux Drive', loading: 'Chargement du Luxembourg …', 'load.terrain': 'Relief', 'load.roads': 'Routes', 'load.city': 'Ville', 'load.build': 'Construction du monde …', 'load.hills': 'Collines', 'load.bridges': 'Ponts', 'load.canopy': 'Arbres', 'load.trees': 'Arbres', 'load.classes': 'Terrain',
    'load.done': 'Prêt', 'load.slow': 'Cela prend plus de temps que d’habitude …', 'load.retry': 'Réessayer', 'load.error': 'Le jeu n’a pas pu être chargé. Vérifie la connexion.',
    'hud.speed': 'km/h', 'hud.gear': 'Vitesse', 'hud.road': 'Route', 'hud.menu': 'Menu', 'hud.weather': 'Météo', 'hud.timeOfDay': 'Heure du jour', 'hud.camera': 'Caméra', 'hud.sound': 'Son', 'hud.quality': 'Qualité', 'hud.reset': 'Retour au départ', 'hud.area': 'Zone',
    'menu.title': 'Menu', 'menu.drive': 'Rouler', 'menu.settings': 'Réglages', 'menu.help': 'Aide', 'menu.close': 'Fermer', 'menu.resume': 'Continuer', 'menu.start': 'Départ', 'menu.restart': 'Recommencer', 'menu.language': 'Langue', 'menu.map': 'Carte',
    'set.time': 'Heure du jour', 'set.weather': 'Météo', 'set.quality': 'Qualité', 'set.language': 'Langue', 'set.sound': 'Son', 'set.random': 'Aléatoire', 'set.auto': 'Automatique', 'set.on': 'oui', 'set.off': 'non',
    'time.dawn': 'Aube', 'time.morning': 'Matin', 'time.noon': 'Midi', 'time.evening': 'Soir', 'time.dusk': 'Crépuscule', 'time.night': 'Nuit',
    'weather.clear': 'Dégagé', 'weather.cloudy': 'Nuageux', 'weather.fog': 'Brouillard', 'weather.rain': 'Pluie',
    'quality.low': 'Basse', 'quality.medium': 'Moyenne', 'quality.high': 'Haute',
    'set.note': 'La météo et l’heure du jour changent l’aspect et l’adhérence, jamais les points.',
    'help.keys': 'Clavier', 'help.touch': 'Tactile', 'help.other': 'R retour au départ · C caméra · T heure du jour · G météo · M carte · Échap pause',
    'help.drive': 'W / ↑ accélérer · S / ↓ freiner (marche arrière à l’arrêt) · A D / ← → diriger · Espace frein à main',
    'touch.throttle': 'Accélérateur', 'touch.brake': 'Frein', 'touch.handbrake': 'Frein à main', 'touch.steer': 'Direction',
    'map.title': 'Carte', 'map.legend': 'Routes', 'speed.limit': 'Limite de vitesse', 'toast.reset': 'Retour à la Place de l’Europe', 'orient.rotate': 'Tourne l’iPad en paysage pour mieux voir', 'fs.enter': 'Plein écran',
    'set.colour': 'Couleur', 
    'toast.unstuck': 'Remis sur la route.', 
    'start.tagline': 'Roule à travers la Ville de Luxembourg et Niederanven.', 'start.hint': 'La météo et l’heure changent à chaque partie, sauf si tu les choisis.', 'menu.pause': 'Pause', 'menu.settings2': 'Réglages', 'menu.back': 'Retour', 'menu.fullscreen': 'Plein écran',
    'weather.random': 'Aléatoire', 'time.random': 'Aléatoire', 'set.camera': 'Caméra', 'cam.chase': 'Derrière la voiture', 'cam.far': 'Loin derrière', 'cam.bonnet': 'Capot',
    'map.hint': 'Touche une route pour t’y rendre.', 'map.here': 'Tu es ici', 'map.zoomIn': 'Plus près', 'map.zoomOut': 'Plus loin', 'map.teleport': 'Maintenant sur {name}', 'map.unnamed': 'Route sans nom', 'map.noRoad': 'Il n’y a pas de route ici.',
    'toast.wet': 'Route mouillée : moins d’adhérence', 'toast.quality': 'Qualité : {q}', 'touch.left': 'Gauche', 'touch.right': 'Droite', 'help.touchText': 'Pouce gauche : diriger ; pouce droit : gaz, frein, frein à main.', 'hud.limit': 'Limite',
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
