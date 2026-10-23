/* Schueberfouer Tycoon W7 "Events": the visible side of the real-date Fouer calendar (DESIGN 6), driven by calendar.js through game.events.
 *
 *   opening ceremony   opening day 17:00, 3 minutes at the SW gate: band, mayor with scissors, a shepherd with Hämmi, a crowd; the ribbon is cut at 1:52.
 *                      Everyone online at 17:00 sees it; afterwards it is a skippable replay (settings menu).
 *   Hämmelsmarsch      Fouersonndeg 11:00 and 15:00, about 3.5 minutes along the whole main alley: 5 shepherds (blue smocks, straw hats, red neckerchiefs),
 *                      8 sheep with red-white-light-blue ribbons, a dark-blue brass band of 9, a collection box.
 *   closing fireworks  last day 22:00, 4 minutes, launched from the Red Bridge; every client plays the same schedule (seeded by the year, positioned by the wall clock).
 *   banners            "Familljendag", "Lescht Dag", "Fouersonndeg": a cloth banner across the main alley at the SW gate.
 *
 * Weather and time of day stay the player's choice: the actors are lit by the scene's own lights (plus a little emissive at night), only the fireworks force the
 * evening sky while they last (a quick time-lapse to 22:30 and back to what the player had; a night sky is left alone).
 * Pure part (no THREE, harness-tested): the show clock, the scripts, the parade formation, the firework schedule, the march tune.
 * THREE part: createEvents (instanced humans + sheep = 3 draw calls, one spark system, the banner, the DOM captions, the synthesised band and bangs).
 * Test override: ?fouerDate= (test mode only, main.js) moves the whole clock; __fouerGame.events.{debugShow, state} with ?fouerDebug=1.
 * No real showmen's names or brands; the mascot is Hämmi. */
import { CEREMONY_START, CEREMONY_SECONDS, PARADE_HOURS, FIREWORKS_HOUR, FIREWORKS_SECONDS, luxParts } from "./calendar.js";
import { ALLEYS } from "./layout.js";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ------------------------------------------------------------------------------------------------ the show clock */
const HAAPTALLEE = ALLEYS.find(a => a.id === "haaptallee");
export const ALLEY = Object.freeze({ w: (HAAPTALLEE.w[0] + HAAPTALLEE.w[1]) / 2, w0: HAAPTALLEE.w[0], w1: HAAPTALLEE.w[1] });          // the Haaptallee (layout.js)
export const PARADE = Object.freeze({ speed: 1.55, startU: 6, tail: 27, endU: 292, total: 205 });   // lead metres per second, formation length, where the tail must have left
export const OPENING_SECONDS = CEREMONY_SECONDS;
export const FIREWORKS_TOTAL = FIREWORKS_SECONDS;
const CEREMONY_S = CEREMONY_START.hour * 3600 + CEREMONY_START.minute * 60;
const FIREWORKS_S = FIREWORKS_HOUR * 3600;

/** Seconds since midnight (Luxembourg) of `nowMs`, with the sub-second part. */
export function luxSeconds(nowMs, parts = luxParts(nowMs)) {
  return parts.hour * 3600 + parts.minute * 60 + parts.second + (((nowMs % 1000) + 1000) % 1000) / 1000;
}

/** Which show is on at this instant, and how far into it we are: { kind, key, t, duration } or null. `events` = calendar.eventsAt(nowMs). */
export function showAt(events, nowMs, seconds = luxSeconds(nowMs)) {
  if (events.fireworks.day && seconds >= FIREWORKS_S && seconds < FIREWORKS_S + FIREWORKS_TOTAL) {
    return { kind: "fireworks", key: `fireworks|${events.today}`, t: seconds - FIREWORKS_S, duration: FIREWORKS_TOTAL };
  }
  if (events.parade.day) {
    for (const hour of PARADE_HOURS) {
      const t = seconds - hour * 3600;
      if (t >= 0 && t < PARADE.total) return { kind: "parade", key: `parade|${events.today}|${hour}`, t, duration: PARADE.total };
    }
  }
  if (events.ceremony.day && seconds >= CEREMONY_S && seconds < CEREMONY_S + OPENING_SECONDS) {
    return { kind: "opening", key: `opening|${events.today}`, t: seconds - CEREMONY_S, duration: OPENING_SECONDS };
  }
  return null;
}

/** Which cloth banner hangs over the alley today (or null). */
export function bannerFor(events) {
  if (events.lastDay.promo) return "lastday";
  if (events.familyDay) return "familljendag";
  if (events.fouersonndeg) return "fouersonndeg";
  return null;
}

/* ------------------------------------------------------------------------------------------------ the opening ceremony script */
export const CEREMONY = Object.freeze({
  ribbonU: 30.2, cutT: 112, bandA: [2, 58], bandB: [118, 176], walkFrom: 15, walkTo: 52, outFrom: 124, outTo: 140,
  startU: 78, stopU: 33.6, outU: 23, shepherdW: 58.3, hammiW: 59.7, mayorU: 31.6, mayorW: 55.6, fadeOut: 174,
});
const CAPTIONS = [[0, 1], [12, 2], [110, 3], [135, 4]];

/** Everything the ceremony scene needs at second `t` (0..180). Pure. */
export function ceremonyScript(t) {
  const C = CEREMONY;
  const walkK = smooth(C.walkFrom, C.walkTo, t);
  const outK = smooth(C.outFrom, C.outTo, t);
  const u = t < C.outFrom ? lerp(C.startU, C.stopU, walkK) : lerp(C.stopU, C.outU, outK);
  const walking = (t > C.walkFrom && t < C.walkTo) || (t > C.outFrom && t < C.outTo);
  const cut = t >= C.cutT;
  const ribbon = cut ? smooth(C.cutT, C.cutT + 1.8, t) : 0;                               // 0 whole .. 1 fallen away
  const prep = smooth(C.cutT - 14, C.cutT - 6, t) * (cut ? 0 : 1);                          // the mayor takes up the scissors
  const speech = t > 56 && t < C.cutT - 14 ? 1 : 0;
  const fanfare = t > C.cutT - 7 && t < C.cutT + 6;
  const music = (t >= C.bandA[0] && t < C.bandA[1]) || (t >= C.bandB[0] && t < C.bandB[1]);
  const cheer = cut ? smooth(C.cutT, C.cutT + 2, t) * (1 - smooth(C.fadeOut - 8, C.fadeOut, t)) : 0;
  const caption = CAPTIONS.filter(([from]) => t >= from).pop()[1];
  const fadeIn = smooth(0, 6, t), fadeOut = 1 - smooth(C.fadeOut, OPENING_SECONDS, t);
  return { t, u, walking, facing: t < C.outFrom ? -1 : -1, cut, ribbon, scissors: cut ? 1 : prep > 0.5 ? 0.5 : 0, armUp: Math.max(prep, speech * 0.8), speech, fanfare, music, cheer,
    caption, fadeIn, fadeOut, confetti: cut && t < C.cutT + 0.25, hammiHop: cheer > 0.3 };
}

/* ------------------------------------------------------------------------------------------------ the Hämmelsmarsch formation */
/** role, metres behind the lead row and across the alley (left < 0 < right of the walking direction, +w is the left hand of someone walking +u... only the order matters) */
export const PARADE_FORMATION = Object.freeze([
  { role: "shepherd", back: 0, lat: -1.7, crook: true }, { role: "shepherd", back: 0, lat: 1.7, crook: true },
  { role: "sheep", back: 4.4, lat: -1.9 }, { role: "sheep", back: 4.2, lat: 0.1 }, { role: "sheep", back: 4.8, lat: 2.0 },
  { role: "sheep", back: 7.2, lat: -1.0 }, { role: "sheep", back: 7.4, lat: 1.1 },
  { role: "sheep", back: 9.8, lat: -2.0 }, { role: "sheep", back: 10.2, lat: 0.2 }, { role: "sheep", back: 9.6, lat: 2.1 },
  { role: "shepherd", back: 7.2, lat: -3.7, crook: true }, { role: "shepherd", back: 9.6, lat: 3.7, crook: true },
  { role: "shepherd", back: 13.6, lat: 0.0, box: true },
  { role: "major", back: 18.5, lat: 0 },
  { role: "band", back: 21.5, lat: -2.4, item: "brass" }, { role: "band", back: 21.5, lat: -0.8, item: "brass" }, { role: "band", back: 21.5, lat: 0.8, item: "brass" }, { role: "band", back: 21.5, lat: 2.4, item: "brass" },
  { role: "band", back: 24, lat: -2.4, item: "brass" }, { role: "band", back: 24, lat: -0.8, item: "drum" }, { role: "band", back: 24, lat: 0.8, item: "drum" }, { role: "band", back: 24, lat: 2.4, item: "brass" },
]);
export const PARADE_COUNTS = Object.freeze({ shepherds: 5, sheep: 8, band: 8, major: 1 });
export const paradeLeadU = t => PARADE.startU + PARADE.speed * Math.max(0, t);
/** Is the whole formation off the field at second `t`? (the tail has passed PARADE.endU) */
export const paradeDone = t => paradeLeadU(t) - PARADE.tail > PARADE.endU;
/** The pitches facing the main alley get the Hämmelsmarsch bonus (calendar.js); the cloth banner hangs here: */
export const BANNER = Object.freeze({ u: 36, w0: HAAPTALLEE.w[0], w1: HAAPTALLEE.w[1], height: 6.4, drop: 1.7 });

/* ------------------------------------------------------------------------------------------------ the firework schedule (seeded by the year) */
export const SHELL_KINDS = Object.freeze(["peony", "willow", "ring", "crackle", "double"]);
export const SHELL_COLORS = Object.freeze([[1, 0.25, 0.2], [1, 0.8, 0.25], [0.35, 0.65, 1], [0.4, 1, 0.5], [1, 0.45, 0.9], [1, 1, 1], [0.8, 0.45, 1], [0.35, 1, 1]]);
const FINALE_FROM = 206, FINALE_TO = 236;

