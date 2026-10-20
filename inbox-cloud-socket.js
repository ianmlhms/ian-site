// One shared WebSocket to the inbox Worker (/v1/ws).
//   - the Supabase access token travels as a subprotocol (browsers cannot set
//     headers on a WebSocket): ["inbox.v1", "auth.<jwt>"]
//   - keepalive: the text "ping" every 45 s, the server answers "pong"
//   - reconnect with exponential backoff; events are never replayed, so every
//     successful reconnect tells the listeners to reload their lists
//   - a changed access token (refresh) reopens the socket with the new one
// Listener = { onFrame(frame), onStatus(status), onReconnect() }, all optional.
// Status strings reuse the Supabase Realtime ones so inbox.js treats both alike.

const SUBPROTOCOL = "inbox.v1";
const AUTH_PREFIX = "auth.";
const PING_INTERVAL_MS = 45 * 1000;
const PONG_TIMEOUT_MS = 15 * 1000;
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30 * 1000;
const SOCKET_OPEN = 1;
const NORMAL_CLOSE = 1000;

export const STATUS_CONNECTED = "SUBSCRIBED";
export const STATUS_CLOSED = "CLOSED";
export const STATUS_ERROR = "CHANNEL_ERROR";

export function websocketUrl(baseUrl) {
  return `${baseUrl.replace(/\/+$/, "").replace(/^http/, "ws")}/v1/ws`;
}

export function backoffDelay(attempt) {
  return Math.min(BACKOFF_START_MS * 2 ** attempt, BACKOFF_MAX_MS);
}

function parseFrame(data) {
  if (typeof data !== "string" || data === "pong") return null;
  try {
    return JSON.parse(data);
  } catch (error) {
    console.warn("Inbox WebSocket: unreadable frame ignored", error);
    return null;
  }
}

export function createRealtime({
  wsUrl,
  getToken,
  createSocket = (url, protocols) => new WebSocket(url, protocols),
}) {
  const listeners = new Set();
  let supabase = null;
  let socket = null;
  let token = null;
  let authWatch = null;
  let attempt = 0;
  let hasConnected = false;
  let isOutage = false;
  let reconnectTimer = null;
  let pingTimer = null;
  let pongTimer = null;

  function notify(call) {
    listeners.forEach((listener) => {
      try {
        call(listener);
      } catch (error) {
        console.error("Inbox WebSocket: listener failed", error);
      }
    });
  }

  function stopHeartbeat() {
    window.clearInterval(pingTimer);
    window.clearTimeout(pongTimer);
    pingTimer = null;
    pongTimer = null;
  }

  function startHeartbeat(ws) {
    stopHeartbeat();
    pingTimer = window.setInterval(() => {
      if (ws.readyState !== SOCKET_OPEN) return;
      ws.send("ping");
      window.clearTimeout(pongTimer);
      pongTimer = window.setTimeout(() => drop(ws), PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  // Detaches and closes a socket without triggering the reconnect path.
  function retire(ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close(NORMAL_CLOSE);
    } catch (error) {
      console.warn("Inbox WebSocket: close failed", error);
    }
  }

  function scheduleReconnect() {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, backoffDelay(attempt));
    attempt += 1;
  }

  function markOutage(status) {
    if (isOutage) return;
    isOutage = true;
    notify((listener) => listener.onStatus?.(status));
  }

  function drop(ws) {
    if (socket !== ws) return;
    socket = null;
    stopHeartbeat();
    retire(ws);
    markOutage(STATUS_CLOSED);
    scheduleReconnect();
  }

  function handleOpen(ws) {
    if (socket !== ws) return;
    const isReconnect = hasConnected;
    hasConnected = true;
    attempt = 0;
    isOutage = false;
    startHeartbeat(ws);
    notify((listener) => listener.onStatus?.(STATUS_CONNECTED));
    if (isReconnect) notify((listener) => listener.onReconnect?.());
  }

  function handleMessage(ws, event) {
    if (socket !== ws) return;
    window.clearTimeout(pongTimer);
    const frame = parseFrame(event.data);
    if (frame) notify((listener) => listener.onFrame?.(frame));
  }

  function openSocket(nextToken) {
    token = nextToken;
    const ws = createSocket(wsUrl, [SUBPROTOCOL, AUTH_PREFIX + nextToken]);
    socket = ws;
    ws.onopen = () => handleOpen(ws);
    ws.onmessage = (event) => handleMessage(ws, event);
    ws.onclose = () => drop(ws);
    ws.onerror = () => { /* onclose follows and handles the retry */ };
  }

  async function connect() {
    reconnectTimer = null;
    if (!supabase || socket) return;
    try {
      const nextToken = await getToken(supabase);
      if (supabase && !socket) openSocket(nextToken);
    } catch (error) {
      console.warn("Inbox WebSocket: no access token yet", error);
      markOutage(STATUS_ERROR);
      scheduleReconnect();
    }
  }

  // A refreshed token replaces the socket so the server always sees a valid one.
  function onSession(session) {
    const nextToken = session?.access_token;
    if (!supabase || !nextToken || nextToken === token) return;
    window.clearTimeout(reconnectTimer);
    if (socket) {
      const old = socket;
      socket = null;
      stopHeartbeat();
      retire(old);
    }
    openSocket(nextToken);
  }

  function start(client) {
    supabase = client;
    authWatch = client.auth.onAuthStateChange((_event, session) => onSession(session));
    void connect();
  }

  function stop() {
    window.clearTimeout(reconnectTimer);
    stopHeartbeat();
    authWatch?.data?.subscription?.unsubscribe();
    if (socket) retire(socket);
    supabase = null;
    socket = null;
    token = null;
    authWatch = null;
    attempt = 0;
    hasConnected = false;
    isOutage = false;
  }

  function subscribe(client, listener) {
    listeners.add(listener);
    if (listeners.size === 1) start(client);
    return () => {
      if (!listeners.delete(listener)) return;
      if (listeners.size === 0) stop();
    };
  }

  return Object.freeze({ subscribe });
}
