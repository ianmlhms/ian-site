/* people-picker.js — the "add people" dialog: search by name, tap friends / recent players, multi-select chips.
 * One component for two jobs:
 *   - messenger.js  → new group / add people to a group chat
 *   - mp-lobby.js   → "Leit derbäisetzen" in a game lobby (sends invites)
 *
 *   openPeoplePicker({ sb, title, okText, ... }) → Promise<{ name, people: [{id, username}] } | null>
 *   loadViewerRestriction(sb)                   → { restricted, allow(username) }   (visibility restriction)
 *
 * Search itself is people-search.js (profiles are public). Friends and recent players are optional lists the CALLER
 * hands in (so this file makes no requests of its own besides the name search):
 *   friends: [{ id, username, avatar? }]   recent: [{ id, username, avatar? }]
 * Restricted viewers: pass `allow` so only people they may see are offered (UX only, the server enforces it too).
 * Every text is a parameter (callers own their language); English fallbacks keep it usable stand-alone. */
import { attachPeopleSearch, avatarHtml } from "./people-search.js?v=1";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const DEFAULT_TEXT = Object.freeze({
  close: "Close", who: "Who should join?", placeholder: "Search a name", none: "Nobody picked yet.", noMatch: "Nobody found.",
  remove: "Remove", addN: "Add {n}", friends: "Friends", recent: "Played with recently", nameLabel: "Name",
});

/* A restricted account only sees an allow-list of people (profile-v2.sql). Same rule the friends page and the
 * messenger already apply; one call, only when the picker is about to open. */
export async function loadViewerRestriction(sb) {
  try {
    const { data: restricted } = await sb.rpc("is_view_restricted");
    if (!restricted) return { restricted: false, allow: null };
    const { data: ids } = await sb.rpc("visible_user_ids");
    const uids = (ids || []).map((x) => x.user_id);
    let names = new Set();
    if (uids.length) {
      const { data: profs } = await sb.from("profiles").select("username").in("id", uids);
      names = new Set((profs || []).map((p) => String(p.username).toLowerCase()));
    }
    return { restricted: true, allow: (n) => names.has(String(n).toLowerCase()) };
  } catch (error) {
    console.warn("[people-picker] restriction lookup failed", error);
    return { restricted: false, allow: null };
  }
}

