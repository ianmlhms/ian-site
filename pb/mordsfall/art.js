/* Mordsfall — all pictures, drawn in code (SVG strings), in our own flat "floor plan" style:
 *   - busts for the suspects (many faces: skin, age, hair, beards, glasses, hats, clothes)
 *   - floor textures per kind of room (planks, tiles, checkerboard, carpet, concrete, grass, sand, cobbles, stone, ice)
 *   - top-down furniture that can span several cells (a car is 2 cells, a counter 3, a corner sofa an L)
 * Light theme only. Objects are drawn in a box of W x H units (100 units = one cell). */

export const PERSON_COLORS = ["#e8735a", "#5aa2e0", "#4fbf8a", "#f0b93b", "#a77be0", "#ee7fb0", "#3fb8b8", "#9bb24a", "#f08f4a"];
const SKIN = ["#fbdcc4", "#f3c7a0", "#e2a679", "#c98558", "#a16239", "#74452a"];
const HAIR = ["#1f1712", "#3a2619", "#5b3a22", "#8d5a2f", "#c58c3b", "#e3c36a", "#b5482a", "#8c9096", "#e7e4de"];
const SHIRTS = ["#2b4c7e", "#b23a48", "#2e7d5b", "#6a4c93", "#e09f3e", "#33658a", "#8d6a9f", "#d1495b", "#3d405b", "#4a7c59", "#c06c3c", "#5b7db1"];
const INK = "#2b2118";

const hashOf = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const bits = (h, from, mod) => ((h >>> from) % mod);

/* A person's looks come from their name; the colour of their portrait comes from their seat in the case. */
export function lookOf(person, index) {
  const h = hashOf(person.name + "|" + (person.g || ""));
  const female = person.g === "f";
  const ageRoll = bits(h, 2, 100);
  const age = ageRoll < 25 ? 0 : ageRoll < 75 ? 1 : 2; // 0 young, 1 adult, 2 older
  let hair = bits(h, 6, HAIR.length);
  if (age === 2 && bits(h, 9, 3) > 0) hair = 7 + bits(h, 11, 2); // grey / white
  if (age === 0 && hair >= 7) hair = bits(h, 13, 7);
  const styles = female ? [3, 3, 4, 4, 5, 6, 2, 0, 9, 12] : [0, 1, 1, 8, 2, 7, 10, 11, 0, 1, 9];
  let style = styles[bits(h, 15, styles.length)];
  if (!female && age === 2 && bits(h, 19, 2) === 0) style = 7; // bald
  const beard = female ? 0 : [0, 0, 1, 2, 3, 4, 0, 2][bits(h, 21, 8)];
  const glasses = [0, 0, 0, 1, 2, 0, 3, 0][bits(h, 24, 8)];
  return {
    skin: SKIN[bits(h, 27, SKIN.length)], hair: HAIR[hair], style, beard, glasses, age, female,
    shirt: SHIRTS[(h >>> 4) % SHIRTS.length], outfit: bits(h, 29, 4), earring: female && bits(h, 31, 3) === 0 ? 1 : 0,
    color: PERSON_COLORS[index % PERSON_COLORS.length], freckles: bits(h, 5, 7) === 0,
  };
}

