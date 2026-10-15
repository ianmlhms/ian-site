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
