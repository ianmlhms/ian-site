/* Site-wide authenticated presence ping. Loaded lazily by auth.js. */

const PING_INTERVAL_MS = 60_000;
const MAX_PAGE_LENGTH = 120;

let sb = null;
let getSession = () => null;
let timer = null;
let activeUserId = null;
let listening = false;
let warned = false;

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
  if (document.visibilityState !== "visible") return null;
  const current = currentSession();
  if (!current?.user?.id) return null;
  if (current.user.user_metadata?.account_kind === "kart") return null;
  return current;
}

function warnOnce(error) {
  if (warned) return;
  warned = true;
  console.warn("[presence] ping failed", error);
}

async function ping(expectedUserId) {
  const current = eligibleSession();
  if (!current || current.user.id !== expectedUserId) return;
  try {
    const { error } = await sb.rpc("touch_presence", {
      p_page: pagePath(),
    });
    if (error) throw error;
  } catch (error) {
    warnOnce(error);
  }
}

function stop() {
  if (timer !== null) clearInterval(timer);
  timer = null;
  activeUserId = null;
}

function sync() {
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