/* Bust in a 100x100 box: shoulders, neck, head, face, hair, beard, glasses, hat. */
export function bust(look, victim = false) {
  const { skin, hair, style, beard, glasses, age, female, shirt, outfit } = look;
  const dark = (c) => c; // hair/skin come ready-made; kept for readability
  let back = "", front = "", hat = "";
  const hx = 50, hy = 43; // head centre
  // hair behind the head
  if (style === 3) back = `<path d="M24 46 Q20 12 50 11 Q80 12 76 46 L80 86 Q64 90 50 84 Q36 90 20 86 Z" fill="${hair}"/>`;
  if (style === 4) back = `<path d="M25 46 Q22 14 50 13 Q78 14 75 46 L73 64 Q50 70 27 64 Z" fill="${hair}"/>`;
  if (style === 5) back = `<circle cx="50" cy="12" r="9" fill="${hair}"/>`;
  if (style === 6) back = `<path d="M70 26 Q92 30 86 66 Q82 76 76 68 Q80 46 68 38 Z" fill="${hair}"/>`;
  if (style === 9) back = `<circle cx="50" cy="34" r="31" fill="${hair}"/>`;
  if (style === 12) back = `<path d="M22 48 Q20 14 50 12 Q80 14 78 48 L74 74 Q50 84 26 74 Z" fill="${look.shirt}"/>`;
  // clothing
  let cloth = `<path d="M8 100 Q10 68 50 66 Q90 68 92 100 Z" fill="${shirt}"/>`;
  if (outfit === 0) cloth += `<path d="M38 67 L50 84 L62 67 Z" fill="#fff"/><path d="M50 72 L46 98 L54 98 Z" fill="${INK}" opacity=".0"/>`; // open collar
  if (outfit === 1) cloth += `<path d="M36 67 L50 80 L64 67 L58 66 L50 74 L42 66 Z" fill="#fff"/><path d="M50 76 L45 100 L55 100 Z" fill="#c63d3d"/><path d="M47 76 h6 l-1 5 h-4 z" fill="#a52f2f"/>`; // shirt + tie
  if (outfit === 2) cloth += `<path d="M30 70 Q50 92 70 70 Q50 80 30 70 Z" fill="#000" opacity=".18"/><rect x="42" y="84" width="16" height="16" rx="3" fill="#000" opacity=".12"/>`; // hoodie
  if (outfit === 3) cloth += `<path d="M30 68 L42 100 L10 100 Z M70 68 L58 100 L90 100 Z" fill="#000" opacity=".22"/><path d="M42 67 L50 88 L58 67 Z" fill="#fff"/>`; // blazer
  const neck = `<rect x="42" y="55" width="16" height="16" rx="6" fill="${skin}"/><path d="M42 62 Q50 70 58 62 L58 66 Q50 72 42 66 Z" fill="#000" opacity=".12"/>`;
  const ears = `<circle cx="29" cy="46" r="5" fill="${skin}"/><circle cx="71" cy="46" r="5" fill="${skin}"/>`;
  const earring = look.earring ? `<circle cx="29" cy="53" r="2.4" fill="#f5c542"/><circle cx="71" cy="53" r="2.4" fill="#f5c542"/>` : "";
  const headShape = age === 2 ? `<ellipse cx="${hx}" cy="${hy}" rx="21" ry="24" fill="${skin}"/>` : `<ellipse cx="${hx}" cy="${hy}" rx="22" ry="24" fill="${skin}"/>`;
  // hair in front
  if (style === 0) front = `<path d="M28 42 Q26 18 50 17 Q74 18 72 42 Q66 29 50 29 Q36 29 28 42 Z" fill="${hair}"/>`;
  if (style === 1) front = `<path d="M27 44 Q24 16 52 16 Q78 18 73 42 Q70 28 58 27 Q42 24 27 44 Z" fill="${hair}"/>`;
  if (style === 2) front = [[31, 30, 9], [42, 22, 10], [55, 21, 10], [67, 28, 10], [27, 40, 7], [73, 40, 7]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${hair}"/>`).join("");
  if (style === 3) front = `<path d="M27 46 Q26 18 50 18 Q74 18 73 46 Q68 30 50 29 Q34 30 27 46 Z" fill="${hair}"/>`;
  if (style === 4) front = `<path d="M26 48 Q24 17 50 17 Q76 17 74 48 Q70 31 50 30 Q34 31 26 48 Z" fill="${hair}"/>`;
  if (style === 5 || style === 6) front = `<path d="M27 42 Q26 18 50 18 Q74 18 73 42 Q66 31 50 31 Q36 31 27 42 Z" fill="${hair}"/>`;
  if (style === 8) front = `<path d="M30 36 Q50 22 70 36 Q50 28 30 36 Z" fill="${hair}" opacity=".7"/>`;
  if (style === 7 && age === 2) front = `<path d="M26 44 Q25 34 29 30 Q27 40 30 48 Z M74 44 Q75 34 71 30 Q73 40 70 48 Z" fill="${hair}"/>`;
  if (style === 9) front = `<path d="M30 36 Q50 22 70 36 Q64 28 50 27 Q36 28 30 36 Z" fill="${hair}"/>`;
  if (style === 10) hat = `<path d="M26 38 Q26 12 50 12 Q74 12 74 38 Z" fill="${look.shirt}"/><path d="M60 36 Q84 34 90 40 L58 42 Z" fill="${look.shirt}"/><path d="M26 38 H74" stroke="#000" stroke-opacity=".2" stroke-width="3"/>`;
  if (style === 11) hat = `<path d="M25 40 Q24 10 50 10 Q76 10 75 40 Z" fill="${look.shirt}"/><rect x="24" y="34" width="52" height="9" rx="4" fill="#000" opacity=".18"/><circle cx="50" cy="8" r="5" fill="${look.shirt}"/>`;
  // face
  const eyeY = 46;
  const eyes = victim
    ? `<g stroke="${INK}" stroke-width="2.6" stroke-linecap="round"><path d="M36 ${eyeY - 4} l8 8 M44 ${eyeY - 4} l-8 8 M56 ${eyeY - 4} l8 8 M64 ${eyeY - 4} l-8 8"/></g>`
    : `<ellipse cx="41" cy="${eyeY}" rx="2.8" ry="3.2" fill="${INK}"/><ellipse cx="59" cy="${eyeY}" rx="2.8" ry="3.2" fill="${INK}"/><circle cx="42" cy="${eyeY - 1}" r="1" fill="#fff"/><circle cx="60" cy="${eyeY - 1}" r="1" fill="#fff"/>`;
  const brows = victim ? "" : `<path d="M35 ${eyeY - 8} q6 -3 11 0 M54 ${eyeY - 8} q6 -3 11 0" fill="none" stroke="${hair}" stroke-width="2.6" stroke-linecap="round"/>`;
  const nose = `<path d="M50 49 q-3 6 1 7" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="2" stroke-linecap="round"/>`;
  const mouth = victim
    ? `<ellipse cx="50" cy="62" rx="4" ry="3.2" fill="${INK}"/>`
    : age === 0 ? `<path d="M42 59 Q50 67 58 59 Q50 63 42 59 Z" fill="#fff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>` : `<path d="M43 60 Q50 65 57 60" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
  const cheeks = `<circle cx="36" cy="55" r="4.4" fill="#ff7a8a" opacity=".22"/><circle cx="64" cy="55" r="4.4" fill="#ff7a8a" opacity=".22"/>`;
  const wrinkles = age === 2 ? `<path d="M33 40 q4 -2 8 0 M59 40 q4 -2 8 0 M38 54 q-2 3 0 6 M62 54 q2 3 0 6" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="1.6" stroke-linecap="round"/>` : "";
  const freckles = look.freckles ? `<g fill="#a1623a" opacity=".5"><circle cx="43" cy="53" r="1"/><circle cx="46" cy="55" r="1"/><circle cx="57" cy="53" r="1"/><circle cx="54" cy="55" r="1"/><circle cx="38" cy="52" r="1"/><circle cx="62" cy="52" r="1"/></g>` : "";
  // beards
  let beardSvg = "";
  const bc = age === 2 && look.hair === HAIR[7] ? HAIR[7] : hair;
  if (beard === 1) beardSvg = `<path d="M30 50 Q32 72 50 72 Q68 72 70 50 Q60 58 50 58 Q40 58 30 50 Z" fill="${bc}" opacity=".42"/>`;
  if (beard === 2) beardSvg = `<path d="M28 48 Q26 76 50 80 Q74 76 72 48 Q64 62 50 62 Q36 62 28 48 Z" fill="${bc}"/><path d="M42 61 Q50 57 58 61 Q50 64 42 61 Z" fill="${skin}" opacity="0"/>`;
  if (beard === 3) beardSvg = `<path d="M44 63 Q50 60 56 63 Q58 74 50 77 Q42 74 44 63 Z" fill="${bc}"/><path d="M42 57 Q50 54 58 57 Q50 59 42 57 Z" fill="${bc}"/>`;
  if (beard === 4) beardSvg = `<path d="M38 57 Q44 53 50 57 Q56 53 62 57 Q56 62 50 59 Q44 62 38 57 Z" fill="${bc}"/>`;
  // glasses
  let glass = "";
  if (glasses === 1) glass = `<g fill="none" stroke="${INK}" stroke-width="2.4"><circle cx="41" cy="${eyeY}" r="7.5"/><circle cx="59" cy="${eyeY}" r="7.5"/><path d="M48.5 ${eyeY} H51.5"/></g>`;
  if (glasses === 2) glass = `<g fill="none" stroke="${INK}" stroke-width="2.6"><rect x="32" y="${eyeY - 6}" width="16" height="12" rx="3"/><rect x="52" y="${eyeY - 6}" width="16" height="12" rx="3"/><path d="M48 ${eyeY - 1} H52"/></g>`;
  if (glasses === 3) glass = `<g><rect x="31" y="${eyeY - 6}" width="18" height="11" rx="4" fill="${INK}"/><rect x="51" y="${eyeY - 6}" width="18" height="11" rx="4" fill="${INK}"/><path d="M49 ${eyeY - 2} H51" stroke="${INK}" stroke-width="2.4"/><path d="M35 ${eyeY - 3} l4 0" stroke="#fff" stroke-opacity=".5" stroke-width="1.6"/></g>`;
  const halo = victim ? `<ellipse cx="50" cy="8" rx="17" ry="4.5" fill="none" stroke="#f5c542" stroke-width="3.5"/>` : "";
  return `${back}${cloth}${neck}${ears}${earring}${headShape}${cheeks}${freckles}${front}${brows}${eyes}${nose}${beardSvg}${mouth}${wrinkles}${glass}${hat}${halo}`;
}

let clipSeq = 0;
/* Round badge for the board token / tray: person-coloured disc with the bust. */
export function bustBadge(look, { size = 44, victim = false, ring = true } = {}) {
  const id = "mfc" + (clipSeq++);
  return `<svg class="mf-avatar" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    <defs><clipPath id="${id}"><circle cx="50" cy="50" r="47"/></clipPath></defs>
    <circle cx="50" cy="50" r="49" fill="${look.color}"/>
    <g clip-path="url(#${id})">${bust(look, victim)}</g>
    ${ring ? `<circle cx="50" cy="50" r="47" fill="none" stroke="${INK}" stroke-width="4"/>` : ""}
  </svg>`;
}
/* Big square portrait for the suspect cards (the coloured background is part of the picture). */
export function portrait(look, { victim = false } = {}) {
  return `<svg class="mf-portrait" viewBox="0 0 100 100" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><rect width="100" height="100" fill="${look.color}"/><circle cx="50" cy="40" r="46" fill="#fff" opacity=".13"/>${bust(look, victim)}</svg>`;
}

/* ---------------- floors ---------------- */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const f1 = (x) => Math.round(x * 10) / 10;

function patternPlanks() {
  const r = rng(11), tones = ["#dba96d", "#d09f62", "#e0b077", "#cf9b5c"];
  let s = `<rect width="100" height="100" fill="#d6a468"/>`;
  for (let row = 0; row < 4; row++) {
    const seam = f1(10 + r() * 80), seam2 = f1((seam + 50) % 100);
    s += `<rect y="${row * 25}" width="100" height="25" fill="${tones[row % 4]}"/><path d="M0 ${row * 25 + 25} H100" stroke="#8c5f2f" stroke-width="2.4" opacity=".7"/>`;
    s += `<path d="M${seam} ${row * 25} v25" stroke="#8c5f2f" stroke-width="2" opacity=".6"/>`;
    for (let g = 0; g < 3; g++) { const gy = f1(row * 25 + 5 + r() * 15), gx = f1(r() * 60), gl = f1(14 + r() * 26); s += `<path d="M${gx} ${gy} h${gl}" stroke="#a9753c" stroke-width="1.2" opacity=".35" stroke-linecap="round"/>`; }
    void seam2;
  }
  return `<pattern id="fl-planks" width="100" height="100" patternUnits="userSpaceOnUse">${s}</pattern>`;
}
function patternTiles() {
  return `<pattern id="fl-tiles" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="#e6edf0"/><rect x="1.5" y="1.5" width="47" height="47" rx="3" fill="#f0f5f7"/><path d="M5 8 L12 5" stroke="#fff" stroke-width="2" opacity=".8" stroke-linecap="round"/><rect width="50" height="50" fill="none" stroke="#b4c2ca" stroke-width="2.4"/></pattern>`;
}
function patternChecker() {
  return `<pattern id="fl-checker" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="#f1e6cb"/><rect width="50" height="50" fill="#a9876a"/><rect x="50" y="50" width="50" height="50" fill="#a9876a"/><rect width="100" height="100" fill="none" stroke="#7d6249" stroke-width="1.5" opacity=".35"/></pattern>`;
}
function patternCarpet() {
  const r = rng(5); let s = `<rect width="100" height="100" fill="#8fa5c8"/>`;
  for (let i = 0; i < 70; i++) s += `<circle cx="${f1(r() * 100)}" cy="${f1(r() * 100)}" r="${f1(0.8 + r() * 1.1)}" fill="${r() < 0.5 ? "#7c92b8" : "#a4b7d6"}" opacity=".7"/>`;
  s += `<path d="M0 50 H100 M50 0 V100" stroke="#7c92b8" stroke-width="1.2" opacity=".35"/>`;
  return `<pattern id="fl-carpet" width="100" height="100" patternUnits="userSpaceOnUse">${s}</pattern>`;
}
function patternConcrete() {
  const r = rng(23); let s = `<rect width="200" height="200" fill="#bab7b0"/>`;
  for (let i = 0; i < 5; i++) s += `<ellipse cx="${f1(r() * 200)}" cy="${f1(r() * 200)}" rx="${f1(20 + r() * 34)}" ry="${f1(12 + r() * 24)}" fill="#7f7b73" opacity="${f1(0.08 + r() * 0.1)}"/>`;
  for (let i = 0; i < 90; i++) s += `<circle cx="${f1(r() * 200)}" cy="${f1(r() * 200)}" r="${f1(0.7 + r() * 1.6)}" fill="${r() < 0.55 ? "#8d8a83" : "#d6d3cc"}" opacity=".7"/>`;
  s += `<path d="M12 120 l18 -8 l10 12 l22 -6" fill="none" stroke="#8d8a83" stroke-width="1.6" opacity=".6"/><path d="M130 30 l12 14 l-6 14 l16 8" fill="none" stroke="#8d8a83" stroke-width="1.6" opacity=".6"/>`;
  s += `<path d="M0 100 H200" stroke="#999690" stroke-width="2" opacity=".4"/><path d="M100 0 V200" stroke="#999690" stroke-width="2" opacity=".4"/>`;
  return `<pattern id="fl-concrete" width="200" height="200" patternUnits="userSpaceOnUse">${s}</pattern>`;
}
function patternGrass() {
  const r = rng(31); let s = `<rect width="200" height="200" fill="#8cc374"/>`;
  for (let i = 0; i < 40; i++) s += `<ellipse cx="${f1(r() * 200)}" cy="${f1(r() * 200)}" rx="${f1(10 + r() * 16)}" ry="${f1(6 + r() * 10)}" fill="${r() < 0.5 ? "#7fb868" : "#98cf80"}" opacity=".5"/>`;
  for (let i = 0; i < 120; i++) { const x = f1(r() * 200), y = f1(r() * 200); s += `<path d="M${x} ${y} l${f1(r() * 4 - 2)} ${-f1(4 + r() * 5)}" stroke="${r() < 0.5 ? "#5f9b4c" : "#b6e29c"}" stroke-width="1.6" stroke-linecap="round"/>`; }
  for (let i = 0; i < 7; i++) s += `<circle cx="${f1(r() * 200)}" cy="${f1(r() * 200)}" r="2.2" fill="${r() < 0.5 ? "#fff" : "#ffd966"}"/>`;
  return `<pattern id="fl-grass" width="200" height="200" patternUnits="userSpaceOnUse">${s}</pattern>`;
}
function patternSand() {
  const r = rng(41); let s = `<rect width="200" height="200" fill="#ecd59c"/>`;
  for (let i = 0; i < 4; i++) { const y = f1(30 + i * 50 + r() * 10); s += `<path d="M0 ${y} q25 -8 50 0 t50 0 t50 0 t50 0" fill="none" stroke="#dcc283" stroke-width="2" opacity=".6"/>`; }
  for (let i = 0; i < 160; i++) s += `<circle cx="${f1(r() * 200)}" cy="${f1(r() * 200)}" r="${f1(0.6 + r() * 1.2)}" fill="${r() < 0.6 ? "#c7ab6c" : "#f8ebc4"}" opacity=".8"/>`;
  return `<pattern id="fl-sand" width="200" height="200" patternUnits="userSpaceOnUse">${s}</pattern>`;
}
function patternCobble() {
  const r = rng(53), tones = ["#b7b1a6", "#aaa498", "#c0baaf", "#a09a8f", "#b2ac9f"];
  let s = `<rect width="100" height="100" fill="#7f7a71"/>`;
  const cols = [0, 34, 68], rows = [0, 34, 68];
  for (const cy of rows) for (const cx of cols) {
    const x = f1(cx + 2 + r() * 3), y = f1(cy + 2 + r() * 3), w = f1(28 + r() * 4), h = f1(28 + r() * 4);
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${f1(8 + r() * 6)}" fill="${tones[Math.floor(r() * tones.length)]}"/><rect x="${x + 3}" y="${y + 3}" width="${f1(w * 0.45)}" height="${f1(h * 0.3)}" rx="4" fill="#fff" opacity=".18"/>`;
  }
  return `<pattern id="fl-cobble" width="100" height="100" patternUnits="userSpaceOnUse">${s}</pattern>`;
}
function patternStone() {
  const r = rng(61); let s = `<rect width="100" height="100" fill="#9ea4ae"/>`;
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 25 : 0;
    for (let k = -1; k < 3; k++) { const x = off + k * 50; s += `<rect x="${x + 1.5}" y="${row * 25 + 1.5}" width="47" height="22" rx="2" fill="${r() < 0.5 ? "#a7adb7" : "#959ba6"}"/>`; }
  }
  s += `<path d="M0 25 H100 M0 50 H100 M0 75 H100" stroke="#666b76" stroke-width="2" opacity=".7"/>`;
  return `<pattern id="fl-stone" width="100" height="100" patternUnits="userSpaceOnUse">${s}</pattern>`;
}
function patternIce() {
  const r = rng(71); let s = `<rect width="200" height="200" fill="#d4eaf5"/>`;
  for (let i = 0; i < 14; i++) { const x = f1(r() * 200), y = f1(r() * 200); s += `<path d="M${x} ${y} q${f1(10 + r() * 30)} ${f1(-6 + r() * 12)} ${f1(20 + r() * 50)} ${f1(-4 + r() * 8)}" fill="none" stroke="#fff" stroke-width="1.8" opacity=".75" stroke-linecap="round"/>`; }
  s += `<ellipse cx="60" cy="130" rx="46" ry="26" fill="#fff" opacity=".25"/>`;
  return `<pattern id="fl-ice" width="200" height="200" patternUnits="userSpaceOnUse">${s}</pattern>`;
}
export const FLOOR_DEFS = patternPlanks() + patternTiles() + patternChecker() + patternCarpet() + patternConcrete() + patternGrass() + patternSand() + patternCobble() + patternStone() + patternIce();
export const FLOOR_BASE = { planks: "#d6a468", tiles: "#e6edf0", checker: "#f1e6cb", carpet: "#8fa5c8", concrete: "#bab7b0", grass: "#8cc374", sand: "#ecd59c", cobble: "#a9a398", stone: "#9ea4ae", ice: "#d4eaf5" };
/* tints that tell neighbouring rooms with the same floor apart */
export const ROOM_TINT = ["#ffb199", "#9be0b4", "#a4b8ff", "#ffe08a", "#e0b0ff", "#8fe3e8", "#ff9fba", "#cfe58a", "#ffc58a", "#b7c4d6"];