/** The shells of a show, sorted by burst time `t`: { t, lane (-1..1 along the bridge), alt (m above the deck), size (burst radius), kind, c1, c2, rise (s) }. Deterministic. */
export function fireworksSchedule(year) {
  const rnd = mulberry((year * 7919 + 4242) >>> 0);
  const pick = n => Math.floor(rnd() * n);
  const shells = [];
  const add = (t, big) => {
    const alt = lerp(95, 215, rnd()) * (big ? 1.08 : 1);
    shells.push({ t: +t.toFixed(3), lane: +(rnd() * 2 - 1).toFixed(3), alt: Math.round(alt), size: Math.round(lerp(44, big ? 105 : 86, rnd())),
      kind: SHELL_KINDS[pick(SHELL_KINDS.length)], c1: pick(SHELL_COLORS.length), c2: pick(SHELL_COLORS.length), rise: +(2.1 + alt / 160).toFixed(2) });
  };
  add(6, false);
  for (let t = 11; t < FINALE_FROM - 6;) {                                           // the body of the show: volleys of 1..3 shells, a pause between
    const volley = 1 + pick(3);
    for (let k = 0; k < volley; k++) add(t + k * (0.35 + rnd() * 0.5), false);
    t += 3.4 + rnd() * 3.2 + volley * 0.9;
  }
  for (let t = FINALE_FROM; t < FINALE_TO;) {                                        // the finale: a wall of shells
    const volley = 2 + pick(3);
    for (let k = 0; k < volley; k++) add(t + k * 0.12, true);
    t += 0.55 + rnd() * 0.5;
  }
  add(FINALE_TO + 1.6, true); add(FINALE_TO + 2.0, true); add(FINALE_TO + 2.5, true);
  return shells.sort((a, b) => a.t - b.t);
}

/* ------------------------------------------------------------------------------------------------ the march (own tune, see W7-NOTES) */
/** Bb major, 2/4, 120 bpm: [midi, beats]; midi 0 = rest. 16 bars, repeated. NOT the traditional Hämmelsmarsch notes: replace this table to change the tune. */
export const MARCH_BPM = 120;
export const MARCH_TUNE = Object.freeze([
  [70, 0.5], [70, 0.5], [74, 1], [72, 0.5], [72, 0.5], [77, 1], [74, 0.5], [75, 0.5], [74, 0.5], [72, 0.5], [70, 1.5], [0, 0.5],
  [77, 0.5], [77, 0.5], [79, 1], [77, 0.5], [75, 0.5], [74, 1], [72, 0.5], [74, 0.5], [72, 0.5], [70, 0.5], [70, 1.5], [0, 0.5],
  [74, 1], [77, 1], [81, 1], [79, 1], [77, 0.5], [75, 0.5], [74, 0.5], [72, 0.5], [74, 2],
  [70, 0.5], [72, 0.5], [74, 0.5], [75, 0.5], [77, 1], [74, 1], [72, 0.5], [74, 0.5], [72, 0.5], [70, 0.5], [70, 2],
]);
export const MARCH_BEATS = MARCH_TUNE.reduce((sum, [, beats]) => sum + beats, 0);
/** The chord root (midi, low) under each beat of the march: I I IV V; used for the tuba and the off-beat chords. */
export const MARCH_BASS = Object.freeze([46, 46, 51, 53]);

/** The notes of the march that start in [fromBeat, toBeat), looping; { beat, dur, midi }. */
export function marchNotes(fromBeat, toBeat) {
  const out = [];
  let cursor = 0;
  const loops = Math.floor(fromBeat / MARCH_BEATS);
  for (let loop = loops; loop * MARCH_BEATS < toBeat; loop++) {
    cursor = loop * MARCH_BEATS;
    for (const [midi, dur] of MARCH_TUNE) {
      if (cursor >= fromBeat && cursor < toBeat && midi > 0) out.push({ beat: cursor, dur, midi });
      cursor += dur;
    }
  }
  return out;
}

export const midiHz = midi => 440 * 2 ** ((midi - 69) / 12);

/* ================================================================================================ the THREE part */
const HAT_STRAW = 0xd9b66a, SMOCK_BLUE = 0x2c52a8, NECK_RED = 0xd4202c, BAND_BLUE = 0x1c2a5a, BRASS = 0xe6b832, WOOL = 0xf6f3ea, FACE = 0xf0dcc8;
const RIBBON_COLORS = [0xd8283a, 0xfaf8f0, 0x8fd0f0];
const SKINS = [0xf2c9a4, 0xe8b48a, 0xd39c6c, 0xa86f46, 0xf6d6bd], HAIRS = [0x1c1612, 0x3a2616, 0x6a4423, 0xc9a45c, 0x8a8a8a];
const CLOTHES = [0xd8283a, 0x2d6fd0, 0xf2c230, 0xf4f4ef, 0x2f9a58, 0xe8702a, 0x7a47c8, 0x1c8fa0, 0xe86aa6, 0x35405c];

/** Looks wave: instanced humans and sheep in rigid parts (tapered torso, hips, thigh + shin with a knee, upper arm + forearm + hand, neck, head with nose and eyes, hair, hats, shoes, instruments),
 * 6 draw calls (boxes, low balls, head balls, cylinders, tapered limbs, flares), per-instance colour, lit by the scene's lights.  ~600 triangles per human, ~900 per sheep. */
