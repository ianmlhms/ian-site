/* Mordsfall — original flat illustrations, all drawn in code (SVG strings).
 * Objects and faces live in a 100x100 box; the board scales them to the cell. Room colours come from CSS
 * variables (--mf-r0 … --mf-r9) so light and dark theme can tint them differently. */

export const PERSON_COLORS = ["#e4572e", "#2e86de", "#2fa66a", "#e1a700", "#9b5de5", "#e84393", "#00a3a3", "#7a8b2f", "#d46a1f"];
const SKIN = ["#f6d3b5", "#eebb93", "#d9a074", "#b87b54", "#8a5a3b"];
const HAIR = ["#2c2118", "#5a3a22", "#a0652f", "#e0b050", "#c8553d", "#8f959c"];

const hashOf = (s) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

/* A person's looks come from their name, their shirt colour from their seat in the case. */
export function lookOf(person, index) {
  const h = hashOf(person.name);
  const female = person.g === "f";
  const styles = female ? [1, 1, 2, 3, 0] : [0, 0, 4, 5, 2];
  return { skin: SKIN[h % SKIN.length], hair: HAIR[(h >> 3) % HAIR.length], style: styles[(h >> 6) % styles.length], shirt: PERSON_COLORS[index % PERSON_COLORS.length], female };
}

