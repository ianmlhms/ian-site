// Unit checks for the inbox backend selector and the WebSocket manager.
// Run: node scripts/test-inbox-cloud.mjs
import assert from "node:assert/strict";

// A manual clock stands in for the browser timers the socket module uses.
const timers = [];
let nextTimerId = 1;
let now = 0;
const addTimer = (callback, delay, repeat) => {
  const timer = { id: nextTimerId++, callback, at: now + delay, delay, repeat };
  timers.push(timer);
  return timer.id;
};
const removeTimer = (id) => {
  const index = timers.findIndex((timer) => timer.id === id);
  if (index >= 0) timers.splice(index, 1);
};
globalThis.window = {
  setTimeout: (callback, delay) => addTimer(callback, delay, false),
  setInterval: (callback, delay) => addTimer(callback, delay, true),
  clearTimeout: removeTimer,
  clearInterval: removeTimer,
  location: { search: "" },
};
async function advance(ms) {
  const end = now + ms;
  for (;;) {
    const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    now = due.at;
    if (due.repeat) due.at += due.delay;
    else removeTimer(due.id);
    await due.callback();
    await Promise.resolve();
  }
  now = end;
}

const {
  CLOUD_BASE_URL, DEFAULT_BACKEND, chooseBackend, chooseCloudUrl, isAllowedCloudUrl,
} = await import("../inbox-backend.js");
const { backoffDelay, createRealtime, websocketUrl } = await import("../inbox-cloud-socket.js");
const { createCloudData, dispatchFrame } = await import("../inbox-cloud-data.js");

// ---- selector ----
const memory = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key), data };
};
assert.equal(DEFAULT_BACKEND, "cloud");
let storage = memory();
assert.equal(chooseBackend("", storage), "cloud", "default");
assert.equal(chooseBackend("?backend=supabase", storage), "supabase", "url param");
assert.equal(chooseBackend("", storage), "supabase", "persisted");
assert.equal(chooseBackend("?backend=nonsense", storage), "supabase", "invalid value ignored");
assert.equal(chooseBackend("?backend=cloud", storage), "cloud", "switch back");
assert.equal(chooseBackend("", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }), "cloud", "storage errors tolerated");
assert.equal(chooseBackend("", null), "cloud", "no storage");

storage = memory();
assert.equal(chooseCloudUrl("", storage), CLOUD_BASE_URL);
assert.equal(chooseCloudUrl("?cloud=http://127.0.0.1:9999", storage), "http://127.0.0.1:9999");
assert.equal(chooseCloudUrl("", storage), "http://127.0.0.1:9999", "persisted");
assert.equal(chooseCloudUrl("?cloud=", storage), CLOUD_BASE_URL, "empty value forgets it");
assert.equal(chooseCloudUrl("?cloud=https://evil.example", storage), CLOUD_BASE_URL, "foreign host refused");
assert.equal(isAllowedCloudUrl("https://ianlu-inbox.ianlu.workers.dev"), true);
assert.equal(isAllowedCloudUrl("http://localhost:8787"), true);
assert.equal(isAllowedCloudUrl("https://127.0.0.1.evil.example"), false);
assert.equal(isAllowedCloudUrl("not a url"), false);

// ---- frame mapping ----
const seen = [];
const handlers = new Proxy({}, { get: (_t, name) => (...args) => seen.push([name, ...args]) });
const api = createCloudData({ baseUrl: "http://127.0.0.1:1", fetchFn: async () => ({}) });
assert.equal(typeof api.fetchChats, "function");
dispatchFrame({ message: (frame, h) => h.onMessageInsert(frame.row) }, { t: "message", row: { id: 1 } }, handlers);
dispatchFrame({}, { t: "unknown" }, handlers);
assert.deepEqual(seen, [["onMessageInsert", { id: 1 }]]);

// ---- socket ----
assert.equal(websocketUrl("https://x.workers.dev/"), "wss://x.workers.dev/v1/ws");
assert.equal(websocketUrl("http://127.0.0.1:8787"), "ws://127.0.0.1:8787/v1/ws");
assert.deepEqual([0, 1, 2, 5, 9].map(backoffDelay), [1000, 2000, 4000, 30000, 30000]);

