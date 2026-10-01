/* people-search.js — find people by part of their username ("emm" → every Emma).
 * Used by friends.js (add a friend), messenger.js (new DM + invite to a group).
 *
 *   searchPeople(sb, query, { exclude, allow, limit })  → [{id, username, avatar}]
 *   attachPeopleSearch(input, { sb, onPick, exclude, allow })  → detach()
 *
 * Names that START with the query come first, then names that contain it.
 * `exclude` is a Set of user ids to hide, `allow(username)` an optional filter
 * (restricted viewers). Reading profiles is public (RLS profiles_read). */

export const MIN_CHARS = 1;
const DEFAULT_LIMIT = 8;
const DEBOUNCE_MS = 180;
const DROPDOWN_GAP_PX = 4;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// %, _ and \ are LIKE wildcards — escape them so they match literally.
const likeEscape = (q) => q.replace(/[\\%_]/g, (c) => "\\" + c);

async function queryProfiles(sb, pattern, limit) {
  const { data, error } = await sb.from("profiles").select("id,username,avatar")
    .ilike("username", pattern).order("username").limit(limit);
  if (error) throw error;
  return data || [];
}

export async function searchPeople(sb, raw, { exclude = new Set(), allow = null, limit = DEFAULT_LIMIT } = {}) {
  const q = String(raw || "").trim();
  if (q.length < MIN_CHARS) return [];
  const keep = (u) => u.username && !exclude.has(u.id) && (!allow || allow(u.username));
  const fetchCount = limit + exclude.size;
  const starts = (await queryProfiles(sb, `${likeEscape(q)}%`, fetchCount)).filter(keep);
  if (starts.length >= limit) return starts.slice(0, limit);
  const seen = new Set(starts.map((u) => u.id));
  const contains = (await queryProfiles(sb, `%${likeEscape(q)}%`, fetchCount + starts.length))
    .filter((u) => keep(u) && !seen.has(u.id));
  return [...starts, ...contains].slice(0, limit);
}

export function highlightMatch(name, q) {
  const at = name.toLowerCase().indexOf(String(q).trim().toLowerCase());
  const len = String(q).trim().length;
  if (at < 0 || !len) return esc(name);
  return esc(name.slice(0, at)) + "<b>" + esc(name.slice(at, at + len)) + "</b>" + esc(name.slice(at + len));
}

export function avatarHtml(avatar) {
  if (/^https?:\/\//.test(avatar || "")) return `<img src="${esc(avatar)}" alt="">`;
  return esc(avatar || "👤");
}

/* ---------- dropdown under an <input> ---------- */
let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const st = document.createElement("style");
  st.textContent = `
.ps-drop{position:fixed;z-index:10000;display:none;flex-direction:column;gap:2px;padding:4px;max-height:min(320px,50vh);overflow-y:auto;
  background:var(--card2,var(--card,#1e1e35));border:1px solid var(--border,#2a2a4a);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.ps-drop.open{display:flex}
.ps-item{display:flex;align-items:center;gap:10px;min-height:44px;padding:4px 10px;border:0;border-radius:9px;background:none;
  color:var(--text,#e8e8f0);font:inherit;font-size:15px;text-align:left;cursor:pointer}
.ps-item:hover,.ps-item.active{background:var(--card,rgba(127,127,127,.15))}
.ps-item b{color:var(--accent-text,var(--accent,#6ea8fe))}
.ps-av{display:inline-flex;width:26px;height:26px;flex:none;border-radius:50%;overflow:hidden;align-items:center;justify-content:center;font-size:17px}
.ps-av img{width:100%;height:100%;object-fit:cover}
.ps-empty{padding:10px;color:var(--muted,#8888aa);font-size:13px}`;
  document.head.appendChild(st);
}

export function attachPeopleSearch(input, { sb, onPick, exclude = () => new Set(), allow = null, emptyText = "—" }) {
  injectStyle();
  const drop = document.createElement("div");
  drop.className = "ps-drop";
  drop.setAttribute("role", "listbox");
  document.body.appendChild(drop);
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("spellcheck", "false");

  let people = [], active = -1, timer = null, seq = 0;

  const place = () => {
    const r = input.getBoundingClientRect();
    Object.assign(drop.style, { left: `${r.left}px`, top: `${r.bottom + DROPDOWN_GAP_PX}px`, width: `${r.width}px` });
  };
  const close = () => { drop.classList.remove("open"); active = -1; };
  const paintActive = () => drop.querySelectorAll(".ps-item").forEach((b, i) => b.classList.toggle("active", i === active));
  const pick = (u) => { close(); input.value = u.username; onPick(u); };

  function render(q) {
    if (!people.length) {
      drop.innerHTML = `<div class="ps-empty">${esc(emptyText)}</div>`;
    } else {
      drop.innerHTML = people.map((u, i) =>
        `<button type="button" class="ps-item" role="option" data-i="${i}"><span class="ps-av">${avatarHtml(u.avatar)}</span><span>${highlightMatch(u.username, q)}</span></button>`).join("");
      // mousedown, not click: keeps focus in the input (no blur-close before the pick)
      drop.querySelectorAll(".ps-item").forEach((b) => b.addEventListener("mousedown", (e) => { e.preventDefault(); pick(people[+b.dataset.i]); }));
    }
    active = -1;
    place();
    drop.classList.add("open");
  }

  async function run() {
    const q = input.value.trim();
    const mine = ++seq;
    if (q.length < MIN_CHARS) { people = []; close(); return; }
    try {
      const found = await searchPeople(sb, q, { exclude: exclude(), allow });
      if (mine !== seq || document.activeElement !== input) return;
      people = found;
      render(q);
    } catch (e) {
      console.warn("[people-search] search failed for", q, e);
      close();
    }
  }

  const onInput = () => { clearTimeout(timer); timer = setTimeout(run, DEBOUNCE_MS); };
  // capture: runs before the page's own Enter handler, so Enter on a highlighted name picks it
  const onKey = (e) => {
    if (!drop.classList.contains("open") || !people.length) { if (e.key === "Escape") close(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      active = (active + step + people.length) % people.length;
      paintActive();
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault(); e.stopImmediatePropagation();
      pick(people[active]);
    } else if (e.key === "Escape") {
      e.stopPropagation(); close();
    }
  };
  const onBlur = () => setTimeout(close, 120);
  const onMove = () => { if (drop.classList.contains("open")) place(); };

  input.addEventListener("input", onInput);
  input.addEventListener("focus", onInput);
  input.addEventListener("keydown", onKey, true);
  input.addEventListener("blur", onBlur);
  window.addEventListener("resize", onMove);
  window.addEventListener("scroll", onMove, true);

  return function detach() {
    clearTimeout(timer);
    input.removeEventListener("input", onInput);
    input.removeEventListener("focus", onInput);
    input.removeEventListener("keydown", onKey, true);
    input.removeEventListener("blur", onBlur);
    window.removeEventListener("resize", onMove);
    window.removeEventListener("scroll", onMove, true);
    drop.remove();
  };
}