let styled = false;
function injectStyle() {
  if (styled || document.getElementById("ppk-css")) { styled = true; return; }
  styled = true;
  const st = document.createElement("style");
  st.id = "ppk-css";
  st.textContent = `
.ppk-modal{position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;
  background:color-mix(in srgb,#000 56%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);overscroll-behavior:contain}
.ppk-box{position:relative;display:flex;flex-direction:column;gap:10px;width:min(26rem,calc(100vw - 2rem));max-height:calc(100dvh - 2rem);padding:20px;
  border:1px solid var(--border,#2a2a4a);border-radius:var(--radius-pane,20px);background:var(--glass-solid,var(--card-opaque,#161625));
  box-shadow:0 1.8rem 4.5rem color-mix(in srgb,#000 32%,transparent);color:var(--text,#e8e8f0);font-family:inherit;overflow:auto;text-align:left}
.ppk-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ppk-head h3{margin:0;font-size:1.25rem;letter-spacing:-.02em;line-height:1.25}
.ppk-x{display:grid;place-items:center;flex:none;width:var(--hit-target,2.75rem);height:var(--hit-target,2.75rem);padding:0;border:0;border-radius:50%;
  background:var(--control-fill,color-mix(in srgb,var(--text,#fff) 9%,transparent));color:var(--text,#e8e8f0);font-size:1.3rem;line-height:1;cursor:pointer}
.ppk-x:hover{background:var(--card-hover,#1e1e35)}
.ppk-box input[type=search],.ppk-box input[type=text]{width:100%;min-height:var(--hit-target,2.75rem);padding:0 12px;border:1px solid var(--border,#2a2a4a);
  border-radius:var(--radius-inner,12px);background:var(--control-fill,color-mix(in srgb,var(--text,#fff) 9%,transparent));color:var(--text,#e8e8f0);font:inherit;font-size:16px}
.pp-label{display:block;margin:6px 0 0;font-size:13px;font-weight:700;color:var(--muted,#8888aa)}
.pp-chips{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0;min-height:30px}
.pp-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 4px 4px 12px;border-radius:var(--r-chip,14px);
  background:color-mix(in srgb,var(--accent,#6ea8fe) 14%,var(--card-opaque,#161625));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent,#6ea8fe) 26%,transparent);font-size:14px;font-weight:600}
.pp-chip button{display:grid;place-items:center;border:0;background:none;color:var(--muted,#8888aa);font-size:17px;line-height:1;width:var(--hit-target,2.75rem);height:30px;min-height:0;padding:0;border-radius:50%;cursor:pointer}
.pp-chip button:hover{color:var(--text,#e8e8f0);background:var(--card,rgba(127,127,127,.15))}
.pp-empty{font-size:12.5px;color:var(--muted,#8888aa)}
.ppk-sect h4{margin:4px 0 6px;font-size:12.5px;font-weight:700;color:var(--muted,#8888aa);text-transform:uppercase;letter-spacing:.04em}
.ppk-list{display:flex;flex-direction:column;gap:4px;max-height:min(210px,28vh);overflow-y:auto}
.ppk-row{display:flex;align-items:center;gap:10px;width:100%;min-height:var(--hit-target,2.75rem);padding:4px 10px;border:1px solid transparent;border-radius:var(--radius-inner,12px);
  background:var(--control-fill,color-mix(in srgb,var(--text,#fff) 7%,transparent));color:inherit;font:inherit;font-size:15px;text-align:left;cursor:pointer}
.ppk-row:hover{background:var(--card-hover,#1e1e35)}
.ppk-row[aria-pressed=true]{border-color:var(--accent,#6ea8fe);background:color-mix(in srgb,var(--accent,#6ea8fe) 14%,var(--card-opaque,#161625))}
.ppk-row .ppk-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ppk-row .ppk-tick{flex:none;min-width:1.2em;text-align:center;font-weight:800;color:var(--accent-text,var(--accent,#6ea8fe))}
.ppk-av{display:inline-flex;width:26px;height:26px;flex:none;border-radius:50%;overflow:hidden;align-items:center;justify-content:center;font-size:17px}
.ppk-av img{width:100%;height:100%;object-fit:cover}
.ppk-go{width:100%;min-height:var(--hit-target,2.75rem);padding:0 16px;border:0;border-radius:var(--radius-inner,12px);background:var(--accent,#6ea8fe);color:var(--accent-foreground,#000);font:inherit;font-size:1rem;font-weight:700;cursor:pointer}
.ppk-go:disabled{opacity:.5;cursor:default}
.ppk-box :focus-visible{outline:2px solid var(--focus-ring,var(--text,#fff));outline-offset:2px}
@media(prefers-reduced-motion:reduce){.ppk-modal *{transition:none!important}}`;
  document.head.appendChild(st);
}