/* Face + shoulders in a 100x100 box. */
export function avatar(look, victim = false) {
  const { skin, hair, style, shirt } = look;
  const ink = "#2b2230";
  let back = "", front = "";
  if (style === 1) back = `<path d="M24 46 Q22 14 50 14 Q78 14 76 46 L78 78 Q64 84 50 80 Q36 84 22 78 Z" fill="${hair}"/>`;
  if (style === 3) back = `<circle cx="50" cy="14" r="9" fill="${hair}"/>`;
  if (style === 0) front = `<path d="M27 42 Q26 17 50 17 Q74 17 73 42 Q66 29 50 29 Q36 29 27 42 Z" fill="${hair}"/>`;
  if (style === 1) front = `<path d="M27 44 Q28 20 50 20 Q72 20 73 44 Q64 30 50 30 Q38 32 27 44 Z" fill="${hair}"/>`;
  if (style === 2) front = [[32, 28, 9], [43, 21, 10], [56, 21, 10], [67, 28, 9], [28, 38, 7], [72, 38, 7]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${hair}"/>`).join("");
  if (style === 3) front = `<path d="M27 42 Q26 17 50 17 Q74 17 73 42 Q66 29 50 29 Q36 29 27 42 Z" fill="${hair}"/>`;
  if (style === 4) front = `<path d="M26 40 Q26 14 50 14 Q74 14 74 40 Z" fill="${shirt}"/><path d="M62 38 Q82 36 86 42 L60 42 Z" fill="${shirt}" opacity=".8"/>`;
  const glasses = style === 5 ? `<g fill="none" stroke="${ink}" stroke-width="2.2"><circle cx="41" cy="46" r="7"/><circle cx="59" cy="46" r="7"/><path d="M48 46 H52"/></g>` : "";
  const eyes = victim
    ? `<g stroke="${ink}" stroke-width="2.6" stroke-linecap="round"><path d="M38 43 l7 7 M45 43 l-7 7 M55 43 l7 7 M62 43 l-7 7"/></g>`
    : `<circle cx="42" cy="46" r="2.8" fill="${ink}"/><circle cx="58" cy="46" r="2.8" fill="${ink}"/>`;
  const mouth = victim
    ? `<ellipse cx="50" cy="58" rx="3.6" ry="2.8" fill="${ink}"/>`
    : `<path d="M43 55 Q50 62 57 55" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
  const halo = victim ? `<ellipse cx="50" cy="9" rx="17" ry="4.5" fill="none" stroke="#f5c542" stroke-width="3.5"/>` : "";
  return `${back}
    <path d="M10 100 Q12 69 50 67 Q88 69 90 100 Z" fill="${shirt}"/>
    <path d="M40 67 Q50 78 60 67 Z" fill="#fff" opacity=".35"/>
    <rect x="43" y="58" width="14" height="14" rx="5" fill="${skin}"/>
    <circle cx="28" cy="48" r="4.5" fill="${skin}"/><circle cx="72" cy="48" r="4.5" fill="${skin}"/>
    <circle cx="50" cy="44" r="23" fill="${skin}"/>
    <circle cx="35" cy="54" r="4" fill="#ff7a8a" opacity=".28"/><circle cx="65" cy="54" r="4" fill="#ff7a8a" opacity=".28"/>
    ${front}${eyes}${glasses}${mouth}${halo}`;
}

let clipSeq = 0;
/* Round badge: coloured disc + face. `ring` adds an outline in the person's colour. */
export function avatarBadge(look, { size = 44, victim = false, ring = true } = {}) {
  const id = "mfc" + (clipSeq++);
  return `<svg class="mf-avatar" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    <defs><clipPath id="${id}"><circle cx="50" cy="50" r="46"/></clipPath></defs>
    <circle cx="50" cy="50" r="48" fill="${look.shirt}" opacity=".22"/>
    <g clip-path="url(#${id})">${avatar(look, victim)}</g>
    ${ring ? `<circle cx="50" cy="50" r="46" fill="none" stroke="${look.shirt}" stroke-width="6"/>` : ""}
  </svg>`;
}

/* ---------------- objects ---------------- */
const shadow = `<ellipse cx="50" cy="86" rx="34" ry="7" fill="#000" opacity=".16"/>`;
const disc = `<ellipse cx="50" cy="56" rx="40" ry="34" fill="#fff" opacity=".35"/>`;

export const OBJECT_ART = {
  table: () => `${shadow}
    <rect x="16" y="40" width="68" height="14" rx="6" fill="#e0a76a"/><rect x="16" y="50" width="68" height="8" rx="4" fill="#b97d47"/>
    <rect x="24" y="56" width="8" height="26" rx="3" fill="#8f5a31"/><rect x="68" y="56" width="8" height="26" rx="3" fill="#8f5a31"/>
    <ellipse cx="38" cy="38" rx="11" ry="3.5" fill="#fff"/><rect x="60" y="28" width="11" height="12" rx="3" fill="#e4572e"/><path d="M71 31 q6 3 0 7" fill="none" stroke="#e4572e" stroke-width="2.4"/>`,
  shelf: () => `${shadow}
    <rect x="22" y="12" width="56" height="72" rx="5" fill="#b57a45"/><rect x="27" y="17" width="46" height="62" rx="3" fill="#7d522e"/>
    <rect x="27" y="40" width="46" height="4" fill="#b57a45"/><rect x="27" y="62" width="46" height="4" fill="#b57a45"/>
    <g><rect x="30" y="22" width="6" height="18" fill="#2e86de"/><rect x="37" y="25" width="5" height="15" fill="#e4572e"/><rect x="43" y="21" width="7" height="19" fill="#2fa66a"/><rect x="52" y="26" width="5" height="14" fill="#e1a700"/><rect x="58" y="22" width="8" height="18" fill="#9b5de5"/>
    <rect x="30" y="48" width="9" height="14" fill="#e84393"/><rect x="41" y="44" width="6" height="18" fill="#2e86de"/><rect x="49" y="50" width="16" height="12" rx="2" fill="#e1a700"/>
    <rect x="30" y="68" width="5" height="11" fill="#00a3a3"/><rect x="37" y="70" width="7" height="9" fill="#e4572e"/><circle cx="62" cy="73" r="6" fill="#d46a1f"/></g>`,
  tree: () => `${shadow}
    <rect x="44" y="56" width="12" height="30" rx="3" fill="#8a5a34"/>
    <circle cx="50" cy="36" r="26" fill="#3f9156"/><circle cx="34" cy="48" r="18" fill="#4fa564"/><circle cx="66" cy="48" r="18" fill="#4fa564"/><circle cx="46" cy="28" r="14" fill="#6bbf7c"/><circle cx="60" cy="40" r="6" fill="#86d29a" opacity=".7"/>`,
  rock: () => `${shadow}
    <path d="M14 80 Q10 52 30 38 Q40 20 62 28 Q86 34 88 60 Q92 78 80 82 Z" fill="#9aa3ad"/>
    <path d="M30 38 Q40 20 62 28 Q56 40 40 46 Q30 52 28 66 Q18 58 30 38 Z" fill="#c1c8cf"/>
    <path d="M60 52 Q76 50 86 62 Q90 78 80 82 L56 82 Z" fill="#7f8993"/><path d="M26 76 q8 -6 16 0" fill="none" stroke="#5aa86d" stroke-width="4" stroke-linecap="round"/>`,
  car: () => `${shadow}
    <path d="M10 66 L14 54 Q18 46 28 46 L38 34 Q42 30 50 30 L66 30 Q72 30 76 36 L84 48 Q92 50 92 60 L92 70 L10 70 Z" fill="#d9534f"/>
    <path d="M40 38 L50 36 L50 48 L32 48 Z" fill="#cfe8f5"/><path d="M54 36 L66 36 L74 48 L54 48 Z" fill="#cfe8f5"/>
    <rect x="10" y="62" width="82" height="9" rx="3" fill="#b53f3b"/><circle cx="28" cy="72" r="9" fill="#2b2b33"/><circle cx="28" cy="72" r="4" fill="#aeb4bd"/><circle cx="72" cy="72" r="9" fill="#2b2b33"/><circle cx="72" cy="72" r="4" fill="#aeb4bd"/>
    <rect x="86" y="54" width="6" height="5" rx="2" fill="#ffe27a"/>`,
  fountain: () => `${shadow}
    <ellipse cx="50" cy="68" rx="40" ry="16" fill="#aeb8c4"/><ellipse cx="50" cy="64" rx="34" ry="12" fill="#7cc4ea"/><ellipse cx="50" cy="62" rx="22" ry="7" fill="#a7dcf4"/>
    <rect x="45" y="30" width="10" height="34" rx="4" fill="#c9d1da"/><ellipse cx="50" cy="32" rx="14" ry="5" fill="#aeb8c4"/>
    <path d="M50 16 Q50 30 34 44 M50 16 Q50 30 66 44 M50 16 L50 30" fill="none" stroke="#7cc4ea" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="14" r="4" fill="#a7dcf4"/>`,
  barrel: () => `${shadow}
    <path d="M24 26 Q14 52 24 80 L76 80 Q86 52 76 26 Z" fill="#b8793f"/><path d="M24 26 Q50 18 76 26 L76 30 Q50 22 24 30 Z" fill="#d79a5c"/>
    <path d="M19 40 Q50 46 81 40 L82 47 Q50 53 18 47 Z" fill="#4a3a30"/><path d="M19 62 Q50 68 81 62 L81 69 Q50 75 19 69 Z" fill="#4a3a30"/>
    <path d="M36 30 Q32 52 36 78" fill="none" stroke="#d79a5c" stroke-width="4" opacity=".6" stroke-linecap="round"/>`,
  plant: () => `${shadow}
    <path d="M30 60 L70 60 L64 86 L36 86 Z" fill="#c8693c"/><rect x="27" y="55" width="46" height="9" rx="3" fill="#dd7e4e"/>
    <ellipse cx="38" cy="38" rx="9" ry="19" fill="#3f9156" transform="rotate(-25 38 38)"/><ellipse cx="62" cy="38" rx="9" ry="19" fill="#4fa564" transform="rotate(25 62 38)"/>
    <ellipse cx="50" cy="32" rx="9" ry="22" fill="#5cb872"/><ellipse cx="50" cy="30" rx="3" ry="14" fill="#86d29a" opacity=".6"/>`,
  crate: () => `${shadow}
    <rect x="16" y="32" width="68" height="52" rx="4" fill="#cc9c5e"/><rect x="16" y="32" width="68" height="52" rx="4" fill="none" stroke="#8a6638" stroke-width="5"/>
    <path d="M20 36 L80 80 M80 36 L20 80" stroke="#8a6638" stroke-width="5"/><rect x="16" y="52" width="68" height="3" fill="#a77d45" opacity=".6"/>`,
  stove: () => `${shadow}
    <rect x="18" y="26" width="64" height="58" rx="6" fill="#5b6370"/><rect x="18" y="26" width="64" height="12" rx="6" fill="#7a8493"/>
    <rect x="26" y="48" width="48" height="30" rx="4" fill="#2f353f"/><rect x="32" y="54" width="36" height="14" rx="3" fill="#3c4450"/>
    <circle cx="30" cy="32" r="3" fill="#e1a700"/><circle cx="70" cy="32" r="3" fill="#e1a700"/>
    <rect x="34" y="14" width="32" height="14" rx="4" fill="#d9534f"/><rect x="30" y="18" width="6" height="3" rx="1.5" fill="#d9534f"/><rect x="64" y="18" width="6" height="3" rx="1.5" fill="#d9534f"/>`,
  /* standable: lower, flatter, on a pale disc so they never look like walls */
  chair: () => `${disc}
    <rect x="30" y="22" width="40" height="36" rx="8" fill="#3d8f96"/><rect x="34" y="26" width="32" height="28" rx="5" fill="#5bb0b6"/>
    <rect x="26" y="54" width="48" height="14" rx="6" fill="#3d8f96"/><rect x="26" y="54" width="48" height="8" rx="4" fill="#5bb0b6"/>
    <rect x="30" y="66" width="7" height="16" rx="3" fill="#2f6f75"/><rect x="63" y="66" width="7" height="16" rx="3" fill="#2f6f75"/>`,
  carpet: () => `
    <rect x="12" y="26" width="76" height="52" rx="6" fill="#c9503f"/><rect x="18" y="32" width="64" height="40" rx="4" fill="none" stroke="#f3c969" stroke-width="3"/>
    <path d="M50 36 L66 52 L50 68 L34 52 Z" fill="#f3c969"/><path d="M50 43 L59 52 L50 61 L41 52 Z" fill="#c9503f"/>
    <g stroke="#f3e2b3" stroke-width="2.4" stroke-linecap="round"><path d="M18 22 v4 M26 22 v4 M34 22 v4 M42 22 v4 M50 22 v4 M58 22 v4 M66 22 v4 M74 22 v4 M82 22 v4 M18 78 v4 M26 78 v4 M34 78 v4 M42 78 v4 M50 78 v4 M58 78 v4 M66 78 v4 M74 78 v4 M82 78 v4"/></g>`,
  bench: () => `${disc}
    <rect x="14" y="30" width="72" height="9" rx="3" fill="#b57a45"/><rect x="14" y="42" width="72" height="9" rx="3" fill="#c98b55"/>
    <rect x="14" y="56" width="72" height="12" rx="4" fill="#d9a066"/><rect x="14" y="64" width="72" height="5" rx="2" fill="#b57a45"/>
    <rect x="20" y="68" width="7" height="16" rx="2" fill="#6b4425"/><rect x="73" y="68" width="7" height="16" rx="2" fill="#6b4425"/>`,
  bed: () => `
    <rect x="16" y="14" width="68" height="74" rx="8" fill="#8f5a31"/><rect x="21" y="19" width="58" height="64" rx="5" fill="#f2efe8"/>
    <rect x="26" y="24" width="20" height="14" rx="5" fill="#fff"/><rect x="54" y="24" width="20" height="14" rx="5" fill="#fff"/>
    <rect x="21" y="44" width="58" height="39" rx="5" fill="#4f8fd6"/><path d="M21 52 H79" stroke="#8bb9ec" stroke-width="4"/><rect x="21" y="44" width="58" height="6" fill="#f2efe8" opacity=".9"/>`,
  hay: () => `
    <rect x="12" y="30" width="76" height="46" rx="12" fill="#e1b84d"/><rect x="12" y="30" width="76" height="14" rx="9" fill="#f0cf72"/>
    <g stroke="#b88a26" stroke-width="2.4" stroke-linecap="round"><path d="M22 52 l8 6 M36 48 l6 10 M52 50 l7 8 M68 48 l8 10 M28 66 l9 4 M58 66 l8 5"/></g>
    <rect x="34" y="30" width="5" height="46" fill="#a0652f" opacity=".75"/><rect x="62" y="30" width="5" height="46" fill="#a0652f" opacity=".75"/>
    <path d="M14 30 l-5 -6 M90 38 l5 -6 M24 30 l-2 -8" stroke="#e1b84d" stroke-width="3" stroke-linecap="round"/>`,
  heater: () => `${shadow}
    <rect x="22" y="40" width="56" height="44" rx="6" fill="#4f5663"/><rect x="22" y="40" width="56" height="9" rx="4" fill="#6b7482"/>
    <rect x="30" y="56" width="40" height="22" rx="3" fill="#2f353f"/><path d="M34 62 H66 M34 68 H66 M34 74 H66" stroke="#f08a3c" stroke-width="2.6" opacity=".9"/>
    <g fill="#9a9fa8"><circle cx="34" cy="34" r="8"/><circle cx="48" cy="30" r="9"/><circle cx="62" cy="34" r="8"/></g><g fill="#c2c6cd"><circle cx="46" cy="27" r="4"/><circle cx="31" cy="32" r="3"/></g>`,
  bucket: () => `${shadow}
    <path d="M28 40 L72 40 L66 82 L34 82 Z" fill="#c98b55"/><path d="M28 40 L72 40 L71 47 L29 47 Z" fill="#e0a76a"/><path d="M31 60 H69 M33 72 H67" stroke="#6d6f78" stroke-width="4"/>
    <ellipse cx="50" cy="40" rx="22" ry="5" fill="#7cc4ea"/><path d="M30 42 Q50 4 70 42" fill="none" stroke="#6d6f78" stroke-width="3.4"/>`,
  fridge: () => `${shadow}
    <rect x="28" y="10" width="44" height="76" rx="7" fill="#dfe8f1"/><rect x="28" y="10" width="44" height="76" rx="7" fill="none" stroke="#aab7c6" stroke-width="3"/>
    <path d="M28 36 H72" stroke="#aab7c6" stroke-width="3"/><rect x="62" y="18" width="4" height="12" rx="2" fill="#7a8493"/><rect x="62" y="44" width="4" height="22" rx="2" fill="#7a8493"/>
    <rect x="34" y="16" width="10" height="5" rx="2" fill="#e84393"/>`,
  counter: () => `${shadow}
    <rect x="8" y="42" width="84" height="12" rx="5" fill="#e0a76a"/><rect x="10" y="54" width="80" height="30" rx="4" fill="#9a6a3c"/>
    <path d="M24 56 V82 M42 56 V82 M60 56 V82 M78 56 V82" stroke="#7d522e" stroke-width="3"/>
    <rect x="18" y="26" width="10" height="16" rx="3" fill="#cfe8f5"/><rect x="34" y="30" width="8" height="12" rx="2" fill="#f3c969"/><ellipse cx="68" cy="38" rx="11" ry="3.6" fill="#fff"/><circle cx="68" cy="34" r="4" fill="#e4572e"/>`,
  parasol: () => `${shadow}
    <rect x="48" y="30" width="4" height="54" rx="2" fill="#8f5a31"/><ellipse cx="50" cy="84" rx="14" ry="4" fill="#6b4425"/>
    <path d="M8 40 Q50 -6 92 40 Z" fill="#fff"/><path d="M8 40 Q22 12 36 6 L38 40 Z M62 40 L64 6 Q78 12 92 40 Z M38 40 L38 6 Q50 3 62 6 L62 40 Z" fill="none"/>
    <path d="M8 40 Q16 20 30 11 L36 40 Z" fill="#e4572e"/><path d="M50 40 L50 4 Q44 5 40 8 L36 40 Z" fill="#e4572e" opacity="0"/><path d="M36 40 L40 8 Q50 3 60 8 L64 40 Z" fill="#fff"/><path d="M64 40 L70 11 Q84 20 92 40 Z" fill="#e4572e"/>`,
  tent: () => `${shadow}
    <path d="M8 82 L50 16 L92 82 Z" fill="#e1832e"/><path d="M50 16 L92 82 L58 82 Z" fill="#c76a1c"/><path d="M50 16 L36 82 L64 82 Z" fill="#2b2230" opacity=".85"/><path d="M50 16 L43 82 L57 82 Z" fill="#f3d6a6" opacity=".7"/>
    <path d="M50 16 V8 M50 8 L62 12 L50 15" fill="#d9534f" stroke="#8a3a2a" stroke-width="1.6"/><path d="M10 82 L4 90 M90 82 L96 90" stroke="#8f5a31" stroke-width="3"/>`,
  campfire: () => `${shadow}
    <g fill="#8f959c"><circle cx="24" cy="78" r="7"/><circle cx="38" cy="82" r="7"/><circle cx="62" cy="82" r="7"/><circle cx="76" cy="78" r="7"/></g>
    <rect x="24" y="68" width="52" height="9" rx="4" fill="#8a5a34" transform="rotate(-12 50 72)"/><rect x="24" y="68" width="52" height="9" rx="4" fill="#6b4425" transform="rotate(12 50 72)"/>
    <path d="M50 16 Q66 36 62 56 Q60 70 50 70 Q38 70 36 56 Q34 44 44 34 Q44 44 50 46 Q54 34 50 16 Z" fill="#f08a3c"/><path d="M50 36 Q58 48 56 58 Q54 66 50 66 Q44 66 44 58 Q44 50 50 36 Z" fill="#ffd45e"/>`,
  tap: () => `${shadow}
    <rect x="42" y="36" width="16" height="48" rx="4" fill="#9aa3ad"/><rect x="38" y="78" width="24" height="8" rx="3" fill="#6d7681"/>
    <path d="M50 36 V26 Q50 18 60 18 H72 V28" fill="none" stroke="#9aa3ad" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="40" cy="22" r="7" fill="#d9534f"/><path d="M72 34 q-5 8 0 12 q5 -4 0 -12 Z" fill="#7cc4ea"/><ellipse cx="72" cy="86" rx="12" ry="3.4" fill="#7cc4ea" opacity=".8"/>`,
  desk: () => `${shadow}
    <rect x="12" y="46" width="76" height="10" rx="4" fill="#e0a76a"/><rect x="14" y="54" width="14" height="30" rx="3" fill="#b57a45"/><rect x="72" y="54" width="14" height="30" rx="3" fill="#b57a45"/><rect x="16" y="62" width="10" height="5" rx="2" fill="#7d522e"/><rect x="74" y="62" width="10" height="5" rx="2" fill="#7d522e"/>
    <rect x="30" y="22" width="30" height="21" rx="3" fill="#3a4250"/><rect x="33" y="25" width="24" height="15" rx="1.5" fill="#8fd0f0"/><rect x="42" y="43" width="6" height="4" fill="#3a4250"/><rect x="66" y="36" width="12" height="9" rx="2" fill="#e4572e"/>`,
  copier: () => `${shadow}
    <rect x="14" y="40" width="72" height="44" rx="6" fill="#c9d0d8"/><rect x="14" y="40" width="72" height="12" rx="5" fill="#eef1f4"/><rect x="20" y="30" width="60" height="12" rx="3" fill="#e1e6ec"/>
    <rect x="22" y="58" width="26" height="6" rx="2" fill="#6d7681"/><circle cx="64" cy="61" r="4" fill="#2fa66a"/><circle cx="76" cy="61" r="4" fill="#e1a700"/><rect x="26" y="70" width="48" height="10" rx="2" fill="#9aa3ad"/><rect x="32" y="64" width="34" height="10" fill="#fff"/>`,
  board: () => `${shadow}
    <path d="M30 84 L40 52 M70 84 L60 52" stroke="#8f5a31" stroke-width="6" stroke-linecap="round"/><rect x="12" y="14" width="76" height="46" rx="4" fill="#8f5a31"/><rect x="17" y="19" width="66" height="36" rx="2" fill="#2f6f5a"/>
    <path d="M24 28 H52 M24 36 H60 M24 44 H44" stroke="#eef3ea" stroke-width="2.8" stroke-linecap="round" opacity=".9"/><rect x="62" y="46" width="14" height="4" rx="2" fill="#f3c969"/>`,
  stall: () => `${shadow}
    <rect x="16" y="40" width="68" height="46" rx="3" fill="#cc9c5e"/><rect x="16" y="62" width="68" height="8" fill="#b57a45"/><rect x="20" y="46" width="10" height="16" rx="3" fill="#e4572e"/><rect x="34" y="50" width="10" height="12" rx="3" fill="#e1a700"/><circle cx="62" cy="55" r="7" fill="#d46a1f"/><circle cx="74" cy="57" r="5" fill="#2fa66a"/>
    <path d="M10 18 H90 L96 40 H4 Z" fill="#fff"/><path d="M10 18 H26 L22 40 H4 Z M42 18 H58 L58 40 H38 Z M74 18 H90 L96 40 H78 Z" fill="#e4572e"/><rect x="14" y="40" width="4" height="40" fill="#8f5a31"/><rect x="82" y="40" width="4" height="40" fill="#8f5a31"/>`,
  bin: () => `${shadow}
    <path d="M30 36 L70 36 L65 84 L35 84 Z" fill="#4f9d5c"/><rect x="26" y="28" width="48" height="10" rx="5" fill="#3d8348"/><rect x="42" y="22" width="16" height="7" rx="3" fill="#2f6d3a"/>
    <path d="M42 46 V76 M50 46 V76 M58 46 V76" stroke="#3d8348" stroke-width="3.4" stroke-linecap="round"/>`,
  carousel: () => `${shadow}
    <ellipse cx="50" cy="74" rx="40" ry="12" fill="#cc9c5e"/><ellipse cx="50" cy="70" rx="38" ry="10" fill="#e0b97c"/>
    <rect x="47" y="24" width="6" height="46" fill="#aeb4bd"/><path d="M12 36 L50 6 L88 36 Z" fill="#fff"/><path d="M12 36 L50 6 L34 36 Z M66 36 L50 6 L88 36 Z" fill="#e84393"/><path d="M12 36 H88" stroke="#f3c969" stroke-width="5"/>
    <g fill="#f4efe6"><rect x="24" y="46" width="14" height="18" rx="5"/><rect x="62" y="46" width="14" height="18" rx="5"/></g><circle cx="31" cy="46" r="5" fill="#f4efe6"/><circle cx="69" cy="46" r="5" fill="#f4efe6"/>`,
  press: () => `${shadow}
    <rect x="22" y="48" width="56" height="36" rx="6" fill="#b8793f"/><path d="M22 58 H78 M22 72 H78" stroke="#4a3a30" stroke-width="5"/><ellipse cx="50" cy="48" rx="28" ry="7" fill="#d79a5c"/><ellipse cx="50" cy="47" rx="22" ry="4.6" fill="#8e2f55"/>
    <rect x="46" y="10" width="8" height="38" fill="#8f5a31"/><rect x="26" y="14" width="48" height="8" rx="3" fill="#8f5a31"/><rect x="40" y="38" width="20" height="9" rx="2" fill="#a77d45"/>`,
  sink: () => `${shadow}
    <rect x="16" y="52" width="68" height="32" rx="5" fill="#cfd6dd"/><rect x="16" y="52" width="68" height="7" rx="3" fill="#eef1f4"/><rect x="22" y="40" width="56" height="14" rx="7" fill="#fff"/><ellipse cx="50" cy="46" rx="22" ry="5" fill="#7cc4ea" opacity=".6"/>
    <path d="M50 38 V28 Q50 22 58 22 H64" fill="none" stroke="#9aa3ad" stroke-width="6" stroke-linecap="round"/><rect x="26" y="64" width="22" height="16" rx="2" fill="#aeb8c4"/><rect x="52" y="64" width="22" height="16" rx="2" fill="#aeb8c4"/>`,
  grill: () => `${shadow}
    <path d="M18 44 Q50 4 82 44 Z" fill="#2b2b33"/><path d="M18 44 H82 Q76 66 50 68 Q24 66 18 44 Z" fill="#4a4a55"/><circle cx="50" cy="16" r="4" fill="#8f959c"/>
    <path d="M36 68 L28 86 M64 68 L72 86 M50 68 V86" stroke="#2b2b33" stroke-width="5" stroke-linecap="round"/><path d="M42 24 q-6 -8 0 -14 M56 22 q6 -8 0 -14" fill="none" stroke="#fff" stroke-width="3" opacity=".6" stroke-linecap="round"/>`,
  slide: () => `${shadow}
    <path d="M20 84 V24 M32 84 V24" stroke="#8f5a31" stroke-width="5"/><path d="M20 36 H32 M20 50 H32 M20 64 H32 M20 78 H32" stroke="#8f5a31" stroke-width="4"/>
    <rect x="14" y="18" width="24" height="8" rx="3" fill="#e4572e"/><path d="M34 24 L84 78 L92 70 L42 18 Z" fill="#f3c969"/><path d="M34 24 L84 78" stroke="#e1a700" stroke-width="5"/><path d="M80 84 H94" stroke="#6b4425" stroke-width="4" stroke-linecap="round"/>`,
  stool: () => `${disc}
    <ellipse cx="50" cy="44" rx="24" ry="9" fill="#d46a1f"/><path d="M26 44 V50 Q50 62 74 50 V44 Q50 56 26 44 Z" fill="#b5541a"/><ellipse cx="50" cy="42" rx="19" ry="6" fill="#ee8b44"/>
    <path d="M34 54 L28 80 M66 54 L72 80 M50 58 V82" stroke="#6b4425" stroke-width="5" stroke-linecap="round"/>`,
  deckchair: () => `${disc}
    <path d="M26 84 L44 26 M74 84 L56 26" stroke="#8f5a31" stroke-width="5" stroke-linecap="round"/><path d="M30 76 L70 76" stroke="#8f5a31" stroke-width="5" stroke-linecap="round"/>
    <path d="M40 22 L60 22 L74 70 L30 70 Z" fill="#fff"/><path d="M40 22 L47 22 L45 70 L30 70 Z M53 22 L60 22 L74 70 L56 70 Z" fill="#2e86de"/>`,
  mat: () => `
    <rect x="10" y="30" width="80" height="44" rx="8" fill="#2e86de"/><rect x="10" y="30" width="80" height="44" rx="8" fill="none" stroke="#1d5fa8" stroke-width="3"/>
    <path d="M50 32 V72" stroke="#1d5fa8" stroke-width="3"/><rect x="20" y="36" width="8" height="5" rx="2" fill="#8bb9ec"/><rect x="72" y="63" width="8" height="5" rx="2" fill="#8bb9ec"/>`,
  sandbox: () => `
    <rect x="12" y="22" width="76" height="62" rx="6" fill="#b57a45"/><rect x="19" y="29" width="62" height="48" rx="3" fill="#ecd08a"/><circle cx="36" cy="50" r="2" fill="#cfae5e"/><circle cx="62" cy="40" r="2" fill="#cfae5e"/><circle cx="56" cy="66" r="2" fill="#cfae5e"/>
    <path d="M28 66 L36 54 L44 66 Z" fill="#e4572e"/><rect x="58" y="46" width="12" height="12" rx="3" fill="#2e86de"/>`,
};

export const objectArt = (type, x, y, s, extra = "") => `<g transform="translate(${x} ${y}) scale(${s / 100})" ${extra}>${OBJECT_ART[type]()}</g>`;
/* Stand-alone icon for the legend / rules. */
export const objectIcon = (type, size = 34) => `<svg class="mf-icon" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">${OBJECT_ART[type]()}</svg>`;

/* ---------------- small case thumbnail (rooms + objects), used on the case cards ---------------- */
export function caseThumb(cs, { size = 120 } = {}) {
  const n = cs.n, u = 100;
  const room = (r, c) => parseInt(cs.grid[r][c], 36);
  let body = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) body += `<rect x="${c * u}" y="${r * u}" width="${u}" height="${u}" fill="var(--mf-r${room(r, c) % 10})"/>`;
  for (const [r, c, t] of cs.objects) body += objectArt(t, c * u + 6, r * u + 6, u - 12);
  let walls = "";
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) {
    const a = r > 0 ? room(r - 1, c) : -1, b = r < n ? room(r, c) : -1;
    if (a !== b) walls += `M${c * u} ${r * u}H${(c + 1) * u}`;
  }
  for (let c = 0; c <= n; c++) for (let r = 0; r < n; r++) {
    const a = c > 0 ? room(r, c - 1) : -1, b = c < n ? room(r, c) : -1;
    if (a !== b) walls += `M${c * u} ${r * u}V${(r + 1) * u}`;
  }
  return `<svg class="mf-thumb" viewBox="-6 -6 ${n * u + 12} ${n * u + 12}" width="${size}" height="${size}" aria-hidden="true" preserveAspectRatio="xMidYMid meet">${body}<path d="${walls}" stroke="var(--mf-wall)" stroke-width="12" stroke-linecap="square" fill="none"/></svg>`;
}