/* ---------------- top-down furniture ---------------- */
const palette = ["#d9534f", "#2e86de", "#f0b93b", "#f4f1ea", "#3fa66b", "#8e5bd0", "#e8873a"];
const pickc = (seed, list = palette) => list[Math.abs(seed) % list.length];
const sh = (W, H, rx = 10, d = 5) => `<rect x="${d + 5}" y="${d + 5}" width="${W - 10}" height="${H - 10}" rx="${rx}" fill="#2b2118" opacity=".22"/>`;
const per = (W, fn) => { let s = ""; const k = Math.max(1, Math.round(W / 100)); for (let i = 0; i < k; i++) s += fn(i * (W / k), W / k, i); return s; };
const cx = (x, y, r, f, o = 1) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${f}" opacity="${o}"/>`;
const rr = (x, y, w, h, r, f, o = 1, st = "") => `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" rx="${r}" fill="${f}" opacity="${o}" ${st}/>`;

export const OBJECT_ART = {
  table: (W, H, seed) => {
    if (W <= 110 && H <= 110) {
      const round = seed % 2 === 0;
      return `${round ? `<ellipse cx="53" cy="55" rx="42" ry="42" fill="#2b2118" opacity=".22"/><circle cx="50" cy="50" r="42" fill="#b57a45"/><circle cx="50" cy="50" r="36" fill="#d9a066"/><circle cx="50" cy="50" r="16" fill="#fff"/><circle cx="50" cy="50" r="11" fill="#f1ede4"/>${cx(76, 30, 6, "#e4572e")}` : `${sh(W, H, 9)}${rr(8, 8, 84, 84, 9, "#b57a45")}${rr(14, 14, 72, 72, 6, "#d9a066")}${cx(40, 42, 11, "#fff")}${cx(66, 62, 9, "#e4572e")}${rr(52, 24, 22, 8, 3, "#f3c969")}`}`;
    }
    return `${sh(W, H, 10)}${rr(8, 8, W - 16, H - 16, 10, "#b57a45")}${rr(14, 14, W - 28, H - 28, 7, "#d9a066")}${rr(14, H / 2 - 7, W - 28, 14, 3, "#e4572e", 0.85)}` + per(W, (x, w, i) => `${cx(x + w * 0.3, 32, 9, "#fff")}${cx(x + w * 0.7, H - 32, 9, "#fff")}${cx(x + w * 0.5, H / 2, 5, "#f3c969")}`);
  },
  desk: (W, H, seed) => `${sh(W, H, 7)}${rr(8, 10, W - 16, H - 20, 7, "#a97b4e")}${rr(12, 14, W - 24, H - 28, 5, "#c79a68")}` + per(W, (x, w, i) => `${rr(x + 18, 20, w * 0.52, 8, 2, "#39414f")}${rr(x + 22, 21, w * 0.52 - 8, 5, 1, "#8fd0f0")}${rr(x + 22, 38, w * 0.46, 10, 2, "#e6e8ec")}${cx(x + w - 24, 58, 6, i % 2 ? "#e4572e" : "#3fa66b")}${rr(x + 14, H - 38, 26, 14, 2, "#fff", 0.95)}`),
  shelf: (W, H) => `${sh(W, H, 5)}${rr(8, 10, W - 16, H - 20, 5, "#7d522e")}${rr(13, 15, W - 26, H - 30, 3, "#a87642")}` + per(W, (x, w, i) => { let s = `<path d="M${x} 16 V${H - 16}" stroke="#7d522e" stroke-width="${i ? 4 : 0}"/>`; ["#2e86de", "#e4572e", "#3fa66b", "#f0b93b", "#8e5bd0", "#e84393"].forEach((c, k) => { s += rr(x + 14 + k * (w - 28) / 6, 22 + (k % 2) * 4, (w - 28) / 6 - 3, H - 50 - (k % 2) * 4, 2, c, 0.92); }); return s; }),
  tree: (W, H, seed) => `<circle cx="54" cy="56" r="40" fill="#2b2118" opacity=".22"/><circle cx="50" cy="50" r="42" fill="#3b8a4f"/><circle cx="34" cy="40" r="22" fill="#4aa461"/><circle cx="64" cy="38" r="20" fill="#56b06b"/><circle cx="56" cy="62" r="22" fill="#42995a"/><circle cx="40" cy="34" r="9" fill="#7ccf8d" opacity=".8"/><circle cx="62" cy="32" r="7" fill="#7ccf8d" opacity=".7"/><circle cx="50" cy="50" r="5" fill="#8a5a34" opacity=".55"/>`,
  rock: (W, H, seed) => `<path d="M16 62 Q10 34 32 22 Q50 10 70 22 Q92 34 86 62 Q80 84 54 86 Q24 86 16 62 Z" fill="#2b2118" opacity=".2" transform="translate(4 5)"/><path d="M16 62 Q10 34 32 22 Q50 10 70 22 Q92 34 86 62 Q80 84 54 86 Q24 86 16 62 Z" fill="#9aa3ad"/><path d="M30 26 Q48 14 68 24 Q56 36 38 40 Q26 44 22 58 Q14 40 30 26 Z" fill="#c4cbd2"/><path d="M60 54 Q78 52 84 64 Q76 82 54 84 Z" fill="#7d8791"/><path d="M34 70 q8 -6 16 0" stroke="#5aa86d" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  car: (W, H, seed) => { const c = pickc(seed, ["#d9534f", "#2e86de", "#f0b93b", "#3fa66b", "#8e5bd0", "#e8873a"]); return `${sh(W, H, 24)}<rect x="14" y="${H - 22}" width="34" height="16" rx="6" fill="#222"/><rect x="${W - 48}" y="${H - 22}" width="34" height="16" rx="6" fill="#222"/><rect x="14" y="6" width="34" height="16" rx="6" fill="#222"/><rect x="${W - 48}" y="6" width="34" height="16" rx="6" fill="#222"/><rect x="6" y="12" width="${W - 12}" height="${H - 24}" rx="22" fill="${c}"/><rect x="${W * 0.28}" y="20" width="${W * 0.38}" height="${H - 40}" rx="10" fill="#cfe8f5"/><rect x="${W * 0.34}" y="24" width="${W * 0.26}" height="${H - 48}" rx="7" fill="${c}"/><rect x="${W - 22}" y="18" width="10" height="14" rx="4" fill="#ffe27a"/><rect x="${W - 22}" y="${H - 32}" width="10" height="14" rx="4" fill="#ffe27a"/><rect x="12" y="18" width="8" height="12" rx="3" fill="#8a1f1f"/><rect x="12" y="${H - 30}" width="8" height="12" rx="3" fill="#8a1f1f"/>`; },
  fountain: (W, H) => { const R = Math.min(W, H) / 2; const c = W / 2; return `<circle cx="${c + 4}" cy="${H / 2 + 5}" r="${R - 6}" fill="#2b2118" opacity=".2"/><circle cx="${c}" cy="${H / 2}" r="${R - 6}" fill="#b9c2cc"/><circle cx="${c}" cy="${H / 2}" r="${R - 14}" fill="#6dbcea"/><circle cx="${c}" cy="${H / 2}" r="${R * 0.56}" fill="#8fd0f4"/><circle cx="${c}" cy="${H / 2}" r="${R * 0.3}" fill="#d9dfe5"/><circle cx="${c}" cy="${H / 2}" r="${R * 0.14}" fill="#fff"/><path d="M${c - R * 0.7} ${H / 2 - 6} q8 -8 16 0 M${c + R * 0.35} ${H / 2 + R * 0.5} q8 -8 16 0" stroke="#fff" stroke-width="2.4" fill="none" opacity=".8"/>`; },
  barrel: () => `<circle cx="54" cy="55" r="40" fill="#2b2118" opacity=".22"/><circle cx="50" cy="50" r="41" fill="#a96a35"/><circle cx="50" cy="50" r="33" fill="#c98b4e"/><circle cx="50" cy="50" r="25" fill="#d79a5c"/><circle cx="50" cy="50" r="41" fill="none" stroke="#4a3a30" stroke-width="5"/><circle cx="50" cy="50" r="30" fill="none" stroke="#4a3a30" stroke-width="2.4" opacity=".7"/><path d="M26 44 q24 -14 48 0 M26 56 q24 -14 48 0" stroke="#a96a35" stroke-width="2" fill="none" opacity=".7"/><circle cx="50" cy="50" r="5" fill="#4a3a30"/>`,
  plant: () => `<circle cx="54" cy="55" r="38" fill="#2b2118" opacity=".2"/><circle cx="50" cy="50" r="38" fill="#c8693c"/><circle cx="50" cy="50" r="31" fill="#8a5a34"/>` + [0, 1, 2, 3, 4, 5].map((k) => `<ellipse cx="50" cy="24" rx="9" ry="22" fill="${k % 2 ? "#3f9156" : "#56b06b"}" transform="rotate(${k * 60} 50 50)"/>`).join("") + `<circle cx="50" cy="50" r="6" fill="#2f7343"/>`,
  crate: () => `${sh(100, 100, 5)}${rr(10, 10, 80, 80, 5, "#c99a5e")}<rect x="10" y="10" width="80" height="80" rx="5" fill="none" stroke="#8a6638" stroke-width="6"/><path d="M16 16 L84 84 M84 16 L16 84" stroke="#8a6638" stroke-width="6"/><path d="M14 40 H86" stroke="#a77d45" stroke-width="2" opacity=".6"/>`,
  stove: () => `${sh(100, 100, 7)}${rr(8, 8, 84, 84, 7, "#4d5560")}${rr(12, 12, 76, 76, 5, "#6b7482")}` + [[32, 32], [68, 32], [32, 68], [68, 68]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="14" fill="#2b2f36"/><circle cx="${x}" cy="${y}" r="9" fill="none" stroke="#9aa3ad" stroke-width="3"/><circle cx="${x}" cy="${y}" r="3" fill="#f08a3c"/>`).join("") + `<circle cx="50" cy="88" r="2.6" fill="#e1a700"/><circle cx="36" cy="88" r="2.6" fill="#e1a700"/><circle cx="64" cy="88" r="2.6" fill="#e1a700"/>`,
  heater: () => `${sh(100, 100, 7)}${rr(10, 10, 80, 80, 7, "#59616d")}${rr(16, 16, 68, 68, 5, "#7a8493")}` + [[34, 36, 13], [58, 32, 14], [66, 58, 12], [40, 62, 13], [50, 48, 12]].map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 2 ? "#8b8f98" : "#a4a9b2"}"/><circle cx="${x - 3}" cy="${y - 4}" r="${r * 0.35}" fill="#d9dde2" opacity=".8"/>`).join("") + `<rect x="20" y="86" width="60" height="4" rx="2" fill="#f08a3c" opacity=".9"/>`,
  bucket: () => `<circle cx="54" cy="55" r="32" fill="#2b2118" opacity=".2"/><circle cx="50" cy="50" r="32" fill="#9aa3ad"/><circle cx="50" cy="50" r="26" fill="#6fb8e8"/><circle cx="42" cy="42" r="8" fill="#a9dcf5" opacity=".8"/><path d="M18 50 Q50 -6 82 50" fill="none" stroke="#5c646e" stroke-width="4"/>`,
  copier: () => `${sh(100, 100, 7)}${rr(8, 10, 84, 80, 7, "#c9d0d8")}${rr(14, 16, 72, 52, 5, "#eef1f4")}${rr(20, 22, 60, 40, 3, "#9fd0e8")}<path d="M24 28 L50 58" stroke="#fff" stroke-width="4" opacity=".6"/>${rr(14, 72, 40, 12, 3, "#6d7681")}${cx(66, 78, 4.5, "#3fa66b")}${cx(78, 78, 4.5, "#e1a700")}${rr(30, 64, 30, 6, 1, "#fff", 0.95)}`,
  fridge: () => `${sh(100, 100, 8)}${rr(10, 10, 80, 80, 8, "#dfe8f1")}${rr(16, 16, 68, 68, 5, "#eef3f8")}<path d="M16 50 H84" stroke="#b9c6d4" stroke-width="3"/>${rr(72, 22, 5, 20, 2, "#7a8493")}${rr(72, 56, 5, 20, 2, "#7a8493")}${rr(24, 24, 14, 8, 2, "#e84393", 0.9)}${rr(26, 60, 12, 10, 2, "#f0b93b", 0.9)}`,
  counter: (W, H) => `${sh(W, H, 7)}${rr(8, 8, W - 16, H - 16, 7, "#7d522e")}${rr(13, 13, W - 26, H - 26, 4, "#c99660")}${rr(13, H - 38, W - 26, 12, 3, "#a87642")}` + per(W, (x, w, i) => `${cx(x + w * 0.32, 32, 8, "#fff")}${cx(x + w * 0.32, 32, 4.5, "#e4572e")}${rr(x + w * 0.58, 22, 22, 18, 3, "#2b2f36")}${rr(x + w * 0.62, 24, 14, 6, 1, "#7cd0a4")}`),
  parasol: (W, H, seed) => { const c = pickc(seed, ["#e4572e", "#2e86de", "#f0b93b", "#3fa66b"]); return `<circle cx="54" cy="56" r="42" fill="#2b2118" opacity=".2"/>` + [0, 1, 2, 3, 4, 5, 6, 7].map((k) => `<path d="M50 50 L${f1(50 + 42 * Math.cos((k * 45 - 22.5) * Math.PI / 180))} ${f1(50 + 42 * Math.sin((k * 45 - 22.5) * Math.PI / 180))} A42 42 0 0 1 ${f1(50 + 42 * Math.cos((k * 45 + 22.5) * Math.PI / 180))} ${f1(50 + 42 * Math.sin((k * 45 + 22.5) * Math.PI / 180))} Z" fill="${k % 2 ? "#fff" : c}"/>`).join("") + `<circle cx="50" cy="50" r="5" fill="#6b4425"/>`; },
  tent: (W, H, seed) => { const c = pickc(seed, ["#e1832e", "#3fa66b", "#2e86de", "#d9534f"]); return `${sh(W, H, 14)}<path d="M8 ${H - 8} L${W / 2} 10 L${W - 8} ${H - 8} Z" fill="${c}"/><path d="M${W / 2} 10 L${W - 8} ${H - 8} L${W / 2} ${H - 8} Z" fill="#000" opacity=".16"/><path d="M${W / 2} 10 V${H - 8}" stroke="#2b2118" stroke-opacity=".5" stroke-width="3"/><path d="M${W / 2 - 18} ${H - 8} L${W / 2} 40 L${W / 2 + 18} ${H - 8} Z" fill="#2b2118" opacity=".78"/><circle cx="${W / 2}" cy="12" r="4" fill="#f4efe6"/>`; },
  campfire: () => `<circle cx="50" cy="50" r="42" fill="#2b2118" opacity=".25"/><circle cx="50" cy="50" r="40" fill="#5f574e"/>` + [0, 1, 2, 3, 4, 5, 6, 7].map((k) => `<circle cx="${f1(50 + 33 * Math.cos(k * Math.PI / 4))}" cy="${f1(50 + 33 * Math.sin(k * Math.PI / 4))}" r="8" fill="${k % 2 ? "#9a948a" : "#b3ada2"}"/>`).join("") + `<rect x="24" y="44" width="52" height="10" rx="5" fill="#6b4425" transform="rotate(30 50 50)"/><rect x="24" y="44" width="52" height="10" rx="5" fill="#8a5a34" transform="rotate(-30 50 50)"/><path d="M50 22 Q66 44 60 62 Q56 72 50 72 Q42 72 40 62 Q36 46 50 22 Z" fill="#f08a3c"/><path d="M50 40 Q58 52 55 62 Q53 68 50 68 Q46 68 45 62 Q44 52 50 40 Z" fill="#ffd45e"/>`,
  tap: () => `<circle cx="52" cy="62" r="34" fill="#6fb8e8" opacity=".35"/><circle cx="50" cy="58" r="14" fill="#8a929c"/><circle cx="50" cy="58" r="9" fill="#aab2bb"/><rect x="46" y="14" width="8" height="46" rx="4" fill="#9aa3ad"/><rect x="34" y="12" width="32" height="9" rx="4.5" fill="#d9534f"/><circle cx="50" cy="16" r="3" fill="#fff" opacity=".7"/><path d="M50 62 q-4 10 0 16 q4 -6 0 -16 Z" fill="#6fb8e8"/>`,
  board: (W, H) => `${sh(W, H, 4, 3)}${rr(8, H / 2 - 18, W - 16, 36, 4, "#8f5a31")}${rr(12, H / 2 - 14, W - 24, 28, 2, "#2f6f5a")}<path d="M${W * 0.18} ${H / 2 - 3} H${W * 0.55} M${W * 0.18} ${H / 2 + 6} H${W * 0.42}" stroke="#eef3ea" stroke-width="3" stroke-linecap="round" opacity=".85"/>${rr(W - 36, H / 2 + 2, 16, 5, 2, "#f3c969")}`,
  stall: (W, H) => `${sh(W, H, 8)}${rr(8, 8, W - 16, H - 16, 8, "#8f5a31")}` + per(W, (x, w, i) => { let s = ""; const sw = (w - 8) / 6; for (let k = 0; k < 6; k++) s += rr(x + 4 + k * sw, 12, sw, H - 24, 0, k % 2 ? "#fff" : "#d9483f"); return s; }) + `${rr(8, 8, W - 16, 10, 5, "#d9483f", 0)}<path d="M12 ${H - 16} q${(W - 24) / 8} 10 ${(W - 24) / 4} 0 t${(W - 24) / 4} 0 t${(W - 24) / 4} 0 t${(W - 24) / 4} 0" fill="#d9483f" opacity="0"/>${cx(W * 0.3, H / 2, 8, "#f0b93b", 0.95)}${cx(W * 0.5, H / 2, 8, "#3fa66b", 0.95)}${cx(W * 0.7, H / 2, 8, "#8e5bd0", 0.95)}`,
  bin: () => `<circle cx="54" cy="55" r="32" fill="#2b2118" opacity=".22"/><circle cx="50" cy="50" r="33" fill="#3f9156"/><circle cx="50" cy="50" r="27" fill="#4fa564"/><circle cx="50" cy="50" r="9" fill="#2f6d3a"/><path d="M50 50 m-9 0 a9 9 0 1 0 18 0" fill="none" stroke="#cfe9d4" stroke-width="2.4"/><circle cx="38" cy="38" r="5" fill="#fff" opacity=".22"/>`,
  carousel: (W, H) => { const R = Math.min(W, H) / 2, c = W / 2; return `<circle cx="${c + 4}" cy="${H / 2 + 5}" r="${R - 4}" fill="#2b2118" opacity=".22"/><circle cx="${c}" cy="${H / 2}" r="${R - 4}" fill="#e0b97c"/>` + [0, 1, 2, 3, 4, 5, 6, 7].map((k) => `<path d="M${c} ${H / 2} L${f1(c + (R - 12) * Math.cos((k * 45 - 22.5) * Math.PI / 180))} ${f1(H / 2 + (R - 12) * Math.sin((k * 45 - 22.5) * Math.PI / 180))} A${R - 12} ${R - 12} 0 0 1 ${f1(c + (R - 12) * Math.cos((k * 45 + 22.5) * Math.PI / 180))} ${f1(H / 2 + (R - 12) * Math.sin((k * 45 + 22.5) * Math.PI / 180))} Z" fill="${k % 2 ? "#fff" : "#e84393"}"/>`).join("") + `<circle cx="${c}" cy="${H / 2}" r="${R * 0.14}" fill="#f3c969"/>` + [0, 1, 2, 3].map((k) => cx(c + (R - 6) * 0.82 * Math.cos(k * Math.PI / 2 + 0.4), H / 2 + (R - 6) * 0.82 * Math.sin(k * Math.PI / 2 + 0.4), 5, "#f4efe6")).join(""); },
  press: (W, H) => `${sh(W, H, 20)}<circle cx="${W / 2}" cy="${H / 2}" r="${Math.min(W, H) / 2 - 8}" fill="#b8793f"/><circle cx="${W / 2}" cy="${H / 2}" r="${Math.min(W, H) / 2 - 20}" fill="#8e2f55"/><circle cx="${W / 2}" cy="${H / 2}" r="${Math.min(W, H) / 2 - 8}" fill="none" stroke="#4a3a30" stroke-width="5"/><rect x="${W / 2 - 4}" y="14" width="8" height="${H - 28}" rx="2" fill="#8f5a31"/><rect x="14" y="${H / 2 - 4}" width="${W - 28}" height="8" rx="2" fill="#a77d45"/><circle cx="${W / 2}" cy="${H / 2}" r="8" fill="#6b4425"/>`,
  sink: (W, H) => `${sh(W, H, 7)}${rr(8, 8, W - 16, H - 16, 7, "#cfd6dd")}` + per(W, (x, w) => `${rr(x + 18, 18, w - 36, H - 40, 12, "#fff")}${rr(x + 24, 24, w - 48, H - 52, 9, "#cbe6f7")}${cx(x + w / 2, 30 + (H - 52) / 2, 5, "#8a929c")}${rr(x + w / 2 - 3, H - 24, 6, 12, 3, "#9aa3ad")}`),
  grill: () => `<circle cx="54" cy="55" r="40" fill="#2b2118" opacity=".22"/><circle cx="50" cy="50" r="40" fill="#2b2b33"/><circle cx="50" cy="50" r="33" fill="#4a4a55"/><path d="M24 50 H76 M28 38 H72 M28 62 H72 M50 20 V80 M38 24 V76 M62 24 V76" stroke="#8f959c" stroke-width="2.4"/><circle cx="50" cy="50" r="40" fill="none" stroke="#6b7280" stroke-width="3"/><circle cx="82" cy="50" r="5" fill="#c63d3d"/>`,
  slide: (W, H) => `${sh(W, H, 8)}${rr(8, 14, W - 16, H - 28, 8, "#e4572e")}${rr(16, 22, W - 32, H - 44, 5, "#f3c969")}${rr(W * 0.74, 22, 8, H - 44, 2, "#d9a62f")}` + [0, 1, 2, 3].map((k) => rr(W * 0.8 + k * 0, 26 + k * 12, 14, 5, 2, "#8f5a31")).join("") + `<path d="M24 ${H / 2} H${W * 0.6}" stroke="#fff" stroke-width="4" opacity=".7" stroke-linecap="round"/>`,
  /* ----- standable ----- */
  chair: () => `<ellipse cx="53" cy="56" rx="32" ry="32" fill="#2b2118" opacity=".18"/>${rr(22, 14, 56, 18, 7, "#2f7f86")}${rr(20, 30, 60, 54, 12, "#4aa3ab")}${rr(26, 36, 48, 42, 8, "#63bcc3")}`,
  stool: () => `<circle cx="54" cy="55" r="30" fill="#2b2118" opacity=".2"/><circle cx="50" cy="50" r="30" fill="#b5541a"/><circle cx="50" cy="50" r="25" fill="#e1792f"/><circle cx="50" cy="50" r="15" fill="#ee8f4d" opacity=".8"/>`,
  bench: (W, H) => `${sh(W, H, 5, 3)}${rr(8, 14, W - 16, H - 28, 5, "#7d522e")}` + [0, 1, 2].map((k) => rr(12, 18 + k * ((H - 36) / 3), W - 24, (H - 36) / 3 - 4, 3, k % 2 ? "#d9a066" : "#c98b55")).join("") + `${rr(8, 10, 12, H - 20, 4, "#5e3b20")}${rr(W - 20, 10, 12, H - 20, 4, "#5e3b20")}`,
  bed: (W, H, seed) => { const c = pickc(seed, ["#4f8fd6", "#b5483f", "#4aa37a", "#8e5bd0"]); return `${sh(W, H, 9)}${rr(8, 8, W - 16, H - 16, 9, "#8f5a31")}${rr(14, 14, W - 28, H - 28, 6, "#f4f0e8")}${rr(22, 20, 36, H - 40 > 60 ? 28 : 24, 8, "#fff")}${rr(22, H - 20 - 28, 36, 28, 8, "#fff")}${rr(W * 0.42, 14, W - 14 - W * 0.42, H - 28, 6, c)}${rr(W * 0.42, 14, 14, H - 28, 3, "#fff", 0.55)}`; },
  hay: (W, H) => `${sh(W, H, 14, 3)}${rr(8, 14, W - 16, H - 28, 14, "#dcb447")}${rr(10, 16, W - 20, 20, 10, "#f0cf72")}` + per(W, (x, w) => `<path d="M${x + 16} 30 l8 10 M${x + 38} 26 l6 14 M${x + 60} 32 l8 8 M${x + 22} ${H - 38} l8 -8 M${x + 52} ${H - 34} l9 -10" stroke="#b88a26" stroke-width="2.6" stroke-linecap="round"/><rect x="${x + w * 0.3}" y="14" width="5" height="${H - 28}" fill="#a0652f" opacity=".75"/><rect x="${x + w * 0.7}" y="14" width="5" height="${H - 28}" fill="#a0652f" opacity=".75"/>`),
  carpet: (W, H, seed) => { const c = pickc(seed, ["#c9503f", "#3d6fa8", "#4aa37a", "#8e5bd0"]); return rr(8, 10, W - 16, H - 20, 6, c) + `<rect x="16" y="18" width="${W - 32}" height="${H - 36}" rx="3" fill="none" stroke="#f3c969" stroke-width="3"/><rect x="22" y="24" width="${W - 44}" height="${H - 48}" rx="2" fill="none" stroke="#fff" stroke-width="1.4" opacity=".5"/>` + per(W, (x, w) => `<path d="M${x + w / 2} 30 L${x + w / 2 + 18} ${H / 2} L${x + w / 2} ${H - 30} L${x + w / 2 - 18} ${H / 2} Z" fill="#f3c969"/><path d="M${x + w / 2} ${H / 2 - 9} L${x + w / 2 + 9} ${H / 2} L${x + w / 2} ${H / 2 + 9} L${x + w / 2 - 9} ${H / 2} Z" fill="${c}"/>`) + `<g stroke="#f3e2b3" stroke-width="2.4" stroke-linecap="round">` + Array.from({ length: Math.floor(W / 14) }, (_, k) => `<path d="M${12 + k * 14} 4 v6 M${12 + k * 14} ${H - 10} v6"/>`).join("") + `</g>`; },
  deckchair: () => `<ellipse cx="53" cy="56" rx="26" ry="38" fill="#2b2118" opacity=".18"/>${rr(26, 8, 8, 84, 3, "#8f5a31")}${rr(66, 8, 8, 84, 3, "#8f5a31")}` + [0, 1, 2, 3, 4, 5, 6].map((k) => rr(34, 12 + k * 11, 32, 11, 0, k % 2 ? "#fff" : "#2e86de")).join("") + rr(24, 10, 52, 8, 3, "#6b4425"),
  mat: (W, H) => `${sh(W, H, 9, 3)}${rr(8, 14, W - 16, H - 28, 9, "#2e86de")}<rect x="8" y="14" width="${W - 16}" height="${H - 28}" rx="9" fill="none" stroke="#1d5fa8" stroke-width="3"/>` + per(W, (x, w, i) => (i ? `<path d="M${x} 20 V${H - 20}" stroke="#1d5fa8" stroke-width="3"/>` : "") + rr(x + 18, 22, 14, 6, 3, "#8bb9ec")),
  sandbox: (W, H) => `${sh(W, H, 6)}${rr(8, 8, W - 16, H - 16, 6, "#a96a35")}${rr(16, 16, W - 32, H - 32, 3, "#efd78d")}${cx(W * 0.3, H * 0.4, 2, "#c9ac5e")}${cx(W * 0.6, H * 0.6, 2, "#c9ac5e")}<path d="M${W * 0.28} ${H * 0.72} l10 -18 l10 18 Z" fill="#e4572e"/>${rr(W * 0.58, H * 0.3, 18, 16, 3, "#2e86de")}`,
  sofa: (W, H, seed) => { const c = pickc(seed, ["#b5483f", "#3d8a95", "#c9922b", "#6a5aa8", "#4b8a55"]); const cushions = Math.max(1, Math.round(W / 100) * 2 - 0); return `${sh(W, H, 14)}${rr(8, 8, W - 16, H - 16, 14, c)}${rr(8, 8, W - 16, 30, 12, "#000", 0.18)}${rr(8, 8, 22, H - 16, 12, "#000", 0.12)}${rr(W - 30, 8, 22, H - 16, 12, "#000", 0.12)}` + Array.from({ length: cushions }, (_, k) => rr(34 + k * ((W - 68) / cushions), 40, (W - 68) / cushions - 4, H - 54, 8, "#fff", 0.22)).join("") + `<rect x="${W / 2 - 14}" y="${H - 34}" width="28" height="20" rx="6" fill="#f3c969" opacity=".9"/>`; },
  bumper: (W, H, seed) => { const c = pickc(seed, ["#d9534f", "#2e86de", "#f0b93b", "#3fa66b", "#e84393"]); return `<ellipse cx="${W / 2 + 4}" cy="${H / 2 + 5}" rx="${W / 2 - 8}" ry="${H / 2 - 8}" fill="#2b2118" opacity=".2"/><ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2 - 8}" ry="${H / 2 - 8}" fill="#2b2f36"/><ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2 - 18}" ry="${H / 2 - 16}" fill="${c}"/><ellipse cx="${W / 2 - 4}" cy="${H / 2 - 8}" rx="${W / 2 - 34}" ry="${H / 2 - 32}" fill="#fff" opacity=".22"/><circle cx="${W / 2}" cy="${H / 2 + 2}" r="9" fill="#2b2f36"/><circle cx="${W / 2}" cy="${H / 2 + 2}" r="4" fill="#9aa3ad"/><rect x="${W - 28}" y="${H / 2 - 4}" width="12" height="8" rx="3" fill="#ffe27a"/>`; },
  stain: (W, H, seed) => `<path d="M16 48 Q12 24 38 22 Q50 8 68 24 Q92 30 84 54 Q90 78 62 80 Q40 92 26 76 Q8 70 16 48 Z" fill="#26222e" opacity=".55" transform="scale(${W / 100} 1)"/><path d="M30 40 Q44 30 56 40" stroke="#6a5ab0" stroke-width="3.4" fill="none" opacity=".7" stroke-linecap="round"/><path d="M34 54 Q50 46 66 56" stroke="#3fa6a0" stroke-width="3" fill="none" opacity=".6" stroke-linecap="round"/>`,
  puddle: (W, H) => `<path d="M14 52 Q10 28 36 24 Q52 12 70 28 Q92 36 84 58 Q86 80 58 80 Q36 90 24 74 Q8 68 14 52 Z" fill="#7cc4ea" opacity=".62" transform="scale(${W / 100} 1)"/><ellipse cx="${W * 0.4}" cy="46" rx="14" ry="6" fill="none" stroke="#fff" stroke-width="2.2" opacity=".8"/><ellipse cx="${W * 0.4}" cy="46" rx="26" ry="11" fill="none" stroke="#fff" stroke-width="1.6" opacity=".45"/>`,
  blanket: (W, H, seed) => { const c = pickc(seed, ["#d9483f", "#2e86de", "#3fa66b"]); let s = `${rr(8, 8, W - 16, H - 16, 4, "#fff")}`; const n = Math.round((W - 16) / 20), m = Math.round((H - 16) / 20); for (let i = 0; i < n; i++) s += rr(8 + i * (W - 16) / n, 8, (W - 16) / n / 2, H - 16, 0, c, 0.55); for (let j = 0; j < m; j++) s += rr(8, 8 + j * (H - 16) / m, W - 16, (H - 16) / m / 2, 0, c, 0.55); return s + `<rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="4" fill="none" stroke="${c}" stroke-width="3"/>${cx(W * 0.4, H * 0.45, 12, "#f3c969")}${cx(W * 0.4, H * 0.45, 7, "#e4572e")}`; },
};