const sockets = [];
const createSocket = (url, protocols) => {
  const ws = { url, protocols, readyState: 0, sent: [], closed: false,
    send(text) { this.sent.push(text); },
    close() { this.closed = true; this.readyState = 3; } };
  sockets.push(ws);
  return ws;
};
let tokenValue = "jwt-one";
let authCallback = null;
let unsubscribed = false;
const supabase = { auth: { onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } }; } } };
const realtime = createRealtime({ wsUrl: "wss://w.test/v1/ws", getToken: async () => tokenValue, createSocket });
const log = [];
const stop = realtime.subscribe(supabase, {
  onFrame: (frame) => log.push(["frame", frame]),
  onStatus: (status) => log.push(["status", status]),
  onReconnect: () => log.push(["reconnect"]),
});
await advance(0);
assert.equal(sockets.length, 1);
assert.deepEqual(sockets[0].protocols, ["inbox.v1", "auth.jwt-one"]);
sockets[0].readyState = 1;
sockets[0].onopen();
assert.deepEqual(log, [["status", "SUBSCRIBED"]], "first connect does not ask for a reload");
sockets[0].onmessage({ data: "pong" });
sockets[0].onmessage({ data: "{\"t\":\"chat\",\"row\":{\"id\":3}}" });
sockets[0].onmessage({ data: "not json" });
assert.equal(log.length, 2, "pong and garbage are not forwarded");

await advance(45 * 1000);
assert.deepEqual(sockets[0].sent, ["ping"], "ping after 45 s");
sockets[0].onmessage({ data: "pong" });
await advance(45 * 1000);
assert.equal(sockets[0].sent.length, 2, "next ping 45 s later");
sockets[0].onmessage({ data: "pong" });
assert.equal(sockets.length, 1, "answered pings keep the socket");

// no pong -> dropped and reopened with backoff
await advance(45 * 1000);
assert.equal(sockets[0].sent.length, 3);
await advance(14 * 1000);
assert.equal(sockets[0].closed, false, "still waiting for the pong");
await advance(1000);
assert.equal(sockets[0].closed, true, "missing pong closes the socket");
assert.equal(log.at(-1)[1], "CLOSED");
await advance(1000);
assert.equal(sockets.length, 2, "reconnect after the first backoff step");
sockets[1].readyState = 1;
sockets[1].onopen();
assert.deepEqual(log.slice(-2), [["status", "SUBSCRIBED"], ["reconnect"]], "reconnect asks for a reload");

// server closes: backoff doubles, then resets after a successful open
sockets[1].onclose();
await advance(999);
assert.equal(sockets.length, 2);
await advance(1);
assert.equal(sockets.length, 3);
sockets[2].onclose();
await advance(1999);
assert.equal(sockets.length, 3, "second failure waits 2 s");
await advance(1);
assert.equal(sockets.length, 4);
sockets[3].readyState = 1;
sockets[3].onopen();

// token change -> new socket with the new token, old one retired quietly
const statusCount = log.filter(([kind, value]) => kind === "status" && value === "CLOSED").length;
authCallback("TOKEN_REFRESHED", { access_token: "jwt-one" });
assert.equal(sockets.length, 4, "same token: nothing happens");
authCallback("TOKEN_REFRESHED", { access_token: "jwt-two" });
assert.equal(sockets.length, 5);
assert.deepEqual(sockets[4].protocols, ["inbox.v1", "auth.jwt-two"]);
assert.equal(sockets[3].closed, true);
assert.equal(log.filter(([kind, value]) => kind === "status" && value === "CLOSED").length, statusCount, "no outage notice for a token swap");
sockets[4].readyState = 1;
sockets[4].onopen();
assert.equal(log.at(-1)[0], "reconnect");

stop();
assert.equal(sockets[4].closed, true, "last unsubscribe closes the socket");
assert.equal(unsubscribed, true);
await advance(60 * 1000);
assert.equal(sockets.length, 5, "nothing reconnects after stop");

console.log("inbox cloud backend: ok");