const CAST_CAP = { human: { box: 12, ball: 2, ball0: 8, cyl: 8, tap: 10, flare: 2 }, sheep: { box: 5, ball: 13, ball0: 8, cyl: 0, tap: 4, flare: 0 }, prop: { box: 1 } };
function createCast(T, parent, { humans, sheep, props }) {
  const geos = {
    box: new T.BoxGeometry(1, 1, 1), ball: new T.IcosahedronGeometry(1, 1), ball0: new T.IcosahedronGeometry(1, 0), cyl: new T.CylinderGeometry(1, 1, 1, 7),
    tap: new T.CylinderGeometry(1, 0.74, 1, 7), flare: new T.CylinderGeometry(0.72, 1, 1, 8),
  };
  const material = new T.MeshLambertMaterial({ color: 0xffffff });
  const cap = k => Math.max(1, humans * (CAST_CAP.human[k] || 0) + sheep * (CAST_CAP.sheep[k] || 0) + (k === "box" ? props : 0));
  const meshes = {};
  for (const k of Object.keys(geos)) {
    const mesh = new T.InstancedMesh(geos[k], material, cap(k)); mesh.name = "fouer-cast-" + k; mesh.frustumCulled = false; mesh.renderOrder = 3;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.count = 0; parent.add(mesh); meshes[k] = mesh;
  }
  const counts = {}; for (const k of Object.keys(geos)) counts[k] = 0;
  const color = new T.Color();
  const slot = (kind, hex) => { const i = counts[kind]++; meshes[kind].setColorAt(i, color.setHex(hex)); meshes[kind].count = counts[kind]; return i; };
  const F = new T.Matrix4(), L = new T.Matrix4(), W = new T.Matrix4(), q = new T.Quaternion(), qy = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), fp = new T.Vector3(), fs = new T.Vector3();
  const AX = new T.Vector3(1, 0, 0), AY = new T.Vector3(0, 1, 0), AZ = new T.Vector3(0, 0, 1), UP = new T.Vector3(0, 1, 0), dir = new T.Vector3();
  const put = (kind, i, px, py, pz, rx, sx, sy, sz, rz = 0) => {
    q.setFromAxisAngle(AX, rx); if (rz) { qy.setFromAxisAngle(AZ, rz); q.multiply(qy); }
    p.set(px, py, pz); s.set(sx, sy, sz); L.compose(p, q, s); W.multiplyMatrices(F, L); meshes[kind].setMatrixAt(i, W);
  };
  /** a tapered / plain / flared part from a to b (local points): the geometry's +y axis points to a, so the wide end of a limb is at its joint */
  const seg = (kind, i, a, b, rx, rz = rx) => {
    dir.set(a[0] - b[0], a[1] - b[1], a[2] - b[2]); const len = dir.length() || 1e-4; dir.divideScalar(len);
    q.setFromUnitVectors(UP, dir); p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); s.set(rx, len, rz); L.compose(p, q, s); W.multiplyMatrices(F, L); meshes[kind].setMatrixAt(i, W);
  };
  const ball = (kind, i, c, rx, ry = rx, rz = rx) => put(kind, i, c[0], c[1], c[2], 0, rx, ry, rz);
  const hide = (kind, i) => { W.makeScale(0, 0, 0); meshes[kind].setMatrixAt(i, W); };
  const entries = [];
  const SKIN_DARK = 0x1c1816;

  function addHuman(spec) {
    const rnd = spec.rnd ?? Math.random;
    const entry = { type: "human", spec, visible: true, pose: { x: 0, z: 0, y: 0, yaw: 0, walk: 0, phase: rnd() * TAU, arms: "swing", scale: 1, hop: 0, lift: 0, fade: 1 }, slots: {} };
    const body = spec.body ?? CLOTHES[Math.floor(rnd() * CLOTHES.length)]; const skin = spec.skin ?? SKINS[Math.floor(rnd() * SKINS.length)];
    const sleeves = spec.sleeves ?? body; const long = spec.sleeves !== undefined || spec.smock;
    entry.color = { body, legs: spec.legs ?? 0x2f3a58 };
    const hair = spec.hair ?? HAIRS[Math.floor(rnd() * HAIRS.length)]; const S = entry.slots;
    S.torso = slot("tap", body); S.hips = slot("tap", spec.smock ? body : entry.color.legs);
    S.thighL = slot("tap", entry.color.legs); S.thighR = slot("tap", entry.color.legs); S.shinL = slot("tap", entry.color.legs); S.shinR = slot("tap", entry.color.legs);
    S.upL = slot("tap", sleeves); S.upR = slot("tap", sleeves); S.foreL = slot("tap", long ? sleeves : skin); S.foreR = slot("tap", long ? sleeves : skin);
    S.smock = slot("flare", body); S.bell = slot("flare", BRASS);
    S.shoeL = slot("box", 0x1c1816); S.shoeR = slot("box", 0x1c1816); S.scarf = slot("box", spec.scarf ?? body); S.tie = slot("box", spec.scarf ?? body);
    S.item = slot("box", spec.itemColor ?? BRASS); S.item2 = slot("box", spec.itemColor ?? BRASS); S.visor = slot("box", spec.hat ?? 0x20306a); S.epL = slot("box", 0xe6b832); S.epR = slot("box", 0xe6b832);
    S.handL = slot("ball0", skin); S.handR = slot("ball0", skin); S.eyeL = slot("ball0", SKIN_DARK); S.eyeR = slot("ball0", SKIN_DARK); S.nose = slot("ball0", skin); S.hairBack = slot("ball0", hair);
    S.itemBall = slot("ball0", spec.itemColor ?? BRASS); S.itemBall2 = slot("ball0", 0xf4f4ef);
    S.head = slot("ball", skin); S.hair = slot("ball", hair);
    S.neck = slot("cyl", skin); S.crown = slot("cyl", spec.hat ?? hair); S.brim = slot("cyl", spec.hat ?? HAT_STRAW); S.band = slot("cyl", 0xc8283a);
    S.tube = slot("cyl", spec.itemColor ?? BRASS); S.stick = slot("cyl", 0x7a5530); S.drum = slot("cyl", 0xf4f4ef); S.rim = slot("cyl", 0x2c52a8);
    entries.push(entry); return entry;
  }
  function addSheep(spec) {
    const rnd = spec.rnd ?? Math.random;
    const entry = { type: "sheep", spec, visible: true, pose: { x: 0, z: 0, y: 0, yaw: 0, walk: 0, phase: rnd() * TAU, scale: spec.scale ?? 1, hop: 0, fade: 1 }, slots: {}, tufts: [] };
    const S = entry.slots;
    S.fl = slot("tap", 0x4a3a34); S.fr = slot("tap", 0x4a3a34); S.bl = slot("tap", 0x4a3a34); S.br = slot("tap", 0x4a3a34);
    S.ribA = slot("box", RIBBON_COLORS[0]); S.ribB = slot("box", RIBBON_COLORS[1]); S.ribC = slot("box", RIBBON_COLORS[2]); S.earL = slot("box", 0xe9a8a0); S.earR = slot("box", 0xe9a8a0);
    S.body = slot("ball", WOOL); S.rump = slot("ball", 0xfbf9f2); S.shoulder = slot("ball", 0xfbf9f2); S.head = slot("ball", FACE);
    for (let k = 0; k < 9; k++) entry.tufts.push(slot("ball", k & 1 ? 0xfbf9f2 : WOOL));
    S.tail = slot("ball0", WOOL); S.fringe = slot("ball0", 0xfbf9f2); S.eyeL = slot("ball0", 0x2a2228); S.eyeR = slot("ball0", 0x2a2228); S.nose = slot("ball0", 0x4a3238); S.poll = slot("ball0", 0xfbf9f2);
    entries.push(entry); return entry;
  }
  /** a static or scripted box (posts, ribbon halves, the scissors, the collection box) */
  function addProp(spec) {
    const entry = { type: "prop", spec, visible: true, pose: { x: spec.x ?? 0, y: spec.y ?? 0, z: spec.z ?? 0, sx: spec.sx ?? 1, sy: spec.sy ?? 1, sz: spec.sz ?? 1, ry: spec.ry ?? 0, rz: 0 }, slots: { box: slot("box", spec.color ?? 0xffffff) } };
    entries.push(entry); return entry;
  }

  const HUMAN_SLOTS = { tap: ["torso", "hips", "thighL", "thighR", "shinL", "shinR", "upL", "upR", "foreL", "foreR"], flare: ["smock", "bell"], box: ["shoeL", "shoeR", "scarf", "tie", "item", "item2", "visor", "epL", "epR"],
    ball0: ["handL", "handR", "eyeL", "eyeR", "nose", "hairBack", "itemBall", "itemBall2"], ball: ["head", "hair"], cyl: ["neck", "crown", "brim", "band", "tube", "stick", "drum", "rim"] };
  const SHEEP_SLOTS = { tap: ["fl", "fr", "bl", "br"], box: ["ribA", "ribB", "ribC", "earL", "earR"], ball: ["body", "rump", "shoulder", "head"], ball0: ["tail", "fringe", "eyeL", "eyeR", "nose", "poll"] };
  const hideSlots = (table, S) => { for (const [kind, names] of Object.entries(table)) for (const n of names) hide(kind, S[n]); };
  /** arm angles for a pose: [shoulder (forward +), elbow bend, spread outward] */
  function armAngles(arms, side, t, swing) {
    const R = side < 0;                                           // the right hand (x < 0) carries the items
    switch (arms) {
      case "up": return [2.7 + Math.sin(t * 2) * 0.35 * (R ? -1 : 1), 0.25, 0.18];
      case "clap": return [1.15 + Math.sin(t * 3) * 0.12 * (R ? -1 : 1), 1.0, -0.22];
      case "play": return [R ? 1.2 + Math.sin(t) * 0.05 : 1.05, 1.0, -0.15];
      case "hold": return [0.95, 0.75, -0.1];
      case "wave": return R ? [2.8 + Math.sin(t * 3) * 0.4, 0.2, 0.2] : [0.05, 0.2, 0.08];
      case "speak": return R ? [1.9 + Math.sin(t * 1.5) * 0.35, 0.5, 0.1] : [0.4, 0.5, 0.08];
      case "crook": return R ? [0.6 + swing * 0.2, 0.7, 0.08] : [-swing * 0.9, 0.3, 0.08];
      case "scissors": return R ? [1.35, 0.5, 0.0] : [0.9, 0.6, -0.05];
      default: return [R ? swing * 0.9 : -swing * 0.9, 0.25 + Math.abs(swing) * 0.4, 0.07];
    }
  }
  const vA = [0, 0, 0], vB = [0, 0, 0], vC = [0, 0, 0], vD = [0, 0, 0];
  function writeHuman(e) {
    const { pose: o, spec, slots: S } = e;
    const sc = o.scale * (spec.size ?? 1) * o.fade;
    if (sc < 0.02) { hideSlots(HUMAN_SLOTS, S); return; }
    fp.set(o.x, o.y + Math.abs(Math.sin(o.phase)) * 0.03 * o.walk + o.hop, o.z); qy.setFromAxisAngle(AY, o.yaw); fs.set(sc, sc, sc); F.compose(fp, qy, fs);
    const swing = Math.sin(o.phase) * 0.62 * o.walk; const t = o.phase; const smock = !!spec.smock;
    const legs = spec.legs ?? 0x2f3a58;
    // legs: hip swing, the knee bends while the leg swings through
    for (const [sx, tN, sN, shN, sw, bend] of [[0.09, "thighL", "shinL", "shoeL", swing * 0.9, o.walk * (0.12 + 0.9 * Math.max(0, Math.cos(t)))], [-0.09, "thighR", "shinR", "shoeR", -swing * 0.9, o.walk * (0.12 + 0.9 * Math.max(0, -Math.cos(t)))]]) {
      const hip = [sx, 0.9, 0]; const knee = [sx, hip[1] - 0.43 * Math.cos(sw), hip[2] + 0.43 * Math.sin(sw)]; const a2 = sw - bend; const ank = [sx, knee[1] - 0.42 * Math.cos(a2), knee[2] + 0.42 * Math.sin(a2)];
      seg("tap", S[tN], hip, knee, 0.082, 0.082); seg("tap", S[sN], knee, ank, 0.062, 0.062);
      put("box", S[shN], sx, ank[1] - 0.02, ank[2] + 0.05, -a2 * 0.5, 0.105, 0.075, 0.24);
    }
    // torso, hips, smock, neck, head
    if (smock) { seg("flare", S.smock, [0, 1.4, 0], [0, 0.6, 0], 0.31, 0.2); put("tap", S.torso, 0, 1.26, 0, 0, 0.22, 0.28, 0.13); put("tap", S.hips, 0, 0.8, 0, 0, 0.0, 0.0, 0.0); }
    else { hide("flare", S.smock); put("tap", S.torso, 0, 1.18, 0, 0, 0.215, 0.3, 0.125); put("tap", S.hips, 0, 0.88, 0, 0, 0.185, 0.17, 0.115); }
    put("cyl", S.neck, 0, 1.5, 0.005, 0, 0.05, 0.08, 0.05);
    if (spec.scarf !== undefined) { put("box", S.scarf, 0, 1.46, 0.0, 0, 0.27, 0.07, 0.2); put("box", S.tie, 0, 1.36, 0.115, 0, 0.055, 0.17, 0.025); } else { hide("box", S.scarf); hide("box", S.tie); }
    ball("ball", S.head, [0, 1.64, 0.01], 0.118, 0.135, 0.122);
    ball("ball0", S.eyeL, [0.045, 1.655, 0.118], 0.014); ball("ball0", S.eyeR, [-0.045, 1.655, 0.118], 0.014); ball("ball0", S.nose, [0, 1.625, 0.134], 0.026, 0.03, 0.03);
    const hat = spec.hatKind;
    if (hat) { hide("ball", S.hair); ball("ball0", S.hairBack, [0, 1.64, -0.09], 0.1, 0.09, 0.07); } else { ball("ball", S.hair, [0, 1.675, -0.018], 0.128, 0.115, 0.13); hide("ball0", S.hairBack); }
    hide("cyl", S.crown); hide("cyl", S.brim); hide("cyl", S.band); hide("box", S.visor);
    if (hat === "straw") { put("cyl", S.crown, 0, 1.795, 0, 0, 0.115, 0.1, 0.115); put("cyl", S.brim, 0, 1.725, 0, 0, 0.31, 0.02, 0.31); put("cyl", S.band, 0, 1.74, 0, 0, 0.122, 0.035, 0.122); }
    else if (hat === "cap") { put("cyl", S.crown, 0, 1.78, 0, 0, 0.14, 0.1, 0.14); put("cyl", S.band, 0, 1.725, 0, 0, 0.145, 0.03, 0.145); put("box", S.visor, 0, 1.715, 0.15, 0.25, 0.17, 0.014, 0.12); }
    else if (hat === "tall") { put("cyl", S.crown, 0, 1.9, 0, 0, 0.12, 0.3, 0.12); put("cyl", S.brim, 0, 1.74, 0, 0, 0.15, 0.02, 0.15); put("cyl", S.band, 0, 1.76, 0, 0, 0.125, 0.04, 0.125); }
    if (spec.epaulettes) { put("box", S.epL, 0.2, 1.43, 0, 0, 0.09, 0.025, 0.12); put("box", S.epR, -0.2, 1.43, 0, 0, 0.09, 0.025, 0.12); } else { hide("box", S.epL); hide("box", S.epR); }
    // arms: shoulder, elbow, wrist, hand
    const wrist = {};
    for (const [sx, uN, fN, hN, key] of [[0.225, "upL", "foreL", "handL", "L"], [-0.225, "upR", "foreR", "handR", "R"]]) {
      const [a1, bend, spread] = armAngles(o.arms, sx, t, swing); const out = sx > 0 ? 1 : -1;
      const sh = [sx, 1.37, 0]; const el = [sh[0] + out * Math.sin(spread) * 0.29, sh[1] - 0.29 * Math.cos(a1) * Math.cos(spread), sh[2] + 0.29 * Math.sin(a1)];
      const a2 = a1 + bend; const wr = [el[0] + out * Math.sin(spread) * 0.12, el[1] - 0.26 * Math.cos(a2), el[2] + 0.26 * Math.sin(a2)];
      seg("tap", S[uN], sh, el, 0.052, 0.052); seg("tap", S[fN], el, wr, 0.043, 0.043); ball("ball0", S[hN], [wr[0], wr[1] - 0.03 * Math.cos(a2), wr[2] + 0.03 * Math.sin(a2)], 0.04, 0.045, 0.04);
      wrist[key] = wr;
    }
    // what they carry
    hide("cyl", S.tube); hide("cyl", S.stick); hide("cyl", S.drum); hide("cyl", S.rim); hide("flare", S.bell); hide("box", S.item); hide("box", S.item2); hide("ball0", S.itemBall); hide("ball0", S.itemBall2);
    const wR = wrist.R, wL = wrist.L;
    switch (spec.item) {
      case "brass": { const m = [0, 1.56, 0.12]; const e2 = [0, 1.5, 0.62]; seg("cyl", S.tube, m, e2, 0.022, 0.022); seg("flare", S.bell, [0, 1.5, 0.6], [0, 1.4, 0.86], 0.11, 0.11); ball("ball0", S.itemBall, [0, 1.565, 0.12], 0.035); break; }
      case "drum": { seg("cyl", S.drum, [-0.2, 1.0, 0.3], [0.2, 1.0, 0.3], 0.21, 0.21); seg("cyl", S.rim, [-0.205, 1.0, 0.3], [0.205, 1.0, 0.3], 0.19, 0.19); const bob = Math.sin(o.phase * 2) * 0.05; seg("cyl", S.stick, [wR[0], wR[1] + 0.2 + bob, wR[2]], [wR[0], wR[1] - 0.02, wR[2]], 0.012, 0.012); break; }
      case "box": put("box", S.item, 0, wR[1] + 0.0, 0.32, 0, 0.3, 0.26, 0.3); put("box", S.item2, 0, wR[1] + 0.14, 0.32, 0, 0.32, 0.03, 0.32); break;
      case "crook": { seg("cyl", S.stick, [wR[0], 1.95, wR[2]], [wR[0], 0.0, wR[2]], 0.022, 0.022); ball("ball0", S.itemBall, [wR[0], 1.96, wR[2] + 0.03], 0.05, 0.05, 0.05); put("box", S.item, wR[0], 1.93, wR[2] + 0.08, 0, 0.03, 0.05, 0.16); break; }
      case "baton": seg("cyl", S.stick, [wR[0], wR[1] + 0.55, wR[2]], [wR[0], wR[1] - 0.05, wR[2]], 0.02, 0.02); ball("ball0", S.itemBall, [wR[0], wR[1] + 0.58, wR[2]], 0.05); break;
      case "scissors": { const open = spec.scissorsOpen ?? 0; put("box", S.item, wR[0], wR[1], wR[2] + 0.12, open > 0.4 ? 0.3 : 0, 0.018, 0.02, 0.3); put("box", S.item2, wR[0], wR[1], wR[2] + 0.12, open > 0.4 ? -0.3 : 0, 0.018, 0.02, 0.3); break; }
      default: break;
    }
    void wL; void legs; void vA; void vB; void vC; void vD;
  }
  function writeSheep(e) {
    const { pose: o, slots: S, tufts } = e;
    const sc = o.scale * o.fade;
    if (sc < 0.02) { hideSlots(SHEEP_SLOTS, S); tufts.forEach(i => hide("ball", i)); return; }
    fp.set(o.x, o.y + o.hop + Math.abs(Math.sin(o.phase)) * 0.04 * o.walk, o.z); qy.setFromAxisAngle(AY, o.yaw); fs.set(sc, sc, sc); F.compose(fp, qy, fs);
    const sw = Math.sin(o.phase) * 0.7 * o.walk;
    for (const [x, z, n, a] of [[0.16, 0.36, "fl", sw], [-0.16, 0.36, "fr", -sw], [0.16, -0.36, "bl", -sw], [-0.16, -0.36, "br", sw]]) seg("tap", S[n], [x, 0.5, z], [x, 0.5 - 0.46 * Math.cos(a), z + 0.46 * Math.sin(a)], 0.05, 0.05);
    ball("ball", S.body, [0, 0.7, 0.02], 0.36, 0.3, 0.56); ball("ball", S.rump, [0, 0.72, -0.34], 0.34, 0.29, 0.3); ball("ball", S.shoulder, [0, 0.74, 0.32], 0.33, 0.29, 0.3);
    const T0 = [[0.28, 0.82, 0.12, 0.17], [-0.28, 0.82, -0.12, 0.18], [0.0, 0.98, 0.1, 0.2], [0.24, 0.78, -0.4, 0.17], [-0.25, 0.78, 0.38, 0.16], [0.0, 0.94, -0.4, 0.17], [0.3, 0.62, 0.3, 0.14], [-0.3, 0.62, -0.28, 0.15], [0, 0.6, -0.1, 0.16]];
    tufts.forEach((i, k) => { const [x, y, z, r] = T0[k]; ball("ball", i, [x, y, z], r, r * 0.9, r); });
    ball("ball0", S.tail, [0, 0.76, -0.64], 0.11); ball("ball", S.head, [0, 0.86, 0.68], 0.15, 0.18, 0.21);
    ball("ball0", S.fringe, [0, 1.04, 0.62], 0.16, 0.12, 0.16); ball("ball0", S.poll, [0, 1.0, 0.5], 0.14, 0.1, 0.16);
    ball("ball0", S.eyeL, [0.085, 0.93, 0.84], 0.026); ball("ball0", S.eyeR, [-0.085, 0.93, 0.84], 0.026); ball("ball0", S.nose, [0, 0.83, 0.89], 0.04);
    put("box", S.earL, 0.2, 0.96, 0.62, 0.0, 0.1, 0.05, 0.12, 0.5); put("box", S.earR, -0.2, 0.96, 0.62, 0.0, 0.1, 0.05, 0.12, -0.5);
    put("box", S.ribA, 0.12, 0.72, 0.52, 0, 0.12, 0.1, 0.08); put("box", S.ribB, 0, 0.72, 0.52, 0, 0.12, 0.1, 0.08); put("box", S.ribC, -0.12, 0.72, 0.52, 0, 0.12, 0.1, 0.08);
  }
  function writeProp(e) {
    const { pose: o, slots: S } = e;
    if (!e.visible) { hide("box", S.box); return; }
    fp.set(o.x, o.y, o.z); qy.setFromAxisAngle(AY, o.ry); fs.set(1, 1, 1); F.compose(fp, qy, fs);
    put("box", S.box, 0, 0, 0, 0, o.sx, o.sy, o.sz, o.rz);
  }
  function flush() {
    for (const e of entries) { if (e.type === "human") writeHuman(e); else if (e.type === "sheep") writeSheep(e); else writeProp(e); }
    for (const mesh of Object.values(meshes)) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  }
  return { addHuman, addSheep, addProp, flush, entries, material, meshes,
    setNight(k) { material.emissive.setRGB(0.2 * k, 0.17 * k, 0.12 * k); },
    dispose() { for (const m of Object.values(meshes)) parent.remove(m); for (const g of Object.values(geos)) g.dispose(); material.dispose(); entries.length = 0; } };
}

