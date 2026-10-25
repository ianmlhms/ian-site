/* Texts. Luxembourgish first, then German, English and French (the same four languages as the other arcade games). W1: loading + hints + HUD. */
export const LANGS = ['lb', 'de', 'en', 'fr'];
const STR = {
  lb: {
    title: 'MTB Mëllerdall', loading: 'D\'Mëllerdall gëtt gelueden …', 'load.terrain': 'Terrain', 'load.hills': 'Hiwwelen', 'load.ways': 'Weeër', 'load.trails': 'Trailen', 'load.canopy': 'Bësch', 'load.classes': 'Land', 'load.build': 'Welt gëtt gebaut …',
    'load.done': 'Fäerdeg', 'load.slow': 'Dauert méi laang wéi gewinnt …', 'load.retry': 'Nei probéieren', 'load.error': 'D\'Spill konnt net gelueden ginn. Iwwerpréif d\'Verbindung.',
    'hud.speed': 'km/h', 'hud.trail': 'Trail', 'hint.pedal': 'Trëppelen', 'hint.steer': 'Lenken', 'hint.jump': 'Sprangen', 'hint.brake': 'Bremsen', 'hint.touch': 'Lénks lenken, riets trëppelen',
    'hint.keys': 'W / ↑ trëppelen · A D / ← → lenken · S / ↓ bremsen · Espace sprangen',
    'hud.reset': 'R: zréck op de Wee',
  },
  de: {
    title: 'MTB Mëllerdall', loading: 'Das Müllerthal wird geladen …', 'load.terrain': 'Gelände', 'load.hills': 'Hügel', 'load.ways': 'Wege', 'load.trails': 'Trails', 'load.canopy': 'Wald', 'load.classes': 'Land', 'load.build': 'Welt wird gebaut …',
    'load.done': 'Fertig', 'load.slow': 'Dauert länger als sonst …', 'load.retry': 'Nochmal versuchen', 'load.error': 'Das Spiel konnte nicht geladen werden. Prüfe die Verbindung.',
    'hud.speed': 'km/h', 'hud.trail': 'Trail', 'hint.pedal': 'Treten', 'hint.steer': 'Lenken', 'hint.jump': 'Springen', 'hint.brake': 'Bremsen', 'hint.touch': 'Links lenken, rechts treten',
    'hint.keys': 'W / ↑ treten · A D / ← → lenken · S / ↓ bremsen · Leertaste springen',
    'hud.reset': 'R: zurück auf den Weg',
  },
  en: {
    title: 'MTB Mëllerdall', loading: 'Loading the Mullerthal …', 'load.terrain': 'Terrain', 'load.hills': 'Hills', 'load.ways': 'Paths', 'load.trails': 'Trails', 'load.canopy': 'Forest', 'load.classes': 'Land', 'load.build': 'Building the world …',
    'load.done': 'Done', 'load.slow': 'Taking longer than usual …', 'load.retry': 'Try again', 'load.error': 'The game could not be loaded. Check your connection.',
    'hud.speed': 'km/h', 'hud.trail': 'Trail', 'hint.pedal': 'Pedal', 'hint.steer': 'Steer', 'hint.jump': 'Jump', 'hint.brake': 'Brake', 'hint.touch': 'Steer on the left, pedal on the right',
    'hint.keys': 'W / ↑ pedal · A D / ← → steer · S / ↓ brake · Space jump',
    'hud.reset': 'R: back to the trail',
  },
  fr: {
    title: 'MTB Mëllerdall', loading: 'Chargement du Mullerthal …', 'load.terrain': 'Terrain', 'load.hills': 'Collines', 'load.ways': 'Chemins', 'load.trails': 'Pistes', 'load.canopy': 'Forêt', 'load.classes': 'Sols', 'load.build': 'Construction du monde …',
    'load.done': 'Prêt', 'load.slow': 'Plus long que d\'habitude …', 'load.retry': 'Réessayer', 'load.error': 'Le jeu n\'a pas pu être chargé. Vérifie la connexion.',
    'hud.speed': 'km/h', 'hud.trail': 'Piste', 'hint.pedal': 'Pédaler', 'hint.steer': 'Diriger', 'hint.jump': 'Sauter', 'hint.brake': 'Freiner', 'hint.touch': 'Diriger à gauche, pédaler à droite',
    'hint.keys': 'W / ↑ pédaler · A D / ← → diriger · S / ↓ freiner · Espace sauter',
    'hud.reset': 'R : retour sur la piste',
  },
};

export function t(lang, key) {
  return (STR[lang] && STR[lang][key]) || STR.en[key] || key;
}

/** Name of a trail in the player's language (the baked trails carry lb / de / en / fr). */
export function trailName(trail, lang) {
  return (trail.name && (trail.name[lang] || trail.name.en)) || trail.id;
}