export function openPeoplePicker({
  sb, title, okText, withName = false, exclude = new Set(), allow = null, friends = null, recent = null,
  maxPick = 16, text = {},
} = {}) {
  injectStyle();
  const T = { ...DEFAULT_TEXT, ...text };
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const m = document.createElement("div");
    m.className = "ppk-modal";
    const keep = (list) => (list || []).filter((p) => p && p.id && p.username && !exclude.has(p.id) && (!allow || allow(p.username)));
    const friendRows = keep(friends), recentRows = keep(recent).filter((r) => !friendRows.some((f) => f.id === r.id));
    const section = (id, heading, rows) => rows.length
      ? `<div class="ppk-sect"><h4>${esc(heading)}</h4><div class="ppk-list" id="${id}">${rows.map((p) =>
        `<button type="button" class="ppk-row" data-uid="${esc(p.id)}" data-name="${esc(p.username)}" aria-pressed="false"><span class="ppk-av" aria-hidden="true">${avatarHtml(p.avatar)}</span><span class="ppk-name">${esc(p.username)}</span><span class="ppk-tick" aria-hidden="true"></span></button>`).join("")}</div></div>`
      : "";
    m.innerHTML = `<div class="ppk-box pp-box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="ppk-head"><h3>${esc(title)}</h3><button class="ppk-x" type="button" aria-label="${esc(T.close)}"><span aria-hidden="true">&times;</span></button></div>
      ${withName ? `<input id="ppName" name="group-name" type="text" aria-label="${esc(T.nameLabel)}" placeholder="${esc(T.nameLabel)}" maxlength="60" autocomplete="off">` : ""}
      <label class="pp-label" for="ppSearch">${esc(T.who)}</label>
      <input id="ppSearch" name="people" type="search" placeholder="${esc(T.placeholder)}" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="pp-chips" id="ppChips" aria-live="polite"></div>
      ${section("ppFriends", T.friends, friendRows)}${section("ppRecent", T.recent, recentRows)}
      <button class="ppk-go" id="ppGo" type="button"></button></div>`;
    document.body.appendChild(m);

    let picked = [];
    const chips = m.querySelector("#ppChips");
    const go = m.querySelector("#ppGo");
    const nameInput = m.querySelector("#ppName");
    const search = m.querySelector("#ppSearch");
    const rows = [...m.querySelectorAll(".ppk-row")];
    const isPicked = (id) => picked.some((u) => u.id === id);

    const paint = () => {
      chips.innerHTML = picked.length
        ? picked.map((u) => `<span class="pp-chip">${esc(u.username)}<button type="button" data-uid="${esc(u.id)}" aria-label="${esc(T.remove + ": " + u.username)}"><span aria-hidden="true">&times;</span></button></span>`).join("")
        : `<span class="pp-empty">${esc(T.none)}</span>`;
      chips.querySelectorAll("button[data-uid]").forEach((b) => (b.onclick = () => { picked = picked.filter((u) => u.id !== b.dataset.uid); paint(); }));
      rows.forEach((r) => {
        const on = isPicked(r.dataset.uid);
        r.setAttribute("aria-pressed", String(on));
        r.querySelector(".ppk-tick").textContent = on ? "✓" : "";
      });
      go.textContent = withName ? okText : (picked.length ? T.addN.replace("{n}", picked.length) : okText);
      go.disabled = !withName && !picked.length;
    };
    const add = (u) => { if (!isPicked(u.id) && picked.length < maxPick) picked = [...picked, { id: u.id, username: u.username }]; };
    rows.forEach((r) => (r.onclick = () => {
      if (isPicked(r.dataset.uid)) picked = picked.filter((u) => u.id !== r.dataset.uid);
      else add({ id: r.dataset.uid, username: r.dataset.name });
      paint();
    }));

    const detach = attachPeopleSearch(search, {
      sb, emptyText: T.noMatch,
      exclude: () => new Set([...exclude, ...picked.map((u) => u.id)]),
      allow,
      onPick: (u) => { add(u); search.value = ""; paint(); search.focus(); },
    });
    const close = (val) => { detach(); m.remove(); if (opener && opener.isConnected && opener.focus) opener.focus(); resolve(val); };
    const submit = () => {
      const name = nameInput ? nameInput.value.trim() : "";
      if (withName && !name) { nameInput.focus(); return; }
      if (!withName && !picked.length) { search.focus(); return; }
      close({ name, people: picked });
    };
    m.querySelector(".ppk-x").onclick = () => close(null);
    m.addEventListener("click", (e) => { if (e.target === m) close(null); });
    m.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(null); return; }
      if (e.key !== "Tab") return;
      // keep Tab inside the dialog
      const f = [...m.querySelectorAll("button:not([disabled]),input")].filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    go.onclick = submit;
    nameInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search.focus(); } });
    paint();
    (nameInput || search).focus();
  });
}