/** a small pool of glowing / flying specks: fireworks (additive) and confetti (normal blending) */
function createSparks(T, parent, r, { capacity, additive }) {
  const pos = new Float32Array(capacity * 3), col = new Float32Array(capacity * 4), size = new Float32Array(capacity);
  const vel = new Float32Array(capacity * 3), life = new Float32Array(capacity), maxLife = new Float32Array(capacity), drag = new Float32Array(capacity), grav = new Float32Array(capacity), base = new Float32Array(capacity * 3), twinkle = new Float32Array(capacity);
  const free = []; for (let i = capacity - 1; i >= 0; i--) free.push(i);
  const geo = new T.BufferGeometry();
  const posA = new T.BufferAttribute(pos, 3), colA = new T.BufferAttribute(col, 4), sizeA = new T.BufferAttribute(size, 1);
  for (const a of [posA, colA, sizeA]) a.setUsage(T.DynamicDrawUsage);
  geo.setAttribute("position", posA); geo.setAttribute("aColor", colA); geo.setAttribute("aSize", sizeA);
  const material = new T.ShaderMaterial({
    uniforms: { uScale: { value: 800 } }, transparent: true, depthWrite: false, fog: false, blending: additive ? T.AdditiveBlending : T.NormalBlending,
    vertexShader: "attribute float aSize; attribute vec4 aColor; uniform float uScale; varying vec4 vC; void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize <= 0.0 ? 0.0 : max(1.6, aSize * uScale / max(0.5, -mv.z)); }",
    fragmentShader: "varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float l = length(d); if (l > 0.5) discard; float a = " + (additive ? "smoothstep(0.5, 0.0, l)" : "1.0") + "; gl_FragColor = vec4(vC.rgb, vC.a * a); }",
  });
  const points = new T.Points(geo, material); points.frustumCulled = false; points.renderOrder = 8; points.name = additive ? "fouer-sparks" : "fouer-confetti";
  geo.setDrawRange(0, 0); parent.add(points);
  let high = 0, live = 0;
  function emit(x, y, z, vx, vy, vz, rgb, { life: l = 2, size: s = 2.4, drag: d = 0.4, grav: g = 9, twinkle: tw = 0 } = {}) {
    const i = free.pop(); if (i === undefined) return -1;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    base[i * 3] = rgb[0]; base[i * 3 + 1] = rgb[1]; base[i * 3 + 2] = rgb[2];
    life[i] = l; maxLife[i] = l; size[i] = s; drag[i] = d; grav[i] = g; twinkle[i] = tw; col[i * 4 + 3] = 1;
    high = Math.max(high, i + 1); live++; return i;
  }
  function update(dt, time) {
    material.uniforms.uScale.value = r.renderer.domElement.height / (2 * Math.tan((r.camera.fov * Math.PI) / 360));   // device pixels per metre at one metre
    let top = 0; live = 0;
    for (let i = 0; i < high; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; col[i * 4 + 3] = 0; free.push(i); continue; }
      const k = Math.exp(-drag[i] * dt);
      vel[i * 3] *= k; vel[i * 3 + 1] = vel[i * 3 + 1] * k - grav[i] * dt; vel[i * 3 + 2] *= k;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const f = life[i] / maxLife[i];
      const flicker = twinkle[i] > 0 ? 0.55 + 0.45 * Math.sin(time * 40 + i * 7.1) : 1;
      const a = Math.min(1, f * 1.8) * flicker;
      col[i * 4] = base[i * 3]; col[i * 4 + 1] = base[i * 3 + 1]; col[i * 4 + 2] = base[i * 3 + 2]; col[i * 4 + 3] = a;
      top = i + 1; live++;
    }
    high = top;
    geo.setDrawRange(0, high);
    posA.needsUpdate = true; colA.needsUpdate = true; sizeA.needsUpdate = true;
  }
  return { emit, update, get live() { return live; }, clear() { for (let i = 0; i < high; i++) { life[i] = 0; size[i] = 0; col[i * 4 + 3] = 0; } free.length = 0; for (let i = capacity - 1; i >= 0; i--) free.push(i); high = 0; geo.setDrawRange(0, 0); },
    dispose() { parent.remove(points); geo.dispose(); material.dispose(); } };
}