/* Footprint pieces: a covered-cell list becomes 1 piece (line / block) or, for an L, an arm of two cells plus an end cell. */
function pieces(cells) {
  const key = (r, c) => r + "," + c;
  const set = new Set(cells.map(([r, c]) => key(r, c)));
  const rs = cells.map((x) => x[0]), cs = cells.map((x) => x[1]);
  const r0 = Math.min(...rs), c0 = Math.min(...cs), h = Math.max(...rs) - r0 + 1, w = Math.max(...cs) - c0 + 1;
  if (cells.length === w * h) return [{ r0, c0, w, h }];
  // L: the corner touches both others
  const corner = cells.find(([r, c]) => cells.filter(([a, b]) => Math.abs(a - r) + Math.abs(b - c) === 1).length === 2);
  const others = cells.filter((x) => x !== corner);
  const arm = others[0], end = others[1];
  const arr = [corner, arm];
  void set;
  return [
    { r0: Math.min(arr[0][0], arr[1][0]), c0: Math.min(arr[0][1], arr[1][1]), w: Math.abs(arr[0][1] - arr[1][1]) + 1, h: Math.abs(arr[0][0] - arr[1][0]) + 1 },
    { r0: end[0], c0: end[1], w: 1, h: 1, end: true, along: corner },
  ];
}

