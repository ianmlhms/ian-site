/* Shared leaderboard identity tags. The RPC is available to signed-in full accounts only. */

import { arcadeText } from "./score-format.js?v=5";

const STYLE_ID = "leaderboard-tag-styles";
export const EVENT_BADGES = Object.freeze({ "halloween-2026": Object.freeze({ icon: "🎃", title: "Halloween 2026" }) });
export function eventBadgesHtml(badges, className = "event-tag", full = false) {
  return (Array.isArray(badges) ? badges : []).filter((id) => Object.hasOwn(EVENT_BADGES, id)).map((id) => {
    const badge = EVENT_BADGES[id];
    return ` <span class="${esc(className)}" title="${esc(badge.title)}">${badge.icon}${full ? " " + esc(badge.title) : ""}</span>`;
  }).join("");
}
const emptyLookup = Object.freeze(Object.create(null));
const EMPTY_TAGS = Object.freeze({
  byUserId: emptyLookup,
  byUsername: emptyLookup,
  owner: null,
});

let tagsPromise = null;

const esc = (value) => String(value ?? "").replace(
  /[&<>"]/g,
  (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
);

function injectTagCss() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    body .admin-tag,
    body :is(.class-tag,.streak-tag,.champion-tag,.event-tag) {
      display: inline-block;
      margin-inline-start: 5px;
      padding: 0 6px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 800;
      line-height: 1.7;
      letter-spacing: .3px;
      vertical-align: middle;
      white-space: nowrap;
    }
    body .admin-tag {
      color: #ffcf4d;
      background: color-mix(in srgb, #ffcf4d 14%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, #ffcf4d 45%, transparent);
    }
    body :is(.class-tag,.streak-tag,.champion-tag,.event-tag) {
      color: #5cc8ff;
      background: color-mix(in srgb, #5cc8ff 14%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, #5cc8ff 45%, transparent);
    }
    :root[data-theme="light"] body .admin-tag {
      color: #684700;
      background: color-mix(in srgb, #c48700 14%, var(--card-opaque, #fff));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, #8a5e00 45%, transparent);
    }
    :root[data-theme="light"] body :is(.class-tag,.streak-tag,.champion-tag,.event-tag) {
      color: #005878;
      background: color-mix(in srgb, #087da8 13%, var(--card-opaque, #fff));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, #00678c 45%, transparent);
    }
    @media (prefers-color-scheme: light) {
      :root:not([data-theme="dark"]) body .admin-tag {
        color: #684700;
        background: color-mix(in srgb, #c48700 14%, var(--card-opaque, #fff));
        box-shadow: inset 0 0 0 1px color-mix(in srgb, #8a5e00 45%, transparent);
      }
      :root:not([data-theme="dark"]) body :is(.class-tag,.streak-tag,.champion-tag,.event-tag) {
        color: #005878;
        background: color-mix(in srgb, #087da8 13%, var(--card-opaque, #fff));
        box-shadow: inset 0 0 0 1px color-mix(in srgb, #00678c 45%, transparent);
      }
    }
  `;
  document.head.appendChild(style);
}

function normalizedRow(row) {
  return Object.freeze({
    user_id: String(row?.user_id ?? ""),
    username: String(row?.username ?? ""),
    class: row?.class == null ? null : String(row.class),
    is_admin: row?.is_admin === true,
    is_owner: row?.is_owner === true,
    streak: Math.max(0, Number(row?.streak) || 0),
    weekly_champion: row?.weekly_champion === true,
    badges: Object.freeze(Array.isArray(row?.badges) ? row.badges.filter((badge) => typeof badge === "string") : []),
  });
}

async function fetchTags(sb) {
  try {
    if (!sb?.auth || typeof sb.rpc !== "function") {
      console.warn("[leaderboard tags] Supabase client unavailable");
      return EMPTY_TAGS;
    }
    const { data: authData, error: authError } = await sb.auth.getSession();
    if (authError) throw authError;
    if (!authData?.session) {
      console.warn("[leaderboard tags] signed out; showing leaderboard without tags");
      return EMPTY_TAGS;
    }

    if (authData.session.user?.user_metadata?.account_kind === "kart") return EMPTY_TAGS;
    const { data, error } = await sb.rpc("leaderboard_tags");
    if (error) throw error;
    const byUserId = Object.create(null);
    const byUsername = Object.create(null);
    let owner = null;
    for (const source of Array.isArray(data) ? data : []) {
      const row = normalizedRow(source);
      if (row.user_id) byUserId[row.user_id] = row;
      if (row.username) byUsername[row.username.toLowerCase()] = row;
      if (row.is_owner) owner = row;
    }
    return Object.freeze({
      byUserId: Object.freeze(byUserId),
      byUsername: Object.freeze(byUsername),
      owner,
    });
  } catch (error) {
    console.warn("[leaderboard tags] load failed; showing leaderboard without tags", error);
    return EMPTY_TAGS;
  }
}

export function loadTags(sb) {
  injectTagCss();
  if (!tagsPromise) {
    // Only a successful load is cached: signed out or failed → try again next time.
    tagsPromise = fetchTags(sb).then((tags) => {
      if (tags === EMPTY_TAGS) tagsPromise = null;
      return tags;
    });
  }
  return tagsPromise;
}

export function tagsHtml(row) {
  injectTagCss();
  if (!row) return "";
  const admin = row.is_admin ? ` <span class="admin-tag">👑 Admin</span>` : "";
  const schoolClass = row.class ? ` <span class="class-tag">${esc(row.class)}</span>` : "";
  const streak = row.streak >= 3 ? ` <span class="streak-tag" title="${esc(arcadeText("arc.streakTag", { n: row.streak }))}">🔥${esc(row.streak)}</span>` : "";
  const champion = row.weekly_champion ? ` <span class="champion-tag" title="${esc(arcadeText("arc.championTag"))}">🏆</span>` : "";
  return admin + schoolClass + streak + champion + eventBadgesHtml(row.badges);
}