const DOT_TEXTURE_SIZE = 512;
/** the cloth banner over the alley: two posts and a canvas-textured plane; text() changes with the language */
function createBanner(T, parent, world) {
  const group = new T.Group(); group.name = "fouer-banner";
  const canvas = document.createElement("canvas"); canvas.width = DOT_TEXTURE_SIZE * 2; canvas.height = 128;
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = 4;
  const clothMat = new T.MeshLambertMaterial({ map: texture, side: T.FrontSide, emissiveMap: texture, emissive: new T.Color(0, 0, 0) });
  const width = BANNER.w1 - BANNER.w0;
  const y0 = world.groundY(BANNER.u, (BANNER.w0 + BANNER.w1) / 2);
  const planeGeo = new T.PlaneGeometry(width, BANNER.drop);
  for (const side of [1, -1]) {                                                         // one cloth per side: the text reads correctly from the gate and from inside the fair
    const cloth = new T.Mesh(planeGeo, clothMat);
    cloth.rotation.y = side * Math.PI / 2; cloth.position.set(BANNER.u + side * 0.04, y0 + BANNER.height, (BANNER.w0 + BANNER.w1) / 2); group.add(cloth);
  }
  const postMat = new T.MeshLambertMaterial({ color: 0xf2f2ee });
  const postGeo = new T.CylinderGeometry(0.16, 0.2, BANNER.height + 1.2, 8);
  for (const w of [BANNER.w0 - 0.2, BANNER.w1 + 0.2]) { const post = new T.Mesh(postGeo, postMat); post.position.set(BANNER.u, world.groundY(BANNER.u, w) + (BANNER.height + 1.2) / 2, w); group.add(post); }
  const rope = new T.Mesh(new T.BoxGeometry(0.05, 0.05, width + 0.8), new T.MeshLambertMaterial({ color: 0x3a3028 })); rope.position.set(BANNER.u, y0 + BANNER.height + BANNER.drop / 2 + 0.05, (BANNER.w0 + BANNER.w1) / 2); group.add(rope);
  group.visible = false; parent.add(group);
  let lastKey = "";
  function paint(text, kind) {
    const key = `${kind}|${text}`; if (key === lastKey) return; lastKey = key;
    const g = canvas.getContext("2d");
    const tone = { lastday: ["#8f1d2c", "#c8283a"], familljendag: ["#1d4f8f", "#2f7ad0"], fouersonndeg: ["#2f6a3a", "#3c9a52"] }[kind] ?? ["#333", "#555"];
    const grad = g.createLinearGradient(0, 0, 0, 128); grad.addColorStop(0, tone[1]); grad.addColorStop(1, tone[0]);
    g.fillStyle = grad; g.fillRect(0, 0, canvas.width, 128);
    g.fillStyle = "#fff7e0"; g.fillRect(0, 6, canvas.width, 4); g.fillRect(0, 118, canvas.width, 4);
    g.font = "bold 62px ui-rounded, 'Avenir Next', 'Segoe UI', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    let size = 62; while (size > 24 && g.measureText(text).width > canvas.width - 80) { size -= 4; g.font = `bold ${size}px ui-rounded, 'Avenir Next', 'Segoe UI', sans-serif`; }
    g.fillStyle = "rgba(0,0,0,.35)"; g.fillText(text, canvas.width / 2 + 3, 67); g.fillStyle = "#fff7e0"; g.fillText(text, canvas.width / 2, 64);
    texture.needsUpdate = true;
  }
  return { group, paint, setNight(k) { clothMat.emissive.setRGB(0.55 * k, 0.55 * k, 0.5 * k); }, get visible() { return group.visible; }, set visible(v) { group.visible = v; },
    dispose() { parent.remove(group); group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); texture.dispose(); } };
}