/* Draw one object (all its cells) in board units. `face` (0/90/180/270) turns a single-cell piece (seats face their table). */
export function objectSVG(type, cells, seed = 0, face = null) {
  const draw = OBJECT_ART[type];
  return pieces(cells).map((p, k) => {
    const bw = p.w * 100, bh = p.h * 100;
    let LW = bw, LH = bh, ang = 0;
    if (bw === bh) ang = face !== null && face !== undefined ? face : (seed % 4) * 90;
    else if (bw < bh) { LW = bh; LH = bw; ang = 90; }
    if (bw !== bh && (seed + k) % 2 === 1) ang += 180; // some furniture the other way round
    const x0 = p.c0 * 100, y0 = p.r0 * 100;
    return `<g transform="translate(${x0 + bw / 2} ${y0 + bh / 2}) rotate(${ang}) translate(${-LW / 2} ${-LH / 2})">${draw(LW, LH, seed + k)}</g>`;
  }).join("");
}

/* A small standalone icon of an object type (legend, rules). */
export const objectIcon = (type, size = 34) => `<svg class="mf-icon" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">${OBJECT_ART[type](100, 100, 1)}</svg>`;

/* ---------------- small case thumbnail (floors + objects), used on the case cards ---------------- */
export function caseThumb(cs, { size = 120, kinds = null, floorOf = null } = {}) {
  const n = cs.n, u = 100;
  const room = (r, c) => parseInt(cs.grid[r][c], 36);
  let body = ""; // floor patterns live in one shared <defs> block of the page (see mordsfall.html)
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const id = room(r, c), fl = floorOf ? floorOf(id) : "planks";
    body += `<rect x="${c * u}" y="${r * u}" width="${u}" height="${u}" fill="url(#fl-${fl})"/><rect x="${c * u}" y="${r * u}" width="${u}" height="${u}" fill="${ROOM_TINT[id % 10]}" opacity=".2"/>`;
  }
  cs.objects.forEach(([t, cells], i) => { body += objectSVG(t, cells, i * 3 + cells[0][0] + cells[0][1]); });
  let walls = "";
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) { const a = r > 0 ? room(r - 1, c) : -1, b = r < n ? room(r, c) : -1; if (a !== b) walls += `M${c * u} ${r * u}H${(c + 1) * u}`; }
  for (let c = 0; c <= n; c++) for (let r = 0; r < n; r++) { const a = c > 0 ? room(r, c - 1) : -1, b = c < n ? room(r, c) : -1; if (a !== b) walls += `M${c * u} ${r * u}V${(r + 1) * u}`; }
  return `<svg class="mf-thumb" viewBox="-8 -8 ${n * u + 16} ${n * u + 16}" width="${size}" height="${size}" aria-hidden="true" preserveAspectRatio="xMidYMid meet">${body}<path d="${walls}" stroke="${INK}" stroke-width="14" stroke-linecap="square" fill="none"/></svg>`;
}
