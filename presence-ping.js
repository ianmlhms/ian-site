/* Site-wide authenticated presence ping. Loaded lazily by auth.js. */
import { commandsSafe } from "./client-commands.js?v=2";

const PING_INTERVAL_MS = 60_000;
const MAX_PAGE_LENGTH = 120;
const COMMAND_WAIT_MS = 10 * 60_000;
const COMMAND_HANDLERS = Object.freeze({ reload: "reload", close_game: "closeGame" });
const handledCommands = new Set();
const pendingCommands = new Map();

let sb = null;
let getSession = () => null;
let timer = null;
let activeUserId = null;
let listening = false;
let warned = false;
let commandWarned = false;
let commandUserId = null;
let commandSince = null;
let commandGeneration = 0;
let pinging = false;

function pagePath() {
  const params = new URLSearchParams(location.search);
  const game = params.has("g")
    ? `?g=${encodeURIComponent(params.get("g") || "")}`
    : "";
  return `${location.pathname || "/"}${game}`.slice(0, MAX_PAGE_LENGTH);
}

function currentSession() {
  try {
    return getSession();
  } catch (error) {
    warnOnce(error);
    return null;
  }
}

function eligibleSession() {
  if (window.top !== window) return null;
  if (document.visibilityState !== "visible") return null;
  const current = currentSession();
  if (!current?.user?.id) return null;
  if (current.user.user_metadata?.account_kind === "kart") return null;
  return current;
}

function warnCommandsOnce(error) {
  if (commandWarned) return;
  commandWarned = true;
  console.warn("[commands] polling or execution failed", error);
}

function finishCommand(id, cmd) {
  handledCommands.add(id);
  pendingCommands.delete(id);
  if (Date.parse(cmd.created_at) > Date.parse(commandSince)) commandSince = cmd.created_at;
}

async function pollCommands(userId) {
  const generation = commandGeneration;
  const sameAccount = () => commandUserId === userId && commandGeneration === generation;
  const eligible = () => eligibleSession()?.user.id === userId && sameAccount();
  if (!eligible()) return;
  try {
    const { data, error } = await sb.rpc("client_commands_since", { p_since: commandSince });
    if (error) throw error;
    if (!eligible()) return;
    if (commandSince === null) {
      if (!data?.now) throw new Error("missing command baseline");
      commandSince = data.now;
      return;
    }
    for (const cmd of data?.commands || []) {
      const id = String(cmd.id);
      if (!handledCommands.has(id) && !pendingCommands.has(id)) {
        pendingCommands.set(id, { cmd: { ...cmd }, receivedAt: Date.now() });
      }
    }
  } catch (error) {
    warnCommandsOnce(error);
  }
  // Retained commands can still run (or expire) if this ping's RPC failed.
  if (commandSince === null) return;
  try {
    for (const [id, { cmd, receivedAt }] of pendingCommands) {
      if (!eligible()) return;
      if (Date.now() - receivedAt >= COMMAND_WAIT_MS) {
        console.warn("[commands] gave up after ten minutes", id, cmd.action);
        finishCommand(id, cmd);
        continue;
      }
      if (!commandsSafe()) continue;
      const handler = window.__ianCommands?.[COMMAND_HANDLERS[cmd.action]];
      if (typeof handler !== "function") {
        console.warn("[commands] unsupported action", cmd.action);
        finishCommand(id, cmd);
        continue;
      }
      try {
        const result = await handler(cmd, eligible);
        if (sameAccount() && result !== false) finishCommand(id, cmd);
      } catch (error) {
        warnCommandsOnce(error);
      }
    }
  } catch (error) {
    warnCommandsOnce(error);
  }
}

function warnOnce(error) {
  if (warned) return;
  warned = true;
  console.warn("[presence] ping failed", error);
}

async function ping(expectedUserId) {
  const current = eligibleSession();
  if (!current || current.user.id !== expectedUserId || pinging) return;
  pinging = true;
  try {
    try {
      const { error } = await sb.rpc("touch_presence", { p_page: pagePath() });
      if (error) throw error;
    } catch (error) {
      warnOnce(error);
    }
    await pollCommands(expectedUserId);
  } finally {
    pinging = false;
  }
}

function stop() {
  if (timer !== null) clearInterval(timer);
  timer = null;
  activeUserId = null;
}

function sync() {
  const sessionId = currentSession()?.user?.id || null;
  if (sessionId !== commandUserId) {
    commandGeneration += 1;
    commandUserId = sessionId;
    commandSince = null;
    pendingCommands.clear();
  }
  const current = eligibleSession();
  if (!sb?.rpc || !current) {
    stop();
    return;
  }
  const userId = current.user.id;
  if (timer !== null && activeUserId === userId) return;
  stop();
  activeUserId = userId;
  void ping(userId);
  timer = setInterval(() => void ping(userId), PING_INTERVAL_MS);
}

export function startPresence(client, sessionReader) {
  sb = client;
  getSession = typeof sessionReader === "function"
    ? sessionReader
    : () => null;
  if (!listening) {
    document.addEventListener("visibilitychange", sync);
    listening = true;
  }
  sync();
}