/* ---------------------------------------------------------------- synthesised band and bangs (WebAudio through audio.js's context and sfx bus) */
function createEventAudio(audio) {
  let ctx = null, out = null, panner = null, noise = null;
  let marching = null;                      // { audioT0, nextBeat, beatSec }
  const listenerFor = () => audio && audio.context;
  function ensure() {
    const c = listenerFor();
    if (!c || c.state !== "running" || audio.muted) return false;
    if (ctx === c && out) return true;
    ctx = c;
    out = c.createGain(); out.gain.value = 1.6;
    panner = c.createPanner(); panner.panningModel = "equalpower"; panner.distanceModel = "inverse"; panner.refDistance = 14; panner.rolloffFactor = 0.9; panner.maxDistance = 400;
    out.connect(panner); panner.connect(audio.sfxBus);
    const len = Math.floor(c.sampleRate * 1.5), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noise = buf; return true;
  }
  const at = (node, v, t) => node.gain.setValueAtTime(v, t);
  function brass(t, midi, dur, peak = 0.16) {
    const c = ctx, g = c.createGain(), f = c.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 1.2;
    f.frequency.setValueAtTime(700, t); f.frequency.linearRampToValueAtTime(2600, t + 0.06); f.frequency.linearRampToValueAtTime(1500, t + Math.max(0.1, dur));
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.035); g.gain.setValueAtTime(peak * 0.85, t + Math.max(0.05, dur * 0.8)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.07);
    for (const det of [-6, 5]) { const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = midiHz(midi); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.12); }
    f.connect(g); g.connect(out);
  }
  function tuba(t, midi, dur) {
    const c = ctx, g = c.createGain(), o = c.createOscillator(), f = c.createBiquadFilter();
    o.type = "triangle"; o.frequency.value = midiHz(midi); f.type = "lowpass"; f.frequency.value = 520;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
  function stab(t, root) {
    for (const k of [12, 16, 19]) brass(t, root + 12 + k - 12, 0.2, 0.05);
  }
  function snare(t) {
    const c = ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noise; f.type = "bandpass"; f.frequency.value = 2100; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.28, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + 0.15);
  }
  function kick(t) {
    const c = ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.14);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.25);
  }
  function fanfare(t) {
    [[70, 0], [74, 0.18], [77, 0.36], [82, 0.54]].forEach(([midi, off], i) => brass(t + off, midi, i === 3 ? 1.6 : 0.2, 0.2));
    kick(t + 0.54); snare(t + 0.54);
  }
  function setPosition(x, y, z) {
    if (!panner) return;
    if (panner.positionX) { panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z; } else panner.setPosition(x, y, z);
  }
  /** Keeps the march going: call every frame with the show clock `t` while the band plays; schedules ~0.5 s ahead. */
  function march(t, playing) {
    if (!playing) { marching = null; return; }
    if (!ensure()) return;
    const beatSec = 60 / MARCH_BPM;
    if (!marching || Math.abs(marching.audioT0 + t - ctx.currentTime) > 0.35) marching = { audioT0: ctx.currentTime - t, nextBeat: Math.ceil((t + 0.05) / beatSec) };
    const horizonBeat = Math.floor((t + 0.55) / beatSec * 2) / 2 + 0.5;
    const fromBeat = marching.nextBeat;
    if (horizonBeat <= fromBeat) return;
    for (const note of marchNotes(fromBeat, horizonBeat)) brass(marching.audioT0 + note.beat * beatSec, note.midi, Math.max(0.12, note.dur * beatSec * 0.9), 0.12);
    for (let b = Math.ceil(fromBeat); b < horizonBeat; b += 1) {
      const time = marching.audioT0 + b * beatSec, bar = Math.floor(b / 2) % 4;
      if (b % 2 === 0) { tuba(time, MARCH_BASS[bar], beatSec * 0.7); kick(time); } else { stab(time, MARCH_BASS[bar] + 12); snare(time); }
    }
    marching.nextBeat = horizonBeat;
  }
  function playFanfare(t) { if (ensure()) fanfare(ctx.currentTime + 0.02 + t); }
  function bang(delay, big = 1) {
    if (!ensure()) return;
    const c = ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noise; f.type = "lowpass"; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * big, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + 0.8);
    const o = c.createOscillator(), og = c.createGain(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
    og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.4 * big, t + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45); o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.5);
    for (let k = 0; k < 5; k++) {
      const cs = c.createBufferSource(), cf = c.createBiquadFilter(), cg = c.createGain(), ct = t + 0.25 + Math.random() * 0.5;
      cs.buffer = noise; cf.type = "highpass"; cf.frequency.value = 3500; cg.gain.setValueAtTime(0.0001, ct); cg.gain.linearRampToValueAtTime(0.06, ct + 0.003); cg.gain.exponentialRampToValueAtTime(0.0001, ct + 0.04);
      cs.connect(cf); cf.connect(cg); cg.connect(out); cs.start(ct, Math.random()); cs.stop(ct + 0.06);
    }
  }
  function whoosh(delay, dur) {
    if (!ensure()) return;
    const c = ctx, t = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noise; f.type = "bandpass"; f.Q.value = 0.9; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(3200, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.1, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  void at;
  return { march, playFanfare, bang, whoosh, setPosition, stop() { marching = null; }, get active() { return Boolean(out); } };
}

export function createEvents({ T, r, world, game, env, audio, ui, translate }) {
  const root = r.gameRoot;
  const banner = createBanner(T, root, world);
  const sparks = createSparks(T, root, r, { capacity: 7000, additive: true });
  const confetti = createSparks(T, root, r, { capacity: 600, additive: false });
  const eventAudio = createEventAudio(audio);
  const ground = (u, w) => world.groundY(u, w);
  let night = 0;
  let current = null;                  // { show: {kind,key,t,duration}, scene, started }
  let override = null;                 // { kind, key, startMs, offset } replay / debug
  let dismissed = new Set();
  let clock = { atMs: -1, seconds: 0 };
  let lang = ui ? ui.lang : "lb";
  let follow = false;      // (kept for the debug API)
  let cinema = null;                   // { kind, rig, fov } while the free show camera is on
  let lock = null;                     // night lock for the fireworks: { phase: "in"|"hold"|"out", from, mode, weatherMode, k }

  /* ---- DOM: the caption strip with the skip button */
  const host = document.getElementById("ui");
  const strip = document.createElement("div"); strip.className = "evcap"; strip.hidden = true;
  const stripText = document.createElement("span"); stripText.className = "evtext";
  const skip = document.createElement("button"); skip.type = "button"; skip.className = "evskip"; skip.dataset.event = "skip";
  const back = document.createElement("button"); back.type = "button"; back.className = "evskip evback"; back.dataset.event = "back"; back.hidden = true;
  strip.append(stripText, back, skip); host.append(strip);
  back.addEventListener("click", () => leaveCinema());                                  // "back" from the cinema camera: the show goes on in the builder view
  skip.addEventListener("click", () => {
    if (current) { dismissed.add(current.show.key); stop(); }
    override = null;
  });
  let capKey = "";
  const setCaption = (key, params) => {
    if (!key) { strip.hidden = true; capKey = ""; return; }
    const text = translate(lang, key, params ?? {});
    skip.textContent = translate(lang, "ev.skip"); back.textContent = translate(lang, "ev.exit"); back.hidden = !cinema;
    if (text !== capKey) { stripText.textContent = text; capKey = text; }
    strip.hidden = false;
  };
  r.renderer.domElement.addEventListener("pointerdown", () => { follow = false; });

  /* ---- scene builders */
  function buildOpening() {
    const rnd = mulberry(20260);
    const cast = createCast(T, root, { humans: 1 + 1 + 8 + 15, sheep: 1, props: 12 });
    const C = CEREMONY;
    const gY = (u, w) => ground(u, w);
    // the ribbon (two halves of three strips) and the posts
    const posts = [ALLEY.w0 + 0.5, ALLEY.w1 - 0.5].map(w => cast.addProp({ x: C.ribbonU, y: gY(C.ribbonU, w) + 0.6, z: w, sx: 0.18, sy: 1.5, sz: 0.18, color: 0xf2f2ee }));
    const strips = [];
    for (let half = 0; half < 2; half++) for (let s = 0; s < 3; s++) strips.push(cast.addProp({ x: C.ribbonU, y: 1.2 + s * 0.1, z: 0, sx: 0.03, sy: 0.09, sz: 5.4, color: RIBBON_COLORS[s] }));
    const mayor = cast.addHuman({ rnd, body: 0x2a2f3f, legs: 0x22252f, sleeves: 0x2a2f3f, scarf: 0xd8283a, hatKind: null, skin: SKINS[0], item: "scissors", itemColor: 0xd0d4da, size: 1.02 });
    const shepherd = cast.addHuman({ rnd, body: SMOCK_BLUE, legs: 0x2f3a58, smock: true, scarf: NECK_RED, hatKind: "straw", hat: HAT_STRAW, skin: SKINS[1], item: "crook", itemColor: 0x7a5530 });
    const hammi = cast.addSheep({ rnd, scale: 1.25 });
    const band = []; const specBand = [[-3.3, 0, "brass"], [-2.2, 0, "brass"], [-1.1, 0, "brass"], [0, 0, "brass"], [-2.8, 1.5, "brass"], [-1.7, 1.5, "drum"], [-0.6, 1.5, "drum"], [0.5, 1.5, "brass"]];
    for (const [dw, du, item] of specBand) {
      const e = cast.addHuman({ rnd, body: BAND_BLUE, legs: 0x151d3e, sleeves: BAND_BLUE, hatKind: "cap", hat: 0x20306a, epaulettes: true, item, itemColor: item === "drum" ? 0xf4f4ef : BRASS, skin: SKINS[Math.floor(rnd() * SKINS.length)] });
      e.base = { u: C.mayorU + 5 + du, w: ALLEY.w0 + 2.4 + (dw + 3.3) * 0.95 };
      band.push(e);
    }
    const crowdFigs = [];
    for (let i = 0; i < 15; i++) {
      const kid = i % 5 === 4;
      const e = cast.addHuman({ rnd, size: kid ? 0.58 : 0.92 + rnd() * 0.14, hatKind: null, scarf: undefined });
      e.base = { u: C.ribbonU + 2.2 + rnd() * 9, w: ALLEY.w1 - 0.6 - rnd() * 4.8 + (i % 3 === 0 ? -3.5 : 0), delay: rnd() * 5, yaw: -Math.PI / 2 + (rnd() - 0.5) * 0.6, offset: rnd() * TAU };
      crowdFigs.push(e);
    }
    cast.setNight(night);
    return {
      kind: "opening", cast, music: true,
      focus: () => ({ u: 33, w: ALLEY.w }),
      update(t, dt) {
        const S = ceremonyScript(t);
        const yawW = -Math.PI / 2;                                         // facing -u: towards the gate and the camera
        // ribbon halves: whole ribbon -> the halves retract to their posts and drop
        strips.forEach((strip, idx) => {
          const half = idx < 3 ? 0 : 1, post = half === 0 ? ALLEY.w0 + 0.5 : ALLEY.w1 - 0.5;
          const len = lerp(5.4, 0.5, S.ribbon), centre = post + (half === 0 ? 1 : -1) * (len / 2 + 0.1);
          strip.pose.z = centre; strip.pose.sz = len; strip.pose.y = gY(C.ribbonU, centre) + lerp(1.2, 0.5, S.ribbon) + (idx % 3) * 0.1; strip.pose.x = C.ribbonU - S.ribbon * 0.5;
          strip.visible = S.fadeOut > 0.05;
        });
        posts.forEach(p => { p.visible = S.fadeOut > 0.05; });
        const mp = mayor.pose; mp.x = C.mayorU; mp.z = C.mayorW; mp.y = gY(mp.x, mp.z); mp.yaw = yawW; mp.arms = S.cut ? "up" : S.armUp > 0.6 ? (S.speech ? "speak" : "scissors") : "swing";
        mp.walk = 0; mp.phase += dt * 3; mp.fade = S.fadeIn * S.fadeOut; mayor.spec.scissorsOpen = S.scissors === 0.5 ? 1 : 0;
        const sp = shepherd.pose; sp.x = S.u; sp.z = C.shepherdW; sp.y = gY(sp.x, sp.z); sp.yaw = S.t < C.outFrom ? yawW : Math.PI / 2 * (S.t > C.outTo - 2 ? 0 : -1); sp.walk = S.walking ? 1 : 0; sp.phase += dt * (S.walking ? 6.2 : 2); sp.arms = S.walking ? "crook" : S.cheer > 0.3 ? "wave" : "crook"; sp.fade = S.fadeOut * smooth(0, 3, S.t);
        const hp = hammi.pose; hp.x = S.u + 0.1; hp.z = C.hammiW; hp.y = gY(hp.x, hp.z); hp.yaw = yawW; hp.walk = S.walking ? 1 : 0; hp.phase += dt * (S.walking ? 7 : 3); hp.hop = S.hammiHop ? Math.abs(Math.sin(S.t * 5)) * 0.35 : 0; hp.fade = S.fadeOut * smooth(0, 3, S.t);
        band.forEach((e, i) => { const o = e.pose; o.x = e.base.u; o.z = e.base.w; o.y = gY(o.x, o.z); o.yaw = yawW; o.arms = "play"; o.phase += dt * (S.music ? 4.2 : 1.2); o.walk = 0; o.hop = S.music ? Math.abs(Math.sin(o.phase + i)) * 0.015 : 0; o.fade = S.fadeIn * S.fadeOut; });
        crowdFigs.forEach((e, i) => {
          const o = e.pose, b = e.base; o.x = b.u; o.z = b.w; o.y = gY(o.x, o.z); o.yaw = b.yaw; o.phase += dt * (S.cheer > 0.3 ? 5 : 1.4);
          o.arms = S.cheer > 0.3 ? (i % 2 ? "up" : "clap") : S.speech ? "swing" : (i % 4 === 0 ? "clap" : "swing"); o.walk = 0; o.hop = S.cheer > 0.3 ? Math.abs(Math.sin(S.t * 4 + b.offset)) * 0.14 : 0;
          o.fade = smooth(b.delay, b.delay + 3, S.t) * S.fadeOut;
        });
        cast.flush();
        if (S.confetti && !this.popped) { this.popped = true; burstConfetti(C.ribbonU, gY(C.ribbonU, ALLEY.w) + 2.2, ALLEY.w); eventAudio.playFanfare(0); }
        eventAudio.setPosition(C.mayorU + 5, gY(C.mayorU + 5, ALLEY.w) + 1.5, ALLEY.w);
        eventAudio.march(S.t, S.music);
        setCaption(`ev.cap.${S.caption}`);
      },
      dispose() { cast.dispose(); },
    };
  }

  function burstConfetti(u, y, w) {
    const rnd = Math.random;
    for (let i = 0; i < 160; i++) {
      const a = rnd() * TAU, sp = 3 + rnd() * 7, c = [[1, 0.2, 0.25], [1, 1, 1], [0.45, 0.78, 0.95], [1, 0.8, 0.2]][i % 4];
      confetti.emit(u, y, w, Math.cos(a) * sp * 0.6, 5 + rnd() * 6, Math.sin(a) * sp, c, { life: 2.4 + rnd() * 1.6, size: 0.28, drag: 1.2, grav: 4.5 });
    }
  }

  function buildParade() {
    const rnd = mulberry(1130);
    const cast = createCast(T, root, { humans: 14, sheep: 8, props: 1 });
    const members = PARADE_FORMATION.map((slotSpec, index) => {
      let entry;
      if (slotSpec.role === "sheep") entry = cast.addSheep({ rnd, scale: 1 });
      else if (slotSpec.role === "shepherd") entry = cast.addHuman({ rnd, body: SMOCK_BLUE, legs: 0x2f3a58, smock: true, scarf: NECK_RED, hatKind: "straw", hat: HAT_STRAW, item: slotSpec.box ? "box" : "crook", itemColor: slotSpec.box ? 0xd8283a : 0x7a5530, skin: SKINS[index % SKINS.length] });
      else if (slotSpec.role === "major") entry = cast.addHuman({ rnd, body: BAND_BLUE, legs: 0x151d3e, hatKind: "tall", hat: 0xf4f4ef, item: "baton", itemColor: BRASS, size: 1.04 });
      else entry = cast.addHuman({ rnd, body: BAND_BLUE, legs: 0x151d3e, hatKind: "cap", hat: 0x20306a, epaulettes: true, item: slotSpec.item, itemColor: slotSpec.item === "drum" ? 0xf4f4ef : BRASS, skin: SKINS[index % SKINS.length] });
      entry.slotSpec = slotSpec; entry.offset = rnd() * TAU; entry.wob = rnd();
      return entry;
    });
    cast.setNight(night);
    return {
      kind: "parade", cast, music: true,
      focus: t => ({ u: clamp(paradeLeadU(t) - 8, 20, 280), w: ALLEY.w }),
      update(t, dt) {
        const lead = paradeLeadU(t);
        const step = t * PARADE.speed;                                     // distance walked: drives every walk cycle
        for (const m of members) {
          const s = m.slotSpec, o = m.pose;
          const wobble = s.role === "sheep" ? Math.sin(t * 0.7 + m.offset) * 0.35 : 0;
          o.x = lead - s.back + (s.role === "sheep" ? Math.sin(t * 0.5 + m.offset) * 0.5 : 0); o.z = ALLEY.w + s.lat + wobble; o.y = ground(o.x, o.z); o.yaw = Math.PI / 2;
          o.walk = 1; o.phase = step * (s.role === "sheep" ? 5.2 : 3.4) + m.offset * 0.2;
          o.arms = s.role === "band" ? "play" : s.role === "major" ? "crook" : s.box ? "hold" : "crook";
          if (s.role === "sheep") { o.hop = Math.max(0, Math.sin(t * 2.2 + m.offset)) * 0.08; }
          o.fade = smooth(0, 10, o.x) * (1 - smooth(PARADE.endU + 4, PARADE.endU + 16, o.x));      // they grow in at the SW end and shrink away at the NE end
        }
        cast.flush();
        const bandU = lead - 22.5;
        eventAudio.setPosition(bandU, ground(clamp(bandU, 20, 280), ALLEY.w) + 1.6, ALLEY.w);
        eventAudio.march(t, bandU > 14 && bandU < PARADE.endU + 10);
        setCaption("ev.parade.cap");
      },
      dispose() { cast.dispose(); },
    };
  }

  /* ---- fireworks over the Red Bridge */
  let bridge = null;
  function locateBridge() {
    if (bridge) return bridge;
    const group = world.landmarks && world.landmarks.byKey && world.landmarks.byKey.rouge;
    const fallback = { cu: 645, cw: 360, ax: 0.72, az: 0.69, half: 150, y: -2 };
    if (!group) { bridge = fallback; return bridge; }
    try {
      group.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(group);
      const v = new T.Vector3();
      let n = 0, mx = 0, mz = 0; const pts = [];
      group.traverse(o => {
        if (!o.isMesh) return;
        const a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i += 3) { v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); if (v.y > box.max.y - 14) pts.push([v.x, v.z]); }
      });
      for (const [x, z] of pts) { mx += x; mz += z; n++; }
      if (n < 20) { bridge = { ...fallback, y: box.max.y }; return bridge; }
      mx /= n; mz /= n;
      let sxx = 0, sxz = 0, szz = 0;
      for (const [x, z] of pts) { sxx += (x - mx) ** 2; sxz += (x - mx) * (z - mz); szz += (z - mz) ** 2; }
      const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      const ax = Math.cos(ang), az = Math.sin(ang);
      let lo = 0, hi = 0; for (const [x, z] of pts) { const d = (x - mx) * ax + (z - mz) * az; lo = Math.min(lo, d); hi = Math.max(hi, d); }
      bridge = { cu: mx + ax * (lo + hi) / 2, cw: mz + az * (lo + hi) / 2, ax, az, half: (hi - lo) / 2, y: box.max.y };
    } catch (error) { console.warn("[fouer] could not measure the bridge", error); bridge = fallback; }
    return bridge;
  }
  const bridgeCentre = () => { const b = locateBridge(); return { u: b.cu, w: b.cw, y: b.y }; };

  function buildFireworks() {
    const year = game.events.fair.year;
    const schedule = fireworksSchedule(year);
    const rnd = mulberry(year + 99);
    const b = locateBridge();
    const risers = [];                       // shells in the air
    let next = 0, started = false;
    function burst(shell, x, y, z) {
      const colors = [SHELL_COLORS[shell.c1], SHELL_COLORS[shell.c2]];
      const n = shell.kind === "ring" ? 80 : shell.kind === "willow" ? 90 : shell.kind === "crackle" ? 70 : 110;
      const R = shell.size;
      sparks.emit(x, y, z, 0, 0, 0, [0.16, 0.16, 0.15], { life: 0.3, size: R * 0.55, drag: 0, grav: 0 });
      const layers = shell.kind === "double" ? 2 : 1;
      for (let layer = 0; layer < layers; layer++) {
        const rgb = colors[layer % 2];
        const spread = layer === 0 ? 1 : 0.55;
        for (let i = 0; i < n; i++) {
          let dx, dy, dz;
          if (shell.kind === "ring") { const a = (i / n) * TAU; dx = Math.cos(a); dy = Math.sin(a) * 0.35; dz = Math.sin(a); const tilt = 0.5; const y2 = dy * Math.cos(tilt) - dz * Math.sin(tilt) * 0.6; dz = dy * Math.sin(tilt) + dz * Math.cos(tilt) * 0.6; dy = y2; }
          else { const u = rnd() * 2 - 1, a = rnd() * TAU, s = Math.sqrt(1 - u * u); dx = s * Math.cos(a); dy = u; dz = s * Math.sin(a); }
          const sp = R * 0.55 * spread * (shell.kind === "ring" ? 1 : 0.7 + rnd() * 0.45);
          const mixRgb = shell.kind === "willow" ? [1, 0.75, 0.28] : rgb;
          sparks.emit(x, y, z, dx * sp, dy * sp, dz * sp, mixRgb, { life: shell.kind === "willow" ? 3.8 + rnd() * 1.2 : 1.9 + rnd() * 1.1, size: shell.kind === "willow" ? 2.0 : 3.0 + rnd() * 1.2, drag: shell.kind === "willow" ? 1.15 : 0.95, grav: shell.kind === "willow" ? 7 : 9, twinkle: shell.kind === "crackle" ? 1 : 0 });
        }
      }
      eventAudio.bang(0.55 + Math.min(0.8, R / 120), shell.size > 60 ? 1.15 : 0.8);
    }
    function launch(shell) {
      const lane = shell.lane * b.half * 0.8;
      const side = (rnd() * 2 - 1) * 85;                                              // across the bridge: seen from the Glacis the bridge points at the viewer, so the show needs width
      const x = b.cu + b.ax * lane - b.az * side, z = b.cw + b.az * lane + b.ax * side;
      risers.push({ shell, x, z, y0: b.y + 1, x1: x + (rnd() - 0.5) * 24, z1: z + (rnd() - 0.5) * 24, t: 0, rise: shell.rise, last: 0 });
      eventAudio.whoosh(0, Math.min(2.4, shell.rise));
    }
    return {
      kind: "fireworks", cast: null, music: false,
      focus: () => ({ u: b.cu, w: b.cw }),
      update(t, dt) {
        if (!started) { started = true; while (next < schedule.length && schedule[next].t - schedule[next].rise < t) next++; }     // joined late: the shells already in the air are skipped
        while (next < schedule.length && schedule[next].t - schedule[next].rise <= t) launch(schedule[next++]);
        for (let i = risers.length - 1; i >= 0; i--) {
          const s = risers[i]; s.t += dt;
          const k = clamp(s.t / s.rise, 0, 1), e = 1 - (1 - k) * (1 - k);
          const x = lerp(s.x, s.x1, k), z = lerp(s.z, s.z1, k), y = s.y0 + s.shell.alt * e;
          if (s.t - s.last > 0.035) { s.last = s.t; sparks.emit(x, y, z, (rnd() - 0.5) * 3, -4, (rnd() - 0.5) * 3, [1, 0.8, 0.4], { life: 0.7, size: 1.1, drag: 1, grav: 5 }); }
          if (k >= 1) { burst(s.shell, x, y, z); risers.splice(i, 1); }
        }
        setCaption(t < FIREWORKS_TOTAL - 8 ? "ev.fireworks.cap" : null);
      },
      dispose() { risers.length = 0; sparks.clear(); },
    };
  }

  /* ---- night lock for the fireworks (the player's time of day comes back afterwards) */
  const LOCK_HOUR = 22.4, LOCK_SECONDS = 5;
  function startLock() {
    if (lock && lock.phase === "out" && !lock.skip) {                                  // a new show while the sky was still going back: turn round from where it is
      lock.phase = "in"; lock.k = clamp((lock.hour - lock.from) / (LOCK_HOUR - lock.from || 1), 0, 1);
      return;
    }
    if (lock) return;
    const s = env.getState();
    if (s.night > 0.85) { lock = { phase: "hold", skip: true }; return; }
    lock = { phase: "in", k: 0, from: s.hour, hour: s.hour, timeMode: s.timeMode };
  }
  function releaseLock() {
    if (!lock) return;
    if (lock.skip) { lock = null; return; }
    lock.phase = "out"; lock.k = 0;
    if (lock.hour === undefined) lock.hour = LOCK_HOUR;
  }
  function stepLock(dt) {
    if (!lock || lock.skip) return;
    if (lock.phase === "in") {
      lock.k = Math.min(1, lock.k + dt / LOCK_SECONDS);
      lock.hour = lerp(lock.from, LOCK_HOUR, smooth(0, 1, lock.k));
      env.setHour(lock.hour);
      if (lock.k >= 1) lock.phase = "hold";
    } else if (lock.phase === "out") {
      lock.k = Math.min(1, lock.k + dt / LOCK_SECONDS);
      env.setHour(lerp(lock.hour, lock.from, smooth(0, 1, lock.k)));
      if (lock.k >= 1) {
        const m = lock.timeMode;
        env.setHour(lock.from);
        if (m && m !== "fixed") env.setTime(m, false);
        lock = null;
      }
    }
  }

  /* ---- the "cinema" camera: a free camera that frames the show (the builder camera looks down at the ground and cannot see fireworks or faces) */
  function cinemaPose(kind, t) {
    if (kind === "opening") {
      const S = ceremonyScript(t);
      const eyeU = 13.5 + 5 * smooth(0, 120, t), eyeW = 58.6 + 0.7 * Math.sin(t * 0.07);        // outside the gate, on the axis of the alley (the gate house roofs are beside it)
      const look = { u: 34, w: 56.9 };
      return { eye: [eyeU, ground(eyeU, eyeW) + 3.9 + 0.4 * Math.sin(t * 0.05), eyeW], look: [look.u, ground(look.u, look.w) + 1.3, look.w], fov: 54, focusU: S.u };
    }
    if (kind === "parade") {
      const lead = paradeLeadU(t);
      const eyeU = clamp(lead + 17, 24, 286), eyeW = 52.2 + 1.1 * Math.sin(t * 0.09);
      const lookU = clamp(lead - 9, 20, 280);
      return { eye: [eyeU, ground(eyeU, eyeW) + 2.8, eyeW], look: [lookU, ground(lookU, ALLEY.w) + 1.2, ALLEY.w + 0.4], fov: 54 };
    }
    const b = locateBridge();
    const eye = [190, ground(190, ALLEY.w) + 6.5, ALLEY.w];                                      // in the Fressgaass side of the fair: the rides in front, the sky over the bridge behind them
    const dir = [b.cu - eye[0], b.cw - eye[2]], len = Math.hypot(dir[0], dir[1]);
    return { eye, look: [eye[0] + dir[0] / len * 300, eye[1] + 300 * Math.tan(0.2), eye[2] + dir[1] / len * 300], fov: 62 };
  }
  function enterCinema(kind) {
    if (!cinema) cinema = { kind, rig: { tu: r.rig.tu, tw: r.rig.tw, yaw: r.rig.yaw, dist: r.rig.dist, tilt: r.rig.tilt }, fov: r.camera.fov };
    cinema.kind = kind; capKey = ""; back.hidden = false; document.body.classList.add("cinema");
    if (current) applyCinema(current.show.t);
  }
  function applyCinema(t) {
    if (!cinema) return;
    const p = cinemaPose(cinema.kind, t);
    r.setFreeCamera({ eye: p.eye, look: p.look, fov: p.fov });
  }
  function leaveCinema() {
    if (!cinema) return;
    const saved = cinema; cinema = null; follow = false;
    r.camera.fov = saved.fov; r.camera.updateProjectionMatrix();
    r.setPose(saved.rig, false);
    capKey = ""; back.hidden = true; document.body.classList.remove("cinema");
  }

  /* ---- lifecycle */
  function start(show) {
    const scene = show.kind === "opening" ? buildOpening() : show.kind === "parade" ? buildParade() : buildFireworks();
    current = { show, scene, started: performance.now() };
    if (show.kind === "fireworks") startLock();
  }
  function stop() {
    if (!current) return;
    const kind = current.show.kind;
    current.scene.dispose();
    eventAudio.stop();
    current = null;
    setCaption(null);
    if (kind === "fireworks") releaseLock();
    leaveCinema();
    follow = false;
  }

  function desiredShow(nowMs) {
    if (override) return { kind: override.kind, key: override.key, t: (nowMs - override.startMs) / 1000 + override.offset, duration: override.duration };
    if (!clock || nowMs - clock.atMs > 250 || nowMs < clock.atMs) clock = { atMs: nowMs, seconds: luxSeconds(nowMs) };
    return showAt(game.events, nowMs, clock.seconds + (nowMs - clock.atMs) / 1000);
  }
  const durationOf = kind => kind === "opening" ? OPENING_SECONDS : kind === "parade" ? PARADE.total : FIREWORKS_TOTAL;

  function update(dt) {
    const nowMs = game.clock();
    let want = desiredShow(nowMs);
    if (want && override && want.t >= want.duration) { override = null; want = null; }
    if (want && dismissed.has(want.key)) want = null;
    if (want && !override && !game.ready) want = null;
    if (current && (!want || want.key !== current.show.key)) stop();
    if (!current && want && !visitingOrLoading()) start(want);
    if (current && want) {
      current.show = want;
      current.scene.update(want.t, dt);
      if (cinema && ui && ui.walking) leaveCinema();
      else if (cinema) applyCinema(want.t);
    }
    sparks.update(dt, performance.now() / 1000); confetti.update(dt, performance.now() / 1000);
    stepLock(dt);
    // the cloth banner
    const kind = bannerFor(game.events);
    if (kind) { banner.paint(translate(lang, `ev.banner.${kind}`), kind); banner.visible = true; } else banner.visible = false;
  }
  const visitingOrLoading = () => Boolean(ui && ui.visiting) || !game.ready;

  /* ---- public: camera helpers and replay */
  function watch(kind) {
    const k = kind === "haemmelsmarsch" ? "parade" : kind;
    if (!current || current.show.kind !== k) return false;
    if (ui && ui.walking) return false;
    enterCinema(k);
    return true;
  }
  function replay() {
    const start = game.clock();
    override = { kind: "opening", key: `replay|${start}`, startMs: start, offset: 0, duration: OPENING_SECONDS };
    dismissed.delete(override.key);
    if (current) stop();
    update(0);
    watch("opening");
  }
  /** debug / tests: run a show from second `offset` (no calendar needed) */
  function debugShow(kind, offset = 0, { watchIt = true } = {}) {
    const startMs = game.clock();
    override = { kind, key: `debug|${kind}|${startMs}`, startMs, offset, duration: durationOf(kind) };
    if (current) stop();
    update(0);
    if (watchIt) watch(kind === "parade" ? "parade" : kind);
  }
  function stopDebug() { override = null; if (current) stop(); }

  const api = {
    update, watch, replay, debugShow, stopDebug, bridgeCentre,
    setNight(k) { night = k; if (current && current.scene.cast) current.scene.cast.setNight(k); banner.setNight(k); },
    setLang(code) { lang = code; capKey = ""; skip.textContent = translate(lang, "ev.skip"); back.textContent = translate(lang, "ev.exit"); },
    get cinema() { return cinema !== null; },
    leaveCinema,
    state() {
      const cast = current && current.scene.cast;
      return { kind: current ? current.show.kind : null, key: current ? current.show.key : null, t: current ? current.show.t : null, humans: cast ? cast.entries.filter(e => e.type === "human").length : 0,
        sheep: cast ? cast.entries.filter(e => e.type === "sheep").length : 0, sparks: sparks.live, confetti: confetti.live, banner: banner.visible, nightLock: lock ? lock.phase : null,
        caption: strip.hidden ? "" : stripText.textContent, cinema: cinema ? cinema.kind : null, entries: cast ? cast.entries.map(e => ({ type: e.type, x: e.pose.x, z: e.pose.z, fade: e.pose.fade })) : [] };
    },
    dispose() { stop(); banner.dispose(); sparks.dispose(); confetti.dispose(); strip.remove(); },
  };
  return api;
}
