/* Weekly board reads are cached per account for this page view. */
import { loadTags, tagsHtml } from "./leaderboard-tags.js?v=4";
import { arcadeText, escapeHtml as esc, scoreHtml, scoreKeyHtml } from "./score-format.js?v=2";

const GAMES = Object.freeze({
  tetris: ["Tetris", "🧱"], flappy: ["Flappy Bird", "🐦"], "crossy-road": ["Crossy Road", "🐔"],
  "doodle-jump": ["Doodle Jump", "🚀"], dino: ["Dino Run", "🦖"], snake: ["Snake", "🐍"],
  "tower-stack": ["Tower Stack", "🏗️"], pacman: ["Pac-Man", "🟡"], "2048": ["2048", "🔢"],
  asteroids: ["Asteroids", "☄️"], "fruit-slash": ["Fruit Slash", "🍉"], reaction: ["Reaction Time", "⚡"],
  "bubble-shooter": ["Bubble Shooter", "🫧"], "space-invaders": ["Space Invaders", "👾"],
});
const weeklyLoads = new Map();
const HOUR_MS = 3_600_000;

export function weeklyGameLabel(id) {
  const game = window.arcadeGameById?.(id);
  const [name, emoji] = GAMES[id] || [id, "🎮"];
  return game ? `${game.emoji} ${game.name}` : `${emoji} ${name}`;
}

function luxParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Luxembourg", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

// Signed-out users cannot read weekly_board. Find next Monday midnight in Luxembourg,
// including the offset at the target date (a DST change can occur before Monday).
function nextLuxMonday() {
  const now = luxParts(new Date());
  const today = new Date(Date.UTC(now.year, now.month - 1, now.day));
  const days = (8 - today.getUTCDay()) % 7 || 7;
  const midnight = today.getTime() + days * 24 * HOUR_MS;
  const atTarget = luxParts(new Date(midnight));
  return new Date(midnight - atTarget.hour * HOUR_MS).toISOString();
}

export function loadWeekly(sb, session) {
  const account = session?.user?.id || "signed-out";
  if (!weeklyLoads.has(account)) weeklyLoads.set(account, fetchWeekly(sb, session));
  return weeklyLoads.get(account);
}

async function fetchWeekly(sb, session) {
  if (session?.user?.user_metadata?.account_kind === "kart") return null;
  const { data: gameId, error: gameError } = await sb.rpc("weekly_game");
  if (gameError) throw gameError;
  if (typeof gameId !== "string" || !gameId) throw new Error("weekly_game returned no game");
  if (!session) return Object.freeze({ gameId, endsAt: nextLuxMonday(), rows: [], tags: null, userId: null });
  const [{ data, error }, tags] = await Promise.all([sb.rpc("weekly_board"), loadTags(sb)]);
  if (error) throw error;
  if (!Array.isArray(data) || !data[0]?.game_id || !Number.isFinite(Date.parse(data[0]?.ends_at))) throw new Error("weekly_board returned no week metadata");
  return Object.freeze({
    gameId: data[0].game_id, endsAt: data[0].ends_at,
    rows: Object.freeze(data.filter((row) => row.user_id).map((row) => Object.freeze({ ...row }))),
    tags, userId: session.user.id,
  });
}

export function countdownText(endsAt) {
  const hours = Math.max(0, Math.ceil((Date.parse(endsAt) - Date.now()) / HOUR_MS));
  return arcadeText("arc.weeklyCountdown", { d: Math.floor(hours / 24), h: hours % 24 });
}

export function weeklyRowsHtml(weekly, limit = 20) {
  const top = weekly.rows.slice(0, limit);
  const own = weekly.rows.find((row) => row.user_id === weekly.userId);
  const rows = own && !top.includes(own) ? [...top, own] : top;
  const markup = rows.map((row) => {
    const ownLabel = row === own && !top.includes(own) ? `<small>${esc(arcadeText("arc.weeklyOwn"))} · </small>` : "";
    const tags = weekly.tags?.byUserId[row.user_id];
    return `<div class="weekly-row${row.user_id === weekly.userId ? " weekly-own" : ""}"><span>${esc(row.rank)}</span><span class="weekly-player">${ownLabel}${esc(row.username)}${tagsHtml(tags)}</span><b>${scoreHtml(row.score)}</b></div>`;
  }).join("");
  return (markup || `<p>${esc(arcadeText("arc.weeklyEmpty"))}</p>`) + scoreKeyHtml(rows.map((row) => row.score));
}

export function weeklyHeadingHtml(weekly) {
  return `<h2>${esc(arcadeText("arc.weeklyTitle"))}: ${esc(weeklyGameLabel(weekly.gameId))}</h2><p class="weekly-countdown" data-weekly-end="${esc(weekly.endsAt)}">${esc(countdownText(weekly.endsAt))}</p>`;
}

export function installWeeklyUi() {
  if (document.getElementById("arcade-weekly-styles")) return;
  const style = document.createElement("style");
  style.id = "arcade-weekly-styles";
  style.textContent = `.weekly-card{padding:18px;margin:0 0 20px;min-width:0}
    .weekly-card h2,#body h2{font-size:19px;line-height:1.4;overflow-wrap:anywhere;margin:0}
    .weekly-countdown{color:var(--muted,var(--text2));font-size:13px;margin:6px 0 12px;font-variant-numeric:tabular-nums}
    .weekly-row{display:grid;grid-template-columns:24px minmax(0,1fr) minmax(64px,auto);gap:8px;padding:8px 0;border-bottom:1px solid var(--border);align-items:start;font-size:14px}
    .weekly-player{min-width:0;overflow-wrap:anywhere}.weekly-row b{text-align:right;font-variant-numeric:tabular-nums;max-width:140px;min-width:0}
    .weekly-own{background:color-mix(in srgb,var(--accent) 10%,transparent)}
    .weekly-play{margin-top:12px}.weekly-row small{color:var(--muted,var(--text2))}`;
  document.head.appendChild(style);
  setInterval(() => document.querySelectorAll("[data-weekly-end]").forEach((node) => {
    node.textContent = countdownText(node.dataset.weeklyEnd);
  }), 60_000);
}
